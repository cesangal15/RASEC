/**
 * api/obra/maquinaria.js — panel de PRODUCCIÓN de maquinaria (2.4 / D55 / D59 / D60 / D62) de OBRA
 * portado al Worker (4.01 · Fase 4 · D180).
 *
 * Es backend/Codigo.gs L2252–L2403 (con bucketDeMaqRow L2158, bucketDeData L2167, MAQ_PROD_CC L1498,
 * MAQ_BUCKETS L1501, MAQ_COMPLEM L1517) con los MISMOS nombres de función y el MISMO contrato, pero
 * contra las tablas `data`, `bandeja`, `maquinaria` y la flota (`maquinas`, vía flotaEnFecha_) en vez de
 * las hojas DATA / BANDEJA / MAQUINARIA / MAQUINAS:
 *
 *   GET  ?action=maquinaria_produccion&fecha=   TOKEN → maquinariaProduccion: panel del día (frentes
 *          ajustables con su volumen oficial de la chequeadora, D55; máquinas productivas «otras» en
 *          lectura; flota vigente y faltantes, D61/D138). Cualquier token (residente/admin editan, jefe
 *          y demás en lectura).
 *   POST {action:'maquinaria_produccion', fecha, ajustes:[], nuevas:[]}  TOKEN (MAQPROD_ROLES_ESCRIBEN,
 *          D139) → maquinariaProduccionGuardar: parcha `produccion` (col T) de filas existentes guardando
 *          el estimado del capataz en `produccion_capataz_orig` la 1ª vez (D55), y crea filas nuevas para
 *          redirigir producción huérfana (D60), registrar complementarias (D62) o solo horas (D61).
 *
 * Qué cambia respecto al .gs y por qué:
 *   · Sustituye filasCrudasPorFecha_/readSheetPorFecha_ por tres SELECT por fecha (DATA, BANDEJA,
 *     MAQUINARIA) + flotaEnFecha_(c, fecha). Toda la lógica de buckets, prefill (D62), multi-actividad
 *     (D46), presentes/faltantes (D61) y la forma de la respuesta se conservan IDÉNTICAS.
 *   · `produccion`/`produccion_capataz_orig`/`horas_operadas` llegan como Number|null (numeric, db.js).
 *     Los chequeos `(v===''||v==null)?'':v` del .gs ya cubren el null, así que NULL → '' tal cual pedía
 *     la pantalla (produccion_actual/produccion_orig/horas comparan con '').
 *   · La ESCRITURA (POST) es UNA transacción (sql.begin, sin lock; decisión 3/10): un UPDATE por ajuste
 *     con produccion_capataz_orig=COALESCE(produccion_capataz_orig, produccion) (reproduce «solo la 1ª
 *     vez») y RETURNING para contar `actualizadas`; un INSERT por nueva (uuid nuevo, ON CONFLICT DO
 *     NOTHING). Ya NO se lee la hoja entera de MAQUINARIA (L2339): el guard de fecha va en el WHERE.
 *   · El guard de rol/usuario (D109/D139) usa permiso_ de comun.js con la sesión de puerta_ (no body._rol).
 *     MAQPROD_ROLES_ESCRIBEN se cablea aquí igual que en el .gs (decisión 12).
 *   · fecha inválida/vacía en el GET: como el .gs (fdate del parámetro filtra por igualdad y no cruza
 *     ninguna fila real), aquí se lee con fdateValida_(fecha); si no es una fecha válida, las tres
 *     consultas quedan vacías y el panel sale vacío. La respuesta conserva `fecha` = fdate(param).
 *
 * `derivarEstado_` (Codigo.gs L146) se duplica aquí como PRIVADO: su hogar compartido es reporte.js
 * (aún no portado); ver `pendientes`. VAL_OBRA_MAQPROD/AJUSTE/NUEVA se exportan para validarPayloadObra_
 * del router (api/obra.js), que valida el payload ANTES de despachar (D166), como en el .gs (L2977).
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 */
import { OBRA_ID, json, fdate, fdateValida_, ccCorto, permiso_, logMarcar_,
         VAL_MAX_CANTIDAD, VAL_MAX_HORAS } from '../../comun.js';
import { flotaEnFecha_, esTipoSinProduccion } from '../../catalogos.js';

