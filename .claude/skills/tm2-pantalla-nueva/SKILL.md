---
name: tm2-pantalla-nueva
description: "[A · automático] Esqueleto y checklist para crear o modificar una pantalla HTML de TM2 Sur (Galca): tema oscuro/claro con tokens, DM Sans/Syne, ámbar #f5a623, símbolo Galca, «← Menú», sesión y token contra api.galca.app, CSP sin nada en línea. Aplícalo sin que te lo pidan siempre que vayas a crear una pantalla nueva o a cambiar el HTML, JS o CSS de una existente (una sección, un botón, un rol que entra, que funcione en PC o sin señal), para no romper CSP, tema, sesión, precache ni la tabla de pantallas de 04. Sin rediseños."
---

# Pantalla nueva (o cambio en una pantalla)

Una pantalla nueva **se parece a las que ya existen**. Las plantillas de `assets/` salen de pantallas
reales (`mis-extras` para el esqueleto móvil, `encargado` para la rejilla de PC y `hub-jefe` para el
guard). No se rediseña: ni paleta, ni tipografías, ni componentes nuevos. Si el pedido implica un
rediseño, se propone como ítem del backlog.

## Pantalla nueva

1. Confirma en `docs/03_BACKLOG.md` que la pantalla está pedida (si no, propón el ítem) y en
   `docs/04_ARQUITECTURA.md` · «Pantallas y roles» que no existe ya otra que haga lo mismo.
2. Genera los tres archivos desde las plantillas. Nunca sobrescribe, y copia la CSP de una pantalla real:
   ```bash
   node .claude/skills/tm2-pantalla-nueva/scripts/crear_pantalla.js --nombre=<kebab-case> \
     --titulo="<Título>" --etiqueta="<Módulo · Rol>" --roles=admin,<rol> --modulo=obra --accion=<action GET> --decision=D2xx
   ```
   En el chat del Project, sin repo, copia `assets/plantilla.{html,js,css}` y reemplaza los `__MARCADORES__`.
   La CSP se copia de cualquier pantalla actual.
3. Rellena la lógica con los patrones de la plantilla: `leer()` para GET, `escribir()` para POST
   `text/plain`, `esc()` al pintar, `data-on-*` para eventos y `hoy()` para la fecha de Bogotá.
4. Recorre `references/checklist_alta.md`: roles, entrada (tile en `menu.html` u otra), `sw.js`/`CACHE_V`
   (solo si es una captura sin señal), endpoint en el Worker, versión PC (D151) y la fila en 04.
5. Verifica:
   ```bash
   node .claude/skills/tm2-pantalla-nueva/scripts/verificar_pantalla.js --nombre=<x> [--offline]
   ```
   No puede quedar ningún ✗. Luego pruébala en el sandbox (`node tools/sandbox/servidor.mjs`) y corre los
   arneses con `tm2-validacion`.

## Cambio en una pantalla existente

- Corre `verificar_pantalla.js` **antes y después**. El cambio no puede añadir ✗.
- Lo más frecuente que se rompe: un `onclick=`/`style=` dentro de un `innerHTML` (la CSP lo ignora en
  silencio), una URL de la API escrita a mano, un archivo del precache que cambia sin subir `CACHE_V`, y
  el orden del móvil al tocar la rejilla de PC.
- Si cambian los roles que entran o la función de la pantalla, actualiza su fila en 04 al cerrar.

## Entrega
Archivos completos (no fragmentos), el resultado de `verificar_pantalla.js` y los pasos de despliegue en el
formato de `docs/OPERACIONES.md` (Pages, y antes `wrangler deploy` si hay endpoint nuevo). Todo con
autorización del dueño, según CLAUDE.md.
