/**
 * api/asistencias/lectura.js — LECTURAS de ASISTENCIAS portadas al Worker (4.01 · Fase 3 · D180).
 *
 * Es el bloque de solo-lectura de backend/CodigoAsistencias.gs (roster L1575, asistenciaDia L1633,
 * personalCompleto L1925, exportDia L1939, ausenciasRango L2017, horasPersona L2090, horasAdmin L2187,
 * extrasAdminDia L2229, cacheReset L843) con los MISMOS nombres, los MISMOS mensajes literales, las
 * MISMAS claves de respuesta y el MISMO orden de comprobaciones. Solo cambia la capa de datos: las
 * hojas ASISTENCIA / EXTRAS_ADMIN / NOTAS_ASISTENCIA pasan a consultas SQL por fecha/rango, y los
 * catálogos salen de ./catalogos.js (memo_ por petición). El negocio (áreas, roster date-aware,
 * deduplicado D118, firmaLista_/compactar_ D133) se copia verbatim desde ./areas.js y ./personas.js.
 *
 * Qué cambia respecto al .gs y por qué:
 *   · `e.parameter` → `params` (GET) ya con `usuario` y `_rol` sembrados desde el token por el router
 *     (asistenciasDoGet_, doGet L1453/L1459): el cliente no inventa identidad ni rol.
 *   · readSheet('ASISTENCIA')/leerFilasPorFecha_ → `SELECT … FROM asistencia WHERE obra_id AND fecha=…`
 *     ORDER BY "timestamp", id_registro (decisión 9). El `_row` de la hoja ya no existe: en asistenciaDia
 *     se sustituye por un entero secuencial i+2 (decisión 6/7), en personalCompleto por personal_id
 *     (que ./catalogos.js personal_ ya pone en `_row`).
 *   · recientesCC (roster) y proyectoDefecto (export) miran TODO el histórico como el .gs, pero se
 *     ordenan/agrupan EN SQL (DISTINCT ON + GROUP BY, decisión 5), nunca con String(timestamp) en JS
 *     (con Date de postgres.js saldría «Wed Sep …» y rompería el orden).
 *   · Sin CacheService: cacheReset es un no-op con la misma forma (decisión 11). extrasAdminDelDia_/
 *     notasDelDia_ son helpers PRIVADOS aquí (las escrituras tienen sus propias versiones en escritura.js;
 *     ver `pendientes`): leen su tabla por fecha con la misma semántica.
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 */
import { OBRA_ID, json, hoyBogota, fdate, fdateValida_, ftime, norm, textoArrayPg_ } from '../../comun.js';
import {
  cuadrillas_, personal_, catCC_, turnos_, getConfigMap, getFestivos, areaDeCuadrillaMap,
  cuadrillaActiva, cuadrillasInactivasSet, cuadrillasDeUsuario, sinCCexcluidos, ccUsadosParaArea,
  motivosCatalogo, motivosUsados, catTrabajadoresMap
} from './catalogos.js';
import { areasEfectivas, cuadrillaEnAreas, areasDeUsuario, areaDeReportante } from './areas.js';
import {
  unicasPorPersona_, activaEnFecha, esEventual, keyPersona, tipoJornada, jornadaDelDia,
  diasDelRango, MAX_DIAS_RANGO, compactar_, firmaLista_, COLS_FILAS, COLS_FALTANTES
} from './personas.js';

/* ---------- helpers privados de lectura ---------- */
// timestamptz (Date de postgres.js/PGlite) → ISO; NULL/'' → '' (decisión 9). La pantalla compara la
// hora de reporte (cuadrillasEstado.hora) y el timestamp de EXTRAS_ADMIN como el JSON de Apps Script.
function isoTs_(v){
  if(v && typeof v==='object' && typeof v.getFullYear==='function') return v.toISOString();
  return (v===null || v===undefined) ? '' : v;
}
// turnos para el cliente: mismo map que el .gs (L1615/L1751/L1974) — tipo_dia norm, 4 horas ftime,
// cruza_medianoche 'SI' → boolean. turnos_ ya aplicó ftime (idempotente).
export async function turnosCliente_(c){
  return (await turnos_(c)).map(function(t){
    return { turno:String(t.turno||''), tipo_dia:norm(t.tipo_dia),
      entrada:ftime(t.entrada), salida:ftime(t.salida), descanso_ini:ftime(t.descanso_ini), descanso_fin:ftime(t.descanso_fin),
      cruza_medianoche: String(t.cruza_medianoche||'').toUpperCase()==='SI' };
  });
}
/* extrasAdminDelDia L2221 — registros del admin del día (D73). PK (obra_id, fecha) ⇒ 0..1 filas.
 * PRIVADO: escritura.js tendrá su propia versión (pendientes). timestamp → ISO (decisión 9). */
