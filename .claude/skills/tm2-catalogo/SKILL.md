---
name: tm2-catalogo
description: "[A · automático] Procedimiento para dar de alta, cambiar o dar de baja elementos del catálogo de TM2 Sur (Galca): actividades del capataz, ítems de drenajes, máquinas y flota, orígenes de material, centros de costo, usuarios, roles y sus áreas (campo areas y áreas efectivas), cubicaje por placa. Aplícalo sin que te lo pidan cada vez que un pedido o un cambio de código toque cualquiera de esos elementos: llegó o se fue una máquina, hay un usuario o capataz nuevo, una actividad nueva, cambia el CC de algo, alguien debe ver otra área. Da la lista exacta de hojas, tablas, archivos y despliegues, y el bloque para 05_CATALOGO."
---

# Cambios de catálogo

El catálogo tiene **dos naturalezas**, y confundirlas es el error típico:
- **Dato vivo** (Supabase, editado desde pantallas: **Catálogos**, solo admin, D211; Maquinaria › Flota; `grilla.html`): BASE/`base_items`, `maquinas`,
  `parte_equipos`, `parte_items`, `usuarios`, `cubicaje`, `fc_actividad`, `tablero_mapeo`… Un alta es una fila:
  **sin código ni despliegue** (D113b, D138/D139, D108, D181). Escribir en producción pide autorización
  del dueño (CLAUDE.md, «Límites de autonomía»).
- **Código** (listas escritas en pantallas o en el Worker): actividades del capataz, orígenes, reglas por
  tipo de máquina, áreas de asistencias por usuario, roles. Esto sí exige cambio, pruebas y despliegue.

## Procedimiento

1. **Identifica el tipo** (actividad · ítem de drenajes · máquina · origen · CC · usuario/rol/áreas ·
   cubicaje) y lee su sección en `references/tipos_de_cambio.md`. Allí está la lista exacta de lo que se
   toca, la D que lo rige y si es dato o código.
2. **Busca todas las apariciones** del valor que cambias (o de uno parecido que ya exista, para copiar su
   patrón):
   ```bash
   node .claude/skills/tm2-catalogo/scripts/donde_aparece.js "<código o nombre>" ["<CC>"] [--docs]
   ```
   Lo agrupa por capa: frontend, Worker, SQL, herramientas, `.gs` congelados, arneses y docs. Una copia
   olvidada es la causa clásica de «en una pantalla sale y en otra no».
3. **Decide con el dueño si hace falta** (sin inventar): una regla nueva, como un tipo de máquina
   productivo, un área o capítulo nuevos o un rol nuevo, es una **decisión D nueva**, no un alta.
4. **Aplica** en este orden: datos (con autorización), Worker, pantallas. Todo en rama, **nunca en `main`**.
5. **Prueba** con `tm2-validacion`. Si el cambio toca una pantalla, sigue `tm2-pantalla-nueva`.
6. **Cierra** con `tm2-cierre-tema`: el bloque de 05 (formatos al final de la referencia), la fila de 04 si
   cambia el acceso a una pantalla, y la D en 02 si hubo regla nueva.

## No hacer
- No poner claves, IDs de Sheets ni URLs `/exec` en código, docs o skills. Las claves viven en `usuarios`
  (SHA-256 de `usuario:clave`) y las URLs en los secretos del Worker.
- No borrar filas para dar de baja: `estado` ≠ `activo` o fecha de retiro (el histórico se conserva).
- No tocar los respaldos escritos de máquinas en un alta normal. Tampoco los `.gs` congelados.
- No escribir en los Excel maestros: el catálogo se edita en la fuente (D181).
