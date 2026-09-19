-- =====================================================================================================
-- TM2 Sur · 4.01 — 008_tablero_vivo.sql · el Tablero EN VIVO desde la DATA de Galca (V3-11 Fases B+C · D185, sep-2026).
-- Se aplica DESPUÉS de 007_data_completa.sql. Idempotente: CREATE … IF NOT EXISTS, CREATE OR REPLACE VIEW con la
-- misma definición, semillas que no resucitan lo borrado (como 007), el mismo bloque DO de permisos y ON CONFLICT
-- en esquema_version. No transforma datos: el banco y el sandbox la aplican una sola vez, con el resto de
-- worker/sql/0*.sql. Probado en PGlite (worker/pruebas/verificar_d185_tablero_vivo.mjs y casos_sql.js) y pensado
-- para Postgres 16 (Supabase).
--
-- Qué decidió el dueño (D185, 18-sep-2026) — «la DATA en línea que actualice plenamente el Tablero»:
--   (1) el Tablero deja de leer la hoja DATOS del Excel: TODA la producción (todos los periodos) sale de la DATA
--       de Galca, plegada por FECHA y por campo con el MAPEO de siempre (MAPEO A2:C10 del Excel del jefe);
--   (2) vivo para todos: cada apertura del Tablero (también el enlace público de los directivos) lo calcula con
--       la DATA de Galca (GET ?action=tablero_vivo, público, ampliación de D161; caché de 60 s en el Worker);
--   (3) decisión final (19-sep-2026): el AVANCE contra el contrato sigue como en la Proyección = producción base
--       certificada (hasta el cierre del acta base) + Σ de la DATA con fecha ≥ el corte, ÷ contrato; lo calcula el
--       motor en el navegador (esta migración no lo toca); (4) en esa suma, excavación común = APROVECHABLE + NO
--       APROVECHABLE (así la certifica el acta);
--   (5) las horas de máquina siguen saliendo del libro de partes, pero se cargan UNA vez y quedan en Galca;
--   (6) la Proyección NO lleva conciliación DATA ↔ producción base (se quitó, 19-sep-2026).
--
--   #1 tablero_mapeo       — qué DESCRIPCIÓN de DATA (texto de la BASE) va a qué CAMPO del Tablero, por UF:
--                            apr/pre/nap = excavación aprovechable / préstamo / no aprovechable (cualquier UF,
--                            '*'), ter/sub/bas = terraplén / subbase / base granular estabilizada (UF1 y UF2 por
--                            separado, como las columnas K/L, O/P y S/T de la hoja DATOS). El cruce con DATA es
--                            por descripción NORMALIZADA (normTexto de comun.js, la misma expresión que 007) y por
--                            UF; una fila con UF concreta gana a la de '*' si las dos casan. Semillas = las 9 filas
--                            de MAPEO A2:C10, texto verbatim de BASE.
--   #2 tablero_horas       — UNA fila por obra con la salida CRUDA de leerHoras del motor del Tablero
--                            ({partes, cc, corte, descartadas, negativas}: horas por máquina y CC, SIN nombres de
--                            personas) que admin/jefe suben al elegir el libro de partes (POST
--                            tablero_horas_guardar). Se guarda COMPRIMIDA como la foto de `tablero`
--                            ({z:<gzip en base64>}: la salida real pesa ~340 KB y comprimida ~20 KB; el write
--                            grande al pooler de Supabase es lo que tumbaba la foto, 16-sep-2026).
--   #3 vista tablero_data_campo — cada fila de DATA con su CANTIDAD compacta (la de la fila, que ya respeta su FC y
--                            su espesor; si está vacía, LARGO × COALESCE(espesor,1) ÷ COALESCE(NULLIF(fc,0),1): un
--                            RESPALDO con FC vacío = 1, NO la regla de la Revisión de DATA —esa usa el FC de la
--                            actividad, fc_actividad de 007—; solo cuenta en filas con LARGO y sin CANTIDAD, que 007
--                            rellena: tras un backfill desde el .gs se re-aplica 007 antes de dar la cifra por buena,
--                            OPERACIONES §12/§16) y el CAMPO que le da tablero_mapeo (NULL = no es del
--                            Tablero). La lee el pliegue del Tablero en vivo (worker/src/api/obra/pliegue.js):
--                            una sola definición del cruce, sumas en numeric.
--   #4 permisos: RLS en las dos tablas (sin políticas; el Worker entra como dueño) y REVOKE a anon/authenticated
--      de las tablas y de la vista (una vista corre como su DUEÑO y se saltaría el RLS). No es una *_maestro:
--      tm2_lector_maestro no la ve.
--   #5 esquema_version 8.
-- =====================================================================================================

