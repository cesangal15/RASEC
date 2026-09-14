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

// D138: la flota YA NO vive aquí — la sirve `?action=maquinas&fecha=` desde la hoja MAQUINAS, así que
// un alta o una baja es editar una fila, sin tocar código ni redesplegar. Lo de abajo es el RESPALDO
// de último recurso: solo se usa si este teléfono nunca ha tenido señal (ver flota.js). Conviene
// mantenerlo grosso modo al día, pero ya no manda.
// D136: NH69/BL009/CS78B/NH404/NH420/CAT900/NH421 salieron de la obra (ago-2026); de las
// que quedan, solo NH403 y RT-02 son alquiladas.
const MAQUINAS_RESPALDO = ['BL005','EXC015','FNG02','MO03','MO04','MO09','CR08','CR019','CR013','CR016','NH403','CR026','RT-02'];
const TIPO_RESPALDO = {'BL005':'BULLDOZER','EXC015':'EXCAVADORA','MO03':'MOTONIVELADORA','MO04':'MOTONIVELADORA','MO09':'MOTONIVELADORA','FNG02':'FINISHER','CR08':'VIBROCOMPACTADOR','CR019':'VIBROCOMPACTADOR','CR013':'VIBROCOMPACTADOR','CR016':'VIBROCOMPACTADOR','NH403':'VIBROCOMPACTADOR','CR026':'MINIBULDOZER','RT-02':'RETROEXCAVADORA'};
// Alquiladas = 5 h programadas; el resto (propias) cae al default de 6.4 h en progHoras().
const PROG_RESPALDO = {'NH403':5,'RT-02':5};
// Estado vivo (se repuebla al cargar la flota del día). Arranca en el respaldo para que la pantalla
// sirva desde el primer instante, incluso antes de que responda el servidor.
let MAQUINAS = MAQUINAS_RESPALDO.slice();
let TIPO_EQUIPO = Object.assign({}, TIPO_RESPALDO);
let HORAS_PROG = Object.assign({}, PROG_RESPALDO);
// Tipos sin producción propia (compactan/apoyan frentes de otras máquinas): vibros + mini cargador/buldozer (D41/D44)
// + la retroexcavadora RT-02 "la pajarita" (alquilada, 5 h): apoya frentes de otras máquinas.
const TIPOS_SIN_PRODUCCION = ['VIBROCOMPACTADOR','MINICARGADOR','MINIBULDOZER','RETROEXCAVADORA'];
function progHoras(id){ return HORAS_PROG[id]!==undefined?HORAS_PROG[id]:6.4; }
const MOTIVOS = ['Mantenimiento','Sin operador','Falla mecánica','Lluvia / clima','Sin frente de trabajo','Esperando material','Abastecimiento de combustible','Traslado / movilización','Bloqueo','Otro (especificar)'];

let lineaIdx = 0, eqIdx = 0;

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
  // D138: flota del día desde la hoja MAQUINAS (con caída a caché sin señal). No bloquea la pantalla:
  // los desplegables ya están pintados con el respaldo y se repintan cuando llegue.
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
// `actual` se conserva SIEMPRE como opción aunque ya no esté en la flota del día: si al recargar la
// lista desapareciera la máquina que el capataz ya eligió, se le borraría el dato sin que lo note.
function maqOptions(actual){
  const extra = (actual && MAQUINAS.indexOf(actual)<0) ? '<option value="'+esc(actual)+'" selected>'+esc(actual)+' (fuera de la flota del día)</option>' : '';
  return '<option value="">— Máquina —</option>'+extra+MAQUINAS.map(m=>'<option'+(m===actual?' selected':'')+'>'+esc(m)+'</option>').join('');
}
/* D138 — recarga la flota vigente para la fecha del reporte y repinta los desplegables de equipo ya
 * puestos, conservando lo elegido. Se llama al abrir y al cambiar la fecha (una máquina que hoy está
 * puede no haber estado el día que se reporta). Sin señal cae a la caché de este teléfono. */
