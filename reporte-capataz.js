// D170: aplica los data-estilo del marcado ANTES de que corra la lógica de la pantalla (ver tema.js).
if(window.TM2Estilos) TM2Estilos.aplicar();
const APPS_SCRIPT_URL = GALCA_ENV.url.obra;          // entorno.js (D168): producción o prueba

/* Actividad: medida = m3 | m2_via (cereo, =ml×ancho) | ha | directo ; data = entra a DATA */
const ACTIVIDADES = [
  {g:'Excavación', a:'Excavación aprovechable (masivo)', item:'Excavaciones en material común APROVECHABLE', uni:'m3', cc:'02.05', medida:'m3', data:true},
  {g:'Excavación', a:'Excavación no aprovechable', item:'Excavaciones en material común NO APROVECHABLE', uni:'m3', cc:'02.05', medida:'m3', data:true},
  {g:'Excavación', a:'Excavación de préstamo (Diviso)', item:'Excavación en material común de préstamos', uni:'m3', cc:'02.06', medida:'m3', data:true},
  {g:'Terraplén', a:'Núcleo de terraplén', item:'Terraplenes (solo conformación)', uni:'m3', cc:'02.07', medida:'m3', data:true},
  {g:'Terraplén', a:'Corona de terraplén', item:'Terraplenes (solo conformación)', uni:'m3', cc:'02.07', medida:'m3', data:true},
  // D113 — terraplén distinguido por MATERIAL. Mismo ítem contractual del terraplén (02.07) y misma
  // fila en DATA que el resto (GRUPO TIERRAS, CAPÍTULO EXPLANACIONES, DESCRIPCION verbatim de la BASE):
  // la distinción es solo para control interno y se ve por la columna interna `actividad`. NO se
  // dividen en núcleo y corona (decisión del dueño: para estos dos materiales esa distinción no
  // interesa, "simplemente es terraplén"), por eso son una actividad cada una y no una variante.
  {g:'Terraplén', a:'Terraplén con crudo de río', item:'Terraplenes (solo conformación)', uni:'m3', cc:'02.07', medida:'m3', data:true},
  {g:'Terraplén', a:'Terraplén de UF3', item:'Terraplenes (solo conformación)', uni:'m3', cc:'02.07', medida:'m3', data:true},
  {g:'Terraplén', a:'Cereo de corona', item:'Cereo de corona', uni:'m2', cc:'', medida:'m2_via', data:false},
  {g:'Subbase', a:'Conformación de subbase', item:'Subbase Granular', uni:'m3', cc:'03.01', medida:'m3', data:true},
  {g:'Subbase', a:'Cereo de subbase', item:'Cereo de subbase', uni:'m2', cc:'', medida:'m2_via', data:false},
  {g:'Base', a:'Base estabilizada con cemento (BTC)', item:'Base granular estabilizada con cemento', uni:'m3', cc:'03.03', medida:'m3', data:true},
  {g:'Pavimentos', a:'Riego de imprimación con emulsión asfáltica', item:'Riego de imprimación con emulsión asfáltica', uni:'m2', cc:'04.01', medida:'directo', data:true},
  {g:'Pedraplén', a:'Pedraplén compacto', item:'Pedraplén compacto', uni:'m3', cc:'02.07', medida:'m3', data:true},
  {g:'Desmonte', a:'Desmonte y limpieza en bosque', item:'Desmonte y limpieza en bosque', uni:'Ha', cc:'02.01', medida:'m2_desmonte', data:true, maqUnidad:'m2'},
  {g:'Desmonte', a:'Descapote / zonas no boscosas', item:'Desmonte y limpieza en zonas no boscosas', uni:'Ha', cc:'02.03', medida:'m2_desmonte', data:true, maqUnidad:'m3'},
  {g:'Actividades de apoyo', a:'Compactación de terraplén', item:'Compactación de terraplén', uni:'', cc:'', medida:'apoyo', data:false, sub:'COMPACT_TERRAPLEN'},
  {g:'Actividades de apoyo', a:'Compactación de subbase', item:'Compactación de subbase', uni:'', cc:'', medida:'apoyo', data:false, sub:'COMPACT_SUBBASE'},
  {g:'Actividades de apoyo', a:'Compactación de BTC', item:'Compactación de BTC', uni:'', cc:'', medida:'apoyo', data:false, sub:'COMPACT_BTC'},
  {g:'Actividades de apoyo', a:'Paisajeo / ornato', item:'Paisajeo / ornato', uni:'', cc:'', medida:'apoyo', data:false, sub:'PAISAJEO'},
  {g:'Actividades de apoyo', a:'Adecuación de caminos', item:'Adecuación de caminos', uni:'', cc:'', medida:'apoyo', data:false, sub:'ADECUACION'},
  {g:'Actividades de apoyo', a:'Limpieza de derrumbe', item:'Limpieza de derrumbe', uni:'', cc:'', medida:'apoyo', data:false, sub:'DERRUMBE'},
  {g:'Estructuras / MSR', a:'Relleno para muros de tierra MSR', item:'Relleno para muros de tierra MSR', uni:'M3', cc:'05.04', medida:'directo', data:true},
  {g:'Estructuras / MSR', a:'Material granular drenante MSR', item:'Material granular drenante MSR', uni:'M3', cc:'05.05', medida:'directo', data:true},
  {g:'Estructuras / MSR', a:'Geobolsas / costales (propybag)', item:'Geobolsas de geotextil (propybag) MSR', uni:'UND', cc:'05.11', medida:'directo', data:true},
  {g:'Estructuras / MSR', a:'Geomalla uniaxial 115 kn/m', item:'Geomalla tejida uniaxial de 115 kn/m (método md)', uni:'M2', cc:'05.07', medida:'directo', data:true},
  {g:'Estructuras / MSR', a:'Geomalla uniaxial 55 kn/m', item:'Geomalla tejida uniaxial de 55 kn/m (método md)', uni:'M2', cc:'05.06', medida:'directo', data:true},
  {g:'Estructuras / MSR', a:'Geotextil tejido 2890 n', item:'Geotextil tejido uniaxial de 2890 n (método grab md)', uni:'M2', cc:'05.09', medida:'directo', data:true},
  {g:'Estructuras / MSR', a:'Geotextil tejido 1480 n', item:'Geotextil tejido uniaxial de 1480 n (método grab md)', uni:'M2', cc:'05.08', medida:'directo', data:true},
  {g:'Estructuras / MSR', a:'Geodrén planar h=1 m', item:'Geodrén planar h=1 m MSR', uni:'M', cc:'05.10', medida:'directo', data:true},
  {g:'Estructuras / MSR', a:'Geodrén planar h=0,5 m', item:'Geodrén planar h=0,5 m MSR', uni:'M', cc:'05.02', medida:'directo', data:true},
  {g:'Estructuras / MSR', a:'Tubería PVC 4" perforada', item:'Tubería PVC d=4" para drenaje perforada MSR', uni:'M', cc:'05.03', medida:'directo', data:true},
];
const ACT_IDX = {}; ACTIVIDADES.forEach(x=>ACT_IDX[x.a]=x);
// D58: sello en la observación de las filas no aprovechable/ZODME nacidas de descapote/desmonte,
// para que la reconciliación del encargado no las apague por una no aprovechable de chequeadora.
const DESM_TAG = 'orig:descapote/desmonte';
// Deriva las salidas del m² capturado en desmonte/descapote (D58): Ha contractual (÷10 000),
// m³ no aprovechable (m²×espesor) y producción de la máquina (m² desmonte / m³ descapote).
function desmonteVals(b, x){
  const m2=parseFloat(b.querySelector('.l-m2').value)||0;
  const espEl=b.querySelector('.l-espesor');
  let esp=(espEl && espEl.value!=='')?parseFloat(espEl.value):0.2; if(isNaN(esp)) esp=0.2;
  const ha=Math.round((m2/10000)*1e6)/1e6;
  const m3=Math.round((m2*esp)*100)/100;
  const prodMaq=(x.maqUnidad==='m2')?m2:m3;
  return {m2, esp, ha, m3, prodMaq, maqU:(x.maqUnidad==='m2'?'m²':'m³')};
}
function capFromCc(cc){ if(!cc) return ''; const p=cc.split('.')[0]; return p==='02'?'EXPLANACIONES':p==='03'?'BASES, SUBBASES Y AFIRMADOS':p==='04'?'PAVIMENTOS ASFALTICOS':'ESTRUCTURAS'; }
// La BASE clasifica tierras y estructuras/MSR (CC 05.*) bajo el mismo grupo: TIERRAS. El CAPITULO sí
// distingue (capFromCc: ESTRUCTURAS para 05.*), pero el GRUPO es TIERRAS en el alcance V1. Excepción
// (D71): PAVIMENTOS (CC 04.*) va en el grupo PAVIMENTOS, como lo tiene la hoja BASE.
function grupoFromCc(cc){ return (cc && cc.split('.')[0]==='04') ? 'PAVIMENTOS' : 'TIERRAS'; }

