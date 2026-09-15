# TM2 Sur — Modo sin conexión (D82)

Los reportes de campo (**capataz, chequeadora, drenajes, asistencia** y, desde D176, el **parte digital de
maquinaria** que el operador abre por QR) funcionan **sin señal**:
la app abre desde el ícono, el formulario se llena normal y el envío queda **guardado en el
teléfono** hasta que vuelva la señal. Los paneles de revisión (encargado, residente, jefe,
resúmenes) **siguen necesitando conexión** — sin señal muestran un aviso, no una pantalla rota.

---

## 1. Instalar la app en el celular

### Android (Chrome)

1. Abrir `https://tm2.galca.app/` en **Chrome** (con señal).
2. Tocar el menú **⋮** (arriba a la derecha).
3. Tocar **"Agregar a pantalla de inicio"** (en algunos teléfonos dice **"Instalar app"** o
   Chrome muestra solo un aviso de instalación).
4. Confirmar. Aparece el ícono **TM2 Sur** (naranja sobre fondo oscuro) en la pantalla de inicio.
5. Abrir la app **desde ese ícono** de ahora en adelante.

### iPhone (Safari — obligatorio)

> En iOS la instalación **solo funciona desde Safari** (no desde Chrome ni la app de Google).

1. Abrir la dirección del sistema en **Safari** (con señal).
2. Tocar el botón **Compartir** (el cuadrado con la flecha hacia arriba).
3. Bajar y tocar **"Agregar a inicio"** ("Add to Home Screen").
4. Confirmar. Abrir siempre desde el ícono **TM2 Sur**.
5. **Usar la app a diario**: en iPhone, si una app web pasa semanas sin abrirse, el sistema puede
   desalojar su almacenamiento (se perdería la copia offline y habría que abrirla con señal de
   nuevo). El uso diario normal lo evita.

### Instrucción operativa clave (para todo el mundo)

📶 **Abrir la app al menos una vez CON señal después de cada aviso de actualización** (cuando el
residente/admin avise que "se subió una versión nueva"). Con señal, la app se actualiza sola al
abrirla; esa copia fresca es la que después funciona sin señal en el frente.

Lo mismo aplica a los **catálogos**: la pantalla de drenajes (marcadores/ítems), la de chequeadora
(cubicaje), la de asistencia (roster de la cuadrilla) y el **parte de maquinaria** (ficha del equipo:
último medidor, operadores, actividades) guardan una copia local **la última vez que abrieron con
señal**. Abrirlas con señal de vez en cuando mantiene esa copia al día.

📶 **Parte de maquinaria (D176):** cada equipo guarda SU ficha en el teléfono desde el que se escanea
su QR. La primera vez que un teléfono abre el parte de un equipo tiene que ser **con señal**; desde
ahí, ese teléfono puede reportar ese equipo sin señal. Sin copia guardada la pantalla lo dice
(«abre el parte una vez con señal»), no falla en silencio.

---

## 2. El chip de señal (arriba en cada pantalla)

| Chip | Significado |
|---|---|
| 🟢 **Con señal** | Hay conexión: los envíos van directo al servidor (confirmación **verde**). |
| 🟠 **Sin señal** | Sin conexión: los envíos se guardan en el teléfono (confirmación **naranja** 📥). |
| 🟠 **N pendientes** | Hay N envíos guardados esperando señal. Tocar el chip abre la lista. |

- **Verde ✅ "Reporte enviado"** = el servidor lo recibió y lo confirmó. Listo.
- **Naranja 📥 "Guardado en el teléfono"** = todavía **NO** está en el servidor; subirá solo
  cuando vuelva la señal. No hace falta hacer nada más, pero **no borres los datos del navegador**
  mientras haya pendientes.
- Al volver la señal, la cola sube sola (también cada 60 s y al abrir cualquier pantalla). Cuando
  termina aparece el aviso verde "✓ N reportes subidos al servidor".
- En la lista de pendientes cada envío tiene **"Copiar texto"** (respaldo manual: pega el contenido
  en WhatsApp si un envío nunca logra subir) y **"Descartar"** (borra el envío para siempre; pide
  doble confirmación — usarlo solo con instrucción del residente/admin).
- Reenviar un reporte que "quizá ya llegó" **no duplica filas**: el servidor reconoce los reenvíos
  (dedupe por `id_registro`) y responde éxito.

---

## 3. Checklist de pruebas guiadas (validar en campo antes de cerrar D82)

