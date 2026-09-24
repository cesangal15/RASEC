/* ============================================================================
 * CATÁLOGOS (admin) — edición tipo Excel de las tablas de Supabase que antes solo se tocaban en el
 * Table Editor. Es la MISMA hoja que «Revisión de DATA» (data.html/data.js/data.css, V3-08b/D196):
 * el HTML enlaza data.css tal cual y aquí va una copia de su motor de cuadrícula (selección, flechas,
 * Ctrl+flechas, Shift, escribir para editar, Enter/Tab/F2/Esc, Ctrl+C/V/D/Z/Y, clic derecho, filtros
 * por columna de selección múltiple, anchos arrastrables, alto de fila, ocultar filtros). Lo que cambia
 * respecto a DATA sale ENTERO de la metadata de `cat_tablas` (columnas, filtros de servidor, alta/baja):
 * nada de tablas cableadas. Sin derivaciones: cada columna es editable o no según el servidor.
 *
 * API (sin cambios): GET ?action=cat_tablas · GET ?action=cat_leer&tabla=&filtros=<json plano> ·
 * POST {action:'cat_guardar', tabla, cambios:[{op:'alta'|'update'|'baja', k, antes, campos}]}.
 * Guard de cliente: solo rol admin — el servidor manda igual. CSP D170: sin inline; data-on-* (tema.js)
 * y addEventListener; todo innerHTML pasa por esc().
 * ==========================================================================*/
if(window.TM2Estilos) TM2Estilos.aplicar();

const APPS_SCRIPT_URL = GALCA_ENV.url.obra;   // entorno.js (D168): producción o prueba, ruta /obra

/* ---------- sesión (D109) — SOLO admin entra a esta pantalla ---------- */
const rol = localStorage.getItem('rol')||'', usuario = (localStorage.getItem('usuario')||'').trim().toLowerCase();
if(!(window.TM2Auth && TM2Auth.get())){ location.href='index.html'; }
const ES_ADMIN = rol==='admin';
const PUEDE_EDITAR = ES_ADMIN;
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

