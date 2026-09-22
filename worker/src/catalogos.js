/**
 * catalogos.js — catálogos de OBRA y del PARTE + flota, leídos de Postgres (4.01 · Fases 3–4 · D180).
 *
 * Es la parte de backend/Codigo.gs que lee las hojas-catálogo del Sheet de obra (BASE, CUBICAJE,
 * MAQUINAS, MAQUINARIA solo la columna id_maquina) y la de CodigoParte.gs que lee PARTE_EQUIPOS, con
 * los MISMOS nombres de función y la MISMA lógica, sobre las tablas de la sección 5 del esquema
 * (worker/sql/001_esquema.sql) + `maquinas` + `parte_equipos`. Desde 4.01 esos catálogos se editan en
 * Supabase (Table Editor), no en el Sheet: no hay pull Sheet→BD (decisión 1).
 *
 * Qué cambia respecto al .gs y por qué:
 *   · Los memos de ejecución (`_baseRows`, `_cubMap`, `_flotaRows`, `_fichasParte`, `_idsMaquinaria`)
 *     pasan a `memo_(c, clave, …)` (comun.js): una consulta por tabla y PETICIÓN. Una escritura que
 *     después relee llama a invalidarMemo_(c, ['maquinas','equipos']).
 *   · No hay detección de encabezados (getBaseData L733–L744, getCubicajeMap L999–L1005, getFlotaRows_
 *     L1647–L1657): las columnas son las de la tabla.
 *   · `flotaFilas_` (= getFlotaRows_) ordena por (id_maquina, fecha_ingreso); `_row` es el ordinal en
 *     esa lista (+2, como si la tabla fuera una hoja con encabezado) y los avisos de flotaEnFecha_ citan
 *     «Estancia ID desde YYYY-MM-DD» en vez de «Fila N»: ninguna pantalla los parsea.
 *   · Los helpers de una línea que el Parte tenía privados (parteTexto_/parteNum_/parteSiNo_/
 *     parteMedidor_) se duplican aquí como privados para no crear un import circular con api/parte.js.
 *
 * Quién lo usa: api/parte.js (equipos, flota vigente, ítems de la BASE), api/obra/* (BASE, CUBICAJE,
 * flota, fichas del Parte, ids del histórico de MAQUINARIA). Asistencias tiene sus propios catálogos
 * en api/asistencias/catalogos.js (otro Sheet, otras tablas).
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo } (lo arma src/index.js por petición).
 */
import { OBRA_ID, memo_, fdate, fdateValida_, hoyBogota, normTexto, ccCorto, deriveArea } from './comun.js';

/* ---------- helpers privados (copias de parteTexto_/parteNum_/parteSiNo_/parteMedidor_ de api/parte.js) ---------- */
function texto_(v){ return String(v==null?'':v).trim(); }
function num_(v){
  if(v===null || v===undefined || v==='') return null;
  if(typeof v==='number') return isFinite(v) ? v : null;
  const n=Number(String(v).trim().replace(/\s/g,'').replace(',','.'));
  return isFinite(n) ? n : null;
}
function siNo_(v, defecto){
  const s=String(v==null?'':v).trim().toUpperCase();
  if(!s) return defecto;
  return !(s==='NO' || s==='N' || s==='FALSE' || s==='0' || s==='INACTIVO' || s==='INACTIVA');
}
function medidor_(v){
  const s=normTexto(v);
  if(s.indexOf('HOR')===0) return 'HOROMETRO';
  if(s==='KM' || s.indexOf('KILOM')===0) return 'KM';
  return '';
}

/* Borra claves del memo de la petición tras una escritura que después relee (flotaGuardar → 'maquinas',
 * fichaParteAsegurar_ → 'equipos'). Sin claves, borra todo. */
export function invalidarMemo_(c, claves){
  if(!c || !c.memo) return;
  if(!claves || !claves.length){ Object.keys(c.memo).forEach(function(k){ delete c.memo[k]; }); return; }
  claves.forEach(function(k){ delete c.memo[k]; });
}

/* ======================================================================================================
 * Codigo.gs L164–L185 — tipos sin producción (D171) y catálogo del capataz desde PARTE_EQUIPOS
 * ====================================================================================================== */
// D171: el tipo llega con el vocabulario de PARTE_EQUIPOS (`COMPACTADORES`, `VIBROCOMPACTADOR RENTAL 900`,
// `RETROCARGADOR`, `MINICARGADOR`…), así que se decide por CONTENIDO, no por igualdad.
export function esTipoSinProduccion(tipo){
  const t=String(tipo||'').toUpperCase();
  if(!t) return false;
  return t.indexOf('COMPACTADOR')>=0 || t.indexOf('MINICARGADOR')>=0 || t.indexOf('MINIBULDOZER')>=0
      || t.indexOf('RETROEXCAVADORA')>=0 || t.indexOf('RETROCARGADOR')>=0;
}
/* D171 — catálogo único de máquinas para el reporte del capataz: las fichas de parte_equipos (D165)
 * vigentes en la flota ESE día (D173). Si algo falla devuelve [] y el capataz cae a `maquinas` (flota.js). */
