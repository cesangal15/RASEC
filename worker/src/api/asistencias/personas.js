/**
 * api/asistencias/personas.js — identidad de personas, jornada y helpers de forma de ASISTENCIAS
 * (4.01 · Fase 3 · D180).
 *
 * Es el conjunto de helpers PUROS de backend/CodigoAsistencias.gs que deciden «quién es la misma persona»
 * (D118/D123/D126), la jornada estándar del día (D72/D77), el proyecto del CC (D101) y las constantes de
 * forma que comparten lectura y escritura. Mismos nombres y MISMA lógica que el .gs: son negocio, no
 * capa de datos, así que se copian verbatim (solo `norm`/`fdate` se importan de comun.js).
 *
 * Ninguna de estas funciones toca la BD: se aplican en JS sobre las filas del día (que la capa de
 * escritura bloquea con FOR UPDATE) o sobre los catálogos ya leídos. El esquema NO tiene UNIQUE por
 * persona/día a propósito (hay duplicados históricos, D119–D128): el emparejador decide en memoria.
 */
import { norm, fdate } from '../../comun.js';

/* ======================================================================================================
 * Constantes de FORMA (CodigoAsistencias.gs L84, L1789–L1790) — las usan lectura y escritura.
 * ====================================================================================================== */
// L84 — orden de las columnas de la tabla `asistencia` y de las filas `nuevas` de guardarAsistencia/guardarIndividual.
export const ASISTENCIA_HEADERS = ['id_registro','timestamp','fecha','reporta','cuadrilla','codigo','cedula','nombre',
  'cargo','cc','proyecto','hora_entrada','hora_salida','presente','motivo_ausencia','observacion','turno'];
// L1789 — columnas compactadas de `filas` en asistenciaDia (el caso de contrato compara este orden exacto, D133d).
export const COLS_FILAS = ['_row','fecha','reporta','cuadrilla','codigo','cedula','nombre','cargo','cc','proyecto',
  'hora_entrada','hora_salida','presente','motivo_ausencia','turno'];
// L1790 — columnas compactadas de `faltantes` (mezcla ausentes con `motivo` y sin-reportar con `incompleto`).
export const COLS_FALTANTES = ['codigo','cedula','nombre','cargo','cuadrilla','responsable','tipo','motivo','incompleto'];

/* ======================================================================================================
 * Identidad de persona (CodigoAsistencias.gs L1338–L1391, L2013–L2016)
 * ====================================================================================================== */
// L1338 clavePersona_ — código si lo tiene, si no la cédula ('COD:x' | 'CED:x').
export function clavePersona_(p){
  const c=String((p&&p.codigo)||'').trim();
  return c ? ('COD:'+c) : ('CED:'+String((p&&p.cedula)||'').trim());
}
/* L1356–L1381 emparejadorDePersonas_ — predicado «¿esta fila guardada es de alguna de las personas que
 * llegan?» (D123/D126). El CÓDIGO manda (normalizado sin espacios ni ceros a la izquierda); la cédula solo
 * si falta el código; nombre+cuadrilla como último respaldo. Protege a ALEIXER/FREDY (cédula compartida). */
export function emparejadorDePersonas_(incoming){
  const cods={}, cedsSinCod={}, cedsConCod={}, noms={};
  function normCod(v){ return String(v==null?'':v).trim().replace(/^0+/, ''); }
  function claveNombre(o){
    const n=norm(o&&o.nombre), c=norm(o&&o.cuadrilla);
    return n ? (n+'|'+c) : '';
  }
  (incoming||[]).forEach(function(f){
    const c=normCod(f.codigo), d=String(f.cedula||'').trim();
    if(c){ cods[c]=true; if(d) cedsConCod[d]=true; }
    else if(d) cedsSinCod[d]=true;
    else { const n=claveNombre(f); if(n) noms[n]=true; }
  });
  return function(o){
    const c=normCod(o.codigo), d=String(o.cedula||'').trim();
    if(c) return !!cods[c] || (!!d && !!cedsSinCod[d]);
    if(d) return !!cedsSinCod[d] || !!cedsConCod[d];
    const n=claveNombre(o); return !!n && !!noms[n];
  };
}
// L1383–L1391 unicasPorPersona_ — primera fila de cada persona, conservando el orden. Sin código NI cédula: no agrupa.
export function unicasPorPersona_(lista){
  const vistos={}, out=[];
  (lista||[]).forEach(function(p){
    const k=clavePersona_(p);
    if(k==='COD:' || k==='CED:'){ out.push(p); return; }
    if(!vistos[k]){ vistos[k]=true; out.push(p); }
  });
  return out;
}
// L2013–L2016 keyPersona — misma clave que clavePersona_ pero desde (codigo, cedula) sueltos (faltantes/ausencias).
export function keyPersona(codigo, cedula){
  const c=String(codigo||'').trim();
  return c ? ('COD:'+c) : ('CED:'+String(cedula||'').trim());
}

/* ======================================================================================================
 * Roster date-aware (CodigoAsistencias.gs L1296–L1307)
 * ====================================================================================================== */
