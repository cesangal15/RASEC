/**
 * backfill_lib.js — lo COMÚN de los tres backfills (volcado CSV del Sheet → Postgres, 4.01 · D180):
 * worker/sql/backfill_parte.js (Fase 2), backfill_obra.js (Fase 4) y backfill_asistencias.js (Fase 3),
 * y también worker/pruebas/semillas_sql.js (semillas del arnés de contrato → PGlite).
 *
 * Extraído de backfill_parte.js sin cambiar su comportamiento (mismas cuentas con el mismo volcado):
 *   convertir(tipo, v)             vacío → NULL en date/num/ts, '' en texto; ts de Bogotá → '<ts>-05:00'
 *   leer(dir, archivo) · q(col)    lectura tolerante del CSV · comillas de identificador
 *   cargarTabla(sql, def, dir, op) UNA transacción por tabla; modo anexar (ON CONFLICT DO NOTHING) o
 *                                  reescribir (DELETE por obra + INSERT); dedupe por clave dentro del CSV
 *                                  (se queda la primera); avisos por fila que no se entiende (D106).
 *   cargarFilas(sql, def, filas, op, res)  el tramo de escritura de cargarTabla con filas ya convertidas
 *                                  (semillas_sql.js lo usa con las hojas de backend/pruebas/contrato/semillas.js).
 * Y lo nuevo que necesitan las Fases 3-4:
 *   ftime(v)                       hora cruda → 'HH:MM' (regla de CodigoAsistencias.gs L162-L171) y, además,
 *                                  la forma en que el volcado imprime una celda Date de hora pura
 *                                  (VolcadoCSV.gs celdaCsv_): '1899-12-30 07:00:00' → '07:00', '1899-12-30' → '00:00'
 *   uuid() · idDeFila(f, csv, i)   id cuando la clave viene vacía (regla del README: filas pre-D82); idDeFila es
 *                                  determinista (archivo + línea + contenido) para que relanzar no duplique
 *   filasPorPosicion(...)          hojas sin encabezados útiles (DATA trae los del maestro; CUBICAJE ninguno)
 *   deriveArea(cc)                 Codigo.gs L2211 · baseTipo(elem) L690 · normPlaca(s) L991 · normTexto
 *   TIPOS_TABLA                    tipos por columna de TODAS las tablas del esquema (una sola definición)
 *   abrirPostgres(cadena) · correrCli(...)   lo que comparten los tres CLI
 *
 * Reglas del esquema que respeta (001_esquema.sql, regla 3): `date` viaja como 'yyyy-MM-dd', `numeric`
 * como Number, `timestamptz` como ISO con zona; vacío = NULL en fecha/número, '' en texto.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseCsv, csvObjetos } from './csv.js';

export const OBRA_ID = 'tm2sur';

/* ---------- texto y vocabulario compartido con los .gs (copias literales) ---------- */

// Codigo.gs L~709: normaliza SOLO para comparar (mayúsculas, sin tildes, espacios colapsados).
export function normTexto(s){ return String(s == null ? '' : s).toUpperCase().replace(/[ÁÀÂÄ]/g,'A').replace(/[ÉÈÊË]/g,'E').replace(/[ÍÌÎÏ]/g,'I').replace(/[ÓÒÔÖ]/g,'O').replace(/[ÚÙÛÜ]/g,'U').replace(/Ñ/g,'N').replace(/\s+/g,' ').trim(); }
// Codigo.gs L991: placa a alfanuméricos en MAYÚSCULAS, últimos 6 (la misma regla con la que se cruza CUBICAJE).
export function normPlaca(s){ return String(s == null ? '' : s).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-6); }
// Codigo.gs L2211-L2218: área derivada del CC (06.* → odt, 07.* → odl, resto tierras).
export function deriveArea(cc){
  const c = String(cc == null ? '' : cc).trim();
  if (!c) return 'tierras';
  const sin = c.replace(/^\d{4}\./, '');
  if (sin.indexOf('06.') === 0) return 'odt';
  if (sin.indexOf('07.') === 0) return 'odl';
  return 'tierras';
}
// Codigo.gs L690-L699: tipo de un elemento de la BASE por su texto ('' = fuera de alcance).
export function baseTipo(elem){
  const e = String(elem == null ? '' : elem);
  if (/^\s*tm2\s*pk/i.test(e)) return 'TRAMO';
  if (/diviso/i.test(e))       return 'DIVISO';
  if (/^\s*msr/i.test(e))      return 'MSR';
  if (/^\s*rcd/i.test(e))      return 'RCD';
  if (/zodme/i.test(e))        return 'ZODME';
  if (/^\s*odt/i.test(e))      return 'ODT';
  return '';
}
/* CodigoAsistencias.gs L162-L171 (ftime) aplicada a lo que imprime el volcado. Sheets guarda una hora
 * tecleada como Date del 30/12/1899 y VolcadoCSV.gs la saca como '1899-12-30 HH:mm:ss' (o solo
 * '1899-12-30' cuando la hora es 00:00:00). Texto 'H:MM' → '0H:MM' (D72); 'HH:MM' tal cual; '' → ''. */
