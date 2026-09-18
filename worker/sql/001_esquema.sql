-- =====================================================================================================
-- TM2 Sur · 4.01 — Esquema Postgres (Supabase) · 001_esquema.sql
-- Fase 1 de la migración (D180, sep-2026): «una tabla por hoja transaccional, obra_id en todas, claves
-- de negocio que hoy son implícitas, índices por (fecha), (fecha, area), (fecha, cuadrilla)».
-- Fuente: docs/INFORME_4.01_base_de_datos.md §5 (modelo actual) y §7 (arquitectura objetivo).
--
-- Reglas que fija este archivo (y que el Worker tiene que respetar cuando se porte la lógica):
--   1. `obra_id` en TODA tabla desde el día uno, con DEFAULT 'tm2sur' para que el código portado no
--      tenga que pasarlo hasta que exista la segunda obra (4.03). Es parte de todas las claves primarias.
--   2. Las columnas conservan el NOMBRE de la hoja de origen (mismos encabezados que definen los .gs),
--      en snake_case. DATA conserva las 20 columnas A–T del maestro en el mismo ORDEN; la vista
--      `data_maestro` las expone con los encabezados EXACTOS del Excel para el pull del ESPEJO.
--   3. Tipos: `date` para fecha, `timestamptz` para timestamp, `numeric` para horas/cantidades/medidores,
--      `text` para todo lo demás (horas del tipo '07:00' incluidas: viajan como texto verbatim, así el
--      export a Navision y el copy-paste no cambian). Vacío en la hoja = '' en texto, NULL en número/fecha.
--   4. Claves de negocio como PRIMARY KEY solo donde el código YA las usa como identidad
--      (`id_registro`, `app_id_registro`, `(fecha, cuadrilla)`, `(fecha)`). Donde hoy hay duplicados
--      tolerados (ASISTENCIA por persona, PERSONAL) van ÍNDICES, no UNIQUE: la regla D126 «manda el
--      código; cédula solo si falta» vive en el Worker, no en un constraint, para no rechazar lo que hoy entra.
--   5. Idempotencia de la cola offline (D82): el Worker inserta con `ON CONFLICT (obra_id, id_registro)
--      DO NOTHING` y cuenta las filas saltadas como `duplicadas`.
--   6. Los catálogos que se editan A MANO en el Sheet (BASE, CUBICAJE, USUARIOS, MAQUINAS hasta que se
--      use solo la Flota, CAT_*, PARTE_EQUIPOS/OPERADORES/CC/ITEMS/ACTIVIDADES) también tienen tabla:
--      el trigger de pull del ESPEJO los reescribe (TRUNCATE + INSERT por obra) cada 5–15 min. Están en
--      la sección «catálogos importados» y llevan `importado_ts`.
--
-- Idempotente: se puede correr varias veces (CREATE … IF NOT EXISTS). Sin datos: el backfill va aparte
-- (volcado CSV, ver backend/volcado/ y worker/sql/README.md).
-- =====================================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS esquema_version (
  version     integer PRIMARY KEY,
  aplicado_ts timestamptz NOT NULL DEFAULT now(),
  nota        text NOT NULL DEFAULT ''
);