async function extrasAdminDelDia_(c, fecha){
  const f=fdate(fecha); if(!f) return [];
  const filas=await c.sql`SELECT fecha, cc, proyecto, horas, tipo, "timestamp", reporta
    FROM extras_admin WHERE obra_id=${OBRA_ID} AND fecha=${f}`;
  return filas.map(function(r){
    return { fecha:fdate(r.fecha), cc:String(r.cc||''), proyecto:String(r.proyecto||''),
      horas:Number(r.horas)||0, tipo:norm(r.tipo), timestamp:isoTs_(r.timestamp), reporta:String(r.reporta||'') };
  });
}
/* notasDelDia L2370 — notas libres del día por cuadrilla, nota no vacía (D74). PRIVADO (ver pendientes). */
async function notasDelDia_(c, fecha){
  const f=fdate(fecha); if(!f) return [];
  const filas=await c.sql`SELECT cuadrilla, reporta, nota FROM notas_asistencia
    WHERE obra_id=${OBRA_ID} AND fecha=${f} AND btrim(nota)<>''`;
  return filas.map(function(r){ return { cuadrilla:String(r.cuadrilla||''), reporta:String(r.reporta||''), nota:String(r.nota||'') }; });
}

/* ---------- GET roster: arma el formulario del responsable en una sola llamada (L1575-L1630) ---------- */
export async function roster(c, params){
  const usuario=params.usuario||'';
  const cuadrillas=await cuadrillasDeUsuario(c, usuario);
  const cfg=await getConfigMap(c);
  const festivos=await getFestivos(c);
  // D106: el roster es de solo lectura; una fecha inválida cae al día de hoy (Bogotá), no rechaza.
  const fecha=fdateValida_(params.fecha) || hoyBogota();
  const personalTodo=await personal_(c);
  // D72/D85/D118: activa en la fecha, no eventual, de sus cuadrillas y deduplicada por persona.
  const personas=unicasPorPersona_(personalTodo.filter(function(p){ return activaEnFecha(p, fecha) && !esEventual(p) && cuadrillas.indexOf(p.cuadrilla)>=0; }))
    .map(function(p){ return { cedula:p.cedula||'', codigo:p.codigo||'', nombre:p.nombre||'', cargo:p.cargo||'', cuadrilla:p.cuadrilla||'' }; });
  const jornada=jornadaDelDia(fecha, cfg, festivos);
  // D72: CC completos sin los excluidos del bloque (I010305…).
  const catCC=await sinCCexcluidos(c, (await catCC_(c)).map(function(r){ return String(r.string_cc||''); }).filter(Boolean));
  // D72/D88: CC frecuentes del área del reportante (rol forzado, o derivada de sus cuadrillas).
  const areasRep=areasDeUsuario(usuario);
  const catCCUsados=await ccUsadosParaArea(c, areasRep.length ? areasRep : await areaDeReportante(c, usuario));
  const catMotivos=await motivosUsados(c);   // D78: solo los frecuentes (fallback: catálogo completo)
  // D102: CC usados por cada cuadrilla — TODO el histórico, más reciente primero, hasta 10 distintos.
  // decisión 5: DISTINCT ON + orden EN SQL; el corte a 10 por cuadrilla se hace en JS.
  const recientesCC={};
  cuadrillas.forEach(function(cu){ recientesCC[cu]=[]; });
  if(cuadrillas.length){
    const filasCC=await c.sql`SELECT cuadrilla, cc FROM (
        SELECT DISTINCT ON (cuadrilla, cc) cuadrilla, cc, "timestamp"
        FROM asistencia WHERE obra_id=${OBRA_ID} AND cuadrilla = ANY(${textoArrayPg_(cuadrillas)}::text[]) AND cc<>''
        ORDER BY cuadrilla, cc, "timestamp" DESC) t
      ORDER BY cuadrilla, "timestamp" DESC`;
    filasCC.forEach(function(r){ const list=recientesCC[r.cuadrilla]; if(!list) return; if(list.indexOf(r.cc)<0 && list.length<10) list.push(r.cc); });
  }
  const turnos=await turnosCliente_(c);
  // D101/D119: `cuadrillasArea` (área por cuadrilla, ''→'tierras') y `areas` (forzadas por el rol).
  const cuadArea=await areaDeCuadrillaMap(c), cuadrillasArea={};
  cuadrillas.forEach(function(cu){ cuadrillasArea[cu]=cuadArea[cu]||'tierras'; });
  return json(c, { ok:true, cuadrillas:cuadrillas, cuadrillasArea:cuadrillasArea, personas:personas, config:cfg,
    festivos:festivos, jornada:jornada, catCC:catCC, catCCUsados:catCCUsados, catMotivos:catMotivos,
    recientesCC:recientesCC, turnos:turnos, areas:areasDeUsuario(usuario) });
}

