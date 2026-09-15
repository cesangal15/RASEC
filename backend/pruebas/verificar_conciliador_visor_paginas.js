/**
 * Verificación — conciliador de actas, visor de páginas del Paso 5 ("Hojear", sep-2026).
 *
 * Qué cubre (sin navegador: DOM mínimo simulado, sin pdf.js):
 *   1) Navegación en la vista grande: anterior/siguiente acotados al rango del archivo,
 *      flechas del teclado (← →), Esc cierra, y no reacciona escribiendo en un input.
 *   2) Modo general (sin faltante seleccionada): la cabecera trae las faltantes como
 *      botones y se pueden marcar VARIAS sobre la misma página sin que el visor se cierre
 *      ni avance; cada marca queda igual que una confirmación del Paso 5 (evidencia,
 *      PENDIENTE_DIGITACION, historial con nota, decisión manual, autosave).
 *   3) Modo con faltante seleccionada: se conserva el botón "Confirmar para X".
 *   4) Galería de miniaturas: el cierre va en la cabecera fija y las celdas se crean
 *      todas de entrada con alto reservado (nada empuja el botón mientras cargan).
 *   5) D114(b) sigue en pie: al DOM solo va la COPIA del canvas, nunca el maestro del caché.
 *
 * Correr:  node backend/pruebas/verificar_conciliador_visor_paginas.js
 */
'use strict';
const path=require('path');

/* ---------- DOM mínimo ---------- */
function mkEl(tag){
  const el={
    tagName:String(tag||'div').toUpperCase(), children:[], _cls:new Set(), style:{}, value:'', width:0, height:0,
    _html:'', textContent:'', parentNode:null, onclick:null, onkeydown:null, onchange:null, title:'',
    get innerHTML(){ return this._html; },
    set innerHTML(v){ this._html=String(v); this.children=[]; },
    get className(){ return Array.from(this._cls).join(' '); },
    set className(v){ this._cls=new Set(String(v).split(/\s+/).filter(Boolean)); },
    classList:{
      add:(...c)=>c.forEach(x=>el._cls.add(x)), remove:(...c)=>c.forEach(x=>el._cls.delete(x)),
      contains:c=>el._cls.has(c), toggle:c=>el._cls.has(c)?el._cls.delete(c):el._cls.add(c)
    },
    appendChild(c){ c.parentNode=el; el.children.push(c); return c; },
    insertBefore(c,ref){ c.parentNode=el; const i=el.children.indexOf(ref); if(i<0) el.children.push(c); else el.children.splice(i,0,c); return c; },
    replaceWith(n){ const p=el.parentNode; if(!p) return; const i=p.children.indexOf(el); if(i>=0) p.children[i]=n; n.parentNode=p; },
    querySelector(sel){
      const cls=sel.replace(/^\./,'');
      const walk=n=>{ for(const c of n.children){ if(c._cls.has(cls)) return c; const r=walk(c); if(r) return r; } return null; };
      return walk(el);
    },
    querySelectorAll(){ return []; }, focus(){}, addEventListener(){}, contains(){ return true; },
    getContext(){ return {drawImage(){},fillRect(){},getImageData(){return {data:new Uint8ClampedArray(0)};}}; }
  };
  return el;
}
const registry={};
global.document={
  body:mkEl('body'),
  createElement:t=>mkEl(t),
  getElementById:id=>registry[id]||(registry[id]=mkEl('div')),
  addEventListener(){}
};
global.window={};
const LS={}; global.localStorage={getItem:k=>LS[k]||null,setItem:(k,v)=>{LS[k]=v;},removeItem:k=>{delete LS[k];}};
global.setTimeout=(fn)=>{ if(typeof fn==='function') fn(); return 0; };   // sin esperas reales
global.clearTimeout=()=>{};
global.Image=function(){};
global.URL={createObjectURL:()=>''};
global.Blob=function(){};

const C=require(path.join(__dirname,'..','..','conciliador','conciliador.js'));
const {S,Paso5,mkReclamo,configSeed}=C;