-- ---------------------------------------------------------------------------------------------------
-- 0 · OBRA: el pivote de 4.03 (segunda obra = una fila aquí + un subdominio). Hoy una sola.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS obra (
  obra_id     text PRIMARY KEY,                       -- 'tm2sur'
  nombre      text NOT NULL,
  zona_horaria text NOT NULL DEFAULT 'America/Bogota',
  activa      boolean NOT NULL DEFAULT true,
  creado_ts   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO obra (obra_id, nombre) VALUES ('tm2sur', 'TM2 Sur (UF1-UF2 · drenajes · UF3)') ON CONFLICT (obra_id) DO NOTHING;

-- =====================================================================================================
-- 1 · OBRA (Sheet de obra · Codigo.gs)
-- =====================================================================================================

-- BANDEJA — lo crudo que reportan capataz / chequeadora / drenajes (28 columnas, D56/D69).
-- Escritura: append (guardarReporte) + update de `estado` al enviar a DATA. Clave: id_registro (UUID
-- de cliente, D82). `id_cantidad` NO está en la hoja: es el id de la línea que las máquinas referencian
-- (MAQUINARIA.id_cantidad ↔ BANDEJA.id_registro); se deja el índice en MAQUINARIA.
CREATE TABLE IF NOT EXISTS bandeja (
  obra_id            text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  id_registro        text NOT NULL,
  "timestamp"        timestamptz,
  fecha              date NOT NULL,
  reporta            text NOT NULL DEFAULT '',
  rol                text NOT NULL DEFAULT '',        -- capataz | chequeadora | encargado | residente_odt…
  grupo              text NOT NULL DEFAULT '',
  capitulo           text NOT NULL DEFAULT '',
  actividad          text NOT NULL DEFAULT '',
  descripcion        text NOT NULL DEFAULT '',        -- verbatim de la BASE (cruza por VLOOKUP en el Excel)
  centro_costo       text NOT NULL DEFAULT '',
  unidad             text NOT NULL DEFAULT '',
  uf                 text NOT NULL DEFAULT '',
  proyecto           text NOT NULL DEFAULT '',        -- '3701' | '3702' | '3703'
  elemento           text NOT NULL DEFAULT '',        -- 'tm2 pk X - Y' verbatim
  pk_inicial         text NOT NULL DEFAULT '',
  pk_final           text NOT NULL DEFAULT '',
  abs_inicial        text NOT NULL DEFAULT '',
  abs_final          text NOT NULL DEFAULT '',
  liberacion         text NOT NULL DEFAULT '',
  largo              numeric,
  observacion        text NOT NULL DEFAULT '',
  estado             text NOT NULL DEFAULT '',        -- '' | pendiente | enviado (lo que escriba el código)
  origen             text NOT NULL DEFAULT '',        -- banco de material (chequeadora, D56)
  area               text NOT NULL DEFAULT '',        -- '' (=tierras) | odt | odl  (D69)
  personal_oficiales numeric,
  personal_ayudantes numeric,
  turno_noche        text NOT NULL DEFAULT '',        -- 'SI' | ''
  nota_libre         text NOT NULL DEFAULT '',
  PRIMARY KEY (obra_id, id_registro)
);
CREATE INDEX IF NOT EXISTS bandeja_fecha_idx      ON bandeja (obra_id, fecha);
CREATE INDEX IF NOT EXISTS bandeja_fecha_area_idx ON bandeja (obra_id, fecha, area);
CREATE INDEX IF NOT EXISTS bandeja_fecha_proy_idx ON bandeja (obra_id, fecha, proyecto);

-- DATA — la hoja OFICIAL: A–T en el orden del maestro TM2 (paste A:S) + internas U–AC.
-- Escritura hoy: borra día+área y anexa, REGENERANDO id_registro (Codigo.gs L2500). En el Worker
-- (Fase 4): DELETE … WHERE obra_id, fecha, area + INSERT en UNA transacción y se conserva el id de la
-- línea de BANDEJA, por eso aquí `id_registro` es PK. Clave de negocio de la escritura: (fecha, area).
CREATE TABLE IF NOT EXISTS data (
  obra_id            text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  -- ---- A–T: columnas del maestro, MISMO ORDEN; el encabezado exacto del Excel va en COMMENT ----
  fecha              date NOT NULL,                   -- A  FECHA
  orden              text NOT NULL DEFAULT '',        -- B  ORDEN
  grupo              text NOT NULL DEFAULT '',        -- C  GRUPO
  centro_de_costo    text NOT NULL DEFAULT '',        -- D  CENTRO DE COSTO
  capitulo           text NOT NULL DEFAULT '',        -- E  CAPITULO
  descripcion        text NOT NULL DEFAULT '',        -- F  DESCRIPCION (verbatim BASE)
  unidad_funcional   text NOT NULL DEFAULT '',        -- G  UNIDAD FUNCIONAL
  proyecto           text NOT NULL DEFAULT '',        -- H  PROYECTO
  elemento           text NOT NULL DEFAULT '',        -- I  ELEMENTO  ('tm2 pk X - Y')
  abs_inicial        text NOT NULL DEFAULT '',        -- J  ABS INICIAL
  abs_final          text NOT NULL DEFAULT '',        -- K  ABS FINAL
  liberacion         text NOT NULL DEFAULT '',        -- L  LIBERACION
  acta               text NOT NULL DEFAULT '',        -- M  ACTA
  unidad_medida      text NOT NULL DEFAULT '',        -- N  UNIDAD MEDIDA
  largo              numeric,                         -- O  LARGO
  espesor            numeric,                         -- P  ESPESOR
  fc                 numeric,                         -- Q  FC
  cantidad           numeric,                         -- R  CANTIDAD
  observacion        text NOT NULL DEFAULT '',        -- S  OBSERVACION ('[Clima: …]' en la 1ª fila del día, D130)
  columna1           text NOT NULL DEFAULT '',        -- T  Columna1
  -- ---- U–AC: internas (no viajan al maestro) ----
  id_registro        text NOT NULL,                   -- U  (id de la línea de BANDEJA; ya no se regenera)
  "timestamp"        timestamptz,                     -- V
  capataz            text NOT NULL DEFAULT '',        -- W
  rol                text NOT NULL DEFAULT '',        -- X
  actividad          text NOT NULL DEFAULT '',        -- Y  (D113: desglose del jefe)
  pk_inicial         text NOT NULL DEFAULT '',        -- Z
  pk_final           text NOT NULL DEFAULT '',        -- AA
  area               text NOT NULL DEFAULT '',        -- AB '' (=tierras) | odt | odl (D71)
  clima              text NOT NULL DEFAULT '',        -- AC (D37)
  PRIMARY KEY (obra_id, id_registro)
);
CREATE INDEX IF NOT EXISTS data_fecha_idx      ON data (obra_id, fecha);
CREATE INDEX IF NOT EXISTS data_fecha_area_idx ON data (obra_id, fecha, area);
CREATE INDEX IF NOT EXISTS data_cc_idx         ON data (obra_id, centro_de_costo, fecha);   -- acumulado_drenajes / consolidadoRango sin tope
COMMENT ON COLUMN data.fecha            IS 'A · FECHA';
COMMENT ON COLUMN data.orden            IS 'B · ORDEN';
COMMENT ON COLUMN data.grupo            IS 'C · GRUPO';
COMMENT ON COLUMN data.centro_de_costo  IS 'D · CENTRO DE COSTO';
COMMENT ON COLUMN data.capitulo         IS 'E · CAPITULO';
COMMENT ON COLUMN data.descripcion      IS 'F · DESCRIPCION';
COMMENT ON COLUMN data.unidad_funcional IS 'G · UNIDAD FUNCIONAL';
COMMENT ON COLUMN data.proyecto         IS 'H · PROYECTO';
COMMENT ON COLUMN data.elemento         IS 'I · ELEMENTO';
COMMENT ON COLUMN data.abs_inicial      IS 'J · ABS INICIAL';
COMMENT ON COLUMN data.abs_final        IS 'K · ABS FINAL';
COMMENT ON COLUMN data.liberacion       IS 'L · LIBERACION';
COMMENT ON COLUMN data.acta             IS 'M · ACTA';
COMMENT ON COLUMN data.unidad_medida    IS 'N · UNIDAD MEDIDA';
COMMENT ON COLUMN data.largo            IS 'O · LARGO';
COMMENT ON COLUMN data.espesor          IS 'P · ESPESOR';
COMMENT ON COLUMN data.fc               IS 'Q · FC';
COMMENT ON COLUMN data.cantidad         IS 'R · CANTIDAD';
COMMENT ON COLUMN data.observacion      IS 'S · OBSERVACION';
COMMENT ON COLUMN data.columna1         IS 'T · Columna1';

-- Vista para el pull del ESPEJO y para la prueba de paridad celda a celda (§7.8): los 20 encabezados
-- EXACTOS del maestro, en su orden, más las internas con su nombre de hoja. `SELECT * … ORDER BY fecha`
-- reproduce la hoja DATA byte a byte (fechas como yyyy-MM-dd; vacío = '').
CREATE OR REPLACE VIEW data_maestro AS
SELECT obra_id,
  to_char(fecha, 'YYYY-MM-DD') AS "FECHA", orden AS "ORDEN", grupo AS "GRUPO", centro_de_costo AS "CENTRO DE COSTO",
  capitulo AS "CAPITULO", descripcion AS "DESCRIPCION", unidad_funcional AS "UNIDAD FUNCIONAL", proyecto AS "PROYECTO",
  elemento AS "ELEMENTO", abs_inicial AS "ABS INICIAL", abs_final AS "ABS FINAL", liberacion AS "LIBERACION", acta AS "ACTA",
  unidad_medida AS "UNIDAD MEDIDA", largo AS "LARGO", espesor AS "ESPESOR", fc AS "FC", cantidad AS "CANTIDAD",
  observacion AS "OBSERVACION", columna1 AS "Columna1",
  id_registro, "timestamp", capataz, rol, actividad, pk_inicial, pk_final, area, clima
FROM data;

-- MAQUINARIA — layout de Captura_Diaria A–AA (D52) + internas del app. Escritura: append + update de
-- `produccion` (col T) y `produccion_capataz_orig` desde produccion-maquinaria (D55).
-- Clave: app_id_registro (id de cliente/backend, es el que usa idsExistentes); id_cantidad ↔ bandeja.id_registro.
CREATE TABLE IF NOT EXISTS maquinaria (
  obra_id               text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  -- ---- A–AA: Captura_Diaria (entrada con valor; fórmula/no-captura en blanco) ----
  id_registro           text NOT NULL DEFAULT '',     -- A  (id de la fila en Captura; puede ir vacío)
  fecha                 date NOT NULL,                -- B
  dia                   text NOT NULL DEFAULT '',     -- C
  proyecto              text NOT NULL DEFAULT '',     -- D
  id_maquina            text NOT NULL DEFAULT '',     -- E  (cruza con dim_maquinaria, D111)
  tipo_equipo           text NOT NULL DEFAULT '',     -- F
  operador              text NOT NULL DEFAULT '',     -- G
  actividad             text NOT NULL DEFAULT '',     -- H
  sub_actividad         text NOT NULL DEFAULT '',     -- I
  unidad                text NOT NULL DEFAULT '',     -- J
  horas_programadas     numeric,                      -- K
  horas_operadas        numeric,                      -- L
  pct_util              numeric,                      -- M
  horas_muertas         numeric,                      -- N
  horas_mantenimiento   numeric,                      -- O
  pct_muerto            numeric,                      -- P
  horas_facturadas      numeric,                      -- Q
  estado                text NOT NULL DEFAULT '',     -- R
  clima                 text NOT NULL DEFAULT '',     -- S
  produccion            numeric,                      -- T  (la ajusta el panel 2.4)
  meta                  numeric,                      -- U
  pct_ef                numeric,                      -- V
  rendimiento           numeric,                      -- W
  unitario              numeric,                      -- X
  viajes                numeric,                      -- Y
  costo                 numeric,                      -- Z
  observacion           text NOT NULL DEFAULT '',     -- AA
  -- ---- internas del app ----
  app_id_registro       text NOT NULL,
  id_cantidad           text NOT NULL DEFAULT '',     -- ↔ bandeja.id_registro
  "timestamp"           timestamptz,
  reporta               text NOT NULL DEFAULT '',
  app_tipo_equipo       text NOT NULL DEFAULT '',
  app_horas_programadas numeric,
  app_horas_muertas     numeric,
  motivo                text NOT NULL DEFAULT '',
  unidad_prod           text NOT NULL DEFAULT '',
  cap_actividad         text NOT NULL DEFAULT '',
  a_captura             text NOT NULL DEFAULT '',     -- 'SI' | 'NO' (a_captura=NO nunca pasa a Captura_Diaria)
  produccion_capataz_orig numeric,
  area                  text NOT NULL DEFAULT '',     -- '' (=tierras) | odt | odl (D69)
  PRIMARY KEY (obra_id, app_id_registro)
);
CREATE INDEX IF NOT EXISTS maquinaria_fecha_idx     ON maquinaria (obra_id, fecha);
CREATE INDEX IF NOT EXISTS maquinaria_fecha_maq_idx ON maquinaria (obra_id, fecha, id_maquina);
CREATE INDEX IF NOT EXISTS maquinaria_cantidad_idx  ON maquinaria (obra_id, id_cantidad);
CREATE INDEX IF NOT EXISTS maquinaria_maq_fecha_idx ON maquinaria (obra_id, id_maquina, fecha DESC);   -- flotaSugerencia_/histórico por máquina sin leer la hoja entera

-- VOLQUETAS — desglose por placa de la chequeadora (una fila por placa, D53). Append; clave id_registro.
CREATE TABLE IF NOT EXISTS volquetas (
  obra_id          text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  id_registro      text NOT NULL,
  "timestamp"      timestamptz,
  fecha            date NOT NULL,
  reporta          text NOT NULL DEFAULT '',
  origen           text NOT NULL DEFAULT '',
  destino          text NOT NULL DEFAULT '',
  tipo_destino     text NOT NULL DEFAULT '',
  uf               text NOT NULL DEFAULT '',
  placa            text NOT NULL DEFAULT '',
  viajes           numeric,
  cubicaje         numeric,
  m3_placa         numeric,
  cubicaje_origen  text NOT NULL DEFAULT '',          -- 'catalogo' | 'reporte' (de dónde salió el m³/viaje)
  PRIMARY KEY (obra_id, id_registro)
);
CREATE INDEX IF NOT EXISTS volquetas_fecha_idx ON volquetas (obra_id, fecha);

-- OBSERVACIONES — observación general del día por envío (D86: `area` = 'tierras' | 'odt' | 'odl' | 'odt,odl').
CREATE TABLE IF NOT EXISTS observaciones (
  obra_id      text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  id_registro  text NOT NULL,                         -- = id_reporte del envío (dedupe D82) o UUID
  "timestamp"  timestamptz,
  fecha        date NOT NULL,
  reporta      text NOT NULL DEFAULT '',
  observacion  text NOT NULL DEFAULT '',
  area         text NOT NULL DEFAULT '',
  PRIMARY KEY (obra_id, id_registro)
);
CREATE INDEX IF NOT EXISTS observaciones_fecha_idx ON observaciones (obra_id, fecha);

-- MAQUINAS — estancias de la flota (catálogo VIVO: lo escribe la pantalla de Flota, D138/D139/D173).
-- Clave de negocio: (id_maquina, fecha_ingreso). `fecha_retiro` = PRIMER día que ya no estuvo (semiabierta).
CREATE TABLE IF NOT EXISTS maquinas (
  obra_id        text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  id_maquina     text NOT NULL,
  tipo           text NOT NULL DEFAULT '',
  horas_prog     numeric,
  propiedad      text NOT NULL DEFAULT '',
  fecha_ingreso  date NOT NULL,
  fecha_retiro   date,
  notas          text NOT NULL DEFAULT '',
  frente         text NOT NULL DEFAULT '',            -- 'UF1-UF2' | 'UF3' … (D173: qué equipos espera el Parte)
  grupo          text NOT NULL DEFAULT 'tierras',      -- 'tierras' | 'drenajes' (D183: disciplina/dueño de la máquina; ORTOGONAL a frente/UF)
  PRIMARY KEY (obra_id, id_maquina, fecha_ingreso),
  CHECK (fecha_retiro IS NULL OR fecha_retiro >= fecha_ingreso)
);
CREATE INDEX IF NOT EXISTS maquinas_vigencia_idx ON maquinas (obra_id, fecha_ingreso, fecha_retiro);

-- TABLERO — la foto publicada del tablero de producción (D158/D159). En la hoja va troceada en filas
-- de 40k caracteres por el límite de celda; en Postgres es UNA fila por obra con la foto en jsonb.
CREATE TABLE IF NOT EXISTS tablero (
  obra_id      text PRIMARY KEY DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,    -- {generado, publicado, usuario, periodos, caracteres, trozos}
  foto         jsonb,                                 -- NULL = nada publicado (tableroLeer devuelve foto:null)
  publicado_ts timestamptz NOT NULL DEFAULT now()
);

-- USUARIOS — login (D108) · clave = texto en claro o SHA-256 hex de `usuario:clave` (endurecerClaves).
-- Hoy se edita a mano en el Sheet; el Worker (Fase 4) será el emisor del token y leerá de aquí.
CREATE TABLE IF NOT EXISTS usuarios (
  obra_id      text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  usuario      text NOT NULL,                         -- minúsculas
  clave        text NOT NULL DEFAULT '',
  rol          text NOT NULL DEFAULT '',
  areas        text NOT NULL DEFAULT '',              -- 'odt,odl' (lista separada por comas, como en la hoja)
  redirige     text NOT NULL DEFAULT '',
  estado       text NOT NULL DEFAULT '',              -- '' | activo | inactivo
  importado_ts timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (obra_id, usuario)
);

-- =====================================================================================================
-- 2 · PARTE DIGITAL (mismo Sheet de obra · CodigoParte.gs) — el módulo que migra PRIMERO (Fase 2)
-- =====================================================================================================

-- PARTE_BANDEJA — 27 columnas, esquema fijo. Append (op=reporte), update por id_registro (op=revisar),
-- NUNCA delete (el estado cambia: pendiente | aprobado | descartado). Clave: id_registro (UUID de
-- cliente; `-r<n>` en repartos, D178). `parteUltimoFinal_` pasa a la consulta indexada de abajo.
CREATE TABLE IF NOT EXISTS parte_bandeja (
  obra_id             text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  id_registro         text NOT NULL,
  "timestamp"         timestamptz,
  estado              text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobado','descartado')),
  fecha               date NOT NULL,
  codigo              text NOT NULL,                  -- código de equipo (identidad pública del QR)
  tipo                text NOT NULL DEFAULT '',
  placa               text NOT NULL DEFAULT '',
  medidor             text NOT NULL DEFAULT '',       -- HOROMETRO | KM
  reporte_num         text NOT NULL DEFAULT '',       -- nº del parte físico (texto: conserva ceros)
  inicial             numeric,
  final               numeric,
  total               numeric,
  inicial_modificado  text NOT NULL DEFAULT '',       -- 'SI' | ''
  horas_varada        numeric,
  horas_lluvia        numeric,
  hora_de             text NOT NULL DEFAULT '',       -- 'HH:MM'
  hora_a              text NOT NULL DEFAULT '',
  descripcion_trabajo text NOT NULL DEFAULT '',
  centro_coste        text NOT NULL DEFAULT '',       -- normalizado «3701.02.10» (D178) o pseudo (Taller…)
  pr                  numeric,
  uf                  text NOT NULL DEFAULT '',
  operador            text NOT NULL DEFAULT '',       -- canónico (PARTE_OPERADORES_ALIAS)
  observaciones       text NOT NULL DEFAULT '',
  alertas             text NOT NULL DEFAULT '',       -- lista separada por comas, como en la hoja
  revisado_por        text NOT NULL DEFAULT '',
  revisado_ts         timestamptz,
  origen              text NOT NULL DEFAULT 'qr',     -- qr | manual
  PRIMARY KEY (obra_id, id_registro)
);
CREATE INDEX IF NOT EXISTS parte_bandeja_fecha_idx        ON parte_bandeja (obra_id, fecha);
CREATE INDEX IF NOT EXISTS parte_bandeja_estado_fecha_idx ON parte_bandeja (obra_id, estado, fecha);
-- último final del equipo: SELECT … WHERE obra_id=$1 AND codigo=$2 AND estado<>'descartado' ORDER BY fecha DESC, hora_a DESC LIMIT 1
CREATE INDEX IF NOT EXISTS parte_bandeja_ultimo_idx ON parte_bandeja (obra_id, codigo, fecha DESC, hora_a DESC) WHERE estado <> 'descartado';

-- =====================================================================================================
-- 3 · ASISTENCIAS (Sheet de asistencias · CodigoAsistencias.gs) — Fase 3 (el pico de concurrencia)
-- =====================================================================================================

-- ASISTENCIA — la hoja que crece (5.200–7.800 filas/mes). Escritura: upsert quirúrgico por
-- (fecha, cuadrilla) + borrado de la fila de ese día de cada persona entrante (D107/D126). Clave técnica:
-- id_registro (UUID por fila). Clave de negocio (fecha, persona) con `cuadrilla` como atributo: NO es
-- UNIQUE a propósito (D126 se aplica en código; el histórico trae duplicados que se depuran aparte).
CREATE TABLE IF NOT EXISTS asistencia (
  obra_id          text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  id_registro      text NOT NULL,
  "timestamp"      timestamptz,
  fecha            date NOT NULL,
  reporta          text NOT NULL DEFAULT '',
  cuadrilla        text NOT NULL DEFAULT '',
  codigo           text NOT NULL DEFAULT '',          -- código Navision (manda)
  cedula           text NOT NULL DEFAULT '',          -- solo si falta el código
  nombre           text NOT NULL DEFAULT '',
  cargo            text NOT NULL DEFAULT '',
  cc               text NOT NULL DEFAULT '',          -- '3701.02.05| EXCAVACION…' verbatim Navision
  proyecto         text NOT NULL DEFAULT '',
  hora_entrada     text NOT NULL DEFAULT '',          -- 'HH:MM' verbatim (el export las interpreta)
  hora_salida      text NOT NULL DEFAULT '',
  presente         text NOT NULL DEFAULT 'Si',        -- 'Si' | 'No'
  motivo_ausencia  text NOT NULL DEFAULT '',
  observacion      text NOT NULL DEFAULT '',
  turno            text NOT NULL DEFAULT '',          -- '' = diurno estándar (D72)
  PRIMARY KEY (obra_id, id_registro)
);
CREATE INDEX IF NOT EXISTS asistencia_fecha_cuadrilla_idx ON asistencia (obra_id, fecha, cuadrilla);
CREATE INDEX IF NOT EXISTS asistencia_fecha_codigo_idx    ON asistencia (obra_id, fecha, codigo);
CREATE INDEX IF NOT EXISTS asistencia_fecha_cedula_idx    ON asistencia (obra_id, fecha, cedula) WHERE cedula <> '';
CREATE INDEX IF NOT EXISTS asistencia_codigo_fecha_idx    ON asistencia (obra_id, codigo, fecha);            -- ?action=persona (D112)
CREATE INDEX IF NOT EXISTS asistencia_cuadrilla_fecha_idx ON asistencia (obra_id, cuadrilla, fecha DESC);    -- recientesCC del roster: fecha >= hoy-60

-- PERSONAL — maestro con CRUD (gestionPersonal: alta/retiro/reactivar/reingreso/mover). Una fila por
-- ESTANCIA de la persona (un reingreso es fila nueva, D118). Clave técnica surrogate; codigo/cedula
-- indexados, no únicos (hay filas históricas repetidas y `codigo` puede ir vacío).
CREATE TABLE IF NOT EXISTS personal (
  obra_id        text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  personal_id    bigserial,
  cedula         text NOT NULL DEFAULT '',
  codigo         text NOT NULL DEFAULT '',
  nombre         text NOT NULL DEFAULT '',
  cargo          text NOT NULL DEFAULT '',
  cuadrilla      text NOT NULL DEFAULT '',
  responsable    text NOT NULL DEFAULT '',
  estado         text NOT NULL DEFAULT 'activo',      -- activo | retirado | eventual…
  fecha_retiro   date,
  fecha_ingreso  date,                                -- NULL = «siempre estuvo» (plantilla base)
  fila_sheet     integer,                             -- `_row` de la hoja de origen, solo para el backfill/pantallas viejas
  PRIMARY KEY (obra_id, personal_id)
);
CREATE INDEX IF NOT EXISTS personal_codigo_idx    ON personal (obra_id, codigo) WHERE codigo <> '';
CREATE INDEX IF NOT EXISTS personal_cedula_idx    ON personal (obra_id, cedula) WHERE cedula <> '';
CREATE INDEX IF NOT EXISTS personal_cuadrilla_idx ON personal (obra_id, cuadrilla);

-- EXTRAS_ADMIN — canal «solo extras» del admin (D73): UNA fila por día, re-guardar pisa el día.
-- Hoy: clearContents + reescritura; en el Worker: UPSERT por (fecha) / DELETE por (fecha).
CREATE TABLE IF NOT EXISTS extras_admin (
  obra_id     text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  fecha       date NOT NULL,
  cc          text NOT NULL DEFAULT '',
  proyecto    text NOT NULL DEFAULT '',
  horas       numeric NOT NULL,
  tipo        text NOT NULL CHECK (tipo IN ('diurna','nocturna','domfest')),
  "timestamp" timestamptz,
  reporta     text NOT NULL DEFAULT 'admin',
  PRIMARY KEY (obra_id, fecha)
);

-- NOTAS_ASISTENCIA — nota libre del día por cuadrilla (D74): clave (fecha, cuadrilla), re-enviar pisa.
CREATE TABLE IF NOT EXISTS notas_asistencia (
  obra_id     text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  fecha       date NOT NULL,
  cuadrilla   text NOT NULL,
  reporta     text NOT NULL DEFAULT '',
  nota        text NOT NULL DEFAULT '',
  "timestamp" timestamptz,
  PRIMARY KEY (obra_id, fecha, cuadrilla)
);

-- =====================================================================================================
-- 4 · LOG (D166) — una tabla para los tres módulos; retención 30 días por cron (Fase 5).
-- =====================================================================================================
CREATE TABLE IF NOT EXISTS log (
  log_id      bigserial PRIMARY KEY,
  obra_id     text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id),
  modulo      text NOT NULL CHECK (modulo IN ('obra','asistencias','parte')),
  fecha_hora  timestamptz NOT NULL DEFAULT now(),
  usuario     text NOT NULL DEFAULT '',               -- en el Parte público: el código de equipo (rol 'equipo')
  rol         text NOT NULL DEFAULT '',
  action      text NOT NULL DEFAULT '',               -- 'bandeja', 'parte:reporte', 'login'…
  resultado   text NOT NULL DEFAULT '',               -- ok | rechazado | error
  motivo      text NOT NULL DEFAULT '',
  ms          integer
);
CREATE INDEX IF NOT EXISTS log_fecha_idx ON log (obra_id, fecha_hora);
CREATE INDEX IF NOT EXISTS log_usuario_action_idx ON log (obra_id, usuario, action, fecha_hora DESC);   -- rate limit por usuario+action si no se usa KV

