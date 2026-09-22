// D170: aplica los data-estilo del marcado ANTES de que corra la lógica de la pantalla (ver tema.js).
if(window.TM2Estilos) TM2Estilos.aplicar();
const APPS_SCRIPT_URL = GALCA_ENV.url.obra;          // entorno.js (D168): producción o prueba
const API = APPS_SCRIPT_URL + '?mod=parte';
const ROLES = ['admin','encargado','residente','parte_maquinaria','residente_dren'];   // D193: + residente de drenajes
// D178: `jeisson` entra por USUARIO (mismo patrón que la Flota, D139): es quien pone el CC a los partes.
const USUARIOS_OK = ['jeisson','duvan'];   // D193: + duvan (asistencias de drenajes, lo usa Stiven)
// A dónde vuelve «← Menú» según quién entró (el admin a su menú; el residente a su panel; jeisson a sus tiles).
const VOLVER = { admin:'menu.html', residente:'residente.html', residente_dren:'seleccion-reporte.html', jefe:'hub-jefe.html' };
// D198: el JEFE trabaja solo la Base de aprobados: la lee y corrige sus campos (CC, horas…), sin Pendientes ni
// aprobar/descartar/repartir (el servidor le abre op=base y op=revisar solo sobre filas aprobadas y sin estado).
// Dentro del Panel de Obra la pantalla llega con ?embed=1&solo=base: sin cabecera propia y solo con la Base.
const ROLES_LEEN_BASE = ['jefe'];
const QS=(function(){ try{ return new URLSearchParams(location.search); }catch(e){ return { get:function(){ return null; } }; } })();
const EMBED = QS.get('embed')==='1';
if(EMBED) document.documentElement.classList.add('embed');

/* ---------- sesión (D82/D109) ---------- */
const rol=localStorage.getItem('rol')||'', usuario=(localStorage.getItem('usuario')||'').trim().toLowerCase();
if(!rol || (ROLES.indexOf(rol)<0 && USUARIOS_OK.indexOf(usuario)<0 && ROLES_LEEN_BASE.indexOf(rol)<0) || !(window.TM2Auth && TM2Auth.get())){ location.href='index.html'; }
const SOLO_BASE = ROLES_LEEN_BASE.indexOf(rol)>=0 || QS.get('solo')==='base';                 // D198
const ES_REVISOR = ROLES.indexOf(rol)>=0 || USUARIOS_OK.indexOf(usuario)>=0;                   // aprueba, descarta y reparte
const PUEDE_EDITAR_BASE = ES_REVISOR || ROLES_LEEN_BASE.indexOf(rol)>=0;                         // el jefe también corrige la Base
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
/* D193 — filtro Todos / Tierras / Drenajes. El grupo es el de la FLOTA (maquinas.grupo, D190), que llega en
 * listas.equipos y en los faltantes; un equipo fuera de la flota vigente (FUERA_DE_FLOTA) cuenta como tierras,
 * igual que en el backend. Se recuerda por navegador; el residente de drenajes y duvan abren en Drenajes la
 * primera vez. Filtra lo que se VE y lo que hacen los botones masivos (Aprobar todo lo sin alertas, Día sin
 * operación, Copiar para Excel), nunca los datos del servidor. */
let GRUPO = (function(){ let g=''; try{ g=localStorage.getItem('tm2_rev_grupo')||''; }catch(e){} return ['todos','tierras','drenajes'].indexOf(g)>=0 ? g : ((rol==='residente_dren' || usuario==='duvan') ? 'drenajes' : 'todos'); })();
function codNorm(c){ return String(c||'').toUpperCase().replace(/[^A-Z0-9]/g,''); }
function grupoDe(codigo){
  const k=codNorm(codigo), q=(LISTAS.equipos||[]).concat(BAND.faltantes||[]).find(x=>codNorm(x.codigo)===k);
  return q && q.grupo==='drenajes' ? 'drenajes' : 'tierras';
}
function enGrupo(codigo){ return GRUPO==='todos' || grupoDe(codigo)===GRUPO; }
function pintarSegGrupo(){ document.querySelectorAll('#segGrupo button').forEach(b=>b.classList.toggle('on', b.dataset.g===GRUPO)); }
function setGrupo(g){
  GRUPO=g; try{ localStorage.setItem('tm2_rev_grupo', g); }catch(e){}
  pintarSegGrupo(); pintarBandeja(); if(BASE) pintarBase();
}