let fallos=0;
const chk=(nombre,ok,detalle)=>{
  if(!ok) fallos++;
  console.log((ok?'  ok   ':'  FALLA')+'  '+nombre+(detalle!==undefined?'  → '+JSON.stringify(detalle):''));
};
const modalHtml=()=>document.getElementById('modal').innerHTML;
const modalAbierto=()=>document.getElementById('modal-bg').classList.contains('open');
const key=(k,tag)=>{ let prevented=false; Paso5._visorKey({key:k,target:{tagName:tag||'BODY'},preventDefault(){prevented=true;}}); return prevented; };

/* ---------- estado: un corte con 4 faltantes y un PDF de 7 páginas ---------- */
S.config=configSeed();
S.ui.paso=5;
S.corte={contratistaId:'ASOTRANSPA',quincena:{inicio:'2026-08-01',fin:'2026-08-15'},proformas:[],reclamos:[],secuencia:0};
const rc=(rem,ambito)=>{ const r=mkReclamo({remision:rem,archivo:'PROF.xlsx',hoja:'PUTANA',fila:1,ambito}); r.estado='NO_ENCONTRADA'; S.corte.reclamos.push(r); return r; };
const r1=rc('25927','GRANULARES'), r2=rc('25931','GRANULARES'), r3=rc('25940','GRANULARES'), r4=rc('40010','TERRAPLEN');
const encontrada=mkReclamo({remision:'25800',archivo:'PROF.xlsx',hoja:'PUTANA',fila:2,ambito:'GRANULARES'}); encontrada.estado='ENCONTRADA'; S.corte.reclamos.push(encontrada);
S.pdfs=[{name:'A.pdf',kind:'pdf',numPages:7,doc:null,error:null,ambito:'GRANULARES',ambitoAuto:false}];
S.ocr.paginas={'A.pdf#3':['25921'],'A.pdf#5':['25800']};   // p.3 leyó a un dígito de 25927 (candidata); p.5 remisión ya conciliada (reconocida)
// caché de páginas simulado: un maestro por página, como el de renderPagina
const maestros={};
Paso5.renderPagina=async(fi,pg)=>{ const k=fi+':'+pg; if(!maestros[k]){ maestros[k]=mkEl('canvas'); maestros[k].width=800; maestros[k].height=1100; } return maestros[k]; };

