/**
 * TM2 Sur — Service worker (Nivel 3, D82 / backlog 2.9)
 *
 * Alcance: './' (rutas RELATIVAS; el sitio se sirve en la raíz del dominio propio
 *          https://tm2.galca.app/ — antes bajo /Ortiz-tm2-sur/ en github.io).
 * Estrategia:
 *   - Precache del shell + capturas en `install` (lista explícita abajo).
 *   - NETWORK-FIRST para todo documento/JS propio: con señal, los despliegues de GitHub Pages se
 *     ven de inmediato (se sirve lo fresco y se actualiza la caché); sin señal, se sirve la copia.
 *   - Fuentes de Google (DM Sans/Syne): CACHE-FIRST runtime (no cambian; sin esto el offline abre
 *     con fuente del sistema). Cualquier otro dominio externo: passthrough sin caché.
 *   - NUNCA se interceptan las llamadas a la API (https://api.galca.app, D169 — ni antes las de
 *     Apps Script), ni GET ni POST: es otro origen y pasa de largo. El fallback de catálogos lo
 *     maneja offline.js a nivel de aplicación con control explícito, y cachear un POST sería
 *     catastrófico.
 *   - Navegar sin red a una página FUERA del precache (encargado/residente/jefe/resúmenes, D49)
 *     responde una mini-página "Esta pantalla necesita conexión" con el estilo del tema.
 *
 * VERSIONADO: solo hace falta subir CACHE_V cuando cambia la LISTA de precache (se agrega/quita un
 * archivo). Con network-first, el CONTENIDO de los archivos se refresca solo al haber señal — un
 * cambio de texto en un HTML NO requiere subir la versión.
 */
// D170: se sube a v11 porque la lista de precache CAMBIA: la CSP ya no admite JS ni CSS en línea, así que
// cada pantalla precacheada trae ahora su `.js` y su `.css` (7 pantallas × 2 archivos) y entra el símbolo
// de marca `img/galca-simbolo.svg`; además tema.js (ya en el precache) trae el despachador de eventos del
// que dependen los HTML nuevos. Sin subirla, un teléfono instalado tendría los HTML nuevos sin sus .js.
// D138: se sube a v5 porque la lista de precache CAMBIA (entra `flota.js`, el catálogo de máquinas
// vivo que usan capataz y chequeadora). Sin subirla, un teléfono ya instalado serviría el shell viejo
// y `flota.js` no estaría en su caché: con señal se bajaría igual, pero SIN señal la pantalla se
// quedaría sin el archivo y sin lista de máquinas.
// D108: se subió la versión para que los equipos en campo recibieran el login nuevo — el que ya NO lleva
// las contraseñas dentro y sabe entrar sin señal con la sesión/credencial recordada. Sin subirla, un
// teléfono podría seguir sirviendo el index.html viejo desde el precache.
// (D84 la subió antes por el login sin ariel/albert/residente_odt y el reporte de drenajes multi-área.)
// D158: v7 porque `seleccion-reporte.html` —que SÍ está en el precache— cambió para
// darle al residente de drenajes el tile del tablero. Sin subir la versión, un teléfono
// sin señal seguiría sirviendo la copia vieja desde el precache y ese tile no aparecería.
// El tablero NO entra en la lista: son 400 KB y no pinta nada en el teléfono de un
// capataz. Se cachea solo, en la primera visita, por la vía network-first de abajo —
// que es justo lo que hace falta para proyectarlo en sala sin señal.
// v8 (sep-2026, endurecimiento del frontend): `tema.js` —que SÍ está en el precache— gana la
// función compartida `esc()` que ahora usan las capturas para pintar texto del Sheet, y las
// páginas precacheadas llevan la meta Content-Security-Policy. Sin subir la versión, un
// teléfono sin señal serviría el tema.js viejo (sin `esc`) con un HTML nuevo que la llama.
// v9 (D168, entorno de prueba): entra `entorno.js` en la LISTA de precache —el único sitio con las
// URLs de los dos Apps Script, elegibles entre producción y prueba— y todas las pantallas lo cargan
// el primero. Sin subir la versión, un teléfono sin señal serviría un HTML nuevo (que espera
// `GALCA_ENV`) sin tener el archivo en caché, y la pantalla no arrancaría.
// v10 (D169, Worker api.galca.app): `auth.js` —en el precache— pasa a ser el único sitio con la URL base
// de la API y se carga el PRIMERO; `entorno.js` deja de tener URLs y depende de él. Un teléfono sin
// señal con el auth.js/entorno.js viejos y un HTML nuevo (orden de scripts cambiado, CSP sin
// script.google.com) no arrancaría, o saldría a Google y la CSP lo frenaría. Por eso se sube.
const CACHE_V = 'tm2-v17';  // v17: Parte Digital — fecha de ayer de madrugada, jornada > 14 h no se envía, CC con comas.
                            // v16: Catálogos a todo el ancho, sin recuadro de texto y con los filtros ocultos al entrar.
                            // v15: catalogos.html pasa a enlazar data.css (misma hoja que Revisión de DATA) → entra al precache.
                            // v14: entra la pantalla de Catálogos (catalogos.html/.js/.css, solo admin)
                            //   al precache — su selector/columnas dependen de tema.js/esc() ya en caché.
                            // v13 (D176): entra el Parte Digital (parte.html/.js/.css) al precache y offline.js gana
                            //   `pendientes()` + tipo 'parte', de los que parte.js depende (cola sin señal por QR)
                            // v12 (D171): flota.js gana `equiposCapataz` y reporte-capataz.js depende de él
                            // v11 (D170): JS/CSS de cada pantalla en archivos propios + símbolo Galca; tema.js nuevo
