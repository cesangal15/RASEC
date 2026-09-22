-- =====================================================================================================
-- TM2 Sur · 010_depurar_parte_items.sql — UNA frase por tipo de equipo + ítem en parte_items · V3-19, sep-2026
-- Problema (visto en campo, 21-sep-2026): los chips del Parte Digital salían repetidos o confusos porque el
-- catálogo trae varias frases por ítem («Compactacion terraplen» / «Compactando terraplen») y la MISMA frase en
-- ítems distintos (cuatro «Excavacion» en la retro de llantas, «Compactacion terraplen» en 02.07 y en 03.01 del
-- vibro, «Terraplen» en 02.07 y 02.05 de las torres…). El formulario muestra UN chip por ítem y 5 como máximo
-- (D178, se mantiene); esta migración deja el catálogo limpio para que cada chip diga algo distinto y cierto.
--
-- Qué hace, por cada (tipo_equipo, item) de la lista `canon`:
--   1. Respaldo completo de parte_items en parte_items_respaldo_010 (una sola vez).
--   2. Deja ACTIVA una sola fila con la frase canónica y veces = suma de las filas activas de ese ítem
--      (el orden de los chips sigue el uso real acumulado).
--   3. Marca activo='NO' las demás frases de ese ítem (no se borra nada; el Worker ya ignora activo='NO').
-- Lo que no está en `canon` no se toca. Idempotente: correrlo dos veces deja lo mismo (la suma se hace
-- sobre las filas activas, y tras la 1ª pasada solo queda la canónica).
-- Los ítems van tal como están guardados en la tabla (2.07, 2.1 = 02.10, 7.1 = 07.10): el Worker los
-- normaliza al leer (parteNormItem_, D178), así que no se reescriben.
--
-- Vuelta atrás (restaura el catálogo exacto de antes):
--   BEGIN; DELETE FROM parte_items WHERE obra_id='tm2sur';
--   INSERT INTO parte_items SELECT * FROM parte_items_respaldo_010; COMMIT;
-- =====================================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS parte_items_respaldo_010 AS SELECT * FROM parte_items;
-- RLS como el resto de tablas de producción (activada, sin políticas): la API REST de Supabase no la ve.
ALTER TABLE parte_items_respaldo_010 ENABLE ROW LEVEL SECURITY;

