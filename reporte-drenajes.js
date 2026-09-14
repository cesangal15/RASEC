// D170: aplica los data-estilo del marcado ANTES de que corra la lógica de la pantalla (ver tema.js).
if(window.TM2Estilos) TM2Estilos.aplicar();
const APPS_SCRIPT_URL = GALCA_ENV.url.obra;          // entorno.js (D168): producción o prueba

/* Área(s) del formulario (D70/D84): 'odt' (marcador obligatorio, ítems .06.*) u 'odl' (PK o marcador
 * opcional para el descole, ítems .07.*). Viene del rol logueado o del campo `areas` del login.
 * D84: un capataz puede tener AMBAS áreas → el desplegable ofrece todos los ítems 06.* y 07.* y el
 * área de CADA línea se deriva del CC del ítem elegido (06→odt, 07→odl). Con una sola área el
 * formulario se comporta EXACTAMENTE igual que hoy (no-regresión). */
let AREA='odt';        // área "activa" en modo de una sola área (compat)
let AREAS=['odt'];     // array de áreas habilitadas
let MULTI=false;       // true = capataz/residente con las dos áreas
/* D84: helper único de áreas (mismo criterio que el backend). El campo `areas` del login (capataz de
 * drenajes con ambos capítulos) tiene prioridad; si no, se deriva del rol como hoy. */
function resolverAreas(rol){
  try{ const a=JSON.parse(localStorage.getItem('areas')||'null');
    if(Array.isArray(a)){ const f=a.filter(x=>x==='odt'||x==='odl'); if(f.length) return f; } }catch(e){}
  if(rol==='capataz_odt'||rol==='residente_odt') return ['odt'];
  if(rol==='capataz_odl'||rol==='residente_odl') return ['odl'];
  if(rol==='residente_dren'||rol==='admin') return ['odt','odl'];   // D84: unificado / admin ven ambas
  return ['odt'];
}
/* Catálogo servido por ?action=drenajes (la BASE no es accesible desde Pages):
 * MARCADORES = 147 puntuales ODT* (elemento verbatim + abs en metros + PK formateado);
 * ITEMS = ítems .06/.07 por proyecto, DESCRIPCION verbatim de la celda (typos incluidos: NO
 * "corregir" p. ej. "Excavaciones varias sin clasicar" ni el sufijo " ODL" — pivotes del maestro).
 * Para el dropdown se deduplican por CC corto + descripción (los dos proyectos traen el mismo
 * ítem); el CC final = proyecto derivado del PK/marcador (D04) + código corto, como en tierras. */
let MARCADORES=[], ITEMS=[];
/* ACUM (pedido ODT, D70): acumulado ya ENVIADO A DATA (oficial) por marcador + CC corto, para que
 * el capataz vea cuánto acero lleva reportado en esa ODT antes de sumar lo del día. Mapa
 * "ELEMENTO||CCcorto" -> cantidad. Se pide a ?action=acumulado_drenajes al cargar la pantalla; NO
 * incluye lo pendiente de hoy sin enviar (es el consolidado oficial, solo lo que ya está en DATA). */
let ACUM={};

let lineaIdx=0, eqIdx=0;

