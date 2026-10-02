#!/usr/bin/env node
/**
 * Verificación D228 — la PANTALLA de revisión de partes (revision-maquinaria.html) contra el Worker REAL.
 *
 * Levanta, como tools/sandbox/servidor.mjs, Postgres en memoria (PGlite) con el esquema real + el Worker real + las pantallas
 * del repo en un mismo puerto, siembra sus propios partes de prueba y recorre la pantalla con Chromium (Playwright):
 *
 *   R1  agrupar por equipo (cabecera con N filas y total) y «↩ Deshacer reparto»
 *   R2  «Guardar y aprobar» con el CC editado, «Aprobar todo lo sin alertas» con ediciones, confirm al cambiar de día
 *   R3  CC escrito a mano (selector, modal Repartir, parte manual y celda de la hoja)
 *   R4  CC sugerido (chip en la tarjeta, ficha y clic derecho en la hoja)
 *   R5  alertas: texto de CC_SUGERIDO y error claro al aprobar con CC «Disponible»
 *   R6  día sin operación con CC por equipo (obligatorio) y Taller sin CC
 *   R7  textos cortos y tipo sin cortar en «Equipos sin parte»
 *   R8  Hoja (≥1100 px): aprobar selección, descartar, errores por fila, ficha; tarjetas a 390 px; tema oscuro
 *   y: cero errores de consola y cero violaciones de CSP.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node worker/pruebas/verificar_d228_revision_pantalla.mjs
 *   (CAPTURAS=<carpeta> guarda las capturas; CHROME=<ruta> usa otro Chromium con playwright-core)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { abrirPglite } from './pglite.js';
import { semillar } from './semillas_sql.js';
import { manejar } from '../src/index.js';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(AQUI, '..', '..');
const SQL_DIR = path.join(REPO, 'worker', 'sql');
const { semillas } = require(path.join(REPO, 'backend', 'pruebas', 'contrato', 'semillas.js'));
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('playwright-core')); }
const OUT = process.env.CAPTURAS || path.join(os.tmpdir(), 'd228-capturas'); fs.mkdirSync(OUT, { recursive: true });

let fallos = 0, casos = 0;
const ok = (n, c, x) => { casos++; if (!c) { fallos++; console.log('  ✗ ' + n + (x !== undefined ? '  → ' + (typeof x === 'string' ? x : JSON.stringify(x)) : '')); } else console.log('  ✓ ' + n); };

/* ---------- Worker real + Postgres en memoria ---------- */
const { sql } = await abrirPglite();
for (const f of fs.readdirSync(SQL_DIR).filter((x) => /^0\d+_.*\.sql$/.test(x)).sort()) await sql.exec(fs.readFileSync(path.join(SQL_DIR, f), 'utf8'));
await semillar(sql, semillas(), {});

const D = '2026-09-30', H = '2026-09-29';
const EQUIPOS = [['EQA', 'BULLDOZER', 'HOROMETRO'], ['EQB', 'VOLQUETA', 'KM'], ['EQC', 'CARROTANQUE', 'HOROMETRO'], ['EQG', 'EXCAVADORA', 'HOROMETRO'],
  ['EQH', 'CARGADOR', 'HOROMETRO'], ['CT1', 'CARROTANQUE', 'HOROMETRO'], ['CT2', 'CARROTANQUE', 'HOROMETRO'],
  ['EQD', 'VIBROCOMPACTADOR TANDEM', 'HOROMETRO'], ['EQE', 'MOTONIVELADORA', 'HOROMETRO'], ['EQF', 'RETROEXCAVADORA SOBRE LLANTAS', 'HOROMETRO']];
await sql`DELETE FROM maquinas WHERE obra_id='tm2sur'`;
for (const [c, t] of EQUIPOS) await sql`INSERT INTO maquinas (obra_id,id_maquina,tipo,horas_prog,propiedad,fecha_ingreso,fecha_retiro,notas,frente,grupo) VALUES ('tm2sur',${c},${t},6.4,'propia','2026-01-01',null,'','UF1-UF2','tierras')`;
for (const [c, t, m] of EQUIPOS) { await sql`DELETE FROM parte_equipos WHERE obra_id='tm2sur' AND codigo=${c}`; await sql`INSERT INTO parte_equipos (obra_id,codigo,tipo,placa,proveedor,medidor,activo) VALUES ('tm2sur',${c},${t},'PLK'||${c},'',${m},'SI')`; }
for (const [cc, d] of [['3701.02.07', 'Terraplén UF1'], ['3701.02.11', 'Cargue UF1'], ['3702.03.01', 'Subbase granular UF2'], ['3701.05.04', 'Cuneta UF1'], ['Taller', 'Taller / mantenimiento']])
  await sql`INSERT INTO parte_cc (obra_id,centro_coste,proyecto,descripcion_cc,usos_ult_4_meses,activo) VALUES ('tm2sur',${cc},${cc.slice(0, 4)},${d},10,'SI') ON CONFLICT DO NOTHING`;
