# ARQUITECTURA GENERAL — TM2 Sur

## Componentes

```
┌────────── GITHUB PAGES · https://tm2.galca.app/ (repo `galca`, frontend estático) ──────┐
│  index.html ──login──> menu.html (admin)                                                │
│                        ├── encargado.html      (encargado, admin)                       │
│                        ├── reporte-capataz.html (capataz, encargado, admin)             │
│                        ├── reporte-chequeadora.html (chequeadora, admin)                │
│                        ├── estado.html          (admin — OBSOLETO D171)                 │
│                        ├── produccion-maquinaria.html "Maquinaria" (admin · residente ·  │
│                        │      jeisson solo Flota · jefe solo lectura — D139: pestañas     │
│                        │      Producción del día + Flota, alta/baja sobre hoja MAQUINAS)  │
│                        ├── residente.html      (residente, admin)                       │
│                        ├── jefe.html (jefe · residente · admin — resumen post-DATA,      │
│                        │             filtro Área tierras/ODT/ODL + copiado por área)     │
│                        ├── reporte-drenajes.html (capataz_odt · capataz_odl · admin;     │
│                        │      área de cada línea por CC 06→ODT/07→ODL; campo areas D84)  │
│                        └── residente-drenajes.html (residente_dren · residente_odt/odl   │
│                                   · admin — bandeja combinada ODT+ODL, envío x área D84) │
│  Sesión: localStorage {usuario, rol} (D82; antes sessionStorage). Login contra la hoja    │
│  USUARIOS del Apps Script (D108) con token firmado HMAC-SHA256 (D109): index.html ya NO   │
│  lleva credenciales.                                                                     │
│  Admin: botón "← Menú" en toda pantalla interna vuelve a menu.html sin cerrar sesión.    │
│  Marca (D170): símbolo Galca 22 px a la izquierda de cada cabecera (img/galca-simbolo.svg,   │
│  máscara CSS en tema.css); logotipo horizontal (img/galca-logotipo.svg) en el tablero.       │
└────────────────────────────────────┬─────────────────────────────────────────────────--┘

**Offline (D82, backlog 2.8/2.8b/2.9):** archivos nuevos `offline.js` (cola localStorage `tm2_cola_envios` + sync FIFO + caché-fallback de catálogos + chip/panel de estado), `sw.js` (service worker network-first, precache del shell + capturas; NUNCA intercepta la API —`api.galca.app` desde D169, antes Apps Script—; fuentes Google cache-first; subir `CACHE_V` si cambia la lista de precache o si un archivo del precache cambia de forma que los HTML nuevos dependen de él, D167), `manifest.json`, `icons/` (192/512/180) y `OFFLINE_README.md`; **D150 suma `tema.css` y `tema.js` al PRECACHE** (por eso `CACHE_V` subió a `tm2-v6`: sin ese salto, el primer arranque sin señal tras desplegar se queda sin tema) (instalación + checklist de pruebas). Flujo de envío de las 4 capturas (capataz, chequeadora, drenajes, asistencia) con rama offline: intento directo (timeout ~15 s) → si no hay red, encola y muestra confirmación NARANJA (distinta del verde de servidor); al volver la señal la cola sube en orden y `Codigo.gs` deduplica por `id_registro` UUID de cliente (asistencia no lo necesita: upsert fecha+cuadrilla idempotente). Encargado/residente/jefe/resúmenes quedan FUERA del offline (D49): sin señal muestran "Esta pantalla necesita conexión".

**API y entorno (D169 sobre D168).** Las pantallas NO hablan con Google: hablan con el Worker de Cloudflare **`https://api.galca.app`** (`worker/`), que reenvía `/obra`, `/asistencias` y `/parte` a las URLs `/exec` guardadas como secretos suyos. `auth.js` es el PRIMER script del `<head>` de las 21 pantallas y el ÚNICO sitio del frontend con la URL base (`TM2Auth.API_BASE`, `TM2Auth.url = {obra, asistencias, parte}`); `entorno.js`, cargado justo después, no contiene URLs: arma `GALCA_ENV.url.obra` / `.asistencias` / `.parte` sobre esa base para `produccion` (tal cual) o `prueba` (`/prueba/…`) según `?env=` / localStorage `galca_env`. Con prueba activo pinta el chip «PRUEBA» en el `h1` de `.header-left` (o fijo arriba-centro) y al cambiar de entorno cierra la sesión. Está en el precache (`CACHE_V` v9). Cómo crear el entorno de prueba: `docs/OPERACIONES.md`.

**Presentación (D150/D151/D153/D155).** Dos archivos compartidos que cuelgan de TODAS las pantallas:

```
tema.css   Los ~25 tokens de color, en cuatro bloques: :root (oscuro) · @media
           prefers-color-scheme:light · [data-tema="claro"] · [data-tema="oscuro"].
           El ORDEN es la lógica: a igual especificidad gana el último, así que
           los [data-tema] van después del @media o la preferencia del teléfono
           pisaría la elección de la persona.
           Separa RELLENO de TEXTO: --accent rellena, --accent-txt escribe.
           Sobre blanco, #f5a623 como texto da 2,03:1 (ilegible). Igual con
           --success/--error/--uf1/--uf2.
tema.js    Bloqueante en el <head> a propósito: aplica data-tema ANTES del primer
           pintado (si no, parpadeo en cada carga de cada pantalla). Monta el
           interruptor —UN botón que alterna— en #tm2-tema-slot si la pantalla lo
           declara, si no en .header-user, y como último recurso fijo abajo a la
           izquierda (arriba está ocupado: el chip de señal de offline.js).
           D167: define además la global esc() (escape de HTML) — ver la sección
           «D167 — Endurecimiento del frontend» al final.
           D170: despachador de eventos `data-on-*` (sin eval), aplicador de
           `data-estilo` por CSSOM e `irA()`/`recargar()` — ver «D170» al final.
           Sin tema.js una pantalla NO responde a ningún botón: es obligatorio.
<nombre>.js / <nombre>.css   (D170) el JS y el CSS de cada pantalla, que antes
           iban dentro del HTML; el tablero usa tablero-xlsx.js + tablero-produccion.js.
```

Los `:root` locales de las 18 pantallas DESAPARECIERON: la paleta vive solo en `tema.css`.

**Versiones de PC (D151/D155/D156):** `encargado.html`, `asistencia.html` y `resumen-asistencia.html`
se reparten en dos columnas a partir de 1100px (además de `digitadora.html`, que ya era de PC
por D83). Como los tres `render()` escupen una lista plana, las columnas salen de envoltorios
(`.pc-*`) insertados en esa lista, y **por debajo de 1100px llevan `display:contents`**: los
envoltorios no existen para el layout y el orden en el teléfono queda EXACTAMENTE igual que
antes — esa es la garantía de no-regresión para la gente de campo. Toda celda de la rejilla
lleva `min-width:0`, o un hijo ancho ensancha su columna en vez de hacer scroll dentro.
`menu.html` (D156) aplica el mismo patrón sobre su HTML estático: los cuatro grupos de accesos
se envuelven en `.pc-panels`/`.pc-group`/`.pc-tiles` (en `display:contents` bajo 1100px) y a
partir de 1100px pasan a un tablero bento con hero de bienvenida — mismos 12 accesos, solo estilo.

                                     │ fetch a https://api.galca.app (Worker D169) · Content-Type: text/plain
                                     ▼
┌──────── API vía WORKER `api.galca.app` (D169) → GOOGLE APPS SCRIPT (una sola URL /exec) ─┐
│  GET  ?action=bandeja&fecha=…[&proyecto=…][&area=…] → crudo del día por área (D70)      │
│  GET  ?action=consolidado&fecha=…            → lo ya enviado a DATA                     │
│  GET  ?action=consolidado&desde=…&hasta=…    → filas A–T de DATA + climaPorDia (D65/D37)│
│  GET  ?action=estado&fecha=…                 → máquinas reportadas (estado.html, OBSOLETO D171)│
│  GET  ?action=maquinas&fecha=…               → flota MAQUINAS del día (solo tipos de producción) + `equipos` (vigentes del día, D171/D173)│
│  GET  ?action=debug&fecha=…                  → diagnóstico                              │
│  GET  ?action=cubicaje                        → mapa placa→cubicaje (frontend, D53/2.10) │
│  GET  ?action=volquetas&fecha=…               → filas VOLQUETAS del día (digitadora, D83) │
│  GET  ?action=maquinaria_produccion&fecha=…  → frentes×oficial DATA + PK/horas/faltantes  │
│  GET  ?action=drenajes                        → 147 marcadores ODT + ítems .06/.07 (D70)  │
│  POST {reporte}                              → escribe BANDEJA + MAQUINARIA (+VOLQUETAS)  │
│         (D171 capataz / D177 chequeadora: equipos = solo código; horas/operador/motivo   │
│          NO se escriben. Chequeadora: producción col T = total excavado ÷ nº excavadoras) │
│  POST {action:enviar_data, area}             → pisa DATA del día POR ÁREA + marca bandeja │
│         (tierras/odt/odl derivada del CC con deriveArea; sin area = tierras — D70)       │
│  POST {action:maquinaria_produccion}         → parcha col T + crea filas (redir/horas/compl, D60-62)│
│  Regla técnica: fechas por duck-typing (getFullYear), nunca instanceof Date.            │
│  Capacidad de grilla (D93): TODA escritura en bloque pasa por ensureRows_(sheet,n) —    │
│  la hoja crece sola (bloques de 1.000) al agotarse sus filas; diagnosticoCapacidad().   │
│  Redespliegue: Administrar implementaciones → editar → Nueva versión (misma URL).       │
└────────────────────────────────────┬─────────────────────────────────────────────────--┘
                                     ▼
