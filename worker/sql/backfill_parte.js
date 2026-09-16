#!/usr/bin/env node
/**
 * backfill_parte.js — carga en Postgres el volcado CSV del Sheet de obra para la Fase 2 (Parte Digital, D180).
 *
 *   node worker/sql/backfill_parte.js --volcado="C:\Galca\volcado\2026-09-15_2252_obra"
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
 *   PARTE_OPERADORES  → parte_operadores   │ catálogos que se editan a mano en el Sheet (§7.7): se REESCRIBEN
 *   PARTE_CC          → parte_cc           │ (DELETE por obra + INSERT), igual que hará el trigger de pull.
 *   PARTE_ITEMS       → parte_items        │ Los valores van CRUDOS (un ítem «2.1» convertido por Sheets se guarda
 *   PARTE_ACTIVIDADES → parte_actividades  ┘ así; parteNormItem_/parteNormCC_ lo normalizan al leer, D178).
 *   MAQUINAS          → maquinas           estancias de la flota (D173: qué equipos espera el Parte). Reescritura.
 *   BASE              → base_items         tabla de ítems A–H de la hoja BASE (CC → DESCRIPCIÓN, D68), para
 *                                          parteDescBase_. Reescritura. La tabla de elementos (J/K/L) es de Fase 4.
 * Todo dentro de UNA transacción por tabla. Fechas 'yyyy-MM-dd' tal cual; timestamps del volcado son hora de
 * Bogotá sin zona → se cargan como '<ts>-05:00'. Vacío = NULL en fecha/número, '' en texto (regla 3 del esquema).
 *
 * Es también un módulo: `backfillParte(sql, dir, opciones)` lo usa worker/pruebas/contrato_local.js con PGlite.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, csvObjetos } from './csv.js';

export const OBRA_ID = 'tm2sur';

// Tipos por columna (lo que no está aquí es texto). ts = timestamp Bogotá sin zona.
const TIPOS = {
  parte_bandeja:     { timestamp:'ts', fecha:'date', inicial:'num', final:'num', total:'num', horas_varada:'num', horas_lluvia:'num', pr:'num', revisado_ts:'ts' },
  parte_equipos:     { ultima_fecha:'date', ultimo_final:'num', ultimo_final_manual:'num' },
  parte_operadores:  { partes_ult_4_meses:'num' },
  parte_cc:          { usos_ult_4_meses:'num' },
  parte_items:       { veces:'num' },
  parte_actividades: { veces:'num' },
  maquinas:          { horas_prog:'num', fecha_ingreso:'date', fecha_retiro:'date' }
};
// Columnas de cada tabla (las de la hoja; el esquema las llama igual). `clave` = columnas de la PK para deduplicar.
const TABLAS = {
  parte_bandeja:     { csv:'PARTE_BANDEJA.csv',     cols:['id_registro','timestamp','estado','fecha','codigo','tipo','placa','medidor','reporte_num','inicial','final','total','inicial_modificado','horas_varada','horas_lluvia','hora_de','hora_a','descripcion_trabajo','centro_coste','pr','uf','operador','observaciones','alertas','revisado_por','revisado_ts','origen'], clave:['id_registro'], modo:'anexar', requiere:['id_registro','fecha','codigo'] },
  parte_equipos:     { csv:'PARTE_EQUIPOS.csv',     cols:['codigo','tipo','placa','proveedor','medidor','ultima_fecha','ultimo_final','activo','ultimo_final_manual'], clave:['codigo'], modo:'reescribir', requiere:['codigo'] },
  parte_operadores:  { csv:'PARTE_OPERADORES.csv',  cols:['operador','partes_ult_4_meses','activo'], clave:['operador'], modo:'reescribir', requiere:['operador'] },
  parte_cc:          { csv:'PARTE_CC.csv',          cols:['centro_coste','proyecto','descripcion_cc','usos_ult_4_meses','activo'], clave:['centro_coste'], modo:'reescribir', requiere:['centro_coste'] },
  parte_items:       { csv:'PARTE_ITEMS.csv',       cols:['tipo_equipo','item','actividad','veces','activo'], clave:['tipo_equipo','item','actividad'], modo:'reescribir', requiere:['tipo_equipo','item'] },
  parte_actividades: { csv:'PARTE_ACTIVIDADES.csv', cols:['tipo_equipo','descripcion_trabajo','veces'], clave:['tipo_equipo','descripcion_trabajo'], modo:'reescribir', requiere:['tipo_equipo','descripcion_trabajo'] },
  maquinas:          { csv:'MAQUINAS.csv',          cols:['id_maquina','tipo','horas_prog','propiedad','fecha_ingreso','fecha_retiro','notas','frente'], clave:['id_maquina','fecha_ingreso'], modo:'reescribir', requiere:['id_maquina','fecha_ingreso'] },
  base_items:        { csv:'BASE.csv', especial:'base' }
};
export const ORDEN_TABLAS = Object.keys(TABLAS);

function convertir(tipo, v){
  const s = String(v == null ? '' : v).trim();
  if (tipo === 'date' || tipo === 'num' || tipo === 'ts') { if (s === '') return null; }
  if (tipo === 'num') { const n = Number(s.replace(',', '.')); if (!isFinite(n)) throw new Error('número inválido «' + s + '»'); return n; }
  if (tipo === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('fecha inválida «' + s + '» (se esperaba yyyy-MM-dd, D106)'); return s; }
  if (tipo === 'ts') {
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)) return s.replace(' ', 'T') + '-05:00';   // hora de Bogotá (sin DST)
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;                                                       // ya trae zona
    throw new Error('timestamp inválido «' + s + '»');
  }
  return s;
}
function leer(dir, archivo){ const p = path.join(dir, archivo); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; }
function q(col){ return '"' + col + '"'; }

/* Tabla de ítems de la hoja BASE: misma detección que getBaseData (Codigo.gs L725): la fila de encabezados es
 * la primera (entre las 5 primeras) con CC y DESCRIPCION en A–H; los ítems empiezan en la siguiente. */
