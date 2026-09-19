-- =====================================================================================================
-- TM2 Sur · 4.01 — 007_data_completa.sql · DATA completa: ACTA de la fecha y FC por actividad (D184, sep-2026).
-- Se aplica DESPUÉS de 006_proyeccion.sql y, como 005, CON LOS DATOS YA CARGADOS (rellena DATA). Idempotente:
-- CREATE … IF NOT EXISTS, semillas que no resucitan lo borrado, un relleno que SOLO escribe donde falta (la
-- segunda pasada no encuentra nada que rellenar), el mismo bloque DO de permisos y ON CONFLICT en
-- esquema_version. El banco (worker/pruebas/contrato_local.js) y el sandbox (tools/sandbox/servidor.mjs) la
-- vuelven a pasar después de cargar la DATA, igual que 005 (MIGRACIONES_DE_DATOS). Probado en PGlite
-- (worker/pruebas/casos_sql.js) y pensado para Postgres 16 (Supabase).
-- En PRODUCCIÓN se pasa DOS veces en el despliegue de D184 (docs/OPERACIONES.md §12): una ANTES del front y del
-- `wrangler deploy` (el Worker nuevo sin fc_actividad trataría todo como FC 1, y ese FC escrito esta migración ya
-- no lo rellena; con el Worker viejo es inocua) y otra después, tras 005 y 006. Tras un backfill de DATA se
-- repiten 005, 006 y 007, en ese orden (006 vuelve a cerrar data_maestro a anon/authenticated).
--
-- Qué decidió el dueño (D184, 18-sep-2026). Con la DATA viva en la BD (Power Query lee data_maestro) las
-- fórmulas de la hoja DATA del Excel (M = ACTA, P/Q/R = ESPESOR/FC/CANTIDAD) ya no calculan nada: la app
-- tiene que dejar cada fila COMPLETA.
--   (a) ACTA = la del periodo 16→15 en que cae la FECHA: tabla `periodos` (004) y, si la fecha cae fuera de
--       ella (2027+), la fórmula: mes de cierre = el de la fecha si el día ≤ 15, si no el siguiente;
--       acta = (año_cierre − 2025)·12 + mes_cierre + 2 (10 = 2025-07-16..08-15 · 23 = 2026-08-16..09-15 ·
--       24 = 2026-09-16..10-15); si da < 1 → '' (las fechas de BANCO de 2020 quedan sin acta). Es la misma
--       regla que actaDeFecha (worker/src/api/obra/periodos.js) y que la columna "ACTA" de
--       proyeccion_plan_maestro (006) para el mes en que cierra el periodo.
--   (b) ESPESOR = 1 por defecto (la app no lo captura). FC = el de la ACTIVIDAD: el MÁS USADO en el histórico
--       de DATA del Excel (4.476 filas; lo que no cuadra son errores de digitación): 1.3 en las 7 descripciones
--       de abajo (verbatim de la hoja BASE / base_items), 1 en todo lo demás (drenajes, concretos, acero,
--       pedraplén, rellenos, desmonte —en Ha desde D58—, transportes…). CANTIDAD = LARGO × ESPESOR ÷ FC.
--   (c) Un reenvío del encargado/residente sobre un día que el jefe ya corrigió en la Revisión de DATA pisa
--       esa corrección: es COMPORTAMIENTO ACEPTADO (lo reenvían ellos después de revisar; lo que mandan es su
--       versión nueva). Esta migración no lo toca.
--
--   #1 tabla fc_actividad — FC por DESCRIPCIÓN de actividad. Tabla PROPIA (no una columna de base_items) para
--      que un backfill del catálogo BASE no la borre. Sin fila = FC 1. fc en (0, 3]. version/editado_por/
--      editado_ts como las tablas editables de 004/006 (control optimista si algún día se edita en Galca).
--      El cruce con DATA es por descripción NORMALIZADA como normTexto (comun.js): espacios raros → ' ',
--      tildes/ñ fuera, MAYÚSCULAS, espacios colapsados y recortados.
--   #2 RLS activada (sin políticas; el Worker entra como dueño) y REVOKE a anon/authenticated si existen.
--   #3 semillas: las 7 de FC 1.3, con el conteo del histórico en `nota`. Entran SOLO la primera vez que se
--      aplica 007 (guarda = esquema_version aún sin la 7), y fila a fila solo si no existe: re-aplicar 007 no
--      pisa un FC editado NI resucita una fila borrada — ni siquiera si se borran las 7 (más estricto que la
--      guarda «tabla vacía» de 006, que sí re-siembra una tabla vaciada entera).
--   #4 relleno de DATA SOLO donde falta, NUNCA pisa un valor (obra tm2sur: la fórmula de respaldo es SU
--      numeración de actas):
--        · acta ''                          → la acta de la fecha (a) (si da '', se queda '')
--        · con largo NOT NULL: espesor NULL → 1
--                              fc NULL      → fc_actividad de su descripción, o 1
--                              cantidad NULL → round(largo · espesor ÷ fc, 6)   (fc 0 escrito a mano → ÷ 1,
--                                              como la Revisión de DATA)
--        · version + 1 UNA sola vez en cada fila que cambia (un solo UPDATE, como 005): una pantalla abierta
--          con la fila vieja choca por if_version y recarga. Una fila sin nada que rellenar no se toca.
--      D185 [O] (enmienda de D184, decisión del dueño del 18-sep-2026) — FC 1 en los «AJUSTE ORIGEN»: las filas
--      cuyo ELEMENTO es un subtramo NO OPERATIVO de base_elementos (los dos «ajuste origen UF1/UF2»: bandera
--      no_operativo de 003, cruce por elemento normalizado; respaldo por nombre ^ajuste origen, como
--      esNoOperativo_ de grilla.js) son la acomodación directa con el origen y YA están en compacto:
--        · relleno: con largo, fc NULL → 1 (no el FC de la actividad);
--        · corrección (esta sí pisa, y es idempotente): fc ≠ 1 → fc = 1 y, con largo, cantidad =
--          round(largo · coalesce(espesor, 1), 6) (el Excel trae FC 1,3 por error en las 5 de UF2). En la misma
--          pasada y con el mismo version+1 una sola vez; la segunda pasada ya no encuentra nada.
--        Mismas reglas en enviar_data (completarD184_) y en la Revisión de DATA (derivar_): fcDeFila de catalogos.js.
--   #5 esquema_version 7.
-- =====================================================================================================

