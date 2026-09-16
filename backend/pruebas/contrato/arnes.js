/**
 * Arnés de CONTRATO (Fase 1 de la migración 4.01, D178) — backend/pruebas/contrato/arnes.js
 *
 * Una misma lista de peticiones GET/POST con su respuesta esperada, ejecutable contra DOS destinos:
 *
 *   · modo `vm`  — el código REAL de backend/*.gs cargado en un `vm` de Node con los servicios de Apps
 *                  Script de mentira (Sheet en memoria `hojaFalsa`, CacheService que cuenta, HMAC real).
 *                  Es el mismo molde que los 36 arneses `verificar_*.js`, unificado en un solo sitio.
 *   · modo `url` — una URL de verdad: el Worker (`https://api.galca.app/prueba`) o un `/exec` de Google
 *                  directo. Sirve hoy para comprobar el entorno de prueba (D168) y, en las Fases 2–4,
 *                  para exigirle al backend nuevo (Worker + Postgres) EXACTAMENTE la misma superficie.
 *
 * Los casos (casos_*.js) hablan con una fachada única `api`, que no sabe en qué modo corre:
 *
 *   api.obra.get(params)          GET  /obra?...            api.obra.post(body)          POST /obra
 *   api.asistencias.get(params)   GET  /asistencias?...     api.asistencias.post(body)   POST /asistencias
 *   api.parte.get(params)         GET  /obra?mod=parte&...  api.parte.post(body)         POST /obra {mod:'parte',...}
 *   api.sesion(perfil)            token firmado del perfil ('admin' | 'capataz' | 'jefe' | 'residente' …)
 *   api.modo, api.hoy, api.FECHA_BANCO, api.uuid()
 *
 * En modo `vm` el token se emite con `emitirToken_` del propio Codigo.gs (secreto de banco). En modo
 * `url` se obtiene con `action=login` y las credenciales que se pasen (ver correr.js): solo existen los
 * perfiles para los que haya credenciales; un caso que pida otro perfil se marca como OMITIDO, nunca
 * como fallo. Los casos que miran el estado interno de las hojas (`api.hojas`) o mutan el código llevan
 * `soloVm:true` y también se omiten contra una URL.
 *
 * Regla de oro heredada de los arneses: NUNCA se abre el Sheet real ni la red en modo `vm`.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');

const REPO = path.resolve(__dirname, '..', '..', '..');
const RUTA_OBRA  = path.join(REPO, 'backend', 'Codigo.gs');
const RUTA_PARTE = path.join(REPO, 'backend', 'CodigoParte.gs');
const RUTA_ASIS  = path.join(REPO, 'backend', 'CodigoAsistencias.gs');

const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
/* Fecha «de banco» para las ESCRITURAS del contrato: un lunes laborable de enero de 2020 (la validación
 * D166 rechaza fechas anteriores a 2020 y futuras) que ningún dato real comparte. Así una corrida contra /prueba/… nunca pisa un día de verdad y se puede limpiar sola
 * (asistencias: reenviar la cuadrilla con filas:[] borra el bloque; parte: la fila queda `descartado`). */
const FECHA_BANCO = '2020-01-13';
const SECRETO_BANCO = 'secreto-de-banco-largo-xxxxxxxx-yyyyyyyy';
const MENSAJE_AUTH = 'Sesión no válida. Vuelve a entrar.';   // D166: mismo texto en obra, asistencias y Worker

/* =====================================================================================================
 * 1 · Servicios de Apps Script de mentira (modo vm). Copiados del molde de verificar_d166_endurecimiento.js.
 * ===================================================================================================== */