export function ftime(v){
  if (v === null || v === undefined || v === '') return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return '00:00';                       // Date de hora pura a medianoche
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return ('0' + m[1]).slice(-2) + ':' + m[2];
  return s.slice(0, 5);
}
export const ES_HORA_DE_SHEETS = /^1899-12-30(\s\d{2}:\d{2}(:\d{2})?)?$/;   // solo estas se convierten en `hora_si_fecha`
export const ES_HASH = /^[0-9a-f]{64}$/;                                     // clave ya endurecida (Codigo.gs L3080)
export function uuid(){ return crypto.randomUUID(); }
/* uuid DETERMINISTA (v4-like, derivado de SHA-256) para filas cuya clave viene vacía (pre-D82): el mismo CSV
 * relanzado produce el mismo id (ON CONFLICT DO NOTHING lo salta) y dos filas iguales en líneas distintas
 * siguen siendo dos (la línea entra en el hash). */
export function uuidDeterminista(texto){
  const h = crypto.createHash('sha256').update(String(texto)).digest('hex');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-' + ((parseInt(h[16], 16) & 3) | 8).toString(16) + h.slice(17, 20) + '-' + h.slice(20, 32);
}
export function idDeFila(f, archivo, i){ return uuidDeterminista(archivo + '|' + (i + 2) + '|' + JSON.stringify(f)); }

/* ---------- conversión por tipo ---------- */
/* tipo: 'ts' (timestamp Bogotá sin zona) · 'date' · 'num' · 'int' · 'hora' (ftime siempre) ·
 * 'hora_si_fecha' (ftime SOLO si la celda era un Date de hora: CONFIG.valor, NORMALIZA_HOJA L757) · texto. */
export function convertir(tipo, v){
  const s = String(v == null ? '' : v).trim();
  if (tipo === 'date' || tipo === 'num' || tipo === 'int' || tipo === 'ts') { if (s === '') return null; }
  if (tipo === 'num') { const n = Number(s.replace(',', '.')); if (!isFinite(n)) throw new Error('número inválido «' + s + '»'); return n; }
  if (tipo === 'int') { const n = Number(s.replace(',', '.')); if (!isFinite(n)) throw new Error('entero inválido «' + s + '»'); return Math.round(n); }
  if (tipo === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('fecha inválida «' + s + '» (se esperaba yyyy-MM-dd, D106)'); return s; }
  if (tipo === 'ts') {
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)) return s.replace(' ', 'T') + '-05:00';   // hora de Bogotá (sin DST)
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T00:00:00-05:00';   // fecha sola (celda Date sin hora): medianoche de Bogotá
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;                                                       // ya trae zona
    throw new Error('timestamp inválido «' + s + '»');
  }
  if (tipo === 'hora') return ftime(s);
  if (tipo === 'hora_si_fecha') return ES_HORA_DE_SHEETS.test(s) ? ftime(s) : s;
  return s;
}
export function leer(dir, archivo){ const p = path.join(dir, archivo); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; }
export function q(col){ return '"' + col + '"'; }

