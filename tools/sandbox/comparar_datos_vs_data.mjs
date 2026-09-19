#!/usr/bin/env node
/**
 * tools/sandbox/comparar_datos_vs_data.mjs — ¿cuánto VARÍA el Tablero al pasar de la hoja DATOS del Excel a la
 * DATA de Galca? (V3-11 Fases B+C · D185). INFORMATIVA: siempre sale con 0 si pudo comparar.
 *
 * Desde D185 el Tablero ya no lee la hoja DATOS: toda la producción (todos los periodos) sale de la DATA de Galca,
 * plegada por fecha y por el MAPEO (GET ?action=tablero_vivo). El avance (decisión final del dueño, 19-sep-2026,
 * «como tenemos lo de Proyección») = producción base certificada de la Proyección (base_acum, hasta el cierre del
 * acta base) + Σ compacto con fecha ≥ base_corte, ÷ contrato, con la excavación común = aprovechable + no
 * aprovechable y el préstamo aparte; la misma regla en los dos caminos del motor. Este guion enseña al dueño, periodo a periodo y partida a
 * partida, en qué se separa lo de antes (DATOS) de lo de ahora (DATA), con el MISMO motor que corre en la página
 * (tablero-produccion.js, cargado en Node con tablero-xlsx.js):
 *
 *   1. lee tu copia del Excel de producción (hojas DATOS y CALCULOS). Nunca la escribe (D24);
 *   2. pide ?action=tablero_vivo (la lectura pública del Tablero en vivo) a una Galca: por defecto a un Postgres EN
 *      MEMORIA (PGlite) con las migraciones worker/sql/0*.sql, la DATA real sembrada (tools/sandbox/data.real.csv,
 *      como el sandbox) y el WORKER REAL; o, con --url, al sandbox que tengas levantado (con lo que hayas corregido
 *      en la Revisión de DATA);
 *   3. corre construir(Excel) —camino de archivos, con la proyección de Galca— y construir(en vivo) y compara, en
 *      m³ COMPACTOS: por periodo y partida (excavación total, común aprovechable, préstamo, no aprovechable,
 *      terraplén, subbase y base), los días registrados y, al final, el AVANCE contra el contrato con la regla
 *      final (base certificada + lo de después del corte): con DATOS del Excel → con la DATA de Galca. Comprueba
 *      además, por su cuenta, que el avance en vivo = base_acum + Σ de los días con f ≥ base_corte ÷ fc (✓/✗).
 *
 * USO (desde la raíz del repo, en una sola línea):
 *   node tools/sandbox/comparar_datos_vs_data.mjs --excel="C:/…/prueba-tablero/TM2_SUR_REPORTE_nuevo.xlsx"
 *   node tools/sandbox/comparar_datos_vs_data.mjs --excel=… --url=http://127.0.0.1:8099
 *
 * OPCIONES:
 *   --excel=<xlsx>   copia del Excel de producción (OBLIGATORIO; hoja DATOS). Se lee, nunca se escribe.
 *   --url=<base>     sandbox ya levantado (sin él: PGlite en proceso). La API es <base>/obra. Nunca escribe.
 *   --data=<csv>     con PGlite: otro CSV de DATA (por defecto tools/sandbox/data.real.csv, el del sandbox).
 *   --min=1          se listan las partidas de un periodo que difieren en al menos esto (m³ compactos).
 *   --todo           lista también los periodos y partidas iguales.
 *
 * SALIDA: 0 = comparó (haya o no diferencias: es un informe); 2 = no pudo comparar (archivo, servidor o migración).
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, '..', '..');

const args = {};
process.argv.slice(2).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });
const MIN = Number(args.min == null ? 1 : args.min);

function falla(msg){ console.error('\n✗ ' + msg + '\n'); process.exit(2); }
const seg = (t0) => ((Date.now() - t0) / 1000).toFixed(1) + ' s';
const f0 = (v) => Math.round(v || 0).toLocaleString('es-CO');
const f2 = (v) => (v || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const conSigno = (v) => (v > 0.005 ? '+' : (v < -0.005 ? '−' : '')) + f2(Math.abs(v));
const pct = (d, base) => base ? (d > 0 ? '+' : (d < 0 ? '−' : '')) + Math.abs(d / base * 100).toFixed(1) + ' %' : (d ? 'nuevo' : '');

/* ---------- 1. el motor del tablero, tal cual lo corre el navegador ---------- */
function cargarMotor(){
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(REPO, 'tablero-xlsx.js'), 'utf8'), ctx, { filename: 'tablero-xlsx.js' });
  const src = fs.readFileSync(path.join(REPO, 'tablero-produccion.js'), 'utf8');
  const corte = src.indexOf('const TM2_EMBEBIDO');       // el motor es todo lo que va antes de la foto embebida
  if (corte < 0) falla('tablero-produccion.js no tiene la marca «const TM2_EMBEBIDO»: no sé dónde acaba el motor.');
  vm.runInContext(src.slice(0, corte) + '\n;this.MOTOR = MOTOR;', ctx, { filename: 'tablero-produccion.js (motor)' });
  if (typeof ctx.MOTOR.proyDeGalca !== 'function' || !/vivo/.test(ctx.MOTOR.construir.toString()))
    falla('el motor de tablero-produccion.js no trae el camino en vivo (¿versión anterior a D185?).');
  return ctx;
}

