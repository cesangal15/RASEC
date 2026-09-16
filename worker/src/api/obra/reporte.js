/**
 * api/obra/reporte.js — RECEPCIÓN del reporte de OBRA (capataz · chequeadora · drenajes) portada al
 * Worker (4.01 · Fase 4 · D180).
 *
 * Es backend/Codigo.gs L1150–L1385 (guardarReporte) + el bloque de derivación de Captura_Diaria
 * L106–L157 (CAPTURA_ACT_MAP / CAPTURA_APOYO_MAP / derivarActividad / derivarEstado) + los esquemas de
 * payload de OBRA L2923–L2952 (VAL_OBRA_* y valEquiposCapataz_), con los MISMOS nombres y la MISMA
 * lógica, pero escribiendo en Postgres (tablas `bandeja`, `maquinaria`, `volquetas`, `observaciones`)
 * en vez de en las hojas BANDEJA / MAQUINARIA / VOLQUETAS / OBSERVACIONES:
 *
 *   POST (sin `action`)  TOKEN  → guardarReporte: 1..n filas a BANDEJA (+ ZODME automático), MAQUINARIA
 *                                 (equipos del capataz + maquinaria de la chequeadora), VOLQUETAS
 *                                 (desglose por placa, D53) y OBSERVACIONES (observación general, D86).
 *
 * Qué cambia respecto al .gs y por qué (informe §3 Fase 4):
 *   · La capa de datos: `getSheet(...).setValues(...)` → `INSERT INTO …` (una consulta por fila). TODO
 *     el envío va en UNA transacción `c.sql.begin` (decisión 10), sin lock. No hay `ensureRows_` ni
 *     `getSheet`: las tablas no crecen a mano (D93 deja de aplicar).
 *   · Dedupe D82: `idsExistentes` (leer id_registro + fecha de la hoja) → un SELECT por tabla del día,
 *     SOLO cuando el payload trae ids (misma condición traeIds* del .gs). Además, cada INSERT de BANDEJA
 *     y MAQUINARIA lleva `ON CONFLICT (obra_id, id_registro|app_id_registro) DO NOTHING` como red para
 *     el reenvío que llega EN PARALELO (igual que parteReporte): una fila que choca cuenta como
 *     duplicada, no como guardada. Los conteos de la respuesta (cantidades/maquinas/volquetas =
 *     total del reporte; guardadas/duplicadas = escritas/saltadas) salen idénticos cuando no hay carrera.
 *   · VOLQUETAS (decisión 2): PK surrogate `volqueta_id` (002_fases_3_4.sql), varias filas comparten el
 *     `id_registro` de la LÍNEA. El dedupe es por LÍNEA: `volIds` (id_registro ya guardados ese día) →
 *     una línea ya guardada NO reescribe sus placas y todas cuentan como duplicadas (idsExistentes
 *     L1138). INSERT sin ON CONFLICT (el surrogate nunca choca). `cubicaje_origen` = 'catalogo' cuando
 *     la placa está en CUBICAJE, 'default' cuando cae al factor del reporte (14 o body.m3viaje).
 *   · Los catálogos (CUBICAJE, PARTE_EQUIPOS+MAQUINAS para el tipo) se leen por PETICIÓN con memo_
 *     (cubicajeMap_, equiposCapatazMapa_ de catalogos.js). `equiposCapatazMapa_` es async: se carga una
 *     vez, de forma perezosa, igual que el `eqMapa` del .gs (solo si un equipo llega sin tipo).
 *   · `ts = new Date()` es UNO por envío: la misma marca para todas las filas (como el .gs).
 *   · Numéricos: '' / undefined → NULL (regla 3 del esquema); `largo||0` → 0. Textos → '' (NOT NULL).
 *
 * Todo lo que es NEGOCIO (dedupe por id, cubicaje real por placa D53, excavación acumulada al origen /
 * Botadero de la chequeadora Problema 2.12 / D67, ZODME automático D58, áreas por línea D69/D71,
 * maquinaria de la chequeadora D54/D177, observación sellada con áreas D86, layout MAQUINARIA A→AA D52)
 * está copiado tal cual, con los mismos mensajes y las mismas claves de respuesta.
 *
 * No hay guard de rol: guardarReporte acepta cualquier token (L1119). `reporta`/`capataz` NO se tocan
 * (atribución de la línea); salen del body, no de la sesión. La sesión (`ses`) solo la usa el router
 * (LOG e identidad). La validación D166 (VAL_OBRA_REPORTE/CANTIDAD/EQUIPO/VOLQUETA/PLACA) la corre el
 * router con `validarReporte_` ANTES de despachar (rama 'reporte' de validarPayloadObra_ L3001–L3031).
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 */
import { OBRA_ID, json, fdateValida_, rechazoPayload_, valEsquema_, valListaDe_, valArray_, valTexto_,
         VAL_MAX_HORAS, VAL_MAX_CANTIDAD } from '../../comun.js';
