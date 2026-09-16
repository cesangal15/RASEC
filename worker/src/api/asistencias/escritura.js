/**
 * api/asistencias/escritura.js — escrituras de ASISTENCIAS portadas al Worker (4.01 · Fase 3 · D180).
 *
 * Es el bloque de ESCRITURA de backend/CodigoAsistencias.gs con los MISMOS nombres de función, los MISMOS
 * mensajes de error literales y las MISMAS claves de respuesta. Solo cambia la capa de datos (hoja → SQL):
 *
 *   guardarAsistencia   L2296  POST reporte_asistencia  → upsert quirúrgico del bloque fecha+cuadrilla (D03/D107/D126)
 *   upsertNotaDia       L2357  (helper)                 → nota libre del día por cuadrilla (D74)
 *   notasDelDia         L2370  (helper de lectura)      → notas del día
 *   guardarIndividual   L1827  POST asistencia_individual → upsert por persona (D107/D119/D123/D129)
 *   extrasAdminDelDia   L2221  (helper de lectura)      → extra del día (0..1)
 *   guardarExtrasAdmin  L2235  POST extras_admin        → upsert por fecha (D73/D124)
 *   borrarExtrasAdmin   L2270  POST extras_admin_delete → borra el día
 *   gestionPersonal     L2378  POST personal            → alta|retiro|reactivar|reingreso|mover (D72/D84/D118)
 *
 * Qué cambia respecto al .gs y por qué (decisiones 4, 6, 8, 9, 10, 12):
 *   · Sin LockService: cada escritura de asistencia abre UNA transacción (sql.begin) y toma
 *     pg_advisory_xact_lock(hashtext(obra|fecha|cuadrilla)) en reporte_asistencia y
 *     pg_advisory_xact_lock(hashtext(obra|fecha)) en asistencia_individual (edita a través de cuadrillas,
 *     D119/D126); ambos, además, hacen `SELECT … WHERE fecha=$1 FOR UPDATE`.
 *   · El upsert quirúrgico de la hoja (pisar-en-sitio + borrar sobrantes + anexar) se vuelve
 *     DELETE … WHERE id_registro = ANY($ids) + INSERT con crypto.randomUUID() (ON CONFLICT DO NOTHING).
 *     El resultado lógico es el mismo; los contadores de la respuesta se calculan a partir de counts.
 *   · El emparejador (emparejadorDePersonas_, D123) se evalúa en JS sobre las filas del día (personas.js).
 *   · extras_admin: UPSERT por (obra_id, fecha); extras_admin_delete: DELETE … RETURNING.
 *   · gestionPersonal: identidad = personal_id (bigserial) que la pantalla reenvía en body._row
 *     (decisión 6); 'inactivo' como estado de retiro; fecha vacía → NULL; reingreso = fila nueva.
 *   · Tras escribir personal se invalida el memo 'asis:personal' de la petición (paralelo de invalidarHoja_).
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 * El router (api/asistencias.js) ya sembró body.usuario / body._rol / body.reporta desde el token y ya
 * validó el payload (VAL_ASIS_*, D166) antes de llegar aquí: estas funciones son la lógica de negocio.
 */
import { OBRA_ID, json, fdate, fdateValida_, hoyBogota, norm, textoArrayPg_ } from '../../comun.js';
import { unicasPorPersona_, emparejadorDePersonas_, clavePersona_, activaEnFecha, proyectoFromCC } from './personas.js';
import { cuadrillaPermitidaPara, areasDeUsuario, cuadrillaEnAreas } from './areas.js';
import { areaDeCuadrillaMap, responsableDeCuadrilla, getConfigMap } from './catalogos.js';

/* ERROR_FECHA (CodigoAsistencias.gs L636) — vive aún en el .gs; se copia aquí verbatim porque comun.js no
 * lo exporta (ver 'pendientes': candidato a subir a comun.js para compartir con lectura.js). */
const ERROR_FECHA = 'La fecha del reporte llegó vacía o con un formato que no se entiende. '
  + 'Vuelve a elegir el día en el campo "Fecha" y envía otra vez. '
  + 'No se guardó nada a propósito: una asistencia sin fecha no aparece en el resumen ni en el Parte.';

