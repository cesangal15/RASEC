/**
 * api/obra/data.js — armado y envío de la hoja DATA (la OFICIAL) portado al Worker (4.01 · Fase 4 · D180).
 *
 * Es el bloque de backend/Codigo.gs que arma cada fila de DATA a partir de una línea reportada y la
 * escribe pisando el día POR ÁREA, con los MISMOS nombres de función y la MISMA lógica de negocio (mismos
 * mensajes de error literales, mismas claves de respuesta, mismo orden de comprobaciones); solo cambia la
 * capa de datos (hoja DATA/BANDEJA → tablas `data`/`bandeja`):
 *
 *   buildDataRow / buildDataRowDrenajes (L456–L612)  arman las 29 celdas A–AC de una fila de DATA (D04/
 *                                                    D63/D68/D69/D71/D79/D104/D130), VERBATIM.
 *   lookupElemento / lookupMarcadorODT / lookupTramoPorNombre / lookupDescripcion (L615–L961)  cruzan
 *                                                    contra la BASE (baseRows_/baseItems_ de catalogos.js).
 *   anclaCruce / numOrNull (L868–L887)               ancla del cruce por abscisa (D104).
 *   sellarClimaEnObservacion_ (L2436–L2442)          estampa '[Clima: X]' en la OBSERVACION de la 1ª fila.
 *   enviarData (L2450–L2518)                         POST enviar_data: pisa el día del área y reescribe.
 *   drenajesCatalogo / tramosCatalogo (L813–L983)    catálogos de la BASE para las pantallas estáticas.
 *
 * Qué cambia respecto al .gs y por qué (decisiones 3, 9 del port):
 *   · `getBaseRows()` / `getBaseItems()` (memos de ejecución) → baseRows_(c) / baseItems_(c) de
 *     src/catalogos.js: una consulta por tabla y PETICIÓN. Por eso los lookup* y buildDataRow* son ASYNC
 *     y reciben el contexto `c` (el objeto de la LÍNEA reportada pasa a llamarse `ln` para no chocar).
 *   · Escritura (enviarData): UNA transacción con SELECT pg_advisory_xact_lock(hashtext(obra_id|fecha|area))
 *     en vez de LockService+deleteRow. DELETE … WHERE fecha=$ AND (area=$ OR id_registro = ANY($ids)) e
 *     INSERT en `data` conservando el id_registro de la línea de BANDEJA (decisión 3: NO se regenera con
 *     un UUID como en L2500; informe §3 Fase 4.2). area SIEMPRE explícita. Luego UPDATE bandeja
 *     estado='incluido'|'descartado' (L2513–L2516). Nada de ensureRows_/borrarFilas_/getMaxRows: no hay celdas.
 *   · Salida: DATA.fecha es date; abs_inicial/abs_final son text (metros del PK guardados como texto, D68);
 *     largo/espesor/fc/cantidad numeric ('' → NULL). El resto tal cual las devuelve buildDataRow.
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 */
import { OBRA_ID, json, toDate, fdate, fdateValida_, normTexto, ccCorto, textoArrayPg_ } from '../../comun.js';
import { baseItems_, baseRows_, pkMeters, pkFmt, buildElemento, baseSetFor, BASE_TOL_M } from '../../catalogos.js';
import { areaDeFila } from './areas.js';

/* ---------- helpers privados de la capa de datos ---------- */
// ERROR_FECHA de Codigo.gs L253–L255 (const privada del .gs, no exportada): se copia verbatim aquí.
const ERROR_FECHA = 'La fecha del reporte llegó vacía o con un formato que no se entiende. '
  + 'Vuelve a elegir el día en el campo "Fecha" y envía otra vez. '
  + 'No se guardó nada a propósito: una fila sin fecha no aparece en la bandeja ni en el maestro.';
// Índice de la OBSERVACION en la fila de 29 celdas (Codigo.gs `const C = { FECHA:0, LARGO:14, OBS:18 }`).
const IDX_OBS = 18;
// text NOT NULL DEFAULT '' → nunca NULL; number → su texto (metros del PK en ABS INICIAL/FINAL, D68).
function txt_(v){ return String(v==null?'':v); }
// numeric → Number o NULL ('' del .gs = celda vacía de la hoja).
function numNulo_(v){ if(v===''||v==null) return null; const n=Number(v); return isFinite(n) ? n : null; }

