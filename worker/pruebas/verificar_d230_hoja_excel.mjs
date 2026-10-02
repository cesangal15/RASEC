#!/usr/bin/env node
/**
 * Verificación D230 — comodidades de Excel comunes (hoja-excel.js) en las TRES cuadrículas editables, contra el Worker REAL.
 *
 * Levanta, como verificar_d228_revision_pantalla.mjs, Postgres en memoria (PGlite) con el esquema real + el Worker real + las
 * pantallas del repo en un mismo puerto, y recorre con Chromium (Playwright):
 *
 *   D  Revisión de DATA (data.html): barra de fórmulas (ver y editar, Ctrl+Z), barra de estado (recuento / suma), Ctrl+Enter
 *      sobre la selección, controlador de relleno (arrastre y doble clic), pegar repetido, marco de copia, Ctrl+X mueve,
 *      selección por encabezado / nº de fila / esquina (el clic ya no ordena), ▾: filtrar cualquier columna (y el filtro del
 *      motor en Actividad), ordenar, inmovilizar, ajustar texto, autoajustar y ancho por defecto, Ctrl+;, Shift+Enter,
 *      Tab… Enter, F2 con el cursor al final, Alt+↓ y Guardar de verdad.
 *   C  Catálogos (catalogos.html): barras, filtro de columna propio que no se hereda al cambiar de tabla, la clave sin mostrar
 *      ni editar en la barra, relleno + Guardar (cat_guardar).
 *   R  Revisión de partes (revision-maquinaria.html): Hoja con ⌨ y atajos propios, encabezado que selecciona sin ordenar,
 *      ▾ con el filtro del motor, relleno del CC y «Guardar cambios (N)», Ctrl+Enter sin editar sigue aprobando; Base sin
 *      desborde de página con la barra de estado; celular sin desborde; tema oscuro.
 *   y: cero errores de consola ni violaciones de CSP.
 *
 *   NODE_PATH=<node_modules con playwright-core> CHROME=<ruta de Chrome/Edge> node worker/pruebas/verificar_d230_hoja_excel.mjs
 *   (CAPTURAS=<carpeta> guarda las capturas)
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
const OUT = process.env.CAPTURAS || path.join(os.tmpdir(), 'd230-capturas'); fs.mkdirSync(OUT, { recursive: true });

let fallos = 0, casos = 0;
const ok = (n, c, x) => { casos++; if (!c) { fallos++; console.log('  ✗ ' + n + (x !== undefined ? '  → ' + (typeof x === 'string' ? x : JSON.stringify(x)) : '')); } else console.log('  ✓ ' + n); };

/* ---------- Worker real + Postgres en memoria ---------- */
const { sql } = await abrirPglite();
for (const f of fs.readdirSync(SQL_DIR).filter((x) => /^0\d+_.*\.sql$/.test(x)).sort()) await sql.exec(fs.readFileSync(path.join(SQL_DIR, f), 'utf8'));
await semillar(sql, semillas(), {});

// Partes para la revisión (mismo patrón que D228)
const D = '2026-09-30';
const EQUIPOS = [['EQA', 'BULLDOZER', 'HOROMETRO'], ['EQB', 'VOLQUETA', 'KM'], ['EQG', 'EXCAVADORA', 'HOROMETRO'], ['EQH', 'CARGADOR', 'HOROMETRO']];
await sql`DELETE FROM maquinas WHERE obra_id='tm2sur'`;
for (const [c, t] of EQUIPOS) await sql`INSERT INTO maquinas (obra_id,id_maquina,tipo,horas_prog,propiedad,fecha_ingreso,fecha_retiro,notas,frente,grupo) VALUES ('tm2sur',${c},${t},6.4,'propia','2026-01-01',null,'','UF1-UF2','tierras')`;
for (const [c, t, m] of EQUIPOS) { await sql`DELETE FROM parte_equipos WHERE obra_id='tm2sur' AND codigo=${c}`; await sql`INSERT INTO parte_equipos (obra_id,codigo,tipo,placa,proveedor,medidor,activo) VALUES ('tm2sur',${c},${t},'PLK'||${c},'',${m},'SI')`; }
for (const [cc, d] of [['3701.02.07', 'Terraplén UF1'], ['3701.02.11', 'Cargue UF1'], ['3702.03.01', 'Subbase granular UF2']])
  await sql`INSERT INTO parte_cc (obra_id,centro_coste,proyecto,descripcion_cc,usos_ult_4_meses,activo) VALUES ('tm2sur',${cc},${cc.slice(0, 4)},${d},10,'SI') ON CONFLICT DO NOTHING`;
await sql`DELETE FROM parte_bandeja WHERE obra_id='tm2sur'`;
let nts = 0;
async function parte(o) {
  const eq = EQUIPOS.find((e) => e[0] === o.c), tot = Math.round((o.fi - o.i) * 100) / 100;
  await sql`INSERT INTO parte_bandeja (obra_id,id_registro,"timestamp",estado,fecha,codigo,tipo,placa,medidor,reporte_num,inicial,final,total,inicial_modificado,horas_varada,horas_lluvia,hora_de,hora_a,descripcion_trabajo,centro_coste,pr,uf,operador,observaciones,alertas,revisado_por,revisado_ts,origen,firma,firma_huella)
    VALUES ('tm2sur',${o.id},${'2026-09-30T1' + (nts++ % 10) + ':00:00Z'},${o.e || 'pendiente'},${o.f || D},${o.c},${eq[1]},${'PLK' + o.c},${eq[2]},${o.rn},${o.i},${o.fi},${tot},'NO',null,null,'07:00','16:00',${o.d || 'Trabajo de prueba'},${o.cc},null,${o.uf || '1'},'Operador Uno','','','',null,'qr','','')`;
}
await parte({ id: 'a1', c: 'EQA', i: 100, fi: 108, cc: '3701.02.07', rn: '8001' });
await parte({ id: 'b1', c: 'EQB', i: 5000, fi: 5120, cc: '3701.02.11', rn: '8002' });
await parte({ id: 'g1', c: 'EQG', i: 200, fi: 208, cc: '3701.02.07', rn: '8003' });
await parte({ id: 'h1', c: 'EQH', i: 300, fi: 308, cc: '3701.02.07', rn: '8004' });
for (let i = 0; i < 6; i++) await parte({ id: 'ap' + i, c: EQUIPOS[i % 4][0], f: '2026-09-2' + (i % 3 + 1), i: 1000 + i * 10, fi: 1008 + i * 10, e: 'aprobado', cc: '3701.02.07', rn: '70' + i });

