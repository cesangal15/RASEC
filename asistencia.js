// D170: aplica los data-estilo del marcado ANTES de que corra la lógica de la pantalla (ver tema.js).
if(window.TM2Estilos) TM2Estilos.aplicar();
const APPS_SCRIPT_URL = GALCA_ENV.url.asistencias;   // entorno.js (D168): producción o prueba

let STATE = { usuario:'', rol:'', fecha:'', cuadrillas:[], cuadrillaActual:'', personas:[], bloques:[],
  config:{}, festivos:[], jornada:{}, catCC:[], catCCUsados:[], catMotivos:[], recientesCC:{}, turnos:[], nota:'', nextBloqueId:1, enviando:false };

window.onload = function(){
  // D82: sesión en localStorage (sobrevive cierre del navegador en zona muerta)
  const rol=localStorage.getItem('rol'), usuario=localStorage.getItem('usuario');
  if(!rol || !usuario){ window.location.href='index.html'; return; }
  STATE.usuario=usuario; STATE.rol=rol;
  document.getElementById('userDisplay').textContent=usuario;
  if(rol==='admin'){ document.getElementById('btnMenu').style.display='inline-block'; }
  else { document.getElementById('btnSeleccion').style.display='inline-block'; }
  STATE.fecha=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
  cargarRoster();
};
function logout(){
  // solo la sesión: la cola de envíos pendientes NO se borra al cerrar sesión (D82)
  localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token');
  window.location.href='index.html';
}

function pid(p){ return p._pid; }

/* ---------- CAPATAZ: CC propio de supervisión (no va a bloques de actividad) ----------
 * Corrección jul-2026 (extiende D72f): el capataz NO se asigna a un bloque/CC de actividad — tiene su
 * CENTRO DE COSTO PROPIO de supervisión ("37xx.I010305| ENCARGADOS, INSPECTORES Y CAPATACES"),
 * independiente de la actividad de su gente. Basta con marcarlo PRESENTE: el sistema le pone su CC
 * automáticamente. Se identifica por el campo `cargo` (contiene "capataz"; lo llena el residente en
 * PERSONAL). Por eso el capataz se excluye de la lista de miembros de los bloques y de los avisos de
 * "sin asignar". El PREFIJO de proyecto (3701/3702) sale de la UF MAYORITARIA de su cuadrilla ese día. */
const CC_CAPATAZ_SUFIJO_DEFAULT='I010305| ENCARGADOS, INSPECTORES Y CAPATACES';
function ncargo(s){ return String(s==null?'':s).trim().toLowerCase(); }
function esCapataz(p){ return /capataz|capataces/.test(ncargo(p&&p.cargo)); }
// Sufijo del CC del capataz: configurable por CONFIG.cc_capataz (por si el string Navision cambia);
// si no está, el valor por defecto de arriba (no exige redeploy del Apps Script).
function ccCapatazSufijo(){ const c=STATE.config&&STATE.config.cc_capataz; return c?String(c).trim():CC_CAPATAZ_SUFIJO_DEFAULT; }
// D101: prefijos de proyecto DISPONIBLES para quien reporta, derivados de sus propios centros de costo
// (CC_USADOS del área; si no hay, el catálogo completo). Nada cableado: un área nueva con CC `37xx.`
// aparece sola. Devuelve algo como ['3701','3702'] en tierras y ['3703'] en UF3, ordenado.
function proyectosDisponibles(){
  const set={};
  poolCCdelArea().forEach(cc=>{ const p=proyectoFromCC(cc); if(p) set[p]=true; });
  return Object.keys(set).sort();
}
// D101 — CORRECCIÓN: de dónde salen los CC de quien reporta. Primero los frecuentes de SU área
// (`CC_USADOS`, ya filtrados por el backend). Si esa lista viene vacía, el respaldo histórico era el
// catálogo global `CAT_CC`… que solo tiene CC de TIERRAS (3701/3702). Para un usuario con área forzada
// (residente de UF3, de drenajes, jeisson) ese respaldo es sencillamente ERRÓNEO: le ofrecía UF1/UF2 y
// le ponía al capataz un CC con prefijo 3701. Ahora el respaldo global aplica SOLO a quien no tiene
// área forzada (capataces de tierras, mairy, admin), que es para quien se escribió.
function tieneAreaForzada(){ return !!(STATE.areasUsuario && STATE.areasUsuario.length); }
// Respaldo de `areas` cuando la respuesta del Apps Script no lo trae (backend sin redesplegar): el
// login guarda el campo `areas` del usuario en localStorage (D84).
function areasDelLogin(){
  try{ const a=JSON.parse(localStorage.getItem('areas')||'[]'); return Array.isArray(a)?a:[]; }catch(e){ return []; }
}
function poolCCdelArea(){
  const usados=(STATE.catCCUsados||[]);
  if(usados.length) return usados;
  return tieneAreaForzada() ? [] : (STATE.catCC||[]);
}
// Etiqueta legible de una UF: 3701→UF1, 3702→UF2, 3703→UF3. Es SOLO cosmética; un prefijo desconocido
// se muestra tal cual (no filtra ni bloquea nada).
function etiquetaUF(p){ const n=String(p).slice(-2); return /^0\d$/.test(n) ? 'UF'+Number(n) : ''; }
// Prefijo (37xx) por MAYORÍA de UF de los presentes asignados a bloques de la cuadrilla (D72f).
// Sin bloques con UF, cae al proyecto del CC más reciente de la cuadrilla; si tampoco, al PRIMER
// proyecto de los CC del área de quien reporta (D101: ya no cae a 3701, que dejaría al capataz de UF3
// —o de cualquier área futura— con el proyecto de tierras).
function prefijoCapataz(){
  const conteo={};
  personasCuadrilla().forEach(p=>{
    if(!p.presente || esCapataz(p)) return;
    const b=STATE.bloques.find(x=>x.id===p.bloqueId);
    const uf=b&&b.uf?b.uf:'';
    if(uf) conteo[uf]=(conteo[uf]||0)+1;
  });
  let best='', bestN=0;
  Object.keys(conteo).forEach(uf=>{ if(conteo[uf]>bestN){ bestN=conteo[uf]; best=uf; } });
  if(best) return best;
  const rec=(STATE.recientesCC&&STATE.recientesCC[STATE.cuadrillaActual])||[];
  for(let i=0;i<rec.length;i++){ const pr=proyectoFromCC(rec[i]); if(pr) return pr; }
  return proyectosDisponibles()[0] || '';
}
// D101: sin prefijo determinable (área sin CC cargados) devuelve '' en vez de un CC roto tipo
// ".I010305| …". Un capataz presente sin CC cae en "sin reportar" del resumen, que es justo lo que
// debe pasar: se ve el hueco y se corrige, en vez de mandar a Navision un proyecto inventado.
function ccCapataz(){ const pr=prefijoCapataz(); return pr ? (pr+'.'+ccCapatazSufijo()) : ''; }

