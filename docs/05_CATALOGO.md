# CATÁLOGO CONSOLIDADO — TM2 Sur

## 1. Actividades (formulario capataz) — CONFIRMADO

Formato: actividad de campo → ítem contractual | unidad | CC | medición | ¿DATA?

### Excavación
- Excavación aprovechable (masivo) → Excavaciones en material común APROVECHABLE | m3 | 02.05 | m³ directo | Sí
- Excavación no aprovechable → Excavaciones en material común NO APROVECHABLE | m3 | 02.05 | m³ directo | Sí (+ZODME auto)
- Excavación de préstamo (Diviso) → Excavación en material común de préstamos | m3 | 02.06 | m³ directo | Sí

### Terraplén
- Núcleo de terraplén → Terraplenes (solo conformación) | m3 | 02.07 | m³ directo | Sí
- Corona de terraplén → Terraplenes (solo conformación) | m3 | 02.07 | m³ directo | Sí
- **Terraplén con crudo de río** (D113) → Terraplenes (solo conformación) | m3 | 02.07 | m³ directo | Sí
- **Terraplén de UF3** (D113) → Terraplenes (solo conformación) | m3 | 02.07 | m³ directo | Sí
- Cereo de corona → (sin ítem) | m2 | — | (PKf−PKi)×11.5 | **No** (no_data)

**D113 — terraplén distinguido por MATERIAL.** Las dos actividades nuevas son terraplén normal: mismo
ítem contractual, mismo CC `37xx.02.07`, y a DATA salen estandarizadas como cualquier otra fila de
terraplén (GRUPO `TIERRAS`, CAPÍTULO `EXPLANACIONES`, DESCRIPCION verbatim de la BASE, copiado A:S sin
cambios). **NO se dividen en núcleo y corona** — decisión explícita del dueño: para estos dos
materiales esa distinción no interesa, *"simplemente es terraplén"*. Por eso son **una actividad cada
una**, al lado de núcleo y corona, y no una variante de ellas. La distinción es **solo de control
interno** y viaja por la columna interna `actividad` de BANDEJA/DATA: se ve en la captura, el panel del
residente, el WhatsApp y el resumen por rango del jefe (fila **Desglose** dentro del bloque de la
actividad, D113d: la línea no se saca de su actividad y el total no cambia), nunca en el maestro. Par H/I de Captura_Diaria: **TERRAPLEN / NUCLEO DE TERRAPLEN** para las dos (el modelo de
maquinaria no tiene SUB ACTIVIDAD propia para estos materiales — confirmado con el dueño). Su
tratamiento aparte en el panel del residente está en §8.

**Fuera de alcance — piedra filtro (CC `3701.06.03`), parqueada (D113).** Se evaluó y se descartó por
costo/beneficio: se usa en contadas ocasiones y meterla al reporte de tierras obliga a abrir el
mecanismo de áreas (su CC es del capítulo `.06.*` = ODT y el área se deriva del CC, así que la línea se
sellaría como ODT y saldría en el panel de drenajes). Ver D113 para el detalle técnico de lo que
exigiría. **No implementar** salvo que el material se vuelva frecuente.

### Conformación / Pedraplén
- Conformación y disposición de sobrantes (ZODME) → ídem | m3 | 02.08 | m³ | Sí (también auto)
- Pedraplén compacto → ídem | m3 | 02.07 | m³ directo | Sí

### Subbase / Base
- Conformación de subbase → Subbase Granular | m3 | 03.01 | m³ directo | Sí
- Cereo de subbase → (sin ítem) | m2 | — | (PKf−PKi)×11.5 | **No** (no_data)
- Base estabilizada con cemento (BTC) → Base granular estabilizada con cemento | m3 | 03.03 | m³ directo | Sí

### Pavimentos (D71)
- Riego de imprimación con emulsión asfáltica → ídem | m2 | 04.01 | m² directo | Sí. GRUPO **PAVIMENTOS**, CAPÍTULO **PAVIMENTOS ASFALTICOS** (así lo tiene la BASE; `grupoFromCc`/`capFromCc` mapean `04.*`). Rama de tierras normal (deriveArea=tierras). Único ítem de pavimentos ofrecido en V1 (acota el "excluye pavimentos" del alcance).

### Desmonte
- Desmonte y limpieza en bosque → ídem | captura m² → DATA en Ha (÷10 000) | 02.01 | + genera no aprovechable (02.05, m²×espesor) → ZODME (02.08) | Sí. Máquina: producción en m².
- Descapote / zonas no boscosas → Desmonte y limpieza en zonas no boscosas | captura m² → DATA en Ha (÷10 000) | 02.03 | + genera no aprovechable (02.05, m²×espesor) → ZODME (02.08) | Sí. Máquina: producción en m³ (m²×espesor).

(Nota: espesor editable, default 0.2. La máquina del frente se atribuye a DOS filas de MAQUINARIA —la contractual con producción m²/m³ y la no aprovechable con producción m³— repartiendo las horas operadas por igual; la ZODME no lleva máquina. D58.)

### Estructuras / MSR
- Relleno para muros de tierra MSR | M3 | 05.04 | directo | Sí
- Material granular drenante MSR | M3 | 05.05 | directo | Sí
- Geobolsas / costales (propybag) | UND | 05.11 | directo | Sí
- Geomalla uniaxial 115 kn/m (método md) | M2 | 05.07 | directo | Sí
- Geomalla uniaxial 55 kn/m (método md) | M2 | 05.06 | directo | Sí
- Geotextil tejido 2890 n (método grab md) | M2 | 05.09 | directo | Sí
- Geotextil tejido 1480 n (método grab md) | M2 | 05.08 | directo | Sí
- Geodrén planar h=1 m | M | 05.10 | directo | Sí
- Geodrén planar h=0,5 m | M | 05.02 | directo | Sí
- Tubería PVC 4" perforada | M | 05.03 | directo | Sí

### Actividades de apoyo (sin producción) — CONFIRMADO
Aplican a excavadoras, motoniveladoras, bulldozer. Estado `no_data`; no van a DATA; sí a MAQUINARIA con producción nula.
- Compactación de terraplén
- Compactación de subbase
- Compactación de BTC
- Paisajeo / ornato
- Adecuación de caminos
- Limpieza de derrumbe

