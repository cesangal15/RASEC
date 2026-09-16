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
