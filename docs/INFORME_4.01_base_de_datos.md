# INFORME 4.01 — Base de datos real: diagnóstico y plan (sin implementar)

Fecha: 16-sep-2026. Alcance: solo diagnóstico y plan del ítem **4.01** del backlog. No se cambia código, ni
Sheets, ni el Worker. Fuente: lectura completa de `backend/Codigo.gs` (3.324 líneas), `backend/CodigoAsistencias.gs`
(3.118), `backend/CodigoParte.gs` (832), `worker/src/index.js`, `auth.js`, `entorno.js`, `offline.js`, los 36
arneses de `backend/pruebas/` y los documentos 01–06 + OPERACIONES.

---

## 0-bis. Decisión del dueño (16-sep-2026) — el disparador ya se cumplió

Tras leer el diagnóstico, el dueño descarta la Fase 0 de medición: **el disparador real no es el volumen sino la
disponibilidad**. En campo el Apps Script «se cae» a diario: respuestas lentas, errores constantes y fricción, con
picos cuando mucha gente pega a la vez a la misma URL. La arquitectura (Pages + Worker + pantallas + cola offline) está
bien; lo que no aguanta es el backend de Apps Script + Sheets. **Se migra.** Antes, el dueño va a aplicar unos cambios
al Parte Digital (`CodigoParte.gs` y sus pantallas); la migración arranca cuando esos cambios estén cerrados, y el Parte
se porta en su versión final (no en la de hoy).

Por qué el síntoma encaja con Apps Script y no con el código (y por qué medir no cambiaría la decisión):

| Causa | Qué hace hoy | Efecto que se ve en campo |
|---|---|---|
| **Tope de ejecuciones simultáneas** de Apps Script (~30 por script, todas corren «como el dueño») | 300 personas reportando asistencia a la misma hora + capataces + chequeadoras contra 2 scripts | La petición 31 espera o falla; el Worker devuelve `502 upstream` cuando Google contesta con HTML de error |
| **Coste fijo por petición** (~0,5 s por `getValues`, arranque en frío del script) | 3–11 lecturas por endpoint incluso con caché | 2–7 s por consulta aunque las hojas estén casi vacías (medido en D99: 5,2 s de servidor) |
| **`LockService` global de 30 s** en TODO POST de asistencias | Serializa todas las escrituras del Sheet | En hora pico las escrituras hacen cola y las últimas expiran: «no se pudo guardar», reintento por la cola offline |
| **Sin lock** en obra y parte | Append con `getLastRow()+1` concurrente | Filas pisadas o duplicadas en picos (los `diagnosticoDuplicados*` existen por esto) |
| Cuotas diarias compartidas (tiempo total, `UrlFetch`, triggers) | Calentador cada 30 min + respaldo + LOG por petición | Un día malo agota cuota y el script deja de responder a todos |

Ninguna de esas cinco causas se arregla con archivado (4.8) ni con más lectura acotada: son límites de la plataforma.
Un Worker de Cloudflare escala por petición sin tope práctico de concurrencia y una consulta indexada en Postgres tarda
milisegundos; el LOG y el rate limit se conservan; la cola offline sigue igual. **Lo único opcional que sí ayudaría al
diseño, sin retrasar nada:** mirar en el panel de Observability del Worker (ya está activado en `wrangler.toml`) qué
código devuelve en los picos (502 upstream, 429 rate limit o 401), porque eso decide si el rate limit por IP de 120/min
también hay que subirlo cuando muchos teléfonos salen por la misma IP del campamento.

**Consecuencias sobre el plan de §3:** la Fase 0 se elimina; la Fase 1 (congelar contrato) empieza en cuanto se cierren
los cambios del Parte; el orden Parte → Asistencias → Obra se mantiene, pero Asistencias sube de prioridad porque es
donde está el pico de concurrencia (300 personas a la misma hora). La arquitectura objetivo concreta está en §7.

## 0. Resumen en diez líneas (diagnóstico previo a la decisión)

1. **Hoy no hay evidencia de que se cumpla ningún disparador de 4.01.** Los tres (Sheet lento >~50k filas, Galca
   en otra obra, histórico multianual consultable) se pueden medir con lo que ya existe (`_ms`, `_celdas`, hoja
   `LOG`, `diagnosticoCapacidad()`, `diagnosticoPeso()`), y hay que medir antes de decidir. §1 dice exactamente qué.
2. La hoja que más crece es **ASISTENCIA** (5.200–7.800 filas/mes con 300 personas): cruza las 50k filas en
   **7–10 meses de operación**, o sea entre feb y may-2027 si el módulo arrancó en jul-2026. **PARTE_BANDEJA** (~60/día)
   tarda ~2,3 años. BANDEJA/DATA/MAQUINARIA/VOLQUETAS van mucho más despacio.
3. El techo de **10 M de celdas por archivo** no aprieta antes de 4–5 años en ninguno de los dos Sheets, salvo por la
   rejilla vacía que inserta `ensureRows_` (cuenta aunque no tenga datos): eso se vigila con `diagnosticoPeso()`.
4. Lo que se pondrá lento **antes** que el volumen general son **cinco lecturas que recorren todo el histórico** y que
   D102/D107 no pudieron acotar por fecha: `acumulado_drenajes` y `consolidadoRango` (DATA entera),
   `maquinariaProduccionGuardar` (MAQUINARIA entera), `parteUltimoFinal_` (PARTE_BANDEJA entera, una vez **por equipo
   faltante** en la revisión diaria) y los cruces históricos de `roster`/`export` en asistencias.
