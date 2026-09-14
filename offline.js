/**
 * TM2 Sur — Modo sin conexión Nivel 2 (D82, backlog 2.8/2.8b)
 *
 * Módulo compartido de cola local + sincronización + caché de catálogos + UI de estado.
 * JS plano (sin módulos ES): se incluye con <script src="offline.js"></script> ANTES del
 * script de cada página y expone el objeto global TM2Offline.
 *
 * Páginas que lo cargan: shell (index, seleccion-reporte, menu) + capturas
 * (reporte-capataz, reporte-chequeadora, reporte-drenajes, asistencia).
 * Las pantallas de consolidación (encargado/residente/jefe/resúmenes) NO lo usan (D49/D82).
 *
 * Cola en localStorage clave `tm2_cola_envios`. Un ítem SOLO sale de la cola por éxito
 * confirmado del servidor (respuesta parseable con ok:true) o por descarte explícito del
 * usuario con doble confirmación. NUNCA se descarta automáticamente.
 *
 * También registra el service worker (sw.js, Nivel 3) con try/catch silencioso: si el
 * navegador no soporta SW, todo sigue funcionando como hoy.
 */
(function(){
  'use strict';

  var KEY_COLA = 'tm2_cola_envios';
  var KEY_LOCK = 'tm2_sync_lock';
  var LOCK_TTL_MS = 120000;         // candado huérfano (pestaña muerta) se considera vencido a los 2 min
  var TIMEOUT_ENVIO_MS = 15000;     // envío directo desde el formulario
  var TIMEOUT_SYNC_MS = 25000;      // reintento desde la cola (más generoso: señal pobre)

  var _syncing = false;             // candado en memoria (esta pestaña)
  var _lockId = null;               // id de nuestro candado en localStorage (anti doble-sync entre pestañas)
  var _timer = null;

  /* ---------- utilidades ---------- */

  function uuid(){
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // fallback manual v4 (WebView viejos sin randomUUID)
    var bytes;
    if (window.crypto && crypto.getRandomValues){ bytes = new Uint8Array(16); crypto.getRandomValues(bytes); }
    else { bytes = []; for (var i=0;i<16;i++) bytes.push(Math.floor(Math.random()*256)); }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var h = []; for (var j=0;j<16;j++) h.push(('0'+bytes[j].toString(16)).slice(-2));
    return h.slice(0,4).join('')+'-'+h.slice(4,6).join('')+'-'+h.slice(6,8).join('')+'-'+h.slice(8,10).join('')+'-'+h.slice(10,16).join('');
  }

  function leerCola(){
    try{
      var raw = localStorage.getItem(KEY_COLA);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    }catch(e){ return []; }
  }
  function guardarCola(arr){
    try{ localStorage.setItem(KEY_COLA, JSON.stringify(arr)); }catch(e){ /* cuota llena: el ítem vive en memoria de la página */ }
    pintarEstado();
  }

  function fetchTimeout(url, opts, ms){
    opts = opts || {};
    if (window.AbortController){
      var ctrl = new AbortController();
      opts.signal = ctrl.signal;
      var t = setTimeout(function(){ ctrl.abort(); }, ms);
      return fetch(url, opts).then(
        function(r){ clearTimeout(t); return r; },
        function(e){ clearTimeout(t); throw e; }
      );
    }
    // sin AbortController: carrera contra un timeout (el fetch sigue de fondo pero el flujo no se cuelga)
    return Promise.race([
      fetch(url, opts),
      new Promise(function(_, rej){ setTimeout(function(){ rej(new Error('timeout')); }, ms); })
    ]);
  }

  /* ---------- cola ---------- */

  function encolar(item){
    var it = {
      id: uuid(),
      tipo: item.tipo || 'reporte',
      url: item.url,
      payload: item.payload,                 // el body EXACTO que se habría enviado
      fecha_obra: item.fecha_obra || '',     // la fecha tecleada, NUNCA la del sync
      usuario: item.usuario || '',
      creado: new Date().toISOString(),
      intentos: 0,
      ultimo_error: ''
    };
    var cola = leerCola();
    cola.push(it);
    guardarCola(cola);
    programarTimer();
    return it;
  }

  function quitarDeCola(id){
    guardarCola(leerCola().filter(function(x){ return x.id !== id; }));
  }
  function marcarError(id, err){
    var cola = leerCola();
    for (var i=0;i<cola.length;i++){
      if (cola[i].id === id){ cola[i].intentos = (cola[i].intentos||0)+1; cola[i].ultimo_error = String(err||'').slice(0,300); break; }
    }
    guardarCola(cola);
  }

  function getEstado(){
    return { online: navigator.onLine, pendientes: leerCola().length };
  }

  /* candado anti-doble-sync entre pestañas: flag en memoria + {id,ts} en localStorage */
  function tomarCandado(){
    try{
      var raw = localStorage.getItem(KEY_LOCK);
      if (raw){
        var lock = JSON.parse(raw);
        if (lock && lock.ts && (Date.now() - lock.ts) < LOCK_TTL_MS && lock.id !== _lockId) return false;
      }
      _lockId = _lockId || uuid();
      localStorage.setItem(KEY_LOCK, JSON.stringify({ id:_lockId, ts:Date.now() }));
      return true;
    }catch(e){ return true; }
  }
  function refrescarCandado(){
    try{ localStorage.setItem(KEY_LOCK, JSON.stringify({ id:_lockId, ts:Date.now() })); }catch(e){}
  }
  function soltarCandado(){
    try{
      var raw = localStorage.getItem(KEY_LOCK);
      if (raw && JSON.parse(raw).id === _lockId) localStorage.removeItem(KEY_LOCK);
    }catch(e){}
  }

  /**
   * D169: la URL a la que sube un ítem sale de auth.js (`TM2Auth`), no de lo que se guardó al
   * encolar. Un ítem guardado con la URL actual de la API se respeta (así lo capturado en prueba
   * sube a prueba, D168); uno guardado con una URL de OTRA base —la de Google, de antes del Worker,
   * que la CSP ya no deja salir; o la del Worker, tras un rollback— se re-dirige por su `tipo` al
   * entorno activo. Nada se descarta: como mucho cambia el destino, nunca el payload.
   */
  function urlDeEnvio(it){
    var A = window.TM2Auth;
    if (!A || !A.esAPI) return it.url;
    if (A.esAPI(it.url)) return it.url;
    var u = (window.GALCA_ENV && GALCA_ENV.url) || A.url || {};
    return (it.tipo === 'asistencia' ? u.asistencias : u.obra) || it.url;
  }

  /**
   * Recorre la cola en orden (FIFO) y reintenta cada envío. Solo elimina un ítem con éxito
   * CONFIRMADO del servidor (respuesta parseable con ok:true — mismo criterio que el envío
   * normal, D30). Un ítem que falla incrementa `intentos`, guarda `ultimo_error` y NO bloquea
   * a los siguientes. Nada se descarta automáticamente.
   */
  function sincronizar(){
    if (_syncing) return Promise.resolve(0);
    // navigator.onLine === false es fiable (sin interfaz de red): no quemar intentos en vano
    if (!navigator.onLine){ pintarEstado(); return Promise.resolve(0); }
    if (leerCola().length === 0){ pintarEstado(); return Promise.resolve(0); }
    if (!tomarCandado()) return Promise.resolve(0);
    _syncing = true;
    pintarEstado(true);
    var ids = leerCola().map(function(x){ return x.id; });   // snapshot FIFO
    var subidos = 0;

    function paso(k){
      if (k >= ids.length) return Promise.resolve();
      var it = leerCola().filter(function(x){ return x.id === ids[k]; })[0];
      if (!it) return paso(k+1);                              // otra pestaña ya lo subió/descartó
      refrescarCandado();
      return fetchTimeout(urlDeEnvio(it), {
        method:'POST',
        headers:{ 'Content-Type':'text/plain;charset=utf-8' },
        body: JSON.stringify(it.payload)
      }, TIMEOUT_SYNC_MS)
      .then(function(resp){ return resp.json(); })
      .then(function(res){
        if (res && res.ok === true){ quitarDeCola(it.id); subidos++; }
        else marcarError(it.id, (res && res.error) || 'El servidor respondió sin confirmación');
      })
      .catch(function(err){ marcarError(it.id, (err && err.message) || err); })
      .then(function(){ return paso(k+1); });
    }

    return paso(0).then(function(){
      _syncing = false;
      soltarCandado();
      pintarEstado();
      if (subidos > 0) toast('✓ '+subidos+' reporte'+(subidos===1?'':'s')+' subido'+(subidos===1?'':'s')+' al servidor');
      return subidos;
    });
  }

  /**
   * Envío con rama offline: intenta el POST directo (timeout ~15 s). Si el servidor RESPONDE
   * (parseable), devuelve {enviado:true, res} — la página decide con res.ok como hoy. Si no hay
   * red / timeout / respuesta ilegible, ENCOLA y devuelve {enviado:false, encolado:true, item}.
   * La página debe mostrar la confirmación NARANJA de encolado, nunca la verde de servidor.
   */
  function enviarConCola(o){
    return fetchTimeout(o.url, {
      method:'POST',
      headers:{ 'Content-Type':'text/plain;charset=utf-8' },
      body: JSON.stringify(o.payload)
    }, o.timeoutMs || TIMEOUT_ENVIO_MS)
    .then(function(resp){ return resp.json(); })
    .then(function(res){ return { enviado:true, res:res }; })
    .catch(function(err){
      var item = encolar({ tipo:o.tipo, url:o.url, payload:o.payload, fecha_obra:o.fecha_obra, usuario:o.usuario });
      return { enviado:false, encolado:true, item:item, error:String((err && err.message) || err) };
    });
  }

  /* ---------- caché-fallback de catálogos (D82 §2.7) ---------- */

  /**
   * Patrón genérico: intenta traer fresco del backend con fetchFn() (async → data). Si lo logra,
   * guarda {data, guardado} en localStorage `tm2_cat_<clave>` y devuelve {data, guardado, fresco:true}.
   * Si falla (offline) devuelve la copia guardada {data, guardado, fresco:false, vencido} — `vencido`
   * solo es informativo (copia más vieja que maxEdadHoras); NUNCA se bloquea por antigüedad.
   * Sin copia guardada: relanza el error para que la página muestre "necesitas abrir esta
   * pantalla con señal al menos una vez".
   */
  function catalogoCache(clave, fetchFn, maxEdadHoras){
    var KEY = 'tm2_cat_' + clave;
    return Promise.resolve().then(fetchFn).then(function(data){
      try{ localStorage.setItem(KEY, JSON.stringify({ data:data, guardado:new Date().toISOString() })); }catch(e){}
      return { data:data, guardado:new Date().toISOString(), fresco:true, vencido:false };
    }).catch(function(err){
      var raw = null;
      try{ raw = localStorage.getItem(KEY); }catch(e){}
      if (raw){
        try{
          var o = JSON.parse(raw);
          var edadH = (Date.now() - new Date(o.guardado).getTime()) / 36e5;
          return { data:o.data, guardado:o.guardado, fresco:false, vencido: maxEdadHoras ? edadH > maxEdadHoras : false };
        }catch(e){ /* copia corrupta: cae al throw */ }
      }
      throw err;
    });
  }

  // "catálogo del DD/MM" para los avisos de copia vieja
  function fechaCorta(iso){
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return ('0'+d.getDate()).slice(-2)+'/'+('0'+(d.getMonth()+1)).slice(-2);
  }

  /* ---------- UI de estado (chip + panel de cola + toast) ---------- */

  var CSS = ''
    +'.tm2off-chip{display:inline-flex;align-items:center;gap:6px;font-family:"DM Sans",sans-serif;font-size:11px;font-weight:600;'
    +'padding:3px 10px;border-radius:20px;border:1px solid var(--border,#2e3450);background:var(--input-bg,#12151f);color:var(--muted,#7a80a0);'
    +'margin-top:6px;cursor:default;user-select:none;}'
    +'.tm2off-chip.tm2off-fixed{position:fixed;top:10px;right:10px;z-index:60;margin:0;}'
    +'.tm2off-chip .tm2off-dot{width:8px;height:8px;border-radius:50%;background:#2ecc71;flex-shrink:0;}'
    +'.tm2off-chip.off .tm2off-dot{background:var(--accent,#f5a623);}'
    +'.tm2off-chip.off{border-color:rgba(245,166,35,0.45);color:var(--accent,#f5a623);}'
    +'.tm2off-chip .tm2off-pend{background:var(--accent,#f5a623);color:#0f1117;border-radius:12px;padding:1px 7px;font-size:10px;font-weight:700;}'
    +'.tm2off-chip.haspend{cursor:pointer;}'
    +'.tm2off-panel{position:fixed;left:12px;right:12px;bottom:90px;max-width:560px;margin:0 auto;z-index:70;'
    +'background:var(--surface,#1a1d27);border:1px solid var(--accent,#f5a623);border-radius:14px;padding:16px;box-shadow:0 12px 40px rgba(0,0,0,0.55);'
    +'font-family:"DM Sans",sans-serif;font-size:13px;color:var(--text,#e8eaf0);display:none;max-height:60vh;overflow-y:auto;}'
    +'.tm2off-panel.abierto{display:block;}'
    +'.tm2off-panel h3{font-family:"Syne",sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:var(--accent,#f5a623);margin:0 0 10px;}'
    +'.tm2off-item{border:1px solid var(--border,#2e3450);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:var(--input-bg,#12151f);}'
    +'.tm2off-item .t{font-weight:600;font-size:12.5px;}'
    +'.tm2off-item .d{font-size:11px;color:var(--muted,#7a80a0);margin-top:3px;line-height:1.5;}'
    +'.tm2off-item .e{font-size:11px;color:var(--accent,#f5a623);margin-top:3px;word-break:break-word;}'
    +'.tm2off-item .acc{margin-top:8px;display:flex;gap:8px;}'
    +'.tm2off-btn{background:none;border:1px solid var(--border,#2e3450);border-radius:6px;color:var(--muted,#7a80a0);'
    +'font-family:"DM Sans",sans-serif;font-size:11px;padding:4px 10px;cursor:pointer;}'
    +'.tm2off-btn.acc1{border-color:var(--accent,#f5a623);color:var(--accent,#f5a623);}'
    +'.tm2off-btn.peligro{border-color:rgba(231,76,60,0.5);color:#e74c3c;}'
    +'.tm2off-vacio{color:var(--muted,#7a80a0);font-size:12px;text-align:center;padding:8px 0;}'
    +'.tm2off-toast{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:90;background:#173325;'
    +'border:1px solid rgba(46,204,113,0.5);color:#2ecc71;border-radius:10px;padding:10px 18px;font-family:"DM Sans",sans-serif;'
    +'font-size:13px;font-weight:600;box-shadow:0 8px 30px rgba(0,0,0,0.5);opacity:0;transition:opacity 0.3s;pointer-events:none;max-width:90vw;}'
    +'.tm2off-toast.visible{opacity:1;}'
    +'.tm2off-banner-cat{background:rgba(245,166,35,0.08);border:1px solid rgba(245,166,35,0.35);border-radius:10px;'
    +'padding:9px 12px;font-size:12px;color:var(--accent,#f5a623);margin:0 0 12px;font-family:"DM Sans",sans-serif;}';

  var _chip=null, _panel=null, _toastEl=null, _panelAbierto=false;

  function montarUI(){
    if (_chip || !document.body) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    _chip = document.createElement('div');
    _chip.className = 'tm2off-chip';
    _chip.setAttribute('title','Estado de la señal y envíos pendientes');
    var host = document.querySelector('.header-left');
    if (host) host.appendChild(_chip);
    else { _chip.classList.add('tm2off-fixed'); document.body.appendChild(_chip); }
    _chip.addEventListener('click', function(){
      if (leerCola().length === 0) return;
      _panelAbierto = !_panelAbierto;
      pintarEstado();
    });

    _panel = document.createElement('div');
    _panel.className = 'tm2off-panel';
    document.body.appendChild(_panel);

    _toastEl = document.createElement('div');
    _toastEl.className = 'tm2off-toast';
    document.body.appendChild(_toastEl);

    pintarEstado();
  }

  function pintarEstado(sincronizando){
    if (!_chip) return;
    var st = getEstado();
    _chip.classList.toggle('off', !st.online);
    _chip.classList.toggle('haspend', st.pendientes > 0);
    var txt = st.online ? 'Con señal' : 'Sin señal';
    if (sincronizando) txt = 'Sincronizando…';
    _chip.innerHTML = '<span class="tm2off-dot"></span>' + txt
      + (st.pendientes > 0 ? ' <span class="tm2off-pend">'+st.pendientes+' pendiente'+(st.pendientes===1?'':'s')+'</span>' : '');
    if (st.pendientes === 0) _panelAbierto = false;
    pintarPanel();
  }

  // Escape de HTML: usa el `esc()` compartido de tema.js (D167). Resuelto en cada llamada y con
  // respaldo idéntico, para que el panel de la cola no dependa del orden de carga de los scripts.
  function escUI(s){
    if (typeof esc === 'function') return esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
  }
  function pintarPanel(){
    if (!_panel) return;
    var cola = leerCola();
    if (!_panelAbierto || !cola.length){ _panel.classList.remove('abierto'); return; }
    var html = '<h3>📥 Envíos pendientes ('+cola.length+')</h3>';
    cola.forEach(function(it){
      html += '<div class="tm2off-item">'
        + '<div class="t">'+(it.tipo==='asistencia'?'👷 Asistencia':'📋 Reporte')+' · fecha de obra '+escUI(it.fecha_obra||'—')+'</div>'
        + '<div class="d">'+escUI(it.usuario||'')+' · guardado '+escUI((it.creado||'').replace('T',' ').slice(0,16))+' · '+(it.intentos||0)+' intento'+(it.intentos===1?'':'s')+'</div>'
        + ((it.ultimo_error)?('<div class="e">Último error: '+escUI(it.ultimo_error)+'</div>'):'')
        + '<div class="acc">'
        + '<button class="tm2off-btn" onclick="TM2Offline._copiarItem(\''+escUI(String(it.id).replace(/'/g,"\\'"))+'\')">Copiar texto</button>'
        + '<button class="tm2off-btn peligro" onclick="TM2Offline._descartarItem(\''+escUI(String(it.id).replace(/'/g,"\\'"))+'\')">Descartar</button>'
        + '</div></div>';
    });
    html += '<div class="acc" style="display:flex;gap:8px;margin-top:4px;">'
      + '<button class="tm2off-btn acc1" onclick="TM2Offline.sincronizar()">↻ Reintentar ahora</button>'
      + '<button class="tm2off-btn" onclick="TM2Offline._cerrarPanel()">Cerrar</button></div>';
    _panel.innerHTML = html;
    _panel.classList.add('abierto');
  }

  // Salvavidas manual: dump JSON legible del payload para dictarlo/pegarlo si un ítem nunca sube.
  function _copiarItem(id){
    var it = leerCola().filter(function(x){ return x.id===id; })[0];
    if (!it) return;
    var txt = JSON.stringify({ tipo:it.tipo, fecha_obra:it.fecha_obra, usuario:it.usuario, creado:it.creado,
      intentos:it.intentos, ultimo_error:it.ultimo_error, url:it.url, payload:it.payload }, null, 2);
    var done = function(){ toast('✓ Copiado al portapapeles'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, function(){ window.prompt('Copia el texto:', txt); });
    else window.prompt('Copia el texto:', txt);
  }

  // Descartar SOLO por acción explícita del usuario, con confirmación doble (pérdida definitiva).
  function _descartarItem(id){
    var it = leerCola().filter(function(x){ return x.id===id; })[0];
    if (!it) return;
    if (!confirm('⚠️ Vas a DESCARTAR un envío pendiente ('+(it.tipo==='asistencia'?'asistencia':'reporte')+' del '+(it.fecha_obra||'—')+').\n\nEste reporte NO está en el servidor y se perderá para siempre.\n\n¿Continuar?')) return;
    if (!confirm('ÚLTIMA CONFIRMACIÓN:\n\n¿Seguro que quieres borrar este envío pendiente definitivamente?\n\nSi tienes duda, usa antes "Copiar texto" como respaldo.')) return;
    quitarDeCola(id);
    pintarEstado();
  }
  function _cerrarPanel(){ _panelAbierto = false; pintarEstado(); }

  var _toastTimer = null;
  function toast(msg){
    if (!_toastEl) return;
    _toastEl.textContent = msg;
    _toastEl.classList.add('visible');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function(){ _toastEl.classList.remove('visible'); }, 4000);
  }

  // Banner ámbar informativo (catálogo viejo). La página lo inserta donde le convenga.
  function bannerCatalogoViejo(contenedor, texto){
    if (!contenedor) return;
    var div = document.createElement('div');
    div.className = 'tm2off-banner-cat';
    div.textContent = '⚠ ' + texto;
    contenedor.insertBefore(div, contenedor.firstChild);
    return div;
  }

  /* ---------- disparadores de sincronización ---------- */

  function programarTimer(){
    if (_timer) return;
    _timer = setInterval(function(){
      if (navigator.onLine && leerCola().length > 0) sincronizar();
      else pintarEstado();
    }, 60000);
  }

  function init(){
    montarUI();
    window.addEventListener('online', function(){ pintarEstado(); sincronizar(); });
    window.addEventListener('offline', function(){ pintarEstado(); });
    // si otra pestaña tocó la cola, refleja el cambio
    window.addEventListener('storage', function(ev){ if (ev.key === KEY_COLA) pintarEstado(); });
    if (leerCola().length > 0){ programarTimer(); sincronizar(); }
    // Nivel 3 (D82): registro del service worker. Silencioso: sin soporte de SW todo sigue igual.
    try{
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(function(){});
    }catch(e){}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.TM2Offline = {
    uuid: uuid,
    encolar: encolar,
    sincronizar: sincronizar,
    enviarConCola: enviarConCola,
    getEstado: getEstado,
    catalogoCache: catalogoCache,
    fechaCorta: fechaCorta,
    bannerCatalogoViejo: bannerCatalogoViejo,
    toast: toast,
    _copiarItem: _copiarItem,
    _descartarItem: _descartarItem,
    _cerrarPanel: _cerrarPanel
  };
})();