// D171: los equipos del capataz son SOLO códigos, y el catálogo único es la hoja PARTE_EQUIPOS
// (`activo=SI`), servida dentro de `?action=maquinas` (campo `equipos`: código, tipo, placa) y
// cacheada por flota.js para trabajar sin señal (D82). Horas operadas, operador, motivo, programadas/
// muertas y ESTADO SALIERON de este formulario: esos datos los da el Parte Digital (D165) y se revisan
// en revision-maquinaria.html. La asociación máquina↔actividad que se hace aquí es informativa (para
// cruzar y rastrear), no alimenta horas ni producción por máquina.
// Lo de abajo es el RESPALDO de último recurso (este teléfono nunca tuvo señal): la flota de tierras
// de siempre, sin placa. Conviene mantenerlo grosso modo al día, pero ya no manda.
const MAQUINAS_RESPALDO = ['BL005','EXC015','FNG02','MO03','MO04','MO09','CR08','CR019','CR013','CR016','NH403','CR026','RT-02'];
const TIPO_RESPALDO = {'BL005':'BULLDOZER','EXC015':'EXCAVADORA','MO03':'MOTONIVELADORA','MO04':'MOTONIVELADORA','MO09':'MOTONIVELADORA','FNG02':'FINISHER','CR08':'VIBROCOMPACTADOR','CR019':'VIBROCOMPACTADOR','CR013':'VIBROCOMPACTADOR','CR016':'VIBROCOMPACTADOR','NH403':'VIBROCOMPACTADOR','CR026':'MINIBULDOZER','RT-02':'RETROEXCAVADORA'};
// Estado vivo: [{codigo,tipo,placa}] ordenado por tipo y código. Arranca en el respaldo para que la
// pantalla sirva desde el primer instante, incluso antes de que responda el servidor.
let EQUIPOS = MAQUINAS_RESPALDO.map(c=>({codigo:c, tipo:TIPO_RESPALDO[c]||'', placa:''}));
let EQ_IDX = {};
function indexarEquipos(){ EQ_IDX={}; EQUIPOS.forEach(q=>{ EQ_IDX[q.codigo.toUpperCase()]=q; }); }
indexarEquipos();
function tipoDe(cod){ const q=EQ_IDX[String(cod||'').toUpperCase()]; return q?q.tipo:''; }
// Selección por actividad: linea i → [códigos] en el orden en que se eligieron.
const SEL = {};

