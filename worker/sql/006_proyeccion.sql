-- =====================================================================================================
-- TM2 Sur · 4.01 — 006_proyeccion.sql · módulo de PROYECCIÓN editable en Galca (V3-11 Fase A / D183, sep-2026).
-- Se aplica DESPUÉS de 005_data_clima.sql. Idempotente: CREATE … IF NOT EXISTS, semillas que solo entran
-- si la obra no tiene NINGUNA fila en esa tabla (re-aplicar no pisa lo editado ni resucita lo borrado),
-- CREATE OR REPLACE VIEW con la misma definición y el mismo bloque DO de permisos. No transforma datos:
-- el banco y el sandbox la aplican una sola vez, con el resto de worker/sql/0*.sql.
-- Probado en PGlite (worker/pruebas/verificar_d183_proyeccion.mjs) y pensado para Postgres 16 (Supabase).
--
-- Qué pidió el dueño (D183): el PLAN mensual, el CONTRATO + línea base, los RENDIMIENTOS por equipo y el FC
-- dejan de vivir tecleados en el Excel (CALCULOS B/D/F/H/J 3:19, MAPEO I8:M16, MAPEO J27:N27 / CALCULOS
-- P1:T1, P4) y en constantes del tablero (CONTRATO, BASE_ACUM, BASE_CORTE, FC_DEFECTO de
-- tablero-produccion.js): se editan en Galca (pantalla proyeccion.html; editan admin y jefe, el residente
-- ve) y el Tablero los lee de aquí (GET ?action=proyeccion_tablero), con respaldo al Excel. La producción
-- diaria (hoja DATOS) y las horas de máquina (Excel de partes) siguen saliendo del Excel en esta fase.
-- La hoja PROYECCION 10+ NO entra.
--
--   #1 proy_plan         — plan mensual en m³ COMPACTOS por periodo 16→15 (CALCULOS A3:A19 × B/D/F/H/J).
--                          periodo = día 1 del mes en que CIERRA la ventana (la clave de CALCULOS!A y la
--                          'YYYY-MM' de leerPlan; coincide con el ACTA de `periodos`: 2026-09 = acta 23).
--                          excavacion = excavación TOTAL (aprov + préstamo + no aprov: lo que era DATOS D);
--                          noaprov ⊂ excavacion. NULL = celda vacía. formulas = {col:'=47724+3413'}: la
--                          fórmula que el jefe tecleó (las 12 del Excel se guardan con su VALOR; las que
--                          apuntan a celdas —'=+D16*1.2'— quedan como constancia, congeladas).
--   #2 proy_contrato     — cuadro «Programado» / «Produccion» de MAPEO I8:M16, compacto, por partida × UF.
--                          excavacion = excavación COMÚN (MAPEO I7); el préstamo va sin UF (uf='').
--                          produccion_base = la producción certificada hasta el CIERRE del acta base.
--   #3 proy_rendimiento  — rendimiento COMPACTO por equipo-día (MAPEO J27:N27 = 850/450/350/470). El
--                          «proyectado suelto equipo» de CALCULOS P1:T1 = rend × fc (se DERIVA).
--   #4 proy_parametros   — UNA fila por obra: fc ÚNICO (FC_DEFECTO del motor, MAPEO!B23) y acta_base (la
--                          línea base es la producción hasta el cierre de ese acta). El corte se DERIVA:
--                          periodos.fecha_final(acta_base) + 1 día; si el acta no está en `periodos`,
--                          date '2025-07-16' + (acta_base − 9) meses (acta 22 → 2026-08-16).
--   #5 vistas espejo (Power Query) con los encabezados literales del Excel: proyeccion_plan_maestro,
--      proyeccion_contrato_maestro, proyeccion_rendimiento_maestro, proyeccion_parametros_maestro.
--   #6 permisos: RLS activada en las 4 tablas (como las 33 de producción: sin políticas; el Worker entra
--      como dueño). Si existe tm2_lector_maestro → SELECT en las 4 vistas; si existen anon/authenticated
--      (Supabase) → REVOKE ALL de las 4 tablas, las 4 vistas y la secuencia, y también de data_maestro
--      (001/005, que no lo hacían): una vista corre con los permisos de su DUEÑO y se saltaría el RLS.
--      REGLA: toda migración futura que recree una *_maestro repite su bloque DO.
--
-- Todas las tablas llevan obra_id en la PK y el control optimista de 004: version (if_version en el
-- guardado), editado_por, editado_ts. version+1 en contrato/rendimiento/parámetros; en el plan, que tiene
-- alta y baja, la versión sale de la secuencia proy_plan_version_seq (sin ABA). Semillas = valores EXACTOS de
-- la copia del Excel del jefe (18-sep-2026): las sumas de contrato/base cuadran al céntimo con
-- CONTRATO/BASE_ACUM del tablero.
-- =====================================================================================================