export async function equiposCapataz_(c, fecha){
  try{
    return (await parteEquiposActivos_(c, fecha||'')).map(function(q){ return { codigo:q.codigo, tipo:q.tipo||'', placa:q.placa||'' }; })
      .sort(function(a,b){ const ta=a.tipo.toUpperCase(), tb=b.tipo.toUpperCase();
        return ta<tb?-1:ta>tb?1:(a.codigo<b.codigo?-1:a.codigo>b.codigo?1:0); });
  }catch(err){ return []; }
}
// Mapa código normalizado → {codigo,tipo,placa} para completar el tipo de un equipo que llega solo como código.
export async function equiposCapatazMapa_(c, fecha){
  const m={}; (await equiposCapataz_(c, fecha)).forEach(function(q){ m[String(q.codigo).replace(/[^A-Za-z0-9]/g,'').toUpperCase()]=q; }); return m;
}

/* ======================================================================================================
 * Codigo.gs L632–L656 — PK ↔ metros y ELEMENTO «tm2 pk a - b»
 * ====================================================================================================== */
export function pkMeters(s){
  if(s==null) return null;
  const t=String(s).toLowerCase().replace(/pk/g,'').replace(/\s+/g,'');
  const m=t.match(/(\d+)\+(\d+)/);
  if(m) return parseInt(m[1],10)*1000 + parseInt(m[2],10);
  const n=parseFloat(t);
  return isNaN(n) ? null : n*1000;
}
export function pkFmt(meters){
  if(meters==null || isNaN(meters)) return '';
  const km=Math.floor(meters/1000), r=Math.round(meters-km*1000);
  return km + '+' + ('00'+r).slice(-3);
}
export function pkNorm(s){ return pkFmt(pkMeters(s)); }
export function buildElemento(pkIni, pkFin){
  let ini=pkIni, fin=pkFin;
  if((fin==null||fin==='') && pkIni!=null){           // rango tecleado en un solo campo
    const p=String(pkIni).split(/\s*-\s*/);
    if(p.length>=2){ ini=p[0]; fin=p.slice(1).join(' - '); }
  }
  const a=pkNorm(ini);
  if(!a) return '';                                    // sin PK válido: el llamador decide
  const b=pkNorm(fin);
  return b ? ('tm2 pk '+a+' - '+b) : ('tm2 pk '+a);
}

/* ======================================================================================================
 * Codigo.gs L675–L707 — BASE: vocabulario de la tabla de ELEMENTOS (D63/D68/D69/D79)
 * ====================================================================================================== */
export const BASE_TOL_M = 30; // metros de tolerancia para ajustar un PK cercano a un tramo (error humano)
// Abscisa de la BASE a metros: número = metros tal cual; texto con '+' = PK ("20+875"→20875).
export function baseAbs(v){
  if(v===''||v==null) return null;
  if(typeof v==='number') return isNaN(v)?null:v;
  const s=String(v).trim();
  if(s.indexOf('+')>=0) return pkMeters(s);
  const n=Number(s);
  return isNaN(n)?null:n;
}
// Tipo de un elemento de la BASE por su texto. '' = fuera de alcance.
// D69: los marcadores ODT* (drenajes) se cachean con tipo propio 'ODT' — los usan SOLO las filas de área
// ODT/ODL (lookupMarcadorODT). En tierras se siguen ignorando: ningún baseSetFor devuelve 'ODT'.
export function baseTipo(elem){
  const e=String(elem==null?'':elem);
  if(/^\s*tm2\s*pk/i.test(e)) return 'TRAMO';
  if(/diviso/i.test(e))       return 'DIVISO';
  if(/^\s*msr/i.test(e))      return 'MSR';
  if(/^\s*rcd/i.test(e))      return 'RCD';
  if(/zodme/i.test(e))        return 'ZODME';   // conformación con destino ZODME (elige el residente, D79)
  if(/^\s*odt/i.test(e))      return 'ODT';     // marcadores de drenajes (abscisa puntual, D69)
  return '';                                     // demás -> fuera
}
// Conjunto de elementos a usar según el CC corto de la actividad (NN.NN).
export function baseSetFor(ccCortoStr){
  const c=String(ccCortoStr||'');
  if(c==='02.06') return 'DIVISO';                       // excavación de préstamo
  if(c.indexOf('05.')===0 || c==='02.12') return 'MSR';  // estructuras / MSR
  if(c==='02.08') return 'RCD';                          // conformación/disposición (default; destino ZODME se fuerza vía setForzado, D79)
  return 'TRAMO';                                        // aprovechable/no aprovechable/terraplén/subbase/base
}

/* ---------- Codigo.gs L2187–L2210 — ítems extra (D71) y variantes por material (D113c) de drenajes ---------- */
export const EXTRA_DREN = {
  '01.02': { areas:['odt','odl'], capitulo:'DEMOLICIONES Y REUBICACIONES' } // Demolición de Estructuras
};
export const VARIANTES_DREN = {
  // 06.02 = "Rellenos con material seleccionado" (ODT). El nombre sin variante sigue siendo el del ítem.
  '06.02': ['Relleno con crudo de río', 'Relleno de UF3']
};

