# Formato exacto de cada documento (tomado de los propios documentos, sep-2026)

Copia el **molde**, no el contenido: las reglas viven en los documentos y aquí solo está la forma.
Antes de pegar, abre el documento y mira las últimas filas por si el formato cambió; manda el documento.

## 02_REGISTRO_DECISIONES.md: append-only, una fila por decisión
Tabla `| ID | Decisión | Estado | Observaciones |`. **Una sola línea física por fila** (sin saltos). Número =
`node scripts/siguiente.js` (nunca de memoria). Las letras (D113b, D63a) son enmiendas en la fila de su D,
no números nuevos. Una D cerrada no se reescribe: una decisión posterior la **enmienda** y lo dice.
- **Decisión**: `**<Título en una frase> — <mes-año>. <Enmienda|Amplía> Dxx**` + contexto (pedido del dueño o
  problema observado, con fecha) + `**Decisión:**` con (1)…(n) concretos + qué NO cambia.
- **Estado**: `✅ Cerrada` · `✅ Cerrada (código); pendiente publicar Pages` · `✅ Hecha y validada en banco;
  pendiente aplicar 0NN en Supabase, `wrangler deploy`, publicar Pages y validar con datos reales`.
- **Observaciones**: `<mes-año>. Archivos: <rutas>. Arneses: <archivo> (n/n)… Despliegue/orden: …`.
- Ejemplo real (D209, recortado): `| D209 | **El Tablero empieza en ago-2025: fuera los períodos jun y jul-2025 —
  sep-2026. Enmienda D185** (que los dejaba con producción 0 y su maquinaria). Decisión del dueño: … **No borra
  nada**: … | ✅ Cerrada (código); pendiente publicar Pages | sep-2026. Archivos: `tablero-produccion.js`, … Solo frontend. |`

## 03_BACKLOG.md: una fila por ítem, en su sección
Tabla `| # | Ítem | Origen |`. Series vivas: `V3-xx` (V3 · Largo plazo) y `4.xx`. El siguiente número lo da `siguiente.js`.
- Ítem nuevo: `| V3-25 | **<Título>.** Pedido del dueño (<fecha>): <qué y para qué>. | <origen: conversación / Dxx> |`
- Cierre de un ítem existente: se edita SU fila (no se crea otra) añadiendo `**Hecho (Dxxx).**` y en la última
  columna `✅ Hecho (Dxxx, <mes-año>) — pendiente <desplegar/publicar/validar>`.
- Ejemplo real: `| V3-20 | **Revisión del Parte Digital para drenajes.** Pedido del dueño (22-sep): … **Hecho (D193).** |
  ✅ Hecho (D193, sep-2026) — pendiente desplegar Worker, publicar Pages y validar en campo |`
- Ideas no pedidas: se proponen como ítem y no se implementan (regla al pie de 03).

## PROJECT_CONTEXT.md: solo reglas que cualquiera debe saber para no romper algo
- Regla nueva: una viñeta en «Reglas críticas», con el formato
  `- **<Título> (Dxxx, <mes-año>):** <regla en presente, con el porqué en una frase>.`, junto a las del mismo tema.
  Si enmienda una regla existente, se edita esa viñeta y la parte vieja se tacha con `~~…~~ (hasta Dxxx)`.
- Cambio de estado del proyecto: el párrafo `**Estado (<mes-año>):**`.
- Nunca claves, IDs de Sheets ni URLs `/exec` (se publica por Pages).

## 04_ARQUITECTURA.md: solo si hay deriva (lo marca `deriva.js`)
- Pantalla: fila de la tabla «Pantallas y roles (vigente, …)»: `| \`<pantalla>.html\` | <roles> | <función> (Dxxx). |`
- Módulo o mecanismo nuevo: sección `## Dxxx — <Título> (<mes-año>)` con qué pieza habla con cuál, endpoints
  (`?action=` / `op=`) y tablas, al estilo de las existentes (D166, D167, D169, D170).

## 05_CATALOGO.md: solo si hay deriva de catálogo
Formatos por sección en `tm2-catalogo/references/tipos_de_cambio.md#bloques` (§1 actividades, §2 orígenes,
§4 flota, §7 usuarios).

## CLAUDE.md: sincronizar
- Si cambia la **lista de skills**, su clase o la regla de uso, se actualiza la sección «Skills del proyecto».
- Si cambia una regla de **operación** (verificación, autonomía, orquestación), se actualiza en su sección.
  CLAUDE.md no copia conocimiento del proyecto: ese vive en `docs/`.

## Pasos de despliegue (para el informe final, formato de docs/OPERACIONES.md)
Numerados, en orden, con la acción exacta, y detrás **Comprobar** y **Vuelta atrás**:
```
0. En Supabase: `0NN_<nombre>.sql` (idempotente; respaldo en `<tabla>_respaldo_0NN`).
1. `wrangler deploy` (desde worker/).                  ← si cambió worker/src
2. Front: merge a `main`. Pages publica <archivos>.     ← si cambió el frontend
3. Comprobar: <qué abrir, con qué usuario, qué debe verse>.
Vuelta atrás: <cómo, por paso>.
```
El orden sale de las dependencias: la migración antes del Worker que la lee, y el Worker antes del front que
llama a una action nueva. Cada paso se pregunta al dueño antes de ejecutarlo (CLAUDE.md, «Límites de autonomía»).
