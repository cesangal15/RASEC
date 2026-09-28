-- =====================================================================================================
-- TM2 Sur · 015_parte_auditoria.sql — auditoría del Parte Digital de Maquinaria (D223), sep-2026
--
-- Una fila por CADA cambio real de `parte_bandeja` (alta por QR, manual del revisor, aprobar, descartar,
-- editar campos, repartir, borrar), escrita por un TRIGGER sobre la propia tabla: así queda cubierto
-- cualquier camino de escritura, incluso un UPDATE/DELETE hecho a mano por SQL directo (Table Editor),
-- no solo lo que pase por api/parte.js. `antes`/`despues` son jsonb de la fila completa (to_jsonb).
--
-- Quién hizo el cambio: api/parte.js fija `galca.usuario` (y, solo para repartir, `galca.op`) con
-- set_config(…, true) al ABRIR la transacción; el trigger los lee con current_setting(…, true) (missing_ok).
-- Sin esa configuración (SQL directo fuera del Worker) el usuario queda 'sql:'||current_user, para que
-- nunca se pierda el rastro de quién escribió. El `op` se DERIVA del propio cambio (INSERT/UPDATE/DELETE
-- y el estado antes/después), salvo que `galca.op` venga fijado (repartir: una operación, varias filas).
--
-- Un UPDATE sin cambios reales (NEW IS NOT DISTINCT FROM OLD) no escribe nada: no es un cambio.
--
-- Además (D223): `parte_operadores.cedula` (solo para validar la firma del parte por QR; nunca sale en
-- exports ni en la Base) y `parte_bandeja.firma`/`firma_huella` ('' sin firma; 'cedula' = cédula validada
-- + declaración aceptada; la huella es sha256 de obra|id_registro|cédula, para verificar sin guardarla).
--
-- Idempotente (CREATE/ALTER … IF NOT EXISTS), solo ADITIVA. RLS habilitado sin políticas, como el resto
-- de tablas (007/008/012/014): nadie entra por la API REST de Supabase, solo el Worker con la cadena de
-- servicio. `parte_auditoria` es de SOLO INSERCIÓN: un trigger rechaza cualquier UPDATE/DELETE/TRUNCATE.
--
-- Vuelta atrás:
--   DROP TRIGGER IF EXISTS parte_bandeja_auditoria_trg ON parte_bandeja;
--   DROP FUNCTION IF EXISTS parte_auditoria_registrar_();
--   DROP TRIGGER IF EXISTS parte_auditoria_inmutable_trg ON parte_auditoria;
--   DROP TRIGGER IF EXISTS parte_auditoria_sin_truncate_trg ON parte_auditoria;
--   DROP FUNCTION IF EXISTS parte_auditoria_inmutable_();
--   DROP TABLE parte_auditoria;
--   ALTER TABLE parte_operadores DROP COLUMN cedula;
--   ALTER TABLE parte_bandeja DROP COLUMN firma, DROP COLUMN firma_huella;
--   DELETE FROM esquema_version WHERE version=15;
-- =====================================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS parte_auditoria (
  id          bigserial PRIMARY KEY,
  obra_id     text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  ts          timestamptz NOT NULL DEFAULT now(),
  usuario     text NOT NULL DEFAULT '',
  op          text NOT NULL CHECK (op IN ('alta','manual','aprobar','descartar','editar','repartir','borrar')),
  id_registro text NOT NULL,
  antes       jsonb NOT NULL DEFAULT '{}'::jsonb,
  despues     jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS parte_auditoria_registro_idx ON parte_auditoria (obra_id, id_registro, ts);

COMMENT ON TABLE parte_auditoria IS 'Historial del Parte Digital (D223): una fila por cada cambio real de parte_bandeja, escrita por trigger (cubre también SQL directo). Solo inserción: UPDATE/DELETE/TRUNCATE están bloqueados. Vuelta atrás: ver cabecera del archivo 015.';
COMMENT ON COLUMN parte_auditoria.usuario IS 'galca.usuario fijado por api/parte.js en la transacción; sin fijar, sql:<current_user> (cambio hecho fuera del Worker).';
COMMENT ON COLUMN parte_auditoria.op IS 'Derivado del cambio (alta/manual en INSERT; aprobar/descartar/editar en UPDATE; borrar en DELETE), salvo que galca.op lo fije (repartir).';

ALTER TABLE parte_auditoria ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON parte_auditoria FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON parte_auditoria FROM authenticated;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------
-- Inmutabilidad: parte_auditoria es de SOLO INSERCIÓN (D223).
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION parte_auditoria_inmutable_() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'parte_auditoria es de solo inserción (D223)';
END;
$$;

DROP TRIGGER IF EXISTS parte_auditoria_inmutable_trg ON parte_auditoria;
CREATE TRIGGER parte_auditoria_inmutable_trg
  BEFORE UPDATE OR DELETE ON parte_auditoria
  FOR EACH ROW EXECUTE FUNCTION parte_auditoria_inmutable_();

DROP TRIGGER IF EXISTS parte_auditoria_sin_truncate_trg ON parte_auditoria;
CREATE TRIGGER parte_auditoria_sin_truncate_trg
  BEFORE TRUNCATE ON parte_auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION parte_auditoria_inmutable_();

-- ---------------------------------------------------------------------------------------------------
-- Historial por TRIGGER sobre parte_bandeja: cubre cualquier camino de escritura (D223).
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION parte_auditoria_registrar_() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  quien text;
  accion text;
  op_fijo text;
BEGIN
  quien := coalesce(nullif(current_setting('galca.usuario', true), ''), 'sql:'||current_user);
  op_fijo := nullif(current_setting('galca.op', true), '');

  IF TG_OP = 'INSERT' THEN
    accion := coalesce(op_fijo, CASE WHEN NEW.origen = 'manual' THEN 'manual' ELSE 'alta' END);
    INSERT INTO parte_auditoria (obra_id, usuario, op, id_registro, antes, despues)
      VALUES (NEW.obra_id, quien, accion, NEW.id_registro, '{}'::jsonb, to_jsonb(NEW));
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;   -- sin cambios reales: no se audita
    accion := coalesce(op_fijo, CASE
      WHEN NEW.estado <> OLD.estado AND NEW.estado = 'aprobado'   THEN 'aprobar'
      WHEN NEW.estado <> OLD.estado AND NEW.estado = 'descartado' THEN 'descartar'
      ELSE 'editar' END);
    INSERT INTO parte_auditoria (obra_id, usuario, op, id_registro, antes, despues)
      VALUES (NEW.obra_id, quien, accion, NEW.id_registro, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    accion := coalesce(op_fijo, 'borrar');
    INSERT INTO parte_auditoria (obra_id, usuario, op, id_registro, antes, despues)
      VALUES (OLD.obra_id, quien, accion, OLD.id_registro, to_jsonb(OLD), '{}'::jsonb);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS parte_bandeja_auditoria_trg ON parte_bandeja;
CREATE TRIGGER parte_bandeja_auditoria_trg
  AFTER INSERT OR UPDATE OR DELETE ON parte_bandeja
  FOR EACH ROW EXECUTE FUNCTION parte_auditoria_registrar_();

-- ---------------------------------------------------------------------------------------------------
-- Firma del parte (interruptor PARTE_FIRMA, D223): cédula del operador (solo para validar, nunca sale en
-- exports ni en la Base) y qué firma quedó en cada fila de la bandeja.
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE parte_operadores ADD COLUMN IF NOT EXISTS cedula text NOT NULL DEFAULT '';
COMMENT ON COLUMN parte_operadores.cedula IS 'Solo para validar la firma del parte (D223); nunca sale en exports ni en la Base. Se carga desde Catálogos.';

ALTER TABLE parte_bandeja ADD COLUMN IF NOT EXISTS firma text NOT NULL DEFAULT '';
ALTER TABLE parte_bandeja ADD COLUMN IF NOT EXISTS firma_huella text NOT NULL DEFAULT '';
COMMENT ON COLUMN parte_bandeja.firma IS 'Vacío = sin firma; ''cedula'' = cédula validada + declaración aceptada (D223).';
COMMENT ON COLUMN parte_bandeja.firma_huella IS 'sha256 hex de obra|id_registro|cédula (D223): permite verificar después sin guardar la cédula.';

INSERT INTO esquema_version (version, nota)
  VALUES (15, '015_parte_auditoria.sql · tabla parte_auditoria (historial por trigger de parte_bandeja, D223); firma/firma_huella en parte_bandeja y cedula en parte_operadores')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
