#!/usr/bin/env node
/**
 * backfill_obra.js — carga en Postgres el volcado CSV del Sheet de OBRA (Reporte Maquinaria) para la Fase 4
 * de la migración 4.01 (D180): las hojas que lee/escribe backend/Codigo.gs y que NO carga backfill_parte.js.
 *
 *   node worker/sql/backfill_obra.js --volcado="C:\Galca\volcado\2026-09-16_0027_obra" --simular   # cuenta, no escribe
 *   node worker/sql/backfill_obra.js --volcado=…                                                  # carga
 *   node worker/sql/backfill_obra.js --volcado=… --solo=volquetas,tablero                          # solo esas tablas
 *   node worker/sql/backfill_obra.js --volcado=… --solo=log                                        # LOG solo si se pide
 *
 * Conexión: DATABASE_URL en la terminal (o --conexion-archivo=<ruta fuera del repo>); nunca en el repo.
 * Orden del corte: 001 + 002 → backfill_parte.js → backfill_obra.js → backfill_asistencias.js (README).
 *
 * CSV → tabla (mapa:esquema-backfill · comparación con el volcado 2026-09-16_0027_obra):
 *   BANDEJA       → bandeja         28 cols por nombre (BANDEJA_HEADERS, Codigo.gs L75). Anexar: ON CONFLICT
 *                                   (obra_id, id_registro) DO NOTHING. id vacío (filas pre-D82) → uuid determinista
 *                                   de (archivo, línea, contenido), así relanzar el mismo CSV no duplica.
 *                                   Ids con sufijo '-z' (ZODME derivado, L1240) y estado 'no_data'/'pendiente' son
 *                                   válidos; area '' (=tierras, D69) se conserva: BANDEJA se filtra con areaDeFila.
 *   DATA          → data            POR POSICIÓN, 29 columnas A–AC (los encabezados del CSV son los del maestro,
 *                                   DATA_HEADERS L51: «CENTRO DE COSTO»…, no los de la tabla). Anexar DO NOTHING.
 *                                   area '' → deriveArea(centro_de_costo) (Codigo.gs L2211; decisión 4: nunca vacía
 *                                   desde 4.01, así el DELETE de enviarData por (fecha, area) es exacto). id vacío → uuid.
 *                                   'REVISAR · ' en ELEMENTO y filas sin CC/UF: datos reales del maestro, verbatim.
 *   MAQUINARIA    → maquinaria      40 cols por nombre (MAQ_HEADERS L84). Anexar por (obra_id, app_id_registro);
 *                                   app_id_registro vacío → uuid. id_registro (col A de Captura) puede ir ''.
 *   VOLQUETAS     → volquetas       13 cols. `id_registro` es el id de la LÍNEA y lo comparten sus placas (L1183):
 *                                   PK surrogate volqueta_id (002 #1) ⇒ anexar SIN ON CONFLICT. Al relanzar se
 *                                   saltan las filas cuya (id_registro, placa, origen, destino) ya esté en la BD
 *                                   (`preexistentes`), así el duplicado exacto legítimo del CSV (TBC747 ×2) entra
 *                                   una vez cada uno la primera vez y ninguno la segunda.
 *   OBSERVACIONES → observaciones   6 cols (OBS_HEADERS L193). Anexar DO NOTHING; id vacío → uuid.
 *   TABLERO       → tablero         una fila por obra: fila orden=0 → meta jsonb, trozos 1..n (sin el '~' inicial,
 *                                   tableroLeer L3197) unidos → foto jsonb; publicado_ts = meta.generado (Bogotá).
 *                                   Falta un trozo o el JSON no parsea → no se carga (mismo criterio que L3203).
 *                                   INSERT … ON CONFLICT (obra_id) DO UPDATE.
 *   USUARIOS      → usuarios        6 cols (USUARIOS_HEADERS L3049); usuario en minúsculas. REESCRIBIR por obra:
 *                                   cargar siempre el último volcado (0027 añade 'arnes'). Las claves ya son SHA-256
 *                                   de 'usuario:clave' (hashClave_ L3053); auth.js acepta claro si no casa /^[0-9a-f]{64}$/.
 *   CUBICAJE      → cubicaje        POR POSICIÓN (el CSV no trae encabezados: primera línea ','): col 0 placa,
 *                                   col 1 cubicaje; placa → normPlaca (L991: alfanumérica, MAYÚSCULAS, últimos 6;
 *                                   19 vienen en minúsculas); tipo ''. Reescribir.
 *   BASE          → base_elementos  J elemento, K abs_inicio, L abs_fin CRUDOS (text, D68), M uf, tipo = baseTipo
 *                                   (L690; '' = fuera de alcance, el Worker lo descarta al leer), orden = nº de fila
 *                                   (PK desde 002 #2: los 10 marcadores ODT repetidos entran todos). Reescribir.
 *                 → base_items      ítems A–H ampliados con capitulo, grupo, uf, proyecto, orden_hoja (002 #3), para
 *                                   editarlos en el Table Editor. Reescribir (pisa la carga de 4 columnas de la Fase 2).
 *   LOG           → log             modulo='obra'; SOLO con --solo=log (retención 30 días: no se migra por defecto).
 * NO carga MAQUINAS ni parte_*: los carga backfill_parte.js y están vivos en producción (una recarga pisaría
 * ediciones hechas desde Flota o el Table Editor tras el corte del Parte).
 *
 * Conversiones (backfill_lib.js): date 'yyyy-MM-dd' tal cual; timestamps de Bogotá → '<ts>-05:00'; '' → NULL en
 * fecha/número y '' en texto; una fila con fecha/número que no se entiende NO se carga y sale como aviso (D106).
 * Es también un módulo: `backfillObra(sql, dir, opciones)` lo usa worker/pruebas/contrato_local.js con PGlite.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './csv.js';
import { OBRA_ID, cargarTablas, correrCli, convertir, deriveArea, normPlaca, idDeFila, filasBaseItems, filasBaseElementos } from './backfill_lib.js';

export { OBRA_ID };

// Codigo.gs L75 BANDEJA_HEADERS · L51 DATA_HEADERS (en orden A–AC, nombres de la tabla) · L84 MAQ_HEADERS · L197 VOLQUETAS_HEADERS ·
// L193 OBS_HEADERS · L3049 USUARIOS_HEADERS · L2666 LOG_HEADERS
const BANDEJA_COLS   = ['id_registro','timestamp','fecha','reporta','rol','grupo','capitulo','actividad','descripcion','centro_costo','unidad','uf','proyecto','elemento','pk_inicial','pk_final','abs_inicial','abs_final','liberacion','largo','observacion','estado','origen','area','personal_oficiales','personal_ayudantes','turno_noche','nota_libre'];
const DATA_COLS      = ['fecha','orden','grupo','centro_de_costo','capitulo','descripcion','unidad_funcional','proyecto','elemento','abs_inicial','abs_final','liberacion','acta','unidad_medida','largo','espesor','fc','cantidad','observacion','columna1','id_registro','timestamp','capataz','rol','actividad','pk_inicial','pk_final','area','clima'];
const MAQ_COLS       = ['id_registro','fecha','dia','proyecto','id_maquina','tipo_equipo','operador','actividad','sub_actividad','unidad','horas_programadas','horas_operadas','pct_util','horas_muertas','horas_mantenimiento','pct_muerto','horas_facturadas','estado','clima','produccion','meta','pct_ef','rendimiento','unitario','viajes','costo','observacion','app_id_registro','id_cantidad','timestamp','reporta','app_tipo_equipo','app_horas_programadas','app_horas_muertas','motivo','unidad_prod','cap_actividad','a_captura','produccion_capataz_orig','area'];
const VOLQUETAS_COLS = ['id_registro','timestamp','fecha','reporta','origen','destino','tipo_destino','uf','placa','viajes','cubicaje','m3_placa','cubicaje_origen'];
const OBS_COLS       = ['id_registro','timestamp','fecha','reporta','observacion','area'];
const USUARIOS_COLS  = ['usuario','clave','rol','areas','redirige','estado'];
const LOG_COLS       = ['fecha_hora','usuario','rol','action','resultado','motivo','ms'];

// id vacío (filas pre-D82) → uuid determinista de (archivo, línea, contenido): relanzar el mismo CSV no duplica.
const idOUuid = (col, csv) => (f, i) => { if (!f[col]) f[col] = idDeFila(f, csv, i); };

/* TABLERO.csv (orden, texto) → una fila {meta, foto, publicado_ts}, como tableroLeer (Codigo.gs L3192-L3210). */
export function filasTablero(texto, res){
  const { filas } = parseCsv(texto);
  const trozos = []; let meta = null, hayMeta = false;
  filas.forEach(r => {
    const orden = Number(r[0]), txt = String(r[1] == null ? '' : r[1]);
    const limpio = txt.charAt(0) === '~' ? txt.slice(1) : txt;
    if (orden === 0) { hayMeta = true; try { meta = JSON.parse(limpio); } catch (e) { meta = null; } return; }
    if (orden > 0) trozos[orden - 1] = limpio;
  });
  if (!filas.length) return [];
  for (let i = 0; i < trozos.length; i++) if (trozos[i] == null) { res.avisos.push('TABLERO: falta el trozo ' + (i + 1) + ' de ' + trozos.length + ' → foto incompleta, NO se carga'); return []; }
  const crudo = trozos.join('');
  if (!crudo) { res.avisos.push('TABLERO: sin trozos (solo meta) → NO se carga'); return []; }
  let foto;
  try { foto = JSON.parse(crudo); } catch (e) { res.avisos.push('TABLERO: la foto no es JSON válido → NO se carga'); return []; }
  if (!hayMeta) res.avisos.push('TABLERO: sin fila de meta (orden 0): meta = {}');
  let publicado_ts = null;
  try { publicado_ts = meta && meta.generado ? convertir('ts', meta.generado) : null; } catch (e) { res.avisos.push('TABLERO: meta.generado «' + meta.generado + '» no es timestamp: publicado_ts = ahora'); }
  return [{ meta: JSON.stringify(meta || {}), foto: JSON.stringify(foto), publicado_ts: publicado_ts || new Date().toISOString() }];
}