window.onload = async function(){
  // D82: sesión en localStorage (sobrevive cierre del navegador en zona muerta)
  const rol=localStorage.getItem('rol'), usuario=localStorage.getItem('usuario');
  const OK=['capataz_odt','capataz_odl','residente_odt','residente_odl','residente_dren','admin'];
  if(!rol || OK.indexOf(rol)<0){ window.location.href='index.html'; return; }
  document.getElementById('userDisplay').textContent=usuario||'capataz';
  AREAS=resolverAreas(rol); MULTI=AREAS.length>1; AREA=AREAS[0];
  // El selector de área del admin (una sola área) ya no aplica: el admin ve las dos áreas y el área de
  // cada línea se deriva del CC (D84). Queda oculto. Solo se muestra el botón de menú para el admin.
  if(rol==='admin'){ var _bm=document.getElementById('btnMenu'); if(_bm) _bm.style.display='inline-block'; }
  // el residente entra desde su panel: el botón vuelve allá sin cerrar sesión (patrón encargado)
  if(rol==='residente_odt'||rol==='residente_odl'||rol==='residente_dren') document.getElementById('backBtn').textContent='← Volver';
  pintarTitulo();
  document.getElementById('fechaReporte').value=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'}); // D50
  await cargarCatalogo();
};
function logout(){
  const rol=localStorage.getItem('rol');
  if(rol==='residente_odt'||rol==='residente_odl'||rol==='residente_dren'){ window.location.href='residente-drenajes.html'; return; }
  // solo la sesión: la cola de envíos pendientes NO se borra al cerrar sesión (D82)
  localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token');
  window.location.href='index.html';
}
function pintarTitulo(){
  const n = MULTI ? 'ODT + ODL' : ((AREA==='odt')?'ODT · Transversal':'ODL · Longitudinal');
  const tag = MULTI ? 'ODT+ODL' : (AREA==='odt'?'ODT':'ODL');
  document.getElementById('hdrLabel').textContent='Reporte Diario · Drenajes '+tag;
  document.getElementById('hdrTitle').textContent='🚧 Drenajes — '+n;
}
// (Selector de área del admin — dead en D84; se conserva por si se reactivara una sola área.)
function cambiarArea(){
  AREA=document.getElementById('areaSel').value==='odl'?'odl':'odt'; AREAS=[AREA]; MULTI=false;
  pintarTitulo();
  document.getElementById('cantidadesContainer').innerHTML=''; lineaIdx=0;
  addLinea(); refreshCounts();
}
// D82 §2.7: catálogo con caché-fallback. Fresco si hay señal (y guarda copia local); sin señal usa
// la última copia con un banner ámbar informativo (no bloquea). Sin señal Y sin copia: hay que abrir
// la pantalla con señal al menos una vez.
async function cargarCatalogo(){
  try{
    const r=await TM2Offline.catalogoCache('drenajes', async function(){
      const resp=await fetch(APPS_SCRIPT_URL+'?action=drenajes');
      const data=await resp.json();
      if(!data || !data.ok) throw new Error((data&&data.error)||'Respuesta inesperada');
      return { marcadores:(data.marcadores||[]), items:(data.items||[]) };
    }, 24);
    MARCADORES=(r.data.marcadores||[]);
    ITEMS=(r.data.items||[]);
    if(!r.fresco) TM2Offline.bannerCatalogoViejo(document.querySelector('.container'),
      'Sin señal: usando el catálogo del '+TM2Offline.fechaCorta(r.guardado)+' (marcadores e ítems guardados). Se actualizará solo al volver la señal.');
    document.getElementById('catLoading').style.display='none';
    document.getElementById('btnAddLinea').style.display='block';
    cargarAcumulado();      // en paralelo; no bloquea el formulario si falla (offline: sin acumulado)
    addLinea();
  }catch(err){
    document.getElementById('catLoading').innerHTML='⚠ No se pudo cargar el catálogo de la BASE ('+esc(err.message)+').<br>Si estás sin señal: necesitas abrir esta pantalla con señal al menos una vez para guardar una copia en el teléfono. <a href="#" data-on-click="cargarCatalogo();return false;" data-estilo="color:var(--accent-txt)">Reintentar</a>';
  }
}
// Acumulado oficial (DATA) por marcador+CC del área. Best-effort: si falla, el formulario sigue
// funcionando sin el aviso de acumulado.
async function cargarAcumulado(){
  try{
    // D84: en modo multi-área se pide el acumulado de AMBAS (sin &area=); las llaves son ELEMENTO||CC,
    // así que ODT y ODL no colisionan. En una sola área se filtra por ella (como hoy).
    const resp=await fetch(APPS_SCRIPT_URL+'?action=acumulado_drenajes'+(MULTI?'':('&area='+AREA)));
    const data=await resp.json();
    if(data && data.ok) ACUM=data.acumulado||{};
    document.querySelectorAll('#cantidadesContainer .linea').forEach(b=>refreshLinea(parseInt(b.id.split('_')[1],10)));
  }catch(err){ /* silencioso: el acumulado es informativo */ }
}

/* helpers de PK — mismos del resto de pantallas (Problema 2.12) */
function pkToMeters(pk){ if(!pk) return null; pk=String(pk).toLowerCase().replace(/pk/g,'').trim().replace(/\s/g,''); if(pk.includes('+')){const p=pk.split('+');const km=parseInt(p[0]);const m=parseInt(p[1]||'0');if(isNaN(km))return null;return km*1000+(isNaN(m)?0:m);} const n=parseFloat(pk);return isNaN(n)?null:n*1000; }
function pkNorm(s){ const m=pkToMeters(s); if(m==null) return ''; const km=Math.floor(m/1000), r=Math.round(m-km*1000); return km+'+'+('00'+r).slice(-3); }
function buildElemento(pki,pkf){
  let ini=pki, fin=pkf;
  if((fin==null||fin==='') && pki!=null){ const p=String(pki).split(/\s*-\s*/); if(p.length>=2){ ini=p[0]; fin=p.slice(1).join(' - '); } }
  const a=pkNorm(ini); if(!a) return '';
  const b=pkNorm(fin); return b? ('tm2 pk '+a+' - '+b) : ('tm2 pk '+a);
}
function ufFromMeters(m){ if(m==null) return ''; return m<=30000?'UF1':'UF2'; }
function proyectoFromUf(uf){ return uf==='UF1'?'3701':uf==='UF2'?'3702':''; }
function fmtNum(n){ if(n==null||isNaN(n)) return '0'; return ''+(Math.round(n*100)/100); }

/* ítems de las áreas habilitadas, deduplicados por CC corto + descripción (mismo ítem en 3701 y 3702).
 * D84: en modo multi-área devuelve los de TODAS las áreas de AREAS (06.* y 07.* en una sola lista). */
