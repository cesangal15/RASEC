/* ============================================================================
 * CATÁLOGOS (admin) — edición tipo Excel de las tablas de Supabase que antes solo
 * se tocaban en el Table Editor. La UI se construye ENTERA a partir de la
 * metadata que devuelve `cat_tablas` (columnas, filtros, alta/baja): nada de
 * tablas cableadas en el cliente. Mismo patrón que grilla.js (D181): edición en
 * celda, selección de rango (clic + Shift), copiar/pegar TSV, Ctrl+D rellenar,
 * Ctrl+Z deshacer. Guard de cliente: solo rol admin — el servidor manda igual.
 * CSP D170: nada de onclick/style en línea; data-on-* + funciones globales.
 * ==========================================================================*/
if(window.TM2Estilos) TM2Estilos.aplicar();

const APPS_SCRIPT_URL = GALCA_ENV.url.obra;   // entorno.js (D168): producción o prueba, ruta /obra

/* ---------- sesión (D109) — SOLO admin entra a esta pantalla ---------- */
const rol = localStorage.getItem('rol')||'', usuario = (localStorage.getItem('usuario')||'').trim().toLowerCase();
if(!(window.TM2Auth && TM2Auth.get())){ location.href='index.html'; }
const ES_ADMIN = rol==='admin';
document.getElementById('userDisplay').textContent = usuario+' · '+rol;
if(!ES_ADMIN){
  document.getElementById('app').style.display='none';
  document.getElementById('bloqueado').style.display='block';
  document.getElementById('btnMenu').style.display='none';
}

