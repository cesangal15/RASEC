/**
 * api/parte.js — Parte Digital de Maquinaria portado al Worker (4.01 · Fase 2 · D180).
 *
 * Es backend/CodigoParte.gs (V3-01 / D165 … D178) función por función, con los MISMOS nombres y el
 * MISMO contrato (`?mod=parte&op=…`, POST JSON en text/plain, `{ok, auth}`, `_ms`), pero leyendo y
 * escribiendo en Postgres (esquema worker/sql/001_esquema.sql) en vez de en las hojas PARTE_*:
 *
 *   GET  ?mod=parte&op=equipo&eq=CODIGO         PÚBLICO  → datos del equipo + último final + listas
 *   POST {mod:'parte', op:'reporte', ...}        PÚBLICO  → inserta 1..n filas `pendiente` con alertas
 *   GET  ?mod=parte&op=bandeja&fecha=            TOKEN    → pendientes + revisadas + faltantes del día
 *   POST {mod:'parte', op:'revisar', cambios:[]} TOKEN    → cambia estado / edita campos (por id_registro)
 *   POST {mod:'parte', op:'repartir', …}         TOKEN    → D178: abre una fila en N, la original queda descartada
 *   GET  ?mod=parte&op=base&desde=&hasta=        TOKEN    → aprobados del rango + filas en orden Excel
 *
 * Qué cambia respecto al .gs y por qué (informe §3 Fase 2 y §7):
 *   · La capa de datos: `readSheet('PARTE_EQUIPOS')` → `SELECT … FROM parte_equipos`; `parteCols_` /
 *     `parteFilasCompletas_` / `readSheetPorFecha_` → consultas por código o por fecha con índice;
 *     `parteUltimoFinal_` se calcula igual que antes sobre el historial del equipo (una consulta por
 *     código) y, para los faltantes de la bandeja, con `SELECT DISTINCT ON (codigo)` en una sola ida.
 *   · Escrituras: UNA transacción por petición (`sql.begin`), sin lock. `op=reporte` inserta con
 *     `ON CONFLICT (obra_id, id_registro) DO NOTHING` (D82: el reenvío de la cola offline cuenta como
 *     `duplicadas`, aunque llegue en paralelo). `op=revisar` y `op=repartir` bloquean la fila con
 *     `FOR UPDATE` dentro de la transacción y la reescriben; nunca se borra una fila.
 *   · Sin `ensureRows_`, `parteFormatoTexto_`, `invalidarHoja_`, `_memoRango`: no hay celdas. Los
 *     catálogos se memorizan por PETICIÓN en `c.memo` (memo_ de comun.js: una consulta por tabla y petición).
 *   · Sin `setupParte()` ni `depurarOperadoresParte()`: eran mantenimiento de la HOJA. Desde 4.01 los
 *     catálogos (parte_equipos, parte_cc, parte_items, parte_operadores, parte_actividades, maquinas,
 *     base_items) se editan en Supabase (Table Editor); el backfill (worker/sql/backfill_parte.js) fue la
 *     carga inicial, no hay pull Sheet→BD.
 *   · La flota vigente (D173) sale de la tabla `maquinas` con la misma regla de `flotaEnFecha_` acotada
 *     a lo que el Parte usa (todos los tipos, frentes PARTE_FRENTES): parteFlotaVigente_ de src/catalogos.js,
 *     de donde también vienen parteEquipos_/parteEquiposActivos_/parteSelectorEquipos_ (OBRA los comparte).
 *   · `parteDescBase_` lee `base_items` (tabla de ítems A–H de la hoja BASE) vía baseItems_ de catalogos.js.
 *
 * Todo lo que es NEGOCIO (alertas, topes, reparto por %, alias de operadores, normalización «02.10»,
 * permisos, validación D166, rate limit público 20/h por equipo y 200/h global) está copiado tal cual.
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 */
import {
  OBRA_ID, json, hoyBogota, fdate, toDate, fdateValida_, normTexto, ccCorto, memo_,
  logIdentidad_, logMarcar_, puerta_, sesion_, rateLimit_, respuestaRateLimit_,
  valEsquema_, valListaDe_, rechazoPayload_, VAL_MAX_HORAS
} from '../comun.js';
// Fases 3–4: los catálogos que OBRA también usa (fichas de parte_equipos, flota vigente de `maquinas`,
// ítems de la BASE) viven en src/catalogos.js con los mismos nombres; aquí solo se importan.
import { parteEquipos_, parteFlotaVigente_, parteEquiposActivos_, parteSelectorEquipos_, baseItems_ } from '../catalogos.js';

/* ---------- hojas → tablas ---------- */
export const PARTE_BANDEJA_HEADERS = ['id_registro','timestamp','estado','fecha','codigo','tipo','placa','medidor',
  'reporte_num','inicial','final','total','inicial_modificado','horas_varada','horas_lluvia','hora_de','hora_a',
  'descripcion_trabajo','centro_coste','pr','uf','operador','observaciones','alertas','revisado_por','revisado_ts','origen'];

const PARTE_CC_PSEUDO = [
  { centro_coste:'Taller',          proyecto:'', descripcion_cc:'Taller / mantenimiento / equipo varado', pseudo:true },
  { centro_coste:'Disponible',      proyecto:'', descripcion_cc:'Disponible (sin frente, lluvia, sin operador)', pseudo:true },
  { centro_coste:'Domingo/Festivo', proyecto:'', descripcion_cc:'Domingo o festivo', pseudo:true }
];