// Lista cerrada de USUARIOS que gestionan personal / completan faltantes (CodigoAsistencias.gs L1834 y
// L2389; cableada, decisión 12 · D72/D84/D88/D101/D119). Idéntica en ambos endpoints.
const ASIS_USUARIOS_GESTION = ['residente','admin','jeisson','duvan','residente_uf3','angie','residente_odt','residente_odl','residente_dren'];

// invalidarHoja_('PERSONAL') → borra el memo de la petición (catalogos.js lo lee con memo_). Privado; ver
// 'pendientes': si otro módulo lo necesita, sube a un invalidarMemoAsis_ compartido.
function invalidarPersonalMemo_(c){ try{ if(c && c.memo) delete c.memo['asis:personal']; }catch(_e){} }

/* Fila de ASISTENCIA (las 17 columnas, orden de ASISTENCIA_HEADERS) a partir de una `f` del payload y del
 * encabezado del envío. `presente`: false | 'No' → 'No', resto 'Si' (L2311/L1857). */
function filaAsistencia_(f, ts, fecha, reporta, cuadrilla){
  return {
    id_registro: crypto.randomUUID(), timestamp: ts, fecha: fecha, reporta: reporta, cuadrilla: cuadrilla,
    codigo: f.codigo||'', cedula: f.cedula||'', nombre: f.nombre||'', cargo: f.cargo||'',
    cc: f.cc||'', proyecto: f.proyecto||'', hora_entrada: f.hora_entrada||'', hora_salida: f.hora_salida||'',
    presente: (f.presente===false || f.presente==='No') ? 'No' : 'Si',
    motivo_ausencia: f.motivo_ausencia||'', observacion: f.observacion||'', turno: f.turno||''
  };
}
async function insertarAsistencia_(sql, r){
  await sql`INSERT INTO asistencia (obra_id, id_registro, "timestamp", fecha, reporta, cuadrilla, codigo, cedula, nombre, cargo,
      cc, proyecto, hora_entrada, hora_salida, presente, motivo_ausencia, observacion, turno)
    VALUES (${OBRA_ID}, ${r.id_registro}, ${r.timestamp}, ${r.fecha}, ${r.reporta}, ${r.cuadrilla}, ${r.codigo}, ${r.cedula}, ${r.nombre}, ${r.cargo},
      ${r.cc}, ${r.proyecto}, ${r.hora_entrada}, ${r.hora_salida}, ${r.presente}, ${r.motivo_ausencia}, ${r.observacion}, ${r.turno})
    ON CONFLICT (obra_id, id_registro) DO NOTHING`;
}

/* ======================================================================================================
 * POST reporte_asistencia — guardarAsistencia (CodigoAsistencias.gs L2296–L2353)
 * ====================================================================================================== */
/* D03/D82: re-envío pisa fecha+cuadrilla (sin bandeja), idempotente por diseño (UUID nuevo por fila).
 * D126: además del bloque fecha+cuadrilla se borra la fila de ESE día de cualquier persona entrante que
 * venga en OTRA cuadrilla (cambio de cuadrilla), con el mismo emparejador que el upsert por persona. */
export async function guardarAsistencia(c, body){
  const fecha=fdateValida_(body.fecha), cuadrilla=body.cuadrilla||'', reporta=body.reporta||'', ts=new Date();
  if(!fecha) return json(c, { ok:false, error:ERROR_FECHA });                                 // D106
  if(!(await cuadrillaPermitidaPara(c, reporta, cuadrilla)))                                   // D101/D69h
    return json(c, { ok:false, error:'Esa cuadrilla no es de tu área.' });
  const entrantes=unicasPorPersona_(body.filas||[]);                                           // D119: deduplica el envío
  const nuevas=entrantes.map(function(f){ return filaAsistencia_(f, ts, fecha, reporta, cuadrilla); });
  const esDeLosEntrantes=emparejadorDePersonas_(entrantes);                                     // D123
  await c.sql.begin(async function(sql){
    // Sin LockService: el advisory lock serializa dos envíos de la misma fecha+cuadrilla (D125); el FOR
    // UPDATE de abajo, cuando hay filas, ya serializa toda escritura del día.
    await sql`SELECT pg_advisory_xact_lock(hashtext(${OBRA_ID+'|'+fecha+'|'+cuadrilla}))`;
    const existentes=await sql`SELECT id_registro, cuadrilla, codigo, cedula, nombre FROM asistencia
      WHERE obra_id=${OBRA_ID} AND fecha=${fecha} FOR UPDATE`;
    // D126: cuadrilla del bloque O cualquier persona entrante, esté en la cuadrilla que esté.
    const aBorrar=existentes.filter(function(o){ return String(o.cuadrilla)===cuadrilla || esDeLosEntrantes(o); })
      .map(function(o){ return o.id_registro; });
    if(aBorrar.length) await sql`DELETE FROM asistencia WHERE obra_id=${OBRA_ID} AND id_registro = ANY(${textoArrayPg_(aBorrar)}::text[])`;
    for(const r of nuevas) await insertarAsistencia_(sql, r);
    // D74: nota libre del día por cuadrilla, en la MISMA transacción (pisa fecha+cuadrilla igual que las filas).
    await upsertNotaDia(c, fecha, cuadrilla, reporta, body.nota, ts, sql);
  });
  return json(c, { ok:true, filas:nuevas.length });
}

