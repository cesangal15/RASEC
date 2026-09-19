#!/usr/bin/env node
/**
 * verificar_d185_tablero_vivo.mjs — V3-11 Fases B+C / D185: el Tablero EN VIVO desde la DATA de Galca, directo contra
 * Postgres EN MEMORIA (PGlite, como contrato_local.js) y el Worker REAL (src/index.js → manejar). Sin red.
 *
 *   node worker/pruebas/verificar_d185_tablero_vivo.mjs
 *   node worker/pruebas/verificar_d185_tablero_vivo.mjs --excel="<COPIA del Excel del jefe>.xlsx"      # el cálculo independiente sale del LIBRO
 *   node worker/pruebas/verificar_d185_tablero_vivo.mjs --horas="<leerHoras del libro de partes>.json"   # además, las horas reales
 *
 * Qué se comprueba:
 *   1. 001…008 en orden sobre un PGlite nuevo: esquema_version 8 una vez, RLS en tablero_mapeo / tablero_horas, las 9
 *      filas de MAPEO A2:C10 (verbatim) y la vista tablero_data_campo.
 *   2. La DATA real del sandbox (tools/sandbox/data.real.csv, como tools/sandbox/servidor.mjs: carga + 005 + 007) →
 *      GET ?action=tablero_vivo SIN token por el Worker: forma de leerProduccion, sin nombres de personas.
 *   3. PLIEGUE = un cálculo INDEPENDIENTE en Node (otra normalización, otro recorrido) directo de la hoja DATA del libro
 *      (con --excel; si no, del mismo CSV) con el mapeo de MAPEO A2:C10: por FECHA × campo, días, periodo y clima;
 *      «compacto mostrado» (Σ suelto ÷ fc, como construir) = Σ CANTIDAD con error relativo < 1e-9, por día y por
 *      periodo. AVANCE (decisión final del dueño, 19-sep-2026, «como tenemos lo de Proyección»): producción base
 *      certificada (proy.base_acum) + Σ CANTIDAD con fecha ≥ proy.base_corte (excavación común = aprov + no aprov;
 *      préstamo aparte), ÷ contrato. Si el motor del Tablero (tablero-produccion.js) se puede cargar, construir() con
 *      esos días da las mismas cifras (en vivo, error relativo < 1e-9), también en el avance.
 *   4. La Proyección (GET proyeccion) NO trae conciliación (se quitó el 19-sep-2026): ni `conciliacion`, ni columnas
 *      ni campos «DATA al corte» / «Diferencia»; proyeccion_guardar vuelve a rechazar esas claves (forma de D183).
 *   [O] El cálculo independiente aplica POR SU CUENTA la regla del dueño (18-sep-2026, enmienda de D184): una fila
 *      cuyo ELEMENTO es un «ajuste origen» (subtramo no operativo) cuenta con FC 1 → LARGO × ESPESOR, aunque la hoja
 *      traiga otro FC (las 5 de UF2 traen 1,3 por error); 007 lo corrige en la BD.
 *   5. CACHÉ de 60 s (env.__cachePrueba en vez de caches.default): 2ª petición anónima = HIT idéntica; token de jefe =
 *      BYPASS (y refresca); residente o token roto = HIT; /prueba/obra otra clave; el POST de horas la borra.
 *   6. HORAS: tablero_horas_guardar (admin/jefe sí; residente/capataz no; forma inválida → texto legible; grande OK;
 *      > 1 MB → 413) → tablero_vivo trae la misma salida y horas_meta sin quién la cargó; LOG sin tablero_vivo.
 *   7. 008 idempotente, no resucita semillas, REVOKE a anon/authenticated; BD sin 008 → respuestas legibles.
 * Sale con código 1 si algo falla.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { abrirPglite } from './pglite.js';
import { manejar } from '../src/index.js';
import { emitirToken_ } from '../src/comun.js';
import { tableroVivoLeer } from '../src/api/obra/tablero_vivo.js';
import { proyeccionLeer } from '../src/api/obra/proyeccion.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, '..', '..');
const SQL_DIR = path.join(REPO, 'worker', 'sql');
const CSV_DATA = path.join(REPO, 'tools', 'sandbox', 'data.real.csv');
const args = {}; process.argv.slice(2).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });

let casos = 0, fallos = 0;
function ok(n, c, x){ casos++; if (c) console.log('  ✓ ' + n); else { fallos++; console.log('  ✗ ' + n + (x !== undefined ? '  → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 600) : '')); } }
const titulo = (s) => console.log('\n' + s);
const SECRETO = 'secreto-verificar-d185-xxxxxxxxxxxxxxxx';
const JEFE = 'jefa.prueba.d185', ADMIN = 'admin.prueba.d185', RESID = 'resi.prueba.d185', CAPA = 'capa.prueba.d185';
const CAMPOS = ['exc', 'apr', 'pre', 'nap', 'ter1', 'ter2', 'ter', 'sub1', 'sub2', 'sub', 'bas1', 'bas2', 'bas'];
const FORMA_DIA = ['f', 'p', 'exc', 'apr', 'pre', 'nap', 'ter1', 'ter2', 'ter', 'sub1', 'sub2', 'sub', 'bas1', 'bas2', 'bas', 't'];
const PROHIBIDAS = ['usuario', 'editado_por', 'cargado_por', 'capataz', 'operador', 'reporta', 'nombre_operador'];
// [O] «ajuste origen» por NOMBRE, escrito aparte (sin el código del Worker): FC 1 → cantidad = LARGO × ESPESOR.
const AJUSTE_ORIGEN = /^\s*ajuste\s+origen/i;
// MAPEO A2:C10 del Excel (xls_dump): columna A de DATOS → campo · B descripción · C UF. Con --excel se lee del libro.
const MAPEO_EXCEL = [['F', 'Excavaciones en material común APROVECHABLE', '*'], ['G', 'Excavación en material común de préstamos', '*'],
  ['H', 'Excavaciones en material común NO APROVECHABLE', '*'], ['K', 'Terraplenes (solo conformación)', 'UF1'],
  ['L', 'Terraplenes (solo conformación)', 'UF2'], ['O', 'Subbase Granular', 'UF1'], ['P', 'Subbase Granular', 'UF2'],
  ['S', 'Base granular estabilizada con cemento (No incluye cemento)', 'UF1'], ['T', 'Base granular estabilizada con cemento (No incluye cemento)', 'UF2']];
const CAMPO_DE_COLUMNA = { F: 'apr', G: 'pre', H: 'nap', K: 'ter', L: 'ter', O: 'sub', P: 'sub', S: 'bas', T: 'bas' };

/* =====================================================================================================
 * Cálculo INDEPENDIENTE (Node puro, sin SQL ni el código del Worker): filas de DATA → Σ CANTIDAD por fecha × campo
 * ===================================================================================================== */