/* ---------- Codigo.gs L253–L255: la fecha del reporte llegó vacía o ininteligible (D106) ----------
 * Copia privada del literal (su hogar compartido es reporte.js/comun.js, aún no portado; ver pendientes). */
const ERROR_FECHA = 'La fecha del reporte llegó vacía o con un formato que no se entiende. '
  + 'Vuelve a elegir el día en el campo "Fecha" y envía otra vez. '
  + 'No se guardó nada a propósito: una fila sin fecha no aparece en la bandeja ni en el maestro.';

/* ---------- Codigo.gs L1777: quién AJUSTA la producción (guard en el SERVIDOR, D109/D139) ----------
 * Cableado, como en el .gs (decisión 12). Sin lista de usuarios sueltos: solo por rol. */
const MAQPROD_ROLES_ESCRIBEN = ['admin','residente'];

/* ---------- Codigo.gs L1498: CC (corto NN.NN) con producción ajustable (excavación/terraplén/ZODME) ---------- */
export const MAQ_PROD_CC = { '02.05':1, '02.06':1, '02.07':1, '02.08':1 };

/* ---------- Codigo.gs L1501–L1507: buckets de frente (granularidad de actividad, no solo CC) ----------
 * Separa aprovechable / no aprovechable / préstamo / terraplén / ZODME. Cada uno trae el par H/I de
 * Captura_Diaria para crear filas nuevas (D52). */
export const MAQ_BUCKETS = {
  EXC_APRO:     { cc:'02.05', h:'EXCAVACION COMUN',    i:'EXCAVACION APROVECHABLE',    label:'Excavación aprovechable',    tipo:'excavacion' },
  EXC_NOAPRO:   { cc:'02.05', h:'EXCAVACION COMUN',    i:'EXCAVACION NO APROVECHABLE', label:'Excavación no aprovechable', tipo:'excavacion' },
  EXC_PRESTAMO: { cc:'02.06', h:'EXCAVACION PRESTAMO', i:'EXCAVACION APROVECHABLE',    label:'Excavación de préstamo',     tipo:'excavacion' },
  TERRAPLEN:    { cc:'02.07', h:'TERRAPLEN',           i:'NUCLEO DE TERRAPLEN',        label:'Terraplén',                  tipo:'terraplen' },
  ZODME:        { cc:'02.08', h:'CONFORMACION',        i:'ZODME',                      label:'Conformación / ZODME',       tipo:'terraplen' }
};

/* ---------- Codigo.gs L1517–L1526: actividades complementarias SIN producción (D62) ----------
 * Cereo y apoyos que el panel puede asignar a una máquina faltante. Llevan par H/I (a_captura=SI) salvo
 * paisajeo/adecuación/derrumbe (sin par, NO a Captura). */
export const MAQ_COMPLEM = {
  CEREO_CORONA:      { h:'TERRAPLEN', i:'CEREO CORONA',         label:'Cereo de corona',           aCaptura:'SI' },
  CEREO_SUBBASE:     { h:'SUBBASE',   i:'CEREO SUBBASE',        label:'Cereo de subbase',          aCaptura:'SI' },
  COMPACT_TERRAPLEN: { h:'TERRAPLEN', i:'NUCLEO DE TERRAPLEN',  label:'Compactación de terraplén', aCaptura:'SI' },
  COMPACT_SUBBASE:   { h:'SUBBASE',   i:'CONFORMACION SUBBASE', label:'Compactación de subbase',   aCaptura:'SI' },
  COMPACT_BTC:       { h:'BASE',      i:'BTC',                  label:'Compactación de BTC',       aCaptura:'SI' },
  PAISAJEO:          { h:'',          i:'',                     label:'Paisajeo / ornato',         aCaptura:'NO' },
  ADECUACION:        { h:'',          i:'',                     label:'Adecuación de caminos',     aCaptura:'NO' },
  DERRUMBE:          { h:'',          i:'',                     label:'Limpieza de derrumbe',      aCaptura:'NO' }
};

/* ---------- Codigo.gs L2158–L2165: bucket de una fila de MAQUINARIA por su par H/I derivado ----------
 * '' = no editable (no cae en ninguno de los frentes ajustables). */
