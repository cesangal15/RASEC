#!/usr/bin/env node
/**
 * reparto.js — ejecuta el REPARTO MENSUAL de producción por CC sin abrir el navegador, con el código real
 * de `Reparto_Produccion_Maquinaria.js` (no hay port: se dispara el mismo botón «Procesar» y el mismo
 * «Descargar .xlsx» de la pantalla).
 *
 *   node reparto.js --prod=<reporte diario de obra.xlsx> --jefe=<parte de maquinaria del mes.xlsx>
 *                   [--config=<config.json>] [--desde=AAAA-MM-DD --hasta=AAAA-MM-DD]
 *                   [--salida=<carpeta>] [--repo=<raíz del repo>] [--json]
 *   node reparto.js --volcar-config [--config=<config.json>]   # config efectiva (fábrica + la tuya), formato de la herramienta
 *
 * Salida: `fact_jefe_<desde>_<hasta>.xlsx` (hojas fact_jefe A:AC · reparto · cuadre) en --salida
 * (por defecto, la carpeta actual). NUNCA escribe sobre los archivos de entrada.
 * Código de salida: 0 = cuadre exacto · 1 = hay descuadre o producción huérfana (revisar) · 2 = error.
 */
'use strict';
const fs = require('fs'), path = require('path');
const { crearContexto, textoPlano } = require('./cargar_reparto.js');

const args = {};
process.argv.slice(2).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });

function cargarConfig(ruta){
  if (!ruta) return null;
  const c = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  // Solo las claves que la herramienta guarda (CFG_TXT/CFG_CHK). `_…` y "PENDIENTE" se ignoran:
  // un valor pendiente NO debe pisar el de fábrica en silencio, se avisa.
  const out = { v: 1 }, pendientes = [];
  Object.keys(c).forEach(k => {
    if (k.charAt(0) === '_' || k === 'v') return;
    const v = c[k];
    if (typeof v === 'string' && /PENDIENTE/i.test(v)) { pendientes.push(k); return; }
    if (Array.isArray(v)) out[k] = v.join('\n'); else out[k] = v;
  });
  return { cfg: out, pendientes };
}

function main(){
  if (args['volcar-config']) {
    // La config EFECTIVA tal como la guardaría la herramienta (guardarCfg): fábrica + lo que traiga --config.
    const info = cargarConfig(args.config);
    const T = crearContexto({ repo: args.repo, config: info && info.cfg });
    T.eval('guardarCfg()');
    const c = JSON.parse(T.store['tm2_reparto_cfg_v1']);
    if (info && info.pendientes.length) c._pendientes_con_valor_de_fabrica = info.pendientes;
    console.log(JSON.stringify(c, null, 2));
    return;
  }
  if (!args.prod || !args.jefe) {
    console.error('Uso: node reparto.js --prod=<reporte diario.xlsx> --jefe=<parte maquinaria.xlsx> [--config=config.json] [--desde= --hasta=] [--salida=dir]');
    process.exit(2);
  }
  const salida = path.resolve(args.salida || process.cwd());
  fs.mkdirSync(salida, { recursive: true });
  for (const f of [args.prod, args.jefe]) {
    if (path.resolve(path.dirname(f)) === salida) {
      // No es un riesgo real (el nombre de salida es otro), pero deja la salida APARTE, como pide el proyecto.
      console.warn('⚠ La carpeta de salida es la misma de las entradas; se recomienda una aparte.');
    }
  }
  const cfgInfo = cargarConfig(args.config);
  const T = crearContexto({ repo: args.repo, config: cfgInfo && cfgInfo.cfg, salida });

  T.cargarLibro('prod', args.prod);
  T.cargarLibro('jefe', args.jefe);
  T.eval('detectarCorte()');                       // lo mismo que hace la pantalla al cargar el parte
  if (args.desde) T.el('desde').value = args.desde;
  if (args.hasta) T.el('hasta').value = args.hasta;

  T.clic('btnProc');                               // «Procesar»: leerParams → leerProduccion → leerClima → leerJefe → repartir → render
  const avisos = textoPlano(T.el('avisos').innerHTML);
  const hayOut = T.eval('!!S.out');
  if (!hayOut) { console.error('✗ La herramienta no produjo resultado:\n' + avisos); process.exit(2); }

  T.clic('btnXlsx');                               // «Descargar .xlsx»: fact_jefe + reparto + cuadre
  const r = T.eval(`({ desde:S.out.P.desde, hasta:S.out.P.hasta, filas:S.out.rep.filas.length,
    prod:S.out.rep.filas.reduce((s,f)=>s+(f.produccion||0),0), horas:S.out.rep.filas.reduce((s,f)=>s+(f.horas||0),0),
    descuadre:S.out.rep.cuadre.filter(c=>Math.abs(c.dif)>TOL).map(c=>({cc:c.item,uf:c.uf,dif:c.dif})),
    huerfanas:S.out.rep.huerfanas.length, sinBloque:S.out.rep.sinBloque||[], caidas:(S.out.rep.caidas||[]).length,
    rellenadas:(S.out.rep.rellenadas||0), formatoParte:S.out.jefe.formato,
    params:{pctBull:S.out.P.pctBull, minDia:S.out.P.minDia, minHorasProd:S.out.P.minHorasProd, repartoDiario:S.out.P.repartoDiario,
            separarUF:S.out.P.separarUF, soloHoras:S.out.P.soloHoras, rellenarDias:S.out.P.rellenarDias,
            maquinas:[...S.out.P.propias].length, estanciasMalas:S.out.P.estanciasMalas} })`);
  r.archivo = T.escrituras[0] || '';
  r.configPendiente = cfgInfo ? cfgInfo.pendientes : [];
  r.avisos = avisos;

  if (args.json) { console.log(JSON.stringify(r, null, 2)); }
  else {
    console.log('Corte: ' + r.desde + ' → ' + r.hasta + ' · parte en formato ' + r.formatoParte);
    console.log('Filas fact_jefe: ' + r.filas + ' · producción repartida: ' + r.prod.toFixed(2) + ' · horas: ' + r.horas.toFixed(2));
    console.log('Parámetros: ' + JSON.stringify(r.params));
    if (r.configPendiente.length) console.log('⚠ Config PENDIENTE (se usaron los valores de fábrica): ' + r.configPendiente.join(', '));
    console.log('\nAvisos de la herramienta:\n' + avisos);
    console.log('\nArchivo: ' + r.archivo);
  }
  process.exit(r.descuadre.length || r.huerfanas ? 1 : 0);
}

try { main(); } catch (e) { console.error('✗ ' + (e && e.stack || e)); process.exit(2); }
