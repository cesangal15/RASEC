// D170: aplica los data-estilo del marcado ANTES de que corra la lógica de la pantalla (ver tema.js).
if(window.TM2Estilos) TM2Estilos.aplicar();
const APPS_SCRIPT_URL = GALCA_ENV.url.obra;          // entorno.js (D168): producción o prueba
// D84: `albert` y `ariel` salieron a UF3 (fuera de este sistema); dejaron de esperarse en la bandeja.
// D145: `albert` VUELVE a tierras (UF1/UF2) y se vuelve a esperar su reporte del día. `ariel` sigue
// fuera. Los días en que estuvo en UF3 no cambian: esto solo alimenta el aviso de "falta por reportar"
// de la fecha consultada, no toca nada de lo ya guardado.
const CAPATACES_ESPERADOS = ['angel','alejo','robinson','albert'];
// Flota viva para el chip "maquinaria sin reporte". D136: NH69, BL009, CS78B, NH404, NH420,
// CAT900, NH421, EXC001, EXC013 y EXC014 se devolvieron/entregaron (ago-2026) y salen del listado.
// D138: el chip "maquinaria sin reporte" se arma con la flota VIGENTE ese día (hoja MAQUINAS), que
// llega junto con la bandeja. Lo de abajo es solo el respaldo si el catálogo no responde.
// D137: CR020 y D150B salen — no estan en obra (confirmado por el dueno); eran codigos huerfanos
// que se listaban como faltantes aunque el capataz no podia reportarlos. CR08 entra al catalogo.
const MAQUINAS_RESPALDO = ['BL005','EXC015','FNG02','MO03','MO04','MO09','CR019','CR013','CR016','CR08','NH403','CR026','RT-02'];
const TIPO_RESPALDO = {'BL005':'BULLDOZER','EXC015':'EXCAVADORA','MO03':'MOTONIVELADORA','MO04':'MOTONIVELADORA','MO09':'MOTONIVELADORA','FNG02':'FINISHER','CR019':'VIBROCOMPACTADOR','CR013':'VIBROCOMPACTADOR','CR016':'VIBROCOMPACTADOR','CR08':'VIBROCOMPACTADOR','NH403':'VIBROCOMPACTADOR','CR026':'MINIBULDOZER','RT-02':'RETROEXCAVADORA'};
let TODAS_MAQUINAS = MAQUINAS_RESPALDO.slice();
// Categorías cuyo volumen es OFICIAL de la chequeadora; el conteo del capataz es solo control.
const CAT_CONTROL_CAPATAZ = ['Excavación aprovechable','Excavación préstamo','Excavación no aprovechable','Conformación / ZODME','Terraplén'];
const ACTIVIDADES = [
  {g:'Excavación', a:'Excavación aprovechable (masivo)', item:'Excavaciones en material común APROVECHABLE', uni:'m3', cc:'02.05'},
  {g:'Excavación', a:'Excavación no aprovechable', item:'Excavaciones en material común NO APROVECHABLE', uni:'m3', cc:'02.05'},
  {g:'Excavación', a:'Excavación de préstamo (Diviso)', item:'Excavación en material común de préstamos', uni:'m3', cc:'02.06'},
  {g:'Terraplén', a:'Núcleo de terraplén', item:'Terraplenes (solo conformación)', uni:'m3', cc:'02.07'},
  {g:'Terraplén', a:'Corona de terraplén', item:'Terraplenes (solo conformación)', uni:'m3', cc:'02.07'},
  // D113: terraplén por MATERIAL (mismo ítem 02.07, sin dividir en núcleo/corona). Esta lista es la de
  // "agregar línea" del panel — más corta que la del capataz, pero el residente también las necesita.
  {g:'Terraplén', a:'Terraplén con crudo de río', item:'Terraplenes (solo conformación)', uni:'m3', cc:'02.07'},
  {g:'Terraplén', a:'Terraplén de UF3', item:'Terraplenes (solo conformación)', uni:'m3', cc:'02.07'},
  {g:'Terraplén', a:'Cereo de corona', item:'Terraplenes (solo conformación)', uni:'m3', cc:'02.07'},
  {g:'Conformación', a:'Conformación y disposición de sobrantes (ZODME)', item:'Conformación y disposición de sobrantes', uni:'m3', cc:'02.08'},
  {g:'Subbase', a:'Conformación de subbase', item:'Subbase Granular', uni:'m3', cc:'03.01'},
  {g:'Subbase', a:'Cereo de subbase', item:'Subbase Granular', uni:'m3', cc:'03.01'},
  {g:'Base', a:'Base estabilizada con cemento (BTC)', item:'Base granular estabilizada con cemento', uni:'m3', cc:'03.03'},
  {g:'Estructuras / MSR', a:'Relleno para muros de tierra MSR', item:'Relleno para muros de tierra MSR', uni:'M3', cc:'05.04'},
  {g:'Estructuras / MSR', a:'Geomalla uniaxial 115 kn/m', item:'Geomalla tejida uniaxial de 115 kn/m (método md)', uni:'M2', cc:'05.07'},
  {g:'Estructuras / MSR', a:'Geotextil tejido 2890 n', item:'Geotextil tejido uniaxial de 2890 n (método grab md)', uni:'M2', cc:'05.09'},
];
const ACT_IDX={}; ACTIVIDADES.forEach(x=>ACT_IDX[x.a]=x);

let STATE = { fecha:'', cantidades:[], maquinas:[], observaciones:[], clima:'', dirty:false, envioError:'', envioN:null };

/* ===================== D110 — CLARIDAD DEL ENVÍO A DATA =====================
 * El problema real (reportado en obra): el residente revisa la bandeja, pulsa "Enviar a DATA" y cierra
 * de una vez. El único acuse era un "enviado ✓" que se apagaba a los 3 s, así que no quedaba forma de
 * saber si el día llegó al maestro — ni de notar las filas que el capataz/chequeadora mandaron DESPUÉS
 * del envío. El reporte del capataz y la asistencia sí tienen confirmación explícita; este panel no.
 *
 * Se replica ese lenguaje, con la particularidad de que aquí el estado NO es solo de esta sesión:
 * la verdad la tiene el servidor. `enviar_data` marca en BANDEJA 'incluido'/'descartado' las filas que
 * ya pasaron por un envío y deja 'pendiente' las que no, así que al consultar se reconstruye si el día
 * ya se envió aunque se abra el panel en otro teléfono. Lo único local es la HORA del último envío
 * (BANDEJA no la guarda). Cuatro estados: vacío · sin enviar · enviado · cambios sin enviar. */