/* ---------- Codigo.gs L759–L797 — tabla de ÍTEMS (A–H) de la BASE → tabla base_items ----------
 * Devuelve { items: { [cc completo]: [{desc, norm}], [cc corto 'NN.NN']: [misma lista] }  (varios candidatos
 * por CC, en orden de hoja = `orden`), drenItems: [{cc, corto, area, desc, unidad, actividad?, variante?,
 * capitulo?, extra?}] (catálogo de DRENAJES D69: ítems de capítulo 06 (odt) y 07 (odl) + variantes + extras, deduplicado por
 * cc|norm(desc)) }. `desc` es la celda cruda (typos incluidos); `norm` solo para comparar. */
export async function baseItems_(c){
  return memo_(c, 'base_items', async function(){
    const items={}, drenItems=[], drenSeen={};
    let filas=[];
    try{ filas=await c.sql`SELECT cc, descripcion, unidad FROM base_items WHERE obra_id=${OBRA_ID} ORDER BY orden`; }
    catch(err){ filas=[]; /* sin BASE: sin descripción (como getBaseData sin hoja) */ }
    filas.forEach(function(r){
      const ccKey=texto_(r.cc);
      const d=r.descripcion;
      if(ccKey && d!=='' && d!=null){
        const it={ desc:d, norm:normTexto(d) };           // desc = celda cruda; norm solo para comparar
        (items[ccKey]=items[ccKey]||[]).push(it);
        const corto=ccCorto(ccKey);                       // registra también la llave corta "NN.NN"
        if(corto && corto!==ccKey) (items[corto]=items[corto]||[]).push(it);
        // catálogo de DRENAJES (D69): TODOS los ítems .06.* (ODT) y .07.* (ODL), por proyecto,
        // con la descripción verbatim (typos incluidos) y la unidad si la tabla la trae.
        const areaIt=deriveArea(ccKey);
        if(areaIt!=='tierras'){
          const u=(r.unidad!=null) ? String(r.unidad).trim() : '';
          const dk=ccKey+'|'+it.norm;
          if(!drenSeen[dk]){ drenSeen[dk]=1;
            drenItems.push({ cc:ccKey, corto:corto||ccKey, area:areaIt, desc:String(d), unidad:u }); }
          // D113c: variantes por MATERIAL del mismo ítem (mismo CC/desc/unidad, distinta `actividad`).
          const vars = corto ? VARIANTES_DREN[corto] : null;
          if(vars) vars.forEach(function(nombreAct){
            const vk=dk+'|'+nombreAct;
            if(!drenSeen[vk]){ drenSeen[vk]=1;
              drenItems.push({ cc:ccKey, corto:corto||ccKey, area:areaIt, desc:String(d), unidad:u,
                               actividad:nombreAct, variante:true }); }
          });
        } else if(corto && EXTRA_DREN[corto]){
          // Ítems "extra" de drenajes (D71): viven bajo un CC que deriva 'tierras' pero deben ofrecerse
          // en los reportes de drenajes con su propio capítulo, para cada área configurada.
          const cfg=EXTRA_DREN[corto];
          const u=(r.unidad!=null) ? String(r.unidad).trim() : '';
          cfg.areas.forEach(function(ar){
            const dk=ar+'|'+ccKey+'|'+it.norm;
            if(!drenSeen[dk]){ drenSeen[dk]=1;
              drenItems.push({ cc:ccKey, corto:corto, area:ar, desc:String(d), unidad:u, capitulo:cfg.capitulo, extra:true }); }
          });
        }
      }
    });
    return { items:items, drenItems:drenItems };
  });
}

/* ---------- Codigo.gs L745–L757 — tabla de ELEMENTOS (J/K/L) de la BASE → tabla base_elementos ----------
 * Devuelve [{elem, ini, fin, tipo, rawIni, rawFin}] en orden de hoja (`orden`; el orden importa como
 * desempate en lookupElemento L934). `tipo` sale de baseTipo(elem) como en L748 (la columna `tipo` de la
 * tabla es informativa: el backfill la escribe con la misma función); tipo '' (fuera de alcance) se
 * descarta. rawIni/rawFin: abs_inicio/abs_fin TAL CUAL (texto), para copiar a ABS (D68). */
export async function baseRows_(c){
  return memo_(c, 'base_elementos', async function(){
    const out=[];
    let filas=[];
    try{ filas=await c.sql`SELECT elemento, abs_inicio, abs_fin FROM base_elementos WHERE obra_id=${OBRA_ID} ORDER BY orden`; }
    catch(err){ filas=[]; }
    filas.forEach(function(r){
      const elem=r.elemento;                                // J = ELEMENTO
      if(elem==='' || elem==null) return;
      const tipo=baseTipo(elem);
      if(!tipo) return;                                     // ODT sin patrón y otros -> fuera
      let ini=baseAbs(r.abs_inicio), fin=baseAbs(r.abs_fin); // K = ABS INICIO, L = ABS FIN (a metros, para el match)
      if(fin==null) fin=ini;
      if(ini==null) ini=fin;
      if(ini!=null && fin!=null && fin<ini){ const t=ini; ini=fin; fin=t; }
      out.push({ elem:String(elem), ini:ini, fin:fin, tipo:tipo, rawIni:r.abs_inicio, rawFin:r.abs_fin });
    });
    return out;
  });
}
export const baseElementos_ = baseRows_;   // mismo lector, nombre del mapa de la migración

