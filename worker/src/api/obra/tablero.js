/**
 * api/obra/tablero.js — tablero de producción (foto publicada) de OBRA portado al Worker (4.01 · Fase 4 · D180).
 *
 * Es backend/Codigo.gs L3186–L3236 (D158 / D159 / D161) con los MISMOS nombres y el MISMO contrato, pero
 * contra la tabla `tablero` (esquema 001 L277: UNA fila por obra con `meta` y `foto` en jsonb) en vez de
 * la hoja TABLERO troceada en filas de 40.000 caracteres con prefijo '~':
 *
 *   GET  ?action=tablero               PÚBLICO (D159) → tableroLeer: {ok, foto:<jsonb|null>, meta:<jsonb|null>}
 *   POST {action:'tablero_guardar', foto}  TOKEN (D158) → tableroGuardar: UPSERT de la foto; {ok:true, meta}
 *
 * Qué cambia respecto al .gs y por qué:
 *   · Desaparecen los trozos y el prefijo '~': `tablero` ya guarda `foto`/`meta` como jsonb, así que no hay
 *     que trocear al escribir ni unir/parsear al leer (postgres.js devuelve el objeto). Se sigue calculando
 *     meta.caracteres = JSON.stringify(foto).length y meta.trozos = ceil(len/TABLERO_TROZO) para NO cambiar
 *     la forma de `meta` (el contrato comprueba trozos===1 con una foto chica).
 *   · La escritura es un único INSERT … ON CONFLICT (obra_id) DO UPDATE (no clearContent + setValues).
 *   · `meta.publicado` = fdate en Bogotá (hoyBogota()); `meta.usuario` = ses.usuario del token (no body).
 *   · El guard (D109) usa permiso_ de comun.js con la sesión de puerta_ (no `body._rol`).
 *
 * tableroLeer es PÚBLICO: index.js despacha ?action=tablero ANTES de la puerta y NO escribe LOG (pone
 * c.pet.log.silencio). obraDoGet_ (api/obra.js) también lo llama antes de puerta_.
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 */
import { OBRA_ID, json, hoyBogota, permiso_, logMarcar_, rechazoPayload_ } from '../../comun.js';

/* ---------- Codigo.gs L3182–L3186: constantes y guard de publicación ---------- */
const TABLERO_TROZO   = 40000;                 // tamaño de trozo de la hoja (se conserva solo para meta.trozos)
const TABLERO_ROLES_PUBLICAN = ['admin','jefe'];   // cableado, como en el .gs (decisión 12)
const VAL_MAX_FOTO_CHARS = 4000000;            // Codigo.gs L2964: 100 trozos de TABLERO_TROZO

// Codigo.gs L3186–L3188 — puedePublicarTablero_ (permiso_ sobre la sesión del token). `jefe` está en la
// lista, así que pasa ANTES de la rama 'SOLO LECTURA' de permiso_; un capataz recibe el 'Tu usuario no
// puede publicar la foto del tablero. No se guardó nada.'.
export function puedePublicarTablero_(ses){
  return permiso_(ses, TABLERO_ROLES_PUBLICAN, [], 'publicar la foto del tablero');
}

/* ---------- Codigo.gs L3190–L3210: GET ?action=tablero → {ok, foto:{...}|null, meta:{...}|null} ----------
 * SIN token: lectura pública (D159). En la hoja la foto iba troceada (40k por celda, prefijo '~'); en la
 * tabla `tablero` es UNA fila por obra con `foto` y `meta` en jsonb, así que no hay trozos que unir ni
 * JSON que parsear: postgres.js ya devuelve el objeto. Sin fila o con foto NULL → foto:null y el tablero
 * se queda con la suya: nunca una pantalla vacía. */
export async function tableroLeer(c){
  const filas = await c.sql`SELECT meta, foto FROM tablero WHERE obra_id=${OBRA_ID} LIMIT 1`;
  if(!filas.length) return json(c, {ok:true, foto:null, meta:null});
  const r = filas[0];
  const metaObj = jsonbObjeto_(r.meta), fotoObj = jsonbObjeto_(r.foto);
  const meta = (metaObj && Object.keys(metaObj).length) ? metaObj : null;
  // La foto puede venir de dos formas: el objeto tal cual (backfill / servidor viejo) o COMPRIMIDA
  // ({z:<gzip en base64>}, ver tableroGuardar). Si trae `z` se descomprime; si el descomprimido no es
  // JSON válido se devuelve null (el tablero se queda con la suya, nunca pantalla en blanco).
  let foto = fotoObj || null;
  if(foto && typeof foto.z === 'string' && !Array.isArray(foto.per)){
    try{ foto = JSON.parse(await gunzipB64_(foto.z)); }
    catch(err){ foto = null; }
  }
  return json(c, {ok:true, foto:foto, meta:meta});
}
// Un jsonb que postgres.js devuelve como objeto; o, si quedó guardado como TEXTO JSON (string escalar dentro del
// jsonb: pasa cuando se le entrega un string ya serializado, porque postgres.js vuelve a hacer JSON.stringify en
// los parámetros jsonb), se interpreta. Así una fila escrita con el doble encoding se sigue leyendo bien.
function jsonbObjeto_(v){
  if(v && typeof v==='object' && !Array.isArray(v)) return v;
  if(typeof v==='string' && v){ try{ const o=JSON.parse(v); return (o && typeof o==='object' && !Array.isArray(o)) ? o : null; }catch(err){ return null; } }
  return null;
}

