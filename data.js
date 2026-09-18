/* ============================================================================
 * REVISIÓN DE DATA (V3-08b / D181) — hoja DATA editable tipo Excel.
 * El jefe/residente corrige o añade el reporte diario al cierre. Elige
 * descripción (actividad) y subtramo; el sistema deriva CC, grupo, capítulo, UF,
 * abscisas, acta y cantidad = largo×espesor÷fc, igual que las fórmulas del Excel.
 *
 * Interacción de hoja de cálculo (D181, feedback del dueño): un clic SELECCIONA
 * la celda (no obliga a editar); se navega con FLECHAS; se marca un rango con
 * Shift+flechas o Shift+clic; se copia/pega y se rellena hacia abajo sobre la
 * selección; se edita con doble clic, Enter/F2 o escribiendo. CSP D170: los
 * eventos se enganchan por JS (addEventListener), no inline.
 * ==========================================================================*/
if(window.TM2Estilos) TM2Estilos.aplicar();
// Modo EMBED (dentro del Hub del Jefe, V3-10): oculta la cabecera propia. Sin ?embed=1 no cambia nada.
try{ if(new URLSearchParams(location.search).get('embed')==='1') document.documentElement.classList.add('embed'); }catch(e){}

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
function normNom(s){ return String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toLowerCase(); }
function hoyBogota(){ return new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'}); }

/* ---------- estado ---------- */
let COLS=[], FILAS=[], VIS=[];
let ACT_BY={}, EL_BY={}, PERIODOS=[], LIB_OPC=[''];
let tempSeq=0;
let act=null, anc=null, editando=null;    // celda activa / ancla del rango / edición en curso
let undoStack=[], redoStack=[];            // deshacer / rehacer (Ctrl+Z / Ctrl+Y)
const DRIVERS = ['fecha','descripcion','elemento','largo','espesor','fc'];

/* ---------- rango por defecto: periodo 16→15 que contiene hoy ---------- */
function periodoDeHoy(){
  const h=hoyBogota(); const y=+h.slice(0,4), m=+h.slice(5,7), d=+h.slice(8,10);
  const fin=new Date(Date.UTC(y,m-1,15)); let ini=new Date(Date.UTC(y,m-2,16));
  if(d>=16){ ini=new Date(Date.UTC(y,m-1,16)); fin.setUTCMonth(fin.getUTCMonth()+1); }
  const iso=(dt)=>dt.toISOString().slice(0,10);
  return { desde:iso(ini), hasta:iso(fin) };
}

/* ---------- derivación local (espejo del server) ---------- */
function actaDe(fecha){ for(let i=0;i<PERIODOS.length;i++){ const p=PERIODOS[i]; if(fecha>=p.fi && fecha<=p.ff) return p.acta; } return ''; }
function derivar(r){
  const el=EL_BY[normNom(r.elemento)]||null;
  const uf=el?String(el.uf||''):String(r.unidad_funcional||'');
  const a=ACT_BY[normNom(r.descripcion)+'|'+uf.toUpperCase()]||null;
  const cc=a?a.cc:String(r.centro_de_costo||'');
  const L=num(r.largo), E=num(r.espesor), F=num(r.fc);
  const cant=(L==null)?(r.cantidad===''?'':num(r.cantidad)):Math.round(L*(E==null?1:E)/((F==null||F===0)?1:F)*1e6)/1e6;
  return { unidad_funcional:uf, centro_de_costo:cc, grupo:a?a.grupo:r.grupo, capitulo:a?a.capitulo:r.capitulo,
    unidad_medida:a?a.unidad:r.unidad_medida, orden:a?String(a.orden||''):r.orden, proyecto:a?a.proyecto:r.proyecto,
    abs_inicial:el?String(el.abs_inicio||''):r.abs_inicial, abs_final:el?String(el.abs_fin||''):r.abs_final,
    acta:actaDe(r.fecha)||r.acta, cantidad:(cant===null?'':cant) };
}

/* ---------- carga ---------- */
function consultar(){ const d=document.getElementById('desde').value, h=document.getElementById('hasta').value; if(!d){ toast('Elige la fecha «desde».', true); return; } cargar(d,h||d); }
async function cargar(desde, hasta){
  document.getElementById('cuerpo').innerHTML='<tr><td class="vacio">Cargando…</td></tr>';
  const d=await api(APPS_SCRIPT_URL+'?action=data_grid&desde='+encodeURIComponent(desde)+'&hasta='+encodeURIComponent(hasta));
  if(caducada(d)) return;
  if(!d.ok){ toast(d.error||'No se pudo cargar', true); document.getElementById('cuerpo').innerHTML='<tr><td class="vacio">—</td></tr>'; return; }
  aplicarModelo(d);
}
async function recargar(){ if(dirtyCambios().length && !confirm('Hay cambios sin guardar. ¿Descartarlos y recargar?')) return; const d=document.getElementById('desde').value, h=document.getElementById('hasta').value; if(d) cargar(d,h||d); }
function aplicarModelo(d){
  COLS=d.columnas||[]; LIB_OPC=d.liberacion_opciones||['']; PERIODOS=d.periodos||[];
  ACT_BY={}; (d.actividades||[]).forEach(function(a){ ACT_BY[normNom(a.descripcion)+'|'+String(a.uf||'').toUpperCase()]={cc:a.cc,capitulo:a.capitulo,grupo:a.grupo,unidad:a.unidad,proyecto:a.proyecto,orden:a.orden}; });
  EL_BY={}; (d.subtramos||[]).forEach(function(e){ EL_BY[normNom(e.elemento)]={uf:e.uf,abs_inicio:e.abs_inicio,abs_fin:e.abs_fin}; });
  document.getElementById('dlDesc').innerHTML=(d.actividades||[]).map(function(a){ return '<option value="'+esc(a.descripcion)+'">'+esc((a.uf||'')+' · '+a.cc)+'</option>'; }).join('');
  document.getElementById('dlElem').innerHTML=(d.subtramos||[]).map(function(e){ return '<option value="'+esc(e.elemento)+'">'+esc(e.uf||'')+'</option>'; }).join('');
  FILAS=(d.filas||[]).map(function(r){ const o=Object.assign({},r); o._key=r.id_registro; o._orig=Object.assign({},r); o._alta=false; o._baja=false; return o; });
  act=anc=editando=null; undoStack=[]; redoStack=[]; actualizarUndoBtns();
  if(document.getElementById('desde').value!==d.desde){ document.getElementById('desde').value=d.desde; document.getElementById('hasta').value=d.hasta; }
  pintarCab(); pintar();
  ['btnAlta','btnFill','btnUndo','btnRedo','btnGuardar'].forEach(function(id){ const b=document.getElementById(id); if(b) b.style.display=PUEDE_EDITAR?'inline-block':'none'; });
  actualizarDirty();
}

/* ---------- render ---------- */
let ordCol=-1, ordDir=1;
function ordenarPor(i){ if(ordCol===i){ ordDir=-ordDir; } else { ordCol=i; ordDir=1; } pintar(); }
function pintarCab(){
  let h='<th class="rownum">#</th>';
  COLS.forEach(function(c,i){ h+='<th data-k="'+c.k+'" data-on-click="ordenarPor('+i+')" title="'+(c.edita?'editable':'calculado')+'">'+esc(c.etiqueta)+(ordCol===i?(ordDir>0?' ▲':' ▼'):'')+'</th>'; });
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
function disp(r, c){ const v=r[c.k]; if(v===''||v==null) return ''; if(c.tipo==='num' && c.k==='cantidad') return fmt(v); return String(v); }
function celHTML(r, c, ci, ri){
  const cls='cell'+(c.edita?'':' deriv')+(c.tipo==='num'?' num':'')+' col-'+c.k;
  const d=disp(r,c);
  return '<td class="'+cls+'" data-r="'+ri+'" data-c="'+ci+'" data-k="'+c.k+'"><div class="cv" title="'+esc(d)+'">'+esc(d)+'</div></td>';
}
function filaHTML(r, ri){
  const sinCC=!String(r.centro_de_costo||'').trim();
  let h='<tr data-r="'+ri+'" data-fila="'+esc(r._key)+'" class="'+(esDirty(r)?'dirty ':'')+(sinCC?'sincc':'')+'">';
  h+='<td class="rownum">'+(r._alta?'+':(ri+1))+'</td>';
  COLS.forEach(function(c,ci){ h+=celHTML(r,c,ci,ri); });
  if(PUEDE_EDITAR) h+='<td class="rownum acc"><button class="xbtn" title="Eliminar fila" data-on-click="bajaFila(\''+esc(r._key)+'\')">✕</button></td>';
  return h+'</tr>';
}
function pintar(){
  VIS=filasVisibles();
  const cuerpo=document.getElementById('cuerpo');
  cuerpo.innerHTML = VIS.length ? VIS.map(filaHTML).join('') : '<tr><td class="vacio" colspan="'+(COLS.length+2)+'">Sin filas en el rango.</td></tr>';
  if(act && act.r>=VIS.length) act=anc=null;
  pintarKPIs(); aplicaSel();
}

/* ---------- selección / navegación (modo hoja de cálculo) ---------- */
function tdDe(r,c){ return document.querySelector('#cuerpo td.cell[data-r="'+r+'"][data-c="'+c+'"]'); }
function setActiva(r,c,extender,scroll){
  if(!VIS.length || !COLS.length) return;
  r=Math.max(0,Math.min(r,VIS.length-1)); c=Math.max(0,Math.min(c,COLS.length-1));
  act={r:r,c:c}; if(!extender||!anc) anc={r:r,c:c};
  aplicaSel();
  // Scroll SOLO en navegación por teclado: hacerlo en cada clic desplaza el contenedor entre los dos
  // clics de un doble-clic y el segundo cae en otra fila.
  if(scroll){ const td=tdDe(r,c); if(td && td.scrollIntoView) td.scrollIntoView({block:'nearest',inline:'nearest'}); }
}
function mover(dr,dc,extender){ if(!act){ setActiva(0,0,false,true); return; } setActiva(act.r+dr, act.c+dc, extender, true); }
function rango(){ if(!act||!anc) return null; return { r0:Math.min(act.r,anc.r), r1:Math.max(act.r,anc.r), c0:Math.min(act.c,anc.c), c1:Math.max(act.c,anc.c) }; }
function aplicaSel(){
  const rc=rango();
  document.querySelectorAll('#cuerpo td.cell').forEach(function(td){
    const r=+td.dataset.r, c=+td.dataset.c;
    td.classList.toggle('sel', !!rc && r>=rc.r0 && r<=rc.r1 && c>=rc.c0 && c<=rc.c1);
    td.classList.toggle('activa', !!act && r===act.r && c===act.c);
  });
}

/* ---------- edición ---------- */
function beginEdit(r,c,inicial){
  if(!PUEDE_EDITAR) return;
  setActiva(r,c,false,false);
  const col=COLS[c], row=VIS[r], td=tdDe(r,c); if(!td) return;
  editando={r:r,c:c};
  let el;
  if(col.tipo==='lista'){
    el=document.createElement('select'); el.className='editor';
    (col.opciones||LIB_OPC).forEach(function(o){ const op=document.createElement('option'); op.value=o; op.textContent=o||'—'; if(String(row[col.k]||'')===o) op.selected=true; el.appendChild(op); });
  } else {
    el=document.createElement('input'); el.type=(col.tipo==='fecha')?'date':'text'; el.className='editor';
    if(col.tipo==='num') el.classList.add('num');
    if(col.tipo==='lista_desc') el.setAttribute('list','dlDesc');
    if(col.tipo==='lista_elem') el.setAttribute('list','dlElem');
    el.value = (inicial!==undefined && inicial!==null) ? inicial : (row[col.k]==null?'':row[col.k]);
  }
  td.classList.add('editando'); const cv=td.querySelector('.cv'); if(cv) cv.style.display='none'; td.appendChild(el);
  el.focus(); if(el.select && col.tipo!=='fecha' && inicial===undefined) el.select();
  el.addEventListener('keydown', function(ev){
    if(ev.key==='Enter'){ ev.preventDefault(); commitEdit(1,0); }
    else if(ev.key==='Tab'){ ev.preventDefault(); commitEdit(0, ev.shiftKey?-1:1); }
    else if(ev.key==='Escape'){ ev.preventDefault(); cancelEdit(); }
    ev.stopPropagation();
  });
  el.addEventListener('blur', function(){ if(editando) commitEdit(0,0); });
  if(col.tipo==='lista' || col.tipo==='fecha') el.addEventListener('change', function(){ /* commit al Enter/blur */ });
}
function commitEdit(dr,dc){
  if(!editando) return;
  const {r,c}=editando; const td=tdDe(r,c); const el=td&&td.querySelector('.editor');
  const val=el?el.value:'';
  editando=null;
  if(td){ const ed=td.querySelector('.editor'); if(ed) ed.remove(); const cv=td.querySelector('.cv'); if(cv) cv.style.display=''; td.classList.remove('editando'); }
  const row0=VIS[r], k0=COLS[c]&&COLS[c].k;
  if(row0 && k0 && String(row0[k0]==null?'':row0[k0])!==String(val)) pushUndo();
  setValor(r,c,val);
  const wrap=document.getElementById('wrap'); if(wrap) wrap.focus({preventScroll:true});
  if(dr||dc) mover(dr,dc,false);
}
function cancelEdit(){
  if(!editando) return; const {r,c}=editando; const td=tdDe(r,c); editando=null;
  if(td){ const ed=td.querySelector('.editor'); if(ed) ed.remove(); const cv=td.querySelector('.cv'); if(cv) cv.style.display=''; td.classList.remove('editando'); }
  const wrap=document.getElementById('wrap'); if(wrap) wrap.focus({preventScroll:true});
}
function setValor(r,c,val){
  const row=VIS[r], k=COLS[c].k; if(!row) return;
  if(String(row[k]==null?'':row[k])===String(val)) { refrescarFila(r); return; }
  row[k]=val;
  if(DRIVERS.indexOf(k)>=0) Object.assign(row, derivar(row));
  refrescarFila(r); pintarKPIs(); actualizarDirty();
}
function refrescarFila(r){
  const row=VIS[r], tr=document.querySelector('#cuerpo tr[data-r="'+r+'"]'); if(!tr) return;
  COLS.forEach(function(c,ci){ const cv=tr.querySelector('td[data-c="'+ci+'"] .cv'); if(cv){ const d=disp(row,c); cv.textContent=d; cv.title=d; } });
  tr.classList.toggle('dirty', esDirty(row)); tr.classList.toggle('sincc', !String(row.centro_de_costo||'').trim());
}

/* ---------- deshacer / rehacer (Ctrl+Z / Ctrl+Y) ----------
 * Una pila de instantáneas de FILAS (JSON) antes de cada acción que muta: editar,
 * pegar, rellenar, vaciar, añadir y eliminar fila. Ctrl+Z restaura la anterior; Ctrl+Y
 * (o Ctrl+Shift+Z) rehace. No se toca el deshacer nativo cuando el foco está en un campo. */
function snapEstado(){ return JSON.stringify(FILAS); }
function pushUndo(){ undoStack.push(snapEstado()); if(undoStack.length>80) undoStack.shift(); redoStack.length=0; actualizarUndoBtns(); }
function restaurar(js){ FILAS=JSON.parse(js); act=anc=editando=null; pintar(); actualizarDirty(); actualizarUndoBtns(); }
function deshacer(){ if(!undoStack.length){ toast('Nada que deshacer.'); return; } redoStack.push(snapEstado()); restaurar(undoStack.pop()); toast('Deshecho.'); }
function rehacer(){ if(!redoStack.length){ toast('Nada que rehacer.'); return; } undoStack.push(snapEstado()); restaurar(redoStack.pop()); toast('Rehecho.'); }
function actualizarUndoBtns(){ const u=document.getElementById('btnUndo'), r=document.getElementById('btnRedo'); if(u) u.disabled=!undoStack.length; if(r) r.disabled=!redoStack.length; }

/* ---------- teclado + eventos de la tabla ---------- */
function montarEventos(){
  const cuerpo=document.getElementById('cuerpo'), wrap=document.getElementById('wrap');
  cuerpo.addEventListener('mousedown', function(ev){
    const td=ev.target.closest && ev.target.closest('td.cell'); if(!td) return;
    if(ev.target.closest('.editor')) return;   // clic dentro del editor
    ev.preventDefault();
    if(editando) commitEdit(0,0);
    if(wrap) wrap.focus({preventScroll:true});
    setActiva(+td.dataset.r, +td.dataset.c, ev.shiftKey, false);
  });
  cuerpo.addEventListener('dblclick', function(ev){ const td=ev.target.closest && ev.target.closest('td.cell'); if(td) beginEdit(+td.dataset.r,+td.dataset.c); });
  wrap.addEventListener('keydown', function(ev){
    if(editando) return;
    if(!act){ if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].indexOf(ev.key)>=0){ setActiva(0,0,false); ev.preventDefault(); } return; }
    const k=ev.key, ctrl=ev.ctrlKey||ev.metaKey;
    if(ctrl && (k==='c'||k==='C')){ return; }        // lo maneja el evento 'copy'
    if(ctrl && (k==='v'||k==='V')){ return; }         // lo maneja el evento 'paste'
    if(ctrl && (k==='d'||k==='D')){ ev.preventDefault(); rellenar(); return; }
    if(k==='ArrowUp'){ ev.preventDefault(); mover(-1,0,ev.shiftKey); }
    else if(k==='ArrowDown'){ ev.preventDefault(); mover(1,0,ev.shiftKey); }
    else if(k==='ArrowLeft'){ ev.preventDefault(); mover(0,-1,ev.shiftKey); }
    else if(k==='ArrowRight'){ ev.preventDefault(); mover(0,1,ev.shiftKey); }
    else if(k==='Tab'){ ev.preventDefault(); mover(0, ev.shiftKey?-1:1, false); }
    else if(k==='Enter'){ ev.preventDefault(); beginEdit(act.r,act.c); }
    else if(k==='F2'){ ev.preventDefault(); beginEdit(act.r,act.c); }
    else if(k==='Delete'||k==='Backspace'){ ev.preventDefault(); borrarSeleccion(); }
    else if(k.length===1 && !ctrl && !ev.altKey){ ev.preventDefault(); beginEdit(act.r,act.c,k); }
  });
  document.addEventListener('copy', function(ev){ if(editando) return; if(!enGrid()) return; const t=tsvSeleccion(); if(t==null) return; ev.preventDefault(); ev.clipboardData.setData('text/plain', t); });
  document.addEventListener('paste', function(ev){ if(editando || !PUEDE_EDITAR) return; if(!enGrid()) return; const t=(ev.clipboardData||window.clipboardData).getData('text'); if(!t) return; ev.preventDefault(); pegar(t); });
  document.addEventListener('keydown', function(ev){
    const ctrl=ev.ctrlKey||ev.metaKey; if(!ctrl) return;
    const k=(ev.key||'').toLowerCase(); if(k!=='z' && k!=='y') return;
    if(editando) return;                                   // respeta el deshacer nativo del editor abierto
    const ae=document.activeElement;                       // ni el de los campos (fecha, búsqueda)
    if(ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
    if(!PUEDE_EDITAR) return;
    ev.preventDefault();
    if(k==='y' || (k==='z' && ev.shiftKey)) rehacer(); else deshacer();
  });
}
function enGrid(){ const w=document.getElementById('wrap'); return !!(w && (document.activeElement===w || (act && w.contains(document.activeElement)))); }

/* ---------- copiar / pegar / rellenar / borrar (sobre el rango) ---------- */
function tsvSeleccion(){ const rc=rango(); if(!rc) return null;
  const fs=[]; for(let r=rc.r0;r<=rc.r1;r++){ const cells=[]; for(let c=rc.c0;c<=rc.c1;c++){ const row=VIS[r]; cells.push(row?String(row[COLS[c].k]==null?'':row[COLS[c].k]):''); } fs.push(cells.join('\t')); } return fs.join('\n');
}
function copiarSel(btn){
  let t=tsvSeleccion();
  if(t==null) t=VIS.map(function(r){ return COLS.map(function(c){ return String(r[c.k]==null?'':r[c.k]); }).join('\t'); }).join('\n');
  const ok=function(){ if(btn){ btn.classList.add('copied'); const x=btn.textContent; btn.textContent='✓ Copiado'; setTimeout(function(){ btn.classList.remove('copied'); btn.textContent=x; },1400); } toast('Copiado.'); };
  if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok,function(){ fb(t); ok(); }); else { fb(t); ok(); }
  function fb(x){ const ta=document.createElement('textarea'); ta.value=x; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); }catch(e){} document.body.removeChild(ta); }
}
function pegar(txt){
  if(!act) return;
  const grid=txt.replace(/\r/g,'').replace(/\n$/,'').split('\n').map(function(l){ return l.split('\t'); });
  pushUndo();
  let n=0;
  for(let dr=0;dr<grid.length;dr++){ const r=act.r+dr; if(r>=VIS.length) break;
    for(let dc=0;dc<grid[dr].length;dc++){ const c=act.c+dc; if(c>=COLS.length) break; setValor(r,c,grid[dr][dc].trim()); n++; } }
  if(n) toast('Pegadas '+n+' celda(s).');
}
function rellenar(){
  const rc=rango(); if(!rc){ toast('Elige la celda o el rango a rellenar.', true); return; }
  pushUndo();
  let n=0;
  if(rc.r0===rc.r1){ // una fila seleccionada → rellena su valor a TODAS las de abajo (por columna del rango)
    for(let c=rc.c0;c<=rc.c1;c++){ const base=VIS[rc.r0][COLS[c].k]; for(let r=rc.r0+1;r<VIS.length;r++){ setValor(r,c,base); n++; } }
  } else {
    for(let c=rc.c0;c<=rc.c1;c++){ const base=VIS[rc.r0][COLS[c].k]; for(let r=rc.r0+1;r<=rc.r1;r++){ setValor(r,c,base); n++; } }
  }
  if(n) toast('Rellenadas '+n+' celda(s).');
}
function borrarSeleccion(){ const rc=rango(); if(!rc) return; pushUndo(); let n=0;
  for(let r=rc.r0;r<=rc.r1;r++) for(let c=rc.c0;c<=rc.c1;c++){ setValor(r,c,''); n++; } if(n) toast('Vaciadas '+n+' celda(s).'); }