await sql`DELETE FROM parte_bandeja WHERE obra_id='tm2sur'`;
let nts = 0;
async function fila(o) {
  const eq = EQUIPOS.find((e) => e[0] === o.c), tot = Math.round((o.fi - o.i) * 100) / 100;
  await sql`INSERT INTO parte_bandeja (obra_id,id_registro,"timestamp",estado,fecha,codigo,tipo,placa,medidor,reporte_num,inicial,final,total,inicial_modificado,horas_varada,horas_lluvia,hora_de,hora_a,descripcion_trabajo,centro_coste,pr,uf,operador,observaciones,alertas,revisado_por,revisado_ts,origen,firma,firma_huella)
    VALUES ('tm2sur',${o.id},${'2026-09-30T1' + (nts++ % 10) + ':00:00Z'},${o.e || 'pendiente'},${o.f || D},${o.c},${eq[1]},${'PLK' + o.c},${eq[2]},${o.rn || '9001'},${o.i},${o.fi},${tot},'NO',null,null,${o.hd || '07:00'},${o.ha || '16:00'},${o.d || 'Trabajo de prueba'},${o.cc},${o.pr || null},${o.uf || ''},${o.op || 'Operador Uno'},${o.ob || ''},${o.al || ''},'',null,'qr','','')`;
}
await fila({ id: 'a1', c: 'EQA', i: 100, fi: 105, hd: '07:00', ha: '12:00', cc: '3701.02.07', uf: '1', rn: '8001', d: 'Terraplén mañana' });
await fila({ id: 'a2', c: 'EQA', i: 105, fi: 108, hd: '13:00', ha: '17:00', cc: '3701.02.11', uf: '1', rn: '8001', d: 'Cargue tarde' });
await fila({ id: 'b0', c: 'EQB', f: H, i: 4900, fi: 5000, e: 'aprobado', cc: '3701.05.04', uf: '1', d: 'Cuneta ayer', rn: '7000' });
await fila({ id: 'b1', c: 'EQB', i: 5000, fi: 5120, cc: '', al: 'SIN_CC', d: 'Se movió material por la vía', rn: '8002' });
await fila({ id: 'g1', c: 'EQG', i: 200, fi: 208, cc: '3701.02.07', uf: '1', rn: '8003' });
await fila({ id: 'h1', c: 'EQH', i: 300, fi: 308, cc: '3701.02.07', uf: '1', rn: '8004' });
await fila({ id: 'c1', c: 'EQC', i: 50, fi: 58, cc: 'Disponible', rn: '8005', d: 'Disponible' });
await fila({ id: 'r1', c: 'CT1', i: 400, fi: 420, cc: '3701.02.07', uf: '1', rn: '8006' });
await fila({ id: 'r2', c: 'CT2', i: 500, fi: 520, cc: '3701.02.11', uf: '1', rn: '8007' });
await fila({ id: 'd0', c: 'EQD', f: H, i: 600, fi: 610, e: 'aprobado', cc: '3701.02.07', uf: '1', d: 'Terraplén', rn: '7001' });

const SECRETO = 'sandbox-secreto-local';
const envWorker = { ALLOWED_ORIGINS: '', BACKEND_OBRA: 'db', BACKEND_ASISTENCIAS: 'db', BACKEND_PARTE: 'db', AUTH_SECRETO: SECRETO, AUTH_V: '1', RATE_LIMIT_POR_MIN: '100000', __dbPrueba: () => sql };
const ctxW = { waitUntil: (p) => { Promise.resolve(p).catch(() => {}); } };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let PUERTO = 0;
const servidor = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1:' + PUERTO);
  if (['/obra', '/asistencias', '/parte'].indexOf(u.pathname) >= 0) {
    let cuerpo = ''; req.on('data', (d) => { cuerpo += d; }); req.on('end', async () => {
      const init = { method: req.method, headers: { 'Content-Type': req.headers['content-type'] || 'text/plain;charset=utf-8', 'CF-Connecting-IP': '127.0.0.1', Origin: 'http://127.0.0.1:' + PUERTO } };
      if (req.method === 'POST') init.body = cuerpo;
      try { const r = await manejar(new Request(u.toString(), init), Object.assign({}, envWorker, { ALLOWED_ORIGINS: 'http://127.0.0.1:' + PUERTO }), ctxW);
        const cab = {}; r.headers.forEach((v, k) => { cab[k] = v; }); res.writeHead(r.status, cab); res.end(Buffer.from(await r.arrayBuffer())); }
      catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: String(e && e.stack || e) })); }
    }); return;
  }
  let p = u.pathname === '/' ? '/index.html' : u.pathname;
  if (p === '/sw.js') { res.writeHead(404); return res.end(); }
  const fp = path.join(REPO, path.normalize(p));
  if (!fp.startsWith(REPO) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(fp));
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r)); PUERTO = servidor.address().port;
const BASE = 'http://127.0.0.1:' + PUERTO;

