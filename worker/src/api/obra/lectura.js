/**
 * api/obra/lectura.js — LECTURAS de OBRA portadas al Worker (4.01 · Fase 4 · D180).
 *
 * Es el bloque de LECTURA de backend/Codigo.gs (bandeja L1391–L1408, consolidado L1411–L1429,
 * consolidadoRango L1437–L1478, estado L1481–L1488, volquetasDelDia L1021–L1045, acumuladoDrenajes
 * L827–L845, el despacho inline de ?action=cubicaje L1075 y debug L3238–L3243) función por función,
 * con los MISMOS nombres, el MISMO contrato y las MISMAS claves de respuesta, pero contra las tablas
 * `bandeja` / `maquinaria` / `observaciones` / `data` / `volquetas` (+ el catálogo `cubicaje`) en vez
 * de las hojas del Sheet:
 *
 *   GET ?action=bandeja&fecha=[&proyecto=&area=]              → bandeja           {fecha, area, cantidades, maquinas, observaciones}
 *   GET ?action=consolidado&fecha=[&proyecto=]               → consolidado        {fecha, cantidades}
 *   GET ?action=consolidado&desde=&hasta=[&proyecto=]        → consolidadoRango   {ok, desde, hasta, header, cols, climaPorDia, filas}
 *   GET ?action=estado&fecha=[&proyecto=]                    → estado             {reportadas}
 *   GET ?action=volquetas&fecha=                             → volquetasDelDia    {ok, fecha, filas}
 *   GET ?action=acumulado_drenajes[&area=]                   → acumuladoDrenajes  {ok, area, acumulado}
 *   GET ?action=cubicaje                                     → cubicaje           {ok, cubicaje}
 *   GET ?action=debug&fecha=                                 → debug              {version, sheetTZ, queryFecha, bandejaFilas, muestra}
 *
 * Qué cambia respecto al .gs y por qué (informe §3 Fase 4, decisión 9):
 *   · La capa de datos: `readSheetPorFecha_`/`filasCrudasPorFecha_`/`getDataRange().getValues()` →
 *     `SELECT … WHERE obra_id=$1 AND fecha=$2` (índices *_fecha_idx) o `… fecha BETWEEN $2 AND $3`
 *     (consolidadoRango, sin tope: se quitó la lectura entera de la hoja). El `getSheet(…, HEADERS)`
 *     que auto-sanaba encabezados desaparece: las columnas son las de la tabla.
 *   · El filtro por PROYECTO y por ÁREA se hace en JS sobre las filas del día (igual que el .gs: un día
 *     son decenas de filas), no en SQL: así `areaDeFila`/`obsEnArea`/`deriveArea` no se reescriben como
 *     predicado SQL y el resultado es idéntico celda a celda. `area` de una fila de BANDEJA sale de la
 *     columna `area` o, si viene vacía (filas viejas), de deriveArea(centro_costo); MAQUINARIA no lleva
 *     CC (areaDeFila(r.area, '')).
 *   · NULL → '' en todo numérico/fecha/timestamp que la pantalla compara con '' o suma (decisión 9):
 *     el `largo` de BANDEJA, los A–T numéricos de DATA (largo/espesor/fc/cantidad) y el `largo` del
 *     acumulado. `fecha` llega ya como texto 'yyyy-MM-dd' (db.js) y `timestamp` como Date → ISO en JSON,
 *     igual que Apps Script. Donde la pantalla depende del ORDEN físico de la hoja (consolidado, DATA por
 *     rango, volquetas, bandeja, estado) se ordena SIEMPRE en SQL por "timestamp" + la clave de la fila.
 *   · `_row` deja de existir (ninguna pantalla lo usa). `debug` NO relee DATA entera (el `readSheet('DATA')`
 *     del .gs descartaba el resultado): solo cuenta la bandeja del día. `cubicaje` sirve el catálogo
 *     `cubicajeMap_` de src/catalogos.js (memorizado por petición, decisión 1).
 *
 * Ninguna de estas funciones escribe: son lectura pura. El guard de token lo aplica index.js/obra.js
 * (puerta_) antes de despachar; aquí no hay comprobación de rol (cualquier token, como en el .gs).
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 */
import { OBRA_ID, json, fdate, fdateValida_, ccCorto, deriveArea, ZONA_HORARIA } from '../../comun.js';
import { areaDeFila, obsEnArea } from './areas.js';
import { cubicajeMap_ } from '../../catalogos.js';

