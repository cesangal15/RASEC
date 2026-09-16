/**
 * api/asistencias/catalogos.js — catálogos de ASISTENCIAS leídos de Postgres (4.01 · Fase 3 · D180).
 *
 * Es la parte de backend/CodigoAsistencias.gs que leía las hojas-catálogo (CUADRILLAS, CONFIG, FESTIVOS,
 * TURNOS, CAT_CC, CC_USADOS, CAT_MOTIVOS, MOTIVOS_USADOS, CAT_TRABAJADORES, PERSONAL) con los MISMOS
 * nombres de función y la MISMA lógica, sobre las tablas homónimas de la sección 5 del esquema
 * (worker/sql/001_esquema.sql). Desde 4.01 esos catálogos se editan en Supabase (Table Editor), no en el
 * Sheet: no hay pull Sheet→BD (decisión 1).
 *
 * Qué cambia respecto al .gs y por qué:
 *   · readSheet('X', HEADERS) + CacheService (cacheLeer_/cacheGuardar_, D99) → una consulta por tabla y
 *     PETICIÓN con memo_ (comun.js). No hay caché ENTRE peticiones (una escritura que después relee borra
 *     la clave del memo). cache_reset del router es un no-op (decisión 11).
 *   · Los lectores base (cuadrillas_, config_, festivos_, turnos_, catCC_, ccUsados_, catMotivos_,
 *     motivosUsados_, catTrabajadores_, personal_) devuelven la MISMA forma que readSheet: array de
 *     objetos por nombre de columna, con la normalización de NORMALIZA_HOJA (L756–L762) ya aplicada
 *     — fdate en fechas (FESTIVOS.fecha, PERSONAL.fecha_ingreso/fecha_retiro), ftime en horas
 *     (TURNOS.entrada/salida/descanso_*; CONFIG.valor solo si fuese Date, como getConfigMap). En la BD las
 *     horas ya son texto, pero ftime es idempotente ('7:00' del backfill/Table Editor → '07:00').
 *   · personal_: `_row` pasa a ser personal_id (decisión 6); ORDER BY personal_id. cat_cc/cc_usados/
 *     cat_motivos/motivos_usados ORDER BY orden (el .gs respetaba el orden de la hoja).
 *   · Los usuarios cableados (angie, duvan, residente_uf3, alias alejo/alejandro…) se quedan en código
 *     tal cual (decisión 12); areasDeUsuario vive en ./areas.js y aquí solo se importa.
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 */
import { OBRA_ID, memo_, ftime, norm, fdate } from '../../comun.js';
import { areasDeUsuario } from './areas.js';

/* Encabezados de hoja = columnas de tabla (CodigoAsistencias.gs L72–L122). Se conservan como referencia
 * de la FORMA que devuelve cada lector base (el mismo orden y nombres que readSheet). */
export const CUADRILLAS_HEADERS       = ['cuadrilla','responsables','area','estado'];
export const PERSONAL_HEADERS         = ['cedula','codigo','nombre','cargo','cuadrilla','responsable','estado','fecha_retiro','fecha_ingreso'];
export const CONFIG_HEADERS           = ['clave','valor'];
export const FESTIVOS_HEADERS         = ['fecha'];
export const TURNOS_HEADERS           = ['turno','tipo_dia','entrada','salida','descanso_ini','descanso_fin','cruza_medianoche'];
export const CAT_CC_HEADERS           = ['string_cc'];
export const CC_USADOS_HEADERS        = ['string_cc','area'];
export const CAT_MOTIVOS_HEADERS      = ['string_motivo'];
export const MOTIVOS_USADOS_HEADERS   = ['string_motivo'];
export const CAT_TRABAJADORES_HEADERS = ['codigo','string_navision'];

/* ======================================================================================================
 * Lectores base (una consulta por tabla y petición; memo_ de comun.js). Sustituyen a
 * readSheet('X', HEADERS) + NORMALIZA_HOJA (CodigoAsistencias.gs L756–L762).
 * ====================================================================================================== */