BEGIN;

-- ---------------------------------------------------------------------------------------------------
-- #1 · proy_plan — plan mensual (CALCULOS A3:A19 × B/D/F/H/J)
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proy_plan (
  obra_id      text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  periodo      date NOT NULL CHECK (extract(day from periodo) = 1),
  excavacion   numeric CHECK (excavacion >= 0),
  terraplen    numeric CHECK (terraplen  >= 0),
  subbase      numeric CHECK (subbase    >= 0),
  base         numeric CHECK (base       >= 0),
  noaprov      numeric CHECK (noaprov    >= 0),
  formulas     jsonb   NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(formulas) = 'object'),
  version      integer NOT NULL DEFAULT 0,
  editado_por  text    NOT NULL DEFAULT '',
  editado_ts   timestamptz,
  PRIMARY KEY (obra_id, periodo)
);
COMMENT ON TABLE  proy_plan IS 'V3-11/D183 · plan mensual de la Proyección (CALCULOS A3:A19 × B/D/F/H/J), m³ COMPACTOS por periodo 16→15. Lo edita admin/jefe en proyeccion.html; lo lee el Tablero (proyeccion_tablero)';
COMMENT ON COLUMN proy_plan.periodo    IS 'día 1 del mes en que CIERRA la ventana 16→15 (clave de CALCULOS!A y de leerPlan; = ACTA de periodos: 2026-09 = acta 23)';
COMMENT ON COLUMN proy_plan.excavacion IS 'excavación TOTAL planificada (aprov + préstamo + no aprov; lo que era DATOS D). NULL = celda vacía';
COMMENT ON COLUMN proy_plan.noaprov    IS 'excavación NO aprovechable planificada (está DENTRO de excavacion). NULL = celda vacía';
COMMENT ON COLUMN proy_plan.formulas   IS '{columna: "=47724+3413"} — fórmula tecleada en la celda; el número guardado es su valor. Las del Excel que apuntan a celdas quedan congeladas como constancia';
-- Versión del plan (revisión D183): el alta y cada corrección toman `version` de esta secuencia, no de 0 /
-- version+1. El plan es la única tabla con alta y baja: así un periodo borrado y vuelto a crear nunca repite
-- una versión, y quien tenga la foto vieja choca (if_version) en vez de pisarlo sin aviso (ABA). Las semillas
-- quedan en 0; la secuencia arranca en 1. Las otras tres tablas solo se corrigen y siguen con version+1.
CREATE SEQUENCE IF NOT EXISTS proy_plan_version_seq AS integer;
COMMENT ON SEQUENCE proy_plan_version_seq IS 'V3-11/D183 · versiones de proy_plan (alta y update): nunca se repiten para un mismo periodo, aunque se borre y se vuelva a crear';
COMMENT ON COLUMN proy_plan.version IS 'control optimista (if_version): 0 en las semillas; cada alta/corrección toma nextval(proy_plan_version_seq)';

-- ---------------------------------------------------------------------------------------------------
-- #2 · proy_contrato — cuadro «Programado» / «Produccion» (MAPEO I8:M16)
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proy_contrato (
  obra_id          text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  partida          text NOT NULL CHECK (partida IN ('excavacion','terraplen','subbase','base','prestamo')),
  uf               text NOT NULL DEFAULT '' CHECK (uf IN ('UF1','UF2','')),
  programado       numeric CHECK (programado >= 0),
  produccion_base  numeric CHECK (produccion_base >= 0),
  orden            integer NOT NULL DEFAULT 0,
  version          integer NOT NULL DEFAULT 0,
  editado_por      text    NOT NULL DEFAULT '',
  editado_ts       timestamptz,
  PRIMARY KEY (obra_id, partida, uf),
  CHECK ((partida = 'prestamo') = (uf = ''))
);
COMMENT ON TABLE  proy_contrato IS 'V3-11/D183 · contrato programado y producción de la línea base por partida × UF (MAPEO I8:M16), m³ COMPACTOS. excavacion = excavación COMÚN; prestamo sin UF';
COMMENT ON COLUMN proy_contrato.produccion_base IS 'producción certificada hasta el CIERRE del acta base (proy_parametros.acta_base); el Tablero suma lo ejecutado desde el corte';

