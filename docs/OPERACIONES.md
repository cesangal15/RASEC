# OPERACIONES — entorno de PRUEBA (D168) y Worker `api.galca.app` (D169)

Dos cosas: (§1–§6) cómo tener una segunda copia del sistema (Sheets + Apps Script) para ensayar
cambios sin tocar los datos de la obra; (§7–§9) cómo desplegar el Worker de Cloudflare que está
delante de los Apps Script, cómo darle el dominio `api.galca.app` y cómo volver atrás.

## 1. Cómo funciona

- **Desde D169 el frontend no conoce ninguna URL de Google.** La única URL del frontend es la base
  del Worker, `https://api.galca.app`, en **`auth.js`** (`TM2Auth.API_BASE`). `entorno.js` arma
  sobre ella la global **`GALCA_ENV.url`** (`obra` / `asistencias` / `parte`) con dos juegos:
  `produccion` (`/obra`, `/asistencias`, `/parte`) y `prueba` (`/prueba/obra`, …). Cada pantalla
  toma su URL de ahí; ya no hay URLs cableadas en los HTML ni en `entorno.js`. Las URLs `/exec`
  de Google —de producción y de prueba— son **secretos del Worker** (§7).
- **Activar prueba:** abrir cualquier pantalla con `?env=prueba`, por ejemplo
  `https://tm2.galca.app/index.html?env=prueba`. Queda guardado en el navegador (localStorage
  `galca_env`), así que desde ahí TODAS las pantallas de ese navegador van contra prueba aunque
  el parámetro no vaya en la URL (menú → capataz → encargado…).
- **Volver a producción:** `?env=produccion` (o `?env=prod`) en cualquier pantalla. También vale
  borrar la clave `galca_env` del localStorage o, desde la consola, `GALCA_ENV.cambiar('produccion')`.
- **Indicador:** con prueba activo aparece un chip rosa **PRUEBA** junto al título de la cabecera
  (en el login, el tablero y el reparto, que no tienen esa cabecera, va fijo arriba en el centro),
  la pestaña se titula «PRUEBA · …» y `<html>` lleva `data-entorno="prueba"`.
- **Al cambiar de entorno se cierra la sesión** (`tm2_token`, `usuario`, `rol`, `areas`): cada
  backend firma sus tokens con su propio secreto, así que hay que volver a entrar. Es a propósito:
  un token de producción nunca sirve en prueba ni al revés.
- **Si el Worker no tiene los secretos de prueba** (`OBRA_PRUEBA_URL` / `ASISTENCIAS_PRUEBA_URL` /
  `PARTE_PRUEBA_URL`), las rutas `/prueba/…` contestan `503 {ok:false, error:'no_configurado'}`:
  la pantalla muestra error de servidor en vez de escribir en producción. (Solo si `auth.js` está
  en rollback a Google, §9, `?env=prueba` se ignora con aviso en consola: sin base no hay `/prueba`.)
- Producción no cambia: sin `?env=` y sin nada guardado, `entorno.js` no escribe en localStorage
  y las pantallas usan las URLs de producción. `auth.js` (pega el token a todo lo que va bajo
  `api.galca.app`), la CSP (mismo host) y el service worker (nunca intercepta la API) sirven igual
  para los dos entornos.

**Lo que comparten los dos entornos en un mismo navegador** (mismo dominio, mismo localStorage):

| Qué | Clave | Efecto al cambiar de entorno |
|---|---|---|
| Cola offline (D82) | `tm2_cola_envios` | Cada ítem guarda la URL a la que va, así que un reporte capturado en prueba sube a prueba aunque se haya vuelto a producción. **No cambiar de entorno con envíos pendientes** (chip de señal en verde y sin pendientes). |
| Credenciales recordadas para entrar sin señal (D108) | `cred_*` | Son el hash `usuario:clave`; valen en los dos si la hoja USUARIOS de la copia es igual. No se tocan. |
| Catálogos cacheados (roster, flota, máquinas) | `tm2_cat_*` | Al abrir cada pantalla se refrescan desde el entorno activo si hay señal; sin señal puede verse un catálogo del otro entorno. |
| Tema, plantillas de asistencia, foto del tablero | `tm2_tema`, `asis_tpl_*`, etc. | Sin efecto. |

## 2. Crear el Sheet copia (uno por proyecto)

Hay dos Google Sheets: el de **obra** (`SHEET_ID` en `backend/Codigo.gs`; el Parte Digital vive
en el mismo) y el de **asistencias** (`SHEET_ID` en `backend/CodigoAsistencias.gs`).

Para cada uno:

1. Abrir el Sheet de producción → **Archivo → Hacer una copia**. Nombre sugerido:
   `[PRUEBA] <nombre original>`. Guardarla en una carpeta aparte (p. ej. `Galca_prueba/`), NO
   junto al de producción, para que nadie los confunda.
2. La copia trae TODAS las hojas (BANDEJA, DATA, MAQUINARIA, USUARIOS, LOG, PARTE_*, …) con sus
   datos. Es lo que se quiere: mismos usuarios, mismos catálogos, misma estructura. Si conviene
   empezar limpio, vaciar las filas de datos de BANDEJA/DATA/MAQUINARIA/ASISTENCIA (**nunca** las
   cabeceras ni las hojas de catálogo).
3. Copiar el ID de la copia (lo que va entre `/d/` y `/edit` en la URL). Se pega en el paso 3.

Las hojas `LOG` y las que crean `setupLog()` / `setupHojas()` / `setupParte()` ya vienen en la
copia; no hace falta volver a ejecutarlas salvo que la copia se haya hecho de un Sheet anterior a
D166.

## 3. Crear la segunda copia de cada Apps Script

> **Por qué una «segunda implementación» del mismo proyecto NO sirve.** En Apps Script las
> implementaciones (Implementar → Administrar implementaciones) son versiones del MISMO código con
> las MISMAS Propiedades del Script: `SHEET_ID` es una constante del código y `AUTH_SECRETO`,
> `AUTH_V` y `PARTE_SHEET_ID` viven en propiedades del proyecto. Dos implementaciones del mismo
> proyecto escribirían en el mismo Sheet y compartirían el secreto. El aislamiento de verdad es
> **un segundo proyecto** (copia del de producción) con su propio `SHEET_ID`, sus propias
> propiedades y su propia URL `/exec`. Eso es lo que aquí se llama «la copia de prueba».

Para **cada** proyecto (obra y asistencias):

1. Abrir el proyecto de Apps Script de producción → **Descripción general (ⓘ) → Hacer una copia**.
   Renombrarlo `[PRUEBA] <nombre>`. La copia trae los archivos (`Codigo.gs` + `CodigoParte.gs`, o
   `CodigoAsistencias.gs`) pero **no** las implementaciones, ni los disparadores, ni las
   Propiedades del Script.
   - Alternativa equivalente: proyecto nuevo y pegar los archivos del repo (`backend/*.gs`).
2. En el archivo principal de la copia, cambiar la constante **`SHEET_ID`** por el ID del Sheet
   copia del paso 2. Es el ÚNICO cambio de código respecto a producción. (Si en la copia de obra se
   quiere el Parte en otro Sheet, además la propiedad `PARTE_SHEET_ID`; normalmente no.)
3. **Implementar → Nueva implementación → Aplicación web**, con los mismos valores que producción:
   *Ejecutar como*: yo · *Quién tiene acceso*: cualquier persona. Copiar la URL que termina en
   `/exec`. Esa es la URL de prueba de ese proyecto.
4. **Secreto de sesión (D109).** Los tokens los emite el proyecto de obra y los verifica el de
   asistencias con el mismo secreto. En la copia:
   - copia de **obra**: ejecutar `mostrarSecretoAuth()` desde el editor. Como la copia no tiene la
     propiedad, la genera nueva (distinta de la de producción — es lo correcto) y la imprime en el
     registro.
   - copia de **asistencias**: ejecutar `fijarSecretoAuth("<el secreto impreso>")`.
   - **No copiar el secreto de producción** a las copias: si fueran iguales, un token de
     producción entraría en prueba y al revés.
5. **Disparadores.** La copia no hereda ninguno. Para prueba **no instalar** `instalarTriggerRespaldo()`
   (haría respaldos diarios del Sheet copia en Drive) ni, en asistencias, `instalarCalentador()`
   (precalentado cada 30 min). Si alguna vez se instalaron, `quitarTriggerRespaldo()`.
6. Autorizar el proyecto la primera vez que se ejecute algo desde el editor (pedirá permisos de
   Sheets; Drive solo si se ejecuta `respaldoDiario()`, que en prueba no hace falta).

## 4. Darle las URLs de prueba al Worker (no al frontend)

Desde D169 no se pega nada en el repo. En la carpeta `worker/`:

```
wrangler secret put OBRA_PRUEBA_URL          # pegar la URL /exec de la copia de obra
wrangler secret put ASISTENCIAS_PRUEBA_URL   # la de la copia de asistencias
wrangler secret put PARTE_PRUEBA_URL         # normalmente la MISMA de obra (el Parte vive en Codigo.gs)
```

Los secretos se aplican al instante; no hace falta `wrangler deploy` ni publicar Pages, ni subir
`CACHE_V` en `sw.js`. Para quitar el entorno de prueba: `wrangler secret delete <nombre>` (las rutas
`/prueba/…` vuelven a contestar 503).

## 5. Verificación (hacerla una vez, con datos de mentira)

1. Abrir `index.html?env=prueba` → chip **PRUEBA** arriba, título «PRUEBA · …». Entrar con un
   usuario normal (la hoja USUARIOS de la copia es igual).
2. Enviar un reporte de capataz cualquiera → debe aparecer en la **BANDEJA del Sheet copia** y NO
   en la de producción. Igual con una asistencia (`asistencia.html`) contra el Sheet copia de
   asistencias.
3. Ir al menú y a otra pantalla sin `?env=` → el chip sigue. Cerrar y abrir el navegador → sigue.
4. `menu.html?env=produccion` → manda al login (sesión cerrada), sin chip. Entrar y comprobar que
   la bandeja que se ve es la de producción.
5. Antes de volver a producción en un teléfono de campo: chip de señal sin envíos pendientes.

## 6. Redesplegar y mantener la copia

- **Redesplegar la copia de prueba:** igual que producción — pegar el código nuevo (manteniendo
  su `SHEET_ID`), *Implementar → Administrar implementaciones → editar → Nueva versión*. Misma URL.
- **Probar un cambio de backend:** primero en la copia (con `?env=prueba` en el frontend), después
  en producción. El frontend de GitHub Pages es el mismo para los dos entornos, así que un cambio de
  pantalla se prueba contra el backend copia simplemente activando `?env=prueba`.
- **Refrescar los datos de prueba:** hacer otra copia del Sheet de producción y actualizar
  `SHEET_ID` en las copias de Apps Script (y redesplegar), o vaciar y volver a pegar hojas.
- **Usuarios de prueba:** editar la hoja `USUARIOS` del Sheet copia; no afecta a producción.
- **El parte del operador (QR):** los QR llevan solo `?eq=CODIGO`. Para probar `parte.html` contra
  la copia, abrir una vez `parte.html?eq=CODIGO&env=prueba` en ese navegador (va por `/prueba/parte`).

---

## 7. Desplegar el Worker `api.galca.app` (D169)

El Worker vive en `worker/` (`wrangler.toml` + `src/index.js`). Es un proxy: `/obra`, `/asistencias`
y `/parte` reenvían a la URL `/exec` del Apps Script que corresponda, guardada como **secreto**. En
`/obra` y `/asistencias` exige que la petición TRAIGA el token de sesión (D109) —salvo `action=login`
y `action=tablero`—; `/parte` pasa sin token (formulario público por QR). Solo acepta CORS desde
`https://tm2.galca.app` (y localhost) y corta a 120 peticiones/min por IP. **No verifica la firma
del token:** eso lo siguen haciendo los Apps Script.

Requisitos una sola vez: cuenta de Cloudflare con la zona **`galca.app`** (los DNS del dominio
apuntando a Cloudflare) y Node ≥ 18. Wrangler viene declarado en `worker/package.json`: con
`cd worker && npm install` queda instalado en esa carpeta y se usa con `npx wrangler …` (o los
atajos `npm run login` · `npm run secrets` · `npm run deploy` · `npm run check`). No hace falta
instalarlo global. `npm run check` (= `wrangler deploy --dry-run`) valida `wrangler.toml` y el
código sin cuenta ni red: es lo primero que conviene correr.

```
cd worker
npm install                                   # una vez: instala wrangler en worker/node_modules
npx wrangler login                            # abre el navegador; autoriza la cuenta donde está galca.app

npx wrangler secret put OBRA_URL              # pegar: https://script.google.com/macros/s/<ID obra>/exec
npx wrangler secret put ASISTENCIAS_URL       # pegar: https://script.google.com/macros/s/<ID asistencias>/exec
npx wrangler secret put PARTE_URL             # pegar la MISMA URL de obra (el Parte Digital está en Codigo.gs)
                                              # (opcional, entorno de prueba: OBRA_PRUEBA_URL, ASISTENCIAS_PRUEBA_URL, PARTE_PRUEBA_URL — §4)

npx wrangler deploy                           # publica el Worker y, por `custom_domain = true`, crea api.galca.app
```

Las URLs `/exec` son las que ya se usaban: las de producción que tenía `entorno.js` antes de D169
(o *Implementar → Administrar implementaciones → URL de la aplicación web* en cada proyecto).
`wrangler secret put` pide el valor por teclado y no lo deja en ningún archivo; para verlos después
no hay forma (solo `wrangler secret list` da los nombres) — se vuelven a poner.

**Comprobar** (desde cualquier terminal; sin `Origin` el Worker responde sin CORS):

