#!/usr/bin/env node
/**
 * donde_aparece.js — dónde aparece un valor de catálogo en el repo (código de máquina, nombre de
 * actividad, CC, origen, usuario o rol), agrupado por capa. Sirve para no olvidar ninguna copia al dar
 * de alta, cambiar o dar de baja algo. Solo lee.
 *
 *   node donde_aparece.js "<texto>" [más textos…] [--exacto] [--docs] [--repo=<raíz>]
 *     --exacto   distingue mayúsculas/tildes (por defecto no)
 *     --docs     incluye docs/ (por defecto solo código, pruebas, semillas y herramientas)
 *
 * Ej.: node donde_aparece.js RT-02            node donde_aparece.js "Terraplén de UF3" "02.07"
 *      node donde_aparece.js residente_dren    node donde_aparece.js Masivo2 "19+800" 19800
 */
'use strict';
const fs = require('fs'), path = require('path');
const args = [], opt = {};
process.argv.slice(2).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) opt[m[1]] = m[2] === undefined ? true : m[2]; else args.push(a); });
if (!args.length) { console.error('Uso: node donde_aparece.js "<texto>" [--exacto] [--docs]'); process.exit(2); }
function buscarRepo(){
  if (opt.repo) return path.resolve(opt.repo);
  for (const i of [__dirname, process.cwd()]) { let d = i; for (let k = 0; k < 8; k++) { if (fs.existsSync(path.join(d, 'docs', '05_CATALOGO.md'))) return d; const p = path.dirname(d); if (p === d) break; d = p; } }
  throw new Error('No encuentro la raíz del repo: --repo=');
}
const REPO = buscarRepo();
const OMITIR = new Set(['node_modules', '.git', 'vendor', 'fonts', 'icons', 'img', 'worktrees', 'skills']);
const EXT = /\.(js|mjs|gs|html|css|sql|py|csv|tsv|md|json|toml)$/i;
const sinTildes = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = s => opt.exacto ? s : sinTildes(s).toLowerCase();
const agujas = args.map(norm);

function capa(rel){
  if (rel.startsWith('docs/')) return '9 docs (cierre: tm2-cierre-tema)';
  if (/^backend\/pruebas\/|^worker\/pruebas\//.test(rel)) return '6 arneses y semillas de prueba';
  if (/^backend\/seeds\/|^backend\/volcado\//.test(rel)) return '7 semillas / volcado (datos iniciales)';
  if (/^backend\/.*\.gs$/.test(rel)) return '5 Apps Script .gs (CONGELADOS: no se editan salvo decisión)';
  if (/^worker\/sql\//.test(rel)) return '3 SQL / migraciones (Supabase)';
  if (/^worker\//.test(rel)) return '2 Worker (backend vivo → wrangler deploy)';
  if (/^(Reparto_Produccion|conciliador\/)/.test(rel)) return '4 herramientas de escritorio (reparto / conciliador)';
  if (/^(tools|qr)\//.test(rel)) return '8 herramientas / QR';
  if (rel.endsWith('.md')) return '9 otros .md';
  return '1 frontend (pantallas → publicar Pages)';
}
const hallazgos = {};
(function recorrer(dir){
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (OMITIR.has(f.name) || (f.name.startsWith('.') && f.name !== '.claude')) continue;
    const abs = path.join(dir, f.name), rel = path.relative(REPO, abs).split(path.sep).join('/');
    if (f.isDirectory()) { if (rel === '.claude') continue; recorrer(abs); continue; }
    if (!EXT.test(f.name) || fs.statSync(abs).size > 3e6) continue;
    if (rel.startsWith('docs/') && !opt.docs) continue;
    const lineas = fs.readFileSync(abs, 'utf8').split('\n');
    lineas.forEach((l, i) => {
      const n = norm(l);
      if (agujas.some(a => n.indexOf(a) >= 0)) (hallazgos[capa(rel)] = hallazgos[capa(rel)] || []).push(rel + ':' + (i + 1) + '  ' + l.trim().slice(0, 140));
    });
  }
})(REPO);
const capas = Object.keys(hallazgos).sort();
if (!capas.length) { console.log('Sin apariciones de ' + args.join(' · ') + (opt.docs ? '' : ' (fuera de docs/; usa --docs)') + '.'); process.exit(0); }
let total = 0;
capas.forEach(c => { console.log('\n## ' + c.slice(2) + '  (' + hallazgos[c].length + ')'); hallazgos[c].slice(0, 60).forEach(h => console.log('  ' + h)); if (hallazgos[c].length > 60) console.log('  … ' + (hallazgos[c].length - 60) + ' más'); total += hallazgos[c].length; });
console.log('\n' + total + ' apariciones. Los DATOS vivos (Supabase: base_items, maquinas, parte_equipos, parte_items, usuarios, cubicaje…) no están en el repo: revísalos en la base (solo lectura).');
