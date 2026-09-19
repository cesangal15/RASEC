#!/usr/bin/env node
/**
 * tools/sandbox/comparar_proyeccion.mjs — ¿el TABLERO sale igual con la proyección de GALCA que con la del EXCEL?
 * (D183 · V3-11 Fase A)
 *
 * Desde D183 el Tablero de producción toma la PROYECCIÓN (plan mensual, rendimiento por equipo, fc, contrato y
 * línea base) de Galca (?action=proyeccion_tablero) en vez del Excel; la producción diaria (hoja DATOS) y las
 * horas de máquina (Excel de partes) siguen saliendo del Excel. Este guion lo comprueba FUERA del navegador,
 * con el MISMO motor que corre en la página (tablero-produccion.js, cargado en Node con tablero-xlsx.js):
 *
 *   1. lee tu copia del Excel de producción (DATOS, CALCULOS, MAPEO) y, si la das, la de partes (BASE MAQUINARIA);
 *   2. pide la proyección a Galca: por defecto a un Postgres EN MEMORIA (PGlite) con las migraciones
 *      worker/sql/0*.sql (incluida 006_proyeccion.sql y sus semillas) y el WORKER REAL (login + GET
 *      ?action=proyeccion_tablero); o, con --url, a un servidor que ya esté corriendo (p. ej. el sandbox);
 *   3. corre construir(Excel) y construir(Excel + Galca) y compara las dos salidas campo a campo (ignora solo
 *      generado, fuente, fuente_proy, leidoDe, leidoFecha y dif_proy);
 *   4. imprime las diferencias de ENTRADA Galca vs Excel (plan, proyectado, contrato, base, corte, fc): la misma
 *      lista que el panel «Comparación con el Excel» del Tablero.
 *
 * USO (desde la raíz del repo):
 *   node tools/sandbox/comparar_proyeccion.mjs --excel=<copia de TM2_SUR_REPORTE.xlsx> [--partes=<copia de partes.xlsx>]
 *   node tools/sandbox/comparar_proyeccion.mjs --excel=… --url=http://127.0.0.1:8099 [--usuario=jefe --clave=clave-jefe]
 *   node tools/sandbox/comparar_proyeccion.mjs --excel=… --cambiar=2026-09:subbase=5000
 *
 * OPCIONES:
 *   --excel=<xlsx>        copia del Excel de producción (OBLIGATORIO). Se lee, nunca se escribe (D24).
 *   --partes=<xlsx>       copia del libro de partes con la hoja BASE MAQUINARIA (opcional; tarda ~30 s en leerse).
 *   --url=<base>          servidor ya levantado (sin él: PGlite en proceso). La API es <base>/obra.
 *   --usuario / --clave   credenciales para --url (por defecto jefe / clave-jefe, las del sandbox).
 *   --cambiar=P:partida=V simula que alguien cambió en Galca el plan del periodo P (YYYY-MM) de esa partida
 *                         (excavacion|terraplen|subbase|base|noaprov) a V. En PGlite se guarda de verdad por el
 *                         Worker (POST proyeccion_guardar) y se vuelve a leer; con --url se cambia SOLO en memoria
 *                         (este guion nunca escribe en un servidor). La salida debe diferir EXACTAMENTE en el
 *                         plan de ese periodo/partida.
 *   --max=40              cuántas diferencias de salida se imprimen como mucho.
 *
 * SALIDA: 0 = las salidas son idénticas (o, con --cambiar, difieren exactamente donde tocaba); 1 = no;
 *         2 = no se pudo comparar (archivo, servidor o migración que falta).
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, '..', '..');
const IGNORAR = new Set(['generado', 'fuente', 'fuente_proy', 'leidoDe', 'leidoFecha', 'dif_proy']);
const PARTIDAS_PLAN = ['excavacion', 'terraplen', 'subbase', 'base', 'noaprov'];

const args = {};
process.argv.slice(2).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });
const MAX = Number(args.max || 40);

function falla(msg){ console.error('\n✗ ' + msg + '\n'); process.exit(2); }
const seg = (t0) => ((Date.now() - t0) / 1000).toFixed(1) + ' s';
const fmt = (v) => v == null ? '—' : (typeof v === 'number' ? v.toLocaleString('es-CO', { maximumFractionDigits: 3 }) : JSON.stringify(v));

/* ---------- 1. el motor del tablero, tal cual lo corre el navegador ---------- */
function cargarMotor(){
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(REPO, 'tablero-xlsx.js'), 'utf8'), ctx, { filename: 'tablero-xlsx.js' });
  const src = fs.readFileSync(path.join(REPO, 'tablero-produccion.js'), 'utf8');
  const corte = src.indexOf('const TM2_EMBEBIDO');       // el motor es todo lo que va antes de la foto embebida
  if (corte < 0) falla('tablero-produccion.js no tiene la marca «const TM2_EMBEBIDO»: no sé dónde acaba el motor.');
  vm.runInContext(src.slice(0, corte) + '\n;this.MOTOR = MOTOR;', ctx, { filename: 'tablero-produccion.js (motor)' });
  if (typeof ctx.MOTOR.proyDeGalca !== 'function') falla('el motor de tablero-produccion.js no trae proyDeGalca (¿versión anterior a D183?).');
  return ctx;
}

