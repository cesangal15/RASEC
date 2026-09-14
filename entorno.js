/**
 * TM2 Sur — ENTORNO: producción o prueba (D168)
 *
 * ÚNICO sitio del frontend donde viven las URLs de los dos Apps Script (obra y asistencias). Cada
 * pantalla toma la suya de aquí (`GALCA_ENV.url.obra` / `GALCA_ENV.url.asistencias`) en vez de
 * llevarla cableada; antes había 17 copias de la misma cadena repartidas por los HTML.
 *
 * Hay DOS juegos de URLs:
 *   · `produccion` — los despliegues de siempre, contra los Sheets de la obra. Es lo que usa todo el
 *     mundo si no se pide otra cosa: sin `?env=` y sin nada guardado, este archivo ni escribe en
 *     localStorage ni cambia una coma de lo que ya hacían las pantallas.
 *   · `prueba` — una segunda copia de cada Apps Script apuntando a un Sheet COPIA, para ensayar
 *     cambios sin ensuciar los datos reales. Cómo crearlas: docs/OPERACIONES.md.
 *
 * CÓMO SE ELIGE (el mismo teléfono/navegador puede ir y volver):
 *   · abrir cualquier pantalla con `?env=prueba`  → se guarda en localStorage (`galca_env`) y a
 *     partir de ahí TODAS las pantallas de ese navegador hablan con el entorno de prueba, aunque el
 *     parámetro ya no vaya en la URL (menú → capataz → … no lo arrastran).
 *   · `?env=produccion` (o `?env=prod`)          → se borra lo guardado y se vuelve a producción.
 *   · Al CAMBIAR de entorno se cierra la sesión (token, usuario, rol, áreas): el token lo firma cada
 *     backend con su propio secreto, así que el de un entorno no vale en el otro y lo honesto es
 *     mandar al login en vez de dejar que cada pantalla falle con «sesión caducada».
 *   · Si se pide `prueba` pero las URLs de prueba están vacías (todavía no se crearon los
 *     despliegues), se ignora la petición con un aviso en consola y se sigue en producción: mejor
 *     eso que una pantalla llamando a una URL vacía.
 *
 * INDICADOR: con `prueba` activo, un chip «PRUEBA» junto al título de la cabecera (dentro del `h1`
 * de `.header-left`, que existe en casi todas las pantallas) o, si la pantalla no tiene esa
 * cabecera (login, tablero, reparto), fijo arriba en el centro. Además el título de la pestaña
 * empieza por «PRUEBA · » y `<html>` lleva `data-entorno="prueba"` por si algún CSS lo necesita.
 *
 * SE CARGA EL PRIMERO en el <head> de todas las pantallas (antes que auth.js, offline.js y tema.js),
 * bloqueante como tema.js: son unas pocas líneas y las constantes de cada pantalla lo necesitan al
 * evaluarse. Está en el PRECACHE del service worker (funciona sin señal, D82).
 *
 * LO QUE NO HACE: no toca auth.js (el token se pega por host `script.google.com`, así que sirve
 * igual para las dos URLs), ni la CSP (mismos hosts), ni el service worker (nunca intercepta el
 * Apps Script). La cola offline guarda la URL con cada ítem, así que un reporte capturado en prueba
 * sube a prueba aunque después se vuelva a producción — por eso conviene no cambiar de entorno con
 * envíos pendientes (ver OPERACIONES.md).
 */
