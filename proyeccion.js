/* ============================================================================
 * PROYECCIÓN (V3-11 Fase A / D183) — lo que el jefe tecleaba en las hojas CALCULOS y
 * MAPEO del Excel, ahora editable tipo Excel DIRECTO en la base (worker/sql/006_proyeccion.sql):
 *   · Plan mensual (proy_plan): m³ COMPACTOS por periodo 16→15; la clave es el día 1 del mes en
 *     que CIERRA el periodo (= el acta). Excavación = TOTAL (aprov + préstamo + no aprov); No aprov.
 *     va incluida en ella. Alta (＋ Periodo) y baja de periodos.
 *   · Contrato y línea base (proy_contrato): programado y producción base por partida × UF (el
 *     préstamo sin UF). Solo se corrige.
 *   · Rendimientos (proy_rendimiento): rendimiento compacto por equipo y día; el proyectado suelto
 *     (rend × FC, lo que lee el Tablero) y la vara por hora (rend ÷ 8) salen solos.
 *   · Parámetros (proy_parametros): FC único de la obra y acta base (→ corte de la línea base).
 * Es lo que lee el Tablero de Producción (GET proyeccion_tablero). Editan admin y jefe; el
 * residente la ve en solo lectura. Quién edita lo decide el SERVIDOR (d.puede_editar); el guard de
 * aquí es cosmético.
 *
 * Mismo patrón que la Revisión de DATA (data.js, D181): un clic SELECCIONA, flechas, Shift para el
 * rango, Enter/F2/doble clic/escribir edita, copiar/pegar TSV, Ctrl+D rellena, Supr vacía, Ctrl+Z/Y.
 * Aquí son CUATRO tablas (una por pestaña) y UN solo Guardar que manda los cambios de todas en un
 * único POST (una transacción en el servidor). El deshacer también es uno para las cuatro.
 *
 * CUENTAS EN LA CELDA (=47724+3413): se evalúan con un parser PROPIO (ProyCalc, abajo) — la CSP D170
 * no deja usar eval/Function —; se guarda el RESULTADO y, en el plan, la cuenta en formulas[col]
 * (como la fórmula de la celda del Excel). Escribir un número simple limpia la cuenta. Lo que no se
 * puede calcular (basura, división por cero, referencias a celdas) queda marcado en la celda con el
 * motivo y NO se guarda hasta corregirlo.
 * CSP D170: eventos por data-on-* (tema.js) y addEventListener; nada inline; esc() de tema.js.
 * ==========================================================================*/
if(window.TM2Estilos) TM2Estilos.aplicar();
// Modo EMBED (pestaña del Hub del Jefe, V3-10): oculta la cabecera propia. Sin ?embed=1 no cambia nada.
try{ if(new URLSearchParams(location.search).get('embed')==='1') document.documentElement.classList.add('embed'); }catch(e){}

/* <calc> ---------------------------------------------------------------------
 * ProyCalc: funciones PURAS (sin DOM) para números, cuentas y periodos. Se prueban en Node
 * extrayendo este bloque (entre las marcas <calc> y </calc>).
 *
 * NÚMEROS (convención es-CO, D183):
 *   · la COMA es el separador decimal: 1234,5 → 1234.5 · 0,85 → 0.85
 *   · el PUNTO separa miles cuando va seguido de grupos de 3 cifras: 1.234,5 → 1234.5 ·
 *     47.724 → 47724 · 1.234.567 → 1234567
 *   · el punto se lee como DECIMAL cuando no puede ser de miles: 1.3 · 38848.8 · 0.125 · 1234.567
 *     (así los valores que muestra/copia el sistema vuelven iguales al pegarlos)
 *   · con punto Y coma, el último que aparece es el decimal (1.234,5 y 1,234.5 → 1234.5)
 *   AMBIGUO: «1.234» (un punto y justo 3 cifras, 1–3 cifras delante que no empiezan por 0) se lee
 *   como MILES (1234), como en es-CO. Para 1,234 (decimal) escribe la coma. El editor siempre
 *   muestra los valores con coma decimal y sin miles, así que editar no cambia nada por accidente.
 * CUENTAS: «=» + números, + − * / (también × ÷) y paréntesis; menos unario. Sin funciones ni
 *   referencias a celdas. El resultado se limpia del ruido de coma flotante (32374*1.2 = 38848.8).
 * -------------------------------------------------------------------------- */
var ProyCalc = (function(){
  'use strict';
  var MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  var ALIAS_MES = { set:8, jan:0, apr:3, aug:7, dec:11 };

  function limpio(v){ var x = Number(Number(v).toPrecision(12)); return (x === 0) ? 0 : x; }   // sin -0 ni 38848.799999999996

  // Numeral SIN signo, escrito a la colombiana. NaN si está mal escrito.
  function numero(s){
    s = String(s);
    if(/^\d+$/.test(s)) return Number(s);
    var p = s.indexOf('.') >= 0, c = s.indexOf(',') >= 0;
    if(p && c){
      var dec = (s.lastIndexOf('.') > s.lastIndexOf(',')) ? '.' : ',', mil = (dec === '.') ? ',' : '.';
      var re = new RegExp('^\\d{1,3}(\\' + mil + '\\d{3})+\\' + dec + '\\d+$');
      if(!re.test(s)) return NaN;
      return Number(s.split(mil).join('').replace(dec, '.'));
    }
    if(c){
      if(/^\d*,\d+$/.test(s)) return Number(s.replace(',', '.'));                  // una coma → decimal
      if(/^\d{1,3}(,\d{3}){2,}$/.test(s)) return Number(s.split(',').join(''));    // 1,234,567 → miles
      return NaN;
    }
    if(p){
      if(/^\d{1,3}(\.\d{3}){2,}$/.test(s)) return Number(s.split('.').join(''));   // 1.234.567 → miles
      if(/^[1-9]\d{0,2}\.\d{3}$/.test(s)) return Number(s.replace('.', ''));       // 47.724 → miles (es-CO)
      if(/^\d*\.\d+$/.test(s)) return Number(s);                                    // 1.3 · 38848.8 → decimal
      return NaN;
    }
    return NaN;
  }

  function ErrCalc(msg){ this.message = msg; this.calc = true; }

  // Evalúa una cuenta (sin el «=»). → {ok:true, valor} | {ok:false, error}
  function evaluar(expr){
    var s = String(expr == null ? '' : expr), i = 0;
    function err(m){ throw new ErrCalc(m); }
    function ws(){ while(i < s.length && /\s/.test(s.charAt(i))) i++; }
    function primario(){
      ws();
      if(i >= s.length) err('La cuenta está incompleta');
      var ch = s.charAt(i), m;
      if(ch === '('){
        i++; var v = suma(); ws();
        if(s.charAt(i) !== ')') err('Falta cerrar un paréntesis');
        i++; return v;
      }
      if(/[\d.,]/.test(ch)){
        m = /^[\d.,]+/.exec(s.slice(i)); i += m[0].length;
        var n = numero(m[0]);
        if(!isFinite(n)) err('Número mal escrito: «' + m[0] + '»');
        return n;
      }
      if(/[A-Za-zÁÉÍÓÚÑáéíóúñ$]/.test(ch)){
        m = /^[$A-Za-zÁÉÍÓÚÑáéíóúñ]+\$?\d*/.exec(s.slice(i));
        if(/\d/.test(m[0])) err('No se admiten referencias a celdas («' + m[0].toUpperCase() + '»): escribe el número');
        err('No se admiten funciones ni texto («' + m[0] + '»)');
      }
      if(ch === ')') err('Sobra un paréntesis de cierre');
      err('Carácter no válido: «' + ch + '»');
    }
    function unario(){
      ws(); var ch = s.charAt(i);
      if(ch === '-' || ch === '−'){ i++; return -unario(); }
      if(ch === '+'){ i++; return unario(); }
      return primario();
    }
    function producto(){
      var v = unario();
      for(;;){
        ws(); var ch = s.charAt(i);
        if(ch === '*' || ch === '×'){ i++; v = v * unario(); }
        else if(ch === '/' || ch === '÷'){ i++; var d = unario(); if(d === 0) err('División por cero'); v = v / d; }
        else return v;
      }
    }
    function suma(){
      var v = producto();
      for(;;){
        ws(); var ch = s.charAt(i);
        if(ch === '+'){ i++; v = v + producto(); }
        else if(ch === '-' || ch === '−'){ i++; v = v - producto(); }
        else return v;
      }
    }
    try{
      if(s.length > 300) err('La cuenta es demasiado larga');
      ws(); if(i >= s.length) err('Falta la cuenta después del «=»');
      var v = suma(); ws();
      if(i < s.length){
        var ch = s.charAt(i);
        if(ch === ')') err('Sobra un paréntesis de cierre');
        if(!/[\d.,(A-Za-zÁÉÍÓÚÑáéíóúñ$]/.test(ch)) err('Carácter no válido: «' + ch + '» (solo + − * / y paréntesis)');
        err('Sobra «' + s.slice(i, i + 12) + '» (¿falta un + − * /?)');
      }
      if(!isFinite(v)) err('El resultado no es un número');
      return { ok:true, valor:limpio(v) };
    }catch(e){ if(e && e.calc) return { ok:false, error:e.message }; throw e; }
  }

  // Lo que se escribe en una celda numérica. → {vacio:true} | {ok:true, valor, formula?} | {ok:false, error}
  function interpretar(texto){
    var t = String(texto == null ? '' : texto).trim();
    if(t === '') return { vacio:true };
    if(t.charAt(0) === '='){
      var r = evaluar(t.slice(1));
      return r.ok ? { ok:true, valor:r.valor, formula:'=' + t.slice(1).trim() } : r;
    }
    var m = /^([+\-−]?)\s*([\d.,]+)$/.exec(t);
    if(m){
      var n = numero(m[2]);
      if(!isFinite(n)) return { ok:false, error:'Número mal escrito: «' + t + '»' };
      return { ok:true, valor:limpio((m[1] === '-' || m[1] === '−') ? -n : n) };
    }
    if(/^[+\-]?[\d.,\s()]+([+\-*/×÷][\d.,\s()]+)+$/.test(t)) return { ok:false, error:'Para hacer una cuenta empieza con «=» (=' + t + ')' };
    return { ok:false, error:'No es un número: «' + t + '»' };
  }

  // Texto para EDITAR/COPIAR un número: coma decimal, sin miles (vuelve igual por interpretar()).
  function aTexto(v){ if(v === '' || v == null || !isFinite(Number(v))) return ''; return String(limpio(v)).replace('.', ','); }
  // Número para MOSTRAR (es-CO: 38.848,8).
  function fmtNum(v, dec){
    if(v === '' || v == null || !isFinite(Number(v))) return '';
    return Number(v).toLocaleString('es-CO', { maximumFractionDigits:(dec == null ? 2 : dec) });
  }

  function pad(n){ return (n < 10 ? '0' : '') + n; }
  function mesIdx(nom){
    var k = String(nom).slice(0, 3);
    if(ALIAS_MES[k] !== undefined) return ALIAS_MES[k];
    return MESES.indexOf(k);
  }
  // Periodo escrito como «sep-2026», «septiembre 2026», «2026-09», «2026-09-01», «09/2026» → 'YYYY-MM-01' (o null).
  function parsePeriodo(s){
    s = String(s == null ? '' : s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    var m, y, mo;
    if((m = /^(\d{4})[\-\/](\d{1,2})(?:[\-\/](\d{1,2}))?$/.exec(s))){ y = +m[1]; mo = +m[2]; }
    else if((m = /^(\d{1,2})[\-\/.](\d{4})$/.exec(s))){ mo = +m[1]; y = +m[2]; }
    else if((m = /^([a-z]+)\.?[\s\-\/.]*(\d{4}|\d{2})$/.exec(s))){ var ix = mesIdx(m[1]); if(ix < 0) return null; mo = ix + 1; y = +m[2]; if(y < 100) y += 2000; }
    else return null;
    if(!(mo >= 1 && mo <= 12) || y < 2020 || y > 2040) return null;
    return y + '-' + pad(mo) + '-01';
  }
  function mesTxt(p){ var s = String(p || ''); if(!/^\d{4}-\d{2}/.test(s)) return s; return MESES[+s.slice(5, 7) - 1] + '-' + s.slice(0, 4); }
  function fechaTxt(f){ var s = String(f || ''); if(!/^\d{4}-\d{2}-\d{2}/.test(s)) return s; return s.slice(8, 10) + '-' + MESES[+s.slice(5, 7) - 1] + '-' + s.slice(0, 4); }
  function sumarMeses(p, n){ var y = +String(p).slice(0, 4), mo = +String(p).slice(5, 7) - 1 + n; y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12; return y + '-' + pad(mo + 1) + '-01'; }
  function sumarDias(f, n){ var d = new Date(Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10) + n)); return d.toISOString().slice(0, 10); }

  return { numero:numero, evaluar:evaluar, interpretar:interpretar, limpio:limpio, aTexto:aTexto, fmtNum:fmtNum,
    parsePeriodo:parsePeriodo, mesTxt:mesTxt, fechaTxt:fechaTxt, sumarMeses:sumarMeses, sumarDias:sumarDias, MESES:MESES };
})();
/* </calc> ------------------------------------------------------------------ */

