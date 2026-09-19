# Pruebas de CONTRATO (Fase 1 · migración 4.01 · D180)

Un solo juego de peticiones GET/POST con su respuesta esperada, extraído de los 36 arneses
`verificar_*.js`, que corre **contra el `vm`** (los `.gs` reales con hojas en memoria) **o contra una
URL** (el Worker `api.galca.app/prueba`, un `/exec` de Google, o —en las Fases 2–4— el backend nuevo).
Es el criterio de salida de cada fase: *«el arnés de contrato en verde contra la nueva API»*.

```
node backend/pruebas/contrato/correr.js                                   # vm (por defecto)
node backend/pruebas/contrato/correr.js --url=https://api.galca.app/prueba --usuario=admin --clave=…
node backend/pruebas/contrato/correr.js --url=… --usuario=… --clave=… --escribir     # también escrituras
node backend/pruebas/contrato/correr.js --solo=parte --caso='parte\.ciclo' --verboso
```

| Archivo | Qué es |
|---|---|
| `arnes.js` | Servicios de Apps Script de mentira (`hojaFalsa`, caché, HMAC real), `apiVm`, `apiUrl`, ejecutor de casos y comprobadores de forma. |
| `semillas.js` | Hojas mínimas para el modo `vm` (mismos encabezados que los `.gs`). |
| `casos_obra.js` · `casos_asistencias.js` · `casos_parte.js` | Los casos, uno por endpoint o regla de contrato. |
| `correr.js` | CLI. Sale con 1 si algo falla. |
| `servidor_local.js` | Sirve el backend `vm` por HTTP con las rutas del Worker (`/obra`, `/asistencias`, `/parte`) para probar el modo `url` sin red, o abrir las pantallas contra un backend de mentira. |

## Cómo está armado un caso

```js
{ id:'parte.ciclo', modulo:'parte', escribe:true, nombre:'…',
  async run(api, t){
    const r = await api.parte.post({ op:'reporte', codigo:'VOL048', tramos:[…] });
    t.ok('guardadas:1', r.ok===true && r.guardadas===1, r);
  } }
```

`api` no sabe en qué modo corre: `api.obra.get(params)` · `api.obra.post(body)` · `api.asistencias.*` ·
`api.parte.*` (= obra con `mod=parte`) · `api.sesion('admin'|'capataz'|'jefe'|'residente')` devuelve un
token firmado (en `vm` lo emite `emitirToken_`; en `url` sale de `action=login` con las credenciales
que se pasen) · `api.hoy` · `api.FECHA_BANCO` · `api.uuid()`.

Banderas de un caso:

- `escribe:true` — escribe en el destino. Contra una URL solo corre con `--escribir`. Usa siempre
  `FECHA_BANCO = 2020-01-13` (un lunes que ningún dato real comparte) y se limpia solo donde el contrato
  lo permite: asistencias reenvía la cuadrilla con `filas:[]` (borra el bloque), extras se borran con
  `extras_admin_delete`, las filas del Parte quedan `descartado` (nunca se borran, es la regla de la hoja).
  Lo que **queda** en el destino: 3 filas en BANDEJA/MAQUINARIA/VOLQUETAS y unas pocas en PARTE_BANDEJA,
  todas con fecha 2020-01-13. Contra producción no se corre con `--escribir`.
  Los casos `obra.data_grid.*` (V3-08b/D181/D182, solo Worker) leen y corrigen las filas de `data` que siembra
  `semillas.js` (`seed-data-1` y `seed-dg-*`, 2020-01-20…30), que carga el banco (`worker/pruebas/contrato_local.js`):
  contra otra URL fallan porque no encuentran esas semillas. `alta_d182` da de baja sus altas al terminar; `alta_deriva`
  (D181) deja 1 fila con fecha 2025-09-20.
  Los casos `obra.proyeccion.*` (V3-11/D183, solo Worker; en vm se omiten) leen las semillas de
  `006_proyeccion.sql`. `tablero_paridad` corre antes de cualquier escritura y compara `proyeccion_tablero` con
  los valores del Excel del jefe, así que contra una base donde ya se editó la Proyección falla a propósito.
  Las escrituras del plan van sobre periodos de banco (2020-01…2020-03) y se dan de baja al terminar.
  `editar_banco` corrige contrato, rendimientos y parámetros solo contra el banco local (127.0.0.1) y los
  restaura; contra otra URL se omite.
  Los casos D184 (solo Worker; en vm se omiten, porque el `.gs` deja esas celdas vacías): `obra.enviar_data.d184_tierras`
  y `obra.enviar_data.d184_drenajes` envían en las fechas de banco 2020-06-15 y 2020-06-16 (el borde 15/16) y limpian
  con un reenvío vacío; `obra.data_grid.fc_d184` da de alta una fila el 2020-06-16 y la da de baja al terminar. En el
  banco local esas fechas caen en las actas de banco `B06`/`B07` que siembra `semillas.js` en `periodos`; contra
  una URL sin ellas, la ACTA esperada sale de la misma regla (vacía, antes del acta 1). `semillas.js` trae además 7
  filas de DATA de banco (2020-06-10, 2020-06-20 y 2020-08-03) para los casos SQL de `007_data_completa.sql`
  (`worker/pruebas/casos_sql.js`).
  Los casos D185 (V3-11 Fases B+C, solo Worker; en vm se omiten): `obra.tablero_vivo.publico` (GET sin token,
  la forma de `leerProduccion`, la proyección sin `usuario`, ningún nombre de persona, y el día sembrado =
  Σ CANTIDAD), `obra.tablero_vivo.cache` (la segunda lectura anónima es `HIT` con el mismo cuerpo, el token de
  jefe/admin da `BYPASS` y deja su respuesta en la caché, y el residente lee como el público; en el banco usa
  una caché en memoria, y se omite si el destino no tiene Cache API, `X-Tablero-Cache: SIN`, como el sandbox),
  `obra.tablero_horas.guardar` (`escribe:true`: admin/jefe guardan, residente/capataz no, rechazo legible de una forma inválida; **solo contra el banco local**, para no pisar las
  horas guardadas de `/prueba`), `obra.proyeccion.sin_conciliacion` (la Proyección vuelve a la forma de D183:
  sin `conciliacion` ni columnas «DATA al corte»/«Diferencia»), y los de la regla [O],
  `obra.enviar_data.ajuste_origen_d185` y `obra.data_grid.ajuste_origen_d185` (FC 1 en «ajuste origen», en
  la fecha de banco 2020-07-09; limpian al terminar). `semillas.js` suma filas de DATA de banco el 2020-07-07
  (pliegue) y el 2020-07-08 ([O]) para los casos SQL `obra.sql.008.*` y `obra.sql.007.ajuste_origen_d185`.