import { cubicajeMap_, normPlaca, esTipoSinProduccion, equiposCapatazMapa_ } from '../../catalogos.js';
import { areaDeFila, areasDeReporte } from './areas.js';

/* ---------- Codigo.gs L1150–L1156: mensaje literal de D106 (sin fecha válida no se escribe nada) ----------
 * En el .gs es la constante ERROR_FECHA (Codigo.gs L2762). Se copia aquí como privada para no depender
 * de otro módulo (regla dura de archivos); el router también la conoce por su propio VAL_OBRA_REPORTE. */
const ERROR_FECHA = 'La fecha llegó vacía o con un formato que no se entiende. Elige el día del reporte y '
  + 'vuelve a enviarlo. No se guardó nada a propósito (D106): un reporte sin fecha no lo vería nadie.';

/* ======================================================================================================
 * Codigo.gs L120–L157 — derivación de Captura_Diaria (05_CATALOGO §1/§5, D52). Cálculo puro.
 * ====================================================================================================== */
// Mapa actividad del capataz → [actividad(H), SUB ACTIVIDAD(I)] de Captura_Diaria (D52).
export const CAPTURA_ACT_MAP = {
  'Excavación aprovechable (masivo)':                 ['EXCAVACION COMUN','EXCAVACION APROVECHABLE'],
  'Excavación no aprovechable':                       ['EXCAVACION COMUN','EXCAVACION NO APROVECHABLE'],
  'Excavación de préstamo (Diviso)':                  ['EXCAVACION PRESTAMO','EXCAVACION APROVECHABLE'],
  'Núcleo de terraplén':                              ['TERRAPLEN','NUCLEO DE TERRAPLEN'],
  'Corona de terraplén':                              ['TERRAPLEN','CORONA DE TERRAPLEN'],
  // D113 — terraplén por MATERIAL (crudo de río / UF3): mismo ítem 02.07, sin SUB propia → NUCLEO DE
  // TERRAPLEN (si no, derivarActividad devolvería a_captura='NO' y esas máquinas dejarían de pasar).
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
// Apoyo de compactación: hereda H/I del frente que apoya (sub_actividad del catálogo del capataz).
export const CAPTURA_APOYO_MAP = {
  'COMPACT_TERRAPLEN': ['TERRAPLEN','NUCLEO DE TERRAPLEN'],
  'COMPACT_SUBBASE':   ['SUBBASE','CONFORMACION SUBBASE'],
  'COMPACT_BTC':       ['BASE','BTC']
};
// Deriva {h, i, aCaptura} de la actividad del capataz (c). Sin par definido → a_captura='NO'
// (paisajeo, adecuación de caminos, limpieza de derrumbe, MSR, pedraplén).
export function derivarActividad(c){
  if((c.actividad||'')==='APOYO'){
    const sub=c.sub_actividad||'';
    if(CAPTURA_APOYO_MAP[sub]) return {h:CAPTURA_APOYO_MAP[sub][0], i:CAPTURA_APOYO_MAP[sub][1], aCaptura:'SI'};
    return {h:'', i:'', aCaptura:'NO'}; // paisajeo / adecuación / derrumbe
  }
  const par=CAPTURA_ACT_MAP[c.actividad||''];
  if(par) return {h:par[0], i:par[1], aCaptura:'SI'};
  return {h:'', i:'', aCaptura:'NO'}; // MSR, pedraplén, sin par
}
// Deriva R (ESTADO) del motivo (05_CATALOGO §5, D52). Sin horas muertas → OPERANDO. (No lo usa
// guardarReporte —MAQUINARIA escribe R en blanco, D171/D177— pero es del bloque L106–L157 y lo usan
// api/obra/data.js / maquinaria_produccion; vive aquí con derivarActividad.)
export function derivarEstado(motivo, muertas){
  if(!(parseFloat(muertas)>0.01)) return 'OPERANDO';
  const m=(motivo||'').trim().toLowerCase();
  if(!m) return 'OPERANDO';
  if(m.indexOf('mantenimiento')>=0) return 'MANTENIMIENTO';
  if(m.indexOf('falla')>=0)         return 'VARADO';
  if(m.indexOf('sin operador')>=0)  return 'SIN OPERADOR';
  if(m.indexOf('lluvia')>=0 || m.indexOf('clima')>=0) return 'LLUVIAS';
  if(m.indexOf('bloqueo')>=0)       return 'BLOQUEO';
  return 'ESPERA'; // Sin frente / Esperando material / Abastecimiento / Traslado / Otro / texto libre
}

/* ======================================================================================================
 * Codigo.gs L2923–L2952 — esquemas de payload de OBRA (D166). Se exportan para el router (rama 'reporte'
 * de validarPayloadObra_). VAL_OBRA_CANTIDAD/EQUIPO usan los topes de comun.js (VAL_MAX_*).
 * ====================================================================================================== */
export const VAL_OBRA_EQUIPO = {
  id_registro:['t',100], id_maquina:['t',50], operador:['t',200], tipo_equipo:['t',100], motivo:['t',300],
  horas_operadas:['n',0,VAL_MAX_HORAS], horas_programadas:['n',0,VAL_MAX_HORAS], horas_muertas:['n',0,VAL_MAX_HORAS]
};
// D171: `equipos` de una línea del capataz = lista de códigos ('CR026') o de objetos con el esquema de
// arriba. horas_operadas/operador/motivo/programadas/muertas siguen SOLO para que un payload viejo (cola
// offline, D82) pase la validación; guardarReporte los ignora.
export function valEquiposCapataz_(arr, nombre){
  const m=valArray_(arr, 200); if(m) return { campo:nombre, motivo:m };
  if(!arr) return null;
  for(let i=0;i<arr.length;i++){
    const e=arr[i]; if(e===null || e===undefined) continue;
    if(typeof e==='string' || typeof e==='number'){ const t=valTexto_(String(e), 50); if(t) return { campo:nombre+'['+i+']', motivo:t }; continue; }
    const f=valEsquema_(e, VAL_OBRA_EQUIPO, nombre+'['+i+']'); if(f) return f;
  }
  return null;
}
export const VAL_OBRA_CANTIDAD = {
  id_registro:['t',100], grupo:['t'], capitulo:['t'], actividad:['t'], descripcion:['t'], centro_costo:['t',100],
  unidad:['t',20], uf:['t',20], proyecto:['t',20], elemento:['t'], pk_inicial:['t',50], pk_final:['t',50],
  abs_inicial:['t',50], abs_final:['t',50], liberacion:['t',50], observacion:['tl'], origen:['t'], area:['t',20],
  nota_libre:['tl'], unidad_maquina:['t',20], destino_conf:['t'], clima:['t',100], estado:['t',30],
  reporta:['t',100], rol:['t',50], capataz:['t',100],
  largo:['n',0,VAL_MAX_CANTIDAD], prod_maquina:['n',0,VAL_MAX_CANTIDAD],
  personal_oficiales:['e',0,1000], personal_ayudantes:['e',0,1000], turno_noche:['b'], equipos:['a',200]
};
export const VAL_OBRA_VOLQUETA = { id_registro:['t',100], origen:['t'], destino:['t'], tipo_destino:['t',50], uf:['t',20], placas:['a',300] };
export const VAL_OBRA_PLACA    = { placa:['t',20], viajes:['n',0,1000] };
export const VAL_OBRA_REPORTE  = { fecha:['f',0], capataz:['t',100], rol:['t',50], observacion_general:['tl'], id_reporte:['t',100],
                                   m3viaje:['n',0,100], cantidades:['a'], volquetas:['a'], maquinaria:['a',200] };

/* Codigo.gs L3001–L3031 (rama 'reporte' de validarPayloadObra_): valida el payload del reporte (D166) y
 * devuelve la respuesta de rechazo lista para `return`, o null si pasa. La corre el router ANTES de
 * despachar (mismo orden de comprobaciones que el .gs). Se exporta para no duplicar los esquemas allí. */
export function validarReporte_(c, body){
  let f = valEsquema_(body, VAL_OBRA_REPORTE, '');
  if(!f) f = valListaDe_(body.cantidades, VAL_OBRA_CANTIDAD, 'cantidades');
  if(!f && Array.isArray(body.cantidades)){
    for(let i=0;i<body.cantidades.length && !f;i++){ const cc=body.cantidades[i]; if(!cc) continue; f=valEquiposCapataz_(cc.equipos, 'cantidades['+i+'].equipos'); }
  }
  if(!f) f = valListaDe_(body.volquetas, VAL_OBRA_VOLQUETA, 'volquetas');
  if(!f && Array.isArray(body.volquetas)){
    for(let i=0;i<body.volquetas.length && !f;i++){ const l=body.volquetas[i]; if(!l) continue; f=valListaDe_(l.placas, VAL_OBRA_PLACA, 'volquetas['+i+'].placas', 300); }
  }
  if(!f) f = valEquiposCapataz_(body.maquinaria, 'maquinaria');
  return f ? rechazoPayload_(c, f.campo, f.motivo) : null;
}

/* ======================================================================================================
 * helpers privados (bordes numérico/texto → columnas del esquema) y clave de equipo
 * ====================================================================================================== */
function t_(v){ return v==null ? '' : String(v); }                        // texto NOT NULL DEFAULT ''
function numNulo_(v){                                                       // numeric: '' / undefined / NaN → NULL
  if(v===null || v===undefined || v==='') return null;
  if(typeof v==='number') return isFinite(v) ? v : null;
  const n=Number(String(v).trim().replace(/\s/g,'').replace(',','.'));
  return isFinite(n) ? n : null;
}
function numOr0_(v){ const n=numNulo_(v); return n===null ? 0 : n; }        // `largo||0` del .gs
function claveMaq_(id){ return String(id==null?'':id).replace(/[^A-Za-z0-9]/g,'').toUpperCase(); }

// idsExistentes (Codigo.gs L1138–L1149): ids ya guardados ESA fecha en una tabla → { id: 1 }. Un SELECT
// de la columna id + filtro por fecha en SQL (el índice *_fecha_idx); ids vacíos no cuentan.
async function idsDelDia_(c, filas){
  const out={}; filas.forEach(function(r){ const s=String(r.id==null?'':r.id); if(s!=='') out[s]=1; }); return out;
}
async function banIdsDia_(c, fecha){ return idsDelDia_(c, (await c.sql`SELECT id_registro AS id FROM bandeja WHERE obra_id=${OBRA_ID} AND fecha=${fecha}`)); }
async function maqIdsDia_(c, fecha){ return idsDelDia_(c, (await c.sql`SELECT app_id_registro AS id FROM maquinaria WHERE obra_id=${OBRA_ID} AND fecha=${fecha}`)); }
async function volIdsDia_(c, fecha){ return idsDelDia_(c, (await c.sql`SELECT id_registro AS id FROM volquetas WHERE obra_id=${OBRA_ID} AND fecha=${fecha}`)); }

/* ---------- INSERT por fila (una transacción; ON CONFLICT DO NOTHING = D82 en carrera) ---------- */
async function insBandeja_(sql, o){
  const r=await sql`INSERT INTO bandeja (obra_id, id_registro, "timestamp", fecha, reporta, rol, grupo, capitulo, actividad,
      descripcion, centro_costo, unidad, uf, proyecto, elemento, pk_inicial, pk_final, abs_inicial, abs_final, liberacion,
      largo, observacion, estado, origen, area, personal_oficiales, personal_ayudantes, turno_noche, nota_libre)
    VALUES (${OBRA_ID}, ${o.id_registro}, ${o.ts}, ${o.fecha}, ${t_(o.reporta)}, ${t_(o.rol)}, ${t_(o.grupo)}, ${t_(o.capitulo)}, ${t_(o.actividad)},
      ${t_(o.descripcion)}, ${t_(o.centro_costo)}, ${t_(o.unidad)}, ${t_(o.uf)}, ${t_(o.proyecto)}, ${t_(o.elemento)}, ${t_(o.pk_inicial)}, ${t_(o.pk_final)}, ${t_(o.abs_inicial)}, ${t_(o.abs_final)}, ${t_(o.liberacion)},
      ${o.largo}, ${t_(o.observacion)}, ${t_(o.estado)}, ${t_(o.origen)}, ${t_(o.area)}, ${numNulo_(o.personal_oficiales)}, ${numNulo_(o.personal_ayudantes)}, ${t_(o.turno_noche)}, ${t_(o.nota_libre)})
    ON CONFLICT (obra_id, id_registro) DO NOTHING RETURNING id_registro`;
  return r.length>0;
}
async function insMaq_(sql, o){
  const r=await sql`INSERT INTO maquinaria (obra_id, id_registro, fecha, dia, proyecto, id_maquina, tipo_equipo, operador,
      actividad, sub_actividad, unidad, horas_programadas, horas_operadas, pct_util, horas_muertas, horas_mantenimiento,
      pct_muerto, horas_facturadas, estado, clima, produccion, meta, pct_ef, rendimiento, unitario, viajes, costo, observacion,
      app_id_registro, id_cantidad, "timestamp", reporta, app_tipo_equipo, app_horas_programadas, app_horas_muertas, motivo,
      unidad_prod, cap_actividad, a_captura, produccion_capataz_orig, area)
    VALUES (${OBRA_ID}, '', ${o.fecha}, '', ${t_(o.proyecto)}, ${t_(o.id_maquina)}, '', '',
      ${t_(o.h)}, ${t_(o.i)}, '', ${null}, ${null}, ${null}, ${null}, ${null},
      ${null}, ${null}, '', '', ${numNulo_(o.prod)}, ${null}, ${null}, ${null}, ${null}, ${null}, ${null}, ${t_(o.observacion)},
      ${o.idM}, ${t_(o.idC)}, ${o.ts}, ${t_(o.reporta)}, ${t_(o.tipo_equipo)}, ${null}, ${null}, '',
      ${t_(o.uProd)}, ${t_(o.cap_actividad)}, ${t_(o.aCaptura)}, ${null}, ${t_(o.area)})
    ON CONFLICT (obra_id, app_id_registro) DO NOTHING RETURNING app_id_registro`;
  return r.length>0;
}
async function insVol_(sql, o){
  await sql`INSERT INTO volquetas (obra_id, id_registro, "timestamp", fecha, reporta, origen, destino, tipo_destino, uf, placa, viajes, cubicaje, m3_placa, cubicaje_origen)
    VALUES (${OBRA_ID}, ${o.id_registro}, ${o.ts}, ${o.fecha}, ${t_(o.reporta)}, ${t_(o.origen)}, ${t_(o.destino)}, ${t_(o.tipo_destino)}, ${t_(o.uf)}, ${t_(o.placa)}, ${numNulo_(o.viajes)}, ${numNulo_(o.cubicaje)}, ${numNulo_(o.m3_placa)}, ${t_(o.cubicaje_origen)})`;
}
async function insObs_(sql, o){
  await sql`INSERT INTO observaciones (obra_id, id_registro, "timestamp", fecha, reporta, observacion, area)
    VALUES (${OBRA_ID}, ${o.id_registro}, ${o.ts}, ${o.fecha}, ${t_(o.reporta)}, ${t_(o.observacion)}, ${t_(o.area)})
    ON CONFLICT (obra_id, id_registro) DO NOTHING`;
}

/* ======================================================================================================
 * Codigo.gs L1150–L1385 — guardarReporte
 * ====================================================================================================== */
export async function guardarReporte(c, body, ses){
  // D106: sin fecha válida no se escribe nada.
  const fecha=fdateValida_(body.fecha), reporta=body.capataz||'', rol=body.rol||'capataz', ts=new Date();
  if(!fecha) return json(c, { ok:false, error:ERROR_FECHA });

  const banRows=[], maqRows=[];
  // D82 — identidad de envíos: cada fila puede traer su id_registro (UUID del cliente). Un reenvío desde
  // la cola offline se salta lo ya guardado y cuenta como `duplicadas`. Sin id (frontend viejo): uuid de
  // servidor y NO se deduplica. Los ids solo se leen si el payload los trae (traeIds*).
  const traeIdsBan=(body.cantidades||[]).some(function(c2){ return c2.id_registro; });
  const traeIdsMaq=(body.cantidades||[]).some(function(c2){ return (c2.equipos||[]).some(function(m){ return (m && m.id_registro) || ((typeof m==='string'||typeof m==='number') && c2.id_registro); }); })
                 || (body.maquinaria||[]).some(function(m){ return m && m.id_registro; });
  const traeIdsVol=(body.volquetas||[]).some(function(l){ return l.id_registro; });
  const banIds = traeIdsBan ? await banIdsDia_(c, fecha) : {};
  const maqIds = traeIdsMaq ? await maqIdsDia_(c, fecha) : {};
  const volIds = traeIdsVol ? await volIdsDia_(c, fecha) : {};
  let dupBan=0, dupMaq=0, dupVol=0;

  // D53: cubicaje real por placa. VOLQUETAS antes que las cantidades para que la excavación/terraplén use
  // Σ(viajes_placa × cubicaje_placa) en vez de total×14. Factor editable (14 por defecto) = fallback.
  const cubMap=await cubicajeMap_(c);
  const factorReporte=parseFloat(body.m3viaje)>0 ? parseFloat(body.m3viaje) : 14;
  const lineVol={}, lineTipo={};   // _linea -> volumen real (m³) desde las placas / tipo de destino (D67)
  const volRows=[];
  (body.volquetas||[]).forEach(function(line){
    // D82: id de línea del cliente si viene (las placas de la línea comparten id). Línea ya guardada => se
    // recalcula el volumen igual (las cantidades lo necesitan) pero sus placas NO se re-escriben.
    const idV=line.id_registro||crypto.randomUUID();
    const dupLinea=!!(line.id_registro && volIds[String(line.id_registro)]);
    let m3line=0;
    (line.placas||[]).forEach(function(p){
      const placaN=normPlaca(p.placa);
      const viajes=Number(p.viajes)||0;
      const found=Object.prototype.hasOwnProperty.call(cubMap, placaN);
      const cub=found ? cubMap[placaN] : factorReporte;          // catálogo o fallback
      const m3p=viajes*cub;
      m3line+=m3p;
      if(dupLinea){ dupVol++; }
      else volRows.push({ id_registro:idV, ts:ts, fecha:fecha, reporta:reporta, origen:line.origen||'', destino:line.destino||'', tipo_destino:line.tipo_destino||'',
        uf:line.uf||'', placa:p.placa||'', viajes:(p.viajes!=null?p.viajes:''), cubicaje:cub, m3_placa:m3p, cubicaje_origen:found?'catalogo':'default' });
    });
    if(line._linea!=null){ lineVol[line._linea]=m3line; lineTipo[line._linea]=String(line.tipo_destino||''); }
  });

  // Problema 2.12: la EXCAVACIÓN de la chequeadora se acumula al ORIGEN (_acumOrigen); el TERRAPLÉN sigue
  // 1 fila por línea al destino (_linea). D67: material con destino Botadero → su propia fila de no
  // aprovechable (_acumBotadero); el resto queda en el origen. Sin _acumBotadero: el origen conserva el total.
  const totalExc=Object.keys(lineVol).reduce(function(s,k){ return s+(lineVol[k]||0); },0);
  const totalBota=Object.keys(lineVol).reduce(function(s,k){ return s+(lineTipo[k]==='Botadero'?(lineVol[k]||0):0); },0);
  const traeSplit=(body.cantidades||[]).some(function(c2){ return c2._acumBotadero; });
  let eqMapa=null;   // D171: PARTE_EQUIPOS, solo si algún equipo llega sin tipo (lectura perezosa, async)

  // Recorre las cantidades de forma secuencial (for-of, no forEach) para poder `await` la carga perezosa
  // de eqMapa dentro del bucle de equipos, conservando el orden del .gs.
  for(const c2 of (body.cantidades||[])){
    if(rol==='chequeadora'){
      if(c2._acumBotadero) c2.largo=totalBota;                                    // excavación no aprovechable (Botadero)
      else if(c2._acumOrigen) c2.largo=traeSplit ? (totalExc-totalBota) : totalExc; // excavación acumulada al origen
      else if(c2._linea!=null && lineVol[c2._linea]!=null) c2.largo=lineVol[c2._linea]; // terraplén por línea
    }
    // D82: id de la fila del cliente si viene; fila ya guardada => se salta (dupC).
    const idC=c2.id_registro||crypto.randomUUID();
    const dupC=!!(c2.id_registro && banIds[String(c2.id_registro)]);
    // D56: origen del banco de material para la fila de excavación acumulada de la chequeadora.
    const origenBandeja = (rol==='chequeadora') ? (c2.origen||'') : '';
    // D69/D71: área de la línea — manda la columna `area` (necesaria para la demolición 01.02, CC 'tierras');
    // si falta, se deriva del CC. + campos SOLO-WhatsApp de drenajes (personal/turno noche/nota libre). Nunca a DATA.
    const areaLinea = areaDeFila(c2.area, c2.centro_costo);
    const areaCol = (areaLinea==='tierras') ? '' : areaLinea;
    const turnoNoche = (c2.turno_noche===true || String(c2.turno_noche||'').toUpperCase()==='SI') ? 'SI' : '';
    // Todo entra a BANDEJA; cereo (data:false) marcado 'no_data' (el encargado lo ve pero no lo envía a DATA).
    if(dupC){ dupBan++; }
    else banRows.push({ id_registro:idC, ts:ts, fecha:fecha, reporta:reporta, rol:rol, grupo:c2.grupo||'', capitulo:c2.capitulo||'', actividad:c2.actividad||'', descripcion:c2.descripcion||'', centro_costo:c2.centro_costo||'',
      unidad:c2.unidad||'', uf:c2.uf||'', proyecto:c2.proyecto||'', elemento:c2.elemento||'', pk_inicial:c2.pk_inicial||'', pk_final:c2.pk_final||'', abs_inicial:c2.abs_inicial||'', abs_final:c2.abs_final||'', liberacion:t_(c2.liberacion)||'CAMPO',
      largo:numOr0_(c2.largo), observacion:c2.observacion||'', estado:(c2.data===false)?'no_data':'pendiente', origen:origenBandeja,
      area:areaCol, personal_oficiales:(c2.personal_oficiales!=null?c2.personal_oficiales:''), personal_ayudantes:(c2.personal_ayudantes!=null?c2.personal_ayudantes:''),
      turno_noche:turnoNoche, nota_libre:c2.nota_libre||'' });
    // ZODME automático tras excavación no aprovechable. D58: si nació de descapote/desmonte (c.derivada),
    // el ZODME hereda el sello 'orig:descapote/desmonte'. D82: id determinístico (idC+'-z'); si la madre
    // ya estaba guardada, su ZODME también (misma escritura), así que se salta y cuenta como duplicada.
    if(c2.data!==false && String(c2.descripcion||'').toUpperCase().indexOf('NO APROVECHABLE')>=0){
      if(dupC){ dupBan++; }
      else {
        const proy=c2.proyecto||'';
        const obsZodme = c2.derivada ? 'Auto · ZODME de descapote/desmonte · orig:descapote/desmonte'
                                     : 'Auto · secuencial a no aprovechable';
        banRows.push({ id_registro:(c2.id_registro?(c2.id_registro+'-z'):crypto.randomUUID()), ts:ts, fecha:fecha, reporta:reporta, rol:rol, grupo:'TIERRAS', capitulo:'EXPLANACIONES',
          actividad:'Conformación y disposición de sobrantes (ZODME)', descripcion:'Conformación y disposición de sobrantes',
          centro_costo:proy?(proy+'.02.08'):'', unidad:'m3', uf:c2.uf, proyecto:proy, elemento:c2.elemento, pk_inicial:c2.pk_inicial, pk_final:c2.pk_final, abs_inicial:c2.abs_inicial, abs_final:c2.abs_final,
          liberacion:c2.liberacion, largo:numNulo_(c2.largo), observacion:obsZodme, estado:'pendiente', origen:'',
          area:'', personal_oficiales:'', personal_ayudantes:'', turno_noche:'', nota_libre:'' });
      }
    }
    // equipos -> MAQUINARIA (layout Captura A→AA + internos del app, D52). D69: máquinas de drenajes (ODT/ODL)
    // son captura libre: a_captura=NO SIEMPRE (no pasan a Captura_Diaria) y T Producción en blanco.
    const der = derivarActividad(c2);
    const esDrenaje = (areaLinea!=='tierras');
    // D171: los equipos del capataz son SOLO el código. Cada elemento puede venir como objeto
    // {id_registro,id_maquina,tipo_equipo} o como string 'CR026'; un payload VIEJO (cola offline, D82) trae
    // además horas/operador/motivo: se aceptan y se DESCARTAN en silencio.
    const equipos=(c2.equipos||[]);
    for(let k=0;k<equipos.length;k++){
      const m0=equipos[k];
      const m = (typeof m0==='string' || typeof m0==='number')
        ? { id_maquina:String(m0).trim(), id_registro: c2.id_registro ? (c2.id_registro+'-m'+k) : '' }
        : (m0||{});
      if(!m.id_maquina) continue;
      // D82: cada equipo trae su id_registro (→ app_id_registro); ya guardado ese día => se salta. Un código
      // suelto hereda un id determinístico de su línea (idC+'-m'+k) para deduplicar igual.
      const idM=m.id_registro||crypto.randomUUID();
      if(m.id_registro && maqIds[String(m.id_registro)]){ dupMaq++; continue; }
      // tipo informativo: el del cliente o, si no viene, el de PARTE_EQUIPOS (catálogo único, lectura perezosa).
      if(!m.tipo_equipo){ if(!eqMapa) eqMapa=await equiposCapatazMapa_(c, ''); const q=eqMapa[claveMaq_(m.id_maquina)]; m.tipo_equipo=q?q.tipo:''; }
      const esVibro = esTipoSinProduccion(m.tipo_equipo);
      const esApoyo = (c2.actividad||'') === 'APOYO';
      // T Producción: largo de la actividad EXCEPTO vibros/minis y apoyo → blanco (D41/D44). D58:
      // desmonte/descapote llevan la producción de la máquina aparte (prod_maquina + unidad_maquina).
      const tieneProdMaq = (c2.prod_maquina != null && c2.prod_maquina !== '');
      const baseProd = tieneProdMaq ? c2.prod_maquina : c2.largo;
      const prod  = (esDrenaje || esVibro || esApoyo || baseProd == null || baseProd === '') ? '' : baseProd;
      const uProd = (prod === '') ? '' : (tieneProdMaq ? (c2.unidad_maquina || '') : (c2.unidad || ''));
      maqRows.push({ fecha:fecha, proyecto:c2.proyecto, id_maquina:m.id_maquina, h:der.h, i:der.i, prod:prod,
        observacion:c2.observacion||'', idM:idM, idC:idC, ts:ts, reporta:reporta, tipo_equipo:m.tipo_equipo||'',
        uProd:uProd, cap_actividad:c2.actividad, aCaptura:(esDrenaje?'NO':der.aCaptura), area:areaCol });
    }
  }

  // Maquinaria de la chequeadora (D54, recortada por V3-06(b)/D177): SOLO los códigos de las excavadoras
  // que alimentaron el origen. Una vez por reporte. T Producción = total excavado del día (Σ líneas,
  // cubicaje real D53) REPARTIDO en partes iguales entre las excavadoras marcadas. Va a MAQUINARIA.
  const maqList=body.maquinaria||[];
  if(maqList.length){
    // Normaliza a {id_maquina,id_registro,tipo_equipo}. Código suelto no trae id_registro.
    const norm=maqList.map(function(m0){
      return (typeof m0==='string' || typeof m0==='number')
        ? { id_maquina:String(m0).trim(), id_registro:'' }
        : (m0||{});
    }).filter(function(m){ return m.id_maquina; });
    if(norm.length){
      for(const m of norm){ if(!m.tipo_equipo){ if(!eqMapa) eqMapa=await equiposCapatazMapa_(c, ''); const q=eqMapa[claveMaq_(m.id_maquina)]; m.tipo_equipo=q?q.tipo:''; } }
      const nProd=norm.filter(function(m){ return !esTipoSinProduccion(m.tipo_equipo); }).length || 1;
      const prodCada=totalExc/nProd;
      // proyecto y actividad del frente de excavación (todas las líneas comparten origen).
      let proyMaq='', actMaq='';
      (body.cantidades||[]).forEach(function(c2){ if(!actMaq && String(c2.actividad||'').indexOf('Excavaci')>=0){ actMaq=c2.actividad; proyMaq=c2.proyecto||''; } });
      if(!proyMaq && (body.cantidades||[]).length) proyMaq=body.cantidades[0].proyecto||'';
      const der=derivarActividad({actividad:actMaq});
      for(const m of norm){
        const idM=m.id_registro||crypto.randomUUID();
        if(m.id_registro && maqIds[String(m.id_registro)]){ dupMaq++; continue; }
        const esVibro=esTipoSinProduccion(m.tipo_equipo);
        const prod=esVibro ? '' : prodCada;          // vibros/minis/retros nunca llevan producción (D44)
        const uProd=(prod==='') ? '' : 'm3';
        maqRows.push({ fecha:fecha, proyecto:proyMaq, id_maquina:m.id_maquina, h:der.h, i:der.i, prod:prod,
          observacion:'', idM:idM, idC:'', ts:ts, reporta:reporta, tipo_equipo:m.tipo_equipo||'',
          uProd:uProd, cap_actividad:actMaq, aCaptura:der.aCaptura, area:'' });
      }
    }
  }

  // Observación general del día (D86): sellada con el área(s) de las líneas. D82: usa el id_reporte del
  // cliente (uno por envío) para no duplicarse en un reenvío.
  const obs=(body.observacion_general||'').trim();
  let obsRow=null;
  if(obs){
    const yaObs = body.id_reporte
      ? (await c.sql`SELECT 1 FROM observaciones WHERE obra_id=${OBRA_ID} AND id_registro=${String(body.id_reporte)} AND fecha=${fecha} LIMIT 1`).length>0
      : false;
    if(!yaObs) obsRow={ id_registro:body.id_reporte||crypto.randomUUID(), ts:ts, fecha:fecha, reporta:reporta, observacion:obs, area:areasDeReporte(body.cantidades) };
  }

  // Escritura: UNA transacción por envío (decisión 10). ON CONFLICT en BANDEJA/MAQUINARIA cuenta la
  // carrera como duplicada; VOLQUETAS (surrogate) no choca.
  let insBan=0, insMaq=0, insVol=0;
  await c.sql.begin(async function(sql){
    for(const o of banRows){ if(await insBandeja_(sql, o)) insBan++; }
    for(const o of maqRows){ if(await insMaq_(sql, o)) insMaq++; }
    for(const o of volRows){ await insVol_(sql, o); insVol++; }
    if(obsRow) await insObs_(sql, obsRow);
  });
  const conflBan=banRows.length-insBan, conflMaq=maqRows.length-insMaq;

  // D82: `guardadas`/`duplicadas` = filas escritas / saltadas. cantidades/maquinas/volquetas = TOTAL del
  // reporte (escritas + saltadas), así el reenvío muestra los mismos conteos que el envío original.
  return json(c, { ok:true,
    cantidades: banRows.length + dupBan,
    maquinas:   maqRows.length + dupMaq,
    volquetas:  volRows.length + dupVol,
    guardadas:  insBan + insMaq + insVol,
    duplicadas: dupBan + dupMaq + dupVol + conflBan + conflMaq });
}