/* ======================================================================================================
 * Codigo.gs L456–L554 — buildDataRow: fila de DATA (área TIERRAS) a partir de una línea reportada.
 * `ln` es la LÍNEA (en el .gs se llamaba `c`); `c` aquí es el contexto del Worker. Async porque cruza
 * la BASE (lookupElemento/lookupDescripcion/lookupTramoPorNombre → baseRows_/baseItems_). Devuelve las 29
 * celdas A–AC en el orden de DATA_HEADERS (mismas que el maestro; la prueba de paridad compara celda a celda).
 * ====================================================================================================== */
export async function buildDataRow(c, ln, fecha, ts, reporta, rol, idC){
  // Ubicación (UF/PROYECTO/CC) derivada del PK con el helper único (Problema 2.12, D04).
  // ABS: con match a la BASE viene del elemento (K/L verbatim, D68); sin match, del PK (abajo).
  const mi = pkMeters(ln.pk_inicial), mf = pkMeters(ln.pk_final);
  // D69/D71: las filas de DRENAJES se arman en su propia rama (GRUPO/CAPITULO fijos, ELEMENTO por
  // marcador ODT o tramo, la red D66 NO las toca). El área manda por la columna `area` de la línea
  // (D71: la demolición de estructuras 01.02 es drenaje pero su CC deriva 'tierras'); si falta, se
  // deriva del CC como antes (06.*→ODT, 07.*→ODL) vía areaDeFila.
  const areaFila = areaDeFila(ln.area, ln.centro_costo);
  if(areaFila==='odt' || areaFila==='odl') return buildDataRowDrenajes(c, ln, fecha, ts, reporta, rol, idC, areaFila, mi, mf);
  let uf = ln.uf||'', proy = ln.proyecto||'', cc = ln.centro_costo||'';
  if(mi != null){                                   // D04: PK≤30→UF1/3701; >30→UF2/3702
    uf   = mi <= 30000 ? 'UF1' : 'UF2';
    proy = uf === 'UF1' ? '3701' : '3702';
    const cod = ccCorto(ln.centro_costo);           // "02.05" -> reancla el proyecto correcto al CC
    cc = cod ? (proy + '.' + cod) : cc;
  }
  // D79: CONFORMACIÓN (02.08) — el DESTINO lo elige el residente en el panel del encargado
  // (ln.destino_conf 'RCD'|'ZODME'; sin el campo — frontend viejo — cae a RCD, el comportamiento
  // que ya existía). El destino manda sobre el PK del origen: la fila se ancla al sitio de
  // disposición, no a donde se excavó. RCD → UF1/3701 (elemento "RCD 15+800"); ZODME → UF2/3702
  // (elemento "ZODME PK30"). ELEMENTO y ABS salen verbatim de la fila de la BASE de ese tipo (D68).
  const confDest = (ccCorto(ln.centro_costo)==='02.08')
    ? (String(ln.destino_conf||'').trim().toUpperCase()==='ZODME' ? 'ZODME' : 'RCD') : '';
  if(confDest){
    uf   = (confDest==='ZODME') ? 'UF2' : 'UF1';
    proy = (confDest==='ZODME') ? '3702' : '3701';
    cc   = proy + '.02.08';
  }
  // ELEMENTO oficial desde la hoja BASE (catálogo de elementos), eligiendo la FUENTE según la
  // actividad (D63): préstamo→EL DIVISO, estructuras/MSR→elemento MSR del PK, conformación→RCD,
  // resto (aprovechable/no aprovechable/terraplén/subbase/base)→tramo "tm2 pk X-Y" por abscisa. Con
  // match, el ELEMENTO es la celda J de la BASE TAL CUAL (verbatim; el maestro empareja por string
  // byte-idéntico, D68). Si no hay elemento para esa actividad/PK, se arma desde el PK con el helper
  // único (sin "Pk Pk") — buildElemento/pkNorm/pkMeters quedan SOLO para ese fallback. REVISAR queda
  // SÓLO para el caso legítimo (el PK no pertenece a ningún tramo del eje / falta el marcador).
  // D104: el cruce por abscisa recibe también el PK FINAL para anclarse en el PUNTO MEDIO del rango.
  const lk = await lookupElemento(c, cc, ln.descripcion, mi, confDest || null, mf);
  const pkElem = buildElemento(ln.pk_inicial, ln.pk_final);
  let elem = lk.elem ? lk.elem
           : lk.revisar ? ('REVISAR · ' + (pkElem || ln.elemento || ('pk ' + (ln.pk_inicial||''))))
           : (pkElem || ln.elemento || '');
  // ABS INICIAL/FINAL (D68, enmienda D63b): con match, copian K/L del elemento emparejado VERBATIM
  // — el ABS refleja el subtramo completo, no el tramo puntual del día (pedido del jefe). Fallback
  // (sin match / PK fuera de tramo / REVISAR / celda K o L vacía en la BASE): ABS derivado del PK
  // como antes (D04). El PK reportado sigue intacto en las internas U–AA (pk_inicial/pk_final).
  let absIni = (lk.elem && lk.absIni!=null && lk.absIni!=='') ? lk.absIni
             : (mi != null ? mi : (ln.abs_inicial!=null ? ln.abs_inicial : ''));
  let absFin = (lk.elem && lk.absFin!=null && lk.absFin!=='') ? lk.absFin
             : (mf != null ? mf : (ln.abs_final!=null ? ln.abs_final : ''));
  /* D104 — OVERRIDE MANUAL DEL SUBTRAMO (`ln.elemento_forzado`), mismo patrón que `destino_conf` (D79).
   * Lo manda el panel del encargado SOLO en las líneas donde el residente cambió el subtramo que
   * resolvió el automático.
   *   · Ausente o vacío -> automático de arriba (RETROCOMPATIBLE: payloads viejos no se rompen).
   *   · Con valor -> ELEMENTO y ABS INICIAL/FINAL VERBATIM de J/K/L de esa fila de la BASE (D68 intacta).
   *   · UF/proyecto/CC se re-derivan desde el ABS INICIO del subtramo forzado (D04/D63b).
   *   · Si el elemento no existe en la BASE se IGNORA y la fila cae al automático — nunca se inventa.
   *   · No se aplica a la conformación 02.08 (`confDest`): ese destino lo manda D79, y lookupTramoPorNombre
   *     además solo resuelve filas del conjunto TRAMO.
   *   · NO se persiste en BANDEJA (opción B, mismo criterio que D79): la elección se hace al enviar y un
   *     reenvío del día vuelve al automático. */
  const forz = (!confDest && ln.elemento_forzado) ? await lookupTramoPorNombre(c, ln.elemento_forzado) : null;
  // (El .gs deja aquí un Logger.log cuando elemento_forzado no calza; en el Worker no hay Logger y la
  //  fila cae al automático de todos modos: no se registra para no ensuciar el LOG de la petición.)
  if(forz){
    elem   = forz.elem;                                                   // celda J verbatim
    absIni = (forz.rawIni!=null && forz.rawIni!=='') ? forz.rawIni : (forz.ini!=null ? forz.ini : '');
    absFin = (forz.rawFin!=null && forz.rawFin!=='') ? forz.rawFin : (forz.fin!=null ? forz.fin : '');
    if(forz.ini != null){                            // D04 sobre el ABS INICIO del subtramo forzado
      uf   = forz.ini <= 30000 ? 'UF1' : 'UF2';
      proy = uf === 'UF1' ? '3701' : '3702';
      const codF = ccCorto(cc);                      // D63b: reancla el proyecto al CC
      cc = codF ? (proy + '.' + codF) : cc;
    }
  }
  // DESCRIPCION verbatim de la tabla de ítems de la BASE, cruce por Centro de Coste (D68). Si el CC no
  // está en la BASE, se conserva la descripción reportada.
  const desc = await lookupDescripcion(c, cc, ln.descripcion);
  // GRUPO: la BASE clasifica tanto tierras como estructuras/MSR bajo el grupo TIERRAS. Las filas de
  // estructuras (CC 05.*) llegaban de BANDEJA con "DRENAJES Y ESTRUCTURAS"; se corrige a TIERRAS aquí
  // (red de seguridad). El CAPITULO (ESTRUCTURAS) NO se toca. OJO (D69): esta red aplica SOLO a filas de
  // área tierras — las de drenajes salieron por buildDataRowDrenajes arriba y conservan su GRUPO.
  let grupo = ln.grupo||'';
  if(/estructura/i.test(grupo)) grupo='TIERRAS';
  return [ toDate(fecha), '', grupo, cc, ln.capitulo||'', desc,
    uf, proy, elem, absIni, absFin,
    ln.liberacion||'CAMPO', '', ln.unidad||'', (ln.largo!=null?ln.largo:''), '', '', '', ln.observacion||'', '',
    idC, ts, reporta||'', rol||'', ln.actividad||'', ln.pk_inicial||'', ln.pk_final||'', 'tierras', ln.clima||'' ];
}

