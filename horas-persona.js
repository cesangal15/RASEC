// D170: aplica los data-estilo del marcado ANTES de que corra la lógica de la pantalla (ver tema.js).
if(window.TM2Estilos) TM2Estilos.aplicar();
/* ================================================================================================
 * HORAS POR PERSONA (D112) — una persona, un período, el desglose de sus horas
 *
 * EL PROBLEMA QUE RESUELVE. `resumen-asistencia.html` está armado POR DÍA: para reconstruir el mes de
 * una persona —que es lo que hace falta cuando alguien pregunta "¿por qué me pagaron esto?"— había que
 * abrir 26 días uno por uno. Esta es la vista inversa.
 *
 * REGLA DE ORO. Los números de esta pantalla tienen que ser EXACTAMENTE los que van al Parte de
 * Navision. Por eso el backend (`?action=persona`) devuelve las filas CRUDAS de ASISTENCIA y la
 * clasificación la hace aquí `horas-nomina.js`, el mismo archivo que usa el generador del Parte. Si
 * algún día hay que ajustar el cálculo, se ajusta allí y las dos pantallas cambian juntas.
 *
 * SOLO LECTURA de punta a punta: esta pantalla no escribe nada. Las correcciones se siguen haciendo
 * desde el resumen (detalle por cuadrilla / completar faltantes).
 *
 * D142 — LOS DOS CASOS QUE NO ENCAJABAN EN "UNA PERSONA DE ASISTENCIA":
 *   · **El admin.** No está en PERSONAL ni en ASISTENCIA (D73): su jornada ordinaria va por fuera del
 *     sistema y solo registra horas EXTRA de días puntuales, en la hoja `EXTRAS_ADMIN`. Buscarse a sí
 *     mismo en el buscador no podía funcionar — no hay fila que encontrar—, así que tiene entrada
 *     propia (botón, no resultado de búsqueda) y su propio endpoint, `?action=persona_admin`. El
 *     reparto a columnas del Parte lo hace `clasificarExtraAdmin` de `horas-nomina.js`, el mismo que
 *     usa el generador del Excel: la regla de oro de arriba también aplica a su canal.
 *   · **El personal EVENTUAL (D85).** Sí salía en el buscador y sí traía sus días —eso nunca estuvo
 *     roto—, pero se le contaban como "días sin reporte" todos los días en que no trabajó, y a un
 *     eventual justamente NO se le espera en el día a día (el roster, los faltantes y el seguimiento
 *     de ausencias ya lo excluyen). Ahora esta pantalla sigue la misma regla y lo dice en la ficha.
 * ================================================================================================ */
const APPS_SCRIPT_URL = GALCA_ENV.url.asistencias;   // entorno.js (D168): producción o prueba

/* ---------- PERÍODO DE NÓMINA ----------
 * Dato del dueño (jul-2026): se paga MENSUAL el 30/31, pero el corte de EXTRAS Y NOVEDADES es del 10
 * al 10. Así que el período por defecto de esta pantalla es **día 11 del mes anterior → día 10 del mes
 * actual**, inclusive.
 *
 * SUPUESTO A VALIDAR EN CAMPO: el día 10 se cuenta en el período que CIERRA (11 jul → 10 ago incluye
 * el 10 de agosto) y el 11 abre el siguiente, de modo que ningún día queda contado dos veces. Si en la
 * validación resulta que el 10 va en los dos lados, se corrige aquí. El encabezado del período lo
 * escribe a la vista ("11 jul → 10 ago") justamente para que el dueño lo pueda cotejar de un vistazo.
 *
 * Cambiar el día de corte es UNA línea: esta constante. */
const CORTE_DIA = 10;

const MESES=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

let STATE = { usuario:'', rol:'', areaFiltro:'', persona:null, desde:'', hasta:'', etiqueta:'',
  data:null, cargando:false, error:'', personal:null, persError:'', q:'', _pickList:[] };

/* D142 — EL ADMIN NO ES UNA PERSONA DEL ROSTER, y por eso no salía en esta pantalla.
 * Su jornada ordinaria va por fuera del sistema (D73) y lo único que registra son sus horas EXTRA de
 * días puntuales, en la hoja `EXTRAS_ADMIN`, aislada de PERSONAL/CUADRILLAS/ASISTENCIA. Buscarlo en el
 * buscador no podía funcionar: no hay fila que encontrar. Se le da entonces una ENTRADA PROPIA —un
 * botón, no un resultado de búsqueda— que consulta su hoja con el endpoint `?action=persona_admin`.
 * Solo aparece con rol `admin`, que es también el único que puede leer ese endpoint (el guard de verdad
 * está en el backend, sobre el rol del token firmado; esconder el botón no es la seguridad). */
const PERSONA_ADMIN = { _admin:true, codigo:'', cedula:'', nombre:'Mis horas extra',
  cargo:'Canal propio del administrador (D73)', cuadrilla:'', estado:'' };

/* ---------- utilidades ---------- */
function fmtH(n){ return (Math.round((n||0)*100)/100).toString(); }
// D50: SIEMPRE hora de Bogotá (UTC−5), nunca toISOString (de noche devolvía el día siguiente).
function hoyBogota(){ return new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'}); }
function fmtISO(d){ return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
function fmtCorto(iso){ const p=String(iso||'').split('-'); return p.length<3 ? String(iso||'') : (Number(p[2])+' '+MESES[Number(p[1])-1]); }
// D106: misma barrera de fecha que el resto de pantallas del módulo (aquí no se escribe, pero una
// fecha vacía produciría una consulta sin sentido y un `ok:false` críptico del backend).
function fechaValida(v){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))) return false;
  const p=String(v).split('-'), dt=new Date(Number(p[0]), Number(p[1])-1, Number(p[2]));
  return dt.getFullYear()===Number(p[0]) && dt.getMonth()===Number(p[1])-1 && dt.getDate()===Number(p[2]);
}
function loadBar(on){ const b=document.getElementById('loadBar'); if(b) b.classList.toggle('on', !!on); }

