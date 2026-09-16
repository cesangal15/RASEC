#!/usr/bin/env node
/**
 * contrato_local.js — el arnés de CONTRATO (backend/pruebas/contrato) contra el backend NUEVO (4.01, D180),
 * en local y sin red: Postgres en memoria (PGlite) + esquema (todos los worker/sql/0*.sql, en orden) +
 * backfill de los volcados reales + semillas del arnés + el Worker real.
 *
 *   node worker/pruebas/contrato_local.js                                   # volcados más recientes de C:\Galca\volcado
 *   node worker/pruebas/contrato_local.js --solo=parte --verboso            # solo un módulo del arnés
 *   node worker/pruebas/contrato_local.js --vm --solo=parte                 # /obra y /asistencias en vm (.gs) mientras no estén portados
 *   node worker/pruebas/contrato_local.js --volcado="C:\Galca\volcado\2026-09-16_0027_obra" --volcado-asis="C:\Galca\volcado\<sello>_asistencias"
 *   node worker/pruebas/contrato_local.js --servir                          # solo levanta el servidor (para las pantallas)
 *   node worker/pruebas/contrato_local.js --sin-semillas                    # solo los volcados reales (sin semillas.js)
 *
 * Opciones: --volcado=<carpeta *_obra> · --volcado-asis=<carpeta *_asistencias> (si no hay, se omite) ·
 *           --sin-semillas · --vm · --solo=obra,asistencias,parte (también manda al arnés) · --caso=<regex> ·
 *           --verboso · --servir · --puerto=8788 · --viaObra (el Parte por /obra?mod=parte).
 *
 * Cómo está armado:
 *   1. PGlite: se aplican worker/sql/001_esquema.sql, 002_fases_3_4.sql… (todos los 0*.sql, ordenados).
 *   2. Backfill: backfill_parte.js + backfill_obra.js con el volcado de obra, backfill_asistencias.js con el de
 *      asistencias (si existe). Sin LOG. Luego semillas_sql.js vuelca las hojas de semillas.js ENCIMA
 *      (ON CONFLICT DO NOTHING; usuarios DO UPDATE: admin/1234, angel/clave-angel… en claro), para que estén los
 *      datos que los casos vm asumen (75781 en personal, ANGEL, EX01/VOL048/MO004, NNM180, PARTE_*).
 *   3. Servidor: TODAS las rutas (/obra, /asistencias, /parte y /prueba/*) van a src/index.js (manejar) con
 *      BACKEND_*=db, AUTH_SECRETO=SECRETO_BANCO, AUTH_V=1, rate limit desactivado y `__dbPrueba` = PGlite. Es el
 *      MISMO código que corre en Cloudflare: CORS, tamaño, conmutador, auth.js (login), api/obra.js,
 *      api/asistencias.js, api/parte.js, LOG. Con --vm, /obra y /asistencias (salvo mod=parte) van a los .gs
 *      reales en `vm` (arnes.js + semillas.js), que emiten el token con el mismo SECRETO_BANCO.
 *   4. Lanza `correr.js --url=http://127.0.0.1:<puerto> --solo=<--solo o obra,asistencias,parte> --escribir
 *      --usuario=admin --clave=1234 --perfil.capataz=angel:clave-angel --perfil.jefe=… --perfil.residente=…
 *      --perfil.encargado=…` (los perfiles existen porque semillar() carga USUARIOS de semillas.js).
 * Sale con el código del arnés (0 = verde). No toca Google, Cloudflare ni Supabase.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { abrirPglite } from './pglite.js';
import { semillar } from './semillas_sql.js';
import { backfillParte } from '../sql/backfill_parte.js';
import { backfillObra } from '../sql/backfill_obra.js';
import { backfillAsistencias } from '../sql/backfill_asistencias.js';
import { manejar } from '../src/index.js';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, '..', '..');
const SQL_DIR = path.join(AQUI, '..', 'sql');
const { apiVm, SECRETO_BANCO } = require(path.join(REPO, 'backend', 'pruebas', 'contrato', 'arnes.js'));
const { semillas } = require(path.join(REPO, 'backend', 'pruebas', 'contrato', 'semillas.js'));

const args = {}; process.argv.slice(2).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });

// Credenciales con que se lanza el arnés: las de USUARIOS en semillas.js (en claro).
const PERFILES = { capataz: 'angel:clave-angel', jefe: 'jefe:clave-jefe', residente: 'residente:clave-res', encargado: 'encargado:clave-enc' };

function volcadoMasReciente(sufijo){
  const raiz = 'C:\\Galca\\volcado';
  if (!fs.existsSync(raiz)) return '';
  const dirs = fs.readdirSync(raiz).filter(d => new RegExp(sufijo + '$').test(d)).sort();
  return dirs.length ? path.join(raiz, dirs[dirs.length - 1]) : '';
}
function resumen(titulo, res){
  console.log('  ' + titulo);
  res.forEach(r => console.log('    ' + r.tabla.padEnd(18) + ' insertadas ' + String(r.insertadas).padStart(5) + (r.saltadas ? ' · saltadas ' + r.saltadas : '') + (r.avisos.length ? ' · ' + r.avisos.length + ' aviso(s): ' + r.avisos[0] : '')));
}

async function main(){
  const volcado = args.volcado ? path.resolve(String(args.volcado)) : volcadoMasReciente('_obra');
  if (!volcado || !fs.existsSync(volcado)) { console.error('No hay volcado de obra: pasa --volcado=<carpeta con los CSV de obra>'); process.exit(2); }
  const volcadoAsis = args['volcado-asis'] ? path.resolve(String(args['volcado-asis'])) : volcadoMasReciente('_asistencias');

  // 1. Postgres en memoria + esquema (todos los 0*.sql en orden)
  const { sql } = await abrirPglite();
  const migraciones = fs.readdirSync(SQL_DIR).filter(f => /^0\d+_.*\.sql$/.test(f)).sort();
  for (const f of migraciones) await sql.exec(fs.readFileSync(path.join(SQL_DIR, f), 'utf8'));
  console.log('PGlite · esquema aplicado: ' + migraciones.join(', '));

  // 2. Backfill real (parte → obra → asistencias) y semillas encima
  resumen('backfill del Parte · ' + volcado, await backfillParte(sql, volcado, {}));
  resumen('backfill de obra · ' + volcado, await backfillObra(sql, volcado, {}));
  if (volcadoAsis && fs.existsSync(volcadoAsis)) resumen('backfill de asistencias · ' + volcadoAsis, await backfillAsistencias(sql, volcadoAsis, {}));
  else console.log('  (sin volcado de asistencias en disco: --volcado-asis=<carpeta *_asistencias>; se sigue solo con semillas)');
  if (!args['sin-semillas']) resumen('semillas de backend/pruebas/contrato/semillas.js (ON CONFLICT DO NOTHING; usuarios en claro)', await semillar(sql, semillas(), {}));

  // 3. Servidor: todo al Worker real contra la BD; con --vm, /obra y /asistencias a los .gs en vm
  const api = args.vm ? apiVm(semillas()) : null;
  const envWorker = { ALLOWED_ORIGINS: 'https://tm2.galca.app',
    BACKEND_OBRA: 'db', BACKEND_ASISTENCIAS: 'db', BACKEND_PARTE: 'db',
    BACKEND_OBRA_PRUEBA: 'db', BACKEND_ASISTENCIAS_PRUEBA: 'db', BACKEND_PARTE_PRUEBA: 'db',
    AUTH_SECRETO: SECRETO_BANCO, AUTH_V: '1', RATE_LIMIT_POR_MIN: '100000', __dbPrueba: () => sql };
  const ctx = { waitUntil: (p) => { Promise.resolve(p).catch(() => {}); } };
  const VM = { '/obra': 'obra', '/asistencias': 'asistencias', '/prueba/obra': 'obra', '/prueba/asistencias': 'asistencias' };
  const puerto = Number(args.puerto || 8788);
  const servidor = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1:' + puerto);
    const responder = (status, obj, texto) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(texto !== undefined ? texto : JSON.stringify(obj)); };
    if (req.method === 'OPTIONS'){ res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST' }); return res.end(); }
    let cuerpo = ''; req.on('data', d => { cuerpo += d; }); req.on('end', async () => {
      const esParte = (u.searchParams.get('mod') || '').toLowerCase() === 'parte' || /"mod"\s*:\s*"parte"/i.test(cuerpo);
      const destino = api && !esParte ? VM[u.pathname] : null;   // mod=parte sobre /obra también va al Worker (como revision-maquinaria.js)
      if (destino) {
        const params = {}; u.searchParams.forEach((v, k) => { params[k] = v; });
        try {
          if (req.method === 'GET') return responder(200, await api[destino].get(params));
          let body; try { body = JSON.parse(cuerpo || '{}'); } catch (e) { return responder(200, { ok: false, error: 'JSON inválido' }); }
          return responder(200, await api[destino].post(body));
        } catch (e) { return responder(500, { ok: false, error: String(e) }); }
      }
      // el Worker de verdad
      const init = { method: req.method, headers: { 'Content-Type': req.headers['content-type'] || 'text/plain;charset=utf-8', 'CF-Connecting-IP': '127.0.0.1' } };
      if (req.method === 'POST') { init.body = cuerpo; init.headers['Content-Length'] = String(Buffer.byteLength(cuerpo)); }
      try {
        const r = await manejar(new Request(u.toString(), init), envWorker, ctx);
        responder(r.status, null, await r.text());
      } catch (e) { responder(500, { ok: false, error: 'worker: ' + String(e && e.stack || e) }); }
    });
  });
  await new Promise(r => servidor.listen(puerto, '127.0.0.1', r));
  console.log('Servidor de banco en http://127.0.0.1:' + puerto + '  (' + (api ? '/obra /asistencias → vm · /parte → Worker + PGlite' : '/obra /asistencias /parte → Worker + PGlite') + ' · admin / 1234)');
  if (args.servir) return;

  // 4. El arnés de contrato, como se correrá contra api.galca.app/prueba
  const cli = [path.join(REPO, 'backend', 'pruebas', 'contrato', 'correr.js'), '--url=http://127.0.0.1:' + puerto,
    '--parte=http://127.0.0.1:' + puerto + (args.viaObra ? '/obra' : '/parte'),
    '--solo=' + (args.solo || 'obra,asistencias,parte'), '--escribir', '--usuario=admin', '--clave=1234'];
  Object.keys(PERFILES).forEach(p => cli.push('--perfil.' + p + '=' + PERFILES[p]));
  if (args.verboso) cli.push('--verboso'); if (args.caso) cli.push('--caso=' + args.caso);
  const hijo = spawn(process.execPath, cli, { stdio: 'inherit' });
  const codigo = await new Promise(r => hijo.on('exit', r));
  servidor.close();
  process.exit(codigo);
}
main().catch(err => { console.error('El banco no pudo arrancar: ' + (err && err.stack || err)); process.exit(2); });