/* ======================================================================================================
 * NOTAS_ASISTENCIA — upsertNotaDia / notasDelDia (CodigoAsistencias.gs L2357–L2372)
 * ====================================================================================================== */
// Upsert por (fecha, cuadrilla). Nota vacía = borra la del día. `sql` opcional: la transacción del llamador
// (guardarAsistencia) o, si se llama suelto, c.sql (autocommit).
export async function upsertNotaDia(c, fecha, cuadrilla, reporta, nota, ts, sql){
  const f=fdateValida_(fecha), cua=cuadrilla||'', txt=String(nota==null?'':nota).trim();
  if(!f) return;                                                                                // D106: el llamador ya valida
  const q=sql||c.sql;
  await q`DELETE FROM notas_asistencia WHERE obra_id=${OBRA_ID} AND fecha=${f} AND cuadrilla=${cua}`;
  if(txt) await q`INSERT INTO notas_asistencia (obra_id, fecha, cuadrilla, reporta, nota, "timestamp")
      VALUES (${OBRA_ID}, ${f}, ${cua}, ${reporta||''}, ${txt}, ${ts||new Date()})
    ON CONFLICT (obra_id, fecha, cuadrilla) DO UPDATE SET reporta=EXCLUDED.reporta, nota=EXCLUDED.nota, "timestamp"=EXCLUDED."timestamp"`;
}
// Notas del día con texto (para la lectura del resumen). Orden estable por cuadrilla.
export async function notasDelDia(c, fecha){
  const f=fdate(fecha);
  const filas=await c.sql`SELECT cuadrilla, reporta, nota FROM notas_asistencia
    WHERE obra_id=${OBRA_ID} AND fecha=${f} AND btrim(nota)<>'' ORDER BY cuadrilla`;
  return filas.map(function(r){ return { cuadrilla:String(r.cuadrilla||''), reporta:String(r.reporta||''), nota:String(r.nota||'') }; });
}

/* ======================================================================================================
 * POST asistencia_individual — guardarIndividual (CodigoAsistencias.gs L1827–L1922)
 * ====================================================================================================== */
/* "Completar faltantes": upsert POR PERSONA. Solo residente/admin/jeisson y los roles de área (D72/D84/
 * D88/D101/D119). NUNCA añade una fila nueva si la persona ya estaba (emparejador código>cédula>nombre). */
