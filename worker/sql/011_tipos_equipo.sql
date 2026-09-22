-- =====================================================================================================
-- TM2 Sur · 011_tipos_equipo.sql — UN nombre por clase de equipo en el Parte Digital · V3-19b, sep-2026
-- Revisión del dueño (Excel «Tipos_maquinaria_para_revisar», 22-sep-2026) sobre las 100 fichas de parte_equipos.
-- Problema: la misma clase de equipo tenía varios nombres (EXCAVADORA / EXCAVADORAS, LUMINARIA / TORRES DE
-- ILUMINACIÓN, CARROTANQUE / CAMION CISTERNA / CARRO CISTERNA…) y cada nombre tenía SU lista de actividades en
-- parte_items (el operador ve la del tipo de su ficha). Algunas fichas no veían ninguna (CARRO CISTERNA, PAJARITA).
--
-- Qué hace (se aplica DESPUÉS de 010; aborta si la 010 no está):
--   1. parte_equipos.tipo ← tipo revisado por el dueño (95 fichas; las 5 sin tipo quedan igual, a propósito).
--   2. parte_items: cada tipo viejo se pasa a su tipo nuevo (la humectación de CAMIONES va a CARROTANQUE, el
--      resto a CAMION GRUA) y las listas se FUSIONAN. Por (tipo nuevo, ítem) queda
--      activa UNA frase —la de más uso sumado— con veces = suma; lo demás queda activo='NO' (nada se borra).
--   3. maquinas (Flota) — su lista de tipos es FIJA (MAQ_TIPOS_FLOTA: de ella dependen las reglas de producción,
--      el filtro de excavadoras de la chequeadora y el reparto), así que NO se renombra a los nombres del parte.
--      Solo lo que el dueño marcó y cabe en esa lista:
--        · TC065 y TC092 siguen en obra: se quita su fecha de retiro (2026-09-07) y su ficha del parte vuelve a activa.
--        · TC095 es camabaja: tipo CAMABAJA.            · CR026 es minivibrocompactador: tipo VIBROCOMPACTADOR
--          (sigue «sin producción», igual que MINIBULDOZER).
--        · CG007 y EXC04 son de drenajes: grupo = drenajes (D190).
-- Respaldo: parte_equipos_respaldo_011, parte_items_respaldo_011, maquinas_respaldo_011 (RLS activada).
-- Idempotente: correrla dos veces deja lo mismo.
--
-- Vuelta atrás (restaura las tres tablas como estaban antes de la 011):
--   BEGIN;
--   DELETE FROM parte_equipos WHERE obra_id='tm2sur'; INSERT INTO parte_equipos SELECT * FROM parte_equipos_respaldo_011;
--   DELETE FROM parte_items   WHERE obra_id='tm2sur'; INSERT INTO parte_items   SELECT * FROM parte_items_respaldo_011;
--   DELETE FROM maquinas      WHERE obra_id='tm2sur'; INSERT INTO maquinas      SELECT * FROM maquinas_respaldo_011;
--   DELETE FROM esquema_version WHERE version=11; COMMIT;
-- =====================================================================================================

BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM esquema_version WHERE version=10) THEN
    RAISE EXCEPTION '011: aplica primero 010_depurar_parte_items.sql';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS parte_equipos_respaldo_011 AS SELECT * FROM parte_equipos;
CREATE TABLE IF NOT EXISTS parte_items_respaldo_011   AS SELECT * FROM parte_items;
CREATE TABLE IF NOT EXISTS maquinas_respaldo_011      AS SELECT * FROM maquinas;
ALTER TABLE parte_equipos_respaldo_011 ENABLE ROW LEVEL SECURITY;
ALTER TABLE parte_items_respaldo_011   ENABLE ROW LEVEL SECURITY;
ALTER TABLE maquinas_respaldo_011      ENABLE ROW LEVEL SECURITY;

