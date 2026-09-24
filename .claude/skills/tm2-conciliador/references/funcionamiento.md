# Cómo ejecuta el skill la herramienta (opción a: la misma lógica, sin port)

## Carga (`scripts/cargar_conciliador.js`)
- `vm` sobre `conciliador/conciliador.js` real, no `require`. Así se alcanzan `Paso1`, `Paso2` y
  `Exportes`, que el archivo no exporta. Como `module` no existe y `document` sí, corre el `init()`
  de la herramienta: `cargarConfig()` con sus migraciones, y luego `render()` sobre el DOM mínimo.
- Config: el JSON exportado de ⚙ se deja en `localStorage['conciliador_config_v1']`. Sin config →
  `configSeed()`.
- `XLSX` = npm `xlsx` 0.18.5, con `writeFile` redirigido a `--salida`. `toast()` se captura para mostrar
  los avisos.

## Orden (`scripts/conciliar.js`)
1. **Paso 1**: `XLSX.read(buf,{type:'buffer',cellDates:false})` → `Paso1._procesar(wb,tipo,archivo,'BASE 2026')`.
2. **Paso 2**: valores de `#selContratista/#qIni/#qFin` → `Paso2.abrir()`. Valida contratista, fechas y
   empresas vetadas.
3. **Paso 3**: `Paso3._procesarArchivo(wb,nombre)` por proforma → `Paso3._finCarga()`, que llama a
   `conciliarPendientes` y `_transferirDecisiones`. Con «sin proforma»: `#spIni/#spFin` → `Paso3.sinProforma()`.
   Con `--hoja`: `#selAmb_i_j` → `Paso3.resolverHoja(i,j)`, sin guardar la regla en la config.
4. **Paso 7**: `Exportes.xlsxActa/xlsxActaPend/xlsxDigitadora/xlsxResumen`, `resumenCorte()` y `sesionJSON(true)`.

## Lo que no se hace en Node y por qué
- Paso 5: `pdfPendientes`, OCR, visor. Necesitan `window.pdfjsLib`, `window.PDFLib`, tesseract y
  `canvas`. Las funciones puras de imagen (`rojezPx`, `binarizaAdaptativa`, `tokensTiquete`) están
  cubiertas por los arneses `backend/pruebas/verificar_conciliador_ocr_*.js`, pero extraer los píxeles de
  un PDF exige navegador. Un headless (Playwright) contra `index.html` sería posible, pero eso ya es la
  herramienta y no aporta sobre usarla.
- Paso 6: son decisiones humanas auditadas. El skill no las toma.

## Si algo falla
- Error al cargar: amplía el stub (`nodo()` en `cargar_conciliador.js`), nunca la herramienta. Si hace falta
  refactorizarla (opción b), propón el ítem del backlog y no la toques.
- Contratista no encontrado: `--lista-contratistas` con la misma `--config`.
