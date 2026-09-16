# Pruebas de CONTRATO (Fase 1 · migración 4.01 · D178)

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
  chequeadora con volquetas (D53), `enviar_data` (clima obligatorio en tierras, D130), guards de
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
2. Todo lo que salga en rojo es una diferencia de contrato: se arregla en el Worker, **no** en el caso
   (salvo que el caso describa un comportamiento que D-xxx haya cambiado a propósito; entonces se
   actualiza el caso citando la decisión).
3. Los 36 arneses `verificar_*.js` siguen valiendo para la lógica interna; este juego cubre la superficie.