/* ---------- GET asistencia: resumen del día para el residente/jeisson (L1633-L1797) ---------- */
export async function asistenciaDia(c, params){
  // D106: sin fecha válida NO se contesta (rompe el círculo de las filas huérfanas sin fecha).
  const fecha=fdateValida_(params.fecha);
  if(!fecha) return json(c, { ok:false, error:'Falta la fecha del resumen (o llegó con un formato que no se entiende). Elige el día en el campo "Fecha".' });
  const areas=areasEfectivas(c, params);
  const cuadArea=await areaDeCuadrillaMap(c);
  const enArea=function(cuadrilla){ return cuadrillaEnAreas(cuadrilla, areas, cuadArea); };
  // Filas del día ordenadas físicamente (decisión 9). `_row` = entero secuencial i+2 sobre el día completo
  // (decisión 6/7); se asigna ANTES del filtro de área para que sea estable (la pantalla solo lo muestra).
  const crudas=await c.sql`SELECT * FROM asistencia WHERE obra_id=${OBRA_ID} AND fecha=${fecha} ORDER BY "timestamp", id_registro`;
  const filas=crudas.map(function(r, i){
    return { _row:i+2, id_registro:r.id_registro, timestamp:isoTs_(r.timestamp), fecha:fdate(r.fecha), reporta:r.reporta,
      cuadrilla:r.cuadrilla, codigo:r.codigo, cedula:r.cedula, nombre:r.nombre, cargo:r.cargo, cc:r.cc,
      proyecto:r.proyecto, hora_entrada:ftime(r.hora_entrada), hora_salida:ftime(r.hora_salida),
      presente:r.presente, motivo_ausencia:r.motivo_ausencia, observacion:r.observacion, turno:String(r.turno||'') };
  }).filter(function(r){ return enArea(r.cuadrilla); });
  // D84: cuadrillas del resumen = activas del área + inactivas CON filas ese día.
  const cuadConFilas={}; filas.forEach(function(f){ cuadConFilas[f.cuadrilla]=true; });
  const cuadrillasCat=(await cuadrillas_(c)).filter(function(cq){ return enArea(cq.cuadrilla) && (cuadrillaActiva(cq) || cuadConFilas[cq.cuadrilla]); });
  // D72/D84/D85/D118: roster esperado date-aware, del área, sin inactivas, sin eventuales, deduplicado.
  const inactivas=await cuadrillasInactivasSet(c);
  const personalTodo=await personal_(c);
  const personalActivo=unicasPorPersona_(personalTodo.filter(function(p){ return activaEnFecha(p, fecha) && !esEventual(p) && enArea(p.cuadrilla) && !inactivas[p.cuadrilla]; }));
  const eventuales=personalTodo.filter(function(p){ return esEventual(p) && activaEnFecha(p, fecha) && enArea(p.cuadrilla); })
    .map(function(p){ return { codigo:p.codigo||'', cedula:p.cedula||'', nombre:p.nombre||'', cargo:p.cargo||'', cuadrilla:p.cuadrilla||'' }; });
  // Reporte COMPLETO: ausente con motivo, o presente CON centro de coste. Presente sin CC = incompleto.
  function filaValida(f){ return f.presente==='No' || (f.presente==='Si' && !!String(f.cc||'').trim()); }
  const codigosReportados={}, incompletos={};
  filas.forEach(function(f){
    const k=f.codigo||('CED:'+f.cedula);
    if(filaValida(f)) codigosReportados[k]=f;
    else if(f.presente==='Si') incompletos[k]=f;
  });
  const cuadrillasEstado=cuadrillasCat.map(function(cq){
    const filasCuad=filas.filter(function(f){ return f.cuadrilla===cq.cuadrilla && filaValida(f); });
    return { cuadrilla:cq.cuadrilla, responsables:cq.responsables||'',
      reporto: filasCuad.length>0,
      reporta: filasCuad.length ? filasCuad[0].reporta : '',
      hora: filasCuad.length ? filasCuad[0].timestamp : '',
      total: filasCuad.length };
  });
  const faltantes=[];
  personalActivo.forEach(function(p){
    const k=p.codigo||('CED:'+p.cedula);
    const reg=codigosReportados[k];
    if(reg){
      if(reg.presente==='No'){
        faltantes.push({ codigo:p.codigo||'', cedula:p.cedula||'', nombre:p.nombre||'', cargo:p.cargo||'',
          cuadrilla:p.cuadrilla||'', responsable:p.responsable||'', tipo:'ausente', motivo:reg.motivo_ausencia||'' });
      }
    } else {
      faltantes.push({ codigo:p.codigo||'', cedula:p.cedula||'', nombre:p.nombre||'', cargo:p.cargo||'',
        cuadrilla:p.cuadrilla||'', responsable:p.responsable||'', tipo:'sin_reportar', incompleto: !!incompletos[k] });
    }
  });
  const cfg=await getConfigMap(c);
  const festivos=await getFestivos(c);
  const jornada=jornadaDelDia(fecha, cfg, festivos);
  // D78: catálogos COMPLETOS para quien revisa. D133: catCCUsados como índices en catCC; catCCv firma.
  const catCC=(await catCC_(c)).map(function(r){ return String(r.string_cc||''); }).filter(Boolean);
  const catCCv=firmaLista_(catCC);
  const posCC={}; catCC.forEach(function(s, i){ posCC[s]=i; });
  const catCCUsados=(await ccUsadosParaArea(c, areas)).map(function(s){ return Object.prototype.hasOwnProperty.call(posCC, s) ? posCC[s] : s; });
  const catMotivos=await motivosCatalogo(c);
  const turnos=await turnosCliente_(c);
  // D73/D84: extras del admin solo si la vista abarca tierras (o no filtra). D74: notas del área.
  const verExtras = !areas.length || areas.indexOf('tierras')>=0;
  const extrasAdmin = verExtras ? await extrasAdminDelDia_(c, fecha) : [];
  const notas = (await notasDelDia_(c, fecha)).filter(function(n){ return enArea(n.cuadrilla); });
  // D133 (3a): `id_registro`, `timestamp` y `observacion` no viajan por fila (nadie los lee).
  const filasLigeras=filas.map(function(f){
    return { _row:f._row, fecha:f.fecha, reporta:f.reporta, cuadrilla:f.cuadrilla, codigo:f.codigo,
      cedula:f.cedula, nombre:f.nombre, cargo:f.cargo, cc:f.cc, proyecto:f.proyecto,
      hora_entrada:f.hora_entrada, hora_salida:f.hora_salida, presente:f.presente,
      motivo_ausencia:f.motivo_ausencia, turno:f.turno };
  });
  // D133d: `filas` y `faltantes` compactadas {cols, datos} con COLS_FILAS / COLS_FALTANTES exactas.
  const resp={ ok:true, fecha:fecha, filas:compactar_(filasLigeras, COLS_FILAS), cuadrillas:cuadrillasEstado,
    faltantes:compactar_(faltantes, COLS_FALTANTES), eventuales:eventuales, jornada:jornada, catCC:catCC, catCCv:catCCv,
    catCCUsados:catCCUsados, catMotivos:catMotivos, turnos:turnos, extrasAdmin:extrasAdmin, notas:notas,
    config:cfg, festivos:festivos, areas:areas };
  // D133 (2): el cliente ya tiene esta versión del catálogo → no se manda.
  if(String(params.ccv||'') === catCCv) delete resp.catCC;
  return json(c, resp);
}

