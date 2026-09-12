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
 *   GET  ?mod=parte&op=base&desde=&hasta=        TOKEN    → aprobados del rango + filas en orden Excel
 *
 * Los dos públicos se despachan ANTES de la puerta de sesión de D109 (como `tablero`, D161): el
 * operador no tiene usuario. Lo público solo puede CREAR filas `pendiente` (nunca edita, borra ni
 * aprueba) y solo LEE catálogos (equipo, operadores, CC, sugerencias): nada de personas ni claves.
 *
 * Invariantes heredadas: fechas por duck-typing (fdate), nunca instanceof Date; POST text/plain;
 * toda escritura pasa por ensureRows_ (D93); toda lectura por leerRango_ (D107, `_celdas`).
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
const PARTE_ROLES_REVISAN = ['admin','encargado','residente','parte_maquinaria'];
// Topes por medidor: `bloquea` rechaza el envío (también lo bloquea el cliente); `alerta` marca
// TOTAL_ALTO para que lo mire quien revisa.
const PARTE_TOPES = { HOROMETRO:{ bloquea:24, alerta:12, unidad:'h' }, KM:{ bloquea:700, alerta:400, unidad:'km' } };
const PARTE_DIAS_CC_RECIENTE = 30;    // ventana del historial para CC_INUSUAL
const PARTE_MAX_DIAS_BASE   = 186;    // tope del rango de la vista Base (mismo que ausencias/persona)
const PARTE_ESTADOS = ['pendiente','aprobado','descartado'];

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
function parteEquiposActivos_(){
  const m=parteEquipos_();
  return Object.keys(m).map(function(k){ return m[k]; }).filter(function(q){ return q.activo; })
    .sort(function(a,b){ return a.codigo<b.codigo?-1:a.codigo>b.codigo?1:0; });
}
function parteOperadores_(){
  const vistos={}, out=[];
  readSheet('PARTE_OPERADORES').forEach(function(r){
    const n=parteTexto_(r.operador); if(!n || !parteSiNo_(r.activo, true)) return;
    const k=normTexto(n); if(vistos[k]) return; vistos[k]=1; out.push(n);
  });
  return out.sort(function(a,b){ return normTexto(a)<normTexto(b)?-1:1; });
}
function parteCC_(){
  const vistos={}, out=[];
  readSheet('PARTE_CC').forEach(function(r){
    const cc=parteTexto_(r.centro_coste); if(!cc || !parteSiNo_(r.activo, true)) return;
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
const PARTE_COLS_CLAVE = ['id_registro','estado','fecha','codigo','final','hora_de','hora_a','centro_coste','timestamp'];
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

// Último `final` registrado del equipo (filas no descartadas; la más reciente por fecha, hora_a y
// timestamp). Respaldo: `ultimo_final_manual`/`ultimo_final` de PARTE_EQUIPOS (arranque del primer día).
function parteUltimoFinal_(equipo){
  const cod=parteNormCod_(equipo.codigo);
  let mejor=null;
  parteCols_('PARTE_BANDEJA', PARTE_COLS_CLAVE).forEach(function(r){
    if(parteNormCod_(r.codigo)!==cod || parteEstadoDe_(r)==='descartado') return;
    const fin=parteNum_(r.final); if(fin===null) return;
    const ts = (r.timestamp && typeof r.timestamp==='object' && typeof r.timestamp.getTime==='function') ? r.timestamp.getTime() : 0;
    const cand={ final:fin, fecha:r.fecha, hora_a:parteHoraStr_(r.hora_a), min:parteHoraMin_(r.hora_a), ts:ts, id_registro:parteTexto_(r.id_registro), origen:'bandeja' };
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
  const lista=parteEquiposActivos_().map(function(q){ return { codigo:q.codigo, tipo:q.tipo, placa:q.placa }; });
  if(!eq) return json({ ok:true, equipo:null, equipos:lista, hoy:parteHoy_() });
  const q=mapa[parteNormCod_(eq)];
  if(!q) return json({ ok:false, error:'El código «'+eq+'» no está en la hoja PARTE_EQUIPOS. Elige tu equipo en la lista o avisa a maquinaria.', equipos:lista, hoy:parteHoy_() });
  const ultimo=parteUltimoFinal_(q);
  return json({ ok:true,
    equipo:{ codigo:q.codigo, tipo:q.tipo, placa:q.placa, proveedor:q.proveedor, medidor:q.medidor, activo:q.activo },
    ultimo:ultimo, operadores:parteOperadores_(), cc:parteCC_(), sugerencias:parteSugerencias_(q.tipo),
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
      if(!parteTexto_(rep[j].centro_coste)) return { error:'Tramo '+n+': el reparto tiene un centro de coste vacío. No se guardó nada.' };
      if(pct===null || pct<=0) return { error:'Tramo '+n+': cada centro de coste del reparto necesita un porcentaje mayor que 0. No se guardó nada.' };
      suma+=pct;
    }
    if(Math.abs(suma-100)>0.5) return { error:'Tramo '+n+': los porcentajes del reparto suman '+parteRedondea_(suma)+' % y deben sumar 100 %. No se guardó nada.' };
    const ini=parteNum_(t.inicial), fin=parteNum_(t.final);
    const total=(ini!==null && fin!==null) ? fin-ini : null;
    const mDe=parteHoraMin_(t.hora_de), mA=parteHoraMin_(t.hora_a), conHoras=(mDe>=0 && mA>=0 && mA>mDe);
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
 * Solo CREA filas `pendiente`. `origen` manual solo con sesión de revisor (panel "+ Agregar manual");
 * sin sesión válida se fuerza `qr`. Cada tramo = 1 fila. Valida lo que bloquea (mismas reglas que el
 * cliente) y calcula total, uf (si viene vacía) y alertas. */
function parteReporte(body, ses){
  const mapa=parteEquipos_(), cod=parteTexto_(body.codigo);
  const q=mapa[parteNormCod_(cod)];
  if(!q) return json({ ok:false, error:'El código de equipo «'+cod+'» no está en PARTE_EQUIPOS. No se guardó nada.' });
  const crudos=Array.isArray(body.tramos) ? body.tramos : (body.tramo ? [body.tramo] : []);
  if(!crudos.length) return json({ ok:false, error:'El parte llegó sin tramos. No se guardó nada.' });
  const exp=parteExpandirReparto_(crudos);
  if(exp.error) return json({ ok:false, error:exp.error });
  const tramos=exp.tramos;
  const revisor = !!(ses && ses.ok && parteAutoriza_(ses));
  const origen = (parteTexto_(body.origen).toLowerCase()==='manual' && revisor) ? 'manual' : 'qr';
  const hoy=parteHoy_();
  const ccValidos={}; parteCC_().forEach(function(c){ ccValidos[normTexto(c.centro_coste)]=c; });
  const tope=PARTE_TOPES[q.medidor] || null;

  // Historial del equipo, leído UNA vez: último final, duplicados y CC de los últimos 30 días.
  const hist=parteCols_('PARTE_BANDEJA', PARTE_COLS_CLAVE).filter(function(r){ return parteNormCod_(r.codigo)===parteNormCod_(q.codigo); });
  const ultimo=parteUltimoFinal_(q);
  const idsEx={}; hist.forEach(function(r){ const id=parteTexto_(r.id_registro); if(id) idsEx[id]=1; });
  const ccRecientes={}; let hayHistorialCC=false;
  hist.forEach(function(r){
    if(parteEstadoDe_(r)==='descartado' || !r.fecha) return;
    const cc=normTexto(r.centro_coste); if(!cc || parteEsPseudoCC_(cc)) return;
    hayHistorialCC=true;
    if(r.fecha>=parteFechaMasDias_(hoy, -PARTE_DIAS_CC_RECIENTE)) ccRecientes[cc]=1;
  });

  const sh=getSheet('PARTE_BANDEJA', PARTE_BANDEJA_HEADERS), ts=new Date();
  const filas=[], salida=[]; let duplicadas=0;
  let finalPrevio = ultimo ? ultimo.final : null;   // el 2º tramo del mismo envío se compara con el 1º
  for(let i=0;i<tramos.length;i++){
    const t=tramos[i]||{}, n=i+1;
    const fecha=fdateValida_(t.fecha);
    if(!fecha) return json({ ok:false, error:'Tramo '+n+': la fecha llegó vacía o no se entiende. No se guardó nada.' });
    if(fecha>hoy) return json({ ok:false, error:'Tramo '+n+': la fecha no puede ser futura. No se guardó nada.' });
    const reporte=parteTexto_(t.reporte_num), operador=parteTexto_(t.operador), cc=parteTexto_(t.centro_coste);
    if(!reporte)  return json({ ok:false, error:'Tramo '+n+': falta el número del parte físico. No se guardó nada.' });
    if(!operador) return json({ ok:false, error:'Tramo '+n+': falta el operador. No se guardó nada.' });
    if(!cc)       return json({ ok:false, error:'Tramo '+n+': falta el centro de coste. No se guardó nada.' });
    const ini=parteNum_(t.inicial), fin=parteNum_(t.final);
    const sinMedidor = !q.medidor;
    if(!sinMedidor && (ini===null || fin===null)) return json({ ok:false, error:'Tramo '+n+': faltan el medidor inicial o final. No se guardó nada.' });
    let total='';
    if(ini!==null && fin!==null){
      if(fin<ini) return json({ ok:false, error:'Tramo '+n+': el medidor final ('+fin+') es menor que el inicial ('+ini+'). No se guardó nada.' });
      total=parteRedondea_(fin-ini);
      if(tope && total>tope.bloquea) return json({ ok:false, error:'Tramo '+n+': el total ('+total+' '+tope.unidad+') supera el máximo de '+tope.bloquea+' '+tope.unidad+' en un día. Revisa el medidor. No se guardó nada.' });
    }
    const hDe=parteHoraStr_(t.hora_de), hA=parteHoraStr_(t.hora_a);
    const uf = parteTexto_(t.uf) || parteUF_(cc);
    const alertas=[];
    if(ini!==null && finalPrevio!==null && finalPrevio!==undefined && Math.abs(ini-finalPrevio)>0.001) alertas.push('INICIAL_DISTINTO');
    if(tope && total!=='' && total>tope.alerta) alertas.push('TOTAL_ALTO');
    const dup = !!hDe && (hist.some(function(r){ return parteEstadoDe_(r)!=='descartado' && r.fecha===fecha && parteHoraStr_(r.hora_de)===hDe; })
             || filas.some(function(f){ return f[3]===fecha && parteHoraStr_(f[15])===hDe; }));
    if(dup) alertas.push('DUPLICADO');
    if(!parteEsPseudoCC_(cc) && hayHistorialCC && !ccRecientes[normTexto(cc)]) alertas.push('CC_INUSUAL');
    if(q.activo && sinMedidor) alertas.push('SIN_MEDIDOR');
    if(!ccValidos[normTexto(cc)]) alertas.push('CC_DESCONOCIDO');

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
  return PARTE_ROLES_REVISAN.indexOf(String(ses.rol||'').trim().toLowerCase())>=0;
}
function parteSinPermiso_(){ return json({ ok:false, error:'Tu usuario no revisa partes de maquinaria (roles: '+PARTE_ROLES_REVISAN.join(', ')+').' }); }

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
  const faltantes=parteEquiposActivos_().filter(function(q){ return !conParte[parteNormCod_(q.codigo)]; })
    .map(function(q){ return { codigo:q.codigo, tipo:q.tipo, placa:q.placa, medidor:q.medidor, ultimo:parteUltimoFinal_(q) }; });
  return json({ ok:true, fecha:fecha, pendientes:pendientes, revisadas:revisadas, faltantes:faltantes,
    listas:{ operadores:parteOperadores_(), cc:parteCC_(), equipos:parteEquiposActivos_().map(function(q){ return { codigo:q.codigo, tipo:q.tipo, placa:q.placa, medidor:q.medidor }; }) },
    topes:PARTE_TOPES });
}

// POST {mod:'parte', op:'revisar', cambios:[{id_registro, estado?, campos?:{...}}]}
// Escritura QUIRÚRGICA: localiza cada fila por id_registro (columna id, N×1), lee ESA fila, mezcla y
// reescribe solo esa fila. Nunca se borra ni se reordena la hoja. `total` y `uf` se recalculan si
// cambian inicial/final o el CC; las alertas se conservan (son el registro de lo que llegó).
const PARTE_CAMPOS_EDITABLES = ['fecha','reporte_num','inicial','final','horas_varada','horas_lluvia','hora_de','hora_a',
  'descripcion_trabajo','centro_coste','pr','uf','operador','observaciones'];
function parteRevisar(body, ses){
  if(!parteAutoriza_(ses)) return parteSinPermiso_();
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
    const campos=c.campos||{}; let tocado=false, malo='';
    PARTE_CAMPOS_EDITABLES.forEach(function(k){
      if(malo || !campos.hasOwnProperty(k)) return;
      let val=campos[k];
      if(k==='fecha'){ val=fdateValida_(val); if(!val){ malo='fecha inválida'; return; } }
      else if(k==='hora_de'||k==='hora_a') val=parteHoraStr_(val);
      else if(k==='inicial'||k==='final'||k==='horas_varada'||k==='horas_lluvia'||k==='pr'){ const n=parteNum_(val); val= n===null ? '' : n; }
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
  if(op==='equipo') return parteEquipo(e);                      // público
  const ses=sesion_(e, null);                                   // D109
  if(!ses.ok) return json({ ok:false, auth:false, error:ses.error });
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
  const ses=sesion_(e, body);
  if(!ses.ok) return json({ ok:false, auth:false, error:ses.error });
  if(ses.usuario) body.usuario=ses.usuario;
  if(op==='revisar') return parteRevisar(body, ses);
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
  const ban=getSheet('PARTE_BANDEJA', PARTE_BANDEJA_HEADERS);   // esquema fijo: auto-sana el encabezado
  parteFormatoTexto_(ban, 2, Math.max(ban.getMaxRows()-1, 1));    // texto en nº de parte / horas / código
  // pseudo-CC en la hoja (el código los ofrece igual; aquí es para que se VEAN y se puedan describir)
  invalidarHoja_('PARTE_CC');
  const existentes={}; readSheet('PARTE_CC').forEach(function(r){ existentes[normTexto(r.centro_coste)]=1; });
  const h=leerRango_(cc,1,1,1,cc.getLastColumn())[0].map(function(k){ return String(k==null?'':k).trim(); });
  const nuevas=PARTE_CC_PSEUDO.filter(function(p){ return !existentes[normTexto(p.centro_coste)]; })
    .map(function(p){ return h.map(function(k){ return k==='centro_coste'?p.centro_coste : k==='descripcion_cc'?p.descripcion_cc : k==='activo'?'SI' : ''; }); });
  if(nuevas.length){ ensureRows_(cc, nuevas.length); cc.getRange(cc.getLastRow()+1,1,nuevas.length,h.length).setValues(nuevas); invalidarHoja_('PARTE_CC'); }
  Logger.log('setupParte: hojas PARTE_EQUIPOS · PARTE_OPERADORES · PARTE_CC (+'+nuevas.length+' pseudo-CC) · PARTE_ACTIVIDADES · PARTE_BANDEJA listas. '
    + 'Ahora importa los CSV de backend/seeds/parte/ (Reemplazar hoja actual) y vuelve a correr setupParte().');
  return 'ok';
}