/* ---------- Codigo.gs L3213–L3236: POST {action:'tablero_guardar', foto} → {ok, meta} ----------
 * Publica la foto para todos (D158). Guard de rol en el servidor (D109). La foto debe ser un objeto con
 * `per` no vacío; se conserva la validación de tamaño (VAL_MAX_FOTO_CHARS) que en el .gs hacía
 * validarPayloadObra_ antes de despachar, aquí también defensiva (el router la aplica primero). */
export async function tableroGuardar(c, body, ses){
  const permiso = puedePublicarTablero_(ses);
  if(!permiso.ok){ logMarcar_(c, 'rechazado', 'tablero: '+permiso.error); return json(c, {ok:false, error:permiso.error}); }

  const foto = body && body.foto;
  // Codigo.gs L2985–L2992 (rama tablero de validarPayloadObra_): foto, si viene, debe ser objeto.
  if(foto!==undefined && (foto===null || typeof foto!=='object' || Array.isArray(foto)))
    return rechazoPayload_(c, 'foto', 'debe ser un objeto');
  // Codigo.gs L3216 — foto vacía o sin períodos: no se guarda nada.
  if(!foto || !foto.per || !foto.per.length)
    return json(c, {ok:false, error:'La foto llegó vacía o sin períodos. No se guardó nada.'});

  let crudo;
  try{ crudo = JSON.stringify(foto); }
  catch(err){ return rechazoPayload_(c, 'foto', 'no serializable'); }
  if(crudo.length > VAL_MAX_FOTO_CHARS)
    return rechazoPayload_(c, 'foto', 'supera '+VAL_MAX_FOTO_CHARS+' caracteres');

  // Codigo.gs L3221–L3223: `meta` conserva su forma (caracteres/trozos) aunque ya no haya trozos reales.
  const meta = { generado:String(foto.generado||''), publicado:hoyBogota(),
                 usuario:String((ses && ses.usuario) || body.usuario || ''), periodos:foto.per.length,
                 caracteres:crudo.length, trozos:Math.ceil(crudo.length / TABLERO_TROZO) };

  // La foto se guarda COMPRIMIDA (gzip → base64) dentro de `foto` como {z:<base64>}. Motivo (16-sep-2026):
  // la foto real ronda ~190 KB y el Worker de Cloudflare, al empujar ese único write al pooler de Supabase,
  // se caía con "write CONNECTION_CLOSED" (el mismo síntoma que el backfill resolvió con lotes chicos). El
  // backfill —que corre en Node, no en el Worker— sí escribía esa foto entera. Comprimida baja a ~50 KB, muy
  // por debajo de lo que el Worker escribe sin problema. tableroLeer la descomprime; una foto vieja sin
  // comprimir (backfill) se sigue leyendo igual. La solución de fondo (cualquier tamaño) es Hyperdrive.
  const foto_z = { z: await gzipB64_(crudo) };

  // `::text::jsonb`: el parámetro viaja como TEXTO y Postgres lo convierte a jsonb. Sin el cast, postgres.js ve
  // la columna jsonb y le vuelve a aplicar JSON.stringify al string → se guardaba un texto entre comillas y
  // tableroLeer respondía foto:null (tablero público vacío tras el corte, 16-sep-2026).
  await c.sql`INSERT INTO tablero (obra_id, meta, foto, publicado_ts)
    VALUES (${OBRA_ID}, ${JSON.stringify(meta)}::text::jsonb, ${JSON.stringify(foto_z)}::text::jsonb, now())
    ON CONFLICT (obra_id) DO UPDATE SET meta=EXCLUDED.meta, foto=EXCLUDED.foto, publicado_ts=now()`;

  return json(c, {ok:true, meta:meta});
}

/* ---------- gzip ↔ base64 (Worker: CompressionStream/Buffer con nodejs_compat; Node: iguales en test) ----------
 * Se usan para encoger la foto antes del único write al pooler (ver tableroGuardar). base64 (texto ASCII, +33 %)
 * en vez de bytea (hex, +100 %) porque lo que importa es el tamaño EN EL CABLE del parámetro. */
async function gzipB64_(texto){
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter(); w.write(new TextEncoder().encode(texto)); w.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  return Buffer.from(buf).toString('base64');
}
async function gunzipB64_(b64){
  const ds = new DecompressionStream('gzip');
  const w = ds.writable.getWriter(); w.write(Buffer.from(b64, 'base64')); w.close();
  const buf = await new Response(ds.readable).arrayBuffer();
  return new TextDecoder().decode(buf);
}