/* ---------- Codigo.gs L567–L612 — DATA para DRENAJES (ODT / ODL), D69 ----------
 * ODT: el ELEMENTO es el MARCADOR de obra (ODT1-xxx…), copiado verbatim de la celda J; ABS = K/L del
 * marcador verbatim (abscisa PUNTUAL). ODL: el ELEMENTO es el tramo "tm2 pk X - Y" por abscisa (MISMO
 * cruce TRAMO de tierras) salvo que el capataz haya elegido un marcador ODT (descole). GRUPO fijo
 * "DRENAJES Y ESTRUCTURAS"; CAPITULO fijo por área; LIBERACION=CAMPO. DESCRIPCION verbatim de la BASE por
 * CC (incluye el typo real "…sin clasicar" y el sufijo " ODL": NO corregirlos, pivotes del maestro). */
export async function buildDataRowDrenajes(c, ln, fecha, ts, reporta, rol, idC, area, mi, mf){
  const mk = await lookupMarcadorODT(c, ln.elemento);
  const ancla = (mi!=null) ? mi : (mk ? mk.ini : null);
  let uf=ln.uf||'', proy=ln.proyecto||'', cc=ln.centro_costo||'';
  if(ancla!=null){                                   // D04: ≤30000 m → UF1/3701; >30000 → UF2/3702
    uf   = ancla<=30000 ? 'UF1' : 'UF2';
    proy = uf==='UF1' ? '3701' : '3702';
    const cod=ccCorto(ln.centro_costo);              // re-ancla el proyecto correcto al CC (D63)
    cc = cod ? (proy+'.'+cod) : cc;
  }
  let elem='', absIni='', absFin='';
  if(area==='odt' || mk){
    // marcador ODT: obligatorio en ODT; opcional en ODL (descole)
    if(mk){
      elem=mk.elem;                                  // celda J verbatim
      absIni=(mk.rawIni!=null && mk.rawIni!=='') ? mk.rawIni : (ancla!=null?ancla:'');
      absFin=(mk.rawFin!=null && mk.rawFin!=='') ? mk.rawFin : absIni;
    } else {                                         // ODT sin marcador reconocible -> revisión humana
      elem='REVISAR · '+(ln.elemento || buildElemento(ln.pk_inicial,ln.pk_final) || ('pk '+(ln.pk_inicial||'')));
      absIni=(mi!=null) ? mi : (ln.abs_inicial!=null ? ln.abs_inicial : '');
      absFin=(mf!=null) ? mf : (ln.abs_final!=null ? ln.abs_final : '');
    }
  } else {
    // ODL por tramo: mismo flujo que tierras (cruce por abscisa contra los tramos "tm2 pk X - Y").
    // D104: hereda el semiabierto [ini,fin) y el ancla por PUNTO MEDIO del rango (se pasa `mf`). El
    // override `elemento_forzado` NO aplica aquí (el selector vive en el panel del encargado de tierras).
    const lk=await lookupElemento(c, cc, ln.descripcion, mi, null, mf);
    const pkElem=buildElemento(ln.pk_inicial, ln.pk_final);
    elem = lk.elem ? lk.elem
         : lk.revisar ? ('REVISAR · '+(pkElem || ln.elemento || ('pk '+(ln.pk_inicial||''))))
         : (pkElem || ln.elemento || '');
    absIni=(lk.elem && lk.absIni!=null && lk.absIni!=='') ? lk.absIni : (mi!=null ? mi : (ln.abs_inicial!=null?ln.abs_inicial:''));
    absFin=(lk.elem && lk.absFin!=null && lk.absFin!=='') ? lk.absFin : (mf!=null ? mf : (ln.abs_final!=null?ln.abs_final:''));
  }
  const desc=await lookupDescripcion(c, cc, ln.descripcion);
  // CAPITULO fijo por área para los ítems .06/.07; pero un ítem "extra" del área (D71: DEMOLICIÓN DE
  // ESTRUCTURAS, capítulo DEMOLICIONES Y REUBICACIONES) trae su propio capítulo verbatim. Se honra
  // ln.capitulo SOLO cuando NO es el "DRENAJE …" por defecto (red de seguridad para frontends viejos).
  const capDefault = (area==='odt') ? 'DRENAJE TRANSVERSAL' : 'DRENAJE LONGITUDINAL';
  const capitulo = (ln.capitulo && !/^\s*drenaje/i.test(String(ln.capitulo))) ? ln.capitulo : capDefault;
  return [ toDate(fecha), '', 'DRENAJES Y ESTRUCTURAS', cc, capitulo, desc,
    uf, proy, elem, absIni, absFin,
    ln.liberacion||'CAMPO', '', ln.unidad||'', (ln.largo!=null?ln.largo:''), '', '', '', ln.observacion||'', '',
    idC, ts, reporta||'', rol||'', ln.actividad||'', ln.pk_inicial||'', ln.pk_final||'', area, ln.clima||'' ];
}

