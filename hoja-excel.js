/* ============================================================================
 * HOJA EXCEL (D230) — las comodidades de Excel que comparten TODAS las cuadrículas editables de Galca:
 * Revisión de DATA (data.js), Catálogos (catalogos.js) y el motor cuadricula.js (Revisión de partes: Hoja y Base).
 * Se monta ENCIMA del motor de cada pantalla con un adaptador (qué filas y columnas hay, cómo se lee y se fija una
 * celda, cómo se deshace) y le añade, igual en todas:
 *
 *   · Barra de fórmulas: cuadro de nombre («Fila 12 · CC» o «4F × 2C») y el contenido COMPLETO de la celda activa,
 *     editable ahí (Enter fija y baja, Tab a la derecha, Ctrl+Enter lo pone en toda la selección, Esc cancela).
 *   · Barra de estado: modo (Listo / Modificar / pegar…), «N de M filas» si hay filtro y Recuento · Suma ·
 *     Promedio · Mín · Máx de lo marcado (las cifras salen de las columnas numéricas; clic en una la copia).
 *   · Controlador de relleno: el cuadrito de la esquina de la selección se arrastra hacia abajo o hacia arriba y
 *     repite lo marcado (como Excel con texto); doble clic rellena hasta donde llega el bloque de la columna vecina.
 *   · Encabezados: clic selecciona la columna (Shift o arrastre: varias); ▾ abre ordenar, filtrar CUALQUIER columna
 *     (casillas con recuento, «(Vacías)», buscador, «solo»), ajustar texto, autoajustar ancho, ancho por defecto e
 *     inmovilizar hasta esa columna; doble clic en el borde autoajusta el ancho. Clic en el nº de fila selecciona la
 *     fila (Shift o arrastre: varias); la esquina «#», todo. Encabezados y nº de fila de la selección resaltados.
 *   · Portapapeles: marco punteado de lo copiado; Ctrl+X corta (se mueve al pegar en la hoja); pegar un valor o un
 *     bloque sobre una selección mayor (múltiplo) lo repite; lo de solo lectura no se toca.
 *   · Teclado: Ctrl+Enter al editar llena la selección; Shift+Enter confirma y sube; Enter tras una serie de Tab
 *     vuelve a la columna donde empezó (fila siguiente); Alt+↓ abre la lista; Ctrl+; fecha de hoy y Ctrl+: hora
 *     (en columnas de fecha / hora); Shift+F10 menú; Ctrl+F buscador; Esc quita el marco de copia.
 *
 * Nada de servidor: todo cambio pasa por el `lote(fijar)` del motor (su deshacer, sus derivaciones y su «sin guardar»).
 * CSP D170: sin estilos en línea; las reglas por columna (inmovilizar, ajustar texto) van en una hoja construible
 * (adoptedStyleSheets) y, si el navegador no la tiene, por CSSOM en hoja-excel.css. Preferencias por navegador:
 * `<almacen>_fijas` y `<almacen>_ajustar` en localStorage.
 *
 *   const hx = TM2HojaExcel.montar(adaptador)   → ver ADAPTADOR abajo
 *   el motor llama: hx.alPintarCab() · hx.alAnchos() · hx.alPintar() · hx.alSeleccionar() · hx.pasa(fila)
 *   y usa: hx.copiar() · hx.cortar() · hx.pegarPortapapeles() · hx.limpiarFiltros() · hx.hayFiltros() · hx.nFiltros()
 * ==========================================================================*/
