-- =====================================================================================================
-- TM2 Sur · 4.01 — 003_grilla.sql · soporte de la GRILLA EDITABLE de catálogos fundacionales
-- (V3-08 / D181, sep-2026). Se aplica DESPUÉS de 002_fases_3_4.sql y ANTES de los backfills.
-- Idempotente: cada ALTER usa ADD COLUMN IF NOT EXISTS; correrlo dos veces no cambia nada ni falla.
-- Probado en PGlite (worker/pruebas) y pensado para Postgres 16 (Supabase).
--
-- Qué habilita (fuente única de edición, D181): que los editores autorizados —incluido el jefe— editen
-- los catálogos fundacionales desde la app con una grilla tipo Excel, con VALIDACIÓN server-side y
-- CONTROL DE VERSIÓN POR FILA (patrón if_version). Empieza por `base_elementos` (subtramos), donde vive
-- el retrabajo (no-solapamiento, cascada, los dos «ajuste a origen»).
--
--   #1 base_elementos.version      — entero, arranca en 0; cada escritura de la grilla hace version+1.
--                                    El UPDATE lleva `AND version=${if_version}`: si 0 filas cambian,
--                                    es que otra persona ya la tocó → conflicto (se recarga esa fila).
--   #2 base_elementos.no_operativo — bandera de los DOS «ajuste a origen» (ajuste origen UF1/UF2), que
--                                    abarcan el corredor completo de su UF y NO son subtramos operativos.
--                                    Se conservan en la lista pero quedan FUERA del cálculo de tope. El
--                                    Worker además los reconoce por nombre (^ajuste origen) como respaldo,
--                                    porque el backfill de la BASE corre DESPUÉS de esta migración y esas
--                                    filas aún no existen cuando corre el UPDATE de conveniencia de abajo.
-- =====================================================================================================

BEGIN;

-- ---------------------------------------------------------------------------------------------------
-- #1 · base_elementos.version — control optimista por fila (if_version)
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE base_elementos ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN base_elementos.version IS 'control optimista por fila (V3-08/D181): la grilla escribe con AND version=${if_version} y hace version+1; 0 filas afectadas = conflicto de edición';

-- ---------------------------------------------------------------------------------------------------
-- #2 · base_elementos.no_operativo — los dos «ajuste a origen», fuera del cálculo de tope
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE base_elementos ADD COLUMN IF NOT EXISTS no_operativo boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN base_elementos.no_operativo IS 'true = ajuste a origen / valor no operativo (abarca el corredor completo de la UF): se conserva en la lista pero se excluye del no-solapamiento y del cálculo de tope. El Worker también lo deduce por nombre (^ajuste origen) por si el backfill aún no cargó la fila';

-- Marca los dos «ajuste a origen» si YA existen en este punto (best-effort: en el orden normal de aplicación
-- el backfill de la BASE corre después, así que esto no casa nada; el Worker los reconoce por nombre igual).
UPDATE base_elementos SET no_operativo = true
  WHERE no_operativo = false AND lower(btrim(elemento)) LIKE 'ajuste origen%';

INSERT INTO esquema_version (version, nota)
  VALUES (3, '003_grilla.sql · V3-08/D181: base_elementos.version (if_version) + base_elementos.no_operativo (ajustes a origen)')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
