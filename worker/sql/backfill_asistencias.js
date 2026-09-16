#!/usr/bin/env node
/**
 * backfill_asistencias.js — carga en Postgres el volcado CSV del Sheet de ASISTENCIAS para la Fase 3 de la
 * migración 4.01 (D180): las 14 hojas que lee/escribe backend/CodigoAsistencias.gs (HEADERS_DE_HOJA L802) + LOG.
 *
 *   node worker/sql/backfill_asistencias.js --volcado="C:\Galca\volcado\<sello>_asistencias" --simular
 *   node worker/sql/backfill_asistencias.js --volcado=…                                     # carga
 *   node worker/sql/backfill_asistencias.js --volcado=… --solo=asistencia,personal          # solo esas tablas
 *   node worker/sql/backfill_asistencias.js --volcado=… --solo=log                          # LOG solo si se pide
 *
 * El volcado sale de volcarAsistencias() (backend/volcado/VolcadoCSV.gs L56) y se descarga a C:\Galca\volcado.
 * Conexión: DATABASE_URL en la terminal (o --conexion-archivo=<ruta fuera del repo>); nunca en el repo.
 * Orden del corte: 001 + 002 → backfill_parte.js → backfill_obra.js → backfill_asistencias.js (README).
 *
 * Escrito contra los *_HEADERS de CodigoAsistencias.gs (no había volcado real en disco al escribirlo) y probado
 * con un CSV sintético generado a partir de backend/pruebas/contrato/semillas.js con casos raros (hora como
 * '1899-12-30 07:00:00', fecha vacía, tipo de extra inválido).
 *
 * CSV → tabla (mapa:esquema-backfill):
 *   ASISTENCIA        → asistencia        17 cols por nombre (ASISTENCIA_HEADERS L84). hora_entrada/hora_salida con
 *                                         ftime (L162: '1899-12-30 07:00:00' → '07:00', '7:00' → '07:00'); presente ''
 *                                         → 'Si'; id vacío → uuid determinista (archivo+línea+contenido: relanzar no
 *                                         duplica); fecha vacía o inválida → aviso y NO se carga (D106).
 *                                         Anexar: ON CONFLICT (obra_id, id_registro) DO NOTHING. Los duplicados
 *                                         históricos por persona/día (D119-D128) entran (no hay UNIQUE); se depuran
 *                                         después con el criterio de _duplicadosRango_ L2834.
 *   PERSONAL          → personal          9 cols (PERSONAL_HEADERS L72); fechas date; fila_sheet = línea del CSV
 *                                         (orientativo: `_row` pasa a ser personal_id, decisión 7). REESCRIBIR por obra
 *                                         SOLO si la tabla está vacía; si ya tiene filas (el Worker ya creó personas),
 *                                         anexar saltando las que ya estén (cedula, codigo, nombre, fechas).
 *   EXTRAS_ADMIN      → extras_admin      7 cols (L118). tipo fuera de diurna|nocturna|domfest (CHECK 001 L406) o horas
 *                                         vacía → aviso y no se carga. Anexar DO NOTHING por (obra_id, fecha).
 *   NOTAS_ASISTENCIA  → notas_asistencia  5 cols (L122). Anexar DO NOTHING por (obra_id, fecha, cuadrilla).
 *   CUADRILLAS · CONFIG · FESTIVOS · TURNOS · CAT_CC · CC_USADOS · CAT_MOTIVOS · MOTIVOS_USADOS · CAT_TRABAJADORES
 *                     → tabla homónima      catálogos: REESCRIBIR por obra (DELETE + INSERT), dedupe por clave dentro del
 *                                         CSV (se queda la primera). Desde 4.01 se editan en Supabase; esta es la carga
 *                                         inicial. CONFIG.valor con ftime SOLO si la celda era un Date de hora
 *                                         ('1899-12-30 …', NORMALIZA_HOJA L757); TURNOS.entrada/salida/descanso_* con
 *                                         ftime siempre; FESTIVOS.fecha date; orden = nº de fila en cat_cc, cc_usados,
 *                                         cat_motivos, motivos_usados (el .gs respeta el orden de la hoja).
 *                                         CC_USADOS.area '' (=tierras) y CUADRILLAS.estado '' (=activa) se conservan.
 *   LOG               → log               modulo='asistencias'; SOLO con --solo=log.
 * Conversiones (backfill_lib.js): date 'yyyy-MM-dd' tal cual; timestamps de Bogotá → '<ts>-05:00'; '' → NULL en
 * fecha/número y '' en texto. Códigos con ceros a la izquierda perdidos por Sheets se guardan como llegan (el Worker
 * compara normalizado, emparejadorDePersonas_ L1356).
 * Es también un módulo: `backfillAsistencias(sql, dir, opciones)` lo usa worker/pruebas/contrato_local.js con PGlite.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OBRA_ID, cargarTablas, correrCli, idDeFila } from './backfill_lib.js';

export { OBRA_ID };

// CodigoAsistencias.gs: L84 ASISTENCIA_HEADERS · L72 PERSONAL_HEADERS · L118 EXTRAS_ADMIN_HEADERS · L122 NOTAS_ASISTENCIA_HEADERS ·
// L80 CUADRILLAS · L86 CONFIG · L87 FESTIVOS · L113 TURNOS · L91 CAT_CC · L107 CC_USADOS · L94 CAT_MOTIVOS · L99 MOTIVOS_USADOS ·
// L88 CAT_TRABAJADORES · L319 LOG_HEADERS
export const ASISTENCIA_COLS = ['id_registro','timestamp','fecha','reporta','cuadrilla','codigo','cedula','nombre','cargo','cc','proyecto','hora_entrada','hora_salida','presente','motivo_ausencia','observacion','turno'];
export const PERSONAL_COLS   = ['cedula','codigo','nombre','cargo','cuadrilla','responsable','estado','fecha_retiro','fecha_ingreso'];
const EXTRAS_COLS  = ['fecha','cc','proyecto','horas','tipo','timestamp','reporta'];
const NOTAS_COLS   = ['fecha','cuadrilla','reporta','nota','timestamp'];
const TURNOS_COLS  = ['turno','tipo_dia','entrada','salida','descanso_ini','descanso_fin','cruza_medianoche'];
const LOG_COLS     = ['fecha_hora','usuario','rol','action','resultado','motivo','ms'];
export const TIPOS_EXTRA = ['diurna', 'nocturna', 'domfest'];   // CHECK de extras_admin.tipo (001_esquema.sql L406)

const ordenFila = (f, i) => { f.orden = i + 1; };

export const TABLAS_ASISTENCIAS = [
  { tabla:'asistencia',       csv:'ASISTENCIA.csv',       cols:ASISTENCIA_COLS, clave:['id_registro'], modo:'anexar', requiere:['fecha'],
    ajustar: (f, i) => { if (!f.presente) f.presente = 'Si'; if (!f.id_registro) f.id_registro = idDeFila(f, 'ASISTENCIA.csv', i); } },
  { tabla:'personal',         csv:'PERSONAL.csv',         cols:PERSONAL_COLS.concat(['fila_sheet']), clave:null, modo:'reescribir_si_vacia', requiere:['nombre'],
    preexistentes:['cedula','codigo','nombre','fecha_ingreso','fecha_retiro'], ajustar: (f, i) => { f.fila_sheet = i + 2; } },
  { tabla:'extras_admin',     csv:'EXTRAS_ADMIN.csv',     cols:EXTRAS_COLS, clave:['fecha'], modo:'anexar', requiere:['fecha','horas','tipo'],
    ajustar: (f) => { f.tipo = String(f.tipo).trim().toLowerCase(); if (f.tipo && TIPOS_EXTRA.indexOf(f.tipo) < 0) throw new Error('tipo de extra «' + f.tipo + '» no es diurna|nocturna|domfest'); if (!f.reporta) f.reporta = 'admin'; } },
  { tabla:'notas_asistencia', csv:'NOTAS_ASISTENCIA.csv', cols:NOTAS_COLS, clave:['fecha','cuadrilla'], modo:'anexar', requiere:['fecha','cuadrilla'] },
  // catálogos (reescribir)
  { tabla:'cuadrillas',       csv:'CUADRILLAS.csv',       cols:['cuadrilla','responsables','area','estado'], clave:['cuadrilla'], modo:'reescribir', requiere:['cuadrilla'] },
  { tabla:'config',           csv:'CONFIG.csv',           cols:['clave','valor'], clave:['clave'], modo:'reescribir', requiere:['clave'] },
  { tabla:'festivos',         csv:'FESTIVOS.csv',         cols:['fecha'], clave:['fecha'], modo:'reescribir', requiere:['fecha'] },
  { tabla:'turnos',           csv:'TURNOS.csv',           cols:TURNOS_COLS, clave:['turno','tipo_dia'], modo:'reescribir', requiere:['turno','tipo_dia'] },
  { tabla:'cat_cc',           csv:'CAT_CC.csv',           cols:['string_cc','orden'], clave:['string_cc'], modo:'reescribir', requiere:['string_cc'], ajustar: ordenFila },
  { tabla:'cc_usados',        csv:'CC_USADOS.csv',        cols:['string_cc','area','orden'], clave:['string_cc','area'], modo:'reescribir', requiere:['string_cc'], ajustar: ordenFila },
  { tabla:'cat_motivos',      csv:'CAT_MOTIVOS.csv',      cols:['string_motivo','orden'], clave:['string_motivo'], modo:'reescribir', requiere:['string_motivo'], ajustar: ordenFila },
  { tabla:'motivos_usados',   csv:'MOTIVOS_USADOS.csv',   cols:['string_motivo','orden'], clave:['string_motivo'], modo:'reescribir', requiere:['string_motivo'], ajustar: ordenFila },
  { tabla:'cat_trabajadores', csv:'CAT_TRABAJADORES.csv', cols:['codigo','string_navision'], clave:['codigo'], modo:'reescribir', requiere:['codigo'] },
  { tabla:'log',              csv:'LOG.csv',              cols:LOG_COLS, fijos:{ modulo:'asistencias' }, clave:null, modo:'anexar', requiere:['fecha_hora'] }
];
export const ORDEN_TABLAS = TABLAS_ASISTENCIAS.map(t => t.tabla);
const SOLO_EXPLICITO = ['log'];

export async function backfillAsistencias(sql, dir, opciones){
  return cargarTablas(sql, TABLAS_ASISTENCIAS, dir, opciones || {}, SOLO_EXPLICITO);
}

/* ---------- CLI ---------- */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  correrCli('Backfill de asistencias (Fase 3)', 'C:\\Galca\\volcado\\2026-09-16_0100_asistencias', backfillAsistencias)
    .catch(err => { console.error('El backfill falló: ' + (err && err.stack || err)); process.exit(1); });
