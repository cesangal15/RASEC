#!/usr/bin/env node
/**
 * backfill_parte.js — carga en Postgres el volcado CSV del Sheet de obra para la Fase 2 (Parte Digital, D180).
 *
 *   node worker/sql/backfill_parte.js --volcado="C:\Galca\volcado\2026-09-16_0027_obra"
 *   node worker/sql/backfill_parte.js --volcado=… --solo=parte_bandeja,parte_cc     # solo esas tablas
 *   node worker/sql/backfill_parte.js --volcado=… --simular                           # cuenta, no escribe
 *
 * Conexión: variable de entorno DATABASE_URL (la cadena de conexión de Supabase, con la contraseña).
 * NUNCA va en un archivo del repo: se pone en la terminal justo antes de correr
 *   PowerShell:  $env:DATABASE_URL = "postgres://…";  node worker/sql/backfill_parte.js --volcado=…
 * (o `--conexion-archivo=<ruta fuera del repo>` con la cadena en su primera línea).
 *
 * Qué carga (CSV → tabla), y cómo:
 *   PARTE_BANDEJA     → parte_bandeja      INSERT … ON CONFLICT (obra_id, id_registro) DO NOTHING: nunca pisa lo que
 *                                          ya está en la BD (si el Worker ya recibió partes, se conservan).
 *   PARTE_EQUIPOS     → parte_equipos      ┐
 *   PARTE_OPERADORES  → parte_operadores   │ catálogos (§7.7): se REESCRIBEN (DELETE por obra + INSERT). Desde 4.01
 *   PARTE_CC          → parte_cc           │ se editan en Supabase (Table Editor), no en el Sheet: el backfill es la
 *   PARTE_ITEMS       → parte_items        │ carga inicial. Los valores van CRUDOS (un ítem «2.1» convertido por
 *   PARTE_ACTIVIDADES → parte_actividades  ┘ Sheets se guarda así; parteNormItem_/parteNormCC_ lo normalizan al leer, D178).
 *   MAQUINAS          → maquinas           estancias de la flota (D173: qué equipos espera el Parte). Reescritura.
 *   BASE              → base_items         tabla de ítems A–H de la hoja BASE (CC → DESCRIPCIÓN, D68), para
 *                                          parteDescBase_. Reescritura. Solo las 4 columnas de la Fase 2; backfill_obra.js
 *                                          (Fase 4) la vuelve a cargar con las de 002 (capitulo, grupo, uf, proyecto,
 *                                          orden_hoja) y con la tabla de elementos J–M (base_elementos).
 * Todo dentro de UNA transacción por tabla. Fechas 'yyyy-MM-dd' tal cual; timestamps del volcado son hora de
 * Bogotá sin zona → se cargan como '<ts>-05:00'. Vacío = NULL en fecha/número, '' en texto (regla 3 del esquema).
 * La mecánica (convertir, cargarTabla, CLI) vive en backfill_lib.js, compartida con backfill_obra.js y
 * backfill_asistencias.js; este archivo solo define QUÉ tablas y cómo.
 *
 * Es también un módulo: `backfillParte(sql, dir, opciones)` lo usa worker/pruebas/contrato_local.js con PGlite.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OBRA_ID, cargarTablas, correrCli, filasBaseItems } from './backfill_lib.js';

export { OBRA_ID, filasBaseItems };

// Columnas de cada tabla (las de la hoja; el esquema las llama igual). `clave` = columnas de la PK para deduplicar.
// Los tipos por columna salen de TIPOS_TABLA (backfill_lib.js).
export const TABLAS_PARTE = [
  { tabla:'parte_bandeja',     csv:'PARTE_BANDEJA.csv',     cols:['id_registro','timestamp','estado','fecha','codigo','tipo','placa','medidor','reporte_num','inicial','final','total','inicial_modificado','horas_varada','horas_lluvia','hora_de','hora_a','descripcion_trabajo','centro_coste','pr','uf','operador','observaciones','alertas','revisado_por','revisado_ts','origen'], clave:['id_registro'], modo:'anexar', requiere:['id_registro','fecha','codigo'] },
  { tabla:'parte_equipos',     csv:'PARTE_EQUIPOS.csv',     cols:['codigo','tipo','placa','proveedor','medidor','ultima_fecha','ultimo_final','activo','ultimo_final_manual'], clave:['codigo'], modo:'reescribir', requiere:['codigo'] },
  { tabla:'parte_operadores',  csv:'PARTE_OPERADORES.csv',  cols:['operador','partes_ult_4_meses','activo'], clave:['operador'], modo:'reescribir', requiere:['operador'] },
  { tabla:'parte_cc',          csv:'PARTE_CC.csv',          cols:['centro_coste','proyecto','descripcion_cc','usos_ult_4_meses','activo'], clave:['centro_coste'], modo:'reescribir', requiere:['centro_coste'] },
  { tabla:'parte_items',       csv:'PARTE_ITEMS.csv',       cols:['tipo_equipo','item','actividad','veces','activo'], clave:['tipo_equipo','item','actividad'], modo:'reescribir', requiere:['tipo_equipo','item'] },
  { tabla:'parte_actividades', csv:'PARTE_ACTIVIDADES.csv', cols:['tipo_equipo','descripcion_trabajo','veces'], clave:['tipo_equipo','descripcion_trabajo'], modo:'reescribir', requiere:['tipo_equipo','descripcion_trabajo'] },
  { tabla:'maquinas',          csv:'MAQUINAS.csv',          cols:['id_maquina','tipo','horas_prog','propiedad','fecha_ingreso','fecha_retiro','notas','frente'], clave:['id_maquina','fecha_ingreso'], modo:'reescribir', requiere:['id_maquina','fecha_ingreso'] },
  // BASE: solo la tabla de ítems A–H, con las 4 columnas de la Fase 2 (las demás las pone backfill_obra.js).
  { tabla:'base_items',        csv:'BASE.csv',              cols:['cc','descripcion','unidad','orden'], clave:['cc','descripcion'], modo:'reescribir', filas: (texto) => filasBaseItems(texto) }
];
export const ORDEN_TABLAS = TABLAS_PARTE.map(t => t.tabla);

export async function backfillParte(sql, dir, opciones){
  return cargarTablas(sql, TABLAS_PARTE, dir, opciones || {});
}

/* ---------- CLI ---------- */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  correrCli('Backfill del Parte', 'C:\\Galca\\volcado\\2026-09-16_0027_obra', backfillParte)
    .catch(err => { console.error('El backfill falló: ' + (err && err.stack || err)); process.exit(1); });
