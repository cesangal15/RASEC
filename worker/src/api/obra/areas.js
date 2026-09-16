/**
 * api/obra/areas.js — helpers de ÁREA/PROYECTO de OBRA portados al Worker (4.01 · Fase 4 · D180).
 *
 * Es el bloque de backend/Codigo.gs L2221–L2242 con los MISMOS nombres y la MISMA lógica: `areaDeFila`
 * (área de una fila de BANDEJA/MAQUINARIA), `areasDeReporte` (área(s) de la observación GENERAL, D86)
 * y `obsEnArea` (¿una observación pertenece al área consultada?, D86). No cambia nada: son cálculo puro
 * sobre strings, sin acceso a datos.
 *
 * `deriveArea` (Codigo.gs L2211: capítulo 06.* → odt, 07.* → odl, resto tierras) NO se duplica aquí: ya
 * vive en src/comun.js y se importa. Estas tres funciones son las de OBRA que la usan.
 *
 * Quién las usa: api/obra/lectura.js (bandeja/consolidado filtran por área con areaDeFila y obsEnArea) y
 * api/obra/reporte.js + api/obra/data.js (areasDeReporte fija el `area` de la observación general, D86).
 */
import { deriveArea } from '../../comun.js';

/* Codigo.gs L2221–L2226 — Área de una fila leída de BANDEJA/MAQUINARIA: manda la columna `area` si trae
 * un valor válido (odt/odl); si no (filas viejas, area=''), se deriva del CC (BANDEJA) o se asume tierras
 * (MAQUINARIA no lleva CC). */
export function areaDeFila(areaCol, cc){
  const a=String(areaCol==null?'':areaCol).trim().toLowerCase();
  if(a==='odt'||a==='odl') return a;
  return deriveArea(cc);
}

/* Codigo.gs L2228–L2234 — Área(s) de la observación GENERAL de un reporte (D86). La observación no cuelga
 * de una línea, así que su área se deriva de las líneas del envío: se devuelven las áreas distintas que
 * aparecen, en lista separada por comas ('odt,odl' cuando un capataz multi-área reporta los dos capítulos,
 * D84). Reporte sin líneas => 'tierras' (el comportamiento de siempre y el único que existía antes de esta
 * columna). Cada línea de `cantidades` trae `area` y `centro_costo` (VAL_OBRA_CANTIDAD). */
export function areasDeReporte(cantidades){
  const set={}, out=[];
  (cantidades||[]).forEach(function(c){ const a=areaDeFila(c.area, c.centro_costo); if(!set[a]){ set[a]=true; out.push(a); } });
  return out.length ? out.sort().join(',') : 'tierras';
}

/* Codigo.gs L2236–L2242 — ¿La observación (columna `area` de OBSERVACIONES) pertenece al área consultada?
 * (D86). Columna vacía = fila anterior a D86 = tierras. `area` puede ser una lista 'odt,odl'. */
export function obsEnArea(areaCol, areaQ){
  const raw=String(areaCol==null?'':areaCol).trim().toLowerCase();
  const lista = raw ? raw.split(',').map(function(s){ return s.trim(); }).filter(function(s){ return !!s; }) : ['tierras'];
  return lista.indexOf(areaQ)>=0;
}
