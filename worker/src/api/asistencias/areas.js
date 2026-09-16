/**
 * api/asistencias/areas.js — áreas por usuario y filtros de área de ASISTENCIAS (4.01 · Fase 3 · D180).
 *
 * Es el bloque de áreas de backend/CodigoAsistencias.gs (L1166–L1260) con los MISMOS nombres y la MISMA
 * lógica. Los usuarios cableados (residente_odt/odl/dren, duvan, residente_uf3, angie, residente/jeisson)
 * se quedan en código tal cual (decisión 12): son reglas de negocio, no datos.
 *
 * Qué cambia respecto al .gs:
 *   · `norm` (L892) vive en comun.js y aquí solo se importa (NO se sustituye por normTexto: cambiaría las
 *     comparaciones de usuarios/áreas).
 *   · areasEfectivas recibe el OBJETO de la petición ya con `usuario`/`_rol` sembrados desde el token
 *     (D109), no `e.parameter`: el cliente no puede inventar la identidad. Lee pet.usuario y pet.area.
 *   · Lo que consulta CUADRILLAS (areaDeCuadrillaMap, cuadrillasDeUsuario) vive en ./catalogos.js y pasa a
 *     async sobre c.memo; por eso cuadrillaPermitidaPara y areaDeReportante son async y reciben `c`.
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 */
import { norm } from '../../comun.js';
import { areaDeCuadrillaMap, cuadrillasDeUsuario } from './catalogos.js';

// L1194 — lista blanca de &area= (D101: `uf3` entró en ella).
export const AREAS_VALIDAS = ['tierras','odt','odl','uf3'];

/* L1166–L1186 areasDeUsuario — ARRAY de áreas que revisa/reporta un usuario (cableado, D72/D84/D88/D101/D119):
 *   residente_odt→['odt']; residente_odl→['odl']; residente_dren→['odt','odl']; duvan→['odt','odl'];
 *   residente_uf3→['uf3']; angie→['tierras','odt','odl']; residente|jeisson→['tierras']; admin/otro→[] (sin filtro).
 * SÍNCRONA (no toca la BD). */
export function areasDeUsuario(usuario){
  const u=norm(usuario);
  if(u==='residente_odt')  return ['odt'];
  if(u==='residente_odl')  return ['odl'];
  if(u==='residente_dren') return ['odt','odl'];   // D84: residente de drenajes unificado
  if(u==='duvan')          return ['odt','odl'];   // D88: el jeisson de drenajes (solo asistencias)
  if(u==='residente_uf3')  return ['uf3'];         // D101: residente de UF3 (proyecto 3703)
  if(u==='angie')          return ['tierras','odt','odl'];  // D119: asistencias de TM2 Sur (tres áreas)
  if(u==='residente' || u==='jeisson') return ['tierras'];
  return [];   // admin: sin filtro (puede filtrar por &area=)
}

/* L1214–L1223 areasEfectivas — áreas efectivas de una petición: las forzadas por el usuario y, si NO tiene
 * (admin), un &area= de filtro. [] = sin filtro. D116/D119: `pet.area` admite varias (coma-separadas) y se
 * INTERSECTA con las forzadas (acota, nunca amplía). `pet` = objeto de la petición (pet.usuario / pet.area).
 * SÍNCRONA; `c` se acepta por uniformidad de firma (no se usa). */
export function areasEfectivas(c, pet){
  pet=pet||{};
  const forzadas=areasDeUsuario(pet.usuario||'');
  const pedidas=String(pet.area||'').split(',')
    .map(function(s){ return norm(s); })
    .filter(function(a,i,arr){ return AREAS_VALIDAS.indexOf(a)>=0 && arr.indexOf(a)===i; });
  if(!pedidas.length) return forzadas;          // sin filtro pedido: manda el rol ([] = admin, todas)
  if(!forzadas.length) return pedidas;          // admin: el filtro manda (D116)
  const inter=pedidas.filter(function(a){ return forzadas.indexOf(a)>=0; });
  return inter.length ? inter : forzadas;       // intersección vacía = el parámetro se ignora
}

// L1225 cuadrillaEnAreas — ¿la cuadrilla cae dentro de las áreas dadas? [] = sin filtro (todas). SÍNCRONA.
// `cuadArea` = mapa cuadrilla→área (areaDeCuadrillaMap); cuadrilla desconocida = 'tierras'.
export function cuadrillaEnAreas(cuadrilla, areas, cuadArea){
  return !areas.length || areas.indexOf((cuadArea&&cuadArea[cuadrilla])||'tierras')>=0;
}

/* L1230–L1234 cuadrillaPermitidaPara — al ESCRIBIR, un usuario con área forzada solo puede tocar cuadrillas
 * de su área; quien no tiene área forzada (capataces, mairy, admin) pasa sin restricción (D101/D69h). */
export async function cuadrillaPermitidaPara(c, usuario, cuadrilla){
  const areas=areasDeUsuario(usuario);
  if(!areas.length) return true;
  return cuadrillaEnAreas(cuadrilla, areas, await areaDeCuadrillaMap(c));
}

/* L1253–L1260 areaDeReportante — área de quien REPORTA (para filtrar CC_USADOS): residente de UNA área por
 * su rol; capataz/mairy por sus cuadrillas si todas son de la misma área. Mezcla, multi-área o desconocido
 * = '' (sin filtro). */
export async function areaDeReportante(c, usuario){
  const porRol=areasDeUsuario(usuario);
  if(porRol.length===1) return porRol[0];   // residente_odt/odl, residente/jeisson (tierras)
  if(porRol.length>1)   return '';           // D84: residente_dren ve los CC de ambas áreas
  const cuads=await cuadrillasDeUsuario(c, usuario), map=await areaDeCuadrillaMap(c); let a=null;
  for(let i=0;i<cuads.length;i++){ const ar=map[cuads[i]]||'tierras'; if(a===null) a=ar; else if(a!==ar) return ''; }
  return a===null ? '' : a;
}
