/**
 * Reporte Diario de Obra — Backend con BANDEJA (Google Apps Script)
 *
 * Flujo: capataz/chequeadora -> BANDEJA (crudo) ; equipos -> MAQUINARIA
 *        encargado revisa la bandeja y "Envía a DATA" -> DATA (oficial, limpio)
 *
 * Endpoints:
 *   GET  ?action=bandeja&fecha=YYYY-MM-DD[&proyecto=3701][&area=tierras|odt|odl]
 *                                        -> {cantidades:[](crudo), maquinas:[], observaciones:[]} (área derivada del CC, D69;
 *                                           D86: las observaciones generales también se filtran por área)
 *   GET  ?action=consolidado&fecha=...   -> {cantidades:[](de DATA, ya enviado)}
 *   GET  ?action=consolidado&desde=YYYY-MM-DD&hasta=YYYY-MM-DD  -> {filas:[](A–T crudo de DATA en el rango),header,cols} (panel del jefe, solo lectura)
 *   GET  ?action=estado&fecha=...        -> {reportadas:[{id_maquina,capataz}]}
 *   GET  ?action=cubicaje                -> {cubicaje:{PLACA:cubicaje,...}}  (catálogo placa→m³/viaje, D53)
 *   GET  ?action=volquetas&fecha=YYYY-MM-DD -> {fecha, filas:[{id_registro,reporta,origen,destino,tipo_destino,uf,placa,viajes,cubicaje,cubicaje_origen}]} (SOLO LECTURA de VOLQUETAS para digitadora.html, D83)
 *   GET  ?action=drenajes                -> {marcadores:[ODT*],items:[ítems .06/.07]} (catálogo drenajes, D69)
 *   GET  ?action=tramos                  -> {tramos:[{elemento,abs_inicio,abs_fin,pk_inicio,pk_fin,pk}]}
 *                                           (subtramos del eje ordenados por abscisa, solo conjunto TRAMO;
 *                                           alimenta el selector de subtramo del encargado, D104)
 *   GET  ?action=acumulado_drenajes[&area=] -> {acumulado:{"ELEMENTO||CCcorto":cantidad}} (acumulado oficial por ODT, D70)
 *   GET  ?action=maquinaria_produccion&fecha=...  -> cruce MAQUINARIA(CC 02.05-08) × volumen oficial DATA (2.4/D55)
 *   POST {action:'maquinaria_produccion', fecha, ajustes:[{id_registro,produccion}]} -> parcha SOLO col T de MAQUINARIA
 *   GET  ?action=debug&fecha=...
 *   POST  reporte: {fecha,rol,capataz,cantidades:[{...,equipos:[]}],volquetas:[{origen,destino,tipo_destino,uf,placas:[{placa,viajes}]}],maquinaria:[{id_maquina,...}]}
 *           -> BANDEJA (+ MAQUINARIA) ; chequeadora además -> VOLQUETAS (una fila por placa)
 *           y, si envía maquinaria, sus excavadoras -> MAQUINARIA (producción = total excavado ÷ nº máquinas, D54)
 *           D82: cada fila puede traer id_registro UUID de CLIENTE → dedupe por fecha (reenvíos de la
 *           cola offline no duplican); payload sin ids = comportamiento viejo. Respuesta incluye
 *           {guardadas, duplicadas} además de los conteos de siempre.
 *   POST  {action:'enviar_data', fecha, area, cantidades:[...incluidas...]}  -> DATA
 *           (pisa el día SOLO en el área que envía — tierras | odt | odl; enmienda operativa de D03, D69)
 */

const SHEET_ID = '1OEAZCcj_kgVS6jWXxOSgyvm57sOsJ7fA1mRTJPU-icM';

// D93 — tamaño mínimo de expansión de la grilla (filas). Una hoja de Sheets nace con 1.000 filas;
// cuando se agotan, un setValues en bloque falla entero ("The coordinates of the range are outside
// the dimensions of the sheet") y el usuario tenía que añadir filas a mano para que la información
// volviera a cargar. Se crece en bloques de este tamaño para no fragmentar la grilla. Es el ÚNICO
// número a cambiar si se quiere otro tamaño de bloque.
const BLOQUE_FILAS = 1000;

// DATA: A–T orden del maestro ; U–AA internas
const DATA_HEADERS = ['FECHA','ORDEN','GRUPO','CENTRO DE COSTO','CAPITULO','DESCRIPCION',
  'UNIDAD FUNCIONAL','PROYECTO','ELEMENTO','ABS INICIAL','ABS FINAL','LIBERACION','ACTA',
  'UNIDAD MEDIDA','LARGO','ESPESOR','FC','CANTIDAD','OBSERVACION','Columna1',
  'id_registro','timestamp','capataz','rol','actividad','pk_inicial','pk_final',
  // area (D71): 'tierras' | 'odt' | 'odl' — INTERNA (tras AA, no viaja al maestro; el paste es A:S).
  // Fija el "pisado por área" (D70) para ítems cuyo CC NO deriva el área por sí solo: la DEMOLICIÓN
  // DE ESTRUCTURAS (01.02) es drenaje pero su CC deriva 'tierras'. Filas viejas (col vacía) caen a
  // deriveArea(CC) vía areaDeFila, así que su clasificación no cambia.
  'area',
  // clima (D37): observación del clima del día que elige el encargado al enviar a DATA. INTERNA
  // (tras `area`, columna AC — NO viaja al maestro: el paste sigue siendo A:S). No hay columna de
  // clima en el maestro; vive aquí solo para alimentar el WhatsApp y el resumen del jefe (jefe.html
  // la lee de esta columna vía consolidado). Valor por día (mismo string en todas las filas del
  // envío); filas viejas la tienen vacía (retrocompatible).
  'clima'];
const C = { FECHA:0, LARGO:14, OBS:18 };

// BANDEJA: llaves limpias (lo crudo que reportan)
// col 23 `origen`: banco de material (Masivo 1, Masivo 2, Complementario, Otro) para filas de
// excavación aprovechable de la chequeadora; vacío para capataz/encargado (D56).
// col 24 `area` (D69): 'odt' | 'odl' derivada del CC al guardar; vacío = tierras (retrocompatible:
// las filas anteriores al cambio quedan con area='' y se leen como tierras).
// cols 25–28 (D69, SOLO WhatsApp de drenajes — NUNCA van a DATA): `personal_oficiales`,
// `personal_ayudantes`, `turno_noche` ('SI'/''), `nota_libre`.
const BANDEJA_HEADERS = ['id_registro','timestamp','fecha','reporta','rol','grupo','capitulo',
  'actividad','descripcion','centro_costo','unidad','uf','proyecto','elemento',
  'pk_inicial','pk_final','abs_inicial','abs_final','liberacion','largo','observacion','estado','origen',
  'area','personal_oficiales','personal_ayudantes','turno_noche','nota_libre'];

// MAQUINARIA: layout alineado a Captura_Diaria (fact_produccion, A1:AA) — D52.
// A→AA = columnas de la tabla Excel (entrada con valor; fórmula/no-captura en BLANCO);
// internos del app DESPUÉS de AA (trazabilidad y valores reales que en Captura son fórmula).
// El usuario pega el bloque A:AA (Pegado especial → Omitir blancos) de las filas con a_captura='SI'.
const MAQ_HEADERS = [
  // A    B        C      D          E             F             G
  'id_registro','fecha','dia','proyecto','id_maquina','tipo_equipo','operador',
  // H        I               J         K                   L                M
  'actividad','sub_actividad','unidad','horas_programadas','horas_operadas','pct_util',
  // N             O                    P            Q                  R        S
  'horas_muertas','horas_mantenimiento','pct_muerto','horas_facturadas','estado','clima',
  // T          U      V        W             X          Y        Z       AA
  'produccion','meta','pct_ef','rendimiento','unitario','viajes','costo','observacion',
  // ---- internos del app (después de AA) ----
  'app_id_registro','id_cantidad','timestamp','reporta','app_tipo_equipo',
  'app_horas_programadas','app_horas_muertas','motivo','unidad_prod','cap_actividad','a_captura',
  // produccion_capataz_orig: estimado geométrico original del capataz (largo, D20) que el panel
  // produccion-maquinaria.html (2.4/D55) sustituye por el volumen oficial de la chequeadora.
  // Se escribe SOLO la primera vez que se ajusta la fila, para conservar el estimado original.
  'produccion_capataz_orig',
  // area (D69): 'odt' | 'odl' para máquinas de drenajes (captura libre, a_captura=NO SIEMPRE: no
  // pasan a Captura_Diaria); vacío = tierras (filas viejas incluidas). Sirve para filtrar la
  // bandeja/WhatsApp y el seguimiento de faltantes por área.
  'area'];

// Mapa actividad del capataz → [actividad(H), SUB ACTIVIDAD(I)] de Captura_Diaria (05_CATALOGO §1, D52)
const CAPTURA_ACT_MAP = {
  'Excavación aprovechable (masivo)':                 ['EXCAVACION COMUN','EXCAVACION APROVECHABLE'],
  'Excavación no aprovechable':                       ['EXCAVACION COMUN','EXCAVACION NO APROVECHABLE'],
  'Excavación de préstamo (Diviso)':                  ['EXCAVACION PRESTAMO','EXCAVACION APROVECHABLE'],
  'Núcleo de terraplén':                              ['TERRAPLEN','NUCLEO DE TERRAPLEN'],
  'Corona de terraplén':                              ['TERRAPLEN','CORONA DE TERRAPLEN'],
  // D113 — terraplén por MATERIAL (crudo de río / UF3). Son terraplén normal (mismo ítem 02.07) y NO
  // se dividen en núcleo/corona: la distinción es solo de material, para control interno. El modelo de
  // maquinaria no tiene SUB ACTIVIDAD propia para ellos (confirmado con el dueño), así que sus máquinas
  // pasan a Captura_Diaria como NUCLEO DE TERRAPLEN. Sin este par, `derivarActividad` devolvería
  // a_captura='NO' y esas máquinas dejarían de pasar a Captura en silencio.
  'Terraplén con crudo de río':                       ['TERRAPLEN','NUCLEO DE TERRAPLEN'],
  'Terraplén de UF3':                                 ['TERRAPLEN','NUCLEO DE TERRAPLEN'],
  'Cereo de corona':                                  ['TERRAPLEN','CEREO CORONA'],
  'Conformación y disposición de sobrantes (ZODME)':  ['CONFORMACION','ZODME'],
  'Conformación de subbase':                          ['SUBBASE','CONFORMACION SUBBASE'],
  'Cereo de subbase':                                 ['SUBBASE','CEREO SUBBASE'],
  'Base estabilizada con cemento (BTC)':              ['BASE','BTC'],
  'Desmonte y limpieza en bosque':                    ['DESMONTE','DESMONTE'],
  'Descapote / zonas no boscosas':                    ['DESMONTE','DESCAPOTE']
};
// Apoyo de compactación: hereda H/I del frente que apoya (sub_actividad del catálogo del capataz)
const CAPTURA_APOYO_MAP = {
  'COMPACT_TERRAPLEN': ['TERRAPLEN','NUCLEO DE TERRAPLEN'],
  'COMPACT_SUBBASE':   ['SUBBASE','CONFORMACION SUBBASE'],
  'COMPACT_BTC':       ['BASE','BTC']
};
// Deriva {h, i, aCaptura} de la actividad del capataz (c). Sin par definido → a_captura='NO'
// (paisajeo, adecuación de caminos, limpieza de derrumbe, MSR, pedraplén).
function derivarActividad(c){
  if((c.actividad||'')==='APOYO'){
    const sub=c.sub_actividad||'';
    if(CAPTURA_APOYO_MAP[sub]) return {h:CAPTURA_APOYO_MAP[sub][0], i:CAPTURA_APOYO_MAP[sub][1], aCaptura:'SI'};
    return {h:'', i:'', aCaptura:'NO'}; // paisajeo / adecuación / derrumbe
  }
  const par=CAPTURA_ACT_MAP[c.actividad||''];
  if(par) return {h:par[0], i:par[1], aCaptura:'SI'};
  return {h:'', i:'', aCaptura:'NO'}; // MSR, pedraplén, sin par
}
// Deriva R (ESTADO) del motivo (05_CATALOGO §5, D52). Sin horas muertas → OPERANDO.
function derivarEstado(motivo, muertas){
  if(!(parseFloat(muertas)>0.01)) return 'OPERANDO';
  const m=(motivo||'').trim().toLowerCase();
  if(!m) return 'OPERANDO';
  if(m.indexOf('mantenimiento')>=0) return 'MANTENIMIENTO';
  if(m.indexOf('falla')>=0)         return 'VARADO';
  if(m.indexOf('sin operador')>=0)  return 'SIN OPERADOR';
  if(m.indexOf('lluvia')>=0 || m.indexOf('clima')>=0) return 'LLUVIAS';
  if(m.indexOf('bloqueo')>=0)       return 'BLOQUEO';
  // Sin frente / Esperando material / Abastecimiento / Traslado/movilización / Otro / texto libre
  return 'ESPERA';
}
// Tipos cuya producción (T) es SIEMPRE nula: vibrocompactadores + minicargador/minibuldozer (D41/D44)
// + la retroexcavadora RT-02 "la pajarita" (alquilada). Estas máquinas compactan/apoyan frentes de
// otras; no generan producción propia.
function esTipoSinProduccion(tipo){
  const t=(tipo||'').toUpperCase();
  return t==='VIBROCOMPACTADOR' || t==='MINICARGADOR' || t==='MINIBULDOZER' || t==='RETROEXCAVADORA';
}

// OBSERVACIONES: observación general del día que escribe quien reporta (una fila por envío).
// `area` (D86): área(s) a las que pertenece la observación — 'tierras' | 'odt' | 'odl' o una lista
// separada por comas ('odt,odl') cuando un mismo reporte cubre las dos áreas de drenajes (D84).
// Se deriva de las líneas del reporte. Filas anteriores a la columna (vacía) = 'tierras', que es lo
// que eran: hasta D86 solo tierras escribía observación general. La bandeja filtra por esta columna,
// así que las observaciones de tierras dejan de salir en el panel/WhatsApp de drenajes.
const OBS_HEADERS = ['id_registro','timestamp','fecha','reporta','observacion','area'];

// VOLQUETAS: desglose por placa de la chequeadora (una fila por placa). No toca DATA ni MAQUINARIA.
// cubicaje·m3_placa·cubicaje_origen añadidos en D53 (2.10): cubicaje real por placa.
const VOLQUETAS_HEADERS = ['id_registro','timestamp','fecha','reporta','origen','destino',
  'tipo_destino','uf','placa','viajes','cubicaje','m3_placa','cubicaje_origen'];

// CUBICAJE: catálogo placa→cubicaje (m³/viaje) que mantiene el usuario como espejo de la
// Bitácora de Transporte. Lo lee el backend; no va a DATA (D53). `tipo` es opcional/informativo.
const CUBICAJE_HEADERS = ['placa','cubicaje','tipo'];

/* ---------- helpers ---------- */
/**
 * D100 — campo `_ms` = milisegundos de SERVIDOR en toda respuesta JSON (mismo criterio que el módulo
 * de Asistencias, D99). Sirve para separar lo que tarda Apps Script de la red y del arranque del
 * contenedor: los frontends con `DEBUG_PERF` lo muestran como `servidor_ms` / `red_ms`.
 * `_t0` lo siembran doGet/doPost; sin él (ejecución desde el editor) no se agrega el campo.
 */
var _t0 = null;
/**
 * D107 — campo `_celdas` = celdas de Sheet LEÍDAS en esta ejecución (mismo instrumento que D102 puso
 * en el módulo de Asistencias). Es el `_ms` del volumen: permite ver en campo si la lectura acotada
 * está entrando o si se cayó al respaldo, sin adivinar. Lo suma `leerRango_`, único punto por el que
 * pasa TODO `getValues` del archivo — por eso agregar una lectura nueva no lo puede desfasar.
 * OJO, dicho sin adornos: cuenta LECTURAS, no escrituras.
 */
var _celdas = 0;
function json(o){
  if(_t0 !== null && o && typeof o === 'object' && o._ms === undefined) o._ms = Date.now() - _t0;
  if(_t0 !== null && o && typeof o === 'object' && o._celdas === undefined) o._celdas = _celdas;
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
// D107 — ÚNICO punto de lectura del Sheet. Todo getValues pasa por aquí (ver `_celdas`).
function leerRango_(sh, fila, col, nFilas, nCols){
  _celdas += nFilas * nCols;
  return sh.getRange(fila, col, nFilas, nCols).getValues();
}
let _shTZ; function shTZ(){ if(!_shTZ) _shTZ=ss_().getSpreadsheetTimeZone(); return _shTZ; }
function fdate(v){
  if(v === null || v === undefined || v === '') return '';
  if(typeof v === 'object' && typeof v.getFullYear === 'function')
    return v.getFullYear()+'-'+('0'+(v.getMonth()+1)).slice(-2)+'-'+('0'+v.getDate()).slice(-2);
  return String(v).slice(0,10);
}
function toDate(s){ const p=String(s||'').slice(0,10).split('-'); if(p.length<3) return ''; return new Date(Number(p[0]),Number(p[1])-1,Number(p[2])); }
/* D106 — portero de fechas, gemelo del de CodigoAsistencias.gs (son dos proyectos separados, D69).
 * `fdate` normaliza pero no valida: con vacío devuelve '' y con basura devuelve los 10 primeros
 * caracteres. Aquí eso terminaba en `toDate('')` = '' escrito en la col A de DATA, que es la columna
 * FECHA del maestro TM2 — una fila que se pega en el Excel sin fecha. Las capturas de obra ya validan
 * la fecha en el cliente (capataz/chequeadora/drenajes marcan el campo en rojo y no envían), así que
 * esto es la red de abajo: ningún payload legítimo de hoy la necesita, y ninguno se rompe por ella.
 * No afecta la retrocompatibilidad de la cola offline (D82): sin `ok:true` el ítem se queda encolado
 * en el teléfono en vez de escribirse mal, que es justo lo que se quiere. */
function fdateValida_(v){
  const s=fdate(v);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const p=s.split('-'), y=Number(p[0]), m=Number(p[1]), d=Number(p[2]);
  const dt=new Date(y, m-1, d);
  return (dt.getFullYear()===y && dt.getMonth()===m-1 && dt.getDate()===d) ? s : '';
}
const ERROR_FECHA = 'La fecha del reporte llegó vacía o con un formato que no se entiende. '
  + 'Vuelve a elegir el día en el campo "Fecha" y envía otra vez. '
  + 'No se guardó nada a propósito: una fila sin fecha no aparece en la bandeja ni en el maestro.';
/**
 * D93 — Garantiza que la hoja tenga filas suficientes para escribir n filas a partir de la última
 * fila con datos. Crece en bloques (BLOQUE_FILAS) para no fragmentar la grilla. Idempotente y
 * barata: si hay espacio, no hace NADA (una sola lectura de getLastRow/getMaxRows, cero escrituras).
 * La inserción es SIEMPRE después de la última fila de la GRILLA (insertRowsAfter(getMaxRows())),
 * así que jamás desplaza ni pisa filas existentes.
 * NO pre-crea filas vacías "por si acaso": el techo del archivo es de 10 millones de celdas sumando
 * todas las hojas y las filas vacías consumen cupo y degradan el rendimiento.
 */
function ensureRows_(sheet, n) {
  var necesarias = sheet.getLastRow() + (n || 1);
  var faltan = necesarias - sheet.getMaxRows();
  if (faltan > 0) {
    sheet.insertRowsAfter(sheet.getMaxRows(), Math.max(faltan, BLOQUE_FILAS));
  }
}

/**
 * D93 — Garantiza que la hoja tenga al menos nCols columnas (el mismo problema, en el otro eje).
 * Solo garantiza CAPACIDAD para los encabezados que el código ya define: no cambia el orden ni el
 * número de columnas de ninguna hoja.
 */
function ensureCols_(sheet, nCols) {
  var faltan = nCols - sheet.getMaxColumns();
  if (faltan > 0) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), faltan);
  }
}

/**
 * D100 (mismo cambio que D99 en el módulo de Asistencias) — UNA sola apertura del Spreadsheet por
 * ejecución. Antes cada helper hacía su propio `ss_()`: `?action=bandeja`
 * (el panel del encargado) abría el archivo 6 veces, `maquinaria_produccion` 4 y `estado` 2.
 * Es una variable de EJECUCIÓN, no un caché entre peticiones: Apps Script arranca un contexto nuevo
 * en cada llamada, así que nunca sobrevive a la petición.
 */
var _ss = null;
function ss_(){ if(!_ss) _ss = SpreadsheetApp.openById(SHEET_ID); return _ss; }

/**
 * D100 — Memoria de lectura DENTRO DE UNA MISMA EJECUCIÓN (no es CacheService: no sobrevive a la
 * petición, así que no puede devolver datos viejos a otra llamada). Hoy los endpoints de lectura no
 * repiten hoja, así que gana poco; está para que releer una hoja ya leída no cueste nada y para no
 * reintroducir el problema al agregar endpoints. Toda escritura invalida su hoja.
 * NO se toca el ancho de la lectura: BANDEJA/MAQUINARIA/DATA ya tienen exactamente el ancho de su
 * esquema (nada que recortar), y CUBICAJE y VOLQUETAS se leen buscando las columnas POR NOMBRE a
 * propósito —CUBICAJE lo mantiene el usuario a mano (D53)—, así que acotarlas sería una regresión.
 */
var _memoHoja = {};
/* D107 — invalida las DOS memorias: la de la hoja completa y la de las lecturas ACOTADAS por fecha.
 * Si solo se borrara `_memoHoja`, una lectura acotada hecha ANTES de escribir seguiría sirviéndose de
 * `_memoRango` después de la escritura, en la misma ejecución, y devolvería datos viejos en silencio.
 * (`_memoRango` se declara más abajo, junto al lector; en Apps Script el `var` está izado, así que
 * esta función puede referenciarlo aunque aparezca antes en el archivo.) */
function invalidarHoja_(nombre){
  delete _memoHoja[nombre];
  const pref = nombre + '|';
  Object.keys(_memoRango).forEach(function(k){ if(k.indexOf(pref) === 0) delete _memoRango[k]; });
}

function getSheet(name, headers){
  const ss=ss_(); let sh=ss.getSheetByName(name);
  if(!sh) sh=ss.insertSheet(name);
  const need=headers.length;
  // asegura ancho de grilla suficiente (p. ej. MAQUINARIA pasó de 18 a 38 columnas en D52; BANDEJA
  // de 23 a 28 en D56/D70d). D93: la misma comprobación, ahora en el helper único ensureCols_.
  ensureCols_(sh, need);
  invalidarHoja_(name);   // D100: getSheet puede reescribir encabezados y precede a toda escritura
  if(sh.getLastRow()===0){ sh.getRange(1,1,1,need).setValues([headers]); return sh; }
  // auto-sana la fila de encabezados si no coincide con el esquema actual del código.
  // (tras el realineado de MAQUINARIA a Captura_Diaria, las filas con layout viejo quedan
  // con `fecha` ilegible y el filtro por fecha de la bandeja/estado las descarta solas.)
  const cur=leerRango_(sh,1,1,1,need)[0];   // D107: pasa por el contador `_celdas`
  let diff=false; for(let i=0;i<need;i++){ if(String(cur[i]||'')!==headers[i]){ diff=true; break; } }
  if(diff) sh.getRange(1,1,1,need).setValues([headers]);
  return sh;
}
function readSheet(name){
  if(_memoHoja.hasOwnProperty(name)) return _memoHoja[name];   // D100: memoria de esta ejecución
  const sh=ss_().getSheetByName(name), out=[];
  if(sh && sh.getLastRow()>=2){
    const v=leerRango_(sh, 1, 1, sh.getLastRow(), sh.getLastColumn()), h=v[0];
    for(let i=1;i<v.length;i++){ const o={}; h.forEach((k,j)=>o[k]=v[i][j]); o.fecha=fdate(o.fecha); o._row=i+1; out.push(o); }
  }
  _memoHoja[name]=out;
  return out;
}

/* ============ D107 — LECTURA ACOTADA POR FECHA EN OBRA (backlog 3.6) ============
 *
 * El mismo lever que D102 le puso a `ASISTENCIA`, ahora en las hojas que crecen de este Sheet:
 * BANDEJA, MAQUINARIA, VOLQUETAS y OBSERVACIONES. Hoy los endpoints por fecha leen la hoja ENTERA y
 * filtran en memoria: `bandeja` lee 3 hojas completas, `maquinaria_produccion` 2, `volquetas` 1.
 * Medido en banco por 3.6: `bandeja` pasaría de 324.120 celdas a 13.962 con un año de histórico (~23×).
 *
 * DIFERENCIA IMPORTANTE CON EL DE ASISTENCIAS: allá el esquema de columnas es fijo y conocido
 * (`ASISTENCIA_HEADERS`). Aquí NO se puede asumir: D100 dejó dicho que en CUBICAJE y VOLQUETAS el
 * usuario mantiene la hoja a mano y puede traer columnas de más o en otro orden, por eso el código
 * las busca POR NOMBRE. Así que este lector lee la fila 1 de la hoja y saca de ahí tanto el ancho
 * como la posición de `fecha`. Si no hay columna `fecha`, se cae solo a la lectura completa.
 *
 * Devuelve EXACTAMENTE lo mismo que `readSheet(name).filter(r=>r.fecha===fecha)`: mismas claves
 * (las del encabezado real), mismo `fdate` sobre `fecha`, mismo `_row`, mismo orden de hoja.
 */
const GAP_TOLERANCIA_OBRA = 5;      // huecos de 1–2 filas salen más baratos absorbidos que en otro viaje
const MAX_BLOQUES_OBRA    = 12;     // más fragmentación que esto ⇒ no compensa: lectura completa
const UMBRAL_COBERTURA_OBRA = 0.40; // si habría que traer >40 % de la hoja, se lee entera
const MIN_FILAS_DOS_PASOS_OBRA = 2000;

var _memoRango = {};   // memoria de lo ACOTADO, separada de _memoHoja (que guarda la hoja COMPLETA)

/* Motor común de los dos lectores acotados. Devuelve las filas CRUDAS del día (array de valores tal
 * cual salen de la hoja) más su nº de fila real y el encabezado, o `null` si toca caer al respaldo.
 * `colFechaFija` (1-based, opcional) fuerza la columna de fecha: lo usa DATA, cuyo encabezado es el
 * del maestro (col A "FECHA" en mayúsculas), no el nombre interno `fecha`. */