export const TABLAS_OBRA = [
  { tabla:'bandeja',        csv:'BANDEJA.csv',       cols:BANDEJA_COLS,   clave:['id_registro'],     modo:'anexar', requiere:['fecha'], ajustar: idOUuid('id_registro', 'BANDEJA.csv') },
  { tabla:'data',           csv:'DATA.csv',          cols:DATA_COLS,      clave:['id_registro'],     modo:'anexar', requiere:['fecha'], posicion:true,
    ajustar: (f, i) => { if (!f.area) f.area = deriveArea(f.centro_de_costo); if (!f.id_registro) f.id_registro = idDeFila(f, 'DATA.csv', i); } },
  { tabla:'maquinaria',     csv:'MAQUINARIA.csv',    cols:MAQ_COLS,       clave:['app_id_registro'], modo:'anexar', requiere:['fecha'], ajustar: idOUuid('app_id_registro', 'MAQUINARIA.csv') },
  { tabla:'volquetas',      csv:'VOLQUETAS.csv',     cols:VOLQUETAS_COLS, clave:null,                modo:'anexar', requiere:['fecha'], ajustar: idOUuid('id_registro', 'VOLQUETAS.csv'),
    preexistentes:['id_registro','placa','origen','destino'] },
  { tabla:'observaciones',  csv:'OBSERVACIONES.csv', cols:OBS_COLS,       clave:['id_registro'],     modo:'anexar', requiere:['fecha'], ajustar: idOUuid('id_registro', 'OBSERVACIONES.csv') },
  { tabla:'tablero',        csv:'TABLERO.csv',       cols:['meta','foto','publicado_ts'], clave:[],  modo:'anexar', conflicto:'update', casts:{ meta:'jsonb', foto:'jsonb' }, filas: filasTablero },
  { tabla:'usuarios',       csv:'USUARIOS.csv',      cols:USUARIOS_COLS,  clave:['usuario'],         modo:'reescribir', requiere:['usuario'],
    ajustar: (f) => { f.usuario = String(f.usuario).trim().toLowerCase(); } },
  { tabla:'cubicaje',       csv:'CUBICAJE.csv',      cols:['placa','cubicaje'], fijos:{ tipo:'' }, clave:['placa'], modo:'reescribir', requiere:['placa'], posicion:true,
    ajustar: (f) => { f.placa = normPlaca(f.placa); } },
  { tabla:'base_elementos', csv:'BASE.csv',          cols:['elemento','abs_inicio','abs_fin','uf','tipo','orden'], clave:['orden'], modo:'reescribir', filas: (texto) => filasBaseElementos(texto) },
  { tabla:'base_items',     csv:'BASE.csv',          cols:['cc','descripcion','unidad','orden','capitulo','grupo','uf','proyecto','orden_hoja'], clave:['cc','descripcion'], modo:'reescribir', filas: (texto) => filasBaseItems(texto) },
  { tabla:'log',            csv:'LOG.csv',           cols:LOG_COLS,       fijos:{ modulo:'obra' }, clave:null, modo:'anexar', requiere:['fecha_hora'] }
];
export const ORDEN_TABLAS = TABLAS_OBRA.map(t => t.tabla);
const SOLO_EXPLICITO = ['log'];

export async function backfillObra(sql, dir, opciones){
  return cargarTablas(sql, TABLAS_OBRA, dir, opciones || {}, SOLO_EXPLICITO);
}

/* ---------- CLI ---------- */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  correrCli('Backfill de obra (Fase 4)', 'C:\\Galca\\volcado\\2026-09-16_0027_obra', backfillObra)
    .catch(err => { console.error('El backfill falló: ' + (err && err.stack || err)); process.exit(1); });
