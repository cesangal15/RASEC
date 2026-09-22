/* ============================================================================
 * GRILLA DE CATÁLOGOS (V3-08 / D181) — edición tipo Excel directa contra Supabase.
 * Subtramos (BASE) editable; centros de coste en solo lectura (por ahora).
 * Fuente única de edición: aquí se EDITA, los demás consumidores solo leen (D181).
 *
 * Excel-like: edición en celda, selección de rango (clic + Shift), copiar/pegar en
 * varias a la vez, rellenar hacia abajo (Ctrl+D). Validación y control de versión
 * por fila (if_version) los pone el Worker; el cliente solo previsualiza.
 * CSP D170: nada de onclick/style en línea; data-on-* + funciones globales.
 * ==========================================================================*/
if(window.TM2Estilos) TM2Estilos.aplicar();
// Modo EMBED (dentro del Hub del Jefe, V3-10): oculta la cabecera propia. Sin ?embed=1 no cambia nada.
try{ if(new URLSearchParams(location.search).get('embed')==='1') document.documentElement.classList.add('embed'); }catch(e){}

const APPS_SCRIPT_URL = GALCA_ENV.url.obra;         // entorno.js (D168): producción o prueba
const ROLES_VER   = ['admin','jefe','residente'];   // quién ENTRA a la grilla
const ROLES_EDIT  = ['admin','jefe','residente'];   // quién EDITA (el servidor manda; D181)
const USUARIOS_OK = ['jeisson'];
const VOLVER = { admin:'menu.html', jefe:'hub-jefe.html', residente:'residente.html' };

/* ---------- sesión (D109) ---------- */
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

/* ---------- helpers de subtramos (espejo de catalogos.js/baseTipo/baseAbs) ---------- */
function pkMeters(s){ const m=String(s).match(/(-?\d+)\+(\d+(?:\.\d+)?)/); if(!m) return null; return Number(m[1])*1000+Number(m[2]); }
function absM(v){ if(v===''||v==null) return null; const s=String(v).trim(); if(s.indexOf('+')>=0) return pkMeters(s); const n=Number(s); return isNaN(n)?null:n; }
function baseTipo(e){ e=String(e||''); if(/^\s*tm2\s*pk/i.test(e))return'TRAMO'; if(/diviso/i.test(e))return'DIVISO'; if(/^\s*msr/i.test(e))return'MSR'; if(/^\s*rcd/i.test(e))return'RCD'; if(/zodme/i.test(e))return'ZODME'; if(/^\s*odt/i.test(e))return'ODT'; return''; }
function esNoOp(e,f){ return f===true || /^\s*ajuste\s*origen/i.test(String(e||'')); }
function esLineal(t){ return t==='TRAMO'||t==='MSR'; }
function normNom(s){ return String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toLowerCase(); }

/* ---------- estado ---------- */
let TABLA='subtramos';
let COLS=[];                 // columnas editables (metadatos del server)
let FILAS=[];                // filas de trabajo (objetos con _key, valores vivos y _orig)
let ANALISIS={overlaps:[],duplicados:[],tope:{},no_operativos:[]};
let tempSeq=-1;              // _key de las filas nuevas (alta): -1, -2, …
let shiftHeld=false, ancla=null, selFoco=null, focoCelda=null;   // selección {key,ci}

const EDIT_SUB=[
  {k:'elemento',     et:'Elemento',   tipo:'texto'},
  {k:'abs_inicio',   et:'Abs inicio', tipo:'texto'},
  {k:'abs_fin',      et:'Abs fin',    tipo:'texto'},
  {k:'uf',           et:'UF',         tipo:'lista', op:['','UF1','UF2']},
  {k:'no_operativo', et:'No oper.',   tipo:'bool'}
];

/* ---------- carga ---------- */
async function cargar(){
  const d = await api(APPS_SCRIPT_URL+'?action=grid&tabla='+encodeURIComponent(TABLA));
  if(caducada(d)) return;
  if(!d.ok){ toast(d.error||'No se pudo cargar', true); return; }
  aplicarModelo(d);
}
function aplicarModelo(d){
  COLS = d.columnas||[];
  ANALISIS = d.analisis || {overlaps:[],duplicados:[],tope:{},no_operativos:[]};
  FILAS = (d.filas||[]).map(function(r){
    const o = Object.assign({}, r);
    o._key = (TABLA==='subtramos') ? r.orden : r.orden;
    o._orig = Object.assign({}, r);
    o._alta = false; o._baja = false;
    return o;
  });
  ancla=selFoco=focoCelda=null;
  pintarCab(); pintar();
  const puede = PUEDE_EDITAR && d.editable;
  ['btnAlta','btnFill','btnGuardar'].forEach(function(id){ const b=document.getElementById(id); if(b) b.style.display = puede ? 'inline-block' : 'none'; });
  actualizarDirty();
}