async function cargarRoster(){
  document.getElementById('container').innerHTML='<div class="loading">⏳ Cargando roster…</div>';
  try{
    // D82 §2.7: roster con caché-fallback POR USUARIO. Fresco si hay señal (y guarda copia local);
    // sin señal usa el último roster guardado con aviso de fecha (un roster de ayer es aceptable:
    // el residente corrige después). Sin señal y sin copia: mensaje de abrir con señal una vez.
    const rc=await TM2Offline.catalogoCache('roster_'+STATE.usuario, async function(){
      const url=`${APPS_SCRIPT_URL}?action=roster&usuario=${encodeURIComponent(STATE.usuario)}&fecha=${STATE.fecha}`;
      const resp=await fetch(url); const d=await resp.json();
      if(!d.ok) throw new Error(d.error||'roster');
      return d;
    }, 48);
    const data=rc.data;
    STATE.rosterViejo=!rc.fresco; STATE.rosterGuardado=rc.guardado;
    STATE.cuadrillas=data.cuadrillas||[];
    // D119: área de cada cuadrilla, para etiquetarlas en el selector. Un backend anterior al redespliegue
    // no manda el campo: se queda vacío y el selector sale plano, como hasta ahora.
    STATE.cuadrillasArea=data.cuadrillasArea||{};
    STATE.cuadrillaActual=STATE.cuadrillas[0]||'';
    STATE.config=data.config||{}; STATE.festivos=data.festivos||[]; STATE.jornada=data.jornada||{};
    // D77: domingo/festivo con horario típico pre-llenado (07:00–15:00; 8h − 1h almuerzo = 7h Dom/Fest,
    // confirmado por el dueño jul-2026). Configurable en CONFIG.entrada_dom/salida_dom; si el Apps Script
    // aún no manda horas para domfest (backend viejo), este default del cliente cubre sin redeploy.
    if(STATE.jornada.tipo==='domfest' && !STATE.jornada.entrada){
      STATE.jornada.entrada=STATE.config.entrada_dom||'07:00';
      STATE.jornada.salida=STATE.config.salida_dom||'15:00';
    }
    STATE.catCC=data.catCC||[]; STATE.catCCUsados=data.catCCUsados||[]; STATE.catMotivos=data.catMotivos||[]; STATE.recientesCC=data.recientesCC||{};
    // D101: [] = sin área forzada (capataces/mairy/admin). Si el Apps Script AÚN NO se redesplegó,
    // `data.areas` no existe: se cae a las `areas` que el login guardó en localStorage (index.html ya
    // las escribe para residente_uf3 y los capataces de drenajes). Así, subir el frontend antes que el
    // backend no revive el bug de ofrecerle los CC de tierras a la residente de UF3.
    STATE.areasUsuario=data.areas||areasDelLogin();
    // D72: catálogo de turnos para pre-llenar horas. Normaliza a HH:MM con cero (una hora "7:00" sin
    // cero deja en blanco el <input type=time>, por eso la hora AM no se pre-llenaba).
    STATE.turnos=(data.turnos||[]).map(t=>({ ...t, entrada:padHM(t.entrada), salida:padHM(t.salida) }));
    STATE.personas=(data.personas||[]).map((p,i)=>({ _pid:i, cedula:p.cedula, codigo:p.codigo, nombre:p.nombre,
      cargo:p.cargo, cuadrilla:p.cuadrilla, presente:true, motivo:'',
      hora_entrada: STATE.jornada.entrada||'', hora_salida: STATE.jornada.salida||'',
      hora_entrada_ov:null, hora_salida_ov:null, bloqueId:null }));
    STATE.bloques=[];
    render();
  }catch(err){
    document.getElementById('container').innerHTML='<div class="empty-state">⚠️ No se pudo cargar el roster. Revisa la conexión o el Apps Script.<br>Si estás sin señal: abre esta pantalla con señal al menos una vez para guardar una copia del roster en el teléfono.<br><small>'+esc(err.message||err)+'</small></div>';
  }
}

/* D106 — la fecha del reporte NUNCA puede quedar vacía. Un <input type="date"> devuelve '' cuando se
 * borra el campo o se teclea un día a medias, y hasta ahora ese '' se guardaba en STATE.fecha y viajaba
 * al backend: la cuadrilla entera se escribía en ASISTENCIA con la columna `fecha` en blanco, invisible
 * para el resumen y para el Parte. Las capturas de OBRA (capataz/chequeadora/drenajes) ya validaban
 * esto antes de enviar; asistencias era la única que no. */
function fechaValida(v){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))) return false;
  const p=String(v).split('-'), dt=new Date(Number(p[0]), Number(p[1])-1, Number(p[2]));
  return dt.getFullYear()===Number(p[0]) && dt.getMonth()===Number(p[1])-1 && dt.getDate()===Number(p[2]);
}
function onFechaChange(v){
  if(!fechaValida(v)){
    // Se conserva la fecha anterior y se repinta: el campo vuelve solo al día que estaba puesto.
    alert('⚠️ La fecha quedó vacía o incompleta.\n\nSe mantiene el ' + STATE.fecha + '. Elige el día en el calendario antes de reportar.');
    render();
    return;
  }
  STATE.fecha=v;
  // recalcula jornada estándar del día en cliente (mismo criterio que el backend: L-V/sábado/dom-fest)
  const d=v.split('-'); const dt=new Date(Number(d[0]),Number(d[1])-1,Number(d[2])); const dow=dt.getDay();
  const cfg=STATE.config, festivo=STATE.festivos.indexOf(v)>=0;
  // D77: domfest con horario típico 07:00–15:00 pre-llenado (8h − 1h almuerzo = 7h Dom/Fest).
  if(festivo || dow===0) STATE.jornada={tipo:'domfest', entrada:cfg.entrada_dom||'07:00', salida:cfg.salida_dom||'15:00', tope:parseFloat(cfg.ord_domingo)||0};
  else if(dow===6) STATE.jornada={tipo:'sabado', entrada:cfg.entrada_sab||'07:00', salida:cfg.salida_sab||'11:30', tope:parseFloat(cfg.ord_sabado)||4.5};
  else STATE.jornada={tipo:'lv', entrada:cfg.entrada_lv||'07:00', salida:cfg.salida_lv||'15:30', tope:parseFloat(cfg.ord_lun_vie)||7.5};
  render();
}
function onCuadrillaChange(v){ STATE.cuadrillaActual=v; render(); }

function personasCuadrilla(){ return STATE.personas.filter(p=>p.cuadrilla===STATE.cuadrillaActual); }

function togglePresente(i, checked){
  const p=STATE.personas[i];
  p.presente=checked;
  if(checked){ p.motivo=''; }
  else { p.bloqueId=null; }
  render();
}
function setMotivo(i, v){ STATE.personas[i].motivo=v; }