function _crudasPorFecha_(sh, f, colFechaFija){
  const last=sh.getLastRow();
  if(last<2) return {h:[], filas:[]};
  const nFilas=last-1, nCols=sh.getLastColumn();
  if(nFilas < MIN_FILAS_DOS_PASOS_OBRA) return null;                 // hoja chica: no compensa escanear
  const h=leerRango_(sh,1,1,1,nCols)[0];
  const colFecha = colFechaFija || (h.map(function(k){ return String(k==null?'':k).trim(); }).indexOf('fecha')+1);
  if(colFecha<1 || colFecha>nCols) return null;                       // sin columna de fecha: respaldo

  const col=leerRango_(sh,2,colFecha,nFilas,1), filasOk=[];
  for(let i=0;i<nFilas;i++) if(fdate(col[i][0])===f) filasOk.push(i+2);
  if(!filasOk.length) return {h:h, filas:[]};

  const bloques=[]; let ini=filasOk[0], prev=filasOk[0], traidas=0;
  for(let i=1;i<filasOk.length;i++){
    if(filasOk[i]-prev-1 > GAP_TOLERANCIA_OBRA){ bloques.push([ini,prev]); traidas+=prev-ini+1; ini=filasOk[i]; }
    prev=filasOk[i];
  }
  bloques.push([ini,prev]); traidas+=prev-ini+1;
  if(bloques.length > MAX_BLOQUES_OBRA || traidas > nFilas*UMBRAL_COBERTURA_OBRA) return null;

  const filas=[];
  for(let b=0;b<bloques.length;b++){
    const desdeFila=bloques[b][0], n=bloques[b][1]-desdeFila+1;
    const v=leerRango_(sh,desdeFila,1,n,nCols);
    for(let i=0;i<n;i++){
      if(fdate(v[i][colFecha-1])!==f) continue;    // los huecos tolerados cuelan filas de otro día
      filas.push({ _row:desdeFila+i, v:v[i] });
    }
  }
  return {h:h, filas:filas};
}

// Objetos con las claves del encabezado real — reemplazo directo de `readSheet(n).filter(r=>r.fecha===f)`.
function readSheetPorFecha_(name, fecha){
  const f=fdate(fecha), clave=name+'|obj|'+f;
  if(_memoRango.hasOwnProperty(clave)) return _memoRango[clave];
  const respaldo=function(){ return readSheet(name).filter(function(r){ return r.fecha===f; }); };
  // Si la hoja completa ya está en memoria de esta ejecución, filtrar de ahí no cuesta una celda.
  if(_memoHoja.hasOwnProperty(name)) return (_memoRango[clave] = respaldo());
  const sh=ss_().getSheetByName(name);
  if(!sh) return (_memoRango[clave] = []);
  const r=_crudasPorFecha_(sh, f, 0);
  if(r===null) return (_memoRango[clave] = respaldo());
  const out=r.filas.map(function(x){
    const o={}; r.h.forEach(function(k,j){ o[k]=x.v[j]; });
    o.fecha=fdate(o.fecha); o._row=x._row; return o;
  });
  return (_memoRango[clave] = out);
}

/* Filas CRUDAS del día (arrays) para el código que accede por ÍNDICE de columna en vez de por nombre
 * — los lectores de DATA, cuyo layout A–T es el espejo del maestro y se direcciona con `C.FECHA`,
 * `v[i][7]`, etc. Convertirlos a objetos sería reescribirlos; esto solo les cambia de dónde salen las
 * filas. `colFechaFija` es 1-based: en DATA la fecha es la col A. */
function filasCrudasPorFecha_(name, fecha, colFechaFija){
  const f=fdate(fecha), clave=name+'|crudo|'+f;
  if(_memoRango.hasOwnProperty(clave)) return _memoRango[clave];
  const sh=ss_().getSheetByName(name);
  if(!sh || sh.getLastRow()<2) return (_memoRango[clave] = []);
  const r=_crudasPorFecha_(sh, f, colFechaFija||0);
  if(r!==null) return (_memoRango[clave] = r.filas);
  // Respaldo: lectura completa, filtrada por la MISMA columna (mismo resultado, más celdas).
  const v=leerRango_(sh,1,1,sh.getLastRow(),sh.getLastColumn());
  const cf=(colFechaFija||0) || (v[0].map(function(k){ return String(k==null?'':k).trim(); }).indexOf('fecha')+1);
  const out=[];
  for(let i=1;i<v.length;i++) if(cf>0 && fdate(v[i][cf-1])===f) out.push({ _row:i+1, v:v[i] });
  return (_memoRango[clave] = out);
}

/* D107 — borrado quirúrgico, gemelo del de CodigoAsistencias.gs. `enviarData` ya borraba solo las
 * filas del día (no reescribía la hoja), pero lo hacía con `deleteRow` UNA A UNA: un día de 40 filas
 * eran 40 llamadas al servicio de Sheets. Agrupadas en tramos contiguos suelen ser 1 o 2. */
function borrarFilas_(sh, filas){
  if(!filas || !filas.length) return 0;
  const orden=filas.slice().sort(function(a,b){ return a-b; });
  const tramos=[]; let ini=orden[0], prev=orden[0];
  for(let i=1;i<orden.length;i++){
    if(orden[i]!==prev+1){ tramos.push([ini,prev]); ini=orden[i]; }
    prev=orden[i];
  }
  tramos.push([ini,prev]);
  for(let t=tramos.length-1;t>=0;t--) sh.deleteRows(tramos[t][0], tramos[t][1]-tramos[t][0]+1);
  return orden.length;
}
function buildDataRow(c, fecha, ts, reporta, rol, idC){
  // Ubicación (UF/PROYECTO/CC) derivada del PK con el helper único (Problema 2.12, D04).
  // ABS: con match a la BASE viene del elemento (K/L verbatim, D68); sin match, del PK (abajo).
  const mi = pkMeters(c.pk_inicial), mf = pkMeters(c.pk_final);
  // D69/D71: las filas de DRENAJES se arman en su propia rama (GRUPO/CAPITULO fijos, ELEMENTO por
  // marcador ODT o tramo, la red D66 NO las toca). El área manda por la columna `area` de la línea
  // (D71: la demolición de estructuras 01.02 es drenaje pero su CC deriva 'tierras'); si falta, se
  // deriva del CC como antes (06.*→ODT, 07.*→ODL) vía areaDeFila.
  const areaFila = areaDeFila(c.area, c.centro_costo);
  if(areaFila==='odt' || areaFila==='odl') return buildDataRowDrenajes(c, fecha, ts, reporta, rol, idC, areaFila, mi, mf);
  let uf = c.uf||'', proy = c.proyecto||'', cc = c.centro_costo||'';
  if(mi != null){                                   // D04: PK≤30→UF1/3701; >30→UF2/3702
    uf   = mi <= 30000 ? 'UF1' : 'UF2';
    proy = uf === 'UF1' ? '3701' : '3702';
    const cod = ccCorto(c.centro_costo);            // "02.05" -> reancla el proyecto correcto al CC
    cc = cod ? (proy + '.' + cod) : cc;
  }
  // D79: CONFORMACIÓN (02.08) — el DESTINO lo elige el residente en el panel del encargado
  // (c.destino_conf 'RCD'|'ZODME'; sin el campo — frontend viejo — cae a RCD, el comportamiento
  // que ya existía). El destino manda sobre el PK del origen: la fila se ancla al sitio de
  // disposición, no a donde se excavó. RCD → UF1/3701 (elemento "RCD 15+800"); ZODME → UF2/3702
  // (elemento "ZODME PK30"). ELEMENTO y ABS salen verbatim de la fila de la BASE de ese tipo (D68).
  const confDest = (ccCorto(c.centro_costo)==='02.08')
    ? (String(c.destino_conf||'').trim().toUpperCase()==='ZODME' ? 'ZODME' : 'RCD') : '';
  if(confDest){
    uf   = (confDest==='ZODME') ? 'UF2' : 'UF1';
    proy = (confDest==='ZODME') ? '3702' : '3701';
    cc   = proy + '.02.08';
  }
  // ELEMENTO oficial desde la hoja BASE (catálogo de elementos), eligiendo la FUENTE según la
  // actividad (D63): préstamo→EL DIVISO, estructuras/MSR→elemento MSR del PK, conformación→RCD,
  // resto (aprovechable/no aprovechable/terraplén/subbase/base)→tramo "tm2 pk X-Y" por abscisa. Con
  // match, el ELEMENTO es la celda J de la BASE TAL CUAL (verbatim; el maestro empareja por string
  // byte-idéntico, D68). Si no hay elemento para esa actividad/PK, se arma desde el PK con el helper
  // único (sin "Pk Pk") — buildElemento/pkNorm/pkMeters quedan SOLO para ese fallback. REVISAR queda
  // SÓLO para el caso legítimo (el PK no pertenece a ningún tramo del eje / falta el marcador).
  // D104: el cruce por abscisa recibe también el PK FINAL para anclarse en el PUNTO MEDIO del rango
  // (ver anclaCruce). Antes solo viajaba `mi`, así que el subtramo se decidía con el extremo inicial.
  const lk = lookupElemento(cc, c.descripcion, mi, confDest || null, mf);
  const pkElem = buildElemento(c.pk_inicial, c.pk_final);
  let elem = lk.elem ? lk.elem
           : lk.revisar ? ('REVISAR · ' + (pkElem || c.elemento || ('pk ' + (c.pk_inicial||''))))
           : (pkElem || c.elemento || '');
  // ABS INICIAL/FINAL (D68, enmienda D63b): con match, copian K/L del elemento emparejado VERBATIM
  // — el ABS refleja el subtramo completo, no el tramo puntual del día (pedido del jefe). Fallback
  // (sin match / PK fuera de tramo / REVISAR / celda K o L vacía en la BASE): ABS derivado del PK
  // como antes (D04). El PK reportado sigue intacto en las internas U–AA (pk_inicial/pk_final).
  let absIni = (lk.elem && lk.absIni!=null && lk.absIni!=='') ? lk.absIni
             : (mi != null ? mi : (c.abs_inicial!=null ? c.abs_inicial : ''));
  let absFin = (lk.elem && lk.absFin!=null && lk.absFin!=='') ? lk.absFin
             : (mf != null ? mf : (c.abs_final!=null ? c.abs_final : ''));
  /* D104 — OVERRIDE MANUAL DEL SUBTRAMO (`c.elemento_forzado`), mismo patrón que `destino_conf` (D79).
   * Lo manda el panel del encargado SOLO en las líneas donde el residente cambió el subtramo que
   * resolvió el automático. Existe porque hay un caso que el sistema NO puede resolver solo: que el
   * reporte de campo sea coherente en PK pero el subtramo lógico sea otro (por liberaciones); eso lo
   * tiene que ver un humano antes de escribir DATA.
   *   · Ausente o vacío -> automático de arriba (RETROCOMPATIBLE: payloads viejos no se rompen).
   *   · Con valor -> ELEMENTO y ABS INICIAL/FINAL VERBATIM de J/K/L de esa fila de la BASE (D68 intacta).
   *   · UF/proyecto/CC se re-derivan desde el ABS INICIO del subtramo forzado (D04/D63b), igual que en
   *     D79 el destino manda sobre el PK del origen. EN LA PRÁCTICA SOLO CAMBIA ALGO SI LA CORRECCIÓN
   *     CRUZA EL LÍMITE 30+000: dentro de la misma UF, UF/proyecto/CC quedan idénticos.
   *   · Si el elemento no existe en la BASE se IGNORA y la fila cae al automático — nunca se inventa
   *     un elemento. Queda el log para rastrearlo.
   *   · No se aplica a la conformación 02.08 (`confDest`): ese destino lo manda D79, y `lookupTramoPorNombre`
   *     además solo resuelve filas del conjunto TRAMO.
   *   · NO se persiste en BANDEJA (decisión explícita, opción B, mismo criterio que D79): la elección se
   *     hace al momento de enviar y un reenvío del día vuelve al automático. */
  const forz = (!confDest && c.elemento_forzado) ? lookupTramoPorNombre(c.elemento_forzado) : null;
  if(c.elemento_forzado && !confDest && !forz){
    Logger.log('D104: elemento_forzado sin match en la BASE, se ignora y la fila cae al automático — "'
      + c.elemento_forzado + '" (CC ' + cc + ', PK ' + (c.pk_inicial||'') + ')');
  }
  if(forz){
    elem   = forz.elem;                                                   // celda J verbatim
    absIni = (forz.rawIni!=null && forz.rawIni!=='') ? forz.rawIni : (forz.ini!=null ? forz.ini : '');
    absFin = (forz.rawFin!=null && forz.rawFin!=='') ? forz.rawFin : (forz.fin!=null ? forz.fin : '');
    if(forz.ini != null){                            // D04 sobre el ABS INICIO del subtramo forzado
      uf   = forz.ini <= 30000 ? 'UF1' : 'UF2';
      proy = uf === 'UF1' ? '3701' : '3702';
      const codF = ccCorto(cc);                      // D63b: reancla el proyecto al CC
      cc = codF ? (proy + '.' + codF) : cc;
    }
  }
  // DESCRIPCION verbatim de la tabla de ítems de la BASE, cruce por Centro de Coste (D68): la que
  // venía del catálogo interno del frontend llegaba a veces recortada respecto a la BASE y rompía
  // las dinámicas del maestro. Si el CC no está en la BASE, se conserva la descripción reportada.
  const desc = lookupDescripcion(cc, c.descripcion);
  // GRUPO: la BASE clasifica tanto tierras como estructuras/MSR bajo el grupo TIERRAS. Las filas de
  // estructuras (CC 05.*) llegaban de BANDEJA con "DRENAJES Y ESTRUCTURAS"; se corrige a TIERRAS aquí
  // (red de seguridad para lo ya guardado). El CAPITULO (ESTRUCTURAS) NO se toca: sigue siendo correcto.
  // OJO (D69): esta red aplica SOLO a filas de área tierras (MSR/05.*) — las de drenajes salieron
  // por buildDataRowDrenajes arriba y conservan su GRUPO "DRENAJES Y ESTRUCTURAS".
  let grupo = c.grupo||'';
  if(/estructura/i.test(grupo)) grupo='TIERRAS';
  return [ toDate(fecha), '', grupo, cc, c.capitulo||'', desc,
    uf, proy, elem, absIni, absFin,
    c.liberacion||'CAMPO', '', c.unidad||'', (c.largo!=null?c.largo:''), '', '', '', c.observacion||'', '',
    idC, ts, reporta||'', rol||'', c.actividad||'', c.pk_inicial||'', c.pk_final||'', 'tierras', c.clima||'' ];
}

/* ---------- DATA para DRENAJES (ODT / ODL) — D69 ----------
 * ODT: el ELEMENTO es el MARCADOR de obra (ODT1-xxx/ODT2-xxx/ODT3-xxx), copiado verbatim de la
 * celda J de la BASE; ABS INICIAL/FINAL = K/L del marcador verbatim (abscisa PUNTUAL: inicio=fin,
 * en metros). ODL: el ELEMENTO es el tramo "tm2 pk X - Y" por abscisa — MISMO cruce TRAMO de
 * tierras (lookupElemento; el CC 07.* cae al conjunto TRAMO por baseSetFor) — salvo que el capataz
 * haya elegido un marcador ODT (descole de una ODT): entonces ELEMENTO/ABS = los del marcador.
 * UF/PROYECTO se derivan de la abscisa ancla (PK reportado, o la del marcador si no hay PK) por
 * D04 y el proyecto se re-ancla al CC (D63b). GRUPO fijo "DRENAJES Y ESTRUCTURAS" (la red D66 no
 * aplica aquí); CAPITULO fijo por área; LIBERACION=CAMPO. DESCRIPCION verbatim de la BASE por CC
 * (D68) — incluye el typo real "…sin clasicar" y el sufijo " ODL": NO corregirlos (pivotes del
 * maestro). Sin ZODME automático ni derivadas: cantidades directas en la unidad contractual. */
function buildDataRowDrenajes(c, fecha, ts, reporta, rol, idC, area, mi, mf){
  const mk = lookupMarcadorODT(c.elemento);
  const ancla = (mi!=null) ? mi : (mk ? mk.ini : null);
  let uf=c.uf||'', proy=c.proyecto||'', cc=c.centro_costo||'';
  if(ancla!=null){                                   // D04: ≤30000 m → UF1/3701; >30000 → UF2/3702
    uf   = ancla<=30000 ? 'UF1' : 'UF2';
    proy = uf==='UF1' ? '3701' : '3702';
    const cod=ccCorto(c.centro_costo);               // re-ancla el proyecto correcto al CC (D63)
    cc = cod ? (proy+'.'+cod) : cc;
  }
  let elem='', absIni='', absFin='';
  if(area==='odt' || mk){
    // marcador ODT: obligatorio en ODT; opcional en ODL (descole)
    if(mk){
      elem=mk.elem;                                  // celda J verbatim
      absIni=(mk.rawIni!=null && mk.rawIni!=='') ? mk.rawIni : (ancla!=null?ancla:'');
      absFin=(mk.rawFin!=null && mk.rawFin!=='') ? mk.rawFin : absIni;
    } else {                                         // ODT sin marcador reconocible -> revisión humana
      elem='REVISAR · '+(c.elemento || buildElemento(c.pk_inicial,c.pk_final) || ('pk '+(c.pk_inicial||'')));
      absIni=(mi!=null) ? mi : (c.abs_inicial!=null ? c.abs_inicial : '');
      absFin=(mf!=null) ? mf : (c.abs_final!=null ? c.abs_final : '');
    }
  } else {
    // ODL por tramo: mismo flujo que tierras (cruce por abscisa contra los tramos "tm2 pk X - Y")
    // D104: hereda el semiabierto [ini,fin) y el ancla por PUNTO MEDIO del rango (se pasa `mf`), por
    // ser el MISMO conjunto TRAMO. El override `elemento_forzado` NO aplica aquí: el selector de
    // subtramo vive en el panel del encargado de tierras; `residente-drenajes.html` no lo tiene.
    const lk=lookupElemento(cc, c.descripcion, mi, null, mf);
    const pkElem=buildElemento(c.pk_inicial, c.pk_final);
    elem = lk.elem ? lk.elem
         : lk.revisar ? ('REVISAR · '+(pkElem || c.elemento || ('pk '+(c.pk_inicial||''))))
         : (pkElem || c.elemento || '');
    absIni=(lk.elem && lk.absIni!=null && lk.absIni!=='') ? lk.absIni : (mi!=null ? mi : (c.abs_inicial!=null?c.abs_inicial:''));
    absFin=(lk.elem && lk.absFin!=null && lk.absFin!=='') ? lk.absFin : (mf!=null ? mf : (c.abs_final!=null?c.abs_final:''));
  }
  const desc=lookupDescripcion(cc, c.descripcion);
  // CAPITULO fijo por área para los ítems .06/.07; pero un ítem "extra" del área (D71: DEMOLICIÓN DE
  // ESTRUCTURAS, capítulo DEMOLICIONES Y REUBICACIONES) trae su propio capítulo verbatim. Se honra
  // c.capitulo SOLO cuando NO es el "DRENAJE …" por defecto (red de seguridad para frontends viejos).
  const capDefault = (area==='odt') ? 'DRENAJE TRANSVERSAL' : 'DRENAJE LONGITUDINAL';
  const capitulo = (c.capitulo && !/^\s*drenaje/i.test(String(c.capitulo))) ? c.capitulo : capDefault;
  return [ toDate(fecha), '', 'DRENAJES Y ESTRUCTURAS', cc, capitulo, desc,
    uf, proy, elem, absIni, absFin,
    c.liberacion||'CAMPO', '', c.unidad||'', (c.largo!=null?c.largo:''), '', '', '', c.observacion||'', '',
    idC, ts, reporta||'', rol||'', c.actividad||'', c.pk_inicial||'', c.pk_final||'', area, c.clima||'' ];
}
// Marcador ODT de la tabla de elementos de la BASE por su nombre (cruce tolerante con normTexto,
// que NUNCA altera lo que se escribe: el elem devuelto es la celda J cruda). null si no calza.
function lookupMarcadorODT(nombre){
  const n=normTexto(nombre);
  if(!n || n.indexOf('ODT')!==0) return null;
  const rows=getBaseRows();
  for(let i=0;i<rows.length;i++){
    if(rows[i].tipo==='ODT' && normTexto(rows[i].elem)===n) return rows[i];
  }
  return null;
}

/* ---------- ELEMENTO + PK: helper único (Problema 2.12) ----------
 * Un solo lugar arma el ELEMENTO y normaliza el PK (misma lógica en backend y en los HTML).
 *   - un solo PK:  "tm2 pk NN+NNN"
 *   - con final:   "tm2 pk NN+NNN - NN+NNN"
 * Nunca duplica el token "pk"/"Pk": lo quita antes de anteponer "tm2 pk". Si el PK final viene
 * embebido en el campo inicial ("20+830 - 20+800") lo separa. Devuelve '' si no hay PK legible.
 * pkMeters() tolera "20+875", "Pk 20+875", espacios y el prefijo pk; un número suelto = kilómetro. */
function pkMeters(s){
  if(s==null) return null;
  const t=String(s).toLowerCase().replace(/pk/g,'').replace(/\s+/g,'');
  const m=t.match(/(\d+)\+(\d+)/);
  if(m) return parseInt(m[1],10)*1000 + parseInt(m[2],10);
  const n=parseFloat(t);
  return isNaN(n) ? null : n*1000;
}
function pkFmt(meters){
  if(meters==null || isNaN(meters)) return '';
  const km=Math.floor(meters/1000), r=Math.round(meters-km*1000);
  return km + '+' + ('00'+r).slice(-3);
}
function pkNorm(s){ return pkFmt(pkMeters(s)); }
function buildElemento(pkIni, pkFin){
  let ini=pkIni, fin=pkFin;
  if((fin==null||fin==='') && pkIni!=null){           // rango tecleado en un solo campo
    const p=String(pkIni).split(/\s*-\s*/);
    if(p.length>=2){ ini=p[0]; fin=p.slice(1).join(' - '); }
  }
  const a=pkNorm(ini);
  if(!a) return '';                                    // sin PK válido: el llamador decide
  const b=pkNorm(fin);
  return b ? ('tm2 pk '+a+' - '+b) : ('tm2 pk '+a);
}

/* ---------- BASE: ELEMENTO oficial, fuente por ACTIVIDAD (D63) + copias verbatim (D68) ----------
 * La hoja BASE (mismo Sheet) tiene VARIAS tablas lado a lado (ítems, elementos, liberación, acta…),
 * alineadas por fila sólo por accidente — NO es una sola tabla. La de elementos vive en J/K/L:
 * J=ELEMENTO, K=ABSCISA INICIO, L=ABSCISA FIN. Por eso NO se cruza por la descripción/CC de la tabla
 * de ítems (es OTRA tabla); el ELEMENTO se elige según la ACTIVIDAD del reporte y se cruza por abscisa.
 *
 * Tipos de elemento en esa tabla y a qué actividad pertenecen (confirmado por el usuario):
 *   - TRAMO  "tm2 pk X - Y"  → explanaciones/bases: excavación aprovechable y NO aprovechable,
 *                              terraplén, subbase, base. Parten el eje (9+800→39+560) por abscisa.
 *   - DIVISO "EL DIVISO"     → excavación de PRÉSTAMO (CC 02.06).
 *   - MSR    "MSR …"         → estructuras / MSR (CC 05.* y 02.12); por abscisa entre las MSR.
 *   - RCD    "RCD …"         → conformación / disposición (CC 02.08) con destino RCD (default).
 *   - ZODME  "ZODME PK30"    → conformación / disposición (CC 02.08) con destino ZODME. El DESTINO
 *                              lo elige el residente por línea en el panel del encargado (D79):
 *                              RCD → 3701/UF1, ZODME → 3702/UF2; ELEMENTO/ABS del marcador verbatim.
 *   - ODT*   (drenajes)      → FUERA de alcance (V1, D22). Se ignoran; comparten PK con los tramos.
 * REVISAR sólo para el caso legítimo: el PK no pertenece a ningún tramo del eje, o falta el marcador. */
