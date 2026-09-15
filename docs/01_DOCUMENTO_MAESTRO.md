# DOCUMENTO MAESTRO — Sistema de Reporte Diario de Obra TM2 Sur

**Versión:** 2.1 · **Fecha de corte:** 2026-09-15 · **Estado:** V1 ✅ cerrado · V2 entregada en su mayor parte · módulos **Asistencias** y **Parte Digital de Maquinaria** en uso.

> **Jerarquía de fuentes.** Este documento es la referencia extendida. Ante cualquier diferencia manda `02_REGISTRO_DECISIONES.md` (decisiones), luego `PROJECT_CONTEXT.md` (reglas vigentes), `03_BACKLOG.md` (alcance), `04_ARQUITECTURA.md` (técnico), `05_CATALOGO.md` (catálogos) y `OPERACIONES.md` (despliegue y operación). Los números **Dxx** remiten al registro.
>
> **Sin secretos.** Este archivo vive también en `/docs` del repo público: no lleva contraseñas, IDs de Sheets ni URLs `/exec` de Apps Script (ver D108 y D169). Las claves viven en la hoja `USUARIOS`; los IDs y URLs, en el backend y en los secretos del Worker.

---

## 1. Objetivo del sistema

Digitalizar la información diaria de la obra vial TM2 Sur (UF1/UF2), reemplazando mensajes de WhatsApp, planillas y partes en papel por captura web estructurada que:

1. Alimenta el registro maestro de cantidades de obra (Excel **TM2_SUR_REPORTE_DIARIO_OBRA**, hoja DATA) por copy-paste A:S.
2. Alimenta el Excel de partes de maquinaria (**Partes_Diarios_de_Maquinaria_<periodo>.xlsx**, hoja BASE MAQUINARIA, columnas B→AR) desde el Parte Digital por QR (D165).
3. Genera el mensaje diario de WhatsApp de tierras y de drenajes con el formato establecido.
4. Da visibilidad de quién reportó y quién falta (capataces, chequeadoras, equipos, personal).
5. Digitaliza la asistencia de personal y genera el Excel **Parte de Trabajo** formato Navision (D69).
6. Da al jefe y a los directivos consulta post-DATA y un tablero de producción (D65, D158).

## 2. Alcance

**Obra (motor BANDEJA → DATA):**
- **TIERRAS** (Explanaciones + Bases/Subbases) y **ESTRUCTURAS/MSR** (GRUPO = TIERRAS, D66).
- **DRENAJES** por áreas (D70): **ODT** (CC `37xx.06.*`) y **ODL** (CC `37xx.07.*`). El área se deriva del CC (`deriveArea`).
- Ítems puntuales fuera de esos capítulos (D71): **Riego de imprimación** 04.01 (tierras) y **Demolición de estructuras** 01.02 (drenajes).
- La app captura hasta **LARGO**; ESPESOR, FC, CANTIDAD, ACTA y ORDEN se gestionan en el Excel maestro.

**Excluidos:**
- Transporte m³-km en DATA. El transporte se pre-llena aparte para la digitadora (D83).
- Protección de taludes, y el resto de pavimentos y demoliciones.
- En drenajes: conversión de unidades (2.19) y catálogo de máquinas (2.20), ambos parqueados.
- Todo el lado de obra de **UF3** (3.5). Solo sus asistencias están dentro (D101).

**Módulos adicionales:**
- **Asistencias** (D69): Sheet y Apps Script propios.
- **Parte Digital de Maquinaria** (D165).
- **Digitación de volquetas** (D83).
- **Tablero de producción** (D158).
- **Herramientas Excel de escritorio**: reparto de producción por máquina y Conciliador de Actas.

**Traspaso a los Excel maestros:** siempre **manual por copy-paste**. La app nunca escribe un `.xlsx` maestro.

## 3. Infraestructura