function itemsArea(){
  const seen={}, out=[];
  ITEMS.forEach(it=>{
    if(MULTI ? (AREAS.indexOf(it.area)<0) : (it.area!==AREA)) return;
    // D113c: la llave incluye `actividad` — las variantes por material (crudo de río / UF3) comparten
    // CC y descripción con su ítem, así que sin esto la deduplicación se las comía.
    const k=(it.corto||it.cc)+'|'+String(it.desc||'').trim()+'|'+String(it.actividad||'');
    if(seen[k]) return; seen[k]=1;
    out.push(it);
  });
  return out;
}
/* D113c — nombre de la ACTIVIDAD de un ítem del catálogo. Por defecto es la descripción del ítem de
 * la BASE (como siempre); en las variantes por material es el nombre de la variante. Es lo que se
 * guarda en la columna `actividad` de BANDEJA/DATA: la DESCRIPCION que va al maestro no cambia. */
function nombreAct(it){ return (it && it.actividad) ? it.actividad : (it ? it.desc : ''); }
/* ---------- D85: buscador de actividad (patrón del buscador de CC de asistencias, D78) ----------
 * Reemplaza el <select> de actividad: input de texto que filtra por descripción o CC, con las opciones
 * agrupadas por área en modo multi-área. El índice elegido (sobre itemsArea()) se guarda en el input
 * OCULTO `.l-act`, así el resto del código (refreshLinea/getCantidades/validate/updateResumen) sigue
 * leyendo `.l-act` sin cambios. Etiqueta "Descripción — 06.02 [unidad]" (pedido ODT, D70). */
const ACT_PICK_CAP=60;   // tope de opciones visibles a la vez; el resto aparece al filtrar
// D113c: en una variante por material se muestra el nombre de la variante y, detrás, el ítem
// contractual del que sale — así el capataz ve qué está reportando de verdad ("Relleno con crudo de
// río · Rellenos con material seleccionado — 06.02 [m3]") y el buscador la encuentra por cualquiera
// de los dos textos, o por el CC.
function actLabel(it){
  const cc=it.corto||it.cc||'';
  const base=it.actividad ? (it.actividad+' · '+it.desc) : it.desc;
  return base+(cc?(' — '+cc):'')+(it.unidad?(' ['+it.unidad+']'):'');
}
function actividadPickerHtml(i){
  return '<div class="act-search">'
    +'<input type="text" class="l-act-q" placeholder="Buscar actividad por nombre o CC…" autocomplete="off" data-on-input="actPickFilter('+i+')" data-on-focus="actPickFilter('+i+')" data-on-blur="actPickBlur('+i+')">'
    +'<input type="hidden" class="l-act" value="">'
    +'<div class="act-results" id="actres_'+i+'" data-estilo="display:none;"></div></div>';
}
function actPickFilter(i){
  const b=document.getElementById('linea_'+i); if(!b) return;
  const inp=b.querySelector('.l-act-q'), box=document.getElementById('actres_'+i);
  if(!inp||!box) return;
  const q=(inp.value||'').trim().toLowerCase();
  const its=itemsArea();
  const match=it=>!q || actLabel(it).toLowerCase().indexOf(q)>=0;
  const groups = MULTI ? [['odt','ODT · Transversal (06.*)'],['odl','ODL · Longitudinal (07.*)']] : [[AREA,null]];
  let h='', shown=0, total=0;
  groups.forEach(g=>{
    if(MULTI && AREAS.indexOf(g[0])<0) return;
    const grp=its.map((it,idx)=>({it,idx})).filter(x=>x.it.area===g[0] && match(x.it));
    total+=grp.length;
    if(!grp.length) return;
    if(g[1]) h+='<div class="act-head">'+esc(g[1])+'</div>';
    grp.forEach(x=>{ if(shown>=ACT_PICK_CAP) return; shown++;
      h+='<div class="act-opt" data-on-mousedown="actPickChoose('+i+','+x.idx+')">'+esc(actLabel(x.it))+'</div>'; });
  });
  if(!h) h='<div class="act-opt" data-estilo="cursor:default;color:var(--muted)">Sin resultados</div>';
  else if(total>shown) h+='<div class="act-opt" data-estilo="cursor:default;color:var(--muted)">…y '+(total-shown)+' más · escribe para filtrar</div>';
  box.innerHTML=h; box.style.display='block';
}
// onmousedown (no onclick) para ganarle al blur del input, igual que el buscador de CC.
function actPickChoose(i, idx){
  const b=document.getElementById('linea_'+i); if(!b) return;
  const it=itemsArea()[idx]; if(!it) return;
  b.querySelector('.l-act').value=String(idx);
  b.querySelector('.l-act-q').value=actLabel(it);
  const box=document.getElementById('actres_'+i); if(box) box.style.display='none';
  refreshLinea(i);
}
function actPickBlur(i){
  setTimeout(function(){
    const box=document.getElementById('actres_'+i); if(box) box.style.display='none';
    // Si ya había una actividad elegida y el texto quedó editado a medias, se restaura la etiqueta de
    // la elegida (la selección REAL vive en el input oculto; el texto es solo presentación).
    const b=document.getElementById('linea_'+i); if(!b) return;
    const sel=b.querySelector('.l-act'), q=b.querySelector('.l-act-q');
    if(sel && sel.value!==''){ const it=itemsArea()[parseInt(sel.value,10)];
      if(it && q && q.value.trim()!==actLabel(it)) q.value=actLabel(it); }
  }, 200);
}
function marcadorOptions(conVacio){
  let html=conVacio?'<option value="">— (usar PK) —</option>':'<option value="">— Selecciona marcador —</option>';
  MARCADORES.forEach((m,i)=>{ html+='<option value="'+i+'">'+esc(m.elemento)+(m.pk?(' · PK '+esc(m.pk)):'')+'</option>'; });
  return html;
}