function refrescarFlota(){
  const fecha=(document.getElementById('fechaReporte')||{}).value||'';
  return TM2Flota.cargar(APPS_SCRIPT_URL, fecha, {ids:MAQUINAS_RESPALDO, tipos:TIPO_RESPALDO, prog:PROG_RESPALDO})
    .then(function(fl){
      MAQUINAS=TM2Flota.ids(fl.maquinas); TIPO_EQUIPO=TM2Flota.tipos(fl.maquinas); HORAS_PROG=TM2Flota.progs(fl.maquinas);
      document.querySelectorAll('select.e-id').forEach(function(sel){ sel.innerHTML=maqOptions(sel.value); });
      const av=document.getElementById('avisoFlota'), t=TM2Flota.aviso(fl);
      if(av){ av.textContent=t; av.style.display=t?'block':'none'; }
    });
}
function motivoOptions(){ return '<option value="">— Motivo —</option>'+MOTIVOS.map(m=>'<option>'+esc(m)+'</option>').join(''); }

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
    +'<div class="equipos-block"><span class="eqlabel">Equipos que ejecutaron esta actividad</span>'
    +'<div id="eqs_'+i+'"></div>'
    +'<button class="btn-add mini" data-on-click="addEquipo('+i+')">+ Equipo</button></div>'
    // D103: esta nota por actividad ya salía en DATA (col S) y ahora también en el WhatsApp del día,
    // bajo su actividad; el placeholder lo dice para que se use como nota y no quede en blanco.
    +'<div class="field" data-estilo="margin-top:14px;"><label>Nota de esta actividad <span class="opt">(opcional · sale en el WhatsApp)</span></label>'
    +'<input type="text" class="l-obs" placeholder="ej. se paró 2h por lluvia en este frente"></div>';
  document.getElementById('cantidadesContainer').appendChild(div);
  refreshCounts();
}
function delLinea(i){ const el=document.getElementById('linea_'+i); if(el) el.remove(); renumber(); refreshCounts(); }
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

function addEquipo(i){
  const cont=document.getElementById('eqs_'+i), j=eqIdx++;
  const row=document.createElement('div'); row.className='eq-item'; row.id='eq_'+j;
  row.innerHTML=
    '<div class="eq-top"><select class="e-id" data-on-change="onEqChange('+j+')">'+maqOptions('')+'</select>'
    +'<button class="btn-del" data-on-click="delEquipo('+j+')" title="Quitar">✕</button></div>'
    +'<div class="eq-dup" id="eqdup_'+j+'" data-estilo="display:none;"></div>'
    +'<div class="eq-prog" id="eqprog_'+j+'"></div>'
    +'<div class="grid2" id="eqfull_'+j+'">'
    +'<div class="field" data-estilo="margin:0;"><label>Operador <span class="req">*</span></label><input type="text" class="e-op" placeholder="nombre" data-on-input="refreshAll()"></div>'
    +'<div class="field" data-estilo="margin:0;"><label>Horas operadas <span class="req">*</span></label><input type="number" step="any" class="e-hrs" placeholder="0" data-on-input="onEqChange('+j+')"></div>'
    +'</div>'
    +'<div class="eq-diff" id="eqdiff_'+j+'"></div>'
    +'<div class="eq-motivo field" id="eqmot_'+j+'" data-estilo="margin:0;"><label>Motivo de horas menos <span class="req">*</span></label>'
    +'<select class="e-mot-sel" data-on-change="onMotChange(this);refreshAll()">'+motivoOptions()+'</select>'
    +'<input type="text" class="e-mot-otro" placeholder="especifica el motivo" data-estilo="display:none;margin-top:8px;" data-on-input="refreshAll()"></div>';
  cont.appendChild(row);
}
function delEquipo(j){ const el=document.getElementById('eq_'+j); if(el) el.remove(); refreshAll(); }
function onMotChange(sel){ const otro=sel.parentElement.querySelector('.e-mot-otro'); otro.style.display=(sel.value==='Otro (especificar)')?'block':'none'; }
function onEqChange(j){ refreshAll(); }
/* Programadas / diferencia / motivo de una línea de equipo (solo primera aparición de la máquina) */
function updateEqProgDiff(j){
  const row=document.getElementById('eq_'+j); if(!row) return;
  const id=row.querySelector('.e-id').value;
  const prog=document.getElementById('eqprog_'+j), diff=document.getElementById('eqdiff_'+j), mot=document.getElementById('eqmot_'+j);
  if(!id){ prog.style.display='none'; diff.style.display='none'; mot.style.display='none'; return; }
  const ph=progHoras(id);
  prog.style.display='block'; prog.innerHTML='Programadas: <b>'+ph+' h</b> · '+(ph===5?'alquilada':'propia');
  const op=parseFloat(row.querySelector('.e-hrs').value), falt=(!isNaN(op))?+(ph-op).toFixed(2):0;
  if(falt>0.01){ diff.style.display='block'; diff.textContent='⚠ Total del día '+(op)+' h · '+falt+' h muertas — indica el motivo'; mot.style.display='block'; }
  else { diff.style.display='none'; mot.style.display='none'; }
}
/* D46 — una máquina que ya se registró antes en el reporte se muestra en solo lectura;
   aquí solo cuenta la producción de la actividad adicional. */
