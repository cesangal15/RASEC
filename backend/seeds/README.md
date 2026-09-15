# Seeds de Asistencias — Drenajes ODT + ODL (D72)

Datos extraídos de los Parte Navison reales (ODT: los dos del 01-jul UF1/UF2; ODL: el del
10-jul UF1) para dejar el módulo de Asistencias funcionando con las cuadrillas de drenajes.
**Son TSV (separados por tab): se pegan directo en el Google Sheet de Asistencias** (no en
los .xlsx maestros).

## Orden de pegado (una sola vez, tras redeploy + `setupHojas()`)

1. **CUADRILLAS_odt.tsv** → hoja `CUADRILLAS`, debajo de las de tierras.
   `cuadrilla · responsables(login) · area · estado`. La 4ª columna `estado` (D84) saca una cuadrilla
   de circulación sin borrar su fila (`activa`/`inactiva`; **vacío = activa**). Tres cuadrillas ODT
   (una por capataz):
   - `EDUARDO` → responsable `eduardo` (LUIS EDUARDO DORADO LOPEZ, UF1/3701)
   - `MAURICIO` → responsable `mauricio` (HERNAN MAURICIO QUIROGA, UF2/3702)
   - `ENRIQUE` → responsable `enrique` (nuevo, aún sin gente; el residente le mueve personal después)

2. **PERSONAL_odt.tsv** → hoja `PERSONAL`, debajo de la gente de tierras.
   57 personas (30 en EDUARDO, 27 en MAURICIO), incluido el capataz como una persona más.
   - `codigo` = número Navison (empata con la hoja Trabajadores de la plantilla al exportar).
   - `cedula` y `cargo` van vacíos (no venían en el Parte): opcionales, el residente los completa.
   - `fecha_ingreso` vacío = "siempre activo" (es la plantilla base). Los ingresos NUEVOS sí llevan fecha.

3. **CC_USADOS_odt.tsv** → hoja `CC_USADOS`, debajo de lo de tierras.
   `string_cc · area`. 71 filas = los del **capítulo 06** (ambos proyectos), que el residente pidió
   mostrar como frecuentes. `area=odt` hace que solo los vean los usuarios de ODT (a los capataces de
   tierra no les ensucia el datalist). **NO incluye el CC del capataz (`I010305`)**: aparecía en el
   selector de CC de los bloques y confundía (es la supervisión del capataz, no la actividad de la
   cuadrilla). Si ya lo pegaste en la hoja `CC_USADOS`, **borra esas 2 filas** (`3701.I010305…` y
   `3702.I010305…`).

## ODL — cuadrilla JAIRO (Parte del 10-jul, UF1)

Mismo procedimiento de pegado que ODT (cada TSV debajo de lo ya existente en su hoja):

1. **CUADRILLAS_odl.tsv** → hoja `CUADRILLAS`. Una sola cuadrilla:
   - `JAIRO` → responsable `jairo` (YONH JAIRO REYES GONZALEZ, código 75781 — venía
     resaltado como capataz en el Parte).

2. **PERSONAL_odl.tsv** → hoja `PERSONAL`. 21 personas, incluido el capataz.
   - Jairo (75781) ya trae **`cargo=CAPATAZ`**: así `asistencia.html` lo excluye de los
     bloques de actividad y le pone su CC `37xx.I010305` automático (D72(4)) — a diferencia
     del seed ODT, donde el cargo quedó para que lo llenara el residente.
   - ⚠️ **JESÚS MANUEL BERMÚDEZ CORREA (76775) ya existe en la cuadrilla MAURICIO** (seed
     ODT) y aparece también en el Parte ODL del 10-jul. Si ya pegaste `PERSONAL_odt.tsv`,
     NO pegues su fila dos veces: usa "Mover" en la gestión de personal (o borra la fila de
     MAURICIO) para dejarlo solo en JAIRO.
   - Nombres verbatim del Parte (p. ej. `LUIS FERNEY0CASTRO`): no importa, el export
     empata por `codigo` contra la hoja Trabajadores de la plantilla.