function hojaFalsa(filas){
  const g = { _f: (filas || []).map(r => r.slice()), _escrituras: 0, _appends: 0,
    getLastRow(){ let n = g._f.length; while (n > 0 && g._f[n-1].every(v => v === '' || v === undefined)) n--; return n; },
    getLastColumn(){ return g._f.reduce((m, r) => Math.max(m, r.length), 0); },
    getMaxRows(){ return Math.max(g._f.length, 200); }, getMaxColumns(){ return Math.max(g.getLastColumn(), 40); },
    insertRowsAfter(){}, insertColumnsAfter(){},
    deleteRows(f, n){ g._f.splice(f-1, n || 1); g._escrituras++; },
    _fila(i){ while (g._f.length <= i) g._f.push([]); return g._f[i]; },
    getDataRange(){ return g.getRange(1, 1, Math.max(g._f.length, 1), Math.max(g.getLastColumn(), 1)); },
    appendRow(r){ g._f.push(r.slice()); g._escrituras++; g._appends++; },
    clearContents(){ g._f = []; g._escrituras++; },
    getRange(f, c, nf, nc){
      nf = (nf === undefined ? 1 : nf); nc = (nc === undefined ? 1 : nc);
      return {
        getValues(){ const out = [];
          for (let i = f-1; i < f-1+nf; i++){ const r = g._f[i] || [], fila = [];
            for (let j = c-1; j < c-1+nc; j++) fila.push(r[j] === undefined ? '' : r[j]);
            out.push(fila); } return out; },
        setValues(m){ g._escrituras++; for (let i = 0; i < m.length; i++){ const r = g._fila(f-1+i);
            for (let j = 0; j < m[i].length; j++) r[c-1+j] = m[i][j]; } },
        setNumberFormat(){ return this; },
        setValue(v){ g._escrituras++; g._fila(f-1)[c-1] = v; },
        clearContent(){ for (let i = f-1; i < f-1+nf; i++){ const r = g._f[i]; if (!r) continue;
            for (let j = c-1; j < c-1+nc; j++) r[j] = ''; } }
      };
    }
  };
  return g;
}
function cacheFalsa(){ const m = new Map(); return { get: (k) => m.has(k) ? m.get(k) : null, put: (k, v) => { m.set(k, String(v)); }, remove: (k) => m.delete(k), removeAll: (ks) => (ks || []).forEach(k => m.delete(k)), _m: m }; }
function driveFalso(){
  const mkFolder = (nombre) => { const f = { nombre, carpetas: [], archivos: [],
    getFoldersByName(n){ const l = f.carpetas.filter(x => x.nombre === n); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; },
    createFolder(n){ const c = mkFolder(n); f.carpetas.push(c); return c; },
    getFilesByName(n){ const l = f.archivos.filter(x => x.nombre === n && !x.papelera); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; },
    getFiles(){ const l = f.archivos.filter(x => !x.papelera); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; } }; return f; };
  const raiz = mkFolder('raíz');
  const mkFile = (nombre) => ({ nombre, papelera: false, getName(){ return nombre; }, setTrashed(v){ this.papelera = !!v; } });
  return { getRootFolder: () => raiz, getFileById: (id) => ({ makeCopy(nombre, carpeta){ const f = mkFile(nombre); f.origen = id; carpeta.archivos.push(f); return f; } }) };
}
function scriptAppFalso(){
  const triggers = [];
  return { getProjectTriggers: () => triggers.slice(), deleteTrigger: (t) => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
    newTrigger: (fn) => { const t = { fn, getHandlerFunction: () => fn };
      const b = { atHour: (h) => { t.hora = h; return b; }, inTimezone: () => b, everyMinutes: (m) => { t.min = m; return b; }, everyDays: (d) => { t.dias = d; return b; }, create: () => { triggers.push(t); return t; } };
      return { timeBased: () => b }; } };
}
function servicios(props, hojas){
  const cache = cacheFalsa();
  const ss = { getSheetByName: (n) => hojas[n] || null, insertSheet: (n) => { hojas[n] = hojaFalsa([]); return hojas[n]; }, getSpreadsheetTimeZone: () => 'America/Bogota' };
  const ctx = { console,
    SpreadsheetApp: { openById: () => ss },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => JSON.parse(t) }), MimeType: { JSON: 'json' } },
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null, setProperty: (k, v) => { props[k] = String(v); } }) },
    LockService: { getScriptLock: () => ({ waitLock: () => true, releaseLock(){} }) },
    DriveApp: driveFalso(), ScriptApp: scriptAppFalso(),
    Utilities: {
      computeHmacSha256Signature: (txt, clave) => crypto.createHmac('sha256', String(clave)).update(String(txt), 'utf8').digest(),
      base64EncodeWebSafe: (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
      newBlob: (x) => { const b = Buffer.isBuffer(x) ? x : Buffer.from(String(x), 'utf8'); return { getBytes: () => b, getDataAsString: () => b.toString('utf8') }; },
      computeDigest: (alg, txt) => crypto.createHash('sha256').update(String(txt), 'utf8').digest(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      getUuid: () => 'uuid-' + (++ctx._uuid), formatDate: () => HOY, Charset: { UTF_8: 'utf8' } },
    Logger: { log(){} }, Session: { getScriptTimeZone: () => 'America/Bogota' }, _uuid: 0, _cache: cache, _hojas: hojas };
  ctx.globalThis = ctx; vm.createContext(ctx); return ctx;
}

