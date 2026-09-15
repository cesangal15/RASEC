// D170: aplica los data-estilo del marcado ANTES de que corra la lógica de la pantalla (ver tema.js).
if(window.TM2Estilos) TM2Estilos.aplicar();
const APPS_SCRIPT_URL = GALCA_ENV.url.obra;          // entorno.js (D168): producción o prueba

// origen -> ítem de excavación
const ORIGENES = {
  'Masivo2':        {actividad:'Excavación aprovechable (masivo)', item:'Excavaciones en material común APROVECHABLE', cc:'02.05', label:'Masivo 2 (PK 19)'},
  'Masivo1':        {actividad:'Excavación aprovechable (masivo)', item:'Excavaciones en material común APROVECHABLE', cc:'02.05', label:'Masivo 1 (PK 14)'},
  'Diviso':         {actividad:'Excavación de préstamo (Diviso)',  item:'Excavación en material común de préstamos',   cc:'02.06', label:'Diviso / Préstamo'},
  'Complementario': {actividad:'Excavación aprovechable (masivo)', item:'Excavaciones en material común APROVECHABLE', cc:'02.05', label:'PK Complementario'},
  'Otro':           {actividad:'Excavación aprovechable (masivo)', item:'Excavaciones en material común APROVECHABLE', cc:'02.05', label:'Otro origen'},
};
// UF3: material excavado aquí que se envió a la UF3. Se trata IGUAL que Puente (cuenta para la
// excavación del origen y sale en la nota/observación del reporte, pero NO genera fila de terraplén).
const TIPOS = ['Terraplén','Puente','UF3','ODL','ODT','Botadero'];
// PK fijo de cada origen (Problema 2.12): la EXCAVACIÓN se registra DONDE SE HIZO EL CORTE = el origen.
// Masivo 1/2 y Diviso tienen PK confirmado (todos ≤30 → UF1/3701). Complementario/Otro usan el PK que
// teclea la chequeadora en "Especifica el origen" (origenTexto).
const ORIGEN_PK = { 'Masivo2':'19+800', 'Masivo1':'14+400', 'Diviso':'21+500' };

// Maquinaria (D54, recortada por V3-06(b)/D177): la chequeadora SOLO elige el CÓDIGO de las
// excavadoras que alimentaron el origen — mismos chips que el capataz (D171). Horas operadas, operador,
// horas programadas/muertas, motivo y ESTADO YA NO se piden: esos datos los da el Parte Digital (D165)
// y se revisan en revision-maquinaria.html. La asociación excavadora↔origen es informativa (cruce y
// trazabilidad, D06); la PRODUCCIÓN de cada excavadora la reparte el backend = total m³ excavado del
// día (Σ líneas, cubicaje real D53) ÷ nº de excavadoras marcadas (D54, confirmado sep-2026).
// El selector se limita a las EXCAVADORAS vigentes en la fecha; el resto de la flota no aplica aquí.
// D136: EXC001/EXC013/EXC014 se devolvieron (ago-2026); EXC015 es el respaldo escrito de último recurso.
const MAQUINAS_RESPALDO = ['EXC015'];
const TIPO_RESPALDO = {'EXC015':'EXCAVADORA'};
// Estado vivo del catálogo de excavadoras: [{codigo,tipo,placa}]. Arranca con el respaldo escrito para
// que el bloque sirva desde el primer instante, incluso antes de que responda el servidor (D82).
let EQUIPOS = MAQUINAS_RESPALDO.map(c=>({codigo:c, tipo:TIPO_RESPALDO[c]||'EXCAVADORA', placa:''}));
let EQ_IDX = {};
function indexarEquipos(){ EQ_IDX={}; EQUIPOS.forEach(q=>{ EQ_IDX[q.codigo.toUpperCase()]=q; }); }
indexarEquipos();
function tipoDe(cod){ const q=EQ_IDX[String(cod||'').toUpperCase()]; return q?q.tipo:''; }
// Códigos de excavadora elegidos para este reporte (una vez por reporte, D54), en orden de elección.
let SEL = [];
/* D138/D173 — excavadoras vigentes en la fecha del reporte. Mismo catálogo único que el capataz
 * (PARTE_EQUIPOS servido dentro de `?action=maquinas`, con caída a caché/respaldo sin señal, D82),
 * filtrado a EXCAVADORA: RETROEXCAVADORA y el resto de la flota no alimentan el origen. Se filtra por
 * "empieza por EXCAVADORA" para admitir el vocabulario de PARTE_EQUIPOS (EXCAVADORA · EXCAVADORAS ·
 * EXCAVADORA SOBRE LLANTAS) SIN colar RETROEXCAVADORA (empieza por RETRO). Nunca deja la lista vacía. */