/* ---------- D184 · FC por ACTIVIDAD (tabla fc_actividad, 007_data_completa.sql) ----------
 * El FC (factor suelto→compacto) depende de la actividad: el MÁS USADO en el histórico de DATA del Excel
 * (lo que no cuadra son errores de digitación). La tabla trae solo las que NO son 1 (hoy 7 descripciones con
 * 1.3); sin fila = FC 1. Es una tabla PROPIA (no una columna de base_items) para que un backfill del catálogo
 * BASE no la borre. El cruce es por DESCRIPCIÓN normalizada con normTexto (mayúsculas, sin tildes, espacios
 * colapsados): la misma normalización que usa 007 en SQL para rellenar DATA.
 *   fcActividad_(c) → { [normTexto(descripcion)]: fc }   (una consulta por PETICIÓN, memo_ como la BASE;
 *                      sin la tabla —BD sin 007— devuelve {} y todo queda en FC 1; por eso, en producción,
 *                      007 se pasa ANTES del `wrangler deploy` de D184: docs/OPERACIONES.md §12)
 *   fcDeActividad(mapa, descripcion) → fc de la actividad o 1. */
export async function fcActividad_(c){
  return memo_(c, 'fc_actividad', async function(){
    const out={};
    let filas=[];
    try{ filas=await c.sql`SELECT descripcion, fc FROM fc_actividad WHERE obra_id=${OBRA_ID} ORDER BY descripcion`; }
    catch(err){ filas=[]; }
    filas.forEach(function(r){
      const k=normTexto(r.descripcion), n=Number(r.fc);
      if(k && isFinite(n) && n>0 && !(k in out)) out[k]=n;   // dos filas que normalizan igual: gana la primera por descripción (como DISTINCT ON en 007)
    });
    return out;
  });
}
export function fcDeActividad(mapa, descripcion){
  const v=(mapa || {})[normTexto(descripcion)];
  return (typeof v==='number' && v>0) ? v : 1;
}

/* ---------- D185 [O] (enmienda de D184, 18-sep-2026) · FC 1 en los «AJUSTE ORIGEN» ----------
 * Las filas cuyo ELEMENTO es un subtramo NO OPERATIVO de base_elementos (los dos «ajuste origen UF1/UF2»,
 * bandera no_operativo de 003_grilla.sql; respaldo por nombre ^ajuste origen, como esNoOperativo_ de grilla.js)
 * son la acomodación directa con el origen y YA están en compacto: su FC por defecto es SIEMPRE 1, no el de la
 * actividad. Lo aplican enviar_data (completarD184_), la Revisión de DATA (derivar_) y el relleno de 007.
 *   noOperativos_(c) → { [normTexto(elemento)]: true } de los subtramos con la bandera (memo_ por petición;
 *                      sin la columna o sin la tabla → {} y queda solo el respaldo por nombre)
 *   esNoOperativo(mapa, elemento) → true si la bandera o el nombre lo dicen
 *   fcDeFila(fcMap, noOp, descripcion, elemento) → 1 en un ajuste origen; si no, el FC de la actividad. */
export const RE_AJUSTE_ORIGEN = /^\s*ajuste\s*origen/i;
export async function noOperativos_(c){
  return memo_(c, 'no_operativos', async function(){
    const out={};
    let filas=[];
    try{ filas=await c.sql`SELECT elemento FROM base_elementos WHERE obra_id=${OBRA_ID} AND no_operativo`; }
    catch(err){ filas=[]; }
    filas.forEach(function(r){ const k=normTexto(r.elemento); if(k) out[k]=true; });
    return out;
  });
}
export function esNoOperativo(mapa, elemento){
  const e=String(elemento==null?'':elemento);
  return RE_AJUSTE_ORIGEN.test(e) || !!(mapa || {})[normTexto(e)];
}
export function fcDeFila(fcMap, noOp, descripcion, elemento){
  return esNoOperativo(noOp, elemento) ? 1 : fcDeActividad(fcMap, descripcion);
}

/* ======================================================================================================
 * Codigo.gs L984–L1012 — CUBICAJE: cubicaje real por placa (D53 / 2.10) → tabla cubicaje
 * ====================================================================================================== */
// La placa se normaliza EXACTAMENTE igual que el parser de D48 (sin espacios ni guion, MAYÚSCULAS, últimos 6).
export function normPlaca(s){ return String(s==null?'':s).replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(-6); }
/* Mapa placa(6 chars normalizada) → cubicaje (m³/viaje, Number). Placa inválida o cubicaje ≤ 0 no entran
 * (todo cae al fallback del factor editable, 14 por defecto). Es lo que sirve `?action=cubicaje` tal cual
 * y lo que cruza guardarReporte: la forma NO cambia (la chequeadora hace CUBMAP[normPlaca(placa)]). */
export async function cubicajeMap_(c){
  return memo_(c, 'cubicaje', async function(){
    const m={};
    let filas=[];
    try{ filas=await c.sql`SELECT placa, cubicaje FROM cubicaje WHERE obra_id=${OBRA_ID}`; }
    catch(err){ filas=[]; }
    filas.forEach(function(r){
      const placa=normPlaca(r.placa);
      const cub=parseFloat(r.cubicaje);
      if(placa && !isNaN(cub) && cub>0) m[placa]=cub;
    });
    return m;
  });
}