### Mapeo a actividad/subactividad del modelo de maquinaria (Captura_Diaria) — OBSOLETO desde D171

> `Modelo_Produccion_Maquinaria_v2` / `Captura_Diaria` dejaron de usarse (D171). El backend sigue derivando H/I y `a_captura` en la fila de MAQUINARIA para no romper lectores, pero ya no se pega nada. Se conserva como referencia del histórico.
02.03→DESMONTE/DESCAPOTE · 02.05→EXCAVACION COMUN/(NO)APROVECHABLE · 02.06→EXCAVACION PRESTAMO · 02.07→TERRAPLEN/NUCLEO-CORONA-CEREO · 02.08→CONFORMACION/ZODME · 03.01→SUBBASE · 03.03→BASE BTC · 05.04 y 02.12→TERRAPLEN(MSR) · APOYO→APOYO/PAISAJEO, APOYO/ADECUACION, APOYO/DERRUMBE.

**Mapeo explícito actividad del capataz → actividad(H) / SUB ACTIVIDAD(I) de Captura_Diaria** (verificado con datos reales, D52):
- Excavación aprovechable (masivo) → EXCAVACION COMUN / EXCAVACION APROVECHABLE
- Excavación no aprovechable → EXCAVACION COMUN / EXCAVACION NO APROVECHABLE
- Excavación de préstamo (Diviso) → EXCAVACION PRESTAMO / EXCAVACION APROVECHABLE
- Núcleo de terraplén → TERRAPLEN / NUCLEO DE TERRAPLEN
- Corona de terraplén → TERRAPLEN / CORONA DE TERRAPLEN
- Terraplén con crudo de río (D113) → TERRAPLEN / NUCLEO DE TERRAPLEN
- Terraplén de UF3 (D113) → TERRAPLEN / NUCLEO DE TERRAPLEN
- Cereo de corona → TERRAPLEN / CEREO CORONA
- Conformación y disposición de sobrantes (ZODME) → CONFORMACION / ZODME
- Conformación de subbase → SUBBASE / CONFORMACION SUBBASE
- Cereo de subbase → SUBBASE / CEREO SUBBASE
- Base estabilizada con cemento (BTC) → BASE / BTC
- Desmonte y limpieza en bosque → DESMONTE / DESMONTE
- Descapote / zonas no boscosas → DESMONTE / DESCAPOTE

Máquina de **apoyo** (vibro/compactación sobre un frente): hereda el H/I del frente que apoya, producción en blanco. **No pasan a Captura** (sin par definido): paisajeo, adecuación de caminos, limpieza de derrumbe, materiales MSR y pedraplén.

### Drenajes ODT / ODL (D70) — catálogo VIVO en la BASE, servido por `?action=drenajes`
Las actividades de drenajes NO se listan aquí ni viven hardcodeadas en el frontend: son **TODOS los
ítems `.06.*` (ODT — DRENAJE TRANSVERSAL) y `.07.*` (ODL — DRENAJE LONGITUDINAL)** de la tabla de
ítems de la hoja BASE, por proyecto (3701/3702), incluidos los ~20 "box abovedados" aunque no se
usen. El backend los sirve con el endpoint `?action=drenajes` junto con los **147 marcadores de obra
`ODT1-…/ODT2-…/ODT3-…`** (tabla de elementos J/K/L, abscisa puntual) y los frontends arman el
dropdown deduplicando por CC corto (el CC final = proyecto derivado del PK/marcador + código corto).
Reglas:
- **Cantidades directas** en la unidad contractual del ítem (sin conversiones ml→m³/und→m: V2).
- DESCRIPCION **verbatim de la celda** de la BASE — con el typo real `"Excavaciones varias sin
  clasicar"` y el sufijo `" ODL"` en los ítems de longitudinal. NO corregirlos (pivotes del maestro).
- **ODT**: el ELEMENTO es el marcador de obra; ABS INI/FIN = abscisa puntual del marcador (K/L).
- **ODL**: el ELEMENTO es el tramo `"tm2 pk X - Y"` por abscisa (como tierras); opcionalmente un
  marcador ODT si se trabaja el descole de una ODT.
- Sin ZODME, sin no-aprovechable, sin chequeadora, sin actividades derivadas.
- Campos por línea SOLO-WhatsApp (no van a DATA): oficiales, ayudantes, turno de noche, nota libre.
- Máquinas de drenajes: **texto libre** (id/placa + operador + horas opcionales), sin catálogo;
  `a_captura=NO` siempre (no pasan a Captura_Diaria).

**Distinción por MATERIAL en drenajes (D113c) — `Relleno con crudo de río` y `Relleno de UF3`.**
El ítem contractual de la BASE es UNO —`37xx.06.02` **"Rellenos con material seleccionado"**, m³, ODT—
y lo que hay que distinguir es con qué material se hizo, igual que el terraplén de tierras (§1). Como
en drenajes la actividad ERA la descripción del ítem, se resuelve con **variantes de actividad**:
config `VARIANTES_DREN` en `Codigo.gs` (CC corto → nombres), servida en `?action=drenajes` como
opciones adicionales del mismo ítem — **mismo CC, misma DESCRIPCION verbatim, misma unidad**; lo único
que cambia es el campo `actividad`. Consecuencias:
- **La fila que llega a DATA es idéntica en A–T** a la del ítem normal (GRUPO `DRENAJES Y
  ESTRUCTURAS`, CAPÍTULO `DRENAJE TRANSVERSAL`, ELEMENTO = el marcador ODT, ABS puntual, DESCRIPCION
  del ítem contractual). **Al maestro no llega el material**; la distinción vive en la columna interna
  `actividad`, como en tierras.
- Se ve en el buscador del capataz (`Relleno con crudo de río · Rellenos con material seleccionado —
  06.02 [m3]`: se encuentra por el material, por el ítem o por el CC), en el panel del residente de
  drenajes, en su WhatsApp y en el **desglose por material** del panel del jefe (D113d), dentro del
  bloque del ítem.
- El panel de drenajes agrupa por `actividad||descripcion` (`actKey`), no al revés: para lo ya
  reportado es el mismo string —los dos frontends guardaban `actividad = descripcion`—, así que el
  histórico se ve igual y solo las variantes salen separadas.