// D84: piezas de ubicación por área (ODT = marcador obligatorio; ODL = PK + marcador opcional de descole).
function ubicOdtHtml(i){
  return '<div class="field"><label>Marcador de obra (ODT) <span class="req">*</span></label>'
    +'<select class="l-marc" data-on-change="refreshLinea('+i+')">'+marcadorOptions(false)+'</select></div>';
}
function ubicOdlHtml(i){
  return '<div class="grid2">'
    +'<div class="field" data-estilo="margin:0;"><label>PK inicial <span class="req">*</span></label>'
    +'<input type="text" class="l-pki" placeholder="14+635" data-on-input="refreshLinea('+i+')"></div>'
    +'<div class="field" data-estilo="margin:0;"><label>PK final <span class="opt">(opcional)</span></label>'
    +'<input type="text" class="l-pkf" placeholder="solo si es tramo" data-on-input="refreshLinea('+i+')"></div></div>'
    +'<div class="field" data-estilo="margin-top:12px;"><label>Marcador ODT <span class="opt">(opcional — descole de una ODT; reemplaza al PK)</span></label>'
    +'<select class="l-marc" data-on-change="refreshLinea('+i+')">'+marcadorOptions(true)+'</select></div>';
}
function addLinea(){
  const i=lineaIdx++;
  const div=document.createElement('div');
  div.className='linea'; div.id='linea_'+i;
  // D84: en modo multi-área la ubicación depende del ítem elegido → contenedor vacío que llena
  // refreshLinea (marcador si el CC es 06.*, PK si es 07.*). En una sola área es estática, como hoy.
  let ubic;
  if(MULTI) ubic='<div id="ubic_'+i+'"></div>';
  else if(AREA==='odt') ubic=ubicOdtHtml(i);
  else ubic=ubicOdlHtml(i);
  // D85: la actividad se elige con el buscador (antes un <select>; con 06.*+07.* juntos era muy largo).
  const actField='<div class="field"><label>Actividad <span class="req">*</span></label>'
    +actividadPickerHtml(i)
    +'<div class="item-hint" id="hint_'+i+'"></div></div>';
  div.innerHTML=
    '<div class="linea-head"><span class="linea-num">Actividad #'+(document.querySelectorAll('.linea').length+1)+'</span>'
    +'<button class="btn-del" data-on-click="delLinea('+i+')" title="Eliminar">✕</button></div>'
    // En multi-área la actividad va PRIMERO (determina el área y qué ubicación pedir); en una sola
    // área se conserva el orden actual (ubicación → actividad).
    +(MULTI ? (actField+ubic) : (ubic+actField))
    +'<div class="meta-row" id="meta_'+i+'" data-estilo="display:none;">'
    +'<span class="badge unidad" id="uniBadge_'+i+'">—</span>'
    +'<span class="badge" id="ufBadge_'+i+'">UF —</span>'
    +'<span class="badge" id="ccBadge_'+i+'">—</span></div>'
    +'<div class="acum-box" id="acum_'+i+'" data-estilo="display:none;"></div>'
    +'<div class="field"><label>Cantidad <span class="req">*</span></label>'
    +'<div class="largo-wrap"><input type="number" step="any" class="l-cant" placeholder="0" data-on-input="refreshAll()"><span class="largo-unit" id="cantU_'+i+'"></span></div>'
    +'<div class="item-hint" data-estilo="display:block;">Cantidad directa en la unidad contractual del ítem (sin conversiones, V1).</div></div>'
    +'<div class="sub-block"><span class="sublabel">Personal y turno (opcional — solo WhatsApp, no va a DATA)</span>'
    +'<div class="grid2">'
    +'<div class="field" data-estilo="margin:0;"><label>Oficiales</label><input type="number" min="0" step="1" class="l-ofi" placeholder="0" data-on-input="refreshAll()"></div>'
    +'<div class="field" data-estilo="margin:0;"><label>Ayudantes</label><input type="number" min="0" step="1" class="l-ayu" placeholder="0" data-on-input="refreshAll()"></div>'
    +'</div>'
    +'<label class="chk-row"><input type="checkbox" class="l-noche" data-on-change="refreshAll()"><span>🌙 Turno de noche</span></label>'
    +'<div class="field" data-estilo="margin-top:10px;"><label>Nota libre <span class="opt">(opcional)</span></label>'
    +'<input type="text" class="l-nota" placeholder="ej. fundida de aletas, encofrado listo" data-on-input="refreshAll()"></div></div>'
    +'<div class="sub-block"><span class="sublabel">Máquinas (opcional — texto libre: id/placa, operador, horas)</span>'
    +'<div id="eqs_'+i+'"></div>'
    +'<button class="btn-add mini" data-on-click="addEquipo('+i+')">+ Máquina</button></div>';
  document.getElementById('cantidadesContainer').appendChild(div);
  refreshCounts();
}
function delLinea(i){ const el=document.getElementById('linea_'+i); if(el) el.remove(); renumber(); refreshCounts(); }
function renumber(){ document.querySelectorAll('#cantidadesContainer .linea').forEach((el,k)=>{ el.querySelector('.linea-num').textContent='Actividad #'+(k+1); }); }

