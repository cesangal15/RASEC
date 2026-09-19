# Sandbox local de la grilla (V3-08 / D181)

Probar la **grilla de catálogos** como si fuera la app real, **en tu PC y sin tocar nada** (ni Supabase, ni
Cloudflare, ni Google, ni tus datos de obra). Todo corre en memoria y se borra al cerrar.

## Qué levanta
- **Postgres en memoria** (PGlite) con el esquema real (todas las migraciones `worker/sql/0*.sql`, incluida
  `003_grilla.sql`). `005_data_clima.sql` (D182) se vuelve a pasar **después de cargar la DATA**, porque mueve
  datos. Al arrancar, el log dice cuántos sellos `[Clima: …]` pasaron de la observación a la columna clima; con
  `data.real.csv` son 43. `006_proyeccion.sql` (D183) siembra la **Proyección** con los valores del Excel del
  jefe: plan mensual, contrato y línea base, rendimientos, FC y acta base. `007_data_completa.sql` (D184) crea
  `fc_actividad` (FC 1.3 en 7 actividades) y también se vuelve a pasar **después de cargar la DATA**: completa ACTA,
  ESPESOR, FC y CANTIDAD solo donde faltan (el log dice cuántas filas quedaban por completar antes y después; con
  `data.real.csv`, 2 → 0) y, desde D185, pone FC 1 en las filas de «ajuste origen» (regla [O]).
  `008_tablero_vivo.sql` (D185) crea lo del **Tablero en vivo**: el mapeo DATA → Tablero (MAPEO A2:C10) y la tabla
  donde se guardan las horas del libro de partes. No mueve datos, así que se aplica una sola vez.
- El **Worker real** (`worker/src/index.js`) contra esa base — el mismo código que corre en Cloudflare.
- Las **pantallas reales** (login, menú, jefe, grilla, Proyección, Tablero…) servidas desde el mismo puerto.
- Sembrado con **tus datos reales** del Excel maestro: **subtramos** (`base_elementos.real.csv`, 190 filas:
  la cadena, el solape real 35+885–36+050 y los dos «ajuste a origen»), el **catálogo de 156 actividades**
  (`base_items.real.csv`) y **la hoja DATA completa** (`data.real.csv`, **4468 filas reales**, ago-2025 a
  sep-2026), más usuarios de prueba.

  `data.real.csv` se genera desde el Excel maestro con `extraer_data_real.py` (ver «Regenerar la DATA» abajo);
  la extracción se autoverifica fiel al Excel (mismos valores, fechas y textos).

## Cómo se usa
```bash
cd worker && npm install     # una sola vez: instala PGlite (dependencia de desarrollo)
cd ..
node tools/sandbox/servidor.mjs
```
Abre **http://127.0.0.1:8099**, entra con **`admin` / `1234`** (o **`jefe` / `clave-jefe`**, o
**`residente` / `clave-res`**). Desde el menú (o el panel del jefe) tienes dos herramientas, más la
**Proyección** (D183), que se prueba junto con el Tablero en la sección siguiente:

**1) Revisión de DATA** (lo principal) — el reporte diario **como tu hoja DATA**, editable al cierre.
Elige un rango de fechas, corrige o **＋ añade** una actividad, y verás cómo el sistema **deriva solo**
CC, grupo, capítulo, UF, abscisas, acta y **cantidad = largo × espesor ÷ FC**, igual que las fórmulas del
Excel. Edición en celda, selección de rango (clic + `Shift`), copiar/pegar, rellenar hacia abajo (`Ctrl+D`),
**Guardar** con control de versión por fila. La DATA real va de ago-2025 a sep-2026 (elige el rango; por
defecto abre el periodo 16→15 que contiene hoy). Desde D182 no se ven ORDEN, PROYECTO ni LIBERACIÓN; **CLIMA**
va antes de OBSERVACIÓN, que queda al final. El clima es **del día**: si lo cambias en una fila, cambia en todas
las filas de esa fecha, y al guardar viaja como un solo cambio por día (no reescribe las filas) y el mensaje dice
a cuántas filas llegó.

Desde D184 cada fila está **completa**: todas tienen su **ACTA** y ninguna con LARGO queda sin ESPESOR, FC o
CANTIDAD. Para verlo:
- Carga del **2026-08-16 al 2026-09-30**: ACTA 23 hasta el 15-sep y 24 desde el 16-sep (472 filas).
- **＋ Fila:** nace con ESPESOR 1 y FC 1. Elige la descripción **Terraplenes (solo conformación)** y el FC pasa a
  1,3; con LARGO 130, la cantidad es 100. Un solo `Ctrl+Z` deshace la descripción y el FC.
