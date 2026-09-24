#!/usr/bin/env node
/**
 * verificar_pantalla.js — chequeo determinista de una pantalla contra las convenciones del proyecto
 * (D150 tema, D167 CSP + esc, D168/D169 API, D170 marca y sin JS/CSS en línea, D50 fecha, D30 POST text/plain)
 * y del checklist de alta (menu/entrada, sw.js, fila en 04). No modifica nada.
 *
 *   node verificar_pantalla.js --nombre=<pantalla sin .html> [--repo=<raíz>] [--offline]
 *     --offline  la pantalla es una captura de campo que debe abrir sin señal (exige estar en el precache)
 * Salida: ✓ / ✗ (bloquea) / ⚠ (revisar). Código 1 si hay algún ✗.
 */
'use strict';
const fs = require('fs'), path = require('path');
const args = {};
process.argv.slice(2).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });
if (!args.nombre) { console.error('Uso: node verificar_pantalla.js --nombre=<pantalla> [--offline]'); process.exit(2); }
function buscarRepo(){
  if (args.repo) return path.resolve(args.repo);
  for (const i of [__dirname, process.cwd()]) { let d = i; for (let k = 0; k < 8; k++) { if (fs.existsSync(path.join(d, 'tema.js')) && fs.existsSync(path.join(d, 'auth.js'))) return d; const p = path.dirname(d); if (p === d) break; d = p; } }
  throw new Error('No encuentro la raíz del repo: --repo=');
}
const REPO = buscarRepo(), N = args.nombre.replace(/\.html$/, '');
const leer = f => { try { return fs.readFileSync(path.join(REPO, f), 'utf8'); } catch (e) { return null; } };
let malos = 0;
const ok = (c, msg, sev) => { if (c) console.log('  ✓ ' + msg); else { console.log('  ' + (sev === 'aviso' ? '⚠ ' : '✗ ') + msg); if (sev !== 'aviso') malos++; } };

const html = leer(N + '.html'), js = leer(N + '.js'), css = leer(N + '.css');
console.log('Pantalla ' + N + '.html');
ok(html != null, 'existe ' + N + '.html');
if (html == null) process.exit(1);
ok(js != null, 'existe ' + N + '.js (D170: el JS vive fuera del HTML)');
ok(css != null, 'existe ' + N + '.css');

