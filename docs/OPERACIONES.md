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

# 2) backfill de obra (BANDEJA, DATA, MAQUINARIA, VOLQUETAS, OBSERVACIONES, TABLERO, USUARIOS, CUBICAJE, BASE)
$env:DATABASE_URL = "postgres://…"
node worker/sql/backfill_obra.js --volcado="C:\Galca\volcado\<fecha>_obra" --simular
node worker/sql/backfill_obra.js --volcado="C:\Galca\volcado\<fecha>_obra"

# 3) backfill de asistencias (necesita volcarAsistencias() primero: hoy NO hay volcado de asistencias en disco)
node worker/sql/backfill_asistencias.js --volcado="C:\Galca\volcado\<fecha>_asistencias" --simular
node worker/sql/backfill_asistencias.js --volcado="C:\Galca\volcado\<fecha>_asistencias"
```

Las transaccionales se anexan con `ON CONFLICT DO NOTHING` (no pisan lo que el Worker ya creó); los catálogos
se reescriben. Desde 4.01 los catálogos (BASE, CUBICAJE, MAQUINAS, USUARIOS, CUADRILLAS, CONFIG, TURNOS, CAT_*)
se editan en Supabase (Table Editor), no en el Sheet: un backfill posterior de un catálogo lo pisa, así que
tras el corte no se re-corren los catálogos salvo para recargarlos a propósito.

**Verificar** (criterio de salida, sin red):

```
node worker/pruebas/contrato_local.js                         # PGlite + backfill del volcado real + los 3 módulos
node backend/pruebas/contrato/correr.js                       # modo vm: los .gs reales, para confirmar que el contrato no cambió
```

Contra la API real (cuando el módulo esté en `db`): `node backend/pruebas/contrato/correr.js --url=https://api.galca.app --solo=asistencias --usuario=… --clave=…` (login en `/obra` de producción mientras obra siga en `sheets`; una vez obra esté en `db`, el login ya lo hace el Worker).

**Corte por módulo** (informe §3, orden Asistencias → Obra): backfill fresco → `BACKEND_ASISTENCIAS="db"` (o
`BACKEND_OBRA="db"`) → `wrangler deploy`. La cola offline redirige sola por `tipo`. Vuelta atrás: la var a
`"sheets"` y `wrangler deploy`; las filas creadas en la BD entre tanto se pegan a mano al Sheet.

**Lo que queda en el Sheet tras el corte:** solo el espejo BD→Sheet de la hoja DATA de obra (vista
`data_maestro`, layout A–T verbatim) para el copy-paste A:S al Excel maestro. Todo lo demás vive en Supabase.
