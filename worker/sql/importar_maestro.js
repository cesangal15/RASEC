#!/usr/bin/env node
/**
 * importar_maestro.js — CARGA ÚNICA de la hoja DATA del Excel maestro del jefe a la tabla `data` de Galca (D186).
 * Hasta la FECHA DE CORTE manda el Excel: reemplaza lo que haya en Galca en esas fechas (también desde el 17-jun,
 * lo que mandó la app); después del corte todo se edita en Galca (Revisión de DATA) y los capataces siguen enviando.
 *
 *   node worker/sql/importar_maestro.js --excel="C:\Galca\copia\TM2_SUR_REPORTE.xlsx" --hasta=2026-09-17 --simular   # no escribe
 *   node worker/sql/importar_maestro.js --excel=… --hasta=2026-09-17 --respaldo="C:\Galca\respaldos"                  # carga
 *   node worker/sql/importar_maestro.js --excel=… --hasta=… --sin-migraciones        # no re-aplica 005→008 al final
 *
 * Conexión: DATABASE_URL en la terminal (o --conexion-archivo=<ruta fuera del repo>); nunca en el repo.
 * Con --simular sin conexión solo resume el Excel; con conexión, además compara con Galca (sin escribir nada).
 * El Excel se LEE (SheetJS de tablero-xlsx.js en un vm, VALORES calculados de las fórmulas); nunca se escribe.
 * Trabaja sobre una COPIA del libro (el original puede estar abierto por el jefe).
 *
 * Hoja DATA A:T → tabla `data` (mismo orden que 001_esquema.sql; los encabezados se comprueban, si no son esos
 * aborta). Columnas U en adelante: no se cargan (hay celdas sueltas; salen como aviso).
 *   FECHA        serial de Excel / Date / 'yyyy-mm-dd' / 'd/m/yyyy' → 'yyyy-mm-dd' (sin corrimiento de zona:
 *                SSF.parse_date_code). Sin fecha → se salta y se cuenta; fecha < 2025-01-01 o > hoy → aviso;
 *                fecha > --hasta → se cuenta y se ignora (después del corte manda Galca).
 *   texto        trim; un número en una columna de texto (ORDEN, ACTA, ABS…) → texto sin decimales espurios
 *                (210 → '210', 74.07000000000001 → '74.07').
 *   LARGO/ESPESOR/FC/CANTIDAD   number o NULL (texto '12,5' se entiende; lo que no, NULL + aviso).
 *   internas     id_registro = 'mae-' + uuidDeterminista(fecha | nº de fila de Excel | contenido A:T) → relanzar da
 *                los mismos ids · "timestamp" now() · capataz 'maestro' · rol 'importacion' · actividad =
 *                descripcion (como el alta de la Revisión de DATA) · pk_inicial/pk_final = abs · area =
 *                deriveArea(centro_de_costo) · clima '' · version 0 · editado_por 'importacion D186' · editado_ts now().
 *   El sello '[Clima: X]' de la OBSERVACIÓN se deja tal cual: lo mueve 005_data_clima.sql al re-aplicarse.
 *
 * Escritura (sin --simular), UNA transacción:
 *   1. esquema_version ≥ 8 (si no: «primero despliega 003→008, OPERACIONES §12»).
 *   2. RESPALDO: todas las filas de `data` (obra tm2sur) con fecha ≤ --hasta → CSV UTF-8 con BOM, separador ';',
 *      en --respaldo (por defecto la carpeta actual) como respaldo_data_<hasta>_<yyyymmdd-hhmmss>.csv; se relee
 *      y se confirma cuántas filas escribió (si no cuadra, aborta sin borrar).
 *   3. DELETE FROM data WHERE obra_id='tm2sur' AND fecha <= hasta (debe borrar tantas como respaldó).
 *   4. INSERT de las filas del Excel por lotes de 500.   5. COMMIT.
 * Luego, salvo --sin-migraciones, re-aplica 005 → 006 → 007 → 008 (regla de OPERACIONES §12 tras cargar DATA) y
 * muestra qué hizo cada una. Verificación final: por mes, filas y Σ LARGO de `data` (fecha ≤ hasta) = Excel;
 * imprime ✓/✗ y sale con 1 si no cuadra.
 *
 * Es también un módulo: `importarMaestro(sql, opciones)` (worker/pruebas/verificar_d186_importar_maestro.mjs lo
 * prueba con PGlite). `sql` = postgres.js o el adaptador de PGlite (usa sql.exec para los .sql si existe).
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { OBRA_ID, deriveArea, uuidDeterminista, normTexto, leerArgs, abrirPostgres } from './backfill_lib.js';

export { OBRA_ID };

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, '..', '..');
const SQL_DIR = AQUI;

// Hoja DATA A:T (encabezados del maestro) ↔ columnas de `data` (001_esquema.sql, mismo orden).
export const ENCABEZADOS = ['FECHA','ORDEN','GRUPO','CENTRO DE COSTO','CAPITULO','DESCRIPCION','UNIDAD FUNCIONAL','PROYECTO','ELEMENTO','ABS INICIAL','ABS FINAL','LIBERACION','ACTA','UNIDAD MEDIDA','LARGO','ESPESOR','FC','CANTIDAD','OBSERVACION','Columna1'];
export const COLS_AT = ['fecha','orden','grupo','centro_de_costo','capitulo','descripcion','unidad_funcional','proyecto','elemento','abs_inicial','abs_final','liberacion','acta','unidad_medida','largo','espesor','fc','cantidad','observacion','columna1'];
const NUMERICAS = new Set(['largo','espesor','fc','cantidad']);
// Columnas que se insertan (sin "timestamp"/editado_ts, que van como now()).
const COLS_INSERT = COLS_AT.concat(['id_registro','capataz','rol','actividad','pk_inicial','pk_final','area','clima','version','editado_por']);
export const MIGRACIONES_TRAS_CARGA = ['005_data_clima.sql', '006_proyeccion.sql', '007_data_completa.sql', '008_tablero_vivo.sql'];
const FECHA_MIN_RAZONABLE = '2025-01-01';
const LOTE = 500;
const q = (c) => '"' + c + '"';

/* ---------- utilidades ---------- */
export function hoyBogota(){ return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10); }
const dos = (n) => String(n).padStart(2, '0');
function ymd(y, m, d){ return y + '-' + dos(m) + '-' + dos(d); }
function fechaValida(y, m, d){ const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; }
// número → texto sin decimales espurios del binario (74.07000000000001 → '74.07'); entero sin '.0'.
export function numATexto(n){ if (!isFinite(n)) return String(n); if (Number.isInteger(n)) return String(n); return String(Number(n.toPrecision(15))); }

