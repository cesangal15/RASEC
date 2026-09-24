/**
 * api/obra/proyeccion.js — módulo de PROYECCIÓN editable en Galca (V3-11 Fase A · D183, sep-2026).
 *
 * El plan mensual, el contrato + línea base, los rendimientos por equipo y el FC dejan de vivir tecleados en
 * el Excel (CALCULOS B/D/F/H/J 3:19, MAPEO I8:M16, MAPEO J27:N27 / CALCULOS P1:T1, P4) y en constantes del
 * tablero (CONTRATO, BASE_ACUM, BASE_CORTE, FC_DEFECTO de tablero-produccion.js): viven en las tablas
 * proy_plan / proy_contrato / proy_rendimiento / proy_parametros (worker/sql/006_proyeccion.sql), las edita
 * admin o jefe desde proyeccion.html (el residente las ve en solo lectura) y el Tablero las lee con
 * respaldo al Excel. La producción diaria (DATOS) y las horas de máquina (partes) siguen en el Excel.
 * D185 (V3-11 Fases B+C): el Tablero ya calcula EN VIVO con la DATA de Galca (tablero_vivo.js, que toma la
 * proyección de proyeccionTableroDatos_ sin `usuario`). Decisión final del dueño (19-sep-2026): su avance sigue
 * partiendo de la producción base certificada de aquí (BASE_ACUM hasta el cierre del acta base) + la DATA desde
 * BASE_CORTE, ÷ contrato; la Proyección NO lleva conciliación DATA ↔ producción base.
 *
 *   GET  ?action=proyeccion                TOKEN → proyeccionLeer: las 4 tablas {columnas, filas} + actas + puede_editar
 *   GET  ?action=proyeccion_tablero        TOKEN (NO público; la lectura pública de la proyección va dentro de
 *                                          ?action=tablero_vivo, D185, sin el nombre de quien editó)
 *                                          → proyeccionTablero: la forma EXACTA que consume el motor del tablero
 *                                          (leerPlan / leerProyectado / CONTRATO / BASE_ACUM / BASE_CORTE / FC_DEFECTO)
 *   POST {action:'proyeccion_guardar', cambios[]}  TOKEN → proyeccionGuardar (admin/jefe)
 *
 * Cambio = {tabla:'plan'|'contrato'|'rendimiento'|'parametros', op:'alta'|'update'|'baja', <clave>, if_version,
 * <campos>}. Clave: plan → periodo ('YYYY-MM' o 'YYYY-MM-01'); contrato → partida + uf ('' en el préstamo);
 * rendimiento → partida; parámetros → ninguna (una fila por obra). Solo el PLAN admite alta y baja; las otras
 * tres solo se corrigen (update). Un update toca SOLO los campos que trae (un campo ausente conserva lo guardado).
 *
 * Diferencias a propósito con la grilla de DATA (datagrid.js), por la crítica del plan V3-11:
 *   · if_version es OBLIGATORIO en update y baja (DATA lo convertía en 0 si faltaba), y tiene que ser un entero:
 *     un if_version de solo espacios no vale como 0.
 *   · el alta usa RETURNING: un periodo que ya existe es un CONFLICTO 'duplicado' (DATA lo contaba como guardado).
 *   · en el PLAN (el único con alta y baja) la versión del alta y de cada corrección sale de la secuencia
 *     proy_plan_version_seq (006), no de 0 / version+1: un periodo borrado y vuelto a crear nunca repite una
 *     versión, así que quien tenga la foto vieja choca en vez de pisarlo sin aviso (ABA). Las otras tres
 *     tablas solo se corrigen: allí sigue version+1.
 *   · todo lo que haría saltar un CHECK de 006 se valida ANTES de abrir la transacción, con un texto legible
 *     ({ok:false, error:'<texto>'}); si aun así la BD rechaza un dato, la respuesta es la misma forma, nunca un 500.
 *   · UN solo lote para las 4 pestañas: una transacción, lock `proyeccion:<obra>`; si algo choca, rollback de
 *     TODO y la respuesta trae la Proyección fresca.
 *
 * Fórmulas del plan (formulas = {col:'=47724+3413'}): la pantalla evalúa lo que se teclea con su propio
 * parser y manda el NÚMERO y, si fue fórmula, `formulas`. Aquí: una columna que llega en el cambio pierde su
 * fórmula guardada salvo que el mismo cambio traiga una para ella (teclear un número limpia la fórmula);
 * `formulas:{col:''}` la borra explícitamente. Una fórmula con texto viaja SIEMPRE con el número de su columna
 * (sin él, o con la celda vacía, se rechaza: no puede quedar una fórmula que no cuadre con lo guardado), y un
 * update que solo trae `formulas:{}` no es un cambio («no trae nada que guardar»).
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 */
import { OBRA_ID, ZONA_HORARIA, json, permiso_, logMarcar_, memo_, textoArrayPg_ } from '../../comun.js';

// D183: editan SOLO admin y jefe; el residente (y cualquier token válido) lee.
const PR_ROLES_EDITAN    = ['admin','jefe'];
const PR_USUARIOS_EDITAN = [];
const PR_MAX_CAMBIOS = 500;
const PR_MAX_FORMULA = 200;
const PR_NUM_MAX  = 1e9;       // m³ por celda: tope de cordura (el CHECK solo exige ≥ 0)
const PR_REND_MAX = 1e5;       // m³ compactos por equipo-día
const PR_FC_MIN = 0.5, PR_FC_MAX = 3;   // FC suelto→compacto razonable (hoy 1,3)

const PLAN_COLS = ['excavacion','terraplen','subbase','base','noaprov'];
// V3-22/D210: meta MENSUAL de horas-hombre de personal DIRECTO, SOLO por partida (worker/sql/013). Vive en la
// MISMA fila del plan (mismo periodo 16→15); se edita y se guarda con el mismo mecanismo que PLAN_COLS
// (número ≥ 0 o vacío = sin meta; admite fórmula). PLAN_COLS_TODOS es la lista combinada para lo genérico
// (prevalidación, fórmulas); la LECTURA se degrada sola si 013 no está aplicada (ver esSinColumnaHH_,
// planFilasCrudo_, planTableroCrudo_); la ESCRITURA (alta/update del plan) necesita 013 aplicada siempre,
// aunque el cambio no toque la meta (mismo criterio que `grupo` en flota.js, D190).
const HH_COLS = ['hh_excavacion','hh_terraplen','hh_subbase','hh_base'];
const PLAN_COLS_TODOS = PLAN_COLS.concat(HH_COLS);
const PARTIDAS_CONTRATO = ['excavacion','terraplen','subbase','base','prestamo'];
const PARTIDAS_REND = ['excavacion','terraplen','subbase','base'];
const UFS = ['UF1','UF2',''];
const ETQ_PLAN = { excavacion:'Excavación', terraplen:'Terraplén', subbase:'Subbase', base:'Base', noaprov:'No aprov.',
  hh_excavacion:'Meta HH · Excavación', hh_terraplen:'Meta HH · Terraplén', hh_subbase:'Meta HH · Subbase', hh_base:'Meta HH · Base' };