// Otra normalización (NFD + quitar marcas), a propósito distinta de normTexto/translate: si coinciden, el cruce es sólido.
const normInd = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[   ​‌‍﻿]/g, ' ').toUpperCase().replace(/\s+/g, ' ').trim();
const SELLO = /\[Clima:\s*([^\]]*)\]/i;
function periodoInd(f){ const d = new Date(f + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 15);   // EOMONTH(F−15)+1, piso 2025-06
  let y = d.getUTCFullYear(), m = d.getUTCMonth() + 2; if (m > 12) { m = 1; y++; }
  const p = y + '-' + String(m).padStart(2, '0'); return p < '2025-06' ? '2025-06' : p; }
function calculoIndependiente(filas, mapeo, corte){
  const M = mapeo.map((m, i) => ({ k: normInd(m[1]), uf: m[2], campo: CAMPO_DE_COLUMNA[m[0]], orden: i }));
  const dias = new Map(), tras = {};   // tras = Σ por partida con fecha ≥ corte (lo que el avance suma a la base)
  for (const r of filas){
    if (!r.f || r.f < '2020-01-01') continue;
    if (!dias.has(r.f)) dias.set(r.f, { t: '', o: Object.fromEntries(CAMPOS.map(k => [k, 0])) });
    const d = dias.get(r.f);
    if (!d.t) { const s = SELLO.exec(String(r.obs || '')); if (s && s[1].trim()) d.t = s[1].trim().toUpperCase(); }
    const uf = String(r.uf == null ? '' : r.uf).replace(/\s/g, '').toUpperCase(), k = normInd(r.desc);
    const cand = M.filter(m => m.k === k && (m.uf === '*' || m.uf === uf)).sort((a, b) => ((a.uf === '*') - (b.uf === '*')) || (a.orden - b.orden));
    if (!cand.length) continue;
    const c = cand[0].campo;
    const esp = typeof r.esp === 'number' ? r.esp : 1;
    const cant = (AJUSTE_ORIGEN.test(String(r.elem || '')) && typeof r.largo === 'number' && r.fc !== 1) ? r.largo * esp   // [O]
      : typeof r.cant === 'number' ? r.cant
      : (typeof r.largo === 'number' ? r.largo * esp / ((typeof r.fc === 'number' && r.fc !== 0) ? r.fc : 1) : 0);
    d.o[c] += cant;
    if (c === 'apr' || c === 'pre' || c === 'nap') d.o.exc += cant;
    if ((c === 'ter' || c === 'sub' || c === 'bas') && (uf === 'UF1' || uf === 'UF2')) d.o[c + uf.slice(-1)] += cant;
    if (r.f >= corte){   // D185 final: excavación común = aprov + no aprov; préstamo aparte
      const partida = { apr: 'excavacion', nap: 'excavacion', pre: 'prestamo', ter: 'terraplen', sub: 'subbase', bas: 'base' }[c];
      tras[partida] = (tras[partida] || 0) + cant;
    }
  }
  return { dias, tras };
}
// Filas de la hoja DATA del LIBRO (tablero-xlsx.js en un vm; solo lectura) y su MAPEO A2:C10.
function leerLibro(ruta){
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(REPO, 'tablero-xlsx.js'), 'utf8'), ctx);
  const wb = ctx.XLSX.read(fs.readFileSync(ruta), { type: 'buffer' });
  const R = ctx.XLSX.utils.sheet_to_json(wb.Sheets['DATA'], { header: 1, raw: true, defval: null }).slice(1);
  const iso = (v) => typeof v === 'number' ? new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10) : null;
  const filas = R.map(r => ({ f: iso(r[0]), desc: r[5], uf: r[6], elem: r[8], largo: r[14], esp: r[15], fc: r[16], cant: r[17], obs: r[18] }));
  const MP = ctx.XLSX.utils.sheet_to_json(wb.Sheets['MAPEO'], { header: 1, raw: true, defval: null });
  const mapeo = MP.slice(1, 10).map(r => [String(r[0]).trim().charAt(0), String(r[1]), String(r[2])]);
  return { filas, mapeo, ctx };
}
function parseCsv(txt){
  const lineas = txt.replace(/\r/g, '').split('\n').filter(l => l.length);
  const cab = lineas.shift().split(',');
  return lineas.map(l => { const c = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++){ const ch = l[i];
      if (ch === '"'){ if (q && l[i + 1] === '"'){ cur += '"'; i++; } else q = !q; }
      else if (ch === ',' && !q){ c.push(cur); cur = ''; } else cur += ch; }
    c.push(cur); const o = {}; cab.forEach((k, i) => { o[k.trim()] = (c[i] || '').trim(); }); return o; });
}
const numCsv = (v) => (v === undefined || v === null || String(v).trim() === '') ? null : Number(String(v).replace(',', '.'));
function filasDelCsv(){ return parseCsv(fs.readFileSync(CSV_DATA, 'utf8')).map(f => ({ f: f.fecha, desc: f.descripcion, uf: f.unidad_funcional, elem: f.elemento,
  largo: numCsv(f.largo), esp: numCsv(f.espesor), fc: numCsv(f.fc), cant: numCsv(f.cantidad), obs: f.observacion })); }