let lineaIdx = 0;

window.onload = function(){
  // D82: sesión en localStorage (sobrevive cierre del navegador en zona muerta)
  const rol=localStorage.getItem('rol'), usuario=localStorage.getItem('usuario');
  // D85: el residente (tierras) también puede reportar como si fuera capataz (antes lo botaba al login).
  if(!rol || (rol!=='capataz' && rol!=='admin' && rol!=='encargado' && rol!=='residente')){ window.location.href='index.html'; return; }
  document.getElementById('userDisplay').textContent=usuario||'capataz';
  if(rol==='admin'){var _bm=document.getElementById('btnMenu');if(_bm)_bm.style.display='inline-block';}
  document.getElementById('backBtn').textContent = (rol==='encargado'||rol==='residente') ? '← Volver' : 'Salir';
  document.getElementById('fechaReporte').value=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
  addLinea();
  // D138/D171: catálogo de equipos (PARTE_EQUIPOS vía ?action=maquinas, con caída a caché sin señal).
  // No bloquea la pantalla: los chips ya funcionan con el respaldo y se repintan cuando llegue.
  refrescarFlota();
  document.getElementById('fechaReporte').addEventListener('change', refrescarFlota);
};
function logout(){
  const rol=localStorage.getItem('rol');
  if(rol==='encargado'){ window.location.href='encargado.html'; return; }
  if(rol==='residente'){ window.location.href='residente.html'; return; }   // D85: vuelve a su panel
  // solo la sesión: la cola de envíos pendientes NO se borra al cerrar sesión (D82)
  localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token');
  window.location.href='index.html';
}

function pkToMeters(pk){ if(!pk) return null; pk=String(pk).toLowerCase().replace(/pk/g,'').trim().replace(/\s/g,''); if(pk.includes('+')){const p=pk.split('+');const km=parseInt(p[0]);const m=parseInt(p[1]||'0');if(isNaN(km))return null;return km*1000+(isNaN(m)?0:m);} const n=parseFloat(pk);return isNaN(n)?null:n*1000; }
function ufFromPk(pk){ const m=pkToMeters(pk); if(m==null) return ''; return m<=30000?'UF1':'UF2'; }
function proyectoFromUf(uf){ return uf==='UF1'?'3701':uf==='UF2'?'3702':''; }

function actividadOptions(){
  const groups={}, order=[];
  ACTIVIDADES.forEach(x=>{ if(!groups[x.g]){groups[x.g]=[];order.push(x.g);} groups[x.g].push(x); });
  let html='<option value="">— Selecciona actividad —</option>';
  order.forEach(g=>{ html+='<optgroup label="'+esc(g)+'">'; groups[g].forEach(x=>{ html+='<option value="'+esc(x.a)+'">'+esc(x.a)+'</option>'; }); html+='</optgroup>'; });
  return html;
}
/* D138/D171 — recarga el catálogo vigente y repinta los selectores ya abiertos, conservando lo
 * elegido (un código que ya no esté en el catálogo se muestra como chip «fuera del catálogo», nunca se
 * borra). Se llama al abrir y al cambiar la fecha. Sin señal cae a la caché de este teléfono. */
function refrescarFlota(){
  const fecha=(document.getElementById('fechaReporte')||{}).value||'';
  return TM2Flota.cargar(APPS_SCRIPT_URL, fecha, {ids:MAQUINAS_RESPALDO, tipos:TIPO_RESPALDO, prog:{}})
    .then(function(fl){
      EQUIPOS=TM2Flota.equiposCapataz(fl); indexarEquipos();
      document.querySelectorAll('#cantidadesContainer .linea').forEach(function(b){
        const i=b.id.split('_')[1]; renderChips(i);
        const pk=document.getElementById('eqpick_'+i); if(pk && pk.classList.contains('abierto')) renderPicker(i);
      });
      const av=document.getElementById('avisoFlota'), t=TM2Flota.aviso(fl);
      if(av){ av.textContent=t; av.style.display=t?'block':'none'; }
      refreshAll();
    });
}