const BASE_TOL_M = 30; // metros de tolerancia para ajustar un PK cercano a un tramo (error humano)
let _baseRows, _baseItems, _baseItemCols, _baseDrenItems;
// Abscisa de la BASE a metros: número = metros tal cual; texto con '+' = PK ("20+875"→20875).
function baseAbs(v){
  if(v===''||v==null) return null;
  if(typeof v==='number') return isNaN(v)?null:v;
  const s=String(v).trim();
  if(s.indexOf('+')>=0) return pkMeters(s);
  const n=Number(s);
  return isNaN(n)?null:n;
}
// Tipo de un elemento de la BASE por su texto. '' = fuera de alcance.
// D69: los marcadores ODT* (drenajes) ahora se cachean con tipo propio 'ODT' — los usan SOLO las
// filas de área ODT/ODL (lookupMarcadorODT). En tierras se siguen ignorando: ningún baseSetFor
// devuelve 'ODT', así que el cruce por abscisa de tierras nunca los ve (D63 intacta).
function baseTipo(elem){
  const e=String(elem==null?'':elem);
  if(/^\s*tm2\s*pk/i.test(e)) return 'TRAMO';
  if(/diviso/i.test(e))       return 'DIVISO';
  if(/^\s*msr/i.test(e))      return 'MSR';
  if(/^\s*rcd/i.test(e))      return 'RCD';
  if(/zodme/i.test(e))        return 'ZODME';   // conformación con destino ZODME (elige el residente, D79)
  if(/^\s*odt/i.test(e))      return 'ODT';     // marcadores de drenajes (abscisa puntual, D69)
  return '';                                     // demás -> fuera
}
// Conjunto de elementos a usar según el CC corto de la actividad (NN.NN).
function baseSetFor(ccCortoStr){
  const c=String(ccCortoStr||'');
  if(c==='02.06') return 'DIVISO';                       // excavación de préstamo
  if(c.indexOf('05.')===0 || c==='02.12') return 'MSR';  // estructuras / MSR
  if(c==='02.08') return 'RCD';                          // conformación/disposición (default; destino ZODME se fuerza vía setForzado, D79)
  return 'TRAMO';                                        // aprovechable/no aprovechable/terraplén/subbase/base
}
// Normaliza texto SOLO para comparar (nunca para escribir): mayúsculas, sin tildes, espacios raros
// (nbsp/ancho cero) colapsados. Lo que se escribe en DATA es siempre el valor crudo de la celda.
function normTexto(s){
  return String(s==null?'':s)
    .replace(/[\u00A0\u2007\u202F\u200B\u200C\u200D\uFEFF]/g,' ')   // nbsp / ancho-cero / BOM -> espacio
    .toUpperCase()
    .replace(/[ÁÀÂÄ]/g,'A').replace(/[ÉÈÊË]/g,'E').replace(/[ÍÌÎÏ]/g,'I')
    .replace(/[ÓÒÔÖ]/g,'O').replace(/[ÚÙÛÜ]/g,'U').replace(/Ñ/g,'N')
    .replace(/\s+/g,' ').trim();
}
// Una sola pasada por la BASE llena ambos cachés: la tabla de ELEMENTOS (J/K/L, conservando K/L
// CRUDOS para copiarlos verbatim a ABS, D68) y la tabla de ÍTEMS (A–H: Centro de Coste →
// DESCRIPCION verbatim, D68). La BASE real trae una fila de NUMERACIÓN (1,2,3…) encima de los
// encabezados, así que la fila de encabezados de la tabla de ítems se BUSCA en las primeras filas
// (la primera que tenga CC y DESCRIPCION dentro de A–H); los ítems empiezan en la fila siguiente.
// Si no se encuentra, el mapa queda vacío y DESCRIPCION cae al valor reportado. La tabla de
// elementos no depende de encabezados: filtra por el contenido de J (baseTipo).
function getBaseData(){
  if(_baseRows) return;
  _baseRows = []; _baseItems = {}; _baseDrenItems = [];
  const drenSeen = {};
  const ss = ss_(), sh = ss.getSheetByName('BASE');
  if(!sh || sh.getLastRow() < 2) return;
  const v = sh.getDataRange().getValues();
  let ccCol=-1, dCol=-1, uCol=-1, hRow=-1;                // tabla de ítems: fila de encabezados + CC y DESCRIPCION en A–H
  for(let r=0; r<Math.min(5, v.length) && hRow<0; r++){
    let c1=-1, c2=-1, c3=-1;
    for(let j=0;j<Math.min(8, v[r].length);j++){
      const k=normTexto(v[r][j]);
      if(c1<0 && (k==='CC' || k.indexOf('CENTRO')>=0 || k.indexOf('COSTO')>=0 || k.indexOf('COSTE')>=0)) c1=j;
      else if(c2<0 && k.indexOf('DESCRIPCION')>=0) c2=j;
      // unidad contractual del ítem (D69, para el catálogo de drenajes); se evita "UNIDAD FUNCIONAL"
      else if(c3<0 && (k==='UND' || k==='UM' || (k.indexOf('UNIDAD')>=0 && k.indexOf('FUNCIONAL')<0))) c3=j;
    }
    if(c1>=0 && c2>=0){ ccCol=c1; dCol=c2; uCol=c3; hRow=r; }  // CC y DESCRIPCION en la MISMA fila = encabezados
  }
  _baseItemCols={ cc:ccCol, desc:dCol, unidad:uCol, filaEnc:hRow+1 };  // expuesto para diagnosticoBase()
  for(let i=1;i<v.length;i++){
    // --- tabla de ELEMENTOS (J/K/L) ---
    const elem=v[i][9];                                   // J = ELEMENTO
    if(elem!=='' && elem!=null){
      const tipo=baseTipo(elem);
      if(tipo){                                           // ODT/drenajes y otros -> fuera
        let ini=baseAbs(v[i][10]), fin=baseAbs(v[i][11]); // K = ABS INICIO, L = ABS FIN (a metros, para el match)
        if(fin==null) fin=ini;
        if(ini==null) ini=fin;
        if(ini!=null && fin!=null && fin<ini){ const t=ini; ini=fin; fin=t; }
        // rawIni/rawFin: celdas K/L TAL CUAL (sin normalizar ni reordenar), para copiar a ABS (D68)
        _baseRows.push({ elem:String(elem), ini:ini, fin:fin, tipo:tipo, rawIni:v[i][10], rawFin:v[i][11] });
      }
    }
    // --- tabla de ÍTEMS (A–H): CC -> DESCRIPCION verbatim (solo DESPUÉS de la fila de encabezados) ---
    if(ccCol>=0 && dCol>=0 && i>hRow){
      const ccKey=String(v[i][ccCol]==null?'':v[i][ccCol]).trim();
      const d=v[i][dCol];
      if(ccKey && d!=='' && d!=null){
        const it={ desc:d, norm:normTexto(d) };           // desc = celda cruda; norm solo para comparar
        (_baseItems[ccKey]=_baseItems[ccKey]||[]).push(it);
        const corto=ccCorto(ccKey);                       // registra también la llave corta "NN.NN"
        if(corto && corto!==ccKey) (_baseItems[corto]=_baseItems[corto]||[]).push(it);
        // catálogo de DRENAJES (D69): TODOS los ítems .06.* (ODT) y .07.* (ODL), por proyecto,
        // con la descripción verbatim de la celda (typos incluidos) y la unidad si la tabla la trae.
        const areaIt=deriveArea(ccKey);
        if(areaIt!=='tierras'){
          const u=(uCol>=0 && v[i][uCol]!=null) ? String(v[i][uCol]).trim() : '';
          const dk=ccKey+'|'+it.norm;
          if(!drenSeen[dk]){ drenSeen[dk]=1;
            _baseDrenItems.push({ cc:ccKey, corto:corto||ccKey, area:areaIt, desc:String(d), unidad:u }); }
          // D113c: variantes por MATERIAL del mismo ítem (mismo CC/desc/unidad, distinta `actividad`).
          // Van como opciones aparte del catálogo; sin `actividad` la entrada es el ítem "normal".
          const vars = corto ? VARIANTES_DREN[corto] : null;
          if(vars) vars.forEach(function(nombreAct){
            const vk=dk+'|'+nombreAct;
            if(!drenSeen[vk]){ drenSeen[vk]=1;
              _baseDrenItems.push({ cc:ccKey, corto:corto||ccKey, area:areaIt, desc:String(d), unidad:u,
                                    actividad:nombreAct, variante:true }); }
          });
        } else if(corto && EXTRA_DREN[corto]){
          // Ítems "extra" de drenajes (D71): viven bajo un CC que deriva 'tierras' pero deben ofrecerse
          // en los reportes de drenajes con su propio capítulo. Se sirven en el catálogo para cada área
          // configurada; el frontend filtra por área y reenvía capítulo+area (el backend re-verifica).
          const cfg=EXTRA_DREN[corto];
          const u=(uCol>=0 && v[i][uCol]!=null) ? String(v[i][uCol]).trim() : '';
          cfg.areas.forEach(ar=>{
            const dk=ar+'|'+ccKey+'|'+it.norm;
            if(!drenSeen[dk]){ drenSeen[dk]=1;
              _baseDrenItems.push({ cc:ccKey, corto:corto, area:ar, desc:String(d), unidad:u, capitulo:cfg.capitulo, extra:true }); }
          });
        }
      }
    }
  }
}
function getBaseRows(){ getBaseData(); return _baseRows; }
function getBaseItems(){ getBaseData(); return _baseItems; }

/* ---------- catálogo de drenajes para los frontends (D69) ----------
 * GET ?action=drenajes -> { ok, marcadores:[{elemento,abs,pk}], items:[{cc,corto,area,desc,unidad}] }
 * - marcadores: las filas ODT* de la tabla de elementos (J/K/L) de la BASE — abscisa PUNTUAL en
 *   metros (K; si K vacía, L) y su PK formateado, para el selector del capataz ODT (y el descole ODL).
 * - items: TODOS los ítems .06.* (ODT) y .07.* (ODL) de la tabla de ítems de la BASE, por proyecto,
 *   con la DESCRIPCION verbatim (los frontends la reenvían tal cual; el backend re-verifica con
 *   lookupDescripcion al armar DATA). Incluye los "box abovedados" aunque no se usen.
 * Es la única vía por la que las pantallas (GitHub Pages, estáticas) conocen la BASE: no pueden
 * leer el Sheet directamente ni el catálogo vive en el repo. Solo lectura. */
function drenajesCatalogo(){
  const marcadores=getBaseRows().filter(r=>r.tipo==='ODT')
    .map(r=>({ elemento:r.elem, abs:(r.ini!=null?r.ini:''), pk:pkFmt(r.ini) }));
  getBaseData();
  return json({ ok:true, marcadores:marcadores, items:_baseDrenItems||[] });
}

/* ---------- acumulado oficial de drenajes (pedido ODT, D70) ----------
 * GET ?action=acumulado_drenajes[&area=odt|odl] -> { ok, acumulado:{ "ELEMENTO||CCcorto": cantidad } }
 * Suma la CANTIDAD (LARGO, col O/14) de DATA por ELEMENTO (col I/8) + CC corto (col D/3), SOLO para
 * filas de drenajes (deriveArea != tierras). Sirve para que el capataz ODT vea cuánto acero lleva
 * reportado en una ODT (marcador) antes de sumar lo del día. Es el consolidado OFICIAL: solo lo que
 * ya está en DATA (no lo pendiente en BANDEJA). DATA conserva el histórico completo (enviar_data solo
 * pisa el día+área que se reenvía), así que la suma sobre todas las fechas = acumulado real. Solo lee. */
function acumuladoDrenajes(e){
  const areaQ=String((e&&e.parameter&&e.parameter.area)||'').trim().toLowerCase();
  const ss=ss_(), sh=ss.getSheetByName('DATA');
  const acum={};
  if(sh && sh.getLastRow()>1){
    const v=sh.getDataRange().getValues();
    for(let i=1;i<v.length;i++){
      const cc=v[i][3], area=deriveArea(cc);
      if(area==='tierras') continue;
      if(areaQ && area!==areaQ) continue;
      const elem=String(v[i][8]==null?'':v[i][8]).trim(); if(!elem) continue;
      const val=parseFloat(v[i][C.LARGO]); if(isNaN(val)) continue;
      const key=elem+'||'+ccCorto(cc);
      acum[key]=(acum[key]||0)+val;
    }
  }
  return json({ ok:true, area:areaQ, acumulado:acum });
}
// DESCRIPCION oficial (verbatim) de la tabla de ítems de la BASE por Centro de Coste (D68).
// Llave exacta primero ("3701.02.05") y corta después ("02.05"). Si un CC tiene varios ítems:
//   1) separa por el discriminante "NO APRO" (02.05 aprovechable vs no aprovechable, mismo
//      criterio que bucketDeData);
//   2) entre los que quedan, gana el candidato MÁS COMPLETO cuyo texto empiece por el reportado
//      (la BASE puede traer el ítem recortado Y el completo bajo el mismo CC: con igualdad exacta
//      ganaba el recortado, p. ej. "Conformación y disposición de sobrantes" vs "… (incluye obras
//      de adecuación)"); la igualdad exacta es un caso particular de este prefijo.
// Sin ítem en la BASE -> se conserva la descripción reportada (fallback sin match).
function lookupDescripcion(cc, descripcion){
  const items=getBaseItems();
  const cand=items[String(cc==null?'':cc).trim()] || items[ccCorto(cc)];
  if(!cand || !cand.length) return descripcion||'';
  if(cand.length===1) return cand[0].desc;
  const n=normTexto(descripcion);
  const noApro = n.indexOf('NO APRO')>=0;
  let pool=cand.filter(it=> (it.norm.indexOf('NO APRO')>=0)===noApro );
  if(!pool.length) pool=cand;
  let best=null;
  pool.forEach(it=>{ if(n && it.norm.indexOf(n)===0 && (!best || it.norm.length>best.norm.length)) best=it; });
  return best ? best.desc : pool[0].desc;
}
// Número o null (tolera '', null, undefined y no-numéricos). Usado por el ancla del cruce (D104).
function numOrNull(v){
  if(v===''||v==null||isNaN(Number(v))) return null;
  return Number(v);
}
/* Ancla del cruce por abscisa (D104, enmienda D63a).
 * Cuando la fila trae PK inicial Y final válidos y DISTINTOS (frentes del capataz), el cruce se hace
 * con el PUNTO MEDIO del rango — nunca con un extremo. Motivo (mismo criterio ya fijado en backlog
 * 2.1): los rangos vienen sucios (invertidos, con typos) y anclar en un extremo manda la línea al
 * subtramo vecino. Se ordena antes de promediar, así un rango invertido (38+500–35+800) da el mismo
 * centro que el correcto. Con un solo PK se usa ese.
 * SOLO aplica al conjunto TRAMO: los marcadores MSR son PUNTUALES y se emparejan por cercanía al PK
 * reportado (promediar un rango los correría fuera de la tolerancia), así que ahí se conserva el
 * ancla de siempre = PK inicial. Antes de D104 TODO el cruce usaba el PK inicial: `pk_final` llegaba a
 * `buildDataRow` pero no participaba del emparejamiento. */
function anclaCruce(mIni, mFin, set){
  const a=numOrNull(mIni), b=numOrNull(mFin);
  if(set!=='TRAMO') return (a!=null) ? a : b;
  if(a!=null && b!=null && a!==b) return (Math.min(a,b)+Math.max(a,b))/2;
  return (a!=null) ? a : b;
}
// -> { elem:'<ELEMENTO>'|'' , revisar:true|false , absIni , absFin }
// elem = celda J verbatim; absIni/absFin = celdas K/L verbatim del elemento emparejado (D68).
// En los retornos sin match, absIni/absFin quedan undefined y buildDataRow deriva ABS del PK.
// setForzado (D79): fuerza el conjunto de la BASE ('RCD'|'ZODME') sin mirar el CC — lo usa la
// conformación 02.08, cuyo destino elige el residente en el panel del encargado.
// pkMetersFin (D104): PK final del rango reportado, para anclar el cruce en el PUNTO MEDIO (ver
// anclaCruce). Opcional — sin él el comportamiento es el de antes (ancla = PK inicial).
function lookupElemento(cc, descripcion, pkMetersIn, setForzado, pkMetersFin){
  const all=getBaseRows();
  if(!all.length) return { elem:'', revisar:false };
  const set=setForzado || baseSetFor(ccCorto(cc));
  const rows=all.filter(r=>r.tipo===set);
  // DIVISO / RCD / ZODME: marcador ligado a la ACTIVIDAD/DESTINO (no al PK) -> se devuelve directo.
  if(set==='DIVISO' || set==='RCD' || set==='ZODME'){
    return rows.length ? { elem:rows[0].elem, revisar:false, absIni:rows[0].rawIni, absFin:rows[0].rawFin }
                       : { elem:'', revisar:true };
  }
  // TRAMO / MSR: por abscisa dentro del conjunto.
  if(!rows.length) return { elem:'', revisar:false };     // sin filas de ese tipo -> respaldo PK
  const pk=anclaCruce(pkMetersIn, pkMetersFin, set);      // D104: punto medio del rango en TRAMO
  if(pk==null) return { elem:'', revisar:false };
  // 1) PK dentro de un tramo (sin solape → uno solo; si lo hubiera, gana el de rango más angosto).
  // D104 — INTERVALO SEMIABIERTO [ABS_INICIO, ABS_FIN) para el conjunto TRAMO: un PK que cae EXACTO en
  // la frontera entre dos subtramos pertenece al que EMPIEZA ahí, no al que termina (14+200 es del
  // "14+200 – 14+800", no del "12+800 – 14+200"). Mismo criterio que la ventana [fecha_ingreso,
  // fecha_retiro) de D72(c). Antes ambos extremos eran cerrados: el PK de frontera empataba con DOS
  // subtramos y el desempate quedaba en manos del ancho del rango y, a igual ancho, del ORDEN FÍSICO
  // de las filas en la hoja BASE — es decir, por accidente. Dos excepciones al semiabierto:
  //   · el ÚLTIMO tramo del eje se compara CERRADO en el extremo final (<=), para que 39+560 no
  //     quede fuera de todo tramo;
  //   · una fila TRAMO degenerada (ini===fin) se compara cerrada, o no emparejaría nunca.
  // MSR conserva el cerrado-cerrado de siempre: sus marcadores son puntuales (ini===fin) y con
  // semiabierto dejarían de emparejar (por eso el cambio va gateado por `set`).
  let hits;
  if(set==='TRAMO'){
    let finMax=null;
    rows.forEach(function(r){ if(r.fin!=null && (finMax==null || r.fin>finMax)) finMax=r.fin; });
    hits=rows.filter(function(r){
      if(r.ini==null || r.fin==null || pk<r.ini) return false;
      const cerrado = (r.fin===finMax) || (r.fin===r.ini);   // último tramo del eje / fila degenerada
      return cerrado ? (pk<=r.fin) : (pk<r.fin);
    });
  } else {
    hits=rows.filter(function(r){ return r.ini!=null && r.fin!=null && pk>=r.ini && pk<=r.fin; });
  }
  if(hits.length){
    hits.sort((a,b)=>(a.fin-a.ini)-(b.fin-b.ini));
    return { elem:hits[0].elem, revisar:false, absIni:hits[0].rawIni, absFin:hits[0].rawFin };
  }
  // 2) PK cercano (error humano): ajustar al tramo más próximo dentro de la tolerancia
  let best=null, bestD=Infinity;
  rows.forEach(r=>{ if(r.ini==null||r.fin==null) return;
    const d = pk<r.ini ? (r.ini-pk) : (pk-r.fin);
    if(d<bestD){ bestD=d; best=r; } });
  if(best && bestD<=BASE_TOL_M) return { elem:best.elem, revisar:false, absIni:best.rawIni, absFin:best.rawFin };
  // 3) el PK no pertenece a ningún tramo/zona del conjunto -> revisión humana
  return { elem:'', revisar:true };
}

/* ---------- override manual del SUBTRAMO (D104) ----------
 * Busca una fila del conjunto TRAMO en la tabla de elementos de la BASE por su texto. Cruce tolerante
 * con normTexto (que NUNCA altera lo que se escribe: se devuelve la fila con J/K/L crudas, D68).
 * SOLO TRAMO, a propósito: el override del residente corrige SUBTRAMOS liberados, no marcadores — así
 * un payload no puede saltarse el destino de conformación que elige el residente (D79: RCD/ZODME) ni
 * el marcador ODT de drenajes (D70) mandando un `elemento_forzado` de ese tipo. null si no calza. */
function lookupTramoPorNombre(nombre){
  const n=normTexto(nombre);
  if(!n) return null;
  const rows=getBaseRows();
  for(let i=0;i<rows.length;i++){
    if(rows[i].tipo==='TRAMO' && normTexto(rows[i].elem)===n) return rows[i];
  }
  return null;
}

/* ---------- catálogo de SUBTRAMOS para los frontends (D104) ----------
 * GET ?action=tramos -> { ok, tramos:[{elemento, abs_inicio, abs_fin, pk_inicio, pk_fin, pk}] }
 * Mismo patrón que ?action=drenajes (D70f): las pantallas son estáticas (GitHub Pages) y no pueden
 * leer el Sheet, así que esta es la única vía por la que conocen los subtramos del eje.
 * Devuelve SOLO el conjunto TRAMO ("tm2 pk X - Y"), ordenado por abscisa. NO devuelve puntuales
 * (EL DIVISO, MSR…, RCD 15+800, ZODME PK30) ni los marcadores ODT de drenajes.
 *   - elemento    : celda J VERBATIM (es la llave que el panel reenvía como `elemento_forzado`; el
 *                   backend la vuelve a buscar en la BASE, así que debe viajar tal cual).
 *   - abs_inicio/abs_fin : K/L normalizadas a METROS (para que el frontend calcule fronteras/avisos).
 *   - pk_inicio/pk_fin/pk: PK formateado para mostrar ("14+200", "12+800 – 14+200").
 * Solo lectura. */
function tramosCatalogo(){
  const tramos=getBaseRows()
    .filter(function(r){ return r.tipo==='TRAMO' && r.ini!=null && r.fin!=null; })
    .map(function(r){ return { elemento:r.elem, abs_inicio:r.ini, abs_fin:r.fin,
                               pk_inicio:pkFmt(r.ini), pk_fin:pkFmt(r.fin),
                               pk:pkFmt(r.ini)+' – '+pkFmt(r.fin) }; })
    .sort(function(a,b){ return (a.abs_inicio-b.abs_inicio) || (a.abs_fin-b.abs_fin); });
  return json({ ok:true, tramos:tramos });
}

/* ---------- CUBICAJE: cubicaje real por placa (D53 / 2.10) ----------
 * Hoja CUBICAJE (mismo Sheet): placa · cubicaje [· tipo]. Devuelve un mapa
 * placa(6 chars normalizada) -> cubicaje (m³/viaje). La placa se normaliza EXACTAMENTE
 * igual que el parser de D48 (sin espacios ni guion, MAYÚSCULAS, últimos 6 alfanuméricos)
 * para que el cruce con las placas que teclea la chequeadora calce. Si la hoja no existe,
 * está vacía o un valor es inválido, esa placa simplemente no entra al mapa (todo cae al
 * fallback del factor editable, 14 por defecto). */
function normPlaca(s){ return String(s==null?'':s).replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(-6); }
let _cubMap;
function getCubicajeMap(){
  if(_cubMap) return _cubMap;
  _cubMap = {};
  const ss=ss_(), sh=ss.getSheetByName('CUBICAJE');
  if(!sh || sh.getLastRow()<2) return _cubMap;
  const v=sh.getDataRange().getValues(), h=v[0];
  // ubica columnas por nombre de cabecera (tolerante); por defecto A=placa, B=cubicaje
  let pi=0, ci=1;
  for(let j=0;j<h.length;j++){
    const k=String(h[j]==null?'':h[j]).toLowerCase().trim();
    if(k.indexOf('placa')>=0) pi=j;
    else if(k.indexOf('cubicaje')>=0 || k.indexOf('m3')>=0 || k.indexOf('m³')>=0) ci=j;
  }
  for(let i=1;i<v.length;i++){
    const placa=normPlaca(v[i][pi]);
    const cub=parseFloat(v[i][ci]);
    if(placa && !isNaN(cub) && cub>0) _cubMap[placa]=cub;
  }
  return _cubMap;
}

/* Digitadora de volquetas (D83, backlog 2.22): SOLO LECTURA de la hoja VOLQUETAS por fecha.
 * Le entrega a la pantalla digitadora.html las líneas placa→destino ya capturadas por la
 * chequeadora (guía) para que ella pre-llene la BASE de transporte. No escribe NADA (Opción A,
 * §3.2 del prompt): ni DATA, ni BANDEJA, ni MAQUINARIA, ni una hoja nueva. La remisión y la
 * empresa siguen viviendo fuera de la app (D53 / backlog 2.7). Fecha por DUCK-TYPING (fdate,
 * §0: typeof v.getFullYear==='function', NUNCA instanceof Date). Sin filas ese día -> {filas:[]}
 * (no es error). */
function volquetasDelDia(e){
  const fecha = fdate((e && e.parameter && e.parameter.fecha) || '');
  const ss = ss_(), sh = ss.getSheetByName('VOLQUETAS');
  if(!sh || sh.getLastRow() < 2) return json({ok:true, fecha:fecha, filas:[]});
  // D107: las filas ya vienen ACOTADAS al día y como objetos con las claves del encabezado REAL de la
  // hoja — que es exactamente la tolerancia al orden/columnas extra que daba el mapa `col` de antes
  // (la hoja la mantiene el usuario, D53/D100). Una columna que no exista queda `undefined` y cae al
  // mismo valor por defecto que daba el `get()` anterior. El filtro por fecha ya lo aplicó el lector.
  const filas = readSheetPorFecha_('VOLQUETAS', fecha).map(function(r){
    return {
      id_registro:     String(r.id_registro||''),
      reporta:         String(r.reporta||''),
      origen:          String(r.origen||''),
      destino:         String(r.destino||''),
      tipo_destino:    String(r.tipo_destino||''),
      uf:              String(r.uf||''),
      placa:           String(r.placa||''),
      viajes:          Number(r.viajes)||0,
      cubicaje:        Number(r.cubicaje)||0,
      cubicaje_origen: String(r.cubicaje_origen||'')
    };
  });
  return json({ok:true, fecha:fecha, filas:filas});
}

/* ---------- routing ---------- */
function doGet(e){
  _t0 = Date.now();   // D100: siembra el cronómetro de servidor (`_ms` en la respuesta)
  const a=((e.parameter.action)||'').toLowerCase();
  // D159: ÚNICA lectura pública, y va ANTES de la puerta. El tablero de producción se comparte por
  // enlace con los directivos, que no tienen usuario en la plataforma y no traen token. Devuelve
  // solo la foto YA PUBLICADA —producción, horas de máquina y avance—, nunca datos de personas, y
  // no escribe nada. Publicarla sigue pidiendo token y rol (tablero_guardar), que es lo que de
  // verdad hay que guardar.
  if(a==='tablero')     return tableroLeer();
  // D165 (V3-01): Parte Digital de Maquinaria — módulo aparte (CodigoParte.gs). Se despacha ANTES de
  // la puerta porque el formulario del operador no tiene login (la identidad es el equipo del QR);
  // dentro, las operaciones de revisión (bandeja/base) SÍ pasan por sesion_() y exigen rol.
  if(String(e.parameter.mod||'').toLowerCase()==='parte') return parteDoGet_(e);
  // D109: puerta única. La identidad sale del TOKEN y sobrescribe lo que venga en la petición, así
  // que el resto del archivo puede seguir leyendo `usuario` igual que siempre — pero ya autenticado.
  const ses=sesion_(e, null);
  if(!ses.ok) return json({ok:false, auth:false, error:ses.error});
  if(ses.usuario) e.parameter.usuario = ses.usuario;
  if(a==='bandeja')     return bandeja(e);
  if(a==='consolidado') return consolidado(e);
  if(a==='estado')      return estado(e);
  if(a==='cubicaje')    return json({ok:true, cubicaje:getCubicajeMap()});
  if(a==='volquetas')   return volquetasDelDia(e);
  if(a==='drenajes')    return drenajesCatalogo();
  if(a==='tramos')      return tramosCatalogo();   // D104: subtramos del eje para el selector del residente
  if(a==='maquinas')    return maquinasCatalogo(e); // D138: flota vigente en una fecha (hoja MAQUINAS)
  if(a==='flota')       return flotaLeer(e);        // D139: estancias + avisos para la pestaña Flota
  if(a==='acumulado_drenajes') return acumuladoDrenajes(e);
  if(a==='maquinaria_produccion') return maquinariaProduccion(e);
  if(a==='debug')       return debug(e);
  return json({ok:true, msg:'API viva', version:'v11'});
}
function doPost(e){
  _t0 = Date.now();   // D100: cronómetro de servidor también en las escrituras
  try{
    const body=JSON.parse(e.postData.contents);
    if(body.action==='login') return login(body);                 // D108: única acción SIN token (aún no lo tiene)
    // D165 (V3-01): el parte del operador entra sin token (solo CREA filas pendientes); `revisar` exige sesión dentro.
    if(String(body.mod||'').toLowerCase()==='parte') return parteDoPost_(e, body);
    // D109: puerta única de escritura. `usuario` sale del token; `capataz`/`reporta` NO se tocan
    // porque son atribución de la LÍNEA (el envío del encargado conserva quién reportó cada fila).
    const ses=sesion_(e, body);
    if(!ses.ok) return json({ok:false, auth:false, error:ses.error});
    if(ses.usuario) body.usuario = ses.usuario;
    // D139: el ROL también sale del token y se sobrescribe SIEMPRE (aunque venga vacío), para que un
    // guard de escritura no pueda leer un rol que puso el cliente. `_auth_tolerada` marca el modo
    // tolerante de D109 (AUTH_ESTRICTO=false), donde no hay identidad que comprobar.
    body._rol = ses.rol || '';
    body._auth_tolerada = !!ses.tolerado;
    if(body.action==='enviar_data') return enviarData(body);
    if(body.action==='maquinaria_produccion') return maquinariaProduccionGuardar(body);
    if(body.action==='flota_guardar') return flotaGuardar(body);   // D139: alta/baja de máquinas
    if(body.action==='tablero_guardar') return tableroGuardar(body); // D158: publica la foto del tablero
    return guardarReporte(body);
  }catch(err){ return json({ok:false, error:String(err)}); }
}

