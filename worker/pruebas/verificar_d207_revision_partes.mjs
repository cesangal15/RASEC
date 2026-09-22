#!/usr/bin/env node
/**
 * Verificación D207 — revisión de partes: continuidad del medidor EN VIVO, horario raro y lista completa de CC.
 * parteContinuidad_ y parteBandeja REALES del Worker sobre Postgres en memoria (PGlite) con el esquema 001–009:
 *
 *   1 · INICIAL_DISTINTO se recalcula contra el parte ANTERIOR real (fecha + hora de fin): un aviso sellado que ya
 *       no aplica desaparece (caso real CR019 19-sep: 1358 = 1358) y una diferencia sin aviso aparece.
 *   2 · Turno noche (D188): el diurno del día siguiente empalma con el final del turno 17:00→04:30.
 *   3 · Un parte que llegó atrasado (fecha anterior) se compara con SU anterior, no con el último registrado.
 *   4 · HORARIO_RARO: 17:00→16:30 (23,5 h) se marca; 17:00→04:30 (11,5 h) no.
 *   5 · Lista de CC de la bandeja: PARTE_CC + BASE, UF → área → código, pseudo-CC al final; la fila guarda 27 columnas.
 *
 *   node worker/pruebas/verificar_d207_revision_partes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPglite } from './pglite.js';
import { parteContinuidad_, parteBandeja } from '../src/api/parte.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL = path.join(RAIZ, 'sql');
let fallos = 0, casos = 0;
const ok = (n, c, x) => { casos++; if (!c) { fallos++; console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); } else console.log('  ✓ ' + n); };

const { pg, sql } = await abrirPglite();
for (const f of fs.readdirSync(SQL).filter((x) => /^0\d\d_.*\.sql$/.test(x) && x < '010').sort()) await pg.exec(fs.readFileSync(path.join(SQL, f), 'utf8'));
await pg.exec(`
  INSERT INTO parte_equipos (codigo,tipo,placa,medidor,activo) VALUES ('CR019','CARGADOR','','HOROMETRO','SI'),('VOL044','VOLQUETA','','KM','SI');
  INSERT INTO parte_cc (centro_coste,proyecto,descripcion_cc,usos_ult_4_meses,activo) VALUES
    ('3702.02.03','3702','Terraplén UF2',90,'SI'),('3701.07.01','3701','Cuneta UF1',50,'SI'),('3701.02.03','3701','Terraplén UF1',10,'SI'),('Taller','','Taller',0,'SI');
  INSERT INTO base_items (cc,descripcion,capitulo,orden) VALUES
    ('3701.02.03','Terraplenes','EXPLANACIONES',1),('3701.06.20','Box abovedado 3x1,5','DRENAJE TRANSVERSAL',2),('3702.01.02','Demolición de Estructuras','DEMOLICIONES',3);
`);
const fila = (o) => sql`INSERT INTO parte_bandeja (id_registro,"timestamp",estado,fecha,codigo,medidor,reporte_num,inicial,final,hora_de,hora_a,centro_coste,alertas)
  VALUES (${o.id}, ${o.ts || '2026-09-20T12:00:00Z'}, ${o.estado || 'pendiente'}, ${o.fecha}, ${o.codigo}, ${o.medidor || 'HOROMETRO'}, ${o.rep || ''},
          ${o.ini}, ${o.fin}, ${o.de || '07:00'}, ${o.a || '16:30'}, ${o.cc || '3701.02.03'}, ${o.alertas || ''})`;
// CR019: 17-sep diurno, 18-sep NOCHE 17:00→04:30 (1353→1358), 19-sep diurno arranca en 1358 con aviso viejo sellado.
await fila({ id: 'a1', fecha: '2026-09-17', codigo: 'CR019', ini: 1340, fin: 1347, estado: 'aprobado' });
await fila({ id: 'a2', fecha: '2026-09-18', codigo: 'CR019', ini: 1347, fin: 1353, estado: 'aprobado' });
await fila({ id: 'a3', fecha: '2026-09-18', codigo: 'CR019', ini: 1353, fin: 1358, de: '17:00', a: '04:30', rep: '18916' });
await fila({ id: 'a4', fecha: '2026-09-19', codigo: 'CR019', ini: 1358, fin: 1366, alertas: 'INICIAL_DISTINTO;SIN_CC', ts: '2026-09-19T08:00:00Z' });
// 21-sep: hora mal digitada 17:00→16:30 y un inicial que NO empalma, sin aviso sellado.
await fila({ id: 'a5', fecha: '2026-09-21', codigo: 'CR019', ini: 1371, fin: 1376, de: '17:00', a: '16:30' });
// VOL044: el 22 llegó ANTES que el 20 (parte atrasado): el 20 se compara con el 18, no con el 22.
await fila({ id: 'v1', fecha: '2026-09-18', codigo: 'VOL044', medidor: 'KM', ini: 49335, fin: 49573, estado: 'aprobado' });
await fila({ id: 'v3', fecha: '2026-09-22', codigo: 'VOL044', medidor: 'KM', ini: 50133, fin: 50315, ts: '2026-09-22T08:00:00Z' });
await fila({ id: 'v2', fecha: '2026-09-20', codigo: 'VOL044', medidor: 'KM', ini: 49573, fin: 49891, alertas: 'INICIAL_DISTINTO', ts: '2026-09-23T08:00:00Z' });

const ctx = () => ({ sql, env: {}, memo: {}, pet: { t0: Date.now(), log: {} } });
const leer = async (ids) => (await sql`SELECT * FROM parte_bandeja WHERE id_registro = ANY(${ids})`).map((r) => ({
  ...r, fecha: r.fecha instanceof Date ? r.fecha.toISOString().slice(0, 10) : String(r.fecha).slice(0, 10),
  inicial: Number(r.inicial), final: Number(r.final) }));

console.log('\n1–3 · Continuidad en vivo');
{
  const filas = await leer(['a3', 'a4', 'a5', 'v2', 'v3']);
  const cont = await parteContinuidad_(ctx(), filas);
  const f = (id) => filas.find((r) => r.id_registro === id);
  ok('CR019 19-sep: el aviso viejo INICIAL_DISTINTO desaparece (1358 = 1358); SIN_CC se conserva', f('a4').alertas === 'SIN_CC', f('a4').alertas);
  ok('CR019 19-sep: el anterior es el turno NOCHE del 18 (17:00→04:30, final 1358)', cont.a4.previo && cont.a4.previo.final === 1358 && cont.a4.previo.hora_a === '04:30', cont.a4);
  ok('CR019 noche del 18: su anterior es el diurno del mismo día (1353)', cont.a3.previo && cont.a3.previo.final === 1353 && cont.a3.noche === true, cont.a3);
  ok('CR019 21-sep: 1371 ≠ 1366 → INICIAL_DISTINTO aparece aunque no estaba sellado', f('a5').alertas.split(';').includes('INICIAL_DISTINTO'), f('a5').alertas);
  ok('VOL044 20-sep (llegó tarde): compara con el 18 (49573) → sin aviso', f('v2').alertas === '' && cont.v2.previo.fecha === '2026-09-18', { a: f('v2').alertas, p: cont.v2.previo });
  ok('VOL044 22-sep: compara con el 20 (49891) → 50133 no empalma', f('v3').alertas.includes('INICIAL_DISTINTO') && cont.v3.previo.final === 49891, cont.v3);
}

console.log('\n4 · Horario raro');
{
  const filas = await leer(['a3', 'a5']);
  const cont = await parteContinuidad_(ctx(), filas);
  const f = (id) => filas.find((r) => r.id_registro === id);
  ok('17:00→16:30 = 23,5 h → HORARIO_RARO', f('a5').alertas.includes('HORARIO_RARO') && cont.a5.jornada_h === 23.5, { a: f('a5').alertas, j: cont.a5.jornada_h });
  ok('17:00→04:30 = 11,5 h (turno noche normal) → sin HORARIO_RARO', !f('a3').alertas.includes('HORARIO_RARO') && cont.a3.jornada_h === 11.5, { a: f('a3').alertas, j: cont.a3.jornada_h });
}

console.log('\n5 · Bandeja: lista de CC completa y ordenada, filas de 27 columnas');
{
  const d = await parteBandeja(ctx(), { fecha: '2026-09-19' });   // json() del Worker devuelve el objeto
  const cc = d.listas.cc.map((x) => x.centro_coste);
  ok('incluye CC de la BASE que no están en PARTE_CC (3701.06.20, 3702.01.02)', cc.includes('3701.06.20') && cc.includes('3702.01.02'), cc);
  ok('orden UF1 → UF2 y, dentro, tierras antes que ODT/ODL; pseudo-CC al final', JSON.stringify(cc.filter((x) => /^37/.test(x))) === JSON.stringify(['3701.02.03', '3701.06.20', '3701.07.01', '3702.01.02', '3702.02.03']) && d.listas.cc[d.listas.cc.length - 1].pseudo === true, cc);
  ok('cada CC trae uf y area', d.listas.cc.filter((x) => !x.pseudo).every((x) => x.uf && x.area), d.listas.cc);
  ok('la fila de bandeja sigue con 27 columnas y la continuidad va aparte', d.pendientes.length === 1 && Object.keys(d.pendientes[0]).length === 27 && d.continuidad && d.continuidad.a4 && d.continuidad.a4.previo.final === 1358, d.pendientes[0] && Object.keys(d.pendientes[0]).length);
  ok('bandeja: el aviso viejo no llega a la pantalla', d.pendientes[0].alertas === 'SIN_CC', d.pendientes[0].alertas);
}

console.log('\n' + casos + ' comprobaciones · ' + fallos + ' fallo(s)');
process.exit(fallos ? 1 : 0);
