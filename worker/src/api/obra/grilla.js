/**
 * api/obra/grilla.js — GRILLA EDITABLE de los catálogos fundacionales (V3-08 · D181, sep-2026).
 *
 * Fuente única de edición (D181): los editores autorizados —incluido el JEFE— editan los catálogos que
 * alimentan DATA desde la app, con una grilla tipo Excel, VALIDACIÓN server-side y CONTROL DE VERSIÓN POR
 * FILA (if_version). Empieza por `base_elementos` (subtramos), donde está el retrabajo que D181 elimina.
 *
 *   GET  ?action=grid&tabla=subtramos        TOKEN → gridLeer: filas + análisis (solapes, duplicados, tope)
 *   GET  ?action=grid&tabla=centros_costo    TOKEN → gridLeer: base_items (SOLO LECTURA en este corte)
 *   POST {action:'grid_guardar', tabla, cambios:[…]}  TOKEN → gridGuardar: alta | update | baja por lote
 *
 * Reglas de negocio de subtramos (contra el Excel maestro real, hoja BASE — ver 03_BACKLOG V3-08):
 *   · NO-SOLAPAMIENTO — los subtramos LINEALES ("tm2 pk X - Y" = TRAMO; MSR) son ventanas [ini, fin] que
 *     no se pisan DENTRO de su mismo tipo. Se compara con intervalo SEMIABIERTO (a.ini < b.fin && b.ini <
 *     a.fin), como las estancias de flota (_flotaTraslapa_): dos subtramos ENCADENADOS que comparten el
 *     extremo (fin==inicio del siguiente) NO se consideran solape — así es la cadena real de la BASE.
 *     Un cambio que deje un solape SOBRE UNA FILA TOCADA se rechaza (D181: «avisar y ajustar/retirar el
 *     que choca, no dejar ambos»). Los solapes preexistentes que el lote no toca se informan, no bloquean.
 *   · DOS «AJUSTE A ORIGEN» — «ajuste origen UF1» [9800,29950] y «ajuste origen UF2» [30000,39600] abarcan
 *     el corredor COMPLETO de su UF y NO son operativos: se conservan en la lista pero quedan FUERA del
 *     no-solapamiento y del cálculo de tope. Se reconocen por la bandera `no_operativo` (003_grilla.sql) o
 *     por el nombre (^ajuste origen), porque el backfill los carga DESPUÉS de la migración.
 *   · CASCADA — al mover el límite de un subtramo encadenado, los consiguientes anclados a ese punto se
 *     recorrerían detrás. Aquí se INFORMA el impacto (qué filas se recorren) pero NO se aplica solo: el
 *     modo (automático vs revisión manual) queda pendiente de cerrar con César (03_BACKLOG V3-08).
 *   · DUPLICADOS — nombres de ELEMENTO repetidos (existen en la BASE real: ODT1-024, ODT2-006…) se
 *     informan como aviso; un ALTA que repita la tripleta exacta (elemento, abs_inicio, abs_fin) se avisa.
 *
 * if_version: cada UPDATE/DELETE lleva `AND version=${if_version}`; si afecta 0 filas es que otra persona
 * editó esa fila mientras tanto → conflicto. El lote es ATÓMICO (una transacción): si hay algún conflicto,
 * se hace rollback de todo y el cliente recarga y reintenta (no se guarda a medias).
 *
 * Guard de rol (D109): permiso_ sobre la sesión de puerta_ (no `body._rol`). El JEFE SÍ escribe aquí
 * (a diferencia de Maquinaria, donde entra en solo lectura): D181 le devuelve el control de los catálogos.
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 */
import { OBRA_ID, json, permiso_, logMarcar_, memo_, normTexto } from '../../comun.js';
import { baseAbs, baseTipo, invalidarMemo_ } from '../../catalogos.js';

/* ---------- quién ESCRIBE la grilla (guard en el SERVIDOR, D109/D181) ----------
 * El JEFE entra como editor de los catálogos fundacionales (a diferencia de la flota). `jeisson`
 * (asistencia_plus) es el usuario suelto ya usado en otros guards; César entra como admin. */