async function recargar(){ if(dirtyCambios().length && !confirm('Hay cambios sin guardar. ¿Descartarlos y recargar?')) return; await cargar(); }
function verTabla(t){
  if(t===TABLA) return;
  if(dirtyCambios().length && !confirm('Hay cambios sin guardar. ¿Descartarlos y cambiar de tabla?')) return;
  TABLA=t;
  document.getElementById('tabSub').classList.toggle('on', t==='subtramos');
  document.getElementById('tabCC').classList.toggle('on', t==='centros_costo');
  document.getElementById('fUFbox').style.display = (t==='subtramos')?'':'none';
  document.getElementById('fNoOpBox').style.display = (t==='subtramos')?'':'none';
  cargar();
}

/* ---------- render ---------- */
function pintarCab(){
  const cab=document.getElementById('cab');
  let h='<th class="rownum">#</th>';
  COLS.forEach(function(c,i){ h+='<th data-on-click="ordenarPor('+i+')">'+esc(c.etiqueta)+'<span class="ord" id="ord'+i+'"></span></th>'; });
  if(PUEDE_EDITAR && TABLA==='subtramos') h+='<th class="rownum"></th>';
  cab.innerHTML=h;
}
let ordCol=-1, ordDir=1;
function ordenarPor(i){ if(ordCol===i){ ordDir=-ordDir; } else { ordCol=i; ordDir=1; } pintar(); }

function filasVisibles(){
  const q = normNom(document.getElementById('q').value);
  const fUF = (document.getElementById('fUF').value||'');
  const verNoOp = document.getElementById('fNoOp').checked;
  let vis = FILAS.filter(function(r){ return !r._baja; });
  if(TABLA==='subtramos'){
    vis = vis.filter(function(r){
      if(fUF && String(r.uf||'')!==fUF) return false;
      if(!verNoOp && esNoOp(r.elemento, r.no_operativo)) return false;
      return true;
    });
  }
  if(q){
    vis = vis.filter(function(r){ return COLS.some(function(c){ return normNom(r[c.k]).indexOf(q)>=0; }); });
  }
  if(ordCol>=0 && COLS[ordCol]){
    const k=COLS[ordCol].k;
    vis = vis.slice().sort(function(a,b){
      let va=a[k], vb=b[k];
      const na=Number(absM(va)), nb=Number(absM(vb));
      if(!isNaN(na) && !isNaN(nb) && (k==='abs_inicio'||k==='abs_fin')){ return (na-nb)*ordDir; }
      va=normNom(va); vb=normNom(vb); return (va<vb?-1:va>vb?1:0)*ordDir;
    });
  }
  return vis;
}

function pintar(){
  if(TABLA==='subtramos') recomputar();
  const vis=filasVisibles();
  const cuerpo=document.getElementById('cuerpo');
  if(!vis.length){ cuerpo.innerHTML='<tr><td class="vacio" colspan="'+(COLS.length+2)+'">Sin filas.</td></tr>'; }
  else if(TABLA==='subtramos'){ cuerpo.innerHTML = vis.map(filaSubHTML).join(''); }
  else { cuerpo.innerHTML = vis.map(filaCCHTML).join(''); }
  pintarKPIs(); pintarAvisos(); paintSel();
}

