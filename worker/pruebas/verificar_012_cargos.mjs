#!/usr/bin/env node
/**
 * Verificación worker/sql/012_unificar_cargos.sql sobre Postgres en memoria (PGlite), con las migraciones
 * 0*.sql completas (001→012) y filas sembradas de cada variante de la lista del dueño.
 *
 *   1 · Cada variante de `personal.cargo` y `asistencia.cargo` queda con el texto canónico exacto.
 *   2 · Cargos NO listados no se tocan (verbatim).
 *   3 · Respaldo `cargos_respaldo_012`: una fila por cambio real, con la clave, el cargo anterior y el nuevo.
 *   4 · Idempotencia: correr 012 otra vez no cambia nada y no duplica el respaldo (0 filas nuevas).
 *   5 · El SQL de deshacer (del comentario final de 012) restaura el estado previo a la migración.
 *
 *   node worker/pruebas/verificar_012_cargos.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPglite } from './pglite.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_DIR = path.join(RAIZ, 'sql');
let fallos = 0, casos = 0;
const ok = (n, c, x) => { casos++; if (!c) { fallos++; console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); } else console.log('  ✓ ' + n); };

// Variantes de la decisión del dueño → canónico esperado.
const VARIANTES = [
  ['OPERADOR DE VOLQUETA', 'Operador de volqueta'], ['OP VOLQUETA', 'Operador de volqueta'], ['VOLQUETERO', 'Operador de volqueta'],
  ['OFICIAL DE OBRA', 'Oficial de obra'], ['OFICIAL', 'Oficial de obra'], ['OFICIA', 'Oficial de obra'],
  ['AYUDANTE DE OBRA', 'Ayudante de obra'], ['AYUDANTE', 'Ayudante de obra'],
  ['CAPATAZ DE OBRA', 'Capataz de obra'], ['CAPATAZ', 'Capataz de obra'],
  ['OPERADOR MOTONIVELADORA', 'Operador de motoniveladora'], ['OPERADOR DE MOTONIVERLADORA', 'Operador de motoniveladora'],
  ['OPERADOR EXCAVADORA', 'Operador de excavadora'],
  ['OPERADOR MULTIPLE', 'Operador múltiple'],
  ['INGENIERO RESIDENTE', 'Ingeniero residente'], ['RESIDENTE', 'Ingeniero residente'],
  ['MECANICO', 'Mecánico'],
  ['AUXILIAR ADMINISTRATIVO', 'Auxiliar administrativo'],
  ['ENCARGADO', 'Encargado'],
  ['AYUDANTE DE CONTROL', 'Ayudante de control'],
  ['OFICIAL DE ESTRUCTURA', 'Oficial de estructura'],
  ['OPERADOR DE BULLDOZER', 'Operador de bulldozer'],
  ['OPERADOR DE CAMABAJA', 'Operador de camabaja'],
  ['OPERADOR DE CARRO TANQUE', 'Operador de carro tanque'],
  ['OPERADOR DE VIBROCOMPACTADOR', 'Operador de vibrocompactador'],
  // variaciones de mayúsculas/tildes/espacios sobre una MISMA clave: deben caer en el mismo canónico
  ['  Oficial   de   obra  ', 'Oficial de obra'],
  ['operador de volqueta', 'Operador de volqueta'],
];
const NO_LISTADOS = ['Soldador', 'CONDUCTOR', 'ALMACENISTA'];   // no están en la lista del dueño: no se tocan

async function base() {
  const { pg, sql } = await abrirPglite();
  for (const f of fs.readdirSync(SQL_DIR).filter((x) => /^0\d\d_.*\.sql$/.test(x) && x < '012').sort()) {
    await pg.exec(fs.readFileSync(path.join(SQL_DIR, f), 'utf8'));
  }
  let seq = 0;
  const siguienteId = () => 'v012-' + String(++seq).padStart(6, '0');
  for (const [variante] of VARIANTES) {
    await sql`INSERT INTO personal (obra_id, cedula, codigo, nombre, cargo, estado) VALUES ('tm2sur', '', ${'C' + seq}, 'X', ${variante}, 'activo')`;
    await sql`INSERT INTO asistencia (obra_id, id_registro, fecha, cargo, cc, presente) VALUES ('tm2sur', ${siguienteId()}, '2026-09-01', ${variante}, '3701.02.05| X', 'Si')`;
  }
  for (const cargo of NO_LISTADOS) {
    await sql`INSERT INTO personal (obra_id, cedula, codigo, nombre, cargo, estado) VALUES ('tm2sur', '', ${'N' + (++seq)}, 'X', ${cargo}, 'activo')`;
    await sql`INSERT INTO asistencia (obra_id, id_registro, fecha, cargo, cc, presente) VALUES ('tm2sur', ${siguienteId()}, '2026-09-01', ${cargo}, '3701.02.05| X', 'Si')`;
  }
  return { pg, sql };
}
const M12 = fs.readFileSync(path.join(SQL_DIR, '012_unificar_cargos.sql'), 'utf8');

const { pg, sql } = await base();

console.log('\n1 · antes de 012: los cargos siguen tal cual se sembraron');
{
  const filas = await sql`SELECT cargo FROM personal WHERE cargo=${VARIANTES[0][0]}`;
  ok('sembrado sin tocar (pre-migración)', filas.length === 1, filas);
}

await pg.exec(M12);

console.log('\n2 · cada variante queda con el canónico exacto (personal y asistencia)');
{
  let bienP = true, bienA = true;
  const detalle = [];
  for (const [variante, canon] of VARIANTES) {
    const p = await sql`SELECT cargo FROM personal WHERE nombre='X' AND cargo=${canon}`;
    const cnt = (await sql`SELECT count(*)::int n FROM personal WHERE nombre='X'`);
    // como varias variantes normalizan a la misma clave, se busca por coincidencia de AL MENOS una fila con el canónico
    const okP = (await sql`SELECT 1 FROM personal WHERE cargo=${canon} LIMIT 1`).length === 1;
    if (!okP) { bienP = false; detalle.push(['personal', variante, canon]); }
  }
  ok('personal: cada canónico de la lista aparece al menos una vez', bienP, detalle);
  let bienA2 = true;
  for (const [, canon] of VARIANTES) {
    const okA = (await sql`SELECT 1 FROM asistencia WHERE cargo=${canon} LIMIT 1`).length === 1;
    if (!okA) bienA2 = false;
  }
  ok('asistencia: cada canónico de la lista aparece al menos una vez', bienA2);
  // ninguna variante cruda (distinta de su canónico) sigue viva: todas se canonizaron
  let crudasVivas = [];
  for (const [variante, canon] of VARIANTES) {
    if (variante === canon) continue;
    const filas = await sql`SELECT cargo FROM personal WHERE cargo=${variante}`;
    if (filas.length) crudasVivas.push([variante, filas.length]);
  }
  ok('ninguna variante cruda (distinta del canónico) sigue en personal', crudasVivas.length === 0, crudasVivas);
}

console.log('\n3 · cargos NO listados no se tocan');
{
  for (const cargo of NO_LISTADOS) {
    const p = (await sql`SELECT 1 FROM personal WHERE cargo=${cargo} LIMIT 1`).length === 1;
    const a = (await sql`SELECT 1 FROM asistencia WHERE cargo=${cargo} LIMIT 1`).length === 1;
    ok('«' + cargo + '» verbatim en personal y asistencia', p && a);
  }
}

console.log('\n4 · respaldo cargos_respaldo_012');
{
  const filas = await sql`SELECT tabla_origen, clave, cargo_anterior, cargo_nuevo FROM cargos_respaldo_012 ORDER BY id`;
  ok('hay filas de respaldo para personal y asistencia', filas.some((f) => f.tabla_origen === 'personal') && filas.some((f) => f.tabla_origen === 'asistencia'), filas.length);
  const cambiosEsperados = VARIANTES.filter(([v, c]) => v !== c).length * 2;   // personal + asistencia, solo donde cargo <> canónico
  ok('nº de filas de respaldo = nº de cambios reales (variante <> canónico) × 2 tablas', filas.length === cambiosEsperados, [filas.length, cambiosEsperados]);
  ok('cada respaldo trae cargo_anterior distinto de cargo_nuevo', filas.every((f) => f.cargo_anterior !== f.cargo_nuevo), filas);
  const conCanon = await sql`SELECT tabla_origen, clave FROM cargos_respaldo_012 WHERE cargo_nuevo='Oficial de obra' AND tabla_origen='personal'`;
  ok('la clave del respaldo de personal es obra_id|personal_id', conCanon.length > 0 && /^tm2sur\|\d+$/.test(conCanon[0].clave), conCanon);
}

console.log('\n5 · idempotencia: correr 012 otra vez no cambia nada');
{
  const foto = async () => JSON.stringify(await sql`SELECT obra_id, personal_id, cargo FROM personal ORDER BY personal_id`)
    + JSON.stringify(await sql`SELECT obra_id, id_registro, cargo FROM asistencia ORDER BY id_registro`);
  const a = await foto();
  const nRespaldoAntes = (await sql`SELECT count(*)::int n FROM cargos_respaldo_012`)[0].n;
  await pg.exec(M12);
  const b = await foto();
  const nRespaldoDespues = (await sql`SELECT count(*)::int n FROM cargos_respaldo_012`)[0].n;
  ok('cargos de personal/asistencia intactos en la 2ª pasada', a === b);
  ok('el respaldo NO crece en la 2ª pasada (0 filas nuevas)', nRespaldoAntes === nRespaldoDespues, [nRespaldoAntes, nRespaldoDespues]);
}

console.log('\n6 · el SQL de deshacer restaura el estado previo');
{
  await pg.exec(`
    UPDATE personal p SET cargo = r.cargo_anterior
      FROM cargos_respaldo_012 r
      WHERE r.tabla_origen='personal' AND r.clave = p.obra_id || '|' || p.personal_id AND p.cargo = r.cargo_nuevo;
    UPDATE asistencia a SET cargo = r.cargo_anterior
      FROM cargos_respaldo_012 r
      WHERE r.tabla_origen='asistencia' AND r.clave = a.obra_id || '|' || a.id_registro AND a.cargo = r.cargo_nuevo;
    DELETE FROM cargos_respaldo_012;
    DELETE FROM esquema_version WHERE version=12;
  `);
  let restaurado = true, detalle = [];
  for (const [variante] of VARIANTES) {
    const p = await sql`SELECT count(*)::int n FROM personal WHERE nombre='X' AND cargo=${variante}`;
    if (p[0].n < 1) { restaurado = false; detalle.push(['personal', variante, p[0].n]); }
  }
  ok('deshacer: cada fila de personal vuelve a su cargo sembrado original', restaurado, detalle);
  const version12 = await sql`SELECT 1 FROM esquema_version WHERE version=12`;
  ok('esquema_version 12 eliminado por el deshacer', version12.length === 0);
  const respaldoVacio = (await sql`SELECT count(*)::int n FROM cargos_respaldo_012`)[0].n;
  ok('cargos_respaldo_012 vacío tras el deshacer', respaldoVacio === 0, respaldoVacio);
}

console.log('\n' + (fallos ? '✗ ' + fallos + ' de ' + casos + ' fallaron' : '✓ ' + casos + ' comprobaciones en verde'));
process.exit(fallos ? 1 : 0);