let _XLSX = null;
export function cargarSheetJS(){
  if (_XLSX) return _XLSX;
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(REPO, 'tablero-xlsx.js'), 'utf8'), ctx, { filename: 'tablero-xlsx.js' });
  if (!ctx.XLSX) throw new Error('tablero-xlsx.js no dejó XLSX en el contexto');
  return (_XLSX = ctx.XLSX);
}

/* Celda de FECHA → 'yyyy-mm-dd' o null (vacía) o undefined (no se entiende). */
function celdaFecha(X, cell){
  if (!cell || cell.v === null || cell.v === undefined || cell.v === '') return null;
  const v = cell.v;
  if (typeof v === 'number') {
    const p = X.SSF.parse_date_code(v);
    return p && fechaValida(p.y, p.m, p.d) ? ymd(p.y, p.m, p.d) : undefined;
  }
  if (v instanceof Date) return ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());   // SheetJS arma el Date en hora local
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m && fechaValida(+m[1], +m[2], +m[3])) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);                                  // d/m/yyyy (Colombia)
  if (m && fechaValida(+m[3], +m[2], +m[1])) return ymd(+m[3], +m[2], +m[1]);
  return undefined;
}
function celdaTexto(cell){
  if (!cell || cell.v === null || cell.v === undefined) return '';
  if (cell.t === 'e') return '';
  if (typeof cell.v === 'number') return numATexto(cell.v);
  if (cell.v instanceof Date) return ymd(cell.v.getFullYear(), cell.v.getMonth() + 1, cell.v.getDate());
  return String(cell.v).trim();
}
function celdaNumero(cell){   // → {n} | {n:null} | {n:null, malo:'texto'}
  if (!cell || cell.v === null || cell.v === undefined) return { n: null };
  if (cell.t === 'e') return { n: null, malo: 'error ' + (cell.w || cell.v) };
  if (typeof cell.v === 'number') return { n: isFinite(cell.v) ? cell.v : null };
  if (typeof cell.v === 'boolean') return { n: null, malo: String(cell.v) };
  const s = String(cell.v).trim();
  if (!s) return { n: null };
  const n = Number(s.replace(/\s/g, '').replace(',', '.'));
  return isFinite(n) ? { n } : { n: null, malo: '«' + s + '»' };
}

