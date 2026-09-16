/**
 * TM2 Sur — Cloudflare Worker «galca-api» (D169, sep-2026)
 *
 * Proxy ÚNICO delante de los tres Apps Script en https://api.galca.app. El frontend (GitHub Pages,
 * https://tm2.galca.app) ya no conoce ninguna URL de Google: llama a /obra, /asistencias o /parte y
 * este Worker reenvía la petición TAL CUAL a la URL /exec correspondiente, que vive como SECRETO de
 * Cloudflare (`wrangler secret put OBRA_URL`, …) y nunca en el código.
 *
 * Qué hace con cada petición, en este orden:
 *   1. CORS: solo https://tm2.galca.app (var ALLOWED_ORIGINS) y localhost/127.0.0.1 para el banco.
 *      Un Origin distinto recibe 403. Sin cabecera Origin (curl, misma-origen) se deja pasar.
 *   2. Rate limit por IP: 120 peticiones/min (binding RATE_LIMITER; respaldo en memoria por
 *      isolate si el binding no está). Al exceder: 429 {ok:false, error:'rate_limit'} — el mismo
 *      error que ya devuelve el backend por usuario+action (D166), así las pantallas lo entienden.
 *   3. Filtro de token (D109): en /obra y /asistencias toda petición tiene que TRAER el token en la
 *      forma en que auth.js lo adjunta — `?token=` en GET, `token` dentro del JSON del cuerpo en
 *      POST —, salvo `action=login` (aún no hay token) y `action=tablero` (lectura pública, D161).
 *      /parte pasa sin token: formulario público por QR (D165). Sin token: 401 {ok:false, auth:false}
 *      con el MISMO mensaje genérico de D166, que `TM2Auth.caducada()` reconoce y manda al login.
 *      Aquí NO se verifica la firma: eso sigue siendo cosa de los Apps Script. Solo se exige
 *      presencia, para que una petición anónima no llegue siquiera a Google.
 *   4. Reenvío: mismo método (GET/POST), query string intacta, cuerpo text/plain byte a byte,
 *      siguiendo las redirecciones 302 de Google (`/exec` → script.googleusercontent.com). La
 *      respuesta vuelve con su status y su Content-Type, más las cabeceras CORS de arriba.
 *
 * Entorno de PRUEBA (D168): las mismas tres rutas bajo /prueba/… reenvían a los secretos
 * OBRA_PRUEBA_URL / ASISTENCIAS_PRUEBA_URL / PARTE_PRUEBA_URL, con el mismo filtro. Son opcionales:
 * si faltan, 503 {ok:false, error:'no_configurado'} (antes entorno.js ignoraba `?env=prueba` con
 * URLs vacías; ahora lo decide el Worker).
 *
 * Lo que NO hace: no cachea nada (Cache-Control: no-store), no reenvía cookies ni cabeceras del
 * cliente, no toca el cuerpo, no guarda registros con datos de personas.
 *
 * 4.01 · Fase 2 (D180) — CONMUTADOR POR RUTA: el backend del Parte Digital puede vivir AQUÍ
 * (src/api/parte.js contra Postgres, src/db.js) en vez de en el Apps Script. Lo decide una variable
 * por ruta, sin tocar el frontend:
 *   BACKEND_PARTE        = sheets | db   → /parte          (producción)
 *   BACKEND_PARTE_PRUEBA = sheets | db   → /prueba/parte   (canario con ?env=prueba, D168)
 * Con `db` la petición NO se reenvía a Google: pasa por el mismo filtro (CORS, rate limit, tamaño) y
 * se despacha a parteDoGet_/parteDoPost_ con el MISMO contrato. Lo que necesita (`wrangler secret put`):
 *   HYPERDRIVE (binding en wrangler.toml) o DATABASE_URL   → conexión a Postgres (db.js)
 *   AUTH_SECRETO (+ AUTH_V, var, por defecto '1')           → verificar los tokens D109 que emite el
 *                                                             login del Apps Script de obra (mismo secreto)
 *   Para /prueba/parte: HYPERDRIVE_PRUEBA / DATABASE_URL_PRUEBA y AUTH_SECRETO_PRUEBA / AUTH_V_PRUEBA si
 *   el entorno de prueba tiene su propia BD o su propio Apps Script (secreto distinto); si faltan, usa
 *   los de producción (misma BD, mismo emisor de tokens).
 * Vuelta atrás: la var a `sheets` (panel o wrangler.toml + `wrangler deploy`); las filas creadas en la
 * BD entre tanto se pegan a mano al Sheet (informe §3, Fase 2, paso 6).
 */

