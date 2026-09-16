/**
 * pglite.js — Postgres EN MEMORIA (PGlite, WASM) con la misma superficie que usa src/db.js de postgres.js:
 *   sql`SELECT … ${v}`  →  Promise<filas[]>        sql.unsafe(texto, params)  →  Promise<filas[]>
 *   sql.begin(async tx => …)  (transacción real)      sql.end()
 * Solo para el banco de pruebas (worker/pruebas/): permite correr el esquema 001, el backfill y el arnés de
 * contrato sin Docker ni red. Tipos igual que db.js: date → texto 'yyyy-MM-dd', numeric → Number.
 */
import { PGlite } from '@electric-sql/pglite';

const OID_DATE = 1082, OID_NUMERIC = 1700;

export async function abrirPglite(){
  const pg = new PGlite({ parsers: { [OID_DATE]: (v) => v, [OID_NUMERIC]: (v) => Number(v) } });
  await pg.waitReady;
  return { pg, sql: adaptar(pg) };
}

function adaptar(pg){
  const sql = async function(strings, ...vals){
    let texto = strings[0];
    for (let i = 0; i < vals.length; i++) texto += '$' + (i + 1) + strings[i + 1];
    const r = await pg.query(texto, vals.map(serializar));
    return r.rows;
  };
  sql.unsafe = async (texto, params) => (await pg.query(texto, (params || []).map(serializar))).rows;
  sql.begin = (fn) => pg.transaction((tx) => fn(adaptar(tx)));
  sql.end = async () => {};
  sql.exec = (texto) => pg.exec(texto);
  return sql;
}
// PGlite serializa Date como timestamp SIN zona en hora local: se manda ISO explícito (UTC) para que
// timestamptz lo entienda igual que postgres.js.
function serializar(v){ return (v instanceof Date) ? v.toISOString() : v; }