const ETQ_CONTRATO = { excavacion:'Excavación común', terraplen:'Terraplén', subbase:'Subbase', base:'BTC / Base', prestamo:'Excavación préstamos' };
const ETQ_REND = { excavacion:'Excavación', terraplen:'Terraplén', subbase:'Subbase', base:'BTC / Base' };
const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

// Metadatos de columnas por pestaña (`edita` = la teclea admin/jefe; el resto es clave o se DERIVA).
const COLUMNAS = {
  plan: [
    { k:'periodo',    etiqueta:'Periodo',    tipo:'periodo', edita:false },
    { k:'acta',       etiqueta:'Acta',       tipo:'texto',   edita:false },
    { k:'excavacion', etiqueta:ETQ_PLAN.excavacion, tipo:'num', edita:true },
    { k:'terraplen',  etiqueta:ETQ_PLAN.terraplen,  tipo:'num', edita:true },
    { k:'subbase',    etiqueta:ETQ_PLAN.subbase,    tipo:'num', edita:true },
    { k:'base',       etiqueta:ETQ_PLAN.base,       tipo:'num', edita:true },
    { k:'noaprov',    etiqueta:ETQ_PLAN.noaprov,    tipo:'num', edita:true },
    // V3-22/D210: meta de horas-hombre de personal directo, agrupadas bajo «Meta horas-hombre (personal directo)».
    { k:'hh_excavacion', etiqueta:ETQ_PLAN.excavacion,    tipo:'num', edita:true, grupo:'Meta horas-hombre (personal directo)' },
    { k:'hh_terraplen',  etiqueta:ETQ_PLAN.terraplen,     tipo:'num', edita:true, grupo:'Meta horas-hombre (personal directo)' },
    { k:'hh_subbase',    etiqueta:ETQ_PLAN.subbase,       tipo:'num', edita:true, grupo:'Meta horas-hombre (personal directo)' },
    { k:'hh_base',       etiqueta:ETQ_PLAN.base,          tipo:'num', edita:true, grupo:'Meta horas-hombre (personal directo)' }
  ],
  contrato: [
    { k:'partida',         etiqueta:'Partida',         tipo:'texto', edita:false },
    { k:'uf',              etiqueta:'UF',              tipo:'texto', edita:false },
    { k:'programado',      etiqueta:'Programado',      tipo:'num',   edita:true },
    { k:'produccion_base', etiqueta:'Producción base', tipo:'num',   edita:true }
  ],
  rendimiento: [
    { k:'partida',              etiqueta:'Partida',                       tipo:'texto', edita:false },
    { k:'rend_compacto_equipo', etiqueta:'Rend. compacto por equipo-día', tipo:'num',   edita:true },
    { k:'suelto_equipo',        etiqueta:'Proyectado suelto por equipo',  tipo:'num',   edita:false }
  ]
  // parametros: se arma por petición (la lista de actas sale de `periodos`)
};

// Lista blanca por tabla: clave, campos que se escriben y claves que la pantalla puede mandar de más y se ignoran
// (derivados y auditoría). Cualquier otra clave → rechazo legible. Las que empiezan por '_' (marcas del cliente) se ignoran.
const META = ['tabla','op','if_version'];
const TABLAS = {
  plan:        { nombre:'el Plan mensual',       clave:['periodo'],         campos:PLAN_COLS_TODOS.concat(['formulas']),
                 ignorar:['acta','version','editado_por','editado_ts'] },
  contrato:    { nombre:'Contrato y línea base', clave:['partida','uf'],    campos:['programado','produccion_base'],
                 ignorar:['etiqueta','orden','version','editado_por','editado_ts'] },
  rendimiento: { nombre:'Rendimientos',          clave:['partida'],         campos:['rend_compacto_equipo'],
                 ignorar:['etiqueta','suelto_equipo','vara_hora','fc','orden','version','editado_por','editado_ts'] },
  parametros:  { nombre:'Parámetros',            clave:[],                  campos:['fc','acta_base'],
                 ignorar:['base_corte','version','editado_por','editado_ts'] }
};

/* ---------- utilidades ---------- */
function txt_(v){ return String(v==null?'':v).trim(); }
function num_(v){
  if(v===null || v===undefined || v==='') return null;
  if(typeof v==='number') return isFinite(v) ? v : null;
  if(typeof v!=='string') return null;
  const n=Number(v.trim().replace(/\s/g,'').replace(',','.'));
  return isFinite(n) ? n : null;
}
function redondear_(n){ return Math.round(n*1e6)/1e6; }     // sin ruido de coma flotante (38848.799999999996 → 38848.8)
function numOVacio_(v){ return v==null ? '' : Number(v); }
function vacio_(v){ return v===null || (typeof v==='string' && v.trim()===''); }
function fmtN_(n){ return String(n).replace('.', ','); }
// «de» + etiqueta con la contracción: 'el periodo sep-2026' → 'del periodo sep-2026'.
function de_(s){ return /^el /.test(s) ? 'del '+s.slice(3) : 'de '+s; }
// 'YYYY-MM' o 'YYYY-MM-01' → 'YYYY-MM-01' ('' si no vale). Un plan es FUTURO: no se usa el validador 'f' de D166.
function periodoValido_(v){
  const m=/^(\d{4})-(\d{2})(?:-01)?$/.exec(txt_(v));
  if(!m) return '';
  const y=Number(m[1]), mm=Number(m[2]);
  if(y<2000 || y>2100 || mm<1 || mm>12) return '';
  return m[1]+'-'+m[2]+'-01';
}
function mesEtiqueta_(periodo){ return MESES[Number(periodo.slice(5,7))-1]+'-'+periodo.slice(0,4); }
function isoUtc_(d){ return d.getUTCFullYear()+'-'+('0'+(d.getUTCMonth()+1)).slice(-2)+'-'+('0'+d.getUTCDate()).slice(-2); }