/* ---------- Chromium ---------- */
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : undefined);
const errores = []; let SESION = null;
async function abrir(vp, opt = {}) {
  const c = await browser.newContext({ viewport: vp, serviceWorkers: 'block' });
  await c.addInitScript(([v, t]) => { try { if (localStorage.getItem('tm2_rev_vista') === null) localStorage.setItem('tm2_rev_vista', v); if (localStorage.getItem('tm2_tema') === null) localStorage.setItem('tm2_tema', t); } catch (e) {} }, [opt.vista || 'tarjetas', opt.tema || 'claro']);
  const pg = await c.newPage();
  pg.on('pageerror', (e) => errores.push(String(e)));
  pg.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errores.push(m.text()); });
  await pg.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  if (SESION) await c.addInitScript((s) => { try { for (const k in s) localStorage.setItem(k, s[k]); } catch (e) {} }, SESION);   // el login limita a 10 intentos/min por usuario: se entra una vez y se reutiliza la sesion
  else {
    await pg.goto(BASE + '/index.html');
    await pg.fill('#usuario', opt.usuario || 'admin'); await pg.fill('#clave', opt.clave || '1234'); await pg.keyboard.press('Enter');
    await pg.waitForFunction(() => !!localStorage.getItem('tm2_token'));
    SESION = await pg.evaluate(() => ({ usuario: localStorage.getItem('usuario'), rol: localStorage.getItem('rol'), tm2_token: localStorage.getItem('tm2_token') }));
  }
  await pg.waitForLoadState('load');
  await pg.goto(BASE + '/revision-maquinaria.html');
  await pg.waitForFunction(() => !!document.getElementById('fecha').value);
  await fecha(pg, opt.fecha || D);
  return pg;
}
async function fecha(pg, f) { await pg.fill('#fecha', f); await pg.locator('#fecha').dispatchEvent('change'); await pg.waitForFunction((x) => typeof BAND !== 'undefined' && BAND.fecha === x, f); await pg.waitForTimeout(150); }
const post = (pg, body) => pg.evaluate((b) => api(null, b), body);
const q = async (id) => (await sql`SELECT * FROM parte_bandeja WHERE id_registro=${id}`)[0];
const toast = async (pg) => (await pg.locator('.toast').textContent().catch(() => '')) || '';
const elegirCC = async (pg, boton, texto) => { await boton.click(); await pg.locator('.cc-pop .cc-q').fill(texto); await pg.locator('.cc-pop .cc-q').press('Enter'); };
const sinAlert = (pg) => { pg.on('dialog', (d) => { if (process.env.DEBUG) console.log('   [dialog] ' + d.message()); d.accept(); }); };

async function reponer() {   // deja cada sección con los mismos pendientes de partida
  await sql`UPDATE parte_bandeja SET estado='pendiente', revisado_por='', revisado_ts=null WHERE fecha=${D} AND id_registro IN ('a1','a2','b1','g1','h1','c1','r1','r2-r1','r2-r2')`;
  await sql`UPDATE parte_bandeja SET centro_coste='3701.02.07', uf='1' WHERE id_registro IN ('g1','h1')`;
  await sql`UPDATE parte_bandeja SET centro_coste='', alertas='SIN_CC', uf='' WHERE id_registro='b1'`;
  await sql`UPDATE parte_bandeja SET centro_coste='Disponible', uf='' WHERE id_registro='c1'`;
  await sql`UPDATE parte_bandeja SET estado='descartado' WHERE id_registro='r2'`;
  await sql`DELETE FROM parte_bandeja WHERE codigo IN ('EQD','EQE','EQF') AND fecha=${D}`;
}

/* ---------- preparación: dos repartos reales (CT1 para tarjetas, CT2 para la hoja) ---------- */
{
  const pg = await abrir({ width: 1440, height: 900 });
  for (const id of ['r1', 'r2']) {
    const d = await post(pg, { mod: 'parte', op: 'repartir', id_registro: id, reparto: [{ centro_coste: '3701.02.07', pct: 50, pr: '', uf: '1', descripcion_trabajo: '' }, { centro_coste: '3701.02.11', pct: 50, pr: '', uf: '1', descripcion_trabajo: '' }] });
    if (!d.ok) { console.log('no se pudo sembrar el reparto', id, d); process.exit(2); }
  }
  await pg.context().close();
}

console.log('\nR1 · agrupar por equipo y deshacer reparto (tarjetas, 1440 px)');
{
  const pg = await abrir({ width: 1440, height: 900 }); sinAlert(pg);
  ok('hay 2 bloques de equipo repartido + 1 de EQA (3 grupos)', (await pg.locator('#pendientes .grupo-eq').count()) === 3, await pg.locator('#pendientes .grupo-eq').count());
  const ga = pg.locator('#pendientes .grupo-eq').filter({ hasText: 'EQA' });
  const txa = await ga.locator('.grupo-head').textContent();
  ok('cabecera de EQA: código, tipo, «2 filas» y total del día (5 + 3 = 8 h)', /EQA/.test(txa) && /BULLDOZER/.test(txa) && /2 filas/.test(txa) && /Σ 8 h/.test(txa) && !/Repartida/.test(txa), txa);
  const gr = pg.locator('#pendientes .grupo-eq.repartida').filter({ hasText: 'CT1' });
  const txr = await gr.locator('.grupo-head').textContent();
  ok('cabecera del reparto: «⑂ Repartida 50 % / 50 %» y «↩ Deshacer reparto»', /Repartida 50 % \/ 50 %/.test(txr) && /Deshacer reparto/.test(txr), txr);
  ok('un equipo con una sola fila no lleva bloque', (await pg.locator('#pendientes .grupo-eq').filter({ hasText: 'EQG' }).count()) === 0 && (await pg.locator('#pendientes .fila').filter({ hasText: 'EQG' }).count()) === 1);
  await pg.screenshot({ path: path.join(OUT, 'tarjetas_1440_grupos.png'), fullPage: true });
  await gr.locator('button:has-text("Deshacer reparto")').click();
  await pg.waitForFunction(() => document.querySelectorAll('#pendientes .grupo-eq.repartida').length === 1);
  const orig = await q('r1'), hijas = await sql`SELECT estado FROM parte_bandeja WHERE id_registro LIKE 'r1-r%'`;
  ok('la original vuelve a pendiente y las hijas quedan descartadas', orig.estado === 'pendiente' && hijas.length === 2 && hijas.every((h) => h.estado === 'descartado'), { o: orig.estado, h: hijas });
  ok('la bandeja se recarga: CT1 es una sola tarjeta pendiente', (await pg.locator('#pendientes .fila').filter({ hasText: 'CT1' }).count()) === 1);
  // la original descartada de CT2 (con [Repartido en 2 filas]) también lleva el botón, en «Revisadas»
  await pg.locator('#revisadasBox summary').click();
  ok('«Revisadas»: la original descartada de CT2 lleva «↩ Deshacer reparto»', (await pg.locator('#revisadas .fila').filter({ hasText: 'Repartido en 2' }).locator('button:has-text("Deshacer reparto")').count()) === 0
    ? (await pg.locator('#revisadas button:has-text("Deshacer reparto")').count()) >= 1 : true);
  // error del servidor visible tal cual
  const d = await post(pg, { mod: 'parte', op: 'deshacer_reparto', id_registro: 'g1' });
  ok('deshacer un parte que no es reparto devuelve error del servidor', d.ok === false && !!d.error, d);
  await pg.context().close();
}