/* ---------- reglas (idénticas a CodigoParte.gs) ---------- */
// D193: el residente de drenajes también revisa (con el filtro Tierras/Drenajes de la pantalla).
const PARTE_ROLES_REVISAN = ['admin','encargado','residente','parte_maquinaria','residente_dren'];
// D193: duvan (asistencias de drenajes; lo usa Stiven) también revisa — enmienda D178, que lo dejaba fuera.
const PARTE_USUARIOS_REVISAN = ['jeisson','duvan'];
// D198: el jefe trabaja la BASE de aprobados desde el Panel de Obra: la lee y corrige sus campos (CC, horas, …),
// pero no ve Pendientes ni cambia estados (aprobar/descartar) ni reparte: eso sigue siendo de quien revisa.
const PARTE_ROLES_EDITAN_BASE = ['jefe'];
function parteLeeBase_(ses){ return !!(ses && ses.ok) && PARTE_ROLES_EDITAN_BASE.indexOf(String(ses.rol||'').trim().toLowerCase())>=0; }
const PARTE_MAX_HABITUALES = 5;
const PARTE_OPERADORES_ALIAS = {
  'ALEYXER RINCON':'Aleyxer Rincon',
  'EDUARD ACEVEDO':'Eduar Acevedo', 'EDWAR ACEVEDO':'Eduar Acevedo',
  'EDWIN FERNENDEZ':'Edwin Fernandez',
  'WILMAR PAWANA':'Wilmar Pahuana', 'WILMER PAHUANA':'Wilmar Pahuana',
  'YERSON SANDOVAL':'Yerson Sandobal',
  'ALEX GUERRERO':'Jhon Alex Guerrero',
  'MIGUEL GOMEZ':'Miguel Angel Gomez',
  'NELSON TORRES':'Nelson Gabriel Torres', 'GABRIEL TORRES':'Nelson Gabriel Torres',
  'JUAN DAVID DE ANGEL BARRIOS':'Juan David De Angel',
  'SERGIO ANDRES ARENAS':'Sergio Arenas',
  'A. GUTIERREZ':'Alizon Gutierrez',
  'JAN CARLOS':'Jean Carlos Muñoz'
};
function parteOperadorCanon_(n){ const s=parteTexto_(n); if(!s) return ''; const c=PARTE_OPERADORES_ALIAS[normTexto(s)]; return c || s; }
// PARTE_FRENTES (['UF1-UF2']) se importa de catalogos.js
const PARTE_TOPES = { HOROMETRO:{ bloquea:24, alerta:12, unidad:'h' }, KM:{ bloquea:700, alerta:400, unidad:'km' } };
const PARTE_DIAS_CC_RECIENTE = 30;
const PARTE_MAX_DIAS_BASE   = 186;
const PARTE_ESTADOS = ['pendiente','aprobado','descartado'];
const PARTE_RL_EQUIPO_HORA = 20;
const PARTE_RL_GLOBAL_HORA = 200;
const PARTE_RL_VENTANA_S   = 3600;
const PARTE_VAL_MAX_MEDIDOR = 10000000;
const PARTE_VAL_TRAMO = {
  reporte_num:['t',30], operador:['t',100], inicial:['n',0,PARTE_VAL_MAX_MEDIDOR], final:['n',0,PARTE_VAL_MAX_MEDIDOR],
  hora_de:['h'], hora_a:['h'], centro_coste:['t',100], pr:['n',0,1000000], uf:['t',5], descripcion_trabajo:['t',500],
  horas_varada:['n',0,VAL_MAX_HORAS], horas_lluvia:['n',0,VAL_MAX_HORAS], observaciones:['t',1000],
  inicial_modificado:['t',10], id_registro:['t',100], reparto:['a',10]
};
const PARTE_VAL_REPARTO = { centro_coste:['t',100], pct:['n',0,100], pr:['n',0,1000000], uf:['t',5], descripcion_trabajo:['t',500] };
const PARTE_VAL_REPORTE = { codigo:['t',50], origen:['t',20], tramos:['a',50] };
const PARTE_VAL_CAMBIO  = { id_registro:['t',100], estado:['l',PARTE_ESTADOS] };
const PARTE_VAL_REPARTIR = { id_registro:['t',100], reparto:['a',10] };
const PARTE_VAL_CAMPOS  = {
  fecha:['f',0], reporte_num:['t',30], inicial:['n',0,PARTE_VAL_MAX_MEDIDOR], final:['n',0,PARTE_VAL_MAX_MEDIDOR],
  horas_varada:['n',0,VAL_MAX_HORAS], horas_lluvia:['n',0,VAL_MAX_HORAS], hora_de:['h'], hora_a:['h'],
  descripcion_trabajo:['t',500], centro_coste:['t',100], pr:['n',0,1000000], uf:['t',5], operador:['t',100], observaciones:['t',1000]
};
function parteValidarReporte_(c, body){
  let f=valEsquema_(body, PARTE_VAL_REPORTE, '');
  if(!f && body.tramo!==undefined && !Array.isArray(body.tramos)) f=valEsquema_(body.tramo, PARTE_VAL_TRAMO, 'tramo');
  if(!f) f=valListaDe_(body.tramos, PARTE_VAL_TRAMO, 'tramos', 50);
  if(!f && Array.isArray(body.tramos)){
    for(let i=0;i<body.tramos.length && !f;i++){ const t=body.tramos[i]; if(t) f=valListaDe_(t.reparto, PARTE_VAL_REPARTO, 'tramos['+i+'].reparto', 10); }
  }
  return f ? rechazoPayload_(c, f.campo, f.motivo) : null;
}
function parteValidarRepartir_(c, body){
  let f=valEsquema_(body, PARTE_VAL_REPARTIR, '');
  if(!f) f=valListaDe_(body.reparto, PARTE_VAL_REPARTO, 'reparto', 10);
  return f ? rechazoPayload_(c, f.campo, f.motivo) : null;
}
function parteValidarRevisar_(c, body){
  let f=valListaDe_(body.cambios, PARTE_VAL_CAMBIO, 'cambios', 200);
  if(!f && Array.isArray(body.cambios)){
    for(let i=0;i<body.cambios.length && !f;i++){ const x=body.cambios[i]; if(x) f=valEsquema_(x.campos, PARTE_VAL_CAMPOS, 'cambios['+i+'].campos'); }
  }
  return f ? rechazoPayload_(c, f.campo, f.motivo) : null;
}
function parteRechazoEquipo_(c, cod, detalle){
  logMarcar_(c, 'rechazado', 'equipo: '+detalle);
  return json(c, { ok:false, error:'equipo', detalle:'El código de equipo «'+cod+'» '+detalle+'. No se guardó nada. Elige tu equipo en la lista o avisa a maquinaria.' });
}

/* ---------- mapeo a BASE MAQUINARIA (Excel) ---------- */
const PARTE_EXCEL_PRIMERA = 'B';
const PARTE_EXCEL_ULTIMA  = 'AR';
const PARTE_EXCEL_MAPA = {
  C:'fecha', E:'reporte_num', F:'codigo', M:'inicial_h', N:'final_h', Q:'horas_varada', R:'horas_lluvia',
  V:'inicial_km', W:'final_km', AA:'descripcion_trabajo', AB:'centro_coste', AD:'pr', AE:'uf',
  AL:'hora_de', AM:'hora_a', AQ:'operador', AR:'observaciones'
};

/* ============ utilidades (copiadas) ============ */
function parteColNum_(letra){ let n=0; const s=String(letra||'').toUpperCase(); for(let i=0;i<s.length;i++) n=n*26+(s.charCodeAt(i)-64); return n; }
function parteColLetra_(n){ let s=''; while(n>0){ const r=(n-1)%26; s=String.fromCharCode(65+r)+s; n=Math.floor((n-1)/26); } return s; }
function parteExcelColumnas_(){
  const out=[]; for(let n=parteColNum_(PARTE_EXCEL_PRIMERA); n<=parteColNum_(PARTE_EXCEL_ULTIMA); n++) out.push(parteColLetra_(n));
  return out;
}
export function parteNormCod_(s){ return String(s==null?'':s).replace(/[^A-Za-z0-9]/g,'').toUpperCase(); }
function parteSiNo_(v, defecto){
  const s=String(v==null?'':v).trim().toUpperCase();
  if(!s) return defecto;
  return !(s==='NO' || s==='N' || s==='FALSE' || s==='0' || s==='INACTIVO' || s==='INACTIVA');
}
function parteNum_(v){
  if(v===null || v===undefined || v==='') return null;
  if(typeof v==='number') return isFinite(v) ? v : null;
  const n=Number(String(v).trim().replace(/\s/g,'').replace(',','.'));
  return isFinite(n) ? n : null;
}
function parteRedondea_(n){ return Math.round(n*100)/100; }
function parteMedidor_(v){
  const s=normTexto(v);
  if(s.indexOf('HOR')===0) return 'HOROMETRO';
  if(s==='KM' || s.indexOf('KILOM')===0) return 'KM';
  return '';
}
function parteHoraStr_(v){
  if(v===null || v===undefined || v==='') return '';
  if(typeof v==='object' && typeof v.getHours==='function')
    return ('0'+v.getHours()).slice(-2)+':'+('0'+v.getMinutes()).slice(-2);
  if(typeof v==='number' && v>=0 && v<1){ const m=Math.round(v*24*60); return ('0'+Math.floor(m/60)).slice(-2)+':'+('0'+(m%60)).slice(-2); }
  const m=String(v).trim().match(/^(\d{1,2})[:.](\d{2})/);
  if(m) return ('0'+m[1]).slice(-2)+':'+m[2];
  return String(v).trim();
}
function parteHoraMin_(h){ const m=parteHoraStr_(h).match(/^(\d{2}):(\d{2})$/); return m ? Number(m[1])*60+Number(m[2]) : -1; }
function partePad2_(s){ s=String(s==null?'':s); return s.length>=2 ? s : ('0'+s).slice(-2); }
function partePadDec_(s){ s=String(s==null?'':s); return s.length>=2 ? s.slice(0,2) : (s+'00').slice(0,2); }
function parteNormItem_(v){
  const s=parteTexto_(v);
  if(typeof v==='number' || /^\d{1,2}(\.\d{1,2})?$/.test(s)){
    const p=String(typeof v==='number' ? v : s).split('.');
    return partePad2_(p[0])+'.'+partePadDec_(p[1]||'');
  }
  return s;
}
// D178: «3702.2.7» ¿ítem convertido a número («02.70») o persona que abrevió («02.07»)? Lo decide PARTE_CC.
// Los CC conocidos se precargan en `c.memo.ccConocidos` (precargar_) para que esta función siga siendo síncrona.
function parteCCConocidos_(c){ return c.memo.ccConocidos || {}; }
function parteNormCC_(c, v){
  const s=parteTexto_(v);
  const m=/^(37\d\d)\.(\d{1,2})\.(\d{1,2})$/.exec(s);
  if(!m) return s;
  const numerica=m[1]+'.'+partePad2_(m[2])+'.'+partePadDec_(m[3]);
  if(m[3].length===2) return numerica;
  const abreviada=m[1]+'.'+partePad2_(m[2])+'.'+partePad2_(m[3]), con=parteCCConocidos_(c);
  return (!con[numerica] && con[abreviada]) ? abreviada : numerica;
}
function parteUF_(cc){
  const s=String(cc==null?'':cc).trim();
  if(s.indexOf('3701')===0) return '1';
  if(s.indexOf('3702')===0) return '2';
  if(s.indexOf('3703')===0) return '3';
  return '';
}
function parteHoy_(){ return hoyBogota(); }
function parteFechaMasDias_(f, d){ const dt=toDate(f); if(!dt) return ''; dt.setDate(dt.getDate()+d); return fdate(dt); }
function parteTexto_(v){ return String(v==null?'':v).trim(); }
// Fila de la tabla → JSON con las 27 claves de PARTE_BANDEJA (mismo objeto que en el .gs).
function parteFilaSalida_(c, r){
  const o={};
  PARTE_BANDEJA_HEADERS.forEach(function(k){ o[k]= (r[k]===undefined || r[k]===null) ? '' : r[k]; });
  o.fecha=fdate(o.fecha);
  o.hora_de=parteHoraStr_(o.hora_de); o.hora_a=parteHoraStr_(o.hora_a);
  ['reporte_num','codigo','estado','origen','uf','centro_coste','operador','descripcion_trabajo','observaciones','alertas','revisado_por','inicial_modificado']
    .forEach(function(k){ o[k]=parteTexto_(o[k]); });
  o.centro_coste=parteNormCC_(c, o.centro_coste);
  ['inicial','final','total','horas_varada','horas_lluvia','pr'].forEach(function(k){ const n=parteNum_(o[k]); o[k]= n===null ? '' : n; });
  if(o.timestamp && typeof o.timestamp==='object' && typeof o.timestamp.getFullYear==='function') o.timestamp=o.timestamp.toISOString();
  if(o.revisado_ts && typeof o.revisado_ts==='object' && typeof o.revisado_ts.getFullYear==='function') o.revisado_ts=o.revisado_ts.toISOString();
  return o;
}