3. **CC_USADOS_odl.tsv** → hoja `CC_USADOS`. 84 filas con `area=odl`:
   - **Capítulo 07** completo (11 ítems; en el catálogo solo existe bajo 3701).
   - **Capítulo 06** ambos proyectos (la cuadrilla ODL carga a 06.* cuando hace descoles/box
     sobre obras ODT — el propio Parte del 10-jul usa 06.01/06.48/06.60). Los strings 3702
     vienen verbatim del seed ODT (plantilla UF2 del 01-jul); los 3701, del catálogo de la
     plantilla del 10-jul.
   - `3701.I010313| GESTION COMPRAS` (catálogo) y `3702.I010313| GESTION COMPRAS` (verbatim
     del Parte del 10-jul, fila de KEIMIS LERMA): se usan como asignación real de personal.
   - **NO incluye `I010305`** (CC del capataz): el backend ya lo excluye del picker
     (`cc_excluidos_bloque`) y el sistema se lo pone solo al capataz.

## TURNOS.tsv → hoja `TURNOS` (D72)

Los 5 turnos entregados (T1 diurno + T2–T5 nocturnos), una fila por turno × tipo de día
(`turno · tipo_dia · entrada · salida · descanso_ini · descanso_fin · cruza_medianoche`).
`tipo_dia` ∈ {`lv` L–V, `lj` L–J, `viernes`, `sabado`}; `cruza_medianoche=SI` cuando la salida
es del día siguiente (nocturnos). **No hace falta pegar este TSV**: `setupHojas()` ya siembra la
hoja TURNOS con estos mismos valores (si está vacía). El TSV queda como respaldo/edición manual.
El backend los sirve en `?action=roster` (`turnos`) para PRE-LLENAR la entrada/salida del reporte;
la clasificación de extras/recargos nocturnos (columnas G–N Navison) sigue pendiente de confirmar.

## D84 — columna `estado` en CUADRILLAS + checklist de la salida a UF3

D84 agrega la columna **`estado`** a `CUADRILLAS` (4ª columna; `activa`/`inactiva`, **vacío = activa**,
retrocompatible). `setupHojas()` ya la siembra; en una hoja ya existente basta con **añadir el
encabezado `estado`** (el backend auto-sana los encabezados al leer). Una cuadrilla `inactiva`
desaparece del roster de hoy, de los faltantes, del export y de los selectores, pero **sus filas de
fechas anteriores siguen saliendo** en el resumen y el export (el filtro aplica al roster esperado, no
a lo ya reportado).

**Checklist operativo de la salida a UF3 (se hace A MANO en el Sheet, el código no lo automatiza):**

1. `ariel` y `albert` están en `PERSONAL` con `cargo=CAPATAZ`. Se **retiran** con
   `fecha_retiro = 2026-07-27` (primer día NO trabajado). **No se borran.**
2. La gente de la cuadrilla **ARIEL** ya se movió a **ROBINSON**. ARIEL queda vacía → marcar su
   `estado = inactiva` (sin hueco pendiente).
3. La gente de **ALBERT** pasó a Robinson en obra, **pero en el sistema la reporta `maleja`**: la
   cuadrilla **ALBERT se conserva con el mismo nombre** y `maleja` queda como **única responsable**
   (editar la celda `responsables` de ALBERT y dejar solo `maleja`). Renombrar la cuadrilla dejaría el
   histórico apuntando a una cuadrilla inexistente. `maleja` ya tiene doble deber (D75) → cero código.

## D134 — `maria` reporta ALBERT mientras `maleja` está de vacaciones (TEMPORAL)

Relevo temporal, **sin usuario nuevo y sin lógica nueva**: `maria` ya existe como chequeadora (rol
`chequeadora`, sin área forzada) y la columna `responsables` de `CUADRILLAS` admite **varios logins
separados por coma**, que es exactamente el mecanismo por el que `cuadrillasDeUsuario` reparte el
formulario. Dos celdas a mano en el Sheet de OBRA y el de ASISTENCIAS:

1. Hoja **`CUADRILLAS`** (Sheet de asistencias) → fila `ALBERT`, celda `responsables`:
   `maleja` → **`maleja,maria`**. Los dos canales coexisten; el envío pisa `fecha+cuadrilla`
   (D03/D107), así que **manda el último que reporte ese día** (no se duplica, se sobrescribe).
   Que `maleja` siga en la celda es a propósito: al volver de vacaciones no hay nada que rehacer.
2. Hoja **`USUARIOS`** (Sheet de obra) → fila `maria`, celda `redirige`:
   `reporte-chequeadora.html` → **`seleccion-reporte.html`**. Sin esto entra directo a su reporte de
   chequeadora y nunca ve el tile de asistencia. En el repo va la entrada `'maria'` de
   `seleccion-reporte.html` (el tile de asistencia se agrega solo, como a `maleja`/`luzdary`).

**`maria` tiene que volver a entrar CON SEÑAL una vez**: el `redirige` viaja en la sesión guardada del
teléfono (D82/D108) y solo se refresca con un login contra el servidor.

**Para revertir cuando vuelva `maleja`:** dejar `responsables` de ALBERT en `maleja` y `redirige` de
`maria` en `reporte-chequeadora.html`. No hay que tocar el código ni redesplegar el Apps Script (los
cambios en `Codigo.gs`/`CodigoAsistencias.gs` son de las semillas `setup*`, que solo corren en una
instalación nueva), ni borrar nada del histórico: lo ya reportado queda con `reporta=maria`.

**Alternativa que NO se usó:** `angie` (D119, `asistencia_plus_tm2`) ya puede reportar cualquier
cuadrilla activa de tierras/ODT/ODL, ALBERT incluida, sin tocar una sola celda. Si el relevo se alarga
o se repite, ese es el canal permanente; D134 es el atajo para que la gente de ALBERT la siga
reportando quien la ve todos los días.

## D145 — `albert` vuelve de UF3 a tierras (UF1/UF2) y recupera su login

Es la **vuelta atrás del punto (1) de D84** en lo que toca a `albert` (`ariel` sigue fuera). Vuelve a
ser capataz de tierras y vuelve a reportar actividades del día; la ASISTENCIA **no se mueve** — la
cuadrilla ALBERT conserva el nombre y la siguen reportando `maleja`/`maria` (D84(3)/D134), como se
acordó para no dejar el histórico apuntando a una cuadrilla que cambia de manos.

**En el Sheet de OBRA, hoja `USUARIOS` (una fila):**

| usuario | clave | rol | areas | redirige | estado |
|---|---|---|---|---|---|
| `albert` | *(la que se le asigne)* | `capataz` | *(vacío)* | `reporte-capataz.html` | `activo` |

1. Si su fila **ya existe** con `estado` distinto de `activo` (así se saca a alguien sin borrarlo,
   D108), basta con poner `activo` y revisar `rol`/`redirige`. Si no existe, se añade entera.
2. La `clave` se teclea **en claro** y después se ejecuta **`endurecerClaves()`** en el Apps Script de
   obra — la convierte al hash SHA-256 en el sitio (idempotente: lo que ya es hash se deja igual).
3. `redirige = reporte-capataz.html` a propósito: entra **directo** a su reporte. `seleccion-reporte.html`
   le mostraría un tile útil y otro de asistencia que no le traería a nadie (su cuadrilla la reporta
   `maleja`/`maria`). En el repo queda la entrada `'albert'` de `seleccion-reporte.html` **excluida**
   del tile de asistencia, como red de seguridad por si se le apunta ahí.
4. `albert` tiene que **entrar una vez CON SEÑAL**: el rol y el `redirige` viajan en la sesión guardada
   del teléfono (D82/D108) y solo se refrescan con un login contra el servidor. Después ya reporta
   sin cobertura como cualquier capataz (la cola de D82 sube lo suyo al recuperar señal).