| Pieza | Detalle |
|---|---|
| Frontend | GitHub Pages en **https://tm2.galca.app/** (repo `galca`, dominio propio con `CNAME`). JS y CSS de cada pantalla en `<nombre>.js`/`<nombre>.css` (D170). Tema común `tema.css`/`tema.js` (tema oscuro/claro, DM Sans/Syne, acento naranja `#f5a623`). CSP sin `'unsafe-inline'`: manejadores `data-on-*` y estilos `data-estilo` (D170). |
| Proxy | Worker de Cloudflare **https://api.galca.app** (D169) con rutas `/obra`, `/asistencias`, `/parte` y `/prueba/…`. Hace CORS, limita a 120 peticiones/min por IP y exige que el token venga presente en `/obra` y `/asistencias`. `auth.js` es el único sitio del frontend con la URL base. |
| Backend obra | Apps Script `Codigo.gs` + `CodigoParte.gs` (mismo proyecto y URL). |
| Backend asistencias | Apps Script `CodigoAsistencias.gs` (proyecto y Sheet propios, aislado, D69). |
| Almacenamiento | Dos Google Sheets: **obra** (incluye Parte Digital) y **asistencias**. |
| Autenticación | Login contra la hoja `USUARIOS` con clave en hash SHA-256 de `usuario:clave` (D108). Token firmado HMAC-SHA256 verificado en una puerta única de `doGet`/`doPost`; invalidación por `AUTH_V` o por `estado` (D109). |
| Endurecimiento (D166) | Hoja `LOG` (una fila por petición) y rate limit (60/min por usuario+action; login 10/min; Parte 20/h por equipo). Validación de payload antes de escribir. Respaldo diario a Drive `Galca_respaldos/TM2_Sur` (30 días, trigger 02:00). |
| Entorno de prueba (D168) | `entorno.js`: `?env=prueba` apunta a copias del Sheet y del Apps Script, con chip «PRUEBA». |
| Sin conexión (D82) | PWA (`sw.js` network-first, `manifest.json`) para el shell y las capturas (capataz, chequeadora, drenajes, asistencia). Cola `tm2_cola_envios` (`offline.js`) con sincronización FIFO. `id_registro` UUID generado en el cliente con dedupe en el backend. El token se pega al enviar, no al encolar. Encargado, residentes y jefe consolidan solo con señal. |
| Despliegue | Apps Script: *Administrar implementaciones → editar → Nueva versión* (misma URL). Pages: commit al repo. Subir `CACHE_V` en `sw.js` cuando cambia la lista de precache o un archivo precacheado del que dependan los HTML nuevos. |

**Reglas técnicas permanentes:**
- **Fechas en Apps Script:** duck-typing (`typeof x.getFullYear`), nunca `instanceof Date` (D31).
- **Validación de fechas:** toda fecha que entra por la API se valida con `fdateValida_` (D106).
- **Fecha por defecto en el frontend:** `toLocaleDateString('en-CA',{timeZone:'America/Bogota'})`, nunca `toISOString()` (D50).
- **POST:** siempre con `Content-Type: text/plain`.
- **Escrituras en bloque:** pasan por `ensureRows_` (D93).
- **Lecturas por fecha:** en dos pasos (D102/D107).
- **Compatibilidad:** los endpoints de recepción aceptan payloads viejos de la cola offline.

## 4. Roles y usuarios

Las claves no se documentan aquí; viven en la hoja `USUARIOS` (alta o baja = editar una fila).

