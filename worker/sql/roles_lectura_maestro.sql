-- =====================================================================================================
-- TM2 Sur · 4.01 — roles_lectura_maestro.sql · rol de SOLO LECTURA para el maestro por conexión viva
-- (V3-09 / D181, sep-2026). NO es una migración de esquema: se aplica A MANO en Supabase (SQL Editor),
-- una sola vez, con permisos de owner. NO lleva prefijo NNN_ a propósito, para que el arnés de contrato
-- (worker/pruebas/contrato_local.js aplica solo worker/sql/0*.sql) NO lo ejecute: CREATE ROLE no tiene
-- sentido en PGlite y rompería el banco.
--
-- Para qué: que Power Query / Power BI / el tablero se conecten a la vista `data_maestro` (el ESPEJO de
-- la hoja DATA; desde D182 / 005_data_clima.sql: FECHA…CANTIDAD, CLIMA del día y OBSERVACION, sin
-- ORDEN/PROYECTO/LIBERACION/Columna1) con un usuario que SOLO puede LEER esa vista — nunca escribir,
-- nunca ver otras tablas. Fuente única de edición (D181): el maestro es consumidor de solo lectura.
-- Desde D183 (V3-11 Fase A, 006_proyeccion.sql) lee también las 4 vistas de la PROYECCIÓN que edita Galca:
-- proyeccion_plan_maestro (CALCULOS A:J), proyeccion_contrato_maestro (MAPEO I7:M16),
-- proyeccion_rendimiento_maestro (CALCULOS O1:T4) y proyeccion_parametros_maestro (FC, acta y corte base).
-- Nunca las tablas proy_* de debajo: la vista corre con los permisos de su dueño.
--
-- Ojo (D182): 005_data_clima.sql RECREA la vista (DROP + CREATE) y con eso se pierde el GRANT; por eso 005
-- lo vuelve a dar si el rol ya existe. Si la vista se recrea a mano o con otra migración, vuelve a correr
-- este archivo (o al menos el GRANT SELECT de abajo). Aplicarlo antes o después de 005 da lo mismo.
-- Igual con D183: 006_proyeccion.sql da el SELECT de sus 4 vistas si el rol YA existe, y este archivo lo da
-- si las vistas YA existen (bloque DO de abajo): aplicarlo antes o después de 006 da lo mismo. REGLA (D183):
-- toda migración futura que recree una vista *_maestro repite su bloque DO de GRANT/REVOKE.
--
-- Pasos:
--   1. En Supabase → SQL Editor, pega este archivo y cambia '<PON-UNA-CLAVE-FUERTE>' por una clave real.
--   2. Ejecuta. (Si el rol ya existe, el bloque DO lo deja como está y solo re-aplica los GRANT.)
--   3. Usa ese usuario/clave en Power Query (OPERACIONES §14). El pooler de Supabase (puerto 6543, o 5432
--      en modo sesión) y el host salen de Supabase → Project Settings → Database.
--   4. Para rotar la clave: ALTER ROLE tm2_lector_maestro PASSWORD '<nueva>';  Para revocar el acceso:
--      REVOKE SELECT ON public.data_maestro FROM tm2_lector_maestro;  (y lo mismo con las 4 vistas
--      proyeccion_*_maestro; o DROP ROLE si nadie lo usa).
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

-- Lo ÚNICO que puede leer: las vistas del maestro. No se le da SELECT sobre `data`, ni sobre las tablas
-- proy_*, ni sobre catálogos.
GRANT SELECT ON public.data_maestro TO tm2_lector_maestro;

-- D183: las 4 vistas de la Proyección (006_proyeccion.sql). Solo si ya existen, para que este archivo se
-- pueda correr antes de 006 sin error (006 da estos mismos GRANT al aplicarse si el rol ya existe).
DO $$
BEGIN
  IF to_regclass('public.proyeccion_plan_maestro') IS NOT NULL AND to_regclass('public.proyeccion_contrato_maestro') IS NOT NULL
     AND to_regclass('public.proyeccion_rendimiento_maestro') IS NOT NULL AND to_regclass('public.proyeccion_parametros_maestro') IS NOT NULL THEN
    GRANT SELECT ON public.proyeccion_plan_maestro        TO tm2_lector_maestro;
    GRANT SELECT ON public.proyeccion_contrato_maestro    TO tm2_lector_maestro;
    GRANT SELECT ON public.proyeccion_rendimiento_maestro TO tm2_lector_maestro;
    GRANT SELECT ON public.proyeccion_parametros_maestro  TO tm2_lector_maestro;
  END IF;
END $$;

-- Cinturón: quita cualquier permiso de escritura heredado y no le des futuros objetos por defecto.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM tm2_lector_maestro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM tm2_lector_maestro;