/* ---------- encabezados de hoja (Codigo.gs L51–L103) ----------
 * Copiados aquí (privados) para no crear un import a Codigo.gs, que no se porta: definen el ORDEN y los
 * NOMBRES de las columnas que devuelven bandeja/consolidadoRango tal como las esperan las pantallas.
 * (pendiente: si obra/reporte.js y obra/maquinaria.js los necesitan, subir estos arrays a un módulo
 * compartido — hoy solo los usa esta lectura). */
const DATA_HEADERS = ['FECHA','ORDEN','GRUPO','CENTRO DE COSTO','CAPITULO','DESCRIPCION',
  'UNIDAD FUNCIONAL','PROYECTO','ELEMENTO','ABS INICIAL','ABS FINAL','LIBERACION','ACTA',
  'UNIDAD MEDIDA','LARGO','ESPESOR','FC','CANTIDAD','OBSERVACION','Columna1'];
// BANDEJA: mismas 28 claves que BANDEJA_HEADERS (L75–L78), en el mismo orden y con los mismos nombres.
const BANDEJA_HEADERS = ['id_registro','timestamp','fecha','reporta','rol','grupo','capitulo',
  'actividad','descripcion','centro_costo','unidad','uf','proyecto','elemento',
  'pk_inicial','pk_final','abs_inicial','abs_final','liberacion','largo','observacion','estado','origen',
  'area','personal_oficiales','personal_ayudantes','turno_noche','nota_libre'];
// MAQUINARIA: mismas 40 claves que MAQ_HEADERS (L84–L103); `timestamp` es la columna "timestamp".
const MAQ_HEADERS = ['id_registro','fecha','dia','proyecto','id_maquina','tipo_equipo','operador',
  'actividad','sub_actividad','unidad','horas_programadas','horas_operadas','pct_util',
  'horas_muertas','horas_mantenimiento','pct_muerto','horas_facturadas','estado','clima',
  'produccion','meta','pct_ef','rendimiento','unitario','viajes','costo','observacion',
  'app_id_registro','id_cantidad','timestamp','reporta','app_tipo_equipo',
  'app_horas_programadas','app_horas_muertas','motivo','unidad_prod','cap_actividad','a_captura',
  'produccion_capataz_orig','area'];

/* NULL/undefined → '' (celda vacía de la hoja); Number/Date/texto se conservan (decisión 9). Es lo que
 * daba getValues(): '' en la celda vacía, el número en la numérica, el Date en timestamp (→ ISO en JSON). */
function celda_(v){ return (v===null || v===undefined) ? '' : v; }
// Fila de tabla (SELECT *) → objeto con SOLO las claves de la hoja, en su orden y con celda_ aplicado.
function objDesde_(r, headers){ const o={}; headers.forEach(function(k){ o[k]=celda_(r[k]); }); return o; }

/* ============ bandeja para el encargado / residentes de drenajes (Codigo.gs L1391–L1408) ============
 * &area=tierras|odt|odl (D69): cada pantalla ve SOLO su área. Sin el parámetro se devuelve todo. El área
 * de cada fila = columna `area` (o derivada del CC para filas viejas); MAQUINARIA solo por la columna. */