| Rol | Usuarios | Entra a | Responsabilidad |
|---|---|---|---|
| `admin` | admin | `menu.html` | Acceso a todo; «← Menú» en cada pantalla. |
| `capataz` (tierras) | angel · alejo · robinson · albert (volvió de UF3, D145) | `seleccion-reporte.html` o `reporte-capataz.html` | Actividades con producción; asocia **códigos** de máquina a cada actividad (D171). |
| `chequeadora` | maleja · mairy · maria · luzdary | `seleccion-reporte.html` | Viajes por PK destino y origen, con desglose por placa. Fuente oficial del volumen de excavación y terraplén. |
| `encargado` | encargado | `encargado.html` | Reconcilia la bandeja de tierras, envía a DATA, genera el WhatsApp. |
| `residente` | residente | `residente.html` | Panel del encargado, resumen del jefe, Maquinaria (producción + Flota), asistencias. |
| `jefe` | jefe | `jefe.html` | Consulta post-DATA por rango (solo lectura), tablero, Maquinaria en solo lectura. |
| `capataz_odt` / `capataz_odl` | mauricio · eduardo · enrique (ODT) · jairo (ODL); los cuatro con áreas ODT+ODL | `reporte-drenajes.html` | Reporte de drenajes; el área de cada línea sale del CC. |
| `residente_dren` | residente_dren | `residente-drenajes.html` | Bandeja combinada ODT+ODL, envío a DATA por área. |
| `digitadora` | digitadora | `digitadora.html` | Pre-llenado de la BASE de transporte (solo lectura, D83). |
| `asistencia_plus` | jeisson | `seleccion-reporte.html` | Cuadrilla OPERADORES, resumen de asistencias; edita la Flota (D139). |
| `asistencia_plus_dren` | duvan | `seleccion-reporte.html` | Asistencias ODT+ODL; cuadrilla propia DUVAN (D88/D105). |
| `asistencia_plus_uf3` | residente_uf3 | `seleccion-reporte.html` | Asistencias de UF3 / proyecto 3703 (D101). |
| `asistencia_plus_tm2` | angie | `seleccion-reporte.html` | Asistencias de tierras+ODT+ODL con selector «Ver como» (D119). |
| `parte_maquinaria` | (opcional; hoy sin usuario) | `revision-maquinaria.html` | Solo revisión de partes digitales. |
| Operadores de maquinaria | sin login | `parte.html?eq=<código>` por QR | La identidad es el **equipo** (D165). |

`ariel` salió a UF3 (D84): su llave no se reutiliza y su histórico se conserva.

## 5. Flujo de información

```
OBRA
Capataz tierras ─┐
Chequeadora ─────┼──> BANDEJA (crudo, estado) ──> Encargado / residente ──> DATA (oficial, por día+área)
Capataz drenajes ┘         │                      Residente drenajes            │
                           │                                                    ▼
                           ├──> MAQUINARIA (código de máquina + producción)  copy-paste A:S →
                           ├──> VOLQUETAS (1 fila/placa) ──> digitadora.html   TM2_SUR_REPORTE_DIARIO_OBRA
                           └──> OBSERVACIONES (nota general del día)                    │
                                                                                        ▼
                                                            jefe.html · tablero-produccion.html

MAQUINARIA (horas, operador, CC, motivo)
QR en cabina ──> parte.html ──> PARTE_BANDEJA (pendiente) ──> revision-maquinaria.html (aprueba)
                                                                   └─> copiar B→AR → Partes_Diarios_de_Maquinaria
Flota: produccion-maquinaria.html › Flota ──> MAQUINAS (estancias) + PARTE_EQUIPOS (ficha)
Reparto mensual por CC: Reparto_Produccion_Maquinaria.html (escritorio, lee los Excel)

ASISTENCIAS (Sheet propio)
Responsable de cuadrilla ──> asistencia.html ──> ASISTENCIA ──> resumen-asistencia.html
                                                                 └─> Excel Navision por día × proyecto
```

**Reglas del flujo de obra:**
- **BANDEJA** guarda quién reportó (`reporta`, `rol`), `estado` (pendiente / incluido / descartado / no_data), `origen` y `area`.
- **Enviar a DATA** reemplaza lo del **día + área** (re-enviar pisa, D03/D70) y marca la bandeja.
- El panel muestra el estado del envío de forma permanente, bloquea el envío que borraría el día y tiene candado contra doble envío (D110).

## 6. Reglas de negocio vigentes

### 6.1 Ubicación y clasificación
- **UF por PK:** PK ≤ 30+000 → UF1 / proyecto 3701; PK > 30+000 → UF2 / proyecto 3702 (D04).
- **Centro de costo:** proyecto + código del ítem (ej. 3701.02.07), armado automáticamente.
- **Valores verbatim de la BASE (D63/D68):** en filas con match, **ELEMENTO, DESCRIPCION y ABS** se copian tal cual de la hoja BASE. El elemento se elige por actividad y se cruza por abscisa:
  - préstamo → EL DIVISO
  - MSR → marcador MSR del PK
  - conformación/ZODME → `RCD 15+800`/3701 (por defecto) o `ZODME PK30`/3702, a elección del residente (D79)
  - resto → tramo `tm2 pk X - Y`