-- ---------------------------------------------------------------------------------------------------
-- #3 · proy_rendimiento — rendimiento compacto por equipo-día (MAPEO J27:N27; CALCULOS P1:T1 = rend × fc)
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proy_rendimiento (
  obra_id               text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  partida               text NOT NULL CHECK (partida IN ('excavacion','terraplen','subbase','base')),
  rend_compacto_equipo  numeric NOT NULL CHECK (rend_compacto_equipo > 0),
  orden                 integer NOT NULL DEFAULT 0,
  version               integer NOT NULL DEFAULT 0,
  editado_por           text    NOT NULL DEFAULT '',
  editado_ts            timestamptz,
  PRIMARY KEY (obra_id, partida)
);
COMMENT ON TABLE proy_rendimiento IS 'V3-11/D183 · rendimiento COMPACTO por equipo-día (MAPEO J27:N27). El «proyectado suelto equipo» (CALCULOS P1:T1) = rend × proy_parametros.fc; la vara por hora = rend / 8';

-- ---------------------------------------------------------------------------------------------------
-- #4 · proy_parametros — FC único y acta de la línea base (una fila por obra)
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proy_parametros (
  obra_id      text PRIMARY KEY DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  fc           numeric NOT NULL CHECK (fc > 0),
  acta_base    text    NOT NULL CHECK (btrim(acta_base) <> ''),
  version      integer NOT NULL DEFAULT 0,
  editado_por  text    NOT NULL DEFAULT '',
  editado_ts   timestamptz
);
COMMENT ON TABLE  proy_parametros IS 'V3-11/D183 · parámetros de la Proyección: FC ÚNICO suelto→compacto (FC_DEFECTO del tablero, MAPEO!B23) y acta de la línea base';
COMMENT ON COLUMN proy_parametros.acta_base IS 'la línea base (proy_contrato.produccion_base) es la producción hasta el CIERRE de este acta. Corte = periodos.fecha_final + 1 día (respaldo: 2025-07-16 + (acta − 9) meses)';

-- ---------------------------------------------------------------------------------------------------
-- RLS como en producción (las 33 tablas la tienen activada, sin políticas): nadie por la API REST de
-- Supabase; el Worker entra como DUEÑO y no le afecta. Re-aplicarlo no cambia nada.
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE proy_plan        ENABLE ROW LEVEL SECURITY;
ALTER TABLE proy_contrato    ENABLE ROW LEVEL SECURITY;
ALTER TABLE proy_rendimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE proy_parametros  ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------------------------------
-- SEMILLAS — valores EXACTOS de la copia del Excel del jefe. Cada tabla se siembra SOLO si la obra no
-- tiene ninguna fila en ella: re-aplicar 006 no pisa lo editado ni resucita una fila borrada.
-- ---------------------------------------------------------------------------------------------------
-- Plan: CALCULOS A3:A19 × B(EXCAVACION) D(TERRAPLEN) F(SUBBASE) H(BASE) J(NO APROV). Vacías → NULL
-- (H6, B19, D19, J19); H3:H5 traen 0. Las 12 celdas con fórmula (B5, D5, B6, D6, D15, J15, B16, J16,
-- B17, J17, B18, J18) guardan su valor sin ruido de coma flotante (38848.799999999996 → 38848.8).
INSERT INTO proy_plan (obra_id, periodo, excavacion, terraplen, subbase, base, noaprov, formulas)
SELECT 'tm2sur', v.periodo::date, v.excavacion::numeric, v.terraplen::numeric, v.subbase::numeric,
       v.base::numeric, v.noaprov::numeric, v.formulas::jsonb
