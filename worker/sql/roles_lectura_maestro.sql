-- =====================================================================================================
-- TM2 Sur · 4.01 — roles_lectura_maestro.sql · rol de SOLO LECTURA para el maestro por conexión viva
-- (V3-09 / D181, sep-2026). NO es una migración de esquema: se aplica A MANO en Supabase (SQL Editor),
-- una sola vez, con permisos de owner. NO lleva prefijo NNN_ a propósito, para que el arnés de contrato
-- (worker/pruebas/contrato_local.js aplica solo worker/sql/0*.sql) NO lo ejecute: CREATE ROLE no tiene
-- sentido en PGlite y rompería el banco.
--
-- Para qué: que Power Query / Power BI / el tablero se conecten a la vista `data_maestro` (el ESPEJO de
-- la hoja DATA, encabezados A–T verbatim) con un usuario que SOLO puede LEER esa vista — nunca escribir,
-- nunca ver otras tablas. Fuente única de edición (D181): el maestro es consumidor de solo lectura.
--
-- Pasos:
--   1. En Supabase → SQL Editor, pega este archivo y cambia '<PON-UNA-CLAVE-FUERTE>' por una clave real.
--   2. Ejecuta. (Si el rol ya existe, el bloque DO lo deja como está y solo re-aplica los GRANT.)
--   3. Usa ese usuario/clave en Power Query (OPERACIONES §14). El pooler de Supabase (puerto 6543, o 5432
--      en modo sesión) y el host salen de Supabase → Project Settings → Database.
--   4. Para rotar la clave: ALTER ROLE tm2_lector_maestro PASSWORD '<nueva>';  Para revocar el acceso:
--      REVOKE SELECT ON public.data_maestro FROM tm2_lector_maestro;  (o DROP ROLE si nadie lo usa).
-- =====================================================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm2_lector_maestro') THEN
    CREATE ROLE tm2_lector_maestro LOGIN PASSWORD '<PON-UNA-CLAVE-FUERTE>';
  END IF;
END $$;

-- Puede conectarse y ver el esquema public, pero NADA por defecto (sin este bloque no vería tablas nuevas).
GRANT CONNECT ON DATABASE postgres TO tm2_lector_maestro;   -- ajusta el nombre de la BD si no es 'postgres'
GRANT USAGE   ON SCHEMA public      TO tm2_lector_maestro;

-- Lo ÚNICO que puede leer: la vista del maestro. No se le da SELECT sobre `data` ni sobre catálogos.
GRANT SELECT ON public.data_maestro TO tm2_lector_maestro;

-- Cinturón: quita cualquier permiso de escritura heredado y no le des futuros objetos por defecto.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM tm2_lector_maestro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM tm2_lector_maestro;