- `soloVm:true` — mira el estado interno (`api.hojas`), gasta el rate limit o necesita un perfil que
  no hay contra la URL. Se omite fuera del `vm`.
- `perfil:'admin'` — se omite si no hay credenciales de ese perfil. En modo `url` solo existe `admin`
  (`--usuario/--clave` o `CONTRATO_USUARIO`/`CONTRATO_CLAVE`); más perfiles con `--perfil.capataz=usuario:clave`.

Los casos omitidos se listan pero **no cuentan como fallo**.

## Qué se comprueba (resumen)

- **obra**: puerta única (sin token / firma alterada → `{ok:false, auth:false, error:'Sesión no válida. Vuelve a entrar.'}`),
  `login` (rechazo único, `payload`, token+rol+redirige), `tablero` público, forma de `cubicaje`,
  `bandeja`, `consolidado` (día y rango: `header` A–T + `actividad`, `cols.COPY_END=15`), `estado`,
  `volquetas`, `drenajes`, `tramos`, `maquinas`, `flota`, `acumulado_drenajes`, `maquinaria_produccion`;
  validación D166 (`error:'payload'` + `campo`), reporte de capataz idempotente (D82: `duplicadas`),
  chequeadora con volquetas (D53), `enviar_data` (clima obligatorio en tierras, D130; sin sello desde D182;
  D184: ACTA de la fecha, ESPESOR 1, FC de la actividad y CANTIDAD, en tierras y drenajes),
  `data_grid` (V3-08b/D181: derivación, `if_version`, rol; D182: columnas, ocultos, clima del día; D184: FC por
  actividad en `actividades[]` y valores por defecto de ESPESOR/FC en alta y corrección),
  `proyeccion` y `proyeccion_tablero` (V3-11/D183: forma, paridad con el Excel, ciclo alta → corrección →
  conflicto → duplicado → baja → re-alta sin repetir versión (ABA), `if_version` obligatorio y entero, fórmula
  que viaja con su número, rechazos legibles, lote atómico, solo admin y jefe editan; D185: sin conciliación),
  `tablero_vivo` público y su caché de 60 s, `tablero_horas_guardar` (V3-11/D185), la regla [O] (FC 1 en
  «ajuste origen») en `enviar_data` y `data_grid`, guards de
  `flota_guardar`/`tablero_guardar`, rate limit y LOG (solo vm).
- **asistencias**: el token de obra vale (mismo secreto), `roster`, `asistencia` (compactado `{cols, datos}`
  y `ccv`, D133), `personal`, `export`, `ausencias`, `persona`, `persona_admin`, `extras_admin`,
  acción desconocida, validación, ciclo `reporte_asistencia` → leer → borrar, ciclo `extras_admin` (tope D124),
  guards de `personal`.
- **parte**: selector de equipos (D173b), ficha (`habituales ≤ 5`, ítems «02.10», alias de operadores,
  pseudo-CC, topes), validación y `error:'equipo'`, ciclo completo reporte → bandeja → revisar →
  base (`estado=todos` vs aprobado), reenvío duplicado, reparto por % y `op=repartir` (D178), permisos.

## Cuando llegue el backend nuevo (Fases 2–4)

1. Levantar la nueva API en `/prueba/<ruta>` y correr `correr.js --url=https://api.galca.app/prueba --usuario=… --clave=… --escribir`.
   Con `--url` el Parte va por `<base>/parte` (la ruta de las pantallas y la que conmuta `BACKEND_PARTE`); el login sigue en `<base>/obra`.
   Sin red: `node worker/pruebas/contrato_local.js` (PGlite + backfill del volcado + el Worker real, solo parte).
2. Todo lo que salga en rojo es una diferencia de contrato: se arregla en el Worker, **no** en el caso
   (salvo que el caso describa un comportamiento que D-xxx haya cambiado a propósito; entonces se
   actualiza el caso citando la decisión).
3. Los 36 arneses `verificar_*.js` siguen valiendo para la lógica interna; este juego cubre la superficie.
