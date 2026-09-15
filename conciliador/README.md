# Conciliador de Cortes de Transporte — TM2 Sur (V1)

Herramienta **standalone** para el corte quincenal de transporte de volquetas
(~10-12 contratistas). Corre **100% en el navegador** (GitHub Pages o `file://`),
sin backend: los archivos nunca salen del equipo. Producto **independiente** del
sistema de reporte diario (no toca `Codigo.gs`, `reporte-capataz.html`, etc.).

**Filosofía:** nunca asumir ante la incertidumbre. Todo lo dudoso va a revisión
manual con evidencia visible. El sistema propone, César decide.

## Archivos

```
conciliador/
  index.html       ← abrir este archivo (CSS embebido, carga conciliador.js)
  conciliador.js   ← toda la lógica
  README.md
```

Librerías por CDN (versiones fijadas): SheetJS 0.18.5 (eager), pdf.js 3.11.174,
tesseract.js 5.1.1 y pdf-lib 1.17.1 (lazy: solo se descargan al entrar al Paso 5
o al generar el PDF de pendientes). Se necesita internet la primera vez que el
navegador las descarga; después quedan en caché del navegador.

## Flujo quincenal

| Paso | Qué haces | Qué hace el sistema |
|---|---|---|
| 1 · Cargar bases | Seleccionas `GRANULARES.xlsx` y `TERRAPLEN.xlsx` (copias locales) | Lee SOLO la hoja `BASE 2026` (si no existe, te pide señalarla), corta en la última fila con remisión, muestra filas útiles y rango de fechas. Quedan en memoria para todos los contratistas de la sesión. |
| 2 · Abrir corte | Eliges contratista + quincena | Rechaza empresas vetadas (ORTIZ, VOLKETSA, Betulia). Un contratista a la vez. |
| 3 · Cargar proforma | 1..N `.xlsx` del contratista | Auto-detecta encabezado (títulos arriba, alias de columna), enruta hojas por patrones (PUTANA→GRANULARES, INTERNO→interno, Hoja1→ignorar…), explota celdas multi-remisión, detecta pares sospechosos "¿lista o rango?" y concilia al instante. Hoja no reconocida → tú la señalas (y guardas la regla). El botón "cambiar" de cada hoja reasigna la base **o la saca del corte con IGNORAR** (reversible mientras no recargues la página). |
| 4 · Conciliación | Revisas el tablero por estados | Llave cerrada: remisión exacta (texto, ceros incluidos) + empresa ∈ alias + fecha ≥ mínima. 0 candidatos → NO_ENCONTRADA (con sugerencias: "existe con otra empresa" y "existe en la otra base"); 1 → clasificador (solo UF3 excluye; áreas PLANTA/PUENTE/TM1/ODT… van al acta con observación); >1 → eliges tú. Si una hoja entera parece estar en la base equivocada, sale un aviso con un botón para cambiarla de ámbito y re-conciliar. |
| 5 · Investigación PDF | Cargas los PDFs de partes, marcas el **ámbito** de cada uno y corres el OCR | Cada PDF lleva un ámbito **"Partes de…"** (Granulares / Terraplén / Mezclado; sugerido por el nombre del archivo con las mismas reglas de hojas del contratista, marca *auto* hasta que lo confirmes): sus páginas se cruzan ÚNICAMENTE con las faltantes de esa base — un número parecido de la otra base ya no genera candidatos falsos ni vuelve la página "candidata" en la cobertura; "Mezclado (ambas)" busca contra todas (comportamiento anterior, y el default cuando el nombre no da señal). Cambiar el ámbito poda los candidatos incompatibles y re-cruza al instante (los comprobantes ya confirmados no se tocan). En la revisión guiada las faltantes de la otra base quedan plegadas ("N faltantes de la otra base ocultas"), a un clic por si el ámbito estaba mal. Búsqueda dirigida SOLO de las no-encontradas (listadas de menor a mayor por número de remisión, en la lista lateral y en los botones del modal de revisión): pasada roja por franjas (número impreso arriba-derecha, 1–3 partes/página), **pasada C para el tiquete de báscula** (presentación nueva de PUTANA: el número se lee de su rótulo, ver abajo) y pasada gris de respaldo a página completa (AVENSA). Verde = exacto, naranja = 1 dígito. NUNCA auto-confirma: tú ves la página y decides (Confirmar / Es ASFALTO / No es). Además, el panel "Cobertura del OCR por página" muestra la vista inversa: páginas SIN lectura o cuyo número no coincide con nada reclamado. El botón **"▶ Revisar contra las faltantes"** las recorre una por una: ves el parte, la lista de faltantes sin confirmar como botones (≈ marca las que están a 1 dígito de lo leído) y con UN clic confirmas el comprobante; o pulsas **"✕ No es ninguna faltante"** y la página se descarta de la lista (es reproceso: remisión que ya está en la base). Las descartadas se pueden ver y restaurar con ↩ (y corregir su lectura las re-abre). El ✏️ para corregir la lectura del OCR sigue disponible (si el número corregido es una faltante pasa a candidato; si es de una remisión ya conciliada, la página sale de la revisión). Por revisar y descartadas salen en el resumen del Paso 7. Navegador manual de páginas siempre disponible (**visor «Hojear»**, ver abajo). **Un renglón por PÁGINA (ago-2026):** si el OCR leía en la misma hoja el número exacto y otro a un dígito, la página salía dos veces; ahora se fusionan en un solo candidato (mejor nivel, con las lecturas de la página a la vista) y el contador verde/naranja de la lista de faltantes cuadra con lo que se pinta. |
| 6 · Resolución manual | Decides las dudosas | Cola de revisión manual, múltiples, duplicadas y alertas de internos >3 km. Cada transición queda auditada (estado anterior/nuevo, fecha-hora, nota). |
| 7 · Exportes | Copias/descargas | Bloque acta (TSV al portapapeles + .xlsx), **bloque acta de PENDIENTES** (mismo modelo A..S con lo que sabe la proforma y CC propuesto — ver abajo), Excel digitadora y PDF de pendientes — ambos en el MISMO orden: fecha de la proforma de menor a mayor y, dentro del día, remisión de menor a mayor (páginas deduplicadas), para que la digitadora trabaje renglón a página — y resumen del corte. |

