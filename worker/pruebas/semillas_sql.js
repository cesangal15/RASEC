/**
 * semillas_sql.js — vuelca las hojas de backend/pruebas/contrato/semillas.js (obra y asistencias) a las tablas
 * homónimas de PGlite, para que el banco de contrato_local.js tenga los datos que los casos `vm` asumen:
 * 75781 en personal, cuadrilla ANGEL, EX01/VOL048/MO004 en maquinas, NNM180 en cubicaje, PARTE_* de semilla,
 * y los USUARIOS con clave EN CLARO ('1234', 'clave-angel'…: auth.js acepta claro si no casa /^[0-9a-f]{64}$/).
 *
 *   semillar(sql, semillas(), { simular? })  →  [{tabla, archivo, leidas, insertadas, saltadas, avisos}, …]
 *
 * Cómo: cada hoja HOJA = [[encabezados], [fila], …] va a la tabla `hoja` (minúsculas) POR NOMBRE de encabezado
 * (solo los que sean columna de la tabla; el resto se ignora), con las MISMAS conversiones que los backfills
 * (backfill_lib.js: TIPOS_TABLA → fechas, horas con ftime, números; usuario en minúsculas; placa con normPlaca;
 * orden = fila en cat_cc/cc_usados/cat_motivos/motivos_usados; fila_sheet en personal). La PK se lee del catálogo
 * de la propia BD (pg_index): si está en la hoja → INSERT … ON CONFLICT DO NOTHING, así se puede aplicar ENCIMA
 * del backfill real de obra (lo real manda) o sola; si la PK es surrogate (personal_id) se saltan las filas que
 * ya estén con los mismos valores. Excepción: `usuarios` hace DO UPDATE, porque el arnés se lanza con las
 * credenciales de la semilla (admin/1234, angel/clave-angel…) y el USUARIOS real trae claves hasheadas.
 */
import { TIPOS_TABLA, convertir, cargarFilas, normPlaca, idDeFila } from '../sql/backfill_lib.js';

// Columnas que no están en la hoja pero la tabla espera (las rellena AJUSTES).
const EXTRA_COLS = { personal: ['fila_sheet'], cat_cc: ['orden'], cc_usados: ['orden'], cat_motivos: ['orden'], motivos_usados: ['orden'] };
const ordenFila = (f, i) => { f.orden = i + 1; };
const AJUSTES = {
  usuarios:     (f) => { f.usuario = String(f.usuario == null ? '' : f.usuario).trim().toLowerCase(); },
  cubicaje:     (f) => { f.placa = normPlaca(f.placa); },
  personal:     (f, i) => { f.fila_sheet = i + 2; },
  asistencia:   (f) => { if (!f.presente) f.presente = 'Si'; },
  extras_admin: (f) => { f.tipo = String(f.tipo == null ? '' : f.tipo).trim().toLowerCase(); if (!f.reporta) f.reporta = 'admin'; },
  cat_cc: ordenFila, cc_usados: ordenFila, cat_motivos: ordenFila, motivos_usados: ordenFila
};
const CONFLICTO = { usuarios: 'update' };   // las credenciales del banco son las de la semilla

export async function semillar(sql, semillas, op){
  const out = [];
  for (const modulo of ['obra', 'asistencias']) {
    const hojas = (semillas || {})[modulo] || {};
    for (const hoja of Object.keys(hojas)) {
      const tabla = hoja.toLowerCase(), matriz = hojas[hoja] || [], archivo = modulo + '.' + hoja;
      const res = { tabla, archivo, leidas: 0, insertadas: 0, saltadas: 0, borradas: 0, avisos: [] };
      const columnas = (await sql.unsafe('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1', [tabla])).map(r => r.column_name);
      if (!columnas.length) { res.avisos.push('no hay tabla ' + tabla + ': se omite'); out.push(res); continue; }
      const pk = (await sql.unsafe('SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey) WHERE i.indrelid = $1::regclass AND i.indisprimary', [tabla]))
        .map(r => r.attname).filter(c => c !== 'obra_id');
      const encabezados = (matriz[0] || []).map(h => String(h).trim());
      const cols = encabezados.filter(h => columnas.indexOf(h) >= 0);
      const extra = (EXTRA_COLS[tabla] || []).filter(c => columnas.indexOf(c) >= 0 && cols.indexOf(c) < 0);
      const todas = cols.concat(extra), tipos = TIPOS_TABLA[tabla] || {};
      const pkEnHoja = pk.filter(c => todas.indexOf(c) >= 0), surrogate = pk.some(c => todas.indexOf(c) < 0);
      const filas = [];
      matriz.slice(1).forEach((fila, i) => {
        const f = {};
        try {
          encabezados.forEach((h, j) => { if (cols.indexOf(h) >= 0) f[h] = convertir(tipos[h], fila[j]); });
          extra.forEach(c => { f[c] = null; });
          if (AJUSTES[tabla]) AJUSTES[tabla](f, i);
          // PK: NULL no cabe; '' sí (cc_usados.area '' = tierras), salvo id_registro vacío → uuid determinista
          pkEnHoja.forEach(c => { if (f[c] === null || f[c] === undefined) throw new Error('falta ' + c); if (f[c] === '' && /id_registro$/.test(c)) f[c] = idDeFila(f, archivo, i); });
        } catch (e) { res.avisos.push('fila ' + (i + 2) + ' de ' + archivo + ': ' + e.message + ' → NO se carga'); return; }
        filas.push(f);
      });
      const def = { tabla, csv: archivo, cols: todas, clave: surrogate ? null : pkEnHoja, modo: 'anexar', conflicto: CONFLICTO[tabla], preexistentes: surrogate ? cols : undefined };
      out.push(await cargarFilas(sql, def, filas, op || {}, res));
    }
  }
  return out;
}
