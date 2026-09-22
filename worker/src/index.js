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
 *      POST —, salvo `action=login` (aún no hay token), `action=tablero` (lectura pública, D161) y
 *      `action=tablero_vivo` (el Tablero en vivo, D185: ampliación de D161 decidida por el dueño).
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
 * Lo que NO hace: no cachea nada (Cache-Control: no-store) salvo el Tablero en vivo de abajo (D185) y el CSV del
 * Excel maestro (D187), no reenvía cookies ni cabeceras del cliente, no toca el cuerpo, no guarda registros con
 * datos de personas.
 *
 * D185 (V3-11 Fases B+C) — CACHÉ DEL TABLERO EN VIVO: GET /obra?action=tablero_vivo (público, con obra en `db`)
 * se guarda 60 s en la Cache API de Cloudflare (caches.default, por centro de datos), con UNA clave por entorno
 * (…/obra?action=tablero_vivo y …/prueba/obra?action=tablero_vivo; el token no entra en la clave). Todos los que
 * abren el Tablero en ese minuto (los directivos por el enlace público) leen la misma respuesta sin tocar la BD.
 * Se la SALTA una petición con token VÁLIDO de admin o jefe: calcula al momento (el jefe ve su corrección al
 * instante) y deja esa respuesta fresca en la caché para los demás. Un POST de obra que cambia lo que muestra
 * (enviar_data, data_grid_guardar, proyeccion_guardar, tablero_horas_guardar) borra la clave de su entorno en ese
 * centro de datos (los demás la renuevan en ≤ 60 s). Solo se cachea una respuesta ok (status 200, '{"ok":true').
 * Al cliente siempre va con Cache-Control: no-store y la cabecera X-Tablero-Cache: HIT | MISS | BYPASS | SIN (sin
 * Cache API: el banco en Node). En el banco, `env.__cachePrueba` (un objeto con match/put/delete) sustituye a
 * caches.default.
 *
 * 4.01 (D180) — CONMUTADOR POR RUTA: cada módulo puede vivir AQUÍ (src/api/*.js contra Postgres,
 * src/db.js) en vez de en su Apps Script. Lo decide una variable por ruta, sin tocar el frontend:
 *   BACKEND_PARTE / BACKEND_PARTE_PRUEBA               = sheets | db   → /parte        · /prueba/parte        (Fase 2, en producción)
 *   BACKEND_OBRA / BACKEND_OBRA_PRUEBA                 = sheets | db   → /obra         · /prueba/obra         (Fase 4)
 *   BACKEND_ASISTENCIAS / BACKEND_ASISTENCIAS_PRUEBA   = sheets | db   → /asistencias  · /prueba/asistencias  (Fase 3)
 * (/prueba/* = canario con ?env=prueba, D168). Con `db` la petición NO se reenvía a Google: pasa por el
 * mismo filtro (CORS, rate limit, tamaño, presencia de token) y se despacha al módulo (MODULOS) con el
 * MISMO contrato: parteDoGet_/parteDoPost_, obraDoGet_/obraDoPost_, asistenciasDoGet_/asistenciasDoPost_.
 * Lo que necesita (`wrangler secret put`):
 *   HYPERDRIVE (binding en wrangler.toml) o DATABASE_URL   → conexión a Postgres (db.js)
 *   AUTH_SECRETO (+ AUTH_V, var, por defecto '1')           → el MISMO par que los Apps Script: verificar los
 *                                                             tokens D109 en los tres módulos y, con obra en
 *                                                             `db`, EMITIRLOS en el login (src/auth.js)
 *   Para /prueba/*: HYPERDRIVE_PRUEBA / DATABASE_URL_PRUEBA y AUTH_SECRETO_PRUEBA / AUTH_V_PRUEBA si el
 *   entorno de prueba tiene su propia BD o su propio secreto; si faltan, usa los de producción.
 * D187 — LA DATA PARA EL EXCEL MAESTRO SIN INSTALAR NADA: GET /obra?action=data_csv&clave=<CLAVE> (y
 * ?action=proyeccion_csv&tabla=plan|contrato|rendimiento|parametros&clave=…), también bajo /prueba/obra, devuelve la
 * vista data_maestro (o proyeccion_<tabla>_maestro) en CSV UTF-8 con BOM para Power Query «Desde la Web» (Web.Contents
 * + Csv.Document, nativo en Excel de escritorio). Se atiende ANTES del filtro de token (no hay sesión: es Excel) con
 * una CLAVE DE LECTURA compartida, secreto `CLAVE_LECTURA_EXCEL` (`CLAVE_LECTURA_EXCEL_PRUEBA` en /prueba, con
 * respaldo a la de producción), comparada en tiempo constante. Sin secreto → 503; clave vacía o mala → 401; errores en
 * TEXTO PLANO corto (Excel no enseña JSON). Además del límite general por IP, 10 claves malas por minuto e IP → 429.
 * Caché de 60 s por entorno y tabla (Cache API, como el Tablero en vivo), SOLO tras validar la clave y sin la clave en
 * la llave de caché; los mismos POST que borran el Tablero en vivo la borran. Sin LOG (lectura anónima, como D185).
 *
 * LOG por petición (tabla `log`, decisión 9): parte → 'parte:'+op; obra y asistencias → action (GET sin
 * action = 'ping', POST sin action = 'reporte'); el tablero público (GET obra action=tablero) y el Tablero en vivo
 * (action=tablero_vivo, D185) no escriben LOG.
 * Vuelta atrás: la var a `sheets` (panel o wrangler.toml + `wrangler deploy`); las filas creadas en la
 * BD entre tanto se pegan a mano al Sheet (informe §3).
 */

import { abrirDb } from './db.js';
import { parteDoGet_, parteDoPost_ } from './api/parte.js';
import { obraDoGet_, obraDoPost_ } from './api/obra.js';
import { asistenciasDoGet_, asistenciasDoPost_ } from './api/asistencias.js';
import { logIniciar_, logMarcar_, logEscribir_, verificarToken_, valEsquema_ } from './comun.js';
import { dataCsv, proyeccionCsv, CSV_TABLAS, VAL_CSV } from './api/obra/data_csv.js';   // D187: DATA → Excel por la Web

// `mod=parte` sobre /obra (como lo llama revision-maquinaria.js y como lo despacha doGet/doPost de Codigo.gs)
// es el Parte: se atiende con la ruta /parte correspondiente (mismo conmutador, sin filtro de token).
// Conexión y secretos por ruta: producción mira los nombres base; /prueba/* prueba primero los *_PRUEBA (D168).
const DB_PROD     = ['HYPERDRIVE', 'DATABASE_URL'];
const DB_PRUEBA   = ['HYPERDRIVE_PRUEBA', 'DATABASE_URL_PRUEBA', 'HYPERDRIVE', 'DATABASE_URL'];
const AUTH_PROD   = ['AUTH_SECRETO'],                   AUTHV_PROD   = ['AUTH_V'];
const AUTH_PRUEBA = ['AUTH_SECRETO_PRUEBA', 'AUTH_SECRETO'], AUTHV_PRUEBA = ['AUTH_V_PRUEBA', 'AUTH_V'];
// D187: la clave de lectura del Excel maestro (Power Query «Desde la Web»); /prueba cae a la de producción si falta.
const CLAVE_EXCEL_PROD = ['CLAVE_LECTURA_EXCEL'], CLAVE_EXCEL_PRUEBA = ['CLAVE_LECTURA_EXCEL_PRUEBA', 'CLAVE_LECTURA_EXCEL'];
const RUTAS = {
  '/obra':               { secreto: 'OBRA_URL',               token: true,  parte: '/parte',        modulo: 'obra',        backend: 'BACKEND_OBRA',
                           db: DB_PROD,   auth: AUTH_PROD,   authV: AUTHV_PROD,   claveExcel: CLAVE_EXCEL_PROD },
  '/asistencias':       { secreto: 'ASISTENCIAS_URL',        token: true,                          modulo: 'asistencias', backend: 'BACKEND_ASISTENCIAS',
                           db: DB_PROD,   auth: AUTH_PROD,   authV: AUTHV_PROD },
  '/parte':              { secreto: 'PARTE_URL',              token: false,                         modulo: 'parte',       backend: 'BACKEND_PARTE',
                           db: DB_PROD,   auth: AUTH_PROD,   authV: AUTHV_PROD },
  '/prueba/obra':        { secreto: 'OBRA_PRUEBA_URL',        token: true,  parte: '/prueba/parte', modulo: 'obra',        backend: 'BACKEND_OBRA_PRUEBA',
                           db: DB_PRUEBA, auth: AUTH_PRUEBA, authV: AUTHV_PRUEBA, claveExcel: CLAVE_EXCEL_PRUEBA },
  '/prueba/asistencias':{ secreto: 'ASISTENCIAS_PRUEBA_URL', token: true,                          modulo: 'asistencias', backend: 'BACKEND_ASISTENCIAS_PRUEBA',
                           db: DB_PRUEBA, auth: AUTH_PRUEBA, authV: AUTHV_PRUEBA },
  '/prueba/parte':       { secreto: 'PARTE_PRUEBA_URL',       token: false,                         modulo: 'parte',       backend: 'BACKEND_PARTE_PRUEBA',
                           db: DB_PRUEBA, auth: AUTH_PRUEBA, authV: AUTHV_PRUEBA }
};
const MODULOS = {
  parte:       { get: parteDoGet_,       post: parteDoPost_ },
  obra:        { get: obraDoGet_,        post: obraDoPost_ },          // Fase 4 (stub hasta que se porte)
  asistencias: { get: asistenciasDoGet_, post: asistenciasDoPost_ }    // Fase 3 (stub hasta que se porte)
};

// Acciones que pasan SIN token en las rutas con filtro (D108 login · D161 tablero público · D185 tablero en vivo).
const SIN_TOKEN = new Set(['login', 'tablero', 'tablero_vivo']);

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

// Etiqueta de la fila de LOG (decisión 9): parte → 'parte:'+op (como logAction_ de Codigo.gs L1094);
// obra y asistencias → `action` (GET sin action = 'ping', POST sin action = 'reporte', como doGet/doPost).
function etiquetaLog(modulo, method, o) {
  if (modulo === 'parte') return 'parte:' + String((o && o.op) || '').toLowerCase();
  return String((o && o.action) || '') || (method === 'GET' ? 'ping' : 'reporte');
}
// El tablero público (obra, GET action=tablero, D161) y el Tablero en vivo (action=tablero_vivo, D185) son lecturas
// anónimas: no escriben LOG.
const ACCIONES_SIN_LOG = ['tablero', 'tablero_vivo'];
function sinLog(modulo, method, o) {
  return modulo === 'obra' && method === 'GET' && ACCIONES_SIN_LOG.indexOf(String((o && o.action) || '').toLowerCase()) >= 0;
}

// Misma secuencia que doGet/doPost de Codigo.gs: LOG por petición (tabla `log`), despacho por op/action, `_ms`.
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
      logIniciar_(c, etiquetaLog(ruta.modulo, method, params));
      if (sinLog(ruta.modulo, method, params)) c.pet.log.silencio = true;
      out = await mod.get(c, params);
    } else {
      logIniciar_(c, 'POST');
      let body = null;
      try { body = JSON.parse(bodyText); } catch (e) { body = null; }
      if (!body || typeof body !== 'object') { logMarcar_(c, 'rechazado', 'JSON inválido'); out = { ok: false, error: 'payload', campo: 'json', detalle: 'El cuerpo no es JSON.' }; }
      else { c.pet.log.action = etiquetaLog(ruta.modulo, method, body); out = await mod.post(c, body); }
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

/* ---------------- Tablero en vivo: caché de 60 s (D185) ---------------- */

const VIVO_TTL_S = 60;
const VIVO_ROLES_FRESCO = ['admin', 'jefe'];     // su token salta la caché (y la refresca)
// POST de obra que cambian lo que muestra el Tablero en vivo: borran la clave de su entorno.
const VIVO_INVALIDAN = new Set(['enviar_data', 'data_grid_guardar', 'proyeccion_guardar', 'tablero_horas_guardar']);

function cacheVivo(env) {
  if (env && env.__cachePrueba) return env.__cachePrueba;               // banco: Node no tiene Cache API
  try { return (typeof caches !== 'undefined' && caches && caches.default) ? caches.default : null; }
  catch (e) { return null; }
}
// Una clave por entorno (/obra · /prueba/obra), sin el token ni otros parámetros.
function claveVivo(url) {
  return new Request(url.origin + url.pathname.replace(/\/+$/, '') + '?action=tablero_vivo', { method: 'GET' });
}
function esTableroVivo(ruta, method, url) {
  return ruta.modulo === 'obra' && method === 'GET' && String(url.searchParams.get('action') || '').toLowerCase() === 'tablero_vivo';
}
function respuestaVivo(texto, status, estado) {
  return new Response(texto, { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Tablero-Cache': estado } });
}
// ¿El token es VÁLIDO y de admin/jefe? Aquí sí se verifica la FIRMA: decide si se salta la caché. Cualquier otro
// caso (sin token, token roto, otro rol) = lector anónimo, que lee la caché.
async function vivoFresco(ruta, env, url) {
  const tok = url.searchParams.get('token') || '';
  const secreto = String(primero(env, ruta.auth) || '');
  if (!tok || !secreto) return false;
  try {
    const v = await verificarToken_(tok, secreto, String(primero(env, ruta.authV) || '1'));
    return !!(v && v.ok) && VIVO_ROLES_FRESCO.indexOf(String(v.rol || '').toLowerCase()) >= 0;
  } catch (e) { return false; }
}
async function servirVivo(ruta, env, ctx, url) {
  const cache = cacheVivo(env), clave = claveVivo(url);
  const fresco = await vivoFresco(ruta, env, url);
  if (cache && !fresco) {
    let hit = null;
    try { hit = await cache.match(clave); } catch (e) { hit = null; }
    if (hit) return respuestaVivo(await hit.text(), 200, 'HIT');
  }
  const r = await servirDb(ruta, env, ctx, url, 'GET', '');
  const texto = await r.text();
  if (cache && r.status === 200 && texto.indexOf('{"ok":true') === 0) {
    const copia = new Response(texto, { headers: { 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=' + VIVO_TTL_S } });
    const p = Promise.resolve().then(() => cache.put(clave, copia)).catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p); else await p;
  }
  return respuestaVivo(texto, r.status, fresco ? 'BYPASS' : (cache ? 'MISS' : 'SIN'));
}
function invalidarVivo(env, ctx, url) {
  const cache = cacheVivo(env);
  if (!cache || typeof cache.delete !== 'function') return;
  const p = Promise.resolve().then(() => cache.delete(claveVivo(url))).catch(() => {});
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
}

/* ---------------- DATA para el Excel maestro: CSV con clave de lectura (D187) ---------------- */

const CSV_ACCIONES = ['data_csv', 'proyeccion_csv'];
const CSV_TTL_S = 60;
const CSV_FALLOS_POR_MIN = 10;          // claves malas por IP y minuto antes de 429 (además del límite general)
const _csvFallos = new Map();

function esCsv(ruta, method, url) {
  return ruta.modulo === 'obra' && method === 'GET' && CSV_ACCIONES.indexOf(String(url.searchParams.get('action') || '').toLowerCase()) >= 0;
}
// Errores en texto plano corto: Power Query / el navegador los enseñan tal cual.
function textoPlano(texto, status, extra) {
  return new Response(texto + '\n', { status, headers: Object.assign({ 'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, extra || {}) });
}
function respuestaCsv(texto, estado, nombre) {
  return new Response(texto, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline; filename="' + nombre + '.csv"', 'X-Csv-Cache': estado } });
}
// Llave de caché: entorno + acción (+ tabla). NUNCA la clave: una clave vieja no lee nada de la caché porque la caché
// solo se consulta DESPUÉS de validar la clave contra el secreto vigente.
function claveCsv(url, accion, tabla) {
  return new Request(url.origin + url.pathname.replace(/\/+$/, '') + '?action=' + accion + (tabla ? '&tabla=' + tabla : ''), { method: 'GET' });
}
// Comparación en tiempo constante: SHA-256 de ambas (siempre 32 bytes) y XOR de todos los bytes, sin salir antes.
async function claveIgual(dada, secreta) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(String(dada))), crypto.subtle.digest('SHA-256', enc.encode(String(secreta)))]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
// Claves malas por IP (ventana fija de 60 s en memoria del isolate, como el respaldo del rate limit).
function csvBloqueado(ip) {
  const v = _csvFallos.get(ip);
  return !!v && Date.now() - v.desde < 60000 && v.n >= CSV_FALLOS_POR_MIN;
}
function csvFallo(ip) {
  const ahora = Date.now(), v = _csvFallos.get(ip);
  if (!v || ahora - v.desde >= 60000) { if (_csvFallos.size > 5000) _csvFallos.clear(); _csvFallos.set(ip, { desde: ahora, n: 1 }); }
  else v.n++;
}
function invalidarCsv(env, ctx, url) {
  const cache = cacheVivo(env);
  if (!cache || typeof cache.delete !== 'function') return;
  const llaves = [claveCsv(url, 'data_csv', '')].concat(CSV_TABLAS.map(t => claveCsv(url, 'proyeccion_csv', t)));
  const p = Promise.all(llaves.map(k => Promise.resolve().then(() => cache.delete(k)).catch(() => {})));
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
}

async function servirCsv(ruta, env, ctx, url, ip) {
  const accion = String(url.searchParams.get('action') || '').toLowerCase();
  const secreta = String(primero(env, ruta.claveExcel) || '');
  if (!secreta) return textoPlano('Galca: falta configurar CLAVE_LECTURA_EXCEL en el Worker.', 503);
  if (csvBloqueado(ip)) return textoPlano('Galca: demasiados intentos con clave incorrecta. Espera un minuto.', 429, { 'Retry-After': '60' });
  const dada = url.searchParams.get('clave') || '';
  if (!dada || !(await claveIgual(dada, secreta))) {
    csvFallo(ip);
    return textoPlano(dada ? 'Galca: clave de lectura incorrecta.' : 'Galca: falta la clave de lectura (clave=).', 401);
  }
  // D166: parámetros (la clave ya pasó; aquí su tamaño y la lista de tablas) ANTES de tocar la BD.
  const params = { clave: dada, tabla: url.searchParams.get('tabla') || '' };
  const f = valEsquema_(params, VAL_CSV, '');
  if (f) return textoPlano('Galca: parámetro ' + f.campo + ' no válido (' + f.motivo + ').', 400);
  const tabla = accion === 'proyeccion_csv' ? String(params.tabla).trim().toLowerCase() : '';
  if (accion === 'proyeccion_csv' && CSV_TABLAS.indexOf(tabla) < 0) return textoPlano('Galca: falta tabla= (' + CSV_TABLAS.join(', ') + ').', 400);
  if (!backendDb(ruta, env)) return textoPlano('Galca: la obra todavía no está en la base de datos (' + ruta.backend + ' no es db).', 503);

  const nombre = accion === 'data_csv' ? 'DATA' : 'PROYECCION_' + tabla.toUpperCase();
  const cache = cacheVivo(env), llave = claveCsv(url, accion, tabla);
  if (cache) {
    let hit = null;
    try { hit = await cache.match(llave); } catch (e) { hit = null; }
    if (hit) return respuestaCsv(await hit.arrayBuffer(), 'HIT', nombre);   // bytes: text() se comería el BOM
  }
  const con = abrirDb(env, ruta.db);
  if (!con) return textoPlano('Galca: falta la conexión a la base de datos (HYPERDRIVE o DATABASE_URL).', 503);
  let texto;
  try {
    const c = { sql: con.sql, env };
    texto = accion === 'data_csv' ? await dataCsv(c) : await proyeccionCsv(c, tabla);
  } catch (e) {
    return textoPlano('Galca: no se pudo leer ' + (accion === 'data_csv' ? 'data_maestro' : 'la Proyección')
      + ' (' + String(e && e.message || e).slice(0, 160) + ').', 500);
  } finally {
    const cierre = Promise.resolve().then(() => con.cerrar()).catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(cierre); else await cierre;
  }
  if (cache) {
    const copia = new Response(texto, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'public, max-age=' + CSV_TTL_S } });
    const p = Promise.resolve().then(() => cache.put(llave, copia)).catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p); else await p;
  }
  return respuestaCsv(texto, cache ? 'MISS' : 'SIN', nombre);
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

  // 2c. D187: la DATA para el Excel maestro (CSV con clave de lectura), ANTES del filtro de token.
  if (esCsv(ruta, method, url)) return conCors(await servirCsv(ruta, env, ctx, url, ip), cors);

  // 3. Filtro de token (presencia)
  let accion = '';
  if (ruta.token) {
    const { token, action } = extraerTokenYAccion(method, url, bodyText);
    accion = action;
    if (!token && !SIN_TOKEN.has(action)) {
      return conCors(json({ ok: false, auth: false, error: MENSAJE_AUTH }, 401), cors);
    }
  }

  // 4a. Backend en el Worker (4.01): la ruta está conmutada a la base de datos
  if (backendDb(ruta, env)) {
    // D185: el Tablero en vivo pasa por su caché de 60 s (arriba).
    if (esTableroVivo(ruta, method, url)) return conCors(await servirVivo(ruta, env, ctx, url), cors);
    const resp = await servirDb(ruta, env, ctx, url, method, bodyText);
    if (method === 'POST' && ruta.modulo === 'obra' && VIVO_INVALIDAN.has(accion)) { invalidarVivo(env, ctx, url); invalidarCsv(env, ctx, url); }
    return conCors(resp, cors);
  }

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