// CUADRILLAS_HEADERS L80 — {cuadrilla, responsables, area, estado} (todo texto). area ''=tierras, estado ''=activa.
export async function cuadrillas_(c){
  return memo_(c, 'asis:cuadrillas', async function(){
    const filas=await c.sql`SELECT cuadrilla, responsables, area, estado FROM cuadrillas WHERE obra_id=${OBRA_ID} ORDER BY cuadrilla`;
    return filas.map(function(r){ return { cuadrilla:r.cuadrilla, responsables:r.responsables, area:r.area, estado:r.estado }; });
  });
}
// CONFIG_HEADERS L86 — {clave, valor}. NORMALIZA_HOJA L757: valor solo Date→ftime; en la BD es texto (pasa tal cual).
export async function config_(c){
  return memo_(c, 'asis:config', async function(){
    const filas=await c.sql`SELECT clave, valor FROM config WHERE obra_id=${OBRA_ID} ORDER BY clave`;
    return filas.map(function(r){ return { clave:r.clave, valor:r.valor }; });
  });
}
// FESTIVOS_HEADERS L87 — {fecha}. NORMALIZA_HOJA L758: fdate (idempotente sobre el texto 'yyyy-MM-dd' de la BD).
export async function festivos_(c){
  return memo_(c, 'asis:festivos', async function(){
    const filas=await c.sql`SELECT fecha FROM festivos WHERE obra_id=${OBRA_ID} ORDER BY fecha`;
    return filas.map(function(r){ return { fecha:fdate(r.fecha) }; });
  });
}
// TURNOS_HEADERS L113 — NORMALIZA_HOJA L759–L760: ftime en entrada/salida/descanso_ini/descanso_fin.
// tipo_dia y cruza_medianoche quedan crudos (texto), como readSheet los devolvía (el export los normaliza aparte).
export async function turnos_(c){
  return memo_(c, 'asis:turnos', async function(){
    const filas=await c.sql`SELECT turno, tipo_dia, entrada, salida, descanso_ini, descanso_fin, cruza_medianoche
      FROM turnos WHERE obra_id=${OBRA_ID} ORDER BY turno, tipo_dia`;
    return filas.map(function(r){ return { turno:r.turno, tipo_dia:r.tipo_dia,
      entrada:ftime(r.entrada), salida:ftime(r.salida), descanso_ini:ftime(r.descanso_ini), descanso_fin:ftime(r.descanso_fin),
      cruza_medianoche:r.cruza_medianoche }; });
  });
}
// CAT_CC_HEADERS L91 — {string_cc}. Catálogo COMPLETO de CC, en orden de hoja (ORDER BY orden).
export async function catCC_(c){
  return memo_(c, 'asis:cat_cc', async function(){
    const filas=await c.sql`SELECT string_cc FROM cat_cc WHERE obra_id=${OBRA_ID} ORDER BY orden`;
    return filas.map(function(r){ return { string_cc:r.string_cc }; });
  });
}
// CC_USADOS_HEADERS L107 — {string_cc, area}. Subconjunto frecuente por área; ORDER BY orden.
export async function ccUsados_(c){
  return memo_(c, 'asis:cc_usados', async function(){
    const filas=await c.sql`SELECT string_cc, area FROM cc_usados WHERE obra_id=${OBRA_ID} ORDER BY orden`;
    return filas.map(function(r){ return { string_cc:r.string_cc, area:r.area }; });
  });
}
// CAT_MOTIVOS_HEADERS L94 — {string_motivo}. Catálogo completo de motivos; ORDER BY orden.
export async function catMotivos_(c){
  return memo_(c, 'asis:cat_motivos', async function(){
    const filas=await c.sql`SELECT string_motivo FROM cat_motivos WHERE obra_id=${OBRA_ID} ORDER BY orden`;
    return filas.map(function(r){ return { string_motivo:r.string_motivo }; });
  });
}
// MOTIVOS_USADOS_HEADERS L99 — {string_motivo}. Subconjunto frecuente; ORDER BY orden.
export async function motivosUsados_(c){
  return memo_(c, 'asis:motivos_usados', async function(){
    const filas=await c.sql`SELECT string_motivo FROM motivos_usados WHERE obra_id=${OBRA_ID} ORDER BY orden`;
    return filas.map(function(r){ return { string_motivo:r.string_motivo }; });
  });
}
// CAT_TRABAJADORES_HEADERS L88 — {codigo, string_navision}.
export async function catTrabajadores_(c){
  return memo_(c, 'asis:cat_trabajadores', async function(){
    const filas=await c.sql`SELECT codigo, string_navision FROM cat_trabajadores WHERE obra_id=${OBRA_ID} ORDER BY codigo`;
    return filas.map(function(r){ return { codigo:r.codigo, string_navision:r.string_navision }; });
  });
}
// PERSONAL_HEADERS L72 — objetos con las 9 columnas de la hoja + `_row` = personal_id (decisión 6).
// NORMALIZA_HOJA L761: fdate en fecha_ingreso/fecha_retiro (NULL → '', como celda vacía). ORDER BY personal_id.
export async function personal_(c){
  return memo_(c, 'asis:personal', async function(){
    const filas=await c.sql`SELECT personal_id, cedula, codigo, nombre, cargo, cuadrilla, responsable, estado, fecha_retiro, fecha_ingreso
      FROM personal WHERE obra_id=${OBRA_ID} ORDER BY personal_id`;
    return filas.map(function(r){
      return { cedula:r.cedula, codigo:r.codigo, nombre:r.nombre, cargo:r.cargo, cuadrilla:r.cuadrilla,
               responsable:r.responsable, estado:r.estado, fecha_retiro:fdate(r.fecha_retiro), fecha_ingreso:fdate(r.fecha_ingreso),
               _row:r.personal_id };
    });
  });
}