```
curl -s "https://api.galca.app/obra?action=tablero"            # → {"ok":true, "foto":…}   (pública, sin token)
curl -s "https://api.galca.app/obra?action=bandeja"            # → 401 {"ok":false,"auth":false,…} (sin token)
curl -s "https://api.galca.app/asistencias?action=roster"      # → 401
curl -s "https://api.galca.app/parte?mod=parte&op=equipo&eq=X" # → respuesta del Parte (sin token)
curl -s -H "Origin: https://otro.example" "https://api.galca.app/obra?action=tablero"   # → 403
```

Después, **publicar Pages** (el frontend de este commit ya apunta a `api.galca.app`; el service
worker sube a `tm2-v10`, así que los teléfonos instalados renuevan el precache con señal). En la
app: entrar, abrir la bandeja del encargado y enviar un reporte de capataz; en la pestaña *Red* del
navegador toda llamada debe ir a `api.galca.app`, ninguna a `script.google.com`.

**Redesplegar el Worker** (cambio en `src/index.js` o en `wrangler.toml`): `wrangler deploy`. Los
secretos se conservan. **Rotar una URL de Apps Script** (nueva implementación): `wrangler secret put
<NOMBRE>` y listo, sin tocar el frontend. **Ver tráfico y errores:** `wrangler tail` o el panel
*Workers & Pages → galca-api → Logs* (observabilidad activada en `wrangler.toml`).

## 8. La ruta `api.galca.app` en Cloudflare

`wrangler.toml` lleva `routes = [{ pattern = "api.galca.app", custom_domain = true }]`: al desplegar,
Cloudflare crea solo el registro DNS (`api` → Worker, proxied) y el certificado TLS. No hay que crear
el registro a mano; si ya existiera un `api` en la zona, borrarlo antes del primer `wrangler deploy`
o el despliegue lo rechaza.

Si se prefiere hacerlo desde el panel: *Workers & Pages → galca-api → Settings → Domains & Routes →
Add → Custom domain → `api.galca.app`*. Equivale a lo anterior. En cualquiera de los dos casos, en
*DNS* de la zona `galca.app` debe verse un registro `api` de tipo *Worker*.

`workers_dev = false` en `wrangler.toml` apaga la URL `galca-api.<cuenta>.workers.dev`: la única
puerta es `api.galca.app` (la CSP de las pantallas solo permite ese host).

## 9. Rollback: volver a Google sin el Worker

Si el Worker falla o Cloudflare tiene una caída y hay que salir del paso, el frontend vuelve a hablar
directo con los Apps Script en UNA edición de `auth.js` y otra de la CSP:

1. En `auth.js`, bloque `API`: `base: ''` y en `rutas` las tres URLs `/exec` completas:
   ```js
   var API = {
     base: '',
     rutas: {
       obra:        'https://script.google.com/macros/s/<ID obra>/exec',
       asistencias: 'https://script.google.com/macros/s/<ID asistencias>/exec',
       parte:       'https://script.google.com/macros/s/<ID obra>/exec'
     }
   };
   ```
   `esAPI()` pasa a reconocer esas URLs y sigue pegando el token; `entorno.js` toma la producción
   de ahí (el entorno de prueba queda sin efecto mientras dure el rollback).
2. En las 21 pantallas y `tablero/index.html`, en la meta `Content-Security-Policy`, cambiar
   `connect-src 'self' https://api.galca.app` por
   `connect-src 'self' https://script.google.com https://script.googleusercontent.com`
   (buscar y reemplazar; el POST a `/exec` redirige al segundo host y la CSP valida la redirección).
3. Publicar Pages. No hace falta subir `CACHE_V`: los archivos propios se sirven network-first.

La **cola offline** no necesita nada: al enviar, `offline.js` re-dirige por su `tipo` cualquier ítem
guardado con una URL que ya no sea de la API activa (los que se encolaron contra `api.galca.app`
suben a Google, y al deshacer el rollback, al revés). Los Apps Script no cambian en ningún momento:
siguen validando el token como siempre. Para volver al Worker se revierte la edición (o se hace
`git revert` del commit del rollback).

## 10. Altas y bajas de maquinaria y de personal (D173)

**Maquinaria — un solo sitio: Maquinaria › Flota** (`produccion-maquinaria.html`, pestaña Flota; roles admin, residente y jeisson). La hoja `MAQUINAS` es la flota completa de UF1-UF2 (pesada, volquetas, camabajas, carrotanques, turbo, camiones, luminarias), una fila por estancia; `PARTE_EQUIPOS` es la ficha (placa, medidor, proveedor).

| Situación | Qué se hace |
|---|---|
| Llega un equipo (nuevo o alquilado) | **Dar de alta**: código del parte, tipo, frente, propiedad, ingreso, placa, medidor, proveedor. Crea la ficha si falta. Después `python3 tools/generar_qr.py --solo CODIGO`, imprimir y pegar el QR en cabina. |
| Se vara y lo reemplazan uno o dos días | **Nada en la Flota.** La varada se cierra como «Taller» en «Equipos sin parte» (revisión); el reemplazo reporta por su QR de siempre y llega con la alerta `FUERA_DE_FLOTA`. |
| Se va (devolución, taller largo, otra obra) | **Dar de baja** con el PRIMER día que ya no estuvo. Deja de esperarse; el histórico no se toca; el QR sigue abriendo con alerta. |
| Vuelve | **Reingreso** desde «Ya no están en la obra»: fila nueva, mismo código, mismo QR. Nunca corregir la estancia vieja. |
| Cambia de frente (UF1-UF2 ↔ UF3) | Baja en un frente y alta en el otro. |
| Fecha o dato mal escrito | **Corregir** (solo para eso). |
| Regenerar los QR | Exportar `MAQUINAS` y `PARTE_EQUIPOS`; `python3 tools/generar_qr.py --csv PARTE_EQUIPOS.csv --maquinas MAQUINAS.tsv --limpiar`. |

**Personal — módulo Asistencias** (`resumen-asistencia.html` › gestión de personal; roles residente, admin, angie, duvan, residente_uf3, D84/D85/D119): alta con fecha de ingreso (retroactiva permitida), retiro con fecha = primer día no trabajado, mover entre cuadrillas. Un reingreso es un **alta nueva** con la fecha de reingreso, no «reactivar» (perdería el hueco). Personal eventual = `estado=eventual` (no se espera cada día, se marca desde «Completar faltantes»). Usuarios (logins) = fila en la hoja `USUARIOS` (D108).

## 11. Backend del Parte Digital en el Worker (4.01 · Fase 2 · D180)

Desde la Fase 2 el Worker puede atender `/parte` **él mismo**, contra Postgres (Supabase, proyecto
`galca-tm2sur`), en vez de reenviar al Apps Script. Código: `worker/src/api/parte.js` (CodigoParte.gs
portado, mismas funciones y mismo contrato), `worker/src/db.js` (postgres.js + Hyperdrive),
`worker/src/comun.js` (token D109, validación D166, LOG). Nada cambia en las pantallas ni en `auth.js`.

**Conmutador por ruta** (`[vars]` de `wrangler.toml`; también editable en el panel de Cloudflare):
`BACKEND_PARTE` para `/parte` (producción) y `BACKEND_PARTE_PRUEBA` para `/prueba/parte` (`?env=prueba`),
cada uno `sheets` (reenvío a Google, como siempre) o `db`. Hoy: producción `sheets`, prueba `db`.
Vuelta atrás = poner `sheets` y `wrangler deploy` (o cambiar la var en el panel).

**Secretos que necesita la ruta en `db`** (`cd worker && npx wrangler secret put <NOMBRE>`; nunca en archivos):

| Nombre | Qué es | Dónde se saca |
|---|---|---|
| `DATABASE_URL` | Cadena de conexión a Postgres con contraseña | Supabase → *Connect* → Session pooler (puerto 5432, IPv4). Alternativa mejor: Hyperdrive (`wrangler hyperdrive create`, id en `wrangler.toml`; la cadena se queda en Cloudflare). |
| `AUTH_SECRETO` | El secreto HMAC con que el Apps Script de obra firma los tokens (D109) | `mostrarSecretoAuth()` en el editor del proyecto de obra. La var `AUTH_V` (por defecto `"1"`) debe coincidir con la propiedad `AUTH_V` del mismo proyecto. |
| `DATABASE_URL_PRUEBA`, `AUTH_SECRETO_PRUEBA`, `AUTH_V_PRUEBA` (opcionales) | Lo mismo para `/prueba/parte` cuando el entorno de prueba tenga su propia BD o su propia copia del Apps Script (§3: la copia tiene otro `AUTH_SECRETO`) | Si faltan, `/prueba/parte` usa los de producción: misma BD, tokens del login de producción. |

**Backfill** (una vez por corte, desde el volcado CSV de `backend/volcado/`; ver `worker/sql/README.md`):

```
$env:DATABASE_URL = "postgres://…"                    # solo en esta terminal
node worker/sql/backfill_parte.js --volcado="C:\Galca\volcado\<fecha>_obra" --simular   # cuenta, no escribe
node worker/sql/backfill_parte.js --volcado="C:\Galca\volcado\<fecha>_obra"
```

Carga `parte_bandeja` (sin pisar lo que ya haya: `ON CONFLICT DO NOTHING`), los catálogos `parte_*`,
`maquinas` y `base_items` (estos se reescriben). **Mientras no exista el trigger de pull del ESPEJO
(informe §3.6), los catálogos y la flota de la BD son la foto del último backfill**: una alta en
Maquinaria › Flota o un cambio en `PARTE_CC`/`PARTE_EQUIPOS` del Sheet hay que volcarlos y correr el
backfill con `--solo=maquinas` (o la tabla que sea) para que `/prueba/parte` los vea.

**Verificar** (criterio de salida de la fase: el arnés de contrato en verde):

```
node worker/pruebas/contrato_local.js                 # sin red: PGlite + esquema + backfill + Worker real + arnés
node backend/pruebas/contrato/correr.js --url=https://api.galca.app/prueba --solo=parte --escribir --usuario=… --clave=…
```

La segunda hace el login en `/prueba/obra` (necesita `OBRA_PRUEBA_URL`, §4) y el Parte en `/prueba/parte`.
Sin copia de prueba del Apps Script: `--obra=https://api.galca.app/obra --parte=https://api.galca.app/prueba/parte
--asistencias=https://api.galca.app/asistencias` (login de producción, Parte contra la BD; el token vale porque
el Worker verifica con el mismo `AUTH_SECRETO`). `--escribir` deja en la BD unas filas `descartado` con fecha
2020-01-13 (README del arnés).

**Canario con `?env=prueba`.** El Worker atiende como Parte también `mod=parte` sobre `/obra` y
`/prueba/obra` (así lo llama `revision-maquinaria.js`, y así lo despacha `doGet` de Codigo.gs). Para que el
LOGIN funcione en prueba sin copia del Apps Script, poner `OBRA_PRUEBA_URL` con la MISMA URL `/exec` que
`OBRA_URL`: `/prueba/obra` pasa a ser la obra de producción (lectura de siempre) y el token que emite lo
verifica `/prueba/parte` con `AUTH_SECRETO`. Luego:

1. Teléfono de cabina: `https://tm2.galca.app/parte.html?eq=<CÓDIGO>&env=prueba` (chip rosa **PRUEBA**),
   llenar y enviar un parte real. Va a la BD, no al Sheet.
2. PC: `https://tm2.galca.app/index.html?env=prueba` → entrar → Revisión de maquinaria: la fila aparece en
   pendientes; revisar, aprobar, repartir. Comprobar en Supabase → Table Editor → `parte_bandeja` y `log`.
3. Volver a producción en ese navegador/teléfono: abrir cualquier pantalla con `?env=produccion`. No cambiar
   de entorno con envíos pendientes en la cola offline (chip de señal en verde).

**Corte a producción** (cuando el canario lleve dos semanas limpio, informe §3 Fase 2): volcado fresco →
backfill → `BACKEND_PARTE = "db"` → `wrangler deploy`. La cola offline redirige sola (`offline.js` por `tipo`).
`wrangler tail` muestra las peticiones; la tabla `log` de la BD guarda una fila por petición (D166).

## 12. Backend de Obra y Asistencias en el Worker (4.01 · Fases 3 y 4 · D180)

Igual que el Parte (§11), Obra y Asistencias pueden atenderse desde el Worker contra Postgres en vez de
reenviar a Google. Código: `worker/src/api/obra.js` + `worker/src/api/obra/*.js`, `worker/src/api/asistencias.js`
+ `worker/src/api/asistencias/*.js`, con el login y la emisión del token en `worker/src/auth.js` (tabla
`usuarios`) y los catálogos compartidos en `worker/src/catalogos.js`. Contrato intacto: las pantallas y
`auth.js`/`entorno.js`/`offline.js` no cambian.

**Conmutadores** (`[vars]` de `wrangler.toml` o panel de Cloudflare): `BACKEND_OBRA` para `/obra`,
`BACKEND_ASISTENCIAS` para `/asistencias`, cada uno `sheets` o `db`, más `BACKEND_OBRA_PRUEBA` /
`BACKEND_ASISTENCIAS_PRUEBA` para `/prueba/*`. **Desde el 16-sep-2026 todo en `db`** (producción y prueba):
los tres módulos (Parte, Obra, Asistencias) los atiende el Worker contra Supabase y el login lo emite el Worker.