/* ---------- actas (tabla periodos, 004) — una consulta por petición ---------- */
async function actas_(c){
  return memo_(c, 'proyeccion_actas', async function(){
    let per=[];
    try{ per = await c.sql`SELECT acta, to_char(fecha_inicial,'YYYY-MM-DD') AS fi, to_char(fecha_final,'YYYY-MM-DD') AS ff
                           FROM periodos WHERE obra_id=${OBRA_ID} ORDER BY fecha_inicial`; }catch(e){ per=[]; }
    return per.map(function(p){ return { acta:txt_(p.acta), fi:p.fi, ff:p.ff }; });
  });
}
// ACTA de un periodo del plan = la que CIERRA (fecha_final) en ese mes; si no está en `periodos`, la fórmula
// (año − 2025)·12 + mes + 2 (2025-08 → 10; 2026-09 → 23). Misma regla que la columna "ACTA" de proyeccion_plan_maestro.
function actaDePeriodo_(actas, periodo){
  const ym=String(periodo).slice(0,7);
  for(let i=0;i<actas.length;i++) if(String(actas[i].ff).slice(0,7)===ym) return actas[i].acta;
  const n=(Number(ym.slice(0,4))-2025)*12 + Number(ym.slice(5,7)) + 2;
  return n>=1 ? String(n) : '';
}
// Corte de la línea base = día siguiente al CIERRE del acta base; si el acta no está en `periodos`, 2025-07-16 +
// (acta − 9) meses (acta 22 → 2026-08-16). Misma regla que "CORTE BASE" de proyeccion_parametros_maestro.
function baseCorte_(actas, acta){
  const a=txt_(acta);
  for(let i=0;i<actas.length;i++) if(actas[i].acta===a && actas[i].ff){
    const p=actas[i].ff.split('-'); return isoUtc_(new Date(Date.UTC(Number(p[0]), Number(p[1])-1, Number(p[2])+1)));
  }
  if(/^\d{1,4}$/.test(a)) return isoUtc_(new Date(Date.UTC(2025, 6 + Number(a) - 9, 16)));
  return '';
}

// V3-22/D210: 42703 = la columna hh_* todavía no existe (013 sin aplicar). Mismo criterio que flotaFilas_
// (catalogos.js, D190) y el alta de flota.js: SOLO ese código de error cae al SELECT sin las metas; cualquier
// OTRO error se relanza (un fallo pasajero no puede esconderse detrás de "sin metas").
function esSinColumnaHH_(err){
  const m=String((err && err.message) || err);
  return !!(err && err.code==='42703') && /hh_(excavacion|terraplen|subbase|base)/i.test(m);
}
// SELECT crudo del plan CON las 4 metas de horas-hombre; degrada (sin ellas) si 013 no está aplicada.
async function planFilasCrudo_(c){
  try{
    return await c.sql`SELECT to_char(periodo,'YYYY-MM-DD') AS periodo, excavacion, terraplen, subbase, base, noaprov,
        hh_excavacion, hh_terraplen, hh_subbase, hh_base,
        formulas::text AS formulas, version, editado_por, to_char(editado_ts AT TIME ZONE ${ZONA_HORARIA},'YYYY-MM-DD HH24:MI') AS editado_ts
      FROM proy_plan WHERE obra_id=${OBRA_ID} ORDER BY periodo`;
  }catch(err){
    if(!esSinColumnaHH_(err)) throw err;
    return await c.sql`SELECT to_char(periodo,'YYYY-MM-DD') AS periodo, excavacion, terraplen, subbase, base, noaprov,
        formulas::text AS formulas, version, editado_por, to_char(editado_ts AT TIME ZONE ${ZONA_HORARIA},'YYYY-MM-DD HH24:MI') AS editado_ts
      FROM proy_plan WHERE obra_id=${OBRA_ID} ORDER BY periodo`;
  }
}
// Mismo SELECT, forma 'YYYY-MM' (la que consume proyeccionTableroDatos_/leerPlan del motor). Degrada igual.
async function planTableroCrudo_(c){
  try{
    return await c.sql`SELECT to_char(periodo,'YYYY-MM') AS k, excavacion, terraplen, subbase, base, noaprov,
        hh_excavacion, hh_terraplen, hh_subbase, hh_base
      FROM proy_plan WHERE obra_id=${OBRA_ID} ORDER BY periodo`;
  }catch(err){
    if(!esSinColumnaHH_(err)) throw err;
    return await c.sql`SELECT to_char(periodo,'YYYY-MM') AS k, excavacion, terraplen, subbase, base, noaprov
      FROM proy_plan WHERE obra_id=${OBRA_ID} ORDER BY periodo`;
  }
}