export function bucketDeMaqRow(r){
  const h=String(r.actividad||'').toUpperCase(), i=String(r.sub_actividad||'').toUpperCase();
  if(h.indexOf('EXCAVACION COMUN')>=0)    return i.indexOf('NO APRO')>=0 ? 'EXC_NOAPRO' : 'EXC_APRO';
  if(h.indexOf('EXCAVACION PRESTAMO')>=0) return 'EXC_PRESTAMO';
  if(h.indexOf('TERRAPLEN')>=0)           return 'TERRAPLEN';
  if(h.indexOf('CONFORMACION')>=0)        return 'ZODME';
  return '';
}

/* ---------- Codigo.gs L2167–L2174: bucket de una fila de DATA por su CC + descripción ----------
 * Mismo discriminante que bucketDeMaqRow (aprovechable/no aprovechable por el texto de la descripción). */
export function bucketDeData(cc, descripcion){
  const d=String(descripcion||'').toUpperCase();
  if(cc==='02.05') return d.indexOf('NO APRO')>=0 ? 'EXC_NOAPRO' : 'EXC_APRO';
  if(cc==='02.06') return 'EXC_PRESTAMO';
  if(cc==='02.07') return 'TERRAPLEN';
  if(cc==='02.08') return 'ZODME';
  return '';
}

// Codigo.gs L146–L159 — R (ESTADO) del motivo (05_CATALOGO §5, D52). Sin horas muertas → OPERANDO.
// PRIVADO aquí (su hogar compartido es reporte.js, aún no portado; ver pendientes).
function derivarEstado_(motivo, muertas){
  if(!(parseFloat(muertas)>0.01)) return 'OPERANDO';
  const m=(motivo||'').trim().toLowerCase();
  if(!m) return 'OPERANDO';
  if(m.indexOf('mantenimiento')>=0) return 'MANTENIMIENTO';
  if(m.indexOf('falla')>=0)         return 'VARADO';
  if(m.indexOf('sin operador')>=0)  return 'SIN OPERADOR';
  if(m.indexOf('lluvia')>=0 || m.indexOf('clima')>=0) return 'LLUVIAS';
  if(m.indexOf('bloqueo')>=0)       return 'BLOQUEO';
  return 'ESPERA';   // Sin frente / Esperando material / Abastecimiento / Traslado / Otro / texto libre
}

// Codigo.gs L1953–L1955 — puedeAjustarProduccion_ (permiso_ sobre la sesión del token, no body._rol).
// `jefe` → 'El jefe entra a la pantalla de Maquinaria en SOLO LECTURA…'; otros → 'Tu usuario no puede…'.
export function puedeAjustarProduccion_(ses){
  return permiso_(ses, MAQPROD_ROLES_ESCRIBEN, [], 'ajustar la producción de maquinaria');
}

