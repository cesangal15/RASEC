#!/usr/bin/env node
/**
 * deriva.js — checklist de DERIVA del cierre: mira qué archivos cambió la rama (git diff contra la base) y
 * dice qué documento o skill hay que actualizar en el MISMO commit de cierre. Solo lee.
 *
 *   node deriva.js [--base=origin/main] [--archivos=a,b,c] [--repo=<raíz>] [--json]
 *   (sin git, p. ej. en el chat del Project: --archivos=<lista de archivos tocados>)
 *
 * Reglas (derivadas de CLAUDE.md «Documentación al cerrar» y del checklist de tm2-cierre-tema):
 *   pantalla nueva o cuyo acceso cambia → fila en la tabla «Pantallas y roles» de 04
 *   sw.js con PRECACHE distinto        → CACHE_V subido (PROJECT_CONTEXT · Offline)
 *   endpoint/action nuevo en el Worker  → 04 (sección del módulo) + contrato + OPERACIONES si hay despliegue
 *   worker/sql/0NN_*.sql nuevo          → pasos de despliegue (OPERACIONES) + respaldo/vuelta atrás
 *   listas de catálogo tocadas         → 05 (tm2-catalogo)
 *   Reparto_Produccion_Maquinaria.*    → revisar el skill tm2-reparto-produccion (y correr probar_reparto.js)
 *   conciliador/*                      → revisar el skill tm2-conciliador (y correr probar_conciliador.js)
 *   .claude/skills/*                   → lista de skills en CLAUDE.md
 *   docs/ fuera de 02/03/PROJECT_CONTEXT(/04/05 por deriva) → no se toca (CLAUDE.md)
 */