**Diferencia clave con el Parte: el login pasa al Worker.** Con `BACKEND_OBRA="db"`, `action=login` en `/obra`
lo resuelve `worker/src/auth.js` leyendo la tabla `usuarios` y emite el token con `AUTH_SECRETO`/`AUTH_V`. Por
eso esos deben ser los MISMOS que en los Apps Script (ya lo son): los tokens ya emitidos siguen valiendo y los
reportes encolados en los teléfonos no se pierden. La tabla `usuarios` tiene que estar cargada (backfill de obra)
antes de conmutar. Subir `AUTH_V` saca a todos (en el Worker y en los scripts que sigan en `sheets`).

**Esquema y backfill** (una vez, antes del corte de cada módulo):

```
# 1) migración de esquema (idempotente): volquetas surrogate, base_elementos, base_items ampliada
psql "$DATABASE_URL" -f worker/sql/002_fases_3_4.sql          # o pegar en el editor SQL de Supabase
psql "$DATABASE_URL" -f worker/sql/003_grilla.sql             # V3-08/D181: base_elementos.version + no_operativo
psql "$DATABASE_URL" -f worker/sql/004_data_editable.sql      # V3-08b/D181: data.version/editado_* + tabla periodos

# 2) backfill de obra (BANDEJA, DATA, MAQUINARIA, VOLQUETAS, OBSERVACIONES, TABLERO, USUARIOS, CUBICAJE, BASE)
$env:DATABASE_URL = "postgres://…"
node worker/sql/backfill_obra.js --volcado="C:\Galca\volcado\<fecha>_obra" --simular
node worker/sql/backfill_obra.js --volcado="C:\Galca\volcado\<fecha>_obra"

# 3) backfill de asistencias (necesita volcarAsistencias() primero: hoy NO hay volcado de asistencias en disco)
node worker/sql/backfill_asistencias.js --volcado="C:\Galca\volcado\<fecha>_asistencias" --simular
node worker/sql/backfill_asistencias.js --volcado="C:\Galca\volcado\<fecha>_asistencias"

# 4) D182: migración que MUEVE DATOS → va con la DATA ya cargada (idempotente: se puede correr dos veces)
psql "$DATABASE_URL" -f worker/sql/005_data_clima.sql         # sello [Clima: X] → data.clima + data_maestro con el layout D182

# 5) D183 (V3-11 Fase A): la Proyección, DESPUÉS de 005 (idempotente; no mueve datos)
psql "$DATABASE_URL" -f worker/sql/006_proyeccion.sql         # 4 tablas proy_* sembradas del Excel + 4 vistas proyeccion_*_maestro

# 6) D184: DATA completa, DESPUÉS de 006 y, como 005, con la DATA ya cargada (idempotente: rellena datos;
#    en producción va también una vez ANTES del `wrangler deploy` de D184: ver `007` abajo)
psql "$DATABASE_URL" -f worker/sql/007_data_completa.sql      # tabla fc_actividad (7 FC 1,3) + ACTA/ESPESOR/FC/CANTIDAD donde faltan + FC 1 en «ajuste origen» (D185 [O])

# 7) D185 (V3-11 Fases B+C): el Tablero en vivo, DESPUÉS de 007 (idempotente; no mueve datos;
#    en producción va la primera vez junto con la primera pasada de 007: ver `008` abajo y §16)
psql "$DATABASE_URL" -f worker/sql/008_tablero_vivo.sql       # tablero_mapeo (MAPEO A2:C10) + tablero_horas + vista tablero_data_campo
```

**Cadena completa:** `001 → 002 → 003 → 004 → backfills → 005 → 006 → 007 → 008`. **Tras cualquier backfill de
DATA se repiten `005`, `006`, `007` y `008`, en ese orden.** `005` y `007` son las que mueven datos: `005` pasa el
sello de clima a su columna y `007` completa las filas y vuelve a poner FC 1 en los «ajuste origen». `006`
vuelve a cerrar `data_maestro` a `anon`/`authenticated`. `008` no cambia nada; se corre para dejar la cadena
entera y comprobar `esquema_version` 8. El banco (`worker/pruebas/contrato_local.js`) y el sandbox
(`tools/sandbox/servidor.mjs`) aplican la cadena entera y, con la DATA ya cargada, re-aplican `005` y `007`, que son
las que mueven datos. No tienen los roles de Supabase, así que no necesitan `006`. `008` no hace falta
re-aplicarla porque no depende de lo cargado.
**Carga única de la DATA del Excel maestro (D186):** es un «backfill de DATA» más, pero sale del libro del jefe y
no del volcado. Se hace con `worker/sql/importar_maestro.js`, que respalda, reemplaza hasta la fecha de corte,
re-aplica ella misma `005 → 008` y verifica por mes. Pasos y comandos en §14, «Paso 0».

**`005_data_clima.sql` (D182)** hace cuatro cosas: (1) mueve el sello `[Clima: X]` de la OBSERVACIÓN a
`data.clima` en las filas donde el clima estaba vacío; (2) quita el sello de la observación y sube `version`
una vez, así que una Revisión de DATA abierta choca y recarga; (3) recrea la vista `data_maestro` con el layout
D182 (§14); (4) re-otorga el `SELECT` a `tm2_lector_maestro` si el rol existe, porque el `DROP VIEW` lo pierde.
En una BD nueva va **después del backfill de obra**. En producción, que ya está en `db`, D182 se despliega en
este orden: **(1) el front** (merge a `main`: Pages publica el `data.js` nuevo); **(2) `wrangler deploy`**;
**(3) `005`**, que va después del deploy para que no quede ningún sello estampado entre medias (si se corre antes,
basta con volver a correrla). Después hay que **recargar las Revisiones de DATA que estén abiertas**. El orden
importa porque una grilla vieja con el Worker nuevo muestra la columna Clima (las columnas las manda el
servidor), pero al guardar no envía el clima: el servidor conserva el viejo y responde «Se guardaron N
cambio(s)», así que el cambio se pierde sin aviso. Al revés, el front nuevo con el Worker viejo no tiene
columna Clima que cambiar y, en lo que toca a D182, funciona igual que antes. Pero D184 va en el mismo front,
y con él, entre el merge y el `wrangler deploy`, no se guarda nada en la Revisión de DATA (ver `007` abajo). **Ojo:** volver a correr `001` sobre una BD que ya tiene `005` falla en su
`CREATE OR REPLACE VIEW data_maestro` y, como `001` va en una transacción, no aplica nada. Antes hay que hacer
`DROP VIEW data_maestro;`, después correr `001` y luego otra vez `005`.

**`006_proyeccion.sql` (D183)** crea la Proyección (§15): las tablas `proy_plan`, `proy_contrato`,
`proy_rendimiento` y `proy_parametros`, sembradas con los valores del Excel del jefe, y sus 4 vistas espejo. No
transforma datos. Va **después de `005`**, y volver a correrla no pisa lo editado. En producción se despliega
con D182, en este orden: **(1) el front**, **(2) `wrangler deploy`**, **(3) `005`** y **`006`**, y **(4)
`roles_lectura_maestro.sql`** (§15, «Despliegue»). Sin `006`, el Tablero calcula con el Excel y lo dice.

**`007_data_completa.sql` (D184)** deja **completa** cada fila de DATA, porque con la conexión viva (§14) las
fórmulas del Excel ya no ponen ACTA, ESPESOR, FC ni CANTIDAD. Hace tres cosas: (1) crea la tabla
`fc_actividad`, el FC de cada actividad (§13), con RLS, sin permisos para `anon`/`authenticated` y con las 7
semillas de FC 1,3; (2) rellena `data` **solo donde falta**, sin pisar nunca un valor: ACTA vacía → la del
periodo 16→15 de la fecha (tabla `periodos` o, fuera de ella, la fórmula de respaldo); con LARGO, ESPESOR vacío →
1, FC vacío → el de la actividad (o 1) y CANTIDAD vacía → LARGO × ESPESOR ÷ FC, con 6 decimales. Cada fila que
cambia sube `version` una vez, así que una Revisión de DATA abierta choca y recarga; (3) registra
`esquema_version` 7. **D185 [O]:** en las filas de un «ajuste origen» (subtramo no operativo), `007` pone FC 1
donde falta y además **corrige** un FC ≠ 1 → 1, con CANTIDAD = LARGO × ESPESOR. Es la única vez que pisa un
valor; en el histórico son 35 filas. Como `005`, **va con la DATA ya cargada**. Tras cualquier backfill de DATA se repiten
**`005`, `006` y `007`, en ese orden** (y desde D185 también `008`; ver «Cadena completa»): `006` vuelve a quitar a `anon`/`authenticated` el acceso a
`data_maestro` que `005` recrea (§15). El banco y el sandbox, que no tienen esos roles, re-aplican `005` y
`007`. Correrla dos veces no cambia nada, y no re-siembra una fila de `fc_actividad` que alguien haya borrado.
En producción D184 se despliega con D182 y D183, y **`007` se corre dos veces**:
**(0) `007` antes que nada** (y, si D185 va en el mismo despliegue, **`008` justo después**), con el front y
el Worker viejos; **(1) el front**; **(2) `wrangler deploy`
enseguida**; **(3) `005`, `006` y otra vez `007`**, en ese orden; y **(4) `roles_lectura_maestro.sql`**, como
pide D183 (`007` no crea vistas ni toca ese rol). La primera pasada es para que `fc_actividad` ya exista cuando
arranque el Worker nuevo. Sin la tabla, el Worker nuevo no falla, pero trata todo como FC 1: lo que se envíe o
se corrija en ese rato queda con **FC 1 escrito** (CANTIDAD = LARGO en las 7 actividades de 1,3), y `007` ya
no lo corrige, porque solo rellena lo vacío. Con el Worker viejo la primera pasada es inocua: no lee
`fc_actividad`, y lo que siga enviando llega con ACTA, ESPESOR, FC y CANTIDAD vacías, que completa la segunda.
**Ojo, entre (1) y (2) no se guarda nada en la Revisión de DATA:** la pantalla nueva con el Worker viejo no
recibe el FC de las actividades y pone FC 1 en cada fila que se corrija. `007` ya no arregla esas filas,
porque tienen valor.

**`008_tablero_vivo.sql` (D185)** es la base del Tablero en vivo (§16). Crea tres cosas: (1) `tablero_mapeo`, el
MAPEO A2:C10 del Excel (9 filas con el texto verbatim de la BASE: qué descripción de DATA va a qué campo del
Tablero, por UF); (2) `tablero_horas`, una fila por obra con las horas del libro de partes que carga admin/jefe,
comprimida; (3) la vista `tablero_data_campo`, cada fila de DATA con su CANTIDAD compacta y su campo. Las dos
tablas llevan RLS, y a `anon`/`authenticated` se les quita todo, también sobre la vista. Registra
`esquema_version` 8. **No transforma datos** y es idempotente: re-aplicarla no pisa un mapeo editado ni resucita una
fila borrada, porque las semillas entran solo la primera vez. En producción va **una vez, antes del front y del
`wrangler deploy` de D185**, justo después de la primera pasada de `007`. Con el Worker viejo es inocua, porque
nadie la lee. El Worker nuevo la encuentra y el Tablero en vivo funciona desde el primer minuto. Sin `008`, el
Worker nuevo no falla: `tablero_vivo` responde «El Tablero en vivo todavía no está en la base de datos (falta aplicar
worker/sql/008_tablero_vivo.sql).» y el Tablero enseña
la foto publicada con aviso ámbar.

Las transaccionales se anexan con `ON CONFLICT DO NOTHING` (no pisan lo que el Worker ya creó); los catálogos
se reescriben. Desde 4.01 los catálogos (BASE, CUBICAJE, MAQUINAS, USUARIOS, CUADRILLAS, CONFIG, TURNOS, CAT_*)
se editan en Supabase (Table Editor), no en el Sheet: un backfill posterior de un catálogo lo pisa, así que
tras el corte no se re-corren los catálogos salvo para recargarlos a propósito.

**Tras el corte NO se repite el backfill** (ni de reportes). Anexar no borra nada, y en el Sheet un reenvío
cambiaba los `id_registro`: ASISTENCIA (upsert por fecha+cuadrilla) y DATA (cada envío al maestro regenera ids).
Recargar con un volcado más nuevo deja en Supabase la versión vieja **y** la nueva. Pasó el 16-sep-2026 con la
asistencia del 15-sep (173 filas contra 114 del Sheet final; DATA quedó igual). Se limpia con:

```
$env:DATABASE_URL = "postgres://…"
node worker/sql/depurar_asistencia.js --volcado="C:\Galca\volcado\<fecha>_asistencias" --desde=2026-09-15 --hasta=2026-09-15 --corte=2026-09-16T18:35:34Z
node worker/sql/depurar_asistencia.js … --aplicar        # solo después de revisar la simulación
```

Borra de las fechas del rango las filas que ya no están en el Sheet final y son anteriores al corte (versiones
viejas) y, si una persona queda dos veces el mismo día, deja la más reciente. Conserva lo que se haya escrito
desde la app después del corte. `--corte` es la hora del deploy que pasó asistencias a `db` (en UTC).

**Verificar** (criterio de salida, sin red):

```
node worker/pruebas/contrato_local.js                         # PGlite + backfill del volcado real + los 3 módulos
node backend/pruebas/contrato/correr.js                       # modo vm: los .gs reales, para confirmar que el contrato no cambió
```

Contra la API real (cuando el módulo esté en `db`): `node backend/pruebas/contrato/correr.js --url=https://api.galca.app --solo=asistencias --usuario=… --clave=…` (login en `/obra` de producción mientras obra siga en `sheets`; una vez obra esté en `db`, el login ya lo hace el Worker).

**Corte por módulo** (informe §3, orden Asistencias → Obra): backfill fresco → `BACKEND_ASISTENCIAS="db"` (o
`BACKEND_OBRA="db"`) → `wrangler deploy`. La cola offline redirige sola por `tipo`. Vuelta atrás: la var a
`"sheets"` y `wrangler deploy`; las filas creadas en la BD entre tanto se pegan a mano al Sheet.