-- =====================================================================================================
-- 5 · CATÁLOGOS IMPORTADOS DESDE EL SHEET (pull cada 5–15 min: TRUNCATE por obra + INSERT). Se siguen
--     editando A MANO en la hoja (§7.7). `importado_ts` dice de cuándo es la copia.
-- =====================================================================================================

-- --- obra ---
CREATE TABLE IF NOT EXISTS cubicaje (                 -- placa → m³/viaje (espejo de la Bitácora de Transporte, D53)
  obra_id text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id), placa text NOT NULL, cubicaje numeric, tipo text NOT NULL DEFAULT '',
  importado_ts timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (obra_id, placa));

-- BASE: la hoja tiene DOS tablas en una (ítems A–H y elementos J/K/L, con la fila de encabezados
-- detectada en tiempo de ejecución por getBaseData). Se importan por separado.
CREATE TABLE IF NOT EXISTS base_items (               -- CC → DESCRIPCION verbatim (+ unidad contractual)
  obra_id text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id), cc text NOT NULL, descripcion text NOT NULL DEFAULT '', unidad text NOT NULL DEFAULT '',
  orden integer NOT NULL DEFAULT 0, importado_ts timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (obra_id, cc, descripcion));
CREATE TABLE IF NOT EXISTS base_elementos (           -- ELEMENTO · ABS INICIO · ABS FIN (crudos, como los copia D68) · tipo derivado
  obra_id text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id), elemento text NOT NULL, abs_inicio text NOT NULL DEFAULT '', abs_fin text NOT NULL DEFAULT '',
  tipo text NOT NULL DEFAULT '', orden integer NOT NULL DEFAULT 0, importado_ts timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (obra_id, elemento, abs_inicio, abs_fin));

