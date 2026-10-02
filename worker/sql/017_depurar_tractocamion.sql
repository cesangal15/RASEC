-- =====================================================================================================
-- TM2 Sur · 017_depurar_tractocamion.sql — actividades de otras máquinas fuera de la lista del TRACTOCAMION · D228
-- Problema: la lista de actividades del tipo TRACTOCAMION (tras la 011) arrastra ítems de cama baja y de otras
-- máquinas (PMT, traslado de compactador, desmonte, excavaciones…): en el Excel histórico la cama baja TC095 figuraba
-- como «TRACTOCAMIONES» (la 011 la pasó a CAMABAJA, pero su historial quedó en la lista del tractocamión). Con D228 el
-- operador ve TODAS las actividades activas de su tipo («Más actividades»), así que lo que no es de la mula se apaga.
-- Es DATO (parte_items, editable también desde Catálogos, D211): no hace falta desplegar nada para que tome efecto.
--
-- Qué hace:
--   1. Respaldo de las filas que se tocan en parte_items_respaldo_017 (se crea si no existe y se llena SOLO la
--      primera vez: una segunda corrida no pisa el respaldo).
--   2. Marca activo='NO' (no se borra nada; el Worker ignora activo='NO') en tipo_equipo='TRACTOCAMION' de los ítems
--        11.01 PMT · 2.07 Traslado de compactador a terraplén · 2.03 Desmonte y limpieza ·
--        2.05 Excavación en material común · 6.01 Excavaciones varias (ODT) · 7.01 Excavaciones varias (ODL).
--      Quedan activos (no se tocan): 2.1, 3.02, 3.03, 4.03, 5.04, 6.02, 6.04, 11.04.
-- El ítem se compara normalizado (NN.NN) por si está guardado como '2.07' o '02.07' (parteNormItem_ del Worker).
-- Idempotente: correrla dos veces deja lo mismo.
--
-- Vuelta atrás (restaura el estado exacto de esas filas):
--   BEGIN;
--   UPDATE parte_items p SET activo = r.activo
--     FROM parte_items_respaldo_017 r
--     WHERE p.obra_id=r.obra_id AND p.tipo_equipo=r.tipo_equipo AND p.item=r.item AND p.actividad=r.actividad;
--   DELETE FROM esquema_version WHERE version=17;
--   COMMIT;
-- =====================================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS parte_items_respaldo_017 (LIKE parte_items);
-- RLS como el resto de tablas de producción (activada, sin políticas): la API REST de Supabase no la ve.
ALTER TABLE parte_items_respaldo_017 ENABLE ROW LEVEL SECURITY;

CREATE TEMP TABLE fuera017 (item text) ON COMMIT DROP;
INSERT INTO fuera017 (item) VALUES ('11.01'),('02.07'),('02.03'),('02.05'),('06.01'),('07.01');

-- respaldo: solo la primera vez (tabla vacía) y solo las filas que se van a tocar
INSERT INTO parte_items_respaldo_017
  SELECT p.* FROM parte_items p
  WHERE p.obra_id='tm2sur' AND p.tipo_equipo='TRACTOCAMION'
    AND lpad(split_part(p.item,'.',1),2,'0')||'.'||rpad(split_part(p.item,'.',2),2,'0') IN (SELECT item FROM fuera017)
    AND NOT EXISTS (SELECT 1 FROM parte_items_respaldo_017);

UPDATE parte_items p SET activo='NO'
  WHERE p.obra_id='tm2sur' AND p.tipo_equipo='TRACTOCAMION'
    AND lpad(split_part(p.item,'.',1),2,'0')||'.'||rpad(split_part(p.item,'.',2),2,'0') IN (SELECT item FROM fuera017)
    AND upper(trim(p.activo)) NOT IN ('NO','N','FALSE','0','INACTIVO','INACTIVA');

INSERT INTO esquema_version (version, nota)
  VALUES (17, '017_depurar_tractocamion.sql · ítems de cama baja / otras máquinas apagados en TRACTOCAMION, D228')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