/* ---------- GET personal: gestión — alcance por área (L1925-L1936) ---------- */
export async function personalCompleto(c, params){
  const areas=areasEfectivas(c, params);
  const cuadArea=await areaDeCuadrillaMap(c);
  const enArea=function(x){ return cuadrillaEnAreas(x, areas, cuadArea); };
  // personal_ ya pone `_row` = personal_id (decisión 6) y fdate en las fechas.
  const personal=(await personal_(c)).filter(function(p){ return enArea(p.cuadrilla); }).map(function(p){
    return { _row:p._row, cedula:p.cedula||'', codigo:p.codigo||'', nombre:p.nombre||'', cargo:p.cargo||'',
      cuadrilla:p.cuadrilla||'', responsable:p.responsable||'', estado:p.estado||'activo',
      fecha_retiro:fdate(p.fecha_retiro), fecha_ingreso:fdate(p.fecha_ingreso) };
  });
  // D84: los selectores de destino excluyen las inactivas.
  const cuadrillas=(await cuadrillas_(c)).filter(function(cq){ return enArea(cq.cuadrilla) && cuadrillaActiva(cq); })
    .map(function(cq){ return { cuadrilla:cq.cuadrilla||'', responsables:cq.responsables||'' }; });
  return json(c, { ok:true, personal:personal, cuadrillas:cuadrillas });
}

