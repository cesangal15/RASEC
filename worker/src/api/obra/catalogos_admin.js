/**
 * api/obra/catalogos_admin.js — pantalla «Catálogos» (SOLO admin, V3-xx, sep-2026).
 *
 * El dueño necesita editar/consultar desde la app, con experiencia tipo Excel, las tablas de Supabase que
 * hoy solo toca en el Table Editor. Guard de rol (D109): SOLO `admin` (ni jefe, ni residente, ni usuarios
 * de lista blanca) — permiso_(ses, ['admin'], [], 'administrar catálogos').
 *
 *   GET  ?action=cat_tablas                         TOKEN admin → catTablas: config de cada tabla (grupos,
 *                                                    columnas, filtros) para que el cliente monte la UI.
 *   GET  ?action=cat_leer&tabla=<id>&filtros=<json>  TOKEN admin → catLeer: filas (tope CAT_TOPE_FILAS).
 *   POST {action:'cat_guardar', tabla, cambios[]}    TOKEN admin → catGuardar: alta|update|baja por lote,
 *                                                    ATÓMICO (sql.begin), concurrencia optimista por columna
 *                                                    (WHERE pk AND col IS NOT DISTINCT FROM antes.col).
 *
 * TABLAS INCLUIDAS y por qué (lista blanca — ni tabla ni columna llegan del cliente a SQL sin pasar por
 * CA_TABLAS):
 *   Registros    — bandeja, volquetas (transaccionales; editar sí, borrar no —bandeja «borra» poniendo
 *                  estado='descartado'—; filtro de fechas OBLIGATORIO, máx CA_MAX_DIAS_FILTRO días).
 *   Parte Digital— parte_cc, parte_actividades, parte_items, parte_operadores, parte_equipos (alta/editar/
 *                  borrar real).
 *   Usuarios     — usuarios (alta/editar, SIN borrar; ver reglas propias más abajo).
 *   Obra         — base_items, cubicaje, fc_actividad (007), tablero_mapeo (008). `cargos` (012) se EXCLUYE:
 *                  012_unificar_cargos.sql no crea un catálogo vivo, solo hace un backfill puntual con una
 *                  tabla de RESPALDO (`cargos_respaldo_012`, fuera por la regla `*_respaldo_*`) — no hay
 *                  nada que administrar ahí.
 *   Asistencias  — cuadrillas, config, festivos, turnos, cat_cc, cat_motivos, cat_trabajadores (alta/editar/
 *                  borrar). `cc_usados`/`motivos_usados` son DERIVADOS (los usos recientes que ofrece el
 *                  selector de asistencia) → SOLO LECTURA aquí (editable:false en cada columna, alta/baja
 *                  en false).
 *   FUERA (ya tienen pantalla propia o no se tocan, igual que dice el contrato): data (datagrid.js),
 *   base_elementos (grilla.js), maquinas (flota.js), proy_* (proyeccion.js), personal, parte_bandeja,
 *   asistencia, extras_admin, notas_asistencia, maquinaria, observaciones, log, tablero, tablero_horas,
 *   *_respaldo_*, vistas.
 *
 * Identificadores SQL — SOLO de la lista blanca: cada `tabla` del cliente se resuelve contra CA_TABLAS
 * (objeto fijo); cada columna que se lee/escribe sale de `cfg.columnas`/`cfg.pk` (arrays fijos del propio
 * módulo), nunca de una clave que el cliente inventó. La escritura usa `sql.unsafe(texto, params)` con el
 * texto armado a partir de esos nombres fijos y los VALORES siempre parametrizados ($1, $2…): funciona
 * igual en postgres.js (Worker real) y en el adaptador de PGlite del banco de pruebas, que NO implementa
 * `sql(identificador)` de postgres.js (solo tagged template + `.unsafe`).
 *
 * Concurrencia optimista SIN version: estas tablas no tienen columna `version` (a diferencia de
 * base_elementos/data). Se compara cada columna que el cliente diga haber visto (`antes`) con `IS NOT
 * DISTINCT FROM` en el propio UPDATE/DELETE; 0 filas afectadas = alguien más cambió esa fila mientras
 * tanto → conflicto → rollback de TODO el lote (transacción única, D181 como grilla.js/datagrid.js).
 *
 * Bandeja «incluido» (ya enviada a DATA): no hay columna con la fecha exacta del envío (enviarData no la
 * guarda en bandeja, solo el estado — ver api/obra/data.js), así que el aviso usa la FECHA de la propia
 * fila (bandeja.fecha = el día de obra que se envió) como referencia «Ya enviada a DATA el <fecha>».
 *
 * Usuarios: `clave` NUNCA sale al cliente (columna fuera de CA_TABLAS.usuarios.columnas de lectura); la
 * columna virtual de solo escritura `clave_nueva` la valida catGuardar_ y el hash lo calcula hashClave_
 * (mismo algoritmo que auth.js/comun.js, SHA-256 hex de `usuario_minusculas:clave`). El admin no puede
 * quitarse a sí mismo el rol admin ni desactivarse (evita quedarse fuera, ver validación en catGuardar).
 *
 * Auditoría: cada escritura exitosa deja una fila en `catalogo_auditoria` (013_catalogos_auditoria.sql,
 * dentro de la MISMA transacción) con antes/después en jsonb; en `usuarios` la clave/hash se enmascara con
 * '***' (nunca se guarda en claro ni en hash en la auditoría).
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 */
import { OBRA_ID, json, permiso_, logMarcar_, hashClave_ } from '../../comun.js';
import { invalidarMemo_, pkMeters, normPlaca } from '../../catalogos.js';

const CA_ROLES_ESCRIBEN = ['admin'];   // guard D109: SOLO admin, ni jefe ni residente ni usuarios sueltos
const CA_TOPE_FILAS = 5000;
const CA_MAX_CAMBIOS = 1000;
const CA_MAX_DIAS_FILTRO = 93;   // bandeja / volquetas: rango de fechas obligatorio