5. D99–D107 compraron mucho tiempo: los `_ms` de 5,2 s bajaron con caché y lectura en dos pasos. **La migración no es
   la única salida**: 4.8 (archivado por año) resuelve el volumen a coste cero y merece ir primero si el único
   disparador que se cumple es el de filas.
6. El **Worker `api.galca.app` es el punto de conmutación perfecto** (D169): cambiar destino es `wrangler secret put`,
   la cola offline se redirige sola por `tipo` (offline.js), y las rutas `/prueba/*` permiten un canario sin tocar el
   frontend.
7. El código de negocio (7.274 líneas de JS plano) es **portable tal cual** a un Worker: los 36 arneses ya lo ejecutan
   en Node con un `SpreadsheetApp` de mentira (`hojaFalsa`). Esa frontera es exactamente la capa a sustituir.
8. **Opción recomendada si se dispara:** lógica en el Worker de Cloudflare (mismo lenguaje, misma cuenta, mismo dominio)
   + **Postgres gestionado (Supabase)** como almacén, con el Sheet ESPEJO alimentado por un Apps Script de *pull* cada
   5–15 min. Coste de referencia: **0–30 USD/mes**. Esfuerzo: **8–12 semanas** de sesiones intermitentes, por módulos.
9. Orden de migración: **Parte Digital → Asistencias → Obra**. El Parte es público, aislado y su copy-paste al Excel ya
   sale de la pantalla (no del Sheet), así que ni siquiera necesita espejo. Obra va último porque es donde vive el
   copy-paste A:S al maestro y los catálogos a mano (BASE, CUBICAJE, MAQUINAS, USUARIOS).
10. Riesgo mayor: **un solo mantenedor y 7.274 líneas que reescribir con paridad byte a byte** (strings verbatim de
    DESCRIPCION/ELEMENTO/`id_maquina` que cruzan por VLOOKUP en los Excel). La mitigación es el arnés como contrato.

---

## 1. Qué medir HOY en los Sheets (antes de decidir nada)

Todo lo de esta sección se hace **sin redeploy** y sin tocar datos. Dos semanas de medición bastan.

### 1.1 Volumen y ritmo de crecimiento (disparador «Sheet lento >~50k filas»)

Ejecutar desde el editor de Apps Script, una vez ahora y otra a los 14 días, y anotar en el backlog:

| Qué | Cómo | Umbral que dispararía |
|---|---|---|
| Filas usadas / filas de rejilla por hoja, en los DOS Sheets | `diagnosticoCapacidad()` (existe en `Codigo.gs` L3269 y `CodigoAsistencias.gs` L2602) | Cualquier hoja transaccional > **50.000 filas** (el umbral literal de 4.01) |
| Celdas de rejilla (`getMaxRows × getMaxColumns`, sumadas) vs 10 M | `diagnosticoPeso()` (asistencias L2907) — ya avisa al 60 % y si hay >500.000 celdas vacías | > **6 M** celdas (60 %) en un archivo |
| Filas/día de cada hoja transaccional | Diferencia entre las dos corridas ÷ 14. Hojas: ASISTENCIA, PARTE_BANDEJA, BANDEJA, MAQUINARIA, VOLQUETAS, DATA, OBSERVACIONES | Proyección: fecha en que cada una llega a 50k filas y el archivo a 6 M celdas |
| Rejilla vacía (`getMaxRows − getLastRow`) | Mismo `diagnosticoCapacidad()` | > 5.000 filas libres en una hoja (bloques de 1.000 de `ensureRows_` que cuentan contra los 10 M) |

Proyección con las cifras que ya están en el código (para contrastar con la medición real):

| Hoja | Ritmo documentado | Filas/año | Celdas/año | 50k filas se alcanzan en |
|---|---|---|---|---|
| ASISTENCIA (17 col) | 5.200–7.800/mes (D102) | 62k–94k | 1,1–1,6 M | **7–10 meses** |
| PARTE_BANDEJA (27 col) | ~60/día (CodigoParte L393) | ~22k | ~0,6 M | ~2,3 años |
| VOLQUETAS (13 col) | 1 fila por placa y línea | estimar en campo | — | probablemente 3–5 años |
| MAQUINARIA (40 col) | 1 fila por equipo×línea×día | estimar en campo | la más pesada por fila | >5 años |
| BANDEJA (28) / DATA (29) | ~12 filas/día en el banco de D100 | ~4k | ~0,1 M | >10 años |
| LOG (7 col) | 1 fila por petición | acotada: poda a 30 días | — | no aplica |

Conclusión provisional: **solo ASISTENCIA cruza el umbral de filas en el horizonte de un año**, y para ese caso ya
existe 4.8/4.11 (archivar años cerrados en otro Sheet), que es una alternativa a coste cero.

### 1.2 Latencia real por endpoint (disparador «Sheet lento», la parte que importa)

La hoja `LOG` de cada Sheet guarda **`action` y `ms` de servidor por petición** desde D166 (30 días de retención). Con una
tabla dinámica sobre LOG (o descargándola a Excel) sacar por `action`: n, p50, p95, máximo, y fecha. Hacerlo ahora y
repetirlo cada mes.