/* ======================================================================================================
 * Codigo.gs L1528–L1553, L1609–L1634, L1767, L1781 — vocabulario de la FLOTA (D138 / D173)
 * ====================================================================================================== */
// Catálogo de RESPALDO en código (05_CATALOGO §4): tipo + horas programadas. Solo se usa cuando la tabla
// `maquinas` no tiene ni una estancia utilizable (fuente 'codigo'). D136/D173: códigos del PARTE.
export const MAQ_CATALOGO = {
  BL005:{tipo:'BULLDOZER',prog:6.4},
  EXC015:{tipo:'EXCAVADORA',prog:6.4},
  MO003:{tipo:'MOTONIVELADORA',prog:6.4}, MO004:{tipo:'MOTONIVELADORA',prog:6.4}, MO009:{tipo:'MOTONIVELADORA',prog:6.4},
  NG002:{tipo:'FINISHER',prog:6.4},
  CR019:{tipo:'VIBROCOMPACTADOR',prog:6.4}, CR013:{tipo:'VIBROCOMPACTADOR',prog:6.4}, CR016:{tipo:'VIBROCOMPACTADOR',prog:6.4}, CR008:{tipo:'VIBROCOMPACTADOR',prog:6.4},
  NH403:{tipo:'VIBROCOMPACTADOR',prog:5},
  CR026:{tipo:'MINIBULDOZER',prog:6.4},
  'RT-02':{tipo:'RETROEXCAVADORA',prog:5}
};
// D137: flota "requerida" = TODO el catálogo de respaldo, derivado (no copiado) para que no diverjan.
export const MAQ_FLOTA_ESPERADA = Object.keys(MAQ_CATALOGO);
// D138: máquinas del respaldo que ENTRAN Y SALEN (finisher y su vibro de pareja): reportables, no esperadas.
export const MAQ_INTERMITENTES = ['NG002','CR008'];

export const MAQUINAS_HEADERS = ['id_maquina','tipo','horas_prog','propiedad','fecha_ingreso','fecha_retiro','notas','frente','grupo'];
// Tipos CON regla de producción (05_CATALOGO §4): panel de producción, chequeadora y `?action=maquinas`.
export const MAQ_TIPOS_PRODUCCION = ['BULLDOZER','EXCAVADORA','MOTONIVELADORA','FINISHER','VIBROCOMPACTADOR',
                                     'MINICARGADOR','MINIBULDOZER','RETROEXCAVADORA'];
export const MAQ_TIPOS_VALIDOS = MAQ_TIPOS_PRODUCCION;   // nombre histórico (D138); mismo conjunto
// Tipos de TODA la flota (D173): los de producción + transporte y equipos menores. Un tipo fuera de esta
// lista se acepta con aviso: no produce y solo aparece en la flota y en el Parte Digital.
export const MAQ_TIPOS_FLOTA = MAQ_TIPOS_PRODUCCION.concat(['VOLQUETA','CAMABAJA','TRACTOCAMION','CARROTANQUE',
                                     'CAMION','TURBO','CISTERNA','LUMINARIA']);
// Frentes (D173): a qué proyecto atiende la estancia. Vacío = el primero (UF1-UF2).
export const FLOTA_FRENTES = ['UF1-UF2','UF3'];
export const FLOTA_FRENTE_DEFECTO = FLOTA_FRENTES[0];
export function normFrente_(v){
  const s=String(v==null?'':v).toUpperCase().replace(/\s+/g,'').replace(/[_/·]/g,'-').trim();
  if(!s) return FLOTA_FRENTE_DEFECTO;
  if(s==='UF1-UF2'||s==='UF1'||s==='UF2'||s==='UF2-UF1'||s==='UF12') return 'UF1-UF2';
  if(s==='UF3') return 'UF3';
  return s;   // desconocido: se conserva tal cual y se avisa
}
// Orden de presentación en los desplegables (producción primero, como siempre; luego transporte).
export const MAQ_ORDEN_TIPO = MAQ_TIPOS_FLOTA;
export function normMaqId(s){ return String(s==null?'':s).trim().toUpperCase(); }
// Horas programadas por defecto cuando la fila no las trae: 5 h alquiladas / 6.4 h propias (D10).
export function progPorPropiedad_(p){ return String(p==null?'':p).toLowerCase().indexOf('alquil')>=0 ? 5 : 6.4; }
export const FLOTA_INFINITO = '9999-12-31';   // tope para comparar una estancia abierta (fecha_retiro vacía)
// Clave de comparación de IDs: sin nada que no sea alfanumérico y en mayúsculas (`RT02` ≡ `RT-02`).
// Misma regla que parteNormCod_ (api/parte.js).
export function normMaqClave_(s){ return String(s==null?'':s).replace(/[^A-Za-z0-9]/g,'').toUpperCase(); }
// Frentes que atiende el Parte Digital (CodigoParte.gs / api/parte.js): solo UF1-UF2.
export const PARTE_FRENTES = ['UF1-UF2'];

