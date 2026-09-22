/**
 * CodigoParte.gs — Parte Digital de Maquinaria (V3-01 / D165)
 *
 * Módulo NUEVO que reemplaza al digitador de partes de maquinaria: el operador transcribe el parte
 * físico desde la cabina (parte.html, sin login: la identidad la da el CÓDIGO DEL EQUIPO que viene
 * en la URL del QR), la fila nace `pendiente` en la hoja PARTE_BANDEJA y una persona con login la
 * revisa, corrige y aprueba en revision-maquinaria.html. Lo aprobado se exporta por copy-paste a la
 * hoja BASE MAQUINARIA del Excel `Partes_Diarios_de_Maquinaria_<periodo>.xlsx`.
 *
 * Vive en el MISMO proyecto de Apps Script que Codigo.gs (misma URL de despliegue) y reutiliza sus
 * helpers: json, leerRango_, fdate, fdateValida_, ss_, getSheet, readSheet, readSheetPorFecha_,
 * invalidarHoja_, ensureRows_, sesion_, normTexto, _memoRango. NO toca BANDEJA, DATA, MAQUINARIA
 * ni ninguna hoja del flujo existente: hojas propias (prefijo PARTE_) y endpoints propios.
 *
 * Enrutado (el diff en Codigo.gs son dos líneas, una en doGet y otra en doPost):
 *   GET  ?mod=parte&op=equipo&eq=CODIGO         PÚBLICO  → datos del equipo + último final + listas
 *   POST {mod:'parte', op:'reporte', ...}        PÚBLICO  → inserta 1..n filas `pendiente` con alertas
 *        (un tramo con `reparto:[{centro_coste,pct}]` se abre en una fila por CC, medidor y horas prorrateados)
 *   GET  ?mod=parte&op=bandeja&fecha=            TOKEN    → pendientes + revisadas + faltantes del día
 *   POST {mod:'parte', op:'revisar', cambios:[]} TOKEN    → cambia estado / edita campos (por id_registro)
 *   POST {mod:'parte', op:'repartir', id_registro, reparto:[]} TOKEN → D178: abre una fila en N (una por CC),
 *        la original queda `descartado` con la marca [Repartido en N filas]
 *   GET  ?mod=parte&op=base&desde=&hasta=        TOKEN    → aprobados del rango + filas en orden Excel
 *
 * D178 (sep-2026): ítems/CC que Sheets convirtió a número se normalizan («02.10», no 2.1); 5 actividades
 *   habituales como máximo; alias de operadores (PARTE_OPERADORES_ALIAS) al leer y al recibir; `jeisson`
 *   revisa (PARTE_USUARIOS_REVISAN); op=repartir; depurarOperadoresParte() para ordenar la hoja.
 *
 * Los dos públicos se despachan ANTES de la puerta de sesión de D109 (como `tablero`, D161): el
 * operador no tiene usuario. Lo público solo puede CREAR filas `pendiente` (nunca edita, borra ni
 * aprueba) y solo LEE catálogos (equipo, operadores, CC, sugerencias): nada de personas ni claves.
 *
 * Invariantes heredadas: fechas por duck-typing (fdate), nunca instanceof Date; POST text/plain;
 * toda escritura pasa por ensureRows_ (D93); toda lectura por leerRango_ (D107, `_celdas`).
 *
 * D166 — endurecimiento del módulo (reutiliza el bloque «ENDURECIMIENTO DEL BACKEND» de Codigo.gs):
 *   · LOG: en las operaciones públicas la identidad es el CÓDIGO DE EQUIPO (rol `equipo`); en las de
 *     revisión, el usuario del token. Una fila por petición, la escribe doGet/doPost de Codigo.gs.
 *   · Rate limit del envío público (`op=reporte`): 20 envíos/hora por equipo y 200/hora global, ambos
 *     con CacheService; al excederlo {ok:false, error:'rate_limit'} sin tocar el Sheet. Las operaciones
 *     con token pasan por `puerta_` (60/min por usuario+action).
 *   · Validación estricta: el código debe tener FICHA en PARTE_EQUIPOS — si no, {ok:false, error:'equipo'}.
 *     La vigencia en la flota (hoja MAQUINAS, D173) NO bloquea: solo añade la alerta FUERA_DE_FLOTA
 *     (D173b: un reemplazo de un día no pasa por la Flota). Tipos, rangos y
 *     longitudes de cada tramo y de cada cambio de revisión: {ok:false, error:'payload', campo}.
 *   · Respaldo: el Parte vive en el MISMO Sheet que la obra, así que `respaldoDiario()` ya lo cubre;
 *     si algún día se separa, basta fijar la propiedad del script `PARTE_SHEET_ID` y `respaldoIdsExtra_`
 *     lo añade a la misma corrida (misma carpeta, prefijo `Parte_TM2`).
 *   · Sin token y sin cambios en el flujo del operador que escanea el QR: mismos campos, misma URL.
 */

/* ---------- hojas ---------- */
// Encabezados = columnas de los CSV semilla (backend/seeds/parte/) para que "Archivo → Importar →
// Reemplazar hoja actual" deje la hoja lista sin reordenar nada. Las columnas que el módulo necesita
// y el CSV no trae (`activo`, `ultimo_final_manual`) van al final y se leen POR NOMBRE con valor por
// defecto (vacío = activo; `ultimo_final` del CSV hace de `ultimo_final_manual`). Se leen por nombre
// igual que CUBICAJE/VOLQUETAS (D100): el usuario mantiene estas hojas a mano.
const PARTE_EQUIPOS_HEADERS     = ['codigo','tipo','placa','proveedor','medidor','ultima_fecha','ultimo_final','activo','ultimo_final_manual'];
const PARTE_OPERADORES_HEADERS  = ['operador','partes_ult_4_meses','activo'];
const PARTE_CC_HEADERS          = ['centro_coste','proyecto','descripcion_cc','usos_ult_4_meses','activo'];
const PARTE_ACTIVIDADES_HEADERS = ['tipo_equipo','descripcion_trabajo','veces'];
// D174: tabla actividad → ítem por tipo de equipo (la «máscara» del operador). `actividad` = la frase
// con que ELLOS la escriben en DESCRIPCIÓN DEL TRABAJO del parte («Compactando terraplen», «Cargue de
// volquetas», «Cereo sub base»); puede haber varias frases para el mismo ítem. Vacía → se completa con
// la descripción del ítem de la BASE (el «nombre científico», que además se muestra bajo la frase).
// Dueño: Jeisson (quien asigna los CC). Semilla: PARTE_ITEMS_semilla.csv (BASE MAQUINARIA UF1-UF2, 6 meses).
const PARTE_ITEMS_HEADERS = ['tipo_equipo','item','actividad','veces','activo'];
// PARTE_BANDEJA: esquema FIJO del código (como BANDEJA). Nunca se borra una fila: el estado cambia.
const PARTE_BANDEJA_HEADERS = ['id_registro','timestamp','estado','fecha','codigo','tipo','placa','medidor',
  'reporte_num','inicial','final','total','inicial_modificado','horas_varada','horas_lluvia','hora_de','hora_a',
  'descripcion_trabajo','centro_coste','pr','uf','operador','observaciones','alertas','revisado_por','revisado_ts','origen'];

// Pseudo-centros de coste de uso real en el parte (días sin operación). Viven en el código para que
// el formulario los ofrezca SIEMPRE, aunque la hoja PARTE_CC se reimporte; setupParte() los deja
// además escritos en la hoja para que se vean.
const PARTE_CC_PSEUDO = [
  { centro_coste:'Taller',          proyecto:'', descripcion_cc:'Taller / mantenimiento / equipo varado', pseudo:true },
  { centro_coste:'Disponible',      proyecto:'', descripcion_cc:'Disponible (sin frente, lluvia, sin operador)', pseudo:true },
  { centro_coste:'Domingo/Festivo', proyecto:'', descripcion_cc:'Domingo o festivo', pseudo:true }
];