function verTab(t){
  document.getElementById('tabPend').classList.toggle('on', t==='pend'); document.getElementById('tabBase').classList.toggle('on', t==='base');
  document.getElementById('vistaPend').classList.toggle('hidden', t!=='pend'); document.getElementById('vistaBase').classList.toggle('hidden', t!=='base');
  // D198: la Base usa TODO el ancho y el alto de la ventana (como la Revisión de DATA).
  document.querySelector('.container').classList.toggle('ancho', t==='base');
  if(t==='base'){ if(!BASE) cargarBase(); ajustarAltoBase(); }
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
const ALERTA_TXT={ INICIAL_DISTINTO:'El inicial no coincide con el final del parte ANTERIOR del equipo (se calcula al abrir la revisión; la línea «Medidor» de la tarjeta muestra los dos valores)', HORARIO_RARO:'La jornada pasa de 14 h: casi siempre una hora mal digitada (p. ej. 17:00→16:30) que el sistema toma por turno noche. Corrige «Hora de» / «Hora a» antes de aprobar',TOTAL_ALTO:'Total alto (>12 h / >400 km)', DUPLICADO:'Ya había una fila del equipo con la misma fecha y hora de inicio', CC_INUSUAL:'CC que el equipo no usó en los últimos 30 días', SIN_MEDIDOR:'Equipo sin medidor definido en el catálogo', CC_DESCONOCIDO:'CC que no está en PARTE_CC', SIN_CC:'Texto libre sin centro de coste: léelo, elige el CC (se puede editar aquí) y aprueba; sin CC no se deja aprobar', FUERA_DE_FLOTA:'Reportó sin estar vigente ese día en la flota (Maquinaria › Flota): reemplazo de un día, equipo devuelto o de otro frente. Si se queda, dale el alta', PARTE_REPETIDO:'El mismo nº de parte físico ya se subió en OTRO día: posible doble carga del mismo turno (típico del turno noche que cruza medianoche). Revisa antes de aprobar para no facturarlo dos veces' };
function pintarBandeja(){
  const p=(BAND.pendientes||[]).filter(r=>enGrupo(r.codigo)), rv=(BAND.revisadas||[]).filter(r=>enGrupo(r.codigo)), falt=faltVisibles();
  const conAl=p.filter(r=>alertasDe(r).length).length;
  pintarFueraDeFlota(p.concat(rv));
  document.getElementById('nPend').textContent=p.length; document.getElementById('kPend').textContent=p.length;
  document.getElementById('kAlert').textContent=conAl; document.getElementById('kAprob').textContent=rv.filter(r=>r.estado==='aprobado').length;
  document.getElementById('kFalt').textContent=falt.length; document.getElementById('cntFalt').textContent=falt.length;
  document.getElementById('btnAprobarTodo').disabled = !(p.length-conAl);
  document.getElementById('btnAprobarTodo').textContent='✓ Aprobar todo lo sin alertas ('+(p.length-conAl)+')';
  document.getElementById('pendientes').innerHTML = p.length ? p.map(r=>filaHTML(r)).join('') : '<div class="vacio">Sin partes pendientes'+(GRUPO==='todos'?'':' de '+GRUPO)+' en esta fecha.</div>';
  const rb=document.getElementById('revisadasBox'); rb.style.display= rv.length ? 'block' : 'none';
  document.getElementById('nRev').textContent=rv.length;
  document.getElementById('revisadas').innerHTML=rv.map(r=>filaHTML(r,true)).join('');
  // selección para «Día sin operación»: por defecto todos; se conserva lo desmarcado entre repintados
  const vivos={}; falt.forEach(q=>{ vivos[q.codigo]=1; if(!selFalt.hasOwnProperty(q.codigo)) selFalt[q.codigo]=true; });
  Object.keys(selFalt).forEach(c=>{ if(!vivos[c]) delete selFalt[c]; });
  document.getElementById('faltantes').innerHTML = faltantesHTML(falt);
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
// Una fila de «Equipos sin parte». D190: chip «Drenajes» cuando la máquina es de esa disciplina.
function faltFilaHTML(q){
  return '<div class="falt'+(selFalt[q.codigo]?' sel':'')+'"><input type="checkbox" aria-label="incluir '+esc(q.codigo)+'"'+(selFalt[q.codigo]?' checked':'')+' data-on-change="toggleFalt('+esc(JSON.stringify(q.codigo))+',this.checked)"><span class="cod">'+esc(q.codigo)+'</span><span class="tipo">'+esc(q.tipo)+(q.placa?' · '+esc(q.placa):'')+(q.ultimo?' · últ. '+fmt(q.ultimo.final):'')+(q.grupo==='drenajes'?' <span class="grchip-r">Drenajes</span>':'')+(q.sin_ficha?' · <b title="Vigente en la flota pero sin ficha en PARTE_EQUIPOS: el QR no le abre el parte. Corrige la estancia en Maquinaria › Flota y guarda placa y medidor.">⚠ sin ficha</b>':'')+'</span><button class="btn mini" data-on-click="abrirManual('+esc(JSON.stringify(q.codigo))+')">+ manual</button></div>';
}
// D190: si hay faltantes de drenajes Y de tierras, se separan en dos secciones; si no, lista plana (igual que antes).
function faltantesHTML(falt){
  if(!falt.length) return '<div class="vacio">Todos los equipos activos tienen parte.</div>';
  const dren=falt.filter(q=>q.grupo==='drenajes'), tie=falt.filter(q=>q.grupo!=='drenajes');
  if(dren.length && tie.length)
    return '<div class="falt-grupo">Tierras <span>'+tie.length+'</span></div>'+tie.map(faltFilaHTML).join('')+
           '<div class="falt-grupo">Drenajes <span>'+dren.length+'</span></div>'+dren.map(faltFilaHTML).join('');
  return falt.map(faltFilaHTML).join('');
}
let selFalt={};   // codigo → true/false (incluido en «Día sin operación»)
function faltVisibles(){ return (BAND.faltantes||[]).filter(q=>GRUPO==='todos' || (q.grupo==='drenajes'?'drenajes':'tierras')===GRUPO); }   // D193
function faltSeleccionados(){ return faltVisibles().filter(q=>selFalt[q.codigo]); }
function pintarSel(){
  const n=faltSeleccionados().length, tot=(BAND.faltantes||[]).length;
  document.getElementById('nSel').textContent=n;
  const t=document.getElementById('selTodos'); t.checked=(n===tot && tot>0); t.indeterminate=(n>0 && n<tot);
  document.querySelectorAll('#sinopBar .motivos .btn').forEach(b=>b.disabled=!n);
}
function toggleFalt(codigo, on){ selFalt[codigo]=!!on; const el=[...document.querySelectorAll('#faltantes .falt')].find(f=>f.querySelector('.cod').textContent===codigo); if(el) el.classList.toggle('sel',!!on); pintarSel(); }
function selFaltantes(on){ faltVisibles().forEach(q=>selFalt[q.codigo]=!!on); document.querySelectorAll('#faltantes .falt').forEach(f=>{ f.querySelector('input[type=checkbox]').checked=!!on; f.classList.toggle('sel',!!on); }); pintarSel(); }
function irAFaltantes(){ verTab('pend'); const c=document.getElementById('cardFalt'); if(c) c.scrollIntoView({behavior:'smooth',block:'start'}); }
function opSelect(v, lista, extra){
  const vistos={}; let html='';
  (extra||[]).concat(lista).forEach(o=>{ if(vistos[o]) return; vistos[o]=1; html+='<option value="'+esc(o)+'"'+(o===v?' selected':'')+'>'+esc(o)+'</option>'; });
  if(v && !vistos[v]) html='<option value="'+esc(v)+'" selected>'+esc(v)+' (no está en la lista)</option>'+html;
  return html;
}
/* ---------- D206: continuidad del medidor y turno noche en la tarjeta ----------
 * El servidor manda, por fila, el parte ANTERIOR real del equipo (fecha + hora de fin, con el cruce de medianoche
 * de D188) y la jornada. Aquí se muestra para poder verificarlo a ojo: «anterior 1358 → este inicial 1358 ✓». */
function horaMin(h){ const m=/^(\d{1,2}):(\d{2})/.exec(String(h||'')); return m ? (+m[1])*60+(+m[2]) : -1; }
function esNoche(hDe, hA){ const a=horaMin(hDe), b=horaMin(hA); return a>=0 && b>=0 && b<a; }
function jornadaH(hDe, hA){ const a=horaMin(hDe); let b=horaMin(hA); if(a<0||b<0||a===b) return null; if(b<a) b+=1440; return Math.round((b-a)/60*100)/100; }
function jornadaHTML(hDe, hA){
  const j=jornadaH(hDe, hA);
  return '<div class="tot jor'+(j!==null&&j>14?' mal':'')+'" title="De «Hora de» a «Hora a»'+(esNoche(hDe,hA)?'; sale al día siguiente (turno noche)':'')+'">'+(j===null?'—':fmt(j))+' <small>h'+(esNoche(hDe,hA)?' 🌙':'')+'</small></div>';
}
function fechaCorta(iso){ const p=String(iso||'').slice(0,10).split('-'); return p.length<3 ? String(iso||'') : p[2]+'/'+p[1]; }
function continuidadHTML(r, inicial){
  const ct=(BAND.continuidad||{})[r.id_registro]; if(!ct || r.estado==='descartado') return '<div class="cont hidden"></div>';
  const p=ct.previo, u=TOPES[r.medidor]?TOPES[r.medidor].unidad:'';
  if(!p) return '<div class="cont">Medidor: sin parte anterior del equipo en los últimos 45 días (nada con qué comparar el inicial).</div>';
  const ini=num(inicial), dif=(ini!==null&&p.final!==null)?Math.round((ini-p.final)*100)/100:null, ok=dif!==null&&Math.abs(dif)<0.001;
  const de='parte '+(p.reporte_num?'nº '+esc(p.reporte_num)+' ':'')+'del '+esc(fechaCorta(p.fecha))+(p.hora_de||p.hora_a?' '+esc(p.hora_de||'?')+'→'+esc(p.hora_a||'?'):'')+(esNoche(p.hora_de,p.hora_a)?' 🌙':'')+' · '+esc(p.estado);
  return '<div class="cont '+(ok?'ok':dif===null?'':'mal')+'">Medidor: el anterior terminó en <b>'+esc(fmt(p.final))+'</b> <small>('+de+')</small> → este inicial <b>'+(ini===null?'—':esc(fmt(ini)))+'</b> '
    +(ok?'<span class="si">✓ empalma</span>':dif===null?'':'<span class="no">✕ '+(dif>0?'salto de +':'retrocede ')+esc(fmt(Math.abs(dif)))+' '+esc(u)+'</span>')+'</div>';
}

/* ---------- D206: selector de centro de coste con buscador ----------
 * Antes era un <select> de ~120 CC ordenados por uso: UF1, UF2 y drenajes mezclados y sin poder escribir. Ahora
 * la lista llega completa del servidor (PARTE_CC + BASE) en orden UF → área → código; aquí se agrupa por esos
 * encabezados, se filtra por UF y se busca escribiendo código («02.03», «2.3») o palabras («terraplen odt»). */
const AREA_TXT={ tierras:'Tierras y otros', odt:'Drenaje transversal (ODT)', odl:'Drenaje longitudinal (ODL)' };
function ccInfo(v){ return (LISTAS.cc||[]).find(c=>c.centro_coste===v)||null; }
function ccEtiqueta(v){ if(!v) return '— elegir centro de coste —'; const c=ccInfo(v); return v+(c&&c.descripcion_cc?' · '+c.descripcion_cc:(c?'':' (no está en la lista)')); }
function ccPickerHTML(v, destino, extra){
  return '<button type="button" class="cc-pick'+(v?'':' vacio')+'" value="'+esc(v||'')+'" data-dest="'+esc(destino)+'"'+(extra||'')+' title="'+esc(ccEtiqueta(v))+'">'+esc(ccEtiqueta(v))+'</button>';
}
// uf/area los manda el Worker; si faltan (backend Apps Script) salen del código, con la misma regla.
function ccUf(c){ return c.pseudo ? '' : (c.uf || ufDe(c.centro_coste)); }
function ccArea(c){ if(c.pseudo) return ''; if(c.area) return c.area; const m=/^37\d\d\.(\d\d)\./.exec(c.centro_coste||''); return !m ? '' : m[1]==='06' ? 'odt' : m[1]==='07' ? 'odl' : 'tierras'; }
function ccHaystack(c){
  const m=/^(\d{4})\.(\d{2})\.(\d{2})$/.exec(c.centro_coste||''), alt=m ? [m[2]+'.'+m[3], (+m[2])+'.'+(+m[3]), m[1]+'.'+(+m[2])+'.'+(+m[3])].join(' ') : '';
  const uf=ccUf(c), ar=ccArea(c);
  return norm([c.centro_coste, alt, c.descripcion_cc, c.capitulo, ar, ar?AREA_TXT[ar]:'', uf?'UF'+uf:'', c.pseudo?'sin operacion':''].join(' '));
}
const CCP={ el:null, btn:null, uf:'', idx:0, vis:[], orden:null, de:null };
// UF → área → código (pseudo-CC al final), aunque el backend mande otro orden: así cada encabezado sale una sola vez.
function ccOrdenados(){
  const l=LISTAS.cc||[]; if(CCP.de===l && CCP.orden) return CCP.orden;
  const oa={ tierras:0, odt:1, odl:2 }, k=c=>[c.pseudo?1:0, ccUf(c)||'9', oa[ccArea(c)]===undefined?3:oa[ccArea(c)], c.pseudo?'':c.centro_coste];
  CCP.orden=l.map((c,i)=>({c:c,i:i,k:k(c)})).sort((a,b)=>{ for(let j=0;j<4;j++){ if(a.k[j]<b.k[j]) return -1; if(a.k[j]>b.k[j]) return 1; } return a.i-b.i; }).map(x=>x.c);
  CCP.de=l; return CCP.orden;
}
function ccPop(){
  if(CCP.el) return CCP.el;
  const el=document.createElement('div'); el.className='cc-pop hidden'; el.setAttribute('role','dialog'); el.setAttribute('aria-label','Elegir centro de coste');
  el.innerHTML='<input type="text" class="cc-q" placeholder="Escribe código o palabra: 02.03 · terraplén · ODT…" aria-label="Buscar centro de coste" autocomplete="off">'
    +'<div class="cc-uf" role="group" aria-label="Unidad funcional"></div><div class="cc-lista" role="listbox"></div>';
  document.body.appendChild(el); CCP.el=el;
  const q=el.querySelector('.cc-q');
  q.addEventListener('input', ()=>{ CCP.idx=0; ccPintar(); });
  q.addEventListener('keydown', ev=>{
    if(ev.key==='ArrowDown'||ev.key==='ArrowUp'){ ev.preventDefault(); if(!CCP.vis.length) return; CCP.idx=(CCP.idx+(ev.key==='ArrowDown'?1:-1)+CCP.vis.length)%CCP.vis.length; ccMarcar(); }
    else if(ev.key==='Enter'){ ev.preventDefault(); if(CCP.vis[CCP.idx]) ccElegir(CCP.vis[CCP.idx].centro_coste); }
    else if(ev.key==='Escape'){ ev.preventDefault(); ccCerrar(true); }
  });
  el.querySelector('.cc-uf').addEventListener('click', ev=>{ const b=ev.target.closest('button[data-uf]'); if(!b) return; CCP.uf=b.dataset.uf; CCP.idx=0; ccPintar(); q.focus(); });
  el.querySelector('.cc-lista').addEventListener('mousedown', ev=>{ const o=ev.target.closest('[data-v]'); if(!o) return; ev.preventDefault(); ccElegir(o.dataset.v); });
  return el;
}
function ccAbrir(btn){
  const el=ccPop(); CCP.btn=btn;
  const v=btn.value, info=ccInfo(v);
  // arranca en la UF del CC actual (lo normal es corregir dentro de la misma UF); «Todas» está a un clic
  CCP.uf = info ? (info.pseudo ? 'sin' : ccUf(info)) : '';
  el.querySelector('.cc-q').value=''; CCP.idx=0; ccPintar(v);
  el.classList.remove('hidden'); ccPosicionar();
  el.querySelector('.cc-q').focus();
}
function ccPosicionar(){
  const el=CCP.el, b=CCP.btn; if(!el||!b) return;
  const r=b.getBoundingClientRect(), vw=document.documentElement.clientWidth, vh=window.innerHeight, w=Math.min(560, vw-16);
  el.style.width=w+'px'; el.style.left=Math.max(8, Math.min(r.left, vw-w-8))+'px';
  const abajo=vh-r.bottom, alto=Math.min(420, Math.max(abajo, r.top)-12);
  el.style.maxHeight=Math.max(220, alto)+'px';
  if(abajo>=260 || abajo>=r.top){ el.style.top=(r.bottom+4)+'px'; el.style.bottom='auto'; } else { el.style.top='auto'; el.style.bottom=(vh-r.top+4)+'px'; }
}
function ccPintar(actual){
  const el=CCP.el, q=norm(el.querySelector('.cc-q').value), toks=q.split(/\s+/).filter(Boolean);
  const todos=ccOrdenados(), ufs=[...new Set(todos.map(ccUf).filter(Boolean))].sort();
  el.querySelector('.cc-uf').innerHTML=[['','Todas']].concat(ufs.map(u=>[u,'UF'+u])).concat([['sin','Sin operación']])
    .map(x=>'<button type="button" data-uf="'+x[0]+'" class="'+(CCP.uf===x[0]?'on':'')+'">'+x[1]+'</button>').join('');
  CCP.vis=todos.filter(c=>{
    if(CCP.uf==='sin' ? !c.pseudo : (CCP.uf && (c.pseudo || ccUf(c)!==CCP.uf))) return false;
    if(!toks.length) return true;
    const h=c._h||(c._h=ccHaystack(c)); return toks.every(t=>h.indexOf(t)>=0);
  });
  const sel=actual!==undefined ? actual : (CCP.btn?CCP.btn.value:'');
  if(actual!==undefined){ const i=CCP.vis.findIndex(c=>c.centro_coste===sel); CCP.idx=i>=0?i:0; }
  let html='', grupo='';
  CCP.vis.forEach((c,i)=>{
    const g=c.pseudo ? 'Sin operación' : (ccUf(c)?'UF'+ccUf(c):'Otros')+' · '+(AREA_TXT[ccArea(c)]||'Otros');
    if(g!==grupo){ grupo=g; html+='<div class="cc-grupo">'+esc(g)+'</div>'; }
    html+='<div class="cc-op'+(i===CCP.idx?' act':'')+(c.centro_coste===sel?' sel':'')+'" role="option" data-v="'+esc(c.centro_coste)+'" data-i="'+i+'">'
      +'<b>'+esc(c.centro_coste)+'</b><span>'+esc(c.descripcion_cc||'')+'</span></div>';
  });
  el.querySelector('.cc-lista').innerHTML = html || '<div class="cc-vacio">Ningún centro de coste coincide'+(CCP.uf?' en este filtro: prueba «Todas»':'')+'.</div>';
  ccMarcar();
}
function ccMarcar(){
  const l=CCP.el.querySelector('.cc-lista');
  l.querySelectorAll('.cc-op.act').forEach(o=>o.classList.remove('act'));
  const o=l.querySelector('.cc-op[data-i="'+CCP.idx+'"]'); if(o){ o.classList.add('act'); o.scrollIntoView({block:'nearest'}); }
}
function ccCerrar(foco){ if(!CCP.el) return; CCP.el.classList.add('hidden'); const b=CCP.btn; CCP.btn=null; if(foco&&b) b.focus(); }
function ccElegir(v){
  const b=CCP.btn; ccCerrar(true); if(!b || b.value===v) return;
  b.value=v; b.textContent=ccEtiqueta(v); b.title=ccEtiqueta(v); b.classList.toggle('vacio', !v);
  const dest=b.dataset.dest||'';
  if(dest.indexOf('fila:')===0) edit(dest.slice(5), b);
  else if(dest==='manual') setUfDesdeCC('m_uf', v);
  else if(dest.indexOf('rep:')===0) setRepartir(+dest.slice(4), 'cc', v);
}
document.addEventListener('click', ev=>{
  const b=ev.target.closest && ev.target.closest('.cc-pick');
  if(b){ if(b.disabled) return; if(CCP.btn===b && !CCP.el.classList.contains('hidden')) ccCerrar(); else ccAbrir(b); return; }
  // un clic en un chip de UF repinta los chips: el botón pulsado ya no está en el DOM y no cuenta como «fuera»
  if(CCP.el && !CCP.el.classList.contains('hidden') && ev.target.isConnected && !CCP.el.contains(ev.target)) ccCerrar();
});
window.addEventListener('resize', ()=>{ if(CCP.btn) ccPosicionar(); });
window.addEventListener('scroll', ()=>{ if(CCP.btn) ccPosicionar(); }, true);
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
    +(esNoche(v('hora_de'),v('hora_a'))?'<span class="badge noche" title="Turno noche (D188): sale al día siguiente; el parte va en el día que EMPIEZA">🌙 turno noche</span>':'')
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
    +'<div class="c"><label>Hora a <span class="mas1'+(esNoche(v('hora_de'),v('hora_a'))?'':' hidden')+'">(+1 día)</span></label>'+inp('hora_a','time')+'</div>'
    +'<div class="c"><label>Jornada</label>'+jornadaHTML(v('hora_de'),v('hora_a'))+'</div>'
    +'<div class="c"><label>Inicial</label>'+inp('inicial','number',' step="0.1"')+'</div>'
    +'<div class="c"><label>Final</label>'+inp('final','number',' step="0.1"')+'</div>'
    +'<div class="c"><label>Total</label><div class="tot '+totCls+'">'+(tot===null?'—':fmt(tot))+' <small>'+unidad+'</small></div></div>'
    +'<div class="c"><label>H. varada</label>'+inp('horas_varada','number',' step="0.5"')+'</div>'
    +'<div class="c"><label>H. lluvia</label>'+inp('horas_lluvia','number',' step="0.5"')+'</div>'
    +'<div class="c"><label>PR</label>'+inp('pr','number')+'</div>'
    +'<div class="c w3"><label>Centro de coste</label>'+ccPickerHTML(v('centro_coste'), 'fila:'+id, ' data-k="centro_coste"'+ro)+'</div>'
    +'<div class="c"><label>UF</label><select data-k="uf"'+ro+on+'>'+['','1','2','3'].map(u=>'<option value="'+u+'"'+(String(v('uf'))===u?' selected':'')+'>'+(u||'—')+'</option>').join('')+'</select></div>'
    +'<div class="c w2"><label>Descripción</label><textarea rows="2" data-k="descripcion_trabajo"'+ro+on+'>'+esc(v('descripcion_trabajo'))+'</textarea></div>'
    +'<div class="c w3"><label>Observaciones</label><textarea rows="2" data-k="observaciones"'+ro+on+'>'+esc(v('observaciones'))+'</textarea></div>'
    +'</div>'
    +continuidadHTML(r, v('inicial'))
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
    const ct=f.querySelector('.cont'); if(ct && k==='inicial') ct.outerHTML=continuidadHTML(r, d.inicial);   // D206: ¿empalma con el anterior?
  }
  if(k==='hora_de'||k==='hora_a'){   // D206: jornada y «(+1 día)» del turno noche al momento
    const r=filaPorId(id)||{}, d=dirty[id], hDe=d.hasOwnProperty('hora_de')?d.hora_de:r.hora_de, hA=d.hasOwnProperty('hora_a')?d.hora_a:r.hora_a;
    const j=f.querySelector('.jor'); if(j) j.outerHTML=jornadaHTML(hDe, hA);
    const m=f.querySelector('.mas1'); if(m) m.classList.toggle('hidden', !esNoche(hDe, hA));
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
  aplicarCambios(d.filas||[], d.continuidad);
  toast(estado==='aprobado'?'Aprobado':estado==='descartado'?'Descartado':estado==='pendiente'?'Reabierto':'Guardado');
}
// mueve las filas devueltas por el servidor entre pendientes/revisadas sin recargar todo
function aplicarCambios(filas, cont){
  BAND.continuidad=Object.assign(BAND.continuidad||{}, cont||{});   // D206: continuidad recalculada por el servidor
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
  const lista=(BAND.pendientes||[]).filter(r=>!alertasDe(r).length && enGrupo(r.codigo));   // D193: solo lo que se ve
  if(!lista.length) return;
  if(!confirm('¿Aprobar '+lista.length+' parte(s) sin alertas de la fecha '+document.getElementById('fecha').value+'?')) return;
  const cambios=lista.map(r=>{ const c={ id_registro:r.id_registro, estado:'aprobado' }; if(dirty[r.id_registro]) c.campos=dirty[r.id_registro]; return c; });
  let d; try{ d=await api(null, { mod:'parte', op:'revisar', cambios:cambios }); }catch(e){ d={ok:false,error:'Sin conexión.'}; }
  if(caducada(d)) return;
  if(!d.ok){ toast(d.error||'No se guardó', true); return; }
  (d.filas||[]).forEach(f=>delete dirty[f.id_registro]);
  aplicarCambios(d.filas||[], d.continuidad);
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
    +'<div class="c w3"><label>Centro de coste</label>'+ccPickerHTML('', 'manual', ' id="m_cc"')+'</div>'
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
      +ccPickerHTML(f.cc, 'rep:'+j, '')
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
  // D197: con la Base visible se recarga (cargarBase pregunta si hay otros cambios sin guardar); oculta, se invalida.
  if(BASE && BASE.filas.some(x=>x.id_registro===id)){ if(!document.getElementById('vistaBase').classList.contains('hidden')) cargarBase(); else BASE=null; }
  aplicarCambios([d.original].concat(d.filas||[]), d.continuidad);
  toast('Repartida en '+(d.filas||[]).length+' filas (pendientes); la original quedó descartada');
}

/* ================= BASE =================
 * D197: cuadrícula tipo Excel (cuadricula.js), el mismo manejo que la Revisión de DATA. Se edita en la celda y los
 * cambios quedan PENDIENTES (en azul) hasta «Guardar», que los manda en UN op:'revisar' (el servidor ya aceptaba
 * lotes). Descartar / volver a aprobar también quedan pendientes (estado en el mismo lote) y se deshacen con Ctrl+Z.
 * Repartir sigue siendo el modal de D178 (clic derecho). «Copiar para Excel» copia las APROBADAS visibles B → AR con
 * la misma regla que parteExcelFila_ del backend (excelFilaLocal), así que lo filtrado es lo que se copia. */
let GB=null;          // la cuadrícula de la Base
function fmtMed(v){ return v==='HOROMETRO'?'Horómetro':v==='KM'?'Km':(v||''); }
function totalAlto(r){ const t=num(r.total), tp=TOPES[r.medidor]; return t!==null && tp && t>tp.alerta; }
const COLS_BASE=[
  { k:'fecha',               etiqueta:'Fecha',        tipo:'fecha', edita:true, ancho:92 },
  { k:'reporte_num',         etiqueta:'Parte',        edita:true, ancho:64, ayuda:'Nº del parte físico' },
  { k:'codigo',              etiqueta:'Equipo',       ancho:76 },
  { k:'tipo',                etiqueta:'Tipo',         ancho:130 },
  { k:'medidor',             etiqueta:'Medidor',      ancho:80, fmt:fmtMed },
  { k:'inicial',             etiqueta:'Inicial',      tipo:'num', edita:true, ancho:78, dec:1, miles:false },
  { k:'final',               etiqueta:'Final',        tipo:'num', edita:true, ancho:78, dec:1, miles:false },
  { k:'total',               etiqueta:'Total',        tipo:'num', ancho:62, ayuda:'Final − inicial (lo calcula el sistema)', clase:function(r){ return totalAlto(r)?'b-alto':''; } },
  { k:'horas_varada',        etiqueta:'Varada',       tipo:'num', edita:true, ancho:60 },
  { k:'horas_lluvia',        etiqueta:'Lluvia',       tipo:'num', edita:true, ancho:60 },
  { k:'hora_de',             etiqueta:'De',           tipo:'hora', edita:true, ancho:60 },
  { k:'hora_a',              etiqueta:'A',            tipo:'hora', edita:true, ancho:60 },
  { k:'descripcion_trabajo', etiqueta:'Descripción',  edita:true, ancho:220 },
  { k:'centro_coste',        etiqueta:'CC',           tipo:'lista', edita:true, ancho:104, ayuda:'Centro de coste (al cambiarlo, la UF sale del CC)',
    opciones:function(){ return (LISTAS.cc||[]).map(function(c){ return { v:c.centro_coste, t:c.descripcion_cc||c.centro_coste }; }); } },
  { k:'pr',                  etiqueta:'PR',           tipo:'num', edita:true, ancho:50, miles:false },
  { k:'uf',                  etiqueta:'UF',           tipo:'lista', edita:true, ancho:44, opciones:['','1','2','3'] },
  { k:'operador',            etiqueta:'Operador',     tipo:'lista', edita:true, ancho:150,
    opciones:function(){ return ['Sin operador'].concat(LISTAS.operadores||[]); } },
  { k:'observaciones',       etiqueta:'Observaciones', edita:true, ancho:180 },
  { k:'alertas',             etiqueta:'Alertas',      ancho:130, fmt:function(v){ return alertasDe({alertas:v}).join(' · '); }, clase:function(r){ return alertasDe(r).length?'b-alerta':''; } },
  { k:'estado',              etiqueta:'Estado',       ancho:96, fmt:function(v,r){ return r._accion==='descartar'?'→ descartar':r._accion==='aprobar'?'→ aprobar':v; } },
  { k:'revisado_por',        etiqueta:'Revisó',       ancho:96, fmt:function(v,r){ return String(v||'')+(r.origen==='manual'?' · manual':''); } },
];
function montarBase(){
  if(GB) return;
  GB=TM2Cuadricula.crear({
    wrap:document.getElementById('gridBase'), filtrosEl:document.getElementById('filtrosBase'), buscarEl:document.getElementById('qBase'),
    columnas:COLS_BASE, clave:'id_registro', puedeEditar:PUEDE_EDITAR_BASE, colDia:'fecha', almacen:'tm2_base', decimalComa:true,
    textoVacio:'Elige un rango y pulsa Consultar.',
    filtros:[ { k:'fecha', t:'Fecha', todas:'Todas' }, { k:'codigo', t:'Equipo' }, { k:'tipo', t:'Tipo' }, { k:'centro_coste', t:'CC' },
              { k:'operador', t:'Operador' }, { k:'uf', t:'UF', todas:'Todas' }, { k:'estado', t:'Estado' } ],
    filtroExtra:function(r){ return enGrupo(r.codigo); },                       // D193: Todos / Tierras / Drenajes
    buscarMas:function(r){ return r.alertas+' '+r.origen; },
    claseFila:function(r){ return [r.estado!=='aprobado'?'b-no-aprob':'', r._accion==='descartar'?'b-descartar':''].filter(Boolean).join(' '); },
    alCambiar:function(r,k){
      if(k==='inicial'||k==='final'){ const i=num(r.inicial), f=num(r.final); r.total=(i!==null&&f!==null)?Math.round((f-i)*100)/100:''; }
      if(k==='centro_coste') r.uf=ufDe(r.centro_coste);                         // igual que el servidor si no se toca la UF
    },
    alPintar:kpisBase, alCambiarDirty:dirtyBase, aviso:toast,
    menu:menuBase,
    teclas:function(ev){ const ctrl=ev.ctrlKey||ev.metaKey; if(ctrl && (ev.key==='-'||ev.key==='_')){ marcarAccion('descartar'); return true; } return false; },
  });
}
function kpisBase(vis){
  const tot=BASE?BASE.filas.length:0; let h=0, km=0;
  vis.forEach(function(r){ const t=num(r.total); if(t===null) return; if(r.medidor==='KM') km+=t; else if(r.medidor==='HOROMETRO') h+=t; });
  document.getElementById('kBase').textContent=tot; document.getElementById('kBaseF').textContent=vis.length;
  document.getElementById('kBaseEq').textContent=new Set(vis.map(function(r){ return r.codigo; })).size;
  document.getElementById('kBaseH').textContent=fmt(h); document.getElementById('kBaseKm').textContent=fmt(km);
  document.getElementById('btnCopiar').disabled=!vis.some(function(r){ return r.estado==='aprobado'; });
}
function dirtyBase(n){
  document.getElementById('nBase').textContent=n; document.getElementById('btnGuardarBase').disabled=!n;
  try{ if(window.parent!==window) window.parent.postMessage({tm2:'dirty', page:'revision', n:n}, location.origin); }catch(e){}   // D198: punto del Hub
  if(GB){ document.getElementById('bUndo').disabled=!GB.puedeDeshacer(); document.getElementById('bRedo').disabled=!GB.puedeRehacer(); }
}
function deshacerBase(){ if(GB) GB.deshacer(); }
function rehacerBase(){ if(GB) GB.rehacer(); }
// Descartar / volver a aprobar: quedan pendientes hasta Guardar (un solo Ctrl+Z las quita).
function marcarAccion(accion, lista){
  if(!ES_REVISOR){ toast('Descartar o volver a aprobar lo hace quien revisa los partes.', true); return; }   // D198
  const sel=(lista||GB.marcadas()).filter(function(r){ return accion==='descartar' ? r.estado!=='descartado' : r.estado!=='aprobado'; });
  if(!sel.length){ toast(accion==='descartar'?'Marca las filas a descartar.':'Marca las filas a volver a aprobar.', true); return; }
  GB.pushUndo(); sel.forEach(function(r){ r._accion=accion; delete r._error; }); GB.pintar();
  toast((accion==='descartar'?'Se descartarán ':'Se aprobarán ')+sel.length+' fila(s) al pulsar Guardar (Ctrl+Z para deshacer).');
}
function menuBase(sel, row){
  const n=sel.length, txt=n===1?'fila':(n+' filas'), items=[];
  if(!ES_REVISOR){ const al=row?alertasDe(row):[]; return al.length ? [{ t:'¿Qué significan sus alertas?', fn:function(){ toast(al.map(function(a){ return a+': '+(ALERTA_TXT[a]||a); }).join(' · ')); } }] : []; }
  const conCambios=row && GB.pendientes().indexOf(row)>=0;
  items.push({ t:'Repartir en varios CC…', fn:function(){ abrirRepartir(row.id_registro); },
    deshabilitado: n!==1 ? 'Marca una sola fila' : conCambios ? 'Guarda primero los cambios de esta fila' : row.estado==='descartado' ? 'La fila está descartada' : '' });
  if(sel.some(function(r){ return r.estado!=='descartado' && r._accion!=='descartar'; })) items.push({ t:'Descartar '+txt, atajo:'Ctrl + −', peligro:true, fn:function(){ marcarAccion('descartar', sel); } });
  if(sel.some(function(r){ return r.estado!=='aprobado' && r._accion!=='aprobar'; })) items.push({ t:'Volver a aprobar '+txt, fn:function(){ marcarAccion('aprobar', sel); } });
  if(sel.some(function(r){ return r._accion; })) items.push({ t:'Quitar la marca de descartar/aprobar', fn:function(){ GB.pushUndo(); sel.forEach(function(r){ delete r._accion; }); GB.pintar(); } });
  const al=row ? alertasDe(row) : [];
  if(al.length) items.push({ t:'¿Qué significan sus alertas?', fn:function(){ toast(al.map(function(a){ return a+': '+(ALERTA_TXT[a]||a); }).join(' · ')); } });
  return items;
}
async function cargarBase(){
  const desde=document.getElementById('desde').value, hasta=document.getElementById('hasta').value;
  if(!desde||!hasta){ toast('Elige desde y hasta', true); return; }
  if(GB && GB.pendientes().length && !confirm('Hay cambios sin guardar en la Base. ¿Descartarlos y volver a consultar?')) return;
  montarBase(); pintarRapidosBase();
  let d; try{ d=await api(API+'&op=base&desde='+desde+'&hasta='+hasta+'&estado='+document.getElementById('fEstado').value); }catch(e){ d={ok:false,error:'Sin conexión.'}; }
  if(caducada(d)) return;
  if(!d.ok){ toast(d.error||'No se pudo consultar', true); return; }
  BASE=d; if(d.listas) LISTAS=Object.assign({}, LISTAS, d.listas);
  GB.cargar(d.filas||[]); ajustarAltoBase();
}
// D198: la cuadrícula ocupa el alto que queda en la ventana (sin scroll de página), como DATA.
function ajustarAltoBase(){
  const g=document.getElementById('gridBase'); if(!g || document.getElementById('vistaBase').classList.contains('hidden')) return;
  const top=g.getBoundingClientRect().top + window.scrollY, pie=EMBED ? 10 : 58;
  g.style.height=Math.max(260, Math.round(window.innerHeight - top - pie))+'px';
}
window.addEventListener('resize', ajustarAltoBase);
function pintarBase(){ if(GB) GB.pintar(); }          // D193: cambiar Todos/Tierras/Drenajes repinta
async function guardarBase(){
  if(!GB) return; if(GB.editando()) GB.cerrarEditor();
  const m={};
  GB.cambios().forEach(function(x){
    if('centro_coste' in x.campos) x.campos.uf=x.fila.uf;          // la UF que se ve (el servidor la re-derivaría del CC)
    m[x.fila.id_registro]={ id_registro:x.fila.id_registro, campos:x.campos }; });
  GB.filas().forEach(function(r){ if(!r._accion) return; const o=m[r.id_registro]||(m[r.id_registro]={ id_registro:r.id_registro }); o.estado=(r._accion==='descartar'?'descartado':'aprobado'); });
  const cambios=Object.keys(m).map(function(k){ return m[k]; });
  if(!cambios.length){ toast('No hay cambios que guardar.'); return; }
  const nDesc=cambios.filter(function(c){ return c.estado==='descartado'; }).length;
  if(nDesc && !confirm('Se van a DESCARTAR '+nDesc+' fila(s) de la Base (dejan de ir al Excel). ¿Seguir?')) return;
  const b=document.getElementById('btnGuardarBase'); b.disabled=true;
  let d; try{ d=await api(null, { mod:'parte', op:'revisar', cambios:cambios }); }catch(e){ d={ok:false,error:'Sin conexión.'}; }
  if(caducada(d)) return;
  if(!d.ok){ b.disabled=false; toast(d.error||'No se guardó', true); return; }
  const nuevas=d.filas||[];
  nuevas.forEach(function(nf){ const i=BASE.filas.findIndex(function(x){ return x.id_registro===nf.id_registro; }); if(i>=0) BASE.filas[i]=nf; });
  GB.reemplazar(nuevas);                                        // lo guardado deja de estar pendiente
  const errs=d.errores||[];
  if(errs.length){
    const porId={}; errs.forEach(function(e){ porId[e.id_registro]=e.error; });
    GB.filas().forEach(function(r){ if(porId[r.id_registro]) r._error=porId[r.id_registro]; }); GB.pintar();
    toast('Guardadas '+nuevas.length+'; '+errs.length+' no se aplicaron (marcadas con ⚠, pasa el ratón por el número): '+errs.slice(0,2).map(function(e){ return e.error; }).join('; '), true);
  } else toast('Guardadas '+nuevas.length+' fila(s).');
}
// misma regla que parteExcelFila_ del backend (se calcula con lo que se ve, por eso se bloquea con cambios sin guardar)
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
  if(!GB || !BASE){ toast('Consulta la Base primero.', true); return; }
  if(GB.pendientes().length){ toast('Hay cambios sin guardar: guárdalos (o deshazlos) antes de copiar para Excel.', true); return; }
  const lista=GB.visibles().filter(function(r){ return r.estado==='aprobado'; }); if(!lista.length) return;
  const cols=BASE.excel.columnas;
  const tsv=lista.map(r=>excelFilaLocal(r).map((v,j)=>celdaExcel(cols[j],v)).join('\t')).join('\n');
  const ok=()=>{ const o=btn.innerHTML; btn.classList.add('copied'); btn.innerHTML='✓ Copiado ('+lista.length+' filas, B→AR)'; setTimeout(()=>{btn.classList.remove('copied');btn.innerHTML=o;},2200); };
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tsv).then(ok).catch(()=>fallbackCopiar(tsv,ok)); else fallbackCopiar(tsv,ok);
}
function fallbackCopiar(text, ok){
  const ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.top='-1000px'; ta.style.opacity='0';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try{ document.execCommand('copy'); ok(); }catch(e){ alert('No se pudo copiar automáticamente.'); }
  document.body.removeChild(ta);
}
/* Rangos rápidos (D196/D197): Hoy · Ayer · Esta semana · 7 días · acta actual · acta anterior (16→15). */
function isoMenosB(iso, n){ const d=new Date(iso+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()-n); return d.toISOString().slice(0,10); }
function rangosBase(){
  const h=hoy(), y=+h.slice(0,4), mo=+h.slice(5,7), di=+h.slice(8,10);
  const fin=new Date(Date.UTC(y,mo-1,15)); let ini=new Date(Date.UTC(y,mo-2,16));
  if(di>=16){ ini=new Date(Date.UTC(y,mo-1,16)); fin.setUTCMonth(fin.getUTCMonth()+1); }
  const iso=function(x){ return x.toISOString().slice(0,10); }, p={ desde:iso(ini), hasta:iso(fin) };
  const finAnt=isoMenosB(p.desde,1), md=new Date(finAnt+'T12:00:00Z'); md.setUTCMonth(md.getUTCMonth()-1);
  const acta=function(hasta){ return (+hasta.slice(0,4)-2025)*12 + +hasta.slice(5,7) + 2; };
  const dow=(new Date(h+'T12:00:00Z').getUTCDay()+6)%7;
  return [ { t:'Hoy', d:h, a:h }, { t:'Ayer', d:isoMenosB(h,1), a:isoMenosB(h,1) }, { t:'Esta semana', d:isoMenosB(h,dow), a:h },
           { t:'7 días', d:isoMenosB(h,6), a:h }, { t:'Acta '+acta(p.hasta), d:p.desde, a:p.hasta }, { t:'Acta '+acta(finAnt), d:md.toISOString().slice(0,8)+'16', a:finAnt } ];
}
function pintarRapidosBase(){
  const box=document.getElementById('rapidosBase'); if(!box) return;
  const d=document.getElementById('desde').value, a=document.getElementById('hasta').value;
  box.innerHTML=rangosBase().map(function(x){ return '<button type="button" class="chip'+(x.d===d&&x.a===a?' on':'')+'" data-d="'+esc(x.d)+'" data-h="'+esc(x.a)+'" title="'+esc(x.d+' → '+x.a)+'">'+esc(x.t)+'</button>'; }).join('');
}
(function(){
  const box=document.getElementById('rapidosBase'); if(!box) return;
  box.addEventListener('click', function(ev){ const b=ev.target.closest && ev.target.closest('button[data-d]'); if(!b) return;
    document.getElementById('desde').value=b.dataset.d; document.getElementById('hasta').value=b.dataset.h; cargarBase(); });
  ['desde','hasta'].forEach(function(id){ document.getElementById(id).addEventListener('change', function(){
    const de=document.getElementById('desde'), ha=document.getElementById('hasta'); if(id==='desde' && ha.value && de.value>ha.value) ha.value=de.value; pintarRapidosBase(); }); });
})();
window.addEventListener('beforeunload', function(e){ if(GB && GB.pendientes().length){ e.preventDefault(); e.returnValue=''; } });