const APPS_SCRIPT_URL = GALCA_ENV.url.obra;
const ROLES_VER  = ['admin','jefe','residente'];
const ROLES_EDIT = ['admin','jefe'];          // cosmético hasta que llega d.puede_editar (lo decide el servidor)
const VOLVER = { admin:'menu.html', jefe:'hub-jefe.html', residente:'residente.html' };
const EMBED = document.documentElement.classList.contains('embed');

const rol = localStorage.getItem('rol')||'', usuario = (localStorage.getItem('usuario')||'').trim().toLowerCase();
if(!rol || ROLES_VER.indexOf(rol)<0 || !(window.TM2Auth && TM2Auth.get())){ location.href='index.html'; }
let PUEDE_EDITAR = ROLES_EDIT.indexOf(rol)>=0;
document.getElementById('userDisplay').textContent = usuario+' · '+rol;
const VOLVER_A = VOLVER[rol] || '';
if(VOLVER_A){ const bm=document.getElementById('btnMenu'); bm.style.display='inline-block'; bm.setAttribute('data-on-click', "irA('"+VOLVER_A+"')"); }

function logout(){ localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token'); location.href='index.html'; }
function caducada(d){ if(window.TM2Auth && TM2Auth.caducada(d)){ alert('La sesión ya no vale. Vuelve a entrar.'); logout(); return true; } return false; }
async function api(url, body){
  const r = body ? await fetch(APPS_SCRIPT_URL, { method:'POST', headers:{'Content-Type':'text/plain'}, body:JSON.stringify(body) }) : await fetch(url, {cache:'no-store'});
  return r.json();
}
// err: true = error (rojo) · 'aviso' = advertencia que no impide guardar (ámbar, más tiempo en pantalla).
let toastT=null; function toast(msg, err){ let t=document.querySelector('.toast'); if(!t){ t=document.createElement('div'); t.className='toast'; document.body.appendChild(t); } t.textContent=msg; t.classList.toggle('err',err===true); t.classList.toggle('aviso',err==='aviso'); t.style.display='block'; clearTimeout(toastT); toastT=setTimeout(()=>t.style.display='none', err==='aviso'?10000:(err?7000:2600)); }
function hoyBogota(){ return new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'}); }
const C = ProyCalc;

/* ---------- modelo: 4 tablas, una por pestaña ---------- */
const TABS = [
  { id:'plan',        label:'Plan mensual' },
  { id:'contrato',    label:'Contrato y línea base' },
  { id:'rendimiento', label:'Rendimientos' },
  { id:'parametros',  label:'Parámetros' },
];
// Columnas de cada pestaña (el orden y el tipo los fija la pantalla; la etiqueta y «edita» del servidor, si
// llegan con la misma clave, mandan). Las no editables son calculadas (gris), salvo las «clave» de la fila.
const COLS_DEF = {
  plan: [
    { k:'periodo',    etiqueta:'Periodo',    tipo:'periodo', edita:false, clave:true, ayuda:'Mes en que CIERRA el periodo 16→15 (= el acta). Solo se escribe en un periodo nuevo.' },
    { k:'acta',       etiqueta:'Acta',       tipo:'texto',   edita:false, ayuda:'Acta del periodo (calculada)' },
    // max = los topes del servidor (PR_NUM_MAX / PR_REND_MAX de api/obra/proyeccion.js): el error se marca en la celda.
    { k:'excavacion', etiqueta:'Excavación', tipo:'num', edita:true, formula:true, max:1e9, ayuda:'m³ compactos · excavación TOTAL (aprovechable + préstamo + no aprovechable)' },
    { k:'terraplen',  etiqueta:'Terraplén',  tipo:'num', edita:true, formula:true, max:1e9, ayuda:'m³ compactos' },
    { k:'subbase',    etiqueta:'Subbase',    tipo:'num', edita:true, formula:true, max:1e9, ayuda:'m³ compactos' },
    { k:'base',       etiqueta:'Base',       tipo:'num', edita:true, formula:true, max:1e9, ayuda:'m³ compactos' },
    { k:'noaprov',    etiqueta:'No aprov.',  tipo:'num', edita:true, formula:true, max:1e9, ayuda:'m³ compactos de excavación NO aprovechable (ya va incluida en Excavación)' },
  ],
  contrato: [
    { k:'etiqueta',        etiqueta:'Partida',         tipo:'texto', edita:false, clave:true },
    { k:'uf',              etiqueta:'UF',              tipo:'texto', edita:false, clave:true, ayuda:'Unidad funcional (el préstamo no tiene)' },
    // requerido: el servidor no deja el contrato vacío; así el vacío se marca en la celda y no tumba el lote entero.
    { k:'programado',      etiqueta:'Programado',      tipo:'num',   edita:true, requerido:true, max:1e9, ayuda:'m³ compactos del contrato (antes MAPEO I:J)' },
    { k:'produccion_base', etiqueta:'Producción base', tipo:'num',   edita:true, requerido:true, max:1e9, ayuda:'m³ compactos certificados hasta el cierre del acta base (antes MAPEO L:M)' },
  ],
  rendimiento: [
    { k:'etiqueta',             etiqueta:'Partida',                       tipo:'texto', edita:false, clave:true },
    { k:'rend_compacto_equipo', etiqueta:'Rend. compacto por equipo-día', tipo:'num',   edita:true, requerido:true, positivo:true, max:1e5, ayuda:'m³ compactos por equipo y día (antes dentro de las fórmulas de CALCULOS P1:T1)' },
    { k:'fc',                   etiqueta:'FC',                            tipo:'num',   edita:false, dec:4, ayuda:'El FC de la pestaña Parámetros' },
    { k:'suelto_equipo',        etiqueta:'Proyectado suelto por equipo',  tipo:'num',   edita:false, ayuda:'rend × FC: la vara diaria que usa el Tablero' },
    { k:'vara_hora',            etiqueta:'Vara por hora',                 tipo:'num',   edita:false, ayuda:'rend ÷ 8 (m³ compactos por hora)' },
  ],
  parametros: [
    { k:'fc',         etiqueta:'FC (factor de compactación)', tipo:'num',   edita:true, requerido:true, positivo:true, min:0.5, max:3, dec:4, ayuda:'Suelto ÷ compacto. Único para toda la obra (antes CALCULOS P4 y MAPEO B23). Entre 0,5 y 3' },
    { k:'acta_base',  etiqueta:'Acta base',                   tipo:'lista', edita:true, requerido:true, ayuda:'La línea base es la producción certificada hasta el cierre de este acta' },
    { k:'base_corte', etiqueta:'Corte de la línea base',      tipo:'fecha', edita:false, ayuda:'Día siguiente al cierre del acta base (calculado)' },
  ],
};
// Campos que viajan al guardar (la lista blanca del servidor) — la clave va aparte.
const CAMPOS = { plan:['excavacion','terraplen','subbase','base','noaprov'], contrato:['programado','produccion_base'],
  rendimiento:['rend_compacto_equipo'], parametros:['fc','acta_base'] };
const ETQ_CONTRATO = { excavacion:'Excavación común', terraplen:'Terraplén', subbase:'Subbase', base:'Base (BTC)', prestamo:'Excavación préstamos' };
const ETQ_REND = { excavacion:'Excavación', terraplen:'Terraplén', subbase:'Subbase', base:'Base' };
const NOTAS = {
  plan: 'm³ <b>compactos</b> por periodo 16→15; el periodo es el mes en que cierra (= el acta). <b>Excavación</b> es el total (aprovechable + préstamo + no aprovechable) y <b>No aprov.</b> ya va incluida en ella. El Tablero toma de aquí la meta de cada mes.',
  contrato: '<b>Programado</b> = contrato y <b>Producción base</b> = lo certificado hasta el cierre del acta base, en m³ compactos por UF (el préstamo no tiene UF). El Tablero suma UF1 + UF2 (resumen abajo).',
  rendimiento: 'Rendimiento <b>compacto por equipo y día</b>. El Tablero usa el <b>proyectado suelto</b> = rend × FC como vara diaria; la vara por hora es rend ÷ 8.',
  parametros: '<b>FC</b> único de la obra (el que usa el Tablero para pasar de suelto a compacto). <b>Acta base</b>: la línea base es la producción certificada hasta el cierre de ese acta; el corte es el día siguiente.',
};

const T = {}; TABS.forEach(function(t){ T[t.id]={ cols:[], filas:[], act:null, anc:null }; });
let TAB='plan', COLS=[], VIS=[], ACTAS=[], ROLES_EDITAN=['admin','jefe'], AVISO='', cargado=false;
let tempSeq=0;
let act=null, anc=null, editando=null;     // celda activa / ancla del rango / edición en curso (de la pestaña visible)
let undoStack=[], redoStack=[];             // deshacer / rehacer (Ctrl+Z / Ctrl+Y), UNO para las cuatro tablas

function numOVacio(v){ if(v===null||v===undefined||v==='') return ''; const n=Number(v); return isFinite(n)?n:''; }
function numDe(v){ if(v===''||v==null) return null; const n=Number(v); return isFinite(n)?n:null; }
function isoDia(v){ const s=String(v==null?'':v); const m=/^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(s); return m ? m[1]+'-'+m[2]+'-'+(m[3]||'01') : ''; }
function periodoDe(v){ const d=isoDia(v); return d ? d.slice(0,8)+'01' : ''; }
function limpiaFormulas(f, fila){
  let o=f; if(typeof o==='string'){ try{ o=JSON.parse(o); }catch(e){ o={}; } }
  const out={}; if(!o || typeof o!=='object') return out;
  CAMPOS.plan.forEach(function(k){ const v=o[k]; if(typeof v==='string' && v.trim().charAt(0)==='=' && (!fila || fila[k]!=='')) out[k]=v.trim(); });
  return out;
}
function firmaF(f){ const o=f||{}; return JSON.stringify(CAMPOS.plan.filter(function(k){ return o[k]; }).map(function(k){ return [k,o[k]]; })); }

/* ---------- actas / corte ---------- */
function actaDePeriodo(p){
  if(!p) return '';
  const ym=p.slice(0,7);
  for(let i=0;i<ACTAS.length;i++){ if(String(ACTAS[i].ff||'').slice(0,7)===ym) return String(ACTAS[i].acta); }
  const n=(+p.slice(0,4)-2025)*12 + (+p.slice(5,7)) + 2;              // respaldo: la misma fórmula que el servidor
  return n>=1 ? String(n) : '';                                         // antes del acta 1, sin acta (como la API y la vista)
}
function actaInfo(a){ for(let i=0;i<ACTAS.length;i++){ if(String(ACTAS[i].acta)===String(a)) return ACTAS[i]; } return null; }
function corteDe(a){
  const s=String(a==null?'':a).trim(); if(!/^\d+$/.test(s)) return '';
  const inf=actaInfo(s);
  if(inf && /^\d{4}-\d{2}-\d{2}/.test(String(inf.ff||''))) return C.sumarDias(String(inf.ff).slice(0,10), 1);
  return C.sumarMeses('2025-07-01', (+s)-9).slice(0,8)+'16';      // respaldo: 2025-07-16 + (acta−9) meses
}
function canonActa(v){ const m=/^(?:acta\s*)?0*(\d+)$/i.exec(String(v==null?'':v).trim()); return m ? String(Number(m[1])) : null; }
function actaOpcionTxt(a){ const inf=actaInfo(a); if(!inf) return 'Acta '+a; return 'Acta '+a+' · '+C.fechaTxt(inf.fi)+' → '+C.fechaTxt(inf.ff); }

/* ---------- normalización de lo que llega del servidor ---------- */
function normFila(tab, r){
  let o;
  if(tab==='plan'){
    o={ periodo:periodoDe(r.periodo) };
    CAMPOS.plan.forEach(function(k){ o[k]=numOVacio(r[k]); });
    o.formulas=limpiaFormulas(r.formulas, o);
    o._key=o.periodo;
  } else if(tab==='contrato'){
    o={ partida:String(r.partida||''), uf:String(r.uf==null?'':r.uf), orden:Number(r.orden)||0,
        programado:numOVacio(r.programado), produccion_base:numOVacio(r.produccion_base) };
    o.etiqueta=String(r.etiqueta||ETQ_CONTRATO[o.partida]||o.partida);
    o._key=o.partida+'|'+o.uf;
  } else if(tab==='rendimiento'){
    o={ partida:String(r.partida||''), orden:Number(r.orden)||0, rend_compacto_equipo:numOVacio(r.rend_compacto_equipo) };
    o.etiqueta=String(r.etiqueta||ETQ_REND[o.partida]||o.partida);
    o._key=o.partida;
  } else {
    o={ fc:numOVacio(r.fc), acta_base:String(r.acta_base==null?'':r.acta_base), base_corte:isoDia(r.base_corte) };
    o._key='parametros';
  }
  o.version=Number(r.version)||0; o.editado_por=String(r.editado_por||''); o.editado_ts=String(r.editado_ts||'');
  o._orig=origDe(tab,o); o._alta=false; o._baja=false; o._err={};
  return o;
}
function origDe(tab, o){ const x={}; CAMPOS[tab].forEach(function(k){ x[k]=o[k]; }); if(tab==='plan'){ x.periodo=o.periodo; x.formulas=Object.assign({},o.formulas); } return x; }
function ordenar(tab){
  const f=T[tab].filas;
  if(tab==='plan') f.sort(function(a,b){ return a.periodo<b.periodo?-1:a.periodo>b.periodo?1:0; });
  else if(tab!=='parametros') f.sort(function(a,b){ return (a.orden-b.orden) || (a._key<b._key?-1:a._key>b._key?1:0); });
}
function colsDe(tab, srv){
  const porK={}; (srv||[]).forEach(function(c){ if(c && c.k) porK[c.k]=c; });
  return COLS_DEF[tab].map(function(d){
    const c=Object.assign({}, d), s=porK[d.k];
    if(s){ if(s.etiqueta) c.etiqueta=String(s.etiqueta); if(d.k!=='periodo' && s.edita===false) c.edita=false; }
    return c;
  });
}

/* ---------- carga ---------- */
async function cargar(){
  document.getElementById('cuerpo').innerHTML='<tr><td class="vacio">Cargando…</td></tr>';
  let d; try{ d=await api(APPS_SCRIPT_URL+'?action=proyeccion'); }catch(e){ d={ ok:false, error:'Sin conexión con el servidor.' }; }
  if(caducada(d)) return;
  // Un Worker anterior a D183 no conoce la acción y responde {ok:true, msg:'API viva'} (sin `tablas`): eso no es
  // una Proyección vacía, es un servidor sin desplegar (OPERACIONES §15, ventana entre el front y wrangler).
  if(d && d.ok && !d.tablas) d={ ok:false, error:'El servidor todavía no tiene la Proyección (falta desplegar el Worker de D183). No se puede ver ni editar hasta entonces.' };
  if(!d || !d.ok){
    document.getElementById('cuerpo').innerHTML='<tr><td class="vacio">No se pudo cargar la Proyección: '+esc((d&&(d.mensaje||d.error))||'error desconocido')+'</td></tr>';
    toast((d&&(d.mensaje||d.error))||'No se pudo cargar', true); return;
  }
  AVISO=''; aplicarModelo(d);
}
async function recargar(){ if(editando) cancelEdit(); if(dirtyCambios().length && !confirm('Hay cambios sin guardar. ¿Descartarlos y recargar?')) return; cargar(); }
function aplicarModelo(d){
  const tb=d.tablas||{};
  ACTAS=(d.actas||[]).map(function(a){ return { acta:String(a.acta), fi:isoDia(a.fi), ff:isoDia(a.ff) }; })
    .filter(function(a){ return /^\d+$/.test(a.acta); }).sort(function(a,b){ return Number(a.acta)-Number(b.acta); });
  if(Array.isArray(d.roles_editan) && d.roles_editan.length) ROLES_EDITAN=d.roles_editan.map(String);
  PUEDE_EDITAR = (d.puede_editar===undefined) ? (ROLES_EDIT.indexOf(rol)>=0) : !!d.puede_editar;
  TABS.forEach(function(t){
    const src=tb[t.id]||{};
    T[t.id].cols=colsDe(t.id, src.columnas);
    T[t.id].filas=(src.filas||[]).map(function(r){ return normFila(t.id, r); });
    ordenar(t.id);
  });
  editando=null; undoStack=[]; redoStack=[]; cargado=true;
  modoUI(); pintarTodo(); actualizarDirty(); actualizarUndoBtns(); pintarUltima();
}
function modoUI(){
  ['btnFill','btnUndo','btnRedo','btnGuardar'].forEach(function(id){ const b=document.getElementById(id); if(b) b.style.display=PUEDE_EDITAR?'inline-block':'none'; });
  const b=document.getElementById('btnAlta'); if(b) b.style.display=(PUEDE_EDITAR && TAB==='plan')?'inline-block':'none';
  const sl=document.getElementById('soloLectura');
  if(sl){ sl.style.display=PUEDE_EDITAR?'none':'inline-block'; sl.textContent='SOLO LECTURA · editan '+ROLES_EDITAN.join(' y '); }
}
// editado_ts llega ya en hora de Bogotá como 'YYYY-MM-DD HH:MI' (proyeccion.js del Worker) → '18-sep-2026 10:32'.
function fmtTs(ts){
  const s=String(ts||''), m=/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(s);
  if(m && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s.slice(16))) return C.fechaTxt(m[1])+' '+m[2];
  const t=Date.parse(s); if(!isFinite(t)) return s;
  return new Date(t).toLocaleString('es-CO',{ timeZone:'America/Bogota', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false });
}
// Última edición en Galca (la más reciente de las cuatro tablas; el texto 'YYYY-MM-DD HH:MI' ordena solo).
function pintarUltima(){
  let ts='', por='';
  TABS.forEach(function(t){ T[t.id].filas.forEach(function(r){ if(r.editado_ts && r.editado_ts>ts){ ts=r.editado_ts; por=r.editado_por; } }); });
  const el=document.getElementById('ultima'); if(!el) return;
  el.textContent = ts ? 'Última edición: '+fmtTs(ts)+(por?' · '+por:'') : 'Sin ediciones en Galca todavía (valores iniciales del Excel)';
}

/* ---------- pestañas ---------- */
function pintarTabs(){
  let h='';
  TABS.forEach(function(t){
    const n=cambiosDe(t.id).length, e=erroresDe(t.id).length;
    h+='<button class="ptab'+(t.id===TAB?' on':'')+'" role="tab" data-tab="'+t.id+'" data-on-click="verTab(\''+t.id+'\')">'+esc(t.label)
      +(n?'<span class="n" title="cambios sin guardar">'+n+'</span>':'')+(e?'<span class="e" title="celdas con error">!</span>':'')+'</button>';
  });
  document.getElementById('ptabs').innerHTML=h;
}
function verTab(id, sinFoco){
  if(!T[id]) return;
  if(editando) commitEdit(0,0);
  T[TAB].act=act; T[TAB].anc=anc;
  TAB=id; act=T[id].act; anc=T[id].anc;
  try{ localStorage.setItem('tm2_proy_tab', id); }catch(e){}
  modoUI(); pintarTodo(); pintarTabs();
  if(!sinFoco){ const w=document.getElementById('wrap'); if(w) w.focus({preventScroll:true}); }
}
function pintarTodo(){
  COLS=T[TAB].cols;
  const nota=document.getElementById('nota');
  if(nota) nota.innerHTML=(AVISO?'<div class="aviso">'+AVISO+'</div>':'')+'<div>'+(NOTAS[TAB]||'')+'</div>';
  pintarCab(); pintar();
}

/* ---------- ancho de columnas (arrastrable, se guarda en el navegador por pestaña) ---------- */
const ANCHO_DEF = {
  plan:        { periodo:110, acta:62, excavacion:130, terraplen:130, subbase:120, base:120, noaprov:120 },
  contrato:    { etiqueta:210, uf:70, programado:160, produccion_base:170 },
  rendimiento: { etiqueta:170, rend_compacto_equipo:270, fc:80, suelto_equipo:270, vara_hora:140 },
  parametros:  { fc:230, acta_base:300, base_corte:210 },
};
let ANCHOS={};
try{ ANCHOS=JSON.parse(localStorage.getItem('tm2_proy_anchos')||'{}')||{}; }catch(e){ ANCHOS={}; }
function anchoDe(k){ const a=ANCHOS[TAB]||{}, v=a[k]; return (typeof v==='number'&&v>0)?v : ((ANCHO_DEF[TAB]||{})[k]||110); }
function guardarAnchos(){ try{ localStorage.setItem('tm2_proy_anchos', JSON.stringify(ANCHOS)); }catch(e){} }
function conBaja(){ return PUEDE_EDITAR && TAB==='plan'; }        // columna del botón ✕ (solo el plan tiene bajas)
function pintarCols(){
  const cg=document.getElementById('cols'); if(!cg) return;
  // CSP D170: style="" por innerHTML se ignora → los <col> van sin estilo y el ancho se pone por CSSOM.
  let total=44, h='<col data-rn="1">';
  COLS.forEach(function(c){ total+=anchoDe(c.k); h+='<col id="colw-'+c.k+'">'; });
  if(conBaja()){ total+=40; h+='<col data-acc="1">'; }
  cg.innerHTML=h;
  const rn=cg.querySelector('col[data-rn]'); if(rn) rn.style.width='44px';
  COLS.forEach(function(c){ const col=document.getElementById('colw-'+c.k); if(col) col.style.width=anchoDe(c.k)+'px'; });
  const acc=cg.querySelector('col[data-acc]'); if(acc) acc.style.width='40px';
  const t=document.getElementById('tabla'); if(t) t.style.width=total+'px';
}
function pintarCab(){
  let h='<th class="rownum">#</th>';
  COLS.forEach(function(c){
    const tip=(c.ayuda?c.ayuda+' · ':'')+(c.edita?'editable':(c.clave?'clave de la fila':'calculado'));
    h+='<th data-k="'+c.k+'" class="'+(c.tipo==='num'?'num':'')+(c.edita||c.clave?'':' th-deriv')+'" title="'+esc(tip)+'">'+esc(c.etiqueta)+'<span class="rz" data-k="'+c.k+'" title="Arrastra para el ancho · doble clic para reiniciar"></span></th>';
  });
  if(conBaja()) h+='<th class="rownum"></th>';
  document.getElementById('cab').innerHTML=h;
  pintarCols();
}

/* ---------- valores (con los calculados en vivo) ---------- */
function fcActual(){ const p=T.parametros.filas[0]; return p ? numDe(p.fc) : null; }
function valorDe(r, c){
  const k=c.k;
  if(TAB==='plan' && k==='acta') return actaDePeriodo(r.periodo);
  if(TAB==='rendimiento'){
    const rend=numDe(r.rend_compacto_equipo), fc=fcActual();
    if(k==='fc') return fc==null?'':fc;
    if(k==='suelto_equipo') return (rend==null||fc==null)?'':C.limpio(rend*fc);
    if(k==='vara_hora') return rend==null?'':C.limpio(rend/8);
  }
  if(TAB==='parametros' && k==='base_corte') return corteDe(r.acta_base) || r.base_corte || '';
  return r[k];
}
function disp(r, c){
  const v=valorDe(r,c); if(v===''||v==null) return '';
  if(c.tipo==='num') return C.fmtNum(v, c.dec);
  if(c.tipo==='periodo') return C.mesTxt(v);
  if(c.tipo==='fecha') return C.fechaTxt(v);
  if(c.tipo==='lista' && c.k==='acta_base') return actaOpcionTxt(v);
  return String(v);
}
function formulaDe(r, c){ return (TAB==='plan' && c.formula && r.formulas && r.formulas[c.k]) ? r.formulas[c.k] : ''; }
// ¿La cuenta guardada se puede recalcular aquí? (las del Excel con referencias, p. ej. «=D16*1.2», no).
function formulaPropia(f){ return !!f && ProyCalc.evaluar(f.slice(1)).ok; }
/* FÓRMULAS FIJAS (revisión D183). Las 8 fórmulas del Excel que apuntaban a otra celda de la MISMA fila (CALCULOS
 * filas 15–18: Excavación = Terraplén × 1,2, No aprov. = Excavación × 0,2; en ago-2026 Terraplén = Excavación × 0,7)
 * se guardaron con su VALOR (D183 g): en Galca NO se recalculan. Se marcan distinto de una cuenta propia y, si se
 * cambia la celda de la que salían, se avisa para revisarlas a mano. Que se recalculen solas lo decide el dueño. */
const COL_EXCEL = { B:'excavacion', D:'terraplen', F:'subbase', H:'base', J:'noaprov' };   // CALCULOS B/D/F/H/J
const RE_REF = /\$?([A-Z]{1,3})\$?(\d+)/g;
function formulaFija(f){ return !!f && !formulaPropia(f); }
function periodoFilaExcel(n){ return C.sumarMeses('2025-08-01', n-3); }                   // CALCULOS fila 3 = ago-2025
function refsExcel(f){ const out=[]; String(f||'').replace(RE_REF, function(t, col, n){ if(COL_EXCEL[col]) out.push({ k:COL_EXCEL[col], periodo:periodoFilaExcel(+n) }); return t; }); return out; }
function etqPlan(k){ const c=COLS_DEF.plan.filter(function(x){ return x.k===k; })[0]; return c ? c.etiqueta : k; }
// '=+D16*1.2' en la fila sep-2026 → 'Terraplén × 1,2'
function leerFormulaExcel(f, periodo){
  return String(f||'').replace(/^=\+?/, '').replace(RE_REF, function(t, col, n){
    const k=COL_EXCEL[col]; if(!k) return t; const p=periodoFilaExcel(+n);
    return etqPlan(k)+(p===periodo ? '' : ' de '+C.mesTxt(p));
  }).replace(/\*/g, ' × ').replace(/\//g, ' ÷ ').replace(/(\d)\.(\d)/g, '$1,$2');
}
// Columnas de la fila cuya fórmula fija salía (directa o indirectamente) de la columna k de esa misma fila.
function dependientesFijas(row, k){
  const f=row.formulas||{}, out=[], cola=[k];
  while(cola.length){
    const x=cola.shift();
    CAMPOS.plan.forEach(function(k2){
      if(k2===k || out.indexOf(k2)>=0 || !formulaFija(f[k2])) return;
      if(refsExcel(f[k2]).some(function(r){ return r.k===x && r.periodo===row.periodo; })){ out.push(k2); cola.push(k2); }
    });
  }
  return out;
}
function avisoFijas(row, k){
  if(TAB!=='plan' || !row || !row.periodo) return '';
  const dep=dependientesFijas(row, k); if(!dep.length) return '';
  const f=row.formulas||{}, uno=dep.length===1;
  return 'Ojo: en el Excel, '+dep.map(function(x){ return etqPlan(x)+' ('+f[x]+' = '+leerFormulaExcel(f[x], row.periodo)+')'; }).join(' y ')
    +' de '+C.mesTxt(row.periodo)+(uno?' salía':' salían')+' de '+etqPlan(k)+'. En Galca '+(uno?'es un valor fijo: revísalo':'son valores fijos: revísalos')+' a mano.';
}
function editableEn(r, c){ return PUEDE_EDITAR && (c.k==='periodo' ? !!r._alta : !!c.edita); }
function celdaModificada(r, c){
  if(r._alta) return c.edita || c.k==='periodo';
  if(CAMPOS[TAB].indexOf(c.k)<0) return false;
  if(String(r[c.k])!==String(r._orig[c.k])) return true;
  return TAB==='plan' && c.formula && String((r.formulas||{})[c.k]||'')!==String(((r._orig||{}).formulas||{})[c.k]||'');
}

/* ---------- render ---------- */
function filasVisibles(){ return T[TAB].filas.filter(function(r){ return !r._baja; }); }
function celHTML(r, c, ci, ri){
  const err=r._err && r._err[c.k], f=formulaDe(r,c), fija=formulaFija(f), ed=editableEn(r,c) || (!PUEDE_EDITAR && c.edita);
  const cls='cell'+(ed||c.clave?'':' deriv')+(c.clave?' clave':'')+(c.tipo==='num'?' num':'')+(f?(fija?' formula-fija':' formula'):'')+(err?' err':'')+(celdaModificada(r,c)?' mod':'')+' col-'+c.k;
  let d, tip;
  if(err){ d='⚠ '+(err.texto||'(vacío)'); tip=err.msg; }
  else {
    d=disp(r,c);
    if(fija){
      const de=refsExcel(f).filter(function(x){ return x.periodo===r.periodo; }).map(function(x){ return etqPlan(x.k); });
      tip='Valor fijo copiado del Excel, donde era '+f+' ('+leerFormulaExcel(f, r.periodo)+' = '+d+'). En Galca NO se recalcula'
        +(de.length ? ': si cambias '+de.join(' o ')+' de '+C.mesTxt(r.periodo)+', corrige esta celda a mano.' : '.');
    } else tip=f ? ('Cuenta: '+f+'  =  '+d) : d;
  }
  return '<td class="'+cls+'" data-r="'+ri+'" data-c="'+ci+'" data-k="'+c.k+'"><div class="cv" title="'+esc(tip)+'">'+esc(d)+'</div></td>';
}
function filaHTML(r, ri){
  const tip=r._alta ? 'Periodo nuevo (sin guardar)' : (r.editado_por||r.editado_ts ? 'Editado por '+(r.editado_por||'—')+(r.editado_ts?' · '+fmtTs(r.editado_ts):'') : 'Valor inicial (del Excel)');
  let h='<tr data-r="'+ri+'" data-fila="'+esc(r._key)+'" class="'+(esDirty(TAB,r)?'dirty ':'')+(r._alta?'alta':'')+'">';
  h+='<td class="rownum" title="'+esc(tip)+'">'+(r._alta?'+':(ri+1))+'</td>';
  COLS.forEach(function(c,ci){ h+=celHTML(r,c,ci,ri); });
  if(conBaja()) h+='<td class="rownum acc"><button class="xbtn" title="Eliminar este periodo del plan" data-on-click="bajaFila(\''+esc(r._key)+'\')">✕</button></td>';
  return h+'</tr>';
}
function pintar(){
  VIS=filasVisibles();
  const cuerpo=document.getElementById('cuerpo');
  cuerpo.innerHTML = VIS.length ? VIS.map(filaHTML).join('') : '<tr><td class="vacio" colspan="'+(COLS.length+2)+'">'+(cargado?'Sin filas.':'Cargando…')+'</td></tr>';
  if(act && (act.r>=VIS.length || act.c>=COLS.length)) act=anc=null;
  if(anc && (anc.r>=VIS.length || anc.c>=COLS.length)) anc=act;
  pintarPie(); pintarExtra(); aplicaSel(); pintarTabs();
}
// Plan: total al pie (informativo, no se guarda).
function pintarPie(){
  const pie=document.getElementById('pie'); if(!pie) return;
  if(TAB!=='plan' || !VIS.length){ pie.innerHTML=''; return; }
  let h='<tr><td class="rownum"></td>';
  COLS.forEach(function(c,ci){
    if(ci===0){ h+='<td class="pie-lbl" colspan="2">Total ('+VIS.length+' periodo'+(VIS.length===1?'':'s')+')</td>'; return; }
    if(ci===1) return;
    if(c.tipo!=='num'){ h+='<td></td>'; return; }
    let s=0; VIS.forEach(function(r){ const n=numDe(r[c.k]); if(n!=null) s+=n; });
    h+='<td class="num"><div class="cv" title="Suma de la columna (no se guarda)">'+esc(C.fmtNum(C.limpio(s)))+'</div></td>';
  });
  if(conBaja()) h+='<td class="rownum acc"></td>';
  pie.innerHTML=h+'</tr>';
}
// Contrato: resumen por partida (lo que usa el Tablero) + línea de la base.
function pintarExtra(){
  const ex=document.getElementById('extra'); if(!ex) return;
  const p=T.parametros.filas[0], actaB=p?p.acta_base:'', corte=p?(corteDe(actaB)||p.base_corte):'';
  const linea='<p class="info">Línea base al cierre del <b>acta '+esc(actaB||'—')+'</b> → corte <b>'+esc(corte?C.fechaTxt(corte):'—')+'</b></p>';
  if(TAB==='parametros'){ ex.innerHTML=linea; return; }
  if(TAB!=='contrato'){ ex.innerHTML=''; return; }
  const orden=[], por={};
  T.contrato.filas.filter(function(r){ return !r._baja; }).forEach(function(r){
    if(!por[r.partida]){ por[r.partida]={ etiqueta:r.etiqueta, prog:0, base:0, n:0 }; orden.push(r.partida); }
    const x=por[r.partida], a=numDe(r.programado), b=numDe(r.produccion_base);
    if(a!=null) x.prog+=a; if(b!=null) x.base+=b; x.n++;
  });
  let h='<div class="resumen"><div class="res-tit">Resumen por partida · lo que usa el Tablero (UF1 + UF2)</div><div class="res-wrap"><table class="res"><thead><tr><th>Partida</th><th class="num">Contrato (programado)</th><th class="num">Línea base</th><th class="num">Base / contrato</th></tr></thead><tbody>';
  orden.forEach(function(k){
    const x=por[k], pct=x.prog>0 ? C.fmtNum(x.base/x.prog*100,1)+' %' : '—';
    h+='<tr><td>'+esc(x.etiqueta)+(x.n>1?' <span class="uf">(UF1 + UF2)</span>':'')+'</td><td class="num">'+esc(C.fmtNum(C.limpio(x.prog)))+'</td><td class="num">'+esc(C.fmtNum(C.limpio(x.base)))+'</td><td class="num">'+esc(pct)+'</td></tr>';
  });
  h+='</tbody></table></div>'+linea+'</div>';
  ex.innerHTML=h;
}

/* ---------- selección / navegación (modo hoja de cálculo) ---------- */
function tdDe(r,c){ return document.querySelector('#cuerpo td.cell[data-r="'+r+'"][data-c="'+c+'"]'); }
function setActiva(r,c,extender,scroll){
  if(!VIS.length || !COLS.length) return;
  r=Math.max(0,Math.min(r,VIS.length-1)); c=Math.max(0,Math.min(c,COLS.length-1));
  act={r:r,c:c}; if(!extender||!anc) anc={r:r,c:c};
  aplicaSel();
  // Scroll SOLO en navegación por teclado (un scroll entre los dos clics de un doble clic lo mandaría a otra fila).
  if(scroll){ const td=tdDe(r,c); if(td && td.scrollIntoView) td.scrollIntoView({block:'nearest',inline:'nearest'}); }
}
function mover(dr,dc,extender){ if(!act){ setActiva(0,0,false,true); return; } setActiva(act.r+dr, act.c+dc, extender, true); }
function rango(){ if(!act||!anc) return null; return { r0:Math.min(act.r,anc.r), r1:Math.max(act.r,anc.r), c0:Math.min(act.c,anc.c), c1:Math.max(act.c,anc.c) }; }
function aplicaSel(){
  const rc=rango();
  document.querySelectorAll('#cuerpo td.cell').forEach(function(td){
    const r=+td.dataset.r, c=+td.dataset.c;
    td.classList.toggle('sel', !!rc && r>=rc.r0 && r<=rc.r1 && c>=rc.c0 && c<=rc.c1);
    td.classList.toggle('activa', !!act && r===act.r && c===act.c);
  });
}

/* ---------- edición ---------- */
// Texto con el que se abre el editor: la cuenta (si se puede recalcular aquí; la fija del Excel, no: su
// valor), el número con coma decimal, el periodo como «sep-2026».
function textoEdicion(r, c){
  const err=r._err && r._err[c.k]; if(err) return err.texto||'';
  const f=formulaDe(r,c); if(f && formulaPropia(f)) return f;
  const v=r[c.k];
  if(c.tipo==='num') return C.aTexto(v);
  if(c.tipo==='periodo') return C.mesTxt(v);
  return String(v==null?'':v);
}
function beginEdit(r,c,inicial){
  if(!PUEDE_EDITAR){ toast('Solo lectura: la Proyección la editan '+ROLES_EDITAN.join(' y ')+'.'); return; }
  const col=COLS[c], row=VIS[r], td=tdDe(r,c); if(!col||!row||!td) return;
  if(!editableEn(row,col)){
    if(col.k==='periodo') toast('El periodo es la clave de la fila: para cambiarlo, elimina el periodo (✕) y añade uno nuevo.');
    else if(col.clave) toast('«'+col.etiqueta+'» identifica la fila: no se edita.');
    else toast('«'+col.etiqueta+'» es calculada: se actualiza sola.');
    return;
  }
  setActiva(r,c,false,false);
  const t0=textoEdicion(row,col);
  editando={ r:r, c:c, t0:t0 };
  let el;
  if(col.tipo==='lista'){
    el=document.createElement('select'); el.className='editor';
    const ops=ACTAS.map(function(a){ return a.acta; }), actual=String(row[col.k]==null?'':row[col.k]);
    if(actual && ops.indexOf(actual)<0) ops.push(actual);           // un acta fuera de la lista se ofrece tal cual
    let elegida=actual;
    if(inicial!==undefined && inicial!==null){ const m=ops.filter(function(o){ return o.indexOf(String(inicial))===0; })[0]; if(m) elegida=m; }
    ops.forEach(function(o){ const op=document.createElement('option'); op.value=o; op.textContent=actaOpcionTxt(o); if(o===elegida) op.selected=true; el.appendChild(op); });
    editando.t0=actual;
  } else {
    el=document.createElement('input'); el.type='text'; el.className='editor'; el.spellcheck=false; el.autocomplete='off';
    if(col.tipo==='num') el.classList.add('num');
    el.value=(inicial!==undefined && inicial!==null) ? inicial : t0;
    if(col.tipo==='num') el.placeholder='número o =cuenta';
    if(col.tipo==='periodo') el.placeholder='p. ej. oct-2027';
  }
  td.classList.add('editando'); const cv=td.querySelector('.cv'); if(cv) cv.style.display='none'; td.appendChild(el);
  el.focus(); if(el.select && inicial===undefined) el.select();
  el.addEventListener('keydown', function(ev){
    if(ev.key==='Enter'){ ev.preventDefault(); commitEdit(1,0); }
    else if(ev.key==='Tab'){ ev.preventDefault(); commitEdit(0, ev.shiftKey?-1:1); }
    else if(ev.key==='Escape'){ ev.preventDefault(); cancelEdit(); }
    else if((ev.ctrlKey||ev.metaKey) && (ev.key==='s'||ev.key==='S')){ ev.preventDefault(); commitEdit(0,0); guardar(document.getElementById('btnGuardar')); }
    ev.stopPropagation();
  });
  el.addEventListener('blur', function(){ if(editando) commitEdit(0,0); });
}
function cerrarEditor(r,c){
  const td=tdDe(r,c);
  if(td){ const ed=td.querySelector('.editor'); if(ed) ed.remove(); const cv=td.querySelector('.cv'); if(cv) cv.style.display=''; td.classList.remove('editando'); }
  const wrap=document.getElementById('wrap'); if(wrap) wrap.focus({preventScroll:true});
}
function commitEdit(dr,dc){
  if(!editando) return;
  const e=editando; editando=null;
  const td=tdDe(e.r,e.c), el=td&&td.querySelector('.editor'), val=el?el.value:e.t0;
  cerrarEditor(e.r,e.c);
  const row=VIS[e.r], col=COLS[e.c];
  if(row && col && val!==e.t0){
    const antes=snapEstado();
    const cambio=setValor(row,col,val);
    if(cambio){ pushUndo(antes); despuesDeCambiar(row, col); }
    const err=row._err && row._err[col.k];
    if(err) toast(err.msg, true);
    else if(cambio){ const av=avisoFijas(row, col.k); if(av) toast(av, 'aviso'); }   // una fórmula fija salía de esta celda
  }
  if(dr||dc) mover(dr,dc,false);
}
function cancelEdit(){ if(!editando) return; const e=editando; editando=null; cerrarEditor(e.r,e.c); }
// Tras cambiar: repinta (los calculados, el total y el orden por periodo dependen de todo) y deja la
// celda activa sobre la MISMA fila aunque se haya reordenado.
function despuesDeCambiar(row, col){
  if(TAB==='plan' && col && col.k==='periodo'){ ordenar('plan'); pintar(); const i=VIS.indexOf(row); if(i>=0) setActiva(i, act?act.c:0, false, true); }
  else pintar();
  actualizarDirty();
}
function firmaCelda(row,k){ return JSON.stringify([row[k], row.formulas?(row.formulas[k]||null):null, row._err?(row._err[k]||null):null]); }
// Escribe en UNA celda lo tecleado/pegado. Devuelve true si algo cambió (valor, cuenta o error).
function setValor(row, col, texto){
  if(!row || !col || !editableEn(row,col)) return false;
  const k=col.k, antes=firmaCelda(row,k), e=row._err||(row._err={});
  const t=String(texto==null?'':texto).trim();
  if(col.tipo==='num'){
    const r=C.interpretar(t);
    if(r.vacio){
      if(col.requerido) e[k]={ texto:'', msg:'«'+col.etiqueta+'» es obligatorio: no puede quedar vacío.' };
      else { row[k]=''; delete e[k]; if(row.formulas) delete row.formulas[k]; }
    } else if(!r.ok) e[k]={ texto:t, msg:r.error+' — no se guarda.' };
    else if(r.valor<0) e[k]={ texto:t, msg:'No puede ser negativo ('+C.fmtNum(r.valor)+') — no se guarda.' };
    else if(col.positivo && !(r.valor>0)) e[k]={ texto:t, msg:'Tiene que ser mayor que cero — no se guarda.' };
    else if((col.min!=null && r.valor<col.min) || (col.max!=null && r.valor>col.max)) e[k]={ texto:t, msg:(col.min!=null
      ? '«'+col.etiqueta+'» tiene que estar entre '+C.aTexto(col.min)+' y '+C.aTexto(col.max)
      : '«'+col.etiqueta+'» es demasiado grande (máx. '+C.fmtNum(col.max)+')')+' — no se guarda.' };
    else {
      row[k]=r.valor; delete e[k];
      if(TAB==='plan' && col.formula){ row.formulas=row.formulas||{}; if(r.formula) row.formulas[k]=r.formula; else delete row.formulas[k]; }
    }
  } else if(col.tipo==='lista'){                     // acta base: un acta de la lista (o un número de acta)
    const a=canonActa(t);
    if(!t) e[k]={ texto:'', msg:'Elige el acta base.' };
    else if(a===null) e[k]={ texto:t, msg:'No es un acta: escribe su número (p. ej. 22) — no se guarda.' };
    else { row[k]=a; delete e[k]; }
  } else if(col.tipo==='periodo'){                   // solo en periodos nuevos
    const p=C.parsePeriodo(t);
    if(!p) e[k]={ texto:t, msg:'Periodo no válido: escribe el mes, p. ej. «oct-2027» o «2027-10» — no se guarda.' };
    else if(T.plan.filas.some(function(x){ return x!==row && !x._baja && x.periodo===p; })) e[k]={ texto:t, msg:'El periodo '+C.mesTxt(p)+' ya está en el plan — no se guarda.' };
    else { row.periodo=p; delete e[k]; }
  }
  return firmaCelda(row,k)!==antes;
}

/* ---------- deshacer / rehacer (Ctrl+Z / Ctrl+Y) ----------
 * Instantáneas de las CUATRO tablas (son pocas filas) antes de cada acción que muta: editar, pegar,
 * rellenar, vaciar, añadir y eliminar periodo. La instantánea recuerda la pestaña: deshacer lleva a
 * la pestaña donde se hizo el cambio. No se toca el deshacer nativo de un campo con foco. */
function snapEstado(){ const f={}; TABS.forEach(function(t){ f[t.id]=T[t.id].filas; }); return JSON.stringify({ tab:TAB, f:f }); }
function pushUndo(s){ undoStack.push(s||snapEstado()); if(undoStack.length>100) undoStack.shift(); redoStack.length=0; actualizarUndoBtns(); }
function restaurar(js){
  const o=JSON.parse(js);
  TABS.forEach(function(t){ T[t.id].filas=o.f[t.id]||[]; });
  if(o.tab && o.tab!==TAB && T[o.tab]){ T[TAB].act=act; T[TAB].anc=anc; TAB=o.tab; act=T[TAB].act; anc=T[TAB].anc; try{ localStorage.setItem('tm2_proy_tab', TAB); }catch(e){} }
  editando=null; modoUI(); pintarTodo(); actualizarDirty(); actualizarUndoBtns();
}
function deshacer(){ if(editando) commitEdit(0,0); if(!undoStack.length){ toast('Nada que deshacer.'); return; } const s=undoStack.pop(); redoStack.push(snapEstado()); restaurar(s); toast('Deshecho.'); }
function rehacer(){ if(editando) commitEdit(0,0); if(!redoStack.length){ toast('Nada que rehacer.'); return; } const s=redoStack.pop(); undoStack.push(snapEstado()); restaurar(s); toast('Rehecho.'); }
function actualizarUndoBtns(){ const u=document.getElementById('btnUndo'), r=document.getElementById('btnRedo'); if(u) u.disabled=!undoStack.length; if(r) r.disabled=!redoStack.length; }

/* ---------- teclado + eventos de la tabla ---------- */
function montarEventos(){
  const cuerpo=document.getElementById('cuerpo'), wrap=document.getElementById('wrap');
  let arrastrando=false;
  cuerpo.addEventListener('mousedown', function(ev){
    if(ev.button!==0) return;
    const td=ev.target.closest && ev.target.closest('td.cell'); if(!td) return;
    if(ev.target.closest('.editor')) return;
    ev.preventDefault();
    if(editando) commitEdit(0,0);
    if(wrap) wrap.focus({preventScroll:true});
    setActiva(+td.dataset.r, +td.dataset.c, ev.shiftKey, false);
    if(!ev.shiftKey) arrastrando=true;
  });
  cuerpo.addEventListener('mousemove', function(ev){
    if(!arrastrando) return;
    if((ev.buttons&1)===0){ arrastrando=false; return; }
    const td=ev.target.closest && ev.target.closest('td.cell'); if(!td) return;
    const r=+td.dataset.r, c=+td.dataset.c;
    if(act && r===act.r && c===act.c) return;
    setActiva(r, c, true, false);
  });
  document.addEventListener('mouseup', function(){ arrastrando=false; });
  cuerpo.addEventListener('dblclick', function(ev){ const td=ev.target.closest && ev.target.closest('td.cell'); if(td) beginEdit(+td.dataset.r,+td.dataset.c); });

  // ---- Ancho de columna: arrastrar la agarradera del encabezado (doble clic la reinicia) ----
  const cab=document.getElementById('cab'); let rz=null;
  cab.addEventListener('mousedown', function(ev){
    const g=ev.target.closest && ev.target.closest('.rz'); if(!g) return;
    ev.preventDefault(); ev.stopPropagation();
    const k=g.dataset.k, col=document.getElementById('colw-'+k), th=g.closest('th');
    rz={ k:k, col:col, x0:ev.clientX, w0:(th?Math.round(th.getBoundingClientRect().width):anchoDe(k)), w:anchoDe(k) };
    document.body.classList.add('rz-activo');
  });
  document.addEventListener('mousemove', function(ev){ if(!rz) return; rz.w=Math.max(48, Math.round(rz.w0 + (ev.clientX - rz.x0))); if(rz.col) rz.col.style.width=rz.w+'px'; });
  document.addEventListener('mouseup', function(){
    if(!rz) return;
    (ANCHOS[TAB]=ANCHOS[TAB]||{})[rz.k]=rz.w; guardarAnchos(); pintarCols();
    document.body.classList.remove('rz-activo'); rz=null;
  });
  cab.addEventListener('dblclick', function(ev){
    const g=ev.target.closest && ev.target.closest('.rz'); if(!g) return;
    ev.preventDefault(); ev.stopPropagation();
    if(ANCHOS[TAB]) delete ANCHOS[TAB][g.dataset.k]; guardarAnchos(); pintarCols();
  });

  wrap.addEventListener('keydown', function(ev){
    if(editando) return;
    if(!act){ if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].indexOf(ev.key)>=0){ setActiva(0,0,false,true); ev.preventDefault(); } return; }
    const k=ev.key, ctrl=ev.ctrlKey||ev.metaKey;
    if(ctrl && (k==='c'||k==='C'||k==='v'||k==='V')) return;           // los manejan los eventos copy/paste
    if(ctrl && (k==='d'||k==='D')){ ev.preventDefault(); rellenar(); return; }
    if(k==='ArrowUp'){ ev.preventDefault(); mover(-1,0,ev.shiftKey); }
    else if(k==='ArrowDown'){ ev.preventDefault(); mover(1,0,ev.shiftKey); }
    else if(k==='ArrowLeft'){ ev.preventDefault(); mover(0,-1,ev.shiftKey); }
    else if(k==='ArrowRight'){ ev.preventDefault(); mover(0,1,ev.shiftKey); }
    else if(k==='Tab'){ ev.preventDefault(); mover(0, ev.shiftKey?-1:1, false); }
    else if(k==='Enter'||k==='F2'){ ev.preventDefault(); beginEdit(act.r,act.c); }
    else if(k==='Delete'||k==='Backspace'){ ev.preventDefault(); borrarSeleccion(); }
    else if(k.length===1 && !ctrl && !ev.altKey){ ev.preventDefault(); beginEdit(act.r,act.c,k); }
  });
  document.addEventListener('copy', function(ev){ if(editando || !enGrid()) return; const t=tsvSeleccion(); if(t==null) return; ev.preventDefault(); ev.clipboardData.setData('text/plain', t); });
  document.addEventListener('paste', function(ev){ if(editando || !PUEDE_EDITAR || !enGrid()) return; const t=(ev.clipboardData||window.clipboardData).getData('text'); if(!t) return; ev.preventDefault(); pegar(t); });
  document.addEventListener('keydown', function(ev){
    const ctrl=ev.ctrlKey||ev.metaKey; if(!ctrl) return;
    const k=(ev.key||'').toLowerCase();
    if(k==='s'){ ev.preventDefault(); if(PUEDE_EDITAR) guardar(document.getElementById('btnGuardar')); return; }
    if(k!=='z' && k!=='y') return;
    if(editando) return;                                   // respeta el deshacer nativo del editor abierto
    const ae=document.activeElement;
    if(ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
    if(!PUEDE_EDITAR) return;
    ev.preventDefault();
    if(k==='y' || (k==='z' && ev.shiftKey)) rehacer(); else deshacer();
  });
  // Fuera del Hub, avisar al cerrar con cambios sin guardar (dentro, avisa el Hub con el punto de la pestaña).
  window.addEventListener('beforeunload', function(e){ if(!EMBED && cargado && dirtyCambios().length){ e.preventDefault(); e.returnValue=''; } });
}
function enGrid(){ const w=document.getElementById('wrap'); return !!(w && (document.activeElement===w || (act && w.contains(document.activeElement)))); }

/* ---------- copiar / pegar / rellenar / borrar (sobre el rango) ---------- */
// Lo que se copia de una celda: la cuenta si se puede recalcular aquí; si no, el valor (coma decimal).
function textoCopia(r, c){
  const err=r._err && r._err[c.k]; if(err) return err.texto||'';
  const f=formulaDe(r,c); if(f && formulaPropia(f)) return f;
  const v=valorDe(r,c);
  if(c.tipo==='num') return C.aTexto(v);
  if(c.tipo==='periodo') return C.mesTxt(v);
  return String(v==null?'':v);
}
function tsvSeleccion(){ const rc=rango(); if(!rc) return null;
  const fs=[]; for(let r=rc.r0;r<=rc.r1;r++){ const cells=[]; for(let c=rc.c0;c<=rc.c1;c++){ const row=VIS[r]; cells.push(row?textoCopia(row,COLS[c]):''); } fs.push(cells.join('\t')); } return fs.join('\n');
}
function copiarSel(btn){
  let t=tsvSeleccion();
  if(t==null) t=[COLS.map(function(c){ return c.etiqueta; }).join('\t')].concat(VIS.map(function(r){ return COLS.map(function(c){ return textoCopia(r,c); }).join('\t'); })).join('\n');
  const ok=function(){ if(btn){ btn.classList.add('copied'); const x=btn.textContent; btn.textContent='✓ Copiado'; setTimeout(function(){ btn.classList.remove('copied'); btn.textContent=x; },1400); } toast('Copiado.'); };
  if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok,function(){ fb(t); ok(); }); else { fb(t); ok(); }
  function fb(x){ const ta=document.createElement('textarea'); ta.value=x; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); }catch(e){} document.body.removeChild(ta); }
}
// Aplica una función a varias celdas como UNA sola acción de deshacer.
function lote(fn, verbo){
  if(editando) commitEdit(0,0);
  const antes=snapEstado(); const res={ n:0, saltadas:0, errores:0, avisos:[] };
  fn(res);
  if(res.n){ pushUndo(antes); pintar(); actualizarDirty(); }
  if(res.n || res.saltadas){
    let m=(res.n?verbo+' '+res.n+' celda(s).':'Nada que cambiar.')+(res.saltadas?' '+res.saltadas+' calculada(s)/clave se dejaron igual.':'');
    if(res.errores) m+=' '+res.errores+' con error (⚠): no se guardan hasta corregirlas.';
    if(res.avisos.length) m+=' '+res.avisos[0]+(res.avisos.length>1?' (y '+(res.avisos.length-1)+' aviso(s) más como este)':'');
    toast(m, res.errores ? true : (res.avisos.length ? 'aviso' : false));
  }
}
function aplicarEn(res, row, col, texto){
  if(!editableEn(row,col)){ res.saltadas++; return; }
  const cambio=setValor(row,col,texto);
  if(cambio) res.n++;
  if(row._err && row._err[col.k]) res.errores++;
  else if(cambio){ const av=avisoFijas(row, col.k); if(av && res.avisos.indexOf(av)<0) res.avisos.push(av); }
}
function pegar(txt){
  if(!act || !PUEDE_EDITAR) return;
  const grid=txt.replace(/\r/g,'').replace(/\n$/,'').split('\n').map(function(l){ return l.split('\t'); });
  const r0=act.r, c0=act.c;
  lote(function(res){
    for(let dr=0;dr<grid.length;dr++){ const r=r0+dr; if(r>=VIS.length) break;
      for(let dc=0;dc<grid[dr].length;dc++){ const c=c0+dc; if(c>=COLS.length) break; aplicarEn(res, VIS[r], COLS[c], grid[dr][dc]); } }
  }, 'Pegadas');
}
function rellenar(){
  if(!PUEDE_EDITAR) return;
  const rc=rango(); if(!rc){ toast('Elige la celda o el rango a rellenar.', true); return; }
  const hasta=(rc.r0===rc.r1) ? VIS.length-1 : rc.r1;     // una fila → a TODAS las de abajo (como en DATA)
  lote(function(res){
    for(let c=rc.c0;c<=rc.c1;c++){ const base=textoCopia(VIS[rc.r0], COLS[c]); for(let r=rc.r0+1;r<=hasta;r++) aplicarEn(res, VIS[r], COLS[c], base); }
  }, 'Rellenadas');
}
function borrarSeleccion(){
  if(!PUEDE_EDITAR) return;
  const rc=rango(); if(!rc) return;
  lote(function(res){ for(let r=rc.r0;r<=rc.r1;r++) for(let c=rc.c0;c<=rc.c1;c++) aplicarEn(res, VIS[r], COLS[c], ''); }, 'Vaciadas');
}

