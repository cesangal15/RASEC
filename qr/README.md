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

Lee por defecto `backend/seeds/parte/PARTE_EQUIPOS_semilla.csv`. La **fuente de verdad es la hoja
`PARTE_EQUIPOS` del Sheet**: si cambiaste `activo` o agregaste equipos, exporta la hoja (Archivo →
Descargar → CSV) y pásala:

```bash
python3 tools/generar_qr.py --csv ~/Descargas/PARTE_EQUIPOS.csv
```

Entran los equipos con `activo=SI` (vacío = activo) que tengan `tipo`; las placas sueltas sin tipo y
los códigos vacíos / `#N/A` quedan fuera y se listan al final de `LISTADO.md`.

## Agregar un equipo nuevo

1. Fila nueva en `PARTE_EQUIPOS` (código, tipo, placa, medidor, `activo=SI`).
2. Archivo → Descargar → CSV.
3. `python3 tools/generar_qr.py --csv PARTE_EQUIPOS.csv --solo CODIGO` → genera solo ese PNG y un
   `etiquetas.pdf` con esa etiqueta (imprime solo esa hoja). Para dejar el repo completo, vuelve a
   correrlo sin `--solo` y sube la carpeta `qr/`.

## Impresión y pegado

- **Vinilo adhesivo laminado** o etiqueta plastificada, **7×7 cm**, cortar por la línea punteada.
- Pegar **en la cabina, a la altura de la vista del operador**, en una superficie limpia y plana,
  **lejos del sol directo** si se puede (el laminado aguanta mugre y agua; el sol lo decolora).
- Imprimir **un segundo juego para la oficina** como respaldo: sirve para reponer una etiqueta
  dañada y para capturar a mano un parte desde la oficina escaneándolo.
- Antes de pegar, escanear una vez con el teléfono: debe abrir `parte.html` con el código del equipo
  en la cabecera.