function logout(){ localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token'); location.href='index.html'; }
function caducada(d){ if(window.TM2Auth && TM2Auth.caducada(d)){ alert('La sesión ya no vale. Vuelve a entrar.'); logout(); return true; } return false; }
async function api(url, body){
  const r = body ? await fetch(APPS_SCRIPT_URL, { method:'POST', headers:{'Content-Type':'text/plain'}, body:JSON.stringify(body) }) : await fetch(url, {cache:'no-store'});
  return r.json();
}
let toastT=null; function toast(msg, err){ let t=document.querySelector('.toast'); if(!t){ t=document.createElement('div'); t.className='toast'; document.body.appendChild(t); } t.textContent=msg; t.classList.toggle('err',!!err); t.style.display='block'; clearTimeout(toastT); toastT=setTimeout(function(){ t.style.display='none'; }, err?6000:2600); }
function normNom(s){ return String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toLowerCase(); }
function fechaBogota(offsetDias){ const d=new Date(); d.setDate(d.getDate()+(offsetDias||0)); return d.toLocaleDateString('en-CA',{timeZone:'America/Bogota'}); }
function normOpciones(op){
  op = op||[];
  return op.map(function(o){ return (o && typeof o==='object') ? {value:String(o.value), label:String(o.label==null?o.value:o.label)} : {value:String(o), label:String(o)}; });
}

/* ---------- estado ---------- */
let GRUPOS=[];             // [{id,titulo}] — orden y etiquetas los da el servidor (cat_tablas)
let TABLAS=[];            // metadata de cat_tablas
let TABLA='';             // id de la tabla activa
let META=null;            // {id,grupo,titulo,descripcion,pk,alta,baja,baja_es,filtros,columnas}
let COLS=[];              // META.columnas
let FILTROS_DEF=[];       // META.filtros
let FILTROS_VAL={};       // valores actuales de los filtros
let FILAS=[];             // filas de trabajo
let keySeq=1;             // _key local de filas existentes
let tempSeq=-1;           // _key local de filas nuevas (alta)
let ordCol=-1, ordDir=1;
let shiftHeld=false, ancla=null, selFoco=null, focoCelda=null;
let undoStack=[];
let ERRORES={};           // 'rowKey|campo' -> motivo (errores del servidor)
let AVISOS={};            // JSON(pk) -> texto (avisos del servidor, p.ej. bandeja ya en DATA)
let CAMBIOS_ROWS=[];      // paralelo al último `cambios` armado: rowKey por índice, para pintar errores

/* ---------- carga de tablas ---------- */
async function cargarTablas(){
  let d; try{ d=await api(APPS_SCRIPT_URL+'?action=cat_tablas'); }catch(e){ d={ok:false,error:'Sin conexión.'}; }
  if(caducada(d)) return;
  if(!d.ok){ toast(d.error||'No se pudieron cargar los catálogos.', true); return; }
  GRUPOS = d.grupos||[];    // [{id,titulo}] en el orden que decide el servidor
  TABLAS = d.tablas||[];
  pintarSelector();
  if(TABLAS.length) verTabla(TABLAS[0].id);
}
function pintarSelector(){
  const sel=document.getElementById('selTabla');
  let h='';
  GRUPOS.forEach(function(g){
    const ts=TABLAS.filter(function(t){ return t.grupo===g.id; });
    if(!ts.length) return;
    h += '<optgroup label="'+esc(g.titulo||g.id)+'">' + ts.map(function(t){ return '<option value="'+esc(t.id)+'">'+esc(t.titulo||t.id)+'</option>'; }).join('') + '</optgroup>';
  });
  sel.innerHTML=h;
}

/* ---------- tabla activa / filtros ----------
 * Cada filtro es UNA columna plana en `filtros` (p.ej. bandeja trae `desde`/`hasta` como DOS filtros
 * tipo 'fecha' independientes, no un rango anidado): así lo espera cat_leer (parsearFiltros_). Las
 * fechas por defecto usan el propio id: «desde» → hoy-7, cualquier otra fecha → hoy (D168/en-CA). */
function valorInicialFiltro(f){
  if(f.tipo==='fecha') return /desde/i.test(f.id) ? fechaBogota(-7) : fechaBogota(0);
  return '';
}
function valoresIniciales(defs){
  const v={};
  defs.forEach(function(f){ v[f.id] = valorInicialFiltro(f); });
  return v;
}
function verTabla(id){
  if(!id || id===TABLA){ return; }
  if(dirtyCambios().length && !confirm('Hay cambios sin guardar. ¿Descartarlos y cambiar de tabla?')){
    document.getElementById('selTabla').value=TABLA; return;
  }
  TABLA=id;
  document.getElementById('selTabla').value=id;
  META = TABLAS.filter(function(t){ return t.id===id; })[0] || null;
  COLS = (META && META.columnas) || [];
  FILTROS_DEF = (META && META.filtros) || [];
  FILTROS_VAL = valoresIniciales(FILTROS_DEF);
  FILAS=[]; ERRORES={}; AVISOS={}; undoStack=[]; ordCol=-1; ancla=selFoco=focoCelda=null;
  pintarFiltros(); pintarCab(); pintar(); actualizarDirty(); pintarAvisos();
  document.getElementById('btnAlta').style.display = (META && META.alta) ? 'inline-block' : 'none';
  if(!FILTROS_DEF.length) buscar();
  else document.getElementById('cuerpo').innerHTML='<tr><td class="vacio" colspan="'+(COLS.length+2)+'">Elige los filtros y pulsa Buscar.</td></tr>';
}
function pintarFiltros(){
  const cont=document.getElementById('filtros');
  if(!FILTROS_DEF.length){ cont.innerHTML=''; return; }
  let h='';
  FILTROS_DEF.forEach(function(f){
    const req = f.requerido ? ' *' : '';
    const val = FILTROS_VAL[f.id];
    if(f.tipo==='fecha'){
      h += '<div class="f"><label>'+esc(f.etiqueta)+req+'</label><input type="date" data-filtro="'+esc(f.id)+'" value="'+esc(val)+'" data-on-change="setFiltro(this)"></div>';
    } else if(f.tipo==='pk'){
      h += '<div class="f"><label>'+esc(f.etiqueta)+req+'</label><input type="text" data-filtro="'+esc(f.id)+'" value="'+esc(val)+'" placeholder="12+300" data-on-input="setFiltro(this)"></div>';
    } else if(f.tipo==='lista'){
      const ops=normOpciones(f.opciones);
      h += '<div class="f"><label>'+esc(f.etiqueta)+req+'</label><select data-filtro="'+esc(f.id)+'" data-on-change="setFiltro(this)"><option value="">Todos</option>'
        + ops.map(function(o){ return '<option value="'+esc(o.value)+'"'+(val===o.value?' selected':'')+'>'+esc(o.label)+'</option>'; }).join('') + '</select></div>';
    } else {
      h += '<div class="f"><label>'+esc(f.etiqueta)+req+'</label><input type="text" data-filtro="'+esc(f.id)+'" value="'+esc(val)+'" placeholder="'+esc(f.etiqueta)+'" data-on-input="setFiltro(this)"></div>';
    }
  });
  h += '<div class="f"><label>&nbsp;</label><button class="btn primario" data-on-click="buscar()">Buscar</button></div>';
  cont.innerHTML=h;
}
function setFiltro(el){ FILTROS_VAL[el.getAttribute('data-filtro')] = el.value; }

/* ---------- cat_leer ---------- */
async function buscar(){
  if(!TABLA) return;
  if(dirtyCambios().length && !confirm('Hay cambios sin guardar. ¿Descartarlos y volver a buscar?')) return;
  await cargarDatos();
}
async function cargarDatos(){
  const faltan = FILTROS_DEF.filter(function(f){ return f.requerido && !FILTROS_VAL[f.id]; });
  if(faltan.length){ toast('Falta «'+faltan[0].etiqueta+'».', true); return; }
  document.getElementById('cuerpo').innerHTML='<tr><td class="vacio" colspan="'+(COLS.length+2)+'">Cargando…</td></tr>';
  let d; try{ d=await api(APPS_SCRIPT_URL+'?action=cat_leer&tabla='+encodeURIComponent(TABLA)+'&filtros='+encodeURIComponent(JSON.stringify(FILTROS_VAL))); }catch(e){ d={ok:false,error:'Sin conexión.'}; }
  if(caducada(d)) return;
  if(!d.ok){ toast(d.error||'No se pudo cargar.', true); document.getElementById('cuerpo').innerHTML='<tr><td class="vacio" colspan="'+(COLS.length+2)+'">Sin datos.</td></tr>'; return; }
  aplicarModelo(d);
  if(d.truncado) toast('Se truncó a las primeras filas (tope alcanzado). Filtra más para verlas todas.', true);
}
function aplicarModelo(d){
  keySeq=1;
  FILAS = (d.filas||[]).map(function(r){
    const o=Object.assign({}, r);
    COLS.forEach(function(c){ if(o[c.id]===undefined) o[c.id] = (c.tipo==='bool') ? false : ''; });
    o._key = keySeq++;
    o._k = r._k || null;
    o._orig = {}; COLS.forEach(function(c){ o._orig[c.id]=o[c.id]; });
    o._alta=false; o._baja=false;
    return o;
  });
  ERRORES={}; undoStack=[]; ordCol=-1; ancla=selFoco=focoCelda=null;
  pintar(); actualizarDirty();
}

/* ---------- pintar cabecera / cuerpo ---------- */
function pintarCab(){
  const cab=document.getElementById('cab');
  let h='<th class="rownum">#</th>';
  COLS.forEach(function(c,i){ h+='<th data-on-click="ordenarPor('+i+')">'+esc(c.etiqueta)+'<span class="ord" id="ord'+i+'"></span></th>'; });
  h+='<th class="rownum"></th>';
  cab.innerHTML=h;
}
function ordenarPor(i){ if(ordCol===i) ordDir=-ordDir; else { ordCol=i; ordDir=1; } pintar(); }
function filaPorKey(key){ return FILAS.filter(function(r){ return r._key===key; })[0] || null; }
function esPk(id){ return !!(META && (META.pk||[]).indexOf(id)>=0); }
function colEditable(r, c){ if(c.editable) return true; if(r._alta && esPk(c.id)) return true; return false; }
function claveDe(r){ return JSON.stringify(r._k||{}); }

function filasVisibles(){
  const q=normNom(document.getElementById('q').value);
  let vis = FILAS.filter(function(r){ return !r._baja; });
  if(q){ vis = vis.filter(function(r){ return COLS.some(function(c){ return normNom(r[c.id]).indexOf(q)>=0; }); }); }
  if(ordCol>=0 && COLS[ordCol]){
    const k=COLS[ordCol].id;
    vis = vis.slice().sort(function(a,b){ const va=normNom(a[k]), vb=normNom(b[k]); return (va<vb?-1:va>vb?1:0)*ordDir; });
  }
  return vis;
}

function pintar(){
  const cuerpo=document.getElementById('cuerpo');
  if(!TABLA){ cuerpo.innerHTML='<tr><td class="vacio">Elige una tabla.</td></tr>'; return; }
  const vis=filasVisibles();
  if(!vis.length){ cuerpo.innerHTML='<tr><td class="vacio" colspan="'+(COLS.length+2)+'">Sin filas.</td></tr>'; }
  else { cuerpo.innerHTML = vis.map(filaHTML).join(''); }
  actualizarDirty();
  paintSel();
}

function filaHTML(r){
  const dirty = esDirty(r), aviso = !!AVISOS[claveDe(r)];
  let h='<tr data-fila="'+r._key+'" class="'+(dirty?'dirty ':'')+(aviso?'con-aviso':'')+'">';
  h+='<td class="rownum">'+(r._alta?'nuevo':'')+'</td>';
  COLS.forEach(function(c,ci){
    const val=r[c.id];
    const editable=colEditable(r,c);
    const ro = editable ? '' : ' disabled';
    const err = ERRORES[r._key+'|'+c.id];
    const td='<td class="cell'+(c.tipo==='bool'?' bool':'')+(err?' error':'')+'" data-key="'+r._key+'" data-ci="'+ci+'" title="'+esc(err||'')+'" data-on-mousedown="selDown('+r._key+','+ci+',event)">';
    if(c.tipo==='bool'){
      h+=td+'<input type="checkbox" '+(val?'checked':'')+ro+' data-on-change="cel('+r._key+",'"+c.id+"',this)\" data-on-focus=\"foco("+r._key+','+ci+')"></td>';
    } else if(c.tipo==='lista'){
      const ops=normOpciones(c.opciones);
      const opsH = ops.map(function(o){ return '<option value="'+esc(o.value)+'"'+(String(val||'')===o.value?' selected':'')+'>'+esc(o.label)+'</option>'; }).join('');
      h+=td+'<select class="cin"'+ro+' data-on-change="cel('+r._key+",'"+c.id+"',this)\" data-on-focus=\"foco("+r._key+','+ci+')">'+opsH+'</select></td>';
    } else if(c.tipo==='clave'){
      h+=td+'<input class="cin" type="password" value="'+esc(val==null?'':val)+'" placeholder="deja vacío para no cambiar" autocomplete="new-password"'+ro+' data-on-input="cel('+r._key+",'"+c.id+"',this)\" data-on-focus=\"foco("+r._key+','+ci+')"></td>';
    } else if(c.tipo==='fecha'){
      h+=td+'<input class="cin" type="date" value="'+esc(val==null?'':val)+'"'+ro+' data-on-change="cel('+r._key+",'"+c.id+"',this)\" data-on-focus=\"foco("+r._key+','+ci+')"></td>';
    } else {
      h+=td+'<input class="cin" type="text" value="'+esc(val==null?'':val)+'"'+ro+' data-on-input="cel('+r._key+",'"+c.id+"',this)\" data-on-focus=\"foco("+r._key+','+ci+')"></td>';
    }
  });
  if(META && META.baja){
    const titulo = META.baja_es==='descartar' ? 'Descartar fila' : 'Eliminar fila';
    h+='<td class="rownum"><button class="btn mini" title="'+titulo+'" data-on-click="bajaFila('+r._key+')">✕</button></td>';
  } else h+='<td class="rownum"></td>';
  h+='</tr>';
  return h;
}

/* ---------- edición en celda (sin repintar: preserva foco) ---------- */
function cel(key, campo, el){
  const r=filaPorKey(key); if(!r) return;
  const c=COLS.filter(function(x){ return x.id===campo; })[0];
  r[campo] = (c && c.tipo==='bool') ? !!el.checked : el.value;
  delete ERRORES[key+'|'+campo];
  const tr=el.closest('tr'); if(tr) tr.classList.toggle('dirty', esDirty(r));
  actualizarDirty();
}
function esDirty(r){
  if(r._alta || r._baja) return true;
  return COLS.some(function(c){ return String(r[c.id]==null?'':r[c.id]) !== String(r._orig[c.id]==null?'':r._orig[c.id]); });
}

/* ---------- deshacer (Ctrl+Z) — pila de instantáneas de FILAS antes de cada acción ---------- */
function snapEstado(){ return JSON.stringify(FILAS); }
function pushUndo(){ undoStack.push(snapEstado()); if(undoStack.length>80) undoStack.shift(); }
function deshacer(){
  if(!undoStack.length){ toast('Nada que deshacer.'); return; }
  FILAS = JSON.parse(undoStack.pop());
  pintar(); actualizarDirty();
  toast('Deshecho.');
}

/* ---------- alta / baja ---------- */
function altaFila(){
  if(!META || !META.alta) return;
  pushUndo();
  const r={ _key:tempSeq--, _k:null, _alta:true, _baja:false, _orig:{} };
  COLS.forEach(function(c){ r[c.id]=(c.tipo==='bool')?false:''; });
  FILAS.unshift(r);
  ordCol=-1;
  document.getElementById('q').value='';
  pintar(); actualizarDirty();
  const fila=document.querySelector('#cuerpo tr[data-fila="'+r._key+'"]');
  const inp = fila && fila.querySelector('input.cin, select.cin'); if(inp) inp.focus();
}
function bajaFila(key){
  const r=filaPorKey(key); if(!r) return;
  if(r._alta){ pushUndo(); FILAS = FILAS.filter(function(x){ return x._key!==key; }); pintar(); actualizarDirty(); return; }
  const verbo = (META && META.baja_es==='descartar') ? 'descartar' : 'eliminar';
  if(!confirm('¿Seguro que quieres '+verbo+' esta fila?')) return;
  pushUndo();
  r._baja=true;
  pintar(); actualizarDirty();
}

/* ---------- selección de rango (igual que grilla.js) ---------- */
document.addEventListener('keydown', function(e){
  if(e.key==='Shift') shiftHeld=true;
  if((e.ctrlKey||e.metaKey) && (e.key==='d'||e.key==='D')){ e.preventDefault(); rellenarAbajo(); }
  if((e.ctrlKey||e.metaKey) && !e.shiftKey && (e.key==='z'||e.key==='Z')){ e.preventDefault(); deshacer(); }
});
document.addEventListener('keyup', function(e){ if(e.key==='Shift') shiftHeld=false; });
function selDown(key, ci, ev){
  focoCelda={key:key, ci:ci};
  if(ev && ev.shiftKey && ancla){ selFoco={key:key, ci:ci}; } else { ancla={key:key, ci:ci}; selFoco={key:key, ci:ci}; }
  paintSel();
}
function foco(key, ci){ focoCelda={key:key, ci:ci}; pushUndo(); }
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
function valorCelda(key, ci){
  const r=filaPorKey(key); if(!r) return '';
  const c=COLS[ci]; if(!c) return '';
  if(c.tipo==='clave') return '';
  if(c.tipo==='bool') return r[c.id] ? 'sí' : 'no';
  return String(r[c.id]==null?'':r[c.id]);
}
function fallbackCopia(txt){ const ta=document.createElement('textarea'); ta.value=txt; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); }catch(e){} document.body.removeChild(ta); }
function copiarSel(btn){
  const rc=rectangulo();
  let tsv;
  if(rc && (rc.keys.length>1 || rc.c0!==rc.c1)){
    tsv = rc.keys.map(function(k){ const fila=[]; for(let c=rc.c0;c<=rc.c1;c++) fila.push(valorCelda(k,c)); return fila.join('\t'); }).join('\n');
  } else {
    const vis=filasVisibles();
    tsv = vis.map(function(r){ return COLS.map(function(c,ci){ return valorCelda(r._key,ci); }).join('\t'); }).join('\n');
  }
  copiarTexto(tsv, btn);
}
function copiarExcel(btn){
  const vis=filasVisibles();
  const cab = COLS.map(function(c){ return c.etiqueta; }).join('\t');
  const filas = vis.map(function(r){ return COLS.map(function(c,ci){ return valorCelda(r._key,ci); }).join('\t'); });
  copiarTexto([cab].concat(filas).join('\n'), btn);
}
function copiarTexto(tsv, btn){
  const ok=function(){ if(btn){ btn.classList.add('copied'); const t=btn.textContent; btn.textContent='✓ Copiado'; setTimeout(function(){ btn.classList.remove('copied'); btn.textContent=t; },1400); } };
  if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(tsv).then(ok, function(){ fallbackCopia(tsv); ok(); }); }
  else { fallbackCopia(tsv); ok(); }
}