- El **acumulado por ODT** (`acumulado_drenajes`) suma las variantes junto al ítem: contractualmente
  son el mismo ítem.
Ampliable sin más código: agregar CC corto y nombres a `VARIANTES_DREN`. **Los nombres quedan grabados
en BANDEJA y DATA** — cambiarlos después parte el histórico en dos.

**Ítem NUEVO de drenajes: no necesita código (D113b).** Distinto del caso de arriba. Como el catálogo
es vivo, `?action=drenajes` sirve TODO ítem `.06.*`/`.07.*` de la tabla de ítems de la BASE (A–H) con
su descripción y unidad verbatim: **agregar la fila a la BASE es la implementación completa**, aparece
solo en el buscador y sale a DATA por la rama de drenajes de siempre. Lo que NO resuelve es distinguir
el material bajo un ítem que ya existe — para eso están las variantes de arriba, porque la DESCRIPCION
viaja verbatim al maestro (D68) y ahí debe verse el ítem contractual, no el material.

**Ítems "extra" de drenajes (D71) — CC que NO deriva el área por sí solo.** Config `EXTRA_DREN` en
`Codigo.gs` (CC corto → { áreas ofrecidas, capítulo verbatim }). Se sirven en `?action=drenajes` para
cada área listada (desc/unidad verbatim de la BASE) y el **área real de la línea la fija el reporte
(columna `area`), no el CC** — por eso `buildDataRow`/ingesta/`enviar_data` usan `areaDeFila(c.area,cc)`.
DATA lleva una columna interna `area` para pisar por día+área sin confundirlos con tierras.
- **Demolición de Estructuras** → GRUPO `DRENAJES Y ESTRUCTURAS`, CAPÍTULO `DEMOLICIONES Y
  REUBICACIONES`, CC corto `01.02`, unidad **m³** | ofrecida en **ambas** áreas (ODT y ODL).

## 2. Orígenes de material (chequeadora) — CONFIRMADO
- Masivo 2 (PK 19) → excavación aprovechable
- Masivo 1 (PK 14) → excavación aprovechable
- Diviso / Préstamo → excavación de préstamo
- PK Complementario (texto libre) → aprovechable
- Otro origen (texto libre) → aprovechable

Notas cerradas: Crudo de Río y Fresado = materiales, no orígenes. Botadero/RCD = destino, no origen.
**Enmienda D113:** sigue siendo cierto que **no son orígenes** —la chequeadora no los ofrece, porque
solo mide los viajes desde los bancos de corte propio—, pero el **crudo de río** ya tiene **actividad
propia en el reporte del capataz** (`Terraplén con crudo de río`, §1), junto con `Terraplén de UF3`. La
distinción de material se hace por actividad, no por origen. El **fresado** sigue sin actividad propia.

## 3. Tipos de destino (chequeadora) — CONFIRMADO
Terraplén (genera fila de terraplén) · Puente · UF3 (D160) · ODL · ODT · Botadero.
Solo **Terraplén** genera fila de terraplén; el resto solo cuenta para la excavación del origen (Botadero va como excavación NO APROVECHABLE, D67). **Puente/UF3/ODL/ODT** cuentan para la excavación y salen en la nota del reporte, pero no en la suma del terraplén (UF3 = destino, no confundir con el material `Terraplén de UF3` del capataz, §1).

## 4. Máquinas — ficha en `PARTE_EQUIPOS`, estancias en `MAQUINAS` (D171/D173)

**Desde D173 (sep-2026) la flota vive en DOS hojas del Sheet de obra con un rol cada una:** `MAQUINAS` = **quién está en obra, desde cuándo y en qué frente** (una fila por estancia: `id_maquina · tipo · horas_prog · propiedad · fecha_ingreso · fecha_retiro · notas · frente`; ventana semiabierta `[ingreso, retiro)`; se administra desde Maquinaria › Flota; semilla `backend/seeds/MAQUINAS.tsv`) y `PARTE_EQUIPOS` = **la ficha** de cada equipo (`codigo · tipo · placa · proveedor · medidor · ultima_fecha · ultimo_final · activo`; semilla `backend/seeds/parte/PARTE_EQUIPOS_semilla.csv`; el alta desde Flota la crea sola). El Parte Digital espera cada día a los vigentes de UF1-UF2; un equipo con ficha pero fuera de la flota reporta igual con la alerta `FUERA_DE_FLOTA` (D173b). El reporte del capataz ofrece como chips los vigentes del día. **El capataz ya no captura horas, operador ni motivo** (D171).

**Flota vigente UF1-UF2 al 15-sep-2026 (25 equipos; la verdad está en la hoja, esta tabla es la foto):**

| Grupo | Equipos | Propiedad / proveedor |
|---|---|---|
| BULLDOZER | BL005 | propia |
| EXCAVADORA | EXC015 · EXC030 · EXC04 · MC64 | EXC015 propia; EXC030/EXC04 EQUINORTE; MC64 GEOEXCON (retro de llantas) |
| MOTONIVELADORA | MO004 · MO009 | propias (MO003 a taller 5-sep) |
| VIBROCOMPACTADOR | CR016 · CR019 · NH403 | CR propios; NH403 DINISSAN (CR013 a taller 5-sep; CR008/NG002 intermitentes BTC, fuera desde 4-sep) |
| MINIBULDOZER · RETROEXCAVADORA | CR026 · RT-02 | CR026 propio; RT-02 MAQUISABANA (la pajarita) |
| VOLQUETA | VOL012 · VOL044 · VOL048 · VOL056 · VOL065 · VOL067 | propias (VOL010/VOL047/VOL054 a taller 5-sep; VOL031 29-ago; VOL039 sin parte desde 7-sep, CONFIRMAR) |
| TRACTOCAMION / CAMABAJA | TC095 · SJQ401 | TC095 propia; SJQ401 ASOVOLSAT (camabaja alquilada del mes, desde 7-sep; LPM670 hasta 5-sep). TC065/TC092 a TM1 desde 7-sep |
| CARROTANQUE | CT012 · XMC714 | CT012 propio; XMC714 TRANSVISA (XVX241 hasta 21-ago) |
| TURBO · CAMION | LPM206 · CG007 | LPM206 COTRASABANA; CG007 propio |
| LUMINARIA | TI12 | propia (sin parte desde 1-sep, CONFIRMAR) |