function num(v){ if(v===''||v===null||v===undefined) return null; const n=Number(String(v).replace(',','.')); return isFinite(n)?n:null; }
function normNom(s){ return String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toLowerCase(); }
function hoyBogota(){ return new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'}); }
function isoMenos(iso, n){ const d=new Date(iso+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()-n); return d.toISOString().slice(0,10); }
function normOpciones(op){
  return (op||[]).map(function(o){ return (o && typeof o==='object') ? {value:String(o.value), label:String(o.label==null?o.value:o.label)} : {value:String(o), label:String(o)}; });
}

/* ---------- estado ---------- */
let GRUPOS=[], TABLAS=[];   // de cat_tablas: orden y etiquetas los da el servidor
let TABLA='', META=null;    // tabla activa y su metadata {id,grupo,titulo,descripcion,pk,alta,baja,baja_es,filtros,columnas}
let COLS=[];                // columnas de META con forma interna {k,etiqueta,tipo,edita,requerido,opciones}
let FILTROS_DEF=[], FILTROS_VAL={};   // filtros de SERVIDOR (cat_leer) y sus valores
let FILAS=[], VIS=[];
let keySeq=0, tempSeq=0;
let act=null, anc=null, editando=null;    // celda activa / ancla del rango / edición en curso
let undoStack=[], redoStack=[];
let ERRORES={};             // '<_key>|<col>' → motivo ('<_key>|*' si el error no es de una columna)
let AVISOS={};              // JSON(_k) → texto (p. ej. bandeja ya enviada a DATA)
let CAMBIOS_ROWS=[];        // paralelo al último `cambios`: _key por índice, para pintar errores
let TRUNCADO=false;
let cargaSeq=0;

/* ---------- metadata → columnas ---------- */
function colDesdeMeta(c){ return { k:c.id, etiqueta:c.etiqueta||c.id, tipo:c.tipo||'texto', edita:!!c.editable, requerido:!!c.requerido, opciones:c.opciones }; }
function esPk(k){ return !!(META && (META.pk||[]).indexOf(k)>=0); }
// Editable: lo que diga el servidor y, en una fila NUEVA, también la PK (se escribe una vez, al dar de alta).
function colEditable(r, c){ if(!PUEDE_EDITAR || !c) return false; if(c.edita) return true; return !!(r && r._alta && esPk(c.k)); }
function claveDe(r){ return JSON.stringify(r._k||{}); }

/* ---------- carga de tablas ---------- */
async function cargarTablas(){
  let d; try{ d=await api(APPS_SCRIPT_URL+'?action=cat_tablas'); }catch(e){ d={ok:false,error:'Sin conexión.'}; }
  if(caducada(d)) return;
  if(!d.ok){ toast(d.error||'No se pudieron cargar los catálogos.', true); document.getElementById('cuerpo').innerHTML='<tr><td class="vacio">'+esc(d.error||'No se pudieron cargar los catálogos.')+'</td></tr>'; return; }
  GRUPOS=d.grupos||[]; TABLAS=d.tablas||[];
  pintarSelector();
  let ini=''; try{ ini=new URLSearchParams(location.search).get('tabla')||localStorage.getItem('tm2_cat_tabla')||''; }catch(e){}
  if(!TABLAS.some(function(t){ return t.id===ini; })) ini=TABLAS.length ? TABLAS[0].id : '';
  if(ini) verTabla(ini);
}
function pintarSelector(){
  let h='';
  GRUPOS.forEach(function(g){
    const ts=TABLAS.filter(function(t){ return t.grupo===g.id; }); if(!ts.length) return;
    h+='<optgroup label="'+esc(g.titulo||g.id)+'">'+ts.map(function(t){ return '<option value="'+esc(t.id)+'">'+esc(t.titulo||t.id)+'</option>'; }).join('')+'</optgroup>';
  });
  document.getElementById('selTabla').innerHTML=h;
}

/* ---------- tabla activa + filtros de servidor ----------
 * Cada filtro es UNA clave plana en `filtros` (bandeja/volquetas: `desde`/`hasta` tipo 'fecha' — como espera
 * parsearFiltros_ del Worker). Las fechas se manejan igual que en DATA (dos fechas + chips Hoy/Ayer/Esta
 * semana/7 días); el resto (texto, pk, lista) va en la fila «srvExtra» y se aplica con Consultar. */
function hayFechas(){ return FILTROS_DEF.some(function(f){ return f.id==='desde' && f.tipo==='fecha'; }) && FILTROS_DEF.some(function(f){ return f.id==='hasta' && f.tipo==='fecha'; }); }
function verTabla(id){
  if(!id) return;
  if(id===TABLA){ document.getElementById('selTabla').value=id; return; }
  if(dirtyCambios().length && !confirm('Hay cambios sin guardar. ¿Descartarlos y cambiar de tabla?')){ document.getElementById('selTabla').value=TABLA; return; }
  TABLA=id; try{ localStorage.setItem('tm2_cat_tabla', id); }catch(e){}
  document.getElementById('selTabla').value=id;
  META=TABLAS.filter(function(t){ return t.id===id; })[0]||null;
  COLS=((META && META.columnas)||[]).map(colDesdeMeta);
  FILTROS_DEF=(META && META.filtros)||[];
  FILTROS_VAL={};
  FILTROS_DEF.forEach(function(f){ FILTROS_VAL[f.id]=''; });
  if(hayFechas()){ FILTROS_VAL.desde=isoMenos(hoyBogota(),6); FILTROS_VAL.hasta=hoyBogota(); }
  FILAS=[]; VIS=[]; ERRORES={}; AVISOS={}; TRUNCADO=false; act=anc=editando=null; undoStack=[]; redoStack=[]; actualizarUndoBtns();
  ordCol=-1; quitarFiltros(); FILTROS=[];
  document.getElementById('descTabla').textContent=(META && META.descripcion) ? ((META.titulo||id)+': '+META.descripcion) : '';
  document.getElementById('selTabla').title=(META && META.descripcion) ? ((META.titulo||id)+': '+META.descripcion) : '';
  document.getElementById('btnAlta').style.display=(PUEDE_EDITAR && META && META.alta)?'inline-flex':'none';
  pintarSrv(); montarFiltrosCols(); pintarCab(); pintarAvisos();
  document.getElementById('cuerpo').innerHTML='<tr><td class="vacio" colspan="'+(COLS.length+2)+'">Cargando…</td></tr>';
  pintarKPIs(); actualizarDirty();
  cargarDatos();
}
function pintarSrv(){
  const fechas=hayFechas();
  document.getElementById('srvFechas').hidden=!fechas;
  document.getElementById('btnConsultar').hidden=!FILTROS_DEF.length;
  if(fechas){ document.getElementById('desde').value=FILTROS_VAL.desde; document.getElementById('hasta').value=FILTROS_VAL.hasta; }
  pintarRapidos();
  const extra=FILTROS_DEF.filter(function(f){ return !(fechas && (f.id==='desde'||f.id==='hasta')); });
  const box=document.getElementById('srvExtra');
  box.hidden=!extra.length || estaFiltrosOculto();
  box.innerHTML=extra.map(function(f){
    const v=FILTROS_VAL[f.id]||'', et=esc(f.etiqueta||f.id)+(f.requerido?' *':'');
    if(f.tipo==='lista'){
      const ops=normOpciones(f.opciones).filter(function(o){ return o.value!==''; });
      return '<label class="sf"><span>'+et+'</span><select data-filtro="'+esc(f.id)+'"><option value="">Todos</option>'+ops.map(function(o){ return '<option value="'+esc(o.value)+'"'+(v===o.value?' selected':'')+'>'+esc(o.label)+'</option>'; }).join('')+'</select></label>';
    }
    const tipo=(f.tipo==='fecha')?'date':'text', ph=(f.tipo==='pk')?'12+300':'';
    return '<label class="sf"><span>'+et+'</span><input type="'+tipo+'" data-filtro="'+esc(f.id)+'" value="'+esc(v)+'" placeholder="'+esc(ph)+'"></label>';
  }).join('');
}
function leerSrv(){
  if(hayFechas()){ FILTROS_VAL.desde=document.getElementById('desde').value; FILTROS_VAL.hasta=document.getElementById('hasta').value||FILTROS_VAL.desde; }
  document.querySelectorAll('#srvExtra [data-filtro]').forEach(function(el){ FILTROS_VAL[el.getAttribute('data-filtro')]=el.value; });
}
function consultar(){
  if(dirtyCambios().length && !confirm('Hay cambios sin guardar. ¿Descartarlos y consultar?')) return;
  leerSrv(); cargarDatos();
}
async function recargar(){ if(dirtyCambios().length && !confirm('Hay cambios sin guardar. ¿Descartarlos y recargar?')) return; if(TABLA) cargarDatos(); }

/* ---------- cat_leer ---------- */
async function cargarDatos(){
  if(!TABLA) return;
  const faltan=FILTROS_DEF.filter(function(f){ return f.requerido && !FILTROS_VAL[f.id]; });
  if(faltan.length){ toast('Falta «'+(faltan[0].etiqueta||faltan[0].id)+'».', true); return; }
  const filtros={}; Object.keys(FILTROS_VAL).forEach(function(k){ if(FILTROS_VAL[k]!=='' && FILTROS_VAL[k]!=null) filtros[k]=FILTROS_VAL[k]; });
  const tabla=TABLA, seq=++cargaSeq;
  document.getElementById('cuerpo').innerHTML='<tr><td class="vacio" colspan="'+(COLS.length+2)+'">Cargando…</td></tr>';
  let d; try{ d=await api(APPS_SCRIPT_URL+'?action=cat_leer&tabla='+encodeURIComponent(tabla)+'&filtros='+encodeURIComponent(JSON.stringify(filtros))); }catch(e){ d={ok:false,error:'Sin conexión.'}; }
  if(seq!==cargaSeq || tabla!==TABLA) return;   // llegó tarde (se cambió de tabla mientras tanto)
  if(caducada(d)) return;
  if(!d.ok){ toast(d.error||'No se pudo cargar.', true); FILAS=[]; VIS=[]; document.getElementById('cuerpo').innerHTML='<tr><td class="vacio" colspan="'+(COLS.length+2)+'">'+esc(d.error||'Sin datos.')+'</td></tr>'; pintarKPIs(); actualizarDirty(); return; }
  aplicarModelo(d);
  if(d.truncado) toast('Se truncó a las primeras filas (tope alcanzado). Filtra más para verlas todas.', true);
}
function aplicarModelo(d){
  TRUNCADO=!!d.truncado;
  FILAS=(d.filas||[]).map(function(r){
    const o=Object.assign({}, r);
    COLS.forEach(function(c){ if(o[c.k]===undefined || o[c.k]===null) o[c.k]=(c.tipo==='bool')?false:''; });
    o._key='f'+(++keySeq); o._k=r._k||null;
    o._orig={}; COLS.forEach(function(c){ o._orig[c.k]=o[c.k]; });
    o._alta=false; o._baja=false;
    return o;
  });
  ERRORES={}; act=anc=editando=null; undoStack=[]; redoStack=[]; actualizarUndoBtns();
  anchosAuto();
  llenarFiltros(); pintarCab(); pintar(); actualizarDirty();
}

/* ---------- valores / presentación por tipo ---------- */
function valTxt(c, v){
  if(v===null || v===undefined) return '';
  if(c && c.tipo==='bool') return v===true || /^(true|s[ií]|1)$/i.test(String(v)) ? 'sí' : 'no';
  if(c && c.tipo==='fecha'){ const s=String(v); return /^\d{4}-\d{2}-\d{2}T00:00:00(\.0+)?Z?$/.test(s) ? s.slice(0,10) : s; }
  return String(v);
}
// Comparación de «igual a lo que había» (dirty / sin cambio real): fecha sin hora cero, bool como sí/no.
function igual(c, a, b){ return valTxt(c,a)===valTxt(c,b); }
function etiquetaLista(c, v){ const s=String(v==null?'':v); const o=normOpciones(c.opciones).filter(function(x){ return x.value===s; })[0]; return o ? o.label : s; }
function disp(r, c){
  const v=r[c.k];
  if(c.tipo==='clave') return (v===''||v==null) ? '' : '••••••';
  if(v===''||v==null) return '';
  if(c.tipo==='bool') return valTxt(c,v)==='sí' ? '✓' : '';
  if(c.tipo==='lista') return etiquetaLista(c, v);
  if(c.tipo==='fecha'){ const s=valTxt(c,v); return /T\d{2}:\d{2}/.test(s) ? s.slice(0,16).replace('T',' ') : s; }
  if(c.tipo==='numero'){ const n=num(v); if(n!=null) return n.toLocaleString('es-CO',{maximumFractionDigits:3}); }
  return String(v);
}
function valCampo(r,k){ const c=COLS.filter(function(x){ return x.k===k; })[0]; return (c && c.tipo==='clave') ? '' : (c ? disp(r,c) : String(r[k]==null?'':r[k])).trim(); }

/* ---------- render ---------- */
let ordCol=-1, ordDir=1;
function ordenarPor(i){ if(ordCol===i){ ordDir=-ordDir; } else { ordCol=i; ordDir=1; } pintarCab(); pintar(); }

/* ---------- ancho de columnas (automático por contenido; arrastrable y guardado por tabla, como DATA) ---------- */
let ANCHO_DEF={}, ANCHOS={};
try{ ANCHOS=JSON.parse(localStorage.getItem('tm2_cat_anchos')||'{}')||{}; }catch(e){ ANCHOS={}; }
function anchosTabla(){ if(!ANCHOS[TABLA] || typeof ANCHOS[TABLA]!=='object') ANCHOS[TABLA]={}; return ANCHOS[TABLA]; }
function anchoDe(k){ const v=anchosTabla()[k]; return (typeof v==='number'&&v>0)?v : (ANCHO_DEF[k]||100); }
function guardarAnchos(){ try{ localStorage.setItem('tm2_cat_anchos', JSON.stringify(ANCHOS)); }catch(e){} }
function anchosAuto(){
  ANCHO_DEF={};
  COLS.forEach(function(c){
    let n=c.etiqueta.length+2;
    for(let i=0;i<FILAS.length && i<300;i++){ const l=disp(FILAS[i],c).length; if(l>n) n=l; }
    let w=Math.round(n*7.2+18);
    if(c.tipo==='bool') w=Math.max(64,w);
    if(c.tipo==='lista') w+=10;
    if(c.tipo==='clave') w=130;
    ANCHO_DEF[c.k]=Math.max(56, Math.min(w, 340));
  });
}
function conAcciones(){ return PUEDE_EDITAR && !!META && (META.baja || META.alta); }
function pintarCols(){
  const cg=document.getElementById('cols'); if(!cg) return;
  // La CSP D170 ignora style="" puesto por innerHTML: los <col> van sin estilo y el ancho se fija por CSSOM.
  let total=44, h='<col data-rn="1">';
  COLS.forEach(function(c,i){ total+=anchoDe(c.k); h+='<col id="colw-'+i+'">'; });
  if(conAcciones()){ total+=40; h+='<col data-acc="1">'; }
  cg.innerHTML=h;
  const rn=cg.querySelector('col[data-rn]'); if(rn) rn.style.width='44px';
  COLS.forEach(function(c,i){ const col=document.getElementById('colw-'+i); if(col) col.style.width=anchoDe(c.k)+'px'; });
  const acc=cg.querySelector('col[data-acc]'); if(acc) acc.style.width='40px';
  const t=document.getElementById('tabla'); if(t) t.style.width=total+'px';
}
function pintarCab(){
  let h='<th class="rownum">#</th>';
  COLS.forEach(function(c,i){
    const tip=(c.edita?'editable':(esPk(c.k)?'clave (solo se escribe al dar de alta)':'solo lectura'))+(c.requerido?' · obligatorio':'');
    h+='<th class="'+(c.edita?'':'deriv')+(c.tipo==='numero'?' num':'')+'" data-i="'+i+'" data-on-click="ordenarPor('+i+')" title="'+esc(tip)+'">'+esc(c.etiqueta)+(c.requerido?' *':'')+(ordCol===i?(ordDir>0?' ▲':' ▼'):'')+'<span class="rz" data-i="'+i+'" title="Arrastra para el ancho · doble clic para reiniciar"></span></th>';
  });
  if(conAcciones()) h+='<th class="rownum"></th>';
  document.getElementById('cab').innerHTML=h;
  pintarCols();
}
/* ---------- alto de fila (densidad), compartido con DATA ---------- */
function setAlto(v){
  v=(['compacto','normal','amplio'].indexOf(v)>=0)?v:'compacto';
  const t=document.getElementById('tabla'); if(t){ t.classList.remove('alto-compacto','alto-normal','alto-amplio'); t.classList.add('alto-'+v); }
  const s=document.getElementById('fAlto'); if(s) s.value=v;
  try{ localStorage.setItem('tm2_data_alto', v); }catch(e){}
}

/* ---------- filtros de la vista por columna (selección múltiple, como DATA D196) ----------
 * Salen de la metadata: columnas tipo 'lista' y 'bool', y las de POCOS valores distintos (2..15) en lo
 * cargado —nunca la PK ni la clave—. Se combinan entre sí (Y) y dentro de uno se suman (O). */
let FILTROS=[];
const FSEL={};
let msAbierto=null;
const MAX_FILTROS=6;
function definirFiltros(){
  const out=[];
  COLS.forEach(function(c,i){
    if(c.tipo==='clave' || (esPk(c.k) && (META.pk||[]).length===1)) return;
    let ok=(c.tipo==='lista' || c.tipo==='bool');
    if(!ok){ const s={}; let n=0; for(let j=0;j<FILAS.length;j++){ const v=valCampo(FILAS[j],c.k); if(v && !s[v]){ s[v]=1; if(++n>15) break; } } ok=n>=2 && n<=15; }
    if(ok) out.push({ id:'fc_'+i, k:c.k, t:c.etiqueta, todas:'Todos', num:c.tipo==='numero' });
  });
  return out.slice(0, MAX_FILTROS);
}
function pasaFiltros(r, salvo){ return FILTROS.every(function(f){ return f.id===salvo || !FSEL[f.id] || !FSEL[f.id].size || FSEL[f.id].has(valCampo(r,f.k)); }); }
function ordenarVals(f, arr){ return arr.sort(f.num ? function(a,b){ return (num(a)||0)-(num(b)||0); } : function(a,b){ return a.localeCompare(b,'es'); }); }
function valoresFiltro(f){
  const cnt={};
  FILAS.forEach(function(r){ if(r._baja || !pasaFiltros(r, f.id)) return; const v=valCampo(r,f.k); if(v) cnt[v]=(cnt[v]||0)+1; });
  FSEL[f.id].forEach(function(v){ if(!(v in cnt)) cnt[v]=0; });
  return ordenarVals(f, Object.keys(cnt)).map(function(v){ return { v:v, n:cnt[v] }; });
}
function etiquetaFiltro(f){
  const sel=ordenarVals(f, Array.from(FSEL[f.id]));
  if(!sel.length) return f.todas;
  if(sel.length===1) return sel[0];
  const corto=sel.join(', ');
  return (corto.length<=18) ? corto : (sel.length+' elegidos');
}
function montarFiltrosCols(){
  const cont=document.getElementById('fCols'); if(!cont) return;
  msAbierto=null;
  cont.innerHTML=FILTROS.map(function(f){ return '<div class="f ms" id="'+esc(f.id)+'"></div>'; }).join('');
  FILTROS.forEach(function(f){
    if(!FSEL[f.id]) FSEL[f.id]=new Set();
    const box=document.getElementById(f.id); if(!box) return;
    box.innerHTML='<button type="button" class="ms-btn" aria-haspopup="listbox"><span class="t">'+esc(f.t)+'</span><span class="v"></span></button><div class="ms-pop" hidden></div>';
    box.querySelector('.ms-btn').addEventListener('click', function(ev){ ev.stopPropagation(); if(msAbierto===f.id) cerrarFiltro(); else abrirFiltro(f.id); });
    const pop=box.querySelector('.ms-pop');
    pop.addEventListener('click', function(ev){ ev.stopPropagation(); });
    pop.addEventListener('change', function(ev){
      const cb=ev.target; if(!cb || cb.type!=='checkbox') return;
      if(cb.checked) FSEL[f.id].add(cb.value); else FSEL[f.id].delete(cb.value);
      pintar();
    });
  });
  pintarEtiquetasFiltros();
}
function pintarEtiquetasFiltros(){
  FILTROS.forEach(function(f){
    const box=document.getElementById(f.id); if(!box) return; const v=box.querySelector('.ms-btn .v'); if(!v) return;
    v.textContent=etiquetaFiltro(f);
    box.querySelector('.ms-btn').title=f.t+': '+(FSEL[f.id].size ? ordenarVals(f,Array.from(FSEL[f.id])).join(' · ') : f.todas);
    box.classList.toggle('activo', FSEL[f.id].size>0);
  });
  actualizarBtnFiltros();
}
function abrirFiltro(id){
  cerrarFiltro(); cerrarMenu();
  const f=FILTROS.filter(function(x){ return x.id===id; })[0], box=document.getElementById(id); if(!f||!box) return;
  const pop=box.querySelector('.ms-pop'); msAbierto=id;
  const vals=valoresFiltro(f);
  let h='';
  if(vals.length>7) h+='<input type="text" class="ms-q" placeholder="Buscar…" aria-label="Buscar en '+esc(f.t)+'">';
  h+='<div class="ms-acc"><button type="button" data-a="todo">Marcar todo</button><button type="button" data-a="nada">Quitar filtro</button></div><div class="ms-lista">';
  vals.forEach(function(o){
    h+='<label class="ms-op'+(o.n?'':' cero')+'"><input type="checkbox" value="'+esc(o.v)+'"'+(FSEL[id].has(o.v)?' checked':'')+'><span class="txt">'+esc(o.v)+'</span><em>'+o.n+'</em><button type="button" class="solo" data-solo="'+esc(o.v)+'" title="Solo este">solo</button></label>';
  });
  if(!vals.length) h+='<div class="ms-vacio">Sin valores en lo cargado.</div>';
  pop.innerHTML=h+'</div>'; pop.hidden=false; box.classList.add('abierto');
  const q=pop.querySelector('.ms-q');
  if(q){ q.addEventListener('input', function(){ const t=normNom(q.value); pop.querySelectorAll('.ms-op').forEach(function(l){ l.hidden = !!t && normNom(l.querySelector('.txt').textContent).indexOf(t)<0; }); }); setTimeout(function(){ q.focus(); },0); }
  pop.querySelectorAll('.ms-acc button').forEach(function(b){ b.addEventListener('click', function(){
    if(b.dataset.a==='nada'){ FSEL[id].clear(); pop.querySelectorAll('input[type=checkbox]').forEach(function(cb){ cb.checked=false; }); }
    else { pop.querySelectorAll('.ms-op:not([hidden]) input[type=checkbox]').forEach(function(cb){ cb.checked=true; FSEL[id].add(cb.value); }); }
    pintar();
  }); });
  pop.querySelectorAll('button.solo').forEach(function(b){ b.addEventListener('click', function(ev){
    ev.preventDefault(); FSEL[id].clear(); FSEL[id].add(b.dataset.solo);
    pop.querySelectorAll('input[type=checkbox]').forEach(function(cb){ cb.checked=(cb.value===b.dataset.solo); }); pintar();
  }); });
}
function cerrarFiltro(){
  if(!msAbierto) return; const box=document.getElementById(msAbierto); msAbierto=null;
  if(box){ const pop=box.querySelector('.ms-pop'); if(pop){ pop.hidden=true; pop.innerHTML=''; } box.classList.remove('abierto'); }
}
// Tras cargar: rehace la lista de filtros (depende de los valores) conservando lo marcado que siga existiendo.
function llenarFiltros(){
  FILTROS=definirFiltros();
  FILTROS.forEach(function(f){
    if(!FSEL[f.id]) FSEL[f.id]=new Set();
    const hay={}; FILAS.forEach(function(r){ if(!r._baja) hay[valCampo(r,f.k)]=true; });
    Array.from(FSEL[f.id]).forEach(function(v){ if(!hay[v]) FSEL[f.id].delete(v); });
  });
  montarFiltrosCols();
}
function quitarFiltros(){ Object.keys(FSEL).forEach(function(k){ FSEL[k].clear(); }); const q=document.getElementById('q'); if(q) q.value=''; }
function limpiarFiltros(){ quitarFiltros(); cerrarFiltro(); pintar(); }
function filtrarPorValor(k, v){ const f=FILTROS.filter(function(x){ return x.k===k; })[0]; if(!f) return; FSEL[f.id].clear(); if(v) FSEL[f.id].add(v); pintar(); }
function filasVisibles(){
  const q=normNom(document.getElementById('q').value);
  let vis=FILAS.filter(function(r){ return !r._baja && (r._alta || pasaFiltros(r, null)); });
  if(q) vis=vis.filter(function(r){ return r._alta || COLS.some(function(c){ return c.tipo!=='clave' && normNom(disp(r,c)).indexOf(q)>=0; }); });
  if(ordCol>=0 && COLS[ordCol]){
    const c=COLS[ordCol], k=c.k, esNum=(c.tipo==='numero');
    vis=vis.slice().sort(function(a,b){
      if(esNum){ const na=num(a[k]), nb=num(b[k]); return ((na==null?-Infinity:na)-(nb==null?-Infinity:nb))*ordDir; }
      const va=normNom(disp(a,c)), vb=normNom(disp(b,c)); return (va<vb?-1:va>vb?1:0)*ordDir;
    });
  }
  return vis;
}
function celHTML(r, c, ci, ri){
  const ed=colEditable(r,c), err=ERRORES[r._key+'|'+c.k];
  const vacioReq=r._alta && c.requerido && ed && disp(r,c)==='';
  const cls='cell'+(ed?'':' deriv')+(c.tipo==='numero'?' num':'')+(c.tipo==='clave'?' col-clave':'')+(err?' error':'')+(vacioReq?' vacio-req':'')+' col-'+c.k;
  const d=disp(r,c), tit=err ? err : d;
  return '<td class="'+cls+'" data-r="'+ri+'" data-c="'+ci+'"><div class="cv" title="'+esc(tit)+'">'+esc(d)+'</div></td>';
}
function filaHTML(r, ri){
  const errFila=ERRORES[r._key+'|*'], aviso=AVISOS[claveDe(r)];
  const hayErr=!!errFila || COLS.some(function(c){ return ERRORES[r._key+'|'+c.k]; });
  let h='<tr data-r="'+ri+'" data-fila="'+esc(r._key)+'" class="'+(esDirty(r)?'dirty ':'')+(hayErr?'con-error ':'')+(aviso?'con-aviso':'')+'">';
  h+='<td class="rownum" title="'+esc(errFila||aviso||'')+'">'+(r._alta?'+':(ri+1))+'</td>';
  COLS.forEach(function(c,ci){ h+=celHTML(r,c,ci,ri); });
  if(conAcciones()){
    const puede = r._alta || META.baja;
    const tit = r._alta ? 'Quitar fila nueva' : (META.baja_es==='descartar' ? 'Descartar fila' : 'Eliminar fila');
    h+='<td class="rownum acc">'+(puede?'<button class="xbtn" title="'+esc(tit)+'" data-on-click="bajaFila(\''+esc(r._key)+'\')">✕</button>':'')+'</td>';
  }
  return h+'</tr>';
}
function pintar(){
  const fa=act&&VIS[act.r], fb=anc&&VIS[anc.r];
  VIS=filasVisibles();
  if(act){ const ia=VIS.indexOf(fa), ib=VIS.indexOf(fb); if(ia<0||ib<0){ act=anc=null; } else { act={r:ia,c:act.c}; anc={r:ib,c:anc.c}; } }
  const cuerpo=document.getElementById('cuerpo');
  cuerpo.innerHTML = VIS.length ? VIS.map(filaHTML).join('') : '<tr><td class="vacio" colspan="'+(COLS.length+2)+'">'+(FILAS.length?'Ninguna fila pasa los filtros.':'Sin filas.')+'</td></tr>';
  pintarKPIs(); aplicaSel();
  pintarEtiquetasFiltros();
}

/* ---------- selección / navegación (modo hoja de cálculo, igual que DATA) ---------- */
function tdDe(r,c){ return document.querySelector('#cuerpo td.cell[data-r="'+r+'"][data-c="'+c+'"]'); }
function setActiva(r,c,extender,scroll){
  if(!VIS.length || !COLS.length) return;
  r=Math.max(0,Math.min(r,VIS.length-1)); c=Math.max(0,Math.min(c,COLS.length-1));
  act={r:r,c:c}; if(!extender||!anc) anc={r:r,c:c};
  aplicaSel();
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
function opcionesEditor(c){
  if(c.tipo==='bool') return [{value:'sí',label:'sí'},{value:'no',label:'no'}];
  const ops=normOpciones(c.opciones);
  if(!ops.some(function(o){ return o.value===''; })) ops.unshift({value:'',label:''});
  return ops;
}
function beginEdit(r,c,inicial){
  const col=COLS[c], row=VIS[r]; if(!col || !row) return;
  if(!colEditable(row,col)){ setActiva(r,c,false,false); toast('«'+col.etiqueta+'» no se puede editar'+(esPk(col.k)?' (es la clave de la fila; solo se escribe al dar de alta).':'.')); return; }
  setActiva(r,c,false,false);
  const td=tdDe(r,c); if(!td) return;
  editando={r:r,c:c};
  let el;
  if(col.tipo==='lista' || col.tipo==='bool'){
    el=document.createElement('select'); el.className='editor';
    const ops=opcionesEditor(col), actual=(col.tipo==='bool') ? valTxt(col,row[col.k]) : String(row[col.k]==null?'':row[col.k]);
    // Un valor viejo fuera de la lista se ofrece TAL CUAL (si no, el select lo borraría al salir).
    if(!ops.some(function(o){ return o.value===actual; })) ops.push({value:actual,label:actual});
    let elegida=actual;
    if(inicial!==undefined && inicial!==null){ const t=normNom(inicial); const m=ops.filter(function(o){ return o.value && (normNom(o.label).indexOf(t)===0 || normNom(o.value).indexOf(t)===0); })[0]; if(m) elegida=m.value; }
    ops.forEach(function(o){ const op=document.createElement('option'); op.value=o.value; op.textContent=o.label||'—'; if(o.value===elegida) op.selected=true; el.appendChild(op); });
  } else {
    el=document.createElement('input'); el.className='editor';
    el.type=(col.tipo==='fecha' && !/T\d/.test(String(row[col.k]||'')))?'date':(col.tipo==='clave'?'password':'text');
    if(col.tipo==='clave'){ el.autocomplete='new-password'; el.placeholder='vacío = no cambiar'; }
    if(col.tipo==='numero'){ el.classList.add('num'); el.inputMode='decimal'; }
    el.value = (inicial!==undefined && inicial!==null) ? inicial : valTxt(col, row[col.k]);
  }
  td.classList.add('editando'); const cv=td.querySelector('.cv'); if(cv) cv.style.display='none'; td.appendChild(el);
  el.focus(); if(el.select && el.type!=='date' && inicial===undefined) el.select();
  el.addEventListener('keydown', function(ev){
    if(ev.key==='Enter'){ ev.preventDefault(); commitEdit(1,0); }
    else if(ev.key==='Tab'){ ev.preventDefault(); commitEdit(0, ev.shiftKey?-1:1); }
    else if(ev.key==='Escape'){ ev.preventDefault(); cancelEdit(); }
    ev.stopPropagation();
  });
  el.addEventListener('blur', function(){ if(editando) commitEdit(0,0); });
}
function commitEdit(dr,dc){
  if(!editando) return;
  const r=editando.r, c=editando.c; const td=tdDe(r,c); const el=td&&td.querySelector('.editor');
  const val=el?el.value:'';
  editando=null;
  if(td){ const ed=td.querySelector('.editor'); if(ed) ed.remove(); const cv=td.querySelector('.cv'); if(cv) cv.style.display=''; td.classList.remove('editando'); }
  const row0=VIS[r], c0=COLS[c];
  if(row0 && c0 && !igual(c0, row0[c0.k], convertir(c0, val))) pushUndo();
  setValor(r,c,val);
  const wrap=document.getElementById('wrap'); if(wrap) wrap.focus({preventScroll:true});
  if(dr||dc) mover(dr,dc,false);
}
function cancelEdit(){
  if(!editando) return; const r=editando.r, c=editando.c; const td=tdDe(r,c); editando=null;
  if(td){ const ed=td.querySelector('.editor'); if(ed) ed.remove(); const cv=td.querySelector('.cv'); if(cv) cv.style.display=''; td.classList.remove('editando'); }
  const wrap=document.getElementById('wrap'); if(wrap) wrap.focus({preventScroll:true});
}
// Texto (tecleado, pegado, rellenado) → valor de la columna. Listas: la grafía de la opción si coincide salvo
// mayúsculas/tildes (o por su etiqueta); si no, tal cual (el servidor lo rechaza con su motivo).
function convertir(c, val){
  if(c.tipo==='bool'){ if(typeof val==='boolean') return val; return /^(s|1|true|x|✓)/i.test(String(val==null?'':val).trim()); }
  if(c.tipo==='lista'){
    const t=normNom(val); if(!t) return '';
    const m=normOpciones(c.opciones).filter(function(o){ return normNom(o.value)===t || normNom(o.label)===t; })[0];
    return m ? m.value : String(val).trim();
  }
  if(c.tipo==='clave') return String(val==null?'':val);
  if(c.tipo==='fecha' || c.tipo==='numero') return String(val==null?'':val).trim();
  return String(val==null?'':val);
}
function setValor(r,c,val){
  const row=VIS[r], col=COLS[c]; if(!row || !col) return false;
  if(!colEditable(row,col)) return false;
  const v=convertir(col, val);
  if(igual(col, row[col.k], v)){ refrescarFila(r); return false; }
  row[col.k]=v;
  delete ERRORES[row._key+'|'+col.k];
  refrescarFila(r); actualizarDirty();
  return true;
}
function refrescarFila(r){
  const row=VIS[r], tr=document.querySelector('#cuerpo tr[data-r="'+r+'"]'); if(!tr || !row) return;
  COLS.forEach(function(c,ci){
    const td=tr.querySelector('td[data-c="'+ci+'"]'); if(!td) return; const cv=td.querySelector('.cv');
    const err=ERRORES[row._key+'|'+c.k], d=disp(row,c);
    if(cv){ cv.textContent=d; cv.title=err||d; }
    td.classList.toggle('error', !!err);
    td.classList.toggle('vacio-req', !!(row._alta && c.requerido && colEditable(row,c) && d===''));
  });
  tr.classList.toggle('dirty', esDirty(row));
}

/* ---------- deshacer / rehacer (Ctrl+Z / Ctrl+Y) — instantáneas de FILAS ---------- */
function snapEstado(){ return JSON.stringify(FILAS); }
function pushUndo(){ undoStack.push(snapEstado()); if(undoStack.length>80) undoStack.shift(); redoStack.length=0; actualizarUndoBtns(); }
function restaurar(js){ FILAS=JSON.parse(js); act=anc=editando=null; pintar(); actualizarDirty(); actualizarUndoBtns(); }
function deshacer(){ if(!undoStack.length){ toast('Nada que deshacer.'); return; } redoStack.push(snapEstado()); restaurar(undoStack.pop()); toast('Deshecho.'); }
function rehacer(){ if(!redoStack.length){ toast('Nada que rehacer.'); return; } undoStack.push(snapEstado()); restaurar(redoStack.pop()); toast('Rehecho.'); }
function actualizarUndoBtns(){ const u=document.getElementById('btnUndo'), r=document.getElementById('btnRedo'); if(u) u.disabled=!undoStack.length; if(r) r.disabled=!redoStack.length; }

/* ---------- teclado + eventos de la tabla (copia del motor de DATA) ---------- */
function montarEventos(){
  const cuerpo=document.getElementById('cuerpo'), wrap=document.getElementById('wrap');
  let arrastrando=false;
  cuerpo.addEventListener('mousedown', function(ev){
    if(ev.button!==0) return;
    const td=ev.target.closest && ev.target.closest('td.cell'); if(!td) return;
    if(ev.target.closest('.editor')) return;
    ev.preventDefault();
    if(editando) commitEdit(0,0);
    if(wrap) wrap.focus({preventScroll:true});
    setActiva(+td.dataset.r, +td.dataset.c, ev.shiftKey, false);
    if(!ev.shiftKey) arrastrando=true;
  });
  cuerpo.addEventListener('mousemove', function(ev){
    if(!arrastrando) return;
    if((ev.buttons&1)===0){ arrastrando=false; return; }
    const td=ev.target.closest && ev.target.closest('td.cell'); if(!td) return;
    const r=+td.dataset.r, c=+td.dataset.c;
    if(act && r===act.r && c===act.c) return;
    setActiva(r, c, true, false);
  });
  document.addEventListener('mouseup', function(){ arrastrando=false; });
  cuerpo.addEventListener('dblclick', function(ev){ const td=ev.target.closest && ev.target.closest('td.cell'); if(td) beginEdit(+td.dataset.r,+td.dataset.c); });

  // ---- Ancho de columna: arrastrar la agarradera del encabezado (doble clic la reinicia) ----
  const cab=document.getElementById('cab'); let rz=null;
  cab.addEventListener('mousedown', function(ev){
    const g=ev.target.closest && ev.target.closest('.rz'); if(!g) return;
    ev.preventDefault(); ev.stopPropagation();
    const i=+g.dataset.i, c=COLS[i]; if(!c) return;
    const col=document.getElementById('colw-'+i), th=g.closest('th');
    rz={ k:c.k, col:col, x0:ev.clientX, w0:(th?Math.round(th.getBoundingClientRect().width):anchoDe(c.k)), w:anchoDe(c.k) };
    document.body.classList.add('rz-activo');
  });
  document.addEventListener('mousemove', function(ev){ if(!rz) return; rz.w=Math.max(48, Math.round(rz.w0 + (ev.clientX - rz.x0))); if(rz.col) rz.col.style.width=rz.w+'px'; });
  document.addEventListener('mouseup', function(){ if(!rz) return; anchosTabla()[rz.k]=rz.w; guardarAnchos(); pintarCols(); document.body.classList.remove('rz-activo'); rz=null; });
  cab.addEventListener('dblclick', function(ev){
    const g=ev.target.closest && ev.target.closest('.rz'); if(!g) return;
    ev.preventDefault(); ev.stopPropagation();
    const c=COLS[+g.dataset.i]; if(c){ delete anchosTabla()[c.k]; guardarAnchos(); pintarCols(); }
  });
  cab.addEventListener('click', function(ev){ if(ev.target.closest && ev.target.closest('.rz')) ev.stopPropagation(); });

  wrap.addEventListener('keydown', function(ev){
    if(editando) return;
    const k=ev.key, ctrl=ev.ctrlKey||ev.metaKey, sh=ev.shiftKey;
    const FLECHA={ ArrowUp:[-1,0], ArrowDown:[1,0], ArrowLeft:[0,-1], ArrowRight:[0,1] };
    if(!act){ if(FLECHA[k]){ setActiva(0,0,false,true); ev.preventDefault(); } return; }
    const maxR=VIS.length-1, maxC=COLS.length-1;
    if(ctrl && (k==='c'||k==='C')){ return; }        // lo maneja el evento 'copy'
    if(ctrl && (k==='v'||k==='V')){ return; }        // lo maneja el evento 'paste'
    if(ctrl && sh && (k==='d'||k==='D')){ ev.preventDefault(); duplicarFilas(); return; }
    if(ctrl && (k==='d'||k==='D')){ ev.preventDefault(); rellenar(); return; }
    if(ctrl && (k==='+'||k==='=')){ ev.preventDefault(); insertarFila(false); return; }
    if(ctrl && (k==='-'||k==='_')){ ev.preventDefault(); eliminarFilas(); return; }
    if(ctrl && (k==='a'||k==='A')){ ev.preventDefault(); marcar(0,0,maxR,maxC); return; }
    if(k===' ' && sh && !ctrl){ ev.preventDefault(); marcar(anc?anc.r:act.r, 0, act.r, maxC); return; }
    if(k===' ' && ctrl){ ev.preventDefault(); marcar(0, anc?anc.c:act.c, maxR, act.c); return; }
    if(FLECHA[k]){ ev.preventDefault(); const d=FLECHA[k]; if(ctrl) saltar(d[0],d[1],sh); else mover(d[0],d[1],sh); return; }
    if(k==='Home'){ ev.preventDefault(); setActiva(ctrl?0:act.r, 0, sh, true); return; }
    if(k==='End'){ ev.preventDefault(); setActiva(ctrl?maxR:act.r, maxC, sh, true); return; }
    if(k==='PageDown'||k==='PageUp'){ ev.preventDefault(); const n=filasPorPagina(); mover(k==='PageDown'?n:-n, 0, sh); return; }
    if(k==='Tab'){ ev.preventDefault(); mover(0, sh?-1:1, false); }
    else if(k==='Enter'){ ev.preventDefault(); beginEdit(act.r,act.c); }
    else if(k==='F2'){ ev.preventDefault(); beginEdit(act.r,act.c); }
    else if(k==='Delete'||k==='Backspace'){ ev.preventDefault(); borrarSeleccion(); }
    else if(k==='ContextMenu'){ ev.preventDefault(); const td=tdDe(act.r,act.c); const b=td?td.getBoundingClientRect():{left:40,bottom:40}; abrirMenu(b.left+10, b.bottom); }
    else if(k.length===1 && !ctrl && !ev.altKey){ ev.preventDefault(); beginEdit(act.r,act.c,k); }
  });
  cuerpo.addEventListener('contextmenu', function(ev){
    const td=ev.target.closest && ev.target.closest('td.cell'); if(!td) return;
    ev.preventDefault();
    if(editando) commitEdit(0,0);
    const r=+td.dataset.r, c=+td.dataset.c, rc=rango();
    if(!(rc && r>=rc.r0 && r<=rc.r1 && c>=rc.c0 && c<=rc.c1)) setActiva(r,c,false,false);
    if(wrap) wrap.focus({preventScroll:true});
    abrirMenu(ev.clientX, ev.clientY, {r:r,c:c});
  });
  document.addEventListener('mousedown', function(ev){ const m=document.getElementById('menuCtx'); if(m && !m.hidden && !m.contains(ev.target)) cerrarMenu(); });
  document.addEventListener('keydown', function(ev){ if(ev.key==='Escape'){ cerrarMenu(); cerrarFiltro(); const at=document.getElementById('atajos'); if(at) at.hidden=true; } });
  document.addEventListener('click', function(){ cerrarFiltro(); });
  wrap.addEventListener('scroll', cerrarMenu);
  document.addEventListener('copy', function(ev){ if(editando) return; if(!enGrid()) return; const t=tsvSeleccion(); if(t==null) return; ev.preventDefault(); ev.clipboardData.setData('text/plain', t); });
  document.addEventListener('paste', function(ev){ if(editando || !PUEDE_EDITAR) return; if(!enGrid()) return; const t=(ev.clipboardData||window.clipboardData).getData('text'); if(!t) return; ev.preventDefault(); pegar(t); });
  document.addEventListener('keydown', function(ev){
    const ctrl=ev.ctrlKey||ev.metaKey; if(!ctrl) return;
    const k=(ev.key||'').toLowerCase(); if(k!=='z' && k!=='y') return;
    if(editando) return;
    const ae=document.activeElement;
    if(ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
    if(!PUEDE_EDITAR) return;
    ev.preventDefault();
    if(k==='y' || (k==='z' && ev.shiftKey)) rehacer(); else deshacer();
  });
  // Filtros de servidor: Enter en cualquiera = Consultar; las fechas repintan los chips.
  document.getElementById('srvExtra').addEventListener('keydown', function(ev){ if(ev.key==='Enter'){ ev.preventDefault(); consultar(); } });
  ['desde','hasta'].forEach(function(id){ document.getElementById(id).addEventListener('keydown', function(ev){ if(ev.key==='Enter'){ ev.preventDefault(); consultar(); } }); });
}
function enGrid(){ const w=document.getElementById('wrap'); return !!(w && (document.activeElement===w || (act && w.contains(document.activeElement)))); }

/* ---------- copiar / pegar / rellenar / borrar (sobre el rango) ---------- */
function celdaTxt(row, c){ if(!row || c.tipo==='clave') return ''; if(c.tipo==='bool') return valTxt(c,row[c.k]); return valTxt(c,row[c.k]); }
function tsvSeleccion(){ const rc=rango(); if(!rc) return null;
  const fs=[]; for(let r=rc.r0;r<=rc.r1;r++){ const cells=[]; for(let c=rc.c0;c<=rc.c1;c++) cells.push(celdaTxt(VIS[r], COLS[c])); fs.push(cells.join('\t')); } return fs.join('\n');
}
// Botón «Copiar»: con un rango marcado (más de una celda) copia ese rango; si no, TODO lo filtrado con cabeceras.
function copiarSel(btn){
  const rc=rango(); let t;
  if(rc && (rc.r1>rc.r0 || rc.c1>rc.c0)) t=tsvSeleccion();
  else t=[COLS.map(function(c){ return c.etiqueta; }).join('\t')].concat(VIS.map(function(r){ return COLS.map(function(c){ return celdaTxt(r,c); }).join('\t'); })).join('\n');
  const ok=function(){ if(btn){ btn.classList.add('copied'); const x=btn.textContent; btn.textContent='✓ Copiado'; setTimeout(function(){ btn.classList.remove('copied'); btn.textContent=x; },1400); } toast('Copiado.'); };
  if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok,function(){ fb(t); ok(); }); else { fb(t); ok(); }
  function fb(x){ const ta=document.createElement('textarea'); ta.value=x; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); }catch(e){} document.body.removeChild(ta); }
}
function pegar(txt){
  if(!act) return;
  const grid=txt.replace(/\r/g,'').replace(/\n$/,'').split('\n').map(function(l){ return l.split('\t'); });
  pushUndo();
  let n=0, saltadas=0;
  for(let dr=0;dr<grid.length;dr++){ const r=act.r+dr; if(r>=VIS.length) break;
    for(let dc=0;dc<grid[dr].length;dc++){ const c=act.c+dc; if(c>=COLS.length) break; if(!colEditable(VIS[r],COLS[c])){ saltadas++; continue; } setValor(r,c,grid[dr][dc].trim()); n++; } }
  if(n) toast('Pegadas '+n+' celda(s)'+(saltadas?(' · '+saltadas+' de solo lectura sin tocar'):'')+'.');
  else if(saltadas) toast('Esas celdas son de solo lectura.', true);
}
function rellenar(){
  const rc=rango(); if(!rc){ toast('Elige la celda o el rango a rellenar.', true); return; }
  pushUndo();
  let n=0;
  const r1=(rc.r0===rc.r1) ? VIS.length-1 : rc.r1;   // una fila marcada → hasta el final (como DATA)
  for(let c=rc.c0;c<=rc.c1;c++){ const base=VIS[rc.r0][COLS[c].k]; for(let r=rc.r0+1;r<=r1;r++){ if(setValor(r,c,base)) n++; } }
  if(n) toast('Rellenadas '+n+' celda(s).'); else undoStack.pop(), actualizarUndoBtns();
}
function borrarSeleccion(){ const rc=rango(); if(!rc) return; pushUndo(); let n=0;
  for(let r=rc.r0;r<=rc.r1;r++) for(let c=rc.c0;c<=rc.c1;c++){ if(setValor(r,c,'')) n++; }
  if(n) toast('Vaciadas '+n+' celda(s).'); else undoStack.pop(), actualizarUndoBtns();
}

