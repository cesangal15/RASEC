-- =====================================================================================================
-- TM2 Sur · 017_depurar_tractocamion.sql — el TRACTOCAMION (mula) solo transporta granulares · D228
-- Problema: la lista de actividades del tipo TRACTOCAMION (tras la 011) arrastraba ítems de cama baja y de otras
-- máquinas (PMT, traslado de compactador, desmonte, excavaciones, MSR, hierro…): en el Excel histórico la cama baja
-- TC095 figuraba como «TRACTOCAMIONES» (la 011 la pasó a CAMABAJA, pero su historial quedó en la lista de la mula).
-- Decisión del dueño (2-oct): la mula solo lleva el CC de transporte de granulares (subbase, BTC u otro granular).
-- Con D228 el operador ve TODAS las actividades activas de su tipo, así que lo demás se apaga.
-- Es DATO (parte_items, editable también desde Catálogos, D211): no hace falta desplegar nada para que tome efecto.
--
-- Qué hace:
--   1. Respaldo de las filas del TRACTOCAMION que se apagan en parte_items_respaldo_017 (se crea si no existe y se
--      llena SOLO la primera vez: una segunda corrida no pisa el respaldo).
--   2. Deja activas solo 03.02 «Transporte de subbase (La Putana)» y 03.04 «Transporte de BTC (La Putana)» (transporte
--      de base granular, el mismo ítem con el que las volquetas cargan el BTC); todo lo demás del TRACTOCAMION pasa a
--      activo='NO' (no se borra nada; el Worker ignora activo='NO'). 03.03 (base estabilizada = COLOCACIÓN, no
--      transporte) también se apaga; se reactiva en Catálogos si hiciera falta.
--   3. Agrega la fila 03.04 «Transporte de BTC (La Putana)» del TRACTOCAMION si no existe.
-- El ítem se compara normalizado (NN.NN) por si está guardado como '3.02' o '03.02' (parteNormItem_ del Worker).
-- Idempotente: correrla dos veces deja lo mismo.
--
-- Vuelta atrás (restaura el estado exacto de esas filas y quita la fila agregada):
--   BEGIN;
--   UPDATE parte_items p SET activo = r.activo
--     FROM parte_items_respaldo_017 r
--     WHERE p.obra_id=r.obra_id AND p.tipo_equipo=r.tipo_equipo AND p.item=r.item AND p.actividad=r.actividad;
--   DELETE FROM parte_items WHERE obra_id='tm2sur' AND tipo_equipo='TRACTOCAMION' AND actividad='Transporte de BTC (La Putana)';
--   DELETE FROM esquema_version WHERE version=17;
--   COMMIT;
-- =====================================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS parte_items_respaldo_017 (LIKE parte_items);
-- RLS como el resto de tablas de producción (activada, sin políticas): la API REST de Supabase no la ve.
ALTER TABLE parte_items_respaldo_017 ENABLE ROW LEVEL SECURITY;

CREATE TEMP TABLE queda017 (item text) ON COMMIT DROP;
INSERT INTO queda017 (item) VALUES ('03.02'),('03.04');

-- respaldo: solo la primera vez (tabla vacía) y solo las filas que se van a apagar
INSERT INTO parte_items_respaldo_017
  SELECT p.* FROM parte_items p
  WHERE p.obra_id='tm2sur' AND p.tipo_equipo='TRACTOCAMION'
    AND lpad(split_part(p.item,'.',1),2,'0')||'.'||rpad(split_part(p.item,'.',2),2,'0') NOT IN (SELECT item FROM queda017)
    AND NOT EXISTS (SELECT 1 FROM parte_items_respaldo_017);

UPDATE parte_items p SET activo='NO'
  WHERE p.obra_id='tm2sur' AND p.tipo_equipo='TRACTOCAMION'
    AND lpad(split_part(p.item,'.',1),2,'0')||'.'||rpad(split_part(p.item,'.',2),2,'0') NOT IN (SELECT item FROM queda017)
    AND upper(trim(coalesce(p.activo,''))) NOT IN ('NO','N','FALSE','0','INACTIVO','INACTIVA');

-- 03.04: transporte de BTC / base granular (mismo ítem que usan las volquetas para el BTC de La Putana)
INSERT INTO parte_items (obra_id, tipo_equipo, item, actividad, veces, activo)
  SELECT 'tm2sur', 'TRACTOCAMION', '3.04', 'Transporte de BTC (La Putana)', 12, 'SI'
  WHERE NOT EXISTS (SELECT 1 FROM parte_items WHERE obra_id='tm2sur' AND tipo_equipo='TRACTOCAMION'
                      AND lpad(split_part(item,'.',1),2,'0')||'.'||rpad(split_part(item,'.',2),2,'0')='03.04');

INSERT INTO esquema_version (version, nota)
  VALUES (17, '017_depurar_tractocamion.sql · la mula (TRACTOCAMION) solo transporta granulares: 03.02 y 03.04 activos, lo demás apagado, D228')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
