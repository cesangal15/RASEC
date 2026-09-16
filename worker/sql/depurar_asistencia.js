#!/usr/bin/env node
/**
 * depurar_asistencia.js — quita de `asistencia` las filas que sobran por haber repetido el backfill (4.01).
 *
 * POR QUÉ HAY SOBRANTES. Cuando un capataz reenviaba un día en el Sheet, la hoja BORRABA sus filas y las
 * volvía a escribir con OTROS id_registro (upsert por fecha+cuadrilla, D107/D126). El backfill solo anexa
 * (ON CONFLICT DO NOTHING por id_registro), así que al recargar con un volcado más nuevo quedaron en Supabase
 * las filas viejas Y las nuevas. Lo mismo si alguien corrigió un día desde la app después del corte y luego
 * se recargó el volcado (el Worker había borrado las viejas y el backfill las volvió a meter).
 *
 *   node worker/sql/depurar_asistencia.js --volcado="C:\Galca\volcado\<fecha>_asistencias" --desde=2026-09-15 --hasta=2026-09-15 --corte=2026-09-16T18:35:34Z
 *   … mismo comando + --aplicar      → borra (en UNA transacción)
 *
 * Sin --aplicar solo MUESTRA qué borraría. Conexión: $env:DATABASE_URL (nunca en un archivo del repo).
 *
 * Regla, por cada fecha del rango (el volcado es el estado FINAL del Sheet, tomado después del corte):
 *   A · «vieja»: la fila NO está en el volcado y su timestamp es ANTERIOR al corte → era una versión que el
 *       Sheet reemplazó; se borra. (Si el volcado no trae ninguna fila de esa fecha, la fecha se salta.)
 *   B · «repetida»: entre las que quedan, la misma persona el mismo día (código sin ceros a la izquierda;
 *       si no, cédula; si no, nombre+cuadrilla, D126) → se queda la de timestamp MÁS RECIENTE (la última
 *       que se envió, como hace la app); empate → la que está en el volcado.
 *   Las filas que NO están en el volcado pero son POSTERIORES al corte (escritas por la app en Supabase) se
 *   conservan siempre y ganan la regla B frente a la versión del Sheet.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OBRA_ID, leerArgs, abrirPostgres } from './backfill_lib.js';
import { csvObjetos } from './csv.js';

export function clavePersona(r){
  const co = String(r.codigo == null ? '' : r.codigo).trim().replace(/^0+/, '');
  if (co) return 'COD:' + co;
  const ce = String(r.cedula == null ? '' : r.cedula).trim();
  if (ce) return 'CED:' + ce;
  return 'NOM:' + String(r.nombre == null ? '' : r.nombre).trim().toUpperCase() + '|' + String(r.cuadrilla || '');
}
function msDe(ts){ if (ts == null || ts === '') return 0; const t = (ts instanceof Date) ? ts.getTime() : Date.parse(String(ts)); return isFinite(t) ? t : 0; }

/* Calcula qué borrar. `filasBd` = filas de la tabla; `idsVolcado` = {fecha: Set(id_registro)}; `corteMs` = corte. */
export function planDepuracion(filasBd, idsVolcado, corteMs){
  const porFecha = {};
  filasBd.forEach(r => { (porFecha[r.fecha] = porFecha[r.fecha] || []).push(r); });
  const borrar = [], resumen = [];
  Object.keys(porFecha).sort().forEach(fecha => {
    const filas = porFecha[fecha], ids = idsVolcado[fecha];
    const res = { fecha, supabase: filas.length, volcado: ids ? ids.size : 0, viejas: 0, repetidas: 0, posterioresAlCorte: 0, quedan: 0, saltada: false };
    if (!ids || !ids.size) { res.saltada = true; res.quedan = filas.length; resumen.push(res); return; }
    const vivas = [];
    filas.forEach(r => {
      const enVolcado = ids.has(r.id_registro), posterior = msDe(r.timestamp) > corteMs;
      if (!enVolcado && posterior) res.posterioresAlCorte++;
      if (!enVolcado && !posterior) { res.viejas++; borrar.push(Object.assign({ motivo: 'vieja (ya no está en el Sheet final)' }, r)); return; }
      vivas.push(Object.assign({ _enVolcado: enVolcado }, r));
    });
    const grupos = {};
    vivas.forEach(r => { const k = clavePersona(r); (grupos[k] = grupos[k] || []).push(r); });
    Object.values(grupos).forEach(g => {
      if (g.length < 2) return;
      g.sort((a, b) => (msDe(b.timestamp) - msDe(a.timestamp)) || ((b._enVolcado ? 1 : 0) - (a._enVolcado ? 1 : 0)) || String(a.id_registro).localeCompare(String(b.id_registro)));
      g.slice(1).forEach(r => { res.repetidas++; borrar.push(Object.assign({ motivo: 'repetida (misma persona, se queda la más reciente)' }, r)); });
    });
    res.quedan = filas.length - res.viejas - res.repetidas;
    resumen.push(res);
  });
  return { borrar, resumen };
}