-- --- parte ---
CREATE TABLE IF NOT EXISTS parte_equipos (
  obra_id text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id), codigo text NOT NULL, tipo text NOT NULL DEFAULT '', placa text NOT NULL DEFAULT '',
  proveedor text NOT NULL DEFAULT '', medidor text NOT NULL DEFAULT '', ultima_fecha date, ultimo_final numeric, activo text NOT NULL DEFAULT '',
  ultimo_final_manual numeric, importado_ts timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (obra_id, codigo));
CREATE TABLE IF NOT EXISTS parte_operadores (
  obra_id text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id), operador text NOT NULL, partes_ult_4_meses numeric, activo text NOT NULL DEFAULT '',
  importado_ts timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (obra_id, operador));
CREATE TABLE IF NOT EXISTS parte_cc (
  obra_id text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id), centro_coste text NOT NULL, proyecto text NOT NULL DEFAULT '', descripcion_cc text NOT NULL DEFAULT '',
  usos_ult_4_meses numeric, activo text NOT NULL DEFAULT '', importado_ts timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (obra_id, centro_coste));
CREATE TABLE IF NOT EXISTS parte_items (              -- D174: actividad → ítem por tipo de equipo (varias frases por ítem)
  obra_id text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id), tipo_equipo text NOT NULL, item text NOT NULL, actividad text NOT NULL DEFAULT '',
  veces numeric, activo text NOT NULL DEFAULT '', importado_ts timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (obra_id, tipo_equipo, item, actividad));
