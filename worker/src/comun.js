/**
 * comun.js — helpers de Codigo.gs que el backend portado reutiliza (4.01 · Fase 2 · D180).
 *
 * MISMOS NOMBRES que en backend/Codigo.gs para que las decisiones D-xxx sigan siendo rastreables:
 * fdate / toDate / fdateValida_ (D106), normTexto, valEsquema_ / valListaDe_ / rechazoPayload_ (D166),
 * emitirToken_ / verificarToken_ / sesion_ / puerta_ (D109), rateLimit_ / respuestaRateLimit_ (D166),
 * logIdentidad_ / logMarcar_ / logEscribir_ (D166: una fila de LOG por petición).
 *
 * Diferencias con Apps Script, y por qué:
 *   · No hay globales por petición (`_log`, `_t0`): en un Worker conviven peticiones en el mismo isolate.
 *     Todo viaja en `c` (contexto de petición): { sql, env, secreto, authV, pet:{t0, log}, memo }.
 *   · `json(c, o)` devuelve el OBJETO (con `_ms`); quien responde HTTP es src/index.js.
 *   · HMAC con WebCrypto (async) en vez de Utilities.computeHmacSha256Signature. El formato del token
 *     es byte a byte el mismo (`base64url(JSON).base64url(HMAC-SHA256)`, sin `=`), así un token
 *     emitido por el Apps Script de obra se verifica aquí con el MISMO secreto (AUTH_SECRETO).
 *   · Rate limit en memoria del isolate (ventana fija), aproximado como el respaldo de index.js:
 *     cada nodo cuenta lo suyo. Falla abierto, igual que CacheService caído.
 */

export const OBRA_ID = 'tm2sur';
export const ZONA_HORARIA = 'America/Bogota';
export const AUTH_MSG_GENERICO = 'Sesión no válida. Vuelve a entrar.';
export const AUTH_ESTRICTO = true;

/* ---------- respuesta ---------- */
export function json(c, o){
  if(c && c.pet && o && typeof o==='object' && o._ms===undefined) o._ms = Date.now() - c.pet.t0;
  return o;
}

/* ---------- fechas y texto (Codigo.gs L231–L255, L710) ---------- */
export function hoyBogota(){ return new Date().toLocaleDateString('en-CA', { timeZone: ZONA_HORARIA }); }
export function fdate(v){
  if(v === null || v === undefined || v === '') return '';
  if(typeof v === 'object' && typeof v.getFullYear === 'function')
    return v.getFullYear()+'-'+('0'+(v.getMonth()+1)).slice(-2)+'-'+('0'+v.getDate()).slice(-2);
  return String(v).slice(0,10);
}
export function toDate(s){ const p=String(s||'').slice(0,10).split('-'); if(p.length<3) return ''; return new Date(Number(p[0]),Number(p[1])-1,Number(p[2])); }
export function fdateValida_(v){
  const s=fdate(v);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const p=s.split('-'), y=Number(p[0]), m=Number(p[1]), d=Number(p[2]);
  const dt=new Date(y, m-1, d);
  return (dt.getFullYear()===y && dt.getMonth()===m-1 && dt.getDate()===d) ? s : '';
}
export function normTexto(s){
  return String(s==null?'':s)
    .replace(/[   ​‌‍﻿]/g,' ')
    .toUpperCase()
    .replace(/[ÁÀÂÄ]/g,'A').replace(/[ÉÈÊË]/g,'E').replace(/[ÍÌÎÏ]/g,'I')
    .replace(/[ÓÒÔÖ]/g,'O').replace(/[ÚÙÛÜ]/g,'U').replace(/Ñ/g,'N')
    .replace(/\s+/g,' ').trim();
}
export function ccCorto(centroCosto){ const m=String(centroCosto==null?'':centroCosto).match(/(\d{2}\.\d{2})\s*$/); return m?m[1]:''; }

