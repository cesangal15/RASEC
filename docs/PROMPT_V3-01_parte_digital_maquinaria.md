# PROMPT PARA CLAUDE CODE — Módulo "Parte Digital de Maquinaria" (V3-01)

Eres el desarrollador del Sistema de Reporte Diario de Obra TM2 Sur (GitHub Pages + Google Apps Script + Google Sheets). Vas a construir un módulo NUEVO que reemplaza al digitador de partes de maquinaria. No modifiques el flujo existente (reporte-capataz, reporte-chequeadora, encargado, BANDEJA, DATA, MAQUINARIA): este módulo convive con él y usa hojas y endpoints propios.

Lee primero `PROJECT_CONTEXT.md` y `02_REGISTRO_DECISIONES.md` del repo. Respeta todas las decisiones cerradas (D01–D36 y posteriores). Este módulo NO cambia la regla "horas directas sin horómetro" del reporte del capataz: es un canal distinto, con horómetro/kilometraje, porque replica el parte físico que se factura.

---

## 1. Qué reemplaza

Hoy un digitador transcribe ~60 partes de papel al día (40–50 equipos, 64 códigos, ~60 operadores rotativos) a la hoja `BASE MAQUINARIA` del Excel `Partes_Diarios_de_Maquinaria_<periodo>.xlsx`. De 49 columnas solo digita 11; el resto son fórmulas/VLOOKUP desde la hoja `EQUIPOS 2`. El parte en papel SE MANTIENE como respaldo; el digital lo transcribe desde la cabina.

Columnas de entrada humana (en el orden del Excel, letra de columna entre paréntesis):

| Campo | Col | Notas |
|---|---|---|
| FECHA | C | fecha del parte |
| REPORTE | E | nº del parte físico (texto) — OBLIGATORIO |
| COD. EQUIPO | F | viene de la URL |
| INICIAL / FINAL (horómetro) | M / N | equipos con medidor HOROMETRO |
| HORAS VARADA / HORAS LLUVIA | Q / R | opcionales |
| INICIAL2 / FINAL2 (kilometraje) | V / W | equipos con medidor KM (volquetas, camiones, cisternas, camabajas, tractocamiones) |
| DESCRIPCIÓN DEL TRABAJO | AA | texto libre + sugerencias |
| CENTRO DE COSTE | AB | lista |
| PR | AD | número (ej. 14400 = PR14+400) |
| UNIDAD FUNCIONAL | AE | 1 / 2 / 3, derivada del CC (3701→1, 3702→2, 3703→3), editable |
| DE / A (hora) | AL / AM | hora inicio/fin del tramo |
| OPERADOR | AQ | lista |
| OBSERVACIONES | AR | texto libre |

Un equipo puede tener 2+ tramos el mismo día cuando cambia de centro de coste (27 % de los equipo-día). Cada tramo = 1 fila.

---

## 2. Principios de diseño (cerrados por el usuario)