function agregarBloque(){
  // D72: turno por defecto = 1 (diurno). Sus horas coinciden con la jornada estándar; si TURNOS no
  // está cargada, cae a la jornada del día.
  const t1=turnoHoras('1', STATE.fecha);
  // D101: si el área de quien reporta tiene UN SOLO proyecto (UF3 → 3703), el bloque nace con esa UF
  // elegida y la lista de CC aparece de una: nadie debería elegir "UF3" en un desplegable de una opción.
  // Con varias (tierras: 3701/3702) se mantiene el "Elegir UF…" de siempre.
  const ufs=proyectosDisponibles();
  const ufIni = ufs.length===1 ? ufs[0] : '';
  STATE.bloques.push({ id:STATE.nextBloqueId++, cc:'', proyecto:'', uf:ufIni, cuadrilla:STATE.cuadrillaActual, turno:'1',
    hora_entrada:(t1?t1.entrada:STATE.jornada.entrada)||'', hora_salida:(t1?t1.salida:STATE.jornada.salida)||'', ccQuery:'', ccAbierto:false });
  render();
}
// D72: al cambiar el turno del bloque, se pre-llenan sus horas de entrada/salida (captura cruda: se
// pueden ajustar luego). El override por persona sigue disponible para excepciones dentro del bloque.
function bloqueTurnoChange(bid, v){
  const b=STATE.bloques.find(x=>x.id===bid); if(!b) return;
  b.turno=v; const t=turnoHoras(v, STATE.fecha);
  if(t){ b.hora_entrada=t.entrada; b.hora_salida=t.salida; }
  render();
}
function quitarBloque(id){
  STATE.personas.forEach(p=>{ if(p.bloqueId===id) p.bloqueId=null; });
  STATE.bloques=STATE.bloques.filter(b=>b.id!==id);
  render();
}
function proyectoFromCC(cc){ const m=String(cc||'').match(/^(\d{4})/); return m?m[1]:''; }

/* ---------- TURNOS (D72): pre-llenan la hora de entrada/salida por bloque ----------
 * Cada turno tiene variantes por tipo de día (lv=L-V, lj=L-J, viernes, sabado). Se elige la fila que
 * mejor calza con la fecha del reporte. En domingo/festivo NO se pre-llena (jornada 0h, revisión manual).
 * La captura sigue siendo CRUDA (D69b): el turno solo rellena; el usuario puede ajustar. */
// Normaliza "H:MM"/"HH:MM" a "HH:MM" con cero a la izquierda (requisito del <input type=time>).
function padHM(s){ const m=String(s==null?'':s).trim().match(/(\d{1,2}):(\d{2})/); return m?('0'+m[1]).slice(-2)+':'+m[2]:String(s||''); }
function diaTipoTurno(fecha){
  const d=String(fecha||'').split('-'); if(d.length<3) return 'lj';
  const dow=new Date(Number(d[0]),Number(d[1])-1,Number(d[2])).getDay();
  if(dow===6) return 'sabado'; if(dow===5) return 'viernes'; if(dow===0) return 'domingo'; return 'lj';
}
// Fila de TURNOS que aplica a (turno, fecha), respetando la preferencia por día. null si no hay match.
// D77: en sábado, un turno SIN variante de sábado usa su horario de semana (lj/lv) — el turno no deja
// de existir el sábado, solo que (aún) no tiene horario propio ese día. Antes caía a cand[0] por azar.
function turnoHoras(turno, fecha){
  if(STATE.jornada && STATE.jornada.tipo==='domfest') return null;  // domingo/festivo: sin pre-llenado
  const cand=STATE.turnos.filter(t=>String(t.turno)===String(turno));
  if(!cand.length) return null;
  const dt=diaTipoTurno(fecha);
  const pref = dt==='sabado' ? ['sabado','lj','lv'] : dt==='viernes' ? ['viernes','lv'] : ['lj','lv'];
  for(let i=0;i<pref.length;i++){ const m=cand.find(t=>t.tipo_dia===pref[i]); if(m) return m; }
  return cand[0];
}
// Descanso (h) de una fila de TURNOS (cena/almuerzo, normalmente 1h). null = sin descanso definido →
// usar el descuento de almuerzo por rango (comportamiento diurno original).
function descansoDeTurnoRow(t){
  if(t && t.descanso_ini && t.descanso_fin){
    const di=horasNum(t.descanso_ini); let df=horasNum(t.descanso_fin); if(df!=null&&di!=null&&df<di) df+=24;
    if(di!=null&&df!=null) return Math.max(0, df-di);
  }
  return null;
}
function descansoDeBloque(b){ return descansoDeTurnoRow(turnoHoras(b&&b.turno||'1', STATE.fecha)); }
// D77: tope de horas ORDINARIAS del turno elegido — el ESTÁNDAR del día es el del TURNO del bloque,
// no siempre el del turno 1 (p. ej. turno 4 L-J: 19:00–04:30 − 1h cena = 8.5h ordinarias; las extras
// empiezan después). Duración programada entrada→salida (cruce de medianoche incluido) menos descanso.
// Sin fila de TURNOS aplicable se cae al tope de la jornada estándar del día (comportamiento previo).
function topeDeTurno(turno){
  // D81: en domingo/festivo el estándar es la jornada única Dom/Fest (7h a la col D), no el turno —
  // antes devolvía STATE.jornada.tope (0 en domfest) y un domingo legítimo de 7h disparaba el aviso.
  if(STATE.jornada && STATE.jornada.tipo==='domfest') return parseFloat(STATE.config.domfest_tope)||7;
  const t=turnoHoras(turno||'1', STATE.fecha);
  if(!t) return STATE.jornada.tope||0;
  const e=horasNum(t.entrada), s=horasNum(t.salida);
  if(e==null||s==null) return STATE.jornada.tope||0;
  let h=s-e; if(h<0) h+=24;
  const d=descansoDeTurnoRow(t);
  return Math.max(0, h-(d||0));
}
// Turnos SELECCIONABLES según la fecha (D81, enmienda a D77c): un turno SIN variante de sábado
// "acaba el viernes" y NO se ofrece el sábado (antes se dejaba elegir con su horario de semana);
// en domingo/festivo no hay turnos (jornada única 07:00–15:00). El clasificador del Excel conserva
// el respaldo lj/lv SOLO para filas viejas ya guardadas con un turno fuera de su día.
function turnosDisponibles(){
  if(STATE.jornada && STATE.jornada.tipo==='domfest') return [];
  const sab = diaTipoTurno(STATE.fecha)==='sabado';
  const s=[];
  STATE.turnos.forEach(t=>{ const tn=String(t.turno);
    if(s.indexOf(tn)>=0) return;
    if(sab && !STATE.turnos.some(x=>String(x.turno)===tn && x.tipo_dia==='sabado')) return;
    s.push(tn);
  });
  return s.sort();
}

