#!/usr/bin/env node
/**
 * probar_conciliador.js — prueba de humo del skill SIN datos reales: arma una base GRANULARES (hoja
 * `BASE 2026`, encabezado en la fila 2, columnas de BASES_DEF) y una proforma con 4 remisiones, corre
 * `conciliar.js` y comprueba estados, exportes y que la salida sea determinista (equivalencia.js).
 *   1001 → ENCONTRADA · 1002 (UF3 en la base) → EXCLUIDA_UF3 · 9999 → NO_ENCONTRADA · 1001 repetida → DUPLICADA
 *   1003 → ENCONTRADA con fecha de proforma DISTINTA a la de la base (caso real Asotrasaat/8898,
 *   sep-2026): el bloque del acta debe llevar la fecha de la BASE, nunca la de la proforma.
 * Todo en una carpeta temporal; no toca el repo ni la red.
 *
 *   node probar_conciliador.js
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const { crearContexto, requerirXLSX } = require('./cargar_conciliador.js');
const XLSX = requerirXLSX();

let fallos = 0;
const ok = (n, c, x) => { if (c) console.log('  ✓ ' + n); else { fallos++; console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tm2-conc-'));

// Contratista de GRANULARES de la config de fábrica (configSeed), sin copiarla.
const T0 = crearContexto({});
const c = T0.eval('S.config.contratistas.find(c=>c.ambitos.indexOf("GRANULARES")>=0)');
const serial = iso => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000) + 25569;

// Base GRANULARES: fila 2 = encabezados; datos desde la 3. Col: A fecha · B rem · C placa · G cantidad ·
// I actividad · J cc · R uf · Z empresa (BASES_DEF.GRANULARES).
const col = l => XLSX.utils.decode_col(l);
const fila = (o) => { const r = []; Object.keys(o).forEach(k => { r[col(k)] = o[k]; }); return r; };
const base = [[], fila({ A: 'FECHA', B: 'REMISION', C: 'PLACA', G: 'CANTIDAD', I: 'ACTIVIDAD', J: 'CC', R: 'UF', Z: 'EMPRESA' })];
base.push(fila({ A: serial('2026-07-20'), B: '1001', C: 'ABC123', G: 14, I: 'Sub base', J: '3701.03.02', R: 'UF1', Z: c.alias[0] }));
base.push(fila({ A: serial('2026-07-21'), B: '1002', C: 'ABC123', G: 14, I: 'Sub base', J: '3703.03.02', R: 'UF3', Z: c.alias[0] }));
base.push(fila({ A: serial('2026-07-23'), B: '1003', C: 'ABC123', G: 14, I: 'Sub base', J: '3701.03.02', R: 'UF1', Z: c.alias[0] }));
const wbB = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wbB, XLSX.utils.aoa_to_sheet(base), 'BASE 2026');
XLSX.writeFile(wbB, path.join(tmp, 'GRANULARES.xlsx'));

const prof = [['REMISION', 'FECHA', 'PLACA', 'M3'], ['1001', '20/07/2026', 'ABC123', 14], ['1002', '21/07/2026', 'ABC123', 14],
              ['9999', '22/07/2026', 'ABC123', 14], ['1001', '20/07/2026', 'ABC123', 14],
              ['1003', '26/07/2026', 'ABC123', 14]]; // fecha de proforma DISTINTA a la de la base (1003 = 23/07)
const wbP = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wbP, XLSX.utils.aoa_to_sheet(prof), 'PUTANA');
XLSX.writeFile(wbP, path.join(tmp, 'proforma.xlsx'));

function correr(sal){
  try {
    return JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'conciliar.js'), '--contratista=' + c.id,
      '--desde=2026-07-16', '--hasta=2026-07-31', '--granulares=' + path.join(tmp, 'GRANULARES.xlsx'),
      '--proforma=' + path.join(tmp, 'proforma.xlsx'), '--salida=' + sal, '--json'], { encoding: 'utf8' }));
  } catch (e) { console.log(e.stdout || ''); console.log(e.stderr || ''); throw e; }
}
console.log('Prueba de humo del conciliador (contratista ' + c.id + ', datos sintéticos en ' + tmp + ')');
const r = correr(path.join(tmp, 'a')), r2 = correr(path.join(tmp, 'b'));
ok('5 reclamadas', r.reclamadas === 5, r.reclamadas);
ok('2 ENCONTRADA', r.conteo.ENCONTRADA === 2, r.conteo);
ok('1 EXCLUIDA_UF3 (UF3 en la base)', r.conteo.EXCLUIDA_UF3 === 1, r.conteo);
ok('1 NO_ENCONTRADA', r.conteo.NO_ENCONTRADA === 1, r.conteo);
ok('1 DUPLICADA_EN_PROFORMA', r.conteo.DUPLICADA_EN_PROFORMA === 1, r.conteo);
ok('al acta las 2 encontradas', r.alActa === 2, r.alActa);

// 1003: la fecha del bloque del acta debe ser la de la BASE (23/07/2026), no la de la
// proforma (26/07/2026) — caso real Asotrasaat/remisión 8898 (sep-2026).
const wbActa = XLSX.readFile(r.archivos.find(f => /bloque_acta_[^p]/.test(path.basename(f)) || (path.basename(f).indexOf('bloque_acta_') === 0 && path.basename(f).indexOf('bloque_acta_pendientes_') !== 0)));
const filasActa = XLSX.utils.sheet_to_json(wbActa.Sheets[wbActa.SheetNames[0]], { header: 1, raw: true, defval: '' });
const fila1003 = filasActa.find(f => String(f[8]) === '1003'); // col. I = Remisión
ok('1003: fecha del bloque = la de la BASE (23/07/2026)', fila1003 && fila1003[2] === '23/07/2026', fila1003);
const nombres = r.archivos.map(f => path.basename(f));
['bloque_acta_', 'bloque_acta_pendientes_', 'digitadora_', 'resumen_', 'conciliador_sesion_'].forEach(p =>
  ok('exporte ' + p + '*', nombres.some(n => n.indexOf(p) === 0), nombres));
const ses = JSON.parse(fs.readFileSync(r.archivos.find(f => /conciliador_sesion_/.test(f)), 'utf8'));
ok('sesión importable por la herramienta (tipo conciliador_sesion)', ses.tipo === 'conciliador_sesion' && ses.corte && ses.corte.reclamos.length === 5);
let eq = 0; try { execFileSync(process.execPath, [path.join(__dirname, 'equivalencia.js'), '--herramienta=' + path.join(tmp, 'a'), '--skill=' + path.join(tmp, 'b')], { encoding: 'utf8' }); } catch (e) { eq = 1; console.log(e.stdout); }
ok('determinista: dos corridas equivalentes', eq === 0);
console.log(fallos ? '\n✗ ' + fallos + ' fallo(s)' : '\n✓ Todo correcto');
process.exit(fallos ? 1 : 0);
