# `worker/sql` — esquema Postgres de la migración 4.01 (D180)

`001_esquema.sql` crea, en Supabase (Postgres), **una tabla por hoja transaccional** de los dos Sheets,
con `obra_id` en todas, las claves de negocio que hoy son implícitas y los índices de §5 del informe.
Es idempotente (`CREATE … IF NOT EXISTS`); se aplica desde el editor SQL de Supabase o con
`psql "$SUPABASE_URL" -f worker/sql/001_esquema.sql`. Probado contra Postgres 16.

## Hoja → tabla

| Sheet | Hoja | Tabla | Clave primaria | Índices |
|---|---|---|---|---|
| obra | BANDEJA | `bandeja` | `(obra_id, id_registro)` | `(fecha)`, `(fecha, area)`, `(fecha, proyecto)` |
| obra | DATA | `data` (A–T + internas) + vista `data_maestro`: en `001`, los encabezados exactos A–T; desde `005` (D182), las 17 columnas del maestro (sin ORDEN/PROYECTO/LIBERACION/Columna1, con CLIMA del día) | `(obra_id, id_registro)` | `(fecha)`, `(fecha, area)`, `(centro_de_costo, fecha)` |
| obra | MAQUINARIA | `maquinaria` | `(obra_id, app_id_registro)` | `(fecha)`, `(fecha, id_maquina)`, `(id_cantidad)`, `(id_maquina, fecha)` |
| obra | VOLQUETAS | `volquetas` | `(obra_id, id_registro)` | `(fecha)` |
| obra | OBSERVACIONES | `observaciones` | `(obra_id, id_registro)` | `(fecha)` |
| obra | MAQUINAS | `maquinas` | `(obra_id, id_maquina, fecha_ingreso)` | `(fecha_ingreso, fecha_retiro)` |
| obra | TABLERO | `tablero` (una fila por obra, `foto` en jsonb) | `(obra_id)` | — |
| obra | USUARIOS | `usuarios` | `(obra_id, usuario)` | — |
| obra | LOG | `log` (`modulo='obra'`) | `log_id` | `(fecha_hora)`, `(usuario, action, fecha_hora)` |
| obra | PARTE_BANDEJA | `parte_bandeja` | `(obra_id, id_registro)` | `(fecha)`, `(estado, fecha)`, `(codigo, fecha DESC, hora_a DESC) WHERE estado<>'descartado'` |
| obra | PARTE_EQUIPOS / OPERADORES / CC / ITEMS / ACTIVIDADES · BASE · CUBICAJE | `parte_equipos` … · `base_items` + `base_elementos` · `cubicaje` | por su clave natural | — (catálogos: se reescriben por pull) |
| asistencias | ASISTENCIA | `asistencia` | `(obra_id, id_registro)` | `(fecha, cuadrilla)`, `(fecha, codigo)`, `(fecha, cedula)`, `(codigo, fecha)`, `(cuadrilla, fecha)` |
| asistencias | PERSONAL | `personal` | `(obra_id, personal_id)` (surrogate) | `(codigo)`, `(cedula)`, `(cuadrilla)` |
| asistencias | EXTRAS_ADMIN | `extras_admin` | `(obra_id, fecha)` | — |
| asistencias | NOTAS_ASISTENCIA | `notas_asistencia` | `(obra_id, fecha, cuadrilla)` | — |
| asistencias | LOG | `log` (`modulo='asistencias'`) | | |
| asistencias | CUADRILLAS, CONFIG, FESTIVOS, TURNOS, CAT_CC, CC_USADOS, CAT_MOTIVOS, MOTIVOS_USADOS, CAT_TRABAJADORES | tabla homónima en minúsculas | clave natural | — |

Decisiones que el archivo fija y por qué están en su cabecera (obra_id con DEFAULT, nombres de hoja en
snake_case, `text` para horas `'07:00'`, PK solo donde el código ya usa esa identidad, `ON CONFLICT DO
NOTHING` para la cola offline, catálogos con `importado_ts`).

## Backfill desde los CSV del volcado (`backend/volcado/VolcadoCSV.gs`)