/**
 * Período de corte 11→10 desplazado `offsetMeses` (0 = el que contiene HOY, −1 = el anterior).
 * El "mes ancla" es aquel cuyo día 10 CIERRA el período: si hoy es <= 10, cierra este mes; si ya pasó
 * el 10, el período en curso cierra el mes que viene. `new Date` normaliza solo el desbordamiento de
 * meses (mes 13 → enero del año siguiente), así que no hay aritmética de calendario a mano.
 */
function periodoCorte(offsetMeses){
  const p=hoyBogota().split('-'), y=Number(p[0]), m=Number(p[1]), d=Number(p[2]);
  const anclaM = m + (d > CORTE_DIA ? 1 : 0) + (offsetMeses||0);
  const fin = new Date(y, anclaM-1, CORTE_DIA);        // día 10 del mes ancla
  const ini = new Date(y, anclaM-2, CORTE_DIA+1);      // día 11 del mes anterior
  return { desde:fmtISO(ini), hasta:fmtISO(fin) };
}
function mesCalendario(){
  const p=hoyBogota().split('-'), y=Number(p[0]), m=Number(p[1]);
  return { desde:fmtISO(new Date(y, m-1, 1)), hasta:fmtISO(new Date(y, m, 0)) };   // día 0 = último del mes
}
function etiquetaPeriodo(desde, hasta){ return fmtCorto(desde)+' → '+fmtCorto(hasta); }