export async function bandeja(c, params){
  const fecha=fdate((params&&params.fecha)||''), proy=(params&&params.proyecto)||'';
  const areaQ=String((params&&params.area)||'').trim().toLowerCase();
  const fsql=fdateValida_(fecha);
  const banCrudas=fsql ? await c.sql`SELECT * FROM bandeja       WHERE obra_id=${OBRA_ID} AND fecha=${fsql} ORDER BY "timestamp", id_registro` : [];
  const maqCrudas=fsql ? await c.sql`SELECT * FROM maquinaria    WHERE obra_id=${OBRA_ID} AND fecha=${fsql} ORDER BY "timestamp", app_id_registro` : [];
  const obsCrudas=fsql ? await c.sql`SELECT * FROM observaciones WHERE obra_id=${OBRA_ID} AND fecha=${fsql} ORDER BY "timestamp", id_registro` : [];
  // D107: filtro por fecha ya aplicado; aquí solo proyecto y área (en memoria, como el .gs).
  const cantidades=banCrudas.map(function(r){ return objDesde_(r, BANDEJA_HEADERS); })
    .filter(function(r){ return (!proy || String(r.proyecto)===proy) && (!areaQ || areaDeFila(r.area, r.centro_costo)===areaQ); });
  const maquinas=maqCrudas.map(function(r){ return objDesde_(r, MAQ_HEADERS); })
    .filter(function(r){ return (!proy || String(r.proyecto)===proy) && (!areaQ || areaDeFila(r.area, '')===areaQ); });
  // D86: la observación general también se filtra por área; col `area` vacía = tierras. Se devuelven solo
  // {reporta, observacion, area||'tierras'}, como el .gs.
  const observaciones=obsCrudas.filter(function(r){ return (!areaQ || obsEnArea(r.area, areaQ)); })
    .map(function(r){ return { reporta:r.reporta||'', observacion:r.observacion||'', area:String(r.area||'tierras') }; });
  return json(c, { fecha:fecha, area:areaQ, cantidades:cantidades, maquinas:maquinas, observaciones:observaciones });
}

/* ============ DATA ya enviada — consolidado de UN día o, con desde/hasta, por RANGO (L1411–L1478) ============ */
export async function consolidado(c, params){
  // Panel del jefe (rango, solo lectura). Si llega desde/hasta se usa consolidadoRango; si no, un día.
  if((params&&params.desde) || (params&&params.hasta)) return consolidadoRango(c, params);
  const fecha=fdate((params&&params.fecha)||''), proy=(params&&params.proyecto)||'';
  const fsql=fdateValida_(fecha);
  // D107: filas de DATA acotadas al día. índices del .gs: descripcion v[5], actividad v[24], uf v[6],
  // proyecto v[7], pk_inicial v[25], largo v[14], unidad v[13].
  const filas=fsql ? await c.sql`SELECT descripcion, actividad, unidad_funcional, proyecto, pk_inicial, largo, unidad_medida
    FROM data WHERE obra_id=${OBRA_ID} AND fecha=${fsql} ORDER BY "timestamp", id_registro` : [];
  const cantidades=[];
  filas.forEach(function(r){
    if(proy && String(r.proyecto)!==proy) return;
    cantidades.push({ fecha:fecha, descripcion:r.descripcion, actividad:r.actividad, uf:r.unidad_funcional,
      proyecto:String(r.proyecto||''), pk_inicial:r.pk_inicial, largo:celda_(r.largo), unidad:r.unidad_medida });
  });
  return json(c, { fecha:fecha, cantidades:cantidades });
}

/* ---------- consolidado por RANGO (panel del jefe, solo lectura) — Codigo.gs L1437–L1478 ----------
 * Filas CRUDAS A–T de DATA cuya FECHA cae en [desde, hasta] inclusive + la col interna `actividad`
 * (D113) al final (índice 20). Cada fila es un ARRAY de 21 valores (no objeto). Numéricos NULL → '' (el
 * jefe copia A:S al Excel: un 'null' pegado rompe el maestro). Sin tope de lectura (índice data_fecha_idx).
 * climaPorDia (D37) = primer clima no vacío por fecha. `cols` copiado literal de L1472–L1474. */