/* ---------- Codigo.gs L615–L623 — marcador ODT de la BASE por su nombre ----------
 * Cruce tolerante con normTexto (que NUNCA altera lo que se escribe: el elem devuelto es la celda J
 * cruda). null si no calza. getBaseRows() → baseRows_(c). */
export async function lookupMarcadorODT(c, nombre){
  const n=normTexto(nombre);
  if(!n || n.indexOf('ODT')!==0) return null;
  const rows=await baseRows_(c);
  for(let i=0;i<rows.length;i++){
    if(rows[i].tipo==='ODT' && normTexto(rows[i].elem)===n) return rows[i];
  }
  return null;
}

/* ---------- Codigo.gs L854–L866 — DESCRIPCION oficial (verbatim) por Centro de Coste (D68) ----------
 * Llave exacta primero ("3701.02.05") y corta después ("02.05"). Con varios ítems: 1) separa por el
 * discriminante "NO APRO"; 2) gana el candidato MÁS COMPLETO cuyo texto empiece por el reportado. Sin ítem
 * en la BASE → se conserva la descripción reportada. getBaseItems() → (baseItems_(c)).items. */
export async function lookupDescripcion(c, cc, descripcion){
  const items=(await baseItems_(c)).items;
  const cand=items[String(cc==null?'':cc).trim()] || items[ccCorto(cc)];
  if(!cand || !cand.length) return descripcion||'';
  if(cand.length===1) return cand[0].desc;
  const n=normTexto(descripcion);
  const noApro = n.indexOf('NO APRO')>=0;
  let pool=cand.filter(function(it){ return (it.norm.indexOf('NO APRO')>=0)===noApro; });
  if(!pool.length) pool=cand;
  let best=null;
  pool.forEach(function(it){ if(n && it.norm.indexOf(n)===0 && (!best || it.norm.length>best.norm.length)) best=it; });
  return best ? best.desc : pool[0].desc;
}