**UF3 (responsable Alfonso) queda fuera de la flota y del parte por decisión del dueño (sep-2026; backlog 4.05):** CAT074, LPL321, MNC319, M73, EXC190, RT-01, SRS105, 15, 18, EXC026, CR028, CR029, TI08, TI011, VOL022, VOL040, MC86. Conservan ficha con `activo=NO`.

**Tipos.** De producción (regla de producción nula por tipo, ven el panel del día y la chequeadora): BULLDOZER · EXCAVADORA · MOTONIVELADORA · FINISHER · VIBROCOMPACTADOR · MINICARGADOR · MINIBULDOZER · RETROEXCAVADORA. De flota (solo Flota y parte): VOLQUETA · CAMABAJA · TRACTOCAMION · CARROTANQUE · CAMION · TURBO · CISTERNA · LUMINARIA. Un tipo nuevo se acepta con aviso, sin producción.

**Cómo añadir y quitar maquinaria (un solo sitio: Maquinaria › Flota; roles admin/residente/jeisson):**
- Llega un equipo → **Dar de alta**: código del parte (MO003, VOL048, RT-02 con guion), tipo, frente, propiedad, fecha de ingreso, placa, medidor (HORÓMETRO/KM), proveedor. Crea la ficha en `PARTE_EQUIPOS` si falta. Luego `python3 tools/generar_qr.py --solo CODIGO` e imprimir y pegar la etiqueta.
- Se vara y la reemplazan uno o dos días → **nada en la Flota**: la varada se cierra como «Taller» en Equipos sin parte y el reemplazo reporta por su QR (llega con alerta `FUERA_DE_FLOTA`). Solo si el reemplazo se queda semanas, dale el alta.
- Se va (devolución, taller largo, a otra obra) → **Dar de baja** con el PRIMER día que ya no estuvo. Deja de esperarse en «Equipos sin parte»; su histórico no se toca.
- Vuelve → **Reingreso** (fila nueva, mismo código, mismo QR). Nunca editar la estancia vieja.
- Cambio de frente (UF1-UF2 ↔ UF3) → baja en un frente + alta en el otro. **Corregir** es solo para una estancia mal escrita.

**Histórico (se conserva como registro; no mantener a mano):**

**Retiradas de la obra (jun-2026, D61):** CAT320 (excavadora alquilada) y MC705 (motoniveladora alquilada). Ya no aparecen en los desplegables de capataz/chequeadora, ni en el panel de producción, ni en el estado de máquinas faltantes.

**Devueltas / entregadas (ago-2026, D136):** **NH69** (bulldozer alquilado), **BL009** (bulldozer propio), **EXC001, EXC013, EXC014** (excavadoras propias), **CS78B** (vibro GEOEXCON), **NH404, NH420** (vibros DINISSAN), **CAT900** (vibro SK RENTAL) y **NH421** (minicargador DINISSAN). Mismo tratamiento que D61: salen de los desplegables de capataz y chequeadora, del catálogo del panel de producción y de la flota esperada de `estado.html`/panel. **Su histórico en MAQUINARIA no se toca** (las filas ya escritas siguen ahí y siguen saliendo en los informes del período en que trabajaron). Quedan **5 máquinas en la flota esperada** (BL005, EXC015, MO03, MO04, MO09), **un solo bulldozer** (BL005) y **una sola excavadora** en el selector de la chequeadora (EXC015). El único vibro alquilado que queda es NH403.

**El catálogo VIVE EN LA HOJA `MAQUINAS`, no en esta tabla (D138).** Desde D138 la flota la sirve `?action=maquinas&fecha=` desde la hoja `MAQUINAS` del Sheet de obra (`id_maquina · tipo · horas_prog · propiedad · fecha_ingreso · fecha_retiro · notas`), con **una fila por ESTANCIA**: una máquina que entra y sale cinco veces son cinco filas, y la ventana es **semiabierta `[fecha_ingreso, fecha_retiro)`** — `fecha_retiro` es el primer día que YA NO estuvo, igual que `activaEnFecha` de D85. Alta o baja = editar una fila, **sin tocar código ni redesplegar**. Existe porque las máquinas entran y salen continuamente según la necesidad (alquilar y tener parado es caro: el finisher **FNG02** y el vibro **CR08** trabajan en pareja y solo se traen cuando hay BTC). La tabla de arriba pasa a ser **referencia y respaldo**: es lo que sirve `MAQ_CATALOGO` si la hoja falta o está vacía —nunca se sirve una flota vacía, que dejaría al capataz sin poder reportar nada—, así que conviene mantenerla grosso modo al día aunque ya no mande. Semilla lista para pegar en `backend/seeds/MAQUINAS.tsv`. **El ID debe coincidir letra por letra con `dim_maquinaria`** (D111) o el pegado a Captura_Diaria deja de cruzar en silencio; el endpoint devuelve `avisos` con lo que encuentre raro.

**La flota se ADMINISTRA desde la pantalla (D139, backlog 2.29).** `produccion-maquinaria.html` se llama ahora **Maquinaria** y tiene dos pestañas: **Producción del día** (lo de D59/D60/D61/D62, sin cambios) y **Flota**, que escribe la hoja `MAQUINAS` desde la web — alta, **reingreso** (fila nueva, nunca editar la vieja: se perdería el hueco en que la máquina no estuvo), **baja** (poner `fecha_retiro` = **el primer día que YA NO estuvo**, no el último que trabajó) y corrección de una estancia mal escrita. Se lee de un vistazo: arriba un **resumen** (*en obra hoy* / *fuera* + un chip por tipo), luego **En obra hoy** en una tabla agrupada por TIPO, y **plegado aparte** lo que ya no está —se mira solo si se quiere—; los **`avisos`** de la hoja, que hasta D139 nadie veía, salen arriba. Es una pestaña de **escritorio** (contenedor ancho, como `digitadora.html`). **Por qué existe:** desde D138 el `id_maquina` lo teclea una persona y **tiene que coincidir letra por letra con `dim_maquinaria`** (D111) o el pegado a Captura_Diaria deja de cruzar en silencio; al dar de alta un código desconocido la pantalla compara contra los `id_maquina` del **histórico de MAQUINARIA** —el vocabulario que de verdad se pega a Captura— y pregunta antes de guardar (`RT02` → propone `RT-02`). Leer `dim_maquinaria` no es opción: es un `.xlsx` maestro. **Accesos:** `admin` y `residente` editan las dos pestañas; **`jeisson` solo la flota**; **`jefe` en solo lectura**, con su puerta en `jefe.html`. La escritura verifica el rol **en el servidor** (D109), valida las dos fechas (D106) y rechaza claves duplicadas y estancias traslapadas. Editar la hoja **a mano sigue funcionando igual**: la pantalla es otra puerta a la misma hoja, no la sustituye.