-- ---------- 1. tipo nuevo de cada ficha (revisado por el dueño) ----------
CREATE TEMP TABLE ficha_tipo (codigo text, tipo text) ON COMMIT DROP;
INSERT INTO ficha_tipo (codigo, tipo) VALUES
  ('WNW030','BRAZO ARTICULADO'),
  ('BL002','BULLDOZER'),('BL005','BULLDOZER'),('BL009','BULLDOZER'),('NH69','BULLDOZER'),
  ('LPM670','CAMABAJA'),('SJQ401','CAMABAJA'),('SQA934','CAMABAJA'),('SXV919','CAMABAJA'),('UPP173','CAMABAJA'),('XIE638','CAMABAJA'),
  ('TC095','CAMABAJA'),
  ('CG005','CAMION GRUA'),('CG007','CAMION GRUA'),
  ('LPL495','CARROTANQUE'),('SRS105','CARROTANQUE'),('SRS255','CARROTANQUE'),('CT012','CARROTANQUE'),('GQV887','CARROTANQUE'),
  ('TMX535','CARROTANQUE'),('TTS508','CARROTANQUE'),('XMC714','CARROTANQUE'),('XMD600','CARROTANQUE'),('XVX241','CARROTANQUE'),
  ('CAT320','EXCAVADORA'),('EXC030','EXCAVADORA'),('EXC001','EXCAVADORA'),('EXC002','EXCAVADORA'),('EXC004','EXCAVADORA'),
  ('EXC013','EXCAVADORA'),('EXC014','EXCAVADORA'),('EXC015','EXCAVADORA'),
  ('EQ01','EXCAVADORA DE LLANTAS'),('EXC026','EXCAVADORA DE LLANTAS'),('EXC04','EXCAVADORA DE LLANTAS'),('EXC190','EXCAVADORA DE LLANTAS'),
  ('MC64','EXCAVADORA DE LLANTAS'),
  ('NG002','EXTENDEDORA'),
  ('CAT074','MINICARGADOR'),('M73','MINICARGADOR'),('MC86','MINICARGADOR'),('MNC319','MINICARGADOR'),('NH421','MINICARGADOR'),
  ('CAT120','MOTONIVELADORA'),('MO001','MOTONIVELADORA'),('MO003','MOTONIVELADORA'),('MO004','MOTONIVELADORA'),('MO009','MOTONIVELADORA'),
  ('PH102','RETROCARGADOR'),('R102','RETROCARGADOR'),('RT-01','RETROCARGADOR'),('RT-02','RETROCARGADOR'),
  ('TI011','TORRE DE ILUMINACION'),('TI12','TORRE DE ILUMINACION'),('TI001','TORRE DE ILUMINACION'),('TI005','TORRE DE ILUMINACION'),
  ('TI08','TORRE DE ILUMINACION'),
  ('TC009','TRACTOCAMION'),('TC023','TRACTOCAMION'),('TC065','TRACTOCAMION'),('TC092','TRACTOCAMION'),('TC114','TRACTOCAMION'),
  ('LPL321','TURBO'),('WDS154','TURBO'),('LPM206','TURBO'),('NXR363','TURBO'),
  ('CR008','VIBROCOMPACTADOR'),('CR013','VIBROCOMPACTADOR'),('CR016','VIBROCOMPACTADOR'),('CR018','VIBROCOMPACTADOR'),
  ('CR019','VIBROCOMPACTADOR'),('15','VIBROCOMPACTADOR'),('18','VIBROCOMPACTADOR'),('CR026','VIBROCOMPACTADOR'),
  ('CR028','VIBROCOMPACTADOR'),('CR029','VIBROCOMPACTADOR'),('CS78B','VIBROCOMPACTADOR'),('NH403','VIBROCOMPACTADOR'),
  ('NH404','VIBROCOMPACTADOR'),('NH420','VIBROCOMPACTADOR'),('CAT900','VIBROCOMPACTADOR'),
  ('VOL010','VOLQUETA'),('VOL012','VOLQUETA'),('VOL022','VOLQUETA'),('VOL024','VOLQUETA'),('VOL031','VOLQUETA'),
  ('VOL034','VOLQUETA'),('VOL039','VOLQUETA'),('VOL040','VOLQUETA'),('VOL044','VOLQUETA'),('VOL047','VOLQUETA'),
  ('VOL048','VOLQUETA'),('VOL054','VOLQUETA'),('VOL056','VOLQUETA'),('VOL065','VOLQUETA'),('VOL067','VOLQUETA');

UPDATE parte_equipos e SET tipo=f.tipo
  FROM ficha_tipo f WHERE e.obra_id='tm2sur' AND e.codigo=f.codigo AND e.tipo IS DISTINCT FROM f.tipo;
-- TC065 y TC092 siguen en obra (dueño): su ficha vuelve a activa
UPDATE parte_equipos SET activo='SI' WHERE obra_id='tm2sur' AND codigo IN ('TC065','TC092');

-- ---------- 2. listas de actividades: tipo viejo → tipo nuevo, fusionadas ----------
CREATE TEMP TABLE tipo_nuevo (viejo text, nuevo text) ON COMMIT DROP;
INSERT INTO tipo_nuevo (viejo, nuevo) VALUES
  ('BULLDOZER','BULLDOZER'),
  ('CAMABAJA','CAMABAJA'),
  ('CAMIONES','CAMION GRUA'),
  ('CAMION CISTERNA','CARROTANQUE'),('CARROTANQUE','CARROTANQUE'),
  ('COMPACTADORES','VIBROCOMPACTADOR'),('VIBROCOMPACTADOR','VIBROCOMPACTADOR'),('VIBROCOMPACTADOR RENTAL 900','VIBROCOMPACTADOR'),
  ('EXCAVADORA','EXCAVADORA'),('EXCAVADORAS','EXCAVADORA'),
  ('EXCAVADORA SOBRE LLANTAS','EXCAVADORA DE LLANTAS'),('RETRO DE LLANTAS','EXCAVADORA DE LLANTAS'),
  ('EXTENDEDORAS','EXTENDEDORA'),
  ('LUMINARIA','TORRE DE ILUMINACION'),('TORRES DE ILUMINACIÓN','TORRE DE ILUMINACION'),
  ('MINICARGADOR','MINICARGADOR'),
  ('MOTONIVELADORA','MOTONIVELADORA'),('MOTONIVELADORAS','MOTONIVELADORA'),
  ('RETROCARGADOR','RETROCARGADOR'),
  ('TRACTOCAMIONES','TRACTOCAMION'),
  ('TURBO','TURBO'),('TURBO DE ESTACAS','TURBO'),
  ('VOLQUETAS DOBLETROQUE','VOLQUETA'),
  -- cada tipo nuevo también se mapea a sí mismo: así una 2ª pasada (idempotencia) vuelve a leer sus filas
  ('CAMION GRUA','CAMION GRUA'),('EXCAVADORA DE LLANTAS','EXCAVADORA DE LLANTAS'),('EXTENDEDORA','EXTENDEDORA'),
  ('TORRE DE ILUMINACION','TORRE DE ILUMINACION'),('TRACTOCAMION','TRACTOCAMION'),('VOLQUETA','VOLQUETA');