console.log('\nR2 · Guardar vs Aprobar, «Aprobar todo» con ediciones, avisos');
{
  const pg = await abrir({ width: 1440, height: 900 }); sinAlert(pg);
  const fg = pg.locator('#pendientes .fila').filter({ hasText: 'EQG' });
  ok('sin cambios: botón «✓ Aprobar» y sin «Guardar»', (await fg.locator('.btn-aprobar').textContent()).trim() === '✓ Aprobar' && await fg.locator('.btn-guardar').isHidden());
  await elegirCC(pg, fg.locator('.cc-pick'), '3702.03.01');
  ok('con el CC editado: «✓ Guardar y aprobar», aparece «💾 Guardar» y la marca «cambios sin guardar»',
    /Guardar y aprobar/.test(await fg.locator('.btn-aprobar').textContent()) && await fg.locator('.btn-guardar').isVisible() && await fg.locator('.sin-guardar').isVisible());
  // cambiar de día con cambios: confirm; cancelar mantiene la fecha
  let msg = ''; pg.removeAllListeners('dialog'); pg.once('dialog', (d) => { msg = d.message(); d.dismiss(); });
  await pg.fill('#fecha', H); await pg.locator('#fecha').dispatchEvent('change'); await pg.waitForTimeout(400);
  ok('cambiar de fecha con ediciones pregunta y, al cancelar, vuelve a la misma fecha', /cambios sin guardar/.test(msg) && (await pg.inputValue('#fecha')) === D, { msg, f: await pg.inputValue('#fecha') });
  sinAlert(pg);
  await fg.locator('.btn-aprobar').click();
  await pg.waitForFunction(() => !document.getElementById('fila-g1') || !document.getElementById('fila-g1').closest('#pendientes'));
  const g1 = await q('g1');
  ok('«Guardar y aprobar»: la fila queda aprobada con el CC nuevo (3702.03.01) y UF 2', g1.estado === 'aprobado' && g1.centro_coste === '3702.03.01' && String(g1.uf) === '2', g1);
  ok('el toast dice «Guardado y aprobado»', /Guardado y aprobado/.test(await toast(pg)), await toast(pg));
  // Aprobar todo lo sin alertas lleva las ediciones; avisa de las que no entran
  const fh = pg.locator('#pendientes .fila').filter({ hasText: 'EQH' });
  await elegirCC(pg, fh.locator('.cc-pick'), '3701.05.04');
  const fb = pg.locator('#pendientes .fila').filter({ hasText: 'EQB' });
  await elegirCC(pg, fb.locator('.cc-pick'), '3701.05.04');   // b1 tiene alerta SIN_CC: no entra en «sin alertas»
  let conf = ''; pg.removeAllListeners('dialog'); pg.once('dialog', (d) => { conf = d.message(); d.accept(); });
  await pg.click('#btnAprobarTodo');
  await pg.waitForFunction(() => !document.querySelector('#pendientes #fila-h1'));
  const h1 = await q('h1'), b1 = await q('b1');
  ok('«Aprobar todo lo sin alertas» guardó el CC editado de EQH', h1.estado === 'aprobado' && h1.centro_coste === '3701.05.04', h1);
  ok('el confirm avisa de la fila con cambios que NO entra (EQB, con alerta) y esta sigue pendiente sin guardar', /NO entran/.test(conf) && b1.estado === 'pendiente' && b1.centro_coste === '' && (await pg.locator('#fila-b1.dirty').count()) === 1, conf);
  await pg.context().close();
}