1. **Sin usuarios ni contraseñas para operadores.** La identidad la da la MÁQUINA: cada equipo tiene un link con su código en la URL, impreso como QR en la cabina. El personal rota; el equipo no.
2. **El formulario público solo puede CREAR filas en estado `pendiente`.** Nunca edita, borra ni aprueba. Todo error se corrige en revisión.
3. **Revisión con login existente** (roles `encargado`, `admin` y el usuario nuevo de D116). Varias personas revisan.
4. **Validación al capturar**, no al día siguiente: el medidor inicial se precarga del último registro del equipo y el total se calcula en vivo.
5. **Alquilados y propios por el mismo canal.** Los alquilados usan el mismo código de equipo que ya aparece en el Excel.
6. **Traspaso al Excel por copy-paste**, nunca escritura directa al .xlsx. La vista "Base" exporta las columnas de entrada en el orden exacto de `BASE MAQUINARIA` (celdas vacías donde van fórmulas).
7. Estilo visual: el existente (tema oscuro, DM Sans/Syne, acento naranja #f5a623). No rediseñar.

---

## 3. Hojas nuevas en el mismo Google Sheet (ID 1OEAZCcj_kgVS6jWXxOSgyvm57sOsJ7fA1mRTJPU-icM)

**`PARTE_EQUIPOS`** (catálogo; se siembra con `PARTE_EQUIPOS_semilla.csv`):
`codigo, tipo, placa, proveedor, medidor (HOROMETRO|KM), activo (SI|NO), ultimo_final_manual` (solo para arrancar el primer día si no hay historial en la hoja).

**`PARTE_OPERADORES`**: `operador, activo`. Siembra: `PARTE_OPERADORES_semilla.csv` (nombres ya normalizados; el usuario depurará duplicados tipo "Aleyxer Rincon/Aleixer Lizarazo" — no los fusiones tú).

**`PARTE_CC`**: `centro_coste, proyecto, descripcion_cc, activo`. Siembra: `PARTE_CC_semilla.csv`. Incluir además los pseudo-CC de uso real: `Taller`, `Disponible`, `Domingo/Festivo`.

**`PARTE_ACTIVIDADES`**: `tipo_equipo, descripcion_trabajo` — solo para autocompletar sugerencias por tipo de equipo. Siembra: `PARTE_ACTIVIDADES_frecuentes.csv`.

**`PARTE_BANDEJA`** (todas las filas capturadas, nunca se borran):
`id_registro, timestamp, estado (pendiente|aprobado|descartado), fecha, codigo, tipo, placa, medidor, reporte_num, inicial, final, total, inicial_modificado (SI/NO), horas_varada, horas_lluvia, hora_de, hora_a, descripcion_trabajo, centro_coste, pr, uf, operador, observaciones, alertas (texto separado por ;), revisado_por, revisado_ts, origen (qr|manual)`.

Columna `alertas` la llena el backend al recibir (ver §5).

---

## 4. Pantallas nuevas (GitHub Pages)

### `parte.html` — formulario público (sin login)
- Lee `?eq=CODIGO` de la URL. Sin `eq` válido → pantalla "Escanea el QR de tu equipo" con un selector de código como fallback.
- Cabecera fija: código, tipo, placa (desde `PARTE_EQUIPOS`).
- Campos, en este orden, pensados para celular con guantes: fecha (default hoy, permite ayer), nº de parte físico, operador (lista con búsqueda, ~60 nombres), **medidor inicial** (precargado = último `final` del equipo en `PARTE_BANDEJA` no descartado; si el operador lo cambia, se marca `inicial_modificado=SI`), **medidor final**, total calculado en vivo, hora de / a, centro de coste (lista; muestra `descripcion_cc`), PR, UF (derivada del CC, editable), descripción del trabajo (texto libre con sugerencias de `PARTE_ACTIVIDADES` filtradas por tipo), horas varada / lluvia (colapsadas, opcionales), observaciones.
- Botón **"+ Otro tramo"**: duplica la sección con el `inicial` = `final` del tramo anterior y hora_de = hora_a anterior. Cada tramo se envía como fila separada con el mismo `reporte_num`.
- Botón "Día sin operación" (domingo/festivo/taller/disponible): manda una fila con inicial=final, CC pseudo, descripción = motivo. Así el equipo queda "reportado" y no aparece como faltante.
- Validaciones cliente (bloquean el envío): final ≥ inicial; total HOROMETRO ≤ 24; total KM ≤ 700; CC y operador obligatorios; nº parte obligatorio.
- Al enviar: confirmación grande con resumen y opción "Reportar otro tramo". Guardar en `localStorage` solo el último operador elegido para ese equipo (conveniencia; no es identidad).

### `revision-maquinaria.html` — revisión (login; roles encargado/admin/usuario D116)
Dos vistas en pestañas:
1. **Pendientes**: filtro por fecha (default hoy); tarjetas o filas con todos los campos, alertas resaltadas en naranja; toggles ✓ aprobar / ✕ descartar; edición inline de cualquier campo antes de aprobar; botón "Aprobar todo lo sin alertas". Panel lateral "Equipos sin parte hoy" (activos en `PARTE_EQUIPOS` sin fila del día) con botón "+ Agregar manual" (crea fila con `origen=manual`).
2. **Base**: tabla de todo lo aprobado, filtrable por rango de fechas / equipo / CC / operador, editable (edición reescribe la fila, queda `revisado_por`/`revisado_ts`). Botón **"Copiar para Excel"** que copia al portapapeles las filas del rango como TSV con EXACTAMENTE las columnas B→AR de `BASE MAQUINARIA` (vacío en columnas de fórmula), listo para pegar en la primera fila libre. Columna B (`Columna1`) y Z–AC… se dejan vacías; verificar contra el Excel real antes de cerrar el mapeo.

### `menu.html`
Agregar los dos accesos en el hub de admin (grupo "Maquinaria"). No tocar el resto.

---

## 5. Backend (Apps Script)

Crear `CodigoParte.gs` en el mismo proyecto de Apps Script (misma URL de despliegue). Enrutar en `doGet`/`doPost` existentes por parámetro `mod=parte` sin alterar los endpoints actuales.

Endpoints:
- GET `mod=parte&op=equipo&eq=` → datos del equipo + último final + listas (operadores, CC, sugerencias por tipo). Una sola llamada para poblar el formulario.
- POST `mod=parte&op=reporte` → inserta 1..n filas `pendiente`. Calcula `total`, `uf` si viene vacío y `alertas`:
  - `INICIAL_DISTINTO` si inicial ≠ último final registrado del equipo.
  - `TOTAL_ALTO` si total > 12 h (HOROMETRO) o > 400 km (KM).
  - `DUPLICADO` si ya existe fila del mismo equipo+fecha+hora_de.
  - `CC_INUSUAL` si el CC no aparece en el historial reciente del equipo (últimos 30 días).
  - `SIN_MEDIDOR` si equipo activo sin `medidor` definido.
- GET `mod=parte&op=bandeja&fecha=` → pendientes + faltantes del día (requiere token).
- POST `mod=parte&op=revisar` → cambia estado / edita campos (requiere token; escritura quirúrgica por `id_registro`, no reescribir la hoja).
- GET `mod=parte&op=base&desde=&hasta=` → aprobados del rango en el orden de columnas de `BASE MAQUINARIA` (requiere token).

Invariantes obligatorias (no negociables):
- Fechas por duck-typing (`typeof v.getFullYear === 'function'`), NUNCA `instanceof Date`.
- POST con `Content-Type: text/plain` desde el front.
- Redespliegue editando la implementación existente (misma URL), nueva versión.
- Auth de revisión: el mismo token firmado que ya usa el sistema (ver decisiones D107+).

---

## 6. Códigos QR

Crear `tools/generar_qr.py`:
- Lee `PARTE_EQUIPOS_semilla.csv` (o exporta la hoja `PARTE_EQUIPOS`), filtra `activo=SI`.
- Para cada equipo genera `qr/<codigo>.png` con la URL `https://<usuario>.github.io/<repo>/parte.html?eq=<codigo>` (URL base como constante al inicio del script; la confirma el usuario).
- Genera además `qr/etiquetas.pdf`: hoja carta con etiquetas de 7×7 cm, cada una con el QR, el código en grande (Syne bold), tipo y placa, fondo blanco con borde negro (van impresas en adhesivo y pegadas en cabina; deben ser legibles con mugre).
- Dependencias: `qrcode[pil]`, `reportlab`. Incluir instrucción `pip install`.

Un QR es solo la URL codificada en imagen; el teléfono la abre con la cámara. No necesita cuenta, servicio ni impresora especial.

---

## 7. Entregables

1. `parte.html`, `revision-maquinaria.html`, `menu.html` actualizado — archivos completos listos para subir a GitHub Pages.
2. `CodigoParte.gs` completo + el diff mínimo en `Codigo.gs` para el enrutado `mod=parte`.
3. Script/instrucciones para crear las 5 hojas y sembrarlas desde los 4 CSV (puede ser una función `setupParte()` en Apps Script que cree hojas y cabeceras; los CSV los importa el usuario con "Importar").
4. `tools/generar_qr.py` + carpeta `qr/` de ejemplo con 3 equipos.
5. Actualización de `02_REGISTRO_DECISIONES.md` (nueva decisión: módulo Parte Digital, identidad por equipo, bandeja propia, traspaso copy-paste) y `03_BACKLOG.md` (V3-01 en curso) y `04_ARQUITECTURA.md` (hojas y endpoints nuevos).

---

## 8. Verificación antes de entregar

- Abrir `parte.html?eq=VOL048`: precarga tipo/placa/medidor KM, último final; enviar 2 tramos (CC 3701.02.11 y 3702.02.11) y comprobar 2 filas `pendiente` con `total` correcto.
- Abrir `parte.html?eq=CR026` (HOROMETRO) y enviar un final < inicial: debe bloquear.
- Enviar un inicial distinto al último final: debe llegar con alerta `INICIAL_DISTINTO`.
- En revisión: aprobar, editar un PR, descartar; verificar que solo cambia la fila tocada (escritura quirúrgica).
- "Copiar para Excel": pegar en una copia del Excel y confirmar que TOTAL, TIPO, MARCA y consecutivo se calculan solos con las fórmulas existentes.
- El usuario validará con partes reales de una semana antes de dar nada por cerrado.

## 9. Lo que NO debes hacer

- No inventar funciones fuera de este alcance (consumos de diésel, valor hora, telemetría, WhatsApp). Si surge algo, anótalo como V3-02+.
- No tocar BANDEJA, DATA, MAQUINARIA ni los formularios de capataz/chequeadora.
- No escribir en el .xlsx.
- No fusionar nombres de operadores parecidos por tu cuenta.