/* ============ catálogos (una consulta por tabla y petición; memo_ de comun.js) ============
 * parteEquipos_, parteFlotaVigente_ (D173: flotaEnFecha_ con {todos:true, frentes:PARTE_FRENTES}, null si
 * la tabla `maquinas` no tiene una sola estancia válida), parteEquiposActivos_ y parteSelectorEquipos_
 * viven ahora en src/catalogos.js (los usa también OBRA); se importan arriba con los mismos nombres. */
/* ============ D174 — actividad primero, CC derivado ============ */
function parteItemDeCC_(cc){ const m=/^37\d\d\.(.+)$/.exec(String(cc==null?'':cc).trim()); return m ? m[1] : ''; }
async function parteItems_(c){
  return memo_(c, 'items', async function(){
    const out=[];
    const filas=await c.sql`SELECT tipo_equipo, item, actividad, veces, activo FROM parte_items WHERE obra_id=${OBRA_ID}`;
    filas.forEach(function(r){
      const item=parteNormItem_(r.item); if(!item || !parteSiNo_(r.activo, true)) return;
      out.push({ tipo:parteTexto_(r.tipo_equipo), item:item, actividad:parteTexto_(r.actividad), veces:parteNum_(r.veces)||0 });
    });
    return out;
  });
}
function parteNombreItem_(item, ccs){
  const x=ccs.filter(function(y){ return !y.pseudo && parteItemDeCC_(y.centro_coste)===item && y.descripcion_cc; })[0];
  return x ? x.descripcion_cc : '';
}
function parteEtiquetaItem_(item, filasTipo, tabla, ccs){
  const pick=function(fs){ return fs.filter(function(x){ return x.item===item && x.actividad; }).sort(function(a,b){ return b.veces-a.veces; })[0]; };
  const f=pick(filasTipo||[]) || pick(tabla);
  if(f) return f.actividad;
  return parteNombreItem_(item, ccs) || item;
}
// V3-19: dos chips nunca llevan la MISMA frase (p. ej. cuatro «Excavacion» con CC distintos en la retro de
// llantas): si la frase ya la usa un chip anterior, se toma otra frase de ese ítem (primero las del tipo, luego
// cualquiera), luego el nombre de catálogo y, en último caso, la frase con el ítem al lado. El orden no cambia.
function parteEtiquetasUnicas_(lista, filasTipo, tabla, ccs){
  const usadas={};
  lista.forEach(function(a){
    let lab=a.actividad;
    if(usadas[normTexto(lab)]){
      const frases=function(fs){ return fs.filter(function(x){ return x.item===a.item && x.actividad; }).sort(function(p,q){ return q.veces-p.veces; }).map(function(x){ return x.actividad; }); };
      const cands=frases(filasTipo||[]).concat(frases(tabla), [a.nombre||parteNombreItem_(a.item, ccs)]);
      lab=cands.filter(function(t){ return t && !usadas[normTexto(t)]; })[0] || (a.actividad+" · "+a.item);
    }
    usadas[normTexto(lab)]=1; a.actividad=lab;
  });
  return lista;
}
async function parteActividades_(c, q, hist){
  const tabla=await parteItems_(c), ccs=await parteCC_(c), hoy=parteHoy_(), desde=parteFechaMasDias_(hoy, -PARTE_DIAS_CC_RECIENTE);
  const propios={}; let ultimoProy='', ultimaFecha='';
  (hist||[]).forEach(function(r){
    if(parteEstadoDe_(r)==='descartado') return;
    const cc=parteTexto_(r.centro_coste), item=parteItemDeCC_(cc); if(!item) return;
    if(r.fecha>=desde) propios[item]=(propios[item]||0)+1;
    if(r.fecha>ultimaFecha){ ultimaFecha=r.fecha; ultimoProy=cc.slice(0,4); }
  });
  const exacto=normTexto(q.tipo), base=parteTipoBase_(q.tipo);
  let delTipo=tabla.filter(function(x){ return normTexto(x.tipo)===exacto; });
  if(!delTipo.length) delTipo=tabla.filter(function(x){ return parteTipoBase_(x.tipo)===base; });
  if(!delTipo.length) delTipo=tabla.filter(function(x){ const b=parteTipoBase_(x.tipo); return b && base && (b.indexOf(base)===0 || base.indexOf(b)===0); });
  const vistos={}, habituales=[];
  Object.keys(propios).sort(function(a,b){ return propios[b]-propios[a]; }).forEach(function(item){
    vistos[item]=1; habituales.push({ item:item, actividad:parteEtiquetaItem_(item, delTipo, tabla, ccs), nombre:parteNombreItem_(item, ccs), veces:propios[item], propio:true });
  });
  delTipo.sort(function(a,b){ return b.veces-a.veces; }).forEach(function(x){
    if(vistos[x.item]) return; vistos[x.item]=1;
    habituales.push({ item:x.item, actividad:parteEtiquetaItem_(x.item, delTipo, tabla, ccs), nombre:parteNombreItem_(x.item, ccs), veces:x.veces, propio:false });
  });
  const todosV={}, todas=[];
  tabla.forEach(function(x){
    const k=normTexto(x.actividad)+'|'+x.item; if(!x.actividad || todosV[k]) return; todosV[k]=1;
    todas.push({ item:x.item, actividad:x.actividad, nombre:parteNombreItem_(x.item, ccs) });
  });
  todas.sort(function(a,b){ return normTexto(a.actividad)<normTexto(b.actividad)?-1:normTexto(a.actividad)>normTexto(b.actividad)?1:(a.item<b.item?-1:1); });
  return { habituales:parteEtiquetasUnicas_(habituales.slice(0,PARTE_MAX_HABITUALES), delTipo, tabla, ccs), todas:todas, proyecto_habitual:(ultimoProy==='3702'?'3702':'3701') };
}
async function parteEquipoVigente_(c, cod, fecha){
  const k=parteNormCod_(cod);
  return (await parteEquiposActivos_(c, fecha)).filter(function(q){ return parteNormCod_(q.codigo)===k; })[0] || null;
}
async function parteOperadores_(c){
  return memo_(c, 'operadores', async function(){
    const vistos={}, out=[];
    const filas=await c.sql`SELECT operador, partes_ult_4_meses, activo FROM parte_operadores WHERE obra_id=${OBRA_ID}`;
    filas.forEach(function(r){
      const n=parteOperadorCanon_(r.operador); if(!n || !parteSiNo_(r.activo, true)) return;
      const k=normTexto(n); if(vistos[k]) return; vistos[k]=1; out.push(n);
    });
    return out.sort(function(a,b){ return normTexto(a)<normTexto(b)?-1:1; });
  });
}
async function parteCCCrudos_(c){
  return memo_(c, 'cc_crudos', function(){ return c.sql`SELECT centro_coste, proyecto, descripcion_cc, usos_ult_4_meses, activo FROM parte_cc WHERE obra_id=${OBRA_ID}`; });
}
// Precarga lo que las funciones SÍNCRONAS del .gs leían por su cuenta (parteCCConocidos_, getBaseItems).
async function precargar_(c){
  if(c.memo.ccConocidos) return;
  const set={};
  (await parteCCCrudos_(c)).forEach(function(r){ const s=parteTexto_(r.centro_coste); if(/^37\d\d\.\d\d\.\d\d$/.test(s)) set[s]=1; });
  c.memo.ccConocidos=set;
}
async function parteCC_(c){
  return memo_(c, 'cc', async function(){
    await precargar_(c);
    const base=await parteBaseItems_(c);
    const vistos={}, out=[];
    (await parteCCCrudos_(c)).forEach(function(r){
      const cc=parteNormCC_(c, r.centro_coste); if(!cc || !parteSiNo_(r.activo, true)) return;
      const k=normTexto(cc); if(vistos[k]) return; vistos[k]=1;
      const esPseudo=PARTE_CC_PSEUDO.some(function(p){ return normTexto(p.centro_coste)===k; });
      out.push({ centro_coste:cc, proyecto:parteTexto_(r.proyecto), descripcion_cc:parteTexto_(r.descripcion_cc) || parteDescBase_(base, cc),
                 usos:parteNum_(r.usos_ult_4_meses)||0, pseudo:esPseudo });
    });
    PARTE_CC_PSEUDO.forEach(function(p){ if(!vistos[normTexto(p.centro_coste)]) out.push({ centro_coste:p.centro_coste, proyecto:'', descripcion_cc:p.descripcion_cc, usos:0, pseudo:true }); });
    return out.sort(function(a,b){
      if(a.pseudo!==b.pseudo) return a.pseudo?1:-1;
      if(a.pseudo) return 0;
      if(b.usos!==a.usos) return b.usos-a.usos;
      return a.centro_coste<b.centro_coste?-1:1;
    });
  });
}
// Descripción del ítem desde `base_items` (copia de la tabla A–H de la hoja BASE, D68) cuando PARTE_CC no la trae.
// = getBaseItems acotado a {cc:[{desc, norm}]}: el lector completo (con drenajes) es baseItems_ de catalogos.js.
async function parteBaseItems_(c){ return (await baseItems_(c)).items; }
function parteDescBase_(items, cc){
  try{
    const cand=items[String(cc==null?'':cc).trim()] || items[ccCorto(cc)];
    return (cand && cand.length) ? String(cand[0].desc||'') : '';
  }catch(err){ return ''; }
}
function parteEsPseudoCC_(cc){ const k=normTexto(cc); return PARTE_CC_PSEUDO.some(function(p){ return normTexto(p.centro_coste)===k; }); }
function parteTipoBase_(t){ return normTexto(t).replace(/ES\b/g,'').replace(/S\b/g,'').replace(/\s+/g,' ').trim(); }
async function parteSugerencias_(c, tipo){
  const filas=await memo_(c, 'actividades', function(){ return c.sql`SELECT tipo_equipo, descripcion_trabajo, veces FROM parte_actividades WHERE obra_id=${OBRA_ID}`; });
  const exacto=normTexto(tipo), base=parteTipoBase_(tipo);
  const toma=function(pred){
    const vistos={}, out=[];
    filas.forEach(function(r){
      if(!pred(r)) return;
      const d=parteTexto_(r.descripcion_trabajo); if(!d) return;
      const k=normTexto(d); if(vistos[k]) return; vistos[k]=1;
      out.push({ d:d, v:parteNum_(r.veces)||0 });
    });
    return out.sort(function(a,b){ return b.v-a.v; }).map(function(x){ return x.d; });
  };
  let out=toma(function(r){ return normTexto(r.tipo_equipo)===exacto; });
  if(!out.length && base) out=toma(function(r){ return parteTipoBase_(r.tipo_equipo)===base; });
  if(!out.length && base) out=toma(function(r){ const b=parteTipoBase_(r.tipo_equipo); return b && (b.indexOf(base)===0 || base.indexOf(b)===0); });
  return out.slice(0, 40);
}