> Hacerlas en un celular real, con la app ya instalada y abierta al menos una vez con señal.

- [ ] **(a) Modo avión ANTES de abrir** → la app abre desde el ícono (tema y fuentes correctos),
      el login funciona, el capataz llena su reporte y envía → aparece el mensaje **naranja 📥
      "Guardado en el teléfono"** (no el verde) y el chip marca "1 pendiente".
- [ ] **(b) Quitar modo avión** → sin tocar nada, en menos de ~1 min sube solo: toast verde
      "✓ 1 reporte subido al servidor", el contador de pendientes desaparece, y en la hoja
      **BANDEJA hay UNA sola copia** de las filas (ni cero ni dos).
- [ ] **(c) Enviar con señal normal** → comportamiento idéntico al de siempre: confirmación verde
      inmediata con los conteos del servidor.
- [ ] **(d) Reenviar a mano el mismo payload** (repetir el POST con los mismos `id_registro`) →
      la respuesta trae `duplicadas` > 0 y `guardadas` = 0, y **cero filas nuevas** en las hojas.
- [ ] **(e) Desplegar un cambio de texto en un HTML** (GitHub Pages) → con señal, el celular lo ve
      de inmediato al recargar (network-first; NO hace falta subir `CACHE_V`).
- [ ] **(f) Sin señal, abrir un panel de revisión** (encargado/residente/jefe/resúmenes) → muestra
      la página "Esta pantalla necesita conexión" con el estilo del tema, no un error del navegador.
- [ ] **(g) Asistencia sin señal** → roster desde la copia local (banner con la fecha de la copia),
      envío encolado naranja; al volver la señal, el día+cuadrilla queda con el contenido del
      **último** envío (upsert idempotente, sin duplicados).
- [ ] **(h) Parte de maquinaria sin señal (D176)** → abrir el QR del equipo con señal una vez; luego
      en modo avión: la pantalla abre con el banner «usando la ficha guardada del DD/MM», el inicial
      viene precargado, se envía → **naranja 📥 «Parte guardado en el teléfono»**; un segundo parte
      del mismo equipo arranca del final del primero (pendiente). Al volver la señal suben solos y en
      **PARTE_BANDEJA** hay UNA fila por parte (sin `INICIAL_DISTINTO` en el segundo).

---

## 4. Notas técnicas (para quien mantiene el sistema)

- **Cola:** `localStorage` clave `tm2_cola_envios` (módulo `offline.js`, objeto global
  `TM2Offline`). FIFO; un ítem solo sale por éxito confirmado del servidor (`ok:true`) o descarte
  manual con doble confirmación. La cola **no** se borra al cerrar sesión.
- **Sesión:** `{usuario, rol}` ahora en `localStorage` (todas las páginas; D82). El parte de maquinaria
  no tiene sesión (público por QR): en la cola su ítem lleva `tipo:'parte'` y `usuario` = `<código> · <operador>`,
  solo informativo; `TM2Offline.pendientes(filtro)` devuelve una copia de solo lectura de la cola y
  `parte.js` la usa para precargar el inicial con el final del último parte pendiente del equipo.
- **Dedupe:** `id_registro` UUID **de cliente** en cada fila de BANDEJA / MAQUINARIA / VOLQUETAS
  y de PARTE_BANDEJA (D165/D176); `Codigo.gs` / `CodigoParte.gs` saltan filas ya guardadas y responden
  `{guardadas, duplicadas}`. Payload sin ids (frontend viejo) = comportamiento anterior intacto.
  **Asistencia no lleva UUID:** `CodigoAsistencias.gs` pisa fecha+cuadrilla (upsert idempotente,
  verificado).
- **Service worker (`sw.js`):** network-first para lo propio; precache explícito del shell +
  capturas; fuentes de Google cache-first; **jamás** intercepta `script.google.com`. Subir
  `CACHE_V` **solo** cuando cambie la LISTA de precache (agregar/quitar archivo); los cambios de
  contenido se refrescan solos con señal. Excepción (D167, `tm2-v8`): si un archivo del precache
  cambia de forma que los HTML nuevos DEPENDEN de él (p. ej. `esc()` en `tema.js`), también se sube,
  para que un teléfono sin señal no mezcle HTML nuevo con JS viejo.
- **Redeploy backend:** editar implementación → nueva versión (misma URL), como siempre. Los
  endpoints de recepción deben mantener **retrocompatibilidad de payload**: un envío encolado por
  una versión vieja del frontend debe seguir siendo aceptado (regla D82).