/* ---------- KPIs ---------- */
function pintarKPIs(){
  document.getElementById('kFilas').textContent=VIS.length;
  const nErr=FILAS.filter(function(r){ return ERRORES[r._key+'|*'] || COLS.some(function(c){ return ERRORES[r._key+'|'+c.k]; }); }).length;
  document.getElementById('kErr').textContent=nErr;
  document.getElementById('kpiErr').classList.toggle('oculto', nErr===0);
  document.getElementById('kpiTrunc').classList.toggle('oculto', !TRUNCADO);
}
function esDirty(r){ if(r._alta||r._baja) return true; return COLS.some(function(c){ return !igual(c, r[c.k], r._orig[c.k]); }); }

/* ---------- alta / baja (según `alta`/`baja` de la metadata) ---------- */
function filaPorKey(k){ return FILAS.filter(function(r){ return String(r._key)===String(k); })[0]||null; }
function filaNueva(){ const r={ _key:'nuevo-'+(++tempSeq), _k:null, _alta:true, _baja:false, _orig:{} }; COLS.forEach(function(c){ r[c.k]=(c.tipo==='bool')?false:''; }); return r; }
function filasMarcadas(){ const rc=rango(); if(!rc) return []; const out=[]; for(let r=rc.r0;r<=rc.r1;r++) if(VIS[r]) out.push(VIS[r]); return out; }
function colocarNuevas(nuevas, ref, colFoco, editar){
  const i=ref ? FILAS.indexOf(ref) : -1;
  Array.prototype.splice.apply(FILAS, [i+1, 0].concat(nuevas));
  if(ordCol>=0){ ordCol=-1; pintarCab(); }
  pintar(); actualizarDirty();
  const r0=VIS.indexOf(nuevas[0]), c=Math.max(0, colFoco);
  if(r0<0) return;
  setActiva(r0, c, false, true);
  if(nuevas.length>1) marcar(r0, 0, r0+nuevas.length-1, COLS.length-1);
  if(editar) beginEdit(r0, c);
}
function insertarFila(editar){
  if(!PUEDE_EDITAR || !META) return; if(editando) commitEdit(0,0);
  if(!META.alta){ toast('Esta tabla no admite filas nuevas.', true); return; }
  const rc=rango(), ref=rc ? VIS[rc.r1] : null;
  pushUndo();
  colocarNuevas([filaNueva()], ref, 0, editar);
  if(!ref){ const w=document.getElementById('wrap'); if(w) w.scrollTop=0; }
}
function altaFila(){ insertarFila(true); }
function duplicarFilas(){
  if(!PUEDE_EDITAR || !META) return; if(editando) commitEdit(0,0);
  if(!META.alta){ toast('Esta tabla no admite filas nuevas.', true); return; }
  const sel=filasMarcadas(); if(!sel.length){ toast('Marca la fila o filas a duplicar.', true); return; }
  pushUndo();
  const nuevas=sel.map(function(src){ const r=filaNueva(); COLS.forEach(function(c){ if(c.tipo!=='clave') r[c.k]=src[c.k]; }); return r; });
  colocarNuevas(nuevas, sel[sel.length-1], act ? act.c : 0, false);
  toast((nuevas.length===1 ? 'Fila duplicada debajo' : ('Duplicadas '+nuevas.length+' filas debajo'))+': cambia la clave antes de guardar.');
}
function eliminarFilas(lista){
  if(!PUEDE_EDITAR || !META) return; if(editando) commitEdit(0,0);
  const sel=lista || filasMarcadas(); if(!sel.length){ toast('Marca la fila o filas a eliminar.', true); return; }
  const guardadas=sel.filter(function(r){ return !r._alta; });
  if(guardadas.length && !META.baja){ toast('Esta tabla no admite bajas'+(META.id==='usuarios'?': cambia el estado a «inactivo».':'.'), true); return; }
  const verbo=(META.baja_es==='descartar') ? 'Descartar' : 'Eliminar';
  if(guardadas.length){
    const q = guardadas.length===1 ? '¿'+verbo+' esta fila?' : '¿'+verbo+' '+guardadas.length+' filas?';
    if(!confirm(q+(META.baja_es==='descartar'?'\nEn bandeja no se borra: queda con estado «descartado».':'')+'\nSe aplica al pulsar Guardar; hasta entonces puedes deshacer con Ctrl+Z.')) return;
  }
  pushUndo();
  const quitar=new Set(sel.filter(function(r){ return r._alta; }));
  FILAS=FILAS.filter(function(r){ return !quitar.has(r); });
  guardadas.forEach(function(r){ r._baja=true; });
  const r0=act ? Math.min(act.r, anc ? anc.r : act.r) : 0, c0=act ? act.c : 0;
  act=anc=null; pintar(); actualizarDirty();
  if(VIS.length) setActiva(Math.min(r0, VIS.length-1), c0, false, false);
  const v=(META.baja_es==='descartar')?'descartada':'eliminada';
  toast(sel.length===1 ? ('Fila '+v+' (Ctrl+Z para deshacer).') : (sel.length+' filas '+v+'s (Ctrl+Z para deshacer).'));
}
function bajaFila(key){ const r=filaPorKey(key); if(r) eliminarFilas([r]); }