// GRUPO / disciplina de la máquina (D190): tierras | drenajes. Dimensión ORTOGONAL a `frente` (UF): una
// máquina puede ser UF1-UF2 y de drenajes a la vez. Es coarse a propósito (una máquina de drenajes sirve
// ODT y ODL indistintamente), distinto del `area` odt/odl que se deriva del CC del trabajo. UF3 queda
// fuera de esta separación (vive en `frente`). Vacío = tierras (DEFAULT de la columna).
export const FLOTA_GRUPOS = ['tierras','drenajes'];
export const FLOTA_GRUPO_DEFECTO = FLOTA_GRUPOS[0];
export function normGrupo_(v){
  const s=String(v==null?'':v).toLowerCase().replace(/\s+/g,'').replace(/[_/·]/g,'-').trim();
  if(!s) return FLOTA_GRUPO_DEFECTO;
  if(s==='tierras'||s==='tierra') return 'tierras';
  // odt/odl (el área del trabajo) colapsan a la disciplina 'drenajes' si alguien los teclea.
  if(s==='drenajes'||s==='drenaje'||s==='dren'||s==='odt'||s==='odl'||s==='odt-odl'||s==='odl-odt') return 'drenajes';
  return s;   // desconocido: se conserva tal cual y se avisa (como normFrente_)
}

/* ---------- Codigo.gs L1639–L1664 getFlotaRows_ → tabla maquinas (memo 'maquinas') ----------
 * [{id, tipo, prog, propiedad, ing, ret, nota, frente, _row}] crudas, ORDER BY id_maquina, fecha_ingreso.
 * `_row` = ordinal + 2 (como si fuera la hoja con encabezado); fecha_ingreso/fecha_retiro llegan como
 * texto 'yyyy-MM-dd' (db.js) o null. */
export async function flotaFilas_(c){
  return memo_(c, 'maquinas', async function(){
    let filas;
    try{
      filas=await c.sql`SELECT id_maquina, tipo, horas_prog, propiedad, fecha_ingreso, fecha_retiro, notas, frente, grupo
        FROM maquinas WHERE obra_id=${OBRA_ID} ORDER BY id_maquina, fecha_ingreso`;
    }catch(err){
      // D190: SOLO si la columna `grupo` aún no existe (migración 009 sin aplicar) caemos a un SELECT sin
      // `grupo` (queda '' → tierras). Cualquier OTRO error (blip transitorio, timeout) se RELANZA: si no,
      // un fallo pasajero devolvería toda la flota como 'tierras' en silencio y ocultaría el problema de raíz.
      const m=String(err&&err.message||err);
      if(!(err&&err.code==='42703') && !/column\s+"?grupo"?\s+does not exist/i.test(m)) throw err;
      filas=await c.sql`SELECT id_maquina, tipo, horas_prog, propiedad, fecha_ingreso, fecha_retiro, notas, frente
        FROM maquinas WHERE obra_id=${OBRA_ID} ORDER BY id_maquina, fecha_ingreso`;
    }
    return filas.map(function(r, i){
      return { id:r.id_maquina, tipo:r.tipo, prog:r.horas_prog, propiedad:r.propiedad,
               ing:r.fecha_ingreso, ret:(r.fecha_retiro==null ? '' : r.fecha_retiro), nota:r.notas,
               frente:(r.frente==null ? '' : r.frente), grupo:(r.grupo==null ? '' : r.grupo), _row:i+2 };
    });
  });
}
function _estancia_(r){ return 'Estancia '+normMaqId(r.id)+' desde '+fdate(r.ing); }   // sustituye a 'Fila N (ID)'

/* ---------- Codigo.gs L1675–L1717 flotaEnFecha_ — flota VIGENTE en una fecha (D138 / D173) ----------
 * Ventana semiabierta [ingreso, retiro); por defecto solo el frente UF1-UF2 y solo los tipos con regla de
 * producción (opts.todos los incluye a todos; opts.frentes acota por frente). `prog` de la fila o por
 * propiedad. RESPALDO a MAQ_CATALOGO cuando no hay ni una estancia válida (fuente 'codigo').
 * → { fecha, fuente:'hoja'|'codigo', catalogo:{ID:{tipo,prog,propiedad,notas,frente,produce_tipo}}, esperadas:[ID], avisos:[] } */
