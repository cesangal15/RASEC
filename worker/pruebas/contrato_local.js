#!/usr/bin/env node
/**
 * contrato_local.js — el arnés de CONTRATO (backend/pruebas/contrato) contra el backend NUEVO del Parte,
 * en local y sin red: Postgres en memoria (PGlite) + esquema 001 + backfill del volcado + el Worker real.
 *
 *   node worker/pruebas/contrato_local.js                                   # volcado más reciente de C:\Galca\volcado
 *   node worker/pruebas/contrato_local.js --volcado="C:\Galca\volcado\2026-09-15_2252_obra" --verboso
 *   node worker/pruebas/contrato_local.js --servir                          # solo levanta el servidor (para las pantallas)
 *
 * Cómo está armado:
 *   · /obra y /asistencias → los .gs reales en `vm` (arnes.js + semillas.js): es quien hace el LOGIN y emite el
 *     token con SECRETO_BANCO (D109), exactamente como el Apps Script de obra en producción.
 *   · /parte → src/index.js (manejar) con BACKEND_PARTE=db, AUTH_SECRETO=SECRETO_BANCO y `__dbPrueba` = PGlite.
 *     Es el MISMO código que corre en Cloudflare: CORS, rate limit, tamaño, conmutador, api/parte.js, LOG.
 *   · Luego lanza `correr.js --url=http://127.0.0.1:<puerto> --solo=parte --escribir --usuario=admin --clave=1234`.
 * Sale con el código del arnés (0 = verde). No toca Google, Cloudflare ni Supabase.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { abrirPglite } from './pglite.js';
import { backfillParte } from '../sql/backfill_parte.js';
import { manejar } from '../src/index.js';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, '..', '..');
const { apiVm, SECRETO_BANCO } = require(path.join(REPO, 'backend', 'pruebas', 'contrato', 'arnes.js'));
const { semillas } = require(path.join(REPO, 'backend', 'pruebas', 'contrato', 'semillas.js'));

const args = {}; process.argv.slice(2).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });

function volcadoMasReciente(){
  const raiz = 'C:\\Galca\\volcado';
  if (!fs.existsSync(raiz)) return '';
  const dirs = fs.readdirSync(raiz).filter(d => /_obra$/.test(d)).sort();
  return dirs.length ? path.join(raiz, dirs[dirs.length - 1]) : '';
}

async function main(){
  const volcado = args.volcado ? path.resolve(String(args.volcado)) : volcadoMasReciente();
  if (!volcado || !fs.existsSync(volcado)) { console.error('No hay volcado: pasa --volcado=<carpeta con los CSV de obra>'); process.exit(2); }

  // 1. Postgres en memoria + esquema + backfill
  const { sql } = await abrirPglite();
  await sql.exec(fs.readFileSync(path.join(AQUI, '..', 'sql', '001_esquema.sql'), 'utf8'));
  const res = await backfillParte(sql, volcado, {});
  console.log('PGlite · esquema 001 aplicado · backfill de ' + volcado);
  res.forEach(r => console.log('  ' + r.tabla.padEnd(18) + ' insertadas ' + String(r.insertadas).padStart(4) + (r.avisos.length ? ' · ' + r.avisos.length + ' aviso(s): ' + r.avisos[0] : '')));

  // 2. Servidor: /obra y /asistencias en vm; /parte (y /prueba/parte) en el Worker contra la BD
  const api = apiVm(semillas());
  const envWorker = { ALLOWED_ORIGINS: 'https://tm2.galca.app', BACKEND_PARTE: 'db', BACKEND_PARTE_PRUEBA: 'db',
    AUTH_SECRETO: SECRETO_BANCO, AUTH_V: '1', __dbPrueba: () => sql };
  const ctx = { waitUntil: (p) => { Promise.resolve(p).catch(() => {}); } };
  const VM = { '/obra': 'obra', '/asistencias': 'asistencias', '/prueba/obra': 'obra', '/prueba/asistencias': 'asistencias' };
  const puerto = Number(args.puerto || 8788);
  const servidor = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1:' + puerto);
    const responder = (status, obj, texto) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(texto !== undefined ? texto : JSON.stringify(obj)); };
    if (req.method === 'OPTIONS'){ res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST' }); return res.end(); }
    let cuerpo = ''; req.on('data', d => { cuerpo += d; }); req.on('end', async () => {
      const esParte = (u.searchParams.get('mod') || '').toLowerCase() === 'parte' || /"mod"\s*:\s*"parte"/i.test(cuerpo);
      const destino = esParte ? null : VM[u.pathname];   // mod=parte sobre /obra también va al Worker (como revision-maquinaria.js)
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
  console.log('Servidor de banco en http://127.0.0.1:' + puerto + '  (/obra /asistencias → vm · /parte → Worker + PGlite · admin / 1234)');
  if (args.servir) return;

  // 3. El arnés de contrato, como se correrá contra api.galca.app/prueba
  const cli = [path.join(REPO, 'backend', 'pruebas', 'contrato', 'correr.js'), '--url=http://127.0.0.1:' + puerto, '--parte=http://127.0.0.1:' + puerto + (args.viaObra ? '/obra' : '/parte'), '--solo=parte', '--escribir', '--usuario=admin', '--clave=1234'];
  if (args.verboso) cli.push('--verboso'); if (args.caso) cli.push('--caso=' + args.caso);
  const hijo = spawn(process.execPath, cli, { stdio: 'inherit' });
  const codigo = await new Promise(r => hijo.on('exit', r));
  servidor.close();
  process.exit(codigo);
}
main().catch(err => { console.error('El banco no pudo arrancar: ' + (err && err.stack || err)); process.exit(2); });
