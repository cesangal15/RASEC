# Días internos, cuota diaria y faltante de BTC

Reglas dadas por el dueño (sep-2026) y verificadas contra `ASOTRASAT.xlsx` (tabla dinámica del final
de `CORTOS-INTERNOS-PUTANA`, columna «CONVERSION»). Son casos **pocos pero delicados**: el skill los
detecta y propone; la decisión final la confirma el dueño.

## Cifras

Las cifras (cuota diaria en pesos, tarifas 0–3 / 3–5 / > 5 km y su equivalente en m³·km) **no están en
este repo, que es público**: viven en `C:\GALCA\conciliacion\privado\tarifas.json` (fuente: hoja
`Resumen` del libro de actas del contratista). Son iguales para todos los contratistas. Nombres que se
usan abajo: **CUOTA** (pesos por volqueta y día), **CUOTA_INT** (la cuota expresada en m³·km a tarifa
0–3 km: es lo que la columna CONVERSION reconoce por día interno) y **CUOTA_5** (la cuota en m³·km a
tarifa > 5 km).

## Regla de oro

**Solo se reconoce lo que el contratista reclama en la proforma.** Si no cobra un día interno o un
faltante y nosotros no lo tenemos marcado como interno, se deja como está: el skill no añade nada por
iniciativa propia.

## Día interno (terraplén, viajes ≤ 3 km)

- Se agrupa por **placa + día** los viajes reclamados de ≤ 3 km.
- El día se reconoce **completo como una cuota: CUOTA_INT m³·km** (columna CONVERSION), haya hecho más o
  menos viajes, para que la conversión cuadre. Días mixtos (internos + largos): también se reconoce
  como CUOTA_INT el día interno completo (confirmado por el dueño).
- Respaldo que se busca antes de proponerlo: la programación de WhatsApp de ese día para esa placa
  con pedido interno o «**por el día**» (p. ej. el pedido de puentes del 10/09: «4 volquetas doble troque **por el
  día** para el 22+500 Puente cayumbita» → USE111 11/09, 11 viajes, 284,13 m³·km → se reconoce CUOTA_INT).
- Ejemplos del corte de prueba: 30/08 GQV475 rem 11340 (21 viajes en una fila, 324,66 m³ a 1,3 km =
  422,06 → CUOTA_INT); 11/09 USE111 (284,13 → CUOTA_INT).
- Si el viaje estaba programado a > 3 km y terminó siendo interno (o al revés), se marca como duda
  con el mensaje de programación: a veces pasa «por x o y motivos» y hay registro.

### Cómo lo reclama la proforma (no siempre dice «interno») — D226

No basta con buscar viajes de ≤ 3 km ni la palabra «interno»: el contratista cobra el día interno de
tres maneras, y las tres cuentan como **día interno reclamado**:

1. una hoja propia «INTERNOS» (Asotranspa), con «VLR DIA DE TRABAJO»;
2. una **celda combinada en V.total** que abarca los viajes de esa placa ese día, con la CUOTA
   (p. ej. $1.234.640) y el resto de filas sin valor propio;
3. un **V.unitario más alto** que el de la hoja (tarifa 0–3 o 3–5 km en vez de > 5 km), aunque los
   viajes pasen de 3 km.

Ej.: Suministros 2.ª Q sep, TFT906 21/09: 7 viajes de 5,7 km (Cantera Diviso → PR 14+300), tarifa 1.718
y V.total combinado N118:N124 = CUOTA; los recibos dicen «Interno». Se reconoció como día interno
(observación «VIAJE INTERNO» en las 7 filas, CUOTA_INT en la dinámica). Detector, en el paso 4, antes de
decidir: `python $S/internos_proforma.py --proforma <proforma> [--out internos_proforma.json]`. Lista por
hoja, placa y día cada señal; en la hoja de UF3 o de asfaltos se ignora porque queda fuera del acta. Lo
que salga se confirma con el dueño y pasa a `internos.json`.

## En el acta: CC y observación (sep-2026)

El dueño **filtra el acta por la columna Observaciones** y pone la cuota (CONVERSION) en la tabla dinámica;
en cada fila va la cantidad real que se hizo (m³ del viaje, o m³ × N si el recibo dice «N viajes»). Para que
la dinámica salga bien:

- **Día interno** (propio, de Puentes o de TM1): TODAS las filas de esa placa ese día llevan **el mismo CC**
  (el que diga el dueño) **y la observación de interno escrita**: «VIAJE INTERNO», «PUENTES - VIAJE
  INTERNO» o «TM1 - VIAJE INTERNO», **aunque algún viaje de ese día sea largo** (no se deja la fórmula
  «VIAJE CORTO MAYOR A 5KM»). TM1 lleva el texto a mano aunque sean 11–14 km (no hay fórmula para TM1).
  Ej.: TAW895 18/09 (42253, 43253, 43331 internos y 43332 de 24,6 km) → las 4 con 3701.02.10 y «VIAJE INTERNO».
- **Dos programaciones el mismo día** (p. ej. interno de día y viajes en el turno nocturno): cada parte se
  reconoce por separado, con su CC y su observación; solo la parte interna va como día interno. Lo decide
  el dueño. Ej.: SXT274 17/09 → 42931 interno (UF1) + 7 viajes nocturnos a PR36+580 (UF2).
- **Viaje suelto de ≤3 km que NO es día interno** (la placa solo hizo ese mini viaje para ese frente): no se
  paga como interno aunque la fórmula lo marque así por los km; va como corto, como mucho «… VIAJE CORTO
  ENTRE 3 KM A 5 KM» (con «PUENTES - » si es de Puentes). Ej.: 42297 TAW895 22/09, 2,3 km a Puentes.
- **Media jornada**: si el chat dice que fue medio día, se reconoce media cuota (la pone el dueño en la
  dinámica); el skill lo anota en el resumen. Ej.: 41956 SOI414 29/08.

`armar_filas.py --internos internos.json` aplica estas reglas (ver su docstring) y lista los viajes sueltos
de ≤3 km para confirmarlos con el dueño.

## Faltante de BTC (granulares, cargue de BTC)

- Se agrupa por **placa + día** los viajes de BTC (tarifa > 5 km). Si su valor no llega a la cuota
  (CUOTA ≈ CUOTA_5 m³·km) **y la proforma cobra el faltante**, se busca el motivo en los chats.
- **Se reconoce solo si la causa es nuestra** (planta sin material, máquina que no llegó, cancelación
  o cambio nuestro, clima que paró la obra). **No se reconoce si es de ellos** (llegó tarde, no se
  presentó, se fue antes).
- Registro en el acta: en la columna **DESCRIPCION** (la de al lado de Observaciones) de uno de los
  viajes de esa volqueta ese día: «STAND BY BTC». El dueño lo revisa en vivo cuando aparezca un caso.

## Qué entrega el skill

Una sección «Internos y cuota» en `preguntas.md` con, por placa y día: viajes, m³·km reales, lo que
cobra la proforma, la propuesta (CUOTA_INT / media cuota / STAND BY BTC / nada), si el día es mixto (y el
CC que se propone para todo el día) y el mensaje de WhatsApp que la respalda o la falta de él. Antes de
proponer una cuota, comprueba que ese día no esté ya en el libro de actas. Con las respuestas del dueño
se arma `internos.json` para `armar_filas.py`.
