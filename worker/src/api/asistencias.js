/**
 * api/asistencias.js — router del módulo ASISTENCIAS en el Worker (4.01 · Fase 3 · D180).
 *
 * Reproduce la secuencia EXACTA de doGet (backend/CodigoAsistencias.gs L1440–L1476) y doPost
 * (L1477–L1533): puerta_ (comun.js) con params.token / body.token y action||'ping' (GET) o
 * action||'?' (POST); la identidad del token SOBRESCRIBE lo que venga en la petición (D109) —
 * en GET params.usuario=ses.usuario y params._rol=ses.rol (D142), en POST body.usuario=body.reporta=
 * ses.usuario; lista de acciones de escritura (L1508) y 'acción no reconocida' literal; validación
 * de payload VAL_ASIS_* (L581–L591) + validarPayloadAsistencias_ (L594–L602) con 'reingreso'
 * añadido a VAL_ASIS_PERSONAL.op (decisión 8); alias extras_admin_dia; despacho a los submódulos.
 *
 * Diferencias con el .gs (decisiones 5, 8, 9, 11):
 *   · Sin LockService (L1514–L1519): cada escritura abre su propia transacción con
 *     pg_advisory_xact_lock(...) dentro de escritura.js. El router ya no toma cerrojo global.
 *   · LOG lo pone index.js (servirDb): logIniciar_ + etiqueta action||'ping'/'reporte' + logEscribir_.
 *     Aquí solo se marca 'error' en el catch de doPost (paralelo de logMarcar_ L1531).
 *   · doGet RELANZA la excepción (L1474): no la captura, así index.js la vuelve 500 {error:'worker'}.
 *     doPost la captura y devuelve {ok:false, error:String(err)} con 200 (L1531): asimetría conservada.
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 */
import { json, puerta_, logMarcar_, valEsquema_, valListaDe_, rechazoPayload_,
         VAL_DIAS_FUTURO_FLOTA, VAL_MAX_HORAS } from '../comun.js';
import { roster, asistenciaDia, personalCompleto, exportDia, ausenciasRango,
         horasPersona, horasAdmin, extrasAdminDia, cacheReset } from './asistencias/lectura.js';
import { guardarAsistencia, guardarIndividual, gestionPersonal,
         guardarExtrasAdmin, borrarExtrasAdmin } from './asistencias/escritura.js';

/* ---------- validación de payload (CodigoAsistencias.gs L581–L602, D166) ----------
 * Copia verbatim de los esquemas VAL_ASIS_* y de validarPayloadAsistencias_. Único cambio: el
 * cubo 'l' de VAL_ASIS_PERSONAL.op añade 'reingreso' (decisión 8 — la pantalla ya lo manda y el .gs
 * lo rebotaba). Vive aquí, no en comun.js, porque es del módulo asistencias (regla dura de archivos). */
const VAL_ASIS_FILA = {
  codigo:['t',50], cedula:['t',50], nombre:['t',200], cargo:['t',100], cuadrilla:['t',100], cc:['t'], proyecto:['t',20],
  hora_entrada:['h'], hora_salida:['h'], presente:['t',10], motivo_ausencia:['t',200], observacion:['tl'], turno:['t',50]
};
const VAL_ASIS_REPORTE    = { fecha:['f',0], cuadrilla:['t',100], reporta:['t',100], nota:['tl'], filas:['a'] };
const VAL_ASIS_INDIVIDUAL = { fecha:['f',0], filas:['a'] };
const VAL_ASIS_PERSONAL   = { op:['l',['alta','retiro','mover','reactivar','reingreso']], codigo:['t',50], cedula:['t',50], nombre:['t',200],
                              cargo:['t',100], cuadrilla:['t',100], fecha_ingreso:['f',VAL_DIAS_FUTURO_FLOTA],
                              fecha_retiro:['f',VAL_DIAS_FUTURO_FLOTA], _row:['e',1,10000000] };
const VAL_ASIS_EXTRAS     = { fecha:['f',0], cc:['t'], horas:['n',0,VAL_MAX_HORAS], tipo:['l',['diurna','nocturna','domfest']] };
const VAL_ASIS_EXTRAS_DEL = { fecha:['f',0] };

