// D170: aplica los data-estilo del marcado ANTES de que corra la lógica de la pantalla (ver tema.js).
if(window.TM2Estilos) TM2Estilos.aplicar();
const APPS_SCRIPT_URL = GALCA_ENV.url.obra;          // entorno.js (D168): producción o prueba
const API = APPS_SCRIPT_URL + '?mod=parte';
const ROLES = ['admin','encargado','residente','parte_maquinaria'];
// D178: `jeisson` entra por USUARIO (mismo patrón que la Flota, D139): es quien pone el CC a los partes.
const USUARIOS_OK = ['jeisson'];
// A dónde vuelve «← Menú» según quién entró (el admin a su menú; el residente a su panel; jeisson a sus tiles).
const VOLVER = { admin:'menu.html', residente:'residente.html' };

/* ---------- sesión (D82/D109) ---------- */
const rol=localStorage.getItem('rol')||'', usuario=(localStorage.getItem('usuario')||'').trim().toLowerCase();
if(!rol || (ROLES.indexOf(rol)<0 && USUARIOS_OK.indexOf(usuario)<0) || !(window.TM2Auth && TM2Auth.get())){ location.href='index.html'; }
document.getElementById('userDisplay').textContent=usuario+' · '+rol;
const VOLVER_A = VOLVER[rol] || (USUARIOS_OK.indexOf(usuario)>=0 ? 'seleccion-reporte.html' : '');
if(VOLVER_A){ const bm=document.getElementById('btnMenu'); bm.style.display='inline-block'; bm.setAttribute('data-on-click', "irA('"+VOLVER_A+"')"); }
function logout(){ localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token'); location.href='index.html'; }
function caducada(d){ if(window.TM2Auth && TM2Auth.caducada(d)){ alert('La sesión ya no vale. Vuelve a entrar.'); logout(); return true; } return false; }

/* ---------- utilidades ---------- */
function hoy(){ return new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'}); }
function num(v){ if(v===''||v===null||v===undefined) return null; const n=Number(String(v).replace(',','.')); return isFinite(n)?n:null; }
function fmt(n){ return n===null||n===''||n===undefined ? '' : (Math.round(n*100)/100).toLocaleString('es-CO',{maximumFractionDigits:2}); }
function ufDe(cc){ const s=String(cc||''); return s.indexOf('3701')===0?'1':s.indexOf('3702')===0?'2':s.indexOf('3703')===0?'3':''; }
function norm(s){ return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().trim(); }
function uuid(){ if(window.crypto && crypto.randomUUID) return crypto.randomUUID(); return 'm-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10); }
function fechaExcel(iso){ const p=String(iso||'').slice(0,10).split('-'); if(p.length<3) return String(iso||''); return p[2]+'/'+p[1]+'/'+p[0]; }
let toastT=null; function toast(msg, err){ let t=document.querySelector('.toast'); if(!t){ t=document.createElement('div'); t.className='toast'; document.body.appendChild(t); } t.textContent=msg; t.classList.toggle('err',!!err); t.style.display='block'; clearTimeout(toastT); toastT=setTimeout(()=>t.style.display='none', err?6000:2500); }
async function api(url, body){
  const r = body ? await fetch(APPS_SCRIPT_URL, { method:'POST', headers:{'Content-Type':'text/plain'}, body:JSON.stringify(body) }) : await fetch(url, {cache:'no-store'});
  return r.json();
}

/* ---------- estado ---------- */
let TOPES={HOROMETRO:{bloquea:24,alerta:12,unidad:'h'},KM:{bloquea:700,alerta:400,unidad:'km'}};
let LISTAS={operadores:[],cc:[],equipos:[]};
let BAND={pendientes:[],revisadas:[],faltantes:[]};
let dirty={};          // id_registro → {campo:valor}
let BASE=null;         // respuesta de op=base
let editando=null;     // id en edición en la tabla Base

function verTab(t){
  document.getElementById('tabPend').classList.toggle('on', t==='pend'); document.getElementById('tabBase').classList.toggle('on', t==='base');
  document.getElementById('vistaPend').classList.toggle('hidden', t!=='pend'); document.getElementById('vistaBase').classList.toggle('hidden', t!=='base');
  if(t==='base' && !BASE) cargarBase();
}

/* ================= PENDIENTES ================= */
function moverDia(d){ const f=document.getElementById('fecha'); const dt=new Date(f.value+'T12:00:00'); dt.setDate(dt.getDate()+d); f.value=dt.toISOString().slice(0,10); cargarBandeja(); }
async function cargarBandeja(){
  const fecha=document.getElementById('fecha').value; if(!fecha) return;
  document.getElementById('pendientes').innerHTML='<div class="vacio">Cargando…</div>';
  let d; try{ d=await api(API+'&op=bandeja&fecha='+fecha); }catch(e){ d={ok:false,error:'Sin conexión con el servidor.'}; }
  if(caducada(d)) return;
  if(!d.ok){ document.getElementById('pendientes').innerHTML='<div class="vacio">'+esc(d.error||'error')+'</div>'; return; }
  BAND=d; dirty={}; if(d.topes) TOPES=d.topes; if(d.listas) LISTAS=d.listas;
  pintarBandeja();
}
function alertasDe(r){ return String(r.alertas||'').split(';').map(s=>s.trim()).filter(Boolean); }
const ALERTA_TXT={ INICIAL_DISTINTO:'El inicial no coincide con el último final registrado', TOTAL_ALTO:'Total alto (>12 h / >400 km)', DUPLICADO:'Ya había una fila del equipo con la misma fecha y hora de inicio', CC_INUSUAL:'CC que el equipo no usó en los últimos 30 días', SIN_MEDIDOR:'Equipo sin medidor definido en el catálogo', CC_DESCONOCIDO:'CC que no está en PARTE_CC', SIN_CC:'Texto libre sin centro de coste: léelo, elige el CC (se puede editar aquí) y aprueba; sin CC no se deja aprobar', FUERA_DE_FLOTA:'Reportó sin estar vigente ese día en la flota (Maquinaria › Flota): reemplazo de un día, equipo devuelto o de otro frente. Si se queda, dale el alta', PARTE_REPETIDO:'El mismo nº de parte físico ya se subió en OTRO día: posible doble carga del mismo turno (típico del turno noche que cruza medianoche). Revisa antes de aprobar para no facturarlo dos veces' };
function pintarBandeja(){
  const p=BAND.pendientes||[], rv=BAND.revisadas||[], falt=BAND.faltantes||[];
  const conAl=p.filter(r=>alertasDe(r).length).length;
  pintarFueraDeFlota(p.concat(rv));
  document.getElementById('nPend').textContent=p.length; document.getElementById('kPend').textContent=p.length;
  document.getElementById('kAlert').textContent=conAl; document.getElementById('kAprob').textContent=rv.filter(r=>r.estado==='aprobado').length;
  document.getElementById('kFalt').textContent=falt.length; document.getElementById('cntFalt').textContent=falt.length;
  document.getElementById('btnAprobarTodo').disabled = !(p.length-conAl);
  document.getElementById('btnAprobarTodo').textContent='✓ Aprobar todo lo sin alertas ('+(p.length-conAl)+')';
  document.getElementById('pendientes').innerHTML = p.length ? p.map(r=>filaHTML(r)).join('') : '<div class="vacio">Sin partes pendientes en esta fecha.</div>';
  const rb=document.getElementById('revisadasBox'); rb.style.display= rv.length ? 'block' : 'none';
  document.getElementById('nRev').textContent=rv.length;
  document.getElementById('revisadas').innerHTML=rv.map(r=>filaHTML(r,true)).join('');
  // selección para «Día sin operación»: por defecto todos; se conserva lo desmarcado entre repintados
  const vivos={}; falt.forEach(q=>{ vivos[q.codigo]=1; if(!selFalt.hasOwnProperty(q.codigo)) selFalt[q.codigo]=true; });
  Object.keys(selFalt).forEach(c=>{ if(!vivos[c]) delete selFalt[c]; });
  document.getElementById('faltantes').innerHTML = falt.length ? falt.map(q=>'<div class="falt'+(selFalt[q.codigo]?' sel':'')+'"><input type="checkbox" aria-label="incluir '+esc(q.codigo)+'"'+(selFalt[q.codigo]?' checked':'')+' data-on-change="toggleFalt('+esc(JSON.stringify(q.codigo))+',this.checked)"><span class="cod">'+esc(q.codigo)+'</span><span class="tipo">'+esc(q.tipo)+(q.placa?' · '+esc(q.placa):'')+(q.ultimo?' · últ. '+fmt(q.ultimo.final):'')+(q.sin_ficha?' · <b title="Vigente en la flota pero sin ficha en PARTE_EQUIPOS: el QR no le abre el parte. Corrige la estancia en Maquinaria › Flota y guarda placa y medidor.">⚠ sin ficha</b>':'')+'</span><button class="btn mini" data-on-click="abrirManual('+esc(JSON.stringify(q.codigo))+')">+ manual</button></div>').join('') : '<div class="vacio">Todos los equipos activos tienen parte.</div>';
  document.getElementById('sinopBar').classList.toggle('hidden', !falt.length);
  pintarSel();
}
// Apartado consolidado (pedido del dueño, sep-2026): equipos que REPORTARON hoy sin estar vigentes en la
// flota (alerta FUERA_DE_FLOTA). Son el otro lado de «Equipos sin parte»: reportaron pero no se les esperaba
// —reemplazo de un varado, equipo devuelto que volvió a trabajar, o máquina que nunca se dio de alta—. Si se
// quedan, van al alta en Maquinaria › Flota; si fue un día suelto, se revisa y aprueba y ya. Solo agrupa lo
// que ya viene en los partes del día; no consulta nada nuevo.
function pintarFueraDeFlota(filas){
  const cont=document.getElementById('fueraFlota'); if(!cont) return;
  const porCod={};
  (filas||[]).forEach(r=>{ if(alertasDe(r).indexOf('FUERA_DE_FLOTA')>=0){ const c=r.codigo||'?'; (porCod[c]=porCod[c]||{tipo:r.tipo||'',n:0}).n++; } });
  const cods=Object.keys(porCod);
  if(!cods.length){ cont.innerHTML=''; return; }
  const chips=cods.sort().map(c=>'<b>'+esc(c)+'</b>'+(porCod[c].tipo?' ('+esc(porCod[c].tipo)+')':'')).join(' · ');
  cont.innerHTML='<div class="aviso-fuera card">'
    +'<div class="section-title">⚠ Reportaron sin estar en la flota <span class="count">'+cods.length+'</span></div>'
    +'<div class="intro">Estos equipos enviaron parte hoy pero <b>no figuran vigentes en la flota</b> (Maquinaria › Flota). '
    +'Si se quedan en la obra, <b>dales de alta</b> allí (así el sistema los espera y se les imprime el QR); '
    +'si fue un día suelto (reemplazo de un varado, préstamo), revisa su parte y apruébalo sin más. '
    +'Sus filas van marcadas abajo con <b>FUERA_DE_FLOTA</b>.</div>'
    +'<div class="chips-fuera">'+chips+'</div>'
    +'<button class="btn mini" data-on-click="irA(\'produccion-maquinaria.html#flota\')">Abrir Maquinaria › Flota →</button>'
    +'</div>';
}
let selFalt={};   // codigo → true/false (incluido en «Día sin operación»)
function faltSeleccionados(){ return (BAND.faltantes||[]).filter(q=>selFalt[q.codigo]); }
function pintarSel(){
  const n=faltSeleccionados().length, tot=(BAND.faltantes||[]).length;
  document.getElementById('nSel').textContent=n;
  const t=document.getElementById('selTodos'); t.checked=(n===tot && tot>0); t.indeterminate=(n>0 && n<tot);
  document.querySelectorAll('#sinopBar .motivos .btn').forEach(b=>b.disabled=!n);
}
function toggleFalt(codigo, on){ selFalt[codigo]=!!on; const el=[...document.querySelectorAll('#faltantes .falt')].find(f=>f.querySelector('.cod').textContent===codigo); if(el) el.classList.toggle('sel',!!on); pintarSel(); }
function selFaltantes(on){ (BAND.faltantes||[]).forEach(q=>selFalt[q.codigo]=!!on); document.querySelectorAll('#faltantes .falt').forEach(f=>{ f.querySelector('input[type=checkbox]').checked=!!on; f.classList.toggle('sel',!!on); }); pintarSel(); }
function irAFaltantes(){ verTab('pend'); const c=document.getElementById('cardFalt'); if(c) c.scrollIntoView({behavior:'smooth',block:'start'}); }
function opSelect(v, lista, extra){
  const vistos={}; let html='';
  (extra||[]).concat(lista).forEach(o=>{ if(vistos[o]) return; vistos[o]=1; html+='<option value="'+esc(o)+'"'+(o===v?' selected':'')+'>'+esc(o)+'</option>'; });
  if(v && !vistos[v]) html='<option value="'+esc(v)+'" selected>'+esc(v)+' (no está en la lista)</option>'+html;
  return html;
}
function ccSelect(v){
  const reales=(LISTAS.cc||[]).filter(c=>!c.pseudo), pseudo=(LISTAS.cc||[]).filter(c=>c.pseudo);
  const op=c=>'<option value="'+esc(c.centro_coste)+'"'+(c.centro_coste===v?' selected':'')+'>'+esc(c.centro_coste)+(c.descripcion_cc?' · '+esc(c.descripcion_cc):'')+'</option>';
  let html='<option value="">—</option>';
  if(v && !(LISTAS.cc||[]).some(c=>c.centro_coste===v)) html+='<option value="'+esc(v)+'" selected>'+esc(v)+' (no está en PARTE_CC)</option>';
  html+='<optgroup label="Centros de coste">'+reales.map(op).join('')+'</optgroup><optgroup label="Sin operación">'+pseudo.map(op).join('')+'</optgroup>';
  return html;
}
function filaHTML(r, soloLectura){
  const al=alertasDe(r), id=r.id_registro, d=dirty[id]||{}, idA=esc(id), idJs=esc(String(id).replace(/'/g,"\\'"));
  const v=k=> d.hasOwnProperty(k) ? d[k] : r[k];
  const tot = (num(v('inicial'))!==null && num(v('final'))!==null) ? Math.round((num(v('final'))-num(v('inicial')))*100)/100 : null;
  const tope=TOPES[r.medidor], unidad=tope?esc(tope.unidad):'';
  const totCls = tot===null ? '' : tot<0 || (tope && tot>tope.bloquea) ? 'mal' : (tope && tot>tope.alerta) ? 'alto' : '';
  const ro = soloLectura ? ' disabled' : '';
  const on = soloLectura ? '' : ' data-on-change="edit(\''+idJs+'\',this)"';
  const inp=(k,tipo,extra)=>'<input type="'+tipo+'" data-k="'+k+'" value="'+esc(v(k))+'"'+(extra||'')+ro+on+'>';
  return '<div class="fila'+(al.length?' con-alertas':'')+(Object.keys(d).length?' dirty':'')+(soloLectura?' done':'')+'" id="fila-'+idA+'">'
    +'<div class="fila-head"><span class="cod">'+esc(r.codigo)+'</span><span class="tipo">'+esc(r.tipo)+(r.placa?' · '+esc(r.placa):'')+' · '+esc(r.medidor||'sin medidor')+'</span>'
    +(r.origen==='manual'?'<span class="badge manual">manual</span>':'')
    +(/\[Reparto /.test(String(r.observaciones||''))?'<span class="badge manual" title="Parte de un reparto por porcentaje: el medidor y las horas vienen prorrateados">'+esc((String(r.observaciones).match(/\[Reparto [^\]]*\]/)||[''])[0].replace(/[\[\]]/g,''))+'</span>':'')
    +(r.inicial_modificado==='SI'?'<span class="badge alerta" title="El operador cambió el inicial precargado">inicial editado</span>':'')
    +(soloLectura?'<span class="badge estado-'+esc(r.estado)+'">'+esc(r.estado)+(r.revisado_por?' · '+esc(r.revisado_por):'')+'</span>':'')
    +al.map(a=>'<span class="badge alerta" title="'+esc(ALERTA_TXT[a]||a)+'">⚠ '+esc(a)+'</span>').join('')
    +'<span class="acciones">'
    +(soloLectura
      ? '<button class="btn mini" data-on-click="revisar(\''+idJs+'\',\'pendiente\')">↩ Reabrir</button>'
        +(r.estado==='aprobado'?'<button class="btn mini" data-on-click="abrirRepartir(\''+idJs+'\')" title="Abrir esta fila en varias (una por centro de coste o actividad)">⑂ Repartir</button>':'')
      : '<button class="btn mini ok" data-on-click="revisar(\''+idJs+'\',\'aprobado\')">✓ Aprobar</button><button class="btn mini mal" data-on-click="revisar(\''+idJs+'\',\'descartado\')">✕ Descartar</button>'
        +'<button class="btn mini" data-on-click="abrirRepartir(\''+idJs+'\')" title="Abrir esta fila en varias (una por centro de coste o actividad)">⑂ Repartir</button>'
        +'<button class="btn mini btn-guardar'+(Object.keys(d).length?'':' hidden')+'" data-on-click="revisar(\''+idJs+'\',\'\')">💾 Guardar</button>')
    +'</span></div>'
    +'<div class="campos">'
    +'<div class="c"><label>Fecha</label>'+inp('fecha','date')+'</div>'
    +'<div class="c"><label>Nº parte</label>'+inp('reporte_num','text')+'</div>'
    +'<div class="c w2"><label>Operador</label><select data-k="operador"'+ro+on+'>'+opSelect(v('operador'), LISTAS.operadores||[], ['Sin operador'])+'</select></div>'
    +'<div class="c"><label>Hora de</label>'+inp('hora_de','time')+'</div>'
    +'<div class="c"><label>Hora a</label>'+inp('hora_a','time')+'</div>'
    +'<div class="c"><label>Inicial</label>'+inp('inicial','number',' step="0.1"')+'</div>'
    +'<div class="c"><label>Final</label>'+inp('final','number',' step="0.1"')+'</div>'
    +'<div class="c"><label>Total</label><div class="tot '+totCls+'">'+(tot===null?'—':fmt(tot))+' <small>'+unidad+'</small></div></div>'
    +'<div class="c"><label>H. varada</label>'+inp('horas_varada','number',' step="0.5"')+'</div>'
    +'<div class="c"><label>H. lluvia</label>'+inp('horas_lluvia','number',' step="0.5"')+'</div>'
    +'<div class="c"><label>PR</label>'+inp('pr','number')+'</div>'
    +'<div class="c w3"><label>Centro de coste</label><select data-k="centro_coste"'+ro+on+'>'+ccSelect(v('centro_coste'))+'</select></div>'
    +'<div class="c"><label>UF</label><select data-k="uf"'+ro+on+'>'+['','1','2','3'].map(u=>'<option value="'+u+'"'+(String(v('uf'))===u?' selected':'')+'>'+(u||'—')+'</option>').join('')+'</select></div>'
    +'<div class="c w2"><label>Descripción</label><textarea rows="2" data-k="descripcion_trabajo"'+ro+on+'>'+esc(v('descripcion_trabajo'))+'</textarea></div>'
    +'<div class="c w3"><label>Observaciones</label><textarea rows="2" data-k="observaciones"'+ro+on+'>'+esc(v('observaciones'))+'</textarea></div>'
    +'</div>'
    +(al.length?'<div class="nota">'+al.map(a=>'<b>'+esc(a)+':</b> '+esc(ALERTA_TXT[a]||'')).join(' · ')+'</div>':'')
    +'</div>';
}
function edit(id, el){
  const k=el.dataset.k; dirty[id]=dirty[id]||{}; dirty[id][k]=el.value;
  const f=document.getElementById('fila-'+id); if(!f) return;
  // sin repintar la tarjeta (se perdería el foco y lo tecleado): solo el estado visible
  if(k==='centro_coste'){ dirty[id].uf=ufDe(el.value); const su=f.querySelector('[data-k=uf]'); if(su) su.value=dirty[id].uf; }
  if(k==='inicial'||k==='final'){
    const r=(BAND.pendientes||[]).find(x=>x.id_registro===id)||{}, d=dirty[id];
    const a=num(d.hasOwnProperty('inicial')?d.inicial:r.inicial), b=num(d.hasOwnProperty('final')?d.final:r.final);
    const tot=(a!==null&&b!==null)?Math.round((b-a)*100)/100:null, tope=TOPES[r.medidor], box=f.querySelector('.tot');
    if(box){ box.className='tot '+(tot===null?'':tot<0||(tope&&tot>tope.bloquea)?'mal':(tope&&tot>tope.alerta)?'alto':''); box.innerHTML=(tot===null?'—':fmt(tot))+' <small>'+(tope?esc(tope.unidad):'')+'</small>'; }
  }
  f.classList.add('dirty'); const g=f.querySelector('.btn-guardar'); if(g) g.classList.remove('hidden');
}
async function revisar(id, estado){
  const c={ id_registro:id }; if(estado) c.estado=estado;
  if(dirty[id] && Object.keys(dirty[id]).length) c.campos=dirty[id];
  if(!c.estado && !c.campos) return;
  if(c.campos && c.campos.hasOwnProperty('final') && c.campos.hasOwnProperty('inicial')===false){ /* el servidor recalcula total */ }
  let d; try{ d=await api(null, { mod:'parte', op:'revisar', cambios:[c] }); }catch(e){ d={ok:false,error:'Sin conexión.'}; }
  if(caducada(d)) return;
  if(!d.ok){ toast(d.error||'No se guardó', true); return; }
  if(d.errores && d.errores.length){ toast('No se aplicó: '+d.errores.map(e=>e.error).join('; '), true); return; }
  delete dirty[id];
  aplicarCambios(d.filas||[]);
  toast(estado==='aprobado'?'Aprobado':estado==='descartado'?'Descartado':estado==='pendiente'?'Reabierto':'Guardado');
}
// mueve las filas devueltas por el servidor entre pendientes/revisadas sin recargar todo
function aplicarCambios(filas){
  filas.forEach(nf=>{
    BAND.pendientes=(BAND.pendientes||[]).filter(r=>r.id_registro!==nf.id_registro);
    BAND.revisadas=(BAND.revisadas||[]).filter(r=>r.id_registro!==nf.id_registro);
    const fechaVista=document.getElementById('fecha').value;
    if(nf.fecha!==fechaVista) return;   // se le cambió la fecha: ya no es de este día
    (nf.estado==='pendiente'?BAND.pendientes:BAND.revisadas).push(nf);
  });
  const ord=(a,b)=>(a.codigo+a.hora_de)<(b.codigo+b.hora_de)?-1:1;
  BAND.pendientes.sort(ord); BAND.revisadas.sort(ord);
  // recalcular faltantes con lo que hay en pantalla
  const con={}; BAND.pendientes.concat(BAND.revisadas).forEach(r=>{ if(r.estado!=='descartado') con[norm(r.codigo).replace(/[^A-Z0-9]/g,'')]=1; });
  BAND.faltantes=(LISTAS.equipos||[]).filter(q=>!con[norm(q.codigo).replace(/[^A-Z0-9]/g,'')]).map(q=>{ const prev=(BAND.faltantes||[]).find(f=>f.codigo===q.codigo); return prev||q; });
  pintarBandeja();
}
async function aprobarSinAlertas(){
  const lista=(BAND.pendientes||[]).filter(r=>!alertasDe(r).length);
  if(!lista.length) return;
  if(!confirm('¿Aprobar '+lista.length+' parte(s) sin alertas de la fecha '+document.getElementById('fecha').value+'?')) return;
  const cambios=lista.map(r=>{ const c={ id_registro:r.id_registro, estado:'aprobado' }; if(dirty[r.id_registro]) c.campos=dirty[r.id_registro]; return c; });
  let d; try{ d=await api(null, { mod:'parte', op:'revisar', cambios:cambios }); }catch(e){ d={ok:false,error:'Sin conexión.'}; }
  if(caducada(d)) return;
  if(!d.ok){ toast(d.error||'No se guardó', true); return; }
  (d.filas||[]).forEach(f=>delete dirty[f.id_registro]);
  aplicarCambios(d.filas||[]);
  toast('Aprobadas '+d.cambiadas+(d.errores&&d.errores.length?' · '+d.errores.length+' con error':''), !!(d.errores&&d.errores.length));
}

/* ---------- agregar manual ---------- */
let manualEq=null;
function abrirManual(codigo){
  const q=(LISTAS.equipos||[]).find(e=>e.codigo===codigo) || (BAND.faltantes||[]).find(e=>e.codigo===codigo);
  if(!q) return;
  const f=(BAND.faltantes||[]).find(e=>e.codigo===codigo); const ult=f&&f.ultimo?f.ultimo.final:'';
  manualEq=q;
  document.getElementById('mTitulo').textContent='Agregar parte manual · '+q.codigo+' · '+q.tipo+(q.placa?' · '+q.placa:'')+' · '+(q.medidor||'sin medidor');
  const c=document.getElementById('mCampos');
  c.innerHTML=
     '<div class="c"><label>Fecha</label><input type="date" id="m_fecha" value="'+esc(document.getElementById('fecha').value)+'"></div>'
    +'<div class="c"><label>Nº parte físico</label><input type="text" id="m_reporte" placeholder="obligatorio"></div>'
    +'<div class="c w2"><label>Operador</label><select id="m_operador">'+opSelect('', LISTAS.operadores||[], ['Sin operador'])+'</select></div>'
    +'<div class="c"><label>Hora de</label><input type="time" id="m_hde"></div><div class="c"><label>Hora a</label><input type="time" id="m_ha"></div>'
    +(q.medidor?'<div class="c"><label>Inicial</label><input type="number" step="0.1" id="m_ini" value="'+esc(ult)+'"></div><div class="c"><label>Final</label><input type="number" step="0.1" id="m_fin"></div>':'<div class="c w2"><label>Medidor</label><div class="tot" data-estilo="font-size:13px;color:var(--muted)">sin medidor en el catálogo</div></div>')
    +'<div class="c"><label>H. varada</label><input type="number" step="0.5" id="m_var"></div><div class="c"><label>H. lluvia</label><input type="number" step="0.5" id="m_llu"></div>'
    +'<div class="c"><label>PR</label><input type="number" id="m_pr"></div>'
    +'<div class="c w3"><label>Centro de coste</label><select id="m_cc" data-on-change="setUfDesdeCC(\'m_uf\',this.value)">'+ccSelect('')+'</select></div>'
    +'<div class="c"><label>UF</label><select id="m_uf"><option value="">—</option><option>1</option><option>2</option><option>3</option></select></div>'
    +'<div class="c w2"><label>Descripción</label><textarea rows="2" id="m_desc"></textarea></div>'
    +'<div class="c w3"><label>Observaciones</label><textarea rows="2" id="m_obs"></textarea></div>';
  document.getElementById('modal').classList.remove('hidden');
}
function cerrarModal(){ document.getElementById('modal').classList.add('hidden'); manualEq=null; }
async function guardarManual(){
  if(!manualEq) return;
  const g=id=>{ const el=document.getElementById(id); return el?el.value:''; };
  const t={ id_registro:uuid(), fecha:g('m_fecha'), reporte_num:g('m_reporte').trim(), operador:g('m_operador'), inicial:num(g('m_ini'))===null?'':num(g('m_ini')), final:num(g('m_fin'))===null?'':num(g('m_fin')),
    inicial_modificado:'NO', hora_de:g('m_hde'), hora_a:g('m_ha'), centro_coste:g('m_cc'), pr:num(g('m_pr'))===null?'':num(g('m_pr')), uf:g('m_uf')||ufDe(g('m_cc')),
    descripcion_trabajo:g('m_desc').trim(), horas_varada:num(g('m_var'))===null?'':num(g('m_var')), horas_lluvia:num(g('m_llu'))===null?'':num(g('m_llu')), observaciones:g('m_obs').trim() };
  const errs=[]; if(!t.fecha) errs.push('fecha'); if(!t.reporte_num) errs.push('nº de parte'); if(!t.operador) errs.push('operador'); if(!t.centro_coste) errs.push('centro de coste');
  if(manualEq.medidor && (t.inicial===''||t.final==='')) errs.push('medidor inicial y final');
  if(errs.length){ alert('Falta: '+errs.join(', ')); return; }
  const b=document.getElementById('mGuardar'); b.disabled=true;
  let d; try{ d=await api(null, { mod:'parte', op:'reporte', origen:'manual', codigo:manualEq.codigo, tramos:[t] }); }catch(e){ d={ok:false,error:'Sin conexión.'}; }
  b.disabled=false;
  if(caducada(d)) return;
  if(!d.ok){ toast(d.error||'No se guardó', true); return; }
  cerrarModal(); toast('Fila manual creada como pendiente'); cargarBandeja();
}

/* ---------- día sin operación (varios equipos sin parte) ----------
 * Mismos motivos, descripción y pseudo-CC que «Día sin operación» de parte.html: una fila por equipo con
 * inicial = final (último medidor) y origen=manual. Domingos, festivos, lluvia o taller casi nunca los
 * reporta el operador desde la cabina: los cierra quien revisa los partes cada día. */
const SINOP_MOTIVOS={
  'Domingo':      { desc:'Domingo',                    cc:'Domingo/Festivo' },
  'Festivo':      { desc:'Festivo',                    cc:'Domingo/Festivo' },
  'Taller':       { desc:'Taller',                     cc:'Taller' },
  'Disponible':   { desc:'Disponible',                 cc:'Disponible' },
  'Lluvia':       { desc:'Disponible por lluvia',      cc:'Disponible' },
  'Sin operador': { desc:'Disponible - Sin operador',  cc:'Disponible' }
};
let sinOpEquipos=[];
function abrirSinOp(motivo){
  const lista=faltSeleccionados(); if(!lista.length){ toast('Marca al menos un equipo de la lista', true); return; }
  if(!SINOP_MOTIVOS[motivo]) return;
  sinOpEquipos=lista;
  document.getElementById('soTitulo').textContent='Día sin operación · '+motivo+' · '+lista.length+' equipo(s)';
  document.getElementById('soCampos').innerHTML=
     '<div class="c"><label>Fecha</label><input type="date" id="so_fecha" value="'+esc(document.getElementById('fecha').value)+'"></div>'
    +'<div class="c w2"><label>Motivo</label><select id="so_motivo" data-on-change="pintarSinOpMotivo()">'+Object.keys(SINOP_MOTIVOS).map(m=>'<option value="'+esc(m)+'"'+(m===motivo?' selected':'')+'>'+esc(m)+' → '+esc(SINOP_MOTIVOS[m].cc)+'</option>').join('')+'</select></div>'
    +'<div class="c w2"><label>Operador</label><select id="so_operador">'+opSelect('Sin operador', LISTAS.operadores||[], ['Sin operador'])+'</select></div>'
    +'<div class="c"><label>Nº parte físico</label><input type="text" id="so_reporte" placeholder="vacío si no hay"></div>'
    +'<div class="c w2"><label>Descripción</label><input type="text" id="so_desc" value="'+esc(SINOP_MOTIVOS[motivo].desc)+'"></div>'
    +'<div class="c w3"><label>Observaciones</label><input type="text" id="so_obs" placeholder="opcional, va en todas las filas"></div>';
  document.getElementById('soLista').innerHTML='<div class="so-cab"><span>Equipo</span><span>Medidor (sin cambio)</span></div>'+lista.map((q,i)=>{
    const ult=q.ultimo&&q.ultimo.final!==''&&q.ultimo.final!==null&&q.ultimo.final!==undefined ? q.ultimo.final : '';
    return '<div class="so-eq" id="so-eq-'+i+'"><span><b>'+esc(q.codigo)+'</b> <small>'+esc(q.tipo)+(q.placa?' · '+esc(q.placa):'')+'</small></span>'
      +(q.medidor ? '<input type="number" step="0.1" id="so_med_'+i+'" value="'+esc(ult)+'" placeholder="'+(ult===''?'sin último final':'')+'" aria-label="medidor '+esc(q.codigo)+'">' : '<span class="so-nomed">sin medidor</span>')
      +'<span class="so-res" id="so_res_'+i+'"></span></div>'; }).join('');
  document.getElementById('soGuardar').disabled=false; document.getElementById('soGuardar').textContent='Crear '+lista.length+' fila(s)';
  document.getElementById('modalSinOp').classList.remove('hidden');
}
function pintarSinOpMotivo(){ const m=document.getElementById('so_motivo').value, d=document.getElementById('so_desc'); if(SINOP_MOTIVOS[m]) d.value=SINOP_MOTIVOS[m].desc; }
function cerrarSinOp(){ document.getElementById('modalSinOp').classList.add('hidden'); sinOpEquipos=[]; }
function cerrarSinOpFondo(ev, el){ if(ev.target===el) cerrarSinOp(); }
async function guardarSinOp(){
  if(!sinOpEquipos.length) return;
  const g=id=>{ const el=document.getElementById(id); return el?el.value:''; };
  const fecha=g('so_fecha'), motivo=g('so_motivo'), operador=g('so_operador'), reporte=g('so_reporte').trim(), desc=g('so_desc').trim(), obs=g('so_obs').trim();
  const cc=(SINOP_MOTIVOS[motivo]||{}).cc;
  const errs=[]; if(!fecha) errs.push('fecha'); if(!cc) errs.push('motivo'); if(!operador) errs.push('operador'); if(!desc) errs.push('descripción');
  const faltaMed=sinOpEquipos.filter((q,i)=>q.medidor && num(g('so_med_'+i))===null).map(q=>q.codigo);
  if(faltaMed.length) errs.push('medidor de '+faltaMed.join(', ')+' (no hay último final: escríbelo o desmarca el equipo)');
  if(errs.length){ alert('Falta: '+errs.join('; ')); return; }
  const b=document.getElementById('soGuardar'); b.disabled=true;
  const creadas=[], fallos=[];
  for(let i=0;i<sinOpEquipos.length;i++){
    const q=sinOpEquipos[i], med=q.medidor?num(g('so_med_'+i)):'';
    b.textContent='Guardando '+(i+1)+' / '+sinOpEquipos.length+'…';
    const t={ id_registro:uuid(), fecha:fecha, reporte_num:reporte, operador:operador, inicial:med, final:med, inicial_modificado:'NO', hora_de:'', hora_a:'',
      centro_coste:cc, pr:'', uf:'', descripcion_trabajo:desc, horas_varada:'', horas_lluvia:'', observaciones:obs };
    let d; try{ d=await api(null, { mod:'parte', op:'reporte', origen:'manual', codigo:q.codigo, tramos:[t] }); }catch(e){ d={ok:false,error:'Sin conexión.'}; }
    if(caducada(d)) return;
    const res=document.getElementById('so_res_'+i);
    if(d.ok && d.filas && d.filas[0] && !d.filas[0].duplicada){ creadas.push(d.filas[0].id_registro); if(res){ res.textContent='✓'; res.className='so-res ok'; } }
    else { fallos.push(q.codigo+': '+(d.error||'no se guardó')); if(res){ res.textContent='✕ '+(d.error||'no se guardó'); res.className='so-res mal'; } }
  }
  let aprobadas=0;
  if(creadas.length && document.getElementById('soAprobar').checked){
    let d; try{ d=await api(null, { mod:'parte', op:'revisar', cambios:creadas.map(id=>({ id_registro:id, estado:'aprobado' })) }); }catch(e){ d={ok:false,error:'Sin conexión.'}; }
    if(caducada(d)) return;
    if(d.ok) aprobadas=d.cambiadas||0; else fallos.push('aprobar: '+(d.error||'no se pudo'));
  }
  b.disabled=false; b.textContent='Crear '+sinOpEquipos.length+' fila(s)';
  if(fallos.length){ toast('Creadas '+creadas.length+(aprobadas?' (aprobadas '+aprobadas+')':'')+' · con error: '+fallos.join(' · '), true); if(creadas.length) cargarBandeja(); return; }
  cerrarSinOp(); toast(creadas.length+' fila(s) creada(s)'+(aprobadas?' y aprobada(s)':' como pendientes')); cargarBandeja();
}

/* ---------- D178: repartir una fila en varias (dos o más CC / actividades) ----------
 * Lo que el operador manda con UN centro de coste a veces fue a dos (o a dos actividades). Aquí se abre
 * la fila en N con el mismo motor del reparto por % del formulario: medidor y horas prorrateados, la
 * original queda `descartado` con la marca [Repartido en N filas] y las nuevas nacen `pendiente`. */
let repFila=null, repFilas=[];
function filaPorId(id){ return (BAND.pendientes||[]).concat(BAND.revisadas||[]).find(r=>r.id_registro===id) || (BASE&&BASE.filas||[]).find(r=>r.id_registro===id) || null; }
function abrirRepartir(id){
  const r=filaPorId(id); if(!r) return;
  if(dirty[id] && Object.keys(dirty[id]).length){ toast('Guarda primero los cambios de esta fila (💾) y luego repártela', true); return; }
  repFila=r;
  repFilas=[ { cc:r.centro_coste||'', pct:50, pr:r.pr, desc:r.descripcion_trabajo||'' }, { cc:'', pct:50, pr:r.pr, desc:'' } ];
  const tot=(num(r.inicial)!==null&&num(r.final)!==null)?Math.round((num(r.final)-num(r.inicial))*100)/100:null, tope=TOPES[r.medidor];
  document.getElementById('rpTitulo').textContent='Repartir · '+r.codigo+' · '+r.fecha+' · parte nº '+(r.reporte_num||'—');
  document.getElementById('rpInfo').innerHTML='Medidor <b>'+esc(r.inicial)+' → '+esc(r.final)+'</b> = <b>'+(tot===null?'—':fmt(tot))+' '+(tope?esc(tope.unidad):'')+'</b>'+((r.hora_de||r.hora_a)?' · '+esc(r.hora_de||'?')+'–'+esc(r.hora_a||'?'):'')+' · CC actual <b>'+esc(r.centro_coste||'(sin CC)')+'</b>. Cada fila nueva recibe su porcentaje del medidor y de las horas; la última cierra exacto en el final.';
  pintarRepartir();
  document.getElementById('modalRep').classList.remove('hidden');
}
function cerrarRepartir(){ document.getElementById('modalRep').classList.add('hidden'); repFila=null; repFilas=[]; }
function cerrarRepartirFondo(ev, el){ if(ev.target===el) cerrarRepartir(); }
function pintarRepartir(){
  const r=repFila; if(!r) return;
  const tot=(num(r.inicial)!==null&&num(r.final)!==null)?Math.round((num(r.final)-num(r.inicial))*100)/100:null, tope=TOPES[r.medidor];
  const suma=repFilas.reduce((a,f)=>a+(num(f.pct)||0),0);
  document.getElementById('rpFilas').innerHTML='<div class="rp-cab"><span>Centro de coste</span><span>%</span><span>PR</span><span>Descripción</span><span></span></div>'
    +repFilas.map((f,j)=>'<div class="rp-fila">'
      +'<select data-on-change="setRepartir('+j+',\'cc\',this.value)">'+ccSelect(f.cc)+'</select>'
      +'<input type="number" min="0" max="100" step="1" value="'+esc(f.pct)+'" aria-label="porcentaje '+(j+1)+'" data-on-input="setRepartir('+j+',\'pct\',this.value)">'
      +'<input type="number" value="'+esc(f.pr===null||f.pr===undefined?'':f.pr)+'" placeholder="PR" data-on-input="setRepartir('+j+',\'pr\',this.value)">'
      +'<input type="text" value="'+esc(f.desc)+'" placeholder="(la de la fila original)" data-on-input="setRepartir('+j+',\'desc\',this.value)">'
      +'<button type="button" class="btn mini" data-on-click="quitarRepartir('+j+')" title="Quitar"'+(repFilas.length<=2?' disabled':'')+'>✕</button>'
      +'<span class="rp-res">'+(tot!==null&&tope&&num(f.pct)?fmt(tot*num(f.pct)/100)+' '+esc(tope.unidad):'')+'</span>'
      +'</div>').join('');
  const s=document.getElementById('rpSuma'); s.textContent=fmt(suma)+' %'; s.classList.toggle('mal', Math.abs(suma-100)>0.5);
  document.getElementById('rpGuardar').disabled = Math.abs(suma-100)>0.5 || repFilas.some(f=>!f.cc) || !repFilas.every(f=>num(f.pct)>0);
}
function setRepartir(j,k,v){ if(!repFilas[j]) return; repFilas[j][k]=v; if(k==='pct'||k==='cc') pintarRepartir(); }
function quitarRepartir(j){ if(repFilas.length<=2) return; repFilas.splice(j,1); repartirIguales(); }
function addRepartir(){ repFilas.push({ cc:'', pct:'', pr:repFila?repFila.pr:'', desc:'' }); repartirIguales(); }
function repartirIguales(){ const n=repFilas.length, base=Math.floor(100/n*100)/100; repFilas.forEach((f,j)=>{ f.pct = j===n-1 ? Math.round((100-base*(n-1))*100)/100 : base; }); pintarRepartir(); }
function repartirRapido(a,b){ while(repFilas.length<2) repFilas.push({cc:'',pct:'',pr:'',desc:''}); repFilas=repFilas.slice(0,2); repFilas[0].pct=a; repFilas[1].pct=b; pintarRepartir(); }
async function guardarRepartir(){
  if(!repFila) return;
  const reparto=repFilas.map(f=>({ centro_coste:f.cc, pct:num(f.pct), pr:num(f.pr)===null?'':num(f.pr), uf:ufDe(f.cc), descripcion_trabajo:String(f.desc||'').trim() }));
  if(reparto.some(x=>!x.centro_coste)){ toast('Cada fila necesita su centro de coste', true); return; }
  if(Math.abs(reparto.reduce((a,x)=>a+(x.pct||0),0)-100)>0.5){ toast('Los porcentajes deben sumar 100 %', true); return; }
  const b=document.getElementById('rpGuardar'); b.disabled=true;
  let d; try{ d=await api(null, { mod:'parte', op:'repartir', id_registro:repFila.id_registro, reparto:reparto }); }catch(e){ d={ok:false,error:'Sin conexión.'}; }
  b.disabled=false;
  if(caducada(d)) return;
  if(!d.ok){ toast(d.error||'No se guardó', true); return; }
  const id=repFila.id_registro; cerrarRepartir();
  if(BASE && BASE.filas.some(x=>x.id_registro===id)){ BASE=null; if(!document.getElementById('vistaBase').classList.contains('hidden')) cargarBase(); }
  aplicarCambios([d.original].concat(d.filas||[]));
  toast('Repartida en '+(d.filas||[]).length+' filas (pendientes); la original quedó descartada');
}

/* ================= BASE ================= */
async function cargarBase(){
  const desde=document.getElementById('desde').value, hasta=document.getElementById('hasta').value;
  if(!desde||!hasta){ toast('Elige desde y hasta', true); return; }
  document.getElementById('tbBase').innerHTML='<tr><td colspan="20" class="vacio">Cargando…</td></tr>';
  let d; try{ d=await api(API+'&op=base&desde='+desde+'&hasta='+hasta+'&estado='+document.getElementById('fEstado').value); }catch(e){ d={ok:false,error:'Sin conexión.'}; }
  if(caducada(d)) return;
  if(!d.ok){ document.getElementById('tbBase').innerHTML='<tr><td colspan="20" class="vacio">'+esc(d.error||'error')+'</td></tr>'; return; }
  BASE=d; if(d.listas) LISTAS=Object.assign({}, LISTAS, d.listas); editando=null;
  pintarBase();
}
function filasFiltradas(){
  if(!BASE) return [];
  const eq=norm(document.getElementById('fEq').value), cc=norm(document.getElementById('fCC').value), tx=norm(document.getElementById('fTxt').value);
  return BASE.filas.map((r,i)=>({r:r,i:i})).filter(x=>{ const r=x.r;
    return (!eq || norm(r.codigo).indexOf(eq)>=0) && (!cc || norm(r.centro_coste).indexOf(cc)>=0)
      && (!tx || norm(r.operador+' '+r.descripcion_trabajo+' '+r.observaciones+' '+r.reporte_num).indexOf(tx)>=0); });
}
function pintarBase(){
  if(!BASE) return;
  const lista=filasFiltradas();
  document.getElementById('kBase').textContent=BASE.filas.length; document.getElementById('kBaseF').textContent=lista.length;
  document.getElementById('kBaseEq').textContent=new Set(lista.map(x=>x.r.codigo)).size;
  document.getElementById('btnCopiar').disabled=!lista.length;
  const tb=document.getElementById('tbBase');
  if(!lista.length){ tb.innerHTML='<tr><td colspan="20" class="vacio">Sin filas'+(BASE.filas.length?' con ese filtro':' en el rango')+'.</td></tr>'; return; }
  tb.innerHTML=lista.map(x=>x.r.id_registro===editando ? filaEditHTML(x.r) : filaBaseHTML(x.r)).join('');
}
function filaBaseHTML(r){
  const al=alertasDe(r);
  const idJs=esc(String(r.id_registro).replace(/'/g,"\\'"));
  return '<tr'+(r.estado!=='aprobado'?' data-estilo="opacity:.6"':'')+'><td class="acc"><button class="btn mini" data-on-click="editarBase(\''+idJs+'\')">✎</button>'+(r.estado!=='descartado'?' <button class="btn mini" data-on-click="abrirRepartir(\''+idJs+'\')" title="Repartir en varias filas">⑂</button>':'')+'</td>'
    +'<td>'+esc(r.fecha)+(r.estado!=='aprobado'?'<br><span class="badge estado-'+esc(r.estado)+'">'+esc(r.estado)+'</span>':'')+'</td><td>'+esc(r.reporte_num)+'</td><td><b>'+esc(r.codigo)+'</b><br><span data-estilo="color:var(--muted)">'+esc(r.tipo)+'</span></td><td>'+esc(r.medidor)+'</td>'
    +'<td class="num">'+fmt(r.inicial)+'</td><td class="num">'+fmt(r.final)+'</td><td class="num"><b>'+fmt(r.total)+'</b></td><td class="num">'+fmt(r.horas_varada)+'</td><td class="num">'+fmt(r.horas_lluvia)+'</td>'
    +'<td>'+esc(r.hora_de)+'</td><td>'+esc(r.hora_a)+'</td><td class="desc">'+esc(r.descripcion_trabajo)+'</td><td>'+esc(r.centro_coste)+'</td><td class="num">'+esc(r.pr)+'</td><td>'+esc(r.uf)+'</td><td>'+esc(r.operador)+'</td><td class="desc">'+esc(r.observaciones)+'</td>'
    +'<td>'+al.map(a=>'<span class="badge alerta">'+esc(a)+'</span>').join(' ')+'</td><td>'+esc(r.revisado_por)+(r.origen==='manual'?' <span class="badge manual">manual</span>':'')+'</td></tr>';
}
function filaEditHTML(r){
  const inp=(k,tipo,extra)=>'<input type="'+tipo+'" data-k="'+k+'" value="'+esc(r[k])+'"'+(extra||'')+'>';
  return '<tr class="edit" id="edit-'+esc(r.id_registro)+'"><td><button class="btn mini ok" data-on-click="guardarBase(\''+esc(String(r.id_registro).replace(/'/g,"\\'"))+'\')">💾</button> <button class="btn mini" data-on-click="cancelarEdicionBase()">✕</button></td>'
    +'<td>'+inp('fecha','date')+'</td><td>'+inp('reporte_num','text')+'</td><td><b>'+esc(r.codigo)+'</b></td><td>'+esc(r.medidor)+'</td>'
    +'<td>'+inp('inicial','number',' step="0.1"')+'</td><td>'+inp('final','number',' step="0.1"')+'</td><td class="num">'+fmt(r.total)+'</td><td>'+inp('horas_varada','number',' step="0.5"')+'</td><td>'+inp('horas_lluvia','number',' step="0.5"')+'</td>'
    +'<td>'+inp('hora_de','time')+'</td><td>'+inp('hora_a','time')+'</td><td class="desc"><textarea rows="2" data-k="descripcion_trabajo">'+esc(r.descripcion_trabajo)+'</textarea></td>'
    +'<td><select data-k="centro_coste" data-on-change="setUfFila(this)">'+ccSelect(r.centro_coste)+'</select></td><td>'+inp('pr','number')+'</td>'
    +'<td><select data-k="uf">'+['','1','2','3'].map(u=>'<option value="'+u+'"'+(String(r.uf)===u?' selected':'')+'>'+(u||'—')+'</option>').join('')+'</select></td>'
    +'<td><select data-k="operador">'+opSelect(r.operador, LISTAS.operadores||[], ['Sin operador'])+'</select></td><td class="desc"><textarea rows="2" data-k="observaciones">'+esc(r.observaciones)+'</textarea></td>'
    +'<td>'+esc(r.alertas)+'</td><td>'+esc(r.revisado_por)+'</td></tr>';
}
function editarBase(id){ editando=id; pintarBase(); }
async function guardarBase(id){
  const tr=document.getElementById('edit-'+id); if(!tr) return;
  const r=BASE.filas.find(x=>x.id_registro===id), campos={};
  tr.querySelectorAll('[data-k]').forEach(el=>{ const k=el.dataset.k; if(String(el.value)!==String(r[k]===null?'':r[k])) campos[k]=el.value; });
  if(!Object.keys(campos).length){ editando=null; pintarBase(); return; }
  let d; try{ d=await api(null, { mod:'parte', op:'revisar', cambios:[{ id_registro:id, campos:campos }] }); }catch(e){ d={ok:false,error:'Sin conexión.'}; }
  if(caducada(d)) return;
  if(!d.ok){ toast(d.error||'No se guardó', true); return; }
  if(d.errores && d.errores.length){ toast('No se aplicó: '+d.errores.map(e=>e.error).join('; '), true); return; }
  const nf=(d.filas||[])[0];
  if(nf){ const i=BASE.filas.findIndex(x=>x.id_registro===id); BASE.filas[i]=nf; BASE.excel.filas[i]=excelFilaLocal(nf); }
  editando=null; pintarBase(); toast('Fila actualizada');
}
// misma regla que parteExcelFila_ del backend, para actualizar la copia local tras una edición
function excelFilaLocal(r){
  const mapa=BASE.excel.mapa, esH=r.medidor==='HOROMETRO', esK=r.medidor==='KM';
  return BASE.excel.columnas.map(L=>{ const c=mapa[L]; if(!c) return '';
    if(c==='inicial_h') return esH?r.inicial:''; if(c==='final_h') return esH?r.final:''; if(c==='inicial_km') return esK?r.inicial:''; if(c==='final_km') return esK?r.final:'';
    return r[c]===undefined||r[c]===null?'':r[c]; });
}
function celdaExcel(L, v){
  if(v===''||v===null||v===undefined) return '';
  if(L==='C') return fechaExcel(v);                                   // dd/mm/aaaa
  if(typeof v==='number') return String(v).replace('.',',');        // decimal con coma (como jefe.html)
  return String(v).replace(/[\t\r\n]+/g,' ');
}
function copiarExcel(btn){
  const lista=filasFiltradas(); if(!lista.length) return;
  const cols=BASE.excel.columnas;
  const tsv=lista.map(x=>BASE.excel.filas[x.i].map((v,j)=>celdaExcel(cols[j],v)).join('\t')).join('\n');
  const ok=()=>{ const o=btn.innerHTML; btn.classList.add('copied'); btn.innerHTML='✓ Copiado ('+lista.length+' filas, B→AR)'; setTimeout(()=>{btn.classList.remove('copied');btn.innerHTML=o;},2200); };
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tsv).then(ok).catch(()=>fallbackCopiar(tsv,ok)); else fallbackCopiar(tsv,ok);
}
function fallbackCopiar(text, ok){
  const ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.top='-1000px'; ta.style.opacity='0';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try{ document.execCommand('copy'); ok(); }catch(e){ alert('No se pudo copiar automáticamente.'); }
  document.body.removeChild(ta);
}

/* ---------- arranque ---------- */
(function(){
  const h=hoy(); document.getElementById('fecha').value=h;
  const d=new Date(h+'T12:00:00'); d.setDate(d.getDate()-7);
  document.getElementById('desde').value=d.toISOString().slice(0,10); document.getElementById('hasta').value=h;
  document.getElementById('fecha').addEventListener('change', cargarBandeja);
  cargarBandeja();
})();

// D170: antes eran expresiones en línea en el marcado; la CSP ya no las admite.
function cerrarModalFondo(ev, el){ if(ev.target===el) cerrarModal(); }
function setUfDesdeCC(idUf, cc){ document.getElementById(idUf).value=ufDe(cc); }
function cancelarEdicionBase(){ editando=null; pintarBase(); }
function setUfFila(sel){ sel.closest('tr').querySelector('[data-k=uf]').value=ufDe(sel.value); }