function leerXlsx(ctx, archivo, hojas){
  if (!fs.existsSync(archivo)) falla('No existe el archivo: ' + archivo);
  // Igual que leerLibro() del Tablero: cellDates y solo las hojas que usa.
  return ctx.XLSX.read(fs.readFileSync(archivo), { type: 'buffer', cellDates: true, sheets: hojas });
}

/* ---------- 2. la proyección de Galca ---------- */
function clienteHttp(base){
  const api = base.replace(/\/+$/, '') + '/obra';
  return {
    donde: api,
    async get(q){ const u = new URL(api); Object.keys(q).forEach(k => u.searchParams.set(k, String(q[k]))); const r = await fetch(u); return leerJson(r); },
    async post(b){ const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(b) }); return leerJson(r); }
  };
}
async function leerJson(r){ const t = await r.text(); try { return JSON.parse(t); } catch (e) { return { ok: false, error: 'respuesta ' + r.status + ' no JSON: ' + t.slice(0, 160) }; } }

async function clientePglite(){
  const SQL_DIR = path.join(REPO, 'worker', 'sql');
  const migraciones = fs.readdirSync(SQL_DIR).filter(f => /^0\d+_.*\.sql$/.test(f)).sort();
  if (!migraciones.some(f => /^006_/.test(f))) falla('Falta worker/sql/006_proyeccion.sql (D183): sin ella no hay proyección en Galca.');
  let abrirPglite, semillar, manejar;
  try {
    ({ abrirPglite } = await import(pathToFileURL(path.join(REPO, 'worker', 'pruebas', 'pglite.js')).href));
    ({ semillar } = await import(pathToFileURL(path.join(REPO, 'worker', 'pruebas', 'semillas_sql.js')).href));
    ({ manejar } = await import(pathToFileURL(path.join(REPO, 'worker', 'src', 'index.js')).href));
  } catch (e) {
    falla('No pude cargar PGlite o el Worker (' + e.message + '). ¿Hiciste «cd worker && npm install»? O usa --url con el sandbox levantado.');
  }
  const { sql } = await abrirPglite();
  for (const f of migraciones) await sql.exec(fs.readFileSync(path.join(SQL_DIR, f), 'utf8'));
  const { semillas } = require(path.join(REPO, 'backend', 'pruebas', 'contrato', 'semillas.js'));
  await semillar(sql, semillas(), {});
  const env = { BACKEND_OBRA: 'db', BACKEND_ASISTENCIAS: 'db', BACKEND_PARTE: 'db', AUTH_SECRETO: 'comparador-local',
                AUTH_V: '1', RATE_LIMIT_POR_MIN: '100000', __dbPrueba: () => sql };
  const ctxW = { waitUntil: (p) => { Promise.resolve(p).catch(() => {}); } };
  const pedir = async (init, q) => {
    const u = new URL('http://127.0.0.1/obra'); Object.keys(q || {}).forEach(k => u.searchParams.set(k, String(q[k])));
    const r = await manejar(new Request(u.toString(), Object.assign({ headers: { 'Content-Type': 'text/plain;charset=utf-8', 'CF-Connecting-IP': '127.0.0.1' } }, init)), env, ctxW);
    return leerJson(r);
  };
  return {
    donde: 'PGlite en memoria · ' + migraciones.join(', ') + ' · Worker real (worker/src/index.js)',
    get: (q) => pedir({ method: 'GET' }, q),
    post: (b) => pedir({ method: 'POST', body: JSON.stringify(b) })
  };
}