const GRID_ROLES_ESCRIBEN    = ['admin','jefe','residente'];
const GRID_USUARIOS_ESCRIBEN = ['jeisson'];

const VAL_ELEMENTO_MAX = 120;

/* Tablas que sirve la grilla. `subtramos` es editable; `centros_costo` es solo lectura en este corte. */
const GRID_TABLAS = {
  subtramos: {
    tabla: 'base_elementos',
    editable: true,
    columnas: [
      { k:'elemento',     etiqueta:'Elemento',      tipo:'texto', editable:true },
      { k:'abs_inicio',   etiqueta:'Abs inicio',    tipo:'abs',   editable:true },
      { k:'abs_fin',      etiqueta:'Abs fin',       tipo:'abs',   editable:true },
      { k:'uf',           etiqueta:'UF',            tipo:'lista', opciones:['','UF1','UF2'], editable:true },
      { k:'no_operativo', etiqueta:'No operativo',  tipo:'bool',  editable:true },
      { k:'tipo',         etiqueta:'Tipo (auto)',   tipo:'texto', editable:false }
    ]
  },
  centros_costo: {
    tabla: 'base_items',
    editable: false,
    columnas: [
      { k:'cc',          etiqueta:'CC',          tipo:'texto', editable:false },
      { k:'descripcion', etiqueta:'Descripción', tipo:'texto', editable:false },
      { k:'unidad',      etiqueta:'Unidad',      tipo:'texto', editable:false },
      { k:'capitulo',    etiqueta:'Capítulo',    tipo:'texto', editable:false },
      { k:'grupo',       etiqueta:'Grupo',       tipo:'texto', editable:false },
      { k:'uf',          etiqueta:'UF',          tipo:'texto', editable:false },
      { k:'proyecto',    etiqueta:'Proyecto',    tipo:'texto', editable:false }
    ]
  }
};

/* ---------- helpers puros ---------- */
function esNoOperativo_(elemento, flag){
  if(flag===true) return true;
  return /^\s*ajuste\s*origen/i.test(String(elemento==null?'':elemento));
}
function esLineal_(tipo){ return tipo==='TRAMO' || tipo==='MSR'; }   // ventanas [ini,fin] que no se pisan
function boolv_(v){
  if(v===true) return true;
  if(v===false || v===null || v===undefined || v==='') return false;
  const s=String(v).trim().toLowerCase();
  return (s==='true' || s==='si' || s==='sí' || s==='1');
}
function intv_(v, def){ const n=parseInt(v,10); return isFinite(n) ? n : (def||0); }
// intervalo semiabierto, como _flotaTraslapa_: encadenados (fin==ini) NO se pisan
function traslapa_(a, b){ return a.ini < b.fin && b.ini < a.fin; }

/* ---------- lectura del estado actual de subtramos (memo por petición) ----------
 * Clave de memo PROPIA ('grid_base_elementos') para no chocar con baseRows_ ('base_elementos'), que
 * devuelve OTRA forma y filtra por tipo. Aquí se leen TODAS las filas, tal cual, para editarlas. */
export async function gridFilasSubtramos_(c){
  return memo_(c, 'grid_base_elementos', async function(){
    let filas=[];
    try{
      filas = await c.sql`SELECT orden, elemento, abs_inicio, abs_fin, uf, tipo, no_operativo, version
                            FROM base_elementos WHERE obra_id=${OBRA_ID} ORDER BY orden`;
    }catch(err){ filas=[]; }
    return filas.map(function(r){
      const elemento = String(r.elemento==null?'':r.elemento);
      return {
        orden: Number(r.orden),
        elemento: elemento,
        abs_inicio: String(r.abs_inicio==null?'':r.abs_inicio),
        abs_fin: String(r.abs_fin==null?'':r.abs_fin),
        uf: String(r.uf==null?'':r.uf),
        tipo: baseTipo(elemento),                 // autoridad: se recalcula del nombre (como baseRows_)
        no_operativo: esNoOperativo_(elemento, r.no_operativo===true),
        version: Number(r.version||0),
        ini_m: baseAbs(r.abs_inicio),
        fin_m: baseAbs(r.abs_fin)
      };
    });
  });
}