console.log('\nR3 · CC escrito a mano');
await reponer();
{
  const pg = await abrir({ width: 1440, height: 900 }); sinAlert(pg);
  const fb = pg.locator('#pendientes .fila').filter({ hasText: 'EQB' });
  await fb.locator('.cc-pick').click();
  ok('el selector trae siempre «✍ Escribir otro CC…»', await pg.locator('.cc-pop .cc-otro').isVisible());
  await pg.locator('.cc-pop .cc-q').fill('3700,04.01');
  ok('un texto que no es ningún CC se ofrece como «Usar «…» como centro de coste»', /Usar «3700,04\.01» como centro de coste/.test(await pg.locator('.cc-pop .cc-libre').textContent()));
  await pg.locator('.cc-pop .cc-q').press('Enter');
  const btn = fb.locator('.cc-pick');
  ok('queda 3700.04.01 (coma → punto) y el botón dice «(escrito a mano)»', (await btn.getAttribute('value')) === '3700.04.01' && /\(escrito a mano\)/.test(await btn.textContent()), await btn.textContent());
  await pg.locator('.cc-pop .cc-otro').count();
  await fb.locator('.btn-guardar').click(); await pg.waitForFunction(() => !document.querySelector('#fila-b1.dirty'));
  ok('el servidor guardó el CC a mano en la fila', (await q('b1')).centro_coste === '3700.04.01');
  // «Escribir otro CC…» lleva el foco al buscador con ayuda
  await fb.locator('.cc-pick').click(); await pg.locator('.cc-pop .cc-otro').dispatchEvent('mousedown');
  ok('«✍ Escribir otro CC…» pone el foco en el buscador con el ejemplo', /3700\.04\.01 o 37P1/.test(await pg.locator('.cc-pop .cc-q').getAttribute('placeholder')) && await pg.evaluate(() => document.activeElement.classList.contains('cc-q')));
  await pg.keyboard.press('Escape');
  // en el modal Repartir
  await pg.locator('#pendientes .fila').filter({ hasText: 'EQG' }).count();
  const fa = pg.locator('#pendientes .fila').filter({ hasText: 'CT1' });
  await fa.locator('button:has-text("Repartir")').click(); await pg.waitForSelector('#modalRep:not(.hidden)');
  await elegirCC(pg, pg.locator('#rpFilas .cc-pick').nth(1), '37P1.2');
  ok('modal Repartir: acepta 37P1.2 como CC de la segunda fila', (await pg.locator('#rpFilas .cc-pick').nth(1).getAttribute('value')) === '37P1.2' && !(await pg.locator('#rpGuardar').isDisabled()));
  await pg.click('#modalRep button:has-text("Cancelar")');
  // en el parte manual
  await pg.locator('#faltantes .falt').filter({ hasText: 'EQE' }).locator('button').click(); await pg.waitForSelector('#modal:not(.hidden)');
  await elegirCC(pg, pg.locator('#m_cc'), '3701.I0408');
  ok('parte manual: acepta 3701.I0408', (await pg.locator('#m_cc').getAttribute('value')) === '3701.I0408');
  await pg.click('#modal button:has-text("Cancelar")');
  await pg.context().close();
}

console.log('\nR4/R5 · CC sugerido y alertas');
await reponer();
{
  const pg = await abrir({ width: 1440, height: 900 }); sinAlert(pg);
  ok('la bandeja trae cc_sugerido por código (EQB → 3701.05.04 del 29-sep)', await pg.evaluate(() => BAND.cc_sugerido && BAND.cc_sugerido.EQB && BAND.cc_sugerido.EQB.centro_coste === '3701.05.04' && BAND.cc_sugerido.EQB.fecha === '2026-09-29'));
  const fb = pg.locator('#pendientes .fila').filter({ hasText: 'EQB' });
  ok('fila sin CC: chip «Usar 3701.05.04 · último CC (29-sep)»', (await fb.locator('.chip-sug').textContent()).trim() === 'Usar 3701.05.04 · último CC (29-sep)');
  await pg.screenshot({ path: path.join(OUT, 'tarjetas_1440_sugerido.png'), fullPage: false });
  await fb.locator('.chip-sug').click();
  ok('el chip pone el CC como edición (sin guardar) y desaparece', (await fb.locator('.cc-pick').getAttribute('value')) === '3701.05.04' && await fb.locator('.fila.dirty, .dirty').count() >= 0 && await fb.locator('.chip-sug').count() === 0 && /Guardar y aprobar/.test(await fb.locator('.btn-aprobar').textContent()));
  ok('SIN_CC acortado y CC_SUGERIDO definido', await pg.evaluate(() => ALERTA_TXT.SIN_CC.length < 80 && /Día sin operación: el CC salió del último parte/.test(ALERTA_TXT.CC_SUGERIDO)));
  // R5: aprobar con CC «Disponible» lo rechaza el servidor y el error se muestra
  const fc = pg.locator('#pendientes .fila').filter({ hasText: 'EQC' });
  await fc.locator('.btn-aprobar').click(); await pg.waitForSelector('.toast.err');
  ok('aprobar con CC «Disponible»: toast con el error del servidor', /disponible\/festivo sin centro de coste/.test(await toast(pg)), await toast(pg));
  ok('y la fila sigue pendiente', (await q('c1')).estado === 'pendiente');
  await pg.context().close();
}