**Flota esperada = TODA la flota vigente ese día (D137, enmienda D61d/D111; afinado por D138):** la lista contra la que `estado.html` y la sección "máquinas faltantes" del panel de producción marcan quién **no** reportó ese día son **todas las vigentes ese día**, no solo las productivas. Antes eran las 10 de BL/EXC/MO/NH69 y los vibros, el finisher, el minibuldózer y la RT-02 quedaban fuera, así que de esas nunca se sabía si habían trabajado o si simplemente nadie las reportó. Con D138 esto se resuelve solo: **esperada = vigente en la hoja**, así que una máquina devuelta deja de esperarse el día de su retiro y una recién llegada empieza a esperarse el día de su ingreso, sin listas paralelas. Las pantallas ya no llevan la lista escrita (solo un respaldo), y `MAQ_FLOTA_ESPERADA` quedó derivada de `MAQ_CATALOGO` para el camino de respaldo. Ojo con la lectura: "FALTA" aquí significa **sin reporte**, no "máquina parada" — una máquina que no trabajó ese día tampoco se reporta (D28), y es el residente quien la anota como inoperativo en texto libre.

**Regla de producción por tipo** (vigente; desde D171 se decide por CONTENIDO del `tipo` de `PARTE_EQUIPOS`: contiene COMPACTADOR / MINICARGADOR / MINIBULDOZER / RETROEXCAVADORA / RETROCARGADOR → sin producción, `esTipoSinProduccion`):
- VIBROCOMPACTADOR (y `COMPACTADORES`, `VIBROCOMPACTADOR RENTAL …`): producción siempre nula — compactan frentes ejecutados por otras máquinas; el campo producción no se muestra ni se guarda.
- MINICARGADOR y MINIBULDOZER (CR026; NH421 hasta su devolución en ago-2026, D136): producción siempre nula — mismo tratamiento que los vibrocompactadores en cuanto al campo `produccion`. La regla se mantiene por TIPO, no por máquina: si vuelve a entrar un minicargador se comporta igual sin tocar código.
- RETROEXCAVADORA (RT-02, la pajarita, D111): producción siempre nula — apoya frentes de otras máquinas. Solo aparece en el reporte del capataz de TIERRAS (no en el de la chequeadora, cuyo selector es solo excavadoras, ni en drenajes, que captura máquinas en texto libre); no entra en el selector de "redirigir producción" de la pestaña de producción (**sí** en la flota esperada desde D137/D138: se espera saber de ella si reportó o no).
- Actividades de apoyo (Compactación terraplén/subbase/BTC · Paisajeo / Adecuación de caminos / Limpieza de derrumbe): producción nula para cualquier tipo de máquina.
- Todos los demás tipos + actividades productivas: producción = largo de la línea de la actividad.

CC habituales por máquina (de reportes Abr–May; incluye máquinas ya devueltas, se conservan como referencia del histórico): BL→02.07/02.08 · EXC→02.05/02.06/02.03 · MO→02.07/03.01/03.03 · CR013→02.07-UF2/03.01 · CR016→02.07/03.01 · CR019→02.07-UF1 · FNG02→03.03.

**PENDIENTE DE VALIDAR:** marca/modelo/valor-hora reales de vibros nuevos en dim.

**Códigos huérfanos resueltos (D137):** **CR08** estaba solo en el desplegable del capataz y **entra al catálogo** como vibro ORTIZ propio (6.4 h). **CR020** y **D150B** estaban solo en el chip "maquinaria sin reporte" del panel del residente —se listaban como faltantes aunque nadie podía reportarlas— y **no están en obra** (confirmado por el dueño, ago-2026): salen. Con esto el bulldozer alquilado D150B y la motoniveladora 120 alquilada dejan de figurar como IDs pendientes.

## 5. Motivos / Estados — OBSOLETO en el formulario del capataz (D171)

> Desde D171 el capataz **no** captura motivo ni horas, así que la fila de MAQUINARIA lleva `motivo` y ESTADO vacíos y el mapeo de abajo ya no se genera. El motivo de un día sin operación lo captura el operador en el Parte Digital (`Taller` · `Disponible` · `Domingo/Festivo` + descripción, D165). Se conserva como referencia del histórico.

Motivos (dropdown, 10): Mantenimiento · Sin operador · Falla mecánica · Lluvia/clima · Sin frente de trabajo · Esperando material · Abastecimiento de combustible · Traslado/movilización · **Bloqueo** · Otro (especificar).
Estados reales en Captura_Diaria (9): OPERANDO · LLUVIAS · NO PROGRAMADO · MEDIA JORNADA · ESPERA · VARADO · MANTENIMIENTO · SIN OPERADOR · BLOQUEO.

**Mapeo motivo → ESTADO** (lo genera el app en la fila de MAQUINARIA, D52):
- (sin horas muertas) → OPERANDO
- Mantenimiento → MANTENIMIENTO
- Falla mecánica → VARADO
- Sin operador → SIN OPERADOR
- Lluvia/clima → LLUVIAS
- Sin frente de trabajo · Esperando material · Abastecimiento de combustible · Traslado/movilización · Otro → ESPERA
- Bloqueo → BLOQUEO

MEDIA JORNADA y NO PROGRAMADO **no salen del app**; son ajuste manual del encargado en Captura (D52).

**Máquina con 0 horas operadas:** el capataz NO la reporta. El encargado la registra como inoperativo en texto libre desde su panel (D28); entra al WhatsApp, no a MAQUINARIA.

