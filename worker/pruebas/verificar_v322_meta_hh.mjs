#!/usr/bin/env node
/**
 * verificar_v322_meta_hh.mjs — V3-22 / D210: meta MENSUAL de horas-hombre de personal DIRECTO por partida
 * (Excavación · Terraplén · Subbase · Base), worker/sql/013_meta_horas_hombre.sql sobre proy_plan, directo
 * contra Postgres EN MEMORIA (PGlite), sin red. Mismo patrón que verificar_d183_proyeccion.mjs.
 *
 *   node worker/pruebas/verificar_v322_meta_hh.mjs
 *
 * Lo que se comprueba:
 *   1. 001…013 aplican en orden; esquema_version llega a 13; las 4 columnas hh_* existen con su CHECK (≥ 0).
 *   2. proyeccionLeer: COLUMNAS.plan trae las 4 columnas nuevas agrupadas («Meta horas-hombre (personal
 *      directo)»), y las filas las traen (vacías = sin meta, las semillas de 006 no cargan ninguna).
 *   3. proyeccionGuardar: guarda un número válido en la meta de un periodo (version sube por la secuencia del
 *      plan); un negativo se rechaza (texto legible, nada se guarda); vacío = NULL (borra la meta); if_version
 *      equivocado → conflicto de versión (rollback de TODO el lote), como el resto del plan.
 *   4. proyeccionTableroDatos_ expone `plan_hh` (aparte de `plan`, que no cambia de forma) con NULL = sin
 *      meta para cada periodo, y el número guardado para el que se editó en el paso 3.
 *   5. Degradación (013 SIN aplicar, solo 001…012): proyeccionLeer y proyeccionTableroDatos_ siguen ok:true
 *      (sin tumbarse); las 4 metas vacías/NULL en toda la respuesta. proyeccionGuardar de CUALQUIER campo del
 *      plan (toque o no la meta) responde ok:false con un texto legible («falta aplicar … 013 …»), nunca una
 *      excepción — mismo criterio que `grupo` en flota.js (D190): las 4 columnas van siempre en el INSERT/
 *      UPDATE del plan, así que sin 013 el plan no se puede escribir hasta aplicarla (SÍ se puede leer).
 * Sale con código 1 si algo falla.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPglite } from './pglite.js';
import { proyeccionLeer, proyeccionGuardar, proyeccionTableroDatos_ } from '../src/api/obra/proyeccion.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, '..', '..');
const SQL_DIR = path.join(REPO, 'worker', 'sql');

let casos = 0, fallos = 0;
function ok(n, c, x){ casos++; if (c) console.log('  ✓ ' + n); else { fallos++; console.log('  ✗ ' + n + (x !== undefined ? '  → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 400) : '')); } }
const titulo = (s) => console.log('\n' + s);

async function bancoNuevo(hasta){
  const { sql } = await abrirPglite();
  const q = (t, p) => sql.unsafe(t, p);
  const migraciones = fs.readdirSync(SQL_DIR).filter(f => /^0\d+_.*\.sql$/.test(f)).sort();
  for (const f of migraciones){
    if (hasta && f > hasta) continue;
    await sql.exec(fs.readFileSync(path.join(SQL_DIR, f), 'utf8'));
  }
  return { sql, q, migraciones: migraciones.filter(f => !hasta || f <= hasta) };
}
const ctx = (sql) => ({ sql, memo: {}, pet: { t0: Date.now(), log: null } });
const ses = { ok: true, usuario: 'jefe', rol: 'jefe' };

async function main(){
  /* 1 · migraciones y columnas */
  titulo('1 · 001…013 sobre un PGlite nuevo');
  const { sql, q, migraciones } = await bancoNuevo();
  ok('se aplicaron hasta 013_meta_horas_hombre.sql', migraciones.indexOf('013_meta_horas_hombre.sql') >= 0, migraciones);
  const ver = await q(`SELECT max(version)::int AS v, count(*) FILTER (WHERE version = 13)::int AS n13 FROM esquema_version`);
  ok('esquema_version tiene la 13 (una fila)', ver[0].v >= 13 && ver[0].n13 === 1, ver[0]);
  const cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'proy_plan' AND column_name LIKE 'hh_%' ORDER BY column_name`);
  ok('proy_plan tiene hh_base, hh_excavacion, hh_subbase, hh_terraplen', JSON.stringify(cols.map(r => r.column_name)) === JSON.stringify(['hh_base', 'hh_excavacion', 'hh_subbase', 'hh_terraplen']), cols);
  let chk = null; try { await q(`UPDATE proy_plan SET hh_excavacion = -1 WHERE periodo = '2026-09-01'`); } catch (e) { chk = e; }
  ok('CHECK (hh_excavacion >= 0) rechaza un negativo directo en la BD', chk && /check/i.test(String(chk.message || chk)), chk && chk.message);

  /* 2 · proyeccionLeer: columnas agrupadas + filas vacías (semillas de 006 no cargan meta) */
  titulo('2 · proyeccionLeer: columnas de la meta y filas sin cargar (semillas)');
  let leido = await proyeccionLeer(ctx(sql), {}, ses);
  const colsHH = leido.tablas.plan.columnas.filter(c => /^hh_/.test(c.k));
  ok('4 columnas hh_* en COLUMNAS.plan, editables, agrupadas bajo «Meta horas-hombre (personal directo)»',
    colsHH.length === 4 && colsHH.every(c => c.edita === true && c.grupo === 'Meta horas-hombre (personal directo)'), colsHH);
  ok('las 17 filas del plan traen las 4 metas VACÍAS (las semillas de 006 no cargan ninguna)',
    leido.tablas.plan.filas.length === 17 && leido.tablas.plan.filas.every(f => f.hh_excavacion === '' && f.hh_terraplen === '' && f.hh_subbase === '' && f.hh_base === ''),
    leido.tablas.plan.filas.map(f => f.periodo + ':' + f.hh_excavacion));

  /* 3 · proyeccionGuardar: número válido, negativo rechazado, vacío = NULL, conflicto de versión */
  titulo('3 · proyeccionGuardar: la meta se edita como cualquier celda del plan');
  const filaSep = leido.tablas.plan.filas.find(f => f.periodo === '2026-09-01');
  let g = await proyeccionGuardar(ctx(sql), { cambios: [{ tabla: 'plan', op: 'update', periodo: '2026-09', if_version: filaSep.version, hh_excavacion: 1234.5 }] }, ses);
  ok('guarda un número válido en hh_excavacion de sep-2026 (m³ compactos → no aplica; aquí horas-hombre)', g.ok === true && g.guardadas === 1, g);
  let filaSep2 = g.tablas.plan.filas.find(f => f.periodo === '2026-09-01');
  ok('el valor guardado vuelve tal cual y la version subió (secuencia del plan, sin ABA)', filaSep2.hh_excavacion === 1234.5 && filaSep2.version > filaSep.version, filaSep2);
  const versionTrasGuardar = filaSep2.version;

  const gNeg = await proyeccionGuardar(ctx(sql), { cambios: [{ tabla: 'plan', op: 'update', periodo: '2026-09', if_version: versionTrasGuardar, hh_terraplen: -5 }] }, ses);
  ok('un negativo en hh_terraplen se rechaza con texto legible, nada se guarda', gNeg.ok === false && /negativ/.test(String(gNeg.error)), gNeg);
  let leido2 = await proyeccionLeer(ctx(sql), {}, ses);
  let filaSep3 = leido2.tablas.plan.filas.find(f => f.periodo === '2026-09-01');
  ok('…y la version NO subió (el rechazo fue antes de tocar la BD)', filaSep3.version === versionTrasGuardar && filaSep3.hh_terraplen === '', filaSep3);

  const gVacio = await proyeccionGuardar(ctx(sql), { cambios: [{ tabla: 'plan', op: 'update', periodo: '2026-09', if_version: versionTrasGuardar, hh_excavacion: '' }] }, ses);
  ok('un vacío borra la meta (NULL): vuelve a quedar sin cargar', gVacio.ok === true && gVacio.tablas.plan.filas.find(f => f.periodo === '2026-09-01').hh_excavacion === '', gVacio.tablas && gVacio.tablas.plan.filas.find(f => f.periodo === '2026-09-01'));
  const versionSinMeta = gVacio.tablas.plan.filas.find(f => f.periodo === '2026-09-01').version;

  const gConflicto = await proyeccionGuardar(ctx(sql), { cambios: [{ tabla: 'plan', op: 'update', periodo: '2026-09', if_version: versionTrasGuardar /* vieja a propósito */, hh_base: 100 }] }, ses);
  ok('if_version equivocado (una versión vieja) → conflicto de versión, no se guarda', gConflicto.ok === false && gConflicto.error === 'version' && gConflicto.conflictos.length === 1 && gConflicto.conflictos[0].motivo === 'version', gConflicto);

  // Deja hh_base cargado en oct-2026 para el paso 4 (plan_hh de tablero).
  const filaOct = (await proyeccionLeer(ctx(sql), {}, ses)).tablas.plan.filas.find(f => f.periodo === '2026-10-01');
  const gOct = await proyeccionGuardar(ctx(sql), { cambios: [{ tabla: 'plan', op: 'update', periodo: '2026-10', if_version: filaOct.version, hh_base: 777 }] }, ses);
  ok('guarda hh_base de oct-2026 (para el Tablero, paso 4)', gOct.ok === true, gOct);

  /* 4 · proyeccionTableroDatos_: plan_hh aparte de plan (que no cambia de forma) */
  titulo('4 · proyeccionTableroDatos_ expone plan_hh (el Tablero la compara con las horas-hombre reales)');
  const tb = await proyeccionTableroDatos_(ctx(sql));
  ok('tb.ok y tb.plan sigue con NULL→0, 5 claves de siempre (no cambia de forma)', tb.ok === true && tb.plan['2026-09'] && Object.keys(tb.plan['2026-09']).sort().join(',') === 'base,excavacion,noaprov,subbase,terraplen', tb.plan['2026-09']);
  ok('tb.plan_hh existe con las 4 claves (sin prefijo hh_) por periodo', tb.plan_hh && tb.plan_hh['2026-09'] && Object.keys(tb.plan_hh['2026-09']).sort().join(',') === 'base,excavacion,subbase,terraplen', tb.plan_hh && tb.plan_hh['2026-09']);
  ok('sep-2026: la meta que quedó SIN cargar (paso 3) vuelve NULL, no 0', tb.plan_hh['2026-09'].excavacion === null && tb.plan_hh['2026-09'].terraplen === null, tb.plan_hh['2026-09']);
  ok('oct-2026: hh_base = 777 (lo guardado)', tb.plan_hh['2026-10'].base === 777, tb.plan_hh['2026-10']);
  ok('un periodo sin ninguna meta (ago-2025) trae las 4 en null', tb.plan_hh['2025-08'] && Object.values(tb.plan_hh['2025-08']).every(v => v === null), tb.plan_hh['2025-08']);

  /* 5 · degradación: 013 SIN aplicar (solo 001…012) */
  titulo('5 · Degradación: BD con 001…012 (013 aún sin aplicar)');
  const b12 = await bancoNuevo('012_unificar_cargos.sql');
  const leidoSin = await proyeccionLeer(ctx(b12.sql), {}, ses);
  ok('proyeccionLeer sigue ok:true sin la columna (no se tumba)', leidoSin.ok === true && leidoSin.tablas.plan.filas.length === 17, leidoSin.ok);
  ok('las 4 metas quedan vacías en todas las filas (degradado, sin 42703 hacia afuera)',
    leidoSin.tablas.plan.filas.every(f => f.hh_excavacion === '' && f.hh_terraplen === '' && f.hh_subbase === '' && f.hh_base === ''), leidoSin.tablas.plan.filas[0]);
  const tbSin = await proyeccionTableroDatos_(ctx(b12.sql));
  ok('proyeccionTableroDatos_ sigue ok:true; plan_hh con las 4 claves en null en todos los periodos',
    tbSin.ok === true && Object.values(tbSin.plan_hh).every(o => o.excavacion === null && o.terraplen === null && o.subbase === null && o.base === null), tbSin.plan_hh['2026-09']);
  const filaSep12 = leidoSin.tablas.plan.filas.find(f => f.periodo === '2026-09-01');
  // D190/flota.js, mismo criterio: las 4 columnas van SIEMPRE en el INSERT/UPDATE del plan, así que sin 013
  // el plan no se puede escribir en absoluto (toque o no la meta) hasta aplicarla; SÍ se puede seguir leyendo.
  const gSinMeta = await proyeccionGuardar(ctx(b12.sql), { cambios: [{ tabla: 'plan', op: 'update', periodo: '2026-09', if_version: filaSep12.version, excavacion: 99999 }] }, ses);
  ok('guardar el plan (aunque NO toque la meta) → ok:false legible «falta aplicar … 013 …», nunca una excepción',
    gSinMeta.ok === false && /013_meta_horas_hombre\.sql/.test(String(gSinMeta.error)), gSinMeta);
  const gConMeta = await proyeccionGuardar(ctx(b12.sql), { cambios: [{ tabla: 'plan', op: 'update', periodo: '2026-09', if_version: filaSep12.version, hh_excavacion: 500 }] }, ses);
  ok('guardar la meta misma → el mismo mensaje legible', gConMeta.ok === false && /013_meta_horas_hombre\.sql/.test(String(gConMeta.error)), gConMeta);
  const tras = await proyeccionLeer(ctx(b12.sql), {}, ses);
  ok('nada se guardó (excavacion de sep-2026 sigue igual)', tras.tablas.plan.filas.find(f => f.periodo === '2026-09-01').excavacion === filaSep12.excavacion, tras.tablas.plan.filas.find(f => f.periodo === '2026-09-01').excavacion);

  console.log('\n' + casos + ' comprobaciones · ' + fallos + ' fallo(s)');
  process.exit(fallos ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