- **Cruce por subtramo (D104):** intervalo semiabierto con ancla en el punto medio del rango. El residente puede forzar el subtramo por línea.
- **Liberación:** fija en CAMPO. **PK final:** opcional, salvo en cereo.

### 6.2 Volúmenes y fuente de verdad
- **La chequeadora es la fuente oficial** del volumen de excavación y terraplén (D06); el conteo del capataz es control.
- **m³ por viaje = cubicaje real por placa**, leído de la hoja CUBICAJE (D53).
  - Placa no registrada → **14 fijo** (sin editor en pantalla, D54), con aviso naranja y `cubicaje_origen=default` en VOLQUETAS.
  - Volumen de la línea = Σ(viajes × cubicaje).
- **Filas que genera la chequeadora (D63):**
  - **Una fila de excavación por reporte**, acumulada al PK del origen: Masivo 2 = 19+800 · Masivo 1 = 14+400 · Diviso = 21+500 · Complementario/Otro = PK tecleado.
  - **Una fila de terraplén por cada línea con destino Terraplén.**
- **Tipos de destino:** Terraplén · Puente · UF3 · ODL · ODT · Botadero.
  - Solo Terraplén genera fila de terraplén.
  - **Botadero** genera excavación **no aprovechable** (D67).
  - La observación sella el desglose por destino.
- **ZODME automático:** toda excavación no aprovechable dispara la fila de conformación y disposición con el mismo volumen (D17).
- **Reconciliación en bandeja:**
  - Las filas del capataz que duplican volumen de la chequeadora se apagan por defecto («control · no suma»).
  - Validación: terraplén ≤ aprovechable + préstamo.
  - **Excepción (D113):** `Terraplén con crudo de río` y `Terraplén de UF3` quedan fuera de ambas reglas, porque la chequeadora no mide esos viajes.

### 6.3 Medición por tipo de actividad

| Tipo | Unidad | Cómo se mide | ¿Va a DATA? |
|---|---|---|---|
| Excavaciones, núcleo, corona, subbase, base, pedraplén, ZODME | m³ | Volumen directo | Sí |
| Terraplén con crudo de río / de UF3 (D113) | m³ | Volumen directo; mismo ítem 02.07; la distinción va en la columna interna `actividad` | Sí |
| Cereo (corona y subbase) | m² | (ABS final − ABS inicial) × ancho de vía (11.5 m, editable) | **No** (`no_data`) |
| Desmonte / descapote (D58) | m² capturado | Fila contractual en **Ha** (÷10 000) + no aprovechable (m² × espesor, 0.2 por defecto) + ZODME | Sí |
| Materiales MSR | m² / UND / m / m³ | Cantidad directa | Sí |
| Drenajes ODT/ODL | unidad contractual | Cantidad directa; variantes de material del relleno 06.02 (D113c) | Sí |

**DATA:**
- Columnas A–T en el orden del maestro; se pega **A:S**.
- Internas de trazabilidad después de T, más `area` (D71) y `clima` (D37). Estas no viajan al maestro.

**Notas del día (D103):**
- La nota por actividad sale en el WhatsApp.
- La nota general del día va a OBSERVACIONES.

### 6.4 Maquinaria

**Horas, operador, CC y motivo salen solo del Parte Digital (D171).**
- El capataz únicamente asocia **códigos** de máquina a cada actividad (chips), como dato informativo.
- En sus filas de MAQUINARIA quedan vacíos: operador, horas, h_mant, ESTADO, programadas, muertas y motivo.
- Producción de la máquina = largo de su línea. Con varias máquinas, cada una muestra el total (no se suman).
- **Tipos sin producción propia** (regla por tipo): vibrocompactador, minicargador, minibuldózer, retroexcavadora, finisher.