// La MISMA carga que tools/sandbox/servidor.mjs (cargarDataCsv): una fila por INSERT, timestamp now().
async function cargarDataCsv(sql){
  let n = 0;
  for (const f of parseCsv(fs.readFileSync(CSV_DATA, 'utf8'))){
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

/* =====================================================================================================
 * El Worker de verdad (manejar) con una Cache API de mentira
 * ===================================================================================================== */
function cacheFalsa(){
  const m = new Map();
  return { _m: m, puestas: [],
    async match(req){ const e = m.get(req.url); return e ? new Response(e.body, { headers: e.headers }) : undefined; },
    async put(req, resp){ const cc = resp.headers.get('Cache-Control') || '';
      if (/no-store|private/i.test(cc)) throw new Error('Cache API: respuesta no cacheable (' + cc + ')');
      this.puestas.push({ url: req.url, cc }); m.set(req.url, { body: await resp.text(), headers: Object.fromEntries(resp.headers) }); },
    async delete(req){ return m.delete(req.url); } };
}
function worker(sql, cache){
  const env = { ALLOWED_ORIGINS: 'https://tm2.galca.app', BACKEND_OBRA: 'db', BACKEND_OBRA_PRUEBA: 'db', BACKEND_ASISTENCIAS: 'db', BACKEND_PARTE: 'db',
    AUTH_SECRETO: SECRETO, AUTH_V: '1', RATE_LIMIT_POR_MIN: '100000', __dbPrueba: () => sql, __cachePrueba: cache };
  async function pedir(metodo, ruta, params, body){
    const u = new URL('http://127.0.0.1:8799' + ruta); Object.keys(params || {}).forEach(k => u.searchParams.set(k, params[k]));
    const pend = [], ctx = { waitUntil: (p) => pend.push(Promise.resolve(p).catch(() => {})) };
    const init = { method: metodo, headers: { 'Content-Type': 'text/plain;charset=utf-8', 'CF-Connecting-IP': '127.0.0.1' } };
    if (metodo === 'POST'){ init.body = typeof body === 'string' ? body : JSON.stringify(body); init.headers['Content-Length'] = String(Buffer.byteLength(init.body)); }
    const r = await manejar(new Request(u.toString(), init), env, ctx);
    const texto = await r.text(); await Promise.all(pend);
    let j = null; try { j = JSON.parse(texto); } catch (e) { j = null; }
    return { status: r.status, cache: r.headers.get('X-Tablero-Cache'), texto, j };
  }
  return { get: (ruta, p) => pedir('GET', ruta, p), post: (ruta, b) => pedir('POST', ruta, null, b), env };
}
const tok = (u, rol) => emitirToken_(u, rol, [], SECRETO, '1');
// Claves de TODO el árbol (para buscar nombres de personas en la lectura pública).
function claves(o, out){ out = out || new Set(); if (o && typeof o === 'object'){ if (Array.isArray(o)) o.forEach(x => claves(x, out)); else Object.keys(o).forEach(k => { out.add(k); claves(o[k], out); }); } return out; }
const rel = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(b));

/* ---------- el motor del Tablero (tablero-produccion.js, parte MOTOR) en un vm, si se puede cargar ---------- */
function cargarMotor(){
  const ctx = { console }; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(REPO, 'tablero-xlsx.js'), 'utf8'), ctx);
  const src = fs.readFileSync(path.join(REPO, 'tablero-produccion.js'), 'utf8');
  const i = src.indexOf('const MOTOR'); if (i < 0) throw new Error('tablero-produccion.js no declara `const MOTOR`');
  const fin = src.indexOf('\n', src.indexOf(';', i));
  vm.runInContext(src.slice(0, fin) + '\n;globalThis.MOTOR = MOTOR;', ctx);
  return ctx;
}
// Horas de mentira con la forma EXACTA de leerHoras (n partes).
function horasFalsas(n){
  const tipos = [['EXC001', 'EXCAVADORA', 'excavacion'], ['BL005', 'BULLDOZER', 'terraplen'], ['MO03', 'MOTONIVELADORA', 'subbase'], ['FNG002', 'FINISHER', 'base']];
  const partes = [];
  for (let i = 0; i < n; i++){ const t = tipos[i % 4], d = new Date(Date.UTC(2025, 7, 1 + (i % 400)));
    const f = d.toISOString().slice(0, 10); let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; if (d.getUTCDate() > 15){ m++; if (m > 12){ m = 1; y++; } }
    partes.push({ p: y + '-' + String(m).padStart(2, '0'), f, act: t[2], cod: t[0], tipo: t[1], uf: i % 3 ? 'UF1' : 'UF2', h: 7.5 + (i % 5) / 10, mtto: i % 7 ? 0 : 1, varada: 0, lluvia: i % 11 ? 0 : 2.5, averia: 0 }); }
  return { partes, cc: [{ cc: '02.05', horas: 1234.5, filas: 300, act: 'excavacion', flota: 1000.25 }, { cc: '06.01', horas: 12, filas: 4, act: null, flota: 0 }],
    corte: partes.length ? partes[partes.length - 1].f : null, descartadas: 17, negativas: 1 };
}