**Lo que queda fuera de Supabase tras el corte:** el traspaso al Excel maestro. Hasta el corte de Power Query
(§14) sale del **copiado día a día del Panel del Jefe** (A:O, o A:S con el sello de clima; D65/D131). Ese copiado
lee la tabla `data` (`?action=consolidado`), NO la vista, así que D182 no lo toca. Desde D184 manda ORDEN (B) y
ACTA (M) **siempre vacías**, aunque la base ya las tenga llenas, para que «Omitir blancos» siga respetando las
fórmulas del Excel. Después, el maestro lee en vivo la vista `data_maestro` (§14). Todo lo demás vive en Supabase.

## 13. Grilla de catálogos — edición tipo Excel de la BASE (4.01 · V3-08 · D181)

Fuente única de edición (D181): los editores autorizados —**incluido el jefe**— corrigen los catálogos
fundacionales **directamente en la base**, con una grilla tipo Excel, en vez de editar el Excel a mano.
Pantalla `grilla.html`; se entra desde el **menú del admin** y desde el **Panel del Jefe** (`jefe.html`).

- **Quién edita** (guard en el Worker, `permiso_`, no el cliente): roles `admin`, `jefe`, `residente` y el
  usuario `jeisson`. Cualquier otro entra en **solo lectura**. A diferencia de Maquinaria, aquí el **jefe
  SÍ escribe** (D181 le devuelve el control de los catálogos).
- **Qué edita hoy:** la tabla `base_elementos` (**subtramos**: elemento · abscisa inicio/fin · UF · bandera
  «no operativo»). Los **centros de coste** (`base_items`) se ven en una pestaña de **solo lectura** (la
  edición de ese catálogo es el siguiente paso de V3-08).
- **Validación server-side** (endpoint `POST ?action=grid_guardar`): **no-solapamiento** de subtramos
  lineales (intervalo semiabierto, como las estancias de flota: dos que comparten extremo —cadena— no se
  pisan), **control de versión por fila** (`if_version`: si otra persona editó la fila mientras tanto, se
  rechaza y se recarga), **duplicados** de nombre (aviso) y los **dos «ajuste a origen»** (`ajuste origen
  UF1/UF2`), que se marcan **no operativos** y quedan fuera del no-solapamiento y del cálculo de tope. La
  **cascada** (recorrer los subtramos consiguientes al mover un límite) se **informa**, no se aplica sola:
  el modo automático vs. revisión manual queda pendiente de cerrar con César (03_BACKLOG V3-08).
- **Esquema:** la migración **`003_grilla.sql`** añade a `base_elementos` las columnas `version` (if_version)
  y `no_operativo`. Es idempotente y se aplica en la misma cadena que el resto (`001 → 002 → 003 →
  backfills`, §12). Los subtramos siguen editándose también desde el Table Editor de Supabase; la grilla es
  la superficie cómoda para quien no debe entrar al Table Editor crudo.
- **Lo que NO cambia:** editar un subtramo aquí afecta a los **envíos futuros** (la derivación BASE→DATA se
  materializa al enviar, no reescribe filas de `data` ya guardadas), igual que hoy.
- **Probarla antes del corte, sin tocar nada** (recomendado): `node tools/sandbox/servidor.mjs` levanta un
  **sandbox 100% local** —Worker real + Postgres en memoria + las pantallas— sembrado con los **subtramos
  reales** del Excel. Abre `http://127.0.0.1:8099`, entra con `admin`/`1234` (o `jefe`/`clave-jefe`) y usa la
  grilla de verdad (edición, solapes, `if_version`, roles). No toca Supabase ni Cloudflare; todo en memoria.
  Detalle en `tools/sandbox/README.md`. La pantalla habla con el Worker local porque `auth.js` apunta la API
  al mismo origen **solo en localhost** (en producción no se activa).

### Revisión de DATA — la pantalla principal (4.01 · V3-08b · D181 · D182 · D184 · D185)

Lo que de verdad se toca al cierre: `data.html` muestra el **reporte diario como la hoja DATA** y el
jefe/residente **corrige o añade** filas (una actividad mal puesta, un valor que el residente se comió, o
una actividad que los capataces no reportan). Entra desde el menú (admin) y el **Panel del Jefe**.

- **Columnas (D182):** FECHA · DESCRIPCIÓN · SUBTRAMO · CC · GRUPO · CAPÍTULO · UF · ABS INICIAL · ABS FINAL ·
  ACTA · UNIDAD · LARGO · ESPESOR · FC · CANTIDAD · **CLIMA** · **OBSERVACIÓN** (al final). ORDEN, PROYECTO y
  LIBERACIÓN ya no se ven. Siguen en la tabla y viajan ocultas, sin tocarse: una corrección conserva lo
  guardado, y una fila nueva nace con LIBERACIÓN `CAMPO`. Como ya no se pueden teclear, una actividad fuera
  del catálogo toma PROYECTO de la UF (D04: UF1 → 3701, UF2 → 3702) y deja ORDEN vacío.
- **El jefe teclea/elige:** FECHA, DESCRIPCIÓN (de un catálogo de 156 actividades, o texto libre para una
  nueva), SUBTRAMO, LARGO, ESPESOR, FC, CLIMA, OBSERVACIÓN.
- **El sistema deriva solo, idéntico a las fórmulas del Excel** (verificadas): UF ← subtramo; CC ←
  descripción+UF; GRUPO/CAPÍTULO/UNIDAD ← CC (ORDEN y PROYECTO también, ocultos); ABS INICIAL/FINAL ←
  subtramo; ACTA ← fecha; **CANTIDAD = LARGO × ESPESOR ÷ FC**. Lo derivado se ve en gris; si la actividad no
  está en el catálogo, las celdas visibles quedan libres para completarlas a mano.
- **Qué se llena solo (D184).** La base ya no deja celdas vacías que antes ponía el Excel:
  - **ACTA** = la del periodo 16→15 en que cae la FECHA, según la tabla `periodos`. Si la fecha cae fuera de
    ella (2027 en adelante), sale de la fórmula de respaldo: el mes de cierre es el de la fecha si el día es
    ≤ 15, y si no, el siguiente; acta = (año − 2025)·12 + mes + 2. Así, 2026-08-16…09-15 es la 23 y
    2026-09-16…10-15 (octubre-26), la 24. La pantalla la calcula en vivo al cambiar la fecha.
  - **ESPESOR** = 1 si está vacío (en las filas con LARGO; sin LARGO, ESPESOR y FC no se tocan).
  - **FC** = el de la actividad si está vacío (también solo con LARGO): 1,3 en las 7 descripciones de la tabla
    `fc_actividad` (terraplén, excavación aprovechable, no aprovechable y de préstamo, subbase, base
    estabilizada y conformación de sobrantes) y 1 en todo lo demás. Al **elegir o cambiar la DESCRIPCIÓN**, el
    FC pasa al de esa actividad; si el jefe lo quiere distinto, lo escribe encima. Un solo Ctrl+Z deshace la
    descripción y el FC.
  - **CANTIDAD** = LARGO × ESPESOR ÷ FC, con 6 decimales.
  - Una **＋Fila** nace con ESPESOR 1 y el FC de su actividad (1 hasta que se elige la descripción). En una fila
    con LARGO, vaciar ESPESOR o FC los devuelve a su valor por defecto, en pantalla y al guardar. Lo que el
    jefe escriba (un FC 1,8, un espesor 0,5…) se respeta.
  - `enviar_data` (encargado y residente, tierras y drenajes) manda las filas ya así, y `007_data_completa.sql`
    rellenó las viejas solo donde faltaba (§12).
  - **«Ajuste origen» con FC 1 (D185, regla [O]).** Una fila cuyo ELEMENTO es un subtramo no operativo (los dos
    «ajuste origen UF1/UF2»: la bandera `no_operativo` de la grilla o el nombre que empieza por «ajuste origen»)
    va **siempre con FC 1**, así que CANTIDAD = LARGO × ESPESOR, aunque la actividad tenga 1,3. Esta pantalla lo
    pone solo al elegir la descripción, al mover la fila a un ajuste origen o sacarla de él (fuera toma el FC de
    su actividad) y al vaciar el FC. `enviar_data` hace lo mismo. Un FC que el jefe teclee en esa fila se
    respeta al guardar, pero **cada vez que se re-aplique `007` vuelve a 1**, porque el dueño lo pidió «siempre
    FC 1». Estas filas son los cuadres del jefe contra lo certificado; el dueño decidió no recalcularlas (D185).
  - **Límite conocido:** como `007` nunca pisa un valor (salvo el FC ≠ 1 de los «ajuste origen», regla [O] de
    D185), una fila vieja que ya traía su CANTIDAD del Excel con
    el ESPESOR o el FC vacíos (en el Excel, vacío cuenta como 0) queda con ESPESOR 1 y su FC, pero con la
    CANTIDAD de antes, así que no cumple LARGO × ESPESOR ÷ FC. La primera corrección de esa fila en esta
    pantalla recalcula la CANTIDAD. En la DATA del Excel hay una: excavación aprovechable del 04-sep-2025,
    LARGO 2646, ESPESOR vacío y CANTIDAD 0, que al corregirla pasa a 2035,38. Para encontrar las filas cuya
    CANTIDAD no sale de la fórmula (estas y las tecleadas a mano en el Excel, §14 Paso 4):
    `SELECT fecha, descripcion, largo, espesor, fc, cantidad FROM data WHERE largo IS NOT NULL AND abs(cantidad - round(largo * espesor / CASE WHEN fc = 0 THEN 1 ELSE fc END, 6)) > 0.001 ORDER BY fecha;`
- **Cambiar un FC (D184).** Por ahora no hay pantalla: se hace en Supabase → *Table Editor* → tabla
  **`fc_actividad`** (una fila por actividad: `descripcion`, `fc`, `nota`).
  - **Cambiar el FC de una actividad:** edita `fc` (mayor que 0 y hasta 3) y deja en `nota` el porqué. Si
    quieres, llena `editado_por` y `editado_ts`.
  - **Darle FC a otra actividad:** añade una fila con la `descripcion` **tal cual la trae la BASE**. El cruce no
    distingue tildes, mayúsculas ni espacios de más, pero el resto del texto tiene que coincidir.
  - **Volver a FC 1:** borra la fila. Sin fila, el FC es 1.
  - **A qué afecta:** a los envíos y correcciones **siguientes**, desde la próxima petición (no hay caché). No
    reescribe las filas ya guardadas, que tienen su FC. Para aplicarlo a una fila vieja, vacía su FC en esta
    pantalla y guarda. Volver a correr `007` tampoco cambia un FC ya escrito.
  - **Si la BASE cambia el texto de una descripción**, cámbialo también en `fc_actividad`. Si no, esa
    actividad cae a FC 1. Un backfill de la BASE no toca esta tabla.
  - No es el FC de la **Proyección** (§15, uno solo para el Tablero, en `proy_parametros`). Son dos cosas
    distintas.
- **CLIMA del día (D182).** Se elige de la lista **Soleado · Lluvias · Lluvias parciales**, las mismas del
  encargado. Un valor viejo fuera de la lista (`SOLEADO`…) se ve y se guarda tal cual. El clima es **del día**:
  si se fija en una fila (lista, tecleo, pegar, Ctrl+D), se aplica a **todas las filas de esa fecha**, también
  las que oculta un filtro, y Ctrl+Z lo deshace de una vez. Las filas del día se marcan, pero al guardar no se
  mandan: viaja un solo cambio `{op:'clima'}` por día, y el servidor lo propaga a todas las filas de la fecha,
  de cualquier área, con `version+1`, sin reescribirlas ni re-derivarlas. El mensaje dice a cuántas filas
  llegó. Una fila sin clima, como las de drenajes, muestra el del día, y una ＋Fila lo hereda. Una fila que
  cambia de fecha toma el clima de su día nuevo; si era la única con el clima de su día viejo, ese clima pasa
  a las filas que quedan allí, y lo mismo al eliminarla. El sello `[Clima: X]` ya no va en la OBSERVACIÓN: la
  hoja DATOS del Excel se elimina, y `005` limpió el histórico.
- **Carga por rango de fechas** (por defecto el periodo 16→15 en curso). Editar en celda, selección de
  rango, copiar/pegar, rellenar hacia abajo (Ctrl+D), **＋Fila** y eliminar. Control de versión por fila
  (`if_version`) + auditoría (`editado_por`/`editado_ts`). Guard D109: el **jefe SÍ edita**.
- **Esquema:** migración `worker/sql/004_data_editable.sql` (data.version/editado_por/editado_ts + tabla
  `periodos` con las 17 actas), `worker/sql/005_data_clima.sql` (D182: sello → `data.clima` y la vista
  `data_maestro` nueva) y `worker/sql/007_data_completa.sql` (D184: `fc_actividad` y el relleno de ACTA,
  ESPESOR, FC y CANTIDAD; desde D185, FC 1 en los «ajuste origen»). La cadena es `001 → 002 → 003 → 004 →
  backfills → 005 → 006 → 007 → 008`: 005 y 007 mueven datos y van con la DATA cargada, y `008` (D185) es la del
  Tablero en vivo (§16). Tras un backfill de DATA se repiten 005, 006, 007 y 008, en ese orden (006 vuelve a
  quitar a `anon`/`authenticated` el acceso a `data_maestro`, §12 y §15). En el despliegue de D184, 007 va
  además una vez antes del `wrangler deploy`, seguida de 008 si D185 va en el mismo despliegue (§12).
  Una corrección guardada aquí se ve **en seguida en el Tablero** (§16), para admin y jefe al instante y para
  el público en ≤ 60 s.
