/**
 * TM2 Sur — ENTORNO: producción o prueba (D168; URLs vía auth.js desde D169)
 *
 * Elige contra qué ENTORNO habla el frontend y expone `GALCA_ENV.url.obra` / `.asistencias` /
 * `.parte`, que es lo que leen las pantallas. Desde D169 este archivo NO contiene ninguna URL: la
 * base de la API vive SOLO en `auth.js` (`TM2Auth.API_BASE` = https://api.galca.app, el Worker de
 * Cloudflare que reenvía a los Apps Script) y aquí solo se le antepone el prefijo del entorno:
 *   · `produccion` → `TM2Auth.url` tal cual        (/obra · /asistencias · /parte)
 *   · `prueba`     → `TM2Auth.API_BASE + '/prueba/…'` (/prueba/obra · …), que el Worker reenvía a las
 *     copias de prueba si sus secretos están puestos; si no, contesta 503 `no_configurado`.
 *     Cómo crear las copias y ponerle los secretos al Worker: docs/OPERACIONES.md.
 *
 * CÓMO SE ELIGE (el mismo teléfono/navegador puede ir y volver):
 *   · abrir cualquier pantalla con `?env=prueba`  → se guarda en localStorage (`galca_env`) y a
 *     partir de ahí TODAS las pantallas de ese navegador hablan con el entorno de prueba, aunque el
 *     parámetro ya no vaya en la URL (menú → capataz → … no lo arrastran).
 *   · `?env=produccion` (o `?env=prod`)          → se borra lo guardado y se vuelve a producción.
 *   · Al CAMBIAR de entorno se cierra la sesión (token, usuario, rol, áreas): el token lo firma cada
 *     backend con su propio secreto, así que el de un entorno no vale en el otro y lo honesto es
 *     mandar al login en vez de dejar que cada pantalla falle con «sesión caducada».
 *   · Si `auth.js` está en rollback a Google (`API_BASE` vacía) no hay ruta /prueba/ posible: se
 *     ignora la petición con un aviso en consola y se sigue en producción.
 *
 * INDICADOR: con `prueba` activo, un chip «PRUEBA» junto al título de la cabecera (dentro del `h1`
 * de `.header-left`, que existe en casi todas las pantallas) o, si la pantalla no tiene esa
 * cabecera (login, tablero, reparto), fijo arriba en el centro. Además el título de la pestaña
 * empieza por «PRUEBA · » y `<html>` lleva `data-entorno="prueba"` por si algún CSS lo necesita.
 *
 * SE CARGA SEGUNDO en el <head> de todas las pantallas, justo después de auth.js (de donde toma la
 * base) y antes de offline.js y tema.js, bloqueante como tema.js: son unas pocas líneas y las
 * constantes de cada pantalla lo necesitan al evaluarse. Está en el PRECACHE del service worker
 * (funciona sin señal, D82).
 *
 * LO QUE NO HACE: no toca auth.js (el token se pega por base de la API, así que sirve igual para
 * producción y prueba), ni la CSP (mismo host api.galca.app), ni el service worker (nunca intercepta
 * la API). La cola offline guarda la URL con cada ítem, así que un reporte capturado en prueba sube
 * a prueba aunque después se vuelva a producción — por eso conviene no cambiar de entorno con
 * envíos pendientes (ver OPERACIONES.md).
 */
var GALCA_ENV = (function(){
  'use strict';

  // D169: ninguna URL aquí. La base la da auth.js (cargado antes); prueba = misma base + /prueba.
  var A = window.TM2Auth || null;
  if(!A){ try{ console.error('[GALCA_ENV] auth.js no está cargado antes que entorno.js; sin URL de API.'); }catch(e){} }
  var BASE = (A && A.API_BASE) || '';
  var URLS = {
    produccion: {
      obra:        (A && A.url.obra)        || '',
      asistencias: (A && A.url.asistencias) || '',
      parte:       (A && A.url.parte)       || ''
    },
    prueba: {
      obra:        BASE ? BASE + '/prueba/obra'        : '',
      asistencias: BASE ? BASE + '/prueba/asistencias' : '',
      parte:       BASE ? BASE + '/prueba/parte'       : ''
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
    try{ console.warn('[GALCA_ENV] Se pidió el entorno de prueba pero auth.js no tiene base de API (rollback a Google); se sigue en producción.'); }catch(e){}
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

    // D170: el CSS del chip vivía aquí en un <style> inyectado; la CSP ya no lo admite. Está en
    // tema.css (y en tablero-produccion.css, la única pantalla que no carga tema.css).

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
    url: URLS[nombre],            // { obra, asistencias, parte } del entorno activo
    urls: URLS,
    configurado: configurado,     // ¿hay base de API para armar /prueba/…? (los secretos los decide el Worker)
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