**Ciclo digitadora:** cuando la digitadora digite los comprobantes enviados,
recarga las bases (Paso 1): se re-corren SOLO las `NO_ENCONTRADA` y
`PENDIENTE_DIGITACION`; las que ya aparecen pasan a `ENCONTRADA` con nota
"resuelta en re-conciliación". Las decisiones manuales no se tocan.

## Estados

`PENDIENTE → ENCONTRADA | NO_ENCONTRADA | MULTIPLE_EN_BASE | DUPLICADA_EN_PROFORMA | EXCLUIDA_UF3 | EXCLUIDA_OTRA_AREA | REVISION_MANUAL`

Desde investigación/manual: `NO_ENCONTRADA → PENDIENTE_DIGITACION | EXCLUIDA_ASFALTO | RECHAZADA | ACEPTADA_MANUAL` (nota obligatoria).

**Solo excluyen UF3 y ASFALTO** (decisión jul-2026). Las áreas PLANTA, PUENTE,
TM1, AMP, RCD, ODT…, etc. **NO excluyen**: la remisión va al acta como
`ENCONTRADA` con la marca `AREA_OBSERVADA` y la observación "área X" en la
columna S. (`EXCLUIDA_OTRA_AREA` queda solo como estado legado/manual.)

Al acta van **solo** `ENCONTRADA` + `ACEPTADA_MANUAL`. Marcas transversales que
no cambian el estado: `REZAGO` (nunca se excluye sola), `CELDA_MULTIPLE`,
`MATCH_SIN_CEROS` (queda en revisión hasta confirmar), `INTERNO_MAYOR_3KM`,
`AREA_OBSERVADA`.

### ¿Hoja en la base equivocada?

Caso real: un archivo de PUTANA con la hoja llamada `CORTE CLIENTE 2026` — el
patrón `CORTE` la enruta a TERRAPLÉN y nada matchea. El sistema no se
auto-corrige (filosofía: nunca asumir), pero te lo hace evidente por tres vías:

1. **Aviso de hoja sospechosa** (Pasos 3 y 4): si la mayoría de las
   no-encontradas de una hoja SÍ existen en la otra base con tu contratista,
   aparece un banner con el botón "Cambiar a X y re-conciliar".
2. **Botón "cambiar"** junto al ámbito de cada hoja en el Paso 3 (re-concilia
   las reclamaciones de esa hoja que no tengan decisión manual y puede guardar
   la regla en la config del contratista).
3. En el detalle de cada NO_ENCONTRADA: bloque "existe en la otra base" con el
   candidato listo para usar con un clic.

### ¿Y si la hoja no va al corte? — IGNORAR (corrección ago-2026)

El mismo botón **"cambiar"** ofrece **IGNORAR (fuera del corte)** además de las
dos bases. Antes, IGNORAR solo aparecía en el selector de una hoja **no
reconocida**, así que una hoja que el patrón sí enrutó —caso real: `FRESADO`
enrutada a GRANULARES porque el archivo trae de todo— no se podía sacar: había
que ignorarla a mano fila por fila. Ahora:

- IGNORAR **quita del corte TODAS las reclamaciones de esa hoja**, incluidas las
  decididas a mano (por eso pide confirmación diciendo cuántas son y cuántas
  tenían decisión manual). Una hoja fuera del corte no puede dejar filas sueltas
  en el acta.
- Con "guardar regla" marcado, la hoja queda en la config del contratista como
  `IGNORAR` y las próximas proformas la saltan solas. La regla **reemplaza** la
  anterior de esa misma hoja, no se apila encima.
- Es **reversible**: una hoja IGNORADA conserva su botón "cambiar" y al
  asignarle una base se **re-extrae del archivo** y se re-concilia. El contenido
  del .xlsx vive solo en memoria (no se guarda en localStorage), así que tras
  recargar la página hay que volver a cargar ese archivo — la herramienta lo
  avisa en vez de dejar la hoja vacía.

Verificación: `node backend/pruebas/verificar_conciliador_ignorar_hoja.js`.

### Filas ENCONTRADAS a medias (completar con la proforma)

Si la remisión matchea la base (remisión + empresa + fecha) pero la fila está
**incompleta** porque la chequeadora apenas la digita, el match ya prueba que
el PDF existe. El acta rellena SOLO las celdas **sin dato** de esa fila con los
valores derivados de la proforma (mismo motor que el bloque de pendientes:
CC/UF, actividad-material, placa, kilometrajes, cantidad, m³·km, unidad) y lo
marca en Observaciones ("completada con proforma (CC, km totales…)"). Nunca
pisa lo que la chequeadora ya tecleó, solo llena huecos. Se calcula en vivo:
cuando ella termine y recargues las bases (Paso 1), el dato real de la base
gana solo y la marca desaparece. El Paso 7 avisa cuántas filas se completaron
y las lista en el resumen del corte.

**Celda "sin dato" = vacía, en 0, o con error de fórmula** (decisión jul-2026).
**Ninguna columna del acta admite 0**: no existe casilla donde un cero tenga
sentido (ni cantidad/cubicaje, ni kilometrajes, ni m³·km, ni CC/placa/UF). Así
que un `0` — el que la digitadora deja de paso en el cubicaje mientras completa
el renglón — y un `#¡VALOR!` / `#N/A` / `#REF!` (el XLOOKUP de la hoja sin
resolver, típico en la columna del CC) **no cuentan como valor**: se tratan
igual que una celda vacía y se rellenan con la proforma. Formatos reconocidos
como cero: `0`, `"0"`, `"0,00"`, `"0.00"` y el `-` del formato contable.

Consecuencias:

- El CC con `#¡VALOR!` ya **no se copia tal cual al acta**: se reemplaza por el
  CC propuesto desde la proforma (mismo motor de prefijo por PK + sufijo por
  material del bloque de pendientes) y de ahí se deriva la UF.
- Un factor en 0 tampoco genera derivados: `m³·km = km totales × cantidad` solo
  se calcula si ambos son distintos de 0.
- La proforma tampoco puede aportar ceros: si su cantidad/PK viene en 0, se
  descarta igual (no se cambia un 0 de la base por un 0 de la proforma).
- Si ni la base ni la proforma tienen el dato, la celda va **VACÍA** al acta
  —nunca 0 ni `#¡VALOR!`— con la marca `FALTA POR TECLEAR (cantidad, CC…)` en
  Observaciones. El Paso 7 las lista en un aviso naranja (remisión · fecha ·
  celdas) y el resumen del corte las repite, para teclearlas antes de firmar.
- En el detalle de la reclamación, las celdas del candidato que son 0 o error
  salen en naranja con la etiqueta `sin dato`, y un aviso resume qué rellenó la
  proforma y qué queda por teclear.

## Bloque acta (contrato de pegado)

Columnas A..S del acta con las derivadas **vacías** (A `X`, B `Acta No.`, D, E,
N `Km Stand by`, O `Total Km a pagar`): después de pegar, arrastra tus fórmulas.
Filas ordenadas por fecha y luego remisión. La remisión se exporta como TEXTO
(conserva `0348`, soporta `CH6199`).

- **Copiar bloque (TSV):** pegado directo en Excel. Los decimales usan coma
  (`decimalTSV` en la config; cámbialo a `"."` si tu Excel usa punto).
- **Descargar .xlsx:** mismos valores con números reales (sin problema de locale).