- Las 7 actividades con FC 1,3 son terraplén, excavación aprovechable, no aprovechable y de préstamo, subbase, base
  estabilizada y conformación de sobrantes; todo lo demás va con 1.
- En una fila con LARGO, **vacía el FC** y vuelve el de su actividad; escribe otro (1,8) y se respeta.
- Cambia la fecha de una fila a **2027-02-03** y la ACTA pasa a 28: fuera de la tabla `periodos`, sale de la
  fórmula de respaldo.
- En el **Panel del Jefe**, «Copiar [fecha]» deja ORDEN (B) y ACTA (M) vacías, aunque la base ya las tenga.
- **Regla [O] (D185):** en una fila de **Terraplenes (solo conformación)** con LARGO 130, cambia el ELEMENTO a
  **ajuste origen UF2**: el FC pasa solo a 1 y la cantidad a 130. Devuélvela a un tramo normal y el FC vuelve
  a 1,3 (cantidad 100). Los «ajuste origen» son los cuadres del jefe contra lo certificado y van siempre
  con FC 1.

Las actas **B06** y **B07** (2020) que ves en las listas de actas, por ejemplo en la Proyección, son de las
semillas del arnés de pruebas, no de la obra.

**2) Grilla de catálogos (BASE)** — subtramos y centros de coste. Verás el **solape real** marcado, los dos
**«ajuste a origen»** como no operativos, y el rechazo del servidor si dejas un solape o si otra persona
cambió una fila. Es para altas/correcciones de subtramos, no el día a día.

`Ctrl+C` para cerrar; reinícialo cuando quieras volver al estado inicial.

## Probar el Tablero EN VIVO y la Proyección (V3-11 Fases B+C · D185)
Desde D185 el **Tablero de producción** ya no lee ningún Excel de producción ni tiene «Actualizar»: **cada vez
que alguien lo abre** —también el enlace público de los directivos, sin sesión— pide `?action=tablero_vivo` y se
calcula al momento en el navegador con:
- la **producción**: TODA la DATA de Galca (todos los periodos) plegada por fecha y por el mapeo de siempre
  (MAPEO A2:C10 del Excel, tabla `tablero_mapeo` de `008_tablero_vivo.sql`). Cada cifra compacta que ves es
  **Σ CANTIDAD** de las filas de DATA;
- la **maquinaria** (horas): la del último libro de partes que admin o jefe **cargaron en Galca** (se carga una
  vez, cuando llega uno nuevo);
- la **proyección** (plan mensual, rendimientos, FC y contrato) de la pantalla **Proyección** (D183).

El **avance contra el contrato** sigue «como en la Proyección» (decisión final del dueño, 19-sep-2026): la
**producción base certificada** de la Proyección (hasta el cierre del acta base 22, el 15-ago-2026) **+** lo que
suma la DATA de Galca **desde el corte** (16-ago-2026 en adelante), ÷ contrato. En esa suma posterior al corte la
excavación común = aprovechable + NO aprovechable (así la certifica el acta) y el préstamo va aparte. Mientras
está abierto se recalcula solo cada 5 minutos. Si Galca no responde, enseña la foto
publicada (o la última vista en ese equipo) con un aviso ámbar que dice por qué.

**Antes de empezar:** copia en una carpeta aparte (p. ej. `Escritorio\prueba-tablero`) el libro de partes de
maquinaria más reciente, el que trae la hoja **BASE MAQUINARIA** (p. ej. `2608 Partes Diarios de Maquinaria …
UF1- UF2-UF3.xlsx`; *no* `Modelo_Produccion_Maquinaria.xlsx`) y, si quieres correr el comparador del final, tu
Excel de producción (`TM2_SUR_REPORTE_….xlsx`). Nada de lo que sigue escribe en esos archivos (D24).

1. **Levanta el sandbox:** `node tools/sandbox/servidor.mjs` (si el 8099 está ocupado:
   `node tools/sandbox/servidor.mjs --puerto=8123` y usa ese puerto abajo). En el log, la lista de migraciones
   debe llegar a `008_tablero_vivo.sql`.
2. **Como directivo, sin sesión:** abre en una ventana privada
   `http://127.0.0.1:8099/tablero-produccion.html`. En uno o dos segundos la línea de estado (bajo la cabecera)
   dice **«En vivo · DATA al 17-sep · sin partes de maquinaria cargados»** (17-sep es el último día de la DATA
   del sandbox). Ves producción, evolución y avance, y ningún botón de acción (ni «Cargar partes», ni
   Actualizar/Elegir archivos) salvo «Iniciar sesión»; quedan el filtro de UF (Todo/UF1/UF2) y el del tema.
   «Por qué vamos así» sale sin horas: aún nadie cargó el libro de partes.
