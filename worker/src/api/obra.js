/**
 * api/obra.js — router del módulo OBRA en el Worker (4.01 · Fase 4 · D180).
 *
 * Es la secuencia EXACTA de doGet (backend/Codigo.gs L1047–L1087) y doPost (L1088–L1131) del Apps
 * Script, con el MISMO contrato, pero despachando a los submódulos que portan cada endpoint a Postgres
 * en vez de a las hojas. El LOG, el cronómetro (`_ms`) y la conexión los pone src/index.js (servirDb):
 * aquí solo se decide, por `action`, a quién se llama, tras pasar por la puerta única (D109).
 *
 *   GET  ?action=tablero                 PÚBLICO (ANTES de la puerta, sin LOG: D159/D161) → tablero.js
 *   GET  ?action=tablero_vivo            PÚBLICO (ANTES de la puerta, sin LOG; D185 = ampliación de D161 decidida por el
 *                                        dueño: el Tablero en vivo con la DATA de Galca; index.js lo cachea 60 s) → tablero_vivo.js
 *   GET  ?action=data_csv | proyeccion_csv   NO llegan aquí: index.js (servirCsv, D187) los atiende ANTES de la puerta con
 *                                        la CLAVE DE LECTURA del Excel maestro (CLAVE_LECTURA_EXCEL) → obra/data_csv.js
 *   GET  (resto)                         TOKEN (puerta_ action||'ping') → lectura / flota / data / maquinaria
 *                                        (proyeccion y proyeccion_tablero reciben además la sesión: V3-11 / D183;
 *                                        cat_tablas/cat_leer también — pantalla Catálogos, SOLO admin)
 *   POST {action:'login'}                PÚBLICO (aún no hay token, D108) → auth.js login_
 *   POST {action:'enviar_data'|…}        TOKEN (puerta_ action||'reporte') → validarPayloadObra_ + handler
 *                                        (D185: tablero_horas_guardar = las horas del libro de partes, admin/jefe;
 *                                        cat_guardar = pantalla Catálogos, SOLO admin)
 *   POST (sin action reconocida)         TOKEN → guardarReporte (reporte de capataz/chequeadora, L1132)
 *
 * Los handlers de escritura reciben la sesión de puerta_ como 3er argumento (ses={ok,usuario,rol,tolerado});
 * además se siembra body.usuario/_rol/_auth_tolerada como en el .gs (L1123–L1125) por si alguno lo lee.
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 *
 * REGLA DURA DE ARCHIVOS: VAL_OBRA_FLOTA / VAL_OBRA_FLOTA_CLAVE / VAL_MAX_FOTO_CHARS (Codigo.gs
 * L2953–L2964) los usa SOLO validarPayloadObra_ (rama flota_guardar / tablero_guardar), así que viven
 * aquí como privados; si se centralizan, moverlos a comun.js. El resto de VAL_OBRA_* se importa de los
 * submódulos que los definen (reporte.js, data.js, maquinaria.js).
 */
import {
  json, puerta_, valEsquema_, valListaDe_, rechazoPayload_,
  VAL_MAX_HORAS, VAL_DIAS_FUTURO_FLOTA
} from '../comun.js';
import { login_ } from '../auth.js';

// Submódulos de OBRA (cada uno porta su bloque del Codigo.gs; ver cabeceras de ./obra/*.js).
import { tableroLeer, tableroGuardar } from './obra/tablero.js';
import { maquinasCatalogo, flotaLeer, flotaGuardar } from './obra/flota.js';
import { bandeja, consolidado, estado, cubicaje, volquetasDelDia, acumuladoDrenajes, debug } from './obra/lectura.js';
import { drenajesCatalogo, tramosCatalogo, enviarData, VAL_OBRA_ENVIAR } from './obra/data.js';
import { maquinariaProduccion, maquinariaProduccionGuardar, VAL_OBRA_MAQPROD, VAL_OBRA_AJUSTE, VAL_OBRA_NUEVA } from './obra/maquinaria.js';
import { guardarReporte, validarReporte_, VAL_OBRA_CANTIDAD } from './obra/reporte.js';
import { gridLeer, gridGuardar, VAL_OBRA_GRID, VAL_OBRA_GRID_CAMBIO } from './obra/grilla.js';  // V3-08 / D181
import { dataGridLeer, dataGridGuardar, VAL_DATA_GRID, VAL_DATA_GRID_CAMBIO } from './obra/datagrid.js';  // V3-08b / D181
import { proyeccionLeer, proyeccionTablero, proyeccionGuardar, VAL_PROYECCION, VAL_PROYECCION_CAMBIO } from './obra/proyeccion.js';  // V3-11 / D183
import { tableroVivoLeer, tableroHorasGuardar, VAL_MAX_HORAS_CHARS } from './obra/tablero_vivo.js';  // V3-11 Fases B+C / D185
import { catTablas, catLeer, catGuardar, VAL_OBRA_CAT, VAL_OBRA_CAT_CAMBIO } from './obra/catalogos_admin.js';  // pantalla Catálogos (solo admin)
import { resumenEjecutivoLeer, resumenEjecutivoIA, VAL_RESUMEN_EJECUTIVO_IA } from './obra/resumen_ejecutivo.js';  // Resumen ejecutivo (jefe)