/* ---------- reglas ---------- */
// Quién revisa: los roles con login que ya existen (encargado, admin, residente) y el rol nuevo
// `parte_maquinaria` para la persona dedicada al parte (alta = fila en USUARIOS con
// redirige=revision-maquinaria.html, D108; cero código). El jefe NO: solo lectura en obra.
// D193: el residente de drenajes también revisa (con el filtro Tierras/Drenajes de la pantalla).
const PARTE_ROLES_REVISAN = ['admin','encargado','residente','parte_maquinaria','residente_dren'];
// D178: `jeisson` (rol `asistencia_plus`, quien pone el CC a los partes en papel, D174) también revisa,
// por USUARIO y no por rol —mismo patrón que FLOTA_USUARIOS_ESCRIBEN (D139)—: no se amplía el rol de
// asistencias, se le abre la puerta a él.
// D193: duvan (asistencias de drenajes; lo usa Stiven) también revisa — enmienda D178, que lo dejaba fuera.
const PARTE_USUARIOS_REVISAN = ['jeisson','duvan'];
// D178: chips de actividades habituales que ve el operador (pedido del residente: las 5 más usadas y,
// si no está, texto libre que corrige revisión). El backend recorta aquí; el formulario no muestra más.
const PARTE_MAX_HABITUALES = 5;
// D178: alias de operadores — variantes de escritura que son la MISMA persona (depurado de
// PARTE_OPERADORES_semilla.csv, sep-2026). Se aplican al LEER la lista (la variante no se ofrece) y al
// RECIBIR un parte (se guarda el nombre canónico). `depurarOperadoresParte(true)` los aplica además a la
// hoja. Dueño: el usuario; una variante nueva = una línea aquí (o `activo=NO` en la hoja).
const PARTE_OPERADORES_ALIAS = {
  'ALEYXER RINCON':'Aleyxer Rincon',            // Aleyxer Rincón (tilde)
  'EDUARD ACEVEDO':'Eduar Acevedo', 'EDWAR ACEVEDO':'Eduar Acevedo',
  'EDWIN FERNENDEZ':'Edwin Fernandez',
  'WILMAR PAWANA':'Wilmar Pahuana', 'WILMER PAHUANA':'Wilmar Pahuana',
  'YERSON SANDOVAL':'Yerson Sandobal',          // 91 usos Sandobal vs 16 Sandoval: manda el más usado
  'ALEX GUERRERO':'Jhon Alex Guerrero',
  'MIGUEL GOMEZ':'Miguel Angel Gomez',
  'NELSON TORRES':'Nelson Gabriel Torres', 'GABRIEL TORRES':'Nelson Gabriel Torres',
  'JUAN DAVID DE ANGEL BARRIOS':'Juan David De Angel',
  'SERGIO ANDRES ARENAS':'Sergio Arenas',
  'A. GUTIERREZ':'Alizon Gutierrez',
  'JAN CARLOS':'Jean Carlos Muñoz'
};
function parteOperadorCanon_(n){ const s=parteTexto_(n); if(!s) return ''; const c=PARTE_OPERADORES_ALIAS[normTexto(s)]; return c || s; }
// D173: frentes cuyos equipos espera ESTE parte. Hoy solo UF1-UF2 (el proyecto que atiende el
// sistema); cuando la UF3 entre al ecosistema (backlog) basta añadir 'UF3' aquí — sus estancias ya
// caben en la hoja MAQUINAS con `frente=UF3`.
const PARTE_FRENTES = ['UF1-UF2'];
// Topes por medidor: `bloquea` rechaza el envío (también lo bloquea el cliente); `alerta` marca
// TOTAL_ALTO para que lo mire quien revisa.
const PARTE_TOPES = { HOROMETRO:{ bloquea:24, alerta:12, unidad:'h' }, KM:{ bloquea:700, alerta:400, unidad:'km' } };
const PARTE_DIAS_CC_RECIENTE = 30;    // ventana del historial para CC_INUSUAL
const PARTE_MAX_DIAS_BASE   = 186;    // tope del rango de la vista Base (mismo que ausencias/persona)
const PARTE_ESTADOS = ['pendiente','aprobado','descartado'];
// D166 — rate limit del envío público (identidad = código de equipo; no hay usuario)
const PARTE_RL_EQUIPO_HORA = 20;     // envíos por equipo y hora
const PARTE_RL_GLOBAL_HORA = 200;    // envíos totales por hora (todos los equipos)
const PARTE_RL_VENTANA_S   = 3600;
// D166 — esquemas de payload (ver valEsquema_/valListaDe_ en Codigo.gs)
const PARTE_VAL_MAX_MEDIDOR = 10000000;   // horómetro/odómetro absoluto (h o km)
const PARTE_VAL_TRAMO = {
  reporte_num:['t',30], operador:['t',100], inicial:['n',0,PARTE_VAL_MAX_MEDIDOR], final:['n',0,PARTE_VAL_MAX_MEDIDOR],
  hora_de:['h'], hora_a:['h'], centro_coste:['t',100], pr:['n',0,1000000], uf:['t',5], descripcion_trabajo:['t',500],
  horas_varada:['n',0,VAL_MAX_HORAS], horas_lluvia:['n',0,VAL_MAX_HORAS], observaciones:['t',1000],
  inicial_modificado:['t',10], id_registro:['t',100], reparto:['a',10]
};
const PARTE_VAL_REPARTO = { centro_coste:['t',100], pct:['n',0,100], pr:['n',0,1000000], uf:['t',5], descripcion_trabajo:['t',500] };
const PARTE_VAL_REPORTE = { codigo:['t',50], origen:['t',20], tramos:['a',50] };
const PARTE_VAL_CAMBIO  = { id_registro:['t',100], estado:['l',PARTE_ESTADOS] };
const PARTE_VAL_REPARTIR = { id_registro:['t',100], reparto:['a',10] };   // D178: repartir una fila desde revisión
const PARTE_VAL_CAMPOS  = {
  fecha:['f',0], reporte_num:['t',30], inicial:['n',0,PARTE_VAL_MAX_MEDIDOR], final:['n',0,PARTE_VAL_MAX_MEDIDOR],
  horas_varada:['n',0,VAL_MAX_HORAS], horas_lluvia:['n',0,VAL_MAX_HORAS], hora_de:['h'], hora_a:['h'],
  descripcion_trabajo:['t',500], centro_coste:['t',100], pr:['n',0,1000000], uf:['t',5], operador:['t',100], observaciones:['t',1000]
};
function parteValidarReporte_(body){
  let f=valEsquema_(body, PARTE_VAL_REPORTE, '');
  if(!f && body.tramo!==undefined && !Array.isArray(body.tramos)) f=valEsquema_(body.tramo, PARTE_VAL_TRAMO, 'tramo');
  if(!f) f=valListaDe_(body.tramos, PARTE_VAL_TRAMO, 'tramos', 50);
  if(!f && Array.isArray(body.tramos)){
    for(let i=0;i<body.tramos.length && !f;i++){ const t=body.tramos[i]; if(t) f=valListaDe_(t.reparto, PARTE_VAL_REPARTO, 'tramos['+i+'].reparto', 10); }
  }
  return f ? rechazoPayload_(f.campo, f.motivo) : null;
}
function parteValidarRepartir_(body){
  let f=valEsquema_(body, PARTE_VAL_REPARTIR, '');
  if(!f) f=valListaDe_(body.reparto, PARTE_VAL_REPARTO, 'reparto', 10);
  return f ? rechazoPayload_(f.campo, f.motivo) : null;
}
function parteValidarRevisar_(body){
  let f=valListaDe_(body.cambios, PARTE_VAL_CAMBIO, 'cambios', 200);
  if(!f && Array.isArray(body.cambios)){
    for(let i=0;i<body.cambios.length && !f;i++){ const c=body.cambios[i]; if(c) f=valEsquema_(c.campos, PARTE_VAL_CAMPOS, 'cambios['+i+'].campos'); }
  }
  return f ? rechazoPayload_(f.campo, f.motivo) : null;
}
// Respaldo (D166): id extra si el Parte se separa algún día del Sheet de obra (propiedad PARTE_SHEET_ID).
function respaldoIdsExtra_(){
  try{ const id=String(PropertiesService.getScriptProperties().getProperty('PARTE_SHEET_ID')||'').trim();
       return (id && id!==SHEET_ID) ? [{ id:id, prefijo:'Parte_TM2' }] : []; }
  catch(err){ return []; }
}
function parteRechazoEquipo_(cod, detalle){
  logMarcar_('rechazado', 'equipo: '+detalle);
  return json({ ok:false, error:'equipo', detalle:'El código de equipo «'+cod+'» '+detalle+'. No se guardó nada. Elige tu equipo en la lista o avisa a maquinaria.' });
}

/* ---------- mapeo a BASE MAQUINARIA (Excel) ----------
 * La vista Base exporta EXACTAMENTE las columnas B→AR del Excel, con celda VACÍA donde va fórmula
 * (el resto lo calcula el Excel: TOTAL, TIPO, MARCA, consecutivo, VLOOKUPs desde EQUIPOS 2).
 * Columna → campo de PARTE_BANDEJA. INICIAL/FINAL (M/N) solo para medidor HOROMETRO; INICIAL2/
 * FINAL2 (V/W) solo para KM. Columna B (`Columna1`) queda vacía.
 * ⚠ Verificar contra el Excel real antes de dar el mapeo por cerrado (§4 del prompt V3-01). */
const PARTE_EXCEL_PRIMERA = 'B';
const PARTE_EXCEL_ULTIMA  = 'AR';
const PARTE_EXCEL_MAPA = {
  C:'fecha', E:'reporte_num', F:'codigo', M:'inicial_h', N:'final_h', Q:'horas_varada', R:'horas_lluvia',
  V:'inicial_km', W:'final_km', AA:'descripcion_trabajo', AB:'centro_coste', AD:'pr', AE:'uf',
  AL:'hora_de', AM:'hora_a', AQ:'operador', AR:'observaciones'
};

