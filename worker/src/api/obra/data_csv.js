/**
 * api/obra/data_csv.js — la DATA de Galca (y la Proyección) en CSV para el Excel maestro por Power Query «Desde la Web»
 * (D187, 19-sep-2026).
 *
 *   GET /obra?action=data_csv&clave=<CLAVE>                                   → la vista data_maestro (17 columnas)
 *   GET /obra?action=proyeccion_csv&tabla=plan|contrato|rendimiento|parametros&clave=<CLAVE>
 *                                                                             → la vista proyeccion_<tabla>_maestro
 *   (y lo mismo bajo /prueba/obra)
 *
 * Por qué (D187): el conector PostgreSQL de Power Query exige instalar Npgsql con permisos de ADMINISTRADOR y el Excel
 * maestro lo abren varias personas que no los tienen. Web.Contents + Csv.Document es nativo en el Excel de escritorio:
 * no instala nada. La puerta es una CLAVE DE LECTURA compartida (secreto del Worker CLAVE_LECTURA_EXCEL; en /prueba
 * CLAVE_LECTURA_EXCEL_PRUEBA con respaldo a la de producción) que va escrita en la consulta M del Excel. Solo lee.
 *
 * La puerta, la caché de 60 s y las respuestas de error en TEXTO PLANO (para que Excel las enseñe) las pone
 * src/index.js (servirCsv), ANTES del filtro de token. Aquí solo: qué vista y qué columnas se leen, en qué orden, y
 * cómo se escribe el CSV (RFC 4180). No se duplica la lógica de las vistas: se leen tal cual, filtradas por obra.
 *
 * Formato (lo que la consulta M de docs/OPERACIONES.md §14 espera):
 *   · UTF-8 con BOM, separador coma, fin de línea CRLF, cabecera = los nombres EXACTOS de las columnas de la vista.
 *   · Celda entre comillas dobles solo si lleva coma, comilla, CR o LF; la comilla se dobla (""). Los saltos de línea
 *     de una OBSERVACION viajan DENTRO de las comillas (RFC 4180: Csv.Document con QuoteStyle.Csv los respeta).
 *   · Números con PUNTO decimal y sin separador de miles (nunca notación científica). Fechas 'YYYY-MM-DD'. NULL = vacía.
 */
import { OBRA_ID } from '../../comun.js';

// Las 17 columnas de data_maestro (005_data_clima.sql), en su orden exacto. Las internas (id_registro, timestamp,
// capataz…) NO viajan: solo se usan para ordenar de forma estable.
export const CSV_COLUMNAS_DATA = ['FECHA', 'GRUPO', 'CENTRO DE COSTO', 'CAPITULO', 'DESCRIPCION', 'UNIDAD FUNCIONAL',
  'ELEMENTO', 'ABS INICIAL', 'ABS FINAL', 'ACTA', 'UNIDAD MEDIDA', 'LARGO', 'ESPESOR', 'FC', 'CANTIDAD', 'CLIMA', 'OBSERVACION'];

// Las vistas espejo de la Proyección (006_proyeccion.sql), sin obra_id. Orden: el de la propia vista (contrato y
// rendimiento lo traen en su ORDER BY; plan por periodo; parámetros es una fila).
export const CSV_TABLAS_PROYECCION = {
  plan:        { vista: 'proyeccion_plan_maestro',        columnas: ['periodo', 'EXCAVACION', 'TERRAPLEN', 'SUBBASE', 'BASE', 'NO APROV', 'ACTA'], orden: 'periodo' },
  contrato:    { vista: 'proyeccion_contrato_maestro',    columnas: ['PARTIDA', 'Programado UF1', 'Programado UF2', 'Programado', 'Produccion UF1', 'Produccion UF2', 'Produccion'], orden: '' },
  rendimiento: { vista: 'proyeccion_rendimiento_maestro', columnas: ['concepto', 'EXCAVACION', 'TERRAPLEN', 'SUBBASE', 'BASE'], orden: '' },
  parametros:  { vista: 'proyeccion_parametros_maestro',  columnas: ['FC', 'ACTA BASE', 'CORTE BASE'], orden: '' }
};
export const CSV_TABLAS = Object.keys(CSV_TABLAS_PROYECCION);

// D166: parámetros de la petición (se validan ANTES de tocar la BD; la clave se compara aparte, en index.js).
export const VAL_CSV = { clave: ['t', 200], tabla: ['l', CSV_TABLAS] };

const q = (col) => '"' + String(col).replace(/"/g, '""') + '"';

// Número → texto con punto decimal, sin miles ni exponente.
export function csvNumero(n){
  if (!isFinite(n)) return '';
  let s = String(n);
  if (/e/i.test(s)) s = n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
  return s === '-0' ? '0' : s;
}
// Un valor → celda CSV (RFC 4180).
export function csvCelda(v){
  if (v === null || v === undefined) return '';
  let s;
  if (typeof v === 'number') s = csvNumero(v);
  else if (typeof v === 'boolean') s = v ? 'true' : 'false';
  else if (v instanceof Date) s = isNaN(v.getTime()) ? '' : v.toISOString();
  else s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
// Filas (objetos) → texto CSV completo con BOM y cabecera.
export function csvTexto(columnas, filas){
  const out = ['﻿' + columnas.map(csvCelda).join(',')];
  for (const f of filas) out.push(columnas.map(k => csvCelda(f[k])).join(','));
  return out.join('\r\n') + '\r\n';
}

// SELECT de la vista con las columnas pedidas, solo de esta obra.
async function leerVista(c, vista, columnas, orden){
  return c.sql.unsafe('SELECT ' + columnas.map(q).join(', ') + ' FROM ' + vista + ' WHERE obra_id = $1'
    + (orden ? ' ORDER BY ' + orden : ''), [OBRA_ID]);
}

/* La DATA (data_maestro): por FECHA y, dentro del día, por hora de registro y id (orden estable). */
export async function dataCsv(c){
  const filas = await c.sql.unsafe('SELECT ' + CSV_COLUMNAS_DATA.map(q).join(', ') + ' FROM data_maestro WHERE obra_id = $1'
    + ' ORDER BY "FECHA", "timestamp" NULLS LAST, id_registro', [OBRA_ID]);
  return csvTexto(CSV_COLUMNAS_DATA, filas);
}

/* Una tabla de la Proyección (tabla ya validada contra CSV_TABLAS). */
export async function proyeccionCsv(c, tabla){
  const t = CSV_TABLAS_PROYECCION[tabla];
  return csvTexto(t.columnas, await leerVista(c, t.vista, t.columnas, t.orden));
}
