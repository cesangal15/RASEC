/**
 * Verificación — conciliador de actas: exclusión manual por UF3 (D175, backlog 4.08).
 *
 * Antes, `EXCLUIDA_UF3` solo la ponía el clasificador automático cuando el candidato de
 * la BASE traía UF3. Si el parte es de UF3 pero la remisión no está en la base (no hay
 * candidato que lo diga), no había forma de excluirla como tal — César la marcaba "Es
 * ASFALTO" para sacarla del corte y el resumen quedaba mal contado. El botón «Es UF3» es
 * ahora hermano de «Es ASFALTO» en los mismos tres sitios (detalle, candidatos del Paso 5,
 * visor «Hojear»), con el mismo comportamiento (transición auditada, nota/evidencia
 * opcional, reversible), y se puede ocultar con `excluirUF3Manual` en la config.
 *
 * Correr:  node backend/pruebas/verificar_conciliador_excluir_uf3.js
 */
'use strict';
const path=require('path');

// ---- DOM mínimo (mismo estilo que verificar_conciliador_ignorar_hoja.js) ----
const _registro={};
function elemento(id){
  if(!_registro[id]) _registro[id]={
    id, value:'', innerHTML:'', style:{}, children:[],
    appendChild(ch){ this.children.push(ch); },
    querySelector(){ return null; },
    classList:{add(){},remove(){},contains(){return false;}}
  };
  return _registro[id];
}
global.document={
  getElementById:elemento,
  createElement(tag){ return {tag, className:'', innerHTML:'', style:{}, children:[],
    appendChild(ch){ this.children.push(ch); }, querySelector(){ return null; } }; },
  addEventListener(){}
};
global.localStorage={_d:{},getItem(k){return this._d[k]||null;},setItem(k,v){this._d[k]=String(v);},removeItem(k){delete this._d[k];}};

const C=require(path.join(__dirname,'..','..','conciliador','conciliador.js'));
const {S,Acciones,Paso5,configSeed,mkReclamo,setEstado,resumenCorte,ESTADOS_ACTA,ETIQUETA}=C;

let fallos=0;
const chk=(nombre,ok,detalle)=>{
  if(!ok) fallos++;
  console.log((ok?'  ok   ':'  FALLA')+'  '+nombre+(detalle!==undefined?'  → '+JSON.stringify(detalle):''));
};

function montarCorte(){
  S.config=configSeed();
  const c=S.config.contratistas[0];
  S.corte={contratistaId:c.id,quincena:{inicio:'2026-07-22',fin:'2026-08-10'},abiertoEn:'2026-08-14T00:00:00.000Z',
    proformas:[],reclamos:[],yaNoReclamadas:[],secuencia:0};
  const rc=mkReclamo({remision:'9001',archivo:'proforma.xlsx',hoja:'PUTANA',fila:2,ambito:'GRANULARES',secundarios:{}});
  setEstado(rc,'NO_ENCONTRADA',null,true);
  S.corte.reclamos.push(rc);
  return rc;
}

console.log('\n1) Config seed: excluirUF3Manual existe y arranca en true (default ON)');
{
  const cfg=configSeed();
  chk('el campo existe', 'excluirUF3Manual' in cfg, cfg.excluirUF3Manual);
  chk('default ON', cfg.excluirUF3Manual===true);
}

console.log('\n2) Detalle (Acciones._botones): "Es UF3" junto a "Es ASFALTO" para NO_ENCONTRADA');
{
  let rc=montarCorte();
  S.config.excluirUF3Manual=true;
  const html=Acciones._botones(rc);
  chk('trae el botón Es ASFALTO', /Es ASFALTO/.test(html));
  chk('trae el botón Es UF3', /Es UF3/.test(html));
  chk('el botón dispara transicion a EXCLUIDA_UF3', new RegExp("Acciones.transicion\\('"+rc.id+"','EXCLUIDA_UF3'\\)").test(html), html);
}