let enviando=false;                             // candado anti doble envío (el botón queda deshabilitado)
const ENVIO_KEY='tm2_envio_tierras_';           // + fecha  →  {ts, n}
function envioLocal(fecha){ try{ return JSON.parse(localStorage.getItem(ENVIO_KEY+fecha)||'null'); }catch(e){ return null; } }
function guardarEnvioLocal(fecha,n){ try{ localStorage.setItem(ENVIO_KEY+fecha, JSON.stringify({ts:new Date().toISOString(), n:n})); }catch(e){} }
function hoyBogota(){ return new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'}); }
// "hoy 15:32" / "29/07 15:32" — la hora del envío en la zona de la obra (UTC−5), nunca en UTC.
function cuandoTxt(iso){
  if(!iso) return '';
  const d=new Date(iso); if(isNaN(d.getTime())) return '';
  const dia=d.toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
  const hora=d.toLocaleTimeString('es-CO',{timeZone:'America/Bogota',hour:'2-digit',minute:'2-digit',hour12:false});
  return (dia===hoyBogota()?'hoy':dia.slice(8,10)+'/'+dia.slice(5,7))+' '+hora;
}
/* Estado del envío del día que hay en pantalla.
 *   vacio · sin (ninguna fila ha pasado por un envío) · pend (se envió, pero hay filas nuevas o
 *   ediciones sin enviar) · ok (lo de DATA es exactamente lo que se ve) · err (el último intento falló) */
function envioStat(){
  const rows=STATE.cantidades;
  const inc=rows.filter(c=>c._inc).length;
  const nuevas=rows.filter(c=>!c._enviada).length;
  if(STATE.envioError) return {k:'err', nuevas:nuevas, inc:inc};
  if(!rows.length) return {k:'vacio', nuevas:0, inc:0};
  if(nuevas===rows.length) return {k:'sin', nuevas:nuevas, inc:inc};
  if(nuevas>0 || STATE.dirty) return {k:'pend', nuevas:nuevas, inc:inc};
  return {k:'ok', nuevas:0, inc:inc};
}
function renderEnvio(){
  const st=envioStat(), loc=envioLocal(STATE.fecha), cuando=cuandoTxt(loc&&loc.ts);
  if(st.k==='vacio') return '';
  if(st.k==='err'){
    return '<div class="envio-estado err"><span class="ico">⚠️</span><span><b>NO se pudo enviar a DATA</b> — '+esc(STATE.envioError)
      +'<span class="sub">El día '+esc(STATE.fecha)+' puede haber quedado sin actualizar en el maestro. Revisa la señal y vuelve a enviar: reenviar no duplica nada (el envío reemplaza el día).</span></span></div>';
  }
  if(st.k==='sin'){
    return '<div class="envio-estado sin"><span class="ico">📤</span><span><b>Sin enviar a DATA</b> — '+st.inc+' fila(s) incluidas de '+STATE.cantidades.length
      +'<span class="sub">Nada de este día ha llegado al Excel maestro todavía. Revisa la bandeja y pulsa «Enviar a DATA» abajo.</span></span></div>';
  }
  if(st.k==='pend'){
    const det=[];
    if(st.nuevas) det.push(st.nuevas+' fila(s) nuevas del capataz/chequeadora llegaron después del envío');
    if(STATE.dirty) det.push('hay cambios hechos en el panel sin enviar');
    return '<div class="envio-estado pend"><span class="ico">⚠️</span><span><b>Cambios sin enviar</b>'+(cuando?' — último envío '+cuando:'')
      +'<span class="sub">'+(det.join(' y ')||'lo que ves no es lo que está en DATA')+'. Vuelve a pulsar «Enviar a DATA» para que el maestro quede igual a lo que ves.</span></span></div>';
  }
  const n=(STATE.envioN!=null?STATE.envioN:(loc&&loc.n));
  return '<div class="envio-estado ok"><span class="ico">✅</span><span><b>Enviado a DATA</b> — '+esc(STATE.fecha)+(n!=null?' · '+n+' fila(s)':'')
    +'<span class="sub">'+(cuando?'Último envío: '+cuando+'. ':'Enviado desde este u otro dispositivo. ')
    +'Ya puedes generar el WhatsApp. Si cambias algo, vuelve a enviar.</span></span></div>';
}
function textoBotonEnviar(){
  const k=envioStat().k;
  if(k==='ok')   return '✓ Enviado — reenviar a DATA';
  if(k==='pend') return '📤 Enviar cambios a DATA';
  return '📤 Enviar a DATA';
}
/* D130 — el clima es OBLIGATORIO para enviar a DATA. Deja de ser un dato "bonito" del WhatsApp:
 * el maestro lo necesita (se estampa en la OBSERVACION del día y una tabla del Excel lo lee), así que
 * un día enviado sin clima deja esa tabla sin dato y hay que rehacer el envío. Se avisa ANTES de bajar
 * hasta el botón (el selector de clima está debajo de las acciones) y el envío se bloquea. */
function faltaClima(){ return !STATE.clima && STATE.cantidades.length>0; }
function renderAvisoClima(){
  if(!faltaClima()) return '';
  return '<div class="envio-estado pend"><span class="ico">🌦️</span><span><b>Falta el clima del día</b>'
    +'<span class="sub">Sin clima no se puede enviar a DATA: el maestro lo lee de la observación del día. '
    +'Elígelo en «Clima del día», más abajo.</span></span></div>';
}
function refreshEnvio(){
  ['envioBoxTop','envioBoxBottom'].forEach(id=>{ const el=document.getElementById(id); if(el) el.innerHTML=renderEnvio(); });
  ['climaAvisoTop','climaAvisoBottom'].forEach(id=>{ const el=document.getElementById(id); if(el) el.innerHTML=renderAvisoClima(); });
  const b=document.getElementById('btnEnviar'); if(b && !enviando) b.textContent=textoBotonEnviar();
}
// Toda edición del panel que cambia lo que iría a DATA pasa por aquí: el estado deja de decir "enviado".
function marcarCambio(){ STATE.dirty=true; STATE.envioError=''; }
/* Cierre accidental: si el día tiene algo sin enviar, el navegador pide confirmación antes de cerrar
 * o navegar. Solo cuando hay algo REAL que perder — consultar un día viejo sin tocar nada no molesta. */
window.addEventListener('beforeunload', function(ev){
  const st=envioStat();
  const enRiesgo = STATE.dirty || st.k==='pend' || (st.k==='sin' && STATE.fecha===hoyBogota());
  if(st.k==='vacio' || !enRiesgo) return;
  ev.preventDefault(); ev.returnValue=''; return '';
});

/* D37 (enmendada por D130): clima del día que elige el encargado. Se sella en DATA (columna interna,
 * no viaja al maestro) para el resumen del jefe, se añade al WhatsApp y —desde D130— también se estampa
 * en la OBSERVACION (col S) de la primera fila del día para que el Excel maestro lo lea al pegar.
 *
 * D130 — SOLO TRES ESTADOS. La lista original tenía seis (Parcialmente nublado · Nublado · Lluvia
 * ligera/intermitente/fuerte) y el maestro no distingue esos matices: la tabla que lo consume clasifica
 * el día en soleado / lluvias / lluvias parciales y nada más. Seis opciones para tres destinos solo
 * producen días equivalentes escritos distinto. Los valores viejos que ya están en DATA NO se tocan
 * (el jefe los sigue mostrando verbatim); lo que cambia es lo que se puede elegir de aquí en adelante.
 * OJO: estos strings viajan a DATA y los lee una tabla del Excel — cambiarlos rompe ese cruce. */
const CLIMA_OPS=['','Soleado','Lluvias','Lluvias parciales'];
function setClima(v){ STATE.clima=v||''; marcarCambio(); refreshEnvio(); }

window.onload = function(){
  const rol=localStorage.getItem('rol'), usuario=localStorage.getItem('usuario');
  if(!rol || (rol!=='encargado' && rol!=='admin' && rol!=='residente')){ window.location.href='index.html'; return; }
  document.getElementById('userDisplay').textContent=usuario||'encargado';
  if(rol==='admin'){var _bm=document.getElementById('btnMenu');if(_bm)_bm.style.display='inline-block';}
  document.getElementById('fecha').value=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
};
function logout(){ localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token'); window.location.href='index.html'; }
function pkToMeters(pk){ if(!pk) return null; pk=String(pk).toLowerCase().replace(/pk/g,'').trim().replace(/\s/g,''); if(pk.includes('+')){const p=pk.split('+');const km=parseInt(p[0]);const m=parseInt(p[1]||'0');if(isNaN(km))return null;return km*1000+(isNaN(m)?0:m);} const n=parseFloat(pk);return isNaN(n)?null:n*1000; }
function ufFromPk(pk){ const m=pkToMeters(pk); if(m==null) return ''; return m<=30000?'UF1':'UF2'; }
// ELEMENTO unificado (Problema 2.12): "tm2 pk NN+NNN"; normaliza el PK y no duplica el token "pk".
function pkNorm(s){ const m=pkToMeters(s); if(m==null) return ''; const km=Math.floor(m/1000), r=Math.round(m-km*1000); return km+'+'+('00'+r).slice(-3); }
function buildElemento(pki,pkf){
  let ini=pki, fin=pkf;
  if((fin==null||fin==='') && pki!=null){ const p=String(pki).split(/\s*-\s*/); if(p.length>=2){ ini=p[0]; fin=p.slice(1).join(' - '); } }
  const a=pkNorm(ini); if(!a) return '';
  const b=pkNorm(fin); return b? ('tm2 pk '+a+' - '+b) : ('tm2 pk '+a);
}

/* ===================== D104 — SUBTRAMO: resolución visible + corrección del residente =====================
 * El jefe trabaja con SUBTRAMOS (los liberados). Hasta D104 el residente no veía a qué subtramo iba a
 * caer una línea hasta encontrarla en DATA: ese era el hueco. Aquí se muestra la resolución bajo cada
 * línea y se deja corregirla antes de enviar.
 * La resolución de abajo es un ESPEJO EXACTO del cruce del backend (`lookupElemento` en Codigo.gs):
 * mismo ancla por punto medio, mismo intervalo semiabierto y misma tolerancia. Si uno de los dos
 * cambia, el otro tiene que cambiar igual — si no, el residente vería un subtramo y DATA recibiría
 * otro. Los subtramos los sirve `?action=tramos` (las pantallas son estáticas y no leen el Sheet). */
const BASE_TOL_M = 30;      // espejo de BASE_TOL_M en Codigo.gs (ajuste por PK cercano, error humano)
// Umbral del aviso "revisar subtramo" cuando el ancla cae cerca de un borde. PARÁMETRO ABIERTO:
// 50 m es el default de arranque; se confirma con el residente tras verlo con reportes reales.
const SUBTRAMO_BORDE_M = 50;
let TRAMOS=[], TRAMO_IDX={};
function normTramo(s){ return String(s==null?'':s).replace(/[   ​‌‍﻿]/g,' ').toUpperCase().replace(/\s+/g,' ').trim(); }
/* D138 — flota ESPERADA el día que se está revisando, desde la hoja MAQUINAS. Va en paralelo con la
 * bandeja porque depende de la fecha: una máquina devuelta no debe salir como "sin reporte" en días
 * en que ya no estaba, ni una recién llegada en días anteriores a su ingreso. Si el catálogo falla,
 * se queda con el respaldo y el panel funciona igual. Solo se listan las ESPERADAS: el finisher y su
 * vibro, que van y vienen, no ensucian el chip los días que no están en obra. */
async function loadFlota(fecha){
  const fl=await TM2Flota.cargar(APPS_SCRIPT_URL, fecha, {ids:MAQUINAS_RESPALDO, tipos:TIPO_RESPALDO, prog:{}});
  const esperadas=fl.maquinas.filter(m=>m.esperada!==false);
  if(esperadas.length) TODAS_MAQUINAS=TM2Flota.ids(esperadas);
}
async function loadTramos(){
  if(TRAMOS.length) return;                                  // catálogo estable: se pide una sola vez
  try{
    const r=await fetch(`${APPS_SCRIPT_URL}?action=tramos`);
    const d=await r.json();
    TRAMOS=(d.tramos||[]).filter(t=>t.abs_inicio!=null && t.abs_fin!=null);
    TRAMO_IDX={}; TRAMOS.forEach(t=>{ TRAMO_IDX[normTramo(t.elemento)]=t; });
  }catch(err){ TRAMOS=[]; TRAMO_IDX={}; }                    // sin catálogo: no se muestra el bloque
}
// ¿La línea resuelve al conjunto TRAMO? Espejo de baseSetFor(): préstamo (02.06), estructuras/MSR
// (05.*, 02.12) y conformación (02.08, que además manda el destino del residente, D79) NO son
// subtramos — son marcadores puntuales y quedan fuera del selector.
function esLineaTramo(c){
  if(!c || c._nodata) return false;
  const cc=(String(c.centro_costo||'').match(/(\d{2}\.\d{2})\s*$/)||[])[1]||'';
  if(cc==='02.06' || cc==='02.08' || cc==='02.12' || cc.indexOf('05.')===0) return false;
  return true;
}
// Ancla del cruce (espejo de anclaCruce en Codigo.gs): con rango válido y dos PK distintos, el PUNTO
// MEDIO (ordenado, para tolerar rangos invertidos); con un solo PK, ese.
function anclaDe(c){
  const a=pkToMeters(c.pk_inicial), b=pkToMeters(c.pk_final);
  if(a!=null && b!=null && a!==b) return (Math.min(a,b)+Math.max(a,b))/2;
  return (a!=null) ? a : b;
}
// Espejo del cruce por abscisa: semiabierto [ini,fin), cerrado en el último tramo del eje, desempate
// por rango más angosto y ajuste por cercanía dentro de la tolerancia. null = PK fuera de todo tramo.
function resolverSubtramo(c){
  if(!TRAMOS.length || !esLineaTramo(c)) return null;
  const pk=anclaDe(c);
  if(pk==null) return null;
  let finMax=null; TRAMOS.forEach(t=>{ if(finMax==null || t.abs_fin>finMax) finMax=t.abs_fin; });
  const hits=TRAMOS.filter(t=>{
    if(pk<t.abs_inicio) return false;
    const cerrado=(t.abs_fin===finMax)||(t.abs_fin===t.abs_inicio);
    return cerrado ? (pk<=t.abs_fin) : (pk<t.abs_fin);
  });
  if(hits.length){ hits.sort((a,b)=>(a.abs_fin-a.abs_inicio)-(b.abs_fin-b.abs_inicio)); return hits[0]; }
  let best=null,bd=Infinity;
  TRAMOS.forEach(t=>{ const d = pk<t.abs_inicio ? (t.abs_inicio-pk) : (pk-t.abs_fin); if(d<bd){ bd=d; best=t; } });
  return (best && bd<=BASE_TOL_M) ? best : null;
}
// Subtramo efectivo de la línea: el forzado por el residente si lo hay, si no el automático.
function subtramoDe(c){
  if(c && c.elemento_forzado){ const t=TRAMO_IDX[normTramo(c.elemento_forzado)]; if(t) return t; }
  return resolverSubtramo(c);
}
/* Aviso ⚠ "revisar subtramo" SOLO en dos casos objetivos — el 90% de las líneas están bien y meterles
 * fricción haría que el residente deje de mirar los avisos que sí importan:
 *   (a) el ancla cae a menos de SUBTRAMO_BORDE_M de un borde de subtramo (zona donde un typo de
 *       decenas de metros cambia el subtramo);
 *   (b) el rango reportado cruza DOS O MÁS subtramos — el caso más peligroso, porque hoy colapsa a
 *       uno solo en silencio.
 * Devuelve '' si no hay nada que avisar. */
function avisoSubtramo(c){
  const t=resolverSubtramo(c);
  const avisos=[];
  const a=pkToMeters(c.pk_inicial), b=pkToMeters(c.pk_final);
  if(a!=null && b!=null && a!==b){
    const lo=Math.min(a,b), hi=Math.max(a,b);
    const cruza=TRAMOS.filter(x=> x.abs_inicio<hi && x.abs_fin>lo );
    if(cruza.length>=2) avisos.push(`el rango cruza ${cruza.length} subtramos (${cruza.map(x=>x.pk).join(' · ')}) y se está cargando todo a uno solo`);
  }
  if(t){
    const pk=anclaDe(c);
    const d=Math.min(Math.abs(pk-t.abs_inicio), Math.abs(pk-t.abs_fin));
    if(d<SUBTRAMO_BORDE_M) avisos.push(`el punto de cruce queda a ${Math.round(d)} m del borde del subtramo`);
  }
  return avisos.length ? ('⚠ Revisar subtramo: '+avisos.join(' · ')) : '';
}
/* Fija el subtramo de una línea. Espejo del override del backend (`elemento_forzado`, D104):
 *  · elegir el automático -> se BORRA el campo (la línea viaja sin él y el backend resuelve solo).
 *  · elegir otro -> se guarda el ELEMENTO verbatim y se re-derivan UF/proyecto/CC desde el ABS INICIO
 *    de ese subtramo (D04/D63b), para que el badge, los totales y el WhatsApp queden coherentes con
 *    lo que va a escribir DATA. Mismo comportamiento que setDestinoConf (D79).
 *    En la práctica UF/proyecto/CC solo cambian si la corrección cruza el límite 30+000. */
function aplicarUbicacion(c, metros){
  if(metros==null) return;
  c.uf = metros<=30000 ? 'UF1' : 'UF2';
  c.proyecto = c.uf==='UF1' ? '3701' : '3702';
  const cod=(String(c.centro_costo||'').match(/(\d{2}\.\d{2})\s*$/)||[])[1]||'';
  if(cod) c.centro_costo = c.proyecto+'.'+cod;
}
function setSubtramoObj(c, elemento){
  const auto=resolverSubtramo(c);
  if(!elemento || (auto && normTramo(elemento)===normTramo(auto.elemento))){
    delete c.elemento_forzado;
    aplicarUbicacion(c, pkToMeters(c.pk_inicial));   // vuelve a D04 sobre el PK, como el automático
    return;
  }
  const t=TRAMO_IDX[normTramo(elemento)];
  if(!t){ delete c.elemento_forzado; return; }       // nunca se inventa un subtramo
  c.elemento_forzado=t.elemento;                     // string verbatim de la celda J de la BASE
  aplicarUbicacion(c, t.abs_inicio);
}
function setSubtramo(idx, elemento){
  const c=STATE.cantidades[idx];
  c._tramoOpen=true;                                  // al corregir, el selector queda a la vista
  setSubtramoObj(c, elemento);
  marcarCambio();
  render();
}
function toggleTramo(idx){ const c=STATE.cantidades[idx]; c._tramoOpen=!c._tramoOpen; render(); }
/* Opciones del selector (D104). SIN buscador propio, a propósito: la lista nativa YA trae búsqueda
 * por teclado (con el desplegable abierto, teclear "14" salta a los que empiezan por 14), así que la
 * cajita que había antes no aportaba nada y sí generaba dos problemas reportados por el usuario:
 * ocupaba media línea de pantalla y, al escribir con el desplegable CERRADO, sólo se veía el renglón
 * colapsado (parecía que "mostraba una sola opción"). Peor: al filtrar se reemplazaban las <option>,
 * y si la seleccionada desaparecía del filtro el navegador cambiaba el valor mostrado sin disparar
 * onchange — el renglón podía acabar enseñando un subtramo distinto del guardado.
 * Se conserva el grupo "Sugeridos" (anterior · automático · siguiente) porque el error típico es de
 * UN subtramo (la frontera), así que la corrección más común queda arriba sin tener que desplazarse.
 * `selected` se marca SOLO en la lista completa: si se marcara en ambos grupos el navegador tomaría
 * el último y el renglón colapsado mostraría una entrada distinta de la que se ve resaltada. */
function opcionesTramo(c, actual){
  const auto=resolverSubtramo(c);
  const i=auto ? TRAMOS.indexOf(auto) : -1;
  const val=t=>esc(t.elemento);
  let html='';
  const sug=[];
  if(i>0) sug.push({t:TRAMOS[i-1], lbl:'anterior'});
  if(auto) sug.push({t:auto, lbl:'automático'});
  if(i>=0 && i<TRAMOS.length-1) sug.push({t:TRAMOS[i+1], lbl:'siguiente'});
  if(sug.length){
    html+='<optgroup label="Sugeridos">';
    sug.forEach(s=>{ html+=`<option value="${val(s.t)}">${esc(s.t.pk)} · ${s.lbl}</option>`; });
    html+='</optgroup>';
  }
  html+='<optgroup label="Todos los subtramos">';
  html+=TRAMOS.map(t=>`<option value="${val(t)}" ${normTramo(t.elemento)===normTramo(actual)?'selected':''}>${esc(t.pk)}</option>`).join('');
  html+='</optgroup>';
  return html;
}
/* Bloque bajo la línea (D104). COMPACTO por defecto: una sola línea de texto con la resolución, que
 * es lo que de verdad hacía falta ver (a qué subtramo va a caer la línea antes de que llegue a DATA).
 * El SELECTOR está plegado, porque corregir el subtramo es la excepción, no la norma — tenerlo
 * desplegado en todas las líneas saturaba la pantalla sin necesidad. Se despliega solo cuando:
 *   · el residente toca "cambiar";
 *   · hay un aviso ⚠ (ahí sí conviene tenerlo a mano); o
 *   · la línea ya está corregida (para poder revertirla de un toque). */
function renderTramo(c, idx){
  if(!esLineaTramo(c) || !TRAMOS.length) return '';
  const t=subtramoDe(c);
  const pk=pkNorm(c.pk_inicial)+(c.pk_final?(' - '+pkNorm(c.pk_final)):'');
  const forzado=!!c.elemento_forzado;
  const destino = t
    ? `<span class="${forzado?'forz':'res'}">${esc(t.elemento)}</span>${forzado?' <span class="auto">(corregido)</span>':''}`
    : `<span class="forz">sin subtramo — el PK queda fuera del eje (irá como REVISAR)</span>`;
  const aviso=avisoSubtramo(c);
  const abierto = c._tramoOpen || !!aviso || forzado;
  const picker = abierto
    ? `<div class="tramo-pick"><select class="tramo-sel${forzado?' forzado':''}" data-on-change="setSubtramo(${idx},this.value)">
        ${opcionesTramo(c,(t||{}).elemento||'')}
      </select>${forzado?`<button class="tramo-link" data-on-click="setSubtramo(${idx},'')">volver al automático</button>`:''}</div>`
    : '';
  const link = (abierto||aviso) ? '' : `<button class="tramo-link" data-on-click="toggleTramo(${idx})">cambiar</button>`;
  return `<div class="li-tramo">PK ${esc(pk)||'—'} → ${destino}${link}
    ${aviso?`<span class="tramo-warn">${esc(aviso)}</span>`:''}${picker}</div>`;
}

async function consultar(){
  const fecha=document.getElementById('fecha').value, proyecto=document.getElementById('proyecto').value;
  if(!fecha){ alert('Selecciona una fecha'); return; }
  document.getElementById('resultados').innerHTML='<div class="loading">⏳ Cargando bandeja...</div>';
  try{
    // &area=tierras (D70): este panel es SOLO tierras; las filas de drenajes (ODT/ODL) las ven
    // sus residentes en residente-drenajes.html y no deben aparecer (ni enviarse) desde aquí.
    let url=`${APPS_SCRIPT_URL}?action=bandeja&fecha=${fecha}&area=tierras`;
    if(proyecto) url+=`&proyecto=${encodeURIComponent(proyecto)}`;
    // D104: el catálogo de subtramos (?action=tramos) se pide en paralelo con la bandeja; es estable,
    // así que solo se descarga la primera consulta. Si falla, el panel funciona igual y el bloque de
    // subtramo simplemente no se muestra (el backend sigue resolviendo solo).
    const [resp] = await Promise.all([fetch(url), loadTramos(), loadFlota(fecha)]);
    const data=await resp.json();
    STATE.fecha=fecha;
    // D110: `_enviada` = la fila YA pasó por un envío a DATA. Lo dice el servidor: enviar_data deja en
    // BANDEJA 'incluido'/'descartado' todo lo que envió y las que llegan después nacen 'pendiente'.
    STATE.cantidades=(data.cantidades||[]).map(c=>({...c, largo:parseFloat(c.largo)||0, _inc:(c.estado!=='descartado'&&c.estado!=='no_data'), _nodata:(c.estado==='no_data'),
      _enviada:(c.estado==='incluido'||c.estado==='descartado')}));
    STATE.dirty=false; STATE.envioError=''; STATE.envioN=null;   // el estado del envío se recalcula por fecha
    // D79: la conformación (02.08) se ancla al DESTINO que elige el residente, no al PK del origen:
    // RCD → 3701/UF1 (RCD 15+800) · ZODME → 3702/UF2 (ZODME PK30). Default RCD (lo que ya hacía el
    // sistema); se normaliza uf/proyecto de una vez para que el badge y el envío coincidan.
    STATE.cantidades.forEach(c=>{ if(!c._nodata && categoria(c)==='Conformación / ZODME') setDestinoConfObj(c, c.destino_conf||'RCD'); });
    STATE.maquinas=data.maquinas||[];
    STATE.observaciones=data.observaciones||[];
    autoReconcile();
    render();
  }catch(err){
    document.getElementById('resultados').innerHTML=`<div class="empty-state"><div class="icon">⚠️</div><p>No se pudo consultar. Revisa el Apps Script o la conexión.</p></div>`;
  }
}

// Categoría de una línea (agrupa totales, bandeja y WhatsApp). D80: primero por CC (más confiable)
// y después por palabras clave; el DEFAULT deja de ser "Estructuras / MSR" — lo que no calza en
// ninguna categoría (paisajeo, adecuación de caminos, derrumbe…) cae a "Otras actividades" en vez
// de colarse entre las estructuras. La sección de pavimentos se titula "Riego de imprimación"
// (es la única actividad de pavimentos en alcance, D71 — "Pavimentos" a secas decía menos).
function categoria(c){
  const d=(c.descripcion||c.actividad||'').toUpperCase();
  const cc=(String(c.centro_costo||'').match(/(\d{2}\.\d{2})\s*$/)||[])[1]||'';
  if(cc.indexOf('04.')===0 || d.includes('IMPRIMACI')) return 'Riego de imprimación';
  if(cc.indexOf('05.')===0) return 'Estructuras / MSR';
  if(d.includes('NO APRO')) return 'Excavación no aprovechable';
  if(d.includes('PRESTAMO')||d.includes('PRÉSTAMO')) return 'Excavación préstamo';
  if(d.includes('APROVEC')) return 'Excavación aprovechable';
  if(d.includes('SOBRANTE')||d.includes('ZODME')) return 'Conformación / ZODME';
  if(d.includes('TERRAPL')||d.includes('PEDRAPL')||d.includes('CORONA')) return 'Terraplén';
  if(d.includes('SUBBASE')) return 'Subbase';
  if(d.includes('BASE GRANULAR')||d.includes('BTC')) return 'Base / BTC';
  if(d.includes('DESMONTE')||d.includes('DESCAPOTE')) return 'Desmonte y limpieza';
  if(d.includes('MSR')||d.includes('GEOMALLA')||d.includes('GEOTEXTIL')||d.includes('GEOBOLSA')||d.includes('GEODREN')||d.includes('GEODRÉN')) return 'Estructuras / MSR';
  return 'Otras actividades';
}
const ORDEN_CAT=['Excavación aprovechable','Excavación préstamo','Excavación no aprovechable','Conformación / ZODME','Terraplén','Subbase','Base / BTC','Riego de imprimación','Desmonte y limpieza','Estructuras / MSR','Otras actividades'];
/* D113 — TERRAPLÉN DE MATERIAL EXTERNO (crudo de río · UF3).
 * Son terraplén normal (ítem 02.07, categoría 'Terraplén' de este panel, y así salen a DATA), pero su
 * material NO viene de los bancos de corte propio: el crudo de río se compra y el de UF3 lo envía otra
 * unidad funcional. La chequeadora SOLO mide los viajes desde los bancos propios, así que estas dos
 * actividades no tienen contraparte "oficial" y se tratan aparte en las dos reglas del panel:
 *   · reconciliación automática — apagarlas porque la chequeadora reportó terraplén PERDERÍA volumen
 *     real (nadie más lo está contando), así que quedan fuera (también de la marca de duplicado, que
 *     es la misma sospecha por otro nombre);
 *   · validación "terraplén ≤ aprovechable + préstamo" — no suman en el lado del terraplén: dispararían
 *     la alerta roja sin que haya error, porque su material no salió de ninguna excavación.
 * Se reconocen por `actividad` (la columna que BANDEJA/DATA guardan verbatim). La comparación va sin
 * tildes y en mayúsculas para que no dependa de cómo se teclee el acento. */
function normAct(s){ return String(s==null?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase(); }
function esTerraplenExterno(c){
  const a=normAct(c.actividad);                       // 'Terraplén con crudo de río' | 'Terraplén de UF3'
  return /CRUDO DE RIO/.test(a) || /\bUF3\b/.test(a);
}
// Etiqueta corta del material, para el WhatsApp ('' = terraplén normal, sin etiqueta).
function tagMaterial(c){
  if(!esTerraplenExterno(c)) return '';
  return /CRUDO DE RIO/.test(normAct(c.actividad)) ? 'crudo de río' : 'UF3';
}
const SPLIT_UF=['Terraplén','Subbase','Base / BTC'];
function fmt(n){ return (Math.round(n*100)/100).toLocaleString('es-CO'); }

function calcTotales(){
  const t={};
  STATE.cantidades.forEach(c=>{ if(!c._inc) return;
    const cat=categoria(c), uf=c.uf||ufFromPk(c.pk_inicial);
    if(!t[cat]) t[cat]={total:0,uf1:0,uf2:0,ext:0,uni:c.unidad||''};
    t[cat].total+=c.largo; if(uf==='UF1') t[cat].uf1+=c.largo; else if(uf==='UF2') t[cat].uf2+=c.largo;
    // D113: parte del total que es material EXTERNO (crudo de río / UF3). El total de la pantalla lo
    // sigue incluyendo —es terraplén de verdad—; solo la validación de abajo lo descuenta.
    if(esTerraplenExterno(c)) t[cat].ext+=c.largo;
  });
  return t;
}
function srcClass(c){ return c.rol==='chequeadora'?'cheq':c.rol==='encargado'?'enc':'cap'; }

// Al cargar: si una categoría de volumen (excavación/terraplén) la reportó la chequeadora (oficial)
// Y también un capataz (control), apaga las filas del capataz por defecto y las marca como control.
// El encargado puede volver a prenderlas manualmente si hace falta.
// D58: la no aprovechable / ZODME nacidas de descapote/desmonte llevan el sello 'orig:descapote/desmonte'
// en su observación. El capataz es la única fuente de estos datos (la chequeadora no los maneja), así que
// NO deben apagarse por una no aprovechable de chequeadora de otro frente.
function esDerivadaDescapote(c){ return /orig:descapote\/desmonte/i.test(c.observacion||''); }
// Desglose de destinos del material excavado (D67): la chequeadora lo sella en la observación tras
// "→" (ej. "Masivo 2 · 36 viajes · → Terraplén 300 · Puente 150 m³"). Indicativo: explica a dónde se
// envió lo excavado (los m³ que no aparecen en terraplén fueron a puente/ODL/ODT o al botadero).
function destinosDe(c){ const m=/→\s*(.+)$/.exec(c.observacion||''); return m ? m[1].trim() : ''; }
/* D103 — nota MANUAL de una línea: lo que el capataz escribió en "Observación" de esa actividad.
 * La columna `observacion` de BANDEJA/DATA carga además sellos AUTOMÁTICOS que no son notas y que ya
 * tienen su lugar en el mensaje o en el panel, así que se descartan:
 *   · toda la observación de la chequeadora (es armada por el formulario: "Masivo 2 · 36 viajes · → …",
 *     D67; el destino ya sale compacto entre paréntesis por D80),
 *   · las filas ZODME automáticas ("Auto · secuencial a no aprovechable", D17/D58),
 *   · las filas selladas 'orig:descapote/desmonte' (D58): son la no aprovechable DERIVADA del
 *     descapote/desmonte y copian la nota de su fila madre, que ya la muestra — se evita el eco,
 *   · el tramo "→ destinos" de la observación.
 * Lo que queda es texto humano, y ese sí va al WhatsApp (paridad con la nota por actividad de drenajes). */
function notaManual(c){
  const obs=String(c.observacion||'').trim();
  if(!obs) return '';
  if(String(c.rol||'')==='chequeadora') return '';
  if(/^auto\s*·/i.test(obs)) return '';
  if(/orig:descapote\/desmonte/i.test(obs)) return '';
  // el desglose de destinos va SIEMPRE al final, tras "→": se corta desde ahí (D67/D80)
  return obs.split('→')[0].split('·').map(s=>s.trim())
    .filter(s=> !!s)
    .join(' · ');
}
/* Líneas "📝 nota" de un grupo de filas, con la sangría del bloque donde se insertan (WhatsApp). */
function notasTxt(lines, ind){
  let s='';
  lines.forEach(c=>{ const n=notaManual(c); if(n) s+=ind+'📝 '+n+'\n'; });
  return s;
}
// D80 (WhatsApp): destinos DISTINTOS de terraplén de una o varias líneas, sumados por tipo desde la
// observación sellada por la chequeadora (D67). Devuelve "Puente 126 · ODT 50 m³" o '' si todo fue a
// terraplén. Terraplén NO se menciona (es el destino normal y ya tiene su propia sección del mensaje);
// Botadero tampoco (ese material sale aparte como excavación no aprovechable, D67).
function destinosNoTerra(lines){
  const tot={}, orden=[];
  lines.forEach(c=>{
    const s=destinosDe(c); if(!s) return;
    s.replace(/\s*m³\s*$/,'').split('·').forEach(p=>{
      const m=/^\s*(.+?)\s+([\d.,]+)\s*$/.exec(p); if(!m) return;
      const tipo=m[1].trim();
      if(/terrapl|botadero/i.test(tipo)) return;
      const n=parseFloat(m[2].replace(/\./g,'').replace(/,/g,'.'))||0;   // "1.234" es-CO -> 1234
      if(tot[tipo]==null){ tot[tipo]=0; orden.push(tipo); }
      tot[tipo]+=n;
    });
  });
  if(!orden.length) return '';
  return orden.map(t=>`${t} ${fmt(tot[t])}`).join(' · ')+' m³';
}
function autoReconcile(){
  const rolesPorCat={};
  // D113: el terraplén de material externo (crudo de río / UF3) no entra — ver esTerraplenExterno.
  STATE.cantidades.forEach(c=>{ if(c._nodata || esDerivadaDescapote(c) || esTerraplenExterno(c)) return;
    const cat=categoria(c); (rolesPorCat[cat]=rolesPorCat[cat]||new Set()).add(c.rol);
  });
  STATE.cantidades.forEach(c=>{ if(c._nodata || esDerivadaDescapote(c) || esTerraplenExterno(c)) return;
    const cat=categoria(c);
    const hayCheq=(rolesPorCat[cat]||new Set()).has('chequeadora');
    if(c.rol==='capataz' && hayCheq && CAT_CONTROL_CAPATAZ.includes(cat)){
      c._control=true; c._inc=false;
    }
  });
}

// Detecta posible doble conteo: misma categoría con filas de chequeadora Y capataz.
// "hard" = además coincide el PK inicial exacto entre roles distintos.
function computeDups(){
  const catRoles={}, catIdx={};
  // D113: el terraplén de material externo tampoco se marca como posible duplicado — su volumen no lo
  // reporta nadie más (la chequeadora no mide esos viajes), así que la sospecha sería siempre falsa.
  STATE.cantidades.forEach((c,idx)=>{ if(c._nodata||!c._inc||esDerivadaDescapote(c)||esTerraplenExterno(c)) return;
    const cat=categoria(c);
    (catIdx[cat]=catIdx[cat]||[]).push(idx);
    (catRoles[cat]=catRoles[cat]||new Set()).add(c.rol);
  });
  const info={};
  STATE.cantidades.forEach((c,idx)=>{ if(c._nodata||!c._inc||esDerivadaDescapote(c)||esTerraplenExterno(c)) return;
    const cat=categoria(c), roles=catRoles[cat]||new Set();
    const crossRole = roles.has('chequeadora') && roles.has('capataz');
    if(!crossRole) return;
    const exact=(catIdx[cat]||[]).filter(j=>j!==idx
      && (STATE.cantidades[j].pk_inicial||'')===(c.pk_inicial||'')
      && STATE.cantidades[j].rol!==c.rol)
      .map(j=>`${STATE.cantidades[j].rol}·${STATE.cantidades[j].reporta}`);
    info[idx]={hard:exact.length>0, exact};
  });
  return info;
}
function numH(v){ const n=parseFloat(v); return isNaN(n)?0:n; }
// Agrupa la maquinaria del día por id_maquina (D51). El único discriminante de duplicado
// es `reporta`: un grupo con un solo capataz = reparto multi-actividad (D46), NO duplicado;
// con ≥2 capataces = conflicto a conciliar.
function maqGroups(){
  const g={}, order=[];
  STATE.maquinas.forEach((m,idx)=>{
    const k=(m.id_maquina||'').toUpperCase();
    if(!g[k]){ g[k]={key:k, id:m.id_maquina, rows:[]}; order.push(k); }
    g[k].rows.push({m, idx});
  });
  return order.map(k=>g[k]);
}
// Resumen de horas de un conjunto de filas (mismo capataz, misma máquina): operadas = suma del
// día; muertas = programadas − operadas (D46). prog/motivo se toman de la primera aparición.
// D171: la bandeja de equipos muestra SOLO el código (y su actividad/producción): horas, operador y
// motivo ya no los captura el capataz —salen del Parte Digital y se revisan en revision-maquinaria.html—
// así que las columnas de horas de MAQUINARIA llegan vacías (las filas viejas las traen, pero no se pintan).

function render(){
  const cont=document.getElementById('resultados');
  const repC=new Set(STATE.cantidades.map(c=>c.reporta).concat(STATE.maquinas.map(m=>m.reporta)).filter(Boolean));
  const faltC=CAPATACES_ESPERADOS.filter(c=>!repC.has(c));
  const repM=new Set(STATE.maquinas.map(m=>m.id_maquina));
  const faltM=TODAS_MAQUINAS.filter(m=>!repM.has(m));
  const tot=calcTotales();
  let html='';
  html+='<div id="envioBoxTop">'+renderEnvio()+'</div>';   // D110: estado del envío, lo primero que se ve
  html+='<div id="climaAvisoTop">'+renderAvisoClima()+'</div>';   // D130: clima obligatorio
  html+='<div class="pc-zona"><div class="pc-a">';   // D151: columna derecha (arriba)
  html+='<div class="section-title">Estado de reportes</div><div class="estado-grid">';
  html+='<div class="estado-box"><h3>Reportaron</h3><div class="chips">'+
    ([...repC].length? [...repC].map(c=>`<span class="chip ok">✓ ${esc(c)}</span>`).join(''):'<span class="chip">—</span>')+'</div>'+
    '<div class="mini-lbl">Capataces que faltan</div><div class="chips">'+
    (faltC.length? faltC.map(c=>`<span class="chip no">${esc(c)}</span>`).join(''):'<span class="chip ok">Todos</span>')+'</div></div>';
  html+='<div class="estado-box"><h3>Maquinaria sin reporte ('+faltM.length+')</h3><div class="chips">'+
    (faltM.length? faltM.map(m=>`<span class="chip no">${esc(m)}</span>`).join(''):'<span class="chip ok">Todas reportadas</span>')+'</div></div>';
  html+='</div>';

  html+='<div class="section-title">Totales del día (solo incluidos)</div><div class="totales">';
  let any=false;
  ORDEN_CAT.forEach(cat=>{ if(!tot[cat])return; any=true; const o=tot[cat];
    let split=''; if(SPLIT_UF.includes(cat)&&(o.uf1||o.uf2)) split=`<span class="uf-split"> · <span class="u1">UF1 ${fmt(o.uf1)}</span> · <span class="u2">UF2 ${fmt(o.uf2)}</span></span>`;
    html+=`<div class="tot-row"><span class="cat">${cat}${split}${notaExtTot(o)}</span><span class="val">${fmt(o.total)} ${esc(o.uni)}</span></div>`;
  });
  if(!any) html+='<div class="cat" data-estilo="color:var(--muted)">Sin cantidades incluidas</div>';
  html+='</div>';

  const obsConTexto=(STATE.observaciones||[]).filter(o=>o.observacion);
  html+='<div data-estilo="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:16px;">'
    +'<div data-estilo="display:flex;align-items:center;justify-content:space-between;cursor:pointer;" data-on-click="toggleObs()">'
    +'<span data-estilo="font-family:\'Syne\',sans-serif;font-size:11px;letter-spacing:2px;color:'+(obsConTexto.length?'var(--accent)':'var(--muted)')+';text-transform:uppercase;">Observaciones de capataces</span>'
    +'<button id="obsToggleBtn" data-estilo="background:none;border:1px solid var(--border);border-radius:6px;color:var(--muted);font-size:11px;padding:3px 10px;cursor:pointer;font-family:\'DM Sans\',sans-serif;pointer-events:none;">'+(obsConTexto.length?'▸ ver':'—')+'</button>'
    +'</div>'
    +'<div id="obsPanel" data-estilo="display:none;margin-top:10px;">';
  if(obsConTexto.length){
    obsConTexto.forEach(o=>{
      html+='<div data-estilo="background:var(--input-bg);border-left:3px solid var(--accent);border-radius:0 8px 8px 0;padding:8px 12px;margin-bottom:6px;">'
        +'<span data-estilo="font-size:10px;font-weight:600;color:var(--accent-txt);text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:3px;">'+esc(o.reporta||'?')+'</span>'
        +'<span data-estilo="font-size:13px;color:var(--text);line-height:1.5;">'+esc(o.observacion)+'</span></div>';
    });
  } else {
    html+='<p data-estilo="font-size:12px;color:var(--muted);padding:4px 0;">Sin observaciones del día.</p>';
  }
  html+='</div></div>';

  html+=renderChequeoTerraplen(tot);

  html+='</div><div class="pc-b">';   // D151: columna izquierda — lo que se scrollea
  html+='<div class="section-title">Bandeja del día <span data-estilo="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted);font-size:11px;">(prende/apaga para incluir en DATA)</span></div>';
  html+='<div id="bandejaBox">'+renderBandeja()+'</div>';
  html+=renderAddCard();

  html+='<div class="section-title">Maquinaria reportada ('+STATE.maquinas.length+')</div>'+renderMaquinas();

  html+='</div><div class="pc-c">';   // D151: pie a ancho completo
  html+='<div id="envioBoxBottom">'+renderEnvio()+'</div>';   // D110: el mismo estado, al pie, donde se pulsa
  html+='<div id="climaAvisoBottom">'+renderAvisoClima()+'</div>';   // D130: junto al botón que se bloquea
  html+='<div class="actions">'+
    '<button class="btn-action" data-on-click="irA(\'reporte-capataz.html\')">📋 Agregar actividad / maquinaria</button>'+
    '<button class="btn-action primary" id="btnEnviar" data-on-click="enviar()">'+textoBotonEnviar()+'</button>'+
    '<button class="btn-action" data-on-click="generarMensaje()">📲 Generar WhatsApp</button>'+
    '</div>';
  html+='</div><div class="pc-d">';   // D151: columna derecha (abajo) — clima y novedades
  html+='<div class="card" data-estilo="margin-top:16px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;">'+
    '<div class="section-title" data-estilo="margin-bottom:10px;">Clima del día <span data-estilo="color:var(--error-txt);">*</span></div>'+
    '<select id="clima" data-on-change="setClima(this.value)" data-estilo="width:100%;background:var(--input-bg);border:1px solid '+(STATE.clima?'var(--border)':'rgba(231,76,60,0.55)')+';border-radius:8px;color:var(--text);font-family:\'DM Sans\',sans-serif;font-size:13px;padding:10px 12px;outline:none;">'+
      CLIMA_OPS.map(o=>`<option value="${esc(o)}"${STATE.clima===o?' selected':''}>${o?esc(o):'— Elige el clima —'}</option>`).join('')+
    '</select>'+
    '<p data-estilo="font-size:11px;color:var(--muted);margin-top:6px;">Obligatorio para enviar a DATA. Va al WhatsApp, al resumen del jefe y a la observación del reporte, de donde lo lee el Excel maestro.</p>'+
    '</div>';
  html+='<div class="card" data-estilo="margin-top:16px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;">'+
    '<div class="section-title" data-estilo="margin-bottom:10px;">Equipos inoperativos / novedades</div>'+
    '<textarea id="inoperativos" placeholder="ej. Motoniveladora MO03: sin operador&#10;Minicargador: falla mecánica" data-estilo="width:100%;min-height:80px;background:var(--input-bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:\'DM Sans\',sans-serif;font-size:13px;padding:10px 12px;outline:none;resize:vertical;"></textarea>'+
    '</div>';
  html+='</div></div>';   // D151: cierra pc-d y pc-zona
  html+='<div class="msg-box" id="msgBox"></div>';
  cont.innerHTML=html;
}

// Regla: el material que va a terraplén proviene de excavación aprovechable (+ préstamo),
// así que el terraplén debe ser siempre ≤ aprovechable. Si lo excede, probable doble conteo o error.
// Texto del aviso si la regla se viola (''=coherente). D110 lo reusa para repetirlo en la confirmación
// del envío: el aviso rojo del panel se pierde de vista al bajar hasta los botones.
// D113: lo que ENTRA en la regla es el terraplén de material propio — ver terraValidable abajo.
/* D113 — el terraplén que ENTRA en la regla: el total de la categoría MENOS el material externo
 * (crudo de río / UF3), que no sale de ninguna excavación de la obra. Por eso el número del aviso
 * puede ser MENOR que el "Terraplén" de los totales de arriba: la diferencia es exactamente `ext`,
 * y el propio aviso lo dice para que no parezca un descuadre. */
function terraValidable(tot){
  const o=tot&&tot['Terraplén']; if(!o) return 0;
  return o.total-(o.ext||0);
}
function terraExterno(tot){ const o=tot&&tot['Terraplén']; return (o&&o.ext)||0; }
// Coletilla del TOTAL de la categoría: cuánto de ese número es material externo (D113). El total no
// cambia (es terraplén y así va a DATA); solo se dice de dónde salió una parte.
function notaExtTot(o){
  return (o && o.ext>0) ? `<span class="uf-split"> · <span data-estilo="color:var(--muted)">incl. ${fmt(o.ext)} de crudo de río / UF3</span></span>` : '';
}
function avisoTerraplen(tot){
  tot=tot||calcTotales();
  const terra=terraValidable(tot);
  const aprov=((tot['Excavación aprovechable']&&tot['Excavación aprovechable'].total)||0)
            +((tot['Excavación préstamo']&&tot['Excavación préstamo'].total)||0);
  if(terra<=0 || aprov<=0 || terra<=aprov) return '';
  return `Terraplén (${fmt(terra)}) supera al aprovechable+préstamo (${fmt(aprov)})`;
}
// Coletilla del aviso cuando parte del terraplén del día es material externo (siempre que lo haya,
// tanto en el ✓ como en el ⚠): explica por qué el número comparado no es el total de la pantalla.
function notaExternoTerraplen(tot){
  const ext=terraExterno(tot);
  if(ext<=0) return '';
  return `<div class="check-row" data-estilo="opacity:.85;font-size:12px;">↳ <span>No entran en la comparación ${fmt(ext)} m³ de terraplén con crudo de río / de UF3: ese material no sale de la excavación de la obra y la chequeadora no lo mide. El total de arriba sí los incluye.</span></div>`;
}
function renderChequeoTerraplen(tot){
  const terra=terraValidable(tot);
  const aprov=((tot['Excavación aprovechable']&&tot['Excavación aprovechable'].total)||0)
            +((tot['Excavación préstamo']&&tot['Excavación préstamo'].total)||0);
  if(terra<=0 || aprov<=0) return notaExternoTerraplen(tot);
  const aviso=avisoTerraplen(tot);
  if(aviso){
    return `<div class="check-row warn">⚠ <span>${aviso}. Revisa: posible doble conteo o material de más.</span></div>`+notaExternoTerraplen(tot);
  }
  return `<div class="check-row ok">✓ <span>Terraplén ${fmt(terra)} ≤ aprovechable+préstamo ${fmt(aprov)} m³ (coherente)</span></div>`+notaExternoTerraplen(tot);
}
function renderBandeja(){
  if(!STATE.cantidades.length) return '<div class="empty-state" data-estilo="padding:20px;"><p>La bandeja está vacía para esta fecha.</p></div>';
  let html=''; const byCat={}; const dups=computeDups();
  STATE.cantidades.forEach((c,idx)=>{ const cat=categoria(c); (byCat[cat]=byCat[cat]||[]).push({c,idx}); });
  ORDEN_CAT.forEach(cat=>{ if(!byCat[cat])return;
    html+=`<div class="grupo-cat">${cat}</div>`;
    byCat[cat].forEach(({c,idx})=>{
      const uf=c.uf||ufFromPk(c.pk_inicial);
      const pk=c.pk_inicial+(c.pk_final?(' - '+c.pk_final):'');
      const dp=dups[idx];
      const dupBadge = dp ? (dp.hard
        ? `<span class="dup hard" title="Mismo PK reportado por: ${esc(dp.exact.join(', '))}">⚠ duplicado: ${esc(dp.exact.join(', '))}</span>`
        : `<span class="dup" title="Misma categoría reportada por capataz y chequeadora">⚠ posible duplicado (control vs oficial)</span>`) : '';
      const dupCls = dp ? (dp.hard?' dupmark hard':' dupmark') : '';
      if(c._nodata){
        html+=`<div class="linea-item off" id="li_${idx}" data-estilo="opacity:.65;border-style:dashed;">
          <div data-estilo="width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;">🔧</div>
          <div class="li-main"><div class="li-act">${esc(c.actividad||c.descripcion||'')} <span data-estilo="font-size:10px;color:var(--muted);font-weight:400;">(solo maquinaria)</span></div>
          <div class="li-sub"><span class="src ${srcClass(c)}">${esc(c.rol||'?')}·${esc(c.reporta||'?')}</span> PK ${esc(pk)||'—'}${uf?` <span class="badge ${esc(uf.toLowerCase())}">${esc(uf)}</span>`:''} · ${c.largo} ${esc(c.unidad)}</div></div>
        </div>`;
      } else {
        const ctrlTag = c._control ? `<span class="ctrl-tag">control · no suma</span>` : '';
        const ofiTag = (!c._control && c.rol==='chequeadora' && CAT_CONTROL_CAPATAZ.includes(cat)) ? `<span class="ofi-tag">oficial</span>` : '';
        const dest = destinosDe(c); // a dónde se envió el material excavado (indicativo, D67)
        const destLine = dest ? `<div class="li-dest">→ ${esc(dest)}</div>` : '';
        // D103: la nota que escribió el capataz en esa actividad (sin los sellos automáticos), visible
        // en el panel y ahora también en el WhatsApp.
        const nota = notaManual(c);
        const notaLine = nota ? `<div class="li-nota">📝 ${esc(nota)}</div>` : '';
        // D79: selector de DESTINO de la conformación (lo elige el residente): RCD → 3701/UF1,
        // ZODME → 3702/UF2. Define ELEMENTO/ABS/UF/proyecto de la fila en DATA (el backend los ancla).
        const confSel = (cat==='Conformación / ZODME')
          ? `<div class="li-dest">Destino: <select class="conf-dest" data-on-change="setDestinoConf(${idx},this.value)">
              <option value="RCD" ${c.destino_conf!=='ZODME'?'selected':''}>RCD 15+800 · 3701 (UF1)</option>
              <option value="ZODME" ${c.destino_conf==='ZODME'?'selected':''}>ZODME PK30 · 3702 (UF2)</option>
            </select></div>` : '';
        html+=`<div class="linea-item ${c._inc?'':'off'}${c._control?' control':''}${dupCls}" id="li_${idx}">
          <button class="tog ${c._inc?'on':'no'}" data-on-click="toggleInc(${idx})">${c._inc?'✓':'✕'}</button>
          <div class="li-main"><div class="li-act">${esc(c.actividad||c.descripcion||'')}${ofiTag}${ctrlTag}</div>
          <div class="li-sub"><span class="src ${srcClass(c)}">${esc(c.rol||'?')}·${esc(c.reporta||'?')}</span> PK ${esc(pk)||'—'}${uf?` <span class="badge ${esc(uf.toLowerCase())}">${esc(uf)}</span>`:''}${dupBadge}</div>${destLine}${notaLine}${confSel}${renderTramo(c,idx)}</div>
          <div class="li-largo"><input type="number" step="any" value="${c.largo}" data-on-change="editLargo(${idx},this.value)"></div>
          <div class="li-unit">${esc(c.unidad||'')}</div>
        </div>`;
      }
    });
  });
  return html;
}
function renderAddCard(){
  let opts='<option value="">— Actividad —</option>';
  const groups={},order=[]; ACTIVIDADES.forEach(x=>{if(!groups[x.g]){groups[x.g]=[];order.push(x.g);}groups[x.g].push(x);});
  order.forEach(g=>{opts+=`<optgroup label="${esc(g)}">`+groups[g].map(x=>`<option value="${esc(x.a)}">${esc(x.a)}</option>`).join('')+'</optgroup>';});
  return `<div class="add-card"><div class="add-grid">
    <div><label>Agregar (encargado)</label><select id="addAct">${opts}</select></div>
    <div><label>PK inicial</label><input type="text" id="addPk" placeholder="14+635"></div>
    <div><label>Largo</label><input type="number" step="any" id="addLargo" placeholder="0"></div>
    <button class="btn-add" data-on-click="addLinea()">+ Añadir</button>
  </div></div>`;
}
function renderMaquinas(){
  if(!STATE.maquinas.length) return '<div class="empty-state" data-estilo="padding:16px;"><p>Sin maquinaria reportada</p></div>';
  let html='';
  maqGroups().forEach(g=>{
    const reps=[...new Set(g.rows.map(r=>(r.m.reporta||'').trim()).filter(Boolean))];
    html += (reps.length>=2) ? renderMaqConflict(g, reps) : renderMaqGrupo(g);
  });
  return html;
}
// líneas de actividad de un conjunto de filas (una máquina + un capataz)
function maqActLines(rows, multi){
  return rows.map(r=>{
    const m=r.m;
    const prod = (m.produccion!==''&&m.produccion!=null) ? ` · ${esc(m.produccion)} ${esc(m.unidad_prod||'')}` : '';
    return `${esc(m.cap_actividad||m.actividad||'—')}${prod}`;
  }).join('<br>');
}
// Grupo de un solo capataz: NO es duplicado (misma máquina en varias actividades). D171: sin horas.
function renderMaqGrupo(g){
  const first=g.rows[0].m;
  const maqId=esc(first.id_maquina||'');
  return `<div class="linea-item u-op1">
    <span class="maq-id">${maqId}</span>
    <div class="li-main"><div class="li-act"><span class="li-tipo">${esc(first.app_tipo_equipo||'')}</span></div>
    <div class="li-sub">${maqActLines(g.rows, g.rows.length>1)} · <span class="src ${first.reporta&&String(first.reporta).indexOf('cheq')===0?'cheq':'cap'}">${esc(first.reporta||'?')}</span></div></div>
    </div>`;
}
// Grupo con ≥2 capataces: conflicto. Muestra la versión de cada capataz con el toggle ✓/✕
// para incluir una y descartar las demás. D171: sin horas ni operador.
function renderMaqConflict(g, reps){
  const maqId=esc(g.id||'');
  const tipo=esc(g.rows[0].m.app_tipo_equipo||'');
  let html=`<div class="maq-conflict">
    <div class="maq-conflict-head"><span class="maq-id">${maqId}</span>
      <span class="li-tipo">${tipo}</span>
      <span class="dup hard" title="Misma máquina reportada por ${reps.length} capataces distintos — incluye la correcta y descarta las demás">⚠ conflicto · ${reps.length} capataces</span></div>`;
  reps.forEach(rep=>{
    const subRows=g.rows.filter(r=>(r.m.reporta||'').trim()===rep);
    const inc=subRows.every(x=>x.m._inc!==false);
    html+=`<div class="linea-item${inc?'':' off'}">
      <button class="tog ${inc?'on':'no'}" data-on-click="toggleMaqReporter('${esc(String(g.key).replace(/'/g,"\\'"))}','${esc(String(rep).replace(/'/g,"\\'"))}')">${inc?'✓':'✕'}</button>
      <div class="li-main"><div class="li-act"><span class="src cap">${esc(rep)}</span></div>
      <div class="li-sub">${maqActLines(subRows, subRows.length>1)}</div></div>
      </div>`;
  });
  html+='</div>';
  return html;
}
// Incluye/descarta todas las filas de {máquina, capataz} en un conflicto.
function toggleMaqReporter(key, rep){
  const rows=STATE.maquinas.filter(m=>(m.id_maquina||'').toUpperCase()===key && (m.reporta||'').trim()===rep);
  const inc=rows.every(m=>m._inc!==false);
  rows.forEach(m=>m._inc=!inc);
  render();
}

function toggleObs(){
  const p=document.getElementById('obsPanel'), b=document.getElementById('obsToggleBtn');
  if(!p) return;
  const open=p.style.display!=='none';
  p.style.display=open?'none':'block';
  if(b) b.textContent=open?'▸ ver':'▾ ocultar';
}
function toggleInc(idx){ STATE.cantidades[idx]._inc=!STATE.cantidades[idx]._inc; marcarCambio(); render(); }
// D79: fija el destino de una línea de conformación y alinea uf/proyecto/CC con él (RCD → 3701/UF1;
// ZODME → 3702/UF2), para que el badge, el WhatsApp y el payload coincidan con lo que anclará el backend.
function setDestinoConfObj(c, v){
  c.destino_conf = (v==='ZODME') ? 'ZODME' : 'RCD';
  c.uf       = (c.destino_conf==='ZODME') ? 'UF2' : 'UF1';
  c.proyecto = (c.destino_conf==='ZODME') ? '3702' : '3701';
  c.centro_costo = c.proyecto + '.02.08';
}
function setDestinoConf(idx, v){ setDestinoConfObj(STATE.cantidades[idx], v); marcarCambio(); render(); }
function editLargo(idx,val){ STATE.cantidades[idx].largo=parseFloat(val)||0; marcarCambio(); refreshTot(); refreshEnvio(); }
function refreshTot(){ const tot=calcTotales(); const box=document.querySelector('.totales'); if(!box)return;
  let html='',any=false;
  ORDEN_CAT.forEach(cat=>{ if(!tot[cat])return; any=true; const o=tot[cat];
    let split=''; if(SPLIT_UF.includes(cat)&&(o.uf1||o.uf2)) split=`<span class="uf-split"> · <span class="u1">UF1 ${fmt(o.uf1)}</span> · <span class="u2">UF2 ${fmt(o.uf2)}</span></span>`;
    html+=`<div class="tot-row"><span class="cat">${cat}${split}${notaExtTot(o)}</span><span class="val">${fmt(o.total)} ${esc(o.uni)}</span></div>`; });
  if(!any) html='<div class="cat" data-estilo="color:var(--muted)">Sin cantidades incluidas</div>';
  box.innerHTML=html;
}
function addLinea(){
  const a=document.getElementById('addAct').value, pk=document.getElementById('addPk').value.trim(), largo=parseFloat(document.getElementById('addLargo').value)||0;
  if(!a){ alert('Elige una actividad'); return; }
  const x=ACT_IDX[a], uf=ufFromPk(pk), proy=uf==='UF1'?'3701':uf==='UF2'?'3702':'';
  const nueva={ id_registro:'', reporta:'(encargado)', rol:'encargado',
    grupo:'TIERRAS', capitulo:'', actividad:a, descripcion:x.item,
    centro_costo:proy?`${proy}.${x.cc}`:'', unidad:x.uni, uf, proyecto:proy, elemento:buildElemento(pk,''), pk_inicial:pk, pk_final:'',
    abs_inicial:pkToMeters(pk), abs_final:null, liberacion:'CAMPO', largo, observacion:'', _inc:true };
  if(x.cc==='02.08') setDestinoConfObj(nueva, 'RCD');   // D79: conformación arranca con destino RCD (el residente puede cambiarlo)
  STATE.cantidades.push(nueva);
  marcarCambio();                                       // D110: línea nueva = el día deja de estar "enviado"
  render();
}

/* D110 — envío a DATA con acuse explícito.
 * Cambia todo lo que rodea a la llamada, no la llamada: mismo endpoint y mismo payload de siempre.
 *   · guarda contra el envío que BORRA (bandeja vacía / todo apagado — el pisado de D03 deja el día
 *     en blanco y hasta ahora eso salía sin una sola advertencia),
 *   · resumen de lo que se va a enviar en la confirmación (incluidas, descartadas, clima y el aviso
 *     de terraplén, que al pie de la página ya no se ve),
 *   · candado anti doble envío mientras el servidor responde,
 *   · confirmación PERMANENTE con el conteo REAL que devolvió el servidor (res.enviadas, D30). */
async function enviar(){
  if(enviando) return;
  const btn=document.getElementById('btnEnviar');
  const incluidas=STATE.cantidades.filter(c=>c._inc);
  const descartadas=STATE.cantidades.length-incluidas.length;
  if(!STATE.cantidades.length){
    alert('La bandeja de tierras está vacía para el '+STATE.fecha+'.\n\nNo hay nada que enviar: un envío vacío solo BORRARÍA lo que ya estuviera en DATA de ese día.');
    return;
  }
  if(!incluidas.length){
    if(!confirm('⚠️ ATENCIÓN — no hay NINGUNA fila incluida.\n\nSi envías así, DATA queda SIN NADA de tierras para el '+STATE.fecha+' (se borra lo que ya hubiera).\n\n¿Enviar de todas formas?')) return;
  }
  /* D130 — sin clima NO se envía. El backend lo rechaza igual (la regla vive en los dos lados), pero
   * aquí se para antes de gastar la petición y se lleva al residente al selector, que está más abajo. */
  if(!STATE.clima){
    alert('Falta el CLIMA del día.\n\nNo se puede enviar a DATA sin él: el clima se estampa en la observación del reporte y el Excel maestro lo lee de ahí.\n\nElígelo en «Clima del día» (Soleado · Lluvias · Lluvias parciales) y vuelve a enviar.');
    const sel=document.getElementById('clima');
    if(sel){ if(sel.scrollIntoView) sel.scrollIntoView({behavior:'smooth', block:'center'}); try{ sel.focus(); }catch(e){} }
    return;
  }
  let txt='Vas a enviar a DATA el reporte de TIERRAS del '+STATE.fecha+':\n\n'
    +'• '+incluidas.length+' fila(s) incluidas\n'
    +(descartadas?('• '+descartadas+' fila(s) descartadas (no se envían)\n'):'')
    +'• Clima: '+(STATE.clima||'sin especificar')+'\n';
  const avisoT=avisoTerraplen();
  if(avisoT) txt+='\n⚠ '+avisoT+' — posible doble conteo.\n';
  txt+='\nSe REEMPLAZA todo lo que ya hubiera de ese día en tierras (drenajes ODT/ODL no se tocan).\n\n¿Continuar?';
  if(!confirm(txt)) return;
  enviando=true; STATE.envioError='';
  if(btn){ btn.textContent='ENVIANDO…'; btn.disabled=true; }
  try{
    // area:'tierras' (D70): el pisado de DATA es por día + área — este envío nunca borra ODT/ODL.
    const resp=await fetch(APPS_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({action:'enviar_data', fecha:STATE.fecha, area:'tierras', clima:STATE.clima||'', cantidades:incluidas})});
    const res=await resp.json();
    if(!res||!res.ok) throw new Error((res&&res.error)||'Respuesta inesperada');
    // A partir de aquí lo que hay en DATA es exactamente lo que está en pantalla.
    STATE.cantidades.forEach(c=>{ c._enviada=true; });
    STATE.dirty=false;
    STATE.envioN=(res.enviadas!=null?res.enviadas:incluidas.length);
    guardarEnvioLocal(STATE.fecha, STATE.envioN);
    enviando=false;
    render();
    const box=document.getElementById('envioBoxBottom');
    if(box && box.scrollIntoView) box.scrollIntoView({behavior:'smooth', block:'center'});
  }catch(err){
    enviando=false;
    STATE.envioError=(err&&err.message)||'error desconocido';
    render();
    alert('⚠ NO se envió a DATA: '+STATE.envioError+'\n\nEste día puede haber quedado sin actualizar en el maestro. Revisa la señal y vuelve a intentarlo: reenviar no duplica nada (el envío reemplaza el día).');
  }
}

function generarMensaje(){
  const tot=calcTotales();
  const f=new Date(STATE.fecha+'T12:00:00');
  const dd=String(f.getDate()).padStart(2,'0'), mm=String(f.getMonth()+1).padStart(2,'0'), yy=String(f.getFullYear()).slice(2);
  let msg=`*Reporte de actividades de movimiento de Tierras ${dd}/${mm}/${yy}*\n`;
  if(STATE.clima) msg+=`_Clima: ${STATE.clima}_\n`;
  msg+='——————————\n';
  const byCat={}; STATE.cantidades.forEach(c=>{ if(!c._inc) return; const cat=categoria(c);(byCat[cat]=byCat[cat]||[]).push(c);});
  ORDEN_CAT.forEach(cat=>{ if(!byCat[cat])return; const o=tot[cat];
    if(cat==='Estructuras / MSR'){
      // Cambio 1: sin total en el encabezado (las actividades MSR mezclan unidades: M3/M2/UND/M).
      // Cambio 2: cada línea muestra el nombre de la actividad con su unidad propia, no el PK.
      msg+=`\n* *${cat}:\n`;
      byCat[cat].forEach(c=>{ msg+=`${c.actividad||c.descripcion||'—'}  ${fmt(c.largo)} ${c.unidad}\n`;
        msg+=notasTxt([c],'  '); });   // D103: nota del capataz bajo su actividad
    } else if(cat==='Excavación aprovechable' || cat==='Excavación préstamo'){
      // D80 (antes Cambio 3/D56): total en el encabezado + UNA línea por origen. La excavación ya es
      // una fila acumulada al PK del origen (D63), así que no se repite el PK debajo del origen ni se
      // escribe "→ Terraplén" (es el destino normal y el terraplén tiene su propia sección). Solo se
      // menciona, entre paréntesis, lo que fue a OTRO lado (Puente/ODL/ODT): en el encabezado el total
      // y en cada origen su parte. Si el origen no trae etiqueta, se usa su PK.
      const extraCat=destinosNoTerra(byCat[cat]);
      msg+=`\n* *${cat}: ${fmt(o.total)} ${o.uni}${extraCat?` (${extraCat})`:''}\n`;
      const byOrigen={}, origenOrder=[];
      byCat[cat].forEach(c=>{ const orig=(c.origen||'').trim()||(c.pk_inicial||'—');
        if(!byOrigen[orig]){ byOrigen[orig]=[]; origenOrder.push(orig); } byOrigen[orig].push(c); });
      origenOrder.forEach(orig=>{ const lines=byOrigen[orig];
        const sub=lines.reduce((s,c)=>s+c.largo,0);
        const extra=destinosNoTerra(lines);
        msg+=`  ${orig}: ${fmt(sub)} ${o.uni}${extra?` (${extra})`:''}\n`;
        if(lines.length>1){   // varias líneas del mismo origen (caso raro): se detallan por PK
          lines.forEach(c=>{ const pk=c.pk_inicial+(c.pk_final?(' - '+c.pk_final):'');
            const ex1=destinosNoTerra([c]);
            msg+=`    ${pk||'—'}  ${fmt(c.largo)} ${c.unidad}${ex1?` (${ex1})`:''}\n`;
            msg+=notasTxt([c],'      '); });   // D103
        } else msg+=notasTxt(lines,'    ');    // D103: nota del origen (la excavación de la chequeadora no trae)
      });
    } else {
      let head=`\n* *${cat}: ${fmt(o.total)} ${o.uni}`;
      if(SPLIT_UF.includes(cat)&&(o.uf1||o.uf2)) head+=`  (UF1: ${fmt(o.uf1)} / UF2: ${fmt(o.uf2)})`;
      msg+=head+'\n';
      // D80: sin línea "→ destino": la única categoría de este bloque que la traía era la excavación
      // NO APROVECHABLE ("→ Botadero N m³"), redundante — ese material va a botadero por definición.
      // El desglose completo de destinos sigue visible en el panel (li-dest) para reconciliar.
      byCat[cat].forEach(c=>{ const pk=c.pk_inicial+(c.pk_final?(' - '+c.pk_final):'');
        // D79: la conformación indica su DESTINO (RCD 15+800 / ZODME PK30) elegido por el residente.
        const confTag=(cat==='Conformación / ZODME'&&c.destino_conf)?(' · '+(c.destino_conf==='ZODME'?'ZODME PK30':'RCD 15+800')):'';
        // D113: el terraplén hecho con material externo se identifica en el mensaje (crudo de río /
        // UF3). Sigue sumando en el total de la categoría: es terraplén, solo cambia de dónde salió.
        const mat=tagMaterial(c), matTag=mat?(' · '+mat):'';
        msg+=`${pk||'—'}  ${fmt(c.largo)} ${c.unidad}${confTag}${matTag}\n`;
        msg+=notasTxt([c],'  '); });   // D103: nota del capataz bajo su actividad
    }
  });
  // Equipos: una línea por {máquina, capataz}, agregando sus apariciones del día (D46/D51).
  // En conflicto (≥2 capataces) solo entran las versiones incluidas (_inc) por el encargado.
  const maqInc=STATE.maquinas.filter(m=>m._inc!==false);
  if(maqInc.length){ msg+='\n*Equipos:*\n';
    const mg={}, mo=[];
    // D171: solo el código y la actividad — sin horas ni operador (van por el Parte Digital).
    maqInc.forEach(m=>{ const k=(m.id_maquina||'').toUpperCase()+'|'+(m.reporta||'').trim();
      if(!mg[k]){ mg[k]={id:m.id_maquina, acts:[]}; mo.push(k); }
      const a=(m.cap_actividad||m.actividad||'').trim(); if(a && mg[k].acts.indexOf(a)<0) mg[k].acts.push(a); });
    mo.forEach(k=>{ const grp=mg[k]; msg+=`- ${grp.id}`+(grp.acts.length?` · ${grp.acts.join(' / ')}`:'')+'\n'; }); }
  const obsArr=(STATE.observaciones||[]).filter(o=>o.observacion);
  if(obsArr.length){ msg+='\n*OBSERVACIONES:*\n'; obsArr.forEach(o=>{ msg+=`${o.reporta||'?'}: ${o.observacion}\n`; }); }
  const inop=(document.getElementById('inoperativos').value||'').trim();
  if(inop) msg+='\n*EQUIPOS INOPERATIVOS*\n'+inop+'\n';
  const box=document.getElementById('msgBox'); box.style.display='block'; box.textContent=msg;
  if(navigator.clipboard) navigator.clipboard.writeText(msg).then(()=>{},()=>{});
}