export async function flotaEnFecha_(c, fecha, opts){
  opts=opts||{};
  const f = fdateValida_(fecha) || hoyBogota();
  const frentes = (opts.frentes && opts.frentes.length) ? opts.frentes : [FLOTA_FRENTE_DEFECTO];
  const catalogo={}, avisos=[];
  let validas=0;
  (await flotaFilas_(c)).forEach(function(r){
    const id=normMaqId(r.id);
    if(!id) return;                                   // fila en blanco: ni error ni aviso
    const ing=fdateValida_(r.ing);
    if(!ing){ avisos.push(_estancia_(r)+': sin fecha_ingreso válida (yyyy-mm-dd); esa estancia se ignora.'); return; }
    const retCrudo = (r.ret===''||r.ret==null) ? '' : fdate(r.ret);
    const ret = retCrudo ? fdateValida_(r.ret) : '';
    if(retCrudo && !ret) avisos.push(_estancia_(r)+': fecha_retiro "'+retCrudo+'" no se entiende; se toma como si siguiera en obra.');
    if(ret && ret<ing)   avisos.push(_estancia_(r)+': fecha_retiro anterior al ingreso; esa estancia nunca está vigente.');
    validas++;
    if(!(ing<=f && (!ret || f<ret))) return;           // ventana semiabierta [ingreso, retiro)
    const tipo=String(r.tipo==null?'':r.tipo).toUpperCase().trim();
    const frente=normFrente_(r.frente);
    if(frentes.indexOf(frente)<0) return;              // D173: otro frente (UF3): no es de esta flota
    const grupo=normGrupo_(r.grupo);                   // D190: disciplina (tierras/drenajes), ortogonal al frente
    if(opts.grupos && opts.grupos.length && opts.grupos.indexOf(grupo)<0) return;   // acota por grupo si se pide
    if(!tipo)                                  avisos.push(_estancia_(r)+': sin tipo; no lleva producción y solo sale en la flota del parte.');
    else if(MAQ_TIPOS_FLOTA.indexOf(tipo)<0)   avisos.push(_estancia_(r)+': tipo "'+tipo+'" no está en la lista conocida; no lleva producción y solo sale en la flota del parte.');
    // Sin `todos`: solo los tipos con regla de producción (panel del día, chequeadora, capataz).
    if(!opts.todos && MAQ_TIPOS_PRODUCCION.indexOf(tipo)<0) return;
    let prog=parseFloat(r.prog);
    if(isNaN(prog) || prog<=0) prog=progPorPropiedad_(r.propiedad);
    // Varias estancias vigentes el mismo día (traslape): gana la última fila, y se avisa.
    if(catalogo[id]) avisos.push(_estancia_(r)+': hay dos estancias vigentes el '+f+'; se usa la última.');
    catalogo[id]={ tipo:tipo, prog:prog, propiedad:String(r.propiedad==null?'':r.propiedad).trim(),
                   notas:String(r.nota==null?'':r.nota).trim(), frente:frente, grupo:grupo,
                   produce_tipo: MAQ_TIPOS_PRODUCCION.indexOf(tipo)>=0 };
  });
  if(!validas){
    // Respaldo: la tabla está vacía o no tiene una sola fila utilizable.
    Object.keys(MAQ_CATALOGO).forEach(function(id){
      catalogo[id]={ tipo:MAQ_CATALOGO[id].tipo, prog:MAQ_CATALOGO[id].prog, propiedad:'', notas:'',
                     frente:FLOTA_FRENTE_DEFECTO, grupo:FLOTA_GRUPO_DEFECTO, produce_tipo:true };
    });
    return { fecha:f, fuente:'codigo', catalogo:catalogo, avisos:avisos,
             esperadas:Object.keys(catalogo).filter(function(id){ return MAQ_INTERMITENTES.indexOf(id)<0; }) };
  }
  return { fecha:f, fuente:'hoja', catalogo:catalogo, avisos:avisos, esperadas:Object.keys(catalogo) };
}

/* ---------- Codigo.gs L1830–L1844 ---------- */
// Dos estancias de la MISMA máquina se pisan si sus ventanas semiabiertas se cortan.
export function _flotaTraslapa_(a, b){
  const ra=a.ret||FLOTA_INFINITO, rb=b.ret||FLOTA_INFINITO;
  return a.ing < rb && b.ing < ra;
}
// Filas normalizadas (fechas validadas, id en mayúsculas) conservando su ordinal (`fila` = _row).
export async function _flotaFilasNorm_(c){
  return (await flotaFilas_(c)).map(function(r){
    const retCrudo=(r.ret===''||r.ret==null)?'':fdate(r.ret);
    return { id:normMaqId(r.id), ing:fdateValida_(r.ing), ret:(retCrudo?fdateValida_(r.ret):''),
             retCrudo:retCrudo, tipo:String(r.tipo==null?'':r.tipo).toUpperCase().trim(),
             prog:r.prog, propiedad:String(r.propiedad==null?'':r.propiedad).trim(),
             nota:String(r.nota==null?'':r.nota).trim(), frente:normFrente_(r.frente),
             frenteCrudo:String(r.frente==null?'':r.frente).trim(),
             grupo:normGrupo_(r.grupo), grupoCrudo:String(r.grupo==null?'':r.grupo).trim(), fila:r._row };
  }).filter(function(r){ return !!r.id; });   // fila en blanco: ni error ni aviso (D138)
}

/* ---------- Codigo.gs L1788–L1807 idsMaquinariaHistorico_ — vocabulario REAL de máquinas ----------
 * Los `id_maquina` distintos ya escritos en `maquinaria` (lo que cruza contra dim_maquinaria). En el .gs
 * leía la columna entera (D107); aquí SELECT id_maquina, count(*) GROUP BY (memo 'ids_maquinaria').
 * → { ids:{ID:nFilas}, porClave:{clave:[IDs]}, n } con ID = normMaqId y clave = normMaqClave_. */
export async function idsMaquinariaHistorico_(c){
  return memo_(c, 'ids_maquinaria', async function(){
    const out={ ids:{}, porClave:{}, n:0 };
    let filas=[];
    try{ filas=await c.sql`SELECT id_maquina, count(*)::int AS n FROM maquinaria WHERE obra_id=${OBRA_ID} GROUP BY id_maquina`; }
    catch(err){ filas=[]; }                             // sin tabla: el guard queda mudo, no rompe
    filas.forEach(function(r){
      const id=normMaqId(r.id_maquina); if(!id) return;
      if(!out.ids[id]){ out.ids[id]=0; out.n++; }
      out.ids[id]+=Number(r.n)||0;
      const k=normMaqClave_(id); if(!k) return;
      const l=(out.porClave[k]=out.porClave[k]||[]);
      if(l.indexOf(id)<0) l.push(id);
    });
    return out;
  });
}

