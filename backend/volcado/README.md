# Volcado Sheet → CSV (Fase 1 · 4.01)

`VolcadoCSV.gs` es un Apps Script **independiente** (no se pega en `Codigo.gs` ni en
`CodigoAsistencias.gs`; los `.gs` de producción no cambian) que lee cada hoja con `getValues()` y deja
un CSV por hoja en Drive, en `Galca_volcado/tm2sur/<yyyy-MM-dd_HHmm>_<obra|asistencias>/`, junto con
un `manifiesto.json` (filas, columnas, encabezados, bytes por hoja).

1. script.google.com → Nuevo proyecto → pegar el archivo → guardar.
2. Ejecutar `volcarObra()`, `volcarAsistencias()` o `volcarTodo()` (o `volcarHoja('obra','PARTE_BANDEJA')`).
   La primera vez pide permisos de Sheets y Drive con la cuenta dueña de los Sheets.
3. Descargar la carpeta y cargar con la receta de `worker/sql/README.md`.

Opcional: `programarVolcadoDiario()` instala un trigger a las 03:00 (Bogotá), después del respaldo de las 02:00.

Formato: UTF-8, coma, comillas RFC 4180, primera fila = encabezados tal cual la hoja, fechas
`yyyy-MM-dd`, timestamps `yyyy-MM-dd HH:mm:ss` (hora de Bogotá), números con punto, vacío = `''`.
Solo lee; nunca escribe en los Sheets.