/* ---------- LOG (D166) — una fila en la tabla `log` por petición, al final, nunca falla ---------- */
export const LOG_MAX_MOTIVO = 200;
export function logIniciar_(c, action){ c.pet.log = { usuario:'', rol:'', action:String(action||''), resultado:'', motivo:'', silencio:false }; }
export function logAction_(c, action){ if(c.pet.log) c.pet.log.action = String(action||''); }
export function logIdentidad_(c, usuario, rol){ if(c.pet.log){ c.pet.log.usuario = String(usuario||''); c.pet.log.rol = String(rol||''); } }
export function logSesion_(c, ses){ if(ses) logIdentidad_(c, ses.usuario, ses.rol); }
export function logMarcar_(c, resultado, motivo){
  const l=c.pet.log; if(!l) return;
  l.resultado = String(resultado||'');
  if(motivo !== undefined) l.motivo = String(motivo==null?'':motivo);
}
export async function logEscribir_(c, modulo){
  const l=c.pet.log; c.pet.log=null;
  if(!l || l.silencio || !c.sql) return;
  try{
    const ms = Date.now() - c.pet.t0;
    await c.sql`INSERT INTO log (obra_id, modulo, usuario, rol, action, resultado, motivo, ms)
      VALUES (${OBRA_ID}, ${modulo||'parte'}, ${l.usuario}, ${l.rol}, ${l.action}, ${l.resultado || 'ok'}, ${String(l.motivo||'').slice(0, LOG_MAX_MOTIVO)}, ${ms})`;
  }catch(err){ /* LOG no escrito: la petición ya respondió */ }
}

/* ---------- rate limit (D166) — ventana fija en memoria del isolate ---------- */
export const RL_LIMITE       = 60;
export const RL_LIMITE_LOGIN = 10;
export const RL_VENTANA_S    = 60;
const _rl = new Map();
export function rateLimit_(identidad, action, limite, ventanaS){
  try{
    const v=ventanaS || RL_VENTANA_S;
    const clave='rl:'+String(identidad||'anon').toLowerCase().slice(0,60)+':'+String(action||'').toLowerCase().slice(0,40)
               +':'+Math.floor(Date.now()/(v*1000));
    if(_rl.size > 10000) _rl.clear();
    const n=Number(_rl.get(clave) || 0);
    _rl.set(clave, n+1);
    if(n >= limite) return { ok:false, primero:(n===limite) };
    return { ok:true };
  }catch(err){ return { ok:true }; }
}
export function respuestaRateLimit_(c, rl){
  if(c.pet.log){ if(rl && rl.primero) logMarcar_(c, 'rechazado','rate_limit'); else c.pet.log.silencio=true; }
  return json(c, { ok:false, error:'rate_limit', detalle:'Demasiadas peticiones seguidas. Espera un minuto y vuelve a intentar.' });
}