-- Excepción por ÍTEM (dueño, 22-sep-2026, opción a): la lista vieja de CAMIONES era sobre todo HUMECTACIÓN —en el
-- historial se reportaron carrotanques como «CAMIONES»—. Esos ítems van a CARROTANQUE; el resto (cargue de acero,
-- tubería, transporte de personal, campamentos…) se queda en CAMION GRUA.
CREATE TEMP TABLE item_nuevo (viejo text, item text, nuevo text) ON COMMIT DROP;
INSERT INTO item_nuevo (viejo, item, nuevo) VALUES
  ('CAMIONES','2.07','CARROTANQUE'),('CAMIONES','2.09','CARROTANQUE'),('CAMIONES','3.01','CARROTANQUE'),
  ('CAMIONES','3.03','CARROTANQUE'),('CAMIONES','7.02','CARROTANQUE');

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM tipo_nuevo t WHERE NOT EXISTS (SELECT 1 FROM tipo_nuevo u WHERE u.viejo=t.nuevo)) THEN
    RAISE EXCEPTION '011: todo tipo nuevo debe mapearse también a sí mismo';
  END IF;
END $$;

-- uso sumado de cada frase ACTIVA, ya bajo su tipo nuevo
CREATE TEMP TABLE frase_uso ON COMMIT DROP AS
  SELECT p.obra_id, coalesce(i.nuevo, t.nuevo) AS tipo, p.item, p.actividad, sum(coalesce(p.veces,0)) AS veces
  FROM parte_items p JOIN tipo_nuevo t ON t.viejo=p.tipo_equipo
  LEFT JOIN item_nuevo i ON i.viejo=p.tipo_equipo AND i.item=p.item
  WHERE upper(trim(p.activo)) NOT IN ('NO','N','FALSE','0','INACTIVO','INACTIVA')
  GROUP BY 1,2,3,4;
-- por (tipo nuevo, ítem): la frase más usada y el total del ítem
CREATE TEMP TABLE canon_011 ON COMMIT DROP AS
  SELECT DISTINCT ON (obra_id, tipo, item) obra_id, tipo, item, actividad,
         sum(veces) OVER (PARTITION BY obra_id, tipo, item) AS veces
  FROM frase_uso ORDER BY obra_id, tipo, item, veces DESC, actividad;

-- se apagan TODAS las filas de los tipos del mapa (viejos y nuevos) …
UPDATE parte_items p SET activo='NO'
  WHERE p.tipo_equipo IN (SELECT viejo FROM tipo_nuevo)
    AND upper(trim(p.activo)) NOT IN ('NO','N','FALSE','0','INACTIVO','INACTIVA');
-- … y queda activa una por (tipo nuevo, ítem)
INSERT INTO parte_items (obra_id, tipo_equipo, item, actividad, veces, activo)
  SELECT obra_id, tipo, item, actividad, veces, 'SI' FROM canon_011
  ON CONFLICT (obra_id, tipo_equipo, item, actividad) DO UPDATE SET veces=EXCLUDED.veces, activo='SI';

-- ---------- 3. Flota (solo lo marcado por el dueño, dentro de la lista fija de tipos) ----------
UPDATE maquinas SET fecha_retiro=NULL
  WHERE obra_id='tm2sur' AND id_maquina IN ('TC065','TC092') AND fecha_retiro='2026-09-07';
UPDATE maquinas SET tipo='CAMABAJA'         WHERE obra_id='tm2sur' AND id_maquina='TC095' AND tipo='TRACTOCAMION';
UPDATE maquinas SET tipo='VIBROCOMPACTADOR' WHERE obra_id='tm2sur' AND id_maquina='CR026' AND tipo='MINIBULDOZER';
UPDATE maquinas SET grupo='drenajes'        WHERE obra_id='tm2sur' AND id_maquina IN ('CG007','EXC04');

INSERT INTO esquema_version (version, nota)
  VALUES (11, '011_tipos_equipo.sql · un nombre por clase de equipo en parte_equipos + listas fusionadas en parte_items + ajustes de flota marcados por el dueño, V3-19b')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
