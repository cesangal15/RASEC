-- =====================================================================================================
-- TM2 Sur · 013_catalogos_auditoria.sql — auditoría de la pantalla «Catálogos» (SOLO admin), sep-2026
--
-- La pantalla Catálogos (worker/src/api/obra/catalogos_admin.js) deja una fila aquí por CADA cambio que
-- guarda `cat_guardar` (alta | update | baja), dentro de la MISMA transacción que escribe la tabla de
-- destino: si el lote hace rollback (conflicto de versión, error de validación tardío), la auditoría
-- tampoco queda. `antes`/`despues` son jsonb de la fila completa; en `usuarios` la columna `clave`/
-- `clave_nueva` se enmascara con '***' ANTES de guardar (nunca clave en claro ni hash en la auditoría).
--
-- Idempotente (CREATE … IF NOT EXISTS), solo ADITIVA (no toca ninguna tabla existente). RLS habilitado
-- sin políticas, como el resto de tablas (007/008/012): nadie entra por la API REST de Supabase, solo el
-- Worker con la cadena de servicio.
--
-- Vuelta atrás:
--   DROP TABLE catalogo_auditoria;
--   DELETE FROM esquema_version WHERE version=13;
-- =====================================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS catalogo_auditoria (
  id       bigserial PRIMARY KEY,
  obra_id  text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  ts       timestamptz NOT NULL DEFAULT now(),
  usuario  text NOT NULL DEFAULT '',
  tabla    text NOT NULL,
  op       text NOT NULL CHECK (op IN ('alta','update','baja')),
  clave    jsonb NOT NULL DEFAULT '{}'::jsonb,
  antes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  despues  jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS catalogo_auditoria_tabla_ts_idx ON catalogo_auditoria (obra_id, tabla, ts DESC);

COMMENT ON TABLE  catalogo_auditoria IS 'Pantalla Catálogos (solo admin): una fila por cambio de cat_guardar, en la MISMA transacción que la escritura. antes/despues = jsonb de la fila; usuarios enmascara clave/clave_nueva con ***. Vuelta atrás: DROP TABLE catalogo_auditoria';
COMMENT ON COLUMN catalogo_auditoria.tabla IS 'id de CA_TABLAS (catalogos_admin.js), igual al nombre SQL real de la tabla escrita';
COMMENT ON COLUMN catalogo_auditoria.clave IS 'valores de la PK de la fila afectada (obra_id no incluido: siempre el de la fila)';

ALTER TABLE catalogo_auditoria ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON catalogo_auditoria FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON catalogo_auditoria FROM authenticated;
  END IF;
END $$;

INSERT INTO esquema_version (version, nota)
  VALUES (13, '013_catalogos_auditoria.sql · tabla catalogo_auditoria (una fila por cambio de la pantalla Catálogos, solo admin); RLS y REVOKE a anon/authenticated')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