/* ---------- 2. Galca: ?action=tablero_vivo ---------- */
async function leerJson(r){ const t = await r.text(); try { return JSON.parse(t); } catch (e) { return { ok: false, error: 'respuesta ' + r.status + ' no JSON: ' + t.slice(0, 160) }; } }
function clienteHttp(base){
  const api = base.replace(/\/+$/, '') + '/obra';
  return { donde: api, async get(q){ const u = new URL(api); Object.keys(q).forEach(k => u.searchParams.set(k, String(q[k]))); return leerJson(await fetch(u)); } };
}

// Lector CSV mínimo con comillas, el mismo que usa servidor.mjs para sembrar el sandbox.
function parseCsv(txt){
  const lineas = txt.replace(/\r/g, '').split('\n').filter(l => l.length);
  const cab = lineas.shift().split(',');
  return lineas.map(l => {
    const celdas = []; let cur = '', dentro = false;
    for (let i = 0; i < l.length; i++){ const c = l[i];
      if (c === '"'){ if (dentro && l[i + 1] === '"'){ cur += '"'; i++; } else dentro = !dentro; }
      else if (c === ',' && !dentro){ celdas.push(cur); cur = ''; }
      else cur += c;
    }
    celdas.push(cur);
    const o = {}; cab.forEach((k, i) => o[k.trim()] = (celdas[i] || '').trim()); return o;
  });
}
const numOrNull = (v) => (v === undefined || v === null || String(v).trim() === '') ? null : Number(String(v).replace(',', '.'));

/* Galca en memoria sembrada como el sandbox (servidor.mjs): esquema, usuarios, catálogo de actividades, la DATA
   real y, con ella cargada, las migraciones que COMPLETAN datos (005 clima, 007 ACTA/ESPESOR/FC/CANTIDAD). */
