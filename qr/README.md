# QR del Parte Digital de Maquinaria (V3-01 / D165)

Un QR por equipo activo, con la URL de su formulario: `https://tm2.galca.app/parte.html?eq=<codigo>`.
El operador lo escanea con la cámara del teléfono y le abre el parte de SU máquina, sin usuario ni
clave (la identidad la da el equipo). Sin QR, `parte.html` a secas muestra el selector de equipo.

- `<codigo>.png` — el QR de cada equipo (nivel de corrección H, 900×900 px).
- `etiquetas.pdf` — hoja carta, etiquetas de 7×7 cm, 6 por hoja, con líneas de corte. **Esto es lo que se imprime.**
- `LISTADO.md` — inventario: qué equipos tienen QR, su URL y su PNG, en el mismo orden del PDF.

## Regenerar todo

```bash
pip install "qrcode[pil]" reportlab
python3 tools/generar_qr.py
```

Lee por defecto las dos semillas del repo: `backend/seeds/parte/PARTE_EQUIPOS_semilla.csv` (la
**ficha** de cada equipo: código, tipo, placa, medidor) y `backend/seeds/MAQUINAS.tsv` (las
**estancias**: quién está en obra, desde cuándo y en qué frente — D173). **Entra al listado quien está
vigente HOY en la flota del frente UF1-UF2 y tiene ficha.** La fuente de verdad son las hojas del
Sheet: si diste altas o bajas en Maquinaria › Flota, exporta `MAQUINAS` (y `PARTE_EQUIPOS` si hay
fichas nuevas) y pásalas:

```bash
python3 tools/generar_qr.py --csv ~/Descargas/PARTE_EQUIPOS.csv --maquinas ~/Descargas/MAQUINAS.tsv
python3 tools/generar_qr.py --fecha 2026-10-01          # la flota de otro día
python3 tools/generar_qr.py --maquinas ""               # criterio antiguo: activo=SI en PARTE_EQUIPOS
python3 tools/generar_qr.py --limpiar                   # además borra los PNG de equipos ya fuera
```

Quedan fuera y se listan al final de `LISTADO.md`: los no vigentes o de otro frente (UF3), los
vigentes **sin ficha** (hay que crearla: placa y medidor) y las placas sueltas sin `tipo`.

## Agregar un equipo nuevo

1. **Maquinaria › Flota → Dar de alta** (código del parte, tipo, frente, propiedad, fecha de ingreso,
   placa, medidor, proveedor). El alta crea sola la ficha en `PARTE_EQUIPOS` si no existe.
2. Exportar `MAQUINAS` (y `PARTE_EQUIPOS`) como CSV/TSV.
3. `python3 tools/generar_qr.py --csv PARTE_EQUIPOS.csv --maquinas MAQUINAS.tsv --solo CODIGO` →
   genera solo ese PNG y un `etiquetas.pdf` con esa etiqueta (imprime solo esa hoja). Para dejar el
   repo completo, vuelve a correrlo sin `--solo` (con `--limpiar`) y sube la carpeta `qr/`.

Un equipo que **sale** de la obra es una **baja** en la misma pestaña (fecha de retiro = primer día
que ya no estuvo): deja de esperarse en «Equipos sin parte» y su QR deja de abrir el parte; la
etiqueta física se retira de la cabina. Si vuelve (una volqueta de reemplazo por dos días, una
camabaja alquilada el mes siguiente), es un **reingreso**: fila nueva, mismo código, mismo QR.

## Impresión y pegado

- **Vinilo adhesivo laminado** o etiqueta plastificada, **7×7 cm**, cortar por la línea punteada.
- Pegar **en la cabina, a la altura de la vista del operador**, en una superficie limpia y plana,
  **lejos del sol directo** si se puede (el laminado aguanta mugre y agua; el sol lo decolora).
- Imprimir **un segundo juego para la oficina** como respaldo: sirve para reponer una etiqueta
  dañada y para capturar a mano un parte desde la oficina escaneándolo.
- Antes de pegar, escanear una vez con el teléfono: debe abrir `parte.html` con el código del equipo
  en la cabecera.