CREATE TABLE IF NOT EXISTS parte_actividades (
  obra_id text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id), tipo_equipo text NOT NULL, descripcion_trabajo text NOT NULL, veces numeric,
  importado_ts timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (obra_id, tipo_equipo, descripcion_trabajo));

-- --- asistencias ---
CREATE TABLE IF NOT EXISTS cuadrillas (
  obra_id text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id), cuadrilla text NOT NULL, responsables text NOT NULL DEFAULT '',
  area text NOT NULL DEFAULT '', estado text NOT NULL DEFAULT '', importado_ts timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (obra_id, cuadrilla));
CREATE TABLE IF NOT EXISTS config (
  obra_id text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id), clave text NOT NULL, valor text NOT NULL DEFAULT '',
  importado_ts timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (obra_id, clave));
CREATE TABLE IF NOT EXISTS festivos (
  obra_id text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id), fecha date NOT NULL,
  importado_ts timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (obra_id, fecha));
CREATE TABLE IF NOT EXISTS turnos (
  obra_id text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id), turno text NOT NULL, tipo_dia text NOT NULL, entrada text NOT NULL DEFAULT '',
  salida text NOT NULL DEFAULT '', descanso_ini text NOT NULL DEFAULT '', descanso_fin text NOT NULL DEFAULT '', cruza_medianoche text NOT NULL DEFAULT '',
  importado_ts timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (obra_id, turno, tipo_dia));