(async()=>{
  console.log('\n1) Navegación en la vista grande');
  let v=Paso5._visorVecinos(0,1);
  chk('página 1: sin anterior, siguiente = 2, total 7',v.prev===null&&v.next===2&&v.total===7,v);
  v=Paso5._visorVecinos(0,7);
  chk('página 7: anterior = 6, sin siguiente',v.prev===6&&v.next===null,v);
  v=Paso5._visorVecinos(0,4);
  chk('página intermedia: 3 y 5',v.prev===3&&v.next===5,v);
  chk('archivo inexistente: total 0',Paso5._visorVecinos(9,1).total===0);

  await Paso5.verGrande(0,4);
  chk('el visor queda abierto en la página 4',modalAbierto()&&Paso5._visor&&Paso5._visor.fi===0&&Paso5._visor.pg===4,Paso5._visor);
  chk('botones ‹ anterior / siguiente › apuntan a 3 y 5',/verGrande\(0,3\)/.test(modalHtml())&&/verGrande\(0,5\)/.test(modalHtml()));
  chk('trae la X de cerrar y el campo "ir a la página"',/cerrarVisor\(\)/.test(modalHtml())&&/visorIrPag/.test(modalHtml()));
  chk('índice de páginas: 7 botones y la actual marcada',(modalHtml().match(/class="vp /g)||[]).length===7&&/class="vp [^"]*cur"[^>]*>4</.test(modalHtml()));
  chk('índice coloreado con lo que sabe el OCR: p.3 candidata, p.5 reconocida, p.1 sin procesar',
    /class="vp candidata [^"]*"[^>]*>3</.test(modalHtml())&&/class="vp reconocida [^"]*"[^>]*>5</.test(modalHtml())&&/class="vp sin_procesar [^"]*"[^>]*>1</.test(modalHtml()));
  chk('el modal se ensancha para el visor',document.getElementById('modal').classList.contains('ancho'));

  let prevented=key('ArrowRight'); await Promise.resolve(); await Promise.resolve();
  chk('→ pasa a la página 5',prevented&&Paso5._visor.pg===5,Paso5._visor);
  key('ArrowLeft'); key('ArrowLeft'); await Promise.resolve();
  chk('← ← vuelve a la 3',Paso5._visor.pg===3,Paso5._visor);
  await Paso5.verGrande(0,1); key('ArrowLeft');
  chk('← en la página 1 no hace nada',Paso5._visor.pg===1);
  await Paso5.verGrande(0,7); key('ArrowRight');
  chk('→ en la última no hace nada',Paso5._visor.pg===7);
  prevented=key('ArrowLeft','INPUT');
  chk('escribiendo en un input las flechas no navegan',!prevented&&Paso5._visor.pg===7);
  Paso5.visorIr(0,99); chk('"ir a" fuera de rango se acota a la última',Paso5._visor.pg===7);
  Paso5.visorIr(0,0);  chk('"ir a" 0 se acota a la primera',Paso5._visor.pg===1);
  await Paso5.verGrande(0,2);
  chk('la primera página se puede renderizar y se pinta una COPIA (no el maestro)',
    document.getElementById('pgGrande').children.length===1&&document.getElementById('pgGrande').children[0]!==maestros['0:2']);
  key('Escape');
  chk('Esc cierra el visor',!modalAbierto()&&Paso5._visor===null);
  chk('con el visor cerrado las flechas no hacen nada',!key('ArrowRight'));

  console.log('\n2) Modo general: marcar VARIAS faltantes sobre la misma página sin salir');
  S.ui.faltanteSel=null;
  await Paso5.verGrande(0,3);
  let h=modalHtml();
  chk('la cabecera lista las 3 faltantes compatibles con el ámbito del PDF',['25927','25931','25940'].every(r=>h.indexOf('>'+r)>=0)&&/Faltantes sin confirmar \(3\)/.test(h));
  chk('la de la otra base queda plegada, no oculta',/1 faltante de la otra base oculta/.test(h)&&h.indexOf('>40010')>=0);
  chk('la que el OCR leyó a un dígito sale con ≈',/>25927 ≈</.test(h));
  chk('los botones llaman a marcarDesdeVisor con esta página',/marcarDesdeVisor\('r1',0,3\)/.test(h));
  chk('no aparece el botón "Confirmar para" (sin faltante seleccionada)',!/Confirmar para/.test(h));

  const lsAntes=LS['conciliador_sesion_auto_v1'];
  Paso5.marcarDesdeVisor(r1.id,0,3);
  chk('1ª marca: 25927 → PENDIENTE_DIGITACION con evidencia A.pdf p.3',r1.estado==='PENDIENTE_DIGITACION'&&r1.evidencia&&r1.evidencia.archivo==='A.pdf'&&r1.evidencia.pagina===3,r1.evidencia);
  chk('queda en el historial como decisión manual con nota del visor',r1.decisionManual===true&&/visor de páginas/.test(r1.historial[r1.historial.length-1].nota)&&r1.historial[r1.historial.length-1].auto===false);
  chk('autosave corrió (la sesión en localStorage cambió)',LS['conciliador_sesion_auto_v1']&&LS['conciliador_sesion_auto_v1']!==lsAntes);
  chk('el visor SIGUE abierto en la misma página',modalAbierto()&&Paso5._visor.fi===0&&Paso5._visor.pg===3,Paso5._visor);
  let acc=document.getElementById('visorAcciones').innerHTML;
  chk('25927 desaparece de la lista; quedan 2',acc.indexOf('>25927')<0&&/Faltantes sin confirmar \(2\)/.test(acc));

  Paso5.marcarDesdeVisor(r2.id,0,3);
  chk('2ª marca sobre la MISMA página: 25931 confirmada con la misma evidencia',r2.estado==='PENDIENTE_DIGITACION'&&r2.evidencia.pagina===3);
  chk('el visor sigue en la página 3',modalAbierto()&&Paso5._visor.pg===3);
  acc=document.getElementById('visorAcciones').innerHTML;
  chk('queda 1 faltante en la lista',/Faltantes sin confirmar \(1\)/.test(acc)&&acc.indexOf('>25940')>=0);
  chk('la de fondo (lista del Paso 5) también se actualizó',(document.getElementById('main').innerHTML.match(/class="falt-item/g)||[]).length===2);

  const hist=r1.historial.length;
  Paso5.marcarDesdeVisor(r1.id,0,3);
  chk('volver a pulsar una ya confirmada no la toca (guarda de doble clic)',r1.historial.length===hist&&r1.estado==='PENDIENTE_DIGITACION');
  Paso5.marcarDesdeVisor(r4.id,0,3);
  chk('la de la otra base también se puede marcar desde el plegado',r4.estado==='PENDIENTE_DIGITACION'&&r4.evidencia.pagina===3);
  chk('la marca del visor es idéntica a la de asignarFaltante (mismo estado, evidencia y forma de nota)',
    r4.historial[r4.historial.length-1].a==='PENDIENTE_DIGITACION'&&/^comprobante confirmado en A\.pdf p\.3/.test(r4.historial[r4.historial.length-1].nota));

  console.log('\n3) Modo con faltante seleccionada: comportamiento de siempre');
  S.ui.faltanteSel=r3.id;
  await Paso5.verGrande(0,6);
  h=modalHtml();
  chk('botón "Confirmar para 25940" y "Es ASFALTO" en la cabecera',/Confirmar para 25940/.test(h)&&/Es ASFALTO/.test(h));
  chk('sin la lista de faltantes en ese modo',!/Faltantes sin confirmar/.test(h));
  Paso5.confirmar(r3.id,0,6);
  chk('confirmar deja la evidencia en la página 6 y limpia la selección',r3.estado==='PENDIENTE_DIGITACION'&&r3.evidencia.pagina===6&&S.ui.faltanteSel===null);
  chk('el visor sigue abierto y pasa al modo general (ya sin faltantes por confirmar)',modalAbierto()&&/no quedan faltantes/.test(document.getElementById('visorAcciones').innerHTML));

  console.log('\n4) Galería de miniaturas: cierre fijo y celdas reservadas');
  S.pdfs[0].doc={getPage:async()=>({getViewport:()=>({width:612,height:792})})};
  await Paso5.verPaginas(0);
  h=modalHtml();
  chk('la cabecera trae la X de cerrar ANTES de la rejilla',h.indexOf('cerrarVisor()')>=0&&h.indexOf('cerrarVisor()')<h.indexOf('thumbsGrid'));
  chk('no queda el botón Cerrar al final',!/<div style="margin-top:12px;text-align:right">/.test(h));
  const grid=document.getElementById('thumbsGrid');
  chk('se crearon las 7 celdas',grid.children.length===7);
  const altoEsperado=Math.round(106*792/612);
  chk('cada celda nace con el alto de la página reservado ('+altoEsperado+' px)',grid.children.every(d=>new RegExp('height:'+altoEsperado+'px').test(d.innerHTML)||d.children.length===1));
  chk('las miniaturas insertadas son copias, no el maestro',grid.children.every(d=>d.children.every(c=>Object.values(maestros).indexOf(c)<0)));
  chk('Esc también cierra la galería',(key('Escape'),!modalAbierto()));

  console.log('\n5) Cualquier otro modal apaga el estado del visor');
  await Paso5.verGrande(0,2);
  await Paso5.editarLectura(0,2);
  chk('abrir "corregir lectura" desde el visor deja de tratar las flechas como navegación',Paso5._visor===null&&!key('ArrowRight'));

  console.log(fallos?('\n❌ '+fallos+' comprobación(es) fallaron\n'):'\n✅ Todo correcto\n');
  process.exit(fallos?1:0);
})().catch(e=>{ console.error('ERROR',e); process.exit(1); });