| Endpoint | Por qué vigilarlo | Señal de alarma |
|---|---|---|
| `asistencia`, `export`, `roster` (asistencias) | Los dos últimos recorren columnas ENTERAS de ASISTENCIA (cruces `proyectoDefecto` y CC recientes) que no se pueden acotar por fecha | p95 de servidor > **5 s** (umbral que ya fijó 4.11) o `_celdas` > 500.000 en `export` |
| `acumulado_drenajes`, `consolidado` con rango (obra) | `getDataRange()` sobre **DATA entera** en cada llamada (Codigo L832, L1453) | p95 > 5 s o crecimiento mes a mes |
| `maquinaria_produccion` POST (obra) | Lee **MAQUINARIA entera** para parchear la col T (L2339) | p95 > 5 s |
| `mod=parte&op=bandeja` (parte) | `parteUltimoFinal_` recorre PARTE_BANDEJA una vez **por cada equipo faltante** | p95 > 5 s, o crece con los faltantes |
| `mod=parte&op=equipo` (parte, público) | 4 catálogos + 9 columnas completas de PARTE_BANDEJA por cada escaneo de QR | p95 > 3 s (la cabina tiene 2,4–6,5 KB/s medidos en D133) |
| `reporte_asistencia` / reporte de obra (POST) | Escrituras con `LockService` de 30 s (asistencias) o **sin lock** (obra y parte) | Filas `error`/`rate_limit` en LOG; duplicados en `diagnosticoDuplicadosTodo()` |

Complemento en cliente: `DEBUG_PERF` en `resumen-asistencia.html` (`servidor_ms` / `red_ms`) ya separa red de servidor; una
captura por semana en un teléfono de obra da la cifra que siente el usuario.

### 1.3 Cuotas de Apps Script (el techo que revienta antes que Sheets)

En el panel del proyecto (Ejecuciones / Cuotas) anotar por día: número de ejecuciones, tiempo total de ejecución,
ejecuciones fallidas por tiempo (>6 min). Los dos scripts hoy no lo miran. Señal: cualquier fallo por «Exceeded maximum
execution time», o tiempo total diario de triggers cerca de los 90 min (el calentador de 30 min ya consume 48
ejecuciones/día).

### 1.4 Disparador «Galca en otra obra»

No se mide en el Sheet: es una decisión comercial. Registrar si hay una obra concreta con fecha. Nota: **4.03 (subdominio
por obra, Sheet + Apps Script copiados, mismo código) cubre una segunda obra sin base de datos**; el procedimiento ya
está probado en D168 (entorno de prueba = copia completa). La BD solo se vuelve necesaria si se quiere **un tablero
consolidado entre obras** o más de ~3 obras a mantener.

### 1.5 Disparador «histórico multianual consultable»

Hoy DATA conserva el histórico completo y el Excel maestro `TM2_SUR_REPORTE_DIARIO_OBRA.xlsx` es la consulta
multianual (desde sep-2025). Medir si alguien pide consultas que el Excel no da (por persona a lo largo de años, cruce
obra×asistencia×parte, etc.). `?action=persona` y `?action=ausencias` ya tienen tope de 186 días **por coste de lectura**:
si ese tope estorba en la práctica, es el disparador.

**Veredicto de esta sección:** con lo documentado, ningún disparador se cumple hoy. El primero en llegar será el de
filas en ASISTENCIA (feb–may 2027), y para ese hay respuesta sin migrar (4.8). La migración se justifica solo si
(a) los p95 de §1.2 pasan de 5 s y no se arreglan con archivado, o (b) llega la segunda obra con tablero consolidado.

---

## 2. Opciones, con coste y esfuerzo

Premisa común: el **contrato de API se conserva** (`GET ?action=…`, `GET ?mod=parte&op=…`, POST JSON en `text/plain`,
respuesta `{ok:…}` plana, token en `?token=`/campo `token`, `{ok:false, auth:false}` para sesión caducada), porque la
cola offline (D82) reenvía payloads viejos y las 21 pantallas no deberían cambiar. Precios: referencia de sep-2026;
**verificar en la web de cada proveedor al decidir**.

| | A. Quedarse en Sheets + 4.8 | B. Worker + Postgres (Supabase) | C. Worker + Cloudflare D1 | D. Apps Script + Supabase REST (estrangulador) |
|---|---|---|---|---|
| Qué es | Archivar años cerrados a un Sheet de archivo; nada más | Lógica de los 3 `.gs` portada al Worker `galca-api`; datos en Postgres gestionado; Sheet ESPEJO por pull | Igual que B pero el almacén es D1 (SQLite serverless de Cloudflare) | Los `.gs` siguen siendo la API; solo las hojas calientes se sustituyen por llamadas REST a Supabase vía `UrlFetchApp` |
| Coste mensual | **0** | Supabase Free 0 (500 MB, **se pausa tras 7 días sin uso**: Navidad lo pausaría) o Pro **~25 USD**; Workers Paid **~5 USD** (necesario por CPU) → **5–30 USD** | Workers Paid ~5 USD; D1 dentro del plan → **~5 USD** | Supabase 0–25 USD; Apps Script 0 → **0–25 USD** |
| Esfuerzo | **1–2 semanas** (mover filas + respetar `acumulado_drenajes` y `proyectoDefecto`) | **8–12 semanas** por módulos (ver §3) | 8–12 semanas | 3–5 semanas, pero es deuda: dos almacenes, latencia por `UrlFetch` (200–500 ms cada uno) y cuota de 20k fetch/día |
| Qué resuelve | Volumen por filas. **No** resuelve concurrencia (obra sin lock), ni consultas multianuales, ni multi-obra | Todo: índices, transacciones, consultas por rango sin tope, multi-obra por `obra_id`, backups reales | Casi todo; SQL más limitado (SQLite), sin PostgREST, sin RLS; consultas analíticas más pobres | Solo el volumen de 2–3 hojas; sigue el límite de 6 min y la ausencia de transacciones |
| Riesgo técnico | Bajo | Medio: reescritura grande, dos secretos, tipos (fechas/horas) | Medio; **encierro** en Cloudflare | Alto a medio plazo (mezcla) |
| Encaja con lo que hay | Sí (mismo Sheet, mismos scripts) | Sí: el Worker ya existe (D169), mismo JS, arnés reusable, `/prueba/*` para canario | Sí, todo en una cuenta | Parcial |

