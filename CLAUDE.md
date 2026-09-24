# Galca (TM2 Sur) — operación de Claude Code

Política de orquestación. El conocimiento del proyecto vive en `docs/` (fuente de verdad): no se copia aquí.

## Idioma
- **Todas las respuestas al dueño van en español** (mensajes, informes, resúmenes, preguntas y descripciones de PR/commits), aunque el sistema o las herramientas estén en inglés.

## Orquestación
- **Opus es el orquestador** (modelo de sesión en `.claude/settings.json`). Recibe "Implementa X", entiende el objetivo, consulta la doc necesaria, decide, ejecuta o delega, integra, verifica y entrega. No pide un prompt de planificación previo.
- **Fable queda reservado para casos extremos y lo decide el dueño.** Si el orquestador detecta una decisión de complejidad excepcional (cambio transversal Apps Script ↔ Worker ↔ Supabase ↔ pantallas con riesgo real sobre datos de producción, o contradicción entre decisiones cerradas), lo dice y consulta antes de seguir; el dueño elige si cambia la sesión a Fable (`/model fable` o `claude --model fable`). Nunca se crea un subagente Fable ni se escala a Fable por cuenta propia.
- **Flujo V1, plano:** Usuario → orquestador → 0–N agentes (`researcher`, `developer`, `architect`, `reviewer`) → orquestador → verificación → resultado. Profundidad máxima 1 y máximo 3 agentes a la vez (nativo en `.claude/settings.json`). Los agentes no crean agentes. Sin Agent Teams, hooks, memoria ni más agentes.
- **Delegar solo con ventaja real:** investigación independiente, análisis especializado, arquitectura compleja, revisión independiente, trabajo paralelizable o aislar mucho contexto. Lo simple, mecánico o localizado se hace directo. Un agente si basta uno. Nunca dos agentes editando los mismos archivos a la vez.
- **Menor modelo suficiente:** Haiku para leer/buscar, Sonnet para implementar y revisar, Opus para orquestar y para el análisis arquitectónico aislado (`architect`: solo cuando conviene sacar del contexto principal un análisis largo). Escalar solo si falla o la dificultad lo justifica. Razonamiento proporcional a la dificultad.
- **Coste del orquestador:** carga por defecto solo `docs/PROJECT_CONTEXT.md`. Lecturas amplias (varios docs, código extenso) van al `researcher`. Lee él mismo 02/03/04/05 solo cuando el resultado condiciona una decisión que va a tomar.
- Preferir estos cuatro agentes a los genéricos cuando exista uno equivalente; los genéricos baratos (p. ej. `Explore`) siguen disponibles si no hay solapamiento.
- Priorizar calidad por unidad de coste y evitar trabajo redundante (no releer lo ya leído, no re-derivar lo ya decidido).

## Skills del proyecto (`.claude/skills/`, D212)
**Los [A] se aplican sin que te los pidan, en cuanto aparece la situación; los [B] solo si se pide EJECUTAR la herramienta** (mencionar el tema o editar su código no es ejecutarla).
- [A] `tm2-cierre-tema`: cierre documental de una decisión o un cambio (02/03/PROJECT_CONTEXT y, con deriva, 04/05; CLAUDE.md; despliegue).
- [A] `tm2-catalogo`: alta, cambio o baja de actividades, máquinas, orígenes, CC, usuarios, roles y áreas, y cubicaje.
- [A] `tm2-validacion`: error o dato raro reportado (primero el dato observable) y prueba de cambios con los arneses.
- [A] `tm2-pantalla-nueva`: crear o modificar una pantalla HTML (esqueleto, CSP, tema, sesión, sw.js, fila en 04).
- [B] `tm2-reparto-produccion`: ejecutar el reparto mensual por CC (`Reparto_Produccion_Maquinaria`) sin abrir la herramienta.
- [B] `tm2-conciliador`: ejecutar la conciliación de actas de transporte (`conciliador/`) sin abrir la herramienta.
Los skills apuntan a `docs/` y a las D; no copian reglas. `tm2-invariantes` no existe en el repo: las invariantes están en `docs/PROJECT_CONTEXT.md`.