Los CSV salen con los encabezados de la hoja, UTF-8, RFC 4180, fechas `yyyy-MM-dd` y timestamps
`yyyy-MM-dd HH:mm:ss` en hora de Bogotá. Receta con `psql` (`\copy` lee el archivo desde tu máquina):

```sql
SET timezone = 'America/Bogota';   -- los timestamps del CSV son hora local; sin esto se leen como UTC

-- Tabla cuyas columnas se llaman igual que la hoja (todas menos DATA): HEADER MATCH exige el orden de la hoja.
\copy parte_bandeja (id_registro,"timestamp",estado,fecha,codigo,tipo,placa,medidor,reporte_num,inicial,final,total,inicial_modificado,horas_varada,horas_lluvia,hora_de,hora_a,descripcion_trabajo,centro_coste,pr,uf,operador,observaciones,alertas,revisado_por,revisado_ts,origen)
  FROM 'PARTE_BANDEJA.csv'
  WITH (FORMAT csv, HEADER MATCH, NULL '',
        FORCE_NOT_NULL (estado,codigo,tipo,placa,medidor,reporte_num,inicial_modificado,hora_de,hora_a,descripcion_trabajo,centro_coste,uf,operador,observaciones,alertas,revisado_por,origen));

-- DATA: los encabezados del CSV son los del maestro («CENTRO DE COSTO»…); se mapean por posición.
\copy data (fecha,orden,grupo,centro_de_costo,capitulo,descripcion,unidad_funcional,proyecto,elemento,abs_inicial,abs_final,liberacion,acta,unidad_medida,largo,espesor,fc,cantidad,observacion,columna1,id_registro,"timestamp",capataz,rol,actividad,pk_inicial,pk_final,area,clima)
  FROM 'DATA.csv'
  WITH (FORMAT csv, HEADER, NULL '',
        FORCE_NOT_NULL (orden,grupo,centro_de_costo,capitulo,descripcion,unidad_funcional,proyecto,elemento,abs_inicial,abs_final,liberacion,acta,unidad_medida,observacion,columna1,capataz,rol,actividad,pk_inicial,pk_final,area,clima));
```

Regla de la receta: `NULL ''` convierte el vacío en NULL (lo que quieren `date`/`numeric`/`timestamptz`)
y `FORCE_NOT_NULL (…)` lista las columnas de texto para que el vacío se quede en `''` (son `NOT NULL DEFAULT ''`).

Lo que hay que resolver **antes** de cargar cada hoja (queda para la fase que la migre):

- **Ids en blanco**: filas de BANDEJA/MAQUINARIA/VOLQUETAS anteriores a D82 pueden traer `id_registro`/`app_id_registro`
  vacío, y DATA regenera el id en cada envío. Se cargan primero en una tabla de paso (`CREATE TABLE _bandeja_csv (LIKE bandeja)`
  sin PK) y se insertan con `COALESCE(NULLIF(id_registro,''), gen_random_uuid()::text)`.
- **Duplicados** que hoy tolera la hoja (ASISTENCIA por persona, PERSONAL): no rompen la carga (no hay UNIQUE),
  se depuran con `diagnosticoDuplicados*` antes o con una consulta después.
- **Fechas como texto** en columnas `date` (`'15/07/2026'`): el volcado saca `yyyy-MM-dd` de las celdas
  Date; una celda que sea TEXTO sale tal cual y la carga fallará ahí, que es lo que se quiere (D106).
- **TABLERO**: no se carga por CSV (trozos); se vuelve a publicar desde la pantalla.
- **LOG**: no se migra (retención 30 días); se carga solo si se quiere conservar el histórico.

`esquema_version` lleva el número del último archivo aplicado. Hoy van de `001` a `009` (ver «003 · 004 · 005», «006»,
«007» y «008» abajo, y **`009_grupo_flota.sql`** = D190: columna `grupo` en `maquinas`, disciplina tierras/drenajes
ORTOGONAL a `frente`; idempotente `ADD COLUMN IF NOT EXISTS`). El Worker tolera que `grupo` aún no exista —la lectura
de flota cae a un SELECT sin `grupo`—, pero **aplica `009` antes de desplegar** el Worker que escribe `grupo` en el alta.

## Backfill del Parte con el script (Fase 2)