/* ---------- alta / baja de periodos (solo el plan) ---------- */
function filaPorKey(k){ return T.plan.filas.filter(function(r){ return String(r._key)===String(k); })[0]||null; }
function periodoActual(){ const h=hoyBogota(); const p=h.slice(0,8)+'01'; return (+h.slice(8,10)>=16) ? C.sumarMeses(p,1) : p; }
function altaPeriodo(){
  if(!PUEDE_EDITAR) return;
  if(!cargado){ toast('La Proyección no se cargó: recarga la página antes de añadir periodos.', true); return; }
  if(editando) commitEdit(0,0);
  if(TAB!=='plan') verTab('plan', true);
  const vivos=T.plan.filas.filter(function(x){ return !x._baja && x.periodo; });
  let p=vivos.length ? C.sumarMeses(vivos.reduce(function(m,x){ return x.periodo>m?x.periodo:m; }, ''), 1) : periodoActual();
  while(vivos.some(function(x){ return x.periodo===p; })) p=C.sumarMeses(p,1);
  const antes=snapEstado();
  const r={ _key:'nuevo-'+(++tempSeq), periodo:p, excavacion:'', terraplen:'', subbase:'', base:'', noaprov:'', formulas:{},
    version:0, editado_por:'', editado_ts:'', _alta:true, _baja:false, _err:{}, _orig:{} };
  T.plan.filas.push(r); ordenar('plan'); pushUndo(antes);
  pintar(); actualizarDirty();
  const i=VIS.indexOf(r), ci=COLS.findIndex(function(c){ return c.k==='excavacion'; });
  if(i>=0) setActiva(i, ci<0?0:ci, false, true);
  const w=document.getElementById('wrap'); if(w) w.focus({preventScroll:true});
  toast('Periodo '+C.mesTxt(p)+' (acta '+actaDePeriodo(p)+') añadido: escribe sus cantidades y Guarda.');
}
function bajaFila(key){
  if(!PUEDE_EDITAR) return;
  if(editando) commitEdit(0,0);
  const r=filaPorKey(key); if(!r) return;
  if(!r._alta && !confirm('¿Eliminar el periodo '+C.mesTxt(r.periodo)+' (acta '+actaDePeriodo(r.periodo)+') del plan? Se borra al Guardar.')) return;
  const antes=snapEstado();
  if(r._alta) T.plan.filas=T.plan.filas.filter(function(x){ return x!==r; }); else r._baja=true;
  pushUndo(antes); pintar(); actualizarDirty();
  toast('Periodo '+C.mesTxt(r.periodo)+' eliminado'+(r._alta?'.':' (se borra al Guardar; Ctrl+Z lo recupera).'));
}