## 6. Tipos de reporte / fuentes — CONFIRMADO
| Fuente | Aporta | Dueño del número |
|---|---|---|
| Chequeadora (web) | viajes×PK destino por origen | Volumen excavación + terraplén |
| Capataz (web) | actividades, producción medida (subbase/BTC/MSR/desmonte), equipos+horas | Subbase, base, MSR, desmonte; equipos |
| Encargado (web) | reconciliación, líneas faltantes, inoperativos | Versión oficial (DATA) |
| Chequeadora Diviso (foto, externa) | viajes del diviso | Préstamo — sin digitalizar (V3) |

## 7. Usuarios — CONFIRMADO (contraseñas de encargado/chequeadoras = placeholder)
admin/venganza753 → menu · encargado/enc1-2 → encargado · residente/Ortiz2026 → residente · jefe/Ortiz2026 → jefe · capataz1-5/uf1-2 → reporte-capataz · chequeadora1-3/cheq1-2 → reporte-chequeadora.
**Residente** (rol `residente`, D57): entra a `residente.html` (panel de selección) → tile activo al Panel del Encargado (guard de `encargado.html` extendido para aceptar el rol) y tile **Resumen General** que ahora abre `jefe.html` (D65).
**Jefe** (rol `jefe`, D65): usuario `jefe`, clave `Ortiz2026` (placeholder); entra a `jefe.html` — consulta post-DATA por rango de fechas (solo lectura): resumen por actividad + ubicación (PK crudo) y copiado A:S día a día, ahora con filtro de **Área** (Tierras/ODT/ODL/Todas, derivada del CC en cliente, D70). Guard acepta `jefe`/`admin`/`residente`. **Admin:** botón "← Menú" en toda pantalla interna vuelve a `menu.html` sin cerrar sesión.
**Drenajes (D70/D84, claves placeholder):** capataces NOMINALES por área (usuario propio → trazabilidad en `reporta`, como los de tierras; el **rol** `capataz_odt`/`capataz_odl` activa el modo por defecto, clave común `dren2026`): **ODT** = `mauricio`, `eduardo`, `enrique`; **ODL** = `jairo`. Todos → `reporte-drenajes.html`. **D84:** el área de CADA línea se deriva del CC del ítem (06→ODT, 07→ODL); con el campo opcional `areas` en el login (`['odt','odl']`) un capataz reporta los dos capítulos en una sola lista (sin el campo se comporta igual que hoy). **Residente de drenajes unificado `residente_dren`** (clave `Ortiz2026`, rol `residente_dren` → `['odt','odl']`) → `residente-drenajes.html` con bandeja **combinada** ODT+ODL (una llamada `enviar_data` por área, con guard anti-borrado; WhatsApp con toggle un-mensaje/uno-por-área). Los logins `residente_odt` y `residente_odl` fueron **eliminados** (D84/D85); los roles de un área se conservan en guards por retrocompatibilidad. D85: los cuatro capataces de drenajes tienen `areas: ['odt','odl']` y la actividad se elige con **buscador** (patrón del buscador de CC, D78). El admin entra a ambas pantallas desde `menu.html`. La lista "capataces esperados" del panel (`CAPATACES_ESPERADOS_POR_AREA`) usa estos nombres y **no cambia** con D84 (cada capataz sigue esperado solo en su área primaria).

**Módulo Asistencias (D69) — usuarios y mapa cuadrilla→responsable.** `jeisson` (clave `Ortiz2026` placeholder, rol `asistencia_plus`): entra a `seleccion-reporte.html` con tiles "Asistencia de mi grupo" y "Resumen de asistencias" (sin reporte de obra, sin gestión de personal). **`residente_uf3` (D101, clave `uf32026` placeholder, rol `asistencia_plus_uf3` → `['uf3']`):** el equivalente para **UF3 / proyecto 3703** — mismos dos tiles que `duvan` ("Asistencia de UF3" y "Resumen de asistencias"), reporta cualquier cuadrilla activa de `uf3` incluidos días anteriores, revisa el resumen, completa faltantes, consulta ausencias, exporta `Parte_3703_{fecha}.xlsx` y gestiona el personal de su área; sin acceso a ninguna pantalla de obra. **`duvan` (D88, clave `Oficial2026` placeholder, rol `asistencia_plus_dren` → `['odt','odl']`):** el equivalente de `jeisson` para **drenajes**, solo asistencias — entra a `seleccion-reporte.html` con tiles "Asistencia de drenajes" y "Resumen de asistencias". **Reporta la asistencia de CUALQUIER cuadrilla de ODT/ODL**: elige la cuadrilla en el formulario como el admin, porque `cuadrillasDeUsuario('duvan')` devuelve todas las cuadrillas **activas** de sus áreas sin mirar la columna `responsables` (hoy EDUARDO/MAURICIO/ENRIQUE/JAIRO); los capataces de drenajes conservan su propio canal y el envío pisa fecha+cuadrilla (D03), con `reporta=duvan`. **D105: tiene además su propia cuadrilla `DUVAN`** (`area=odt`, responsable `duvan`) para la gente de drenajes que no cuelga de un capataz — el papel que `OPERADORES` cumple para `jeisson`; se creó vacía y él le asigna el personal. Además revisa el día de ODT+ODL, completa faltantes, exporta el Excel Navision combinado y gestiona el personal de esas cuadrillas (puede mover gente ODT↔ODL). **No** entra a `residente-drenajes.html` ni a `reporte-drenajes.html` (guards por rol) y **no** ve tierras ni las extras del admin. Sus CC "frecuentes" son los de ODT+ODL (D88e). **`angie` (D119, clave `Asist2026` placeholder, rol `asistencia_plus_tm2` → `['tierras','odt','odl']`):** la persona dedicada a asistencias de **TM2 Sur** — el molde de `duvan` y `residente_uf3` pero con **tres áreas a la vez** (nace de la auxiliar administrativa que tecleaba las planillas en Navision y renunció). Entra a `seleccion-reporte.html` con los tiles "Asistencia de personal" y "Resumen de asistencias". **Reporta la asistencia de CUALQUIER cuadrilla activa de tierras/ODT/ODL**: `cuadrillasDeUsuario('angie')` usa la misma rama de área que `duvan`, sin mirar `responsables` (hoy ANGEL, ROBINSON, ALEJANDRO, OPERADORES, EDUARDO, MAURICIO, ENRIQUE, DUVAN, JAIRO — las de tierras salen aunque su columna `area` esté **vacía**, que se normaliza a `tierras`); los capataces, `jeisson` y `duvan` conservan su canal y el envío pisa fecha+cuadrilla (D03/D107) con `reporta=angie`. En el formulario el `<select>` **etiqueta cada cuadrilla con su área** cuando la lista mezcla varias. Revisa el resumen de las tres áreas con selector **"Ver como" (Todas/Tierras/ODT/ODL)**, completa faltantes, edita el detalle por cuadrilla, sigue ausencias por rango, exporta el Parte de **3701 y 3702** y gestiona el personal de sus áreas (incluido **mover tierras ↔ ODT ↔ ODL**). **No** entra a ninguna pantalla de obra, **no** ve UF3/3703 (ni tecleando `&area=uf3`: `areasEfectivas` intersecta y lo ignora) y **no** registra las extras del admin. **No tiene cuadrilla propia** (backlog: sería una fila en CUADRILLAS y cero código, patrón D105). Capataces de tierras (`angel/alejo/robinson`) y `mairy` conservan su usuario/clave/rol de siempre pero aterrizan en `seleccion-reporte.html` (su reporte de obra + tile "Asistencia de personal"). **D145 — `albert` vuelve de UF3 a tierras (UF1/UF2):** rol `capataz` y fila `activo` en `USUARIOS`, pero `redirige = reporte-capataz.html` **directo**, sin pasar por `seleccion-reporte.html`: recupera el reporte de obra (y su puesto en `CAPATACES_ESPERADOS` del encargado) y **no** la asistencia, porque la cuadrilla ALBERT la siguen reportando `maleja`/`maria` (D84(3)/D134) — devolvérsela abriría dos canales que se pisan sobre la misma fecha+cuadrilla (D03/D107). Queda registrado en `TILES` y excluido del tile automático de asistencia, para que devolvérsela sea quitar una condición. `ariel` sigue fuera. **D84:** CUADRILLAS gana la col `estado` (`activa`/`inactiva`, vacío=activa) para sacar una cuadrilla de circulación sin borrar su fila. Semilla de la hoja CUADRILLAS (`cuadrilla·responsables·area·estado`, data-driven: se amplía sin tocar código):

