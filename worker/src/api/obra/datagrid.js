/**
 * api/obra/datagrid.js — REVISIÓN EDITABLE de la hoja DATA (V3-08b · D181, sep-2026).
 *
 * La fuente única de edición (D181) también cubre DATA: el jefe/residente revisa el reporte diario al
 * cierre, ve la hoja DATA como en el Excel, y CORRIGE o AÑADE filas (una actividad que el residente puso
 * mal, un valor que se comió, o una actividad que los capataces no reportan). El Excel deja de captar: sus
 * tablas dinámicas leen esto en vivo (Power Query → data_maestro).
 *
 *   GET  ?action=data_grid&desde=YYYY-MM-DD&hasta=YYYY-MM-DD   TOKEN → dataGridLeer: filas del rango + catálogos
 *   POST {action:'data_grid_guardar', desde, hasta, cambios[]} TOKEN → dataGridGuardar: alta|update|baja
 *
 * DERIVACIONES — idénticas a las FÓRMULAS reales de la hoja DATA (verificadas en el Excel maestro):
 *   · UF            = del SUBTRAMO (base_elementos.uf)                    [Excel G = VLOOKUP(ELEMENTO,BASE!J:M,4)]
 *   · CENTRO COSTO  = de DESCRIPCIÓN + UF (base_items, único)            [Excel D = VLOOKUP(DESCR&UF,'BASE 1',4)]
 *   · GRUPO/CAPÍTULO/UNIDAD/ORDEN/PROYECTO = del CC (base_items)         [Excel C/E/N/B/H = VLOOKUP(CC,BASE!A:H,…)]
 *   · ABS INICIAL/FINAL = del SUBTRAMO (base_elementos)                  [Excel J/K = VLOOKUP(ELEMENTO,BASE!J:M,…)]
 *   · ACTA          = de la FECHA (tabla periodos, 16→15; fuera de ella, la fórmula de respaldo — D184,
 *                     actaDeFecha de periodos.js)                        [Excel M = LOOKUP(FECHA,BASE!T:U,BASE!S)]
 *   · CANTIDAD      = LARGO × ESPESOR ÷ FC                               [Excel R = LARGO*ESPESOR/FC]
 *     D184: con LARGO, ESPESOR vacío = 1 y FC vacío = el de la ACTIVIDAD (fc_actividad, 007; sin fila = 1), en
 *     el alta y en la corrección; un valor escrito por el jefe se respeta. Sin LARGO no se completan (como 007).
 *     D185 [O]: en un subtramo NO OPERATIVO («ajuste origen UF1/UF2») el FC vacío es 1, no el de la actividad.
 * El jefe teclea/elige: FECHA, DESCRIPCIÓN, SUBTRAMO, LARGO, ESPESOR, FC, CLIMA, OBSERVACIÓN.
 * Cuando la actividad/subtramo NO está en el catálogo (actividad nueva que se añade a mano), la derivación
 * no encuentra match y se conserva lo que mandó el cliente (override manual): así puede meter su propia fila.
 *
 * D182 (sep-2026) — DATA online simplificada. ORDEN, PROYECTO y LIBERACIÓN salen de la grilla (y de la vista
 * data_maestro, 005_data_clima.sql), pero la tabla las CONSERVA (el copiado A:O al Excel actual las usa):
 * viajan OCULTAS ida y vuelta y, si un cambio no las trae, el UPDATE deja lo guardado (orden/proyecto se
 * siguen pisando cuando los deriva el catálogo por CC, como antes); un alta sin liberación nace 'CAMPO'.
 * Donde estaba la OBSERVACIÓN va el CLIMA, y la OBSERVACIÓN pasa al final. El clima es DEL DÍA (la hoja
 * DATOS del Excel desaparece y con ella el sello '[Clima: X]' de D130):
 *   · lectura: cada fila trae su clima o, si está vacío, el del DÍA = primer clima no vacío de esa fecha por
 *     "timestamp" NULLS LAST, id_registro (la regla de climaPorDia, lectura.js · D37). Drenajes llega con ''.
 *   · escritura: un cambio con la clave `clima` la guarda en su fila y, en la MISMA transacción y DESPUÉS de
 *     las escrituras por fila, la PROPAGA a todas las filas de esa fecha (misma obra, cualquier área) con
 *     version+1 y auditoría; si dos cambios del lote ponen climas distintos a la misma fecha, gana el último.
 *     Update sin `clima` → se conserva (si CAMBIA DE FECHA, toma el del día de destino); alta sin `clima` →
 *     hereda el del día ('' si el día no tiene).
 *   · {op:'clima', fecha, clima} = SOLO el clima del día: la misma propagación, sin tocar ni re-derivar
 *     ninguna fila (es lo que manda la pantalla: cambiar el clima no reescribe las filas del día).
 *   · una baja o un cambio de fecha que se lleva la única fila con el clima de su día no lo borra: el clima
 *     que tenía el día se escribe en sus filas vacías (las de drenajes llegan con '' y lo leían de esa fila).
 *
 * if_version por fila (como base_elementos) + auditoría (editado_por/editado_ts). Lote ATÓMICO: si alguna
 * fila tiene conflicto de versión se hace rollback de todo y el cliente recarga. Guard D109: el JEFE edita.
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 */
import { OBRA_ID, json, permiso_, logMarcar_, memo_, normTexto, fdateValida_, deriveArea, textoArrayPg_ } from '../../comun.js';
import { fcActividad_, fcDeActividad, noOperativos_, esNoOperativo, fcDeFila } from '../../catalogos.js';   // D184: FC por actividad · D185 [O]: FC 1 en ajuste origen
import { periodos_, actaDeFecha } from './periodos.js';              // D184: la regla única de ACTA