function excavadorasDe(fl){
  return TM2Flota.equiposCapataz(fl).filter(function(q){ return q.tipo.toUpperCase().indexOf('EXCAVADORA')===0; });
}
function refrescarFlota(){
  const fecha=(document.getElementById('fecha')||{}).value||'';
  return TM2Flota.cargar(APPS_SCRIPT_URL, fecha, {ids:MAQUINAS_RESPALDO, tipos:TIPO_RESPALDO, prog:{}})
    .then(function(fl){
      const exc=excavadorasDe(fl);
      // Si la flota del día no trae ninguna excavadora, se conserva la anterior: dejar el catálogo
      // vacío le impediría a la chequeadora reportar la máquina del origen (D54).
      if(exc.length){ EQUIPOS=exc; indexarEquipos(); }
      renderChips();
      const pk=document.getElementById('eqpick'); if(pk && pk.classList.contains('abierto')) renderPicker();
      const t=TM2Flota.aviso(fl);
      if(t) TM2Offline.bannerCatalogoViejo(document.querySelector('.container'), t);
    });
}

let lineaIdx = 0;
// Cubicaje real por placa (D53): mapa placa→m³/viaje cacheado al cargar. Vacío = todo cae al factor.
let CUBMAP = {};

window.onload = function(){
  // D82: sesión en localStorage (sobrevive cierre del navegador en zona muerta)
  const rol = localStorage.getItem('rol');
  const usuario = localStorage.getItem('usuario');
  if(!rol || (rol!=='chequeadora' && rol!=='admin')){ window.location.href='index.html'; return; }
  document.getElementById('userDisplay').textContent = usuario || 'chequeadora';
  if(rol==='admin'){var _bm=document.getElementById('btnMenu');if(_bm)_bm.style.display='inline-block';}
  document.getElementById('fecha').value = new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
  cargarCubicaje();
  addLinea();
  renderChips();   // V3-06(b): pinta el bloque de excavadoras (vacío) desde el primer instante
  // D138: excavadoras vigentes ese día (no bloquea: los chips ya funcionan con el respaldo escrito).
  refrescarFlota();
  document.getElementById('fecha').addEventListener('change', refrescarFlota);
};
function logout(){
  // solo la sesión: la cola de envíos pendientes NO se borra al cerrar sesión (D82)
  localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token');
  window.location.href='index.html';
}

// Trae el catálogo placa→cubicaje con caché-fallback (D82 §2.7): fresco si hay señal (y se guarda
// copia local); sin señal usa la última copia con aviso de fecha. Sin señal Y sin copia: CUBMAP={}
// y todo cae al factor fijo 14 ya existente (D54) — el envío NUNCA se bloquea por esto.
async function cargarCubicaje(){
  try{
    const r=await TM2Offline.catalogoCache('cubicaje', async function(){
      const resp=await fetch(APPS_SCRIPT_URL+'?action=cubicaje');
      const data=await resp.json();
      if(!data || !data.cubicaje) throw new Error('sin catálogo de cubicaje');
      return data.cubicaje;
    }, 24);
    CUBMAP=r.data||{};
    if(!r.fresco) TM2Offline.bannerCatalogoViejo(document.querySelector('.container'),
      'Sin señal: usando el cubicaje guardado del '+TM2Offline.fechaCorta(r.guardado)+'. Placas que no estén ahí usan el factor 14 m³/viaje.');
  }catch(err){ CUBMAP={}; }
  recalcAll(); // re-pinta totales/placas con el cubicaje ya cargado
}
// Normaliza la placa EXACTAMENTE como el parser: sin espacios ni guion, MAYÚSCULAS, 6 chars.
function normPlaca(s){ return String(s==null?'':s).replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(-6); }
// Cubicaje de una placa válida: del catálogo si existe, si no el factor del reporte (fallback 14).
function cubDePlaca(placa){ const c=CUBMAP[normPlaca(placa)]; return (c!=null)?c:m3viaje(); }

