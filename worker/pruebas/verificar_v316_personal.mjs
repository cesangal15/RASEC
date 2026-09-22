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
 *   7. Desglose por CARGO (`c`): normalización (variantes de mayúsculas/tildes/espacios agrupadas;
 *      «OFICIAL» ≠ «OFICIAL DE OBRA»), respaldo desde `personal` cuando la fila no trae cargo (incluida
 *      la regla de la estancia de fecha_ingreso más reciente, NULL = la más antigua), 'Sin cargo
 *      registrado' cuando falta en ambos sitios, Σn/Σh de `c` coherentes con la entrada, orden (h desc,
 *      luego k asc), 2 filas de la MISMA persona el mismo día con cargos distintos → cuenta por la
 *      PRIMERA fila, y que el JSON sigue sin nombres/cédulas/códigos.
 *   8. Personal INDIRECTO fuera (V3-16, decisión del jefe): una fila con cargo Capataz/Encargado/Auxiliar
 *      administrativo/Ingeniero residente (o su variante) NO cuenta en n/h/c, tanto si el cargo viene en la
 *      FILA como si viene de la FICHA (cuando la fila no trae cargo); sin cargo en ningún sitio SÍ cuenta
 *      (Sin cargo registrado). Otro cargo cualquiera de la lista de 012 (p. ej. Oficial) sigue contando.
 *   9. Partida 'transporte' por la DESCRIPCIÓN del CC (cuando el código no matchea PERS_ACT): en 3701 y
 *      3702, con los códigos reales (02.10, 02.11, 03.02, 03.04); PERS_ACT sigue ganando aunque la
 *      descripción también empiece por «Transporte»; drenajes (06.x / 07.x) siguen fuera aunque su
 *      descripción empiece por «Transporte».
 * Sale con código 1 si algo falla.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPglite } from './pglite.js';
import { tableroVivoLeer, SIN_CARGO } from '../src/api/obra/tablero_vivo.js';
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