const DG_ROLES_ESCRIBEN    = ['admin','jefe','residente'];
const DG_USUARIOS_ESCRIBEN = ['jeisson'];

// D182: LIBERACIÓN ya no es columna de la grilla; las opciones se siguen enviando por compatibilidad.
const LIBERACION_OPC = ['', 'TOPOGRAFIA', 'CAMPO'];
const LIBERACION_ALTA = 'CAMPO';   // D182: un alta sin liberación nace 'CAMPO' (lo que ponía el Excel)
// D182: las MISMAS opciones que CLIMA_OPS de encargado.js (D130). Un valor histórico fuera de la lista
// ('SOLEADO', 'lluvias'…) se devuelve y se guarda tal cual: la lista solo acota lo que se puede ELEGIR.
const CLIMA_OPC = ['', 'Soleado', 'Lluvias', 'Lluvias parciales'];

// Columnas en el ORDEN de la grilla (D182): las de la hoja DATA sin ORDEN/PROYECTO/LIBERACIÓN, el CLIMA del
// día donde estaba la OBSERVACIÓN y la OBSERVACIÓN al final. `edita` = la teclea/elige el jefe; el resto se DERIVA.
const DG_COLUMNAS = [
  { k:'fecha',            etiqueta:'Fecha',        tipo:'fecha',  edita:true },
  { k:'descripcion',      etiqueta:'Descripción',  tipo:'lista_desc', edita:true },
  { k:'elemento',         etiqueta:'Subtramo',     tipo:'lista_elem', edita:true },
  { k:'centro_de_costo',  etiqueta:'Centro costo', tipo:'texto',  edita:false },
  { k:'grupo',            etiqueta:'Grupo',        tipo:'texto',  edita:false },
  { k:'capitulo',         etiqueta:'Capítulo',     tipo:'texto',  edita:false },
  { k:'unidad_funcional', etiqueta:'UF',           tipo:'texto',  edita:false },
  { k:'abs_inicial',      etiqueta:'Abs inicial',  tipo:'texto',  edita:false },
  { k:'abs_final',        etiqueta:'Abs final',    tipo:'texto',  edita:false },
  { k:'acta',             etiqueta:'Acta',         tipo:'texto',  edita:false },
  { k:'unidad_medida',    etiqueta:'Unidad',       tipo:'texto',  edita:false },
  { k:'largo',            etiqueta:'Largo',        tipo:'num',    edita:true },
  { k:'espesor',          etiqueta:'Espesor',      tipo:'num',    edita:true },
  { k:'fc',               etiqueta:'FC',           tipo:'num',    edita:true },
  { k:'cantidad',         etiqueta:'Cantidad',     tipo:'num',    edita:false },
  { k:'clima',            etiqueta:'Clima',        tipo:'lista',  opciones:CLIMA_OPC, edita:true },
  { k:'observacion',      etiqueta:'Observación',  tipo:'texto',  edita:true }
];

