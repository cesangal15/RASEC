#!/usr/bin/env node
/**
 * buscar_sensibles.js — el repo es PÚBLICO y se sirve en tm2.galca.app: antes de cerrar, busca en los
 * archivos de la rama (o en las rutas dadas) lo que nunca debe publicarse: URLs /exec de Apps Script, IDs
 * de Google Sheets, JWT/tokens, claves de API, cadenas de conexión a Postgres, hashes de clave de 64 hex.
 * Solo lee. Código 1 si encuentra algo.
 *
 *   node buscar_sensibles.js                  # archivos cambiados respecto de origin/main
 *   node buscar_sensibles.js <ruta> [<ruta>…] # archivos o carpetas concretas (p. ej. .claude/skills)
 */
'use strict';
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const rutas = process.argv.slice(2).filter(a => !a.startsWith('--'));
const PATRONES = [
  ['URL de Apps Script', /script\.google(usercontent)?\.com\/macros\/s\/[A-Za-z0-9_-]{20,}/],
  ['ID de Google Sheet', /docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{25,}|\b1[A-Za-z0-9_-]{42,43}\b/],
  ['JWT / token firmado', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['clave de API', /\b(sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35}|sb_secret_[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{30,})/],
  ['cadena de conexión Postgres', /postgres(ql)?:\/\/[^\s'"`]*:[^\s'"`@]+@/],
  ['hash de clave (64 hex)', /\b[0-9a-f]{64}\b/],
  ['secreto asignado en claro', /\b(AUTH_SECRETO|DATABASE_URL|SERVICE_ROLE|api[_-]?key|password|clave)\s*[:=]\s*['"][^'"\s]{8,}['"]/i],
];
function listar(r){
  const abs = path.resolve(r);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isDirectory()) return fs.readdirSync(abs).filter(f => f !== 'node_modules' && f !== '.git').flatMap(f => listar(path.join(abs, f)));
  return [abs];
}
let archivos;
if (rutas.length) archivos = rutas.flatMap(listar);
else {
  try {
    const mb = execSync('git merge-base HEAD origin/main', { encoding: 'utf8' }).trim();
    archivos = execSync('git diff --name-only ' + mb, { encoding: 'utf8' }).split('\n').concat(execSync('git ls-files --others --exclude-standard', { encoding: 'utf8' }).split('\n')).filter(Boolean).filter(f => fs.existsSync(f));
  } catch (e) { console.error('Sin git: pasa rutas.'); process.exit(2); }
}
let n = 0;
for (const f of archivos) {
  if (/\.(png|jpe?g|pdf|xlsx|zip|woff2?|ttf|ico)$/i.test(f)) continue;
  const lineas = fs.readFileSync(f, 'utf8').split('\n');
  lineas.forEach((l, i) => PATRONES.forEach(([nombre, re]) => {
    if (re.test(l)) { n++; console.log('✗ ' + nombre + ' — ' + path.relative(process.cwd(), f) + ':' + (i + 1) + '  ' + l.trim().slice(0, 120)); }
  }));
}
console.log(n ? '\n✗ ' + n + ' posible(s) dato(s) sensible(s): sustitúyelos por su referencia («clave en la hoja USUARIOS», «URL en los secretos del Worker»…).' : '✓ Nada sensible en ' + archivos.length + ' archivo(s).');
process.exit(n ? 1 : 0);
