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
 *   · ACTA          = de la FECHA (tabla periodos, 16→15)                [Excel M = LOOKUP(FECHA,BASE!T:U,BASE!S)]
 *   · CANTIDAD      = LARGO × ESPESOR ÷ FC  (espesor/fc vacío = 1)       [Excel R = LARGO*ESPESOR/FC]
 * El jefe teclea/elige: FECHA, DESCRIPCIÓN, SUBTRAMO, LIBERACIÓN, LARGO, ESPESOR, FC, OBSERVACIÓN.
 * Cuando la actividad/subtramo NO está en el catálogo (actividad nueva que se añade a mano), la derivación
 * no encuentra match y se conserva lo que mandó el cliente (override manual): así puede meter su propia fila.
 *
 * if_version por fila (como base_elementos) + auditoría (editado_por/editado_ts). Lote ATÓMICO: si alguna
 * fila tiene conflicto de versión se hace rollback de todo y el cliente recarga. Guard D109: el JEFE edita.
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 */
import { OBRA_ID, json, permiso_, logMarcar_, memo_, normTexto, fdateValida_, deriveArea } from '../../comun.js';

const DG_ROLES_ESCRIBEN    = ['admin','jefe','residente'];
const DG_USUARIOS_ESCRIBEN = ['jeisson'];

const LIBERACION_OPC = ['', 'TOPOGRAFIA', 'CAMPO'];