/* Carga un backend en un vm. `hojas` = { NOMBRE_HOJA: [[encabezados],[fila]…] } (ver semillas.js). */
function cargarObra(hojasSemilla, props){
  const hojas = {}; Object.keys(hojasSemilla || {}).forEach(n => { hojas[n] = hojaFalsa(hojasSemilla[n]); });
  const ctx = servicios(Object.assign({ AUTH_SECRETO: SECRETO_BANCO, AUTH_V: '1' }, props || {}), hojas);
  const src = fs.readFileSync(RUTA_OBRA, 'utf8') + '\n' + fs.readFileSync(RUTA_PARTE, 'utf8');
  vm.runInContext(src, ctx, { filename: 'Codigo.gs+CodigoParte.gs' });
  vm.runInContext('globalThis.SHEET_ID=SHEET_ID; globalThis.PARTE_BANDEJA_HEADERS=PARTE_BANDEJA_HEADERS;', ctx);
  return ctx;
}
function cargarAsis(hojasSemilla, props){
  const hojas = {}; Object.keys(hojasSemilla || {}).forEach(n => { hojas[n] = hojaFalsa(hojasSemilla[n]); });
  const ctx = servicios(Object.assign({ AUTH_SECRETO: SECRETO_BANCO, AUTH_V: '1' }, props || {}), hojas);
  vm.runInContext(fs.readFileSync(RUTA_ASIS, 'utf8'), ctx, { filename: 'CodigoAsistencias.gs' });
  return ctx;
}

/* =====================================================================================================
 * 2 · Fachada `api` — modo vm
 * ===================================================================================================== */
const PERFILES_VM = {   // usuario y rol con que se emite el token en modo vm (la hoja USUARIOS de semillas.js los tiene)
  admin: { usuario: 'admin', rol: 'admin' }, capataz: { usuario: 'angel', rol: 'capataz' }, jefe: { usuario: 'jefe', rol: 'jefe' },
  residente: { usuario: 'residente', rol: 'residente' }, encargado: { usuario: 'encargado', rol: 'encargado' }
};
function apiVm(semillas){
  const obra = cargarObra(semillas.obra), asis = cargarAsis(semillas.asistencias);
  const get  = (ctx) => async (p) => clon(ctx.doGet({ parameter: Object.assign({}, p || {}) }));
  const post = (ctx) => async (b) => clon(ctx.doPost({ postData: { contents: JSON.stringify(b || {}) } }));
  return {
    modo: 'vm', hoy: HOY, FECHA_BANCO, MENSAJE_AUTH, uuid: uuid, hojas: { obra: obra._hojas, asistencias: asis._hojas }, ctx: { obra, asis },
    perfiles: Object.keys(PERFILES_VM),
    credenciales: { admin: { usuario: 'admin', clave: '1234' } },   // clave en claro en la semilla de USUARIOS
    obra: { get: get(obra), post: post(obra) },
    asistencias: { get: get(asis), post: post(asis) },
    parte: { get: (p) => get(obra)(Object.assign({ mod: 'parte' }, p || {})), post: (b) => post(obra)(Object.assign({ mod: 'parte' }, b || {})) },
    async sesion(perfil){ const p = PERFILES_VM[perfil || 'admin']; if (!p) return null; return obra.emitirToken_(p.usuario, p.rol, []); }
  };
}
function clon(o){ return JSON.parse(JSON.stringify(o)); }   // la respuesta viaja como JSON: se compara lo que viajaría

