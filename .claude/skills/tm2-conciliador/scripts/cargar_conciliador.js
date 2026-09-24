/**
 * cargar_conciliador.js — carga la herramienta REAL `conciliador/conciliador.js` en un `vm` de Node, sin
 * modificarla, con un DOM mínimo (el mismo estilo de backend/pruebas/verificar_conciliador_*.js) y SheetJS
 * (paquete npm `xlsx` 0.18.5, la versión que la página carga de cdnjs).
 *
 * Se usa `vm` y no `require()` para poder llamar a los objetos de cada paso que el archivo NO exporta
 * (Paso1, Paso2, Exportes…): así el skill dispara el mismo código que los botones de la pantalla.
 * La configuración se inyecta donde la guarda el navegador (localStorage `conciliador_config_v1`) y la
 * aplica el propio `init()` → `cargarConfig()` (con sus migraciones).
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

function requerirXLSX(){
  try { return require('xlsx'); }
  catch (e) {
    console.error('Falta el paquete `xlsx`. Instálalo fuera del repo y apunta NODE_PATH:\n' +
      '  npm i --prefix "$TMPDIR/tm2deps" xlsx@0.18.5 && export NODE_PATH="$TMPDIR/tm2deps/node_modules"');
    process.exit(3);
  }
}

function buscarRepo(explicito){
  if (explicito) return path.resolve(explicito);
  for (const inicio of [__dirname, process.cwd()]) {
    let d = inicio;
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(d, 'conciliador', 'conciliador.js'))) return d;
      const p = path.dirname(d); if (p === d) break; d = p;
    }
  }
  throw new Error('No encuentro conciliador/conciliador.js: pasa --repo=<raíz del repo>.');
}

function nodo(tag){
  return { tag, id: '', value: '', checked: false, innerHTML: '', textContent: '', style: {}, children: [], files: [],
    className: '', dataset: {}, disabled: false,
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    appendChild(ch){ this.children.push(ch); return ch; }, removeChild(){}, remove(){}, click(){}, focus(){}, select(){},
    querySelector(){ return null; }, querySelectorAll(){ return []; }, setAttribute(){}, getAttribute(){ return null; },
    addEventListener(){}, scrollIntoView(){}, getContext(){ return null; } };
}

/** crearContexto({repo, config, salida}) → { eval, el, escrituras, descargas, toasts } */
function crearContexto(opts){
  opts = opts || {};
  const XLSX = requerirXLSX();
  const repo = buscarRepo(opts.repo);
  const js = fs.readFileSync(path.join(repo, 'conciliador', 'conciliador.js'), 'utf8');
  const salida = opts.salida || process.cwd();

  const els = {};
  const el = id => { if (!els[id]) { els[id] = nodo('div'); els[id].id = id; } return els[id]; };
  const store = {};
  if (opts.config) store['conciliador_config_v1'] = JSON.stringify(opts.config);
  const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
                         removeItem: k => { delete store[k]; } };
  const escrituras = [], toasts = [];
  const XLSXvm = Object.assign({}, XLSX, {
    writeFile(wb, nombre, o){ const dest = path.join(salida, path.basename(nombre)); XLSX.writeFile(wb, dest, o); escrituras.push(dest); }
  });
  const ctx = {
    document: { getElementById: el, createElement: nodo, querySelector: () => null, querySelectorAll: () => [],
                body: nodo('body'), addEventListener(){} , execCommand(){ return false; } },
    console: { log(){}, warn(){}, error: console.error, info(){} },
    XLSX: XLSXvm, localStorage, navigator: {}, location: { protocol: 'file:', href: '' },
    performance: { now: () => Date.now() }, alert: () => {}, confirm: () => true,
    setTimeout: () => 0, clearTimeout: () => {}, requestAnimationFrame: () => 0,
    URL: { createObjectURL: () => '', revokeObjectURL(){} }, Blob: function(){}, FileReader: function(){},
    Intl, Date, Math, JSON, Promise
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(js, ctx, { filename: 'conciliador.js' });
  // toast() escribe en #toast: se guarda el texto de cada aviso para mostrarlo en consola.
  const t = el('toast'); let ultimo = '';
  Object.defineProperty(t, 'innerHTML', { get(){ return ultimo; }, set(v){ ultimo = String(v); toasts.push(ultimo.replace(/<[^>]+>/g, '')); } });

  return {
    repo, el, escrituras, toasts, XLSX, store,
    eval: e => vm.runInContext(e, ctx),
    set(nombre, valor){ ctx[nombre] = valor; }
  };
}

module.exports = { crearContexto, requerirXLSX, buscarRepo };