/* ---------- esquemas D166 que solo usa el router (Codigo.gs L2953–L2964) ---------- */
const VAL_OBRA_FLOTA = {
  op:['l',['alta','baja','corregir']], id_maquina:['t',50], tipo:['t',50], horas_prog:['n',0,VAL_MAX_HORAS],
  propiedad:['t',50], fecha_ingreso:['f',VAL_DIAS_FUTURO_FLOTA], fecha_retiro:['f',VAL_DIAS_FUTURO_FLOTA],
  notas:['tl'], fecha:['f',VAL_DIAS_FUTURO_FLOTA],
  frente:['t',20], placa:['t',30], proveedor:['t',80], medidor:['t',20]
};   // D173
const VAL_OBRA_FLOTA_CLAVE = { id_maquina:['t',50], fecha_ingreso:['f',VAL_DIAS_FUTURO_FLOTA] };
const VAL_MAX_FOTO_CHARS = 4000000;   // tablero: 100 trozos de TABLERO_TROZO

// Codigo.gs L2971–L3013 — validación de tipos/rangos/longitudes/fechas del payload ANTES de tocar la BD.
// Devuelve la RESPUESTA de rechazo (lista para `return`, vía rechazoPayload_) o null si el payload pasa.
function validarPayloadObra_(c, body){
  const a=String(body.action||'');
  let f=null;
  if(a==='enviar_data'){
    f = valEsquema_(body, VAL_OBRA_ENVIAR, '') || valListaDe_(body.cantidades, VAL_OBRA_CANTIDAD, 'cantidades');
  } else if(a==='maquinaria_produccion'){
    f = valEsquema_(body, VAL_OBRA_MAQPROD, '') || valListaDe_(body.ajustes, VAL_OBRA_AJUSTE, 'ajustes')
     || valListaDe_(body.nuevas, VAL_OBRA_NUEVA, 'nuevas', 300);
  } else if(a==='flota_guardar'){
    f = valEsquema_(body, VAL_OBRA_FLOTA, '') || valEsquema_(body.clave, VAL_OBRA_FLOTA_CLAVE, 'clave');
  } else if(a==='cat_guardar'){
    f = valEsquema_(body, VAL_OBRA_CAT, '') || valListaDe_(body.cambios, VAL_OBRA_CAT_CAMBIO, 'cambios', 1000);   // pantalla Catálogos
  } else if(a==='grid_guardar'){
    f = valEsquema_(body, VAL_OBRA_GRID, '') || valListaDe_(body.cambios, VAL_OBRA_GRID_CAMBIO, 'cambios', 500);   // V3-08 / D181
  } else if(a==='data_grid_guardar'){
    f = valEsquema_(body, VAL_DATA_GRID, '') || valListaDe_(body.cambios, VAL_DATA_GRID_CAMBIO, 'cambios', 1000);  // V3-08b / D181
  } else if(a==='proyeccion_guardar'){
    f = valEsquema_(body, VAL_PROYECCION, '') || valListaDe_(body.cambios, VAL_PROYECCION_CAMBIO, 'cambios', 500);  // V3-11 / D183
  } else if(a==='resumen_ejecutivo_ia'){
    f = valEsquema_(body, VAL_RESUMEN_EJECUTIVO_IA, '');
  } else if(a==='tablero_horas_guardar'){
    // D185: `horas` = la salida de leerHoras (objeto); su FORMA la valida el handler con un texto legible (lista blanca).
    const h=body.horas;
    if(h===undefined || h===null || typeof h!=='object' || Array.isArray(h)) f={ campo:'horas', motivo:'debe ser un objeto' };
    else {
      let n=0; try{ n=JSON.stringify(h).length; }catch(err){ f={ campo:'horas', motivo:'no serializable' }; }
      if(!f && n>VAL_MAX_HORAS_CHARS) f={ campo:'horas', motivo:'supera '+VAL_MAX_HORAS_CHARS+' caracteres' };
      if(!f) f=valEsquema_(body, { archivo:['t',200] }, '');
    }
  } else if(a==='tablero_guardar'){
    const foto=body.foto;
    if(foto!==undefined && (foto===null || typeof foto!=='object' || Array.isArray(foto))) f={ campo:'foto', motivo:'debe ser un objeto' };
    else if(foto){
      let n=0; try{ n=JSON.stringify(foto).length; }catch(err){ f={ campo:'foto', motivo:'no serializable' }; }
      if(!f && n>VAL_MAX_FOTO_CHARS) f={ campo:'foto', motivo:'supera '+VAL_MAX_FOTO_CHARS+' caracteres' };
      if(!f) f=valEsquema_(foto, { generado:['t',100] }, 'foto');
    }
  } else {
    // reporte de capataz/chequeadora/drenajes (sin `action`): validarReporte_ empaqueta la rama completa
    // (L3001–L3031) y YA devuelve la respuesta rechazoPayload_ o null.
    return validarReporte_(c, body);
  }
  return f ? rechazoPayload_(c, f.campo, f.motivo) : null;
}

