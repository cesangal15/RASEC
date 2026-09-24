# Casos canónicos de campo

Cada caso dice qué suele reportarse, qué **dato observable** pedir, qué regla lo gobierna y cómo
comprobarlo. La regla está en la D citada, en `docs/02_REGISTRO_DECISIONES.md`, y en
`docs/PROJECT_CONTEXT.md`. Aquí no se copia: léela antes de responder.

## 1. «El volumen no cuadra con los viajes» → fallback de cubicaje 14
- **Pedir:** placa(s) y fecha; la fila de `VOLQUETAS` de esa placa (`cubicaje`, `m3_placa`, `cubicaje_origen`); si la placa está en `CUBICAJE`.
- **Regla:** D53, D54. Cubicaje real por placa; una placa no registrada usa el fallback fijo y deja el aviso.
- **Cómo se ve:** `cubicaje_origen = default` en VOLQUETAS, aviso naranja en la chequeadora y «Pendiente por cubicar» en la digitadora (D83).
- **Arreglo típico:** dar de alta la placa en `CUBICAJE` (dato, ver `tm2-catalogo`), no cambiar código.
- **Arnés:** contrato `obra.cubicaje` y `obra.reporte.chequeadora` (`--caso=cubicaje|chequeadora`).

## 2. «La excavación salió en otro PK / una sola fila» → excavación por ORIGEN
- **Pedir:** reporte de la chequeadora del día (origen, líneas, destinos) y las filas de BANDEJA/DATA resultantes.
- **Regla:** D63 (una sola fila de excavación = Σ líneas al PK del origen; terraplén, una fila por línea al PK de destino), D67 (botadero → no aprovechable), D160 (UF3 como Puente), D80 (formato del WhatsApp).
- **Arnés:** contrato `obra.reporte.chequeadora`.

## 3. «Una línea de drenajes cayó en tierras» (o al revés) → área derivada del CC
- **Pedir:** el CC de la línea (con proyecto), la columna `area` en BANDEJA/DATA y quién envió a DATA.
- **Regla:** D70/D84 (`deriveArea`: capítulo 06 → odt, 07 → odl, el resto → tierras; el `area` explícito odt/odl manda en filas nuevas) y D03 enmendada (el pisado es por **día + área**). D71: demolición 01.02 lleva `area` interna.
- **Arnés:** contrato `obra.enviar_data.d184_drenajes`, `obra.acumulado_drenajes`. La función vive en `worker/src/comun.js` (y `Codigo.gs`, congelado).

## 4. «El cereo no aparece en DATA» → correcto
- **Pedir:** la fila en BANDEJA (estado `no_data`) y en MAQUINARIA.
- **Regla:** D16. El cereo va a bandeja como `no_data` y a maquinaria con su producción. **Nunca a DATA.**
- **Dónde está:** el formulario marca `data:false` (`ACTIVIDADES` de `reporte-capataz.js`) y el Worker guarda `estado:'no_data'` (`worker/src/api/obra/reporte.js`).
- **Arnés:** no hay caso dedicado. Se comprueba con `?action=debug&fecha=` (estado de cada fila) o en el sandbox; si se toca, añade el caso al contrato.

## 5. «Salió una ZODME que nadie reportó» → ZODME automático
- **Pedir:** las filas del día con observación `Auto · …` y la no aprovechable que la originó (capataz o chequeadora/botadero).
- **Regla:** D17 (ZODME automático tras excavación no aprovechable), D58 (desmonte/descapote también generan no aprovechable → ZODME), D79 (el destino RCD/ZODME lo elige el residente en el panel).
- **Dónde está:** lo genera el Worker al guardar (`worker/src/api/obra/reporte.js`, id determinista `<id>-z`, así que un reenvío no la duplica, D82).
- **Arnés:** no hay caso dedicado. Se comprueba con debug o en el sandbox; si se toca, añade el caso al contrato.

## 6. «El reporte no llegó» / «llegó doble» → cola offline y dedupe
- **Pedir:** ¿el teléfono muestra envíos en cola (chip de `offline.js`)? Hora del envío; filas con el mismo `id_registro` en BANDEJA/PARTE_BANDEJA; entradas en `LOG`.
- **Regla:** D82 (la cola local `tm2_cola_envios`, el `id_registro` UUID generado en el cliente, el reenvío cuenta como éxito, el token se pega al enviar), D176 (parte sin señal), D109 (token por versión, no por reloj), D166 (rate limit / payload en LOG).
- **Distinguir:** mismo `id_registro` duplicado = bug de dedupe; distinto `id_registro` = dos envíos reales (se concilian en el panel, D51). En el Parte, `PARTE_REPETIDO` = mismo nº físico en otra fecha (D188).
- **Arnés:** `verificar_d176_parte_offline.js`, contrato `obra.reporte.idempotente` y `parte.ciclo`.

## Otros observables útiles
- `_ms` y `_celdas` en toda respuesta: separan lentitud del servidor y de la red (D99/D107).
- `?env=prueba` manda el navegador al entorno de prueba (D168). Sirve para reproducir sin tocar producción.
- Fecha que salta al día siguiente de noche: nunca `toISOString()` para la fecha por defecto (D50).
