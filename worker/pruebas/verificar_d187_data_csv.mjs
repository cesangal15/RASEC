#!/usr/bin/env node
/**
 * verificar_d187_data_csv.mjs — D187: la DATA de Galca (y la Proyección) en CSV para el Excel maestro por Power Query
 * «Desde la Web», con CLAVE DE LECTURA. Directo contra Postgres EN MEMORIA (PGlite) y el Worker REAL (src/index.js →
 * manejar). Sin red.
 *
 *   node worker/pruebas/verificar_d187_data_csv.mjs
 *
 * Qué se comprueba:
 *   1. 001…0NN en orden + la DATA real del sandbox (tools/sandbox/data.real.csv; carga + 005 + 007, como el sandbox) +
 *      filas TRAMPA: observaciones con comas, comillas, saltos de línea (LF y CRLF), texto con «;», números decimales
 *      pequeños/grandes (0.1, 1e-7, 12345678.5), celdas vacías (NULL) y una fecha antigua.
 *   2. La puerta: sin clave → 401 texto plano; clave mala → 401; clave con un carácter de más → 401; sin secreto → 503
 *      «falta configurar CLAVE_LECTURA_EXCEL»; sin token NO sale el 401 JSON del filtro de token; tabla inválida → 400;
 *      BACKEND_OBRA=sheets → 503; 10 claves malas por IP → 429 (otra IP sigue entrando).
 *   3. data_csv con la clave buena: 200, text/csv; charset=utf-8, BOM, CRLF, cabecera = las 17 columnas EXACTAS (y en
 *      el mismo orden que information_schema da para data_maestro); se PARSEA con un parser RFC 4180 propio y se
 *      compara fila a fila, celda a celda con SELECT … FROM data_maestro (mismo número de filas, mismos valores, mismo
 *      orden FECHA + estable). Números con punto y sin miles ni exponente; FECHA 'YYYY-MM-DD'; NULL = vacía.
 *   4. proyeccion_csv de las 4 tablas: cabecera = columnas de la vista (sin obra_id) y valores = SELECT de la vista.
 *   5. /prueba/obra: CLAVE_LECTURA_EXCEL_PRUEBA propia (la de producción no entra) y respaldo a la de producción.
 *   6. Caché de 60 s: MISS → HIT idéntico; la llave de caché no lleva la clave; una clave mala con la caché llena → 401;
 *      ROTAR el secreto → la clave vieja 401 aunque la respuesta siga en caché; un POST enviar_data borra las llaves.
 *   7. Sin LOG de data_csv / proyeccion_csv.
 * Sale con código 1 si algo falla.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPglite } from './pglite.js';
import { manejar } from '../src/index.js';
import { emitirToken_ } from '../src/comun.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, '..', '..');
const SQL_DIR = path.join(REPO, 'worker', 'sql');
const CSV_DATA = path.join(REPO, 'tools', 'sandbox', 'data.real.csv');
const SECRETO = 'secreto-verificar-d187-xxxxxxxxxxxxxxxx';
const CLAVE = 'Kx7_q2-clave-d187-lectura', CLAVE_PRUEBA = 'otra-clave-d187-prueba';
const COLS17 = ['FECHA', 'GRUPO', 'CENTRO DE COSTO', 'CAPITULO', 'DESCRIPCION', 'UNIDAD FUNCIONAL', 'ELEMENTO', 'ABS INICIAL', 'ABS FINAL',
  'ACTA', 'UNIDAD MEDIDA', 'LARGO', 'ESPESOR', 'FC', 'CANTIDAD', 'CLIMA', 'OBSERVACION'];
const NUMERICAS = ['LARGO', 'ESPESOR', 'FC', 'CANTIDAD'];

let casos = 0, fallos = 0;
function ok(n, c, x){ casos++; if (c) console.log('  ✓ ' + n); else { fallos++; console.log('  ✗ ' + n + (x !== undefined ? '  → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 600) : '')); } }
const titulo = (s) => console.log('\n' + s);

/* ---------- parser RFC 4180 PROPIO de la prueba (no es el del Worker ni el del sandbox) ----------
 * Máquina de estados carácter a carácter: comillas dobles con "" como escape, CRLF/LF/CR como fin de registro fuera de
 * comillas y saltos de línea LITERALES dentro de comillas. Devuelve { filas: string[][], errores: [] }. */
