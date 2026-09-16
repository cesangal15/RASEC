/**
 * db.js — capa de datos del backend portado (4.01 · Fase 2 · D180): Postgres (Supabase) por SQL directo
 * con postgres.js, a través de Hyperdrive cuando el binding existe.
 *
 * Es el reemplazo de `hojaFalsa`/`leerRango_`: donde el .gs leía y escribía celdas, el módulo portado
 * ejecuta SQL con el cliente que devuelve `abrirDb`. Reglas (informe §7.2 y §7.5, esquema 001):
 *   · UNA transacción por escritura (`sql.begin`), sin lock global.
 *   · Idempotencia de la cola offline (D82): `INSERT … ON CONFLICT (obra_id, id_registro) DO NOTHING`.
 *   · Un cliente por petición y `sql.end()` al terminar (recomendación de Cloudflare para Hyperdrive:
 *     las conexiones no se comparten entre peticiones; el pool real lo pone Hyperdrive).
 *
 * De dónde sale la conexión (por orden; el primero que exista gana):
 *   1. Binding Hyperdrive (`env.HYPERDRIVE.connectionString`; creado con
 *      `wrangler hyperdrive create galca-tm2sur --connection-string="postgres://…"` y declarado en
 *      wrangler.toml). La cadena con la contraseña vive en Cloudflare, nunca en el repo.
 *   2. Secreto `DATABASE_URL` (`wrangler secret put DATABASE_URL`): conexión directa sin pool. Sirve
 *      para el piloto y para `wrangler dev`; con Hyperdrive la latencia baja y las conexiones se reúsan.
 *   Cada ruta dice qué nombres mirar (index.js: `db:['HYPERDRIVE_PRUEBA','DATABASE_URL_PRUEBA',…]`), así
 *   /prueba/parte puede apuntar a una BD de prueba distinta o, mientras no exista, a la misma.
 *
 * Tipos (regla 3 del esquema): `date` viaja como texto 'yyyy-MM-dd' (nunca Date: evita el corrimiento
 * de zona horaria), `numeric` como Number, `timestamptz` como Date. Todo lo demás, texto.
 *
 * Banco de pruebas: `env.__dbPrueba` (una función que devuelve un cliente con la misma superficie:
 * tagged template, `begin`, `unsafe`, `end`) sustituye a postgres.js. Lo usa worker/pruebas/ con PGlite;
 * Cloudflare nunca lo define.
 */
import postgres from 'postgres';

const OID_DATE = 1082, OID_NUMERIC = 1700;

export function abrirDb(env, nombres){
  if(env && typeof env.__dbPrueba === 'function'){ const sql=env.__dbPrueba(); return { sql, cerrar: () => Promise.resolve(sql.end && sql.end()) }; }
  let cadena='';
  for(const n of (nombres||[])){
    const v=env ? env[n] : null;
    if(!v) continue;
    cadena = (typeof v==='object' && v.connectionString) ? v.connectionString : String(v);
    if(cadena) break;
  }
  if(!cadena) return null;
  const sql = postgres(cadena, {
    max: 2,                     // una petición del Parte hace pocas consultas seguidas; el pool real es Hyperdrive
    prepare: false,             // compatible con Supavisor en modo transacción y con Hyperdrive
    fetch_types: false,         // sin viaje extra a pg_type: solo usamos tipos base
    idle_timeout: 20, connect_timeout: 10,
    types: {
      date:    { to: OID_DATE,    from: [OID_DATE],    serialize: (v) => v, parse: (v) => v },
      numeric: { to: OID_NUMERIC, from: [OID_NUMERIC], serialize: (v) => String(v), parse: (v) => Number(v) }
    },
    onnotice: () => {}
  });
  return { sql, cerrar: () => sql.end({ timeout: 5 }).catch(() => {}) };
}