function pkToMeters(pk){ if(!pk) return null; pk=String(pk).toLowerCase().replace(/pk/g,'').trim().replace(/\s/g,''); if(pk.includes('+')){const p=pk.split('+');const km=parseInt(p[0]);const m=parseInt(p[1]||'0');if(isNaN(km))return null;return km*1000+(isNaN(m)?0:m);} const n=parseFloat(pk);return isNaN(n)?null:n*1000; }
function ufFromPk(pk){ const m=pkToMeters(pk); if(m==null) return ''; return m<=30000?'UF1':'UF2'; }
function proyectoFromUf(uf){ return uf==='UF1'?'3701':uf==='UF2'?'3702':''; }
// ELEMENTO unificado (Problema 2.12): "tm2 pk NN+NNN"; normaliza el PK y no duplica el token "pk".
function pkNorm(s){ const m=pkToMeters(s); if(m==null) return ''; const km=Math.floor(m/1000), r=Math.round(m-km*1000); return km+'+'+('00'+r).slice(-3); }
function buildElemento(pki,pkf){
  let ini=pki, fin=pkf;
  if((fin==null||fin==='') && pki!=null){ const p=String(pki).split(/\s*-\s*/); if(p.length>=2){ ini=p[0]; fin=p.slice(1).join(' - '); } }
  const a=pkNorm(ini); if(!a) return '';
  const b=pkNorm(fin); return b? ('tm2 pk '+a+' - '+b) : ('tm2 pk '+a);
}
// Factor fallback fijo: solo se usa para placas que no están en la hoja CUBICAJE (D53 → 14 fijo, D54).
function m3viaje(){ return 14; }

function onOrigen(){
  const o=document.getElementById('origen').value;
  const pill=document.getElementById('origenPill');
  const textoWrap=document.getElementById('origenTextoWrap');
  if(!o){ pill.style.display='none'; textoWrap.style.display='none'; return; }
  const needsText=(o==='Complementario'||o==='Otro');
  textoWrap.style.display=needsText?'block':'none';
  pill.style.display='block';
  // La excavación se acumula al PK del origen (Problema 2.12); para Masivo/Diviso es fijo.
  const pkFijo=ORIGEN_PK[o];
  pill.innerHTML='→ genera: <b>'+esc(ORIGENES[o].item)+'</b>'+(pkFijo?(' · excavación al <b>pk '+esc(pkFijo)+'</b>'):' · excavación al PK que teclees');
}

function tipoOptions(){ return TIPOS.map(t=>'<option>'+esc(t)+'</option>').join(''); }

function addLinea(){
  const i=lineaIdx++;
  const div=document.createElement('div');
  div.className='linea'; div.id='linea_'+i;
  div.innerHTML=
    '<div class="linea-head"><span class="linea-num">PK #'+(document.querySelectorAll('.linea').length+1)+'</span>'
    +'<button class="btn-del" data-on-click="delLinea('+i+')" title="Eliminar">✕</button></div>'
    +'<div class="grid2">'
    +'<div class="field" data-estilo="margin:0;"><label>PK destino <span class="req">*</span></label>'
    +'<input type="text" class="l-pk" placeholder="16+200" data-on-input="onLinea('+i+')"></div>'
    +'<div class="field" data-estilo="margin:0;"><label>Tipo de destino</label>'
    +'<select class="l-tipo">'+tipoOptions()+'</select></div>'
    +'</div>'
    +'<div class="field" data-estilo="margin-top:14px;"><label>Placas y viajes <span class="req">*</span></label>'
    +'<textarea class="l-bloque" rows="5" placeholder="Pega aquí el bloque (estilo WhatsApp):&#10;USD 360-5&#10;- TAW 895-4&#10;HSG 112-3" data-on-input="onLinea('+i+')"></textarea>'
    +'<div class="bloque-hint">Una placa por renglón: placa (3 letras + 3 números) y viajes tras el guion. El encabezado se ignora.</div></div>'
    +'<div class="placas-preview" id="prev_'+i+'" data-estilo="display:none;"></div>'
    +'<div class="meta-row" id="meta_'+i+'" data-estilo="display:none;">'
    +'<span class="badge m3" id="m3Badge_'+i+'">0 m³</span>'
    +'<span class="badge" id="ufBadge_'+i+'">UF —</span></div>';
  document.getElementById('lineasContainer').appendChild(div);
  refresh();
}
function delLinea(i){ const el=document.getElementById('linea_'+i); if(el) el.remove(); renumber(); refresh(); }
function renumber(){ document.querySelectorAll('#lineasContainer .linea').forEach((el,k)=>{ el.querySelector('.linea-num').textContent='PK #'+(k+1); }); }