function addLinea(){
  const i=lineaIdx++;
  const div=document.createElement('div');
  div.className='linea'; div.id='linea_'+i;
  div.innerHTML=
    '<div class="linea-head"><span class="linea-num">Actividad #'+(document.querySelectorAll('.linea').length+1)+'</span>'
    +'<button class="btn-del" data-on-click="delLinea('+i+')" title="Eliminar">✕</button></div>'
    +'<div class="field"><label>Actividad <span class="req">*</span></label>'
    +'<select class="l-act" data-on-change="onActChange('+i+')">'+actividadOptions()+'</select>'
    +'<div class="item-hint" id="hint_'+i+'"></div></div>'
    +'<div class="meta-row" id="meta_'+i+'" data-estilo="display:none;">'
    +'<span class="badge unidad" id="uniBadge_'+i+'">—</span>'
    +'<span class="badge" id="ufBadge_'+i+'">UF —</span>'
    +'<span class="badge" id="ccBadge_'+i+'">—</span></div>'
    +'<div class="grid2">'
    +'<div class="field" data-estilo="margin:0;"><label>PK inicial <span class="req">*</span></label>'
    +'<input type="text" class="l-pki" placeholder="14+635" data-on-input="onPkChange('+i+')"></div>'
    +'<div class="field" data-estilo="margin:0;"><label>PK final <span class="opt" id="pkfOpt_'+i+'">(opcional)</span></label>'
    +'<input type="text" class="l-pkf" placeholder="solo si es tramo" data-on-input="onPkChange('+i+')"></div></div>'
    +'<div id="prod_'+i+'" data-estilo="margin-top:14px;"></div>'
    // D171: solo el código de la máquina (chips). Horas/operador/motivo van por el Parte Digital.
    +'<div class="equipos-block"><span class="eqlabel">Equipos que ejecutaron esta actividad <span class="opt">(solo el código · horas y operador van en el parte digital)</span></span>'
    +'<div class="eq-sel" id="eqs_'+i+'"></div>'
    +'<div class="eq-picker" id="eqpick_'+i+'"></div>'
    +'<button class="btn-add mini" id="eqbtn_'+i+'" data-on-click="togglePicker('+i+')">+ Equipo</button></div>'
    // D103: esta nota por actividad ya salía en DATA (col S) y ahora también en el WhatsApp del día,
    // bajo su actividad; el placeholder lo dice para que se use como nota y no quede en blanco.
    +'<div class="field" data-estilo="margin-top:14px;"><label>Nota de esta actividad <span class="opt">(opcional · sale en el WhatsApp)</span></label>'
    +'<input type="text" class="l-obs" placeholder="ej. se paró 2h por lluvia en este frente"></div>';
  document.getElementById('cantidadesContainer').appendChild(div);
  SEL[i]=[]; renderChips(i);
  refreshCounts();
}
function delLinea(i){ const el=document.getElementById('linea_'+i); if(el) el.remove(); delete SEL[i]; renumber(); refreshCounts(); }
function renumber(){ document.querySelectorAll('#cantidadesContainer .linea').forEach((el,k)=>{ el.querySelector('.linea-num').textContent='Actividad #'+(k+1); }); }

function renderProd(i, x){
  const cont=document.getElementById('prod_'+i);
  if(x.medida==='apoyo'){ cont.innerHTML=''; return; }
  if(x.medida==='m2_via'){
    cont.innerHTML=
      '<div class="grid2">'
      +'<div class="field" data-estilo="margin:0;"><label>Ancho de vía (m)</label><input type="number" step="any" class="l-ancho" value="11.5" data-on-input="recalcM2('+i+');refreshAll()"></div>'
      +'<div class="field" data-estilo="margin:0;"><label>Producción (m²)</label><div class="largo-wrap"><input type="number" class="l-m2disp" placeholder="auto" readonly data-estilo="opacity:.85;cursor:not-allowed;"><span class="largo-unit">m²</span></div></div>'
      +'</div>'
      +'<div data-estilo="font-size:11px;color:var(--muted);margin-top:6px;">= (PK final − PK inicial) × ancho. No va a DATA; queda en la producción de la máquina.</div>';
    recalcM2(i);
  } else if(x.medida==='m2_desmonte'){
    // D58: captura directa en m² (no se calcula del PK). Genera Ha contractual + no aprovechable + ZODME.
    cont.innerHTML=
      '<div class="grid2">'
      +'<div class="field" data-estilo="margin:0;"><label>Producción (m²) <span class="req">*</span></label><div class="largo-wrap"><input type="number" step="any" class="l-m2" placeholder="0" data-on-input="refreshAll()"><span class="largo-unit">m²</span></div></div>'
      +'<div class="field" data-estilo="margin:0;"><label>Espesor (m)</label><input type="number" step="any" class="l-espesor" value="0.2" data-on-input="refreshAll()"></div>'
      +'</div>'
      +'<div class="item-hint" id="desmDeriv_'+i+'" data-estilo="display:block;font-size:11px;color:var(--muted);margin-top:6px;"></div>';
  } else {
    const lbl = x.medida==='ha' ? 'Producción (Ha)' : (x.medida==='directo' ? ('Cantidad ('+esc(x.uni)+')') : 'Producción (m³)');
    cont.innerHTML=
      '<div class="field" data-estilo="margin:0;"><label>'+lbl+' <span class="req">*</span></label>'
      +'<div class="largo-wrap"><input type="number" step="any" class="l-prod" placeholder="0" data-on-input="refreshAll()"><span class="largo-unit">'+esc(x.uni)+'</span></div></div>';
  }
}
function recalcM2(i){
  const b=document.getElementById('linea_'+i), a=b.querySelector('.l-act').value; if(!a) return;
  const x=ACT_IDX[a]; if(x.medida!=='m2_via') return;
  const ai=pkToMeters(b.querySelector('.l-pki').value), af=pkToMeters(b.querySelector('.l-pkf').value);
  const ancho=parseFloat(b.querySelector('.l-ancho').value)||0, disp=b.querySelector('.l-m2disp');
  if(ai!=null && af!=null && ancho>0) disp.value=Math.round(Math.abs(af-ai)*ancho*100)/100; else disp.value='';
}

