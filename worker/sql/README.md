# `worker/sql` — esquema Postgres de la migración 4.01 (D180)

`001_esquema.sql` crea, en Supabase (Postgres), **una tabla por hoja transaccional** de los dos Sheets,
con `obra_id` en todas, las claves de negocio que hoy son implícitas y los índices de §5 del informe.
Es idempotente (`CREATE … IF NOT EXISTS`); se aplica desde el editor SQL de Supabase o con
`psql "$SUPABASE_URL" -f worker/sql/001_esquema.sql`. Probado contra Postgres 16.

## Hoja → tabla

| Sheet | Hoja | Tabla | Clave primaria | Índices |
|---|---|---|---|---|
| obra | BANDEJA | `bandeja` | `(obra_id, id_registro)` | `(fecha)`, `(fecha, area)`, `(fecha, proyecto)` |
| obra | DATA | `data` (+ vista `data_maestro` con los encabezados exactos A–T) | `(obra_id, id_registro)` | `(fecha)`, `(fecha, area)`, `(centro_de_costo, fecha)` |
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

`esquema_version` lleva el número del último archivo aplicado; el siguiente cambio de esquema es `002_….sql`.

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
carga inicial y `importado_ts` pasa a significar «última carga». El único espejo BD→Sheet es la vista `data_maestro`.

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

1. `001_esquema.sql` y `002_fases_3_4.sql` (editor SQL de Supabase o `psql -f`), en ese orden.
2. `backfill_parte.js` (si la BD es nueva; en la BD de producción ya está hecho y NO se repite).
3. `backfill_obra.js` con el ÚLTIMO volcado `*_obra` (siempre `--simular` primero).
4. `backfill_asistencias.js` con el ÚLTIMO volcado `*_asistencias`.
5. Depurar duplicados históricos de `asistencia` por persona/día (criterio de `_duplicadosRango_`) antes de abrir el export.
6. `BACKEND_OBRA` / `BACKEND_ASISTENCIAS` = `db` en `wrangler.toml` + `wrangler deploy`. Desde ese momento no se edita el Sheet.

Una fila con fecha/número/timestamp que no se entienda **no se carga** y sale como aviso (D106); el resto de la tabla
sí. `worker/pruebas/contrato_local.js` aplica los mismos `0*.sql`, los tres backfills y las semillas del arnés
(`worker/pruebas/semillas_sql.js`) contra PGlite para el banco local.