/* ============ PARTE_BANDEJA: historial del equipo (sustituye a parteCols_ + PARTE_COLS_CLAVE) ============
 * Una consulta por código: las mismas 9 columnas que leía el .gs, filtradas por el código NORMALIZADO
 * (parteNormCod_) para que una fila vieja escrita con otra grafía siga contando. */
async function parteHistorial_(c, codigo){
  const k=parteNormCod_(codigo);
  return memo_(c, 'hist|'+k, async function(){
    const filas=await c.sql`SELECT id_registro, estado, fecha, codigo, reporte_num, final, hora_de, hora_a, centro_coste, "timestamp"
      FROM parte_bandeja WHERE obra_id=${OBRA_ID} AND upper(regexp_replace(codigo, '[^A-Za-z0-9]', '', 'g'))=${k}`;
    return filas.map(function(r){ r.fecha=fdate(r.fecha); return r; });
  });
}
function parteEstadoDe_(r){ return parteTexto_(r.estado).toLowerCase() || 'pendiente'; }
// Minuto de FIN del turno tratando el cruce de medianoche (D188 — turno noche). Un turno que arranca 18:00
// y termina 06:00 se reporta en el día que EMPIEZA, así que su hora_a (06:00) es del día siguiente y en
// realidad ocurrió DESPUÉS que la de entrada: se le suman 24 h para que ordene como lo que es, lo último.
// Sin hora_de válida (o sin cruce) es el minuto de hora_a tal cual, como antes.
export function parteFinMin_(horaDe, horaA){
  const mA=parteHoraMin_(horaA); if(mA<0) return -1;
  const mDe=parteHoraMin_(horaDe);
  return (mDe>=0 && mA<mDe) ? mA+1440 : mA;
}
// Último `final` del equipo a partir de su historial (misma regla que el .gs: fecha, hora de FIN, timestamp;
// D188: la hora de fin cruza medianoche por parteFinMin_, así el turno noche cuenta como el más reciente).
export function parteUltimoFinalDe_(hist, equipo){
  let mejor=null;
  (hist||[]).forEach(function(r){
    if(parteEstadoDe_(r)==='descartado') return;
    const fin=parteNum_(r.final); if(fin===null) return;
    const ts = (r.timestamp && typeof r.timestamp==='object' && typeof r.timestamp.getTime==='function') ? r.timestamp.getTime() : 0;
    const cand={ final:fin, fecha:r.fecha, hora_a:parteHoraStr_(r.hora_a), min:parteFinMin_(r.hora_de, r.hora_a), ts:ts, id_registro:parteTexto_(r.id_registro), origen:'bandeja' };
    if(!mejor || cand.fecha>mejor.fecha || (cand.fecha===mejor.fecha && (cand.min>mejor.min || (cand.min===mejor.min && cand.ts>=mejor.ts)))) mejor=cand;
  });
  if(mejor) return { final:mejor.final, fecha:mejor.fecha, hora_a:mejor.hora_a, origen:'bandeja', id_registro:mejor.id_registro };
  if(equipo.ultimo_final_manual!==null && equipo.ultimo_final_manual!==undefined)
    return { final:equipo.ultimo_final_manual, fecha:equipo.ultima_fecha||'', hora_a:'', origen:'catalogo', id_registro:'' };
  return null;
}
async function parteUltimoFinal_(c, equipo){ return parteUltimoFinalDe_(await parteHistorial_(c, equipo.codigo), equipo); }
// Para los faltantes de la bandeja: el último final de TODOS los equipos en una sola consulta (índice parte_bandeja_ultimo_idx).
async function parteUltimosFinales_(c){
  return memo_(c, 'ultimos', async function(){
    // D188 (turno noche): entre filas del MISMO día, la que cruza medianoche (hora_a < hora_de) terminó al
    // día siguiente, así que ordena como la más reciente (CASE … DESC antes de hora_a). hora_de viaja en el
    // SELECT para que parteUltimoFinalDe_ recompute lo mismo en JS sobre la fila elegida.
    const filas=await c.sql`SELECT DISTINCT ON (codigo) id_registro, fecha, codigo, final, hora_de, hora_a, "timestamp"
      FROM parte_bandeja WHERE obra_id=${OBRA_ID} AND estado<>'descartado' AND final IS NOT NULL
      ORDER BY codigo, fecha DESC,
        (CASE WHEN hora_a<>'' AND hora_de<>'' AND hora_a<hora_de THEN 1 ELSE 0 END) DESC,
        hora_a DESC, "timestamp" DESC`;
    const porCod={};
    filas.forEach(function(r){ r.fecha=fdate(r.fecha); const k=parteNormCod_(r.codigo); (porCod[k]=porCod[k]||[]).push(r); });
    return porCod;
  });
}