console.log('\n3) Deshacer: una EXCLUIDA_UF3 ya puesta ofrece "→ No encontrada" y no repite el botón Es UF3');
{
  let rc=montarCorte();
  S.config.excluirUF3Manual=true;
  setEstado(rc,'EXCLUIDA_UF3','manual',false);
  const html=Acciones._botones(rc);
  chk('ofrece volver a No encontrada', /No encontrada/.test(html));
  chk('no repite el botón Es UF3 sobre sí misma', !/EXCLUIDA_UF3'\)">Es UF3/.test(html), html);
}

console.log('\n4) Transición NO_ENCONTRADA → EXCLUIDA_UF3 con nota, auditada en el historial');
{
  let rc=montarCorte();
  elemento('notaManual').value='parte de UF3, remisión no está en la base';
  Acciones.transicion(rc.id,'EXCLUIDA_UF3');
  chk('queda EXCLUIDA_UF3', rc.estado==='EXCLUIDA_UF3', rc.estado);
  const ult=rc.historial[rc.historial.length-1];
  chk('el historial guarda la transición con nota', ult.de==='NO_ENCONTRADA'&&ult.a==='EXCLUIDA_UF3'&&ult.nota==='parte de UF3, remisión no está en la base', ult);
  chk('queda marcada como decisión manual', rc.decisionManual===true);
  elemento('notaManual').value='';
}

console.log('\n5) Paso 5 — visor «Hojear» (_visorAcciones): "Es UF3" hermano de "Es ASFALTO" con faltante seleccionada');
{
  let rc=montarCorte();
  S.config.excluirUF3Manual=true;
  S.ui.faltanteSel=rc.id;
  S.pdfs=[{name:'A.pdf',kind:'pdf',numPages:5}];
  const html=Paso5._visorAcciones(0,3);
  chk('trae Es ASFALTO', /Es ASFALTO/.test(html));
  chk('trae Es UF3', /Es UF3/.test(html));
  chk('el botón llama a Paso5.esUF3 con el id/página', new RegExp("Paso5.esUF3\\('"+rc.id+"',0,3\\)").test(html), html);
  S.ui.faltanteSel=null; S.pdfs=[];
}

console.log('\n6) Paso 5 — candidatos (_renderCandidatos): botón "Es UF3" junto a "Es ASFALTO" cuando hay archivo cargado');
(async()=>{
  let rc=montarCorte();
  S.config.excluirUF3Manual=true;
  S.pdfs=[{name:'A.pdf',kind:'pdf',numPages:5}];
  S.ocr.candidatos={'9001':[{key:'A.pdf#3',file:'A.pdf',fileIdx:0,page:3,token:'9001',nivel:'verde'}]};
  S.ocr.descartados={};
  Paso5.pagDom=async()=>{ throw new Error('sin canvas en el arnés'); };  // no interesa el render de la página
  elemento('candPaginas').children=[];   // real DOM: cont.innerHTML=html recrea el div; aquí lo reseteamos a mano
  await Paso5._renderCandidatos(rc.id);
  const cp=elemento('candPaginas');
  const html=cp.children.map(d=>d.innerHTML).join('\n');
  chk('trae Es ASFALTO', /Es ASFALTO/.test(html), html);
  chk('trae Es UF3', /Es UF3/.test(html), html);
  chk('el botón llama a Paso5.esUF3 con el fileIdx/page del candidato', new RegExp("Paso5.esUF3\\('"+rc.id+"',0,3\\)").test(html), html);

  console.log('\n7) Interruptor de config OFF: el botón desaparece de los tres sitios (las EXCLUIDA_UF3 existentes no se tocan)');
  {
    let rc2=montarCorte();
    S.config.excluirUF3Manual=false;
    chk('detalle: sin Es UF3', !/Es UF3/.test(Acciones._botones(rc2)));
    S.ui.faltanteSel=rc2.id; S.pdfs=[{name:'A.pdf',kind:'pdf',numPages:5}];
    chk('visor: sin Es UF3', !/Es UF3/.test(Paso5._visorAcciones(0,3)));
    S.ocr.candidatos={[rc2.remision]:[{key:'A.pdf#4',file:'A.pdf',fileIdx:0,page:4,token:rc2.remision,nivel:'verde'}]};
    S.ocr.descartados={};
    elemento('candPaginas').children=[];
    await Paso5._renderCandidatos(rc2.id);
    const cp2=elemento('candPaginas');
    const html2=cp2.children.map(d=>d.innerHTML).join('\n');
    chk('candidatos: sin Es UF3', !/Es UF3/.test(html2), html2);
    // una EXCLUIDA_UF3 ya puesta no cambia por apagar el interruptor
    setEstado(rc2,'EXCLUIDA_UF3','ya excluida antes de apagar el interruptor',false);
    chk('el estado existente se conserva', rc2.estado==='EXCLUIDA_UF3');
    S.config.excluirUF3Manual=true; S.ui.faltanteSel=null; S.pdfs=[];
  }

  console.log('\n8) esUF3(): transición con evidencia (archivo+página), igual que esAsfalto()');
  {
    let rc3=montarCorte();
    S.pdfs=[{name:'B.pdf',kind:'pdf',numPages:8}];
    Paso5.esUF3(rc3.id,0,6);
    chk('queda EXCLUIDA_UF3', rc3.estado==='EXCLUIDA_UF3', rc3.estado);
    chk('guarda la evidencia (archivo+página)', rc3.evidencia&&rc3.evidencia.archivo==='B.pdf'&&rc3.evidencia.pagina===6, rc3.evidencia);
    const ult=rc3.historial[rc3.historial.length-1];
    chk('nota trae el archivo y la página', /B\.pdf p\.6/.test(ult.nota||''), ult.nota);
    S.pdfs=[];
  }

  console.log('\n9) Paso 7 — resumen: "EXCLUIDAS UF3" lista las manuales igual que las automáticas');
  {
    let rc4=montarCorte();
    setEstado(rc4,'EXCLUIDA_UF3','excluida a mano',false);
    const txt=resumenCorte();
    chk('aparece la sección EXCLUIDAS UF3', /EXCLUIDAS UF3 \(1\):/.test(txt), txt);
    chk('lista la remisión', new RegExp('  '+rc4.remision).test(txt));
  }

  console.log('\n10) Exportes de acta: EXCLUIDA_UF3 (manual) sigue fuera del acta, igual que la automática');
  {
    chk('EXCLUIDA_UF3 no está en ESTADOS_ACTA', ESTADOS_ACTA.indexOf('EXCLUIDA_UF3')<0, ESTADOS_ACTA);
    chk('ESTADOS_ACTA solo trae ENCONTRADA/ACEPTADA_MANUAL', JSON.stringify(ESTADOS_ACTA)===JSON.stringify(['ENCONTRADA','ACEPTADA_MANUAL']), ESTADOS_ACTA);
    chk('la etiqueta de estado sigue siendo la del clasificador automático (mismo estado, dos orígenes)', ETIQUETA.EXCLUIDA_UF3==='Excluida UF3');
  }

  console.log(fallos?('\n❌ '+fallos+' verificación(es) fallaron\n'):'\n✅ Todo correcto\n');
  process.exit(fallos?1:0);
})();