- **Ojo:** un envío a DATA (`enviar_data`, que hacen el encargado o el residente desde su panel) reescribe el
  día por área. Si el encargado o el residente reenvían un día que el jefe ya corrigió aquí, su envío pisa la
  corrección. Es **comportamiento aceptado (D184(c))**: reenvían después de revisar, y lo que mandan es su
  versión nueva. Si hace falta, el jefe vuelve a corregir después del reenvío. Y una pantalla abierta desde
  antes del reenvío **no choca** con las filas reenviadas que nadie había corregido (vuelven a nacer con
  `version` 0), así que lo que se guarde en ella las pisa: conviene recargar antes de corregir un día recién
  reenviado. Con el clima pasa igual: un reenvío de tierras trae el clima del encargado a sus filas y a las
  de otras áreas que ya guardaban uno (las que están vacías lo leen del día). Una fila de drenajes D71
  (demolición 01.02) que se corrige aquí sin cambiar su CC conserva su área, así que el reenvío de tierras no
  la borra. El maestro lee esto en vivo por Power Query (§14): lo que el jefe corrige aquí es lo que ve el Excel.
- **Probar sin tocar nada:** el sandbox local (`node tools/sandbox/servidor.mjs`) siembra el catálogo de
  actividades y la DATA real completa (4468 filas). Al arrancar, `005` les quita los sellos de clima y `007`
  completa lo que falte (con la muestra real, 2 filas). Entra como `jefe`/`clave-jefe` y úsala de verdad.

## 14. Maestro del reporte diario por CONEXIÓN VIVA (Power Query) — 4.01 · V3-09 · D181 · D182 · D184 · D186 · D187

Reemplaza el **copy-paste A:S** al Excel maestro por una **consulta de Power Query** que lee la vista
**`data_maestro`**, el ESPEJO de la hoja DATA. Las tablas dinámicas del jefe se re-apuntan **una sola vez** a la
nueva consulta y **refrescan solas**; el Excel queda como superficie de análisis/consulta y salida, **no de
captura**.

**Camino principal (D187): «Desde la Web», sin instalar nada.** El Excel lee un CSV que sirve el Worker en
`https://api.galca.app/obra?action=data_csv&clave=<CLAVE>`, protegido con una **clave de lectura** compartida
que va escrita en la consulta. Usa solo `Web.Contents` + `Csv.Document`, que vienen con cualquier Excel de
escritorio: **no hay que instalar nada ni ser administrador**, así que funciona para cualquiera que abra el
libro. La vía anterior (conector PostgreSQL con el usuario `tm2_lector_maestro`) exige instalar **Npgsql con
permisos de administrador** y queda como **alternativa** para Power BI o equipos con admin (al final de esta
sección).

**Encabezados de `data_maestro`** (layout D182, `005_data_clima.sql`). Van con estos nombres exactos y en este
orden: `obra_id` · **FECHA · GRUPO · CENTRO DE COSTO · CAPITULO · DESCRIPCION · UNIDAD FUNCIONAL · ELEMENTO ·
ABS INICIAL · ABS FINAL · ACTA · UNIDAD MEDIDA · LARGO · ESPESOR · FC · CANTIDAD · CLIMA · OBSERVACION**, que son
las 17 del maestro, y después las internas `id_registro` · `timestamp` · `capataz` · `rol` · `actividad` ·
`pk_inicial` · `pk_final` · `area`. FECHA sale como texto `yyyy-MM-dd` y el vacío es `''`. **CLIMA** es el clima
de la fila o, si está vacío, el **del día**: el primer clima no vacío de esa fecha, ordenado por `timestamp`
(vacíos al final) e `id_registro`. Así cada fila del día trae el mismo clima, también las de drenajes. Ya
**no** están ORDEN, PROYECTO, LIBERACION ni Columna1. Siguen en la tabla `data` porque el copiado actual del
jefe las usa, y la vista se puede ampliar si algún día hacen falta.

**Paso 0 — cargar la DATA del Excel a Galca (D186), una sola vez y antes del Paso 1.** La tabla `data` de
producción solo tiene lo que mandó la app desde el 17-jun-2026 (1.103 filas), y la hoja DATA del Excel tiene
4.476 desde el 1-ago-2025, con lo que el jefe agrega o corrige a mano, los drenajes y los «ajuste origen» (el
14-jul, por ejemplo: 47 filas en el Excel, 17 en Galca). **Hasta la fecha de corte manda el Excel**: se
reemplaza lo que haya en Galca en esas fechas, también lo del 17-jun en adelante. Desde el corte todo se edita
en Galca (Revisión de DATA), los capataces siguen enviando por la app y **se deja de usar «Copiar»** al Excel.
1. Elige el corte (el último día que el jefe dejó revisado en el Excel) y **copia** el libro. La herramienta
   solo lee la copia y nunca escribe en un `.xlsx`, pero el original puede estar abierto.
2. Simula. No escribe nada: compara Excel y Galca mes a mes (filas, Σ LARGO, Σ CANTIDAD) y dice cuántas
   borraría e insertaría, cuántas filas del Excel son posteriores al corte (se ignoran) y los avisos: filas sin
   fecha, fechas raras (anteriores a 2025 o futuras), celdas fuera de A:T y días ≤ corte que Galca tiene y el
   Excel no (quedarían vacíos).
3. Carga. En una sola transacción exige `esquema_version` ≥ 8, **respalda** en CSV (UTF-8 con BOM, `;`) todas
   las filas de `data` con fecha ≤ corte, las borra e inserta las del Excel. Después re-aplica
   `005 → 006 → 007 → 008` (§12) y verifica mes a mes que filas y Σ LARGO de Galca hasta el corte sean las del
   Excel. Sale con código 1 si no cuadra.

```powershell
$env:DATABASE_URL = "postgres://…"          # o --conexion-archivo=<ruta fuera del repo>
node worker/sql/importar_maestro.js --excel="C:\Galca\copia\TM2_SUR_REPORTE.xlsx" --hasta=2026-09-17 --simular
node worker/sql/importar_maestro.js --excel="C:\Galca\copia\TM2_SUR_REPORTE.xlsx" --hasta=2026-09-17 --respaldo="C:\Galca\respaldos"
```

**Qué revisar:** en la simulación, que los días que quedarían vacíos (si sale ese aviso) sean de verdad días sin
DATA, y que las filas posteriores al corte ya estén en Galca por la app. En la carga: la línea «respaldo: N
fila(s)… escritas y releídas» (guarda ese CSV), «borradas» = ese N, «insertadas» = las del Excel hasta el corte,
lo que hizo cada migración (`005`: sellos `[Clima:]` → 0; `007`: filas por completar → 0 y «ajuste origen» con
FC ≠ 1 → 0) y todo ✓ en la verificación por mes. Si algo falla antes del «COMMIT ✓», Galca queda como estaba.
Relanzarla con el mismo libro y el mismo corte da los mismos ids (`mae-…`, uuid determinista de fecha, nº de
fila y contenido), sin duplicados. Para volver atrás: el CSV de respaldo tiene todas las columnas de `data`.
Probado en banco: `node worker/pruebas/verificar_d186_importar_maestro.mjs --excel="<copia>.xlsx"`.

**Paso 1 — la clave de lectura (una vez; quien despliega el Worker).** Crea una clave aleatoria en
PowerShell, **sin admin**: 32 bytes del generador criptográfico de Windows en base64url (sin `+`, `/` ni `=`,
así va tal cual en la URL):

```powershell
$b = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$clave = [Convert]::ToBase64String($b).TrimEnd('=').Replace('+','-').Replace('/','_')
$clave                                        # cópiala: es la que va en la consulta del Excel
cd worker; npx wrangler secret put CLAVE_LECTURA_EXCEL      # pega la clave cuando la pida
```

(Vale también un GUID: `[guid]::NewGuid().ToString('N')`, aunque es más corta.) Para el entorno de prueba
(`/prueba/obra`) se puede poner otra con `npx wrangler secret put CLAVE_LECTURA_EXCEL_PRUEBA`; si no existe, usa la
de producción, como los demás `*_PRUEBA` (§11). Guárdala donde guardas las otras claves del proyecto (no en el
repo). Hasta que exista el secreto, el enlace responde **503** «falta configurar CLAVE_LECTURA_EXCEL».
La clave **solo lee** la DATA y la Proyección (las mismas vistas que el lector de Power Query); quien tiene el
Excel ya ve esos datos. No da acceso a escribir, a otras tablas ni a la app.

Compruébala en el navegador: `https://api.galca.app/obra?action=data_csv&clave=<CLAVE>` descarga
`DATA.csv` (17 columnas, primera línea `FECHA,GRUPO,…,OBSERVACION`); con otra clave sale «Galca: clave de lectura
incorrecta.» (401).

**Paso 2 — la consulta en Excel (cualquiera que abra el libro, en el Excel de escritorio).**
1. *Datos → Obtener datos → De otras fuentes → Consulta en blanco*. Se abre el Editor de Power Query.
2. *Inicio → Editor avanzado*, borra lo que haya y **pega esta consulta** (cambia solo `<CLAVE>`):

```m
let
    Clave = "<CLAVE>",
    Origen = Csv.Document(
        Web.Contents("https://api.galca.app/obra", [Query = [action = "data_csv", clave = Clave]]),
        [Delimiter = ",", Columns = 17, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Encabezados = Table.PromoteHeaders(Origen, [PromoteAllScalars = true]),
    Vacias = Table.ReplaceValue(Encabezados, "", null, Replacer.ReplaceValue, Table.ColumnNames(Encabezados)),
    Tipos = Table.TransformColumnTypes(Vacias, {
        {"FECHA", type date}, {"GRUPO", type text}, {"CENTRO DE COSTO", type text}, {"CAPITULO", type text},
        {"DESCRIPCION", type text}, {"UNIDAD FUNCIONAL", type text}, {"ELEMENTO", type text},
        {"UNIDAD MEDIDA", type text}, {"LARGO", type number}, {"ESPESOR", type number}, {"FC", type number},
        {"CANTIDAD", type number}, {"CLIMA", type text}, {"OBSERVACION", type text}}, "en-US"),
    Numeros = Table.TransformColumns(Tipos, {
        {"ACTA", each try Number.FromText(_, "en-US") otherwise _},
        {"ABS INICIAL", each try Number.FromText(_, "en-US") otherwise _},
        {"ABS FINAL", each try Number.FromText(_, "en-US") otherwise _}})
in
    Numeros
```

   Qué hace: `Encoding = 65001` lee el UTF-8 (tildes, «ñ»); `QuoteStyle.Csv` respeta comas, comillas y saltos
   de línea dentro de una OBSERVACION; la celda vacía pasa a `null`; la cultura `"en-US"` lee el **punto**
   decimal que manda Galca aunque Windows esté en español. ACTA, ABS INICIAL y ABS FINAL pasan a número; si
   vienen vacías quedan `null` y si traen un texto que no es número (un acta tipo `B06`) se conserva el texto en
   vez de dar error.
3. En el panel derecho, *Propiedades → Nombre*: **`DATA_VIVA`**.
4. *Inicio → Cerrar y cargar*. **La primera vez** Excel pregunta cómo acceder al contenido web: elige
   **Anónimo** (la clave ya va en la consulta), en «nivel» selecciona **`https://api.galca.app/`** y pulsa
   **Conectar**. Si pregunta el **nivel de privacidad**, elige **Organizativo**. Cada PC lo pregunta una sola vez.
5. *Datos → Consultas y conexiones* → clic derecho en `DATA_VIVA` → *Propiedades* → marca **Actualizar al
   abrir el archivo** (y, si se quiere, *Actualizar cada N minutos*). El Worker guarda la respuesta **60 s**:
   dos actualizaciones dentro del mismo minuto traen lo mismo.

**Paso 3 — re-apuntar las dinámicas.** En cada tabla dinámica del maestro: *Cambiar origen de datos* → la
tabla que cargó `DATA_VIVA`. Se conservan campos, formatos y segmentaciones. A partir de ahí, *Actualizar todo*
(o *Actualizar al abrir*, del paso anterior) trae lo último de la base sin reconstruir nada. Nadie edita el Excel
a mano: si un dato está mal se corrige en la fuente (Revisión de DATA / grilla / pantallas) y se refresca.
**Cambio en 'X TRAMOS' (D182):** sus 2 dinámicas usan **PROYECTO** como campo de fila y la vista ya no lo
trae. Al re-apuntarlas, cambia PROYECTO por **UNIDAD FUNCIONAL**. Ninguna otra fórmula ni dinámica del
maestro usa ORDEN, PROYECTO ni LIBERACIÓN. La hoja **DATOS se elimina**: el clima llega en la columna CLIMA.
~~Pero no todavía (D183): el Tablero sigue leyendo DATOS y antes hay que congelar su histórico.~~ **Cerrado
por D185:** el Tablero se calcula en vivo con la DATA (§16) y nada lee DATOS, así que se puede borrar después
del despliegue de D185, sin congelar su histórico. Mientras siga en el libro, su columna X ya no importa.

**La Proyección por la misma vía (D187).** Las 4 vistas `proyeccion_*_maestro` de §15 salen igual, sin
`obra_id`, en `?action=proyeccion_csv&tabla=plan|contrato|rendimiento|parametros&clave=<CLAVE>`. Una consulta en
blanco por tabla, con este texto; cambia solo `tabla = "plan"` y el nombre (**`PROY_PLAN`**,
**`PROY_CONTRATO`**, **`PROY_RENDIMIENTO`**, **`PROY_PARAMETROS`**):

