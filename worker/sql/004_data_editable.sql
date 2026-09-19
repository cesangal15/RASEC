-- =====================================================================================================
-- TM2 Sur · 4.01 — 004_data_editable.sql · edicion de la hoja DATA desde la app (V3-08b / D181, sep-2026).
-- Se aplica DESPUES de 003_grilla.sql. Idempotente. Probado en PGlite y pensado para Postgres 16 (Supabase).
--
-- Habilita la PANTALLA DE REVISION DE DATA (el jefe/residente corrige o anade filas del reporte diario al
-- cierre, viendo la hoja DATA como en el Excel): la fuente unica de edicion (D181) tambien cubre DATA.
--
--   #1 data.version      — control optimista por fila (if_version), como en base_elementos (003).
--   #2 data.editado_por  — usuario que hizo la ultima correccion desde la grilla (auditoria).
--   #3 data.editado_ts   — cuando.
--   #4 tabla `periodos`  — las ACTAS del proyecto (col S:U de la hoja BASE): acta + [fecha_inicial,
--                          fecha_final]. Es de donde sale la columna ACTA por la FECHA (hoy el Excel lo
--                          hace con LOOKUP; la BD no la tenia). Se siembran las 17 actas conocidas; editable.
-- =====================================================================================================

BEGIN;

ALTER TABLE data ADD COLUMN IF NOT EXISTS version     integer     NOT NULL DEFAULT 0;
ALTER TABLE data ADD COLUMN IF NOT EXISTS editado_por text        NOT NULL DEFAULT '';
ALTER TABLE data ADD COLUMN IF NOT EXISTS editado_ts  timestamptz;
COMMENT ON COLUMN data.version     IS 'control optimista por fila (V3-08b/D181): la grilla de DATA escribe con AND version=${if_version} y hace version+1';
COMMENT ON COLUMN data.editado_por IS 'usuario que corrigio la fila desde la grilla de DATA (auditoria)';
COMMENT ON COLUMN data.editado_ts  IS 'timestamp de la ultima correccion desde la grilla de DATA';

-- Tabla de ACTAS/periodos (col S:U de la hoja BASE). La ACTA de una fila de DATA = el periodo cuyo
-- [fecha_inicial, fecha_final] contiene su FECHA. Periodos del dia 16 al 15 (Codigo.gs D32).
CREATE TABLE IF NOT EXISTS periodos (
  obra_id       text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  acta          text NOT NULL,
  fecha_inicial date NOT NULL,
  fecha_final   date NOT NULL,
  importado_ts  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (obra_id, acta)
);
COMMENT ON TABLE periodos IS 'ACTAS del proyecto (hoja BASE S:U): acta + [fecha_inicial, fecha_final] (16 al 15). ACTA de DATA = el periodo que contiene la FECHA';

INSERT INTO periodos (obra_id, acta, fecha_inicial, fecha_final) VALUES
  ('tm2sur','10','2025-07-16','2025-08-15'),
  ('tm2sur','11','2025-08-16','2025-09-15'),
  ('tm2sur','12','2025-09-16','2025-10-15'),
  ('tm2sur','13','2025-10-16','2025-11-15'),
  ('tm2sur','14','2025-11-16','2025-12-15'),
  ('tm2sur','15','2025-12-16','2026-01-15'),
  ('tm2sur','16','2026-01-16','2026-02-15'),
  ('tm2sur','17','2026-02-16','2026-03-15'),
  ('tm2sur','18','2026-03-16','2026-04-15'),
  ('tm2sur','19','2026-04-16','2026-05-15'),
  ('tm2sur','20','2026-05-16','2026-06-15'),
  ('tm2sur','21','2026-06-16','2026-07-15'),
  ('tm2sur','22','2026-07-16','2026-08-15'),
  ('tm2sur','23','2026-08-16','2026-09-15'),
  ('tm2sur','24','2026-09-16','2026-10-15'),
  ('tm2sur','25','2026-10-16','2026-11-15'),
  ('tm2sur','26','2026-11-16','2026-12-15')
  ON CONFLICT (obra_id, acta) DO NOTHING;

INSERT INTO esquema_version (version, nota)
  VALUES (4, '004_data_editable.sql · V3-08b/D181: data.version/editado_por/editado_ts + tabla periodos (actas)')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