console.log('\nR6/R7 · día sin operación con CC por equipo');
await reponer();
{
  const pg = await abrir({ width: 1440, height: 900 }); sinAlert(pg);
  const intro = (await pg.locator('#cardFalt .intro').first().textContent()).trim();
  ok('R7: la intro de «Equipos sin parte» es una línea', intro === 'Vigentes en la flota sin parte este día. Márcalos y ciérralos con el motivo.', intro);
  ok('R7: el tipo largo no se corta con «…» (se envuelve)', await pg.evaluate(() => { const t = [...document.querySelectorAll('#faltantes .falt .tipo')].find((x) => /RETROEXCAVADORA/.test(x.textContent)); return !!t && getComputedStyle(t).textOverflow !== 'ellipsis' && getComputedStyle(t).whiteSpace === 'normal'; }));
  await pg.click('#sinopBar .motivos button:has-text("Lluvia")'); await pg.waitForSelector('#modalSinOp:not(.hidden)');
  const cc = async (i) => pg.locator('#so_cc_' + i).getAttribute('value');
  const lista = await pg.locator('#soLista .so-eq b').allTextContents();
  const iD = lista.indexOf('EQD'), iE = lista.indexOf('EQE');
  ok('una fila por equipo con selector de CC; EQD precargado con su último CC y EQE vacío', lista.length === 3 && (await cc(iD)) === '3701.02.07' && (await cc(iE)) === '', lista);
  await pg.screenshot({ path: path.join(OUT, 'sinop_1440_modal.png'), fullPage: false });
  let dlg = ''; pg.removeAllListeners('dialog'); pg.once('dialog', (d) => { dlg = d.message(); d.accept(); });
  await pg.click('#soGuardar');
  ok('sin CC en algún equipo no guarda: avisa y marca en rojo ese selector', /centro de coste de/.test(dlg) && await pg.locator('#so_cc_' + iE + '.falta').count() === 1 && (await sql`SELECT 1 FROM parte_bandeja WHERE codigo='EQE'`).length === 0, dlg);
  sinAlert(pg);
  await elegirCC(pg, pg.locator('#so_cc_' + iE), '3702.03.01');
  const iF = lista.indexOf('EQF'); await elegirCC(pg, pg.locator('#so_cc_' + iF), '3700.04.01');   // a mano
  await pg.fill('#so_med_' + iE, '10'); await pg.fill('#so_med_' + iF, '20');   // equipos sin último final: se escribe
  await pg.click('#soGuardar'); await pg.waitForFunction(() => document.getElementById('modalSinOp').classList.contains('hidden'), null, { timeout: 15000 });
  const fs3 = await sql`SELECT codigo, centro_coste, descripcion_trabajo, estado, reporte_num, alertas FROM parte_bandeja WHERE codigo IN ('EQD','EQE','EQF') AND fecha=${D} ORDER BY codigo`;
  ok('3 filas creadas con su CC real (EQD 3701.02.07, EQE 3702.03.01, EQF 3700.04.01 a mano), descripción = motivo, sin nº de parte', fs3.length === 3 && fs3[0].centro_coste === '3701.02.07' && fs3[1].centro_coste === '3702.03.01' && fs3[2].centro_coste === '3700.04.01' && fs3.every((r) => r.descripcion_trabajo === 'Disponible por lluvia' && !r.reporte_num), fs3);
  ok('quedan aprobadas de una vez', fs3.every((r) => r.estado === 'aprobado'), fs3.map((r) => r.estado));
  await pg.context().close();
  // Taller: sin CC real, sigue mandando «Taller»
  await sql`DELETE FROM parte_bandeja WHERE codigo IN ('EQE','EQF') AND fecha=${D}`;
  const pt = await abrir({ width: 1440, height: 900 }); sinAlert(pt);
  await pt.locator('#faltantes .falt').filter({ hasText: 'EQE' }).locator('input[type=checkbox]').count();
  await pt.evaluate(() => { selFaltantes(false); toggleFalt('EQE', true); pintarSel(); });
  await pt.click('#sinopBar .motivos button:has-text("Taller")'); await pt.waitForSelector('#modalSinOp:not(.hidden)');
  ok('Taller: el modal no pide CC', (await pt.locator('#soLista .cc-pick').count()) === 0);
  await pt.fill('#so_med_0', '10');
  await pt.click('#soGuardar'); await pt.waitForFunction(() => document.getElementById('modalSinOp').classList.contains('hidden'), null, { timeout: 15000 });
  const te = (await sql`SELECT centro_coste, descripcion_trabajo, estado FROM parte_bandeja WHERE codigo='EQE' AND fecha=${D}`)[0];
  ok('fila de Taller con centro_coste «Taller» (sin CC real), aprobada', te && te.centro_coste === 'Taller' && te.descripcion_trabajo === 'Taller' && te.estado === 'aprobado', te);
  await pt.context().close();
}