/* ---------- menú del clic derecho ---------- */
function cerrarMenu(){ const m=document.getElementById('menuCtx'); if(m && !m.hidden){ m.hidden=true; m.innerHTML=''; } }
function abrirMenu(x, y, cel){
  const m=document.getElementById('menuCtx'); if(!m || !act) return;
  cerrarFiltro(); cel=cel||act;
  const rc=rango(), n=rc ? rc.r1-rc.r0+1 : 1, col=COLS[cel.c], row=VIS[cel.r];
  const filas = n===1 ? 'fila' : (n+' filas');
  const items=[];
  if(PUEDE_EDITAR && META){
    if(META.alta){ items.push(['ins','Insertar fila debajo','Ctrl + +']); items.push(['dup','Duplicar '+filas,'Ctrl+Shift+D']); }
    if(META.baja || (row && row._alta)) items.push(['del',(META.baja_es==='descartar'?'Descartar ':'Eliminar ')+filas,'Ctrl + −']);
    if(items.length) items.push(null);
  }
  items.push(['copy','Copiar','Ctrl+C']);
  if(PUEDE_EDITAR){ items.push(['fill','Rellenar hacia abajo','Ctrl+D']); items.push(['clear','Vaciar celdas','Supr']); }
  const f=FILTROS.filter(function(x){ return col && x.k===col.k; })[0], v=row && col ? valCampo(row, col.k) : '';
  if(f && v){ items.push(null); items.push(['filt','Filtrar por «'+(v.length>28?v.slice(0,27)+'…':v)+'»','']); }
  if(Object.keys(FSEL).some(function(k){ return FSEL[k].size; })) items.push(['nofilt','Quitar todos los filtros','']);
  m.innerHTML=items.map(function(it){ return it ? '<button type="button" role="menuitem" data-a="'+it[0]+'"'+(it[0]==='del'?' class="peligro"':'')+'><span>'+esc(it[1])+'</span><kbd>'+esc(it[2])+'</kbd></button>' : '<hr>'; }).join('');
  m.hidden=false;
  const W=window.innerWidth, H=window.innerHeight, bw=m.offsetWidth, bh=m.offsetHeight;
  m.style.left=Math.max(4, Math.min(x, W-bw-6))+'px'; m.style.top=Math.max(4, Math.min(y, H-bh-6))+'px';
  m.onclick=function(ev){
    const b=ev.target.closest && ev.target.closest('button[data-a]'); if(!b) return; const a=b.dataset.a; cerrarMenu();
    if(a==='ins') insertarFila(false); else if(a==='dup') duplicarFilas(); else if(a==='del') eliminarFilas();
    else if(a==='copy') copiarRango(); else if(a==='fill') rellenar(); else if(a==='clear') borrarSeleccion();
    else if(a==='filt') filtrarPorValor(col.k, v); else if(a==='nofilt') limpiarFiltros();
    const w=document.getElementById('wrap'); if(w && !editando) w.focus({preventScroll:true});
  };
}
function copiarRango(){ const t=tsvSeleccion(); if(t==null) return; if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function(){ toast('Copiado.'); }, function(){}); }
function verAtajos(){ const a=document.getElementById('atajos'); if(a) a.hidden=!a.hidden; }