function parseRfc4180(txt){
  const filas = [], errores = [];
  let fila = [], celda = '', i = 0, enComillas = false, recienCerrada = false;
  const n = txt.length;
  const finCelda = () => { fila.push(celda); celda = ''; recienCerrada = false; };
  const finFila = () => { finCelda(); filas.push(fila); fila = []; };
  while (i < n){
    const ch = txt[i];
    if (enComillas){
      if (ch === '"'){ if (txt[i + 1] === '"'){ celda += '"'; i += 2; continue; } enComillas = false; recienCerrada = true; i++; continue; }
      celda += ch; i++; continue;
    }
    if (ch === '"'){
      if (celda !== '' || recienCerrada) errores.push('comilla suelta en fila ' + (filas.length + 1));
      enComillas = true; i++; continue;
    }
    if (ch === ','){ finCelda(); i++; continue; }
    if (ch === '\r' || ch === '\n'){ finFila(); i += (ch === '\r' && txt[i + 1] === '\n') ? 2 : 1; continue; }
    if (recienCerrada) errores.push('texto tras comilla de cierre en fila ' + (filas.length + 1));
    celda += ch; i++;
  }
  if (enComillas) errores.push('comillas sin cerrar al final');
  if (celda !== '' || fila.length) finFila();
  return { filas, errores };
}

