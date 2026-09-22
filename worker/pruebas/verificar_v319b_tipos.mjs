#!/usr/bin/env node
/**
 * Verificación V3-19b — worker/sql/011_tipos_equipo.sql sobre Postgres en memoria (PGlite), con filas REALES de
 * Supabase (22-sep-2026) de los tipos que se fusionan, y el Worker real (`op=equipo`) leyendo el resultado.
 *
 *   1 · Fichas: cada código queda con el tipo que revisó el dueño; las 5 sin tipo no se tocan; TC065/TC092 activas.
 *   2 · Listas: EXCAVADORA + EXCAVADORAS se fusionan (veces sumadas, una frase por ítem, ninguna repetida);
 *       SRS255 (antes CARRO CISTERNA, sin lista) ya ve actividades de CARROTANQUE.
 *   3 · Flota: solo lo marcado (TC065/TC092 sin retiro, TC095 CAMABAJA, CR026 VIBROCOMPACTADOR, CG007/EXC04 drenajes);
 *       los tipos de la flota siguen dentro de MAQ_TIPOS_FLOTA.
 *   4 · Idempotencia: 011 dos veces, y 010 después de 011, no cambian nada. 011 sin 010 aborta.
 *
 *   node worker/pruebas/verificar_v319b_tipos.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPglite } from './pglite.js';
import { MAQ_TIPOS_FLOTA } from '../src/catalogos.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL = path.join(RAIZ, 'sql');
let fallos = 0, casos = 0;
const ok = (n, c, x) => { casos++; if (!c) { fallos++; console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); } else console.log('  ✓ ' + n); };
const ACT = "upper(trim(activo)) NOT IN ('NO','N','FALSE','0','INACTIVO','INACTIVA')";
const M10 = fs.readFileSync(path.join(SQL, '010_depurar_parte_items.sql'), 'utf8');
const M11 = fs.readFileSync(path.join(SQL, '011_tipos_equipo.sql'), 'utf8');

async function base() {
  const { pg, sql } = await abrirPglite();
  for (const f of fs.readdirSync(SQL).filter((x) => /^0\d\d_.*\.sql$/.test(x) && x < '010').sort()) await pg.exec(fs.readFileSync(path.join(SQL, f), 'utf8'));
  await pg.exec(`
    INSERT INTO parte_items (tipo_equipo,item,actividad,veces,activo) VALUES
      ('EXCAVADORA','2.03','Descapote',4,'SI'),('EXCAVADORA','2.05','Cargue de volquetas',10,'SI'),('EXCAVADORA','2.05','Corte',4,'SI'),
      ('EXCAVADORA','6.01','Excavando',3,'SI'),('EXCAVADORA','6.02','Rellenos con material seleccionado',6,'SI'),
      ('EXCAVADORAS','2.03','Descapote',20,'SI'),('EXCAVADORAS','2.05','Cargue de volquetas',60,'SI'),('EXCAVADORAS','2.05','Cargue de material',44,'SI'),
      ('EXCAVADORAS','2.06','Corte',24,'SI'),('EXCAVADORAS','6.01','Excavaciones varias sin clasicar',8,'SI'),
      ('EXCAVADORAS','6.02','Apoyo odt',5,'SI'),('EXCAVADORAS','6.02','Apoyo a odt',3,'SI'),('EXCAVADORAS','6.02','Cargue de volquetas',3,'SI'),
      ('CARROTANQUE','3.01','Humectacion',9,'SI'),('CARROTANQUE','3.03','Humectacion btc',5,'SI'),('CARROTANQUE','2.07','Terraplenes (solo conformación)',17,'SI'),
      ('CAMION CISTERNA','3.01','Humectacion',5,'SI'),('CAMION CISTERNA','3.03','Base granular estabilizada con cemento (No incluye cemento)',14,'SI'),
      ('CAMABAJA','2.07','Vibrocompactador',9,'SI'),('CAMABAJA','5.04','Relleno para muros de tierra',20,'SI'),
      ('CAMIONES','2.07','Humectacion de sub base',14,'SI'),('CAMIONES','6.04','Cargue de acero',12,'SI'),
      ('TRACTOCAMIONES','11.01','PLAN DE MANEJO DE TRÁFICO (PMT''S)',25,'SI');
    INSERT INTO parte_equipos (codigo,tipo,activo) VALUES
      ('EXC015','EXCAVADORAS','SI'),('CAT320','EXCAVADORA','NO'),('SRS255','CARRO CISTERNA','NO'),('LPL495','CAMION CISTERNA','NO'),
      ('TC095','TRACTOCAMIONES','SI'),('TC065','TRACTOCAMIONES','NO'),('TC092','TRACTOCAMIONES','NO'),('GQW139','','NO'),('PH102','PAJARITA','NO');
    INSERT INTO maquinas (id_maquina,tipo,horas_prog,propiedad,fecha_ingreso,fecha_retiro,frente,grupo) VALUES
      ('CG007','CAMION',NULL,'propia','2026-01-05',NULL,'UF1-UF2','tierras'),('CR026','MINIBULDOZER',6.4,'propia','2026-01-01',NULL,'UF1-UF2','tierras'),
      ('EXC04','EXCAVADORA',5,'alquilada','2026-09-03',NULL,'UF1-UF2','tierras'),
      ('TC065','TRACTOCAMION',NULL,'propia','2026-08-18','2026-09-07','UF1-UF2','tierras'),
      ('TC092','TRACTOCAMION',NULL,'propia','2026-08-18','2026-09-07','UF1-UF2','tierras'),
      ('TC095','TRACTOCAMION',NULL,'propia','2026-01-01',NULL,'UF1-UF2','tierras'),
      ('BL005','BULLDOZER',6.4,'propia','2026-01-01',NULL,'UF1-UF2','tierras');`);
  return { pg, sql };
}

console.log('\n0 · 011 sin 010 aborta');
{
  const { pg } = await base();
  let err = ''; try { await pg.exec(M11); } catch (e) { err = String(e.message || e); }
  ok('RAISE «aplica primero 010»', /aplica primero 010/.test(err), err);
}

const { pg, sql } = await base();
await pg.exec(M10); await pg.exec(M11);
const tipoDe = async (c) => ((await sql`SELECT tipo, activo FROM parte_equipos WHERE codigo=${c}`)[0] || {});

console.log('\n1 · Fichas');
{
  ok('EXC015 → EXCAVADORA · CAT320 sigue EXCAVADORA', (await tipoDe('EXC015')).tipo === 'EXCAVADORA' && (await tipoDe('CAT320')).tipo === 'EXCAVADORA');
  ok('SRS255 y LPL495 → CARROTANQUE · PH102 → RETROCARGADOR · TC095 → CAMABAJA', (await tipoDe('SRS255')).tipo === 'CARROTANQUE' && (await tipoDe('LPL495')).tipo === 'CARROTANQUE' && (await tipoDe('PH102')).tipo === 'RETROCARGADOR' && (await tipoDe('TC095')).tipo === 'CAMABAJA');
  ok('GQW139 (sin tipo) no se toca', (await tipoDe('GQW139')).tipo === '');
  ok('TC065 y TC092: TRACTOCAMION y activas', (await tipoDe('TC065')).tipo === 'TRACTOCAMION' && (await tipoDe('TC065')).activo === 'SI' && (await tipoDe('TC092')).activo === 'SI');
}

console.log('\n2 · Listas fusionadas');
{
  const ex = await sql.unsafe(`SELECT item, actividad, veces FROM parte_items WHERE tipo_equipo='EXCAVADORA' AND ${ACT} ORDER BY item`);
  ok('EXCAVADORA: una fila por ítem (02.03, 02.05, 02.06, 06.01, 06.02)', JSON.stringify(ex.map((r) => r.item)) === '["2.03","2.05","2.06","6.01","6.02"]', ex);
  const c205 = ex.find((r) => r.item === '2.05');
  ok('02.05 suma las dos listas: 60+44 (EXCAVADORAS, ya en 1 frase por la 010) + 10+4 = 118', c205 && c205.veces === 118, c205);
  ok('ninguna frase repetida en el tipo', new Set(ex.map((r) => r.actividad.toLowerCase())).size === ex.length, ex.map((r) => r.actividad));
  ok('los tipos viejos quedan sin filas activas', (await sql.unsafe(`SELECT count(*)::int n FROM parte_items WHERE tipo_equipo IN ('EXCAVADORAS','CAMION CISTERNA','TRACTOCAMIONES') AND ${ACT}`))[0].n === 0);
  const cg = await sql.unsafe(`SELECT tipo_equipo t, item FROM parte_items WHERE item IN ('2.07','6.04') AND tipo_equipo IN ('CAMION GRUA','CARROTANQUE') AND ${ACT} ORDER BY 1,2`);
  ok('opción (a): humectación de CAMIONES (02.07) va a CARROTANQUE; cargue de acero (06.04) a CAMION GRUA', JSON.stringify(cg.map((r) => r.t + ' ' + r.item)) === JSON.stringify(['CAMION GRUA 6.04', 'CARROTANQUE 2.07']), cg);
  const { parteDoGet_ } = await import('../src/api/parte.js');
  const r = await parteDoGet_({ sql, memo: {}, pet: { t0: Date.now(), log: null }, env: {} }, { op: 'equipo', eq: 'SRS255' });
  ok('Worker: SRS255 (antes sin lista) ya ve botones de CARROTANQUE', ((r.actividades || {}).habituales || []).length >= 3, r.actividades && r.actividades.habituales);
}

console.log('\n3 · Flota');
{
  const f = Object.fromEntries((await sql`SELECT id_maquina, tipo, fecha_retiro, grupo FROM maquinas`).map((x) => [x.id_maquina, x]));
  ok('TC065/TC092 sin fecha de retiro', f.TC065.fecha_retiro === null && f.TC092.fecha_retiro === null);
  ok('TC095 CAMABAJA · CR026 VIBROCOMPACTADOR', f.TC095.tipo === 'CAMABAJA' && f.CR026.tipo === 'VIBROCOMPACTADOR');
  ok('CG007 y EXC04 en drenajes; BL005 sigue en tierras', f.CG007.grupo === 'drenajes' && f.EXC04.grupo === 'drenajes' && f.BL005.grupo === 'tierras');
  ok('EXC04 sigue EXCAVADORA en la flota (lista fija)', f.EXC04.tipo === 'EXCAVADORA');
  ok('todos los tipos de la flota están en MAQ_TIPOS_FLOTA', Object.values(f).every((x) => MAQ_TIPOS_FLOTA.includes(x.tipo)), Object.values(f).map((x) => x.tipo));
}

console.log('\n4 · Idempotencia');
{
  const foto = async () => JSON.stringify(await sql`SELECT tipo_equipo,item,actividad,veces,activo FROM parte_items ORDER BY 1,2,3`) + JSON.stringify(await sql`SELECT codigo,tipo,activo FROM parte_equipos ORDER BY 1`) + JSON.stringify(await sql`SELECT id_maquina,tipo,fecha_retiro,grupo FROM maquinas ORDER BY 1`);
  const a = await foto(); await pg.exec(M11); const b = await foto(); await pg.exec(M10); const c = await foto();
  ok('011 otra vez: nada cambia', a === b);
  ok('010 después de 011: nada cambia', b === c);
}

console.log('\n' + (fallos ? '✗ ' + fallos + ' de ' + casos + ' fallaron' : '✓ ' + casos + ' comprobaciones en verde'));
process.exit(fallos ? 1 : 0);