/* ---------- navegación tipo Excel ---------- */
function vaciaCel(r,c){ const row=VIS[r]; return !row || valCampo(row, COLS[c].k)===''; }
function saltar(dr, dc, extender){
  if(!act){ setActiva(0,0,false,true); return; }
  const maxR=VIS.length-1, maxC=COLS.length-1;
  const dentro=function(r,c){ return r>=0 && r<=maxR && c>=0 && c<=maxC; };
  let r=act.r, c=act.c;
  if(dentro(r+dr, c+dc)){
    if(!vaciaCel(r,c) && !vaciaCel(r+dr,c+dc)){ while(dentro(r+dr,c+dc) && !vaciaCel(r+dr,c+dc)){ r+=dr; c+=dc; } }
    else { r+=dr; c+=dc; while(dentro(r+dr,c+dc) && vaciaCel(r,c)){ r+=dr; c+=dc; } }
  }
  setActiva(r, c, extender, true);
}
function filasPorPagina(){ const w=document.getElementById('wrap'), td=document.querySelector('#cuerpo td.cell'); return Math.max(5, Math.floor(((w&&w.clientHeight)||500)/((td&&td.offsetHeight)||23))-2); }
function marcar(r0, c0, r1, c1){ anc={r:r0,c:c0}; act={r:r1,c:c1}; aplicaSel(); }

