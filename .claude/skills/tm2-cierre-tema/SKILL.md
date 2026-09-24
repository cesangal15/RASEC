---
name: tm2-cierre-tema
description: "[A · automático] Cierre documental de un tema en TM2 Sur (Galca): genera, listos para copiar, la fila de decisión para 02 con el siguiente número D real, los cambios de PROJECT_CONTEXT, 03 y, si hay deriva, 04 y 05, más la sincronización con CLAUDE.md y los pasos de despliegue. Aplícalo sin que te lo pidan cuando se tome o se cierre una decisión, cuando un cambio quede terminado y verificado, cuando el dueño dé algo por aprobado («listo», «queda así», «cerremos esto») o antes del commit final de una rama con cambios funcionales."
---

# Cierre de tema

Los `docs/` son la fuente de verdad y solo se tocan **al cerrar, en el mismo commit que el cambio**
(CLAUDE.md, «Documentación al cerrar un cambio»). Este skill produce esos bloques con el formato exacto
de cada documento y comprueba que no quede nada desincronizado.

## Pasos

1. **Números reales, nunca de memoria:**
   ```bash
   node .claude/skills/tm2-cierre-tema/scripts/siguiente.js --plantilla --titulo="<título>"
   ```
   Da la siguiente D, el siguiente V3-xx/4.xx, `CACHE_V` y una fila de 02 para rellenar. En el chat del
   Project, sin repo: `--docs=<carpeta con 02 y 03>`, o léelo tú del final de la tabla de 02.
2. **Checklist de deriva:**
   ```bash
   node .claude/skills/tm2-cierre-tema/scripts/deriva.js            # contra origin/main
   node .claude/skills/tm2-cierre-tema/scripts/deriva.js --archivos=a.js,b.html   # sin git
   ```
   Responde, con los archivos de la rama delante:
   - ¿Toca **pantallas, hojas/tablas o endpoints** que lista 04? → bloque para 04.
   - ¿Toca **catálogo** (actividades, máquinas, orígenes, CC, usuarios, roles, áreas)? → bloque para 05
     (con `tm2-catalogo`).
   - ¿Cambia la **precache** del SW? → `CACHE_V`.
   - **Paso obligatorio: ¿cambia la lógica del reparto o del conciliador?** → se actualiza ese skill
     (`tm2-reparto-produccion` / `tm2-conciliador`) **en el mismo cierre**: se revisa su
     `references/funcionamiento.md` y se corre su `probar_*.js`. Si ya no carga, se arregla el skill,
     nunca la herramienta.
   - ¿Se añadieron o cambiaron **skills**? → lista de CLAUDE.md.
3. **Redacta los bloques** con los moldes de `references/formatos.md`, que salen de filas reales de cada
   documento. Deben quedar completos, en español y listos para pegar:
   - **02**: la decisión (una sola línea, append-only). Una D cerrada no se reescribe, se enmienda.
   - **03**: se edita la fila del ítem (Hecho/pendiente), o se crea un ítem nuevo si surgió trabajo no pedido.
   - **PROJECT_CONTEXT**: solo si hay una regla nueva o cambia el estado del proyecto.
   - **04 / 05**: solo lo que marcó la deriva.
   - **CLAUDE.md**: solo si cambió la operación o la lista de skills.
   - **Pasos de despliegue** en el formato de OPERACIONES (numerados, en orden, con Comprobar y Vuelta atrás).
4. **Aplica** los bloques en el mismo commit que el cambio. No toques ningún otro doc de `docs/`. El repo
   es público y se sirve en Pages, así que comprueba que no se cuele nada sensible:
   `node .claude/skills/tm2-cierre-tema/scripts/buscar_sensibles.js` (sin argumentos mira los archivos de
   la rama). El `SHEET_ID` de los `.gs` es una excepción aceptada en `PROJECT_CONTEXT`.
5. **Pregunta** al dueño antes de ejecutar cualquier paso de despliegue (lista corta: qué, dónde, cómo se
   revierte). Lo que prefiera hacer a mano queda como pendiente en el estado de la D y del ítem.

## Nota sobre 04/05
CLAUDE.md limita el cierre a 02/03/PROJECT_CONTEXT. Este skill añade 04 y 05 **solo cuando hay deriva**
(pantalla, endpoint, tabla o catálogo que esos documentos listan), tal como lo pidió el dueño al crearlo
(D211). Todo lo demás de `docs/` no se toca.
