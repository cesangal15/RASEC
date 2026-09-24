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
cobra la proforma, la propuesta (CUOTA_INT / STAND BY BTC / nada) y el mensaje de WhatsApp que la
respalda o la falta de él.