CREATE TEMP TABLE canon (tipo text, item text, frase text) ON COMMIT DROP;
INSERT INTO canon (tipo, item, frase) VALUES
  -- BULLDOZER
  ('BULLDOZER','2.07','Conformación de terraplén'),
  ('BULLDOZER','2.08','Conformación de botadero / ZODME / RCD'),
  ('BULLDOZER','2.03','Desmonte y limpieza'),
  ('BULLDOZER','11.04','Imprevistos (bloqueos - paros)'),
  -- CAMABAJA (traslada equipos: la frase es el frente al que lo llevó)
  ('CAMABAJA','5.04','Traslado de equipo a muros de tierra (MSR)'),
  ('CAMABAJA','2.05','Traslado de equipo a excavación'),
  ('CAMABAJA','2.07','Traslado de equipo a terraplén'),
  ('CAMABAJA','2.08','Traslado de equipo a sobrantes (ZODME / RCD)'),
  ('CAMABAJA','6.01','Traslado de equipo a excavaciones varias (ODT)'),
  -- CAMIONES
  ('CAMIONES','3.03','Humectación de BTC'),
  ('CAMIONES','3.01','Humectación de subbase'),
  ('CAMIONES','2.07','Humectación de terraplén'),
  ('CAMIONES','6.04','Cargue de acero'),
  ('CAMIONES','I0408','Transporte de personal'),
  ('CAMIONES','7.1','Tubería de concreto de 600 mm'),
  ('CAMIONES','6.05','Cargue para estructuras (06.05)'),
  ('CAMIONES','6.09','Cargue para encoles y descoles (06.09)'),
  ('CAMIONES','5.04','Relleno para muros de tierra (MSR)'),
  ('CAMIONES','I0513','Montaje / desmontaje de campamentos'),
  ('CAMIONES','11.04','Imprevistos (bloqueos - paros)'),
  ('CAMIONES','6.02','Rellenos con material seleccionado'),
  ('CAMIONES','9.02','Protección de taludes con biomanto'),
  ('CAMIONES','2.05','Excavación en material común'),
  ('CAMIONES','7.02','Humectación en drenaje longitudinal (ODL)'),
  ('CAMIONES','7.07','Cunetas de concreto 14 MPa'),
  ('CAMIONES','2.06','Excavación de préstamo'),
  ('CAMIONES','2.09','Riego de agua en caminos y accesos'),
  ('CAMIONES','11.01','Cargue de geomembrana (PMT)'),
  -- CAMION CISTERNA
  ('CAMION CISTERNA','3.03','Humectación de BTC'),
  ('CAMION CISTERNA','3.01','Humectación de subbase'),
  -- CARROTANQUE
  ('CARROTANQUE','2.07','Humectación de terraplén'),
  ('CARROTANQUE','3.01','Humectación de subbase'),
  ('CARROTANQUE','3.03','Humectación de BTC'),
  ('CARROTANQUE','11.04','Imprevistos (bloqueos - paros)'),
  -- COMPACTADORES
  ('COMPACTADORES','2.07','Compactación de terraplén'),
  ('COMPACTADORES','3.01','Compactación de subbase'),
  ('COMPACTADORES','3.03','Compactación de BTC'),
  ('COMPACTADORES','11.04','Imprevistos (bloqueos - paros)'),
  -- EXCAVADORAS
  ('EXCAVADORAS','2.05','Cargue de volquetas (excavación)'),
  ('EXCAVADORAS','2.06','Cargue en préstamo'),
  ('EXCAVADORAS','2.03','Descapote'),
  ('EXCAVADORAS','2.07','Conformación de terraplén'),
  ('EXCAVADORAS','5.04','Corte de talud y cargue para MSR'),
  ('EXCAVADORAS','6.01','Excavaciones varias (ODT)'),
  ('EXCAVADORAS','6.02','Apoyo a ODT'),
  ('EXCAVADORAS','2.08','Traspaleo de descapote (sobrantes)'),
  ('EXCAVADORAS','2.01','Desmonte y limpieza en bosque'),
  -- EXCAVADORA
  ('EXCAVADORA','2.05','Cargue de volquetas (excavación)'),
  ('EXCAVADORA','6.02','Rellenos con material seleccionado'),
  ('EXCAVADORA','2.03','Descapote'),
  ('EXCAVADORA','6.01','Excavaciones varias (ODT)'),
  -- EXCAVADORA SOBRE LLANTAS
  ('EXCAVADORA SOBRE LLANTAS','6.02','Rellenos con material seleccionado'),
  ('EXCAVADORA SOBRE LLANTAS','6.01','Excavaciones varias (ODT)'),
  -- EXTENDEDORAS
  ('EXTENDEDORAS','3.03','Colocación de BTC'),
  -- LUMINARIA / TORRES DE ILUMINACIÓN (la frase es el frente que alumbró)
  ('LUMINARIA','2.07','Iluminación de terraplén'),
  ('LUMINARIA','5.04','Iluminación de muros de tierra (MSR)'),
  ('LUMINARIA','11.01','Iluminación de PMT'),
  ('LUMINARIA','2.05','Iluminación de excavación'),
  ('TORRES DE ILUMINACIÓN','2.07','Iluminación de terraplén'),
  ('TORRES DE ILUMINACIÓN','2.05','Iluminación de excavación'),
  -- MINICARGADOR
  ('MINICARGADOR','5.04','Movimiento de material en MSR'),
  -- MOTONIVELADORAS / MOTONIVELADORA
  ('MOTONIVELADORAS','2.07','Cereo y conformación de terraplén'),
  ('MOTONIVELADORAS','3.01','Cereo de subbase'),
  ('MOTONIVELADORAS','3.03','Extendido de BTC'),
  ('MOTONIVELADORAS','11.04','Imprevistos (bloqueos - paros)'),
  ('MOTONIVELADORA','3.01','Cereo de subbase'),
  ('MOTONIVELADORA','2.07','Cereo y conformación de terraplén'),
  -- RETRO DE LLANTAS
  ('RETRO DE LLANTAS','6.01','Excavación y cargue (ODT)'),
  ('RETRO DE LLANTAS','6.02','Rellenos con material seleccionado'),
  ('RETRO DE LLANTAS','2.09','Caminos y accesos'),
  ('RETRO DE LLANTAS','6.05','Excavación para tubería (06.05)'),
  ('RETRO DE LLANTAS','2.05','Paisajeo en excavación'),
  ('RETRO DE LLANTAS','2.03','Paisajeo en desmonte y limpieza'),
  -- RETROCARGADOR
  ('RETROCARGADOR','2.12','Muro de suelo reforzado'),
  ('RETROCARGADOR','2.09','Caminos y accesos'),
  ('RETROCARGADOR','2.07','Conformación de terraplén'),
  ('RETROCARGADOR','5.04','Extendido de material y sacos (MSR)'),
  ('RETROCARGADOR','2.08','Sobrantes (botadero / ZODME / RCD)'),
  ('RETROCARGADOR','7.01','Excavación de cunetas y paisajeo (ODL)'),
  ('RETROCARGADOR','6.05','Tubería de concreto de 900 mm'),
  ('RETROCARGADOR','7.03','Rellenos y paisajeo (ODL)'),
  ('RETROCARGADOR','2.06','Excavación de préstamo'),
  ('RETROCARGADOR','6.01','Excavación y manejo de aguas (ODT)'),
  ('RETROCARGADOR','6.02','Rellenos y paisajeo (ODT)'),
  ('RETROCARGADOR','11.04','Imprevistos (bloqueos - paros)'),
  ('RETROCARGADOR','5.05','Material granular drenante'),
  ('RETROCARGADOR','6.07','Concreto 14 MPa (solados)'),
  ('RETROCARGADOR','2.05','Paisajeo en excavación'),
  -- TRACTOCAMIONES
  ('TRACTOCAMIONES','11.01','PMT (plan de manejo de tráfico)'),
  ('TRACTOCAMIONES','2.05','Excavación en material común'),
  ('TRACTOCAMIONES','2.07','Traslado de compactador a terraplén'),
  ('TRACTOCAMIONES','3.03','Base estabilizada (BTC)'),
  ('TRACTOCAMIONES','2.03','Desmonte y limpieza'),
  ('TRACTOCAMIONES','2.1','Transporte de terraplén (100 m a 1 km)'),
  ('TRACTOCAMIONES','6.01','Excavaciones varias (ODT)'),
  ('TRACTOCAMIONES','3.02','Transporte de subbase (La Putana)'),
  ('TRACTOCAMIONES','4.03','Mezcla asfáltica MDC-25'),
  ('TRACTOCAMIONES','11.04','Imprevistos (bloqueos - paros)'),
  ('TRACTOCAMIONES','7.01','Excavaciones varias (ODL)'),
  ('TRACTOCAMIONES','6.04','Cargue de hierro'),
  ('TRACTOCAMIONES','5.04','Relleno para muros de tierra (MSR)'),
  ('TRACTOCAMIONES','6.02','Rellenos con material seleccionado'),
  -- TURBO / TURBO DE ESTACAS
  ('TURBO','I0408','Transporte de personal'),
  ('TURBO','11.01','PMT (plan de manejo de tráfico)'),
  ('TURBO','I0513','Montaje / desmontaje de campamentos'),
  ('TURBO DE ESTACAS','I0408','Transporte de personal'),
  -- VIBROCOMPACTADOR / VIBROCOMPACTADOR RENTAL 900
  ('VIBROCOMPACTADOR','2.07','Compactación de terraplén'),
  ('VIBROCOMPACTADOR','5.04','Compactación de terraplén en MSR'),
  ('VIBROCOMPACTADOR','3.01','Compactación de subbase'),
  ('VIBROCOMPACTADOR','2.12','Compactación en muro de suelo reforzado'),
  ('VIBROCOMPACTADOR','11.04','Imprevistos (bloqueos - paros)'),
  ('VIBROCOMPACTADOR','2.08','Compactación de sobrantes (ZODME / RCD)'),
  ('VIBROCOMPACTADOR RENTAL 900','2.07','Compactación de terraplén'),
  ('VIBROCOMPACTADOR RENTAL 900','3.01','Compactación de subbase'),
  -- VOLQUETAS DOBLETROQUE
  ('VOLQUETAS DOBLETROQUE','2.11','Transporte de terraplén (más de 1 km)'),
  ('VOLQUETAS DOBLETROQUE','3.02','Transporte de subbase granular'),
  ('VOLQUETAS DOBLETROQUE','11.04','Imprevistos (bloqueos - paros)'),
  ('VOLQUETAS DOBLETROQUE','2.1','Transporte de terraplén (100 m a 1 km)'),
  ('VOLQUETAS DOBLETROQUE','3.04','Cargue de BTC (La Putana)'),
  ('VOLQUETAS DOBLETROQUE','6.02','Transporte de material seleccionado (ODT)');

