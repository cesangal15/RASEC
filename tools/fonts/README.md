# Fuentes para las etiquetas QR

`RedHatDisplay-Black.ttf` — instancia estática (peso 900) de la fuente variable **Red Hat Display**
(Red Hat / MCKL), licencia **SIL Open Font License 1.1**
(https://github.com/google/fonts/tree/main/ofl/redhatdisplay). La usa `tools/generar_qr.py` para el
código de equipo en `qr/etiquetas.pdf`: es la sans más gruesa del proyecto con cifras de caja alta
(en Syne el `0` se parece a la `o`, y en campo `BL005` tiene que leerse sin duda). Si falta, el
script cae a Syne (si está en esta carpeta), a DejaVu Sans Bold y luego a Helvetica-Bold.
El usuario solo imprime el PDF: no necesita instalar nada.