function addEquipo(i){
  const cont=document.getElementById('eqs_'+i), j=eqIdx++;
  const row=document.createElement('div'); row.className='eq-item'; row.id='eq_'+j;
  row.innerHTML=
    '<div class="eq-top"><input type="text" class="e-id" placeholder="Id / placa de la máquina" data-on-input="refreshAll()">'
    +'<button class="btn-del" data-on-click="delEquipo('+j+')" title="Quitar">✕</button></div>'
    +'<div class="grid2">'
    +'<div class="field" data-estilo="margin:0;"><label>Operador <span class="opt">(opcional)</span></label><input type="text" class="e-op" placeholder="nombre" data-on-input="refreshAll()"></div>'
    +'<div class="field" data-estilo="margin:0;"><label>Horas <span class="opt">(opcional)</span></label><input type="number" step="any" class="e-hrs" placeholder="0" data-on-input="refreshAll()"></div>'
    +'</div>';
  cont.appendChild(row);
}
function delEquipo(j){ const el=document.getElementById('eq_'+j); if(el) el.remove(); refreshAll(); }

/* ubicación de una línea: {marc (obj o null), mAbs (metros), pki, pkf, uf, proy, pkTxt} */
function ubicacionDe(b){
  const marcSel=b.querySelector('.l-marc');
  const mi=marcSel && marcSel.value!=='' ? MARCADORES[parseInt(marcSel.value,10)] : null;
  const pkiEl=b.querySelector('.l-pki'), pkfEl=b.querySelector('.l-pkf');
  const pki=pkiEl?pkiEl.value.trim():'', pkf=pkfEl?pkfEl.value.trim():'';
  let m=null, pkTxt='';
  if(mi){ m=(mi.abs===''||mi.abs==null)?null:Number(mi.abs); pkTxt=mi.elemento+(mi.pk?(' (PK '+mi.pk+')'):''); }
  else if(pki){ m=pkToMeters(pki); pkTxt='PK '+(pkf?(pki+' – '+pkf):pki); }
  const uf=ufFromMeters(m), proy=proyectoFromUf(uf);
  return {marc:mi, mAbs:m, pki:pki, pkf:pkf, uf:uf, proy:proy, pkTxt:pkTxt};
}
function refreshLinea(i){
  const b=document.getElementById('linea_'+i); if(!b) return;
  const meta=document.getElementById('meta_'+i), hint=document.getElementById('hint_'+i);
  const sel=b.querySelector('.l-act');
  const it=sel.value!==''?itemsArea()[parseInt(sel.value,10)]:null;
  // D84: en multi-área, la ubicación se re-renderiza SOLO cuando cambia el área del ítem (para no
  // borrar el marcador/PK que el usuario escribe). Se llama a refreshLinea también desde .l-marc/.l-pki.
  if(MULTI){
    const area=it?it.area:'';
    if((b.dataset.ubicArea||'')!==area){
      const cont=document.getElementById('ubic_'+i);
      cont.innerHTML = area==='odt'?ubicOdtHtml(i) : area==='odl'?ubicOdlHtml(i) : '';
      b.dataset.ubicArea=area;
    }
  }
  const u=ubicacionDe(b);
  document.getElementById('cantU_'+i).textContent=it?(it.unidad||''):'';
  const acumBoxEl=document.getElementById('acum_'+i);
  if(!it){ meta.style.display='none'; hint.style.display='none'; if(acumBoxEl) acumBoxEl.style.display='none'; refreshAll(); return; }
  meta.style.display='flex';
  hint.style.display='block';
  hint.innerHTML='→ ítem: <b>'+esc(it.desc)+'</b>';
  const uniB=document.getElementById('uniBadge_'+i); uniB.textContent=it.unidad||'—';
  const ufB=document.getElementById('ufBadge_'+i);
  ufB.className='badge'+(u.uf==='UF1'?' uf1':u.uf==='UF2'?' uf2':'');
  ufB.textContent=u.uf?(u.uf+' · '+u.proy):'UF —';
  const ccB=document.getElementById('ccBadge_'+i);
  ccB.textContent=u.proy?(u.proy+'.'+(it.corto||it.cc)):(it.corto||it.cc||'—');
  // Acumulado oficial para este marcador + actividad (pedido ODT: control del acero por ODT).
  // Solo cuando hay un MARCADOR elegido (ODT siempre; ODL solo si es descole con marcador): el
  // acumulado por ODT se lleva contra el marcador, no contra un tramo de PK.
  const acumBox=document.getElementById('acum_'+i);
  if(u.marc){
    const key=u.marc.elemento+'||'+(it.corto||it.cc||'');
    const ya=ACUM[key];
    if(ya!=null){
      acumBox.style.display='block';
      acumBox.innerHTML='Acumulado ya reportado en <b>'+esc(u.marc.elemento)+'</b> · '+esc(it.desc)+': <b>'+fmtNum(ya)+' '+esc(it.unidad||'')+'</b>'
        +'<span class="acum-sub">Oficial (enviado a DATA). Lo que reportes hoy se suma a esto.</span>';
    } else {
      acumBox.style.display='block';
      acumBox.innerHTML='Sin acumulado previo en <b>'+esc(u.marc.elemento)+'</b> para esta actividad (primer reporte).';
    }
  } else {
    acumBox.style.display='none';
  }
  refreshAll();
}
function refreshCounts(){
  const nc=document.querySelectorAll('#cantidadesContainer .linea').length;
  document.getElementById('cntCantidades').textContent=nc;
  document.getElementById('cantEmpty').style.display=(nc||document.getElementById('catLoading').style.display!=='none')?'none':'block';
  refreshAll();
}
function refreshAll(){ updateResumen(); }
/* D103 — nota GENERAL del día (una por envío). Distinta de la `nota_libre` de cada actividad: esa
 * explica una línea, esta el día completo. Viaja como `observacion_general` y el backend la guarda en
 * OBSERVACIONES sellada con el área de las líneas del reporte (areasDeReporte, D86), así que el panel
 * y el WhatsApp de ODT/ODL la muestran y las de tierras no se mezclan. Nunca va a DATA. */