/* ---------- capataz / chequeadora -> BANDEJA ---------- */
// D82: dedupe de reenvíos de la cola offline. Devuelve {id:1} con los id_registro ya guardados en la
// hoja PARA ESA FECHA (búsqueda acotada por fecha: solo se leen las columnas id+fecha, no todo el
// histórico). Solo se llama cuando el payload trae ids generados en el cliente; un payload viejo
// (sin id) nunca entra aquí. Fechas comparadas con fdate (duck-typing, NUNCA instanceof Date).
function idsExistentes(sh, headers, idHeader, fecha){
  const out={}, last=sh.getLastRow();
  if(last<2) return out;
  const idCol=headers.indexOf(idHeader)+1, fCol=headers.indexOf('fecha')+1;
  if(!idCol || !fCol) return out;
  const ids=sh.getRange(2,idCol,last-1,1).getValues();
  const fs=sh.getRange(2,fCol,last-1,1).getValues();
  for(let i=0;i<ids.length;i++){
    if(fdate(fs[i][0])===fecha && String(ids[i][0]||'')!=='') out[String(ids[i][0])]=1;
  }
  return out;
}
function guardarReporte(body){
  // D106: sin fecha válida no se escribe nada. Una fila de BANDEJA sin fecha no la ve el encargado en
  // ningún día, y el capataz creería que su reporte quedó subido.
  const fecha=fdateValida_(body.fecha), reporta=body.capataz||'', rol=body.rol||'capataz', ts=new Date();
  if(!fecha) return json({ok:false, error:ERROR_FECHA});
  const banSh=getSheet('BANDEJA', BANDEJA_HEADERS), maqSh=getSheet('MAQUINARIA', MAQ_HEADERS);
  const banRows=[], maqRows=[];
  // D82 — identidad de envíos: cada fila del payload puede traer su id_registro UUID GENERADO EN EL
  // CLIENTE (antes lo generaba este backend). Un reenvío desde la cola offline puede duplicar filas
  // si el primer intento sí llegó pero la respuesta se perdió (señal intermitente): las filas cuyo id
  // ya existe en la hoja destino se SALTAN en silencio y cuentan como `duplicadas` — el reenvío de
  // algo ya guardado ES éxito. RETROCOMPATIBILIDAD: si el payload llega sin id_registro (frontend
  // viejo cacheado en un celular), el backend genera el id como siempre y NO deduplica.
  const traeIdsBan=(body.cantidades||[]).some(function(c){ return c.id_registro; });
  const traeIdsMaq=(body.cantidades||[]).some(function(c){ return (c.equipos||[]).some(function(m){ return m.id_registro; }); })
                 || (body.maquinaria||[]).some(function(m){ return m.id_registro; });
  const traeIdsVol=(body.volquetas||[]).some(function(l){ return l.id_registro; });
  const banIds = traeIdsBan ? idsExistentes(banSh, BANDEJA_HEADERS, 'id_registro', fecha) : {};
  const maqIds = traeIdsMaq ? idsExistentes(maqSh, MAQ_HEADERS, 'app_id_registro', fecha) : {};
  const volIds = traeIdsVol ? idsExistentes(getSheet('VOLQUETAS', VOLQUETAS_HEADERS), VOLQUETAS_HEADERS, 'id_registro', fecha) : {};
  let dupBan=0, dupMaq=0, dupVol=0;
  // D53: cubicaje real por placa. Procesamos VOLQUETAS antes que las cantidades para que el
  // volumen oficial de excavación/terraplén use Σ(viajes_placa × cubicaje_placa) en vez de total×14.
  // El factor editable del reporte (14 por defecto) es el fallback para placas no catalogadas.
  const cubMap=getCubicajeMap();
  const factorReporte=parseFloat(body.m3viaje)>0 ? parseFloat(body.m3viaje) : 14;
  const lineVol={}, lineTipo={}; // _linea -> volumen real (m³) desde las placas / tipo de destino (D67)
  const volRows=[];
  (body.volquetas||[]).forEach(line=>{
    // D82: id de línea del cliente si viene (las placas de la línea comparten id, como siempre).
    // Línea ya guardada => se recalcula igual el volumen (las cantidades lo necesitan) pero sus
    // placas NO se re-escriben: cuentan como duplicadas.
    const idV=line.id_registro||Utilities.getUuid();
    const dupLinea=!!(line.id_registro && volIds[String(line.id_registro)]);
    let m3line=0;
    (line.placas||[]).forEach(p=>{
      const placaN=normPlaca(p.placa);
      const viajes=Number(p.viajes)||0;
      const found=Object.prototype.hasOwnProperty.call(cubMap, placaN);
      const cub=found ? cubMap[placaN] : factorReporte;          // catálogo o fallback
      const m3p=viajes*cub;
      m3line+=m3p;
      if(dupLinea){ dupVol++; }
      else volRows.push([idV, ts, fecha, reporta, line.origen||'', line.destino||'', line.tipo_destino||'',
        line.uf||'', p.placa||'', (p.viajes!=null?p.viajes:''), cub, m3p, found?'catalogo':'default']);
    });
    if(line._linea!=null){ lineVol[line._linea]=m3line; lineTipo[line._linea]=String(line.tipo_destino||''); }
  });
  // Problema 2.12: la EXCAVACIÓN de la chequeadora se acumula al ORIGEN (al PK del origen). El
  // TERRAPLÉN no cambia: sigue 1 fila por línea al PK destino. D06: el volumen sigue viniendo de la
  // chequeadora (cubicaje real por placa, D53). D67: el material con destino Botadero se DESCARTA =>
  // va en su propia fila acumulada de excavación NO APROVECHABLE (_acumBotadero); el resto de destinos
  // queda en la fila del origen (_acumOrigen). Si el payload no trae _acumBotadero (frontend viejo),
  // _acumOrigen conserva el total completo para no perder volumen.
  const totalExc=Object.keys(lineVol).reduce((s,k)=>s+(lineVol[k]||0),0);
  const totalBota=Object.keys(lineVol).reduce((s,k)=>s+(lineTipo[k]==='Botadero'?(lineVol[k]||0):0),0);
  const traeSplit=(body.cantidades||[]).some(function(c){ return c._acumBotadero; });
  (body.cantidades||[]).forEach(c=>{
    if(rol==='chequeadora'){
      if(c._acumBotadero) c.largo=totalBota;                               // excavación no aprovechable (Botadero)
      else if(c._acumOrigen) c.largo=traeSplit ? (totalExc-totalBota) : totalExc; // excavación acumulada al origen
      else if(c._linea!=null && lineVol[c._linea]!=null) c.largo=lineVol[c._linea]; // terraplén por línea
    }
    // D82: id de la fila generado en el cliente si viene; fila ya guardada => se salta (dupC).
    const idC=c.id_registro||Utilities.getUuid();
    const dupC=!!(c.id_registro && banIds[String(c.id_registro)]);
    // D56: origen del banco de material para la fila de excavación acumulada de la chequeadora; la
    // chequeadora lo manda en c.origen (la fila acumulada ya no tiene un _linea único).
    const origenBandeja = (rol==='chequeadora') ? (c.origen||'') : '';
    // D69/D71: área de la línea — manda la columna `area` que envía el reporte de drenajes (necesaria
    // para la demolición 01.02, cuyo CC deriva 'tierras'); si falta, se deriva del CC. + campos
    // SOLO-WhatsApp de drenajes (personal/turno noche/nota libre por línea). Nunca pasan a DATA.
    const areaLinea = areaDeFila(c.area, c.centro_costo);
    const areaCol = (areaLinea==='tierras') ? '' : areaLinea;
    const turnoNoche = (c.turno_noche===true || String(c.turno_noche||'').toUpperCase()==='SI') ? 'SI' : '';
    // todo entra a BANDEJA; cereo (data:false) marcado como 'no_data' para que el encargado lo vea pero no lo envíe a DATA
    if(dupC){ dupBan++; }
    else banRows.push([idC, ts, fecha, reporta, rol, c.grupo||'', c.capitulo||'', c.actividad||'', c.descripcion||'', c.centro_costo||'',
      c.unidad||'', c.uf||'', c.proyecto||'', c.elemento||'', c.pk_inicial||'', c.pk_final||'', c.abs_inicial||'', c.abs_final||'', c.liberacion||'CAMPO',
      c.largo||0, c.observacion||'', (c.data===false)?'no_data':'pendiente', origenBandeja,
      areaCol, (c.personal_oficiales!=null?c.personal_oficiales:''), (c.personal_ayudantes!=null?c.personal_ayudantes:''),
      turnoNoche, c.nota_libre||'']);
    // ZODME automático tras excavación no aprovechable (origen vacío: no es excavación aprovechable).
    // D58: si la no aprovechable nació de descapote/desmonte (c.derivada), el ZODME hereda el sello
    // 'orig:descapote/desmonte' en su observación para que la reconciliación del encargado no lo apague
    // por una no aprovechable de chequeadora de otro frente.
    // D82: el ZODME nace y muere con su fila madre — id determinístico derivado del de la madre
    // (idC+'-z') y mismo destino dup: si la madre ya estaba guardada, su ZODME también (ambas filas
    // se escriben en el mismo setValues), así que se salta y cuenta como duplicada.
    if(c.data!==false && String(c.descripcion||'').toUpperCase().indexOf('NO APROVECHABLE')>=0){
      if(dupC){ dupBan++; }
      else {
        const proy=c.proyecto||'';
        const obsZodme = c.derivada ? 'Auto · ZODME de descapote/desmonte · orig:descapote/desmonte'
                                    : 'Auto · secuencial a no aprovechable';
        banRows.push([(c.id_registro?(c.id_registro+'-z'):Utilities.getUuid()), ts, fecha, reporta, rol, 'TIERRAS', 'EXPLANACIONES',
          'Conformación y disposición de sobrantes (ZODME)', 'Conformación y disposición de sobrantes',
          proy?(proy+'.02.08'):'', 'm3', c.uf, proy, c.elemento, c.pk_inicial, c.pk_final, c.abs_inicial, c.abs_final,
          c.liberacion, c.largo, obsZodme, 'pendiente', '', '', '', '', '', '']);
      }
    }
    // equipos -> MAQUINARIA (layout Captura A→AA + internos del app, D52)
    // D69: las máquinas de líneas de drenajes (ODT/ODL) son captura libre (id/placa + operador +
    // horas opcionales): a_captura=NO SIEMPRE (no pasan a Captura_Diaria) y T Producción en blanco.
    const der = derivarActividad(c);
    const esDrenaje = (areaLinea!=='tierras');
    (c.equipos||[]).forEach(m=>{
      // D82: cada equipo trae su propio id_registro de cliente (→ app_id_registro); si ya está
      // guardado en MAQUINARIA para esa fecha, se salta (reenvío desde la cola).
      const idM=m.id_registro||Utilities.getUuid();
      if(m.id_registro && maqIds[String(m.id_registro)]){ dupMaq++; return; }
      const esVibro = esTipoSinProduccion(m.tipo_equipo);
      const esApoyo = (c.actividad||'') === 'APOYO';
      // T Producción: largo de la actividad EXCEPTO vibros/minis y actividades de apoyo → blanco (D41/D44).
      // D58: desmonte/descapote llevan la producción de la máquina aparte (m²/m³), distinta del largo
      // contractual de la fila (Ha). Si la fila trae prod_maquina, ese valor (y su unidad) manda en T.
      const tieneProdMaq = (c.prod_maquina != null && c.prod_maquina !== '');
      const baseProd = tieneProdMaq ? c.prod_maquina : c.largo;
      const prod  = (esDrenaje || esVibro || esApoyo || baseProd == null || baseProd === '') ? '' : baseProd;
      const uProd = (prod === '') ? '' : (tieneProdMaq ? (c.unidad_maquina || '') : (c.unidad || ''));
      // O Horas Mantenimiento: prog−oper solo si motivo=Mantenimiento; en otro caso blanco
      const esMant = (m.motivo||'').trim().toLowerCase().indexOf('mantenimiento') >= 0;
      const hMant  = esMant ? Math.max(0, (parseFloat(m.horas_programadas)||0) - (parseFloat(m.horas_operadas)||0)) : '';
      // R ESTADO derivado del motivo
      const estado = derivarEstado(m.motivo, m.horas_muertas);
      maqRows.push([
        // A vacío (autonumera Captura) · B fecha · C vacío · D proyecto · E id_maquina · F vacío · G operador
        '', fecha, '', c.proyecto, m.id_maquina, '', m.operador,
        // H actividad(der) · I sub(der) · J vacío · K vacío(fórmula) · L horas_operadas · M vacío
        der.h, der.i, '', '', m.horas_operadas, '',
        // N vacío(fórmula) · O h_mantenimiento · P vacío · Q vacío · R estado · S vacío(clima)
        '', hMant, '', '', estado, '',
        // T produccion · U–X vacío · Y vacío(viajes) · Z vacío · AA observacion
        prod, '', '', '', '', '', '', c.observacion||'',
        // internos del app
        idM, idC, ts, reporta, m.tipo_equipo, m.horas_programadas, m.horas_muertas,
        m.motivo, uProd, c.actividad, (esDrenaje?'NO':der.aCaptura), '', areaCol]);
    });
  });
  // Maquinaria de la chequeadora (D54): excavadoras que alimentaron el origen. Una vez por reporte.
  // Producción = total excavado del día (Σ líneas, con cubicaje real) REPARTIDO en partes iguales
  // entre las máquinas (cada una cumple su papel). Va a MAQUINARIA; el encargado reconcilia si un
  // capataz reportó la misma máquina (D51). D06: el volumen sigue viniendo de la chequeadora.
  (function(){
    const maqList=body.maquinaria||[];
    if(!maqList.length) return;
    // totalExc (Σ líneas) ya calculado arriba para la excavación acumulada al origen (Problema 2.12).
    const nProd=maqList.filter(m=>!esTipoSinProduccion(m.tipo_equipo)).length || 1;
    const prodCada=totalExc/nProd;
    // proyecto y actividad del frente de excavación (todas las líneas comparten origen)
    let proyMaq='', actMaq='';
    (body.cantidades||[]).forEach(c=>{ if(!actMaq && String(c.actividad||'').indexOf('Excavaci')>=0){ actMaq=c.actividad; proyMaq=c.proyecto||''; } });
    if(!proyMaq && (body.cantidades||[]).length) proyMaq=body.cantidades[0].proyecto||'';
    const der=derivarActividad({actividad:actMaq});
    maqList.forEach(m=>{
      // D82: mismo dedupe por id de cliente que los equipos del capataz.
      const idM=m.id_registro||Utilities.getUuid();
      if(m.id_registro && maqIds[String(m.id_registro)]){ dupMaq++; return; }
      const esVibro=esTipoSinProduccion(m.tipo_equipo);
      const prod=esVibro ? '' : prodCada;          // vibros/minis nunca llevan producción (D44)
      const uProd=(prod==='') ? '' : 'm3';
      const esMant=(m.motivo||'').trim().toLowerCase().indexOf('mantenimiento')>=0;
      const hMant=esMant ? Math.max(0,(parseFloat(m.horas_programadas)||0)-(parseFloat(m.horas_operadas)||0)) : '';
      const estado=derivarEstado(m.motivo, m.horas_muertas);
      maqRows.push([
        '', fecha, '', proyMaq, m.id_maquina, '', m.operador,
        der.h, der.i, '', '', m.horas_operadas, '',
        '', hMant, '', '', estado, '',
        prod, '', '', '', '', '', '', '',
        idM, '', ts, reporta, m.tipo_equipo, m.horas_programadas, m.horas_muertas,
        m.motivo, uProd, actMaq, der.aCaptura, '', '']);
    });
  })();
  // D93: se valida la capacidad de la grilla ANTES de cada escritura en bloque (la hoja crece sola
  // cuando se agotan sus filas; sin esto el setValues fallaba entero al llenarse la hoja).
  if(banRows.length){ ensureRows_(banSh, banRows.length);
    banSh.getRange(banSh.getLastRow()+1,1,banRows.length,BANDEJA_HEADERS.length).setValues(banRows); }
  if(maqRows.length){ ensureRows_(maqSh, maqRows.length);
    maqSh.getRange(maqSh.getLastRow()+1,1,maqRows.length,MAQ_HEADERS.length).setValues(maqRows); }
  // chequeadora: desglose por placa -> VOLQUETAS (una fila por placa). No toca DATA ni MAQUINARIA.
  // Un id_registro por línea de PK destino (placas de la misma línea comparten id).
  // Las filas (con cubicaje·m3_placa·cubicaje_origen) se construyeron arriba junto al cálculo del volumen.
  if(volRows.length){ const volSh=getSheet('VOLQUETAS', VOLQUETAS_HEADERS);
    ensureRows_(volSh, volRows.length);   // D93
    volSh.getRange(volSh.getLastRow()+1,1,volRows.length,VOLQUETAS_HEADERS.length).setValues(volRows); }
  const obs=(body.observacion_general||'').trim();
  if(obs){
    // D82: la observación general usa el id_reporte del cliente (uno por envío) para no duplicarse
    // en un reenvío; sin id_reporte (frontend viejo) se comporta como siempre.
    const obsSh=getSheet('OBSERVACIONES', OBS_HEADERS);
    const yaObs=body.id_reporte ? idsExistentes(obsSh, OBS_HEADERS, 'id_registro', fecha)[String(body.id_reporte)] : false;
    // D86: la observación se sella con el área (o áreas) de las líneas del reporte para que la
    // bandeja de cada área muestre solo las suyas (antes las de tierras salían también en ODT/ODL).
    if(!yaObs) obsSh.appendRow([body.id_reporte||Utilities.getUuid(), ts, fecha, reporta, obs, areasDeReporte(body.cantidades)]);
  }
  // D82: `guardadas`/`duplicadas` = filas escritas / saltadas por dedupe en este llamado. Los campos
  // cantidades/maquinas/volquetas conservan el TOTAL del reporte (guardadas + duplicadas), así el
  // mensaje de éxito de un reenvío muestra los mismos conteos que el envío original — el cliente
  // trata guardadas+duplicadas === esperadas como éxito total.
  return json({ok:true,
    cantidades: banRows.length + dupBan,
    maquinas:   maqRows.length + dupMaq,
    volquetas:  volRows.length + dupVol,
    guardadas:  banRows.length + maqRows.length + volRows.length,
    duplicadas: dupBan + dupMaq + dupVol});
}

/* ---------- bandeja para el encargado / residentes de drenajes ---------- */
// &area=tierras|odt|odl (D69): cada pantalla ve SOLO su área. Sin el parámetro se devuelve todo
// (compatible con frontends viejos). El área de cada fila = columna `area` (o derivada del CC para
// filas anteriores a la columna); en MAQUINARIA solo cuenta la columna (las filas no llevan CC).
function bandeja(e){
  const fecha=fdate(e.parameter.fecha), proy=e.parameter.proyecto||'';
  const areaQ=String(e.parameter.area||'').trim().toLowerCase();
  getSheet('BANDEJA', BANDEJA_HEADERS);  // auto-sana encabezados (+ cols de área D69) antes de leer
  getSheet('MAQUINARIA', MAQ_HEADERS);   // auto-sana encabezados al layout D52 (+ area) antes de leer
  getSheet('OBSERVACIONES', OBS_HEADERS);// auto-sana encabezados (+ col `area`, D86) antes de leer
  // D107 (backlog 3.6): lectura ACOTADA al día en vez de leer las hojas enteras y filtrar en memoria.
  // El filtro por fecha ya viene aplicado; aquí solo quedan proyecto y área.
  const cantidades=readSheetPorFecha_('BANDEJA', fecha).filter(r=> (!proy||String(r.proyecto)===proy)
    && (!areaQ || areaDeFila(r.area, r.centro_costo)===areaQ));
  const maquinas=readSheetPorFecha_('MAQUINARIA', fecha).filter(r=> (!proy||String(r.proyecto)===proy)
    && (!areaQ || areaDeFila(r.area, '')===areaQ));
  // D86: la observación general también se filtra por área (antes se devolvían TODAS las del día, así
  // que las de tierras aparecían en el panel y el WhatsApp de ODT/ODL). Col `area` vacía = tierras.
  const observaciones=readSheetPorFecha_('OBSERVACIONES', fecha).filter(r=> (!areaQ || obsEnArea(r.area, areaQ)))
    .map(r=>({reporta:r.reporta||'', observacion:r.observacion||'', area:String(r.area||'tierras')}));
  return json({fecha, area:areaQ, cantidades, maquinas, observaciones});
}

/* ---------- DATA ya enviada (para verificar) ---------- */
function consolidado(e){
  // Panel del jefe (consulta por rango, solo lectura): ?action=consolidado&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
  // Si llega desde/hasta se usa el handler de rango; si no, se conserva el consolidado de UN día de abajo
  // intacto (?action=consolidado&fecha=YYYY-MM-DD). Nunca escribe: ni DATA ni maestro.
  if(e.parameter.desde || e.parameter.hasta) return consolidadoRango(e);
  const fecha=fdate(e.parameter.fecha), proy=e.parameter.proyecto||'';
  let cantidades=[];
  {
    // D107 (backlog 3.6): filas de DATA ya acotadas al día. La columna de fecha se pasa FIJA (col A del
    // maestro) porque el encabezado de DATA no se llama `fecha` sino `FECHA`.
    const v=filasCrudasPorFecha_('DATA', fecha, C.FECHA+1).map(function(x){ return x.v; });
    for(let i=0;i<v.length;i++){
      if(proy && String(v[i][7])!==proy) continue;
      cantidades.push({ fecha, descripcion:v[i][5], actividad:v[i][24], uf:v[i][6], proyecto:String(v[i][7]||''),
        pk_inicial:v[i][25], largo:v[i][14], unidad:v[i][13] });
    }
  }
  return json({fecha, cantidades});
}

/* ---------- consolidado por RANGO (panel del jefe, solo lectura) ----------
 * Devuelve las filas CRUDAS A–T de DATA cuya FECHA (col A) cae en [desde, hasta] inclusive, para que
 * el frontend arme el resumen de obra en cliente (sumando LARGO) y el copiado A:S día a día al maestro.
 * Comparación de fechas por DUCK-TYPING (fdate: usa typeof v.getFullYear==='function', NUNCA instanceof
 * Date ni Utilities.formatDate) y como cadenas 'YYYY-MM-DD' (orden lexicográfico = orden cronológico).
 * NO toca DATA/BANDEJA/MAQUINARIA ni el maestro. Es lectura pura. */
function consolidadoRango(e){
  const dRaw=fdate(e.parameter.desde), hRaw=fdate(e.parameter.hasta);
  const desde = dRaw || hRaw, hasta = hRaw || dRaw;   // si falta uno, el rango es un solo día
  const proy=e.parameter.proyecto||'';
  const AT=20;                                        // A–T (las 20 columnas espejo del maestro + Columna1)
  const climaCol=DATA_HEADERS.indexOf('clima');       // columna interna (tras A–T); no viaja al maestro
  // D113 — `actividad` (columna INTERNA de DATA, como `clima`): la actividad del catálogo del capataz
  // tal cual se reportó. Se expone APPEND al final de cada fila (índice AT) para que el panel del jefe
  // pueda desglosar lo que DESCRIPCION funde en una sola línea: el terraplén con crudo de río y el de
  // UF3 comparten ítem 02.07 y descripción verbatim de la BASE, así que sin esta columna se suman con
  // el terraplén normal. NO entra en el copiado A:S del maestro (COPY_END=15 no cambia) ni altera el
  // recorte A–T: se añade DESPUÉS, así que el copiado día a día es byte por byte el mismo de antes.
  const actCol=DATA_HEADERS.indexOf('actividad');
  const ss=ss_(), sh=ss.getSheetByName('DATA');
  const filas=[], climaPorDia={};                     // D37: clima del día (leído de la col interna)
  if(desde && hasta && sh && sh.getLastRow()>1){
    const v=sh.getDataRange().getValues();
    for(let i=1;i<v.length;i++){
      const f=fdate(v[i][C.FECHA]);                   // Date -> 'YYYY-MM-DD' por duck-typing; string se normaliza
      if(!f || f<desde || f>hasta) continue;          // rango inclusivo, comparación lexicográfica
      if(proy && String(v[i][7])!==proy) continue;
      // clima del día: primer valor no vacío que aparezca (lo escribe el encargado de tierras, D37)
      if(climaCol>=0 && !climaPorDia[f]){ const cl=String(v[i][climaCol]||'').trim(); if(cl) climaPorDia[f]=cl; }
      const row=v[i].slice(0, AT);                     // recorta a A–T (el copiado A:S recorta a 19 en cliente)
      row[C.FECHA]=f;                                  // col A como cadena 'YYYY-MM-DD' (agrupar por día / copiar)
      row.push(actCol>=0 ? String(v[i][actCol]==null?'':v[i][actCol]).trim() : '');   // D113: actividad interna
      filas.push(row);
    }
  }
  // cols: índices dentro de cada fila devuelta. COPY_END=15 => el copiado toma [0,15) = A:O, hasta LARGO
  // inclusive. La app captura hasta LARGO (D14); no se copian ESPESOR/FC/CANTIDAD (fórmula del maestro)
  // ni OBSERVACION (texto que no debe ir al maestro).
  return json({
    ok:true, desde:desde, hasta:hasta,
    header: DATA_HEADERS.slice(0, AT).concat(['actividad']),   // D113: la interna va al final
    cols: { FECHA:0, ORDEN:1, GRUPO:2, CC:3, CAPITULO:4, DESCRIPCION:5, UF:6, PROYECTO:7, ELEMENTO:8,
            ABS_INI:9, ABS_FIN:10, LIBERACION:11, ACTA:12, UNIDAD:13, LARGO:14, ESPESOR:15, FC:16,
            CANTIDAD:17, OBSERVACION:18, COLUMNA1:19, ACTIVIDAD:AT, COPY_END:15 },
    climaPorDia: climaPorDia,   // D37: {fecha -> clima}; el jefe lo muestra en el resumen (no va al maestro)
    filas: filas
  });
}