// Al teclear en el buscador NO se re-renderiza todo (eso hacía perder el foco del input y no dejaba
// escribir). Solo se actualiza el contenedor de resultados de ese bloque; el input conserva su foco.
function ccQueryChange(bid, v){
  const b=STATE.bloques.find(x=>x.id===bid); b.ccQuery=v; b.ccAbierto=true; renderCCResults(b);
}
function renderCCResults(b){
  const cont=document.getElementById('cc-results-'+b.id); if(!cont) return;
  const all=resultadosCC(b), CAP=60, res=all.slice(0,CAP);
  let inner = res.length
    ? res.map(cc=>`<div class="cc-opt" data-on-click="elegirCC(${b.id},'${esc(String(cc).replace(/'/g,"\\'"))}')">${esc(cc)}</div>`).join('')
    : '<div class="cc-opt">Sin resultados</div>';
  if(all.length>CAP) inner += `<div class="cc-opt" data-estilo="color:var(--muted);cursor:default;">…y ${all.length-CAP} más · escribe para filtrar</div>`;
  cont.innerHTML=inner;
}
function elegirCC(bid, cc){
  const b=STATE.bloques.find(x=>x.id===bid);
  b.cc=cc; b.proyecto=proyectoFromCC(cc); b.ccQuery=''; b.ccAbierto=false; render();
}
// "Cambiar" el CC de un bloque: hay que LIMPIAR el cc elegido (si no, bloqueHtml sigue mostrando la
// vista de "CC elegido" y el buscador nunca reaparece — el botón parecía no hacer nada).
function cambiarCC(bid){
  const b=STATE.bloques.find(x=>x.id===bid);
  b.cc=''; b.proyecto=''; b.ccQuery=''; b.ccAbierto=true; render();
}
// UF del bloque (3701/3702): filtra la lista de CC a los que empiezan por ese proyecto (el CC arranca
// con "3701." o "3702."). Al cambiar la UF se limpia el CC/búsqueda para no dejar uno de la otra UF.
function bloqueUfChange(bid, v){
  const b=STATE.bloques.find(x=>x.id===bid);
  b.uf=v; b.cc=''; b.proyecto=''; b.ccQuery=''; b.ccAbierto=!!v; render();
}
// CAPATAZ: la búsqueda se queda SIEMPRE dentro de los CC de SU ÁREA (hoja CC_USADOS) de la UF elegida
// —tanto la lista por defecto como al escribir—. No se abre al catálogo completo (eso solo lo hace el
// residente en el resumen). La búsqueda calza por CÓDIGO o NOMBRE (cada string es "3701.02.07| …").
// D101: el respaldo al catálogo global cuando CC_USADOS está vacía ya solo aplica a quien NO tiene área
// forzada (ver poolCCdelArea) — antes le metía los CC de tierras a la residente de UF3.
function resultadosCC(b){
  const q=(b.ccQuery||'').trim().toLowerCase();
  const uf=b.uf||'';
  const enUF=cc=> !uf || String(cc).indexOf(uf)===0;   // "3701."/"3702."/"3703." según prefijo del CC
  const pool=poolCCdelArea().filter(enUF);
  if(!q) return pool;
  return pool.filter(cc=>cc.toLowerCase().indexOf(q)>=0);
}
function bloqueHoraChange(bid, campo, v){ const b=STATE.bloques.find(x=>x.id===bid); b[campo]=v; render(); }
function toggleMiembro(bid, pidx, checked){
  const p=STATE.personas[pidx];
  p.bloqueId = checked ? bid : null;
  render();
}
function toggleOverride(pidx){
  const p=STATE.personas[pidx];
  if(p.hora_entrada_ov==null && p.hora_salida_ov==null){ p.hora_entrada_ov=p.hora_entrada; p.hora_salida_ov=p.hora_salida; }
  else { p.hora_entrada_ov=null; p.hora_salida_ov=null; }
  render();
}
function setOverride(pidx, campo, v){ STATE.personas[pidx][campo]=v; }
// D159b: horas BASE del capataz según su turno. Antes se mandaba SIEMPRE turno 1 (jornada diurna del
// día, 7.5h), así que un capataz en el turno NOCTURNO (8.5h base) se clasificaba mal en el Parte (lo
// leía como turno 1). Ahora el capataz tiene su propio selector de turno (`turno_cap`): sus horas base
// salen de ese turno (o de la jornada del día en domingo/festivo, donde no hay turnos) y se mandan ese
// turno + esas horas. El override "ajustar horario" sigue igual para teclearle extras / dom-fest.
function horasBaseCapataz(p){
  const j=STATE.jornada||{};
  if(j.tipo==='domfest') return { entrada:j.entrada||'', salida:j.salida||'' };
  const t=turnoHoras((p&&p.turno_cap)||'1', STATE.fecha);
  return t ? { entrada:t.entrada, salida:t.salida } : { entrada:j.entrada||'', salida:j.salida||'' };
}
function setTurnoCapataz(pidx, v){
  const p=STATE.personas[pidx]; if(!p) return;
  p.turno_cap=v;
  // Si ya tenía el horario ajustado a mano, re-siémbralo con las horas del nuevo turno (base de extras).
  if(p.hora_entrada_ov!=null){ const hb=horasBaseCapataz(p); p.hora_entrada_ov=hb.entrada; p.hora_salida_ov=hb.salida; }
  render();
}
// Capataz: activa/desactiva su horario editable. Al activarlo, siembra las horas base de SU turno
// (D159b) para que el usuario solo extienda la salida si trabajó extras.
function toggleOverrideCapataz(pidx){
  const p=STATE.personas[pidx];
  if(p.hora_entrada_ov==null){ const hb=horasBaseCapataz(p); p.hora_entrada_ov=hb.entrada; p.hora_salida_ov=hb.salida; }
  else { p.hora_entrada_ov=null; p.hora_salida_ov=null; }
  render();
}

/* ---------- validaciones suaves (avisan, no bloquean) ---------- */
function horasNum(hhmm){ if(!hhmm) return null; const p=hhmm.split(':'); if(p.length<2) return null; return Number(p[0])+Number(p[1])/60; }
// D72: `descanso` (h) opcional. Si viene (turno nocturno con cena, o diurno con almuerzo conocido) se
// descuenta directo; si es null se cae al descuento de almuerzo por rango (diurno original). Cruce de
// medianoche: si la salida es "menor" que la entrada se suma 24h (turnos nocturnos).
function horasTrabajadas(entrada, salida, cfg, descanso){
  const e=horasNum(entrada), s=horasNum(salida);
  if(e==null||s==null) return null;
  let h=s-e; if(h<0) h+=24;
  if(descanso!=null){ h-=descanso; }
  else {
    const almIni=horasNum(cfg.almuerzo_ini||'12:00'), almFin=horasNum(cfg.almuerzo_fin||'13:00');
    if(almIni!=null && almFin!=null && e<=almIni && s>=almFin) h-=(almFin-almIni);
  }
  return h<0?0:h;
}
function calcularAvisos(){
  const avisos=[];
  const cfg=STATE.config, maxExtra=parseFloat(cfg.max_extras_dia)||2;
  let hayNocturno=false;
  STATE.bloques.forEach(b=>{
    const e=b.hora_entrada, s=b.hora_salida;
    const t=turnoHoras(b.turno||'1', STATE.fecha), cruza=t?t.cruza_medianoche:false;
    if(cruza) hayNocturno=true;
    if(e && s){
      // En turnos que cruzan medianoche la entrada > salida es NORMAL (no se avisa).
      if(!cruza && horasNum(e)>=horasNum(s)) avisos.push(`Bloque "${esc(b.cc)||'(sin CC)'}": la hora de entrada es mayor o igual a la de salida.`);
      // D77: el estándar contra el que se comparan las horas es el del TURNO del bloque (no el turno 1).
      const topeB=topeDeTurno(b.turno);
      const h=horasTrabajadas(e,s,cfg,descansoDeBloque(b));
      if(h!=null && h>topeB+maxExtra+0.001) avisos.push(`Bloque "${esc(b.cc)||'(sin CC)'}": ${h.toFixed(1)}h trabajadas superan el turno ${esc(b.turno||'1')} (${topeB}h ordinarias) + extras permitidas (${maxExtra}h).`);
    }
    if(!b.cc) avisos.push('Hay un bloque sin Centro de Costo seleccionado.');
  });
  // D77: los turnos nocturnos ya se clasifican solos en el Excel (ordinarias del turno, recargo nocturno
  // col G y extras diurnas/nocturnas cols E/F, con corte nocturno a las 06:00). Solo se recuerda el corte.
  if(hayNocturno) avisos.push('Turno nocturno en uso: el Excel calcula solo las ordinarias del turno, el recargo nocturno y las extras (la parte de la extra después de las 06:00 cuenta como extra diurna).');
  const sinAsignar=personasCuadrilla().filter(p=>p.presente && p.bloqueId==null && !esCapataz(p));
  if(sinAsignar.length) avisos.push(`${sinAsignar.length} persona(s) presente(s) sin asignar a un bloque: `+sinAsignar.map(p=>esc(p.nombre)).join(', ')+'.');
  return avisos;
}