/* ---------- guardar (cat_guardar: alta / update / baja por lote, atómico en el servidor) ---------- */
function snapshotCols(r){ const out={}; COLS.forEach(function(c){ out[c.k]=r._orig[c.k]; }); return out; }
function valorEnvio(c, v){ return (c.tipo==='bool') ? !!v : v; }
function camposAlta(r){ const out={}; COLS.forEach(function(c){ if(c.edita || esPk(c.k)) out[c.k]=valorEnvio(c, r[c.k]); }); return out; }
function dirtyCambios(){
  const cambios=[]; CAMBIOS_ROWS=[];
  FILAS.forEach(function(r){
    if(r._baja && !r._alta){ cambios.push({ op:'baja', k:r._k, antes:snapshotCols(r) }); CAMBIOS_ROWS.push(r._key); return; }
    if(r._baja) return;
    if(r._alta){ cambios.push({ op:'alta', campos:camposAlta(r) }); CAMBIOS_ROWS.push(r._key); return; }
    if(esDirty(r)){
      const campos={};
      COLS.forEach(function(c){ if(c.edita && !igual(c, r[c.k], r._orig[c.k])) campos[c.k]=valorEnvio(c, r[c.k]); });
      cambios.push({ op:'update', k:r._k, antes:snapshotCols(r), campos:campos });
      CAMBIOS_ROWS.push(r._key);
    }
  });
  return cambios;
}
function actualizarDirty(){ const n=dirtyCambios().length; const b=document.getElementById('btnGuardar'), c=document.getElementById('nDirty'); if(c) c.textContent=n; if(b) b.disabled=n===0; }
function pintarAvisos(){
  const box=document.getElementById('avisos'); const claves=Object.keys(AVISOS);
  if(!claves.length){ box.style.display='none'; box.innerHTML=''; return; }
  box.style.display='block';
  box.innerHTML='<span class="tit">Aviso:</span><ul>'+claves.map(function(k){ return '<li>'+esc(AVISOS[k])+' — <a href="data.html">abrir Revisión de DATA</a></li>'; }).join('')+'</ul>';
}
async function guardar(btn){
  if(editando) commitEdit(0,0);
  const cambios=dirtyCambios(); if(!cambios.length){ toast('No hay cambios que guardar.'); return; }
  const filasEnvio=CAMBIOS_ROWS.slice();
  if(btn) btn.disabled=true;
  let d; try{ d=await api(null, { action:'cat_guardar', tabla:TABLA, cambios:cambios }); }catch(e){ d={ok:false, error:'Sin conexión.'}; }
  if(caducada(d)) return;
  if(d && d.ok){
    AVISOS={}; (d.avisos||[]).forEach(function(a){ AVISOS[JSON.stringify(a.clave)]=a.texto; });
    ERRORES={};
    await cargarDatos();   // recarga con los filtros vigentes (más simple y segura que fusionar las filas devueltas)
    pintarAvisos();
    toast('Guardados '+(d.aplicados==null?cambios.length:d.aplicados)+' cambio(s).');
    return;
  }
  actualizarDirty();
  if(d && d.conflicto){
    toast(d.error||'Otra persona cambió estos datos: recarga.', true);
    if(confirm((d.error||'Otra persona cambió estos datos.')+'\n¿Recargar ahora? (se pierden tus cambios sin guardar)')) cargarDatos();
    return;
  }
  if(d && d.errores && d.errores.length){
    ERRORES={};
    d.errores.forEach(function(e){
      const key=filasEnvio[e.i]; if(key===undefined) return;
      const esCol=COLS.some(function(c){ return c.k===e.campo; });
      const clave=key+'|'+(esCol?e.campo:'*');
      ERRORES[clave]=ERRORES[clave] ? (ERRORES[clave]+' · '+e.motivo) : e.motivo;
    });
    pintar();
    toast('Hay '+d.errores.length+' error(es): '+d.errores[0].motivo+(d.errores.length>1?' (revisa las celdas en rojo)':''), true);
    return;
  }
  toast((d&&d.error)||'No se guardó.', true);
}