import { abrirDb } from './db.js';
import { parteDoGet_, parteDoPost_ } from './api/parte.js';
import { logIniciar_, logMarcar_, logEscribir_ } from './comun.js';

// `mod=parte` sobre /obra (como lo llama revision-maquinaria.js y como lo despacha doGet/doPost de Codigo.gs)
// es el Parte: se atiende con la ruta /parte correspondiente (mismo conmutador, sin filtro de token).
const RUTAS = {
  '/obra':               { secreto: 'OBRA_URL',               token: true, parte: '/parte' },
  '/asistencias':        { secreto: 'ASISTENCIAS_URL',        token: true  },
  '/parte':              { secreto: 'PARTE_URL',              token: false, modulo: 'parte', backend: 'BACKEND_PARTE',
                           db: ['HYPERDRIVE', 'DATABASE_URL'], auth: ['AUTH_SECRETO'], authV: ['AUTH_V'] },
  '/prueba/obra':        { secreto: 'OBRA_PRUEBA_URL',        token: true, parte: '/prueba/parte' },
  '/prueba/asistencias': { secreto: 'ASISTENCIAS_PRUEBA_URL', token: true  },
  '/prueba/parte':       { secreto: 'PARTE_PRUEBA_URL',       token: false, modulo: 'parte', backend: 'BACKEND_PARTE_PRUEBA',
                           db: ['HYPERDRIVE_PRUEBA', 'DATABASE_URL_PRUEBA', 'HYPERDRIVE', 'DATABASE_URL'],
                           auth: ['AUTH_SECRETO_PRUEBA', 'AUTH_SECRETO'], authV: ['AUTH_V_PRUEBA', 'AUTH_V'] }
};
const MODULOS = { parte: { get: parteDoGet_, post: parteDoPost_ } };

// Acciones que pasan SIN token en las rutas con filtro (D108 login · D161 tablero público).
const SIN_TOKEN = new Set(['login', 'tablero']);

const MAX_BODY_BYTES = 1024 * 1024;       // 1 MB: los payloads reales pesan unos pocos KB
const MENSAJE_AUTH = 'Sesión no válida. Vuelve a entrar.';   // idéntico al de D166 en los backends

/* ---------------- respuestas ---------------- */

function json(obj, status, extra) {
  const h = new Headers(extra || {});
  h.set('Content-Type', 'application/json; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  h.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(obj), { status: status || 200, headers: h });
}

function conCors(resp, cors) {
  if (!cors) return resp;
  const r = new Response(resp.body, resp);
  for (const k in cors) r.headers.set(k, cors[k]);
  return r;
}

/* ---------------- CORS ---------------- */

const LOCAL_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

function origenPermitido(origin, env) {
  if (!origin) return false;
  if (LOCAL_RE.test(origin)) return true;
  const lista = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return lista.includes(origin);
}

function cabecerasCors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

/* ---------------- rate limit ---------------- */

// Respaldo si el binding nativo no existe (p. ej. `wrangler dev` sin el binding): ventana fija de
// 60 s por IP, en memoria del isolate. Aproximado —cada nodo cuenta lo suyo—, pero nunca deja pasar
// más que el binding.
const _ventanas = new Map();
function limiteEnMemoria(ip, max) {
  const ahora = Date.now();
  const v = _ventanas.get(ip);
  if (!v || ahora - v.desde >= 60000) {
    if (_ventanas.size > 5000) _ventanas.clear();
    _ventanas.set(ip, { desde: ahora, n: 1 });
    return true;
  }
  v.n++;
  return v.n <= max;
}

async function dentroDelLimite(ip, env) {
  if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === 'function') {
    try {
      const r = await env.RATE_LIMITER.limit({ key: ip });
      return !!(r && r.success);
    } catch (e) { /* binding caído: cae al respaldo */ }
  }
  const max = parseInt(env.RATE_LIMIT_POR_MIN, 10) || 120;
  return limiteEnMemoria(ip, max);
}