/* ---------- GET export: crudo del día para el generador Navision (L1939-L1983) ---------- */
export async function exportDia(c, params){
  // D106: sin fecha válida → ok:false (un Parte armado sobre filas sin fecha mezclaría días).
  const fecha=fdateValida_(params.fecha);
  if(!fecha) return json(c, { ok:false, error:'Falta la fecha del día a exportar (o llegó con un formato que no se entiende). Elige el día en el campo "Fecha".' });
  const areas=areasEfectivas(c, params);
  const cuadArea=await areaDeCuadrillaMap(c);
  const enArea=function(cuadrilla){ return cuadrillaEnAreas(cuadrilla, areas, cuadArea); };
  const crudas=await c.sql`SELECT * FROM asistencia WHERE obra_id=${OBRA_ID} AND fecha=${fecha} ORDER BY "timestamp", id_registro`;
  const filas=crudas.filter(function(r){ return enArea(r.cuadrilla); }).map(function(r){
    return { codigo:r.codigo||'', cedula:r.cedula||'', nombre:r.nombre||'', cargo:r.cargo||'',
      cuadrilla:r.cuadrilla||'', cc:r.cc||'', proyecto:String(r.proyecto||''),
      hora_entrada:ftime(r.hora_entrada), hora_salida:ftime(r.hora_salida),
      presente:r.presente||'Si', motivo_ausencia:r.motivo_ausencia||'', turno:String(r.turno||''), fecha:fdate(r.fecha) };
  });
  // proyectoDefecto: proyecto MÁS FRECUENTE por cuadrilla en TODO el histórico (presente='Si', proyecto≠'').
  // decisión 5: GROUP BY + DISTINCT ON en SQL; el desempate «primero visto» se aproxima con min(timestamp).
  const g=await c.sql`SELECT DISTINCT ON (cuadrilla) cuadrilla, proyecto FROM (
      SELECT cuadrilla, proyecto, count(*) n, min("timestamp") t
      FROM asistencia WHERE obra_id=${OBRA_ID} AND presente='Si' AND proyecto<>''
      GROUP BY cuadrilla, proyecto) g
    ORDER BY cuadrilla, n DESC, t`;
  const proyectoDefecto={};
  g.forEach(function(r){ proyectoDefecto[r.cuadrilla]=r.proyecto; });
  const catTrabajadores=await catTrabajadoresMap(c);
  const turnos=await turnosCliente_(c);
  // D73/D84: extras del admin (CC de tierras) solo si la vista abarca tierras.
  const verExtras = !areas.length || areas.indexOf('tierras')>=0;
  const extrasAdmin = verExtras ? await extrasAdminDelDia_(c, fecha) : [];
  return json(c, { ok:true, fecha:fecha, filas:filas, proyectoDefecto:proyectoDefecto, catTrabajadores:catTrabajadores,
    config:await getConfigMap(c), festivos:await getFestivos(c), turnos:turnos, extrasAdmin:extrasAdmin });
}