async function clientePglite(){
  const SQL_DIR = path.join(REPO, 'worker', 'sql');
  const migraciones = fs.readdirSync(SQL_DIR).filter(f => /^0\d+_.*\.sql$/.test(f)).sort();
  if (!migraciones.some(f => /^008_/.test(f))) falla('Falta worker/sql/008_tablero_vivo.sql (D185): sin ella Galca no pliega la DATA para el Tablero.');
  const csvData = path.resolve(String(args.data && args.data !== true ? args.data : path.join(AQUI, 'data.real.csv')));
  if (!fs.existsSync(csvData)) falla('No existe el CSV de DATA: ' + csvData);
  let abrirPglite, semillar, manejar;
  try {
    ({ abrirPglite } = await import(pathToFileURL(path.join(REPO, 'worker', 'pruebas', 'pglite.js')).href));
    ({ semillar } = await import(pathToFileURL(path.join(REPO, 'worker', 'pruebas', 'semillas_sql.js')).href));
    ({ manejar } = await import(pathToFileURL(path.join(REPO, 'worker', 'src', 'index.js')).href));
  } catch (e) {
    falla('No pude cargar PGlite o el Worker (' + e.message + '). ¿Hiciste «cd worker && npm install»? O usa --url con el sandbox levantado.');
  }
  const { sql } = await abrirPglite();
  for (const f of migraciones) await sql.exec(fs.readFileSync(path.join(SQL_DIR, f), 'utf8'));
  const { semillas } = require(path.join(REPO, 'backend', 'pruebas', 'contrato', 'semillas.js'));
  await semillar(sql, semillas(), {});
  const csvItems = path.join(AQUI, 'base_items.real.csv');
  if (fs.existsSync(csvItems)){
    await sql`DELETE FROM base_items WHERE obra_id='tm2sur'`;
    for (const f of parseCsv(fs.readFileSync(csvItems, 'utf8'))){
      if (!(f.cc || '').trim()) continue;
      await sql`INSERT INTO base_items (obra_id, cc, descripcion, unidad, capitulo, grupo, uf, proyecto, orden)
        VALUES ('tm2sur', ${f.cc}, ${f.descripcion || ''}, ${f.unidad || ''}, ${f.capitulo || ''}, ${f.grupo || ''}, ${f.uf || ''}, ${f.proyecto || ''}, ${parseInt(f.orden, 10) || 0})
        ON CONFLICT (obra_id, cc, descripcion) DO NOTHING`;
    }
  }
  await sql`DELETE FROM data WHERE obra_id='tm2sur'`;
  let n = 0;
  for (const f of parseCsv(fs.readFileSync(csvData, 'utf8'))){
    if (!(f.fecha || '').trim() || !(f.id_registro || '').trim()) continue;
    await sql`INSERT INTO data (obra_id, fecha, orden, grupo, centro_de_costo, capitulo, descripcion, unidad_funcional,
        proyecto, elemento, abs_inicial, abs_final, liberacion, acta, unidad_medida, largo, espesor, fc, cantidad,
        observacion, id_registro, "timestamp", capataz, rol, actividad, pk_inicial, pk_final, area, clima)
      VALUES ('tm2sur', ${f.fecha}, ${f.orden || ''}, ${f.grupo || ''}, ${f.centro_de_costo || ''}, ${f.capitulo || ''}, ${f.descripcion || ''},
        ${f.unidad_funcional || ''}, ${f.proyecto || ''}, ${f.elemento || ''}, ${f.abs_inicial || ''}, ${f.abs_final || ''}, ${f.liberacion || ''},
        ${f.acta || ''}, ${f.unidad_medida || ''}, ${numOrNull(f.largo)}, ${numOrNull(f.espesor)}, ${numOrNull(f.fc)}, ${numOrNull(f.cantidad)},
        ${f.observacion || ''}, ${f.id_registro}, now(), '', '', ${f.descripcion || ''}, ${f.abs_inicial || ''}, ${f.abs_final || ''}, '', '')
      ON CONFLICT (obra_id, id_registro) DO NOTHING`;
    n++;
  }
  for (const f of ['005_data_clima.sql', '007_data_completa.sql'].filter(f => migraciones.indexOf(f) >= 0))
    await sql.exec(fs.readFileSync(path.join(SQL_DIR, f), 'utf8'));
  const env = { BACKEND_OBRA: 'db', BACKEND_ASISTENCIAS: 'db', BACKEND_PARTE: 'db', AUTH_SECRETO: 'comparador-local',
                AUTH_V: '1', RATE_LIMIT_POR_MIN: '100000', __dbPrueba: () => sql };
  const ctxW = { waitUntil: (p) => { Promise.resolve(p).catch(() => {}); } };
  return {
    donde: 'PGlite en memoria · ' + migraciones.join(', ') + ' · DATA ' + n + ' filas de ' + path.relative(REPO, csvData) + ' · Worker real',
    async get(q){
      const u = new URL('http://127.0.0.1/obra'); Object.keys(q).forEach(k => u.searchParams.set(k, String(q[k])));
      return leerJson(await manejar(new Request(u.toString(), { method: 'GET', headers: { 'CF-Connecting-IP': '127.0.0.1' } }), env, ctxW));
    }
  };
}