┌──────────────────────────── GOOGLE SHEETS (almacenamiento) ─────────────────────────────┐
│  BANDEJA     crudo con estado (pendiente/incluido/descartado/no_data) · 28 cols          │
│              +`origen` (col 23): banco de material de la chequeadora para excavación     │
│              aprovechable (Masivo 1/2/Complementario/Otro); vacío capataz/enc (D56)      │
│              +`area` (col 24, ''=tierras) y SOLO-WhatsApp `personal_oficiales` ·         │
│              `personal_ayudantes` · `turno_noche` · `nota_libre` (cols 25–28, D70)       │
│  MAQUINARIA  equipos con producción individual (directo, sin aprobación); interno `area` │
│              tras produccion_capataz_orig — drenajes = captura libre, a_captura=NO (D70) │
│              D171/D177: G operador · L horas_operadas · O horas_mantenimiento · R ESTADO ·│
│              app_horas_programadas · app_horas_muertas · motivo → VACÍAS (capataz desde   │
│              D171, chequeadora desde D177; layout intacto). Esos datos → PARTE_BANDEJA.   │
│              Chequeadora: producción col T = Σ m³ excavado ÷ nº excavadoras (D54).        │
│  PARTE_EQUIPOS · PARTE_BANDEJA · PARTE_* (D165): ficha de cada equipo y parte digital    │
│              (ver módulo abajo). MAQUINAS (D138/D173) = estancias de TODA la flota con   │
│              `frente`; el parte espera a los vigentes del día (alerta FUERA_DE_FLOTA).   │
│  OBSERVACIONES nota GENERAL del día, 1 fila por envío (tierras y drenajes, D103); col   │
│              `area` sellada con las áreas de las líneas del reporte (D86); no a DATA    │
│  VOLQUETAS   desglose por placa de la chequeadora (1 fila/placa, informativo; no a DATA) │
│  CUBICAJE    catálogo placa→cubicaje (lo lee el backend; lo mantiene el usuario; D53/2.10)│
│  DATA        oficial; A–T = espejo del maestro TM2; internas U+ (…area, clima D37)      │
└────────────────────────────────────┬─────────────────────────────────────────────────--┘
                                     │ copy-paste manual por bloques
                                     ▼
┌──────────────────────────── EXCEL MAESTROS (fuera del app) ─────────────────────────────┐
│  TM2_SUR_REPORTE_DIARIO_OBRA.xlsx   ← DATA (A:S del día)                                │
│    └─ hoja DATA alimenta DATOS/TABLAS/GRAFICOS e informes                               │
│  Partes_Diarios_de_Maquinaria_<periodo>.xlsx ← PARTE_BANDEJA aprobados (B→AR, D165)     │
│  Modelo_Produccion_Maquinaria_v2.xlsx — FUERA DE USO desde D171 (ya no se pega          │
│    MAQUINARIA a Captura_Diaria; la producción por máquina se distribuye por CC del      │
│    parte en Reparto_Produccion_Maquinaria.html). Se conserva como histórico.            │
└─────────────────────────────────────────────────────────────────────────────────────--─┘
```

## Pantallas y roles (vigente, sep-2026)

Complementa el diagrama de arriba. Todas hablan con la API en **`https://api.galca.app`** (Worker, D169); las claves viven en la hoja `USUARIOS` (D108).

| Pantalla | Acceso | Función |
|---|---|---|
| `index.html` | todos | Login contra `USUARIOS` (D108); «Continuar como X» y validación sin señal tras el primer login. |
| `menu.html` | admin | Hub por grupos (revisión, campo, maquinaria · parte, asistencias, Excel). |
| `seleccion-reporte.html` | doble deber + roles de asistencias | Tiles de reporte de obra y de asistencia. |
| `reporte-capataz.html` | capataz, encargado, residente, admin | Actividades + **solo el CÓDIGO** de máquina por actividad (D171). |
| `reporte-chequeadora.html` | chequeadora, admin | Origen + líneas por PK con placas y cubicaje + códigos de excavadoras (D54/D177). |
| `encargado.html` | encargado, residente, admin | Bandeja de tierras: reconciliación, subtramos, clima, Enviar a DATA, WhatsApp. |
| `reporte-drenajes.html` | capataz_odt/odl, admin | Reporte de drenajes; área por CC (06→ODT/07→ODL, D70/D84). |
| `residente-drenajes.html` | residente_dren, admin | Bandeja combinada ODT+ODL, envío por área. |
| `residente.html` | residente, admin | Panel de selección del residente. |
| `jefe.html` | jefe, residente, admin | Consulta post-DATA por rango, filtro de área, copiado A:S (D65). |
| `resumen-ejecutivo.html` | jefe, residente, admin, residentes de drenajes | Resumen ejecutivo por rango (pestaña del Hub del Jefe y acceso en `jefe.html`): texto por reglas + «Redactar con IA» opcional (D217). |
| `tablero-produccion.html` (+`tablero/`) | admin, jefe, residentes | Tablero de producción; foto compartida (D158). |
| `produccion-maquinaria.html` («Maquinaria») | admin, residente; jeisson (Flota); jefe (lectura) | Producción del día + Flota sobre `MAQUINAS` (D59–D62/D139). |
| `parte.html?eq=<código>` | **público por QR** | Parte digital del equipo; identidad = equipo (D165). |
| `revision-maquinaria.html` | admin, encargado, residente, parte_maquinaria | Revisión de partes, «Equipos sin parte», Base B→AR (D165). |
| `digitadora.html` | digitadora, admin | Pre-llenado de la BASE de transporte (D83). |
| `asistencia.html` | responsables de cuadrilla + roles de asistencias | Formulario de asistencia (D69). |
| `resumen-asistencia.html` | residente, admin, roles de asistencias/drenajes | Resumen del día, faltantes, export Navision, gestión de personal (D69). |
| `horas-persona.html` | mismos del resumen (acotados por área) | Horas por persona (D112); «Mis horas extra» solo admin (D142). |
| `mis-extras.html` | admin | Registro de extras del admin (D73/D142). |
| `estado.html` | admin (por URL) | **Obsoleto (D171):** lo reemplaza «Equipos sin parte». |
| `Reparto_Produccion_Maquinaria.html` · `conciliador/index.html` | escritorio (desde el menú) | Reparto mensual por CC · Conciliador de Actas. |

## Flujo de captura (diario)

1. **Capataz** entra → agrega N actividades. Por actividad: actividad específica → (sistema muestra ítem contractual, unidad, UF, CC) → PK → producción (campo adaptativo) → equipos (**solo el CÓDIGO de la máquina**, chips desde `PARTE_EQUIPOS` vía `?action=maquinas`+`flota.js`; sin horas ni operador ni motivo — D171) → **nota de la actividad** (col `observacion`; va a DATA col S y, D103, sale como `📝` bajo su actividad en el WhatsApp del día) + **una nota general del día** por envío (`observacion_general` → hoja OBSERVACIONES).
2. **Chequeadora** entra → fecha, origen → N líneas {PK destino, tipo destino (Terraplén·Puente·ODL·ODT·Botadero), bloque de placas} + maquinaria (excavadoras del origen). Pega el desglose por placa estilo WhatsApp; el sistema parsea placa+viajes, calcula el **volumen real de la línea = Σ(viajes×cubicaje)** leyendo la hoja CUBICAJE (D53 sobre D06). Placa no registrada → fallback **14 fijo** (D54) + flag (naranja + `cubicaje_origen`=default). Cada placa se guarda en VOLQUETAS con su cubicaje y m3_placa. **Excavación = por ORIGEN, acumulada (D63):** la excavación se registra DONDE SE HIZO EL CORTE = el origen, así que el reporte genera **UNA sola fila de excavación = Σ(volúmenes de todas las líneas)** al PK del origen (Masivo 2→19+800, Masivo 1→14+400, Diviso→21+500, todos ≤30→UF1/3701; Complementario/Otro→el PK que teclea la chequeadora), del que derivan PK/ELEMENTO/ABS/UF/PROYECTO/CC. El **terraplén NO cambia**: 1 fila por línea con destino=Terraplén, al PK de DESTINO. No aprovechable acumulada sigue disparando ZODME (D17). Las excavadoras reportadas van a MAQUINARIA con producción = total excavado del día **repartido en partes iguales** entre ellas (D54; el encargado reconcilia duplicados con el capataz, D51).
3. Ambos envían → BANDEJA (+ MAQUINARIA). Confirmación real del servidor (cuenta de filas guardadas).
4. **Operador de cada máquina** (canal aparte, D165) → escanea el QR de la cabina → `parte.html?eq=` → PARTE_BANDEJA (horómetro/km, operador, CC, motivo) → revisión en `revision-maquinaria.html`. **Flujo de datos desde D171:** capataz → producción por actividad (DATA) y asociación informativa máquina↔actividad (MAQUINARIA, solo código); parte → horas / operador / CC por máquina (PARTE_BANDEJA → Excel de partes → distribución por CC).