/* ============ utilidades ============ */
function parteColNum_(letra){ let n=0; const s=String(letra||'').toUpperCase(); for(let i=0;i<s.length;i++) n=n*26+(s.charCodeAt(i)-64); return n; }
function parteColLetra_(n){ let s=''; while(n>0){ const r=(n-1)%26; s=String.fromCharCode(65+r)+s; n=Math.floor((n-1)/26); } return s; }
function parteExcelColumnas_(){
  const out=[]; for(let n=parteColNum_(PARTE_EXCEL_PRIMERA); n<=parteColNum_(PARTE_EXCEL_ULTIMA); n++) out.push(parteColLetra_(n));
  return out;
}
function parteNormCod_(s){ return String(s==null?'':s).replace(/[^A-Za-z0-9]/g,'').toUpperCase(); }
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
  return '';   // vacío o REVISAR: sin medidor definido
}
// Hora "HH:MM" a partir de lo que venga: texto, número de Sheets (fracción de día) o Date (duck-typing).
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
/* D178 — Ítems y CC que Google Sheets convirtió a NÚMERO. Al importar el CSV (o al teclear en la
 * hoja) «02.10» se vuelve 2.1 y «03.03» 3.03: el chip mostraba «2.1», el CC salía «3701.2.1», llegaba
 * CC_DESCONOCIDO y en revisión no casaba con PARTE_CC. Se normaliza en TODA entrada y salida:
 *   ítem   2.1 → «02.10» · 3.03 → «03.03» · 11.04 → «11.04» · «I0408» se respeta
 *   CC     3701.2.1 → «3701.02.10» · «Taller» se respeta
 * El cero final es el único que se pierde al convertir (2.10 → 2.1; 2.01 sigue 2.01), así que rellenar
 * a dos dígitos por la derecha la parte decimal recupera el original sin ambigüedad. */
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
// Para el CC hay una ambigüedad que el ítem no tiene: «3702.2.7» puede venir de un ítem convertido a
// número (2.7 = «02.70», no existe) o de una persona que abrevió «02.07». Se decide con la hoja PARTE_CC:
// si la lectura numérica no existe en el catálogo y la abreviada sí, manda la abreviada.
var _parteCCConocidos=null;
function parteCCConocidos_(){
  if(_parteCCConocidos) return _parteCCConocidos;
  const set={};
  try{ readSheet('PARTE_CC').forEach(function(r){ const s=parteTexto_(r.centro_coste); if(/^37\d\d\.\d\d\.\d\d$/.test(s)) set[s]=1; }); }catch(err){}
  return (_parteCCConocidos=set);
}
function parteNormCC_(v){
  const s=parteTexto_(v);
  const m=/^(37\d\d)\.(\d{1,2})\.(\d{1,2})$/.exec(s);
  if(!m) return s;
  const numerica=m[1]+'.'+partePad2_(m[2])+'.'+partePadDec_(m[3]);
  if(m[3].length===2) return numerica;
  const abreviada=m[1]+'.'+partePad2_(m[2])+'.'+partePad2_(m[3]), con=parteCCConocidos_();
  return (!con[numerica] && con[abreviada]) ? abreviada : numerica;
}
function parteUF_(cc){
  const s=String(cc==null?'':cc).trim();
  if(s.indexOf('3701')===0) return '1';
  if(s.indexOf('3702')===0) return '2';
  if(s.indexOf('3703')===0) return '3';
  return '';
}
function parteHoy_(){ return Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd'); }
function parteFechaMasDias_(f, d){ const dt=toDate(f); if(!dt) return ''; dt.setDate(dt.getDate()+d); return fdate(dt); }
function parteTexto_(v){ return String(v==null?'':v).trim(); }
// Texto → JSON: normaliza lo que Sheets pudo convertir (horas a Date, nº de parte a número).
function parteFilaSalida_(r){
  const o={};
  PARTE_BANDEJA_HEADERS.forEach(function(k){ o[k]= r[k]===undefined ? '' : r[k]; });
  o.fecha=fdate(o.fecha);
  o.hora_de=parteHoraStr_(o.hora_de); o.hora_a=parteHoraStr_(o.hora_a);
  ['reporte_num','codigo','estado','origen','uf','centro_coste','operador','descripcion_trabajo','observaciones','alertas','revisado_por','inicial_modificado']
    .forEach(function(k){ o[k]=parteTexto_(o[k]); });
  o.centro_coste=parteNormCC_(o.centro_coste);   // D178: una fila vieja con «3701.2.1» sale ya corregida
  ['inicial','final','total','horas_varada','horas_lluvia','pr'].forEach(function(k){ const n=parteNum_(o[k]); o[k]= n===null ? '' : n; });
  if(o.timestamp && typeof o.timestamp==='object' && typeof o.timestamp.getFullYear==='function') o.timestamp=o.timestamp.toISOString();
  if(o.revisado_ts && typeof o.revisado_ts==='object' && typeof o.revisado_ts.getFullYear==='function') o.revisado_ts=o.revisado_ts.toISOString();
  return o;
}

/* ============ catálogos ============ */
function parteEquipos_(){
  const filas=readSheet('PARTE_EQUIPOS'), out={};
  filas.forEach(function(r){
    const cod=parteTexto_(r.codigo); if(!cod) return;
    const manual = (r.ultimo_final_manual!==undefined && r.ultimo_final_manual!=='') ? r.ultimo_final_manual : r.ultimo_final;
    out[parteNormCod_(cod)]={
      codigo:cod, tipo:parteTexto_(r.tipo), placa:parteTexto_(r.placa), proveedor:parteTexto_(r.proveedor),
      medidor:parteMedidor_(r.medidor), medidor_crudo:parteTexto_(r.medidor),
      activo:parteSiNo_(r.activo, true),
      ultimo_final_manual:parteNum_(manual), ultima_fecha:fdate(r.ultima_fecha||'')
    };
  });
  return out;
}
/* D173 — Equipos que el parte ESPERA en una fecha = los VIGENTES ese día en la hoja MAQUINAS
 * (estancias de toda la flota, frente en PARTE_FRENTES), con su ficha de PARTE_EQUIPOS. Consultar
 * un día viejo devuelve la flota que había ESE día, no la de hoy (mismo criterio que D138/D85).
 *   · Un equipo vigente SIN ficha entra igual (ficha mínima: tipo de la estancia, sin medidor → el
 *     parte avisa SIN_MEDIDOR) y se marca `sin_ficha` para que la revisión lo vea.
 *   · Un equipo con ficha pero SIN estancia vigente NO se espera ni puede reportar ese día.
 *   · Respaldo: si la hoja MAQUINAS está vacía (fuente 'codigo'), manda `activo` de PARTE_EQUIPOS
 *     como antes de D173 — nunca una flota vacía. */
function parteFlotaVigente_(fecha){
  try{
    if(typeof flotaEnFecha_!=='function') return null;
    const fl=flotaEnFecha_(fecha||'', { todos:true, frentes:PARTE_FRENTES });
    return (fl && fl.fuente==='hoja') ? fl : null;
  }catch(err){ return null; }
}
function parteEquiposActivos_(fecha){
  const m=parteEquipos_(), fl=parteFlotaVigente_(fecha);
  let lista;
  if(!fl){
    lista=Object.keys(m).map(function(k){ return m[k]; }).filter(function(q){ return q.activo; });
  }else{
    lista=Object.keys(fl.catalogo).map(function(id){
      const c=fl.catalogo[id], q=m[parteNormCod_(id)];
      if(q) return Object.assign({}, q, { activo:true, frente:c.frente, propiedad:c.propiedad, sin_ficha:false });
      return { codigo:id, tipo:c.tipo, placa:'', proveedor:c.propiedad||'', medidor:'', medidor_crudo:'', activo:true,
               ultimo_final_manual:null, ultima_fecha:'', frente:c.frente, propiedad:c.propiedad, sin_ficha:true };
    });
  }
  return lista.sort(function(a,b){ return a.codigo<b.codigo?-1:a.codigo>b.codigo?1:0; });
}
// Selector público (D173b): vigentes hoy primero (en_flota:true) y debajo TODAS las demás fichas con
// tipo, incluidas las retiradas o de otro frente, porque el reemplazo de un día suele ser justo una
// máquina «fuera» (VOL010 en taller que vuelve dos días). Orden alfabético dentro de cada grupo.
function parteSelectorEquipos_(){
  const vig=parteEquiposActivos_(), enFlota={};
  const out=vig.map(function(q){ enFlota[parteNormCod_(q.codigo)]=1; return { codigo:q.codigo, tipo:q.tipo, placa:q.placa, en_flota:true }; });
  const m=parteEquipos_();
  Object.keys(m).sort().forEach(function(k){
    if(enFlota[k]) return;
    const q=m[k]; if(!q.tipo) return;      // placa suelta sin tipo: no se ofrece
    out.push({ codigo:q.codigo, tipo:q.tipo, placa:q.placa, en_flota:false });
  });
  return out;
}
/* ============ D174 — actividad primero, CC derivado ============ */
function parteItemDeCC_(cc){ const m=/^37\d\d\.(.+)$/.exec(String(cc==null?'':cc).trim()); return m ? m[1] : ''; }
function parteItems_(){
  const out=[];
  try{
    readSheet('PARTE_ITEMS').forEach(function(r){
      const item=parteNormItem_(r.item); if(!item || !parteSiNo_(r.activo, true)) return;   // D178: 2.1 → «02.10»
      out.push({ tipo:parteTexto_(r.tipo_equipo), item:item, actividad:parteTexto_(r.actividad), veces:parteNum_(r.veces)||0 });
    });
  }catch(err){ /* hoja ausente: sin tabla, el formulario cae al CC directo */ }
  return out;
}
// Nombre de catálogo del ítem (PARTE_CC / BASE): se muestra bajo la frase del operador.
function parteNombreItem_(item, ccs){
  const c=ccs.filter(function(x){ return !x.pseudo && parteItemDeCC_(x.centro_coste)===item && x.descripcion_cc; })[0];
  return c ? c.descripcion_cc : '';
}
// Frase del operador para un ítem: la más usada en las filas dadas (primero las del tipo, luego cualquiera);
// si la tabla no la tiene, el nombre de catálogo; si no, el ítem.
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
/* Tres capas (backlog 4.06): habituales = ítems del EQUIPO en los últimos 30 días (PARTE_BANDEJA) +
 * los de su TIPO en la tabla; todas = la tabla entera sin repetir ítem. Nada se recorta: lo que no
 * está en habituales está en todas, y lo que no está en todas se escribe en texto libre (SIN_CC). */
function parteActividades_(q, hist){
  const tabla=parteItems_(), ccs=parteCC_(), hoy=parteHoy_(), desde=parteFechaMasDias_(hoy, -PARTE_DIAS_CC_RECIENTE);
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
  // Habituales: UN chip por ítem, con la frase más usada por su tipo (o por el equipo si es propio).
  const vistos={}, habituales=[];
  Object.keys(propios).sort(function(a,b){ return propios[b]-propios[a]; }).forEach(function(item){
    vistos[item]=1; habituales.push({ item:item, actividad:parteEtiquetaItem_(item, delTipo, tabla, ccs), nombre:parteNombreItem_(item, ccs), veces:propios[item], propio:true });
  });
  delTipo.sort(function(a,b){ return b.veces-a.veces; }).forEach(function(x){
    if(vistos[x.item]) return; vistos[x.item]=1;
    habituales.push({ item:x.item, actividad:parteEtiquetaItem_(x.item, delTipo, tabla, ccs), nombre:parteNombreItem_(x.item, ccs), veces:x.veces, propio:false });
  });
  // Todas: cada FRASE de la tabla (varias por ítem si así la escriben), sin repetir frase, por orden alfabético.
  const todosV={}, todas=[];
  tabla.forEach(function(x){
    const k=normTexto(x.actividad)+'|'+x.item; if(!x.actividad || todosV[k]) return; todosV[k]=1;
    todas.push({ item:x.item, actividad:x.actividad, nombre:parteNombreItem_(x.item, ccs) });
  });
  todas.sort(function(a,b){ return normTexto(a.actividad)<normTexto(b.actividad)?-1:normTexto(a.actividad)>normTexto(b.actividad)?1:(a.item<b.item?-1:1); });
  // D178: solo las PARTE_MAX_HABITUALES (5) más usadas; lo demás va por texto libre (SIN_CC → revisión).
  return { habituales:parteEtiquetasUnicas_(habituales.slice(0,PARTE_MAX_HABITUALES), delTipo, tabla, ccs), todas:todas, proyecto_habitual:(ultimoProy==='3702'?'3702':'3701') };
}
// ¿Se espera este equipo en esa fecha? Devuelve la ficha (con `frente`) o null.
function parteEquipoVigente_(cod, fecha){
  const k=parteNormCod_(cod);
  return parteEquiposActivos_(fecha).filter(function(q){ return parteNormCod_(q.codigo)===k; })[0] || null;
}
function parteOperadores_(){
  const vistos={}, out=[];
  readSheet('PARTE_OPERADORES').forEach(function(r){
    const n=parteOperadorCanon_(r.operador); if(!n || !parteSiNo_(r.activo, true)) return;   // D178: la variante se funde en el canónico
    const k=normTexto(n); if(vistos[k]) return; vistos[k]=1; out.push(n);
  });
  return out.sort(function(a,b){ return normTexto(a)<normTexto(b)?-1:1; });
}
function parteCC_(){
  const vistos={}, out=[];
  readSheet('PARTE_CC').forEach(function(r){
    const cc=parteNormCC_(r.centro_coste); if(!cc || !parteSiNo_(r.activo, true)) return;   // D178
    const k=normTexto(cc); if(vistos[k]) return; vistos[k]=1;
    const esPseudo=PARTE_CC_PSEUDO.some(function(p){ return normTexto(p.centro_coste)===k; });
    out.push({ centro_coste:cc, proyecto:parteTexto_(r.proyecto), descripcion_cc:parteTexto_(r.descripcion_cc) || parteDescBase_(cc),
               usos:parteNum_(r.usos_ult_4_meses)||0, pseudo:esPseudo });
  });
  PARTE_CC_PSEUDO.forEach(function(p){ if(!vistos[normTexto(p.centro_coste)]) out.push({ centro_coste:p.centro_coste, proyecto:'', descripcion_cc:p.descripcion_cc, usos:0, pseudo:true }); });
  // reales por uso (los frecuentes arriba) y luego por código; los pseudo al final.
  return out.sort(function(a,b){
    if(a.pseudo!==b.pseudo) return a.pseudo?1:-1;
    if(a.pseudo) return 0;
    if(b.usos!==a.usos) return b.usos-a.usos;
    return a.centro_coste<b.centro_coste?-1:1;
  });
}
// Descripción del ítem desde la hoja BASE de obra (tabla de ítems A–H, D68) cuando PARTE_CC no la trae:
// misma fuente que usa DATA, sin mantener dos catálogos. Sin BASE (o sin el ítem) devuelve ''.
function parteDescBase_(cc){
  try{
    const items=getBaseItems(); if(!items) return '';
    const cand=items[String(cc==null?'':cc).trim()] || items[ccCorto(cc)];
    return (cand && cand.length) ? String(cand[0].desc||'') : '';
  }catch(err){ return ''; }
}
function parteEsPseudoCC_(cc){ const k=normTexto(cc); return PARTE_CC_PSEUDO.some(function(p){ return normTexto(p.centro_coste)===k; }); }
// Tipo normalizado sin plural para emparejar "MOTONIVELADORA" con "MOTONIVELADORAS", "COMPACTADORES" con "COMPACTADOR".
function parteTipoBase_(t){ return normTexto(t).replace(/ES\b/g,'').replace(/S\b/g,'').replace(/\s+/g,' ').trim(); }
function parteSugerencias_(tipo){
  const filas=readSheet('PARTE_ACTIVIDADES'), exacto=normTexto(tipo), base=parteTipoBase_(tipo);
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

/* ============ PARTE_BANDEJA: lectura acotada por columnas (patrón D102/D107) ============
 * La hoja crece ~60 filas/día; para "último final del equipo", DUPLICADO y CC_INUSUAL no hace falta
 * traer las 27 columnas, solo 6. Se lee cada columna pedida entera (N×1) y se arma un objeto por fila
 * con esas claves y `_row`. Memo en `_memoRango` con prefijo de la hoja (así `invalidarHoja_` lo limpia). */
const PARTE_COLS_CLAVE = ['id_registro','estado','fecha','codigo','reporte_num','final','hora_de','hora_a','centro_coste','timestamp'];
function parteCols_(nombre, cols){
  const clave=nombre+'|cols|'+cols.join(',');
  if(_memoRango.hasOwnProperty(clave)) return _memoRango[clave];
  const sh=ss_().getSheetByName(nombre), out=[];
  if(!sh || sh.getLastRow()<2) return (_memoRango[clave]=out);
  const nCols=sh.getLastColumn(), n=sh.getLastRow()-1;
  const h=leerRango_(sh,1,1,1,nCols)[0].map(function(k){ return String(k==null?'':k).trim(); });
  const datos={};
  cols.forEach(function(c){ const j=h.indexOf(c); datos[c]= j<0 ? null : leerRango_(sh,2,j+1,n,1); });
  for(let i=0;i<n;i++){
    const o={ _row:i+2 };
    cols.forEach(function(c){ o[c]= datos[c] ? datos[c][i][0] : ''; });
    if(o.hasOwnProperty('fecha')) o.fecha=fdate(o.fecha);
    out.push(o);
  }
  return (_memoRango[clave]=out);
}
// Filas COMPLETAS (objetos con todas las claves del esquema) para un conjunto de nº de fila, en bloques contiguos.
function parteFilasCompletas_(nombre, rows){
  if(!rows.length) return [];
  const sh=ss_().getSheetByName(nombre); if(!sh) return [];
  const nCols=sh.getLastColumn();
  const h=leerRango_(sh,1,1,1,nCols)[0].map(function(k){ return String(k==null?'':k).trim(); });
  const orden=rows.slice().sort(function(a,b){ return a-b; }), out=[];
  let i=0;
  while(i<orden.length){
    let j=i; while(j+1<orden.length && orden[j+1]===orden[j]+1) j++;
    const desde=orden[i], n=orden[j]-desde+1;
    const v=leerRango_(sh,desde,1,n,nCols);
    for(let k=0;k<n;k++){ const o={ _row:desde+k }; h.forEach(function(c,ci){ o[c]=v[k][ci]; }); o.fecha=fdate(o.fecha); out.push(o); }
    i=j+1;
  }
  return out;
}
function parteEstadoDe_(r){ return parteTexto_(r.estado).toLowerCase() || 'pendiente'; }

// Minuto de FIN del turno tratando el cruce de medianoche (D188 — turno noche). Un turno 18:00→06:00 se
// reporta en el día que EMPIEZA, así que su hora_a (06:00) es del día siguiente y ocurrió DESPUÉS de la
// entrada: +24 h para que ordene como lo último. Sin hora_de válida (o sin cruce) = minuto de hora_a tal cual.
function parteFinMin_(horaDe, horaA){
  const mA=parteHoraMin_(horaA); if(mA<0) return -1;
  const mDe=parteHoraMin_(horaDe);
  return (mDe>=0 && mA<mDe) ? mA+1440 : mA;
}

// Último `final` registrado del equipo (filas no descartadas; la más reciente por fecha, hora de FIN y
// timestamp; D188: la hora de fin cruza medianoche por parteFinMin_, así el turno noche cuenta como el más
// reciente). Respaldo: `ultimo_final_manual`/`ultimo_final` de PARTE_EQUIPOS (arranque del primer día).
function parteUltimoFinal_(equipo){
  const cod=parteNormCod_(equipo.codigo);
  let mejor=null;
  parteCols_('PARTE_BANDEJA', PARTE_COLS_CLAVE).forEach(function(r){
    if(parteNormCod_(r.codigo)!==cod || parteEstadoDe_(r)==='descartado') return;
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

/* ============ GET equipo (PÚBLICO) ============ */
// ?mod=parte&op=equipo&eq=CODIGO → todo lo que necesita parte.html en UNA llamada.
function parteEquipo(e){
  const eq=parteTexto_(e.parameter.eq), mapa=parteEquipos_();
  logIdentidad_(eq, 'equipo');   // D166: identidad pública = código de equipo
  // D173b: el selector trae PRIMERO los vigentes hoy en la flota y debajo el resto de fichas
  // (`en_flota:false`): una volqueta de reemplazo por un día reporta sin pasar por la Flota.
  const lista=parteSelectorEquipos_();
  if(!eq) return json({ ok:true, equipo:null, equipos:lista, hoy:parteHoy_() });
  const vig = parteEquipoVigente_(eq) || parteEquipoVigente_(eq, parteFechaMasDias_(parteHoy_(), -1));
  const q = vig || mapa[parteNormCod_(eq)];
  if(!q) return json({ ok:false, error:'El código «'+eq+'» no tiene ficha en PARTE_EQUIPOS. Elige tu equipo en la lista o avisa a maquinaria (un equipo nuevo se da de alta en Maquinaria › Flota).', equipos:lista, hoy:parteHoy_() });
  const ultimo=parteUltimoFinal_(q);
  const hist=parteCols_('PARTE_BANDEJA', PARTE_COLS_CLAVE).filter(function(r){ return parteNormCod_(r.codigo)===parteNormCod_(q.codigo); });
  return json({ ok:true,
    equipo:{ codigo:q.codigo, tipo:q.tipo, placa:q.placa, proveedor:q.proveedor, medidor:q.medidor, activo:q.activo,
             en_flota: !!vig },
    ultimo:ultimo, operadores:parteOperadores_(), cc:parteCC_(), sugerencias:parteSugerencias_(q.tipo),
    actividades:parteActividades_(q, hist),   // D174: habituales · todas · proyecto_habitual
    topes:PARTE_TOPES, hoy:parteHoy_() });
}

/* ---------- reparto por porcentaje ----------
 * En el parte físico es corriente «50 % a este centro de coste y 50 % a este otro» SIN medidor
 * intermedio (una sola actividad, varios CC). El tramo llega con el medidor completo y
 * `reparto:[{centro_coste, pct, pr?, uf?}]`; aquí se abre en N filas encadenadas —la primera
 * arranca en el inicial, cada una termina en inicial + total × %acumulado y la última cierra EXACTO
 * en el final (sin restos de redondeo)—, con las horas repartidas en la misma proporción. Así el
 * Excel recibe una fila por CC, igual que hoy, y el kilometraje/horómetro sigue cuadrando de una
 * fila a la siguiente. La observación lleva la marca «[Reparto 50 % · 1/2]» para quien revisa. */
function parteMinAHora_(m){ m=Math.round(m); return ('0'+Math.floor(m/60)%24).slice(-2)+':'+('0'+(m%60)).slice(-2); }
function parteExpandirReparto_(tramos){
  const out=[];
  for(let i=0;i<tramos.length;i++){
    const t=tramos[i]||{};
    const rep=Array.isArray(t.reparto) ? t.reparto.filter(function(r){ return r && (parteTexto_(r.centro_coste) || parteNum_(r.pct)!==null); }) : [];
    if(rep.length<2){ out.push(t); continue; }
    const n=i+1;
    let suma=0;
    for(let j=0;j<rep.length;j++){
      const pct=parteNum_(rep[j].pct);
      rep[j].centro_coste=parteNormCC_(rep[j].centro_coste);   // D178
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
        descripcion_trabajo: parteTexto_(r.descripcion_trabajo) || t.descripcion_trabajo,   // D178: reparto desde revisión puede dar una descripción por fila
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

/* ============ POST reporte (PÚBLICO) ============
 * {mod:'parte', op:'reporte', codigo, tramos:[{fecha, reporte_num, operador, inicial, final, hora_de,
 *  hora_a, centro_coste, pr, uf, descripcion_trabajo, horas_varada, horas_lluvia, observaciones,
 *  inicial_modificado, id_registro?}], origen?}
 * Solo CREA filas `pendiente`. `origen` manual solo con sesión de revisor (panel "+ Agregar manual" y
 * «Día sin operación» de Equipos sin parte); sin sesión válida se fuerza `qr`. Cada tramo = 1 fila. Valida
 * lo que bloquea (mismas reglas que el cliente) y calcula total, uf (si viene vacía) y alertas. El nº de
 * parte físico es obligatorio salvo en filas manuales con pseudo-CC (día sin operación). */
function parteReporte(body, ses){
  const cod=parteTexto_(body.codigo);
  logIdentidad_(cod, 'equipo');   // D166: identidad pública = código de equipo (no hay usuario)
  // D166 — orden a propósito: rate limit (caché, sin Sheet) → tipos/rangos del payload (sin Sheet) →
  // equipo existente y activo (lee PARTE_EQUIPOS) → reglas de negocio de siempre.
  const rlG=rateLimit_('global', 'parte:reporte', PARTE_RL_GLOBAL_HORA, PARTE_RL_VENTANA_S);
  if(!rlG.ok) return respuestaRateLimit_(rlG);
  const rlE=rateLimit_('eq:'+(parteNormCod_(cod)||'sin-codigo'), 'parte:reporte', PARTE_RL_EQUIPO_HORA, PARTE_RL_VENTANA_S);
  if(!rlE.ok) return respuestaRateLimit_(rlE);
  const vp=parteValidarReporte_(body); if(vp) return vp;
  const mapa=parteEquipos_();
  // D173: vigente en la flota el DÍA DEL PARTE (primer tramo; sin fecha → hoy). Sin hoja MAQUINAS
  // manda `activo` de PARTE_EQUIPOS, como antes.
  const crudos0=Array.isArray(body.tramos) ? body.tramos : (body.tramo ? [body.tramo] : []);
  const fechaParte=fdateValida_((crudos0[0]&&crudos0[0].fecha)||body.fecha||'') || parteHoy_();
  // D173b: la vigencia NO bloquea. Una volqueta de reemplazo por un día reporta con su QR de siempre
  // y la fila llega con la alerta FUERA_DE_FLOTA para que quien revisa vea qué se movió; la varada
  // se cierra desde «Equipos sin parte» como Taller (D172). Solo se rechaza lo que no tiene ficha.
  const vig=parteEquipoVigente_(cod, fechaParte);
  const q = vig || mapa[parteNormCod_(cod)];
  if(!q) return parteRechazoEquipo_(cod, 'no tiene ficha en PARTE_EQUIPOS (un equipo nuevo se da de alta en Maquinaria › Flota)');
  const fueraDeFlota = !vig;
  // Los rechazos de negocio de abajo conservan su texto (lo muestra parte.html) y quedan en LOG.
  const rechazo=function(msg){ logMarcar_('rechazado', msg); return json({ ok:false, error:msg }); };
  const crudos=Array.isArray(body.tramos) ? body.tramos : (body.tramo ? [body.tramo] : []);
  if(!crudos.length) return rechazo('El parte llegó sin tramos. No se guardó nada.');
  const exp=parteExpandirReparto_(crudos);
  if(exp.error) return rechazo(exp.error);
  const tramos=exp.tramos;
  const revisor = !!(ses && ses.ok && parteAutoriza_(ses));
  const origen = (parteTexto_(body.origen).toLowerCase()==='manual' && revisor) ? 'manual' : 'qr';
  if(origen==='manual'){ logIdentidad_(ses.usuario, ses.rol); logMarcar_('ok', 'origen manual · equipo '+q.codigo); }   // D166
  const hoy=parteHoy_();
  const ccValidos={}; parteCC_().forEach(function(c){ ccValidos[normTexto(c.centro_coste)]=c; });
  const tope=PARTE_TOPES[q.medidor] || null;

  // Historial del equipo, leído UNA vez: último final, duplicados y CC de los últimos 30 días.
  const hist=parteCols_('PARTE_BANDEJA', PARTE_COLS_CLAVE).filter(function(r){ return parteNormCod_(r.codigo)===parteNormCod_(q.codigo); });
  const ultimo=parteUltimoFinal_(q);
  const idsEx={}; hist.forEach(function(r){ const id=parteTexto_(r.id_registro); if(id) idsEx[id]=1; });
  const ccRecientes={}; let hayHistorialCC=false;
  // D188 (turno noche): nº de parte físico → días ya registrados (no descartados). El mismo parte con OTRA
  // fecha ≈ mismo turno subido dos veces (riesgo del turno que cruza medianoche) → PARTE_REPETIDO.
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

  const sh=getSheet('PARTE_BANDEJA', PARTE_BANDEJA_HEADERS), ts=new Date();
  const filas=[], salida=[]; let duplicadas=0;
  let finalPrevio = ultimo ? ultimo.final : null;   // el 2º tramo del mismo envío se compara con el 1º
  for(let i=0;i<tramos.length;i++){
    const t=tramos[i]||{}, n=i+1;
    const fecha=fdateValida_(t.fecha);
    if(!fecha) return rechazo('Tramo '+n+': la fecha llegó vacía o no se entiende. No se guardó nada.');
    if(fecha>hoy) return rechazo('Tramo '+n+': la fecha no puede ser futura. No se guardó nada.');
    const reporte=parteTexto_(t.reporte_num), operador=parteOperadorCanon_(t.operador), cc=parteNormCC_(t.centro_coste);   // D178: alias y CC normalizados
    // Sin nº de parte físico solo en filas manuales de un día sin operación (pseudo-CC): domingos, festivos,
    // lluvia o taller los cierra quien revisa desde «Equipos sin parte» y ese día no hubo parte en papel.
    if(!reporte && !(origen==='manual' && parteEsPseudoCC_(cc))) return rechazo('Tramo '+n+': falta el número del parte físico. No se guardó nada.');
    if(!operador) return rechazo('Tramo '+n+': falta el operador. No se guardó nada.');
    // D174: sin CC pero con descripción = texto libre (capa 3); llega con SIN_CC y lo pone revisión.
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

    const id = parteTexto_(t.id_registro) || Utilities.getUuid();
    if(idsEx[id]){ duplicadas++; salida.push({ id_registro:id, duplicada:true }); continue; }   // reenvío (idempotente)
    const iniMod = parteSiNo_(t.inicial_modificado, false) ? 'SI' : 'NO';
    filas.push([ id, ts, 'pendiente', fecha, q.codigo, q.tipo, q.placa, q.medidor,
      reporte, ini===null?'':ini, fin===null?'':fin, total, iniMod,
      parteNum_(t.horas_varada)===null?'':parteNum_(t.horas_varada), parteNum_(t.horas_lluvia)===null?'':parteNum_(t.horas_lluvia),
      hDe, hA, parteTexto_(t.descripcion_trabajo), cc, parteNum_(t.pr)===null?'':parteNum_(t.pr), uf, operador,
      parteTexto_(t.observaciones), alertas.join(';'), '', '', origen ]);
    salida.push({ id_registro:id, fecha:fecha, total:total, uf:uf, alertas:alertas });
    if(fin!==null) finalPrevio=fin;
  }
  if(filas.length){
    ensureRows_(sh, filas.length);   // D93
    const desde=sh.getLastRow()+1;
    parteFormatoTexto_(sh, desde, filas.length);
    sh.getRange(desde, 1, filas.length, PARTE_BANDEJA_HEADERS.length).setValues(filas);
    invalidarHoja_('PARTE_BANDEJA');
  }
  return json({ ok:true, guardadas:filas.length, duplicadas:duplicadas, filas:salida, equipo:{ codigo:q.codigo, tipo:q.tipo, placa:q.placa, medidor:q.medidor } });
}

// Sheets convierte solo lo que escribe setValues: "0457" pasaría a 457 (se pierde el cero del nº de
// parte físico) y "07:00" a una hora-fecha. Se fija formato de TEXTO (@) en esas columnas ANTES de
// escribir, en las filas que se van a escribir (una llamada por columna). setupParte() lo deja
// además fijado para toda la columna.
const PARTE_COLS_TEXTO = ['reporte_num','hora_de','hora_a','codigo','placa','uf'];
function parteFormatoTexto_(sh, desde, n){
  PARTE_COLS_TEXTO.forEach(function(k){
    const c=PARTE_BANDEJA_HEADERS.indexOf(k)+1; if(c<1) return;
    try{ sh.getRange(desde, c, n, 1).setNumberFormat('@'); }catch(err){ /* sin formato no se rompe la escritura */ }
  });
}

/* ============ revisión (TOKEN) ============ */
function parteAutoriza_(ses){
  if(!ses || !ses.ok) return false;
  if(ses.tolerado) return true;    // AUTH_ESTRICTO=false (D109)
  if(PARTE_USUARIOS_REVISAN.indexOf(String(ses.usuario||'').trim().toLowerCase())>=0) return true;   // D178: jeisson
  return PARTE_ROLES_REVISAN.indexOf(String(ses.rol||'').trim().toLowerCase())>=0;
}
function parteSinPermiso_(){ logMarcar_('rechazado','rol sin permiso de revisión'); return json({ ok:false, error:'Tu usuario no revisa partes de maquinaria (roles: '+PARTE_ROLES_REVISAN.join(', ')+'; usuarios: '+PARTE_USUARIOS_REVISAN.join(', ')+').' }); }

// ?mod=parte&op=bandeja&fecha= → {pendientes, revisadas, faltantes, listas}
function parteBandeja(e){
  const fecha=fdateValida_(e.parameter.fecha||'') || parteHoy_();
  const filas=readSheetPorFecha_('PARTE_BANDEJA', fecha).map(parteFilaSalida_);
  const pendientes=[], revisadas=[], conParte={};
  filas.forEach(function(r){
    const est=r.estado.toLowerCase()||'pendiente';
    if(est!=='descartado') conParte[parteNormCod_(r.codigo)]=1;
    (est==='pendiente' ? pendientes : revisadas).push(r);
  });
  const ordena=function(a,b){ return (a.codigo+a.hora_de)<(b.codigo+b.hora_de)?-1:1; };
  pendientes.sort(ordena); revisadas.sort(ordena);
  // D173: se esperan los equipos VIGENTES ESE DÍA en la flota (hoja MAQUINAS, frente del parte).
  const vigentes=parteEquiposActivos_(fecha);
  const faltantes=vigentes.filter(function(q){ return !conParte[parteNormCod_(q.codigo)]; })
    .map(function(q){ return { codigo:q.codigo, tipo:q.tipo, placa:q.placa, medidor:q.medidor, ultimo:parteUltimoFinal_(q), sin_ficha:!!q.sin_ficha }; });
  return json({ ok:true, fecha:fecha, pendientes:pendientes, revisadas:revisadas, faltantes:faltantes,
    flota_fuente: parteFlotaVigente_(fecha) ? 'hoja' : 'activo',
    listas:{ operadores:parteOperadores_(), cc:parteCC_(), equipos:vigentes.map(function(q){ return { codigo:q.codigo, tipo:q.tipo, placa:q.placa, medidor:q.medidor }; }) },
    topes:PARTE_TOPES });
}

// POST {mod:'parte', op:'revisar', cambios:[{id_registro, estado?, campos?:{...}}]}
// Escritura QUIRÚRGICA: localiza cada fila por id_registro (columna id, N×1), lee ESA fila, mezcla y
// reescribe solo esa fila. Nunca se borra ni se reordena la hoja. `total` y `uf` se recalculan si
// cambian inicial/final o el CC; las alertas se conservan (son el registro de lo que llegó).
const PARTE_CAMPOS_EDITABLES = ['fecha','reporte_num','inicial','final','horas_varada','horas_lluvia','hora_de','hora_a',
  'descripcion_trabajo','centro_coste','pr','uf','operador','observaciones'];
function parteRevisar(body, ses){
  // D198: el jefe corrige campos de filas YA aprobadas de la Base; no cambia estados (paridad con el Worker).
  const soloBase=!parteAutoriza_(ses) && !!(ses && ses.ok) && String(ses.rol||'').trim().toLowerCase()==='jefe';
  if(!parteAutoriza_(ses) && !soloBase) return parteSinPermiso_();
  const vp=parteValidarRevisar_(body); if(vp) return vp;   // D166: tipos/rangos/longitudes/fecha
  const cambios=Array.isArray(body.cambios) ? body.cambios : [];
  if(!cambios.length) return json({ ok:false, error:'No llegó ningún cambio.' });
  const sh=getSheet('PARTE_BANDEJA', PARTE_BANDEJA_HEADERS);
  const ids=parteCols_('PARTE_BANDEJA', ['id_registro']);
  const filaDe={}; ids.forEach(function(r){ const id=parteTexto_(r.id_registro); if(id) filaDe[id]=r._row; });
  const quien=String((ses&&ses.usuario)||body.usuario||''), ts=new Date();
  const nCols=PARTE_BANDEJA_HEADERS.length, hechos=[], errores=[];
  cambios.forEach(function(c){
    const id=parteTexto_(c.id_registro), row=filaDe[id];
    if(!row){ errores.push({ id_registro:id, error:'no existe' }); return; }
    const v=leerRango_(sh,row,1,1,nCols)[0], obj={};
    PARTE_BANDEJA_HEADERS.forEach(function(k,i){ obj[k]=v[i]; });
    if(parteTexto_(obj.id_registro)!==id){ errores.push({ id_registro:id, error:'la fila se movió; recarga' }); return; }
    if(soloBase && parteEstadoDe_(obj)!=='aprobado'){ errores.push({ id_registro:id, error:'solo se corrigen filas aprobadas de la Base' }); return; }
    if(soloBase && parteTexto_(c.estado)){ errores.push({ id_registro:id, error:'aprobar o descartar lo hace quien revisa los partes' }); return; }
    const campos=c.campos||{}; let tocado=false, malo='';
    PARTE_CAMPOS_EDITABLES.forEach(function(k){
      if(malo || !campos.hasOwnProperty(k)) return;
      let val=campos[k];
      if(k==='fecha'){ val=fdateValida_(val); if(!val){ malo='fecha inválida'; return; } }
      else if(k==='hora_de'||k==='hora_a') val=parteHoraStr_(val);
      else if(k==='inicial'||k==='final'||k==='horas_varada'||k==='horas_lluvia'||k==='pr'){ const n=parteNum_(val); val= n===null ? '' : n; }
      else if(k==='centro_coste') val=parteNormCC_(val);          // D178
      else if(k==='operador') val=parteOperadorCanon_(val);      // D178
      else val=parteTexto_(val);
      obj[k]=val; tocado=true;
    });
    if(malo){ errores.push({ id_registro:id, error:malo }); return; }   // la fila no se toca
    if(campos.hasOwnProperty('inicial') || campos.hasOwnProperty('final')){
      const ini=parteNum_(obj.inicial), fin=parteNum_(obj.final);
      if(ini!==null && fin!==null){
        if(fin<ini){ errores.push({ id_registro:id, error:'final menor que inicial' }); return; }
        obj.total=parteRedondea_(fin-ini);
      } else obj.total='';
    }
    if(campos.hasOwnProperty('centro_coste') && !campos.hasOwnProperty('uf')) obj.uf=parteUF_(obj.centro_coste);
    const est=parteTexto_(c.estado).toLowerCase();
    if(est){
      if(PARTE_ESTADOS.indexOf(est)<0){ errores.push({ id_registro:id, error:'estado desconocido' }); return; }
      // D174: una fila de texto libre (SIN_CC) no se aprueba sin ponerle el centro de coste.
      if(est==='aprobado' && !parteTexto_(obj.centro_coste)){ errores.push({ id_registro:id, error:obj.codigo+': sin centro de coste; ponlo antes de aprobar' }); return; }
      obj.estado=est; tocado=true;
    }
    if(!tocado){ errores.push({ id_registro:id, error:'sin cambios' }); return; }
    obj.revisado_por=quien; obj.revisado_ts=ts;
    sh.getRange(row,1,1,nCols).setValues([PARTE_BANDEJA_HEADERS.map(function(k){ return obj[k]===undefined?'':obj[k]; })]);
    hechos.push(parteFilaSalida_(obj));
  });
  if(hechos.length) invalidarHoja_('PARTE_BANDEJA');
  return json({ ok:true, cambiadas:hechos.length, filas:hechos, errores:errores });
}

/* ============ D178 — repartir una fila desde revisión (TOKEN) ============
 * POST {mod:'parte', op:'repartir', id_registro, reparto:[{centro_coste, pct, pr?, uf?, descripcion_trabajo?}]}
 * Quien revisa ve que un parte fue a DOS o más centros de coste (o a dos actividades) y el operador lo
 * mandó con uno solo. La fila original NO se borra (regla de PARTE_BANDEJA): pasa a `descartado` con la
 * marca «[Repartido en N filas]» en observaciones, y se crean N filas `pendiente` encadenadas con el
 * MISMO motor que el reparto por % del formulario (`parteExpandirReparto_`): medidor y horas
 * prorrateados, la última cierra exacto en el final, `[Reparto 50 % · 1/2]` en observaciones. Las
 * nuevas heredan fecha, nº de parte, operador, medidor, horas varada/lluvia y `origen`; las alertas se
 * recalculan solo en lo que el reparto cambia (SIN_CC / CC_DESCONOCIDO); las demás se copian porque
 * son el registro de lo que llegó. ids = <id original>-r1 … -rN (si ya existen, se les añade un sufijo). */
function parteRepartir(body, ses){
  if(!parteAutoriza_(ses)) return parteSinPermiso_();
  const vp=parteValidarRepartir_(body); if(vp) return vp;
  const id=parteTexto_(body.id_registro);
  const rep=(Array.isArray(body.reparto)?body.reparto:[]).filter(function(r){ return r && (parteTexto_(r.centro_coste) || parteNum_(r.pct)!==null || parteTexto_(r.descripcion_trabajo)); });
  if(rep.length<2) return json({ ok:false, error:'Un reparto necesita al menos dos centros de coste.' });
  const sh=getSheet('PARTE_BANDEJA', PARTE_BANDEJA_HEADERS), nCols=PARTE_BANDEJA_HEADERS.length;
  const ids=parteCols_('PARTE_BANDEJA', ['id_registro']), idsEx={}; let row=0;
  ids.forEach(function(r){ const x=parteTexto_(r.id_registro); if(!x) return; idsEx[x]=1; if(x===id) row=r._row; });
  if(!row) return json({ ok:false, error:'La fila «'+id+'» no existe.' });
  const v=leerRango_(sh,row,1,1,nCols)[0], obj={};
  PARTE_BANDEJA_HEADERS.forEach(function(k,i){ obj[k]=v[i]; });
  if(parteTexto_(obj.id_registro)!==id) return json({ ok:false, error:'La fila se movió; recarga.' });
  if(parteEstadoDe_(obj)==='descartado') return json({ ok:false, error:'La fila ya está descartada; reábrela antes de repartirla.' });
  // tramo virtual = la fila tal cual, con el reparto pedido encima
  const t={ id_registro:id, fecha:fdate(obj.fecha), reporte_num:parteTexto_(obj.reporte_num), operador:parteTexto_(obj.operador),
    inicial:parteNum_(obj.inicial), final:parteNum_(obj.final), hora_de:parteHoraStr_(obj.hora_de), hora_a:parteHoraStr_(obj.hora_a),
    centro_coste:parteNormCC_(obj.centro_coste), pr:parteNum_(obj.pr), uf:parteTexto_(obj.uf), descripcion_trabajo:parteTexto_(obj.descripcion_trabajo),
    horas_varada:parteNum_(obj.horas_varada), horas_lluvia:parteNum_(obj.horas_lluvia), observaciones:parteTexto_(obj.observaciones),
    inicial_modificado:parteTexto_(obj.inicial_modificado)||'NO',
    reparto:rep.map(function(r){ return { centro_coste:r.centro_coste, pct:r.pct, pr:r.pr, uf:r.uf, descripcion_trabajo:r.descripcion_trabajo }; }) };
  if(t.inicial===null) t.inicial=''; if(t.final===null) t.final='';
  const exp=parteExpandirReparto_([t]);
  if(exp.error) return json({ ok:false, error:exp.error.replace(/^Tramo 1: /,'') });
  const ccValidos={}; parteCC_().forEach(function(c){ ccValidos[normTexto(c.centro_coste)]=1; });
  const alertasBase=String(obj.alertas||'').split(';').map(function(s){ return s.trim(); }).filter(function(a){ return a && a!=='SIN_CC' && a!=='CC_DESCONOCIDO'; });
  const quien=String((ses&&ses.usuario)||''), ts=new Date(), filas=[], salida=[];
  exp.tramos.forEach(function(s,j){
    let nid=s.id_registro||(id+'-r'+(j+1)); let k=2; while(idsEx[nid]){ nid=id+'-r'+(j+1)+'-'+(k++); } idsEx[nid]=1;
    const cc=parteNormCC_(s.centro_coste), al=alertasBase.slice();
    if(!cc) al.push('SIN_CC'); else if(!ccValidos[normTexto(cc)] && !parteEsPseudoCC_(cc)) al.push('CC_DESCONOCIDO');
    const ini=parteNum_(s.inicial), fin=parteNum_(s.final), total=(ini!==null&&fin!==null)?parteRedondea_(fin-ini):'';
    const uf=parteTexto_(s.uf)||parteUF_(cc);
    filas.push([ nid, ts, 'pendiente', t.fecha, parteTexto_(obj.codigo), parteTexto_(obj.tipo), parteTexto_(obj.placa), parteTexto_(obj.medidor),
      t.reporte_num, ini===null?'':ini, fin===null?'':fin, total, j===0?t.inicial_modificado:'NO',
      t.horas_varada===null?'':t.horas_varada, t.horas_lluvia===null?'':t.horas_lluvia,
      parteHoraStr_(s.hora_de), parteHoraStr_(s.hora_a), parteTexto_(s.descripcion_trabajo), cc, parteNum_(s.pr)===null?'':parteNum_(s.pr), uf, t.operador,
      parteTexto_(s.observaciones), al.join(';'), quien, ts, parteTexto_(obj.origen)||'manual' ]);
  });
  // 1) la original queda descartada con la marca; 2) las nuevas al final
  obj.estado='descartado'; obj.observaciones=(parteTexto_(obj.observaciones)?parteTexto_(obj.observaciones)+' · ':'')+'[Repartido en '+filas.length+' filas]';
  obj.revisado_por=quien; obj.revisado_ts=ts;
  sh.getRange(row,1,1,nCols).setValues([PARTE_BANDEJA_HEADERS.map(function(k){ return obj[k]===undefined?'':obj[k]; })]);
  ensureRows_(sh, filas.length);
  const desde=sh.getLastRow()+1;
  parteFormatoTexto_(sh, desde, filas.length);
  sh.getRange(desde,1,filas.length,nCols).setValues(filas);
  invalidarHoja_('PARTE_BANDEJA');
  filas.forEach(function(f){ const o={}; PARTE_BANDEJA_HEADERS.forEach(function(k,i){ o[k]=f[i]; }); salida.push(parteFilaSalida_(o)); });
  return json({ ok:true, original:parteFilaSalida_(obj), filas:salida, cambiadas:1+salida.length });
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
// ?mod=parte&op=base&desde=&hasta=[&estado=aprobado] → aprobados del rango, ordenados por fecha·código·hora
function parteBase(e){
  const desde=fdateValida_(e.parameter.desde||''), hasta=fdateValida_(e.parameter.hasta||'') || desde;
  if(!desde) return json({ ok:false, error:'Falta la fecha «desde» (yyyy-mm-dd).' });
  if(hasta<desde) return json({ ok:false, error:'«hasta» es anterior a «desde».' });
  if(toDate(hasta)-toDate(desde) > PARTE_MAX_DIAS_BASE*86400000) return json({ ok:false, error:'El rango no puede pasar de '+PARTE_MAX_DIAS_BASE+' días.' });
  const estado=parteTexto_(e.parameter.estado).toLowerCase() || 'aprobado';
  const rows=parteCols_('PARTE_BANDEJA', ['fecha','estado']).filter(function(r){ return r.fecha>=desde && r.fecha<=hasta && (estado==='todos' || parteEstadoDe_(r)===estado); }).map(function(r){ return r._row; });
  const filas=parteFilasCompletas_('PARTE_BANDEJA', rows).map(parteFilaSalida_)
    .sort(function(a,b){ const ka=a.fecha+'|'+a.codigo+'|'+a.hora_de, kb=b.fecha+'|'+b.codigo+'|'+b.hora_de; return ka<kb?-1:ka>kb?1:0; });
  return json({ ok:true, desde:desde, hasta:hasta, estado:estado, filas:filas,
    excel:{ primera:PARTE_EXCEL_PRIMERA, ultima:PARTE_EXCEL_ULTIMA, columnas:parteExcelColumnas_(), mapa:PARTE_EXCEL_MAPA, filas:filas.map(parteExcelFila_) },
    listas:{ operadores:parteOperadores_(), cc:parteCC_() } });
}

/* ============ enrutado (lo llaman doGet/doPost de Codigo.gs) ============ */
function parteDoGet_(e){
  const op=String(e.parameter.op||'').toLowerCase();
  if(op==='equipo') return parteEquipo(e);                      // público (LOG con el código del equipo)
  const p=puerta_(e, null, 'parte:'+op);                        // D109 + D166 (LOG, rate limit, mensaje genérico)
  if(!p.ok) return p.respuesta;
  const ses=p.ses;
  // D198: el jefe lee la Base (y en parteRevisar corrige campos de filas aprobadas); paridad con el Worker.
  if(op==='base' && !parteAutoriza_(ses) && ses && ses.ok && String(ses.rol||'').trim().toLowerCase()==='jefe') return parteBase(e);
  if(!parteAutoriza_(ses)) return parteSinPermiso_();
  if(op==='bandeja') return parteBandeja(e);
  if(op==='base')    return parteBase(e);
  return json({ ok:false, error:'op desconocida: '+op });
}
function parteDoPost_(e, body){
  const op=String(body.op||'').toLowerCase();
  if(op==='reporte'){
    // Público. Si además trae token válido (panel "+ Agregar manual"), se acepta origen=manual.
    let ses=null;
    if(body.token){ ses=sesion_(e, body); if(ses.ok && ses.usuario) body.usuario=ses.usuario; }
    return parteReporte(body, ses);
  }
  const p=puerta_(e, body, 'parte:'+op);                        // D109 + D166
  if(!p.ok) return p.respuesta;
  const ses=p.ses;
  if(ses.usuario) body.usuario=ses.usuario;
  if(op==='revisar')  return parteRevisar(body, ses);
  if(op==='repartir') return parteRepartir(body, ses);   // D178
  return json({ ok:false, error:'op desconocida: '+op });
}

/* ============ setup (se ejecuta A MANO desde el editor, una vez) ============
 * 1) setupParte()  → crea las 5 hojas con sus encabezados (no toca las que ya tienen filas).
 * 2) Importar los 4 CSV de backend/seeds/parte/ en su hoja: Archivo → Importar → Subir →
 *    "Reemplazar hoja actual" (el encabezado del CSV coincide con el de la hoja).
 * 3) Volver a ejecutar setupParte(): repone las columnas extra (`activo`, `ultimo_final_manual`) que
 *    el CSV no trae y agrega los pseudo-CC (Taller · Disponible · Domingo/Festivo) a PARTE_CC.
 * 4) Redesplegar: Implementar → Administrar implementaciones → editar → Nueva versión (misma URL).
 * Idempotente: se puede correr las veces que haga falta. */
function setupParte(){
  const ss=ss_();
  const asegura=function(nombre, headers){
    let sh=ss.getSheetByName(nombre);
    if(!sh){ sh=ss.insertSheet(nombre); sh.getRange(1,1,1,headers.length).setValues([headers]); return sh; }
    if(sh.getLastRow()===0){ sh.getRange(1,1,1,headers.length).setValues([headers]); return sh; }
    // Hoja importada del CSV: se AÑADEN al final los encabezados que falten, sin mover los existentes.
    const nCols=Math.max(sh.getLastColumn(),1);
    const cur=leerRango_(sh,1,1,1,nCols)[0].map(function(k){ return String(k==null?'':k).trim(); });
    const faltan=headers.filter(function(h){ return cur.indexOf(h)<0; });
    if(faltan.length){ ensureCols_(sh, nCols+faltan.length); sh.getRange(1,nCols+1,1,faltan.length).setValues([faltan]); }
    return sh;
  };
  asegura('PARTE_EQUIPOS', PARTE_EQUIPOS_HEADERS);
  asegura('PARTE_OPERADORES', PARTE_OPERADORES_HEADERS);
  const cc=asegura('PARTE_CC', PARTE_CC_HEADERS);
  asegura('PARTE_ACTIVIDADES', PARTE_ACTIVIDADES_HEADERS);
  const items=asegura('PARTE_ITEMS', PARTE_ITEMS_HEADERS);   // D174
  // D178: `item` de PARTE_ITEMS y `centro_coste` de PARTE_CC en formato TEXTO para que un «02.10» tecleado
  // o importado no se vuelva 2.1 (lo ya convertido lo repara parteNormItem_/parteNormCC_ al leer).
  parteColumnaTexto_(items, 'item'); parteColumnaTexto_(cc, 'centro_coste');
  const ban=getSheet('PARTE_BANDEJA', PARTE_BANDEJA_HEADERS);   // esquema fijo: auto-sana el encabezado
  parteFormatoTexto_(ban, 2, Math.max(ban.getMaxRows()-1, 1));    // texto en nº de parte / horas / código
  // pseudo-CC en la hoja (el código los ofrece igual; aquí es para que se VEAN y se puedan describir)
  invalidarHoja_('PARTE_CC');
  const existentes={}; readSheet('PARTE_CC').forEach(function(r){ existentes[normTexto(r.centro_coste)]=1; });
  const h=leerRango_(cc,1,1,1,cc.getLastColumn())[0].map(function(k){ return String(k==null?'':k).trim(); });
  const nuevas=PARTE_CC_PSEUDO.filter(function(p){ return !existentes[normTexto(p.centro_coste)]; })
    .map(function(p){ return h.map(function(k){ return k==='centro_coste'?p.centro_coste : k==='descripcion_cc'?p.descripcion_cc : k==='activo'?'SI' : ''; }); });
  if(nuevas.length){ ensureRows_(cc, nuevas.length); cc.getRange(cc.getLastRow()+1,1,nuevas.length,h.length).setValues(nuevas); invalidarHoja_('PARTE_CC'); }
  Logger.log('setupParte: hojas PARTE_EQUIPOS · PARTE_OPERADORES · PARTE_CC (+'+nuevas.length+' pseudo-CC) · PARTE_ACTIVIDADES · PARTE_ITEMS · PARTE_BANDEJA listas. '
    + 'Ahora importa los CSV de backend/seeds/parte/ (Reemplazar hoja actual) y vuelve a correr setupParte().');
  return 'ok';
}
// Formato de texto (@) en toda una columna, localizada por su nombre de encabezado. Sin la columna no hace nada.
function parteColumnaTexto_(sh, nombre){
  try{
    const nCols=Math.max(sh.getLastColumn(),1);
    const h=leerRango_(sh,1,1,1,nCols)[0].map(function(k){ return String(k==null?'':k).trim(); });
    const j=h.indexOf(nombre); if(j<0) return;
    sh.getRange(2, j+1, Math.max(sh.getMaxRows()-1,1), 1).setNumberFormat('@');
  }catch(err){ /* sin formato no se rompe nada */ }
}

/* ============ D178 — depuración de operadores (se ejecuta A MANO desde el editor) ============
 * depurarOperadoresParte(false) → solo INFORMA (Logger) qué haría. depurarOperadoresParte(true) → aplica:
 *   1) PARTE_OPERADORES: cada variante de PARTE_OPERADORES_ALIAS queda `activo=NO` (no se borra) y, si el
 *      canónico no existe, se añade activo con la suma de `partes_ult_4_meses`.
 *   2) PARTE_BANDEJA: la columna `operador` de las filas con una variante pasa al canónico (histórico
 *      coherente; el Excel ya recibió lo suyo, esto solo afecta lo que se copie de aquí en adelante).
 * El código ya aplica los alias al leer y al recibir (parteOperadorCanon_), así que esto es orden en la
 * hoja, no una condición para que funcione. Idempotente. */
function depurarOperadoresParte(aplicar){
  const ss=ss_(), log=[];
  const sh=ss.getSheetByName('PARTE_OPERADORES'); if(!sh || sh.getLastRow()<2) return 'PARTE_OPERADORES vacía';
  const nCols=sh.getLastColumn(), n=sh.getLastRow()-1;
  let h=leerRango_(sh,1,1,1,nCols)[0].map(function(k){ return String(k==null?'':k).trim(); });
  if(h.indexOf('activo')<0){ if(aplicar){ ensureCols_(sh, nCols+1); sh.getRange(1,nCols+1).setValue('activo'); } h=h.concat(['activo']); }
  const cOp=h.indexOf('operador')+1, cAct=h.indexOf('activo')+1, cN=h.indexOf('partes_ult_4_meses')+1;
  const datos=leerRango_(sh,2,1,n,Math.max(nCols,h.length));
  const canon={}; datos.forEach(function(r,i){ const nm=parteTexto_(r[cOp-1]); if(nm && !PARTE_OPERADORES_ALIAS[normTexto(nm)]) canon[normTexto(nm)]=i+2; });
  const faltan={};
  datos.forEach(function(r,i){
    const nm=parteTexto_(r[cOp-1]), c=PARTE_OPERADORES_ALIAS[normTexto(nm)]; if(!nm || !c) return;
    log.push('variante «'+nm+'» → «'+c+'» (activo=NO)');
    if(aplicar && cAct) sh.getRange(i+2, cAct).setValue('NO');
    if(!canon[normTexto(c)]){ faltan[normTexto(c)]=faltan[normTexto(c)]||{ nombre:c, usos:0 }; faltan[normTexto(c)].usos+=parteNum_(r[cN-1])||0; }
  });
  Object.keys(faltan).forEach(function(k){
    log.push('canónico «'+faltan[k].nombre+'» no existía: se añade activo');
    if(aplicar){ const fila=h.map(function(col){ return col==='operador'?faltan[k].nombre : col==='partes_ult_4_meses'?faltan[k].usos : col==='activo'?'SI' : ''; }); ensureRows_(sh,1); sh.getRange(sh.getLastRow()+1,1,1,fila.length).setValues([fila]); }
  });
  // histórico de PARTE_BANDEJA
  const ban=ss.getSheetByName('PARTE_BANDEJA');
  if(ban && ban.getLastRow()>=2){
    const hb=leerRango_(ban,1,1,1,ban.getLastColumn())[0].map(function(k){ return String(k==null?'':k).trim(); });
    const cB=hb.indexOf('operador')+1;
    if(cB){
      const col=leerRango_(ban,2,cB,ban.getLastRow()-1,1); let cambios=0;
      col.forEach(function(r,i){ const nm=parteTexto_(r[0]), c=PARTE_OPERADORES_ALIAS[normTexto(nm)]; if(!nm || !c) return; cambios++; if(aplicar) ban.getRange(i+2,cB).setValue(c); });
      log.push('PARTE_BANDEJA: '+cambios+' fila(s) con variante → canónico');
    }
  }
  if(aplicar){ invalidarHoja_('PARTE_OPERADORES'); invalidarHoja_('PARTE_BANDEJA'); }
  const txt=(aplicar?'APLICADO':'SIMULACIÓN (llama depurarOperadoresParte(true) para aplicar)')+'\n'+log.join('\n');
  Logger.log(txt); return txt;
}