function num_(v){
  if(v===null || v===undefined || v==='') return null;
  if(typeof v==='number') return isFinite(v) ? v : null;
  const n=Number(String(v).trim().replace(/\s/g,'').replace(',','.'));
  return isFinite(n) ? n : null;
}
function txt_(v){ return String(v==null?'':v).trim(); }
function redondear_(n){ return n==null ? null : Math.round(n*1e6)/1e6; }
// D182: ¿el cambio TRAE la clave? (undefined/null = no vino → el UPDATE conserva lo guardado).
function trae_(inp, k){ return inp[k]!==undefined && inp[k]!==null; }
// D182: PROYECTO ya no se ve ni se teclea. Si la actividad no está en el catálogo, sale de la UF con la regla
// D04 de enviar_data (UF1 → 3701, UF2 → 3702); con otra UF queda ''.
function proyectoDeUf_(uf){ const u=txt_(uf).toUpperCase().replace(/\s/g,''); return u==='UF1' ? '3701' : u==='UF2' ? '3702' : ''; }

/* ---------- catálogos para derivar (una consulta por tabla y petición) ---------- */
async function catalogos_(c){
  return memo_(c, 'datagrid_cat', async function(){
    let items=[], els=[];
    try{ items = await c.sql`SELECT cc, descripcion, uf, capitulo, grupo, unidad, proyecto, orden FROM base_items WHERE obra_id=${OBRA_ID} ORDER BY orden`; }catch(e){ items=[]; }
    try{ els   = await c.sql`SELECT elemento, abs_inicio, abs_fin, uf FROM base_elementos WHERE obra_id=${OBRA_ID} ORDER BY orden`; }catch(e){ els=[]; }
    const per   = await periodos_(c);       // D184: la misma lectura de `periodos` que enviar_data (periodos.js)
    const fcMap = await fcActividad_(c);    // D184: FC por actividad (fc_actividad; sin fila = 1)
    const noOp  = await noOperativos_(c);   // D185 [O]: subtramos no operativos (ajuste origen) → FC 1
    const actMap={}, actList=[];
    items.forEach(function(r){
      const desc=txt_(r.descripcion), uf=txt_(r.uf).toUpperCase();
      if(!desc) return;
      const k=normTexto(desc)+'|'+uf;
      if(!(k in actMap)) actMap[k]={ cc:txt_(r.cc), capitulo:txt_(r.capitulo), grupo:txt_(r.grupo), unidad:txt_(r.unidad), proyecto:txt_(r.proyecto), orden:txt_(r.orden) };
      // D184: cada actividad lleva su FC (la pantalla lo pone al elegir la descripción)
      actList.push({ descripcion:desc, uf:txt_(r.uf), cc:txt_(r.cc), capitulo:txt_(r.capitulo), grupo:txt_(r.grupo), unidad:txt_(r.unidad), proyecto:txt_(r.proyecto), orden:txt_(r.orden),
                     fc:fcDeActividad(fcMap, desc) });
    });
    const elMap={}, elList=[];
    els.forEach(function(r){
      const e=txt_(r.elemento); if(!e) return;
      const k=normTexto(e);
      // D185 [O]: cada subtramo dice si es NO OPERATIVO (la pantalla pone FC 1 al elegirlo, como el servidor)
      const no = esNoOperativo(noOp, e);
      if(!(k in elMap)){ elMap[k]={ uf:txt_(r.uf), abs_inicio:txt_(r.abs_inicio), abs_fin:txt_(r.abs_fin), no_operativo:no }; elList.push({ elemento:e, uf:txt_(r.uf), abs_inicio:txt_(r.abs_inicio), abs_fin:txt_(r.abs_fin), no_operativo:no }); }
    });
    return { actMap:actMap, actList:actList, elMap:elMap, elList:elList, fcMap:fcMap, noOp:noOp,
             periodos: per.map(function(p){ return { acta:p.acta, fi:p.fi, ff:p.ff }; }) };
  });
}
// (D184: actaDe_ —solo la tabla periodos— se retiró: la ACTA sale de actaDeFecha, periodos.js, la regla única.)