| Cuadrilla | Responsable(s) (usuario del login) | Estado |
|---|---|---|
| ANGEL | angel | activa |
| ROBINSON | robinson | activa |
| ALBERT | maleja + maria (D84: `maleja` quedó como responsable al salir `albert` a UF3, D75 doble deber; D134: `maria` de relevo temporal). **D145: `albert` volvió a tierras pero NO recupera la cuadrilla** — el nombre y el histórico se quedan donde están | activa |
| ARIEL | — (D84: `ariel` salió a UF3; su gente se movió a ROBINSON) | **inactiva** |
| ALEJANDRO | alejandro (alias de `alejo`, mismo capataz — ver nota abajo) | activa |
| OPERADORES | jeisson | activa |
| VOLQUETEROS | mairy | activa |
| UF3 (`area=uf3`, D101) | — (sin capataz con login; reporta `residente_uf3`) | activa |
| DUVAN (`area=odt`, D105) | duvan (su cuadrilla propia, el `OPERADORES` de drenajes; la gente la asigna él) | activa |

Cuadrillas de drenajes (D72, col `area` en CUADRILLAS): **EDUARDO**/`eduardo`, **MAURICIO**/`mauricio`, **ENRIQUE**/`enrique` (`area=odt`) y **JAIRO**/`jairo` (`area=odl`, 21 pers. del Parte 10-jul; capataz YONH JAIRO REYES GONZALEZ 75781 con `cargo=CAPATAZ`). **D105:** **DUVAN**/`duvan` (`area=odt`) — la cuadrilla propia de `duvan` para la gente de drenajes que no cuelga de un capataz (lo que `OPERADORES` es para `jeisson`); se siembra **sin personal**, él lo asigna desde la gestión de personal del resumen. `area=odt` es solo etiqueta de visibilidad: el capítulo del Parte lo decide el CC de cada persona (06.\* / 07.\*). Cuadrilla de UF3 (D101, `area=uf3`): **UF3**, sin responsables — la reporta `residente_uf3` por la rama de área. 35 personas del Parte de UF3, tres con `cargo=CAPATAZ` (76804 ARIEL LISANDRO CORREA, 76626 CARLOS ERNESTO VILLADA, 75746 ALBERT ESNAIDER ROJAS). Seeds TSV para pegar en el Sheet en `backend/seeds/`.

Nota: `alejo` (usuario real del login) y `alejandro` (nombre usado en la cuadrilla) son la misma persona; el backend (`cuadrillasDeUsuario` en `CodigoAsistencias.gs`) los trata como alias. Gestión de personal (alta/retiro/mover/reactivar) `residente`/`admin` y los residentes de drenajes (`residente_odt`/`residente_odl`/`residente_dren`, cada uno acotado a sus áreas; `residente_dren` puede mover personal entre cuadrillas ODT↔ODL, D84), validado también en el backend. Acceso a `resumen-asistencia.html`: `residente`, `admin`, `jeisson`, `residente_odt`/`residente_odl`, `residente_dren` (D84: export combinado ODT+ODL en un archivo) `duvan` (D88, rol `asistencia_plus_dren`, mismo alcance ODT+ODL que `residente_dren` pero solo en asistencias) y `residente_uf3` (D101, rol `asistencia_plus_uf3`, acotado a `uf3`; también gestiona el personal de su área). **D119:** `angie` (rol `asistencia_plus_tm2`, acotada a `['tierras','odt','odl']`) — también completa faltantes, gestiona el personal de sus tres áreas y es el **único rol además del admin con selector "Ver como"**, gracias a la regla de **intersección** de `areasEfectivas` (el `&area=` acota dentro de las áreas forzadas y nunca las amplía; intersección vacía = parámetro ignorado).