**Flota en dos hojas (D138/D139/D173):**
- **`MAQUINAS`** = estancias de toda la flota: una fila por estancia, ventana `[ingreso, retiro)`, columna `frente` (`UF1-UF2`/`UF3`). Se administra en Maquinaria › Flota.
- **`PARTE_EQUIPOS`** = ficha del equipo (placa, proveedor, medidor). El alta desde Flota la crea sola.
- Los `id_maquina` son los **códigos del parte** (MO003, CR008, NG002…).
- La recepción de reportes **no** valida contra el catálogo (por la cola offline).

**Chequeadora (D54):**
- Registra las excavadoras del origen. Producción = total excavado ÷ nº de máquinas.
- Desde **D177 (sep-2026)** su bloque **ya no captura operador ni horas**: solo elige los códigos de las excavadoras (recorte D171); la producción (col T) sigue por reparto D54 (total ÷ nº de excavadoras).

**Panel «Maquinaria» (`produccion-maquinaria.html`):**
- Pestaña Producción del día (D59–D62): ajusta la columna T con el volumen oficial, redirige producción huérfana y registra faltantes.
- Pestaña Flota (D139): altas, bajas y reingresos, con guard de typos.
- Editan admin, residente y jeisson (solo Flota); el jefe entra en solo lectura.

**Reparto mensual por CC:** `Reparto_Produccion_Maquinaria.html` (escritorio).
- Estancias (D143), días no digitados en cero (D147), listón por actividad (D144), clima en la columna S de `fact_jefe` (D140).
- Guarda su configuración en `localStorage` (D148).
- **`Modelo_Produccion_Maquinaria_v2` / `Captura_Diaria` quedaron fuera de uso (D171).**

### 6.5 Parte Digital de Maquinaria (D165 y siguientes)

**Captura por QR:**
- `parte.html?eq=<código>`, público. Precarga el medidor inicial con el último final y muestra el total en vivo.
- Admite varios CC con prorrateo y «Día sin operación» (Domingo · Festivo · Taller · Lluvia · Disponible · Sin operador).
- Horas por defecto 07:00–15:30.

**Actividad primero, CC derivado (D174):**
- El operador elige «¿Qué hizo la máquina?»: primero chips habituales, luego la tabla completa y, si no está, texto libre.
- El CC se arma con el ítem de `PARTE_ITEMS` + el proyecto por PR.
- Texto libre → alerta `SIN_CC`; no se aprueba sin CC.
- Dueño de la tabla: Jeisson.

**Alertas del servidor:** `INICIAL_DISTINTO` · `TOTAL_ALTO` · `DUPLICADO` · `CC_INUSUAL` · `SIN_MEDIDOR` · `CC_DESCONOCIDO` · `SIN_CC` · `FUERA_DE_FLOTA`.

**Flota y rechazos (D173/D173b):**
- El parte **espera** cada día a los equipos vigentes de UF1-UF2 («Equipos sin parte»).
- Un equipo **con ficha** fuera de la flota **reporta igual**, con alerta `FUERA_DE_FLOTA` (caso típico: volqueta de reemplazo). Solo se rechaza un código sin ficha.
- Regla operativa: varada = «Taller» en Equipos sin parte (D172); reemplazo = reporta por su QR; la Flota solo registra entradas y salidas reales.

**Revisión (`revision-maquinaria.html`):**
- Aprobar o descartar con edición en el sitio, y «Aprobar todo lo sin alertas».
- Cierre masivo de días sin operación, con nº de parte opcional en esas filas (D172).
- Vista Base con «Copiar para Excel» de B→AR.

### 6.6 Asistencias (módulo aislado, D69)

**Captura:**
- Cada responsable reporta su cuadrilla (roster data-driven por la hoja CUADRILLAS).
- Hora de entrada y salida se guardan crudas; la clasificación de horas se calcula **al exportar** con `horas-nomina.js`, compartido con `horas-persona.html` (D112).
- Re-enviar la misma fecha+cuadrilla pisa lo anterior, con escritura quirúrgica (D107).
- Domingos y festivos: solo se reporta a quien trabajó (D81/D115).