```m
let
    Clave = "<CLAVE>",
    Origen = Csv.Document(
        Web.Contents("https://api.galca.app/obra", [Query = [action = "proyeccion_csv", tabla = "plan", clave = Clave]]),
        [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Encabezados = Table.PromoteHeaders(Origen, [PromoteAllScalars = true]),
    Vacias = Table.ReplaceValue(Encabezados, "", null, Replacer.ReplaceValue, Table.ColumnNames(Encabezados)),
    Tipos = Table.TransformColumns(Vacias, List.Transform(Table.ColumnNames(Vacias), (c) => {c, each
        if _ = null then null
        else if Text.Length(_) = 10 and Text.At(_, 4) = "-" and Text.At(_, 7) = "-" then Date.FromText(_)
        else try Number.FromText(_, "en-US") otherwise _}))
in
    Tipos
```

Las fechas (`periodo`, `CORTE BASE`) salen `yyyy-MM-dd` y pasan a fecha; los números (punto decimal) a número;
PARTIDA, `concepto` y un ACTA no numérica quedan como texto; la celda vacía (plan sin valor) es `null`. Las
columnas y sus nombres son los de la tabla de §15. Los mismos pasos 4 y 5 de arriba (Anónimo, Actualizar al abrir).

**Rotar la clave** (si sale de la obra alguien que la tenía, o una vez al año): crea otra con el Paso 1 y
`npx wrangler secret put CLAVE_LECTURA_EXCEL` (reemplaza la anterior al instante: la vieja da 401 aunque la
respuesta esté en la caché, porque la caché solo se lee **después** de validar la clave). Luego, en el Excel,
*Datos → Consultas y conexiones* → cada consulta (`DATA_VIVA` y las `PROY_*`) → *Editar* → *Editor avanzado* →
cambia la línea `Clave = "…"` → *Cerrar y cargar*, y guarda el libro. Quien abra una copia vieja del Excel verá el
error de la clave hasta tener el libro nuevo.

**Si falla la actualización.**
- «No se pudo autenticar con las credenciales proporcionadas» / *Acceso denegado*: el Worker devolvió **401**
  (clave vacía o mala; Excel lo muestra como problema de credenciales, no con el texto). Revisa la línea `Clave`.
  Si Excel guardó otras credenciales para el sitio: *Datos → Obtener datos → Configuración de origen de datos* →
  `https://api.galca.app/` → *Editar permisos* → **Anónimo**.
- 429 «demasiados intentos»: más de 10 claves malas en un minuto desde esa red. Espera un minuto.
- 503: falta el secreto `CLAVE_LECTURA_EXCEL` en el Worker (Paso 1) u `/obra` no está en `db` (§12).
- Para ver el mensaje exacto, abre el enlace del Paso 1 en el navegador.

**Límites.** Funciona en el **Excel de escritorio** (Microsoft 365 / 2016 o posterior en Windows), para
cualquiera que abra el libro, sin instalar nada. **Excel para la web** no crea ni edita consultas de Power Query
y no garantiza actualizar una consulta Web: el libro se actualiza al abrirlo en el escritorio; en la web se ve
lo último que se guardó. En **Mac**, Power Query «Desde la Web» existe en Microsoft 365 recientes, pero no está
probado aquí. La clave queda **escrita en el libro** (cualquiera que lo tenga la puede leer en el Editor
avanzado): es a propósito, porque solo lee lo que ese libro ya enseña; por eso se rota si el libro sale de la obra.

**Alternativa (solo con permisos de administrador / Power BI): conector PostgreSQL.** Para Power BI Desktop o
un equipo donde alguien con admin haya instalado **Npgsql** (el proveedor que exige *De una base de datos →
PostgreSQL*). No hace falta para el maestro.
1. **Usuario de solo lectura.** Aplica una vez `worker/sql/roles_lectura_maestro.sql` en Supabase (SQL Editor),
   con una clave fuerte. Crea `tm2_lector_maestro`, que **solo** puede `SELECT` sobre `data_maestro` (ni
   escribe, ni ve otras tablas). Host, puerto y modo del pooler salen de Supabase → *Project Settings →
   Database* (pooler en modo sesión, puerto 5432; o transacción, 6543). Da igual aplicarlo antes o después de
   `005`: el `DROP VIEW` de `005` borra el permiso, pero la misma `005` vuelve a dar el `SELECT` si el rol ya
   existe. Si la vista se recrea por otra vía, vuelve a correr este archivo. Desde D183 el mismo rol lee también
   las 4 vistas de la **Proyección** (`proyeccion_*_maestro`); sus consultas M por PostgreSQL están en §15.
2. **Conexión.** *Datos → Obtener datos → De una base de datos → PostgreSQL*. Servidor = `<host>:5432`, base =
   la del proyecto; credenciales = `tm2_lector_maestro` / la clave. En el navegador elige la vista
   **`data_maestro`**. O pega esta consulta M (Editor avanzado), que además **quita** la columna técnica
   `obra_id` y deja los encabezados del maestro en orden:

```m
let
    Origen = PostgreSQL.Database("<host>:5432", "<base>"),
    Maestro = Origen{[Schema="public", Item="data_maestro"]}[Data],
    SinObra = Table.RemoveColumns(Maestro, {"obra_id"})
in
    SinObra
```

3. Re-apuntar las dinámicas igual que en el Paso 3 (a esta consulta en vez de a `DATA_VIVA`).

**Paso 4 — verificación de PARIDAD de 30 días antes del corte** (informe 4.01 §7 punto 8). Antes de dejar
de pegar A:S, corre en paralelo 30 días: exporta la vista y compárala contra el maestro pegado, **sobre el
layout D182**. Del maestro se descartan ORDEN, PROYECTO, LIBERACIÓN y Columna1, y se comparan celda a celda
FECHA…CANTIDAD. El **CLIMA se compara por día**: el sello `[Clima: X]` que el copiado del jefe deja en la
OBSERVACIÓN de la primera fila de cada día, contra la columna CLIMA de la vista. La **OBSERVACIÓN** queda
fuera de la comparación carácter a carácter, porque el copiado del jefe nunca llevó su texto (D65) y en esa
columna del maestro solo va el sello (D131). **ACTA, ESPESOR, FC y CANTIDAD (D184)** ya se comparan: desde
D184 la base las trae llenas en todas las filas (el Worker las escribe al enviar y `007` rellenó las viejas;
§13, «Qué se llena solo»), y en el maestro las siguen poniendo sus fórmulas y lo que teclea el jefe, porque el
copiado A:O deja ORDEN y ACTA vacías y no lleva ESPESOR/FC/CANTIDAD. Cómo compararlas:
- **ACTA:** celda a celda, como texto (en el Excel puede venir como número). Tienen que cuadrar todas: es la
  misma regla del periodo 16→15.
- **ESPESOR y FC:** celda a celda. Las diferencias **esperables** son las filas en que el jefe tecleó en el
  Excel un ESPESOR o un FC distinto del más usado para esa actividad (el que pone la base: `fc_actividad`, o 1).
  Por cada una: si el valor del Excel es el bueno, se corrige en la Revisión de DATA (§13); si era un error
  de digitación, se deja y se anota.
- **CANTIDAD:** redondeada a 6 decimales, porque la base guarda `round(LARGO × ESPESOR ÷ FC, 6)` y el Excel,
  todos los decimales. Una diferencia que no se explique por el ESPESOR o el FC es una cantidad tecleada a
  mano en el Excel, encima de la fórmula (en la DATA del Excel hay un caso así el 12-sep-2026: un acero con
  LARGO 300 y CANTIDAD 1200). Se revisa igual: si vale, se corrige en la base. En el histórico de la DATA del
  Excel hay **tres** filas cuya CANTIDAD no sale de LARGO × ESPESOR ÷ FC, y `007` no las toca porque nunca
  pisa un valor: ese acero del 12-sep-2026; una demolición del 06-ago-2026 (2,3 × 1,5 × 0,3 = 1,035: esa celda
  **multiplica** por el FC); y la excavación aprovechable del 04-sep-2025 con ESPESOR vacío y CANTIDAD 0, a la
  que `007` le puso ESPESOR 1 y dejó la CANTIDAD en 0 (§13, «Límite conocido»). Son diferencias esperables:
  que el jefe las revise en la Revisión de DATA. La consulta de §13 las lista.

Volcado de referencia de la vista, para diff:

```bash
# layout D182 (17 columnas del maestro + internas), un mes, en orden y con vacío='' (idéntico a lo que ve Power Query)
psql "<cadena de tm2_lector_maestro>" -c "\copy (SELECT * FROM data_maestro WHERE \"FECHA\" BETWEEN '2026-08-16' AND '2026-09-15' ORDER BY \"FECHA\") TO 'maestro_vivo.csv' WITH CSV HEADER"
```

Sin `psql` ni el rol (D187): el mismo CSV que lee el Excel, entero (17 columnas, UTF-8 con BOM, en orden de FECHA):
`curl -o maestro_vivo.csv "https://api.galca.app/obra?action=data_csv&clave=<CLAVE>"`, y se filtra el mes al comparar.

Cuando 30 días cuadren (celda a celda en las columnas comparadas, la CANTIDAD a 6 decimales y el CLIMA por
día, con la OBSERVACIÓN fuera y cada diferencia de ESPESOR/FC explicada y resuelta), se deja de pegar A:S y el
maestro pasa a conexión viva.
**Toca / supersede parcialmente la D65** (hoy el maestro se alimenta por pegado desde la pantalla del jefe).
El **Parte Digital de Maquinaria** queda fuera: no usa dinámicas; su traspaso por pantalla sigue igual.

## 15. Proyección — plan, contrato, rendimientos y FC editables en Galca (4.01 · V3-11 · D183)

Fuente única de edición (D181) aplicada a «lo proyectado» del jefe: el **plan mensual**, el **contrato con su
línea base**, los **rendimientos por equipo** y el **FC** dejan de teclearse en las hojas CALCULOS y MAPEO del
Excel y en constantes del Tablero, y se editan en Galca. Pantalla `proyeccion.html`; se entra desde el **Panel
de Obra (Hub)** (pestaña Proyección), el **menú del admin** y el **Panel del Jefe**. Desde D185 el Tablero la
recibe cada vez que se abre, dentro de `?action=tablero_vivo` (§16); con D183 la leía al pulsar «Actualizar».

- **Quién edita** (guard en el Worker, `permiso_`, no el cliente): **admin y jefe**. El **residente la ve en
  solo lectura**: sin editor ni Guardar, y el servidor rechaza un guardado directo. La pantalla toma el modo
  del `puede_editar` que manda el servidor.
- **Qué edita.** Son cuatro pestañas con **un solo Guardar** para todas:
  - **Plan mensual.** Un renglón por periodo 16→15 (se ve `sep-2026`, con su ACTA en gris) × Excavación ·
    Terraplén · Subbase · Base · No aprov., en m³ **compactos**. La excavación es la **total** (aprovechable +
    préstamo + no aprov.) y el no aprovechable va dentro de ella. ＋Periodo añade el mes siguiente al último y
    ✕ elimina uno. El total del pie («Total (N periodos)») no se guarda. En una celda se puede teclear
    `=47724+3413`: se guarda el resultado y también la fórmula, que se marca en la esquina y sale en el
    tooltip. Teclear un número la borra. Las 8 fórmulas que en el Excel apuntaban a otra celda de la misma fila
    (`=+D16*1.2`, filas 15–18 de CALCULOS: de ago-2026 a nov-2026, Excavación = Terraplén × 1,2 y No aprov. =
    Excavación × 0,2; en ago-2026, Terraplén = Excavación × 0,7) se guardaron con su **valor fijo**: llevan otra
    marca (ámbar), el tooltip dice de qué fórmula salían y **no se recalculan**. Si se cambia la celda de la que
    salían, la pantalla avisa para corregirlas a mano. Que se recalculen solas queda para el dueño.
  - **Contrato y línea base.** Partida · UF · Programado · Producción base (MAPEO I8:M16). Aquí la excavación
    es la **común** y el préstamo va sin UF. Debajo, el resumen por partida que usa el Tablero y la línea
    «Línea base al cierre del acta X → corte dd-mmm-aaaa».
  - **Rendimientos.** El rendimiento **compacto por equipo-día** de cada partida (850/450/350/470). En gris:
    el FC, el proyectado suelto por equipo (rendimiento × FC, el de CALCULOS P1:T1) y la vara por hora
    (rendimiento ÷ 8).
  - **Parámetros.** El **FC**, uno solo para todo (1,3), y el **acta base** (22), elegida de la lista de actas.
    El **corte** (16-ago-2026) sale solo: es el día siguiente al cierre de ese acta.
  - Edición tipo Excel: celda, rango, copiar/pegar (TSV), Ctrl+D, Ctrl+Z/Y (un solo historial para las cuatro
    pestañas) y Ctrl+S. Los números van en formato colombiano: coma decimal, y `47.724` es 47724.
- **Validación server-side** (`POST ?action=proyeccion_guardar`, `worker/src/api/obra/proyeccion.js`):
  - Los cambios de las cuatro pestañas van en **una transacción**, con lock `proyeccion:tm2sur`.
  - `if_version` es **obligatorio** en correcciones y bajas, y tiene que ser un entero (un `if_version` de solo
    espacios no vale como 0). Alta y baja existen **solo en el plan**; las otras pestañas solo se corrigen. Un
    periodo que ya existe es un conflicto `duplicado`. En el plan la versión del alta y de cada corrección sale de
    la secuencia `proy_plan_version_seq`: un periodo borrado y vuelto a crear nunca repite versión, y quien tenga
    la pantalla vieja choca en vez de pisarlo.
  - Una fórmula viaja **con el número de su celda** (sin él, o con la celda vacía, se rechaza), y un cambio que
    solo trae `formulas:{}` no es un cambio («no trae nada que guardar»).
  - Antes de abrir la transacción se rechaza, con un texto legible, todo lo que haría saltar la base: números
    ≥ 0 y hasta 1e9, rendimiento > 0, **FC entre 0,5 y 3**, acta base existente o entera, partida y UF del
    catálogo, campos fuera de la lista blanca, la misma fila dos veces en un lote o más de 500 cambios.
    Nunca responde un 500.
  - Si una fila choca, **no se guarda nada** y vuelve la Proyección fresca; la pantalla conserva encima los
    cambios que no chocaron.