// Columnas en el ORDEN de la hoja DATA (A–S). `edita` = la teclea/elige el jefe; el resto se DERIVA.
const DG_COLUMNAS = [
  { k:'fecha',            etiqueta:'Fecha',        tipo:'fecha',  edita:true },
  { k:'descripcion',      etiqueta:'Descripción',  tipo:'lista_desc', edita:true },
  { k:'elemento',         etiqueta:'Subtramo',     tipo:'lista_elem', edita:true },
  { k:'centro_de_costo',  etiqueta:'Centro costo', tipo:'texto',  edita:false },
  { k:'grupo',            etiqueta:'Grupo',        tipo:'texto',  edita:false },
  { k:'capitulo',         etiqueta:'Capítulo',     tipo:'texto',  edita:false },
  { k:'unidad_funcional', etiqueta:'UF',           tipo:'texto',  edita:false },
  { k:'proyecto',         etiqueta:'Proyecto',     tipo:'texto',  edita:false },
  { k:'abs_inicial',      etiqueta:'Abs inicial',  tipo:'texto',  edita:false },
  { k:'abs_final',        etiqueta:'Abs final',    tipo:'texto',  edita:false },
  { k:'liberacion',       etiqueta:'Liberación',   tipo:'lista',  opciones:LIBERACION_OPC, edita:true },
  { k:'acta',             etiqueta:'Acta',         tipo:'texto',  edita:false },
  { k:'unidad_medida',    etiqueta:'Unidad',       tipo:'texto',  edita:false },
  { k:'orden',            etiqueta:'Orden',        tipo:'texto',  edita:false },
  { k:'largo',            etiqueta:'Largo',        tipo:'num',    edita:true },
  { k:'espesor',          etiqueta:'Espesor',      tipo:'num',    edita:true },
  { k:'fc',               etiqueta:'FC',           tipo:'num',    edita:true },
  { k:'cantidad',         etiqueta:'Cantidad',     tipo:'num',    edita:false },
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

/* ---------- catálogos para derivar (una consulta por tabla y petición) ---------- */
async function catalogos_(c){
  return memo_(c, 'datagrid_cat', async function(){
    let items=[], els=[], per=[];
    try{ items = await c.sql`SELECT cc, descripcion, uf, capitulo, grupo, unidad, proyecto, orden FROM base_items WHERE obra_id=${OBRA_ID} ORDER BY orden`; }catch(e){ items=[]; }
    try{ els   = await c.sql`SELECT elemento, abs_inicio, abs_fin, uf FROM base_elementos WHERE obra_id=${OBRA_ID} ORDER BY orden`; }catch(e){ els=[]; }
    try{ per   = await c.sql`SELECT acta, to_char(fecha_inicial,'YYYY-MM-DD') AS fi, to_char(fecha_final,'YYYY-MM-DD') AS ff FROM periodos WHERE obra_id=${OBRA_ID} ORDER BY fecha_inicial`; }catch(e){ per=[]; }
    const actMap={}, actList=[];
    items.forEach(function(r){
      const desc=txt_(r.descripcion), uf=txt_(r.uf).toUpperCase();
      if(!desc) return;
      const k=normTexto(desc)+'|'+uf;
      if(!(k in actMap)) actMap[k]={ cc:txt_(r.cc), capitulo:txt_(r.capitulo), grupo:txt_(r.grupo), unidad:txt_(r.unidad), proyecto:txt_(r.proyecto), orden:txt_(r.orden) };
      actList.push({ descripcion:desc, uf:txt_(r.uf), cc:txt_(r.cc), capitulo:txt_(r.capitulo), grupo:txt_(r.grupo), unidad:txt_(r.unidad), proyecto:txt_(r.proyecto), orden:txt_(r.orden) });
    });
    const elMap={}, elList=[];
    els.forEach(function(r){
      const e=txt_(r.elemento); if(!e) return;
      const k=normTexto(e);
      if(!(k in elMap)){ elMap[k]={ uf:txt_(r.uf), abs_inicio:txt_(r.abs_inicio), abs_fin:txt_(r.abs_fin) }; elList.push({ elemento:e, uf:txt_(r.uf), abs_inicio:txt_(r.abs_inicio), abs_fin:txt_(r.abs_fin) }); }
    });
    return { actMap:actMap, actList:actList, elMap:elMap, elList:elList,
             periodos: per.map(function(p){ return { acta:p.acta, fi:p.fi, ff:p.ff }; }) };
  });
}
function actaDe_(periodos, fecha){
  if(!fecha) return '';
  for(let i=0;i<periodos.length;i++){ const p=periodos[i]; if(fecha>=p.fi && fecha<=p.ff) return p.acta; }
  return '';
}

/* ---------- derivar una fila a partir de las entradas (idéntico a las fórmulas del Excel) ---------- */
function derivar_(cat, inp){
  const fecha = fdateValida_(inp.fecha);
  const desc  = txt_(inp.descripcion);
  const elem  = txt_(inp.elemento);
  const el    = cat.elMap[normTexto(elem)] || null;
  const uf    = el ? txt_(el.uf) : txt_(inp.unidad_funcional);
  const act   = cat.actMap[normTexto(desc)+'|'+uf.toUpperCase()] || null;
  const cc    = act ? act.cc : txt_(inp.centro_de_costo);
  const largo = num_(inp.largo), esp = num_(inp.espesor), fc = num_(inp.fc);
  const cantidad = (largo==null) ? num_(inp.cantidad)
    : redondear_(largo * (esp==null?1:esp) / (fc==null||fc===0?1:fc));
  return {
    fecha: fecha,
    descripcion: desc,
    elemento: elem,
    liberacion: txt_(inp.liberacion),
    largo: largo, espesor: esp, fc: fc, cantidad: cantidad,
    observacion: txt_(inp.observacion),
    unidad_funcional: uf,
    centro_de_costo: cc,
    grupo:      act ? act.grupo    : txt_(inp.grupo),
    capitulo:   act ? act.capitulo : txt_(inp.capitulo),
    unidad_medida: act ? act.unidad : txt_(inp.unidad_medida),
    orden:      act ? txt_(act.orden) : txt_(inp.orden),
    proyecto:   act ? act.proyecto : txt_(inp.proyecto),
    abs_inicial: el ? txt_(el.abs_inicio) : txt_(inp.abs_inicial),
    abs_final:   el ? txt_(el.abs_fin)    : txt_(inp.abs_final),
    acta: actaDe_(cat.periodos, fecha) || txt_(inp.acta),
    area: deriveArea(cc)
  };
}

/* ---------- lectura de las filas del rango ---------- */
async function filasRango_(c, desde, hasta){
  const filas = await c.sql`SELECT fecha, orden, grupo, centro_de_costo, capitulo, descripcion, unidad_funcional,
      proyecto, elemento, abs_inicial, abs_final, liberacion, acta, unidad_medida, largo, espesor, fc, cantidad,
      observacion, id_registro, version, editado_por, to_char(editado_ts,'YYYY-MM-DD"T"HH24:MI') AS editado_ts, area
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
           liberacion_opciones:LIBERACION_OPC,
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
  const escrituras = [];
  for(let i=0;i<cambios.length;i++){
    const ch = cambios[i];
    const op = String(ch.op||'update').trim().toLowerCase();
    if(op==='baja'){
      const id = txt_(ch.id_registro); if(!id) return json(c, { ok:false, error:'Una baja llegó sin id_registro.' });
      escrituras.push({ op:'baja', id:id, if_version:parseInt(ch.if_version,10)||0 });
      continue;
    }
    if(op!=='update' && op!=='alta') return json(c, { ok:false, error:'Operación «'+op+'» no reconocida (alta, update, baja).' });
    const fila = derivar_(cat, ch);
    if(!fila.fecha) return json(c, { ok:false, error:'Hay una fila sin fecha válida (columna Fecha).' });
    if(!fila.descripcion) return json(c, { ok:false, error:'Hay una fila sin descripción (actividad).' });
    if(op==='update'){
      const id = txt_(ch.id_registro); if(!id) return json(c, { ok:false, error:'Una corrección llegó sin id_registro.' });
      escrituras.push({ op:'update', id:id, if_version:parseInt(ch.if_version,10)||0, fila:fila });
    }else{
      const id = txt_(ch.id_registro) || ('jefe-'+Date.now()+'-'+i);
      escrituras.push({ op:'alta', id:id, fila:fila });
    }
  }

  const conflictos=[];
  function _Rollback_(){ this.marca='dg_rollback'; }
  try{
    await c.sql.begin(async function(sql){
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'datagrid:'+OBRA_ID}))`;
      for(let i=0;i<escrituras.length;i++){
        const e=escrituras[i];
        if(e.op==='baja'){
          const r=await sql`DELETE FROM data WHERE obra_id=${OBRA_ID} AND id_registro=${e.id} AND version=${e.if_version} RETURNING id_registro`;
          if(!r.length) conflictos.push({ id_registro:e.id, motivo:'version' });
        } else if(e.op==='update'){
          const f=e.fila;
          const r=await sql`UPDATE data SET fecha=${f.fecha}, orden=${f.orden}, grupo=${f.grupo}, centro_de_costo=${f.centro_de_costo},
              capitulo=${f.capitulo}, descripcion=${f.descripcion}, unidad_funcional=${f.unidad_funcional}, proyecto=${f.proyecto},
              elemento=${f.elemento}, abs_inicial=${f.abs_inicial}, abs_final=${f.abs_final}, liberacion=${f.liberacion}, acta=${f.acta},
              unidad_medida=${f.unidad_medida}, largo=${f.largo}, espesor=${f.espesor}, fc=${f.fc}, cantidad=${f.cantidad},
              observacion=${f.observacion}, area=${f.area}, version=version+1, editado_por=${usuario}, editado_ts=now()
            WHERE obra_id=${OBRA_ID} AND id_registro=${e.id} AND version=${e.if_version} RETURNING id_registro`;
          if(!r.length) conflictos.push({ id_registro:e.id, motivo:'version' });
        } else { // alta
          const f=e.fila;
          await sql`INSERT INTO data (obra_id, fecha, orden, grupo, centro_de_costo, capitulo, descripcion, unidad_funcional,
              proyecto, elemento, abs_inicial, abs_final, liberacion, acta, unidad_medida, largo, espesor, fc, cantidad,
              observacion, id_registro, "timestamp", capataz, rol, actividad, pk_inicial, pk_final, area, clima,
              version, editado_por, editado_ts)
            VALUES (${OBRA_ID}, ${f.fecha}, ${f.orden}, ${f.grupo}, ${f.centro_de_costo}, ${f.capitulo}, ${f.descripcion},
              ${f.unidad_funcional}, ${f.proyecto}, ${f.elemento}, ${f.abs_inicial}, ${f.abs_final}, ${f.liberacion}, ${f.acta},
              ${f.unidad_medida}, ${f.largo}, ${f.espesor}, ${f.fc}, ${f.cantidad}, ${f.observacion}, ${e.id}, now(),
              ${usuario}, ${rol}, ${f.descripcion}, ${f.abs_inicial}, ${f.abs_final}, ${f.area}, '',
              0, ${usuario}, now())
            ON CONFLICT (obra_id, id_registro) DO NOTHING`;
        }
      }
      if(conflictos.length) throw new _Rollback_();
    });
  }catch(e){
    if(!(e instanceof _Rollback_)) throw e;
  }

  delete c.memo['datagrid_cat'];
  const r = rangoValido_(body);
  const desde = r.desde || (escrituras[0] && escrituras[0].fila && escrituras[0].fila.fecha) || '2020-01-01';
  const hasta = r.hasta || desde;

  if(conflictos.length){
    const out = await payload_(c, desde, hasta);
    out.ok=false; out.error='version'; out.conflictos=conflictos;
    out.mensaje='Alguien más editó '+conflictos.length+' fila(s) mientras tanto; se recargaron. Revisa y vuelve a guardar.';
    return json(c, out);
  }
  const out = await payload_(c, desde, hasta);
  out.guardadas = escrituras.length;
  out.mensaje = 'Se guardaron '+escrituras.length+' cambio(s) en DATA.';
  return json(c, out);
}

/* ---------- esquema D166 del payload (lo importa api/obra.js) ---------- */
export const VAL_DATA_GRID = { desde:['t',10], hasta:['t',10] };
export const VAL_DATA_GRID_CAMBIO = {
  op:['l',['update','alta','baja']], id_registro:['t',80], if_version:['e',0,100000000],
  fecha:['f',1], descripcion:['t',200], elemento:['t',120], liberacion:['t',40],
  centro_de_costo:['t',40], grupo:['t',60], capitulo:['t',120], unidad_funcional:['t',10], proyecto:['t',10],
  abs_inicial:['t',30], abs_final:['t',30], acta:['t',20], unidad_medida:['t',20], orden:['t',20],
  largo:['n',-1e9,1e9], espesor:['n',-1e9,1e9], fc:['n',-1e9,1e9], cantidad:['n',-1e12,1e12], observacion:['tl']
};