/* ---------- análisis del conjunto: solapes, duplicados, tope por UF ---------- */
export function analizarSubtramos_(filas){
  const overlaps=[], duplicados=[], porNombre={};
  const tope={};
  // duplicados de nombre + tope por UF (excluyendo no operativos)
  filas.forEach(function(r){
    const n=normTexto(r.elemento); if(n){ (porNombre[n]=porNombre[n]||[]).push(r.orden); }
    if(!r.no_operativo && esLineal_(r.tipo) && r.fin_m!=null){
      const uf=r.uf||'—';
      if(tope[uf]==null || r.fin_m>tope[uf]) tope[uf]=r.fin_m;
    }
  });
  Object.keys(porNombre).forEach(function(n){ if(porNombre[n].length>1) duplicados.push({ elementos_norm:n, ordenes:porNombre[n] }); });
  // solapes: por tipo lineal, ventana [ini,fin] con fin>ini, excluyendo no operativos
  const lineales = filas.filter(function(r){ return !r.no_operativo && esLineal_(r.tipo) && r.ini_m!=null && r.fin_m!=null && r.fin_m>r.ini_m; });
  const porTipo={}; lineales.forEach(function(r){ (porTipo[r.tipo]=porTipo[r.tipo]||[]).push(r); });
  Object.keys(porTipo).forEach(function(tipo){
    const ls=porTipo[tipo].slice().sort(function(a,b){ return a.ini_m-b.ini_m; });
    for(let i=0;i<ls.length;i++) for(let j=i+1;j<ls.length;j++){
      if(traslapa_({ini:ls[i].ini_m, fin:ls[i].fin_m}, {ini:ls[j].ini_m, fin:ls[j].fin_m})){
        overlaps.push({
          a:{ orden:ls[i].orden, elemento:ls[i].elemento, ini:ls[i].ini_m, fin:ls[i].fin_m },
          b:{ orden:ls[j].orden, elemento:ls[j].elemento, ini:ls[j].ini_m, fin:ls[j].fin_m }
        });
      }
    }
  });
  return { overlaps:overlaps, duplicados:duplicados, tope:tope,
           no_operativos: filas.filter(function(r){ return r.no_operativo; }).map(function(r){ return r.orden; }) };
}

/* ---------- impacto de cascada (informativo; NO se aplica solo) ----------
 * Si un update mueve el `fin` de un TRAMO que hoy encadena con el siguiente (fin==ini del siguiente),
 * lista los subtramos consiguientes que quedarían «descolgados» y habría que recorrer. */
function cascadaImpacto_(actuales, updates){
  const avisos=[];
  const tramos = actuales.filter(function(r){ return r.tipo==='TRAMO' && r.ini_m!=null && r.fin_m!=null; })
                         .slice().sort(function(a,b){ return a.ini_m-b.ini_m; });
  updates.forEach(function(u){
    const viejo = actuales.filter(function(r){ return r.orden===u.orden; })[0];
    if(!viejo || viejo.tipo!=='TRAMO' || viejo.fin_m==null) return;
    const nuevoFin = baseAbs(u.campos.abs_fin);
    if(nuevoFin==null || nuevoFin===viejo.fin_m) return;
    // ¿había un TRAMO que empezaba justo donde este terminaba?
    const siguientes = tramos.filter(function(r){ return r.orden!==viejo.orden && r.ini_m===viejo.fin_m; });
    siguientes.forEach(function(sig){
      avisos.push('Al mover el fin de «'+viejo.elemento+'» de '+viejo.fin_m+' a '+nuevoFin+', el subtramo «'+sig.elemento
        +'» (que empezaba en '+viejo.fin_m+') queda descolgado: define si se recorre (cascada) o se revisa a mano.');
    });
  });
  return avisos;
}