function refreshDuplicates(){
  const seen={};
  document.querySelectorAll('#cantidadesContainer .eq-item').forEach(eq=>{
    const j=eq.id.split('_')[1];
    const id=eq.querySelector('.e-id').value;
    const full=document.getElementById('eqfull_'+j), dup=document.getElementById('eqdup_'+j);
    const mot=document.getElementById('eqmot_'+j), prog=document.getElementById('eqprog_'+j), diff=document.getElementById('eqdiff_'+j);
    if(id && seen[id]){
      eq.classList.add('is-dup');
      full.style.display='none'; mot.style.display='none'; prog.style.display='none'; diff.style.display='none';
      const ref=seen[id];
      dup.style.display='block';
      dup.innerHTML='↪ '+(ref.op?'<b>'+esc(ref.op)+'</b> · ':'')+fmtH(ref.hrs)+' · ya registradas en <b>'+esc(ref.actLabel)+'</b>'+(ref.pkTxt?' · '+esc(ref.pkTxt):'')
        +'<br><span class="eq-dup-note">Aquí solo cuenta la producción de esta actividad.</span>';
    } else {
      eq.classList.remove('is-dup');
      dup.style.display='none'; full.style.display='';
      updateEqProgDiff(j);
      if(id){
        const linea=eq.closest('.linea'), a=linea?linea.querySelector('.l-act').value:'';
        const pki=linea?linea.querySelector('.l-pki').value.trim():'', pkf=linea?linea.querySelector('.l-pkf').value.trim():'';
        seen[id]={ op:eq.querySelector('.e-op').value.trim(), hrs:parseFloat(eq.querySelector('.e-hrs').value)||0,
          actLabel:(a||'(sin actividad)'), pkTxt: pki?('PK '+(pkf?pki+'–'+pkf:pki)):'' };
      }
    }
  });
}
function refreshAll(){
  refreshDuplicates();
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

function fmtH(h){ if(h==null||isNaN(h)) h=0; return (Math.round(h*100)/100)+' h'; }
function fmtNum(n){ if(n==null||isNaN(n)) return '0'; return ''+(Math.round(n*100)/100); }
function eqMotivo(eq){
  const sel=eq.querySelector('.e-mot-sel'); if(!sel) return '';
  if(sel.value==='Otro (especificar)') return (eq.querySelector('.e-mot-otro').value||'').trim();
  return sel.value||'';
}
/* Producción numérica de una actividad (para repartir horas). null = sin producción numérica
   (apoyo o tramo incompleto) → reparto en partes iguales. */
function lineaProd(li){
  const b=document.getElementById('linea_'+li); if(!b) return null;
  const a=b.querySelector('.l-act').value; if(!a) return null;
  const x=ACT_IDX[a]; if(!x || x.medida==='apoyo') return null;
  const prodDiv=document.getElementById('prod_'+li);
  if(prodDiv && prodDiv.style.display==='none') return null;
  if(x.medida==='m2_via'){
    const ai=pkToMeters(b.querySelector('.l-pki').value), af=pkToMeters(b.querySelector('.l-pkf').value), an=parseFloat(b.querySelector('.l-ancho').value)||0;
    return (ai!=null&&af!=null&&an>0)?Math.round(Math.abs(af-ai)*an*100)/100:null;
  }
  if(x.medida==='m2_desmonte'){ const v=desmonteVals(b, x); return v.prodMaq>0?v.prodMaq:null; } // producción real de la máquina (m²/m³)
  const prodEl=b.querySelector('.l-prod'); const v=prodEl?parseFloat(prodEl.value):NaN;
  return isNaN(v)?null:v;
}
/* Reparte un total entre pesos, redondeando a 2 decimales y dejando el residuo en el último. */
function distribute(total,weights){
  if(!weights.length) return [];
  const out=weights.map(w=>Math.round((total*w)*100)/100);
  const s=out.reduce((a,b)=>a+b,0);
  out[out.length-1]=+(out[out.length-1]+(total-s)).toFixed(2);
  return out;
}
/* Agrupa cada máquina con todas sus apariciones del día (D46).
   Horas operadas y motivo se toman de la PRIMERA aparición; las horas se reparten
   proporcionalmente a la producción de cada actividad (partes iguales si alguna no es numérica).
   Horas muertas = programadas − total del día (repartidas con los mismos pesos). */
function gatherMachineGroups(){
  const map={}, order=[];
  document.querySelectorAll('#cantidadesContainer .eq-item').forEach(eq=>{
    const id=eq.querySelector('.e-id').value; if(!id) return;
    const linea=eq.closest('.linea'); if(!linea) return;
    const li=linea.id.split('_')[1];
    const a=linea.querySelector('.l-act').value, x=a?ACT_IDX[a]:null;
    const pki=linea.querySelector('.l-pki').value.trim(), pkf=linea.querySelector('.l-pkf').value.trim();
    const pkTxt= pki?('PK '+(pkf?pki+'–'+pkf:pki)):'';
    if(!map[id]){
      map[id]={ id, tipo:TIPO_EQUIPO[id]||'', programmed:progHoras(id),
        operador:eq.querySelector('.e-op').value.trim(),
        totalHours:parseFloat(eq.querySelector('.e-hrs').value)||0,
        motivo:eqMotivo(eq), muertasTotal:0, appearances:[] };
      order.push(id);
    }
    const apUni = (x && x.medida==='m2_desmonte') ? (x.maqUnidad==='m2'?'m²':'m³') : (x?x.uni:'');
    map[id].appearances.push({ eqId:eq.id, lineaId:li, actLabel:(a||'(sin actividad)'), pkTxt, prod:lineaProd(li), unidad:apUni });
  });
  order.forEach(id=>{
    const g=map[id], n=g.appearances.length;
    const prods=g.appearances.map(ap=>ap.prod);
    const allNum=prods.every(p=>typeof p==='number'&&p>0);
    let weights;
    if(allNum){ const s=prods.reduce((a,b)=>a+b,0); weights=prods.map(p=>p/s); }
    else { weights=prods.map(()=>1/n); }
    g.muertasTotal=Math.max(0,+(g.programmed-g.totalHours).toFixed(2));
    const oper=distribute(g.totalHours,weights), prog=distribute(g.programmed,weights), mu=distribute(g.muertasTotal,weights);
    g.appearances.forEach((ap,k)=>{ ap.horas=oper[k]; ap.prog=prog[k]; ap.muertas=mu[k]; ap.weight=weights[k]; });
  });
  return {map,order};
}
function updateResumen(){
  const lineas=document.querySelectorAll('#cantidadesContainer .linea');
  const card=document.getElementById('resumenCard'), body=document.getElementById('resumenBody');
  if(!lineas.length){ card.style.display='none'; return; }
  const {map,order}=gatherMachineGroups();
  const byEq={};
  order.forEach(id=>{ map[id].appearances.forEach(ap=>{ byEq[ap.eqId]={id, op:map[id].operador, horas:ap.horas}; }); });
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
    b.querySelectorAll('.eq-item').forEach(r=>{
      const rawId=r.querySelector('.e-id').value; if(!rawId) return;
      const e=byEq[r.id], isDup=r.classList.contains('is-dup');
      eqsHtml+='<span class="resumen-eq'+(isDup?' sin-op':'')+'"><b>'+esc(rawId)+'</b> · '+fmtH(e?e.horas:0)+(e&&e.op?' · '+esc(e.op):'')+(isDup?' ↪':'')+'</span>';
    });
    const incompleto=(!pki && x.medida!=='apoyo')||sinProd;
    html+='<div class="resumen-row'+(incompleto?' incompleto':'')+'">'
      +'<div class="resumen-act">'+esc(a)+'</div>'
      +(pkTxt?'<div class="resumen-pk">📍 '+esc(pkTxt)+'</div>':'')
      +prodHtml
      +(eqsHtml?'<div class="resumen-eqs">'+eqsHtml+'</div>':'<div class="resumen-warn">⚠ sin equipos</div>')
      +'</div>';
  });
  if(order.length){
    html+='<div class="resumen-sub">Maquinaria del día</div>';
    order.forEach(id=>{
      const g=map[id], multi=g.appearances.length>1;
      if(g.muertasTotal>0.01 && !g.motivo) warnings++;
      html+='<div class="maq-group">'
        +'<div class="maq-head"><span class="maq-id">'+esc(id)+'</span>'
        +(g.operador?'<span class="maq-op">'+esc(g.operador)+'</span>':'')
        +(multi?'<span class="maq-op">· '+g.appearances.length+' actividades</span>':'')+'</div>'
        +'<div class="maq-hours">total <b>'+fmtH(g.totalHours)+'</b> / prog '+fmtH(g.programmed)
        +(g.muertasTotal>0.01?(' · muertas <b>'+fmtH(g.muertasTotal)+'</b>'+(g.motivo?' ('+esc(g.motivo)+')':' <span data-estilo="color:var(--accent-txt)">⚠ sin motivo</span>')):'')
        +'</div>';
      g.appearances.forEach(ap=>{
        const prodTxt=(ap.prod!=null)?(fmtNum(ap.prod)+(ap.unidad?' '+esc(ap.unidad):'')):'sin prod. num.';
        html+='<div class="maq-act">• '+esc(ap.actLabel)+(ap.pkTxt?' · '+esc(ap.pkTxt):'')+' — '+prodTxt+(multi?' — <b>'+fmtH(ap.horas)+'</b>':'')+'</div>';
      });
      html+='</div>';
    });
  }
  const totalActs=lineas.length, totalMaq=order.length;
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
  /* D46 — reparte horas (operadas/programadas/muertas) por máquina entre sus apariciones del día. */
  const {map,order}=gatherMachineGroups();
  const byEq={};
  order.forEach(id=>{ const g=map[id]; g.appearances.forEach(ap=>{
    byEq[ap.eqId]={ id_maquina:id, tipo_equipo:g.tipo, operador:g.operador,
      horas_programadas:ap.prog, horas_operadas:ap.horas, horas_muertas:ap.muertas,
      motivo: ap.muertas>0.01 ? g.motivo : '' };
  }); });
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
      // producción m²/m³) y la no aprovechable (producción m³). Es una sola operación física, así que
      // las horas operadas se reparten por igual entre ambas (suma = horas reales, espíritu de D46);
      // las programadas/muertas/motivo quedan en la fila A para que el encargado calcule bien las
      // muertas (prog − Σoper). La ZODME (Fila C) NO lleva máquina.
      const equiposA=[], equiposB=[];
      b.querySelectorAll('.eq-item').forEach(r=>{
        const e=byEq[r.id]; if(!e) return;
        const sinProd=TIPOS_SIN_PRODUCCION.includes(e.tipo_equipo);
        const opAll=parseFloat(e.horas_operadas)||0;
        const opA=Math.round((opAll/2)*100)/100, opB=Math.round((opAll-opA)*100)/100;
        // D82: id_registro UUID de CLIENTE por fila de MAQUINARIA (dedupe de reenvíos de la cola)
        equiposA.push({...e, id_registro:TM2Offline.uuid(), horas_operadas:opA, produccion:sinProd?null:v.prodMaq});
        equiposB.push({...e, id_registro:TM2Offline.uuid(), horas_operadas:opB, horas_programadas:0, horas_muertas:0, motivo:'', produccion:sinProd?null:v.m3});
      });
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
    const equipos=[];
    b.querySelectorAll('.eq-item').forEach(r=>{ const e=byEq[r.id]; if(e) equipos.push({...e, id_registro:TM2Offline.uuid(), produccion:TIPOS_SIN_PRODUCCION.includes(e.tipo_equipo)?null:largo}); });
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
    b.querySelectorAll('.eq-item').forEach(r=>{
      if(r.classList.contains('is-dup')) return; /* D46 — horas/operador/motivo heredados de la 1ª aparición */
      const idI=r.querySelector('.e-id'), hrsI=r.querySelector('.e-hrs'), opI=r.querySelector('.e-op'), motSel=r.querySelector('.e-mot-sel'), motOtro=r.querySelector('.e-mot-otro');
      const id=idI.value, hrs=parseFloat(hrsI.value)||0;
      if(!id && !hrs && !opI.value.trim()) return;
      if(!id){ idI.classList.add('field-error'); ok=false; }
      if(!opI.value.trim()){ opI.classList.add('field-error'); ok=false; }
      if(!hrsI.value){ hrsI.classList.add('field-error'); ok=false; }
      if(id && hrs>0 && (progHoras(id)-hrs)>0.01){
        if(!motSel.value){ motSel.classList.add('field-error'); ok=false; }
        else if(motSel.value==='Otro (especificar)' && !motOtro.value.trim()){ motOtro.classList.add('field-error'); ok=false; }
      }
    });
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
  document.getElementById('cantidadesContainer').innerHTML=''; lineaIdx=0;
  document.getElementById('obsGeneral').value='';
  document.getElementById('successScreen').classList.remove('visible');
  document.getElementById('formMain').classList.remove('hidden');
  document.getElementById('submitBar').classList.remove('hidden');
  document.getElementById('btnSubmit').textContent='ENVIAR REPORTE DEL DÍA →'; document.getElementById('btnSubmit').disabled=false;
  document.getElementById('fechaReporte').value=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
  addLinea();
}