La receta `\copy` de arriba sigue valiendo, pero para la Fase 2 hay un script que hace lo mismo sin `psql`,
con las conversiones ya resueltas (timestamps de Bogotá, vacío → NULL, duplicados por clave) y en una
transacción por tabla:

```
$env:DATABASE_URL = "postgres://…"                                              # solo en esta terminal, nunca en un archivo del repo
node worker/sql/backfill_parte.js --volcado="C:\Galca\volcado\2026-09-15_2252_obra" --simular
node worker/sql/backfill_parte.js --volcado="C:\Galca\volcado\2026-09-15_2252_obra"
node worker/sql/backfill_parte.js --volcado=… --solo=maquinas,parte_cc          # solo esas tablas
```

| CSV | Tabla | Modo |
|---|---|---|
| PARTE_BANDEJA | `parte_bandeja` | anexar: `ON CONFLICT (obra_id, id_registro) DO NOTHING` (nunca pisa filas que el Worker ya creó) |
| PARTE_EQUIPOS · PARTE_OPERADORES · PARTE_CC · PARTE_ITEMS · PARTE_ACTIVIDADES | `parte_*` | reescribir (DELETE por obra + INSERT), como hará el pull del ESPEJO. Valores crudos: «2.1» se guarda así y el Worker lo normaliza a «02.10» al leer (D178) |
| MAQUINAS | `maquinas` | reescribir (la flota vigente que espera el Parte, D173) |
| BASE | `base_items` | reescribir: solo la tabla de ítems A–H (CC → DESCRIPCIÓN), detectada como en `getBaseData`. Los elementos J/K/L son de la Fase 4 |

Una fila con fecha/número/timestamp que no se entienda **no se carga** y sale como aviso (D106); el resto
de la tabla sí. `worker/pruebas/contrato_local.js` usa este mismo módulo contra PGlite para el banco local.

## Fases 3 y 4 (D180): `002_fases_3_4.sql` y los tres backfills

`002_fases_3_4.sql` ajusta el esquema para obra y asistencias (idempotente: comprueba `pg_index` /
`information_schema` antes de cada `ALTER`; correrlo dos veces no cambia nada). Se aplica DESPUÉS de `001`
y ANTES de cualquier backfill de obra/asistencias:

| # | Qué cambia | Por qué |
|---|---|---|
| 1 | `volquetas`: PK surrogate `volqueta_id bigserial` + índice `(obra_id, id_registro)` | `id_registro` es el id de la LÍNEA y lo comparten sus placas (Codigo.gs L1183): 379 ids para 1962 filas. El Worker deduplica por línea con `SELECT EXISTS (id_registro, fecha)`, no con `ON CONFLICT` |
| 2 | `base_elementos`: columna `uf` (col M) y PK `(obra_id, orden)` | 10 marcadores ODT repetidos; una fila = un elemento, como `getBaseData` L746 |
| 3 | `base_items`: `capitulo`, `grupo`, `uf`, `proyecto`, `orden_hoja` | para editar el catálogo en el Table Editor de Supabase |
| 6 | `COMMENT` en `data.area`: nunca vacía desde 4.01 | el backfill la deriva del CC (`deriveArea`, L2211) y `enviarData` borra por `(obra_id, fecha, area)` |
| 7 | comentarios de `bandeja.estado`, `volquetas.cubicaje_origen`, `personal.estado` | alineados con los valores reales (`no_data`, `default`, `eventual`) |

Los catálogos (`cubicaje`, `base_*`, `usuarios`, `cuadrillas`, `config`, `festivos`, `turnos`, `cat_*`, `*_usados`,
`parte_*`) se editan desde 4.01 en Supabase (Table Editor), no en el Sheet: **no hay pull Sheet→BD**; el backfill es la
carga inicial y `importado_ts` pasa a significar «última carga». No hay espejo BD→Sheet: la vista `data_maestro` es la
superficie de solo lectura que leerá Power Query (V3-09), con el layout D182 desde `005_data_clima.sql`.

### Los tres scripts

Comparten `backfill_lib.js` (conversión por tipo, `ftime` para horas, uuid determinista cuando la clave viene vacía,
carga por nombre o por POSICIÓN, `cargarTabla` con una transacción por tabla) y el mismo CLI:
`--volcado=<carpeta>`, `--solo=tabla,tabla`, `--simular`, conexión por `DATABASE_URL` o `--conexion-archivo`.