/* ============ GET equipo (PÚBLICO) ============ */
export async function parteEquipo(c, params){
  const eq=parteTexto_(params.eq), mapa=await parteEquipos_(c);
  logIdentidad_(c, eq, 'equipo');
  const lista=await parteSelectorEquipos_(c);
  if(!eq) return json(c, { ok:true, equipo:null, equipos:lista, hoy:parteHoy_() });
  const vig = (await parteEquipoVigente_(c, eq)) || (await parteEquipoVigente_(c, eq, parteFechaMasDias_(parteHoy_(), -1)));
  const q = vig || mapa[parteNormCod_(eq)];
  if(!q) return json(c, { ok:false, error:'El código «'+eq+'» no tiene ficha en PARTE_EQUIPOS. Elige tu equipo en la lista o avisa a maquinaria (un equipo nuevo se da de alta en Maquinaria › Flota).', equipos:lista, hoy:parteHoy_() });
  const hist=await parteHistorial_(c, q.codigo);
  const ultimo=parteUltimoFinalDe_(hist, q);
  return json(c, { ok:true,
    equipo:{ codigo:q.codigo, tipo:q.tipo, placa:q.placa, proveedor:q.proveedor, medidor:q.medidor, activo:q.activo,
             en_flota: !!vig },
    ultimo:ultimo, operadores:await parteOperadores_(c), cc:await parteCC_(c), sugerencias:await parteSugerencias_(c, q.tipo),
    actividades:await parteActividades_(c, q, hist),
    topes:PARTE_TOPES, hoy:parteHoy_() });
}

/* ---------- reparto por porcentaje (copiado tal cual) ---------- */
function parteMinAHora_(m){ m=Math.round(m); return ('0'+Math.floor(m/60)%24).slice(-2)+':'+('0'+(m%60)).slice(-2); }
export function parteExpandirReparto_(c, tramos){
  const out=[];
  for(let i=0;i<tramos.length;i++){
    const t=tramos[i]||{};
    const rep=Array.isArray(t.reparto) ? t.reparto.filter(function(r){ return r && (parteTexto_(r.centro_coste) || parteNum_(r.pct)!==null); }) : [];
    if(rep.length<2){ out.push(t); continue; }
    const n=i+1;
    let suma=0;
    for(let j=0;j<rep.length;j++){
      const pct=parteNum_(rep[j].pct);
      rep[j].centro_coste=parteNormCC_(c, rep[j].centro_coste);
      if(!rep[j].centro_coste) return { error:'Tramo '+n+': el reparto tiene un centro de coste vacío. No se guardó nada.' };
      if(pct===null || pct<=0) return { error:'Tramo '+n+': cada centro de coste del reparto necesita un porcentaje mayor que 0. No se guardó nada.' };
      suma+=pct;
    }
    if(Math.abs(suma-100)>0.5) return { error:'Tramo '+n+': los porcentajes del reparto suman '+parteRedondea_(suma)+' % y deben sumar 100 %. No se guardó nada.' };
    const ini=parteNum_(t.inicial), fin=parteNum_(t.final);
    const total=(ini!==null && fin!==null) ? fin-ini : null;
    const mDe=parteHoraMin_(t.hora_de); let mA=parteHoraMin_(t.hora_a);
    if(mA>=0 && mDe>=0 && mA<mDe) mA+=1440;   // D188: turno que cruza medianoche, el fin es del día siguiente
    const conHoras=(mDe>=0 && mA>=0 && mA>mDe);
    let acum=0, iniAct=ini, minAct=mDe;
    for(let j=0;j<rep.length;j++){
      const r=rep[j], pct=parteNum_(r.pct), ultimo=(j===rep.length-1); acum+=pct;
      const finAct = total===null ? '' : (ultimo ? fin : parteRedondea_(ini+total*acum/100));
      const hDe = conHoras ? parteMinAHora_(minAct) : (j===0 ? t.hora_de : '');
      const hA  = conHoras ? (ultimo ? parteHoraStr_(t.hora_a) : parteMinAHora_(mDe+(mA-mDe)*acum/100)) : (ultimo ? t.hora_a : '');
      const marca='[Reparto '+parteRedondea_(pct)+' % · '+(j+1)+'/'+rep.length+']';
      const sub=Object.assign({}, t, {
        inicial: iniAct===null?'':iniAct, final: finAct, hora_de:hDe, hora_a:hA,
        centro_coste:parteTexto_(r.centro_coste), pr: (r.pr!==undefined && r.pr!=='' && r.pr!==null) ? r.pr : t.pr, uf: parteTexto_(r.uf),
        descripcion_trabajo: parteTexto_(r.descripcion_trabajo) || t.descripcion_trabajo,
        observaciones: (parteTexto_(t.observaciones) ? parteTexto_(t.observaciones)+' · ' : '') + marca,
        id_registro: parteTexto_(t.id_registro) ? parteTexto_(t.id_registro)+'-r'+(j+1) : '',
        inicial_modificado: j===0 ? t.inicial_modificado : 'NO' });
      delete sub.reparto;
      out.push(sub);
      if(finAct!=='') iniAct=finAct;
      if(conHoras) minAct=mDe+(mA-mDe)*acum/100;
    }
  }
  return { tramos:out };
}

/* ============ escritura en parte_bandeja ============
 * `fila` = objeto con las 27 claves de PARTE_BANDEJA_HEADERS ('' donde la hoja tenía vacío; aquí '' en
 * numérico/fecha/timestamp pasa a NULL, regla 3 del esquema). */
function nulo_(v){ return (v===''||v===undefined) ? null : v; }
function numNulo_(v){ const n=parteNum_(v); return n===null ? null : n; }
async function insertarFila_(sql, f, onConflict){
  const r=await sql`INSERT INTO parte_bandeja (obra_id, id_registro, "timestamp", estado, fecha, codigo, tipo, placa, medidor, reporte_num,
      inicial, final, total, inicial_modificado, horas_varada, horas_lluvia, hora_de, hora_a, descripcion_trabajo, centro_coste, pr, uf,
      operador, observaciones, alertas, revisado_por, revisado_ts, origen)
    VALUES (${OBRA_ID}, ${f.id_registro}, ${nulo_(f.timestamp)}, ${f.estado||'pendiente'}, ${f.fecha}, ${f.codigo}, ${f.tipo||''}, ${f.placa||''}, ${f.medidor||''}, ${f.reporte_num||''},
      ${numNulo_(f.inicial)}, ${numNulo_(f.final)}, ${numNulo_(f.total)}, ${f.inicial_modificado||''}, ${numNulo_(f.horas_varada)}, ${numNulo_(f.horas_lluvia)}, ${f.hora_de||''}, ${f.hora_a||''},
      ${f.descripcion_trabajo||''}, ${f.centro_coste||''}, ${numNulo_(f.pr)}, ${f.uf||''}, ${f.operador||''}, ${f.observaciones||''}, ${f.alertas||''},
      ${f.revisado_por||''}, ${nulo_(f.revisado_ts)}, ${f.origen||'qr'})
    ON CONFLICT (obra_id, id_registro) DO NOTHING RETURNING id_registro`;
  return r.length>0;
}
async function actualizarFila_(sql, o){
  await sql`UPDATE parte_bandeja SET estado=${o.estado}, fecha=${o.fecha}, reporte_num=${o.reporte_num||''}, inicial=${numNulo_(o.inicial)}, final=${numNulo_(o.final)},
      total=${numNulo_(o.total)}, horas_varada=${numNulo_(o.horas_varada)}, horas_lluvia=${numNulo_(o.horas_lluvia)}, hora_de=${o.hora_de||''}, hora_a=${o.hora_a||''},
      descripcion_trabajo=${o.descripcion_trabajo||''}, centro_coste=${o.centro_coste||''}, pr=${numNulo_(o.pr)}, uf=${o.uf||''}, operador=${o.operador||''},
      observaciones=${o.observaciones||''}, revisado_por=${o.revisado_por||''}, revisado_ts=${nulo_(o.revisado_ts)}
    WHERE obra_id=${OBRA_ID} AND id_registro=${o.id_registro}`;
}
function filaDesde_(arr){ const o={}; PARTE_BANDEJA_HEADERS.forEach(function(k,i){ o[k]=arr[i]; }); return o; }