**Recomendación:** hoy **A** (no hacer nada más que medir; si llega el umbral de filas, 4.8). Si se cumple un disparador de
verdad, **B**, con **C** como alternativa si se prefiere una sola cuenta y no importa perder Postgres. **D** solo como
puente de emergencia si un endpoint concreto revienta los 6 minutos antes de tener B.

Por qué Postgres/Supabase y no otro: (1) es lo que nombra el ítem y lo que el dueño ya tiene en la cabeza; (2) PostgREST
da lectura filtrada por fecha «gratis» para el espejo; (3) región `sa-east-1` (São Paulo) o `us-east-1` para
latencia desde Colombia; (4) backups diarios incluidos, que reemplazan al `respaldoDiario` a Drive. Alternativas
equivalentes: Neon (Postgres, ~0–19 USD) con la API en el Worker vía Hyperdrive.

---

## 3. Plan de migración por fases (conservando el Sheet ESPEJO y el copy-paste)

Regla del plan: **cada fase termina con producción funcionando y con vuelta atrás de un solo comando**
(`wrangler secret put` con la URL anterior). Nada se borra del Sheet hasta la última fase.

### Fase 0 — Medir y decidir (2 semanas, coste 0)

Lo de §1. Sale un número por endpoint y una fecha proyectada por hoja. Si nada dispara: cerrar aquí, dejar 4.01 en
⏸️ con las cifras, y programar la siguiente medición a 3 meses.

### Fase 1 — Congelar el contrato (1–2 semanas, sin redeploy)

- Extraer de los 36 arneses un **juego de pruebas de contrato**: lista de peticiones GET/POST con su respuesta esperada,
  ejecutable contra **cualquier URL** (hoy contra `/prueba/obra` etc.). Ya existen las peticiones; lo que falta es que
  puedan apuntar a una URL en vez de al `vm`.
- Documentar el **modelo de datos** (este informe, §5) como esquema SQL borrador: una tabla por hoja transaccional,
  claves de negocio que hoy son implícitas (`id_registro`, `id_cantidad`, `app_id_registro`, `(fecha, persona)` en
  asistencia), `obra_id` desde el día uno aunque sea constante.
- Script de **volcado Sheet → CSV** por hoja (Apps Script `getValues` → Drive), para el backfill de cada fase.

### Fase 2 — Piloto: Parte Digital (2–3 semanas)

Por qué primero: hojas propias (`PARTE_*`), ruta propia en el Worker (`/parte`), endpoint público sin token, un solo
punto de INSERT (`parteReporte`) y uno de UPDATE (`parteRevisar`), y su copy-paste al Excel `Partes_Diarios_de_Maquinaria`
**ya sale de la pantalla** (`revision-maquinaria.html`, vista Base B→AR), no del Sheet.

1. Tablas `parte_bandeja`, `parte_equipos`, `parte_operadores`, `parte_cc`, `parte_items`, `parte_actividades` en la BD.
   Los 5 catálogos se siguen manteniendo **en el Sheet** y se importan con un trigger de pull (§3.6).
2. Portar `CodigoParte.gs` al Worker como módulo (`worker/src/parte.js`): misma superficie `op=equipo|reporte|bandeja|revisar|base`.
   Reusar `parteExpandirReparto_`, alertas y validaciones tal cual; sustituir `parteCols_`/`parteUltimoFinal_` por
   `SELECT … WHERE codigo=$1 AND estado<>'descartado' ORDER BY fecha DESC, hora_a DESC LIMIT 1`.
3. Backfill de PARTE_BANDEJA histórica desde CSV. `id_registro` es la PK natural (UUID de cliente, D82).
4. Canario: `PARTE_PRUEBA_URL` → nueva API; probar con `?env=prueba` desde un teléfono de cabina.
5. Corte: `wrangler secret put PARTE_URL`. La cola offline redirige sola (`offline.js` L147). El Apps Script queda como
   lectura de respaldo.
6. Espejo: PARTE_BANDEJA del Sheet se alimenta por pull cada 15 min (solo para quien la mire a mano). Vuelta atrás:
   volver el secreto; las filas creadas en la BD entre tanto se pegan a mano al Sheet (son ~60/día).

Criterio de salida: 2 semanas con LOG de la nueva API sin `error`, y el arnés de contrato en verde contra ella.

### Fase 3 — Asistencias (3–4 semanas)

Es el módulo que dispara por volumen. Sheet y script propios (D69), ruta `/asistencias`.

1. Tabla `asistencia` con índice `(fecha, cuadrilla)` y `(fecha, codigo|cedula)`; `notas_asistencia`, `extras_admin`
   (hoy se reescriben enteras: pasan a UPSERT/DELETE); `personal` con su CRUD (`gestionPersonal` ya existe).
2. Catálogos a mano (CUADRILLAS, CONFIG, FESTIVOS, TURNOS, CAT_CC, CC_USADOS, CAT_MOTIVOS, MOTIVOS_USADOS,
   CAT_TRABAJADORES) **siguen en el Sheet** y se importan por pull; desaparecen el calentador de 30 min, `CACHE_ON` y
   `cache_reset` (o `cache_reset` pasa a «importar catálogos ahora»).
3. Los cruces que hoy leen todo el histórico (`proyectoDefecto` del export, CC recientes de `roster`) se vuelven
   `SELECT DISTINCT … WHERE fecha >= hoy-90` con índice: es la ganancia principal.