/* ---------- derivar una fila a partir de las entradas (idéntico a las fórmulas del Excel) ---------- */
function derivar_(cat, inp){
  const fecha = fdateValida_(inp.fecha);
  const desc  = txt_(inp.descripcion);
  const elem  = txt_(inp.elemento);
  const el    = cat.elMap[normTexto(elem)] || null;
  const uf    = el ? txt_(el.uf) : txt_(inp.unidad_funcional);
  const act   = cat.actMap[normTexto(desc)+'|'+uf.toUpperCase()] || null;
  const cc    = act ? act.cc : txt_(inp.centro_de_costo);
  const largo = num_(inp.largo);
  let esp = num_(inp.espesor), fc = num_(inp.fc);
  // D184: con LARGO, un ESPESOR vacío es 1 y un FC vacío es el de la ACTIVIDAD (fc_actividad por la descripción;
  // sin fila = 1), tanto en el alta como en la corrección. Lo que el jefe escribe (1.8, 0.5…) se respeta. Sin
  // LARGO la cantidad es la tecleada y espesor/fc no se tocan (el mismo criterio que el relleno de 007).
  // D185 [O]: si el SUBTRAMO es no operativo («ajuste origen UF1/UF2»: bandera o nombre), el FC vacío es 1 SIEMPRE
  // (ya está en compacto), no el de la actividad (fcDeFila, catalogos.js; la misma regla que enviar_data y 007).
  if(largo!=null){ if(esp==null) esp=1; if(fc==null) fc=fcDeFila(cat.fcMap, cat.noOp, desc, elem); }
  const cantidad = (largo==null) ? num_(inp.cantidad)
    : redondear_(largo * (esp==null?1:esp) / (fc==null||fc===0?1:fc));
  return {
    fecha: fecha,
    descripcion: desc,
    elemento: elem,
    // D182: liberacion/clima/orden/proyecto en null = «no vino en el cambio»: el UPDATE conserva lo guardado
    // (COALESCE) y el alta pone su defecto (liberación 'CAMPO', clima del día, orden '', proyecto de la UF).
    liberacion: trae_(inp,'liberacion') ? txt_(inp.liberacion) : null,
    clima:      trae_(inp,'clima') ? txt_(inp.clima) : null,
    largo: largo, espesor: esp, fc: fc, cantidad: cantidad,
    observacion: txt_(inp.observacion),
    unidad_funcional: uf,
    centro_de_costo: cc,
    grupo:      act ? act.grupo    : txt_(inp.grupo),
    capitulo:   act ? act.capitulo : txt_(inp.capitulo),
    unidad_medida: act ? act.unidad : txt_(inp.unidad_medida),
    orden:      act ? txt_(act.orden) : (trae_(inp,'orden')    ? txt_(inp.orden)    : null),
    proyecto:   act ? act.proyecto    : (trae_(inp,'proyecto') ? (txt_(inp.proyecto) || proyectoDeUf_(uf)) : null),
    abs_inicial: el ? txt_(el.abs_inicio) : txt_(inp.abs_inicial),
    abs_final:   el ? txt_(el.abs_fin)    : txt_(inp.abs_final),
    acta: actaDeFecha(cat.periodos, fecha) || txt_(inp.acta),   // D184: periodos o fórmula; '' solo antes del acta 1
    area: deriveArea(cc)
  };
}

/* ---------- lectura de las filas del rango ----------
 * D182: `clima` = el de la fila o, si está vacío, el del DÍA: first_value sobre la fecha con los no vacíos
 * primero y luego "timestamp" NULLS LAST, id_registro (climaPorDia de lectura.js; misma expresión que la
 * columna "CLIMA" de data_maestro). El filtro es por fechas enteras, así la ventana ve todas las filas del
 * día de cualquier área. orden/proyecto/liberacion siguen viajando (ocultos en la grilla, ida y vuelta). */
