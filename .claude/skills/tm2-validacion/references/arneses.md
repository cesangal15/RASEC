# Inventario de arneses

Todos corren sin red y sin tocar producción. Hay dos formas de correrlos: uno a uno con `node <ruta>`, o
todos juntos con `scripts/correr_arneses.mjs`, que resume y compara contra una línea base. Los de
Chromium necesitan `NODE_PATH=/opt/node22/lib/node_modules` (Playwright del entorno); el script ya lo
pone. Los de `worker/` necesitan `cd worker && npm ci`.

La columna «Estado 24-sep-2026» es la foto de `main` ese día. La verdad actual la da el script.
**ROTO** quiere decir que el arnés extrae `<script>` en línea del HTML o funciones que se movieron. Casi
todos quedaron así tras D170, cuando el JS pasó a `<pantalla>.js`, o tras D112/D171. Arreglarlos es un
ítem pendiente, no parte de un cambio ajeno.

## Contrato (los dos backends con las mismas peticiones)
| Arnés | Cubre | Cómo | Estado 24-sep |
|---|---|---|---|
| `backend/pruebas/contrato/correr.js` | Contrato de `/obra`, `/asistencias`, `/parte` contra los `.gs` reales en `vm`. `--url=` lo corre contra un servidor (prueba) | `node … [--solo=obra\|asistencias\|parte] [--caso=<regex>]` | OK |
| `worker/pruebas/contrato_local.js` | El mismo contrato contra el **Worker real** + Postgres en memoria (PGlite) + migraciones `worker/sql/0*.sql` | `node … --volcado=<carpeta *_obra>`. Sin volcado real vale una carpeta vacía (solo semillas); el script lo hace solo. `--caso=<regex>`, `--servir` | OK |
| `worker/pruebas/casos_sql.js` | Casos SQL (005, 007, 008, `data_maestro`); los invoca `contrato_local` | — | (dentro de contrato_local) |

## Worker / Supabase (`worker/pruebas/*.mjs`, PGlite)
| Arnés | Cubre | Estado 24-sep |
|---|---|---|
| `verificar_012_cargos.mjs` | Migración 012: unificación de cargos, idempotencia, respaldo | OK |
| `verificar_d183_proyeccion.mjs` | Proyección (006): vistas espejo y paridad con la API. `--excel=` contra el libro | OK |
| `verificar_d185_tablero_vivo.mjs` | Tablero en vivo: pliegue, caché, horas, avance. `--excel= --horas=` | FALLA (1: no se actualizó tras D209) |
| `verificar_d186_importar_maestro.mjs` | Carga única de DATA del maestro. **Pide `--excel=<COPIA>`** | OMITIDO sin Excel |
| `verificar_d187_data_csv.mjs` | DATA/Proyección en CSV para Power Query con clave de lectura | OK |
| `verificar_d205_flota_drenajes.mjs` | Cerrojo de flota por grupo (residente_dren/duvan) | OK |
| `verificar_d207_revision_partes.mjs` | Revisión de partes: CC completos, continuidad del medidor, HORARIO_RARO | OK |
| `verificar_v316_personal.mjs` | Horas del personal del tablero (directos, partidas) | OK |
| `verificar_v319_depurar_items.mjs` · `verificar_v319b_tipos.mjs` | Depuración de `parte_items` (010) · tipos de equipo (011) | OK |
| `verificar_v322_meta_hh.mjs` | Meta de horas-hombre (013) | OK |

## Backend Apps Script en `vm` y lógica de pantallas (`backend/pruebas/*.js`)
| Arnés | Cubre | Estado 24-sep |
|---|---|---|
| `verificar_d166_endurecimiento.js` | Validación de payload, rate limit, LOG, respaldo (D166) | FALLA (2/88) |
| `verificar_d170_recorte_equipos.js` · `verificar_d171_recorte_equipos.js` | Capataz solo con código de máquina (D171) | FALLA (5/53 · 1/57) |
| `verificar_v306b_recorte_chequeadora.js` | Chequeadora solo con código de excavadoras (D177) | OK |
| `verificar_v301_parte_digital.js` | Parte digital: equipo público, reporte, alertas, bandeja, base | FALLA (2/97) |
| `verificar_d178_parte_detalles.js` | Parte: ítems/CC numéricos, 5 actividades, PR en km, repartir | OK |
| `verificar_v319_parte_etiquetas.js` | Chips de actividad del parte sin frases repetidas | OK |
| `verificar_d138_flota_viva.js` · `verificar_d139_flota_pantalla.js` | Flota viva (`MAQUINAS`, ventana semiabierta) · alta/baja desde pantalla | FALLA |
| `verificar_d158_tablero_foto.js` · `verificar_d159_tablero_publico.js` | Foto del tablero compartida · lectura pública sin token | OK |
| `verificar_endpoint_persona.js` | `?action=persona` y su cerrojo de área (D112) | OK |
| `verificar_upsert_asistencia.js` | Upsert por persona: editar nunca añade fila (D119) | OK |
| `verificar_d132_peso_hoja.js` · `verificar_d133_payload_resumen.js` | Herramientas de peso del Sheet de asistencias · respuesta adelgazada | OK |
| `verificar_d119_asistencias_tm2.js` · `verificar_d135_drenajes_combinado.js` | `angie` multi-área · vista drenajes combinada | FALLA (helpers movidos a .js) |
| `verificar_d134_maria_albert.js` · `verificar_d145_albert_regreso.js` | Relevos/regreso de usuarios en cuadrillas y `USUARIOS` | FALLA |
| `verificar_d142_horas_admin_eventual.js` · `verificar_horas_persona.js` · `verificar_refactor_horas.js` | Horas por persona = Parte de Navision (D112/D142) | FALLA/ROTO |
| `verificar_d113_terraplen_material.js` · `verificar_material_drenajes.js` | Terraplén/relleno por material (D113/D113c) | FALLA (extraen `<script>` del HTML) |

## Herramientas de escritorio
| Arnés | Cubre | Estado 24-sep |
|---|---|---|
| `verificar_conciliador_*.js` (8) | Conciliador: UF3 manual, ignorar hoja, OCR (tiquete, umbral rojo), candidatos Paso 5, pendientes (área, material), visor | OK |
| `verificar_reparto_horas_minimas.js` · `verificar_estancias_maquinas.js` · `verificar_dias_no_digitados.js` · `verificar_config_guardada.js` · `verificar_clima_fact_jefe.js` | Reparto mensual (D143/D144/D147/D148/D140) | ROTO/FALLA: leen `<script>` en línea del HTML. La lógica real la prueba `tm2-reparto-produccion/scripts/probar_reparto.js` |

## Pantallas en Chromium (Playwright)
| Arnés | Cubre | Estado 24-sep |
|---|---|---|
| `verificar_v301_pantallas.js` | `parte.html` + `revision-maquinaria.html` (y casos de otras) contra el backend en `vm` | OK (103) |
| `verificar_d176_parte_offline.js` | Parte sin señal: cola, subida al volver, sin duplicar | OK |
| `verificar_v315_v316_tablero.js` | Tablero: orden, escala de tiempo, horas del personal | OK |

Sandbox manual: `node tools/sandbox/servidor.mjs` (guía en `tools/sandbox/README.md`).