function obsGeneral(){ const el=document.getElementById('obsGeneral'); return el ? (el.value||'').trim() : ''; }

function updateResumen(){
  const lineas=document.querySelectorAll('#cantidadesContainer .linea');
  const card=document.getElementById('resumenCard'), body=document.getElementById('resumenBody');
  if(!lineas.length){ card.style.display='none'; return; }
  let warnings=0, nMaq=0;
  // D45/D84: se arma una fila por línea y (en multi-área) se AGRUPA por área. `grupos` conserva el
  // orden odt→odl→(sin actividad); en una sola área todo cae en un solo grupo sin encabezado.
  const grupos={odt:[], odl:[], '':[]};
  lineas.forEach(b=>{
    const sel=b.querySelector('.l-act');
    const it=sel.value!==''?itemsArea()[parseInt(sel.value,10)]:null;
    const u=ubicacionDe(b);
    const lineArea = it ? (MULTI ? it.area : AREA) : '';
    const cant=b.querySelector('.l-cant').value;
    let inc=false;
    if(!it){ warnings++; inc=true; }
    if(!u.pkTxt){ warnings++; inc=true; }
    if(!cant){ warnings++; inc=true; }
    const ofi=b.querySelector('.l-ofi').value, ayu=b.querySelector('.l-ayu').value;
    const noche=b.querySelector('.l-noche').checked, nota=b.querySelector('.l-nota').value.trim();
    let persTxt='';
    if(ofi||ayu) persTxt=(ofi?ofi+' oficial'+(ofi==='1'?'':'es'):'')+(ofi&&ayu?' · ':'')+(ayu?ayu+' ayudante'+(ayu==='1'?'':'s'):'');
    if(noche) persTxt+=(persTxt?' · ':'')+'🌙 turno noche';
    let eqsHtml='';
    b.querySelectorAll('.eq-item').forEach(r=>{
      const id=r.querySelector('.e-id').value.trim(); if(!id) return;
      nMaq++;
      const op=r.querySelector('.e-op').value.trim(), h=r.querySelector('.e-hrs').value;
      eqsHtml+='<span class="resumen-eq"><b>'+esc(id)+'</b>'+(op?' · '+esc(op):'')+(h?' · '+esc(h)+' h':'')+'</span>';
    });
    const sinUbicTxt = (lineArea==='odl') ? 'PK' : 'marcador';
    const row='<div class="resumen-row'+(inc?' incompleto':'')+'">'
      +'<div class="resumen-act">'+(it?esc(nombreAct(it)):'⚠ sin actividad')+'</div>'
      +'<div class="resumen-pk">📍 '+(u.pkTxt?esc(u.pkTxt):'⚠ sin '+sinUbicTxt)+(u.uf?(' · '+esc(u.uf)):'')+'</div>'
      +(cant?('<div class="resumen-prod">'+esc(cant)+' '+(it?esc(it.unidad||''):'')+'</div>'):'<div class="resumen-warn">⚠ sin cantidad</div>')
      +(persTxt?('<div class="resumen-pk">'+esc(persTxt)+'</div>'):'')
      +(nota?('<div class="resumen-pk">📝 '+esc(nota)+'</div>'):'')
      +(eqsHtml?('<div class="resumen-eqs">'+eqsHtml+'</div>'):'')
      +'</div>';
    (grupos[lineArea]||grupos['']).push(row);
  });
  let html='';
  if(MULTI){
    [['odt','ODT · Transversal'],['odl','ODL · Longitudinal'],['','Sin actividad definida']].forEach(g=>{
      const rows=grupos[g[0]]; if(!rows.length) return;
      html+='<div class="grupo-cat" data-estilo="font-family:\'Syne\',sans-serif;font-size:12px;color:var(--accent-txt);text-transform:uppercase;letter-spacing:1px;margin:14px 0 8px;">'+g[1]+' ('+rows.length+')</div>'+rows.join('');
    });
  } else {
    html = grupos.odt.concat(grupos.odl, grupos['']).join('');
  }
  // D103: la nota general del día se muestra aparte de las líneas (es del envío completo, no de una actividad)
  const obsGen=obsGeneral();
  if(obsGen) html+='<div class="resumen-row"><div class="resumen-act">📝 Nota general del día</div>'
    +'<div class="resumen-pk">'+esc(obsGen)+'</div></div>';
  html+='<div class="resumen-footer"><span><b>'+lineas.length+'</b> actividad'+(lineas.length!==1?'es':'')+' · <b>'+nMaq+'</b> máquina'+(nMaq!==1?'s':'')+'</span>'
    +(warnings?'<span data-estilo="color:var(--accent-txt)">⚠ '+warnings+' campo'+(warnings!==1?'s':'')+' incompleto'+(warnings!==1?'s':'')+'</span>':'<span data-estilo="color:var(--success-txt)">✓ listo para enviar</span>')+'</div>';
  body.innerHTML=html;
  card.style.display='block';
}