/* ---------- Codigo.gs L2252–L2325: GET ?action=maquinaria_produccion&fecha= (panel del día) ---------- */
export async function maquinariaProduccion(c, params){
  const fecha=fdate((params && params.fecha) || '');   // 'yyyy-MM-dd' o '' (respuesta)
  const fq=fdateValida_(fecha);                          // fecha válida para el WHERE; '' → panel vacío

  // Codigo.gs L2255–L2258 — rango de un par de PK en el texto que muestra el panel ('a–b' o el único que haya).
  function pkRange(pki, pkf){ const a=String(pki==null?'':pki).trim(), b=String(pkf==null?'':pkf).trim();
    if(a && b && b!==a) return a+'–'+b; return a||b||''; }

  // Codigo.gs L2259–L2270 — Volúmenes y PK OFICIALES de DATA por proyecto|bucket (solo LECTURA de DATA).
  const dataVol={}, dataPk={};
  if(fq){
    const filasData=await c.sql`SELECT centro_de_costo, descripcion, proyecto, largo, pk_inicial, pk_final
      FROM data WHERE obra_id=${OBRA_ID} AND fecha=${fq}`;
    filasData.forEach(function(r){
      const cc=ccCorto(r.centro_de_costo); if(!MAQ_PROD_CC[cc]) return;
      const b=bucketDeData(cc, r.descripcion); if(!b) return;
      const key=String(r.proyecto||'')+'|'+b;
      dataVol[key]=(dataVol[key]||0)+(parseFloat(r.largo)||0);
      const pk=pkRange(r.pk_inicial, r.pk_final);
      if(pk){ (dataPk[key]=dataPk[key]||[]); if(dataPk[key].indexOf(pk)<0) dataPk[key].push(pk); }
    });
  }

  // Codigo.gs L2272 — PK del capataz por id de cantidad (BANDEJA): la fila de MAQUINARIA enlaza id_cantidad.
  const banPk={};
  if(fq){
    (await c.sql`SELECT id_registro, pk_inicial, pk_final FROM bandeja WHERE obra_id=${OBRA_ID} AND fecha=${fq}`)
      .forEach(function(r){ banPk[String(r.id_registro||'')]=pkRange(r.pk_inicial, r.pk_final); });
  }

  // Codigo.gs L2274–L2277 — todas las filas de MAQUINARIA del día (presentes) y las que generan producción.
  const todas = fq ? await c.sql`SELECT id_maquina, app_tipo_equipo, cap_actividad, actividad, sub_actividad,
      produccion, produccion_capataz_orig, app_id_registro, id_cantidad, reporta, horas_operadas, unidad_prod, proyecto
      FROM maquinaria WHERE obra_id=${OBRA_ID} AND fecha=${fq}` : [];
  const presentes={}; todas.forEach(function(r){ if(r.id_maquina) presentes[r.id_maquina]=1; });
  const producen=todas.filter(function(r){ return !esTipoSinProduccion(r.app_tipo_equipo) && String(r.cap_actividad||'')!=='APOYO'; });
  function rowLabel(r){ const b=bucketDeMaqRow(r); return b?MAQ_BUCKETS[b].label:(r.cap_actividad||r.actividad||'—'); }
  function rowHoras(r){ const ho=r.horas_operadas; return (ho===''||ho==null)?'':ho; }

  // Codigo.gs L2280–L2282 — multi-actividad (D46): todas las actividades del día por id_maquina.
  const actsPorMaq={};
  producen.forEach(function(r){ const id=r.id_maquina||''; (actsPorMaq[id]=actsPorMaq[id]||[]).push(rowLabel(r)); });

  // Codigo.gs L2284–L2298 — frentes ajustables: unión de buckets con oficial>0 y buckets con máquina presente.
  const fMap={}, fOrder=[];
  function ensureF(proy, b){ const k=proy+'|'+b;
    if(!fMap[k]){ const m=MAQ_BUCKETS[b]; fMap[k]={ proyecto:proy, bucket:b, cc:m.cc, label:m.label, tipo:m.tipo, oficial:0, _filas:[] }; fOrder.push(k); }
    return fMap[k]; }
  Object.keys(dataVol).forEach(function(k){ const p=k.slice(0,k.indexOf('|')), b=k.slice(k.indexOf('|')+1); ensureF(p,b).oficial=dataVol[k]; });
  const otras=[];
  producen.forEach(function(r){
    const b=bucketDeMaqRow(r);
    if(b){ ensureF(String(r.proyecto||''), b)._filas.push(r); }
    else { otras.push({ id_maquina:r.id_maquina||'', actividad:r.cap_actividad||r.actividad||'—',
      produccion_actual:(r.produccion===''||r.produccion==null)?'':r.produccion, unidad:r.unidad_prod||'',
      reporta:r.reporta||'', pk:banPk[String(r.id_cantidad||'')]||'', horas:rowHoras(r) }); }
  });

  // Codigo.gs L2299–L2317 — cada frente con su prefill proporcional a lo reportado (D62).
  const frentes=fOrder.map(function(k){
    const f=fMap[k], n=f._filas.length;
    const sumRep=f._filas.reduce(function(s,r){ return s+(parseFloat(r.produccion)||0); }, 0);
    const filas=f._filas.map(function(r){
      const rep=parseFloat(r.produccion)||0;
      const prefill = sumRep>0 ? Math.round(f.oficial*rep/sumRep*100)/100 : Math.round((f.oficial/(n||1))*100)/100;
      const orig=r.produccion_capataz_orig;
      const otrasAct=(actsPorMaq[r.id_maquina]||[]).filter(function(x){ return x!==f.label; });
      return { id_registro:String(r.app_id_registro||''), id_maquina:r.id_maquina||'',
        actividad:r.cap_actividad||r.actividad||f.label, tipo_equipo:r.app_tipo_equipo||'',
        produccion_actual:(r.produccion===''||r.produccion==null)?'':r.produccion,
        produccion_orig:(orig===''||orig==null)?'':orig, prefill:prefill, otras_actividades:otrasAct,
        pk:banPk[String(r.id_cantidad||'')]||'', horas:rowHoras(r) };
    });
    return { proyecto:f.proyecto, bucket:f.bucket, cc:f.cc, label:f.label, tipo:f.tipo,
      oficial:f.oficial, n_maquinas:n, pk_oficial:(dataPk[k]||[]), filas:filas };
  });

  // Codigo.gs L2318–L2324 — D138: la flota sale de MAQUINAS VIGENTE ESE DÍA (respaldo al catálogo en código).
  const fl=await flotaEnFecha_(c, fecha);
  const flota_produccion=Object.keys(fl.catalogo).filter(function(id){ return !esTipoSinProduccion(fl.catalogo[id].tipo); })
    .map(function(id){ return { id_maquina:id, tipo:fl.catalogo[id].tipo, prog:fl.catalogo[id].prog, reportada: !!presentes[id] }; });
  const faltantes=fl.esperadas.filter(function(id){ return !presentes[id]; })
    .map(function(id){ return { id_maquina:id, tipo:(fl.catalogo[id]||{}).tipo||'', prog:(fl.catalogo[id]||{}).prog||'' }; });

  return json(c, { ok:true, fecha:fecha, frentes:frentes, otras:otras, flota_produccion:flota_produccion,
                   faltantes:faltantes, flota_fuente:fl.fuente, flota_avisos:fl.avisos });
}