/* ---------- Codigo.gs L1047–L1087 (doGet) ---------- */
export async function obraDoGet_(c, params){
  const a = String((params && params.action) || '').toLowerCase();
  // D159: ÚNICA lectura pública y va ANTES de la puerta; no escribe LOG (index.js pone c.pet.log.silencio).
  if(a==='tablero') return tableroLeer(c);
  // D185: el Tablero EN VIVO también es público (ampliación de D161 decidida por el dueño): días plegados de la DATA,
  // proyección sin `usuario` y horas de máquina guardadas; nada con nombres de personas. Sin LOG (index.js).
  if(a==='tablero_vivo') return tableroVivoLeer(c, params);
  // D109: puerta única. La identidad sale del TOKEN y sobrescribe lo que venga en la petición.
  const p = await puerta_(c, params && params.token, a || 'ping');
  if(!p.ok) return p.respuesta;
  const ses = p.ses;
  if(ses.usuario) params.usuario = ses.usuario;
  if(a==='bandeja')              return bandeja(c, params);
  if(a==='consolidado')          return consolidado(c, params);
  if(a==='estado')               return estado(c, params);
  if(a==='cubicaje')             return cubicaje(c);
  if(a==='volquetas')            return volquetasDelDia(c, params);
  if(a==='drenajes')             return drenajesCatalogo(c);
  if(a==='tramos')               return tramosCatalogo(c);       // D104: subtramos del eje para el selector
  if(a==='cat_tablas')           return catTablas(c, params, ses);  // pantalla Catálogos (solo admin)
  if(a==='cat_leer')             return catLeer(c, params, ses);    // pantalla Catálogos (solo admin)
  if(a==='grid')                 return gridLeer(c, params);     // V3-08 / D181: grilla editable de catálogos
  if(a==='data_grid')            return dataGridLeer(c, params); // V3-08b / D181: revisión editable de DATA
  if(a==='proyeccion')           return proyeccionLeer(c, params, ses);    // V3-11 / D183: las 4 tablas + puede_editar (servidor)
  if(a==='proyeccion_tablero')   return proyeccionTablero(c, params, ses); // V3-11 / D183: plan/proyectado/contrato/base del Tablero (token, no público)
  if(a==='resumen_ejecutivo')    return resumenEjecutivoLeer(c, params, ses); // Resumen ejecutivo (jefe): rango → indicadores + texto por reglas
  if(a==='maquinas')             return maquinasCatalogo(c, params); // D138: flota vigente en una fecha
  if(a==='flota')                return flotaLeer(c, params);        // D139: estancias + avisos de la pestaña Flota
  if(a==='acumulado_drenajes')   return acumuladoDrenajes(c, params);
  if(a==='maquinaria_produccion')return maquinariaProduccion(c, params);
  if(a==='debug')                return debug(c, params);
  return json(c, { ok:true, msg:'API viva', version:'v11' });
}

/* ---------- Codigo.gs L1088–L1131 (doPost) ---------- */
export async function obraDoPost_(c, body){
  if(body && body.action==='login') return login_(c, body);      // D108: única acción SIN token (aún no lo tiene)
  // D109: puerta única de escritura. `usuario` y `_rol` salen del token y se sobrescriben SIEMPRE.
  const a = String(body.action||'') || 'reporte';
  const p = await puerta_(c, body && body.token, a);
  if(!p.ok) return p.respuesta;
  const ses = p.ses;
  if(ses.usuario) body.usuario = ses.usuario;
  body._rol = ses.rol || '';
  body._auth_tolerada = !!ses.tolerado;
  // D166: validación del payload ANTES de tocar la BD (rechazo = {ok:false, error:'payload', campo}).
  const vp = validarPayloadObra_(c, body); if(vp) return vp;
  if(body.action==='enviar_data')            return enviarData(c, body, ses);
  if(body.action==='maquinaria_produccion')  return maquinariaProduccionGuardar(c, body, ses);
  if(body.action==='flota_guardar')          return flotaGuardar(c, body, ses);   // D139: alta/baja de máquinas
  if(body.action==='cat_guardar')            return catGuardar(c, body, ses);     // pantalla Catálogos (solo admin)
  if(body.action==='grid_guardar')           return gridGuardar(c, body, ses);    // V3-08 / D181: guarda la grilla
  if(body.action==='data_grid_guardar')      return dataGridGuardar(c, body, ses); // V3-08b / D181: guarda DATA
  if(body.action==='proyeccion_guardar')     return proyeccionGuardar(c, body, ses); // V3-11 / D183: guarda la Proyección (admin/jefe)
  if(body.action==='tablero_guardar')        return tableroGuardar(c, body, ses); // D158: publica la foto del tablero
  if(body.action==='tablero_horas_guardar')  return tableroHorasGuardar(c, body, ses); // D185: guarda las horas del libro de partes
  if(body.action==='resumen_ejecutivo_ia')   return resumenEjecutivoIA(c, body, ses); // Resumen ejecutivo: redacción con Workers AI (cae a reglas si falla)
  return guardarReporte(c, body, ses);
}