/* ---------- Codigo.gs L868–L871 — número o null (tolera '', null, undefined y no-numéricos), D104 ---------- */
export function numOrNull(v){
  if(v===''||v==null||isNaN(Number(v))) return null;
  return Number(v);
}

/* ---------- Codigo.gs L882–L887 — ancla del cruce por abscisa (D104, enmienda D63a) ----------
 * TRAMO con PK inicial Y final válidos y DISTINTOS → PUNTO MEDIO del rango (ordenado antes de promediar,
 * así un rango invertido da el mismo centro). MSR (puntual) conserva el ancla de siempre = PK inicial. */
export function anclaCruce(mIni, mFin, set){
  const a=numOrNull(mIni), b=numOrNull(mFin);
  if(set!=='TRAMO') return (a!=null) ? a : b;
  if(a!=null && b!=null && a!==b) return (Math.min(a,b)+Math.max(a,b))/2;
  return (a!=null) ? a : b;
}

/* ---------- Codigo.gs L895–L945 — ELEMENTO oficial de la BASE ----------
 * → { elem:'<ELEMENTO>'|'' , revisar:true|false , absIni , absFin } (elem = celda J verbatim; absIni/absFin
 * = K/L verbatim; en los retornos sin match quedan undefined y buildDataRow deriva ABS del PK). setForzado
 * (D79) fuerza el conjunto RCD/ZODME sin mirar el CC; pkMetersFin (D104) para el punto medio. getBaseRows()
 * → baseRows_(c). */