/* Parser del bloque estilo WhatsApp.
 * Por renglón: viajes = 1-2 dígitos tras el último guion al final de la línea.
 * Placa = los 6 alfanuméricos previos (ignorando espacios/guiones), MAYÚSCULAS.
 * Válida si calza /^[A-Z]{3}[0-9]{3}$/. Renglones sin patrón viajes (encabezados) se ignoran. */
function parseBloque(texto){
  const out=[];
  String(texto||'').split(/\r?\n/).forEach(raw=>{
    const linea=raw.trim();
    if(!linea) return;
    const m=linea.match(/-\s*(\d{1,2})\s*$/);
    if(!m) return; // encabezado / renglón sin viajes -> ignorar
    const viajes=parseInt(m[1],10);
    const antes=linea.slice(0,m.index);
    const alnum=antes.replace(/[^A-Za-z0-9]/g,'').toUpperCase();
    const placa=alnum.slice(-6);
    const ok=/^[A-Z]{3}[0-9]{3}$/.test(placa) && viajes>0;
    out.push({ placa: ok?placa:alnum, viajes: ok?viajes:0, ok:ok, raw:linea });
  });
  return out;
}
function lineaViajes(b){ return parseBloque(b.querySelector('.l-bloque').value).reduce((s,p)=>s+(p.ok?p.viajes:0),0); }
// Volumen real de la línea (D53): Σ(viajes × cubicaje de cada placa válida). Placa no catalogada → factor.
function lineaM3(b){ return parseBloque(b.querySelector('.l-bloque').value).reduce((s,p)=>s+(p.ok?p.viajes*cubDePlaca(p.placa):0),0); }

function onLinea(i){
  const b=document.getElementById('linea_'+i);
  const pk=b.querySelector('.l-pk').value;
  const placas=parseBloque(b.querySelector('.l-bloque').value);
  const total=placas.reduce((s,p)=>s+(p.ok?p.viajes:0),0);
  const m3real=lineaM3(b); // volumen real con cubicaje por placa (D53)
  const factor=m3viaje();
  // preview de placas parseadas
  const prev=document.getElementById('prev_'+i);
  if(placas.length){
    prev.style.display='block';
    const validas=placas.filter(p=>p.ok), bad=placas.length-validas.length;
    // placa válida pero sin cubicaje en el catálogo -> naranja + aviso (se tomó el factor)
    let sinCub=0;
    const chips=placas.map(p=>{
      if(!p.ok) return '<span class="placa-chip bad" title="No calza el patrón de placa">⚠ '+esc(p.raw)+'</span>';
      if(CUBMAP[normPlaca(p.placa)]==null){ sinCub++;
        return '<span class="placa-chip bad" title="No registrada en CUBICAJE, se tomó '+factor+' m³/viaje">'+esc(p.placa)+' <span class="v">×'+p.viajes+'</span> ⚠</span>'; }
      return '<span class="placa-chip">'+esc(p.placa)+' <span class="v">×'+p.viajes+'</span></span>';
    }).join('');
    prev.innerHTML='<div class="placas-chips">'+chips+'</div>'
      +'<div class="placas-total"><b>'+validas.length+'</b> placa(s) · total <b>'+total+'</b> viajes · <b>'+m3real.toLocaleString('es-CO')+'</b> m³</div>'
      +(bad?'<div class="placas-warn">'+bad+' renglón(es) en naranja no calzan placa y no se cuentan — revísalos.</div>':'')
      +(sinCub?'<div class="placas-warn">'+sinCub+' placa(s) en naranja no están en CUBICAJE: se tomó '+factor+' m³/viaje. Se envían igual.</div>':'');
  } else { prev.style.display='none'; prev.innerHTML=''; }
  // badges
  const meta=document.getElementById('meta_'+i);
  if(!pk && !total){ meta.style.display='none'; refresh(); return; }
  meta.style.display='flex';
  const uf=ufFromPk(pk);
  document.getElementById('m3Badge_'+i).textContent=m3real.toLocaleString('es-CO')+' m³';
  const ufb=document.getElementById('ufBadge_'+i);
  ufb.className='badge'+(uf==='UF1'?' uf1':uf==='UF2'?' uf2':'');
  ufb.textContent= uf? (uf+' · '+proyectoFromUf(uf)) : 'UF —';
  refresh();
}
function recalcAll(){ document.querySelectorAll('#lineasContainer .linea').forEach((el)=>{ onLinea(el.id.split('_')[1]); }); }