function onActChange(i){
  const block=document.getElementById('linea_'+i), a=block.querySelector('.l-act').value;
  const meta=document.getElementById('meta_'+i), hint=document.getElementById('hint_'+i);
  const pkfOpt=document.getElementById('pkfOpt_'+i);
  if(!a){ meta.style.display='none'; hint.style.display='none'; document.getElementById('prod_'+i).innerHTML=''; refreshAll(); return; }
  const x=ACT_IDX[a];
  hint.style.display='block';
  if(x.medida==='apoyo'){
    meta.style.display='none';
    hint.innerHTML='→ <b>'+esc(x.a)+'</b> · actividad de apoyo · no va a DATA';
    pkfOpt.textContent='(opcional)';
    document.getElementById('prod_'+i).innerHTML='';
    refreshAll();
    return;
  }
  meta.style.display='flex';
  hint.innerHTML = x.data ? ('→ ítem: <b>'+esc(x.item)+'</b>') : '→ <b>'+esc(x.item)+'</b> · solo maquinaria (no va a DATA)';
  const uniB=document.getElementById('uniBadge_'+i); uniB.textContent=(x.medida==='m2_desmonte')?'m² → Ha':x.uni; uniB.className='badge unidad';
  pkfOpt.textContent = (x.medida==='m2_via') ? '(requerido)' : '(opcional)';
  renderProd(i, x);
  onPkChange(i);
  refreshAll();
}
function onPkChange(i){
  const block=document.getElementById('linea_'+i);
  const a=block.querySelector('.l-act').value;
  if(a && ACT_IDX[a] && ACT_IDX[a].medida==='apoyo') return;
  const pki=block.querySelector('.l-pki').value;
  const uf=ufFromPk(pki);
  const ufBadge=document.getElementById('ufBadge_'+i), ccBadge=document.getElementById('ccBadge_'+i);
  ufBadge.className='badge'+(uf==='UF1'?' uf1':uf==='UF2'?' uf2':'');
  ufBadge.textContent= uf? (uf+' · '+proyectoFromUf(uf)) : 'UF —';
  if(a){ const x=ACT_IDX[a];
    if(!x.data){ ccBadge.className='badge nodata'; ccBadge.textContent='solo maquinaria'; ccBadge.style.display='inline-flex'; }
    else if(uf){ ccBadge.className='badge'; ccBadge.textContent=proyectoFromUf(uf)+'.'+x.cc; ccBadge.style.display='inline-flex'; }
    else ccBadge.style.display='none';
    if(x.medida==='m2_via') recalcM2(i);
  } else ccBadge.style.display='none';
  refreshAll();
}

/* ---------- D171: selector de equipos por código (chips con búsqueda, agrupado por tipo) ----------
 * Los manejadores van en `data-on-*` (CSP sin inline, D170): argumentos literales; el código viaja
 * como cadena JSON para que un guion o una comilla no rompan el intérprete de tema.js. */
function renderChips(i){
  const cont=document.getElementById('eqs_'+i); if(!cont) return;
  const sel=SEL[i]||[];
  cont.innerHTML = sel.map(cod=>{
    const q=EQ_IDX[cod.toUpperCase()];
    const sub = q ? (q.tipo+(q.placa?' · '+q.placa:'')) : 'fuera del catálogo';
    return '<span class="eq-chip'+(q?'':' fuera')+'"><b>'+esc(cod)+'</b><span class="t">'+esc(sub)+'</span>'
      +'<button class="x" type="button" title="Quitar" data-on-click="quitarEquipo('+i+','+esc(JSON.stringify(cod))+')">✕</button></span>';
  }).join('');
}
function togglePicker(i){
  const pk=document.getElementById('eqpick_'+i), btn=document.getElementById('eqbtn_'+i);
  const abrir = !pk.classList.contains('abierto');
  pk.classList.toggle('abierto', abrir);
  btn.textContent = abrir ? '▲ Listo' : '+ Equipo';
  if(abrir){ renderPicker(i); const inp=pk.querySelector('input'); if(inp) inp.focus(); }
}
function renderPicker(i, filtro){
  const pk=document.getElementById('eqpick_'+i); if(!pk) return;
  const inp=pk.querySelector('input');
  const f=String(filtro!==undefined ? filtro : (inp?inp.value:'')).trim().toUpperCase();
  const sel=(SEL[i]||[]).map(c=>c.toUpperCase());
  const grupos={}, orden=[];
  EQUIPOS.forEach(q=>{
    if(f && (q.codigo+' '+q.tipo+' '+q.placa).toUpperCase().indexOf(f)<0) return;
    const g=q.tipo||'SIN TIPO'; if(!grupos[g]){ grupos[g]=[]; orden.push(g); } grupos[g].push(q);
  });
  let html='<input type="text" placeholder="Buscar código, tipo o placa…" value="'+esc(f)+'" data-on-input="renderPicker('+i+', this.value)">';
  if(!orden.length) html+='<div class="eq-none">Ningún equipo coincide con «'+esc(f)+'».</div>';
  orden.forEach(g=>{
    html+='<div class="eq-grupo">'+esc(g)+'</div><div class="eq-opts">';
    grupos[g].forEach(q=>{
      const on=sel.indexOf(q.codigo.toUpperCase())>=0;
      html+='<button type="button" class="eq-opt'+(on?' on':'')+'" data-on-click="toggleEquipo('+i+','+esc(JSON.stringify(q.codigo))+')">'
        +(on?'✓ ':'')+esc(q.codigo)+(q.placa?'<span class="p">'+esc(q.placa)+'</span>':'')+'</button>';
    });
    html+='</div>';
  });
  pk.innerHTML=html;
  // conservar el foco y el cursor mientras se teclea
  if(filtro!==undefined){ const ni=pk.querySelector('input'); if(ni){ ni.focus(); ni.setSelectionRange(ni.value.length, ni.value.length); } }
}
function toggleEquipo(i, cod){
  const sel=SEL[i]||(SEL[i]=[]);
  const k=sel.findIndex(c=>c.toUpperCase()===String(cod).toUpperCase());
  if(k>=0) sel.splice(k,1); else sel.push(cod);
  renderChips(i); renderPicker(i); refreshAll();
}
function quitarEquipo(i, cod){
  const sel=SEL[i]||[]; const k=sel.findIndex(c=>c.toUpperCase()===String(cod).toUpperCase());
  if(k>=0) sel.splice(k,1);
  renderChips(i);
  const pk=document.getElementById('eqpick_'+i); if(pk && pk.classList.contains('abierto')) renderPicker(i);
  refreshAll();
}
/* Lista de equipos de una actividad tal como viaja al backend: solo código + tipo (informativo) e
 * id_registro de cliente por fila para la deduplicación de reenvíos (D82). Sin horas ni operador. */