/* ---------- cambios pendientes ---------- */
function esDirty(tab, r){
  if(r._alta||r._baja) return true;
  if(CAMPOS[tab].some(function(k){ return String(r[k]==null?'':r[k])!==String(r._orig[k]==null?'':r._orig[k]); })) return true;
  return tab==='plan' && firmaF(r.formulas)!==firmaF(r._orig.formulas);
}
function numOut(v){ return (v===''||v==null) ? null : Number(v); }
function camposDe(tab, r){
  const o={};
  CAMPOS[tab].forEach(function(k){ o[k]=(tab==='parametros' && k==='acta_base') ? String(r[k]) : numOut(r[k]); });
  if(tab==='plan') o.formulas=limpiaFormulas(r.formulas, r);
  return o;
}
function claveDe(tab, r){
  if(tab==='plan') return { periodo:r._orig.periodo||r.periodo };
  if(tab==='contrato') return { partida:r.partida, uf:r.uf };
  if(tab==='rendimiento') return { partida:r.partida };
  return {};
}
// Cambios de una tabla: bajas, updates y altas. El servidor no admite la misma fila dos veces en un lote: borrar
// un periodo y volver a darlo de alta antes de Guardar viaja como UN update de ese periodo con los valores nuevos.
function cambiosDe(tab){
  const bajas=[], ups=[], altas=[], bajaPorPeriodo={}, reemplazados=new Set();
  if(tab==='plan') T.plan.filas.forEach(function(r){ if(r._baja && !r._alta) bajaPorPeriodo[r._orig.periodo]=r; });
  T[tab].filas.forEach(function(r){
    if(r._baja && r._alta) return;
    if(r._alta){
      const b=bajaPorPeriodo[r.periodo];
      if(b){ reemplazados.add(b); ups.push(Object.assign({ tabla:tab, op:'update', periodo:r.periodo, if_version:b.version }, camposDe(tab,r))); }
      else altas.push(Object.assign({ tabla:tab, op:'alta', periodo:r.periodo }, camposDe(tab,r)));
      return;
    }
    if(r._baja) return;
    if(esDirty(tab,r)) ups.push(Object.assign({ tabla:tab, op:'update' }, claveDe(tab,r), { if_version:r.version }, camposDe(tab,r)));
  });
  Object.keys(bajaPorPeriodo).forEach(function(p){ const r=bajaPorPeriodo[p]; if(!reemplazados.has(r)) bajas.push({ tabla:tab, op:'baja', periodo:p, if_version:r.version }); });
  return bajas.concat(ups, altas);
}
function dirtyCambios(){ let out=[]; TABS.forEach(function(t){ out=out.concat(cambiosDe(t.id)); }); return out; }
function erroresDe(tab){
  const out=[];
  T[tab].filas.forEach(function(r){ if(r._baja) return; Object.keys(r._err||{}).forEach(function(k){ out.push({ tab:tab, fila:r, k:k }); }); });
  return out;
}
function actualizarDirty(){
  const n=dirtyCambios().length; const b=document.getElementById('btnGuardar'), c=document.getElementById('nDirty');
  if(c) c.textContent=n; if(b) b.disabled=(n===0);
  pintarTabs();
  try{ if(window.parent!==window) window.parent.postMessage({ tm2:'dirty', page:'proyeccion', n:n }, location.origin); }catch(e){}
}
function nombreFila(tab, r){
  if(tab==='plan') return 'Plan '+C.mesTxt(r.periodo);
  if(tab==='contrato') return 'Contrato '+r.etiqueta+(r.uf?' '+r.uf:'');
  if(tab==='rendimiento') return 'Rendimiento '+r.etiqueta;
  return 'Parámetros';
}
function irAError(x){
  if(x.tab!==TAB) verTab(x.tab, true);
  const i=VIS.indexOf(x.fila), c=COLS.findIndex(function(col){ return col.k===x.k; });
  if(i>=0 && c>=0) setActiva(i,c,false,true);
}