4. `LockService` de 30 s → transacción por `(fecha, cuadrilla)`. Mantener la regla D126 (manda el código; cédula
   solo si falta; respaldo nombre+cuadrilla) en código, no en constraint, para no rechazar lo que hoy entra.
5. El export a Navision y `horas-nomina.js` **no cambian**: el backend sigue mandando el crudo por JSON.
6. Verificación del token: el secreto HMAC se copia a mano de obra a asistencias hoy; en el Worker es **una** variable.
7. Espejo: hoja ASISTENCIA del Sheet por pull (últimos 60 días en vivo; el resto en un Sheet de archivo, que es 4.8
   hecho de paso). Corte y vuelta atrás igual que en Fase 2.

### Fase 4 — Obra (4–5 semanas)

Última porque concentra el copy-paste al maestro y los catálogos a mano.

1. Tablas `bandeja`, `data`, `maquinaria`, `volquetas`, `observaciones`, `maquinas` (estancias), `usuarios`, `tablero`, `log`.
   DATA conserva **las columnas A–T en el orden del maestro** como columnas físicas con el mismo nombre; las internas
   (U–AC) aparte. Las hojas a mano (BASE, CUBICAJE, USUARIOS, MAQUINAS hasta que se use solo la pantalla de Flota)
   siguen en el Sheet y se importan por pull.
2. Portar `guardarReporte`, `enviarData`, `maquinariaProduccion*`, `flota*`, `login`, `tablero*`. `enviarData` pasa de
   «borrar filas del día+área y anexar» a `DELETE … WHERE fecha=$1 AND area=$2` + INSERT en una transacción, y
   **deja de regenerar `id_registro`** (hoy pierde la identidad de la línea en cada reenvío, Codigo L2500).
3. `acumulado_drenajes` y `consolidadoRango` pasan a consultas con índice por fecha: se quita el tope implícito.
4. **Espejo con el copy-paste protegido:** la hoja DATA del Sheet ESPEJO se reescribe por pull con el **mismo layout
   A–AC y los mismos strings** (DESCRIPCION verbatim, ELEMENTO `tm2 pk X - Y`, `[Clima: …]` en OBSERVACION). El usuario
   sigue pegando A:S desde el Sheet **o** desde `jefe.html` (D65), indistintamente. Prueba de paridad: exportar DATA
   del Sheet viejo y del espejo para 30 días y comparar celda a celda antes del corte.
5. Emisor del token pasa al Worker (`login`); `AUTH_V` como variable para «sacar a todos». Las contraseñas (hash
   SHA-256 de `usuario:clave`) se migran tal cual.
6. Corte por secreto `OBRA_URL`; vuelta atrás idéntica.

### Fase 5 — Retiro y operación (1–2 semanas)

- Apps Script de obra y asistencias quedan **solo de lectura** 3 meses, luego se archivan (copia en el repo ya existe).
- Respaldo: backups del proveedor + un volcado CSV diario a Drive desde el Worker (cron trigger) para conservar la
  costumbre de «abrir el respaldo en Sheets».
- `LOG` pasa a tabla con retención 30 días por cron; `diagnosticoPeso()` se sustituye por tamaño de la BD.
- Actualizar OPERACIONES.md: el «entorno de prueba» pasa a ser una BD de prueba + `*_PRUEBA_URL`.

### 3.6 Cómo se alimenta el Sheet ESPEJO (decisión de diseño)

Tres formas posibles; se recomienda la primera.

| Forma | Cómo | A favor | En contra |
|---|---|---|---|
| **Pull desde Apps Script** (recomendada) | Un `.gs` pequeño en el Sheet ESPEJO con trigger cada 5–15 min: `UrlFetchApp` a la API (`/obra?action=espejo&desde=hoy-7`) y reescritura de las filas de esos días | Todo queda en la cuenta de Google del dueño; sin service account; idioma ya conocido; los catálogos a mano viajan **en sentido contrario** por el mismo trigger (Sheet → BD) | Retardo de minutos; el trigger consume cuota (≤ 96 ejecuciones/día a 15 min) |
| Push desde el Worker | El Worker escribe en el Sheet con la API de Sheets y una service account | Espejo casi inmediato | Credencial de Google en Cloudflare; más código; se rompe si cambia el layout |
| Sin espejo (pantallas) | El copy-paste sale de `jefe.html`, `revision-maquinaria.html` (Base) y `digitadora.html` | Ya existe para DATA, Parte y volquetas | Pierde la costumbre de «abrir el Sheet»; no cubre BASE/CUBICAJE a mano |

---