export async function consolidadoRango(c, params){
  const dRaw=fdate((params&&params.desde)||''), hRaw=fdate((params&&params.hasta)||'');
  const desde = dRaw || hRaw, hasta = hRaw || dRaw;   // si falta uno, el rango es un solo día
  const proy=(params&&params.proyecto)||'';
  const AT=20;                                        // A–T (las 20 columnas espejo del maestro + Columna1)
  const dS=fdateValida_(desde), hS=fdateValida_(hasta);
  const filas=[], climaPorDia={};
  if(dS && hS){
    // A–T EN ORDEN + actividad + clima; orden estable por fecha y orden de envío (timestamp, id_registro).
    const v=await c.sql`SELECT fecha, orden, grupo, centro_de_costo, capitulo, descripcion, unidad_funcional,
        proyecto, elemento, abs_inicial, abs_final, liberacion, acta, unidad_medida, largo, espesor, fc,
        cantidad, observacion, columna1, actividad, clima
      FROM data WHERE obra_id=${OBRA_ID} AND fecha BETWEEN ${dS} AND ${hS} ORDER BY fecha, "timestamp", id_registro`;
    v.forEach(function(r){
      const f=fdate(r.fecha);
      if(proy && String(r.proyecto)!==proy) return;
      // clima del día: primer valor no vacío que aparezca (D37)
      if(!climaPorDia[f]){ const cl=String(r.clima==null?'':r.clima).trim(); if(cl) climaPorDia[f]=cl; }
      filas.push([ f, r.orden, r.grupo, r.centro_de_costo, r.capitulo, r.descripcion, r.unidad_funcional,
        r.proyecto, r.elemento, r.abs_inicial, r.abs_final, r.liberacion, r.acta, r.unidad_medida,
        celda_(r.largo), celda_(r.espesor), celda_(r.fc), celda_(r.cantidad), r.observacion, r.columna1,
        String(r.actividad==null?'':r.actividad).trim() ]);
    });
  }
  // cols: COPY_END=15 => el copiado toma [0,15) = A:O, hasta LARGO inclusive (D14). ACTIVIDAD al final (AT).
  return json(c, {
    ok:true, desde:desde, hasta:hasta,
    header: DATA_HEADERS.slice(0, AT).concat(['actividad']),   // D113: la interna va al final
    cols: { FECHA:0, ORDEN:1, GRUPO:2, CC:3, CAPITULO:4, DESCRIPCION:5, UF:6, PROYECTO:7, ELEMENTO:8,
            ABS_INI:9, ABS_FIN:10, LIBERACION:11, ACTA:12, UNIDAD:13, LARGO:14, ESPESOR:15, FC:16,
            CANTIDAD:17, OBSERVACION:18, COLUMNA1:19, ACTIVIDAD:AT, COPY_END:15 },
    climaPorDia: climaPorDia,   // D37: {fecha -> clima}
    filas: filas
  });
}

/* ============ estado de maquinaria (Codigo.gs L1481–L1488) ============
 * D107: máquinas del día, dedupe por id_maquina conservando la PRIMERA fila (orden físico = envío). */
export async function estado(c, params){
  const fecha=fdate((params&&params.fecha)||''), proy=(params&&params.proyecto)||'';
  const fsql=fdateValida_(fecha);
  const maquinas=fsql ? await c.sql`SELECT id_maquina, reporta, proyecto FROM maquinaria
    WHERE obra_id=${OBRA_ID} AND fecha=${fsql} ORDER BY "timestamp", app_id_registro` : [];
  const seen={}, reportadas=[];
  maquinas.forEach(function(m){
    if(proy && String(m.proyecto)!==proy) return;
    if(!m.id_maquina || seen[m.id_maquina]) return;
    seen[m.id_maquina]=1; reportadas.push({ id_maquina:m.id_maquina, capataz:m.reporta });
  });
  return json(c, { reportadas:reportadas });
}

