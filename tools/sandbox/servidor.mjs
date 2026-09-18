#!/usr/bin/env node
/**
 * tools/sandbox/servidor.mjs — SANDBOX 100% LOCAL de la grilla (V3-08 / D181).
 *
 * Levanta, en tu PC y sin tocar nada real, TODO lo necesario para probar la grilla como si fuera la app:
 *   · Postgres EN MEMORIA (PGlite) con el esquema real (todos los worker/sql/0*.sql, incluida 003_grilla).
 *   · El WORKER REAL (worker/src/index.js) contra esa base — el MISMO código que corre en Cloudflare.
 *   · Las PANTALLAS reales (index.html, menu.html, jefe.html, grilla.html…) servidas desde el mismo puerto.
 *   · Sembrado con TUS SUBTRAMOS REALES (tools/sandbox/base_elementos.real.csv, sacados del Excel maestro)
 *     y usuarios de prueba para entrar (admin/1234, jefe/clave-jefe, residente/clave-res).
 *
 * No toca Supabase, ni Cloudflare, ni Google, ni tus datos de obra. Todo vive en memoria y se borra al
 * cerrar (Ctrl+C). Es desechable: reinícialo cuando quieras volver al estado inicial.
 *
 * USO:
 *   cd worker && npm install        # una vez: instala PGlite (dependencia de desarrollo)
 *   cd ..
 *   node tools/sandbox/servidor.mjs
 *   # abre http://127.0.0.1:8099  → entra con admin / 1234 → menú → «Grilla de catálogos»
 *
 * OPCIONES:
 *   --puerto=8099                 puerto (por defecto 8099)
 *   --base=<archivo.csv>          otro CSV de subtramos (encabezados: elemento,abs_inicio,abs_fin,uf,tipo,orden)
 *   --volcado=<carpeta *_obra>    en vez del CSV, carga la BASE (y el resto) de un volcado real de obra
 *
 * Cómo apunta la pantalla al Worker local: auth.js detecta que la página se sirve desde localhost y manda
 * la API al MISMO origen (este servidor). En producción (tm2.galca.app) ese modo NO se activa.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { abrirPglite } from '../../worker/pruebas/pglite.js';
import { semillar } from '../../worker/pruebas/semillas_sql.js';
import { backfillObra } from '../../worker/sql/backfill_obra.js';
import { manejar } from '../../worker/src/index.js';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, '..', '..');
const SQL_DIR = path.join(REPO, 'worker', 'sql');
const { semillas } = require(path.join(REPO, 'backend', 'pruebas', 'contrato', 'semillas.js'));

const args = {}; process.argv.slice(2).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });
const PUERTO = Number(args.puerto || 8099);
const SECRETO = 'sandbox-secreto-local';   // da igual cuál sea: el login firma y la puerta verifica con el mismo

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon',
  '.webmanifest':'application/manifest+json', '.woff2':'font/woff2', '.map':'application/json' };
const API_PATHS = ['/obra','/asistencias','/parte','/prueba/obra','/prueba/asistencias','/prueba/parte'];

function parseCsv(txt){
  const lineas = txt.replace(/\r/g,'').split('\n').filter(l => l.length);
  const cab = lineas.shift().split(',');
  return lineas.map(l => {
    // parser CSV mínimo (soporta comillas)
    const celdas = []; let cur = '', dentro = false;
    for (let i = 0; i < l.length; i++){ const c = l[i];
      if (c === '"'){ if (dentro && l[i+1] === '"'){ cur += '"'; i++; } else dentro = !dentro; }
      else if (c === ',' && !dentro){ celdas.push(cur); cur = ''; }
      else cur += c;
    }
    celdas.push(cur);
    const o = {}; cab.forEach((k, i) => o[k.trim()] = (celdas[i] || '').trim()); return o;
  });
}

async function cargarBaseElementosCsv(sql, archivo){
  const filas = parseCsv(fs.readFileSync(archivo, 'utf8'));
  await sql`DELETE FROM base_elementos WHERE obra_id='tm2sur'`;
  let n = 0;
  for (const f of filas){
    const orden = parseInt(f.orden, 10); if (!isFinite(orden)) continue;
    await sql`INSERT INTO base_elementos (obra_id, elemento, abs_inicio, abs_fin, uf, tipo, orden)
      VALUES ('tm2sur', ${f.elemento||''}, ${f.abs_inicio||''}, ${f.abs_fin||''}, ${f.uf||''}, ${f.tipo||''}, ${orden})
      ON CONFLICT (obra_id, orden) DO UPDATE SET elemento=EXCLUDED.elemento, abs_inicio=EXCLUDED.abs_inicio,
        abs_fin=EXCLUDED.abs_fin, uf=EXCLUDED.uf, tipo=EXCLUDED.tipo`;
    n++;
  }
  return n;
}

function servirEstatico(res, urlPath){
  let p = urlPath.split('?')[0];
  if (p === '/' || p === '') p = '/index.html';
  if (p === '/sw.js'){ res.writeHead(404); return res.end('sin service worker en el sandbox'); }  // evita caché stale en localhost
  const fp = path.join(REPO, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!fp.startsWith(REPO) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()){ res.writeHead(404); return res.end('no encontrado: ' + p); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(fp));
}

async function main(){
  // 1. Postgres en memoria + esquema (incluida 003_grilla.sql)
  const { sql } = await abrirPglite();
  const migraciones = fs.readdirSync(SQL_DIR).filter(f => /^0\d+_.*\.sql$/.test(f)).sort();
  for (const f of migraciones) await sql.exec(fs.readFileSync(path.join(SQL_DIR, f), 'utf8'));
  console.log('· Esquema aplicado: ' + migraciones.join(', '));

  // 2. Usuarios + catálogos base para poder ENTRAR (admin/1234, jefe, residente…)
  await semillar(sql, semillas(), {});

  // 3. Subtramos: TUS datos reales (CSV) o un volcado de obra
  if (args.volcado){
    const dir = path.resolve(String(args.volcado));
    if (!fs.existsSync(dir)){ console.error('No existe el volcado: ' + dir); process.exit(2); }
    await backfillObra(sql, dir, {});
    console.log('· Subtramos: cargados del volcado ' + dir);
  } else {
    const csv = args.base ? path.resolve(String(args.base)) : path.join(AQUI, 'base_elementos.real.csv');
    if (!fs.existsSync(csv)){ console.error('No existe el CSV de subtramos: ' + csv); process.exit(2); }
    const n = await cargarBaseElementosCsv(sql, csv);
    console.log('· Subtramos: ' + n + ' filas reales cargadas de ' + path.relative(REPO, csv));
  }

  // 4. Worker real contra la BD + pantallas en el mismo puerto
  const envWorker = { ALLOWED_ORIGINS: 'http://127.0.0.1:' + PUERTO + ',http://localhost:' + PUERTO,
    BACKEND_OBRA: 'db', BACKEND_ASISTENCIAS: 'db', BACKEND_PARTE: 'db',
    AUTH_SECRETO: SECRETO, AUTH_V: '1', RATE_LIMIT_POR_MIN: '100000', __dbPrueba: () => sql };
  const ctx = { waitUntil: (p) => { Promise.resolve(p).catch(() => {}); } };

  const servidor = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1:' + PUERTO);
    const esApi = API_PATHS.indexOf(u.pathname) >= 0;
    if (!esApi) return servirEstatico(res, req.url);
    let cuerpo = ''; req.on('data', d => { cuerpo += d; }); req.on('end', async () => {
      const init = { method: req.method, headers: { 'Content-Type': req.headers['content-type'] || 'text/plain;charset=utf-8',
        'CF-Connecting-IP': '127.0.0.1', 'Origin': req.headers.origin || ('http://127.0.0.1:' + PUERTO) } };
      if (req.method === 'POST') init.body = cuerpo;
      try {
        const r = await manejar(new Request(u.toString(), init), envWorker, ctx);
        const cabeceras = {}; r.headers.forEach((v, k) => cabeceras[k] = v);
        res.writeHead(r.status, cabeceras); res.end(await r.text());
      } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok:false, error:'worker: ' + String(e && e.stack || e) })); }
    });
  });
  await new Promise(r => servidor.listen(PUERTO, '127.0.0.1', r));
  console.log('\n  SANDBOX LISTO  →  http://127.0.0.1:' + PUERTO);
  console.log('  Entra con  admin / 1234  (o jefe / clave-jefe · residente / clave-res)');
  console.log('  Menú → «Grilla de catálogos», o directo http://127.0.0.1:' + PUERTO + '/grilla.html tras entrar.');
  console.log('  Ctrl+C para cerrar (todo se borra: es en memoria).\n');
}
main().catch(err => { console.error('El sandbox no pudo arrancar: ' + (err && err.stack || err)); process.exit(2); });
