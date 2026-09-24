# Qué tocar por tipo de cambio de catálogo

Contenido: [A. Actividad de tierras](#a) · [B. Ítem de drenajes](#b) · [C. Máquina](#c) · [D. Origen](#d)
· [E. CC](#e) · [F. Usuario, rol y áreas](#f) · [G. Cubicaje](#g) · [Bloques para 05](#bloques)

Leyenda de despliegue: **[datos]** = fila en Supabase, sin código y sin despliegue (con autorización del
dueño, CLAUDE.md) · **[Pages]** = publicar el frontend · **[Worker]** = `wrangler deploy` · **[SQL]** =
migración idempotente con respaldo. Los `.gs` de `backend/` están **congelados** (el backend vivo es el
Worker sobre Supabase). Las rutas son las de sep-2026: confírmalas con `scripts/donde_aparece.js`.

<a id="a"></a>
## A. Actividad de tierras (formulario del capataz)
Reglas: D21 (actividad de campo → ítem contractual), D68 (DESCRIPCIÓN verbatim de la BASE), D15/D16/D58
(medición), D113 (variantes por material), D184 (FC), D185 (tablero).
1. `reporte-capataz.js` → `ACTIVIDADES` `{g, a, item, uni, cc, medida, data, sub?, maqUnidad?}`. Es la fuente
   del formulario: `data:false` = no va a DATA (D16), `medida` decide el cálculo y `sub` marca las de apoyo. **[Pages]**
2. `encargado.js` → su copia de `ACTIVIDADES`, que el panel usa para agregar líneas, y `CAT_CONTROL_CAPATAZ`.
   Si es terraplén de material externo, también `esTerraplenExterno` (D113). **[Pages]**
3. BASE (`base_items`): el CC y la descripción tienen que existir; se editan en la grilla `grilla.html` (D181). **[datos]**
4. `fc_actividad` si su FC ≠ 1 (D184, tabla de `007`). **[datos]**
5. Tablero: `tablero_mapeo` si debe contar (D185, `008`) y `CC_ACT` de `tablero-produccion.js`/`tablero_vivo.js`
   para las horas del personal (V3-16). **[datos]/[Pages]/[Worker]**
6. Worker `worker/src/api/obra/reporte.js` → `CAPTURA_ACT_MAP`, solo si necesita par H/I (obsoleto desde D171:
   sin par sale `a_captura=NO`, que es lo normal). **[Worker]**
7. Parte digital: `parte_items` (tipo_equipo·ítem·actividad, D174; dueño Jeisson) si los operadores deben verla. **[datos]**
8. Reparto mensual: `MAPA_ACTIVIDAD`/`ACTIVIDAD_CC`/`COHERENCIA` de `Reparto_Produccion_Maquinaria.js`, solo si
   entra al informe (D91). Si cambia, `tm2-cierre-tema` pide revisar `tm2-reparto-produccion`. **[Pages]**
9. `jefe.js` si agrupa el material (desglose D113d).
10. Arneses: casos del contrato (`backend/pruebas/contrato/casos_obra.js`, `semillas.js`).
11. **05 §1**: línea en su grupo (formato abajo).

<a id="b"></a>
## B. Ítem de drenajes ODT/ODL
Reglas: D70, D71, D84, D113b (catálogo VIVO desde la BASE), D113c (variantes por material).
1. Fila en la BASE (`base_items`) con capítulo `.06.*` (ODT) o `.07.*` (ODL): entra sola en `?action=drenajes`,
   sin código. **[datos]**
2. Solo si es una variante por material del mismo CC: `VARIANTES_DREN` en `worker/src/catalogos.js`. **[Worker]**
3. **05 §1 «Drenajes ODT / ODL»**: solo si cambia una regla. Los ítems viven en la BASE.

<a id="c"></a>
## C. Máquina (alta, baja, reingreso, cambio de tipo o grupo)
Reglas: D138/D139 (flota viva y administrada desde pantalla), D143 (estancias), D171 (el capataz solo elige
el código), D173 (`maquinas` = estancias, `parte_equipos` = ficha), D189 (QR), D190 (grupo), D205 (flota
de drenajes), D10 (horas programadas por propiedad), D111 (código con guion). Guía: `docs/OPERACIONES.md §10`.
1. **Alta, baja o reingreso** = Maquinaria › **Flota** (`produccion-maquinaria.html`): estancia en `maquinas`
   (ventana `[ingreso, retiro)`, `frente`, `grupo`, `propiedad`). La ficha de `parte_equipos` se crea sola.
   **[datos, desde la pantalla]**. Una baja no borra nada.
2. **QR**: «▦ QR» en la Flota (D189) o `tools/generar_qr.py` (etiquetas de vinilo); inventario en `qr/LISTADO.md`.
3. **Reparto mensual**: la lista `propias` de la config del reparto (estancia `COD:ingreso..retiro`, D143) si
   debe recibir producción. Es config del navegador del dueño, no código: díselo, o actualiza el
   `config.json` que use `tm2-reparto-produccion`.
4. **Solo si es un TIPO nuevo**: `MAQ_TIPOS_FLOTA`/`MAQ_TIPOS_PRODUCCION` y `esTipoSinProduccion` en
   `worker/src/catalogos.js` (la regla sin producción va por TIPO, no por id) **[Worker]**;
   `TIPOS_RESPALDO` en `produccion-maquinaria.js` **[Pages]**; su lista en `parte_items` **[datos]**.
   Ojo: `parte_equipos.tipo` usa los nombres del parte (unificados en `011`) y `maquinas.tipo` usa la lista fija.
5. **No se tocan** en un alta normal los respaldos escritos (`MAQUINAS_RESPALDO`/`TIPO_RESPALDO` de
   `reporte-capataz.js`, `reporte-chequeadora.js`, `encargado.js`, `estado.js`; `MAQ_CATALOGO` del Worker).
   Son el último recurso sin señal (D82) y solo se actualizan en una limpieza deliberada.
6. **05 §4**: la foto de la flota («la verdad está en la hoja»). Se actualiza la fila de su grupo.

<a id="d"></a>
## D. Origen de material (chequeadora)
Reglas: D25 (orígenes), D63 (excavación por origen y PK fijo por origen), D113 (crudo de río y UF3 son
actividad, no origen).
1. `reporte-chequeadora.js` → mapa de orígenes (actividad, ítem, CC, etiqueta) y `ORIGEN_PK`. **[Pages]**
2. `reporte-chequeadora.html` → `<option>` del selector. **[Pages]**
3. `digitadora.js` → `origenPkMeters()` (PK inicial en metros, D83). **[Pages]**
4. El Worker no lleva lista de orígenes: recibe el PK ya resuelto. Confírmalo con `donde_aparece.js`.
5. **05 §2**: línea «- Origen (PK n) → actividad».

<a id="e"></a>
## E. Centro de costo
Reglas: D63 (CC = proyecto + ítem, por PK), D68, D181 (se edita en la fuente y se autovalida), D70 (área por capítulo).
1. BASE `base_items` desde la grilla (`grilla.html`, D181: formato, sin duplicados, sin solapes). **[datos]**
2. Capítulo o área NUEVOS (no 06/07): las copias de `deriveArea` en `worker/src/comun.js`,
   `worker/sql/backfill_lib.js` y `jefe.js` (más `Codigo.gs`, congelado). Es un cambio de regla: pide decisión. **[Worker]/[Pages]**
3. Asistencias: `cat_cc`/`cc_usados` (catálogo y frecuentes por UF/área, D78); `cc_capataz` en CONFIG (D72). **[datos]**
4. Parte digital: `parte_cc` aprende del uso. La revisión ya lista todos los CC de la BASE (D207). **[datos]**
5. Tablero: `CC_ACT` si abre una partida (V3-16). Conciliador: `ccPorMaterial` de su config.
6. **05**: no tiene sección de CC; el CC va en la línea de su actividad (§1).

<a id="f"></a>
## F. Usuario, rol y áreas
Reglas: D108 (hoja/tabla `usuarios`), D109 (token con usuario·rol·áreas), D84 (`areas`), D116/D119
(`areasEfectivas`), D145 (reactivar), D178 (revisión del parte por usuario).
- **Usuario nuevo con rol existente** = fila en `usuarios`: `usuario · clave · rol · areas · redirige · estado`
  **[datos]**. La `clave` va como SHA-256 hex de `usuario:clave`; nunca en claro en producción y nunca en
  el repo ni en el chat. `areas`: lista separada por comas (`tierras,odt,odl,uf3`) que viaja en el token y
  que usan las pantallas de obra (p. ej. `reporte-drenajes.js`). `redirige`: la pantalla de entrada.
  - **Baja** = `estado` ≠ `activo`. No se borra la fila, porque el histórico queda con su nombre en `reporta`.
  - Capataz de tierras: `CAPATACES_ESPERADOS` en `encargado.js`. Drenajes: `CAPATACES_ESPERADOS_POR_AREA`
    en `residente-drenajes.js`. **[Pages]**
  - Asistencias: la cuadrilla y sus `responsables` (admite varios logins; D84, D145). Las áreas de asistencias NO salen de
    `usuarios.areas`: salen **por usuario** de `areasDeUsuario` en `worker/src/api/asistencias/areas.js`.
    Un usuario nuevo de asistencias con alcance propio exige código **[Worker]**. `areasEfectivas`
    intersecta `&area=` con las forzadas (acota, nunca amplía).
  - Revisión del parte por usuario: `PARTE_USUARIOS_REVISAN` en `worker/src/api/parte.js`. **[Worker]**
- **Rol nuevo**: guard de cada pantalla (arrays `ROLES`), su entrada (`menu.html` / tiles de
  `seleccion-reporte.js` / `residente.html`), `REDIRIGE_POR_ROL` de `index.js` (respaldo sin señal), los
  permisos del Worker (el cerrojo real) y el contrato. **[Pages]+[Worker]**. Casi siempre pide una D nueva.
- **05 §7**: fila `| rol | usuario(s) | entra a |`. Si cambia quién entra a una pantalla, también su fila en 04.

<a id="g"></a>
## G. Cubicaje (placa · m³)
Reglas: D53 (cubicaje real por placa, espejo de la Bitácora de Transporte), D54 (fallback fijo).
1. Fila en `cubicaje` (`placa · cubicaje [· tipo]`), placa normalizada a 6 caracteres. **[datos]**
2. El fallback vive en `reporte-chequeadora.js` y **no se cambia** sin decisión (D54).
3. 05: sin sección; es dato vivo.

<a id="bloques"></a>
## Bloques listos para 05 (formato real del documento)
- §1 Actividad: `- <Actividad de campo> → <Ítem contractual de la BASE> | <unidad> | <CC sin proyecto> | <medición> | <Sí/No (nota)>`
  (ej. real: `- Excavación de préstamo (Diviso) → Excavación en material común de préstamos | m3 | 02.06 | m³ directo | Sí`)
- §2 Origen: `- <Origen> (PK <n>) → <actividad>`
- §4 Flota: fila de la tabla `| GRUPO | COD · COD | propiedad / proveedor |` y, si aplica, la nota de altas o
  bajas con fecha y D.
- §7 Usuario/rol: `| \`rol\` | usuario(s) (nota, Dxx) | \`pantalla.html\` |`. Sin claves (van en `usuarios`).