function equiposDe(i){
  return (SEL[i]||[]).map(cod=>({ id_registro:TM2Offline.uuid(), id_maquina:cod, tipo_equipo:tipoDe(cod) }));
}
function refreshAll(){
  updateDesmHints();
  updateResumen();
}
/* D58 — pinta bajo el m² capturado lo que la app va a generar (Ha · no aprovechable · ZODME · máquina). */
function updateDesmHints(){
  document.querySelectorAll('#cantidadesContainer .linea').forEach(b=>{
    const a=b.querySelector('.l-act').value; if(!a) return;
    const x=ACT_IDX[a]; if(!x || x.medida!=='m2_desmonte') return;
    const div=document.getElementById('desmDeriv_'+b.id.split('_')[1]); if(!div) return;
    const v=desmonteVals(b, x);
    if(v.m2>0){
      div.innerHTML='→ DATA: <b>'+fmtNum(v.ha)+' Ha</b> (m²÷10 000) · no aprovechable <b>'+fmtNum(v.m3)+' m³</b> (×'+v.esp+') → ZODME auto <b>'+fmtNum(v.m3)+' m³</b> · máquina '+fmtNum(v.prodMaq)+' '+v.maqU;
    } else {
      div.innerHTML='= m²÷10 000 a DATA (Ha) · m²×espesor a no aprovechable (m³) → ZODME auto · máquina '+(x.maqUnidad==='m2'?'m²':'m³');
    }
  });
}

function refreshCounts(){
  const nc=document.querySelectorAll('#cantidadesContainer .linea').length;
  document.getElementById('cntCantidades').textContent=nc;
  document.getElementById('cantEmpty').style.display=nc?'none':'block';
  refreshAll();
}