/* ---------- lectura de las 4 tablas ---------- */
async function payload_(c, ses){
  const actas = await actas_(c);
  const plan = await planFilasCrudo_(c);
  const contrato = await c.sql`SELECT partida, uf, programado, produccion_base, orden, version, editado_por,
      to_char(editado_ts AT TIME ZONE ${ZONA_HORARIA},'YYYY-MM-DD HH24:MI') AS editado_ts
    FROM proy_contrato WHERE obra_id=${OBRA_ID} ORDER BY orden, partida, uf`;
  // Totales por partida en numeric (UF1 + UF2; el préstamo solo): los que usa el Tablero (CONTRATO / BASE_ACUM).
  const resumen = await c.sql`SELECT partida, sum(programado) AS programado, sum(produccion_base) AS produccion_base, min(orden) AS orden
    FROM proy_contrato WHERE obra_id=${OBRA_ID} GROUP BY partida ORDER BY min(orden)`;
  const rend = await c.sql`SELECT r.partida, r.rend_compacto_equipo, (r.rend_compacto_equipo * pa.fc) AS suelto_equipo, r.orden,
      r.version, r.editado_por, to_char(r.editado_ts AT TIME ZONE ${ZONA_HORARIA},'YYYY-MM-DD HH24:MI') AS editado_ts
    FROM proy_rendimiento r LEFT JOIN proy_parametros pa ON pa.obra_id = r.obra_id
    WHERE r.obra_id=${OBRA_ID} ORDER BY r.orden, r.partida`;
  const par = await c.sql`SELECT fc, acta_base, version, editado_por, to_char(editado_ts AT TIME ZONE ${ZONA_HORARIA},'YYYY-MM-DD HH24:MI') AS editado_ts
    FROM proy_parametros WHERE obra_id=${OBRA_ID}`;

  const filasPlan = plan.map(function(r){
    let formulas={};
    try{ const o=JSON.parse(r.formulas||'{}'); if(o && typeof o==='object' && !Array.isArray(o)) formulas=o; }catch(e){ formulas={}; }
    const f={ periodo:r.periodo };
    PLAN_COLS_TODOS.forEach(function(k){ f[k]=numOVacio_(r[k]); });
    f.formulas=formulas; f.acta=actaDePeriodo_(actas, r.periodo);
    f.version=Number(r.version||0); f.editado_por=txt_(r.editado_por); f.editado_ts=txt_(r.editado_ts);
    return f;
  });
  const filasContrato = contrato.map(function(r){
    return { partida:r.partida, uf:txt_(r.uf), etiqueta:ETQ_CONTRATO[r.partida]||r.partida,
             programado:numOVacio_(r.programado), produccion_base:numOVacio_(r.produccion_base), orden:Number(r.orden||0),
             version:Number(r.version||0), editado_por:txt_(r.editado_por), editado_ts:txt_(r.editado_ts) };
  });
  const filasRend = rend.map(function(r){
    return { partida:r.partida, etiqueta:ETQ_REND[r.partida]||r.partida,
             rend_compacto_equipo:numOVacio_(r.rend_compacto_equipo), suelto_equipo:numOVacio_(r.suelto_equipo), orden:Number(r.orden||0),
             version:Number(r.version||0), editado_por:txt_(r.editado_por), editado_ts:txt_(r.editado_ts) };
  });
  const filasPar = par.map(function(r){
    return { fc:numOVacio_(r.fc), acta_base:txt_(r.acta_base), base_corte:baseCorte_(actas, r.acta_base),
             version:Number(r.version||0), editado_por:txt_(r.editado_por), editado_ts:txt_(r.editado_ts) };
  });
  const colsPar = [
    { k:'fc',         etiqueta:'FC (suelto → compacto)',  tipo:'num',   edita:true },
    { k:'acta_base',  etiqueta:'Acta base',               tipo:'lista', edita:true, opciones:actas.map(function(a){ return a.acta; }) },
    { k:'base_corte', etiqueta:'Corte de la línea base',  tipo:'fecha', edita:false }
  ];
  return {
    ok:true,
    tablas:{
      plan:        { columnas:COLUMNAS.plan,        filas:filasPlan },
      contrato:    { columnas:COLUMNAS.contrato,    filas:filasContrato,
                     resumen: resumen.map(function(r){ return { partida:r.partida, etiqueta:ETQ_CONTRATO[r.partida]||r.partida,
                       programado:numOVacio_(r.programado), produccion_base:numOVacio_(r.produccion_base) }; }) },
      rendimiento: { columnas:COLUMNAS.rendimiento, filas:filasRend },
      parametros:  { columnas:colsPar,              filas:filasPar }
    },
    actas: actas,
    puede_editar: permiso_(ses, PR_ROLES_EDITAN, PR_USUARIOS_EDITAN, 'editar la Proyección').ok,   // lo decide el SERVIDOR
    roles_editan: PR_ROLES_EDITAN
  };
}

/* ---------- GET ?action=proyeccion ---------- */
export async function proyeccionLeer(c, params, ses){
  try{ return json(c, await payload_(c, ses)); }
  catch(err){ if(esSinTablas_(err)) return json(c, { ok:false, error:PR_SIN_TABLAS }); throw err; }
}

/* ---------- GET ?action=proyeccion_tablero ----------
 * La forma EXACTA que ya consume el motor de tablero-produccion.js, para que el 3er parámetro de construir()
 * sustituya a las lecturas del Excel y a las constantes sin tocar el resto:
 *   plan        ← leerPlan (CALCULOS): {'YYYY-MM': {excavacion, terraplen, subbase, base, noaprov}} — 5 claves
 *                 siempre, vacía → 0 (como num() del motor), sin la clave fantasma '1899-12' de la fila A20.
 *   proyectado  ← leerProyectado (CALCULOS P1:T1): suelto por equipo = rend × fc, en numeric (1105/585/455/611).
 *   contrato    ← CONTRATO; base_acum ← BASE_ACUM (UF1 + UF2 sumado en numeric; el préstamo aparte).
 *   base_corte  ← BASE_CORTE; fc ← FC_DEFECTO.
 *   plan_hh     ← V3-22/D210: {'YYYY-MM': {excavacion, terraplen, subbase, base}} — meta MENSUAL de horas-hombre
 *                 de personal DIRECTO por partida (worker/sql/013_meta_horas_hombre.sql); NULL = sin meta (nunca
 *                 0 por defecto). Aparte de `plan` (que sigue igual): lo compara el Tablero contra `personal`
 *                 (tablero_vivo.js). Sin 013 aplicada, sale con las 4 claves en null (degrada, no tumba nada).
 * `actualizado`/`usuario` = la última edición de cualquiera de las 4 tablas (hora de Bogotá; '' si nunca). */
export async function proyeccionTablero(c, params, ses){
  try{ return json(c, await proyeccionTableroDatos_(c)); }
  catch(err){ if(esSinTablas_(err)) return json(c, { ok:false, error:PR_SIN_TABLAS }); throw err; }
}
/* El objeto de proyeccion_tablero SIN `_ms` (no pasa por json): lo usa también el Tablero en vivo (tablero_vivo.js,
 * D185), que le quita `usuario` antes de la lectura pública. Sin 006 en la BD lanza el 42P01 (quien llama decide). */