export async function guardarIndividual(c, body){
  const usuario=norm(body.usuario);
  if(ASIS_USUARIOS_GESTION.indexOf(usuario)<0) return json(c, { ok:false, error:'No autorizado para completar faltantes.' });
  const fecha=fdateValida_(body.fecha), ts=new Date();
  if(!fecha) return json(c, { ok:false, error:ERROR_FECHA });                                   // D106
  // D101: cerrojo de área por cada cuadrilla distinta de las filas.
  const cuadUnicas=(body.filas||[]).map(function(f){ return String(f.cuadrilla||''); })
    .filter(function(cc,i,a){ return a.indexOf(cc)===i; });
  const ajena=[];
  for(const cc of cuadUnicas){ if(!(await cuadrillaPermitidaPara(c, usuario, cc))) ajena.push(cc); }
  if(ajena.length) return json(c, { ok:false, error:'Esa cuadrilla no es de tu área: '+ajena.join(', ') });
  const incoming=unicasPorPersona_(body.filas||[]);                                             // D125: deduplica el envío
  const esDeLosEntrantes=emparejadorDePersonas_(incoming);                                       // D123
  const nuevas=incoming.map(function(f){ return filaAsistencia_(f, ts, fecha, body.reporta||usuario, f.cuadrilla||''); });
  let aBorrar=[];
  await c.sql.begin(async function(sql){
    await sql`SELECT pg_advisory_xact_lock(hashtext(${OBRA_ID+'|'+fecha}))`;                     // por fecha: la edición cruza cuadrillas
    const existentes=await sql`SELECT id_registro, cuadrilla, codigo, cedula, nombre FROM asistencia
      WHERE obra_id=${OBRA_ID} AND fecha=${fecha} FOR UPDATE`;
    aBorrar=existentes.filter(function(o){ return esDeLosEntrantes(o); }).map(function(o){ return o.id_registro; });
    if(aBorrar.length) await sql`DELETE FROM asistencia WHERE obra_id=${OBRA_ID} AND id_registro = ANY(${textoArrayPg_(aBorrar)}::text[])`;
    for(const r of nuevas) await insertarAsistencia_(sql, r);
  });
  // D129: mismos contadores que el upsert quirúrgico de la hoja, calculados de los counts (DELETE+INSERT
  // no tiene "posiciones"): pisadas=min, borradas=resto de aBorrar, anexadas=resto de nuevas.
  const pisadas=Math.min(aBorrar.length, nuevas.length);
  const borradas=aBorrar.length-pisadas, anexadas=nuevas.length-pisadas;
  return json(c, { ok:true, filas:nuevas.length, reemplazadas:aBorrar.length, pisadas:pisadas, borradas:borradas, anexadas:anexadas });
}

/* ======================================================================================================
 * EXTRAS_ADMIN — extrasAdminDelDia / guardarExtrasAdmin / borrarExtrasAdmin (CodigoAsistencias.gs L2221–L2287)
 * ====================================================================================================== */
// L2221 extrasAdminDelDia — extra(s) del día (0..1). Helper de lectura (extrasAdminDia); timestamp Date→ISO (decisión 9).
export async function extrasAdminDelDia(c, fecha){
  const f=fdate(fecha); if(!f) return [];
  const filas=await c.sql`SELECT fecha, cc, proyecto, horas, tipo, "timestamp", reporta
    FROM extras_admin WHERE obra_id=${OBRA_ID} AND fecha=${f} ORDER BY fecha`;
  return filas.map(function(r){
    let ts=r.timestamp;
    if(ts && typeof ts==='object' && typeof ts.getFullYear==='function') ts=ts.toISOString();
    return { fecha:fdate(r.fecha), cc:String(r.cc||''), proyecto:String(r.proyecto||''),
      horas:Number(r.horas)||0, tipo:norm(r.tipo), timestamp:ts, reporta:String(r.reporta||'') };
  });
}
// L2235 guardarExtrasAdmin — upsert por fecha (D73). Deriva `proyecto` del CC; tope desde CONFIG (D124).
export async function guardarExtrasAdmin(c, body){
  const fecha=fdateValida_(body.fecha);                                                          // D106
  const cc=String(body.cc||'').trim();
  const horas=Number(body.horas);
  const tipo=norm(body.tipo);
  if(!fecha) return json(c, { ok:false, error:'Falta la fecha.' });
  if(!cc)    return json(c, { ok:false, error:'Falta el centro de costo.' });
  if(['diurna','nocturna','domfest'].indexOf(tipo)<0) return json(c, { ok:false, error:'Tipo inválido (usa diurna, nocturna o domfest).' });
  // D124: los dos topes salen de CONFIG (día normal ≤ max_extras_dia; domingo/festivo ≤ domfest_tope + max_extras_dia).
  const cfgTopes=await getConfigMap(c);
  const _tD=parseFloat(cfgTopes.domfest_tope),   topeD=isNaN(_tD)?7:_tD;
  const _tE=parseFloat(cfgTopes.max_extras_dia), topeE=isNaN(_tE)?2:_tE;
  const maxH = (tipo==='domfest') ? (topeD+topeE) : topeE;
  if(isNaN(horas) || !(horas>0 && horas<=maxH)) return json(c, { ok:false, error:'Las horas deben ser un número mayor que 0 y máximo '+maxH+' ('+(tipo==='domfest'?'domingo/festivo':'día normal')+').' });
  const proyecto=proyectoFromCC(cc);
  await c.sql`INSERT INTO extras_admin (obra_id, fecha, cc, proyecto, horas, tipo, "timestamp", reporta)
      VALUES (${OBRA_ID}, ${fecha}, ${cc}, ${proyecto}, ${horas}, ${tipo}, ${new Date()}, ${body.reporta||'admin'})
    ON CONFLICT (obra_id, fecha) DO UPDATE SET cc=EXCLUDED.cc, proyecto=EXCLUDED.proyecto, horas=EXCLUDED.horas,
      tipo=EXCLUDED.tipo, "timestamp"=EXCLUDED."timestamp", reporta=EXCLUDED.reporta`;
  return json(c, { ok:true, msg:'Extra guardada: '+fecha+' · '+horas+'h '+tipo+' · '+cc+' (proyecto '+(proyecto||'?')+').', proyecto:proyecto });
}
// L2270 borrarExtrasAdmin — elimina la fila del día.
export async function borrarExtrasAdmin(c, body){
  const fecha=fdateValida_(body.fecha);                                                          // D106
  if(!fecha) return json(c, { ok:false, error:'Falta la fecha.' });
  const borr=await c.sql`DELETE FROM extras_admin WHERE obra_id=${OBRA_ID} AND fecha=${fecha} RETURNING fecha`;
  const borradas=borr.length;
  return json(c, { ok:true, msg: borradas ? ('Extra del '+fecha+' eliminada.') : ('No había extra registrada el '+fecha+'.'), borradas:borradas });
}