// 2.500 filas de DATA (25 días × 100) para medir un relleno largo (D230: el lote refresca una vez, no por celda)
await sql`INSERT INTO data (obra_id, fecha, grupo, centro_de_costo, capitulo, descripcion, unidad_funcional, proyecto, elemento, abs_inicial, abs_final, liberacion, acta, unidad_medida, largo, espesor, fc, cantidad, observacion, id_registro, area, clima)
  SELECT 'tm2sur', DATE '2020-03-01' + (g % 25), 'TIERRAS', '3701.02.05', 'EXPLANACIONES', 'Excavación en material común', 'UF1', '3701', 'tm2 pk 10+000 - 11+000', '10000', '11000', 'CAMPO', '', 'm3', 10, 1, 1.3, 7.69, 'obs ' || g, 'perf-' || g, 'tierras', 'Soleado' FROM generate_series(1, 2500) g`;

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
async function abrir(pagina, vp, opt = {}) {
  const c = await browser.newContext({ viewport: vp, serviceWorkers: 'block' });
  await c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await c.addInitScript(([v, t]) => { try { if (localStorage.getItem('tm2_rev_vista') === null) localStorage.setItem('tm2_rev_vista', v); if (localStorage.getItem('tm2_tema') === null) localStorage.setItem('tm2_tema', t); } catch (e) {} }, [opt.vista || 'hoja', opt.tema || 'claro']);
  const pg = await c.newPage();
  pg.on('pageerror', (e) => errores.push(pagina + ': ' + String(e)));
  pg.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errores.push(pagina + ': ' + m.text()); });
  pg.on('dialog', (d) => d.accept());
  await pg.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  if (SESION) await c.addInitScript((s) => { try { for (const k in s) localStorage.setItem(k, s[k]); } catch (e) {} }, SESION);
  else {
    await pg.goto(BASE + '/index.html');
    await pg.fill('#usuario', 'admin'); await pg.fill('#clave', '1234'); await pg.keyboard.press('Enter');
    await pg.waitForFunction(() => !!localStorage.getItem('tm2_token'));
    SESION = await pg.evaluate(() => ({ usuario: localStorage.getItem('usuario'), rol: localStorage.getItem('rol'), tm2_token: localStorage.getItem('tm2_token') }));
    await pg.waitForLoadState('load');
  }
  await pg.goto(BASE + '/' + pagina);
  return pg;
}
const toast = async (pg) => (await pg.locator('.toast').textContent().catch(() => '')) || '';
async function pegarTxt(pg, t) {
  await pg.evaluate((x) => { const dt = new DataTransfer(); dt.setData('text/plain', x); (document.activeElement || document).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, t);
}
async function arrastrarAsa(pg, scope, destino) {
  const b = await pg.locator(scope + ' td.hx-asa').boundingBox();
  await pg.mouse.move(b.x + b.width - 1, b.y + b.height - 1); await pg.mouse.down();
  const d = await destino.boundingBox();
  await pg.mouse.move(d.x + d.width / 2, d.y + d.height / 2, { steps: 8 }); await pg.mouse.up();
}
async function solo(pg, texto) { const l = texto ? pg.locator('.hx-cmenu label.hx-cm-op').filter({ hasText: texto }).first() : pg.locator('.hx-cmenu label.hx-cm-op').first(); await l.hover(); await l.locator('button.solo').click(); }
async function dobleClicAsa(pg, scope) { const b = await pg.locator(scope + ' td.hx-asa').boundingBox(); await pg.mouse.dblclick(b.x + b.width - 1, b.y + b.height - 1); }

/* ======================= D · Revisión de DATA ======================= */
console.log('\nD · Revisión de DATA (data.html, 1440 px)');
{
  const pg = await abrir('data.html', { width: 1440, height: 900 });
  await pg.waitForFunction(() => typeof HX !== 'undefined' && !!HX);
  await pg.fill('#desde', '2020-01-20'); await pg.fill('#hasta', '2020-01-30');
  await pg.evaluate(() => consultar());
  await pg.waitForFunction(() => VIS.length > 5);
  const N = await pg.evaluate(() => VIS.length);
  const IDX = await pg.evaluate(() => { const o = {}; COLS.forEach((c, i) => { o[c.k] = i; }); return o; });
  const cel = (r, k) => pg.locator('#cuerpo td.cell[data-r="' + r + '"][data-c="' + IDX[k] + '"]');
  const v = (r, k) => pg.evaluate(([r, k]) => VIS[r] ? String(VIS[r][k] == null ? '' : VIS[r][k]) : null, [r, k]);
  const rng = () => pg.evaluate(() => rango());
  const fx = pg.locator('.hx-formula'), nom = pg.locator('.hx-nombre'), pie = pg.locator('.hx-pie');

  ok('barra de fórmulas justo encima de la hoja y barra de estado debajo', await pg.evaluate(() => { const w = document.getElementById('wrap'); return w.previousElementSibling.classList.contains('hx-barra') && w.nextElementSibling.classList.contains('hx-pie'); }));
  ok('un ▾ en cada encabezado de columna (no en # ni en ✕)', (await pg.locator('#cab th .hx-cm').count()) === Object.keys(IDX).length, await pg.locator('#cab th .hx-cm').count());

  // Barra de fórmulas: ver y editar
  await cel(0, 'observacion').click();
  ok('cuadro de nombre «Fila 1 · Observación» y el valor completo en fx', (await nom.textContent()) === 'Fila 1 · ' + (await pg.evaluate((i) => COLS[i].etiqueta, IDX.observacion)) && (await fx.inputValue()) === await v(0, 'observacion'), [await nom.textContent(), await fx.inputValue()]);
  const obs0 = await v(0, 'observacion');
  const LARGO = 'Texto largo escrito en la barra de fórmulas para comprobar que se ve y se guarda completo, sin «…»';
  await fx.click(); await fx.fill(LARGO); await fx.press('Enter');
  ok('Enter en la barra fija el valor en la celda y baja una fila', (await v(0, 'observacion')) === LARGO && (await pg.evaluate(() => act.r)) === 1);
  ok('la fila queda «sin guardar» (Guardar habilitado)', await pg.evaluate(() => !document.getElementById('btnGuardar').disabled));
  await cel(0, 'observacion').click();
  ok('la barra muestra el texto largo entero', (await fx.inputValue()) === LARGO);
  await pg.keyboard.press('Control+z');
  ok('Ctrl+Z deshace lo escrito en la barra', (await v(0, 'observacion')) === obs0);
  await cel(2, 'observacion').click(); await pg.keyboard.type('abc');
  ok('lo que se teclea en la celda se ve a la vez en la barra', (await fx.inputValue()) === 'abc');
  await fx.click();
  ok('editando en la celda, clic en la barra: confirma la celda y el foco queda en la barra', (await v(2, 'observacion')) === 'abc' && await fx.evaluate((e) => document.activeElement === e));
  await pg.keyboard.press('Escape'); await pg.keyboard.press('Control+z');
  ok('Esc en la barra vuelve a la hoja y Ctrl+Z deshace lo de la celda', (await v(2, 'observacion')) !== 'abc' && await pg.evaluate(() => document.activeElement.id === 'wrap'));

  // Barra de estado: recuento / suma de lo marcado
  await cel(0, 'largo').click(); await cel(2, 'largo').click({ modifiers: ['Shift'] });
  const suma = await pg.evaluate(() => [0, 1, 2].reduce((s, i) => s + (Number(String(VIS[i].largo).replace(',', '.')) || 0), 0));
  const st = await pie.textContent();
  ok('barra de estado: «Recuento 3» y «Suma» de Largo (es-CO)', /Recuento\s*3/.test(st) && st.indexOf('Suma ' + suma.toLocaleString('es-CO', { maximumFractionDigits: 2 })) >= 0, st);
  ok('el cuadro de nombre dice «3F × 1C»', (await nom.textContent()) === '3F × 1C');

  // Ctrl+Enter: lo escrito va a toda la selección
  await cel(1, 'observacion').click(); await cel(3, 'observacion').click({ modifiers: ['Shift'] });
  const antes = [await v(1, 'observacion'), await v(2, 'observacion'), await v(3, 'observacion')];
  await pg.keyboard.type('xyz'); await pg.keyboard.press('Control+Enter');
  ok('Ctrl+Enter escribe «xyz» en las 3 celdas marcadas', (await v(1, 'observacion')) === 'xyz' && (await v(2, 'observacion')) === 'xyz' && (await v(3, 'observacion')) === 'xyz');
  await pg.keyboard.press('Control+z');
  ok('un solo Ctrl+Z las devuelve', (await v(1, 'observacion')) === antes[0] && (await v(2, 'observacion')) === antes[1] && (await v(3, 'observacion')) === antes[2]);

  // Controlador de relleno: arrastre
  await cel(0, 'observacion').click(); await fx.click(); await fx.fill('AAA'); await fx.press('Enter');
  await cel(0, 'observacion').click();
  ok('el cuadrito de relleno aparece en la esquina de la selección', (await pg.locator('#cuerpo td.hx-asa').count()) === 1 && (await pg.locator('#cuerpo td.hx-asa').getAttribute('data-r')) === '0');
  await arrastrarAsa(pg, '#cuerpo', cel(2, 'observacion'));
  ok('arrastrar el cuadrito hasta la fila 3 copia «AAA» en las filas 2 y 3', (await v(1, 'observacion')) === 'AAA' && (await v(2, 'observacion')) === 'AAA' && (await v(3, 'observacion')) !== 'AAA');
  ok('queda marcado lo rellenado (3F × 1C)', JSON.stringify(await rng()) === JSON.stringify({ r0: 0, r1: 2, c0: IDX.observacion, c1: IDX.observacion }), await rng());
  await pg.keyboard.press('Control+z'); await pg.keyboard.press('Control+z');

  // Controlador de relleno: doble clic (hasta el final del bloque de la columna vecina)
  const elem2 = await v(2, 'elemento');
  await cel(2, 'elemento').click();
  await dobleClicAsa(pg, '#cuerpo');
  const nIguales = await pg.evaluate(([e, k]) => VIS.slice(2).filter((r) => r[k] === e).length, [elem2, 'elemento']);
  ok('doble clic en el cuadrito rellena hasta la última fila (la UF de al lado no tiene huecos)', nIguales === N - 2, { nIguales, esperado: N - 2 });
  await pg.keyboard.press('Control+z');
  ok('y Ctrl+Z lo deshace de una vez', (await pg.evaluate(([e, k]) => VIS.slice(2).filter((r) => r[k] === e).length, [elem2, 'elemento'])) < N - 2);

  // Pegar repetido sobre la selección
  await cel(0, 'observacion').click(); await cel(3, 'observacion').click({ modifiers: ['Shift'] });
  await pegarTxt(pg, 'Q');
  ok('pegar un valor sobre 4 celdas lo repite en las 4', (await v(0, 'observacion')) === 'Q' && (await v(1, 'observacion')) === 'Q' && (await v(2, 'observacion')) === 'Q' && (await v(3, 'observacion')) === 'Q');
  await cel(0, 'observacion').click(); await cel(3, 'observacion').click({ modifiers: ['Shift'] });
  await pegarTxt(pg, 'A\nB\n');
  ok('pegar un bloque de 2 filas sobre 4 lo repite: A, B, A, B', (await v(0, 'observacion')) === 'A' && (await v(1, 'observacion')) === 'B' && (await v(2, 'observacion')) === 'A' && (await v(3, 'observacion')) === 'B');
  await pg.keyboard.press('Control+z'); await pg.keyboard.press('Control+z');
  // Fechas pegadas como las deja Excel (día/mes/año) → AAAA-MM-DD; lo que no es fecha no se escribe
  const f1 = await v(1, 'fecha');
  await cel(1, 'fecha').click(); await pegarTxt(pg, '25/01/2020');
  ok('pegar «25/01/2020» en Fecha guarda 2020-01-25', (await v(1, 'fecha')) === '2020-01-25', await v(1, 'fecha'));
  await pg.keyboard.press('Control+z');
  await cel(1, 'fecha').click(); await pegarTxt(pg, 'mañana');
  ok('pegar un texto que no es fecha no toca la celda y lo avisa', (await v(1, 'fecha')) === f1 && /fecha u hora válida/.test(await toast(pg)), await toast(pg));
  // Pegar una celda vacía copiada en la hoja vacía el destino (Excel)
  const vacia = await pg.evaluate(() => VIS.findIndex((r) => !String(r.observacion || '').trim()));
  await cel(vacia, 'observacion').click(); await pg.keyboard.press('Control+c');
  await cel(0, 'observacion').click(); await pegarTxt(pg, '');
  ok('copiar una celda vacía y pegarla vacía el destino', (await v(0, 'observacion')) === '');
  await pg.keyboard.press('Control+z');
  ok('…y Ctrl+Z la devuelve', (await v(0, 'observacion')) === obs0);
  await pg.keyboard.press('Escape');

  // Marco de copia
  await cel(0, 'largo').click(); await cel(1, 'espesor').click({ modifiers: ['Shift'] });
  await pg.keyboard.press('Control+c');
  ok('Ctrl+C dibuja el marco punteado y la barra de estado pide el destino', await pg.locator('#wrap .hx-marco').isVisible() && /Ctrl\+V/.test(await pg.locator('.hx-modo').textContent()));
  const portapapeles = await pg.evaluate(() => navigator.clipboard.readText());
  ok('lo copiado es TSV de 2×2 (crudo)', portapapeles.split('\n').length === 2 && portapapeles.split('\n')[0].split('\t').length === 2, portapapeles);
  await pg.keyboard.press('Escape');
  ok('Esc quita el marco', await pg.locator('#wrap .hx-marco').isHidden());

  // Ctrl+X: se mueve al pegar
  await cel(5, 'observacion').click(); await fx.click(); await fx.fill('MOVER'); await fx.press('Enter');
  await cel(5, 'observacion').click(); await pg.keyboard.press('Control+x');
  await pg.waitForTimeout(150);
  ok('Ctrl+X copia y marca para mover', (await pg.evaluate(() => navigator.clipboard.readText())) === 'MOVER' && await pg.locator('#wrap .hx-marco.hx-corte').isVisible());
  await cel(6, 'observacion').click(); await pegarTxt(pg, 'MOVER');
  ok('al pegar, el valor queda en el destino y el origen se vacía', (await v(6, 'observacion')) === 'MOVER' && (await v(5, 'observacion')) === '');
  await pg.keyboard.press('Control+z');
  ok('Ctrl+Z deshace el movimiento entero', (await v(5, 'observacion')) === 'MOVER' && (await v(6, 'observacion')) !== 'MOVER');
  await pg.keyboard.press('Control+z');

  // Selección por encabezado / nº de fila / esquina; el clic en el encabezado ya no ordena
  const orden0 = await pg.evaluate(() => VIS.map((r) => r._key).join(','));
  await pg.locator('#cab th[data-hx-c="' + IDX.observacion + '"]').click({ position: { x: 12, y: 10 } });
  ok('clic en el encabezado marca la columna entera', JSON.stringify(await rng()) === JSON.stringify({ r0: 0, r1: N - 1, c0: IDX.observacion, c1: IDX.observacion }) && (await nom.textContent()) === N + 'F × 1C', await rng());
  ok('…y no ordena (mismo orden de filas, sin ▲)', (await pg.evaluate(() => VIS.map((r) => r._key).join(','))) === orden0 && (await pg.evaluate(() => ordCol)) === -1);
  ok('el encabezado de la columna marcada queda resaltado', await pg.locator('#cab th.hx-cab-sel').count() === 1);
  await pg.locator('#cuerpo tr[data-r="2"] td.rownum:not(.acc)').click();
  ok('clic en el nº de fila marca la fila entera', JSON.stringify(await rng()) === JSON.stringify({ r0: 2, r1: 2, c0: 0, c1: Object.keys(IDX).length - 1 }), await rng());
  await pg.locator('#cuerpo tr[data-r="4"] td.rownum:not(.acc)').click({ modifiers: ['Shift'] });
  ok('Shift+clic en otro nº de fila amplía a las filas 3–5', (await rng()).r0 === 2 && (await rng()).r1 === 4 && (await pg.locator('#cuerpo td.hx-rn-sel').count()) === 3);
  ok('los nº de fila marcados se resaltan también en las filas pares (cebreado)', await pg.evaluate(() => Array.from(document.querySelectorAll('#cuerpo td.hx-rn-sel')).every((td) => /gradient/.test(getComputedStyle(td).backgroundImage))));
  await pg.locator('#cab th.hx-esquina').click();
  ok('la esquina «#» marca todo', JSON.stringify(await rng()) === JSON.stringify({ r0: 0, r1: N - 1, c0: 0, c1: Object.keys(IDX).length - 1 }));

  // ▾: filtrar una columna sin filtro propio (Fecha)
  await pg.locator('#cab th[data-hx-c="' + IDX.fecha + '"] .hx-cm').click();
  ok('▾ abre el menú de la columna con ordenar, filtro con casillas y más', await pg.locator('.hx-cmenu').isVisible() && (await pg.locator('.hx-cmenu label.hx-cm-op').count()) >= 5 && (await pg.locator('.hx-cmenu button[data-a="fijar"]').count()) === 1,
    await pg.evaluate(() => { const m = document.querySelector('.hx-cmenu'); return { oculto: m.hidden, n: m.querySelectorAll('label').length, html: m.innerHTML.slice(0, 300) }; }).then((x) => JSON.stringify(x) + ' errores=' + JSON.stringify(errores.slice(0, 3))).catch((e) => String(e)));
  await pg.screenshot({ path: path.join(OUT, 'data_menu_columna.png') });
  await solo(pg, '2020-01-21');
  const fechas = await pg.evaluate(() => Array.from(new Set(VIS.map((r) => r.fecha))));
  ok('«solo» 2020-01-21: quedan solo las filas de ese día', fechas.length === 1 && fechas[0] === '2020-01-21', fechas);
  ok('el encabezado muestra el embudo y la barra de estado «N de M filas»', await pg.locator('#cab th.hx-filtrado').count() === 1 && /\d+ de \d+ filas/.test(await pie.textContent()));
  ok('«Mostrar/Ocultar filtros» cuenta ese filtro', /Ocultar filtros|Mostrar filtros/.test(await pg.locator('#btnFiltrosToggle').textContent()) && (await pg.evaluate(() => filtrosAplicadosN())) === 1);
  await pg.locator('.hx-cmenu .hx-cm-acc button[data-f="nada"]').click();
  ok('«Quitar filtro» vuelve a todas', (await pg.evaluate(() => VIS.length)) === N && (await pg.locator('#cab th.hx-filtrado').count()) === 0);
  await pg.keyboard.press('Escape');

  // ▾ en Actividad usa el filtro del motor (el de la barra)
  await pg.locator('#cab th[data-hx-c="' + IDX.descripcion + '"] .hx-cm').click();
  await solo(pg, 'Excavación en material común');
  ok('en Actividad el ▾ maneja el MISMO filtro de la barra (D196)', await pg.evaluate(() => FSEL.fAct.size === 1 && FSEL.fAct.has('Excavación en material común')) && await pg.locator('#fAct.activo').count() === 1);
  await pg.keyboard.press('Escape');
  await pg.evaluate(() => limpiarFiltros());
  ok('«Limpiar filtros» quita todos', (await pg.evaluate(() => VIS.length)) === N);

  // ▾: ordenar
  await pg.locator('#cab th[data-hx-c="' + IDX.largo + '"] .hx-cm').click();
  await pg.locator('.hx-cmenu button[data-a="desc"]').click();
  const maxL = await pg.evaluate(() => Math.max.apply(null, VIS.map((r) => Number(r.largo) || 0)));
  ok('ordenar de mayor a menor por Largo (▼ en el encabezado)', (await pg.evaluate(() => Number(VIS[0].largo))) === maxL && /▼/.test(await pg.locator('#cab th[data-hx-c="' + IDX.largo + '"]').textContent()));
  await pg.locator('#cab th[data-hx-c="' + IDX.largo + '"] .hx-cm').click();
  await pg.locator('.hx-cmenu button[data-a="sinorden"]').click();
  ok('«Quitar orden» vuelve al orden natural', (await pg.evaluate(() => ordCol)) === -1 && (await pg.evaluate(() => VIS.map((r) => r._key).join(','))) === orden0);

  // ▾: inmovilizar, ajustar texto, autoajustar, ancho por defecto
  await pg.locator('#cab th[data-hx-c="' + IDX.descripcion + '"] .hx-cm').click();
  await pg.locator('.hx-cmenu button[data-a="fijar"]').click();
  ok('inmovilizar hasta Descripción: esas columnas quedan fijas (sticky) y se recuerda', (await pg.evaluate((i) => getComputedStyle(document.querySelector('#cuerpo td.cell[data-c="' + i + '"]')).position, IDX.descripcion)) === 'sticky' && (await pg.evaluate(() => localStorage.getItem('tm2_data_fijas'))) === String(IDX.descripcion + 1));
  const x0 = await cel(0, 'fecha').boundingBox();
  await pg.evaluate(() => { document.getElementById('wrap').scrollLeft = 5000; });
  await pg.waitForTimeout(80);
  const x1 = await cel(0, 'fecha').boundingBox();
  ok('al desplazarse a la derecha la Fecha no se mueve', Math.abs(x0.x - x1.x) < 1.5, [x0.x, x1.x]);
  await pg.screenshot({ path: path.join(OUT, 'data_inmovilizada.png') });
  await pg.evaluate(() => { document.getElementById('wrap').scrollLeft = 0; });
  await pg.locator('#cab th[data-hx-c="' + IDX.fecha + '"] .hx-cm').click();
  await pg.locator('.hx-cmenu button[data-a="soltar"]').click();
  ok('«Movilizar columnas» las suelta', (await pg.evaluate(() => getComputedStyle(document.querySelector('#cuerpo td.cell[data-c="0"]')).position)) !== 'sticky');

  await pg.locator('#cab th[data-hx-c="' + IDX.observacion + '"] .hx-cm').click();
  await pg.locator('.hx-cmenu button[data-a="ajustar"]').click();
  ok('«Ajustar texto» parte el texto en varias líneas en esa columna', (await pg.evaluate((i) => getComputedStyle(document.querySelector('#cuerpo td.cell[data-c="' + i + '"] .cv')).whiteSpace, IDX.observacion)) === 'normal');
  await pg.locator('#cab th[data-hx-c="' + IDX.observacion + '"] .hx-cm').click();
  await pg.locator('.hx-cmenu button[data-a="ajustar"]').click();

  await pg.locator('#cab th[data-hx-c="' + IDX.capitulo + '"] .rz').dblclick();
  const w = await pg.evaluate(() => ANCHOS.capitulo);
  ok('doble clic en el borde: Capítulo ajustado al contenido (y guardado)', typeof w === 'number' && w > 120 && w < 400 && /capitulo/.test(await pg.evaluate(() => localStorage.getItem('tm2_data_anchos'))), w);
  await pg.locator('#cab th[data-hx-c="' + IDX.capitulo + '"] .hx-cm').click();
  await pg.locator('.hx-cmenu button[data-a="anchodef"]').click();
  ok('«Ancho por defecto» lo devuelve', (await pg.evaluate(() => ANCHOS.capitulo)) === undefined);

  // Teclado
  await cel(0, 'fecha').click(); await pg.keyboard.press('Control+;');
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  ok('Ctrl+; pone la fecha de hoy en la columna Fecha', (await v(0, 'fecha')) === hoy, await v(0, 'fecha'));
  await pg.keyboard.press('Control+z');
  await cel(3, 'observacion').click(); await pg.keyboard.type('k'); await pg.keyboard.press('Shift+Enter');
  ok('Shift+Enter confirma y sube', (await v(3, 'observacion')) === 'k' && (await pg.evaluate(() => act.r)) === 2);
  await pg.keyboard.press('Control+z');
  await cel(0, 'largo').click(); await pg.keyboard.type('7'); await pg.keyboard.press('Tab'); await pg.keyboard.type('1'); await pg.keyboard.press('Tab'); await pg.keyboard.type('1'); await pg.keyboard.press('Enter');
  ok('Tab, Tab, Enter: vuelve a la columna donde empezó, en la fila siguiente', (await pg.evaluate(() => act.r)) === 1 && (await pg.evaluate(() => act.c)) === IDX.largo && (await v(0, 'largo')) === '7', await pg.evaluate(() => act));
  for (let i = 0; i < 3; i++) await pg.keyboard.press('Control+z');
  await cel(0, 'observacion').click(); await pg.keyboard.press('F2');
  ok('F2 abre la celda con el cursor al final (no selecciona todo)', await pg.evaluate(() => { const e = document.querySelector('#cuerpo .editor'); return !!e && e.selectionStart === e.value.length && e.selectionEnd === e.value.length; }));
  ok('mientras se edita, la barra de estado dice «Modificar»', (await pg.locator('.hx-modo').textContent()) === 'Modificar');
  await pg.keyboard.press('Escape');
  await cel(0, 'clima').click(); await pg.keyboard.press('Alt+ArrowDown');
  ok('Alt+↓ abre la lista de la celda (Clima)', await pg.evaluate(() => { const e = document.querySelector('#cuerpo .editor'); return !!e && e.tagName === 'SELECT'; }));
  await pg.keyboard.press('Escape');

  // Guardar de verdad
  const id0 = await pg.evaluate(() => VIS[0].id_registro);
  await cel(0, 'observacion').click(); await fx.click(); await fx.fill('GUARDADO-D230'); await fx.press('Enter');
  await pg.click('#btnGuardar');
  await pg.waitForFunction(() => document.getElementById('btnGuardar').disabled);
  const enBD = (await sql`SELECT observacion FROM data WHERE id_registro=${id0}`)[0];
  ok('Guardar manda lo editado en la barra al servidor', enBD && enBD.observacion === 'GUARDADO-D230', enBD);
  await pg.screenshot({ path: path.join(OUT, 'data_1440.png') });
  await pg.context().close();

  // Relleno largo: 2.500 filas con doble clic en el cuadrito (antes, cada celda repasaba toda la hoja)
  const pp = await abrir('data.html', { width: 1440, height: 900 });
  await pp.fill('#desde', '2020-03-01'); await pp.fill('#hasta', '2020-03-25'); await pp.evaluate(() => consultar());
  await pp.waitForFunction(() => VIS.length >= 2500, null, { timeout: 60000 });
  const iObs = await pp.evaluate(() => COLS.findIndex((c) => c.k === 'observacion'));
  await pp.locator('#cuerpo td.cell[data-r="0"][data-c="' + iObs + '"]').click();
  await pp.locator('.hx-formula').click(); await pp.locator('.hx-formula').fill('PERF'); await pp.locator('.hx-formula').press('Enter');
  await pp.locator('#cuerpo td.cell[data-r="0"][data-c="' + iObs + '"]').click();
  // Referencia de ESTA máquina: pintar la hoja entera una vez (sin virtualizar, 2.500 filas pesan). El relleno largo no
  // debe costar más que eso con holgura; antes de D230 cada celda recorría toda la hoja (cuadrático).
  const base = await pp.evaluate(() => { const a = performance.now(); pintar(); void document.body.offsetHeight; return Math.round(performance.now() - a); });
  if (process.env.PERF) {
    const medirSel = () => pp.evaluate((c) => new Promise((ok) => { const a = performance.now(); marcar(VIS.length - 1, c, 0, c); void document.body.offsetHeight; requestAnimationFrame(() => requestAnimationFrame(() => { const t = Math.round(performance.now() - a); marcar(0, 0, 0, 0); requestAnimationFrame(() => ok(t)); })); }), iObs);
    const conHx = await medirSel();
    const sinHx = await pp.evaluate(() => { window.__hxSel = HX.alSeleccionar; HX.alSeleccionar = function () {}; return 1; }).then(medirSel);
    await pp.evaluate((c) => { HX.alSeleccionar = window.__hxSel; marcar(0, c, 0, c); }, iObs);
    console.log('   [perf] marcar 2.500 filas de una columna: con hoja-excel', conHx, 'ms · sin', sinHx, 'ms');
  }
  const tope = Math.max(2500, Math.round(base * 1.6));
  if (process.env.PERF) console.log('   [perf] pintar() completo + layout:', base, 'ms · tope', tope, 'ms');
  if (process.env.PERF) await pp.evaluate(() => { window.__ev = []; const t0 = performance.now(); ['mousedown', 'mouseup', 'click', 'dblclick'].forEach((n) => document.addEventListener(n, () => window.__ev.push(n + '@' + Math.round(performance.now() - t0)), true)); const ad = window.actualizarDirty; window.actualizarDirty = function () { const r = ad.apply(this, arguments); window.__ev.push('dirty@' + Math.round(performance.now() - t0)); return r; }; });
  if (process.env.PERF) await pp.evaluate(() => { window.__t = {}; ['pushUndo', 'aplicaSel', 'pintarKPIs', 'actualizarDirty', 'setValor', 'refrescarFila', 'marcar', 'pintar'].forEach((n) => { const f = window[n]; window[n] = function () { const a = performance.now(); try { return f.apply(this, arguments); } finally { window.__t[n] = (window.__t[n] || 0) + performance.now() - a; } }; }); });
  const t0 = Date.now(); await dobleClicAsa(pp, '#cuerpo');
  await pp.waitForFunction(() => VIS.every((r) => r.observacion === 'PERF'), null, { timeout: 60000 });
  const ms = Date.now() - t0;
  if (process.env.PERF) console.log('   [perf]', JSON.stringify(await pp.evaluate(() => { const o = {}; for (const k in window.__t) o[k] = Math.round(window.__t[k]); return o; })), ' eventos:', (await pp.evaluate(() => window.__ev.join(' '))));
  ok('2.500 filas: doble clic en el cuadrito rellena todo sin costar más que repintar la hoja (' + ms + ' ms; pintar ' + base + ' ms)', ms < tope, { ms, base, tope });
  ok('…y el contador de «sin guardar» cuenta las 2.500', (await pp.locator('#nDirty').textContent()) === '2500', await pp.locator('#nDirty').textContent());
  await pp.locator('#cuerpo td.cell[data-r="0"][data-c="' + iObs + '"]').click(); await pp.locator('.hx-formula').click(); await pp.locator('.hx-formula').fill('PERF2'); await pp.locator('.hx-formula').press('Enter');
  await pp.locator('#cuerpo td.cell[data-r="0"][data-c="' + iObs + '"]').click();
  const t1 = Date.now(); await pp.keyboard.press('Control+d');
  await pp.waitForFunction(() => VIS.every((r) => r.observacion === 'PERF2'), null, { timeout: 60000 });
  const ms2 = Date.now() - t1;
  ok('Ctrl+D desde una fila (hasta el final, D196) también va por lote (' + ms2 + ' ms)', ms2 < tope, { ms2, tope });
  await pp.context().close();

  // Tema oscuro (solo captura y sin errores)
  const po = await abrir('data.html', { width: 1366, height: 768 }, { tema: 'oscuro' });
  await po.fill('#desde', '2020-01-20'); await po.fill('#hasta', '2020-01-30'); await po.evaluate(() => consultar()); await po.waitForFunction(() => VIS.length > 5);
  await po.locator('#cuerpo td.cell[data-r="1"][data-c="11"]').click(); await po.locator('#cuerpo td.cell[data-r="4"][data-c="13"]').click({ modifiers: ['Shift'] });
  await po.screenshot({ path: path.join(OUT, 'data_1366_oscuro.png') });
  ok('1366 px oscuro: sin desborde horizontal de la página', await po.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await po.context().close();
}

/* ======================= C · Catálogos ======================= */
console.log('\nC · Catálogos (catalogos.html, 1440 px)');
{
  const pg = await abrir('catalogos.html', { width: 1440, height: 900 });
  await pg.waitForFunction(() => typeof TABLAS !== 'undefined' && TABLAS.length > 0 && !!HX);
  await pg.evaluate(() => verTabla('parte_cc'));
  await pg.waitForFunction(() => TABLA === 'parte_cc' && VIS.length > 2);
  const IDX = await pg.evaluate(() => { const o = {}; COLS.forEach((c, i) => { o[c.k] = i; }); return o; });
  const N = await pg.evaluate(() => VIS.length);
  ok('barras de fórmulas y de estado alrededor de la hoja', await pg.evaluate(() => { const w = document.getElementById('wrap'); return w.previousElementSibling.classList.contains('hx-barra') && w.nextElementSibling.classList.contains('hx-pie'); }));
  ok('cabecera: # + columnas (+ acciones) intacta y con ▾', (await pg.locator('#cab th .hx-cm').count()) === Object.keys(IDX).length && (await pg.locator('#cab th').first().textContent()) === '#');
  // filtro propio en una columna cualquiera
  await pg.locator('#cab th[data-hx-c="' + IDX.descripcion_cc + '"] .hx-cm').click();
  await solo(pg, null);
  ok('▾ filtra una columna sin filtro propio (Descripción del CC)', (await pg.evaluate(() => VIS.length)) === 1 && await pg.locator('#cab th.hx-filtrado').count() === 1);
  await pg.keyboard.press('Escape');
  await pg.evaluate(() => verTabla('parte_operadores')); await pg.waitForFunction(() => TABLA === 'parte_operadores');
  await pg.evaluate(() => verTabla('parte_cc')); await pg.waitForFunction(() => TABLA === 'parte_cc' && VIS.length > 2);
  ok('al cambiar de tabla y volver, el filtro de columna no se hereda', (await pg.evaluate(() => VIS.length)) === N && await pg.locator('#cab th.hx-filtrado').count() === 0);
  // relleno + Guardar
  const cc0 = await pg.evaluate(() => VIS[0].centro_coste), cc1 = await pg.evaluate(() => VIS[1].centro_coste);
  await pg.locator('#cuerpo td.cell[data-r="0"][data-c="' + IDX.descripcion_cc + '"]').click();
  await pg.locator('.hx-formula').click(); await pg.locator('.hx-formula').fill('Descripción D230'); await pg.locator('.hx-formula').press('Enter');
  await pg.locator('#cuerpo td.cell[data-r="0"][data-c="' + IDX.descripcion_cc + '"]').click();
  await arrastrarAsa(pg, '#cuerpo', pg.locator('#cuerpo td.cell[data-r="1"][data-c="' + IDX.descripcion_cc + '"]'));
  ok('relleno: 2 filas cambiadas (Guardar 2)', (await pg.locator('#nDirty').textContent()) === '2');
  await pg.click('#btnGuardar');
  await pg.waitForFunction(() => document.getElementById('nDirty').textContent === '0');
  const bd = await sql`SELECT centro_coste, descripcion_cc FROM parte_cc WHERE centro_coste IN (${cc0}, ${cc1})`;
  ok('cat_guardar guarda las dos filas rellenadas', bd.length === 2 && bd.every((x) => x.descripcion_cc === 'Descripción D230'), bd);
  // usuarios: la clave nunca en claro en la barra
  await pg.evaluate(() => verTabla('usuarios')); await pg.waitForFunction(() => TABLA === 'usuarios' && VIS.length > 0);
  const ic = await pg.evaluate(() => COLS.findIndex((c) => c.tipo === 'clave'));
  if (ic >= 0) {
    await pg.locator('#cuerpo td.cell[data-r="0"][data-c="' + ic + '"]').click();
    ok('usuarios: la columna de clave sale de solo lectura y sin texto en la barra', await pg.locator('.hx-formula').evaluate((e) => e.readOnly && (e.value === '' || /^•+$/.test(e.value))));
    await pg.keyboard.type('secreta1');
    ok('al teclear una clave nueva en la celda, la barra muestra puntos (nunca el texto)', (await pg.locator('.hx-formula').inputValue()) === '••••••');
    await pg.keyboard.press('Escape');
    await pg.locator('#cuerpo td.cell[data-r="2"][data-c="' + ic + '"]').click({ modifiers: ['Shift'] });
    await pg.keyboard.type('igual'); await pg.keyboard.press('Control+Enter');
    ok('Ctrl+Enter sobre varias claves no escribe ninguna (la clave solo celda a celda)', (await pg.locator('#nDirty').textContent()) === '0' && /solo lectura/.test(await toast(pg)), await toast(pg));
    await pegarTxt(pg, 'pegada');
    ok('pegar sobre la columna de clave tampoco escribe', (await pg.locator('#nDirty').textContent()) === '0');
  } else ok('usuarios: tabla sin columna de clave visible (nada que esconder)', true);
  await pg.screenshot({ path: path.join(OUT, 'catalogos_1440.png') });
  await pg.context().close();
}

/* ======================= R · Revisión de partes ======================= */
console.log('\nR · Revisión de partes (revision-maquinaria.html)');
{
  const pg = await abrir('revision-maquinaria.html', { width: 1600, height: 1000 }, { vista: 'hoja' });
  await pg.waitForFunction(() => !!document.getElementById('fecha').value);
  await pg.fill('#fecha', D); await pg.locator('#fecha').dispatchEvent('change');
  await pg.waitForFunction((x) => typeof BAND !== 'undefined' && BAND.fecha === x, D);
  await pg.waitForSelector('#gridHoja td.cq-c');
  const IDX = await pg.evaluate(() => { const o = {}; COLS_HOJA.forEach((c, i) => { o[c.k] = i; }); return o; });
  const fila = async (cod) => pg.evaluate((c) => Array.from(document.querySelectorAll('#gridHoja tbody tr')).findIndex((tr) => (tr.querySelector('td[data-c]') ? Array.from(tr.querySelectorAll('td')).some((td) => td.textContent.trim() === c) : false)), cod);
  const cel = (r, k) => pg.locator('#gridHoja td.cq-c[data-r="' + r + '"][data-c="' + IDX[k] + '"]');
  ok('Hoja: barras alrededor de la cuadrícula y botón ⌨', await pg.evaluate(() => { const w = document.getElementById('gridHoja'); return w.previousElementSibling.classList.contains('hx-barra') && w.nextElementSibling.classList.contains('hx-pie'); }) && await pg.locator('#panelHoja .hx-kbd').count() === 1);
  await pg.locator('#panelHoja .hx-kbd').click();
  ok('⌨ muestra los atajos comunes y los de la revisión (Ctrl+Enter aprueba)', await pg.locator('.hx-atajos').isVisible() && /Aprueba las filas marcadas/.test(await pg.locator('.hx-atajos').textContent()) && /Ctrl\+Enter \(editando\)/.test(await pg.locator('.hx-atajos').textContent()));
  await pg.screenshot({ path: path.join(OUT, 'hoja_atajos.png') });
  await pg.keyboard.press('Escape');
  const orden0 = await pg.evaluate(() => Array.from(document.querySelectorAll('#gridHoja tbody tr')).map((tr) => tr.textContent).join('|'));
  await pg.locator('#gridHoja th[data-hx-c="' + IDX.codigo + '"]').click({ position: { x: 10, y: 10 } });
  ok('clic en «Equipo» marca la columna y no reordena', (await pg.evaluate(() => Array.from(document.querySelectorAll('#gridHoja tbody tr')).map((tr) => tr.textContent).join('|'))) === orden0 && (await pg.locator('#gridHoja td.cq-sel').count()) === 4);
  await pg.locator('#gridHoja th[data-hx-c="' + IDX.codigo + '"] .hx-cm').click();
  await solo(pg, 'EQA');
  ok('▾ en Equipo usa el filtro de la barra (hf-codigo): solo EQA', (await pg.locator('#gridHoja tbody tr').count()) === 1 && await pg.locator('#hf-codigo.activo').count() === 1);
  await pg.keyboard.press('Escape');
  await pg.locator('#filtrosHoja [data-cq=limpiar]').click();
  // relleno del CC
  const rg = await fila('EQG'), rh = await fila('EQH');
  await cel(rg, 'centro_coste').click(); await pg.locator('#panelHoja .hx-formula').click(); await pg.locator('#panelHoja .hx-formula').fill('3702.03.01'); await pg.locator('#panelHoja .hx-formula').press('Enter');
  await cel(rg, 'centro_coste').click();
  await arrastrarAsa(pg, '#gridHoja', cel(rh, 'centro_coste'));
  ok('relleno del CC de EQG a EQH: «💾 Guardar cambios (2)»', /\(2\)/.test(await pg.locator('#bHGuardar').textContent()), await pg.locator('#bHGuardar').textContent());
  await pg.click('#bHGuardar');
  await pg.waitForFunction(() => /\(0\)/.test(document.getElementById('bHGuardar').textContent));
  const g = (await sql`SELECT centro_coste FROM parte_bandeja WHERE id_registro IN ('g1','h1') ORDER BY id_registro`).map((x) => x.centro_coste);
  ok('se guardan los dos CC rellenados', g.join() === '3702.03.01,3702.03.01', g);
  // Ctrl+Enter sin editar sigue aprobando la selección
  await cel(await fila('EQH'), 'codigo').click(); await pg.keyboard.press('Control+Enter');
  await pg.waitForFunction(async () => true); await pg.waitForTimeout(600);
  ok('Ctrl+Enter (sin editar) aprueba la fila marcada, como antes', (await sql`SELECT estado FROM parte_bandeja WHERE id_registro='h1'`)[0].estado === 'aprobado');
  ok('1600 px: la página no desborda (la barra de estado cabe)', await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await pg.screenshot({ path: path.join(OUT, 'hoja_1600.png') });
  // Base: sin scroll de página con la barra de estado
  await pg.click('#tabBase');
  await pg.fill('#desde', '2026-09-20'); await pg.fill('#hasta', '2026-09-30');
  await pg.evaluate(() => cargarBase());
  await pg.waitForSelector('#gridBase td.cq-c');
  await pg.waitForTimeout(150);
  ok('Base: barras presentes y la barra de estado dentro de la ventana (sin scroll de página)', await pg.evaluate(() => { const p = document.getElementById('gridBase').nextElementSibling; return p.classList.contains('hx-pie') && p.getBoundingClientRect().bottom <= window.innerHeight; }));
  await pg.locator('#gridBase td.cq-c[data-r="0"][data-c="0"]').click(); await pg.locator('#gridBase td.cq-c[data-r="3"][data-c="0"]').click({ modifiers: ['Shift'] });
  ok('Base: cuadro de nombre «4F × 1C»', (await pg.locator('#vistaBase .hx-nombre').textContent()) === '4F × 1C');
  await pg.screenshot({ path: path.join(OUT, 'base_1600.png') });
  await pg.context().close();

  const pm = await abrir('revision-maquinaria.html', { width: 390, height: 844 }, { vista: 'hoja', tema: 'oscuro' });
  await pm.waitForFunction(() => !!document.getElementById('fecha').value);
  await pm.click('#tabBase'); await pm.waitForTimeout(300);
  ok('celular (390 px): sin desborde horizontal con las barras', await pm.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await pm.screenshot({ path: path.join(OUT, 'base_390_oscuro.png') });
  await pm.context().close();
}

ok('cero errores de consola ni violaciones de CSP en todo el recorrido', errores.length === 0, errores.slice(0, 5));
await browser.close(); servidor.close();
console.log('\n' + (fallos ? '✗ ' + fallos + ' de ' + casos + ' casos FALLAN' : '✓ ' + casos + ' casos pasan') + '  · capturas en ' + OUT);
process.exit(fallos ? 1 : 0);