/* ---------- helpers de tipo/validación (uso interno; nada se expone fuera del módulo) ---------- */
function txt_(v){ return String(v==null?'':v).trim(); }
function textoLibre_(v){ return String(v==null?'':v); }   // observaciones/notas: sin trim (respeta lo tecleado)
function numONull_(v){
  if(v===null || v===undefined || v==='') return null;
  const n = (typeof v==='number') ? v : Number(String(v).trim().replace(/\s/g,'').replace(',','.'));
  return isFinite(n) ? n : undefined;   // undefined = no es número (error)
}
function boolv_(v){
  if(v===true) return true;
  if(v===false || v===null || v===undefined || v==='') return false;
  const s=String(v).trim().toLowerCase();
  return (s==='true' || s==='si' || s==='sí' || s==='1');
}
function fechaValida_(v){
  const s=String(v==null?'':v).slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
function diasEntre_(desde, hasta){
  const a=new Date(desde+'T00:00:00Z'), b=new Date(hasta+'T00:00:00Z');
  return Math.round((b-a)/86400000);
}

/* ======================================================================================================
 * CONFIG DECLARATIVA por tabla — lista blanca de tabla SQL, PK, columnas (tipo/editable/requerido) y,
 * cuando aplica, filtros propios. `tabla` = nombre SQL real (igual al `id` en todos los casos aquí).
 * ====================================================================================================== */
const L_ESTADO_BANDEJA = ['pendiente','incluido','descartado'];
const L_AREA_BANDEJA = ['', 'odt', 'odl'];
const L_CUBICAJE_ORIGEN = ['catalogo', 'default', ''];
const L_TABLERO_UF = ['*', 'UF1', 'UF2'];
const L_TABLERO_CAMPO = ['apr','pre','nap','ter','sub','bas'];
const L_ROL_USUARIO = ['admin','jefe','residente','residente_dren','residente_odt','residente_odl',
  'encargado','capataz','capataz_odt','capataz_odl','chequeadora','digitadora','asistencia_plus',
  'asistencia_plus_tm2','asistencia_plus_dren'];
const L_ESTADO_USUARIO = ['activo','inactivo'];

const CA_TABLAS = {
  /* ---------------- Registros ---------------- */
  bandeja: {
    tabla:'bandeja', grupo:'registros', titulo:'Bandeja', descripcion:'Crudo de capataz/chequeadora/drenajes.',
    pk:['id_registro'], alta:false, baja:true, baja_es:'descartar', baja_columna:'estado', baja_valor:'descartado',
    fechaObligatoria:true,
    filtros:[
      { id:'desde', tipo:'fecha', etiqueta:'Desde', requerido:true },
      { id:'hasta', tipo:'fecha', etiqueta:'Hasta', requerido:true },
      { id:'reporta', tipo:'texto', etiqueta:'Reporta' },
      { id:'rol', tipo:'texto', etiqueta:'Rol' },
      { id:'actividad', tipo:'texto', etiqueta:'Actividad' },
      { id:'centro_costo', tipo:'texto', etiqueta:'Centro de costo' },
      { id:'area', tipo:'lista', etiqueta:'Área', opciones:L_AREA_BANDEJA },
      { id:'estado', tipo:'lista', etiqueta:'Estado', opciones:L_ESTADO_BANDEJA },
      { id:'pk_desde', tipo:'pk', etiqueta:'PK desde' },
      { id:'pk_hasta', tipo:'pk', etiqueta:'PK hasta' }
    ],
    columnas:[
      { id:'id_registro', etiqueta:'ID', tipo:'texto', editable:false },
      { id:'timestamp', etiqueta:'Marca', tipo:'fecha', editable:false },
      { id:'fecha', etiqueta:'Fecha', tipo:'fecha', editable:true, requerido:true },
      { id:'reporta', etiqueta:'Reporta', tipo:'texto', editable:true },
      { id:'rol', etiqueta:'Rol', tipo:'texto', editable:true },
      { id:'grupo', etiqueta:'Grupo', tipo:'texto', editable:true },
      { id:'capitulo', etiqueta:'Capítulo', tipo:'texto', editable:true },
      { id:'actividad', etiqueta:'Actividad', tipo:'texto', editable:true },
      { id:'descripcion', etiqueta:'Descripción', tipo:'texto', editable:true },
      { id:'centro_costo', etiqueta:'Centro de costo', tipo:'texto', editable:true },
      { id:'unidad', etiqueta:'Unidad', tipo:'texto', editable:true },
      { id:'uf', etiqueta:'UF', tipo:'texto', editable:true },
      { id:'proyecto', etiqueta:'Proyecto', tipo:'texto', editable:true },
      { id:'elemento', etiqueta:'Elemento', tipo:'texto', editable:true },
      { id:'pk_inicial', etiqueta:'PK inicial', tipo:'texto', editable:true },
      { id:'pk_final', etiqueta:'PK final', tipo:'texto', editable:true },
      { id:'abs_inicial', etiqueta:'Abs inicial', tipo:'texto', editable:true },
      { id:'abs_final', etiqueta:'Abs final', tipo:'texto', editable:true },
      { id:'liberacion', etiqueta:'Liberación', tipo:'texto', editable:true },
      { id:'largo', etiqueta:'Largo', tipo:'numero', editable:true },
      { id:'observacion', etiqueta:'Observación', tipo:'texto', editable:true },
      { id:'estado', etiqueta:'Estado', tipo:'lista', opciones:L_ESTADO_BANDEJA, editable:true },
      { id:'origen', etiqueta:'Origen', tipo:'texto', editable:true },
      { id:'area', etiqueta:'Área', tipo:'lista', opciones:L_AREA_BANDEJA, editable:true },
      { id:'personal_oficiales', etiqueta:'Oficiales', tipo:'numero', editable:true },
      { id:'personal_ayudantes', etiqueta:'Ayudantes', tipo:'numero', editable:true },
      { id:'turno_noche', etiqueta:'Turno noche', tipo:'texto', editable:true },
      { id:'nota_libre', etiqueta:'Nota libre', tipo:'texto', editable:true }
    ]
  },
  volquetas: {
    tabla:'volquetas', grupo:'registros', titulo:'Volquetas', descripcion:'Desglose por placa (chequeadora).',
    pk:['volqueta_id'], alta:false, baja:false,
    fechaObligatoria:true,
    filtros:[
      { id:'desde', tipo:'fecha', etiqueta:'Desde', requerido:true },
      { id:'hasta', tipo:'fecha', etiqueta:'Hasta', requerido:true },
      { id:'placa', tipo:'texto', etiqueta:'Placa' },
      { id:'origen', tipo:'texto', etiqueta:'Origen' },
      { id:'destino', tipo:'texto', etiqueta:'Destino / PK' }
    ],
    columnas:[
      { id:'volqueta_id', etiqueta:'ID', tipo:'texto', editable:false },
      { id:'id_registro', etiqueta:'ID línea', tipo:'texto', editable:false },
      { id:'timestamp', etiqueta:'Marca', tipo:'fecha', editable:false },
      { id:'fecha', etiqueta:'Fecha', tipo:'fecha', editable:true, requerido:true },
      { id:'reporta', etiqueta:'Reporta', tipo:'texto', editable:true },
      { id:'origen', etiqueta:'Origen', tipo:'texto', editable:true },
      { id:'destino', etiqueta:'Destino', tipo:'texto', editable:true },
      { id:'tipo_destino', etiqueta:'Tipo destino', tipo:'texto', editable:true },
      { id:'uf', etiqueta:'UF', tipo:'texto', editable:true },
      { id:'placa', etiqueta:'Placa', tipo:'texto', editable:true },
      { id:'viajes', etiqueta:'Viajes', tipo:'numero', editable:true },
      { id:'cubicaje', etiqueta:'Cubicaje', tipo:'numero', editable:true },
      { id:'m3_placa', etiqueta:'m³ placa', tipo:'numero', editable:true },
      { id:'cubicaje_origen', etiqueta:'Cubicaje origen', tipo:'lista', opciones:L_CUBICAJE_ORIGEN, editable:true }
    ]
  },
  /* ---------------- Parte Digital ---------------- */
  parte_cc: {
    tabla:'parte_cc', grupo:'parte', titulo:'CC del Parte', descripcion:'Centros de coste del Parte Digital.',
    pk:['centro_coste'], alta:true, baja:true, baja_es:'borrar',
    columnas:[
      { id:'centro_coste', etiqueta:'Centro coste', tipo:'texto', editable:false, requerido:true },
      { id:'proyecto', etiqueta:'Proyecto', tipo:'texto', editable:true },
      { id:'descripcion_cc', etiqueta:'Descripción', tipo:'texto', editable:true },
      { id:'usos_ult_4_meses', etiqueta:'Usos últ. 4 meses', tipo:'numero', editable:true },
      { id:'activo', etiqueta:'Activo', tipo:'texto', editable:true }
    ]
  },
  parte_actividades: {
    tabla:'parte_actividades', grupo:'parte', titulo:'Actividades del Parte', descripcion:'Descripción de trabajo por tipo de equipo.',
    pk:['tipo_equipo','descripcion_trabajo'], alta:true, baja:true, baja_es:'borrar',
    columnas:[
      { id:'tipo_equipo', etiqueta:'Tipo equipo', tipo:'texto', editable:false, requerido:true },
      { id:'descripcion_trabajo', etiqueta:'Descripción trabajo', tipo:'texto', editable:false, requerido:true },
      { id:'veces', etiqueta:'Veces', tipo:'numero', editable:true }
    ]
  },
  parte_items: {
    tabla:'parte_items', grupo:'parte', titulo:'Ítems del Parte', descripcion:'Actividad → ítem por tipo de equipo (D174).',
    pk:['tipo_equipo','item','actividad'], alta:true, baja:true, baja_es:'borrar',
    columnas:[
      { id:'tipo_equipo', etiqueta:'Tipo equipo', tipo:'texto', editable:false, requerido:true },
      { id:'item', etiqueta:'Ítem', tipo:'texto', editable:false, requerido:true },
      { id:'actividad', etiqueta:'Actividad', tipo:'texto', editable:false, requerido:true },
      { id:'veces', etiqueta:'Veces', tipo:'numero', editable:true },
      { id:'activo', etiqueta:'Activo', tipo:'texto', editable:true }
    ]
  },
  parte_operadores: {
    tabla:'parte_operadores', grupo:'parte', titulo:'Operadores del Parte', descripcion:'Catálogo de operadores.',
    pk:['operador'], alta:true, baja:true, baja_es:'borrar',
    columnas:[
      { id:'operador', etiqueta:'Operador', tipo:'texto', editable:false, requerido:true },
      { id:'partes_ult_4_meses', etiqueta:'Partes últ. 4 meses', tipo:'numero', editable:true },
      { id:'activo', etiqueta:'Activo', tipo:'texto', editable:true }
    ]
  },
  parte_equipos: {
    tabla:'parte_equipos', grupo:'parte', titulo:'Fichas de equipos', descripcion:'Placa · proveedor · medidor del Parte Digital.',
    pk:['codigo'], alta:true, baja:true, baja_es:'borrar',
    columnas:[
      { id:'codigo', etiqueta:'Código', tipo:'texto', editable:false, requerido:true },
      { id:'tipo', etiqueta:'Tipo', tipo:'texto', editable:true },
      { id:'placa', etiqueta:'Placa', tipo:'texto', editable:true },
      { id:'proveedor', etiqueta:'Proveedor', tipo:'texto', editable:true },
      { id:'medidor', etiqueta:'Medidor', tipo:'texto', editable:true },
      { id:'activo', etiqueta:'Activo', tipo:'texto', editable:true },
      { id:'ultimo_final_manual', etiqueta:'Último final (manual)', tipo:'numero', editable:true }
    ]
  },
  /* ---------------- Usuarios ---------------- */
  usuarios: {
    tabla:'usuarios', grupo:'usuarios', titulo:'Usuarios', descripcion:'Login de la app (D108). La clave nunca se lee.',
    pk:['usuario'], alta:true, baja:false, especial:'usuarios',
    columnas:[
      { id:'usuario', etiqueta:'Usuario', tipo:'texto', editable:false, requerido:true },
      { id:'clave_nueva', etiqueta:'Clave nueva', tipo:'clave', editable:true },
      { id:'rol', etiqueta:'Rol', tipo:'lista', opciones:L_ROL_USUARIO, editable:true, requerido:true },
      { id:'areas', etiqueta:'Áreas', tipo:'texto', editable:true },
      { id:'redirige', etiqueta:'Redirige a', tipo:'texto', editable:true },
      { id:'estado', etiqueta:'Estado', tipo:'lista', opciones:L_ESTADO_USUARIO, editable:true }
    ]
  },
  /* ---------------- Obra ---------------- */
  base_items: {
    tabla:'base_items', grupo:'obra', titulo:'Base — ítems (CC)', descripcion:'Catálogo de CC/descripción/unidad del reporte.',
    pk:['cc','descripcion'], alta:true, baja:true, baja_es:'borrar', especial:'base_items',
    columnas:[
      { id:'cc', etiqueta:'CC', tipo:'texto', editable:false, requerido:true },
      { id:'descripcion', etiqueta:'Descripción', tipo:'texto', editable:false, requerido:true },
      { id:'unidad', etiqueta:'Unidad', tipo:'texto', editable:true },
      { id:'orden', etiqueta:'Orden', tipo:'numero', editable:true },
      { id:'capitulo', etiqueta:'Capítulo', tipo:'texto', editable:true },
      { id:'grupo', etiqueta:'Grupo', tipo:'texto', editable:true },
      { id:'uf', etiqueta:'UF', tipo:'texto', editable:true },
      { id:'proyecto', etiqueta:'Proyecto', tipo:'texto', editable:true }
    ]
  },
  cubicaje: {
    tabla:'cubicaje', grupo:'obra', titulo:'Cubicaje', descripcion:'m³/viaje real por placa (D53).', especial:'cubicaje',
    pk:['placa'], alta:true, baja:true, baja_es:'borrar',
    columnas:[
      { id:'placa', etiqueta:'Placa', tipo:'texto', editable:false, requerido:true },
      { id:'cubicaje', etiqueta:'Cubicaje (m³)', tipo:'numero', editable:true, requerido:true },
      { id:'tipo', etiqueta:'Tipo', tipo:'texto', editable:true }
    ]
  },
  fc_actividad: {
    tabla:'fc_actividad', grupo:'obra', titulo:'FC por actividad', descripcion:'Factor suelto→compacto (D184, tabla 007).',
    pk:['descripcion'], alta:true, baja:true, baja_es:'borrar',
    columnas:[
      { id:'descripcion', etiqueta:'Descripción', tipo:'texto', editable:false, requerido:true },
      { id:'fc', etiqueta:'FC', tipo:'numero', editable:true, requerido:true },
      { id:'nota', etiqueta:'Nota', tipo:'texto', editable:true }
    ]
  },
  tablero_mapeo: {
    tabla:'tablero_mapeo', grupo:'obra', titulo:'Mapeo del Tablero', descripcion:'Descripción de DATA × UF → campo del Tablero (008).',
    pk:['descripcion','uf'], alta:true, baja:true, baja_es:'borrar',
    columnas:[
      { id:'descripcion', etiqueta:'Descripción', tipo:'texto', editable:false, requerido:true },
      { id:'uf', etiqueta:'UF', tipo:'lista', opciones:L_TABLERO_UF, editable:false, requerido:true },
      { id:'campo', etiqueta:'Campo', tipo:'lista', opciones:L_TABLERO_CAMPO, editable:true, requerido:true },
      { id:'orden', etiqueta:'Orden', tipo:'numero', editable:true }
    ]
  },
  /* ---------------- Asistencias ---------------- */
  cuadrillas: {
    tabla:'cuadrillas', grupo:'asistencias', titulo:'Cuadrillas', descripcion:'Catálogo de cuadrillas.',
    pk:['cuadrilla'], alta:true, baja:true, baja_es:'borrar',
    columnas:[
      { id:'cuadrilla', etiqueta:'Cuadrilla', tipo:'texto', editable:false, requerido:true },
      { id:'responsables', etiqueta:'Responsables', tipo:'texto', editable:true },
      { id:'area', etiqueta:'Área', tipo:'texto', editable:true },
      { id:'estado', etiqueta:'Estado', tipo:'texto', editable:true }
    ]
  },
  config: {
    tabla:'config', grupo:'asistencias', titulo:'Config', descripcion:'Clave/valor de asistencias.',
    pk:['clave'], alta:true, baja:true, baja_es:'borrar',
    columnas:[
      { id:'clave', etiqueta:'Clave', tipo:'texto', editable:false, requerido:true },
      { id:'valor', etiqueta:'Valor', tipo:'texto', editable:true }
    ]
  },
  festivos: {
    tabla:'festivos', grupo:'asistencias', titulo:'Festivos', descripcion:'Calendario de festivos.',
    pk:['fecha'], alta:true, baja:true, baja_es:'borrar',
    columnas:[
      { id:'fecha', etiqueta:'Fecha', tipo:'fecha', editable:false, requerido:true }
    ]
  },
  turnos: {
    tabla:'turnos', grupo:'asistencias', titulo:'Turnos', descripcion:'Horarios por turno y tipo de día.',
    pk:['turno','tipo_dia'], alta:true, baja:true, baja_es:'borrar',
    columnas:[
      { id:'turno', etiqueta:'Turno', tipo:'texto', editable:false, requerido:true },
      { id:'tipo_dia', etiqueta:'Tipo día', tipo:'texto', editable:false, requerido:true },
      { id:'entrada', etiqueta:'Entrada', tipo:'texto', editable:true },
      { id:'salida', etiqueta:'Salida', tipo:'texto', editable:true },
      { id:'descanso_ini', etiqueta:'Descanso ini', tipo:'texto', editable:true },
      { id:'descanso_fin', etiqueta:'Descanso fin', tipo:'texto', editable:true },
      { id:'cruza_medianoche', etiqueta:'Cruza medianoche', tipo:'texto', editable:true }
    ]
  },
  cat_cc: {
    tabla:'cat_cc', grupo:'asistencias', titulo:'CC (asistencias)', descripcion:'Catálogo de CC del formulario de asistencia.',
    pk:['string_cc'], alta:true, baja:true, baja_es:'borrar',
    columnas:[
      { id:'string_cc', etiqueta:'CC', tipo:'texto', editable:false, requerido:true },
      { id:'orden', etiqueta:'Orden', tipo:'numero', editable:true }
    ]
  },
  cat_motivos: {
    tabla:'cat_motivos', grupo:'asistencias', titulo:'Motivos', descripcion:'Catálogo de motivos de asistencia.',
    pk:['string_motivo'], alta:true, baja:true, baja_es:'borrar',
    columnas:[
      { id:'string_motivo', etiqueta:'Motivo', tipo:'texto', editable:false, requerido:true },
      { id:'orden', etiqueta:'Orden', tipo:'numero', editable:true }
    ]
  },
  cat_trabajadores: {
    tabla:'cat_trabajadores', grupo:'asistencias', titulo:'Trabajadores (Navision)', descripcion:'Código → texto Navision.',
    pk:['codigo'], alta:true, baja:true, baja_es:'borrar',
    columnas:[
      { id:'codigo', etiqueta:'Código', tipo:'texto', editable:false, requerido:true },
      { id:'string_navision', etiqueta:'Navision', tipo:'texto', editable:true }
    ]
  },
  cc_usados: {
    tabla:'cc_usados', grupo:'asistencias', titulo:'CC usados (derivado)', descripcion:'Usos recientes por área — solo lectura (automático).',
    pk:['string_cc','area'], alta:false, baja:false,
    columnas:[
      { id:'string_cc', etiqueta:'CC', tipo:'texto', editable:false },
      { id:'area', etiqueta:'Área', tipo:'texto', editable:false },
      { id:'orden', etiqueta:'Orden', tipo:'numero', editable:false }
    ]
  },
  motivos_usados: {
    tabla:'motivos_usados', grupo:'asistencias', titulo:'Motivos usados (derivado)', descripcion:'Usos recientes — solo lectura (automático).',
    pk:['string_motivo'], alta:false, baja:false,
    columnas:[
      { id:'string_motivo', etiqueta:'Motivo', tipo:'texto', editable:false },
      { id:'orden', etiqueta:'Orden', tipo:'numero', editable:false }
    ]
  }
};

const CA_GRUPOS = [
  { id:'registros',   titulo:'Registros' },
  { id:'parte',        titulo:'Parte Digital' },
  { id:'usuarios',     titulo:'Usuarios' },
  { id:'obra',         titulo:'Obra' },
  { id:'asistencias',  titulo:'Asistencias' }
];

/* ---------- resolución segura de una tabla del cliente contra la lista blanca ---------- */
function tablaCfg_(id){
  const k = txt_(id).toLowerCase();
  return (Object.prototype.hasOwnProperty.call(CA_TABLAS, k)) ? CA_TABLAS[k] : null;
}

/* ---------- GET ?action=cat_tablas ---------- */
export async function catTablas(c, params, ses){
  const permiso = permiso_(ses, CA_ROLES_ESCRIBEN, [], 'administrar catálogos');
  if(!permiso.ok){ logMarcar_(c, 'rechazado', 'catalogos: '+permiso.error); return json(c, { ok:false, error:permiso.error }); }
  const tablas = Object.keys(CA_TABLAS).map(function(id){
    const cfg = CA_TABLAS[id];
    // `usuarios` nunca describe la columna `clave` real (no existe en la config: solo la virtual clave_nueva).
    return {
      id:id, grupo:cfg.grupo, titulo:cfg.titulo, descripcion:cfg.descripcion||'', pk:cfg.pk.slice(),
      alta:!!cfg.alta, baja:!!cfg.baja, baja_es:cfg.baja_es||null,
      filtros:(cfg.filtros||[]).map(function(f){ return Object.assign({}, f); }),
      columnas:cfg.columnas.map(function(col){ return Object.assign({}, col); })
    };
  });
  return json(c, { ok:true, grupos:CA_GRUPOS, tablas:tablas, tope:CA_TOPE_FILAS });
}

/* ======================================================================================================
 * LECTURA
 * ====================================================================================================== */
function parsearFiltros_(params){
  const raw = params && params.filtros;
  if(!raw) return {};
  try{ const o=JSON.parse(String(raw)); return (o && typeof o==='object' && !Array.isArray(o)) ? o : {}; }
  catch(err){ return {}; }
}

// Bandeja/volquetas: rango de fechas obligatorio, máx CA_MAX_DIAS_FILTRO días.
function validarRangoFechas_(cfg, filtros){
  if(!cfg.fechaObligatoria) return null;
  const desde=fechaValida_(filtros.desde), hasta=fechaValida_(filtros.hasta);
  if(!desde || !hasta) return 'esta tabla exige un rango de fechas (desde/hasta, formato AAAA-MM-DD).';
  if(hasta<desde) return 'la fecha "hasta" no puede ser anterior a "desde".';
  if(diasEntre_(desde,hasta) > CA_MAX_DIAS_FILTRO) return 'el rango no puede superar '+CA_MAX_DIAS_FILTRO+' días.';
  return null;
}

// Cruce de intervalos [ini,fin] cerrados; fila sin PK parseable solo se descarta si HAY filtro de PK.
function pkCruza_(iniFila, finFila, iniF, finF){
  if(iniFila==null && finFila==null) return false;
  const a = iniFila==null ? finFila : iniFila, b = finFila==null ? iniFila : finFila;
  return a<=finF && b>=iniF;
}

async function leerBandeja_(c, filtros){
  const err = validarRangoFechas_(CA_TABLAS.bandeja, filtros); if(err) return { error:err };
  const cond=[`obra_id = $1`, `fecha >= $2`, `fecha <= $3`];
  const vals=[OBRA_ID, filtros.desde, filtros.hasta];
  function push(sqlTxt, v){ vals.push(v); cond.push(sqlTxt.replace('?', '$'+vals.length)); }
  if(txt_(filtros.reporta))      push('reporta ILIKE ?', '%'+txt_(filtros.reporta)+'%');
  if(txt_(filtros.rol))          push('rol ILIKE ?', '%'+txt_(filtros.rol)+'%');
  if(txt_(filtros.actividad))    push('actividad ILIKE ?', '%'+txt_(filtros.actividad)+'%');
  if(txt_(filtros.centro_costo)) push('centro_costo ILIKE ?', '%'+txt_(filtros.centro_costo)+'%');
  if(filtros.area!==undefined && filtros.area!==null && txt_(filtros.area)!=='' && L_AREA_BANDEJA.indexOf(txt_(filtros.area))>=0)
    push('area = ?', txt_(filtros.area));
  if(txt_(filtros.estado) && L_ESTADO_BANDEJA.indexOf(txt_(filtros.estado))>=0) push('estado = ?', txt_(filtros.estado));

  const texto = `SELECT id_registro, "timestamp", fecha, reporta, rol, grupo, capitulo, actividad, descripcion,
      centro_costo, unidad, uf, proyecto, elemento, pk_inicial, pk_final, abs_inicial, abs_final, liberacion,
      largo, observacion, estado, origen, area, personal_oficiales, personal_ayudantes, turno_noche, nota_libre
    FROM bandeja WHERE ${cond.join(' AND ')} ORDER BY fecha, "timestamp" LIMIT ${CA_TOPE_FILAS+1}`;
  let filas = await c.sql.unsafe(texto, vals);

  const pkDesdeTxt = txt_(filtros.pk_desde), pkHastaTxt = txt_(filtros.pk_hasta);
  const hayFiltroPk = !!(pkDesdeTxt || pkHastaTxt);
  if(hayFiltroPk){
    const iniF = pkDesdeTxt ? pkMeters(pkDesdeTxt) : null;
    const finF = pkHastaTxt ? pkMeters(pkHastaTxt) : null;
    filas = filas.filter(function(r){
      const a = r.pk_inicial ? pkMeters(r.pk_inicial) : null, b = r.pk_final ? pkMeters(r.pk_final) : null;
      return pkCruza_(a, b, (iniF==null?-Infinity:iniF), (finF==null?Infinity:finF));
    });
  }
  return { filas: filas };
}

async function leerVolquetas_(c, filtros){
  const err = validarRangoFechas_(CA_TABLAS.volquetas, filtros); if(err) return { error:err };
  const cond=[`obra_id = $1`, `fecha >= $2`, `fecha <= $3`];
  const vals=[OBRA_ID, filtros.desde, filtros.hasta];
  function push(sqlTxt, v){ vals.push(v); cond.push(sqlTxt.replace('?', '$'+vals.length)); }
  if(txt_(filtros.placa))   push('placa ILIKE ?', '%'+txt_(filtros.placa)+'%');
  if(txt_(filtros.origen))  push('origen ILIKE ?', '%'+txt_(filtros.origen)+'%');
  if(txt_(filtros.destino)) push('destino ILIKE ?', '%'+txt_(filtros.destino)+'%');
  const texto = `SELECT volqueta_id, id_registro, "timestamp", fecha, reporta, origen, destino, tipo_destino, uf,
      placa, viajes, cubicaje, m3_placa, cubicaje_origen
    FROM volquetas WHERE ${cond.join(' AND ')} ORDER BY fecha, "timestamp" LIMIT ${CA_TOPE_FILAS+1}`;
  return { filas: await c.sql.unsafe(texto, vals) };
}

// Lectura genérica: SELECT de todas las columnas declaradas (usuarios: sin `clave`), sin filtro, tope de filas.
async function leerGenerica_(c, cfg){
  const cols = cfg.columnas.filter(function(col){ return col.tipo!=='clave'; }).map(function(col){ return col.id; });
  const texto = `SELECT ${cols.map(function(x){ return '"'+x+'"'; }).join(', ')} FROM "${cfg.tabla}"
    WHERE obra_id = $1 ORDER BY ${cfg.pk.map(function(x){ return '"'+x+'"'; }).join(', ')} LIMIT ${CA_TOPE_FILAS+1}`;
  return { filas: await c.sql.unsafe(texto, [OBRA_ID]) };
}

function filaConK_(cfg, r){
  const k={}; cfg.pk.forEach(function(p){ k[p]=r[p]; });
  const out = Object.assign({}, r); out._k = k; return out;
}

/* ---------- GET ?action=cat_leer ---------- */
export async function catLeer(c, params, ses){
  const permiso = permiso_(ses, CA_ROLES_ESCRIBEN, [], 'administrar catálogos');
  if(!permiso.ok){ logMarcar_(c, 'rechazado', 'catalogos: '+permiso.error); return json(c, { ok:false, error:permiso.error }); }
  const tablaId = txt_(params && params.tabla).toLowerCase();
  const cfg = tablaCfg_(tablaId);
  if(!cfg) return json(c, { ok:false, error:'Tabla «'+txt_(params && params.tabla)+'» no reconocida.' });
  const filtros = parsearFiltros_(params);
  let r;
  if(cfg.tabla==='bandeja')       r = await leerBandeja_(c, filtros);
  else if(cfg.tabla==='volquetas') r = await leerVolquetas_(c, filtros);
  else                              r = await leerGenerica_(c, cfg);
  if(r.error) return json(c, { ok:false, error:r.error });
  const truncado = r.filas.length > CA_TOPE_FILAS;
  const filas = (truncado ? r.filas.slice(0, CA_TOPE_FILAS) : r.filas).map(function(row){ return filaConK_(cfg, row); });
  return json(c, { ok:true, tabla: tablaId, filas: filas, total: filas.length, truncado: truncado });
}

/* ======================================================================================================
 * ESCRITURA
 * ====================================================================================================== */

// Valor tal cual llega, listo para bindear (después de convertir por tipo de columna). undefined = inválido.
function convertirValor_(col, v){
  if(v===undefined) return undefined;   // no vino: no se toca en el UPDATE
  switch(col.tipo){
    case 'numero': { if(v===null || v==='') return null; const n=numONull_(v); return n; }
    case 'bool':   return boolv_(v) ? 'SI' : '';   // por si alguna columna futura guarda SI/NO en texto
    case 'fecha':  { if(v===''||v===null) return null; const f=fechaValida_(v); return f || undefined; }
    case 'lista':  { const s=txt_(v); if(s==='') return ''; return (col.opciones||[]).indexOf(s)>=0 ? s : undefined; }
    case 'clave':  return v==null ? '' : String(v);   // clave_nueva: nunca se recorta (la valida usuarios)
    default:       return textoLibre_(v);
  }
}

function validarCampoRequerido_(col, valor){
  if(!col.requerido) return null;
  const vacio = valor===null || valor===undefined || valor==='';
  return vacio ? ('el campo «'+col.etiqueta+'» es obligatorio.') : null;
}

/* ---------- construir SET/valores de un cambio contra la config de columnas (alta o update) ---------- */
function camposDesdeCambio_(cfg, campos, esAlta){
  const out={}, errores=[];
  cfg.columnas.forEach(function(col){
    if(col.tipo==='clave') return;   // clave_nueva se procesa aparte (especial:'usuarios')
    const enPayload = campos && Object.prototype.hasOwnProperty.call(campos, col.id);
    if(!enPayload) return;
    if(!esAlta && !col.editable) { errores.push('«'+col.etiqueta+'» no es editable.'); return; }
    const v = convertirValor_(col, campos[col.id]);
    if(v===undefined){ errores.push('«'+col.etiqueta+'»: valor no admitido.'); return; }
    const reqPresente = validarCampoRequerido_(col, v);   // presente pero vacío en un campo requerido (alta o update)
    if(reqPresente){ errores.push(reqPresente); return; }
    out[col.id]=v;
  });
  if(esAlta){
    cfg.columnas.forEach(function(col){
      if(col.tipo==='clave') return;
      if(!(col.id in out)){
        const req = validarCampoRequerido_(col, undefined);
        if(req) errores.push(req);
      }
    });
  }
  return { campos: out, errores: errores };
}

/* ---------- especial: usuarios (clave_nueva → hash, unicidad, auto-bloqueo) ---------- */
async function prepararUsuario_(c, cfg, campos, esAlta, actualPk){
  const errores=[];
  const usuarioNuevo = campos.usuario!==undefined ? txt_(campos.usuario).toLowerCase() : null;
  if(usuarioNuevo!==null) campos.usuario = usuarioNuevo;
  const cambiaUsuario = !esAlta && usuarioNuevo!==null && usuarioNuevo!==actualPk.usuario;
  const claveNueva = txt_(campos.clave_nueva);
  if(esAlta && !claveNueva) errores.push('el alta de un usuario exige «Clave nueva».');
  if(cambiaUsuario && !claveNueva) errores.push('cambiar el nombre de usuario exige «Clave nueva» (el hash depende del usuario).');
  let hash;
  if(claveNueva){
    const u = usuarioNuevo!==null ? usuarioNuevo : actualPk.usuario;
    hash = await hashClave_(u, claveNueva);
  }
  delete campos.clave_nueva;
  return { errores: errores, hash: hash };
}

/* ---------- especial: base_items (formato de CC + sin duplicar cc+descripcion) ---------- */
const RE_CC = /^\d{4}\.\d{2}\.\d{2}$/;
function validarBaseItem_(campos){
  const cc = txt_(campos.cc);
  if(cc && !RE_CC.test(cc)) return 'el CC «'+cc+'» no tiene el formato esperado (NNNN.NN.NN).';
  return null;
}

/* ---------- especial: cubicaje (placa normalizada, número > 0) ---------- */
function prepararCubicaje_(campos){
  if(campos.placa!==undefined) campos.placa = normPlaca(campos.placa);
  if(campos.cubicaje!==undefined && (campos.cubicaje===null || Number(campos.cubicaje)<=0))
    return 'el cubicaje debe ser un número mayor que 0.';
  return null;
}

/* ---------- avisos: bandeja ya incluida en DATA ---------- */
function avisoBandejaIncluida_(actual){
  if(!actual || actual.estado!=='incluido') return null;
  return { clave: { id_registro: actual.id_registro },
    texto: 'Ya enviada a DATA el '+txt_(actual.fecha)+': DATA no cambia; corrígela también en data.html.' };
}

/* ---------- SQL dinámico (solo con nombres de la lista blanca; valores SIEMPRE parametrizados) ---------- */
function ident_(s){ return '"'+String(s)+'"'; }
function whereObraYPk_(cfg, pkVals, vals){
  const partes=['obra_id = $'+(vals.push(OBRA_ID))];
  cfg.pk.forEach(function(p){ partes.push(ident_(p)+' = $'+(vals.push(pkVals[p]))); });
  return partes;
}
function whereAntesCols_(antes, cfg, vals){
  const partes=[];
  if(!antes) return partes;
  Object.keys(antes).forEach(function(k){
    const esCol = cfg.columnas.some(function(c){ return c.id===k && c.tipo!=='clave'; }) || cfg.pk.indexOf(k)>=0;
    if(!esCol) return;
    partes.push(ident_(k)+' IS NOT DISTINCT FROM $'+(vals.push(antes[k])));
  });
  return partes;
}

async function ejecutarAlta_(sql, cfg, campos){
  const cols = Object.keys(campos);
  const vals = [OBRA_ID];
  cols.forEach(function(k){ vals.push(campos[k]); });
  const placeholders = cols.map(function(_, i){ return '$'+(i+2); });
  const texto = `INSERT INTO ${ident_(cfg.tabla)} (obra_id${cols.length?', ':''}${cols.map(ident_).join(', ')})
    VALUES ($1${cols.length?', ':''}${placeholders.join(', ')}) RETURNING ${cfg.pk.map(ident_).join(', ')}`;
  const r = await sql.unsafe(texto, vals);
  return r[0];
}
async function ejecutarUpdate_(sql, cfg, pkVals, campos, antes){
  const cols = Object.keys(campos);
  if(!cols.length) return { filas: [pkVals] };   // nada que cambiar: no toca la BD, no es conflicto
  const vals=[];
  const setParts = cols.map(function(k){ vals.push(campos[k]); return ident_(k)+' = $'+vals.length; });
  const whereParts = whereObraYPk_(cfg, pkVals, vals).concat(whereAntesCols_(antes, cfg, vals));
  const texto = `UPDATE ${ident_(cfg.tabla)} SET ${setParts.join(', ')} WHERE ${whereParts.join(' AND ')} RETURNING ${cfg.pk.map(ident_).join(', ')}`;
  const r = await sql.unsafe(texto, vals);
  return { filas: r };
}
async function ejecutarBaja_(sql, cfg, pkVals, antes){
  const vals=[];
  const whereParts = whereObraYPk_(cfg, pkVals, vals).concat(whereAntesCols_(antes, cfg, vals));
  if(cfg.baja_es==='descartar'){
    vals.push(cfg.baja_valor);
    const texto = `UPDATE ${ident_(cfg.tabla)} SET ${ident_(cfg.baja_columna)} = $${vals.length} WHERE ${whereParts.join(' AND ')} RETURNING ${cfg.pk.map(ident_).join(', ')}`;
    return await sql.unsafe(texto, vals);
  }
  const texto = `DELETE FROM ${ident_(cfg.tabla)} WHERE ${whereParts.join(' AND ')} RETURNING ${cfg.pk.map(ident_).join(', ')}`;
  return await sql.unsafe(texto, vals);
}
async function leerFilaActual_(sql, cfg, pkVals){
  const vals=[];
  const whereParts = whereObraYPk_(cfg, pkVals, vals);
  const texto = `SELECT * FROM ${ident_(cfg.tabla)} WHERE ${whereParts.join(' AND ')} LIMIT 1`;
  const r = await sql.unsafe(texto, vals);
  return r[0] || null;
}
async function insertarAuditoria_(sql, usuario, tabla, op, clave, antes, despues){
  await sql.unsafe(
    `INSERT INTO catalogo_auditoria (obra_id, usuario, tabla, op, clave, antes, despues) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [OBRA_ID, usuario, tabla, op, JSON.stringify(clave||{}), JSON.stringify(antes||{}), JSON.stringify(despues||{})]
  );
}
function enmascararClave_(cfg, obj){
  if(!obj || cfg.especial!=='usuarios') return obj;
  const o=Object.assign({}, obj);
  if('clave' in o) o.clave='***';
  if('clave_nueva' in o) o.clave_nueva='***';
  return o;
}

/* ---------- POST {action:'cat_guardar'} ---------- */
export async function catGuardar(c, body, ses){
  const permiso = permiso_(ses, CA_ROLES_ESCRIBEN, [], 'administrar catálogos');
  if(!permiso.ok){ logMarcar_(c, 'rechazado', 'catalogos: '+permiso.error); return json(c, { ok:false, error:permiso.error }); }

  const cfg = tablaCfg_(body.tabla);
  if(!cfg) return json(c, { ok:false, error:'Tabla «'+txt_(body.tabla)+'» no reconocida.', errores:[] });

  const cambios = Array.isArray(body.cambios) ? body.cambios : [];
  if(!cambios.length) return json(c, { ok:false, error:'No llegó ningún cambio para guardar.' });
  if(cambios.length>CA_MAX_CAMBIOS) return json(c, { ok:false, error:'Demasiados cambios de una vez (máx. '+CA_MAX_CAMBIOS+'). Guarda por partes.' });

  const usuario = txt_(ses && ses.usuario) || 'admin';
  const errores=[];
  const plan=[];   // { i, op, campos, pkVals, antes }

  for(let i=0;i<cambios.length;i++){
    const ch = cambios[i] || {};
    const op = txt_(ch.op || 'update').toLowerCase();
    if(['alta','update','baja'].indexOf(op)<0){ errores.push({ i:i, campo:'op', motivo:'operación no reconocida (alta, update, baja).' }); continue; }
    if(op==='alta' && !cfg.alta){ errores.push({ i:i, campo:'op', motivo:'esta tabla no admite alta.' }); continue; }
    if(op==='baja' && !cfg.baja){ errores.push({ i:i, campo:'op', motivo:'esta tabla no admite baja.' }); continue; }

    if(op==='alta'){
      const { campos, errores:errCampos } = camposDesdeCambio_(cfg, ch.campos||{}, true);
      errCampos.forEach(function(m){ errores.push({ i:i, campo:cfg.tabla, motivo:m }); });
      if(errCampos.length) continue;

      if(cfg.especial==='usuarios'){
        campos.clave_nueva = (ch.campos||{}).clave_nueva;   // camposDesdeCambio_ omite las columnas tipo 'clave'
        const r = await prepararUsuario_(c, cfg, campos, true, {});
        r.errores.forEach(function(m){ errores.push({ i:i, campo:'usuario', motivo:m }); });
        if(r.errores.length) continue;
        campos.clave = r.hash;
      }
      if(cfg.especial==='base_items'){
        const m = validarBaseItem_(campos); if(m){ errores.push({ i:i, campo:'cc', motivo:m }); continue; }
      }
      if(cfg.especial==='cubicaje'){
        const m = prepararCubicaje_(campos); if(m){ errores.push({ i:i, campo:'cubicaje', motivo:m }); continue; }
      }
      const pkVals={}; cfg.pk.forEach(function(p){ pkVals[p]=campos[p]; });
      plan.push({ i:i, op:'alta', campos:campos, pkVals:pkVals, antes:null });
    } else {
      // update / baja: PK obligatoria, viene en ch.k (la que trajo cat_leer en `_k`).
      const pkVals={};
      const k = ch.k || {};
      let faltaPk=false;
      cfg.pk.forEach(function(p){ if(k[p]===undefined || k[p]===null || k[p]===''){ faltaPk=true; } pkVals[p]=k[p]; });
      if(faltaPk){ errores.push({ i:i, campo:'k', motivo:'falta la clave de la fila (k).' }); continue; }

      if(op==='update'){
        const { campos, errores:errCampos } = camposDesdeCambio_(cfg, ch.campos||{}, false);
        errCampos.forEach(function(m){ errores.push({ i:i, campo:cfg.tabla, motivo:m }); });
        if(errCampos.length) continue;

        if(cfg.especial==='usuarios'){
          campos.clave_nueva = (ch.campos||{}).clave_nueva;   // camposDesdeCambio_ omite las columnas tipo 'clave'
          const r = await prepararUsuario_(c, cfg, campos, false, pkVals);
          r.errores.forEach(function(m){ errores.push({ i:i, campo:'usuario', motivo:m }); });
          if(r.errores.length) continue;
          if(r.hash!==undefined) campos.clave = r.hash;
          delete campos.usuario;   // usuario (PK) es editable:false: camposDesdeCambio_ ya lo habría rechazado si venía
          // Auto-bloqueo: el admin no puede quitarse el rol admin ni desactivarse a sí mismo.
          if(txt_(pkVals.usuario).toLowerCase()===txt_(usuario).toLowerCase()){
            if(campos.rol!==undefined && txt_(campos.rol)!=='admin'){ errores.push({ i:i, campo:'rol', motivo:'no puedes quitarte el rol admin a ti mismo.' }); continue; }
            if(campos.estado!==undefined && txt_(campos.estado)==='inactivo'){ errores.push({ i:i, campo:'estado', motivo:'no puedes desactivarte a ti mismo.' }); continue; }
          }
        }
        if(cfg.especial==='base_items'){
          const m = validarBaseItem_(Object.assign({}, pkVals, campos)); if(m){ errores.push({ i:i, campo:'cc', motivo:m }); continue; }
        }
        if(cfg.especial==='cubicaje'){
          const m = prepararCubicaje_(campos); if(m){ errores.push({ i:i, campo:'cubicaje', motivo:m }); continue; }
        }
        plan.push({ i:i, op:'update', campos:campos, pkVals:pkVals, antes:ch.antes||null });
      } else {
        // baja
        if(cfg.tabla==='usuarios'){ errores.push({ i:i, campo:'op', motivo:'los usuarios no se borran: cambia el estado a inactivo.' }); continue; }
        plan.push({ i:i, op:'baja', campos:null, pkVals:pkVals, antes:ch.antes||null });
      }
    }
  }

  if(errores.length){
    logMarcar_(c, 'rechazado', 'catalogos: validacion '+cfg.tabla);
    return json(c, { ok:false, error:'payload', errores:errores });
  }
  if(!plan.length) return json(c, { ok:false, error:'No quedó ningún cambio válido para guardar.' });

  const avisos=[];
  const conflictos=[];
  function _Rollback_(){ this.marca='cat_rollback'; }
  let aplicados=0;
  const filasResultado=[];
  try{
    await c.sql.begin(async function(sql){
      await sql.unsafe('SELECT pg_advisory_xact_lock(hashtext($1))', ['cat:'+cfg.tabla+':'+OBRA_ID]);
      for(let j=0;j<plan.length;j++){
        const p = plan[j];
        if(p.op==='alta'){
          let fila;
          try{ fila = await ejecutarAlta_(sql, cfg, p.campos); }
          catch(err){
            const msg=String(err && err.message || err);
            if(/duplicate key|unique/i.test(msg)) throw Object.assign(new Error('Ya existe una fila con esa clave.'), { esValidacion:true });
            throw err;
          }
          await insertarAuditoria_(sql, usuario, cfg.tabla, 'alta', enmascararClave_(cfg, fila), null, enmascararClave_(cfg, p.campos));
          aplicados++; filasResultado.push(Object.assign({}, fila));
        } else if(p.op==='update'){
          const actual = await leerFilaActual_(sql, cfg, p.pkVals);
          if(!actual){ conflictos.push({ i:p.i, motivo:'la fila ya no existe' }); continue; }
          if(cfg.tabla==='bandeja'){ const av=avisoBandejaIncluida_(actual); if(av) avisos.push(av); }
          const r = await ejecutarUpdate_(sql, cfg, p.pkVals, p.campos, p.antes);
          if(!r.filas.length){ conflictos.push({ i:p.i, motivo:'version' }); continue; }
          await insertarAuditoria_(sql, usuario, cfg.tabla, 'update', enmascararClave_(cfg, p.pkVals), enmascararClave_(cfg, actual), enmascararClave_(cfg, Object.assign({}, actual, p.campos)));
          aplicados++; filasResultado.push(Object.assign({}, actual, p.campos));
        } else { // baja
          const actual = await leerFilaActual_(sql, cfg, p.pkVals);
          if(!actual){ continue; }   // ya no está: nada que borrar (como grilla.js)
          if(cfg.tabla==='bandeja'){ const av=avisoBandejaIncluida_(actual); if(av) avisos.push(av); }
          const r = await ejecutarBaja_(sql, cfg, p.pkVals, p.antes);
          if(!r.length){ conflictos.push({ i:p.i, motivo:'version' }); continue; }
          const despues = cfg.baja_es==='descartar' ? Object.assign({}, actual, { [cfg.baja_columna]: cfg.baja_valor }) : null;
          await insertarAuditoria_(sql, usuario, cfg.tabla, 'baja', enmascararClave_(cfg, p.pkVals), enmascararClave_(cfg, actual), enmascararClave_(cfg, despues));
          aplicados++;
        }
      }
      if(conflictos.length) throw new _Rollback_();
    });
  }catch(e){
    if(e && e.esValidacion) return json(c, { ok:false, error:e.message });
    if(!(e instanceof _Rollback_)) throw e;
  }

  invalidarMemo_(c, null);   // catálogos cruzados por descripción/CC/placa: más simple invalidar todo el memo de la petición

  if(conflictos.length){
    logMarcar_(c, 'rechazado', 'catalogos: conflicto '+cfg.tabla);
    return json(c, { ok:false, conflicto:true, error:'Otra persona cambió '+conflictos.length+' fila(s) mientras tanto; recarga e intenta de nuevo.', conflictos:conflictos });
  }

  logMarcar_(c, 'ok', 'catalogos: '+cfg.tabla+' '+aplicados);
  return json(c, { ok:true, aplicados:aplicados, avisos:avisos, filas: filasResultado.map(function(f){ return filaConK_(cfg, f); }) });
}

/* ---------- esquema D166 del payload (lo importa api/obra.js → validarPayloadObra_) ----------
 * valEsquema_ (comun.js) solo sabe validar tipos escalares y ARRAYS ('a'); `campos`/`k`/`antes` son
 * OBJETOS libres (una forma por tabla) así que NO se declaran aquí — valEsquema_ solo revisa las claves
 * que declara el esquema, y la forma exacta de esos tres objetos la valida catGuardar por columna
 * (camposDesdeCambio_, whereAntesCols_): es la validación de negocio, no la de tipos de D166. */
export const VAL_OBRA_CAT = { tabla:['t',40] };
export const VAL_OBRA_CAT_CAMBIO = { op:['l',['alta','update','baja']] };