- **Lecturas:** `GET ?action=proyeccion` (cualquier sesión: las cuatro tablas, las actas y `puede_editar`) y
  `GET ?action=proyeccion_tablero` (sesión obligatoria, **no pública**). Esta última es lo que consumía el
  Tablero de D183. Desde D185 el Tablero recibe lo mismo, **sin** `usuario`, dentro de `tablero_vivo` (pública,
  §16), y `proyeccion_tablero` queda para `comparar_proyeccion.mjs`. Trae: plan por periodo, proyectado por equipo (1105/585/455/611), contrato y línea base sumados por
  partida, FC, acta base, corte, y la fecha y el autor de la última edición.
- **Esquema:** `worker/sql/006_proyeccion.sql` (`esquema_version` 6), con `proy_plan`, `proy_contrato`,
  `proy_rendimiento` y `proy_parametros`. Llevan `version`/`editado_por`/`editado_ts` y RLS, y se siembran con
  los valores exactos del Excel del jefe: 17 periodos, de ago-2025 a dic-2026, y sumas de contrato y línea
  base iguales a las constantes que tenía el Tablero. Va **después de `005`** (§12). Es idempotente:
  re-aplicarla no pisa lo editado ni resucita una fila borrada, aunque una tabla vaciada entera sí se vuelve a
  sembrar. Sin `006`, los tres endpoints responden «falta aplicar worker/sql/006_proyeccion.sql» y el Tablero
  calcula con sus constantes de respaldo (con D183 caía al Excel).

**El Tablero con la Proyección (desde D185).** El Tablero ya no se «Actualiza» ni lee Excel de producción: se
calcula en vivo al abrirse (§16) y recibe la proyección dentro de `tablero_vivo`. De ella toma el plan mensual,
el proyectado por equipo (la vara), el FC, el contrato y **la línea base con su corte**. El **avance** contra el
contrato se calcula así (decisión final del dueño, 19-sep-2026):

> avance = **Producción base** (pestaña «Contrato y línea base», sumada por partida: lo certificado hasta el
> cierre del acta base) **+ Σ de la DATA de Galca con fecha ≥ el corte** (16-ago-2026 con el acta 22), ÷
> **Programado**. En esa suma, la excavación común = aprovechable + NO aprovechable y el préstamo va aparte.

Por eso, si se corrige una «Producción base» o se cambia el acta base, el avance del Tablero se mueve. Admin y
jefe lo ven al instante; el público, en como mucho 60 s, por la caché. **La pantalla Proyección no cambia con
D185**: no lleva columnas de conciliación con la DATA (se llegaron a implementar y el dueño las quitó), y
`GET ?action=proyeccion` trae lo mismo que en D183. El renglón de estado del Tablero ya no dice de dónde salió
la proyección, porque es de Galca o de las constantes de respaldo. Lo dice su tooltip: «Proyección de Galca
(act. dd-mmm hh:mm)», o «(valores iniciales, sin ediciones)» si nadie ha guardado todavía, o «Proyección de
respaldo (constantes del Tablero)» si no está `006`. El panel **«Comparación con el Excel»** ya no existe. La
comparación Galca ↔ Excel queda en `tools/sandbox/comparar_proyeccion.mjs`, que sigue leyendo la hoja DATOS por
la ruta de archivos del motor.

**Vistas espejo para Power Query.** Encabezados literales del Excel, con `obra_id` delante:

| Vista | Columnas, en este orden | Refleja |
|---|---|---|
| `proyeccion_plan_maestro` | `obra_id` · `periodo` (date) · EXCAVACION · TERRAPLEN · SUBBASE · BASE · NO APROV · ACTA (texto) | CALCULOS A:J, el planificado; ACTA es nueva, al final |
| `proyeccion_contrato_maestro` | `obra_id` · PARTIDA · Programado UF1 · Programado UF2 · Programado · Produccion UF1 · Produccion UF2 · Produccion | MAPEO I7:M16; el préstamo va en las columnas UF1 y en el total |
| `proyeccion_rendimiento_maestro` | `obra_id` · concepto · EXCAVACION · TERRAPLEN · SUBBASE · BASE | CALCULOS O1:T4, con las filas `proyectado suelto equipo`, `rend. compacto por equipo` y `fc` |
| `proyeccion_parametros_maestro` | `obra_id` · FC · ACTA BASE · CORTE BASE (date) | FC único, acta y corte de la línea base |

PARTIDA lleva las etiquetas de MAPEO: `Excavacion comun`, `Terraplen`, `Subbase`, `BTC` y `Excavacion
Prestamos`. En el plan, una celda vacía sale como `null`.

**Camino principal (D187): «Desde la Web», sin instalar nada**, con la clave de lectura: la consulta M
`PROY_*` de §14 («La Proyección por la misma vía»), una por tabla, ya sin `obra_id`. **Alternativa (solo con
admin / Power BI)**, por el conector PostgreSQL de §14 con el usuario `tm2_lector_maestro`: una consulta por
vista; cada una quita la columna técnica `obra_id` (Editor avanzado):

```m
// Plan mensual (CALCULOS)
let
    Origen = PostgreSQL.Database("<host>:5432", "<base>"),
    Vista = Origen{[Schema="public", Item="proyeccion_plan_maestro"]}[Data],
    SinObra = Table.RemoveColumns(Vista, {"obra_id"}),
    Orden = Table.Sort(SinObra, {{"periodo", Order.Ascending}})
in
    Orden
```

```m
// Contrato y línea base (MAPEO I7:M16)
let
    Origen = PostgreSQL.Database("<host>:5432", "<base>"),
    Vista = Origen{[Schema="public", Item="proyeccion_contrato_maestro"]}[Data],
    SinObra = Table.RemoveColumns(Vista, {"obra_id"})
in
    SinObra
```

```m
// Rendimientos por equipo (CALCULOS O1:T4)
let
    Origen = PostgreSQL.Database("<host>:5432", "<base>"),
    Vista = Origen{[Schema="public", Item="proyeccion_rendimiento_maestro"]}[Data],
    SinObra = Table.RemoveColumns(Vista, {"obra_id"})
in
    SinObra
```

```m
// Parámetros (FC, acta y corte de la línea base)
let
    Origen = PostgreSQL.Database("<host>:5432", "<base>"),
    Vista = Origen{[Schema="public", Item="proyeccion_parametros_maestro"]}[Data],
    SinObra = Table.RemoveColumns(Vista, {"obra_id"})
in
    SinObra
```

**Permisos.** `006` da el `SELECT` de las 4 vistas a `tm2_lector_maestro` si el rol ya existe, y
`roles_lectura_maestro.sql` lo da si las vistas ya existen: el orden entre los dos da igual. El rol **nunca**
ve las tablas `proy_*`. `006` también quita todo a `anon` y `authenticated` (los roles de la API REST de
Supabase), sobre las tablas, las vistas y la secuencia de versiones del plan, porque una vista corre con los
permisos de su dueño y se saltaría el RLS. Y lo quita también de **`data_maestro`** (la vista de DATA, de
`001`/`005`), que ninguna migración anterior cerraba: `005` la recrea y los permisos por defecto de Supabase se
la vuelven a dar. Si alguna vez se vuelve a correr `005`, corre `006` después (es idempotente). Conviene
comprobarlo en Supabase: `SELECT has_table_privilege('anon','public.data_maestro','SELECT');` debe dar `false`.
**Regla (D183):** toda migración que recree una vista `*_maestro` repite su bloque `DO` de permisos, porque el
`DROP` se lleva los `GRANT`.

**Lo que NO cambia.**
- ~~La producción diaria (hoja DATOS) y las horas de máquina siguen saliendo de los Excel.~~ **Cambió con
  D185 (§16):** la producción sale de la DATA de Galca y las horas del libro de partes que admin/jefe cargan una
  vez en Galca. Nada de maquinaria se automatiza.
- La **lectura pública** del tablero (D161): sin login. Desde D185 el público lo ve **en vivo**
  (`tablero_vivo`), y la foto publicada y la embebida quedan de respaldo. `proyeccion_tablero` pide sesión y
  publicar sigue siendo cosa de admin y jefe. Ni la foto publicada ni `tablero_vivo` llevan **quién** editó la
  Proyección: el dueño decidió quitar el usuario del público (`tablero_vivo` lo quita y la foto de respaldo se
  arma sin él; `paraPublicar()` ya no existe desde D185).
- El **Excel no se re-cablea.** CALCULOS y MAPEO conservan sus números tecleados. Desde D183 la fuente es
  Galca (D181), y lo que se cambie aquí no vuelve solo a esas hojas: si el jefe quiere la proyección en el
  Excel, la trae por Power Query desde las vistas. `comparar_proyeccion.mjs` avisa cuando el Excel y Galca
  difieren.
- Quedan en el Excel, porque nada los consume: la hoja **PROYECCION 10+**, el número de equipos, el
  rendimiento de no aprovechable, los umbrales del semáforo y las fechas del plan.
- `sw.js` no cambia: `proyeccion.*` no entra al precache y `CACHE_V` no sube.
- ~~La hoja DATOS no se borra hasta las Fases B y C, y antes hay que congelar su histórico.~~ **Cerrado por
  D185:** con el Tablero en vivo nada lee DATOS, y el dueño puede borrarla después del despliegue. Su histórico
  **no** se congela: el Tablero enseña lo que dice la DATA, así que jun y jul-2025 salen con producción 0 (con
  su maquinaria) y los periodos
  anteriores a ago-2026 difieren de DATOS (§16). El avance no se ve afectado, porque parte de lo certificado.

**Probar en el sandbox.** `node tools/sandbox/servidor.mjs` levanta la Proyección con los valores sembrados por
`006`. El paso a paso está en `tools/sandbox/README.md`, sección «Probar el Tablero EN VIVO y la Proyección»:
1. Entra como jefe y abre Proyección → «Contrato y línea base»: la Producción base es el punto de partida del
   avance del Tablero.
2. Abre el Tablero: el avance de cada partida = Producción base + lo de la DATA desde el 16-ago-2026, ÷
   Programado.
3. Cambia un número del plan (sep-2026 · Subbase), pulsa Guardar y recarga el Tablero: la barra del plan de ese
   periodo cambia.

Lo mismo sin navegador:
```bash
node tools/sandbox/comparar_proyeccion.mjs --excel="<copia de producción>" [--partes="<copia de partes>"] [--url=http://127.0.0.1:8099] [--cambiar=2026-09:subbase=5000]
```
Sale con 0 si el Tablero da lo mismo con la proyección de Galca que con la del Excel. Ni el sandbox ni el
guion escriben en los Excel (D24).

**Despliegue.** Producción ya está en `db`, y D183 va en la misma rama que D182:
0. Solo si D184 va en el mismo despliegue: **`007_data_completa.sql`** en Supabase, **antes** del front y del
   Worker. Es la primera de sus dos pasadas: el Worker nuevo tiene que encontrar ya la tabla `fc_actividad`
   (§12).
1. **Front:** merge a `main`. Pages publica `proyeccion.*`, `hub-jefe.js`, `menu.html`, `jefe.*` y el
   `tablero-produccion.*` nuevos.
2. **`wrangler deploy`**, con los tres endpoints.
3. En Supabase (SQL Editor o `psql`): **`005_data_clima.sql`**, si D182 aún no está aplicada, y después
   **`006_proyeccion.sql`**. Si D184 va en el mismo despliegue, a continuación **otra vez
   `007_data_completa.sql`** (la segunda pasada, §12).
4. **`roles_lectura_maestro.sql`**, otra vez, si el rol `tm2_lector_maestro` se creó después de `006`. Es
   idempotente, y si el rol ya existía, `006` ya le dio el `SELECT`.
5. **Comprobar:**
   - Proyección como jefe (4 pestañas, 17 periodos) y como residente (solo lectura).
   - Con D185 (§16), el Tablero sale «En vivo · DATA al …» y su tooltip dice «Proyección de Galca (valores
     iniciales, sin ediciones)». Para saber si el jefe cambió CALCULOS o MAPEO en el Excel después del
     18-sep-2026, corre `comparar_proyeccion.mjs --url=…` con una copia del Excel; lo que difiera se corrige en
     Proyección.

En la Proyección y el Tablero, los estados intermedios no rompen nada. La Revisión de DATA sí tiene una
ventana, por D184: entre los pasos 1 y 2 no se guarda nada en ella (§12). Con D185 en el mismo front, el
Tablero con el Worker viejo enseña la foto publicada con aviso ámbar (§16, «Despliegue»). Lo que sigue es el
Tablero de D183, sin D185: con el Worker viejo calculaba con el Excel y decía «el
servidor aún no tiene la Proyección (falta desplegar el Worker de D183)», y la pantalla Proyección dice lo mismo
y no deja editar ni guardar. Sin `006`, los dos dicen «falta aplicar worker/sql/006_proyeccion.sql». No la uses
hasta terminar el paso 3. **Vuelta atrás:** no hace falta tocar la base. Si Galca falla, el Tablero ya
cae solo a su respaldo (con D183, al Excel; con D185, a la foto publicada), y las tablas `proy_*` y sus vistas
pueden quedarse.

## 16. Tablero en vivo — la producción desde la DATA de Galca (4.01 · V3-11 Fases B+C · D185)

