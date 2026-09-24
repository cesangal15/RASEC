#!/usr/bin/env node
/**
 * conciliar.js — ejecuta la CONCILIACIÓN DE ACTAS de transporte (pasos 1→4 y exportes del 7) sin abrir
 * `conciliador/index.html`, con el código real de `conciliador/conciliador.js` (Paso1._procesar, Paso2.abrir,
 * Paso3._procesarArchivo/_finCarga/sinProforma/resolverHoja, Exportes.* — los mismos que los botones).
 *
 *   node conciliar.js --contratista=<id> --desde=AAAA-MM-DD --hasta=AAAA-MM-DD
 *                     --granulares=<GRANULARES.xlsx> --terraplen=<TERRAPLEN.xlsx>   (una o las dos)
 *                     --proforma=<a.xlsx>[,<b.xlsx>…]  |  --sin-proforma=AAAA-MM-DD..AAAA-MM-DD
 *                     [--hoja="<nombre de hoja>=GRANULARES|TERRAPLEN|TERRAPLEN_INTERNO|IGNORAR"]…
 *                     [--config=<conciliador_config_….json exportado de ⚙>] [--salida=<carpeta>] [--repo=<raíz>] [--json]
 *   node conciliar.js --lista-contratistas [--config=…]
 *
 * NO hace el Paso 5 (PDF/OCR) ni el 6 (decisiones manuales): eso sigue en la herramienta. Deja una SESIÓN
 * JSON que la herramienta importa (💾 Importar sesión) para continuar desde el Paso 4 con los PDFs.
 * Salida (aparte, nunca sobre las bases): bloque_acta_* · bloque_acta_pendientes_* · digitadora_* · resumen_*
 * (.xlsx, los exportes reales del Paso 7) + resumen_*.txt (resumenCorte) + conciliador_sesion_*.json.
 * Código de salida: 0 = conciliado · 1 = conciliado pero con hojas sin ámbito/columna por resolver · 2 = error.
 */
'use strict';
const fs = require('fs'), path = require('path');
const { crearContexto } = require('./cargar_conciliador.js');

const args = {}, hojas = [];
process.argv.slice(2).forEach(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (!m) return;
  if (m[1] === 'hoja') hojas.push(m[2]); else args[m[1]] = m[2] === undefined ? true : m[2];
});
const salida = path.resolve(args.salida || process.cwd());
fs.mkdirSync(salida, { recursive: true });
const config = args.config ? JSON.parse(fs.readFileSync(args.config, 'utf8')) : null;
const T = crearContexto({ repo: args.repo, config, salida });
const J = e => T.eval(e);

if (args['lista-contratistas']) {
  const l = J('S.config.contratistas.map(c=>({id:c.id,nombre:c.nombre,ambitos:c.ambitos}))');
  l.forEach(c => console.log(c.id.padEnd(14) + ' ' + c.nombre + '  [' + (c.ambitos || []).join('+') + ']'));
  console.log('\nEmpresas que nunca se concilian: ' + J('(S.config.empresasVetadas||[]).join(", ")'));
  console.log(config && config.contratistas ? '(config: ' + args.config + ')' : '(config de FÁBRICA, configSeed(): la del navegador del dueño puede diferir)');
  process.exit(0);
}

function fallar(msg){ console.error('✗ ' + msg + (T.toasts.length ? '\n  Avisos: ' + T.toasts.slice(-3).join(' | ') : '')); process.exit(2); }
if (!args.contratista || !args.desde || !args.hasta) fallar('Faltan --contratista, --desde o --hasta (usa --lista-contratistas).');
if (!args.granulares && !args.terraplen) fallar('Falta al menos una base: --granulares y/o --terraplen.');
if (!args.proforma && !args['sin-proforma']) fallar('Falta --proforma=<xlsx> (o --sin-proforma=desde..hasta).');

// Paso 1 — bases (solo lectura; se leen con cellDates:false, como la pantalla)
for (const [tipo, arg] of [['GRANULARES', args.granulares], ['TERRAPLEN', args.terraplen]]) {
  if (!arg) continue;
  const wb = T.XLSX.read(fs.readFileSync(arg), { type: 'buffer', cellDates: false });
  const hojaDef = J('BASES_DEF.' + tipo + '.hojaDefecto');
  const hoja = args['hoja-' + tipo.toLowerCase()] || hojaDef;
  if (wb.SheetNames.indexOf(hoja) < 0) fallar(tipo + ': no está la hoja «' + hoja + '». Hojas: ' + wb.SheetNames.join(' · ') + '. Usa --hoja-' + tipo.toLowerCase() + '=<hoja>.');
  T.set('__wb', wb); T.set('__n', path.basename(arg)); T.set('__h', hoja);
  J('Paso1._procesar(__wb,"' + tipo + '",__n,__h)');
}