**No hay que redesplegar el Apps Script:** el cambio en `Codigo.gs` es la semilla `setupUsuarios()`, que
solo corre en una instalación nueva. El código que decide quién entra lee la hoja `USUARIOS` viva.

**Lo que NO se toca (y por qué):** la hoja `CUADRILLAS` del Sheet de asistencias — `ALBERT` sigue con
`responsables = maleja,maria` — y las cuadrillas ARIEL (`inactiva`) y UF3. En el repo, `encargado.html`
vuelve a esperar su reporte en la bandeja (`CAPATACES_ESPERADOS`); eso solo alimenta el aviso de "falta
por reportar" del día consultado y no altera nada de lo ya guardado.

**Pendiente de decisión del dueño (dato, no código): la asistencia de `albert` como PERSONA.** D84 lo
retiró en `PERSONAL` de tierras con `fecha_retiro = 2026-07-27` y en el seed de UF3 figura como
**75746 ALBERT ESNAIDER ROJAS** con `cargo=CAPATAZ` dentro de la cuadrilla `UF3` (proyecto 3703). Si sus
horas deben volver a pagarse por 3701/3702 hay que moverlo a mano: **alta nueva** en la cuadrilla de
tierras que corresponda con su `fecha_ingreso` real (D85: `reactivar` pierde el hueco de los días en
UF3) y retiro en UF3 con esa misma fecha. Mientras no se haga, su login funciona igual —el reporte de
obra y la asistencia son módulos separados (D69)—, pero su nómina sigue saliendo en el Parte de 3703.

## Cuadrilla propia de `duvan` — asistencias de drenajes (D105)

`duvan` (rol `asistencia_plus_dren`, D88) ya podía reportar CUALQUIER cuadrilla de ODT/ODL, pero no
tenía **cuadrilla propia** donde meter su gente — el equivalente de `OPERADORES` para `jeisson`.

1. **CUADRILLAS_dren_duvan.tsv** → hoja `CUADRILLAS`, una sola fila debajo de lo ya existente:
   - `DUVAN` · responsable `duvan` · `area=odt` · `estado` vacío (= activa).
   - Es **cero código**: el módulo es data-driven, así que la cuadrilla aparece sola en el selector
     del formulario, en el resumen, en los faltantes, en el export y en la gestión de personal en
     cuanto la fila exista (`cuadrillasDeUsuario('duvan')` devuelve todas las activas de sus áreas).
2. **Personal: no hay TSV a propósito.** La gente la asigna `duvan` desde
   `resumen-asistencia.html` → **Gestión de personal**: "Mover" a quien ya esté en otra cuadrilla de
   drenajes, o "Agregar" a quien no exista todavía. Mientras esté vacía, la cuadrilla sale en el
   resumen como "no reportó" y no genera faltantes ni avisos al descargar el Excel (mismo caso que
   `ENRIQUE` cuando se sembró sin gente).
3. **Renombrar o cambiar de área es una celda.** El nombre `DUVAN` sigue la convención de drenajes
   (cuadrilla = nombre del responsable) y `area=odt` es solo una **etiqueta de visibilidad**: `duvan`
   y `residente_dren` ven ODT+ODL, y en el Parte de Navision el capítulo lo decide el **CC de cada
   persona** (06.\* ODT / 07.\* ODL), no el área de la cuadrilla. Si se prefiere otro nombre, se
   cambia ANTES de reportar el primer día (renombrar después dejaría el histórico de `ASISTENCIA`
   apuntando a una cuadrilla inexistente — misma advertencia que en D84 con ALBERT).

## Notas

- El **CC del capataz** es `37xx.I010305| ENCARGADOS, INSPECTORES Y CAPATACES`; el prefijo (3701/3702)
  es el de la UF donde está la mayoría de su gente (opción confirmada: mismo código, cambia el prefijo).
  Cada capataz reporta su propia asistencia eligiendo ese CC (ya está en sus frecuentes).
