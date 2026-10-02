-- =====================================================================================================
-- TM2 Sur · 016_parte_auditoria_deshacer.sql — op «deshacer_reparto» en la auditoría del parte · D228
-- El Worker gana op=deshacer_reparto (revisión de partes: vuelve a dejar pendiente la fila original de un reparto y
-- descarta sus partes). Como toda escritura del parte, se marca con set_config('galca.op', …) y el trigger de D223
-- la registra en parte_auditoria, cuyo CHECK solo admitía las ops anteriores: sin ampliarlo, la transacción del
-- Worker falla entera (no cambia nada). Aplicar ANTES del `wrangler deploy` del Worker con D228.
-- Solo esquema: no toca datos. Idempotente.
--
-- Vuelta atrás (solo si no hay filas con op='deshacer_reparto' en parte_auditoria, que es de solo inserción):
--   BEGIN;
--   ALTER TABLE parte_auditoria DROP CONSTRAINT IF EXISTS parte_auditoria_op_check;
--   ALTER TABLE parte_auditoria ADD CONSTRAINT parte_auditoria_op_check
--     CHECK (op IN ('alta','manual','aprobar','descartar','editar','repartir','borrar'));
--   DELETE FROM esquema_version WHERE version=16;
--   COMMIT;
-- =====================================================================================================

BEGIN;

ALTER TABLE parte_auditoria DROP CONSTRAINT IF EXISTS parte_auditoria_op_check;
ALTER TABLE parte_auditoria ADD CONSTRAINT parte_auditoria_op_check
  CHECK (op IN ('alta','manual','aprobar','descartar','editar','repartir','borrar','deshacer_reparto'));

INSERT INTO esquema_version (version, nota)
  VALUES (16, '016_parte_auditoria_deshacer.sql · op deshacer_reparto en el CHECK de parte_auditoria, D228')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