/* ============ digitadora de volquetas (D83) — solo lectura por fecha (Codigo.gs L1021–L1045) ============
 * Sin filas ese día → {ok:true, fecha, filas:[]} (no es error). Mismo mapeo a String/Number que L1030. */
export async function volquetasDelDia(c, params){
  const fecha=fdate((params&&params.fecha)||'');
  const fsql=fdateValida_(fecha);
  const crudas=fsql ? await c.sql`SELECT id_registro, reporta, origen, destino, tipo_destino, uf, placa,
      viajes, cubicaje, cubicaje_origen FROM volquetas WHERE obra_id=${OBRA_ID} AND fecha=${fsql}
    ORDER BY "timestamp", volqueta_id` : [];
  const filas=crudas.map(function(r){
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
  return json(c, { ok:true, fecha:fecha, filas:filas });
}

/* ============ acumulado oficial de drenajes (pedido ODT, D70) — Codigo.gs L827–L845 ============
 * Suma LARGO (col O) de DATA por ELEMENTO (col I) + CC corto (col D), SOLO filas de drenajes
 * (deriveArea != tierras). Todas las fechas (histórico), sin tope. D113c: variantes suman con el ítem
 * (misma clave CC). deriveArea/ccCorto en JS: no se reescribe la regla del prefijo '37xx.'. */
export async function acumuladoDrenajes(c, params){
  const areaQ=String((params&&params.area)||'').trim().toLowerCase();
  const filas=await c.sql`SELECT centro_de_costo, elemento, largo FROM data
    WHERE obra_id=${OBRA_ID} AND largo IS NOT NULL AND elemento<>''`;
  const acum={};
  filas.forEach(function(r){
    const cc=r.centro_de_costo, area=deriveArea(cc);
    if(area==='tierras') return;
    if(areaQ && area!==areaQ) return;
    const elem=String(r.elemento==null?'':r.elemento).trim(); if(!elem) return;
    const val=parseFloat(r.largo); if(isNaN(val)) return;
    const key=elem+'||'+ccCorto(cc);
    acum[key]=(acum[key]||0)+val;
  });
  return json(c, { ok:true, area:areaQ, acumulado:acum });
}

/* ============ catálogo placa→m³/viaje que sirve ?action=cubicaje (despacho inline Codigo.gs L1075) ============
 * {ok:true, cubicaje:{PLACA6:num}} con el mapa memorizado por petición de src/catalogos.js (decisión 1). */
export async function cubicaje(c){
  return json(c, { ok:true, cubicaje: await cubicajeMap_(c) });
}

/* ============ debug (Codigo.gs L3238–L3243) ============
 * Ninguna pantalla ni caso de contrato lo usa. 5 filas de la bandeja del día + zona horaria. NO relee
 * DATA entera (el `readSheet('DATA')` del .gs descartaba el resultado). version 'v11' se conserva. */
export async function debug(c, params){
  const fechaQ=fdate((params&&params.fecha)||'');
  const fsql=fdateValida_(fechaQ);
  const ban=fsql ? await c.sql`SELECT reporta, rol, actividad, pk_inicial, largo, estado FROM bandeja
    WHERE obra_id=${OBRA_ID} AND fecha=${fsql} ORDER BY "timestamp", id_registro` : [];
  return json(c, { version:'v11', sheetTZ:ZONA_HORARIA, queryFecha:fechaQ, bandejaFilas:ban.length,
    muestra: ban.slice(0,5).map(function(r){ return { reporta:r.reporta, rol:r.rol, actividad:r.actividad,
      pk:r.pk_inicial, largo:celda_(r.largo), estado:r.estado }; }) });
}