/* ---------- arranque ---------- */
window.onload = function(){
  const rol=localStorage.getItem('rol'), usuario=localStorage.getItem('usuario');
  // Guard COPIADO de `resumen-asistencia.html` (decisión del dueño, D112): entra exactamente quien ya
  // entra al resumen — residente(tierras), admin, jeisson (asistencia_plus), duvan
  // (asistencia_plus_dren), residente_uf3 (asistencia_plus_uf3) y los residentes de drenajes—, cada uno
  // acotado a su área POR EL BACKEND. Los trabajadores no tienen login: consultan a través de quien
  // revisa el resumen.
  // D119: `asistencia_plus_tm2` (angie) entra por la misma puerta — no estrena rol aquí, entra quien
  // entra al resumen; el backend acota la consulta a sus áreas (tierras+ODT+ODL).
  const rolesOk=['residente','admin','asistencia_plus','asistencia_plus_dren','asistencia_plus_uf3','asistencia_plus_tm2','residente_odt','residente_odl','residente_dren'];
  if(!rol || rolesOk.indexOf(rol)<0){ window.location.href='index.html'; return; }
  STATE.usuario=usuario; STATE.rol=rol;
  document.getElementById('userDisplay').textContent=usuario;
  document.getElementById('btnBack').onclick=function(){ location.href='resumen-asistencia.html'; };
  const per=periodoCorte(0);
  STATE.desde=per.desde; STATE.hasta=per.hasta;
  render();
  cargarPersonal();
};
function logout(){ localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token'); window.location.href='index.html'; }

/* ---------- BUSCADOR DE PERSONAS ----------
 * Sin endpoint nuevo: reusa `?action=personal`, que ya viene ACOTADO POR ÁREA por el backend y trae
 * codigo·cedula·nombre·cargo·cuadrilla·estado·fecha_ingreso·fecha_retiro. Mismo patrón del buscador de
 * CC (D78) y del de "completar faltantes".
 * Incluye a RETIRADOS y EVENTUALES (marcados como tales): a un retirado es justamente a quien se le
 * consultan las horas del último mes. */
async function cargarPersonal(){
  STATE.persError='';
  try{
    const url=`${APPS_SCRIPT_URL}?action=personal&usuario=${encodeURIComponent(STATE.usuario)}&area=${encodeURIComponent(STATE.areaFiltro||'')}`;
    const resp=await fetch(url);
    const data=await resp.json();
    if(!data.ok) throw new Error(data.error||'personal');
    STATE.personal=data.personal||[];
  }catch(err){
    STATE.persError=err.message||String(err);
  }
  render();
}
function persTag(p){
  const e=String(p.estado||'activo').toLowerCase();
  if(e==='eventual') return '<span class="badge">eventual</span>';
  if(e!=='activo')   return '<span class="badge sin">retirado</span>';
  if(p.fecha_retiro) return '<span class="badge sin">retiro '+esc(p.fecha_retiro)+'</span>';
  return '';
}
function persFiltrar(q){
  STATE.q=q;
  const box=document.getElementById('persResults'); if(!box) return;
  const s=String(q||'').trim().toLowerCase();
  if(!s){ box.style.display='none'; box.innerHTML=''; STATE._pickList=[]; return; }
  const lista=(STATE.personal||[]).filter(p=>
    (String(p.nombre||'')+' '+String(p.codigo||'')+' '+String(p.cedula||'')+' '+String(p.cuadrilla||'')+' '+String(p.cargo||''))
      .toLowerCase().indexOf(s)>=0);
  STATE._pickList=lista.slice(0,60);
  let h='';
  if(!STATE._pickList.length) h='<div class="pers-opt" data-estilo="cursor:default;color:var(--muted)">Sin coincidencias</div>';
  else STATE._pickList.forEach((p,i)=>{
    h+=`<div class="pers-opt" data-on-mousedown="persElegir(${i})"><b>${esc(p.nombre)}</b> ${persTag(p)}`
     + `<small>${esc(p.cargo||'')} · ${esc(p.cuadrilla||'')} · cód. ${esc(p.codigo||'—')}${p.cedula?' · c.c. '+esc(p.cedula):''}</small></div>`;
  });
  if(lista.length>STATE._pickList.length) h+=`<div class="pers-opt" data-estilo="cursor:default;color:var(--muted)">…y ${lista.length-STATE._pickList.length} más · escribe para afinar</div>`;
  box.innerHTML=h; box.style.display='block';
}
function persBlur(){ setTimeout(function(){ const b=document.getElementById('persResults'); if(b) b.style.display='none'; }, 200); }
function persElegir(i){
  const p=(STATE._pickList||[])[i]; if(!p) return;
  STATE.persona=p; STATE.q=''; STATE.data=null; STATE.error='';
  consultar();
}
// D142: entrada propia del admin a SUS horas (EXTRAS_ADMIN, D73) — no pasa por el buscador porque no
// está en PERSONAL. `_pickList` no se toca: no es un resultado de búsqueda, es otro origen de datos.
function persElegirAdmin(){
  STATE.persona=PERSONA_ADMIN; STATE.q=''; STATE.data=null; STATE.error='';
  const box=document.getElementById('persResults'); if(box){ box.style.display='none'; box.innerHTML=''; }
  consultar();
}
// D74b/D101: solo el admin puede cambiar de área ("ver como"). Los demás vienen acotados por el backend.
function onAreaFiltro(v){
  STATE.areaFiltro=v; STATE.persona=null; STATE.data=null; STATE.personal=null;
  render(); cargarPersonal();
}

/* ---------- PERÍODO ---------- */
function setPeriodo(cual){
  let r;
  if(cual==='actual')      r=periodoCorte(0);
  else if(cual==='anterior') r=periodoCorte(-1);
  else                     r=mesCalendario();
  STATE.desde=r.desde; STATE.hasta=r.hasta;
  if(STATE.persona) consultar(); else render();
}
function onRangoLibre(){
  const de=document.getElementById('inpDesde'), ha=document.getElementById('inpHasta');
  const d=de?de.value:'', h=ha?ha.value:'';
  // D106: fecha vacía/incompleta no se acepta (misma validación que asistencia.html y el resumen).
  if(!fechaValida(d) || !fechaValida(h)){
    alert('⚠️ Alguna de las dos fechas quedó vacía o incompleta.\n\nSe mantiene el período ' + etiquetaPeriodo(STATE.desde, STATE.hasta) + '. Elige los días en el calendario.');
    render(); return;
  }
  if(h < d){ alert('El período está invertido: "Hasta" es anterior a "Desde".'); return; }
  STATE.desde=d; STATE.hasta=h;
  if(STATE.persona) consultar(); else render();
}

/* ---------- CONSULTA ---------- */
async function consultar(){
  const p=STATE.persona;
  if(!p){ alert('Primero busca y elige a la persona.'); return; }
  if(!fechaValida(STATE.desde) || !fechaValida(STATE.hasta)){ alert('El período no es válido. Elige las dos fechas.'); return; }
  STATE.cargando=true; STATE.error=''; STATE.data=null;
  render(); loadBar(true);
  try{
    // `codigo` manda; solo si la persona no tiene código se consulta por cédula (mismo criterio que
    // keyPersona en el backend). El cerrojo de área lo aplica el BACKEND, no esta pantalla.
    const codigo=String(p.codigo||'').trim();
    // D142: las horas del propio admin salen de OTRA hoja (EXTRAS_ADMIN, D73) y por eso de otro
    // endpoint. No lleva `codigo` ni `area`: no se acota por área sino por rol, y el rol lo saca el
    // backend del token firmado.
    const url = p._admin
      ? `${APPS_SCRIPT_URL}?action=persona_admin&desde=${STATE.desde}&hasta=${STATE.hasta}`
        + `&usuario=${encodeURIComponent(STATE.usuario)}`
      : `${APPS_SCRIPT_URL}?action=persona&codigo=${encodeURIComponent(codigo)}`
        + `&cedula=${encodeURIComponent(codigo?'':String(p.cedula||'').trim())}`
        + `&desde=${STATE.desde}&hasta=${STATE.hasta}`
        + `&usuario=${encodeURIComponent(STATE.usuario)}&area=${encodeURIComponent(STATE.areaFiltro||'')}`;
    const resp=await fetch(url);
    const data=await resp.json();
    if(!data.ok) throw new Error(data.error||'persona');
    // Apps Script SIN redesplegar: doGet devuelve {ok:true, msg:'API Asistencias viva'} para una acción
    // que todavía no conoce. Se detecta por la ausencia de `filas` y se avisa con la causa real.
    if(!data.filas) throw new Error('El Apps Script de asistencias todavía no tiene el endpoint de "'+(p._admin?'persona_admin':'persona')+'". Redespliega CodigoAsistencias.gs (editar implementación → versión nueva, misma URL).');
    STATE.data=data;
  }catch(err){ STATE.error=err.message||String(err); }
  STATE.cargando=false; loadBar(false);
  render();
}

/* ---------- CÁLCULO (con el clasificador COMPARTIDO) ----------
 * `enParte`: qué filas llegan realmente al Excel de Navision. Es el mismo criterio que usa el backend
 * para dar una fila por buena (`filaValida`) y el generador para armar el archivo: ausente con motivo,
 * o presente CON centro de costo. Un "presente sin CC" NO sale en el Parte (no tiene proyecto con el
 * que filtrarlo), así que sus horas NO se suman a los totales — si no, esta pantalla mostraría horas
 * que a la persona no se le pagaron. Se listan aparte, con aviso, para que se completen desde el
 * resumen. */
function enParte(f){ return f.presente==='No' || (f.presente==='Si' && !!String(f.cc||'').trim()); }
// Horas TRABAJADAS de una clasificación. El recargo nocturno ordinario (col G) NO se suma: es un
// recargo sobre horas que ya están contadas en las ordinarias, no horas adicionales.
function horasTrabajadas(cl){ return (cl.ordinarias||0)+(cl.ord_domfest||0)+(cl.extra_diurna||0)+(cl.extra_nocturna||0)+(cl.extra_domfest||0); }
function etiquetaTipoDia(t){ return t==='domfest' ? 'Dom-Fest' : (t==='sabado' ? 'Sábado' : 'L-V'); }
// D142: los tres tipos que guarda EXTRAS_ADMIN (D73), con el nombre que usa `mis-extras.html`.
function etiquetaTipoExtra(t){
  const s=String(t||'').toLowerCase();
  return s==='nocturna' ? 'nocturna' : (s==='domfest' ? 'domingo/festivo' : 'diurna');
}
// Ventana activa de la persona (D72): [fecha_ingreso, fecha_retiro). El retiro es el PRIMER día NO
// trabajado, así que los días desde el retiro no se le esperan y no cuentan como "sin reporte".
function activaEn(per, fecha){
  if(!per || !per.enPersonal) return true;
  if(per.fecha_ingreso && fecha < per.fecha_ingreso) return false;
  if(per.fecha_retiro  && fecha >= per.fecha_retiro) return false;
  return true;
}
function diasDelRango(desde, hasta){
  const p=String(desde).split('-'), out=[];
  let d=new Date(Number(p[0]), Number(p[1])-1, Number(p[2])), guard=0;
  while(guard++ < 400){
    const s=fmtISO(d);
    if(s>hasta) break;
    out.push(s); d.setDate(d.getDate()+1);
  }
  return out;
}
/** Clasifica TODO el período de una vez. Devuelve totales, el detalle fila a fila y los desgloses. */
function calcular(d){
  const cfg=d.config||{}, festivos=d.festivos||[], turnos=d.turnos||[], filas=d.filas||[];
  const tot={ ordinarias:0, ord_domfest:0, extra_diurna:0, extra_nocturna:0, recargo_noct_ord:0, extra_domfest:0 };
  const detalle=[], porCC={}, porMotivo={}, fuera=[];
  const diasTrab={}, diasAus={}, conFila={};

  /* D142 — LAS EXTRAS DEL ADMIN (D73) llevan su propia rama, corta a propósito.
   * `EXTRAS_ADMIN` no guarda entrada/salida sino un TOTAL de horas y un TIPO, así que `clasificarHoras`
   * no tiene nada que repartir: el reparto a columnas del Parte lo hace `clasificarExtraAdmin`, el
   * mismo de `horas-nomina.js` que usa `buildAdminExtraRow` al generar el Excel de Navision. De ahí que
   * los números de aquí no puedan discrepar del archivo importado, que es toda la razón de ser de esta
   * pantalla. Lo que NO aplica y por eso no se calcula: ausencias (no se reporta ausencia en un canal
   * de extras) ni "días sin reporte" (su jornada ordinaria va por fuera del sistema — contar como
   * hueco cada día sin extra sería contar mal a propósito). */
  if(d.esAdmin){
    filas.forEach(function(ex){
      const tipoJ=tipoJornadaDeFecha(ex.fecha, festivos);
      const cl=clasificarExtraAdmin(ex, cfg);
      const f={ fecha:ex.fecha, reporta:ex.reporta||'', cuadrilla:'', codigo:'', cedula:'', nombre:'', cargo:'',
        cc:ex.cc||'', proyecto:ex.proyecto||'', hora_entrada:'', hora_salida:'', presente:'Si',
        motivo_ausencia:'', turno:'',
        observacion:'Extra '+etiquetaTipoExtra(ex.tipo)+' · '+fmtH(ex.horas)+' h registradas' };
      conFila[ex.fecha]=true; diasTrab[ex.fecha]=true;
      Object.keys(tot).forEach(k=>{ tot[k]+=(cl[k]||0); });
      const cc=String(ex.cc||'').trim();
      if(cc) porCC[cc]=(porCC[cc]||0)+horasTrabajadas(cl);
      detalle.push({ f, cl, tipoJ, ausente:false, sinCC:false, enParte:true });
    });
    Object.keys(tot).forEach(k=>{ tot[k]=Math.round(tot[k]*100)/100; });
    Object.keys(porCC).forEach(k=>{ porCC[k]=Math.round(porCC[k]*100)/100; });
    detalle.sort(function(a,b){ return a.f.fecha<b.f.fecha ? -1 : (a.f.fecha>b.f.fecha ? 1 : 0); });
    return { tot, detalle, porCC, porMotivo, fuera, sinReporte:[],
      diasTrabajados:Object.keys(diasTrab).length, diasAusentes:0 };
  }

  filas.forEach(function(f){
    const tipoJ=tipoJornadaDeFecha(f.fecha, festivos);
    const tr=turnoRowFor(f.turno, f.fecha, turnos, tipoJ);
    const ausente=f.presente==='No';
    const sinCC=!ausente && !String(f.cc||'').trim();
    // MISMO cálculo que buildParteRow del generador: el ausente va al Parte con TODAS las horas en 0.
    const cl = ausente ? { ordinarias:0, ord_domfest:0, extra_diurna:0, extra_nocturna:0, recargo_noct_ord:0, extra_domfest:0, avisoExtra:false, avisoDomFest:false }
                       : clasificarHoras(tipoJ, f.hora_entrada, f.hora_salida, cfg, tr);
    conFila[f.fecha]=true;
    if(ausente){ diasAus[f.fecha]=true; porMotivo[f.motivo_ausencia||'(sin motivo)']=(porMotivo[f.motivo_ausencia||'(sin motivo)']||0)+1; }
    else if(sinCC){ fuera.push({ f, cl, tipoJ }); }
    else {
      diasTrab[f.fecha]=true;
      Object.keys(tot).forEach(k=>{ tot[k]+=(cl[k]||0); });
      const cc=String(f.cc).trim();
      porCC[cc]=(porCC[cc]||0)+horasTrabajadas(cl);
    }
    detalle.push({ f, cl, tipoJ, ausente, sinCC, enParte:enParte(f) });
  });
  Object.keys(tot).forEach(k=>{ tot[k]=Math.round(tot[k]*100)/100; });
  Object.keys(porCC).forEach(k=>{ porCC[k]=Math.round(porCC[k]*100)/100; });
  // Días SIN REPORTE: no hay fila ese día. NO es una ausencia (D81: en dom/fest de tierras es lo
  // normal, y esos días trabaja solo el personal disponible), así que va en su propio contador y nunca
  // se suma a las ausencias. Los domingos/festivos ni siquiera se cuentan aquí.
  const sinReporte=[];
  /* D142 — al personal EVENTUAL (D85: `estado=eventual` en PERSONAL, p. ej. el encargado Javier) NO se
   * le cuentan días sin reporte, y esto no es una excepción de esta pantalla: es la misma regla que ya
   * aplican el roster del responsable, los faltantes del día y el seguimiento de ausencias (D94). A un
   * eventual NO se le espera en el día a día — trabaja en ocasiones puntuales—, así que marcarle 25
   * "días sin reporte" en un período de 26 era decir que falta algo cuando no falta nada, y enterraba
   * los dos o tres días que sí trabajó bajo un aviso rojo que había que aprender a ignorar. */
  const eventual = String((d.persona||{}).estado||'').toLowerCase()==='eventual';
  if(!eventual) diasDelRango(d.desde, d.hasta).forEach(function(fe){
    if(conFila[fe]) return;
    if(!activaEn(d.persona, fe)) return;                       // aún no ingresaba / ya estaba retirada
    if(tipoJornadaDeFecha(fe, festivos)==='domfest') return;    // dom/fest sin reporte = normal
    sinReporte.push(fe);
  });
  detalle.sort(function(a,b){ return a.f.fecha<b.f.fecha ? -1 : (a.f.fecha>b.f.fecha ? 1 : 0); });
  return { tot, detalle, porCC, porMotivo, fuera, sinReporte,
    diasTrabajados:Object.keys(diasTrab).length, diasAusentes:Object.keys(diasAus).length };
}

/* ---------- RENDER ---------- */
function render(){
  let h='';

  // 1) Persona + período (los controles van SIEMPRE arriba, con o sin consulta hecha)
  h+='<div class="card">';
  h+='<div class="row">'
   + '<div class="field"><label>Persona</label><div class="pers-search">'
   +   `<input type="text" id="persQ" placeholder="Buscar por nombre, código o cédula…" autocomplete="off" value="${esc(STATE.q)}" data-on-input="persFiltrar(this.value)" data-on-focus="persFiltrar(this.value)" data-on-blur="persBlur()">`
   +   '<div class="pers-results" id="persResults" data-estilo="display:none;"></div></div></div>'
   + (STATE.rol==='admin' ? '<div class="field" data-estilo="max-width:170px;"><label>Ver como</label><select data-on-change="onAreaFiltro(this.value)">'
       + ['','tierras','odt','odl','uf3'].map(a=>`<option value="${a}" ${STATE.areaFiltro===a?'selected':''}>${a===''?'Todas las áreas':(a==='tierras'?'Tierras':a.toUpperCase())}</option>`).join('')
       + '</select></div>' : '')
   + '</div>';
  if(STATE.persError) h+='<div class="aviso">⚠️ No se pudo cargar el listado de personal: '+esc(STATE.persError)+'</div>';
  else if(!STATE.personal) h+='<p data-estilo="font-size:12px;color:var(--muted);margin-top:8px;">⏳ Cargando el listado de personal…</p>';
  // D142: se dice A LA VISTA a quién alcanza el buscador. El eventual y el retirado SÍ están (y son
  // justo a quienes se les consulta el período), pero eso no se adivina de un campo de texto vacío.
  else h+='<p data-estilo="font-size:11px;color:var(--muted);margin-top:8px;">Incluye al personal <b>eventual</b> (D85) y a los <b>retirados</b>: son a quienes más se les revisa el período.</p>';
  // D142: el admin no está en PERSONAL (D73) — no hay a quién buscar, así que tiene entrada propia.
  if(STATE.rol==='admin'){
    const on = !!(STATE.persona && STATE.persona._admin);
    h+='<div data-estilo="margin-top:10px;">'
     + `<button class="mini-btn${on?' on':''}" data-on-click="persElegirAdmin()">🧑‍💼 Mis horas extra (${esc(STATE.usuario)})</button>`
     + '<span data-estilo="font-size:11px;color:var(--muted);">Tu jornada ordinaria va por fuera del sistema (D73); aquí salen las horas extra que registras en «Mis horas extra».</span>'
     + '</div>';
  }

  // Período: botones rápidos (11→10) + rango libre
  h+='<div data-estilo="margin-top:14px;">'
   + '<label>Período</label>'
   + '<div data-estilo="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">'
   +   btnPeriodo('actual',   'Período actual (11→10)')
   +   btnPeriodo('anterior', 'Período anterior')
   +   btnPeriodo('mes',      'Mes calendario')
   + '</div>'
   + '<div class="row">'
   +   `<div class="field" data-estilo="max-width:170px;"><label>Desde</label><input type="date" id="inpDesde" value="${esc(STATE.desde)}" data-on-change="onRangoLibre()"></div>`
   +   `<div class="field" data-estilo="max-width:170px;"><label>Hasta</label><input type="date" id="inpHasta" value="${esc(STATE.hasta)}" data-on-change="onRangoLibre()"></div>`
   +   '<div class="field" data-estilo="flex:0;"><button class="btn" data-on-click="consultar()">Consultar →</button></div>'
   + '</div>'
   + `<p data-estilo="font-size:12px;color:var(--accent-txt);margin-top:10px;">📅 Período a consultar: <b>${esc(etiquetaPeriodo(STATE.desde, STATE.hasta))}</b> `
   + `<span data-estilo="color:var(--muted)">(${esc(STATE.desde)} a ${esc(STATE.hasta)}, ambos incluidos)</span></p>`
   // Supuesto escrito a la vista, para que el dueño lo corrija en la validación si el 10 va en los dos lados.
   + `<p data-estilo="font-size:11px;color:var(--muted);margin-top:4px;">El corte de extras y novedades es del <b>${CORTE_DIA}</b> al <b>${CORTE_DIA}</b>: el período va del día ${CORTE_DIA+1} del mes anterior al día ${CORTE_DIA} de este mes, ambos inclusive (el día ${CORTE_DIA} cuenta en el período que cierra, no en el que abre).</p>`
   + '</div>';
  h+='</div>';

  // 2) Resultado
  if(STATE.cargando){ h+='<div class="loading">⏳ Consultando el período…</div>'; }
  else if(STATE.error){ h+='<div class="aviso">⚠️ '+esc(STATE.error)+'</div>'; }
  else if(!STATE.data){
    h+= STATE.persona
      ? `<div class="empty-state">Elige el período y pulsa <b>Consultar</b>.</div>`
      : '<div class="empty-state">Busca a la persona por nombre, código o cédula para ver sus horas del período.</div>';
  } else {
    h+=resultadoHtml(STATE.data);
  }

  // 3) Aviso permanente al pie (va siempre, con o sin consulta)
  h+='<div class="pie">ℹ️ <b>Estas son las horas reportadas y enviadas a Navision.</b> La liquidación final la hace nómina; '
   + 'este resumen sirve para revisar los días y las horas, no es un desprendible de pago.</div>';

  document.getElementById('container').innerHTML=h;
  // Render progresivo (D99): la tabla día a día se arma DESPUÉS de pintar totales y desgloses, que es
  // lo que se mira primero. Con períodos de un mes son ~26 filas × 17 columnas.
  if(STATE.data) pintarDetalleDiferido();
}
function btnPeriodo(cual, txt){
  const r = cual==='mes' ? mesCalendario() : periodoCorte(cual==='anterior'?-1:0);
  const on = (r.desde===STATE.desde && r.hasta===STATE.hasta);
  return `<button class="mini-btn${on?' on':''}" data-on-click="setPeriodo('${cual}')">${esc(txt)}</button>`;
}

function resultadoHtml(d){
  const c=calcular(d);
  STATE._calc=c;   // lo reusan el CSV, el "copiar resumen" y el detalle diferido
  const p=d.persona||{};
  let h='';

  // --- Ficha de la persona ---
  const estado=String(p.estado||'').toLowerCase();
  const esAdmin=!!d.esAdmin;
  const tag = esAdmin ? '<span class="badge ok">canal propio (D73)</span>'
            : !p.enPersonal ? '<span class="badge sin">fuera de PERSONAL</span>'
            : estado==='eventual' ? '<span class="badge">eventual</span>'
            : (estado && estado!=='activo') ? '<span class="badge sin">retirado</span>'
            : '<span class="badge ok">activo</span>';
  h+='<div class="ficha">'
   + `<h2>${esc(esAdmin?('Mis horas extra — '+String(p.nombre||'').toUpperCase()):(p.nombre||'—'))} ${tag}</h2>`
   + '<div class="meta">'
   +   (esAdmin
        ? `No. Recurso Navision <b>${esc(p.codigo||'(sin definir en CONFIG.admin_recurso)')}</b><br>`
          + 'Solo <b>horas extra de días puntuales</b>: tu jornada ordinaria va por fuera del sistema y no aparece en el Parte.'
        : `Código <b>${esc(p.codigo||'—')}</b>${p.cedula?' · c.c. '+esc(p.cedula):''}<br>`
          + `${esc(p.cargo||'—')} · cuadrilla <b>${esc(p.cuadrilla||'—')}</b>`
          + (p.fecha_ingreso?`<br>Ingreso: ${esc(p.fecha_ingreso)}`:'')
          + (p.fecha_retiro?` · <span data-estilo="color:var(--accent-txt)">Retiro: ${esc(p.fecha_retiro)}</span> <small>(primer día que ya no trabaja)</small>`:''))
   + '</div>'
   + `<div class="meta" data-estilo="margin-top:8px;color:var(--accent-txt);">📅 ${esc(etiquetaPeriodo(d.desde, d.hasta))} · ${esc(d.dias)} día(s) · ${(d.filas||[]).length} registro(s)</div>`
   + '</div>';
  // D142: al eventual (D85) no se le esperan días, y decirlo aquí evita que "0 días sin reporte" se lea
  // como que faltó información. Al admin se le explica de dónde salen sus filas.
  if(!esAdmin && estado==='eventual'){
    h+='<div class="aviso" data-estilo="color:var(--muted);border-color:var(--border);background:var(--surface2);margin-top:0;margin-bottom:16px;">'
     + 'ℹ️ Es <b>personal eventual</b> (D85): no se le espera en el día a día, trabaja en ocasiones puntuales. '
     + 'Por eso <b>no se cuentan "días sin reporte"</b> — solo salen los días que sí se le marcaron.</div>';
  }

  // --- Totales del período. Se nombran IGUAL que en el Parte (entre paréntesis, con su letra de
  // columna) para que un reclamo se pueda cotejar contra el archivo de Navision línea por línea. ---
  h+='<div class="section-title">Totales del período</div>';
  h+='<div class="kpis">'
   + kpi(fmtH(c.tot.ordinarias),       'Ordinarias',            'Horas ordinarias (C)')
   + kpi(fmtH(c.tot.ord_domfest),      'Ordinarias Dom/Fest',   'Horas ordinarias Dom/Fest (D)')
   + kpi(fmtH(c.tot.extra_diurna),     'Extra diurna',          'Horas extras diurnas (E)')
   + kpi(fmtH(c.tot.extra_nocturna),   'Extra nocturna',        'Horas extras nocturnas (F)')
   + kpi(fmtH(c.tot.recargo_noct_ord), 'Recargo noct. ord.',    'Recargo hora nocturna ord (G)')
   + kpi(fmtH(c.tot.extra_domfest),    'Extra diurna Dom/Fest', 'Horas extras diurnas Dom/Fest (H)')
   + '</div>';
  h+='<div class="kpis" data-estilo="margin-top:10px;">'
   + (esAdmin
      // D142: en el canal de extras "días ausentes" y "sin reporte" no significan nada (no se reporta
      // ausencia, y la jornada ordinaria va por fuera). Se enseña lo que sí tiene sentido contar.
      ? kpi(c.diasTrabajados, 'Días con extra', 'días del período con horas registradas', true)
      : kpi(c.diasTrabajados, 'Días trabajados', '', true)
        + kpi(c.diasAusentes,   'Días ausentes',   'reportado ausente, con motivo', true)
        + kpi(c.sinReporte.length, 'Sin reporte',  'no hay fila ese día — no es una ausencia', true))
   + '</div>';
  h+='<p data-estilo="font-size:11px;color:var(--muted);margin-top:8px;">El <b>recargo nocturno ordinario (G)</b> es un recargo sobre horas que ya están contadas en las ordinarias: no se suma al total de horas trabajadas.</p>';

  // --- Avisos ---
  if(c.fuera.length){
    h+='<div class="aviso">⚠️ Hay <b>'+c.fuera.length+' día(s) reportados como presente pero SIN centro de costo</b> ('
     + c.fuera.map(x=>esc(x.f.fecha)).join(', ') + '). Esas filas <b>no salen en el Parte de Navision</b> y por eso '
     + 'no están sumadas arriba. Complétalas desde el <b>Resumen de asistencias</b> (detalle por cuadrilla) y vuelve a consultar.</div>';
  }
  if(c.sinReporte.length){
    const muestra=c.sinReporte.slice(0,10).join(', ')+(c.sinReporte.length>10?` …y ${c.sinReporte.length-10} más`:'');
    h+='<div class="aviso" data-estilo="color:var(--muted);border-color:var(--border);background:var(--surface2);">📄 <b>'+c.sinReporte.length+' día(s) sin reporte</b> ('+esc(muestra)+'). '
     + 'No hay fila de esa persona esos días: <b>no es una ausencia</b> (nadie reportó nada), y no se suma a los días ausentes. '
     + 'Los domingos y festivos no se cuentan aquí (D81: ese día trabaja solo el personal disponible).</div>';
  }

  // --- Desgloses del período ---
  const ccs=Object.keys(c.porCC).sort((a,b)=>c.porCC[b]-c.porCC[a]);
  h+='<div class="section-title">Horas por centro de costo</div><div class="card">';
  if(!ccs.length) h+='<p data-estilo="font-size:13px;color:var(--muted);">Sin horas trabajadas en el período.</p>';
  else ccs.forEach(cc=>{ h+=`<div class="cuad-row"><span data-estilo="flex:1;white-space:normal;">${esc(cc)}</span><b>${fmtH(c.porCC[cc])} h</b></div>`; });
  h+='</div>';

  if(!esAdmin){   // D142: el canal de extras no reporta ausencias — la sección no aplica
    const mots=Object.keys(c.porMotivo).sort((a,b)=>c.porMotivo[b]-c.porMotivo[a]);
    h+='<div class="section-title">Ausencias por motivo</div><div class="card">';
    if(!mots.length) h+='<p data-estilo="font-size:13px;color:var(--muted);">Sin ausencias reportadas en el período.</p>';
    else mots.forEach(m=>{ h+=`<div class="cuad-row"><span data-estilo="flex:1;white-space:normal;">${esc(m)}</span><b>${c.porMotivo[m]} día(s)</b></div>`; });
    h+='</div>';
  }

  // --- Detalle día a día (se arma diferido; aquí solo el contenedor) ---
  h+='<div class="section-title">Detalle día a día ('+c.detalle.length+')</div>';
  h+='<div class="card" id="detalleCard"><div class="loading" data-estilo="padding:18px;">⏳ Armando el detalle…</div></div>';

  // --- Descargas ---
  h+='<div data-estilo="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px;">'
   + `<button class="btn-ghost" data-on-click="descargarCSV()">⬇️ Descargar CSV (${c.detalle.length} fila(s))</button>`
   + '<button class="btn-ghost" data-on-click="copiarResumen(this)">📋 Copiar resumen</button>'
   + '</div>';
  return h;
}
function kpi(val, lbl, col, neutro){
  return `<div class="kpi${neutro?' neutro':''}"><div class="k-val">${esc(String(val))}</div>`
    + `<div class="k-lbl">${esc(lbl)}${col?`<span class="k-col">${esc(col)}</span>`:''}</div></div>`;
}

// Render progresivo (D99): totales y desgloses primero, la tabla después. Con el navegador ocioso se
// arma sin que el usuario perciba el corte; el respaldo es un setTimeout.
function pintarDetalleDiferido(){
  const pintar=function(){
    const box=document.getElementById('detalleCard');
    if(box && STATE._calc) box.innerHTML=detalleHtml(STATE._calc);
  };
  if(window.requestIdleCallback) requestIdleCallback(pintar, {timeout:800}); else setTimeout(pintar, 0);
}
function detalleHtml(c){
  if(!c.detalle.length){
    // D142: el vacío del canal de extras se explica distinto — no es que falte información, es que no
    // se registró ninguna extra en el período (y se dice dónde se registran).
    return (STATE.data && STATE.data.esAdmin)
      ? '<p data-estilo="font-size:13px;color:var(--muted);">No registraste ninguna hora extra en este período. Se registran en <b>«Mis horas extra»</b> del menú.</p>'
      : '<p data-estilo="font-size:13px;color:var(--muted);">No hay ningún registro de esta persona en el período.</p>';
  }
  // La tabla lleva 17 columnas y la pantalla es mobile-first: en el teléfono las columnas de horas
  // quedan fuera de la vista y no se adivina que hay que deslizar. El aviso solo sale en pantallas
  // estrechas (en el PC la tabla cabe entera).
  let h='<p class="hint-scroll" data-estilo="font-size:11px;color:var(--muted);margin-bottom:8px;">👉 Desliza la tabla a la izquierda para ver las columnas de horas.</p>';
  h+='<div class="tabla-wrap"><table><thead><tr>'
   + ['Fecha','Tipo de día','Cuadrilla','Turno','Entrada','Salida','CC','Proy.',
      'Ord. (C)','Dom/Fest (D)','Ex. diurna (E)','Ex. noct. (F)','Rec. noct. (G)','Ex. D/F (H)',
      'Ausente','Reportó','Observación'].map(t=>`<th>${esc(t)}</th>`).join('')
   + '</tr></thead><tbody>';
  c.detalle.forEach(function(x){
    const f=x.f, cl=x.cl;
    // Naranja igual que el export: la fila que superó el tope de extras (avisoExtra) o la jornada
    // dom/fest (avisoDomFest) es la que hay que revisar a mano.
    const clase = (cl.avisoExtra||cl.avisoDomFest) ? 'aviso-fila' : (x.ausente ? 'ausente-fila' : '');
    const num=v=>`<td class="num">${v?fmtH(v):''}</td>`;
    h+=`<tr class="${clase}">`
     + `<td><b>${esc(f.fecha)}</b></td>`
     + `<td>${esc(etiquetaTipoDia(x.tipoJ))}</td>`
     + `<td>${esc(f.cuadrilla||'')}</td>`
     + `<td>${x.ausente?'':esc(f.turno?('T'+f.turno):'—')}</td>`
     + `<td>${esc(f.hora_entrada||'')}</td><td>${esc(f.hora_salida||'')}</td>`
     + `<td data-estilo="white-space:normal;min-width:180px;">${esc(f.cc||'')}${x.sinCC?' <span class="badge sin">sin CC · no va al Parte</span>':''}</td>`
     + `<td>${esc(f.proyecto||'')}</td>`
     + num(cl.ordinarias)+num(cl.ord_domfest)+num(cl.extra_diurna)+num(cl.extra_nocturna)+num(cl.recargo_noct_ord)+num(cl.extra_domfest)
     + `<td>${x.ausente?`<span class="badge aus">${esc(f.motivo_ausencia||'(sin motivo)')}</span>`:''}</td>`
     + `<td>${esc(f.reporta||'')}</td>`
     + `<td data-estilo="white-space:normal;min-width:160px;color:var(--muted);">${esc(f.observacion||'')}</td>`
     + '</tr>';
  });
  h+='</tbody></table></div>';
  h+='<p data-estilo="font-size:11px;color:var(--muted);margin-top:10px;">Las filas en naranja superaron el tope de extras del día (o la jornada de domingo/festivo): el Parte reporta solo el tope y el excedente se revisa a mano.</p>';
  return h;
}

/* ---------- DESCARGA CSV ----------
 * Mismo patrón que el CSV de ausencias (D94): UTF-8 con BOM y separador ';' (Excel en español lo abre
 * en columnas sin pasos extra). Es el detalle de lo que se ve, no el Parte de Navision. */
function descargarCSV(){
  const c=STATE._calc, d=STATE.data; if(!c || !d) return;
  const p=d.persona||{};
  const esc2=v=>{ const s=String(v==null?'':v); return /[";\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const cab=['Fecha','Tipo de dia','Codigo','Cedula','Nombre','Cargo','Cuadrilla','Turno','Entrada','Salida',
    'CC','Proyecto','Horas ordinarias (C)','Horas ordinarias Dom/Fest (D)','Horas extras diurnas (E)',
    'Horas extras nocturnas (F)','Recargo hora nocturna ord (G)','Horas extras diurnas Dom/Fest (H)',
    'Ausente','Motivo ausencia','Reporto','Observacion','Aviso'];
  const lineas=[cab.join(';')];
  c.detalle.forEach(function(x){
    const f=x.f, cl=x.cl;
    lineas.push([f.fecha, etiquetaTipoDia(x.tipoJ), f.codigo||p.codigo||'', f.cedula||p.cedula||'', f.nombre||p.nombre||'',
      f.cargo||p.cargo||'', f.cuadrilla||'', f.turno||'', f.hora_entrada||'', f.hora_salida||'',
      f.cc||'', f.proyecto||'', fmtH(cl.ordinarias), fmtH(cl.ord_domfest), fmtH(cl.extra_diurna),
      fmtH(cl.extra_nocturna), fmtH(cl.recargo_noct_ord), fmtH(cl.extra_domfest),
      x.ausente?'Si':'No', x.ausente?(f.motivo_ausencia||'(sin motivo)'):'', f.reporta||'', f.observacion||'',
      (cl.avisoExtra?'Supera el tope de extras':(cl.avisoDomFest?'Supera la jornada Dom/Fest':(x.sinCC?'Sin CC: no va al Parte':'')))
    ].map(esc2).join(';'));
  });
  // Fila de totales al final, con los mismos nombres de columna del Parte.
  lineas.push('');
  lineas.push(['TOTAL','','','','','','','','','','','', fmtH(c.tot.ordinarias), fmtH(c.tot.ord_domfest),
    fmtH(c.tot.extra_diurna), fmtH(c.tot.extra_nocturna), fmtH(c.tot.recargo_noct_ord), fmtH(c.tot.extra_domfest),
    c.diasAusentes+' dia(s) ausente', '', '', c.diasTrabajados+' dia(s) trabajado', ''].map(esc2).join(';'));
  const blob=new Blob(['﻿'+lineas.join('\r\n')], {type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  const nom=String(p.nombre||'persona').replace(/[^\wáéíóúñÁÉÍÓÚÑ ]/g,'').trim().replace(/\s+/g,'_');
  a.href=url; a.download=`Horas_${nom}_${d.desde}_a_${d.hasta}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

/* ---------- COPIAR RESUMEN (para pegar en WhatsApp) ---------- */
function textoResumen(){
  const c=STATE._calc, d=STATE.data; if(!c || !d) return '';
  const p=d.persona||{}, t=c.tot;
  const L=[];
  // D142: el canal de extras del admin no tiene "código de trabajador" sino No. Recurso de Navision.
  L.push(d.esAdmin ? ('*MIS HORAS EXTRA* — '+String(p.nombre||'').toUpperCase())
                   : ('*'+String(p.nombre||'').toUpperCase()+'* — cód. '+(p.codigo||'—')));
  L.push('Período '+etiquetaPeriodo(d.desde, d.hasta)+' ('+d.desde+' a '+d.hasta+')');
  L.push('');
  L.push('Ordinarias: '+fmtH(t.ordinarias)+' h');
  if(t.ord_domfest)      L.push('Ordinarias dom/fest: '+fmtH(t.ord_domfest)+' h');
  if(t.extra_diurna)     L.push('Extra diurna: '+fmtH(t.extra_diurna)+' h');
  if(t.extra_nocturna)   L.push('Extra nocturna: '+fmtH(t.extra_nocturna)+' h');
  if(t.recargo_noct_ord) L.push('Recargo nocturno ord.: '+fmtH(t.recargo_noct_ord)+' h');
  if(t.extra_domfest)    L.push('Extra diurna dom/fest: '+fmtH(t.extra_domfest)+' h');
  L.push('');
  L.push((d.esAdmin?'Días con extra: ':'Días trabajados: ')+c.diasTrabajados);
  if(c.diasAusentes) L.push('Días ausentes: '+c.diasAusentes+' ('+Object.keys(c.porMotivo).join(', ')+')');
  if(c.sinReporte.length) L.push('Días sin reporte: '+c.sinReporte.length);
  L.push('');
  L.push('Estas son las horas reportadas y enviadas a Navision. La liquidación final la hace nómina.');
  return L.join('\n');
}
function copiarResumen(btn){
  const txt=textoResumen(); if(!txt) return;
  const ok=function(){ if(btn){ const t=btn.textContent; btn.textContent='✓ Copiado'; setTimeout(()=>{btn.textContent=t;},1800); } };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(ok, function(){ copiaManual(txt); });
  } else copiaManual(txt);
}
// Respaldo para navegadores/contextos sin portapapeles (mismo criterio que el resto de la app).
function copiaManual(txt){
  const ta=document.createElement('textarea');
  ta.value=txt; ta.style.position='fixed'; ta.style.opacity='0';
  document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); }catch(e){ alert(txt); }
  document.body.removeChild(ta);
}