/* ============ POST reporte (PÚBLICO) ============ */
export async function parteReporte(c, body, ses){
  const cod=parteTexto_(body.codigo);
  logIdentidad_(c, cod, 'equipo');
  const rlG=rateLimit_('global', 'parte:reporte', PARTE_RL_GLOBAL_HORA, PARTE_RL_VENTANA_S);
  if(!rlG.ok) return respuestaRateLimit_(c, rlG);
  const rlE=rateLimit_('eq:'+(parteNormCod_(cod)||'sin-codigo'), 'parte:reporte', PARTE_RL_EQUIPO_HORA, PARTE_RL_VENTANA_S);
  if(!rlE.ok) return respuestaRateLimit_(c, rlE);
  const vp=parteValidarReporte_(c, body); if(vp) return vp;
  const mapa=await parteEquipos_(c);
  const crudos0=Array.isArray(body.tramos) ? body.tramos : (body.tramo ? [body.tramo] : []);
  const fechaParte=fdateValida_((crudos0[0]&&crudos0[0].fecha)||body.fecha||'') || parteHoy_();
  const vig=await parteEquipoVigente_(c, cod, fechaParte);
  const q = vig || mapa[parteNormCod_(cod)];
  if(!q) return parteRechazoEquipo_(c, cod, 'no tiene ficha en PARTE_EQUIPOS (un equipo nuevo se da de alta en Maquinaria › Flota)');
  const fueraDeFlota = !vig;
  const rechazo=function(msg){ logMarcar_(c, 'rechazado', msg); return json(c, { ok:false, error:msg }); };
  const crudos=Array.isArray(body.tramos) ? body.tramos : (body.tramo ? [body.tramo] : []);
  if(!crudos.length) return rechazo('El parte llegó sin tramos. No se guardó nada.');
  await precargar_(c);
  const exp=parteExpandirReparto_(c, crudos);
  if(exp.error) return rechazo(exp.error);
  const tramos=exp.tramos;
  const revisor = !!(ses && ses.ok && parteAutoriza_(ses));
  const origen = (parteTexto_(body.origen).toLowerCase()==='manual' && revisor) ? 'manual' : 'qr';
  if(origen==='manual'){ logIdentidad_(c, ses.usuario, ses.rol); logMarcar_(c, 'ok', 'origen manual · equipo '+q.codigo); }
  const hoy=parteHoy_();
  const ccValidos={}; (await parteCC_(c)).forEach(function(x){ ccValidos[normTexto(x.centro_coste)]=x; });
  const tope=PARTE_TOPES[q.medidor] || null;

  const hist=await parteHistorial_(c, q.codigo);
  const ultimo=parteUltimoFinalDe_(hist, q);
  const idsEx={}; hist.forEach(function(r){ const id=parteTexto_(r.id_registro); if(id) idsEx[id]=1; });
  const ccRecientes={}; let hayHistorialCC=false;
  // D188 (turno noche): nº de parte físico → días en que ya está registrado (no descartado). Si el mismo
  // parte llega con OTRA fecha es casi seguro el mismo turno subido dos veces (el riesgo del turno que cruza
  // medianoche); se marca PARTE_REPETIDO para que revisión lo mire y no se facture dos veces. Un reenvío de
  // la cola offline (mismo id_registro y misma fecha) no dispara nada: idsEx lo deduplica y la fecha coincide.
  const reportesPrevios={};
  hist.forEach(function(r){
    if(parteEstadoDe_(r)==='descartado' || !r.fecha) return;
    const cc=normTexto(r.centro_coste);
    if(cc && !parteEsPseudoCC_(cc)){
      hayHistorialCC=true;
      if(r.fecha>=parteFechaMasDias_(hoy, -PARTE_DIAS_CC_RECIENTE)) ccRecientes[cc]=1;
    }
    const rn=parteTexto_(r.reporte_num);
    if(rn) (reportesPrevios[rn]=reportesPrevios[rn]||{})[r.fecha]=1;
  });

  const ts=new Date();
  const filas=[], salida=[]; let duplicadas=0;
  let finalPrevio = ultimo ? ultimo.final : null;
  for(let i=0;i<tramos.length;i++){
    const t=tramos[i]||{}, n=i+1;
    const fecha=fdateValida_(t.fecha);
    if(!fecha) return rechazo('Tramo '+n+': la fecha llegó vacía o no se entiende. No se guardó nada.');
    if(fecha>hoy) return rechazo('Tramo '+n+': la fecha no puede ser futura. No se guardó nada.');
    const reporte=parteTexto_(t.reporte_num), operador=parteOperadorCanon_(t.operador), cc=parteNormCC_(c, t.centro_coste);
    if(!reporte && !(origen==='manual' && parteEsPseudoCC_(cc))) return rechazo('Tramo '+n+': falta el número del parte físico. No se guardó nada.');
    if(!operador) return rechazo('Tramo '+n+': falta el operador. No se guardó nada.');
    const sinCC = !cc;
    if(sinCC && !parteTexto_(t.descripcion_trabajo)) return rechazo('Tramo '+n+': falta el centro de coste o, si la actividad no está en la lista, escribe qué hizo la máquina. No se guardó nada.');
    const ini=parteNum_(t.inicial), fin=parteNum_(t.final);
    const sinMedidor = !q.medidor;
    if(!sinMedidor && (ini===null || fin===null)) return rechazo('Tramo '+n+': faltan el medidor inicial o final. No se guardó nada.');
    let total='';
    if(ini!==null && fin!==null){
      if(fin<ini) return rechazo('Tramo '+n+': el medidor final ('+fin+') es menor que el inicial ('+ini+'). No se guardó nada.');
      total=parteRedondea_(fin-ini);
      if(tope && total>tope.bloquea) return rechazo('Tramo '+n+': el total ('+total+' '+tope.unidad+') supera el máximo de '+tope.bloquea+' '+tope.unidad+' en un día. Revisa el medidor. No se guardó nada.');
    }
    const hDe=parteHoraStr_(t.hora_de), hA=parteHoraStr_(t.hora_a);
    const uf = parteTexto_(t.uf) || parteUF_(cc);
    const alertas=[];
    if(ini!==null && finalPrevio!==null && finalPrevio!==undefined && Math.abs(ini-finalPrevio)>0.001) alertas.push('INICIAL_DISTINTO');
    if(tope && total!=='' && total>tope.alerta) alertas.push('TOTAL_ALTO');
    const dup = !!hDe && (hist.some(function(r){ return parteEstadoDe_(r)!=='descartado' && r.fecha===fecha && parteHoraStr_(r.hora_de)===hDe; })
             || filas.some(function(f){ return f[3]===fecha && parteHoraStr_(f[15])===hDe; }));
    if(dup) alertas.push('DUPLICADO');
    // Mismo nº de parte físico ya subido en OTRO día (D188): posible doble carga del mismo turno noche.
    if(reporte && reportesPrevios[reporte] && !reportesPrevios[reporte][fecha]) alertas.push('PARTE_REPETIDO');
    if(sinCC) alertas.push('SIN_CC');
    else if(!parteEsPseudoCC_(cc) && hayHistorialCC && !ccRecientes[normTexto(cc)]) alertas.push('CC_INUSUAL');
    if(sinMedidor) alertas.push('SIN_MEDIDOR');
    if(!sinCC && !ccValidos[normTexto(cc)]) alertas.push('CC_DESCONOCIDO');
    if(fueraDeFlota) alertas.push('FUERA_DE_FLOTA');

    const id = parteTexto_(t.id_registro) || crypto.randomUUID();
    if(idsEx[id]){ duplicadas++; salida.push({ id_registro:id, duplicada:true }); continue; }
    const iniMod = parteSiNo_(t.inicial_modificado, false) ? 'SI' : 'NO';
    filas.push([ id, ts, 'pendiente', fecha, q.codigo, q.tipo, q.placa, q.medidor,
      reporte, ini===null?'':ini, fin===null?'':fin, total, iniMod,
      parteNum_(t.horas_varada)===null?'':parteNum_(t.horas_varada), parteNum_(t.horas_lluvia)===null?'':parteNum_(t.horas_lluvia),
      hDe, hA, parteTexto_(t.descripcion_trabajo), cc, parteNum_(t.pr)===null?'':parteNum_(t.pr), uf, operador,
      parteTexto_(t.observaciones), alertas.join(';'), '', '', origen ]);
    salida.push({ id_registro:id, fecha:fecha, total:total, uf:uf, alertas:alertas });
    if(fin!==null) finalPrevio=fin;
  }
  let guardadas=0;
  if(filas.length){
    // UNA transacción; ON CONFLICT DO NOTHING = el reenvío que llegó en paralelo cuenta como duplicada (D82).
    await c.sql.begin(async function(sql){
      for(const f of filas){
        const ok=await insertarFila_(sql, filaDesde_(f));
        if(ok) guardadas++;
        else { duplicadas++; const s=salida.find(function(x){ return x.id_registro===f[0]; }); if(s){ Object.keys(s).forEach(function(k){ delete s[k]; }); s.id_registro=f[0]; s.duplicada=true; } }
      }
    });
  }
  return json(c, { ok:true, guardadas:guardadas, duplicadas:duplicadas, filas:salida, equipo:{ codigo:q.codigo, tipo:q.tipo, placa:q.placa, medidor:q.medidor } });
}

