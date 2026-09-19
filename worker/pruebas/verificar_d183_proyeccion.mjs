#!/usr/bin/env node
/**
 * verificar_d183_proyeccion.mjs — V3-11 Fase A / D183: la migración 006_proyeccion.sql, sus 4 vistas espejo y la
 * paridad con la API, directo contra Postgres EN MEMORIA (PGlite, como contrato_local.js). Sin red, sin Supabase.
 *
 *   node worker/pruebas/verificar_d183_proyeccion.mjs
 *   node worker/pruebas/verificar_d183_proyeccion.mjs --excel="<COPIA del Excel del jefe>.xlsx"   # además, contra el libro
 *
 * Lo que se comprueba:
 *   1. 001…006 (y las posteriores: 007 · D184) aplican en orden sobre un PGlite nuevo; esquema_version tiene la 6; RLS en las 4 tablas.
 *   2. Encabezados EXACTOS de las 4 vistas (information_schema.columns, en orden) y sus tipos.
 *   3. Valores: las vistas = lo tecleado en el Excel (CALCULOS A3:J19, MAPEO I8:M16, J27:N27 / P1:T1, FC, corte).
 *      Con --excel se leen del LIBRO (solo lectura, D24: nunca se escribe) en vez de la tabla de abajo.
 *   4. API = vistas: proyeccion_tablero (plan, proyectado, contrato, base, corte) y el ACTA / CORTE que deriva
 *      proyeccion.js en JS salen iguales que las columnas "ACTA" y "CORTE BASE" (también por la fórmula de respaldo).
 *      Un CHECK que salta en la BD y una BD sin 006 dan una respuesta legible (ok:false), nunca una excepción (500).
 *   5. Idempotencia: 006 dos veces no cambia NADA (filas y versiones, vistas, comentarios, RLS, ACL, esquema_version).
 *   6. No pisa ni resucita: una fila de plan borrada y un FC editado sobreviven a re-aplicar 006. (Una tabla vaciada
 *      ENTERA se vuelve a sembrar: la regla de las semillas es «si la obra no tiene ninguna fila».)
 *   7. Permisos: sin roles, el bloque DO no hace nada; con anon / authenticated / tm2_lector_maestro (como en Supabase,
 *      con los permisos por defecto dados), re-aplicar 006 revoca todo a anon/authenticated (también la secuencia de
 *      versiones del plan y data_maestro, la vista de 001/005 que no lo hacía) y deja al lector leer las 4 vistas
 *      (corren como su dueño) pero NO las tablas.
 *   8. roles_lectura_maestro.sql (se aplica a mano en Supabase) otorga el SELECT de las 4 vistas.
 * Sale con código 1 si algo falla.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { abrirPglite } from './pglite.js';
import { proyeccionLeer, proyeccionTablero, proyeccionGuardar } from '../src/api/obra/proyeccion.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, '..', '..');
const SQL_DIR = path.join(REPO, 'worker', 'sql');
const args = {}; process.argv.slice(2).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });

let casos = 0, fallos = 0;
function ok(n, c, x){ casos++; if (c) console.log('  ✓ ' + n); else { fallos++; console.log('  ✗ ' + n + (x !== undefined ? '  → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 400) : '')); } }
const titulo = (s) => console.log('\n' + s);
// JSON con las claves ordenadas: jsonb reordena las claves ({excavacion, terraplen} vuelve como {terraplen, excavacion}).
const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v))
  ? Object.keys(v).sort().reduce((a, x) => { a[x] = v[x]; return a; }, {}) : v);

/* ---------- lo tecleado en el Excel del jefe (copia del 18-sep-2026; extraído con xls_dump) ---------- */
// CALCULOS A3:A19 × B EXCAVACION · D TERRAPLEN · F SUBBASE · H BASE · J NO APROV (null = celda vacía)
const PLAN_EXCEL = [
  ['2025-08-01', 38939, 34328, 7758, 0, 2251],      ['2025-09-01', 54617, 33531, 14003, 0, 5784],
  ['2025-10-01', 51137, 32565, 8218, 0, 6182],      ['2025-11-01', 51137, 32565, 8218, null, 6182],
  ['2025-12-01', 31639, 25515, 4758, 4142, 2654],   ['2026-01-01', 31639, 25515, 4758, 4142, 2650],
  ['2026-02-01', 51640, 45516, 4759, 4143, 5700],   ['2026-03-01', 51640, 45516, 4759, 4143, 5700],
  ['2026-04-01', 51641, 45517, 4760, 4144, 5701],   ['2026-05-01', 51642, 45518, 4761, 4145, 5702],
  ['2026-06-01', 60000, 45000, 6600, 7200, 5703],   ['2026-07-01', 60000, 45000, 6600, 7200, 5703],
  ['2026-08-01', 35000, 24500, 6600, 4500, 7000],   ['2026-09-01', 24495.6, 20413, 3913, 5016, 4899.12],
  ['2026-10-01', 38848.8, 32374, 5537, 6485, 7769.76], ['2026-11-01', 48148.8, 40124, 11102, 6111, 9629.76],
  ['2026-12-01', null, null, 740, 6694, null]
];
// Las 12 celdas con fórmula: {periodo: {col: fórmula}}
const FORMULAS_EXCEL = {
  '2025-10-01': { excavacion: '=47724+3413', terraplen: '=24120+5669+1401+1375' },
  '2025-11-01': { excavacion: '=47724+3413', terraplen: '=24120+5669+1401+1375' },
  '2026-08-01': { terraplen: '=+B15*0.7', noaprov: '=+B15*0.2' },
  '2026-09-01': { excavacion: '=+D16*1.2', noaprov: '=+B16*0.2' },
  '2026-10-01': { excavacion: '=+D17*1.2', noaprov: '=+B17*0.2' },
  '2026-11-01': { excavacion: '=+D18*1.2', noaprov: '=+B18*0.2' }
};
// MAPEO I8:M16 → [PARTIDA, Programado UF1, UF2, total, Produccion UF1, UF2, total] (préstamo en UF1, como I16/L16)
const CONTRATO_EXCEL = [
  ['Excavacion comun', 685847.33, 61355.64, 747202.97, 515625.66, 33528.29, 549153.95],
  ['Terraplen', 403447.41, 262018.32, 665465.73, 229229.98, 156625, 385854.98],
  ['Subbase', 53167.2, 31036.67, 84203.87, 32802, 13721.83, 46523.83],
  ['BTC', 58805.7, 33767.79, 92573.49, 29700, 8403.26, 38103.26],
  ['Excavacion Prestamos', 168462, null, 168462, 51895, null, 51895]
];
const REND_EXCEL = { EXCAVACION: 850, TERRAPLEN: 450, SUBBASE: 350, BASE: 470 };      // MAPEO J27/K27/L27/N27
const SUELTO_EXCEL = { EXCAVACION: 1105, TERRAPLEN: 585, SUBBASE: 455, BASE: 611 };   // CALCULOS P1/Q1/R1/T1
const FC_EXCEL = 1.3;                                                                  // CALCULOS P4 = MAPEO!B23