## Flujo de captura — DRENAJES (D70 / D84)

1. **Capataz de drenajes** entra a `reporte-drenajes.html`. Con una sola área (`capataz_odt`/
   `capataz_odl`, sin campo `areas`) el formulario se comporta igual que hoy. **D84: con el campo
   opcional `areas` en el login (`['odt','odl']`) el desplegable ofrece todos los ítems `.06.*` y
   `.07.*` en una lista y el ÁREA DE CADA LÍNEA se deriva del CC del ítem** (06→ODT pide el
   **marcador de obra**, 147 puntuales `ODT*` de `?action=drenajes`; 07→ODL pide **PK** inicial/final
   o un marcador ODT si es descole). Por línea: **cantidad directa** en la unidad contractual +
   opcional {oficiales, ayudantes, turno de noche, nota libre} + opcional máquinas (texto libre). El
   resumen en vivo agrupa por área. **D103: además, UNA nota general del día para todo el envío**
   (`observacion_general` → hoja OBSERVACIONES, sellada con las áreas de las líneas, D86; no a DATA),
   igual que la del capataz de tierras — la nota libre POR línea se conserva tal cual.
2. Envía a BANDEJA (+ MAQUINARIA con `a_captura=NO`) con confirmación real (D30). El área queda en
   la col `area` de BANDEJA (derivada del CC, por línea). Dos flujos válidos sin código extra (D84):
   mezclar ODT+ODL en un envío, o dos envíos el mismo día (BANDEJA acumula, D02).
3. **Residente de drenajes** revisa en `residente-drenajes.html`. Con una sola área (`residente_odt`/
   `residente_odl`) es como hoy (bandeja filtrada `&area=`). **D84: el residente unificado
   `residente_dren` ve ODT+ODL JUNTOS** — la bandeja se consulta una vez por área y se fusiona en
   cliente (chips de filtro Todas/ODT/ODL, badge de área por línea, totales separados por área) →
   **Enviar a DATA** dispara **una llamada `enviar_data` por área presente** (secuencial, con guard
   anti-borrado: un área sin filas en la bandeja de ese día NO se llama; pisa el día SOLO en cada
   área, D70/D03) → **Generar WhatsApp** (un mensaje con dos secciones, o uno por área, toggle
   recordado en localStorage).
4. `buildDataRowDrenajes` arma la fila: GRUPO "DRENAJES Y ESTRUCTURAS", CAPITULO DRENAJE
   TRANSVERSAL/LONGITUDINAL, ELEMENTO = marcador (ODT) o tramo `"tm2 pk X - Y"` (ODL), ABS del
   marcador/tramo verbatim (K/L), UF/proyecto/CC por D04+D63, DESCRIPCION verbatim (D68).

## Flujo de consolidación (diario, encargado)

1. Consulta fecha → ve: quién reportó / quién falta (capataces y máquinas), totales en vivo, bandeja agrupada por categoría con chip de fuente (rol·usuario).
2. Reconcilia: apaga duplicados (ej. terraplén estimado del capataz vs chequeadora), edita producciones, agrega líneas (directo o vía formulario capataz), anota inoperativos.
3. **Enviar a DATA** (pisa el día **solo en el área tierras**, D70) → **Generar WhatsApp** (copia al portapapeles).
4. Al pisar el día, `buildDataRow` deriva UF/PROYECTO/CC del PK (D04/D63) y, en filas con **match a la hoja BASE**, copia **verbatim** el ELEMENTO (celda J), ABS INICIAL/FINAL (K/L del elemento/subtramo, no del PK reportado) y la DESCRIPCION (tabla de ítems A–H, cruce por CC) — D68; sin match, ELEMENTO/ABS derivan del PK (`buildElemento`, D63). El PK reportado queda en las internas U–AA.

## Flujo de consulta

- estado.html: máquinas reportadas vs faltantes por fecha.
- encargado.html: consolidado y estado de reportes.
- jefe.html (jefe/residente/admin): consulta post-DATA **por rango de fechas** (solo lectura). Resumen por actividad y ubicación (PK crudo + UF, sumando LARGO por unidad), filtro de **Área** (Tierras/ODT/ODL/Todas — derivada del CC en cliente con el espejo de `deriveArea`, D70; el esquema A–T no cambia) y copiado A:S día a día al portapapeles, **por área o día completo**, para pegar en el maestro (D65). No escribe nada.
- Excel maestros: análisis, KPI y resúmenes mensuales (RESUMEN_MES con B2=período, B3=proyecto/0).
- digitadora.html (rol `digitadora`, admin vía menu.html + "← Menú"): **solo lectura** de VOLQUETAS por fecha (`?action=volquetas`), explota los viajes y pre-llena la BASE de transporte (`TERRAPLEN.xlsx`/`BASE 2026`) para pegar con **Omitir blancos** (export A→AH; H/M/V/W/AB–AH quedan vacías por ser fórmula). PK destino real editable por viaje; toggle explotar/agrupado (ORTIZ/internos); viajes externos a mano; **sin persistencia** (Opción A, D83). No escribe nada ni entra a DATA/BANDEJA/MAQUINARIA. Offline fuera de alcance (D49/D82).

## Módulo Asistencias (D69) — aislado, Sheet/Script propios

```
┌── tm2.galca.app (mismo repo `galca`, mismo login index.html) ─────────┐
│  seleccion-reporte.html (capataces/mairy/jeisson/duvan: tiles x usuario)│
│  asistencia.html         (responsable de cuadrilla + admin + duvan)   │
│  resumen-asistencia.html (residente, admin, jeisson, duvan=ODT+ODL)   │
│  mis-extras.html         (SOLO admin: canal "solo extras", D73)       │
└────────────────────────┬────────────────────────────────────────────--┘
                          │ fetch GET/POST (text/plain), URL PROPIA
                          ▼
┌── backend/CodigoAsistencias.gs (Apps Script NUEVO, SHEET_ID propio) ───┐
│  GET  ?action=roster&usuario=…     → cuadrillas + roster + CONFIG      │
│                                       + CAT_CC + motivos frecuentes    │
│                                       (MOTIVOS_USADOS, D78) + recientes│
│  GET  ?action=asistencia&fecha=…   → filas del día + estado cuadrilla  │
│                                       + faltantes (con responsable)    │
│  GET  ?action=personal             → PERSONAL + CUADRILLAS (gestión)  │
│  GET  ?action=export&fecha=…       → crudo del día + catálogos        │
│                                       (el cliente arma el Excel)       │
│  GET  ?action=ausencias&desde=&hasta=→ ausencias del RANGO con motivo   │
│                                       + días no reportados (D94,       │
│                                       solo lectura, máx 186 días)      │
│  POST {reporte_asistencia,…}       → pisa fecha+cuadrilla, escritura   │
│                                       DIRECTA (sin bandeja, D03)       │
│  POST {personal, op, usuario,…}    → valida usuario ∈{residente,admin}│
│  GET  ?action=extras_admin&fecha=… → registro EXTRAS_ADMIN del día(D73)│
│  POST {extras_admin, fecha,cc,…}   → upsert por fecha (proyecto del CC) │
│  POST {extras_admin_delete, fecha} → borra la fila del día             │
│  GET  ?action=cache_reset          → refresca el caché de catálogos    │
│                                       (D99; lo que se edita a mano     │
│                                       en el Sheet no pasa por aquí)    │
│  D99: 1 sola apertura del Spreadsheet por petición,                    │
│  getRange acotado, CacheService 6h para las hojas                      │
│  casi estáticas (NUNCA ASISTENCIA/NOTAS/EXTRAS_ADMIN)                  │
│  y campo `_ms` (ms de servidor) en toda respuesta.                     │
│  D102 — LECTURA ACOTADA de ASISTENCIA (la hoja que crece):             │
│    · por FECHA, en 2 pasos (leerFilasPorFecha_): se escanea SOLO la    │
│      columna `fecha` y se traen únicamente los bloques contiguos de    │
│      filas de ese día/rango, con re-filtro fila a fila. Usan esto      │
│      asistencia · export · ausencias. Fallback a lectura completa si   │
│      la hoja es chica (<2.000 filas), el rango pasa de 12 días, hay    │
│      >12 bloques o habría que traer >40% de la hoja.                   │
│    · por COLUMNAS (leerColumnasDeHoja_) los 2 cruces que necesitan     │
│      TODO el histórico y no se pueden acotar por fecha:                │
│      proyectoDefecto del export (cols 5–14) y los CC recientes de      │
│      roster (cols 2–10).                                              │
│    · memo de lo acotado SEPARADO del de la hoja completa (_memoRango); │
│      invalidarHoja_ limpia los dos. Campo `_celdas` en toda respuesta. │
│    Escrituras SIN tocar: hacen clearContents + rewrite total y         │
│    necesitan todas las filas (ver D102 y backlog 4.11).                │
│  Capacidad de grilla (D93): ensureRows_ antes                          │
│  de cada bloque; la grilla crece sola.                                 │
│  D106 — PORTERO DE FECHAS (fdateValida_): toda fecha que entra por     │
│    la API se valida (yyyy-MM-dd + día que exista) antes de tocar la    │
│    hoja. `fdate` normaliza pero NO valida, y con la fecha vacía se     │
│    escribían bloques enteros sin fecha en ASISTENCIA.                  │
│    · ESCRITURAS (reporte_asistencia, asistencia_individual,            │
│      extras_admin, extras_admin_delete): fecha inválida ⇒ ok:false,    │
│      NO se escribe nada. Sin ok:true el ítem se queda en la cola       │
│      offline (D82) en vez de guardarse mal: el reporte no se pierde.   │
│    · LECTURAS del día (asistencia, export, ausencias): fecha inválida  │
│      ⇒ ok:false. Antes, `fecha=` vacía devolvía justo las filas SIN    │
│      fecha y el resumen las mostraba como si fueran el día pedido.     │
│    · roster: es la excepción — fecha inválida cae al día de hoy, para  │
│      no dejar al capataz sin formulario.                               │
│    · Mantenimiento (a mano desde el editor, no endpoints):             │
│      diagnosticoFechasAsistencia() solo lee;                           │
│      repararFechasAsistencia(true) rellena SOLO la celda `fecha` de    │
│      las filas huérfanas con el día de su `timestamp`.                 │
└────────────────────────┬────────────────────────────────────────────--┘
                          ▼
┌── GOOGLE SHEET NUEVO (ID en el Script de asistencias) ─────────────────┐
│  PERSONAL · CUADRILLAS · ASISTENCIA · CONFIG · FESTIVOS ·              │
│  CAT_TRABAJADORES · CAT_CC · CAT_MOTIVOS (catálogo completo, D78) ·    │
│  MOTIVOS_USADOS (frecuentes, D78) · EXTRAS_ADMIN (D73) —               │
│  setupHojas() de un solo uso                                          │
└────────────────────────┬────────────────────────────────────────────--┘
                          │ SheetJS en el navegador (resumen-asistencia.html)
                          ▼
┌── Plantilla_Parte_Trabajo…xlsx (subida por el usuario, una vez/sesión) ┐
│  El generador llena SOLO la hoja "Parte" (18 columnas A–R) y conserva  │
│  las demás hojas/catálogos intactos → Parte_{proyecto}_{fecha}.xlsx    │
└─────────────────────────────────────────────────────────────────────--┘
```