function normTexto(s){ return String(s == null ? '' : s).toUpperCase().replace(/[ÁÀÂÄ]/g,'A').replace(/[ÉÈÊË]/g,'E').replace(/[ÍÌÎÏ]/g,'I').replace(/[ÓÒÔÖ]/g,'O').replace(/[ÚÙÛÜ]/g,'U').replace(/Ñ/g,'N').replace(/\s+/g,' ').trim(); }
export function filasBaseItems(texto){
  const { encabezados, filas } = parseCsv(texto);
  const v = [encabezados].concat(filas);
  let ccCol = -1, dCol = -1, uCol = -1, hRow = -1;
  for (let r = 0; r < Math.min(5, v.length) && hRow < 0; r++) {
    let c1 = -1, c2 = -1, c3 = -1;
    for (let j = 0; j < Math.min(8, v[r].length); j++) {
      const k = normTexto(v[r][j]);
      if (c1 < 0 && (k === 'CC' || k.indexOf('CENTRO') >= 0 || k.indexOf('COSTO') >= 0 || k.indexOf('COSTE') >= 0)) c1 = j;
      else if (c2 < 0 && k.indexOf('DESCRIPCION') >= 0) c2 = j;
      else if (c3 < 0 && (k === 'UND' || k === 'UM' || (k.indexOf('UNIDAD') >= 0 && k.indexOf('FUNCIONAL') < 0))) c3 = j;
    }
    if (c1 >= 0 && c2 >= 0) { ccCol = c1; dCol = c2; uCol = c3; hRow = r; }
  }
  const out = [];
  if (ccCol < 0) return out;
  for (let i = hRow + 1; i < v.length; i++) {
    const cc = String(v[i][ccCol] == null ? '' : v[i][ccCol]).trim(), d = v[i][dCol];
    if (!cc || d === '' || d == null) continue;
    out.push({ cc, descripcion: String(d), unidad: uCol >= 0 && v[i][uCol] != null ? String(v[i][uCol]).trim() : '', orden: i });
  }
  return out;
}

