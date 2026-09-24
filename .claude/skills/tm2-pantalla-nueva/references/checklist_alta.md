# Checklist de alta de una pantalla

Cada punto apunta a su decisión. Si una D posterior la enmienda, manda la D. Marca cada punto en el
informe de cierre.

## Código (lo comprueba `scripts/verificar_pantalla.js`)
- [ ] `<nombre>.html` + `<nombre>.js` + `<nombre>.css`, sin JS ni CSS en línea. Eventos con
      `data-on-<evento>="fn(args)"` y estilos con clase o `data-estilo` (D170). La CSP ignora en silencio
      lo que esté en línea, también dentro de un `innerHTML`.
- [ ] La CSP es la misma que en las demás pantallas (D167). Una excepción, como un CDN, se justifica en
      un comentario del HTML, igual que en el reparto.
- [ ] `auth.js` es el primer script y `entorno.js` el segundo (D169/D168). La URL de la API sale de
      `GALCA_ENV.url.<obra|asistencias|parte>`; nunca va escrita en la pantalla.
- [ ] `tema.css` + `tema.js`, solo con tokens (D150). DM Sans/Syne. `.galca-simbolo` en la cabecera (D170).
      «← Menú» o «← Volver» según el rol.
- [ ] Guard de rol en el `.js` (D108/D109). Es solo de interfaz: **el permiso real lo comprueba el
      Worker** con el token firmado, en el endpoint.
- [ ] `esc()` en todo texto que se pinta con `innerHTML` (D167). La fecha por defecto en hora de Bogotá (D50).
      Los POST van con `text/plain` (D30) y llevan `id_registro` de cliente si deben ser idempotentes (D82).

## Integración
- [ ] **Roles:** quién entra. Si hace falta un rol o usuario nuevo, se hace con `tm2-catalogo`
      (tipo «usuario y rol»).
- [ ] **Entrada:** tile en `menu.html` (admin, en su grupo y con el mismo marcado `.tile`) y/o en la
      pantalla de entrada del rol (`seleccion-reporte.js`, `residente.html`…). Solo se toca
      `REDIRIGE_POR_ROL` de `index.js` si la pantalla es el aterrizaje de un rol.
- [ ] **`sw.js`:** una pantalla que necesita señal **no entra** en el precache (network-first la cachea
      al visitarla; sin señal enseña «necesita conexión»). Una captura de campo que deba abrir sin señal
      entra con html+js+css en `PRECACHE`, y en ese caso **se sube `CACHE_V`** en el mismo cambio. También
      se sube si un archivo del precache cambia de forma que los HTML nuevos dependen de él. La regla y
      su historia están en la cabecera de `sw.js` y en `PROJECT_CONTEXT` · Offline (D82/D170/D176).
- [ ] **Backend:** un endpoint nuevo en el Worker (`worker/src/api/…`) con su guard de rol, su esquema
      en la validación de payload si escribe (D166), una fila en `LOG` y un caso en el contrato
      (`backend/pruebas/contrato/casos_*.js`). Los `.gs` están congelados.
- [ ] **Versión PC (D151/D155–D157):** solo si se usa en computador. Envoltorios `display:contents`,
      rejilla desde 1100px, `min-width:0` en las celdas, y el orden en el móvil no cambia.
- [ ] **Documentación de cierre** (`tm2-cierre-tema`): una fila en la tabla «Pantallas y roles» de `docs/04_ARQUITECTURA.md`,
      con el formato `| \`x.html\` | acceso | función (Dxx). |`, más la decisión en 02 y el ítem en 03.

## Pruebas
- [ ] `verificar_pantalla.js --nombre=<x>` sin ✗.
- [ ] En el navegador: `node tools/sandbox/servidor.mjs`, tema claro y oscuro, 390 px de ancho y, si
      aplica, 1280 px. Si es una pantalla de trabajo diario, un caso en el banco de Chromium
      (`backend/pruebas/verificar_v301_pantallas.js` es el molde).
- [ ] Despliegue: publicar Pages (merge a `main`, **con autorización**). Si hay endpoint nuevo, primero
      `wrangler deploy` (orden y formato en `docs/OPERACIONES.md`).

## Excepciones conocidas (no son modelo para una pantalla nueva)
`index.html` (login, sin símbolo ni guard), `parte.html` (pública por QR, D165), `tablero-produccion.html`
(pública, estilo propio, D158/D161) y `Reparto_Produccion_Maquinaria.html` (herramienta de escritorio
con SheetJS desde CDN).
