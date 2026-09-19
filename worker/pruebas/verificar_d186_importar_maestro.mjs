#!/usr/bin/env node
/**
 * verificar_d186_importar_maestro.mjs — D186: la CARGA ÚNICA de la hoja DATA del Excel maestro a `data`
 * (worker/sql/importar_maestro.js → importarMaestro) contra Postgres EN MEMORIA (PGlite, como contrato_local.js).
 * Sin red y sin tocar producción. El Excel solo se LEE (una COPIA del libro del jefe).
 *
 *   node worker/pruebas/verificar_d186_importar_maestro.mjs --excel="<COPIA del libro>.xlsx" [--hasta=2026-09-17] [--respaldos=<carpeta>]
 *
 * Qué se comprueba:
 *   1. 001…008 sobre un PGlite nuevo (esquema_version 8).
 *   2. Semillas «de la app» (desde el 17-jun, como producción): filas que el Excel también tiene (otro id), filas
 *      que no tiene, un sello '[Clima: X]', y filas POSTERIORES al corte.
 *   3. --simular (con conexión) no cambia NADA (foto de la tabla idéntica) ni escribe respaldo.
 *   4. Carga real: filas por mes y Σ LARGO = un cálculo INDEPENDIENTE de la hoja DATA (sheet_to_json, otra
 *      conversión de fechas); el 14-jul queda con las filas del Excel; las de la app ≤ corte ya no están.
 *   5. Las filas de la app posteriores al corte, intactas (fila completa idéntica).
 *   6. El respaldo CSV (BOM, ';') existe y trae exactamente las filas borradas.
 *   7. Tras 005/007 (re-aplicadas por la herramienta): ningún sello [Clima:] en observación; ACTA/ESPESOR/FC/
 *      CANTIDAD llenos donde hay LARGO; los «ajuste origen» con FC 1.
 *   8. Relanzar: mismos ids, sin duplicados, mismos totales; el 2º respaldo trae las filas de la 1ª carga.
 *   9. Una BD sin 008 (esquema_version 7): aborta con el mensaje de OPERACIONES §12 y no toca nada.
 * Sale con código 1 si algo falla.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { abrirPglite } from './pglite.js';
import { importarMaestro } from '../sql/importar_maestro.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, '..', '..');
const SQL_DIR = path.join(REPO, 'worker', 'sql');
const args = {}; process.argv.slice(2).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });
if (!args.excel) { console.error('Falta --excel="<COPIA del libro maestro>.xlsx"'); process.exit(2); }
const EXCEL = path.resolve(String(args.excel));
const HASTA = String(args.hasta || '2026-09-17');
const RESP = path.resolve(String(args.respaldos || path.join(os.tmpdir(), 'verificar_d186_' + Date.now())));

let casos = 0, fallos = 0;
function ok(n, c, x){ casos++; if (c) console.log('  ✓ ' + n); else { fallos++; console.log('  ✗ ' + n + (x !== undefined ? '  → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 600) : '')); } }
const titulo = (s) => console.log('\n' + s);
const silencio = () => {};
const casi = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

/* Cálculo INDEPENDIENTE del Excel: sheet_to_json (no las celdas), fecha por aritmética del serial (no SSF). */
function excelIndependiente(){
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(REPO, 'tablero-xlsx.js'), 'utf8'), ctx);
  const wb = ctx.XLSX.read(fs.readFileSync(EXCEL), { type: 'buffer', sheets: ['DATA'] });
  const R = ctx.XLSX.utils.sheet_to_json(wb.Sheets['DATA'], { header: 1, raw: true, defval: null });
  const porMes = {}, porDia = {};
  let posteriores = 0;
  for (const r of R.slice(1)) {
    if (typeof r[0] !== 'number') continue;
    const f = new Date(Date.UTC(1899, 11, 30) + Math.floor(r[0]) * 86400000).toISOString().slice(0, 10);
    if (f > HASTA) { posteriores++; continue; }
    const m = f.slice(0, 7), o = porMes[m] || (porMes[m] = { filas: 0, largo: 0 });
    o.filas++; o.largo += typeof r[14] === 'number' ? r[14] : 0;
    porDia[f] = (porDia[f] || 0) + 1;
  }
  return { porMes, porDia, posteriores };
}

