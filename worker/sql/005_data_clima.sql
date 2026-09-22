-- =====================================================================================================
-- TM2 Sur · 4.01 — 005_data_clima.sql · DATA online simplificada y CLIMA del día (D182, sep-2026).
-- Se aplica DESPUÉS de 004_data_editable.sql y CON LOS DATOS YA CARGADOS (mueve los sellos que haya).
-- Idempotente: la segunda pasada no encuentra sellos que mover ni que limpiar, recrea la vista igual y
-- re-otorga el mismo GRANT: no cambia nada. Probado en PGlite (worker/pruebas) y pensado para Postgres 16.
--
-- Qué pidió el dueño (D182): la hoja DATOS del Excel se elimina y DATA online se simplifica.
--   · Fuera ORDEN, PROYECTO y LIBERACIÓN de la grilla y del espejo (y Columna1, que está vacía). Las
--     COLUMNAS de la tabla `data` se CONSERVAN: el copiado A:O del jefe al Excel actual las usa, y así el
--     cambio es reversible. Ninguna fórmula ni dinámica del maestro usa ORDEN/LIBERACIÓN; PROYECTO solo es
--     campo de fila en las 2 dinámicas de 'X TRAMOS', que al conectar Power Query pasan a UNIDAD FUNCIONAL.
--   · Donde estaba OBSERVACIÓN va el CLIMA del día; OBSERVACIÓN pasa al final.
--   · El clima es DEL DÍA y vive en data.clima (D37). El sello '[Clima: X]' que D130 estampaba en la
--     OBSERVACIÓN de la 1ª fila del día (lo leía la hoja DATOS) deja de tener razón de ser: el Worker ya no
--     lo estampa (api/obra/data.js) y aquí se retira de lo ya guardado.
--
--   #1 mover el sello a la columna: clima = el texto dentro de '[Clima: …]' donde el clima está vacío y la
--      observación trae el sello (una fila con clima propio lo conserva).
--   #2 limpiar la observación: quitar el sello con la MISMA regex que CLIMA_SELLO_RE del .gs
--      (/\[Clima:\s*[^\]]*\]\s*(?:·\s*)?/gi) y recortar espacios. El \s de JS (y su trim) incluye el espacio
--      duro U+00A0 y el de Postgres no: aquí va [\s\u00a0] y el btrim lo lleva, para que el '·' no quede
--      suelto cuando la observación se copió de Excel/WhatsApp. #1 y #2 van en un solo UPDATE que sube
--      `version` una vez (if_version de la grilla, 004): una pantalla abierta con la fila vieja choca y
--      recarga en vez de devolver el sello. Solo toca filas que TIENEN sello: en la segunda pasada, ninguna.
--   #3 vista data_maestro (el ESPEJO que leerá Power Query, V3-09): se RECREA (DROP + CREATE, porque
--      CREATE OR REPLACE no puede quitar ni reordenar columnas) con FECHA · GRUPO · CENTRO DE COSTO ·
--      CAPITULO · DESCRIPCION · UNIDAD FUNCIONAL · ELEMENTO · ABS INICIAL · ABS FINAL · ACTA · UNIDAD MEDIDA ·
--      LARGO · ESPESOR · FC · CANTIDAD · CLIMA · OBSERVACION + las internas de siempre. CLIMA = el de la fila
--      o, si está vacío, el del DÍA = primer clima no vacío de esa fecha por "timestamp" NULLS LAST,
--      id_registro (la regla de climaPorDia, D37; las filas de drenajes llegan con '' y toman el del día).
--      Sin ORDEN/PROYECTO/LIBERACION/Columna1 ni la `clima` cruda duplicada. La MISMA expresión calcula el
--      clima de cada fila en la grilla (api/obra/datagrid.js).
--   #4 el DROP se lleva los permisos de la vista: se re-otorga SELECT a tm2_lector_maestro SOLO si el rol
--      existe (roles_lectura_maestro.sql se aplica a mano en Supabase; en PGlite/el banco no existe).
--
-- OJO con 001: su `CREATE OR REPLACE VIEW data_maestro` (layout A–T de antes) FALLA sobre esta vista (no
-- puede renombrar columnas) y, como 001 va en una transacción, no aplica nada. Si alguna vez hay que volver
-- a correr 001 sobre una BD que ya tiene 005: antes `DROP VIEW data_maestro;` y después vuelve a correr 005.
-- =====================================================================================================