/* ---------- normalización + validación de una fila propuesta ---------- */
function normalizarCampos_(ch, cur){
  cur = cur || {};
  function t(v, def){ return v===undefined ? String(def==null?'':def) : String(v==null?'':v).trim(); }
  const elemento   = t(ch.elemento,   cur.elemento);
  const abs_inicio = t(ch.abs_inicio, cur.abs_inicio);
  const abs_fin    = t(ch.abs_fin,    cur.abs_fin);
  let uf = t(ch.uf, cur.uf).toUpperCase();
  const no_operativo = (ch.no_operativo===undefined) ? !!cur.no_operativo : boolv_(ch.no_operativo);
  return { elemento:elemento, abs_inicio:abs_inicio, abs_fin:abs_fin, uf:uf, no_operativo:no_operativo };
}
function validarFila_(campos){
  if(!campos.elemento) return 'el elemento no puede quedar vacío.';
  if(campos.elemento.length>VAL_ELEMENTO_MAX) return 'el elemento supera '+VAL_ELEMENTO_MAX+' caracteres.';
  if(['','UF1','UF2'].indexOf(campos.uf)<0) return 'la UF debe ser UF1, UF2 o vacío.';
  const ini = campos.abs_inicio==='' ? null : baseAbs(campos.abs_inicio);
  const fin = campos.abs_fin==='' ? null : baseAbs(campos.abs_fin);
  if(campos.abs_inicio!=='' && ini==null) return 'la abscisa inicio «'+campos.abs_inicio+'» no se entiende (usa metros o PK «20+875»).';
  if(campos.abs_fin!=='' && fin==null)    return 'la abscisa fin «'+campos.abs_fin+'» no se entiende (usa metros o PK «20+875»).';
  if(ini!=null && fin!=null && fin<ini)   return 'la abscisa fin ('+fin+') no puede ser menor que la inicio ('+ini+').';
  return '';
}

/* ---------- payload de lectura (se reusa tras escribir para devolver el estado fresco) ---------- */
async function subtramosPayload_(c){
  const filas = await gridFilasSubtramos_(c);
  return { ok:true, tabla:'subtramos', editable:true, roles_editan:GRID_ROLES_ESCRIBEN,
           columnas:GRID_TABLAS.subtramos.columnas, filas:filas, analisis:analizarSubtramos_(filas) };
}

async function centrosCostoPayload_(c){
  let filas=[];
  try{
    filas = await c.sql`SELECT cc, descripcion, unidad, capitulo, grupo, uf, proyecto, orden
                          FROM base_items WHERE obra_id=${OBRA_ID} ORDER BY orden`;
  }catch(err){ filas=[]; }
  return { ok:true, tabla:'centros_costo', editable:false, roles_editan:GRID_ROLES_ESCRIBEN,
           columnas:GRID_TABLAS.centros_costo.columnas,
           filas: filas.map(function(r){ return {
             orden:Number(r.orden||0), cc:String(r.cc==null?'':r.cc), descripcion:String(r.descripcion==null?'':r.descripcion),
             unidad:String(r.unidad==null?'':r.unidad), capitulo:String(r.capitulo==null?'':r.capitulo),
             grupo:String(r.grupo==null?'':r.grupo), uf:String(r.uf==null?'':r.uf), proyecto:String(r.proyecto==null?'':r.proyecto) };
           }),
           nota:'Solo lectura por ahora: la edición de centros de coste desde la grilla es el siguiente paso de V3-08.' };
}

/* ---------- GET ?action=grid ---------- */
export async function gridLeer(c, params){
  const tabla = String((params && params.tabla) || 'subtramos').trim().toLowerCase();
  if(tabla==='centros_costo') return json(c, await centrosCostoPayload_(c));
  if(tabla==='subtramos' || tabla==='') return json(c, await subtramosPayload_(c));
  return json(c, { ok:false, error:'Tabla «'+tabla+'» no reconocida. Opciones: subtramos, centros_costo.' });
}