document.addEventListener('paste', function(e){
  if(!TABLA || !focoCelda) return;
  const txt=(e.clipboardData||window.clipboardData).getData('text'); if(!txt) return;
  e.preventDefault();
  pushUndo();
  const grid=txt.replace(/\r/g,'').replace(/\n$/,'').split('\n').map(function(l){ return l.split('\t'); });
  const vis=filasVisibles(); const orden=vis.map(function(r){ return r._key; });
  let ri=orden.indexOf(focoCelda.key); if(ri<0) ri=0;
  let cambiadas=0;
  grid.forEach(function(fila, dr){
    const key=orden[ri+dr]; if(key===undefined) return;
    const r=filaPorKey(key); if(!r) return;
    fila.forEach(function(val, dc){
      const ci=focoCelda.ci+dc; if(ci>=COLS.length) return;
      const c=COLS[ci]; if(!colEditable(r,c)) return;
      if(c.tipo==='bool'){ r[c.id]=/^(s|1|true|x|✓)/i.test(String(val).trim()); }
      else { r[c.id]=String(val).trim(); }
      delete ERRORES[key+'|'+c.id];
      cambiadas++;
    });
  });
  if(cambiadas){ pintar(); actualizarDirty(); toast('Pegadas '+cambiadas+' celda(s).'); }
});

