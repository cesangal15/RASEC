# Cómo ejecuta el skill la herramienta (opción a: la misma lógica, sin port)

## Carga (`scripts/cargar_reparto.js`)
- Lee `Reparto_Produccion_Maquinaria.js`. Desde D170 el HTML ya no lleva `<script>` en línea, así que se
  lee el `.js` externo. Lo corre en un `vm` con:
  - un DOM mínimo por `getElementById`. La herramienta no usa `querySelector`. Los `value`/`checked`
    iniciales se leen de los `<input>` del **HTML real**.
  - `XLSX` = paquete npm `xlsx` 0.18.5, la misma versión que la página carga de cdnjs. `writeFile` se
    redirige a `--salida`.
  - `localStorage` simulado con la config bajo `tm2_reparto_cfg_v1`. La aplica el arranque de la propia
    herramienta (`leerCfg` → `aplicarCfg`, D148).
  - `esc()` se toma de `tema.js`. Solo sirve para pintar avisos.
- Los libros se leen con `XLSX.read(buf,{type:'buffer',cellDates:true})`, las mismas opciones que `armarCarga`.

## Orden de ejecución (`scripts/reparto.js`)
1. `S.prod.wb` / `S.jefe.wb` ← los dos libros.
2. `detectarCorte()`: FECHAS DE CORTE del libro del jefe o rango del parte. Es lo que hace la pantalla al cargar el parte.
3. Clic real en **`btnProc`**: `leerParams → leerProduccion → leerClima → leerJefe → repartir → render`.
   Los avisos de `render()` se leen de `#avisos` y se muestran en texto.
4. Clic real en **`btnXlsx`**: `aoaFactJefe(true)`, `aoaReparto()` y `aoaCuadre()`, y luego
   `XLSX.writeFile(…, 'fact_jefe_<desde>_<hasta>.xlsx')`.

## Entradas que espera la herramienta (leídas por texto, no por posición fija)
- Reporte diario: hoja `hojaProd` (fábrica `dia suelto`): fila 4 = UF, fila 5 = actividad, datos desde la
  fila 6 con la fecha en la col. A. Clima: hoja `hojaClima` (fábrica `DATOS`).
- Parte del jefe: hoja `hojaJefe` (fábrica `BASE MAQUINARIA`) en formato diario, con los encabezados
  resueltos por texto (`HDR_PARTE`), o parte mensual por bloques.

## Salida
- `fact_jefe`: 29 columnas A:AC (`CAB_FACT`). Las de cálculo del modelo van vacías. Col. B con fecha `dd/mm/yyyy`.
- `reparto`: agregado por máquina·proyecto·ítem·sub.
- `cuadre`: por CC, leída vs repartida vs diferencia.

## Si algo falla
- `ReferenceError`/`TypeError` al cargar: la herramienta empezó a usar una API del navegador que el stub no
  tiene. Amplía el stub en `cargar_reparto.js`, nunca la herramienta. Si eso exige refactorizar la
  herramienta (opción b), no la toques: propón el refactor como ítem del backlog.
- «No encontré la hoja…»: el nombre de hoja de la config no coincide. Revisa `hojaProd`/`hojaJefe`.
- Los arneses viejos `backend/pruebas/verificar_reparto_*.js` extraen `<script>` en línea del HTML y hoy
  fallan por eso (anterior a este skill). Este skill no depende de ellos.
