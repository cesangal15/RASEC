/* ============================================================================
 * REVISIÓN DE DATA (V3-08b / D181) — edición tipo Excel de la hoja DATA.
 * El jefe/residente corrige o añade filas del reporte diario al cierre. Elige
 * descripción (actividad) y subtramo; el sistema deriva CC, grupo, capítulo, UF,
 * abscisas, acta y cantidad = largo×espesor÷fc, igual que las fórmulas del Excel.
 * Validación y control de versión por fila los pone el Worker; el cliente
 * previsualiza. CSP D170: data-on-* + funciones globales; nada inline.
 * ==========================================================================*/
if(window.TM2Estilos) TM2Estilos.aplicar();

const APPS_SCRIPT_URL = GALCA_ENV.url.obra;
const ROLES_VER  = ['admin','jefe','residente'];
const ROLES_EDIT = ['admin','jefe','residente'];
const USUARIOS_OK = ['jeisson'];
const VOLVER = { admin:'menu.html', jefe:'jefe.html', residente:'residente.html' };

const rol = localStorage.getItem('rol')||'', usuario = (localStorage.getItem('usuario')||'').trim().toLowerCase();
if(!rol || (ROLES_VER.indexOf(rol)<0 && USUARIOS_OK.indexOf(usuario)<0) || !(window.TM2Auth && TM2Auth.get())){ location.href='index.html'; }
const PUEDE_EDITAR = ROLES_EDIT.indexOf(rol)>=0 || USUARIOS_OK.indexOf(usuario)>=0;
document.getElementById('userDisplay').textContent = usuario+' · '+rol;
const VOLVER_A = VOLVER[rol] || (USUARIOS_OK.indexOf(usuario)>=0 ? 'seleccion-reporte.html' : '');
if(VOLVER_A){ const bm=document.getElementById('btnMenu'); bm.style.display='inline-block'; bm.setAttribute('data-on-click', "irA('"+VOLVER_A+"')"); }
if(!PUEDE_EDITAR){ const sl=document.getElementById('soloLectura'); if(sl) sl.style.display='inline-block'; }