async function main(){
  const { sql } = await abrirPglite();
  const q = (t, p) => sql.unsafe(t, p);
  const aplicar = (f) => sql.exec(fs.readFileSync(path.join(SQL_DIR, f), 'utf8'));

  /* 1 · migraciones */
  titulo('1 · 001…008 sobre un PGlite nuevo');
  const migraciones = fs.readdirSync(SQL_DIR).filter(f => /^0\d+_.*\.sql$/.test(f)).sort();
  for (const f of migraciones) await aplicar(f);
  ok('se aplicaron ' + migraciones.join(', '), migraciones.indexOf('008_tablero_vivo.sql') >= 0, migraciones);
  const ver = await q(`SELECT max(version)::int AS v, count(*) FILTER (WHERE version = 8)::int AS n8 FROM esquema_version`);
  ok('esquema_version tiene la 8 (una fila)', ver[0].v >= 8 && ver[0].n8 === 1, ver[0]);
  const rls = await q(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('tablero_mapeo','tablero_horas') ORDER BY relname`);
  ok('RLS activada en tablero_mapeo y tablero_horas', rls.length === 2 && rls.every(r => r.relrowsecurity === true), rls);
  const mp = await q(`SELECT descripcion, uf, campo, orden FROM tablero_mapeo WHERE obra_id='tm2sur' ORDER BY orden`);
  const mpEsp = MAPEO_EXCEL.map((m, i) => ({ descripcion: m[1], uf: m[2], campo: CAMPO_DE_COLUMNA[m[0]], orden: i + 1 }));
  ok('tablero_mapeo = MAPEO A2:C10 (9 filas, descripción verbatim de la BASE, UF y campo, en orden)', JSON.stringify(mp) === JSON.stringify(mpEsp), mp);

  /* 2 · DATA real + tablero_vivo público */
  titulo('2 · DATA real del sandbox → GET ?action=tablero_vivo SIN token');
  const t0 = Date.now(); const nCsv = await cargarDataCsv(sql);
  for (const f of ['005_data_clima.sql', '007_data_completa.sql']) await aplicar(f);   // como el sandbox (paso 3b)
  console.log('  (' + nCsv + ' filas de ' + path.relative(REPO, CSV_DATA) + ' cargadas y 005/007 re-aplicadas en ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  // [O] 007 dejó TODAS las filas de «ajuste origen» con FC 1 y cantidad = largo × espesor (las 5 de UF2 traían 1,3).
  const ao = (await q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE fc = 1 AND cantidad = round(largo * coalesce(espesor, 1), 6))::int AS bien,
      count(*) FILTER (WHERE unidad_funcional = 'UF2' AND descripcion IN ('Excavaciones en material común APROVECHABLE','Excavaciones en material común NO APROVECHABLE',
        'Terraplenes (solo conformación)','Subbase Granular','Conformación y disposición de sobrantes (incluye obras de adecuación)'))::int AS uf2
    FROM data WHERE elemento ~* '^\\s*ajuste\\s*origen' AND largo IS NOT NULL`))[0];
  ok('[O] 007: las ' + ao.n + ' filas de «ajuste origen» con FC 1 y cantidad = largo × espesor (incluidas las ' + ao.uf2 + ' de UF2 que el Excel trae con 1,3)', ao.n === 35 && ao.bien === ao.n && ao.uf2 === 5, ao);
  const cache = cacheFalsa(), W = worker(sql, cache);
  const a1 = await W.get('/obra', { action: 'tablero_vivo' });
  const v = a1.j || {};
  ok('200, ok:true, fuente galca, X-Tablero-Cache MISS (primera)', a1.status === 200 && v.ok === true && v.fuente === 'galca' && a1.cache === 'MISS', { status: a1.status, cache: a1.cache, error: v.error });
  ok('forma {ok, fuente, dias[], proy{}, horas:null, horas_meta:null, datos_hasta, generado, fc_dias}', Array.isArray(v.dias) && v.proy && typeof v.proy === 'object'
    && v.horas === null && v.horas_meta === null && /^\d{4}-\d{2}-\d{2}$/.test(v.datos_hasta) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v.generado) && typeof v.fc_dias === 'number', Object.keys(v));
  ok('cada día con la forma EXACTA de leerProduccion (f, p, exc, apr, pre, nap, ter1, ter2, ter, sub1, sub2, sub, bas1, bas2, bas, t)',
    v.dias.length > 0 && v.dias.every(d => JSON.stringify(Object.keys(d)) === JSON.stringify(FORMA_DIA) && CAMPOS.every(k => typeof d[k] === 'number' && isFinite(d[k])) && typeof d.t === 'string'), v.dias[0]);
  const proyT = await W.get('/obra', { action: 'proyeccion_tablero', token: await tok(JEFE, 'jefe') });
  const esperadoProy = Object.assign({}, proyT.j); delete esperadoProy.usuario; delete esperadoProy._ms;
  ok('proy = proyeccion_tablero SIN `usuario` (ok, fuente, fc, plan, proyectado, contrato, base_acum, base_corte, acta_base, actualizado)',
    JSON.stringify(v.proy) === JSON.stringify(esperadoProy) && !('usuario' in v.proy), [Object.keys(v.proy), Object.keys(esperadoProy)]);
  ok('fc_dias = proy.fc (1.3): los días van en suelto-equivalente con el fc que usará construir()', v.fc_dias === v.proy.fc && v.fc_dias === 1.3, [v.fc_dias, v.proy.fc]);
  const ks = claves(v); const malas = PROHIBIDAS.filter(k => ks.has(k));
  ok('ninguna clave con nombres de personas (' + PROHIBIDAS.join(', ') + ')', malas.length === 0, malas);
  ok('sin token no se escribió LOG (D161/D185)', (await q(`SELECT count(*)::int AS n FROM log WHERE action = 'tablero_vivo'`))[0].n === 0);

  /* 3 · pliegue = cálculo independiente */
  const libro = args.excel ? leerLibro(path.resolve(String(args.excel))) : null;
  titulo('3 · Pliegue = cálculo INDEPENDIENTE desde ' + (libro ? 'la hoja DATA del libro ' + path.basename(String(args.excel)) + ' (MAPEO A2:C10 del libro)' : 'el CSV ' + path.basename(CSV_DATA) + ' (MAPEO A2:C10 transcrito)'));
  if (libro) ok('MAPEO A2:C10 del libro = la semilla de 008', JSON.stringify(libro.mapeo) === JSON.stringify(MAPEO_EXCEL), libro.mapeo);
  const corte = v.proy.base_corte;
  const ind = calculoIndependiente(libro ? libro.filas : filasDelCsv(), libro ? libro.mapeo : MAPEO_EXCEL, corte);
  const fcs = v.dias.map(d => d.f), fInd = [...ind.dias.keys()].sort();
  ok('las mismas FECHAS (' + fInd.length + ': todas las de DATA, cualquier área; ' + fInd[0] + ' … ' + fInd[fInd.length - 1] + ')', JSON.stringify(fcs) === JSON.stringify(fInd),
    { soloWorker: fcs.filter(f => !ind.dias.has(f)).slice(0, 5), soloInd: fInd.filter(f => fcs.indexOf(f) < 0).slice(0, 5) });
  let peor = { e: 0 }, sinPartida = 0;
  for (const d of v.dias){ const e = ind.dias.get(d.f); if (!e) continue;
    if (CAMPOS.every(k => e.o[k] === 0)) sinPartida++;
    for (const k of CAMPOS){ const x = rel(d[k] / v.fc_dias, e.o[k]); if (x > peor.e) peor = { e: x, f: d.f, k, worker: d[k] / v.fc_dias, ind: e.o[k] }; } }
  ok('por FECHA × campo (13 campos): suelto ÷ fc = Σ CANTIDAD, error relativo máx. ' + peor.e.toExponential(2) + ' < 1e-9 (' + sinPartida + ' días sin partida = ceros)', peor.e < 1e-9, peor);
  ok('periodo p = mes de cierre 16→15 con piso 2025-06 (EOMONTH(F−15)+1)', v.dias.every(d => d.p === periodoInd(d.f)), v.dias.filter(d => d.p !== periodoInd(d.f)).slice(0, 3));
  const tMal = v.dias.filter(d => ind.dias.get(d.f) && ind.dias.get(d.f).t !== d.t);
  ok('clima del día t (regla D182, en MAYÚSCULAS) = el del primer sello «[Clima: …]» del día en la hoja (' + v.dias.filter(d => d.t).length + ' días con clima)', tMal.length === 0, tMal.slice(0, 5).map(d => d.f + ': ' + d.t + ' ≠ ' + ind.dias.get(d.f).t));
  // «Compacto mostrado»: construir suma el suelto del periodo y divide por fc; comp() divide por TM2.fc.
  const porPer = {}; v.dias.forEach(d => { (porPer[d.p] = porPer[d.p] || []).push(d); });
  let peorP = { e: 0 };
  for (const p of Object.keys(porPer)) for (const k of CAMPOS){
    const mostrado = porPer[p].reduce((s, d) => s + (d[k] || 0), 0) / v.fc_dias;
    const esp = porPer[p].reduce((s, d) => s + ind.dias.get(d.f).o[k], 0);
    const x = rel(mostrado, esp); if (x > peorP.e) peorP = { e: x, p, k, mostrado, esp }; }
  ok('por PERIODO (' + Object.keys(porPer).length + ' periodos × 13 campos): Σ suelto ÷ fc = Σ CANTIDAD, error relativo máx. ' + peorP.e.toExponential(2), peorP.e < 1e-9, peorP);
  // AVANCE (D185, decisión final 19-sep-2026): base certificada + Σ de los días con f ≥ base_corte (del Worker) frente a
  // base + Σ de las filas con fecha ≥ corte (independiente); excavación común = aprov + no aprov; préstamo aparte.
  const tras = (k) => v.dias.filter(d => d.f >= corte).reduce((s, d) => s + d[k], 0) / v.fc_dias, trasI = (p) => ind.tras[p] || 0;
  const BA = v.proy.base_acum;
  const avance = { excavacion: [BA.excavacion + tras('apr') + tras('nap'), BA.excavacion + trasI('excavacion')], terraplen: [BA.terraplen + tras('ter'), BA.terraplen + trasI('terraplen')],
    subbase: [BA.subbase + tras('sub'), BA.subbase + trasI('subbase')], base: [BA.base + tras('bas'), BA.base + trasI('base')], prestamo: [BA.prestamo + tras('pre'), BA.prestamo + trasI('prestamo')] };
  ok('AVANCE (D185 final): base certificada + Σ CANTIDAD con fecha ≥ ' + corte + ' (excavación = aprov + no aprov; préstamo aparte) = el independiente (error < 1e-9): '
    + Object.keys(avance).map(k => k + ' ' + BA[k].toFixed(2) + ' + ' + trasI(k).toFixed(2) + ' = ' + avance[k][1].toFixed(2) + ' (' + (100 * avance[k][1] / v.proy.contrato[k]).toFixed(1) + ' %)').join(' · '),
    Object.keys(avance).every(k => rel(avance[k][0], avance[k][1]) < 1e-9), avance);
  // El motor REAL del Tablero (tablero-produccion.js) con la respuesta tal cual, como lo hará la página: EN VIVO
  // construir({vivo:true, dias, fc:fc_dias}, {H:horas}, proyDeGalca(proy)) — sin redondeos en vivo —; si el motor aún
  // no tiene la rama viva, por una hoja DATOS de mentira (camino de archivos, redondeado a 0,1).
  let motor = null; try { motor = cargarMotor(); } catch (e) { console.log('  – motor del Tablero no cargable (' + e.message + '): se omite construir()'); }
  if (motor){
    const M = motor.MOTOR, proy = M.proyDeGalca(v.proy);
    let T = null, modo = '';
    try { T = M.construir({ vivo: true, dias: v.dias, fc: v.fc_dias }, { H: v.horas }, proy); modo = 'vivo'; }
    catch (e) {
      try {
        const X = motor.XLSX, serial = (f) => Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10)) / 864e5 + 25569;
        const filasD = [['DATOS'], ['cabecera']].concat(v.dias.map(d => { const r = new Array(24).fill(null); r[1] = serial(d.f); r[2] = serial(d.p + '-01'); r[3] = d.exc; r[5] = d.apr; r[6] = d.pre; r[7] = d.nap;
          r[10] = d.ter1; r[11] = d.ter2; r[12] = d.ter; r[14] = d.sub1; r[15] = d.sub2; r[16] = d.sub; r[18] = d.bas1; r[19] = d.bas2; r[20] = d.bas; r[23] = d.t; return r; }));
        T = M.construir({ SheetNames: ['DATOS'], Sheets: { DATOS: X.utils.aoa_to_sheet(filasD) } }, null, proy); modo = 'archivo';
      } catch (e2) { console.log('  – construir() del motor no aceptó los días (' + String(e.message).slice(0, 100) + ' / ' + String(e2.message).slice(0, 100) + '): se omite'); }
    }
    if (T){
      const tolM = modo === 'vivo' ? 1e-9 : null;   // vivo: relativo; archivo: absoluto 0,05 (toFixed(1))
      const mal = (x, e) => tolM ? rel(x, e) > tolM : Math.abs(x - e) > 0.05 + 1e-9;
      let peorM = null, n = 0;
      for (const per of T.per){ const e = (porPer[per.p] || []).map(d => ind.dias.get(d.f).o), S = (k) => e.reduce((s, o) => s + o[k], 0);
        const esp = { excavacion: S('exc'), terraplen: S('ter'), subbase: S('sub'), base: S('bas') };
        for (const k of Object.keys(esp)){ n++; if (mal(per.a[k].prod, esp[k]) && !peorM) peorM = { p: per.p, k, motor: per.a[k].prod, esp: esp[k] }; }
        for (const k of ['apr', 'pre', 'nap']){ n++; if (mal(per.split[k], S(k)) && !peorM) peorM = { p: per.p, k, motor: per.split[k], esp: S(k) }; }
        n++; if (mal(per.a.noaprov.prod, S('nap')) && !peorM) peorM = { p: per.p, k: 'noaprov', motor: per.a.noaprov.prod, esp: S('nap') };
        for (const u of ['1', '2']) for (const k of ['terraplen', 'subbase', 'base']){ const c = { terraplen: 'ter', subbase: 'sub', base: 'bas' }[k] + u; n++;
          if (per.uf && per.uf['UF' + u] && mal(per.uf['UF' + u].a[k].prod, S(c)) && !peorM) peorM = { p: per.p, uf: u, k, motor: per.uf['UF' + u].a[k].prod, esp: S(c) }; } }
      ok('construir() del motor REAL (' + (modo === 'vivo' ? 'rama EN VIVO de la página, sin redondeo: error relativo < 1e-9' : 'hoja DATOS de mentira, a 0,1') + '): '
        + n + ' cifras de producción por periodo (partidas, split, no aprov., UF1/UF2) = Σ CANTIDAD', T.fc === v.fc_dias && T.per.length === Object.keys(porPer).length && !peorM, peorM);
      const av = {}; (T.avance || []).forEach(a => { av[a.k] = a.eje; });
      if (modo === 'vivo'){
        const malA = Object.keys(avance).filter(k => !(k in av) || rel(av[k], avance[k][1]) > 1e-9);
        ok('…y su AVANCE en vivo = base certificada + DATA desde el corte (excavación = aprov + no aprov; préstamo aparte)', malA.length === 0, { motor: av, esp: Object.fromEntries(Object.keys(avance).map(k => [k, avance[k][1]])) });
      }
      if (modo === 'vivo'){
        // D185: un período con partes de maquinaria y SIN DATA (jun/jul-2025 con el libro real) sigue en el Tablero con
        // producción 0 y su maquinaria; lo anterior al piso 2025-06 (DATOS!C) no abre período.
        const Hx = horasFalsas(8);
        Hx.partes.unshift({ p: '2025-05', f: '2025-05-10', act: 'excavacion', cod: 'EXC001', tipo: 'EXCAVADORA', uf: 'UF1', h: 3, mtto: 0, varada: 0, lluvia: 0, averia: 0 },
                          { p: '2025-06', f: '2025-06-10', act: 'excavacion', cod: 'EXC001', tipo: 'EXCAVADORA', uf: 'UF1', h: 8, mtto: 0, varada: 0, lluvia: 0, averia: 0 });
        const T2 = M.construir({ vivo: true, dias: v.dias, fc: v.fc_dias }, { H: Hx }, proy);
        const j6 = T2.per.find(x => x.p === '2025-06');
        ok('períodos EN VIVO = los de la DATA ∪ los de los partes (≥ 2025-06): 2025-06 sin DATA sale con producción 0 y sus horas; 2025-05 no',
          !!j6 && j6.d.length === 0 && j6.a.excavacion.prod === 0 && j6.m && j6.m.excavacion.horas === 8 && T2.maq_periodos.includes('2025-06')
          && !T2.per.some(x => x.p < '2025-06') && T2.per.length === new Set(Object.keys(porPer).concat(Hx.partes.map(x => x.p).filter(q => q >= '2025-06'))).size,
          j6 ? { d: j6.d.length, m: j6.m, pers: T2.per.map(x => x.p) } : T2.per.map(x => x.p));
      }
    }
  }

  /* 4 · Proyección sin conciliación (decisión final del dueño, 19-sep-2026) */
  titulo('4 · La Proyección (GET proyeccion) vuelve a la forma de D183: sin conciliación');
  const pj = await W.get('/obra', { action: 'proyeccion', token: await tok(JEFE, 'jefe') });
  ok('GET proyeccion ok y SIN conciliacion / conciliacion_error', pj.j && pj.j.ok === true && !('conciliacion' in pj.j) && !('conciliacion_error' in pj.j), pj.j && Object.keys(pj.j));
  const cf = (((pj.j || {}).tablas || {}).contrato || {}).filas || [];
  const cols = ((((pj.j || {}).tablas || {}).contrato || {}).columnas || []).map(c => c.k + (c.edita ? '*' : ''));
  ok('columnas del contrato = partida, uf, programado*, produccion_base* (sin «DATA al corte» ni «Diferencia»)', JSON.stringify(cols) === JSON.stringify(['partida', 'uf', 'programado*', 'produccion_base*']), cols);
  ok('ninguna fila del contrato trae data_al_corte ni diferencia (9 filas)', cf.length === 9 && cf.every(f => !('data_al_corte' in f) && !('diferencia' in f)), cf[0]);
  ok('nada de «DATA al corte» ni «conciliación» en la respuesta', !/data_al_corte|DATA al corte|conciliaci/i.test(pj.texto));
  const gExtra = await W.post('/obra', { action: 'proyeccion_guardar', token: await tok(JEFE, 'jefe'), cambios: [Object.assign({ tabla: 'contrato', op: 'update', if_version: cf[0].version },
    { partida: cf[0].partida, uf: cf[0].uf, programado: cf[0].programado, data_al_corte: 1 })] });
  ok('proyeccion_guardar vuelve a RECHAZAR data_al_corte como clave desconocida (forma de D183) y no guarda', gExtra.j && gExtra.j.ok === false && /data_al_corte/.test(String(gExtra.j.error)), gExtra.j);
  const gIgn = await W.post('/obra', { action: 'proyeccion_guardar', token: await tok(JEFE, 'jefe'), cambios: [Object.assign({ tabla: 'contrato', op: 'update', if_version: cf[0].version },
    { partida: cf[0].partida, uf: cf[0].uf, programado: cf[0].programado })] });
  ok('proyeccion_guardar del contrato (mismo programado) guarda', gIgn.j && gIgn.j.ok === true && gIgn.j.guardadas === 1, gIgn.j && (gIgn.j.error || gIgn.j.mensaje));

  /* 5 · caché */
  titulo('5 · Caché de 60 s (Cache API; en el banco env.__cachePrueba)');
  ok('la 1ª petición anónima dejó UNA entrada con Cache-Control public, max-age=60 y clave sin token', cache.puestas.length >= 1 && cache.puestas[0].cc === 'public, max-age=60'
    && cache.puestas[0].url === 'http://127.0.0.1:8799/obra?action=tablero_vivo', cache.puestas);
  const a2 = await W.get('/obra', { action: 'tablero_vivo' });
  ok('el proyeccion_guardar de arriba BORRÓ la clave: la 2ª petición anónima vuelve a calcular (MISS) y ve la edición (proy.actualizado)',
    a2.cache === 'MISS' && a2.j && a2.j.proy.actualizado !== '' && a1.j.proy.actualizado === '', [a2.cache, a2.j && a2.j.proy.actualizado]);
  const a3 = await W.get('/obra', { action: 'tablero_vivo' });
  ok('3ª petición anónima: HIT, sin tocar la BD, con el cuerpo IDÉNTICO al de la 2ª (mismo generado)', a3.cache === 'HIT' && a3.texto === a2.texto, [a3.cache, a2.cache]);
  ok('…y sin el nombre de quien editó la Proyección (proyeccion_tablero sí lo trae: ' + JEFE + ')', a3.texto.indexOf(JEFE) < 0
    && (await W.get('/obra', { action: 'proyeccion_tablero', token: await tok(JEFE, 'jefe') })).j.usuario === JEFE);
  const rj = await W.get('/obra', { action: 'tablero_vivo', token: await tok(JEFE, 'jefe') });
  ok('token de JEFE: BYPASS (calcula al momento) y ok', rj.cache === 'BYPASS' && rj.j && rj.j.ok === true, rj.cache);
  const ra = await W.get('/obra', { action: 'tablero_vivo', token: await tok(ADMIN, 'admin') });
  ok('token de ADMIN: BYPASS', ra.cache === 'BYPASS', ra.cache);
  const a4 = await W.get('/obra', { action: 'tablero_vivo' });
  ok('…y deja su respuesta fresca en la caché: el anónimo siguiente la lee (HIT = la del admin)', a4.cache === 'HIT' && a4.texto === ra.texto, a4.cache);
  const rr = await W.get('/obra', { action: 'tablero_vivo', token: await tok(RESID, 'residente') });
  const rt = await W.get('/obra', { action: 'tablero_vivo', token: (await tok(JEFE, 'jefe')).slice(0, -3) + 'xyz' });
  ok('residente y token de jefe con la firma rota: HIT (lectores anónimos)', rr.cache === 'HIT' && rt.cache === 'HIT' && rt.j && rt.j.ok === true, [rr.cache, rt.cache]);
  const pr1 = await W.get('/prueba/obra', { action: 'tablero_vivo' });
  ok('/prueba/obra: OTRA clave (MISS la 1ª vez aunque /obra está en caché)', pr1.cache === 'MISS' && cache._m.has('http://127.0.0.1:8799/prueba/obra?action=tablero_vivo'), [pr1.cache, [...cache._m.keys()]]);

  /* 6 · horas */
  titulo('6 · Horas de máquina: POST tablero_horas_guardar → GET tablero_vivo');
  let horas = horasFalsas(40), archivo = 'partes_prueba_d185.xlsx';
  if (args.horas){ horas = JSON.parse(fs.readFileSync(path.resolve(String(args.horas)), 'utf8')); archivo = path.basename(String(args.horas)).replace(/\.json$/, '.xlsx'); }
  const hk = new Set(); (horas.partes || []).forEach(p => Object.keys(p).forEach(k => hk.add(k)));
  ok('la salida de leerHoras solo lleva p, f, act, cod, tipo, uf, h, mtto, varada, lluvia, averia (sin operadores)' + (args.horas ? ' · ' + horas.partes.length + ' partes reales' : ''),
    [...hk].every(k => ['p', 'f', 'act', 'cod', 'tipo', 'uf', 'h', 'mtto', 'varada', 'lluvia', 'averia'].indexOf(k) >= 0), [...hk]);
  const sinPerm = [];
  for (const [u, rol] of [[RESID, 'residente'], [CAPA, 'capataz']]){
    const r = await W.post('/obra', { action: 'tablero_horas_guardar', token: await tok(u, rol), horas, archivo });
    if (!(r.j && r.j.ok === false && /no puede cargar las horas/.test(String(r.j.error)))) sinPerm.push(rol + ': ' + JSON.stringify(r.j));
  }
  ok('residente y capataz: «Tu usuario no puede cargar las horas…» y no se guarda nada', sinPerm.length === 0 && (await q(`SELECT count(*)::int AS n FROM tablero_horas`))[0].n === 0, sinPerm);
  const invalidos = [
    ['horas no es un objeto', 'x', (j) => j.error === 'payload' && j.campo === 'horas'],
    ['sin horas', undefined, (j) => j.error === 'payload' && j.campo === 'horas'],
    ['un parte con «operador»', Object.assign({}, horas, { partes: [Object.assign({ operador: 'JUAN PEREZ' }, horas.partes[0])] }), (j) => /«operador»/.test(j.error)],
    ['una clave de más arriba', Object.assign({ usuarios: [] }, horas), (j) => /«usuarios»/.test(j.error)],
    ['cero partes (no es el libro de partes)', Object.assign({}, horas, { partes: [] }), (j) => /ningún parte/.test(j.error)],
    ['código de máquina con un nombre', Object.assign({}, horas, { partes: [Object.assign({}, horas.partes[0], { cod: 'JUAN PEREZ' })] }), (j) => /código de máquina/.test(j.error)],
    ['tipo fuera de la flota', Object.assign({}, horas, { partes: [Object.assign({}, horas.partes[0], { tipo: 'VOLQUETA' })] }), (j) => /tipo de máquina/.test(j.error)],
    ['fecha imposible', Object.assign({}, horas, { partes: [Object.assign({}, horas.partes[0], { f: '2026-02-30' })] }), (j) => /fecha no válida/.test(j.error)],
    ['horas negativas', Object.assign({}, horas, { partes: [Object.assign({}, horas.partes[0], { h: -2 })] }), (j) => /«h» fuera de rango/.test(j.error)],
    ['CC mal escrito', Object.assign({}, horas, { cc: [{ cc: '3701.02.05', horas: 1, filas: 1, act: null, flota: 0 }] }), (j) => /CC válido/.test(j.error)],
    ['archivo que no es texto', horas, (j) => j.error === 'payload' && j.campo === 'archivo', { archivo: { a: 1 } }]
  ];
  const malInv = [];
  for (const [n, h, pred, extra] of invalidos){
    const b = Object.assign({ action: 'tablero_horas_guardar', token: await tok(JEFE, 'jefe'), archivo }, extra || {}); if (h !== undefined) b.horas = h;
    const r = await W.post('/obra', b);
    if (!(r.status === 200 && r.j && r.j.ok === false && pred(r.j) && (r.j.error === 'payload' || /No se guardó nada/.test(r.j.error)))) malInv.push(n + ' → ' + JSON.stringify(r.j).slice(0, 160));
  }
  ok('forma inválida → error LEGIBLE (o payload D166), nunca 500, y no se guarda (' + invalidos.length + ' casos)', malInv.length === 0 && (await q(`SELECT count(*)::int AS n FROM tablero_horas`))[0].n === 0, malInv);
  const g1 = await W.post('/obra', { action: 'tablero_horas_guardar', token: await tok(JEFE, 'jefe'), horas, archivo });
  ok('JEFE guarda: ok, horas_meta {archivo, cargado_ts, partes, corte}, version 1', g1.j && g1.j.ok === true && g1.j.version === 1 && g1.j.horas_meta.archivo === archivo
    && g1.j.horas_meta.partes === horas.partes.length && g1.j.horas_meta.corte === horas.corte && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(g1.j.horas_meta.cargado_ts), g1.j);
  const fila = (await q(`SELECT horas::text AS h, archivo, cargado_por, version, length(horas::text) AS n FROM tablero_horas`))[0];
  ok('en la BD: comprimida ({z}: ' + fila.n + ' caracteres frente a ' + JSON.stringify(horas).length + ' crudos), cargado_por = el usuario del token', /^\{"z": ?"/.test(fila.h) && fila.cargado_por === JEFE && fila.version === 1, fila.h.slice(0, 40));
  ok('el POST de horas BORRÓ la clave de la caché de /obra', !cache._m.has('http://127.0.0.1:8799/obra?action=tablero_vivo'), [...cache._m.keys()]);
  const h1 = await W.get('/obra', { action: 'tablero_vivo' });
  ok('GET tablero_vivo (anónimo, MISS): horas = EXACTAMENTE la salida de leerHoras subida', h1.cache === 'MISS' && JSON.stringify(h1.j.horas) === JSON.stringify(horas), h1.cache);
  ok('horas_meta = {archivo, cargado_ts} y NADA de quién la cargó (ni el nombre en ninguna parte de la respuesta)', JSON.stringify(Object.keys(h1.j.horas_meta)) === JSON.stringify(['archivo', 'cargado_ts'])
    && h1.j.horas_meta.archivo === archivo && h1.texto.indexOf(JEFE) < 0 && h1.texto.indexOf(ADMIN) < 0 && PROHIBIDAS.every(k => !claves(h1.j).has(k)), h1.j.horas_meta);
  const g2 = await W.post('/obra', { action: 'tablero_horas_guardar', token: await tok(ADMIN, 'admin'), horas: horasFalsas(3), archivo: 'otro.xlsx' });
  ok('ADMIN también guarda (version 2, pisa la anterior)', g2.j && g2.j.ok === true && g2.j.version === 2, g2.j);
  const grande = horasFalsas(5200), nG = JSON.stringify(grande).length;
  const gG = await W.post('/obra', { action: 'tablero_horas_guardar', token: await tok(JEFE, 'jefe'), horas: grande, archivo: 'grande.xlsx' });
  const hG = await W.get('/obra', { action: 'tablero_vivo' });
  ok('GRANDE (' + grande.partes.length + ' partes, ' + nG + ' caracteres, bajo el MAX_BODY de 1 MB): se guarda y se lee igual', gG.j && gG.j.ok === true && JSON.stringify(hG.j.horas) === JSON.stringify(grande), gG.j && (gG.j.error || gG.j.version));
  const enorme = horasFalsas(8000);
  const gE = await W.post('/obra', { action: 'tablero_horas_guardar', token: await tok(JEFE, 'jefe'), horas: enorme, archivo: 'enorme.xlsx' });
  ok('> 1 MB (' + JSON.stringify(enorme).length + ' caracteres): 413 {error:payload, campo:tamano} del Worker, sin tocar lo guardado', gE.status === 413 && gE.j && gE.j.campo === 'tamano', gE.status);
  if (args.horas){
    const gR = await W.post('/obra', { action: 'tablero_horas_guardar', token: await tok(JEFE, 'jefe'), horas, archivo });
    const hR = await W.get('/obra', { action: 'tablero_vivo' });
    ok('las horas REALES quedan guardadas y tablero_vivo las devuelve idénticas', gR.j && gR.j.ok === true && JSON.stringify(hR.j.horas) === JSON.stringify(horas), gR.j && gR.j.error);
  }
  const logs = await q(`SELECT action, count(*)::int AS n, count(*) FILTER (WHERE usuario <> '')::int AS con FROM log WHERE action IN ('tablero_vivo','tablero_horas_guardar') GROUP BY action ORDER BY action`);
  ok('LOG: ninguna fila de tablero_vivo (tampoco con token); tablero_horas_guardar sí, con usuario', logs.length === 1 && logs[0].action === 'tablero_horas_guardar' && logs[0].con === logs[0].n, logs);

  /* 7 · 008: idempotencia, semillas, permisos; BD sin 008 */
  titulo('7 · 008 idempotente, sin resucitar semillas, permisos; BD sin 008');
  async function foto(){
    const o = {};
    for (const t of ['tablero_mapeo', 'tablero_horas']) o[t] = (await q(`SELECT to_jsonb(x)::text AS j FROM ${t} x ORDER BY 1`)).map(r => r.j);
    o.vista = (await q(`SELECT pg_get_viewdef('tablero_data_campo'::regclass, true) AS d`))[0].d;
    o.clases = await q(`SELECT relname, relrowsecurity, relacl::text AS acl, obj_description(oid, 'pg_class') AS c FROM pg_class WHERE relname IN ('tablero_mapeo','tablero_horas','tablero_data_campo') ORDER BY 1`);
    o.ver = await q(`SELECT version, aplicado_ts::text AS ts, nota FROM esquema_version ORDER BY version`);
    return JSON.stringify(o);
  }
  const f0 = await foto(); await aplicar('008_tablero_vivo.sql');
  ok('segunda pasada: mapeo, horas, vista, RLS, ACL y esquema_version idénticos', f0 === await foto());
  await q(`DELETE FROM tablero_mapeo WHERE campo = 'pre'`);
  await q(`UPDATE tablero_mapeo SET orden = 99, version = version + 1, editado_por = 'jefe' WHERE campo = 'apr'`);
  await aplicar('008_tablero_vivo.sql');
  const m2 = await q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE campo = 'pre')::int AS pre, max(orden) FILTER (WHERE campo = 'apr')::int AS apr FROM tablero_mapeo`);
  ok('re-aplicar 008 NO resucita la fila borrada (préstamo) ni pisa la editada (orden 99)', m2[0].n === 8 && m2[0].pre === 0 && m2[0].apr === 99, m2[0]);
  const sinPre = await tableroVivoLeer({ sql, memo: {}, pet: { t0: Date.now(), log: null } }, {});
  ok('sin la fila del préstamo, el préstamo deja de sumar (el mapeo manda): pre = 0 en todos los días', sinPre.ok === true && sinPre.dias.every(d => d.pre === 0), sinPre.dias.filter(d => d.pre).length);
  await q(`INSERT INTO tablero_mapeo (obra_id, descripcion, uf, campo, orden) VALUES ('tm2sur', 'Excavación en material común de préstamos', '*', 'pre', 2)`);
  await q(`UPDATE tablero_mapeo SET orden = 1, version = 0, editado_por = '' WHERE campo = 'apr'`);
  await sql.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    GRANT ALL ON tablero_mapeo, tablero_horas, tablero_data_campo TO anon, authenticated;`);
  await aplicar('008_tablero_vivo.sql');
  const priv = async (rol, obj) => (await q(`SELECT has_table_privilege($1, $2, 'SELECT') AS s, has_table_privilege($1, $2, 'INSERT') AS i`, [rol, obj]))[0];
  const malP = [];
  for (const r of ['anon', 'authenticated']) for (const o of ['tablero_mapeo', 'tablero_horas', 'tablero_data_campo']){ const p = await priv(r, o); if (p.s || p.i) malP.push(r + ':' + o); }
  ok('con anon/authenticated (permisos por defecto de Supabase): re-aplicar 008 les quita las 2 tablas y la vista', malP.length === 0, malP);
  const { sql: sql2 } = await abrirPglite();
  for (const f of migraciones.filter(f => f < '008')) await sql2.exec(fs.readFileSync(path.join(SQL_DIR, f), 'utf8'));
  const c2 = () => ({ sql: sql2, memo: {}, pet: { t0: Date.now(), log: null } });
  const sv = await tableroVivoLeer(c2(), {}), sp = await proyeccionLeer(c2(), {}, { ok: true, usuario: JEFE, rol: 'jefe' });
  ok('BD sin 008: tablero_vivo ok:false «falta aplicar …008_tablero_vivo.sql» (el Tablero cae a la foto); proyeccion sigue ok (no depende de 008)',
    sv.ok === false && /008_tablero_vivo\.sql/.test(sv.error) && sp.ok === true && !('conciliacion' in sp), [sv, Object.keys(sp)]);
  // D185: orden de despliegue de OPERACIONES §16 (008 en el paso 0, 006 después): con 008 y SIN 006, el Tablero ya
  // calcula en vivo con FC_RESPALDO y proy = null + proy_error (cae a sus constantes), no «falta 008».
  const { sql: sql3 } = await abrirPglite();
  for (const f of migraciones.filter(f => f < '009' && !f.startsWith('006'))) await sql3.exec(fs.readFileSync(path.join(SQL_DIR, f), 'utf8'));
  await sql3.unsafe(`INSERT INTO data (obra_id, id_registro, fecha, descripcion, unidad_funcional, largo, cantidad) VALUES ('tm2sur', 'v185-sin006', '2026-09-01', 'Subbase Granular', 'UF1', 13, 10)`);
  const s6 = await tableroVivoLeer({ sql: sql3, memo: {}, pet: { t0: Date.now(), log: null } }, {});
  ok('BD con 008 y SIN 006: tablero_vivo ok:true en vivo, fc_dias = 1.3 (FC_RESPALDO), proy null + proy_error «La Proyección todavía no está…»',
    s6.ok === true && s6.fc_dias === 1.3 && s6.proy === null && /Proyección todavía no está/.test(s6.proy_error || '') && s6.dias.length === 1 && rel(s6.dias[0].sub / s6.fc_dias, 10) < 1e-12, s6);

  console.log('\n' + casos + ' comprobaciones · ' + fallos + ' fallo(s)');
  process.exit(fallos ? 1 : 0);
}
main().catch(err => { console.error('La verificación no pudo correr: ' + (err && err.stack || err)); process.exit(2); });