/* --cambiar=2026-09:subbase=5000 */
function leerCambio(){
  if (!args.cambiar) return null;
  const m = /^(\d{4}-\d{2}):([a-z]+)=(-?[\d.]+)$/.exec(String(args.cambiar));
  if (!m || PARTIDAS_PLAN.indexOf(m[2]) < 0) falla('--cambiar debe ser PERIODO:PARTIDA=VALOR, p. ej. 2026-09:subbase=5000 (partidas: ' + PARTIDAS_PLAN.join(', ') + ').');
  return { periodo: m[1], partida: m[2], valor: Number(m[3]) };
}

/* Guarda el cambio de plan por el Worker (solo PGlite): lee la versión de la fila y manda proyeccion_guardar. */
async function guardarCambio(cli, token, cambio){
  const g = await cli.get({ action: 'proyeccion', token });
  if (!g || g.ok !== true) falla('GET ?action=proyeccion falló: ' + JSON.stringify(g).slice(0, 300));
  const fila = ((g.tablas && g.tablas.plan && g.tablas.plan.filas) || []).find(f => String(f.periodo).slice(0, 7) === cambio.periodo);
  if (!fila) falla('El periodo ' + cambio.periodo + ' no está en el plan de Galca (proy_plan).');
  const r = await cli.post({ action: 'proyeccion_guardar', token, cambios: [
    { tabla: 'plan', op: 'update', periodo: cambio.periodo + '-01', if_version: fila.version, [cambio.partida]: cambio.valor }] });
  if (!r || r.ok !== true) falla('proyeccion_guardar no guardó el cambio: ' + JSON.stringify({ error: r && r.error, conflictos: r && r.conflictos, mensaje: r && r.mensaje }));
  return { antes: fila[cambio.partida], mensaje: r.mensaje || '' };
}

/* ---------- 3. comparación profunda de las dos salidas ---------- */
function difProfunda(a, b, ruta, out){
  if (a === b) return;
  const ta = Array.isArray(a) ? 'array' : (a === null ? 'null' : typeof a);
  const tb = Array.isArray(b) ? 'array' : (b === null ? 'null' : typeof b);
  if (ta !== tb || (ta !== 'array' && ta !== 'object')){ out.push({ ruta, excel: a, galca: b }); return; }
  if (ta === 'array'){
    if (a.length !== b.length) out.push({ ruta: ruta + '.length', excel: a.length, galca: b.length });
    for (let i = 0; i < Math.min(a.length, b.length); i++){
      // los periodos se nombran por su clave para que la ruta se lea: per[15:2026-09]
      const etq = (a[i] && typeof a[i] === 'object' && typeof a[i].p === 'string') ? i + ':' + a[i].p : String(i);
      difProfunda(a[i], b[i], ruta + '[' + etq + ']', out);
    }
    return;
  }
  const claves = new Set(Object.keys(a).concat(Object.keys(b)));
  for (const k of claves){
    if (!ruta && IGNORAR.has(k)) continue;
    if (!(k in a) || !(k in b)){ out.push({ ruta: (ruta ? ruta + '.' : '') + k, excel: a[k], galca: b[k] }); continue; }
    difProfunda(a[k], b[k], (ruta ? ruta + '.' : '') + k, out);
  }
}