BEGIN;

-- ---------------------------------------------------------------------------------------------------
-- #1 · tablero_mapeo (MAPEO A2:C10)
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tablero_mapeo (
  obra_id      text    NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  descripcion  text    NOT NULL CHECK (btrim(descripcion) <> ''),
  uf           text    NOT NULL CHECK (uf IN ('*','UF1','UF2')),
  campo        text    NOT NULL CHECK (campo IN ('apr','pre','nap','ter','sub','bas')),
  orden        integer NOT NULL DEFAULT 0,
  version      integer NOT NULL DEFAULT 0,
  editado_por  text    NOT NULL DEFAULT '',
  editado_ts   timestamptz,
  PRIMARY KEY (obra_id, descripcion, uf)
);
COMMENT ON TABLE  tablero_mapeo IS 'V3-11/D185 · MAPEO A2:C10 del Excel: descripción de DATA (verbatim BASE) × UF → campo del Tablero (apr/pre/nap/ter/sub/bas). Cruce por descripción normalizada (normTexto); UF concreta gana a ''*''';
COMMENT ON COLUMN tablero_mapeo.uf    IS '''*'' = cualquier UF (excavación aprovechable / préstamo / no aprovechable); UF1 / UF2 = la columna de esa UF (terraplén, subbase, base: K/L, O/P, S/T de DATOS)';
COMMENT ON COLUMN tablero_mapeo.campo IS 'apr = VOLUMEN APROV. · pre = VOLUMEN PRESTAMO · nap = NO APROV · ter = TERRAPLEN · sub = SUBBASE · bas = BASE (columnas F/G/H, K+L, O+P, S+T de la hoja DATOS)';

-- ---------------------------------------------------------------------------------------------------
-- #2 · tablero_horas (una fila por obra)
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tablero_horas (
  obra_id      text    PRIMARY KEY DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  horas        jsonb   NOT NULL CHECK (jsonb_typeof(horas) = 'object'),
  archivo      text    NOT NULL DEFAULT '',
  cargado_por  text    NOT NULL DEFAULT '',
  cargado_ts   timestamptz,
  version      integer NOT NULL DEFAULT 0
);
COMMENT ON TABLE  tablero_horas IS 'V3-11/D185 · horas de máquina del Tablero: la salida CRUDA de leerHoras (libro de partes, hoja BASE MAQUINARIA), cargada UNA vez por admin/jefe (POST tablero_horas_guardar) y leída por todos en GET tablero_vivo';
COMMENT ON COLUMN tablero_horas.horas IS '{z:<gzip en base64>} de {partes:[{p,f,act,cod,tipo,uf,h,mtto,varada,lluvia,averia}], cc:[{cc,horas,filas,act,flota}], corte, descartadas, negativas} (sin nombres de personas). Un objeto sin z se lee tal cual';
COMMENT ON COLUMN tablero_horas.cargado_por IS 'usuario del token que subió el libro (NO sale en la lectura pública)';

-- ---------------------------------------------------------------------------------------------------
-- #3 · vista tablero_data_campo — cada fila de DATA con su cantidad compacta y su campo del Tablero
--   norm(x) = normTexto de comun.js, la MISMA expresión que 007: 7 espacios raros → ' ', tildes/ñ (minúsculas y
--   MAYÚSCULAS) → sin tilde ANTES de upper() (no depende del locale), espacios colapsados y recortados.
--   UF de la fila = unidad_funcional sin espacios y en MAYÚSCULAS ('uf 1' → 'UF1').
--   El mapeo va MATERIALIZED (9 filas, normalizadas una vez por consulta) y cada fila de DATA toma UNA fila de
--   él: la de su UF antes que la de '*', luego por orden (nunca cuenta dos veces).
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW tablero_data_campo AS
WITH m AS MATERIALIZED (
  SELECT mp.obra_id, mp.campo, mp.uf, mp.orden, mp.descripcion,
         upper(btrim(regexp_replace(
           translate(mp.descripcion,
             E'   ​‌‍﻿áàâäéèêëíìîïóòôöúùûüñÁÀÂÄÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜÑ',
             '       aaaaeeeeiiiioooouuuunAAAAEEEEIIIIOOOOUUUUN'),
           '\s+', ' ', 'g'))) AS k
    FROM tablero_mapeo mp
)
SELECT d.obra_id, d.fecha, d.id_registro, d.uf,
       coalesce(d.cantidad, d.largo * coalesce(d.espesor, 1) / coalesce(nullif(d.fc, 0), 1)) AS cantidad,
       x.campo
  FROM (SELECT dd.obra_id, dd.fecha, dd.id_registro, dd.cantidad, dd.largo, dd.espesor, dd.fc,
               upper(regexp_replace(dd.unidad_funcional, '\s', '', 'g')) AS uf,
               upper(btrim(regexp_replace(
                 translate(dd.descripcion,
                   E'   ​‌‍﻿áàâäéèêëíìîïóòôöúùûüñÁÀÂÄÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜÑ',
                   '       aaaaeeeeiiiioooouuuunAAAAEEEEIIIIOOOOUUUUN'),
                 '\s+', ' ', 'g'))) AS k
          FROM data dd) d
  LEFT JOIN LATERAL (
    SELECT m.campo FROM m
     WHERE m.obra_id = d.obra_id AND m.k = d.k AND (m.uf = '*' OR m.uf = d.uf)
     ORDER BY (m.uf = '*'), m.orden, m.descripcion
     LIMIT 1) x ON true;
COMMENT ON VIEW tablero_data_campo IS 'V3-11/D185 · cada fila de DATA con su CANTIDAD compacta (la de la fila; vacía → largo·espesor/fc con FC vacío = 1, respaldo hasta re-aplicar 007) y el CAMPO del Tablero según tablero_mapeo (NULL = no es del Tablero). La lee el Tablero en vivo';

-- ---------------------------------------------------------------------------------------------------
-- #4 · permisos: RLS como las demás tablas (sin políticas) y nada para la API REST de Supabase
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE tablero_mapeo ENABLE ROW LEVEL SECURITY;
ALTER TABLE tablero_horas ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON tablero_mapeo, tablero_horas, tablero_data_campo FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON tablero_mapeo, tablero_horas, tablero_data_campo FROM authenticated;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------
-- SEMILLAS — MAPEO A2:C10 de la copia del Excel del jefe (18-sep-2026): columna A (la de DATOS) → campo,
-- B (descripción verbatim de la BASE), C (UF). Solo la PRIMERA vez que se aplica 008 (guarda = esquema_version
-- aún sin la 8) y solo las que no existan: re-aplicar 008 no pisa un mapeo editado NI resucita una fila borrada.
-- ---------------------------------------------------------------------------------------------------
INSERT INTO tablero_mapeo (obra_id, descripcion, uf, campo, orden)
SELECT 'tm2sur', v.descripcion, v.uf, v.campo, v.orden
FROM (VALUES
  ('Excavaciones en material común APROVECHABLE',                 '*',   'apr', 1),   -- A2 · F  VOLUMEN APROV.
  ('Excavación en material común de préstamos',                   '*',   'pre', 2),   -- A3 · G  VOLUMEN PRESTAMO
  ('Excavaciones en material común NO APROVECHABLE',              '*',   'nap', 3),   -- A4 · H  NO APROV
  ('Terraplenes (solo conformación)',                             'UF1', 'ter', 4),   -- A5 · K  TERRAPLEN UF1
  ('Terraplenes (solo conformación)',                             'UF2', 'ter', 5),   -- A6 · L  TERRAPLEN UF2
  ('Subbase Granular',                                            'UF1', 'sub', 6),   -- A7 · O  SUBBASE UF1
  ('Subbase Granular',                                            'UF2', 'sub', 7),   -- A8 · P  SUBBASE UF2
  ('Base granular estabilizada con cemento (No incluye cemento)', 'UF1', 'bas', 8),   -- A9 · S  BASE UF1
  ('Base granular estabilizada con cemento (No incluye cemento)', 'UF2', 'bas', 9)    -- A10 · T BASE UF2
) AS v(descripcion, uf, campo, orden)
WHERE NOT EXISTS (SELECT 1 FROM esquema_version WHERE version = 8)
  AND NOT EXISTS (SELECT 1 FROM tablero_mapeo t WHERE t.obra_id = 'tm2sur' AND t.descripcion = v.descripcion AND t.uf = v.uf);

-- ---------------------------------------------------------------------------------------------------
-- #5 · esquema_version
-- ---------------------------------------------------------------------------------------------------
INSERT INTO esquema_version (version, nota)
  VALUES (8, '008_tablero_vivo.sql · D185 (V3-11 Fases B+C): tablero_mapeo (MAPEO A2:C10, 9 semillas que no resucitan) + tablero_horas (salida de leerHoras, comprimida) + vista tablero_data_campo (DATA → campo del Tablero, cantidad compacta); RLS y REVOKE a anon/authenticated')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