**Export Navision:**
- Un archivo por día × proyecto (3701/3702/3703).
- String de proyecto verbatim desde CONFIG.
- Columnas C–H calculadas; I–N vacías (confirmado).
- Tope de 10 h/día en el Excel del Parte (D159).

**Personal:**
- Alta y retiro con fechas; nunca se borran filas.
- Eventuales = `estado=eventual`, no se esperan cada día (D85).

**Consultas y extras:**
- Seguimiento de ausencias por rango (D94).
- Horas por persona con corte 11→10 (D112).
- Extras del admin por día o por rango (D73/D159) y su consulta privada (D142).

**Áreas:** tierras, ODT, ODL y UF3 en el mismo Sheet (D72/D84/D101).

### 6.7 Digitación de volquetas (D83)
- `digitadora.html` lee VOLQUETAS por fecha y explota los viajes en renglones pre-llenados: placa, PKs, cubicaje, UF, actividad/material/CC.
- La digitadora teclea remisión, horas y conductor.
- Export alineado a BASE 2026 (A→AH) con Omitir blancos, sin persistencia.

## 7. Pantallas

| Archivo | Acceso | Función |
|---|---|---|
| `index.html` | todos | Login contra `USUARIOS`; «Continuar como X» y validación sin señal tras el primer login (D108). |
| `menu.html` | admin | Hub por grupos: revisión, reportes de campo, maquinaria · parte digital, asistencias, herramientas de Excel. |
| `seleccion-reporte.html` | usuarios con doble deber y roles de asistencias | Tiles de reporte de obra y asistencia. |
| `residente.html` | residente, admin | Panel de selección del residente. |
| `reporte-capataz.html` | capataz, encargado, residente, admin | Actividades con producción adaptativa + códigos de máquina (D171). |
| `reporte-chequeadora.html` | chequeadora, admin | Origen + líneas por PK destino con placas y cubicaje real + excavadoras (D54). |
| `encargado.html` | encargado, residente, admin | Bandeja de tierras: toggles, totales, reconciliación, subtramos, clima, Enviar a DATA, WhatsApp. |
| `reporte-drenajes.html` | capataces ODT/ODL, admin | Reporte de drenajes con buscador de actividad y nota general. |
| `residente-drenajes.html` | residente_dren, admin | Bandeja combinada ODT+ODL, envío por área, WhatsApp. |
| `jefe.html` | jefe, residente, admin | Resumen post-DATA por rango, filtro de área, desglose por material, copiado A:S. |
| `tablero-produccion.html` (+ `tablero/`) | admin, jefe, residentes | Tablero de producción; foto compartida que publican admin y jefe (D158). |
| `produccion-maquinaria.html` («Maquinaria») | admin, residente; jeisson (Flota); jefe (lectura) | Producción del día + Flota. |
| `parte.html` | público por QR | Parte digital del equipo. |
| `revision-maquinaria.html` | admin, encargado, residente, parte_maquinaria | Revisión de partes, equipos sin parte, Base B→AR. |
| `digitadora.html` | digitadora, admin | Pre-llenado de la BASE de transporte (pantalla de PC). |
| `asistencia.html` | responsables de cuadrilla y roles de asistencias | Formulario de asistencia. |
| `resumen-asistencia.html` | residente, admin, roles de asistencias y residentes de drenajes | Resumen del día, faltantes, export Navision, gestión de personal, ausencias. |
| `horas-persona.html` | mismos del resumen (acotados por área) | Horas por persona; «Mis horas extra» solo para admin. |
| `mis-extras.html` | admin | Registro de extras del admin (un día o rango). |
| `estado.html` | admin (por URL) | **Obsoleto** (D171): lo reemplaza «Equipos sin parte». |
| `Reparto_Produccion_Maquinaria.html` | escritorio (desde el menú) | Reparto mensual de producción por máquina. |
| `conciliador/index.html` | escritorio (desde el menú) | Conciliador de Actas de transporte. |

