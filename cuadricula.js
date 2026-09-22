/* ============================================================================
 * CUADRÍCULA TIPO EXCEL reutilizable (D197) — el mismo manejo que la Revisión de DATA (D195/D196), empaquetado
 * para montarlo en otras pantallas (primero: la Base de aprobados del parte de maquinaria).
 *
 *   const g = TM2Cuadricula.crear({ wrap, filtrosEl, buscarEl, columnas, clave, puedeEditar, filtros, ... });
 *   g.cargar(filas)       → pinta; cada fila guarda su original para saber qué cambió
 *   g.cambios()           → [{ fila, campos:{k:v} }] de lo editado (sin guardar)
 *   g.visibles()          → filas que pasan filtros y búsqueda, en el orden en pantalla
 *   g.marcadas()          → filas de la selección
 *
 * Qué trae: un clic selecciona, flechas / Shift+flechas, Ctrl+flechas (borde del bloque, como Excel) y con Shift
 * marca, Inicio/Fin, Ctrl+Inicio/Fin, Re/Av Pág, Shift+Espacio (fila), Ctrl+Espacio (columna), Ctrl+A; editar con
 * doble clic / Enter / F2 / escribiendo; Ctrl+C / Ctrl+V (TSV, también con Excel), Ctrl+D rellena, Supr vacía,
 * Ctrl+Z / Ctrl+Y; filtros de selección múltiple con recuento (autofiltro de Excel) + buscador; orden por
 * encabezado; ancho de columna arrastrable (se recuerda por navegador); separador por día; menú de clic derecho
 * (acciones propias de la pantalla + copiar, rellenar, vaciar, filtrar por valor). CSP D170: nada en línea; los
 * eventos se enganchan con addEventListener y los estilos van en cuadricula.css (clases `cq-*`).
 * ==========================================================================*/
