-- =====================================================================================================
-- TM2 Sur · 4.01 — 002_fases_3_4.sql · ajustes del esquema para las Fases 3 (asistencias) y 4 (obra)
-- de la migración (D180, sep-2026). Se aplica DESPUÉS de 001_esquema.sql y ANTES de los backfills
-- worker/sql/backfill_obra.js y backfill_asistencias.js. Idempotente: cada ALTER comprueba el catálogo
-- (pg_index / information_schema) antes de tocar nada; correrlo dos veces no cambia nada ni falla.
-- Probado en PGlite (worker/pruebas) y pensado para Postgres 16 (Supabase).
--
-- Lo que corrige (comparación hoja ↔ tabla con el volcado 2026-09-16_0027_obra):
--   #1 volquetas: la PK (obra_id, id_registro) NO se cumple. `id_registro` es el id de la LÍNEA
--      origen→destino del reporte de la chequeadora y lo comparten todas sus placas (Codigo.gs L1183:
--      «las placas de la línea comparten id»; L1195 volRows.push([idV, …])): 379 ids para 1962 filas.
--      Pasa a PK surrogate `volqueta_id bigserial` + índice (obra_id, id_registro). El Worker deduplica
--      por LÍNEA con SELECT EXISTS (id_registro, fecha) —equivalente a idsExistentes L1138—, no con
--      ON CONFLICT.
--   #2 base_elementos: 10 claves (elemento, abs_inicio, abs_fin) repetidas (marcadores ODT) y falta la
--      columna `uf` (col M de la hoja BASE). PK → (obra_id, orden) con `orden` = nº de fila de la hoja,
--      así una fila = un elemento, como getBaseData L746, y la tabla reproduce la hoja para editarla.
--   #3 base_items: columnas de la hoja que faltaban (CAPÍTULOS B, GRUPO C, ORDEN E, UF G, PROYECTO H)
--      para poder editar el catálogo en el Table Editor de Supabase (decisión del dueño: los catálogos
--      ya no se editan en el Sheet; no hay pull Sheet→BD).
--   #6 data.area: nunca vacía desde 4.01. El backfill la deriva del CC (deriveArea, Codigo.gs L2211)
--      en las 239 filas viejas y enviarData escribe siempre el área explícita, así el DELETE de
--      enviarData es exacto por (obra_id, fecha, area) sin replicar areaDeFila en SQL.
--   #7 comentarios que no coincidían con los valores reales (sin efecto en los datos).
-- =====================================================================================================

BEGIN;