/* ---------- KPIs ---------- */
function pintarKPIs(){
  document.getElementById('kFilas').textContent=VIS.length;
  let suma=0, sincc=0;
  VIS.forEach(function(r){ const n=num(r.cantidad); if(n!=null) suma+=n; if(!String(r.centro_de_costo||'').trim()) sincc++; });
  document.getElementById('kCant').textContent=fmt(suma);
  document.getElementById('kSinCC').textContent=sincc;
}
function esDirty(r){ if(r._alta||r._baja) return true; return COLS.some(function(c){ return String(r[c.k]==null?'':r[c.k])!==String(r._orig[c.k]==null?'':r._orig[c.k]); }); }

/* ---------- alta / baja ---------- */
function filaPorKey(k){ return FILAS.filter(function(r){ return String(r._key)===String(k); })[0]||null; }
function altaFila(){
  pushUndo();
  const desde=document.getElementById('desde').value||hoyBogota();
  const r={ _key:'nuevo-'+(++tempSeq), id_registro:'', version:0, fecha:desde, orden:'', grupo:'', centro_de_costo:'', capitulo:'',
    descripcion:'', unidad_funcional:'', proyecto:'', elemento:'', abs_inicial:'', abs_final:'', liberacion:'CAMPO', acta:actaDe(desde),
    unidad_medida:'', largo:'', espesor:1, fc:1, cantidad:'', observacion:'', editado_por:'', editado_ts:'', _alta:true, _baja:false, _orig:{} };
  FILAS.unshift(r); ordCol=-1; document.getElementById('q').value='';
  pintar(); actualizarDirty(); setActiva(0,0,false); beginEdit(0, COLS.findIndex(function(c){return c.k==='descripcion';}));
}
function bajaFila(key){
  const r=filaPorKey(key); if(!r) return;
  if(r._alta){ pushUndo(); FILAS=FILAS.filter(function(x){ return x._key!==key; }); }
  else { if(!confirm('¿Eliminar esta fila de DATA ('+(r.descripcion||r.id_registro)+')?')) return; pushUndo(); r._baja=true; }
  pintar(); actualizarDirty();
}