/* ---------- GET ausencias: seguimiento de ausencias por RANGO (L2017-L2068, D94) ---------- */
export async function ausenciasRango(c, params){
  const desde=fdateValida_(params.desde), hasta=fdateValida_(params.hasta);   // D106
  if(!desde || !hasta) return json(c, { ok:false, error:'Faltan las fechas del rango (desde/hasta), o llegaron con un formato que no se entiende.' });
  if(hasta < desde)    return json(c, { ok:false, error:'El rango está invertido: "hasta" es anterior a "desde".' });
  const dias=diasDelRango(desde, hasta);
  if(dias.length > MAX_DIAS_RANGO) return json(c, { ok:false, error:'Rango demasiado largo (máximo '+MAX_DIAS_RANGO+' días). Consulta por tramos.' });
  const areas=areasEfectivas(c, params);
  const cuadArea=await areaDeCuadrillaMap(c);
  const enArea=function(x){ return cuadrillaEnAreas(x, areas, cuadArea); };
  const enRangoRaw=await c.sql`SELECT fecha, cuadrilla, codigo, cedula, nombre, cargo, reporta, presente, motivo_ausencia
    FROM asistencia WHERE obra_id=${OBRA_ID} AND fecha BETWEEN ${desde} AND ${hasta}`;
  const enRango=enRangoRaw.filter(function(r){ return enArea(r.cuadrilla); });
  const filas=enRango.filter(function(r){ return String(r.presente||'')==='No'; }).map(function(r){
    return { fecha:fdate(r.fecha), codigo:String(r.codigo||''), cedula:String(r.cedula||''), nombre:String(r.nombre||''),
      cargo:String(r.cargo||''), cuadrilla:String(r.cuadrilla||''), reporta:String(r.reporta||''),
      motivo: String(r.motivo_ausencia||'').trim() || '(sin motivo)', tipo:'ausente' };
  });
  const festivos=await getFestivos(c);
  const repDia={}, cuadRepDia={};
  enRango.forEach(function(r){
    const f=fdate(r.fecha), cu=String(r.cuadrilla||'');
    (repDia[f]=repDia[f]||{})[keyPersona(r.codigo, r.cedula)]=true;
    (cuadRepDia[f]=cuadRepDia[f]||{})[cu]=true;
  });
  const inactivas=await cuadrillasInactivasSet(c);
  const personal=(await personal_(c)).filter(function(p){ return !esEventual(p) && enArea(p.cuadrilla) && !inactivas[p.cuadrilla]; });
  const sinReportar=[];
  dias.forEach(function(f){
    if(tipoJornada(f, festivos)==='domfest') return;   // D81
    const rep=repDia[f]||{}, cuadOk=cuadRepDia[f]||{};
    personal.forEach(function(p){
      if(!cuadOk[String(p.cuadrilla||'')]) return;
      if(!activaEnFecha(p, f)) return;
      if(rep[keyPersona(p.codigo, p.cedula)]) return;
      sinReportar.push({ fecha:f, codigo:String(p.codigo||''), cedula:String(p.cedula||''), nombre:String(p.nombre||''),
        cargo:String(p.cargo||''), cuadrilla:String(p.cuadrilla||''), reporta:'', motivo:'(no reportado)', tipo:'sin_reportar' });
    });
  });
  return json(c, { ok:true, desde:desde, hasta:hasta, dias:dias.length, filas:filas, sinReportar:sinReportar, catMotivos:await motivosCatalogo(c) });
}