// Paso 2 — abrir corte (valida contratista y empresas vetadas)
T.el('selContratista').value = args.contratista; T.el('qIni').value = args.desde; T.el('qFin').value = args.hasta;
J('Paso2.abrir()');
if (!J('!!S.corte')) fallar('No se pudo abrir el corte.');

// Paso 3 — proforma(s) o «sin proforma»
if (args['sin-proforma']) {
  const [a, b] = String(args['sin-proforma']).split('..');
  T.el('spIni').value = a; T.el('spFin').value = b;
  J('Paso3.sinProforma()');
} else {
  String(args.proforma).split(',').filter(Boolean).forEach(f => {
    T.set('__wb', T.XLSX.read(fs.readFileSync(f), { type: 'buffer', cellDates: false })); T.set('__n', path.basename(f));
    J('Paso3._procesarArchivo(__wb,__n)');
  });
  J('Paso3._finCarga()');
  // Hojas que la herramienta no clasifica sola: se resuelven con --hoja="NOMBRE=ÁMBITO" (mismo Paso3.resolverHoja)
  hojas.forEach(h => {
    const [nombre, amb] = h.split('=');
    const pos = J('(()=>{for(const pf of S.corte.proformas){const j=pf.hojas.findIndex(x=>x.nombre===' + JSON.stringify(nombre) + ');if(j>=0)return[pf.idx,j];}return null;})()');
    if (!pos) { console.warn('⚠ --hoja: no hay ninguna hoja «' + nombre + '» en las proformas.'); return; }
    T.el('selAmb_' + pos[0] + '_' + pos[1]).value = amb; T.el('chkRegla_' + pos[0] + '_' + pos[1]).checked = false;
    J('Paso3.resolverHoja(' + pos[0] + ',' + pos[1] + ')');
  });
}

// Paso 7 — exportes reales + resumen + sesión importable
['xlsxActa', 'xlsxActaPend', 'xlsxDigitadora', 'xlsxResumen'].forEach(fn => {
  try { J('Exportes.' + fn + '()'); } catch (e) { console.warn('⚠ Exportes.' + fn + ': ' + e.message); }
});
const base = J('Exportes._nombre("X","txt")').replace(/^X_/, '').replace(/\.txt$/, '');
const resumen = J('resumenCorte()');
const fRes = path.join(salida, 'resumen_' + base + '.txt'); fs.writeFileSync(fRes, resumen + '\n');
const fSes = path.join(salida, 'conciliador_sesion_' + base + '.json'); fs.writeFileSync(fSes, J('sesionJSON(true)'));

const r = J(`({ conteo:conteoEstados(), reclamadas:S.corte.reclamos.length, alActa:filasActa().length,
  pendientesDigitacion:pendientesOrdenadas().length,
  hojas:S.corte.proformas.flatMap(pf=>pf.hojas.map(h=>({archivo:pf.archivo,hoja:h.nombre,estado:h.estado,ambito:h.ambito,modo:h.modo,n:h.n}))),
  configFabrica:${config && config.contratistas ? 'false' : 'true'} })`);
r.archivos = T.escrituras.concat([fRes, fSes]);
r.porResolver = r.hojas.filter(h => h.estado === 'sin_ambito' || h.estado === 'sin_columna');

if (args.json) console.log(JSON.stringify(r, null, 2));
else {
  console.log(resumen);
  console.log('\nAl acta: ' + r.alActa + ' filas · pendientes de digitación/investigación: ' + r.pendientesDigitacion);
  if (r.porResolver.length) console.log('⚠ Hojas por resolver (usa --hoja="NOMBRE=ÁMBITO"): ' + r.porResolver.map(h => h.archivo + ' › ' + h.hoja + ' (' + h.estado + ')').join(' · '));
  if (r.configFabrica) console.log('⚠ Config de FÁBRICA (configSeed): exporta la tuya desde ⚙ Configuración → Exportar y pásala con --config.');
  console.log('\nArchivos:\n  ' + r.archivos.join('\n  '));
}
process.exit(r.porResolver.length ? 1 : 0);