/* ---------- tipos por columna de TODAS las tablas (lo que no está aquí es texto) ---------- */
export const TIPOS_TABLA = {
  // obra
  bandeja:        { timestamp:'ts', fecha:'date', largo:'num', personal_oficiales:'num', personal_ayudantes:'num' },
  data:           { fecha:'date', timestamp:'ts', largo:'num', espesor:'num', fc:'num', cantidad:'num' },
  maquinaria:     { fecha:'date', timestamp:'ts', horas_programadas:'num', horas_operadas:'num', pct_util:'num', horas_muertas:'num', horas_mantenimiento:'num', pct_muerto:'num', horas_facturadas:'num', produccion:'num', meta:'num', pct_ef:'num', rendimiento:'num', unitario:'num', viajes:'num', costo:'num', app_horas_programadas:'num', app_horas_muertas:'num', produccion_capataz_orig:'num' },
  volquetas:      { timestamp:'ts', fecha:'date', viajes:'num', cubicaje:'num', m3_placa:'num' },
  observaciones:  { timestamp:'ts', fecha:'date' },
  maquinas:       { horas_prog:'num', fecha_ingreso:'date', fecha_retiro:'date' },
  usuarios:       {},
  cubicaje:       { cubicaje:'num' },
  base_items:     { orden:'int', orden_hoja:'num' },
  base_elementos: { orden:'int' },
  tablero:        {},
  log:            { fecha_hora:'ts', ms:'int' },
  // parte
  parte_bandeja:     { timestamp:'ts', fecha:'date', inicial:'num', final:'num', total:'num', horas_varada:'num', horas_lluvia:'num', pr:'num', revisado_ts:'ts' },
  parte_equipos:     { ultima_fecha:'date', ultimo_final:'num', ultimo_final_manual:'num' },
  parte_operadores:  { partes_ult_4_meses:'num' },
  parte_cc:          { usos_ult_4_meses:'num' },
  parte_items:       { veces:'num' },
  parte_actividades: { veces:'num' },
  // asistencias
  asistencia:       { timestamp:'ts', fecha:'date', hora_entrada:'hora', hora_salida:'hora' },
  personal:         { fecha_retiro:'date', fecha_ingreso:'date', fila_sheet:'int' },
  extras_admin:     { fecha:'date', horas:'num', timestamp:'ts' },
  notas_asistencia: { fecha:'date', timestamp:'ts' },
  cuadrillas:       {},
  config:           { valor:'hora_si_fecha' },
  festivos:         { fecha:'date' },
  turnos:           { entrada:'hora', salida:'hora', descanso_ini:'hora', descanso_fin:'hora' },
  cat_cc:           { orden:'int' },
  cc_usados:        { orden:'int' },
  cat_motivos:      { orden:'int' },
  motivos_usados:   { orden:'int' },
  cat_trabajadores: {}
};

/* ---------- filas desde el CSV ---------- */

/* Por NOMBRE de encabezado: `cols` son a la vez los encabezados de la hoja y las columnas de la tabla.
 * Devuelve las filas convertidas; las que no se entienden van a `avisos` y no se cargan (D106). */
export function filasPorNombre(texto, cols, tipos, requiere, avisos, archivo, ajustar){
  const objetos = csvObjetos(texto), filas = [];
  objetos.forEach((o, i) => {
    const f = {};
    try { cols.forEach(c => { f[c] = convertir((tipos || {})[c], o[c]); }); if (ajustar) ajustar(f, i); }
    catch (e) { avisos.push('fila ' + (i + 2) + ' de ' + archivo + ': ' + e.message + ' → NO se carga'); return; }
    if ((requiere || []).some(c => f[c] === null || f[c] === '')) { avisos.push('fila ' + (i + 2) + ' de ' + archivo + ': falta ' + requiere.join('/') + ' → NO se carga'); return; }
    filas.push(f);
  });
  return filas;
}
/* Por POSICIÓN: la columna j del CSV → cols[j]. La primera línea del archivo se salta siempre (es el
 * encabezado del maestro en DATA, o la línea vacía ',' en CUBICAJE). Filas más cortas se rellenan con ''. */
export function filasPorPosicion(texto, cols, tipos, requiere, avisos, archivo, ajustar){
  const { filas: crudas } = parseCsv(texto), filas = [];
  crudas.forEach((r, i) => {
    const f = {};
    try { cols.forEach((c, j) => { f[c] = convertir((tipos || {})[c], r[j] === undefined ? '' : r[j]); }); if (ajustar) ajustar(f, i); }
    catch (e) { avisos.push('fila ' + (i + 2) + ' de ' + archivo + ': ' + e.message + ' → NO se carga'); return; }
    if ((requiere || []).some(c => f[c] === null || f[c] === '')) { avisos.push('fila ' + (i + 2) + ' de ' + archivo + ': falta ' + requiere.join('/') + ' → NO se carga'); return; }
    filas.push(f);
  });
  return filas;
}

/* ---------- la hoja BASE (dos tablas en una) ---------- */