FROM (VALUES
  ('2025-08-01', 38939,   34328, 7758,  0,    2251,    '{}'),
  ('2025-09-01', 54617,   33531, 14003, 0,    5784,    '{}'),
  ('2025-10-01', 51137,   32565, 8218,  0,    6182,    '{"excavacion":"=47724+3413","terraplen":"=24120+5669+1401+1375"}'),
  ('2025-11-01', 51137,   32565, 8218,  NULL, 6182,    '{"excavacion":"=47724+3413","terraplen":"=24120+5669+1401+1375"}'),
  ('2025-12-01', 31639,   25515, 4758,  4142, 2654,    '{}'),
  ('2026-01-01', 31639,   25515, 4758,  4142, 2650,    '{}'),
  ('2026-02-01', 51640,   45516, 4759,  4143, 5700,    '{}'),
  ('2026-03-01', 51640,   45516, 4759,  4143, 5700,    '{}'),
  ('2026-04-01', 51641,   45517, 4760,  4144, 5701,    '{}'),
  ('2026-05-01', 51642,   45518, 4761,  4145, 5702,    '{}'),
  ('2026-06-01', 60000,   45000, 6600,  7200, 5703,    '{}'),
  ('2026-07-01', 60000,   45000, 6600,  7200, 5703,    '{}'),
  ('2026-08-01', 35000,   24500, 6600,  4500, 7000,    '{"terraplen":"=+B15*0.7","noaprov":"=+B15*0.2"}'),
  ('2026-09-01', 24495.6, 20413, 3913,  5016, 4899.12, '{"excavacion":"=+D16*1.2","noaprov":"=+B16*0.2"}'),
  ('2026-10-01', 38848.8, 32374, 5537,  6485, 7769.76, '{"excavacion":"=+D17*1.2","noaprov":"=+B17*0.2"}'),
  ('2026-11-01', 48148.8, 40124, 11102, 6111, 9629.76, '{"excavacion":"=+D18*1.2","noaprov":"=+B18*0.2"}'),
  ('2026-12-01', NULL,    NULL,  740,   6694, NULL,    '{}')
) AS v(periodo, excavacion, terraplen, subbase, base, noaprov, formulas)
WHERE NOT EXISTS (SELECT 1 FROM proy_plan WHERE obra_id = 'tm2sur');

-- Contrato: MAPEO I8:J14 (Programado UF1/UF2) y L8:M14 (Produccion UF1/UF2); préstamo I16 / L16 sin UF.
-- Sumas UF1+UF2 = CONTRATO / BASE_ACUM del tablero: 747202.97 / 665465.73 / 84203.87 / 92573.49 / 168462
-- y 549153.95 / 385854.98 / 46523.83 / 38103.26 / 51895.
INSERT INTO proy_contrato (obra_id, partida, uf, programado, produccion_base, orden)
SELECT 'tm2sur', v.partida, v.uf, v.programado::numeric, v.produccion_base::numeric, v.orden
FROM (VALUES
  ('excavacion', 'UF1', 685847.33, 515625.66, 1),
  ('excavacion', 'UF2', 61355.64,  33528.29,  2),
  ('terraplen',  'UF1', 403447.41, 229229.98, 3),
  ('terraplen',  'UF2', 262018.32, 156625,    4),
  ('subbase',    'UF1', 53167.2,   32802,     5),
  ('subbase',    'UF2', 31036.67,  13721.83,  6),
  ('base',       'UF1', 58805.7,   29700,     7),
  ('base',       'UF2', 33767.79,  8403.26,   8),
  ('prestamo',   '',    168462,    51895,     9)
) AS v(partida, uf, programado, produccion_base, orden)
WHERE NOT EXISTS (SELECT 1 FROM proy_contrato WHERE obra_id = 'tm2sur');

-- Rendimiento compacto por equipo-día: MAPEO J27 / K27 / L27 / N27 (= CALCULOS P1:T1 ÷ 1.3).
INSERT INTO proy_rendimiento (obra_id, partida, rend_compacto_equipo, orden)
SELECT 'tm2sur', v.partida, v.rend::numeric, v.orden
FROM (VALUES ('excavacion', 850, 1), ('terraplen', 450, 2), ('subbase', 350, 3), ('base', 470, 4)
) AS v(partida, rend, orden)
WHERE NOT EXISTS (SELECT 1 FROM proy_rendimiento WHERE obra_id = 'tm2sur');

-- Parámetros: FC 1.3 (CALCULOS P4 = MAPEO!B23 = FC_DEFECTO) y acta base 22 (corte 2026-08-16 = BASE_CORTE).
INSERT INTO proy_parametros (obra_id, fc, acta_base)
SELECT 'tm2sur', 1.3, '22'
WHERE NOT EXISTS (SELECT 1 FROM proy_parametros WHERE obra_id = 'tm2sur');

