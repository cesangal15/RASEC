/* ============================================================================
 * TEMA — claro / oscuro (D150)
 *
 * Dos trabajos, y el orden importa:
 *
 *   1. ANTES DE PINTAR. Este archivo se carga con <script src> en el <head>,
 *      o sea BLOQUEANTE a propósito: aplica `data-tema` en <html> antes de que
 *      el navegador pinte nada. Si se cargara al final, o con defer, se vería
 *      el parpadeo de blanco a negro (o al revés) en cada carga de cada
 *      pantalla. Son ~40 líneas: el bloqueo es despreciable y el parpadeo no.
 *
 *   2. EL INTERRUPTOR. Es UN SOLO botón que alterna, como en cualquier app:
 *      se pulsa donde sea y cambia. Muestra el icono del modo AL QUE VA a
 *      cambiar, no el actual — la luna significa «pásame a oscuro».
 *
 *      Dónde se coloca, por orden: si la pantalla declara un `#tm2-tema-slot`,
 *      ahí (el login lo usa para meterlo en su pie); si no, dentro de
 *      `.header-user`, que existe en 16 de las 18 pantallas — el mismo truco
 *      que usa offline.js con el chip de señal, y por eso no hay que tocar el
 *      marcado de ninguna cabecera; y si no hay nada de eso, fijo abajo a la
 *      izquierda. Arriba NO: la esquina superior derecha se la queda el chip
 *      de señal cuando tampoco encuentra `.header-left`, y la izquierda la
 *      ocupa la marca del login.
 *
 * SIN ELEGIR NADA no se escribe `data-tema`: manda el modo del teléfono, que
 * es lo que queremos en obra. Muchos Android lo cambian solos con la luz
 * ambiente, así que quien sale al sol se lleva el claro sin tocar nada.
 * ==========================================================================*/
/* ============================================================================
 * esc() — ESCAPE DE HTML COMPARTIDO (endurecimiento del frontend, sep-2026)
 *
 * Todo texto que venga del Sheet (bandeja, DATA, roster, personal, usuarios…),
 * de un catálogo vivo (flota, ítems de drenajes, tramos, CC) o de lo que la
 * persona tecleó, pasa por aquí ANTES de meterse con `innerHTML`. Convierte
 * & < > " ' en entidades: el navegador muestra EXACTAMENTE el mismo texto que
 * antes (las entidades se decodifican al pintar), pero un valor con `<script>`
 * o `onerror=` dentro deja de ser marcado y pasa a ser texto.
 *
 * Vive aquí y no en cada pantalla porque `tema.js` ya se carga BLOQUEANTE en
 * el <head> de las 23 pantallas (D150) y está en el PRECACHE del service
 * worker (funciona sin señal, D82). Antes había 12 copias locales con dos
 * variantes (con y sin la comilla simple); esta es la unión de las dos.
 *
 * Es global a propósito (script clásico, sin módulo): las pantallas la llaman
 * como `esc(x)` igual que llamaban a su copia local. NO se usa al armar
 * payloads, WhatsApp, CSV ni portapapeles — solo al pintar HTML.
 * ==========================================================================*/
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

(function(){
  'use strict';
  var LLAVE = 'tm2_tema';   // 'claro' | 'oscuro' | ausente = lo que diga el teléfono

  function leer(){
    try{
      var v = localStorage.getItem(LLAVE);
      return (v === 'claro' || v === 'oscuro') ? v : null;
    }catch(e){ return null; }   // almacenamiento bloqueado: se sigue con el del teléfono
  }

  function aplicar(t){
    if(t) document.documentElement.setAttribute('data-tema', t);
    else  document.documentElement.removeAttribute('data-tema');
  }

  // --- 1. Antes de pintar ---------------------------------------------------
  aplicar(leer());

  // --- 2. El interruptor ----------------------------------------------------
  function temaEfectivo(){
    var t = leer();
    if(t) return t;
    try{
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'claro' : 'oscuro';
    }catch(e){ return 'oscuro'; }
  }

  var pintar = function(){};   // lo define montar(); montarEscucha() lo necesita fuera

  function montar(){
    if(document.querySelector('.tm2-tema')) return;

    var caja = document.createElement('div');
    caja.className = 'tm2-tema';

    var boton = document.createElement('button');
    boton.type = 'button';

    // El icono es el DESTINO, no el estado actual: en claro se ve la luna
    // («pásame a oscuro»), en oscuro el sol. Es la convención que espera la
    // gente y evita la duda de «¿esto me dice dónde estoy o adónde voy?».
    pintar = function(){
      var voyA = (temaEfectivo() === 'claro') ? 'oscuro' : 'claro';
      boton.textContent = (voyA === 'oscuro') ? '\u263E' : '\u2600';
      boton.title = (voyA === 'oscuro') ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro';
      boton.setAttribute('aria-label', boton.title);
    };

    boton.addEventListener('click', function(){
      var voyA = (temaEfectivo() === 'claro') ? 'oscuro' : 'claro';
      try{ localStorage.setItem(LLAVE, voyA); }catch(e){}
      aplicar(voyA);
      pintar();
    });

    caja.appendChild(boton);
    pintar();

    // 1) La pantalla manda: si declara un hueco, ahí va. Lo usa el login para
    //    meterlo en su pie, donde no tapa la marca ni choca con el chip.
    var hueco = document.getElementById('tm2-tema-slot');
    if(hueco){ hueco.appendChild(caja); montarEscucha(); return; }

    // 2) Si no, junto al usuario en la cabecera. Ojo: `.header` es flex con
    //    `space-between`, así que como TERCER hermano quedaría flotando en
    //    mitad de la cabecera; por eso se envuelve junto a `.header-user`.
    //    El envoltorio no rompe nada: `querySelector('.header-user')` sigue
    //    encontrándolo, y `#btnMenu` y «Salir» siguen dentro de él.
    var casa = document.querySelector('.header-user');
    if(casa && casa.parentNode){
      var grupo = document.createElement('div');
      grupo.className = 'tm2-tema-grupo';
      casa.parentNode.insertBefore(grupo, casa);
      grupo.appendChild(caja);
      grupo.appendChild(casa);
    } else {
      // 3) Último recurso: fijo ABAJO a la izquierda. Arriba está ocupado —
      //    derecha el chip de señal, izquierda la marca.
      caja.classList.add('tm2-tema-fijo');
      document.body.appendChild(caja);
    }
    montarEscucha();
  }

  // Sin elección guardada, el botón sigue al teléfono en vivo.
  function montarEscucha(){
    try{
      var mq = window.matchMedia('(prefers-color-scheme: light)');
      var alCambiar = function(){ if(!leer()) pintar(); };
      if(mq.addEventListener) mq.addEventListener('change', alCambiar);
      else if(mq.addListener) mq.addListener(alCambiar);
    }catch(e){}
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();