/* ---------- --excel: lo mismo, leído del LIBRO (tablero-xlsx.js, el lector del tablero; solo lectura) ---------- */
function leerExcel(ruta){
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(REPO, 'tablero-xlsx.js'), 'utf8'), ctx);
  const wb = ctx.XLSX.read(fs.readFileSync(ruta), { type: 'buffer', cellFormula: true, cellDates: true });
  const cal = wb.Sheets['CALCULOS'], map = wb.Sheets['MAPEO'];
  if (!cal || !map) throw new Error('el libro no trae CALCULOS y MAPEO');
  const val = (h, a) => (h[a] && h[a].v !== undefined && h[a].v !== '') ? h[a].v : null;
  const r6 = (n) => n == null ? null : Math.round(Number(n) * 1e6) / 1e6;
  const plan = [], formulas = {};
  const COL = { excavacion: 'B', terraplen: 'D', subbase: 'F', base: 'H', noaprov: 'J' };
  for (let R = 3; R <= 19; R++){
    const d = val(cal, 'A' + R); if (!d || typeof d.getUTCFullYear !== 'function') continue;   // Date de otro realm (vm)
    const per = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-01';
    plan.push([per].concat(Object.values(COL).map(c => r6(val(cal, c + R)))));
    Object.keys(COL).forEach(k => { const c = cal[COL[k] + R]; if (c && c.f) (formulas[per] = formulas[per] || {})[k] = '=' + c.f; });
  }
  const P = [['Excavacion comun', 8], ['Terraplen', 10], ['Subbase', 12], ['BTC', 14]];
  const contrato = P.map(([n, R]) => { const a = val(map, 'I' + R), b = val(map, 'J' + R), l = val(map, 'L' + R), m = val(map, 'M' + R);
    return [n, a, b, r6(a + b), l, m, r6(l + m)]; });
  contrato.push(['Excavacion Prestamos', val(map, 'I16'), null, val(map, 'I16'), val(map, 'L16'), null, val(map, 'L16')]);
  const rend = { EXCAVACION: val(map, 'J27'), TERRAPLEN: val(map, 'K27'), SUBBASE: val(map, 'L27'), BASE: val(map, 'N27') };
  const suelto = { EXCAVACION: val(cal, 'P1'), TERRAPLEN: val(cal, 'Q1'), SUBBASE: val(cal, 'R1'), BASE: val(cal, 'T1') };
  return { plan, formulas, contrato, rend, suelto, fc: val(cal, 'P4') };
}

