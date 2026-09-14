# OPERACIONES — entorno de PRUEBA (D168)

Cómo tener una segunda copia del sistema (Sheets + Apps Script) para ensayar cambios sin tocar los
datos de la obra, y cómo hacer que el frontend hable con ella.

## 1. Cómo funciona

- Las URLs de los dos Apps Script (**obra** y **asistencias**) viven en UN solo archivo del
  frontend: **`entorno.js`**, en la variable global **`GALCA_ENV`**. Tiene dos juegos:
  `produccion` (los despliegues de siempre) y `prueba` (los que se crean con esta guía). Cada
  pantalla toma su URL de ahí (`GALCA_ENV.url.obra` / `GALCA_ENV.url.asistencias`); ya no hay URLs
  cableadas en los HTML.
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
- **Si `entorno.js` no tiene URLs de prueba** (los dos campos de `prueba` vacíos), `?env=prueba`
  se ignora con un aviso en la consola y se sigue en producción. Nadie puede quedar apuntando a
  una URL vacía.
- Producción no cambia: sin `?env=` y sin nada guardado, `entorno.js` no escribe en localStorage
  y las pantallas usan exactamente las mismas URLs de antes. `auth.js` (pega el token por host
  `script.google.com`), la CSP (mismos hosts) y el service worker (nunca intercepta el Apps
  Script) sirven igual para las dos URLs.

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

## 4. Pegar las URLs en el frontend

En `entorno.js`, bloque `prueba`:

```js
prueba: {
  obra:        'https://script.google.com/macros/s/<ID de la copia de obra>/exec',
  asistencias: 'https://script.google.com/macros/s/<ID de la copia de asistencias>/exec'
}
```

Subir a GitHub Pages. No hace falta subir `CACHE_V` en `sw.js` por cambiar estas cadenas: los
archivos propios se sirven network-first y `entorno.js` se refresca con señal; solo se sube la
versión cuando cambia la LISTA de precache (D82).

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
  la copia, abrir una vez `parte.html?eq=CODIGO&env=prueba` en ese navegador.