/* ---------- 1 · leer la hoja DATA ---------- */
/* Devuelve { filas (fecha ≤ hasta, ya mapeadas a `data`), posteriores, sinFecha, fechaIlegible, raras, avisos,
 *            total, fechaMin, fechaMax }. Lanza un Error legible si falta la hoja o los encabezados no son A:T. */
export function leerMaestro(rutaExcel, hasta, opciones){
  const op = opciones || {};
  const hoy = op.hoy || hoyBogota();
  const X = cargarSheetJS();
  if (!fs.existsSync(rutaExcel)) throw new Error('No existe el Excel: ' + rutaExcel);
  const wb = X.read(fs.readFileSync(rutaExcel), { type: 'buffer', sheets: ['DATA'] });   // valores calculados (cell.v), sin cellDates
  const ws = wb.Sheets['DATA'];
  if (!ws || !ws['!ref']) throw new Error('El Excel no tiene una hoja «DATA» con datos. Hojas: ' + (wb.SheetNames || []).join(', '));
  const rg = X.utils.decode_range(ws['!ref']);
  const celda = (r, c) => ws[X.utils.encode_cell({ r, c })];

  // encabezados A:T (fila 1): comparación normalizada (trim, mayúsculas, sin tildes: «LIBERACION » vale)
  const leidos = ENCABEZADOS.map((_, c) => celdaTexto(celda(rg.s.r, c)));
  const malos = ENCABEZADOS.map((h, c) => normTexto(leidos[c]) === normTexto(h) ? null : String.fromCharCode(65 + c) + ': «' + leidos[c] + '» (se esperaba «' + h + '»)').filter(Boolean);
  if (malos.length) throw new Error('Los encabezados de la hoja DATA (fila ' + (rg.s.r + 1) + ', A:T) no son los del maestro → NO se carga nada.\n    ' + malos.join('\n    '));

  const res = { filas: [], posteriores: 0, posterioresPorFecha: {}, sinFecha: 0, sinFechaConDatos: [], fechaIlegible: [], raras: [], avisos: [], total: 0, fechaMin: null, fechaMax: null, fueraAT: [] };
  for (let r = rg.s.r + 1; r <= rg.e.r; r++) {
    const filaExcel = r + 1;
    const vacia = ENCABEZADOS.every((_, c) => celdaTexto(celda(r, c)) === '');
    for (let c = ENCABEZADOS.length; c <= rg.e.c; c++) { const x = celda(r, c); if (x && x.v !== null && x.v !== undefined && x.v !== '') res.fueraAT.push(X.utils.encode_cell({ r, c }) + '=' + celdaTexto(x)); }
    if (vacia) continue;
    res.total++;
    const fecha = celdaFecha(X, celda(r, 0));
    if (fecha === null) { res.sinFecha++; res.sinFechaConDatos.push(filaExcel); continue; }
    if (fecha === undefined) { res.fechaIlegible.push('fila ' + filaExcel + ': FECHA «' + celdaTexto(celda(r, 0)) + '» no se entiende → NO se carga'); continue; }
    if (fecha < FECHA_MIN_RAZONABLE || fecha > hoy) res.raras.push('fila ' + filaExcel + ': FECHA ' + fecha + (fecha > hoy ? ' es posterior a hoy (' + hoy + ')' : ' es anterior a ' + FECHA_MIN_RAZONABLE));
    if (!res.fechaMin || fecha < res.fechaMin) res.fechaMin = fecha;
    if (!res.fechaMax || fecha > res.fechaMax) res.fechaMax = fecha;
    if (fecha > hasta) { res.posteriores++; res.posterioresPorFecha[fecha] = (res.posterioresPorFecha[fecha] || 0) + 1; continue; }
    const f = { fecha };
    for (let c = 1; c < COLS_AT.length; c++) {
      const col = COLS_AT[c], x = celda(r, c);
      if (NUMERICAS.has(col)) { const v = celdaNumero(x); f[col] = v.n; if (v.malo) res.avisos.push('fila ' + filaExcel + ': ' + ENCABEZADOS[c] + ' ' + v.malo + ' no es número → NULL'); }
      else f[col] = celdaTexto(x);
    }
    f.id_registro = 'mae-' + uuidDeterminista(fecha + '|' + filaExcel + '|' + JSON.stringify(COLS_AT.map(k => f[k])));
    f.capataz = 'maestro'; f.rol = 'importacion'; f.actividad = f.descripcion;
    f.pk_inicial = f.abs_inicial; f.pk_final = f.abs_final;
    f.area = deriveArea(f.centro_de_costo); f.clima = ''; f.version = 0; f.editado_por = 'importacion D186';
    f._fila = filaExcel;
    res.filas.push(f);
  }
  return res;
}

