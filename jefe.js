// D170: aplica los data-estilo del marcado ANTES de que corra la lógica de la pantalla (ver tema.js).
if(window.TM2Estilos) TM2Estilos.aplicar();
// Modo EMBED (dentro del Hub del Jefe, V3-10): oculta la cabecera propia y los tiles. Sin ?embed=1 no cambia nada.
try{ if(new URLSearchParams(location.search).get('embed')==='1') document.documentElement.classList.add('embed'); }catch(e){}
const APPS_SCRIPT_URL = GALCA_ENV.url.obra;          // entorno.js (D168): producción o prueba

// Estado de la consulta. `cols` trae los índices de columna que informa el backend (con fallback al
// layout A–T conocido) para no acoplar el frontend a posiciones fijas. Es SOLO LECTURA: aquí no se
// escribe nada a DATA ni al maestro; el copiado va al portapapeles y lo pega el usuario a mano.
let STATE = { filas:[], cols:{}, desde:'', hasta:'', clima:{} };
// ELEMENTO (col I / índice 8) = el SUBTRAMO al que quedó cargada la fila (D104): se muestra junto al
// PK en el resumen para que el jefe detecte incoherencias. Solo lectura (D65): el jefe no corrige.
// ACTIVIDAD (índice 20) = columna INTERNA de DATA que el consolidado añade DESPUÉS del recorte A–T
// (D113). No viaja al maestro y no entra en el copiado (COPY_END sigue en 15). Con un backend anterior
// al despliegue de D113 la fila llega con 20 celdas y esta viene `undefined`: el desglose cae solo al
// respaldo por DESCRIPCION, así que la pantalla nunca se rompe.
const COLS_DEFAULT = { FECHA:0, ORDEN:1, GRUPO:2, CC:3, DESCRIPCION:5, UF:6, ELEMENTO:8, ABS_INI:9, ABS_FIN:10, ACTA:12, UNIDAD:13, LARGO:14, OBSERVACION:18, ACTIVIDAD:20, COPY_END:15 };   // D184: ORDEN/ACTA (van vacías en el copiado)

// Área derivada del CC en CLIENTE (espejo de deriveArea del backend, D70) — el esquema A–T de
// consolidado no cambia: capítulo 06 → ODT, 07 → ODL, resto → tierras.
function deriveArea(cc){
  const c=String(cc==null?'':cc).trim();
  if(!c) return 'tierras';
  const sin=c.replace(/^\d{4}\./,'');
  if(sin.indexOf('06.')===0) return 'odt';
  if(sin.indexOf('07.')===0) return 'odl';
  return 'tierras';
}

/* D131 — roles de DRENAJES con acceso al panel del jefe. El residente de drenajes lleva ODT+ODL (D84)
 * y necesitaba el mismo resumen post-DATA que el residente de tierras: hasta ahora el guard lo mandaba
 * al login. Es una pantalla de SOLO LECTURA (D65) sobre DATA ya enviada, así que abrirla no le da
 * ninguna capacidad de escritura. Los roles de una sola área se incluyen por retrocompatibilidad
 * (D84/D85: los logins ya no existen, pero los roles se conservan en guards). */