function filaSubHTML(r){
  const noop = esNoOp(r.elemento, r.no_operativo);
  const ro = PUEDE_EDITAR ? '' : ' readonly disabled';
  let h='<tr data-fila="'+r._key+'" class="'+(esDirty(r)?'dirty ':'')+(noop?'noop':'')+'">';
  h+='<td class="rownum">'+(r._alta?'nuevo':esc(String(r.orden)))+'</td>';
  EDIT_SUB.forEach(function(c,ci){
    const val=r[c.k];
    const td='<td class="cell'+(c.tipo==='bool'?' bool':'')+'" data-key="'+r._key+'" data-ci="'+ci+'" data-on-mousedown="selDown('+r._key+','+ci+',event)">';
    if(c.tipo==='bool'){
      h+=td+'<input type="checkbox" '+(val?'checked':'')+ro+' data-on-change="cel('+r._key+",'"+c.k+"',this)\" data-on-focus=\"foco("+r._key+','+ci+')"></td>';
    } else if(c.tipo==='lista'){
      let ops=c.op.map(function(o){ return '<option value="'+esc(o)+'"'+(String(val||'')===o?' selected':'')+'>'+esc(o||'—')+'</option>'; }).join('');
      h+=td+'<select class="cin"'+ro+' data-on-change="cel('+r._key+",'"+c.k+"',this)\" data-on-focus=\"foco("+r._key+','+ci+')">'+ops+'</select></td>';
    } else {
      h+=td+'<input class="cin" type="text" value="'+esc(val==null?'':val)+'"'+ro+' data-on-input="cel('+r._key+",'"+c.k+"',this)\" data-on-focus=\"foco("+r._key+','+ci+')"></td>';
    }
  });
  h+='<td class="derivada" data-tipo="'+r._key+'">'+esc(baseTipo(r.elemento)||'—')+'</td>';
  if(PUEDE_EDITAR) h+='<td class="rownum"><button class="btn mini" title="Eliminar fila" data-on-click="bajaFila('+r._key+')">✕</button></td>';
  h+='</tr>';
  return h;
}
function filaCCHTML(r){
  let h='<tr><td class="rownum">'+esc(String(r.orden||''))+'</td>';
  COLS.forEach(function(c){ h+='<td class="derivada">'+esc(r[c.k]==null?'':r[c.k])+'</td>'; });
  return h+'</tr>';
}

/* ---------- edición en celda (sin repintar: preserva foco) ---------- */
function filaPorKey(k){ return FILAS.filter(function(r){ return r._key===k; })[0] || null; }
function cel(key, campo, el){
  const r=filaPorKey(key); if(!r) return;
  r[campo] = (campo==='no_operativo') ? !!el.checked : el.value;
  if(campo==='elemento'){ const td=document.querySelector('[data-tipo="'+key+'"]'); if(td) td.textContent = baseTipo(r.elemento)||'—'; }
  const tr=el.closest('tr'); if(tr){ tr.classList.toggle('dirty', esDirty(r)); tr.classList.toggle('noop', esNoOp(r.elemento, r.no_operativo)); }
  recomputar(); actualizarResaltado(); pintarKPIs(); actualizarDirty();
}
function esDirty(r){
  if(r._alta || r._baja) return true;
  return EDIT_SUB.some(function(c){ return String(r[c.k]==null?'':r[c.k]) !== String(r._orig[c.k]==null?'':r._orig[c.k]); });
}

/* ---------- análisis local (mismo criterio que el Worker) ---------- */
function recomputar(){
  if(TABLA!=='subtramos') return;
  const filas = FILAS.filter(function(r){ return !r._baja; }).map(function(r){
    return { key:r._key, elemento:r.elemento, tipo:baseTipo(r.elemento), no_op:esNoOp(r.elemento,r.no_operativo),
             ini:absM(r.abs_inicio), fin:absM(r.abs_fin), uf:r.uf };
  });
  const overlaps=[], dupKeys={}, porNom={}, tope={};
  filas.forEach(function(r){ const n=normNom(r.elemento); if(n){ (porNom[n]=porNom[n]||[]).push(r.key); }
    if(!r.no_op && esLineal(r.tipo) && r.fin!=null){ const uf=r.uf||'—'; if(tope[uf]==null||r.fin>tope[uf]) tope[uf]=r.fin; } });
  Object.keys(porNom).forEach(function(n){ if(porNom[n].length>1) porNom[n].forEach(function(k){ dupKeys[k]=true; }); });
  const lin=filas.filter(function(r){ return !r.no_op && esLineal(r.tipo) && r.ini!=null && r.fin!=null && r.fin>r.ini; });
  const porTipo={}; lin.forEach(function(r){ (porTipo[r.tipo]=porTipo[r.tipo]||[]).push(r); });
  Object.keys(porTipo).forEach(function(tp){ const ls=porTipo[tp].slice().sort(function(a,b){ return a.ini-b.ini; });
    for(let i=0;i<ls.length;i++) for(let j=i+1;j<ls.length;j++){ if(ls[i].ini<ls[j].fin && ls[j].ini<ls[i].fin) overlaps.push([ls[i].key, ls[j].key]); } });
  const overKeys={}; overlaps.forEach(function(p){ overKeys[p[0]]=true; overKeys[p[1]]=true; });
  ANALISIS = { overlaps:overlaps, overKeys:overKeys, dupKeys:dupKeys, tope:tope,
               no_operativos: filas.filter(function(r){ return r.no_op; }).map(function(r){ return r.key; }) };
}
function actualizarResaltado(){
  document.querySelectorAll('#cuerpo tr[data-fila]').forEach(function(tr){
    const k=Number(tr.getAttribute('data-fila'));
    const over=!!(ANALISIS.overKeys&&ANALISIS.overKeys[k]), dup=!!(ANALISIS.dupKeys&&ANALISIS.dupKeys[k]);
    tr.querySelectorAll('td.cell').forEach(function(td){
      const ci=Number(td.getAttribute('data-ci'));
      td.classList.toggle('solape', over && (ci===1||ci===2));   // abs inicio/fin
      td.classList.toggle('dup', dup && ci===0);                 // elemento
    });
  });
}