async function filasRango_(c, desde, hasta){
  const filas = await c.sql`SELECT fecha, orden, grupo, centro_de_costo, capitulo, descripcion, unidad_funcional,
      proyecto, elemento, abs_inicial, abs_final, liberacion, acta, unidad_medida, largo, espesor, fc, cantidad,
      observacion, clima,
      first_value(btrim(clima)) OVER (PARTITION BY fecha ORDER BY (btrim(clima) = ''), "timestamp" NULLS LAST, id_registro) AS clima_dia,
      id_registro, version, editado_por, to_char(editado_ts,'YYYY-MM-DD"T"HH24:MI') AS editado_ts, area
    FROM data WHERE obra_id=${OBRA_ID} AND fecha >= ${desde} AND fecha <= ${hasta}
    ORDER BY fecha, orden, id_registro`;
  return filas.map(function(r){
    return {
      id_registro: r.id_registro, version: Number(r.version||0),
      fecha: (typeof r.fecha==='string') ? r.fecha.slice(0,10) : String(r.fecha||'').slice(0,10),
      orden: txt_(r.orden), grupo: txt_(r.grupo), centro_de_costo: txt_(r.centro_de_costo), capitulo: txt_(r.capitulo),
      descripcion: txt_(r.descripcion), unidad_funcional: txt_(r.unidad_funcional), proyecto: txt_(r.proyecto),
      elemento: txt_(r.elemento), abs_inicial: txt_(r.abs_inicial), abs_final: txt_(r.abs_final),
      liberacion: txt_(r.liberacion), acta: txt_(r.acta), unidad_medida: txt_(r.unidad_medida),
      largo: r.largo==null?'':Number(r.largo), espesor: r.espesor==null?'':Number(r.espesor),
      fc: r.fc==null?'':Number(r.fc), cantidad: r.cantidad==null?'':Number(r.cantidad),
      clima: txt_(r.clima) || txt_(r.clima_dia),
      observacion: txt_(r.observacion), editado_por: txt_(r.editado_por), editado_ts: txt_(r.editado_ts)
    };
  });
}

function rangoValido_(params){
  const desde = fdateValida_(params && params.desde);
  const hasta = fdateValida_(params && params.hasta) || desde;
  return { desde:desde, hasta:hasta||desde };
}

async function payload_(c, desde, hasta){
  const cat = await catalogos_(c);
  return { ok:true, desde:desde, hasta:hasta, columnas:DG_COLUMNAS, roles_editan:DG_ROLES_ESCRIBEN,
           clima_opciones:CLIMA_OPC, liberacion_opciones:LIBERACION_OPC,   // D182 (liberación: compatibilidad)
           actividades: cat.actList, subtramos: cat.elList, periodos: cat.periodos,
           filas: await filasRango_(c, desde, hasta) };
}

/* ---------- GET ?action=data_grid ---------- */
export async function dataGridLeer(c, params){
  const r = rangoValido_(params);
  if(!r.desde) return json(c, { ok:false, error:'Elige un rango de fechas válido (desde / hasta, formato YYYY-MM-DD).' });
  if(r.hasta < r.desde) return json(c, { ok:false, error:'La fecha "hasta" no puede ser anterior a "desde".' });
  return json(c, await payload_(c, r.desde, r.hasta));
}