/* ---------- resúmenes por mes ---------- */
function resumenExcel(filas){
  const m = {};
  for (const f of filas) { const k = f.fecha.slice(0, 7); const o = m[k] || (m[k] = { filas: 0, largo: 0, cantidad: 0 }); o.filas++; o.largo += f.largo || 0; o.cantidad += f.cantidad || 0; }
  return m;
}
async function resumenGalca(sql, hasta){
  const r = await sql.unsafe(`SELECT to_char(fecha, 'YYYY-MM') AS mes, count(*)::int AS filas, coalesce(sum(largo), 0)::float8 AS largo, coalesce(sum(cantidad), 0)::float8 AS cantidad
      FROM data WHERE obra_id = $1 AND fecha <= $2::date GROUP BY 1 ORDER BY 1`, [OBRA_ID, hasta]);
  const m = {}; r.forEach(x => { m[x.mes] = { filas: Number(x.filas), largo: Number(x.largo), cantidad: Number(x.cantidad) }; }); return m;
}
async function fechasGalca(sql, hasta){
  const r = await sql.unsafe(`SELECT fecha::text AS fecha, count(*)::int AS n FROM data WHERE obra_id = $1 AND fecha <= $2::date GROUP BY 1 ORDER BY 1`, [OBRA_ID, hasta]);
  const m = {}; r.forEach(x => { m[x.fecha] = Number(x.n); }); return m;
}
const casi = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function tablaMeses(log, exc, gal){
  const meses = Array.from(new Set(Object.keys(exc).concat(Object.keys(gal || {})))).sort();
  const cab = '  mes      ' + 'Excel filas'.padStart(11) + 'Σ LARGO'.padStart(16) + 'Σ CANTIDAD'.padStart(16) + (gal ? ' │' + 'Galca filas'.padStart(12) + 'Σ LARGO'.padStart(16) + 'Σ CANTIDAD'.padStart(16) : '');
  log(cab); log('  ' + '─'.repeat(cab.length - 2));
  const tot = { e: { filas: 0, largo: 0, cantidad: 0 }, g: { filas: 0, largo: 0, cantidad: 0 } };
  for (const m of meses) {
    const e = exc[m] || { filas: 0, largo: 0, cantidad: 0 }, g = (gal || {})[m] || { filas: 0, largo: 0, cantidad: 0 };
    ['filas','largo','cantidad'].forEach(k => { tot.e[k] += e[k]; tot.g[k] += g[k]; });
    log('  ' + m + '  ' + String(e.filas).padStart(11) + fmt(e.largo).padStart(16) + fmt(e.cantidad).padStart(16) + (gal ? ' │' + String(g.filas).padStart(12) + fmt(g.largo).padStart(16) + fmt(g.cantidad).padStart(16) : ''));
  }
  log('  ' + 'TOTAL   ' + String(tot.e.filas).padStart(11) + fmt(tot.e.largo).padStart(16) + fmt(tot.e.cantidad).padStart(16) + (gal ? ' │' + String(tot.g.filas).padStart(12) + fmt(tot.g.largo).padStart(16) + fmt(tot.g.cantidad).padStart(16) : ''));
}