## 4. Riesgos

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| R1 | **Reescritura de 7.274 líneas** con un solo mantenedor; regresiones silenciosas en strings verbatim (DESCRIPCION, ELEMENTO, `id_maquina`) que cruzan por VLOOKUP en los Excel | Alto | Arnés de contrato (Fase 1) en verde antes de cada corte; comparación celda a celda DATA vieja vs espejo por 30 días |
| R2 | **Dos almacenes durante meses** (Sheet vivo + BD) y lecturas mezcladas | Alto | Corte por módulo y por secreto; nunca doble escritura: cada ruta escribe en UN sitio; el espejo es solo lectura |
| R3 | Tipos de Sheets: fechas como `Date` con zona horaria, horas como fracción de día, ceros a la izquierda (`parteFormatoTexto_`) | Medio | Columnas `date`/`time`/`text` explícitas; `fdate`/`ftime` se conservan en el borde de la API; pruebas con `07:00` y `2026-07-13` (los dos bugs históricos) |
| R4 | **Supabase Free se pausa tras 7 días sin actividad** (Navidad, Semana Santa) | Alto si Free | Plan Pro, o un ping diario desde el cron del Worker, o Neon/D1 |
| R5 | Latencia Colombia → región de la BD; Workers Free limita CPU a 10 ms por petición | Medio | Región `sa-east-1`/`us-east-1`; Workers Paid (~5 USD) desde el piloto |
| R6 | Cola offline (D82) reenvía **payloads viejos** que la nueva API debe seguir aceptando | Medio | Mantener `validarPayload*_` tal cual y los tests de D166 sobre payloads mínimos |
| R7 | Catálogos mantenidos a mano en el Sheet (BASE, CUBICAJE, MAQUINAS, USUARIOS, CAT_*) con columnas «por nombre» y orden libre | Medio | Se quedan en el Sheet y se importan por pull; el importador localiza columnas por nombre como hoy; construir CRUD solo cuando lo pidan |
| R8 | Secretos: hoy `AUTH_SECRETO` vive en dos proyectos; migrar el emisor sin invalidar sesiones en campo | Medio | Copiar el mismo secreto al Worker; `AUTH_V` sin cambiar; los tokens no caducan por reloj (D109) |
| R9 | Pérdida de la cultura «abro el Sheet y miro» para depurar | Medio | Espejo por pull + tabla `log` visible en el Sheet ESPEJO; panel SQL del proveedor |
| R10 | Encierro en proveedor (Supabase/Cloudflare) y precios que cambian | Bajo | Postgres estándar (pg_dump diario a Drive); el Worker es JS plano exportable a cualquier runtime |
| R11 | Endpoint público del Parte (`/parte`, sin token) contra una BD: abuso o inserciones masivas | Medio | Conservar los límites de D166 (20/h por equipo, 200/h global) y el rate limit por IP del Worker; el público solo `INSERT … estado='pendiente'` |
| R12 | Hacer la migración **sin que se cumpla un disparador**: 2–3 meses de trabajo que no mejoran nada visible para la obra | Alto | Fase 0 obligatoria; 4.8 como respuesta barata al primer disparador |
| R13 | Retardo del espejo (5–15 min) cuando el encargado pega A:S justo después de enviar a DATA | Bajo | Botón «actualizar espejo ahora» (el mismo pull a demanda) o pegar desde `jefe.html`, que lee la BD en vivo |

---

## 7. Arquitectura objetivo (propuesta cerrada para discutir, sep-2026)

```
GitHub Pages tm2.galca.app  ──fetch──▶  Cloudflare Worker api.galca.app (galca-api)
 (21 pantallas, auth.js,                 ├── /obra        → src/api/obra.js        (Codigo.gs portado)
  entorno.js, offline.js:                ├── /asistencias → src/api/asistencias.js (CodigoAsistencias.gs portado)
  SIN CAMBIOS)                           ├── /parte       → src/api/parte.js       (CodigoParte.gs portado)
                                         ├── /prueba/*    → mismas rutas contra la BD de prueba
                                         ├── src/db.js    → Postgres (Hyperdrive + postgres.js) · una transacción por escritura
                                         ├── src/auth.js  → mismo token HMAC (D109), UN secreto, AUTH_V como variable
                                         └── cron         → LOG a 30 días · volcado CSV diario a Drive/R2 · ping keep-alive
                                                   │
                                                   ▼
                                   Postgres gestionado (Supabase, región sa-east-1 o us-east-1)
                                   esquema: obra_id en toda tabla · una tabla por hoja transaccional ·
                                   catálogos importados desde el Sheet · índices por (fecha), (fecha,area), (fecha,cuadrilla)
                                                   │ pull cada 5–15 min (UrlFetchApp, un .gs pequeño en el ESPEJO)
                                                   ▼
                                   Google Sheet ESPEJO (obra) + ESPEJO (asistencias)
                                   · DATA en layout A–AC y strings verbatim → copy-paste A:S al maestro como hoy
                                   · BASE / CUBICAJE / MAQUINAS / USUARIOS / CAT_* siguen editándose aquí y viajan a la BD
                                   · LOG visible · respaldo diario a Drive como hasta ahora
```

Decisiones que este esquema fija (para discutir antes de la Fase 1):

1. **La lógica vive en el Worker, no en funciones de la BD.** Mismo JavaScript que los `.gs`, mismos nombres de
   función (`guardarReporte`, `enviarData`, `parteReporte`…) para que las decisiones D-xxx sigan siendo rastreables. La
   capa `hojaFalsa` del arnés pasa a ser `src/db.js`; los 36 arneses se reusan como pruebas de contrato.
2. **Postgres por SQL directo** (Hyperdrive + `postgres.js`), no por PostgREST: las escrituras de hoy son
   «borra el día y anexa» y necesitan transacción; en SQL es un `BEGIN … COMMIT`, en PostgREST sería una función RPC
   por cada una. PostgREST queda solo para el pull del ESPEJO (lectura filtrada por fecha, sin código).
3. **Proveedor: Supabase Pro** (~25 USD/mes, sin pausa por inactividad, backups diarios, panel SQL para «abrir y mirar»)
   + **Workers Paid** (~5 USD/mes, necesario por CPU y por Hyperdrive). Alternativa a coste 5 USD: Cloudflare D1, si se
   acepta SQLite y el encierro en Cloudflare. Precios a verificar al contratar.
4. **Contrato de API intacto**: mismas `action`/`op`, mismo POST en `text/plain`, mismo `{ok, auth}`, mismo `_ms`. Las
   21 pantallas, `auth.js`, `entorno.js`, `offline.js` y el service worker **no cambian**. Cada corte es un
   `wrangler secret put` (o, mejor, una variable `BACKEND_<ruta>=sheets|db` en el Worker para conmutar por ruta sin
   redeploy).