/* ---------- carga de la DATA real (la MISMA que tools/sandbox/servidor.mjs) ---------- */
function parseCsvSandbox(txt){
  const lineas = txt.replace(/\r/g, '').split('\n').filter(l => l.length);
  const cab = lineas.shift().split(',');
  return lineas.map(l => { const c = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++){ const ch = l[i];
      if (ch === '"'){ if (q && l[i + 1] === '"'){ cur += '"'; i++; } else q = !q; }
      else if (ch === ',' && !q){ c.push(cur); cur = ''; } else cur += ch; }
    c.push(cur); const o = {}; cab.forEach((k, i) => { o[k.trim()] = (c[i] || '').trim(); }); return o; });
}
const numCsv = (v) => (v === undefined || v === null || String(v).trim() === '') ? null : Number(String(v).replace(',', '.'));
async function cargarDataCsv(sql){
  let n = 0;
  for (const f of parseCsvSandbox(fs.readFileSync(CSV_DATA, 'utf8'))){
    if (!(f.fecha || '').trim() || !(f.id_registro || '').trim()) continue;
    await sql`INSERT INTO data (obra_id, fecha, orden, grupo, centro_de_costo, capitulo, descripcion, unidad_funcional,
        proyecto, elemento, abs_inicial, abs_final, liberacion, acta, unidad_medida, largo, espesor, fc, cantidad,
        observacion, id_registro, "timestamp", capataz, rol, actividad, pk_inicial, pk_final, area, clima)
      VALUES ('tm2sur', ${f.fecha}, ${f.orden || ''}, ${f.grupo || ''}, ${f.centro_de_costo || ''}, ${f.capitulo || ''}, ${f.descripcion || ''},
        ${f.unidad_funcional || ''}, ${f.proyecto || ''}, ${f.elemento || ''}, ${f.abs_inicial || ''}, ${f.abs_final || ''}, ${f.liberacion || ''},
        ${f.acta || ''}, ${f.unidad_medida || ''}, ${numCsv(f.largo)}, ${numCsv(f.espesor)}, ${numCsv(f.fc)}, ${numCsv(f.cantidad)},
        ${f.observacion || ''}, ${f.id_registro}, now(), '', '', ${f.descripcion || ''}, ${f.abs_inicial || ''}, ${f.abs_final || ''}, '', '')
      ON CONFLICT (obra_id, id_registro) DO NOTHING`;
    n++;
  }
  return n;
}
// Filas TRAMPA (después de 005/007, para que lleguen tal cual a data_maestro).
const TRAMPAS = [
  { id: 'd187-comas',   fecha: '2026-09-18', obs: 'Descapote, cargue y retiro, 3 viajes', largo: 0.1, esp: 1e-7, fc: 1.3, cant: 12345678.5, clima: 'SOL, NUBES', acta: '26' },
  { id: 'd187-comilla', fecha: '2026-09-18', obs: 'Dijo "listo" y ""otra"" vez', largo: 12.25, esp: 0.3, fc: 1.25, cant: 2.94, clima: '', acta: 'B07' },
  { id: 'd187-lf',      fecha: '2026-09-18', obs: 'línea 1\nlínea 2\n\nlínea 4', largo: 100, esp: null, fc: null, cant: null, clima: 'LLUVIA', acta: '' },
  { id: 'd187-crlf',    fecha: '2026-09-19', obs: 'con CRLF\r\ny, "todo" junto\r\n', largo: 1234567.891, esp: 1, fc: 1, cant: 1234567.891, clima: '', acta: '26' },
  { id: 'd187-punto',   fecha: '2026-09-19', obs: 'punto; y coma; sin comillas', largo: null, esp: null, fc: null, cant: 0.000123, clima: '', acta: '26' },
  { id: 'd187-antigua', fecha: '2020-07-06', obs: '', largo: null, esp: null, fc: null, cant: null, clima: '', acta: '' }
];
async function sembrarTrampas(sql){
  let k = 0;
  for (const t of TRAMPAS){
    k++;
    await sql`INSERT INTO data (obra_id, fecha, grupo, centro_de_costo, capitulo, descripcion, unidad_funcional, elemento, abs_inicial, abs_final,
        acta, unidad_medida, largo, espesor, fc, cantidad, observacion, id_registro, "timestamp", clima)
      VALUES ('tm2sur', ${t.fecha}, 'TIERRAS', '3701.02.05', 'EXPLANACIONES, "A"', 'Excavaciones en material común APROVECHABLE', 'UF1',
        ${'tm2 pk 1+00' + k + ' - 1+100'}, '1000', '1100', ${t.acta}, 'm3', ${t.largo}, ${t.esp}, ${t.fc}, ${t.cant}, ${t.obs}, ${t.id},
        ${new Date(Date.UTC(2026, 8, 18, 12, k))}, ${t.clima})`;
  }
}

/* ---------- el Worker de verdad (manejar) con una Cache API de mentira ---------- */
function cacheFalsa(){
  const m = new Map();
  return { _m: m,
    async match(req){ const e = m.get(req.url); return e ? new Response(e.body, { headers: e.headers }) : undefined; },
    async put(req, resp){ const cc = resp.headers.get('Cache-Control') || '';
      if (/no-store|private/i.test(cc)) throw new Error('Cache API: respuesta no cacheable (' + cc + ')');
      m.set(req.url, { body: await resp.arrayBuffer(), headers: Object.fromEntries(resp.headers) }); },   // bytes, como la Cache API (text() quitaría el BOM)
    async delete(req){ return m.delete(req.url); } };
}
let ipN = 0;
function worker(sql, extra){
  const env = Object.assign({ ALLOWED_ORIGINS: 'https://tm2.galca.app', BACKEND_OBRA: 'db', BACKEND_OBRA_PRUEBA: 'db', BACKEND_ASISTENCIAS: 'db', BACKEND_PARTE: 'db',
    AUTH_SECRETO: SECRETO, AUTH_V: '1', RATE_LIMIT_POR_MIN: '100000', CLAVE_LECTURA_EXCEL: CLAVE, __dbPrueba: () => sql }, extra || {});
  async function pedir(metodo, ruta, params, body, ip){
    const u = new URL('http://127.0.0.1:8799' + ruta); Object.keys(params || {}).forEach(k => u.searchParams.set(k, params[k]));
    const pend = [], ctx = { waitUntil: (p) => pend.push(Promise.resolve(p).catch(() => {})) };
    const init = { method: metodo, headers: { 'Content-Type': 'text/plain;charset=utf-8', 'CF-Connecting-IP': ip || ('10.0.0.' + (++ipN % 250)) } };
    if (metodo === 'POST'){ init.body = JSON.stringify(body); init.headers['Content-Length'] = String(Buffer.byteLength(init.body)); }
    const r = await manejar(new Request(u.toString(), init), env, ctx);
    const buf = Buffer.from(await r.arrayBuffer()); await Promise.all(pend);
    return { status: r.status, ct: r.headers.get('Content-Type') || '', xc: r.headers.get('X-Csv-Cache'), buf, texto: buf.toString('utf8') };
  }
  return { env, get: (ruta, p, ip) => pedir('GET', ruta, p, null, ip), post: (ruta, b) => pedir('POST', ruta, null, b) };
}