export async function proyeccionTableroDatos_(c){
  const par = await c.sql`SELECT fc, acta_base FROM proy_parametros WHERE obra_id=${OBRA_ID}`;
  if(!par.length) return { ok:false, error:'La Proyección no tiene parámetros (FC y acta base) en Galca.' };
  const actas = await actas_(c);
  const baseCorte = baseCorte_(actas, par[0].acta_base);
  if(!baseCorte) return { ok:false, error:'No se pudo derivar el corte de la línea base (acta «'+txt_(par[0].acta_base)+'»).' };

  const planF = await planTableroCrudo_(c);
  const plan = {};
  // V3-22/D210: meta de horas-hombre por periodo, aparte del plan de m³ (`plan`, que no cambia de forma: sigue
  // con NULL → 0 como siempre). NULL = sin meta (nunca 0 por defecto: 0 sería «meta cero», otra cosa).
  const planHh = {};
  planF.forEach(function(r){
    const o={}; PLAN_COLS.forEach(function(k){ o[k]= r[k]==null ? 0 : Number(r[k]); }); plan[r.k]=o;
    const h={}; HH_COLS.forEach(function(k){ h[k.slice(3)]= r[k]==null ? null : Number(r[k]); }); planHh[r.k]=h;
  });

  const rend = await c.sql`SELECT r.partida, (r.rend_compacto_equipo * pa.fc) AS suelto
    FROM proy_rendimiento r JOIN proy_parametros pa ON pa.obra_id = r.obra_id
    WHERE r.obra_id=${OBRA_ID} ORDER BY r.orden`;
  const proyectado = {};
  rend.forEach(function(r){ if(PARTIDAS_REND.indexOf(r.partida)>=0) proyectado[r.partida]=Number(r.suelto); });

  const con = await c.sql`SELECT partida, COALESCE(sum(programado),0) AS programado, COALESCE(sum(produccion_base),0) AS base
    FROM proy_contrato WHERE obra_id=${OBRA_ID} GROUP BY partida`;
  const contrato = {}, baseAcum = {};
  PARTIDAS_CONTRATO.forEach(function(k){ contrato[k]=0; baseAcum[k]=0; });
  con.forEach(function(r){ if(r.partida in contrato){ contrato[r.partida]=Number(r.programado); baseAcum[r.partida]=Number(r.base); } });

  const ult = await c.sql`SELECT to_char(ts AT TIME ZONE ${ZONA_HORARIA},'YYYY-MM-DD HH24:MI') AS act, por FROM (
      SELECT editado_ts AS ts, editado_por AS por FROM proy_plan        WHERE obra_id=${OBRA_ID} AND editado_ts IS NOT NULL
      UNION ALL SELECT editado_ts, editado_por FROM proy_contrato       WHERE obra_id=${OBRA_ID} AND editado_ts IS NOT NULL
      UNION ALL SELECT editado_ts, editado_por FROM proy_rendimiento    WHERE obra_id=${OBRA_ID} AND editado_ts IS NOT NULL
      UNION ALL SELECT editado_ts, editado_por FROM proy_parametros     WHERE obra_id=${OBRA_ID} AND editado_ts IS NOT NULL
    ) x ORDER BY ts DESC LIMIT 1`;

  return {
    ok:true, fuente:'galca',
    actualizado: ult.length ? txt_(ult[0].act) : '',
    usuario:     ult.length ? txt_(ult[0].por) : '',
    fc: Number(par[0].fc), acta_base: txt_(par[0].acta_base), base_corte: baseCorte,
    plan: plan, plan_hh: planHh, proyectado: proyectado, contrato: contrato, base_acum: baseAcum
  };
}

/* ---------- prevalidación de UN cambio (todo lo que haría saltar un CHECK de 006, en texto legible) ----------
 * Devuelve {error} o la escritura lista: {tabla, op, clave, etiqueta, if_version, set, vals, …}. */
function prevalidar_(ch, i, actas){
  const n = 'El cambio nº '+(i+1);
  if(!ch || typeof ch!=='object' || Array.isArray(ch)) return { error:n+' no es válido.' };
  const tabla = txt_(ch.tabla).toLowerCase();
  const def = TABLAS[tabla];
  if(!def) return { error:n+' no dice a qué parte de la Proyección va (plan, contrato, rendimiento o parametros).' };
  const op = (txt_(ch.op) || 'update').toLowerCase();
  if(['alta','update','baja'].indexOf(op)<0) return { error:'Operación «'+op+'» no reconocida (alta, update, baja).' };
  const claves = Object.keys(ch);
  for(let j=0;j<claves.length;j++){
    const k=claves[j];
    if(k.charAt(0)==='_' || META.indexOf(k)>=0 || def.clave.indexOf(k)>=0 || def.campos.indexOf(k)>=0 || def.ignorar.indexOf(k)>=0) continue;
    return { error:'«'+k+'» no es un dato que se pueda guardar en '+def.nombre+'.' };
  }
  if(op!=='update' && tabla!=='plan') return { error:'En '+def.nombre+' solo se corrigen valores: no se pueden añadir ni borrar filas.' };

  let e;
  if(tabla==='plan') e = prevalidarPlan_(ch, op);
  else if(tabla==='contrato') e = prevalidarContrato_(ch);
  else if(tabla==='rendimiento') e = prevalidarRend_(ch);
  else e = prevalidarParametros_(ch, actas);
  if(e.error) return e;
  e.tabla=tabla; e.op=op;

  if(op!=='alta'){
    // D183: if_version OBLIGATORIO en update y baja (la grilla de DATA lo ponía en 0 si faltaba). Se mira el
    // texto recortado: ' ' o '\t' pasan el 'e' de D166 (Number('') = 0) y no pueden valer como versión 0.
    const vt = txt_(ch.if_version);
    if(vt==='') return { error:'Falta la versión (if_version) '+de_(e.etiqueta)+'. Recarga la Proyección y vuelve a guardar.' };
    if(!/^\d{1,9}$/.test(vt)) return { error:'La versión (if_version) '+de_(e.etiqueta)+' no es válida.' };
    e.if_version = Number(vt);
  }
  if(op==='update' && !e.hayAlgo) return { error:'El cambio '+de_(e.etiqueta)+' no trae nada que guardar.' };
  return e;
}

// Número ≥ 0 de una celda; '' / null = vacío (solo si `admiteVacio`). Devuelve {v} o {error}.
function numeroCelda_(v, que, admiteVacio, max){
  if(vacio_(v)){ return admiteVacio ? { v:null } : { error:que+' no puede quedar vacío.' }; }
  const n = num_(v);
  if(n===null) return { error:que+' («'+txt_(v)+'») no es un número.' };
  if(n<0) return { error:que+' no puede ser negativo.' };
  if(n>max) return { error:que+' es demasiado grande (máx. '+fmtN_(max)+').' };
  return { v:redondear_(n) };
}