BEGIN;

-- ---------------------------------------------------------------------------------------------------
-- #1 · fc_actividad
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fc_actividad (
  obra_id      text    NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  descripcion  text    NOT NULL,
  fc           numeric NOT NULL CHECK (fc > 0 AND fc <= 3),
  nota         text    NOT NULL DEFAULT '',
  version      integer NOT NULL DEFAULT 0,
  editado_por  text    NOT NULL DEFAULT '',
  editado_ts   timestamptz,
  PRIMARY KEY (obra_id, descripcion)
);
COMMENT ON TABLE  fc_actividad IS 'D184 · FC (suelto→compacto) por DESCRIPCIÓN de actividad: el más usado en el histórico de DATA del Excel. Sin fila = FC 1. Lo usan enviar_data, la Revisión de DATA y el relleno de 007. Tabla propia: un backfill de base_items no la borra';
COMMENT ON COLUMN fc_actividad.descripcion IS 'texto VERBATIM de la hoja BASE / base_items; el cruce es por descripción normalizada (normTexto: sin tildes, mayúsculas, espacios colapsados)';
COMMENT ON COLUMN fc_actividad.nota IS 'de dónde sale el FC (conteo del histórico del Excel en las semillas de 007)';

-- ---------------------------------------------------------------------------------------------------
-- #2 · permisos: RLS como las demás tablas (sin políticas) y nada para la API REST de Supabase
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE fc_actividad ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON fc_actividad FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON fc_actividad FROM authenticated;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------
-- #3 · semillas — conteos de la hoja DATA de la copia del Excel del jefe (18-sep-2026): filas con FC 1.3 /
-- filas de esa descripción. Solo la PRIMERA vez que se aplica 007 y solo las que no existan.
-- ---------------------------------------------------------------------------------------------------
INSERT INTO fc_actividad (obra_id, descripcion, fc, nota)
SELECT 'tm2sur', v.descripcion, 1.3, v.nota
FROM (VALUES
  ('Terraplenes (solo conformación)',                                      'D184 · histórico DATA del Excel: FC 1.3 en 792 de 803 filas'),
  ('Excavaciones en material común APROVECHABLE',                          'D184 · histórico DATA del Excel: FC 1.3 en 414 de 417 filas'),
  ('Excavaciones en material común NO APROVECHABLE',                       'D184 · histórico DATA del Excel: FC 1.3 en 197 de 231 filas'),
  ('Excavación en material común de préstamos',                            'D184 · histórico DATA del Excel: FC 1.3 en 52 de 53 filas'),
  ('Subbase Granular',                                                     'D184 · histórico DATA del Excel: FC 1.3 en 193 de 196 filas'),
  ('Base granular estabilizada con cemento (No incluye cemento)',          'D184 · histórico DATA del Excel: FC 1.3 en 116 de 118 filas'),
  ('Conformación y disposición de sobrantes (incluye obras de adecuación)', 'D184 · histórico DATA del Excel: FC 1.3 en 76 de 116 filas (el resto 1.8/2/1.5/1: digitación)')
) AS v(descripcion, nota)
WHERE NOT EXISTS (SELECT 1 FROM esquema_version WHERE version = 7)
  AND NOT EXISTS (SELECT 1 FROM fc_actividad f WHERE f.obra_id = 'tm2sur' AND f.descripcion = v.descripcion);

