# Lectura de recibos escaneados (para quien mira las páginas PNG)

Este documento es para Claude (o un subagente) cuando lee, con visión, las páginas
renderizadas por `soportes.py render`. El objetivo: producir el `lecturas.json` que
consume `soportes.py cruzar`.

## Qué es un recibo

Formulario **ORTIZ COLOMBIA — «RECIBO DE TRANSPORTE DE MATERIAL»** (código FOBR524.01.CO).
Hay dos plantillas físicas mezcladas en los PDF (una de MARZO-25, otra de JUN.2024); los
campos relevantes son los mismos. Cada página trae entre **1 y 4 recibos** (fotocopias de
papel apiladas), casi todo a mano.

- **Nº de recibo**: en tinta roja/vinotinto arriba a la derecha, junto al encabezado
  («RECIBO DE TRANSPORTE DE MATERIAL … Nº 42578»). Es el dato clave para cruzar con la
  proforma (`remision`). Transcríbelo solo con los dígitos.
- **FECHA**: tres casillas DD / MM / AAAA (a veces con barras `11/09/2026`). Ojo:
  algunos formularios abrevian el año a 2 dígitos o el mes queda ambiguo por la letra;
  si hay duda entre dos lecturas, ambas van en `legible.fecha`.
- **Sitio de Procedencia** / **Sitio de Descargue**: suele venir como `PK` + progresiva,
  por ejemplo `PK 20+000`, a veces con una abreviatura pegada («PK 20+000 C.DIVIDO»,
  «Putana»). El campo de Descargue muchas veces queda **en blanco o casi ilegible**
  (nombre de sitio abreviado a mano); no inventes el PK si no se lee, deja `null` y
  anótalo en `observaciones`/`legible`.
- **Descripción de material** / **Descripción de actividad**: texto libre a mano
  («corte terraplén», «conformación de terraplén», «descapote»).
- **Cantidad de material (m3)**: número con coma decimal (`17,22`, `16,44`). Va a
  `cantidad_m3` como número con punto decimal.
- **Nombre conductor** / **Placa**: placa en formato `AAA999` (3 letras + 3 números);
  transcríbela sin espacios y en mayúsculas aunque el papel tenga espacio (`USE 111`
  → `USE111`). Si la placa está **tachada y reescrita encima** (pasa varias veces),
  transcribe lo que alcances a leer y pon la duda en `legible.placa` con las dos
  lecturas posibles (p. ej. `"legible": {"placa": "TMX873 (tachada/reescrita, dudosa)"}`).
- **OBSERVACIONES**: casi siempre trae el dato de **número de viajes** cuando el mismo
  recibo cubre varios («3 viajes», «9 viajes», «Interno»). Si dice explícitamente
  «N viajes» con N entero > 1, ese N va en `viajes` (entero); si no hay mención de
  viajes, `viajes: null` (no asumas 1).

## Otro formato: tiquete IMPRESO de báscula de Putana (¡no lo saltes!)

Además del recibo a mano, los PDF traen **tiquetes impresos** de la báscula de la planta Putana
(«Ortiz Construcciones y Proyectos S.A · NIT 900.356.846-7 · Betulia-COLOMBIA»), normalmente **2 por
página**. Son de GRANULARES (triturado, sub base, BTC, bolo, MDC de asfalto) y son los más fáciles de
leer porque están impresos. **Una página con tiquetes SÍ tiene recibos**: nunca la marques «sin recibos».

- Nº: «COPIA DE TIQUETE NUMERO: 8.737» → `recibo_n: "8737"` (quita el punto de miles).
- FECHA de ENTRADA «27/ago/2026» → `2026-08-27`; PLACA (`SQA934`); CONDUCTOR; PRODUCTO → `material`
  («TRITURADO 3/4», «BOLO SOBRETAMAÑO - PUTANA», «SUBBASE 50 AYG», «MDC-25»); ORIGEN («U.I. PUTANA») →
  `procedencia`; DESTINO («22+500», «PK 20+400») → `descargue`.
- **Cantidad**: la de OBSERVACIONES «VOLUMEN.17,69M3» → `cantidad_m3: 17.69` (es el volumen de báscula:
  en granulares manda sobre el de la proforma).
- CODIGO («UF1», «UF-2 ASF») va a `observaciones`: «ASF» delata un viaje de **asfaltos** (no es nuestro).

Ejemplo real (2DA PARTE… p.52): tiquete 8737, 27/08/2026, SQA934, triturado 3/4, Putana → 22+500,
17,69 m³; tiquete 8663, mismo día y placa, **bolo sobretamaño, 19,99 m³** (la proforma lo cobró como
triturado 17,69: justo el tipo de diferencia que hay que reportar). Página 68: tiquete 9159 TAU745 MDC-25
«UF-2 ASF» (asfaltos) y tiquete 9278 BTH918 sub base 50, 15,54 m³ → PK 20+400.

## Tachones y letra dudosa