/* ---------- GET persona: horas de UNA persona en un RANGO (L2090-L2164, D112) ---------- */
export async function horasPersona(c, params){
  const desde=fdateValida_(params.desde), hasta=fdateValida_(params.hasta);   // D106
  if(!desde || !hasta) return json(c, { ok:false, error:'Faltan las fechas del período (desde/hasta), o llegaron con un formato que no se entiende.' });
  if(hasta < desde)    return json(c, { ok:false, error:'El período está invertido: "hasta" es anterior a "desde".' });
  const dias=diasDelRango(desde, hasta);
  if(dias.length > MAX_DIAS_RANGO) return json(c, { ok:false, error:'Período demasiado largo (máximo '+MAX_DIAS_RANGO+' días). Consulta por tramos.' });
  // Identidad: `codigo` manda; si viene vacío, `cedula`. No se mezclan.
  const codigo=String(params.codigo||'').trim();
  const cedula=String(params.cedula||'').trim();
  if(!codigo && !cedula) return json(c, { ok:false, error:'Falta el código (o la cédula) de la persona.' });
  const esLaPersona=function(r){ return codigo ? (String(r.codigo||'').trim()===codigo) : (String(r.cedula||'').trim()===cedula); };
  const areas=areasEfectivas(c, params);
  const cuadArea=await areaDeCuadrillaMap(c);
  const enArea=function(x){ return cuadrillaEnAreas(x, areas, cuadArea); };
  // Ficha desde PERSONAL (la de hoy); si hay varias estancias (reingreso) manda la de fecha_ingreso más reciente.
  const personal=(await personal_(c)).filter(esLaPersona);
  personal.sort(function(a, b){ return fdate(a.fecha_ingreso) < fdate(b.fecha_ingreso) ? -1 : 1; });
  const p=personal.length ? personal[personal.length-1] : null;
  // Filas del rango de ESA persona (índice asistencia_codigo_fecha_idx). El re-filtro esLaPersona trima.
  const enRangoRaw = codigo
    ? await c.sql`SELECT * FROM asistencia WHERE obra_id=${OBRA_ID} AND fecha BETWEEN ${desde} AND ${hasta} AND codigo=${codigo}`
    : await c.sql`SELECT * FROM asistencia WHERE obra_id=${OBRA_ID} AND fecha BETWEEN ${desde} AND ${hasta} AND cedula=${cedula}`;
  const enRango=enRangoRaw.filter(esLaPersona);
  // Cerrojo de área (D69h/D109): del área hoy o en alguna fila del rango; si no, se rechaza.
  const deSuAreaHoy = p ? enArea(String(p.cuadrilla||'')) : false;
  const deSuAreaAntes = enRango.some(function(r){ return enArea(String(r.cuadrilla||'')); });
  if(areas.length && !deSuAreaHoy && !deSuAreaAntes) return json(c, { ok:false, error:'Esa persona no es de tu área.' });
  const filas=enRango.filter(function(r){ return enArea(String(r.cuadrilla||'')); }).map(function(r){
    return { fecha:fdate(r.fecha), reporta:String(r.reporta||''), cuadrilla:String(r.cuadrilla||''),
      codigo:String(r.codigo||''), cedula:String(r.cedula||''), nombre:String(r.nombre||''),
      cargo:String(r.cargo||''), cc:String(r.cc||''), proyecto:String(r.proyecto||''),
      hora_entrada:ftime(r.hora_entrada), hora_salida:ftime(r.hora_salida),
      presente:String(r.presente||'Si'), motivo_ausencia:String(r.motivo_ausencia||''),
      observacion:String(r.observacion||''), turno:String(r.turno||'') };
  }).sort(function(a, b){ return a.fecha<b.fecha ? -1 : (a.fecha>b.fecha ? 1 : 0); });
  const ult = filas.length ? filas[filas.length-1] : null;
  const persona = p ? {
      codigo:String(p.codigo||''), cedula:String(p.cedula||''), nombre:String(p.nombre||''),
      cargo:String(p.cargo||''), cuadrilla:String(p.cuadrilla||''), estado:String(p.estado||'activo'),
      fecha_ingreso:fdate(p.fecha_ingreso), fecha_retiro:fdate(p.fecha_retiro), enPersonal:true
    } : (ult ? {
      codigo:ult.codigo, cedula:ult.cedula, nombre:ult.nombre, cargo:ult.cargo, cuadrilla:ult.cuadrilla,
      estado:'', fecha_ingreso:'', fecha_retiro:'', enPersonal:false
    } : null);
  if(!persona) return json(c, { ok:false, error:'No se encontró a esa persona (ni en PERSONAL ni en lo reportado del período).' });
  return json(c, { ok:true, desde:desde, hasta:hasta, dias:dias.length, persona:persona, filas:filas,
    config:await getConfigMap(c), festivos:await getFestivos(c), turnos:await turnosCliente_(c) });
}