/* ---------- guardar ---------- */
const CAMPOS_ENVIO=['fecha','descripcion','elemento','liberacion','largo','espesor','fc','observacion','centro_de_costo','grupo','capitulo','unidad_funcional','proyecto','abs_inicial','abs_final','acta','unidad_medida','orden'];
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
function actualizarDirty(){ const n=dirtyCambios().length; const b=document.getElementById('btnGuardar'), c=document.getElementById('nDirty'); if(c) c.textContent=n; if(b) b.disabled=n===0;
  try{ if(window.parent!==window) window.parent.postMessage({tm2:'dirty', page:'data', n:n}, location.origin); }catch(e){} }
async function guardar(btn){
  if(editando) commitEdit(0,0);
  const cambios=dirtyCambios(); if(!cambios.length){ toast('No hay cambios que guardar.'); return; }
  if(btn) btn.disabled=true;
  const desde=document.getElementById('desde').value, hasta=document.getElementById('hasta').value||desde;
  let d; try{ d=await api(null,{ action:'data_grid_guardar', desde:desde, hasta:hasta, cambios:cambios }); }catch(e){ d={ok:false,error:'Sin conexión.'}; }
  if(caducada(d)) return;
  if(d && d.ok){ aplicarModelo(d); toast(d.mensaje||('Guardados '+cambios.length+' cambio(s).')); return; }
  if(btn) btn.disabled=false;
  if(d && d.error==='version'){ aplicarModelo(d); toast(d.mensaje||'Otra persona editó algunas filas; se recargaron.', true); return; }
  if(d && d.error==='payload'){ toast('Dato inválido en «'+(d.campo||'')+'»: '+(d.detalle||''), true); return; }
  toast((d&&d.error)||'No se guardó.', true);
}

/* ---------- arranque ---------- */
montarEventos();
(function(){
  let desde, hasta; try{ const u=new URLSearchParams(location.search); desde=u.get('desde'); hasta=u.get('hasta'); }catch(e){}
  if(!desde){ const p=periodoDeHoy(); desde=p.desde; hasta=p.hasta; }
  document.getElementById('desde').value=desde; document.getElementById('hasta').value=hasta||desde; cargar(desde, hasta||desde);
})();