3. **Carga la maquinaria como jefe:** entra en `http://127.0.0.1:8099` con **`jefe` / `clave-jefe`** (o
   `admin` / `1234`) y abre el Tablero desde el panel. Pulsa **«Cargar partes de maquinaria»** y elige SOLO la
   copia del libro de partes. Tarda de unos segundos a medio minuto, según el equipo (pesa más de 10 MB; se lee
   en tu navegador y a Galca solo sube el resumen de horas por máquina y centro de coste, sin nombres de personas). Al terminar, la línea dice
   «maquinaria guardada en Galca … · ya la ve todo el que abra el Tablero» y **«maquinaria al 15-ago
   (2608 Partes …xlsx)»**; «Por qué vamos así» se llena de horas, utilización y velocidad. En el selector de
   periodos aparecen también **jun y jul-2025**: tienen partes de maquinaria pero no DATA, así que salen con
   producción 0 y sus horas (D185).
4. **Compruébalo desde la ventana privada** del paso 2: recarga. Sale también la maquinaria, **sin haber cargado
   nada en esa ventana**. En producción puede tardar hasta un minuto, porque la lectura pública se sirve con una
   caché de 60 s. El sandbox no tiene esa caché (`X-Tablero-Cache: SIN`), así que sale en seguida.
5. **Corrige la DATA y míralo en el Tablero:** como jefe, abre **Revisión de DATA**, carga del **2026-09-01 al
   2026-09-15**, busca una fila de **Terraplenes (solo conformación)**, cambia su **LARGO** (p. ej. súmale 1.300:
   con FC 1,3 son 1.000 m³ compactos más) y **Guardar**. Vuelve al Tablero (o recárgalo): el jefe salta la
   caché, así que en seguida el terraplén de **sep 26** (clic en ese mes), la barra de ese día en «Producción
   diaria del período» y el **avance** del terraplén suben exactamente esos m³ (la fila es posterior al corte del
   16-ago; una corrección anterior al corte no mueve el avance, que ahí parte de lo certificado). Deshaz el cambio (vuelve a poner
   el LARGO de antes y Guardar) o cierra el sandbox.
6. **La foto de respaldo se publica sola:** tras calcular en vivo, el Tablero de admin/jefe publica la foto
   (la de D158) si cambió respecto de la publicada; lo dice la línea de estado. Es la que se ve si un día Galca
   no responde.
7. **Proyección → contrato y línea base:** abre **Proyección** (pestaña del Panel de Obra, tile del menú o del
   Panel del Jefe, o `http://127.0.0.1:8099/proyeccion.html`) → **Contrato y línea base**. La **Producción base**
   de cada partida (columna «Línea base» del resumen de abajo, UF1 + UF2) es el punto de partida del avance del Tablero; si la
   corriges y guardas, el avance del Tablero se mueve lo mismo. No hay columnas de conciliación con la DATA.
8. **Cambia la proyección:** en Proyección → Plan mensual → fila **sep-2026** → Subbase escribe otro valor (p. ej.
   `5000`) y **Guardar**. En el Tablero (recarga como jefe) la barra de Subbase de **«Planificado vs ejecutado del
   período»** de sep 26 pasa de 3.913 a 5.000. Déjalo como estaba o cierra el sandbox: todo es en memoria.

> **Ojo con las filas de ago-2026 a nov-2026 del plan.** En tu Excel, en esas filas una celda sale de otra
> (Excavación = Terraplén × 1,2; No aprov. = Excavación × 0,2; en ago-2026, Terraplén = Excavación × 0,7). En
> Galca quedaron con su **valor fijo** (marca ámbar; el tooltip dice de qué fórmula salían) y **no se
> recalculan**. Por eso el ejemplo usa Subbase, de la que no sale ninguna otra.

**¿Cuánto varía el Tablero al pasar de la hoja DATOS a la DATA de Galca?** (informativo, sin navegador; el MISMO
motor que la página). Desde la raíz del repo, en **una sola línea**:
```
node tools/sandbox/comparar_datos_vs_data.mjs --excel="C:/…/prueba-tablero/TM2_SUR_REPORTE_nuevo.xlsx"
```
- Lee la hoja DATOS de tu copia y la compara con el pliegue de la DATA de Galca, **periodo a periodo y partida a
  partida** en m³ compactos (excavación total, común aprovechable, préstamo, no aprovechable, terraplén, subbase
  y base), y al final el **avance** con la regla final (producción base certificada + lo posterior al corte,
  excavación común = aprovechable + no aprovechable) calculado con DATOS y con la DATA de Galca, más una
  comprobación (✓/✗) de que el avance en vivo es exactamente base + Σ desde el corte.