// Devuelve la RESPUESTA de rechazo (lista para `return`) o null si el payload pasa (L594–L602).
function validarPayloadAsistencias_(c, body){
  const a=String(body.action||'');
  let f=null;
  if(a==='reporte_asistencia')         f = valEsquema_(body, VAL_ASIS_REPORTE, '')    || valListaDe_(body.filas, VAL_ASIS_FILA, 'filas');
  else if(a==='asistencia_individual') f = valEsquema_(body, VAL_ASIS_INDIVIDUAL, '') || valListaDe_(body.filas, VAL_ASIS_FILA, 'filas');
  else if(a==='personal')              f = valEsquema_(body, VAL_ASIS_PERSONAL, '');
  else if(a==='extras_admin')          f = valEsquema_(body, VAL_ASIS_EXTRAS, '');
  else if(a==='extras_admin_delete')   f = valEsquema_(body, VAL_ASIS_EXTRAS_DEL, '');
  return f ? rechazoPayload_(c, f.campo, f.motivo) : null;
}

/* ---------- routing (CodigoAsistencias.gs L1440–L1476) ---------- */
export async function asistenciasDoGet_(c, params){
  const a=String((params&&params.action)||'').toLowerCase();
  // D109: puerta única (token + LOG + rate limit 60/min por usuario+action + respuesta genérica).
  const p=await puerta_(c, (params&&params.token)||'', a||'ping');
  if(!p.ok) return p.respuesta;
  const ses=p.ses;
  // D109/D142: la identidad del token sobrescribe lo que venga en la petición (usuario y rol).
  if(ses.usuario) params.usuario = ses.usuario;
  params._rol = ses.rol || '';
  if(a==='roster')        return roster(c, params);
  if(a==='asistencia')    return asistenciaDia(c, params);
  if(a==='personal')      return personalCompleto(c, params);
  if(a==='export')        return exportDia(c, params);
  if(a==='ausencias')     return ausenciasRango(c, params);   // D94
  if(a==='persona')       return horasPersona(c, params);     // D112
  if(a==='persona_admin') return horasAdmin(c, params);       // D142
  if(a==='cache_reset')   return cacheReset(c, params);       // no-op (decisión 11)
  if(a==='extras_admin' || a==='extras_admin_dia') return extrasAdminDia(c, params);   // D73 (+ alias)
  return json(c, { ok:true, msg:'API Asistencias viva' });
  // doGet RELANZA cualquier excepción: no se captura aquí (index.js la vuelve 500 {error:'worker'}, L1474).
}

export async function asistenciasDoPost_(c, body){
  try{
    const a=String((body&&body.action)||'');
    // D109: identidad desde el token; en este módulo `usuario` Y `reporta` son el que está en sesión.
    const p=await puerta_(c, (body&&body.token)||'', a||'?');
    if(!p.ok) return p.respuesta;
    const ses=p.ses;
    if(ses.usuario){ body.usuario = ses.usuario; body.reporta = ses.usuario; }
    // L1508: solo estas cinco acciones escriben; el resto es 'acción no reconocida'.
    const esEscritura = ['reporte_asistencia','asistencia_individual','personal','extras_admin','extras_admin_delete']
      .indexOf(body.action) >= 0;
    if(!esEscritura) return json(c, { ok:false, error:'acción no reconocida' });
    // D166: validación de tipos/rangos/longitudes/fechas ANTES del despacho.
    const vp=validarPayloadAsistencias_(c, body); if(vp) return vp;
    // Sin LockService (L1514–L1519): cada función abre su transacción con pg_advisory_xact_lock (decisión 5).
    if(body.action==='reporte_asistencia')    return await guardarAsistencia(c, body);
    if(body.action==='asistencia_individual') return await guardarIndividual(c, body);
    if(body.action==='personal')              return await gestionPersonal(c, body);
    if(body.action==='extras_admin')          return await guardarExtrasAdmin(c, body);   // D73
    if(body.action==='extras_admin_delete')   return await borrarExtrasAdmin(c, body);    // D73
  }catch(err){ logMarcar_(c, 'error', String(err)); return json(c, { ok:false, error:String(err) }); }
}