El mapeo acta↔bases vive en `actaLayout` dentro de la configuración (editable),
no está quemado en el código. Para las filas que vienen de la base se exporta
lo que dice la base (el cálculo `PK/1000+2.5` de granulares NO se recalcula);
ese cálculo sí se aplica en el bloque de PENDIENTES (ver `kmPorOrigen` abajo).

### Bloque acta de PENDIENTES de digitación (tarjeta 1b)

Los `PENDIENTE_DIGITACION` **con comprobante confirmado** salen en un bloque
APARTE con el mismo modelo A..S, llenado como lo hace César a mano (solo las
derivadas A/B/D/E/N/O van vacías): fecha C, actividad G = material de la
proforma **traducido a como lo escribe la base** (`nombreBase` del mapeo
`ccPorMaterial`: SUBBASE→"Sub base", BTC→"BTC", crudo→"Crudo de río"…; en
terraplén queda tal cual la proforma), remisión I, placa J, cantidad P;
observación S = "PENDIENTE DIGITACIÓN · comprobante archivo p.N · área X".
Cada proforma trae formato propio, así que la columna de material se detecta
por alias (`tipo material`, `tipo de material`, `material transportado`… —
ampliables en la config); si la proforma trae `KM` / `TOTAL M3/KM` propios,
se capturan y se usan SOLO como respaldo cuando las reglas de César no pueden
calcular (el acta paga las reglas propias, no lo que reclame el contratista). **Kilometrajes:** K = origen
(en GRANULARES el texto tal cual: "Planta Putana", "AVENSA"…; en TERRAPLEN la
abscisa en metros), L = PK destino en metros. La abscisa se normaliza a metros
venga como venga en la proforma (`pkMetros`): "PR 16+500"→16500, **km con
decimales "10.25"→10250 / "26,1"→26100 / "37.6"→37600**, "16"→16000,
"33800"→33800 — así la resta de distancia siempre corre y el PK para el CC se
lee bien (antes "10.25" se quedaba tal cual y la fórmula no ejecutaba). **M Km
totales** con las
reglas verificadas contra la BASE 2026 (config `kmPorOrigen`, editable):
origen Putana → PK destino/1000 + 2,5; Avensa → 25,7 fijo y Pekin → 67,5 fijo
(siempre van al PK33); resto → |destino − origen|/1000 (abscisas en metros).
**Q m³·Km = Km totales × cantidad** y R unidad como la escribe la base
cargada (`m3/km` en GRANULARES, `m3km` en TERRAPLEN). Sin datos suficientes
la celda queda vacía y la llena César. El **CC (col. H)** es propuesta
automática que César confirma o corrige en la tarjeta (marca `auto` naranja
hasta editarlo):

- Área **ajena** (el **destino** o la observación de la proforma mencionan
  PUENTE, PLANTA, TM1, AMP, RCD… = todo lo no nuestro que no se excluye) →
  **CC fijo `3701.11.03`** (decisión jul-2026). Editar el área re-fija el CC.
  **El ORIGEN no se mira nunca (corrección ago-2026):** es el sitio de CARGUE
  —siempre nuestro, la planta de Putana— y la proforma lo escribe "PLANTA" a
  secas, así que su texto disparaba área ajena en filas propias (en la proforma
  DS_Q_JUL_15-25 eso eran las 119, todas con cargue "PLANTA" y descargue en
  abscisa: salían con CC `3701.11.03` en vez del CC por material). Por defecto
  la propuesta es **nuestra** (área vacía) y César marca a mano las de
  puente/planta.