**Versión de PC** (dos columnas desde 1100 px, móvil intacto): encargado, asistencia, resumen, menú, residente-drenajes y jefe (D151/D155/D156/D157).

## 8. Almacenamiento

**Sheet de obra** (el ID está en `Codigo.gs`):

| Hoja | Contenido |
|---|---|
| BANDEJA | Crudo con estado; 28 columnas (col 23 `origen`, col 24 `area`, cols 25–28 solo para WhatsApp de drenajes). |
| DATA | A–T idénticas al maestro TM2 + internas (trazabilidad, `actividad`, `area`, `clima`). Se pega A:S. |
| MAQUINARIA | Layout A→AA heredado (D52) + internos del app (`produccion_capataz_orig`, `area`…). Desde D171, horas, operador y ESTADO van vacíos en filas del capataz. |
| VOLQUETAS | 1 fila por placa: id_registro · timestamp · fecha · reporta · origen · destino · tipo_destino · uf · placa · viajes · cubicaje · m3_placa · cubicaje_origen. |
| CUBICAJE | placa → cubicaje (opcional `tipo`); espejo de la Bitácora de Transporte que mantiene el usuario. |
| OBSERVACIONES | Nota general del día por envío, sellada por área. |
| BASE | Catálogo de ítems (A–H) y de elementos/tramos (J/K/L) que se copia verbatim a DATA. |
| MAQUINAS | Estancias de toda la flota con `frente`. |
| USUARIOS | usuario · clave (hash) · rol · areas · redirige · estado. |
| LOG | Una fila por petición (D166). |
| PARTE_EQUIPOS · PARTE_OPERADORES · PARTE_CC · PARTE_ITEMS · PARTE_BANDEJA | Parte Digital: fichas, operadores, CC, tabla actividad → ítem (D174) y partes. |

**Sheet de asistencias** (el ID está en `CodigoAsistencias.gs`): PERSONAL · CUADRILLAS · ASISTENCIA · CONFIG · FESTIVOS · TURNOS · CAT_TRABAJADORES · CAT_CC · CAT_MOTIVOS · NOTAS_ASISTENCIA · EXTRAS_ADMIN · LOG.

**Excel fuera del app:**

| Archivo | Uso |
|---|---|
| TM2_SUR_REPORTE_DIARIO_OBRA.xlsx | Hoja DATA (registro maestro de cantidades, desde sep-2025) ← A:S de DATA. |
| Partes_Diarios_de_Maquinaria_<periodo>.xlsx | BASE MAQUINARIA ← B→AR de partes aprobados. |
| TERRAPLEN.xlsx (BASE 2026) | Base de transporte ← export de `digitadora.html`. |
| Plantilla Parte de Trabajo (Navision) | Destino del export de asistencias (hoja `Parte`). |
| Modelo_Produccion_Maquinaria_v2.xlsx | **Fuera de uso desde D171.** |

## 9. Pendientes vigentes (al 15-sep-2026)

**Tareas del usuario (sin código):**

| Tema | Detalle |
|---|---|
| Operadores duplicados | Depurar `PARTE_OPERADORES` (p. ej. Aleyxer Rincon / Aleixer Lizarazo). El código no los funde. |
| Etiquetas del parte | Validar con Jeisson las etiquetas de `PARTE_ITEMS` (D174). |
| Equipos sin tipo | Revisar GQW139, SJQ401 y TAR538: sin `tipo` en `PARTE_EQUIPOS` no tienen QR. Completar el tipo y regenerar con `generar_qr.py --solo CODIGO`, si siguen en obra. |
| Usuario revisor (opcional) | Crear un usuario con rol `parte_maquinaria` en `USUARIOS` solo si otra persona va a revisar partes. |

**Desarrollo reciente (cerrado sep-2026):**

| Ítem | Detalle |
|---|---|
| V3-06(b) | **✅ Hecho y validado en campo (D177, sep-2026):** la chequeadora captura solo los códigos de las excavadoras; operador, horas y motivo fuera; la producción (col T) sigue por reparto D54 (total ÷ nº de excavadoras). Enmienda D54(b). |
| V3-06(c) | **Obsoleto:** desde D173b un equipo con ficha fuera de flota se guarda con alerta, así que el texto de `parte.html` es correcto. |