- ODL (capataz `jairo`) quedó cargado con el Parte del 10-jul (ver sección ODL arriba).
- Si querés ofrecer también el capítulo 07 a ODT, agregá esas filas a `CC_USADOS` con `area=odt`.

## UF3 — cuadrilla UF3, proyecto 3703 (D101)

Origen: hoja **`Parte`** de la plantilla Navision de UF3 que entregó el usuario (jul-2026), incluida en
el repo como **`plantilla_parte_uf3.xlsx`** (también es la plantilla que la app usa para exportar 3703:
misma estructura que la de 3701 —7 hojas, Parte A–R, mismo listado de Trabajadores— pero con la hoja
`Proyectos` de 3703 y sus 580 `Centros de coste`). El generador solo llena la hoja `Parte` y borra las
filas de ejemplo, así que el libro se puede usar tal cual viene.

Mismo procedimiento de pegado (cada TSV debajo de lo ya existente en su hoja):

1. **CUADRILLAS_uf3.tsv** → hoja `CUADRILLAS`. **Una sola cuadrilla** (decisión del usuario):
   - `UF3` · `responsables` **vacío** · `area=uf3` · `estado` vacío (= activa).
     Nadie de UF3 tiene login de capataz todavía: la reporta `residente_uf3` por la rama de ÁREA de
     `cuadrillasDeUsuario` (la misma de `duvan`). El día que haya capataces con login se agregan a
     `responsables` y los dos canales coexisten — cero código.
2. **PERSONAL_uf3.tsv** → hoja `PERSONAL`. 35 personas, todas en la cuadrilla `UF3`.
   - `codigo` = número Navision (empata con la hoja Trabajadores de la plantilla al exportar).
   - `cedula` va vacía (no venía en el Parte); el nombre va **verbatim** como lo escribe Navision.
   - `cargo=CAPATAZ` en los tres que en el Parte llevan el CC de supervisión `3703.I010305`:
     **76804 ARIEL LISANDRO CORREA**, **76626 CARLOS ERNESTO VILLADA** y **75746 ALBERT ESNAIDER ROJAS**.
     Con eso el formulario los saca de los bloques y les pone su CC propio automáticamente (D72(4)).
3. **CC_USADOS_uf3.tsv** → hoja `CC_USADOS`. **316 filas** con `area=uf3`. A diferencia de ODT/ODL
   —donde `CC_USADOS` es una lista corta de "frecuentes" curada para el capataz— aquí quien reporta es
   la RESIDENTE, así que lleva **todos los CC imputables de 3703** y no solo los siete que aparecen en el
   Parte de muestra. El buscador del formulario muestra 60 y filtra al escribir, así que la lista larga
   no estorba. De las 580 filas de la hoja `Centros de coste` de la plantilla se dejan fuera:
   - los **17 encabezados de capítulo** (`3703.00`, `3703.01`, … : no se imputa a ese nivel),
   - los **245 indirectos** (`3703.I*`, `3703.IFIN*`, `3703.DIF01`): staff, oficina, seguros, impuestos
     — no es trabajo de cuadrilla,
   - las 2 filas malformadas `37I0101…| CREADO POR PROCESO`,
   - y **`3703.I010305`** (supervisión del capataz): el sistema se lo pone solo a quien tiene
     `cargo=CAPATAZ` y lo excluye del selector de bloques por `cc_excluidos_bloque` (D72(3)).
   Quedan los 118 `3703.NN.NN` de los capítulos de vía más los 198 de cuarto nivel de los capítulos
   13–17 (EL BARRO, SAN MARTIN, EL MARQUEZ, PEAJES, SITIO CRITICO). Si alguno sobra, se borra su fila.
4. **CONFIG** (a mano, `setupHojas()` solo siembra con la hoja vacía): agregar la fila
   `proyecto_3703` → `3703| T2 - UF3 - R4513 PR 09+800 - PR 90+718` (string exacto de la hoja
   `Proyectos` de la plantilla). Sin esa fila el export avisa y escribe "3703" pelado, que Navision no
   reconoce.