```
$env:DATABASE_URL = "postgres://…"            # solo en esta terminal, nunca en un archivo del repo
npm run backfill:parte        -- --volcado="C:\Galca\volcado\2026-09-16_0027_obra" --simular
npm run backfill:obra         -- --volcado="C:\Galca\volcado\2026-09-16_0027_obra" --simular
npm run backfill:asistencias  -- --volcado="C:\Galca\volcado\<sello>_asistencias"  --simular
```

| Script | CSV → tabla | Modo |
|---|---|---|
| `backfill_parte.js` (Fase 2, ya en producción) | PARTE_* → `parte_*` · MAQUINAS → `maquinas` · BASE → `base_items` (4 cols) | ver arriba |
| `backfill_obra.js` (Fase 4) | BANDEJA → `bandeja` · DATA → `data` (por posición A–AC; `area` '' → `deriveArea(CC)`) · MAQUINARIA → `maquinaria` · OBSERVACIONES → `observaciones` | anexar `ON CONFLICT DO NOTHING`; id vacío → uuid determinista (archivo+línea+contenido) |
| | VOLQUETAS → `volquetas` | anexar sin `ON CONFLICT` (PK surrogate); al relanzar salta las filas cuya `(id_registro, placa, origen, destino)` ya esté |
| | TABLERO → `tablero` | une los trozos 1..n (sin el `~`), fila 0 = `meta`, `publicado_ts` = `meta.generado` (Bogotá); `ON CONFLICT (obra_id) DO UPDATE`; si falta un trozo no carga |
| | USUARIOS → `usuarios` · CUBICAJE → `cubicaje` (por posición, `normPlaca`) · BASE → `base_elementos` (J–M, `tipo = baseTipo`, `orden` = fila) y `base_items` (9 cols) | reescribir por obra |
| | LOG → `log` (`modulo='obra'`) | solo con `--solo=log` |
| `backfill_asistencias.js` (Fase 3) | ASISTENCIA → `asistencia` (17 cols; `hora_*` con `ftime`; `presente` '' → 'Si'; fecha inválida → aviso) · EXTRAS_ADMIN → `extras_admin` (tipo fuera de diurna/nocturna/domfest → aviso) · NOTAS_ASISTENCIA → `notas_asistencia` | anexar `DO NOTHING` |
| | PERSONAL → `personal` (`fila_sheet` = línea del CSV) | reescribir SOLO si la tabla está vacía; si no, anexar saltando las que ya estén |
| | CUADRILLAS, CONFIG (`ftime` en valores hora), FESTIVOS, TURNOS (`ftime`), CAT_CC, CC_USADOS, CAT_MOTIVOS, MOTIVOS_USADOS (`orden` = fila), CAT_TRABAJADORES | reescribir por obra |
| | LOG → `log` (`modulo='asistencias'`) | solo con `--solo=log` |

`backfill_obra.js` NO carga MAQUINAS ni `parte_*` (ya los cargó `backfill_parte.js` y están vivos: una recarga pisaría
ediciones hechas desde Flota o el Table Editor). El volcado de asistencias sale de `volcarAsistencias()`
(`backend/volcado/VolcadoCSV.gs`); mientras no exista en disco, el script está probado con un CSV sintético.

### Orden de carga para el corte

1. `001_esquema.sql`, `002_fases_3_4.sql` y `003_grupo_flota.sql` (editor SQL de Supabase o `psql -f`), en ese orden. `003` es idempotente y aplica también a la BD viva (solo añade la columna `grupo` a `maquinas`).
2. `backfill_parte.js` (si la BD es nueva; en la BD de producción ya está hecho y NO se repite).
3. `backfill_obra.js` con el ÚLTIMO volcado `*_obra` (siempre `--simular` primero).
4. `backfill_asistencias.js` con el ÚLTIMO volcado `*_asistencias`.
5. Depurar duplicados históricos de `asistencia` por persona/día (criterio de `_duplicadosRango_`) antes de abrir el export.
6. `BACKEND_OBRA` / `BACKEND_ASISTENCIAS` = `db` en `wrangler.toml` + `wrangler deploy`. Desde ese momento no se edita el Sheet.