/* D119 — etiqueta de área en el selector de cuadrilla. Solo se activa cuando las cuadrillas ofrecidas
 * son de MÁS DE UN área, que hoy solo le pasa a `angie` (tierras+ODT+ODL): para todos los demás
 * usuarios el selector queda exactamente igual que antes. `area` vacía en la hoja CUADRILLAS = tierras,
 * la misma normalización que aplica el backend. */
function mezclaAreas(){
  const m=STATE.cuadrillasArea||{};
  const vistas={};
  STATE.cuadrillas.forEach(function(c){ vistas[m[c]||'tierras']=true; });
  return Object.keys(vistas).length>1;
}
function nombreArea(a){
  if(a==='tierras') return 'Tierras';
  return String(a||'').toUpperCase();
}
function etiquetaCuadrilla(c){
  if(!mezclaAreas()) return c;
  return c+' — '+nombreArea((STATE.cuadrillasArea||{})[c]||'tierras');
}
function render(){
  const cont=document.getElementById('container');
  if(!STATE.cuadrillas.length){
    cont.innerHTML='<div class="empty-state">No tienes cuadrillas asignadas para reportar. Contacta al residente/admin (hoja CUADRILLAS).</div>';
    return;
  }
  const personas=personasCuadrilla();
  // Capataces excluidos: tienen CC propio, no se asignan a bloques (no son "sin asignar").
  const sinAsignar=personas.filter(p=>p.presente && p.bloqueId==null && !esCapataz(p));
  const avisos=calcularAvisos();

  let html='';
  // D82: aviso informativo (no bloquea) de roster de copia local — sin señal al cargar
  if(STATE.rosterViejo){
    html+='<div class="avisos">📡 Sin señal al cargar: usando el roster guardado del '+esc(TM2Offline.fechaCorta(STATE.rosterGuardado))+'. Si hubo cambios de personal, el residente los corrige después.</div>';
  }
  // ---- fecha + cuadrilla + jornada ----
  // (helpers de etiqueta de cuadrilla más abajo: `mezclaAreas` / `etiquetaCuadrilla`, D119)
  html+='<div class="card"><div class="row">';
  html+=`<div class="field"><label>Fecha</label><input type="date" value="${STATE.fecha}" data-on-change="onFechaChange(this.value)"></div>`;
  if(STATE.cuadrillas.length>1){
    // D119: cuando el selector mezcla ÁREAS se etiqueta cada cuadrilla con la suya (`ANGEL — Tierras`,
    // `JAIRO — ODL`). Hasta ahora nadie veía tierras y drenajes a la vez, así que la lista plana bastaba;
    // con ~10 cuadrillas que se llaman como su capataz, elegir la equivocada es un error de un solo clic
    // y el envío PISA fecha+cuadrilla (D03/D107), así que borraría el reporte legítimo de esa cuadrilla.
    // Si todas son de la misma área (todos los demás usuarios) no se etiqueta nada: la vista no cambia.
    html+='<div class="field"><label>Cuadrilla</label><select data-on-change="onCuadrillaChange(this.value)">'
      + STATE.cuadrillas.map(c=>{
          const et=etiquetaCuadrilla(c);
          return `<option value="${esc(c)}" ${c===STATE.cuadrillaActual?'selected':''}>${esc(et)}</option>`;
        }).join('')
      + '</select></div>';
  } else {
    html+=`<div class="field"><label>Cuadrilla</label><input type="text" value="${esc(STATE.cuadrillaActual)}" disabled></div>`;
  }
  html+='</div>';
  const j=STATE.jornada;
  if(j.tipo==='domfest'){
    // D81: hasta 7h van a Horas ordinarias Dom/Fest (col D); lo que pase del tope cuenta como
    // horas extra Dom/Fest (col H del Parte), máximo max_extras_dia (2h).
    // D115: se explicita el descuento de almuerzo, que es la fuente real de confusión. El clasificador
    // (horas-nomina.js) resta 1h siempre que el horario reportado CUBRA 12:00–13:00 completo, mire o no
    // la gente el reloj del almuerzo: 07:00–15:00 = 7h, pero 07:00–14:00 = 6h. Quien trabaja de corrido
    // y se va a las 2 queda con 6h, no con 7. Solo texto: el cálculo no cambia.
    html+=`<div class="jornada-banner">⚠️ Día <b>domingo/festivo</b>: horario típico <b>${esc(j.entrada||'07:00')}</b> a <b>${esc(j.salida||'15:00')}</b> (se descuenta 1h de almuerzo → ${parseFloat(STATE.config.domfest_tope)||7}h a Dom/Fest). Las horas son editables; lo que pase del tope cuenta como <b>extra Dom/Fest</b> (máx ${parseFloat(STATE.config.max_extras_dia)||2}h).<br><small>El almuerzo se descuenta siempre que el horario cubra 12:00–13:00: <b>07:00–15:00 = 7h</b>, pero <b>07:00–14:00 = 6h</b> (aunque hayan trabajado de corrido).</small></div>`;
  } else {
    html+=`<div class="jornada-banner">Jornada estándar (<b>${j.tipo==='sabado'?'sábado':'lunes a viernes'}</b>): <b>${esc(j.entrada)}</b> a <b>${esc(j.salida)}</b> · tope ordinario <b>${j.tope}h</b></div>`;
  }
  html+='</div>';

  if(avisos.length){
    html+='<div class="avisos">⚠️ Revisa antes de enviar (no bloquea el envío):<ul>'+avisos.map(a=>`<li>${a}</li>`).join('')+'</ul></div>';
  }

  // ---- Personal (presente/ausente) ----
  html+='<div class="pc-zona"><div class="pc-izq">';   // D151: columna izquierda — el listado largo
  html+='<div class="section-title">Personal de la cuadrilla</div>';
  html+='<div class="card">';
  if(!personas.length){ html+='<p data-estilo="color:var(--muted);font-size:13px;">Sin personas activas en esta cuadrilla.</p>'; }
  personas.forEach(p=>{
    const bloque=STATE.bloques.find(b=>b.id===p.bloqueId);
    let capatazOv='';   // horario editable del capataz (se anexa tras cerrar la fila si está activo)
    html+='<div class="persona-row">'
      + `<label class="chk-presente"><input type="checkbox" ${p.presente?'checked':''} data-on-change="togglePresente(${p._pid},this.checked)"> Presente</label>`
      + `<div class="nombre"><b>${esc(p.nombre)}</b><small>${esc(p.codigo||'s/cód.')} · ${esc(p.cargo)}</small></div>`;
    if(!p.presente){
      html+='<select class="motivo-sel" data-on-change="setMotivo('+p._pid+',this.value)"><option value="">Motivo de ausencia…</option>'
        + STATE.catMotivos.map(m=>`<option value="${esc(m)}" ${p.motivo===m?'selected':''}>${esc(m)}</option>`).join('')
        + '</select>';
    } else if(esCapataz(p)){
      // Capataz presente: CC propio de supervisión, no se asigna a bloques (corrección jul-2026).
      // Horario editable (jul-2026): por defecto la jornada estándar del día (sin extras); "ajustar
      // horario" permite teclearle su entrada/salida reales para reconocerle extras (se calculan igual
      // que a un trabajador, columnas E/F del Parte) o su jornada de domingo/festivo.
      const cc=ccCapataz();
      const tieneOv=p.hora_entrada_ov!=null;
      html+= cc
        ? `<span class="badge asig" title="Centro de costo propio de supervisión del capataz (no es la actividad de la cuadrilla)">👷 ${esc(cc.split('|')[0].trim())}</span>`
        : `<span class="badge" title="No se pudo determinar el proyecto: asigna primero un centro de costo a algún bloque de la cuadrilla">👷 sin CC aún</span>`;
      // D159b: selector de turno del capataz (define su jornada base en el Parte). Solo con TURNOS
      // cargada y en día hábil; en domingo/festivo no hay turnos (jornada única del día).
      const turnosCap=turnosDisponibles();
      if(turnosCap.length && STATE.jornada.tipo!=='domfest'){
        const tc=String(p.turno_cap||'1');
        html+=`<select class="turno-cap-sel" title="Turno del capataz — define su jornada base (ordinarias/recargo nocturno) en el Parte" data-on-change="setTurnoCapataz(${p._pid},this.value)">`
          + turnosCap.map(tn=>{ const t=turnoHoras(tn, STATE.fecha); const rango=t?` · ${esc(t.entrada)}–${esc(t.salida)}${t.cruza_medianoche?' (+1)':''}`:'';
              return `<option value="${esc(tn)}" ${tn===tc?'selected':''}>Turno ${esc(tn)}${rango}</option>`; }).join('')
          + '</select>';
      }
      html+=` <button class="link-ov" data-on-click="toggleOverrideCapataz(${p._pid})">${tieneOv?'usar jornada estándar':'ajustar horario'}</button>`;
      if(tieneOv){
        capatazOv=`<div class="miembro-ov"><input type="time" value="${esc(p.hora_entrada_ov)}" data-on-change="setOverride(${p._pid},'hora_entrada_ov',this.value)">`
          + `<input type="time" value="${esc(p.hora_salida_ov)}" data-on-change="setOverride(${p._pid},'hora_salida_ov',this.value)"></div>`;
      }
    } else if(bloque){
      html+=`<span class="badge asig">${esc(bloque.cc)||'CC pend.'}</span>`;
    } else {
      html+='<span class="badge sin">Sin asignar</span>';
    }
    html+='</div>';
    html+=capatazOv;
  });
  html+='</div>';

  // ---- Sin asignar (siempre visible) ----
  html+=`<div class="sin-asignar ${sinAsignar.length?'alerta':''}"><h3>${sinAsignar.length?'⚠️ Sin asignar':'✓ Todos asignados'}</h3>`;
  html+= sinAsignar.length
    ? '<div class="chip-list">'+sinAsignar.map(p=>`<span class="chip">${esc(p.nombre)}</span>`).join('')+'</div>'
    : '<p data-estilo="color:var(--muted);font-size:12.5px;">Todas las personas presentes están en un bloque.</p>';
  html+='</div>';

  // ---- Bloques ----
  html+='</div><div class="pc-der">';   // D151: columna derecha — bloques de CC y nota
  html+='<div class="section-title">Bloques de actividad (CC)</div>';
  STATE.bloques.filter(b=>b.cuadrilla===STATE.cuadrillaActual).forEach(b=>{ html+=bloqueHtml(b, personas); });
  html+='<button class="btn-add-bloque" data-on-click="agregarBloque()">+ Agregar bloque</button>';

  // D74: nota libre del día (opcional) — novedades, alguien nuevo, anomalías. La ve el residente en el resumen.
  html+='<div class="section-title">Nota del día (opcional)</div>';
  html+=`<div class="card"><textarea id="notaDia" rows="2" placeholder="¿Alguien nuevo? ¿Alguna novedad o anomalía del día? (opcional)" data-on-input="setNotaDia(this.value)" data-estilo="resize:vertical;">${esc(STATE.nota||'')}</textarea></div>`;

  html+='</div></div>';   // D151: cierra pc-der y pc-zona
  html+='<div data-estilo="margin-top:22px;"><button class="btn-enviar" id="btnEnviar" data-on-click="enviar()" '+(STATE.enviando?'disabled':'')+'>'
    + (STATE.enviando?'Enviando…':'ENVIAR ASISTENCIA →') + '</button></div>';
  html+='<div id="confirmBox"></div>';

  cont.innerHTML=html;
  // Rellena el dropdown de resultados de los bloques con buscador abierto (tras un render completo el
  // contenedor queda vacío; así se ven los CC de una vez sin tener que hacer clic en el input).
  STATE.bloques.forEach(b=>{ if(b.ccAbierto && !b.cc && b.uf) renderCCResults(b); });
}