/* ---------- GET persona_admin: las horas del PROPIO admin (L2187-L2213, D142) ---------- */
export async function horasAdmin(c, params){
  // Rol del TOKEN (params._rol lo pone el router desde ses.rol), nunca del cliente.
  if(norm(params._rol)!=='admin') return json(c, { ok:false, error:'Estas horas son el canal propio del administrador (D73): solo él las consulta.' });
  const desde=fdateValida_(params.desde), hasta=fdateValida_(params.hasta);   // D106
  if(!desde || !hasta) return json(c, { ok:false, error:'Faltan las fechas del período (desde/hasta), o llegaron con un formato que no se entiende.' });
  if(hasta < desde)    return json(c, { ok:false, error:'El período está invertido: "hasta" es anterior a "desde".' });
  const dias=diasDelRango(desde, hasta);
  if(dias.length > MAX_DIAS_RANGO) return json(c, { ok:false, error:'Período demasiado largo (máximo '+MAX_DIAS_RANGO+' días). Consulta por tramos.' });
  const rows=await c.sql`SELECT fecha, cc, proyecto, horas, tipo, reporta FROM extras_admin
    WHERE obra_id=${OBRA_ID} AND fecha BETWEEN ${desde} AND ${hasta} ORDER BY fecha`;
  const filas=rows.map(function(r){
    return { fecha:fdate(r.fecha), cc:String(r.cc||''), proyecto:String(r.proyecto||''),
      horas:Number(r.horas)||0, tipo:norm(r.tipo), reporta:String(r.reporta||'') };
  });
  const cfg=await getConfigMap(c);
  return json(c, { ok:true, esAdmin:true, desde:desde, hasta:hasta, dias:dias.length,
    persona:{ codigo:String(cfg.admin_recurso||''), cedula:'', nombre:String(params.usuario||'admin'),
      cargo:'Administrador', cuadrilla:'', estado:'', fecha_ingreso:'', fecha_retiro:'', enPersonal:false },
    filas:filas, config:cfg, festivos:await getFestivos(c) });
}

/* ---------- GET extras_admin (alias extras_admin_dia): registro del día para prefill (L2229-L2233) ---------- */
export async function extrasAdminDia(c, params){
  const fecha=fdateValida_(params.fecha);   // D106: inválida → '' → registro null, no rechaza
  const regs=await extrasAdminDelDia_(c, fecha);
  return json(c, { ok:true, fecha:fecha, registro: regs.length ? regs[0] : null });
}

/* ---------- GET cache_reset: no-op (decisión 11; L843-L847) ---------- */
// Sin CacheService en el Worker; se conserva la forma ({ok, msg, hojas}) para no romper el botón «Refrescar
// catálogos» ni el caso de contrato. Los 10 nombres son los de HOJAS_CACHEABLES (CodigoAsistencias.gs L742).
export async function cacheReset(c, params){
  return json(c, { ok:true, msg:'Catálogos refrescados: la próxima consulta los relee del Sheet.',
    hojas:['CONFIG','FESTIVOS','TURNOS','CAT_CC','CAT_TRABAJADORES','CAT_MOTIVOS','MOTIVOS_USADOS','CC_USADOS','CUADRILLAS','PERSONAL'] });
}
