---
name: tm2-conciliador
description: "[B · bajo demanda] Ejecuta la conciliación de actas de transporte de TM2 Sur (bases GRANULARES/TERRAPLEN contra la proforma del contratista, pasos 1→4 y exportes del 7) sin abrir conciliador/index.html. Usa el mismo código de conciliador/conciliador.js y deja aparte el bloque del acta, los pendientes, el Excel de la digitadora, el resumen y una sesión importable por la herramienta. Úsalo SOLO si el usuario pide explícitamente EJECUTAR, correr o sacar la conciliación de un corte o quincena, o probar su equivalencia con la herramienta. No aplica si solo se menciona, se explica o se discute el conciliador, ni si se edita, corrige, revisa o prueba el código de conciliador/ o sus arneses: editar la herramienta no es ejecutarla."
---

# Conciliación de actas de transporte (ejecución)

`conciliador/index.html` sigue siendo la **vía principal**. Este skill carga su `conciliador.js` real en
Node y dispara los mismos pasos que sus botones: `Paso1._procesar`, `Paso2.abrir`,
`Paso3._procesarArchivo`/`_finCarga`/`sinProforma`/`resolverHoja` y `Exportes.*`. No tiene lógica propia.

## Límites honestos (decirlos al usuario)

- **Sin Paso 5 (PDF/OCR) ni Paso 6 (decisiones manuales).** Leer partes escaneados necesita pdf.js y
  tesseract en el navegador. Con PDFs escaneados o volúmenes grandes, la herramienta es la vía; el skill
  sirve de respaldo, de revisión de casos puntuales y de primera pasada rápida.
- El skill deja `conciliador_sesion_*.json`. En la herramienta, **💾 Importar sesión** retoma desde el
  Paso 4 con los PDFs (pide volver a elegir las mismas bases).
- **Nunca escribe las bases ni ningún maestro.** Solo lee copias y deja la salida aparte.

## Antes de correr

1. Pide: copias de `GRANULARES.xlsx` y/o `TERRAPLEN.xlsx` (hoja `BASE 2026`), la(s) proforma(s) del
   contratista (o el rango si es «sin proforma»), el **contratista** y la **quincena**. Pide también la
   **config** exportada desde ⚙ Configuración → Exportar. Sin ella se usa la de fábrica (`configSeed`) y se
   avisa: las reglas de hojas o los alias que el dueño añadió en su navegador no estarían.
2. Dependencia `xlsx` 0.18.5 fuera del repo:
   `npm i --prefix "$TMPDIR/tm2deps" xlsx@0.18.5 && export NODE_PATH="$TMPDIR/tm2deps/node_modules"`.
3. Primera vez en la sesión o herramienta cambiada: `node scripts/probar_conciliador.js` (sintético, 13
   comprobaciones). Si falla, **no parchees la herramienta**: repórtalo y propón el ítem.

## Ejecutar

```bash
S=.claude/skills/tm2-conciliador/scripts
node $S/conciliar.js --lista-contratistas [--config=<config.json>]      # ids válidos y empresas vetadas
node $S/conciliar.js --contratista=<id> --desde=AAAA-MM-DD --hasta=AAAA-MM-DD \
  --granulares=<copia>.xlsx --terraplen=<copia>.xlsx --proforma=<a.xlsx>[,<b.xlsx>] \
  --config=<config.json> --salida=<carpeta APARTE>
```

- Hojas de la proforma que la herramienta no clasifica sola (`sin_ambito`/`sin_columna`): el resultado las
  lista con código de salida `1`. **No adivines el ámbito:** pregúntalo y vuelve a correr con
  `--hoja="<nombre>=GRANULARES|TERRAPLEN|TERRAPLEN_INTERNO|IGNORAR"`. Es la misma decisión que se toma en
  pantalla, que tampoco adivina.
- «Sin proforma»: `--sin-proforma=AAAA-MM-DD..AAAA-MM-DD` en lugar de `--proforma`.
- `--json` da el resumen estructurado (conteo por estado, hojas, archivos).

## Entregar

- Los archivos de `--salida`: `bloque_acta_*`, `bloque_acta_pendientes_*`, `digitadora_*`, `resumen_*`
  (.xlsx, los exportes reales del Paso 7), `resumen_*.txt` (`resumenCorte`) y `conciliador_sesion_*.json`.
- Un resumen con el conteo por estado, las filas al acta, y cuántas NO_ENCONTRADA quedan para el Paso 5 en
  la herramienta. Si la config fue la de fábrica, dilo.
- Los estados y marcas se explican con el `README.md` de `conciliador/` y las decisiones. No los redefinas.

## Equivalencia con la herramienta

Con las mismas entradas y config, exporta desde la herramienta **justo tras el Paso 4** los .xlsx del
Paso 7 y la sesión (💾). Después:

```bash
node $S/equivalencia.js --herramienta=<carpeta con lo exportado> --skill=<carpeta de conciliar.js>
```

## Referencias

- `conciliador/README.md`: pasos, estados (EXCLUIDA_ASFALTO, EXCLUIDA_UF3…), exclusiones y resumen del
  Paso 7. Decisiones: D95, D114, D141, D175, D199 y las posteriores que nombren el conciliador.
- `references/funcionamiento.md`: qué funciones se llaman, en qué orden, y cómo ampliar el stub si la
  herramienta cambia.
- Si cambia la lógica del conciliador, `tm2-cierre-tema` obliga a revisar este skill en el mismo cierre.
- En el chat del Project, sin el repo: pide que se corra en Claude Code o que te suban `conciliador/conciliador.js`
  con los Excel, y pasa `--repo` a la carpeta que lo contiene.