function bloqueHtml(b, personas){
  // Capataces fuera: no se asignan a una actividad, llevan su CC de supervisión propio.
  const elegibles=personas.filter(p=>p.presente && !esCapataz(p) && (p.bloqueId===b.id || p.bloqueId==null));
  let h='<div class="bloque"><div class="bloque-head">'
    + `<span class="tag">Bloque #${b.id}</span>`
    + `<button class="btn-x" data-on-click="quitarBloque(${b.id})">✕ Quitar</button></div>`;
  // Selector de UF: define los primeros dígitos del CC. Las opciones salen de los CC del área de quien
  // reporta (proyectosDisponibles), no de una lista cableada — en tierras siguen siendo 3701/3702.
  // D101: con UNA sola UF (el caso de UF3) no hay nada que elegir: se muestra como etiqueta fija y el
  // bloque nace ya con esa UF puesta. Sin ninguna, el área no tiene CC cargados y hay que decirlo.
  const ufs=proyectosDisponibles();
  if(!ufs.length){
    h+='<p data-estilo="font-size:12px;color:var(--error-txt);">⚠️ No hay centros de costo cargados para tu área en la hoja <b>CC_USADOS</b>. Avisa al administrador: sin ellos no se puede elegir la actividad.</p></div>';
    return h;
  }
  if(ufs.length===1){
    if(!b.uf) b.uf=ufs[0];   // sin selector no hay dónde elegirla: se fija sola
    const et=etiquetaUF(ufs[0]);
    h+=`<div class="row" data-estilo="margin-bottom:8px;"><span class="tag">${ufs[0]}${et?' · '+et:''}</span></div>`;
  } else {
    h+='<div class="row" data-estilo="margin-bottom:8px;"><div class="field" data-estilo="max-width:220px;"><label>Unidad Funcional</label>'
      + `<select data-on-change="bloqueUfChange(${b.id},this.value)">`
      + `<option value="" ${!b.uf?'selected':''}>Elegir UF…</option>`
      + ufs.map(p=>{ const et=etiquetaUF(p); return `<option value="${p}" ${b.uf===p?'selected':''}>${p}${et?' · '+et:''}</option>`; }).join('')
      + '</select></div></div>';
  }
  if(b.cc){
    h+=`<div class="cc-chosen"><span><b>${esc(b.proyecto)}</b> · ${esc(b.cc)}</span><button class="btn-x" data-on-click="cambiarCC(${b.id})">Cambiar</button></div>`;
  } else if(!b.uf){
    h+='<p data-estilo="font-size:12px;color:var(--muted);">Elige primero la Unidad Funcional para ver sus centros de costo.</p>';
  } else {
    h+='<div class="cc-search">'
      + `<input type="text" placeholder="Buscar CC por código o nombre…" value="${esc(b.ccQuery||'')}" data-on-input="ccQueryChange(${b.id},this.value)" data-on-focus="ccQueryChange(${b.id},this.value)">`
      + `<div class="cc-results" id="cc-results-${b.id}"></div>`;   // se llena vía renderCCResults (sin re-render global)
    h+='</div>';
  }
  // D72: selector de turno (pre-llena las horas). Solo si TURNOS está cargada y no es domingo/festivo.
  const turnos=turnosDisponibles();
  if(turnos.length && STATE.jornada.tipo!=='domfest'){
    const bt=String(b.turno||'1');
    h+='<div class="row" data-estilo="margin-top:10px;"><div class="field" data-estilo="max-width:260px;"><label>Turno</label>'
      + `<select data-on-change="bloqueTurnoChange(${b.id},this.value)">`
      + turnos.map(tn=>{ const t=turnoHoras(tn, STATE.fecha); const rango=t?` · ${esc(t.entrada)}–${esc(t.salida)}${t.cruza_medianoche?' (+1)':''}`:'';
          return `<option value="${esc(tn)}" ${tn===bt?'selected':''}>Turno ${esc(tn)}${rango}</option>`; }).join('')
      + '</select></div></div>';
  }
  h+='<div class="row" data-estilo="margin-top:10px;">'
    + `<div class="field"><label>Hora entrada (bloque)</label><input type="time" value="${esc(b.hora_entrada)}" data-on-change="bloqueHoraChange(${b.id},'hora_entrada',this.value)"></div>`
    + `<div class="field"><label>Hora salida (bloque)</label><input type="time" value="${esc(b.hora_salida)}" data-on-change="bloqueHoraChange(${b.id},'hora_salida',this.value)"></div>`
    + '</div>';
  h+='<div class="section-title" data-estilo="margin:14px 0 6px;font-size:11px;">Miembros</div>';
  if(!elegibles.length){ h+='<p data-estilo="color:var(--muted);font-size:12.5px;">No hay personas presentes disponibles.</p>'; }
  elegibles.forEach(p=>{
    const checked=p.bloqueId===b.id;
    const tieneOv=checked && p.hora_entrada_ov!=null;
    h+=`<div class="miembro"><input type="checkbox" ${checked?'checked':''} data-on-change="toggleMiembro(${b.id},${p._pid},this.checked)"> ${esc(p.nombre)}`;
    if(checked) h+=` <button class="link-ov" data-on-click="toggleOverride(${p._pid})">${tieneOv?'quitar override':'horas individuales'}</button>`;
    h+='</div>';
    if(tieneOv){
      h+=`<div class="miembro-ov"><input type="time" value="${esc(p.hora_entrada_ov)}" data-on-change="setOverride(${p._pid},'hora_entrada_ov',this.value)">`
        + `<input type="time" value="${esc(p.hora_salida_ov)}" data-on-change="setOverride(${p._pid},'hora_salida_ov',this.value)"></div>`;
    }
  });
  h+='</div>';
  return h;
}