/* L1296 activaEnFecha — «se esperaba» a la persona en `fecha`: ventana [fecha_ingreso, fecha_retiro).
 * Sin fecha_retiro cae al `estado` actual. Comparación de strings 'yyyy-MM-dd' (lexicográfico=cronológico). */
export function activaEnFecha(p, fecha){
  const ing=fdate(p.fecha_ingreso), ret=fdate(p.fecha_retiro);
  if(ing && fecha && fecha < ing) return false;   // aún no ingresaba ese día
  if(ret) return !(fecha && fecha >= ret);         // retiro con fecha: activa antes de esa fecha
  return String(p.estado||'activo')!=='inactivo';  // sin fecha de retiro: usa el estado actual
}
// L1307 esEventual — personal EVENTUAL (D85): fuera del día a día; solo 'eventual' lo marca.
export function esEventual(p){ return norm(p.estado)==='eventual'; }

/* ======================================================================================================
 * Jornada del día y proyecto (CodigoAsistencias.gs L1412–L1437)
 * ====================================================================================================== */
// L1412 tipoJornada — 'lv' (lunes-viernes) · 'sabado' · 'domfest' (domingo o festivo).
export function tipoJornada(fecha, festivos){
  const d=String(fecha||'').split('-');
  if(d.length<3) return 'lv';
  const dt=new Date(Number(d[0]), Number(d[1])-1, Number(d[2]));
  const dow=dt.getDay(); // 0=domingo..6=sabado
  if((festivos||[]).indexOf(fecha)>=0) return 'domfest';
  if(dow===0) return 'domfest';
  if(dow===6) return 'sabado';
  return 'lv';
}
// L1423 jornadaDelDia — entrada/salida por defecto + tope de ordinarias según CONFIG y el tipo de día (D77).
export function jornadaDelDia(fecha, cfg, festivos){
  const tipo=tipoJornada(fecha, festivos);
  if(tipo==='sabado') return { tipo, entrada:cfg.entrada_sab||'07:00', salida:cfg.salida_sab||'11:30', tope:parseFloat(cfg.ord_sabado)||4.5 };
  if(tipo==='domfest') return { tipo, entrada:cfg.entrada_dom||'07:00', salida:cfg.salida_dom||'15:00', tope:parseFloat(cfg.ord_domingo)||0 };
  return { tipo, entrada:cfg.entrada_lv||'07:00', salida:cfg.salida_lv||'15:30', tope:parseFloat(cfg.ord_lun_vie)||7.5 };
}
// L1433 proyectoFromCC — los 4 primeros dígitos del CC ('3703.02.05| …' → '3703'); genérico (D101).
export function proyectoFromCC(cc){
  const s=String(cc||'').trim();
  const m=s.match(/^(\d{4})/);
  return m ? m[1] : '';
}

/* ======================================================================================================
 * Rangos de fechas (CodigoAsistencias.gs L1110–L1116, L1997–L2011)
 * ====================================================================================================== */
export const MAX_DIAS_RANGO = 186;   // L1997 · ~6 meses: tope defensivo de ausencias/persona/persona_admin
// L1110 diasEntre_ — nº de días de calendario que abarca [desde, hasta] (ambos inclusive); rango vacío/inválido = 0.
export function diasEntre_(desde, hasta){
  if(!desde || !hasta || hasta < desde) return 0;
  const a=String(desde).split('-'), b=String(hasta).split('-');
  const d1=new Date(Number(a[0]), Number(a[1])-1, Number(a[2]));
  const d2=new Date(Number(b[0]), Number(b[1])-1, Number(b[2]));
  return Math.round((d2-d1)/86400000)+1;
}
// L2001 diasDelRango — lista de 'yyyy-MM-dd' entre desde y hasta (inclusive). Date local (Bogotá sin DST), nunca toISOString (D50).
export function diasDelRango(desde, hasta){
  const p=String(desde).split('-'), out=[];
  let d=new Date(Number(p[0]), Number(p[1])-1, Number(p[2])), guard=0;
  while(guard++ <= MAX_DIAS_RANGO+1){
    const s=d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
    if(s>hasta) break;
    out.push(s);
    d.setDate(d.getDate()+1);
  }
  return out;
}

/* ======================================================================================================
 * Compactación de listas (CodigoAsistencias.gs L1808–L1822) — D133/D133d
 * ====================================================================================================== */
// L1808 compactar_ — lista de objetos → {cols, datos}. Columnas explícitas; lo ausente viaja como null.
export function compactar_(lista, cols){
  return { cols: cols, datos: (lista||[]).map(function(o){
    return cols.map(function(k){ const v=o[k]; return v===undefined ? null : v; });
  }) };
}
// L1813–L1822 firmaLista_ — firma barata y estable de una lista de strings (n-len-hash×31); detecta reorden. NO criptográfica.
export function firmaLista_(arr){
  var n=arr.length, len=0, h=0;
  for(var i=0;i<n;i++){
    var s=String(arr[i]); len+=s.length;
    for(var j=0;j<s.length;j++) h=(h*31 + s.charCodeAt(j)) % 2147483647;
  }
  return n+'-'+len+'-'+h;
}
