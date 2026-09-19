/**
 * api/obra/pliegue.js — la DATA de Galca plegada por los campos del Tablero (V3-11 Fases B+C · D185, sep-2026).
 *
 * Lo usa el Tablero EN VIVO (tablero_vivo.js: Σ por FECHA). Lee la vista tablero_data_campo
 * (worker/sql/008_tablero_vivo.sql), que es la ÚNICA definición del cruce DATA → campo: descripción NORMALIZADA
 * (normTexto) + UF contra tablero_mapeo (MAPEO A2:C10 del Excel), y la CANTIDAD compacta de la fila (la suya, que
 * ya respeta su FC y su espesor; vacía → LARGO × espesor ÷ FC). Todas las sumas se hacen en SQL numeric; a JS solo
 * llega el resultado (db.js / pglite.js: numeric → Number).
 *
 * Campos (los de la hoja DATOS que el Tablero leía, D185): apr / pre / nap = excavación aprovechable / préstamo /
 * no aprovechable (F/G/H); ter / sub / bas = terraplén / subbase / base (K+L, O+P, S+T), con ter1/ter2… = la parte
 * de la UF1/UF2 de la fila; exc = apr + pre + nap (D). Días anteriores a 2020 fuera (errata de tecleo; la misma
 * regla que leerProduccion del motor y el validador de fechas de D166).
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 */
import { OBRA_ID } from '../../comun.js';

export const PLIEGUE_DESDE = '2020-01-01';   // leerProduccion descartaba los años < 2020
export const FC_RESPALDO = 1.3;              // FC_DEFECTO del motor: solo si la Proyección no tiene parámetros

/* ---------- Σ por FECHA (el Tablero en vivo) ----------
 * Una fila por FECHA presente en DATA (cualquier área: un día sin ninguna partida del Tablero sale con ceros) con
 * cada campo en SUELTO-EQUIVALENTE = Σ CANTIDAD compacta × fc de la Proyección (proy_parametros; sin fila, o sin
 * la tabla porque 006 aún no se aplicó, FC_RESPALDO: ver fcProyeccionTxt_). El motor del Tablero trabaja en
 * suelto y divide por ese MISMO fc (construir con la proyección de Galca, y comp() al pintar), así que toda
 * cifra compacta que muestra es exactamente Σ CANTIDAD (error relativo del orden
 * de 1e-16: una multiplicación en numeric y una división en coma flotante).
 * `t` = el clima del DÍA (regla D182: el primer clima no vacío de la fecha por "timestamp" NULLS LAST, id_registro;
 * '' si ninguno). Devuelve {fc, filas:[{f, apr, pre, nap, exc, ter1, ter2, ter, sub1, sub2, sub, bas1, bas2, bas, t}]}. */
export async function sumaPorDia_(c){
  // El fc va en una consulta APARTE (D185): si falta 006, el Tablero en vivo sigue con FC_RESPALDO y el 42P01 de
  // proy_parametros no se confunde con el de 008 (tablero_vivo.js solo traduce a «falta 008» lo que queda aquí).
  const fcTxt = await fcProyeccionTxt_(c);
  const filas = await c.sql`WITH fcp AS (
      SELECT ${fcTxt}::numeric AS fc
    ), dia AS (
      SELECT fecha,
        coalesce(sum(cantidad) FILTER (WHERE campo = 'apr'), 0)                     AS apr,
        coalesce(sum(cantidad) FILTER (WHERE campo = 'pre'), 0)                     AS pre,
        coalesce(sum(cantidad) FILTER (WHERE campo = 'nap'), 0)                     AS nap,
        coalesce(sum(cantidad) FILTER (WHERE campo IN ('apr','pre','nap')), 0)      AS exc,
        coalesce(sum(cantidad) FILTER (WHERE campo = 'ter' AND uf = 'UF1'), 0)      AS ter1,
        coalesce(sum(cantidad) FILTER (WHERE campo = 'ter' AND uf = 'UF2'), 0)      AS ter2,
        coalesce(sum(cantidad) FILTER (WHERE campo = 'ter'), 0)                     AS ter,
        coalesce(sum(cantidad) FILTER (WHERE campo = 'sub' AND uf = 'UF1'), 0)      AS sub1,
        coalesce(sum(cantidad) FILTER (WHERE campo = 'sub' AND uf = 'UF2'), 0)      AS sub2,
        coalesce(sum(cantidad) FILTER (WHERE campo = 'sub'), 0)                     AS sub,
        coalesce(sum(cantidad) FILTER (WHERE campo = 'bas' AND uf = 'UF1'), 0)      AS bas1,
        coalesce(sum(cantidad) FILTER (WHERE campo = 'bas' AND uf = 'UF2'), 0)      AS bas2,
        coalesce(sum(cantidad) FILTER (WHERE campo = 'bas'), 0)                     AS bas
      FROM tablero_data_campo
      WHERE obra_id=${OBRA_ID} AND fecha >= ${PLIEGUE_DESDE}::date
      GROUP BY fecha
    ), cl AS (
      SELECT DISTINCT ON (fecha) fecha, btrim(clima) AS t
      FROM data
      WHERE obra_id=${OBRA_ID} AND fecha >= ${PLIEGUE_DESDE}::date
      ORDER BY fecha, (btrim(clima) = ''), "timestamp" NULLS LAST, id_registro
    )
    SELECT to_char(dia.fecha, 'YYYY-MM-DD') AS f, fcp.fc,
      dia.apr * fcp.fc AS apr, dia.pre * fcp.fc AS pre, dia.nap * fcp.fc AS nap, dia.exc * fcp.fc AS exc,
      dia.ter1 * fcp.fc AS ter1, dia.ter2 * fcp.fc AS ter2, dia.ter * fcp.fc AS ter,
      dia.sub1 * fcp.fc AS sub1, dia.sub2 * fcp.fc AS sub2, dia.sub * fcp.fc AS sub,
      dia.bas1 * fcp.fc AS bas1, dia.bas2 * fcp.fc AS bas2, dia.bas * fcp.fc AS bas,
      coalesce(cl.t, '') AS t
    FROM dia CROSS JOIN fcp LEFT JOIN cl ON cl.fecha = dia.fecha
    ORDER BY dia.fecha`;
  return { fc: Number(fcTxt), filas: filas.map(function(r){
    return { f:r.f,
      apr:Number(r.apr), pre:Number(r.pre), nap:Number(r.nap), exc:Number(r.exc),
      ter1:Number(r.ter1), ter2:Number(r.ter2), ter:Number(r.ter),
      sub1:Number(r.sub1), sub2:Number(r.sub2), sub:Number(r.sub),
      bas1:Number(r.bas1), bas2:Number(r.bas2), bas:Number(r.bas),
      t:String(r.t==null?'':r.t) };
  }) };
}
// El fc de la Proyección como TEXTO (numeric exacto de vuelta a SQL). Sin fila, o sin la tabla (42P01: 006 todavía
// no aplicada, orden de despliegue de OPERACIONES §16), FC_RESPALDO: la caída a constantes que ya hace el Tablero.
async function fcProyeccionTxt_(c){
  try{
    const r = await c.sql`SELECT fc::text AS fc FROM proy_parametros WHERE obra_id=${OBRA_ID}`;
    return (r.length && r[0].fc != null) ? String(r[0].fc) : String(FC_RESPALDO);
  }catch(err){
    if(String((err && err.code) || '')==='42P01') return String(FC_RESPALDO);
    throw err;
  }
}