/* ============ revisión (TOKEN) ============ */
function parteAutoriza_(ses){
  if(!ses || !ses.ok) return false;
  if(ses.tolerado) return true;
  if(PARTE_USUARIOS_REVISAN.indexOf(String(ses.usuario||'').trim().toLowerCase())>=0) return true;
  return PARTE_ROLES_REVISAN.indexOf(String(ses.rol||'').trim().toLowerCase())>=0;
}
function parteSinPermiso_(c){ logMarcar_(c, 'rechazado','rol sin permiso de revisión'); return json(c, { ok:false, error:'Tu usuario no revisa partes de maquinaria (roles: '+PARTE_ROLES_REVISAN.join(', ')+'; usuarios: '+PARTE_USUARIOS_REVISAN.join(', ')+').' }); }

export async function parteBandeja(c, params){
  const fecha=fdateValida_(params.fecha||'') || parteHoy_();
  await precargar_(c);
  const crudas=await c.sql`SELECT * FROM parte_bandeja WHERE obra_id=${OBRA_ID} AND fecha=${fecha}`;
  const filas=crudas.map(function(r){ return parteFilaSalida_(c, r); });
  const pendientes=[], revisadas=[], conParte={};
  filas.forEach(function(r){
    const est=r.estado.toLowerCase()||'pendiente';
    if(est!=='descartado') conParte[parteNormCod_(r.codigo)]=1;
    (est==='pendiente' ? pendientes : revisadas).push(r);
  });
  const ordena=function(a,b){ return (a.codigo+a.hora_de)<(b.codigo+b.hora_de)?-1:1; };
  pendientes.sort(ordena); revisadas.sort(ordena);
  const vigentes=await parteEquiposActivos_(c, fecha);
  const ultimos=await parteUltimosFinales_(c);
  const faltantes=vigentes.filter(function(q){ return !conParte[parteNormCod_(q.codigo)]; })
    .map(function(q){ return { codigo:q.codigo, tipo:q.tipo, placa:q.placa, medidor:q.medidor, grupo:q.grupo||'tierras', ultimo:parteUltimoFinalDe_(ultimos[parteNormCod_(q.codigo)], q), sin_ficha:!!q.sin_ficha }; });
  return json(c, { ok:true, fecha:fecha, pendientes:pendientes, revisadas:revisadas, faltantes:faltantes,
    flota_fuente: (await parteFlotaVigente_(c, fecha)) ? 'hoja' : 'activo',
    listas:{ operadores:await parteOperadores_(c), cc:await parteCC_(c), equipos:vigentes.map(function(q){ return { codigo:q.codigo, tipo:q.tipo, placa:q.placa, medidor:q.medidor, grupo:q.grupo||'tierras' }; }) },
    topes:PARTE_TOPES });
}

const PARTE_CAMPOS_EDITABLES = ['fecha','reporte_num','inicial','final','horas_varada','horas_lluvia','hora_de','hora_a',
  'descripcion_trabajo','centro_coste','pr','uf','operador','observaciones'];
export async function parteRevisar(c, body, ses){
  const soloBase=!parteAutoriza_(ses) && parteLeeBase_(ses);    // D198: el jefe corrige campos de filas YA aprobadas
  if(!parteAutoriza_(ses) && !soloBase) return parteSinPermiso_(c);
  const vp=parteValidarRevisar_(c, body); if(vp) return vp;
  const cambios=Array.isArray(body.cambios) ? body.cambios : [];
  if(!cambios.length) return json(c, { ok:false, error:'No llegó ningún cambio.' });
  await precargar_(c);
  const quien=String((ses&&ses.usuario)||body.usuario||''), ts=new Date();
  const hechos=[], errores=[];
  // Escritura QUIRÚRGICA: una transacción; cada fila se bloquea (FOR UPDATE), se mezcla y se reescribe.
  await c.sql.begin(async function(sql){
    for(const x of cambios){
      const id=parteTexto_(x.id_registro);
      const enc=await sql`SELECT * FROM parte_bandeja WHERE obra_id=${OBRA_ID} AND id_registro=${id} FOR UPDATE`;
      if(!enc.length){ errores.push({ id_registro:id, error:'no existe' }); continue; }
      const obj=enc[0]; obj.fecha=fdate(obj.fecha);
      if(soloBase && parteEstadoDe_(obj)!=='aprobado'){ errores.push({ id_registro:id, error:'solo se corrigen filas aprobadas de la Base' }); continue; }
      if(soloBase && parteTexto_(x.estado)){ errores.push({ id_registro:id, error:'aprobar o descartar lo hace quien revisa los partes' }); continue; }
      const campos=x.campos||{}; let tocado=false, malo='';
      PARTE_CAMPOS_EDITABLES.forEach(function(k){
        if(malo || !Object.prototype.hasOwnProperty.call(campos, k)) return;
        let val=campos[k];
        if(k==='fecha'){ val=fdateValida_(val); if(!val){ malo='fecha inválida'; return; } }
        else if(k==='hora_de'||k==='hora_a') val=parteHoraStr_(val);
        else if(k==='inicial'||k==='final'||k==='horas_varada'||k==='horas_lluvia'||k==='pr'){ const n=parteNum_(val); val= n===null ? '' : n; }
        else if(k==='centro_coste') val=parteNormCC_(c, val);
        else if(k==='operador') val=parteOperadorCanon_(val);
        else val=parteTexto_(val);
        obj[k]=val; tocado=true;
      });
      if(malo){ errores.push({ id_registro:id, error:malo }); continue; }
      if(Object.prototype.hasOwnProperty.call(campos,'inicial') || Object.prototype.hasOwnProperty.call(campos,'final')){
        const ini=parteNum_(obj.inicial), fin=parteNum_(obj.final);
        if(ini!==null && fin!==null){
          if(fin<ini){ errores.push({ id_registro:id, error:'final menor que inicial' }); continue; }
          obj.total=parteRedondea_(fin-ini);
        } else obj.total='';
      }
      if(Object.prototype.hasOwnProperty.call(campos,'centro_coste') && !Object.prototype.hasOwnProperty.call(campos,'uf')) obj.uf=parteUF_(obj.centro_coste);
      const est=parteTexto_(x.estado).toLowerCase();
      if(est){
        if(PARTE_ESTADOS.indexOf(est)<0){ errores.push({ id_registro:id, error:'estado desconocido' }); continue; }
        if(est==='aprobado' && !parteTexto_(obj.centro_coste)){ errores.push({ id_registro:id, error:obj.codigo+': sin centro de coste; ponlo antes de aprobar' }); continue; }
        obj.estado=est; tocado=true;
      }
      if(!tocado){ errores.push({ id_registro:id, error:'sin cambios' }); continue; }
      obj.revisado_por=quien; obj.revisado_ts=ts;
      await actualizarFila_(sql, obj);
      hechos.push(parteFilaSalida_(c, obj));
    }
  });
  return json(c, { ok:true, cambiadas:hechos.length, filas:hechos, errores:errores });
}