-- ---------------------------------------------------------------------------------------------------
-- #4 · relleno de DATA SOLO donde falta (un solo UPDATE → version+1 una vez por fila)
--   norm(x) = normTexto de comun.js: 7 espacios raros → ' ', tildes/ñ (minúsculas y MAYÚSCULAS) → sin tilde
--   ANTES de upper() (así no depende del locale de la BD), espacios colapsados y recortados.
--   acta(fecha) = periodos (la que contiene la fecha) o la fórmula (a) con el mes de cierre
--   date_trunc('month', fecha − 15 días) + 1 mes (día ≤ 15 → ese mes; día ≥ 16 → el siguiente).
-- ---------------------------------------------------------------------------------------------------
WITH fca AS (
  SELECT DISTINCT ON (x.obra_id, x.k) x.obra_id, x.k, x.fc
  FROM (SELECT f.obra_id, f.descripcion, f.fc,
               upper(btrim(regexp_replace(
                 translate(f.descripcion,
                   E'   ​‌‍﻿áàâäéèêëíìîïóòôöúùûüñÁÀÂÄÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜÑ',
                   '       aaaaeeeeiiiioooouuuunAAAAEEEEIIIIOOOOUUUUN'),
                 '\s+', ' ', 'g'))) AS k
          FROM fc_actividad f) x
  ORDER BY x.obra_id, x.k, x.descripcion
),
calc AS (
  SELECT d.obra_id, d.id_registro,
    -- D185 [O]: fila de un ajuste origen con un FC distinto de 1 → se corrige (fc 1 y la cantidad sin ÷ FC)
    (nop.es AND d.fc IS NOT NULL AND d.fc <> 1)                                           AS fix_n,
    CASE WHEN btrim(d.acta) = '' AND a.acta <> '' THEN a.acta ELSE d.acta END              AS acta_n,
    CASE WHEN d.largo IS NOT NULL AND d.espesor IS NULL THEN 1::numeric ELSE d.espesor END AS esp_n,
    CASE WHEN nop.es AND d.fc IS NOT NULL AND d.fc <> 1 THEN 1::numeric                    -- D185 [O]: corrección
         WHEN nop.es AND d.largo IS NOT NULL AND d.fc IS NULL THEN 1::numeric               -- D185 [O]: relleno
         WHEN d.largo IS NOT NULL AND d.fc IS NULL
         THEN coalesce((SELECT fca.fc FROM fca
                         WHERE fca.obra_id = d.obra_id
                           AND fca.k = upper(btrim(regexp_replace(
                                 translate(d.descripcion,
                                   E'   ​‌‍﻿áàâäéèêëíìîïóòôöúùûüñÁÀÂÄÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜÑ',
                                   '       aaaaeeeeiiiioooouuuunAAAAEEEEIIIIOOOOUUUUN'),
                                 '\s+', ' ', 'g')))), 1::numeric)
         ELSE d.fc END                                                                     AS fc_n
  FROM data d
  CROSS JOIN LATERAL (
    SELECT coalesce(
      (SELECT p.acta FROM periodos p
        WHERE p.obra_id = d.obra_id AND d.fecha BETWEEN p.fecha_inicial AND p.fecha_final
        ORDER BY p.fecha_inicial LIMIT 1),
      (SELECT CASE WHEN n >= 1 THEN n::text ELSE '' END
         FROM (SELECT (extract(year from m)::int - 2025) * 12 + extract(month from m)::int + 2 AS n
                 FROM (SELECT (date_trunc('month', (d.fecha - 15)::timestamp) + interval '1 month')::date AS m) cierre) formula)
    ) AS acta
  ) a
  -- D185 [O]: ¿el ELEMENTO es un subtramo NO OPERATIVO? Nombre (^ajuste origen) o bandera de base_elementos.
  CROSS JOIN LATERAL (
    SELECT (d.elemento ~* '^\s*ajuste\s*origen'
            OR EXISTS (SELECT 1 FROM base_elementos be
                        WHERE be.obra_id = d.obra_id AND be.no_operativo
                          AND upper(btrim(regexp_replace(
                            translate(be.elemento,
                              E'   ​‌‍﻿áàâäéèêëíìîïóòôöúùûüñÁÀÂÄÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜÑ',
                              '       aaaaeeeeiiiioooouuuunAAAAEEEEIIIIOOOOUUUUN'),
                            '\s+', ' ', 'g')))
                            = upper(btrim(regexp_replace(
                                translate(d.elemento,
                                  E'   ​‌‍﻿áàâäéèêëíìîïóòôöúùûüñÁÀÂÄÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜÑ',
                                  '       aaaaeeeeiiiioooouuuunAAAAEEEEIIIIOOOOUUUUN'),
                                '\s+', ' ', 'g'))))) AS es
  ) nop
  WHERE d.obra_id = 'tm2sur'
    AND (btrim(d.acta) = ''
         OR (d.largo IS NOT NULL AND (d.espesor IS NULL OR d.fc IS NULL OR d.cantidad IS NULL))
         OR (nop.es AND d.fc IS NOT NULL AND d.fc <> 1))                                  -- D185 [O]
)
UPDATE data d
   SET acta     = c.acta_n,
       espesor  = c.esp_n,
       fc       = c.fc_n,
       cantidad = CASE WHEN c.fix_n AND d.largo IS NOT NULL                                -- D185 [O]: sin ÷ FC
                       THEN round(d.largo * c.esp_n, 6)
                       WHEN d.largo IS NOT NULL AND d.cantidad IS NULL
                       THEN round(d.largo * c.esp_n / CASE WHEN c.fc_n = 0 THEN 1 ELSE c.fc_n END, 6)
                       ELSE d.cantidad END,
       version  = d.version + 1
  FROM calc c
 WHERE d.obra_id = c.obra_id AND d.id_registro = c.id_registro
   AND (c.acta_n IS DISTINCT FROM d.acta
        OR c.esp_n IS DISTINCT FROM d.espesor
        OR c.fc_n IS DISTINCT FROM d.fc
        OR (d.largo IS NOT NULL AND d.cantidad IS NULL)
        OR c.fix_n);

-- ---------------------------------------------------------------------------------------------------
-- #5 · esquema_version
-- ---------------------------------------------------------------------------------------------------
INSERT INTO esquema_version (version, nota)
  VALUES (7, '007_data_completa.sql · D184: tabla fc_actividad (FC por actividad; 7 semillas 1.3; RLS; sin fila = 1) + relleno de DATA solo donde falta: ACTA de la fecha (periodos o fórmula), espesor 1, FC de la actividad, cantidad = largo·espesor/fc (version+1 una vez)')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
