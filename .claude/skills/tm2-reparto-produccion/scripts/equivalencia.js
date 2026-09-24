#!/usr/bin/env node
/**
 * equivalencia.js — compara, celda a celda, el .xlsx que descargó la HERRAMIENTA (navegador) con el que
 * generó `reparto.js` para las MISMAS entradas y la MISMA configuración. Hojas: fact_jefe, reparto, cuadre.
 *
 *   node equivalencia.js --herramienta=<fact_jefe_…xlsx del navegador> --skill=<fact_jefe_…xlsx de reparto.js>
 *                        [--tol=0.001] [--max=30]
 *
 * Números: iguales si |a−b| ≤ tol. Fechas: se comparan como día (AAAA-MM-DD). Texto: exacto tras trim.
 * `id_registro` (col. A de fact_jefe) es un correlativo y SÍ se compara (mismo orden = misma lógica).
 * Código de salida: 0 = equivalentes · 1 = hay diferencias · 2 = error de uso.
 */
'use strict';
const path = require('path');
const { requerirXLSX } = require('./cargar_reparto.js');
const XLSX = requerirXLSX();

const args = {};
process.argv.slice(2).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });
if (!args.herramienta || !args.skill) { console.error('Uso: node equivalencia.js --herramienta=<xlsx> --skill=<xlsx> [--tol=0.001]'); process.exit(2); }
const TOL = parseFloat(args.tol || '0.001'), MAX = parseInt(args.max || '30', 10);

function aoa(archivo, hoja){
  const wb = XLSX.readFile(archivo, { cellDates: true });
  const ws = wb.Sheets[hoja];
  if (!ws) return null;
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
}
function norm(v){
  if (v instanceof Date) return { t: 'd', v: v.toISOString().slice(0, 10) };
  if (typeof v === 'number') return { t: 'n', v };
  const s = String(v == null ? '' : v).trim();
  if (s !== '' && !isNaN(Number(s)) && /^-?[\d.]+$/.test(s)) return { t: 'n', v: Number(s) };
  return { t: 's', v: s };
}
function igual(a, b){
  const x = norm(a), y = norm(b);
  if (x.t === 'n' && y.t === 'n') return Math.abs(x.v - y.v) <= TOL;
  return x.t === y.t && x.v === y.v;
}

let difs = 0;
for (const hoja of ['fact_jefe', 'reparto', 'cuadre']) {
  const A = aoa(args.herramienta, hoja), B = aoa(args.skill, hoja);
  if (!A || !B) { console.log('✗ ' + hoja + ': falta la hoja en ' + (!A ? 'herramienta' : 'skill')); difs++; continue; }
  let n = 0;
  if (A.length !== B.length) { console.log('✗ ' + hoja + ': filas ' + A.length + ' (herramienta) vs ' + B.length + ' (skill)'); n++; }
  const filas = Math.max(A.length, B.length);
  for (let r = 0; r < filas; r++) {
    const fa = A[r] || [], fb = B[r] || [];
    const cols = Math.max(fa.length, fb.length);
    for (let c = 0; c < cols; c++) {
      if (!igual(fa[c], fb[c])) {
        n++;
        if (n <= MAX) console.log('  ✗ ' + hoja + '!' + XLSX.utils.encode_cell({ r, c }) + ': herramienta=' + JSON.stringify(fa[c]) + ' skill=' + JSON.stringify(fb[c]));
      }
    }
  }
  console.log((n ? '✗ ' : '✓ ') + hoja + ': ' + (filas - 1) + ' filas de datos, ' + n + ' diferencia(s)');
  difs += n;
}
console.log(difs ? '\n✗ NO equivalentes (' + difs + ' diferencias).' : '\n✓ Equivalentes: misma salida celda a celda.');
process.exit(difs ? 1 : 0);
