#!/usr/bin/env node
/**
 * probar_reparto.js — prueba de humo del skill SIN datos reales: arma un reporte diario (`dia suelto`) y un
 * parte diario (`BASE MAQUINARIA`) sintéticos, con el mismo formato que usa
 * backend/pruebas/verificar_reparto_horas_minimas.js, corre `reparto.js` y comprueba:
 *   1 · sale fact_jefe_<desde>_<hasta>.xlsx con las hojas fact_jefe (29 col. A:AC) · reparto · cuadre;
 *   2 · el cuadre es exacto (producción leída = repartida) y el bulldozer lleva el 80% del terraplén;
 *   3 · la salida es determinista (dos corridas → equivalencia.js sin diferencias).
 * Todo en una carpeta temporal; no toca el repo ni la red.
 *
 *   node probar_reparto.js
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const { requerirXLSX } = require('./cargar_reparto.js');
const XLSX = requerirXLSX();

let fallos = 0;
const ok = (n, c, x) => { if (c) console.log('  ✓ ' + n); else { fallos++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tm2-reparto-'));
const DIAS = ['2026-07-16', '2026-07-17', '2026-07-18'];
const serial = iso => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000) + 25569;

// Reporte diario: fila 4 = UF, fila 5 = actividad, desde la 6 = fechas (D86). Solo TERRAPLEN UF1.
const prod = [[], [], [], ['', 'UF1'], ['', 'Terraplenes (solo conformación)']];
[300, 500, 400].forEach((v, i) => prod.push([serial(DIAS[i]), v]));
const wbP = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wbP, XLSX.utils.aoa_to_sheet(prod), 'dia suelto');
XLSX.writeFile(wbP, path.join(tmp, 'reporte.xlsx'));

// Parte diario del jefe: BULL (NH69) y MOTO (MO04) en 02.07 los tres días.
const parte = [['FECHA', 'CODIGO EQUIPO', 'TIPO DE EQUIPO', 'CENTRO DE COSTE', 'HORAS T', 'HORAS IDLE']];
DIAS.forEach(d => { parte.push([serial(d), 'NH69', 'BULLDOZER', '3701.02.07', 6, 0]); parte.push([serial(d), 'MO04', 'MOTONIVELADORA', '3701.02.07', 5, 0]); });
const wbJ = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wbJ, XLSX.utils.aoa_to_sheet(parte), 'BASE MAQUINARIA');
XLSX.writeFile(wbJ, path.join(tmp, 'parte.xlsx'));

const cfg = { hojaProd: 'dia suelto', hojaJefe: 'BASE MAQUINARIA', hojaClima: '', propias: 'NH69:BULL\nMO04:MOTO', minHorasProd: '1', pctBull: '80' };
fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify(cfg));

function correr(sal){
  fs.mkdirSync(sal, { recursive: true });
  try {
    return JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'reparto.js'), '--prod=' + path.join(tmp, 'reporte.xlsx'),
      '--jefe=' + path.join(tmp, 'parte.xlsx'), '--config=' + path.join(tmp, 'config.json'), '--salida=' + sal, '--json'], { encoding: 'utf8' }));
  } catch (e) { console.log(e.stdout || ''); console.log(e.stderr || ''); throw e; }
}
console.log('Prueba de humo del reparto (datos sintéticos en ' + tmp + ')');
const r1 = correr(path.join(tmp, 'a')), r2 = correr(path.join(tmp, 'b'));
ok('corte detectado del parte = 16→18 jul', r1.desde === DIAS[0] && r1.hasta === DIAS[2], r1.desde + '→' + r1.hasta);
ok('sale el archivo fact_jefe_<corte>.xlsx', !!r1.archivo && fs.existsSync(r1.archivo), r1.archivo);
const wb = XLSX.readFile(r1.archivo, { cellDates: true });
ok('hojas fact_jefe · reparto · cuadre', ['fact_jefe', 'reparto', 'cuadre'].every(h => wb.SheetNames.includes(h)), wb.SheetNames.join(','));
const fj = XLSX.utils.sheet_to_json(wb.Sheets.fact_jefe, { header: 1, defval: '' });
ok('fact_jefe con 29 columnas (A:AC)', fj[0].length === 29, fj[0].length);
ok('cuadre exacto (sin descuadre ni huérfanas)', r1.descuadre.length === 0 && r1.huerfanas === 0, JSON.stringify(r1.descuadre));
ok('producción repartida = 1.200 m³', Math.abs(r1.prod - 1200) < 0.01, r1.prod);
const bull = fj.slice(1).filter(f => f[4] === 'NH69').reduce((s, f) => s + (Number(f[19]) || 0), 0);
ok('bulldozer con el 80% del terraplén (960 m³)', Math.abs(bull - 960) < 0.01, bull);
let eq = 0; try { execFileSync(process.execPath, [path.join(__dirname, 'equivalencia.js'), '--herramienta=' + r1.archivo, '--skill=' + r2.archivo], { encoding: 'utf8' }); } catch (e) { eq = 1; console.log(e.stdout); }
ok('determinista: dos corridas equivalentes', eq === 0);
console.log(fallos ? '\n✗ ' + fallos + ' fallo(s)' : '\n✓ Todo correcto');
process.exit(fallos ? 1 : 0);