(function(){
  'use strict';
  const escH = (typeof esc === 'function') ? esc : function(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); };
  function normN(s){ return String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toLowerCase(); }
  function numN(v){ if(v===''||v===null||v===undefined) return null; const n=Number(String(v).replace(',','.')); return isFinite(n)?n:null; }
  function val(r,k){ return String(r[k]==null?'':r[k]).trim(); }

  function crear(cfg){
    const wrap=cfg.wrap, COLS=cfg.columnas, CLAVE=cfg.clave||'id', EDIT=!!cfg.puedeEditar;
    const FILT=(cfg.filtros||[]).map(function(f,i){ return Object.assign({ id:'cqf'+i+'-'+f.k, todas:'Todos' }, f); });
    const FSEL={}; FILT.forEach(function(f){ FSEL[f.id]=new Set(); });
    const LSK=cfg.almacen||'';                                     // prefijo localStorage (anchos)
    let FILAS=[], VIS=[], act=null, anc=null, editando=null, ordCol=-1, ordDir=1, undo=[], redo=[], msAbierto=null;
    let ANCHOS={}; try{ if(LSK) ANCHOS=JSON.parse(localStorage.getItem(LSK+'_anchos')||'{}')||{}; }catch(e){ ANCHOS={}; }

    /* ---------- estructura ---------- */
    wrap.classList.add('cq-wrap'); wrap.tabIndex=0;
    wrap.innerHTML='<table class="cq"><colgroup></colgroup><thead><tr></tr></thead><tbody><tr><td class="cq-vacio">'+escH(cfg.textoVacio||'Sin datos.')+'</td></tr></tbody></table>';
    const tabla=wrap.querySelector('table'), cg=tabla.querySelector('colgroup'), cab=tabla.querySelector('thead tr'), cuerpo=tabla.querySelector('tbody');
    const menu=document.createElement('div'); menu.className='cq-menu'; menu.hidden=true; menu.setAttribute('role','menu'); document.body.appendChild(menu);

    function anchoDe(c){ const v=ANCHOS[c.k]; return (typeof v==='number'&&v>0)?v:(c.ancho||90); }
    function pintarCols(){
      let total=44, h='<col data-rn="1">'; COLS.forEach(function(c){ total+=anchoDe(c); h+='<col data-k="'+c.k+'">'; });
      cg.innerHTML=h;                                              // anchos por CSSOM (la CSP ignora style= por innerHTML)
      cg.querySelector('col[data-rn]').style.width='44px';
      COLS.forEach(function(c){ const col=cg.querySelector('col[data-k="'+c.k+'"]'); if(col) col.style.width=anchoDe(c)+'px'; });
      tabla.style.width=total+'px';
    }
    function pintarCab(){
      let h='<th class="cq-rn">#</th>';
      COLS.forEach(function(c,i){ h+='<th data-i="'+i+'" class="'+(c.edita&&EDIT?'':'cq-deriv')+(c.tipo==='num'?' cq-num':'')+'" title="'+escH((c.ayuda||c.etiqueta)+(c.edita&&EDIT?' · editable':' · solo lectura'))+'">'+escH(c.etiqueta)+(ordCol===i?(ordDir>0?' ▲':' ▼'):'')+'<span class="cq-rz" data-k="'+c.k+'"></span></th>'; });
      cab.innerHTML=h; pintarCols();
    }

    /* ---------- vista ---------- */
    function disp(r,c){
      const v=r[c.k]; if(c.fmt) return c.fmt(v,r);
      if(v===''||v==null) return '';
      if(c.tipo==='num'){ const n=numN(v); return n==null?String(v):n.toLocaleString('es-CO',{maximumFractionDigits:c.dec==null?2:c.dec, useGrouping:c.miles!==false}); }
      return String(v);
    }
    function pasa(r, salvo){ return FILT.every(function(f){ return f.id===salvo || !FSEL[f.id].size || FSEL[f.id].has(val(r,f.k)); }); }
    function visibles(){
      const q=cfg.buscarEl ? normN(cfg.buscarEl.value) : '';
      let vis=FILAS.filter(function(r){ return !r._oculta && (!cfg.filtroExtra || cfg.filtroExtra(r)) && pasa(r,null); });
      if(q) vis=vis.filter(function(r){ return COLS.some(function(c){ return normN(disp(r,c)).indexOf(q)>=0; }) || (cfg.buscarMas && normN(cfg.buscarMas(r)).indexOf(q)>=0); });
      if(ordCol>=0){ const c=COLS[ordCol], esNum=c.tipo==='num';
        vis=vis.slice().sort(function(a,b){
          if(esNum){ const x=numN(a[c.k]), y=numN(b[c.k]); return ((x==null?-Infinity:x)-(y==null?-Infinity:y))*ordDir; }
          const x=normN(a[c.k]), y=normN(b[c.k]); return (x<y?-1:x>y?1:0)*ordDir; }); }
      return vis;
    }
    function sucia(r){ return COLS.some(function(c){ return c.edita && String(r[c.k]==null?'':r[c.k])!==String(r._orig[c.k]==null?'':r._orig[c.k]); }); }
    function pendiente(r){ return sucia(r) || !!r._accion; }
    function celda(r,c,ci,ri){
      const d=disp(r,c), cls='cq-c'+(c.edita&&EDIT?'':' cq-deriv')+(c.tipo==='num'?' cq-num':'')+(c.clase?' '+c.clase(r):'')
        +(c.edita && String(r[c.k]==null?'':r[c.k])!==String(r._orig[c.k]==null?'':r._orig[c.k]) ? ' cq-mod':'');
      return '<td class="'+cls+'" data-r="'+ri+'" data-c="'+ci+'"><div class="cq-v" title="'+escH(d)+'">'+escH(d)+'</div></td>';
    }
    function filaH(r,ri){
      const dia=cfg.colDia && (ordCol<0 || COLS[ordCol].k===cfg.colDia) && ri>0 && VIS[ri-1] && val(VIS[ri-1],cfg.colDia)!==val(r,cfg.colDia);
      const cls=[pendiente(r)?'cq-dirty':'', dia?'cq-dia':'', r._error?'cq-err':'', cfg.claseFila?cfg.claseFila(r):''].filter(Boolean).join(' ');
      let h='<tr data-r="'+ri+'" class="'+cls+'"><td class="cq-rn"'+(r._error?' title="'+escH(r._error)+'"':'')+'>'+(r._error?'⚠':(ri+1))+'</td>';
      COLS.forEach(function(c,ci){ h+=celda(r,c,ci,ri); });
      return h+'</tr>';
    }
    function pintar(){
      if(editando) cerrarEditor(false);
      VIS=visibles();
      cuerpo.innerHTML=VIS.length ? VIS.map(filaH).join('') : '<tr><td class="cq-vacio" colspan="'+(COLS.length+1)+'">'+escH(FILAS.length?'Sin filas con ese filtro.':(cfg.textoVacio||'Sin datos.'))+'</td></tr>';
      if(act && act.r>=VIS.length) act=anc=null;
      aplicaSel(); pintarEtiquetas();
      if(cfg.alPintar) cfg.alPintar(VIS);
      avisarDirty();
    }
    function refrescar(ri){
      const r=VIS[ri], tr=cuerpo.querySelector('tr[data-r="'+ri+'"]'); if(!r||!tr) return;
      const tmp=document.createElement('tbody'); tmp.innerHTML=filaH(r,ri); tr.replaceWith(tmp.firstChild);
    }
    function avisarDirty(){ if(cfg.alCambiarDirty) cfg.alCambiarDirty(FILAS.filter(pendiente).length); }

    /* ---------- selección ---------- */
    function rango(){ if(!act||!anc) return null; return { r0:Math.min(act.r,anc.r), r1:Math.max(act.r,anc.r), c0:Math.min(act.c,anc.c), c1:Math.max(act.c,anc.c) }; }
    function aplicaSel(){ const rc=rango();
      cuerpo.querySelectorAll('td.cq-c').forEach(function(td){ const r=+td.dataset.r, c=+td.dataset.c;
        td.classList.toggle('cq-sel', !!rc && r>=rc.r0 && r<=rc.r1 && c>=rc.c0 && c<=rc.c1);
        td.classList.toggle('cq-act', !!act && r===act.r && c===act.c); });
      if(cfg.alSeleccionar) cfg.alSeleccionar(marcadas(), rc);
    }
    function td(r,c){ return cuerpo.querySelector('td.cq-c[data-r="'+r+'"][data-c="'+c+'"]'); }
    function activar(r,c,ext,scroll){
      if(!VIS.length) return; r=Math.max(0,Math.min(r,VIS.length-1)); c=Math.max(0,Math.min(c,COLS.length-1));
      act={r:r,c:c}; if(!ext||!anc) anc={r:r,c:c}; aplicaSel();
      if(scroll){ const t=td(r,c); if(t&&t.scrollIntoView) t.scrollIntoView({block:'nearest',inline:'nearest'}); }
    }
    function marcar(r0,c0,r1,c1){ anc={r:r0,c:c0}; act={r:r1,c:c1}; aplicaSel(); }
    function mover(dr,dc,ext){ if(!act){ activar(0,0,false,true); return; } activar(act.r+dr, act.c+dc, ext, true); }
    function vacia(r,c){ const x=VIS[r]; return !x || val(x,COLS[c].k)===''; }
    function saltar(dr,dc,ext){
      if(!act){ activar(0,0,false,true); return; }
      const mR=VIS.length-1, mC=COLS.length-1, den=function(r,c){ return r>=0&&r<=mR&&c>=0&&c<=mC; };
      let r=act.r, c=act.c;
      if(den(r+dr,c+dc)){
        if(!vacia(r,c) && !vacia(r+dr,c+dc)){ while(den(r+dr,c+dc) && !vacia(r+dr,c+dc)){ r+=dr; c+=dc; } }
        else { r+=dr; c+=dc; while(den(r+dr,c+dc) && vacia(r,c)){ r+=dr; c+=dc; } }
      }
      activar(r,c,ext,true);
    }
    function marcadas(){ const rc=rango(); if(!rc) return []; const out=[]; for(let r=rc.r0;r<=rc.r1;r++) if(VIS[r]) out.push(VIS[r]); return out; }
    function porPagina(){ const t=cuerpo.querySelector('td.cq-c'); return Math.max(5, Math.floor((wrap.clientHeight||500)/((t&&t.offsetHeight)||24))-2); }

    /* ---------- deshacer ---------- */
    function snap(){ return JSON.stringify(FILAS); }
    function pushUndo(){ undo.push(snap()); if(undo.length>80) undo.shift(); redo.length=0; }
    function restaurar(js){ FILAS=JSON.parse(js); act=anc=null; pintar(); }
    function deshacer(){ if(!undo.length){ aviso('Nada que deshacer.'); return; } redo.push(snap()); restaurar(undo.pop()); aviso('Deshecho.'); }
    function rehacer(){ if(!redo.length){ aviso('Nada que rehacer.'); return; } undo.push(snap()); restaurar(redo.pop()); aviso('Rehecho.'); }
    function aviso(m,err){ if(cfg.aviso) cfg.aviso(m,err); }

    /* ---------- edición ---------- */
    function opciones(c,r){ const o=typeof c.opciones==='function'?c.opciones(r):(c.opciones||[]); return o.map(function(x){ return typeof x==='object'?x:{v:x,t:x}; }); }
    function canon(c,r,v){
      v=String(v==null?'':v).trim(); if(c.tipo!=='lista' || !v) return v;
      const ops=opciones(c,r), t=normN(v);
      const m=ops.filter(function(o){ return normN(o.v)===t; })[0] || ops.filter(function(o){ return normN(o.t)===t || normN(o.v+' · '+o.t)===t; })[0];
      return m ? m.v : v;
    }
    function fijar(ri,ci,v){
      const r=VIS[ri], c=COLS[ci]; if(!r||!c||!c.edita||!EDIT || r._bloqueada) return false;
      v=canon(c,r,v); if(c.tipo==='num' && v!==''){ const n=numN(v); v = n==null ? v : n; }
      if(String(r[c.k]==null?'':r[c.k])===String(v)) return false;
      r[c.k]=v; delete r._error;
      if(cfg.alCambiar) cfg.alCambiar(r, c.k, v);
      return true;
    }
    function abrirEditor(ri,ci,ini){
      if(!EDIT) return; const r=VIS[ri], c=COLS[ci]; if(!r||!c) return;
      activar(ri,ci,false,false);
      if(!c.edita || r._bloqueada){ aviso(r._bloqueada ? r._bloqueada : ('«'+c.etiqueta+'» es calculada: no se edita aquí.')); return; }
      const t=td(ri,ci); if(!t) return; editando={r:ri,c:ci};
      let el; const actual=String(r[c.k]==null?'':r[c.k]), ops=c.tipo==='lista'?opciones(c,r):null;
      if(ops && ops.length<=15){
        el=document.createElement('select'); const lista=ops.slice(); if(actual && !lista.some(function(o){ return o.v===actual; })) lista.push({v:actual,t:actual+' (fuera de la lista)'});
        let elegida=actual; if(ini){ const q=normN(ini), m=lista.filter(function(o){ return o.v && (normN(o.v).indexOf(q)===0 || normN(o.t).indexOf(q)===0); })[0]; if(m) elegida=m.v; }
        lista.forEach(function(o){ const op=document.createElement('option'); op.value=o.v; op.textContent=o.v===o.t?(o.t||'—'):(o.v?o.v+' · '+o.t:'—'); if(o.v===elegida) op.selected=true; el.appendChild(op); });
      } else {
        el=document.createElement('input'); el.type=c.tipo==='fecha'?'date':c.tipo==='hora'?'time':'text';
        if(ops){ const dl=document.createElement('datalist'); dl.id='cq-dl-'+c.k; ops.forEach(function(o){ const op=document.createElement('option'); op.value=o.v; if(o.t && o.t!==o.v) op.label=o.t; dl.appendChild(op); }); t.appendChild(dl); el.setAttribute('list', dl.id); }
        el.value = (ini!=null) ? ini : actual;
      }
      el.className='cq-ed'+(c.tipo==='num'?' cq-num':'');
      t.classList.add('cq-editando'); t.appendChild(el); el.focus(); if(el.select && ini==null && el.type==='text') el.select();
      el.addEventListener('keydown', function(ev){
        if(ev.key==='Enter'){ ev.preventDefault(); cerrarEditor(true,1,0); }
        else if(ev.key==='Tab'){ ev.preventDefault(); cerrarEditor(true,0,ev.shiftKey?-1:1); }
        else if(ev.key==='Escape'){ ev.preventDefault(); cerrarEditor(false); }
        ev.stopPropagation();
      });
      el.addEventListener('blur', function(){ if(editando) cerrarEditor(true); });
    }
    function cerrarEditor(guardar,dr,dc){
      if(!editando) return; const e=editando; editando=null;
      const t=td(e.r,e.c), el=t&&t.querySelector('.cq-ed'), v=el?el.value:'';
      if(t){ t.querySelectorAll('.cq-ed,datalist').forEach(function(x){ x.remove(); }); t.classList.remove('cq-editando'); }
      if(guardar){ const r=VIS[e.r], c=COLS[e.c]; if(r&&c&&String(r[c.k]==null?'':r[c.k])!==String(canon(c,r,v))){ pushUndo(); if(fijar(e.r,e.c,v)){ refrescar(e.r); aplicaSel(); avisarDirty(); if(cfg.alPintar) cfg.alPintar(VIS); } } }
      wrap.focus({preventScroll:true});
      if(dr||dc) mover(dr||0,dc||0,false);
    }
    function sobreRango(fn, msg){
      const rc=rango(); if(!rc) return; pushUndo(); let n=0;
      for(let r=rc.r0;r<=rc.r1;r++) for(let c=rc.c0;c<=rc.c1;c++) if(fn(r,c)) n++;
      if(n){ pintar(); aviso(msg.replace('#',n)); } else { undo.pop(); }
    }
    function rellenar(){
      const rc=rango(); if(!rc){ aviso('Elige la celda o el rango a rellenar.',true); return; }
      const hasta = rc.r0===rc.r1 ? VIS.length-1 : rc.r1;
      pushUndo(); let n=0;
      for(let c=rc.c0;c<=rc.c1;c++){ const base=VIS[rc.r0][COLS[c].k]; for(let r=rc.r0+1;r<=hasta;r++) if(fijar(r,c,base)) n++; }
      if(n){ pintar(); aviso('Rellenadas '+n+' celda(s).'); } else undo.pop();
    }
    function vaciar(){ sobreRango(function(r,c){ return fijar(r,c,''); }, 'Vaciadas # celda(s).'); }
    function tsv(){ const rc=rango(); if(!rc) return null; const out=[];
      for(let r=rc.r0;r<=rc.r1;r++){ const cs=[]; for(let c=rc.c0;c<=rc.c1;c++){ let v=VIS[r][COLS[c].k]; v=v==null?'':v; if(cfg.decimalComa && typeof v==='number') v=String(v).replace('.',','); cs.push(String(v).replace(/[\t\r\n]+/g,' ')); } out.push(cs.join('\t')); }
      return out.join('\n'); }
    function pegar(txt){
      if(!act||!EDIT) return; const g=txt.replace(/\r/g,'').replace(/\n$/,'').split('\n').map(function(l){ return l.split('\t'); });
      pushUndo(); let n=0;
      for(let i=0;i<g.length;i++){ const r=act.r+i; if(r>=VIS.length) break; for(let j=0;j<g[i].length;j++){ const c=act.c+j; if(c>=COLS.length) break; if(fijar(r,c,g[i][j].trim())) n++; } }
      if(n){ pintar(); aviso('Pegadas '+n+' celda(s).'); } else { undo.pop(); aviso('Nada que pegar en celdas editables.'); }
    }
    function copiar(){
      const t=tsv(); if(t==null){ aviso('Marca las celdas a copiar.',true); return; }
      const ok=function(){ aviso('Copiado.'); };
      if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok,function(){ fb(t); ok(); }); else { fb(t); ok(); }
      function fb(x){ const ta=document.createElement('textarea'); ta.value=x; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); }catch(e){} ta.remove(); }
    }

    /* ---------- filtros de selección múltiple ---------- */
    function ordVals(f,a){ return a.sort(f.num?function(x,y){ return (Number(x)||0)-(Number(y)||0); }:function(x,y){ return x.localeCompare(y,'es'); }); }
    function valores(f){ const n={};
      FILAS.forEach(function(r){ if(r._oculta || (cfg.filtroExtra && !cfg.filtroExtra(r)) || !pasa(r,f.id)) return; const v=val(r,f.k); if(v) n[v]=(n[v]||0)+1; });
      FSEL[f.id].forEach(function(v){ if(!(v in n)) n[v]=0; });
      return ordVals(f,Object.keys(n)).map(function(v){ return {v:v,n:n[v]}; }); }
    function etiqueta(f){ const s=ordVals(f,Array.from(FSEL[f.id])); if(!s.length) return f.todas; if(s.length===1) return s[0]; const j=s.join(', '); return j.length<=18?j:(s.length+' elegidos'); }
    function pintarEtiquetas(){ FILT.forEach(function(f){ const b=document.getElementById(f.id); if(!b) return; b.querySelector('.cq-ms-v').textContent=etiqueta(f); b.classList.toggle('activo',FSEL[f.id].size>0); }); }
    function montarFiltros(){
      if(!cfg.filtrosEl) return;
      let h=''; FILT.forEach(function(f){ h+='<div class="cq-ms'+(f.ancho?' grow':'')+'" id="'+f.id+'"><button type="button" class="cq-ms-btn"><span class="cq-ms-t">'+escH(f.t)+'</span><span class="cq-ms-v"></span></button><div class="cq-ms-pop" hidden></div></div>'; });
      h+='<button type="button" class="cq-link" data-cq="limpiar">Limpiar filtros</button>';
      cfg.filtrosEl.insertAdjacentHTML('beforeend', h);
      FILT.forEach(function(f){ const box=document.getElementById(f.id), pop=box.querySelector('.cq-ms-pop');
        box.querySelector('.cq-ms-btn').addEventListener('click', function(ev){ ev.stopPropagation(); if(msAbierto===f.id) cerrarFiltro(); else abrirFiltro(f); });
        pop.addEventListener('click', function(ev){ ev.stopPropagation(); });
        pop.addEventListener('change', function(ev){ const cb=ev.target; if(cb.type!=='checkbox') return; if(cb.checked) FSEL[f.id].add(cb.value); else FSEL[f.id].delete(cb.value); pintar(); });
      });
      cfg.filtrosEl.querySelector('[data-cq=limpiar]').addEventListener('click', limpiarFiltros);
      document.addEventListener('click', cerrarFiltro);
      if(cfg.buscarEl) cfg.buscarEl.addEventListener('input', pintar);
    }
    function abrirFiltro(f){
      cerrarFiltro(); cerrarMenu();
      const box=document.getElementById(f.id), pop=box.querySelector('.cq-ms-pop'), vs=valores(f); msAbierto=f.id;
      let h=vs.length>7?'<input type="text" class="cq-ms-q" placeholder="Buscar…">':'';
      h+='<div class="cq-ms-acc"><button type="button" data-a="todo">Marcar todo</button><button type="button" data-a="nada">Quitar filtro</button></div><div class="cq-ms-lista">';
      vs.forEach(function(o){ h+='<label class="cq-ms-op'+(o.n?'':' cero')+'"><input type="checkbox" value="'+escH(o.v)+'"'+(FSEL[f.id].has(o.v)?' checked':'')+'><span class="txt">'+escH(o.v)+'</span><em>'+o.n+'</em><button type="button" class="solo" data-solo="'+escH(o.v)+'">solo</button></label>'; });
      pop.innerHTML=h+(vs.length?'':'<div class="cq-ms-vacio">Sin valores.</div>')+'</div>'; pop.hidden=false; box.classList.add('abierto');
      const q=pop.querySelector('.cq-ms-q');
      if(q){ q.addEventListener('input', function(){ const t=normN(q.value); pop.querySelectorAll('.cq-ms-op').forEach(function(l){ l.hidden=!!t && normN(l.querySelector('.txt').textContent).indexOf(t)<0; }); }); setTimeout(function(){ q.focus(); },0); }
      pop.querySelectorAll('.cq-ms-acc button').forEach(function(b){ b.addEventListener('click', function(){
        if(b.dataset.a==='nada'){ FSEL[f.id].clear(); pop.querySelectorAll('input[type=checkbox]').forEach(function(c){ c.checked=false; }); }
        else pop.querySelectorAll('.cq-ms-op:not([hidden]) input[type=checkbox]').forEach(function(c){ c.checked=true; FSEL[f.id].add(c.value); });
        pintar(); }); });
      pop.querySelectorAll('button.solo').forEach(function(b){ b.addEventListener('click', function(ev){ ev.preventDefault(); FSEL[f.id].clear(); FSEL[f.id].add(b.dataset.solo);
        pop.querySelectorAll('input[type=checkbox]').forEach(function(c){ c.checked=(c.value===b.dataset.solo); }); pintar(); }); });
    }
    function cerrarFiltro(){ if(!msAbierto) return; const box=document.getElementById(msAbierto); msAbierto=null; if(box){ const p=box.querySelector('.cq-ms-pop'); p.hidden=true; p.innerHTML=''; box.classList.remove('abierto'); } }
    function limpiarFiltros(){ FILT.forEach(function(f){ FSEL[f.id].clear(); }); if(cfg.buscarEl) cfg.buscarEl.value=''; cerrarFiltro(); pintar(); }
    function hayFiltros(){ return FILT.some(function(f){ return FSEL[f.id].size; }) || !!(cfg.buscarEl && cfg.buscarEl.value); }

    /* ---------- menú del clic derecho ---------- */
    function cerrarMenu(){ if(!menu.hidden){ menu.hidden=true; menu.innerHTML=''; } }
    function abrirMenu(x,y,cel){
      if(!act) return; cerrarFiltro(); cel=cel||act;
      const col=COLS[cel.c], row=VIS[cel.r], sel=marcadas();
      const items=(cfg.menu ? cfg.menu(sel, row, col) : []).slice();
      if(items.length) items.push(null);
      items.push({ t:'Copiar', atajo:'Ctrl+C', fn:copiar });
      if(EDIT){ items.push({ t:'Rellenar hacia abajo', atajo:'Ctrl+D', fn:rellenar }); items.push({ t:'Vaciar celdas', atajo:'Supr', fn:vaciar }); }
      const f=FILT.filter(function(x){ return col && x.k===col.k; })[0], v=row&&col?val(row,col.k):'';
      if(f && v){ items.push(null); items.push({ t:'Filtrar por «'+(v.length>28?v.slice(0,27)+'…':v)+'»', fn:function(){ FSEL[f.id].clear(); FSEL[f.id].add(v); pintar(); } }); }
      if(hayFiltros()) items.push({ t:'Quitar todos los filtros', fn:limpiarFiltros });
      menu.innerHTML=items.map(function(it,i){ return it ? '<button type="button" role="menuitem" data-i="'+i+'"'+(it.peligro?' class="peligro"':'')+(it.deshabilitado?' disabled title="'+escH(it.deshabilitado)+'"':'')+'><span>'+escH(it.t)+'</span><kbd>'+escH(it.atajo||'')+'</kbd></button>' : '<hr>'; }).join('');
      menu.hidden=false;
      const W=window.innerWidth, H=window.innerHeight; menu.style.left=Math.max(4,Math.min(x,W-menu.offsetWidth-6))+'px'; menu.style.top=Math.max(4,Math.min(y,H-menu.offsetHeight-6))+'px';
      menu.onclick=function(ev){ const b=ev.target.closest&&ev.target.closest('button[data-i]'); if(!b||b.disabled) return; const it=items[+b.dataset.i]; cerrarMenu(); if(it&&it.fn) it.fn(); if(!editando) wrap.focus({preventScroll:true}); };
    }

    /* ---------- eventos ---------- */
    let arrastre=false;
    cuerpo.addEventListener('mousedown', function(ev){
      if(ev.button!==0) return; const t=ev.target.closest&&ev.target.closest('td.cq-c'); if(!t||ev.target.closest('.cq-ed')) return;
      ev.preventDefault(); if(editando) cerrarEditor(true); wrap.focus({preventScroll:true});
      activar(+t.dataset.r,+t.dataset.c,ev.shiftKey,false); if(!ev.shiftKey) arrastre=true;
    });
    cuerpo.addEventListener('mousemove', function(ev){ if(!arrastre) return; if(!(ev.buttons&1)){ arrastre=false; return; } const t=ev.target.closest&&ev.target.closest('td.cq-c'); if(!t) return; const r=+t.dataset.r,c=+t.dataset.c; if(act&&act.r===r&&act.c===c) return; activar(r,c,true,false); });
    document.addEventListener('mouseup', function(){ arrastre=false; });
    cuerpo.addEventListener('dblclick', function(ev){ const t=ev.target.closest&&ev.target.closest('td.cq-c'); if(t) abrirEditor(+t.dataset.r,+t.dataset.c); });
    cuerpo.addEventListener('contextmenu', function(ev){
      const t=ev.target.closest&&ev.target.closest('td.cq-c'); if(!t) return; ev.preventDefault(); if(editando) cerrarEditor(true);
      const r=+t.dataset.r, c=+t.dataset.c, rc=rango();
      if(!(rc && r>=rc.r0 && r<=rc.r1 && c>=rc.c0 && c<=rc.c1)) activar(r,c,false,false);
      wrap.focus({preventScroll:true}); abrirMenu(ev.clientX, ev.clientY, {r:r,c:c});
    });
    document.addEventListener('mousedown', function(ev){ if(!menu.hidden && !menu.contains(ev.target)) cerrarMenu(); });
    wrap.addEventListener('scroll', cerrarMenu);
    cab.addEventListener('click', function(ev){ if(ev.target.closest('.cq-rz')) return; const th=ev.target.closest('th[data-i]'); if(!th) return; const i=+th.dataset.i; if(ordCol===i){ ordDir=-ordDir; if(ordDir>0) ordCol=-1; } else { ordCol=i; ordDir=1; } pintarCab(); pintar(); });
    let rz=null;
    cab.addEventListener('mousedown', function(ev){ const g=ev.target.closest&&ev.target.closest('.cq-rz'); if(!g) return; ev.preventDefault(); ev.stopPropagation(); const c=COLS.filter(function(x){ return x.k===g.dataset.k; })[0]; rz={ c:c, col:cg.querySelector('col[data-k="'+c.k+'"]'), x0:ev.clientX, w0:Math.round(g.parentNode.getBoundingClientRect().width), w:anchoDe(c) }; document.body.classList.add('cq-rz-on'); });
    document.addEventListener('mousemove', function(ev){ if(!rz) return; rz.w=Math.max(44,Math.round(rz.w0+ev.clientX-rz.x0)); if(rz.col) rz.col.style.width=rz.w+'px'; });
    document.addEventListener('mouseup', function(){ if(!rz) return; ANCHOS[rz.c.k]=rz.w; try{ if(LSK) localStorage.setItem(LSK+'_anchos', JSON.stringify(ANCHOS)); }catch(e){} pintarCols(); document.body.classList.remove('cq-rz-on'); rz=null; });
    cab.addEventListener('dblclick', function(ev){ const g=ev.target.closest&&ev.target.closest('.cq-rz'); if(!g) return; delete ANCHOS[g.dataset.k]; try{ if(LSK) localStorage.setItem(LSK+'_anchos', JSON.stringify(ANCHOS)); }catch(e){} pintarCols(); });
    wrap.addEventListener('keydown', function(ev){
      if(editando) return;
      const k=ev.key, ctrl=ev.ctrlKey||ev.metaKey, sh=ev.shiftKey, F={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]};
      if(ev.key==='Escape'){ cerrarMenu(); return; }
      if(!act){ if(F[k]){ ev.preventDefault(); activar(0,0,false,true); } return; }
      if(cfg.teclas && cfg.teclas(ev, api)===true){ ev.preventDefault(); return; }
      const mR=VIS.length-1, mC=COLS.length-1;
      if(ctrl && (k==='c'||k==='C'||k==='v'||k==='V')) return;          // eventos copy / paste
      if(ctrl && (k==='z'||k==='Z') && !sh){ ev.preventDefault(); if(EDIT) deshacer(); return; }
      if(ctrl && ((k==='y'||k==='Y') || ((k==='z'||k==='Z') && sh))){ ev.preventDefault(); if(EDIT) rehacer(); return; }
      if(ctrl && (k==='d'||k==='D') && !sh){ ev.preventDefault(); if(EDIT) rellenar(); return; }
      if(ctrl && (k==='a'||k==='A')){ ev.preventDefault(); marcar(0,0,mR,mC); return; }
      if(k===' ' && sh && !ctrl){ ev.preventDefault(); marcar(anc?anc.r:act.r,0,act.r,mC); return; }
      if(k===' ' && ctrl){ ev.preventDefault(); marcar(0,anc?anc.c:act.c,mR,act.c); return; }
      if(F[k]){ ev.preventDefault(); const d=F[k]; if(ctrl) saltar(d[0],d[1],sh); else mover(d[0],d[1],sh); return; }
      if(k==='Home'){ ev.preventDefault(); activar(ctrl?0:act.r,0,sh,true); return; }
      if(k==='End'){ ev.preventDefault(); activar(ctrl?mR:act.r,mC,sh,true); return; }
      if(k==='PageDown'||k==='PageUp'){ ev.preventDefault(); mover((k==='PageDown'?1:-1)*porPagina(),0,sh); return; }
      if(k==='Tab'){ ev.preventDefault(); mover(0,sh?-1:1,false); return; }
      if(k==='Enter'||k==='F2'){ ev.preventDefault(); abrirEditor(act.r,act.c); return; }
      if(k==='Delete'||k==='Backspace'){ ev.preventDefault(); if(EDIT) vaciar(); return; }
      if(k==='ContextMenu'){ ev.preventDefault(); const t=td(act.r,act.c), b=t?t.getBoundingClientRect():{left:40,bottom:40}; abrirMenu(b.left+10,b.bottom); return; }
      if(k.length===1 && !ctrl && !ev.altKey && EDIT){ ev.preventDefault(); abrirEditor(act.r,act.c,k); }
    });
    function enGrid(){ return document.activeElement===wrap || (act && wrap.contains(document.activeElement)); }
    document.addEventListener('copy', function(ev){ if(editando||!enGrid()) return; const t=tsv(); if(t==null) return; ev.preventDefault(); ev.clipboardData.setData('text/plain', t); });
    document.addEventListener('paste', function(ev){ if(editando||!EDIT||!enGrid()) return; const t=(ev.clipboardData||window.clipboardData).getData('text'); if(!t) return; ev.preventDefault(); pegar(t); });

    montarFiltros(); pintarCab();

    const api={
      cargar:function(filas){
        FILAS=(filas||[]).map(function(r){ const o=Object.assign({},r); o._orig=Object.assign({},r); return o; });
        FILT.forEach(function(f){ const hay={}; FILAS.forEach(function(r){ hay[val(r,f.k)]=1; }); Array.from(FSEL[f.id]).forEach(function(v){ if(!hay[v]) FSEL[f.id].delete(v); }); });
        act=anc=null; undo=[]; redo=[]; pintar();
      },
      // Sustituye filas por las que devolvió el servidor (misma clave) y las da por guardadas.
      reemplazar:function(nuevas){ const m={}; (nuevas||[]).forEach(function(n){ m[String(n[CLAVE])]=n; });
        FILAS=FILAS.map(function(r){ const n=m[String(r[CLAVE])]; if(!n) return r; const o=Object.assign({},n); o._orig=Object.assign({},n); return o; });
        undo=[]; redo=[]; pintar(); },                               // lo guardado ya no se deshace (como DATA al guardar)
      cambios:function(){ return FILAS.filter(sucia).map(function(r){ const c={}; COLS.forEach(function(col){ if(col.edita && String(r[col.k]==null?'':r[col.k])!==String(r._orig[col.k]==null?'':r._orig[col.k])) c[col.k]=r[col.k]; }); return { fila:r, campos:c }; }); },
      pendientes:function(){ return FILAS.filter(pendiente); },
      filas:function(){ return FILAS; }, visibles:function(){ return VIS; }, marcadas:marcadas,
      pintar:pintar, pushUndo:pushUndo, deshacer:deshacer, rehacer:rehacer, copiar:copiar, rellenar:rellenar, vaciar:vaciar,
      limpiarFiltros:limpiarFiltros, hayFiltros:hayFiltros, puedeDeshacer:function(){ return undo.length>0; }, puedeRehacer:function(){ return redo.length>0; },
      editando:function(){ return !!editando; }, cerrarEditor:function(){ cerrarEditor(true); }, cerrarMenu:cerrarMenu,
      activa:function(){ return act ? { fila:VIS[act.r], col:COLS[act.c] } : null; },
    };
    return api;
  }
  window.TM2Cuadricula={ crear:crear };
})();
