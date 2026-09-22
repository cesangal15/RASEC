-- =====================================================================================================
-- TM2 Sur · 012_unificar_cargos.sql — un texto canónico por cargo en `personal` y `asistencia`, sep-2026
-- Decisión del dueño: el mismo cargo llega escrito de varias formas (mayúsculas, abreviado, con/sin
-- tildes…) y eso rompe el desglose por cargo del Tablero (V3-16, `c` de `personalDelTablero_`) y cualquier
-- reporte que agrupe por cargo. Esta migración deja UN texto canónico por CLAVE normalizada (trim, sin
-- tildes —salvo ñ/Ñ, que se preservan—, MAYÚSCULAS, espacios colapsados; `cargo_norm_012`, misma regla que
-- `normCargo_` del Worker en worker/src/api/obra/tablero_vivo.js) en las dos tablas que guardan `cargo` como
-- texto libre. Cualquier cargo NO listado en `variant_canon` no se toca (no inventa sinónimos).
--
-- Idempotente: la 2ª pasada no encuentra filas con `cargo <> canónico` que cuadren con una clave de la
-- lista, así que no actualiza ni respalda nada de nuevo (ver comprobación en verificar_012_cargos.mjs).
-- Respaldo ANTES de escribir: `cargos_respaldo_012` (tabla origen, clave de la fila — personal:
-- obra_id+personal_id; asistencia: obra_id+id_registro —, cargo_anterior, cargo_nuevo, ts), con RLS como
-- las demás tablas de respaldo (009/010/011). Solo se tocan las filas cuyo cargo cambia de verdad.
--
-- Vuelta atrás (restaura los cargos exactos de antes de esta migración, desde el respaldo):
--   BEGIN;
--   UPDATE personal p SET cargo = r.cargo_anterior
--     FROM cargos_respaldo_012 r
--     WHERE r.tabla_origen='personal' AND r.clave = p.obra_id || '|' || p.personal_id AND p.cargo = r.cargo_nuevo;
--   UPDATE asistencia a SET cargo = r.cargo_anterior
--     FROM cargos_respaldo_012 r
--     WHERE r.tabla_origen='asistencia' AND r.clave = a.obra_id || '|' || a.id_registro AND a.cargo = r.cargo_nuevo;
--   DELETE FROM cargos_respaldo_012;
--   DELETE FROM esquema_version WHERE version=12;
--   COMMIT;
-- =====================================================================================================

BEGIN;

