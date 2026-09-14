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

/* ============================================================================
 * CSP SIN 'unsafe-inline' (D170, sep-2026) — tres piezas compartidas
 *
 * La Content-Security-Policy de cada pantalla ya no permite JS ni CSS en
 * línea: el navegador IGNORA cualquier `onclick="…"`, `<script>` sin src,
 * `<style>` y `style="…"` que quede en el marcado (incluido el que se pinta
 * con innerHTML). Para que las pantallas sigan funcionando IGUAL sin tocar su
 * lógica, este archivo aporta:
 *
 *   1. `data-on-<evento>="fn(args)"` — sustituto de `on<evento>="…"`.
 *      Un solo par de escuchas en `document` (delegación) recorre desde el
 *      elemento pulsado hacia arriba, igual que burbujea el evento, y ejecuta
 *      lo que diga el atributo. NO es un eval: se admite únicamente una lista
 *      de llamadas `nombre(arg, …)` separadas por `;`, donde `nombre` es una
 *      función global de la pantalla (o `this.x()` / `event.x()`) y cada
 *      argumento es un literal — número, cadena, true/false/null, JSON de
 *      objeto/arreglo — o `this`/`event` con propiedades (`this.value`,
 *      `event.target`). Cualquier otra cosa se rechaza con un error en
 *      consola y no se ejecuta. `event.stopPropagation()` dentro corta el
 *      recorrido, como cortaba el burbujeo.
 *
 *   2. `data-estilo="…"` — sustituto de `style="…"`. Se aplica por CSSOM
 *      (`el.style`), que la CSP sí permite, en cuanto el elemento entra al
 *      DOM (MutationObserver) y de forma síncrona al arrancar cada pantalla
 *      (`TM2Estilos.aplicar()`, primera línea de su .js). Solo rellena las
 *      propiedades que el JS de la pantalla no haya fijado ya, así
 *      `el.style.display='block'` justo después de un innerHTML sigue
 *      ganando, como ganaba antes.
 *
 *   3. `irA(url)` / `recargar()` — lo que antes era `onclick="location.href=…"`.
 *
 * Todo esto vive aquí porque tema.js ya se carga BLOQUEANTE en el <head> de
 * todas las pantallas y está en el PRECACHE (funciona sin señal, D82).
 * ==========================================================================*/
function irA(url){ window.location.href = url; }
function recargar(){ window.location.reload(); }

var TM2Estilos = (function(){
  'use strict';
  var ATTR = 'data-estilo';

  function aplicarUno(el){
    if(el._tm2Estilo) return;
    var v = el.getAttribute(ATTR);
    if(v == null) return;
    el._tm2Estilo = true;
    if(!el.style.length){ el.style.cssText = v; return; }
    // El JS de la pantalla ya fijó algo por CSSOM: solo se rellena lo que falte.
    v.split(';').forEach(function(decl){
      var i = decl.indexOf(':'); if(i < 0) return;
      var prop = decl.slice(0, i).trim(), val = decl.slice(i + 1).trim(), pri = '';
      if(!prop) return;
      if(/!important$/i.test(val)){ val = val.replace(/\s*!important$/i, ''); pri = 'important'; }
      if(!el.style.getPropertyValue(prop)) el.style.setProperty(prop, val, pri);
    });
  }

  function aplicar(raiz){
    raiz = raiz || document;
    if(raiz.nodeType === 1 && raiz.hasAttribute && raiz.hasAttribute(ATTR)) aplicarUno(raiz);
    if(raiz.querySelectorAll){
      var lista = raiz.querySelectorAll('[' + ATTR + ']');
      for(var i = 0; i < lista.length; i++) aplicarUno(lista[i]);
    }
  }

  try{
    new MutationObserver(function(regs){
      for(var r = 0; r < regs.length; r++){
        var nodos = regs[r].addedNodes;
        for(var n = 0; n < nodos.length; n++) if(nodos[n].nodeType === 1) aplicar(nodos[n]);
      }
    }).observe(document.documentElement, { childList:true, subtree:true });
  }catch(e){}
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ aplicar(); });
  else aplicar();

  return { aplicar: aplicar };
})();