// Valor de la BD → lo que DEBE traer la celda (independiente de csvCelda: aquí solo se decide el texto esperado).
function esperado(v){
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;                 // se compara como número (y además se mira el formato)
  return String(v);
}
function igualCelda(celda, v){
  const e = esperado(v);
  if (typeof e === 'number') return /^-?\d+(\.\d+)?$/.test(celda) && Number(celda) === e;
  return celda === e;
}
function comparar(nombre, csv, filasBd, columnas){
  const { filas, errores } = parseRfc4180(csv.replace(/^﻿/, ''));
  ok(nombre + ': el CSV se parsea sin errores RFC 4180', errores.length === 0, errores.slice(0, 3));
  const cab = filas.shift() || [];
  ok(nombre + ': cabecera EXACTA (' + columnas.length + ' columnas: ' + columnas.join(' | ') + ')', JSON.stringify(cab) === JSON.stringify(columnas), cab);
  ok(nombre + ': mismo número de filas que el SELECT (' + filasBd.length + ')', filas.length === filasBd.length, [filas.length, filasBd.length]);
  ok(nombre + ': todas las filas con ' + columnas.length + ' celdas', filas.every(f => f.length === columnas.length), filas.find(f => f.length !== columnas.length));
  let malas = [];
  for (let i = 0; i < Math.min(filas.length, filasBd.length); i++){
    for (let j = 0; j < columnas.length; j++){
      if (!igualCelda(filas[i][j], filasBd[i][columnas[j]])) { malas.push({ fila: i + 1, col: columnas[j], csv: filas[i][j], bd: filasBd[i][columnas[j]] }); if (malas.length > 4) break; }
    }
    if (malas.length > 4) break;
  }
  ok(nombre + ': fila a fila y celda a celda = SELECT (mismo orden, mismos valores)', malas.length === 0, malas);
  return filas;
}