Una fila con fecha/número/timestamp que no se entienda **no se carga** y sale como aviso (D106); el resto de la tabla
sí. `worker/pruebas/contrato_local.js` aplica los mismos `0*.sql`, los tres backfills y las semillas del arnés
(`worker/pruebas/semillas_sql.js`) contra PGlite para el banco local.

## 003 · 004 · 005 — grilla, DATA editable y CLIMA del día (V3-08 · V3-08b · D182)

Van en cadena después de `002`: `001 → 002 → 003 → 004 → backfills → 005`. Las tres son idempotentes: correrlas
dos veces no cambia nada.

| Archivo | Qué hace | Cuándo |
|---|---|---|
| `003_grilla.sql` (V3-08/D181) | `base_elementos.version` (if_version) y `no_operativo` (los dos «ajuste a origen») | antes de los backfills |
| `004_data_editable.sql` (V3-08b/D181) | `data.version`/`editado_por`/`editado_ts` y la tabla `periodos` con las 17 actas (ACTA ← FECHA) | antes de los backfills |
| `005_data_clima.sql` (D182) | (1) mueve el sello `[Clima: X]` de la OBSERVACIÓN a `data.clima` donde el clima estaba vacío; (2) limpia la observación (regex de `CLIMA_SELLO_RE`) con `version+1`; (3) `DROP` + `CREATE` de `data_maestro` sin ORDEN/PROYECTO/LIBERACION/Columna1 y con `"CLIMA"` del día (el de la fila o el primero no vacío de la fecha por `"timestamp"` NULLS LAST, `id_registro`) antes de `"OBSERVACION"`; (4) re-otorga el `SELECT` a `tm2_lector_maestro` si el rol existe | **con la DATA ya cargada**, porque mueve datos. En producción, una vez después del `wrangler deploy` de D182 |

Las columnas `orden`/`proyecto`/`liberacion`/`columna1` **siguen en la tabla** `data`: `005` solo las saca de la
vista, y el copiado del jefe al Excel actual las usa (desde D184, ORDEN y ACTA viajan siempre vacías en ese copiado para
que «Omitir blancos» respete las fórmulas del Excel). **Ojo:** volver a correr `001` sobre una BD con `005` falla
en su `CREATE OR REPLACE VIEW data_maestro`, porque no puede renombrar columnas, y no aplica nada. Antes hay que
hacer `DROP VIEW data_maestro;` y, después de `001`, volver a correr `005`. El banco (`contrato_local.js`) y el
sandbox (`tools/sandbox/servidor.mjs`) vuelven a aplicar `005` después de cargar los datos, igual que en Supabase.
`worker/pruebas/casos_sql.js` comprueba el sello movido, la idempotencia y los encabezados de la vista.

## 006 — Proyección editable en Galca (V3-11 Fase A · D183)

`006_proyeccion.sql` va después de `005` (`… → backfills → 005 → 006`); no transforma datos, así que el banco y el
sandbox la aplican una sola vez con el resto de `0*.sql`. Idempotente: `CREATE … IF NOT EXISTS`, `CREATE OR REPLACE VIEW`
y semillas que solo entran si la obra no tiene ninguna fila en esa tabla (re-aplicarla no pisa lo editado ni resucita
una fila borrada).

| Objeto | Qué es |
|---|---|
| `proy_plan` | plan mensual en m³ compactos por periodo 16→15 (`periodo` = día 1 del mes de CIERRE = ACTA), 5 partidas + `formulas` jsonb; 17 filas de CALCULOS A3:J19 |
| `proy_contrato` | programado y producción de la línea base por partida × UF (préstamo sin UF); 9 filas de MAPEO I8:M16 |
| `proy_rendimiento` | rendimiento compacto por equipo-día (850/450/350/470, MAPEO J27:N27) |
| `proy_parametros` | FC único (1.3) y acta base (22 → corte 2026-08-16, derivado de `periodos`) |
| `proy_plan_version_seq` | secuencia de las versiones del plan: el alta y cada corrección toman `nextval` (no 0 / `version+1`), así un periodo borrado y vuelto a crear nunca repite versión (sin ABA) |
| `proyeccion_{plan,contrato,rendimiento,parametros}_maestro` | vistas espejo para Power Query con los encabezados literales del Excel |

