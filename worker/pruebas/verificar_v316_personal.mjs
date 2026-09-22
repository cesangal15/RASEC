#!/usr/bin/env node
/**
 * verificar_v316_personal.mjs — V3-16: `personal` (horas-hombre y nº de personas por partida) en
 * GET ?action=tablero_vivo, sobre Postgres EN MEMORIA (PGlite, como verificar_d185_tablero_vivo.mjs). Sin red.
 *
 * Qué se comprueba:
 *   1. Mapeo de partida por sufijo de CC (02.05/02.06→excavacion, 02.07→terraplen, 03.01→subbase,
 *      03.03→base, cualquier otro incl. 'I010305'→otras) y UF por prefijo (3701→UF1, 3702→UF2).
 *   2. Exclusión de UF3 (3703…), de ausentes (presente='No') y de filas sin CC.
 *   3. Deduplicado de personas por (fecha, uf, act): 2 filas de la MISMA persona el mismo día = n=1,
 *      pero las horas de las 2 filas SUMAN (no se deduplican).
 *   4. `h` = exactamente lo que da `clasificarHoras` (horas-nomina.js, D112) para cada fila —
 *      ordinarias+ord_domfest+extra_diurna+extra_nocturna+extra_domfest — comprobado en L-V, domingo y
 *      turno nocturno con la MISMA función importada aquí (no a mano).
 *   5. Ninguna clave de persona (nombre/cédula/código/cuadrilla/cc) en el JSON de la respuesta pública.
 *   6. Si ASISTENCIA falla al leer (tabla ausente): personal:null + personal_error, y el resto de
 *      tablero_vivo (dias, proy, horas) sigue funcionando.
 * Sale con código 1 si algo falla.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPglite } from './pglite.js';
import { tableroVivoLeer } from '../src/api/obra/tablero_vivo.js';
import { clasificarHoras, turnoRowFor, tipoJornadaDeFecha } from '../../horas-nomina.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, '..', '..');
const SQL_DIR = path.join(REPO, 'worker', 'sql');

let casos = 0, fallos = 0;
function ok(n, c, x){ casos++; if (c) console.log('  ✓ ' + n); else { fallos++; console.log('  ✗ ' + n + (x !== undefined ? '  → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 600) : '')); } }
const titulo = (s) => console.log('\n' + s);

// Semillas de personas (D161: NUNCA deben aparecer en la respuesta pública).
const PERSONAS = [
  { codigo: 'C001', cedula: '', nombre: 'JUAN PEREZ GOMEZ' },
  { codigo: 'C002', cedula: '', nombre: 'MARIA LOPEZ RUIZ' },
  { codigo: '',     cedula: '99887766', nombre: 'PEDRO GARCIA SOTO' },
];
const CUADRILLA = 'CUAD-PRUEBA-V316';

async function asis(sql, fila){
  const id = 'v316-' + Math.random().toString(36).slice(2);
  await sql`INSERT INTO asistencia (obra_id, id_registro, "timestamp", fecha, reporta, cuadrilla, codigo, cedula,
      nombre, cargo, cc, proyecto, hora_entrada, hora_salida, presente, motivo_ausencia, observacion, turno)
    VALUES ('tm2sur', ${id}, now(), ${fila.fecha}, 'prueba', ${CUADRILLA}, ${fila.codigo || ''}, ${fila.cedula || ''},
      ${fila.nombre || ''}, 'oficial', ${fila.cc}, '3701', ${fila.hora_entrada || ''}, ${fila.hora_salida || ''},
      ${fila.presente || 'Si'}, '', '', ${fila.turno || ''})`;
}
const c = (sql) => ({ sql, memo: {}, pet: { t0: Date.now(), log: null } });
function grupo(personal, f, uf, act){ return (personal || []).find(function(x){ return x.f === f && x.uf === uf && x.act === act; }); }

async function main(){
  const { sql } = await abrirPglite();
  const q = (t, p) => sql.unsafe(t, p);
  const aplicar = (f) => sql.exec(fs.readFileSync(path.join(SQL_DIR, f), 'utf8'));
  const migraciones = fs.readdirSync(SQL_DIR).filter(f => /^0\d+_.*\.sql$/.test(f)).sort();
  for (const f of migraciones) await aplicar(f);

  const HOY = '2026-09-01';   // martes, L-V estándar (07:00-15:30, almuerzo 12:00-13:00)
  const DOMINGO = '2026-09-06';

  titulo('1 · mapeo de partida por sufijo del CC y UF por prefijo');
  await asis(sql, { fecha: HOY, ...PERSONAS[0], cc: '3701.02.05| EXCAVACION EN MATERIAL COMUN', hora_entrada: '07:00', hora_salida: '15:30' });
  await asis(sql, { fecha: HOY, ...PERSONAS[1], cc: '3701.02.06| EXCAVACION PRESTAMO', hora_entrada: '07:00', hora_salida: '15:30' });
  await asis(sql, { fecha: HOY, codigo: 'C010', nombre: 'X', cc: '3701.02.07| TERRAPLEN', hora_entrada: '07:00', hora_salida: '15:30' });
  await asis(sql, { fecha: HOY, codigo: 'C011', nombre: 'X', cc: '3701.03.01| SUBBASE', hora_entrada: '07:00', hora_salida: '15:30' });
  await asis(sql, { fecha: HOY, codigo: 'C012', nombre: 'X', cc: '3702.03.03| BASE UF2', hora_entrada: '07:00', hora_salida: '15:30' });
  await asis(sql, { fecha: HOY, codigo: 'C013', nombre: 'X', cc: '3701.I010305| TALLER', hora_entrada: '07:00', hora_salida: '15:30' });
  await asis(sql, { fecha: HOY, codigo: 'C014', nombre: 'X', cc: '3703.02.05| UF3 EXCLUIDO', hora_entrada: '07:00', hora_salida: '15:30' });
  await asis(sql, { fecha: HOY, codigo: 'C015', nombre: 'X', cc: '', hora_entrada: '07:00', hora_salida: '15:30' });                                // sin CC
  await asis(sql, { fecha: HOY, codigo: 'C016', nombre: 'X', cc: '3701.02.05| AUSENTE', hora_entrada: '', hora_salida: '', presente: 'No' });        // ausente

  const r1 = await tableroVivoLeer(c(sql), {});
  ok('ok:true y `personal` es un array (no null)', r1.ok === true && Array.isArray(r1.personal), r1.personal_error);
  ok('02.05 y 02.06 → el MISMO grupo excavacion UF1 (mismo mapeo que CC_ACT): 2 personas',
    !!grupo(r1.personal, HOY, 'UF1', 'excavacion') && grupo(r1.personal, HOY, 'UF1', 'excavacion').n === 2, grupo(r1.personal, HOY, 'UF1', 'excavacion'));
  ok('02.07 → terraplen UF1', !!grupo(r1.personal, HOY, 'UF1', 'terraplen') && grupo(r1.personal, HOY, 'UF1', 'terraplen').n === 1);
  ok('03.01 → subbase UF1', !!grupo(r1.personal, HOY, 'UF1', 'subbase') && grupo(r1.personal, HOY, 'UF1', 'subbase').n === 1);
  ok('03.03 en 3702 → base UF2', !!grupo(r1.personal, HOY, 'UF2', 'base') && grupo(r1.personal, HOY, 'UF2', 'base').n === 1);
  ok('I010305 (Taller) → otras UF1', !!grupo(r1.personal, HOY, 'UF1', 'otras') && grupo(r1.personal, HOY, 'UF1', 'otras').n === 1);
  ok('3703 (UF3) EXCLUIDO: nadie en UF3 y no infla ningún grupo UF1/UF2/otras de más',
    !(r1.personal || []).some(function(x){ return x.uf !== 'UF1' && x.uf !== 'UF2'; }));
  const totalPersonas = (r1.personal || []).filter(function(x){ return x.f === HOY; }).reduce(function(s, x){ return s + x.n; }, 0);
  ok('sin CC y ausente NO cuentan (6 personas repartidas en 5 grupos, ni 8 ni 9)', totalPersonas === 6, totalPersonas);
  ok('personal_hasta = la última fecha con asistencia', r1.personal_hasta === HOY, r1.personal_hasta);
  ok('ordenado por f, uf, act', JSON.stringify(r1.personal.map(x => x.f + '|' + x.uf + '|' + x.act))
    === JSON.stringify([...r1.personal].sort((a, b) => (a.f + a.uf + a.act) < (b.f + b.uf + b.act) ? -1 : 1).map(x => x.f + '|' + x.uf + '|' + x.act)));

  titulo('2 · dedupe de personas (2 filas/día de la MISMA persona) y horas que SUMAN');
  await asis(sql, { fecha: '2026-09-02', codigo: 'C020', nombre: 'DOBLE', cc: '3701.02.05| EXC', hora_entrada: '07:00', hora_salida: '11:00' });
  await asis(sql, { fecha: '2026-09-02', codigo: 'C020', nombre: 'DOBLE', cc: '3701.02.05| EXC TARDE', hora_entrada: '11:00', hora_salida: '15:30' });
  const r2 = await tableroVivoLeer(c(sql), {});
  const g2 = grupo(r2.personal, '2026-09-02', 'UF1', 'excavacion');
  ok('2 filas de la MISMA persona el mismo día → n=1 (deduplicado)', !!g2 && g2.n === 1, g2);
  const clA = clasificarHoras('lv', '07:00', '11:00', {}, null), clB = clasificarHoras('lv', '11:00', '15:30', {}, null);
  const hEsp2 = Math.round(((clA.ordinarias + clA.ord_domfest + clA.extra_diurna + clA.extra_nocturna + clA.extra_domfest)
    + (clB.ordinarias + clB.ord_domfest + clB.extra_diurna + clB.extra_nocturna + clB.extra_domfest)) * 100) / 100;
  ok('…pero las horas de las 2 filas SUMAN (no se deduplican): h = ' + hEsp2, g2.h === hEsp2, g2.h);

  titulo('3 · `h` = exactamente clasificarHoras (D112), en L-V, domingo y turno nocturno');
  await asis(sql, { fecha: HOY, codigo: 'C030', nombre: 'LV', cc: '3701.02.05| EXC', hora_entrada: '07:00', hora_salida: '18:00' });   // con extra
  const rLv = await tableroVivoLeer(c(sql), {});
  const gLv = grupo(rLv.personal, HOY, 'UF1', 'excavacion');
  const clLv = clasificarHoras(tipoJornadaDeFecha(HOY, []), '07:00', '18:00', {}, null);
  const hLvEsp = clLv.ordinarias + clLv.ord_domfest + clLv.extra_diurna + clLv.extra_nocturna + clLv.extra_domfest;
  ok('L-V con extra: el grupo trae la Σ de TODAS sus filas (incluida la de arriba), consistente con clasificarHoras', gLv.h >= Math.round(hLvEsp * 100) / 100 - 0.01);

  await asis(sql, { fecha: DOMINGO, codigo: 'C031', nombre: 'DOM', cc: '3701.02.05| EXC DOM', hora_entrada: '07:00', hora_salida: '14:00' });
  const rDom = await tableroVivoLeer(c(sql), {});
  const gDom = grupo(rDom.personal, DOMINGO, 'UF1', 'excavacion');
  const clDom = clasificarHoras(tipoJornadaDeFecha(DOMINGO, []), '07:00', '14:00', {}, null);
  const hDomEsp = Math.round((clDom.ordinarias + clDom.ord_domfest + clDom.extra_diurna + clDom.extra_nocturna + clDom.extra_domfest) * 100) / 100;
  ok('domingo: tipoJornada domfest → h = ' + hDomEsp + ' (ord_domfest, no ordinarias de semana)', gDom.h === hDomEsp, gDom);

  await q(`INSERT INTO turnos (obra_id, turno, tipo_dia, entrada, salida, descanso_ini, descanso_fin, cruza_medianoche)
    VALUES ('tm2sur', 'N1', 'lj', '19:00', '06:00', '', '', 'SI')`);
  const NOCHE = '2026-09-03';   // jueves
  await asis(sql, { fecha: NOCHE, codigo: 'C032', nombre: 'NOC', cc: '3701.02.05| EXC NOC', hora_entrada: '19:00', hora_salida: '06:00', turno: 'N1' });
  const rNoc = await tableroVivoLeer(c(sql), {});
  const gNoc = grupo(rNoc.personal, NOCHE, 'UF1', 'excavacion');
  const trNoc = turnoRowFor('N1', NOCHE, [{ turno: 'N1', tipo_dia: 'lj', entrada: '19:00', salida: '06:00', descanso_ini: '', descanso_fin: '' }], tipoJornadaDeFecha(NOCHE, []));
  const clNoc = clasificarHoras(tipoJornadaDeFecha(NOCHE, []), '19:00', '06:00', {}, trNoc);
  const hNocEsp = Math.round((clNoc.ordinarias + clNoc.ord_domfest + clNoc.extra_diurna + clNoc.extra_nocturna + clNoc.extra_domfest) * 100) / 100;
  ok('turno nocturno (cruce de medianoche, T «N1»): h = ' + hNocEsp + ' = clasificarHoras con el turnoRow real', gNoc.h === hNocEsp, [gNoc, clNoc]);

  titulo('4 · privacidad: ningún nombre/cédula/código/cuadrilla/cc en la respuesta pública');
  const texto = JSON.stringify(rNoc);
  const fugas = [];
  PERSONAS.concat([{ nombre: 'DOBLE' }, { nombre: 'LV' }, { nombre: 'DOM' }, { nombre: 'NOC' }]).forEach(function(p){
    if (p.nombre && texto.indexOf(p.nombre) >= 0) fugas.push(p.nombre);
    if (p.cedula && texto.indexOf(p.cedula) >= 0) fugas.push(p.cedula);
  });
  if (texto.indexOf(CUADRILLA) >= 0) fugas.push(CUADRILLA);
  if (texto.indexOf('3701.02.05') >= 0) fugas.push('cc crudo 3701.02.05');
  ['C001', 'C002', 'C010', 'C020', 'C030'].forEach(function(cod){ if (texto.indexOf('"' + cod + '"') >= 0) fugas.push(cod); });
  ok('ni un nombre, cédula, código, cuadrilla o CC crudo en el JSON de tablero_vivo', fugas.length === 0, fugas);
  const clavesPersonal = new Set(); (rNoc.personal || []).forEach(function(x){ Object.keys(x).forEach(function(k){ clavesPersonal.add(k); }); });
  ok('cada fila de `personal` es EXACTAMENTE {f, uf, act, n, h}', JSON.stringify([...clavesPersonal].sort()) === JSON.stringify(['act', 'f', 'h', 'n', 'uf']), [...clavesPersonal]);

  titulo('5 · ASISTENCIA no se puede leer: personal:null + personal_error, sin tumbar el resto');
  await sql.exec('DROP TABLE asistencia');
  const r5 = await tableroVivoLeer(c(sql), {});
  ok('tablero_vivo sigue ok:true, con `dias`/`proy` intactos (esta BD de pruebas no cargó `data`, así que `dias` está vacío pero sigue siendo un array)',
    r5.ok === true && Array.isArray(r5.dias) && r5.proy && typeof r5.proy === 'object');
  ok('`personal` es null y trae `personal_error` legible', r5.personal === null && typeof r5.personal_error === 'string' && r5.personal_error.length > 0, r5.personal_error);
  ok('`personal_hasta` queda vacío', r5.personal_hasta === '', r5.personal_hasta);

  console.log('\n' + casos + ' comprobaciones · ' + fallos + ' fallo(s)');
  process.exit(fallos ? 1 : 0);
}
main().catch(err => { console.error('La verificación no pudo correr: ' + (err && err.stack || err)); process.exit(2); });