/* ======================================================================================================
 * POST personal — gestionPersonal (CodigoAsistencias.gs L2378–L2476)
 * ====================================================================================================== */
/* Alta / retiro / reactivar / reingreso / mover. SOLO residente/admin y los roles de área (D72/D84/D88/
 * D101/D119). Identidad = personal_id (bigserial) que la pantalla reenvía en body._row (decisión 6). */
export async function gestionPersonal(c, body){
  const usuario=norm(body.usuario);
  if(ASIS_USUARIOS_GESTION.indexOf(usuario)<0) return json(c, { ok:false, error:'No autorizado: solo residente o admin.' });
  const areasUsr=areasDeUsuario(usuario);                                                        // [] = todas (residente general/admin)
  const cuadArea=await areaDeCuadrillaMap(c);
  const okArea=function(cuadrilla){ return cuadrillaEnAreas(cuadrilla, areasUsr, cuadArea); };
  const op=body.op||'';
  const hoy=hoyBogota();

  if(op==='alta'){
    const cuadrilla=body.cuadrilla||'';
    if(!okArea(cuadrilla)) return json(c, { ok:false, error:'Esa cuadrilla no es de tu área.' });
    const responsable=await responsableDeCuadrilla(c, cuadrilla);
    const fechaIng=fdate(body.fecha_ingreso)||hoy;                                               // D72: alta retroactiva; default hoy
    const code=String(body.codigo||'').trim();
    let res;
    await c.sql.begin(async function(sql){
      // D118: no dar de alta dos veces a la misma persona ACTIVA (clavePersona_: el código manda; si falta, la cédula).
      const cands = code
        ? await sql`SELECT personal_id, codigo, cedula, nombre, cuadrilla, estado, fecha_retiro, fecha_ingreso
            FROM personal WHERE obra_id=${OBRA_ID} AND btrim(codigo)=${code} FOR UPDATE`
        : await sql`SELECT personal_id, codigo, cedula, nombre, cuadrilla, estado, fecha_retiro, fecha_ingreso
            FROM personal WHERE obra_id=${OBRA_ID} AND btrim(codigo)='' AND btrim(cedula)=${String(body.cedula||'').trim()} FOR UPDATE`;
      const yaExiste=cands.find(function(p){ return activaEnFecha(p, hoy); });
      if(yaExiste){
        res=json(c, { ok:false, error:'Ya existe una persona activa con ese '+(code?'código':'documento')
          +' ('+(yaExiste.nombre||'')+', cuadrilla '+(yaExiste.cuadrilla||'')+'). '
          +'Si cambió de cuadrilla usa MOVER; si volvió a la obra usa REINGRESO. Dar de alta otra vez la duplicaría en el Parte.' });
        return;
      }
      await sql`INSERT INTO personal (obra_id, cedula, codigo, nombre, cargo, cuadrilla, responsable, estado, fecha_retiro, fecha_ingreso)
        VALUES (${OBRA_ID}, ${body.cedula||''}, ${body.codigo||''}, ${body.nombre||''}, ${body.cargo||''}, ${cuadrilla}, ${responsable}, 'activo', ${null}, ${fechaIng})`;
      res=json(c, { ok:true, op:'alta' });
    });
    invalidarPersonalMemo_(c);
    return res;
  }

  // Ops sobre una fila existente: identidad = personal_id (decisión 6; el .gs pedía _row≥2 por ser fila de
  // hoja — aquí la frontera del identificador es ≥1 porque bigserial empieza en 1).
  const row=Number(body._row);
  if(!row || row<1) return json(c, { ok:false, error:'Falta identificar la persona (_row).' });

  let res;
  await c.sql.begin(async function(sql){
    const filas=await sql`SELECT personal_id, cedula, codigo, nombre, cargo, cuadrilla, responsable, estado, fecha_retiro, fecha_ingreso
      FROM personal WHERE obra_id=${OBRA_ID} AND personal_id=${row} FOR UPDATE`;
    const src=filas[0]||null;
    // D72/D84: un residente de área solo toca filas de sus áreas ([] = sin restricción).
    if(areasUsr.length){ if(!src || !okArea(src.cuadrilla)){ res=json(c, { ok:false, error:'Esa persona no es de tu área.' }); return; } }

    if(op==='retiro'){
      const fechaRet=fdate(body.fecha_retiro)||hoy;                                              // D72: primer día NO trabajado; default hoy
      await sql`UPDATE personal SET estado='inactivo', fecha_retiro=${fechaRet} WHERE obra_id=${OBRA_ID} AND personal_id=${row}`;
      res=json(c, { ok:true, op:'retiro' }); return;
    }
    if(op==='reactivar'){
      await sql`UPDATE personal SET estado='activo', fecha_retiro=${null} WHERE obra_id=${OBRA_ID} AND personal_id=${row}`;
      res=json(c, { ok:true, op:'reactivar' }); return;
    }
    if(op==='reingreso'){
      // D72/D118: reingreso REAL con historial — fila NUEVA, exige que la de origen esté retirada.
      const fechaIng=fdate(body.fecha_ingreso)||hoy;
      if(!src){ res=json(c, { ok:false, error:'No se encontró la persona a reingresar.' }); return; }
      if(activaEnFecha(src, fechaIng)){
        res=json(c, { ok:false, error:'Esa persona sigue ACTIVA'+(src.cuadrilla?' en la cuadrilla '+src.cuadrilla:'')
          +', así que no hay reingreso que registrar. Retírala primero (con su fecha de salida) y reingrésala, '
          +'o usa MOVER si lo que cambió fue la cuadrilla.' });
        return;
      }
      const responsable=(await responsableDeCuadrilla(c, src.cuadrilla))||src.responsable||'';
      await sql`INSERT INTO personal (obra_id, cedula, codigo, nombre, cargo, cuadrilla, responsable, estado, fecha_retiro, fecha_ingreso)
        VALUES (${OBRA_ID}, ${src.cedula||''}, ${src.codigo||''}, ${src.nombre||''}, ${src.cargo||''}, ${src.cuadrilla||''}, ${responsable}, 'activo', ${null}, ${fechaIng})`;
      res=json(c, { ok:true, op:'reingreso' }); return;
    }
    if(op==='mover'){
      const cuadrilla=body.cuadrilla||'';
      if(!okArea(cuadrilla)){ res=json(c, { ok:false, error:'Esa cuadrilla no es de tu área.' }); return; }
      const responsable=await responsableDeCuadrilla(c, cuadrilla);
      await sql`UPDATE personal SET cuadrilla=${cuadrilla}, responsable=${responsable} WHERE obra_id=${OBRA_ID} AND personal_id=${row}`;
      res=json(c, { ok:true, op:'mover' }); return;
    }
    res=json(c, { ok:false, error:'op no reconocida' });
  });
  invalidarPersonalMemo_(c);
  return res;
}