function rellenarAbajo(){
  const rc=rectangulo(); if(!rc){ toast('Elige primero la celda o el rango a rellenar.', true); return; }
  pushUndo();
  const vis=filasVisibles(); const mapa={}; vis.forEach(function(r){ mapa[r._key]=r; });
  const origen=rc.keys[0];
  let n=0;
  for(let c=rc.c0;c<=rc.c1;c++){
    const col=COLS[c]; const filaOrigen=filaPorKey(origen); if(!filaOrigen) continue;
    const base=filaOrigen[col.id];
    for(let i=1;i<rc.keys.length;i++){ const r=mapa[rc.keys[i]]; if(r && colEditable(r,col)){ r[col.id]=base; n++; } }
  }
  if(rc.keys.length===1){
    const idx=vis.findIndex(function(r){ return r._key===origen; });
    for(let c=rc.c0;c<=rc.c1;c++){ const col=COLS[c]; const base=vis[idx][col.id];
      for(let i=idx+1;i<vis.length;i++){ if(colEditable(vis[i],col)){ vis[i][col.id]=base; n++; } } }
  }
  if(n){ pintar(); actualizarDirty(); toast('Rellenadas '+n+' celda(s).'); }
}

/* ---------- guardar ---------- */
function snapshotCols(r, origen){ const out={}; COLS.forEach(function(c){ out[c.id] = origen ? r._orig[c.id] : r[c.id]; }); return out; }
function camposAlta(r){
  // Solo lo que la persona pudo escribir de verdad: columnas editables + PK de la fila nueva.
  const out={}; COLS.forEach(function(c){ if(c.editable || esPk(c.id)) out[c.id]=r[c.id]; }); return out;
}
function dirtyCambios(){
  const cambios=[]; CAMBIOS_ROWS=[];
  FILAS.forEach(function(r){
    if(r._baja && !r._alta){ cambios.push({ op:'baja', k:r._k, antes:snapshotCols(r,true) }); CAMBIOS_ROWS.push(r._key); return; }
    if(r._baja) return;   // alta + baja en la misma sesión: se anulan, no se envía
    if(r._alta){ cambios.push({ op:'alta', campos:camposAlta(r) }); CAMBIOS_ROWS.push(r._key); return; }
    if(esDirty(r)){
      const campos={};
      COLS.forEach(function(c){ if(c.editable && String(r[c.id]==null?'':r[c.id])!==String(r._orig[c.id]==null?'':r._orig[c.id])) campos[c.id]=r[c.id]; });
      cambios.push({ op:'update', k:r._k, antes:snapshotCols(r,true), campos:campos });
      CAMBIOS_ROWS.push(r._key);
    }
  });
  return cambios;
}
function actualizarDirty(){
  const n=dirtyCambios().length;
  const b=document.getElementById('btnGuardar'), c=document.getElementById('nDirty');
  if(c) c.textContent=n; if(b) b.disabled = n===0;
}
function pintarAvisos(){
  const box=document.getElementById('avisos');
  const claves=Object.keys(AVISOS);
  if(!claves.length){ box.style.display='none'; box.innerHTML=''; return; }
  box.style.display='block';
  box.innerHTML='<div class="tit">Avisos</div><ul>'+claves.map(function(k){ return '<li>'+esc(AVISOS[k])+' — <a href="data.html">abrir data.html</a></li>'; }).join('')+'</ul>';
}
async function guardar(btn){
  const cambios=dirtyCambios();
  if(!cambios.length){ toast('No hay cambios que guardar.'); return; }
  if(btn) btn.disabled=true;
  let d; try{ d=await api(null, { action:'cat_guardar', tabla:TABLA, cambios:cambios }); }catch(e){ d={ok:false, error:'Sin conexión.'}; }
  if(caducada(d)) return;
  if(d && d.ok){
    AVISOS={};
    (d.avisos||[]).forEach(function(a){ AVISOS[JSON.stringify(a.clave)] = a.texto; });
    ERRORES={};
    await cargarDatos();     // recarga completa con los filtros vigentes (más simple y segura que fusionar «filas resultantes»)
    pintarAvisos();
    toast('Guardados '+(d.aplicados==null?cambios.length:d.aplicados)+' cambio(s).');
    if(btn) btn.disabled=false;
    return;
  }
  if(btn) btn.disabled=false;
  if(d && d.conflicto){
    toast(d.error||'Otra persona cambió estos datos: recarga.', true);
    if(confirm((d.error||'Otra persona cambió estos datos.')+'\n¿Recargar ahora?')) cargarDatos();
    return;
  }
  if(d && d.errores && d.errores.length){
    ERRORES={};
    d.errores.forEach(function(e){ const key=CAMBIOS_ROWS[e.i]; if(key!==undefined) ERRORES[key+'|'+e.campo]=e.motivo; });
    pintar();
    toast('Hay '+d.errores.length+' error(es): revisa las celdas en rojo.', true);
    return;
  }
  toast((d&&d.error)||'No se guardó.', true);
}
function recargar(){ if(dirtyCambios().length && !confirm('Hay cambios sin guardar. ¿Descartarlos y recargar?')) return; buscar(); }

window.addEventListener('beforeunload', function(e){
  if(ES_ADMIN && TABLA && dirtyCambios().length){ e.preventDefault(); e.returnValue=''; }
});

if(ES_ADMIN) cargarTablas();
