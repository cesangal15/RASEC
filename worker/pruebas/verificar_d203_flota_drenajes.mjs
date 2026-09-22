#!/usr/bin/env node
/**
 * Verificación D203 — el residente de drenajes y `duvan` administran la flota de SU grupo.
 * flotaGuardar REAL del Worker sobre Postgres en memoria (PGlite) con el esquema 001–009:
 *
 *   1 · residente_dren / duvan: alta, baja y corrección de estancias de DRENAJES → se guardan.
 *   2 · residente_dren / duvan: alta en tierras, baja/corrección de una estancia de tierras, o mover una
 *       de drenajes a tierras → rechazo explícito, y la tabla no cambia.
 *   3 · Sin regresión: admin, residente (tierras) y jeisson siguen escribiendo cualquier grupo; jefe y
 *       otros usuarios siguen sin escribir.
 *
 *   node worker/pruebas/verificar_d203_flota_drenajes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPglite } from './pglite.js';
import { flotaGuardar } from '../src/api/obra/flota.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL = path.join(RAIZ, 'sql');
let fallos = 0, casos = 0;
const ok = (n, c, x) => { casos++; if (!c) { fallos++; console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); } else console.log('  ✓ ' + n); };

const { pg, sql } = await abrirPglite();
for (const f of fs.readdirSync(SQL).filter((x) => /^0\d\d_.*\.sql$/.test(x) && x < '010').sort()) await pg.exec(fs.readFileSync(path.join(SQL, f), 'utf8'));
await pg.exec(`
  INSERT INTO parte_equipos (codigo,tipo,placa,medidor,activo) VALUES
    ('BL005','BULLDOZER','','HOROMETRO','SI'),('EXC04','EXCAVADORA','','HOROMETRO','SI'),('RT-02','RETROEXCAVADORA','','HOROMETRO','SI');
  INSERT INTO maquinas (id_maquina,tipo,horas_prog,propiedad,fecha_ingreso,fecha_retiro,frente,grupo) VALUES
    ('BL005','BULLDOZER',6.4,'propia','2026-01-01',NULL,'UF1-UF2','tierras'),
    ('EXC04','EXCAVADORA',5,'alquilada','2026-09-03',NULL,'UF1-UF2','drenajes'),
    ('RT-02','RETROEXCAVADORA',5,'alquilada','2026-02-01',NULL,'UF1-UF2','drenajes');`);

const ctx = () => ({ sql, env: {}, memo: {}, pet: { t0: Date.now(), log: {} } });
const SES = {
  duvan: { ok: true, usuario: 'duvan', rol: 'asistencia_plus_dren' },
  rdren: { ok: true, usuario: 'residente_dren', rol: 'residente_dren' },
  jeisson: { ok: true, usuario: 'jeisson', rol: 'asistencia_plus' },
  residente: { ok: true, usuario: 'residente', rol: 'residente' },
  admin: { ok: true, usuario: 'admin', rol: 'admin' },
  jefe: { ok: true, usuario: 'jefe', rol: 'jefe' },
  angie: { ok: true, usuario: 'angie', rol: 'asistencia_plus_tm2' },
  rodt: { ok: true, usuario: 'residente_odt', rol: 'residente_odt' },
};
const g = (ses, body) => flotaGuardar(ctx(), Object.assign({ fecha: '2026-09-22' }, body), SES[ses]);
const alta = (id, grupo, extra) => Object.assign({ action: 'flota_guardar', op: 'alta', id_maquina: id, tipo: 'VOLQUETA', propiedad: 'alquilada',
  fecha_ingreso: '2026-09-20', frente: 'UF1-UF2', grupo: grupo, medidor: 'KM', confirmado: true }, extra || {});
const estancia = async (id) => (await sql`SELECT id_maquina, grupo, fecha_retiro, notas FROM maquinas WHERE id_maquina=${id} ORDER BY fecha_ingreso DESC`)[0] || null;
const foto = async () => JSON.stringify(await sql`SELECT * FROM maquinas ORDER BY id_maquina, fecha_ingreso`);
const esGrupo = (r) => !!(r && r.ok === false && /solo administra la flota de DRENAJES/.test(r.error || ''));

console.log('\n1 · Drenajes escribe su grupo');
{
  let r = await g('duvan', alta('VOL901', 'drenajes'));
  ok('duvan: alta de VOL901 en drenajes', r.ok === true && (await estancia('VOL901'))?.grupo === 'drenajes', r.error);
  r = await g('rdren', alta('VOL902', 'drenajes'));
  ok('residente_dren: alta de VOL902 en drenajes', r.ok === true && (await estancia('VOL902'))?.grupo === 'drenajes', r.error);
  r = await g('duvan', { op: 'corregir', clave: { id_maquina: 'EXC04', fecha_ingreso: '2026-09-03' }, id_maquina: 'EXC04', tipo: 'EXCAVADORA',
    propiedad: 'alquilada', fecha_ingreso: '2026-09-03', frente: 'UF1-UF2', grupo: 'drenajes', notas: 'apoyo ODT' });
  ok('duvan: corrige EXC04 (drenajes) sin sacarla del grupo', r.ok === true && (await estancia('EXC04'))?.notas === 'apoyo ODT', r.error);
  r = await g('rdren', { op: 'baja', clave: { id_maquina: 'RT-02', fecha_ingreso: '2026-02-01' }, fecha_retiro: '2026-09-21' });
  ok('residente_dren: da de baja RT-02 (drenajes)', r.ok === true && (await estancia('RT-02'))?.fecha_retiro === '2026-09-21', r.error);
}

console.log('\n2 · Drenajes NO toca tierras');
{
  const antes = await foto();
  let r = await g('duvan', alta('VOL903', 'tierras'));
  ok('duvan: alta en tierras → rechazo', esGrupo(r), r);
  r = await g('rdren', alta('VOL904', ''));
  ok('residente_dren: alta sin grupo (cae en tierras) → rechazo', esGrupo(r), r);
  r = await g('duvan', { op: 'baja', clave: { id_maquina: 'BL005', fecha_ingreso: '2026-01-01' }, fecha_retiro: '2026-09-21' });
  ok('duvan: baja de BL005 (tierras) → rechazo', esGrupo(r), r);
  r = await g('rdren', { op: 'corregir', clave: { id_maquina: 'BL005', fecha_ingreso: '2026-01-01' }, id_maquina: 'BL005', tipo: 'BULLDOZER',
    propiedad: 'propia', fecha_ingreso: '2026-01-01', frente: 'UF1-UF2', grupo: 'drenajes' });
  ok('residente_dren: corregir BL005 (tierras), aunque la pase a drenajes → rechazo', esGrupo(r), r);
  r = await g('duvan', { op: 'corregir', clave: { id_maquina: 'EXC04', fecha_ingreso: '2026-09-03' }, id_maquina: 'EXC04', tipo: 'EXCAVADORA',
    propiedad: 'alquilada', fecha_ingreso: '2026-09-03', frente: 'UF1-UF2', grupo: 'tierras' });
  ok('duvan: mover EXC04 de drenajes a tierras → rechazo', esGrupo(r), r);
  ok('la tabla no cambió con los rechazos', (await foto()) === antes);
}

console.log('\n3 · Sin regresión en los demás');
{
  let r = await g('jeisson', alta('VOL905', 'tierras'));
  ok('jeisson: alta en tierras', r.ok === true, r.error);
  r = await g('residente', alta('VOL906', 'drenajes'));
  ok('residente (tierras): alta en drenajes', r.ok === true, r.error);
  r = await g('admin', { op: 'baja', clave: { id_maquina: 'BL005', fecha_ingreso: '2026-01-01' }, fecha_retiro: '2026-09-21' });
  ok('admin: baja de BL005 (tierras)', r.ok === true, r.error);
  for (const s of ['jefe', 'angie', 'rodt']) {
    r = await g(s, alta('VOL99' + s.length, 'drenajes'));
    ok(s + ': no escribe (ni siquiera drenajes)', r.ok === false && !esGrupo(r) && /No se guardó nada/.test(r.error || ''), r);
  }
}

console.log('\n' + (fallos ? '✗ ' + fallos + ' de ' + casos + ' casos fallaron' : '✓ ' + casos + ' casos OK'));
process.exit(fallos ? 1 : 0);
