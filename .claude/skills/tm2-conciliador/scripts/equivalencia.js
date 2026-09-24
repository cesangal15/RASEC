#!/usr/bin/env node
/**
 * equivalencia.js — compara lo que exportó la HERRAMIENTA (conciliador/index.html) con lo que generó
 * `conciliar.js` para las MISMAS bases, proforma(s), contratista, quincena y configuración.
 *
 *   node equivalencia.js --herramienta=<carpeta con los exportes del navegador> --skill=<carpeta de conciliar.js>
 *                        [--tol=0.001] [--max=30]
 *
 * · .xlsx: empareja por prefijo (bloque_acta_, bloque_acta_pendientes_, digitadora_, resumen_) y compara
 *   celda a celda (números con tolerancia, texto exacto).
 * · conciliador_sesion_*.json: compara reclamo a reclamo (remisión, estado, candidato ámbito/fila, marcas).
 *   Exporta la sesión de la herramienta con 💾 JUSTO tras el Paso 4 (antes de decisiones manuales o del OCR),
 *   o las diferencias serán las decisiones que tomaste a mano, no la lógica.
 * Código de salida: 0 = equivalentes · 1 = diferencias · 2 = error de uso.
 */
'use strict';
const fs = require('fs'), path = require('path');
const { requerirXLSX } = require('./cargar_conciliador.js');
const XLSX = requerirXLSX();

const args = {};
process.argv.slice(2).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });
if (!args.herramienta || !args.skill) { console.error('Uso: node equivalencia.js --herramienta=<carpeta> --skill=<carpeta>'); process.exit(2); }
const TOL = parseFloat(args.tol || '0.001'), MAX = parseInt(args.max || '30', 10);
const ls = d => fs.statSync(d).isDirectory() ? fs.readdirSync(d).map(f => path.join(d, f)) : [d];
const H = ls(args.herramienta), K = ls(args.skill);
// Orden: el prefijo más largo primero (bloque_acta_pendientes_ antes que bloque_acta_).
const PREF = ['bloque_acta_pendientes_', 'bloque_acta_', 'digitadora_', 'resumen_'];
const tipo = f => { const b = path.basename(f); for (const p of PREF) if (b.indexOf(p) === 0) return p; return /conciliador_sesion_.*\.json$/.test(b) ? 'sesion' : null; };
const buscar = (lista, t, ext) => lista.find(f => tipo(f) === t && f.endsWith(ext));

function norm(v){
  if (typeof v === 'number') return { t: 'n', v };
  const s = String(v == null ? '' : v).trim();
  if (s !== '' && /^-?\d+(\.\d+)?$/.test(s)) return { t: 'n', v: Number(s) };
  return { t: 's', v: s };
}
const igual = (a, b) => { const x = norm(a), y = norm(b); return (x.t === 'n' && y.t === 'n') ? Math.abs(x.v - y.v) <= TOL : x.t === y.t && x.v === y.v; };

let difs = 0, comparados = 0;
for (const t of PREF) {
  const a = buscar(H, t, '.xlsx'), b = buscar(K, t, '.xlsx');
  if (!a && !b) continue;
  if (!a || !b) { console.log('– ' + t + '*.xlsx solo en ' + (a ? 'herramienta' : 'skill') + ' (no se compara)'); continue; }
  comparados++;
  const wa = XLSX.readFile(a), wb = XLSX.readFile(b);
  const A = XLSX.utils.sheet_to_json(wa.Sheets[wa.SheetNames[0]], { header: 1, raw: true, defval: '' });
  const B = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
  let n = 0;
  if (A.length !== B.length) { n++; console.log('  ✗ ' + t + ': filas ' + A.length + ' vs ' + B.length); }
  for (let r = 0; r < Math.max(A.length, B.length); r++) {
    const fa = A[r] || [], fb = B[r] || [];
    for (let c = 0; c < Math.max(fa.length, fb.length); c++) if (!igual(fa[c], fb[c])) {
      n++; if (n <= MAX) console.log('  ✗ ' + t + ' ' + XLSX.utils.encode_cell({ r, c }) + ': herramienta=' + JSON.stringify(fa[c]) + ' skill=' + JSON.stringify(fb[c]));
    }
  }
  console.log((n ? '✗ ' : '✓ ') + t + '*.xlsx: ' + Math.max(A.length - 1, 0) + ' filas, ' + n + ' diferencia(s)');
  difs += n;
}

const sa = buscar(H, 'sesion', '.json'), sb = buscar(K, 'sesion', '.json');
if (sa && sb) {
  comparados++;
  const clave = rc => [rc.archivo, rc.hoja, rc.fila, rc.remision || rc.raw].join('|');
  const resumen = rc => ({ estado: rc.estado, cand: rc.candidato ? (rc.candidato.ambito || '') + ':' + rc.candidato.fila : '', marcas: (rc.marcas || []).slice().sort().join(',') });
  const ma = new Map(JSON.parse(fs.readFileSync(sa, 'utf8')).corte.reclamos.map(rc => [clave(rc), resumen(rc)]));
  const mb = new Map(JSON.parse(fs.readFileSync(sb, 'utf8')).corte.reclamos.map(rc => [clave(rc), resumen(rc)]));
  let n = 0;
  for (const k of new Set([...ma.keys(), ...mb.keys()])) {
    const x = ma.get(k), y = mb.get(k);
    if (JSON.stringify(x) !== JSON.stringify(y)) { n++; if (n <= MAX) console.log('  ✗ reclamo ' + k + ': herramienta=' + JSON.stringify(x) + ' skill=' + JSON.stringify(y)); }
  }
  console.log((n ? '✗ ' : '✓ ') + 'sesión: ' + ma.size + ' vs ' + mb.size + ' reclamos, ' + n + ' diferencia(s)');
  difs += n;
}
if (!comparados) { console.error('No encontré nada que comparar (¿carpetas correctas?).'); process.exit(2); }
console.log(difs ? '\n✗ NO equivalentes (' + difs + ' diferencias).' : '\n✓ Equivalentes.');
process.exit(difs ? 1 : 0);