- **Nuestros**: CC = prefijo por PK del destino (PK≤30→3701, PK>30→3702) +
  **sufijo por MATERIAL** (mapeo `ccPorMaterial` en la config, levantado de
  las BASE 2026 reales jul-2026): GRANULARES — sub base→`.03.02`,
  TDA→`.03.03`, BTC/base→`.03.04`, crudo de río→`.02.11`, piedra
  filtro→`.06.03`, PSI 4000/28 MPa→`.06.09`, PSI 2000/14 MPa→`.06.07`;
  TERRAPLEN — todo→`.02.11` (transporte explanaciones; el `.02.10` es por
  distancia ≤1 km y queda a corrección manual). El material sale de la
  columna `material` de la proforma (alias configurables) y, si no existe,
  de destino/origen/obs/nombre de hoja. **El MATERIAL manda sobre el ámbito
  de la hoja (corrección ago-2026):** el ámbito dice en qué BASE buscar la
  remisión, no qué ítem se paga. Antes la regla se buscaba solo en la lista
  del ámbito propio y, como la de TERRAPLEN tiene una sola regla COMODÍN
  (patrón vacío, matchea cualquier texto), toda hoja que no fuera GRANULARES
  —incluidas las **AMBAS**, las de nombre de mes, que por definición mezclan
  los dos— proponía `.02.11` para cualquier material: una remisión de SUB BASE
  de Putana salía `3702.02.11` en vez de `3702.03.02` y la col. G quedaba con
  el texto crudo de la proforma en vez de "Sub base". Ahora la columna
  `material` se contrasta contra las reglas específicas de los DOS ámbitos y
  el comodín queda siempre de última; el respaldo por texto libre
  (destino/origen/obs/**nombre de hoja**) sigue acotado al ámbito propio salvo
  en AMBAS, para que una hoja de terraplén llamada "…BASE…" no mande sus filas
  sin material a `.03.04`. El **ámbito efectivo** de la fila (el que elige el
  catálogo de CC de respaldo y la unidad de la col. R) pasa a GRANULARES
  cuando la regla que aplicó es de granulares. Las variaciones `06.*`/`07.*` de
  ODT/ODL son puntuales y raras → corrección manual. Con material pero sin
  PK se propone el CC más frecuente de la base cargada que cierre con ese
  sufijo; sin señal → vacío, lo pone César. La UF (col. F) se deriva del
  prefijo del CC. UF3 (`3703.*`) no aplica: se excluye del corte.

El área/CC editados persisten en la sesión (`actaPend` del reclamo). Ojo al
reproceso: cuando la digitadora los digite y se recarguen las bases, esas
remisiones pasan a `ENCONTRADA` y salen también en el bloque 1 — no pegarlas
dos veces (la tarjeta lo advierte).

## Configuración (⚙️ Config)

JSON versionado, editable en pantalla, persistido en localStorage
**+ export/import de archivo** (localStorage es caché; el JSON es el respaldo).
Contiene: fecha mínima de búsqueda, quincena, alias de columna-remisión y
secundarias, áreas observadas/neutras, layout del acta y los 10 contratistas
seed (Sabana: ASOTRANSPA, ASOTRASAAT, ASOVOLSAT, COTRASABANA, SUMINISTROS,
TRANSAGREGADOS, VELEROS · Betulia solo GRANULARES: CARTRAGUA, D&S, TRANSDELTA)
con sus alias y reglas de hojas.

Notas del seed de reglas de hojas (además de las 4 del ejemplo de la spec):

- `TERRAPLEN…GRANULAR` en el nombre → **AMBAS** (hoja mixta de SUMINISTROS).
- Nombre de mes (`JUNIO 2026` de ASOTRASAAT) → **AMBAS**: busca en las dos bases;
  si aparece en ambas cae a `MULTIPLE_EN_BASE` (nunca asume mal).

### Visor de páginas «Hojear» (sep-2026)

El botón **Hojear** de cada archivo (y los del navegador manual del Paso 5) entra
**directo a la vista grande** de la página 1. Las miniaturas a 110 px no dejaban
leer nada —siempre había que abrir la grande— y renderizarlas todas costaba
segundos en PDFs pesados, así que dejaron de ser la entrada:

- **Índice liviano:** una tira con un botón por página, coloreado con lo que el
  OCR ya sabe de cada una (confirmada · con candidato · sin lectura · leída sin
  coincidencia · descartada · sin procesar). Es dato, no render: cuesta cero
  aunque el PDF tenga 200 páginas. Más un campo «ir a la página».
- **Navegación:** `‹ anterior` / `siguiente ›` y las **flechas ← →** del teclado;
  **Esc** cierra; la **✕** va en la cabecera del visor, siempre visible. Las
  flechas no actúan mientras escribes en un campo.
- **Con una faltante seleccionada** en el Paso 5: lo de siempre, «✔ Confirmar
  para X» / «Es ASFALTO» sobre la página que estás viendo.
- **Sin faltante seleccionada (modo general):** arriba salen las **faltantes sin
  confirmar como botones** —la misma lista y el mismo ≈ (a un dígito de lo que
  leyó el OCR) que la revisión guiada; las de la otra base quedan plegadas por
  el ámbito del PDF—. Un clic confirma esa remisión sobre la página: evidencia,
  `PENDIENTE_DIGITACION`, historial y autosave, **igual que confirmar desde el
  Paso 5**. La remisión desaparece de la lista pero **la página no se cierra ni
  avanza**: una hoja puede traer dos o tres partes faltantes, y a veces hay que
  seguir buscando en la misma. Es el camino de respaldo cuando el filtro y la
  revisión del OCR no dieron con el parte. La regla no cambia: el OCR propone,
  tú confirmas viendo la página.
- **Miniaturas bajo demanda** (botón ▦): la galería sigue existiendo, con el
  cierre **fijo arriba** y todas las celdas creadas de entrada con el alto de la
  página reservado —antes cada miniatura que llegaba empujaba el botón Cerrar y
  no se alcanzaba a pulsar hasta que cargaban todas—.

Todo lo que va al DOM sigue siendo la **copia** que entrega `pagDom` (D114b): el
canvas maestro del caché nunca se inserta.

Verificación: `node backend/pruebas/verificar_conciliador_visor_paginas.js` (DOM
mínimo simulado, sin pdf.js) y prueba en Chromium de escritorio con un PDF de 40
páginas (pdf.js 3.11.174 real). Pendiente validar con los PDFs reales del corte.

### ¿Puedo dejarlo leyendo e irme a hacer otra cosa?

Sí. Mientras el OCR corre:

- **Cambiar de paso dentro de la herramienta** (irte al 3 a cargar otra proforma,
  al 4 a revisar el tablero…) **no lo detiene**: lo único que lo para es el botón
  **✕ Cancelar**, que solo existe en la vista del Paso 5. Al volver al Paso 5 se
  re-cruzan solas todas las páginas ya leídas contra las faltantes que haya en
  ese momento (`recruzar`), así que si cargaste una proforma nueva mientras
  tanto, **no hay que repetir el OCR**.
- **Minimizar la ventana o irte a otras pestañas del navegador tampoco lo
  detiene** — pero esto costó una corrección (ago-2026), porque antes **sí** lo
  detenía. pdf.js agenda el dibujo de la página con `requestAnimationFrame`
  cuando la intención es la de PANTALLA, y desde el primer trozo; un navegador
  no dispara rAF en una pestaña que no estás mirando, así que
  `page.render().promise` no resolvía nunca y el bucle se quedaba colgado en el
  `await`. **No lento: parado**, hasta volver a la pestaña. El render del OCR
  pide ahora `intent:'print'`, que usa microtareas en vez de rAF — y que además
  es la intención que corresponde: esto no se dibuja para mirarlo, se rasteriza
  para leerlo. Las páginas que **sí** se muestran (candidatos, revisión guiada,
  miniaturas) conservan la intención de pantalla.

  Comprobado con pdf.js 3.11.174 —la versión fijada— simulando la pestaña
  oculta (rAF existe pero su callback jamás se llama): con la intención por
  defecto se cuelga tras pedir 1 rAF; con `intent:'print'` resuelve pidiendo 0.
  Como no se puede verificar sin navegador, el arnés lo vigila en el código.
- **Lo que sí lo mata:** cerrar la pestaña, recargar (F5) o navegar fuera.

Por eso el OCR hace **autosave cada 10 páginas** (corrección ago-2026). Antes
solo guardaba al terminar o al cancelar, así que un corte en seco —cerrar la
pestaña, un F5 sin querer— tiraba la corrida entera; con un PDF de 25 páginas
eso son minutos de lectura perdidos. Ahora, al volver a abrir y pulsar
"Buscar", las páginas ya leídas no se repiten.

## Sesión

- **Autosave** en localStorage en cada cambio relevante (si supera el límite,
  avisa y pide export) y **cada 10 páginas mientras corre el OCR**.
- **Exportar/Importar sesión (JSON):** todo el estado del corte (reclamaciones,
  historial, asignaciones PDF por nombre de archivo + página, caché de OCR,
  páginas descartadas a mano en la revisión, ámbito elegido de cada PDF — al
  re-seleccionar el archivo con el mismo nombre lo recupera).
  Los binarios NO viajan: al importar, re-selecciona las bases (Paso 1) y los
  PDFs (Paso 5) con los MISMOS archivos — si el nombre difiere, avisa.

### Tinta roja apagada — umbral adaptativo del OCR (corrección ago-2026)

Caso real: `SOPORTES ORTIZ TRAMO 2 DEL 01 AL 15 DE AGOSTO DE 2026.pdf`
(25 págs., CamScanner, 2 partes por hoja) salió con **21 de 25 páginas "sin
lectura"**. No era límite del lector: el número de recibo está impreso en rojo y
grande, pero **ese escaneo trae el color apagado**. La pasada A recortaba la
tinta con un umbral **fijo** (`r > 1,3·max(g,b)` y `r−max > 20`), calibrado para
tinta viva. Medido sobre ese PDF, en los píxeles del propio número:

| escaneo | píxel típico del número | rojez `r−max(g,b)` | ¿pasaba el filtro viejo? |
|---|---|---|---|
| vivo (pág. 1) | r 129 · g 89 · b 94 | 36 (ratio 1,46) | sí, pero **a jirones** |
| apagado (pág. 10) | r 154 · g 130 · b 130 | 24 (ratio 1,19) | **no: 0 píxeles** |

Con 0 píxeles rojos la franja se descartaba y **el OCR ni se llamaba** (en las
páginas 8–22 la hoja ENTERA daba entre 0 y 13 píxeles). Correcciones:

1. **Umbral adaptativo**: lo pone la propia franja — pico = percentil 99,9 del
   canal de rojez (`r − max(g,b)`, que es la tinta) y corte al **45%** de ese
   pico. Portero `hayTinta`: si el pico se queda en el ruido del papel (<10) la
   franja no tiene número rojo y se descarta, porque si no el suelo del umbral
   marcaría decenas de miles de píxeles de fondo y el OCR leería basura.
2. **5 bandas solapadas** (de un tercio de alto, cada media banda) en vez de tres
   tercios secos: el número que caía justo en la costura ya no sale partido.
3. **`OCR_V`**: las lecturas quedan en caché por página; al cambiar el lector esa
   caché es de la versión vieja, así que la primera corrida tras el cambio
   **relee** (avisa en pantalla). Las decisiones humanas —páginas descartadas,
   lecturas corregidas, revisadas— se conservan.

Medido con tesseract 5.3.4 sobre las 25 páginas de ese PDF: lecturas en **24 de
25 páginas** (antes 4), la mayoría exactas contra el número impreso y el resto a
un dígito, que es justo lo que la pantalla ofrece como candidato naranja. El
criterio no cambia: **el OCR propone, tú confirmas viendo la página.**

Si un escaneo llega tan lavado que ni así lo lee (en ese PDF quedó 1 página),
sigue estando la revisión guiada "▶ Revisar las N contra las faltantes".

### Formato NUEVO de PUTANA: el tiquete de báscula — pasada C (ago-2026)

Los granulares de PUTANA pasan a llegar como **tiquete de báscula** impreso en
matricial: todo monoespaciado, gris, del mismo cuerpo, y **fotografiado con el
móvil** (no escaneado). La remisión es el campo del encabezado:

```
                COPIA DE TIQUETE NUMERO:8.650
```

Eso tumba las **dos** suposiciones del lector anterior y añade una trampa que no
tiene nada que ver con la imagen:

1. **No hay color que aislar.** La pasada A mide rojez = `r − max(g,b)`, que en
   gris es ≈ 0: `hayTinta` da falso en las cinco bandas y el OCR no se llama ni
   una vez. (Es otro problema que el de "tinta roja apagada" de arriba: aquel
   era rojo *débil*, este es rojo *ausente*.)
2. **El número no es grande ni está arriba a la derecha.** Es un campo de texto
   más, del mismo cuerpo que el resto. Cualquier truco de píxeles que lo busque
   por tamaño o por posición falla.
3. **Viene con separador de miles.** El `\d{3,6}` de siempre lee `8` y `650` y
   **jamás produce `8650`**, por bien que el OCR haya leído la hoja.

Lo que este formato sí tiene, y el anterior no, es **estructura**: el número
lleva su rótulo delante. Así que se lee **por rótulo, no por píxeles** — que
además es lo único que lo distingue de los otros ocho números de la hoja (NIT,
teléfono, los tres pesos, placa, PK, volumen), varios de ellos a un dígito de
una remisión de cuatro cifras.

**La pasada C**, sobre la hoja completa:

- **Binarizado adaptativo por media local** (`binarizaAdaptativa`, método de
  Bradley con imagen integral). Estos partes llegan fotografiados: sombra de la
  mano, fondo asomando por un borde, media hoja más iluminada que la otra. Un
  umbral **global** sacrifica la zona en sombra entera; la media local compara
  cada píxel con la de su entorno (ventana = ancho/8) y lee igual en las dos.
- **Escalado hasta 2000 px de ancho** antes de binarizar: el tiquete es de
  cuerpo pequeño y una foto de móvil deja el rótulo en ~12 px de alto. (El
  `_aGris` de la pasada B, que *reduce* a 1400, lo dejaría aún más chico.)
- **OCR como texto, sin lista blanca de dígitos** (psm 6): hace falta leer el
  rótulo, no solo cifras.
- **Extracción anclada** (`tokensTiquete`), tolerante a los tropiezos típicos
  del OCR sobre matricial (`TIQUETE` → `T1QUE7E`, `TI0UETE`) y a las variantes
  del rótulo (`NUMERO`, `NRO.`, `No.`, dos puntos o nada). Global: una hoja con
  dos o tres tiquetes aporta el número de cada uno. **Si el ancla no aparece,
  devuelve vacío** y la página cae a la pasada B — nunca se inventa un número.
- **Con el rótulo localizado se salta la pasada B**: sería cambiar un número
  seguro por los ocho de la hoja.

**El separador de miles se resuelve en la COMPARACIÓN, no en el token.** La
primera versión emitía las dos grafías (`8650` y `8.650`) para cubrir lo que
hubiera escrito la proforma; lo que hacía era sembrar naranjas falsos — `8.650`
está a un dígito de `8650` y de sus vecinas `8641`/`8643`, así que cada tiquete
ensuciaba tres faltantes ajenas. Ahora el token es uno solo, en dígitos, y
`_cruzar` compara además con `sinMiles`, que quita el separador **y solo eso**
(patrón de 1–3 cifras + grupos de exactamente 3): `8.650` → `8650`, pero
`CH6199` y `0348` salen intactas. `normRem` —el contrato de conciliación, que
guarda la remisión como texto literal y es lo que sostiene `0348`— **no se
toca**.

`OCR_V` sube a **3**: la primera corrida tras el cambio **relee** las páginas
cacheadas (avisa en pantalla). Las decisiones humanas —páginas descartadas,
lecturas corregidas, revisadas— se conservan.

**Medido** con tesseract 5.3.4 sobre réplicas degradadas de las dos fotos reales
(rampa de luz, sombra de la mano, desenfoque y JPEG), a 1000 y 1400 px de ancho:

| | pasada B (la de hoy) | pasada C |
|---|---|---|
| tokens por página | **13**, todos basura | **1**, la remisión |
| proforma escribe `8650` | la encuentra **por casualidad**: el OCR lee los dos puntos del rótulo como un `0` y `08642` casa por la regla de ceros | verde |
| proforma escribe `8.650` | **no la encuentra nunca** (0 de 2) | verde |
| falsos | un **verde falso**: `12.630` es el peso de entrada del tiquete, no una remisión | ninguno |

**Si el formato cambia otra vez**, lo que hay que tocar es `RE_TIQUETE` (el
rótulo) y `numeroRemision` (cómo se escribe el número), no la imagen.

## Limitaciones V1 (fuera de alcance)

- No genera el acta completa (tarifas, totales, firmas): solo el bloque de pegado.
- No escribe las bases ni el acta reales (todo es lectura + export copy-paste).
- Sin histórico entre cortes / anti-doble-cobro entre quincenas (lo cubre el
  formato condicional del acta).
- Sin SharePoint/Google, sin multi-usuario, sin backend.
- El OCR es ayuda dirigida, no transcripción: siempre confirmas viendo la página.

## Verificación

Motor validado con suite headless (Node) que cubre los criterios de aceptación
comprobables sin navegador: normalización (0348/CH6199), explosión
`31428-31432-31441` vs par sospechoso `31428-31500`, exclusiones UF3/PUENTE/ODT
con DIVISO neutro, filtro por empresa y fecha mínima, duplicadas, rezagos,
MATCH_SIN_CEROS a revisión, re-conciliación preservando decisiones manuales,
bloque acta (19 columnas, derivadas vacías, orden por fecha), **regla "ninguna
casilla admite 0"** (0/`"0,00"`/`-`/`#¡VALOR!`/`#N/A` de la base tratados como
hueco y rellenados con la proforma, CC corregido, celda vacía + "FALTA POR
TECLEAR" cuando nadie tiene el dato, fila completa intacta), detección de hoja
mal clasificada con cambio de ámbito, y rendimiento (25k filas ≈ 0,6 s de
indexado; 800 reclamaciones ≈ 6 ms). La pasada roja del OCR se validó offline
contra partes escaneados reales de PUTANA (misma fórmula de filtro, tesseract
nativo): encontró todos los números de recibo de las páginas de prueba.

Verificaciones sueltas (Node, sin navegador):

```
node backend/pruebas/verificar_conciliador_pendientes_material.js   # CC por MATERIAL
node backend/pruebas/verificar_conciliador_pendientes_area.js       # áreas del bloque 1b
node backend/pruebas/verificar_conciliador_paso5_candidatos.js      # un renglón por página
node backend/pruebas/verificar_conciliador_ignorar_hoja.js          # IGNORAR una hoja del corte
node backend/pruebas/verificar_conciliador_ocr_umbral_rojo.js       # umbral rojo adaptativo
node backend/pruebas/verificar_conciliador_ocr_tiquete.js           # tiquete de báscula de PUTANA (pasada C)
node backend/pruebas/verificar_conciliador_visor_paginas.js         # visor «Hojear»: navegación, cierre fijo, marcar faltantes desde la página
```
