#!/usr/bin/env node
/**
 * Verificación V3-19 — worker/sql/010_depurar_parte_items.sql sobre Postgres en memoria (PGlite).
 *
 * Aplica 001…009, carga filas REALES de parte_items (copiadas de Supabase el 21-sep-2026: los tipos con
 * frases que chocaban), corre la 010 DOS veces y comprueba:
 *   1 · una sola fila activa por (tipo, ítem), con la frase canónica y veces = suma de las activas de antes;
 *   2 · ninguna frase repetida dentro de un tipo entre las filas activas;
 *   3 · nada se borra (las demás quedan activo='NO') y el respaldo guarda el catálogo de antes;
 *   4 · idempotente: la 2ª pasada no cambia nada.
 *
 *   node worker/pruebas/verificar_v319_depurar_items.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPglite } from './pglite.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL = path.join(RAIZ, 'sql');
let fallos = 0, casos = 0;
const ok = (n, c, x) => { casos++; if (!c) { fallos++; console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); } else console.log('  ✓ ' + n); };

const REALES = [
  ['RETRO DE LLANTAS','6.02','Excavacion',21],['RETRO DE LLANTAS','6.01','Excavacion',27],['RETRO DE LLANTAS','6.01','Cargue de volquetas odt',6],
  ['RETRO DE LLANTAS','6.01','Cargue de volqueta',5],['RETRO DE LLANTAS','6.05','Excavacion',5],['RETRO DE LLANTAS','2.09','Excavacion',8],
  ['RETRO DE LLANTAS','2.05','Paisajeo',5],['RETRO DE LLANTAS','2.05','Excavacion',4],['RETRO DE LLANTAS','2.03','Paisajeo',3],
  ['VIBROCOMPACTADOR','2.07','Compactacion terraplen',90],['VIBROCOMPACTADOR','2.07','Compactando terraplen',28],['VIBROCOMPACTADOR','2.07','Conformacion terraplen',27],
  ['VIBROCOMPACTADOR','5.04','Compactando terraplen',85],['VIBROCOMPACTADOR','5.04','Compactacion terraplen',29],['VIBROCOMPACTADOR','3.01','Compactacion terraplen',14],
  ['VIBROCOMPACTADOR','3.01','Compactando sub base',13],['VIBROCOMPACTADOR','3.01','Compactacion sub base',9],['VIBROCOMPACTADOR','2.12','Compactando terraplen',10],
  ['VIBROCOMPACTADOR','11.04','Imprevistos (bloqueos - Paros)',9],['VIBROCOMPACTADOR','2.08','Conformación y disposición de sobrantes (incluye obras de adecuación)',5],
  ['TORRES DE ILUMINACIÓN','2.05','Terraplen',14],['TORRES DE ILUMINACIÓN','2.07','Terraplen',16],
  ['VOLQUETAS DOBLETROQUE','2.11','Cargue terraplen (más de 1 km)',156],['VOLQUETAS DOBLETROQUE','2.1','Cargue terraplen (100 m a 1 km)',29],
  ['VOLQUETAS DOBLETROQUE','3.04','Cargue de btc de la putana',21],['VOLQUETAS DOBLETROQUE','3.04','Cargue btc',19],
  // un tipo que la 010 no conoce: no se toca
  ['TIPO NUEVO','2.07','Algo',3],['TIPO NUEVO','2.07','Otra cosa',2]];
const ACTIVA = "upper(trim(activo)) NOT IN ('NO','N','FALSE','0','INACTIVO','INACTIVA')";

const { pg, sql } = await abrirPglite();
for (const f of fs.readdirSync(SQL).filter((x) => /^0\d\d_.*\.sql$/.test(x) && x < '010').sort()) await pg.exec(fs.readFileSync(path.join(SQL, f), 'utf8'));
for (const [t, i, a, v] of REALES) await sql`INSERT INTO parte_items (obra_id, tipo_equipo, item, actividad, veces, activo) VALUES ('tm2sur', ${t}, ${i}, ${a}, ${v}, 'SI')`;
await sql`INSERT INTO parte_equipos (obra_id, codigo, tipo, medidor, activo) VALUES ('tm2sur', 'MC64', 'RETRO DE LLANTAS', 'HOROMETRO', 'SI'), ('tm2sur', '15', 'VIBROCOMPACTADOR', 'HOROMETRO', 'SI')`;
// El Worker REAL (src/api/parte.js, op=equipo) sobre esta base: los chips que vería el operador.
const { parteDoGet_ } = await import('../src/api/parte.js');
const chips = async (eq) => { const r = await parteDoGet_({ sql, memo: {}, pet: { t0: Date.now(), log: null }, env: {} }, { op: 'equipo', eq }); return ((r.actividades || {}).habituales || []).map((a) => a.item + ' ' + a.actividad); };
const norm = (s) => s.slice(s.indexOf(' ') + 1).normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();

console.log('\n0 · Worker, ANTES de la 010: la protección de código ya evita chips repetidos');
{
  const h = await chips('MC64');
  ok('retro de llantas: 5 chips, ninguna frase repetida (antes: 4 «Excavacion»)', h.length === 5 && new Set(h.map(norm)).size === 5, h);
}

const MIG = fs.readFileSync(path.join(SQL, '010_depurar_parte_items.sql'), 'utf8');
await pg.exec(MIG);

console.log('\n0b · Worker, DESPUÉS de la 010: frases canónicas');
{
  const h = await chips('MC64'), v = await chips('15');
  ok('retro de llantas: las frases de la 010, ordenadas por uso sumado (02.05 = 5+4 > 02.09 = 8)', JSON.stringify(h) === JSON.stringify(['06.01 Excavación y cargue (ODT)', '06.02 Rellenos con material seleccionado', '02.05 Paisajeo en excavación', '02.09 Caminos y accesos', '06.05 Excavación para tubería (06.05)']), h);
  ok('vibro: 5 chips distintos y 03.01 = «Compactación de subbase»', v.length === 5 && new Set(v.map(norm)).size === 5 && v.includes('03.01 Compactación de subbase'), v);
}
const foto = async () => JSON.stringify(await sql`SELECT tipo_equipo, item, actividad, veces, activo FROM parte_items ORDER BY 1,2,3`);
const tras1 = await foto();

console.log('\n1 · Una fila activa por (tipo, ítem), frase canónica, veces sumadas');
{
  const dup = await sql.unsafe(`SELECT tipo_equipo, item, count(*) n FROM parte_items WHERE ${ACTIVA} AND tipo_equipo<>'TIPO NUEVO' GROUP BY 1,2 HAVING count(*)>1`);
  ok('ningún (tipo, ítem) con dos frases activas', dup.length === 0, dup);
  const r = await sql.unsafe(`SELECT item, actividad, veces FROM parte_items WHERE tipo_equipo='RETRO DE LLANTAS' AND ${ACTIVA} ORDER BY veces DESC`);
  ok('retro de llantas: 06.01 = «Excavación y cargue (ODT)» con 27+6+5 = 38', r[0].item === '6.01' && r[0].actividad === 'Excavación y cargue (ODT)' && r[0].veces === 38, r[0]);
  const v = await sql.unsafe(`SELECT actividad, veces FROM parte_items WHERE tipo_equipo='VIBROCOMPACTADOR' AND item='3.01' AND ${ACTIVA}`);
  ok('vibro 03.01 deja de decir «terraplén»: «Compactación de subbase» con 14+13+9 = 36', v.length === 1 && v[0].actividad === 'Compactación de subbase' && v[0].veces === 36, v);
  const vol = await sql.unsafe(`SELECT actividad, veces FROM parte_items WHERE tipo_equipo='VOLQUETAS DOBLETROQUE' AND item='2.11' AND ${ACTIVA}`);
  ok('una frase sola sin choque se renombra y conserva sus veces (156)', vol.length === 1 && vol[0].veces === 156, vol);
}

console.log('\n2 · Ninguna frase repetida dentro de un tipo');
{
  const rep = await sql.unsafe(`SELECT tipo_equipo, lower(actividad) a, count(*) n FROM parte_items WHERE ${ACTIVA} GROUP BY 1,2 HAVING count(*)>1`);
  ok('sin frases repetidas entre las activas', rep.length === 0, rep);
  const t = await sql.unsafe(`SELECT item, actividad FROM parte_items WHERE tipo_equipo='TORRES DE ILUMINACIÓN' AND ${ACTIVA} ORDER BY item`);
  ok('torres: 02.05 y 02.07 ya no dicen las dos «Terraplen»', t.length === 2 && t[0].actividad !== t[1].actividad, t);
}

console.log('\n3 · Nada se borra; el respaldo tiene el catálogo de antes');
{
  const [{ n }] = await sql.unsafe(`SELECT count(*)::int n FROM parte_items WHERE actividad IN (${REALES.map((r) => "'" + r[2].replace(/'/g, "''") + "'").join(',')})`);
  ok('las frases originales siguen en la tabla', n >= new Set(REALES.map((r) => r[0] + '|' + r[1] + '|' + r[2])).size - 0, n);
  const [{ r }] = await sql.unsafe('SELECT count(*)::int r FROM parte_items_respaldo_010');
  ok('respaldo = ' + REALES.length + ' filas de antes', r === REALES.length, r);
  const nuevo = await sql.unsafe(`SELECT actividad, activo FROM parte_items WHERE tipo_equipo='TIPO NUEVO' ORDER BY actividad`);
  ok('un tipo fuera de la lista no se toca', nuevo.length === 2 && nuevo.every((x) => x.activo === 'SI'), nuevo);
  const [{ e }] = await sql.unsafe('SELECT count(*)::int e FROM esquema_version WHERE version=10');
  ok('esquema_version 10 registrada', e === 1, e);
}

console.log('\n4 · Idempotente');
{
  await pg.exec(MIG);
  ok('la 2ª pasada deja exactamente lo mismo', (await foto()) === tras1);
}

console.log('\n' + (fallos ? '✗ ' + fallos + ' de ' + casos + ' fallaron' : '✓ ' + casos + ' comprobaciones en verde'));
process.exit(fallos ? 1 : 0);