/* ---------- POST {action:'grid_guardar'} ---------- */
export async function gridGuardar(c, body, ses){
  const permiso = permiso_(ses, GRID_ROLES_ESCRIBEN, GRID_USUARIOS_ESCRIBEN, 'editar los catálogos fundacionales');
  if(!permiso.ok){ logMarcar_(c, 'rechazado', 'grilla: '+permiso.error); return json(c, { ok:false, error:permiso.error }); }

  const tabla = String(body.tabla||'subtramos').trim().toLowerCase();
  if(tabla!=='subtramos')
    return json(c, { ok:false, error:'Por ahora solo el catálogo de subtramos es editable desde la grilla. «'+tabla+'» es de solo lectura.' });

  const cambios = Array.isArray(body.cambios) ? body.cambios : [];
  if(!cambios.length) return json(c, { ok:false, error:'No llegó ningún cambio para guardar.' });
  if(cambios.length>500) return json(c, { ok:false, error:'Demasiados cambios de una vez (máx. 500). Guarda por partes.' });

  const actuales = await gridFilasSubtramos_(c);
  const porOrden = {}; actuales.forEach(function(r){ porOrden[r.orden]=r; });

  // Estado propuesto (mapa por orden) + lista de escrituras normalizadas.
  const mapa = new Map(actuales.map(function(r){ return [r.orden, Object.assign({}, r)]; }));
  const escrituras = [];
  const tocados = {};   // ordenes que este lote modifica (para acotar el bloqueo por solape)
  let maxOrden = actuales.reduce(function(m,r){ return Math.max(m, r.orden); }, 0);

  for(let i=0;i<cambios.length;i++){
    const ch = cambios[i];
    const op = String(ch.op||'update').trim().toLowerCase();
    if(op==='update'){
      const cur = porOrden[ch.orden];
      if(!cur) return json(c, { ok:false, error:'La fila '+ch.orden+' ya no existe (¿alguien la borró?). Vuelve a cargar la grilla.' });
      const campos = normalizarCampos_(ch, cur);
      const err = validarFila_(campos); if(err) return json(c, { ok:false, error:'Fila «'+(cur.elemento||ch.orden)+'»: '+err });
      escrituras.push({ op:'update', orden:cur.orden, if_version:intv_(ch.if_version, cur.version), campos:campos });
      tocados[cur.orden]=true;
      mapa.set(cur.orden, filaDerivada_(cur.orden, cur.version, campos));
    } else if(op==='alta'){
      const campos = normalizarCampos_(ch, {});
      const err = validarFila_(campos); if(err) return json(c, { ok:false, error:'Alta: '+err });
      maxOrden += 1;
      escrituras.push({ op:'alta', orden:maxOrden, campos:campos });
      tocados[maxOrden]=true;
      mapa.set(maxOrden, filaDerivada_(maxOrden, 0, campos));
    } else if(op==='baja'){
      const cur = porOrden[ch.orden];
      if(!cur) continue;   // ya no está: nada que borrar
      escrituras.push({ op:'baja', orden:cur.orden, if_version:intv_(ch.if_version, cur.version) });
      tocados[cur.orden]=true;
      mapa.delete(cur.orden);
    } else {
      return json(c, { ok:false, error:'Operación «'+op+'» no reconocida (alta, update, baja).' });
    }
  }

  // Validación del CONJUNTO propuesto: un solape que involucre una fila TOCADA bloquea (D181).
  const propuesto = Array.from(mapa.values());
  const an = analizarSubtramos_(propuesto);
  const solapeBloqueante = an.overlaps.filter(function(o){ return tocados[o.a.orden] || tocados[o.b.orden]; });
  if(solapeBloqueante.length && !body.forzar_solape){
    const o = solapeBloqueante[0];
    logMarcar_(c, 'rechazado', 'grilla: solape');
    return json(c, { ok:false, error:'solape',
      solapes: solapeBloqueante,
      mensaje:'«'+o.a.elemento+'» ['+o.a.ini+'–'+o.a.fin+'] se pisa con «'+o.b.elemento+'» ['+o.b.ini+'–'+o.b.fin+']. '
        + 'Ajusta o retira el que choca antes de guardar (D181: no se dejan los dos).' });
  }

  const updates = escrituras.filter(function(e){ return e.op==='update'; });
  const cascada = cascadaImpacto_(actuales, updates);

  // Escritura ATÓMICA con if_version. Si hay conflicto, rollback total (sentinela).
  const conflictos=[];
  function _Rollback_(){ this.marca='grid_rollback'; }
  try{
    await c.sql.begin(async function(sql){
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'grid:base_elementos:'+OBRA_ID}))`;
      for(let i=0;i<escrituras.length;i++){
        const e=escrituras[i];
        if(e.op==='update'){
          const r=await sql`UPDATE base_elementos
            SET elemento=${e.campos.elemento}, abs_inicio=${e.campos.abs_inicio}, abs_fin=${e.campos.abs_fin},
                uf=${e.campos.uf}, tipo=${baseTipo(e.campos.elemento)}, no_operativo=${e.campos.no_operativo},
                version=version+1, importado_ts=now()
            WHERE obra_id=${OBRA_ID} AND orden=${e.orden} AND version=${e.if_version} RETURNING orden`;
          if(!r.length) conflictos.push({ orden:e.orden, motivo:'version' });
        } else if(e.op==='alta'){
          await sql`INSERT INTO base_elementos (obra_id, elemento, abs_inicio, abs_fin, uf, tipo, orden, no_operativo, version)
            VALUES (${OBRA_ID}, ${e.campos.elemento}, ${e.campos.abs_inicio}, ${e.campos.abs_fin}, ${e.campos.uf},
                    ${baseTipo(e.campos.elemento)}, ${e.orden}, ${e.campos.no_operativo}, 0)`;
        } else if(e.op==='baja'){
          const r=await sql`DELETE FROM base_elementos WHERE obra_id=${OBRA_ID} AND orden=${e.orden} AND version=${e.if_version} RETURNING orden`;
          if(!r.length) conflictos.push({ orden:e.orden, motivo:'version' });
        }
      }
      if(conflictos.length) throw new _Rollback_();
    });
  }catch(e){
    if(!(e instanceof _Rollback_)) throw e;   // error real → index.js lo captura ({ok:false,error:'worker'})
  }

  invalidarMemo_(c, ['grid_base_elementos','base_elementos']);   // la BASE también la leen otros endpoints

  if(conflictos.length){
    const out = await subtramosPayload_(c);
    out.ok=false; out.error='version'; out.conflictos=conflictos;
    out.mensaje='Alguien más editó '+conflictos.length+' fila(s) mientras tanto; se recargaron con los valores actuales. Revisa y vuelve a guardar solo lo tuyo.';
    return json(c, out);
  }

  const out = await subtramosPayload_(c);
  out.guardadas = escrituras.length;
  out.cascada = cascada;
  out.mensaje = 'Se guardaron '+escrituras.length+' cambio(s).' + (cascada.length ? ' Revisa el aviso de cascada.' : '');
  return json(c, out);
}

// Fila con los campos derivados (tipo, no_op, metros) a partir de los campos crudos.
function filaDerivada_(orden, version, campos){
  return {
    orden:orden, version:version,
    elemento:campos.elemento, abs_inicio:campos.abs_inicio, abs_fin:campos.abs_fin, uf:campos.uf,
    tipo:baseTipo(campos.elemento), no_operativo:esNoOperativo_(campos.elemento, campos.no_operativo),
    ini_m:campos.abs_inicio===''?null:baseAbs(campos.abs_inicio), fin_m:campos.abs_fin===''?null:baseAbs(campos.abs_fin)
  };
}

/* ---------- esquemas D166 del payload (los importa api/obra.js → validarPayloadObra_) ---------- */
export const VAL_OBRA_GRID = { tabla:['t',40], forzar_solape:['b'], aplicar_cascada:['b'] };
export const VAL_OBRA_GRID_CAMBIO = {
  op:['l',['update','alta','baja']], orden:['e',0,1000000], if_version:['e',0,100000000],
  elemento:['t',VAL_ELEMENTO_MAX], abs_inicio:['t',30], abs_fin:['t',30], uf:['t',10], no_operativo:['b']
};