/* ---------- rangos rápidos de fechas (mismos chips que DATA, sin los de acta) ---------- */
function rangosRapidos(){
  const h=hoyBogota(), dow=(new Date(h+'T12:00:00Z').getUTCDay()+6)%7;
  return [
    { t:'Hoy',         desde:h,               hasta:h },
    { t:'Ayer',        desde:isoMenos(h,1),   hasta:isoMenos(h,1) },
    { t:'Esta semana', desde:isoMenos(h,dow), hasta:h },
    { t:'7 días',      desde:isoMenos(h,6),   hasta:h },
  ];
}
function pintarRapidos(){
  const box=document.getElementById('rapidos'); if(!box) return;
  if(!hayFechas()){ box.innerHTML=''; return; }
  const d=document.getElementById('desde').value, a=document.getElementById('hasta').value||d;
  box.innerHTML=rangosRapidos().map(function(x){ return '<button type="button" class="chip'+(x.desde===d&&x.hasta===a?' on':'')+'" data-d="'+x.desde+'" data-h="'+x.hasta+'" title="'+x.desde+' → '+x.hasta+'">'+esc(x.t)+'</button>'; }).join('');
}
function montarRapidos(){
  const box=document.getElementById('rapidos');
  box.addEventListener('click', function(ev){
    const b=ev.target.closest && ev.target.closest('button[data-d]'); if(!b) return;
    if(dirtyCambios().length && !confirm('Hay cambios sin guardar. ¿Descartarlos y cargar otro rango?')) return;
    document.getElementById('desde').value=b.dataset.d; document.getElementById('hasta').value=b.dataset.h;
    pintarRapidos(); leerSrv(); cargarDatos();
  });
  const de=document.getElementById('desde'), ha=document.getElementById('hasta');
  de.addEventListener('change', function(){ if(ha.value && de.value>ha.value) ha.value=de.value; pintarRapidos(); });
  ha.addEventListener('change', pintarRapidos);
}