/* ---------- respaldo CSV (UTF-8 con BOM, ';') ---------- */
function celdaCsv(v){
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : (typeof v === 'number' ? numATexto(v) : String(v));
  if (/[;"\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
// Cuenta registros de un CSV respetando comillas (una observación puede traer saltos de línea).
function contarRegistrosCsv(texto){
  let n = 0, enc = false, algo = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (ch === '"') { enc = !enc; algo = true; continue; }
    if (!enc && ch === '\n') { if (algo) n++; algo = false; continue; }
    if (ch !== '\r') algo = true;
  }
  return n + (algo ? 1 : 0);
}
function sello(){ const d = new Date(); return d.getFullYear() + dos(d.getMonth() + 1) + dos(d.getDate()) + '-' + dos(d.getHours()) + dos(d.getMinutes()) + dos(d.getSeconds()); }
async function escribirRespaldo(tx, carpeta, hasta){
  const filas = await tx.unsafe(`SELECT * FROM data WHERE obra_id = $1 AND fecha <= $2::date ORDER BY fecha, id_registro`, [OBRA_ID, hasta]);
  const cols = filas.length ? Object.keys(filas[0]) : (await tx.unsafe(`SELECT column_name FROM information_schema.columns WHERE table_name = 'data' ORDER BY ordinal_position`)).map(r => r.column_name);
  const lineas = [cols.join(';')].concat(filas.map(f => cols.map(c => celdaCsv(f[c])).join(';')));
  fs.mkdirSync(carpeta, { recursive: true });
  let archivo = path.join(carpeta, 'respaldo_data_' + hasta + '_' + sello() + '.csv');
  for (let i = 2; fs.existsSync(archivo); i++) archivo = path.join(carpeta, 'respaldo_data_' + hasta + '_' + sello() + '_' + i + '.csv');
  fs.writeFileSync(archivo, '\ufeff' + lineas.join('\r\n') + '\r\n', 'utf8');
  const releidas = contarRegistrosCsv(fs.readFileSync(archivo, 'utf8').replace(/^\ufeff/, '')) - 1;
  if (releidas !== filas.length) throw new Error('el respaldo ' + archivo + ' tiene ' + releidas + ' filas al releerlo y se leyeron ' + filas.length + ' de la BD → NO se borra nada');
  return { archivo, filas: filas.length };
}

/* ---------- INSERT por lotes ---------- */
async function insertarLote(tx, lote){
  const valores = []; const n = COLS_INSERT.length;
  const grupos = lote.map((f, i) => {
    valores.push(OBRA_ID); COLS_INSERT.forEach(c => valores.push(f[c]));
    const b = i * (n + 1);
    return '(' + Array.from({ length: n + 1 }, (_, j) => '$' + (b + j + 1)).join(', ') + ', now(), now())';
  });
  const txt = 'INSERT INTO data (' + ['obra_id'].concat(COLS_INSERT).map(q).join(', ') + ', "timestamp", editado_ts) VALUES ' + grupos.join(', ') + ' RETURNING 1';
  return (await tx.unsafe(txt, valores)).length;
}

/* ---------- migraciones 005→008 ---------- */
const CUENTAS = {
  sellos:     { q: `SELECT count(*)::int AS n FROM data WHERE obra_id = 'tm2sur' AND observacion ~* '\\[Clima:\\s*[^\\]]*\\]'`, txt: 'filas con sello «[Clima: …]» en la observación' },
  incompletas:{ q: `SELECT count(*)::int AS n FROM data WHERE obra_id = 'tm2sur' AND (btrim(acta) = '' OR (largo IS NOT NULL AND (espesor IS NULL OR fc IS NULL OR cantidad IS NULL)))`, txt: 'filas con ACTA vacía o ESPESOR/FC/CANTIDAD por completar' },
  ajuste:     { q: `SELECT count(*)::int AS n FROM data WHERE obra_id = 'tm2sur' AND elemento ~* '^\\s*ajuste\\s+origen' AND fc IS DISTINCT FROM 1`, txt: '«ajuste origen» con FC ≠ 1' },
  version:    { q: `SELECT coalesce(max(version), 0)::int AS n FROM esquema_version`, txt: 'esquema_version máx.' }
};
const QUE_CUENTA = { '005_data_clima.sql': ['sellos'], '006_proyeccion.sql': ['version'], '007_data_completa.sql': ['incompletas', 'ajuste'], '008_tablero_vivo.sql': ['version'] };
async function contar(sql, k){ return Number((await sql.unsafe(CUENTAS[k].q))[0].n); }
async function ejecutarArchivoSql(sql, archivo){
  const texto = fs.readFileSync(archivo, 'utf8');
  if (typeof sql.exec === 'function') return sql.exec(texto);   // PGlite (banco)
  return sql.unsafe(texto).simple();                              // postgres.js: protocolo simple = varias sentencias
}
export async function reaplicarMigraciones(sql, log){
  const out = [];
  for (const f of MIGRACIONES_TRAS_CARGA) {
    const ks = QUE_CUENTA[f] || [];
    const antes = {}; for (const k of ks) antes[k] = await contar(sql, k);
    const t0 = Date.now();
    await ejecutarArchivoSql(sql, path.join(SQL_DIR, f));
    const despues = {}; for (const k of ks) despues[k] = await contar(sql, k);
    const det = ks.map(k => CUENTAS[k].txt + ' ' + antes[k] + ' → ' + despues[k]).join(' · ');
    log('  · ' + f + ' re-aplicada (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)' + (det ? ': ' + det : '') + (f === '006_proyeccion.sql' || f === '008_tablero_vivo.sql' ? ' (no transforma DATA: vistas/permisos idempotentes)' : ''));
    out.push({ archivo: f, antes, despues });
  }
  return out;
}

/* ---------- verificación por mes ---------- */
export async function verificar(sql, filasExcel, hasta, log){
  const exc = resumenExcel(filasExcel), gal = await resumenGalca(sql, hasta);
  const meses = Array.from(new Set(Object.keys(exc).concat(Object.keys(gal)))).sort();
  const mal = [];
  for (const m of meses) {
    const e = exc[m] || { filas: 0, largo: 0 }, g = gal[m] || { filas: 0, largo: 0 };
    const bien = e.filas === g.filas && casi(e.largo, g.largo);
    log('  ' + (bien ? '✓' : '✗') + ' ' + m + '  filas ' + String(g.filas).padStart(4) + ' / Excel ' + String(e.filas).padStart(4) + ' · Σ LARGO ' + fmt(g.largo).padStart(14) + ' / Excel ' + fmt(e.largo).padStart(14));
    if (!bien) mal.push(m);
  }
  const ids = await sql.unsafe(`SELECT count(*)::int AS n, count(DISTINCT id_registro)::int AS d FROM data WHERE obra_id = $1 AND fecha <= $2::date AND id_registro LIKE 'mae-%'`, [OBRA_ID, hasta]);
  const idsBien = Number(ids[0].n) === filasExcel.length && Number(ids[0].d) === filasExcel.length;
  log('  ' + (idsBien ? '✓' : '✗') + ' ids «mae-…» = ' + ids[0].n + ' (distintos ' + ids[0].d + ') / Excel ' + filasExcel.length);
  return { ok: !mal.length && idsBien, mesesMal: mal, excel: exc, galca: gal };
}

/* ---------- función principal ---------- */
/* opciones: { excel, hasta, simular, respaldo (carpeta), sinMigraciones, hoy, log }
 * Devuelve { ok, simulado, leido, borraria/borradas, insertadas, respaldo, migraciones, verificacion, avisos }. */
export async function importarMaestro(sql, opciones){
  const op = opciones || {};
  const log = op.log || ((s) => console.log(s));
  const hoy = op.hoy || hoyBogota();
  const hasta = String(op.hasta || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hasta) || !fechaValida(+hasta.slice(0, 4), +hasta.slice(5, 7), +hasta.slice(8, 10))) throw new Error('--hasta=YYYY-MM-DD es obligatorio (fecha de corte: hasta ella manda el Excel)');
  if (hasta > hoy) throw new Error('--hasta=' + hasta + ' es posterior a hoy (' + hoy + '): el corte no puede estar en el futuro');
  if (!op.excel) throw new Error('--excel="<copia del libro>.xlsx" es obligatorio');
  const excel = path.resolve(String(op.excel));

  const t0 = Date.now();
  const L = leerMaestro(excel, hasta, { hoy });
  const avisos = [].concat(L.fechaIlegible, L.raras, L.avisos);
  if (L.fueraAT.length) avisos.push(L.fueraAT.length + ' celda(s) con datos FUERA de A:T (no se cargan): ' + L.fueraAT.slice(0, 12).join(', ') + (L.fueraAT.length > 12 ? ', …' : ''));
  log('Hoja DATA de ' + excel + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s): ' + L.total + ' filas con datos · FECHA ' + L.fechaMin + ' → ' + L.fechaMax);
  log('  entran (FECHA ≤ ' + hasta + '): ' + L.filas.length + ' · posteriores al corte (se ignoran): ' + L.posteriores
    + (L.posteriores ? ' [' + Object.keys(L.posterioresPorFecha).sort().map(f => f + ':' + L.posterioresPorFecha[f]).join(', ') + ']' : '')
    + ' · sin fecha (se saltan): ' + L.sinFecha + (L.sinFecha ? ' (filas ' + L.sinFechaConDatos.slice(0, 15).join(', ') + (L.sinFecha > 15 ? ', …' : '') + ')' : '')
    + ' · fecha ilegible: ' + L.fechaIlegible.length + ' · fechas raras: ' + L.raras.length);
  const exc = resumenExcel(L.filas);
  const res = { ok: true, simulado: !!op.simular, leido: { total: L.total, entran: L.filas.length, posteriores: L.posteriores, sinFecha: L.sinFecha, fechaMin: L.fechaMin, fechaMax: L.fechaMax, raras: L.raras, fueraAT: L.fueraAT }, filas: L.filas, avisos };

  // Días ≤ corte que Galca tiene y el Excel no: quedarían VACÍOS tras la carga (manda el Excel).
  const diasExcel = new Set(L.filas.map(f => f.fecha));
  const avisarDiasVacios = (fg) => {
    const vacios = Object.keys(fg).filter(d => !diasExcel.has(d));
    if (vacios.length) avisos.push('OJO: ' + vacios.length + ' día(s) ≤ corte con filas en Galca y NINGUNA en el Excel quedarían vacíos: ' + vacios.slice(0, 20).map(d => d + ' (' + fg[d] + ')').join(', ') + (vacios.length > 20 ? ', …' : ''));
    return vacios;
  };

  if (op.simular) {
    log('\nSIMULACIÓN (no escribe nada)' + (sql ? ' · comparando con Galca' : ' · sin conexión: solo el Excel'));
    if (sql) {
      const gal = await resumenGalca(sql, hasta), fg = await fechasGalca(sql, hasta);
      const post = await sql.unsafe(`SELECT count(*)::int AS n FROM data WHERE obra_id = $1 AND fecha > $2::date`, [OBRA_ID, hasta]);
      tablaMeses(log, exc, gal);
      res.borraria = Object.values(fg).reduce((a, b) => a + b, 0);
      res.diasVacios = avisarDiasVacios(fg);
      log('\n  borraría de Galca (fecha ≤ ' + hasta + '): ' + res.borraria + ' · insertaría del Excel: ' + L.filas.length + ' · filas de Galca posteriores al corte (NO se tocan): ' + post[0].n);
      const ver = await sql.unsafe(`SELECT coalesce(max(version), 0)::int AS v FROM esquema_version`).catch(() => [{ v: 0 }]);
      if (Number(ver[0].v) < 8) avisos.push('esquema_version = ' + ver[0].v + ' (< 8): la carga real abortaría; primero despliega 003→008 (OPERACIONES §12)');
    } else tablaMeses(log, exc, null);
    res.insertaria = L.filas.length;
    imprimirAvisos(log, avisos);
    return res;
  }

  if (!sql) throw new Error('sin conexión: para cargar hace falta DATABASE_URL (o --conexion-archivo); con --simular no');
  const carpeta = path.resolve(String(op.respaldo || '.'));
  const fgAntes = await fechasGalca(sql, hasta);
  res.diasVacios = avisarDiasVacios(fgAntes);
  log('\nCARGA (una transacción) · corte ' + hasta);
  await sql.begin(async (tx) => {
    const ver = await tx.unsafe(`SELECT coalesce(max(version), 0)::int AS v FROM esquema_version`);
    if (Number(ver[0].v) < 8) throw new Error('esquema_version = ' + ver[0].v + ' (< 8): primero despliega 003→008, OPERACIONES §12. No se tocó nada.');
    const r = await escribirRespaldo(tx, carpeta, hasta);
    res.respaldo = r;
    log('  1. respaldo: ' + r.filas + ' fila(s) de data (fecha ≤ ' + hasta + ') escritas y releídas en ' + r.archivo);
    const b = await tx.unsafe(`DELETE FROM data WHERE obra_id = $1 AND fecha <= $2::date RETURNING 1`, [OBRA_ID, hasta]);
    if (b.length !== r.filas) throw new Error('el DELETE borraría ' + b.length + ' filas y el respaldo tiene ' + r.filas + ' → se deshace todo');
    res.borradas = b.length;
    log('  2. borradas de Galca: ' + b.length);
    let ins = 0;
    for (let i = 0; i < L.filas.length; i += LOTE) ins += await insertarLote(tx, L.filas.slice(i, i + LOTE));
    if (ins !== L.filas.length) throw new Error('se insertaron ' + ins + ' de ' + L.filas.length + ' → se deshace todo');
    res.insertadas = ins;
    log('  3. insertadas del Excel: ' + ins + ' (lotes de ' + LOTE + ')');
  });
  log('  4. COMMIT ✓');

  if (!op.sinMigraciones) { log('\nRe-aplicando 005 → 008 (OPERACIONES §12, tras cargar DATA):'); res.migraciones = await reaplicarMigraciones(sql, log); }
  else log('\n--sin-migraciones: NO se re-aplicaron 005→008 (hazlo a mano en ese orden: OPERACIONES §12)');

  log('\nVerificación (data con fecha ≤ ' + hasta + ' vs Excel), por mes:');
  res.verificacion = await verificar(sql, L.filas, hasta, log);
  res.ok = res.verificacion.ok;
  log(res.ok ? '  ✓ CUADRA: Galca = Excel hasta ' + hasta : '  ✗ NO CUADRA en ' + res.verificacion.mesesMal.join(', ') + ' (el respaldo está en ' + res.respaldo.archivo + ')');
  imprimirAvisos(log, avisos);
  return res;
}
function imprimirAvisos(log, avisos){
  if (!avisos.length) { log('\nAvisos: ninguno'); return; }
  log('\nAvisos (' + avisos.length + '):');
  avisos.slice(0, 40).forEach(a => log('  ! ' + a));
  if (avisos.length > 40) log('  ! … y ' + (avisos.length - 40) + ' más');
}

/* ---------- CLI ---------- */
async function main(){
  const args = leerArgs();
  if (!args.excel || !args.hasta) {
    console.error('Uso: node worker/sql/importar_maestro.js --excel="<copia.xlsx>" --hasta=YYYY-MM-DD [--simular] [--respaldo=<carpeta>] [--sin-migraciones] [--conexion-archivo=<ruta>]');
    process.exit(2);
  }
  let cadena = process.env.DATABASE_URL || '';
  if (!cadena && args['conexion-archivo']) cadena = fs.readFileSync(String(args['conexion-archivo']), 'utf8').split(/\r?\n/)[0].trim();
  if (!cadena && !args.simular) { console.error('Falta la conexión: $env:DATABASE_URL = "postgres://…" (o --conexion-archivo=<ruta fuera del repo>). Con --simular no hace falta.'); process.exit(2); }
  const sql = cadena ? await abrirPostgres(cadena) : null;
  console.log('Importar DATA del maestro (D186) · corte ' + args.hasta + (args.simular ? ' · SIMULACIÓN' : ''));
  let res;
  try { res = await importarMaestro(sql, { excel: args.excel, hasta: args.hasta, simular: !!args.simular, respaldo: args.respaldo, sinMigraciones: !!args['sin-migraciones'] }); }
  finally { if (sql) await sql.end({ timeout: 5 }); }
  if (!res.ok) process.exit(1);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(err => { console.error('\nLa importación falló: ' + (err && err.message || err) + '\n(si falló antes del «COMMIT ✓», la transacción se deshizo y Galca quedó como estaba; si falló en 005→008, re-aplícalas a mano en ese orden)'); process.exit(1); });