/* ======================================================================================================
 * Derivados de CONFIG / FESTIVOS (CodigoAsistencias.gs L1394–L1408)
 * ====================================================================================================== */
// L1394–L1407 getConfigMap — clave (trim) → valor. Duck-typing getHours→ftime (nunca instanceof Date, D31);
// en la BD el valor es texto y pasa tal cual (números y strings de proyecto incluidos).
export async function getConfigMap(c){
  const rows=await config_(c), m={};
  rows.forEach(function(r){
    if(!r.clave) return;
    let v=r.valor;
    if(v && typeof v==='object' && typeof v.getHours==='function') v=ftime(v);
    m[String(r.clave).trim()]=v;
  });
  return m;
}
// L1408 getFestivos — lista de 'yyyy-MM-dd'.
export async function getFestivos(c){
  return (await festivos_(c)).map(function(r){ return fdate(r.fecha); }).filter(Boolean);
}

/* ======================================================================================================
 * Derivados de CUADRILLAS (CodigoAsistencias.gs L1236–L1246, L1539–L1572, L2477)
 * ====================================================================================================== */
// L1236 areaDeCuadrillaMap — cuadrilla → área. Vacío o cuadrilla desconocida = 'tierras'.
export async function areaDeCuadrillaMap(c){
  const m={}; (await cuadrillas_(c)).forEach(function(r){ m[r.cuadrilla]=norm(r.area)||'tierras'; });
  return m;
}
// L1241 cuadrillaActiva — `estado` vacío = activa (retrocompatible, D84); solo 'inactiva' la saca. SÍNCRONA (recibe una fila).
export function cuadrillaActiva(r){ return norm(r.estado)!=='inactiva'; }
// L1246 cuadrillasInactivasSet — set con los NOMBRES de las cuadrillas inactivas.
export async function cuadrillasInactivasSet(c){
  const s={}; (await cuadrillas_(c)).forEach(function(r){ if(!cuadrillaActiva(r)) s[r.cuadrilla]=true; });
  return s;
}
// Catálogo de cuadrillas ACTIVAS (base de cuadrillasDeUsuario y del roster, L1543/L1668: readSheet(...).filter(cuadrillaActiva)).
// El roster le añade sus propios filtros (área, «con filas ese día») en la capa de lectura (Etapa 2).
export async function cuadrillasCat_(c){
  return (await cuadrillas_(c)).filter(cuadrillaActiva);
}
// L1539 usuarioAliases — alejo/alejandro: mismo capataz, dos nombres de login/hoja. SÍNCRONA.
export function usuarioAliases(u){
  if(u==='alejo' || u==='alejandro') return ['alejo','alejandro'];
  return [u];
}
// L1543 cuadrillasDeUsuario — cuadrillas ACTIVAS que le corresponde reportar a un usuario.
//   admin → todas; duvan/residente_uf3/angie → por sus áreas (areasDeUsuario); resto → por `responsables` (con alias).
export async function cuadrillasDeUsuario(c, usuario){
  const u=norm(usuario);
  const todas=await cuadrillasCat_(c);                       // D84: las inactivas salen de circulación
  if(u==='admin') return todas.map(function(r){ return r.cuadrilla; });
  if(u==='duvan' || u==='residente_uf3' || u==='angie'){
    const suyas=areasDeUsuario(u);
    return todas.filter(function(r){ return suyas.indexOf(norm(r.area)||'tierras')>=0; }).map(function(r){ return r.cuadrilla; });
  }
  const alias=usuarioAliases(u);
  return todas.filter(function(r){
    const lista=String(r.responsables||'').split(',').map(norm);
    return alias.some(function(a){ return lista.indexOf(a)>=0; });
  }).map(function(r){ return r.cuadrilla; });
}
// L2477 responsableDeCuadrilla — los `responsables` (crudos, coma-separados) de una cuadrilla; '' si no existe.
export async function responsableDeCuadrilla(c, cuadrilla){
  const rows=await cuadrillas_(c);
  const r=rows.find(function(x){ return x.cuadrilla===cuadrilla; });
  return r ? String(r.responsables||'') : '';
}