/* ---------- token HMAC (D109) — mismo formato que emitirToken_/verificarToken_ de Codigo.gs ---------- */
const _enc = new TextEncoder(), _dec = new TextDecoder();
function _b64url_(bytes){
  let s=''; const b=new Uint8Array(bytes); for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function _b64urlDecode_(s){
  let t=String(s||'').replace(/-/g,'+').replace(/_/g,'/'); while(t.length%4) t+='=';
  const bin=atob(t), out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
  return out;
}
const _claves = new Map();
async function _claveHmac_(secreto){
  if(_claves.has(secreto)) return _claves.get(secreto);
  const k=await crypto.subtle.importKey('raw', _enc.encode(secreto), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  _claves.set(secreto, k); return k;
}
export async function _firmar_(txt, secreto){
  return _b64url_(await crypto.subtle.sign('HMAC', await _claveHmac_(secreto), _enc.encode(txt)));
}
export async function emitirToken_(usuario, rol, areas, secreto, authV){
  const carga={ u:String(usuario||''), r:String(rol||''), a:areas||[], v:String(authV||'1'), t:Date.now() };
  const p=_b64url_(_enc.encode(JSON.stringify(carga)));
  return p+'.'+(await _firmar_(p, secreto));
}
export async function verificarToken_(tok, secreto, authV){
  const s=String(tok||''), i=s.indexOf('.');
  if(i<1) return {ok:false, error:'Falta el token de sesión. Vuelve a entrar.'};
  const carga=s.slice(0,i), firma=s.slice(i+1);
  if((await _firmar_(carga, secreto))!==firma) return {ok:false, error:AUTH_MSG_GENERICO};
  let o;
  try{ o=JSON.parse(_dec.decode(_b64urlDecode_(carga))); }
  catch(err){ return {ok:false, error:'Sesión ilegible. Vuelve a entrar.'}; }
  if(String(o.v)!==String(authV||'1')) return {ok:false, error:'Sesión cerrada por el administrador. Vuelve a entrar con señal.'};
  return {ok:true, usuario:String(o.u||'').trim().toLowerCase(), rol:String(o.r||''), areas:Array.isArray(o.a)?o.a:[]};
}
export async function sesion_(c, tok){
  if(!c.secreto) return {ok:false, sinSecreto:true, error:'El Worker no tiene configurado AUTH_SECRETO (el mismo de mostrarSecretoAuth() en el Apps Script de obra).'};
  const r = tok ? await verificarToken_(tok, c.secreto, c.authV) : {ok:false, error:'Falta el token de sesión. Vuelve a entrar.'};
  if(r.ok) return r;
  if(!AUTH_ESTRICTO) return {ok:true, usuario:'', rol:'', tolerado:true};
  return r;
}
/* Puerta única (D109 + D166): verifica el token, anota la identidad en LOG y aplica 60/min por usuario+action.
 * Devuelve {ok:true, ses} o {ok:false, respuesta}. */
export async function puerta_(c, tok, action){
  const ses=await sesion_(c, tok);
  if(!ses.ok){
    logMarcar_(c, 'rechazado', 'token: '+String(ses.error||''));
    const msg = ses.sinSecreto ? ses.error : AUTH_MSG_GENERICO;
    return { ok:false, respuesta: json(c, { ok:false, auth:false, error:msg }) };
  }
  logSesion_(c, ses);
  if(ses.tolerado) logMarcar_(c, 'ok', 'tolerado');
  const rl=rateLimit_(ses.usuario || 'anon', action, RL_LIMITE);
  if(!rl.ok) return { ok:false, respuesta: respuestaRateLimit_(c, rl) };
  return { ok:true, ses:ses };
}

/* ---------- validación de payload (D166, Codigo.gs L2764–L2865) ---------- */
export const VAL_MAX_TEXTO       = 500;
export const VAL_MAX_TEXTO_LARGO = 2000;
export const VAL_MAX_FILAS       = 1000;
export const VAL_MAX_HORAS       = 24;
export const VAL_MAX_CANTIDAD    = 1000000;
export function valFechaMasDias_(iso, dias){
  const p=String(iso||'').split('-'); if(p.length<3) return '';
  const dt=new Date(Number(p[0]), Number(p[1])-1, Number(p[2])); dt.setDate(dt.getDate()+(dias||0));
  return dt.getFullYear()+'-'+('0'+(dt.getMonth()+1)).slice(-2)+'-'+('0'+dt.getDate()).slice(-2);
}
export function rechazoPayload_(c, campo, detalle){
  logMarcar_(c, 'rechazado', 'payload:'+campo+(detalle ? (' '+detalle) : ''));
  return json(c, { ok:false, error:'payload', campo:String(campo||''), detalle:String(detalle||'') });
}
function valTexto_(v, max){
  if(v===null || v===undefined) return '';
  if(typeof v==='object') return 'debe ser texto';
  const s=String(v); const m=max||VAL_MAX_TEXTO;
  if(s.length>m) return 'supera '+m+' caracteres';
  if(/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(s)) return 'contiene caracteres de control';
  return '';
}
function valNum_(v, min, max){
  if(v===null || v===undefined || v==='') return '';
  if(typeof v==='boolean' || typeof v==='object') return 'debe ser un número';
  const n = (typeof v==='number') ? v : Number(String(v).trim().replace(/\s/g,'').replace(',','.'));
  if(!isFinite(n)) return 'no es un número';
  if(n<min || n>max) return 'fuera de rango ('+min+' a '+max+')';
  return '';
}
function valEntero_(v, min, max){ const m=valNum_(v,min,max); if(m) return m; if(v===null||v===undefined||v==='') return ''; return Number(v)%1===0 ? '' : 'debe ser entero'; }
function valBool_(v){
  if(v===null || v===undefined || v==='') return '';
  if(typeof v==='boolean') return '';
  const s=String(v).trim().toLowerCase();
  return (['si','sí','no','true','false','1','0'].indexOf(s)>=0) ? '' : 'debe ser Sí/No';
}
function valLista_(v, opciones){
  if(v===null || v===undefined || v==='') return '';
  return (opciones.indexOf(String(v).trim().toLowerCase())>=0) ? '' : 'valor no admitido';
}
function valFecha_(v, diasFuturo){
  if(v===null || v===undefined || v==='') return '';
  const f=fdateValida_(v); if(!f) return 'fecha inválida';
  if(f > valFechaMasDias_(hoyBogota(), diasFuturo||0)) return 'fecha futura';
  if(f < '2020-01-01') return 'fecha anterior a 2020';
  return '';
}
function valHora_(v){
  if(v===null || v===undefined || v==='') return '';
  if(typeof v==='object' && typeof v.getHours==='function') return '';
  const s=String(v).trim(); if(s.length>12) return 'hora demasiado larga';
  return /^\d{1,2}[:.]\d{2}/.test(s) ? '' : 'hora no válida (HH:MM)';
}
function valArray_(v, max){
  if(v===null || v===undefined) return '';
  if(!Array.isArray(v)) return 'debe ser una lista';
  if(v.length>(max||VAL_MAX_FILAS)) return 'más de '+(max||VAL_MAX_FILAS)+' elementos';
  return '';
}
export function valEsquema_(obj, esquema, prefijo){
  if(obj===null || obj===undefined) return null;
  if(typeof obj!=='object' || Array.isArray(obj)) return { campo:prefijo||'payload', motivo:'debe ser un objeto' };
  const campos=Object.keys(esquema);
  for(let i=0;i<campos.length;i++){
    const k=campos[i], r=esquema[k], v=obj[k]; let m='';
    switch(r[0]){
      case 't':  m=valTexto_(v, r[1]||VAL_MAX_TEXTO); break;
      case 'tl': m=valTexto_(v, VAL_MAX_TEXTO_LARGO); break;
      case 'n':  m=valNum_(v, r[1], r[2]); break;
      case 'e':  m=valEntero_(v, r[1], r[2]); break;
      case 'b':  m=valBool_(v); break;
      case 'f':  m=valFecha_(v, r[1]||0); break;
      case 'h':  m=valHora_(v); break;
      case 'l':  m=valLista_(v, r[1]); break;
      case 'a':  m=valArray_(v, r[1]); break;
    }
    if(m) return { campo:(prefijo?prefijo+'.':'')+k, motivo:m };
  }
  return null;
}
export function valListaDe_(arr, esquema, nombre, max){
  const m=valArray_(arr, max); if(m) return { campo:nombre, motivo:m };
  if(!arr) return null;
  for(let i=0;i<arr.length;i++){
    if(arr[i]===null || arr[i]===undefined) continue;
    const f=valEsquema_(arr[i], esquema, nombre+'['+i+']'); if(f) return f;
  }
  return null;
}
