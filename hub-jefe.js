/* ============================================================================
 * HUB DEL JEFE (V3-10 / D181) — un panel con pestañas que montan las pantallas
 * existentes en un iframe del mismo origen (?embed=1), sin fusionar su código:
 *   Resumen (jefe.html) · Revisión de DATA (data.html) · Catálogos BASE (grilla.html) ·
 *   Proyección (proyeccion.html, V3-11 / D183: plan, contrato, rendimientos y FC; editan admin
 *   y jefe, el residente la ve en solo lectura)
 * + enlace al Tablero. Los iframes se crean perezosamente y se conservan vivos
 * (cambiar de pestaña NO pierde lo editado). Rango de fechas común para Resumen y
 * DATA. CSP D170: eventos por data-on-* (tema.js), funciones globales.
 * ==========================================================================*/
if(window.TM2Estilos) TM2Estilos.aplicar();

const ROLES_HUB = ['admin','jefe','residente','residente_dren','residente_odt','residente_odl'];
const USUARIOS_OK = ['jeisson'];
const VOLVER = { admin:'menu.html', residente:'residente.html' };

const rol = localStorage.getItem('rol')||'', usuario = (localStorage.getItem('usuario')||'').trim().toLowerCase();
if(!rol || (ROLES_HUB.indexOf(rol)<0 && USUARIOS_OK.indexOf(usuario)<0) || !(window.TM2Auth && TM2Auth.get())){ location.href='index.html'; }
const PUEDE_EDITAR = ['admin','jefe','residente'].indexOf(rol)>=0 || USUARIOS_OK.indexOf(usuario)>=0;
document.getElementById('userDisplay').textContent = usuario+' · '+rol;
const VOLVER_A = VOLVER[rol] || (USUARIOS_OK.indexOf(usuario)>=0 ? 'seleccion-reporte.html' : '');
if(VOLVER_A){ const bm=document.getElementById('btnMenu'); bm.style.display='inline-block'; bm.setAttribute('data-on-click', "irA('"+VOLVER_A+"')"); }