-- ---------------------------------------------------------------------------------------------------
-- #5 · VISTAS ESPEJO para Power Query (encabezados LITERALES del Excel). Sin version/editado_*: solo negocio.
-- CREATE OR REPLACE solo deja AÑADIR columnas al final: renombrar/reordenar exige DROP + CREATE y repetir
-- el bloque DO de abajo (el DROP se lleva los GRANT).
-- ---------------------------------------------------------------------------------------------------
-- Plan: CALCULOS A1 periodo · B1 EXCAVACION · D1 TERRAPLEN · F1 SUBBASE · H1 BASE · J1 NO APROV + ACTA
-- (nueva, al final): el acta cuyo CIERRE (fecha_final) cae en ese mes; si no está en `periodos`, la
-- fórmula (año − 2025)·12 + mes + 2 (2025-08 → 10 … 2026-12 → 26); antes del acta 1, NULL.
CREATE OR REPLACE VIEW proyeccion_plan_maestro AS
SELECT pl.obra_id,
  pl.periodo    AS periodo,
  pl.excavacion AS "EXCAVACION",
  pl.terraplen  AS "TERRAPLEN",
  pl.subbase    AS "SUBBASE",
  pl.base       AS "BASE",
  pl.noaprov    AS "NO APROV",
  COALESCE(
    (SELECT p.acta FROM periodos p
      WHERE p.obra_id = pl.obra_id AND p.fecha_final >= pl.periodo AND p.fecha_final < (pl.periodo + interval '1 month')
      ORDER BY p.fecha_final LIMIT 1),
    CASE WHEN (extract(year from pl.periodo)::int - 2025) * 12 + extract(month from pl.periodo)::int + 2 >= 1
         THEN ((extract(year from pl.periodo)::int - 2025) * 12 + extract(month from pl.periodo)::int + 2)::text END
  ) AS "ACTA"
FROM proy_plan pl;
COMMENT ON VIEW proyeccion_plan_maestro IS 'ESPEJO de CALCULOS A:J (plan) para Power Query · V3-11/D183: periodo (date) · EXCAVACION · TERRAPLEN · SUBBASE · BASE · NO APROV (compactos; NULL = vacía) · ACTA';

-- Contrato: MAPEO I7/I9/I11/I13/I15 (etiquetas literales) · Programado UF1/UF2 (I/J) y total · Produccion
-- UF1/UF2 (L/M) y total. El préstamo va en las columnas UF1 (como I16/L16, combinadas) y en el total.
CREATE OR REPLACE VIEW proyeccion_contrato_maestro AS
SELECT c.obra_id,
  CASE c.partida WHEN 'excavacion' THEN 'Excavacion comun' WHEN 'terraplen' THEN 'Terraplen'
                 WHEN 'subbase' THEN 'Subbase' WHEN 'base' THEN 'BTC' WHEN 'prestamo' THEN 'Excavacion Prestamos' END AS "PARTIDA",
  sum(c.programado)      FILTER (WHERE c.uf IN ('UF1','')) AS "Programado UF1",
  sum(c.programado)      FILTER (WHERE c.uf = 'UF2')       AS "Programado UF2",
  sum(c.programado)                                        AS "Programado",
  sum(c.produccion_base) FILTER (WHERE c.uf IN ('UF1','')) AS "Produccion UF1",
  sum(c.produccion_base) FILTER (WHERE c.uf = 'UF2')       AS "Produccion UF2",
  sum(c.produccion_base)                                   AS "Produccion"
FROM proy_contrato c
GROUP BY c.obra_id, c.partida
ORDER BY c.obra_id, min(c.orden);
COMMENT ON VIEW proyeccion_contrato_maestro IS 'ESPEJO de MAPEO I7:M16 para Power Query · V3-11/D183: PARTIDA (etiquetas del Excel) · Programado UF1/UF2/total · Produccion UF1/UF2/total (compactos; préstamo en UF1)';

-- Rendimiento: traspuesta como CALCULOS O1:T4 (columna O = concepto; P EXCAVACION, Q TERRAPLEN, R SUBBASE,
-- T BASE). Filas: 'proyectado suelto equipo' (= rend × fc: lo que lee leerProyectado), 'rend. compacto por
-- equipo' y 'fc'.
CREATE OR REPLACE VIEW proyeccion_rendimiento_maestro AS
SELECT r.obra_id,
  x.concepto AS "concepto",
  max(CASE WHEN r.partida = 'excavacion' THEN x.v END) AS "EXCAVACION",
  max(CASE WHEN r.partida = 'terraplen'  THEN x.v END) AS "TERRAPLEN",
  max(CASE WHEN r.partida = 'subbase'    THEN x.v END) AS "SUBBASE",
  max(CASE WHEN r.partida = 'base'       THEN x.v END) AS "BASE"