/* ---------- Codigo.gs L2330–L2403: POST maquinaria_produccion (ESCRIBE SOLO MAQUINARIA) ---------- */
export async function maquinariaProduccionGuardar(c, body, ses){
  // Codigo.gs L2333–L2334 — D139: el rol se comprueba en el SERVIDOR (permiso_ sobre la sesión del token).
  const permiso=puedeAjustarProduccion_(ses);
  if(!permiso.ok){ logMarcar_(c, 'rechazado', 'maqprod: '+permiso.error); return json(c, { ok:false, error:permiso.error }); }

  // Codigo.gs L2336–L2337 — D106: las filas NUEVAS de este panel llevan la fecha del payload a MAQUINARIA.
  const fecha=fdateValida_(body.fecha), ajustes=body.ajustes||[], nuevas=body.nuevas||[];
  if(!fecha) return json(c, { ok:false, error:ERROR_FECHA });

  // Codigo.gs L2345 — dedup de ajustes por id_registro (=app_id_registro); último gana, como el map del .gs.
  const map={}; ajustes.forEach(function(a){ if(a && a.id_registro!=null && a.id_registro!=='') map[String(a.id_registro)]=a; });

  // Codigo.gs L2360–L2361 — D138: flota vigente el día que se está ajustando (para crear filas nuevas).
  const catFecha=(await flotaEnFecha_(c, fecha)).catalogo;
  const ts=new Date(), reporta=body.usuario||'(ajuste-prod)';

  let upd=0, creadas=0;
  await c.sql.begin(async function(sql){
    // 1) Codigo.gs L2346–L2356 — parchar `produccion` (col T) de filas existentes del día. El estimado del
    //    capataz se conserva en produccion_capataz_orig la 1ª vez: COALESCE(orig, produccion) (RHS = valor
    //    previo de la fila). RETURNING para contar filas realmente tocadas (guard de fecha en el WHERE).
    for(const id of Object.keys(map)){
      const a=map[id];
      const pf=parseFloat(a.produccion);
      const prod=isNaN(pf) ? (a.produccion==null?'':a.produccion) : pf;
      const filas=await sql`UPDATE maquinaria
        SET produccion_capataz_orig=COALESCE(produccion_capataz_orig, produccion),
            produccion=${(prod===''||prod==null)?null:prod}
        WHERE obra_id=${OBRA_ID} AND app_id_registro=${id} AND fecha=${fecha}
        RETURNING app_id_registro`;
      upd += filas.length;
    }

    // 2) Codigo.gs L2358–L2401 — crear filas nuevas (D60 redirigir · D62 complementaria · D61 solo horas).
    for(const nv of nuevas){
      const idM=String(nv.id_maquina||'').toUpperCase(); if(!idM) continue;
      const cat=catFecha[idM]; if(!cat) continue;                    // máquina fuera de la flota de ese día: se ignora
      const b  = nv.bucket  ? MAQ_BUCKETS[nv.bucket]  : null;  if(nv.bucket  && !b)  continue;
      const cx = nv.complem ? MAQ_COMPLEM[nv.complem] : null;  if(nv.complem && !cx) continue;
      const H = b?b.h:(cx?cx.h:''), I = b?b.i:(cx?cx.i:'');
      const aCap = b?'SI':(cx?cx.aCaptura:'NO'), capLabel = b?b.label:(cx?cx.label:'');
      // producción: solo en frente y si la máquina genera producción (vibros/minis nunca, D41/D44).
      let prod='';
      if(b && !esTipoSinProduccion(cat.tipo)){ const pf=parseFloat(nv.produccion); prod=isNaN(pf)?'':pf; }
      const ho=parseFloat(nv.horas);
      const horasOper = isNaN(ho) ? '' : ho;
      const motivo = String(nv.motivo||'');
      const muertas = (horasOper==='') ? '' : Math.round(Math.max(0, (parseFloat(cat.prog)||0) - horasOper)*100)/100;
      const estado  = (horasOper==='') ? 'OPERANDO' : derivarEstado_(motivo, muertas);
      const esMant  = motivo.trim().toLowerCase().indexOf('mantenimiento')>=0;
      const hMant   = (esMant && horasOper!=='') ? muertas : '';    // O horas_mantenimiento (D52)
      if(!b && !cx && horasOper==='') continue;                     // nada que registrar
      const obs = b ? 'Producción redirigida (panel)' : cx ? ('Complementaria: '+capLabel+' (panel)') : 'Horas registradas (panel)';
      await sql`INSERT INTO maquinaria (obra_id, fecha, proyecto, id_maquina, operador,
          actividad, sub_actividad, horas_operadas, horas_mantenimiento, estado, produccion, observacion,
          app_id_registro, id_cantidad, "timestamp", reporta, app_tipo_equipo, app_horas_programadas,
          app_horas_muertas, motivo, unidad_prod, cap_actividad, a_captura, produccion_capataz_orig, area)
        VALUES (${OBRA_ID}, ${fecha}, ${String(nv.proyecto||'')}, ${idM}, ${String(nv.operador||'')},
          ${H}, ${I}, ${horasOper===''?null:horasOper}, ${hMant===''?null:hMant}, ${estado}, ${prod===''?null:prod}, ${obs},
          ${crypto.randomUUID()}, '', ${ts}, ${reporta}, ${cat.tipo}, ${(parseFloat(cat.prog)||0)},
          ${muertas===''?null:muertas}, ${motivo}, ${(prod===''?'':'m3')}, ${capLabel}, ${aCap}, ${null}, '')
        ON CONFLICT (obra_id, app_id_registro) DO NOTHING`;
      creadas++;
    }
  });

  return json(c, { ok:true, actualizadas:upd, creadas:creadas });
}

/* ---------- Codigo.gs L2954–L2957: esquemas de validación del payload (D166), para validarPayloadObra_ ----------
 * El router (api/obra.js) los aplica ANTES de despachar (VAL_MAX_CANTIDAD/VAL_MAX_HORAS de comun.js). */
export const VAL_OBRA_MAQPROD = { fecha:['f',0], ajustes:['a'], nuevas:['a',300] };
export const VAL_OBRA_AJUSTE  = { id_registro:['t',100], produccion:['n',0,VAL_MAX_CANTIDAD] };
export const VAL_OBRA_NUEVA   = { id_maquina:['t',50], bucket:['t',50], complem:['t',50], produccion:['n',0,VAL_MAX_CANTIDAD],
                                  horas:['n',0,VAL_MAX_HORAS], motivo:['t',300], proyecto:['t',20], operador:['t',200] };