function prevalidarPlan_(ch, op){
  const periodo = periodoValido_(ch.periodo);
  if(!periodo) return { error:'El periodo «'+txt_(ch.periodo)+'» no es válido: usa AAAA-MM (p. ej. 2026-09).' };
  const et = mesEtiqueta_(periodo);
  const e = { clave:periodo, periodo:periodo, etiqueta:'el periodo '+et, set:{}, vals:{}, poner:{}, quitar:[], hayAlgo:false };
  if(op==='baja') return e;
  for(let j=0;j<PLAN_COLS_TODOS.length;j++){
    const k=PLAN_COLS_TODOS[j];
    if(ch[k]===undefined) continue;
    const r = numeroCelda_(ch[k], ETQ_PLAN[k]+' de '+et, true, PR_NUM_MAX);
    if(r.error) return r;
    e.set[k]=true; e.vals[k]=r.v; e.hayAlgo=true;
    e.quitar.push(k);   // la columna tecleada pierde la fórmula guardada (salvo que el cambio traiga otra, abajo)
  }
  if(ch.formulas!==undefined && ch.formulas!==null){
    const fo = ch.formulas;
    if(typeof fo!=='object' || Array.isArray(fo)) return { error:'Las fórmulas de '+et+' no son válidas.' };
    const ks = Object.keys(fo);
    for(let j=0;j<ks.length;j++){
      const k=ks[j];
      if(PLAN_COLS_TODOS.indexOf(k)<0) return { error:'Hay una fórmula en una columna que no existe («'+k+'») en '+et+'.' };
      const f=fo[k];
      if(f===null || f===undefined || f===''){ if(e.quitar.indexOf(k)<0) e.quitar.push(k); continue; }
      if(typeof f!=='string') return { error:'La fórmula de '+ETQ_PLAN[k]+' en '+et+' no es texto.' };
      const s=f.trim();
      if(s.charAt(0)!=='=' || s.length>PR_MAX_FORMULA || /[\x00-\x1F\x7F]/.test(s))
        return { error:'La fórmula de '+ETQ_PLAN[k]+' en '+et+' no es válida (empieza por «=», máx. '+PR_MAX_FORMULA+' caracteres).' };
      // D183 (revisión): la fórmula es la del NÚMERO que se guarda, así que viaja con él en el mismo cambio. Sin
      // ese número (o con la celda vacía) quedaría una fórmula que no cuadra con lo guardado: se rechaza.
      if(!e.set[k] || e.vals[k]===null)
        return { error:'La fórmula de '+ETQ_PLAN[k]+' en '+et+' llega sin su resultado: manda el número de la celda junto con la fórmula.' };
      e.poner[k]=s;
    }
  }
  // Solo cuenta como cambio lo que escribe algo: un valor, una fórmula nueva o una fórmula que se borra.
  // `formulas:{}` a secas no sube la versión ni mueve la «última edición» que ve el Tablero.
  if(Object.keys(e.poner).length || e.quitar.length) e.hayAlgo = true;
  return e;
}

function prevalidarContrato_(ch){
  const partida = txt_(ch.partida).toLowerCase();
  if(PARTIDAS_CONTRATO.indexOf(partida)<0)
    return { error:'La partida «'+txt_(ch.partida)+'» no está en el contrato (excavacion, terraplen, subbase, base o prestamo).' };
  const uf = txt_(ch.uf).toUpperCase().replace(/\s/g,'');
  if(UFS.indexOf(uf)<0) return { error:'La UF «'+txt_(ch.uf)+'» no es válida (UF1, UF2, o vacía en el préstamo).' };
  if((partida==='prestamo') !== (uf===''))
    return { error: partida==='prestamo' ? 'La Excavación préstamos va sin UF.' : ETQ_CONTRATO[partida]+' necesita la UF (UF1 o UF2).' };
  const et = ETQ_CONTRATO[partida]+(uf ? ' '+uf : '');
  const e = { clave:partida+'|'+uf, partida:partida, uf:uf, etiqueta:et, set:{}, vals:{}, hayAlgo:false };
  const campos = { programado:'Programado', produccion_base:'Producción base' };
  for(const k in campos){
    if(ch[k]===undefined) continue;
    const r = numeroCelda_(ch[k], campos[k]+' de '+et, false, PR_NUM_MAX);
    if(r.error) return r;
    e.set[k]=true; e.vals[k]=r.v; e.hayAlgo=true;
  }
  return e;
}

function prevalidarRend_(ch){
  const partida = txt_(ch.partida).toLowerCase();
  if(PARTIDAS_REND.indexOf(partida)<0)
    return { error:'La partida «'+txt_(ch.partida)+'» no tiene rendimiento (excavacion, terraplen, subbase o base).' };
  const et = 'el rendimiento de '+ETQ_REND[partida];
  const e = { clave:partida, partida:partida, etiqueta:et, set:{}, vals:{}, hayAlgo:false };
  if(ch.rend_compacto_equipo!==undefined){
    const que = 'El rendimiento de '+ETQ_REND[partida];
    const r = numeroCelda_(ch.rend_compacto_equipo, que, false, PR_REND_MAX);
    if(r.error) return r;
    if(!(r.v>0)) return { error:que+' tiene que ser mayor que 0.' };
    e.set.rend_compacto_equipo=true; e.vals.rend_compacto_equipo=r.v; e.hayAlgo=true;
  }
  return e;
}

function prevalidarParametros_(ch, actas){
  const e = { clave:'', etiqueta:'los parámetros', set:{}, vals:{}, hayAlgo:false };
  if(ch.fc!==undefined){
    if(vacio_(ch.fc)) return { error:'El FC no puede quedar vacío.' };
    const n = num_(ch.fc);
    if(n===null) return { error:'El FC («'+txt_(ch.fc)+'») no es un número.' };
    if(!(n>0) || n<PR_FC_MIN || n>PR_FC_MAX)
      return { error:'El FC tiene que estar entre '+fmtN_(PR_FC_MIN)+' y '+fmtN_(PR_FC_MAX)+' (suelto → compacto; hoy se usa 1,3).' };
    e.set.fc=true; e.vals.fc=redondear_(n); e.hayAlgo=true;
  }
  if(ch.acta_base!==undefined){
    let a = txt_(ch.acta_base);
    if(!a) return { error:'El acta base no puede quedar vacía.' };
    const existe = actas.some(function(p){ return p.acta===a; });
    if(!existe){
      if(/^\d{1,3}$/.test(a) && Number(a)>=1) a = String(Number(a));
      else return { error:'El acta base «'+a+'» no existe: elige una de la lista'+(actas.length ? ' ('+actas[0].acta+' a '+actas[actas.length-1].acta+')' : '')+' o un número de acta.' };
    }
    e.set.acta_base=true; e.vals.acta_base=a; e.hayAlgo=true;
  }
  return e;
}