async function main(){
  const { sql } = await abrirPglite();
  const q = (t, p) => sql.unsafe(t, p);
  const aplicar = (f) => sql.exec(fs.readFileSync(path.join(SQL_DIR, f), 'utf8'));

  /* 1 · esquema + DATA */
  titulo('1 · Esquema + DATA real del sandbox + filas trampa');
  const migraciones = fs.readdirSync(SQL_DIR).filter(f => /^0\d+_.*\.sql$/.test(f)).sort();
  for (const f of migraciones) await aplicar(f);
  const nCsv = await cargarDataCsv(sql);
  for (const f of ['005_data_clima.sql', '007_data_completa.sql']) await aplicar(f);
  await sembrarTrampas(sql);
  const nBd = (await q(`SELECT count(*)::int AS n FROM data_maestro WHERE obra_id = 'tm2sur'`))[0].n;
  ok('migraciones ' + migraciones.join(', ') + ' · ' + nCsv + ' filas del CSV + ' + TRAMPAS.length + ' trampas = ' + nBd + ' en data_maestro', nBd === nCsv + TRAMPAS.length, [nCsv, nBd]);

  const W = worker(sql);

  /* 2 · la puerta */
  titulo('2 · La puerta: clave de lectura (texto plano, antes del filtro de token)');
  const s0 = await W.get('/obra', { action: 'data_csv' });
  ok('sin clave → 401 text/plain corto (no el JSON {auth:false} del filtro de token)', s0.status === 401 && /^text\/plain/.test(s0.ct) && !/^\s*\{/.test(s0.texto) && s0.texto.length < 200, [s0.status, s0.ct, s0.texto]);
  const s1 = await W.get('/obra', { action: 'data_csv', clave: 'no-es-la-clave' });
  ok('clave mala → 401 «clave de lectura incorrecta»', s1.status === 401 && /^text\/plain/.test(s1.ct) && /incorrecta/.test(s1.texto), [s1.status, s1.texto]);
  const s2 = await W.get('/obra', { action: 'data_csv', clave: CLAVE + 'x' });
  const s2b = await W.get('/obra', { action: 'data_csv', clave: CLAVE.slice(0, -1) });
  ok('clave con un carácter de más / de menos → 401', s2.status === 401 && s2b.status === 401, [s2.status, s2b.status]);
  const s3 = await W.get('/obra', { action: 'data_csv', clave: '' });
  ok('clave vacía (clave=) → 401', s3.status === 401, s3.status);
  const s4 = await W.get('/obra', { action: 'data_csv', clave: CLAVE, token: 'lo-que-sea' });
  ok('un token (válido o no) no cambia nada: con la clave buena, 200', s4.status === 200, s4.status);
  const Wsin = worker(sql, { CLAVE_LECTURA_EXCEL: '' });
  const s5 = await Wsin.get('/obra', { action: 'data_csv', clave: CLAVE });
  const s5p = await Wsin.get('/obra', { action: 'proyeccion_csv', tabla: 'plan', clave: CLAVE });
  ok('SIN secreto → 503 «falta configurar CLAVE_LECTURA_EXCEL» (data y proyección)', s5.status === 503 && /falta configurar CLAVE_LECTURA_EXCEL/.test(s5.texto) && s5p.status === 503 && /^text\/plain/.test(s5.ct), [s5.status, s5.texto]);
  const s6 = await W.get('/obra', { action: 'proyeccion_csv', tabla: 'otra', clave: CLAVE });
  const s6b = await W.get('/obra', { action: 'proyeccion_csv', clave: CLAVE });
  ok('proyeccion_csv con tabla inválida / sin tabla → 400 texto (D166, antes de la BD)', s6.status === 400 && s6b.status === 400 && /tabla/.test(s6.texto) && /tabla/.test(s6b.texto), [s6.texto, s6b.texto]);
  const s6c = await W.get('/obra', { action: 'data_csv', clave: 'x'.repeat(201) });
  ok('clave de más de 200 caracteres → 401 (nunca coincide) sin tocar la BD', s6c.status === 401, s6c.status);
  const s7 = await worker(sql, { BACKEND_OBRA: 'sheets' }).get('/obra', { action: 'data_csv', clave: CLAVE });
  ok('BACKEND_OBRA=sheets → 503 texto (la DATA vive en Postgres)', s7.status === 503 && /base de datos/.test(s7.texto), [s7.status, s7.texto]);
  const IP = '203.0.113.9'; let ult = null;
  for (let i = 0; i < 10; i++) ult = await W.get('/obra', { action: 'data_csv', clave: 'mala-' + i }, IP);
  const bloq = await W.get('/obra', { action: 'data_csv', clave: CLAVE }, IP);
  const otra = await W.get('/obra', { action: 'data_csv', clave: CLAVE }, '203.0.113.10');
  ok('10 claves malas desde una IP → la 11.ª (aunque sea buena) 429 texto con Retry-After; otra IP sigue entrando', ult.status === 401 && bloq.status === 429 && /intentos/.test(bloq.texto) && otra.status === 200, [ult.status, bloq.status, otra.status]);

  /* 3 · data_csv */
  titulo('3 · data_csv con la clave buena = SELECT de data_maestro');
  const d = await W.get('/obra', { action: 'data_csv', clave: CLAVE });
  ok('200, Content-Type text/csv; charset=utf-8, X-Csv-Cache SIN (sin Cache API)', d.status === 200 && d.ct === 'text/csv; charset=utf-8' && d.xc === 'SIN', [d.status, d.ct, d.xc]);
  ok('empieza con el BOM UTF-8 (EF BB BF)', d.buf[0] === 0xEF && d.buf[1] === 0xBB && d.buf[2] === 0xBF, [...d.buf.slice(0, 4)]);
  const primera = d.texto.replace(/^﻿/, '').split('\r\n')[0];
  ok('primera línea = las 17 cabeceras separadas por coma, terminada en CRLF', primera === COLS17.join(','), primera);
  ok('termina en CRLF', d.texto.endsWith('\r\n'));
  const vistaCols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'data_maestro' ORDER BY ordinal_position`)).map(r => r.column_name);
  ok('las 17 = las columnas de data_maestro tras obra_id y antes de las internas, en su orden', JSON.stringify(vistaCols.slice(1, 18)) === JSON.stringify(COLS17), vistaCols);
  const bd = await q(`SELECT * FROM data_maestro WHERE obra_id = 'tm2sur' ORDER BY "FECHA", "timestamp" NULLS LAST, id_registro`);
  const filas = comparar('data_csv', d.texto, bd, COLS17);
  const col = (k) => COLS17.indexOf(k);
  ok('FECHA siempre YYYY-MM-DD y en orden no decreciente', filas.every((f, i) => /^\d{4}-\d{2}-\d{2}$/.test(f[0]) && (i === 0 || filas[i - 1][0] <= f[0])), filas.find(f => !/^\d{4}-\d{2}-\d{2}$/.test(f[0])));
  const numMal = [];
  for (const f of filas) for (const k of NUMERICAS){ const c = f[col(k)]; if (c !== '' && !/^-?\d+(\.\d+)?$/.test(c)) numMal.push(k + '=' + c); }
  ok('LARGO/ESPESOR/FC/CANTIDAD: vacías o con PUNTO decimal, sin miles ni exponente', numMal.length === 0, numMal.slice(0, 5));
  const porObs = (id) => { const i = bd.findIndex(r => r.id_registro === id); return i >= 0 ? filas[i] : null; };
  const tc = porObs('d187-comas'), tq = porObs('d187-comilla'), tl = porObs('d187-lf'), tr = porObs('d187-crlf'), tp = porObs('d187-punto');
  ok('trampa comas: OBSERVACION, CLIMA y CAPITULO con comas intactos', !!tc && tc[col('OBSERVACION')] === TRAMPAS[0].obs && tc[col('CLIMA')] === 'SOL, NUBES' && tc[col('CAPITULO')] === 'EXPLANACIONES, "A"', tc);
  ok('trampa números: 0.1 · 0.0000001 (no 1e-7) · 12345678.5 (sin miles)', !!tc && tc[col('LARGO')] === '0.1' && tc[col('ESPESOR')] === '0.0000001' && tc[col('CANTIDAD')] === '12345678.5', tc && [tc[col('LARGO')], tc[col('ESPESOR')], tc[col('CANTIDAD')]]);
  ok('trampa comillas: «Dijo "listo" y ""otra"" vez» vuelve exacta; ACTA B07 como texto', !!tq && tq[col('OBSERVACION')] === TRAMPAS[1].obs && tq[col('ACTA')] === 'B07', tq);
  ok('trampa saltos LF: 4 líneas (una vacía) dentro de la celda; LARGO 100 y ESPESOR/FC/CANTIDAD vacías', !!tl && tl[col('OBSERVACION')] === TRAMPAS[2].obs && tl[col('LARGO')] === '100' && tl[col('ESPESOR')] === '' && tl[col('CANTIDAD')] === '', tl);
  ok('trampa CRLF + coma + comillas en la misma celda; 1234567.891', !!tr && tr[col('OBSERVACION')] === TRAMPAS[3].obs && tr[col('CANTIDAD')] === '1234567.891', tr);
  ok('trampa «;»: sin comillas (solo se entrecomilla con coma/comilla/CR/LF) y 0.000123', !!tp && tp[col('CANTIDAD')] === '0.000123' && d.texto.indexOf(',punto; y coma; sin comillas') >= 0, tp);
  ok('la celda con salto de línea va ENTRE COMILLAS en el texto crudo', d.texto.indexOf('"línea 1\nlínea 2\n\nlínea 4"') >= 0);

  /* 4 · proyeccion_csv */
  titulo('4 · proyeccion_csv de las 4 tablas = SELECT de proyeccion_<tabla>_maestro');
  for (const t of ['plan', 'contrato', 'rendimiento', 'parametros']){
    const vista = 'proyeccion_' + t + '_maestro';
    const r = await W.get('/obra', { action: 'proyeccion_csv', tabla: t, clave: CLAVE });
    ok(t + ': 200 text/csv con BOM', r.status === 200 && r.ct === 'text/csv; charset=utf-8' && r.buf[0] === 0xEF, [r.status, r.ct, r.texto.slice(0, 120)]);
    const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [vista])).map(x => x.column_name).filter(c => c !== 'obra_id');
    const filasV = await q(`SELECT * FROM ${vista} WHERE obra_id = 'tm2sur'` + (t === 'plan' ? ' ORDER BY periodo' : ''));
    const f = comparar(t, r.texto, filasV, cols);
    if (t === 'plan') ok('plan: periodo YYYY-MM-DD', f.length > 0 && f.every(x => /^\d{4}-\d{2}-01$/.test(x[0])), f[0]);
    if (t === 'parametros') ok('parametros: una fila, FC 1.3 y CORTE BASE YYYY-MM-DD', f.length === 1 && f[0][0] === '1.3' && /^\d{4}-\d{2}-\d{2}$/.test(f[0][2]), f);
  }
  const pSin = await W.get('/obra', { action: 'proyeccion_csv', tabla: 'plan', clave: 'mala' });
  ok('proyeccion_csv con clave mala → 401', pSin.status === 401, pSin.status);

  /* 5 · /prueba/obra */
  titulo('5 · /prueba/obra: CLAVE_LECTURA_EXCEL_PRUEBA y respaldo a la de producción');
  const Wp = worker(sql, { CLAVE_LECTURA_EXCEL_PRUEBA: CLAVE_PRUEBA });
  const p1 = await Wp.get('/prueba/obra', { action: 'data_csv', clave: CLAVE_PRUEBA });
  const p2 = await Wp.get('/prueba/obra', { action: 'data_csv', clave: CLAVE });
  const p3 = await Wp.get('/obra', { action: 'data_csv', clave: CLAVE_PRUEBA });
  ok('con _PRUEBA: /prueba/obra acepta la suya (200) y rechaza la de producción (401); /obra rechaza la de prueba (401)', p1.status === 200 && p2.status === 401 && p3.status === 401, [p1.status, p2.status, p3.status]);
  const p4 = await W.get('/prueba/obra', { action: 'data_csv', clave: CLAVE });
  ok('sin _PRUEBA: /prueba/obra cae a CLAVE_LECTURA_EXCEL (200, mismo CSV)', p4.status === 200 && p4.texto === d.texto, p4.status);

  /* 6 · caché */
  titulo('6 · Caché de 60 s por entorno y tabla (solo tras validar la clave)');
  const cache = cacheFalsa(), Wc = worker(sql, { __cachePrueba: cache });
  const c1 = await Wc.get('/obra', { action: 'data_csv', clave: CLAVE });
  const c2 = await Wc.get('/obra', { action: 'data_csv', clave: CLAVE });
  ok('1.ª MISS, 2.ª HIT con el cuerpo idéntico; al cliente Cache-Control no-store', c1.xc === 'MISS' && c2.xc === 'HIT' && c2.texto === c1.texto && c1.texto === d.texto, [c1.xc, c2.xc]);
  const llaves = [...cache._m.keys()];
  ok('la llave de caché NO lleva la clave: ' + llaves.join(' · '), llaves.length === 1 && llaves[0] === 'http://127.0.0.1:8799/obra?action=data_csv' && llaves.every(k => k.indexOf(CLAVE) < 0 && !/clave=/.test(k)), llaves);
  const c3 = await Wc.get('/obra', { action: 'data_csv', clave: 'mala' });
  ok('con la caché llena, una clave mala → 401 (la caché no se consulta sin clave válida)', c3.status === 401 && c3.texto.indexOf('FECHA') < 0, c3.status);
  const Wrot = worker(sql, { __cachePrueba: cache, CLAVE_LECTURA_EXCEL: 'clave-rotada-d187' });
  const r1 = await Wrot.get('/obra', { action: 'data_csv', clave: CLAVE });
  const r2 = await Wrot.get('/obra', { action: 'data_csv', clave: 'clave-rotada-d187' });
  ok('ROTAR el secreto: la clave vieja 401 aunque el CSV siga en caché; la nueva HIT', r1.status === 401 && r2.status === 200 && r2.xc === 'HIT', [r1.status, r2.status, r2.xc]);
  await Wc.get('/obra', { action: 'proyeccion_csv', tabla: 'plan', clave: CLAVE });
  await Wc.get('/prueba/obra', { action: 'data_csv', clave: CLAVE });
  ok('una llave por entorno y tabla (…/obra?action=proyeccion_csv&tabla=plan · …/prueba/obra?action=data_csv)', cache._m.has('http://127.0.0.1:8799/obra?action=proyeccion_csv&tabla=plan') && cache._m.has('http://127.0.0.1:8799/prueba/obra?action=data_csv'), [...cache._m.keys()]);
  const tokAdmin = await emitirToken_('admin.d187', 'admin', [], SECRETO, '1');
  await Wc.post('/obra', { action: 'enviar_data', token: tokAdmin });
  ok('un POST enviar_data en /obra borra las llaves CSV de /obra (no las de /prueba)', !cache._m.has('http://127.0.0.1:8799/obra?action=data_csv') && !cache._m.has('http://127.0.0.1:8799/obra?action=proyeccion_csv&tabla=plan') && cache._m.has('http://127.0.0.1:8799/prueba/obra?action=data_csv'), [...cache._m.keys()]);
  await q(`UPDATE data SET observacion = 'cambiada por la prueba' WHERE id_registro = 'd187-punto'`);
  const c4 = await Wc.get('/obra', { action: 'data_csv', clave: CLAVE });
  ok('tras borrar: MISS y el CSV trae el cambio', c4.xc === 'MISS' && c4.texto.indexOf('cambiada por la prueba') >= 0, c4.xc);

  /* 7 · LOG */
  titulo('7 · Sin LOG');
  const lg = (await q(`SELECT count(*)::int AS n FROM log WHERE action IN ('data_csv','proyeccion_csv')`))[0].n;
  ok('ninguna fila de LOG con data_csv / proyeccion_csv', lg === 0, lg);

  console.log('\n' + casos + ' comprobaciones · ' + fallos + ' fallo(s)');
  process.exit(fallos ? 1 : 0);
}
main().catch(err => { console.error('La verificación no pudo correr: ' + (err && err.stack || err)); process.exit(2); });