export async function lookupElemento(c, cc, descripcion, pkMetersIn, setForzado, pkMetersFin){
  const all=await baseRows_(c);
  if(!all.length) return { elem:'', revisar:false };
  const set=setForzado || baseSetFor(ccCorto(cc));
  const rows=all.filter(function(r){ return r.tipo===set; });
  // DIVISO / RCD / ZODME: marcador ligado a la ACTIVIDAD/DESTINO (no al PK) -> se devuelve directo.
  if(set==='DIVISO' || set==='RCD' || set==='ZODME'){
    return rows.length ? { elem:rows[0].elem, revisar:false, absIni:rows[0].rawIni, absFin:rows[0].rawFin }
                       : { elem:'', revisar:true };
  }
  // TRAMO / MSR: por abscisa dentro del conjunto.
  if(!rows.length) return { elem:'', revisar:false };     // sin filas de ese tipo -> respaldo PK
  const pk=anclaCruce(pkMetersIn, pkMetersFin, set);      // D104: punto medio del rango en TRAMO
  if(pk==null) return { elem:'', revisar:false };
  // 1) PK dentro de un tramo. D104 — INTERVALO SEMIABIERTO [ABS_INICIO, ABS_FIN) para el conjunto TRAMO:
  // un PK que cae EXACTO en la frontera pertenece al que EMPIEZA ahí. Dos excepciones al semiabierto: el
  // ÚLTIMO tramo del eje se compara CERRADO (<=), y una fila TRAMO degenerada (ini===fin) también. MSR
  // conserva el cerrado-cerrado de siempre (marcadores puntuales).
  let hits;
  if(set==='TRAMO'){
    let finMax=null;
    rows.forEach(function(r){ if(r.fin!=null && (finMax==null || r.fin>finMax)) finMax=r.fin; });
    hits=rows.filter(function(r){
      if(r.ini==null || r.fin==null || pk<r.ini) return false;
      const cerrado = (r.fin===finMax) || (r.fin===r.ini);   // último tramo del eje / fila degenerada
      return cerrado ? (pk<=r.fin) : (pk<r.fin);
    });
  } else {
    hits=rows.filter(function(r){ return r.ini!=null && r.fin!=null && pk>=r.ini && pk<=r.fin; });
  }
  if(hits.length){
    hits.sort(function(a,b){ return (a.fin-a.ini)-(b.fin-b.ini); });
    return { elem:hits[0].elem, revisar:false, absIni:hits[0].rawIni, absFin:hits[0].rawFin };
  }
  // 2) PK cercano (error humano): ajustar al tramo más próximo dentro de la tolerancia
  let best=null, bestD=Infinity;
  rows.forEach(function(r){ if(r.ini==null||r.fin==null) return;
    const d = pk<r.ini ? (r.ini-pk) : (pk-r.fin);
    if(d<bestD){ bestD=d; best=r; } });
  if(best && bestD<=BASE_TOL_M) return { elem:best.elem, revisar:false, absIni:best.rawIni, absFin:best.rawFin };
  // 3) el PK no pertenece a ningún tramo/zona del conjunto -> revisión humana
  return { elem:'', revisar:true };
}

/* ---------- Codigo.gs L953–L961 — override manual del SUBTRAMO (D104) ----------
 * Busca una fila del conjunto TRAMO en la BASE por su texto (cruce tolerante con normTexto; devuelve la
 * fila con J/K/L crudas). SOLO TRAMO, a propósito. null si no calza. getBaseRows() → baseRows_(c). */
export async function lookupTramoPorNombre(c, nombre){
  const n=normTexto(nombre);
  if(!n) return null;
  const rows=await baseRows_(c);
  for(let i=0;i<rows.length;i++){
    if(rows[i].tipo==='TRAMO' && normTexto(rows[i].elem)===n) return rows[i];
  }
  return null;
}

/* ======================================================================================================
 * Codigo.gs L813–L818 — catálogo de DRENAJES para los frontends (D69). GET ?action=drenajes.
 * marcadores: filas ODT* de la BASE (abscisa puntual en metros + PK formateado). items: TODOS los ítems
 * .06 (ODT) y .07 (ODL) (drenItems de baseItems_, con desc verbatim). Solo lectura, público. getBaseRows()
 * → baseRows_(c); _baseDrenItems → (baseItems_(c)).drenItems.
 * ====================================================================================================== */
export async function drenajesCatalogo(c){
  const rows=await baseRows_(c);
  const marcadores=rows.filter(function(r){ return r.tipo==='ODT'; })
    .map(function(r){ return { elemento:r.elem, abs:(r.ini!=null?r.ini:''), pk:pkFmt(r.ini) }; });
  const drenItems=(await baseItems_(c)).drenItems;
  return json(c, { ok:true, marcadores:marcadores, items:drenItems||[] });
}

/* ---------- Codigo.gs L974–L982 — catálogo de SUBTRAMOS para los frontends (D104). GET ?action=tramos ----------
 * SOLO el conjunto TRAMO ("tm2 pk X - Y"), ordenado por abscisa. `elemento` VERBATIM (vuelve como
 * `elemento_forzado`). abs_inicio/abs_fin en metros; pk_* formateado. Solo lectura. */
export async function tramosCatalogo(c){
  const tramos=(await baseRows_(c))
    .filter(function(r){ return r.tipo==='TRAMO' && r.ini!=null && r.fin!=null; })
    .map(function(r){ return { elemento:r.elem, abs_inicio:r.ini, abs_fin:r.fin,
                               pk_inicio:pkFmt(r.ini), pk_fin:pkFmt(r.fin),
                               pk:pkFmt(r.ini)+' – '+pkFmt(r.fin) }; })
    .sort(function(a,b){ return (a.abs_inicio-b.abs_inicio) || (a.abs_fin-b.abs_fin); });
  return json(c, { ok:true, tramos:tramos });
}