Si un campo tiene un tachón, una reescritura encima, o la letra es ambigua entre dos
lecturas razonables: escribe tu mejor lectura en el campo normal y **además** agrega
ambas posibilidades en `legible` bajo la misma clave, por ejemplo:

```json
"legible": {"placa": "¿TMX873? (tachada, reescrita encima; también podría ser otra placa)"}
```

No se inventa el dato «bonito»: si no se puede leer con confianza, se documenta la duda,
nunca se elige en silencio.

## Esquema JSON de cada recibo leído

```json
{
  "archivo": "2DA PARTE SOPORTE DE SERVICIOS VOLQUETAS SEPTIEMBRE .pdf",
  "pagina": 93,
  "recibo_n": "42578",
  "fecha": "2026-09-11",
  "placa": "USE111",
  "conductor": "<conductor>",
  "procedencia": "PK 20+000 C.DIVIDO",
  "descargue": null,
  "material": "corte terraplen",
  "cantidad_m3": 17.22,
  "viajes": null,
  "observaciones": "Interno",
  "legible": {}
}
```

- `fecha` en ISO (`AAAA-MM-DD`), derivada de la casilla DD/MM/AAAA del recibo.
- `viajes`: entero si observaciones dice «N viajes» (N>1), si no `null`.
- `legible`: objeto vacío si no hay dudas; si hay, una clave por campo dudoso con las
  lecturas alternativas en texto.
- Un objeto de éstos por recibo (una página puede producir 1 a 4 objetos).

## Ejemplos reales (verificados sobre el render a 110 dpi)

### `2DA PARTE SOPORTE DE SERVICIOS VOLQUETAS SEPTIEMBRE .pdf`, página 93 (2 recibos)

Recibo **42578**: FECHA 11/09/2026. Procedencia «PK 20+000 C.DIVIDO». Descargue en blanco
(el garabato que aparece por encima del renglón está fuera del recuadro y no corresponde
a ese campo). Material «corte terraplén». Cantidad **17,22** m3. Actividad «conformación
de terraplén». Conductor «<conductor>». Placa **USE111**. Observaciones: «Interno».

```json
{"archivo": "2DA PARTE SOPORTE DE SERVICIOS VOLQUETAS SEPTIEMBRE .pdf", "pagina": 93,
 "recibo_n": "42578", "fecha": "2026-09-11", "placa": "USE111", "conductor": "<conductor>",
 "procedencia": "PK 20+000 C.DIVIDO", "descargue": null, "material": "corte terraplen",
 "cantidad_m3": 17.22, "viajes": null, "observaciones": "Interno", "legible": {}}
```

Recibo **42353** (misma página, debajo): mismos datos de fecha/procedencia/material/
cantidad/placa (17,22 m3, USE111), observaciones «Interno». Es el par típico de un
mismo viaje partido en dos recibos consecutivos (42578/42353).

### `2DA PARTE SOPORTE DE SERVICIOS VOLQUETAS SEPTIEMBRE .pdf`, página 51 (4 recibos)

Letra a mano difícil: **el «+» del PK se confunde con un «1»** («PK 1+600» parece «PK 11600»; «PK 3+300»
parece «PK 31300»). Si el PK leído cae fuera de lo razonable para esa placa y ese día, anota ambas
lecturas en `legible.procedencia`. La **fecha** de esta página se lee «0?/09/2026» con el día ambiguo
(05 o 09): va en `legible.fecha`.

- **2725**: placa **BTH918**, procedencia «PK 3+300», material «no aprovechable», **16** m3,
  observaciones «4 viajes» → `viajes: 4`.
- **2710**: placa **BTH918**, procedencia «PK 1+600», material «descapote», **16** m3, «3 viajes».
- **2737**: placa **tachada y reescrita encima** (se lee algo como «TMX873», dudosa), otro conductor
  distinto al de BTH918, procedencia «PK 1+500», «descapote», **16** m3, «9 viajes».
- **2739**: placa **TMX873** (otro conductor), procedencia «PK 1+500», «descapote», **15,44** m3,
  «9 viajes».

```json
{"archivo": "2DA PARTE SOPORTE DE SERVICIOS VOLQUETAS SEPTIEMBRE .pdf", "pagina": 51,
 "recibo_n": "2737", "fecha": "2026-09-05", "placa": "TMX873", "conductor": "<conductor>",
 "procedencia": "PK 1+500", "descargue": null, "material": "descapote",
 "cantidad_m3": 16, "viajes": 9, "observaciones": "9 viajes",
 "legible": {"placa": "tachada y reescrita encima; se lee TMX873 pero es dudosa",
             "fecha": "día ambiguo: 05 o 09"}}
```

Por qué importa: la proforma cobró los cuatro como BTH918, 16 m³ y 1 viaje. Dos recibos parecen de otra
volqueta y todos dicen varios viajes: son discrepancias que el dueño debe ver (no se aceptan en silencio).

## Salida esperada

Una lista JSON con todos los recibos leídos de las páginas que se te pidan, en el
esquema de arriba, para pasarle a:

```bash
python soportes.py cruzar --lecturas lecturas.json --sesion conciliador_sesion_*.json
```
