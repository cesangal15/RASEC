// D170: aplica los data-estilo del marcado ANTES de que corra la lógica de la pantalla (ver tema.js).
if(window.TM2Estilos) TM2Estilos.aplicar();
const APPS_SCRIPT_URL = GALCA_ENV.url.obra;          // entorno.js (D168): producción o prueba
// Motivos de horas menos (D12); '' = trabajó completo (estado OPERANDO).
const MOTIVOS=['','Mantenimiento','Sin operador','Falla mecánica','Lluvia/clima','Sin frente de trabajo','Esperando material','Abastecimiento de combustible','Traslado/movilización','Bloqueo','Otro'];
// Actividades complementarias sin producción (cereo + apoyo) que se pueden asignar a una faltante.
const COMPLEM=[
  {c:'CEREO_CORONA',l:'Cereo de corona'},{c:'CEREO_SUBBASE',l:'Cereo de subbase'},
  {c:'COMPACT_TERRAPLEN',l:'Compactación de terraplén'},{c:'COMPACT_SUBBASE',l:'Compactación de subbase'},
  {c:'COMPACT_BTC',l:'Compactación de BTC'},{c:'PAISAJEO',l:'Paisajeo / ornato'},
  {c:'ADECUACION',l:'Adecuación de caminos'},{c:'DERRUMBE',l:'Limpieza de derrumbe'}
];
const COMPLEM_LBL={}; COMPLEM.forEach(x=>COMPLEM_LBL[x.c]=x.l);
// Tipos cuya producción es SIEMPRE nula (D41/D44/D111): el backend la descarta aunque llegue, así
// que a estas máquinas no se les pide el campo. Importa desde D137: la lista de faltantes ya no es
// solo de productivas, así que vibros/minibuldózer/RT-02 aparecen aquí y antes no lo hacían.
const TIPOS_SIN_PRODUCCION=['VIBROCOMPACTADOR','MINICARGADOR','MINIBULDOZER','RETROEXCAVADORA'];
function sinProduccion(tipo){ return TIPOS_SIN_PRODUCCION.indexOf(String(tipo||'').toUpperCase())>=0; }
let STATE = { fecha:'', frentes:[], otras:[], flota:[], faltantes:[], nuevas:[] };
let MAQPROG = {};   // id_maquina -> horas programadas (para mostrar el motivo solo si trabajó menos)

/* ---- D139: quién entra y qué puede tocar ----
 * `admin` y el `residente` de tierras editan las dos pestañas. `jeisson` (rol `asistencia_plus`,
 * cuadrilla OPERADORES — los operadores de estas máquinas) edita SOLO la flota: es el primer usuario
 * de asistencias que entra a una pantalla de OBRA, aceptado a propósito, y no mezcla los módulos —
 * esta pantalla habla con el Apps Script de obra y el aislamiento de D69 no se toca. El `jefe` entra
 * en SOLO LECTURA desde `jefe.html`: se le esconde TODO lo editable (ajustes de producción,
 * redirección, registro de horas, altas y bajas). El guard de verdad está en el SERVIDOR (D109): esto
 * es la cara visible, no el cerrojo. */
let ROL='', USUARIO='', PUEDE_PRODUCCION=false, PUEDE_FLOTA=false, SOLO_LECTURA=false;
const VOLVER={ admin:'menu.html', residente:'residente.html', jefe:'jefe.html' };

window.onload = function(){
  ROL=localStorage.getItem('rol')||''; USUARIO=(localStorage.getItem('usuario')||'').trim().toLowerCase();
  PUEDE_PRODUCCION = (ROL==='admin' || ROL==='residente');
  PUEDE_FLOTA      = (PUEDE_PRODUCCION || USUARIO==='jeisson');
  SOLO_LECTURA     = (ROL==='jefe');
  if(!PUEDE_FLOTA && !SOLO_LECTURA){ window.location.href='index.html'; return; }
  document.getElementById('userDisplay').textContent=USUARIO||ROL;
  document.getElementById('headerLabel').textContent =
    SOLO_LECTURA ? 'Maquinaria · Consulta' : ('Maquinaria · '+(USUARIO||ROL));
  var _bm=document.getElementById('btnMenu');
  if(_bm){
    const destino = VOLVER[ROL] || (USUARIO==='jeisson' ? 'seleccion-reporte.html' : '');
    if(destino){
      if(ROL!=='admin') _bm.textContent='← Volver';
      _bm.onclick=function(){ location.href=destino; };
      _bm.style.display='inline-block';
    }
  }
  document.getElementById('fecha').value=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
  // `jeisson` solo tiene la flota: se le esconde la pestaña de producción y se abre la suya.
  if(!PUEDE_PRODUCCION && !SOLO_LECTURA){
    document.getElementById('tabProd').style.display='none';
    verTab('flota');
  }
  // Enlace directo a la flota (revisión → «Abrir Maquinaria › Flota», o el flujo de alta): #flota abre esa pestaña.
  else if((location.hash||'').toLowerCase().indexOf('flota')>=0){ verTab('flota'); }
};