**Horas por persona (D112).** Pantalla `horas-persona.html`: **no estrena roles ni usuarios**. Entra exactamente quien ya entra a `resumen-asistencia.html` — `residente`, `admin`, `asistencia_plus` (jeisson), `asistencia_plus_dren` (duvan), `asistencia_plus_uf3` (residente_uf3), `residente_odt`/`residente_odl`/`residente_dren` —, cada uno **acotado a su área por el backend** (endpoint `?action=persona`, solo lectura: pedir por URL a alguien de otra área devuelve `ok:false`). Se entra desde el encabezado del resumen ("🕐 Horas por persona") y desde un tile de `menu.html` (admin); `seleccion-reporte.html` no cambia. `asistencia_plus_tm2` (angie, D119) entra por la misma puerta, acotada a tierras+ODT+ODL. Los trabajadores **no tienen login**: consultan a través de quien revisa el resumen. **D142:** la pantalla gana la **entrada propia del admin** («Mis horas extra», solo con rol `admin`) → endpoint `?action=persona_admin` sobre la hoja `EXTRAS_ADMIN` (D73), **solo lectura**. No es un cerrojo de área sino **de persona**: el endpoint exige `rol==='admin'` del **token firmado** (`doGet` pone `e.parameter._rol` desde la sesión; un `&_rol=admin` tecleado en la URL se pisa), así que esas horas **las ve solo él** — ni el residente ni `angie` ni los de drenajes. El buscador **sigue igual** y ya incluía al personal **eventual** (D85) y a los **retirados**; lo que cambia es que ahora se avisa a la vista, y que **al eventual no se le cuentan «días sin reporte»** (no se le espera en el día a día, misma regla del roster/faltantes/D94).

**Canal "solo extras" del admin (D73).** Tile **"Mis horas extra"** en `menu.html` (solo admin) → `mis-extras.html` (guard `rol==='admin'`): registra las horas extras del admin de días puntuales (máx 2h/día) en la hoja `EXTRAS_ADMIN`, aislada del roster. Nuevo parámetro de la hoja **CONFIG**: **`admin_recurso`** = «No. Recurso» del admin en Navision, string exacto formato `código| NOMBRE` (seed `77463| CESAR AUGUSTO GALVIS SANDINO`, valor del dueño — debe coincidir carácter por carácter con el listado de Trabajadores de Navision; si queda vacío el generador NO agrega la fila del admin y avisa). Flag `EXTRAS_ORDINARIAS_EN_CERO` (en `resumen-asistencia.html`, default `true`): conmutar a `false` si un import real rechaza el `0` en las columnas de horas no usadas con `Ausente=No` (escribe celda vacía; las ordinarias siempre llevan su valor). **D142 — sus extras ya se revisan como las de cualquiera:** el reparto de `EXTRAS_ADMIN` a las columnas del Parte (día normal → E diurna / F nocturna topadas a `max_extras_dia`; dom/fest → **D** hasta `domfest_tope` y el resto a **H**, D120/D124) se muda de `buildAdminExtraRow` a **`clasificarExtraAdmin` en `horas-nomina.js`**, el archivo compartido: el Excel de Navision y la pantalla «Horas por persona» lo llaman los dos, así que no pueden discrepar. La regla no cambia y el Parte tampoco (verificado celda a celda). **CC por defecto del admin** (constante `DEFAULT_CC` en `mis-extras.html`): `3701.I010303| JEFES DE ÁREA DE PRODUCCIÓN Y RESIDENTES` (sobrecosto, cuenta única); el prefijo de proyecto puede variar (3701↔3702) → ambas variantes se inyectan al desplegable y se preselecciona el último usado (o el default en la primera vez).

## 8. Reglas de reconciliación automática (encargado) — CONFIRMADO

- Al cargar la bandeja, las filas de **capataz** en categorías de volumen oficial
  (Excavación aprovechable, Excavación préstamo, Excavación no aprovechable,
  Conformación/ZODME, Terraplén) se **apagan automáticamente** si la chequeadora
  ya reportó esa misma categoría. Quedan marcadas "control · no suma".
  El encargado puede reactivarlas manualmente si hace falta.

- **EXCEPCIÓN — terraplén de material EXTERNO (D113):** `Terraplén con crudo de río` y
  `Terraplén de UF3` **no entran en la reconciliación automática** aunque caigan en la
  categoría "Terraplén". La chequeadora **solo mide los viajes desde los bancos de corte
  propio**: ese material no pasa por ella, así que no hay volumen oficial que sustituya al
  del capataz y apagar sus líneas **perdería volumen real**. Por la misma razón tampoco se
  marcan como "posible duplicado (control vs oficial)". Se reconocen por la columna
  `actividad` (`esTerraplenExterno` en `encargado.html`).

- **Regla terraplén ≤ aprovechable+préstamo**: el panel muestra un aviso verde/rojo
  comparando los totales. Si terraplén > aprovechable+préstamo = probable doble
  conteo o error de volumen. Chequearlo antes de enviar a DATA.
  **D113: el terraplén de material externo (crudo de río / UF3) NO suma en el lado del
  terraplén de esta comparación** — su material no salió de ninguna excavación de la obra, así
  que dispararía la alerta roja sin que haya error. El **total** de la pantalla sí los incluye
  (es terraplén de verdad, y así va a DATA); lo que los descuenta es solo la comparación. Para
  que la diferencia no parezca un descuadre, el aviso lleva debajo una línea que dice cuántos
  m³ dejó fuera, y el total de la categoría anota cuánto de él es material externo.

- Las filas de chequeadora se etiquetan "oficial"; las de capataz en esas categorías
  se etiquetan "control · no suma" y tienen borde punteado.

- **Detección y conciliación de máquina duplicada (D51):** el panel agrupa la maquinaria
  del día por `id_maquina`. Una máquina es duplicado SOLO si el mismo `id_maquina` aparece
  bajo dos o más capataces (`reporta`) la misma fecha → conflicto: se muestra la versión de
  cada capataz y el encargado concilia con el toggle ✓/✕ (incluye una, descarta el resto;
  solo las versiones incluidas pasan al WhatsApp). La misma máquina por UN solo capataz en
  varias actividades/PK NUNCA es duplicado (reparto multi-actividad de D46): se muestra normal
  y sus horas muertas del día = horas_programadas − Σ horas_operadas del grupo. No se compara
  PK ni actividad; el único discriminante es `reporta`. (Sustituye la corrección por desplegable
  + endpoint `editar_maquina`, que asumía duplicado por id_maquina repetido.)
