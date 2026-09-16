/**
 * csv.js — lector RFC 4180 mínimo para los CSV del volcado (backend/volcado/VolcadoCSV.gs):
 * UTF-8 (con o sin BOM), coma, comillas dobles con `""` escapado, saltos \n o \r\n dentro de comillas.
 * Devuelve { encabezados:[…], filas:[[…], …] } con TODO como texto ('' = celda vacía).
 */
export function parseCsv(texto){
  const s = String(texto || '').replace(/^﻿/, '');
  const filas = []; let fila = [], campo = '', enComillas = false, i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (enComillas) {
      if (ch === '"') { if (s[i + 1] === '"') { campo += '"'; i += 2; continue; } enComillas = false; i++; continue; }
      campo += ch; i++; continue;
    }
    if (ch === '"') { enComillas = true; i++; continue; }
    if (ch === ',') { fila.push(campo); campo = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; i++; continue; }
    campo += ch; i++;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  const encabezados = (filas.shift() || []).map(h => String(h).trim());
  // filas totalmente vacías (cola del volcado) fuera
  return { encabezados, filas: filas.filter(f => f.some(v => v !== '')) };
}
/* Filas como objetos {encabezado: valor}. */
export function csvObjetos(texto){
  const { encabezados, filas } = parseCsv(texto);
  return filas.map(f => { const o = {}; encabezados.forEach((h, j) => { o[h] = f[j] === undefined ? '' : f[j]; }); return o; });
}