console.log('\nR8 · Hoja (1600 px)');
{
  await reponer();
  const pg = await abrir({ width: 1600, height: 1000 }, { vista: 'hoja' }); sinAlert(pg);
  await pg.waitForSelector('#gridHoja td.cq-c');
  ok('PC: por defecto abre la Hoja y ofrece «Hoja | Tarjetas»', await pg.locator('#panelHoja').isVisible() && await pg.locator('#segVista').isVisible() && await pg.locator('#pendientes .fila').count() === 0);
  const nPend = await pg.evaluate(() => BAND.pendientes.length);
  ok('la hoja trae todos los pendientes del día (una fila por parte)', (await pg.locator('#gridHoja tbody tr').count()) === nPend, { n: nPend, filas: await pg.locator('#gridHoja tbody tr').count() });
  ok('contenedor a ancho completo (sin el máximo de 1280)', await pg.evaluate(() => document.querySelector('.container').getBoundingClientRect().width > 1500));
  ok('columnas pedidas presentes', await pg.evaluate(() => ['Estado', 'Equipo', 'Tipo', 'Operador', 'De', 'A', 'Jornada', 'Inicial', 'Final', 'Total', 'Centro de coste', 'UF', 'PR', 'Descripción', 'Observaciones', 'Alertas', 'Nº parte', 'Varada', 'Lluvia', 'Recibido'].every((n) => COLS_HOJA.some((c) => c.etiqueta === n))));
  ok('separación por equipo y reparto identificable (clases del motor)', await pg.locator('#gridHoja tr.cq-dia').count() >= 3 && await pg.locator('#gridHoja tr.h-reparto').count() >= 2);
  await pg.screenshot({ path: path.join(OUT, 'hoja_1600.png'), fullPage: false });
  // seleccionar la fila de EQB (sin CC): ficha con continuidad, alerta y chip
  const ri = async (cod) => pg.evaluate((c) => GP.visibles().findIndex((r) => r.codigo === c), cod);
  const celda = (r, k) => pg.locator('#gridHoja td.cq-c[data-r="' + r + '"][data-c="' + COLS_IDX[k] + '"]');
  const COLS_IDX = await pg.evaluate(() => { const o = {}; COLS_HOJA.forEach((c, i) => { o[c.k] = i; }); return o; });
  const rb = await ri('EQB');
  await celda(rb, 'codigo').click();
  const ficha = await pg.locator('#fichaHoja').textContent();
  ok('ficha: «Medidor: el anterior terminó en 5.000 … ✓ empalma», alerta SIN_CC explicada y chip de CC sugerido', /Medidor: el anterior terminó en/.test(ficha) && /empalma/.test(ficha) && /SIN_CC/.test(ficha) && /Usar 3701\.05\.04 · último CC \(29-sep\)/.test(ficha), ficha);
  await pg.screenshot({ path: path.join(OUT, 'hoja_1600_ficha.png'), fullPage: false });
  // clic derecho: «Usar CC sugerido»
  await celda(rb, 'codigo').click({ button: 'right' });
  await pg.locator('.cq-menu button:has-text("Usar CC sugerido")').click();
  ok('clic derecho «Usar CC sugerido»: el CC queda en azul (sin guardar) y «Guardar cambios (1)»', (await pg.evaluate((i) => GP.visibles()[i].centro_coste, rb)) === '3701.05.04' && /\(1\)/.test(await pg.locator('#bHGuardar').textContent()));
  // CC a mano en la celda
  const rg = await ri('EQG'); await celda(rg, 'centro_coste').dblclick();
  await pg.locator('#gridHoja .cq-ed').fill('37P1.03'); await pg.keyboard.press('Enter');
  ok('celda de CC acepta un valor libre (37P1.03) y muestra «(escrito a mano)»', (await pg.evaluate((i) => GP.visibles()[i].centro_coste, rg)) === '37P1.03' && /escrito a mano/.test(await celda(rg, 'centro_coste').textContent()));
  // aprobar la selección (EQB + EQG): un solo op:revisar con lo editado
  await celda(rb, 'codigo').click(); await celda(rg, 'codigo').click({ modifiers: ['Shift'] });
  const seleccion = await pg.evaluate(() => GP.marcadas().map((r) => r.codigo));
  ok('Shift marca un bloque de filas y el botón cuenta «✓ Aprobar (N)»', seleccion.length >= 2 && new RegExp('\\(' + seleccion.length + '\\)').test(await pg.locator('#bHAprobar').textContent()), seleccion);
  await pg.evaluate(() => { const v = GP.visibles(); GP.activar(v.findIndex((r) => r.codigo === 'EQB'), 0); });
  // seleccionar solo EQB y EQG con Ctrl no existe: aprobamos EQB; EQG por separado
  await celda(rb, 'codigo').click(); await pg.click('#bHAprobar');
  await pg.waitForFunction(() => !GP.visibles().some((r) => r.codigo === 'EQB'));
  const b1 = await q('b1');
  ok('«✓ Aprobar»: EQB aprobada con el CC sugerido que se había puesto', b1.estado === 'aprobado' && b1.centro_coste === '3701.05.04', b1);
  ok('lo editado en EQG (sin aprobar) sigue sin guardar en la hoja', (await pg.locator('#bHGuardar').textContent()).includes('(1)') && (await q('g1')).centro_coste === '3701.02.07');
  await pg.click('#bHGuardar'); await pg.waitForFunction(() => /\(0\)/.test(document.getElementById('bHGuardar').textContent));
  ok('«💾 Guardar cambios» guarda el CC a mano de EQG sin aprobar', (await q('g1')).centro_coste === '37P1.03' && (await q('g1')).estado === 'pendiente');
  // errores por fila: aprobar EQC con CC «Disponible» → ⚠
  const rc = await ri('EQC'); await celda(rc, 'codigo').click(); await pg.click('#bHAprobar');
  await pg.waitForSelector('.toast.err');
  const rn = await pg.locator('#gridHoja tbody tr').nth(await ri('EQC')).locator('td.cq-rn').textContent();
  ok('error del servidor: la fila queda marcada con ⚠ y el toast lo dice', /⚠/.test(rn) && /disponible\/festivo/.test(await toast(pg)), { rn, t: await toast(pg) });
  // descartar con confirm
  const rh = await ri('EQH'); await celda(rh, 'codigo').click();
  let c2 = ''; pg.removeAllListeners('dialog'); pg.once('dialog', (d) => { c2 = d.message(); d.accept(); });
  await pg.click('#bHDescartar'); await pg.waitForFunction(() => !GP.visibles().some((r) => r.codigo === 'EQH'));
  ok('«✕ Descartar» pide confirmar y descarta', /Descartar 1/.test(c2) && (await q('h1')).estado === 'descartado', c2);
  // deshacer reparto desde la hoja (CT2)
  sinAlert(pg);
  const r2 = await pg.evaluate(() => GP.visibles().findIndex((r) => r.codigo === 'CT2'));
  await celda(r2, 'codigo').click();
  ok('la fila de un reparto habilita «↩ Deshacer reparto»', !(await pg.locator('#bHDeshacerRep').isDisabled()));
  await pg.click('#bHDeshacerRep');
  await pg.waitForFunction(() => GP.visibles().filter((r) => r.codigo === 'CT2').length === 1);
  ok('hoja: reparto deshecho (la original CT2 vuelve a pendiente)', (await q('r2')).estado === 'pendiente');
  // ver revisadas
  await pg.selectOption('#selVerHoja', 'todas');
  ok('«Todas» muestra también las revisadas (aprobadas/descartadas)', await pg.evaluate(() => GP.visibles().some((r) => r.estado !== 'pendiente')));
  // cambiar a tarjetas con una edición: pasa a la tarjeta
  await pg.selectOption('#selVerHoja', 'pend');
  const ra = await ri('EQA'); await celda(ra, 'pr').dblclick(); await pg.locator('#gridHoja .cq-ed').fill('777'); await pg.keyboard.press('Enter');
  await pg.click('#segVista button[data-v="tarjetas"]');
  ok('Hoja → Tarjetas conserva la edición sin guardar (PR 777) y recuerda la vista', await pg.locator('#pendientes .fila.dirty input[data-k=pr]').first().inputValue() === '777' && await pg.evaluate(() => localStorage.getItem('tm2_rev_vista')) === 'tarjetas');
  await pg.click('#segVista button[data-v="hoja"]');
  ok('Tarjetas → Hoja devuelve la edición a la hoja', await pg.evaluate(() => GP.pendientes().length) === 1);
  // beforeunload
  ok('con ediciones sin guardar el navegador avisa al salir (hayCambios)', await pg.evaluate(() => hayCambios()));
  await pg.context().close();

  // «Aprobar todo lo sin alertas» en la hoja
  await sql`UPDATE parte_bandeja SET estado='pendiente', revisado_por='' WHERE id_registro='h1'`;
  const p2 = await abrir({ width: 1600, height: 1000 }, { vista: 'hoja' }); sinAlert(p2);
  await p2.waitForSelector('#gridHoja td.cq-c');
  await p2.click('#btnAprobarTodo'); await p2.waitForFunction(() => !GP.visibles().some((r) => r.codigo === 'EQH'));
  ok('«Aprobar todo lo sin alertas» también funciona en la hoja', (await q('h1')).estado === 'aprobado');
  await p2.context().close();

  // 1366 y tema oscuro
  const p3 = await abrir({ width: 1366, height: 768 }, { vista: 'hoja', tema: 'oscuro' });
  await p3.waitForSelector('#gridHoja td.cq-c');
  await p3.screenshot({ path: path.join(OUT, 'hoja_1366_oscuro.png'), fullPage: false });
  ok('1366 px: la hoja no desborda la página', await p3.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await p3.context().close();
}

console.log('\nCelular (390 px): tarjetas, sin hoja; modal día sin operación; tema oscuro');
await reponer();
{
  const pg = await abrir({ width: 390, height: 844 }, { vista: 'hoja', tema: 'oscuro' });
  ok('en celular no se ofrece la Hoja (aunque la preferencia sea Hoja)', await pg.locator('#panelHoja').isHidden() && await pg.locator('#segVista').isHidden() && await pg.locator('#pendientes .fila').count() > 0);
  ok('390 px: sin desborde horizontal', await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await pg.screenshot({ path: path.join(OUT, 'tarjetas_390_oscuro.png'), fullPage: false });
  await pg.locator('#pendientes .grupo-eq').first().scrollIntoViewIfNeeded();
  await pg.screenshot({ path: path.join(OUT, 'tarjetas_390_grupo.png'), fullPage: false });
  await sql`DELETE FROM parte_bandeja WHERE codigo IN ('EQD','EQE','EQF') AND fecha=${D}`;
  await fecha(pg, H); await fecha(pg, D);
  await pg.evaluate(() => { selFaltantes(true); });
  await pg.click('#sinopBar .motivos button:has-text("Domingo")'); await pg.waitForSelector('#modalSinOp:not(.hidden)');
  ok('390 px: el modal de día sin operación no desborda y trae un CC por equipo', await pg.evaluate(() => { const b = document.querySelector('#modalSinOp .modal-box'); return b.scrollWidth <= b.clientWidth + 1; }) && await pg.locator('#soLista .cc-pick').count() === 3);
  await pg.screenshot({ path: path.join(OUT, 'sinop_390_oscuro.png'), fullPage: false });
  await pg.context().close();
}

ok('cero errores de consola ni violaciones de CSP en todo el recorrido', errores.length === 0, errores.slice(0, 5));
await browser.close(); servidor.close();
console.log('\n' + (fallos ? '✗ ' + fallos + ' de ' + casos + ' casos FALLAN' : '✓ ' + casos + ' casos pasan') + '  · capturas en ' + OUT);
process.exit(fallos ? 1 : 0);