- Sin `--url` levanta su propia Galca en memoria con la DATA del sandbox (`data.real.csv`) y el Worker real; con
  `--url=http://127.0.0.1:8099` lee la del sandbox levantado (con lo que hayas corregido en la Revisión de DATA).
  `--min=100` lista solo diferencias de al menos 100 m³; `--todo`, también lo que cuadra. Nunca escribe. Sale
  con **0** siempre que pudo comparar (es un informe) y **2** si no pudo.
- Qué esperar (el dueño lo aceptó, D185): jun y jul-2025 vacíos en la DATA, que empieza el 1-ago-2025 (en el
  Tablero salen con producción 0 y su maquinaria); en el total de todos los periodos, jun y jul-2025 incluidos,
  terraplén −7,3 %, no aprovechable +39,0 % y aprovechable +0,7 % contra DATOS. Desde el 06-ago-2026 (cuando
  DATOS pasó a ser un `SUMIFS` sobre la DATA) los días coinciden, salvo el 13-sep-2026, que DATOS no tiene
  (602,16 m³ sueltos de no aprovechable UF2: +463 m³ compactos): 2026-08 difiere por sus días anteriores al
  06-ago y 2026-09 solo por ese día. El avance casi no cambia: con DATOS → con DATA, la excavación común pasa
  de 579.008 a 579.471 y el resto sale igual (412.333 · 49.603 · 43.107 · 54.069), porque hasta el corte los
  dos parten de lo certificado. La DATA no se corrige: el diagnóstico contra lo certificado se entregó al dueño
  y no se aplica.

**La proyección de Galca contra la de tu Excel** (D183): `comparar_proyeccion.mjs` sigue sirviendo para eso, con
el camino de archivos del motor (hoja DATOS + libro de partes), que la página ya no usa:
```
node tools/sandbox/comparar_proyeccion.mjs --excel="C:/…/prueba-tablero/TM2_SUR_REPORTE_nuevo.xlsx" --partes="C:/…/prueba-tablero/2608 Partes Diarios de Maquinaria … UF1- UF2-UF3.xlsx"
```
Imprime las diferencias de **entrada** Galca vs Excel (plan y proyectado de CALCULOS, contrato y línea base de
MAPEO, constantes del código) y compara las dos salidas del Tablero campo a campo. Admite `--url`,
`--usuario`/`--clave` y `--cambiar=2026-09:subbase=5000`. Sale con **0** si son idénticas, **1** si no y **2** si
no pudo comparar. Para partir un comando en varias líneas: en PowerShell termina cada línea con un acento grave
`` ` ``; en bash, con `\`.

## Opciones
- `--puerto=8099` — cambia el puerto.
- `--base=<archivo.csv>` — usa otro CSV de subtramos (encabezados `elemento,abs_inicio,abs_fin,uf,tipo,orden`).
- `--volcado=<carpeta *_obra>` — en vez del CSV, carga la BASE de un volcado real de obra (el mismo que usa
  `backfill_obra.js`).

## Regenerar la DATA (cuando cambie el Excel maestro)
```bash
python3 tools/sandbox/extraer_data_real.py /ruta/a/TM2_SUR_REPORTE_nuevo.xlsx
# reescribe tools/sandbox/data.real.csv y verifica que la extracción es fiel al Excel
```
Requiere `openpyxl` (`pip install openpyxl`). Recorta espacios al inicio/fin de los textos (normalización
intencional, igual que el trim del tool al derivar CC); conserva los dobles espacios internos. Reinicia el
sandbox para cargar el CSV nuevo.

## Cómo apunta la pantalla al Worker local
`auth.js` detecta que la página se sirve desde `localhost`/`127.0.0.1` y manda la API al **mismo origen**
(este servidor). En producción (`tm2.galca.app`) ese modo **no se activa**: nada del despliegue real cambia.
También puedes fijarla a mano con `?api=<url>` (solo en localhost).

> Es una simulación para revisar la grilla **antes del corte oficial**. Cuando quieras probar contra una BD
> de verdad, usa el entorno de PRUEBA (`?env=prueba`) de `docs/OPERACIONES.md §14` y el rol de solo lectura.