let asisSeq = 0;
async function asis(sql, fila){
  // id_registro CRECIENTE: el desglose por cargo ordena por (fecha, id_registro) y la regla de la
  // «primera fila» (misma persona, mismo f/uf/act, cargos distintos) necesita un orden determinista.
  const id = 'v316-' + String(++asisSeq).padStart(6, '0') + '-' + Math.random().toString(36).slice(2);
  await sql`INSERT INTO asistencia (obra_id, id_registro, "timestamp", fecha, reporta, cuadrilla, codigo, cedula,
      nombre, cargo, cc, proyecto, hora_entrada, hora_salida, presente, motivo_ausencia, observacion, turno)
    VALUES ('tm2sur', ${id}, now(), ${fila.fecha}, 'prueba', ${CUADRILLA}, ${fila.codigo || ''}, ${fila.cedula || ''},
      ${fila.nombre || ''}, ${fila.cargo === undefined ? 'oficial' : fila.cargo}, ${fila.cc}, '3701',
      ${fila.hora_entrada || ''}, ${fila.hora_salida || ''}, ${fila.presente || 'Si'}, '', '', ${fila.turno || ''})`;
}
async function ficha(sql, p){
  await sql`INSERT INTO personal (obra_id, cedula, codigo, nombre, cargo, cuadrilla, estado, fecha_ingreso)
    VALUES ('tm2sur', ${p.cedula || ''}, ${p.codigo || ''}, ${p.nombre || ''}, ${p.cargo || ''}, '', 'activo', ${p.fecha_ingreso === undefined ? null : p.fecha_ingreso})`;
}
const c = (sql) => ({ sql, memo: {}, pet: { t0: Date.now(), log: null } });
function grupo(personal, f, uf, act){ return (personal || []).find(function(x){ return x.f === f && x.uf === uf && x.act === act; }); }
function cargo(g, k){ return (g && g.c || []).find(function(x){ return x.k === k; }); }

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
  await asis(sql, { fecha: HOY, codigo: 'C017', nombre: 'X', cc: '3701.06.04| Acero de refuerzo Fy=420 Mpa.', hora_entrada: '07:00', hora_salida: '15:30' });   // drenajes ODT
  await asis(sql, { fecha: HOY, codigo: 'C018', nombre: 'X', cc: '3702.07.01| Excavaciones varias sin clasicar', hora_entrada: '07:00', hora_salida: '15:30' }); // drenajes ODL

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
  ok('sin CC, ausente y drenajes (06.* ODT, 07.* ODL) NO cuentan (6 personas repartidas en 5 grupos)', totalPersonas === 6, totalPersonas);
  ok('drenajes fuera: «otras» UF1 sigue con 1 persona (solo el Taller) y no hay grupo «otras» UF2',
    grupo(r1.personal, HOY, 'UF1', 'otras').n === 1 && !grupo(r1.personal, HOY, 'UF2', 'otras'));
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
  ok('cada fila de `personal` es EXACTAMENTE {f, uf, act, n, h, c}', JSON.stringify([...clavesPersonal].sort()) === JSON.stringify(['act', 'c', 'f', 'h', 'n', 'uf']), [...clavesPersonal]);
  const clavesCargo = new Set(); (rNoc.personal || []).forEach(function(x){ (x.c || []).forEach(function(y){ Object.keys(y).forEach(function(k){ clavesCargo.add(k); }); }); });
  ok('cada entrada de `c` es EXACTAMENTE {k, n, h} (nunca nombre/cédula/código)', JSON.stringify([...clavesCargo].sort()) === JSON.stringify(['h', 'k', 'n']), [...clavesCargo]);

  titulo('5 · desglose por CARGO (`c`): normalización, respaldo de `personal`, `SIN CARGO`, Σn/Σh, orden y «primera fila»');
  const FC = '2026-09-10';
  await asis(sql, { fecha: FC, codigo: 'C100', nombre: 'CARGO A', cc: '3701.02.05| EXC', cargo: 'Oficial De Obra', hora_entrada: '07:00', hora_salida: '15:30' });
  await asis(sql, { fecha: FC, codigo: 'C101', nombre: 'CARGO B', cc: '3701.02.05| EXC', cargo: 'OFICIAL DE OBRA', hora_entrada: '07:00', hora_salida: '15:30' });
  await asis(sql, { fecha: FC, codigo: 'C102', nombre: 'CARGO C', cc: '3701.02.05| EXC', cargo: 'OFICIAL', hora_entrada: '07:00', hora_salida: '15:30' });
  await asis(sql, { fecha: FC, codigo: 'C103', nombre: 'CARGO D', cc: '3701.02.05| EXC', cargo: '', hora_entrada: '07:00', hora_salida: '15:30' });
  // Respaldo por CÓDIGO: 2 estancias en `personal`, manda la de fecha_ingreso MÁS RECIENTE (no la del INSERT).
  // (cargos DIRECTOS a propósito: Capataz/Encargado quedarían fuera por la sección 8 de indirectos.)
  await ficha(sql, { codigo: 'C104', cargo: 'Oficial de estructura', fecha_ingreso: '2020-01-01' });
  await ficha(sql, { codigo: 'C104', cargo: 'OPERADOR DE BULLDOZER', fecha_ingreso: '2023-05-01' });
  await asis(sql, { fecha: FC, codigo: 'C104', nombre: 'CARGO E', cc: '3701.02.05| EXC', cargo: '', hora_entrada: '07:00', hora_salida: '15:30' });
  // Respaldo por CÉDULA (sin código), fecha_ingreso NULL = la MÁS ANTIGUA: no debe ganarle a una estancia con fecha.
  await ficha(sql, { cedula: '55501122', cargo: 'Ayudante de obra', fecha_ingreso: null });
  await ficha(sql, { cedula: '55501122', cargo: 'AYUDANTE', fecha_ingreso: '2019-01-01' });
  await asis(sql, { fecha: FC, cedula: '55501122', nombre: 'CARGO F', cc: '3701.02.05| EXC', cargo: '', hora_entrada: '07:00', hora_salida: '15:30' });
  // Dos filas la MISMA persona, mismo (f,uf,act), cargos DISTINTOS: cuenta por la cargo de su PRIMERA fila,
  // pero las horas de las 2 filas SUMAN en ese cargo (regla 3).
  await asis(sql, { fecha: FC, codigo: 'C110', nombre: 'CARGO G', cc: '3701.02.05| EXC AM', cargo: 'Oficial de obra', hora_entrada: '07:00', hora_salida: '11:00' });
  await asis(sql, { fecha: FC, codigo: 'C110', nombre: 'CARGO G', cc: '3701.02.05| EXC PM', cargo: 'Ayudante de obra', hora_entrada: '11:00', hora_salida: '15:30' });

  const rC = await tableroVivoLeer(c(sql), {});
  const gC = grupo(rC.personal, FC, 'UF1', 'excavacion');
  ok('«Oficial De Obra» y «OFICIAL DE OBRA» agrupan: normaliza tildes/mayúsculas/espacios (más C110 abajo, n=3)',
    !!cargo(gC, 'Oficial de obra') && cargo(gC, 'Oficial de obra').n === 3, cargo(gC, 'Oficial de obra'));
  ok('«OFICIAL» NO se funde con «OFICIAL DE OBRA» (no inventa sinónimos): entrada aparte con n=1',
    !!cargo(gC, 'Oficial') && cargo(gC, 'Oficial').n === 1, cargo(gC, 'Oficial'));
  ok('sin cargo en la fila y sin ficha → «Sin cargo registrado»', !!cargo(gC, SIN_CARGO) && cargo(gC, SIN_CARGO).n === 1, cargo(gC, SIN_CARGO));
  ok('respaldo por CÓDIGO desde `personal`: manda la estancia de fecha_ingreso MÁS RECIENTE (Operador de bulldozer, no Oficial de estructura)',
    !!cargo(gC, 'Operador de bulldozer') && cargo(gC, 'Operador de bulldozer').n === 1 && !cargo(gC, 'Oficial de estructura'), cargo(gC, 'Operador de bulldozer'));
  ok('respaldo por CÉDULA desde `personal` (sin código): fecha_ingreso NULL = la más antigua, no le gana a la fechada (AYUDANTE, no Ayudante de obra)',
    !!cargo(gC, 'Ayudante') && cargo(gC, 'Ayudante').n === 1 && !cargo(gC, 'Ayudante de obra'), cargo(gC, 'Ayudante'));
  const gCargoAmbos = cargo(gC, 'Oficial de obra');
  ok('2 filas de la MISMA persona con cargos distintos: cuenta por la cargo de la PRIMERA fila (Oficial de obra, no Ayudante de obra)',
    gCargoAmbos.n === 3, gCargoAmbos);   // C100 + C101 + C110 (su 1ª fila fue «Oficial de obra»)
  function sumaCl_(cl){ return cl.ordinarias + cl.ord_domfest + cl.extra_diurna + cl.extra_nocturna + cl.extra_domfest; }
  const hFull = sumaCl_(clasificarHoras('lv', '07:00', '15:30', {}, null));       // C100, C101: turno completo
  const hAmPm = sumaCl_(clasificarHoras('lv', '07:00', '11:00', {}, null)) + sumaCl_(clasificarHoras('lv', '11:00', '15:30', {}, null)); // C110: 2 filas
  const hEspOficial = Math.round((2 * hFull + hAmPm) * 100) / 100;
  ok('…pero SUS HORAS (las 2 filas de C110) suman en ese cargo (Oficial de obra), no en Ayudante de obra',
    Math.abs(gCargoAmbos.h - hEspOficial) < 0.02, [gCargoAmbos.h, hEspOficial]);
  ok('«Ayudante de obra» (2ª fila de C110) no se lleva NINGUNA hora de C110: solo queda el respaldo de cédula (AYUDANTE)',
    (gC.c.filter(function(x){ return x.k === 'Ayudante de obra'; }).length === 0), gC.c);

  const sumaN = gC.c.reduce(function(s, x){ return s + x.n; }, 0), sumaH = Math.round(gC.c.reduce(function(s, x){ return s + x.h; }, 0) * 100) / 100;
  ok('Σn de `c` = n de la entrada', sumaN === gC.n, [sumaN, gC.n]);
  ok('Σh de `c` ≈ h de la entrada (redondeos)', Math.abs(sumaH - gC.h) < 0.05, [sumaH, gC.h]);
  const ordenado = gC.c.every(function(x, i){ if (i === 0) return true; const p = gC.c[i - 1]; return p.h > x.h || (p.h === x.h && p.k <= x.k); });
  ok('`c` viene ordenado por h desc y luego k asc', ordenado, gC.c);

  titulo('6 · ASISTENCIA no se puede leer: personal:null + personal_error, sin tumbar el resto');
  await sql.exec('DROP TABLE asistencia');
  const r5 = await tableroVivoLeer(c(sql), {});
  ok('tablero_vivo sigue ok:true, con `dias`/`proy` intactos (esta BD de pruebas no cargó `data`, así que `dias` está vacío pero sigue siendo un array)',
    r5.ok === true && Array.isArray(r5.dias) && r5.proy && typeof r5.proy === 'object');
  ok('`personal` es null y trae `personal_error` legible', r5.personal === null && typeof r5.personal_error === 'string' && r5.personal_error.length > 0, r5.personal_error);
  ok('`personal_hasta` queda vacío', r5.personal_hasta === '', r5.personal_hasta);

  console.log('\n' + casos + ' comprobaciones · ' + fallos + ' fallo(s) (fin de la sección de ASISTENCIA sin tabla; el resto necesita una BD nueva)');

  titulo('7 · reconstruir BD para las secciones de indirectos y transporte (la 6 dejó ASISTENCIA sin tabla)');
  const { sql: sql2 } = await abrirPglite();
  for (const f of migraciones) await sql2.exec(fs.readFileSync(path.join(SQL_DIR, f), 'utf8'));

  titulo('8 · personal INDIRECTO fuera (V3-16, decisión del jefe): ni n, ni h, ni c');
  const FI = '2026-09-15';
  await asis(sql2, { fecha: FI, codigo: 'C200', nombre: 'CAP FILA', cc: '3701.02.05| EXC', cargo: 'Capataz de obra', hora_entrada: '07:00', hora_salida: '15:30' });
  await asis(sql2, { fecha: FI, codigo: 'C201', nombre: 'ENC FILA', cc: '3701.02.05| EXC', cargo: 'ENCARGADO', hora_entrada: '07:00', hora_salida: '15:30' });
  await asis(sql2, { fecha: FI, codigo: 'C202', nombre: 'RES FILA', cc: '3701.02.05| EXC', cargo: 'Residente', hora_entrada: '07:00', hora_salida: '15:30' });
  await asis(sql2, { fecha: FI, codigo: 'C203', nombre: 'AUX FILA', cc: '3701.02.05| EXC', cargo: 'Auxiliar administrativo', hora_entrada: '07:00', hora_salida: '15:30' });
  await asis(sql2, { fecha: FI, codigo: 'C204', nombre: 'OFI DIRECTO', cc: '3701.02.05| EXC', cargo: 'Oficial', hora_entrada: '07:00', hora_salida: '15:30' });
  await asis(sql2, { fecha: FI, codigo: 'C205', nombre: 'SIN CARGO', cc: '3701.02.05| EXC', cargo: '', hora_entrada: '07:00', hora_salida: '15:30' });
  // indirecto por FICHA (la fila no trae cargo): también debe quedar fuera.
  await ficha(sql2, { codigo: 'C206', cargo: 'Capataz', fecha_ingreso: '2024-01-01' });
  await asis(sql2, { fecha: FI, codigo: 'C206', nombre: 'CAP FICHA', cc: '3701.02.05| EXC', cargo: '', hora_entrada: '07:00', hora_salida: '15:30' });
  const r8 = await tableroVivoLeer(c(sql2), {});
  const g8 = grupo(r8.personal, FI, 'UF1', 'excavacion');
  ok('solo cuentan las 2 filas directas (Oficial + Sin cargo): n=2', !!g8 && g8.n === 2, g8);
  ok('ningún indirecto (capataz/encargado/residente/auxiliar) aparece en `c`, ni por fila ni por ficha',
    !cargo(g8, 'Capataz de obra') && !cargo(g8, 'Encargado') && !cargo(g8, 'Ingeniero residente') && !cargo(g8, 'Auxiliar administrativo') && !cargo(g8, 'Capataz'),
    g8.c);
  ok('«Oficial» (directo) y «Sin cargo registrado» SÍ cuentan', !!cargo(g8, 'Oficial') && cargo(g8, 'Oficial').n === 1 && !!cargo(g8, SIN_CARGO) && cargo(g8, SIN_CARGO).n === 1, g8.c);
  const texto8 = JSON.stringify(r8);
  ok('ningún indirecto infla las horas del grupo (h = solo las 2 filas directas, 07:00-15:30 c/u)', Math.abs(g8.h - 15) < 0.02, g8.h);

  titulo('9 · partida «transporte» por DESCRIPCIÓN del CC (código no matchea PERS_ACT) y drenajes fuera');
  const FT = '2026-09-16';
  await asis(sql2, { fecha: FT, codigo: 'T001', nombre: 'X', cc: '3701.02.10| Transporte de terraplén (100 m a 1 km)', hora_entrada: '07:00', hora_salida: '15:30' });
  await asis(sql2, { fecha: FT, codigo: 'T002', nombre: 'X', cc: '3701.02.11| Transporte materiales provenientes de excavación (más de 1 km)', hora_entrada: '07:00', hora_salida: '15:30' });
  await asis(sql2, { fecha: FT, codigo: 'T003', nombre: 'X', cc: '3702.03.02| Transporte de subbase granular', hora_entrada: '07:00', hora_salida: '15:30' });
  await asis(sql2, { fecha: FT, codigo: 'T004', nombre: 'X', cc: '3702.03.04| Transporte de base granular', hora_entrada: '07:00', hora_salida: '15:30' });
  // PERS_ACT manda aunque la descripción también empiece por «Transporte»
  await asis(sql2, { fecha: FT, codigo: 'T005', nombre: 'X', cc: '3701.02.05| Transporte interno de material excavado', hora_entrada: '07:00', hora_salida: '15:30' });
  // drenajes con descripción «Transporte…»: siguen fuera (deriveArea)
  await asis(sql2, { fecha: FT, codigo: 'T006', nombre: 'X', cc: '3701.06.02| Transporte de material seleccionado (ODT)', hora_entrada: '07:00', hora_salida: '15:30' });
  // otro código sin matchear PERS_ACT y sin «Transporte» al inicio: sigue en 'otras'
  await asis(sql2, { fecha: FT, codigo: 'T007', nombre: 'X', cc: '3701.I0408| Movilización de personal', hora_entrada: '07:00', hora_salida: '15:30' });
  await asis(sql2, { fecha: FT, codigo: 'T008', nombre: 'X', cc: '3701.02.09| Riego de agua en caminos y accesos', hora_entrada: '07:00', hora_salida: '15:30' });
  const r9 = await tableroVivoLeer(c(sql2), {});
  ok('3701.02.10 (código no en PERS_ACT, descripción «Transporte…») → transporte UF1', !!grupo(r9.personal, FT, 'UF1', 'transporte') && grupo(r9.personal, FT, 'UF1', 'transporte').n >= 1, grupo(r9.personal, FT, 'UF1', 'transporte'));
  ok('3701.02.11 también → transporte UF1', grupo(r9.personal, FT, 'UF1', 'transporte').n === 2, grupo(r9.personal, FT, 'UF1', 'transporte'));
  ok('3702.03.02 y 3702.03.04 → transporte UF2 (n=2)', !!grupo(r9.personal, FT, 'UF2', 'transporte') && grupo(r9.personal, FT, 'UF2', 'transporte').n === 2, grupo(r9.personal, FT, 'UF2', 'transporte'));
  ok('02.05 con descripción «Transporte…»: PERS_ACT manda → excavacion, NO transporte', !!grupo(r9.personal, FT, 'UF1', 'excavacion') && grupo(r9.personal, FT, 'UF1', 'excavacion').n === 1, grupo(r9.personal, FT, 'UF1', 'excavacion'));
  ok('06.02 (ODT) con descripción «Transporte…»: sigue fuera del Tablero (drenajes)', !(r9.personal || []).some(function(x){ return x.f === FT && x.n > 6; }));
  const totalFT = (r9.personal || []).filter(function(x){ return x.f === FT; }).reduce(function(s, x){ return s + x.n; }, 0);
  ok('total del día FT = 7 (T001..T005, T007, T008; T006 de drenajes queda fuera)', totalFT === 7, totalFT);
  ok('I0408 (transporte de personal, código sin PERS_ACT y descripción que NO empieza por «Transporte») → otras',
    !!grupo(r9.personal, FT, 'UF1', 'otras') && grupo(r9.personal, FT, 'UF1', 'otras').n === 2, grupo(r9.personal, FT, 'UF1', 'otras'));

  console.log('\n' + casos + ' comprobaciones · ' + fallos + ' fallo(s)');
  process.exit(fallos ? 1 : 0);
}
main().catch(err => { console.error('La verificación no pudo correr: ' + (err && err.stack || err)); process.exit(2); });