const COLS_SEM = ['id_registro','fecha','grupo','centro_de_costo','capitulo','descripcion','unidad_funcional','elemento','abs_inicial','abs_final','acta','unidad_medida','largo','espesor','fc','cantidad','observacion','capataz','rol','actividad','area','clima'];
// ≤ corte: la app desde el 17-jun (una igual a una del Excel 14-jul, otras que el Excel no tiene, una con sello)
const SEM_ANTES = [
  ['app-0714-igual', '2026-07-14', 'TIERRAS', '3701.02.05', 'EXPLANACIONES', 'Excavaciones en material común APROVECHABLE', 'UF1', 'tm2 pk 14+635 - 15+460', '14635', '15460', '22', 'm3', 100, 1, 1.3, 76.923077, '', 'capa.uno', 'capataz', 'Excavaciones en material común APROVECHABLE', 'tierras', 'SOLEADO'],
  ['app-0714-solo',  '2026-07-14', 'TIERRAS', '3701.02.07', 'EXPLANACIONES', 'Terraplenes (solo conformación)', 'UF1', 'tm2 pk 12+822 - 14+225', '12822', '14225', '', 'm3', 55, null, null, null, '[Clima: LLUVIA] · la app', 'capa.uno', 'capataz', 'Terraplenes (solo conformación)', 'tierras', ''],
  ['app-0617-solo',  '2026-06-17', 'TIERRAS', '3702.03.01', 'BASES', 'Subbase Granular', 'UF2', 'tm2 pk 38+064 - 38+864', '38064', '38864', '21', 'm3', 12, 1, 1.3, 9.230769, 'primer envío de la app', 'capa.dos', 'capataz', 'Subbase Granular', 'tierras', 'NUBLADO'],
  ['app-0917-solo',  HASTA,        'TIERRAS', '3701.02.05', 'EXPLANACIONES', 'Excavaciones en material común NO APROVECHABLE', 'UF1', 'tm2 pk 12+822 - 14+225', '12822', '14225', '24', 'm3', 7, 1, 1.3, 5.384615, '', 'capa.dos', 'capataz', 'Excavaciones en material común NO APROVECHABLE', 'tierras', '']
];
// > corte: lo que siguen mandando los capataces (completas: 005/007 no tienen nada que hacerles)
const SEM_DESPUES = [
  ['app-0918-a', '2026-09-18', 'TIERRAS', '3701.02.05', 'EXPLANACIONES', 'Excavaciones en material común APROVECHABLE', 'UF1', 'tm2 pk 14+635 - 15+460', '14635', '15460', '24', 'm3', 321, 1, 1.3, 246.923077, 'después del corte', 'capa.uno', 'capataz', 'Excavaciones en material común APROVECHABLE', 'tierras', 'SOLEADO'],
  ['app-0918-b', '2026-09-18', 'DRENAJES Y ESTRUCTURAS', '3701.06.09', 'DRENAJE TRANSVERSAL', 'Concreto clase  28 MPA (encoles, descoles, box, sumideros)', 'UF1', 'ODT1-080', '28753', '28753', '24', 'm3', 3, 1, 1, 3, '', 'capa.dos', 'capataz', 'Concreto clase  28 MPA (encoles, descoles, box, sumideros)', 'odt', 'SOLEADO']
];
async function sembrar(sql, filas){
  for (const f of filas) {
    await sql.unsafe('INSERT INTO data (obra_id, ' + COLS_SEM.map(c => '"' + c + '"').join(', ') + ', "timestamp") VALUES (\'tm2sur\', ' + COLS_SEM.map((_, i) => '$' + (i + 1)).join(', ') + ', now())', f);
  }
}
const foto = async (sql, donde) => JSON.stringify(await sql.unsafe('SELECT * FROM data WHERE obra_id = \'tm2sur\'' + (donde || '') + ' ORDER BY fecha, id_registro'));
async function porMesBD(sql){
  const r = await sql.unsafe(`SELECT to_char(fecha, 'YYYY-MM') AS mes, count(*)::int AS filas, coalesce(sum(largo), 0)::float8 AS largo FROM data WHERE obra_id = 'tm2sur' AND fecha <= $1::date GROUP BY 1 ORDER BY 1`, [HASTA]);
  const m = {}; r.forEach(x => { m[x.mes] = { filas: x.filas, largo: Number(x.largo) }; }); return m;
}
function cuadraMeses(bd, ind){
  const meses = Array.from(new Set(Object.keys(bd).concat(Object.keys(ind)))).sort();
  return meses.filter(m => !(bd[m] && ind[m] && bd[m].filas === ind[m].filas && casi(bd[m].largo, ind[m].largo))).map(m => ({ m, bd: bd[m], excel: ind[m] }));
}
function registrosCsv(texto){   // parser ';' con comillas, solo para la prueba
  const s = texto.replace(/^﻿/, ''), out = []; let fila = [], campo = '', enc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (enc) { if (ch === '"') { if (s[i + 1] === '"') { campo += '"'; i++; } else enc = false; } else campo += ch; continue; }
    if (ch === '"') enc = true; else if (ch === ';') { fila.push(campo); campo = ''; } else if (ch === '\n') { fila.push(campo); out.push(fila); fila = []; campo = ''; } else if (ch !== '\r') campo += ch;
  }
  if (campo || fila.length) { fila.push(campo); out.push(fila); }
  return out;
}