/* ---------- ocultar filtros (como DATA V3-17; se recuerda aparte) ---------- */
// Por defecto OCULTOS (pedido del dueño: que la hoja aproveche el alto); se recuerda lo que elija con el botón.
function filtrosOcultosGuardado(){ try{ return localStorage.getItem('tm2_cat_filtros_ocultos')!=='0'; }catch(e){ return true; } }
function guardarFiltrosOcultos(v){ try{ localStorage.setItem('tm2_cat_filtros_ocultos', v?'1':'0'); }catch(e){} }
function filtrosAplicadosN(){
  const q=document.getElementById('q');
  const srv=FILTROS_DEF.filter(function(f){ return f.tipo!=='fecha' && String(FILTROS_VAL[f.id]||'').trim()!==''; }).length;   // bandeja: PK, reporta… (van con Consultar)
  return FILTROS.filter(function(f){ return FSEL[f.id] && FSEL[f.id].size>0; }).length + ((q && q.value.trim())?1:0) + srv;
}
function estaFiltrosOculto(){ const f=document.getElementById('filtros'); return !!(f && f.classList.contains('oculto')); }
function actualizarBtnFiltros(){
  const b=document.getElementById('btnFiltrosToggle'); if(!b) return;
  const oculto=estaFiltrosOculto(), n=filtrosAplicadosN();
  b.textContent=(oculto?'Mostrar filtros':'Ocultar filtros')+((oculto&&n)?' ('+n+')':'');
}
function aplicarFiltrosOcultos(oculto){
  ['filtros','intro'].forEach(function(id){ const el=document.getElementById(id); if(el) el.classList.toggle('oculto', oculto); });
  const sx=document.getElementById('srvExtra'); if(sx) sx.hidden = oculto || !sx.innerHTML;
  guardarFiltrosOcultos(oculto); actualizarBtnFiltros();
}
function toggleFiltrosVista(){ aplicarFiltrosOcultos(!estaFiltrosOculto()); }

window.addEventListener('beforeunload', function(e){ if(ES_ADMIN && TABLA && dirtyCambios().length){ e.preventDefault(); e.returnValue=''; } });

/* ---------- arranque ---------- */
if(ES_ADMIN){
  montarEventos(); montarRapidos();
  try{ setAlto(localStorage.getItem('tm2_data_alto')||'compacto'); }catch(e){ setAlto('compacto'); }
  aplicarFiltrosOcultos(filtrosOcultosGuardado());
  cargarTablas();
}