(function(){
  'use strict';
  const escH = (typeof esc === 'function') ? esc : function(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); };
  function normN(s){ return String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toLowerCase(); }
  // Número de un valor crudo («12.5», 12.5, «12,5») o mostrado es-CO («1.234,5»). Vacío / texto → null.
  function numN(v){
    if(v===''||v===null||v===undefined||typeof v==='boolean') return null;
    if(typeof v==='number') return isFinite(v)?v:null;
    let s=String(v).trim().replace(/\s/g,''); if(!s) return null;
    if(s.indexOf(',')>=0 && s.indexOf('.')>=0) s=s.replace(/\./g,'').replace(',','.'); else s=s.replace(',','.');
    if(!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
    const n=Number(s); return isFinite(n)?n:null;
  }
  const NF2=new Intl.NumberFormat('es-CO',{maximumFractionDigits:2});
  function fmtN(n){ return NF2.format(n); }
  // Fecha escrita o pegada (de Excel sale «30/09/2026») → AAAA-MM-DD; con hora ISO se deja; lo que no es fecha → null.
  function aFecha(v){
    const s=String(v==null?'':v).trim(); if(!s) return '';
    if(/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}.*)?$/.test(s)) return s;
    const m=s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/); if(!m) return null;   // día primero, como en Colombia
    let d=+m[1], mo=+m[2], y=+m[3]; if(y<100) y+=2000;
    const dt=new Date(Date.UTC(y,mo-1,d)); if(dt.getUTCFullYear()!==y || dt.getUTCMonth()!==mo-1 || dt.getUTCDate()!==d) return null;
    return y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  }
  // Hora «7», «7:5»… → HH:MM; lo que no es hora → null.
  function aHora(v){
    const s=String(v==null?'':v).trim(); if(!s) return '';
    const m=s.match(/^(\d{1,2})(?:[:.h](\d{1,2}))?(?::\d{2})?$/i); if(!m || +m[1]>23 || (m[2]!==undefined && +m[2]>59)) return null;
    return String(+m[1]).padStart(2,'0')+':'+String(m[2]===undefined ? 0 : +m[2]).padStart(2,'0');
  }
  function hoyBog(){ return new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'}); }
  function horaBog(){ return new Date().toLocaleTimeString('en-GB',{timeZone:'America/Bogota',hour:'2-digit',minute:'2-digit',hour12:false}); }
  function lsGet(k,def){ try{ const v=localStorage.getItem(k); return v==null?def:v; }catch(e){ return def; } }
  function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
  function alPortapapeles(t){
    function fb(x){ const ta=document.createElement('textarea'); ta.value=x; ta.setAttribute('readonly',''); ta.className='hx-oculto'; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); }catch(e){} ta.remove(); }
    try{ if(navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).catch(function(){ fb(t); }); }catch(e){}
    fb(t); return Promise.resolve();
  }
  const ICONO='<svg class="i-v" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.6 5 6.6 8 3.6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
             +'<svg class="i-f" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1.5h8L6 5.3V9L4 8V5.3z" fill="currentColor"/></svg>';
  const ATAJOS_BASE=[
    ['Clic en el nº de fila / en el encabezado','Marca la fila / la columna (Shift o arrastrar: varias) · la esquina «#» marca todo'],
    ['▾ en el encabezado','Ordenar, filtrar esa columna, ajustar texto, ancho e inmovilizar'],
    ['Doble clic en el borde del encabezado','Autoajusta el ancho al contenido'],
    ['Cuadrito de la esquina','Arrástralo para rellenar hacia abajo o arriba · doble clic: hasta el final del bloque'],
    ['Escribir / F2 / Enter','Editar · Esc cancela · Tab pasa a la siguiente · Shift+Enter sube'],
    ['Ctrl+Enter (editando)','Pone lo escrito en TODAS las celdas marcadas'],
    ['Ctrl+C / Ctrl+X / Ctrl+V','Copiar / cortar (se mueve al pegar) / pegar · un valor sobre varias celdas se repite'],
    ['Ctrl+D · Supr','Rellenar hacia abajo · vaciar'],
    ['Ctrl+Z / Ctrl+Y','Deshacer / rehacer'],
    ['Alt+↓','Abre la lista de la celda'],
    ['Ctrl+; · Ctrl+:','Fecha de hoy · hora actual (en columnas de fecha / hora)'],
    ['Ctrl+flechas · Shift','Saltar al borde del bloque · marcar'],
    ['Shift+Espacio · Ctrl+Espacio · Ctrl+A','Marcar la fila · la columna · todo'],
    ['Ctrl+F · Shift+F10','Buscar · menú del clic derecho']
  ];
  let N=0;

  /* ADAPTADOR (lo que da cada motor):
   *   wrap, cuerpo (tbody), cab (tr del thead), celdaSel ('td.cell'), valorSel ('.cv'), numFilaSel ('td.rownum'),
   *   clases {sel, act, deriv}, almacen (texto o función: prefijo de localStorage), puedeEditar (bool o función),
   *   filas() visibles en orden · cols() · todas() · pasaMotor(fila) (filtros propios del motor, sin buscador),
   *   valor/copia/texto/mostrar(fila,col) · editable(fila,col) · barraEditable(fila,col) · tipoDe(col) → 'num'|'fecha'|'hora'|'otro',
   *   rango() · activa() · ancla() · marcar(r0,c0,r1,c1) · activar(r,c) · editando() · abrirEditor(r,c) ·
   *   confirmarEditor(dr,dc) · cancelarEditor() · lote(fn(fijar), msg) → nº de celdas cambiadas · repintar() ·
   *   orden() → {c,dir} · ordenar(c,dir) · fijarAncho(c,px|null) · filtroMotor(c) → {valores(), marcados(), fijar()} | null ·
   *   menu() · buscar (input) · aviso(msg,err) · cerrarMenus() · atajos ([[tecla,texto]] extra → botón ⌨ en la barra)
   */
  function montar(o){
    const wrap=o.wrap, cuerpo=o.cuerpo||wrap.querySelector('tbody'), cab=o.cab||wrap.querySelector('thead tr');
    const SEL=o.celdaSel||'td[data-c]', VAL=o.valorSel||'div', RN=o.numFilaSel||'td:first-child';
    const CL=Object.assign({ sel:'sel', act:'activa', deriv:'deriv' }, o.clases||{});
    if(!wrap.id) wrap.id='hx-g'+(++N);
    const ID=wrap.id;
    wrap.classList.add('hx-wrap');
    const edita=(typeof o.puedeEditar==='function') ? o.puedeEditar : function(){ return !!o.puedeEditar; };
    const almacen=(typeof o.almacen==='function') ? o.almacen : function(){ return o.almacen||''; };
    const filas=o.filas, cols=o.cols;
    const valor=o.valor||function(f,c){ return f?f[c.k]:''; };
    const copia=o.copia||function(f,c){ const v=valor(f,c); return v==null?'':String(v); };
    const texto=o.texto||copia, mostrar=o.mostrar||copia;
    const editable=o.editable||function(){ return edita(); };
    const barraEditable=o.barraEditable||editable;
    const tipoDe=o.tipoDe||function(){ return 'otro'; };
    const aviso=function(m,err){ if(o.aviso) o.aviso(m,err); };

    /* ---------- barra de fórmulas (arriba) y barra de estado (abajo) ---------- */
    const barra=document.createElement('div'); barra.className='hx-barra';
    barra.innerHTML='<div class="hx-nombre" title="Celda activa">—</div><span class="hx-fx" aria-hidden="true">fx</span>'
      +'<input type="text" class="hx-formula" spellcheck="false" autocomplete="off" aria-label="Contenido de la celda activa" placeholder="Elige una celda para ver su contenido completo">'
      +(o.atajos ? '<button type="button" class="hx-kbd" title="Atajos de teclado" aria-label="Atajos de teclado">⌨</button>' : '');
    const pie=document.createElement('div'); pie.className='hx-pie';
    pie.innerHTML='<span class="hx-modo">Listo</span><span class="hx-cuenta"></span><span class="hx-stats" aria-live="polite"></span>';
    wrap.insertAdjacentElement('beforebegin', barra);
    wrap.insertAdjacentElement('afterend', pie);
    const nom=barra.querySelector('.hx-nombre'), fx=barra.querySelector('.hx-formula'), modoEl=pie.querySelector('.hx-modo'), cuentaEl=pie.querySelector('.hx-cuenta'), statsEl=pie.querySelector('.hx-stats');
    const marcoEl=document.createElement('div'); marcoEl.className='hx-marco'; marcoEl.hidden=true; wrap.appendChild(marcoEl);
    const cm=document.createElement('div'); cm.className='hx-cmenu'; cm.hidden=true; cm.setAttribute('role','menu'); document.body.appendChild(cm);
    let atajosEl=null;

    /* ---------- estado ---------- */
    let tabIni=null;            // columna donde empezó una serie de Tab (Enter vuelve ahí, como Excel)
    let marco=null;             // rango con el marco de copia {r0,r1,c0,c1}
    let CUT=null;               // corte pendiente {tsv, celdas:[{fila,k}]}
    let editBar=null;           // edición en la barra de fórmulas {r,c,fila,orig}
    let relleno=null;           // arrastre del controlador de relleno {rc, hasta, x, y}
    let selCab=null, selFila=null;   // arrastre sobre encabezados / nº de fila
    let FCOL={};                // filtros propios por columna (k → Set de valores mostrados; '' = vacías)
    let FIJAS=0, AJUSTAR=new Set(), almacenVisto=null;

    function C(){ return cols()||[]; }
    function F(){ return filas()||[]; }
    function idxDeK(k){ const cs=C(); for(let i=0;i<cs.length;i++) if(cs[i].k===k) return i; return -1; }
    function etq(col){ return col ? String(col.etiqueta||col.k||'') : ''; }
    function celda(r,c){ return cuerpo.querySelector(SEL+'[data-r="'+r+'"][data-c="'+c+'"]'); }
    function thDe(c){ return cab.querySelector('th[data-hx-c="'+c+'"]'); }
    function editorActivo(){ const ae=document.activeElement; return (ae && ae!==wrap && wrap.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) ? ae : null; }
    // Lo que la barra muestra del editor de la celda: una clave (type=password) nunca en claro.
    function deEditor(ed){ return !ed ? '' : (ed.type==='password' ? (ed.value ? '••••••' : '') : ed.value); }
    // Escribe UNA celda desde el módulo (barra, Ctrl+Enter, pegar, relleno, Ctrl+;): salta lo de solo lectura y
    // normaliza fecha / hora (lo que no lo es no se escribe). Lleva la cuenta para el aviso.
    function escribir(fijar, r, c, v, cuenta){
      const fila=F()[r], col=C()[c]; if(!fila || !col) return 0;
      if(!editable(fila,col)){ cuenta.ro++; return 0; }
      const t=tipoDe(col); let x=v;
      if(t==='fecha'){ x=aFecha(v); if(x===null){ cuenta.mal++; return 0; } }
      else if(t==='hora'){ x=aHora(v); if(x===null){ cuenta.mal++; return 0; } }
      return fijar(r,c,x) ? 1 : 0;
    }
    function cuentaNueva(){ return { ro:0, mal:0 }; }
    function avisoLote(n, verbo, cuenta, multiple){
      const extra=(cuenta.ro ? ' · '+cuenta.ro+' de solo lectura sin tocar' : '')+(cuenta.mal ? ' · '+cuenta.mal+' fecha(s) u hora(s) no válida(s) sin tocar' : '');
      if(n){ if(multiple || extra) aviso(verbo+' '+n+' celda(s)'+extra+'.'); return; }
      if(cuenta.mal) aviso('No es una fecha u hora válida (usa día/mes/año o AAAA-MM-DD; hora HH:MM).', true);
      else if(cuenta.ro) aviso('Esas celdas son de solo lectura.', true);
      else if(multiple) aviso('Sin cambios: ya tenían esos valores.');
    }
    function enGrid(){ const ae=document.activeElement; return !!ae && (ae===wrap || (wrap.contains(ae) && !editorActivo())); }
    function multi(rc){ return !!rc && (rc.r1>rc.r0 || rc.c1>rc.c0); }

    /* ---------- preferencias (inmovilizar / ajustar texto) por pantalla y navegador ---------- */
    function prefs(){
      const a=almacen(); if(a===almacenVisto) return;
      if(almacenVisto!==null) FCOL={};                                       // otra tabla (Catálogos): sus filtros no se heredan
      almacenVisto=a;
      FIJAS=a ? Math.max(0, parseInt(lsGet(a+'_fijas','0'),10)||0) : 0;
      let aj=[]; try{ aj=JSON.parse(a ? lsGet(a+'_ajustar','[]') : '[]')||[]; }catch(e){ aj=[]; }
      AJUSTAR=new Set(Array.isArray(aj)?aj:[]);
    }
    function guardarPrefs(){ const a=almacen(); if(!a) return; lsSet(a+'_fijas', String(FIJAS)); lsSet(a+'_ajustar', JSON.stringify(Array.from(AJUSTAR))); }

    /* ---------- reglas por columna (hoja construible; si no hay, CSSOM en hoja-excel.css) ---------- */
    let hoja=null, hojaRespaldo=null, nRespaldo=0;
    function reglas(css){
      try{
        if(!hoja && !hojaRespaldo && ('adoptedStyleSheets' in document) && typeof CSSStyleSheet==='function'){ const s=new CSSStyleSheet(); s.replaceSync(''); document.adoptedStyleSheets=document.adoptedStyleSheets.concat([s]); hoja=s; }
        if(hoja){ hoja.replaceSync(css); return; }
      }catch(e){ hoja=null; }
      try{
        if(!hojaRespaldo) hojaRespaldo=Array.prototype.filter.call(document.styleSheets, function(s){ return s.href && /hoja-excel\.css/.test(s.href); })[0]||null;
        if(!hojaRespaldo) return;
        for(let i=0;i<nRespaldo;i++) hojaRespaldo.deleteRule(hojaRespaldo.cssRules.length-1);
        nRespaldo=0;
        css.split('}').map(function(x){ return x.trim(); }).filter(Boolean).forEach(function(x){ try{ hojaRespaldo.insertRule(x+'}', hojaRespaldo.cssRules.length); nRespaldo++; }catch(e){} });
      }catch(e){}
    }
    function aplicarReglas(){
      const cs=C(), P='#'+ID; let css='';
      AJUSTAR.forEach(function(k){ const i=idxDeK(k); if(i<0) return;
        css+=P+' tbody td[data-c="'+i+'"]{vertical-align:top;}'+P+' tbody td[data-c="'+i+'"] '+VAL+'{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;}'; });
      const n=Math.min(FIJAS, cs.length);
      if(n>0){
        const th0=cab.firstElementChild; let left=(th0 && th0.getBoundingClientRect().width) || 44;
        for(let i=0;i<n;i++){
          const th=thDe(i), w=(th && th.getBoundingClientRect().width) || (o.anchoCol ? o.anchoCol(i) : 90);
          const td=P+' tbody td[data-c="'+i+'"]', h=P+' thead th[data-hx-c="'+i+'"]';
          css+=td+'{position:sticky;left:'+left+'px;z-index:2;background-color:var(--surface);}';
          css+=P+' tbody tr:nth-child(even) td[data-c="'+i+'"]{background-image:linear-gradient(var(--hx-cebra),var(--hx-cebra));}';
          css+=td+'.'+CL.deriv+'{background-image:linear-gradient(var(--hx-deriv),var(--hx-deriv));}';
          css+=td+'.'+CL.sel+'{background:linear-gradient(var(--hx-sel),var(--hx-sel)),var(--surface)!important;}';
          css+=h+'{position:sticky;left:'+left+'px;z-index:4;}';
          if(i===n-1) css+=td+','+h+'{border-right:1px solid var(--muted);}';
          left+=w;
        }
      }
      reglas(css);
    }

    /* ---------- encabezados ---------- */
    function filtroActivo(c){ const col=C()[c]; if(!col) return false; const m=o.filtroMotor && o.filtroMotor(c); if(m) return m.marcados().size>0; const s=FCOL[col.k]; return !!(s && s.size); }
    function marcarCab(){
      const ord=o.orden ? o.orden() : {c:-1,dir:0};
      cab.querySelectorAll('th[data-hx-c]').forEach(function(th){ const c=+th.dataset.hxC;
        th.classList.toggle('hx-filtrado', filtroActivo(c)); th.classList.toggle('hx-ordenado', ord.c===c);
        const b=th.querySelector('.hx-cm'); if(b) b.title=filtroActivo(c) ? 'Filtrada · ordenar, filtrar y más' : 'Ordenar, filtrar y más'; });
    }
    function alPintarCab(){
      prefs();
      const ths=cab.children, cs=C();
      for(const k in FCOL) if(idxDeK(k)<0) delete FCOL[k];                     // columnas que ya no están (Catálogos cambia de tabla)
      if(ths[0]){ ths[0].classList.add('hx-esquina'); ths[0].title='Seleccionar todo (Ctrl+A)'; }
      for(let i=0;i<cs.length;i++){ const th=ths[i+1]; if(!th) break;
        th.dataset.hxC=String(i); th.classList.add('hx-th');
        if(!th.querySelector('.hx-cm')){ const b=document.createElement('span'); b.className='hx-cm'; b.setAttribute('role','button'); b.setAttribute('aria-label','Ordenar, filtrar y más'); b.innerHTML=ICONO; th.appendChild(b); } }
      marcarCab(); aplicarReglas(); pintarSelCab();
    }
    function alAnchos(){ aplicarReglas(); dibujarMarco(); }

    /* ---------- selección: resaltes, asa de relleno, barras ---------- */
    function pintarSelCab(){
      const rc=o.rango();
      cab.querySelectorAll('th[data-hx-c]').forEach(function(th){ const c=+th.dataset.hxC; th.classList.toggle('hx-cab-sel', !!rc && c>=rc.c0 && c<=rc.c1); });
      cuerpo.querySelectorAll(RN).forEach(function(td){ const r=+(td.parentNode && td.parentNode.dataset.r); td.classList.toggle('hx-rn-sel', !!rc && r>=rc.r0 && r<=rc.r1); });
    }
    function ponerAsa(){
      cuerpo.querySelectorAll('td.hx-asa').forEach(function(t){ t.classList.remove('hx-asa'); });
      const rc=o.rango(); if(!rc || !edita() || o.editando() || editorActivo()) return;
      const t=celda(rc.r1, rc.c1); if(t) t.classList.add('hx-asa');
    }
    function alSeleccionar(){ ponerAsa(); pintarSelCab(); pintarBarra(); pintarStats(); }
    function pintarBarra(){
      if(editBar) return;                                                     // no pisar lo que se escribe en la barra
      const a=o.activa(), rc=o.rango(), fs=F(), cs=C(), fila=a&&fs[a.r], col=a&&cs[a.c];
      if(!fila || !col){ nom.textContent='—'; nom.title='Celda activa'; fx.value=''; fx.placeholder='Elige una celda para ver su contenido completo'; fx.readOnly=true; fx.classList.add('hx-ro'); return; }
      fx.placeholder='';
      const ref='Fila '+(a.r+1)+' · '+etq(col);
      nom.textContent = multi(rc) ? (rc.r1-rc.r0+1)+'F × '+(rc.c1-rc.c0+1)+'C' : ref;
      nom.title = multi(rc) ? ref+' (celda activa)' : ref;
      const ed=editorActivo(); fx.value = ed ? deEditor(ed) : String(texto(fila,col)==null?'':texto(fila,col));
      const ro=!(edita() && barraEditable(fila,col)); fx.readOnly=ro; fx.classList.toggle('hx-ro', ro);
      fx.title = ro ? 'Solo lectura' : 'Edita aquí el contenido completo · Enter fija · Ctrl+Enter en toda la selección · Esc cancela';
    }
    function modo(t){
      if(t){ modoEl.textContent=t; return; }
      modoEl.textContent = (editBar || editorActivo()) ? 'Modificar' : marco ? (CUT ? 'Elige el destino y pulsa Ctrl+V para mover' : 'Elige el destino y pulsa Ctrl+V') : 'Listo';
      modoEl.classList.toggle('hx-modo-marco', !!marco && !(editBar || editorActivo()));
    }
    function pintarStats(){
      const rc=o.rango(), fs=F(), cs=C(); let h='';
      if(multi(rc)){
        let cnt=0, nn=0, suma=0, mn=Infinity, mx=-Infinity;
        for(let r=rc.r0;r<=rc.r1;r++){ const fila=fs[r]; if(!fila) continue;
          for(let c=rc.c0;c<=rc.c1;c++){ const col=cs[c]; if(!col) continue; const s=copia(fila,col); if(s===''||s==null) continue; cnt++;
            if(tipoDe(col)==='num'){ const n=numN(valor(fila,col)); if(n!=null){ nn++; suma+=n; if(n<mn) mn=n; if(n>mx) mx=n; } } } }
        const st=function(t,n){ return '<button type="button" class="hx-st" data-v="'+escH(String(Math.round(n*1e6)/1e6).replace('.',','))+'" title="Clic para copiar">'+t+' <b>'+escH(fmtN(n))+'</b></button>'; };
        h='<span class="hx-st0">Recuento <b>'+cnt+'</b></span>';
        if(nn){ h+=st('Suma',suma)+st('Promedio',suma/nn)+(nn>1?st('Mín',mn)+st('Máx',mx):''); }
      }
      statsEl.innerHTML=h;
      const tot=o.total ? o.total() : fs.length;
      cuentaEl.textContent = (hayFiltrosTodos() && fs.length<tot) ? (fs.length+' de '+tot+' filas') : '';
    }
    statsEl.addEventListener('click', function(ev){ const b=ev.target.closest && ev.target.closest('.hx-st'); if(!b) return; alPortapapeles(b.dataset.v).then(function(){ aviso('Copiado: '+b.dataset.v); }); wrap.focus({preventScroll:true}); });

    /* ---------- barra de fórmulas: editar ahí ---------- */
    // Con la celda en edición, el blur del editor del motor devuelve el foco a la hoja: se confirma primero y luego
    // se pasa el foco a la barra (si no, el clic en la barra se perdería).
    fx.addEventListener('mousedown', function(ev){ if(o.editando() || editorActivo()){ ev.preventDefault(); o.confirmarEditor(0,0); setTimeout(function(){ fx.focus(); }, 0); } });
    fx.addEventListener('focus', function(){
      const a=o.activa(), fs=F(), cs=C();
      if(o.editando()) o.confirmarEditor(0,0);
      if(!a || fx.readOnly || !fs[a.r] || !cs[a.c]){ editBar=null; return; }
      editBar={ r:a.r, c:a.c, fila:fs[a.r], orig:fx.value }; quitarMarco(); modo();
    });
    fx.addEventListener('keydown', function(ev){
      if(ev.key==='Enter'){ ev.preventDefault(); confirmarBarra((ev.ctrlKey||ev.metaKey) ? 'sel' : (ev.shiftKey ? 'arriba' : 'abajo')); }
      else if(ev.key==='Tab'){ ev.preventDefault(); confirmarBarra(ev.shiftKey ? 'izq' : 'der'); }
      else if(ev.key==='Escape'){ ev.preventDefault(); cancelarBarra(); }
    });
    fx.addEventListener('blur', function(){ if(editBar) confirmarBarra('nada'); });
    function confirmarBarra(dir){
      const e=editBar; editBar=null; if(!e){ modo(); return; }
      const v=fx.value, fs=F(); let r=(fs[e.r]===e.fila) ? e.r : fs.indexOf(e.fila);
      if(dir==='sel') llenarSel(v);
      else if(r>=0 && v!==e.orig){ const cu=cuentaNueva(), n=o.lote(function(fijar){ return escribir(fijar, r, e.c, v, cu); }, null); avisoLote(n, 'Escrito en', cu, false); }
      modo();
      if(dir!=='nada'){
        wrap.focus({preventScroll:true});
        r=F().indexOf(e.fila); if(r<0) r=e.r;
        if(dir==='abajo') o.activar(r+1,e.c); else if(dir==='arriba') o.activar(r-1,e.c); else if(dir==='der') o.activar(r,e.c+1); else if(dir==='izq') o.activar(r,e.c-1);
      }
      pintarBarra();
    }
    function cancelarBarra(){ const e=editBar; editBar=null; if(e) fx.value=e.orig; modo(); wrap.focus({preventScroll:true}); pintarBarra(); }
    // Lo que se teclea en el editor de la celda se ve también en la barra (como Excel).
    wrap.addEventListener('input', function(ev){ const t=ev.target; if(t && t!==wrap && t.closest && t.closest(SEL)) fx.value=deEditor(t); }, true);
    wrap.addEventListener('change', function(ev){ const t=ev.target; if(t && t.tagName==='SELECT' && t.closest && t.closest(SEL)) fx.value=t.value; }, true);
    wrap.addEventListener('focusin', function(ev){ if(ev.target!==wrap && editorActivo()){ quitarMarco(); CUT=null; ponerAsa(); modo(); fx.value=deEditor(ev.target); } });
    wrap.addEventListener('focusout', function(ev){ if(ev.target!==wrap) setTimeout(function(){ if(!editorActivo()){ modo(); alSeleccionar(); } }, 0); });

    /* ---------- escribir un valor en toda la selección (Ctrl+Enter) ---------- */
    function llenarSel(v){
      const rc=o.rango(); if(!rc) return 0; const cu=cuentaNueva();
      const n=o.lote(function(fijar){ let k=0; for(let r=rc.r0;r<=rc.r1;r++) for(let c=rc.c0;c<=rc.c1;c++) k+=escribir(fijar, r, c, v, cu); return k; }, null);
      avisoLote(n, 'Escrito en', cu, multi(rc));
      return n;
    }

    /* ---------- portapapeles: copiar / cortar / pegar ---------- */
    function tsv(rc){
      if(!rc) return null; const fs=F(), cs=C(), out=[];
      for(let r=rc.r0;r<=rc.r1;r++){ const fila=fs[r], celdas=[]; for(let c=rc.c0;c<=rc.c1;c++){ const v=fila&&cs[c] ? copia(fila,cs[c]) : ''; celdas.push(String(v==null?'':v).replace(/[\t\r\n]+/g,' ')); } out.push(celdas.join('\t')); }
      return out.join('\n');
    }
    function limpioTsv(t){ return String(t==null?'':t).replace(/\r/g,'').replace(/\n$/,''); }
    function ponerMarco(rc, corte, t){
      marco=rc; CUT=null;
      if(corte){ const fs=F(), cs=C(), celdas=[]; for(let r=rc.r0;r<=rc.r1;r++) for(let c=rc.c0;c<=rc.c1;c++) if(fs[r]&&cs[c]) celdas.push({ fila:fs[r], k:cs[c].k }); CUT={ tsv:limpioTsv(t), celdas:celdas }; }
      dibujarMarco(); modo();
    }
    function quitarMarco(){ if(!marco && marcoEl.hidden) return; marco=null; marcoEl.hidden=true; modo(); }
    function dibujarMarco(){
      if(!marco){ marcoEl.hidden=true; return; }
      const a=celda(marco.r0,marco.c0), b=celda(marco.r1,marco.c1); if(!a||!b){ marco=null; CUT=null; marcoEl.hidden=true; return; }
      const w=wrap.getBoundingClientRect(), ra=a.getBoundingClientRect(), rb=b.getBoundingClientRect();
      marcoEl.style.left=Math.round(ra.left-w.left+wrap.scrollLeft-wrap.clientLeft)+'px';
      marcoEl.style.top=Math.round(ra.top-w.top+wrap.scrollTop-wrap.clientTop)+'px';
      marcoEl.style.width=Math.max(4,Math.round(rb.right-ra.left))+'px';
      marcoEl.style.height=Math.max(4,Math.round(rb.bottom-ra.top))+'px';
      marcoEl.classList.toggle('hx-corte', !!CUT); marcoEl.hidden=false;
    }
    function copiar(corte){
      const rc=o.rango(); const t=tsv(rc); if(t==null){ aviso('Marca las celdas a copiar.', true); return; }
      const cortar=!!corte && edita();
      alPortapapeles(t).then(function(){ aviso(cortar ? 'Cortado: elige el destino y pega (Ctrl+V) para moverlo.' : 'Copiado.'); });
      ultimo=t; ponerMarco(rc, cortar, t);
    }
    function pegar(txt){
      const rc=o.rango(); if(!rc || !edita()) return;
      const limpio=limpioTsv(txt);
      const g=limpio==='' ? [['']] : limpio.split('\n').map(function(l){ return l.split('\t'); });   // una celda vacía copiada vacía el destino (Excel)
      const h=g.length, w=Math.max.apply(null, g.map(function(x){ return x.length; }));
      const sh=rc.r1-rc.r0+1, sw=rc.c1-rc.c0+1;
      let H=h, W=w; if((sh>h || sw>w) && sh%h===0 && sw%w===0){ H=sh; W=sw; }   // bloque repetido sobre la selección (Excel)
      const fs=F(), cs=C(), corte=(CUT && CUT.tsv===limpio) ? CUT : null, cu=cuentaNueva();
      const fin={ r1:Math.min(fs.length-1, rc.r0+H-1), c1:Math.min(cs.length-1, rc.c0+W-1) };
      if(fin.r1>rc.r0 || fin.c1>rc.c0) o.marcar(rc.r0,rc.c0,fin.r1,fin.c1);   // queda marcado lo pegado (antes del lote: el motor la sigue por fila si reordena)
      const n=o.lote(function(fijar){
        let k=0;
        for(let i=0;i<H;i++){ const r=rc.r0+i; if(r>=fs.length) break;
          for(let j=0;j<W;j++){ const c=rc.c0+j; if(c>=cs.length) break; const x=(g[i%h]||[])[j%w];
            k+=escribir(fijar, r, c, String(x==null?'':x).trim(), cu); } }
        if(corte) corte.celdas.forEach(function(x){                       // Ctrl+X: el origen que no quedó bajo el destino se vacía
          const r=fs.indexOf(x.fila), c=idxDeK(x.k); if(r<0||c<0) return;
          if(r>=rc.r0 && r<=fin.r1 && c>=rc.c0 && c<=fin.c1) return;
          if(editable(x.fila,cs[c]) && fijar(r,c,'')) k++; });
        return k;
      }, null);
      if(corte) CUT=null;
      quitarMarco();
      avisoLote(n, corte ? 'Movidas' : 'Pegadas', cu, true);
    }
    let ultimo=null;                                                        // lo último que copió la hoja (para pegar una celda vacía)
    document.addEventListener('copy', function(ev){ if(o.editando() || editBar || !enGrid()) return; const rc=o.rango(), t=tsv(rc); if(t==null) return; ev.preventDefault(); ev.clipboardData.setData('text/plain', t); ultimo=t; ponerMarco(rc, false, t); });
    document.addEventListener('cut', function(ev){ if(o.editando() || editBar || !enGrid()) return; const rc=o.rango(), t=tsv(rc); if(t==null) return; ev.preventDefault(); ev.clipboardData.setData('text/plain', t); ultimo=t; ponerMarco(rc, edita(), t); if(edita()) aviso('Cortado: elige el destino y pega (Ctrl+V) para moverlo.'); });
    document.addEventListener('paste', function(ev){
      if(o.editando() || editBar || !edita() || !enGrid()) return;
      const t=(ev.clipboardData||window.clipboardData).getData('text');
      if(!t && !(t==='' && ultimo==='' && marco)) return;                   // portapapeles vacío: solo si lo vacío lo copió la hoja
      ev.preventDefault(); pegar(t||'');
    });
    function pegarPortapapeles(){
      if(!edita()) return;
      try{ if(navigator.clipboard && navigator.clipboard.readText){ navigator.clipboard.readText().then(function(t){ if(t) pegar(t); else aviso('El portapapeles está vacío.'); }, function(){ aviso('El navegador no deja leer el portapapeles desde el menú: pulsa Ctrl+V.', true); }); return; } }catch(e){}
      aviso('Pulsa Ctrl+V para pegar.', true);
    }

    /* ---------- controlador de relleno ---------- */
    function enAsa(td, ev){ if(!td || !td.classList.contains('hx-asa')) return false; const b=td.getBoundingClientRect(); return ev.clientX>=b.right-6 && ev.clientY>=b.bottom-6; }
    function previa(){
      cuerpo.querySelectorAll('td.hx-relleno').forEach(function(t){ t.classList.remove('hx-relleno'); });
      if(!relleno || relleno.hasta==null) return; const rc=relleno.rc, a=Math.min(relleno.hasta, rc.r0), b=Math.max(relleno.hasta, rc.r1);
      for(let r=a;r<=b;r++){ if(r>=rc.r0 && r<=rc.r1) continue; for(let c=rc.c0;c<=rc.c1;c++){ const t=celda(r,c); if(t) t.classList.add('hx-relleno'); } }
    }
    function filaBajo(x,y){ const el=document.elementFromPoint(x,y), tr=el && el.closest && el.closest('tr[data-r]'); return (tr && cuerpo.contains(tr)) ? +tr.dataset.r : null; }
    function moverRelleno(){
      if(!relleno) return; const rc=relleno.rc, fs=F();
      let r=filaBajo(relleno.x, relleno.y);
      if(r==null){ const w=wrap.getBoundingClientRect(); if(relleno.y>w.bottom-4) r=fs.length-1; else if(relleno.y<w.top+4) r=0; }
      if(r==null) return;
      const h=(r>rc.r1) ? r : (r<rc.r0) ? r : null;
      if(h!==relleno.hasta){ relleno.hasta=h; previa(); modo(h==null ? 'Arrastra hacia abajo o arriba para rellenar' : ('Suelta para rellenar '+(h>rc.r1 ? h-rc.r1 : rc.r0-h)+' fila(s)')); }
    }
    let autoScroll=null;
    function arrancarAuto(){ if(autoScroll) return; autoScroll=setInterval(function(){ if(!relleno){ clearInterval(autoScroll); autoScroll=null; return; }
      const w=wrap.getBoundingClientRect(), thH=(cab && cab.getBoundingClientRect().height)||28; let d=0;
      if(relleno.y>w.bottom-18) d=Math.min(40, 8+(relleno.y-(w.bottom-18))); else if(relleno.y<w.top+thH+10) d=-Math.min(40, 8+((w.top+thH+10)-relleno.y));
      if(d){ wrap.scrollTop+=d; moverRelleno(); } }, 50); }
    function aplicarRelleno(rc, hasta){
      if(hasta==null || (hasta>=rc.r0 && hasta<=rc.r1)) return 0;
      const fs=F(), cs=C(), h=rc.r1-rc.r0+1, abajo=hasta>rc.r1, src=[];
      for(let r=rc.r0;r<=rc.r1;r++){ const fila=[]; for(let c=rc.c0;c<=rc.c1;c++) fila.push(fs[r]&&cs[c] ? copia(fs[r],cs[c]) : ''); src.push(fila); }
      const t0=abajo ? rc.r1+1 : hasta, t1=abajo ? hasta : rc.r0-1;
      o.marcar(abajo ? rc.r0 : rc.r1, rc.c0, abajo ? t1 : t0, rc.c1);    // queda marcado todo lo rellenado (origen incluido)
      const cu=cuentaNueva();
      const n=o.lote(function(fijar){ let k=0;
        for(let t=t0;t<=t1;t++){ const i=abajo ? (t-rc.r1-1)%h : (rc.r0-1-t)%h, s=abajo ? src[i] : src[h-1-i];
          for(let c=rc.c0;c<=rc.c1;c++) k+=escribir(fijar, t, c, s[c-rc.c0], cu); }
        return k; }, null);
      avisoLote(n, 'Rellenadas', cu, true);
      return n;
    }
    // Doble clic en el asa: hasta donde llega el bloque de datos de la columna de al lado (izquierda; si no, derecha).
    function rellenarBloque(){
      const rc=o.rango(); if(!rc) return; const fs=F(), cs=C();
      const vecina=[rc.c0-1, rc.c1+1].filter(function(c){ return c>=0 && c<cs.length && fs[rc.r1+1] && String(copia(fs[rc.r1+1],cs[c])||'')!==''; })[0];
      if(vecina===undefined){ aviso('No hay datos al lado para saber hasta dónde rellenar: arrastra el cuadrito.', true); return; }
      let fin=rc.r1; while(fin+1<fs.length && String(copia(fs[fin+1],cs[vecina])||'')!=='') fin++;
      aplicarRelleno(rc, fin);
    }

    /* ---------- ratón: asa, nº de fila, encabezados ---------- */
    cuerpo.addEventListener('mousedown', function(ev){
      if(ev.button!==0) return;
      const t=ev.target;
      const td=t.closest && t.closest(SEL);
      if(td && cuerpo.contains(td) && enAsa(td, ev) && edita()){
        ev.preventDefault(); ev.stopPropagation();                             // no es un clic de selección para el motor
        cerrarMenuCol(); if(o.cerrarMenus) o.cerrarMenus();
        const rc=o.rango(); if(!rc) return;
        relleno={ rc:rc, hasta:null, x:ev.clientX, y:ev.clientY };
        modo('Arrastra hacia abajo o arriba para rellenar'); arrancarAuto(); return;
      }
      const rn=t.closest && t.closest(RN);
      if(rn && cuerpo.contains(rn) && !t.closest('button')){
        const r=+(rn.parentNode && rn.parentNode.dataset.r); if(isNaN(r)) return;
        ev.preventDefault(); cerrarMenuCol();
        if(o.editando()) o.confirmarEditor(0,0);
        wrap.focus({preventScroll:true}); tabIni=null;
        const n=C().length-1, a=o.ancla(), r0=(ev.shiftKey && a) ? a.r : r;
        o.marcar(r0, n, r, 0); selFila={ r0:r0 }; return;
      }
      if(td) tabIni=null;
    }, true);
    cuerpo.addEventListener('dblclick', function(ev){ const td=ev.target.closest && ev.target.closest(SEL); if(td && enAsa(td, ev)){ ev.preventDefault(); ev.stopPropagation(); rellenarBloque(); } }, true);
    cab.addEventListener('mousedown', function(ev){
      if(ev.button!==0) return; const t=ev.target;
      if(t.closest && t.closest('.cq-rz,.rz')) return;                         // la agarradera del ancho es del motor
      const th=t.closest && t.closest('th'); if(!th || !cab.contains(th)) return;
      if(th.classList.contains('hx-esquina')){ ev.preventDefault(); const fs=F(), cs=C(); if(fs.length && cs.length){ if(o.editando()) o.confirmarEditor(0,0); wrap.focus({preventScroll:true}); o.marcar(fs.length-1, cs.length-1, 0, 0); } return; }
      if(th.dataset.hxC===undefined) return;
      const c=+th.dataset.hxC;
      ev.preventDefault();
      if(t.closest('.hx-cm')){ if(cmCol===c && !cm.hidden) cerrarMenuCol(); else abrirMenuCol(c, th); return; }
      cerrarMenuCol();
      const fs=F(); if(!fs.length) return;
      if(o.editando()) o.confirmarEditor(0,0);
      wrap.focus({preventScroll:true}); tabIni=null;
      const a=o.ancla(), c0=(ev.shiftKey && a) ? a.c : c;
      o.marcar(fs.length-1, c0, 0, c); selCab={ c0:c0 };
    }, true);
    cab.addEventListener('contextmenu', function(ev){ const th=ev.target.closest && ev.target.closest('th[data-hx-c]'); if(!th) return; ev.preventDefault(); abrirMenuCol(+th.dataset.hxC, th); });
    cab.addEventListener('dblclick', function(ev){
      const g=ev.target.closest && ev.target.closest('.cq-rz,.rz'); if(!g) return;
      const th=g.closest('th[data-hx-c]'); if(!th) return; ev.preventDefault(); ev.stopPropagation(); autoajustar(+th.dataset.hxC);
    }, true);
    document.addEventListener('mousemove', function(ev){
      if(relleno){ if(!(ev.buttons&1)){ terminarRelleno(false); return; } relleno.x=ev.clientX; relleno.y=ev.clientY; moverRelleno(); return; }
      if(selCab){ if(!(ev.buttons&1)){ selCab=null; return; } const el=document.elementFromPoint(ev.clientX, ev.clientY), th=el&&el.closest&&el.closest('th[data-hx-c]'); if(th && cab.contains(th)){ const fs=F(); if(fs.length) o.marcar(fs.length-1, selCab.c0, 0, +th.dataset.hxC); } return; }
      if(selFila){ if(!(ev.buttons&1)){ selFila=null; return; } const r=filaBajo(ev.clientX, ev.clientY); if(r!=null) o.marcar(selFila.r0, C().length-1, r, 0); }
    });
    function terminarRelleno(aplicar){
      const rl=relleno; relleno=null;
      if(autoScroll){ clearInterval(autoScroll); autoScroll=null; }
      cuerpo.querySelectorAll('td.hx-relleno').forEach(function(t){ t.classList.remove('hx-relleno'); });
      modo();
      if(aplicar && rl && rl.hasta!=null) aplicarRelleno(rl.rc, rl.hasta);
    }
    document.addEventListener('mouseup', function(){ if(relleno) terminarRelleno(true); selCab=null; selFila=null; });

    /* ---------- autoajustar ancho ---------- */
    let lienzo=null;
    function fuenteDe(el){ const s=getComputedStyle(el); return (s.fontStyle||'normal')+' '+(s.fontWeight||'400')+' '+(s.fontSize||'12.5px')+' '+(s.fontFamily||'sans-serif'); }
    function medir(txt, font){ lienzo=lienzo||document.createElement('canvas'); const x=lienzo.getContext('2d'); x.font=font; return x.measureText(String(txt==null?'':txt)).width; }
    function autoajustar(c){
      const cs=C(), col=cs[c]; if(!col || !o.fijarAncho) return;
      const fs=F(), muestra=cuerpo.querySelector(SEL+'[data-c="'+c+'"] '+VAL) || cuerpo.querySelector(SEL+' '+VAL);
      let font='12.5px sans-serif', pad=18;
      if(muestra){ font=fuenteDe(muestra); const s=getComputedStyle(muestra); pad=(parseFloat(s.paddingLeft)||8)+(parseFloat(s.paddingRight)||8)+4; }
      let w=0; const lim=Math.min(fs.length, 3000);
      for(let i=0;i<lim;i++){ const m=medir(mostrar(fs[i],col), font); if(m>w) w=m; }
      const th=thDe(c); let wh=0; if(th){ const s=getComputedStyle(th); wh=medir(etq(col)+'  ▲', fuenteDe(th))+(parseFloat(s.paddingLeft)||8)+(parseFloat(s.paddingRight)||8)+4; }
      o.fijarAncho(c, Math.max(48, Math.min(640, Math.ceil(Math.max(w+pad, wh)))));
      aviso('Ancho de «'+etq(col)+'» ajustado al contenido.');
    }

    /* ---------- filtros por columna (cualquier columna; las que ya filtra el motor, con SU filtro) ---------- */
    function claveF(fila,col){ const v=mostrar(fila,col); return String(v==null?'':v).trim(); }
    function pasa(fila, salvoK){
      for(const k in FCOL){ if(k===salvoK) continue; const s=FCOL[k]; if(!s || !s.size) continue; const i=idxDeK(k); if(i<0) continue; if(!s.has(claveF(fila, C()[i]))) return false; }
      return true;
    }
    function valoresCol(c){
      const col=C()[c], k=col.k, cnt={}, crudo={};
      (o.todas ? o.todas() : F()).forEach(function(fila){ if(o.pasaMotor && !o.pasaMotor(fila)) return; if(!pasa(fila,k)) return; const v=claveF(fila,col); if(!(v in cnt)){ cnt[v]=0; crudo[v]=valor(fila,col); } cnt[v]++; });
      (FCOL[k]||new Set()).forEach(function(v){ if(!(v in cnt)){ cnt[v]=0; crudo[v]=v; } });
      const t=tipoDe(col), ks=Object.keys(cnt);
      ks.sort(function(a,b){ if(a==='') return 1; if(b==='') return -1;
        if(t==='num'){ const x=numN(crudo[a]), y=numN(crudo[b]); if(x!=null && y!=null) return x-y; }
        if(t==='fecha' || t==='hora'){ const x=String(crudo[a]), y=String(crudo[b]); return x<y?-1:x>y?1:0; }
        return a.localeCompare(b,'es',{numeric:true}); });
      return ks.map(function(v){ return { v:v, n:cnt[v] }; });
    }
    function filtroDe(c){
      const m=o.filtroMotor && o.filtroMotor(c); if(m) return m;
      const col=C()[c]; if(!col) return null; const k=col.k;
      return { propio:true, valores:function(){ return valoresCol(c); }, marcados:function(){ return FCOL[k]||(FCOL[k]=new Set()); }, fijar:function(){ o.repintar(); } };
    }
    function hayFiltrosPropios(){ for(const k in FCOL) if(FCOL[k] && FCOL[k].size) return true; return false; }
    function nFiltrosPropios(){ let n=0; for(const k in FCOL) if(FCOL[k] && FCOL[k].size) n++; return n; }
    function hayFiltrosTodos(){ if(hayFiltrosPropios()) return true; return !!(o.hayFiltrosMotor && o.hayFiltrosMotor()); }
    function limpiarFiltros(){ FCOL={}; }

    /* ---------- menú de la columna (▾ / clic derecho en el encabezado) ---------- */
    let cmCol=-1, cmDesde=0;
    function cerrarMenuCol(){ if(cm.hidden) return; cm.hidden=true; cm.innerHTML=''; cmCol=-1; }
    function it(a, t, marcado, extra){ return '<button type="button" role="menuitem" data-a="'+a+'"'+(extra||'')+'><span class="hx-ck">'+(marcado?'✓':'')+'</span><span>'+escH(t)+'</span></button>'; }
    function abrirMenuCol(c, th){
      cerrarMenuCol(); if(o.cerrarMenus) o.cerrarMenus();
      const cs=C(), col=cs[c]; if(!col) return; cmCol=c; cmDesde=Date.now();
      const t=tipoDe(col), ord=o.orden ? o.orden() : {c:-1,dir:0}, fl=filtroDe(c);
      const az = t==='num' ? ['De menor a mayor','De mayor a menor'] : (t==='fecha'||t==='hora') ? ['Más antigua primero','Más reciente primero'] : ['De la A a la Z','De la Z a la A'];
      let h='<div class="hx-cm-tit">'+escH(etq(col))+'</div>';
      if(o.ordenar){ h+='<div class="hx-cm-sub">Ordenar</div>'+it('asc','↑ '+az[0], ord.c===c && ord.dir>0)+it('desc','↓ '+az[1], ord.c===c && ord.dir<0); if(ord.c===c) h+=it('sinorden','Quitar orden'); h+='<hr>'; }
      if(fl){ h+='<div class="hx-cm-filtro"><div class="hx-cm-sub">Filtrar'+(fl.marcados().size?' <em>· activo</em>':'')+'</div><input type="text" class="hx-cm-q" placeholder="Buscar valor…" aria-label="Buscar valor"><div class="hx-cm-acc"><button type="button" data-f="todo">Marcar todo</button><button type="button" data-f="nada">Quitar filtro</button></div><div class="hx-cm-lista"></div></div><hr>'; }
      h+=it('ajustar','Ajustar texto (varias líneas)', AJUSTAR.has(col.k));
      if(o.fijarAncho) h+=it('autoancho','Autoajustar ancho')+it('anchodef','Ancho por defecto');
      h+=it('fijar', 'Inmovilizar hasta «'+etq(col)+'»', FIJAS===c+1);
      if(FIJAS>0) h+=it('soltar','Movilizar columnas');
      h+='<hr>'+it('selcol','Seleccionar la columna');
      cm.innerHTML=h; cm.hidden=false;
      const lista=cm.querySelector('.hx-cm-lista'), q=cm.querySelector('.hx-cm-q');
      let vals=[];
      function pintarLista(){
        if(!lista) return; const sel=fl.marcados(), tq=normN(q ? q.value : ''); let n=0, html='';
        for(let i=0;i<vals.length;i++){ const x=vals[i]; const lbl=x.v==='' ? '(Vacías)' : x.v; if(tq && normN(lbl).indexOf(tq)<0) continue; if(++n>800){ html+='<div class="hx-cm-mas">… escribe para buscar entre '+vals.length+' valores</div>'; break; }
          html+='<label class="hx-cm-op'+(x.n?'':' cero')+(x.v===''?' vacias':'')+'"><input type="checkbox" value="'+escH(x.v)+'"'+(sel.has(x.v)?' checked':'')+'><span class="txt">'+escH(lbl)+'</span><em>'+x.n+'</em><button type="button" class="solo" data-solo="'+escH(x.v)+'">solo</button></label>'; }
        lista.innerHTML=html || '<div class="hx-cm-mas">Sin valores.</div>';
      }
      if(fl){ vals=fl.valores(); if(!fl.propio) vals=vals.filter(function(x){ return x.v!==''; }); if(q){ if(vals.length<=7) q.hidden=true; q.addEventListener('input', pintarLista); } pintarLista(); }
      // posición: bajo el encabezado, dentro de la ventana
      const b=th.getBoundingClientRect(), W=window.innerWidth, H=window.innerHeight;
      cm.style.left=Math.max(4, Math.min(b.left, W-cm.offsetWidth-6))+'px';
      const arriba=b.bottom+2, alto=cm.offsetHeight; cm.style.top=Math.max(4, (arriba+alto>H-6) ? Math.max(4, H-alto-6) : arriba)+'px';
      cm.onchange=function(ev){ const cb=ev.target; if(!fl || cb.type!=='checkbox') return; const s=fl.marcados(); if(cb.checked) s.add(cb.value); else s.delete(cb.value); fl.fijar(); marcarCab(); };
      cm.onclick=function(ev){
        const btn=ev.target.closest && ev.target.closest('button'); if(!btn) return;
        if(btn.dataset.solo!==undefined){ ev.preventDefault(); const s=fl.marcados(); s.clear(); s.add(btn.dataset.solo); fl.fijar(); marcarCab(); pintarLista(); return; }
        // «Marcar todo» sin búsqueda = sin filtro (como «Seleccionar todo» de Excel: también las vacías); con búsqueda, solo lo que coincide.
        if(btn.dataset.f){ const s=fl.marcados(), tq=normN(q?q.value:''); if(btn.dataset.f==='nada' || !tq) s.clear(); else vals.forEach(function(x){ if(normN(x.v===''?'(Vacías)':x.v).indexOf(tq)>=0) s.add(x.v); }); fl.fijar(); marcarCab(); pintarLista(); return; }
        const a=btn.dataset.a; if(!a) return; cerrarMenuCol();
        if(a==='asc'||a==='desc'){ o.ordenar(c, a==='asc'?1:-1); marcarCab(); }
        else if(a==='sinorden'){ o.ordenar(c, 0); marcarCab(); }
        else if(a==='ajustar'){ if(AJUSTAR.has(col.k)) AJUSTAR.delete(col.k); else AJUSTAR.add(col.k); guardarPrefs(); aplicarReglas(); dibujarMarco(); }
        else if(a==='autoancho') autoajustar(c);
        else if(a==='anchodef'){ o.fijarAncho(c, null); }
        else if(a==='fijar'){ FIJAS=(FIJAS===c+1) ? 0 : c+1; guardarPrefs(); aplicarReglas(); aviso(FIJAS ? ('Inmovilizadas '+FIJAS+' columna(s): quedan fijas al desplazarte a la derecha.') : 'Columnas movilizadas.'); }
        else if(a==='soltar'){ FIJAS=0; guardarPrefs(); aplicarReglas(); aviso('Columnas movilizadas.'); }
        else if(a==='selcol'){ const fs=F(); if(fs.length) o.marcar(fs.length-1, c, 0, c); }
        wrap.focus({preventScroll:true});
      };
      if(q && !q.hidden) setTimeout(function(){ q.focus(); }, 0);
    }
    document.addEventListener('mousedown', function(ev){ if(!cm.hidden && !cm.contains(ev.target) && !(ev.target.closest && ev.target.closest('.hx-cm'))) cerrarMenuCol(); if(atajosEl && !atajosEl.hidden && !atajosEl.contains(ev.target) && !(ev.target.closest && ev.target.closest('.hx-kbd'))) atajosEl.hidden=true; });
    document.addEventListener('keydown', function(ev){ if(ev.key==='Escape'){ if(!cm.hidden){ cerrarMenuCol(); wrap.focus({preventScroll:true}); } if(atajosEl) atajosEl.hidden=true; } });
    // Desplazar la hoja cierra el menú; no el desplazamiento que llega justo al abrirlo (el evento scroll es asíncrono:
    // el que deja ver el encabezado al hacer clic llega DESPUÉS del mousedown que abrió el menú).
    wrap.addEventListener('scroll', function(){ if(Date.now()-cmDesde>300) cerrarMenuCol(); });
    window.addEventListener('resize', function(){ cerrarMenuCol(); aplicarReglas(); dibujarMarco(); });
    // La hoja puede montarse oculta (p. ej. la Hoja de la revisión antes de elegir la vista): al aparecer o cambiar de
    // tamaño se recalculan las columnas inmovilizadas con los anchos reales.
    if(window.ResizeObserver){
      let w0=-1; new ResizeObserver(function(){ const w=wrap.clientWidth; if(w===w0) return; w0=w; aplicarReglas(); dibujarMarco(); }).observe(wrap);
      const tb=wrap.querySelector('table'); if(tb) new ResizeObserver(function(){ dibujarMarco(); }).observe(tb);   // alto de fila (densidad) o ajustar texto: el marco se recoloca
    }

    /* ---------- atajos (pantallas sin panel propio) ---------- */
    if(o.atajos){
      barra.querySelector('.hx-kbd').addEventListener('click', function(){
        if(!atajosEl){ atajosEl=document.createElement('div'); atajosEl.className='hx-atajos'; atajosEl.hidden=true; document.body.appendChild(atajosEl);
          atajosEl.innerHTML='<div class="hx-atajos-cab"><b>Atajos de la hoja</b></div><dl>'+ATAJOS_BASE.concat(o.atajos||[]).map(function(x){ return '<dt>'+escH(x[0])+'</dt><dd>'+escH(x[1])+'</dd>'; }).join('')+'</dl>'; }
        atajosEl.hidden=!atajosEl.hidden;
        if(!atajosEl.hidden){ const b=barra.getBoundingClientRect(); atajosEl.style.top=Math.round(b.bottom+6)+'px'; atajosEl.style.right='18px'; }
      });
    }

    /* ---------- teclado (antes que el motor: fase de captura) ---------- */
    wrap.addEventListener('keydown', function(ev){
      const k=ev.key, ctrl=ev.ctrlKey||ev.metaKey, sh=ev.shiftKey, alt=ev.altKey;
      if(o.editando() || editorActivo()){
        if(k==='Enter' && ctrl){ ev.preventDefault(); ev.stopPropagation(); const ed=editorActivo(), v=ed ? ed.value : ''; tabIni=null; o.cancelarEditor(); llenarSel(v); wrap.focus({preventScroll:true}); return; }
        if(k==='Enter' && sh && !alt){ ev.preventDefault(); ev.stopPropagation(); tabIni=null; o.confirmarEditor(-1,0); return; }
        if(k==='Enter' && !alt && tabIni!=null){ ev.preventDefault(); ev.stopPropagation(); const a=o.activa(), c0=tabIni; tabIni=null; o.confirmarEditor(0,0); if(a) o.activar(a.r+1, c0); return; }
        if(k==='Tab'){ if(tabIni==null){ const a=o.activa(); if(a) tabIni=a.c; } return; }
        if(k==='ArrowDown' && alt){ const ed=editorActivo(); if(ed && typeof ed.showPicker==='function'){ try{ ed.showPicker(); ev.preventDefault(); ev.stopPropagation(); }catch(e){ /* sin selector: queda lo nativo (lista del datalist) */ } } return; }
        if(k==='Escape'){ tabIni=null; }
        return;
      }
      if(k==='Escape'){ if(marco || CUT){ quitarMarco(); CUT=null; modo(); } tabIni=null; return; }
      if(k==='Tab'){ if(tabIni==null){ const a=o.activa(); if(a) tabIni=a.c; } return; }
      if(/^(Arrow|Home$|End$|Page)/.test(k) && !(alt && k==='ArrowDown')) tabIni=null;
      if(alt && k==='ArrowDown'){ const a=o.activa(); if(!a || !edita()) return; ev.preventDefault(); ev.stopPropagation(); o.abrirEditor(a.r,a.c); const ed=editorActivo(); if(ed && typeof ed.showPicker==='function'){ try{ ed.showPicker(); }catch(e){} } return; }
      if(ctrl && !alt && (k===';' || k===':')){
        ev.preventDefault(); ev.stopPropagation(); if(!edita()) return;
        const quiero=(k===';') ? 'fecha' : 'hora', v=(k===';') ? hoyBog() : horaBog(), rc=o.rango(); if(!rc) return;
        const fs=F(), cs=C(), cu=cuentaNueva(); let hay=false;
        const n=o.lote(function(fijar){ let x=0; for(let r=rc.r0;r<=rc.r1;r++) for(let c=rc.c0;c<=rc.c1;c++){ if(!fs[r]||!cs[c]||tipoDe(cs[c])!==quiero) continue; hay=true; x+=escribir(fijar, r, c, v, cu); } return x; }, null);
        if(!hay) aviso(k===';' ? 'Ctrl+; pone la fecha de hoy en una columna de fecha.' : 'Ctrl+: pone la hora actual en una columna de hora.', true);
        else if(n) aviso((k===';'?'Fecha de hoy':'Hora actual')+' en '+n+' celda(s).');
        return;
      }
      if(sh && k==='F10' && o.menu){ ev.preventDefault(); ev.stopPropagation(); o.menu(); return; }
      if(ctrl && !sh && !alt && (k==='f'||k==='F') && o.buscar && o.buscar.offsetParent!==null){ ev.preventDefault(); ev.stopPropagation(); o.buscar.focus(); if(o.buscar.select) o.buscar.select(); return; }
      if(ctrl && !alt && (k==='x'||k==='X')){ ev.preventDefault(); ev.stopPropagation(); copiar(true); return; }
    }, true);

    /* ---------- lo que llama el motor ---------- */
    // El motor ya llamó a alSeleccionar desde su aplicaSel dentro de pintar(): aquí solo lo que depende del repintado.
    function alPintar(){
      if(marco){ marco=null; CUT=null; marcoEl.hidden=true; }
      marcarCab(); modo();
    }
    return {
      alPintarCab:alPintarCab, alAnchos:alAnchos, alPintar:alPintar, alSeleccionar:alSeleccionar,
      pasa:function(fila){ return pasa(fila, null); },
      hayFiltros:hayFiltrosPropios, nFiltros:nFiltrosPropios, limpiarFiltros:limpiarFiltros,
      copiar:function(){ copiar(false); }, cortar:function(){ copiar(true); }, pegarPortapapeles:pegarPortapapeles, pegar:pegar,
      autoajustar:autoajustar, cerrarMenu:cerrarMenuCol, barra:barra, pie:pie,
      altoExtra:function(){ return (barra.offsetHeight||0)+(pie.offsetHeight||0); },
      altoPie:function(){ return pie.offsetHeight||0; },
    };
  }
  window.TM2HojaExcel={ montar:montar, numero:numN };
})();