function logout(){ localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token'); location.href='index.html'; }

const TABS = [
  { id:'resumen', label:'Resumen',           page:'jefe.html',   fecha:true,  ver:true },
  { id:'data',    label:'Revisión de DATA',  page:'data.html',   fecha:true,  ver:PUEDE_EDITAR },
  { id:'base',    label:'Catálogos BASE',    page:'grilla.html', fecha:false, ver:PUEDE_EDITAR },
  // V3-11 / D183: la ven admin, jefe y residente (el mismo portero que proyeccion.html); quién edita lo decide el servidor.
  { id:'proyeccion', label:'Proyección',     page:'proyeccion.html', fecha:false, ver:['admin','jefe','residente'].indexOf(rol)>=0 },
  // D198: la Base de aprobados del parte de maquinaria, SOLA (sin Pendientes ni aprobar). El jefe la consulta;
  // admin/residente/revisores la editan como en su pantalla. Toma el rango del Hub.
  { id:'maquinaria', label:'Base maquinaria', page:'revision-maquinaria.html', extra:'&solo=base', fecha:true,
    ver:['admin','jefe','residente','residente_dren'].indexOf(rol)>=0 || USUARIOS_OK.indexOf(usuario)>=0 },
];
const EXT = [ { id:'tablero', label:'Tablero ↗', href:'tablero-produccion.html' } ];
const PAGE2TAB = { data:'data', grilla:'base', proyeccion:'proyeccion', revision:'maquinaria' };

let desde='', hasta='', actTab='', frames={}, dirtyByTab={}, stale={};

/* rango por defecto: periodo 16→15 que contiene hoy */
function periodoDeHoy(){
  const h=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'}); const y=+h.slice(0,4), m=+h.slice(5,7), d=+h.slice(8,10);
  const fin=new Date(Date.UTC(y,m-1,15)); let ini=new Date(Date.UTC(y,m-2,16));
  if(d>=16){ ini=new Date(Date.UTC(y,m-1,16)); fin.setUTCMonth(fin.getUTCMonth()+1); }
  const iso=(dt)=>dt.toISOString().slice(0,10); return { desde:iso(ini), hasta:iso(fin) };
}
function frameSrc(tab){
  let s=tab.page+'?embed=1'+(tab.extra||'');
  if(tab.fecha) s+='&desde='+encodeURIComponent(desde)+'&hasta='+encodeURIComponent(hasta);
  // V3-17: si el rango vino del selector «Actas», se lo pasamos a la pestaña (hoy solo lo usa data.js, para
  // preseleccionar su filtro de vista «Acta» cuando las actas elegidas no son consecutivas).
  if(tab.fecha && ACTA_SEL.size) s+='&actas='+encodeURIComponent(Array.from(ACTA_SEL).join(','));
  return s;
}

function pintarTabs(){
  let h='';
  TABS.filter(function(t){ return t.ver; }).forEach(function(t){
    h+='<button class="tab'+(t.id===actTab?' on':'')+'" data-on-click="verTab(\''+t.id+'\')">'+esc(t.label)+(dirtyByTab[t.id]>0?'<span class="dot" title="cambios sin guardar"></span>':'')+'</button>';
  });
  EXT.forEach(function(e){ h+='<button class="tab ext" data-on-click="irA(\''+e.href+'\')">'+esc(e.label)+'</button>'; });
  document.getElementById('tabs').innerHTML=h;
}
function verTab(id){ const tab=TABS.filter(function(t){ return t.id===id && t.ver; })[0]; if(tab) mostrar(id); }
function mostrar(id){
  const tab=TABS.filter(function(t){ return t.id===id; })[0]; if(!tab) return;
  let f=frames[id];
  if(f && stale[id]){   // el rango cambió mientras esta pestaña no estaba visible → recargar
    if(!(dirtyByTab[id]>0 && !confirm('Hay cambios sin guardar en «'+tab.label+'». ¿Recargar con el nuevo rango y descartarlos?'))){
      f.src=frameSrc(tab); dirtyByTab[id]=0;
    }
    delete stale[id];
  }
  if(!f){ f=document.createElement('iframe'); f.id='if-'+id; f.title=tab.label; frames[id]=f; f.src=frameSrc(tab); document.getElementById('marco').appendChild(f); }
  Object.keys(frames).forEach(function(k){ frames[k].classList.toggle('oculto', k!==id); });
  const cg=document.getElementById('cargando'); if(cg) cg.style.display='none';
  actTab=id; try{ localStorage.setItem('tm2_hub_tab', id); }catch(e){} if(location.hash!=='#'+id) location.hash=id;
  pintarTabs();
}
// V3-17: aplica el rango que ya está en #desde/#hasta (lo puso un chip, el selector «Actas» o los campos a
// mano) a las pestañas con fecha; la pestaña activa se recarga ya (con el aviso de cambios sin guardar), las
// demás quedan «stale» y se recargan al abrirlas. `verFechas()` (botón «Ver») además olvida la selección de
// actas, porque un rango escrito a mano ya no corresponde a ninguna.
function aplicarRango(){
  desde=document.getElementById('desde').value; hasta=document.getElementById('hasta').value||desde;
  if(!desde){ return; }
  TABS.forEach(function(t){
    if(!t.fecha || !frames[t.id]) return;
    if(t.id===actTab){
      if(dirtyByTab[t.id]>0 && !confirm('Hay cambios sin guardar en «'+t.label+'». ¿Recargar con el nuevo rango y descartarlos?')) return;
      frames[t.id].src=frameSrc(t); dirtyByTab[t.id]=0;
    } else { stale[t.id]=true; }
  });
  pintarTabs(); pintarRapidos(); pintarActas();
}
function verFechas(){ ACTA_SEL.clear(); aplicarRango(); }

/* Rangos rápidos (D196): un clic fija el rango y lo aplica. Acta = periodo 16→15 (misma regla que actaDe). */
function isoMenos(iso, n){ const d=new Date(iso+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()-n); return d.toISOString().slice(0,10); }
function actaNum(hasta){ const y=+hasta.slice(0,4), m=+hasta.slice(5,7); return (y-2025)*12+m+2; }
function rangosRapidos(){
  const h=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'}), p=periodoDeHoy(), finAnt=isoMenos(p.desde,1);
  const md=new Date(finAnt+'T12:00:00Z'); md.setUTCMonth(md.getUTCMonth()-1);
  const ant={ desde:md.toISOString().slice(0,8)+'16', hasta:finAnt };
  const dow=(new Date(h+'T12:00:00Z').getUTCDay()+6)%7;
  return [
    { t:'Hoy', desde:h, hasta:h }, { t:'Ayer', desde:isoMenos(h,1), hasta:isoMenos(h,1) },
    { t:'Esta semana', desde:isoMenos(h,dow), hasta:h }, { t:'7 días', desde:isoMenos(h,6), hasta:h },
    { t:'Acta '+actaNum(p.hasta), desde:p.desde, hasta:p.hasta }, { t:'Acta '+actaNum(ant.hasta), desde:ant.desde, hasta:ant.hasta },
  ];
}
function pintarRapidos(){
  const d=document.getElementById('desde').value, a=document.getElementById('hasta').value||d;
  document.getElementById('rapidos').innerHTML=rangosRapidos().map(function(x){
    return '<button type="button" class="chip'+(x.desde===d&&x.hasta===a?' on':'')+'" data-d="'+x.desde+'" data-h="'+x.hasta+'" title="'+x.desde+' → '+x.hasta+'">'+esc(x.t)+'</button>';
  }).join('');
}
document.getElementById('rapidos').addEventListener('click', function(ev){
  const b=ev.target.closest && ev.target.closest('button[data-d]'); if(!b) return;
  ACTA_SEL.clear();   // V3-17: un chip de fecha ya no corresponde a las actas elegidas
  document.getElementById('desde').value=b.dataset.d; document.getElementById('hasta').value=b.dataset.h; aplicarRango();
});

/* ---------- selector «Actas» (V3-17) — mismo control que data.js, para fijar el rango del Hub (y el de la
 * pestaña DATA embebida) eligiendo una o varias actas en vez de fechas. Sin la tabla `periodos` aquí (el Hub
 * no consulta data_grid): siempre la fórmula de respaldo, la misma que actaNum/periodoDeHoy. */
const ACTA_SEL=new Set();
let actasAbierto=false;
function rangoDeActa(n){
  const t=n-2, y=2025+Math.floor((t-1)/12), m=(((t-1)%12)+12)%12+1, pad=function(x){ return String(x).padStart(2,'0'); };
  let ym=m-1, yy=y; if(ym<1){ ym=12; yy--; }
  return { desde:yy+'-'+pad(ym)+'-16', hasta:y+'-'+pad(m)+'-15' };
}
function actaContiguas(nums){ for(let i=1;i<nums.length;i++) if(nums[i]-nums[i-1]!==1) return false; return true; }
function etiquetaActas(){
  if(!ACTA_SEL.size) return 'Elegir…';
  const nums=Array.from(ACTA_SEL).map(Number).sort(function(a,b){ return a-b; });
  if(nums.length===1) return 'Acta '+nums[0];
  return actaContiguas(nums) ? ('Actas '+nums[0]+'–'+nums[nums.length-1]) : ('Acta '+nums.join(', '));
}
function pintarActas(){
  const box=document.getElementById('fActas'); if(!box) return;
  const v=box.querySelector('.ms-btn .v'); if(v) v.textContent=etiquetaActas();
  box.classList.toggle('activo', ACTA_SEL.size>0);
}
function listaActas(){ const max=actaNum(periodoDeHoy().hasta), out=[]; for(let n=max;n>=1;n--) out.push(n); return out; }
function onCambioActa(ev){
  const cb=ev.target; if(!cb || cb.type!=='checkbox') return;
  if(cb.checked) ACTA_SEL.add(cb.value); else ACTA_SEL.delete(cb.value);
  if(!ACTA_SEL.size){ pintarActas(); return; }
  const nums=Array.from(ACTA_SEL).map(Number).sort(function(a,b){ return a-b; });
  document.getElementById('desde').value=rangoDeActa(nums[0]).desde;
  document.getElementById('hasta').value=rangoDeActa(nums[nums.length-1]).hasta;
  aplicarRango();
}
function abrirActas(){
  cerrarActas();
  const box=document.getElementById('fActas'); if(!box) return;
  const pop=box.querySelector('.ms-pop'); actasAbierto=true;
  let h='<div class="ms-lista">';
  listaActas().forEach(function(n){
    const r=rangoDeActa(n);
    h+='<label class="ms-op"><input type="checkbox" value="'+n+'"'+(ACTA_SEL.has(String(n))?' checked':'')+'><span class="txt">Acta '+n+'</span><em>'+esc(r.desde.slice(5)+' – '+r.hasta.slice(5))+'</em></label>';
  });
  pop.innerHTML=h+'</div>'; pop.hidden=false; box.classList.add('abierto');
  pop.addEventListener('change', onCambioActa);
}
function cerrarActas(){
  if(!actasAbierto) return; actasAbierto=false;
  const box=document.getElementById('fActas'); if(box){ const pop=box.querySelector('.ms-pop'); if(pop){ pop.hidden=true; pop.innerHTML=''; } box.classList.remove('abierto'); }
}
function montarActas(){
  const box=document.getElementById('fActas'); if(!box) return;
  box.innerHTML='<button type="button" class="ms-btn" aria-haspopup="listbox"><span class="t">Actas</span><span class="v"></span></button><div class="ms-pop" hidden></div>';
  box.querySelector('.ms-btn').addEventListener('click', function(ev){ ev.stopPropagation(); if(actasAbierto) cerrarActas(); else abrirActas(); });
  box.querySelector('.ms-pop').addEventListener('click', function(ev){ ev.stopPropagation(); });
  document.addEventListener('click', function(){ cerrarActas(); });
  document.addEventListener('keydown', function(ev){ if(ev.key==='Escape' && actasAbierto) cerrarActas(); });
  pintarActas();
}
montarActas();
['desde','hasta'].forEach(function(id){ document.getElementById(id).addEventListener('change', function(){
  const de=document.getElementById('desde'), ha=document.getElementById('hasta');
  if(id==='desde' && ha.value && de.value>ha.value) ha.value=de.value;   // sin rangos al revés
  pintarRapidos();
}); });

/* dirty avisado por cada iframe hija (postMessage) */
window.addEventListener('message', function(ev){
  if(ev.origin!==location.origin) return;
  const m=ev.data; if(!m || m.tm2!=='dirty') return;
  const tab=PAGE2TAB[m.page]; if(!tab) return;
  dirtyByTab[tab]=m.n||0; pintarTabs();
});
window.addEventListener('beforeunload', function(e){
  const hayDirty=Object.keys(dirtyByTab).some(function(k){ return dirtyByTab[k]>0; });
  if(hayDirty){ e.preventDefault(); e.returnValue=''; }
});

/* arranque */
(function(){
  const p=periodoDeHoy(); desde=p.desde; hasta=p.hasta;
  document.getElementById('desde').value=desde; document.getElementById('hasta').value=hasta;
  pintarTabs(); pintarRapidos();
  let inicial=(location.hash||'').replace('#','');
  if(!TABS.some(function(t){ return t.id===inicial && t.ver; })){ try{ inicial=localStorage.getItem('tm2_hub_tab')||''; }catch(e){} }
  if(!TABS.some(function(t){ return t.id===inicial && t.ver; })) inicial='resumen';
  mostrar(inicial);
})();
