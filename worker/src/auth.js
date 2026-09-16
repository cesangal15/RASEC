/**
 * auth.js — LOGIN y emisión del token D109 en el Worker (4.01 · Fases 3–4 · D180).
 *
 * Es la rama `action==='login'` de doPost (backend/Codigo.gs L1095–L1106) más loginResultado_
 * (L3066–L3089), validarLogin_ (L2966) y VAL_OBRA_LOGIN (L2963), con los MISMOS nombres. Lee la tabla
 * `usuarios` (esquema 001 L286: copia de la hoja USUARIOS; desde 4.01 se edita en Supabase).
 *
 * Quién emite el token (decisión 10): el Worker, con el MISMO par (AUTH_SECRETO, AUTH_V) que los Apps
 * Script, así los tokens son intercambiables en los tres módulos (obra, asistencias, parte) y los
 * reportes encolados en los teléfonos no se pierden al conmutar BACKEND_OBRA a `db`. Mientras obra siga
 * en Sheets, el login lo hace el Apps Script y este archivo no se usa.
 *
 * Contraseñas (D108): `clave` puede estar en claro o como SHA-256 hex de `usuario:clave` (hashClave_,
 * comun.js). Si la guardada casa ES_HASH se compara el hash; si no, texto plano — igual que el .gs
 * (L3080). No se endurece al vuelo (el .gs tampoco lo hacía en el login): endurecerClaves L3137 no se porta.
 *
 * Solo lo usa api/obra.js (obraDoPost_ llama a login_ ANTES de puerta_). Va aparte para que asistencias
 * nunca lo toque y para 4.03 (usuarios por obra_id).
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo } (lo arma src/index.js por petición).
 */
import {
  OBRA_ID, json, emitirToken_, hashClave_, ES_HASH,
  logIdentidad_, logMarcar_, rateLimit_, respuestaRateLimit_, RL_LIMITE_LOGIN,
  valEsquema_, rechazoPayload_
} from './comun.js';

export { hashClave_, ES_HASH };   // por comodidad de quien importe solo auth.js (viven en comun.js)

// Mismo texto que sesion_ (comun.js) cuando el Worker no tiene AUTH_SECRETO: única causa que se dice al cliente (D109).
export const AUTH_MSG_SIN_SECRETO = 'El Worker no tiene configurado AUTH_SECRETO (el mismo de mostrarSecretoAuth() en el Apps Script de obra).';

/* ---------- Codigo.gs L2963 / L2966–L2969 ---------- */
export const VAL_OBRA_LOGIN = { usuario:['t',60], clave:['t',200] };
// Devuelve la RESPUESTA de rechazo (lista para `return`) o null si el payload pasa.
export function validarLogin_(c, body){
  const f=valEsquema_(body, VAL_OBRA_LOGIN, '');
  return f ? rechazoPayload_(c, f.campo, f.motivo) : null;
}

/* ---------- Codigo.gs L3066–L3089 ----------
 * POST {action:'login', usuario, clave} → {ok:true, usuario, rol, areas[], redirige, token} | {ok:false, error}
 * `readSheet('USUARIOS').filter(usuario en minúsculas)[0]` → SELECT … WHERE lower(trim(usuario)) LIMIT 1. */
export async function loginResultado_(c, body){
  const u = String(body.usuario||'').trim().toLowerCase();
  const cl = String(body.clave==null?'':body.clave);
  if(!u || !cl) return {ok:false, error:'Faltan el usuario o la contraseña.'};
  // Sin secreto no hay token que emitir: mensaje explícito (el mismo de sesion_), antes de tocar `usuarios`.
  if(!c.secreto) return {ok:false, sinSecreto:true, error:AUTH_MSG_SIN_SECRETO};
  const filas = await c.sql`SELECT usuario, clave, rol, areas, redirige, estado FROM usuarios
    WHERE obra_id=${OBRA_ID} AND lower(trim(usuario))=${u} ORDER BY usuario LIMIT 1`;
  // Mensaje ÚNICO para usuario inexistente, clave mala o cuenta inactiva: si se distinguieran, la
  // pantalla serviría para averiguar qué usuarios existen.
  const malo = {ok:false, error:'Usuario o contraseña incorrectos.'};
  if(!filas.length) return malo;
  const r = filas[0];
  const estado = String(r.estado||'').trim().toLowerCase();
  if(estado && estado!=='activo') return malo;
  const guardada = String(r.clave==null?'':r.clave).trim();
  if(!guardada) return malo;                                  // fila sin clave cargada todavía
  const ok = ES_HASH.test(guardada) ? ((await hashClave_(u, cl))===guardada) : (guardada===cl);
  if(!ok) return malo;
  const areas = String(r.areas||'').split(',').map(function(x){ return x.trim().toLowerCase(); }).filter(Boolean);
  const rol = String(r.rol||'').trim();
  // D109: el token FIRMADO es lo que a partir de ahora acredita quién eres y qué rol tienes. El
  // cliente lo guarda y lo adjunta a cada petición; no puede alterarlo sin romper la firma.
  return { ok:true, usuario:u, rol:rol, areas:areas,
           redirige:String(r.redirige||'').trim() || 'menu.html',
           token: await emitirToken_(u, rol, areas, c.secreto, c.authV) };
}

/* ---------- Codigo.gs L1095–L1106: la rama completa de doPost para action==='login' (D108 / D166) ----------
 * 10 intentos/min por usuario (el que el cliente DICE ser: aún no está autenticado) y validación de
 * tipos/longitud antes de tocar `usuarios`. El resultado del login queda en LOG. Devuelve el objeto de
 * respuesta (json(c, …)); api/obra.js lo llama ANTES de puerta_. */
export async function login_(c, body){
  const uLog=String(body.usuario==null?'':body.usuario).slice(0,60).trim().toLowerCase();
  logIdentidad_(c, uLog, '');
  const rl=rateLimit_(uLog||'anon', 'login', RL_LIMITE_LOGIN);
  if(!rl.ok) return respuestaRateLimit_(c, rl);
  const vl=validarLogin_(c, body); if(vl) return vl;
  const r=await loginResultado_(c, body);
  if(r.ok) logIdentidad_(c, r.usuario, r.rol);
  else if(r.sinSecreto) logMarcar_(c, 'error', 'login: sin AUTH_SECRETO');
  else logMarcar_(c, 'rechazado', 'login: credenciales');
  return json(c, r);
}