async function main(){
  fs.mkdirSync(RESP, { recursive: true });
  console.log('Excel: ' + EXCEL + ' · corte ' + HASTA + ' · respaldos en ' + RESP);
  const IND = excelIndependiente();
  const nExcel = Object.values(IND.porMes).reduce((a, o) => a + o.filas, 0);

  titulo('1 · 001…008 sobre un PGlite nuevo');
  const { sql } = await abrirPglite();
  const migraciones = fs.readdirSync(SQL_DIR).filter(f => /^0\d+_.*\.sql$/.test(f) && f < '009').sort();
  for (const f of migraciones) await sql.exec(fs.readFileSync(path.join(SQL_DIR, f), 'utf8'));
  const v = (await sql.unsafe('SELECT max(version)::int AS v FROM esquema_version'))[0].v;
  ok('esquema_version = 8 tras ' + migraciones.join(', '), v === 8, v);

  titulo('2 · semillas «de la app» (≤ corte y posteriores)');
  await sembrar(sql, SEM_ANTES.concat(SEM_DESPUES));
  const n0 = (await sql.unsafe('SELECT count(*)::int AS n FROM data'))[0].n;
  ok('sembradas ' + n0 + ' filas (' + SEM_ANTES.length + ' ≤ corte, ' + SEM_DESPUES.length + ' posteriores)', n0 === SEM_ANTES.length + SEM_DESPUES.length, n0);
  const fotoDespues0 = await foto(sql, ` AND fecha > '${HASTA}'`);

  titulo('3 · --simular con conexión no cambia nada');
  const fotoTodo0 = await foto(sql);
  const dirSim = path.join(RESP, 'simular'); fs.mkdirSync(dirSim, { recursive: true });
  const lineasSim = [];
  const rs = await importarMaestro(sql, { excel: EXCEL, hasta: HASTA, simular: true, respaldo: dirSim, log: (s) => lineasSim.push(s) });
  ok('simular: la tabla data queda idéntica', (await foto(sql)) === fotoTodo0);
  ok('simular: no escribe respaldo', fs.readdirSync(dirSim).length === 0, fs.readdirSync(dirSim));
  ok('simular: borraría ' + rs.borraria + ' (las ' + SEM_ANTES.length + ' ≤ corte) e insertaría ' + rs.insertaria + ' (= Excel independiente ' + nExcel + ')', rs.borraria === SEM_ANTES.length && rs.insertaria === nExcel, { b: rs.borraria, i: rs.insertaria });
  ok('simular: la tabla por mes compara Excel vs Galca (' + lineasSim.filter(l => /^\s+20\d\d-\d\d\s/.test(l)).length + ' meses)', lineasSim.some(l => /Galca filas/.test(l)));
  const ver7 = rs.avisos.filter(a => /esquema_version/.test(a));
  ok('simular: sin aviso de esquema (la BD ya está en 8)', ver7.length === 0, ver7);

  titulo('4 · carga real');
  const dir1 = path.join(RESP, 'carga1');
  const log1 = [];
  const r1 = await importarMaestro(sql, { excel: EXCEL, hasta: HASTA, respaldo: dir1, log: (s) => log1.push(s) });
  console.log(log1.filter(l => /^\s+[✓✗] 20|CUADRA|re-aplicada|respaldo:|borradas|insertadas|COMMIT/.test(l)).map(l => '     │' + l).join('\n'));
  ok('importarMaestro: ok (su propia verificación por mes cuadra)', r1.ok === true, r1.verificacion && r1.verificacion.mesesMal);
  ok('borró ' + r1.borradas + ' (las de la app ≤ corte) e insertó ' + r1.insertadas, r1.borradas === SEM_ANTES.length && r1.insertadas === nExcel, { b: r1.borradas, i: r1.insertadas });
  const difs = cuadraMeses(await porMesBD(sql), IND.porMes);
  ok('filas por mes y Σ LARGO (fecha ≤ corte) = cálculo independiente del Excel (' + Object.keys(IND.porMes).length + ' meses)', difs.length === 0, difs);
  const d14 = (await sql.unsafe(`SELECT count(*)::int AS n FROM data WHERE obra_id='tm2sur' AND fecha = '2026-07-14'`))[0].n;
  ok('14-jul: ' + d14 + ' filas en Galca = ' + IND.porDia['2026-07-14'] + ' del Excel', d14 === IND.porDia['2026-07-14'], d14);
  const app = await sql.unsafe(`SELECT id_registro FROM data WHERE obra_id='tm2sur' AND fecha <= $1::date AND id_registro NOT LIKE 'mae-%'`, [HASTA]);
  ok('ninguna fila de la app ≤ corte sobrevive (manda el Excel)', app.length === 0, app);
  const internas = await sql.unsafe(`SELECT count(*) FILTER (WHERE capataz='maestro' AND rol='importacion' AND editado_por='importacion D186' AND version >= 0 AND "timestamp" IS NOT NULL AND editado_ts IS NOT NULL AND actividad = descripcion AND pk_inicial = abs_inicial AND pk_final = abs_final AND area IN ('tierras','odt','odl'))::int AS bien, count(*)::int AS n FROM data WHERE id_registro LIKE 'mae-%'`);
  ok('internas: capataz maestro, rol importacion, actividad = descripción, pk = abs, área derivada, editado_por «importacion D186»', internas[0].bien === internas[0].n, internas[0]);
  const areas = await sql.unsafe(`SELECT count(*)::int AS n FROM data WHERE id_registro LIKE 'mae-%' AND area <> CASE WHEN regexp_replace(btrim(centro_de_costo), '^\\d{4}\\.', '') LIKE '06.%' THEN 'odt' WHEN regexp_replace(btrim(centro_de_costo), '^\\d{4}\\.', '') LIKE '07.%' THEN 'odl' ELSE 'tierras' END`);
  ok('área = deriveArea(CENTRO DE COSTO) en todas', areas[0].n === 0, areas[0]);
  const txt = await sql.unsafe(`SELECT count(*)::int AS n FROM data WHERE id_registro LIKE 'mae-%' AND (acta ~ '\\.\\d{10,}' OR abs_inicial ~ '\\.\\d{10,}' OR orden ~ '\\.0$' OR acta ~ '\\.0$')`);
  ok('ACTA/ABS/ORDEN como texto sin decimales espurios', txt[0].n === 0, txt[0]);

  titulo('5 · la app después del corte, intacta');
  ok('las ' + SEM_DESPUES.length + ' filas posteriores al corte son idénticas (fila completa)', (await foto(sql, ` AND fecha > '${HASTA}'`)) === fotoDespues0);

  titulo('6 · respaldo CSV');
  const archivos1 = fs.existsSync(dir1) ? fs.readdirSync(dir1) : [];
  ok('existe un respaldo_data_' + HASTA + '_<fechahora>.csv', archivos1.length === 1 && new RegExp('^respaldo_data_' + HASTA + '_\\d{8}-\\d{6}\\.csv$').test(archivos1[0]), archivos1);
  const crudo1 = fs.readFileSync(path.join(dir1, archivos1[0]), 'utf8');
  const reg1 = registrosCsv(crudo1);
  const iId = reg1[0].indexOf('id_registro');
  ok('UTF-8 con BOM, separador «;», encabezado con las columnas de data', crudo1.charCodeAt(0) === 0xFEFF && iId >= 0 && reg1[0].indexOf('fecha') >= 0, reg1[0]);
  ok('trae exactamente las ' + SEM_ANTES.length + ' filas borradas (ids de la app ≤ corte)', JSON.stringify(reg1.slice(1).map(r => r[iId]).sort()) === JSON.stringify(SEM_ANTES.map(s => s[0]).sort()), reg1.slice(1).map(r => r[iId]));
  const iObs = reg1[0].indexOf('observacion');
  ok('el respaldo conserva la observación tal cual estaba (con su «;»/sello)', reg1.slice(1).some(r => r[iObs] === '[Clima: LLUVIA] · la app'));
  ok('la herramienta confirmó las filas escritas', r1.respaldo && r1.respaldo.filas === SEM_ANTES.length, r1.respaldo);

  titulo('7 · tras 005 → 008 (re-aplicadas por la herramienta)');
  ok('re-aplicó 005, 006, 007 y 008 en orden', JSON.stringify((r1.migraciones || []).map(m => m.archivo)) === JSON.stringify(['005_data_clima.sql', '006_proyeccion.sql', '007_data_completa.sql', '008_tablero_vivo.sql']), r1.migraciones);
  const m005 = (r1.migraciones || [])[0] || { antes: {}, despues: {} };
  ok('005: sellos [Clima:] ' + m005.antes.sellos + ' → ' + m005.despues.sellos, m005.despues.sellos === 0, m005);
  const sellos = (await sql.unsafe(`SELECT count(*)::int AS n FROM data WHERE observacion ~* '\\[Clima:'`))[0].n;
  ok('ninguna observación con «[Clima:»', sellos === 0, sellos);
  const clima = (await sql.unsafe(`SELECT count(*)::int AS n FROM data WHERE id_registro LIKE 'mae-%' AND clima <> ''`))[0].n;
  ok('el clima de los sellos pasó a la columna clima (' + clima + ' filas)', m005.antes.sellos === 0 || clima > 0, clima);
  const llenas = await sql.unsafe(`SELECT count(*)::int AS n, count(*) FILTER (WHERE btrim(acta) <> '' AND espesor IS NOT NULL AND fc IS NOT NULL AND cantidad IS NOT NULL)::int AS llenas FROM data WHERE obra_id='tm2sur' AND largo IS NOT NULL`);
  ok('ACTA/ESPESOR/FC/CANTIDAD llenos donde hay LARGO (' + llenas[0].llenas + '/' + llenas[0].n + ')', llenas[0].n > 0 && llenas[0].n === llenas[0].llenas, llenas[0]);
  const ao = await sql.unsafe(`SELECT count(*)::int AS n, count(*) FILTER (WHERE fc = 1)::int AS fc1 FROM data WHERE obra_id='tm2sur' AND elemento ~* '^\\s*ajuste\\s+origen'`);
  ok('«ajuste origen» con FC 1 (' + ao[0].fc1 + '/' + ao[0].n + ')', ao[0].n > 0 && ao[0].fc1 === ao[0].n, ao[0]);
  const difs2 = cuadraMeses(await porMesBD(sql), IND.porMes);
  ok('005/007 no cambian filas ni Σ LARGO por mes', difs2.length === 0, difs2);

  titulo('8 · relanzar da lo mismo');
  const ids1 = JSON.stringify((await sql.unsafe(`SELECT id_registro FROM data WHERE obra_id='tm2sur' AND fecha <= $1::date ORDER BY 1`, [HASTA])).map(r => r.id_registro));
  const dir2 = path.join(RESP, 'carga2');
  const r2 = await importarMaestro(sql, { excel: EXCEL, hasta: HASTA, respaldo: dir2, log: silencio });
  const ids2 = JSON.stringify((await sql.unsafe(`SELECT id_registro FROM data WHERE obra_id='tm2sur' AND fecha <= $1::date ORDER BY 1`, [HASTA])).map(r => r.id_registro));
  ok('2ª carga ok, borró ' + r2.borradas + ' (las de la 1ª) e insertó ' + r2.insertadas, r2.ok && r2.borradas === nExcel && r2.insertadas === nExcel, { ok: r2.ok, b: r2.borradas, i: r2.insertadas });
  ok('mismos ids («mae-» + uuid determinista) que la 1ª carga', ids1 === ids2);
  const dup = (await sql.unsafe(`SELECT count(*)::int AS n, count(DISTINCT id_registro)::int AS d FROM data WHERE obra_id='tm2sur'`))[0];
  ok('sin duplicados (' + dup.n + ' filas = ' + dup.d + ' ids = Excel ' + nExcel + ' + ' + SEM_DESPUES.length + ' posteriores)', dup.n === dup.d && dup.n === nExcel + SEM_DESPUES.length, dup);
  ok('mismos totales por mes', cuadraMeses(await porMesBD(sql), IND.porMes).length === 0);
  const reg2 = registrosCsv(fs.readFileSync(path.join(dir2, fs.readdirSync(dir2)[0]), 'utf8'));
  ok('el 2º respaldo trae las ' + nExcel + ' filas de la 1ª carga', reg2.length - 1 === nExcel, reg2.length - 1);
  ok('las posteriores al corte siguen intactas', (await foto(sql, ` AND fecha > '${HASTA}'`)) === fotoDespues0);

  titulo('9 · BD sin 008 → aborta sin tocar nada');
  const { sql: sql7 } = await abrirPglite();
  for (const f of migraciones.filter(f => f < '008')) await sql7.exec(fs.readFileSync(path.join(SQL_DIR, f), 'utf8'));
  await sembrar(sql7, SEM_ANTES);
  const f7 = await foto(sql7);
  const dir7 = path.join(RESP, 'sin008');
  let err7 = null;
  try { await importarMaestro(sql7, { excel: EXCEL, hasta: HASTA, respaldo: dir7, log: silencio }); } catch (e) { err7 = e; }
  ok('lanza «primero despliega 003→008, OPERACIONES §12»', err7 && /003→008, OPERACIONES §12/.test(err7.message), err7 && err7.message);
  ok('la tabla data queda idéntica y sin respaldo escrito', (await foto(sql7)) === f7 && !(fs.existsSync(dir7) && fs.readdirSync(dir7).length), fs.existsSync(dir7) ? fs.readdirSync(dir7) : []);
  let errH = null;
  try { await importarMaestro(sql7, { excel: EXCEL, hasta: '2099-01-01', simular: true, log: silencio }); } catch (e) { errH = e; }
  ok('--hasta en el futuro → error legible', errH && /posterior a hoy/.test(errH.message), errH && errH.message);

  console.log('\n' + (fallos ? '✗ ' + fallos + ' de ' + casos + ' casos fallaron' : '✓ ' + casos + ' casos OK'));
  process.exit(fallos ? 1 : 0);
}
main().catch(err => { console.error('La verificación no pudo correr: ' + (err && err.stack || err)); process.exit(1); });