/* ---------- KPIs + avisos ---------- */
function pintarKPIs(){
  const vis=filasVisibles();
  document.getElementById('kFilas').textContent = vis.length;
  if(TABLA==='subtramos'){
    document.getElementById('kSolape').textContent = (ANALISIS.overlaps||[]).length;
    let dup=0; Object.keys(ANALISIS.dupKeys||{}).forEach(function(){ dup++; });
    document.getElementById('kDup').textContent = dup;
    const t=ANALISIS.tope||{}; document.getElementById('kTope').textContent = (t.UF1!=null?t.UF1:'—')+' · '+(t.UF2!=null?t.UF2:'—');
  } else {
    document.getElementById('kSolape').textContent='—'; document.getElementById('kDup').textContent='—'; document.getElementById('kTope').textContent='—';
  }
  actualizarResaltado();
}
function pintarAvisos(){
  const box=document.getElementById('avisos');
  if(TABLA!=='subtramos'){ box.style.display='none'; box.innerHTML=''; return; }
  const items=[];
  (ANALISIS.overlaps||[]).forEach(function(p){
    const a=filaPorKey(p[0]), b=filaPorKey(p[1]);
    if(a&&b) items.push('Solape: «'+esc(a.elemento)+'» ['+absM(a.abs_inicio)+'–'+absM(a.abs_fin)+'] se pisa con «'+esc(b.elemento)+'» ['+absM(b.abs_inicio)+'–'+absM(b.abs_fin)+'].');
  });
  const dupNom={}; FILAS.filter(function(r){return !r._baja;}).forEach(function(r){ const n=normNom(r.elemento); if(n)(dupNom[n]=dupNom[n]||[]).push(r.elemento); });
  Object.keys(dupNom).forEach(function(n){ if(dupNom[n].length>1) items.push('Nombre repetido: «'+esc(dupNom[n][0])+'» ('+dupNom[n].length+' veces).'); });
  if(!items.length){ box.style.display='none'; box.innerHTML=''; return; }
  box.style.display='block';
  box.innerHTML='<div class="tit">Revisar antes de guardar</div><ul>'+items.slice(0,12).map(function(x){ return '<li>'+x+'</li>'; }).join('')+'</ul>'
    +(items.length>12?('<div>… y '+(items.length-12)+' más.</div>'):'');
}

/* ---------- alta / baja ---------- */
function altaFila(){
  const r={ _key:tempSeq--, orden:null, elemento:'', abs_inicio:'', abs_fin:'', uf:'', no_operativo:false, version:0, _alta:true, _baja:false, _orig:{} };
  FILAS.unshift(r);
  ordCol=-1;   // que la nueva quede arriba
  document.getElementById('q').value='';
  pintar(); actualizarDirty();
  const inp=document.querySelector('#cuerpo tr[data-fila="'+r._key+'"] input.cin'); if(inp) inp.focus();
}
function bajaFila(key){
  const r=filaPorKey(key); if(!r) return;
  if(r._alta){ FILAS = FILAS.filter(function(x){ return x._key!==key; }); }
  else { if(!confirm('¿Eliminar «'+(r.elemento||('fila '+r.orden))+'» de la base?')) return; r._baja=true; }
  pintar(); actualizarDirty();
}