/* ---------- 3. comparación ---------- */
// Lo que se compara de cada periodo, en compacto (el motor ya divide por el fc).
const PARTIDAS = [
  ['excavacion', 'Excavación total', p => p.a.excavacion.prod],
  ['apr',        'Común aprovechable', p => p.split.apr],
  ['pre',        'Préstamo', p => p.split.pre],
  ['nap',        'No aprovechable', p => p.split.nap],
  ['terraplen',  'Terraplén', p => p.a.terraplen.prod],
  ['subbase',    'Subbase', p => p.a.subbase.prod],
  ['base',       'BTC / Base', p => p.a.base.prod]
];

async function main(){
  if (!args.excel || args.excel === true) falla('Falta --excel=<copia del Excel de producción>. Ver la cabecera de este archivo.');
  const t0 = Date.now();
  const ctx = cargarMotor(), M = ctx.MOTOR;
  const archivo = path.resolve(String(args.excel));
  if (!fs.existsSync(archivo)) falla('No existe el archivo: ' + archivo);
  console.log('\n· Excel de producción: ' + archivo);
  const wp = ctx.XLSX.read(fs.readFileSync(archivo), { type: 'buffer', cellDates: true, sheets: ['DATOS', 'CALCULOS'] });
  if (!wp.Sheets.DATOS) falla('El Excel no trae la hoja DATOS.');
  console.log('  hoja DATOS ✓  [' + seg(t0) + ']');

  const cli = args.url ? clienteHttp(String(args.url)) : await clientePglite();
  console.log('· Galca: ' + cli.donde + '  [' + seg(t0) + ']');
  const j = await cli.get({ action: 'tablero_vivo' });
  if (!j || j.ok !== true || !Array.isArray(j.dias)) falla('GET ?action=tablero_vivo no devolvió la DATA: ' + JSON.stringify(j).slice(0, 300));
  let proy;
  try { proy = M.proyDeGalca(Object.assign({ ok: true, fuente: 'galca' }, j.proy || {})); }
  catch (e) { falla('La proyección de Galca no sirve al Tablero: ' + e.message); }
  console.log('  ' + j.dias.length + ' días de DATA (' + j.dias[0].f + ' … ' + j.dias[j.dias.length - 1].f + ') · DATA al ' + j.datos_hasta + ' · fc ' + proy.fc);

  // Mismo motor, dos entradas: DATOS (camino de archivos, con la proyección de Galca) y la DATA en vivo.
  const E = M.construir(wp, null, proy);
  const G = M.construir({ vivo: true, dias: j.dias, fc: (j.fc_dias != null ? j.fc_dias : j.fc) }, { H: null }, proy);
  const pe = {}, pg = {}; E.per.forEach(p => pe[p.p] = p); G.per.forEach(p => pg[p.p] = p);
  const periodos = [...new Set(Object.keys(pe).concat(Object.keys(pg)))].sort();

  console.log('\n── Producción por periodo (m³ COMPACTOS): DATOS del Excel → DATA de Galca ' + '─'.repeat(12));
  console.log('   (se listan las partidas que difieren en ≥ ' + MIN + ' m³' + (args.todo ? '; --todo: también las iguales' : '') + ')');
  const tot = {}; PARTIDAS.forEach(([k]) => tot[k] = { e: 0, g: 0 });
  let iguales = 0;
  for (const p of periodos){
    const a = pe[p], b = pg[p];
    const dias = 'días DATOS ' + (a ? a.d.length : 0) + ' / DATA ' + (b ? b.d.length : 0);
    const lin = [];
    for (const [k, nom, get] of PARTIDAS){
      const x = a ? get(a) : 0, y = b ? get(b) : 0, d = y - x;
      tot[k].e += x; tot[k].g += y;
      if (Math.abs(d) >= MIN || args.todo) lin.push('     ' + nom.padEnd(20) + f0(x).padStart(10) + ' → ' + f0(y).padStart(10) + '   ' + conSigno(d).padStart(12) + '  ' + pct(d, x));
    }
    if (!lin.length){ iguales++; if (!args.todo) continue; }
    console.log('  ' + p + '  ·  ' + dias + (lin.length ? '' : '  ·  igual'));
    lin.forEach(l => console.log(l));
  }
  if (iguales && !args.todo) console.log('  (' + iguales + ' periodo(s) sin diferencias de ≥ ' + MIN + ' m³ no se listan)');

  console.log('\n── Total de todos los periodos (m³ compactos) ' + '─'.repeat(38));
  for (const [k, nom] of PARTIDAS){ const { e, g } = tot[k]; console.log('  ' + nom.padEnd(20) + f0(e).padStart(11) + ' → ' + f0(g).padStart(11) + '   ' + conSigno(g - e).padStart(13) + '  ' + pct(g - e, e)); }

  // D185 · V3-11 (decisión final del dueño, 19-sep-2026): la MISMA regla en los dos caminos del motor — base
  // certificada + lo posterior al corte (excavación común = aprovechable + no aprovechable; préstamo aparte).
  console.log('\n── Avance contra el contrato (regla final D185): con DATOS del Excel → con la DATA de Galca ' + '─'.repeat(2));
  console.log('   producción base certificada (acta ' + (proy.acta_base || '—') + ', hasta el cierre) + lo de fecha ≥ ' + proy.base_corte
    + ' ÷ contrato; excavación común = aprovechable + no aprovechable; préstamo aparte');
  for (const a of E.avance){
    const b = G.avance.find(x => x.k === a.k) || { eje: 0, plan: a.plan };
    const pc = (v, pl) => pl ? (v / pl * 100).toFixed(1) + ' %' : '—';
    console.log('  ' + String(b.n || a.n).padEnd(20) + f0(a.eje).padStart(11) + ' (' + pc(a.eje, a.plan).padStart(7) + ')  →  ' + f0(b.eje).padStart(11) + ' (' + pc(b.eje, b.plan).padStart(7) + ')   ' +
                conSigno(b.eje - a.eje).padStart(13) + '   de ' + f0(b.plan) + ' m³ de contrato');
  }
  // Comprobación independiente del avance en vivo: base_acum + Σ (f ≥ base_corte) ÷ fc de los días tal cual los trae Galca.
  const fcD = (j.fc_dias != null ? j.fc_dias : proy.fc), tras = (get) => j.dias.filter(d => d.f >= proy.base_corte).reduce((s, d) => s + get(d), 0) / fcD;
  const GET = { excavacion: d => (d.apr || 0) + (d.nap || 0), terraplen: d => d.ter || 0, subbase: d => d.sub || 0, base: d => d.bas || 0, prestamo: d => d.pre || 0 };
  const malAv = Object.keys(GET).filter(k => { const b = G.avance.find(x => x.k === k), esp = proy.base_acum[k] + tras(GET[k]);
    return !b || Math.abs(b.eje - esp) > 1e-9 * Math.max(1, Math.abs(esp)); });
  console.log('  ' + (malAv.length ? '✗ el avance en vivo NO es base + Σ desde el corte en: ' + malAv.join(', ')
    : '✓ avance en vivo = base_acum + Σ de los días con f ≥ ' + proy.base_corte + ' ÷ fc (las 5 partidas, error relativo < 1e-9)'));
  console.log('\n· Informativo: sale con 0.  [' + seg(t0) + ']\n');
  process.exit(0);
}
main().catch(e => falla('Error inesperado: ' + (e && e.stack || e)));