**Backlog abierto, no iniciar sin pedido del dueño:**
- 4.02 página de producto galca.app · 4.04 PIN por equipo junto al QR
- V3-02 mejoras del parte · V3-05 reparto leyendo `PARTE_BANDEJA` · 4.07 motivo de horas muertas en el parte
- 4.05 UF3 en maquinaria (descartado por ahora)
- 2.19 / 2.20 drenajes (parqueados)
- 3.2 chequeadora del Diviso · 3.3 columnas MSR · 3.4 inoperativos estructurados · 3.5 obra de UF3
- 4.01 base de datos real · 4.03 subdominio por obra · 4.8 archivado del histórico
- 4.14 cuadrilla propia de angie (no implementar hasta que la pida) · 2.33 rutas sin `.html` (no se hará)

**Inconsistencias documentales — resueltas en la puesta al día de sep-2026 (v2.1):**
- **03_BACKLOG:** 2.8/2.9 → Hechos (D82); 2.10 validado (D54); 4.12 cerrado (`proyecto_3703` cargado, asistencias UF3 OK); V3-06(b) cerrado (D177), V3-06(c) obsoleto (D173b).
- **PROJECT_CONTEXT:** línea «Estado» reescrita al estado real de sep-2026.
- **04_ARQUITECTURA:** retirado el aviso de desfase; incorporados D107–D142 y los endpoints de Flota (D139) y Tablero (D158).
- **05_CATALOGO:** §6 (capataz solo código + Parte Digital, D171/D165) y §7 (usuarios vigentes, sin claves) al día; luminaria TI12 dada de baja.
- **Secretos:** retirados de `/docs` claves, IDs de Sheets y URLs `/exec` (Tarea 0); regla nueva en PROJECT_CONTEXT.

## 10. Resolución de los pendientes de la versión 1.1

| Tema (v1.1) | Resolución |
|---|---|
| Clima en formularios | Hecho en el panel del encargado (D37/D140); drenajes sin clima. |
| Resto de maquinaria (vibros, D150B, moto 120) | Cerrado (1.12, D137): CR020 y D150B salieron; hoy la flota vive en `MAQUINAS` (D138/D173). |
| Marca/modelo/valor-hora en dim | Cerrado (1.13); el modelo quedó fuera de uso (D171). |
| Festivos en RESUMEN_MES | Cerrado sin implementar por decisión del dueño (2.3). |
| Alineación hoja MAQUINARIA | Resuelto (D52); el pegado a Captura_Diaria quedó en desuso (D171). |
| Cálculo del no aprovechable | Resuelto: Botadero → no aprovechable (D67), desmonte/descapote → no aprovechable + ZODME (D58). |
| Otras actividades secuenciales | Cerrado sin implementar (2.5); se agregan al catálogo cuando hagan falta. |
| Contraseñas definitivas | Cerrado (1.14, D108): claves en la hoja `USUARIOS` con hash; el encargado conserva su clave por decisión del dueño. |

## 11. Historial del documento

| Versión | Fecha | Cambio |
|---|---|---|
| 1.1 | 2026-06-19 | V1 cerrado; V2 en preparación (2.10). |
| 2.0 | 2026-09-14 | Reescritura completa. Se agregan drenajes, Parte Digital, Asistencias, flota viva, autenticación, Worker, endurecimiento, entorno de prueba, offline, tablero y digitadora. Se retiran contraseñas e IDs del documento. Pendientes actualizados. |
| 2.1 | 2026-09-15 | Puesta al día tras confirmar con el dueño: estados de decisiones validados/desplegados en campo (sep-2026); backlog 2.8/2.9/4.12/V3-06 al día; PROJECT_CONTEXT «Estado» reescrito; 04_ARQUITECTURA sin aviso de desfase (D107–D142, Flota, Tablero); 05_CATALOGO §6–§7 al día; secretos fuera de /docs. |