/* ---------- selección de rango ---------- */
document.addEventListener('keydown', function(e){ if(e.key==='Shift') shiftHeld=true;
  if((e.ctrlKey||e.metaKey) && (e.key==='d'||e.key==='D')){ e.preventDefault(); rellenarAbajo(); } });
document.addEventListener('keyup', function(e){ if(e.key==='Shift') shiftHeld=false; });
// Selección: se ancla en mousedown (trae event.shiftKey directo y burbujea, a diferencia de focus).
function selDown(key, ci, ev){
  focoCelda={key:key, ci:ci};
  if(ev && ev.shiftKey && ancla){ selFoco={key:key, ci:ci}; } else { ancla={key:key, ci:ci}; selFoco={key:key, ci:ci}; }
  paintSel();
}
// focus solo mueve el ancla de PEGADO (la celda activa), sin tocar el rango (lo maneja selDown).
function foco(key, ci){ focoCelda={key:key, ci:ci}; }
function rectangulo(){
  if(!ancla||!selFoco) return null;
  const vis=filasVisibles(); const orden=vis.map(function(r){ return r._key; });
  const ia=orden.indexOf(ancla.key), ib=orden.indexOf(selFoco.key);
  if(ia<0||ib<0) return null;
  const r0=Math.min(ia,ib), r1=Math.max(ia,ib), c0=Math.min(ancla.ci,selFoco.ci), c1=Math.max(ancla.ci,selFoco.ci);
  return { keys:orden.slice(r0,r1+1), c0:c0, c1:c1 };
}
function paintSel(){
  const rc=rectangulo(); const dentro={};
  if(rc){ rc.keys.forEach(function(k){ for(let c=rc.c0;c<=rc.c1;c++) dentro[k+'|'+c]=true; }); }
  document.querySelectorAll('#cuerpo td.cell').forEach(function(td){
    const k=td.getAttribute('data-key'), ci=td.getAttribute('data-ci');
    td.classList.toggle('sel', !!dentro[k+'|'+ci]);
  });
}

/* ---------- copiar / pegar / rellenar ---------- */
function valorCelda(key, ci){ const r=filaPorKey(key); if(!r) return ''; const k=EDIT_SUB[ci].k; return (k==='no_operativo') ? (r.no_operativo?'sí':'no') : String(r[k]==null?'':r[k]); }
function copiarSel(btn){
  const rc=rectangulo();
  let tsv;
  if(rc && (rc.keys.length>1 || rc.c0!==rc.c1)){
    tsv = rc.keys.map(function(k){ const fila=[]; for(let c=rc.c0;c<=rc.c1;c++) fila.push(valorCelda(k,c)); return fila.join('\t'); }).join('\n');
  } else {
    const vis=filasVisibles();
    tsv = vis.map(function(r){ return EDIT_SUB.map(function(c,ci){ return valorCelda(r._key,ci); }).join('\t'); }).join('\n');
  }
  const ok=function(){ if(btn){ btn.classList.add('copied'); const t=btn.textContent; btn.textContent='✓ Copiado'; setTimeout(function(){ btn.classList.remove('copied'); btn.textContent=t; },1400); } };
  if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(tsv).then(ok, function(){ fallbackCopia(tsv); ok(); }); }
  else { fallbackCopia(tsv); ok(); }
}
function fallbackCopia(txt){ const ta=document.createElement('textarea'); ta.value=txt; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); }catch(e){} document.body.removeChild(ta); }

document.addEventListener('paste', function(e){
  if(!PUEDE_EDITAR || TABLA!=='subtramos' || !focoCelda) return;
  const txt=(e.clipboardData||window.clipboardData).getData('text'); if(!txt) return;
  e.preventDefault();
  const grid=txt.replace(/\r/g,'').replace(/\n$/,'').split('\n').map(function(l){ return l.split('\t'); });
  const vis=filasVisibles(); const orden=vis.map(function(r){ return r._key; });
  let ri=orden.indexOf(focoCelda.key); if(ri<0) ri=0;
  let cambiadas=0;
  grid.forEach(function(fila, dr){
    const key=orden[ri+dr]; if(key===undefined) return;
    const r=filaPorKey(key); if(!r) return;
    fila.forEach(function(val, dc){
      const ci=focoCelda.ci+dc; if(ci>=EDIT_SUB.length) return;
      const k=EDIT_SUB[ci].k;
      if(k==='no_operativo'){ r.no_operativo=/^(s|1|true|x|✓)/i.test(String(val).trim()); }
      else if(k==='uf'){ const u=String(val).trim().toUpperCase(); r.uf=(u==='UF1'||u==='UF2')?u:''; }
      else { r[k]=String(val).trim(); }
      cambiadas++;
    });
  });
  if(cambiadas){ pintar(); actualizarDirty(); toast('Pegadas '+cambiadas+' celda(s).'); }
});