var GALCA_ENV = (function(){
  'use strict';

  var URLS = {
    produccion: {
      obra:        'https://script.google.com/macros/s/AKfycbyUEC1BVZc6K_IVsK-gjql7HD15sAJxDxwkmVIwz8j-gFLdoNht5IEb5fZY9Jduyac/exec',
      asistencias: 'https://script.google.com/macros/s/AKfycbymgvQX03ZqS_YzIz5l6WVesasDUMYwGOFItrggTJCdsFhcjXQvDPVz03E7mNcZQ4Nq/exec'
    },
    // Pegar aquí las URLs `/exec` de las copias de PRUEBA (docs/OPERACIONES.md). Mientras estén
    // vacías, `?env=prueba` no hace nada.
    prueba: {
      obra:        'https://script.google.com/macros/s/AKfycbwpJn5bMqbzg_iAvdLfTM1OCU2UuHE-WGteeVpWNbWWJvCax_grUm0FzrkNoIeMrHFoTQ/exec',
      asistencias: 'https://script.google.com/macros/s/AKfycbwxV2EzHtbpCDWlkwtwwoBfZomsuWnhdQDerLLPbmk_FQQl1TZbibXO7Y09NGTY0FaBwA/exec'
    }
  };

  var LLAVE = 'galca_env';                       // localStorage: 'prueba' | ausente (= producción)
  var ALIAS = { produccion:'produccion', prod:'produccion', prueba:'prueba', test:'prueba' };
  var SESION = ['tm2_token', 'usuario', 'rol', 'areas'];   // lo que se limpia al cambiar de entorno

  function guardado(){
    try{ return localStorage.getItem(LLAVE) === 'prueba' ? 'prueba' : 'produccion'; }
    catch(e){ return 'produccion'; }
  }
  function guardar(n){
    try{
      if(n === 'prueba') localStorage.setItem(LLAVE, 'prueba');
      else localStorage.removeItem(LLAVE);
    }catch(e){ /* almacenamiento bloqueado: vale solo para esta carga */ }
  }
  function pedidoEnURL(){
    try{
      var m = /[?&]env=([^&#]*)/.exec(String(window.location.search || ''));
      if(!m) return null;
      return ALIAS[decodeURIComponent(m[1]).trim().toLowerCase()] || null;
    }catch(e){ return null; }
  }
  function cerrarSesion(){
    for(var i = 0; i < SESION.length; i++){ try{ localStorage.removeItem(SESION[i]); }catch(e){} }
  }

  var configurado = !!(URLS.prueba.obra && URLS.prueba.asistencias);
  var anterior = guardado();
  var pedido = pedidoEnURL();
  var nombre = pedido || anterior;

  if(nombre === 'prueba' && !configurado){
    try{ console.warn('[GALCA_ENV] Se pidió el entorno de prueba pero entorno.js no tiene sus URLs; se sigue en producción.'); }catch(e){}
    nombre = 'produccion';
  }
  if(pedido && nombre !== anterior){
    // Solo aquí se escribe: cuando la URL pide un entorno DISTINTO del que había.
    guardar(nombre);
    cerrarSesion();
    try{ console.info('[GALCA_ENV] Entorno cambiado a «' + nombre + '»; sesión cerrada.'); }catch(e){}
  }

  var esPrueba = (nombre === 'prueba');

  // --- Indicador visible ------------------------------------------------------------------------
  function indicador(){
    if(document.getElementById('galca-env-chip')) return;
    try{ if(document.title.indexOf('PRUEBA') !== 0) document.title = 'PRUEBA · ' + document.title; }catch(e){}

    var st = document.createElement('style');
    st.textContent =
      '.galca-env-chip{display:inline-block;vertical-align:middle;margin-left:10px;padding:3px 9px;' +
        'border-radius:6px;background:#d81b60;color:#fff;font:700 11px/1.3 "DM Sans",system-ui,sans-serif;' +
        'letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35);}' +
      '.galca-env-fijo{position:fixed;top:8px;left:50%;transform:translateX(-50%);margin:0;z-index:9999;' +
        'pointer-events:none;}';
    (document.head || document.documentElement).appendChild(st);

    var chip = document.createElement('span');
    chip.id = 'galca-env-chip';
    chip.className = 'galca-env-chip';
    chip.textContent = 'PRUEBA';
    chip.title = 'Entorno de PRUEBA: los datos van al Sheet copia, no al de la obra. Para volver: ?env=produccion';

    var h1 = document.querySelector('.header-left h1');
    if(h1){ h1.appendChild(chip); }
    else { chip.className += ' galca-env-fijo'; document.body.appendChild(chip); }
  }

  if(esPrueba){
    try{ document.documentElement.setAttribute('data-entorno', 'prueba'); }catch(e){}
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', indicador);
    else indicador();
  }

  return {
    nombre: nombre,               // 'produccion' | 'prueba'
    esPrueba: esPrueba,
    url: URLS[nombre],            // { obra, asistencias } del entorno activo
    urls: URLS,
    configurado: configurado,     // ¿hay URLs de prueba pegadas?
    /** Cambia de entorno desde consola o desde un botón: GALCA_ENV.cambiar('prueba'). Recarga. */
    cambiar: function(n){
      var d = ALIAS[String(n || '').toLowerCase()] || 'produccion';
      if(d === 'prueba' && !configurado) return false;
      if(d !== nombre){ guardar(d); cerrarSesion(); }
      try{
        var u = window.location.href.replace(/([?&])env=[^&#]*(&?)/, function(_, p, amp){ return amp ? p : ''; }).replace(/[?&]$/, '');
        window.location.replace(u);
      }catch(e){ window.location.reload(); }
      return true;
    }
  };
})();