FROM proy_rendimiento r
JOIN proy_parametros pa ON pa.obra_id = r.obra_id
CROSS JOIN LATERAL (VALUES (1, 'proyectado suelto equipo',  r.rend_compacto_equipo * pa.fc),
                           (2, 'rend. compacto por equipo', r.rend_compacto_equipo),
                           (3, 'fc',                        pa.fc)) AS x(orden, concepto, v)
GROUP BY r.obra_id, x.orden, x.concepto
ORDER BY r.obra_id, x.orden;
COMMENT ON VIEW proyeccion_rendimiento_maestro IS 'ESPEJO de CALCULOS O1:T4 para Power Query · V3-11/D183: concepto (proyectado suelto equipo = rend × fc · rend. compacto por equipo · fc) × EXCAVACION/TERRAPLEN/SUBBASE/BASE';

-- Parámetros: FC · ACTA BASE · CORTE BASE (= fecha_final del acta + 1 día; respaldo 2025-07-16 + (acta − 9) meses).
CREATE OR REPLACE VIEW proyeccion_parametros_maestro AS
SELECT pa.obra_id,
  pa.fc        AS "FC",
  pa.acta_base AS "ACTA BASE",
  COALESCE(
    (SELECT p.fecha_final + 1 FROM periodos p WHERE p.obra_id = pa.obra_id AND p.acta = pa.acta_base),
    CASE WHEN pa.acta_base ~ '^[0-9]{1,4}$'
         THEN (date '2025-07-16' + make_interval(months => pa.acta_base::int - 9))::date END
  ) AS "CORTE BASE"
FROM proy_parametros pa;
COMMENT ON VIEW proyeccion_parametros_maestro IS 'ESPEJO de los parámetros de la Proyección · V3-11/D183: FC (único) · ACTA BASE · CORTE BASE (date: día siguiente al cierre del acta base)';

-- ---------------------------------------------------------------------------------------------------
-- #6 · permisos. tm2_lector_maestro (roles_lectura_maestro.sql, a mano en Supabase) SOLO lee las vistas;
-- anon/authenticated (roles de la API REST de Supabase) no ven ni las tablas ni las vistas (tampoco
-- data_maestro): la vista corre como su DUEÑO y saltaría el RLS. En PGlite/el banco no existe ninguno de los
-- tres y el bloque no hace nada.
-- REGLA (D183): toda migración futura que recree una *_maestro repite este bloque.
-- ---------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm2_lector_maestro') THEN
    GRANT SELECT ON proyeccion_plan_maestro, proyeccion_contrato_maestro,
                    proyeccion_rendimiento_maestro, proyeccion_parametros_maestro TO tm2_lector_maestro;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON proy_plan, proy_contrato, proy_rendimiento, proy_parametros,
                  proyeccion_plan_maestro, proyeccion_contrato_maestro,
                  proyeccion_rendimiento_maestro, proyeccion_parametros_maestro FROM anon;
    REVOKE ALL ON SEQUENCE proy_plan_version_seq FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON proy_plan, proy_contrato, proy_rendimiento, proy_parametros,
                  proyeccion_plan_maestro, proyeccion_contrato_maestro,
                  proyeccion_rendimiento_maestro, proyeccion_parametros_maestro FROM authenticated;
    REVOKE ALL ON SEQUENCE proy_plan_version_seq FROM authenticated;
  END IF;
  -- data_maestro (001, recreada por 005 · D181/D182) es la otra *_maestro y tampoco se le quitaba nada a
  -- anon/authenticated: 005 la RECREA (DROP + CREATE) y los privilegios por defecto de Supabase se la vuelven a
  -- dar. Esta vista corre como su dueño y expondría la tabla `data` saltándose el RLS. Se cierra aquí, que va
  -- justo después de 005, sin reescribir D182 (revisión D183).
  IF to_regclass('public.data_maestro') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE ALL ON data_maestro FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      REVOKE ALL ON data_maestro FROM authenticated;
    END IF;
  END IF;
END $$;

INSERT INTO esquema_version (version, nota)
  VALUES (6, '006_proyeccion.sql · D183 (V3-11 Fase A): proy_plan/proy_contrato/proy_rendimiento/proy_parametros (RLS, version/editado_*) sembradas del Excel + secuencia proy_plan_version_seq + 4 vistas proyeccion_*_maestro; REVOKE a anon/authenticated también en data_maestro')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
