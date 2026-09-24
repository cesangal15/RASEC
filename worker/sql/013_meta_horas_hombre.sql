-- =====================================================================================================
-- TM2 Sur · 013_meta_horas_hombre.sql — meta MENSUAL de horas-hombre de personal DIRECTO por partida
-- (V3-22 / decisión del dueño D210, sep-2026). Se aplica DESPUÉS de 012_unificar_cargos.sql.
--
-- Qué pidió el dueño (D210): comparar las horas-hombre REALES del personal directo (V3-16,
-- `personalDelTablero_` de worker/src/api/obra/tablero_vivo.js — ya excluye INDIRECTOS) contra una
-- META mensual, SOLO por PARTIDA (Excavación · Terraplén · Subbase · Base; ni por cargo ni por
-- Transporte/Otras). La meta se edita en la Proyección (proyeccion.html, tabla del PLAN mensual —
-- worker/src/api/obra/proyeccion.js), junto al plan de m³ del mismo periodo 16→15, y el Tablero
-- (tablero-produccion.js, bloque «Horas del personal») la lee de ?action=tablero_vivo dentro de `proy.plan`.
--
-- 4 columnas nuevas en proy_plan (la MISMA tabla y el mismo periodo del plan de m³, D183/006): NULL =
-- sin meta cargada (el Tablero muestra «—», nada se rompe). Sin CHECK de máximo (como excavacion/
-- terraplen/subbase/base/noaprov de 006): solo ≥ 0, el mismo criterio de esas 4.
--
-- Idempotente: ALTER TABLE … ADD COLUMN IF NOT EXISTS (una 2ª pasada no hace nada). No toca proy_plan_version_seq
-- ni las semillas de 006 (una meta editada queda igual que cualquier otra celda del plan: fuera de esta
-- migración). No extiende las vistas *_maestro (proyeccion_plan_maestro, Power Query): son el espejo LITERAL
-- de las columnas del Excel (CALCULOS A:J) y esta meta es un concepto nuevo que no vive en el Excel.
--
-- Vuelta atrás (borra la meta; el resto del plan queda intacto):
--   BEGIN;
--   ALTER TABLE proy_plan DROP COLUMN IF EXISTS hh_excavacion;
--   ALTER TABLE proy_plan DROP COLUMN IF EXISTS hh_terraplen;
--   ALTER TABLE proy_plan DROP COLUMN IF EXISTS hh_subbase;
--   ALTER TABLE proy_plan DROP COLUMN IF EXISTS hh_base;
--   DELETE FROM esquema_version WHERE version=13;
--   COMMIT;
-- =====================================================================================================

BEGIN;

ALTER TABLE proy_plan ADD COLUMN IF NOT EXISTS hh_excavacion numeric CHECK (hh_excavacion >= 0);
ALTER TABLE proy_plan ADD COLUMN IF NOT EXISTS hh_terraplen  numeric CHECK (hh_terraplen  >= 0);
ALTER TABLE proy_plan ADD COLUMN IF NOT EXISTS hh_subbase    numeric CHECK (hh_subbase    >= 0);
ALTER TABLE proy_plan ADD COLUMN IF NOT EXISTS hh_base       numeric CHECK (hh_base       >= 0);

COMMENT ON COLUMN proy_plan.hh_excavacion IS 'V3-22/D210 · meta MENSUAL de horas-hombre del personal DIRECTO de Excavación (periodo 16→15 de esta fila). NULL = sin meta. La compara el Tablero (personalDelTablero_, V3-16) contra las horas-hombre REALES de asistencia';
COMMENT ON COLUMN proy_plan.hh_terraplen  IS 'V3-22/D210 · meta MENSUAL de horas-hombre del personal DIRECTO de Terraplén (periodo 16→15 de esta fila). NULL = sin meta';
COMMENT ON COLUMN proy_plan.hh_subbase    IS 'V3-22/D210 · meta MENSUAL de horas-hombre del personal DIRECTO de Subbase (periodo 16→15 de esta fila). NULL = sin meta';
COMMENT ON COLUMN proy_plan.hh_base       IS 'V3-22/D210 · meta MENSUAL de horas-hombre del personal DIRECTO de Base (periodo 16→15 de esta fila). NULL = sin meta';

INSERT INTO esquema_version (version, nota)
  VALUES (13, '013_meta_horas_hombre.sql · V3-22/D210: hh_excavacion/hh_terraplen/hh_subbase/hh_base en proy_plan (meta mensual de horas-hombre de personal directo por partida, editable en la Proyección, comparada por el Tablero)')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