async function enviar(){
  const personas=personasCuadrilla();
  if(!personas.length){ alert('No hay personal para reportar en esta cuadrilla.'); return; }
  const faltaMotivo=personas.some(p=>!p.presente && !p.motivo);
  if(faltaMotivo){ alert('Falta el motivo de ausencia de alguna persona.'); return; }

  const cfg=STATE.config, maxExtra=parseFloat(cfg.max_extras_dia)||2;

  // SUPER AVISO 1: personas PRESENTES sin actividad/CC. Lo correcto es asignarlas a un bloque con CC
  // o marcarlas AUSENTES con motivo. Se permite forzar (escape hatch) pero exige confirmación explícita.
  const sinCC=personas.filter(p=>{ if(!p.presente || esCapataz(p)) return false; const b=STATE.bloques.find(x=>x.id===p.bloqueId); return !b || !b.cc; });
  if(sinCC.length){
    const nombres=sinCC.map(p=>'  • '+p.nombre).join('\n');
    if(!confirm(`⚠️ ATENCIÓN — ${sinCC.length} persona(s) PRESENTES sin actividad / Centro de Costo:\n\n${nombres}\n\nLo correcto es asignarlas a un bloque con CC, o marcarlas AUSENTES con motivo.\n\nSi las envías así quedarán SIN CC en el reporte (habrá que corregirlas después).\n\n¿Enviar de todas formas?`)) return;
  }

  // SUPER AVISO 2: horas que superan el estándar del día + máximo de extras. D81: aplica TAMBIÉN en
  // domingo/festivo (estándar = tope Dom/Fest 7h vía topeDeTurno; lo que pase va a extras Dom/Fest,
  // máx 2h — más que eso se avisa igual que entre semana).
  {
    const over=[];
    personas.filter(p=>p.presente).forEach(p=>{
      const b=STATE.bloques.find(x=>x.id===p.bloqueId);
      // Capataz: no tiene bloque; sus horas salen de su override o de la jornada base de SU turno (D159b).
      const baseCap=esCapataz(p)?horasBaseCapataz(p):null;
      const baseEnt=esCapataz(p)?baseCap.entrada:(b?b.hora_entrada:p.hora_entrada);
      const baseSal=esCapataz(p)?baseCap.salida:(b?b.hora_salida:p.hora_salida);
      const he=p.hora_entrada_ov!=null?p.hora_entrada_ov:baseEnt;
      const hs=p.hora_salida_ov!=null?p.hora_salida_ov:baseSal;
      // D77/D159b: cada persona se compara contra el ESTÁNDAR de SU turno (el del bloque; el capataz, el suyo).
      const topeP=esCapataz(p)?topeDeTurno(p.turno_cap||'1'):topeDeTurno(b?b.turno:'1');
      const descanso=esCapataz(p)?descansoDeTurnoRow(turnoHoras(p.turno_cap||'1', STATE.fecha)):descansoDeBloque(b);
      const h=horasTrabajadas(he,hs,cfg,descanso);
      if(h!=null && h>topeP+maxExtra+0.001) over.push(`  • ${p.nombre} — ${h.toFixed(1)}h (estándar del día: ${topeP}h + ${maxExtra}h extra)`);
    });
    if(over.length){
      if(!confirm(`⚠️ ATENCIÓN — estas personas superan las horas ordinarias del día + máximo de extras (${maxExtra}h):\n\n${over.join('\n')}\n\nSolo se reconocen ${maxExtra} horas extra sobre el estándar del día. Revisa las horas de entrada/salida.\n\n¿Enviar de todas formas?`)) return;
    }
  }

  // D106: última barrera del cliente. Sin fecha válida no se envía nada (el backend también lo
  // rechaza, pero avisar aquí evita gastar el envío y, sin señal, encolar un reporte inservible).
  if(!fechaValida(STATE.fecha)){
    alert('⚠️ No se puede enviar sin fecha.\n\nElige el día en el campo "Fecha" y vuelve a intentarlo.');
    return;
  }

  if(!confirm(`Vas a enviar la asistencia de ${esc(STATE.cuadrillaActual)} del ${STATE.fecha}.\n\nSi ya existe un reporte de esa fecha+cuadrilla, se REEMPLAZARÁ por completo.\n\n¿Continuar?`)) return;

  const filas=personas.map(p=>{
    if(!p.presente){
      return { codigo:p.codigo, cedula:p.cedula, nombre:p.nombre, cargo:p.cargo, cc:'', proyecto:'',
        hora_entrada:'', hora_salida:'', presente:'No', motivo_ausencia:p.motivo, observacion:'', turno:'' };
    }
    if(esCapataz(p)){
      // Capataz presente: CC propio de supervisión (37xx.I010305), prefijo por mayoría. D159b: sus horas
      // base salen de SU turno (`turno_cap`, no siempre el 1), y se manda ese turno para que el Parte le
      // calcule bien ordinarias/recargo nocturno/extras (antes, en el turno nocturno de 8.5h lo leía como
      // turno 1 = 7.5h). Si se le ajustó el horario, van sus horas reales. No entra a bloques (extiende D72f).
      const cc=ccCapataz();
      const hb=horasBaseCapataz(p);
      const he=p.hora_entrada_ov!=null?p.hora_entrada_ov:hb.entrada;
      const hs=p.hora_salida_ov!=null?p.hora_salida_ov:hb.salida;
      return { codigo:p.codigo, cedula:p.cedula, nombre:p.nombre, cargo:p.cargo, cc:cc, proyecto:proyectoFromCC(cc),
        hora_entrada:he, hora_salida:hs, presente:'Si', motivo_ausencia:'', observacion:'', turno:String(p.turno_cap||'1') };
    }
    const b=STATE.bloques.find(x=>x.id===p.bloqueId);
    const he = p.hora_entrada_ov!=null ? p.hora_entrada_ov : (b?b.hora_entrada:p.hora_entrada);
    const hs = p.hora_salida_ov!=null ? p.hora_salida_ov : (b?b.hora_salida:p.hora_salida);
    return { codigo:p.codigo, cedula:p.cedula, nombre:p.nombre, cargo:p.cargo, cc:b?b.cc:'', proyecto:b?b.proyecto:'',
      hora_entrada:he||'', hora_salida:hs||'', presente:'Si', motivo_ausencia:'', observacion:'', turno:(b?String(b.turno||'1'):'1') };
  });

  STATE.enviando=true; render();
  // D82: la asistencia NO lleva UUID de dedupe — el backend pisa fecha+cuadrilla (upsert
  // borra-e-inserta verificado en CodigoAsistencias.gs/guardarAsistencia): reenviar el mismo payload
  // desde la cola re-pisa con el mismo contenido (idempotente por diseño). Si hay dos envíos
  // encolados de la misma fecha+cuadrilla, el orden FIFO hace que gane el último (el más reciente).
  const payload={ action:'reporte_asistencia', fecha:STATE.fecha, cuadrilla:STATE.cuadrillaActual, reporta:STATE.usuario, filas, nota:STATE.nota||'' };
  const r=await TM2Offline.enviarConCola({ tipo:'asistencia', url:APPS_SCRIPT_URL, payload:payload, fecha_obra:STATE.fecha, usuario:STATE.usuario });
  STATE.enviando=false;
  if(r.enviado){
    const data=r.res;
    if(data && data.ok){
      render();
      document.getElementById('confirmBox').innerHTML=`<div class="confirm-ok">✓ Guardado en el servidor: ${data.filas} fila(s) para ${esc(STATE.cuadrillaActual)} · ${STATE.fecha}.</div>`;
    } else {
      render();
      // D166: cuando el backend RECHAZA el payload devuelve `campo` (qué dato) y `detalle` (por qué),
      // y los deja en el LOG. Antes se mostraba solo la palabra cruda "payload", que no le dice nada al
      // capataz en campo (típicamente es la FECHA del teléfono adelantada → "fecha futura", o una HORA
      // de entrada/salida ilegible). Ahora se traduce a algo accionable con el campo y el motivo.
      let msg;
      if(data && data.error==='payload'){
        const campo=data.campo?String(data.campo):'', detalle=data.detalle?String(data.detalle):'';
        msg='El servidor no aceptó un dato del reporte'
          + (campo?(' ('+campo+(detalle?': '+detalle:'')+')'):(detalle?(' ('+detalle+')'):''))
          + '.\n\nRevisa la FECHA (que el día del teléfono sea el correcto) y las HORAS de entrada/salida, y vuelve a intentarlo.';
      } else {
        msg='El servidor respondió con un error: '+((data&&data.error)||'desconocido');
      }
      alert(msg);
    }
  } else {
    // encolado: confirmación NARANJA (guardado local) — nunca el verde de servidor
    render();
    document.getElementById('confirmBox').innerHTML=`<div class="confirm-cola">📥 <b>Guardado en el teléfono.</b> Se enviará solo cuando vuelva la señal. Asistencia de ${esc(STATE.cuadrillaActual)} · ${STATE.fecha} en cola (mira el contador de arriba).</div>`;
  }
}

// D170: antes eran expresiones en línea en el marcado; la CSP ya no las admite.
function setNotaDia(v){ STATE.nota=v; }