/* ======================================================================================================
 * PARTE_EQUIPOS (CodigoParte.gs L289 / api/parte.js) — fichas del Parte, que OBRA también usa (D171/D173)
 * ====================================================================================================== */
/* Fichas indexadas por código normalizado (memo 'equipos'):
 * { [normMaqClave_(codigo)]: {codigo, tipo, placa, proveedor, medidor:'HOROMETRO'|'KM'|'', medidor_crudo,
 *   activo:bool, ultimo_final_manual:Number|null, ultima_fecha:'yyyy-MM-dd'|''} } */
export async function parteEquipos_(c){
  return memo_(c, 'equipos', async function(){
    const filas=await c.sql`SELECT codigo, tipo, placa, proveedor, medidor, ultima_fecha, ultimo_final, activo, ultimo_final_manual FROM parte_equipos WHERE obra_id=${OBRA_ID}`;
    const out={};
    filas.forEach(function(r){
      const cod=texto_(r.codigo); if(!cod) return;
      const manual = (r.ultimo_final_manual!==undefined && r.ultimo_final_manual!==null && r.ultimo_final_manual!=='') ? r.ultimo_final_manual : r.ultimo_final;
      out[normMaqClave_(cod)]={
        codigo:cod, tipo:texto_(r.tipo), placa:texto_(r.placa), proveedor:texto_(r.proveedor),
        medidor:medidor_(r.medidor), medidor_crudo:texto_(r.medidor),
        activo:siNo_(r.activo, true),
        ultimo_final_manual:num_(manual), ultima_fecha:fdate(r.ultima_fecha||'')
      };
    });
    return out;
  });
}
/* D173 — flota VIGENTE en una fecha para el Parte (CodigoParte.gs L311–L317): flotaEnFecha_ con
 * {todos:true, frentes:PARTE_FRENTES}. Sin una sola estancia válida (fuente 'codigo') devuelve null:
 * manda `activo` de parte_equipos. */
export async function parteFlotaVigente_(c, fecha){
  const fl=await flotaEnFecha_(c, fecha, { todos:true, frentes:PARTE_FRENTES });
  return fl.fuente==='hoja' ? fl : null;
}
/* Equipos ACTIVOS ese día: los vigentes en la flota (con su ficha, o `sin_ficha:true` si no la tienen) o,
 * sin flota, las fichas con activo=SI. Ordenados por código. */
export async function parteEquiposActivos_(c, fecha){
  const m=await parteEquipos_(c), fl=await parteFlotaVigente_(c, fecha);
  let lista;
  if(!fl){
    // Sin flota: las fichas de parte_equipos no llevan grupo → tierras por defecto (D190).
    lista=Object.keys(m).map(function(k){ return Object.assign({ grupo:FLOTA_GRUPO_DEFECTO }, m[k]); }).filter(function(q){ return q.activo; });
  }else{
    lista=Object.keys(fl.catalogo).map(function(id){
      const x=fl.catalogo[id], q=m[normMaqClave_(id)];
      if(q) return Object.assign({}, q, { activo:true, frente:x.frente, grupo:x.grupo, propiedad:x.propiedad, sin_ficha:false });
      return { codigo:id, tipo:x.tipo, placa:'', proveedor:x.propiedad||'', medidor:'', medidor_crudo:'', activo:true,
               ultimo_final_manual:null, ultima_fecha:'', frente:x.frente, grupo:x.grupo, propiedad:x.propiedad, sin_ficha:true };
    });
  }
  return lista.sort(function(a,b){ return a.codigo<b.codigo?-1:a.codigo>b.codigo?1:0; });
}
/* Selector del formulario público: los vigentes hoy (en_flota:true) + las demás fichas con tipo (en_flota:false). */
export async function parteSelectorEquipos_(c){
  const vig=await parteEquiposActivos_(c), enFlota={};
  const out=vig.map(function(q){ enFlota[normMaqClave_(q.codigo)]=1; return { codigo:q.codigo, tipo:q.tipo, placa:q.placa, en_flota:true }; });
  const m=await parteEquipos_(c);
  Object.keys(m).sort().forEach(function(k){
    if(enFlota[k]) return;
    const q=m[k]; if(!q.tipo) return;
    out.push({ codigo:q.codigo, tipo:q.tipo, placa:q.placa, en_flota:false });
  });
  return out;
}
/* Codigo.gs L1849–L1863 fichasParte_ — fichas (placa · proveedor · medidor) por normMaqClave_ para la
 * pestaña Flota: { clave: {codigo, tipo, placa, proveedor, medidor:crudo||normalizado, activo} }. */
export async function fichasParte_(c){
  const out={};
  try{
    const m=await parteEquipos_(c);
    Object.keys(m).forEach(function(k){
      const q=m[k];
      out[normMaqClave_(q.codigo)]={ codigo:q.codigo, tipo:q.tipo, placa:q.placa, proveedor:q.proveedor,
                                     medidor:q.medidor_crudo||q.medidor||'', activo:q.activo };
    });
  }catch(err){ /* sin fichas: la flota sigue funcionando sin ellas */ }
  return out;
}