-- ---------- normalización de la clave (misma regla que normCargo_ del Worker: sin tildes, ñ/Ñ intactas,
-- MAYÚSCULAS, espacios colapsados, trim) ----------
CREATE OR REPLACE FUNCTION cargo_norm_012(s text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(trim(regexp_replace(
    translate(coalesce(s, ''),
      'áàäâÁÀÄÂéèëêÉÈËÊíìïîÍÌÏÎóòöôÓÒÖÔúùüûÚÙÜÛ',
      'aaaaAAAAeeeeEEEEiiiiIIIIooooOOOOuuuuUUUU'),
    '\s+', ' ', 'g')));
$$;

-- ---------- respaldo (una sola vez; RLS como parte_equipos_respaldo_011 y similares) ----------
CREATE TABLE IF NOT EXISTS cargos_respaldo_012 (
  id              bigserial PRIMARY KEY,
  tabla_origen    text NOT NULL,               -- 'personal' | 'asistencia'
  clave           text NOT NULL,                -- personal: obra_id||'|'||personal_id · asistencia: obra_id||'|'||id_registro
  cargo_anterior  text NOT NULL,
  cargo_nuevo     text NOT NULL,
  ts              timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cargos_respaldo_012 ENABLE ROW LEVEL SECURITY;

-- ---------- tabla de la decisión del dueño: variante (ya en MAYÚSCULAS sin tildes) → canónico ----------
CREATE TEMP TABLE variant_canon (variant text, canonico text) ON COMMIT DROP;
INSERT INTO variant_canon (variant, canonico) VALUES
  ('OPERADOR DE VOLQUETA','Operador de volqueta'), ('OP VOLQUETA','Operador de volqueta'), ('VOLQUETERO','Operador de volqueta'),
  ('OFICIAL DE OBRA','Oficial de obra'), ('OFICIAL','Oficial de obra'), ('OFICIA','Oficial de obra'),
  ('AYUDANTE DE OBRA','Ayudante de obra'), ('AYUDANTE','Ayudante de obra'),
  ('CAPATAZ DE OBRA','Capataz de obra'), ('CAPATAZ','Capataz de obra'),
  ('OPERADOR MOTONIVELADORA','Operador de motoniveladora'), ('OPERADOR DE MOTONIVERLADORA','Operador de motoniveladora'),
  ('OPERADOR EXCAVADORA','Operador de excavadora'),
  ('OPERADOR MULTIPLE','Operador múltiple'),
  ('INGENIERO RESIDENTE','Ingeniero residente'), ('RESIDENTE','Ingeniero residente'),
  ('MECANICO','Mecánico'),
  ('AUXILIAR ADMINISTRATIVO','Auxiliar administrativo'),
  ('ENCARGADO','Encargado'),
  -- solo formato (misma clave, sin variantes de fondo)
  ('AYUDANTE DE CONTROL','Ayudante de control'),
  ('OFICIAL DE ESTRUCTURA','Oficial de estructura'),
  ('OPERADOR DE BULLDOZER','Operador de bulldozer'),
  ('OPERADOR DE CAMABAJA','Operador de camabaja'),
  ('OPERADOR DE CARRO TANQUE','Operador de carro tanque'),
  ('OPERADOR DE VIBROCOMPACTADOR','Operador de vibrocompactador');

-- guarda: ninguna clave normalizada puede mapear a dos canónicos distintos
DO $$ BEGIN
  IF EXISTS (SELECT cargo_norm_012(variant) FROM variant_canon GROUP BY cargo_norm_012(variant) HAVING count(DISTINCT canonico) > 1) THEN
    RAISE EXCEPTION '012: una misma clave normalizada mapea a dos canónicos distintos en variant_canon';
  END IF;
END $$;

-- ---------- PERSONAL: respaldo (antes de tocar nada) + actualización ----------
INSERT INTO cargos_respaldo_012 (tabla_origen, clave, cargo_anterior, cargo_nuevo, ts)
SELECT 'personal', p.obra_id || '|' || p.personal_id, p.cargo, v.canonico, now()
FROM personal p JOIN variant_canon v ON cargo_norm_012(p.cargo) = cargo_norm_012(v.variant)
WHERE p.cargo <> v.canonico;

UPDATE personal p SET cargo = v.canonico
FROM variant_canon v
WHERE cargo_norm_012(p.cargo) = cargo_norm_012(v.variant) AND p.cargo <> v.canonico;

-- ---------- ASISTENCIA: respaldo (antes de tocar nada) + actualización ----------
INSERT INTO cargos_respaldo_012 (tabla_origen, clave, cargo_anterior, cargo_nuevo, ts)
SELECT 'asistencia', a.obra_id || '|' || a.id_registro, a.cargo, v.canonico, now()
FROM asistencia a JOIN variant_canon v ON cargo_norm_012(a.cargo) = cargo_norm_012(v.variant)
WHERE a.cargo <> v.canonico;

UPDATE asistencia a SET cargo = v.canonico
FROM variant_canon v
WHERE cargo_norm_012(a.cargo) = cargo_norm_012(v.variant) AND a.cargo <> v.canonico;

INSERT INTO esquema_version (version, nota)
  VALUES (12, '012_unificar_cargos.sql · texto canónico de cargo en personal/asistencia por clave normalizada, respaldo cargos_respaldo_012, decisión del dueño')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