-- ---------------------------------------------------------------------------------------------------
-- #1 · volquetas — PK surrogate
-- ---------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'volquetas' AND column_name = 'volqueta_id') THEN
    ALTER TABLE volquetas DROP CONSTRAINT IF EXISTS volquetas_pkey;
    ALTER TABLE volquetas ADD COLUMN volqueta_id bigserial;
    ALTER TABLE volquetas ADD PRIMARY KEY (obra_id, volqueta_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS volquetas_id_registro_idx ON volquetas (obra_id, id_registro);
COMMENT ON COLUMN volquetas.id_registro     IS 'id de la LÍNEA origen→destino del reporte de la chequeadora; lo comparten todas sus placas (D82: dedupe por línea + fecha, no por fila)';
COMMENT ON COLUMN volquetas.volqueta_id     IS 'clave técnica de la fila (una por placa de la línea); 002';
COMMENT ON COLUMN volquetas.cubicaje_origen IS 'catalogo | default | '''' (de dónde salió el m³/viaje: CUBICAJE, el factor del reporte, o fila anterior a D53)';

-- ---------------------------------------------------------------------------------------------------
-- #2 · base_elementos — columna uf + PK (obra_id, orden)
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE base_elementos ADD COLUMN IF NOT EXISTS uf text NOT NULL DEFAULT '';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index i
                 JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
                 WHERE i.indrelid = 'base_elementos'::regclass AND i.indisprimary AND a.attname = 'orden') THEN
    ALTER TABLE base_elementos DROP CONSTRAINT IF EXISTS base_elementos_pkey;
    ALTER TABLE base_elementos ADD PRIMARY KEY (obra_id, orden);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS base_elementos_elem_idx ON base_elementos (obra_id, elemento);
COMMENT ON COLUMN base_elementos.orden IS 'nº de fila de la hoja BASE (una fila = un elemento, como getBaseData L746); es la PK desde 002';
COMMENT ON COLUMN base_elementos.uf    IS 'M · UF (UF1 | UF2)';
COMMENT ON COLUMN base_elementos.tipo  IS 'baseTipo(elemento): TRAMO | DIVISO | MSR | RCD | ZODME | ODT | '''' (fuera de alcance; el Worker descarta '''' al leer)';

-- ---------------------------------------------------------------------------------------------------
-- #3 · base_items — columnas de la hoja para editar el catálogo en Supabase
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE base_items ADD COLUMN IF NOT EXISTS capitulo   text NOT NULL DEFAULT '';
ALTER TABLE base_items ADD COLUMN IF NOT EXISTS grupo      text NOT NULL DEFAULT '';
ALTER TABLE base_items ADD COLUMN IF NOT EXISTS uf         text NOT NULL DEFAULT '';
ALTER TABLE base_items ADD COLUMN IF NOT EXISTS proyecto   text NOT NULL DEFAULT '';
ALTER TABLE base_items ADD COLUMN IF NOT EXISTS orden_hoja numeric;
COMMENT ON COLUMN base_items.capitulo   IS 'B · CAPÍTULOS';
COMMENT ON COLUMN base_items.grupo      IS 'C · GRUPO';
COMMENT ON COLUMN base_items.orden_hoja IS 'E · ORDEN (el de la hoja; `orden` es el nº de fila del CSV)';
COMMENT ON COLUMN base_items.uf         IS 'G · UF';
COMMENT ON COLUMN base_items.proyecto   IS 'H · PROYECTO';

-- ---------------------------------------------------------------------------------------------------
-- #6 · data.area nunca vacía desde 4.01
-- ---------------------------------------------------------------------------------------------------
COMMENT ON COLUMN data.area IS 'tierras | odt | odl; nunca vacío desde 4.01 (el backfill lo deriva del CC para las filas viejas, D71); enviarData borra por (obra_id, fecha, area) o por id_registro';

-- ---------------------------------------------------------------------------------------------------
-- #7 · comentarios alineados con los valores reales (Codigo.gs L1232/L2517, CodigoAsistencias.gs L1307/L2437)
-- ---------------------------------------------------------------------------------------------------
COMMENT ON COLUMN bandeja.estado  IS 'pendiente | no_data | incluido | descartado (lo que escriben guardarReporte L1232 y enviarData L2517)';
COMMENT ON COLUMN personal.estado IS 'activo | inactivo | eventual | '''' (gestionPersonal L2437, esEventual L1307)';

-- ---------------------------------------------------------------------------------------------------
-- Catálogos: desde 4.01 se editan en Supabase (Table Editor), no en el Sheet; no hay pull Sheet→BD.
-- `importado_ts` pasa a significar «última carga por backfill» (no se renombra para no tocar parte.js).
-- ---------------------------------------------------------------------------------------------------
COMMENT ON TABLE cubicaje       IS 'placa → m³/viaje. Se edita en Supabase (4.01); placa guardada normalizada (normPlaca: alfanumérica, MAYÚSCULAS, últimos 6)';
COMMENT ON TABLE base_items     IS 'tabla de ítems A–H de la hoja BASE. Se edita en Supabase (4.01)';
COMMENT ON TABLE base_elementos IS 'tabla de elementos J–M de la hoja BASE. Se edita en Supabase (4.01)';
COMMENT ON TABLE usuarios       IS 'login (D108). Se edita en Supabase (4.01): clave en claro o SHA-256 hex de usuario:clave; el Worker acepta las dos';

INSERT INTO esquema_version (version, nota)
  VALUES (2, '002_fases_3_4.sql · Fases 3-4 de 4.01 (D180): volquetas surrogate, base_elementos (orden, uf), base_items cols de hoja, data.area, comentarios')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