**Cruces con personal existente — revisar ANTES de pegar.** Contra los seeds de ODT/ODL no hay ninguno.
Contra **tierras hay que mirar el Sheet vivo**: `76804 ARIEL` y `75746 ALBERT` son los dos capataces que
dan nombre a las cuadrillas ARIEL/ALBERT y que D84 mandó retirar con `fecha_retiro = 2026-07-27`. Por eso
sus filas de UF3 llevan **`fecha_ingreso = 2026-07-27`**: sin esa fecha aparecerían en el roster de UF3
también en días anteriores a su salida de tierras, y la residente reporta días pasados. Si el checklist
de D84 no se ejecutó (siguen `activo` en tierras sin fecha de retiro), **primero retíralos allá** — si no,
quedan activos en dos áreas a la vez. El resto de las 34 filas va con
`fecha_ingreso` **vacío** (= siempre activo), que es la convención de la plantilla base: solo los ingresos
NUEVOS llevan fecha.

---

## `USUARIOS_asistencias_tm2.tsv` — el usuario de asistencias de TM2 Sur (D119)

**Va en el Sheet de OBRA, no en el de asistencias.** La hoja `USUARIOS` (privada, D108) vive en el
Sheet de obra porque ahí ocurre el login, y de ahí sale el token firmado que el módulo de asistencias
verifica (D109).

`usuario · clave · rol · areas · redirige · estado`

```
angie    Asist2026    asistencia_plus_tm2    tierras,odt,odl    seleccion-reporte.html    activo
```

**Pasos:**

1. Pegar la fila al final de la hoja `USUARIOS` del Sheet de **obra**.
2. Ejecutar **`endurecerClaves()`** desde el editor del Apps Script de obra. Convierte la clave en
   claro a hash; es **idempotente**, así que no rompe las filas ya endurecidas.
3. Redesplegar **solo el Apps Script de ASISTENCIAS** (Administrar implementaciones → editar la
   existente → Nueva versión → **misma URL**). El de obra **no se toca**: el `login()` valida contra la
   hoja de forma genérica, sin lista blanca de roles que ampliar.

**Formato de `areas`:** separado por comas y **sin corchetes ni comillas** — `login()` hace
`String(r.areas).split(',')` y ese array viaja al campo `a` del token. Un `['tierras','odt','odl']`
escrito a mano se parsearía como tres áreas basura con corchetes pegados.

**`Asist2026` es un placeholder.** Confirmar la clave definitiva con la persona antes de dar la
decisión por cerrada, y volver a correr `endurecerClaves()` si se cambia.

**No subir `AUTH_V`.** Agregar un usuario no invalida nada; subirlo saca de la sesión a TODO el mundo
y solo sirve para revocar accesos.

**UF3 queda fuera a propósito** (la lleva `residente_uf3`, D101). Si algún día entra, es agregar `uf3`
a esta columna **y** a `areasDeUsuario('angie')` en `CodigoAsistencias.gs` — las dos, porque hoy el
módulo deriva las áreas del mapa por usuario y no del token.


---

# Seed de OBRA — hoja `MAQUINAS` (D138)

**Ojo: esta va en el Google Sheet de OBRA** (el de BANDEJA/DATA/MAQUINARIA), no en el de
Asistencias. Es el catálogo de la flota, que hasta D138 vivía escrito en `Codigo.gs` y en cuatro
pantallas.

**MAQUINAS.tsv** → hoja `MAQUINAS`, pegando desde A1 (incluye la fila de encabezados).
`id_maquina · tipo · horas_prog · propiedad · fecha_ingreso · fecha_retiro · notas · frente`