/* ---------- POST {action:'data_grid_guardar'} ---------- */
export async function dataGridGuardar(c, body, ses){
  const permiso = permiso_(ses, DG_ROLES_ESCRIBEN, DG_USUARIOS_ESCRIBEN, 'editar la hoja DATA');
  if(!permiso.ok){ logMarcar_(c, 'rechazado', 'data_grid: '+permiso.error); return json(c, { ok:false, error:permiso.error }); }

  const cambios = Array.isArray(body.cambios) ? body.cambios : [];
  if(!cambios.length) return json(c, { ok:false, error:'No llegó ningún cambio para guardar.' });
  if(cambios.length>1000) return json(c, { ok:false, error:'Demasiados cambios de una vez (máx. 1000). Guarda por partes.' });

  const cat = await catalogos_(c);
  const usuario = txt_(ses && ses.usuario) || 'jefe';
  const rol = txt_(ses && ses.rol);

  // Validación previa: cada fila con fecha válida; alta necesita id_registro (lo genera el cliente).
  // D182: climaDia = fecha → clima que el lote fija para ese día (Map.set: si dos cambios ponen climas
  // distintos a la misma fecha, gana el ÚLTIMO en orden del lote). idsLote = filas que escribe el lote.
  const escrituras = [], climaDia = new Map(), idsLote = {};
  for(let i=0;i<cambios.length;i++){
    const ch = cambios[i];
    const op = String(ch.op||'update').trim().toLowerCase();
    if(op==='baja'){
      const id = txt_(ch.id_registro); if(!id) return json(c, { ok:false, error:'Una baja llegó sin id_registro.' });
      escrituras.push({ op:'baja', id:id, if_version:parseInt(ch.if_version,10)||0 });
      continue;
    }
    if(op==='clima'){
      // D182: el clima del DÍA sin tocar ninguna fila (sin derivar_ ni if_version): solo la propagación de abajo.
      const fecha = fdateValida_(ch.fecha); if(!fecha) return json(c, { ok:false, error:'Un cambio de clima llegó sin fecha válida.' });
      if(!trae_(ch,'clima')) return json(c, { ok:false, error:'Un cambio de clima llegó sin el clima (usa "" para vaciarlo).' });
      climaDia.set(fecha, txt_(ch.clima));
      escrituras.push({ op:'clima', fecha:fecha });
      continue;
    }
    if(op!=='update' && op!=='alta') return json(c, { ok:false, error:'Operación «'+op+'» no reconocida (alta, update, baja, clima).' });
    const fila = derivar_(cat, ch);
    if(!fila.fecha) return json(c, { ok:false, error:'Hay una fila sin fecha válida (columna Fecha).' });
    if(!fila.descripcion) return json(c, { ok:false, error:'Hay una fila sin descripción (actividad).' });
    let id;
    if(op==='update'){
      id = txt_(ch.id_registro); if(!id) return json(c, { ok:false, error:'Una corrección llegó sin id_registro.' });
      escrituras.push({ op:'update', id:id, if_version:parseInt(ch.if_version,10)||0, fila:fila });
    }else{
      id = txt_(ch.id_registro) || ('jefe-'+Date.now()+'-'+i);
      escrituras.push({ op:'alta', id:id, fila:fila });
    }
    idsLote[id] = 1;
    if(fila.clima!==null) climaDia.set(fila.fecha, fila.clima);
  }

  const conflictos=[];
  let propagadas=0;
  function _Rollback_(){ this.marca='dg_rollback'; }
  try{
    await c.sql.begin(async function(sql){
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'datagrid:'+OBRA_ID}))`;
      // D182: clima de los días que una baja o un cambio de fecha pueden dejar sin él, ANTES de escribir.
      const climaOrigen = await climaDeOrigen_(sql, escrituras, climaDia);
      for(let i=0;i<escrituras.length;i++){
        const e=escrituras[i];
        if(e.op==='clima') continue;   // D182: solo propaga (abajo)
        if(e.op==='baja'){
          const r=await sql`DELETE FROM data WHERE obra_id=${OBRA_ID} AND id_registro=${e.id} AND version=${e.if_version} RETURNING id_registro`;
          if(!r.length) conflictos.push({ id_registro:e.id, motivo:'version' });
        } else if(e.op==='update'){
          // D182: orden/proyecto/liberacion/clima en null (no vinieron) → COALESCE deja el valor guardado. Sin
          // clima y con fecha NUEVA, la fila toma el clima del día de destino ('' si no tiene): el del día viejo
          // sería un dato falso y, con el "timestamp" de la fila, podía volverse el clima del día nuevo.
          // area: una fila de drenajes cuyo CC no deriva el área (D71: demolición 01.02 con area 'odt') la
          // conserva mientras el CC no cambie; con deriveArea pasaba a 'tierras' y el siguiente reenvío de
          // tierras (D69: DELETE … area='tierras') la borraba.
          const f=e.fila;
          const r=await sql`UPDATE data SET fecha=${f.fecha}, orden=COALESCE(${f.orden}, orden), grupo=${f.grupo}, centro_de_costo=${f.centro_de_costo},
              capitulo=${f.capitulo}, descripcion=${f.descripcion}, unidad_funcional=${f.unidad_funcional}, proyecto=COALESCE(${f.proyecto}, proyecto),
              elemento=${f.elemento}, abs_inicial=${f.abs_inicial}, abs_final=${f.abs_final}, liberacion=COALESCE(${f.liberacion}, liberacion), acta=${f.acta},
              unidad_medida=${f.unidad_medida}, largo=${f.largo}, espesor=${f.espesor}, fc=${f.fc}, cantidad=${f.cantidad},
              observacion=${f.observacion},
              clima=COALESCE(${f.clima}, CASE WHEN fecha = ${f.fecha} THEN clima
                ELSE COALESCE((SELECT btrim(d.clima) FROM data d WHERE d.obra_id=${OBRA_ID} AND d.fecha=${f.fecha} AND btrim(d.clima)<>''
                               ORDER BY d."timestamp" NULLS LAST, d.id_registro LIMIT 1), '') END),
              area=CASE WHEN area IN ('odt','odl') AND centro_de_costo = ${f.centro_de_costo} THEN area ELSE ${f.area} END,
              version=version+1, editado_por=${usuario}, editado_ts=now()
            WHERE obra_id=${OBRA_ID} AND id_registro=${e.id} AND version=${e.if_version} RETURNING id_registro`;
          if(!r.length) conflictos.push({ id_registro:e.id, motivo:'version' });
        } else { // alta
          // D182: liberación 'CAMPO', orden '' y proyecto de la UF si no vinieron; sin clima, hereda el del DÍA
          // (primer clima no vacío de la fecha por "timestamp" NULLS LAST, id_registro — ve las escrituras previas del lote).
          const f=e.fila;
          await sql`INSERT INTO data (obra_id, fecha, orden, grupo, centro_de_costo, capitulo, descripcion, unidad_funcional,
              proyecto, elemento, abs_inicial, abs_final, liberacion, acta, unidad_medida, largo, espesor, fc, cantidad,
              observacion, id_registro, "timestamp", capataz, rol, actividad, pk_inicial, pk_final, area, clima,
              version, editado_por, editado_ts)
            VALUES (${OBRA_ID}, ${f.fecha}, ${f.orden==null?'':f.orden}, ${f.grupo}, ${f.centro_de_costo}, ${f.capitulo}, ${f.descripcion},
              ${f.unidad_funcional}, ${f.proyecto==null?proyectoDeUf_(f.unidad_funcional):f.proyecto}, ${f.elemento}, ${f.abs_inicial}, ${f.abs_final},
              ${f.liberacion==null?LIBERACION_ALTA:f.liberacion}, ${f.acta},
              ${f.unidad_medida}, ${f.largo}, ${f.espesor}, ${f.fc}, ${f.cantidad}, ${f.observacion}, ${e.id}, now(),
              ${usuario}, ${rol}, ${f.descripcion}, ${f.abs_inicial}, ${f.abs_final}, ${f.area},
              COALESCE(${f.clima}, (SELECT btrim(d.clima) FROM data d WHERE d.obra_id=${OBRA_ID} AND d.fecha=${f.fecha} AND btrim(d.clima)<>''
                                    ORDER BY d."timestamp" NULLS LAST, d.id_registro LIMIT 1), ''),
              0, ${usuario}, now())
            ON CONFLICT (obra_id, id_registro) DO NOTHING`;
        }
      }
      if(conflictos.length) throw new _Rollback_();
      // D182: el clima es del DÍA. DESPUÉS de las escrituras por fila, cada fecha que el lote tocó con la clave
      // `clima` lo recibe en TODAS sus filas (cualquier área) que lo tengan distinto, con version+1 y auditoría:
      // así una fila abierta en otra pantalla choca por if_version en vez de devolver el clima viejo.
      for(const [fecha, cl] of climaDia){
        const p=await sql`UPDATE data SET clima=${cl}, version=version+1, editado_por=${usuario}, editado_ts=now()
          WHERE obra_id=${OBRA_ID} AND fecha=${fecha} AND clima<>${cl} RETURNING id_registro`;
        p.forEach(function(x){ if(!idsLote[x.id_registro]) propagadas++; });
      }
      // D182: si una baja o un cambio de fecha dejó su día de origen con OTRO clima (o sin ninguno), el que tenía
      // se escribe en las filas vacías que quedan: así cada fila sigue mostrando lo que mostraba antes de guardar.
      for(const [fecha, cl] of climaOrigen){
        const q=await sql`SELECT btrim(clima) AS c FROM data WHERE obra_id=${OBRA_ID} AND fecha=${fecha} AND btrim(clima)<>''
          ORDER BY "timestamp" NULLS LAST, id_registro LIMIT 1`;
        if(q.length && q[0].c===cl) continue;
        const p=await sql`UPDATE data SET clima=${cl}, version=version+1, editado_por=${usuario}, editado_ts=now()
          WHERE obra_id=${OBRA_ID} AND fecha=${fecha} AND btrim(clima)='' RETURNING id_registro`;
        p.forEach(function(x){ if(!idsLote[x.id_registro]) propagadas++; });
      }
    });
  }catch(e){
    if(!(e instanceof _Rollback_)) throw e;
  }

  delete c.memo['datagrid_cat'];
  const r = rangoValido_(body);
  const desde = r.desde || (escrituras[0] && (escrituras[0].fecha || (escrituras[0].fila && escrituras[0].fila.fecha))) || '2020-01-01';
  const hasta = r.hasta || desde;

  if(conflictos.length){
    const out = await payload_(c, desde, hasta);
    out.ok=false; out.error='version'; out.conflictos=conflictos;
    out.mensaje='Alguien más editó '+conflictos.length+' fila(s) mientras tanto; se recargaron. Revisa y vuelve a guardar.';
    return json(c, out);
  }
  const out = await payload_(c, desde, hasta);
  out.guardadas = escrituras.length;
  out.clima_propagadas = propagadas;   // D182: filas de esos días (fuera del lote) que tomaron el clima del día
  const conFilas = escrituras.some(function(e){ return e.op!=='clima'; });   // {op:'clima'} no escribe ninguna fila
  out.mensaje = 'Se guardaron '+escrituras.length+' cambio(s) en DATA.'
    + (propagadas ? ' El clima del día se aplicó a '+propagadas+' fila(s)'+(conFilas ? ' más' : '')+'.' : '');
  return json(c, out);
}

/* ---------- D182: clima de los días de ORIGEN antes de escribir ----------
 * Días de los que el lote SACA filas (bajas, y updates que cambian la fecha) y cuyo clima el propio lote no
 * fija (climaDia): Map fecha → clima del día ANTES de escribir, por la regla de climaPorDia (primer clima no
 * vacío por "timestamp" NULLS LAST, id_registro). Solo los días que tienen clima. */
async function climaDeOrigen_(sql, escrituras, climaDia){
  const destino = {};   // id → fecha nueva ('' = baja)
  escrituras.forEach(function(e){ if(e.op==='baja') destino[e.id]=''; else if(e.op==='update') destino[e.id]=e.fila.fecha; });
  const out = new Map(), ids = Object.keys(destino);
  if(!ids.length) return out;
  const filas = await sql`SELECT id_registro, to_char(fecha,'YYYY-MM-DD') AS f FROM data
    WHERE obra_id=${OBRA_ID} AND id_registro = ANY(${textoArrayPg_(ids)}::text[])`;
  const dias = [];
  filas.forEach(function(r){ if(r.f && r.f!==destino[r.id_registro] && !climaDia.has(r.f) && dias.indexOf(r.f)<0) dias.push(r.f); });
  if(!dias.length) return out;
  const cl = await sql`SELECT DISTINCT ON (fecha) to_char(fecha,'YYYY-MM-DD') AS f, btrim(clima) AS c FROM data
    WHERE obra_id=${OBRA_ID} AND fecha = ANY(${textoArrayPg_(dias)}::date[]) AND btrim(clima)<>''
    ORDER BY fecha, "timestamp" NULLS LAST, id_registro`;
  cl.forEach(function(r){ out.set(r.f, r.c); });
  return out;
}

/* ---------- esquema D166 del payload (lo importa api/obra.js) ---------- */
export const VAL_DATA_GRID = { desde:['t',10], hasta:['t',10] };
export const VAL_DATA_GRID_CAMBIO = {
  op:['l',['update','alta','baja','clima']], id_registro:['t',80], if_version:['e',0,100000000],   // D182: 'clima' = solo el clima del día
  fecha:['f',1], descripcion:['t',200], elemento:['t',120], liberacion:['t',40],
  centro_de_costo:['t',40], grupo:['t',60], capitulo:['t',120], unidad_funcional:['t',10], proyecto:['t',10],
  abs_inicial:['t',30], abs_final:['t',30], acta:['t',20], unidad_medida:['t',20], orden:['t',20],
  largo:['n',-1e9,1e9], espesor:['n',-1e9,1e9], fc:['n',-1e9,1e9], cantidad:['n',-1e12,1e12], observacion:['tl'],
  clima:['t',100]   // D182: el clima del día (mismo tope que enviar_data, VAL_OBRA_ENVIAR)
};