/* ---------- estado de maquinaria ---------- */
function estado(e){
  const fecha=fdate(e.parameter.fecha), proy=e.parameter.proyecto||'';
  getSheet('MAQUINARIA', MAQ_HEADERS); // auto-sana encabezados al layout D52 antes de leer
  const maquinas=readSheetPorFecha_('MAQUINARIA', fecha).filter(r=> (!proy||String(r.proyecto)===proy));   // D107
  const seen={}, reportadas=[];
  maquinas.forEach(m=>{ if(!m.id_maquina||seen[m.id_maquina]) return; seen[m.id_maquina]=1; reportadas.push({id_maquina:m.id_maquina, capataz:m.reporta}); });
  return json({reportadas});
}

/* ---------- ajuste de producción de maquinaria (2.4 / D55 / D59 / D60) ----------
 * Sustituye el estimado geométrico del capataz (largo, D20) por el volumen OFICIAL de la
 * chequeadora (D06) en la fila de MAQUINARIA, SOLO para los frentes de excavación/terraplén/
 * ZODME (CC 02.05/02.06/02.07/02.08). LEE DATA y MAQUINARIA; ESCRIBE SOLO MAQUINARIA.
 * NUNCA escribe en DATA ni en BANDEJA.
 * El panel muestra el panorama del día: frentes ajustables con su volumen oficial (aunque no
 * tengan máquina, para redirigir esa producción, D60), las demás máquinas productivas en lectura
 * y el indicador de máquina multi-actividad (D46). */
const MAQ_PROD_CC = {'02.05':1,'02.06':1,'02.07':1,'02.08':1};
// Buckets de frente (granularidad de actividad, no solo CC: separa aprovechable / no aprovechable
// / préstamo / terraplén / ZODME). Cada uno trae el par H/I de Captura para crear filas (D52).
const MAQ_BUCKETS = {
  EXC_APRO:    {cc:'02.05', h:'EXCAVACION COMUN',    i:'EXCAVACION APROVECHABLE',    label:'Excavación aprovechable',    tipo:'excavacion'},
  EXC_NOAPRO:  {cc:'02.05', h:'EXCAVACION COMUN',    i:'EXCAVACION NO APROVECHABLE', label:'Excavación no aprovechable', tipo:'excavacion'},
  EXC_PRESTAMO:{cc:'02.06', h:'EXCAVACION PRESTAMO', i:'EXCAVACION APROVECHABLE',    label:'Excavación de préstamo',     tipo:'excavacion'},
  TERRAPLEN:   {cc:'02.07', h:'TERRAPLEN',           i:'NUCLEO DE TERRAPLEN',        label:'Terraplén',                  tipo:'terraplen'},
  ZODME:       {cc:'02.08', h:'CONFORMACION',        i:'ZODME',                      label:'Conformación / ZODME',       tipo:'terraplen'}
};
// Actividades complementarias SIN producción que el panel puede asignar a una máquina faltante (D62):
// cereo y apoyos. Llevan par H/I (a_captura=SI) salvo paisajeo/adecuación/derrumbe (sin par, NO a Captura).
const MAQ_COMPLEM = {
  CEREO_CORONA:      {h:'TERRAPLEN', i:'CEREO CORONA',        label:'Cereo de corona',           aCaptura:'SI'},
  CEREO_SUBBASE:     {h:'SUBBASE',   i:'CEREO SUBBASE',       label:'Cereo de subbase',          aCaptura:'SI'},
  COMPACT_TERRAPLEN: {h:'TERRAPLEN', i:'NUCLEO DE TERRAPLEN', label:'Compactación de terraplén', aCaptura:'SI'},
  COMPACT_SUBBASE:   {h:'SUBBASE',   i:'CONFORMACION SUBBASE',label:'Compactación de subbase',   aCaptura:'SI'},
  COMPACT_BTC:       {h:'BASE',      i:'BTC',                 label:'Compactación de BTC',       aCaptura:'SI'},
  PAISAJEO:          {h:'',          i:'',                    label:'Paisajeo / ornato',         aCaptura:'NO'},
  ADECUACION:        {h:'',          i:'',                    label:'Adecuación de caminos',     aCaptura:'NO'},
  DERRUMBE:          {h:'',          i:'',                    label:'Limpieza de derrumbe',      aCaptura:'NO'}
};
// Catálogo de máquinas (05_CATALOGO §4): tipo + horas programadas. Para crear filas y poblar el
// selector de "redirigir producción" (solo las que generan producción; vibros/minis fuera).
// D136: devueltas/entregadas (ago-2026) y fuera del catálogo — NH69 (bulldozer alquilado),
// BL009 (bulldozer propio), EXC001/EXC013/EXC014 (excavadoras propias),
// CS78B/NH404/NH420/CAT900 (vibros alquilados) y NH421 (minicargador). BL005 queda como
// único bulldozer y EXC015 como única excavadora. Salir del catálogo NO borra lo ya escrito
// en MAQUINARIA: el histórico se conserva; solo dejan de ofrecerse y de esperarse.
// (Antes: CAT320 y MC705, jun-2026, D61.)
const MAQ_CATALOGO = {
  BL005:{tipo:'BULLDOZER',prog:6.4},
  EXC015:{tipo:'EXCAVADORA',prog:6.4},
  MO03:{tipo:'MOTONIVELADORA',prog:6.4}, MO04:{tipo:'MOTONIVELADORA',prog:6.4}, MO09:{tipo:'MOTONIVELADORA',prog:6.4},
  FNG02:{tipo:'FINISHER',prog:6.4},
  CR019:{tipo:'VIBROCOMPACTADOR',prog:6.4}, CR013:{tipo:'VIBROCOMPACTADOR',prog:6.4}, CR016:{tipo:'VIBROCOMPACTADOR',prog:6.4}, CR08:{tipo:'VIBROCOMPACTADOR',prog:6.4},
  NH403:{tipo:'VIBROCOMPACTADOR',prog:5},
  CR026:{tipo:'MINIBULDOZER',prog:6.4},
  'RT-02':{tipo:'RETROEXCAVADORA',prog:5}
};
// Flota "requerida" diaria (mismo conjunto que estado.html): máquinas de las que se espera saber
// cada día SI reportaron o no. El panel la usa para mostrar las FALTANTES (sin reporte) y permitir
// registrar sus horas manualmente (D61).
// D137: es TODO el catálogo, no solo las productivas. Antes eran las 10 de BL/EXC/MO/NH69 (D61d) y
// vibros, finisher, minibuldózer y RT-02 (D111) quedaban fuera, así que de esas nunca se sabía si
// habían trabajado o si simplemente nadie las reportó — que es justo lo que la pantalla existe para
// responder. Se DERIVA del catálogo (no se copia a mano) para que las dos listas no puedan divergir:
// dar de baja una máquina en MAQ_CATALOGO la saca también de las faltantes, en un solo sitio.
const MAQ_FLOTA_ESPERADA = Object.keys(MAQ_CATALOGO);
// D138: máquinas del catálogo de respaldo que ENTRAN Y SALEN de la obra (el finisher y su vibro de
// pareja: son caros de tener parados y solo se traen cuando hay BTC). Siguen siendo reportables,
// pero NO se esperan cada día, así que no ensucian las faltantes con una falsa alarma diaria.
// Solo aplica al respaldo en código: con la hoja MAQUINAS viva la distinción la dan las FECHAS.
const MAQ_INTERMITENTES = ['FNG02','CR08'];

/* ============ D138 — CATÁLOGO VIVO DE LA FLOTA (hoja MAQUINAS, backlog 2.28) ============
 *
 * EL PROBLEMA: las máquinas entran y salen de la obra continuamente según la necesidad — alquilar y
 * tener parado es caro, así que el finisher FNG02 y el vibro CR08 (que trabajan en pareja) solo se
 * traen cuando hay BTC que hacer, y lo mismo pasa con retros y vibros alquilados. Hasta hoy cada
 * alta o baja era editar este archivo y 4 pantallas + redesplegar. Era el ÚLTIMO catálogo del
 * sistema escrito en código: usuarios (D108), personal y cuadrillas (D84/D85), cubicaje (D53) e
 * ítems de drenajes (D113b) ya viven en hojas que mantiene el usuario.
 *
 * FORMA DE LA HOJA — UNA FILA POR ESTANCIA, NO POR MÁQUINA:
 *   id_maquina · tipo · horas_prog · propiedad · fecha_ingreso · fecha_retiro · notas
 * Una máquina que entra y sale cinco veces son CINCO filas. Es la lección de D85 con el personal
 * ("`reactivar` pierde el gap: para un reingreso que respete los días inactivos va un alta nueva
 * con fecha de reingreso"), y es exactamente el caso del FNG02/CR08. Con una sola fila por máquina
 * no habría forma de distinguir "estuvo en agosto pero no en julio" de "está desde julio".
 *
 * VENTANA SEMIABIERTA [fecha_ingreso, fecha_retiro), igual que `activaEnFecha` de D85: la
 * `fecha_retiro` es el PRIMER DÍA QUE YA NO ESTUVO (vacía = sigue en obra). Así, consultar el
 * estado del 15-jul devuelve la flota que había ESE día y el histórico nunca se desmiente: una
 * máquina devuelta no aparece como faltante hacia atrás, ni una recién llegada como faltante en
 * días en que todavía no estaba.
 *
 * RESPALDO EN CÓDIGO, A PROPÓSITO: si la hoja no existe, está vacía o no tiene ni una fila válida,
 * se cae a `MAQ_CATALOGO`. Servir una flota VACÍA sería peor que estar desactualizado — el capataz
 * no podría reportar ninguna máquina y todo saldría como faltante. Por eso `MAQ_CATALOGO` se
 * conserva y hay que mantenerlo grosso modo al día, aunque ya no sea la fuente.
 *
 * LO QUE ESTO **NO** VALIDA, TAMBIÉN A PROPÓSITO: la recepción de reportes (`guardarReporte`) NO
 * comprueba que la máquina esté en la flota. Un reporte que pasó el fin de semana en la cola sin
 * señal (D82) puede traer una máquina que entretanto se devolvió, y rechazarlo perdería trabajo
 * real del capataz. El catálogo decide qué se OFRECE y qué se ESPERA, no qué se acepta.
 *
 * OJO CON EL ID (D111): tiene que coincidir letra por letra con `dim_maquinaria` del maestro
 * `Modelo_Produccion_Maquinaria` o el pegado a Captura_Diaria deja de cruzar EN SILENCIO (por eso
 * `RT-02` va con guion). Como ahora el ID lo teclea el usuario en una hoja, el endpoint devuelve
 * `avisos` con lo que encuentre raro en vez de tragárselo.
 */
const MAQUINAS_HEADERS = ['id_maquina','tipo','horas_prog','propiedad','fecha_ingreso','fecha_retiro','notas'];
// Tipos que el sistema sabe tratar (05_CATALOGO §4). Un tipo fuera de esta lista no rompe nada, pero
// se avisa: `esTipoSinProduccion` no lo reconocería y la máquina se trataría como productiva.
const MAQ_TIPOS_VALIDOS = ['BULLDOZER','EXCAVADORA','MOTONIVELADORA','FINISHER','VIBROCOMPACTADOR',
                           'MINICARGADOR','MINIBULDOZER','RETROEXCAVADORA'];
// Orden de presentación en los desplegables (el mismo que tenían escrito a mano los frontends).
const MAQ_ORDEN_TIPO = MAQ_TIPOS_VALIDOS;

function normMaqId(s){ return String(s==null?'':s).trim().toUpperCase(); }
// Horas programadas por defecto cuando la hoja no las trae: 5 h alquiladas / 6.4 h propias (D10).
function progPorPropiedad_(p){ return String(p==null?'':p).toLowerCase().indexOf('alquil')>=0 ? 5 : 6.4; }

/* Lee la hoja MAQUINAS cruda (memo de ejecución, como getCubicajeMap). Columnas ubicadas POR NOMBRE
 * y tolerante: la mantiene el usuario a mano, así que un encabezado renombrado o reordenado no debe
 * tumbarla. Si no hay encabezados reconocibles cae al orden por defecto de MAQUINAS_HEADERS. */
var _flotaRows;
function getFlotaRows_(){
  if(_flotaRows) return _flotaRows;
  _flotaRows=[];
  const sh=ss_().getSheetByName('MAQUINAS');
  if(!sh || sh.getLastRow()<2) return _flotaRows;
  const v=leerRango_(sh, 1, 1, sh.getLastRow(), sh.getLastColumn()), h=v[0];
  const idx={id:0, tipo:1, prog:2, prop:3, ing:4, ret:5, nota:6};
  for(let j=0;j<h.length;j++){
    const k=String(h[j]==null?'':h[j]).toLowerCase().trim();
    if(k.indexOf('maquina')>=0 || k.indexOf('máquina')>=0 || k==='id')  idx.id=j;
    else if(k.indexOf('tipo')>=0)                                       idx.tipo=j;
    else if(k.indexOf('prog')>=0 || k.indexOf('hora')>=0)               idx.prog=j;
    else if(k.indexOf('propiedad')>=0 || k.indexOf('propia')>=0)        idx.prop=j;
    else if(k.indexOf('ingreso')>=0 || k.indexOf('entrada')>=0)         idx.ing=j;
    else if(k.indexOf('retiro')>=0 || k.indexOf('salida')>=0)           idx.ret=j;
    else if(k.indexOf('nota')>=0 || k.indexOf('observ')>=0)             idx.nota=j;
  }
  for(let i=1;i<v.length;i++){
    _flotaRows.push({ id:v[i][idx.id], tipo:v[i][idx.tipo], prog:v[i][idx.prog], propiedad:v[i][idx.prop],
                      ing:v[i][idx.ing], ret:v[i][idx.ret], nota:v[i][idx.nota], _row:i+1 });
  }
  return _flotaRows;
}

/* Flota VIGENTE en una fecha. Devuelve {fecha, fuente, catalogo, esperadas, avisos}:
 *   catalogo  = {id: {tipo, prog, propiedad, notas}} SOLO de las máquinas vigentes ese día
 *   esperadas = ids de los que se espera saber si reportaron (D137: todo el catálogo vigente)
 *   fuente    = 'hoja' | 'codigo' (respaldo)
 * Una máquina con varias estancias está vigente si CUALQUIERA de sus filas cubre la fecha. */
function flotaEnFecha_(fecha){
  const f = fdateValida_(fecha) || fdate(new Date());
  const catalogo={}, avisos=[];
  let validas=0;
  getFlotaRows_().forEach(function(r){
    const id=normMaqId(r.id);
    if(!id) return;                                   // fila en blanco: ni error ni aviso
    const ing=fdateValida_(r.ing);
    if(!ing){ avisos.push('Fila '+r._row+' ('+id+'): sin fecha_ingreso válida (yyyy-mm-dd); esa estancia se ignora.'); return; }
    const retCrudo = (r.ret===''||r.ret==null) ? '' : fdate(r.ret);
    const ret = retCrudo ? fdateValida_(r.ret) : '';
    if(retCrudo && !ret) avisos.push('Fila '+r._row+' ('+id+'): fecha_retiro "'+retCrudo+'" no se entiende; se toma como si siguiera en obra.');
    if(ret && ret<ing)   avisos.push('Fila '+r._row+' ('+id+'): fecha_retiro anterior al ingreso; esa estancia nunca está vigente.');
    validas++;
    if(!(ing<=f && (!ret || f<ret))) return;           // ventana semiabierta [ingreso, retiro)
    const tipo=String(r.tipo==null?'':r.tipo).toUpperCase().trim();
    if(!tipo)                                  avisos.push('Fila '+r._row+' ('+id+'): sin tipo; se tratará como máquina CON producción.');
    else if(MAQ_TIPOS_VALIDOS.indexOf(tipo)<0) avisos.push('Fila '+r._row+' ('+id+'): tipo "'+tipo+'" no está en la lista conocida; se tratará como máquina CON producción.');
    let prog=parseFloat(r.prog);
    if(isNaN(prog) || prog<=0) prog=progPorPropiedad_(r.propiedad);
    // Varias estancias vigentes el mismo día (traslape en la hoja): gana la última fila, y se avisa.
    if(catalogo[id]) avisos.push('Fila '+r._row+' ('+id+'): hay dos estancias vigentes el '+f+'; se usa la última.');
    catalogo[id]={ tipo:tipo, prog:prog, propiedad:String(r.propiedad==null?'':r.propiedad).trim(),
                   notas:String(r.nota==null?'':r.nota).trim() };
  });
  if(!validas){
    // Respaldo: la hoja no existe, está vacía o no tiene una sola fila utilizable.
    Object.keys(MAQ_CATALOGO).forEach(function(id){
      catalogo[id]={ tipo:MAQ_CATALOGO[id].tipo, prog:MAQ_CATALOGO[id].prog, propiedad:'', notas:'' };
    });
    return { fecha:f, fuente:'codigo', catalogo:catalogo, avisos:avisos,
             esperadas:Object.keys(catalogo).filter(function(id){ return MAQ_INTERMITENTES.indexOf(id)<0; }) };
  }
  return { fecha:f, fuente:'hoja', catalogo:catalogo, avisos:avisos, esperadas:Object.keys(catalogo) };
}

/* Endpoint `?action=maquinas&fecha=` — SOLO LECTURA. Se lo comen los cuatro frontends que hoy
 * llevan la lista escrita a mano (capataz, chequeadora, encargado, estado). Sin `fecha` responde
 * con la flota de HOY. */
function maquinasCatalogo(e){
  const fl=flotaEnFecha_((e&&e.parameter)?e.parameter.fecha:'');
  const maquinas=Object.keys(fl.catalogo).map(function(id){
    const c=fl.catalogo[id];
    return { id_maquina:id, tipo:c.tipo, prog:c.prog, propiedad:c.propiedad, notas:c.notas,
             produce: !esTipoSinProduccion(c.tipo), esperada: fl.esperadas.indexOf(id)>=0 };
  }).sort(function(a,b){
    const ta=MAQ_ORDEN_TIPO.indexOf(a.tipo), tb=MAQ_ORDEN_TIPO.indexOf(b.tipo);
    return ((ta<0?99:ta)-(tb<0?99:tb)) || (a.id_maquina<b.id_maquina?-1:a.id_maquina>b.id_maquina?1:0);
  });
  return json({ ok:true, fecha:fl.fecha, fuente:fl.fuente, maquinas:maquinas, avisos:fl.avisos });
}
/* ============ D139 — ALTA Y BAJA DE MÁQUINAS DESDE LA PANTALLA (backlog 2.29) ============
 *
 * POR QUÉ EXISTE ESTO, Y NO ES "COMODIDAD". D138 mudó el catálogo a la hoja `MAQUINAS` para que un
 * alta o una baja fuera editar una fila en vez de una sesión de desarrollo, y al cerrarlo dejó
 * señalado el riesgo que abre justo eso: **el `id_maquina` lo teclea ahora una persona**, y tiene que
 * coincidir LETRA POR LETRA con `dim_maquinaria` del maestro `Modelo_Produccion_Maquinaria` (por eso
 * `RT-02` va con guion, D111) o el pegado a `Captura_Diaria` deja de cruzar EN SILENCIO. Una hoja
 * suelta no puede avisar de eso; una pantalla sí. Esa es la razón del ítem — no entrar al Sheet es lo
 * secundario.
 *
 * EL GUARD DE TYPOS. No se puede leer `dim_maquinaria` (es un .xlsx maestro y la regla del proyecto
 * es no tocarlos), pero SÍ el vocabulario que de verdad se pega a Captura: los `id_maquina` que ya
 * existen en la hoja `MAQUINARIA`. Al dar de alta un ID que no aparece ahí ni en `MAQUINAS`, el
 * endpoint NO escribe: devuelve `confirmar:true` con el parecido más cercano y la pantalla pregunta.
 * El caso común es el typo de una máquina que YA existe, y se atrapa NORMALIZANDO (quitar lo que no
 * sea alfanumérico + mayúsculas: `RT02` y `RT-02` colapsan a `RT02`); con eso basta para el grueso,
 * no hace falta distancia de edición. Una máquina nueva de verdad se confirma una vez y entra.
 * La lectura de `MAQUINARIA` va **acotada a la COLUMNA `id_maquina`** con el instrumento de D107: esa
 * hoja crece todos los días y tiene ~40 columnas; leerla entera por esto sería una regresión.
 *
 * IDENTIDAD DE LA ESTANCIA = `id_maquina` + `fecha_ingreso`, NUNCA el número de fila: alguien puede
 * estar editando la hoja a mano al mismo tiempo (que es el punto de D138) y las filas se mueven.
 *
 * UN REINGRESO ES UNA FILA NUEVA, jamás editar la vieja: editarla perdería el hueco en que la máquina
 * no estuvo, que es exactamente lo que la ventana semiabierta existe para conservar (lección de D85
 * con el personal). "Corregir" está aparte y es para una estancia mal escrita, no para reingresar.
 *
 * LO QUE **NO** CAMBIA: la recepción de reportes sigue SIN validar contra el catálogo (D138) — un
 * reporte que esperó en la cola sin señal (D82) puede traer una máquina ya devuelta y rechazarlo
 * perdería trabajo real del capataz. El catálogo decide qué se OFRECE y qué se ESPERA, nunca qué se
 * acepta.
 */
const FLOTA_INFINITO = '9999-12-31';   // tope para comparar una estancia abierta (fecha_retiro vacía)
// Quién ESCRIBE la flota (se comprueba en el SERVIDOR, no solo en el guard del cliente — D109: la
// identidad sale del token y `doPost` la sobrescribe). `jefe` entra a la pantalla en SOLO LECTURA.
// `jeisson` (rol `asistencia_plus`, cuadrilla OPERADORES) es el primer usuario de asistencias que
// toca una pantalla de obra: aceptado a propósito, y NO implica mezclar los módulos — esto es el
// Apps Script de obra y el aislamiento de D69 (Sheet y script propios de asistencias) no se toca.
const FLOTA_ROLES_ESCRIBEN    = ['admin','residente'];
const FLOTA_USUARIOS_ESCRIBEN = ['jeisson'];
// Quién ajusta la PRODUCCIÓN del día (la pestaña de siempre, D59/D60/D61/D62). `jeisson` solo tiene
// la flota; `jefe` no escribe nada.
const MAQPROD_ROLES_ESCRIBEN  = ['admin','residente'];

// Clave de comparación de IDs: sin nada que no sea alfanumérico y en mayúsculas. `RT02` y `RT-02`
// colapsan a `RT02`, que es como se atrapa el typo de una máquina que ya existe.
function normMaqClave_(s){ return String(s==null?'':s).replace(/[^A-Za-z0-9]/g,'').toUpperCase(); }

/* Vocabulario REAL de máquinas: los `id_maquina` distintos que ya están escritos en la hoja
 * MAQUINARIA — que es exactamente lo que después se pega a `Captura_Diaria` y cruza (o no) contra
 * `dim_maquinaria`. Lectura ACOTADA A UNA COLUMNA (D107): fila de encabezados + la columna
 * `id_maquina`, en vez de las ~40 columnas × N filas de la hoja entera. Memo de ejecución. */
var _idsMaquinaria;
function idsMaquinariaHistorico_(){
  if(_idsMaquinaria) return _idsMaquinaria;
  _idsMaquinaria = { ids:{}, porClave:{}, n:0 };
  const sh=ss_().getSheetByName('MAQUINARIA');
  if(!sh || sh.getLastRow()<2) return _idsMaquinaria;
  const h=leerRango_(sh, 1, 1, 1, sh.getLastColumn())[0];
  let col=0;
  for(let j=0;j<h.length;j++) if(String(h[j]==null?'':h[j]).trim()==='id_maquina'){ col=j+1; break; }
  if(!col) return _idsMaquinaria;                       // sin la columna: el guard queda mudo, no rompe
  const v=leerRango_(sh, 2, col, sh.getLastRow()-1, 1);
  for(let i=0;i<v.length;i++){
    const id=normMaqId(v[i][0]); if(!id) continue;
    if(!_idsMaquinaria.ids[id]){ _idsMaquinaria.ids[id]=0; _idsMaquinaria.n++; }
    _idsMaquinaria.ids[id]++;
    const k=normMaqClave_(id); if(!k) continue;
    const l=(_idsMaquinaria.porClave[k]=_idsMaquinaria.porClave[k]||[]);
    if(l.indexOf(id)<0) l.push(id);
  }
  return _idsMaquinaria;
}

/* ¿Este ID ya se conoce, y si no, a qué se parece? `conocido` = aparece tal cual en el histórico de
 * MAQUINARIA o ya está en la hoja MAQUINAS (un reingreso no debe preguntar nada). `sugerencia` = otro
 * ID que colapsa al mismo normalizado, que es el typo típico. */