/* ---------- Maquinaria (excavadoras) — D54, recortada por V3-06(b)/D177 ----------
 * Una vez por reporte: SOLO los códigos de las excavadoras que alimentaron el origen (chips con
 * búsqueda, mismo componente del capataz, D171). La producción de cada una la reparte el backend =
 * total m³ excavado del día ÷ nº de excavadoras marcadas. Los manejadores van en `data-on-*` (CSP sin
 * inline, D170); el código viaja como cadena JSON para que un guion o comilla no rompa el intérprete. */
function renderChips(){
  const cont=document.getElementById('eqs'); if(!cont) return;
  cont.innerHTML = SEL.map(cod=>{
    const q=EQ_IDX[cod.toUpperCase()];
    const sub = q ? (q.tipo+(q.placa?' · '+q.placa:'')) : 'fuera del catálogo';
    return '<span class="eq-chip'+(q?'':' fuera')+'"><b>'+esc(cod)+'</b><span class="t">'+esc(sub)+'</span>'
      +'<button class="x" type="button" title="Quitar" data-on-click="quitarEquipo('+esc(JSON.stringify(cod))+')">✕</button></span>';
  }).join('');
  refreshMaq();
}
function togglePicker(){
  const pk=document.getElementById('eqpick'), btn=document.getElementById('eqbtn');
  const abrir = !pk.classList.contains('abierto');
  pk.classList.toggle('abierto', abrir);
  btn.textContent = abrir ? '▲ Listo' : '+ Excavadora';
  if(abrir){ renderPicker(); const inp=pk.querySelector('input'); if(inp) inp.focus(); }
}
function renderPicker(filtro){
  const pk=document.getElementById('eqpick'); if(!pk) return;
  const inp=pk.querySelector('input');
  const f=String(filtro!==undefined ? filtro : (inp?inp.value:'')).trim().toUpperCase();
  const sel=SEL.map(c=>c.toUpperCase());
  const grupos={}, orden=[];
  EQUIPOS.forEach(q=>{
    if(f && (q.codigo+' '+q.tipo+' '+q.placa).toUpperCase().indexOf(f)<0) return;
    const g=q.tipo||'SIN TIPO'; if(!grupos[g]){ grupos[g]=[]; orden.push(g); } grupos[g].push(q);
  });
  let html='<input type="text" placeholder="Buscar código, tipo o placa…" value="'+esc(f)+'" data-on-input="renderPicker(this.value)">';
  if(!orden.length) html+='<div class="eq-none">Ninguna excavadora coincide con «'+esc(f)+'».</div>';
  orden.forEach(g=>{
    html+='<div class="eq-grupo">'+esc(g)+'</div><div class="eq-opts">';
    grupos[g].forEach(q=>{
      const on=sel.indexOf(q.codigo.toUpperCase())>=0;
      html+='<button type="button" class="eq-opt'+(on?' on':'')+'" data-on-click="toggleEquipo('+esc(JSON.stringify(q.codigo))+')">'
        +(on?'✓ ':'')+esc(q.codigo)+(q.placa?'<span class="p">'+esc(q.placa)+'</span>':'')+'</button>';
    });
    html+='</div>';
  });
  pk.innerHTML=html;
  // conservar el foco y el cursor mientras se teclea
  if(filtro!==undefined){ const ni=pk.querySelector('input'); if(ni){ ni.focus(); ni.setSelectionRange(ni.value.length, ni.value.length); } }
}
function toggleEquipo(cod){
  const k=SEL.findIndex(c=>c.toUpperCase()===String(cod).toUpperCase());
  if(k>=0) SEL.splice(k,1); else SEL.push(cod);
  renderChips(); renderPicker();
}
function quitarEquipo(cod){
  const k=SEL.findIndex(c=>c.toUpperCase()===String(cod).toUpperCase());
  if(k>=0) SEL.splice(k,1);
  renderChips();
  const pk=document.getElementById('eqpick'); if(pk && pk.classList.contains('abierto')) renderPicker();
}
function refreshMaq(){
  const n=SEL.length;
  document.getElementById('cntMaq').textContent=n;
  document.getElementById('emptyMaq').style.display=n?'none':'block';
  // aviso de cómo repartirá el backend la producción (total excavado ÷ nº de excavadoras)
  const hint=document.getElementById('maqProdHint');
  let tm3=0; document.querySelectorAll('#lineasContainer .linea').forEach(b=>{ tm3+=lineaM3(b); });
  if(n>0 && tm3>0){ hint.style.display='block';
    hint.innerHTML='Producción por excavadora ≈ <b>'+(tm3/n).toLocaleString('es-CO')+'</b> m³ ('+tm3.toLocaleString('es-CO')+' m³ ÷ '+n+'). Horas y operador van por el <b>parte digital</b>.'; }
  else if(n>0){ hint.style.display='block';
    hint.innerHTML='Horas y operador de cada excavadora van por el <b>parte digital</b> (QR de la cabina). La producción la calcula el sistema.'; }
  else { hint.style.display='none'; }
}
/* Lista de excavadoras tal como viaja al backend: SOLO código + tipo (informativo) e id_registro de
 * cliente por máquina para la deduplicación de reenvíos (D82). Sin horas, operador ni motivo (D177). */