-- Guarda: dentro de un tipo no puede haber dos ítems con la misma frase (es justo lo que se corrige).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM canon GROUP BY tipo, lower(frase) HAVING count(*)>1) THEN
    RAISE EXCEPTION '010: frase repetida dentro de un tipo en la lista canon';
  END IF;
END $$;

-- Si ya corrió la 011 (tipos unificados y listas fusionadas), la 010 no vuelve a tocar nada: sus frases por
-- tipo viejo pisarían la elección de la 011 (p. ej. EXCAVADORA 06.02).
DELETE FROM canon WHERE EXISTS (SELECT 1 FROM esquema_version WHERE version=11);

-- veces acumulado de las filas ACTIVAS de cada (tipo, ítem) de la lista
CREATE TEMP TABLE suma ON COMMIT DROP AS
  SELECT p.obra_id, p.tipo_equipo, p.item, sum(coalesce(p.veces,0)) AS veces
  FROM parte_items p JOIN canon c ON c.tipo=p.tipo_equipo AND c.item=p.item
  WHERE upper(trim(p.activo)) NOT IN ('NO','N','FALSE','0','INACTIVO','INACTIVA')
  GROUP BY p.obra_id, p.tipo_equipo, p.item;

-- la frase canónica queda activa con el uso sumado (se crea si no existía)
INSERT INTO parte_items (obra_id, tipo_equipo, item, actividad, veces, activo)
  SELECT s.obra_id, s.tipo_equipo, s.item, c.frase, s.veces, 'SI'
  FROM suma s JOIN canon c ON c.tipo=s.tipo_equipo AND c.item=s.item
  ON CONFLICT (obra_id, tipo_equipo, item, actividad) DO UPDATE SET veces=EXCLUDED.veces, activo='SI';

-- las demás frases de ese ítem se apagan (no se borran)
UPDATE parte_items p SET activo='NO'
  FROM canon c
  WHERE c.tipo=p.tipo_equipo AND c.item=p.item AND p.actividad<>c.frase
    AND upper(trim(p.activo)) NOT IN ('NO','N','FALSE','0','INACTIVO','INACTIVA');

INSERT INTO esquema_version (version, nota)
  VALUES (10, '010_depurar_parte_items.sql · una frase por tipo+ítem en parte_items, V3-19')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