Las 4 tablas llevan RLS (sin políticas, como las de producción) y `version`/`editado_por`/`editado_ts`. Un bloque `DO`
da `SELECT` de las 4 vistas a `tm2_lector_maestro` si existe y quita todo a `anon`/`authenticated` si existen (una vista
corre como su dueño y saltaría el RLS): las 4 tablas, las 4 vistas, la secuencia y también **`data_maestro`**, que ni
`001` ni `005` cerraban (`005` la recrea y los permisos por defecto de Supabase se la vuelven a dar; si se re-corre `005`,
re-correr `006` después). `roles_lectura_maestro.sql` da los mismos `GRANT` si las vistas ya existen.
**Regla (D183):** toda migración que recree una vista `*_maestro` repite su bloque `DO` de permisos.
`worker/pruebas/verificar_d183_proyeccion.mjs` comprueba encabezados, valores, idempotencia y permisos.

## 007 — DATA completa: ACTA de la fecha y FC por actividad (D184)

`007_data_completa.sql` va después de `006` y, como `005`, **con la DATA ya cargada** (`… → backfills → 005 → 006 → 007`):
rellena datos. El banco (`contrato_local.js`) y el sandbox (`tools/sandbox/servidor.mjs`) la vuelven a pasar después de
cargar la DATA (`MIGRACIONES_DE_DATOS`), igual que `005`. En producción se pasa **dos veces** en el despliegue de D184:
una **antes** del front y del `wrangler deploy`, para que el Worker nuevo ya encuentre `fc_actividad` (sin la tabla
trataría todo como FC 1, y ese FC escrito `007` ya no lo rellena), y otra después, tras `005` y `006`, para completar lo
que el Worker viejo mandó entre medias (con él la primera pasada es inocua: no lee `fc_actividad`). Tras cualquier
backfill de DATA se repiten `005`, `006` y `007`, en ese orden: `006` vuelve a quitar a `anon`/`authenticated` el
acceso a `data_maestro` que `005` recrea (desde D185 se añade `008` al final: ver «008»). Idempotente: la segunda pasada no encuentra nada que rellenar y no re-siembra. Registra `esquema_version` 7.

| Objeto | Qué es |
|---|---|
| `fc_actividad` | FC (suelto→compacto) por DESCRIPCIÓN de actividad, el más usado en el histórico de DATA del Excel. Tabla **propia** (un backfill de `base_items` no la borra); sin fila = FC 1. Semillas: las 7 descripciones con 1.3 (terraplén, aprovechable, no aprovechable, préstamo, subbase, base estabilizada, conformación), verbatim de la BASE, con el conteo en `nota`. RLS y `REVOKE` a `anon`/`authenticated` si existen. `version`/`editado_por`/`editado_ts` |
| relleno de `data` | **solo donde falta, nunca pisa un valor**, salvo la regla [O] de la fila siguiente (obra `tm2sur`): `acta` `''` → la del periodo 16→15 de la fecha (`periodos` o la fórmula `(año_cierre − 2025)·12 + mes_cierre + 2`; `< 1` → `''`); con `largo`: `espesor` NULL → 1, `fc` NULL → `fc_actividad` por descripción normalizada (como `normTexto`) o 1, `cantidad` NULL → `round(largo·espesor/fc, 6)`; `version+1` una sola vez por fila tocada |
| regla [O] (D185, enmienda D184) | en las filas cuyo `elemento` es un subtramo **no operativo** (los dos «ajuste origen UF1/UF2»: bandera `no_operativo` de `003` por elemento normalizado, o nombre `^ajuste origen`): `fc` NULL con `largo` → **1** y `fc` ≠ 1 → **1** con `cantidad = round(largo·espesor, 6)`. Es la única corrección que **pisa** un valor, y va en el mismo `UPDATE`, con `version+1` una sola vez. Idempotente: una vez en 1, no vuelve a tocar la fila. Con la DATA real, 35 filas |