Reglas clave: captura CRUDA de hora entrada/salida; la clasificación (ordinarias/extras diurna-nocturna/
Dom-Fest) la hace el **clasificador de horas** (módulo JS compartido embebido en `resumen-asistencia.html`,
con casos de prueba manual en comentario) **al exportar**, nunca al guardar. El **estándar de ordinarias
es el del TURNO reportado** (catálogo TURNOS, D72e/D77): las extras empiezan al pasar la salida del turno,
la ventana nocturna va de `CONFIG.nocturno_desde` (19:00) a `CONFIG.nocturno_hasta` (06:00) — lo que una
extra pase de las 06:00 es extra DIURNA —, en sábado un turno sin variante sabatina usa su horario de
semana, y domingo/festivo tiene horario típico 07:00–15:00 (7h a col D, tope `domfest_tope`). Códigos sin
catálogo pasan sin bloqueo (`codigo| NOMBRE`). Retiros = `inactivo` + `fecha_retiro`, nunca se borra una
fila. **Áreas (D72/D84/D101):** CUADRILLAS lleva col `area` (`tierras`/`odt`/`odl`/**`uf3`**) y col **`estado`**
(`activa`/`inactiva`, vacío=activa: inactivar sin borrar; filtra roster/faltantes/export/selectores/
gestión, no lo ya reportado). El guard de área es `areasDeUsuario()` → **array** (residente/jeisson=
`['tierras']`, residente_odt/odl=`['odt']`/`['odl']`, **residente_dren=`['odt','odl']`** con export
Navision combinado, **duvan=`['odt','odl']`** (D88: solo asistencias, sin panel de drenajes),
**residente_uf3=`['uf3']`** (D101: asistencias de UF3/proyecto 3703 y nada más),
**`angie`=`['tierras','odt','odl']`** (D119, rol `asistencia_plus_tm2`: el primer usuario MULTI-ÁREA — TM2 Sur completo, **UF3 fuera**),
admin=`[]` sin filtro); los filtros usan `includes`. **OJO (D119):** el mapa va por **NOMBRE DE USUARIO**, no por rol, y las áreas **NO** salen del campo `a` del token de D109 — `doGet`/`doPost` aplican solo `ses.usuario`, así que dar de alta a alguien con área propia exige tocar `areasDeUsuario()` **además** de la columna `areas` de la hoja `USUARIOS`.
**Regla de `areasEfectivas` (D116 + D119):** el parámetro `&area=` admite **varias áreas separadas por coma** (`odt,odl`), validadas contra `AREAS_VALIDAS` (`tierras/odt/odl/uf3`) y deduplicadas, y se **INTERSECTA** con las áreas forzadas del rol:
`areasEfectivas = pedidas.length ? (pedidas ∩ forzadas) : forzadas`. Como la intersección solo puede devolver un **subconjunto** de lo que el rol ya autorizaba, el parámetro **acota pero nunca amplía**; una intersección **vacía** (p. ej. `&area=uf3` con `['tierras','odt','odl']`) **ignora el parámetro** y usa las forzadas — nunca cae en `[]` = "todas", que es lo que convertiría un filtro en un hueco de seguridad. Para `admin` (forzadas `[]`) el comportamiento es el de siempre. Esto **deroga** la afirmación anterior de que solo el admin podía usar `&area=`: hoy el selector "Ver como" lo tienen **`admin` y `asistencia_plus_tm2`** (`opcionesVerComo()` en `resumen-asistencia.html`); los demás roles siguen sin selector porque su rol ya los acota. **Quién reporta qué cuadrilla** lo resuelve
`cuadrillasDeUsuario`: por la columna `responsables` para capataces/mairy/jeisson, TODAS para `admin` y
**todas las de sus áreas para `duvan`, `residente_uf3` y `angie`** (D88/D101/D119, sin mirar `responsables`); siempre solo las **activas**. La rama de área normaliza `area` **vacía → `tierras`**, que es lo que hace aparecer las cuadrillas de tierras (ANGEL/ROBINSON/OPERADORES…, cargadas sin esa columna) a un usuario multi-área.
**D105:** `duvan` tiene además su **cuadrilla propia `DUVAN`** (`area=odt`, `responsables=duvan`), el análogo de `OPERADORES`/`jeisson`
para drenajes: es una fila más en CUADRILLAS —la rama de área ya la devuelve y la de `responsables` también la encontraría—, sin
personal sembrado (lo asigna él por la gestión del resumen) y **sin una línea de código nuevo** (seed `backend/seeds/CUADRILLAS_dren_duvan.tsv`).
**Proyecto por CC:** `proyectoFromCC` toma los 4 primeros dígitos del CC (genérico, nunca una lista de
proyectos), y el generador Navision busca su string en **`CONFIG['proyecto_'+prefijo]`** — `proyecto_3701`,
`proyecto_3702`, **`proyecto_3703`** (D101); si falta o dice `PENDIENTE`, avisa con la causa exacta y no
inventa el string. Los selectores de UF y los botones de export se derivan de los CC del área, no de una
lista fija. **Escritura:** `cuadrillaPermitidaPara()` rechaza reportar/completar sobre cuadrillas fuera del
área forzada por el rol (D101, regla D69h); quien no tiene área forzada pasa sin restricción.
Los CC "frecuentes" (`ccUsadosParaArea`) aceptan área o **array** de áreas: mandan las forzadas por el
rol y, si no hay, se derivan de las cuadrillas del reportante (`areaDeReportante`). Columnas H–N (Dom/Fest c/s
compensación) y el string de `CONFIG.proyecto_3702` son parámetros abiertos (ver 03_BACKLOG). Este módulo
**nunca** lee ni escribe BANDEJA/DATA/MAQUINARIA ni comparte Sheet/Script con `Codigo.gs`.

**Canal "solo extras" del admin (D73):** hoja **`EXTRAS_ADMIN`** (`fecha·cc·proyecto·horas·tipo·timestamp·reporta`,
clave lógica = `fecha`, re-guardar pisa el día, sin staging) aislada del roster — el admin NO está en
PERSONAL/CUADRILLAS/ASISTENCIA y no aparece en el `Parte` salvo los días con extra. `mis-extras.html` (solo
admin) hace el upsert/borrado; el generador de `resumen-asistencia.html` (`buildAdminExtraRow`) inyecta su
fila al `Parte` del día×proyecto con `Ausente=No`. Día normal: **solo la extra, sin ordinarias** (confirmado
con Navision) — todas las horas en 0 salvo la columna del tipo (E diurna / F nocturna), tope 2h. Domingo/
festivo: las horas van a **D ordinarias dom/fest** (no a extras), tope 7h (`MAX_HORAS_EXTRA`/`MAX_HORAS_DOMFEST`).
CONFIG gana `admin_recurso` (No. Recurso Navision, parámetro abierto: vacío ⇒ no se agrega la fila y avisa)
y hay un flag `EXTRAS_ORDINARIAS_EN_CERO` (en el HTML) por si un import rechaza el 0 en las ordinarias.

## Mapeo de paste MAQUINARIA → Captura_Diaria (D52, verificado con el archivo real)

> ⚠️ **OBSOLETO desde D171 (sep-2026):** el pegado a `Captura_Diaria` ya no se hace — `Modelo_Produccion_Maquinaria_v2` dejó de ser Excel maestro. La hoja `MAQUINARIA` conserva el layout A→AA para no romper lectores, pero desde D171 las columnas **G operador · L Horas Operación · O Horas Mantenimiento · R ESTADO** y los internos **`app_horas_programadas` · `app_horas_muertas` · `motivo`** se escriben **VACÍAS** en las filas del capataz; horas/operador/motivo viven en `PARTE_BANDEJA`. Lo que sigue se conserva como referencia del histórico.

Captura_Diaria es una **tabla de Excel** (`fact_produccion`, A1:AA). Se pegan SOLO las columnas de entrada con **Pegado especial → Omitir blancos**; la tabla autocompleta las columnas-fórmula.

- **Columnas de entrada (se pegan):** B id_fecha · D id_proyecto · E id_maquina · G operador · H actividad · I SUB ACTIVIDAD · L Horas Operación · O Horas Mantenimiento · R ESTADO · T Producción · AA Observaciones.
- **Columnas-fórmula (NO se tocan, van en blanco):** A id_registro (`=ROW()-ROW(fact_produccion[#Headers])`, autonumera) · C dia · F Tipo Equipo · J Unidad · K Horas Programadas (VLOOKUP a `dim`) · M %util · N Horas Muertas (prog−oper) · P %muerto · Q Horas Facturadas · U Meta · V %ef · W rendimiento · X unitario · Z Costo.
- **En blanco aunque sean editables:** S CLIMA (pospuesto, D37) · Y Viajes (no aplica a maquinaria). **Sigue siendo así** tras D140: el clima que se llena ahí es el de la tabla **`fact_jefe`** (la gemela que alimenta `Informe_Mensual`, generada por `Reparto_Produccion_Maquinaria.html` desde la hoja `DATOS` del reporte diario de obra), **no** el de este pegado — el app no captura clima por máquina.
- **Derivaciones del app:** H/I desde la actividad del capataz (05_CATALOGO §1) · R ESTADO desde el motivo (05_CATALOGO §5) · O = prog−oper solo si motivo=Mantenimiento · T en blanco para vibros y actividades de apoyo (D41/D44).
- La hoja MAQUINARIA del Sheets se reordena a este layout A→AA; los internos del app (id_registro, timestamp, reporta, motivo, unidad_prod, etc.) quedan **después de AA** para trazabilidad.
- El panel de producción (2.4/D59-D60) añade un interno más tras AA, `produccion_capataz_orig`, donde guarda el estimado geométrico del capataz (col T original) la primera vez que sustituye la producción por el volumen oficial. El panel parcha la col T (Producción) de filas existentes y, para redirigir producción huérfana (ZODME, no aprovechable), **crea filas nuevas** en MAQUINARIA con el layout A→AA + internos (D52); nunca toca DATA ni BANDEJA.

---

## Autenticación, lecturas por fecha y clasificación de horas (D107–D142)

**Lectura por fecha en dos pasos (D107, sobre `Codigo.gs`).** Los endpoints por fecha ya no leen la hoja entera: `leerFilasPorFecha_` escanea solo la columna `fecha` y trae por bloques contiguos las filas del día (variante por NOMBRE de columna y variante CRUDA por índice para el layout A–T de DATA). Enganchado en `bandeja`, `estado`, `maquinaria_produccion`, `volquetas`, `consolidado` de un día y `debug`; `enviar_data` escanea tres columnas y borra por tramos. Cada respuesta trae `_celdas`. **Escritura quirúrgica:** re-enviar una fecha+área/cuadrilla pisa solo esas filas. NO se aplica a las rutas de escritura genéricas (misma razón que en asistencias, D102).

**Login por hoja `USUARIOS` (D108).** Las contraseñas salieron de `index.html`: viven en la hoja privada `USUARIOS` (`usuario·clave·rol·areas·redirige·estado`), con la clave en hash SHA-256 de `usuario:clave` (`endurecerClaves()`); las valida `POST {action:'login'}`. `estado`≠`activo` bloquea sin borrar la fila. El modo sin señal se conserva con sesión y credencial recordadas (señal una vez por teléfono).

**Token firmado y puerta única (D109).** Al entrar, el backend emite un token con `usuario·rol·áreas` firmado con HMAC-SHA256 (secreto en las Propiedades del Script). `doGet`/`doPost` de los DOS Apps Script lo verifican en una puerta única y **sobrescriben la identidad** con la del token: el resto del código sigue leyendo `usuario` igual pero el cliente ya no se la puede inventar. No caduca por reloj sino por versión (`AUTH_V` saca a todos; `estado` saca a uno) — compatible con la cola offline. En el cliente, `auth.js` envuelve `fetch` y adjunta el token a toda llamada (~60); la cola lo pega al enviar, no al encolar. El secreto es por proyecto: se copia a mano de obra (emisor) a asistencias (verificador).

**Clasificación de horas compartida (D112).** El clasificador de horas se extrajo a `horas-nomina.js`, usado por el Parte de Navision (asistencias) y por la pantalla nueva `horas-persona.html`; el backend manda el crudo y clasifica el cliente, para que no diverjan. Endpoint `GET ?action=persona&codigo=&cedula=&desde=&hasta=` (solo lectura, acotado al área del usuario POR EL BACKEND, corte 11→10, tope 186 días).

**Reglas de horas Dom/Fest y «una persona, una fila» (D113/D115–D118).** D115: `usaFlujoDomFest` decide por fecha el reparto de extras (día normal → E diurna / F nocturna topadas; dom/fest → D hasta el tope y el resto a H). D116/D117/D118 consolidan una fila por persona en el Parte de Navision. D113: el terraplén por material (`crudo de río` / `de UF3`) viaja en la columna interna `actividad`, sin tocar el esquema de ninguna hoja.

**Extras del admin (D142).** Endpoint `GET ?action=persona_admin&desde=&hasta=` — las horas del propio admin desde la hoja `EXTRAS_ADMIN`, solo lectura, con guard por `rol==='admin'` del **token** (`doGet` pone `e.parameter._rol` desde la sesión; un `&_rol=admin` tecleado se pisa). Su reparto vive en `horas-nomina.js` (`clasificarExtraAdmin`), compartido con el Parte. Pantallas: `mis-extras.html` (registro) y la entrada «Mis horas extra» de `horas-persona.html`.

---

## Módulo Parte Digital de Maquinaria (V3-01 / D165) — mismo Sheet y mismo Apps Script, hojas y endpoints propios

Reemplaza al digitador del parte físico de maquinaria. **No toca** BANDEJA/DATA/MAQUINARIA ni los formularios de capataz/chequeadora: convive con el flujo de obra por un canal aparte (con horómetro/kilometraje, porque replica el parte que se factura; la regla «horas directas» del capataz sigue intacta).

```
┌──────────────── tm2.galca.app (GitHub Pages, repo `galca`) ──────────────────────────────┐
│  parte.html?eq=<codigo>      PÚBLICO, sin login. La identidad es el EQUIPO (QR en cabina). │
│      · cabecera fija: código · tipo · placa · medidor (HORÓMETRO | KM | sin medidor)       │
│      · fecha (hasta 7 días atrás, D179) · nº parte físico · operador (buscador) · inicial PRECARGADO con   │
│        el último final · final · total en vivo · hora de/a · CC (buscador: más usados,     │
│        todos, «sin operación») · PR · UF derivada · descripción + sugerencias por tipo ·   │
│        varada/lluvia (plegado) · observaciones                                             │
│      · UN medidor del día + lista de CC (cada uno con % y PR): 1 CC → 1 fila; varios → N   │
│        filas encadenadas, medidor y horas prorrateados, marca [Reparto x % · i/N] ·          │
│        `?demo=1` modo de prueba (sin «+ Otro tramo», decisión del dueño)                    │
│      · «Día sin operación» (domingo · festivo · taller · disponible · lluvia · sin op.)    │
│      · sin `eq` válido → «Escanea el QR de tu equipo» + selector de respaldo               │
│      · solo CREA filas `pendiente`; localStorage guarda el último operador por equipo      │
│      · SIN SEÑAL (D176): offline.js + precache (sw.js v13); ficha del equipo en caché    │
│        local `tm2_cat_parte_<eq>`; envío a la cola `tm2_cola_envios` (tipo 'parte', 📥   │
│        naranja); inicial = final del último parte pendiente del teléfono; dedupe servidor │
│  revision-maquinaria.html   LOGIN: admin · encargado · residente · parte_maquinaria        │
│      · PENDIENTES: fecha, tarjetas con todos los campos editables, alertas en naranja,     │
│        ✓ aprobar / ✕ descartar (con las ediciones), «Aprobar todo lo sin alertas»,         │
│        revisadas del día (reabrir), panel «Equipos sin parte» + «+ manual» (origen=manual) │
│      · BASE: aprobados por rango/equipo/CC/texto, edición por fila, «Copiar para Excel»    │
│        = TSV con las columnas B→AR de BASE MAQUINARIA (vacío donde va fórmula)             │
│  menu.html  grupo «Maquinaria · parte digital» con los dos accesos                         │
└─────────────────────────────────────┬────────────────────────────────────────────────────┘
                                      │ fetch (POST text/plain); revisión con token (auth.js)
                                      ▼
┌──────────────── APPS SCRIPT (misma URL) — backend/CodigoParte.gs ────────────────────────┐
│  doGet:  if(mod==='parte') return parteDoGet_(e)   ← ANTES de la puerta D109 (como tablero)│
│  doPost: if(body.mod==='parte') return parteDoPost_(e, body)  ← ídem (tras `login`)        │
│  GET  ?mod=parte&op=equipo&eq=      PÚBLICO → equipo + último final + operadores + CC +    │
│                                     sugerencias por tipo + topes (UNA llamada)             │
│  POST {mod:'parte',op:'reporte',codigo,tramos:[…],origen?}  PÚBLICO → 1..n filas pendiente │
│        valida (fecha D106, final≥inicial, tope 24 h/700 km, CC/operador/nº parte),         │
│        calcula total y uf, sella alertas: INICIAL_DISTINTO · TOTAL_ALTO · DUPLICADO ·      │
│        CC_INUSUAL · SIN_MEDIDOR · CC_DESCONOCIDO; dedupe por id_registro del cliente;      │
│        origen=manual solo con token de revisor                                             │
│  GET  ?mod=parte&op=bandeja&fecha=  TOKEN+ROL → pendientes, revisadas, faltantes, listas   │
│  POST {mod:'parte',op:'revisar',cambios:[{id_registro,estado?,campos?}]}  TOKEN+ROL →      │
│        escritura QUIRÚRGICA por id_registro (lee esa fila, mezcla, reescribe esa fila)     │
│  POST {mod:'parte',op:'repartir',id_registro,reparto:[{centro_coste,pct,pr?,descripcion_trabajo?}]}│
│        TOKEN+ROL (D178) → original → descartado [Repartido en N filas]; N hijas pendiente  │
│        encadenadas (motor de parteExpandirReparto_), ids <id>-r1…-rN                       │
│  GET  ?mod=parte&op=base&desde=&hasta=[&estado=todos]  TOKEN+ROL → filas + excel.filas     │
│        (B→AR, mapeo PARTE_EXCEL_MAPA) ; rango ≤ 186 días                                   │
│  setupParte()  a mano: crea las hojas, completa columnas, siembra pseudo-CC, formato texto │
│                en PARTE_ITEMS.item / PARTE_CC.centro_coste (D178); idempotente             │
│  depurarOperadoresParte(aplicar)  a mano (D178): aplica PARTE_OPERADORES_ALIAS en la hoja  │
│  Revisan: roles admin·encargado·residente·parte_maquinaria + usuario jeisson (D178)        │
│  D178: ítems/CC en número (2.1) → «02.10» en toda entrada y salida (parteNormItem_/CC_);   │
│        op=equipo → actividades.habituales ≤ 5 (PARTE_MAX_HABITUALES)                       │
└─────────────────────────────────────┬────────────────────────────────────────────────────┘
                                      ▼
┌──────────────── GOOGLE SHEETS (mismo archivo) ───────────────────────────────────────────┐
│  PARTE_EQUIPOS      codigo·tipo·placa·proveedor·medidor·ultima_fecha·ultimo_final·activo   │
│                     (+ultimo_final_manual)  — FICHA del equipo (D173); `activo` = respaldo │
│                     si MAQUINAS está vacía. MAQUINAS: id_maquina·tipo·horas_prog·propiedad·│
│                     fecha_ingreso·fecha_retiro·notas·frente (estancias, D138/D173)         │
│  PARTE_OPERADORES   operador·partes_ult_4_meses·activo                                     │
│  PARTE_CC           centro_coste·proyecto·descripcion_cc·usos_ult_4_meses·activo           │
│  PARTE_ITEMS        tipo_equipo·item·actividad·veces·activo — actividad → ítem por tipo   │
│                     (D174, «máscara» del operador; dueño Jeisson). op=equipo → actividades │
│                     (+ pseudo-CC Taller · Disponible · Domingo/Festivo)                    │
│  PARTE_ACTIVIDADES  tipo_equipo·descripcion_trabajo·veces  (solo sugerencias)              │
│  PARTE_BANDEJA      27 cols: id_registro·timestamp·estado·fecha·codigo·tipo·placa·medidor· │
│                     reporte_num·inicial·final·total·inicial_modificado·horas_varada·       │
│                     horas_lluvia·hora_de·hora_a·descripcion_trabajo·centro_coste·pr·uf·    │
│                     operador·observaciones·alertas·revisado_por·revisado_ts·origen         │
│                     NUNCA se borra una fila: cambia `estado` (pendiente|aprobado|descartado)│
└─────────────────────────────────────┬────────────────────────────────────────────────────┘
                                      │ «Copiar para Excel» → pegar en col B, primera fila libre
                                      ▼
   Partes_Diarios_de_Maquinaria_<periodo>.xlsx · hoja BASE MAQUINARIA (B→AR; el resto fórmula)
```

**Mapeo B→AR (`PARTE_EXCEL_MAPA`, verificar contra el Excel real antes de cerrarlo):** C fecha (dd/mm/aaaa) · E nº parte · F código · M/N inicial/final HORÓMETRO · Q/R horas varada/lluvia · V/W inicial/final KM · AA descripción · AB CC · AD PR · AE UF · AL/AM hora de/a · AQ operador · AR observaciones. Las demás (B, D, G–L, O–P, S–U, X–Z, AC, AF–AK, AN–AP) van vacías: son fórmulas/VLOOKUP desde `EQUIPOS 2` (TOTAL, TIPO, MARCA, consecutivo…). Decimales con coma (convención de `jefe.html`/`digitadora.html`).

**Puesta en marcha:** (1) pegar `backend/CodigoParte.gs` en el proyecto de Apps Script de obra y aplicar las 2 líneas de `Codigo.gs`; (2) `setupParte()`; (3) importar los 4 CSV de `backend/seeds/parte/` (Archivo → Importar → Reemplazar hoja actual); (4) `setupParte()` otra vez; (5) redesplegar (misma URL, nueva versión); (6) `python3 tools/generar_qr.py` con la URL base confirmada → imprimir `qr/etiquetas.pdf` (adhesivo, 7×7 cm) y pegar en cabina; (7) opcional: fila `parte_maquinaria` en `USUARIOS` con `redirige=revision-maquinaria.html`. **Pruebas:** `node backend/pruebas/verificar_v301_parte_digital.js` (backend) y `NODE_PATH=/opt/node22/lib/node_modules node backend/pruebas/verificar_v301_pantallas.js` (Chromium contra el backend en `vm`).

## D166 — Endurecimiento de los dos Apps Script (sep-2026)

Bloque gemelo «ENDURECIMIENTO DEL BACKEND» en `Codigo.gs` y `CodigoAsistencias.gs` (el Parte lo reutiliza). Sin cambios de contrato: mismos endpoints, mismos payloads, misma URL.

```
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│  Petición ──► doGet/doPost: logIniciar_ ──► puerta_(e, body, action)                          │
│                 ├─ sesion_ (D109) ──► inválido: {ok:false, auth:false, error:GENÉRICO}          │
│                 │                       (causa exacta → LOG; excepción: AUTH_SECRETO ausente)   │
│                 ├─ rateLimit_ usuario+action 60/min (login 10/min) ──► {ok:false,error:'rate_limit'}│
│                 └─ validarPayload*_ (tipos·rangos·longitud·fecha no futura)                    │
│                                        ──► {ok:false, error:'payload', campo, detalle}           │
│               ──► action de siempre ──► finally: logEscribir_() = UNA appendRow en hoja LOG     │
│  LOG          fecha_hora · usuario · rol · action · resultado(ok/rechazado/error) · motivo · ms  │
│  Parte (QR)   identidad = código de equipo; 20 envíos/h por equipo, 200/h global; equipo debe   │
│               tener FICHA en PARTE_EQUIPOS → si no {ok:false, error:'equipo'}; no vigente en la  │
│               flota ese día (D173) → se acepta con alerta FUERA_DE_FLOTA (D173b); sin CC pero  │
│               con descripción → alerta SIN_CC (D174) y `op=revisar` no aprueba hasta ponerlo  │
│  Respaldo     respaldoDiario() → Drive Galca_respaldos/TM2_Sur/<prefijo>_<yyyy-MM-dd>, poda 30 d │
│               instalarTriggerRespaldo() → trigger diario 02:00 America/Bogota                    │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Funciones a ejecutar una vez desde el editor** (en cada proyecto): `setupLog()` (obra) / `setupHojas()` (asistencias) · `respaldoDiario()` (la primera vez pide autorizar Drive) · `instalarTriggerRespaldo()`. Después, redesplegar editando la implementación existente. Verificación en banco: `backend/pruebas/verificar_d166_endurecimiento.js`.

## D167 — Endurecimiento del frontend: CSP + `esc()` (sep-2026)

Solo navegador. Ni un endpoint, payload, estilo o texto visible cambió; no exige redespliegue de Apps Script.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  <meta http-equiv="Content-Security-Policy"> en las 23 pantallas + tablero/index.html         │
│    default-src 'self'                                                                          │
│    script-src  'self'                      ← D170: ya SIN 'unsafe-inline' (deuda 2.30 cerrada) │
│    style-src   'self' fonts.googleapis.com    JS/CSS en archivos propios, ver sección D170       │
│    font-src    'self' fonts.gstatic.com                                                        │
│    img-src     'self' data:                ← flecha SVG de los <select> en tema.css            │
│    connect-src 'self' https://api.galca.app     ← D169: el Worker; fuera script.google.com y     │
│                script.googleusercontent.com (la redirección 302 de Google la sigue el Worker)   │
│    manifest-src/worker-src 'self' · base-uri 'self' · form-action 'self' · object-src 'none'   │
│  Excepciones: resumen-asistencia.html (+cdn.jsdelivr.net) y Reparto_Produccion_Maquinaria.html │
│    (+cdnjs.cloudflare.com) cargan SheetJS de un CDN. La página «Sin conexión» de sw.js lleva   │
│    su CSP mínima. frame-ancestors/report-uri no existen en <meta> (GitHub Pages no da cabeceras)│
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  esc(s)  en tema.js (global; & < > " ' → entidades). Copia idéntica en tablero-produccion.html │
│          (no carga tema.js); offline.js la usa con respaldo local (escUI).                     │
│  Regla:  todo texto de la API, de catálogos o tecleado pasa por esc() ANTES de innerHTML.      │
│          Nunca en payloads, WhatsApp, CSV ni portapapeles. En onclick con cadena JS: primero   │
│          replace(/'/g,"\\'") y luego esc(). Las 12 copias locales de esc/escapeHtml se borraron.│
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  sw.js   CACHE_V = tm2-v8 (tema.js está en el precache y los HTML nuevos dependen de esc()).   │
│          D168 → v9 (entra entorno.js) · D169 → v10 (auth.js con la base de la API, primero)    │
│          · D170 → v11 (entran los .js/.css de las 7 pantallas precacheadas + galca-simbolo.svg).│
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

Verificación: banco en Chromium con Apps Script simulado — 24 páginas sin violaciones de CSP ni errores, service worker con `tm2-v8`, cola offline encola sin señal y sincroniza al volver.

**Entorno de prueba (D168):** un SEGUNDO proyecto de Apps Script (copia) por cada uno de los dos, con su propio `SHEET_ID` (Sheet copia), su propio `AUTH_SECRETO` y sin disparadores; sus URLs `/exec` se pegan en el bloque `prueba` de `entorno.js`. Una segunda implementación del MISMO proyecto no aísla nada (mismo `SHEET_ID`, mismas Propiedades). Procedimiento: `docs/OPERACIONES.md`.

## D170 — Marca Galca + CSP sin `'unsafe-inline'` (sep-2026)

Solo navegador. Ni un endpoint, payload, texto visible ni comportamiento cambió; no exige redespliegue de Apps Script.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  img/galca-simbolo.svg   símbolo solo, blanco, sin texto (290 bytes). En el PRECACHE.          │
│  img/galca-logotipo.svg  logotipo horizontal, blanco, «Galca» en trazos (sin Red Hat Display). │
│  tema.css  .galca-simbolo  22×22, máscara CSS sobre currentColor: blanco en oscuro, #0b1f3a en │
│            claro (la cabecera es blanca), #6f7885 con .galca-pie. Primer hijo de .header y     │
│            .header-left{margin-right:auto} para que el usuario siga a la derecha.              │
│            .logout-btn.btn-volver  el «← Menú»/«← Volver» que era un style= en 15 cabeceras.   │
│            + el CSS que offline.js y entorno.js inyectaban en un <style> (chip, panel, PRUEBA). │
│  tablero-produccion.css  .galca-logotipo 84×28 sobre --ink (base clara) + copia del chip PRUEBA│
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  CSP de las 22 pantallas + tablero/index.html: script-src 'self' · style-src 'self' fonts…     │
│  (sin 'unsafe-inline'; resumen-asistencia y Reparto conservan su CDN de SheetJS en script-src) │
│                                                                                              │
│  Cada pantalla:  <link rel="stylesheet" href="<nombre>.css">  (donde estaba su <style>)       │
│                  <script src="<nombre>.js"></script>           (donde estaba su <script>)      │
│                  1ª línea del .js: TM2Estilos.aplicar()  ← data-estilo del marcado, síncrono   │
│  Tablero:        tablero-xlsx.js (SheetJS embebido) + tablero-produccion.js (motor + UI)       │
│                                                                                              │
│  Manejadores     on<evento>="fn(args)"  →  data-on-<evento>="fn(args)"                        │
│  (356)           tema.js escucha click/input/change/mousedown/keydown/keyup/submit en          │
│                  burbuja y focus/blur en captura, recorre del objetivo hacia arriba y ejecuta   │
│                  el atributo con un intérprete SIN eval: lista de llamadas separadas por `;`,   │
│                  `nombre` global (o this.x / event.x), argumentos literales: número, cadena    │
│                  (con \' y \\), true/false/null, JSON {…}/[…], this.value / event.target… │
│                  `event.stopPropagation()` corta el recorrido; `return false` = preventDefault.│
│                  Lo que no cabe en esa gramática se convirtió en función con nombre:           │
│                  irA(url), recargar() (tema.js) · setNotaDia, cerrarModalFondo(event,this),    │
│                  verMasSugs(this,id), setUfFila(this)… (en el .js de su pantalla).             │
│                  Error de gramática → console.error('[tm2 data-on-…]') y NO se ejecuta nada.   │
│                                                                                              │
│  Estilos         style="…" estático y decorativo  →  clase (u-mt10, u-w360, u-textarea…)      │
│  (411)           style="…" dinámico o que el JS enciende/apaga  →  data-estilo="…"             │
│                  tema.js lo aplica por CSSOM (el.style) al entrar el nodo (MutationObserver)   │
│                  y solo rellena propiedades que el JS no haya fijado ya: `el.style.display=   │
│                  'block'` tras un innerHTML sigue ganando, igual que ganaba al atributo.        │
│                  el.style.cssText / el.style.x = … (tablero, pantallas) siguen permitidos.     │
│                                                                                              │
│  <style> en línea que quedan: OFFLINE_HTML de sw.js y tablero/index.html → 'sha256-…' en su   │
│  propia CSP. Cambiar una letra de ese CSS obliga a recalcular el hash (comentario en sw.js).   │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  sw.js  CACHE_V = tm2-v11. PRECACHE += index/seleccion-reporte/menu/reporte-capataz/           │
│         reporte-chequeadora/reporte-drenajes/asistencia .js y .css + img/galca-simbolo.svg.    │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

Verificación (banco en Chromium con la API simulada): 22 páginas sin violaciones de CSP ni errores;
precache completo de `tm2-v11`; login por clic y por Enter; `addLinea()` por `data-on-click`; cola
offline: encola sin señal (chip «Sin señal 1 pendiente»), sincroniza al volver, panel con Copiar /
Descartar / Reintentar / Cerrar; navegación sin señal a `seleccion-reporte.html` desde caché con
símbolo y tema; tema claro/oscuro; tablero con logotipo, barras y filtro UF; página «Sin conexión»
con su CSS por hash.

**Rutas sin `.html` — evaluadas y descartadas (D170, backlog 2.33).** GitHub Pages resuelve `/menu`
→ `menu.html`, pero el SW sirve por URL exacta y los HTML se refrescan antes que el SW: durante la
transición un teléfono con enlaces nuevos y SW viejo se quedaría sin pantalla al perder la señal.
Además `redirige` vive en la hoja USUARIOS, los QR de las cabinas apuntan a `parte.html?eq=` y
`manifest.json`/`OFFLINE_HTML` asumen `.html`.

## D169 — Worker de Cloudflare `api.galca.app`: proxy único delante de los tres Apps Script (sep-2026)

Las URLs `/exec` de Google salen del código público. El frontend conoce UNA base (`auth.js`) y el Worker
reenvía. No exige redesplegar Apps Script; sí `wrangler deploy` + publicar Pages (`docs/OPERACIONES.md` §7–§9).

```
 tm2.galca.app (GitHub Pages)                    api.galca.app (Cloudflare Worker, worker/src/index.js)          Google
 ┌──────────────────────────────┐   fetch        ┌──────────────────────────────────────────────────────┐
 │ auth.js   API_BASE + rutas   │ ─────────────▶ │ 1 CORS   Origin ∈ {https://tm2.galca.app, localhost} │
 │           (ÚNICO sitio)      │  GET  ?token=  │          otro → 403 · sin Origin (curl) → pasa       │
 │ entorno.js GALCA_ENV.url =   │  POST {token}  │ 2 Rate limit 120/min por IP (binding ratelimit) → 429│
 │   base + '' | '/prueba'      │  text/plain    │ 3 Token PRESENTE (no firma):                          │
 │ pantallas  GALCA_ENV.url.*   │                │     /obra, /asistencias → 401 si falta,               │    secretos
 │ offline.js resuelve la URL   │                │       salvo action=login · action=tablero (D161)      │  OBRA_URL ───▶ Codigo.gs (+CodigoParte.gs)
 │   de cada ítem AL ENVIAR     │                │     /parte → sin token (QR, D165)                     │  ASISTENCIAS_URL ─▶ CodigoAsistencias.gs
 │ CSP connect-src api.galca.app│ ◀───────────── │ 4 Reenvía método + query intacta + cuerpo byte a byte │  PARTE_URL ──▶ Codigo.gs (?mod=parte)
 └──────────────────────────────┘  status + JSON │   redirect:follow (302 → googleusercontent)           │  *_PRUEBA_URL ─▶ copias D168 (opcional, 503 si falta)
                                   no-store+CORS │   sin cookies, sin caché, cuerpo ≤ 1 MB               │
                                                 └──────────────────────────────────────────────────────┘
 Errores con la MISMA forma que el backend (D166): 401 {ok:false, auth:false, error:'Sesión no válida…'} · 429 {ok:false, error:'rate_limit'}
 Rollback (una edición): auth.js bloque API → base:'' + URLs /exec en rutas; CSP con los hosts de Google. La cola offline se re-dirige sola.
```

Verificación: banco en Node del Worker (41/41, Google simulado), 21 pantallas en Chromium sin errores ni violaciones de CSP con toda llamada bajo `api.galca.app` y con token (salvo `tablero`/`parte`), `verificar_v301_pantallas.js` 60/60.

## D171 — Recorte de equipos en el reporte del capataz (sep-2026)

**Qué cambió.** El capataz solo **asocia códigos de máquina** a cada actividad; no captura horas, operador, motivo ni horas programadas/muertas. Esos datos entran por el Parte Digital (D165) y se revisan en `revision-maquinaria.html`. La asociación es informativa (cruce y trazabilidad, `id_cantidad` ↔ BANDEJA), no alimenta producción ni horas por máquina.

```
reporte-capataz.html ──?action=maquinas&fecha=──> Codigo.gs.maquinasCatalogo
   (flota.js: TM2Flota.cargar → equiposCapataz)     ├─ maquinas: hoja MAQUINAS vigentes ese día, SOLO tipos de producción — chequeadora/encargado/prod.
   chips por código, búsqueda, agrupado por tipo    └─ equipos:  vigentes ese día en MAQUINAS (frente UF1-UF2) + ficha PARTE_EQUIPOS — capataz (D171/D173)
   caché del teléfono (D82) → respaldo escrito en la pantalla si nunca hubo señal
POST {reporte, cantidades:[{…, equipos:[{id_registro,id_maquina,tipo_equipo} | 'CR026', …]}]}
   → guardarReporte: 1 fila MAQUINARIA por equipo: B fecha · D proyecto · E id_maquina · H/I derivadas ·
     T producción (largo de la línea; vacía para tipos sin producción) · AA observación · internos
     app_id_registro · id_cantidad · timestamp · reporta · app_tipo_equipo · unidad_prod · cap_actividad · a_captura · area.
     G · L · O · R · app_horas_programadas · app_horas_muertas · motivo = '' (vacías desde D171).
   Payload viejo (cola offline con horas/operador/motivo) → aceptado; campos descartados en silencio.
```

- **Ficha = `PARTE_EQUIPOS`; estancias = `MAQUINAS` (D173).** `MAQUINAS` es la flota COMPLETA (pesada + transporte + luminarias) con `frente`; el parte espera a los vigentes del día (`flotaEnFecha_(fecha,{todos:true,frentes:PARTE_FRENTES})` en `parteEquiposActivos_(fecha)`), con respaldo a `activo` si la hoja está vacía. `flota_guardar` acepta además `frente · placa · proveedor · medidor` y escribe la ficha en `PARTE_EQUIPOS` (`fichaParteAsegurar_`); `?action=flota` devuelve `tipos_produccion · frentes · frentes_parte` y, por estancia, `frente · placa · medidor · con_ficha`. `op=equipo` devuelve `en_flota` y un selector con los vigentes primero; `op=reporte` añade la alerta `FUERA_DE_FLOTA` cuando el equipo no está vigente ese día (D173b).
- **Lectores tolerantes:** `bandeja`, `estado`, `maquinaria_produccion`, `encargado.html` y `produccion-maquinaria.html` trabajan con celdas de horas vacías (filas nuevas) y con horas (filas viejas) mezcladas.
- **`estado.html` obsoleto:** aviso arriba que remite a «Equipos sin parte» de `revision-maquinaria.html`; en `menu.html` como «Estado maquinaria (capataz, obsoleto)». No se borra.
- **`sw.js` → `tm2-v12`** (flota.js cambió y el formulario nuevo depende de `equiposCapataz`).
- Verificación: `backend/pruebas/verificar_d171_recorte_equipos.js`.

## D139 — Endpoints de la Flota (`MAQUINAS`)

- `GET ?action=flota&fecha=` — SOLO LECTURA: estancias + los `avisos` de la hoja (distinto de `?action=maquinas`, que sirve la flota del día para la captura).
- `POST {action:'flota_guardar', op:'alta'|'baja'|'corregir', …}` — escribe la hoja `MAQUINAS` desde la pestaña **Flota** de `produccion-maquinaria.html`; **rol verificado en el SERVIDOR** (D109), `fdateValida_` (D106), rechazo de clave duplicada (`id_maquina`+`fecha_ingreso`) y de estancias traslapadas, e invalidación de las DOS memorias (`invalidarHoja_` y `_flotaRows`). Accesos: admin/residente editan las dos pestañas; `jeisson` solo Flota; `jefe` en solo lectura.

## D158 — Tablero de producción (`tablero-produccion.html`)

Un solo HTML (SheetJS embebido + motor + foto de datos embebida) que reemplaza la hoja GRAFICOS del Excel; lo ven **admin, jefe y los dos residentes** (la opción de Maquinaria sale del panel del jefe). Los archivos son `tablero-xlsx.js` + `tablero-produccion.js` y la subcarpeta `tablero/` (con su propia CSP por hash).

- **Foto de datos COMPARTIDA (no per-navegador):** vive en el Sheet por el mismo Apps Script. `GET ?action=tablero` la lee (**pública, sin token** — el Worker la exceptúa, D169) y `POST {action:'tablero_guardar'}` la publica (troceada en celdas de 40.000 con prefijo `~`). **Publican solo admin y jefe**, decidido por el SERVIDOR con el token firmado (D109).
- Al abrir, la página pinta con lo que trae embebido y sincroniza en segundo plano: nunca hay pantalla en blanco delante de una sala.
- **Standby / utilización por máquina** = días con parte × horas programadas − mantenimiento − paradas de taller (la lluvia no se resta). Definiciones finales de las métricas en D162; avance en D163.
- Requiere redesplegar el Apps Script (endpoints `tablero` / `tablero_guardar`). Verificación `backend/pruebas/verificar_d158_tablero_foto.js`.

## D217 — Resumen ejecutivo por rango (`resumen-ejecutivo.html`)

- `GET ?action=resumen_ejecutivo&desde=&hasta=` (token; admin, jefe, residente, residentes de drenajes; rango ≤ 366 días) → `{ok, desde, hasta, anterior, datos_hasta, indicadores, texto}`. Módulo `worker/src/api/obra/resumen_ejecutivo.js`; solo con `BACKEND_OBRA=db`.
- Indicadores: partidas principales con `sumaPorDia_` (`pliegue.js`, igual que el Tablero; excavación = `exc`), plan de `proy_plan` prorrateado por días calendario del periodo 16→15, avance D163, clima (D182), horas de lluvia/varada de `tablero_horas` si existen, drenajes ODT/ODL y otras actividades de DATA, periodo anterior de igual duración.
- Texto: `worker/src/api/obra/resumen_texto.js` (puro): `redactarResumen` con los umbrales en constantes únicas (1,00 · 0,75 · lluvia 0,25) y `validarNumerosTexto`.
- `POST {action:'resumen_ejecutivo_ia', desde, hasta}`: recalcula en el servidor y llama `env.AI.run` (binding `[ai]` de `wrangler.toml`, Workers AI, modelo en la constante `IA_MODELO`). Sin binding, con error, sin cupo o con una cifra no verificable → `{ok:true, ia:false, texto:<reglas>, aviso}`.
- Verificación: `backend/pruebas/verificar_resumen_ejecutivo.js`; casos `obra.resumen_ejecutivo*` en `backend/pruebas/contrato/casos_obra.js` (corren con `worker/pruebas/contrato_local.js`).