function updateResumen(){
  const lineas=document.querySelectorAll('#cantidadesContainer .linea');
  const card=document.getElementById('resumenCard'), body=document.getElementById('resumenBody');
  if(!lineas.length){ card.style.display='none'; return; }
  // D171: equipos = códigos por actividad; el resumen cuenta máquinas distintas del día.
  const maqDia={}, maqOrden=[];
  let warnings=0, html='';
  lineas.forEach(b=>{
    const a=b.querySelector('.l-act').value;
    if(!a){ warnings++; return; }
    const x=ACT_IDX[a];
    const pki=b.querySelector('.l-pki').value.trim(), pkf=b.querySelector('.l-pkf').value.trim();
    const lineaI=b.id.split('_')[1];
    const prodDiv=document.getElementById('prod_'+lineaI);
    const prodEl=b.querySelector('.l-prod');
    let prodHtml='', sinProd=false;
    if(x.medida==='apoyo'){
      prodHtml='<div class="resumen-prod" data-estilo="color:var(--muted);font-weight:400;">actividad de apoyo · no va a DATA</div>';
    } else if(prodDiv && prodDiv.style.display==='none'){
      prodHtml='';
    } else if(x.medida==='m2_via'){
      const m2=b.querySelector('.l-m2disp'); const val=m2?m2.value:'';
      prodHtml=val?'<div class="resumen-prod">'+esc(val)+' m²</div>':'';
    } else if(x.medida==='m2_desmonte'){
      const m2El=b.querySelector('.l-m2');
      if(m2El && m2El.value){ const v=desmonteVals(b, x);
        prodHtml='<div class="resumen-prod">'+fmtNum(v.m2)+' m² → '+fmtNum(v.ha)+' Ha (DATA)</div>'
          +'<div class="resumen-pk" data-estilo="color:var(--muted)">+ no aprovechable '+fmtNum(v.m3)+' m³ → ZODME '+fmtNum(v.m3)+' m³ · máquina '+fmtNum(v.prodMaq)+' '+v.maqU+'</div>';
      } else { prodHtml='<div class="resumen-warn">⚠ sin producción</div>'; warnings++; sinProd=true; }
    } else if(prodEl && prodEl.value){
      prodHtml='<div class="resumen-prod">'+esc(prodEl.value)+' '+esc(x.uni)+'</div>';
    } else {
      prodHtml='<div class="resumen-warn">⚠ sin producción</div>'; warnings++; sinProd=true;
    }
    const pkTxt = pki ? (pkf ? pki+' → '+pkf : pki) : (x.medida==='apoyo'?'':'⚠ sin PK');
    if(!pki && x.medida!=='apoyo') warnings++;
    let eqsHtml='';
    (SEL[lineaI]||[]).forEach(cod=>{
      const k=cod.toUpperCase(); if(!maqDia[k]){ maqDia[k]={cod, n:0}; maqOrden.push(k); } maqDia[k].n++;
      const t=tipoDe(cod);
      eqsHtml+='<span class="resumen-eq"><b>'+esc(cod)+'</b>'+(t?' · '+esc(t):'')+'</span>';
    });
    const incompleto=(!pki && x.medida!=='apoyo')||sinProd;
    html+='<div class="resumen-row'+(incompleto?' incompleto':'')+'">'
      +'<div class="resumen-act">'+esc(a)+'</div>'
      +(pkTxt?'<div class="resumen-pk">📍 '+esc(pkTxt)+'</div>':'')
      +prodHtml
      +(eqsHtml?'<div class="resumen-eqs">'+eqsHtml+'</div>':'<div class="resumen-warn">⚠ sin equipos</div>')
      +'</div>';
  });
  if(maqOrden.length){
    html+='<div class="resumen-sub">Equipos del día</div><div class="resumen-eqs dia">';
    maqOrden.forEach(k=>{ const m=maqDia[k];
      html+='<span class="resumen-eq"><b>'+esc(m.cod)+'</b>'+(m.n>1?' · '+m.n+' actividades':'')+'</span>'; });
    html+='</div><div class="eq-nota">Horas, operador y novedades de cada máquina van por el <b>parte digital</b> (QR de la cabina).</div>';
  }
  const totalActs=lineas.length, totalMaq=maqOrden.length;
  html+='<div class="resumen-footer"><span><b>'+totalActs+'</b> actividad'+(totalActs!==1?'es':'')+' · <b>'+totalMaq+'</b> máquina'+(totalMaq!==1?'s':'')+'</span>'
    +(warnings?'<span data-estilo="color:var(--accent-txt)">⚠ '+warnings+' campo'+(warnings!==1?'s':'')+' incompleto'+(warnings!==1?'s':'')+'</span>':'<span data-estilo="color:var(--success-txt)">✓ listo para enviar</span>')+'</div>';
  body.innerHTML=html;
  card.style.display='block';
}
// ELEMENTO unificado (Problema 2.12): "tm2 pk NN+NNN" o "tm2 pk NN+NNN - NN+NNN". Normaliza el PK y
// nunca duplica el token "pk"/"Pk" (pkToMeters lo quita). Misma lógica en backend y en los HTML.
function pkNorm(s){ const m=pkToMeters(s); if(m==null) return ''; const km=Math.floor(m/1000), r=Math.round(m-km*1000); return km+'+'+('00'+r).slice(-3); }
function buildElemento(pki,pkf){
  let ini=pki, fin=pkf;
  if((fin==null||fin==='') && pki!=null){ const p=String(pki).split(/\s*-\s*/); if(p.length>=2){ ini=p[0]; fin=p.slice(1).join(' - '); } }
  const a=pkNorm(ini); if(!a) return '';
  const b=pkNorm(fin); return b? ('tm2 pk '+a+' - '+b) : ('tm2 pk '+a);
}

