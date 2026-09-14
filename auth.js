/**
 * TM2 Sur — Token de sesión en el cliente (D109, backlog 2.25) + URL base de la API (D169)
 *
 * Adjunta el token FIRMADO que emitió el backend al entrar (D108) a TODA llamada dirigida a la API,
 * sea GET o POST. Se hace envolviendo `fetch` en vez de tocar los ~60 sitios donde las pantallas
 * llaman a la API: así es imposible que se quede una llamada sin token por descuido, que es
 * exactamente el tipo de olvido que deja un agujero abierto.
 *
 * D169 — ÚNICO SITIO DEL FRONTEND DONDE VIVE LA URL BASE DE LA API. Desde sep-2026 las pantallas ya
 * no hablan con script.google.com sino con el Worker de Cloudflare https://api.galca.app, que reenvía
 * a los Apps Script (sus URLs /exec son secretos del Worker; no están en este repo). Rutas:
 *   TM2Auth.url.obra         → API_BASE + '/obra'          (Codigo.gs: reportes, bandeja, DATA, tablero…)
 *   TM2Auth.url.asistencias  → API_BASE + '/asistencias'   (CodigoAsistencias.gs)
 *   TM2Auth.url.parte        → API_BASE + '/parte'         (CodigoParte.gs: formulario público por QR)
 * `entorno.js` (que se carga DESPUÉS de este archivo) arma con esto `GALCA_ENV.url` para producción
 * y para prueba (`/prueba/…`), y las pantallas siguen leyendo `GALCA_ENV.url.obra` / `.asistencias`.
 *
 * ROLLBACK (docs/OPERACIONES.md §9): si el Worker fallara, se vuelve a Google editando SOLO el bloque
 * `API` de abajo — `base: ''` y las tres URLs /exec completas en `rutas` — y devolviendo los dos
 * hosts de Google a la CSP de las pantallas. Nada más del código cambia.
 *
 * SE CARGA ANTES QUE NADA (antes de entorno.js y offline.js) en todas las páginas.
 *
 * POR QUÉ ESTO ARREGLA LO DEL MODO SIN CONEXIÓN: la cola de D82 reenvía con `fetch`, así que el token
 * se pega EN EL MOMENTO DEL ENVÍO, no cuando se capturó el reporte. Un reporte que pasó el fin de
 * semana en el teléfono sube con el token vigente, no con el que hubiera entonces. Y como el token no
 * caduca por reloj (vence por versión, ver D109 en el backend), sigue valiendo días después.
 *
 * El token NO es un secreto que haya que esconder del usuario: es SU sesión, y solo le sirve para
 * hacer lo que su propio rol ya le permite. Lo que impide es fabricarse otro rol o suplantar a otro,
 * porque va firmado con un secreto que nunca sale del servidor.
 */
(function(){
  'use strict';

  var KEY = 'tm2_token';

  // ---- URL base de la API (D169). Único sitio. -------------------------------------------------
  // `rutas` son relativas a `base`; una ruta que empiece por `http` se usa tal cual (rollback).
  var API = {
    base: 'https://api.galca.app',
    rutas: { obra: '/obra', asistencias: '/asistencias', parte: '/parte' }
  };
  var URL_API = {};
  for (var k in API.rutas){
    URL_API[k] = /^https?:\/\//i.test(API.rutas[k]) ? API.rutas[k] : API.base + API.rutas[k];
  }

  function leer(){ try{ return localStorage.getItem(KEY) || ''; }catch(e){ return ''; } }

  // ¿Va dirigida a la API? Cualquier URL bajo la base (producción y /prueba/… por igual) o, en
  // rollback, cualquiera que empiece por una de las URLs completas de `rutas`.
  function esAPI(url){
    var u = String(url||'');
    if (API.base && u.indexOf(API.base + '/') === 0) return true;
    for (var r in URL_API){ if (URL_API[r] && u.indexOf(URL_API[r]) === 0) return true; }
    return false;
  }

  var _fetch = window.fetch ? window.fetch.bind(window) : null;
  if(!_fetch) return;

  window.fetch = function(url, opts){
    try{
      var u = String(url || '');
      var t = leer();
      if(t && esAPI(u)){
        var metodo = String((opts && opts.method) || 'GET').toUpperCase();
        if(metodo === 'POST' && opts && typeof opts.body === 'string'){
          // El cuerpo de esta app siempre es JSON (con Content-Type text/plain, D31). Si por lo que
          // sea no lo fuera, se deja tal cual: mejor que la llamada falle por falta de token a
          // corromper un cuerpo que no entendemos.
          try{
            var b = JSON.parse(opts.body);
            if(b && typeof b === 'object' && !b.token){
              b.token = t;
              opts = Object.assign({}, opts, { body: JSON.stringify(b) });
            }
          }catch(e){ /* cuerpo no-JSON: no se toca */ }
        } else if(u.indexOf('token=') < 0){
          u += (u.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(t);
        }
      }
      return _fetch(u, opts);
    }catch(e){
      return _fetch(url, opts);   // ante cualquier duda, la llamada sale como habría salido sin esto
    }
  };

  window.TM2Auth = {
    /** Base del Worker (D169). Vacía solo en rollback a Google. */
    API_BASE: API.base,
    /** { obra, asistencias, parte } — URLs completas de producción. entorno.js las toma de aquí. */
    url: URL_API,
    esAPI: esAPI,
    get: leer,
    set: function(t){ try{ localStorage.setItem(KEY, String(t||'')); }catch(e){} },
    clear: function(){ try{ localStorage.removeItem(KEY); }catch(e){} },
    /**
     * ¿La respuesta dice que la sesión ya no vale? El backend contesta {ok:false, auth:false} cuando
     * el token falta, está alterado o quedó fuera por versión (y el Worker, D169, cuando ni siquiera
     * viene). Las pantallas de consolidación lo usan para mandar al login en vez de mostrar un error
     * críptico.
     */
    caducada: function(data){ return !!(data && data.ok === false && data.auth === false); }
  };
})();