function logout(){ localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token'); location.href='index.html'; }
function caducada(d){ if(window.TM2Auth && TM2Auth.caducada(d)){ alert('La sesión ya no vale. Vuelve a entrar.'); logout(); return true; } return false; }
async function api(url, body){
  const r = body ? await fetch(APPS_SCRIPT_URL, { method:'POST', headers:{'Content-Type':'text/plain'}, body:JSON.stringify(body) }) : await fetch(url, {cache:'no-store'});
  return r.json();
}
let toastT=null; function toast(msg, err){ let t=document.querySelector('.toast'); if(!t){ t=document.createElement('div'); t.className='toast'; document.body.appendChild(t); } t.textContent=msg; t.classList.toggle('err',!!err); t.style.display='block'; clearTimeout(toastT); toastT=setTimeout(()=>t.style.display='none', err?6000:2600); }

function num(v){ if(v===''||v===null||v===undefined) return null; const n=Number(String(v).replace(',','.')); return isFinite(n)?n:null; }
function fmt(n){ return (n===null||n===''||n===undefined)?'':(Math.round(Number(n)*100)/100).toLocaleString('es-CO',{maximumFractionDigits:2}); }
function normNom(s){ return String(s==null?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase(); }
function hoyBogota(){ return new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'}); }

/* ---------- estado ---------- */
let COLS=[];               // metadatos de columna (del server)
let FILAS=[];              // filas de trabajo (con _key, valores vivos, _orig, _alta, _baja)
let ACT_BY={}, EL_BY={}, PERIODOS=[], LIB_OPC=[''];   // catálogos para derivar
let tempSeq=0;
let shiftHeld=false, ancla=null, selFoco=null, focoCelda=null;
const DRIVERS = ['fecha','descripcion','elemento','largo','espesor','fc'];   // disparan re-derivación

/* ---------- rango por defecto: periodo 16→15 que contiene hoy ---------- */
function periodoDeHoy(){
  const h=hoyBogota(); const y=+h.slice(0,4), m=+h.slice(5,7), d=+h.slice(8,10);
  const fin = new Date(Date.UTC(y, m-1, 15));                 // 15 de este mes
  let ini = new Date(Date.UTC(y, m-2, 16));                   // 16 del mes anterior
  if(d>=16){ ini=new Date(Date.UTC(y, m-1, 16)); fin.setUTCMonth(fin.getUTCMonth()+1); }
  const iso=(dt)=>dt.toISOString().slice(0,10);
  return { desde:iso(ini), hasta:iso(fin) };
}

/* ---------- derivación local (espejo del server) ---------- */
function actaDe(fecha){ for(let i=0;i<PERIODOS.length;i++){ const p=PERIODOS[i]; if(fecha>=p.fi && fecha<=p.ff) return p.acta; } return ''; }
function derivar(r){
  const el = EL_BY[normNom(r.elemento)] || null;
  const uf = el ? String(el.uf||'') : String(r.unidad_funcional||'');
  const act = ACT_BY[normNom(r.descripcion)+'|'+uf.toUpperCase()] || null;
  const cc = act ? act.cc : String(r.centro_de_costo||'');
  const L=num(r.largo), E=num(r.espesor), F=num(r.fc);
  const cant = (L==null) ? (r.cantidad==='' ? '' : num(r.cantidad)) : Math.round(L*(E==null?1:E)/((F==null||F===0)?1:F)*1e6)/1e6;
  return {
    unidad_funcional: uf, centro_de_costo: cc,
    grupo: act?act.grupo:r.grupo, capitulo: act?act.capitulo:r.capitulo,
    unidad_medida: act?act.unidad:r.unidad_medida, orden: act?String(act.orden||''):r.orden,
    proyecto: act?act.proyecto:r.proyecto,
    abs_inicial: el?String(el.abs_inicio||''):r.abs_inicial, abs_final: el?String(el.abs_fin||''):r.abs_final,
    acta: actaDe(r.fecha) || r.acta, cantidad: (cant===null?'':cant)
  };
}

/* ---------- carga ---------- */
function consultar(){
  const desde=document.getElementById('desde').value, hasta=document.getElementById('hasta').value;
  if(!desde){ toast('Elige la fecha «desde».', true); return; }
  cargar(desde, hasta||desde);
}
async function cargar(desde, hasta){
  document.getElementById('cuerpo').innerHTML='<tr><td class="vacio">Cargando…</td></tr>';
  const d = await api(APPS_SCRIPT_URL+'?action=data_grid&desde='+encodeURIComponent(desde)+'&hasta='+encodeURIComponent(hasta));
  if(caducada(d)) return;
  if(!d.ok){ toast(d.error||'No se pudo cargar', true); document.getElementById('cuerpo').innerHTML='<tr><td class="vacio">—</td></tr>'; return; }
  aplicarModelo(d);
}
async function recargar(){ if(dirtyCambios().length && !confirm('Hay cambios sin guardar. ¿Descartarlos y recargar?')) return; const d=document.getElementById('desde').value, h=document.getElementById('hasta').value; if(d) cargar(d,h||d); }

function aplicarModelo(d){
  COLS = d.columnas||[];
  LIB_OPC = d.liberacion_opciones || [''];
  PERIODOS = d.periodos || [];
  ACT_BY={}; (d.actividades||[]).forEach(function(a){ ACT_BY[normNom(a.descripcion)+'|'+String(a.uf||'').toUpperCase()]={cc:a.cc,capitulo:a.capitulo,grupo:a.grupo,unidad:a.unidad,proyecto:a.proyecto,orden:a.orden}; });
  EL_BY={};  (d.subtramos||[]).forEach(function(e){ EL_BY[normNom(e.elemento)]={uf:e.uf,abs_inicio:e.abs_inicio,abs_fin:e.abs_fin}; });
  // datalists
  document.getElementById('dlDesc').innerHTML = (d.actividades||[]).map(function(a){ return '<option value="'+esc(a.descripcion)+'">'+esc((a.uf||'')+' · '+a.cc)+'</option>'; }).join('');
  document.getElementById('dlElem').innerHTML = (d.subtramos||[]).map(function(e){ return '<option value="'+esc(e.elemento)+'">'+esc(e.uf||'')+'</option>'; }).join('');
  FILAS = (d.filas||[]).map(function(r){ const o=Object.assign({}, r); o._key=r.id_registro; o._orig=Object.assign({},r); o._alta=false; o._baja=false; return o; });
  ancla=selFoco=focoCelda=null;
  if(document.getElementById('desde').value!==d.desde){ document.getElementById('desde').value=d.desde; document.getElementById('hasta').value=d.hasta; }
  pintarCab(); pintar();
  const puede = PUEDE_EDITAR && (d.roles_editan||ROLES_EDIT);
  ['btnAlta','btnFill','btnGuardar'].forEach(function(id){ const b=document.getElementById(id); if(b) b.style.display = PUEDE_EDITAR ? 'inline-block' : 'none'; });
  actualizarDirty();
}

/* ---------- render ---------- */
let ordCol=-1, ordDir=1;
function ordenarPor(i){ if(ordCol===i){ ordDir=-ordDir; } else { ordCol=i; ordDir=1; } pintar(); }
function pintarCab(){
  let h='<th class="rownum">#</th>';
  COLS.forEach(function(c,i){ h+='<th data-on-click="ordenarPor('+i+')" title="'+(c.edita?'editable':'calculado')+'">'+esc(c.etiqueta)+'</th>'; });
  if(PUEDE_EDITAR) h+='<th class="rownum"></th>';
  document.getElementById('cab').innerHTML=h;
}
function filasVisibles(){
  const q=normNom(document.getElementById('q').value);
  let vis=FILAS.filter(function(r){ return !r._baja; });
  if(q) vis=vis.filter(function(r){ return COLS.some(function(c){ return normNom(r[c.k]).indexOf(q)>=0; }); });
  if(ordCol>=0 && COLS[ordCol]){ const k=COLS[ordCol].k; vis=vis.slice().sort(function(a,b){ const va=normNom(a[k]),vb=normNom(b[k]); return (va<vb?-1:va>vb?1:0)*ordDir; }); }
  return vis;
}
function esc2(v){ return esc(v==null?'':String(v)); }
function celHTML(r, c, ci){
  const k=c.k, val=r[k];
  const cls='cell'+(c.edita?'':' deriv');
  const ro = PUEDE_EDITAR ? '' : ' readonly disabled';
  const td='<td class="'+cls+'" data-key="'+esc2(r._key)+'" data-ci="'+ci+'" data-k="'+k+'" data-on-mousedown="selDown(\''+esc2(r._key)+'\','+ci+',event)">';
  if(c.tipo==='lista'){
    const ops=(c.opciones||LIB_OPC).map(function(o){ return '<option value="'+esc2(o)+'"'+(String(val||'')===o?' selected':'')+'>'+esc2(o||'—')+'</option>'; }).join('');
    return td+'<select class="cin"'+ro+' data-on-change="cel(\''+esc2(r._key)+'\',\''+k+'\',this)" data-on-focus="foco(\''+esc2(r._key)+'\','+ci+')">'+ops+'</select></td>';
  }
  const tipoInput = c.tipo==='fecha' ? 'date' : 'text';
  const lista = c.tipo==='lista_desc' ? ' list="dlDesc"' : c.tipo==='lista_elem' ? ' list="dlElem"' : '';
  const numcls = c.tipo==='num' ? ' num' : '';
  const evt = (c.tipo==='fecha') ? 'data-on-change' : 'data-on-input';
  return td+'<input class="cin'+numcls+'" type="'+tipoInput+'"'+lista+' value="'+esc2(val)+'"'+ro+' '+evt+'="cel(\''+esc2(r._key)+'\',\''+k+'\',this)" data-on-focus="foco(\''+esc2(r._key)+'\','+ci+')"></td>';
}
function filaHTML(r){
  const sinCC = !String(r.centro_de_costo||'').trim();
  let h='<tr data-fila="'+esc2(r._key)+'" class="'+(esDirty(r)?'dirty ':'')+(sinCC?'sincc':'')+'">';
  h+='<td class="rownum">'+(r._alta?'nuevo':'')+'</td>';
  COLS.forEach(function(c,ci){ h+=celHTML(r,c,ci); });
  if(PUEDE_EDITAR) h+='<td class="rownum"><button class="btn mini" title="Eliminar fila" data-on-click="bajaFila(\''+esc2(r._key)+'\')">✕</button></td>';
  return h+'</tr>';
}
function pintar(){
  const vis=filasVisibles();
  const cuerpo=document.getElementById('cuerpo');
  cuerpo.innerHTML = vis.length ? vis.map(filaHTML).join('') : '<tr><td class="vacio" colspan="'+(COLS.length+2)+'">Sin filas en el rango.</td></tr>';
  pintarKPIs(); paintSel();
}

/* ---------- edición en celda (sin repintar) ---------- */
function filaPorKey(k){ return FILAS.filter(function(r){ return String(r._key)===String(k); })[0] || null; }
function cel(key, campo, el){
  const r=filaPorKey(key); if(!r) return;
  r[campo] = el.value;
  if(DRIVERS.indexOf(campo)>=0){ const d=derivar(r); Object.assign(r,d); pintarDerivadas(key, d); }
  const tr=el.closest('tr'); if(tr){ tr.classList.toggle('dirty', esDirty(r)); tr.classList.toggle('sincc', !String(r.centro_de_costo||'').trim()); }
  pintarKPIs(); actualizarDirty();
}
function pintarDerivadas(key, d){
  const tr=document.querySelector('#cuerpo tr[data-fila="'+cssEsc(key)+'"]'); if(!tr) return;
  Object.keys(d).forEach(function(k){
    const cell=tr.querySelector('td.cell[data-k="'+k+'"] .cin');
    if(cell && document.activeElement!==cell){ const v=d[k]; cell.value = (k==='cantidad') ? (v===''?'':v) : (v==null?'':v); }
  });
}
function cssEsc(s){ return String(s).replace(/["\\]/g,'\\$&'); }
function esDirty(r){
  if(r._alta||r._baja) return true;
  return COLS.some(function(c){ return String(r[c.k]==null?'':r[c.k]) !== String(r._orig[c.k]==null?'':r._orig[c.k]); });
}

/* ---------- KPIs ---------- */
function pintarKPIs(){
  const vis=filasVisibles();
  document.getElementById('kFilas').textContent=vis.length;
  let suma=0, sincc=0;
  vis.forEach(function(r){ const n=num(r.cantidad); if(n!=null) suma+=n; if(!String(r.centro_de_costo||'').trim()) sincc++; });
  document.getElementById('kCant').textContent=fmt(suma);
  document.getElementById('kSinCC').textContent=sincc;
}

/* ---------- alta / baja ---------- */
function altaFila(){
  const desde=document.getElementById('desde').value || hoyBogota();
  const r={ _key:'nuevo-'+(++tempSeq), id_registro:'', version:0, fecha:desde, orden:'', grupo:'', centro_de_costo:'', capitulo:'',
    descripcion:'', unidad_funcional:'', proyecto:'', elemento:'', abs_inicial:'', abs_final:'', liberacion:'CAMPO', acta:actaDe(desde),
    unidad_medida:'', largo:'', espesor:1, fc:1, cantidad:'', observacion:'', editado_por:'', editado_ts:'', _alta:true, _baja:false, _orig:{} };
  FILAS.unshift(r); ordCol=-1; document.getElementById('q').value='';
  pintar(); actualizarDirty();
  const inp=document.querySelector('#cuerpo tr[data-fila="'+cssEsc(r._key)+'"] td.cell[data-k="descripcion"] input'); if(inp) inp.focus();
}
function bajaFila(key){
  const r=filaPorKey(key); if(!r) return;
  if(r._alta){ FILAS=FILAS.filter(function(x){ return x._key!==key; }); }
  else { if(!confirm('¿Eliminar esta fila de DATA ('+(r.descripcion||r.id_registro)+')?')) return; r._baja=true; }
  pintar(); actualizarDirty();
}

/* ---------- selección de rango + copiar/pegar/rellenar ---------- */
document.addEventListener('keydown', function(e){ if(e.key==='Shift') shiftHeld=true; if((e.ctrlKey||e.metaKey)&&(e.key==='d'||e.key==='D')){ e.preventDefault(); rellenarAbajo(); } });
document.addEventListener('keyup', function(e){ if(e.key==='Shift') shiftHeld=false; });
function selDown(key, ci, ev){ focoCelda={key:String(key),ci:ci}; if(ev&&ev.shiftKey&&ancla){ selFoco={key:String(key),ci:ci}; } else { ancla={key:String(key),ci:ci}; selFoco={key:String(key),ci:ci}; } paintSel(); }
function foco(key, ci){ focoCelda={key:String(key),ci:ci}; }
function rectangulo(){
  if(!ancla||!selFoco) return null;
  const orden=filasVisibles().map(function(r){ return String(r._key); });
  const ia=orden.indexOf(ancla.key), ib=orden.indexOf(selFoco.key); if(ia<0||ib<0) return null;
  return { keys:orden.slice(Math.min(ia,ib),Math.max(ia,ib)+1), c0:Math.min(ancla.ci,selFoco.ci), c1:Math.max(ancla.ci,selFoco.ci) };
}
function paintSel(){
  const rc=rectangulo(), dentro={};
  if(rc) rc.keys.forEach(function(k){ for(let c=rc.c0;c<=rc.c1;c++) dentro[k+'|'+c]=true; });
  document.querySelectorAll('#cuerpo td.cell').forEach(function(td){ td.classList.toggle('sel', !!dentro[td.getAttribute('data-key')+'|'+td.getAttribute('data-ci')]); });
}
function valorCelda(key, ci){ const r=filaPorKey(key); return r ? String(r[COLS[ci].k]==null?'':r[COLS[ci].k]) : ''; }
function copiarSel(btn){
  const rc=rectangulo(); let tsv;
  if(rc && (rc.keys.length>1 || rc.c0!==rc.c1)) tsv=rc.keys.map(function(k){ const f=[]; for(let c=rc.c0;c<=rc.c1;c++) f.push(valorCelda(k,c)); return f.join('\t'); }).join('\n');
  else tsv=filasVisibles().map(function(r){ return COLS.map(function(c,ci){ return valorCelda(r._key,ci); }).join('\t'); }).join('\n');
  const ok=function(){ if(btn){ btn.classList.add('copied'); const t=btn.textContent; btn.textContent='✓ Copiado'; setTimeout(function(){ btn.classList.remove('copied'); btn.textContent=t; },1400); } };
  if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(tsv).then(ok,function(){ fallbackCopia(tsv); ok(); }); else { fallbackCopia(tsv); ok(); }
}
function fallbackCopia(txt){ const ta=document.createElement('textarea'); ta.value=txt; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); }catch(e){} document.body.removeChild(ta); }
document.addEventListener('paste', function(e){
  if(!PUEDE_EDITAR || !focoCelda) return;
  const txt=(e.clipboardData||window.clipboardData).getData('text'); if(!txt) return;
  e.preventDefault();
  const grid=txt.replace(/\r/g,'').replace(/\n$/,'').split('\n').map(function(l){ return l.split('\t'); });
  const orden=filasVisibles().map(function(r){ return String(r._key); });
  let ri=orden.indexOf(focoCelda.key); if(ri<0) ri=0; let n=0;
  grid.forEach(function(fila,dr){ const key=orden[ri+dr]; if(key===undefined) return; const r=filaPorKey(key); if(!r) return;
    fila.forEach(function(val,dc){ const ci=focoCelda.ci+dc; if(ci>=COLS.length) return; const k=COLS[ci].k; r[k]=String(val).trim(); n++; });
    Object.assign(r, derivar(r)); });
  if(n){ pintar(); actualizarDirty(); toast('Pegadas '+n+' celda(s).'); }
});
function rellenarAbajo(){
  if(!PUEDE_EDITAR) return;
  const rc=rectangulo(); if(!rc){ toast('Elige la celda o el rango a rellenar.', true); return; }
  const vis=filasVisibles(), mapa={}; vis.forEach(function(r){ mapa[String(r._key)]=r; });
  let n=0;
  const filas = rc.keys.length===1 ? vis.map(function(r){ return String(r._key); }).slice(vis.map(function(r){return String(r._key);}).indexOf(rc.keys[0])) : rc.keys;
  for(let c=rc.c0;c<=rc.c1;c++){ const k=COLS[c].k; const base=filaPorKey(filas[0])[k];
    for(let i=1;i<filas.length;i++){ const r=mapa[filas[i]]; if(r){ r[k]=base; Object.assign(r,derivar(r)); n++; } } }
  if(n){ pintar(); actualizarDirty(); toast('Rellenadas '+n+' celda(s).'); }
}

/* ---------- guardar ---------- */
const CAMPOS_ENVIO = ['fecha','descripcion','elemento','liberacion','largo','espesor','fc','observacion',
  'centro_de_costo','grupo','capitulo','unidad_funcional','proyecto','abs_inicial','abs_final','acta','unidad_medida','orden'];
function payloadFila(r){ const o={}; CAMPOS_ENVIO.forEach(function(k){ o[k]=r[k]; }); return o; }
function dirtyCambios(){
  const out=[];
  FILAS.forEach(function(r){
    if(r._baja && !r._alta){ out.push({ op:'baja', id_registro:r.id_registro, if_version:r.version }); return; }
    if(r._baja) return;
    if(r._alta){ const o=payloadFila(r); o.op='alta'; o.id_registro='jefe-'+(window.crypto&&crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2)); out.push(o); return; }
    if(esDirty(r)){ const o=payloadFila(r); o.op='update'; o.id_registro=r.id_registro; o.if_version=r.version; out.push(o); }
  });
  return out;
}
function actualizarDirty(){ const n=dirtyCambios().length; const b=document.getElementById('btnGuardar'), c=document.getElementById('nDirty'); if(c) c.textContent=n; if(b) b.disabled=n===0; }
async function guardar(btn){
  const cambios=dirtyCambios(); if(!cambios.length){ toast('No hay cambios que guardar.'); return; }
  if(btn) btn.disabled=true;
  const desde=document.getElementById('desde').value, hasta=document.getElementById('hasta').value||desde;
  let d; try{ d=await api(null, { action:'data_grid_guardar', desde:desde, hasta:hasta, cambios:cambios }); }catch(e){ d={ok:false,error:'Sin conexión.'}; }
  if(caducada(d)) return;
  if(d && d.ok){ aplicarModelo(d); toast(d.mensaje||('Guardados '+cambios.length+' cambio(s).')); return; }
  if(btn) btn.disabled=false;
  if(d && d.error==='version'){ aplicarModelo(d); toast(d.mensaje||'Otra persona editó algunas filas; se recargaron.', true); return; }
  if(d && d.error==='payload'){ toast('Dato inválido en «'+(d.campo||'')+'»: '+(d.detalle||''), true); return; }
  toast((d&&d.error)||'No se guardó.', true);
}

/* ---------- arranque ---------- */
(function(){ const p=periodoDeHoy(); document.getElementById('desde').value=p.desde; document.getElementById('hasta').value=p.hasta; cargar(p.desde, p.hasta); })();
