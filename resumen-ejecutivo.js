/* ============================================================================
 * resumen-ejecutivo.js — Resumen ejecutivo para el jefe.
 * Rango desde/hasta → 1-2 párrafos redactados por reglas (gratis, determinista) más los indicadores que
 * los respaldan, con botón «Copiar» y «Redactar con IA» opcional (Cloudflare Workers AI, cupo gratis; si
 * falla o no hay cupo, se queda con el texto por reglas y avisa). Funciona embebida (?embed=1, hub-jefe.js)
 * y suelta. Solo lectura: no escribe nada en DATA. CSP D170: sin JS/CSS en línea (data-on-*, data-estilo).
 * ==========================================================================*/
if(window.TM2Estilos) TM2Estilos.aplicar();
try{ if(new URLSearchParams(location.search).get('embed')==='1') document.documentElement.classList.add('embed'); }catch(e){}

const API = GALCA_ENV.url.obra;

// D131 (jefe.js): roles de drenajes con acceso al panel del jefe, retrocompatibles.
const ROLES_DREN = ['residente_dren','residente_odt','residente_odl'];
const ROLES = ['admin','jefe','residente'].concat(ROLES_DREN);
const rol = localStorage.getItem('rol')||'', usuario = (localStorage.getItem('usuario')||'').trim().toLowerCase();
if(ROLES.indexOf(rol)<0 || !(window.TM2Auth && TM2Auth.get())){ location.href='index.html'; }
document.getElementById('userDisplay').textContent = usuario;
const VOLVER = { admin:'menu.html', residente:'residente.html' };
if(rol==='admin' || rol==='residente'){ document.getElementById('btnMenu').style.display='inline-block'; }
else if(ROLES_DREN.indexOf(rol)>=0){ const bm=document.getElementById('btnMenu'); bm.textContent='← Volver'; bm.style.display='inline-block'; }
function volver(){ irA(ROLES_DREN.indexOf(rol)>=0 ? 'residente-drenajes.html' : (VOLVER[rol]||'index.html')); }
function logout(){ localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token'); location.href='index.html'; }

function hoy(){ return new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'}); }

/* ---------- lectura/escritura contra la API (D30/D31) ---------- */
async function leer(action, params){
  const q = new URLSearchParams(Object.assign({ action:action }, params||{}));
  const r = await fetch(API+'?'+q.toString());
  return r.json();
}
async function escribir(payload){
  const r = await fetch(API, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(payload) });
  return r.json();
}

/* ---------- rangos: periodo 16→15 en curso (por defecto), y atajos ---------- */
function isoMenos(iso, n){ const d=new Date(iso+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()-n); return d.toISOString().slice(0,10); }
function periodoDeHoy(){
  const h=hoy(), y=+h.slice(0,4), m=+h.slice(5,7), d=+h.slice(8,10);
  let iniY=y, iniM=m-1; if(d>=16) iniM=m; if(iniM<1){ iniM=12; iniY--; }
  const ini=iniY+'-'+String(iniM).padStart(2,'0')+'-16';
  return { desde:ini, hasta:h };
}
function periodoAnteriorAHoy(){
  const p=periodoDeHoy(), finAnt=isoMenos(p.desde,1);
  const y=+finAnt.slice(0,4), m=+finAnt.slice(5,7);
  let iniY=y, iniM=m-1; if(iniM<1){ iniM=12; iniY--; }
  return { desde:iniY+'-'+String(iniM).padStart(2,'0')+'-16', hasta:finAnt };
}
function fijarRango(desde, hasta){ document.getElementById('desde').value=desde; document.getElementById('hasta').value=hasta; syncRango(); }
function rangoUltimos7(){ fijarRango(isoMenos(hoy(),6), hoy()); }
function rangoPeriodoActual(){ const p=periodoDeHoy(); fijarRango(p.desde, p.hasta); }
function rangoPeriodoAnterior(){ const p=periodoAnteriorAHoy(); fijarRango(p.desde, p.hasta); }
function syncRango(){ const d=document.getElementById('desde').value, h=document.getElementById('hasta'); h.min=d; if(h.value && d && h.value<d) h.value=d; }

/* ---------- estado ---------- */
let ULTIMO = null;   // la última respuesta de ?action=resumen_ejecutivo (para «Copiar» y «Redactar con IA»)

async function generar(){
  const desde=document.getElementById('desde').value, hasta=document.getElementById('hasta').value;
  if(!desde || !hasta){ alert('Elige el rango de fechas.'); return; }
  if(hasta<desde){ alert('«Hasta» no puede ser anterior a «Desde».'); return; }
  const zt=document.getElementById('zonaTexto'), zi=document.getElementById('zonaIndicadores');
  zt.innerHTML='<div class="loading">⏳ Calculando…</div>'; zi.innerHTML='';
  document.getElementById('btnIA').disabled=true; document.getElementById('btnCopiar').disabled=true;
  try{
    const d = await leer('resumen_ejecutivo', { desde, hasta });
    if(!d.ok){
      if(window.TM2Auth && TM2Auth.caducada(d)){ location.href='index.html'; return; }
      throw new Error(d.error||'respuesta sin ok');
    }
    ULTIMO = d;
    render(d);
  }catch(err){
    zt.innerHTML = '<div class="empty-state">⚠️ No se pudo calcular el resumen.<br><small>'+esc(err.message||String(err))+'</small></div>';
  }
}

function render(d){
  document.getElementById('zonaTexto').innerHTML = bloqueTexto(d);
  document.getElementById('zonaIndicadores').innerHTML = bloqueIndicadores(d);
  document.getElementById('btnIA').disabled=false; document.getElementById('btnCopiar').disabled=false;
}

/* ---------- texto ---------- */
function bloqueTexto(d){
  const parrafos = String(d.texto||'').split('\n\n').map(p=>'<p>'+esc(p).replace(/\n/g,'<br>')+'</p>').join('');
  const aviso = d._aviso_ia ? '<div class="aviso-ia">'+esc(d._aviso_ia)+'</div>' : '';
  return '<div class="card">'
    + '<div class="section-title">Resumen '+ (d._ia?'· redactado con IA':'· por reglas') +'</div>'
    + aviso
    + '<div class="texto-resumen" id="textoResumen">'+parrafos+'</div>'
    + '<p class="meta-line">'+esc(d.desde)+' a '+esc(d.hasta)+' · datos hasta '+esc(d.datos_hasta||'—')+'</p>'
    + '</div>';
}
async function copiarTexto(){
  const t=document.getElementById('textoResumen'); if(!t) return;
  const txt = t.innerText || t.textContent || '';
  try{
    if(navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(txt);
    else { const ta=document.createElement('textarea'); ta.value=txt; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
    const b=document.getElementById('btnCopiar'); const orig=b.textContent; b.textContent='✓ Copiado'; setTimeout(()=>{ b.textContent=orig; },1600);
  }catch(e){ alert('No se pudo copiar automáticamente.'); }
}
async function redactarConIA(){
  if(!ULTIMO) return;
  const b=document.getElementById('btnIA'); b.disabled=true; const orig=b.textContent; b.textContent='⏳ Redactando…';
  try{
    const r = await escribir({ action:'resumen_ejecutivo_ia', desde:ULTIMO.desde, hasta:ULTIMO.hasta });
    if(!r.ok){
      if(window.TM2Auth && TM2Auth.caducada(r)){ location.href='index.html'; return; }
      throw new Error(r.error||'respuesta sin ok');
    }
    ULTIMO = Object.assign({}, ULTIMO, { texto:r.texto, _ia:!!r.ia, _aviso_ia:r.aviso||'' });
    document.getElementById('zonaTexto').innerHTML = bloqueTexto(ULTIMO);
  }catch(err){
    alert('No se pudo redactar con IA: '+(err.message||err));
  }finally{
    b.disabled=false; b.textContent=orig;
  }
}

/* ---------- indicadores (tabla compacta) ---------- */
function fmt(n){ return (n==null || !isFinite(n)) ? '—' : Math.round(n).toLocaleString('es-CO'); }
function fmtPct(n){ return (n==null || !isFinite(n)) ? '—' : Math.round(n*100)+'%'; }
const ETQ_PARTIDA = { excavacion:'Excavación', terraplen:'Terraplén', subbase:'Subbase', base:'Base/BTC' };

function bloqueIndicadores(d){
  const ind = d.indicadores||{};
  let h = '<div class="card"><div class="section-title">Indicadores</div>';
  h += filaGlobal(ind.global);
  h += tablaPrincipales(ind.principales);
  h += bloqueClima(ind.clima);
  h += bloqueDrenajes(ind.drenajes);
  h += bloqueAvance(ind.avance, d.indicadores && d.indicadores.avance_nota);
  h += '</div>';
  return h;
}
function filaGlobal(g){
  if(!g) return '';
  const clase = g.clase==='muy_buena'?'ok':(g.clase==='por_debajo'?'mal':'');
  return '<div class="tot-row destacado"><div class="cat">Producción total</div>'
    + '<div class="val '+clase+'">'+fmt(g.prod_total)+'<span class="u">m³</span>'
    + (g.plan_total>0 ? ' <small>('+fmtPct(g.cumpl)+' del plan '+fmt(g.plan_total)+')</small>' : ' <small>(sin plan)</small>')
    + '</div></div>';
}
function tablaPrincipales(p){
  if(!p) return '';
  const filas=Object.keys(ETQ_PARTIDA).map(k=>{
    const x=p[k]||{};
    return '<tr><td>'+esc(ETQ_PARTIDA[k])+'</td><td>'+fmt(x.prod)+'</td><td>'+(x.plan>0?fmt(x.plan):'—')+'</td>'
      + '<td>'+fmtPct(x.cumpl)+'</td><td>'+(x.var_pct!=null?(x.var_pct>=0?'▲':'▼')+' '+fmtPct(Math.abs(x.var_pct)):'—')+'</td></tr>';
  }).join('');
  return '<table class="ind-tabla"><thead><tr><th>Partida</th><th>Prod.</th><th>Plan</th><th>Cumpl.</th><th>vs anterior</th></tr></thead><tbody>'+filas+'</tbody></table>';
}
function bloqueClima(c){
  if(!c) return '';
  let h='<div class="tot-row"><div class="cat">🌦️ Clima</div><div class="val">'
    + c.dias_con_registro+'/'+c.dias_rango+' días con registro · '+c.dias_lluvia+' con lluvia</div></div>';
  if(c.horas_lluvia!=null) h+='<div class="tot-row"><div class="cat">Horas de lluvia / varada (partes)</div><div class="val">'+fmt(c.horas_lluvia)+' / '+fmt(c.horas_varada)+' h</div></div>';
  return h;
}
function listaActividades(acts){
  if(!acts || !acts.length) return '<small>(sin registros)</small>';
  return acts.map(a=>esc(a.actividad)+' <small>'+fmt(a.cantidad)+' '+esc(a.unidad)+' · '+a.dias+' día'+(a.dias===1?'':'s')+'</small>').join('<br>');
}
function bloqueDrenajes(d){
  if(!d) return '';
  return '<div class="tot-row"><div class="cat">ODT</div><div class="val">'+listaActividades(d.odt && d.odt.actividades)+'</div></div>'
    + '<div class="tot-row"><div class="cat">ODL</div><div class="val">'+listaActividades(d.odl && d.odl.actividades)+'</div></div>'
    + (d.otras && d.otras.actividades && d.otras.actividades.length ? '<div class="tot-row"><div class="cat">Tierras (otras)</div><div class="val">'+listaActividades(d.otras.actividades)+'</div></div>' : '');
}
function bloqueAvance(a, nota){
  if(!a || !a.global || a.global.cumpl==null) return nota ? '<div class="tot-row"><div class="cat">Avance del contrato</div><div class="val"><small>'+esc(nota)+'</small></div></div>' : '';
  return '<div class="tot-row destacado"><div class="cat">Avance del contrato</div><div class="val">'+fmtPct(a.global.cumpl)+'</div></div>';
}

/* ---------- arranque ---------- */
(function(){
  let uDesde=null, uHasta=null;
  try{ const u=new URLSearchParams(location.search); uDesde=u.get('desde'); uHasta=u.get('hasta'); }catch(e){}
  if(uDesde){ fijarRango(uDesde, uHasta||uDesde); generar(); }
  else { rangoPeriodoActual(); }
})();