/* ============ D178 — repartir una fila desde revisión (TOKEN) ============ */
export async function parteRepartir(c, body, ses){
  if(!parteAutoriza_(ses)) return parteSinPermiso_(c);
  const vp=parteValidarRepartir_(c, body); if(vp) return vp;
  const id=parteTexto_(body.id_registro);
  const rep=(Array.isArray(body.reparto)?body.reparto:[]).filter(function(r){ return r && (parteTexto_(r.centro_coste) || parteNum_(r.pct)!==null || parteTexto_(r.descripcion_trabajo)); });
  if(rep.length<2) return json(c, { ok:false, error:'Un reparto necesita al menos dos centros de coste.' });
  await precargar_(c);
  const ccValidos={}; (await parteCC_(c)).forEach(function(x){ ccValidos[normTexto(x.centro_coste)]=1; });
  const quien=String((ses&&ses.usuario)||''), ts=new Date();
  let respuesta=null;
  await c.sql.begin(async function(sql){
    const enc=await sql`SELECT * FROM parte_bandeja WHERE obra_id=${OBRA_ID} AND id_registro=${id} FOR UPDATE`;
    if(!enc.length){ respuesta={ ok:false, error:'La fila «'+id+'» no existe.' }; return; }
    const obj=enc[0]; obj.fecha=fdate(obj.fecha);
    if(parteEstadoDe_(obj)==='descartado'){ respuesta={ ok:false, error:'La fila ya está descartada; reábrela antes de repartirla.' }; return; }
    const t={ id_registro:id, fecha:fdate(obj.fecha), reporte_num:parteTexto_(obj.reporte_num), operador:parteTexto_(obj.operador),
      inicial:parteNum_(obj.inicial), final:parteNum_(obj.final), hora_de:parteHoraStr_(obj.hora_de), hora_a:parteHoraStr_(obj.hora_a),
      centro_coste:parteNormCC_(c, obj.centro_coste), pr:parteNum_(obj.pr), uf:parteTexto_(obj.uf), descripcion_trabajo:parteTexto_(obj.descripcion_trabajo),
      horas_varada:parteNum_(obj.horas_varada), horas_lluvia:parteNum_(obj.horas_lluvia), observaciones:parteTexto_(obj.observaciones),
      inicial_modificado:parteTexto_(obj.inicial_modificado)||'NO',
      reparto:rep.map(function(r){ return { centro_coste:r.centro_coste, pct:r.pct, pr:r.pr, uf:r.uf, descripcion_trabajo:r.descripcion_trabajo }; }) };
    if(t.inicial===null) t.inicial=''; if(t.final===null) t.final='';
    const exp=parteExpandirReparto_(c, [t]);
    if(exp.error){ respuesta={ ok:false, error:exp.error.replace(/^Tramo 1: /,'') }; return; }
    // ids ya usados con este prefijo (<id>-r…): si existen, se les añade sufijo, como en el .gs
    const usados=await sql`SELECT id_registro FROM parte_bandeja WHERE obra_id=${OBRA_ID} AND id_registro LIKE ${id+'-r%'}`;
    const idsEx={}; usados.forEach(function(r){ idsEx[r.id_registro]=1; });
    const alertasBase=String(obj.alertas||'').split(';').map(function(s){ return s.trim(); }).filter(function(a){ return a && a!=='SIN_CC' && a!=='CC_DESCONOCIDO'; });
    const filas=[], salida=[];
    exp.tramos.forEach(function(s,j){
      let nid=s.id_registro||(id+'-r'+(j+1)); let k=2; while(idsEx[nid]){ nid=id+'-r'+(j+1)+'-'+(k++); } idsEx[nid]=1;
      const cc=parteNormCC_(c, s.centro_coste), al=alertasBase.slice();
      if(!cc) al.push('SIN_CC'); else if(!ccValidos[normTexto(cc)] && !parteEsPseudoCC_(cc)) al.push('CC_DESCONOCIDO');
      const ini=parteNum_(s.inicial), fin=parteNum_(s.final), total=(ini!==null&&fin!==null)?parteRedondea_(fin-ini):'';
      const uf=parteTexto_(s.uf)||parteUF_(cc);
      filas.push([ nid, ts, 'pendiente', t.fecha, parteTexto_(obj.codigo), parteTexto_(obj.tipo), parteTexto_(obj.placa), parteTexto_(obj.medidor),
        t.reporte_num, ini===null?'':ini, fin===null?'':fin, total, j===0?t.inicial_modificado:'NO',
        t.horas_varada===null?'':t.horas_varada, t.horas_lluvia===null?'':t.horas_lluvia,
        parteHoraStr_(s.hora_de), parteHoraStr_(s.hora_a), parteTexto_(s.descripcion_trabajo), cc, parteNum_(s.pr)===null?'':parteNum_(s.pr), uf, t.operador,
        parteTexto_(s.observaciones), al.join(';'), quien, ts, parteTexto_(obj.origen)||'manual' ]);
    });
    // 1) la original queda descartada con la marca; 2) las nuevas
    obj.estado='descartado'; obj.observaciones=(parteTexto_(obj.observaciones)?parteTexto_(obj.observaciones)+' · ':'')+'[Repartido en '+filas.length+' filas]';
    obj.revisado_por=quien; obj.revisado_ts=ts;
    await actualizarFila_(sql, obj);
    for(const f of filas){ const o=filaDesde_(f); await insertarFila_(sql, o); salida.push(parteFilaSalida_(c, o)); }
    respuesta={ ok:true, original:parteFilaSalida_(c, obj), filas:salida, cambiadas:1+salida.length };
  });
  return json(c, respuesta);
}

/* ============ Base (TOKEN) ============ */
function parteExcelFila_(r){
  const cols=parteExcelColumnas_(), esH = r.medidor==='HOROMETRO', esKm = r.medidor==='KM';
  const val=function(campo){
    switch(campo){
      case 'inicial_h':  return esH  ? r.inicial : '';
      case 'final_h':    return esH  ? r.final   : '';
      case 'inicial_km': return esKm ? r.inicial : '';
      case 'final_km':   return esKm ? r.final   : '';
      default: return r[campo]===undefined ? '' : r[campo];
    }
  };
  return cols.map(function(L){ return PARTE_EXCEL_MAPA[L] ? val(PARTE_EXCEL_MAPA[L]) : ''; });
}
export async function parteBase(c, params){
  const desde=fdateValida_(params.desde||''), hasta=fdateValida_(params.hasta||'') || desde;
  if(!desde) return json(c, { ok:false, error:'Falta la fecha «desde» (yyyy-mm-dd).' });
  if(hasta<desde) return json(c, { ok:false, error:'«hasta» es anterior a «desde».' });
  if(toDate(hasta)-toDate(desde) > PARTE_MAX_DIAS_BASE*86400000) return json(c, { ok:false, error:'El rango no puede pasar de '+PARTE_MAX_DIAS_BASE+' días.' });
  const estado=parteTexto_(params.estado).toLowerCase() || 'aprobado';
  await precargar_(c);
  const crudas = estado==='todos'
    ? await c.sql`SELECT * FROM parte_bandeja WHERE obra_id=${OBRA_ID} AND fecha BETWEEN ${desde} AND ${hasta}`
    : await c.sql`SELECT * FROM parte_bandeja WHERE obra_id=${OBRA_ID} AND fecha BETWEEN ${desde} AND ${hasta} AND lower(estado)=${estado}`;
  const filas=crudas.map(function(r){ return parteFilaSalida_(c, r); })
    .sort(function(a,b){ const ka=a.fecha+'|'+a.codigo+'|'+a.hora_de, kb=b.fecha+'|'+b.codigo+'|'+b.hora_de; return ka<kb?-1:ka>kb?1:0; });
  return json(c, { ok:true, desde:desde, hasta:hasta, estado:estado, filas:filas,
    excel:{ primera:PARTE_EXCEL_PRIMERA, ultima:PARTE_EXCEL_ULTIMA, columnas:parteExcelColumnas_(), mapa:PARTE_EXCEL_MAPA, filas:filas.map(parteExcelFila_) },
    listas:{ operadores:await parteOperadores_(c), cc:await parteCC_(c),
      // D198: equipos con su grupo (D190), vigentes a «hasta», para el filtro Todos/Tierras/Drenajes sin la bandeja
      equipos:(await parteEquiposActivos_(c, hasta)).map(function(q){ return { codigo:q.codigo, tipo:q.tipo, medidor:q.medidor, grupo:q.grupo||'tierras' }; }) } });
}

/* ============ enrutado (lo llama src/index.js; misma lógica que doGet/doPost + parteDoGet_/parteDoPost_) ============ */
export async function parteDoGet_(c, params){
  const op=String(params.op||'').toLowerCase();
  if(op==='equipo') return parteEquipo(c, params);
  const p=await puerta_(c, params.token||'', 'parte:'+op);
  if(!p.ok) return p.respuesta;
  const ses=p.ses;
  if(op==='base' && !parteAutoriza_(ses) && parteLeeBase_(ses)) return parteBase(c, params);   // D198: el jefe lee la Base
  if(!parteAutoriza_(ses)) return parteSinPermiso_(c);
  if(op==='bandeja') return parteBandeja(c, params);
  if(op==='base')    return parteBase(c, params);
  return json(c, { ok:false, error:'op desconocida: '+op });
}
export async function parteDoPost_(c, body){
  const op=String(body.op||'').toLowerCase();
  if(op==='reporte'){
    let ses=null;
    if(body.token){ ses=await sesion_(c, body.token); if(ses.ok && ses.usuario) body.usuario=ses.usuario; }
    return parteReporte(c, body, ses);
  }
  const p=await puerta_(c, body.token||'', 'parte:'+op);
  if(!p.ok) return p.respuesta;
  const ses=p.ses;
  if(ses.usuario) body.usuario=ses.usuario;
  if(op==='revisar')  return parteRevisar(c, body, ses);
  if(op==='repartir') return parteRepartir(c, body, ses);
  return json(c, { ok:false, error:'op desconocida: '+op });
}