/* ---------- arranque ---------- */
(function(){
  const h=hoy(); document.getElementById('fecha').value=h;
  const d=new Date(h+'T12:00:00'); d.setDate(d.getDate()-7);
  document.getElementById('desde').value=d.toISOString().slice(0,10); document.getElementById('hasta').value=h;
  document.getElementById('fecha').addEventListener('change', cargarBandeja);
  pintarSegGrupo();   // D193
  const qd=QS.get('desde'), qh=QS.get('hasta');                                    // D198: rango que manda el Hub
  if(qd && /^\d{4}-\d{2}-\d{2}$/.test(qd)){ document.getElementById('desde').value=qd; document.getElementById('hasta').value=(qh && /^\d{4}-\d{2}-\d{2}$/.test(qh))?qh:qd; }
  pintarRapidosBase();   // D197
  if(!PUEDE_EDITAR_BASE){ ['btnGuardarBase','bUndo','bRedo'].forEach(function(id){ const b=document.getElementById(id); if(b) b.classList.add('hidden'); }); }
  if(!ES_REVISOR){ const fe=document.getElementById('fEstado'); if(fe){ fe.value='aprobado'; fe.classList.add('hidden'); } }   // D198: el jefe ve solo aprobados
  if(SOLO_BASE){
    ['tabPend','vistaPend'].forEach(function(id){ document.getElementById(id).classList.add('hidden'); });
    // Solo hay una pestaña: la barra de pestañas sobra y el Todos/Tierras/Drenajes sube a la barra de la Base.
    const seg=document.getElementById('segGrupo'), barra=document.querySelector('#vistaBase .cq-barra');
    if(seg && barra){ barra.insertBefore(seg, barra.firstChild); seg.classList.add('en-barra'); document.querySelector('.tabs').classList.add('hidden'); }
    verTab('base');
  }
  else cargarBandeja();
})();

// D170: antes eran expresiones en línea en el marcado; la CSP ya no las admite.
function cerrarModalFondo(ev, el){ if(ev.target===el) cerrarModal(); }
function setUfDesdeCC(idUf, cc){ document.getElementById(idUf).value=ufDe(cc); }
