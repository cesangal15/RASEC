/**
 * cargar_reparto.js — carga la herramienta REAL `Reparto_Produccion_Maquinaria.js` en un `vm` de Node,
 * sin modificarla, con un DOM mínimo y SheetJS (paquete npm `xlsx`, misma versión 0.18.5 que carga la
 * página desde cdnjs). Es el mismo patrón de los arneses de backend/pruebas/, con dos diferencias:
 *   · lee el `.js` externo (desde D170 el HTML ya no lleva <script> en línea);
 *   · los valores iniciales de los campos salen del propio HTML (atributos value/checked), no de una copia.
 *
 * La configuración se inyecta como lo haría el navegador: en el localStorage simulado, bajo la MISMA
 * clave de la herramienta (`CFG_KEY`), así que la aplica su propio arranque (`leerCfg`/`aplicarCfg`).
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

/* Raíz del repo: la que tenga Reparto_Produccion_Maquinaria.js, subiendo desde este script o desde cwd. */
function buscarRepo(explicito){
  if (explicito) return path.resolve(explicito);
  for (const inicio of [__dirname, process.cwd()]) {
    let d = inicio;
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(d, 'Reparto_Produccion_Maquinaria.js'))) return d;
      const p = path.dirname(d); if (p === d) break; d = p;
    }
  }
  throw new Error('No encuentro Reparto_Produccion_Maquinaria.js: pasa --repo=<raíz del repo>.');
}

/* value/checked por defecto de cada <input id=…> del HTML real (la fuente de los valores de fábrica). */
function defaultsDelHTML(html){
  const out = {};
  const re = /<input\b[^>]*>/gi; let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const id = (tag.match(/\bid="([^"]*)"/) || [])[1]; if (!id) continue;
    const val = (tag.match(/\bvalue="([^"]*)"/) || [])[1];
    out[id] = { value: val == null ? '' : val, checked: /\bchecked\b/.test(tag) };
  }
  return out;
}

/* esc() vive en tema.js (D167); se toma de ahí para no tener una copia. Solo se usa al pintar HTML. */
function escDeTema(repo){
  try {
    const src = fs.readFileSync(path.join(repo, 'tema.js'), 'utf8');
    const m = src.match(/function esc\(s\)\{[\s\S]*?\n\}/);
    if (m) return m[0];
  } catch (e) {}
  return "function esc(s){ return String(s==null?'':s).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'})[c]); }";
}

/**
 * crearContexto({repo, config}) → { ctx, eval, el, clic, escrituras }
 *   config: objeto con la forma que guarda la herramienta ({v:1, hojaProd, …}) o null (= valores de fábrica).
 */
function crearContexto(opts){
  opts = opts || {};
  const XLSX = requerirXLSX();
  const repo = buscarRepo(opts.repo);
  const js = fs.readFileSync(path.join(repo, 'Reparto_Produccion_Maquinaria.js'), 'utf8');
  const html = fs.readFileSync(path.join(repo, 'Reparto_Produccion_Maquinaria.html'), 'utf8');
  const def = defaultsDelHTML(html);

  const oyentes = {};                     // id → {evento: [fn]}
  const els = {};
  const el = id => {
    if (!els[id]) {
      const d = def[id] || { value: '', checked: false };
      els[id] = { id, value: d.value, checked: d.checked, textContent: '', innerHTML: '', disabled: false,
        style: {}, files: [], classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
        setAttribute(){}, getAttribute(){ return null; },
        addEventListener(ev, fn){ ((oyentes[id] = oyentes[id] || {})[ev] = oyentes[id][ev] || []).push(fn); } };
    }
    return els[id];
  };
  const store = {};
  if (opts.config) store['tm2_reparto_cfg_v1'] = JSON.stringify(opts.config);
  const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
                         removeItem: k => { delete store[k]; } };

  // XLSX.writeFile escribe en la carpeta de salida, no en cwd; se registra lo escrito.
  const escrituras = [];
  const XLSXvm = Object.assign({}, XLSX, {
    writeFile(wb, nombre, o){
      const dest = path.join(opts.salida || process.cwd(), path.basename(nombre));
      XLSX.writeFile(wb, dest, o); escrituras.push(dest);
    }
  });

  const ctx = { document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [] },
    console, XLSX: XLSXvm, localStorage, location: { protocol: 'file:' }, navigator: {},
    alert: () => {}, confirm: () => true, setTimeout: () => 0, clearTimeout: () => {}, Intl, Date, Math,
    addEventListener: () => {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(escDeTema(repo), ctx);
  vm.runInContext(js, ctx, { filename: 'Reparto_Produccion_Maquinaria.js' });

  return {
    ctx, el, escrituras, store, repo,
    eval: e => vm.runInContext(e, ctx),
    /* Dispara los oyentes reales de un botón (el mismo código que corre al hacer clic). */
    clic(id){ ((oyentes[id] || {}).click || []).forEach(fn => fn({ target: el(id) })); },
    cargarLibro(slot, archivo){
      const buf = fs.readFileSync(archivo);
      ctx.__wb = XLSX.read(buf, { type: 'buffer', cellDates: true });   // mismas opciones que armarCarga()
      ctx.__nombre = path.basename(archivo);
      vm.runInContext('S.' + slot + '.wb=__wb; S.' + slot + '.nombre=__nombre;', ctx);
    }
  };
}

/* Texto plano de un innerHTML (para mostrar en consola los avisos que la pantalla pinta). */
function textoPlano(h){
  return String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li|tr)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/\n{2,}/g, '\n').trim();
}

module.exports = { crearContexto, textoPlano, buscarRepo, requerirXLSX };