function getCantidades(){
  const rows=[];
  document.querySelectorAll('#cantidadesContainer .linea').forEach(b=>{
    const sel=b.querySelector('.l-act');
    if(sel.value==='') return;
    const it=itemsArea()[parseInt(sel.value,10)];
    const u=ubicacionDe(b);
    const cant=parseFloat(b.querySelector('.l-cant').value)||0;
    // elemento: marcador ODT verbatim si hay; si no (solo ODL), tramo por PK — el backend re-resuelve
    // contra la BASE al enviar a DATA (marcador → J/K/L; PK → cruce TRAMO), esto es el crudo de bandeja.
    const elemento = u.marc ? u.marc.elemento : buildElemento(u.pki, u.pkf);
    const pkIni = u.pki || (u.marc ? (u.marc.pk||'') : '');
    const absIni = u.marc ? (u.marc.abs!==''?u.marc.abs:null) : pkToMeters(u.pki);
    const absFin = u.marc ? (u.marc.abs!==''?u.marc.abs:null) : pkToMeters(u.pkf);
    const equipos=[];
    b.querySelectorAll('.eq-item').forEach(r=>{
      const id=r.querySelector('.e-id').value.trim(); if(!id) return;
      equipos.push({ id_registro:TM2Offline.uuid(), id_maquina:id, tipo_equipo:'', operador:r.querySelector('.e-op').value.trim(),
        horas_programadas:'', horas_operadas:(r.querySelector('.e-hrs').value||''), horas_muertas:'', motivo:'' });
    });
    // D84: en multi-área el área de la línea se deriva del CC del ítem (06→odt, 07→odl); en una sola
    // área es la del formulario, como hoy.
    const lineArea = MULTI ? it.area : AREA;
    rows.push({
      id_registro:TM2Offline.uuid(),   // D82: UUID de cliente (dedupe de reenvíos en Codigo.gs)
      grupo:'DRENAJES Y ESTRUCTURAS',
      // capítulo por defecto del área; los ítems "extra" (D71: Demolición de Estructuras) traen el suyo
      capitulo: it.capitulo || ((lineArea==='odt')?'DRENAJE TRANSVERSAL':'DRENAJE LONGITUDINAL'),
      area: lineArea,   // D71/D84: fija el área de la línea (necesaria para ítems cuyo CC deriva 'tierras')
      // D113c: `descripcion` es SIEMPRE la del ítem de la BASE (es la que viaja al maestro, verbatim
      // por D68); `actividad` es la variante por material cuando la hay — columna interna, control.
      actividad:nombreAct(it), descripcion:it.desc, sub_actividad:'',
      centro_costo: u.proy ? (u.proy+'.'+(it.corto||it.cc)) : (it.cc||''),
      unidad:it.unidad||'', data:true, uf:u.uf||'', proyecto:u.proy||'',
      elemento:elemento, pk_inicial:pkIni, pk_final:u.marc?'':(u.pkf||''),
      abs_inicial:absIni, abs_final:absFin,
      liberacion:'CAMPO', largo:cant, observacion:'',
      personal_oficiales:(b.querySelector('.l-ofi').value||''),
      personal_ayudantes:(b.querySelector('.l-ayu').value||''),
      turno_noche:b.querySelector('.l-noche').checked,
      nota_libre:b.querySelector('.l-nota').value.trim(),
      equipos:equipos });
  });
  return rows;
}
function validate(){
  let ok=true;
  refreshAll();
  document.querySelectorAll('.field-error').forEach(e=>e.classList.remove('field-error'));
  const fecha=document.getElementById('fechaReporte'); if(!fecha.value){ fecha.classList.add('field-error'); ok=false; }
  document.querySelectorAll('#cantidadesContainer .linea').forEach(b=>{
    const sel=b.querySelector('.l-act');
    // D85: el índice elegido vive en el input oculto .l-act; el error se marca en el visible .l-act-q.
    if(sel.value===''){ (b.querySelector('.l-act-q')||sel).classList.add('field-error'); ok=false; return; }
    const it=itemsArea()[parseInt(sel.value,10)];
    const u=ubicacionDe(b);
    // D84: el área de la línea (para saber si exigir marcador o PK) sale del CC del ítem en multi-área.
    const lineArea = MULTI ? (it?it.area:AREA) : AREA;
    if(lineArea==='odt'){
      const mEl=b.querySelector('.l-marc'); if(!u.marc && mEl){ mEl.classList.add('field-error'); ok=false; }
    } else {
      if(!u.marc && u.mAbs==null){ const pEl=b.querySelector('.l-pki'); if(pEl) pEl.classList.add('field-error'); ok=false; }
    }
    const cant=b.querySelector('.l-cant');
    if(!cant.value){ cant.classList.add('field-error'); ok=false; }
  });
  if(getCantidades().length===0){ alert('Agrega al menos una actividad.'); return false; }
  return ok;
}
let enviando=false;
/* Pantalla de confirmación con DOS modos bien distintos (D82): 'servidor' (verde, confirmación real)
 * y 'cola' (naranja, guardado LOCAL pendiente de subir). Nunca mostrar el verde para un encolado. */