5. **Concurrencia**: sin lock global. Transacción por `(fecha, cuadrilla)` en asistencias, por `(fecha, area)` en
   `enviarData`, `INSERT … ON CONFLICT (id_registro) DO NOTHING` para la idempotencia de la cola offline (D82). El rate
   limit por usuario+action pasa a KV o a la tabla `log`; el de IP del Worker se revisa con Observability.
6. **`obra_id` desde el primer día** en toda tabla (constante `tm2sur` hoy). Es lo que hace posible 4.03 (segunda obra)
   sin copiar nada: un subdominio y un `obra_id`.
7. **Catálogos a mano se quedan en el Sheet** (BASE, CUBICAJE, MAQUINAS, USUARIOS, CAT_*, PARTE_EQUIPOS/OPERADORES/CC/
   ITEMS): el mismo trigger de pull los sube a la BD. Un CRUD en pantalla se hace solo cuando alguien lo pida.
8. **Copy-paste protegido por prueba**: antes del corte de obra, 30 días de DATA del Sheet viejo y del ESPEJO comparados
   celda a celda. El criterio de paridad es «el maestro no nota la diferencia».
9. **Orden de migración**: Parte (cuando estén los cambios del dueño) → Asistencias (el pico de concurrencia) → Obra.
   Cada módulo entra primero por `/prueba/*` con `?env=prueba` desde un teléfono real.
10. **Estructura del repo**: `worker/src/api/{obra,asistencias,parte}.js`, `worker/src/db.js`, `worker/src/auth.js`,
    `worker/sql/001_esquema.sql`, `worker/pruebas/` (los arneses movidos y apuntando a `db.js`), `backend/*.gs`
    congelados como referencia hasta el retiro. `docs/OPERACIONES.md` gana un §10 «desplegar el backend en el Worker».

Lo que sigue pendiente de decidir contigo: (a) Supabase vs D1; (b) si el ESPEJO de asistencias se necesita o basta
con el export a Navision desde la pantalla; (c) cuántos días de histórico entran en el backfill inicial (todo vs último
año, con el resto en el Sheet de archivo).

## 5. Anexo — Modelo de datos actual (resumen de los tres `.gs`)

### 5.1 Sheet de obra (`Codigo.gs` + `CodigoParte.gs`, mismo proyecto y misma URL `/exec`)

| Hoja | Tipo | Cols | Escritura | Clave de negocio | Lecturas de hoja ENTERA |
|---|---|---|---|---|---|
| BANDEJA | transaccional | 28 | append; update celda `estado` | `id_registro` (cliente, D82), `id_cantidad` ↔ MAQUINARIA | no (dos pasos D107) |
| DATA | transaccional oficial | 29 (A–T maestro + internas) | borra día+área por tramos y anexa; **regenera `id_registro`** | `(fecha, area)` | `acumulado_drenajes` L832, `consolidadoRango` L1453 |
| MAQUINARIA | transaccional | 40 | append; update col T y `produccion_capataz_orig` | `app_id_registro`, `id_cantidad` | `maquinariaProduccionGuardar` L2339 |
| VOLQUETAS | transaccional | 13 | append | `id_registro` | no |
| OBSERVACIONES | transaccional | 6 | appendRow | — | no |
| PARTE_BANDEJA | transaccional | 27 | append; update por `id_registro`; nunca delete | `id_registro` (UUID cliente, `-r<n>` en repartos) | `parteCols_` (9 col), `parteUltimoFinal_` |
| LOG | auditoría | 7 | appendRow; poda 30 días | — | — |
| MAQUINAS | catálogo vivo (estancias) | 8 | append/update desde Flota | `(id_maquina, fecha_ingreso)` | sí (pequeña) |
| BASE, CUBICAJE, USUARIOS, PARTE_EQUIPOS/OPERADORES/CC/ITEMS/ACTIVIDADES | catálogos a mano | variable | solo `setup*`/`endurecerClaves` | por nombre de columna | sí (pequeñas) |
| TABLERO | blob | 2 | clear + rewrite | — | — |

Servicios: `CacheService` solo para rate limit; **sin `LockService`** (carrera posible en append y en `enviarData`);
`PropertiesService` para `AUTH_SECRETO`/`AUTH_V`/`PARTE_SHEET_ID`; trigger diario `respaldoDiario` (02:00 Bogotá, copia a
Drive + poda LOG). Instrumentos: `_ms`, `_celdas`, `diagnosticoCapacidad()`.

### 5.2 Sheet de asistencias (`CodigoAsistencias.gs`, proyecto propio)

| Hoja | Tipo | Cols | Escritura | Clave | Lecturas ENTERAS |
|---|---|---|---|---|---|
| ASISTENCIA | transaccional (la que crece) | 17 | upsert quirúrgico D107 (pisa, borra tramos, anexa) | `(fecha, persona)` con `cuadrilla` como atributo (D126) | columnas 2–10 en `roster`, 5–14 en `export` |
| PERSONAL | maestro con CRUD | 9 | append / update celda | `codigo` o `cedula` | sí |
| EXTRAS_ADMIN, NOTAS_ASISTENCIA | transaccionales chicas | 7 / 5 | **clearContents + reescritura** | `(fecha)` / `(fecha, cuadrilla)` | sí |
| CUADRILLAS, CONFIG, FESTIVOS, TURNOS, CAT_CC, CC_USADOS, CAT_MOTIVOS, MOTIVOS_USADOS, CAT_TRABAJADORES | catálogos a mano | — | solo `setupHojas` | — | sí, pero en `CacheService` 6 h |
| LOG | auditoría | 7 | appendRow; poda 30 días | — | — |