Las semillas entran solo la primera vez (guarda: `esquema_version` sin la 7) y fila a fila si no existen: re-aplicar `007`
no pisa un FC editado ni resucita una fila borrada, ni vaciando la tabla entera (más estricta que la guarda «tabla vacía»
de `006`). Las mismas reglas usan el Worker (`api/obra/periodos.js` · `actaDeFecha`, `catalogos.js` · `fcActividad_`) en
`enviar_data` y en la Revisión de DATA. `worker/pruebas/casos_sql.js` comprueba semillas, relleno, idempotencia, permisos,
que no resucita y que la ACTA de 007 = `actaDeFecha` = la de `proyeccion_plan_maestro` (D183) mes a mes.
`fc_actividad` se edita por ahora en el Table Editor de Supabase (guía en `docs/OPERACIONES.md` §13, «Cambiar un FC»); un
cambio vale para los envíos y correcciones siguientes y no reescribe las filas de `data` que ya tienen FC.

## 008 — Tablero en vivo desde la DATA (V3-11 Fases B+C · D185)

`008_tablero_vivo.sql` va después de `007` (`… → backfills → 005 → 006 → 007 → 008`). **No transforma datos**, así que el
banco y el sandbox la aplican una sola vez con el resto de `0*.sql`, sin re-aplicarla tras cargar la DATA. En producción va
**una vez antes del front y del `wrangler deploy` de D185**, justo después de la primera pasada de `007`. Con el Worker
viejo es inocua, y el Worker nuevo la encuentra ya. Tras un backfill de DATA se puede repetir al final de `005 → 006 → 007`,
y no cambia nada. Sin `008`, `GET ?action=tablero_vivo` responde `ok:false` con «falta aplicar
worker/sql/008_tablero_vivo.sql» y el Tablero enseña la foto publicada. Guía: `docs/OPERACIONES.md` §16.

| Objeto | Qué es |
|---|---|
| `tablero_mapeo` | MAPEO A2:C10 del Excel del jefe: qué DESCRIPCIÓN de DATA (texto verbatim de la BASE) va a qué campo del Tablero, por UF. `apr`/`pre`/`nap` (aprovechable, préstamo, no aprovechable) con UF `*`; `ter`/`sub`/`bas` (terraplén, subbase, base estabilizada) con UF1 y UF2. PK `(obra_id, descripcion, uf)`. Cruce por descripción normalizada (la misma expresión que `normTexto` y `007`); una fila con UF concreta gana a la de `*`. 9 semillas, solo la primera vez (guarda: `esquema_version` sin la 8) y fila a fila si no existen: re-aplicar no pisa un mapeo editado ni resucita uno borrado. `version`/`editado_por`/`editado_ts` |
| `tablero_horas` | una fila por obra con la salida cruda de `leerHoras` del libro de partes (`{partes, cc, corte, descartadas, negativas}`: códigos de máquina, tipos, UF, CC y horas; **sin nombres de personas**), que admin/jefe suben con `POST tablero_horas_guardar`. Se guarda **comprimida** `{z:<gzip base64>}`, como la foto de `tablero` (la real pesa ~340 KB y comprimida ~20 KB). `archivo`, `cargado_por` (no sale en la lectura pública), `cargado_ts` y `version` |
| vista `tablero_data_campo` | cada fila de `data` con su **CANTIDAD compacta** (la de la fila; si está vacía, `largo · coalesce(espesor,1) / coalesce(nullif(fc,0),1)`) y el **campo** que le da `tablero_mapeo` (NULL = no cuenta para el Tablero). Es el único cruce DATA → Tablero, y la lee el pliegue del Worker (`api/obra/pliegue.js`, sumas en numeric por fecha y campo) |
| permisos | RLS en las dos tablas (sin políticas: el Worker entra como dueño) y `REVOKE ALL` a `anon`/`authenticated`, si existen, de las tablas **y de la vista**, porque una vista corre como su dueño y se saltaría el RLS. No es una vista `*_maestro`: `tm2_lector_maestro` no la ve y `roles_lectura_maestro.sql` no cambia |