function flotaSugerencia_(id){
  const objetivo=normMaqId(id), clave=normMaqClave_(objetivo);
  if(!clave) return { conocido:false, sugerencia:'' };
  const hist=idsMaquinariaHistorico_();
  if(hist.ids[objetivo]) return { conocido:true, sugerencia:'' };
  const enHoja=getFlotaRows_().filter(function(r){ return normMaqId(r.id)===objetivo; });
  if(enHoja.length) return { conocido:true, sugerencia:'' };
  const cand=(hist.porClave[clave]||[]).slice();
  getFlotaRows_().forEach(function(r){
    const x=normMaqId(r.id);
    if(x && x!==objetivo && normMaqClave_(x)===clave && cand.indexOf(x)<0) cand.push(x);
  });
  return { conocido:false, sugerencia: cand.length ? cand[0] : '' };
}

// Dos estancias de la MISMA máquina se pisan si sus ventanas semiabiertas se cortan.
function _flotaTraslapa_(a, b){
  const ra=a.ret||FLOTA_INFINITO, rb=b.ret||FLOTA_INFINITO;
  return a.ing < rb && b.ing < ra;
}
// Filas de la hoja normalizadas (fechas validadas, id en mayúsculas) conservando su nº de fila real.
function _flotaFilasNorm_(){
  return getFlotaRows_().map(function(r){
    const retCrudo=(r.ret===''||r.ret==null)?'':fdate(r.ret);
    return { id:normMaqId(r.id), ing:fdateValida_(r.ing), ret:(retCrudo?fdateValida_(r.ret):''),
             retCrudo:retCrudo, tipo:String(r.tipo==null?'':r.tipo).toUpperCase().trim(),
             prog:r.prog, propiedad:String(r.propiedad==null?'':r.propiedad).trim(),
             nota:String(r.nota==null?'':r.nota).trim(), fila:r._row };
  }).filter(function(r){ return !!r.id; });   // fila en blanco: ni error ni aviso (D138)
}

/* Todas las ESTANCIAS de la hoja (no solo las vigentes: la pestaña muestra el historial) + los avisos
 * de lo que se encuentre raro. Los avisos son la mitad del valor de la pantalla: hoy `?action=maquinas`
 * ya los devuelve y NADIE los ve. */
function flotaEstancias_(fecha){
  const f=fdateValida_(fecha) || fdate(new Date());
  const filas=_flotaFilasNorm_(), avisos=[], porMaquina={}, porClave={};
  const estancias=filas.map(function(r){
    if(!r.ing) avisos.push('Fila '+r.fila+' ('+r.id+'): sin fecha_ingreso válida (yyyy-mm-dd); esa estancia se ignora.');
    if(r.retCrudo && !r.ret) avisos.push('Fila '+r.fila+' ('+r.id+'): fecha_retiro "'+r.retCrudo+'" no se entiende; se toma como si siguiera en obra.');
    if(r.ing && r.ret && r.ret<r.ing) avisos.push('Fila '+r.fila+' ('+r.id+'): fecha_retiro anterior al ingreso; esa estancia nunca está vigente.');
    if(!r.tipo) avisos.push('Fila '+r.fila+' ('+r.id+'): sin tipo; se tratará como máquina CON producción.');
    else if(MAQ_TIPOS_VALIDOS.indexOf(r.tipo)<0) avisos.push('Fila '+r.fila+' ('+r.id+'): tipo "'+r.tipo+'" no está en la lista conocida; se tratará como máquina CON producción.');
    const progHoja=parseFloat(r.prog);
    const e={ id_maquina:r.id, tipo:r.tipo, propiedad:r.propiedad, notas:r.nota, fila:r.fila,
              horas_prog:(isNaN(progHoja)||progHoja<=0) ? '' : progHoja,
              prog:(isNaN(progHoja)||progHoja<=0) ? progPorPropiedad_(r.propiedad) : progHoja,
              fecha_ingreso:r.ing, fecha_retiro:r.ret, valida:!!r.ing,
              produce: !esTipoSinProduccion(r.tipo),
              vigente: !!(r.ing && r.ing<=f && (!r.ret || f<r.ret)) };
    (porMaquina[r.id]=porMaquina[r.id]||[]).push(e);
    const k=normMaqClave_(r.id); if(k){ const l=(porClave[k]=porClave[k]||[]); if(l.indexOf(r.id)<0) l.push(r.id); }
    return e;
  });
  // Estancias de la misma máquina que se pisan (D138 ya avisaba solo de las vigentes el día consultado).
  Object.keys(porMaquina).forEach(function(id){
    const ls=porMaquina[id].filter(function(x){ return x.valida; });
    for(let i=0;i<ls.length;i++) for(let j=i+1;j<ls.length;j++){
      if(_flotaTraslapa_({ing:ls[i].fecha_ingreso, ret:ls[i].fecha_retiro}, {ing:ls[j].fecha_ingreso, ret:ls[j].fecha_retiro}))
        avisos.push('Filas '+ls[i].fila+' y '+ls[j].fila+' ('+id+'): dos estancias que se pisan. Una máquina no puede estar dos veces en obra el mismo día.');
    }
  });
  // Dos IDs distintos que colapsan al mismo normalizado: casi siempre es el typo de D111 (RT02/RT-02).
  Object.keys(porClave).forEach(function(k){
    if(porClave[k].length>1)
      avisos.push('«'+porClave[k].join('» y «')+'» se escriben distinto pero son el mismo código. '
        + 'Solo UNO puede coincidir con dim_maquinaria del maestro (D111): revisa cuál.');
  });
  // Lo mismo contra el vocabulario REAL de MAQUINARIA: un ID de la hoja que no está en el histórico y
  // se parece a uno que sí. Solo se avisa cuando HAY parecido — una máquina nueva de verdad no tiene
  // por qué salir señalada todos los días.
  const hist=idsMaquinariaHistorico_();
  Object.keys(porMaquina).forEach(function(id){
    if(hist.ids[id]) return;
    const cand=(hist.porClave[normMaqClave_(id)]||[]).filter(function(x){ return x!==id; });
    if(cand.length) avisos.push('«'+id+'» no aparece en el histórico de MAQUINARIA, pero «'+cand[0]+'» sí. '
      + 'Si son la misma máquina, el que cruza con el maestro es «'+cand[0]+'».');
  });
  return { fecha:f, estancias:estancias, avisos:avisos, filas_utiles:filas.filter(function(r){ return !!r.ing; }).length };
}

// Cuerpo de la respuesta de lectura. Se reusa tras escribir para devolver la hoja YA actualizada en la
// MISMA ejecución — que es, de paso, la prueba de que las dos memorias quedaron invalidadas.
function flotaPayload_(fecha){
  const fl=flotaEstancias_(fecha);
  return { ok:true, fecha:fl.fecha, estancias:fl.estancias, avisos:fl.avisos,
           fuente: fl.filas_utiles ? 'hoja' : 'vacia',
           tipos:MAQ_TIPOS_VALIDOS, orden_tipo:MAQ_ORDEN_TIPO,
           historico_maquinaria: idsMaquinariaHistorico_().n };
}

/* Endpoint `?action=flota&fecha=` — SOLO LECTURA: las estancias de la hoja MAQUINAS con su historial.
 * Distinto de `?action=maquinas`, que devuelve la flota VIGENTE de un día (lo que consumen las cuatro
 * capturas). Aquí hace falta el historial completo, incluidas las estancias cerradas. */
function flotaLeer(e){
  return json(flotaPayload_((e&&e.parameter)?e.parameter.fecha:''));
}

/* Guard de escritura en el SERVIDOR (D109). `body._rol` y `body._usuario_tolerado` los siembra
 * `doPost` desde el TOKEN: el cliente no puede inventárselos. */
function _permiso_(body, roles, usuarios, queEs){
  if(body && body._auth_tolerada) return {ok:true};   // AUTH_ESTRICTO=false: modo tolerante de D109
  const rol=String((body&&body._rol)||'').trim().toLowerCase();
  const usr=String((body&&body.usuario)||'').trim().toLowerCase();
  if(roles.indexOf(rol)>=0) return {ok:true};
  if(usuarios.indexOf(usr)>=0) return {ok:true};
  if(rol==='jefe') return {ok:false, error:'El jefe entra a la pantalla de Maquinaria en SOLO LECTURA: '
    + 'puede consultarlo todo, pero no '+queEs+'. No se guardó nada.'};
  return {ok:false, error:'Tu usuario no puede '+queEs+'. No se guardó nada.'};
}
function puedeEscribirFlota_(body){
  return _permiso_(body, FLOTA_ROLES_ESCRIBEN, FLOTA_USUARIOS_ESCRIBEN, 'dar de alta ni de baja máquinas');
}
function puedeAjustarProduccion_(body){
  return _permiso_(body, MAQPROD_ROLES_ESCRIBEN, [], 'ajustar la producción de maquinaria');
}

const ERROR_FECHA_INGRESO = 'La fecha de ingreso llegó vacía o con un formato que no se entiende. '
  + 'Elige el día y vuelve a guardar. No se escribió nada a propósito (D106): una estancia sin fecha '
  + 'de ingreso no está vigente ningún día y la máquina desaparecería de las capturas.';
const ERROR_FECHA_RETIRO = 'La fecha de retiro llegó con un formato que no se entiende. '
  + 'Déjala vacía si la máquina sigue en obra, o elige el PRIMER DÍA QUE YA NO ESTUVO. No se escribió nada.';

/* POST {action:'flota_guardar', op:'alta'|'baja'|'corregir', ...} — ESCRIBE la hoja MAQUINAS.
 *
 *   alta      — anexa una estancia nueva. Un REINGRESO entra por aquí (fila nueva), nunca editando la
 *               vieja: editarla borraría el hueco en que la máquina no estuvo.
 *   baja      — pone `fecha_retiro` a la estancia ABIERTA. Recordatorio que la pantalla repite: es el
 *               PRIMER DÍA QUE YA NO ESTUVO, no el último que trabajó (ventana semiabierta, D138/D85).
 *   corregir  — arregla una estancia mal escrita (fechas o datos). NO es el camino del reingreso.
 *
 * La estancia se identifica por `clave:{id_maquina, fecha_ingreso}`, NO por el número de fila.
 */
function flotaGuardar(body){
  const permiso=puedeEscribirFlota_(body);
  if(!permiso.ok) return json({ok:false, error:permiso.error});

  const op=String(body.op||'').trim().toLowerCase();
  if(['alta','baja','corregir'].indexOf(op)<0)
    return json({ok:false, error:'Operación de flota no reconocida: "'+op+'". Se esperaba alta, baja o corregir.'});

  // getSheet auto-sana los encabezados al esquema actual (D93/D100) y precede a toda escritura.
  const sh=getSheet('MAQUINAS', MAQUINAS_HEADERS);
  // `getFlotaRows_` tiene memo PROPIO (no usa `_memoHoja`), así que `invalidarHoja_` no lo alcanza:
  // sin esto se leería la hoja de antes de sanear los encabezados. Mismo problema que D107 documentó
  // para `_memoRango`, aquí en la lectura previa a la escritura.
  _flotaRows = undefined;
  const filas=_flotaFilasNorm_();
  const cRet=MAQUINAS_HEADERS.indexOf('fecha_retiro')+1;

  function fin(extra){
    invalidarHoja_('MAQUINAS');   // hoja completa + rangos acotados
    _flotaRows = undefined;       // memo propio de getFlotaRows_ (la otra memoria)
    // `_idsMaquinaria` NO se toca: es el histórico de la hoja MAQUINARIA, que esto nunca escribe.
    const out=flotaPayload_(body.fecha||'');   // lectura POSTERIOR, misma ejecución: ve lo recién escrito
    Object.keys(extra||{}).forEach(function(k){ out[k]=extra[k]; });
    return json(out);
  }

  /* ---------- baja: cerrar la estancia abierta ---------- */
  if(op==='baja'){
    const cl=body.clave||{};
    const id=normMaqId(cl.id_maquina), ing=fdateValida_(cl.fecha_ingreso);
    if(!id || !ing) return json({ok:false, error:'No llegó la estancia que se quiere cerrar (máquina + fecha de ingreso).'});
    const ret=fdateValida_(body.fecha_retiro);
    if(!ret) return json({ok:false, error:ERROR_FECHA_RETIRO});
    const halladas=filas.filter(function(r){ return r.id===id && r.ing===ing; });
    if(!halladas.length) return json({ok:false, error:'No se encontró la estancia de '+id+' con ingreso '+ing+'. '
      + 'Puede que alguien la haya cambiado en la hoja mientras tanto: vuelve a cargar la pantalla.'});
    if(halladas.length>1) return json({ok:false, error:'Hay '+halladas.length+' estancias de '+id+' con el mismo ingreso '+ing
      + ' (filas '+halladas.map(function(r){return r.fila;}).join(', ')+'). Arregla la hoja antes: la estancia se identifica por máquina + fecha de ingreso.'});
    const est=halladas[0];
    if(est.ret) return json({ok:false, error:'Esa estancia de '+id+' ya está cerrada el '+est.ret+'. '
      + 'Si la fecha está mal, usa "Corregir"; si la máquina volvió a la obra, va un ALTA nueva (nunca editar la vieja: se perdería el hueco en que no estuvo).'});
    if(ret<=ing) return json({ok:false, error:'La fecha de retiro ('+ret+') tiene que ser POSTERIOR al ingreso ('+ing+'). '
      + 'Recuerda que el retiro es el PRIMER DÍA QUE YA NO ESTUVO, no el último que trabajó.'});
    const choque=filas.filter(function(r){ return r.id===id && r.fila!==est.fila && r.ing; })
                      .filter(function(r){ return _flotaTraslapa_(r, {ing:ing, ret:ret}); });
    if(choque.length) return json({ok:false, error:'Con ese retiro la estancia se pisaría con otra de '+id
      + ' (fila '+choque[0].fila+': '+choque[0].ing+' → '+(choque[0].ret||'sigue en obra')+').'});
    sh.getRange(est.fila, cRet).setValue(ret);
    return fin({ op:'baja', id_maquina:id, fecha_ingreso:ing, fecha_retiro:ret,
                 mensaje:id+' queda fuera de la obra desde el '+ret+' (ese día ya no estuvo). '
                   + 'Los reportes anteriores no se tocan.' });
  }

  /* ---------- alta / corregir: datos completos de la estancia ---------- */
  const id=normMaqId(body.id_maquina);
  if(!id) return json({ok:false, error:'Falta el código de la máquina (id_maquina).'});
  const ing=fdateValida_(body.fecha_ingreso);
  if(!ing) return json({ok:false, error:ERROR_FECHA_INGRESO});
  const retTxt=String(body.fecha_retiro==null?'':body.fecha_retiro).trim();
  const ret=retTxt ? fdateValida_(retTxt) : '';
  if(retTxt && !ret) return json({ok:false, error:ERROR_FECHA_RETIRO});
  if(ret && ret<=ing) return json({ok:false, error:'La fecha de retiro ('+ret+') tiene que ser POSTERIOR al ingreso ('+ing+'). '
    + 'La ventana es semiabierta: el retiro es el primer día que la máquina YA NO estuvo.'});
  const tipo=String(body.tipo||'').toUpperCase().trim();
  if(MAQ_TIPOS_VALIDOS.indexOf(tipo)<0) return json({ok:false, error:'El tipo "'+(body.tipo||'')+'" no está en la lista conocida ('
    + MAQ_TIPOS_VALIDOS.join(' · ')+'). El tipo decide si la máquina lleva producción propia, así que no puede ir a ojo.'});
  const propiedad=String(body.propiedad||'').trim().toLowerCase();
  if(propiedad!=='propia' && propiedad!=='alquilada')
    return json({ok:false, error:'La propiedad tiene que ser "propia" o "alquilada": de ahí salen las horas programadas (6.4 / 5, D10).'});
  const progTxt=String(body.horas_prog==null?'':body.horas_prog).trim();
  let prog='';
  if(progTxt!==''){
    const p=parseFloat(progTxt);
    if(isNaN(p) || p<=0 || p>24) return json({ok:false, error:'Las horas programadas tienen que ser un número entre 0 y 24, o quedar vacías para deducirlas de la propiedad (5 h alquilada / 6.4 h propia, D10).'});
    prog=p;
  }
  const notas=String(body.notas==null?'':body.notas).trim();

  // Fila que se está corrigiendo (si es el caso): se excluye de los choques consigo misma.
  let filaDestino=0, original=null;
  if(op==='corregir'){
    const cl=body.clave||{};
    const cid=normMaqId(cl.id_maquina), cing=fdateValida_(cl.fecha_ingreso);
    if(!cid || !cing) return json({ok:false, error:'No llegó la estancia que se quiere corregir (máquina + fecha de ingreso).'});
    const halladas=filas.filter(function(r){ return r.id===cid && r.ing===cing; });
    if(!halladas.length) return json({ok:false, error:'No se encontró la estancia de '+cid+' con ingreso '+cing+'. '
      + 'Puede que alguien la haya cambiado en la hoja mientras tanto: vuelve a cargar la pantalla.'});
    if(halladas.length>1) return json({ok:false, error:'Hay '+halladas.length+' estancias de '+cid+' con el mismo ingreso '+cing
      + ' (filas '+halladas.map(function(r){return r.fila;}).join(', ')+'). Arregla la hoja antes: la estancia se identifica por máquina + fecha de ingreso.'});
    original=halladas[0]; filaDestino=original.fila;
  }

  // Clave duplicada: dos estancias de la misma máquina con el mismo ingreso.
  const dup=filas.filter(function(r){ return r.id===id && r.ing===ing && r.fila!==filaDestino; });
  if(dup.length) return json({ok:false, error:'Ya existe una estancia de '+id+' que empieza el '+ing+' (fila '+dup[0].fila+'). '
    + 'Si la máquina volvió después, el alta va con la fecha del REINGRESO; si esa fila está mal, corrígela.'});

  // Traslape con otra estancia de la misma máquina.
  const choque=filas.filter(function(r){ return r.id===id && r.fila!==filaDestino && r.ing; })
                    .filter(function(r){ return _flotaTraslapa_(r, {ing:ing, ret:ret}); });
  if(choque.length) return json({ok:false, error:id+' ya está en obra en ese rango (fila '+choque[0].fila+': '
    + choque[0].ing+' → '+(choque[0].ret||'sigue en obra')+'). Cierra esa estancia antes de abrir otra.'});

  // EL GUARD DE TYPOS (la razón del ítem). No escribe: pregunta.
  if(!body.confirmado){
    const s=flotaSugerencia_(id);
    if(!s.conocido){
      const msg = s.sugerencia
        ? ('«'+id+'» no aparece en el histórico de MAQUINARIA. El parecido más cercano es «'+s.sugerencia+'». ¿Es una máquina nueva de verdad?')
        : ('«'+id+'» no aparece en el histórico de MAQUINARIA ni en la hoja MAQUINAS. El código tiene que coincidir letra por letra con dim_maquinaria del maestro (D111) o el pegado a Captura_Diaria deja de cruzar en silencio. ¿Es una máquina nueva de verdad?');
      return json({ ok:false, confirmar:true, id_maquina:id, sugerencia:s.sugerencia, error:msg });
    }
  }

  const valores=[id, tipo, (prog===''?'':prog), propiedad, ing, ret, notas];
  if(op==='corregir'){
    sh.getRange(filaDestino, 1, 1, MAQUINAS_HEADERS.length).setValues([valores]);
    return fin({ op:'corregir', id_maquina:id, fecha_ingreso:ing,
                 mensaje:'Estancia de '+id+' corregida (fila '+filaDestino+').' });
  }
  ensureRows_(sh, 1);                                   // D93: capacidad antes de anexar
  sh.getRange(sh.getLastRow()+1, 1, 1, MAQUINAS_HEADERS.length).setValues([valores]);
  return fin({ op:'alta', id_maquina:id, fecha_ingreso:ing,
               mensaje:id+' entra a la obra desde el '+ing+(ret?(' y sale el '+ret):'')+'.' });
}

// Bucket de una fila de MAQUINARIA a partir de su par H/I derivado (CAPTURA_ACT_MAP). '' = no editable.
function bucketDeMaqRow(r){
  const h=String(r.actividad||'').toUpperCase(), i=String(r.sub_actividad||'').toUpperCase();
  if(h.indexOf('EXCAVACION COMUN')>=0)    return i.indexOf('NO APRO')>=0 ? 'EXC_NOAPRO' : 'EXC_APRO';
  if(h.indexOf('EXCAVACION PRESTAMO')>=0) return 'EXC_PRESTAMO';
  if(h.indexOf('TERRAPLEN')>=0)           return 'TERRAPLEN';
  if(h.indexOf('CONFORMACION')>=0)        return 'ZODME';
  return '';
}
// Bucket de una fila de DATA a partir de su CC + descripción (mismo discriminante que arriba).
function bucketDeData(cc, descripcion){
  const d=String(descripcion||'').toUpperCase();
  if(cc==='02.05') return d.indexOf('NO APRO')>=0 ? 'EXC_NOAPRO' : 'EXC_APRO';
  if(cc==='02.06') return 'EXC_PRESTAMO';
  if(cc==='02.07') return 'TERRAPLEN';
  if(cc==='02.08') return 'ZODME';
  return '';
}
// CC corto (NN.NN) desde el centro de costo de DATA (formato "3701.02.05" o "02.05").
function ccCorto(centroCosto){ const m=String(centroCosto==null?'':centroCosto).match(/(\d{2}\.\d{2})\s*$/); return m?m[1]:''; }
// Área derivada del Centro de Costo (D69) — SIN columna nueva en DATA: capítulo 06 → 'odt'
// (drenaje transversal), 07 → 'odl' (drenaje longitudinal), resto (o CC vacío) → 'tierras'.
// Acepta CC largo ("3701.06.01") o corto ("06.01"); quita el prefijo de proyecto (37xx.) antes de
// mirar el capítulo para no confundir "02.06" (préstamo, tierras) con "06.xx" (ODT).
// Espejada en los frontends que la necesitan (jefe.html deriva el área en cliente).
// Ítems "extra" de drenajes (D71): CC corto → { areas ofrecidas, capítulo verbatim de la BASE }.
// Son actividades cuyo CC NO deriva un área de drenaje por sí solo (deriveArea → 'tierras') pero que
// operan como drenaje. Se ofrecen en los reportes de drenajes de las áreas listadas; el área real de
// cada línea la fija el reporte (columna `area`), no el CC. La DESCRIPCIÓN y la UNIDAD salen verbatim
// de la BASE (no se codifican aquí). Ampliable sin tocar más código.
const EXTRA_DREN = {
  '01.02': { areas:['odt','odl'], capitulo:'DEMOLICIONES Y REUBICACIONES' } // Demolición de Estructuras
};
/* D113c — VARIANTES DE ACTIVIDAD por MATERIAL en drenajes (CC corto → nombres de actividad).
 * El mismo caso del terraplén de tierras (D113), traído a drenajes: el ítem contractual es UNO
 * ("Rellenos con material seleccionado", 06.02) y lo que hay que distinguir es CON QUÉ MATERIAL se
 * hizo. En drenajes el catálogo es vivo desde la BASE y hasta ahora la actividad ERA la descripción
 * del ítem (`actividad = it.desc` en los dos frontends), así que no había dónde poner la distinción.
 * Estas variantes se sirven en `?action=drenajes` como opciones ADICIONALES del mismo ítem: mismo CC,
 * misma DESCRIPCION verbatim de la BASE y misma unidad — solo cambia el campo `actividad`.
 * Consecuencias buscadas:
 *   · la fila que llega a DATA NO cambia (A–T idéntico: el maestro sigue viendo el ítem contractual);
 *     la distinción viaja en la columna INTERNA `actividad`, igual que en tierras,
 *   · se ve en la captura, el panel del residente de drenajes, su WhatsApp y el "Desglosar por
 *     actividad" del panel del jefe (D113), que agrupa justo por esa columna,
 *   · el acumulado por ODT (`acumulado_drenajes`) suma las variantes junto al ítem, que es lo
 *     correcto: contractualmente son el mismo ítem.
 * Ampliable sin tocar más código: agregar el CC corto y sus nombres. Los nombres quedan grabados en
 * BANDEJA y DATA, así que cambiarlos después parte el histórico en dos (mismo aviso que en D113). */
const VARIANTES_DREN = {
  // 06.02 = "Rellenos con material seleccionado" (ODT). El nombre sin variante sigue siendo el del
  // ítem: quien rellena con material normal no ve ningún cambio.
  '06.02': ['Relleno con crudo de río', 'Relleno de UF3']
};
function deriveArea(cc){
  const c=String(cc==null?'':cc).trim();
  if(!c) return 'tierras';
  const sin=c.replace(/^\d{4}\./,'');
  if(sin.indexOf('06.')===0) return 'odt';
  if(sin.indexOf('07.')===0) return 'odl';
  return 'tierras';
}
// Área de una fila leída de BANDEJA/MAQUINARIA: manda la columna `area` si trae un valor válido;
// si no (filas viejas, area=''), se deriva del CC (BANDEJA) o se asume tierras (MAQUINARIA no lleva CC).
function areaDeFila(areaCol, cc){
  const a=String(areaCol==null?'':areaCol).trim().toLowerCase();
  if(a==='odt'||a==='odl') return a;
  return deriveArea(cc);
}
/* Área(s) de la observación GENERAL de un reporte (D86).
 * La observación no cuelga de una línea, así que su área se deriva de las líneas del envío: se
 * devuelven las áreas distintas que aparecen, en lista separada por comas ('odt,odl' cuando un
 * capataz multi-área reporta los dos capítulos, D84). Reporte sin líneas => 'tierras' (el
 * comportamiento de siempre, y el único que existía antes de esta columna). */
function areasDeReporte(cantidades){
  const set={}, out=[];
  (cantidades||[]).forEach(function(c){ const a=areaDeFila(c.area, c.centro_costo); if(!set[a]){ set[a]=true; out.push(a); } });
  return out.length ? out.sort().join(',') : 'tierras';
}
/* ¿La observación (columna `area` de OBSERVACIONES) pertenece al área consultada? (D86)
 * Columna vacía = fila anterior a D86 = tierras. */
function obsEnArea(areaCol, areaQ){
  const raw=String(areaCol==null?'':areaCol).trim().toLowerCase();
  const lista = raw ? raw.split(',').map(function(s){ return s.trim(); }).filter(function(s){ return !!s; }) : ['tierras'];
  return lista.indexOf(areaQ)>=0;
}