function getMaquinaria(){
  return SEL.map(cod=>({ id_registro:TM2Offline.uuid(), id_maquina:cod, tipo_equipo:tipoDe(cod) }));
}

function refresh(){
  const lineas=document.querySelectorAll('#lineasContainer .linea');
  document.getElementById('cnt').textContent=lineas.length;
  document.getElementById('empty').style.display=lineas.length?'none':'block';
  let tv=0, tm3=0; lineas.forEach(b=>{ tv+=lineaViajes(b); tm3+=lineaM3(b); });
  const res=document.getElementById('resumen');
  if(lineas.length){ res.style.display='flex'; document.getElementById('totViajes').textContent=tv; document.getElementById('totM3').textContent=tm3.toLocaleString('es-CO'); }
  else res.style.display='none';
  refreshMaq(); // el aviso de producción por máquina depende del total de m³
}

function getCantidades(){
  const origen=document.getElementById('origen').value;
  if(!origen) return [];
  const exc=ORIGENES[origen];
  const origenTexto=(document.getElementById('origenTexto').value||'').trim();
  const origenLabel=(origen==='Complementario'||origen==='Otro')?(origenTexto||exc.label):exc.label;
  // PK del ORIGEN (Problema 2.12): fijo para Masivo/Diviso; el que teclea la chequeadora para Compl/Otro.
  const origenPk=ORIGEN_PK[origen]||origenTexto;
  const ufO=ufFromPk(origenPk), proyO=proyectoFromUf(ufO);
  const rows=[];
  // Split por DESTINO (D67): lo que va al Botadero se DESCARTA => excavación NO APROVECHABLE.
  // El resto de destinos (Terraplén/Puente/UF3/ODL/ODT) sigue con la actividad del origen (aprovechable
  // o préstamo). destM3 acumula Σ m³ por tipo de destino para la observación indicativa (a dónde fue).
  let aproM3=0, aproViajes=0, botaM3=0, botaViajes=0;
  const destM3={}, destOrden=[];
  // TERRAPLÉN: NO cambia. 1 fila por línea, al PK DESTINO (el lleno se construye allá). D06/D26.
  document.querySelectorAll('#lineasContainer .linea').forEach(b=>{
    const pk=b.querySelector('.l-pk').value.trim();
    const viajes=lineaViajes(b); // total calculado = suma de placas válidas
    const tipo=b.querySelector('.l-tipo').value;
    if(!pk || !viajes) return;
    const m3=lineaM3(b); // volumen real con cubicaje por placa (D53); el backend lo recalcula como fuente
    const lineId=Number(b.id.split('_')[1]); // correlación con la línea de VOLQUETAS para el backend
    if(destM3[tipo]==null){ destM3[tipo]=0; destOrden.push(tipo); }
    destM3[tipo]+=m3;
    if(tipo==='Botadero'){ botaM3+=m3; botaViajes+=viajes; }
    else { aproM3+=m3; aproViajes+=viajes; }
    if(tipo==='Terraplén'){
      const ufD=ufFromPk(pk), proyD=proyectoFromUf(ufD);
      rows.push({ id_registro:TM2Offline.uuid(), grupo:'TIERRAS', capitulo:'EXPLANACIONES', actividad:'Terraplén (conformación)',
        descripcion:'Terraplenes (solo conformación)', centro_costo: proyD?(proyD+'.02.07'):'', unidad:'m3',
        uf:ufD, proyecto:proyD, elemento:buildElemento(pk,''), pk_inicial:pk, pk_final:'',
        abs_inicial:pkToMeters(pk), abs_final:null, liberacion:'CAMPO', largo:m3, _linea:lineId,
        equipos:[], data:true, observacion: origenLabel+' · '+viajes+' viajes' });
    }
  });
  // Desglose de destinos "→ Terraplén 300 · Puente 150 m³" para la observación (indicativo, D67).
  const destTxt = tipos => tipos.map(t=>t+' '+Math.round(destM3[t]).toLocaleString('es-CO')).join(' · ');
  // EXCAVACIÓN: acumulada al PK del ORIGEN (Problema 2.12), ahora en DOS filas según destino (D67):
  // la NO APROVECHABLE (lo que fue a Botadero) y la del origen (el resto). PK/ELEMENTO/ABS/UF/PROYECTO/CC
  // derivan del ORIGEN (donde se hizo el corte). El backend recalcula ambos volúmenes como fuente (D06/D53).
  if(botaViajes>0){
    rows.unshift({ id_registro:TM2Offline.uuid(), grupo:'TIERRAS', capitulo:'EXPLANACIONES', actividad:'Excavación no aprovechable',
      descripcion:'Excavaciones en material común NO APROVECHABLE',
      centro_costo: proyO?(proyO+'.02.05'):'', unidad:'m3', uf:ufO, proyecto:proyO,
      elemento:buildElemento(origenPk,''), pk_inicial:origenPk, pk_final:'',
      abs_inicial:pkToMeters(origenPk), abs_final:null, liberacion:'CAMPO', largo:botaM3,
      _acumBotadero:true, origen:origenLabel, equipos:[], data:true,
      observacion: origenLabel+' · '+botaViajes+' viajes · → Botadero '+Math.round(botaM3).toLocaleString('es-CO')+' m³' });
  }
  if(aproViajes>0){
    rows.unshift({ id_registro:TM2Offline.uuid(), grupo:'TIERRAS', capitulo:'EXPLANACIONES', actividad:exc.actividad, descripcion:exc.item,
      centro_costo: proyO?(proyO+'.'+exc.cc):'', unidad:'m3', uf:ufO, proyecto:proyO,
      elemento:buildElemento(origenPk,''), pk_inicial:origenPk, pk_final:'',
      abs_inicial:pkToMeters(origenPk), abs_final:null, liberacion:'CAMPO', largo:aproM3,
      _acumOrigen:true, origen:origenLabel, equipos:[], data:true,
      observacion: origenLabel+' · '+aproViajes+' viajes · → '+destTxt(destOrden.filter(t=>t!=='Botadero'))+' m³' });
  }
  return rows;
}
// Desglose por placa para la hoja VOLQUETAS (no altera el flujo a BANDEJA).
function getVolquetas(){
  const origen=document.getElementById('origen').value;
  if(!origen) return [];
  const exc=ORIGENES[origen];
  const origenLabel=(origen==='Complementario'||origen==='Otro')?(document.getElementById('origenTexto').value.trim()||exc.label):exc.label;
  const out=[];
  document.querySelectorAll('#lineasContainer .linea').forEach(b=>{
    const pk=b.querySelector('.l-pk').value.trim();
    const tipo=b.querySelector('.l-tipo').value;
    const placas=parseBloque(b.querySelector('.l-bloque').value).filter(p=>p.ok).map(p=>({placa:p.placa, viajes:p.viajes}));
    if(!pk || !placas.length) return;
    const uf=ufFromPk(pk);
    const lineId=Number(b.id.split('_')[1]); // misma correlación que getCantidades para el backend (D53)
    // D82: un id_registro de cliente por línea de PK destino (las placas de la línea comparten id en VOLQUETAS)
    out.push({ id_registro:TM2Offline.uuid(), origen:origenLabel, destino:pk, tipo_destino:tipo, uf:uf, placas:placas, _linea:lineId });
  });
  return out;
}
function validate(){
  let ok=true;
  document.querySelectorAll('.field-error').forEach(e=>e.classList.remove('field-error'));
  const fecha=document.getElementById('fecha'), origen=document.getElementById('origen');
  if(!fecha.value){ fecha.classList.add('field-error'); ok=false; }
  if(!origen.value){ origen.classList.add('field-error'); ok=false; }
  // Problema 2.12: para Complementario/Otro el PK del origen es el que se teclea; debe ser un PK válido
  // (de ahí salen ELEMENTO/ABS/UF de la excavación acumulada).
  if(origen.value==='Complementario'||origen.value==='Otro'){
    const ot=document.getElementById('origenTexto');
    if(pkToMeters(ot.value)==null){ ot.classList.add('field-error'); ok=false; }
  }
  document.querySelectorAll('#lineasContainer .linea').forEach(b=>{
    const pk=b.querySelector('.l-pk'), bloque=b.querySelector('.l-bloque');
    if(!pk.value.trim()){ pk.classList.add('field-error'); ok=false; }
    if(!lineaViajes(b)){ bloque.classList.add('field-error'); ok=false; }
  });
  // V3-06(b)/D177: la maquinaria es SOLO códigos (opcional). Ya no hay operador ni horas que validar
  // (esas validaciones —operador obligatorio, horas>0, motivo con horas muertas— desaparecen: los datos
  // los da el Parte Digital). Un código fuera del catálogo se manda igual (D138); nada que rechazar aquí.
  if(getCantidades().length===0){ if(ok) alert('Agrega al menos un PK con placas válidas y elige el origen.'); return false; }
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
  const btn=document.getElementById('btnSubmit');
  btn.textContent='ENVIANDO...'; btn.disabled=true;
  // D82: id_registro por fila generados EN EL CLIENTE (dedupe de reenvíos en Codigo.gs)
  const data={ fecha:document.getElementById('fecha').value, rol:'chequeadora',
    capataz: localStorage.getItem('usuario')||'chequeadora', m3viaje:m3viaje(),
    cantidades:getCantidades(), volquetas:getVolquetas(), maquinaria:getMaquinaria() };
  // D82: intento directo con timeout ~15 s; si no hay red / no responde, va a la cola local
  const r=await TM2Offline.enviarConCola({ tipo:'reporte', url:APPS_SCRIPT_URL, payload:data, fecha_obra:data.fecha, usuario:data.capataz });
  if(r.enviado){
    const res=r.res;
    if(!res || !res.ok){
      alert('⚠ No se pudo guardar: '+((res&&res.error)||'Respuesta inesperada del servidor')+'\n\nIntenta de nuevo.');
    } else {
      exito=true;
      mostrarExito('servidor','Se registraron '+res.cantidades+' filas (excavación + terraplén)'+(res.volquetas!=null?(' y '+res.volquetas+' placas'):'')+(res.maquinas?(' y '+res.maquinas+' máquina(s)'):'')+'.');
    }
  } else {
    exito=true;
    mostrarExito('cola','Tus viajes del '+data.fecha+' quedaron guardados en este teléfono y subirán automático. Puedes ver los pendientes en el contador de arriba.');
  }
  if(!exito){ btn.textContent='ENVIAR VIAJES DEL DÍA →'; btn.disabled=false; }
  else{ btn.textContent=r.enviado?'✓ ENVIADO':'📥 EN COLA'; btn.disabled=true; }
  enviando=false;
}
function resetForm(){
  document.getElementById('lineasContainer').innerHTML='';
  SEL=[]; renderChips();                                   // V3-06(b): limpia las excavadoras elegidas
  const pk=document.getElementById('eqpick'); if(pk){ pk.classList.remove('abierto'); pk.innerHTML=''; }
  const eb=document.getElementById('eqbtn'); if(eb) eb.textContent='+ Excavadora';
  lineaIdx=0;
  document.getElementById('successScreen').classList.remove('visible');
  document.getElementById('formMain').classList.remove('hidden');
  document.getElementById('submitBar').classList.remove('hidden');
  document.getElementById('btnSubmit').textContent='ENVIAR VIAJES DEL DÍA →';
  document.getElementById('btnSubmit').disabled=false;
  document.getElementById('fecha').value=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
  addLinea();
}