/* ---------------- token (presencia, no firma) ---------------- */

// Devuelve {token, action} tal como los adjunta auth.js: GET → query; POST → JSON del cuerpo.
function extraerTokenYAccion(method, url, bodyText) {
  if (method === 'GET') {
    return {
      token: url.searchParams.get('token') || '',
      action: String(url.searchParams.get('action') || '').toLowerCase()
    };
  }
  let b = null;
  try { b = JSON.parse(bodyText); } catch (e) { b = null; }
  if (!b || typeof b !== 'object') return { token: '', action: '' };
  return {
    token: typeof b.token === 'string' ? b.token : '',
    action: String(b.action || '').toLowerCase()
  };
}

// ¿La petición es del Parte (`mod=parte`)? GET → query; POST → JSON del cuerpo (como doGet/doPost de Codigo.gs).
function esParte(method, url, bodyText) {
  if (method === 'GET') return String(url.searchParams.get('mod') || '').toLowerCase() === 'parte';
  let b = null;
  try { b = JSON.parse(bodyText); } catch (e) { b = null; }
  return !!b && typeof b === 'object' && String(b.mod || '').toLowerCase() === 'parte';
}

/* ---------------- reenvío ---------------- */

async function reenviar(method, destinoBase, url, bodyText, contentType) {
  let destino;
  try { destino = new URL(destinoBase); } catch (e) { return json({ ok: false, error: 'no_configurado' }, 503); }
  destino.search = url.search;                     // query string intacta (action=, fecha=, token=, …)

  const init = { method, redirect: 'follow', headers: { 'Accept': 'application/json, text/plain, */*' } };
  if (method === 'POST') {
    init.headers['Content-Type'] = contentType || 'text/plain;charset=utf-8';
    init.body = bodyText;                          // cuerpo tal cual, byte a byte
  }

  let up;
  try { up = await fetch(destino.toString(), init); }
  catch (e) { return json({ ok: false, error: 'upstream', detalle: String(e && e.message || e).slice(0, 200) }, 502); }

  const h = new Headers();
  h.set('Content-Type', up.headers.get('Content-Type') || 'application/json; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  h.set('X-Content-Type-Options', 'nosniff');
  return new Response(up.body, { status: up.status, headers: h });
}

/* ---------------- backend en el Worker (BACKEND_<ruta>=db, 4.01) ---------------- */

function primero(env, nombres) { for (const n of (nombres || [])) { if (env[n]) return env[n]; } return ''; }
function backendDb(ruta, env) { return !!ruta.backend && String(env[ruta.backend] || 'sheets').trim().toLowerCase() === 'db'; }

// Misma secuencia que doGet/doPost de Codigo.gs: LOG por petición (tabla `log`), despacho por op, `_ms`.
// Respuesta SIEMPRE 200 con el JSON del contrato (como Apps Script); 5xx solo si el Worker o la BD fallan.
async function servirDb(ruta, env, ctx, url, method, bodyText) {
  const t0 = Date.now();
  const con = abrirDb(env, ruta.db);
  if (!con) return json({ ok: false, error: 'no_configurado', ruta: url.pathname, detalle: 'falta HYPERDRIVE o DATABASE_URL' }, 503);
  const c = { sql: con.sql, env, secreto: String(primero(env, ruta.auth) || ''), authV: String(primero(env, ruta.authV) || '1'), pet: { t0, log: null }, memo: {} };
  const mod = MODULOS[ruta.modulo];
  let out, status = 200;
  try {
    if (method === 'GET') {
      const params = {}; url.searchParams.forEach((v, k) => { params[k] = v; });
      logIniciar_(c, ruta.modulo + ':' + String(params.op || '').toLowerCase());
      out = await mod.get(c, params);
    } else {
      logIniciar_(c, 'POST');
      let body = null;
      try { body = JSON.parse(bodyText); } catch (e) { body = null; }
      if (!body || typeof body !== 'object') { logMarcar_(c, 'rechazado', 'JSON inválido'); out = { ok: false, error: 'payload', campo: 'json', detalle: 'El cuerpo no es JSON.' }; }
      else { c.pet.log.action = ruta.modulo + ':' + String(body.op || '').toLowerCase(); out = await mod.post(c, body); }
    }
  } catch (e) {
    logMarcar_(c, 'error', String(e && e.message || e));
    out = { ok: false, error: 'worker', detalle: String(e && e.message || e).slice(0, 200) }; status = 500;
  }
  if (out && typeof out === 'object' && out._ms === undefined) out._ms = Date.now() - t0;
  const cierre = logEscribir_(c, ruta.modulo).catch(() => {}).then(() => con.cerrar());
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(cierre); else await cierre;
  return json(out, status);
}

/* ---------------- entrada ---------------- */

async function manejar(request, env, ctx) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const origin = request.headers.get('Origin') || '';

  // 1. CORS
  let cors = null;
  if (origin) {
    if (!origenPermitido(origin, env)) return json({ ok: false, error: 'origen' }, 403);
    cors = cabecerasCors(origin);
  }
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors || {} });
  if (method !== 'GET' && method !== 'POST') return conCors(json({ ok: false, error: 'metodo' }, 405, { 'Allow': 'GET, POST, OPTIONS' }), cors);

  let ruta = RUTAS[url.pathname.replace(/\/+$/, '') || '/'];
  if (!ruta) {
    if (url.pathname === '/' && method === 'GET') return conCors(json({ ok: true, api: 'galca-api', rutas: Object.keys(RUTAS).filter(r => r.indexOf('/prueba') !== 0) }), cors);
    return conCors(json({ ok: false, error: 'ruta' }, 404), cors);
  }

  // 2. Rate limit por IP
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'desconocida';
  if (!(await dentroDelLimite(ip, env))) {
    return conCors(json({ ok: false, error: 'rate_limit' }, 429, { 'Retry-After': '60' }), cors);
  }

  // Cuerpo (POST): se lee una vez y se reenvía tal cual.
  let bodyText = '';
  if (method === 'POST') {
    const len = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (len > MAX_BODY_BYTES) return conCors(json({ ok: false, error: 'payload', campo: 'tamano' }, 413), cors);
    bodyText = await request.text();
    if (bodyText.length > MAX_BODY_BYTES) return conCors(json({ ok: false, error: 'payload', campo: 'tamano' }, 413), cors);
  }

  // 2b. `mod=parte` sobre /obra → es el Parte Digital (revision-maquinaria.js lo llama así): misma ruta /parte
  if (ruta.parte && esParte(method, url, bodyText)) ruta = RUTAS[ruta.parte];

  // 3. Filtro de token (presencia)
  if (ruta.token) {
    const { token, action } = extraerTokenYAccion(method, url, bodyText);
    if (!token && !SIN_TOKEN.has(action)) {
      return conCors(json({ ok: false, auth: false, error: MENSAJE_AUTH }, 401), cors);
    }
  }

  // 4a. Backend en el Worker (4.01): la ruta está conmutada a la base de datos
  if (backendDb(ruta, env)) return conCors(await servirDb(ruta, env, ctx, url, method, bodyText), cors);

  // 4b. Reenvío al Apps Script (URL en secreto)
  const destino = env[ruta.secreto];
  if (!destino) return conCors(json({ ok: false, error: 'no_configurado', ruta: url.pathname }, 503), cors);

  const resp = await reenviar(method, destino, url, bodyText, request.headers.get('Content-Type'));
  return conCors(resp, cors);
}

export default {
  async fetch(request, env, ctx) {
    try { return await manejar(request, env, ctx); }
    catch (e) { return json({ ok: false, error: 'worker', detalle: String(e && e.message || e).slice(0, 200) }, 500); }
  }
};

// Para el banco de pruebas en Node (no lo usa Cloudflare).
export { manejar, extraerTokenYAccion, origenPermitido, RUTAS };