## Documentación antes de decidir
- `docs/PROJECT_CONTEXT.md` siempre (reglas críticas y estado). `docs/02_REGISTRO_DECISIONES.md` antes de cualquier cambio funcional: las D-xx cerradas no se replantean.
- Según la tarea: `04_ARQUITECTURA` (backend, endpoints, hojas, flujo), `05_CATALOGO` (actividades, máquinas, CC, usuarios), `03_BACKLOG` (alcance), `OPERACIONES` (entornos, despliegues, pasos manuales), `01_DOCUMENTO_MAESTRO` (referencia completa).
- No inventar funcionalidades fuera del backlog; si surge una idea, proponerla como ítem, no implementarla.

## Verificación ("terminado")
Terminado significa, todo a la vez:
1. Cambios en una rama de trabajo. **Nunca push a `main`** (publica GitHub Pages).
2. Arneses afectados en verde: `node backend/pruebas/verificar_*.js` de lo tocado, `node backend/pruebas/contrato/correr.js` (Apps Script) y `node worker/pruebas/contrato_local.js` (Worker). Si se tocan pantallas, además el banco en Chromium (`NODE_PATH=/opt/node22/lib/node_modules node backend/pruebas/verificar_v301_pantallas.js` y/o `node tools/sandbox/servidor.mjs`).
3. Revisión hecha (`reviewer` o, en cambios triviales, revisión propia del diff) sin hallazgos críticos abiertos.
4. Lista de **pasos de despliegue** en el formato de `docs/OPERACIONES.md` (numerados, en orden, con la acción exacta): redespliegue de Apps Script, `wrangler deploy`, publicar Pages, migraciones SQL, etc. El orquestador pide autorización para ejecutarlos él (ver «Límites de autonomía»); lo que el dueño prefiera hacer a mano queda como pendiente.
El dueño valida con datos reales antes de dar nada por cerrado.

## Límites de autonomía
**Con autorización del dueño, no prohibido** (la idea es automatizar): publicar en `main` (push o merge del PR, que publica GitHub Pages); `wrangler deploy`; escrituras en Supabase y Cloudflare (migraciones SQL, cambios de datos, recursos); modificar o borrar los Excel maestros (`TM2_SUR_REPORTE_DIARIO_OBRA`, `Partes_Diarios_de_Maquinaria_*`) o los Sheets de producción (escrituras contra `api.galca.app` sin `/prueba`).
- **Cómo:** cuando el trabajo esté verificado, el orquestador **pregunta** qué va a ejecutar (lista corta: qué, dónde, cómo se revierte) y, con el sí del dueño, lo ejecuta él mismo y verifica el resultado en producción. El sí vale para lo que se preguntó en esa sesión, no para lo siguiente.
- `.claude/settings.json` tiene estas acciones en `ask`: Claude Code además pide confirmación en pantalla al ejecutarlas. Lo que `ask` no cubre (p. ej. una escritura con `execute_sql`, que también se usa para leer) es política y se cumple igual: primero se pregunta.
- Antes de escribir en producción: respaldo o vuelta atrás definida (migraciones idempotentes con tabla `*_respaldo_*`).

## Documentación al cerrar un cambio
`docs/` no se toca durante el trabajo. Al cerrar, y en el mismo commit, es obligatorio: decisión nueva → `02_REGISTRO_DECISIONES.md` (append-only, siguiente número D); ítem o estado → `03_BACKLOG.md`; regla nueva → `PROJECT_CONTEXT.md`; y solo si hay deriva (pantalla, endpoint, tabla o catálogo que listan), `04_ARQUITECTURA.md` / `05_CATALOGO.md` (D212, `tm2-cierre-tema`). Nada más de `docs/` se modifica ni reorganiza.