(function(){
  'use strict';

  // --- Intérprete mínimo de `data-on-*` (sin eval) ---------------------------
  function ejecutar(src, el, ev){
    var i = 0, n = src.length;
    function fallo(msg){ throw new Error(msg + ' en «' + src + '» (pos ' + i + ')'); }
    function ws(){ while(i < n && /\s/.test(src.charAt(i))) i++; }
    function ident(){
      var m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
      if(!m) fallo('se esperaba un nombre');
      i += m[0].length; return m[0];
    }
    function cadena(){
      var q = src.charAt(i), out = ''; i++;
      while(i < n && src.charAt(i) !== q){
        var c = src.charAt(i);
        if(c === '\\'){ i++; var e = src.charAt(i); out += (e === 'n') ? '\n' : (e === 't') ? '\t' : e; }
        else out += c;
        i++;
      }
      if(src.charAt(i) !== q) fallo('cadena sin cerrar');
      i++; return out;
    }
    function json(){
      var ini = i, prof = 0, enCad = null;
      for(; i < n; i++){
        var c = src.charAt(i);
        if(enCad){ if(c === '\\'){ i++; continue; } if(c === enCad) enCad = null; continue; }
        if(c === '"' || c === "'"){ enCad = c; continue; }
        if(c === '{' || c === '[') prof++;
        else if(c === '}' || c === ']'){ prof--; if(prof === 0){ i++; break; } }
      }
      if(prof !== 0) fallo('JSON sin cerrar');
      return JSON.parse(src.slice(ini, i));
    }
    function miembros(base){
      while(src.charAt(i) === '.'){ i++; var p = ident(); base = (base == null) ? undefined : base[p]; }
      return base;
    }
    function valor(){
      ws();
      var c = src.charAt(i);
      if(c === "'" || c === '"') return cadena();
      if(c === '{' || c === '[') return json();
      if(/[-\d.]/.test(c)){
        var m = /^-?(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
        if(!m) fallo('número inválido');
        i += m[0].length; return Number(m[0]);
      }
      var id = ident();
      if(id === 'true') return true;
      if(id === 'false') return false;
      if(id === 'null') return null;
      if(id === 'undefined') return undefined;
      if(id === 'this') return miembros(el);
      if(id === 'event') return miembros(ev);
      fallo('argumento no permitido: ' + id);
    }
    function llamada(){
      ws();
      var nombre = ident();
      if(nombre === 'return'){          // `return false` → preventDefault, como en un onclick
        ws(); var r = ident(); if(r !== 'false') fallo('solo se admite return false');
        ev.preventDefault(); return;
      }
      var ctx, fn;
      if(nombre === 'this' || nombre === 'event'){ ctx = (nombre === 'this') ? el : ev; }
      else { ctx = undefined; fn = window[nombre]; }
      while(src.charAt(i) === '.'){
        i++; var p = ident();
        if(fn === undefined && ctx === undefined) fallo('global inexistente: ' + nombre);
        var base = (fn !== undefined) ? fn : ctx;
        ctx = base; fn = base[p];
      }
      if(typeof fn !== 'function') fallo('no es una función: ' + nombre);
      ws(); if(src.charAt(i) !== '(') fallo('se esperaba «(»'); i++;
      var args = []; ws();
      if(src.charAt(i) !== ')'){
        for(;;){ args.push(valor()); ws(); if(src.charAt(i) === ','){ i++; continue; } break; }
      }
      if(src.charAt(i) !== ')') fallo('se esperaba «)»'); i++;
      return fn.apply(ctx, args);
    }
    for(;;){
      ws(); if(i >= n) break;
      llamada();
      ws(); if(src.charAt(i) === ';'){ i++; continue; }
      if(i < n) fallo('se esperaba «;»');
    }
  }

  function despachar(tipo, ev, soloObjetivo){
    var el = ev.target;
    if(el && el.nodeType !== 1) el = el.parentNode;
    for(; el && el.nodeType === 1; el = el.parentNode){
      var src = el.getAttribute('data-on-' + tipo);
      if(src != null){
        try{ ejecutar(src, el, ev); }
        catch(e){ console.error('[tm2 data-on-' + tipo + ']', e && e.message ? e.message : e); }
        if(ev.cancelBubble) break;
      }
      if(soloObjetivo) break;
    }
  }

  // Eventos que burbujean: escucha en fase de burbuja, como los on* en línea.
  ['click','input','change','mousedown','keydown','keyup','submit'].forEach(function(t){
    document.addEventListener(t, function(ev){ despachar(t, ev, false); }, false);
  });
  // focus/blur no burbujean: captura en document y SOLO el elemento que lo recibe.
  ['focus','blur'].forEach(function(t){
    document.addEventListener(t, function(ev){ despachar(t, ev, true); }, true);
  });
})();
