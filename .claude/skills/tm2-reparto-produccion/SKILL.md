---
name: tm2-reparto-produccion
description: "[B · bajo demanda] Ejecuta el reparto mensual de producción de maquinaria por CC de TM2 Sur sin abrir la herramienta. Toma el reporte diario de obra y el parte de maquinaria del mes y deja aparte el archivo fact_jefe del corte (.xlsx) (fact_jefe A:AC, reparto, cuadre), generado con el mismo código de Reparto_Produccion_Maquinaria. Úsalo SOLO si el usuario pide explícitamente EJECUTAR, correr o generar el reparto de un corte, o probar su equivalencia con la herramienta. No aplica si solo se menciona, se explica o se discute el reparto, ni si se edita, corrige, revisa o prueba el código de Reparto_Produccion_Maquinaria.html/.js o sus arneses: editar la herramienta no es ejecutarla."
---

# Reparto mensual de producción por CC (ejecución)

La herramienta `Reparto_Produccion_Maquinaria.html` sigue siendo la fuente de la lógica. Este skill **no
tiene lógica propia**: carga su `.js` real en Node y pulsa los mismos botones que tú en la pantalla
(«Procesar» y «Descargar .xlsx»). Si la herramienta cambia, el skill cambia con ella sin tocar nada.

## Antes de correr

1. **Pide los archivos** (copias, nunca los originales en uso):
   - el **reporte diario de obra** del mes (copia de `TM2_SUR_REPORTE_DIARIO_OBRA…xlsx`, con `dia suelto` y `DATOS`);
   - el **parte de maquinaria** del mes (el libro del jefe con `BASE MAQUINARIA`, o el de bloques del mes);
   - la **configuración** del navegador del dueño (ver `assets/config.json`: cómo exportarla). Si no la hay,
     corre con la de `assets/config.json`. Los valores marcados **PENDIENTE** toman el de fábrica y el resultado
     lo avisa. Dilo al entregar.
2. **Dependencia:** el paquete `xlsx` 0.18.5, instalado fuera del repo (el propio script dice cómo si falta):
   `npm i --prefix "$TMPDIR/tm2deps" xlsx@0.18.5 && export NODE_PATH="$TMPDIR/tm2deps/node_modules"`.
3. Si es la primera vez en esta sesión o la herramienta cambió: `node scripts/probar_reparto.js` (datos
   sintéticos, 8 comprobaciones). Si falla, la herramienta dejó de cargarse en Node. **No la parchees:**
   repórtalo y propón el ítem en el backlog.

## Ejecutar

```bash
node .claude/skills/tm2-reparto-produccion/scripts/reparto.js \
  --prod="<copia reporte diario>.xlsx" --jefe="<copia parte maquinaria>.xlsx" \
  --config=<config.json> --salida=<carpeta APARTE> [--desde=AAAA-MM-DD --hasta=AAAA-MM-DD]
```

- El corte lo detecta el parte, igual que la pantalla (`detectarCorte`). `--desde/--hasta` solo si el dueño
  pide otro.
- Códigos de salida: `0` = cuadre exacto · `1` = descuadre o producción huérfana (entrega igual, con los
  avisos) · `2` = error (hoja no encontrada, sin resultado).
- `--json` devuelve el resumen estructurado. `--volcar-config` muestra la config que se usaría.

## Entregar

- El archivo `fact_jefe_<desde>_<hasta>.xlsx`, **aparte**. Nunca se escribe en los Excel maestros ni en
  las entradas (D24, `PROJECT_CONTEXT` «Restricción de trabajo»). El dueño lo pega en su maestro.
- Un resumen corto con el corte, las filas y la producción repartida, los **avisos de la herramienta**
  copiados tal cual (cuadre, huérfanas, máquinas sin bloque en el informe, clima) y los valores PENDIENTE usados.
- No reinterpretes los avisos ni cambies parámetros para «hacer cuadrar». Si algo no cuadra, se dice.

## Equivalencia con la herramienta

Con las **mismas** entradas y la **misma** config, descarga el `.xlsx` desde la pantalla y compara:

```bash
node .claude/skills/tm2-reparto-produccion/scripts/equivalencia.js --herramienta=<xlsx del navegador> --skill=<xlsx de reparto.js>
```

Compara celda a celda `fact_jefe`, `reparto` y `cuadre`. Si hay diferencias, la causa casi siempre es la
config (lista `propias` o el corte). Revisa eso antes de sospechar de la carga.

## Referencias

- Decisiones que gobiernan el reparto, a leer en `docs/02_REGISTRO_DECISIONES.md` antes de opinar sobre un
  resultado: D64, D86, D89, D90, D91, D92, D97, D136 (flota), D140, D143, D144, D146, D147, D148. Cualquier
  D posterior que nombre `Reparto_Produccion` también cuenta.
- `references/funcionamiento.md`: qué funciones de la herramienta se llaman y en qué orden, entradas y
  salidas. Léelo si algo falla al cargar o si la herramienta cambió.
- Si cambia la lógica del reparto, `tm2-cierre-tema` obliga a revisar este skill en el mismo cierre.
- En el chat del Project, sin el repo: pide que se corra en Claude Code o que te suban
  `Reparto_Produccion_Maquinaria.{html,js}` y `tema.js` junto a los Excel, y pasa `--repo` a esa carpeta.