function rellenarAbajo(){
  if(!PUEDE_EDITAR || TABLA!=='subtramos') return;
  const rc=rectangulo(); if(!rc){ toast('Elige primero la celda o el rango a rellenar.', true); return; }
  const vis=filasVisibles(); const mapa={}; vis.forEach(function(r){ mapa[r._key]=r; });
  const origen=rc.keys[0];
  let n=0;
  for(let c=rc.c0;c<=rc.c1;c++){
    const k=EDIT_SUB[c].k; const base=filaPorKey(origen)[k];
    for(let i=1;i<rc.keys.length;i++){ const r=mapa[rc.keys[i]]; if(r){ r[k]=base; n++; } }
  }
  // si la selección es de UNA fila, rellena hacia TODAS las visibles debajo
  if(rc.keys.length===1){
    const idx=vis.findIndex(function(r){ return r._key===origen; });
    for(let c=rc.c0;c<=rc.c1;c++){ const k=EDIT_SUB[c].k; const base=vis[idx][k];
      for(let i=idx+1;i<vis.length;i++){ vis[i][k]=base; n++; } }
  }
  if(n){ pintar(); actualizarDirty(); toast('Rellenadas '+n+' celda(s).'); }
}

/* ---------- guardar ---------- */
function dirtyCambios(){
  const cambios=[];
  FILAS.forEach(function(r){
    if(r._baja && !r._alta){ cambios.push({ op:'baja', orden:r.orden, if_version:r.version }); return; }
    if(r._baja) return;
    if(r._alta){ cambios.push({ op:'alta', elemento:r.elemento, abs_inicio:r.abs_inicio, abs_fin:r.abs_fin, uf:r.uf, no_operativo:!!r.no_operativo }); return; }
    if(esDirty(r)) cambios.push({ op:'update', orden:r.orden, if_version:r.version,
      elemento:r.elemento, abs_inicio:r.abs_inicio, abs_fin:r.abs_fin, uf:r.uf, no_operativo:!!r.no_operativo });
  });
  return cambios;
}
function actualizarDirty(){
  const n=dirtyCambios().length;
  const b=document.getElementById('btnGuardar'); const c=document.getElementById('nDirty');
  if(c) c.textContent=n; if(b) b.disabled = n===0;
  try{ if(window.parent!==window) window.parent.postMessage({tm2:'dirty', page:'grilla', n:n}, location.origin); }catch(e){}
}
async function guardar(btn){
  const cambios=dirtyCambios();
  if(!cambios.length){ toast('No hay cambios que guardar.'); return; }
  if(ANALISIS.overlaps && ANALISIS.overlaps.length && !confirm('Hay '+ANALISIS.overlaps.length+' solape(s) marcados. El servidor rechazará los que toques. ¿Continuar?')) return;
  if(btn) btn.disabled=true;
  let d; try{ d=await api(null, { action:'grid_guardar', tabla:'subtramos', cambios:cambios }); }catch(e){ d={ok:false,error:'Sin conexión.'}; }
  if(caducada(d)){ return; }
  if(d && d.ok){
    aplicarModelo(d);
    toast(d.mensaje||('Guardados '+cambios.length+' cambio(s).'));
    if(d.cascada && d.cascada.length){ setTimeout(function(){ alert('Aviso de cascada:\n\n'+d.cascada.join('\n\n')); }, 60); }
    return;
  }
  if(btn) btn.disabled=false;
  if(d && d.error==='solape'){ toast(d.mensaje||'Hay un solape sin resolver.', true); return; }
  if(d && d.error==='version'){ aplicarModelo(d); toast(d.mensaje||'Otra persona editó algunas filas; se recargaron.', true); return; }
  if(d && d.error==='payload'){ toast('Dato inválido en «'+(d.campo||'')+'»: '+(d.detalle||''), true); return; }
  toast((d&&d.error)||'No se guardó.', true);
}

cargar();