/* =====================================================================================================
 * 3 · Fachada `api` — modo url
 *   opciones: { base:'https://api.galca.app/prueba' } o { obra:'…/exec', asistencias:'…/exec' } (parte = obra),
 *             perfiles: { admin:{usuario,clave}, capataz:{usuario,clave}, … }  (el token sale de action=login en obra)
 * ===================================================================================================== */
function apiUrl(op){
  const base = String(op.base || '').replace(/\/+$/, '');
  const urls = { obra: op.obra || (base && base + '/obra'), asistencias: op.asistencias || (base && base + '/asistencias') };
  urls.parte = op.parte || urls.obra;   // el Parte vive en el mismo proyecto que obra (mismo /exec); en el Worker /parte no exige token
  if (!urls.obra || !urls.asistencias) throw new Error('Modo url: falta --url (base del Worker) o --obra/--asistencias (URLs /exec).');
  const tokens = {}, perfiles = op.perfiles || {};
  async function pedir(url, metodo, params, body){
    const u = new URL(url); Object.keys(params || {}).forEach(k => { if (params[k] !== undefined) u.searchParams.set(k, String(params[k])); });
    const init = { method: metodo, redirect: 'follow', headers: {} };
    if (metodo === 'POST'){ init.headers['Content-Type'] = 'text/plain;charset=utf-8'; init.body = JSON.stringify(body || {}); }   // igual que auth.js
    const r = await fetch(u.toString(), init); const txt = await r.text();
    try { return JSON.parse(txt); }
    catch (err){ throw new Error('Respuesta no JSON (' + r.status + ') de ' + metodo + ' ' + u.pathname + ': ' + txt.slice(0, 160).replace(/\s+/g, ' ')); }
  }
  const api = {
    modo: 'url', hoy: HOY, FECHA_BANCO, MENSAJE_AUTH, uuid: uuid, hojas: null, urls,
    perfiles: Object.keys(perfiles), credenciales: perfiles,
    obra: { get: (p) => pedir(urls.obra, 'GET', p), post: (b) => pedir(urls.obra, 'POST', null, b) },
    asistencias: { get: (p) => pedir(urls.asistencias, 'GET', p), post: (b) => pedir(urls.asistencias, 'POST', null, b) },
    parte: { get: (p) => pedir(urls.parte, 'GET', Object.assign({ mod: 'parte' }, p || {})), post: (b) => pedir(urls.parte, 'POST', null, Object.assign({ mod: 'parte' }, b || {})) },
    async sesion(perfil){
      perfil = perfil || 'admin'; const c = perfiles[perfil]; if (!c) throw new SinPerfil(perfil);   // el ejecutor lo cuenta como OMITIDO
      if (tokens[perfil]) return tokens[perfil];
      const r = await api.obra.post({ action: 'login', usuario: c.usuario, clave: c.clave });
      if (!r || !r.ok || !r.token) throw new Error('login del perfil «' + perfil + '» (' + c.usuario + ') falló: ' + JSON.stringify(r).slice(0, 200));
      tokens[perfil] = r.token; return r.token;
    }
  };
  return api;
}
function uuid(){ return 'contrato-' + crypto.randomUUID(); }