'use strict';
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const args = {};
process.argv.slice(2).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });
function buscarRepo(){
  if (args.repo) return path.resolve(args.repo);
  for (const i of [__dirname, process.cwd()]) { let d = i; for (let k = 0; k < 8; k++) { if (fs.existsSync(path.join(d, 'docs', '04_ARQUITECTURA.md'))) return d; const p = path.dirname(d); if (p === d) break; d = p; } }
  return process.cwd();
}
const REPO = buscarRepo();
const leer = f => { try { return fs.readFileSync(path.join(REPO, f), 'utf8'); } catch (e) { return ''; } };
const base = args.base || 'origin/main';
let archivos, diff = '';
if (args.archivos) archivos = String(args.archivos).split(',').map(s => s.trim()).filter(Boolean);
else {
  try {
    const mb = execSync('git merge-base HEAD ' + base, { cwd: REPO, encoding: 'utf8' }).trim();
    archivos = execSync('git diff --name-only ' + mb, { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean)
      .concat(execSync('git ls-files --others --exclude-standard', { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean));
    diff = execSync('git diff ' + mb + ' -- sw.js worker/src', { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) { console.error('No pude leer el diff de git (' + e.message.split('\n')[0] + '). Usa --archivos=a,b,c'); process.exit(2); }
}
archivos = [...new Set(archivos)];
const d04 = leer('docs/04_ARQUITECTURA.md');
const items = [];
const add = (nivel, que, porque) => items.push({ nivel, que, porque });

// Pantallas
const pantallas = archivos.filter(f => /^[^/]+\.(html|js|css)$/.test(f)).map(f => f.replace(/\.(html|js|css)$/, ''))
  .filter((v, i, a) => a.indexOf(v) === i && fs.existsSync(path.join(REPO, v + '.html')));
pantallas.forEach(p => {
  const nueva = !d04.includes('`' + p + '.html`');
  if (nueva) add('OBLIGATORIO', '04 · fila de `' + p + '.html` en «Pantallas y roles»', 'la pantalla no aparece en la tabla');
  else add('REVISAR', '04 · fila de `' + p + '.html`', 'se tocó la pantalla: ¿cambió quién entra o qué hace?');
});
// sw.js
if (archivos.includes('sw.js')) {
  const precacheCambio = /^[+-]\s+'\.\/.*'/m.test(diff) || /^[+-].*PRECACHE/m.test(diff);
  const cacheSubido = /^\+.*const CACHE_V/m.test(diff);
  if (precacheCambio && !cacheSubido) add('OBLIGATORIO', 'sw.js · subir CACHE_V', 'cambió la lista de precache y CACHE_V no');
  else add('REVISAR', 'sw.js', 'si un archivo del precache cambió de forma que los HTML nuevos dependen de él, sube CACHE_V (PROJECT_CONTEXT · Offline)');
}
// Worker: actions/ops nuevos
const nuevasAcciones = [...diff.matchAll(/^\+.*\b(?:a|action|op)\s*===\s*'([a-z_]+)'/gm)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i);
nuevasAcciones.forEach(a => { if (!d04.includes(a)) add('OBLIGATORIO', '04 · documentar la action/op `' + a + '` y su contrato', 'endpoint nuevo en el Worker que 04 no menciona'); });
if (archivos.some(f => f.startsWith('worker/src/'))) add('OBLIGATORIO', 'pasos de despliegue: `wrangler deploy` (formato de docs/OPERACIONES.md)', 'cambió el Worker');
archivos.filter(f => /^worker\/sql\/\d{3}_.*\.sql$/.test(f)).forEach(f => add('OBLIGATORIO', 'pasos de despliegue: aplicar `' + path.basename(f) + '` (orden respecto de wrangler/Pages) + respaldo y vuelta atrás', 'migración SQL nueva o cambiada'));
if (archivos.some(f => /^[^/]+\.(html|js|css)$/.test(f) || f === 'sw.js' || f.startsWith('tablero/') || f.startsWith('conciliador/'))) add('OBLIGATORIO', 'pasos de despliegue: publicar Pages (merge a main, con autorización)', 'cambió el frontend');
// Catálogo
const CAT = [/^reporte-capataz\.js$/, /^encargado\.js$/, /^reporte-chequeadora\.(js|html)$/, /^digitadora\.js$/, /^worker\/src\/catalogos\.js$/,
  /^worker\/src\/api\/asistencias\/areas\.js$/, /^worker\/src\/api\/parte\.js$/, /^index\.js$/, /^seleccion-reporte\.js$/, /^menu\.html$/, /^flota\.js$/, /^produccion-maquinaria\.js$/];
const cat = archivos.filter(f => CAT.some(r => r.test(f)));
if (cat.length) add('REVISAR', '05 · ¿cambió actividad, máquina, origen, CC, usuario, rol o áreas? → bloque de 05 con tm2-catalogo', 'se tocaron listas de catálogo: ' + cat.join(', '));
// Herramientas con skill propio
if (archivos.some(f => /^Reparto_Produccion_Maquinaria\./.test(f))) add('OBLIGATORIO', 'skill tm2-reparto-produccion: revisar references/funcionamiento.md y correr scripts/probar_reparto.js', 'cambió la herramienta del reparto');
if (archivos.some(f => f.startsWith('conciliador/'))) add('OBLIGATORIO', 'skill tm2-conciliador: revisar references/funcionamiento.md y correr scripts/probar_conciliador.js', 'cambió el conciliador');
if (archivos.some(f => f.startsWith('.claude/skills/'))) add(archivos.includes('CLAUDE.md') ? 'REVISAR' : 'OBLIGATORIO', 'CLAUDE.md · lista de skills con su clase [A]/[B]' + (archivos.includes('CLAUDE.md') ? ' (CLAUDE.md ya cambió en la rama: confirma que la lista está al día)' : ''), 'se añadieron o cambiaron skills');
// Docs
const docsTocados = archivos.filter(f => f.startsWith('docs/'));
docsTocados.filter(f => !/docs\/(02_REGISTRO_DECISIONES|03_BACKLOG|PROJECT_CONTEXT|04_ARQUITECTURA|05_CATALOGO)\.md$/.test(f))
  .forEach(f => add('OBLIGATORIO', 'deshacer el cambio en ' + f, 'CLAUDE.md: al cerrar solo se tocan 02/03/PROJECT_CONTEXT (y 04/05 por deriva)'));
if (!docsTocados.includes('docs/02_REGISTRO_DECISIONES.md')) add('REVISAR', '02 · ¿hubo decisión? → fila nueva (node siguiente.js --plantilla)', 'no se tocó el registro');
if (!docsTocados.includes('docs/03_BACKLOG.md')) add('REVISAR', '03 · estado del ítem (✅ Hecho / pendiente de desplegar)', 'no se tocó el backlog');
add('REVISAR', 'PROJECT_CONTEXT · ¿regla nueva que todo el que trabaje deba saber?', 'solo reglas, no historia');

if (args.json) { console.log(JSON.stringify({ archivos, items }, null, 2)); process.exit(0); }
console.log('Archivos de la rama (' + archivos.length + '): ' + (archivos.length > 12 ? archivos.slice(0, 12).join(', ') + ', …' : archivos.join(', ')));
console.log('\nChecklist de deriva:');
items.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'OBLIGATORIO' ? -1 : 1))
  .forEach(i => console.log('  [' + (i.nivel === 'OBLIGATORIO' ? '!' : '?') + '] ' + i.que + '\n        ↳ ' + i.porque));