export function idsDelVolcado(texto, desde, hasta){
  const out = {};
  csvObjetos(texto).forEach(r => {
    const f = String(r.fecha || '').slice(0, 10), id = String(r.id_registro || '').trim();
    if (!id || f < desde || f > hasta) return;
    (out[f] = out[f] || new Set()).add(id);
  });
  return out;
}

export async function depurar(sql, { volcadoTexto, desde, hasta, corte, aplicar }){
  const corteMs = Date.parse(corte);
  if (!isFinite(corteMs)) throw new Error('--corte no es una fecha-hora válida: ' + corte);
  const filas = await sql.unsafe('SELECT id_registro, "timestamp", fecha, cuadrilla, codigo, cedula, nombre, reporta FROM asistencia WHERE obra_id = $1 AND fecha BETWEEN $2 AND $3', [OBRA_ID, desde, hasta]);
  const plan = planDepuracion(filas, idsDelVolcado(volcadoTexto, desde, hasta), corteMs);
  let borradas = 0;
  if (aplicar && plan.borrar.length) {
    await sql.begin(async (tx) => {
      const r = await tx.unsafe('DELETE FROM asistencia WHERE obra_id = $1 AND id_registro = ANY($2) RETURNING 1', [OBRA_ID, plan.borrar.map(x => x.id_registro)]);
      borradas = r.length;
    });
  }
  return Object.assign(plan, { borradas });
}

/* ---------- CLI ---------- */
async function main(){
  const a = leerArgs();
  const dir = a.volcado ? path.resolve(String(a.volcado)) : '';
  const archivo = dir && path.join(dir, 'ASISTENCIA.csv');
  if (!archivo || !fs.existsSync(archivo)) { console.error('Falta --volcado=<carpeta *_asistencias con ASISTENCIA.csv>'); process.exit(2); }
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(String(a.desde || '')) || !re.test(String(a.hasta || ''))) { console.error('Faltan --desde=yyyy-MM-dd y --hasta=yyyy-MM-dd'); process.exit(2); }
  if (!a.corte) { console.error('Falta --corte=<fecha-hora ISO del deploy que pasó asistencias a "db", p. ej. 2026-09-16T18:35:34Z>'); process.exit(2); }
  const cadena = process.env.DATABASE_URL || '';
  if (!cadena) { console.error('Falta $env:DATABASE_URL'); process.exit(2); }
  const sql = await abrirPostgres(cadena);
  try {
    const r = await depurar(sql, { volcadoTexto: fs.readFileSync(archivo, 'utf8'), desde: a.desde, hasta: a.hasta, corte: a.corte, aplicar: !!a.aplicar });
    console.log((a.aplicar ? 'DEPURACIÓN APLICADA' : 'SIMULACIÓN (no borra nada; añade --aplicar para borrar)') + ' · asistencia ' + a.desde + ' → ' + a.hasta + ' · corte ' + a.corte);
    r.resumen.forEach(x => console.log('  ' + x.fecha + ' · Supabase ' + String(x.supabase).padStart(4) + ' · Sheet final ' + String(x.volcado).padStart(4) + ' · viejas ' + String(x.viejas).padStart(3) + ' · repetidas ' + String(x.repetidas).padStart(3) + ' · de la app tras el corte ' + x.posterioresAlCorte + ' · quedan ' + x.quedan + (x.saltada ? '  (el volcado no trae esa fecha: se salta)' : '')));
    console.log('  Filas a borrar: ' + r.borrar.length + (a.aplicar ? ' · borradas: ' + r.borradas : ''));
    r.borrar.slice(0, 80).forEach(x => console.log('    - ' + x.fecha + ' · ' + String(x.cuadrilla || '').padEnd(12) + ' · ' + String(x.nombre || '').padEnd(34) + ' · ' + (x.timestamp instanceof Date ? x.timestamp.toISOString() : x.timestamp) + ' · ' + x.motivo));
    if (r.borrar.length > 80) console.log('    … y ' + (r.borrar.length - 80) + ' más');
  } finally { await sql.end({ timeout: 5 }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error('Falló: ' + (e && e.stack || e)); process.exit(1); });