/* Tabla de ÍTEMS A–H: misma detección que getBaseData (Codigo.gs L725-L744): la fila de encabezados es la
 * primera (entre las 5 primeras) con CC y DESCRIPCION en A–H; los ítems empiezan en la siguiente.
 * Devuelve {cc, descripcion, unidad, orden, capitulo, grupo, uf, proyecto, orden_hoja} (las cinco últimas
 * son las columnas B/C/G/H/E que 002 añade; backfill_parte.js solo escribe las cuatro primeras). */
export function filasBaseItems(texto){
  const { encabezados, filas } = parseCsv(texto);
  const v = [encabezados].concat(filas);
  let ccCol = -1, dCol = -1, uCol = -1, hRow = -1, capCol = -1, grCol = -1, ufCol = -1, prCol = -1, orCol = -1;
  for (let r = 0; r < Math.min(5, v.length) && hRow < 0; r++) {
    let c1 = -1, c2 = -1, c3 = -1, c4 = -1, c5 = -1, c6 = -1, c7 = -1, c8 = -1;
    for (let j = 0; j < Math.min(8, v[r].length); j++) {
      const k = normTexto(v[r][j]);
      if (c1 < 0 && (k === 'CC' || k.indexOf('CENTRO') >= 0 || k.indexOf('COSTO') >= 0 || k.indexOf('COSTE') >= 0)) c1 = j;
      else if (c2 < 0 && k.indexOf('DESCRIPCION') >= 0) c2 = j;
      else if (c3 < 0 && (k === 'UND' || k === 'UM' || (k.indexOf('UNIDAD') >= 0 && k.indexOf('FUNCIONAL') < 0))) c3 = j;
      else if (c4 < 0 && k.indexOf('CAPITULO') >= 0) c4 = j;
      else if (c5 < 0 && k === 'GRUPO') c5 = j;
      else if (c6 < 0 && k === 'UF') c6 = j;
      else if (c7 < 0 && k === 'PROYECTO') c7 = j;
      else if (c8 < 0 && k === 'ORDEN') c8 = j;
    }
    if (c1 >= 0 && c2 >= 0) { ccCol = c1; dCol = c2; uCol = c3; capCol = c4; grCol = c5; ufCol = c6; prCol = c7; orCol = c8; hRow = r; }
  }
  const out = [];
  if (ccCol < 0) return out;
  const celda = (fila, j) => (j >= 0 && fila[j] != null ? String(fila[j]).trim() : '');
  for (let i = hRow + 1; i < v.length; i++) {
    const cc = String(v[i][ccCol] == null ? '' : v[i][ccCol]).trim(), d = v[i][dCol];
    if (!cc || d === '' || d == null) continue;
    const oh = celda(v[i], orCol), n = Number(oh);
    out.push({ cc, descripcion: String(d), unidad: celda(v[i], uCol), orden: i,
      capitulo: celda(v[i], capCol), grupo: celda(v[i], grCol), uf: celda(v[i], ufCol), proyecto: celda(v[i], prCol),
      orden_hoja: oh !== '' && isFinite(n) ? n : null });
  }
  return out;
}
/* Tabla de ELEMENTOS J/K/L/M (índices 9/10/11/12, sin depender de encabezados, como getBaseData L746):
 * elemento, abs_inicio/abs_fin CRUDOS (text, D68), uf, tipo = baseTipo(elemento) ('' = fuera de alcance,
 * lo descarta el Worker al leer), orden = nº de fila (PK desde 002). Se salta la fila de encabezados. */
export function filasBaseElementos(texto){
  const { encabezados, filas } = parseCsv(texto);
  const v = [encabezados].concat(filas), out = [];
  for (let i = 1; i < v.length; i++) {
    const elem = v[i][9];
    if (elem === '' || elem == null) continue;
    if (normTexto(elem) === 'ELEMENTO') continue;
    out.push({ elemento: String(elem), abs_inicio: String(v[i][10] == null ? '' : v[i][10]).trim(), abs_fin: String(v[i][11] == null ? '' : v[i][11]).trim(),
      uf: String(v[i][12] == null ? '' : v[i][12]).trim(), tipo: baseTipo(elem), orden: i });
  }
  return out;
}