function getCantidades(){
  /* D171: cada equipo viaja como {id_registro, id_maquina, tipo_equipo}; sin horas/operador/motivo
   * (el reparto de horas de D46 ya no aplica: las horas salen del Parte Digital). */
  const rows=[];
  document.querySelectorAll('#cantidadesContainer .linea').forEach(b=>{
    const a=b.querySelector('.l-act').value; if(!a) return;
    const x=ACT_IDX[a];
    const pki=b.querySelector('.l-pki').value.trim(), pkf=b.querySelector('.l-pkf').value.trim();
    const uf=ufFromPk(pki), proy=proyectoFromUf(uf);
    // D58 — desmonte (02.01) / descapote (02.03): captura en m² → genera 3 filas a DATA.
    if(x.medida==='m2_desmonte'){
      const v=desmonteVals(b, x);
      const obs=b.querySelector('.l-obs').value.trim();
      // La máquina del frente (D20) va a DOS filas de MAQUINARIA: la contractual (desmonte/descapote,
      // producción m²/m³) y la no aprovechable (producción m³). D171: solo el código, con id_registro
      // propio por fila (D82); la producción de cada fila la pone el backend desde la línea.
      // La ZODME (Fila C) NO lleva máquina.
      const lineaI=b.id.split('_')[1];
      const equiposA=equiposDe(lineaI), equiposB=equiposDe(lineaI);
      // Fila A — contractual a DATA en Ha (m²÷10 000); máquina con prod_maquina en m²/m³
      rows.push({ id_registro:TM2Offline.uuid(), grupo:grupoFromCc(x.cc), capitulo:capFromCc(x.cc), actividad:a, descripcion:x.item, sub_actividad:'',
        centro_costo: proy?(proy+'.'+x.cc):'', unidad:x.uni, data:true, uf:uf||'', proyecto:proy,
        elemento:buildElemento(pki,pkf), pk_inicial:pki, pk_final:pkf, abs_inicial:pkToMeters(pki), abs_final:pkToMeters(pkf),
        liberacion:'CAMPO', largo:v.ha, observacion:obs, equipos:equiposA,
        prod_maquina:v.prodMaq, unidad_maquina:v.maqU });
      // Fila B — excavación no aprovechable (m²×espesor) en m³; hereda PK/UF (D04); CC=proy.02.05.
      // Lleva la misma máquina (mitad de horas, producción m³ vía su largo). El backend encadena la
      // ZODME (Fila C, 02.08) por la ruta existente de D17 — esa sí sin máquina.
      rows.push({ id_registro:TM2Offline.uuid(), grupo:'TIERRAS', capitulo:'EXPLANACIONES', actividad:'Excavación no aprovechable',
        descripcion:'Excavaciones en material común NO APROVECHABLE', sub_actividad:'',
        centro_costo: proy?(proy+'.02.05'):'', unidad:'m3', data:true, uf:uf||'', proyecto:proy,
        elemento:buildElemento(pki,pkf), pk_inicial:pki, pk_final:pkf, abs_inicial:pkToMeters(pki), abs_final:pkToMeters(pkf),
        liberacion:'CAMPO', largo:v.m3, observacion:(obs?obs+' · ':'')+DESM_TAG, equipos:equiposB, derivada:'descapote_desmonte' });
      return;
    }
    let largo;
    const lineaI = b.id.split('_')[1];
    if(x.medida==='m2_via'){ const ai=pkToMeters(pki), af=pkToMeters(pkf), an=parseFloat(b.querySelector('.l-ancho').value)||0; largo=(ai!=null&&af!=null&&an>0)?Math.round(Math.abs(af-ai)*an*100)/100:0; }
    else if(x.medida==='apoyo'){ largo=null; }
    else {
      const prodEl=b.querySelector('.l-prod'), prodDiv=document.getElementById('prod_'+lineaI);
      largo=(prodEl && prodDiv && prodDiv.style.display!=='none') ? (parseFloat(prodEl.value)||0) : null;
    }
    const equipos=equiposDe(lineaI);
    const esApoyo = x.medida==='apoyo';
    rows.push({ id_registro:TM2Offline.uuid(), grupo:esApoyo?'':grupoFromCc(x.cc), capitulo:esApoyo?'':capFromCc(x.cc),
      actividad:esApoyo?'APOYO':a, descripcion:x.item, sub_actividad:x.sub||'',
      centro_costo: (x.data&&proy)?(proy+'.'+x.cc):'', unidad:x.uni, data:x.data, uf:esApoyo?'':uf||'', proyecto: x.data?proy:'',
      elemento:buildElemento(pki,pkf), pk_inicial:pki, pk_final:pkf, abs_inicial:pkToMeters(pki), abs_final:pkToMeters(pkf),
      liberacion:'CAMPO', largo:largo, observacion:b.querySelector('.l-obs').value.trim(), equipos:equipos });
  });
  return rows;
}
function validate(){
  let ok=true;
  refreshAll();
  document.querySelectorAll('.field-error').forEach(e=>e.classList.remove('field-error'));
  const fecha=document.getElementById('fechaReporte'); if(!fecha.value){ fecha.classList.add('field-error'); ok=false; }
  document.querySelectorAll('#cantidadesContainer .linea').forEach(b=>{
    const act=b.querySelector('.l-act'), pki=b.querySelector('.l-pki'), pkf=b.querySelector('.l-pkf');
    if(!act.value){ act.classList.add('field-error'); ok=false; return; }
    const x=ACT_IDX[act.value];
    const lineaI=b.id.split('_')[1];
    if(!pki.value.trim() && x.medida!=='apoyo'){ pki.classList.add('field-error'); ok=false; }
    if(x.medida==='m2_via'){ if(!pkf.value.trim()){ pkf.classList.add('field-error'); ok=false; } }
    else if(x.medida==='m2_desmonte'){ const m2=b.querySelector('.l-m2'); if(m2 && !m2.value){ m2.classList.add('field-error'); ok=false; } }
    else if(x.medida!=='apoyo'){
      const prodDiv=document.getElementById('prod_'+lineaI);
      const prod=b.querySelector('.l-prod');
      if(prod && prodDiv && prodDiv.style.display!=='none' && !prod.value){ prod.classList.add('field-error'); ok=false; }
    }
    // D171: los equipos son solo códigos; no hay nada que validar por máquina.
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
  // D82: id_reporte + id_registro por fila generados EN EL CLIENTE (dedupe de reenvíos en Codigo.gs)
  const data={ id_reporte:TM2Offline.uuid(), fecha:document.getElementById('fechaReporte').value, rol:'capataz', capataz:localStorage.getItem('usuario')||'capataz', cantidades:getCantidades(), observacion_general:(document.getElementById('obsGeneral').value||'').trim() };
  // D82: intento directo con timeout ~15 s; si no hay red / no responde, va a la cola local
  const r=await TM2Offline.enviarConCola({ tipo:'reporte', url:APPS_SCRIPT_URL, payload:data, fecha_obra:data.fecha, usuario:data.capataz });
  if(r.enviado){
    const res=r.res;
    if(!res || !res.ok){
      alert('⚠ No se pudo guardar: '+((res&&res.error)||'Respuesta inesperada del servidor')+'\n\nNo cierres la página, intenta enviar de nuevo.');
    } else {
      exito=true;
      mostrarExito('servidor','Se guardaron '+res.cantidades+' actividad(es) y '+res.maquinas+' equipo(s).');
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
  document.getElementById('cantidadesContainer').innerHTML=''; lineaIdx=0; Object.keys(SEL).forEach(k=>delete SEL[k]);
  document.getElementById('obsGeneral').value='';
  document.getElementById('successScreen').classList.remove('visible');
  document.getElementById('formMain').classList.remove('hidden');
  document.getElementById('submitBar').classList.remove('hidden');
  document.getElementById('btnSubmit').textContent='ENVIAR REPORTE DEL DÍA →'; document.getElementById('btnSubmit').disabled=false;
  document.getElementById('fechaReporte').value=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
  addLinea();
}