/* ======================================================================================================
 * Derivados de CC_USADOS / CAT_MOTIVOS (CodigoAsistencias.gs L1265–L1289)
 * ====================================================================================================== */
// L1265 ccExcluidosBloque — CC a ocultar del selector (CONFIG.cc_excluidos_bloque, coma-separado; default 'I010305').
export async function ccExcluidosBloque(c){
  const raw=String((await getConfigMap(c)).cc_excluidos_bloque||'I010305');
  return raw.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
}
// L1269 sinCCexcluidos — quita de `list` los CC que contengan (substring) alguno de los excluidos.
export async function sinCCexcluidos(c, list){
  const ex=await ccExcluidosBloque(c); if(!ex.length) return list;
  return list.filter(function(cc){ const s=String(cc||''); for(var i=0;i<ex.length;i++){ if(ex[i] && s.indexOf(ex[i])>=0) return false; } return true; });
}
// L1277–L1282 ccUsadosParaArea — string_cc de CC_USADOS que aplican al área dada (área ''=tierras).
// `area` puede ser un string ('odt') o un array (['odt','odl']); '' o [] = todas (admin/sin área forzada).
export async function ccUsadosParaArea(c, area){
  const areas = Array.isArray(area) ? area.filter(Boolean) : (area ? [area] : []);
  const rows=await ccUsados_(c);
  const filtrados=rows.filter(function(r){ return String(r.string_cc||'').trim() && (!areas.length || areas.indexOf(norm(r.area)||'tierras')>=0); })
    .map(function(r){ return String(r.string_cc).trim(); });
  return sinCCexcluidos(c, filtrados);
}
// L1285 motivosCatalogo — catálogo COMPLETO de motivos (para quien revisa el resumen).
export async function motivosCatalogo(c){
  return (await catMotivos_(c)).map(function(r){ return String(r.string_motivo||''); }).filter(Boolean);
}
// L1287–L1289 motivosUsados — subconjunto frecuente; vacío = catálogo completo (retrocompatible, D78).
export async function motivosUsados(c){
  const rows=(await motivosUsados_(c)).map(function(r){ return String(r.string_motivo||''); }).filter(Boolean);
  return rows.length ? rows : motivosCatalogo(c);
}

/* ======================================================================================================
 * Derivado de CAT_TRABAJADORES (CodigoAsistencias.gs L1971, dentro de exportDia)
 * ====================================================================================================== */
// L1971 — codigo (trim) → string_navision. Lo usa el export para poner el nombre Navision de cada persona.
export async function catTrabajadoresMap(c){
  const m={}; (await catTrabajadores_(c)).forEach(function(r){ if(r.codigo) m[String(r.codigo).trim()]=r.string_navision; });
  return m;
}