Servicios: `CacheService` 6 h troceado a 90 KB para 10 catálogos + calentador cada 30 min; `LockService` global 30 s en todo
POST; `PropertiesService` solo verifica (`AUTH_EMISOR=false`); trigger diario de respaldo. Instrumentos: `_ms`, `_celdas`,
`diagnosticoCapacidad()`, `diagnosticoPeso()`, `diagnosticoVolumenAsistencia()`, `diagnosticoDuplicados*`.

### 5.3 Frontera y contrato

- Worker `galca-api`: proxy puro por path (`/obra`, `/asistencias`, `/parte`, `/prueba/*`), secretos `*_URL`, filtro de
  presencia de token, CORS a `tm2.galca.app`, 120/min por IP, 1 MB, sin caché. **No conoce el negocio.**
- `auth.js` es el único sitio con la base de la API; `entorno.js` elige `produccion`/`prueba`; `offline.js` resuelve la
  URL **al enviar** por `tipo` (`asistencia` | `parte` | obra).
- 36 arneses en `backend/pruebas/` ejecutan los `.gs` en `vm` con `hojaFalsa` (`getRange/getValues/setValues/getLastRow/
  appendRow/deleteRows/clearContents`): esa superficie es la capa de datos a sustituir.

---

## 6. Bloque de actualización propuesto para `03_BACKLOG.md` (ítem 4.01)

Reemplazar la fila actual de 4.01 por:

```
| 4.01 | **Base de datos real (Supabase/Postgres) — diagnóstico hecho, NO implementar (informe `docs/INFORME_4.01_base_de_datos.md`, sep-2026).** Texto original: reescribir la lógica de los tres .gs como backend, apuntar el Worker api.galca.app al nuevo destino, y trigger que alimente el Sheet ESPEJO para conservar el copy-paste a los Excel maestros. Disparadores: Sheet lento (>~50k filas), Galca en otra obra, o historial multianual consultable. **Diagnóstico (sep-2026):** ningún disparador se cumple hoy con lo documentado; el primero en llegar será el de filas en `ASISTENCIA` (5.200–7.800/mes → 50k entre **feb y may-2027**), y para ese ya existe 4.8 a coste cero. Lo que se pondrá lento antes que el volumen son las 5 lecturas de hoja ENTERA que D102/D107 no pudieron acotar: `acumulado_drenajes` y `consolidadoRango` (DATA), `maquinariaProduccionGuardar` (MAQUINARIA), `parteUltimoFinal_` (PARTE_BANDEJA, una vez por equipo faltante) y los cruces históricos de `roster`/`export`. **Fase 0 (ahora, sin redeploy):** correr `diagnosticoCapacidad()` y `diagnosticoPeso()` en los dos Sheets hoy y a 14 días (filas/día por hoja, celdas de rejilla vs 10 M); tabla dinámica sobre la hoja `LOG` por `action` (p50/p95 de `ms`); repetir cada mes. **Se dispara si:** p95 de servidor > 5 s en `asistencia`/`export`/`acumulado_drenajes`/`consolidado` rango/`op=bandeja` y no baja con 4.8; o segunda obra con tablero consolidado; o el tope de 186 días de `persona`/`ausencias` estorba. **Si se dispara — opción recomendada:** lógica portada al Worker `galca-api` (mismo JS, mismo arnés `hojaFalsa` como frontera) + Postgres gestionado (Supabase Pro ~25 USD/mes o Free con ping diario; Workers Paid ~5 USD); alternativa D1 (~5 USD, encierro en Cloudflare). Esfuerzo 8–12 semanas por módulos: **Parte Digital → Asistencias → Obra**, cada corte = `wrangler secret put` con vuelta atrás de un comando, la cola offline se redirige sola por `tipo`. Sheet ESPEJO por **pull** desde un `.gs` con trigger cada 5–15 min (misma cuenta de Google, sin service account), con DATA en el mismo layout A–AC y strings verbatim para que el copy-paste A:S siga igual; catálogos a mano (BASE, CUBICAJE, MAQUINAS, USUARIOS, CAT_*) se quedan en el Sheet y viajan en sentido contrario por el mismo trigger. Riesgos principales: reescritura de 7.274 líneas con un solo mantenedor (mitigación: arnés de contrato en verde antes de cada corte), Supabase Free se pausa a los 7 días sin uso, tipos fecha/hora de Sheets, dos almacenes durante la transición (nunca doble escritura). | 🔲 **V3 — APROBADO por el dueño (16-sep-2026): se migra.** Disparador real = disponibilidad bajo carga (Apps Script se cae en picos: tope de ~30 ejecuciones simultáneas, 0,5 s por lectura, lock global de 30 s en asistencias), no el volumen; la Fase 0 de medición se elimina. Arquitectura objetivo en §7 del informe: lógica en el Worker `galca-api` (mismo JS, arneses reusados), Postgres (Supabase) por SQL directo con transacción por escritura, `obra_id` desde el día uno, ESPEJO por pull, catálogos a mano siguen en el Sheet. **Arranca cuando el dueño cierre sus cambios pendientes del Parte Digital**; orden Parte → Asistencias → Obra (alternativa de fondo a 4.8 / 4.11 / 3.6; el cambio de destino es `wrangler secret put`, D169) |
```

Y añadir en 4.8 (archivado) una línea: «**Primera respuesta al disparador de filas de 4.01** (ASISTENCIA llega a 50k
entre feb y may-2027): archivar años cerrados antes de plantear la migración.»
