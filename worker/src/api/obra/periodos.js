/**
 * api/obra/periodos.js — ACTA de una FECHA: la regla ÚNICA del Worker (D184, sep-2026).
 *
 * La ACTA de una fila de DATA es la del periodo 16→15 en que cae su FECHA (lo que el Excel hace con
 * LOOKUP(FECHA, BASE!T:U, BASE!S)). La usan la Revisión de DATA (datagrid.js: derivar_) y el envío a DATA
 * (data.js: enviar_data, tierras Y drenajes); la migración 007_data_completa.sql rellena con la MISMA regla
 * las filas que quedaron con la ACTA vacía.
 *
 *   1. Tabla `periodos` (004): el acta cuyo [fecha_inicial, fecha_final] contiene la fecha.
 *   2. Si la fecha cae fuera de la tabla (2027 en adelante, o antes del acta 10), la fórmula de respaldo:
 *      mes de cierre = el de la fecha si el día ≤ 15, si no el siguiente;
 *      acta = (año_cierre − 2025)·12 + mes_cierre + 2
 *      (acta 10 = 2025-07-16..08-15 · 23 = 2026-08-16..09-15 · 24 = 2026-09-16..10-15 · 28 = 2027-01-16..02-15).
 *      Si da < 1 → '' (antes del acta 1: sin acta; así quedan las fechas de BANCO de 2020).
 *
 * Es la misma numeración que actaDePeriodo_ de proyeccion.js (D183: el acta que CIERRA en un mes del plan),
 * que se queda como está: para una fecha del periodo que cierra en el mes M, actaDeFecha(…, fecha) =
 * actaDePeriodo_(…, M) (lo comprueba worker/pruebas/casos_sql.js contra la vista proyeccion_plan_maestro).
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 */
import { OBRA_ID, memo_ } from '../../comun.js';

/* ---------- tabla periodos (004) — una consulta por petición ----------
 * [{acta, fi, ff}] con fi/ff 'YYYY-MM-DD', ordenados por fecha_inicial. Sin tabla (BD sin 004) → [] y la
 * fórmula de respaldo hace todo el trabajo. */
export async function periodos_(c){
  return memo_(c, 'periodos_actas', async function(){
    let per=[];
    try{ per = await c.sql`SELECT acta, to_char(fecha_inicial,'YYYY-MM-DD') AS fi, to_char(fecha_final,'YYYY-MM-DD') AS ff
                           FROM periodos WHERE obra_id=${OBRA_ID} ORDER BY fecha_inicial`; }catch(e){ per=[]; }
    return per.map(function(p){ return { acta:String(p.acta==null?'':p.acta).trim(), fi:p.fi, ff:p.ff }; });
  });
}

/* ---------- D184 · ACTA de una fecha 'YYYY-MM-DD' (regla de arriba). '' si la fecha no es válida ---------- */
export function actaDeFecha(periodos, fecha){
  const f = String(fecha==null?'':fecha).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(f)) return '';
  const lista = Array.isArray(periodos) ? periodos : [];
  for(let i=0;i<lista.length;i++){ const p=lista[i]; if(p && p.fi && p.ff && f>=p.fi && f<=p.ff) return String(p.acta==null?'':p.acta); }
  let y = Number(f.slice(0,4)), m = Number(f.slice(5,7));
  if(Number(f.slice(8,10)) > 15){ m++; if(m>12){ m=1; y++; } }   // del 16 en adelante cierra el mes siguiente
  const n = (y-2025)*12 + m + 2;
  return n>=1 ? String(n) : '';
}