/* ---------- guardar (las cuatro pestañas en UN POST = una transacción) ---------- */
let guardando=false;
async function guardar(btn){
  if(guardando) return;
  if(editando) commitEdit(0,0);
  if(!PUEDE_EDITAR) return;
  if(!cargado){ toast('La Proyección no se cargó: recarga la página. No se guardó nada.', true); return; }
  let errs=[]; TABS.forEach(function(t){ errs=errs.concat(erroresDe(t.id)); });
  if(errs.length){ irAError(errs[0]); toast('Hay '+errs.length+' celda(s) con error (⚠): corrígelas o vacíalas antes de guardar.', true); return; }
  const cambios=dirtyCambios(); if(!cambios.length){ toast('No hay cambios que guardar.'); return; }
  if(cambios.length>500){ toast('Son '+cambios.length+' cambios: el máximo por Guardar es 500.', true); return; }
  guardando=true; if(btn) btn.disabled=true;
  let d; try{ d=await api(null,{ action:'proyeccion_guardar', cambios:cambios }); }catch(e){ d={ ok:false, error:'Sin conexión: no se guardó nada.' }; }
  guardando=false;
  if(caducada(d)) return;
  if(d && d.ok){ AVISO=''; aplicarModelo(d); toast(d.mensaje||('Guardados '+cambios.length+' cambio(s).')); return; }
  if(d && d.error==='version' && d.tablas){ rebase(d); return; }
  actualizarDirty();
  if(d && d.error==='payload'){ toast('Dato inválido en «'+(d.campo||'')+'»: '+(d.detalle||''), true); return; }
  toast((d&&(d.mensaje||d.error))||'No se guardó.', true);
}
/* Conflicto de versión: el servidor no guardó NADA (rollback) y devuelve lo que hay en la base. Se carga
 * eso y se vuelven a poner encima los cambios propios que siguen valiendo (filas que nadie tocó); los de
 * filas que otra persona cambió o borró —o un periodo nuevo que ya existe— se pierden y se avisan. */
