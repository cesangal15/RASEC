#!/usr/bin/env node
/**
 * Verificación D223 (4.18 / V3-32) — auditoría del Parte, tardío, periódicos y firma con cédula.
 * Funciones REALES del Worker (api/parte.js) sobre Postgres en memoria (PGlite) con el esquema 001–015
 * (incluye 015_parte_auditoria.sql: tabla parte_auditoria por trigger, firma/firma_huella, cedula):
 *
 *   1 · Reporte por QR → fila en parte_auditoria op 'alta', usuario 'qr:<codigo> · <operador>'.
 *   2 · Revisar: aprobar / editar CC / descartar → ops correctas, usuario del revisor, antes/despues jsonb.
 *   3 · Repartir → todas las filas (original descartada + las nuevas) quedan con op 'repartir'.
 *   4 · parte_auditoria es de SOLO INSERCIÓN: UPDATE y DELETE directos fallan.
 *   5 · Un UPDATE directo por SQL (sin set_config) queda con usuario 'sql:<current_user>'.
 *   6 · parteTardio_: antes/después del mediodía de Bogotá del día siguiente.
 *   7 · Equipo PERIÓDICO (luminaria): sale de «faltantes», está en «periodicos»; un manual de 150 h se
 *       acepta sin TOTAL_ALTO (sin tope).
 *   8 · Equipo NO periódico con 30 h sigue rechazado (tope de 24 h).
 *   9 · Firma con cédula (interruptor encendido, origen QR): sin cédula registrada / cédula errada / sin
 *       declaración → rechazados; correcta → firma='cedula' + huella de 64 hex; la cédula no aparece en la
 *       fila guardada, ni en la respuesta, ni en el LOG.
 *   10 · Firma apagada: acepta sin cédula; op=equipo devuelve firma:false (y true con el interruptor encendido).
 *
 *   node worker/pruebas/verificar_d223_parte_auditoria.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPglite } from './pglite.js';
import { parteReporte, parteBandeja, parteRevisar, parteRepartir, parteEquipo, parteTardio_ } from '../src/api/parte.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL = path.join(RAIZ, 'sql');
let fallos = 0, casos = 0;
const ok = (n, c, x) => { casos++; if (!c) { fallos++; console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); } else console.log('  ✓ ' + n); };

const { pg, sql } = await abrirPglite();
for (const f of fs.readdirSync(SQL).filter((x) => /^0\d\d_.*\.sql$/.test(x)).sort()) await pg.exec(fs.readFileSync(path.join(SQL, f), 'utf8'));

await pg.exec(`
  INSERT INTO parte_equipos (codigo,tipo,placa,medidor,activo) VALUES
    ('CR100','CARGADOR','','HOROMETRO','SI'),
    ('LUM01','LUMINARIA','','HOROMETRO','SI'),
    ('CR200','CARGADOR','','HOROMETRO','SI');
  INSERT INTO parte_cc (centro_coste,proyecto,descripcion_cc,usos_ult_4_meses,activo) VALUES
    ('3701.02.03','3701','Terraplén UF1',50,'SI'),('3701.07.01','3701','Cuneta UF1',20,'SI');
  INSERT INTO parte_operadores (operador,cedula,activo) VALUES
    ('Juan Perez','123456789','SI'),
    ('Ana Torres','111222333','SI'),
    ('Pedro Gomez','','SI');
`);

const ctx = (env) => ({ sql, env: env || {}, memo: {}, pet: { t0: Date.now(), log: {} } });
const ses = { ok: true, usuario: 'ana', rol: 'residente' };
const auditoria = async (id) => sql`SELECT * FROM parte_auditoria WHERE id_registro = ${id} ORDER BY id`;
const filaBandeja = async (id) => (await sql`SELECT * FROM parte_bandeja WHERE id_registro = ${id}`)[0];

console.log('\n1 · Reporte por QR → parte_auditoria op alta, usuario qr:<codigo> · <operador>');
let idQr;
{
  const r = await parteReporte(ctx(), { codigo: 'CR100', origen: 'qr', tramos: [{ fecha: '2026-09-20', reporte_num: '100',
    operador: 'Juan Perez', centro_coste: '3701.02.03', inicial: 10, final: 15, hora_de: '07:00', hora_a: '12:00' }] }, null);
  ok('guardado', r.ok === true && r.guardadas === 1, r);
  idQr = r.filas[0].id_registro;
  const aud = await auditoria(idQr);
  ok('1 fila de auditoría, op alta', aud.length === 1 && aud[0].op === 'alta', aud);
  ok('usuario qr:CR100 · Juan Perez', aud[0].usuario === 'qr:CR100 · Juan Perez', aud[0].usuario);
  ok('antes vacío, despues con la fila', JSON.stringify(aud[0].antes) === '{}' && aud[0].despues.id_registro === idQr, aud[0]);
}

console.log('\n2 · Revisar: aprobar / editar CC / descartar');
{
  const r1 = await parteRevisar(ctx(), { cambios: [{ id_registro: idQr, estado: 'aprobado' }] }, ses);
  ok('aprobado', r1.ok === true && r1.cambiadas === 1, r1);
  const r2 = await parteRevisar(ctx(), { cambios: [{ id_registro: idQr, campos: { centro_coste: '3701.07.01' } }] }, ses);
  ok('editado CC', r2.ok === true && r2.cambiadas === 1, r2);
  const r3 = await parteRevisar(ctx(), { cambios: [{ id_registro: idQr, estado: 'descartado' }] }, ses);
  ok('descartado', r3.ok === true && r3.cambiadas === 1, r3);
  const aud = await auditoria(idQr);
  ok('4 filas en total (alta + 3 revisiones)', aud.length === 4, aud.map((a) => a.op));
  ok('ops: alta, aprobar, editar, descartar', JSON.stringify(aud.map((a) => a.op)) === JSON.stringify(['alta', 'aprobar', 'editar', 'descartar']), aud.map((a) => a.op));
  ok('usuario del revisor en las 3 últimas', aud.slice(1).every((a) => a.usuario === 'ana'), aud.map((a) => a.usuario));
  ok('antes/despues del aprobar reflejan el cambio de estado', aud[1].antes.estado === 'pendiente' && aud[1].despues.estado === 'aprobado', aud[1]);
  ok('antes/despues del editar reflejan el CC', aud[2].antes.centro_coste === '3701.02.03' && aud[2].despues.centro_coste === '3701.07.01', aud[2]);
}

console.log('\n3 · Repartir → todas las filas quedan con op repartir');
{
  await sql`INSERT INTO parte_bandeja (id_registro,"timestamp",estado,fecha,codigo,medidor,reporte_num,inicial,final,hora_de,hora_a,centro_coste,operador,origen)
    VALUES ('rep1','2026-09-20T12:00:00Z','pendiente','2026-09-20','CR100','HOROMETRO','200',10,20,'07:00','16:00','3701.02.03','Juan Perez','manual')`;
  const r = await parteRepartir(ctx(), { id_registro: 'rep1', reparto: [{ centro_coste: '3701.02.03', pct: 50 }, { centro_coste: '3701.07.01', pct: 50 }] }, ses);
  ok('repartido en 2 filas', r.ok === true && r.cambiadas === 3, r);
  const ids = [r.original.id_registro].concat(r.filas.map((f) => f.id_registro));
  const aud = await sql`SELECT * FROM parte_auditoria WHERE id_registro = ANY(${ids})`;
  // 'rep1' llegó por INSERT directo (op 'manual', fuera de esta prueba); el REPARTIR deja 3 filas más (la
  // original descartada + las 2 nuevas), todas con op 'repartir' y el usuario de quien reparte.
  const deReparto = aud.filter((a) => a.op === 'repartir');
  ok('3 filas de auditoría en op repartir (original + 2 nuevas)', deReparto.length === 3, aud.map((a) => [a.id_registro, a.op]));
  ok('usuario del revisor', deReparto.every((a) => a.usuario === 'ana'), deReparto.map((a) => a.usuario));
}

console.log('\n4 · parte_auditoria es de solo inserción');
{
  let updFallo = false, delFallo = false;
  try { await sql`UPDATE parte_auditoria SET usuario='hackeado' WHERE id = 1`; } catch (e) { updFallo = /solo inserción/.test(String(e.message || e)); }
  try { await sql`DELETE FROM parte_auditoria WHERE id = 1`; } catch (e) { delFallo = /solo inserción/.test(String(e.message || e)); }
  ok('UPDATE directo falla', updFallo);
  ok('DELETE directo falla', delFallo);
}

console.log('\n5 · SQL directo sin set_config → usuario sql:<current_user>');
{
  await sql`INSERT INTO parte_bandeja (id_registro,"timestamp",estado,fecha,codigo,medidor,centro_coste,origen)
    VALUES ('sqldirecto1','2026-09-20T12:00:00Z','pendiente','2026-09-20','CR100','HOROMETRO','3701.02.03','manual')`;
  await sql`UPDATE parte_bandeja SET observaciones='tocado a mano' WHERE id_registro='sqldirecto1'`;
  const aud = await auditoria('sqldirecto1');
  ok('2 filas (alta + editar), usuario sql:<algo>', aud.length === 2 && aud.every((a) => /^sql:/.test(a.usuario)), aud.map((a) => [a.op, a.usuario]));
}

console.log('\n6 · parteTardio_: mediodía de Bogotá del día siguiente');
{
  ok('antes del mediodía (11:59 Bogotá del día siguiente) → no tardío', parteTardio_('2026-09-20', '2026-09-21T16:59:00Z') === false);
  ok('después del mediodía (12:01 Bogotá del día siguiente) → tardío', parteTardio_('2026-09-20', '2026-09-21T17:01:00Z') === true);
  ok('turno noche: recibido temprano al otro día (08:00 Bogotá) → no tardío', parteTardio_('2026-09-18', '2026-09-19T13:00:00Z') === false);
}

console.log('\n7 · Equipo periódico (luminaria): fuera de faltantes, en «periodicos», sin tope de horas');
{
  const b = await parteBandeja(ctx(), { fecha: '2026-09-25' });
  ok('LUM01 no está en faltantes', !b.faltantes.some((q) => q.codigo === 'LUM01'), b.faltantes);
  ok('LUM01 está en periodicos', b.periodicos.some((q) => q.codigo === 'LUM01'), b.periodicos);
  ok('CR100 (no periódico, sin parte ese día) sí está en faltantes', b.faltantes.some((q) => q.codigo === 'CR100'), b.faltantes);
  const r = await parteReporte(ctx(), { codigo: 'LUM01', origen: 'manual', tramos: [{ fecha: '2026-09-25', reporte_num: '900',
    operador: 'Juan Perez', centro_coste: '3701.02.03', inicial: 100, final: 250, hora_de: '07:00', hora_a: '16:00' }] }, ses);
  ok('manual de 150 h aceptado', r.ok === true && r.guardadas === 1, r);
  ok('sin TOTAL_ALTO (periódico: sin tope)', !r.filas[0].alertas.join(';').includes('TOTAL_ALTO'), r.filas[0]);
}

console.log('\n8 · Equipo NO periódico con 30 h sigue rechazado (tope de 24 h)');
{
  const r = await parteReporte(ctx(), { codigo: 'CR100', origen: 'manual', tramos: [{ fecha: '2026-09-25', reporte_num: '901',
    operador: 'Juan Perez', centro_coste: '3701.02.03', inicial: 0, final: 30, hora_de: '07:00', hora_a: '16:00' }] }, ses);
  ok('rechazado por tope', r.ok === false && /máximo/.test(r.error || ''), r);
}

console.log('\n9 · Firma con cédula (PARTE_FIRMA=si, origen QR)');
{
  const envFirma = { PARTE_FIRMA: 'si' };
  const r1 = await parteReporte(ctx(envFirma), { codigo: 'CR200', origen: 'qr', tramos: [{ fecha: '2026-09-26', reporte_num: '10',
    operador: 'Pedro Gomez', centro_coste: '3701.02.03', inicial: 0, final: 5, hora_de: '07:00', hora_a: '12:00' }], cedula: '999', declaracion: true }, null);
  ok('sin cédula registrada → rechazo', r1.ok === false && /no tiene cédula registrada/.test(r1.error || ''), r1);

  const r2 = await parteReporte(ctx(envFirma), { codigo: 'CR200', origen: 'qr', tramos: [{ fecha: '2026-09-26', reporte_num: '11',
    operador: 'Ana Torres', centro_coste: '3701.02.03', inicial: 0, final: 5, hora_de: '07:00', hora_a: '12:00' }], cedula: '000000000', declaracion: true }, null);
  ok('cédula errada → rechazo', r2.ok === false && /no coincide/.test(r2.error || ''), r2);

  const r3 = await parteReporte(ctx(envFirma), { codigo: 'CR200', origen: 'qr', tramos: [{ fecha: '2026-09-26', reporte_num: '12',
    operador: 'Ana Torres', centro_coste: '3701.02.03', inicial: 0, final: 5, hora_de: '07:00', hora_a: '12:00' }], cedula: '111.222.333' }, null);
  ok('sin declaración → rechazo', r3.ok === false && /declaración/.test(r3.error || ''), r3);

  const c9 = ctx(envFirma);
  const r4 = await parteReporte(c9, { codigo: 'CR200', origen: 'qr', tramos: [{ fecha: '2026-09-26', reporte_num: '13',
    operador: 'Ana Torres', centro_coste: '3701.02.03', inicial: 0, final: 5, hora_de: '07:00', hora_a: '12:00' }], cedula: '111.222.333', declaracion: true }, null);
  ok('cédula correcta + declaración → aceptado', r4.ok === true && r4.guardadas === 1, r4);
  const id4 = r4.filas[0].id_registro;
  ok('la cédula no viaja en la respuesta', JSON.stringify(r4).indexOf('111222333') < 0 && JSON.stringify(r4).indexOf('111.222.333') < 0);
  ok('el motivo del LOG no lleva la cédula', JSON.stringify(c9.pet.log || {}).indexOf('111222333') < 0);
  const fila4 = await filaBandeja(id4);
  ok('firma=cedula y huella de 64 hex en la fila', fila4.firma === 'cedula' && /^[0-9a-f]{64}$/.test(fila4.firma_huella), fila4);
}

console.log('\n10 · Firma apagada: acepta sin cédula; op=equipo refleja el interruptor');
{
  const r = await parteReporte(ctx(), { codigo: 'CR200', origen: 'qr', tramos: [{ fecha: '2026-09-26', reporte_num: '20',
    operador: 'Pedro Gomez', centro_coste: '3701.02.03', inicial: 5, final: 8, hora_de: '07:00', hora_a: '12:00' }] }, null);
  ok('aceptado sin cédula (interruptor apagado)', r.ok === true && r.guardadas === 1, r);
  const e1 = await parteEquipo(ctx(), { eq: 'CR200' });
  ok('op=equipo firma:false por defecto', e1.firma === false, e1.firma);
  const e2 = await parteEquipo(ctx({ PARTE_FIRMA: 'si' }), { eq: 'CR200' });
  ok('op=equipo firma:true con el interruptor encendido', e2.firma === true, e2.firma);
}

console.log('\n' + casos + ' comprobaciones · ' + fallos + ' fallo(s)');
process.exit(fallos ? 1 : 0);