const ROLES_DREN=['residente_dren','residente_odt','residente_odl'];
window.onload = function(){
  const rol=localStorage.getItem('rol'), usuario=localStorage.getItem('usuario');
  // Guard: jefe, admin, residente (entra desde su panel) o residente de drenajes (D131). Otro rol -> login.
  if(!rol || (rol!=='jefe' && rol!=='admin' && rol!=='residente' && ROLES_DREN.indexOf(rol)<0)){ window.location.href='index.html'; return; }
  // D194: el jefe y el admin trabajan en el Hub (Resumen · DATA · BASE · Proyección en pestañas). Si
  // abren esta pantalla suelta (login con el `redirige` viejo, un marcador), se les lleva al Hub; dentro
  // del Hub llega con ?embed=1 y no se redirige.
  if((rol==='jefe' || rol==='admin') && !document.documentElement.classList.contains('embed')){ location.replace('hub-jefe.html'); return; }
  document.getElementById('userDisplay').textContent=usuario||'jefe';
  // Botón de regreso según de dónde viene: admin -> menú; residente -> su panel; drenajes -> el suyo.
  var _bm=document.getElementById('btnMenu');
  if(_bm){
    if(rol==='admin'){ _bm.onclick=function(){location.href='menu.html';}; _bm.style.display='inline-block'; }
    else if(rol==='residente'){ _bm.textContent='← Volver'; _bm.onclick=function(){location.href='residente.html';}; _bm.style.display='inline-block'; }
    else if(ROLES_DREN.indexOf(rol)>=0){ _bm.textContent='← Volver'; _bm.onclick=function(){location.href='residente-drenajes.html';}; _bm.style.display='inline-block'; }
  }
  // D131: quien viene de drenajes arranca con el filtro en ODT+ODL — su alcance real. No es un cerrojo
  // (puede cambiarlo y mirar tierras: la pantalla es de solo lectura), es el punto de partida útil.
  if(ROLES_DREN.indexOf(rol)>=0){ const fa=document.getElementById('fArea'); if(fa) fa.value='drenajes'; }
  /* D158 — el TABLERO se ofrece a los cuatro roles que ya entran aquí (jefe,
     admin, residente de tierras y residente de drenajes), que son exactamente
     los que su propio portero deja pasar. Como el guard de arriba ya expulsó a
     cualquier otro, no hace falta repetir la lista.

     Y MAQUINARIA SALE DE ESTE PANEL (enmienda a D139). El jefe la tenía en
     SOLO LECTURA y no la usaba para nada que no le diera ya el resumen; para
     el residente de tierras y para el admin era un duplicado del enlace que
     tienen en su propio panel. Nadie pierde acceso: `residente.html` y
     `menu.html` la siguen llevando, y el portero de la pantalla no se toca. */
  const _tt=document.getElementById('tileTablero');
  if(_tt) _tt.style.display='flex';
  // Resumen ejecutivo: mismos roles que entran a esta pantalla (D131 incluido).
  const _tre=document.getElementById('tileResumenEjec');
  if(_tre) _tre.style.display='flex';
  // Fuente única de edición (D181): panel unificado (Hub) + revisión de DATA + grilla de catálogos BASE.
  const _th=document.getElementById('tileHub');
  if(_th && (rol==='jefe' || rol==='admin' || rol==='residente')) _th.style.display='flex';
  const _td=document.getElementById('tileData');
  if(_td && (rol==='jefe' || rol==='admin' || rol==='residente')) _td.style.display='flex';
  const _tg=document.getElementById('tileGrilla');
  if(_tg && (rol==='jefe' || rol==='admin' || rol==='residente')) _tg.style.display='flex';
  // V3-11 / D183: Proyección — la ven admin, jefe y residente (el residente en solo lectura).
  const _tp=document.getElementById('tileProyeccion');
  if(_tp && (rol==='jefe' || rol==='admin' || rol==='residente')) _tp.style.display='flex';
  // Fecha por defecto = HOY en zona horaria Colombia (D50), nunca toISOString().
  const hoy=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
  let uDesde=null, uHasta=null; try{ const u=new URLSearchParams(location.search); uDesde=u.get('desde'); uHasta=u.get('hasta'); }catch(e){}
  document.getElementById('desde').value=uDesde||hoy;
  document.getElementById('hasta').value=uHasta||uDesde||hoy;
  syncRango();
  if(uDesde && typeof consultar==='function') consultar();   // embebido con rango → muestra el consolidado de una vez
};
function logout(){ localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token'); window.location.href='index.html'; }

// hasta no puede ser menor que desde: fija el min y corrige si quedó por debajo.
function syncRango(){
  const d=document.getElementById('desde').value, h=document.getElementById('hasta');
  h.min=d;
  if(h.value && d && h.value<d) h.value=d;
}

function col(name){ const c=STATE.cols; return (c && c[name]!=null) ? c[name] : COLS_DEFAULT[name]; }
function num(v){ const n=parseFloat(v); return isNaN(n)?0:n; }
function fmt(n){ return (Math.round(n*100)/100).toLocaleString('es-CO',{maximumFractionDigits:2}); }

async function consultar(){
  const desde=document.getElementById('desde').value, hasta=document.getElementById('hasta').value;
  if(!desde || !hasta){ alert('Selecciona el rango de fechas.'); return; }
  if(hasta<desde){ alert('La fecha "hasta" no puede ser menor que "desde".'); return; }
  document.getElementById('resultados').innerHTML='<div class="loading">⏳ Consultando DATA...</div>';
  document.getElementById('filtrosDin').style.display='none';
  try{
    const url=`${APPS_SCRIPT_URL}?action=consolidado&desde=${desde}&hasta=${hasta}`;
    const resp=await fetch(url); const data=await resp.json();
    STATE.filas=data.filas||[];
    STATE.cols=data.cols||{};
    STATE.clima=data.climaPorDia||{};   // D37: {fecha -> clima}; se muestra en el resumen (no está en A–T)
    STATE.desde=desde; STATE.hasta=hasta;
    armarSelectores();
    render();
  }catch(err){
    document.getElementById('resultados').innerHTML='<div class="empty-state"><div class="icon">⚠️</div><p>No se pudo consultar. Revisa el Apps Script o la conexión.</p></div>';
  }
}

// Selectores de Actividad y UF armados con los valores DISTINTOS del resultado (no del catálogo).
function armarSelectores(){
  const cA=col('DESCRIPCION'), cU=col('UF');
  const acts=[...new Set(STATE.filas.map(r=>String(r[cA]||'').trim()).filter(Boolean))].sort();
  const ufs =[...new Set(STATE.filas.map(r=>String(r[cU]||'').trim()).filter(Boolean))].sort();
  const selA=document.getElementById('fActividad'), selU=document.getElementById('fUf');
  selA.innerHTML='<option value="">Todas</option>'+acts.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('');
  selU.innerHTML='<option value="">Todas</option>'+ufs.map(u=>`<option value="${esc(u)}">${esc(u)}</option>`).join('');
  document.getElementById('filtrosDin').style.display = STATE.filas.length ? 'block' : 'none';
}

// Filas que respetan los filtros Área/Actividad/UF (para el RESUMEN). El copiado NO usa Actividad/UF,
// pero SÍ respeta el filtro de Área (D70): con "Todas" copia el día completo; con un área, solo esa.
function filasFiltradas(){
  const fa=document.getElementById('fActividad').value, fu=document.getElementById('fUf').value;
  const cA=col('DESCRIPCION'), cU=col('UF');
  return filasArea().filter(r=>
    (!fa || String(r[cA]||'').trim()===fa) &&
    (!fu || String(r[cU]||'').trim()===fu));
}
/* Filas del área seleccionada (derivada del CC en cliente); '' = todas.
 * D131 — `drenajes` es un CONJUNTO, no un área: ODT + ODL. No se toca `deriveArea` (sigue devolviendo
 * el área real de cada fila, que es lo que fija el pisado por área en el backend); lo que se amplía es
 * el filtro de pantalla. Así el residente de drenajes ve sus dos capítulos juntos sin arrastrar tierras,
 * y el copiado del maestro hereda el mismo recorte (usa esta misma función). */
function filasArea(){
  const fr=document.getElementById('fArea').value;
  if(!fr) return STATE.filas;
  const cC=col('CC');
  if(fr==='drenajes') return STATE.filas.filter(r=>{ const a=deriveArea(r[cC]); return a==='odt'||a==='odl'; });
  return STATE.filas.filter(r=>deriveArea(r[cC])===fr);
}
function etiquetaArea(fr){
  if(!fr) return '';
  if(fr==='drenajes') return 'Drenajes (ODT+ODL)';
  return fr==='tierras' ? 'Tierras' : fr.toUpperCase();
}

// PK crudo desde metros (ABS): 19800 -> "19+800". '' si no es número.
function pkFmt(m){ m=parseFloat(m); if(isNaN(m)) return ''; const km=Math.floor(m/1000), r=Math.round(m-km*1000); return km+'+'+('00'+r).slice(-3); }
// Ubicación como PK crudo inicial–final (desde ABS INICIAL/FINAL). Un solo PK si no hay final o es igual.
function pkCrudo(ini, fin){
  const a=pkFmt(ini), b=pkFmt(fin);
  if(!a && !b) return '(sin PK)';
  return (a && b && b!==a) ? (a+' - '+b) : (a||b);
}
// Resumen por ACTIVIDAD y UBICACIÓN (lo que pide el jefe: qué se hizo, DÓNDE y cuánto). Agrupa por
// actividad (DESCRIPCION) y, dentro, por ubicación (PK crudo inicial–final desde ABS + UF). Suma LARGO
// separado por unidad de medida (nunca mezcla m³ con m²). Cada actividad trae su subtotal por unidad.
/* D113d — la fila NUNCA se saca de su actividad: se agrupa por DESCRIPCION, como siempre, y dentro
 * del bloque se muestra de qué material se compone ese total (ver lineaMateriales). Se probó antes un
 * toggle que PARTÍA la actividad en bloques por material y se descartó: perdía el total de la
 * actividad, que es el número con el que trabaja el jefe. */
function resumenActividades(rows){
  const cA=col('DESCRIPCION'), cAi=col('ABS_INI'), cAf=col('ABS_FIN'), cU=col('UF'), cUn=col('UNIDAD'), cL=col('LARGO'),
        cE=col('ELEMENTO'), cAct=col('ACTIVIDAD');
  const acts={};
  rows.forEach(r=>{
    const a=String(r[cA]||'').trim()||'—';
    const uf=String(r[cU]||'').trim();
    const pk=pkCrudo(r[cAi], r[cAf]);
    const ini=parseFloat(r[cAi]);
    const u=String(r[cUn]||'').trim()||'—';
    const val=num(r[cL]);
    // D104: el SUBTRAMO (ELEMENTO) al que la fila quedó cargada. Entra en la llave de agrupación para
    // que dos subtramos distintos no se colapsen en una sola ubicación aunque compartan PK/UF.
    const elem=String((cE!=null?r[cE]:'')||'').trim();
    if(!acts[a]) acts[a]={n:0, unidades:{}, ubic:{}, mat:{}, matOrden:[]};
    acts[a].n++;
    acts[a].unidades[u]=(acts[a].unidades[u]||0)+val;
    // D113d — DESGLOSE POR MATERIAL dentro de la actividad. La fila SIGUE perteneciendo a su actividad
    // contractual (el total de arriba no se toca); esto solo dice de cuánto fue cada material. Se usa
    // la `actividad` interna con respaldo a DESCRIPCION, así que las filas anteriores al cambio caen
    // bajo el nombre de la actividad y no inventan un grupo aparte.
    const m=(cAct!=null && String(r[cAct]||'').trim()) ? String(r[cAct]).trim() : a;
    const mk=m+'||'+u;
    if(!acts[a].mat[mk]){ acts[a].mat[mk]={nombre:m, unidad:u, total:0, n:0}; acts[a].matOrden.push(mk); }
    acts[a].mat[mk].total+=val; acts[a].mat[mk].n++;
    const k=uf+'||'+pk+'||'+elem;
    if(!acts[a].ubic[k]) acts[a].ubic[k]={uf, pk, elem, unidad:u, total:0, n:0, _ini:isNaN(ini)?Infinity:ini};
    acts[a].ubic[k].total+=val; acts[a].ubic[k].n++;
  });
  // Ordena actividades alfabéticamente; las ubicaciones por UF y luego por PK ascendente (por metros).
  // Los materiales, de MAYOR a menor cantidad: primero lo normal, y detrás lo puntual (el crudo de río
  // o el de UF3), que es como se lee la frase "de los 5.000, 4.800 normal y 200 de crudo de río".
  return Object.keys(acts).sort().map(a=>({
    actividad:a, n:acts[a].n, unidades:acts[a].unidades,
    materiales:Object.values(acts[a].mat).sort((x,y)=> y.total-x.total),
    ubicaciones:Object.values(acts[a].ubic).sort((x,y)=> (x.uf<y.uf?-1:x.uf>y.uf?1:0) || (x._ini-y._ini))
  }));
}
// Renderiza el desglose por unidad: "8.200 m³ · 300 m²". Nunca colapsa unidades distintas en un número.
function fmtUnidades(u){
  return Object.keys(u).sort().map(k=>`${fmt(u[k])}<span class="u">${esc(k)}</span>`).join(' · ');
}
function badgeUf(uf){
  const c=uf==='UF1'?'uf1':uf==='UF2'?'uf2':'';
  return uf?`<span class="badge ${c}">${esc(uf)}</span>`:'';
}

function render(){
  const cont=document.getElementById('resultados');
  if(!STATE.filas.length){
    cont.innerHTML='<div class="empty-state"><div class="icon">📭</div><p>No hay filas en DATA para ese rango.</p></div>';
    return;
  }
  const rows=filasFiltradas();
  const cF=col('FECHA');
  const dias=[...new Set(rows.map(r=>String(r[cF]||'')))].filter(Boolean);
  const acts=resumenActividades(rows);

  let html='';
  // D151: pc-a = columna principal (el resumen); pc-b = barra lateral (el copiado). En móvil los
  // envoltorios desaparecen y todo se apila en el mismo orden de siempre.
  html+='<div class="pc-zona"><div class="pc-a">';
  // ---- A) RESUMEN (protagonista): por actividad, con DÓNDE (ubicación) y cuánto ----
  html+='<div class="section-title">Resumen por actividad y ubicación</div>';
  html+=`<p class="meta-line">${acts.length} actividad${acts.length!==1?'es':''} · ${rows.length} línea${rows.length!==1?'s':''} · ${dias.length} día${dias.length!==1?'s':''}</p>`;
  html+=bloqueClima(dias);
  // Los bloques de actividad van en un contenedor propio para fluir en dos columnas de texto en PC (D151).
  html+='<div class="acts-grid">';
  acts.forEach(a=>{ html+=bloqueActividad(a); });
  html+='</div>';

  // ---- C) COPIADO (secundario) ----
  html+='</div><div class="pc-b">';
  html+='<div class="section-title">Copiar para el maestro</div>';
  html+=bloqueCopiado();
  html+='</div></div>';   // cierra pc-b y pc-zona

  cont.innerHTML=html;
}

// D37: clima del día que registró el encargado (columna interna de DATA, no viaja al maestro). Una
// línea por día del rango que tenga clima; si ningún día trae dato, el bloque no se muestra.
function bloqueClima(dias){
  const conClima=(dias||[]).filter(d=>STATE.clima && STATE.clima[d]).sort();
  if(!conClima.length) return '';
  let h='<div class="resumen-block"><div class="act-head"><span class="act-name">🌦️ Clima</span></div>';
  if(conClima.length===1){
    h+=`<div class="tot-row"><div class="cat">${esc(STATE.clima[conClima[0]])}</div>`
     + `<div class="val" data-estilo="font-size:11px;color:var(--muted);">${esc(conClima[0])}</div></div>`;
  } else {
    conClima.forEach(d=>{ h+='<div class="tot-row"><div class="cat">'+esc(d)+'</div>'
      + `<div class="val" data-estilo="font-size:12px;">${esc(STATE.clima[d])}</div></div>`; });
  }
  return h+'</div>';
}

// Un bloque por actividad: encabezado con el subtotal por unidad, y una fila por UBICACIÓN
// (elemento "tm2 pk …" + UF) con su cantidad. Así el jefe ve qué se hizo, dónde y cuánto.
function bloqueActividad(a){
  let h='<div class="resumen-block"><div class="act-head">'
    + `<span class="act-name">${esc(a.actividad)}</span>`
    + `<span class="act-sub">${fmtUnidades(a.unidades)}</span></div>`;
  h+=lineaMateriales(a);
  return h+bloqueUbicaciones(a)+'</div>';
}
/* D113d — el desglose por MATERIAL, dentro del bloque de su actividad.
 * Lo que pidió el dueño, con sus palabras: "sale Terraplén 5.000, pero sale la distinción — terraplén
 * normal 4.800 y 200 nomás es de crudo de río". La fila NO se mueve de su actividad ni el total de
 * arriba cambia: esto es una lectura de en qué se compone ese total. Vale igual para el terraplén de
 * tierras (núcleo/corona/crudo de río/UF3) y para el relleno de las ODT (ítem normal / crudo de río /
 * UF3), porque en los dos casos sale de la MISMA columna interna `actividad` de DATA.
 * Solo aparece cuando hay más de un componente: una actividad con un solo material se ve como siempre,
 * y lo reportado antes del cambio —sin `actividad` en DATA— cae bajo el nombre de su actividad, así
 * que tampoco estrena línea. Es puramente visual: no toca el copiado al maestro (A:O, COPY_END=15). */
function lineaMateriales(a){
  const m=a.materiales||[];
  if(m.length<2) return '';
  // Un "chip" por material, sin separadores sueltos: al envolverse en pantalla angosta (el jefe también
  // la abre desde el teléfono) no queda un "·" colgando al final del renglón.
  const partes=m.map(x=>`<span class="mat-item"><b>${esc(x.nombre)}</b><span class="n">${fmt(x.total)}</span><span class="u">${esc(x.unidad)}</span></span>`);
  return '<div class="mat-row"><span class="mat-lbl">Desglose</span>'+partes.join('')+'</div>';
}
function bloqueUbicaciones(a){
  let h='';
  a.ubicaciones.forEach(ub=>{
    // D104: subtramo (ELEMENTO) junto al PK. Un "REVISAR ·" delante señala que el PK quedó fuera de
    // todo subtramo del eje; se resalta para que salte a la vista en la revisión del jefe.
    const revisar=/^\s*REVISAR/i.test(ub.elem||'');
    const elemTag = ub.elem ? `<span class="elem${revisar?' revisar':''}">${esc(ub.elem)}</span>` : '';
    h+='<div class="tot-row"><div class="cat">'
     + `PK ${esc(ub.pk)} ${badgeUf(ub.uf)}${elemTag}`
     + `<small>${ub.n} línea${ub.n!==1?'s':''}</small></div>`
     + `<div class="val">${fmt(ub.total)}<span class="u">${esc(ub.unidad)}</span></div></div>`;
  });
  return h;   // el <div> del bloque lo cierra bloqueActividad
}

/* D131 — EL CLIMA VIAJA EN EL COPIADO DEL JEFE.
 * D130 estampó el clima en la OBSERVACION (col S) de DATA para que una tabla del maestro lo leyera…
 * pero ese camino solo servía pegando A:S a mano desde el Sheet. El copiado de esta pantalla llega
 * hasta O (COPY_END=15, D65), así que por aquí el clima no pasaba — y este es el copiado que se usa.
 * Ahora el bloque llega hasta S **solo los días que tienen clima**, y la columna S lleva ÚNICAMENTE el
 * sello `[Clima: X]`, en la PRIMERA fila del día:
 *   · las observaciones del capataz/chequeadora SIGUEN sin ir al maestro (decisión de D65 intacta):
 *     lo que se copia en S no es la observación de la fila, es el sello del día;
 *   · P/Q/R (ESPESOR/FC/CANTIDAD) viajan VACÍAS y "Pegado especial → Omitir blancos" —que ya es el
 *     paso 2 de la guía— deja intactas sus fórmulas. Ese mecanismo es justo lo que hace seguro
 *     extender el bloque cuatro columnas más;
 *   · un día SIN clima se copia exactamente como antes (A:O), así que nada cambia hacia atrás.
 * El valor NO se lee del texto de la observación sino de `climaPorDia` (la columna interna de D37), así
 * que funciona también con los días ya enviados antes de D130 y con cualquier filtro de área — el clima
 * es del día, no de la fila. `CLIMA_SELLO` es el mismo contrato que `CLIMA_SELLO_PREFIJO` de Codigo.gs:
 * si cambia uno, la fórmula del maestro y el otro tienen que cambiar igual. */
const CLIMA_SELLO='[Clima: ';
function climaSello(fecha){
  const cl=(STATE.clima && STATE.clima[fecha]) ? String(STATE.clima[fecha]).trim() : '';
  return cl ? (CLIMA_SELLO+cl+']') : '';
}

// Un botón "Copiar [fecha]" por cada día presente. Independiente de Actividad/UF, pero respeta el
// filtro de ÁREA (D70): "Todas" = día completo; un área = solo las filas de esa área ese día.
function bloqueCopiado(){
  const cF=col('FECHA');
  const pool=filasArea();
  const fr=document.getElementById('fArea').value;
  const tag=fr?(' · '+etiquetaArea(fr)):'';
  const dias=[...new Set(pool.map(r=>String(r[cF]||'')))].filter(Boolean).sort();
  let btns='';
  dias.forEach(d=>{
    const n=pool.filter(r=>String(r[cF]||'')===d).length;
    const cl=climaSello(d);   // D131: el rango del bloque depende de si el día trae clima
    btns+=`<button class="btn-copy" data-on-click="copiarDia('${esc(String(d).replace(/'/g,"\\'"))}',this)">Copiar ${esc(d)}${esc(tag)}`
       + `<small>${n} fila${n!==1?'s':''} · ${cl?'A:S · con clima':'A:O'}</small></button>`;
  });
  return '<div class="copy-card">'
    + '<div class="copy-intro">El pegado al maestro es <b>día a día</b>. Cada botón copia las columnas <b>A a O (hasta LARGO)</b> de ese día, con ORDEN y ACTA vacías. Con el filtro <b>Área</b> en "Todas" se copia el día completo; con un área elegida, solo las filas de esa área. No se copian ESPESOR/FC/CANTIDAD (fórmula del maestro) ni el texto de la OBSERVACIÓN. Los decimales ya salen con <b>coma</b> para el Excel del maestro.'
    + '<br><b>Clima:</b> los días que lo tengan se copian hasta <b>S</b> y llevan el sello <b>[Clima: …]</b> en la columna OBSERVACIÓN de la <b>primera fila</b> del día — de ahí lo lee la tabla de clima del maestro. Las columnas intermedias van vacías y "Omitir blancos" respeta sus fórmulas.</div>'
    + `<div class="copy-btns">${btns}</div>`
    + '<div class="guia"><h4>Cómo pegar en el Excel maestro</h4><ol>'
    + '<li>Clic en la columna <b>A</b> de la primera fila vacía del maestro.</li>'
    + '<li>Clic derecho → <b>Pegado especial</b> → marcar <b>“Omitir blancos”</b> → Aceptar. <b>Es obligatorio</b>: es lo que impide que las columnas vacías pisen las fórmulas.</li>'
    + '<li>Arrastrar hacia abajo las fórmulas de las columnas que las lleven (CANTIDAD, y ORDEN si aplica) en las filas nuevas.</li>'
    + '<li>Si algo se ve mal, <b>Ctrl+Z</b> y reintentar.</li>'
    + '</ol></div></div>';
}

/* Copia al portapapeles el bloque del día. Hasta O (LARGO; la app captura hasta ahí, D14) y, si el día
 * tiene clima, hasta S con el sello en la primera fila (D131, ver arriba). CRÍTICO: las celdas vacías
 * (ORDEN, ACTA, ESPESOR/FC/CANTIDAD y la S de las demás filas) viajan como cadena vacía REAL entre tabs
 * (...\t\t...), nunca se colapsan ni se omiten, para que "Pegado especial → Omitir blancos" respete las
 * fórmulas del maestro. Todas las filas del bloque salen con el MISMO número de columnas.
 * D184: ORDEN (col B) y ACTA (col M) viajan SIEMPRE vacías, aunque la fila de DATA ya las traiga llenas
 * (desde D184 el Worker escribe la ACTA de la fecha): así "Omitir blancos" sigue respetando las fórmulas
 * del Excel, como promete la guía de arriba («con ORDEN y ACTA vacías»). El resto del copiado no cambia. */
function copiarDia(fecha, btn){
  const cF=col('FECHA'), end=col('COPY_END')||15, cObs=col('OBSERVACION');
  const cOrd=col('ORDEN'), cActa=col('ACTA');   // D184: B y M siempre vacías
  const rows=filasArea().filter(r=>String(r[cF]||'')===fecha); // respeta el filtro de Área (D70)
  const sello=climaSello(fecha);
  const text=rows.map((r,idx)=>{
    const cells=[];
    for(let j=0;j<end;j++){ cells.push((j===cOrd || j===cActa) ? '' : celdaCopia(r[j])); }
    if(sello && cObs>=end){
      for(let j=end;j<cObs;j++){ cells.push(''); }   // ESPESOR/FC/CANTIDAD: vacías (fórmula del maestro)
      cells.push(idx===0 ? sello : '');              // el clima es del DÍA: una sola fila lo lleva
    }
    return cells.join('\t');
  }).join('\n');
  copiarTexto(text, btn);
}
// Formatea una celda para el maestro. Los NÚMEROS con decimal salen con COMA (14.5 -> "14,5") porque
// el Excel del maestro usa coma como separador decimal; así se pegan como número y no como texto raro.
// Solo se toca lo que es número de verdad: el texto (CC "3701.02.05", elementos, descripciones) se
// deja intacto, y las celdas vacías siguen siendo cadena vacía real entre tabs.
function celdaCopia(v){
  if(v==null) return '';
  if(typeof v==='number') return String(v).replace('.', ',');
  return String(v);
}

function copiarTexto(text, btn){
  const ok=()=>{ if(btn){ const orig=btn.innerHTML; btn.classList.add('copied'); btn.innerHTML='✓ Copiado'; setTimeout(()=>{btn.classList.remove('copied');btn.innerHTML=orig;},1600); } };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(ok).catch(()=>fallbackCopiar(text,ok));
  } else fallbackCopiar(text,ok);
}
function fallbackCopiar(text, ok){
  const ta=document.createElement('textarea');
  ta.value=text; ta.style.position='fixed'; ta.style.top='-1000px'; ta.style.opacity='0';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try{ document.execCommand('copy'); ok(); }catch(e){ alert('No se pudo copiar automáticamente.'); }
  document.body.removeChild(ta);
}