// Pestañas. La flota se pide la PRIMERA vez que se abre: quien solo viene a ajustar producción no
// paga esa lectura, y quien solo viene a la flota no paga la del panorama del día.
function verTab(cual){
  const esFlota=(cual==='flota');
  document.getElementById('panelProd').style.display  = esFlota?'none':'';
  document.getElementById('panelFlota').style.display = esFlota?'':'none';
  document.getElementById('tabProd').className  = 'tab'+(esFlota?'':' active');
  document.getElementById('tabFlota').className = 'tab'+(esFlota?' active':'');
  const _c=document.getElementById('contenedor');
  if(_c) _c.className = 'container'+(esFlota?' ancho':'');
  if(esFlota && !FLOTA.cargada) cargarFlota();
}
function logout(){ localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token'); window.location.href='index.html'; }
function fmt(n){ return (Math.round((parseFloat(n)||0)*100)/100).toLocaleString('es-CO'); }
function ufLabel(p){ return p==='3701'?'UF1':p==='3702'?'UF2':(p||'—'); }
function motivoOpts(sel){ return MOTIVOS.map(m=>'<option value="'+esc(m)+'"'+(m===sel?' selected':'')+'>'+(m===''?'— motivo —':esc(m))+'</option>').join(''); }
function progOf(id){ return MAQPROG[id]; }
// El motivo solo aplica si la máquina trabajó MENOS que lo programado (D62)
function motShow(horas,id){ const h=parseFloat(horas), p=parseFloat(progOf(id)); return (!isNaN(h)&&!isNaN(p)&&h<p); }
function motStyle(horas,id){ return motShow(horas,id)?'':'display:none'; }
function toggleMot(wrapId,horas,id){ const el=document.getElementById(wrapId); if(el) el.style.display=motShow(horas,id)?'':'none'; }

async function consultar(){
  const fecha=document.getElementById('fecha').value;
  if(!fecha){ alert('Selecciona una fecha'); return; }
  document.getElementById('resultados').innerHTML='<div class="loading">⏳ Cargando panorama de maquinaria...</div>';
  try{
    const resp=await fetch(`${APPS_SCRIPT_URL}?action=maquinaria_produccion&fecha=${fecha}`);
    const data=await resp.json();
    STATE.fecha=fecha;
    STATE.frentes=(data.frentes||[]).sort((a,b)=> (a.proyecto+a.cc).localeCompare(b.proyecto+b.cc));
    STATE.otras=data.otras||[];
    STATE.flota=data.flota_produccion||[];
    STATE.faltantes=data.faltantes||[];
    STATE.nuevas=[];
    MAQPROG={}; STATE.flota.forEach(c=>{ MAQPROG[c.id_maquina]=c.prog; }); STATE.faltantes.forEach(m=>{ MAQPROG[m.id_maquina]=m.prog; });
    STATE.frentes.forEach(f=> f.filas.forEach(r=>{ r._val = (r.prefill===''||r.prefill==null) ? '' : String(r.prefill); }));
    render();
  }catch(err){
    document.getElementById('resultados').innerHTML='<div class="empty-state"><div class="icon">⚠️</div><p>No se pudo consultar. Revisa el Apps Script o la conexión.</p></div>';
  }
}

function frenteKey(f){ return f.proyecto+'|'+f.bucket; }
function findFila(id){ for(const f of STATE.frentes){ for(const r of f.filas){ if(r.id_registro===id) return r; } } return null; }
function setFila(id,val){ const r=findFila(id); if(r) r._val=val; }
function setNueva(idx,field,val){ if(STATE.nuevas[idx]) STATE.nuevas[idx][field]=val; }
function asignadas(){ const s={}; STATE.nuevas.forEach(n=>{ if(n.id_maquina) s[n.id_maquina]=1; }); return s; }

// suma repartida en un frente = producciones de sus máquinas + redirecciones a ese frente
function frenteSum(f){ let s=0;
  f.filas.forEach(r=>{ const v=parseFloat(r._val); if(!isNaN(v)) s+=v; });
  STATE.nuevas.forEach(n=>{ if(n.bucket && (String(n.proyecto||'')+'|'+n.bucket)===frenteKey(f)){ const v=parseFloat(n.produccion); if(!isNaN(v)) s+=v; } });
  return Math.round(s*100)/100;
}
function balInner(f){ const s=frenteSum(f), r=Math.round((f.oficial-s)*100)/100;
  return '<span>Repartido <b>'+fmt(s)+'</b> m³</span><span class="rest">Restante <b>'+fmt(r)+'</b> m³'+(r<-0.01?' ⚠️ excede el oficial':'')+'</span>'; }
function recalcBal(key){ const f=STATE.frentes.find(x=>frenteKey(x)===key); const el=document.getElementById('bal_'+key);
  if(f&&el){ el.innerHTML=balInner(f); el.className='balbar'+(((f.oficial-frenteSum(f))<-0.01)?' over':''); } }

function addMaquina(key){
  const sel=document.getElementById('sel_'+key), np=document.getElementById('np_'+key), nh=document.getElementById('nh_'+key), nm=document.getElementById('nm_'+key);
  const id_maquina=sel?sel.value:''; if(!id_maquina){ alert('Elige una máquina'); return; }
  const f=STATE.frentes.find(x=>frenteKey(x)===key); if(!f) return;
  STATE.nuevas.push({ frenteKey:key, proyecto:f.proyecto, bucket:f.bucket, id_maquina,
    produccion: np?np.value.trim():'', horas: nh?nh.value.trim():'', motivo: nm?nm.value:'' });
  render();
}
function addFaltante(id){
  const dst=document.getElementById('dst_'+id).value;
  if(!dst){ alert('Elige un destino para '+id); return; }
  const horas=((document.getElementById('hf_'+id)||{}).value||'').trim();
  const motivo=(document.getElementById('mf_'+id)||{}).value||'';
  const prod=((document.getElementById('pf_'+id)||{}).value||'').trim();
  const it={ id_maquina:id, _faltante:true, horas:horas, motivo:motivo };
  if(dst.charAt(0)==='F'){ const f=STATE.frentes.find(x=>frenteKey(x)===dst.slice(2)); if(!f) return;
    it.proyecto=f.proyecto; it.bucket=f.bucket; it.produccion=prod; it._destLabel=f.cc+' '+f.label+' '+ufLabel(f.proyecto); }
  else if(dst.charAt(0)==='A'){ const c=dst.slice(2); it.complem=c; it._destLabel=COMPLEM_LBL[c]+' (sin producción)'; }
  else { it._destLabel='Solo horas'; }
  STATE.nuevas.push(it);
  render();
}
function removeNueva(idx){ STATE.nuevas.splice(idx,1); render(); }

function render(){
  const cont=document.getElementById('resultados');
  if(!STATE.frentes.length && !STATE.otras.length && !STATE.faltantes.length){
    cont.innerHTML='<div class="empty-state"><div class="icon">🗓️</div><p>No hay producción de maquinaria para esta fecha.</p></div>';
    return;
  }
  let html = SOLO_LECTURA
    ? '<div class="nota">Vista de <b>solo lectura</b>: el panorama de maquinaria del día tal como quedó en MAQUINARIA. '+
      'Los ajustes de producción, la redirección y el registro de horas los hace el residente o el administrador.</div>'
    : '<div class="nota">Este panel <b>lee DATA</b> (volumen y PK oficial) y <b>lee/escribe MAQUINARIA</b>. Nunca modifica DATA. '+
      'La producción viene sugerida (repartida proporcional a lo que reportaron) y el <b>Restante</b> te avisa para no pasarte del oficial. '+
      'El <b>motivo</b> solo aparece si la máquina trabajó menos horas que las programadas.</div>';

  // ---- frentes ajustables ----
  if(STATE.frentes.length){
    html+='<div class="section-title">Frentes ajustables (excavación · terraplén · ZODME)</div>';
    STATE.frentes.forEach(f=>{
      const key=frenteKey(f), keyA=esc(key), keyJs=esc(String(key).replace(/'/g,"\\'"));
      const pend=STATE.nuevas.map((n,i)=>({n,i})).filter(o=>o.n.frenteKey===key && !o.n._faltante);
      const orphan=(f.n_maquinas===0 && pend.length===0);
      const pkOfi=(f.pk_oficial&&f.pk_oficial.length)?('<span class="pkofi">PK ofi: '+f.pk_oficial.map(esc).join(' · ')+'</span>'):'';
      html+='<div class="frente'+(orphan?' orphan':'')+'">';
      html+='<div class="frente-head">'+
              '<span class="frente-cc">'+esc(f.cc)+'</span>'+
              '<span class="badge '+(f.proyecto==='3701'?'uf1':'uf2')+'">'+ufLabel(f.proyecto)+'</span>'+
              '<span class="frente-lbl">'+esc(f.label)+'</span>'+
              (orphan?'<span class="sinmaq">sin máquina · redirige</span>':'')+
              '<span class="frente-ofi">Oficial DATA <b>'+fmt(f.oficial)+'</b> m³ · '+f.n_maquinas+' máq.'+pkOfi+'</span>'+
            '</div>';
      // barra de balance (repartido / restante), viva
      html+='<div class="balbar'+(((f.oficial-frenteSum(f))<-0.01)?' over':'')+'" id="bal_'+keyA+'">'+balInner(f)+'</div>';
      f.filas.forEach(r=>{
        const multi=(r.otras_actividades&&r.otras_actividades.length)?'<span class="pill multi">también: '+r.otras_actividades.map(esc).join(' · ')+'</span>':'';
        const orig=(r.produccion_orig!==''&&r.produccion_orig!=null)?'<span class="pill orig">orig. capataz: '+fmt(r.produccion_orig)+'</span>':'';
        const pk=r.pk?'<span class="pill pk">PK '+esc(r.pk)+'</span>':'';
        const hr=(r.horas!==''&&r.horas!=null)?'<span class="pill h">'+fmt(r.horas)+' h</span>':'';
        html+='<div class="maq-row">'+
                '<div class="maq-id">'+esc(r.id_maquina)+'</div>'+
                '<div class="maq-info"><div class="maq-act">'+esc(r.actividad)+'</div>'+
                  '<div class="maq-sub"><span class="pill">actual: '+(r.produccion_actual===''?'—':fmt(r.produccion_actual))+'</span>'+pk+hr+orig+multi+'</div>'+
                '</div>'+
                (SOLO_LECTURA
                  ? '<div class="edits"><span class="pill">sugerido: '+(r._val===''?'—':fmt(r._val))+'</span></div>'
                  : '<div class="edits"><div class="mini"><label>Producción</label>'+
                    '<input type="number" step="0.01" inputmode="decimal" value="'+esc(r._val)+'" '+
                      'data-on-input="setFila(\''+esc(String(r.id_registro).replace(/'/g,"\\'"))+'\',this.value); recalcBal(\''+keyJs+'\')"></div></div>')+
              '</div>';
      });
      pend.forEach(o=>{
        html+='<div class="maq-row nueva">'+
                '<div class="maq-id">'+esc(o.n.id_maquina)+'</div>'+
                '<div class="maq-info"><div class="maq-act">'+esc(f.label)+' <span class="pill new">redirigido</span></div>'+
                  '<div class="maq-sub">se creará una fila nueva en MAQUINARIA</div></div>'+
                '<div class="edits">'+
                  '<div class="mini"><label>Producción</label><input type="number" step="0.01" value="'+esc(o.n.produccion)+'" data-on-input="setNueva('+o.i+',\'produccion\',this.value); recalcBal(\''+keyJs+'\')"></div>'+
                  '<div class="mini"><label>Horas</label><input type="number" step="0.1" value="'+esc(o.n.horas)+'" data-on-input="setNueva('+o.i+',\'horas\',this.value); toggleMot(\'pnmw_'+o.i+'\',this.value,\''+esc(o.n.id_maquina)+'\')"></div>'+
                  '<span class="mini wide" id="pnmw_'+o.i+'" data-estilo="'+motStyle(o.n.horas,o.n.id_maquina)+'"><label>Motivo</label><select data-on-change="setNueva('+o.i+',\'motivo\',this.value)">'+motivoOpts(o.n.motivo||'')+'</select></span>'+
                  '<button class="rm" title="Quitar" data-on-click="removeNueva('+o.i+')">✕</button>'+
                '</div>'+
              '</div>';
      });
      if(!SOLO_LECTURA){
      const opts='<option value="">— redirigir a máquina —</option>'+STATE.flota.map(c=>
        '<option value="'+esc(c.id_maquina)+'">'+esc(c.id_maquina)+(c.reportada?' · reportada':'')+'</option>').join('');
      html+='<div class="add-wrap"><div class="alabel">Redirigir producción a una máquina (crea su fila)</div>'+
              '<div class="add-inputs">'+
                '<select class="sel-main" id="sel_'+keyA+'" data-on-change="onRedir(\''+keyJs+'\')">'+opts+'</select>'+
                '<div class="mini"><label>Producción</label><input type="number" step="0.01" id="np_'+keyA+'"></div>'+
                '<div class="mini"><label>Horas</label><input type="number" step="0.1" id="nh_'+keyA+'" data-on-input="onRedir(\''+keyJs+'\')"></div>'+
                '<span class="mini wide" id="nmw_'+keyA+'" data-estilo="display:none"><label>Motivo</label><select id="nm_'+keyA+'">'+motivoOpts('')+'</select></span>'+
                '<button class="btn-add" data-on-click="addMaquina(\''+keyJs+'\')">➕ Añadir</button>'+
              '</div></div>';
      }
      html+='</div>';
    });
  }

  // ---- otras máquinas (contexto) ----
  if(STATE.otras.length){
    html+='<div class="section-title">Otras máquinas con producción · contexto</div><div class="otras-card">';
    STATE.otras.forEach(o=>{
      const pk=o.pk?'<span class="pill pk">PK '+esc(o.pk)+'</span>':'';
      const hr=(o.horas!==''&&o.horas!=null)?'<span class="pill h">'+fmt(o.horas)+' h</span>':'';
      html+='<div class="otra-row">'+
              '<span class="maq-id">'+esc(o.id_maquina)+'</span>'+
              '<span class="o-act">'+esc(o.actividad)+'  '+pk+' '+hr+(o.reporta?' <span class="lectura-tag">'+esc(o.reporta)+'</span>':'')+'</span>'+
              '<span class="o-prod">'+(o.produccion_actual===''?'—':fmt(o.produccion_actual))+' '+esc(o.unidad||'')+'</span>'+
              '<span class="lectura-tag">lectura</span>'+
            '</div>';
    });
    html+='</div>';
  }

  // ---- máquinas faltantes (sin reporte) ----
  const asig=asignadas();
  const faltanReal=STATE.faltantes.filter(m=>!asig[m.id_maquina]);
  const pendFalt=STATE.nuevas.map((n,i)=>({n,i})).filter(o=>o.n._faltante);
  if(STATE.faltantes.length){
    html+='<div class="section-title">'+(SOLO_LECTURA?'Máquinas sin reporte ese día':'Máquinas faltantes · asígnalas o registra horas')+'</div><div class="falt-card">';
    let dstFrentes=''; STATE.frentes.forEach(f=>{ dstFrentes+='<option value="F|'+esc(frenteKey(f))+'">'+esc(f.cc)+' · '+esc(f.label)+' · '+ufLabel(f.proyecto)+'</option>'; });
    let dstComplem=COMPLEM.map(x=>'<option value="A|'+esc(x.c)+'">'+esc(x.l)+'</option>').join('');
    const dstOpts='<option value="">— elegir destino —</option>'+
      (dstFrentes?('<optgroup label="Frentes del día (con producción)">'+dstFrentes+'</optgroup>'):'')+
      '<optgroup label="Complementaria (sin producción)">'+dstComplem+'</optgroup>'+
      '<option value="H">Solo registrar horas</option>';
    faltanReal.forEach(m=>{
      html+='<div class="falt-item">'+
              '<div class="falt-head"><span class="maq-id">'+esc(m.id_maquina)+'</span>'+
                '<span class="falt-tipo">'+esc(m.tipo||'')+' · prog '+esc(m.prog)+' h</span><span class="badge falta">FALTA</span></div>'+
              (SOLO_LECTURA ? '' :
              '<div class="falt-ctrls">'+
                '<select class="sel-dst" id="dst_'+esc(m.id_maquina)+'">'+dstOpts+'</select>'+
                '<div class="mini"><label>Horas oper.</label><input type="number" step="0.1" id="hf_'+esc(m.id_maquina)+'" data-on-input="toggleMot(\'mfw_'+esc(m.id_maquina)+'\',this.value,\''+esc(m.id_maquina)+'\')"></div>'+
                '<span class="mini wide" id="mfw_'+esc(m.id_maquina)+'" data-estilo="display:none"><label>Motivo</label><select id="mf_'+esc(m.id_maquina)+'">'+motivoOpts('')+'</select></span>'+
                (sinProduccion(m.tipo) ? '<span class="mini wide" data-estilo="opacity:.7">sin producción propia</span>'
                                       : '<div class="mini"><label>Prod. (si frente)</label><input type="number" step="0.01" id="pf_'+esc(m.id_maquina)+'"></div>')+
                '<button class="btn-add" data-on-click="addFaltante(\''+esc(m.id_maquina)+'\')">➕ Asignar</button>'+
              '</div>')+
            '</div>';
    });
    if(pendFalt.length){
      html+='<div data-estilo="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);">';
      pendFalt.forEach(o=>{
        const det=[]; if(o.n.horas) det.push(fmt(o.n.horas)+' h'); if(o.n.motivo) det.push(esc(o.n.motivo)); if(o.n.produccion) det.push('prod '+fmt(o.n.produccion));
        html+='<div class="asig-row">'+
                '<span class="maq-id">'+esc(o.n.id_maquina)+'</span>'+
                '<span class="a-main">→ '+esc(o.n._destLabel||'')+(det.length?(' · '+det.join(' · ')):'')+' <span class="asig-tag">asignada</span></span>'+
                '<button class="rm" title="Quitar" data-on-click="removeNueva('+o.i+')">✕</button>'+
              '</div>';
      });
      html+='</div>';
    }
    html+='</div>';
  }

  if(!SOLO_LECTURA) html+='<div class="actions"><button class="btn-action primary" id="btnGuardar" data-on-click="guardar()">💾 GUARDAR</button></div>';
  html+='<div class="msg-box" id="msg"></div>';
  cont.innerHTML=html;
}

// muestra/oculta el motivo del formulario de redirección según la máquina elegida y las horas
function onRedir(key){
  const id=(document.getElementById('sel_'+key)||{}).value;
  const ho=(document.getElementById('nh_'+key)||{}).value;
  toggleMot('nmw_'+key, ho, id);
}

async function guardar(){
  const ajustes=[];
  STATE.frentes.forEach(f=> f.filas.forEach(r=>{
    const val=String(r._val==null?'':r._val).trim(); if(val==='') return;
    const num=parseFloat(val); if(isNaN(num)) return;
    ajustes.push({ id_registro:r.id_registro, produccion:num });
  }));
  const nuevas=[];
  STATE.nuevas.forEach(n=>{
    const it={ id_maquina:n.id_maquina };
    if(n.bucket) it.bucket=n.bucket;
    if(n.complem) it.complem=n.complem;
    if(n.proyecto) it.proyecto=n.proyecto;
    const p=String(n.produccion==null?'':n.produccion).trim(); if(p!==''&&!isNaN(parseFloat(p))) it.produccion=parseFloat(p);
    const h=String(n.horas==null?'':n.horas).trim();           if(h!==''&&!isNaN(parseFloat(h))) it.horas=parseFloat(h);
    // motivo solo si trabajó menos que lo programado
    if(n.motivo && motShow(h, n.id_maquina)) it.motivo=n.motivo;
    if(!it.bucket && !it.complem && it.horas===undefined) return;
    if(it.bucket && it.produccion===undefined && it.horas===undefined) return;
    nuevas.push(it);
  });
  const msg=document.getElementById('msg');
  if(!ajustes.length && !nuevas.length){ msg.className='msg-box err'; msg.style.display='block'; msg.textContent='No hay nada para guardar (todos los campos están en blanco).'; return; }
  const btn=document.getElementById('btnGuardar'); btn.disabled=true; btn.textContent='Guardando...';
  try{
    const resp=await fetch(APPS_SCRIPT_URL, {
      method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({ action:'maquinaria_produccion', fecha:STATE.fecha, usuario:localStorage.getItem('usuario')||'(admin)', ajustes, nuevas })
    });
    const data=await resp.json();
    if(data && data.ok){
      await consultar();
      const m2=document.getElementById('msg');
      if(m2){ m2.className='msg-box ok'; m2.style.display='block';
        m2.textContent='✓ MAQUINARIA actualizada: '+(data.actualizadas||0)+' ajustada(s)'+((data.creadas||0)?(' y '+data.creadas+' creada(s)'):'')+'. DATA quedó intacta.'; }
    }else{
      msg.className='msg-box err'; msg.style.display='block';
      msg.textContent='Error al guardar: '+((data&&data.error)||'respuesta inesperada');
    }
  }catch(err){
    msg.className='msg-box err'; msg.style.display='block';
    msg.textContent='No se pudo guardar. Revisa el Apps Script o la conexión.';
  }finally{
    const b=document.getElementById('btnGuardar'); if(b){ b.disabled=false; b.textContent='💾 GUARDAR'; }
  }
}

/* ==================== PESTAÑA FLOTA (D139, backlog 2.29) ====================
 *
 * Da de alta y de baja máquinas ESCRIBIENDO la hoja `MAQUINAS` de D138 desde la web, en vez de a mano
 * en el Sheet. La razón principal no es la comodidad: el `id_maquina` lo teclea una persona y tiene
 * que coincidir LETRA POR LETRA con `dim_maquinaria` del maestro (por eso `RT-02` va con guion, D111)
 * o el pegado a `Captura_Diaria` deja de cruzar EN SILENCIO. Una hoja suelta no puede avisar de eso;
 * esta pantalla sí — el servidor compara contra el histórico de MAQUINARIA y pregunta antes de
 * guardar. Aquí también se ven por fin los `avisos` que `?action=maquinas` ya devolvía y nadie leía.
 *
 * UNA FILA POR ESTANCIA y ventana SEMIABIERTA `[ingreso, retiro)`: `fecha_retiro` es el PRIMER DÍA QUE
 * YA NO ESTUVO (vacía = sigue en obra). Un REINGRESO es una fila nueva, jamás editar la vieja:
 * editarla perdería el hueco en que la máquina no estuvo (lección de D85 con el personal). "Corregir"
 * existe aparte, para una estancia mal escrita.
 */
/* D173: la flota es TODA la maquinaria de la obra, no solo la pesada — volquetas, camabajas,
 * carrotanques, camiones, turbos y luminarias entran y salen igual (y más seguido: una volqueta varada
 * se reemplaza por otra dos días). Cada estancia lleva además el FRENTE (UF1-UF2 / UF3) y la ficha
 * del equipo (placa · medidor · proveedor) que vive en PARTE_EQUIPOS: es lo que el Parte Digital
 * usa para saber a quién esperar cada día. El panel de producción solo mira los tipos que producen. */
const TIPOS_RESPALDO=['BULLDOZER','EXCAVADORA','MOTONIVELADORA','FINISHER','VIBROCOMPACTADOR',
                      'MINICARGADOR','MINIBULDOZER','RETROEXCAVADORA'];
const TIPOS_FLOTA_RESPALDO=TIPOS_RESPALDO.concat(['VOLQUETA','CAMABAJA','TRACTOCAMION','CARROTANQUE','CAMION','TURBO','CISTERNA','LUMINARIA']);
const FRENTES_RESPALDO=['UF1-UF2','UF3'];
const GRUPOS_RESPALDO=['tierras','drenajes'];   // D183: disciplina de la máquina (ortogonal al frente/UF)
let FLOTA={ cargada:false, fecha:'', estancias:[], avisos:[], tipos:[], tiposProd:[], orden:[], fuente:'', historico:0,
            frentes:[], frenteDef:'UF1-UF2', frentesParte:['UF1-UF2'], grupos:[], grupoDef:'tierras' };
// Formulario abierto (uno a la vez) + sus valores. Se guardan en el estado, no en el DOM: la lista se
// vuelve a pintar entera después de cada cambio, como en el resto de la pantalla.
// `q` = filtro del buscador · `pleg` = qué bloques plegados están abiertos · `hist` = qué máquinas
// muestran sus estancias anteriores. Nada de esto viaja al servidor: es solo cómo se está mirando.
let FL={ op:'', clave:null, vals:{}, hist:{}, pleg:{fuera:false}, q:'', frente:'todos', grupo:'todos', msg:null, guardando:false };

function hoyCol(){ return new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'}); }
function flTipos(){ return (FLOTA.tipos&&FLOTA.tipos.length)?FLOTA.tipos:TIPOS_FLOTA_RESPALDO; }
function flOrden(){ return (FLOTA.orden&&FLOTA.orden.length)?FLOTA.orden:TIPOS_FLOTA_RESPALDO; }
function flTiposProd(){ return (FLOTA.tiposProd&&FLOTA.tiposProd.length)?FLOTA.tiposProd:TIPOS_RESPALDO; }
function flFrentes(){ return (FLOTA.frentes&&FLOTA.frentes.length)?FLOTA.frentes:FRENTES_RESPALDO; }
function flListaGrupos(){ return (FLOTA.grupos&&FLOTA.grupos.length)?FLOTA.grupos:GRUPOS_RESPALDO; }   // D183
function flEsProd(tipo){ return flTiposProd().indexOf(String(tipo||'').toUpperCase())>=0; }
function flFrenteDe(e){ return e.frente || FLOTA.frenteDef || 'UF1-UF2'; }
function flGrupoDe(e){ return e.grupo || FLOTA.grupoDef || 'tierras'; }   // D183: disciplina de la máquina
function flGrupoLabel(g){ return g==='drenajes' ? 'Drenajes' : 'Tierras'; }

async function cargarFlota(){
  const cont=document.getElementById('flotaCont');
  cont.innerHTML='<div class="loading">⏳ Cargando la flota...</div>';
  document.getElementById('flotaLista').innerHTML='';
  try{
    const resp=await fetch(`${APPS_SCRIPT_URL}?action=flota&fecha=${hoyCol()}`);
    const d=await resp.json();
    if(!d || !d.ok) throw new Error((d&&d.error)||'respuesta inesperada');
    aplicarFlota(d);
  }catch(err){
    cont.innerHTML='<div class="empty-state"><div class="icon">⚠️</div><p>No se pudo leer la hoja MAQUINAS. '+
      'Revisa el Apps Script o la conexión.</p><p data-estilo="font-size:12px;margin-top:8px">Si el endpoint no existe todavía, '+
      'falta <b>redesplegar</b> el Apps Script de obra.</p></div>';
  }
}
// Comparte el mismo camino la carga inicial y la respuesta de una escritura: `flota_guardar` devuelve
// la hoja YA releída en la misma ejecución, así que no hace falta una segunda petición.
function aplicarFlota(d){
  FLOTA.cargada=true; FLOTA.fecha=d.fecha||hoyCol(); FLOTA.estancias=d.estancias||[];
  FLOTA.avisos=d.avisos||[]; FLOTA.tipos=d.tipos||[]; FLOTA.orden=d.orden_tipo||[];
  FLOTA.tiposProd=d.tipos_produccion||[]; FLOTA.frentes=d.frentes||[]; FLOTA.frenteDef=d.frente_defecto||'UF1-UF2';
  FLOTA.frentesParte=d.frentes_parte||[FLOTA.frenteDef];
  FLOTA.grupos=d.grupos||[]; FLOTA.grupoDef=d.grupo_defecto||'tierras';   // D183
  FLOTA.fuente=d.fuente||''; FLOTA.historico=d.historico_maquinaria||0;
  renderFlota();
}

function flPorMaquina(){
  const m={};
  FLOTA.estancias.forEach(function(e){ (m[e.id_maquina]=m[e.id_maquina]||[]).push(e); });
  Object.keys(m).forEach(function(id){
    m[id].sort(function(a,b){ return String(b.fecha_ingreso||'').localeCompare(String(a.fecha_ingreso||'')); });
  });
  const orden=flOrden();
  const ids=Object.keys(m).sort(function(a,b){
    const ta=orden.indexOf(m[a][0].tipo), tb=orden.indexOf(m[b][0].tipo);
    return ((ta<0?99:ta)-(tb<0?99:tb)) || (a<b?-1:a>b?1:0);
  });
  return { map:m, ids:ids };
}
function flVentana(e){
  if(!e.valida) return 'sin fecha de ingreso';
  return e.fecha_ingreso+' → '+(e.fecha_retiro ? e.fecha_retiro : 'sigue en obra');
}

/* ---- formularios (uno abierto a la vez) ---- */
// La estancia se busca por su CLAVE (máquina + fecha de ingreso), nunca se serializa el objeto en el
// HTML: es la misma identidad con la que el servidor la localiza, y así una nota con comillas no puede
// romper el atributo.
function flEstancia(id, ing){
  return FLOTA.estancias.filter(function(e){ return e.id_maquina===id && e.fecha_ingreso===ing; })[0] || null;
}
function flAbrir(op, id, ing){
  const e = id ? flEstancia(id, ing) : null;
  if(op!=='alta' && !e) return;
  FL.op=(op==='reingreso'?'alta':op); FL.msg=null;
  FL.clave = (op==='corregir'||op==='baja') ? { id_maquina:e.id_maquina, fecha_ingreso:e.fecha_ingreso } : null;
  const fr=(FL.frente!=='todos' && FL.frente) ? FL.frente : (FLOTA.frenteDef||'UF1-UF2');
  const gr=(FL.grupo!=='todos' && FL.grupo) ? FL.grupo : (FLOTA.grupoDef||'tierras');   // D183: hereda el filtro de grupo activo
  if(op==='alta')      FL.vals={ id_maquina:'', tipo:'', propiedad:'propia', fecha_ingreso:hoyCol(), horas_prog:'', notas:'',
                                 frente:fr, grupo:gr, placa:'', proveedor:'', medidor:'' };
  if(op==='reingreso') FL.vals={ id_maquina:e.id_maquina, tipo:e.tipo, propiedad:e.propiedad||'propia',
                                 fecha_ingreso:hoyCol(), horas_prog:e.horas_prog===''?'':String(e.horas_prog), notas:'',
                                 frente:flFrenteDe(e), grupo:flGrupoDe(e), placa:e.placa||'', proveedor:e.proveedor||'', medidor:e.medidor||'' };
  if(op==='baja')      FL.vals={ fecha_retiro:hoyCol() };
  if(op==='corregir')  FL.vals={ id_maquina:e.id_maquina, tipo:e.tipo, propiedad:e.propiedad||'propia',
                                 fecha_ingreso:e.fecha_ingreso, fecha_retiro:e.fecha_retiro||'',
                                 horas_prog:e.horas_prog===''?'':String(e.horas_prog), notas:e.notas||'',
                                 frente:flFrenteDe(e), grupo:flGrupoDe(e), placa:e.placa||'', proveedor:e.proveedor||'', medidor:e.medidor||'' };
  renderFlota();
}
function flCerrar(){ FL.op=''; FL.clave=null; FL.vals={}; renderFlota(); }
function flSet(campo, val){ FL.vals[campo]=val; }
function flToggleHist(id){ FL.hist[id]=!FL.hist[id]; renderFlotaLista(); }

// Tipo: lista + texto libre (datalist). Los tipos de PRODUCCIÓN tienen que ir exactos (de ahí sale la
// regla de producción nula); uno nuevo (p. ej. GRUA) se acepta y solo sale en la flota y en el parte.
function flSelTipo(){
  return '<input type="text" list="flTiposList" value="'+esc(FL.vals.tipo||'')+'" data-on-input="flSet(\'tipo\',this.value)" '+
           'placeholder="VOLQUETA, EXCAVADORA…" autocapitalize="characters">'+
         '<datalist id="flTiposList">'+flTipos().map(function(t){ return '<option value="'+esc(t)+'"></option>'; }).join('')+'</datalist>';
}
function flSelFrente(){
  return '<select data-on-change="flSet(\'frente\',this.value)">'+
    flFrentes().map(function(f){ return '<option value="'+esc(f)+'"'+(f===FL.vals.frente?' selected':'')+'>'+esc(f)+'</option>'; }).join('')+
    '</select>';
}
function flSelGrupo(){   // D183: disciplina de la máquina (tierras/drenajes)
  return '<select data-on-change="flSet(\'grupo\',this.value)">'+
    flListaGrupos().map(function(g){ return '<option value="'+esc(g)+'"'+(g===FL.vals.grupo?' selected':'')+'>'+esc(flGrupoLabel(g))+'</option>'; }).join('')+
    '</select>';
}
function flSelMedidor(){
  return '<select data-on-change="flSet(\'medidor\',this.value)"><option value="">— no sé aún —</option>'+
    ['HOROMETRO','KM'].map(function(m){ return '<option value="'+m+'"'+(m===FL.vals.medidor?' selected':'')+'>'+(m==='KM'?'KM (kilometraje)':'HORÓMETRO')+'</option>'; }).join('')+
    '</select>';
}
function flSelProp(){
  return '<select data-on-change="flSet(\'propiedad\',this.value)">'+
    ['propia','alquilada'].map(function(p){ return '<option value="'+p+'"'+(p===FL.vals.propiedad?' selected':'')+'>'+p+'</option>'; }).join('')+
    '</select>';
}
// Formulario de datos completos: sirve para el alta, el reingreso y la corrección.
function flFormDatos(titulo){
  const esCorregir=(FL.op==='corregir');
  return '<div class="fform"><div class="ftitle">'+titulo+'</div><div class="fgrid">'+
    '<div class="f"><label>Código (id_maquina)</label><input type="text" value="'+esc(FL.vals.id_maquina||'')+'" '+
      'data-on-input="flSet(\'id_maquina\',this.value)" placeholder="EXC015" autocapitalize="characters"></div>'+
    '<div class="f wide"><label>Tipo</label>'+flSelTipo()+'</div>'+
    '<div class="f"><label>Frente</label>'+flSelFrente()+'</div>'+
    '<div class="f"><label>Grupo</label>'+flSelGrupo()+'</div>'+
    '<div class="f"><label>Propiedad</label>'+flSelProp()+'</div>'+
    '<div class="f"><label>Ingreso</label><input type="date" value="'+esc(FL.vals.fecha_ingreso||'')+'" data-on-input="flSet(\'fecha_ingreso\',this.value)"></div>'+
    (esCorregir ? '<div class="f"><label>Retiro</label><input type="date" value="'+esc(FL.vals.fecha_retiro||'')+'" data-on-input="flSet(\'fecha_retiro\',this.value)"></div>' : '')+
    '<div class="f"><label>Horas prog.</label><input type="number" step="0.1" value="'+esc(FL.vals.horas_prog||'')+'" '+
      'data-on-input="flSet(\'horas_prog\',this.value)" placeholder="auto"></div>'+
    '<div class="f"><label>Placa</label><input type="text" value="'+esc(FL.vals.placa||'')+'" data-on-input="flSet(\'placa\',this.value)" placeholder="NNM203" autocapitalize="characters"></div>'+
    '<div class="f"><label>Medidor (parte)</label>'+flSelMedidor()+'</div>'+
    '<div class="f wide"><label>Proveedor</label><input type="text" value="'+esc(FL.vals.proveedor||'')+'" data-on-input="flSet(\'proveedor\',this.value)" placeholder="ORTIZ · DINISSAN · ASOVOLSAT…"></div>'+
    '<div class="f wide"><label>Notas</label><input type="text" value="'+esc(FL.vals.notas||'')+'" data-on-input="flSet(\'notas\',this.value)"></div>'+
    '</div>'+
    '<div class="fhint"><b>Frente</b>: a qué proyecto atiende (el Parte Digital espera cada día a los de <b>'+esc((FLOTA.frentesParte||[]).join(' · '))+'</b>). '+
      '<b>Grupo</b>: la disciplina de la máquina (tierras o drenajes). El parte agrupa «Equipos sin parte» por grupo, así una máquina de drenajes (p. ej. el turbo del ing. de drenajes) no se mezcla con las de tierras. UF3 va por el <b>Frente</b>, no por aquí. '+
      '<b>Placa · medidor · proveedor</b> son la ficha del equipo en <code>PARTE_EQUIPOS</code>: si no existe se crea con el alta (sin ficha el QR no abre el parte); si ya existe, solo se rellena lo que esté en blanco. '+
      'Horas programadas en blanco = se deducen de la propiedad: <b>5 h</b> alquilada · <b>6.4 h</b> propia (D10); solo cuentan para los tipos que producen. '+
      'El código es el del <b>parte</b> (MO003, CR008, VOL048, RT-02 con guion): si no se reconoce, se avisa antes de guardar.'+
      (esCorregir ? ' Corregir es para una estancia <b>mal escrita</b>; si la máquina volvió a la obra, va un <b>reingreso</b> (fila nueva), que conserva el hueco en que no estuvo.' : '')+
    '</div>'+
    '<div class="actions">'+
      '<button class="btn-action primary" data-on-click="flGuardar()"'+(FL.guardando?' disabled':'')+'>💾 '+(esCorregir?'GUARDAR CAMBIOS':'DAR DE ALTA')+'</button>'+
      '<button class="btn-action" data-on-click="flCerrar()">Cancelar</button>'+
    '</div></div>';
}
function flFormBaja(e){
  return '<div class="fform"><div class="ftitle">Dar de baja '+esc(e.id_maquina)+'</div><div class="fgrid">'+
    '<div class="f"><label>Primer día que YA NO estuvo</label><input type="date" value="'+esc(FL.vals.fecha_retiro||'')+'" data-on-input="flSet(\'fecha_retiro\',this.value)"></div>'+
    '</div>'+
    '<div class="fhint">Ojo, es el error fácil: la fecha de retiro es el <b>primer día que la máquina YA NO estuvo</b>, '+
      'no el último que trabajó. Si trabajó hasta el viernes, el retiro es el <b>sábado</b>. Los reportes anteriores no se tocan.</div>'+
    '<div class="actions">'+
      '<button class="btn-action primary" data-on-click="flGuardar()"'+(FL.guardando?' disabled':'')+'>💾 DAR DE BAJA</button>'+
      '<button class="btn-action" data-on-click="flCerrar()">Cancelar</button>'+
    '</div></div>';
}

/* ---- escritura ---- */
function flPayload(confirmado){
  const p={ action:'flota_guardar', op:(FL.op==='baja'?'baja':FL.op), fecha:FLOTA.fecha,
            usuario:localStorage.getItem('usuario')||'' };
  if(FL.clave) p.clave={ id_maquina:FL.clave.id_maquina, fecha_ingreso:FL.clave.fecha_ingreso };
  Object.keys(FL.vals).forEach(function(k){ p[k]=FL.vals[k]; });
  if(confirmado) p.confirmado=true;
  return p;
}
async function flGuardar(){ return flEnviar(flPayload(false)); }
async function flEnviar(payload){
  if(FL.guardando) return;
  FL.guardando=true; FL.msg=null; renderFlota();
  try{
    const resp=await fetch(APPS_SCRIPT_URL,{ method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
                                             body:JSON.stringify(payload) });
    const d=await resp.json();
    FL.guardando=false;
    // EL GUARD DE TYPOS: el servidor no escribió nada y pregunta. Es la razón de ser de esta pestaña.
    if(d && d.confirmar){
      const seguir=confirm(d.error+'\n\nAceptar = es una máquina nueva de verdad, guardar así.\nCancelar = volver a revisar el código.');
      if(seguir) return flEnviar(Object.assign({}, payload, {confirmado:true}));
      FL.msg={ tipo:'err', txt:'No se guardó nada. Revisa el código de la máquina'+(d.sugerencia?(': ¿querías decir «'+d.sugerencia+'»?'):'.') };
      renderFlota(); return;
    }
    if(d && d.ok){
      const m=d.mensaje||'Flota actualizada.';
      const esAlta=(payload.op==='alta'), altaCod=d.id_maquina||payload.id_maquina, altaFrente=payload.frente||'', altaGrupo=payload.grupo||'tierras';
      FL.op=''; FL.clave=null; FL.vals={};
      aplicarFlota(d);                       // la respuesta ya trae la hoja releída
      FL.msg={ tipo:'ok', txt:'✓ '+m };
      renderFlota();
      // Tras un alta/reingreso: «¿incluir en el parte diario?» → se muestra el QR de una vez para imprimirlo.
      if(esAlta && altaCod) flAbrirQR(altaCod, { frente:altaFrente, grupo:altaGrupo, enParte:(FLOTA.frentesParte||[]).indexOf(altaFrente)>=0 });
      return;
    }
    FL.msg={ tipo:'err', txt:(d&&d.error)||'Respuesta inesperada del servidor.' };
    renderFlota();
  }catch(err){
    FL.guardando=false;
    FL.msg={ tipo:'err', txt:'No se pudo guardar. Revisa el Apps Script o la conexión. Esta pantalla necesita señal (D49).' };
    renderFlota();
  }
}

/* ---- pintado ----
 * TRES BLOQUES, no una lista larga. La pregunta que esta pestaña existe para responder es «¿qué
 * máquinas tengo HOY?», así que eso va arriba, agrupado por TIPO y en tabla de una línea. Lo que ya
 * se devolvió pesa menos y va PLEGADO: se mira solo si se quiere. Las filas con problema salen
 * aparte, arriba del todo, porque son las únicas que piden acción inmediata.
 */
function flGrupos(){
  const q=String(FL.q||'').trim().toUpperCase();
  const pasa=function(e){
    if(FL.frente && FL.frente!=='todos' && flFrenteDe(e)!==FL.frente) return false;
    if(FL.grupo && FL.grupo!=='todos' && flGrupoDe(e)!==FL.grupo) return false;   // D183
    return !q || (e.id_maquina+' '+(e.tipo||'')+' '+(e.notas||'')+' '+(e.placa||'')+' '+(e.proveedor||'')).toUpperCase().indexOf(q)>=0;
  };
  const porMaq=flPorMaquina();
  const hoy={}, fuera=[], porLlegar=[], rotas=[];
  porMaq.ids.forEach(function(id){
    const ls=porMaq.map[id].filter(pasa);
    if(!ls.length) return;
    const vig=ls.filter(function(e){ return e.vigente; })[0];
    const invalidas=ls.filter(function(e){ return !e.valida; });
    invalidas.forEach(function(e){ rotas.push(e); });
    const validas=ls.filter(function(e){ return e.valida; });
    if(!validas.length) return;
    if(vig){ const t=vig.tipo||'(sin tipo)'; (hoy[t]=hoy[t]||[]).push({e:vig, ls:ls, id:id}); return; }
    const futura=validas.filter(function(e){ return e.fecha_ingreso>FLOTA.fecha; })
                        .sort(function(a,b){ return a.fecha_ingreso<b.fecha_ingreso?-1:1; })[0];
    if(futura){ porLlegar.push({e:futura, ls:ls, id:id}); return; }
    fuera.push({e:validas[0], ls:ls, id:id});   // validas[0] = la más reciente (ya vienen ordenadas)
  });
  // Fuera: las devueltas más recientemente primero — lo que salió ayer interesa más que lo de enero.
  fuera.sort(function(a,b){ return String(b.e.fecha_retiro||'').localeCompare(String(a.e.fecha_retiro||'')); });
  const tiposHoy=flOrden().filter(function(t){ return hoy[t]; })
                 .concat(Object.keys(hoy).filter(function(t){ return flOrden().indexOf(t)<0; }).sort());
  return { hoy:hoy, tiposHoy:tiposHoy, fuera:fuera, porLlegar:porLlegar, rotas:rotas,
           nHoy:Object.keys(hoy).reduce(function(n,t){ return n+hoy[t].length; },0) };
}

function renderFlota(){ renderFlotaCabecera(); renderFlotaLista(); }
function flFiltro(v){ FL.q=v; renderFlotaLista(); }
function flFrente(f){ FL.frente=f||'todos'; renderFlota(); }
function flFiltroGrupo(g){ FL.grupo=g||'todos'; renderFlota(); }   // D183

function renderFlotaCabecera(){
  const cont=document.getElementById('flotaCont'), puede=PUEDE_FLOTA;
  // El resumen se calcula SIN el filtro de búsqueda: es el estado de la obra, no de la búsqueda.
  // (El filtro de FRENTE sí aplica: «cuántas máquinas tengo hoy» se pregunta por proyecto.)
  const qGuardada=FL.q; FL.q=''; const g=flGrupos(); FL.q=qGuardada;
  const sinFicha=Object.keys(g.hoy).reduce(function(n,t){ return n+g.hoy[t].filter(function(x){ return x.e.con_ficha===false; }).length; },0);
  let html='';
  // D173: chips de frente. La flota es de toda la obra; el parte espera solo a los de su frente.
  const frs=flFrentes();
  html+='<div class="frente-chips">'+
          '<button class="fchip'+(FL.frente==='todos'?' on':'')+'" data-on-click="flFrente(\'todos\')">Toda la obra</button>'+
          frs.map(function(f){ return '<button class="fchip'+(FL.frente===f?' on':'')+'" data-on-click="flFrente('+JSON.stringify(f).replace(/"/g,'&quot;')+')">'+esc(f)+
                 ((FLOTA.frentesParte||[]).indexOf(f)>=0?' <span class="fparte" title="El Parte Digital espera a estos equipos cada día">· parte</span>':'')+'</button>'; }).join('')+
        '</div>';
  // D183: chips de GRUPO (disciplina). Ortogonal al frente; filtra la lista y la etiqueta por fila.
  const grs=flListaGrupos();
  html+='<div class="frente-chips grupo-chips">'+
          '<button class="fchip'+(FL.grupo==='todos'?' on':'')+'" data-on-click="flFiltroGrupo(\'todos\')">Todos los grupos</button>'+
          grs.map(function(g){ return '<button class="fchip'+(FL.grupo===g?' on':'')+'" data-on-click="flFiltroGrupo('+JSON.stringify(g).replace(/"/g,'&quot;')+')">'+esc(flGrupoLabel(g))+'</button>'; }).join('')+
        '</div>';

  if(FL.msg) html+='<div class="msg-box '+FL.msg.tipo+'" data-estilo="display:block;margin:0 0 16px">'+esc(FL.msg.txt)+'</div>';

  // 1) Lo primero: cuántas máquinas hay hoy y de qué tipo.
  html+='<div class="flota-kpis">'+
          '<div class="fk"><div class="k-val">'+g.nHoy+'</div><div class="k-lbl">en obra hoy</div></div>'+
          '<div class="fk gris"><div class="k-val">'+g.fuera.length+'</div><div class="k-lbl">fuera</div></div>'+
          (sinFicha?'<div class="fk alerta"><div class="k-val">'+sinFicha+'</div><div class="k-lbl">sin ficha (QR)</div></div>':'')+
          '<div class="fk-tipos">'+
            (g.tiposHoy.length
              ? g.tiposHoy.map(function(t){ return '<span class="tchip"><b>'+g.hoy[t].length+'</b>'+esc(flTipoCorto(t))+'</span>'; }).join('')
              : '<span class="tchip">sin máquinas en obra hoy</span>')+
          '</div>'+
        '</div>';
  html+='<div class="est-note" data-estilo="margin:-8px 0 16px;font-size:11.5px;color:var(--muted)">Flota vigente el <b>'+esc(FLOTA.fecha)+'</b>'+
        (g.porLlegar.length?(' · '+g.porLlegar.length+' por llegar'):'')+
        ' · una fila por <b>estancia</b>, ventana semiabierta: la fecha de retiro es el <b>primer día que ya no estuvo</b>. '+
        'Toda la maquinaria (pesada, volquetas, camabajas, carrotanques, luminarias): el <b>Parte Digital</b> espera cada día a los equipos vigentes del frente <b>'+esc((FLOTA.frentesParte||[]).join(' · '))+'</b>.</div>';

  if(FLOTA.fuente==='vacia'){
    html+='<div class="avisos"><b>La hoja MAQUINAS está vacía o no tiene ninguna fila utilizable.</b> '+
      'Mientras tanto las capturas se sirven del catálogo de respaldo del servidor — nunca se ofrece una flota vacía. '+
      'Da de alta las máquinas aquí para que la hoja mande.</div>';
  }
  if(FLOTA.avisos.length){
    html+='<div class="avisos"><b>⚠ Revisar en la hoja ('+FLOTA.avisos.length+')</b><ul>'+
      FLOTA.avisos.map(function(a){ return '<li>'+esc(a)+'</li>'; }).join('')+'</ul></div>';
  }

  // 2) Barra: alta + buscador. El formulario de alta reemplaza al botón mientras está abierto.
  if(puede && FL.op==='alta' && !FL.clave){
    html+='<div class="fform suelto">'+flFormDatos('Alta de máquina o reingreso')+'</div>';
  }
  html+='<div class="flota-barra">'+
        (puede && !(FL.op==='alta' && !FL.clave)
          ? '<button class="btn-action primary" data-estilo="flex:0 0 auto;min-width:210px;padding:11px 18px" data-on-click="flAbrir(\'alta\')">➕ DAR DE ALTA UNA MÁQUINA</button>'
          : '')+
        '<div class="buscador"><input type="text" id="flQ" placeholder="🔍 Buscar código, tipo o nota…" value="'+esc(FL.q||'')+'" data-on-input="flFiltro(this.value)"></div>'+
        (puede?'':'<span class="est-note" data-estilo="color:var(--muted);font-size:11.5px">Vista de solo lectura: las altas y las bajas las hacen el residente, el administrador o jeisson.</span>')+
        '</div>';
  cont.innerHTML=html;
}
// Etiqueta corta para los chips del resumen (la lista de tipos completa vive en la tabla).
function flTipoCorto(t){
  const m={ BULLDOZER:'bulldozer', EXCAVADORA:'excavadora', MOTONIVELADORA:'motoniveladora', FINISHER:'finisher',
            VIBROCOMPACTADOR:'vibro', MINICARGADOR:'minicargador', MINIBULDOZER:'minibuldózer', RETROEXCAVADORA:'retro',
            VOLQUETA:'volqueta', CAMABAJA:'camabaja', TRACTOCAMION:'tractocamión', CARROTANQUE:'carrotanque',
            CAMION:'camión', TURBO:'turbo', CISTERNA:'cisterna', LUMINARIA:'luminaria' };
  const l=m[t]||String(t||'').toLowerCase();
  return l;
}

function renderFlotaLista(){
  const cont=document.getElementById('flotaLista'), puede=PUEDE_FLOTA;
  const g=flGrupos();
  let html='';

  if(!FLOTA.estancias.length){
    cont.innerHTML='<div class="empty-state"><div class="icon">🚜</div><p>La hoja MAQUINAS no tiene ninguna máquina todavía.</p></div>';
    return;
  }

  // (a) Filas con problema — arriba porque son las únicas que exigen acción.
  if(g.rotas.length){
    html+='<div class="grupo"><div class="grupo-tit">⚠ Filas con problema <span class="n">'+g.rotas.length+'</span></div>'+
          '<div class="tabla">'+
          '<div class="tr th"><span>Código</span><span>Tipo</span><span>Prog</span><span>Ventana</span><span>Notas</span><span></span></div>'+
          g.rotas.map(function(e){ return flFila(e, puede, 'rota'); }).join('')+
          '</div></div>';
  }

  // (b) LO DE HOY: UNA sola tabla, con una fila separadora por tipo. Una tabla por tipo repetía la
  // cabecera seis veces y estiraba la pantalla; así se lee de un vistazo, que es lo que se pedía.
  html+='<div class="grupo-tit" data-estilo="margin-bottom:12px">🚜 En obra hoy <span class="n">'+g.nHoy+' máquina'+(g.nHoy===1?'':'s')+'</span></div>';
  if(!g.tiposHoy.length){
    html+='<div class="empty-state" data-estilo="padding:24px"><p>'+(FL.q?'Ninguna máquina en obra coincide con la búsqueda.':'Hoy no hay ninguna máquina en obra.')+'</p></div>';
  }else{
    html+='<div class="grupo"><div class="tabla">'+
          '<div class="tr th"><span>Código</span><span>Propiedad</span><span>Prog</span><span>En obra desde</span><span>Notas</span><span></span></div>'+
          g.tiposHoy.map(function(t){
            const filas=g.hoy[t];
            // La regla de producción es por TIPO (D41/D44/D111), así que se dice una vez en el
            // separador y no como un chip repetido en cada fila.
            const esProd=flEsProd(t), sinProd=esProd && filas.length && !filas[0].e.produce;
            return '<div class="tr sep">'+esc(t)+' <span class="n">'+filas.length+'</span>'+
                     (sinProd?'<span class="nota-tipo">sin producción propia · apoyan frentes de otras máquinas</span>':'')+
                     (!esProd?'<span class="nota-tipo">transporte / equipo menor · solo flota y parte digital</span>':'')+
                   '</div>'+
                   filas.map(function(x){ return flFila(x.e, puede, 'hoy', x.ls); }).join('');
          }).join('')+
          '</div></div>';
  }

  // (c) Por llegar (ingreso futuro): solo si hay.
  if(g.porLlegar.length){
    html+='<div class="grupo"><div class="grupo-tit">🕓 Por llegar <span class="n">'+g.porLlegar.length+'</span></div>'+
          '<div class="tabla">'+
          '<div class="tr th"><span>Código</span><span>Tipo</span><span>Prog</span><span>Llega el</span><span>Notas</span><span></span></div>'+
          g.porLlegar.map(function(x){ return flFila(x.e, puede, 'llega', x.ls); }).join('')+
          '</div></div>';
  }

  // (d) Lo que YA NO está: plegado. Se mira solo si se quiere.
  if(g.fuera.length){
    html+='<div class="plegable">'+
          '<button class="cab" data-on-click="flTogglePleg(\'fuera\')">'+(FL.pleg.fuera?'▾':'▸')+' Ya no están en la obra'+
            '<span class="n">'+g.fuera.length+' máquina'+(g.fuera.length===1?'':'s')+' · su histórico en MAQUINARIA se conserva</span></button>'+
          (FL.pleg.fuera
            ? '<div class="tabla">'+
              '<div class="tr th fuera-fila"><span>Código</span><span>Tipo</span><span>Prog</span><span>Estuvo</span><span>Notas</span><span></span></div>'+
              g.fuera.map(function(x){ return flFila(x.e, puede, 'fuera', x.ls); }).join('')+
              '</div>'
            : '')+
          '</div>';
  }
  cont.innerHTML=html;
}
function flTogglePleg(k){ FL.pleg[k]=!FL.pleg[k]; renderFlotaLista(); }

/* ============ QR del parte digital, dentro de la app (sep-2026) ============
 * El QR de cada equipo es solo la URL de SU formulario público (parte.html?eq=CODIGO) codificada en imagen;
 * el teléfono la abre con la cámara (misma URL que genera tools/generar_qr.py). Aquí se puede ver, copiar,
 * abrir y descargar el QR de la máquina que sea, cuando sea, sin depender del script del PC. La imagen la
 * dibuja una librería local (vendor/qrcode.js, MIT); si no cargó (sin señal) se cae al enlace copiable. */
const PARTE_URL_BASE='https://tm2.galca.app';   // dominio de producción (igual que URL_BASE de generar_qr.py)
function parteLinkDe(cod){ return PARTE_URL_BASE+'/parte.html?eq='+encodeURIComponent(String(cod||'').trim()); }
// Datos de la máquina para el panel (la estancia vigente, si no la más reciente).
function flInfoMaquina(cod){
  const ls=(FLOTA.estancias||[]).filter(function(e){ return e.id_maquina===cod; });
  return ls.filter(function(e){ return e.vigente; })[0] || ls.filter(function(e){ return e.valida; })[0] || ls[0] || null;
}
// modoAlta: null (botón QR normal) | {frente, grupo, enParte} (tras un alta/reingreso: confirma la inclusión en el parte).
function flAbrirQR(codigo, modoAlta){
  const cod=String(codigo||'').trim(); if(!cod) return;
  const info=flInfoMaquina(cod), url=parteLinkDe(cod);
  const enParte = modoAlta ? modoAlta.enParte : ((FLOTA.frentesParte||[]).indexOf(info?flFrenteDe(info):'')>=0);
  const grupo = (modoAlta && modoAlta.grupo) || (info?flGrupoDe(info):'tierras');   // D183
  const sinFicha = info && info.con_ficha===false;
  let html='';
  if(modoAlta){
    html+='<div class="qr-ok">✓ <b>'+esc(cod)+'</b> quedó en la flota'+(modoAlta.frente?(' · frente '+esc(modoAlta.frente)):'')+' · grupo <b>'+esc(flGrupoLabel(grupo))+'</b>.</div>';
    html+= enParte
      ? '<div class="qr-inc">Desde hoy el <b>Parte Digital la espera cada día</b> en el grupo <b>'+esc(flGrupoLabel(grupo))+'</b>: ya puede reportar por su QR. Imprímelo y pégalo en la cabina.</div>'
      : '<div class="qr-inc warn">El frente <b>'+esc(modoAlta.frente||'')+'</b> no entra al parte diario (UF1-UF2). La máquina queda en la flota; su QR abre igual, pero no se le pedirá parte a diario.</div>';
  }
  html+='<div class="qr-tit">▦ QR del parte · <b>'+esc(cod)+'</b>'+(info&&info.tipo?' <span class="qr-tipo">'+esc(info.tipo)+'</span>':'')+'</div>';
  html+='<div class="qr-lienzo" id="qrLienzo"></div>';
  if(sinFicha) html+='<div class="qr-inc warn">⚠ Esta máquina <b>no tiene ficha</b> en el catálogo del parte (placa/medidor): el QR abrirá con error hasta que corrijas la estancia y guardes placa y medidor.</div>';
  html+='<div class="qr-link"><input type="text" id="qrUrl" value="'+esc(url)+'" readonly aria-label="enlace del parte"></div>';
  html+='<div class="qr-acts">'+
          '<button class="btn-action" data-on-click="flCopiarEnlace()">📋 Copiar enlace</button>'+
          '<a class="btn-action" href="'+esc(url)+'" target="_blank" rel="noopener">Abrir parte ↗</a>'+
          '<button class="btn-action primary" id="qrDl" data-on-click="flDescargarQR(\''+esc(cod)+'\')">⬇ Descargar PNG</button>'+
        '</div>';
  html+='<div class="qr-pie">La imagen apunta a <b>'+esc(PARTE_URL_BASE)+'</b> (producción). Para las etiquetas en vinilo se sigue usando la herramienta de QR del PC (<code>tools/generar_qr.py</code>).</div>';
  document.getElementById('qrCuerpo').innerHTML=html;
  document.getElementById('qrModal').classList.remove('hidden');
  // Dibuja el QR (o cae al enlace si la librería no cargó).
  const lienzo=document.getElementById('qrLienzo');
  if(typeof QRCode!=='undefined' && lienzo){
    try{ new QRCode(lienzo, { text:url, width:232, height:232, correctLevel:QRCode.CorrectLevel.H }); }
    catch(err){ lienzo.innerHTML='<div class="qr-fail">No se pudo generar la imagen del QR. Usa el enlace de abajo o la herramienta del PC.</div>'; }
  }else if(lienzo){
    lienzo.innerHTML='<div class="qr-fail">No cargó el generador de QR (¿sin señal?). Copia el enlace de abajo o genera la etiqueta con la herramienta del PC.</div>';
    const dl=document.getElementById('qrDl'); if(dl) dl.disabled=true;
  }
}
function flCerrarQR(){ document.getElementById('qrModal').classList.add('hidden'); document.getElementById('qrCuerpo').innerHTML=''; }
function flQRFondo(e, el){ if(e.target===el) flCerrarQR(); }
function flCopiarEnlace(){
  const inp=document.getElementById('qrUrl'); if(!inp) return;
  const txt=inp.value;
  const ok=function(){ const b=document.querySelector('#qrCuerpo .qr-acts button'); if(b){ const t=b.textContent; b.textContent='✓ Copiado'; setTimeout(function(){ b.textContent=t; }, 1500); } };
  if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(ok, function(){ inp.select(); document.execCommand&&document.execCommand('copy'); ok(); }); }
  else { inp.select(); try{ document.execCommand('copy'); }catch(e){} ok(); }
}
function flDescargarQR(cod){
  const cnv=document.querySelector('#qrLienzo canvas');
  const img=document.querySelector('#qrLienzo img');   // Android viejo: la librería usa <img> con data URL
  let href='';
  try{ href = cnv ? cnv.toDataURL('image/png') : (img && img.src ? img.src : ''); }catch(err){ href = (img&&img.src)||''; }
  if(!href){ alert('La imagen del QR no está disponible (sin señal). Usa el enlace o la herramienta del PC.'); return; }
  try{
    const a=document.createElement('a');
    a.href=href; a.download='QR_'+String(cod||'equipo').replace(/[^A-Za-z0-9_-]/g,'')+'.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }catch(err){ alert('No se pudo descargar la imagen.'); }
}

/* Una fila de máquina. `modo` decide qué columnas y qué botones:
 *   hoy   — propiedad · prog · desde        → Dar de baja / Corregir
 *   llega — tipo · prog · llega el          → Corregir
 *   fuera — tipo · prog · ventana completa  → Reingreso / Corregir
 *   rota  — sin fecha válida                → Corregir
 * `ls` son TODAS las estancias de esa máquina: si hay más de una, la fila ofrece el historial. */
function flFila(e, puede, modo, ls){
  const id=e.id_maquina, arg="'"+esc(id)+"','"+esc(e.fecha_ingreso)+"'";
  const nEst=(ls||[]).filter(function(x){ return x.valida; }).length;
  const acts=[];
  if(puede){
    if(modo==='hoy')   acts.push('<button class="btn-mini danger" data-on-click="flAbrir(\'baja\','+arg+')">Dar de baja</button>');
    if(modo==='fuera') acts.push('<button class="btn-mini" data-on-click="flAbrir(\'reingreso\','+arg+')">↩ Reingreso</button>');
    acts.push('<button class="btn-mini" data-on-click="flAbrir(\'corregir\','+arg+')">Corregir</button>');
  }
  // QR del parte digital: disponible para cualquiera que llegue a la flota (también solo lectura). Se puede
  // generar/imprimir el QR de la máquina que sea, cuando sea (pedido del dueño, sep-2026).
  if(modo!=='rota') acts.push('<button class="btn-mini qr" data-on-click="flAbrirQR(\''+esc(id)+'\')">▦ QR</button>');
  if(nEst>1) acts.push('<button class="btn-mini'+(FL.hist[id]?' on':'')+'" data-on-click="flToggleHist(\''+esc(id)+'\')" '+
                       'title="Estancias anteriores de esta máquina">'+(FL.hist[id]?'▾':'▸')+' '+nEst+' estancias</button>');

  const col2 = modo==='hoy' ? esc(e.propiedad||'—') : esc(e.tipo||'sin tipo');
  const col4 = modo==='hoy'   ? esc(e.fecha_ingreso)
             : modo==='llega' ? esc(e.fecha_ingreso)
             : modo==='rota'  ? 'sin fecha de ingreso'
             : esc(e.fecha_ingreso)+' → '+esc(e.fecha_retiro||'sigue en obra');
  const marca = '';   // la regla de producción nula es por TIPO: se dice en el separador, no por fila
  // D173: ficha (placa · medidor) bajo el código; frente cuando se mira toda la obra; aviso sin ficha.
  const ficha=[e.placa, (e.medidor==='KM'?'km':(e.medidor?'horóm.':''))].filter(Boolean).join(' · ');
  const fr=flFrenteDe(e), grp=flGrupoDe(e);
  const sub='<small class="csub">'+
              (e.con_ficha===false ? '<span class="sinficha" title="Sin ficha en PARTE_EQUIPOS: el QR no abre el parte. Corrige la estancia y guarda placa/medidor.">⚠ sin ficha</span>' : esc(ficha||(e.proveedor||'')))+
              ((FL.frente==='todos' && fr!==(FLOTA.frenteDef||'UF1-UF2')) ? ' <span class="frchip">'+esc(fr)+'</span>' : '')+
              (grp==='drenajes' ? ' <span class="grchip">Drenajes</span>' : '')+
            '</small>';
  const prog = flEsProd(e.tipo) ? esc(e.prog)+' h' : '—';
  let html='<div class="tr'+(modo==='fuera'?' fuera-fila':'')+'">'+
             '<span class="cid">'+esc(id)+sub+'</span>'+
             '<span class="cmut">'+col2+marca+'</span>'+
             '<span class="cmut">'+prog+'</span>'+
             '<span class="cfecha'+(modo==='rota'?' cmut':'')+'">'+col4+'</span>'+
             '<span class="cnota" title="'+esc(e.notas||'')+'">'+esc(e.notas||'')+'</span>'+
             '<span class="cacts">'+acts.join('')+'</span>'+
           '</div>';
  // Historial de la máquina (todas sus estancias, incluida la que ya se ve arriba).
  if(nEst>1 && FL.hist[id]){
    html+=(ls||[]).filter(function(x){ return x.valida; }).map(function(x){
      const esta=(x.fecha_ingreso===e.fecha_ingreso);
      return '<div class="tr sub">'+
               '<span class="cid">'+(esta?'· actual':'· anterior')+'</span>'+
               '<span class="cmut">'+esc(x.propiedad||'—')+'</span>'+
               '<span class="cmut">'+esc(x.prog)+' h</span>'+
               '<span class="cfecha">'+esc(x.fecha_ingreso)+' → '+esc(x.fecha_retiro||'sigue en obra')+'</span>'+
               '<span class="cnota" title="'+esc(x.notas||'')+'">'+esc(x.notas||'')+' <span class="cmut">fila '+esc(x.fila)+'</span></span>'+
               '<span class="cacts">'+(puede&&!esta?'<button class="btn-mini" data-on-click="flAbrir(\'corregir\',\''+esc(id)+'\',\''+esc(x.fecha_ingreso)+'\')">Corregir</button>':'')+'</span>'+
             '</div>';
    }).join('');
  }
  // Formulario abierto sobre ESTA estancia.
  if(FL.clave && FL.clave.id_maquina===id && FL.clave.fecha_ingreso===e.fecha_ingreso){
    const obj=flEstancia(id, e.fecha_ingreso);
    if(obj) html+='<div class="tr form">'+((FL.op==='baja')?flFormBaja(obj):flFormDatos('Corregir la estancia de '+esc(id)+' · '+esc(flVentana(obj))))+'</div>';
  }else if(FL.clave && FL.clave.id_maquina===id && FL.op==='corregir' && nEst>1 && FL.hist[id]){
    // corrección abierta sobre una estancia del historial de esta máquina
    const obj=flEstancia(FL.clave.id_maquina, FL.clave.fecha_ingreso);
    if(obj) html+='<div class="tr form">'+flFormDatos('Corregir la estancia de '+esc(id)+' · '+esc(flVentana(obj)))+'</div>';
  }
  return html;
}