function rebase(d){
  const previo={}; TABS.forEach(function(t){ previo[t.id]=T[t.id].filas; });
  aplicarModelo(d);
  let siguen=0; const perdidos=[];
  TABS.forEach(function(t){
    const tab=t.id;
    // primero lo que ya existía (updates y bajas), después las altas (una baja + alta del mismo periodo se respeta)
    const altas=previo[tab].filter(function(r){ return r._alta; });
    previo[tab].filter(function(r){ return !r._alta; }).concat(altas).forEach(function(r){
      if(!esDirty(tab,r)) return;
      if(r._alta){
        if(r._baja) return;
        if(T.plan.filas.some(function(x){ return !x._baja && x.periodo===r.periodo; })){ perdidos.push(nombreFila(tab,r)+' (ya existe)'); return; }
        T.plan.filas.push(JSON.parse(JSON.stringify(r))); siguen++; return;
      }
      const f=T[tab].filas.filter(function(x){ return x._key===r._key; })[0];
      if(!f){ perdidos.push(nombreFila(tab,r)+' (la borraron)'); return; }
      if(f.version!==r.version){ perdidos.push(nombreFila(tab,r)+' (la cambió '+(f.editado_por||'otra persona')+')'); return; }
      if(r._baja){ f._baja=true; siguen++; return; }
      CAMPOS[tab].forEach(function(k){ f[k]=r[k]; });
      if(tab==='plan') f.formulas=Object.assign({}, r.formulas);
      siguen++;
    });
    ordenar(tab);
  });
  // d.mensaje (del servidor) resume los conflictos; la lista de lo descartado sale de comparar versiones con lo fresco.
  AVISO='<b>'+esc(d.mensaje||'Otra persona guardó cambios antes que tú: no se guardó nada.')+'</b>'
    +(siguen?' <b>'+siguen+' cambio(s) tuyos siguen pendientes</b> encima de lo recargado: revísalos y vuelve a Guardar.':'')
    +(perdidos.length?' Se descartaron: '+perdidos.map(esc).join(' · ')+'.':'');
  pintarTodo(); actualizarDirty();
  toast('No se guardó: otra persona cambió la Proyección. Revisa el aviso y vuelve a Guardar.', true);
}

/* ---------- arranque ---------- */
montarEventos();
(function(){
  let t=''; try{ t=new URLSearchParams(location.search).get('tab')||localStorage.getItem('tm2_proy_tab')||''; }catch(e){}
  if(T[t]) TAB=t;
  modoUI(); pintarTabs();
  cargar();
})();