// GET: panorama del día. Cruza el volumen oficial de DATA (por proyecto+bucket) con las filas de
// MAQUINARIA del día. Devuelve:
//  - frentes[]: buckets ajustables (02.05-08) con su oficial, los PK oficiales de DATA, sus máquinas
//    (id_registro interno, PK del capataz y horas) y el indicador multi-actividad; aparecen aunque NO
//    tengan máquina (oficial>0).
//  - otras[]: máquinas productivas en CC no ajustables (subbase/base/BTC/MSR/desmonte) en LECTURA.
//  - flota_produccion[]: máquinas que generan producción (para redirigir producción huérfana, D60).
//  - faltantes[]: flota requerida sin reporte ese día, para registrar sus horas manualmente (D61).
function maquinariaProduccion(e){
  const fecha=fdate(e.parameter.fecha);
  getSheet('MAQUINARIA', MAQ_HEADERS); // auto-sana encabezados al layout D52 (+ produccion_capataz_orig)
  function pkRange(pki,pkf){ const a=String(pki==null?'':pki).trim(), b=String(pkf==null?'':pkf).trim();
    if(a&&b&&b!==a) return a+'–'+b; return a||b||''; }
  // Volúmenes y PK oficiales de DATA por proyecto|bucket (solo LECTURA; jamás se escribe DATA aquí)
  const dataVol={}, dataPk={};
  {
    const v=filasCrudasPorFecha_('DATA', fecha, C.FECHA+1).map(function(x){ return x.v; });   // D107
    for(let i=0;i<v.length;i++){
      const cc=ccCorto(v[i][3]); if(!MAQ_PROD_CC[cc]) continue;
      const b=bucketDeData(cc, v[i][5]); if(!b) continue;       // col F = DESCRIPCION
      const key=String(v[i][7]||'')+'|'+b;                      // col H = PROYECTO
      dataVol[key]=(dataVol[key]||0)+(parseFloat(v[i][C.LARGO])||0);
      const pk=pkRange(v[i][25], v[i][26]);                     // cols Z/AA internas = pk_inicial/pk_final
      if(pk){ (dataPk[key]=dataPk[key]||[]); if(dataPk[key].indexOf(pk)<0) dataPk[key].push(pk); }
    }
  }
  // PK del capataz por id de cantidad (BANDEJA): la fila de MAQUINARIA enlaza con id_cantidad.
  const banPk={};
  readSheetPorFecha_('BANDEJA', fecha).forEach(r=>{ banPk[String(r.id_registro||'')]=pkRange(r.pk_inicial, r.pk_final); });   // D107
  // Todas las filas de MAQUINARIA del día (para presentes/faltantes) y las que generan producción.
  const todas=readSheetPorFecha_('MAQUINARIA', fecha);   // D107
  const presentes={}; todas.forEach(r=>{ if(r.id_maquina) presentes[r.id_maquina]=1; });
  const producen=todas.filter(r=> !esTipoSinProduccion(r.app_tipo_equipo) && String(r.cap_actividad||'')!=='APOYO');
  function rowLabel(r){ const b=bucketDeMaqRow(r); return b?MAQ_BUCKETS[b].label:(r.cap_actividad||r.actividad||'—'); }
  function rowHoras(r){ const ho=r.horas_operadas; return (ho===''||ho==null)?'':ho; }
  // multi-actividad (D46): todas las actividades del día por id_maquina
  const actsPorMaq={};
  producen.forEach(r=>{ const id=r.id_maquina||''; (actsPorMaq[id]=actsPorMaq[id]||[]).push(rowLabel(r)); });
  // Frentes ajustables: unión de buckets con oficial>0 y buckets con máquina presente
  const fMap={}, fOrder=[];
  function ensureF(proy,b){ const k=proy+'|'+b;
    if(!fMap[k]){ const m=MAQ_BUCKETS[b]; fMap[k]={proyecto:proy,bucket:b,cc:m.cc,label:m.label,tipo:m.tipo,oficial:0,_filas:[]}; fOrder.push(k); }
    return fMap[k]; }
  Object.keys(dataVol).forEach(k=>{ const p=k.slice(0,k.indexOf('|')), b=k.slice(k.indexOf('|')+1); ensureF(p,b).oficial=dataVol[k]; });
  const otras=[];
  producen.forEach(r=>{
    const b=bucketDeMaqRow(r);
    if(b){ ensureF(String(r.proyecto||''),b)._filas.push(r); }
    else { otras.push({ id_maquina:r.id_maquina||'', actividad:r.cap_actividad||r.actividad||'—',
      produccion_actual:(r.produccion===''||r.produccion==null)?'':r.produccion, unidad:r.unidad_prod||'',
      reporta:r.reporta||'', pk:banPk[String(r.id_cantidad||'')]||'', horas:rowHoras(r) }); }
  });
  const frentes=fOrder.map(k=>{
    const f=fMap[k], n=f._filas.length;
    // Prellenado proporcional a lo que cada máquina reportó (D62): como multi-máquina muestra el
    // TOTAL de la actividad (D36), repartir por reportado equivale a partes iguales (oficial÷n) cuando
    // todas marcan lo mismo, y al 100% si es una sola. Respaldo a partes iguales si no hay reportado.
    const sumRep=f._filas.reduce((s,r)=> s+(parseFloat(r.produccion)||0), 0);
    const filas=f._filas.map(r=>{
      const rep=parseFloat(r.produccion)||0;
      const prefill = sumRep>0 ? Math.round(f.oficial*rep/sumRep*100)/100 : Math.round((f.oficial/(n||1))*100)/100;
      const orig=r.produccion_capataz_orig;
      const otrasAct=(actsPorMaq[r.id_maquina]||[]).filter(x=>x!==f.label);
      return { id_registro:String(r.app_id_registro||''), id_maquina:r.id_maquina||'',
        actividad:r.cap_actividad||r.actividad||f.label, tipo_equipo:r.app_tipo_equipo||'',
        produccion_actual:(r.produccion===''||r.produccion==null)?'':r.produccion,
        produccion_orig:(orig===''||orig==null)?'':orig, prefill:prefill, otras_actividades:otrasAct,
        pk:banPk[String(r.id_cantidad||'')]||'', horas:rowHoras(r) };
    });
    return { proyecto:f.proyecto, bucket:f.bucket, cc:f.cc, label:f.label, tipo:f.tipo,
      oficial:f.oficial, n_maquinas:n, pk_oficial:(dataPk[k]||[]), filas:filas };
  });
  // D138: la flota sale de la hoja MAQUINAS VIGENTE ESE DÍA (respaldo al catálogo en código), así
  // que consultar una fecha vieja no lista como faltante una máquina que entonces no estaba.
  const fl=flotaEnFecha_(fecha);
  const flota_produccion=Object.keys(fl.catalogo).filter(id=>!esTipoSinProduccion(fl.catalogo[id].tipo))
    .map(id=>({ id_maquina:id, tipo:fl.catalogo[id].tipo, prog:fl.catalogo[id].prog, reportada: !!presentes[id] }));
  const faltantes=fl.esperadas.filter(id=>!presentes[id])
    .map(id=>({ id_maquina:id, tipo:(fl.catalogo[id]||{}).tipo||'', prog:(fl.catalogo[id]||{}).prog||'' }));
  return json({ok:true, fecha, frentes, otras, flota_produccion, faltantes,
                flota_fuente:fl.fuente, flota_avisos:fl.avisos});
}

// POST: (1) parcha la col T (producción) de filas existentes (ajustes[]) guardando el estimado
// original del capataz en produccion_capataz_orig la PRIMERA vez; (2) crea filas nuevas (nuevas[])
// para redirigir producción huérfana a una máquina (D60). ESCRIBE SOLO MAQUINARIA: nunca DATA/BANDEJA.
function maquinariaProduccionGuardar(body){
  // D139: el rol se comprueba en el SERVIDOR, no solo en el guard del cliente. La pantalla la abren
  // ahora también el residente (edita), `jeisson` (solo la pestaña de flota) y el jefe (solo lectura).
  const permiso=puedeAjustarProduccion_(body);
  if(!permiso.ok) return json({ok:false, error:permiso.error});
  // D106: las filas NUEVAS de este panel llevan la fecha del payload a MAQUINARIA.
  const fecha=fdateValida_(body.fecha), ajustes=body.ajustes||[], nuevas=body.nuevas||[];
  if(!fecha) return json({ok:false, error:ERROR_FECHA});
  const sh=getSheet('MAQUINARIA', MAQ_HEADERS);
  const v=sh.getDataRange().getValues(), h=v[0];
  const idCol=h.indexOf('app_id_registro'), fCol=h.indexOf('fecha');
  const prodCol=h.indexOf('produccion'), origCol=h.indexOf('produccion_capataz_orig');
  if(idCol<0 || prodCol<0 || origCol<0) return json({ok:false, error:'Columnas de MAQUINARIA no encontradas'});
  // 1) parchar producción de filas existentes
  const map={}; ajustes.forEach(a=>{ if(a && a.id_registro!=null && a.id_registro!=='') map[String(a.id_registro)]=a; });
  let upd=0;
  for(let i=1;i<v.length;i++){
    const id=String(v[i][idCol]||''); if(!id || !map[id]) continue;
    if(fecha && fCol>=0 && fdate(v[i][fCol])!==fecha) continue; // guard: solo filas del día
    const a=map[id];
    const pf=parseFloat(a.produccion);
    const prod=isNaN(pf) ? (a.produccion==null?'':a.produccion) : pf;
    const orig=v[i][origCol];
    if(orig==='' || orig==null) sh.getRange(i+1, origCol+1).setValue(v[i][prodCol]); // 1ª vez: original
    sh.getRange(i+1, prodCol+1).setValue(prod);
    upd++;
  }
  // 2) crear filas nuevas. Tres formas (layout Captura A→AA + internos, D52):
  //    - con bucket: producción redirigida a una máquina (D60), con horas/motivo opcionales.
  //    - con complem: actividad complementaria SIN producción (cereo/apoyo) para una faltante (D62).
  //    - solo horas: registro de horas de una máquina sin reporte por ningún medio (D61).
  // Si trabajó menos que lo programado, el motivo deriva las horas muertas y el ESTADO (D12/D13).
  const ts=new Date(), reporta=body.usuario||'(ajuste-prod)';
  const catFecha=flotaEnFecha_(fecha).catalogo;   // D138: flota vigente el día que se está ajustando
  const maqRows=[];
  nuevas.forEach(nv=>{
    const idM=String(nv.id_maquina||'').toUpperCase(); if(!idM) return;
    const cat=catFecha[idM]; if(!cat) return;                   // máquina fuera de la flota de ese día: se ignora
    const b  = nv.bucket  ? MAQ_BUCKETS[nv.bucket]   : null;  if(nv.bucket  && !b)  return;
    const cx = nv.complem ? MAQ_COMPLEM[nv.complem]  : null;  if(nv.complem && !cx) return;
    // actividad de la fila
    const H = b?b.h:(cx?cx.h:''), I = b?b.i:(cx?cx.i:'');
    const aCap = b?'SI':(cx?cx.aCaptura:'NO'), capLabel = b?b.label:(cx?cx.label:'');
    // producción: solo en frente y si la máquina genera producción (vibros/minis nunca, D41/D44)
    let prod='';
    if(b && !esTipoSinProduccion(cat.tipo)){ const pf=parseFloat(nv.produccion); prod=isNaN(pf)?'':pf; }
    // horas operadas (opcional) + motivo: deriva muertas = prog − operadas y ESTADO (D13)
    const ho=parseFloat(nv.horas);
    const horasOper = isNaN(ho) ? '' : ho;
    const motivo = String(nv.motivo||'');
    const muertas = (horasOper==='') ? '' : Math.round(Math.max(0, (parseFloat(cat.prog)||0) - horasOper)*100)/100;
    const estado  = (horasOper==='') ? 'OPERANDO' : derivarEstado(motivo, muertas);
    const esMant  = motivo.trim().toLowerCase().indexOf('mantenimiento')>=0;
    const hMant   = (esMant && horasOper!=='') ? muertas : '';   // O horas_mantenimiento (D52)
    if(!b && !cx && horasOper==='') return;                      // nada que registrar
    const obs = b ? 'Producción redirigida (panel)' : cx ? ('Complementaria: '+capLabel+' (panel)') : 'Horas registradas (panel)';
    maqRows.push([
      // A vacío · B fecha · C vacío · D proyecto · E id_maquina · F vacío · G operador
      '', fecha, '', String(nv.proyecto||''), idM, '', (nv.operador||''),
      // H actividad · I sub · J-K vacío · L horas_operadas · M vacío
      H, I, '', '', horasOper, '',
      // N vacío · O h_mantenimiento · P-Q vacío · R estado · S vacío
      '', hMant, '', '', estado, '',
      // T produccion · U-Z vacío · AA observacion
      prod, '', '', '', '', '', '', obs,
      // internos: app_id · id_cantidad · ts · reporta · app_tipo · app_hprog · app_hmuertas
      Utilities.getUuid(), '', ts, reporta, cat.tipo, cat.prog, muertas,
      // motivo · unidad_prod · cap_actividad · a_captura · produccion_capataz_orig · area (panel=tierras)
      motivo, (prod===''?'':'m3'), capLabel, aCap, '', '']);
  });
  if(maqRows.length){ ensureRows_(sh, maqRows.length);   // D93: capacidad antes de escribir
    sh.getRange(sh.getLastRow()+1,1,maqRows.length,MAQ_HEADERS.length).setValues(maqRows); }
  return json({ok:true, actualizadas:upd, creadas:maqRows.length});
}

/* ---------- D130 — el clima viaja al maestro por la OBSERVACION ----------
 * EL PROBLEMA. D37 guardó el clima en una columna INTERNA de DATA (`clima`, tras `area`) porque el
 * maestro TM2 no tiene columna de clima y el paste es A:S. Perfecto para el WhatsApp y para el resumen
 * del jefe... e inútil para el Excel: lo que se pega termina en A:S, así que el clima se quedaba en el
 * Sheet y el maestro nunca se enteraba. El dueño necesita justo eso: que otra tabla del Excel lea el
 * clima del día y se actualice sola.
 *
 * LA SOLUCIÓN. No se inventa una columna nueva en el maestro (rompería el paste A:S y las dinámicas):
 * el clima se estampa dentro de la OBSERVACION (col S) de UNA fila del día — la primera del envío —
 * con un sello ACOTADO Y LITERAL, `[Clima: X]`, al principio del texto:
 *
 *     [Clima: Lluvias parciales] · origen Masivo 2 · 18 viajes → Terraplén 252 m³
 *
 * Por qué así:
 *   · **Delimitado** (`[` … `]`) para que la fórmula del Excel extraiga el valor sin depender de dónde
 *     esté ni de qué venga detrás: entre `[Clima: ` y el `]`. Un sello sin cierre obligaría a adivinar
 *     dónde termina el clima y dónde empieza la observación del capataz.
 *   · **Al principio**, no al final: la observación de la chequeadora ya es larga (origen · viajes ·
 *     destinos, D67/D80) y el sello quedaría fuera de la vista en la celda.
 *   · **Una sola fila**, no todas: es un dato POR DÍA, no por línea. Repetirlo en 40 filas ensucia la
 *     observación de cada actividad y no aporta nada — a la tabla del Excel le basta con encontrarlo
 *     una vez en el día (BUSCAR/FILTRO sobre las filas de la fecha).
 *   · **No sustituye la columna interna** `clima`: esa se sigue escribiendo igual y es la que leen el
 *     WhatsApp y `jefe.html`. Aquí solo se AÑADE el camino hacia el maestro.
 *   · **Idempotente**: si la observación ya trae un sello (reenvío del día, copiar-pegar manual), se
 *     quita antes de poner el nuevo. Nunca se acumulan dos.
 * La observación original del capataz NO se pierde: queda tras el sello, separada por " · " como el
 * resto de los tramos que ya concatena la observación (mismo separador de D67/D80).
 *
 * ATENCIÓN: `CLIMA_SELLO_PREFIJO` y los tres valores de `CLIMA_OPS` (encargado.html) son el contrato
 * con la fórmula del Excel. Cambiar cualquiera de los dos obliga a cambiar la fórmula del maestro. */
const CLIMA_SELLO_PREFIJO = '[Clima: ';
const CLIMA_SELLO_RE = /\[Clima:\s*[^\]]*\]\s*(?:·\s*)?/gi;   // sello previo (reenvío) — se reemplaza
function sellarClimaEnObservacion_(rows, clima){
  if(!rows || !rows.length || !clima) return;
  const previa = String(rows[0][C.OBS]==null ? '' : rows[0][C.OBS]).replace(CLIMA_SELLO_RE, '').trim();
  rows[0][C.OBS] = CLIMA_SELLO_PREFIJO + clima + ']' + (previa ? ' · ' + previa : '');
}

/* ---------- enviar lo aprobado a DATA ---------- */
// D69 (enmienda operativa de D03): pisa el día POR ÁREA, no completo. Al enviar el área X se
// borran/reescriben en DATA solo las filas de esa FECHA cuyo deriveArea(CENTRO DE COSTO, col D)
// sea X, y la bandeja se marca incluido/descartado SOLO para esa área. Así el residente ODT no
// borra lo de tierras ni lo de ODL (y viceversa). body.area viene del rol que envía; si falta
// (frontend viejo en caché) se asume 'tierras', el único emisor que existía antes de drenajes.
function enviarData(body){
  // D106: la más delicada de las tres — la col A de DATA es la FECHA del maestro TM2 (paste A:S), y
  // además el borrado de abajo se hace POR FECHA: con la fecha vacía se borrarían las filas huérfanas
  // de otro envío fallido en vez del día que se quiere pisar.
  const fecha=fdateValida_(body.fecha), incluidas=body.cantidades||[], ts=new Date();
  if(!fecha) return json({ok:false, error:ERROR_FECHA});
  const aB=String(body.area||'').trim().toLowerCase();
  const area=(aB==='odt'||aB==='odl'||aB==='tierras') ? aB : 'tierras';
  // D37 → D130: clima del día que elige el encargado (mismo string en todas las filas del envío). Se
  // sella en la columna interna `clima` de DATA (no viaja al maestro) y ADEMÁS se estampa en la
  // OBSERVACION de la primera fila del día, que sí viaja (col S del paste A:S).
  const clima=String(body.clima||'').trim();
  /* D130 — el clima es OBLIGATORIO en tierras. Deja de ser un adorno del WhatsApp: una tabla del Excel
   * maestro lo lee del sello de la observación, así que un día sin clima llega incompleto al maestro y
   * hay que rehacer el envío. `encargado.html` ya no deja pulsar el botón sin él; esta guarda es la que
   * hace que la regla sea REAL (un teléfono con la pantalla vieja en caché seguiría enviando sin clima,
   * y ese es justo el caso que rompe el maestro en silencio). No se toca la fecha ni se borra nada: se
   * rechaza ANTES del pisado de D03, así que un envío rechazado deja el día tal como estaba.
   * DRENAJES queda fuera: `residente-drenajes.html` no captura clima (D70) y exigírselo bloquearía
   * ODT/ODL sin que nadie pueda cumplirlo. */
  if(area==='tierras' && !clima){
    return json({ok:false, error:'Falta el clima del día. No se envió nada a DATA (el día quedó como estaba). '
      + 'Elige el clima en el panel y vuelve a enviar; si no ves el selector, recarga la pantalla.'});
  }
  // 1) DATA: borrar el día SOLO en el área que envía, y reescribir. El área de una fila de DATA la
  // fija su columna interna `area` (D71); las filas viejas (col vacía) caen a deriveArea(CC) vía
  // areaDeFila, así que su clasificación no cambia. Esto permite que la demolición (CC 01.02, que
  // deriva 'tierras') se pise por ODT/ODL y NO por el envío de tierras.
  const sh=getSheet('DATA', DATA_HEADERS);
  // D107 (backlog 3.6/4.11): antes se leía DATA ENTERA y se borraba con `deleteRow` UNA FILA A LA VEZ
  // (un día de 40 filas = 40 llamadas al servicio de Sheets). Ahora se leen SOLO las tres columnas que
  // deciden —FECHA (A), CENTRO DE COSTO (D) y la interna `area`—, que caben en un bloque contiguo, y
  // el borrado va por TRAMOS contiguos (normalmente 1 llamada: el día se escribió junto).
  // El predicado es idéntico al de antes; solo cambia cuánto se lee para evaluarlo.
  const dAreaCol=DATA_HEADERS.indexOf('area');
  const dDesde=Math.min(C.FECHA, 3, dAreaCol), dHasta=Math.max(C.FECHA, 3, dAreaCol);
  const lastD=sh.getLastRow(), del=[];
  if(lastD>1){
    const anchoD=Math.min(dHasta-dDesde+1, sh.getMaxColumns()-dDesde);
    const dv=leerRango_(sh, 2, dDesde+1, lastD-1, anchoD);
    for(let i=0;i<dv.length;i++){
      const fila=dv[i];
      if(fdate(fila[C.FECHA-dDesde])===fecha && areaDeFila(fila[dAreaCol-dDesde], fila[3-dDesde])===area) del.push(i+2);
    }
  }
  borrarFilas_(sh, del);
  // Guard: solo se escriben filas del área que envía (una fila de otra área colada en el payload
  // duplicaría datos que este envío NO borró). El área de la línea manda por su columna `area`
  // (D71); si falta, se deriva del CC. Las de otra área se ignoran sin error.
  const rows=incluidas.filter(c=>c.estado!=='no_data' && areaDeFila(c.area, c.centro_costo)===area)
    .map(c=> buildDataRow(Object.assign(c,{clima:clima}), fecha, ts, c.reporta||'(encargado)', c.rol||'encargado', Utilities.getUuid()));
  sellarClimaEnObservacion_(rows, clima);   // D130: el clima viaja al maestro por la col S
  // D93: el borrado de arriba usa deleteRow, que además REDUCE getMaxRows(); validar la capacidad
  // antes de reescribir el día es justo lo que evitaba que DATA dejara de recibir al llenarse.
  if(rows.length){ ensureRows_(sh, rows.length);
    sh.getRange(sh.getLastRow()+1,1,rows.length,DATA_HEADERS.length).setValues(rows); }
  // 2) BANDEJA: marcar incluido / descartado SOLO las filas de esa área
  const banSh=getSheet('BANDEJA', BANDEJA_HEADERS);
  // D107: las filas del día se traen ya acotadas (readSheetPorFecha_ memoriza, así que si el panel
  // las leyó en esta misma ejecución no cuesta una celda). El estado se sigue escribiendo celda a
  // celda porque son las filas de UN día y no son contiguas en columna: el ahorro está en la lectura.
  const bh=BANDEJA_HEADERS, eCol=bh.indexOf('estado');
  const inc={}; incluidas.forEach(c=>{ if(c.id_registro) inc[c.id_registro]=1; });
  readSheetPorFecha_('BANDEJA', fecha).forEach(function(r){
    if(areaDeFila(r.area||'', r.centro_costo||'')!==area) return;
    banSh.getRange(r._row, eCol+1).setValue(inc[r.id_registro]?'incluido':'descartado');
  });
  return json({ok:true, enviadas:rows.length, area:area});
}

/* ============ D109 — AUTENTICACIÓN POR TOKEN FIRMADO (backlog 2.25) ============
 *
 * EL AGUJERO QUE CIERRA. Hasta D108 el rol vivía en el navegador y el backend se creía la identidad
 * que le mandaba el cliente (`e.parameter.usuario`, `body.usuario`). Dos consecuencias, las dos
 * comprobadas sobre este mismo código: cualquiera podía escribir `rol: admin` en el almacenamiento de
 * su navegador y entrar al menú; y, peor, la URL del Apps Script está en el código de 13 pantallas, así
 * que se podía llamar a los endpoints desde una terminal diciendo «soy la residente» — sin contraseña.
 * Los cerrojos de área (D69h/D101) eran decorativos frente a eso: el área se derivaba del usuario que
 * el propio cliente declaraba. D108 sacó las claves del archivo público, pero NO arregló nada de esto.
 *
 * CÓMO SE CIERRA. Al entrar, el backend emite un TOKEN que lleva dentro `usuario·rol·áreas` y va
 * FIRMADO con HMAC-SHA256 usando un secreto que vive en las Propiedades del Script — ni en la hoja, ni
 * en el repositorio, ni en el navegador. Cada petición lo trae; cada endpoint verifica la firma y saca
 * la identidad DEL TOKEN, ignorando lo que diga el cliente. Sin el secreto no se puede fabricar ni
 * alterar un token: cambiarle un byte al rol invalida la firma.
 *
 * POR QUÉ NO CADUCA POR TIEMPO — esto es lo que lo hace compatible con el modo sin conexión (D82).
 * Un reporte capturado el viernes en zona muerta puede pasar el fin de semana en la cola del teléfono
 * y subirse el lunes. Con un token «válido 24 h» ese reporte sería rechazado y, como la cola solo
 * suelta lo que el servidor confirma, se quedaría atascado para siempre reintentando. Así que el token
 * no vence por reloj: vence por VERSIÓN.
 *   · `AUTH_V` (Propiedades del Script) — subirlo invalida TODOS los tokens de golpe. Es el botón de
 *     «sacar a todo el mundo» (teléfono perdido). Hay que subirlo en LOS DOS proyectos.
 *   · `estado` en la hoja `USUARIOS` (D108) — ponerlo distinto de `activo` deja fuera a UNA persona.
 *     Efecto inmediato en el backend de obra, que es el que tiene la hoja.
 *
 * CONSECUENCIA QUE HAY QUE SABER: si sacas a alguien que tiene reportes pendientes en su teléfono,
 * esos reportes ya no suben. Antes de dar de baja a alguien, mirar que su contador esté en cero.
 *
 * `AUTH_ESTRICTO` es la válvula: en `false` se aceptan peticiones sin token válido y solo se anotan en
 * el registro (útil para ver qué teléfono sigue con la app vieja). Se despliega en `true`.
 */
const AUTH_ESTRICTO = true;

/* ¿Este proyecto EMITE tokens o solo los verifica? Solo hay UN emisor: el de obra, que es donde vive
 * la hoja `USUARIOS` y donde ocurre el login. Importa porque las Propiedades del Script son POR
 * PROYECTO, no globales: si el verificador se autogenerara su propio secreto, firmaría distinto que
 * el emisor y rechazaría TODOS los tokens buenos. Por eso el emisor lo crea y el verificador exige
 * que se lo hayan copiado — y si no está, lo dice con todas las letras en vez de inventarse uno. */