Registra `esquema_version` 8. `worker/pruebas/casos_sql.js` comprueba el esquema y las semillas (`obra.sql.008.esquema`),
que el pliegue por fecha × campo = Σ CANTIDAD calculado aparte en JS (`obra.sql.008.pliegue`) y que re-aplicarla no cambia
nada (`obra.sql.008.idempotente`); la regla [O] de `007` la comprueba `obra.sql.007.ajuste_origen_d185`.
`worker/pruebas/verificar_d185_tablero_vivo.mjs` comprueba lo mismo contra la DATA del sandbox o contra la hoja DATA de una
copia del Excel (`--excel=`). `tablero_mapeo` se edita en el Table Editor de Supabase. Si la BASE cambia el texto de
una de esas descripciones, hay que cambiarlo aquí también, o esa actividad deja de contar en el Tablero.

## `importar_maestro.js` — carga única de la hoja DATA del Excel maestro (D186)

La tabla `data` de producción solo tiene lo que mandó la app desde el 17-jun-2026; la hoja DATA del Excel del jefe
tiene todo desde el 1-ago-2025, más lo que él agrega o corrige a mano, los drenajes y los «ajuste origen». Antes de
conectar el Excel por Power Query (`docs/OPERACIONES.md` §14, **Paso 0**) se copia **una vez** la hoja a Galca. **Hasta
la fecha de corte manda el Excel**; después, todo se edita en Galca y se deja de usar «Copiar».

```powershell
$env:DATABASE_URL = "postgres://…"    # o --conexion-archivo=<ruta fuera del repo>; con --simular puede faltar
node worker/sql/importar_maestro.js --excel="<copia>.xlsx" --hasta=YYYY-MM-DD --simular     # no escribe: Excel vs Galca por mes
node worker/sql/importar_maestro.js --excel="<copia>.xlsx" --hasta=YYYY-MM-DD [--respaldo=<carpeta>] [--sin-migraciones]
```

| Paso | Qué hace |
|---|---|
| lectura | Hoja DATA A:T con SheetJS (`tablero-xlsx.js` en un `vm`), **valores calculados** de las fórmulas; el `.xlsx` nunca se escribe. Comprueba los encabezados (normalizados: `LIBERACION ` con espacio vale); si no son los del maestro, aborta. FECHA serial/Date/texto → `yyyy-mm-dd` sin corrimiento de zona; sin fecha → se salta y se cuenta; < 2025-01-01 o > hoy → aviso; > `--hasta` → se cuenta y se ignora. Texto con trim; un número en columna de texto (ORDEN, ACTA, ABS…) → texto sin decimales espurios; LARGO/ESPESOR/FC/CANTIDAD → number o NULL. Celdas con datos fuera de A:T → aviso |
| mapeo | Las 20 columnas A–T + `id_registro` = `'mae-'` + `uuidDeterminista(fecha, nº de fila, contenido)` (relanzar da los mismos ids) · `timestamp`/`editado_ts` now() · `capataz` 'maestro' · `rol` 'importacion' · `actividad` = descripción · `pk_*` = ABS · `area` = `deriveArea(CC)` · `clima` '' · `version` 0 · `editado_por` 'importacion D186'. El sello `[Clima: X]` de la observación lo mueve `005` |
| escritura | Una transacción: `esquema_version` ≥ 8 (si no, aborta) → **respaldo** CSV (UTF-8 con BOM, `;`, todas las columnas) de las filas de `data` con fecha ≤ corte en `--respaldo` (por defecto la carpeta actual), `respaldo_data_<hasta>_<yyyymmdd-hhmmss>.csv`, releído y contado → `DELETE … fecha <= hasta` (tantas como el respaldo) → INSERT por lotes de 500 → COMMIT |
| después | Salvo `--sin-migraciones`, re-aplica `005 → 006 → 007 → 008` y muestra qué hizo cada una. Verificación: por mes, filas y Σ LARGO de `data` (≤ corte) = Excel, y los ids `mae-…` sin duplicados; ✓/✗ y código 1 si no cuadra |

Es también un módulo (`importarMaestro(sql, opciones)`, `leerMaestro`, `verificar`). `worker/pruebas/verificar_d186_importar_maestro.mjs --excel=<copia>` lo prueba con PGlite: semillas de la app antes y después del corte, `--simular` sin cambios, meses y Σ LARGO = un cálculo aparte de la hoja, la app posterior al corte intacta, el respaldo con las filas borradas, `005`/`007` aplicadas, relanzar idempotente y una BD sin `008` que aborta sin tocar nada.