BEGIN;

-- ---------------------------------------------------------------------------------------------------
-- #1 + #2 en UNA pasada (una sola subida de version por fila), solo sobre las filas con sello:
--   #1 · clima vacío → el texto del (primer) sello; un sello vacío '[Clima: ]' o un clima propio no se tocan.
--   #2 · la observación queda sin sello(s) (misma regex que CLIMA_SELLO_RE, flags 'gi') y recortada.
-- ---------------------------------------------------------------------------------------------------
UPDATE data
   SET clima       = CASE WHEN btrim(clima) = ''
                          THEN coalesce(nullif(btrim((regexp_match(observacion, '\[Clima:[\s\u00a0]*([^\]]*)\]', 'i'))[1], E' \t\r\n\u00a0'), ''), clima)
                          ELSE clima END,
       observacion = btrim(regexp_replace(observacion, '\[Clima:[\s\u00a0]*[^\]]*\][\s\u00a0]*(?:·[\s\u00a0]*)?', '', 'gi'), E' \t\r\n\u00a0'),
       version     = version + 1
 WHERE observacion ~* '\[Clima:\s*[^\]]*\]';

-- ---------------------------------------------------------------------------------------------------
-- #3 · data_maestro: el espejo sin ORDEN/PROYECTO/LIBERACION/Columna1 y con el CLIMA del día
-- ---------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS data_maestro;
CREATE VIEW data_maestro AS
SELECT obra_id,
  to_char(fecha, 'YYYY-MM-DD') AS "FECHA", grupo AS "GRUPO", centro_de_costo AS "CENTRO DE COSTO",
  capitulo AS "CAPITULO", descripcion AS "DESCRIPCION", unidad_funcional AS "UNIDAD FUNCIONAL",
  elemento AS "ELEMENTO", abs_inicial AS "ABS INICIAL", abs_final AS "ABS FINAL", acta AS "ACTA",
  unidad_medida AS "UNIDAD MEDIDA", largo AS "LARGO", espesor AS "ESPESOR", fc AS "FC", cantidad AS "CANTIDAD",
  CASE WHEN btrim(clima) <> '' THEN btrim(clima) ELSE first_value(btrim(clima)) OVER dia END AS "CLIMA",
  observacion AS "OBSERVACION",
  id_registro, "timestamp", capataz, rol, actividad, pk_inicial, pk_final, area
FROM data
WINDOW dia AS (PARTITION BY obra_id, fecha ORDER BY (btrim(clima) = ''), "timestamp" NULLS LAST, id_registro);

COMMENT ON VIEW data_maestro IS 'ESPEJO de DATA para Power Query (V3-09) · D182: FECHA…CANTIDAD, CLIMA (el de la fila o el del día), OBSERVACION + internas; sin ORDEN/PROYECTO/LIBERACION/Columna1 (siguen en la tabla data)';

-- ---------------------------------------------------------------------------------------------------
-- #4 · el DROP perdió el GRANT del lector del maestro: se re-otorga si el rol existe
-- ---------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm2_lector_maestro') THEN
    GRANT SELECT ON data_maestro TO tm2_lector_maestro;
  END IF;
END $$;

INSERT INTO esquema_version (version, nota)
  VALUES (5, '005_data_clima.sql · D182: sello [Clima: X] de la observación → data.clima; data_maestro sin ORDEN/PROYECTO/LIBERACION/Columna1, con CLIMA del día y OBSERVACION al final')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