/* ======================================================================================================
 * Codigo.gs L2436–L2442 — sello '[Clima: X]' en la OBSERVACION de la PRIMERA fila del día (D130).
 * Idempotente (CLIMA_SELLO_RE quita un sello previo). Al principio, no al final; una sola fila. `rows`
 * son las 29 celdas de buildDataRow (rows[0][IDX_OBS] = col S OBSERVACION). ATENCIÓN: CLIMA_SELLO_PREFIJO
 * es el contrato con la fórmula del Excel; cambiarlo obliga a cambiar la fórmula del maestro.
 * ====================================================================================================== */
const CLIMA_SELLO_PREFIJO = '[Clima: ';
const CLIMA_SELLO_RE = /\[Clima:\s*[^\]]*\]\s*(?:·\s*)?/gi;   // sello previo (reenvío) — se reemplaza
export function sellarClimaEnObservacion_(rows, clima){
  if(!rows || !rows.length || !clima) return;
  const previa = String(rows[0][IDX_OBS]==null ? '' : rows[0][IDX_OBS]).replace(CLIMA_SELLO_RE, '').trim();
  rows[0][IDX_OBS] = CLIMA_SELLO_PREFIJO + clima + ']' + (previa ? ' · ' + previa : '');
}

/* ======================================================================================================
 * Codigo.gs L2953 — esquema D166 del envío a DATA. Lo importa api/obra.js (validarPayloadObra_).
 * ====================================================================================================== */
export const VAL_OBRA_ENVIAR = { fecha:['f',0], area:['l',['tierras','odt','odl']], clima:['t',100], cantidades:['a'] };

/* ---------- INSERT de una fila de 29 celdas en la tabla `data` (col A–AC) ----------
 * fecha = date (columna, la misma para todo el envío); abs_* = text (metros del PK como texto, D68);
 * largo/espesor/fc/cantidad = numeric ('' → NULL); timestamp = ts. */
async function insertarDataFila_(sql, r, fecha){
  await sql`INSERT INTO data (obra_id, fecha, orden, grupo, centro_de_costo, capitulo, descripcion, unidad_funcional, proyecto,
      elemento, abs_inicial, abs_final, liberacion, acta, unidad_medida, largo, espesor, fc, cantidad, observacion, columna1,
      id_registro, "timestamp", capataz, rol, actividad, pk_inicial, pk_final, area, clima)
    VALUES (${OBRA_ID}, ${fecha}, ${txt_(r[1])}, ${txt_(r[2])}, ${txt_(r[3])}, ${txt_(r[4])}, ${txt_(r[5])}, ${txt_(r[6])}, ${txt_(r[7])},
      ${txt_(r[8])}, ${txt_(r[9])}, ${txt_(r[10])}, ${txt_(r[11])}, ${txt_(r[12])}, ${txt_(r[13])}, ${numNulo_(r[14])}, ${numNulo_(r[15])}, ${numNulo_(r[16])}, ${numNulo_(r[17])}, ${txt_(r[18])}, ${txt_(r[19])},
      ${txt_(r[20])}, ${r[21]}, ${txt_(r[22])}, ${txt_(r[23])}, ${txt_(r[24])}, ${txt_(r[25])}, ${txt_(r[26])}, ${txt_(r[27])}, ${txt_(r[28])})`;
}

/* ======================================================================================================
 * Codigo.gs L2450–L2518 — enviar lo aprobado a DATA. POST {action:'enviar_data', fecha, area, clima, cantidades}.
 * D69 (enmienda de D03): pisa el día POR ÁREA, no completo. UNA transacción (decisión 3): advisory lock +
 * DELETE (fecha, area ∪ ids) + INSERT conservando el id_registro de la línea de BANDEJA (NO se regenera) +
 * UPDATE bandeja estado incluido/descartado. `ses` no se usa (permiso y LOG los pone api/obra.js/index.js).
 * ====================================================================================================== */