/* ---------- main ---------- */
async function main(){
  if (!args.excel || args.excel === true) falla('Falta --excel=<copia del Excel de producción>. Ver la cabecera de este archivo.');
  const cambio = leerCambio();
  const t0 = Date.now();
  const ctx = cargarMotor();
  const M = ctx.MOTOR;

  console.log('\n· Excel de producción: ' + path.resolve(String(args.excel)));
  const wp = leerXlsx(ctx, String(args.excel), ['DATOS', 'CALCULOS', 'MAPEO']);
  console.log('  hojas leídas: ' + ['DATOS', 'CALCULOS', 'MAPEO'].map(h => h + (wp.Sheets[h] ? ' ✓' : ' (no viene)')).join(' · ') + '  [' + seg(t0) + ']');
  let wm = null;
  if (args.partes && args.partes !== true){
    const t1 = Date.now();
    console.log('· Partes de maquinaria: ' + path.resolve(String(args.partes)) + ' (tarda ~30 s)…');
    wm = leerXlsx(ctx, String(args.partes), ['BASE MAQUINARIA']);
    if (!wm.SheetNames.some(n => n.toUpperCase().includes('BASE MAQUINARIA'))) falla('El libro de partes no trae la hoja BASE MAQUINARIA.');
    console.log('  BASE MAQUINARIA ✓  [' + seg(t1) + ']');
  } else {
    console.log('· Sin libro de partes: se compara sin maquinaria (usa --partes=<copia> para incluirla).');
  }

  const cli = args.url ? clienteHttp(String(args.url)) : await clientePglite();
  console.log('· Galca: ' + cli.donde);
  const usuario = String(args.usuario || 'jefe'), clave = String(args.clave || 'clave-jefe');
  const lg = await cli.post({ action: 'login', usuario, clave });
  if (!lg || lg.ok !== true || !lg.token) falla('No pude entrar como ' + usuario + ': ' + JSON.stringify(lg).slice(0, 200));
  const token = lg.token;

  let nota = '';
  if (cambio && !args.url){
    const r = await guardarCambio(cli, token, cambio);
    nota = 'guardado en Galca por el Worker (proyeccion_guardar): plan ' + cambio.periodo + ' · ' + cambio.partida + ' ' + fmt(r.antes) + ' → ' + fmt(cambio.valor) + (r.mensaje ? ' · «' + r.mensaje + '»' : '');
  }
  const j = await cli.get({ action: 'proyeccion_tablero', token });
  if (!j || j.ok !== true) falla('GET ?action=proyeccion_tablero falló: ' + JSON.stringify(j).slice(0, 300));
  if (cambio && args.url){
    if (!j.plan || !j.plan[cambio.periodo]) falla('El periodo ' + cambio.periodo + ' no está en el plan que devolvió Galca.');
    nota = 'SOLO EN MEMORIA (con --url nunca se escribe en el servidor): plan ' + cambio.periodo + ' · ' + cambio.partida + ' ' + fmt(j.plan[cambio.periodo][cambio.partida]) + ' → ' + fmt(cambio.valor);
    j.plan[cambio.periodo][cambio.partida] = cambio.valor;
  }
  let proy;
  try { proy = M.proyDeGalca(j); } catch (e) { falla('La respuesta de Galca no sirve al Tablero: ' + e.message); }
  console.log('  fuente=' + j.fuente + ' · actualizado=' + (proy.actualizado || '(sin ediciones)') + (proy.usuario ? ' por ' + proy.usuario : '') +
              ' · fc=' + proy.fc + ' · acta base=' + proy.acta_base + ' · corte=' + proy.base_corte + ' · ' + Object.keys(proy.plan).length + ' periodos de plan');
  console.log('  proyectado ' + JSON.stringify(proy.proyectado));
  console.log('  contrato   ' + JSON.stringify(proy.contrato));
  console.log('  base_acum  ' + JSON.stringify(proy.base_acum));
  if (nota) console.log('· Cambio simulado: ' + nota);

  // --- diferencias de ENTRADA (lo mismo que el panel «Comparación con el Excel») ---
  const dif = M.difProy(wp, proy);
  console.log('\n── Entrada: Galca contra el Excel y las constantes del código ' + '─'.repeat(20));
  if (!dif.length) console.log('  sin diferencias ✓  (plan y proyectado de CALCULOS' + (wp.Sheets.MAPEO ? ', contrato y base de MAPEO' : '') + ', CONTRATO/BASE_ACUM/BASE_CORTE/FC_DEFECTO)');
  else {
    const ancho = Math.max(...dif.map(x => x.dato.length));
    dif.forEach(x => console.log('  ' + x.dato.padEnd(ancho) + '   Galca ' + fmt(x.galca).padStart(12) + '   Excel/código ' + fmt(x.excel).padStart(12) + '   (' + x.origen + ')'));
  }

  // --- salidas del motor ---
  const t2 = Date.now();
  const dE = JSON.parse(JSON.stringify(M.construir(wp, wm)));
  const dG = JSON.parse(JSON.stringify(M.construir(wp, wm, proy)));
  const out = []; difProfunda(dE, dG, '', out);
  console.log('\n── Salida del Tablero: construir(Excel) contra construir(Excel + Galca) ' + '─'.repeat(10) + '  [' + seg(t2) + ']');
  console.log('  ' + dE.per.length + ' periodos (' + dE.per[0].p + ' … ' + dE.per[dE.per.length - 1].p + ') · maquinaria en ' + dE.maq_periodos.length +
              ' · avance: ' + dG.avance.map(a => a.k + ' ' + fmt(a.eje) + '/' + fmt(a.plan)).join(' · '));
  if (!out.length) console.log('  IDÉNTICAS ✓  (se ignoran solo: ' + [...IGNORAR].join(', ') + ')');
  else {
    out.slice(0, MAX).forEach(x => console.log('  ' + x.ruta + ':  Excel ' + fmt(x.excel) + '  →  Galca ' + fmt(x.galca)));
    if (out.length > MAX) console.log('  … y ' + (out.length - MAX) + ' más (--max=N para ver más)');
  }

  // --- veredicto ---
  let bien;
  if (!cambio){
    bien = out.length === 0;
    console.log('\n' + (bien ? '✓ Las dos salidas son IDÉNTICAS: el Tablero sale igual leyendo la proyección de Galca que la del Excel.'
                             : '✗ Las salidas DIFIEREN en ' + out.length + ' campo(s). Si arriba hay diferencias de entrada, son su causa.') + '\n');
  } else {
    const hayPer = dE.per.some(p => p.p === cambio.periodo);
    const esperada = new RegExp('^per\\[\\d+:' + cambio.periodo + '\\]\\.(a|uf\\.UF1\\.a|uf\\.UF2\\.a)\\.' + cambio.partida + '\\.plan_per$');
    const fuera = out.filter(x => !esperada.test(x.ruta));
    if (!hayPer){
      bien = out.length === 0;
      console.log('\n' + (bien ? '✓ ' : '✗ ') + 'El periodo ' + cambio.periodo + ' no tiene producción en DATOS, así que el Tablero no lo pinta: la salida ' + (bien ? 'no cambia, como debe.' : 'cambió y no debía.') + '\n');
    } else {
      bien = out.length > 0 && fuera.length === 0;
      console.log('\n' + (bien ? '✓ La salida difiere EXACTAMENTE en el plan de ' + cambio.periodo + ' · ' + cambio.partida + ' (' + out.length + ' campo(s): el total y, si aplica, UF1/UF2) y en nada más.'
                               : (out.length === 0 ? '✗ La salida NO cambió (¿el valor nuevo redondea igual que el viejo?).'
                                                   : '✗ La salida cambió FUERA de lo esperado: ' + fuera.map(x => x.ruta).slice(0, 10).join(', '))) + '\n');
    }
  }
  process.exit(bien ? 0 : 1);
}
main().catch(e => falla('Error inesperado: ' + (e && e.stack || e)));
