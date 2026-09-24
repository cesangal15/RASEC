#!/usr/bin/env node
/**
 * correr_arneses.mjs — corre TODOS los arneses del repo y resume el resultado en una tabla.
 *
 *   node .claude/skills/tm2-validacion/scripts/correr_arneses.mjs [opciones]
 *     --solo=<regex>        solo los arneses cuyo nombre case (p. ej. --solo=parte|d178)
 *     --sin-navegador       omite los que abren Chromium (Playwright)
 *     --volcado=<carpeta>   volcado real de obra para worker/pruebas/contrato_local.js
 *                           (sin él se usa una carpeta VACÍA: solo semillas, que es lo que corre en CI/banco)
 *     --timeout=<seg>       por arnés (defecto 240)
 *     --guardar=<json>      guarda el resultado (línea base)
 *     --comparar=<json>     compara contra una línea base guardada y marca REGRESIONES
 *     --json                resultado en JSON
 *     --repo=<raíz>         por defecto, la raíz que contiene backend/pruebas
 *
 * Estados: OK · FALLA (comprobaciones en rojo) · ROTO (el arnés no llega a comprobar nada: excepción al
 * cargar, típicamente desactualizado respecto del código) · OMITIDO (pide un argumento/archivo real que no
 * hay, o dependencias sin instalar) · TIEMPO (superó --timeout).
 * Código de salida: 0 si no hay FALLA/ROTO/TIEMPO nuevos respecto de --comparar (o ninguno, sin --comparar); 1 si los hay.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = {};
process.argv.slice(2).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });

function buscarRepo(){
  if (args.repo) return path.resolve(args.repo);
  for (const inicio of [path.dirname(fileURLToPath(import.meta.url)), process.cwd()]) {
    let d = inicio;
    for (let i = 0; i < 8; i++) { if (fs.existsSync(path.join(d, 'backend', 'pruebas'))) return d; const p = path.dirname(d); if (p === d) break; d = p; }
  }
  console.error('No encuentro backend/pruebas: pasa --repo=<raíz>'); process.exit(2);
}
const REPO = buscarRepo();
const TIMEOUT = (parseInt(args.timeout || '240', 10)) * 1000;
const rel = f => path.relative(REPO, f);
const lista = (dir, re) => fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => re.test(f)).sort().map(f => path.join(dir, f)) : [];

const arneses = [
  ...lista(path.join(REPO, 'backend', 'pruebas'), /^verificar_.*\.js$/),
  path.join(REPO, 'backend', 'pruebas', 'contrato', 'correr.js'),
  path.join(REPO, 'worker', 'pruebas', 'contrato_local.js'),
  ...lista(path.join(REPO, 'worker', 'pruebas'), /^verificar_.*\.mjs$/),
].filter(f => fs.existsSync(f)).filter(f => !args.solo || new RegExp(args.solo, 'i').test(path.basename(f)));

const usaNavegador = f => /playwright|chromium/i.test(fs.readFileSync(f, 'utf8'));
const esWorker = f => f.includes(path.join('worker', 'pruebas'));
const workerListo = fs.existsSync(path.join(REPO, 'worker', 'node_modules'));
// Playwright global del entorno (cloud) además del NODE_PATH que ya hubiera.
const NODE_PATH = [process.env.NODE_PATH, '/opt/node22/lib/node_modules'].filter(Boolean).join(path.delimiter);
let volcado = args.volcado;
if (!volcado) { volcado = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tm2-volcado-')), 'vacio_obra'); fs.mkdirSync(volcado); }

function ultimaLinea(txt){
  const l = String(txt || '').split('\n').map(s => s.trim()).filter(Boolean);
  const util = l.filter(s => !/^Node\.js v\d/.test(s) && !/^at /.test(s));
  return (util[util.length - 1] || '').slice(0, 160);
}
function clasificar(rc, out, err){
  const todo = out + '\n' + err;
  if (rc === null) return 'TIEMPO';
  if (rc === 0) return 'OK';
  if (/Falta --|No hay volcado|pasa --volcado|Cannot find (package|module) '(pg|postgres|@electric-sql|playwright)/.test(todo)) return 'OMITIDO';
  const comprobo = /✓|✗|\bok\b|FALLA|comprobaci|casos?\b/i.test(out);
  if (!comprobo && /(ReferenceError|TypeError|SyntaxError|no se encontró la función)/.test(todo)) return 'ROTO';
  return 'FALLA';
}

const res = [];
for (const f of arneses) {
  const nombre = rel(f);
  if (args['sin-navegador'] && usaNavegador(f)) { res.push({ arnes: nombre, estado: 'OMITIDO', seg: 0, resumen: 'usa Chromium (--sin-navegador)' }); continue; }
  if (esWorker(f) && !workerListo) { res.push({ arnes: nombre, estado: 'OMITIDO', seg: 0, resumen: 'falta worker/node_modules: cd worker && npm ci' }); continue; }
  const extra = /contrato_local\.js$/.test(f) ? ['--volcado=' + volcado] : [];
  const t0 = Date.now();
  const p = spawnSync(process.execPath, [f, ...extra], { cwd: REPO, encoding: 'utf8', timeout: TIMEOUT, env: { ...process.env, NODE_PATH }, maxBuffer: 64 * 1024 * 1024 });
  const rc = p.error && p.error.code === 'ETIMEDOUT' ? null : p.status;
  const estado = clasificar(rc, p.stdout || '', p.stderr || '');
  const errLinea = ((p.stderr || '').split('\n').find(l => /Error/.test(l)) || '').trim().slice(0, 120);
  let resumen = estado === 'ROTO' ? (errLinea || ultimaLinea(p.stderr)) : ultimaLinea(p.stdout || p.stderr);
  if (estado === 'FALLA' && errLinea) resumen += '  [revienta: ' + errLinea + ']';
  res.push({ arnes: nombre, estado, seg: Math.round((Date.now() - t0) / 100) / 10, resumen });
  if (!args.json) console.log(estado.padEnd(8) + ' ' + String(res[res.length - 1].seg + 's').padStart(6) + '  ' + nombre + '  · ' + resumen);
}

let base = null;
if (args.comparar) { try { base = new Map(JSON.parse(fs.readFileSync(args.comparar, 'utf8')).map(r => [r.arnes, r.estado])); } catch (e) { console.error('No pude leer --comparar: ' + e.message); } }
const malos = r => ['FALLA', 'ROTO', 'TIEMPO'].includes(r.estado);
res.forEach(r => { if (base) r.antes = base.get(r.arnes) || '(nuevo)'; r.regresion = !!(base && malos(r) && !['FALLA', 'ROTO', 'TIEMPO'].includes(r.antes)); });
if (args.guardar) fs.writeFileSync(args.guardar, JSON.stringify(res, null, 2));

const cuenta = {}; res.forEach(r => { cuenta[r.estado] = (cuenta[r.estado] || 0) + 1; });
const regresiones = res.filter(r => r.regresion);
if (args.json) console.log(JSON.stringify({ cuenta, regresiones, resultados: res }, null, 2));
else {
  console.log('\nResumen: ' + Object.entries(cuenta).map(([k, v]) => k + ' ' + v).join(' · ') + ' (de ' + res.length + ')');
  if (base) console.log(regresiones.length ? '✗ REGRESIONES respecto de la línea base: ' + regresiones.map(r => r.arnes + ' (' + r.antes + '→' + r.estado + ')').join(', ')
                                           : '✓ Sin regresiones respecto de la línea base.');
  const preexist = res.filter(r => malos(r) && !r.regresion);
  if (preexist.length && base) console.log('  (en rojo también en la línea base: ' + preexist.map(r => path.basename(r.arnes)).join(', ') + ')');
  if (!args.volcado) console.log('  contrato_local corrió con volcado VACÍO (solo semillas). Para datos reales: --volcado=<carpeta *_obra>.');
}
process.exit(base ? (regresiones.length ? 1 : 0) : (res.some(malos) ? 1 : 0));
