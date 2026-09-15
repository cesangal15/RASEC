# Semillas del Parte Digital de Maquinaria (V3-01 / D165)

Cuatro CSV que siembran los catálogos del módulo en el **Google Sheet de obra** (el mismo de
BANDEJA/DATA; ID `1OEAZCcj_kgVS6jWXxOSgyvm57sOsJ7fA1mRTJPU-icM`). Son CSV con coma y UTF-8, y su
**encabezado coincide con el de la hoja** que crea `setupParte()`, así que se importan tal cual.

## Orden (una sola vez)

1. En el editor de Apps Script del proyecto de obra: pegar `backend/CodigoParte.gs` como archivo
   nuevo y aplicar las dos líneas de enrutado de `Codigo.gs` (buscar `D165`). Ejecutar
   **`setupParte()`** → crea `PARTE_EQUIPOS`, `PARTE_OPERADORES`, `PARTE_CC`, `PARTE_ACTIVIDADES`
   y `PARTE_BANDEJA` con sus encabezados.
2. En el Sheet, con cada hoja abierta: **Archivo → Importar → Subir → «Reemplazar hoja actual»**:
   - `PARTE_EQUIPOS_semilla.csv`      → hoja `PARTE_EQUIPOS`
     (`codigo,tipo,placa,proveedor,medidor,ultima_fecha,ultimo_final,activo`; `ultimo_final` es el
     arranque del primer día: en cuanto el equipo tenga una fila en `PARTE_BANDEJA`, manda esa).
     Los que traen `medidor=REVISAR` se guardan igual y salen con la alerta `SIN_MEDIDOR`: corregir
     la columna a `HOROMETRO` o `KM` cuando se sepa. Las 6 filas sin `tipo` (GQW139, SJQ401, SKY629,
     SRO556, TAR538, TTS230) vienen así del Excel: completar `tipo` para que tengan sugerencias.
   - `PARTE_OPERADORES_semilla.csv`   → hoja `PARTE_OPERADORES` (nombres ya normalizados; **los
     duplicados tipo `Aleyxer Rincon`/`Aleyxer Rincón`, `Wilmar Pahuana`/`Wilmar Pawana`/`Wilmer
     Pahuana`, `Yerson Sandobal`/`Yerson Sandoval` los depura el usuario** — el código no los funde;
     para retirar uno basta `activo=NO`).
   - `PARTE_CC_semilla.csv`           → hoja `PARTE_CC` (`descripcion_cc` viene vacía: se puede
     completar a mano y el buscador del formulario la muestra).
   - `PARTE_ACTIVIDADES_frecuentes.csv` → hoja `PARTE_ACTIVIDADES` (solo sugerencias, por tipo).
   - **`PARTE_ITEMS_semilla.csv` → hoja `PARTE_ITEMS` (D174):** `tipo_equipo,item,actividad,veces,activo`.
     La tabla actividad → ítem por tipo de equipo: la «máscara» que ve el operador (elige «Terraplén»
     y el CC sale solo: ítem + proyecto por PR). Sembrada del histórico de BASE MAQUINARIA (UF1-UF2,
     16-mar → 10-sep-2026, ítems con ≥3 partes). Las `actividad` en blanco las rellena el backend con
     la descripción del ítem de la BASE; **dueño: Jeisson** — corrige nombres, quita lo que no aplique
     y añade una fila cuando aparezca un ítem nuevo (o `activo=NO` para esconderla).
3. Volver a ejecutar **`setupParte()`**: repone las columnas que el CSV no trae (`activo`,
   `ultimo_final_manual`) y agrega los pseudo-CC `Taller` · `Disponible` · `Domingo/Festivo` a
   `PARTE_CC` (el código los ofrece aunque falten; en la hoja quedan para que se vean).
4. Redesplegar: Implementar → Administrar implementaciones → editar → **Nueva versión** (misma URL).
5. Los QR **ya están generados en `qr/`** (D171: `qr/etiquetas.pdf`, un PNG por equipo activo con tipo, inventario `qr/LISTADO.md`) con la URL base confirmada `https://tm2.galca.app`. Solo hay que imprimir. Para regenerar tras cambiar `activo` o dar de alta un equipo: exportar `PARTE_EQUIPOS` como CSV y `python3 tools/generar_qr.py --csv <archivo>` (ver `qr/README.md`).

**D171 (sep-2026):** `PARTE_EQUIPOS` es además el **catálogo único de máquinas** del sistema: el reporte del capataz toma de aquí sus chips de equipo.

**D173 (sep-2026):** `PARTE_EQUIPOS` es la **FICHA** de cada equipo (quién es: placa, proveedor, medidor, último medidor). **Quién está en obra lo dice la hoja `MAQUINAS`** (una fila por estancia con `fecha_ingreso`, `fecha_retiro` y `frente`; semilla `backend/seeds/MAQUINAS.tsv`, se administra desde Maquinaria › Flota). El parte espera cada día a los equipos vigentes ese día en el frente UF1-UF2; `activo` de esta hoja solo manda si `MAQUINAS` está vacía. La semilla trae `activo=SI` en los 25 vigentes al 15-sep-2026 y `NO` en el resto (histórico y UF3), pero no hace falta mantenerla a mano: un alta desde la Flota crea la ficha si falta.

`activo` vacío cuenta como activo en las cuatro hojas. Todo se lee **por nombre de columna**, así que
se pueden añadir columnas al final sin tocar código.