export async function enviarData(c, body, ses){
  // D106: la más delicada de las tres — el borrado se hace POR FECHA: con la fecha vacía se borrarían
  // filas huérfanas de otro envío fallido en vez del día que se quiere pisar.
  const fecha=fdateValida_(body.fecha), incluidas=body.cantidades||[], ts=new Date();
  if(!fecha) return json(c, {ok:false, error:ERROR_FECHA});
  const aB=String(body.area||'').trim().toLowerCase();
  const area=(aB==='odt'||aB==='odl'||aB==='tierras') ? aB : 'tierras';
  // D37 → D130: clima del día que elige el encargado (mismo string en todas las filas del envío). Se
  // sella en la columna interna `clima` de DATA (no viaja al maestro) y ADEMÁS en la OBSERVACION de la
  // primera fila del día, que sí viaja (col S del paste A:S).
  const clima=String(body.clima||'').trim();
  /* D130 — el clima es OBLIGATORIO en tierras: una tabla del Excel maestro lo lee del sello de la
   * observación, así que un día sin clima llega incompleto. Se rechaza ANTES del pisado de D03, así que
   * un envío rechazado deja el día tal como estaba. DRENAJES queda fuera (residente-drenajes.html no
   * captura clima, D70). */
  if(area==='tierras' && !clima){
    return json(c, {ok:false, error:'Falta el clima del día. No se envió nada a DATA (el día quedó como estaba). '
      + 'Elige el clima en el panel y vuelve a enviar; si no ves el selector, recarga la pantalla.'});
  }
  // Guard (L2499): solo se arman filas del área que envía (una fila de otra área colada en el payload
  // duplicaría datos que este envío NO borró). El área de la línea manda por su columna `area` (D71); si
  // falta, se deriva del CC. Las de otra área y las de estado 'no_data' se ignoran (no van a DATA).
  const rows=[];
  for(const ln of incluidas){
    if(ln.estado==='no_data') continue;
    if(areaDeFila(ln.area, ln.centro_costo)!==area) continue;
    ln.clima=clima;                                  // Object.assign(c,{clima}) del .gs
    // Decisión 3: se CONSERVA el id_registro de la línea de BANDEJA (el .gs regeneraba con Utilities.getUuid()).
    const idC = ln.id_registro || crypto.randomUUID();
    rows.push(await buildDataRow(c, ln, fecha, ts, ln.reporta||'(encargado)', ln.rol||'encargado', idC));
  }
  sellarClimaEnObservacion_(rows, clima);            // D130: el clima viaja al maestro por la col S
  const ids=rows.map(function(r){ return r[20]; });  // id_registro conservado de cada fila que entra
  // inc = TODAS las cantidades del envío con id (incluidas las no_data): decide incluido/descartado en BANDEJA.
  const inc={}; incluidas.forEach(function(ln){ if(ln.id_registro) inc[ln.id_registro]=1; });

  await c.sql.begin(async function(sql){
    // Serializa los envíos del mismo día+área (sustituye al LockService del .gs). hashtext → int4, que
    // pg_advisory_xact_lock acepta como bigint; se libera solo al terminar la transacción.
    const clave=OBRA_ID+'|'+fecha+'|'+area;
    await sql`SELECT pg_advisory_xact_lock(hashtext(${clave}))`;
    // 1) DATA: borrar el día SOLO en el área que envía (D69) MÁS las filas cuyo id_registro reescribimos
    // (una línea que cambió de área: su fila vieja de la otra área se va por el id). area SIEMPRE explícita.
    if(ids.length)
      await sql`DELETE FROM data WHERE obra_id=${OBRA_ID} AND fecha=${fecha} AND (area=${area} OR id_registro = ANY(${textoArrayPg_(ids)}::text[]))`;
    else
      await sql`DELETE FROM data WHERE obra_id=${OBRA_ID} AND fecha=${fecha} AND area=${area}`;
    for(const r of rows) await insertarDataFila_(sql, r, fecha);
    // 2) BANDEJA: marcar incluido / descartado SOLO las filas del día de esa área (L2513–L2516).
    const ban=await sql`SELECT id_registro, area, centro_costo FROM bandeja WHERE obra_id=${OBRA_ID} AND fecha=${fecha}`;
    const idsInc=[], idsDesc=[];
    ban.forEach(function(r){
      if(areaDeFila(r.area||'', r.centro_costo||'')!==area) return;
      (inc[r.id_registro] ? idsInc : idsDesc).push(r.id_registro);
    });
    if(idsInc.length)  await sql`UPDATE bandeja SET estado='incluido'   WHERE obra_id=${OBRA_ID} AND id_registro = ANY(${textoArrayPg_(idsInc)}::text[])`;
    if(idsDesc.length) await sql`UPDATE bandeja SET estado='descartado' WHERE obra_id=${OBRA_ID} AND id_registro = ANY(${textoArrayPg_(idsDesc)}::text[])`;
  });
  return json(c, {ok:true, enviadas:rows.length, area:area});
}