/* ---------- carga de una tabla ---------- */
/* def = { tabla, csv, cols, clave, modo, requiere, tipos?, posicion?, filas?(texto, res), ajustar?(f, i),
 *         fijos?: {col: valor}, conflicto?: 'nothing' | 'update' | null, preexistentes?: [cols] }
 *   modo      'anexar' (INSERT … ON CONFLICT (obra_id, clave) DO NOTHING) | 'reescribir' (DELETE por obra + INSERT)
 *             | 'reescribir_si_vacia' (reescribir si la tabla no tiene filas de la obra; si las tiene, anexar)
 *   clave     columnas de la PK: dedupe dentro del CSV (se queda la PRIMERA) y objetivo del ON CONFLICT.
 *             null = sin dedupe ni ON CONFLICT (tablas con PK surrogate: volquetas, personal, log).
 *             [] = la PK es solo obra_id (tablero): sin dedupe; con conflicto 'update' pisa la fila de la obra.
 *   preexistentes  columnas por las que se saltan filas que YA estén en la BD (para relanzar un anexar
 *             sin clave natural): se lee el conjunto ANTES de insertar, así los duplicados legítimos
 *             dentro del propio CSV entran los dos la primera vez y ninguno la segunda.
 *   conflicto 'update' = ON CONFLICT … DO UPDATE de todas las columnas (tablero, usuarios de semillas).
 * Devuelve {tabla, archivo, leidas, insertadas, saltadas, borradas, avisos}. `sql` = postgres.js o PGlite. */
export async function cargarTabla(sql, def, dir, op){
  const nombre = def.tabla, res = { tabla: nombre, archivo: def.csv, leidas: 0, insertadas: 0, saltadas: 0, borradas: 0, avisos: [] };
  const texto = leer(dir, def.csv);
  if (texto === null) { res.avisos.push('no está ' + def.csv + ': se omite'); return res; }
  const tipos = def.tipos || TIPOS_TABLA[nombre] || {};
  let filas;
  if (def.filas) filas = def.filas(texto, res);
  else if (def.posicion) filas = filasPorPosicion(texto, def.cols, tipos, def.requiere, res.avisos, def.csv, def.ajustar);
  else filas = filasPorNombre(texto, def.cols, tipos, def.requiere, res.avisos, def.csv, def.ajustar);
  return cargarFilas(sql, def, filas, op, res);
}
/* El tramo de escritura de cargarTabla, con las filas ya convertidas (también lo usa semillas_sql.js).
 * Dedupe por clave dentro del lote (se queda la primera) y UNA transacción por tabla. */
export async function cargarFilas(sql, def, filas, op, res){
  const nombre = def.tabla, clave = def.clave === undefined ? null : def.clave;
  res = res || { tabla: nombre, archivo: def.csv || '', leidas: 0, insertadas: 0, saltadas: 0, borradas: 0, avisos: [] };
  const cols = def.cols.concat(Object.keys(def.fijos || {}));
  if (def.fijos) filas.forEach(f => { Object.assign(f, def.fijos); });
  res.leidas = filas.length;
  // duplicados por clave dentro del propio CSV: se queda la PRIMERA (la hoja tolera repetidos; la PK no)
  let unicas = filas;
  if (clave && clave.length) {
    const vistos = new Set(); unicas = [];
    filas.forEach(f => { const k = clave.map(c => String(f[c])).join('|'); if (vistos.has(k)) { res.saltadas++; res.avisos.push('duplicado en el CSV (' + k + '): se queda la primera'); return; } vistos.add(k); unicas.push(f); });
  }
  if (op && op.simular) { res.insertadas = unicas.length; return res; }
  let modo = def.modo || 'reescribir';
  const colsSql = ['obra_id'].concat(cols).map(q).join(', ');
  await sql.begin(async (tx) => {
    if (modo === 'reescribir_si_vacia') {
      const n = await tx.unsafe('SELECT count(*)::int AS n FROM ' + q(nombre) + ' WHERE obra_id = $1', [OBRA_ID]);
      modo = n[0].n ? 'anexar' : 'reescribir';
      if (modo === 'anexar') res.avisos.push('la tabla ya tenía ' + n[0].n + ' fila(s) de la obra: se ANEXA en vez de reescribir');
    }
    if (modo === 'reescribir') {
      const b = await tx.unsafe('DELETE FROM ' + q(nombre) + ' WHERE obra_id = $1 RETURNING 1', [OBRA_ID]);
      res.borradas = b.length;
    }
    let yaEstan = null;
    if (def.preexistentes && modo === 'anexar') {
      const pre = await tx.unsafe('SELECT ' + def.preexistentes.map(q).join(', ') + ' FROM ' + q(nombre) + ' WHERE obra_id = $1', [OBRA_ID]);
      yaEstan = new Set(pre.map(r => def.preexistentes.map(c => String(r[c] == null ? '' : r[c])).join('|')));
    }
    let conflicto = '';
    const objetivo = ' ON CONFLICT (' + ['obra_id'].concat(clave || []).map(q).join(', ') + ')';
    if (Array.isArray(clave) && def.conflicto === 'update') conflicto = objetivo + ' DO UPDATE SET ' + cols.map(c => q(c) + ' = EXCLUDED.' + q(c)).join(', ');
    else if (clave && clave.length && def.conflicto !== null) conflicto = objetivo + ' DO NOTHING';
    for (const f of unicas) {
      if (yaEstan && yaEstan.has(def.preexistentes.map(c => String(f[c] == null ? '' : f[c])).join('|'))) { res.saltadas++; continue; }
      const vals = [OBRA_ID].concat(cols.map(c => f[c]));
      const marcas = vals.map((_, i) => '$' + (i + 1)).join(', ');
      const r = await tx.unsafe('INSERT INTO ' + q(nombre) + ' (' + colsSql + ') VALUES (' + marcas + ')' + conflicto + ' RETURNING 1', vals);
      if (r.length) res.insertadas++; else res.saltadas++;
    }
  });
  return res;
}

