---
name: tm2-validacion
description: "[A · automático] Protocolo de depuración y prueba de TM2 Sur (Galca). Aplícalo sin que te lo pidan cuando el usuario reporte un error, un dato raro, un total que no cuadra o un resultado inesperado en campo, en una pantalla, en DATA, en el Excel o en el tablero. Aplícalo también cuando haya que probar o dar por terminado un cambio (qué arneses correr y cómo leerlos), o cuando algo «no llegó», «salió doble» o «salió en cero». Empieza pidiendo el dato observable antes de tocar código."
---

# Validación y depuración — TM2 Sur

Dos momentos: **(1) llega un reporte raro** → diagnosticar con datos; **(2) hay un cambio** → probarlo
con los arneses. En los dos, nada se da por bueno sin un dato observable o un arnés en verde.

## 1 · Llega un error o un dato raro

1. **Pide primero el dato observable**, uno concreto, antes de leer código o proponer arreglos:
   - fecha, usuario/rol, pantalla y qué esperaba frente a qué vio;
   - **endpoint debug** del día: `GET /obra?action=debug&fecha=AAAA-MM-DD` (con sesión), que da las filas de
     BANDEJA de ese día y una muestra; para pruebas, en el entorno `/prueba` (D168);
   - la **tabla/hoja `LOG`** (D166): una fila por petición con usuario, acción, resultado y motivo. Ahí
     está la causa de un «Sesión no válida», de un `rate_limit` o de un `error:'payload'`;
   - captura de pantalla, **valor de celda** (hoja, fila, columna) o la fila de DATA/BANDEJA/MAQUINARIA/
     VOLQUETAS/PARTE_BANDEJA en Supabase (solo lectura; escribir allí pide autorización, CLAUDE.md);
   - en el teléfono: el chip de señal/cola de `offline.js` (¿hay envíos en cola?) y la versión del SW.
2. **Compara con el caso canónico** que aplique (`references/casos_campo.md`): muchos «errores» son
   reglas cerradas (fallback 14, excavación por origen, cereo fuera de DATA…). Si lo es, explica la D-xx y
   no toques código.
3. **Reproduce en banco** con el arnés que cubre esa zona (tabla en `references/arneses.md`) o con
   `node tools/sandbox/servidor.mjs` para pantallas. Sin reproducción no hay arreglo.
4. Arreglo = cambio mínimo + el caso nuevo en el arnés que lo cubre. Cierre con `tm2-cierre-tema`.

## 2 · Probar un cambio (definición de «terminado» de CLAUDE.md)

```bash
node .claude/skills/tm2-validacion/scripts/correr_arneses.mjs                  # todos (~1,5 min)
node .claude/skills/tm2-validacion/scripts/correr_arneses.mjs --solo='parte|d178'   # los de la zona tocada
node .claude/skills/tm2-validacion/scripts/correr_arneses.mjs --sin-navegador   # sin Chromium
```

- Primero, `cd worker && npm ci` si falta `worker/node_modules`. El script marca OMITIDO lo que no puede correr.
- **Línea base, no «todo verde».** Hay arneses que ya están en rojo en `main`. Para saber si tu cambio
  rompió algo, guarda la línea base en `main` y compárala:
  ```bash
  git worktree add /tmp/tm2-base origin/main && (cd /tmp/tm2-base/worker && npm ci)
  node .claude/skills/tm2-validacion/scripts/correr_arneses.mjs --repo=/tmp/tm2-base --guardar=/tmp/base.json
  node .claude/skills/tm2-validacion/scripts/correr_arneses.mjs --comparar=/tmp/base.json   # → REGRESIONES
  ```
  «Terminado» = cero regresiones **y** en verde los arneses de lo que tocaste. Un arnés ya roto que cubre
  tu zona se arregla o se sustituye en el mismo cambio. No vale el rojo de antes como excusa.
- Estados: OK · FALLA (comprobaciones en rojo) · ROTO (el arnés no llega a comprobar: suele estar
  desactualizado) · OMITIDO (pide `--excel`/`--volcado` reales o dependencias) · TIEMPO.
- Pantallas: además, el banco en Chromium (`verificar_v301_pantallas.js`, que ya está en la lista) o el
  sandbox. Los que piden un Excel real (`--excel=<COPIA>`) se corren a mano con la copia que dé el dueño.
- Nunca: saltar, desactivar o «ajustar» un arnés para que pase.

## Referencias
- `references/arneses.md`: inventario (qué cubre cada arnés, cómo se corre y con qué argumentos).
- `references/casos_campo.md`: casos canónicos de campo, dónde mirar y qué D los rige.
- Reglas: `docs/PROJECT_CONTEXT.md` (reglas críticas) y `docs/02_REGISTRO_DECISIONES.md`. Entornos y
  despliegues: `docs/OPERACIONES.md`. Invariantes de código (fechas por duck-typing, POST `text/plain`)
  en `PROJECT_CONTEXT` · Apps Script.