function mostrarExito(modo, msg){
  const ico=document.getElementById('successIco'), h2=document.getElementById('successTitle'), p=document.getElementById('successMsg');
  if(modo==='cola'){
    ico.textContent='📥'; h2.textContent='Guardado en el teléfono'; h2.style.color='var(--accent)';
    p.innerHTML='<b data-estilo="color:var(--accent-txt)">Se enviará solo cuando vuelva la señal.</b><br>'+esc(msg);
  } else {
    ico.textContent='✅'; h2.textContent='Reporte enviado'; h2.style.color='';
    p.textContent=msg;
  }
  document.getElementById('formMain').classList.add('hidden');
  document.getElementById('submitBar').classList.add('hidden');
  document.getElementById('successScreen').classList.add('visible');
}
async function submitForm(){
  if(enviando) return;
  if(!validate()){ if(document.querySelector('.field-error')) alert('Revisa los campos marcados.'); return; }
  enviando=true;
  let exito=false;
  const btn=document.getElementById('btnSubmit'); btn.textContent='ENVIANDO...'; btn.disabled=true;
  // D82: id_registro por fila generados EN EL CLIENTE (dedupe de reenvíos en Codigo.gs)
  // D103: `id_reporte` (uno por envío) + `observacion_general` — el backend deduplica la nota general
  // por ese id, así que un reenvío desde la cola offline no la duplica en OBSERVACIONES.
  const data={ id_reporte:TM2Offline.uuid(),
    fecha:document.getElementById('fechaReporte').value,
    rol:localStorage.getItem('rol')||('capataz_'+AREA),
    capataz:localStorage.getItem('usuario')||('capataz_'+AREA),
    cantidades:getCantidades(),
    observacion_general:obsGeneral() };
  // confirmación real del servidor (D30) con rama offline (D82): intento directo con timeout ~15 s;
  // si no hay red / no responde, el payload EXACTO va a la cola local
  const r=await TM2Offline.enviarConCola({ tipo:'reporte', url:APPS_SCRIPT_URL, payload:data, fecha_obra:data.fecha, usuario:data.capataz });
  if(r.enviado){
    const res=r.res;
    if(!res || !res.ok){
      alert('⚠ No se pudo guardar: '+((res&&res.error)||'Respuesta inesperada del servidor')+'\n\nNo cierres la página, intenta enviar de nuevo.');
    } else {
      exito=true;
      mostrarExito('servidor','Se guardaron '+res.cantidades+' actividad(es) y '+res.maquinas+' máquina(s).');
    }
  } else {
    exito=true;
    mostrarExito('cola','Tu reporte del '+data.fecha+' quedó guardado en este teléfono y subirá automático. Puedes ver los pendientes en el contador de arriba.');
  }
  if(!exito){ btn.textContent='ENVIAR REPORTE DEL DÍA →'; btn.disabled=false; }
  else{ btn.textContent=r.enviado?'✓ ENVIADO':'📥 EN COLA'; btn.disabled=true; }
  enviando=false;
}
function resetForm(){
  document.getElementById('cantidadesContainer').innerHTML=''; lineaIdx=0;
  document.getElementById('obsGeneral').value='';   // D103
  document.getElementById('successScreen').classList.remove('visible');
  document.getElementById('formMain').classList.remove('hidden');
  document.getElementById('submitBar').classList.remove('hidden');
  document.getElementById('btnSubmit').textContent='ENVIAR REPORTE DEL DÍA →'; document.getElementById('btnSubmit').disabled=false;
  document.getElementById('fechaReporte').value=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
  addLinea();
}