// Sin la migración 006 en la BD (42P01 = la tabla no existe): la lectura responde legible y el Tablero cae al Excel.
const PR_SIN_TABLAS = 'La Proyección todavía no está en la base de datos (falta aplicar worker/sql/006_proyeccion.sql).';
function esSinTablas_(err){ return String((err && err.code) || '')==='42P01'; }
// Un error de DATOS de Postgres (clase 22 = dato inválido, 23 = restricción): se responde legible, no 500.
function esErrorDeDatos_(err){ return /^(22|23)/.test(String((err && err.code) || '')); }
function rechazo_(c, msg){ logMarcar_(c, 'rechazado', 'proyeccion: '+msg); return json(c, { ok:false, error:msg }); }
function conflicto_(e, motivo){
  const o = { tabla:e.tabla, clave:e.clave, motivo:motivo };
  if(e.periodo) o.periodo=e.periodo;
  if(e.partida) o.partida=e.partida;
  if(e.uf!==undefined) o.uf=e.uf;
  return o;
}
function v_(e, k){ return e.set[k] ? e.vals[k] : null; }

/* ---------- POST {action:'proyeccion_guardar'} ---------- */
export async function proyeccionGuardar(c, body, ses){
  const permiso = permiso_(ses, PR_ROLES_EDITAN, PR_USUARIOS_EDITAN, 'editar la Proyección');
  if(!permiso.ok){ logMarcar_(c, 'rechazado', 'proyeccion: '+permiso.error); return json(c, { ok:false, error:permiso.error }); }

  const cambios = Array.isArray(body.cambios) ? body.cambios : [];
  if(!cambios.length) return rechazo_(c, 'No llegó ningún cambio para guardar.');
  if(cambios.length>PR_MAX_CAMBIOS) return rechazo_(c, 'Demasiados cambios de una vez (máx. '+PR_MAX_CAMBIOS+'). Guarda por partes.');

  const actas = await actas_(c);
  const usuario = txt_(ses && ses.usuario) || 'jefe';

  // Prevalidación de TODO el lote antes de tocar la BD: el primer error se devuelve legible y no se guarda nada.
  const escrituras = [], vistos = {};
  for(let i=0;i<cambios.length;i++){
    const e = prevalidar_(cambios[i], i, actas);
    if(e.error) return rechazo_(c, e.error);
    const k = e.tabla+'|'+e.clave;
    if(vistos[k]) return rechazo_(c, 'La fila '+de_(e.etiqueta)+' viene dos veces en el mismo guardado: junta los cambios en uno.');
    vistos[k]=1;
    escrituras.push(e);
  }

  const conflictos=[];
  let errBd=null;
  function _Rollback_(){ this.marca='proy_rollback'; }
  try{
    await c.sql.begin(async function(sql){
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'proyeccion:'+OBRA_ID}))`;
      for(let i=0;i<escrituras.length;i++){
        const e=escrituras[i];
        let r;
        if(e.tabla==='plan' && e.op==='alta'){
          r = await sql`INSERT INTO proy_plan (obra_id, periodo, excavacion, terraplen, subbase, base, noaprov,
                    hh_excavacion, hh_terraplen, hh_subbase, hh_base, formulas, version, editado_por, editado_ts)
            VALUES (${OBRA_ID}, ${e.periodo}::date, ${v_(e,'excavacion')}::numeric, ${v_(e,'terraplen')}::numeric, ${v_(e,'subbase')}::numeric,
                    ${v_(e,'base')}::numeric, ${v_(e,'noaprov')}::numeric,
                    ${v_(e,'hh_excavacion')}::numeric, ${v_(e,'hh_terraplen')}::numeric, ${v_(e,'hh_subbase')}::numeric, ${v_(e,'hh_base')}::numeric,
                    ${JSON.stringify(e.poner)}::text::jsonb,
                    nextval('proy_plan_version_seq')::integer, ${usuario}, now())
            ON CONFLICT (obra_id, periodo) DO NOTHING RETURNING periodo`;
          if(!r.length) conflictos.push(conflicto_(e, 'duplicado'));   // D183: un periodo que ya existe NO cuenta como guardado
        } else if(e.tabla==='plan' && e.op==='baja'){
          r = await sql`DELETE FROM proy_plan WHERE obra_id=${OBRA_ID} AND periodo=${e.periodo}::date AND version=${e.if_version} RETURNING periodo`;
          if(!r.length) conflictos.push(conflicto_(e, 'version'));
        } else if(e.tabla==='plan'){
          r = await sql`UPDATE proy_plan SET
              excavacion = CASE WHEN ${!!e.set.excavacion}::boolean THEN ${v_(e,'excavacion')}::numeric ELSE excavacion END,
              terraplen  = CASE WHEN ${!!e.set.terraplen}::boolean  THEN ${v_(e,'terraplen')}::numeric  ELSE terraplen  END,
              subbase    = CASE WHEN ${!!e.set.subbase}::boolean    THEN ${v_(e,'subbase')}::numeric    ELSE subbase    END,
              base       = CASE WHEN ${!!e.set.base}::boolean       THEN ${v_(e,'base')}::numeric       ELSE base       END,
              noaprov    = CASE WHEN ${!!e.set.noaprov}::boolean    THEN ${v_(e,'noaprov')}::numeric    ELSE noaprov    END,
              hh_excavacion = CASE WHEN ${!!e.set.hh_excavacion}::boolean THEN ${v_(e,'hh_excavacion')}::numeric ELSE hh_excavacion END,
              hh_terraplen  = CASE WHEN ${!!e.set.hh_terraplen}::boolean  THEN ${v_(e,'hh_terraplen')}::numeric  ELSE hh_terraplen  END,
              hh_subbase    = CASE WHEN ${!!e.set.hh_subbase}::boolean    THEN ${v_(e,'hh_subbase')}::numeric    ELSE hh_subbase    END,
              hh_base       = CASE WHEN ${!!e.set.hh_base}::boolean       THEN ${v_(e,'hh_base')}::numeric       ELSE hh_base       END,
              formulas   = (formulas - ${textoArrayPg_(e.quitar)}::text[]) || ${JSON.stringify(e.poner)}::text::jsonb,
              version = nextval('proy_plan_version_seq')::integer, editado_por=${usuario}, editado_ts=now()
            WHERE obra_id=${OBRA_ID} AND periodo=${e.periodo}::date AND version=${e.if_version} RETURNING periodo`;
          if(!r.length) conflictos.push(conflicto_(e, 'version'));
        } else if(e.tabla==='contrato'){
          r = await sql`UPDATE proy_contrato SET
              programado      = CASE WHEN ${!!e.set.programado}::boolean      THEN ${v_(e,'programado')}::numeric      ELSE programado      END,
              produccion_base = CASE WHEN ${!!e.set.produccion_base}::boolean THEN ${v_(e,'produccion_base')}::numeric ELSE produccion_base END,
              version = version+1, editado_por=${usuario}, editado_ts=now()
            WHERE obra_id=${OBRA_ID} AND partida=${e.partida} AND uf=${e.uf} AND version=${e.if_version} RETURNING partida`;
          if(!r.length) conflictos.push(conflicto_(e, 'version'));
        } else if(e.tabla==='rendimiento'){
          r = await sql`UPDATE proy_rendimiento SET rend_compacto_equipo=${v_(e,'rend_compacto_equipo')}::numeric,
              version = version+1, editado_por=${usuario}, editado_ts=now()
            WHERE obra_id=${OBRA_ID} AND partida=${e.partida} AND version=${e.if_version} RETURNING partida`;
          if(!r.length) conflictos.push(conflicto_(e, 'version'));
        } else {
          r = await sql`UPDATE proy_parametros SET
              fc        = CASE WHEN ${!!e.set.fc}::boolean        THEN ${v_(e,'fc')}::numeric ELSE fc        END,
              acta_base = CASE WHEN ${!!e.set.acta_base}::boolean THEN ${v_(e,'acta_base')}::text ELSE acta_base END,
              version = version+1, editado_por=${usuario}, editado_ts=now()
            WHERE obra_id=${OBRA_ID} AND version=${e.if_version} RETURNING obra_id`;
          if(!r.length) conflictos.push(conflicto_(e, 'version'));
        }
      }
      if(conflictos.length) throw new _Rollback_();   // rollback de TODO el lote (las 4 pestañas)
    });
  }catch(err){
    if(err instanceof _Rollback_){ /* conflictos: se responde abajo */ }
    // V3-22/D210: si 013 no está aplicada, INSERT/UPDATE del plan con hh_* falla en 42703 (aunque el cambio no
    // tocara la meta: las 4 columnas van siempre en la sentencia). Mensaje legible, como el 42703 de `grupo` en
    // flota.js (D190); nunca un 500. Cualquier otro dato inválido o BD sin 006: el camino de siempre.
    else if(esSinColumnaHH_(err) || esErrorDeDatos_(err) || esSinTablas_(err)) errBd = err;
    else throw err;
  }

  delete c.memo['proyeccion_actas'];
  if(errBd){
    logMarcar_(c, 'rechazado', 'proyeccion: BD '+String(errBd.code||'')+' '+String(errBd.message||''));
    if(esSinTablas_(errBd)) return json(c, { ok:false, error:PR_SIN_TABLAS+' No se guardó nada.' });
    if(esSinColumnaHH_(errBd)) return json(c, { ok:false, error:'Falta aplicar la migración 013_meta_horas_hombre.sql en la base de datos (meta de horas-hombre del Plan). No se guardó nada.' });
    return json(c, { ok:false, error:'La base de datos rechazó el guardado ('+String(errBd.message||errBd.code||'dato no válido')+'). No se guardó nada.' });
  }
  if(conflictos.length){
    const out = await payload_(c, ses);
    const dup = conflictos.filter(function(x){ return x.motivo==='duplicado'; });
    const ver = conflictos.length - dup.length;
    const partes = [];
    if(dup.length) partes.push(dup.length===1 ? 'el periodo '+mesEtiqueta_(dup[0].periodo)+' ya existe' : dup.length+' periodos ya existen');
    if(ver) partes.push('alguien más editó '+ver+' fila(s) mientras tanto');
    out.ok=false; out.error='version'; out.conflictos=conflictos;
    out.mensaje = partes.join(' y ').replace(/^./, function(s){ return s.toUpperCase(); })
      + '. No se guardó nada; se recargó la Proyección: revisa y vuelve a guardar.';
    logMarcar_(c, 'rechazado', 'proyeccion: conflicto ('+conflictos.length+')');
    return json(c, out);
  }
  const out = await payload_(c, ses);
  out.guardadas = escrituras.length;
  out.mensaje = 'Se guardaron '+escrituras.length+' cambio(s) en la Proyección.';
  return json(c, out);
}

/* ---------- esquema D166 del payload (lo importa api/obra.js) ----------
 * Solo tipos y longitudes: los rangos y catálogos (≥ 0, rend > 0, FC razonable, partida/UF, acta base) los
 * valida el handler con un texto legible. El periodo va como texto ('t', 10) porque el plan es FUTURO y el
 * validador 'f' rechaza fechas futuras. 'l' compara en minúsculas. `formulas` (objeto) lo valida el handler. */
export const VAL_PROYECCION = { cambios:['a', PR_MAX_CAMBIOS] };
export const VAL_PROYECCION_CAMBIO = {
  tabla:['l',['plan','contrato','rendimiento','parametros']], op:['l',['alta','update','baja']],
  if_version:['e',0,100000000],
  periodo:['t',10], partida:['t',20], uf:['t',5], acta_base:['t',10],
  excavacion:['n',-1e15,1e15], terraplen:['n',-1e15,1e15], subbase:['n',-1e15,1e15], base:['n',-1e15,1e15], noaprov:['n',-1e15,1e15],
  hh_excavacion:['n',-1e15,1e15], hh_terraplen:['n',-1e15,1e15], hh_subbase:['n',-1e15,1e15], hh_base:['n',-1e15,1e15],
  programado:['n',-1e15,1e15], produccion_base:['n',-1e15,1e15], rend_compacto_equipo:['n',-1e15,1e15], fc:['n',-1e15,1e15]
};