**D173 (sep-2026): la hoja es la flota COMPLETA de UF1-UF2, no solo la pesada.** 53 estancias
(foto del Excel de partes, hoja «Control de partes», al 15-sep-2026): pesada + volquetas +
tractocamiones/camabajas + carrotanques + turbo + camiones + luminaria; 25 vigentes hoy. Columna
nueva **`frente`** (`UF1-UF2` / `UF3`, vacío = UF1-UF2): el Parte Digital espera cada día a los
vigentes de UF1-UF2 («Equipos sin parte»), el panel de producción sigue viendo solo los tipos que
producen. Los `id_maquina` son ahora los **códigos del parte** (MO003, CR008, NG002…), no los
`dim_maquinaria` viejos (MO03, CR08, FNG02): si ya tienes la hoja con los códigos viejos,
**reemplázala entera** por esta semilla (o corrige esos cuatro ids a mano). Dos filas marcadas
`CONFIRMAR` (VOL039, TI12) son dudas del Excel, no datos: revísalas. UF3 no viene en la semilla
(descartada por ahora); cuando entre, sus estancias van aquí con `frente=UF3`.

## Cómo se lee

- **Una fila por ESTANCIA, no por máquina.** Si el finisher entra y sale cinco veces, son cinco
  filas. Es lo mismo que D85 con el personal: para un reingreso que respete los días en que no
  estuvo va un alta NUEVA, no editar la anterior.
- **`fecha_retiro` es el PRIMER DÍA QUE YA NO ESTUVO** (ventana `[ingreso, retiro)`, igual que
  `activaEnFecha` de D85). Vacía = sigue en obra.
- **`horas_prog` puede ir vacía:** se deduce de `propiedad` (alquilada 5 h / propia 6.4 h, D10).
- **`tipo`** decide si la máquina genera producción (los vibros, minicargador, minibuldózer y
  retroexcavadora nunca la generan — D41/D44/D111). Tipos de producción: BULLDOZER · EXCAVADORA ·
  MOTONIVELADORA · FINISHER · VIBROCOMPACTADOR · MINICARGADOR · MINIBULDOZER · RETROEXCAVADORA.
  Tipos de flota (D173, sin producción): VOLQUETA · CAMABAJA · TRACTOCAMION · CARROTANQUE · CAMION ·
  TURBO · CISTERNA · LUMINARIA. Un tipo desconocido no rompe nada: el endpoint lo avisa y lo trata
  como equipo sin producción (solo flota y parte).

## Alta y baja, ya sin tocar código

- **Llega una máquina:** una fila nueva con su `fecha_ingreso`. Aparece sola en el desplegable del
  capataz, en el de la chequeadora si es excavadora, y en las faltantes.
- **Se va:** se le pone `fecha_retiro` = el primer día que ya no estuvo. Desaparece hacia adelante y
  **sigue saliendo bien hacia atrás** (consultar un día anterior muestra la flota que había ese día).
- **Vuelve:** fila NUEVA con la fecha de reingreso. No se edita la vieja: se perdería el hueco.

## Lo que trae la semilla

25 estancias que reconstruyen el histórico de 2026, para que consultar un día pasado muestre la
flota que de verdad había: las 11 vigentes hoy, las 10 devueltas en ago-2026 (D136), CAT320 y MC705
retiradas en jun-2026 (D61), y FNG02 + CR08 marcadas como fuera de obra.

**Lo único que hay que confirmar antes de pegar:** el finisher **FNG02** y su vibro de pareja
**CR08** quedan con `fecha_retiro = 2026-08-20`, es decir "hoy no están". Si SÍ están en obra ahora
mismo, se borra esa celda en las dos filas y listo. La fecha `2026-01-01` de los ingresos es un
"desde siempre" conservador: no se conocen las fechas reales de ingreso y no hace falta afinarlas
salvo que se quiera consultar días anteriores a esa fecha.

**El ID tiene que coincidir letra por letra con `dim_maquinaria`** del maestro
`Modelo_Produccion_Maquinaria` (por eso `RT-02` va con guion, D111). Si no, el pegado a
`Captura_Diaria` deja de cruzar en silencio.

Si la hoja no existe, está vacía o no tiene una sola fila utilizable, el backend cae al catálogo
`MAQ_CATALOGO` de `Codigo.gs` — nunca sirve una flota vacía, que dejaría al capataz sin poder
reportar ninguna máquina.