El Tablero de producción (`tablero-produccion.html`, el enlace `https://tm2.galca.app/tablero/` de los
directivos) ya **no se «Actualiza» ni lee Excel de producción**. Se calcula **al abrirlo, para todos**, también
sin sesión, con lo que hay en Galca en ese momento:
- la **producción**: toda la DATA de Galca (todos los periodos), plegada por fecha con el mapeo de siempre;
- la **maquinaria** (horas): la del último libro de partes que admin o jefe cargaron en Galca;
- la **proyección** (plan mensual, vara, FC, contrato y línea base): la de la pantalla Proyección (§15).

La hoja **DATOS** del Excel ya no la lee nada: el dueño puede borrarla después del despliegue.

**Cómo funciona.**
- Al abrir, la página pinta enseguida lo último que vio ese equipo (o la copia embebida en el archivo) y pide
  `GET /obra?action=tablero_vivo`: sin token si no hay sesión y con el token si la hay. El motor (`construir`)
  calcula en el navegador, como siempre. Mientras está abierta se recalcula **cada 5 minutos**, y también al
  volver a la pestaña si el último cálculo tiene más de un minuto.
- **El pliegue** (`worker/src/api/obra/pliegue.js`, `sumaPorDia_`) suma en la base, por FECHA y campo, la
  vista `tablero_data_campo` de `008`: cada fila de DATA con su CANTIDAD compacta (si está vacía, LARGO ×
  ESPESOR ÷ FC, con FC vacío = 1: un respaldo que no es la regla de la Revisión de DATA, que usa el FC de la
  actividad; solo cuenta en filas con LARGO y sin CANTIDAD, que `007` rellena, así que **tras un backfill de
  DATA hay que re-aplicar `007` antes de dar por buena la cifra**) y el campo que le da `tablero_mapeo`. **Cada
  cifra compacta del Tablero es Σ CANTIDAD** de las
  filas de DATA. El periodo es el 16→15, nombrado por el mes de cierre y con el piso 2025-06 de DATOS!C, y el
  clima es el del día (D182). Los días viajan en suelto-equivalente (× el FC de la Proyección) y el motor los
  vuelve a dividir por ese mismo FC.
- **`tablero_mapeo`** es el MAPEO A2:C10 del Excel del jefe: 9 filas con el texto verbatim de la BASE.
  Excavación aprovechable, préstamo y no aprovechable cuentan en cualquier UF (`*`). Terraplén, subbase y base
  estabilizada van por UF1 y UF2. El cruce es por descripción normalizada (`normTexto`), y una fila con UF
  concreta gana a la de `*`. Se edita en el Table Editor de Supabase, como `fc_actividad` (§13). Si la BASE
  cambia el texto de una de esas descripciones, hay que cambiarlo aquí también, o esa actividad deja de contar
  en el Tablero.
- **El avance contra el contrato** (decisión final del dueño, 19-sep-2026) = **producción base certificada** de
  la Proyección (hasta el cierre del acta base) **+ Σ de la DATA con fecha ≥ el corte** (16-ago-2026), ÷
  contrato. En esa suma, la **excavación común = aprovechable + NO aprovechable**, que es como la certifica el
  acta, y el préstamo va aparte. Lo anterior al corte sale de lo certificado, no de la DATA (§15).
- **El renglón de estado** dice «**En vivo** · DATA al *17-sep* · maquinaria al *15-ago* (*archivo*)», o «…
  · sin partes de maquinaria cargados». Su tooltip dice de dónde salió la proyección y cuándo lo sirvió Galca.

**Quién carga los partes de maquinaria.** Solo **admin y jefe**, que son los únicos que ven el botón. El
servidor lo comprueba con el token (D109) y al residente le responde «Tu usuario no puede cargar las horas…
No se guardó nada.». Se hace **una vez cada que llega un libro nuevo**:
1. Entra con tu usuario y abre el Tablero desde tu panel.
2. Pulsa **«Cargar partes de maquinaria»** y elige **solo** el libro de partes, el que trae la hoja **BASE
   MAQUINARIA** (p. ej. `2608 Partes Diarios de Maquinaria … UF1- UF2-UF3.xlsx`; *no*
   `Modelo_Produccion_Maquinaria.xlsx`). Trabaja con una copia, no con el original (D24).
3. El libro se lee **en tu navegador** (uno de más de 10 MB tarda unos segundos) y a Galca sube solo el resumen
   de `leerHoras`: códigos de máquina, tipos, UF, centros de coste y horas. **Ningún nombre de persona**: el
   servidor rechaza cualquier otra clave. Se guarda comprimido en `tablero_horas` y **reemplaza** al anterior.
4. El renglón dice «maquinaria guardada en Galca en N s: M partes hasta el dd-mmm · ya la ve todo el que abra el
   Tablero». Si falla, lo dice en ámbar y **la maquinaria guardada sigue siendo la anterior**. Si la sesión
   venció, vuelve a entrar y cárgalo otra vez.

**Caché de 60 s.** El Worker guarda la respuesta de `tablero_vivo` 60 s en la Cache API de Cloudflare, por centro
de datos, con una clave por entorno (producción y `/prueba`). Todos los que abren el Tablero en ese minuto leen
la misma respuesta sin tocar la base. **Admin y jefe, con su token, se la saltan**: ven al instante lo que
acaban de corregir, y su respuesta fresca queda en la caché para los demás. El residente lee como el público. `enviar_data`, `data_grid_guardar`, `proyeccion_guardar`
y `tablero_horas_guardar` borran la clave de su entorno en ese centro de datos, y los demás se renuevan solos en
≤ 60 s. Un cambio hecho a mano en Supabase (Table Editor, una migración) **no** la borra: el público lo ve como
mucho 60 s después. Para diagnosticar, la cabecera `X-Tablero-Cache` de la respuesta dice `HIT`, `MISS`,
`BYPASS` (admin/jefe) o `SIN` (sin Cache API, como en el sandbox).

**Qué ve el público** (D161, ampliada por D185). `tablero_vivo` es público: pasa sin token, antes de la puerta,
y no escribe LOG. Trae los días de producción, los códigos de máquina y sus horas, la proyección **sin** el
usuario que la editó y, de la maquinaria, solo el nombre del archivo y cuándo se cargó (sin quién). Las
**cifras de obra** las ve cualquiera que tenga el enlace: es la decisión, no un descuido. Escribir (cargar
partes, publicar la foto) sigue siendo de admin y jefe.

**La foto de respaldo.** La foto publicada de D158 (`?action=tablero`) queda de respaldo. Tras cada cálculo en
vivo, el Tablero de admin/jefe la publica **solo si lo calculado cambió**, nunca una **sin maquinaria** (pisaría
la buena de todos) ni por encima de una más nueva. El renglón añade «foto de respaldo publicada», o el motivo
en ámbar si no se pudo.

**Si algo falla.** La página nunca se queda en blanco:

| Lo que ves | Por qué | Qué hacer |
|---|---|---|
| «No se pudo calcular en vivo (*motivo*): se muestra la **foto publicada** · …» (ámbar) | Sin red, 25 s sin respuesta, Worker caído o sin desplegar, `008` sin aplicar | Nada urgente: se ve la foto. Si sigue, revisa el motivo; con «falta aplicar worker/sql/008_tablero_vivo.sql», aplica `008` |
| Lo mismo, pero «la última copia vista en este equipo» o «la copia incluida en la página» | Tampoco se pudo leer la foto publicada, o la que había era más vieja | Igual que arriba; la próxima vez que haya red se recalcula solo |
| «… · sin partes de maquinaria cargados» | Nadie ha cargado el libro de partes en este entorno | Admin o jefe: «Cargar partes de maquinaria» |
| «maquinaria al *fecha vieja*» | El libro guardado es viejo | Cargar el libro nuevo |
| El público no ve una corrección que el jefe ya ve | La caché de 60 s | Esperar un minuto y recargar |
| «no se pudo cargar el libro de partes: … (vuelve a entrar con tu usuario…)» | La sesión venció | Entrar otra vez y cargarlo de nuevo |
| «el libro no trae partes con horas de la flota del reparto» | Se eligió otro archivo (p. ej. el de producción) | Elegir el libro con la hoja BASE MAQUINARIA |
| Una partida da cero o baja de golpe | Cambió el texto de una descripción en la BASE y ya no casa con `tablero_mapeo` | Corregir `tablero_mapeo` en el Table Editor |

**Qué cambia respecto a la hoja DATOS** (aceptado por el dueño). El Tablero enseña lo que dice la DATA, sin
corregirla (D185(j)):
- **jun y jul-2025 salen con producción 0**, porque la DATA empieza el 1-ago-2025. Siguen en el selector con su
  maquinaria (unas 1.067 h con el libro actual), porque los periodos en vivo son los de la DATA más los de los
  partes cargados, desde el piso 2025-06;
- las filas «**ajuste origen**» del 1-ago-2025 son cuadres del jefe (lo certificado antes de la DATA) y van con
  **FC 1** (regla [O], §12 y §13);
- en el total de todos los periodos (jun y jul-2025 incluidos), contra DATOS: terraplén −7,3 %, no
  aprovechable +39,0 % y aprovechable +0,7 %. **Desde el 06-ago-2026 los días coinciden**, porque DATOS pasó a
  ser un `SUMIFS` sobre la DATA, salvo el 13-sep-2026, que DATOS no tiene (602,16 m³ sueltos de no
  aprovechable UF2: +463 m³ compactos). El periodo 2026-08 difiere por sus días anteriores al 06-ago y
  2026-09 solo por ese día;
- el **avance no cambia por esto**, porque hasta el corte parte de lo certificado.

`tools/sandbox/comparar_datos_vs_data.mjs` lo mide periodo a periodo y partida a partida (ver «Cómo probar»).

**Despliegue.** Producción ya está en `db`. D185 va en la misma rama que D182, D183 y D184 y encaja en su
secuencia (§12, §15):
0. En Supabase: **`007_data_completa.sql`** (primera pasada, D184, que ya trae la regla [O]) y, justo después,
   **`008_tablero_vivo.sql`**. Con el front y el Worker viejos, las dos son inocuas.
1. **Front:** merge a `main`. Pages publica `tablero-produccion.*`, `data.js`, `proyeccion.*` y los demás.
   Entre este paso y el siguiente, el Tablero nuevo con el Worker viejo enseña la foto publicada con aviso
   ámbar, y en la Revisión de DATA **no se guarda nada** (§12, D184).
2. **`wrangler deploy` enseguida.** Desde aquí el Tablero se calcula en vivo. Hasta el paso 3 (sin `006`) lo
   hace con el FC de respaldo (1,3) y las constantes del contrato, sin plan del mes y con el aviso ámbar «sin
   la Proyección de Galca (La Proyección todavía no está en la base de datos.)».
3. En Supabase: **`005`** (si D182 aún no está), **`006`** y otra vez **`007`**, en ese orden (§12). `008` no
   hace falta repetirla.
4. **`roles_lectura_maestro.sql`**, como pide D183. `008` no crea vistas `*_maestro`.
5. **Cargar una vez el libro de partes**, como admin o jefe (arriba). Hasta entonces el Tablero sale sin
   maquinaria, y la foto de respaldo **no** se publica, así que la última buena sigue ahí.
6. **Comprobar:**
   - En una ventana privada, sin sesión, abre `https://tm2.galca.app/tablero/`: debe decir «En vivo · DATA
     al *ayer u hoy* · maquinaria al …».
   - Como jefe, corrige una fila en la Revisión de DATA y recarga el Tablero: debe moverse en seguida. El
     público lo ve en ≤ 60 s.
   - En Supabase, `SELECT version FROM esquema_version ORDER BY version DESC LIMIT 1;` debe dar 8, y
     `SELECT has_table_privilege('anon','public.tablero_horas','SELECT');` debe dar `false`.

**Vuelta atrás:** no hace falta tocar la base, porque las tablas de `008` pueden quedarse. Si falla el Worker, el
Tablero ya cae solo a la foto publicada. Volver al Tablero de «Actualizar» con los Excel es revertir
`tablero-produccion.*` en el front, pero la hoja DATOS tiene que seguir existiendo. Con obra en `sheets` no hay
`tablero_vivo`, y el Tablero enseña la foto. El `.gs` no se toca.

**Cómo probar** (sin red, sin tocar producción):
```
node worker/pruebas/contrato_local.js                           # banco: casos obra.tablero_vivo.*, obra.tablero_horas.guardar,
                                                                #   obra.proyeccion.sin_conciliacion, [O] y obra.sql.008.*
node worker/pruebas/verificar_d185_tablero_vivo.mjs             # pliegue = cálculo aparte, caché, horas, avance = base + Σ desde el corte
node worker/pruebas/verificar_d185_tablero_vivo.mjs --excel="<copia de TM2_SUR_REPORTE….xlsx>" --horas="<horas.json>"
node tools/sandbox/comparar_datos_vs_data.mjs --excel="<copia de TM2_SUR_REPORTE….xlsx>"   # DATOS ↔ DATA, informativo
node tools/sandbox/comparar_proyeccion.mjs --excel="<copia…>" --partes="<copia del libro de partes>"  # Galca ↔ Excel
```
- En el navegador: `node tools/sandbox/servidor.mjs` y la sección «Probar el Tablero EN VIVO y la Proyección» de
  `tools/sandbox/README.md`. Es la ventana privada sin sesión, la carga de partes como jefe, una corrección de
  la DATA posterior al corte que sube el día, el periodo y el avance exactamente lo corregido, y la Proyección.
- El sandbox no tiene Cache API (`X-Tablero-Cache: SIN`). La caché se prueba en el banco y en el verificador.