/* Carga una tabla. `sql` = cliente postgres.js (o el adaptador PGlite). Devuelve {leidas, insertadas, saltadas, borradas}. */
async function cargarTabla(sql, nombre, dir, op){
  const def = TABLAS[nombre], res = { tabla: nombre, archivo: def.csv, leidas: 0, insertadas: 0, saltadas: 0, borradas: 0, avisos: [] };
  const texto = leer(dir, def.csv);
  if (texto === null) { res.avisos.push('no está ' + def.csv + ': se omite'); return res; }
  let filas, cols, clave;
  if (def.especial === 'base') {
    filas = filasBaseItems(texto); cols = ['cc', 'descripcion', 'unidad', 'orden']; clave = ['cc', 'descripcion'];
  } else {
    const objetos = csvObjetos(texto); cols = def.cols; clave = def.clave;
    const tipos = TIPOS[nombre] || {};
    filas = [];
    objetos.forEach((o, i) => {
      const f = {};
      try { cols.forEach(c => { f[c] = convertir(tipos[c], o[c]); }); }
      catch (e) { res.avisos.push('fila ' + (i + 2) + ' de ' + def.csv + ': ' + e.message + ' → NO se carga'); return; }
      if (def.requiere.some(c => f[c] === null || f[c] === '')) { res.avisos.push('fila ' + (i + 2) + ' de ' + def.csv + ': falta ' + def.requiere.join('/') + ' → NO se carga'); return; }
      filas.push(f);
    });
  }
  res.leidas = filas.length;
  // duplicados por clave dentro del propio CSV: se queda la PRIMERA (la hoja tolera repetidos; la PK no)
  const vistos = new Set(), unicas = [];
  filas.forEach(f => { const k = clave.map(c => String(f[c])).join('|'); if (vistos.has(k)) { res.saltadas++; res.avisos.push('duplicado en el CSV (' + k + '): se queda la primera'); return; } vistos.add(k); unicas.push(f); });
  if (op.simular) { res.insertadas = unicas.length; return res; }
  const modo = def.modo || 'reescribir';
  const colsSql = ['obra_id'].concat(cols).map(q).join(', ');
  await sql.begin(async (tx) => {
    if (modo === 'reescribir') {
      const b = await tx.unsafe('DELETE FROM ' + q(nombre) + ' WHERE obra_id = $1 RETURNING 1', [OBRA_ID]);
      res.borradas = b.length;
    }
    const conflicto = ' ON CONFLICT (' + ['obra_id'].concat(clave).map(q).join(', ') + ') DO NOTHING RETURNING 1';
    for (const f of unicas) {
      const vals = [OBRA_ID].concat(cols.map(c => f[c]));
      const marcas = vals.map((_, i) => '$' + (i + 1)).join(', ');
      const r = await tx.unsafe('INSERT INTO ' + q(nombre) + ' (' + colsSql + ') VALUES (' + marcas + ')' + conflicto, vals);
      if (r.length) res.insertadas++; else res.saltadas++;
    }
  });
  return res;
}

export async function backfillParte(sql, dir, opciones){
  const op = opciones || {};
  const solo = op.solo ? String(op.solo).split(',').map(s => s.trim()).filter(Boolean) : null;
  const out = [];
  for (const nombre of ORDEN_TABLAS) {
    if (solo && solo.indexOf(nombre) < 0) continue;
    out.push(await cargarTabla(sql, nombre, dir, op));
  }
  return out;
}

/* ---------- CLI ---------- */
async function main(){
  const args = {}; process.argv.slice(2).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });
  const dir = args.volcado ? path.resolve(String(args.volcado)) : '';
  if (!dir || !fs.existsSync(dir)) { console.error('Falta --volcado=<carpeta con los CSV del volcado de obra> (p. ej. C:\\Galca\\volcado\\2026-09-15_2252_obra)'); process.exit(2); }
  let cadena = process.env.DATABASE_URL || '';
  if (!cadena && args['conexion-archivo']) cadena = fs.readFileSync(String(args['conexion-archivo']), 'utf8').split(/\r?\n/)[0].trim();
  if (!cadena && !args.simular) { console.error('Falta la conexión: $env:DATABASE_URL = "postgres://…" (o --conexion-archivo=<ruta fuera del repo>). Con --simular no hace falta.'); process.exit(2); }
  let sql = null;
  if (!args.simular) {
    const { default: postgres } = await import('postgres');
    sql = postgres(cadena, { max: 1, prepare: false, onnotice: () => {},
      types: { date: { to: 1082, from: [1082], serialize: v => v, parse: v => v }, numeric: { to: 1700, from: [1700], serialize: v => String(v), parse: v => Number(v) } } });
  }
  console.log('Backfill del Parte · volcado=' + dir + (args.simular ? ' · SIMULACIÓN (no escribe)' : '') + (args.solo ? ' · solo=' + args.solo : ''));
  try {
    const res = await backfillParte(sql, dir, { solo: args.solo, simular: !!args.simular });
    res.forEach(r => {
      console.log('  ' + r.tabla.padEnd(18) + ' ← ' + r.archivo.padEnd(22) + ' leídas ' + String(r.leidas).padStart(5) + ' · insertadas ' + String(r.insertadas).padStart(5) + ' · saltadas ' + String(r.saltadas).padStart(4) + (r.borradas ? ' · borradas antes ' + r.borradas : ''));
      r.avisos.slice(0, 20).forEach(a => console.log('      ! ' + a));
      if (r.avisos.length > 20) console.log('      ! … y ' + (r.avisos.length - 20) + ' avisos más');
    });
  } finally { if (sql) await sql.end({ timeout: 5 }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(err => { console.error('El backfill falló: ' + (err && err.stack || err)); process.exit(1); });
