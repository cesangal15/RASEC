#!/usr/bin/env node
/**
 * siguiente.js — los identificadores REALES que tocan en el cierre, leídos de los documentos (no de memoria):
 *   · siguiente decisión D de docs/02_REGISTRO_DECISIONES.md (máximo número + 1; D113b/D63a cuentan como 113/63)
 *   · siguiente ítem V3-xx y siguiente 4.xx de docs/03_BACKLOG.md
 *   · CACHE_V vigente de sw.js
 * y, con --plantilla, una fila de 02 lista para rellenar con el formato del registro.
 *
 *   node siguiente.js [--docs=<carpeta docs>] [--plantilla] [--titulo="…"] [--json]
 *   (--docs sirve en el chat del Project: apunta a donde estén 02/03 subidos)
 */
'use strict';
const fs = require('fs'), path = require('path');
const args = {};
process.argv.slice(2).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });
function buscarDocs(){
  if (args.docs) return path.resolve(args.docs);
  for (const i of [__dirname, process.cwd()]) { let d = i; for (let k = 0; k < 8; k++) { if (fs.existsSync(path.join(d, 'docs', '02_REGISTRO_DECISIONES.md'))) return path.join(d, 'docs'); const p = path.dirname(d); if (p === d) break; d = p; } }
  throw new Error('No encuentro docs/02_REGISTRO_DECISIONES.md: pasa --docs=<carpeta>');
}
const DOCS = buscarDocs();
const leer = f => { const p = path.join(DOCS, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };

const r02 = leer('02_REGISTRO_DECISIONES.md');
const ids = [...r02.matchAll(/^\|\s*D(\d+)([a-z]?)\s*\|/gm)].map(m => ({ n: +m[1], id: 'D' + m[1] + m[2] }));
const maxD = Math.max(...ids.map(x => x.n));
const r03 = leer('03_BACKLOG.md');
const v3 = [...r03.matchAll(/^\|\s*\**V3-(\d+)/gm)].map(m => +m[1]);
const cuatro = [...r03.matchAll(/^\|\s*\**4\.(\d+)/gm)].map(m => +m[1]);
const sw = fs.existsSync(path.join(DOCS, '..', 'sw.js')) ? fs.readFileSync(path.join(DOCS, '..', 'sw.js'), 'utf8') : '';
const cache = (sw.match(/const CACHE_V\s*=\s*'([^']+)'/) || [])[1] || '(sw.js no disponible)';
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const hoy = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
const mes = MESES[hoy.getMonth()] + '-' + hoy.getFullYear();

const out = {
  siguienteD: 'D' + (maxD + 1), ultimasD: ids.slice(-3).map(x => x.id), totalFilasD: ids.length,
  siguienteV3: 'V3-' + String((v3.length ? Math.max(...v3) : 0) + 1).padStart(2, '0'),
  siguiente4: '4.' + String((cuatro.length ? Math.max(...cuatro) : 0) + 1).padStart(2, '0'),
  cacheV: cache, mes
};
if (args.json) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }
console.log('Siguiente decisión : ' + out.siguienteD + '   (últimas: ' + out.ultimasD.join(', ') + ')');
console.log('Siguiente backlog  : ' + out.siguienteV3 + ' (serie V3) · ' + out.siguiente4 + ' (serie 4.xx)');
console.log('CACHE_V vigente    : ' + out.cacheV);
console.log('Mes para los sellos: ' + out.mes);
if (args.plantilla) {
  console.log('\n--- fila para 02 (append al final de la tabla; una sola línea) ---');
  console.log('| ' + out.siguienteD + ' | **' + (args.titulo || '<Título en una frase>') + ' — ' + out.mes + '.** <Enmienda/Amplía Dxx si aplica.> ' +
    '<Contexto: pedido del dueño o problema observado, con fecha.> **Decisión:** <qué se decidió, en concreto; (1)…(2)… si son varias>. ' +
    '<Qué NO cambia.> | <✅ Cerrada | ✅ Hecha y validada en banco; pendiente …> | ' + out.mes + '. Archivos: <rutas>. Arneses: <nombre (n/n)>. <Despliegue: …>. |');
}