CREATE TABLE IF NOT EXISTS cat_cc (
  obra_id text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id), string_cc text NOT NULL, orden integer NOT NULL DEFAULT 0,
  importado_ts timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (obra_id, string_cc));
CREATE TABLE IF NOT EXISTS cc_usados (
  obra_id text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id), string_cc text NOT NULL, area text NOT NULL DEFAULT '', orden integer NOT NULL DEFAULT 0,
  importado_ts timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (obra_id, string_cc, area));
CREATE TABLE IF NOT EXISTS cat_motivos (
  obra_id text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id), string_motivo text NOT NULL, orden integer NOT NULL DEFAULT 0,
  importado_ts timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (obra_id, string_motivo));
CREATE TABLE IF NOT EXISTS motivos_usados (
  obra_id text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id), string_motivo text NOT NULL, orden integer NOT NULL DEFAULT 0,
  importado_ts timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (obra_id, string_motivo));
CREATE TABLE IF NOT EXISTS cat_trabajadores (
  obra_id text NOT NULL DEFAULT 'tm2sur' REFERENCES obra(obra_id), codigo text NOT NULL, string_navision text NOT NULL DEFAULT '',
  importado_ts timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (obra_id, codigo));

INSERT INTO esquema_version (version, nota) VALUES (1, '001_esquema.sql · Fase 1 de 4.01 (D180): tablas por hoja, obra_id, claves e índices §5')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
