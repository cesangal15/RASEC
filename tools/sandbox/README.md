# Sandbox local de la grilla (V3-08 / D181)

Probar la **grilla de catálogos** como si fuera la app real, **en tu PC y sin tocar nada** (ni Supabase, ni
Cloudflare, ni Google, ni tus datos de obra). Todo corre en memoria y se borra al cerrar.

## Qué levanta
- **Postgres en memoria** (PGlite) con el esquema real (todas las migraciones `worker/sql/0*.sql`, incluida
  `003_grilla.sql`).
- El **Worker real** (`worker/src/index.js`) contra esa base — el mismo código que corre en Cloudflare.
- Las **pantallas reales** (login, menú, jefe, grilla…) servidas desde el mismo puerto.
- Sembrado con **tus datos reales** del Excel maestro: **subtramos** (`base_elementos.real.csv`, 190 filas:
  la cadena, el solape real 35+885–36+050 y los dos «ajuste a origen»), el **catálogo de 156 actividades**
  (`base_items.real.csv`) y una **muestra de ~400 filas reales de DATA** (`data.real.csv`), más usuarios de prueba.

## Cómo se usa
```bash
cd worker && npm install     # una sola vez: instala PGlite (dependencia de desarrollo)
cd ..
node tools/sandbox/servidor.mjs
```
Abre **http://127.0.0.1:8099**, entra con **`admin` / `1234`** (o **`jefe` / `clave-jefe`**, o
**`residente` / `clave-res`**). Desde el menú (o el panel del jefe) tienes dos herramientas:

**1) Revisión de DATA** (lo principal) — el reporte diario **como tu hoja DATA**, editable al cierre.
Elige un rango de fechas, corrige o **＋ añade** una actividad, y verás cómo el sistema **deriva solo**
CC, grupo, capítulo, UF, abscisas, acta y **cantidad = largo × espesor ÷ FC**, igual que las fórmulas del
Excel. Edición en celda, selección de rango (clic + `Shift`), copiar/pegar, rellenar hacia abajo (`Ctrl+D`),
**Guardar** con control de versión por fila. La muestra real va de finales de agosto a mediados de sep-2026.

**2) Grilla de catálogos (BASE)** — subtramos y centros de coste. Verás el **solape real** marcado, los dos
**«ajuste a origen»** como no operativos, y el rechazo del servidor si dejas un solape o si otra persona
cambió una fila. Es para altas/correcciones de subtramos, no el día a día.

`Ctrl+C` para cerrar; reinícialo cuando quieras volver al estado inicial.

## Opciones
- `--puerto=8099` — cambia el puerto.
- `--base=<archivo.csv>` — usa otro CSV de subtramos (encabezados `elemento,abs_inicio,abs_fin,uf,tipo,orden`).
- `--volcado=<carpeta *_obra>` — en vez del CSV, carga la BASE de un volcado real de obra (el mismo que usa
  `backfill_obra.js`).

## Cómo apunta la pantalla al Worker local
`auth.js` detecta que la página se sirve desde `localhost`/`127.0.0.1` y manda la API al **mismo origen**
(este servidor). En producción (`tm2.galca.app`) ese modo **no se activa**: nada del despliegue real cambia.
También puedes fijarla a mano con `?api=<url>` (solo en localhost).

> Es una simulación para revisar la grilla **antes del corte oficial**. Cuando quieras probar contra una BD
> de verdad, usa el entorno de PRUEBA (`?env=prueba`) de `docs/OPERACIONES.md §14` y el rol de solo lectura.