/* =====================================================================================================
 * 4 · Ejecutor de casos. Un caso = { id, modulo, nombre, escribe, soloVm, perfil?, run(api, t) }.
 *   t.ok(nombre, condicion, extra)  — una comprobación
 *   t.omitir(motivo)                — el caso no aplica en este destino (no cuenta como fallo)
 * ===================================================================================================== */
async function correrCasos(api, casos, op){
  op = op || {};
  const res = { casos: 0, comprobaciones: 0, fallos: 0, omitidos: 0, detalle: [] };
  for (const c of casos){
    if (op.filtro && !op.filtro(c)) continue;
    res.casos++;
    const fallas = [], oks = []; let omitido = null;
    const t = {
      ok(n, cond, extra){ res.comprobaciones++; if (cond) oks.push(n); else { res.fallos++; fallas.push(n + (extra !== undefined ? '  → ' + recorta(extra) : '')); } },
      omitir(m){ omitido = m; throw new Omision(m); }
    };
    let motivoOmision = null;
    if (c.soloVm && api.modo !== 'vm') motivoOmision = 'solo tiene sentido en modo vm (mira el estado interno o muta el código)';
    else if (c.escribe && api.modo === 'url' && !op.escribir) motivoOmision = 'escribe: contra una URL solo corre con --escribir';
    else if (c.perfil && !api.credenciales[c.perfil] && !(api.modo === 'vm')) motivoOmision = 'sin credenciales del perfil «' + c.perfil + '»';
    if (motivoOmision){ res.omitidos++; res.detalle.push({ id: c.id, estado: 'omitido', motivo: motivoOmision }); if (!op.silencio) console.log('  – ' + c.id + ' · ' + c.nombre + '  [omitido: ' + motivoOmision + ']'); continue; }
    try { await c.run(api, t); }
    catch (err){
      if (err instanceof Omision || err instanceof SinPerfil){ const m = omitido || err.message; res.omitidos++; res.detalle.push({ id: c.id, estado: 'omitido', motivo: m }); if (!op.silencio) console.log('  – ' + c.id + ' · ' + c.nombre + '  [omitido: ' + m + ']'); continue; }
      res.fallos++; fallas.push('EXCEPCIÓN: ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : String(err)));
    }
    const estado = fallas.length ? 'fallo' : 'ok';
    res.detalle.push({ id: c.id, estado, oks, fallas });
    if (!op.silencio){
      console.log((fallas.length ? '  ✗ ' : '  ✓ ') + c.id + ' · ' + c.nombre + (fallas.length ? '' : '  (' + oks.length + ')'));
      fallas.forEach(f => console.log('      ✗ ' + f));
      if (op.verboso) oks.forEach(o => console.log('      ✓ ' + o));
    }
  }
  return res;
}
class Omision extends Error {}
class SinPerfil extends Error { constructor(p){ super('sin credenciales del perfil «' + p + '»'); this.perfil = p; } }
function recorta(x){ const s = typeof x === 'string' ? x : JSON.stringify(x); return s === undefined ? '' : s.slice(0, 220); }

/* Comprobadores de FORMA, comunes a todos los módulos: lo que las pantallas leen de cada respuesta. */
const tiene = (o, claves) => !!o && claves.every(k => Object.prototype.hasOwnProperty.call(o, k));
const faltan = (o, claves) => claves.filter(k => !o || !Object.prototype.hasOwnProperty.call(o, k));
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const esLista = Array.isArray;

module.exports = { HOY, FECHA_BANCO, SECRETO_BANCO, MENSAJE_AUTH, hojaFalsa, servicios, cargarObra, cargarAsis, apiVm, apiUrl, correrCasos,
  tiene, faltan, esFecha, esLista, uuid, REPO };