/* Recorre las definiciones en orden respetando --solo. `soloExplicito` = tablas que solo entran si se
 * nombran en --solo (p. ej. log). */
export async function cargarTablas(sql, defs, dir, opciones, soloExplicito){
  const op = opciones || {};
  const solo = op.solo ? String(op.solo).split(',').map(s => s.trim()).filter(Boolean) : null;
  const out = [];
  for (const def of defs) {
    if (solo && solo.indexOf(def.tabla) < 0) continue;
    if (!solo && (soloExplicito || []).indexOf(def.tabla) >= 0) continue;
    out.push(await cargarTabla(sql, def, dir, op));
  }
  return out;
}

/* ---------- CLI compartido ---------- */

export function leerArgs(argv){
  const args = {}; (argv || process.argv.slice(2)).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });
  return args;
}
// Mismos tipos que src/db.js: date como texto, numeric como Number.
export async function abrirPostgres(cadena){
  const { default: postgres } = await import('postgres');
  return postgres(cadena, { max: 1, prepare: false, onnotice: () => {},
    types: { date: { to: 1082, from: [1082], serialize: v => v, parse: v => v }, numeric: { to: 1700, from: [1700], serialize: v => String(v), parse: v => Number(v) } } });
}
export function imprimirResultados(res){
  res.forEach(r => {
    console.log('  ' + r.tabla.padEnd(18) + ' ← ' + r.archivo.padEnd(22) + ' leídas ' + String(r.leidas).padStart(5) + ' · insertadas ' + String(r.insertadas).padStart(5) + ' · saltadas ' + String(r.saltadas).padStart(4) + (r.borradas ? ' · borradas antes ' + r.borradas : ''));
    r.avisos.slice(0, 20).forEach(a => console.log('      ! ' + a));
    if (r.avisos.length > 20) console.log('      ! … y ' + (r.avisos.length - 20) + ' avisos más');
  });
}
/* main() de los tres backfills: --volcado, --solo, --simular, DATABASE_URL o --conexion-archivo.
 * `fn(sql, dir, {solo, simular})` devuelve la lista de resultados. */
export async function correrCli(titulo, ejemploVolcado, fn){
  const args = leerArgs();
  const dir = args.volcado ? path.resolve(String(args.volcado)) : '';
  if (!dir || !fs.existsSync(dir)) { console.error('Falta --volcado=<carpeta con los CSV del volcado> (p. ej. ' + ejemploVolcado + ')'); process.exit(2); }
  let cadena = process.env.DATABASE_URL || '';
  if (!cadena && args['conexion-archivo']) cadena = fs.readFileSync(String(args['conexion-archivo']), 'utf8').split(/\r?\n/)[0].trim();
  if (!cadena && !args.simular) { console.error('Falta la conexión: $env:DATABASE_URL = "postgres://…" (o --conexion-archivo=<ruta fuera del repo>). Con --simular no hace falta.'); process.exit(2); }
  const sql = args.simular ? null : await abrirPostgres(cadena);
  console.log(titulo + ' · volcado=' + dir + (args.simular ? ' · SIMULACIÓN (no escribe)' : '') + (args.solo ? ' · solo=' + args.solo : ''));
  try { imprimirResultados(await fn(sql, dir, { solo: args.solo, simular: !!args.simular })); }
  finally { if (sql) await sql.end({ timeout: 5 }); }
}