const FONT_CACHE = CACHE_V + '-fonts';

// Lista explícita: shell + capturas + app (incluido el parte de maquinaria, D176). NO precachear las páginas fuera de alcance
// (encargado, residente, residente-drenajes, jefe, estado, produccion-maquinaria,
// resumen-asistencia, mis-extras necesitan datos vivos, D49/D82).
const PRECACHE = [
  './index.html', './index.js', './index.css',
  './seleccion-reporte.html', './seleccion-reporte.js', './seleccion-reporte.css',
  './menu.html', './menu.js', './menu.css',
  './catalogos.html', './catalogos.js', './catalogos.css', './data.css',   // data.css: la hoja de Catálogos la reutiliza
  './reporte-capataz.html', './reporte-capataz.js', './reporte-capataz.css',
  './reporte-chequeadora.html', './reporte-chequeadora.js', './reporte-chequeadora.css',
  './reporte-drenajes.html', './reporte-drenajes.js', './reporte-drenajes.css',
  './asistencia.html', './asistencia.js', './asistencia.css',
  './parte.html', './parte.js', './parte.css',          // D176: parte digital por QR, sin señal
  './img/galca-simbolo.svg',
  './entorno.js',
  './auth.js',
  './offline.js',
  './flota.js',
  './tema.css',
  './tema.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

// Mini-página inline para navegaciones sin red a páginas fuera del precache (mismo tema oscuro).
// D170: su CSP ya no lleva 'unsafe-inline'; el <style> se autoriza por HASH (sha256 en base64 del texto
// EXACTO entre <style> y </style>). Si se cambia una letra de ese CSS hay que recalcular el hash:
//   node -e "const c=require('crypto');process.stdout.write(c.createHash('sha256').update(TEXTO).digest('base64'))"
const OFFLINE_HTML = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">'
  + '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; style-src \'sha256-BsT9wShmcCJKcuVJ6q3i/mdUBBz9sydEK6a1vIqilEY=\'; img-src \'self\' data:">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Sin conexión — TM2 Sur</title>'
  + '<style>body{font-family:sans-serif;background:#0f1117;color:#e8eaf0;min-height:100vh;display:flex;'
  + 'align-items:center;justify-content:center;padding:20px;margin:0;}'
  + '.card{background:#1a1d27;border:1px solid #2e3450;border-radius:20px;padding:40px 32px;max-width:400px;text-align:center;}'
  + '.ico{font-size:48px;margin-bottom:14px;}h1{font-size:19px;margin:0 0 10px;}'
  + 'p{font-size:14px;color:#7a80a0;line-height:1.6;margin:0 0 20px;}'
  + 'a{display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#f5a623,#e8621a);'
  + 'border-radius:10px;color:#0f1117;font-weight:700;text-decoration:none;}</style></head><body>'
  + '<div class="card"><div class="ico">📡</div><h1>Esta pantalla necesita conexión</h1>'
  + '<p>Los paneles de revisión y resúmenes leen datos vivos del servidor y no funcionan sin señal. '
  + 'Los reportes de campo (capataz, chequeadora, drenajes, asistencia) y el parte de maquinaria sí funcionan sin señal.</p>'
  + '<a href="./index.html">← Volver al inicio</a></div></body></html>';

self.addEventListener('install', function(ev){
  ev.waitUntil(
    caches.open(CACHE_V)
      .then(function(cache){ return cache.addAll(PRECACHE); })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(ev){
  ev.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        // borra caches de versiones anteriores (se conserva la actual y la de fuentes)
        if (k !== CACHE_V && k !== FONT_CACHE) return caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(ev){
  const req = ev.request;
  if (req.method !== 'GET') return;                    // POST y demás: siempre directo a la red

  let url;
  try{ url = new URL(req.url); }catch(e){ return; }

  // ¡NUNCA interceptar la API! (ni GET de catálogos ni POST de reportes). Es otro origen
  // (api.galca.app, D169), así que cae en el passthrough de «cualquier otro dominio» de abajo.

  // Fuentes de Google: cache-first runtime (no cambian)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'){
    ev.respondWith(
      caches.open(FONT_CACHE).then(function(cache){
        return cache.match(req).then(function(hit){
          if (hit) return hit;
          return fetch(req).then(function(resp){
            if (resp && resp.ok) cache.put(req, resp.clone());
            return resp;
          });
        });
      })
    );
    return;
  }

  // Cualquier otro dominio externo: passthrough sin caché
  if (url.origin !== self.location.origin) return;

  // Propio (documentos/JS/iconos): NETWORK-FIRST — fresco si hay señal (y se actualiza la caché),
  // copia cacheada si no. ignoreSearch tolera query strings (?area=odl).
  ev.respondWith(
    fetch(req).then(function(resp){
      if (resp && resp.ok){
        const copia = resp.clone();
        caches.open(CACHE_V).then(function(cache){ cache.put(req, copia); });
      }
      return resp;
    }).catch(function(){
      return caches.match(req, { ignoreSearch:true }).then(function(hit){
        if (hit) return hit;
        if (req.mode === 'navigate'){
          // raíz del sitio sin red -> el login precacheado; página fuera del precache -> aviso
          // "Esta pantalla necesita conexión" con el estilo del tema (nunca una pantalla rota)
          const aviso = new Response(OFFLINE_HTML, { headers: { 'Content-Type':'text/html; charset=utf-8' } });
          if (url.pathname.endsWith('/')) return caches.match('./index.html').then(function(idx){ return idx || aviso; });
          return aviso;
        }
        return Response.error();
      });
    })
  );
});