const AUTH_EMISOR = true;

function _authProps_(){ return PropertiesService.getScriptProperties(); }
/* El secreto NUNCA sale del servidor por la API. Para rotarlo: borrar la propiedad `AUTH_SECRETO` en
 * los DOS proyectos y volver a copiarla; todos los tokens dejan de valer y la gente entra otra vez. */
function authSecreto_(){
  const p=_authProps_(); let s=p.getProperty('AUTH_SECRETO');
  if(!s){
    if(!AUTH_EMISOR) return '';                       // verificador sin secreto: NO se inventa uno
    s=Utilities.getUuid()+'-'+Utilities.getUuid(); p.setProperty('AUTH_SECRETO', s);
  }
  return s;
}
/* Se ejecuta A MANO desde el editor del proyecto EMISOR (obra) para leer el secreto y copiarlo al de
 * asistencias con `fijarSecretoAuth`. Es el único momento en que el secreto se mira. */
function mostrarSecretoAuth(){
  const s=authSecreto_();
  Logger.log('AUTH_SECRETO = ' + s);
  Logger.log('Cópialo y ejecuta fijarSecretoAuth("'+s+'") en el proyecto de Asistencias.');
  return s;
}
/* Fija el secreto a mano (se usa en el proyecto VERIFICADOR). También sirve aquí para rotarlo. */
function fijarSecretoAuth(valor){
  const v=String(valor||'').trim();
  if(v.length<20) throw new Error('El secreto llegó vacío o demasiado corto. Cópialo de mostrarSecretoAuth() en el proyecto de obra.');
  _authProps_().setProperty('AUTH_SECRETO', v);
  return 'AUTH_SECRETO fijado. Los tokens emitidos por el otro proyecto ya se validan aquí.';
}
function authVersion_(){ return String(_authProps_().getProperty('AUTH_V') || '1'); }
function _b64url_(bytes){ return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/,''); }
function _firmar_(txt){
  return _b64url_(Utilities.computeHmacSha256Signature(txt, authSecreto_(), Utilities.Charset.UTF_8));
}
function emitirToken_(usuario, rol, areas){
  const carga={ u:String(usuario||''), r:String(rol||''), a:areas||[], v:authVersion_(), t:Date.now() };
  const p=_b64url_(Utilities.newBlob(JSON.stringify(carga)).getBytes());
  return p+'.'+_firmar_(p);
}
/* Verifica FIRMA primero y solo después interpreta el contenido: nunca se parsea algo no firmado. */
function verificarToken_(tok){
  const s=String(tok||''), i=s.indexOf('.');
  if(i<1) return {ok:false, error:'Falta el token de sesión. Vuelve a entrar.'};
  const carga=s.slice(0,i), firma=s.slice(i+1);
  if(_firmar_(carga)!==firma) return {ok:false, error:'Sesión no válida. Vuelve a entrar.'};
  let o;
  try{ o=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(carga)).getDataAsString()); }
  catch(err){ return {ok:false, error:'Sesión ilegible. Vuelve a entrar.'}; }
  if(String(o.v)!==authVersion_()) return {ok:false, error:'Sesión cerrada por el administrador. Vuelve a entrar con señal.'};
  return {ok:true, usuario:String(o.u||'').trim().toLowerCase(), rol:String(o.r||''), areas:Array.isArray(o.a)?o.a:[]};
}
/* Punto ÚNICO de autenticación: lo llaman doGet y doPost, nadie más. Devuelve la sesión REAL, la que
 * sale del token; el resto del archivo puede seguir usando `usuario` como siempre porque los puntos de
 * entrada lo sobrescriben con este valor. */
function sesion_(e, body){
  // Diagnóstico explícito: sin secreto configurado NADA validaría, y el error genérico («vuelve a
  // entrar») mandaría a todo el mundo a dar vueltas al login sin que nadie entienda qué pasa.
  if(!authSecreto_()) return {ok:false, error:'El servidor no tiene configurado AUTH_SECRETO. '
    + 'Ejecuta mostrarSecretoAuth() en el Apps Script de obra y fijarSecretoAuth("…") en este.'};
  const tok = (body && body.token) || (e && e.parameter && e.parameter.token) || '';
  const r = tok ? verificarToken_(tok) : {ok:false, error:'Falta el token de sesión. Vuelve a entrar.'};
  if(r.ok) return r;
  if(!AUTH_ESTRICTO){
    Logger.log('AUTH tolerante: petición aceptada SIN token válido ('+r.error+') — action='
      + ((body && body.action) || (e && e.parameter && e.parameter.action) || '?'));
    return {ok:true, usuario:'', rol:'', tolerado:true};
  }
  return r;
}

/* ============ D108 — LOGIN VALIDADO EN EL BACKEND (backlog 2.21) ============
 *
 * EL PROBLEMA. Hasta ahora el mapa `USUARIOS` con las contraseñas EN CLARO vivía dentro de
 * `index.html`. GitHub Pages sirve el archivo tal cual, así que cualquiera con la URL podía leer
 * todas las claves del sistema con «ver código fuente». No hacía falta ni entrar.
 *
 * QUÉ ARREGLA Y QUÉ NO — dicho sin adornos, para que no se lea como más de lo que es:
 *   · SÍ: las claves salen del archivo público. Pasan a la hoja privada `USUARIOS` de este Sheet.
 *   · NO: esto NO convierte el sistema en autenticado. Los endpoints siguen abiertos a quien tenga la
 *     URL del Apps Script, y quien sepa lo que hace puede escribir `rol: admin` en el almacenamiento
 *     de su navegador. Blindar eso de verdad es un token en cada petición validado en los DOS
 *     backends, y choca con la cola sin señal (un reporte encolado se envía horas después, con un
 *     token que tendría que seguir siendo válido). Es otro proyecto; 2.21 no lo pide.
 *
 * LA HOJA `USUARIOS` (privada, solo el dueño del Sheet la ve):
 *   usuario · clave · rol · areas · redirige · estado
 *   · `clave` admite las dos formas y el login lo detecta solo: texto plano (para arrancar rápido) o
 *     el hash SHA-256 de `usuario:clave` en hex (64 caracteres). `endurecerClaves()` convierte en el
 *     sitio todo lo que esté en claro. El hash lleva el USUARIO dentro a propósito: dos personas con
 *     la misma contraseña no producen el mismo hash.
 *   · `areas` es la lista separada por comas (`odt,odl`) del campo opcional de D84.
 *   · `estado` vacío o `activo` = puede entrar; cualquier otra cosa (p. ej. `inactivo`) lo bloquea
 *     SIN borrar la fila — el equivalente al `estado` de CUADRILLAS (D84), para las salidas tipo UF3.
 *
 * LAS CLAVES NO SE SIEMBRAN DESDE EL CÓDIGO. `setupUsuarios()` crea la hoja con usuario/rol/areas/
 * redirige (que no son secretos) y deja `clave` VACÍA a propósito: sembrarlas aquí las devolvería al
 * repositorio, que es justo de lo que se trata salir. Se pegan a mano una vez y se corre
 * `endurecerClaves()`.
 *
 * OFFLINE (D82) — el punto delicado. Como `start_url` del PWA es `index.html` y esa pantalla siempre
 * pedía credenciales, mover la validación aquí dejaría a un capataz fuera en zona muerta. El frontend
 * lo resuelve por su lado (reconoce la sesión guardada y recuerda un hash local tras el primer login
 * CON señal); este endpoint no tiene estado y no necesita saber nada de eso.
 */
const USUARIOS_HEADERS = ['usuario','clave','rol','areas','redirige','estado'];

// SHA-256 de `usuario:clave` en hex minúscula. El `& 0xff` es obligatorio: computeDigest devuelve
// bytes CON SIGNO (-128..127) y sin la máscara los negativos salen como 'ffffffxx'.
function hashClave_(usuario, clave){
  const txt = String(usuario||'').trim().toLowerCase() + ':' + String(clave==null?'':clave);
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, txt, Utilities.Charset.UTF_8);
  let hex='';
  for (let i=0;i<bytes.length;i++) hex += ('0' + (bytes[i] & 0xff).toString(16)).slice(-2);
  return hex;
}
const _ES_HASH = /^[0-9a-f]{64}$/;

// POST {action:'login', usuario, clave} -> {ok, rol, areas, redirige} | {ok:false, error}
function login(body){
  const u = String(body.usuario||'').trim().toLowerCase();
  const c = String(body.clave==null?'':body.clave);
  if(!u || !c) return json({ok:false, error:'Faltan el usuario o la contraseña.'});
  const filas = readSheet('USUARIOS').filter(function(r){ return String(r.usuario||'').trim().toLowerCase()===u; });
  // Mensaje ÚNICO para usuario inexistente, clave mala o cuenta inactiva: si se distinguieran, la
  // pantalla serviría para averiguar qué usuarios existen.
  const malo = json({ok:false, error:'Usuario o contraseña incorrectos.'});
  if(!filas.length) return malo;
  const r = filas[0];
  const estado = String(r.estado||'').trim().toLowerCase();
  if(estado && estado!=='activo') return malo;
  const guardada = String(r.clave==null?'':r.clave).trim();
  if(!guardada) return malo;                                  // fila sin clave cargada todavía
  const ok = _ES_HASH.test(guardada) ? (hashClave_(u, c)===guardada) : (guardada===c);
  if(!ok) return malo;
  const areas = String(r.areas||'').split(',').map(function(x){ return x.trim().toLowerCase(); }).filter(Boolean);
  const rol = String(r.rol||'').trim();
  // D109: el token FIRMADO es lo que a partir de ahora acredita quién eres y qué rol tienes. El
  // cliente lo guarda y lo adjunta a cada petición; no puede alterarlo sin romper la firma.
  return json({ ok:true, usuario:u, rol:rol, areas:areas,
                redirige:String(r.redirige||'').trim() || 'menu.html',
                token: emitirToken_(u, rol, areas) });
}

/* Se ejecuta UNA VEZ desde el editor. Crea `USUARIOS` con la plantilla de roles/redirecciones/áreas
 * —que no son secretos— y la columna `clave` VACÍA. Si la hoja ya tiene filas, no toca nada.
 * Después: pegar las contraseñas a mano en la columna `clave` y ejecutar `endurecerClaves()`. */
function setupUsuarios(){
  const sh=getSheet('USUARIOS', USUARIOS_HEADERS);
  if(sh.getLastRow()>1){ Logger.log('USUARIOS ya tiene datos: no se toca nada.'); return; }
  const filas=[
    ['admin','','admin','','menu.html','activo'],
    ['encargado','','encargado','','encargado.html','activo'],
    ['residente','','residente','','residente.html','activo'],
    ['jefe','','jefe','','jefe.html','activo'],
    ['angel','','capataz','','seleccion-reporte.html','activo'],
    ['alejo','','capataz','','seleccion-reporte.html','activo'],
    ['robinson','','capataz','','seleccion-reporte.html','activo'],
    // D145: `albert` vuelve de UF3 a tierras (UF1/UF2) con su rol de siempre. Va DIRECTO a su reporte
    // de obra —no a `seleccion-reporte.html`— porque la asistencia de la cuadrilla ALBERT la siguen
    // reportando `maleja`/`maria` (D84(3)/D134): la pantalla de selección le mostraría un solo tile
    // útil y otro que no le traería a nadie. Si algún día recupera su cuadrilla, esta celda pasa a
    // `seleccion-reporte.html` y se quita la exclusión que hay en esa pantalla.
    ['albert','','capataz','','reporte-capataz.html','activo'],
    ['mauricio','','capataz_odt','odt,odl','seleccion-reporte.html','activo'],
    ['eduardo','','capataz_odt','odt,odl','seleccion-reporte.html','activo'],
    ['enrique','','capataz_odt','odt,odl','seleccion-reporte.html','activo'],
    ['jairo','','capataz_odl','odt,odl','seleccion-reporte.html','activo'],
    ['residente_dren','','residente_dren','','seleccion-reporte.html','activo'],
    ['maleja','','chequeadora','','seleccion-reporte.html','activo'],
    ['mairy','','chequeadora','','seleccion-reporte.html','activo'],
    // D134 (TEMPORAL, vacaciones de `maleja`): `maria` pasa a `seleccion-reporte.html` para poder entrar
    // también a la asistencia de la cuadrilla ALBERT. Al volver `maleja`: `reporte-chequeadora.html`.
    ['maria','','chequeadora','','seleccion-reporte.html','activo'],
    ['luzdary','','chequeadora','','seleccion-reporte.html','activo'],
    ['jeisson','','asistencia_plus','','seleccion-reporte.html','activo'],
    ['duvan','','asistencia_plus_dren','odt,odl','seleccion-reporte.html','activo'],
    ['residente_uf3','','asistencia_plus_uf3','uf3','seleccion-reporte.html','activo'],
    ['digitadora','','digitadora','','digitadora.html','activo']
  ];
  ensureRows_(sh, filas.length);
  sh.getRange(2,1,filas.length,USUARIOS_HEADERS.length).setValues(filas);
  invalidarHoja_('USUARIOS');
  Logger.log('USUARIOS creada con '+filas.length+' filas y la columna `clave` VACÍA. '
    +'Pega las contraseñas en la columna B y ejecuta endurecerClaves().');
}

/* Convierte a hash SHA-256 toda `clave` que esté en texto plano. Idempotente: lo que ya es hash se
 * deja igual, así que se puede correr las veces que haga falta (p. ej. tras cambiarle la clave a
 * alguien). Escribe SOLO la columna `clave`. */
function endurecerClaves(){
  const sh=getSheet('USUARIOS', USUARIOS_HEADERS);
  const last=sh.getLastRow();
  if(last<2){ Logger.log('USUARIOS vacía.'); return 0; }
  const uCol=USUARIOS_HEADERS.indexOf('usuario')+1, cCol=USUARIOS_HEADERS.indexOf('clave')+1;
  const v=leerRango_(sh,2,1,last-1,USUARIOS_HEADERS.length);
  let n=0;
  for(let i=0;i<v.length;i++){
    const u=String(v[i][uCol-1]||'').trim(), c=String(v[i][cCol-1]==null?'':v[i][cCol-1]).trim();
    if(!u || !c || _ES_HASH.test(c)) continue;                 // vacía o ya endurecida
    sh.getRange(i+2, cCol).setValue(hashClave_(u, c));
    n++;
  }
  invalidarHoja_('USUARIOS');
  Logger.log('Claves endurecidas: '+n+'. Las que ya eran hash se dejaron igual.');
  return n;
}

/* ===========================================================================
 * TABLERO DE PRODUCCIÓN — la foto, compartida (D158)
 *
 * POR QUÉ EXISTE ESTO. `tablero-produccion.html` calcula la foto en el
 * navegador leyendo los dos Excel. Eso servía para quien pulsaba el botón y
 * para nadie más: el resultado se quedaba en SU localStorage. El jefe y los
 * residentes seguían viendo la copia que venía dentro del archivo.
 *
 * Aquí la foto pasa a estar en el Sheet, así que quien la publica la publica
 * PARA TODOS y en el momento. Es el mismo patrón del resto del sistema —
 * GitHub Pages + Apps Script + Sheets—; no hay pieza nueva de infraestructura.
 *
 * POR QUÉ EN TROZOS. Una celda de Sheets admite 50.000 caracteres y la foto
 * ronda los 95.000, así que se parte en trozos de 40.000. Cada trozo va
 * prefijado con `~`: sin eso, un trozo que empezara por `=` lo guardaría Sheets
 * como FÓRMULA y se perdería en silencio. El prefijo se quita al leer.
 *
 * QUIÉN PUEDE PUBLICAR: admin y jefe. Los dos manejan los Excel de origen. El
 * guard es el del servidor (D109), no el del cliente: el rol sale del token
 * firmado, así que escribir `rol: admin` en el navegador no sirve de nada.
 *
 * QUIÉN PUEDE LEERLA: cualquiera (D159). El tablero se comparte por enlace con
 * los directivos, que no tienen usuario, así que `action=tablero` se despacha
 * en doGet ANTES de la puerta de sesión. Lo que devuelve son cifras de obra —no
 * hay personas en la foto— y no escribe nada. Asimétrico a propósito: leer es
 * de todos, publicar es de dos.
 * =========================================================================*/
const TABLERO_HEADERS = ['orden','texto'];
const TABLERO_TROZO   = 40000;
const TABLERO_ROLES_PUBLICAN = ['admin','jefe'];

function puedePublicarTablero_(body){
  return _permiso_(body, TABLERO_ROLES_PUBLICAN, [], 'publicar la foto del tablero');
}

// GET ?action=tablero -> {ok, foto:{...}|null, meta:{...}}   SIN token: lectura pública (D159).
// Sin foto publicada devuelve foto:null y el tablero se queda con la suya: nunca una pantalla vacía.
function tableroLeer(){
  const ss=ss_(), sh=ss.getSheetByName('TABLERO');
  if(!sh || sh.getLastRow()<2) return json({ok:true, foto:null, meta:null});
  const v=leerRango_(sh, 2, 1, sh.getLastRow()-1, TABLERO_HEADERS.length);
  const trozos=[]; let meta=null;
  for(let i=0;i<v.length;i++){
    const orden=Number(v[i][0]), txt=String(v[i][1]==null?'':v[i][1]);
    const limpio = txt.charAt(0)==='~' ? txt.slice(1) : txt;
    if(orden===0){ try{ meta=JSON.parse(limpio); }catch(err){ meta=null; } continue; }
    if(orden>0) trozos[orden-1]=limpio;
  }
  // Un trozo que falte deja un JSON roto: mejor no devolver nada que devolver medio.
  for(let i=0;i<trozos.length;i++) if(trozos[i]==null) return json({ok:true, foto:null, meta:meta, error:'foto incompleta'});
  const crudo=trozos.join('');
  if(!crudo) return json({ok:true, foto:null, meta:meta});
  let foto=null;
  try{ foto=JSON.parse(crudo); }catch(err){ return json({ok:true, foto:null, meta:meta, error:'foto ilegible'}); }
  return json({ok:true, foto:foto, meta:meta});
}

// POST {action:'tablero_guardar', foto:{...}} -> {ok, meta}
function tableroGuardar(body){
  const permiso=puedePublicarTablero_(body);
  if(!permiso.ok) return json({ok:false, error:permiso.error});
  const foto=body && body.foto;
  if(!foto || !foto.per || !foto.per.length) return json({ok:false, error:'La foto llegó vacía o sin períodos. No se guardó nada.'});
  const crudo=JSON.stringify(foto);
  const trozos=[];
  for(let i=0;i<crudo.length;i+=TABLERO_TROZO) trozos.push(crudo.slice(i, i+TABLERO_TROZO));
  const meta={ generado:String(foto.generado||''), publicado:fdate(new Date()),
               usuario:String(body.usuario||''), periodos:foto.per.length,
               caracteres:crudo.length, trozos:trozos.length };
  const sh=getSheet('TABLERO', TABLERO_HEADERS);
  // Se limpia lo anterior ANTES de escribir: una foto nueva más corta que la vieja dejaría
  // trozos huérfanos al final y el JSON saldría con basura pegada.
  const last=sh.getLastRow();
  if(last>1) sh.getRange(2,1,last-1,TABLERO_HEADERS.length).clearContent();
  const filas=[[0, '~'+JSON.stringify(meta)]];
  for(let i=0;i<trozos.length;i++) filas.push([i+1, '~'+trozos[i]]);
  ensureRows_(sh, filas.length);
  sh.getRange(2,1,filas.length,TABLERO_HEADERS.length).setValues(filas);
  invalidarHoja_('TABLERO');
  return json({ok:true, meta:meta});
}

/* ---------- debug ---------- */
function debug(e){
  const fechaQ=fdate(e.parameter.fecha||'');
  const ban=readSheetPorFecha_('BANDEJA', fechaQ);   // D107
  const data=readSheet('DATA') ? '' : '';
  return json({version:'v11', sheetTZ:shTZ(), queryFecha:fechaQ, bandejaFilas:ban.length,
    muestra: ban.slice(0,5).map(r=>({reporta:r.reporta, rol:r.rol, actividad:r.actividad, pk:r.pk_inicial, largo:r.largo, estado:r.estado})) });
}

/* ---------- MIGRACIÓN ÚNICA: DESCRIPCION de DATA verbatim de la BASE (D68) ----------
 * Pasada única sobre las filas YA existentes en DATA (el app no reescribe lo histórico: solo pisa
 * el día que se reenvía, D03). NO es un endpoint: se corre A MANO desde el editor de Apps Script
 * (no requiere redesplegar, basta guardar el archivo):
 *   1) previsualizarDescripcionesData() -> solo registra en el Log lo que cambiaría; NO escribe nada.
 *      (Ver > Registro de ejecución / Executions para leer la salida.)
 *   2) actualizarDescripcionesData()    -> aplica los cambios, escribiendo SOLO la columna F
 *      (DESCRIPCION) de las filas que difieren.
 * Usa el MISMO lookupDescripcion del flujo normal: cruce por Centro de Costo (col D) contra la
 * tabla de ítems A–H de la BASE; el 02.05 se desambigua con la descripción actual de la fila.
 * Si el CC no tiene ítem en la BASE, la fila se deja como está (no inventa). No toca ninguna otra
 * columna (ELEMENTO/ABS históricos quedan igual), ninguna otra hoja, ni los .xlsx maestros (D24). */
function previsualizarDescripcionesData(){ _descripcionesDataPass(false); }
function actualizarDescripcionesData(){ _descripcionesDataPass(true); }
// Diagnóstico de la tabla de ítems de la BASE: correr a mano desde el editor cuando el cruce de
// DESCRIPCION no tome la celda esperada. Registra qué columnas detectó (encabezados A–H), las
// llaves CC encontradas y TODOS los candidatos de las llaves que contengan '02.08' (o cámbiese el
// filtro abajo). No escribe nada en ninguna hoja.
/**
 * D93 — Diagnóstico de CAPACIDAD de la grilla. Ejecutar desde el editor de Apps Script y revisar el
 * log (Ver > Registro de ejecución). Muestra, por hoja: filas usadas / filas totales / columnas
 * usadas / columnas totales y cuántas filas libres quedan. NO escribe datos: es solo lectura.
 */
function diagnosticoCapacidad() {
  var ss = ss_();
  ss.getSheets().forEach(function (sh) {
    Logger.log(
      sh.getName() + ' → filas ' + sh.getLastRow() + '/' + sh.getMaxRows() +
      ' (libres ' + (sh.getMaxRows() - sh.getLastRow()) + ')' +
      ' · cols ' + sh.getLastColumn() + '/' + sh.getMaxColumns()
    );
  });
}
function diagnosticoBase(){
  const ss=ss_(), sh=ss.getSheetByName('BASE');
  if(!sh){ Logger.log('No existe la hoja BASE.'); return; }
  const v=sh.getDataRange().getValues();
  Logger.log('BASE: '+v.length+' filas × '+v[0].length+' columnas.');
  const letras='ABCDEFGHIJKL';
  for(let r=0;r<Math.min(3, v.length);r++)
    for(let j=0;j<Math.min(12, v[r].length);j++)
      Logger.log('Celda '+letras.charAt(j)+(r+1)+' = '+JSON.stringify(String(v[r][j]==null?'':v[r][j])));
  getBaseData();
  const cols=_baseItemCols||{cc:-1,desc:-1,filaEnc:0};
  Logger.log('Fila de encabezados detectada: '+(cols.filaEnc>0?cols.filaEnc:'NINGUNA')+
             ' · columna CC: '+(cols.cc>=0?letras.charAt(cols.cc):'NINGUNA')+
             ' · columna DESCRIPCION: '+(cols.desc>=0?letras.charAt(cols.desc):'NINGUNA'));
  if(cols.cc>=0 && cols.desc>=0){
    for(let i=cols.filaEnc;i<Math.min(cols.filaEnc+3, v.length);i++)
      Logger.log('Muestra fila '+(i+1)+': CC='+JSON.stringify(String(v[i][cols.cc]))+' · DESC='+JSON.stringify(String(v[i][cols.desc])));
  }
  const items=getBaseItems(), keys=Object.keys(items);
  Logger.log('Llaves CC en el mapa ('+keys.length+'): '+keys.map(k=>k+'×'+items[k].length).join(' | '));
  keys.forEach(k=>{
    if(k.indexOf('02.08')<0) return;                     // <- cambiar aquí para inspeccionar otro CC
    items[k].forEach((it,x)=>Logger.log('Candidato '+k+' #'+(x+1)+': '+JSON.stringify(String(it.desc))));
  });
  Logger.log('lookupDescripcion("3701.02.08", "Conformación y disposición de sobrantes") -> '+
    JSON.stringify(String(lookupDescripcion('3701.02.08','Conformación y disposición de sobrantes'))));
}
function _descripcionesDataPass(aplicar){
  const ss=ss_(), sh=ss.getSheetByName('DATA');
  if(!sh || sh.getLastRow()<2){ Logger.log('DATA vacía: nada que hacer.'); return; }
  const v=sh.getDataRange().getValues();
  const items=getBaseItems();
  let cambia=0, igual=0, sinItem=0;
  for(let i=1;i<v.length;i++){
    const cc=v[i][3], desc=v[i][5];                     // D = CENTRO DE COSTO, F = DESCRIPCION
    const hayItem = cc!=null && cc!=='' && !!(items[String(cc).trim()] || items[ccCorto(cc)]);
    if(!hayItem){ sinItem++; continue; }                // CC sin ítem en la BASE -> se deja como está
    const nueva=lookupDescripcion(cc, desc);
    if(nueva===desc){ igual++; continue; }              // ya es byte-idéntica a la BASE
    cambia++;
    Logger.log('fila '+(i+1)+' [CC '+cc+'] '+JSON.stringify(String(desc))+' -> '+JSON.stringify(String(nueva)));
    if(aplicar) sh.getRange(i+1, 6).setValue(nueva);    // SOLO col F (DESCRIPCION), verbatim de la BASE
  }
  Logger.log((aplicar?'APLICADO.':'PREVISUALIZACIÓN (no se escribió nada).')+
    ' Filas revisadas: '+(v.length-1)+' · cambiadas: '+cambia+' · ya idénticas: '+igual+' · sin ítem en BASE: '+sinItem);
}