console.log('\nHTML');
const cuenta = {};
fs.readdirSync(REPO).filter(f => f.endsWith('.html') && f !== N + '.html').forEach(f => { const m = leer(f).match(/Content-Security-Policy" content="([^"]*)"/); if (m) cuenta[m[1]] = (cuenta[m[1]] || 0) + 1; });
const cspComun = (Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0] || [''])[0];
const csp = (html.match(/Content-Security-Policy" content="([^"]*)"/) || [])[1];
ok(!!csp, 'lleva meta Content-Security-Policy (D167)');
ok(csp === cspComun, 'CSP idéntica a la de las demás pantallas', csp && csp.indexOf("'unsafe-inline'") < 0 ? 'aviso' : undefined);
ok(!csp || csp.indexOf("'unsafe-inline'") < 0, "CSP sin 'unsafe-inline' (D170)");
const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map(m => (m[1].match(/src="([^"]*)"/) || [])[1] || '(en línea)');
ok(scripts[0] === 'auth.js', 'auth.js es el PRIMER script (D169)', undefined);
ok(scripts[1] === 'entorno.js', 'entorno.js es el segundo (D168)');
ok(scripts.includes('tema.js') && /href="tema\.css"/.test(html), 'carga tema.css y tema.js (D150)');
ok(!scripts.includes('(en línea)'), 'sin <script> en línea (D170: la CSP lo ignoraría)');
ok(!/<style\b/i.test(html), 'sin <style> en línea (D170)');
ok(!/\son[a-z]+\s*=/i.test(html), 'sin atributos on*= (usar data-on-<evento>, D170)');
ok(!/\sstyle\s*=/i.test(html), 'sin style= (usar clase o data-estilo, D170)');
ok(/family=DM\+Sans[^"]*Syne/.test(html), 'fuentes DM Sans + Syne');
ok(/class="galca-simbolo"/.test(html), 'símbolo Galca en la cabecera (D170)');
ok(/← Menú/.test(html), 'botón «← Menú»', 'aviso');
ok(/src="script\.google|script\.google\.com/.test(html) === false, 'ninguna URL de Google en el HTML (D169)');

if (js != null) {
  console.log('\nJS');
  const codigo = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const iAplicar = codigo.search(/TM2Estilos\.aplicar\(\)/), iCodigo = codigo.search(/\b(const|let|var|function)\s/);
  ok(iAplicar >= 0 && (iCodigo < 0 || iAplicar < iCodigo), 'TM2Estilos.aplicar() antes de la lógica (D170)');
  ok(!/\bfetch\(/.test(js) || /GALCA_ENV\.url\./.test(js), 'URL de la API vía GALCA_ENV (D168)');
  ok(!/https?:\/\/(api\.galca\.app|script\.google)/.test(js), 'ninguna URL de la API escrita en el .js (solo en auth.js, D169)');
  ok(/localStorage\.getItem\('rol'\)/.test(js) && /index\.html/.test(js), 'guard de rol que devuelve a index.html (D108/D109)');
  ok(!/toISOString\(\)\.(slice|substring|split)\(0/.test(js) || /toLocaleDateString\('en-CA'/.test(js), 'fecha por defecto en hora de Bogotá, no toISOString() (D50)', 'aviso');
  const posts = (js.match(/method\s*:\s*'POST'/g) || []).length;
  ok(!posts || /text\/plain/.test(js), 'POST con Content-Type text/plain (D30)');
  ok(!/innerHTML\s*[+]?=/.test(js) || /\besc\(/.test(js), 'usa esc() al pintar con innerHTML (D167)', 'aviso');
  ok(!/<[a-z][^>]*\son[a-z]+\s*=\s*\\?["']|\.setAttribute\(\s*'on[a-z]/i.test(js), 'no inyecta onclick= en el HTML generado (D170: data-on-*)');
}
if (css != null) {
  console.log('\nCSS');
  const sueltos = (css.match(/#[0-9a-fA-F]{3,6}\b/g) || []).filter(c => !/^#(fff|ffffff|000|000000)$/i.test(c));
  ok(!sueltos.length, 'sin colores sueltos: solo tokens de tema.css (D150)' + (sueltos.length ? ' → ' + [...new Set(sueltos)].join(' ') : ''), 'aviso');
}

console.log('\nChecklist de alta');
const menu = leer('menu.html') || '', sel = leer('seleccion-reporte.js') || '', res = leer('residente.html') || '', idx = leer('index.js') || '';
ok([menu, sel, res, idx].some(t => t.indexOf(N + '.html') >= 0), 'tiene entrada: tile en menu.html / seleccion-reporte.js / residente.html o destino en index.js', 'aviso');
const sw = leer('sw.js') || '';
const enPrecache = sw.indexOf("'./" + N + ".html'") >= 0;
if (args.offline) ok(enPrecache && sw.indexOf("'./" + N + ".js'") >= 0 && sw.indexOf("'./" + N + ".css'") >= 0, 'en el PRECACHE de sw.js (html+js+css) y CACHE_V subido en el mismo cambio (D82/D176)');
else ok(!enPrecache, 'fuera del precache (pantalla con señal: network-first; si debe abrir sin señal usa --offline)', 'aviso');
const a04 = leer('docs/04_ARQUITECTURA.md') || '';
ok(a04.indexOf('`' + N + '.html`') >= 0, 'fila en la tabla «Pantallas y roles» de docs/04_ARQUITECTURA.md (va en el commit de cierre)', 'aviso');

console.log(malos ? '\n✗ ' + malos + ' punto(s) que bloquean.' : '\n✓ Sin bloqueos (revisa los ⚠).');
process.exit(malos ? 1 : 0);
