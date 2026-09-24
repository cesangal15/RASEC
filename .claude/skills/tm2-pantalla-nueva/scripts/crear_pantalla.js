#!/usr/bin/env node
/**
 * crear_pantalla.js — crea <nombre>.html/.js/.css en la raíz del repo desde las plantillas del skill.
 * NUNCA sobrescribe un archivo existente. La CSP se copia de una pantalla real (la más común del repo),
 * no de una copia guardada en el skill.
 *
 *   node crear_pantalla.js --nombre=mi-pantalla --titulo="Mi pantalla" --etiqueta="Obra · Residente"
 *                          --roles=admin,residente [--modulo=obra|asistencias|parte] [--accion=<action GET>]
 *                          [--decision=D2xx] [--repo=<raíz>]
 * Después: node verificar_pantalla.js --nombre=mi-pantalla
 */
'use strict';
const fs = require('fs'), path = require('path');
const args = {};
process.argv.slice(2).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });
if (!args.nombre || !args.titulo || !args.roles) { console.error('Uso: --nombre= --titulo= --roles=a,b [--etiqueta= --modulo=obra --accion= --decision=]'); process.exit(2); }
if (!/^[a-z0-9-]+$/.test(args.nombre)) { console.error('--nombre: minúsculas, números y guiones (como las demás pantallas).'); process.exit(2); }

function buscarRepo(){
  if (args.repo) return path.resolve(args.repo);
  for (const i of [__dirname, process.cwd()]) { let d = i; for (let k = 0; k < 8; k++) { if (fs.existsSync(path.join(d, 'tema.js')) && fs.existsSync(path.join(d, 'auth.js'))) return d; const p = path.dirname(d); if (p === d) break; d = p; } }
  throw new Error('No encuentro la raíz del repo (tema.js + auth.js): --repo=');
}
const REPO = buscarRepo();
function cspMasComun(){
  const cuenta = {};
  fs.readdirSync(REPO).filter(f => f.endsWith('.html')).forEach(f => {
    const m = fs.readFileSync(path.join(REPO, f), 'utf8').match(/Content-Security-Policy" content="([^"]*)"/);
    if (m) cuenta[m[1]] = (cuenta[m[1]] || 0) + 1;
  });
  return Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0][0];
}
const rep = {
  __NOMBRE__: args.nombre, __TITULO__: args.titulo, __ETIQUETA__: args.etiqueta || 'TM2 Sur',
  __ROLES__: String(args.roles).split(',').map(r => "'" + r.trim() + "'").join(','),
  __MODULO__: args.modulo || 'obra', __ACCION__: args.accion || 'ping', __DECISION__: args.decision || 'D???', __CSP__: cspMasComun()
};
const ASSETS = path.join(__dirname, '..', 'assets');
let creados = 0;
for (const ext of ['html', 'js', 'css']) {
  const dest = path.join(REPO, args.nombre + '.' + ext);
  if (fs.existsSync(dest)) { console.error('✗ Ya existe ' + path.relative(REPO, dest) + ': no se toca.'); continue; }
  let t = fs.readFileSync(path.join(ASSETS, 'plantilla.' + ext), 'utf8');
  for (const [k, v] of Object.entries(rep)) t = t.split(k).join(v);
  fs.writeFileSync(dest, t); creados++;
  console.log('✓ ' + path.relative(REPO, dest));
}
console.log(creados ? '\nSiguiente: node ' + path.relative(REPO, path.join(__dirname, 'verificar_pantalla.js')) + ' --nombre=' + args.nombre + '  y el checklist de references/checklist_alta.md' : '');
process.exit(creados ? 0 : 1);