async function main(){
  const esperado = { plan: PLAN_EXCEL, formulas: FORMULAS_EXCEL, contrato: CONTRATO_EXCEL, rend: REND_EXCEL, suelto: SUELTO_EXCEL, fc: FC_EXCEL };
  if (args.excel){
    const x = leerExcel(path.resolve(String(args.excel)));
    titulo('0 · El libro (' + path.basename(String(args.excel)) + ') contra la tabla de este script');
    ok('plan CALCULOS A3:J19 = PLAN_EXCEL', JSON.stringify(x.plan) === JSON.stringify(PLAN_EXCEL), x.plan);
    ok('las 12 fórmulas = FORMULAS_EXCEL', canon(x.formulas) === canon(FORMULAS_EXCEL), x.formulas);
    ok('contrato MAPEO I8:M16 = CONTRATO_EXCEL', JSON.stringify(x.contrato) === JSON.stringify(CONTRATO_EXCEL), x.contrato);
    ok('rendimiento J27:N27, suelto P1:T1 y FC P4', JSON.stringify([x.rend, x.suelto, x.fc]) === JSON.stringify([REND_EXCEL, SUELTO_EXCEL, FC_EXCEL]), [x.rend, x.suelto, x.fc]);
    Object.assign(esperado, x);   // lo que sigue compara contra el LIBRO
  }

  const { sql } = await abrirPglite();
  const q = (t, p) => sql.unsafe(t, p);
  const aplicar = (f) => sql.exec(fs.readFileSync(path.join(SQL_DIR, f), 'utf8'));

  /* 1 · cadena de migraciones */
  titulo('1 · 001…006 sobre un PGlite nuevo');
  const migraciones = fs.readdirSync(SQL_DIR).filter(f => /^0\d+_.*\.sql$/.test(f)).sort();
  for (const f of migraciones) await aplicar(f);
  // D184: 007_data_completa.sql va después de 006; lo que mira este caso es que 006 está en la cadena y que la 6 quedó UNA vez.
  ok('se aplicaron ' + migraciones.join(', '), migraciones.indexOf('006_proyeccion.sql') >= 0 && migraciones.slice(migraciones.indexOf('006_proyeccion.sql') + 1).every(f => f > '006'), migraciones);
  const ver = await q(`SELECT max(version)::int AS v, count(*) FILTER (WHERE version = 6)::int AS n6 FROM esquema_version`);
  ok('esquema_version tiene la 6 (una fila) y llega al menos a 6', ver[0].v >= 6 && ver[0].n6 === 1, ver[0]);
  const TABLAS = ['proy_plan', 'proy_contrato', 'proy_rendimiento', 'proy_parametros'];
  const VISTAS = ['proyeccion_plan_maestro', 'proyeccion_contrato_maestro', 'proyeccion_rendimiento_maestro', 'proyeccion_parametros_maestro'];
  const rls = await q(`SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY($1::text[]) ORDER BY relname`, ['{' + TABLAS.join(',') + '}']);
  ok('RLS activada en las 4 tablas', rls.length === 4 && rls.every(r => r.relrowsecurity === true), rls);
  const roles = await q(`SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','tm2_lector_maestro')`);
  ok('en el banco no existe ningún rol de Supabase ni el lector: el bloque DO no hizo nada y 006 aplicó igual', roles.length === 0, roles);
  const seq = await q(`SELECT data_type, start_value::int AS s FROM information_schema.sequences WHERE sequence_name = 'proy_plan_version_seq'`);
  ok('secuencia proy_plan_version_seq (integer, arranca en 1): las versiones del plan nunca se repiten (sin ABA)', seq.length === 1 && seq[0].data_type === 'integer' && seq[0].s === 1, seq);

  /* 2 · encabezados exactos */
  titulo('2 · Encabezados EXACTOS de las vistas (information_schema.columns, en orden)');
  const COLS = {
    proyeccion_plan_maestro: [['obra_id', 'text'], ['periodo', 'date'], ['EXCAVACION', 'numeric'], ['TERRAPLEN', 'numeric'], ['SUBBASE', 'numeric'], ['BASE', 'numeric'], ['NO APROV', 'numeric'], ['ACTA', 'text']],
    proyeccion_contrato_maestro: [['obra_id', 'text'], ['PARTIDA', 'text'], ['Programado UF1', 'numeric'], ['Programado UF2', 'numeric'], ['Programado', 'numeric'], ['Produccion UF1', 'numeric'], ['Produccion UF2', 'numeric'], ['Produccion', 'numeric']],
    proyeccion_rendimiento_maestro: [['obra_id', 'text'], ['concepto', 'text'], ['EXCAVACION', 'numeric'], ['TERRAPLEN', 'numeric'], ['SUBBASE', 'numeric'], ['BASE', 'numeric']],
    proyeccion_parametros_maestro: [['obra_id', 'text'], ['FC', 'numeric'], ['ACTA BASE', 'text'], ['CORTE BASE', 'date']]
  };
  for (const v of VISTAS){
    const c = (await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`, [v])).map(r => [r.column_name, r.data_type]);
    ok(v + ': ' + COLS[v].map(x => x[0]).join(' · '), JSON.stringify(c) === JSON.stringify(COLS[v]), c);
  }

  /* 3 · valores = Excel */
  titulo('3 · Valores de las vistas = lo tecleado en el Excel');
  const plan = await q(`SELECT to_char(periodo,'YYYY-MM-DD') AS p, "EXCAVACION" e, "TERRAPLEN" t, "SUBBASE" s, "BASE" b, "NO APROV" n, "ACTA" a FROM proyeccion_plan_maestro ORDER BY periodo`);
  ok('plan: 17 periodos con los 5 valores de CALCULOS (NULL = celda vacía, 0 = 0)', JSON.stringify(plan.map(r => [r.p, r.e, r.t, r.s, r.b, r.n])) === JSON.stringify(esperado.plan), plan);
  ok('plan: ACTA 10 … 26 (acta que cierra en ese mes)', JSON.stringify(plan.map(r => r.a)) === JSON.stringify(Array.from({ length: 17 }, (x, i) => String(10 + i))), plan.map(r => r.a));
  const fo = await q(`SELECT to_char(periodo,'YYYY-MM-DD') AS p, formulas::text AS f FROM proy_plan WHERE formulas <> '{}'::jsonb ORDER BY periodo`);
  const foObj = {}; fo.forEach(r => { foObj[r.p] = JSON.parse(r.f); });
  ok('las 12 fórmulas del Excel quedan en proy_plan.formulas (6 filas)', canon(foObj) === canon(esperado.formulas) && fo.reduce((n, r) => n + Object.keys(JSON.parse(r.f)).length, 0) === 12, foObj);
  const con = await q(`SELECT "PARTIDA" p, "Programado UF1" a, "Programado UF2" b, "Programado" c, "Produccion UF1" d, "Produccion UF2" e, "Produccion" f FROM proyeccion_contrato_maestro`);
  ok('contrato: etiquetas de MAPEO I7…I15 y cifras I8:M16 (préstamo en UF1), totales al céntimo', JSON.stringify(con.map(r => [r.p, r.a, r.b, r.c, r.d, r.e, r.f])) === JSON.stringify(esperado.contrato), con);
  const ren = await q(`SELECT concepto, "EXCAVACION", "TERRAPLEN", "SUBBASE", "BASE" FROM proyeccion_rendimiento_maestro`);
  const fila = (c) => { const r = ren.filter(x => x.concepto === c)[0]; return r ? { EXCAVACION: r.EXCAVACION, TERRAPLEN: r.TERRAPLEN, SUBBASE: r.SUBBASE, BASE: r.BASE } : null; };
  ok('rendimiento: filas en orden (proyectado suelto equipo · rend. compacto por equipo · fc)', JSON.stringify(ren.map(r => r.concepto)) === JSON.stringify(['proyectado suelto equipo', 'rend. compacto por equipo', 'fc']), ren.map(r => r.concepto));
  ok('proyectado suelto equipo = rend × fc = CALCULOS P1:T1 (1105 / 585 / 455 / 611)', JSON.stringify(fila('proyectado suelto equipo')) === JSON.stringify(esperado.suelto), fila('proyectado suelto equipo'));
  ok('rend. compacto por equipo = MAPEO J27:N27 (850 / 450 / 350 / 470)', JSON.stringify(fila('rend. compacto por equipo')) === JSON.stringify(esperado.rend), fila('rend. compacto por equipo'));
  const par = await q(`SELECT "FC" fc, "ACTA BASE" a, "CORTE BASE" c FROM proyeccion_parametros_maestro`);
  ok('parámetros: FC 1.3 · ACTA BASE 22 · CORTE BASE 2026-08-16 (= BASE_CORTE del tablero)', par.length === 1 && par[0].fc === esperado.fc && par[0].a === '22' && par[0].c === '2026-08-16', par);

  /* 4 · API = vistas */
  titulo('4 · La API (proyeccion.js) deriva lo mismo que las vistas');
  const ctx = () => ({ sql, memo: {}, pet: { t0: Date.now(), log: null } });
  const ses = { ok: true, usuario: 'jefe', rol: 'jefe' };
  let tb = await proyeccionTablero(ctx(), {}, ses);
  const planVista = {}; plan.forEach(r => { planVista[r.p.slice(0, 7)] = { excavacion: r.e || 0, terraplen: r.t || 0, subbase: r.s || 0, base: r.b || 0, noaprov: r.n || 0 }; });
  ok('proyeccion_tablero.plan = vista con NULL → 0 (5 claves siempre, sin 1899-12)', tb.ok === true && JSON.stringify(tb.plan) === JSON.stringify(planVista), tb.plan);
  const prV = fila('proyectado suelto equipo');
  ok('proyeccion_tablero.proyectado = "proyectado suelto equipo" de la vista', JSON.stringify(tb.proyectado) === JSON.stringify({ excavacion: prV.EXCAVACION, terraplen: prV.TERRAPLEN, subbase: prV.SUBBASE, base: prV.BASE }), tb.proyectado);
  const K = ['excavacion', 'terraplen', 'subbase', 'base', 'prestamo'];
  ok('proyeccion_tablero.contrato / base_acum = "Programado" / "Produccion" de la vista', K.every((k, i) => tb.contrato[k] === con[i].c && tb.base_acum[k] === con[i].f), [tb.contrato, tb.base_acum]);
  ok('proyeccion_tablero.fc / base_corte = FC / CORTE BASE de la vista', tb.fc === par[0].fc && tb.base_corte === par[0].c && tb.fuente === 'galca' && tb.actualizado === '' && tb.usuario === '', tb);
  // periodos fuera de la tabla `periodos`: 2027-01 (acta 27 por la fórmula) y 2020-01 (antes del acta 1: sin acta)
  await q(`INSERT INTO proy_plan (obra_id, periodo, excavacion) VALUES ('tm2sur','2027-01-01',1), ('tm2sur','2020-01-01',2)`);
  const leido = await proyeccionLeer(ctx(), {}, ses);
  const actaV = {}; (await q(`SELECT to_char(periodo,'YYYY-MM-DD') p, "ACTA" a FROM proyeccion_plan_maestro`)).forEach(r => { actaV[r.p] = r.a == null ? '' : r.a; });
  const filasApi = leido.tablas.plan.filas;
  ok('ACTA de cada periodo: API = vista (19 filas, con 2027-01 → 27 y 2020-01 → sin acta)', filasApi.length === 19 && filasApi.every(f => f.acta === actaV[f.periodo]) && actaV['2027-01-01'] === '27' && actaV['2020-01-01'] === '', filasApi.map(f => f.periodo + ':' + f.acta + '/' + actaV[f.periodo]));
  await q(`DELETE FROM proy_plan WHERE periodo IN ('2027-01-01','2020-01-01')`);
  const cortes = [];
  for (const a of ['10', '21', '26', '27', '40', '1']){
    await q(`UPDATE proy_parametros SET acta_base = $1`, [a]);
    const t = await proyeccionTablero(ctx(), {}, ses);
    const v = (await q(`SELECT "CORTE BASE" c FROM proyeccion_parametros_maestro`))[0].c;
    cortes.push(a + '→' + t.base_corte + (t.base_corte === v ? '' : ' (vista ' + v + ')'));
  }
  await q(`UPDATE proy_parametros SET acta_base = '22'`);
  ok('CORTE BASE: API = vista por periodos (10, 21, 26) y por la fórmula de respaldo (27, 40, 1)', cortes.join(' ') === '10→2025-08-16 21→2026-07-16 26→2026-12-16 27→2027-01-16 40→2028-02-16 1→2024-11-16', cortes.join(' '));
  const sinPar = await sql.begin(async (tx) => { await tx`DELETE FROM proy_parametros`; const r = await proyeccionTablero({ sql: tx, memo: {}, pet: { t0: Date.now(), log: null } }, {}, ses); throw { deshacer: true, r }; }).catch(e => e && e.deshacer ? e.r : e);
  ok('sin parámetros → proyeccion_tablero ok:false con texto (el Tablero cae al Excel)', sinPar.ok === false && /parámetros/.test(String(sinPar.error)), sinPar);
  tb = await proyeccionTablero(ctx(), {}, ses);
  ok('(se deshizo: vuelve a haber parámetros)', tb.ok === true && tb.base_corte === '2026-08-16', tb.base_corte);
  // Si la BD rechaza un dato que la prevalidación dejó pasar (aquí, un CHECK de más puesto a propósito): texto legible, no excepción (no 500).
  await q(`ALTER TABLE proy_parametros ADD CONSTRAINT verif_d183_tmp CHECK (fc <> 1.25)`);
  let g500 = null; try { g500 = await proyeccionGuardar(ctx(), { cambios: [{ tabla: 'parametros', op: 'update', if_version: 0, fc: 1.25 }] }, ses); } catch (e) { g500 = { excepcion: String(e.message) }; }
  await q(`ALTER TABLE proy_parametros DROP CONSTRAINT verif_d183_tmp`);
  const p0 = await q(`SELECT fc, version FROM proy_parametros`);
  ok('un CHECK que salta en la BD → {ok:false, error:«La base de datos rechazó…»} sin excepción, y no se guardó', !!g500 && g500.ok === false && /rechaz/.test(String(g500.error)) && p0[0].fc === 1.3 && p0[0].version === 0, g500);

  /* 5 · idempotencia */
  titulo('5 · 006 aplicada dos veces no cambia nada');
  async function foto(){
    const o = {};
    for (const t of TABLAS) o[t] = (await q(`SELECT to_jsonb(x)::text AS j FROM ${t} x ORDER BY 1`)).map(r => r.j);
    for (const v of VISTAS) o[v] = (await q(`SELECT pg_get_viewdef($1::regclass, true) AS d`, [v]))[0].d;
    o.clases = await q(`SELECT relname, relrowsecurity, relacl::text AS acl, obj_description(oid, 'pg_class') AS comentario FROM pg_class
                        WHERE relname = ANY($1::text[]) ORDER BY relname`, ['{' + TABLAS.concat(VISTAS).join(',') + '}']);
    o.columnas = await q(`SELECT c.relname, a.attname, col_description(c.oid, a.attnum) AS d FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
                          WHERE c.relname = ANY($1::text[]) AND a.attnum > 0 AND NOT a.attisdropped ORDER BY 1, a.attnum`, ['{' + TABLAS.join(',') + '}']);
    o.ver = await q(`SELECT version, aplicado_ts::text AS ts, nota FROM esquema_version ORDER BY version`);
    return JSON.stringify(o);
  }
  const a0 = await foto();
  await aplicar('006_proyeccion.sql');
  const a1 = await foto();
  ok('segunda pasada: filas, versiones, vistas, comentarios, RLS, ACL y esquema_version idénticos', a0 === a1, a0 === a1 ? '' : 'difieren');
  await q(`UPDATE proy_plan SET excavacion = excavacion WHERE periodo = '2026-09-01'`);
  await q(`UPDATE proy_plan SET version = version + 1 WHERE periodo = '2026-09-01'`);
  ok('(la foto no es ciega: una version+1 la cambia)', (await foto()) !== a1);
  await q(`UPDATE proy_plan SET version = version - 1 WHERE periodo = '2026-09-01'`);

  /* 6 · no pisa ni resucita */
  titulo('6 · Re-aplicar 006 no pisa lo editado ni resucita lo borrado');
  await q(`DELETE FROM proy_plan WHERE periodo = '2026-12-01'`);
  await q(`UPDATE proy_parametros SET fc = 1.25, version = version + 1, editado_por = 'jefe', editado_ts = now()`);
  await q(`UPDATE proy_contrato SET programado = 1 WHERE partida = 'base' AND uf = 'UF2'`);
  await aplicar('006_proyeccion.sql');
  const n = await q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE periodo = '2026-12-01')::int AS dic FROM proy_plan`);
  ok('la fila de plan borrada (2026-12) NO resucita (16 filas)', n[0].n === 16 && n[0].dic === 0, n[0]);
  const p2 = await q(`SELECT fc, version, editado_por FROM proy_parametros`);
  ok('el FC editado (1.25, version 1, jefe) NO se pisa', p2.length === 1 && p2[0].fc === 1.25 && p2[0].version === 1 && p2[0].editado_por === 'jefe', p2);
  const c2 = await q(`SELECT programado FROM proy_contrato WHERE partida = 'base' AND uf = 'UF2'`);
  ok('el programado editado (1) NO se pisa', c2[0].programado === 1, c2);
  await q(`DELETE FROM proy_rendimiento`);
  await aplicar('006_proyeccion.sql');
  const r2 = await q(`SELECT count(*)::int AS n FROM proy_rendimiento`);
  ok('(por diseño) una tabla vaciada ENTERA se vuelve a sembrar: «si la obra no tiene ninguna fila»', r2[0].n === 4, r2[0]);

  /* 7 · permisos */
  titulo('7 · Permisos con los roles de Supabase y el lector del maestro');
  await sql.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE tm2_lector_maestro NOLOGIN;
    GRANT ALL ON ${TABLAS.concat(VISTAS).join(', ')}, data_maestro TO anon, authenticated;
    GRANT ALL ON SEQUENCE proy_plan_version_seq TO anon, authenticated;`);   // lo que dan los permisos por defecto de Supabase
  const priv = async (rol, obj) => (await q(`SELECT has_table_privilege($1, $2, 'SELECT') AS s, has_table_privilege($1, $2, 'INSERT') AS i`, [rol, obj]))[0];
  const usoSeq = async (rol) => (await q(`SELECT has_sequence_privilege($1, 'proy_plan_version_seq', 'USAGE') AS u`, [rol]))[0].u;
  ok('antes de re-aplicar: anon SÍ lee proy_plan y data_maestro (simulación de los permisos por defecto)', (await priv('anon', 'proy_plan')).s === true && (await priv('anon', 'data_maestro')).s === true);
  await aplicar('006_proyeccion.sql');
  const todos = TABLAS.concat(VISTAS);
  let malos = [];
  for (const r of ['anon', 'authenticated']) for (const o of todos){ const p = await priv(r, o); if (p.s || p.i) malos.push(r + ':' + o); }
  ok('anon y authenticated: sin SELECT ni INSERT en las 4 tablas y las 4 vistas', malos.length === 0, malos);
  malos = [];
  for (const r of ['anon', 'authenticated']){ const p = await priv(r, 'data_maestro'); if (p.s || p.i) malos.push(r + ':data_maestro'); if (await usoSeq(r)) malos.push(r + ':proy_plan_version_seq'); }
  ok('anon y authenticated: tampoco data_maestro (001/005 no lo quitaban) ni la secuencia de versiones del plan', malos.length === 0, malos);
  malos = [];
  for (const o of VISTAS) if (!(await priv('tm2_lector_maestro', o)).s) malos.push('falta ' + o);
  for (const o of TABLAS) if ((await priv('tm2_lector_maestro', o)).s) malos.push('lee ' + o);
  ok('tm2_lector_maestro: SELECT en las 4 vistas y en NINGUNA tabla', malos.length === 0, malos);
  const comoLector = await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE tm2_lector_maestro`;
    const v = await tx.unsafe(`SELECT count(*)::int AS n FROM proyeccion_plan_maestro`);
    let tabla = 'leyó';
    try { await tx.unsafe(`SAVEPOINT s1`); await tx.unsafe(`SELECT count(*) FROM proy_plan`); } catch (e) { tabla = String(e.message); await tx.unsafe(`ROLLBACK TO SAVEPOINT s1`); }
    return { v: v[0].n, tabla };
  });
  ok('como tm2_lector_maestro: lee la vista (corre como su dueño: ' + comoLector.v + ' filas) y la TABLA le da «permission denied»', comoLector.v === 16 && /permission denied/i.test(comoLector.tabla), comoLector);
  const comoAnon = await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE anon`;
    try { await tx.unsafe(`SAVEPOINT s1`); await tx.unsafe(`SELECT count(*) FROM proyeccion_plan_maestro`); return 'leyó'; }
    catch (e) { await tx.unsafe(`ROLLBACK TO SAVEPOINT s1`); return String(e.message); }
  });
  ok('como anon: la VISTA también le da «permission denied» (no salta el RLS por la vista)', /permission denied/i.test(comoAnon), comoAnon);
  const a2 = await foto();
  await aplicar('006_proyeccion.sql');
  ok('con los roles presentes, una pasada más tampoco cambia nada (ACL incluidas)', a2 === await foto());

  /* 8 · roles_lectura_maestro.sql */
  titulo('8 · roles_lectura_maestro.sql (a mano en Supabase)');
  const roles_sql = fs.readFileSync(path.join(SQL_DIR, 'roles_lectura_maestro.sql'), 'utf8');
  const faltan = VISTAS.filter(v => !new RegExp('GRANT\\s+SELECT\\s+ON\\s+public\\.' + v + '\\s+TO\\s+tm2_lector_maestro', 'i').test(roles_sql));
  ok('otorga SELECT de las 4 vistas de la Proyección al lector', faltan.length === 0, faltan);
  ok('y sigue sin darle las tablas proy_*', !/GRANT[^;]*\bproy_(plan|contrato|rendimiento|parametros)\b/i.test(roles_sql));
  // Se corre de verdad (el rol ya existe: su DO no lo recrea) tras quitarle las 4 vistas: las vuelve a dar.
  await sql.exec(`REVOKE SELECT ON ${VISTAS.join(', ')} FROM tm2_lector_maestro;`);
  let errRoles = '';
  try { await sql.exec(roles_sql); } catch (e) { errRoles = String(e.message); }
  malos = [];
  for (const o of VISTAS) if (!(await priv('tm2_lector_maestro', o)).s) malos.push('falta ' + o);
  for (const o of TABLAS) if ((await priv('tm2_lector_maestro', o)).s) malos.push('lee ' + o);
  ok('aplicado sobre el banco: devuelve el SELECT de las 4 vistas y ninguna tabla', !errRoles && malos.length === 0, errRoles || malos);
  // Y antes de 006 (vistas inexistentes) no falla: el bloque DO se salta los GRANT de la Proyección.
  const { sql: sql2 } = await abrirPglite();
  for (const f of migraciones.filter(f => f < '006')) await sql2.exec(fs.readFileSync(path.join(SQL_DIR, f), 'utf8'));
  let errAntes = '';
  try { await sql2.exec(roles_sql); } catch (e) { errAntes = String(e.message); }
  ok('aplicado ANTES de 006 (sin las vistas): no falla', !errAntes, errAntes);
  // Y el Worker sobre una BD SIN 006: lectura y guardado responden legibles (el Tablero cae al Excel con ese motivo).
  const ctxSin006 = () => ({ sql: sql2, memo: {}, pet: { t0: Date.now(), log: null } });
  const sinT = await proyeccionTablero(ctxSin006(), {}, ses), sinL = await proyeccionLeer(ctxSin006(), {}, ses);
  let sinG; try { sinG = await proyeccionGuardar(ctxSin006(), { cambios: [{ tabla: 'plan', op: 'alta', periodo: '2020-01', excavacion: 1 }] }, ses); } catch (e) { sinG = { excepcion: String(e.message) }; }
  ok('BD sin 006: proyeccion_tablero / proyeccion / proyeccion_guardar → ok:false «falta aplicar …006_proyeccion.sql» (no 500)', [sinT, sinL, sinG].every(r => r && r.ok === false && /006_proyeccion.sql/.test(String(r.error))), [sinT, sinL, sinG]);

  console.log('\n' + casos + ' comprobaciones · ' + fallos + ' fallo(s)');
  process.exit(fallos ? 1 : 0);
}
main().catch(err => { console.error('La verificación no pudo correr: ' + (err && err.stack || err)); process.exit(2); });
