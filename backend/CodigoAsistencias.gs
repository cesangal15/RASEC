/**
 * Módulo de Asistencias de Personal de Tierra — TM2 Sur (Backend, Google Apps Script)
 *
 * AISLADO del reporte diario de obra: Sheet nuevo, script nuevo (URL propia). Nunca toca
 * BANDEJA/DATA/MAQUINARIA ni el Codigo.gs del reporte de obra (D69 del registro de decisiones).
 *
 * Flujo: responsable de cuadrilla reporta su gente (asistencia.html) -> hoja ASISTENCIA (directo,
 * sin bandeja: cada persona tiene un solo responsable; re-envío pisa fecha+cuadrilla, D03).
 * Residente/jeisson consultan el resumen del día y exportan el Excel formato Navision
 * (resumen-asistencia.html, SheetJS en el navegador).
 *
 * Endpoints:
 *   GET  ?action=roster&usuario=…            -> cuadrillas del usuario + personas activas + CONFIG
 *                                                + CAT_CC + motivos FRECUENTES (MOTIVOS_USADOS, D78)
 *                                                + CC recientes por cuadrilla
 *   GET  ?action=asistencia&fecha=…          -> filas del día + estado por cuadrilla + faltantes
 *                                                + catálogos COMPLETOS (CC y motivos, D78)
 *   GET  ?action=personal                    -> PERSONAL completo + CUADRILLAS (gestión)
 *   GET  ?action=export&fecha=…              -> filas crudas del día (todas) + catálogos para el
 *                                                generador Navision (cliente decide por proyecto)
 *   GET  ?action=ausencias&desde=&hasta=…    -> seguimiento de ausencias por RANGO (D94): ausencias
 *                                                reportadas (con motivo) + días sin reportar
 *   GET  ?action=persona_admin&desde=&hasta=  -> horas del PROPIO admin (EXTRAS_ADMIN, D142)
 *   GET  ?action=persona&codigo=&cedula=&desde=&hasta=
 *                                             -> horas de UNA persona en un rango (D112): filas CRUDAS
 *                                                + config/festivos/turnos; clasifica el cliente con el
 *                                                mismo `horas-nomina.js` del Parte. Solo lectura.
 *   POST {action:'reporte_asistencia', fecha, cuadrilla, reporta, filas:[…]}
 *                                             -> pisa fecha+cuadrilla, escribe (confirma conteo, D30)
 *   POST {action:'personal', op:'alta'|'retiro'|'mover'|'reactivar', usuario, …}
 *                                             -> valida usuario ∈ {residente, admin} antes de escribir
 *   GET  ?action=extras_admin&fecha=…       -> registro de EXTRAS_ADMIN del día (o null) — prefill (D73)
 *   POST {action:'extras_admin', fecha, cc, horas, tipo}
 *                                             -> upsert por fecha en EXTRAS_ADMIN (deriva proyecto del CC)
 *   POST {action:'extras_admin_delete', fecha} -> elimina la fila del día
 *
 * Reglas técnicas heredadas (obligatorias, ver /docs/02_REGISTRO_DECISIONES.md):
 *   - Fechas SIEMPRE por duck-typing (typeof v.getFullYear==='function'), nunca instanceof Date (D31).
 *   - POST con Content-Type text/plain y confirmación real del servidor (D30).
 *   - Capacidad de grilla: toda escritura en bloque pasa por ensureRows_ (D93). No pre-crear filas.
 *
 * Rendimiento (D99 → D102):
 *   - D99: una sola apertura del Spreadsheet por ejecución (`ss_`), memoria de lectura por petición
 *     (`_memoHoja`), CacheService 6 h para las 10 hojas casi estáticas (NUNCA ASISTENCIA /
 *     NOTAS_ASISTENCIA / EXTRAS_ADMIN) y campo `_ms` en toda respuesta.
 *   - D102: LECTURA EN DOS PASOS de `ASISTENCIA` — los endpoints acotados a una fecha o a un rango
 *     escanean solo la columna `fecha` y traen únicamente los bloques de filas de ese día
 *     (`leerFilasPorFecha_`); los dos cruces que necesitan todo el histórico se acotan por COLUMNAS
 *     (`leerColumnasDeHoja_`). Campo `_celdas` en toda respuesta. Ver el bloque grande de comentarios
 *     sobre `leerFilasPorFecha_` antes de tocar nada de esto.
 *
 * D166 — endurecimiento (ver el bloque «ENDURECIMIENTO DEL BACKEND» más abajo): hoja LOG (una fila por
 *   petición en la puerta de D109), rate limit por usuario+action con CacheService (60/min), respuesta
 *   genérica ante token inválido (salvo AUTH_SECRETO ausente, D109), validación de tipos/rangos/
 *   longitudes/fechas por action de escritura ({ok:false, error:'payload', campo}) y respaldo diario a
 *   Drive (respaldoDiario / instalarTriggerRespaldo). Contrato de endpoints y payloads INTACTO.
 */

// El usuario reemplaza este placeholder si crea un Sheet nuevo; ya viene fijado al Sheet entregado.
const SHEET_ID = '1KrhzaIg3BSspyi0oH0gHkAJnSRXaOIdel_pKaMVHX9w';

// D93 — tamaño mínimo de expansión de la grilla (filas). Una hoja de Sheets nace con 1.000 filas;
// cuando se agotan, un setValues en bloque falla entero ("The coordinates of the range are outside
// the dimensions of the sheet") y el usuario tenía que añadir filas a mano para que la información
// volviera a cargar. Se crece en bloques de este tamaño para no fragmentar la grilla. Es el ÚNICO
// número a cambiar si se quiere otro tamaño de bloque.
const BLOQUE_FILAS = 1000;

// D72: `fecha_ingreso` (col 9) hace el roster "date-aware": el alta puede ser retroactiva ("desde
// cierto día") y el retiro lleva su propia fecha. Celda vacía en filas viejas = sin límite inferior
// (siempre estuvo activa) → retrocompatible con lo ya guardado.
const PERSONAL_HEADERS      = ['cedula','codigo','nombre','cargo','cuadrilla','responsable','estado','fecha_retiro','fecha_ingreso'];
// D72: `area` (col 3) etiqueta cada cuadrilla como tierras/odt/odl para que residente_odt/residente_odl
// vean SOLO su área en el resumen. Celda vacía en filas viejas = 'tierras' (retrocompatible).
// D84: `estado` (col 4) saca una cuadrilla de circulación SIN borrar su fila (borrarla dejaría huérfano
// el histórico de ASISTENCIA, que la referencia por nombre). `activa`/`inactiva`; VACÍO = activa
// (retrocompatible). El filtro aplica al ROSTER ESPERADO (roster, faltantes, estado, export, selectores
// y gestión), NO a lo ya reportado: las filas de fechas anteriores de una cuadrilla inactiva siguen
// saliendo en el resumen y el export.
const CUADRILLAS_HEADERS    = ['cuadrilla','responsables','area','estado'];
// D72: `turno` (col 17) guarda el turno con que se reportó cada persona, para que el export conozca la
// jornada programada y calcule las extras (Opción A: extra = lo trabajado más allá de la salida del
// turno). Vacío en filas viejas = turno diurno estándar (el export arma la jornada por defecto del día).
const ASISTENCIA_HEADERS    = ['id_registro','timestamp','fecha','reporta','cuadrilla','codigo','cedula','nombre',
  'cargo','cc','proyecto','hora_entrada','hora_salida','presente','motivo_ausencia','observacion','turno'];
const CONFIG_HEADERS        = ['clave','valor'];
const FESTIVOS_HEADERS      = ['fecha'];
const CAT_TRABAJADORES_HEADERS = ['codigo','string_navision'];
// Una sola columna: cada CC va COMPLETO en su celda ("3701.06.67| Box abovedados...", verbatim de
// Navision). El proyecto NO se pide aparte: se deriva del propio prefijo del string (proyectoFromCC).
const CAT_CC_HEADERS        = ['string_cc'];
// CAT_MOTIVOS = catálogo COMPLETO de motivos de ausencia (verbatim de Navision). Lo ve completo quien
// accede al resumen (residentes/jeisson/admin) para poder registrar un motivo especial (D78).
const CAT_MOTIVOS_HEADERS   = ['string_motivo'];
// MOTIVOS_USADOS (D78): subconjunto de CAT_MOTIVOS que se usa a diario — misma filosofía que CC_USADOS.
// Es lo que ve el RESPONSABLE de cuadrilla en asistencia.html (los demás motivos solo confunden).
// Si la hoja está vacía se cae al catálogo completo (retrocompatible: instalaciones sin llenarla
// siguen viendo lo mismo que hoy).
const MOTIVOS_USADOS_HEADERS = ['string_motivo'];
// CC_USADOS: subconjunto de CAT_CC que se usa a diario (≈5-20). El usuario lo mantiene (pega los CC
// frecuentes, mismo string exacto que CAT_CC). El formulario muestra estos por defecto y deja buscar
// el resto del catálogo completo. Si la hoja está vacía, se usa el catálogo completo como antes.
// D72: `area` (col 2) opcional para servir los CC frecuentes SOLO al área que los usa (p. ej. todos
// los `06.*` de drenajes van a ODT y no ensucian el datalist de los capataces de tierra). Celda vacía
// = 'tierras' (retrocompatible con lo ya pegado). Al usuario "sin área" (residente general/admin) se
// le muestran todos.
const CC_USADOS_HEADERS     = ['string_cc','area'];
// D72: catálogo de TURNOS asignados (diurno T1 + nocturnos T2–T5). Cada fila = turno × tipo de día,
// con entrada/salida y el descanso (almuerzo/cena) a descontar. `cruza_medianoche`='SI' cuando la
// salida es del día siguiente (los nocturnos). Sirve para PRE-LLENAR la hora de entrada/salida del
// reporte (captura cruda, D69b) y como ESTÁNDAR de ordinarias del clasificador del export (D72e/D77:
// columnas C–G calculadas por turno; solo el mapeo H–N Dom/Fest c/s compensación sigue abierto).
const TURNOS_HEADERS        = ['turno','tipo_dia','entrada','salida','descanso_ini','descanso_fin','cruza_medianoche'];
// EXTRAS_ADMIN (D73): canal "solo extras" del admin — una fila por día (clave lógica = `fecha`, re-guardar
// pisa el día). El admin registra SUS horas extras de días puntuales; su jornada ordinaria se asume por
// fuera del sistema y no aparece en el `Parte` salvo los días con extra. Aislada del roster (PERSONAL/
// CUADRILLAS/ASISTENCIA): el admin NO está en el roster. `proyecto` se deriva del `cc` (proyectoFromCC).
const EXTRAS_ADMIN_HEADERS  = ['fecha','cc','proyecto','horas','tipo','timestamp','reporta'];
// D74: nota libre del día por cuadrilla (el capataz avisa novedades: alguien nuevo, una anomalía, etc.).
// Clave lógica = fecha+cuadrilla (re-enviar la asistencia pisa la nota, igual que las filas, D03). Aislada
// de ASISTENCIA; la ve el residente en el resumen. No va al Excel Navision.
const NOTAS_ASISTENCIA_HEADERS = ['fecha','cuadrilla','reporta','nota','timestamp'];

/* ---------- helpers genéricos (mismo patrón que Codigo.gs) ---------- */
/**
 * D99 (Fase 2, punto 4) — campo `_ms` = milisegundos de SERVIDOR en toda respuesta JSON.
 * Sirve para separar lo que tarda Apps Script de lo que tarda la red/el arranque del contenedor: el
 * frontend (`DEBUG_PERF` en `resumen-asistencia.html`) ya lo lee y muestra `servidor_ms` y `red_ms`
 * en su `console.table`. Si `_ms` sale bajo y el total alto, el problema NO está en este script.
 * `_t0` lo siembran `doGet`/`doPost`; sin él (llamada desde el editor) no se agrega el campo.
 */
var _t0 = null;
/**
 * D102 — campo `_celdas` = celdas de Sheet LEÍDAS en esta ejecución (escaneo de columna + bloques,
 * o la lectura completa si se cayó al fallback). Es el `_ms` del volumen: permite ver en campo si la
 * lectura acotada está entrando o no, sin adivinar, y es lo que disparará el umbral del backlog 4.11
 * cuando llegue. Lo suma `leerRango_`, único punto por el que pasa TODO `getValues` del archivo.
 * Una lectura servida por `CacheService` o por la memoria de ejecución suma 0: eso es lo correcto,
 * porque no tocó el Sheet.
 */
var _celdas = 0;
function json(o){
  if(_t0 !== null && o && typeof o === 'object' && o._ms === undefined) o._ms = Date.now() - _t0;
  if(_t0 !== null && o && typeof o === 'object' && o._celdas === undefined) o._celdas = _celdas;
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
/**
 * D102 — ÚNICO punto de lectura del Sheet en todo el archivo. Todo `getValues` pasa por aquí para que
 * el contador de `_celdas` no se pueda quedar desfasado al agregar una lectura nueva.
 */
function leerRango_(sh, fila, col, nFilas, nCols){
  _celdas += nFilas * nCols;
  return sh.getRange(fila, col, nFilas, nCols).getValues();
}
function fdate(v){
  if(v === null || v === undefined || v === '') return '';
  if(typeof v === 'object' && typeof v.getFullYear === 'function')
    return v.getFullYear()+'-'+('0'+(v.getMonth()+1)).slice(-2)+'-'+('0'+v.getDate()).slice(-2);
  return String(v).slice(0,10);
}
// Hora cruda HH:MM, tolerante a que Sheets la guarde como objeto Date (duck-typing, nunca instanceof Date).
function ftime(v){
  if(v === null || v === undefined || v === '') return '';
  if(typeof v === 'object' && typeof v.getHours === 'function')
    return ('0'+v.getHours()).slice(-2)+':'+('0'+v.getMinutes()).slice(-2);
  // Texto: normaliza a HH:MM con CERO a la izquierda. Una celda "7:00" (sin cero) rompía el
  // <input type=time> del formulario y la hora AM salía en blanco (D72). "15:30" ya venía bien.
  var s=String(v).trim(), m=s.match(/(\d{1,2}):(\d{2})/);
  if(m) return ('0'+m[1]).slice(-2)+':'+m[2];
  return s.slice(0,5);
}
/* ============ D109 — AUTENTICACIÓN POR TOKEN FIRMADO (backlog 2.25) ============
 *
 * EL AGUJERO QUE CIERRA. Hasta D108 el rol vivía en el navegador y el backend se creía la identidad
 * que le mandaba el cliente (`e.parameter.usuario`, `body.usuario`). Dos consecuencias, las dos
 * comprobadas sobre este mismo código: cualquiera podía escribir `rol: admin` en el almacenamiento de
 * su navegador y entrar al menú; y, peor, la URL del Apps Script está en el código de 13 pantallas, así
 * que se podía llamar a los endpoints desde una terminal diciendo «soy la residente» — sin contraseña.
 * Los cerrojos de área (D69h/D101) eran decorativos frente a eso: el área se derivaba del usuario que
 * el propio cliente declaraba. D108 sacó las claves del archivo público, pero NO arregló nada de esto.
 *
 * CÓMO SE CIERRA. Al entrar, el backend emite un TOKEN que lleva dentro `usuario·rol·áreas` y va
 * FIRMADO con HMAC-SHA256 usando un secreto que vive en las Propiedades del Script — ni en la hoja, ni
 * en el repositorio, ni en el navegador. Cada petición lo trae; cada endpoint verifica la firma y saca
 * la identidad DEL TOKEN, ignorando lo que diga el cliente. Sin el secreto no se puede fabricar ni
 * alterar un token: cambiarle un byte al rol invalida la firma.
 *
 * POR QUÉ NO CADUCA POR TIEMPO — esto es lo que lo hace compatible con el modo sin conexión (D82).
 * Un reporte capturado el viernes en zona muerta puede pasar el fin de semana en la cola del teléfono
 * y subirse el lunes. Con un token «válido 24 h» ese reporte sería rechazado y, como la cola solo
 * suelta lo que el servidor confirma, se quedaría atascado para siempre reintentando. Así que el token
 * no vence por reloj: vence por VERSIÓN.
 *   · `AUTH_V` (Propiedades del Script) — subirlo invalida TODOS los tokens de golpe. Es el botón de
 *     «sacar a todo el mundo» (teléfono perdido). Hay que subirlo en LOS DOS proyectos.
 *   · `estado` en la hoja `USUARIOS` (D108) — ponerlo distinto de `activo` deja fuera a UNA persona.
 *     La hoja `USUARIOS` vive en el Sheet de OBRA, así que aquí ese cerrojo no se comprueba (D69: módulos aislados):
 *     para dejar fuera a alguien de ESTE módulo de inmediato hay que subir `AUTH_V` también aquí.
 *
 * CONSECUENCIA QUE HAY QUE SABER: si sacas a alguien que tiene reportes pendientes en su teléfono,
 * esos reportes ya no suben. Antes de dar de baja a alguien, mirar que su contador esté en cero.
 *
 * `AUTH_ESTRICTO` es la válvula: en `false` se aceptan peticiones sin token válido y solo se anotan en
 * el registro (útil para ver qué teléfono sigue con la app vieja). Se despliega en `true`.
 */
const AUTH_ESTRICTO = true;

/* ¿Este proyecto EMITE tokens o solo los verifica? Solo hay UN emisor: el de obra, que es donde vive
 * la hoja `USUARIOS` y donde ocurre el login. Importa porque las Propiedades del Script son POR
 * PROYECTO, no globales: si el verificador se autogenerara su propio secreto, firmaría distinto que
 * el emisor y rechazaría TODOS los tokens buenos. Por eso el emisor lo crea y el verificador exige
 * que se lo hayan copiado — y si no está, lo dice con todas las letras en vez de inventarse uno. */
const AUTH_EMISOR = false;   // este proyecto SOLO verifica: el login vive en el de obra

function _authProps_(){ return PropertiesService.getScriptProperties(); }
/* El secreto NUNCA sale del servidor por la API. Para rotarlo: borrar la propiedad `AUTH_SECRETO` en
 * los DOS proyectos y volver a copiarla; todos los tokens dejan de valer y la gente entra otra vez. */
function authSecreto_(){
  const p=_authProps_(); let s=p.getProperty('AUTH_SECRETO');
  if(!s){
    if(!AUTH_EMISOR) return '';                       // verificador sin secreto: NO se inventa uno
    s=Utilities.getUuid()+'-'+Utilities.getUuid(); p.setProperty('AUTH_SECRETO', s);
  }
  return s;
}
/* Se ejecuta A MANO desde el editor del proyecto EMISOR (obra) para leer el secreto y copiarlo al de
 * asistencias con `fijarSecretoAuth`. Es el único momento en que el secreto se mira. */
function mostrarSecretoAuth(){
  const s=authSecreto_();
  Logger.log('AUTH_SECRETO = ' + s);
  Logger.log('Cópialo y ejecuta fijarSecretoAuth("'+s+'") en el proyecto de Asistencias.');
  return s;
}
/* Fija el secreto a mano (se usa en el proyecto VERIFICADOR). También sirve aquí para rotarlo. */
function fijarSecretoAuth(valor){
  const v=String(valor||'').trim();
  if(v.length<20) throw new Error('El secreto llegó vacío o demasiado corto. Cópialo de mostrarSecretoAuth() en el proyecto de obra.');
  _authProps_().setProperty('AUTH_SECRETO', v);
  return 'AUTH_SECRETO fijado. Los tokens emitidos por el otro proyecto ya se validan aquí.';
}
function authVersion_(){ return String(_authProps_().getProperty('AUTH_V') || '1'); }
function _b64url_(bytes){ return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/,''); }
function _firmar_(txt){
  return _b64url_(Utilities.computeHmacSha256Signature(txt, authSecreto_(), Utilities.Charset.UTF_8));
}
function emitirToken_(usuario, rol, areas){
  const carga={ u:String(usuario||''), r:String(rol||''), a:areas||[], v:authVersion_(), t:Date.now() };
  const p=_b64url_(Utilities.newBlob(JSON.stringify(carga)).getBytes());
  return p+'.'+_firmar_(p);
}
/* Verifica FIRMA primero y solo después interpreta el contenido: nunca se parsea algo no firmado. */
function verificarToken_(tok){
  const s=String(tok||''), i=s.indexOf('.');
  if(i<1) return {ok:false, error:'Falta el token de sesión. Vuelve a entrar.'};
  const carga=s.slice(0,i), firma=s.slice(i+1);
  if(_firmar_(carga)!==firma) return {ok:false, error:'Sesión no válida. Vuelve a entrar.'};
  let o;
  try{ o=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(carga)).getDataAsString()); }
  catch(err){ return {ok:false, error:'Sesión ilegible. Vuelve a entrar.'}; }
  if(String(o.v)!==authVersion_()) return {ok:false, error:'Sesión cerrada por el administrador. Vuelve a entrar con señal.'};
  return {ok:true, usuario:String(o.u||'').trim().toLowerCase(), rol:String(o.r||''), areas:Array.isArray(o.a)?o.a:[]};
}
/* Punto ÚNICO de autenticación: lo llaman doGet y doPost, nadie más. Devuelve la sesión REAL, la que
 * sale del token; el resto del archivo puede seguir usando `usuario` como siempre porque los puntos de
 * entrada lo sobrescriben con este valor. */
function sesion_(e, body){
  // Diagnóstico explícito: sin secreto configurado NADA validaría, y el error genérico («vuelve a
  // entrar») mandaría a todo el mundo a dar vueltas al login sin que nadie entienda qué pasa.
  if(!authSecreto_()) return {ok:false, sinSecreto:true, error:'El servidor no tiene configurado AUTH_SECRETO. '
    + 'Ejecuta mostrarSecretoAuth() en el Apps Script de obra y fijarSecretoAuth("…") en este.'};
  const tok = (body && body.token) || (e && e.parameter && e.parameter.token) || '';
  const r = tok ? verificarToken_(tok) : {ok:false, error:'Falta el token de sesión. Vuelve a entrar.'};
  if(r.ok) return r;
  if(!AUTH_ESTRICTO){
    Logger.log('AUTH tolerante: petición aceptada SIN token válido ('+r.error+') — action='
      + ((body && body.action) || (e && e.parameter && e.parameter.action) || '?'));
    return {ok:true, usuario:'', rol:'', tolerado:true};
  }
  return r;
}


/* ============ D166 — ENDURECIMIENTO DEL BACKEND: LOG · RATE LIMIT · RESPUESTA GENÉRICA · VALIDACIÓN · RESPALDO ============
 *
 * Bloque GEMELO en los dos Apps Script (obra y asistencias; el Parte, que vive en el proyecto de obra,
 * reutiliza estas mismas funciones). CONTRATO INTACTO: ningún endpoint cambia de nombre ni de payload y
 * ninguna respuesta que hoy es `ok:true` deja de serlo por un payload legítimo — la cola offline (D82)
 * reenvía payloads de hace días y tienen que seguir entrando. Lo único nuevo son rechazos ADICIONALES
 * (`error:'rate_limit'` y `error:'payload'`), y con `ok:false` la cola conserva el ítem en el teléfono.
 *
 * 1) LOG — hoja `LOG` (la crea `setupLog()` o la primera petición). En la puerta única de D109 se
 *    anota fecha-hora del servidor, usuario, rol, action, resultado (ok/rechazado/error + motivo) y ms.
 *    UNA sola `appendRow` por petición, al FINAL de la ejecución (así `ms` es el tiempo total y el motivo
 *    puede venir de la validación de payload). Envuelta en try/catch: si LOG falla, la petición NO falla.
 *    El `usuario` de un `login` es el que el cliente DICE ser (no está autenticado todavía): sirve para
 *    ver intentos, no para atribuir. `tablero` (lectura pública, D159) no pasa por la puerta y no se anota.
 *    Un rechazo por rate limit se anota SOLO la primera vez en cada ventana: anotar cada uno convertiría
 *    la propia protección en la forma de inflar la hoja.
 * 2) RATE LIMIT — CacheService por `usuario+action` (ventana fija de 60 s): 60 peticiones/min; `login`
 *    10/min por usuario. Al excederlo: `{ok:false, error:'rate_limit'}` SIN tocar el Sheet. Si la caché
 *    no está disponible se deja pasar (fail-open): un fallo de Google no puede dejar la obra sin reportar.
 * 3) RESPUESTA GENÉRICA — todo token inválido contesta `{ok:false, auth:false, error:AUTH_MSG_GENERICO}`;
 *    la causa exacta (falta, firma mala, ilegible, versión) va al LOG. El cliente (`auth.js`) solo mira
 *    `auth:false`, nunca el texto. La ÚNICA excepción explícita sigue siendo la del verificador sin
 *    `AUTH_SECRETO` (D109): sin ella nadie entendería por qué el módulo entero manda al login.
 * 4) VALIDACIÓN DE PAYLOAD — por action de escritura: tipos, rangos numéricos razonables, longitud
 *    máxima de textos, fecha válida y no futura. Rechazo: `{ok:false, error:'payload', campo:'…'}` (+
 *    `detalle` legible, campo ADICIONAL). Regla de retrocompatibilidad: se valida lo que VIENE; un campo
 *    ausente sigue tratándose como antes (cada función ya tiene sus valores por defecto). Las fechas de
 *    flota/personal (ingreso/retiro) admiten futuro acotado a propósito: «primer día que ya no estuvo»
 *    puede ser mañana (D138).
 * 5) RESPALDO — `respaldoDiario()` copia este Spreadsheet a Drive `Galca_respaldos/<obra>` con nombre
 *    `<prefijo>_<fecha ISO>` y borra las copias de este prefijo con más de RESPALDO_DIAS días (por la
 *    fecha del NOMBRE, no por la de creación). `instalarTriggerRespaldo()` crea el disparador diario de
 *    las 02:00 (America/Bogota, explícita en el trigger). También poda la hoja LOG a LOG_RETENCION_DIAS.
 */

/* ---------- 1) LOG ---------- */
const LOG_HOJA = 'LOG';
const LOG_HEADERS = ['fecha_hora','usuario','rol','action','resultado','motivo','ms'];
const LOG_RETENCION_DIAS = 30;      // filas de LOG más viejas que esto se podan en respaldoDiario()
const LOG_MAX_MOTIVO = 200;
var _log = null;                    // registro de la petición en curso; lo siembran doGet/doPost
function logIniciar_(action){ _log = { usuario:'', rol:'', action:String(action||''), resultado:'', motivo:'', silencio:false }; }
function logAction_(action){ if(_log) _log.action = String(action||''); }
function logIdentidad_(usuario, rol){ if(_log){ _log.usuario = String(usuario||''); _log.rol = String(rol||''); } }
function logSesion_(ses){ if(ses) logIdentidad_(ses.usuario, ses.rol); }
function logMarcar_(resultado, motivo){
  if(!_log) return;
  _log.resultado = String(resultado||'');
  if(motivo !== undefined) _log.motivo = String(motivo==null?'':motivo);
}
function logHoja_(){
  const ss=ss_(); let sh=ss.getSheetByName(LOG_HOJA);
  if(!sh){ sh=ss.insertSheet(LOG_HOJA); sh.appendRow(LOG_HEADERS); }
  return sh;
}
// ÚNICA escritura de LOG: una appendRow al final de la petición. Nunca lanza.
function logEscribir_(){
  const l=_log; _log=null;
  if(!l || l.silencio) return;
  try{
    const ms = (_t0 !== null) ? (Date.now() - _t0) : '';
    logHoja_().appendRow([ new Date(), l.usuario, l.rol, l.action, l.resultado || 'ok',
                           String(l.motivo||'').slice(0, LOG_MAX_MOTIVO), ms ]);
  }catch(err){ try{ Logger.log('LOG no escrito: '+err); }catch(e2){} }
}
/* Se ejecuta UNA VEZ desde el editor (o no: la primera petición crea la hoja igual). Idempotente. */
function setupLog(){
  const sh=getSheet(LOG_HOJA, LOG_HEADERS);
  Logger.log('Hoja LOG lista ('+Math.max(sh.getLastRow()-1,0)+' filas).');
  return 'ok';
}
// Poda las filas de LOG más viejas que `dias` (la hoja es cronológica: se borra el tramo inicial).
function podarLog_(dias){
  try{
    const sh=ss_().getSheetByName(LOG_HOJA); if(!sh) return 0;
    const last=sh.getLastRow(); if(last<2) return 0;
    const limite=Date.now() - (dias||LOG_RETENCION_DIAS)*86400000;
    const fechas=leerRango_(sh, 2, 1, last-1, 1);
    let n=0;
    while(n<fechas.length){
      const v=fechas[n][0];
      const t = (v && typeof v==='object' && typeof v.getTime==='function') ? v.getTime() : Date.parse(String(v||''));
      if(!(t<limite)) break;    // NaN o reciente: se para (nunca se borra lo que no se entiende)
      n++;
    }
    if(n>0) sh.deleteRows(2, n);
    return n;
  }catch(err){ Logger.log('podarLog_: '+err); return 0; }
}

/* ---------- 2) RATE LIMIT ---------- */
const RL_LIMITE       = 60;     // peticiones por usuario+action y minuto
const RL_LIMITE_LOGIN = 10;     // intentos de login por usuario y minuto
const RL_VENTANA_S    = 60;
/* Ventana FIJA (contador por minuto de reloj): barato, sin lecturas del Sheet, y suficiente para lo que
 * protege (un bucle roto o un script ajeno). Devuelve {ok, primero}: `primero` es true la PRIMERA vez que
 * se rechaza en la ventana (para anotar una sola fila en LOG). Si la caché falla, deja pasar. */
function rateLimit_(identidad, action, limite, ventanaS){
  try{
    if(typeof CacheService === 'undefined') return { ok:true };
    const cache=CacheService.getScriptCache(); if(!cache) return { ok:true };
    const v=ventanaS || RL_VENTANA_S;
    const clave='rl:'+String(identidad||'anon').toLowerCase().slice(0,60)+':'+String(action||'').toLowerCase().slice(0,40)
               +':'+Math.floor(Date.now()/(v*1000));
    const n=Number(cache.get(clave) || 0);
    cache.put(clave, String(n+1), Math.min(v*2, 21600));
    if(n >= limite) return { ok:false, primero:(n===limite) };
    return { ok:true };
  }catch(err){ return { ok:true }; }
}
function respuestaRateLimit_(rl){
  if(_log){ if(rl && rl.primero) logMarcar_('rechazado','rate_limit'); else _log.silencio=true; }
  return json({ ok:false, error:'rate_limit', detalle:'Demasiadas peticiones seguidas. Espera un minuto y vuelve a intentar.' });
}

/* ---------- 3) PUERTA ÚNICA (envuelve a sesion_ de D109) ---------- */
const AUTH_MSG_GENERICO = 'Sesión no válida. Vuelve a entrar.';
/* La llaman doGet/doPost (y el enrutador del Parte para sus operaciones con token). Verifica el token
 * con `sesion_`, anota la identidad en el LOG y aplica el rate limit por usuario+action.
 * Devuelve {ok:true, ses} o {ok:false, respuesta} (la respuesta ya lista para devolver). */
function puerta_(e, body, action){
  const ses=sesion_(e, body);
  if(!ses.ok){
    logMarcar_('rechazado', 'token: '+String(ses.error||''));
    const msg = ses.sinSecreto ? ses.error : AUTH_MSG_GENERICO;   // D109: única causa que se dice al cliente
    return { ok:false, respuesta: json({ ok:false, auth:false, error:msg }) };
  }
  logSesion_(ses);
  if(ses.tolerado) logMarcar_('ok', 'tolerado');
  const rl=rateLimit_(ses.usuario || 'anon', action, RL_LIMITE);
  if(!rl.ok) return { ok:false, respuesta: respuestaRateLimit_(rl) };
  return { ok:true, ses:ses };
}

/* ---------- 4) VALIDACIÓN DE PAYLOAD ---------- */
const VAL_TZ = 'America/Bogota';
const VAL_MAX_TEXTO       = 500;     // textos normales (nombres, códigos, CC, observaciones de línea)
const VAL_MAX_TEXTO_LARGO = 2000;    // notas libres / observación general
const VAL_MAX_FILAS       = 1000;    // filas por envío (un día entero cabe de sobra)
const VAL_MAX_HORAS       = 24;
const VAL_MAX_CANTIDAD    = 1000000; // largo / producción / m³ por línea
const VAL_DIAS_FUTURO_FLOTA = 366;   // ingreso/retiro programados (D138: «primer día que ya no estuvo»)
var _valHoy = null;
function valHoy_(){ if(!_valHoy) _valHoy = Utilities.formatDate(new Date(), VAL_TZ, 'yyyy-MM-dd'); return _valHoy; }
function valFechaMasDias_(iso, dias){
  const p=String(iso||'').split('-'); if(p.length<3) return '';
  const dt=new Date(Number(p[0]), Number(p[1])-1, Number(p[2])); dt.setDate(dt.getDate()+(dias||0));
  return dt.getFullYear()+'-'+('0'+(dt.getMonth()+1)).slice(-2)+'-'+('0'+dt.getDate()).slice(-2);
}
function rechazoPayload_(campo, detalle){
  logMarcar_('rechazado', 'payload:'+campo+(detalle ? (' '+detalle) : ''));
  return json({ ok:false, error:'payload', campo:String(campo||''), detalle:String(detalle||'') });
}
// Cada `val*_` devuelve '' si el valor es aceptable o el MOTIVO si no. Ausente/vacío = aceptable
// (la obligatoriedad la decide cada función, como hasta ahora).
function valTexto_(v, max){
  if(v===null || v===undefined) return '';
  if(typeof v==='object') return 'debe ser texto';
  const s=String(v); const m=max||VAL_MAX_TEXTO;
  if(s.length>m) return 'supera '+m+' caracteres';
  if(/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(s)) return 'contiene caracteres de control';
  return '';
}
function valNum_(v, min, max){
  if(v===null || v===undefined || v==='') return '';
  if(typeof v==='boolean' || typeof v==='object') return 'debe ser un número';
  const n = (typeof v==='number') ? v : Number(String(v).trim().replace(/\s/g,'').replace(',','.'));
  if(!isFinite(n)) return 'no es un número';
  if(n<min || n>max) return 'fuera de rango ('+min+' a '+max+')';
  return '';
}
function valEntero_(v, min, max){ const m=valNum_(v,min,max); if(m) return m; if(v===null||v===undefined||v==='') return ''; return Number(v)%1===0 ? '' : 'debe ser entero'; }
function valBool_(v){
  if(v===null || v===undefined || v==='') return '';
  if(typeof v==='boolean') return '';
  const s=String(v).trim().toLowerCase();
  return (['si','sí','no','true','false','1','0'].indexOf(s)>=0) ? '' : 'debe ser Sí/No';
}
function valLista_(v, opciones){
  if(v===null || v===undefined || v==='') return '';
  return (opciones.indexOf(String(v).trim().toLowerCase())>=0) ? '' : 'valor no admitido';
}
// Fecha válida (yyyy-mm-dd o Date, por fdateValida_) y no futura (con `diasFuturo` días de margen).
function valFecha_(v, diasFuturo){
  if(v===null || v===undefined || v==='') return '';
  const f=fdateValida_(v); if(!f) return 'fecha inválida';
  if(f > valFechaMasDias_(valHoy_(), diasFuturo||0)) return 'fecha futura';
  if(f < '2020-01-01') return 'fecha anterior a 2020';
  return '';
}
function valHora_(v){
  if(v===null || v===undefined || v==='') return '';
  if(typeof v==='object' && typeof v.getHours==='function') return '';   // Date (duck-typing)
  const s=String(v).trim(); if(s.length>12) return 'hora demasiado larga';
  return /^\d{1,2}[:.]\d{2}/.test(s) ? '' : 'hora no válida (HH:MM)';
}
function valArray_(v, max){
  if(v===null || v===undefined) return '';
  if(!Array.isArray(v)) return 'debe ser una lista';
  if(v.length>(max||VAL_MAX_FILAS)) return 'más de '+(max||VAL_MAX_FILAS)+' elementos';
  return '';
}
/* Aplica un ESQUEMA {campo: regla} a un objeto. Regla: 't' texto(max) · 'tl' texto largo · 'n' número
 * [min,max] · 'e' entero · 'b' booleano · 'f' fecha (dias futuro) · 'h' hora · 'l' lista (opciones) ·
 * 'a' array (max). Devuelve {campo, motivo} del PRIMER fallo o null. `prefijo` compone el nombre del
 * campo en la respuesta (`cantidades[3].largo`). */
function valEsquema_(obj, esquema, prefijo){
  if(obj===null || obj===undefined) return null;
  if(typeof obj!=='object' || Array.isArray(obj)) return { campo:prefijo||'payload', motivo:'debe ser un objeto' };
  const campos=Object.keys(esquema);
  for(let i=0;i<campos.length;i++){
    const k=campos[i], r=esquema[k], v=obj[k]; let m='';
    switch(r[0]){
      case 't':  m=valTexto_(v, r[1]||VAL_MAX_TEXTO); break;
      case 'tl': m=valTexto_(v, VAL_MAX_TEXTO_LARGO); break;
      case 'n':  m=valNum_(v, r[1], r[2]); break;
      case 'e':  m=valEntero_(v, r[1], r[2]); break;
      case 'b':  m=valBool_(v); break;
      case 'f':  m=valFecha_(v, r[1]||0); break;
      case 'h':  m=valHora_(v); break;
      case 'l':  m=valLista_(v, r[1]); break;
      case 'a':  m=valArray_(v, r[1]); break;
    }
    if(m) return { campo:(prefijo?prefijo+'.':'')+k, motivo:m };
  }
  return null;
}
// Lista de objetos con el mismo esquema: `nombre[i].campo`.
function valListaDe_(arr, esquema, nombre, max){
  const m=valArray_(arr, max); if(m) return { campo:nombre, motivo:m };
  if(!arr) return null;
  for(let i=0;i<arr.length;i++){
    if(arr[i]===null || arr[i]===undefined) continue;
    const f=valEsquema_(arr[i], esquema, nombre+'['+i+']'); if(f) return f;
  }
  return null;
}

/* ---------- 5) RESPALDO DIARIO ---------- */
const RESPALDO_CARPETA  = 'Galca_respaldos';
const RESPALDO_OBRA     = 'TM2_Sur';                 // subcarpeta <obra>
const RESPALDO_PREFIJO  = 'Asistencias_TM2';    // nombre de la copia: <prefijo>_<yyyy-MM-dd>
const RESPALDO_DIAS     = 30;
const RESPALDO_HORA     = 2;                         // 02:00 (zona horaria del proyecto)
function respaldoCarpeta_(){
  const raiz=DriveApp.getRootFolder();
  const buscar=function(padre, nombre){ const it=padre.getFoldersByName(nombre); return it.hasNext() ? it.next() : padre.createFolder(nombre); };
  return buscar(buscar(raiz, RESPALDO_CARPETA), RESPALDO_OBRA);
}
// Copia UN spreadsheet a la carpeta y poda las copias viejas de ese prefijo. Devuelve el nombre creado.
function respaldarSpreadsheet_(id, prefijo, carpeta){
  const hoy=valHoy_(), nombre=prefijo+'_'+hoy;
  const ya=carpeta.getFilesByName(nombre);
  if(ya.hasNext()){ Logger.log('Respaldo ya existente hoy: '+nombre); }
  else { DriveApp.getFileById(id).makeCopy(nombre, carpeta); Logger.log('Respaldo creado: '+nombre); }
  const limite=valFechaMasDias_(hoy, -RESPALDO_DIAS);
  const re=new RegExp('^'+prefijo.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'_(\\d{4}-\\d{2}-\\d{2})$');
  const archivos=carpeta.getFiles(); let borradas=0;
  while(archivos.hasNext()){
    const f=archivos.next(), m=String(f.getName()).match(re);
    if(m && m[1] < limite){ f.setTrashed(true); borradas++; }
  }
  if(borradas) Logger.log('Respaldos de más de '+RESPALDO_DIAS+' días enviados a la papelera: '+borradas);
  return nombre;
}
/* Se ejecuta a diario por el trigger (o a mano desde el editor). Una copia por día: si ya existe la de
 * hoy, no duplica. La primera ejecución pide autorizar Drive (alcance nuevo del proyecto). */
function respaldoDiario(){
  const carpeta=respaldoCarpeta_();
  const hechos=[ respaldarSpreadsheet_(SHEET_ID, RESPALDO_PREFIJO, carpeta) ];
  // Sheets adicionales de este proyecto (p. ej. el del Parte si algún día se separa del de obra).
  const extra = (typeof respaldoIdsExtra_==='function') ? respaldoIdsExtra_() : [];
  extra.forEach(function(x){ if(x && x.id && x.id!==SHEET_ID) hechos.push(respaldarSpreadsheet_(x.id, x.prefijo||(RESPALDO_PREFIJO+'_extra'), carpeta)); });
  const podadas=podarLog_(LOG_RETENCION_DIAS);
  Logger.log('respaldoDiario: '+hechos.join(', ')+' · LOG podado: '+podadas+' filas');
  return hechos;
}
/* Se ejecuta UNA VEZ desde el editor: deja un solo trigger diario de respaldoDiario a las 02:00. */
function instalarTriggerRespaldo(){
  ScriptApp.getProjectTriggers().forEach(function(t){ if(t.getHandlerFunction()==='respaldoDiario') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('respaldoDiario').timeBased().everyDays(1).atHour(RESPALDO_HORA).inTimezone(VAL_TZ).create();
  Logger.log('Trigger diario de respaldoDiario instalado (~'+RESPALDO_HORA+':00 '+VAL_TZ+').');
  return 'ok';
}
function quitarTriggerRespaldo(){
  let n=0; ScriptApp.getProjectTriggers().forEach(function(t){ if(t.getHandlerFunction()==='respaldoDiario'){ ScriptApp.deleteTrigger(t); n++; } });
  Logger.log('Triggers de respaldoDiario eliminados: '+n); return n;
}

/* ---------- 4b) ESQUEMAS DE PAYLOAD — módulo de ASISTENCIAS (CodigoAsistencias.gs) ----------
 * Se valida ANTES de tomar el cerrojo de D125 y de despachar la action, con la sesión ya verificada.
 * Solo lo que viene; lo ausente lo resuelve cada función con sus defaults de siempre. Los mensajes de
 * negocio existentes (ERROR_FECHA, cuadrilla de otra área, topes de extras desde CONFIG, «no
 * autorizado»…) se conservan tal cual: esto es la red de TIPOS/RANGOS/LONGITUDES que faltaba debajo. */
// `cc` NO lleva tope de 100: es el string COMPLETO del catálogo `CAT_CC.string_cc` (código +
// descripción, p. ej. "3702.02.11| Transporte materiales provenientes de excavación… (>1.000 m)" =
// 107 chars). Con el tope de 100 de D166, los CC largos legítimos rebotaban con error:'payload' y la
// cola offline (D82) reintentaba en vano. Queda en el cubo de texto normal (VAL_MAX_TEXTO=500), que
// es donde el comentario de esa constante ya ubicaba a los CC.
const VAL_ASIS_FILA = {
  codigo:['t',50], cedula:['t',50], nombre:['t',200], cargo:['t',100], cuadrilla:['t',100], cc:['t'], proyecto:['t',20],
  hora_entrada:['h'], hora_salida:['h'], presente:['t',10], motivo_ausencia:['t',200], observacion:['tl'], turno:['t',50]
};
const VAL_ASIS_REPORTE    = { fecha:['f',0], cuadrilla:['t',100], reporta:['t',100], nota:['tl'], filas:['a'] };
const VAL_ASIS_INDIVIDUAL = { fecha:['f',0], filas:['a'] };
const VAL_ASIS_PERSONAL   = { op:['l',['alta','retiro','mover','reactivar']], codigo:['t',50], cedula:['t',50], nombre:['t',200],
                              cargo:['t',100], cuadrilla:['t',100], fecha_ingreso:['f',VAL_DIAS_FUTURO_FLOTA],
                              fecha_retiro:['f',VAL_DIAS_FUTURO_FLOTA], _row:['e',1,10000000] };
const VAL_ASIS_EXTRAS     = { fecha:['f',0], cc:['t'], horas:['n',0,VAL_MAX_HORAS], tipo:['l',['diurna','nocturna','domfest']] };
const VAL_ASIS_EXTRAS_DEL = { fecha:['f',0] };

// Devuelve la RESPUESTA de rechazo (lista para `return`) o null si el payload pasa.
function validarPayloadAsistencias_(body){
  const a=String(body.action||'');
  let f=null;
  if(a==='reporte_asistencia')         f = valEsquema_(body, VAL_ASIS_REPORTE, '')    || valListaDe_(body.filas, VAL_ASIS_FILA, 'filas');
  else if(a==='asistencia_individual') f = valEsquema_(body, VAL_ASIS_INDIVIDUAL, '') || valListaDe_(body.filas, VAL_ASIS_FILA, 'filas');
  else if(a==='personal')              f = valEsquema_(body, VAL_ASIS_PERSONAL, '');
  else if(a==='extras_admin')          f = valEsquema_(body, VAL_ASIS_EXTRAS, '');
  else if(a==='extras_admin_delete')   f = valEsquema_(body, VAL_ASIS_EXTRAS_DEL, '');
  return f ? rechazoPayload_(f.campo, f.motivo) : null;
}

/* ============ D106 — PORTERO DE FECHAS (incidente "reportes sin fecha", jul-2026) ============
 *
 * EL PROBLEMA QUE ARREGLA. `fdate` NORMALIZA pero no VALIDA: con `''`/`null` devuelve `''` y con
 * basura devuelve los 10 primeros caracteres tal cual (`'15/07/2026'`, `'undefined'`). Las dos rutas
 * que escriben ASISTENCIA (`guardarAsistencia`, `guardarIndividual`) tomaban ese resultado y lo
 * escribían en la columna `fecha` sin preguntar nada. Resultado observado dos veces en producción:
 * el bloque completo de una cuadrilla quedaba en la hoja **con todos sus datos y la columna C vacía**.
 *
 * POR QUÉ ERA GRAVE Y NO SOLO FEO. Una fila sin fecha:
 *   1. es INVISIBLE para todo el módulo — resumen, export del Parte y ausencias filtran por fecha,
 *      así que la cuadrilla aparece como "sin reportar" y su gente no sale en el Parte de Navision;
 *   2. se BORRA sola en el siguiente envío con fecha vacía de la misma cuadrilla: el upsert de D03
 *      quita "todo lo que sea fecha+cuadrilla", y con fecha `''` eso son justo las filas huérfanas
 *      del intento anterior. Ahí es donde el histórico se perdía de verdad;
 *   3. se REALIMENTA desde el resumen: `?action=asistencia&fecha=` (vacía) devolvía exactamente las
 *      filas huérfanas, y "Completar faltantes" las volvía a guardar con la fecha vacía.
 *
 * LA REGLA. Toda fecha que entra por la API pasa por aquí y solo se acepta `yyyy-MM-dd` con un día
 * que exista de verdad (rechaza `2026-02-31` y `2026-13-01`). Duck-typing intacto: primero `fdate`,
 * nunca `instanceof Date` (D31). Escribir mal es peor que no escribir: si la fecha no es válida, la
 * escritura se RECHAZA con un mensaje que dice qué hacer. Para la cola offline (D82) eso es lo
 * correcto: sin `ok:true` el ítem NO sale de la cola, así que el reporte no se pierde — se queda en
 * el teléfono hasta que se reenvíe con una fecha buena.
 */
function fdateValida_(v){
  const s=fdate(v);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const p=s.split('-'), y=Number(p[0]), m=Number(p[1]), d=Number(p[2]);
  const dt=new Date(y, m-1, d);   // aritmética local (Bogotá no tiene DST), mismo patrón que diasDelRango
  return (dt.getFullYear()===y && dt.getMonth()===m-1 && dt.getDate()===d) ? s : '';
}
const ERROR_FECHA = 'La fecha del reporte llegó vacía o con un formato que no se entiende. '
  + 'Vuelve a elegir el día en el campo "Fecha" y envía otra vez. '
  + 'No se guardó nada a propósito: una asistencia sin fecha no aparece en el resumen ni en el Parte.';
/**
 * D93 — Garantiza que la hoja tenga filas suficientes para escribir n filas a partir de la última
 * fila con datos. Crece en bloques (BLOQUE_FILAS) para no fragmentar la grilla. Idempotente y
 * barata: si hay espacio, no hace NADA (una sola lectura de getLastRow/getMaxRows, cero escrituras).
 * La inserción es SIEMPRE después de la última fila de la GRILLA (insertRowsAfter(getMaxRows())),
 * así que jamás desplaza ni pisa filas existentes.
 * NO pre-crea filas vacías "por si acaso": el techo del archivo es de 10 millones de celdas sumando
 * todas las hojas y las filas vacías consumen cupo y degradan el rendimiento.
 * Mismo helper, idéntico, en Codigo.gs (son dos proyectos de Apps Script separados, D69).
 */
function ensureRows_(sheet, n) {
  var necesarias = sheet.getLastRow() + (n || 1);
  var faltan = necesarias - sheet.getMaxRows();
  if (faltan > 0) {
    sheet.insertRowsAfter(sheet.getMaxRows(), Math.max(faltan, BLOQUE_FILAS));
  }
}

/**
 * D93 — Garantiza que la hoja tenga al menos nCols columnas (el mismo problema, en el otro eje).
 * Solo garantiza CAPACIDAD para los encabezados que el código ya define: no cambia el orden ni el
 * número de columnas de ninguna hoja.
 */
function ensureCols_(sheet, nCols) {
  var faltan = nCols - sheet.getMaxColumns();
  if (faltan > 0) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), faltan);
  }
}

/**
 * D99 (Fase 2, punto 1) — UNA sola apertura del Spreadsheet por ejecución.
 * Antes, `getSheet`/`readSheet` hacían `SpreadsheetApp.openById(SHEET_ID)` en CADA llamada: una
 * petición de `?action=asistencia` abría el archivo 14 veces. La referencia perezosa lo abre la
 * primera vez que hace falta y la reusa el resto de la ejecución.
 * OJO: es una variable de ejecución, NO un caché entre peticiones — Apps Script arranca un contexto
 * nuevo por petición, así que nunca sobrevive a la llamada.
 */
var _ss = null;
function ss_(){ if(!_ss) _ss = SpreadsheetApp.openById(SHEET_ID); return _ss; }

/**
 * D99 (Fase 2, punto 1) — Memoria de lectura DENTRO DE UNA MISMA EJECUCIÓN.
 * Los helpers (`areaDeCuadrillaMap`, `cuadrillasInactivasSet`, `getConfigMap`, `ccUsadosParaArea`…)
 * llaman a `readSheet` cada uno por su cuenta, así que la misma hoja se releía varias veces en la
 * misma petición: CUADRILLAS ×3 y CONFIG ×2 en `asistenciaDia`, y **ASISTENCIA entera ×2** en
 * `exportDia` (punto 3). Con esta memoria, la segunda lectura de una hoja sale gratis.
 *
 * NO es `CacheService`: vive solo lo que dura la petición, así que **no puede devolver datos viejos
 * a otra llamada** — el riesgo de invalidación de la Fase 2 punto 5 no aplica aquí. Aun así, todo
 * punto de escritura invalida su hoja (`invalidarHoja_`) por si en el futuro alguien lee después de
 * escribir en el mismo `doPost`.
 * Los llamadores nunca mutan el arreglo devuelto (usan filter/map/find; `roster` ordena la COPIA que
 * devuelve su `filter`), verificado antes de introducir la memoria.
 */
var _memoHoja = {};

/**
 * D102 — memoria de las lecturas ACOTADAS, SEPARADA de `_memoHoja`.
 *
 * ⚠️ TODO / ADVERTENCIA PARA QUIEN VENGA DESPUÉS ⚠️
 * Una lectura acotada (por fecha o por columnas) NO puede poblar `_memoHoja[hoja]`: ahí vive la hoja
 * COMPLETA. Si se guardaran las filas de un solo día bajo la clave 'ASISTENCIA', cualquier función
 * que después pidiera la hoja entera en el mismo `doPost`/`doGet` recibiría un subconjunto creyendo
 * que es todo — y no fallaría: devolvería datos incompletos en silencio (un export sin la mitad de la
 * gente, un `proyectoDefecto` calculado sobre un día). Por eso van en un diccionario aparte, con clave
 * `hoja + '|' + tipo + '|' + …`, y `invalidarHoja_` limpia LOS DOS.
 * Si algún día añades otra variante de lectura parcial, dale su propia clave con el mismo prefijo de
 * hoja; NO la metas en `_memoHoja`.
 */
var _memoRango = {};
function invalidarHoja_(nombre){
  delete _memoHoja[nombre];
  const pref = nombre + '|';                                   // todas las variantes acotadas de esta hoja
  Object.keys(_memoRango).forEach(function(k){ if(k.indexOf(pref) === 0) delete _memoRango[k]; });
  cacheBorrar_(nombre);
}

/* ================= D99 (Fase 2, punto 5) — CacheService para lo casi estático =================
 * Medido en campo tras el redeploy de los puntos 1–4: `_ms` de servidor **5.200–5.456 ms** de un
 * total de ~7.000 (el pintado del cliente son 2 ms). Con 11 lecturas de hoja por petición, el coste
 * está en el ida-y-vuelta FIJO de cada `getValues`, no en el volumen (<2.000 filas). Cachear las
 * hojas casi estáticas deja `asistenciaDia` en **3 lecturas**.
 *
 * NUNCA se cachean ASISTENCIA, NOTAS_ASISTENCIA ni EXTRAS_ADMIN: cambian durante el día y un caché
 * ahí produciría datos falsos en el resumen (regla explícita del planteamiento).
 *
 * INVALIDACIÓN — dos caminos, porque hay dos formas de cambiar estas hojas:
 *   1. Desde el script (alta/retiro/mover/reingreso de personal, encabezados): `invalidarHoja_` borra
 *      la memoria de la ejecución **y** las claves de caché. Es exacta e inmediata.
 *   2. **A mano en el Sheet** — así se mantienen CAT_CC, CAT_TRABAJADORES, CAT_MOTIVOS, CC_USADOS,
 *      CONFIG, TURNOS y la columna `estado`/`area` de CUADRILLAS (ver 04_ARQUITECTURA). Esas ediciones
 *      NO pasan por aquí, así que el caché las ignoraría hasta que expire. Por eso existe
 *      `?action=cache_reset` (botón "↻ Refrescar catálogos" en el resumen): quien pega un catálogo
 *      nuevo lo ve al instante, sin esperar el TTL ni redesplegar.
 * `CACHE_ON=false` desactiva todo de un tirón si algún día estorba.
 */
const CACHE_ON        = true;
const CACHE_TTL       = 21600;    // 6 h
const CACHE_PREFIJO   = 'asis_v1_';
const CACHE_TROZO     = 90000;    // < 100 KB: tope de CacheService por valor
const CACHE_TROZOS_MAX= 10;       // ~900 KB por hoja; más grande que eso no se cachea (se lee siempre)
// Hojas casi estáticas. Las tres vivas (ASISTENCIA, NOTAS_ASISTENCIA, EXTRAS_ADMIN) NO están y no deben estar.
const HOJAS_CACHEABLES = { CONFIG:1, FESTIVOS:1, TURNOS:1, CAT_CC:1, CAT_TRABAJADORES:1,
                           CAT_MOTIVOS:1, MOTIVOS_USADOS:1, CC_USADOS:1, CUADRILLAS:1, PERSONAL:1 };

/* Normalización ANTES de cachear — el punto delicado de todo esto.
 * Sheets devuelve las celdas de fecha y de hora como objetos Date. Si se cachearan tal cual, el JSON
 * las guardaría en ISO/UTC y al volver serían strings: `fdate` cortaría la fecha en UTC (un día menos
 * si la zona del script tiene desfase positivo) y `ftime` sacaría la hora en UTC (un 07:00 de Bogotá
 * volvería como "12:00"). Por eso cada hoja con fechas/horas se normaliza a su forma FINAL de string
 * con los mismos helpers de siempre (duck-typing, nunca `instanceof Date` — D31).
 * La normalización se aplica SIEMPRE, se cachee o no, para que el resultado sea idéntico con caché
 * frío y caliente. Es idempotente: `fdate('2026-01-01')` y `ftime('07:00')` se devuelven a sí mismos,
 * que es justo lo que ya hacía el código de más abajo con estas columnas.
 * Las hojas que no aparecen aquí son de puro texto y no necesitan nada. */
function esHora_(v){ return v && typeof v === 'object' && typeof v.getHours === 'function'; }
const NORMALIZA_HOJA = {
  CONFIG:   function(r){ if(esHora_(r.valor)) r.valor=ftime(r.valor); },   // solo si es Date: un valor de texto se truncaría
  FESTIVOS: function(r){ r.fecha=fdate(r.fecha); },
  TURNOS:   function(r){ r.entrada=ftime(r.entrada); r.salida=ftime(r.salida);
                         r.descanso_ini=ftime(r.descanso_ini); r.descanso_fin=ftime(r.descanso_fin); },
  PERSONAL: function(r){ r.fecha_ingreso=fdate(r.fecha_ingreso); r.fecha_retiro=fdate(r.fecha_retiro); }
};

function claveCache_(nombre, i){ return CACHE_PREFIJO+nombre+':'+i; }
function cacheLeer_(nombre){
  if(!CACHE_ON || !HOJAS_CACHEABLES[nombre]) return null;
  try{
    const c=CacheService.getScriptCache();
    const n=Number(c.get(claveCache_(nombre,'n')));
    if(!(n>=1)) return null;
    const claves=[]; for(let i=0;i<n;i++) claves.push(claveCache_(nombre,i));
    const partes=c.getAll(claves);
    let txt='';
    for(let j=0;j<n;j++){ const p=partes[claveCache_(nombre,j)]; if(p==null) return null; txt+=p; }
    return JSON.parse(txt);
  }catch(err){ return null; }   // ante cualquier duda (caché caído, JSON roto), se lee la hoja
}
function cacheGuardar_(nombre, filas){
  if(!CACHE_ON || !HOJAS_CACHEABLES[nombre]) return;
  try{
    const txt=JSON.stringify(filas), n=Math.ceil(txt.length/CACHE_TROZO)||1;
    if(n>CACHE_TROZOS_MAX) return;                        // hoja enorme: mejor leerla que trocearla
    const mapa={};
    for(let i=0;i<n;i++) mapa[claveCache_(nombre,i)]=txt.substr(i*CACHE_TROZO, CACHE_TROZO);
    const c=CacheService.getScriptCache();
    c.putAll(mapa, CACHE_TTL);
    c.put(claveCache_(nombre,'n'), String(n), CACHE_TTL);  // el contador va AL FINAL: sin él no se lee nada a medias
  }catch(err){}
}
function cacheBorrar_(nombre){
  if(!CACHE_ON || !HOJAS_CACHEABLES[nombre]) return;
  try{
    const c=CacheService.getScriptCache(), claves=[claveCache_(nombre,'n')];
    for(let i=0;i<CACHE_TROZOS_MAX;i++) claves.push(claveCache_(nombre,i));
    c.removeAll(claves);
  }catch(err){}
}
// Encabezados por hoja, para poder releerlas por nombre (el calentador del caché y, desde D102, los
// lectores acotados, que necesitan saber dónde cae la columna `fecha` sin cablear un número).
// Incluye TAMBIÉN las tres hojas vivas (ASISTENCIA/NOTAS_ASISTENCIA/EXTRAS_ADMIN): estar en este mapa
// no tiene nada que ver con ser cacheable — eso lo decide HOJAS_CACHEABLES, y ahí no están ni deben estar.
const HEADERS_DE_HOJA = {
  CONFIG:CONFIG_HEADERS, FESTIVOS:FESTIVOS_HEADERS, TURNOS:TURNOS_HEADERS, CAT_CC:CAT_CC_HEADERS,
  CAT_TRABAJADORES:CAT_TRABAJADORES_HEADERS, CAT_MOTIVOS:CAT_MOTIVOS_HEADERS,
  MOTIVOS_USADOS:MOTIVOS_USADOS_HEADERS, CC_USADOS:CC_USADOS_HEADERS,
  CUADRILLAS:CUADRILLAS_HEADERS, PERSONAL:PERSONAL_HEADERS,
  ASISTENCIA:ASISTENCIA_HEADERS, NOTAS_ASISTENCIA:NOTAS_ASISTENCIA_HEADERS, EXTRAS_ADMIN:EXTRAS_ADMIN_HEADERS
};

/* ---------- Calentador del caché (D99) ----------
 * El caché arregla la 2ª consulta en adelante, pero la PRIMERA del día seguía pagándolo todo: cachés
 * vacíos + contenedor de Apps Script frío. Este disparador por tiempo lo precalienta cada 30 min, así
 * la residente ya encuentra los catálogos listos al abrir la pantalla.
 * Fuerza la RELECTURA (invalida y vuelve a leer) en vez de conformarse con lo que haya: además de
 * renovar el TTL, hace que una edición A MANO en el Sheet se vea sola en ≤30 min, en vez de esperar
 * las 6 h. El botón "↻ Refrescar catálogos" sigue estando para cuando no se quiere esperar nada.
 * INSTALACIÓN (una vez, desde el editor de Apps Script): ejecutar `instalarCalentador`. Para quitarlo,
 * `quitarCalentador`. Coste: ~10 lecturas cada 30 min = 48 ejecuciones/día, muy por debajo de la cuota.
 */
function calentarCache(){
  const t0=Date.now(); let n=0;
  Object.keys(HOJAS_CACHEABLES).forEach(function(nombre){
    try{ invalidarHoja_(nombre); readSheet(nombre, HEADERS_DE_HOJA[nombre]); n++; }catch(err){}
  });
  Logger.log('calentarCache: '+n+' hoja(s) en '+(Date.now()-t0)+' ms');
  return n;
}
function instalarCalentador(){
  quitarCalentador();
  ScriptApp.newTrigger('calentarCache').timeBased().everyMinutes(30).create();
  return 'Calentador instalado: releerá los catálogos cada 30 minutos.';
}
function quitarCalentador(){
  let n=0;
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction()==='calentarCache'){ ScriptApp.deleteTrigger(t); n++; }
  });
  return 'Calentador retirado ('+n+' disparador/es).';
}

// Borra TODO el caché de catálogos. Lo usan `?action=cache_reset` y `setupHojas`.
function cacheBorrarTodo_(){ Object.keys(HOJAS_CACHEABLES).forEach(function(n){ invalidarHoja_(n); }); }
function cacheReset(e){
  cacheBorrarTodo_();
  return json({ ok:true, msg:'Catálogos refrescados: la próxima consulta los relee del Sheet.',
                hojas:Object.keys(HOJAS_CACHEABLES) });
}

function getSheet(name, headers){
  const ss=ss_(); let sh=ss.getSheetByName(name);
  if(!sh) sh=ss.insertSheet(name);
  const need=headers.length;
  ensureCols_(sh, need);   // D93: ancho de grilla suficiente para los encabezados de esta hoja
  invalidarHoja_(name);    // D99: getSheet puede escribir encabezados y precede a toda escritura
  if(sh.getLastRow()===0){ sh.getRange(1,1,1,need).setValues([headers]); return sh; }
  const cur=leerRango_(sh,1,1,1,need)[0];
  let diff=false; for(let i=0;i<need;i++){ if(String(cur[i]||'')!==headers[i]){ diff=true; break; } }
  if(diff) sh.getRange(1,1,1,need).setValues([headers]);
  return sh;
}
/**
 * D99 (Fase 2, punto 2) — lectura ACOTADA en vez de `getDataRange()`.
 * `getDataRange()` traía todas las columnas que tuviera la hoja, aunque el endpoint solo use las del
 * encabezado. Ahora se lee `getRange(1, 1, lastRow, nCols)` con `nCols` = columnas del encabezado,
 * topado al ancho real de la grilla para no salirse de rango en una hoja más angosta (ahí las
 * columnas que falten quedan `undefined`, exactamente igual que antes con `getDataRange`).
 */
function readSheet(name, headers){
  if(_memoHoja.hasOwnProperty(name)) return _memoHoja[name];   // memoria de esta ejecución (punto 1b)
  let filas = cacheLeer_(name);                                 // caché entre peticiones (punto 5)
  if(filas === null) filas = cacheGuardarYDevolver_(name, headers);
  _memoHoja[name]=filas;
  return filas;
}
function cacheGuardarYDevolver_(name, headers){
  const filas = leerHoja_(name, headers);
  cacheGuardar_(name, filas);
  return filas;
}
// Lectura cruda de la hoja + normalización de fechas/horas (ver NORMALIZA_HOJA).
function leerHoja_(name, headers){
  const sh=ss_().getSheetByName(name), out=[];
  const last = sh ? sh.getLastRow() : 0;
  if(sh && last>=2){
    const nCols = Math.min(headers ? headers.length : sh.getLastColumn(), sh.getMaxColumns());
    const v=leerRango_(sh,1,1,last,nCols), h=headers||v[0];
    const norm=NORMALIZA_HOJA[name];
    for(let i=1;i<v.length;i++){ const o={}; h.forEach((k,j)=>o[k]=v[i][j]); o._row=i+1; if(norm) norm(o); out.push(o); }
  }
  return out;
}
function norm(s){ return String(s==null?'':s).trim().toLowerCase(); }

/* ============ D102 — LECTURA EN DOS PASOS DE LAS HOJAS GRANDES (backlog 3.6 / 4.11) ============
 *
 * EL PROBLEMA. `ASISTENCIA` crece 1 fila por persona y por día: con 300 personas y ~26 días hábiles
 * son 5.200–7.800 filas/mes, 62.000–94.000 al año. Los endpoints acotados a una fecha leían la hoja
 * ENTERA y filtraban en memoria. Medido en banco con 300 personas × 60 días (17.760 filas), una sola
 * petición de `?action=asistencia` leía **301.937 celdas**; con un año de histórico, **1.308.320**.
 * Eso no se pone lento: revienta el tope de 6 minutos de Apps Script. D99 y D100 quitaron el coste
 * FIJO (una apertura del Spreadsheet, caché de catálogos) pero no bajaron una sola celda de las hojas
 * grandes, y es lo único que crece.
 *
 * EL DISEÑO. Dos pasos:
 *   1) Escaneo barato: se lee SOLO la columna `fecha` (1 de 17 columnas) y se anotan los NÚMEROS DE
 *      FILA cuya fecha cae en [desde, hasta], inclusive en ambos extremos (mismo criterio que el
 *      `consolidado` de D65). La normalización es `fdate` — el mismo helper de siempre, duck-typing,
 *      nunca `instanceof Date` ni `Utilities.formatDate` (D31). No se reimplementa nada.
 *   2) Traída acotada: esas filas se agrupan en BLOQUES CONTIGUOS (tolerando huecos de hasta
 *      GAP_TOLERANCIA filas: traer 5 filas de más sale mucho más barato que otra ida y vuelta al
 *      servicio de Sheets) y se trae un `getRange` por bloque. Después del `getValues` se vuelve a
 *      filtrar por fecha FILA A FILA, porque los huecos tolerados cuelan filas de otro día: el
 *      resultado NO puede depender del agrupamiento.
 *
 * EL FALLBACK es lo que garantiza que esto no pueda salir peor. Si la hoja es chica, si el rango es
 * largo, si el día quedó demasiado fragmentado o si habría que traer casi toda la hoja igual, se hace
 * la lectura completa de siempre (`readSheet`, con su caché y su memoria). El helper lo decide solo;
 * los endpoints no se enteran.
 *
 * LO ÚNICO QUE PUEDE LEER MÁS QUE ANTES, dicho sin adornos: si el fallback se dispara DESPUÉS del
 * escaneo (bloques o cobertura), esa petición paga la columna `fecha` de más = **+1/nCols ≈ +5,9 %**
 * sobre lo de hoy. Por eso las tres guardas baratas (hoja chica, rango largo, columna inexistente) van
 * ANTES de escanear: cubren el caso que de verdad ocurre — `?action=ausencias` con rangos largos, que
 * es donde el fallback está previsto que salte siempre. Con un rango ≤ MAX_BLOQUES días, que el
 * fallback salte post-escaneo exige una fragmentación que la simulación no produjo ni con un 60 % de
 * correcciones diarias (máximo medido: 7 bloques/día).
 */

// Huecos de hasta N filas se absorben dentro del mismo bloque en vez de abrir uno nuevo. Medido: con la
// hoja fragmentada por re-envíos, los bloques de un día quedan a miles de filas unos de otros, así que
// este número casi nunca decide nada; está por los huecos DE UNA O DOS FILAS (una persona quitada y
// vuelta a agregar). Coste máximo observado: 15 filas de más.
const GAP_TOLERANCIA = 5;
// Más bloques que esto ⇒ lectura completa. Cada bloque es una ida y vuelta a Sheets, y la lección de
// D99 es que el ida-y-vuelta FIJO es caro. Justificación del 12: simulando un año de operación con 8
// cuadrillas y el patrón real de reescritura (cada upsert reapila su bloque `fecha+cuadrilla` al final
// de la hoja), un día ocupa 1 bloque sin correcciones, 1,9 de media con un 10 % de correcciones
// diarias y **7 en el peor caso con un 60 %**. 12 deja 1,7× de margen sobre ese peor caso.
const MAX_BLOQUES = 12;
// Si habría que traer más de este porcentaje de la hoja, no compensa: se lee entera de una vez.
const UMBRAL_COBERTURA = 0.40;
// Por debajo de esta cantidad de filas de datos, el escaneo extra no se paga solo. Con 300 personas la
// hoja cruza este umbral en una semana de operación; por debajo, el comportamiento es EXACTAMENTE el
// de hoy (misma lectura, mismas celdas).
const MIN_FILAS_PARA_DOS_PASOS = 2000;

// Fallback: la lectura completa de siempre, con su caché y su memoria de ejecución, filtrada por fecha
// igual que lo hacían los endpoints antes de D102.
function leerCompletaPorFecha_(nombreHoja, headers, desde, hasta){
  return readSheet(nombreHoja, headers).filter(function(r){
    const f=fdate(r.fecha); return f>=desde && f<=hasta;
  });
}

/**
 * Lector acotado por fecha. `hasta` = `desde` para un solo día. Devuelve EXACTAMENTE los mismos
 * objetos que `readSheet(...).filter(por fecha)`: mismas claves, mismo `_row`, mismo orden de hoja.
 */
function leerFilasPorFecha_(nombreHoja, desdeISO, hastaISO){
  const headers = HEADERS_DE_HOJA[nombreHoja];
  const desde = fdate(desdeISO), hasta = fdate(hastaISO);
  const clave = nombreHoja+'|fecha|'+desde+'|'+hasta;
  if(_memoRango.hasOwnProperty(clave)) return _memoRango[clave];

  // Si la hoja completa YA está en la memoria de esta ejecución, filtrar de ahí no cuesta una celda.
  if(_memoHoja.hasOwnProperty(nombreHoja))
    return (_memoRango[clave] = leerCompletaPorFecha_(nombreHoja, headers, desde, hasta));

  // Una hoja cacheable nunca se escanea: servirla del CacheService es más barato que cualquier lectura.
  // (Hoy no aplica —solo se llama sobre ASISTENCIA, que jamás se cachea—; es una guarda de futuro.)
  if(!headers || HOJAS_CACHEABLES[nombreHoja])
    return (_memoRango[clave] = leerCompletaPorFecha_(nombreHoja, headers||HEADERS_DE_HOJA[nombreHoja], desde, hasta));

  const sh = ss_().getSheetByName(nombreHoja);
  if(!sh) return (_memoRango[clave] = []);
  const last = sh.getLastRow();
  if(last <= 1) return (_memoRango[clave] = []);        // hoja vacía: ni un getRange (guarda del §4.1)
  const nFilas = last - 1;
  const nCols  = Math.min(headers.length, sh.getMaxColumns());   // hoja más angosta ⇒ columnas `undefined`, igual que hoy
  const colFecha = headers.indexOf('fecha') + 1;                 // por NOMBRE, nunca un 3 cableado

  // --- Guardas de coste CERO (antes del escaneo, para no pagar la columna de más) ---
  if(colFecha < 1 || colFecha > nCols || nFilas < MIN_FILAS_PARA_DOS_PASOS)
    return (_memoRango[clave] = leerCompletaPorFecha_(nombreHoja, headers, desde, hasta));
  // Un rango de D días ocupa al menos D bloques salvo que haya días sin datos, así que con
  // D > MAX_BLOQUES el fallback es prácticamente seguro: mejor no escanear. Esto es lo que hace que
  // `?action=ausencias` con rangos largos lea exactamente lo mismo que antes, ni una celda más.
  if(diasEntre_(desde, hasta) > MAX_BLOQUES)
    return (_memoRango[clave] = leerCompletaPorFecha_(nombreHoja, headers, desde, hasta));

  // --- Paso 1: escaneo de UNA sola columna ---
  const col = leerRango_(sh, 2, colFecha, nFilas, 1);
  const filasOk = [];
  for(let i=0;i<nFilas;i++){
    const f = fdate(col[i][0]);
    if(f>=desde && f<=hasta) filasOk.push(i+2);        // número de fila REAL de la hoja
  }
  if(!filasOk.length) return (_memoRango[clave] = []);  // día sin datos: cero bloques, cero lecturas más

  // --- Agrupación en bloques contiguos, tolerando huecos de hasta GAP_TOLERANCIA ---
  const bloques=[]; let ini=filasOk[0], prev=filasOk[0], traidas=0;
  for(let i=1;i<filasOk.length;i++){
    if(filasOk[i]-prev-1 > GAP_TOLERANCIA){ bloques.push([ini,prev]); traidas+=prev-ini+1; ini=filasOk[i]; }
    prev=filasOk[i];
  }
  bloques.push([ini,prev]); traidas+=prev-ini+1;

  // --- Fallback por fragmentación o por cobertura ---
  if(bloques.length > MAX_BLOQUES || traidas > nFilas*UMBRAL_COBERTURA)
    return (_memoRango[clave] = leerCompletaPorFecha_(nombreHoja, headers, desde, hasta));

  // --- Paso 2: un getValues por bloque, y RE-FILTRO por fecha fila a fila ---
  const out=[], norma=NORMALIZA_HOJA[nombreHoja];
  for(let b=0;b<bloques.length;b++){
    const desdeFila=bloques[b][0], n=bloques[b][1]-desdeFila+1;
    const v=leerRango_(sh, desdeFila, 1, n, nCols);
    for(let i=0;i<n;i++){
      const o={}; headers.forEach((k,j)=>o[k]=v[i][j]); o._row=desdeFila+i; if(norma) norma(o);
      const f=fdate(o.fecha);
      if(f>=desde && f<=hasta) out.push(o);            // los huecos tolerados cuelan filas de otro día
    }
  }
  return (_memoRango[clave] = out);
}

/* ============ D107 — ESCRITURA QUIRÚRGICA (backlog 4.11: la otra mitad de D102) ============
 *
 * EL PROBLEMA. D102 acotó las LECTURAS por fecha, pero dejó las escrituras intactas y lo dijo por
 * escrito: `guardarAsistencia` y `guardarIndividual` hacían `clearContents()` de TODA la hoja y la
 * reescribían entera. Con 17 columnas eso son **17·N celdas leídas + 17·N escritas por cada envío**:
 * ~306.000 + ~306.000 con 2,4 meses de histórico, ~1,3 M + 1,3 M con un año. Y no es un envío al día:
 * son ~11 cuadrillas MÁS cada clic de "Completar faltantes" y cada corrección del detalle — corregirle
 * la hora a UNA persona reescribía las 18.000 filas.
 *
 * EL DISEÑO, igual que el `enviar_data` de obra: en vez de reescribir, se BORRAN las filas que el
 * upsert tiene que pisar y se AÑADEN las nuevas al final.
 *   1) Localizar: se leen SOLO las columnas que deciden (fecha+cuadrilla, o fecha+codigo+cedula), en
 *      UN bloque contiguo. Son 3 y 5 de 17 columnas.
 *   2) Borrar: las filas se agrupan en tramos contiguos y cada tramo sale con UN `deleteRows`. El
 *      bloque de una cuadrilla se escribe junto, así que en la práctica es 1 llamada.
 *   3) Añadir: las nuevas al final, con `ensureRows_` (D93) delante.
 *
 * LO QUE NO CAMBIA — verificado punto por punto antes de tocar nada:
 *   · **Pisado D03.** Se borra exactamente el mismo conjunto que antes quedaba fuera del `keep`: el
 *     predicado es el mismo, solo que ahora decide sobre 3 columnas en vez de sobre las 17.
 *   · **Idempotencia offline D82.** Reenviar el mismo payload borra el bloque recién escrito y vuelve
 *     a escribir lo mismo. Sigue sin necesitar UUID ni dedupe, igual que antes.
 *   · **Orden de las filas.** Antes era `keep + nuevas` (las nuevas al final); ahora es exactamente lo
 *     mismo, porque borrar cierra el hueco y las nuevas van al final de la hoja.
 *   · **Compacidad.** `deleteRows` sube las filas de abajo, así que la hoja no queda con huecos y el
 *     agrupamiento por bloques de D102 sigue siendo tan eficiente como antes.
 *
 * LO QUE SÍ MEJORA DE PROPINA: la hoja deja de barajarse entera en cada envío. Editar el Sheet a mano
 * mientras alguien reporta deja de ser una ruleta (las filas ya no se mueven bajo el cursor).
 */

// Nº de filas de más que se toleran dentro de un mismo `deleteRows`. A diferencia de la LECTURA, aquí
// un hueco NO se puede absorber: borraríamos filas de otro día. Por eso los tramos son estrictamente
// contiguos y esta constante no existe. (Nota deliberada para quien venga a "optimizar" esto.)

/**
 * Localiza los números de fila REALES que cumplen un predicado, leyendo solo las columnas necesarias.
 * `campos` = nombres de columna del encabezado; se lee el bloque contiguo que las cubre a todas.
 * `pred(v)` recibe un objeto {campo: valor} y devuelve true si esa fila hay que borrarla.
 */
function localizarFilas_(sh, headers, campos, pred){
  const last=sh.getLastRow();
  if(last<=1) return [];
  const idx=campos.map(function(c){ return headers.indexOf(c); });
  if(idx.some(function(i){ return i<0; })) throw new Error('localizarFilas_: columna inexistente en '+campos.join(','));
  const desdeCol=Math.min.apply(null, idx)+1, hastaCol=Math.max.apply(null, idx)+1;
  const ancho=Math.min(hastaCol-desdeCol+1, sh.getMaxColumns()-desdeCol+1);
  const v=leerRango_(sh, 2, desdeCol, last-1, ancho);
  const out=[];
  for(let i=0;i<v.length;i++){
    const o={};
    // idx[k] es 0-based y desdeCol 1-based: el desplazamiento dentro del bloque leído es idx[k]-(desdeCol-1).
    for(let k=0;k<campos.length;k++) o[campos[k]]=v[i][idx[k]-desdeCol+1];
    if(pred(o)) out.push(i+2);            // número de fila real de la hoja
  }
  return out;
}

/**
 * Borra las filas indicadas agrupándolas en tramos CONTIGUOS, de abajo hacia arriba (si se borrara de
 * arriba hacia abajo, cada borrado correría los números de las siguientes). Devuelve cuántas borró.
 */
function borrarFilas_(sh, filas){
  if(!filas || !filas.length) return 0;
  const orden=filas.slice().sort(function(a,b){ return a-b; });
  const tramos=[]; let ini=orden[0], prev=orden[0];
  for(let i=1;i<orden.length;i++){
    if(orden[i]!==prev+1){ tramos.push([ini,prev]); ini=orden[i]; }
    prev=orden[i];
  }
  tramos.push([ini,prev]);
  for(let t=tramos.length-1;t>=0;t--) sh.deleteRows(tramos[t][0], tramos[t][1]-tramos[t][0]+1);
  return orden.length;
}

/** Añade filas al final de la hoja, con la guarda de capacidad de D93. */
function anexarFilas_(sh, filas, need){
  if(!filas.length) return;
  ensureRows_(sh, filas.length);
  sh.getRange(sh.getLastRow()+1, 1, filas.length, need).setValues(filas);
}

// Días de calendario que abarca [desde, hasta] (ambos inclusive), sin construir la lista. Aritmética
// con Date local (Bogotá no tiene DST), mismo patrón que `diasDelRango`. Rango vacío o inválido ⇒ 0.
function diasEntre_(desde, hasta){
  if(!desde || !hasta || hasta < desde) return 0;
  const a=String(desde).split('-'), b=String(hasta).split('-');
  const d1=new Date(Number(a[0]), Number(a[1])-1, Number(a[2]));
  const d2=new Date(Number(b[0]), Number(b[1])-1, Number(b[2]));
  return Math.round((d2-d1)/86400000)+1;
}

/**
 * D102 — lector acotado POR COLUMNAS (no por fecha), para los dos cruces que necesitan TODO el
 * histórico y por tanto no se pueden acotar por fecha sin cambiar el resultado:
 *   · `proyectoDefecto` del export (D94 / backlog 4.11) — cuadrilla(5), proyecto(11), presente(14)
 *   · los CC recientes por cuadrilla de `roster`          — timestamp(2), cuadrilla(5), cc(10)
 * Se lee el bloque contiguo mínimo que las cubre. Mismas FILAS y mismos CAMPOS que antes ⇒ mismo
 * resultado por construcción; lo único que cambia es que no se traen las columnas que nadie mira.
 * Memoria propia (`_memoRango`), NUNCA `_memoHoja`: esto tampoco es la hoja completa.
 */
function leerColumnasDeHoja_(nombreHoja, colIni, colFin){
  const headers = HEADERS_DE_HOJA[nombreHoja];
  const clave = nombreHoja+'|cols|'+colIni+'|'+colFin;
  if(_memoRango.hasOwnProperty(clave)) return _memoRango[clave];
  // Si la hoja completa ya está en memoria (o es cacheable), sale gratis de ahí.
  if(_memoHoja.hasOwnProperty(nombreHoja) || !headers || HOJAS_CACHEABLES[nombreHoja])
    return (_memoRango[clave] = readSheet(nombreHoja, headers||HEADERS_DE_HOJA[nombreHoja]));

  const sh = ss_().getSheetByName(nombreHoja);
  if(!sh) return (_memoRango[clave] = []);
  const last = sh.getLastRow();
  if(last <= 1) return (_memoRango[clave] = []);
  const maxCols = sh.getMaxColumns();
  if(colIni > maxCols) return (_memoRango[clave] = []);   // hoja más angosta que el bloque: nada que leer
  const fin = Math.min(colFin, headers.length, maxCols);
  const n = fin - colIni + 1;
  if(n < 1) return (_memoRango[clave] = []);
  const v = leerRango_(sh, 2, colIni, last-1, n);
  // Sin NORMALIZA_HOJA a propósito: un normalizador escribe claves por nombre y, sobre una REBANADA de
  // columnas, inventaría las que no vinieron (`o.fecha_ingreso=''`). Las únicas hojas que llegan aquí
  // son las tres vivas (no cacheables) y ninguna tiene normalizador; las cacheables salen antes por
  // `readSheet`, que sí lo aplica. Si algún día una hoja con normalizador necesita este lector, hay
  // que normalizar SOLO las columnas de la rebanada.
  const out=[];
  for(let i=0;i<v.length;i++){
    const o={};
    for(let j=0;j<n;j++) o[headers[colIni-1+j]] = v[i][j];
    o._row=i+2; out.push(o);
  }
  return (_memoRango[clave] = out);
}

/* ---------- área (D72 / D84) ---------- */
// Helper único de áreas por usuario (mismo criterio que el frontend, D84): devuelve el ARRAY de áreas
// que revisa un usuario. residente_odt/odl ven SOLO su área; residente_dren y duvan ven ['odt','odl'];
// el residente "general"/jeisson son de TIERRAS (D74b); admin devuelve [] = SIN filtro (ve todas).
//   residente_odt  -> ['odt']              residente_odl  -> ['odl']
//   residente_dren -> ['odt','odl']        duvan -> ['odt','odl']  (D88: solo asistencias)
//   residente/jeisson -> ['tierras']       admin (u otro) -> []
function areasDeUsuario(usuario){
  const u=norm(usuario);
  if(u==='residente_odt')  return ['odt'];
  if(u==='residente_odl')  return ['odl'];
  if(u==='residente_dren') return ['odt','odl'];   // D84: residente de drenajes unificado
  // D88: `duvan` = el jeisson de drenajes (asistencias de ODT+ODL y nada más). Mismo alcance de datos
  // que residente_dren en este módulo; lo que NO tiene es el panel/reporte de drenajes (eso va por rol
  // en el frontend, no por este helper).
  if(u==='duvan')          return ['odt','odl'];
  // D101: la residente de UF3 (proyecto 3703). UF3 es un ÁREA MÁS de este mismo módulo, no un sistema
  // aparte: reporta y revisa solo `uf3`, sin acceso a tierras ni a drenajes.
  if(u==='residente_uf3')  return ['uf3'];
  // D119: `angie` — la persona dedicada a asistencias de TM2 Sur (rol `asistencia_plus_tm2`). Es el
  // molde de `duvan` (D88) y `residente_uf3` (D101) pero con TRES áreas a la vez: revisa el resumen de
  // tierras y de drenajes, reporta cualquier cuadrilla activa de las tres y gestiona su personal.
  // UF3 (proyecto 3703) queda FUERA a propósito: la lleva `residente_uf3`. Sumarla algún día es
  // agregar `'uf3'` a este array y nada más.
  if(u==='angie')          return ['tierras','odt','odl'];
  if(u==='residente' || u==='jeisson') return ['tierras'];
  return [];   // admin: sin filtro (puede filtrar por &area=)
}
// Áreas efectivas de una petición: las forzadas por el usuario; si NO tiene (admin), respeta un &area=
// de filtro. [] = sin filtro (admin sin &area). Los usuarios con área forzada no la pueden burlar.
// D116: `&area=` admite VARIAS áreas separadas por coma (`odt,odl`), para que el "Ver como" del admin
// pueda ver DRENAJES completo en una sola vista — lo que `residente_dren` ya veía por su rol (D84) y el
// admin solo podía mirar por separado. Un solo valor sigue funcionando igual (`odt` = `['odt']`), así
// que nada de lo existente cambia. Se valida contra la lista blanca y se deduplica: lo que no esté en
// ella se descarta, y si no queda ninguna válida se cae a [] = sin filtro (el admin ve todas).
const AREAS_VALIDAS = ['tierras','odt','odl','uf3'];   // D101: `uf3` entró en la lista blanca (D74b)
/* D119 — el `&area=` se INTERSECTA con las áreas forzadas, en vez de ignorarse cuando las hay.
 *
 * POR QUÉ. Hasta ahora el "Ver como" era exclusivo del admin: quien tenía área forzada por su rol veía
 * el parámetro descartado entero. Con `angie` (tres áreas) el resumen "todo junto" es ruidoso y el
 * filtro pasa a ser útil de verdad, así que hace falta un `&area=` que ACOTE sin poder AMPLIAR.
 *
 *   areasEfectivas = pedidas.length ? (pedidas ∩ forzadas) : forzadas
 *
 * La intersección solo puede DEVOLVER UN SUBCONJUNTO de lo que el rol ya autorizaba, así que no abre
 * nada: `&area=uf3` con forzadas ['tierras','odt','odl'] da intersección vacía y se ignora el parámetro
 * (se usan las forzadas) — nunca cae en "todas", que es el error que convertiría un filtro en un hueco.
 * Desde D109 esto es un cerrojo real: la identidad llega firmada y el backend la sobrescribe (doGet/
 * doPost), así que no depende de qué mande el cliente.
 *
 * REGRESIÓN CERO. Para `admin` (forzadas []) el camino es idéntico al de D116. Para los roles con área
 * forzada el resultado solo cambiaría si alguien les mandara `&area=`, y ninguno lo hace: el selector
 * se dibuja solo para el admin y para el rol nuevo (resumen-asistencia.html), y el resto de las
 * pantallas manda el parámetro vacío. Y si llegara, el efecto sería acotar dentro de su propia área,
 * nunca ver algo ajeno. */
function areasEfectivas(e){
  const forzadas=areasDeUsuario((e.parameter&&e.parameter.usuario)||'');
  const pedidas=String((e.parameter&&e.parameter.area)||'').split(',')
    .map(function(s){ return norm(s); })
    .filter(function(a,i,arr){ return AREAS_VALIDAS.indexOf(a)>=0 && arr.indexOf(a)===i; });
  if(!pedidas.length) return forzadas;          // sin filtro pedido: manda el rol ([] = admin, todas)
  if(!forzadas.length) return pedidas;          // admin: el filtro manda, exactamente como en D116
  const inter=pedidas.filter(function(a){ return forzadas.indexOf(a)>=0; });
  return inter.length ? inter : forzadas;       // intersección vacía = el parámetro se ignora
}
// ¿La cuadrilla `c` cae dentro de las áreas dadas? [] = sin filtro (todas). Compat con === anterior.
function cuadrillaEnAreas(c, areas, cuadArea){ return !areas.length || areas.indexOf(cuadArea[c]||'tierras')>=0; }
// D101 (regla D69h: validar en el BACKEND, no solo en el frontend): al ESCRIBIR asistencia, un usuario
// con área forzada por su rol solo puede tocar cuadrillas de su área. Quien no tiene área forzada
// (capataces, chequeadoras, mairy, admin) pasa sin restricción — exactamente como hasta ahora, así que
// no cambia nada para los canales existentes. Cierra el hueco de "&usuario= correcto + cuadrilla ajena".
function cuadrillaPermitidaPara(usuario, cuadrilla){
  const areas=areasDeUsuario(usuario);
  if(!areas.length) return true;
  return cuadrillaEnAreas(cuadrilla, areas, areaDeCuadrillaMap());
}
// Mapa cuadrilla -> área desde la hoja CUADRILLAS. Vacío o cuadrilla desconocida = 'tierras'.
function areaDeCuadrillaMap(){
  const m={}; readSheet('CUADRILLAS', CUADRILLAS_HEADERS).forEach(r=>{ m[r.cuadrilla]=norm(r.area)||'tierras'; });
  return m;
}
// D84: ¿la cuadrilla está activa? `estado` vacío = activa (retrocompatible); solo 'inactiva' la saca.
function cuadrillaActiva(r){ return norm(r.estado)!=='inactiva'; }
// Set con los NOMBRES de las cuadrillas inactivas (para filtrar rápido el roster esperado).
function cuadrillasInactivasSet(){
  const s={}; readSheet('CUADRILLAS', CUADRILLAS_HEADERS).forEach(r=>{ if(!cuadrillaActiva(r)) s[r.cuadrilla]=true; });
  return s;
}
// Área de quien REPORTA (para filtrar CC_USADOS): residente de UNA área por su rol; capataz/mairy por
// sus cuadrillas si todas son de la misma área. Mezcla, multi-área (residente_dren) o desconocido =
// '' (sin filtro: ve todas).
// D88: `roster` ya resuelve primero por `areasDeUsuario` (que sí soporta multi-área), así que este
// helper queda como el camino de quien NO tiene área forzada por su rol (capataces, mairy, admin);
// las dos primeras ramas se conservan por si alguien más lo llama.
function areaDeReportante(usuario){
  const porRol=areasDeUsuario(usuario);
  if(porRol.length===1) return porRol[0];   // residente_odt/odl, residente/jeisson (tierras)
  if(porRol.length>1)   return '';           // D84: residente_dren ve los CC de ambas áreas
  const cuads=cuadrillasDeUsuario(usuario), map=areaDeCuadrillaMap(); let a=null;
  for(let i=0;i<cuads.length;i++){ const ar=map[cuads[i]]||'tierras'; if(a===null) a=ar; else if(a!==ar) return ''; }
  return a===null ? '' : a;
}
// D72: CC que NO deben aparecer en el selector de bloques (supervisión del encargado/capataz, p. ej.
// `I010305 ENCARGADOS, INSPECTORES Y CAPATACES`) — confunde al reportar la actividad de la cuadrilla.
// Lista en CONFIG.cc_excluidos_bloque (coma-separada, por código); default `I010305`. Match por substring,
// así aplica a los dos proyectos (3701.I010305… y 3702.I010305…) y en TODAS las áreas.
function ccExcluidosBloque(){
  const raw=String(getConfigMap().cc_excluidos_bloque||'I010305');
  return raw.split(',').map(function(s){return s.trim();}).filter(Boolean);
}
function sinCCexcluidos(list){
  const ex=ccExcluidosBloque(); if(!ex.length) return list;
  return list.filter(function(cc){ const s=String(cc||''); for(var i=0;i<ex.length;i++){ if(ex[i] && s.indexOf(ex[i])>=0) return false; } return true; });
}
// Lee CC_USADOS y devuelve los string_cc que aplican al área dada. Empty en la hoja = tierras.
// D88: acepta un ÁREA ('odt') o un ARRAY de áreas (['odt','odl'], para residente_dren/duvan). '' o []
// = todas (admin y quien no tenga área forzada). Antes, multi-área caía en '' y mezclaba los CC de
// tierras en los "frecuentes"; ahora se limitan a las áreas del usuario (intención de D84).
function ccUsadosParaArea(area){
  const areas = Array.isArray(area) ? area.filter(Boolean) : (area ? [area] : []);
  const rows=readSheet('CC_USADOS', CC_USADOS_HEADERS);
  return sinCCexcluidos(rows.filter(r=> String(r.string_cc||'').trim() && (!areas.length || areas.indexOf(norm(r.area)||'tierras')>=0))
             .map(r=>String(r.string_cc).trim()));
}
// Motivos de ausencia (D78): el catálogo completo (CAT_MOTIVOS) es para quien revisa el resumen;
// el responsable de cuadrilla ve solo los frecuentes (MOTIVOS_USADOS). Hoja vacía = catálogo completo.
function motivosCatalogo(){ return readSheet('CAT_MOTIVOS', CAT_MOTIVOS_HEADERS).map(r=>String(r.string_motivo||'')).filter(Boolean); }
function motivosUsados(){
  const rows=readSheet('MOTIVOS_USADOS', MOTIVOS_USADOS_HEADERS).map(r=>String(r.string_motivo||'')).filter(Boolean);
  return rows.length ? rows : motivosCatalogo();
}

/* ---------- roster date-aware (D72) ----------
 * Una persona "se esperaba" en `fecha` si ya había ingresado y aún no la habían retirado a esa fecha:
 *   [fecha_ingreso, fecha_retiro)  — el retiro cuenta como primer día NO trabajado.
 * Comparación de strings 'yyyy-MM-dd' (orden lexicográfico = cronológico). Sin fecha_retiro se cae al
 * `estado` actual (compat con filas viejas sin fechas). Si no llega `fecha`, no se filtra por ventana. */
function activaEnFecha(p, fecha){
  const ing=fdate(p.fecha_ingreso), ret=fdate(p.fecha_retiro);
  if(ing && fecha && fecha < ing) return false;   // aún no ingresaba ese día
  if(ret) return !(fecha && fecha >= ret);         // retiro con fecha: activa antes de esa fecha
  return String(p.estado||'activo')!=='inactivo';  // sin fecha de retiro: usa el estado actual
}
// D85: personal EVENTUAL (p. ej. el encargado Javier): trabaja solo en ocasiones puntuales (dom/fest),
// así que NO se le espera en el día a día — no aparece en el roster del responsable ni cuenta como
// faltante/sin-reportar — pero queda disponible en "Completar faltantes" del resumen para marcarlo
// presente cuando sí trabaja. Se marca escribiendo `estado = eventual` en su fila de PERSONAL (la
// columna ya existe; `activaEnFecha` lo trata como activo porque solo 'inactivo' desactiva).
function esEventual(p){ return norm(p.estado)==='eventual'; }

/* ============ D118 — UNA PERSONA, UNA FILA (causa raíz de los reportes duplicados) ============
 *
 * SÍNTOMA. El 01-ago-2026 el resumen de ODT mostró 7 personas con DOS filas en ASISTENCIA el mismo día,
 * todas en la MISMA cuadrilla (ENRIQUE) y del MISMO reportante (duvan), algunas con marcas
 * contradictorias (una ausente y otra presente).
 *
 * POR QUÉ NO PODÍA SER UN DOBLE ENVÍO. `guardarAsistencia` borra el bloque fecha+cuadrilla y anexa: un
 * segundo envío de la misma cuadrilla PISA al primero, nunca lo duplica (verificado en `borrarFilas_`,
 * que agrupa en tramos contiguos y los borra de abajo hacia arriba). Si quedan dos filas de la misma
 * persona en la misma cuadrilla, es que el ENVÍO YA TRAÍA DOS: el formulario se las mostró dos veces.
 *
 * LA RAÍZ. `roster` no deduplicaba: devolvía tal cual las filas de PERSONAL que pasaran el filtro. Y
 * nada impedía que la hoja tuviera dos filas ACTIVAS de la misma persona — `alta` hacía `appendRow` sin
 * mirar si ya existía, y `reingreso` (que crea fila nueva a propósito, para conservar el hueco de los
 * días inactivos) no comprobaba que la fila de origen estuviera realmente retirada. Con dos filas vivas,
 * el capataz veía a la persona dos veces, llenaba las dos y el día quedaba con horas duplicadas — que
 * el Parte de Navision se lleva tal cual, porque escribe una línea por fila.
 *
 * EL CIERRE (tres puntos, este helper es el primero):
 *   1. `roster` y el roster esperado de `asistenciaDia` deduplican por persona → el formulario ya no
 *      puede mostrar a nadie dos veces, ni los faltantes contar a nadie dos veces.
 *   2. `alta` rechaza un código/cédula que ya tenga fila activa; `reingreso` exige que la de origen esté
 *      retirada. Se cierra la puerta por la que entraban las filas gemelas.
 *   3. `diagnosticoPersonalDuplicado()` lista las que YA están en la hoja (mantenimiento a mano, mismo
 *      patrón que `diagnosticoFechasAsistencia` de D106). No borra nada: la fila que sobra la decide el
 *      usuario, porque cada una puede tener cuadrilla o fecha_ingreso distintas.
 *
 * Clave de persona: código si lo tiene, si no la cédula — la misma de `guardarIndividual.keyOf` y la de
 * los faltantes, así que "una persona" significa lo mismo en todo el módulo. */
function clavePersona_(p){
  const c=String((p&&p.codigo)||'').trim();
  return c ? ('COD:'+c) : ('CED:'+String((p&&p.cedula)||'').trim());
}
/* Devuelve un predicado «¿esta fila guardada es de alguna de las personas que llegan?».
 *
 * La regla (D123) respeta la jerarquía de los identificadores. El CÓDIGO manda: es el que usa Navision
 * (CAT_TRABAJADORES está indexado por él) y el único fiable — en la obra hay DOS PERSONAS con la misma
 * cédula (74270 FREDY MACHACON y 76358 ALEIXER LIZARAZO comparten la 91515627, error de digitación en
 * PERSONAL), así que emparejar por «código O cédula» borraba a una al editar a la otra.
 *   · los dos tienen código      -> misma persona SOLO si el código coincide (la cédula no opina);
 *   · a uno le falta el código   -> se cae a la cédula (el caso que D119 vino a arreglar);
 *   · no hay ninguno de los dos  -> nombre+cuadrilla.
 * El código se compara NORMALIZADO (sin espacios ni ceros a la izquierda): '076333' casa con '76333'
 * sin necesidad de mirar la cédula.
 *
 * D126 — vive fuera de `guardarIndividual` porque ahora lo usan LOS DOS caminos de escritura: el upsert
 * por persona y el envío de cuadrilla. Una sola definición de «es la misma persona» para todo el módulo. */
function emparejadorDePersonas_(incoming){
  const cods={}, cedsSinCod={}, cedsConCod={}, noms={};
  function normCod(v){ return String(v==null?'':v).trim().replace(/^0+/, ''); }
  // Respaldo para quien no tenga NI código NI cédula: nombre+cuadrilla. Sin él, esas filas emparejaban
  // todas entre sí y corregir a una borraba a las demás — pérdida silenciosa, peor que el duplicado.
  function claveNombre(o){
    const n=norm(o&&o.nombre), c=norm(o&&o.cuadrilla);
    return n ? (n+'|'+c) : '';
  }
  (incoming||[]).forEach(function(f){
    const c=normCod(f.codigo), d=String(f.cedula||'').trim();
    if(c){ cods[c]=true; if(d) cedsConCod[d]=true; }
    else if(d) cedsSinCod[d]=true;
    else { const n=claveNombre(f); if(n) noms[n]=true; }
  });
  return function(o){
    const c=normCod(o.codigo), d=String(o.cedula||'').trim();
    // Fila guardada CON código: manda el código. La cédula solo la rescata si el ENTRANTE viene sin
    // código (misma persona guardada desde una fuente que no lo tenía). Un entrante CON código nunca
    // arrastra a una fila de OTRO código aunque compartan cédula — es lo que protege a ALEIXER.
    if(c) return !!cods[c] || (!!d && !!cedsSinCod[d]);
    // Fila guardada SIN código: se identifica por la cédula, venga el entrante con código o sin él.
    if(d) return !!cedsSinCod[d] || !!cedsConCod[d];
    const n=claveNombre(o); return !!n && !!noms[n];
  };
}
// Primera fila de cada persona, conservando el orden de la hoja. Sin duplicados devuelve la misma lista.
function unicasPorPersona_(lista){
  const vistos={}, out=[];
  (lista||[]).forEach(function(p){
    const k=clavePersona_(p);
    if(k==='COD:' || k==='CED:'){ out.push(p); return; }   // sin código NI cédula: no se puede agrupar
    if(!vistos[k]){ vistos[k]=true; out.push(p); }
  });
  return out;
}

/* ---------- CONFIG / FESTIVOS ---------- */
function getConfigMap(){
  const rows=readSheet('CONFIG', CONFIG_HEADERS), m={};
  rows.forEach(r=>{
    if(!r.clave) return;
    let v=r.valor;
    // Sheets guarda las celdas de hora (entrada_lv, salida_lv, almuerzo_*, nocturno_*) como VALOR de
    // hora → Apps Script las lee como Date (base 1899-12-30) y saldrían como "1899-12-30T..." al JSON.
    // Las normalizamos a "HH:MM" por duck-typing (getHours), nunca instanceof Date (D31). Números y
    // strings (topes, strings de proyecto) pasan tal cual.
    if(v && typeof v==='object' && typeof v.getHours==='function') v=ftime(v);
    m[String(r.clave).trim()]=v;
  });
  return m;
}
function getFestivos(){
  return readSheet('FESTIVOS', FESTIVOS_HEADERS).map(r=>fdate(r.fecha)).filter(Boolean);
}
// Tipo de jornada del día: 'lv' (lunes-viernes) · 'sabado' · 'domfest' (domingo o festivo).
function tipoJornada(fecha, festivos){
  const d=String(fecha||'').split('-');
  if(d.length<3) return 'lv';
  const dt=new Date(Number(d[0]), Number(d[1])-1, Number(d[2]));
  const dow=dt.getDay(); // 0=domingo..6=sabado
  if((festivos||[]).indexOf(fecha)>=0) return 'domfest';
  if(dow===0) return 'domfest';
  if(dow===6) return 'sabado';
  return 'lv';
}
// Jornada estándar (entrada/salida por defecto + tope de ordinarias) según CONFIG y el tipo de día.
function jornadaDelDia(fecha, cfg, festivos){
  const tipo=tipoJornada(fecha, festivos);
  if(tipo==='sabado') return { tipo, entrada:cfg.entrada_sab||'07:00', salida:cfg.salida_sab||'11:30', tope:parseFloat(cfg.ord_sabado)||4.5 };
  // D77: domfest con horario típico pre-llenado (07:00–15:00; 8h − 1h almuerzo = 7h Dom/Fest, dueño
  // jul-2026). El tope ordinario L-V sigue en 0: esas horas van a la col D Dom/Fest, no a ordinarias.
  if(tipo==='domfest') return { tipo, entrada:cfg.entrada_dom||'07:00', salida:cfg.salida_dom||'15:00', tope:parseFloat(cfg.ord_domingo)||0 };
  return { tipo, entrada:cfg.entrada_lv||'07:00', salida:cfg.salida_lv||'15:30', tope:parseFloat(cfg.ord_lun_vie)||7.5 };
}
// D101: ya era GENÉRICO (toma los 4 primeros dígitos del CC, no compara contra una pareja fija), así
// que `3703.02.05| …` devuelve `3703` sin tocar nada. No listar proyectos válidos a mano.
function proyectoFromCC(cc){
  const s=String(cc||'').trim();
  const m=s.match(/^(\d{4})/);
  return m ? m[1] : '';
}

/* ---------- routing ---------- */
function doGet(e){
  _t0 = Date.now();   // D99: siembra el cronómetro de servidor (`_ms` en la respuesta)
  const a=((e.parameter.action)||'').toLowerCase();
  logIniciar_(a||'ping');   // D166: una fila en LOG al terminar (finally), nunca hace fallar la petición
  try{
    // D109: puerta única. Aquí importa el doble que en obra, porque TODA la autorización de este módulo
    // (áreas, cuadrillas permitidas, quién puede completar faltantes) se derivaba del `usuario` que
    // mandaba el cliente. Ahora sale del token firmado y sobrescribe lo que venga en la petición.
    // D166: `puerta_` envuelve a `sesion_` con LOG, rate limit (60/min por usuario+action) y respuesta
    // genérica ante token inválido; el ÚNICO mensaje explícito que sobrevive es el de AUTH_SECRETO ausente.
    const p=puerta_(e, null, a||'ping');
    if(!p.ok) return p.respuesta;
    const ses=p.ses;
    if(ses.usuario) e.parameter.usuario = ses.usuario;
    /* D142 — el ROL del token también viaja, en `_rol`. Hasta ahora las lecturas solo necesitaban el
     * `usuario` (de ahí salen las áreas), pero `persona_admin` no se acota por área sino por PERSONA: es
     * el canal privado del admin (EXTRAS_ADMIN, D73) y nadie más lo puede leer. Mismo patrón que D139
     * usó en el Apps Script de obra con `body._rol` en las escrituras: el rol lo pone el SERVIDOR desde
     * el token firmado, nunca el cliente — un `&_rol=admin` tecleado en la URL se sobrescribe aquí. */
    e.parameter._rol = ses.rol || '';
    if(a==='roster')     return roster(e);
    if(a==='asistencia') return asistenciaDia(e);
    if(a==='personal')   return personalCompleto(e);
    if(a==='export')     return exportDia(e);
    if(a==='ausencias')  return ausenciasRango(e);   // D94: seguimiento de ausencias por rango
    if(a==='persona')    return horasPersona(e);     // D112: horas de UNA persona en un rango (solo lectura)
    if(a==='persona_admin') return horasAdmin(e);   // D142: las horas del PROPIO admin (EXTRAS_ADMIN, D73)
    // D99: refresco manual del caché de catálogos, para quien acaba de editar el Sheet a mano
    // (CAT_CC, CAT_MOTIVOS, CC_USADOS, CONFIG, TURNOS, `estado`/`area` de CUADRILLAS…).
    if(a==='cache_reset') return cacheReset(e);
    // EXTRAS_ADMIN (D73): registro del día para prefill/edición en mis-extras.html; `extras_admin_dia`
    // es alias (mismo handler) para el indicador del residente en resumen-asistencia.html.
    if(a==='extras_admin' || a==='extras_admin_dia') return extrasAdminDia(e);
    return json({ok:true, msg:'API Asistencias viva'});
  }catch(err){ logMarcar_('error', String(err)); throw err; }   // mismo comportamiento de antes; queda anotado
  finally{ logEscribir_(); }
}
function doPost(e){
  _t0 = Date.now();   // D99: cronómetro de servidor también en las escrituras
  logIniciar_('POST');   // D166: una fila en LOG al terminar (finally), nunca hace fallar la petición
  try{
    const body=JSON.parse(e.postData.contents);
    logAction_(String(body.action||'')||'?');
    // D109: identidad desde el token. Se sobrescriben `usuario` Y `reporta` porque en este módulo los
    // dos son el que está en sesión (el formulario manda su propio usuario en ambos) y de ellos
    // dependen `cuadrillaPermitidaPara` y el guard de "completar faltantes".
    // D166: `puerta_` = sesion_ + LOG + rate limit (60/min por usuario+action) + respuesta genérica.
    const p=puerta_(e, body, String(body.action||'')||'?');
    if(!p.ok) return p.respuesta;
    const ses=p.ses;
    if(ses.usuario){ body.usuario = ses.usuario; body.reporta = ses.usuario; }
    /* D125 — TODA escritura se serializa. Cada uno de estos endpoints es un LEE-MODIFICA-ESCRIBE sobre
     * la misma hoja (localiza las filas a pisar, las borra y anexa las nuevas). Sin bloqueo, dos
     * peticiones simultáneas leen la hoja ANTES de que la otra borre, así que ninguna de las dos
     * encuentra nada que pisar y las dos anexan: el día queda con la persona repetida en filas
     * CONSECUTIVAS. Es la firma exacta de lo reportado (OSMEL 77676, filas 3165-3166-3167, misma
     * cuadrilla, mismo reportante, mismo CC) y explica los duplicados que aparecían sin que nadie
     * hubiera reportado dos veces: basta con que el responsable toque "Guardar" dos veces porque la
     * primera parece no responder, o que la cola offline (D82) reintente mientras él vuelve a enviar.
     *
     * Apps Script NO serializa las llamadas a `doPost` por su cuenta. El bloqueo va aquí, en el
     * despachador, y no dentro de cada función: es un solo sitio, cubre los cinco endpoints y no puede
     * olvidarse en el siguiente que se agregue. Las LECTURAS (`doGet`) no se bloquean.
     *
     * 30 s de espera: más que de sobra para una escritura de estas (decenas de ms) y suficiente para
     * absorber una ráfaga de varios capataces enviando a la vez. Si se agota, se contesta un error
     * explícito en vez de escribir a ciegas — y con `ok:false` la cola offline conserva el reporte en
     * el teléfono (D82) para reintentarlo, que es justo lo que se quiere. */
    const esEscritura = ['reporte_asistencia','asistencia_individual','personal','extras_admin','extras_admin_delete']
      .indexOf(body.action) >= 0;
    if(!esEscritura) return json({ok:false, error:'acción no reconocida'});
    // D166: validación de tipos/rangos/longitudes/fechas del payload ANTES del cerrojo y del Sheet.
    // Rechazo = {ok:false, error:'payload', campo}; con ok:false la cola offline conserva el ítem (D82).
    const vp=validarPayloadAsistencias_(body); if(vp) return vp;
    const cerrojo = LockService.getScriptLock();
    try{
      cerrojo.waitLock(30000);
    }catch(errLock){
      return json({ok:false, error:'El sistema está guardando otro reporte en este momento. Espera unos segundos y vuelve a intentarlo (no se guardó nada).'});
    }
    try{
      if(body.action==='reporte_asistencia')    return guardarAsistencia(body);
      if(body.action==='asistencia_individual') return guardarIndividual(body);
      if(body.action==='personal')              return gestionPersonal(body);
      if(body.action==='extras_admin')          return guardarExtrasAdmin(body);    // D73: upsert por fecha
      if(body.action==='extras_admin_delete')   return borrarExtrasAdmin(body);     // D73: borra el día
    } finally {
      // Siempre se suelta: si una excepción se lleva la ejecución por delante, sin esto el cerrojo
      // quedaría tomado hasta que Apps Script lo recicle y las escrituras siguientes se irían al error.
      cerrojo.releaseLock();
    }
  }catch(err){ logMarcar_('error', String(err)); return json({ok:false, error:String(err)}); }
  finally{ logEscribir_(); }
}

/* ---------- CUADRILLAS: usuario -> cuadrillas que le corresponde reportar ---------- */
// alejo/alejandro: mismo capataz, dos nombres (login histórico = 'alejo'; la cuadrilla ALEJANDRO en
// CUADRILLAS puede llevar 'alejandro'). Se tratan como alias para que el match no dependa de cuál
// se haya usado (nota del prompt §3).
function usuarioAliases(u){
  if(u==='alejo' || u==='alejandro') return ['alejo','alejandro'];
  return [u];
}
function cuadrillasDeUsuario(usuario){
  const u=norm(usuario);
  // D84: las cuadrillas inactivas salen de circulación (no se ofrecen para reportar/seleccionar).
  const todas=readSheet('CUADRILLAS', CUADRILLAS_HEADERS).filter(cuadrillaActiva);
  if(u==='admin') return todas.map(r=>r.cuadrilla); // admin elige cuadrilla (§3)
  // D88: `duvan` reporta la asistencia de TODA su área — igual que el admin (elige la cuadrilla en el
  // formulario), pero acotado a ODT+ODL por `areasDeUsuario`. No va por la columna `responsables`:
  // reporta por todos los capataces de drenajes, sea o no responsable de la cuadrilla.
  // D105: además tiene su PROPIA cuadrilla `DUVAN` (`area=odt`, responsable `duvan`) para la gente que
  // no cuelga de un capataz — el equivalente de `OPERADORES` para `jeisson`. Es solo una fila más en la
  // hoja CUADRILLAS: esta rama ya la devuelve por área (y la de `responsables` también la encontraría),
  // así que no hay nada que codificar. La gente la asigna él desde la gestión de personal del resumen.
  // D101: `residente_uf3` usa EXACTAMENTE la misma rama (acotada a `uf3` por areasDeUsuario). Hoy
  // ninguna cuadrilla de UF3 tiene capataz con login, así que ella reporta por todas. El día que los
  // haya, se agregan a `responsables` y los dos canales coexisten (el envío pisa fecha+cuadrilla, D03)
  // sin tocar una línea de código.
  // D119: `angie` entra en ESTA MISMA rama con sus tres áreas (tierras+ODT+ODL). Es el primer usuario
  // que mezcla tierras y drenajes en un solo selector; el `norm(r.area)||'tierras'` de aquí abajo ya
  // resuelve el caso de las cuadrillas de tierras cargadas con la columna `area` VACÍA (ANGEL,
  // ROBINSON, OPERADORES…), que sin esa normalización no le aparecerían ninguna.
  if(u==='duvan' || u==='residente_uf3' || u==='angie'){
    const suyas=areasDeUsuario(u);
    return todas.filter(r=> suyas.indexOf(norm(r.area)||'tierras')>=0).map(r=>r.cuadrilla);
  }
  const alias=usuarioAliases(u);
  return todas.filter(r=>{
    const lista=String(r.responsables||'').split(',').map(norm);
    return alias.some(a=>lista.indexOf(a)>=0);
  }).map(r=>r.cuadrilla);
}

/* ---------- GET roster: arma el formulario del responsable en una sola llamada ---------- */
function roster(e){
  const usuario=e.parameter.usuario||'';
  const cuadrillas=cuadrillasDeUsuario(usuario);
  const cfg=getConfigMap();
  const festivos=getFestivos();
  // D106: el roster es de solo lectura y abre el formulario del capataz, así que aquí NO se corta la
  // respuesta — una fecha inválida cae al día de hoy (mismo respaldo que ya existía para la ausente).
  const fecha=fdateValida_(e.parameter.fecha) || Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd');
  const personalTodo=readSheet('PERSONAL', PERSONAL_HEADERS);
  // D72: roster date-aware — solo quien ya había ingresado y no estaba retirado a esa fecha.
  // D85: los eventuales no salen en el formulario del responsable (se marcan desde el resumen).
  // D118: deduplicado por persona. Si PERSONAL trae dos filas activas de la misma persona, el formulario
  // se la mostraba DOS veces al responsable y un solo envío escribía dos filas en ASISTENCIA — con horas
  // duplicadas en el Parte. Es la causa raíz de los reportes repetidos de ODT (ago-2026).
  const personas=unicasPorPersona_(personalTodo.filter(p=> activaEnFecha(p, fecha) && !esEventual(p) && cuadrillas.indexOf(p.cuadrilla)>=0))
    .map(p=>({ cedula:p.cedula||'', codigo:p.codigo||'', nombre:p.nombre||'', cargo:p.cargo||'', cuadrilla:p.cuadrilla||'' }));
  const jornada=jornadaDelDia(fecha, cfg, festivos);
  // D72: se excluye el CC de supervisión del encargado/capataz del picker de bloques (confunde al reportar).
  const catCC=sinCCexcluidos(readSheet('CAT_CC', CAT_CC_HEADERS).map(r=>String(r.string_cc||'')).filter(Boolean));
  // D72: CC frecuentes del área del reportante. D88: si el usuario tiene áreas FORZADAS por su rol
  // (residente/jeisson=tierras, residente_odt/odl, residente_dren y duvan=odt+odl) mandan esas; si no
  // (capataces, mairy, admin) se deriva de sus cuadrillas como hasta ahora.
  const areasRep=areasDeUsuario(usuario);
  const catCCUsados=ccUsadosParaArea(areasRep.length ? areasRep : areaDeReportante(usuario));
  const catMotivos=motivosUsados();   // D78: el responsable ve solo los motivos frecuentes (fallback: todos)
  // CC usados recientemente por cada cuadrilla (últimos 60 días de ASISTENCIA), más reciente primero.
  const recientesCC={};
  cuadrillas.forEach(c=>{ recientesCC[c]=[]; });
  // D102: este cruce mira TODO el histórico a propósito (el CC más reciente de una cuadrilla puede ser
  // de hace meses), así que NO se acota por fecha: acotarlo cambiaría el resultado. Sí se acota por
  // COLUMNAS — solo usa timestamp(2), cuadrilla(5) y cc(10), que caben en el bloque contiguo 2–10 =
  // 9 de 17 columnas. Mismas filas, mismo orden, mismos campos ⇒ mismo resultado, ~47 % menos celdas.
  const asis=leerColumnasDeHoja_('ASISTENCIA', 2, 10)
    .filter(r=> r.cc && cuadrillas.indexOf(r.cuadrilla)>=0)
    .sort((a,b)=> String(b.timestamp)<String(a.timestamp) ? -1 : 1);
  asis.forEach(r=>{
    const list=recientesCC[r.cuadrilla]; if(!list) return;
    if(list.indexOf(r.cc)<0 && list.length<10) list.push(r.cc);
  });
  // D72: turnos asignados (para pre-llenar entrada/salida en el formulario). Horas por duck-typing.
  const turnos=readSheet('TURNOS', TURNOS_HEADERS).map(t=>({ turno:String(t.turno||''), tipo_dia:norm(t.tipo_dia),
    entrada:ftime(t.entrada), salida:ftime(t.salida), descanso_ini:ftime(t.descanso_ini), descanso_fin:ftime(t.descanso_fin),
    cruza_medianoche: String(t.cruza_medianoche||'').toUpperCase()==='SI' }));
  // D101: `areas` = las áreas FORZADAS por el rol de quien reporta ([] = sin área forzada: capataces,
  // chequeadoras, mairy, admin). El formulario la necesita para NO caer al catálogo global `catCC`
  // —que es de tierras— cuando el área todavía no tiene sus CC cargados en CC_USADOS. Sin esto, la
  // residente de UF3 veía el selector con UF1/UF2 y a sus capataces les salía el CC con prefijo 3701.
  // D119: área de CADA cuadrilla ofrecida, para que el `<select>` del formulario pueda etiquetarlas
  // (`ANGEL — Tierras` / `JAIRO — ODL`). Hasta ahora nadie mezclaba tierras y drenajes, así que la lista
  // plana bastaba; `angie` ve ~10 cuadrillas con nombre de persona de tres áreas distintas y sin la
  // etiqueta un error de tecleo es cuestión de tiempo. Campo ADITIVO: quien no lo lea sigue igual.
  const cuadArea=areaDeCuadrillaMap(), cuadrillasArea={};
  cuadrillas.forEach(function(c){ cuadrillasArea[c]=cuadArea[c]||'tierras'; });
  return json({ ok:true, cuadrillas, cuadrillasArea, personas, config:cfg, festivos, jornada, catCC, catCCUsados, catMotivos, recientesCC, turnos,
    areas:areasDeUsuario(usuario) });
}

/* ---------- GET asistencia: resumen del día para el residente/jeisson ---------- */
function asistenciaDia(e){
  // D106: sin fecha válida NO se contesta. Antes, `fecha=''` hacía que el lector por rango devolviera
  // justo las filas con la fecha en blanco (`f>='' && f<=''` solo se cumple con `f===''`): el resumen
  // mostraba las huérfanas como si fueran el día pedido y "Completar faltantes" las reescribía otra
  // vez sin fecha. Cortar aquí es lo que rompe ese círculo.
  const fecha=fdateValida_(e.parameter.fecha);
  if(!fecha) return json({ok:false, error:'Falta la fecha del resumen (o llegó con un formato que no se entiende). Elige el día en el campo "Fecha".'});
  // D72/D74b/D84: se limita todo (filas, cuadrillas, faltantes) a las áreas del usuario (tierras/odt/odl,
  // o ambas para residente_dren); el admin ve todas o filtra por &area=. Un residente de área/tierras no
  // puede burlar su alcance.
  const areas=areasEfectivas(e);
  const cuadArea=areaDeCuadrillaMap();
  const enArea=function(cuadrilla){ return cuadrillaEnAreas(cuadrilla, areas, cuadArea); };
  // Las filas YA reportadas NO se filtran por estado de la cuadrilla (D84): una cuadrilla inactivada
  // hoy debe seguir mostrando sus filas de fechas anteriores. El filtro de inactivas aplica solo al
  // ROSTER ESPERADO (cuadrillasCat / personalActivo → estado y faltantes).
  // D102: lectura ACOTADA al día (escaneo de la columna `fecha` + solo los bloques de filas de ese día).
  // El helper cae solo a la lectura completa de siempre si la hoja es chica o el día quedó demasiado
  // fragmentado, así que el filtro por fecha ya viene aplicado y este `filter` solo mira el área.
  const filas=leerFilasPorFecha_('ASISTENCIA', fecha, fecha).filter(r=> enArea(r.cuadrilla))
    // D122: `_row` (número de fila REAL en la hoja) viaja al frontend. No es decorativo: cuando el
    // resumen marca a alguien duplicado y en la hoja "solo aparece una vez", la discusión se resuelve
    // yendo a la fila exacta — buscar por código falla si una de las dos filas lo tiene vacío, guardado
    // como número, o si un filtro de fecha la deja escondida (la columna `fecha` puede ser texto en unas
    // filas y Date en otras, y un filtro por texto no las ve todas). Los dos lectores ya lo calculan
    // (`readSheet` y `leerFilasPorFecha_`); solo faltaba no perderlo en este `map`.
    .map(r=>({ _row:r._row, id_registro:r.id_registro, timestamp:r.timestamp, fecha:fdate(r.fecha), reporta:r.reporta,
      cuadrilla:r.cuadrilla, codigo:r.codigo, cedula:r.cedula, nombre:r.nombre, cargo:r.cargo, cc:r.cc,
      proyecto:r.proyecto, hora_entrada:ftime(r.hora_entrada), hora_salida:ftime(r.hora_salida),
      presente:r.presente, motivo_ausencia:r.motivo_ausencia, observacion:r.observacion, turno:String(r.turno||'') }));
  // D84: la lista de cuadrillas del resumen incluye las ACTIVAS (roster de hoy) MÁS cualquier inactiva
  // que TENGA filas reportadas en esa fecha — así una cuadrilla desactivada hoy sigue mostrando su
  // detalle (y su estado "reportó") en fechas anteriores, sin ensuciar el roster de hoy (el filtro de
  // inactivas aplica al roster esperado, no a lo ya reportado).
  const cuadConFilas={}; filas.forEach(f=>{ cuadConFilas[f.cuadrilla]=true; });
  const cuadrillasCat=readSheet('CUADRILLAS', CUADRILLAS_HEADERS).filter(cq=>enArea(cq.cuadrilla) && (cuadrillaActiva(cq) || cuadConFilas[cq.cuadrilla]));
  // D72: roster date-aware + por área — "se esperaba" a esta persona en ESA fecha (no la foto de hoy).
  // D84: excluye a la gente de cuadrillas inactivas del roster esperado (no de las filas reportadas).
  // D85: excluye a los eventuales del roster esperado (nunca cuentan como faltantes/sin-reportar).
  const inactivas=cuadrillasInactivasSet();
  const personalTodo=readSheet('PERSONAL', PERSONAL_HEADERS);
  // D118: mismo deduplicado que el roster. Sin él, una persona con dos filas en PERSONAL salía DOS veces
  // en `faltantes` y el resumen la contaba dos veces como ausente o como sin-reportar.
  const personalActivo=unicasPorPersona_(personalTodo.filter(p=>activaEnFecha(p, fecha) && !esEventual(p) && enArea(p.cuadrilla) && !inactivas[p.cuadrilla]));
  // D85: personal eventual del área revisada — disponible en "Completar faltantes" del resumen (para
  // marcarlo presente los dom/fest u ocasiones puntuales) SIN aparecer como faltante. El frontend lo
  // ofrece solo si aún no tiene fila reportada ese día.
  const eventuales=personalTodo.filter(p=>esEventual(p) && activaEnFecha(p, fecha) && enArea(p.cuadrilla))
    .map(p=>({ codigo:p.codigo||'', cedula:p.cedula||'', nombre:p.nombre||'', cargo:p.cargo||'', cuadrilla:p.cuadrilla||'' }));
  // Una fila cuenta como REPORTE COMPLETO solo si: ausente con motivo, o presente CON centro de costo.
  // Presente SIN CC (el capataz la dejó pasar sin actividad) = como si NO se hubiera reportado
  // (decisión del residente, jul-2026): NO cuenta presente y va a faltantes para completarla.
  function filaValida(f){ return f.presente==='No' || (f.presente==='Si' && !!String(f.cc||'').trim()); }
  const codigosReportados={}, incompletos={};
  filas.forEach(f=>{
    const k=f.codigo||('CED:'+f.cedula);
    if(filaValida(f)) codigosReportados[k]=f;
    else if(f.presente==='Si') incompletos[k]=f;   // presente sin CC = incompleto (no reportado)
  });

  const cuadrillasEstado=cuadrillasCat.map(cq=>{
    const filasCuad=filas.filter(f=>f.cuadrilla===cq.cuadrilla && filaValida(f));
    return {
      cuadrilla:cq.cuadrilla, responsables:cq.responsables||'',
      reporto: filasCuad.length>0,
      reporta: filasCuad.length? filasCuad[0].reporta : '',
      hora: filasCuad.length? filasCuad[0].timestamp : '',
      total: filasCuad.length
    };
  });

  const faltantes=[];
  personalActivo.forEach(p=>{
    const k=p.codigo||('CED:'+p.cedula);
    const reg=codigosReportados[k];
    if(reg){
      if(reg.presente==='No'){
        faltantes.push({ codigo:p.codigo||'', cedula:p.cedula||'', nombre:p.nombre||'', cargo:p.cargo||'',
          cuadrilla:p.cuadrilla||'', responsable:p.responsable||'', tipo:'ausente', motivo:reg.motivo_ausencia||'' });
      }
      // presente CON CC = reportado OK, no es faltante
    } else {
      // sin fila válida: nunca reportó, o quedó presente sin CC (incompleto). Ambos = por completar.
      faltantes.push({ codigo:p.codigo||'', cedula:p.cedula||'', nombre:p.nombre||'', cargo:p.cargo||'',
        cuadrilla:p.cuadrilla||'', responsable:p.responsable||'', tipo:'sin_reportar', incompleto: !!incompletos[k] });
    }
  });

  // Catálogos para la mini-interfaz de "completar faltantes" del residente/jeisson (CC, motivos,
  // jornada por defecto del día). Así el resumen puede armar el formulario rápido sin otra llamada.
  const cfg=getConfigMap();
  const festivos=getFestivos();
  const jornada=jornadaDelDia(fecha, cfg, festivos);
  // D78: quien accede al RESUMEN ve los catálogos COMPLETOS — todos los CC (catCC, sin exclusiones)
  // y todos los motivos de ausencia (CAT_MOTIVOS completo) — para poder registrar uno especial.
  // catCCUsados sigue siendo el subconjunto frecuente del área revisada: el frontend lo muestra primero.
  const catCC=readSheet('CAT_CC', CAT_CC_HEADERS).map(r=>String(r.string_cc||'')).filter(Boolean);
  /* D133 (1 y 2) — EL CATÁLOGO DE CC ERA EL 56 % DE LA RESPUESTA. Medido en campo con la consola:
   * de 112,5 KB, `catCC` pesaba 33,4 (751 ítems) y `catCCUsados` 30,0 (495) — y los 495 eran los MISMOS
   * strings largos que ya iban en `catCC`, repetidos literalmente en la misma respuesta. A los ~6,5 KB/s
   * de la red de obra eso son ~10 s por carga tirados en mandar dos veces algo que además no cambia.
   *   (1) `catCCUsados` viaja como ÍNDICES dentro de `catCC` (números). 495 números ≈ 2 KB en vez de 30.
   *       Un CC de CC_USADOS que no esté en CAT_CC (typo al pegarlo) viaja como string, así que la lista
   *       nunca pierde elementos por esto.
   *   (2) `catCC` deja de viajar cuando el cliente ya lo tiene. Cada respuesta lleva `catCCv`, la firma
   *       del catálogo; el cliente la devuelve en `&ccv=` y, si coincide, la clave `catCC` NO se manda.
   *       Se corrige solo: basta con editar CAT_CC en el Sheet para que la firma cambie y se reenvíe.
   * Compatibilidad: un frontend viejo que no mande `&ccv=` recibe `catCC` entero, como siempre. Lo que
   * NO tolera un frontend viejo son los índices de (1) — por eso el orden de despliegue es primero la
   * página (que acepta las dos formas) y después el Apps Script. */
  const catCCv=firmaLista_(catCC);
  const posCC={}; catCC.forEach(function(s,i){ posCC[s]=i; });
  // D72/D84: CC frecuentes del área revisada. D88: con varias áreas (residente_dren/duvan) se pasan
  // TODAS las suyas (antes caía en '' y mezclaba tierras); sin filtro (admin) sigue mostrando todos.
  const catCCUsados=ccUsadosParaArea(areas).map(function(s){
    return posCC.hasOwnProperty(s) ? posCC[s] : s;
  });
  const catMotivos=motivosCatalogo();
  const turnos=readSheet('TURNOS', TURNOS_HEADERS).map(t=>({ turno:String(t.turno||''), tipo_dia:norm(t.tipo_dia),
    entrada:ftime(t.entrada), salida:ftime(t.salida), descanso_ini:ftime(t.descanso_ini), descanso_fin:ftime(t.descanso_fin),
    cruza_medianoche: String(t.cruza_medianoche||'').toUpperCase()==='SI' }));
  // D73/D84: indicador de extras del admin del día. Son CC de TIERRAS: se muestran solo si la vista
  // incluye tierras (residente/jeisson) o no filtra (admin). ODT/ODL y residente_dren NO las ven.
  const verExtras = !areas.length || areas.indexOf('tierras')>=0;
  const extrasAdmin = verExtras ? extrasAdminDelDia(fecha) : [];
  const notas = notasDelDia(fecha).filter(n=>enArea(n.cuadrilla));   // D74: notas del día del área revisada
  // D76: config + festivos también en el resumen, para que el detalle por cuadrilla clasifique ordinarias/
  // extras EXACTO como el Parte de Navision (mismo clasificarHoras que el export), sin otra llamada.
  // D101: `areas` (las forzadas por el rol; [] = admin sin filtro) para que el resumen no ofrezca los
  // proyectos ni los CC de otra área cuando CC_USADOS del área revisada aún está vacía.
  /* D133 (3a) — tres campos que NADIE lee. `id_registro`, `timestamp` y `observacion` no aparecen ni
   * una sola vez en `resumen-asistencia.html` (es la única pantalla que consume este endpoint), y
   * `guardarDetalle` arma su envío campo por campo en vez de reenviar la fila, así que quitarlos no
   * puede cambiar lo que se guarda. Son ~106 bytes por persona —un UUID de 36 caracteres y una fecha
   * ISO completa— = el 25 % de lo que pesa `filas`: ~5 KB en un día flojo y ~26 KB en uno completo.
   * `timestamp` se sigue usando AQUÍ (la hora del reporte de cada cuadrilla, más arriba); lo que se
   * quita es mandarlo repetido en cada fila. */
  const filasLigeras=filas.map(function(f){
    return { _row:f._row, fecha:f.fecha, reporta:f.reporta, cuadrilla:f.cuadrilla, codigo:f.codigo,
      cedula:f.cedula, nombre:f.nombre, cargo:f.cargo, cc:f.cc, proyecto:f.proyecto,
      hora_entrada:f.hora_entrada, hora_salida:f.hora_salida, presente:f.presente,
      motivo_ausencia:f.motivo_ausencia, turno:f.turno };
  });
  /* D133d (3b) — LAS ETIQUETAS PESABAN MÁS QUE LOS DATOS. Medido en un día bien reportado (6-ago, 153
   * personas): `filas` = 50,2 KB de los 66,7 totales, a 336 bytes por fila… de los cuales ~168 son los
   * NOMBRES de los campos (`"hora_entrada":`, `"motivo_ausencia":`…) repetidos en cada persona. La
   * mitad de la carga útil más pesada de la pantalla eran etiquetas.
   * Se manda la cabecera UNA vez y las filas como listas de valores. Ahorro: ~26 KB en un día completo
   * (66,7 → ~40), que a los 2,4 KB/s que llegó a marcar esa red son 11 segundos.
   * Se aplica solo a las dos listas largas (`filas`, `faltantes`). El resto se queda como está: en una
   * lista de 10 turnos esto no ahorra nada y solo la haría más difícil de leer.
   * EL RIESGO, y cómo se cierra: si la reconstrucción fallara devolvería campos VACÍOS, que se leen
   * como "no lo reportaron" y acabarían en el Parte de Navision. Por eso viaja `cols` y el cliente
   * COMPARA su longitud contra cada fila: si no cuadran, la pantalla falla a la vista en vez de pintar
   * huecos. Un fallo ruidoso se arregla; uno silencioso se paga en la nómina. */
  const COLS_FILAS=['_row','fecha','reporta','cuadrilla','codigo','cedula','nombre','cargo','cc','proyecto',
    'hora_entrada','hora_salida','presente','motivo_ausencia','turno'];
  const COLS_FALTANTES=['codigo','cedula','nombre','cargo','cuadrilla','responsable','tipo','motivo','incompleto'];
  const resp={ ok:true, fecha, filas:compactar_(filasLigeras, COLS_FILAS), cuadrillas:cuadrillasEstado,
    faltantes:compactar_(faltantes, COLS_FALTANTES), eventuales, jornada, catCC, catCCv, catCCUsados,
    catMotivos, turnos, extrasAdmin, notas, config:cfg, festivos, areas };
  // D133 (2): el cliente ya tiene esta misma versión del catálogo -> no se manda.
  if(String(e.parameter.ccv||'') === catCCv) delete resp.catCC;
  return json(resp);
}
/* D133 — firma barata y ESTABLE de una lista de strings, para saber si el catálogo que tiene el cliente
 * sigue siendo el del Sheet. No es criptográfica y no lo necesita: solo tiene que cambiar cuando cambie
 * el contenido. Se incluyen el nº de elementos y la longitud total además del hash porque son gratis y
 * hacen inverosímil la colisión; el hash posicional (×31) distingue además el REORDEN, que con solo
 * contar y sumar longitudes pasaría desapercibido. Coste medido a ojo: ~50.000 iteraciones con 751 CC,
 * despreciable frente a lo que cuesta leer el Sheet. */
/* D133d — lista de objetos -> cabecera + filas de valores. Las columnas se pasan explícitas (no se
 * deducen del primer objeto): `faltantes` mezcla dos formas —los ausentes traen `motivo` y los
 * sin-reportar `incompleto`—, así que deducirlas de una fila cualquiera perdería la columna de la otra.
 * Lo ausente en un objeto viaja como `null` y el cliente lo devuelve a `''`. */
function compactar_(lista, cols){
  return { cols: cols, datos: lista.map(function(o){
    return cols.map(function(c){ const v=o[c]; return v===undefined ? null : v; });
  }) };
}
function firmaLista_(arr){
  var n=arr.length, len=0, h=0;
  for(var i=0;i<n;i++){
    var s=String(arr[i]); len+=s.length;
    for(var j=0;j<s.length;j++) h=(h*31 + s.charCodeAt(j)) % 2147483647;
  }
  return n+'-'+len+'-'+h;
}

/* ---------- POST asistencia_individual: upsert por PERSONA (residente/jeisson completan faltantes) ----------
 * A diferencia de reporte_asistencia (que PISA toda la cuadrilla, D03), este upsert toca SOLO las
 * personas que llegan en `filas`: borra la fila de ESE día de cada persona entrante (si existía) y
 * la reescribe. Así el residente/jeisson pueden agregar faltantes o corregir un presente-sin-CC sin
 * borrar lo que ya reportó el responsable. Permitido a residente, admin y jeisson. */
function guardarIndividual(body){
  const usuario=norm(body.usuario);
  // D72/D84: los residentes de área (odt/odl) y el unificado (residente_dren) también completan faltantes.
  // D88: `duvan` (asistencias de drenajes) igual, acotado a ODT+ODL por areasDeUsuario.
  // D101: `residente_uf3` completa los faltantes de UF3 (acotado a ['uf3'] por areasDeUsuario).
  // D119: `angie` igual, acotada a tierras+ODT+ODL. El cerrojo de área de más abajo
  // (`cuadrillaPermitidaPara`) es el que le impide tocar una cuadrilla de UF3.
  if(['residente','admin','jeisson','duvan','residente_uf3','angie','residente_odt','residente_odl','residente_dren'].indexOf(usuario)<0)
    return json({ok:false, error:'No autorizado para completar faltantes.'});
  // D106: portero de fecha ANTES de tocar la hoja. Con la fecha vacía este upsert no solo escribía
  // filas huérfanas: su filtro de abajo (`fdate(r[2])===fecha`) borraba las huérfanas que ya hubiera.
  const fecha=fdateValida_(body.fecha), ts=new Date();
  if(!fecha) return json({ok:false, error:ERROR_FECHA});
  // D101: mismo cerrojo de área que reporte_asistencia — el "completar faltantes" tampoco puede tocar
  // cuadrillas de otra área (D69h). Se valida cada fila porque este upsert es por persona.
  const ajena=(body.filas||[]).map(f=>String(f.cuadrilla||'')).filter(function(c,i,a){ return a.indexOf(c)===i; })
    .filter(function(c){ return !cuadrillaPermitidaPara(usuario, c); });
  if(ajena.length) return json({ok:false, error:'Esa cuadrilla no es de tu área: '+ajena.join(', ')});
  const sh=getSheet('ASISTENCIA', ASISTENCIA_HEADERS), need=ASISTENCIA_HEADERS.length;
  /* D119 — LA EDICIÓN NUNCA DEBE AÑADIR UNA FILA NUEVA. Este upsert borraba la fila vieja buscándola con
   * una clave de precedencia EXCLUSIVA (código; y solo si no había código, cédula). Si el mismo humano
   * estaba guardado con el código vacío y la edición traía el código —o al revés, o con un cero a la
   * izquierda—, las dos claves no coincidían: el borrado no encontraba nada y `anexarFilas_` agregaba la
   * fila igual. Resultado: corregirle la hora a alguien lo DUPLICABA en vez de reemplazarlo, y de ahí
   * salían las horas repetidas en el Parte de Navision. Reproducido en `backend/pruebas/`.
   *
   * Por qué las dos partes pueden no coincidir: la fila guardada trae el código que tenía PERSONAL
   * cuando el capataz reportó, mientras que "Completar faltantes" manda el que tiene PERSONAL AHORA. Si
   * entre medias se le llenó o corrigió el código a esa persona, la vieja y la nueva dejan de casar.
   *
   * D123 — CORRIGE LA REGLA DE D119, que emparejaba por «código O cédula» y era demasiado ancha.
   * En la obra hay DOS PERSONAS DISTINTAS con la misma cédula (error de digitación en PERSONAL:
   * 74270 FREDY MACHACON y 76358 ALEIXER LIZARAZO comparten la 91515627, ago-2026). Con la regla de
   * D119, editar a una de ellas BORRABA la fila de la otra: pérdida silenciosa de una asistencia real.
   *
   * La regla correcta respeta la jerarquía de los identificadores. El CÓDIGO manda: es el que usa
   * Navision (CAT_TRABAJADORES está indexado por él) y el que distingue a estas dos personas. La cédula
   * es solo un respaldo para cuando falta el código:
   *   · los dos tienen código  -> son la misma persona SOLO si el código coincide (la cédula no opina);
   *   · a uno le falta el código -> se cae a la cédula (el caso que D119 vino a arreglar);
   *   · no hay ninguno de los dos -> nombre+cuadrilla.
   * El código se compara NORMALIZADO (sin espacios ni ceros a la izquierda), así '076333' sigue casando
   * con '76333' sin necesidad de mirar la cédula. */
  /* D125 — el propio payload se deduplica antes de escribir. `guardarAsistencia` ya lo hacía (D119) y
   * este no: si "Completar faltantes" mandaba la misma persona dos veces (una pantalla vieja en caché,
   * un roster que aún venía duplicado, un doble toque), se escribían dos filas. El cerrojo del `doPost`
   * cubre las peticiones SIMULTÁNEAS; esto cubre la repetición DENTRO de una misma petición. */
  const incoming=unicasPorPersona_(body.filas||[]);
  const esDeLosEntrantes=emparejadorDePersonas_(incoming);
  const nuevas=incoming.map(f=>[
    Utilities.getUuid(), ts, fecha, body.reporta||usuario, f.cuadrilla||'', f.codigo||'', f.cedula||'', f.nombre||'', f.cargo||'',
    f.cc||'', f.proyecto||'', f.hora_entrada||'', f.hora_salida||'',
    (f.presente===false||f.presente==='No')?'No':'Si', f.motivo_ausencia||'', f.observacion||'', f.turno||''
  ]);
  // D107: se borra la fila de ESE día SOLO de las personas entrantes y se anexan las nuevas al final.
  // Se decide leyendo 5 columnas (fecha·codigo·cedula caen en el bloque 3–7) en vez de las 17.
  // D119: el predicado ahora empareja por código O por cédula (ver arriba), no por una clave única.
  // `nombre` y `cuadrilla` entran al bloque leído (cols 3–8 en vez de 3–7) para el respaldo de arriba:
  // una columna más, muy lejos de las 17 que se leían antes de D107.
  const aBorrar=localizarFilas_(sh, ASISTENCIA_HEADERS, ['fecha','cuadrilla','codigo','cedula','nombre'], function(o){
    return fdate(o.fecha)===fecha && esDeLosEntrantes(o);
  });
  /* D129 — SE SOBRESCRIBE EN SITIO; anexar es solo el último recurso.
   *
   * El dueño reportó (ago-2026) que editar seguía AÑADIENDO aunque la respuesta dijera
   * `reemplazadas: 8`. Ese número sale de `aBorrar`, o sea de las filas ENCONTRADAS: prueba que el
   * emparejamiento acierta y que lo que no surte efecto es el `deleteRows` sobre esa hoja (que en el
   * Sheet real es una TABLA de Google, no un rango suelto). Con la secuencia anterior —borrar y luego
   * anexar— un borrado que no se aplica deja las filas viejas Y añade la nueva: el error crece con cada
   * intento de arreglarlo, que es exactamente lo que estaba pasando.
   *
   * La secuencia nueva no puede crecer aunque el borrado falle:
   *   1. las filas nuevas se ESCRIBEN ENCIMA de las que ya ocupaban esas posiciones (`setValues`);
   *   2. solo se borran las posiciones SOBRANTES (las que no recibieron fila);
   *   3. y solo se anexa lo que no cupo, cuando llegan más filas de las que había.
   * En el caso corriente —una persona, una fila previa— no se borra ni se anexa nada: se pisa la fila
   * y punto. Con 8 filas previas y 1 entrante, la 1 se escribe en la primera posición y las otras 7 se
   * borran; si ese borrado volviera a fallar, el peor resultado es que queden las 7 viejas, nunca 9.
   *
   * Las posiciones se recorren de menor a mayor para que el orden de la hoja no cambie. */
  const posiciones=aBorrar.slice().sort(function(a,b){ return a-b; });
  const enSitio=Math.min(posiciones.length, nuevas.length);
  for(let i=0;i<enSitio;i++) sh.getRange(posiciones[i], 1, 1, need).setValues([nuevas[i]]);
  const sobrantes=posiciones.slice(enSitio);          // filas viejas que ya no hacen falta
  if(sobrantes.length) borrarFilas_(sh, sobrantes);
  const porAnexar=nuevas.slice(enSitio);              // filas nuevas que no encontraron sitio
  if(porAnexar.length) anexarFilas_(sh, porAnexar, need);
  invalidarHoja_('ASISTENCIA');   // D99: la memoria de esta ejecución ya no refleja la hoja
  /* `reemplazadas` deja ver que la edición SUSTITUYÓ y no añadió. Con 1 fila entrante, un 0 aquí
   * significa que la persona no estaba en el día (alta legítima desde "Completar faltantes"); un 2+
   * significa que venía duplicada de antes y esta operación la dejó en una sola.
   * D129 desglosa además qué se hizo con cada fila, para no volver a depender de conjeturas cuando algo
   * no cuadre: `pisadas` + `borradas` + `anexadas` explican el resultado entero. */
  return json({ok:true, filas:nuevas.length, reemplazadas:aBorrar.length,
    pisadas:enSitio, borradas:sobrantes.length, anexadas:porAnexar.length});
}

/* ---------- GET personal: gestión (residente general/admin ven todo; residente_odt/odl SOLO su área — D72) ---------- */
function personalCompleto(e){
  // D72/D84: residente/jeisson=tierras, odt/odl su área, residente_dren=ambas, admin todo o filtra por &area=
  const areas=areasEfectivas(e);
  const cuadArea=areaDeCuadrillaMap();
  const enArea=function(c){ return cuadrillaEnAreas(c, areas, cuadArea); };
  const personal=readSheet('PERSONAL', PERSONAL_HEADERS).filter(p=>enArea(p.cuadrilla)).map(p=>({ _row:p._row, cedula:p.cedula||'', codigo:p.codigo||'',
    nombre:p.nombre||'', cargo:p.cargo||'', cuadrilla:p.cuadrilla||'', responsable:p.responsable||'',
    estado:p.estado||'activo', fecha_retiro:fdate(p.fecha_retiro), fecha_ingreso:fdate(p.fecha_ingreso) }));
  // D84: los SELECTORES de cuadrilla (destinos de alta/mover) excluyen las inactivas.
  const cuadrillas=readSheet('CUADRILLAS', CUADRILLAS_HEADERS).filter(c=>enArea(c.cuadrilla) && cuadrillaActiva(c)).map(c=>({ cuadrilla:c.cuadrilla||'', responsables:c.responsables||'' }));
  return json({ ok:true, personal, cuadrillas });
}

/* ---------- GET export: crudo del día completo para el generador Navision (cliente, SheetJS) ---------- */
function exportDia(e){
  // D106: igual que `asistenciaDia` — un Parte de Navision armado sobre las filas sin fecha sería un
  // archivo con gente de días revueltos. Mejor no entregar nada y decir por qué.
  const fecha=fdateValida_(e.parameter.fecha);
  if(!fecha) return json({ok:false, error:'Falta la fecha del día a exportar (o llegó con un formato que no se entiende). Elige el día en el campo "Fecha".'});
  // D72/D74b/D84: residente(tierras)/residente_odt/odl exportan SOLO su área; residente_dren exporta
  // ODT+ODL en un SOLO archivo (el Parte se arma por día×proyecto y los CC ya distinguen el capítulo,
  // así que mezclar áreas no requiere lógica extra); el admin todo o filtra por &area=. Las filas ya
  // reportadas NO se filtran por estado de cuadrilla (D84): una cuadrilla inactivada hoy sigue
  // exportando sus filas de fechas anteriores.
  const areas=areasEfectivas(e);
  const cuadArea=areaDeCuadrillaMap();
  const enArea=function(cuadrilla){ return cuadrillaEnAreas(cuadrilla, areas, cuadArea); };
  const filas=leerFilasPorFecha_('ASISTENCIA', fecha, fecha).filter(r=> enArea(r.cuadrilla))   // D102
    .map(r=>({ codigo:r.codigo||'', cedula:r.cedula||'', nombre:r.nombre||'', cargo:r.cargo||'',
      cuadrilla:r.cuadrilla||'', cc:r.cc||'', proyecto:String(r.proyecto||''),
      hora_entrada:ftime(r.hora_entrada), hora_salida:ftime(r.hora_salida),
      presente:r.presente||'Si', motivo_ausencia:r.motivo_ausencia||'', turno:String(r.turno||''), fecha:fdate(r.fecha) }));
  // proyecto_defecto por cuadrilla: proyecto MÁS FRECUENTE históricamente (para ausentes, que no llevan CC).
  // D102 / backlog 4.11: este cruce lee TODO el histórico y así se queda — es un agregado global, no se
  // puede acotar por fecha sin cambiar lo que devuelve, y D94/4.11 lo marcan como intocable. Lo que sí
  // se acota es el ANCHO: solo usa cuadrilla(5), proyecto(11) y presente(14), que caben en el bloque
  // contiguo 5–14 = 10 de 17 columnas. Mismas filas, mismos campos ⇒ mismo `proyectoDefecto`, ~41 % menos celdas.
  const historico=leerColumnasDeHoja_('ASISTENCIA', 5, 14).filter(r=> r.presente==='Si' && r.proyecto);
  const conteo={}; // cuadrilla -> {proyecto:n}
  historico.forEach(r=>{ const c=r.cuadrilla||''; conteo[c]=conteo[c]||{}; conteo[c][r.proyecto]=(conteo[c][r.proyecto]||0)+1; });
  const proyectoDefecto={};
  Object.keys(conteo).forEach(c=>{
    let best='', bestN=-1;
    Object.keys(conteo[c]).forEach(p=>{ if(conteo[c][p]>bestN){ bestN=conteo[c][p]; best=p; } });
    proyectoDefecto[c]=best;
  });
  const catTrabRows=readSheet('CAT_TRABAJADORES', CAT_TRABAJADORES_HEADERS);
  const catTrabajadores={}; catTrabRows.forEach(r=>{ if(r.codigo) catTrabajadores[String(r.codigo).trim()]=r.string_navision; });
  // D72: catálogo de turnos, para que el export calcule ordinarias/extras según la jornada programada.
  const turnos=readSheet('TURNOS', TURNOS_HEADERS).map(t=>({ turno:String(t.turno||''), tipo_dia:norm(t.tipo_dia),
    entrada:ftime(t.entrada), salida:ftime(t.salida), descanso_ini:ftime(t.descanso_ini), descanso_fin:ftime(t.descanso_fin),
    cruza_medianoche: String(t.cruza_medianoche||'').toUpperCase()==='SI' }));
  // EXTRAS_ADMIN (D73): registros del admin del día para que el generador Navision inyecte su fila por
  // día×proyecto. Son CC de TIERRAS (3701/3702): solo se incluyen si la vista abarca tierras (residente
  // general/admin); un residente de área (odt/odl) o el unificado (residente_dren) NO las reciben.
  const verExtras = !areas.length || areas.indexOf('tierras')>=0;
  const extrasAdmin = verExtras ? extrasAdminDelDia(fecha) : [];   // D74b/D84
  return json({ ok:true, fecha, filas, proyectoDefecto, catTrabajadores, config:getConfigMap(), festivos:getFestivos(), turnos, extrasAdmin });
}

/* ---------- GET ausencias: seguimiento de ausencias por RANGO de fechas (D94) ----------
 * Para el seguimiento del personal: "de tal fecha a tal fecha, quién faltó y por qué motivo".
 * Devuelve DOS listas, ambas ya acotadas al área del usuario (mismo criterio que el resumen del día):
 *   - `filas`       : ausencias REPORTADAS (presente='No'), con su motivo verbatim. Es lo que se filtra
 *                     por motivo en el frontend. Sin motivo escrito -> '(sin motivo)'.
 *   - `sinReportar` : días en que la CUADRILLA sí reportó pero a la persona no la incluyeron (ni presente
 *                     ni ausente). No es una ausencia confirmada, pero es un hueco de seguimiento; el
 *                     frontend lo suma solo si se pide (checkbox). Se excluyen los domingos/festivos
 *                     (D81: ese día trabaja solo el personal disponible, casi todos quedan sin reportar
 *                     por diseño) y los días en que la cuadrilla NO reportó nada (no se puede concluir).
 * Roster date-aware (D72) y eventuales fuera (D85), igual que los faltantes del día.
 * Solo lectura: no escribe nada. */
const MAX_DIAS_RANGO = 186;   // ~6 meses: tope defensivo para no reventar el tiempo de Apps Script

// Lista de fechas 'yyyy-MM-dd' entre desde y hasta (inclusive). Aritmética con Date local (Bogotá no
// tiene DST); el formateo es el mismo patrón de fdate, nunca toISOString (D50).
function diasDelRango(desde, hasta){
  const p=String(desde).split('-'), out=[];
  let d=new Date(Number(p[0]), Number(p[1])-1, Number(p[2])), guard=0;
  while(guard++ <= MAX_DIAS_RANGO+1){
    const s=d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
    if(s>hasta) break;
    out.push(s);
    d.setDate(d.getDate()+1);
  }
  return out;
}
// Clave de persona: código si lo tiene, si no la cédula (mismo criterio que faltantes/guardarIndividual).
function keyPersona(codigo, cedula){
  const c=String(codigo||'').trim();
  return c ? ('COD:'+c) : ('CED:'+String(cedula||'').trim());
}
function ausenciasRango(e){
  const desde=fdateValida_(e.parameter.desde), hasta=fdateValida_(e.parameter.hasta);   // D106
  if(!desde || !hasta) return json({ok:false, error:'Faltan las fechas del rango (desde/hasta), o llegaron con un formato que no se entiende.'});
  if(hasta < desde)    return json({ok:false, error:'El rango está invertido: "hasta" es anterior a "desde".'});
  const dias=diasDelRango(desde, hasta);
  if(dias.length > MAX_DIAS_RANGO) return json({ok:false, error:'Rango demasiado largo (máximo '+MAX_DIAS_RANGO+' días). Consulta por tramos.'});

  const areas=areasEfectivas(e);
  const cuadArea=areaDeCuadrillaMap();
  const enArea=function(c){ return cuadrillaEnAreas(c, areas, cuadArea); };

  // Filas del rango (todas las áreas del usuario). Las YA reportadas no se filtran por estado de
  // cuadrilla (D84): una cuadrilla inactivada hoy conserva su histórico.
  // D102: lectura acotada al RANGO. Con rangos de más de MAX_BLOQUES días el helper ni escanea: se va
  // derecho a la lectura completa de siempre (un rango largo cubre casi toda la hoja, no hay nada que
  // ganar). Es correcto que el fallback salte aquí seguido; el endpoint no se entera.
  const enRango=leerFilasPorFecha_('ASISTENCIA', desde, hasta).filter(function(r){
    return enArea(r.cuadrilla);
  });

  const filas=enRango.filter(r=> String(r.presente||'')==='No').map(r=>({
    fecha:fdate(r.fecha), codigo:String(r.codigo||''), cedula:String(r.cedula||''), nombre:String(r.nombre||''),
    cargo:String(r.cargo||''), cuadrilla:String(r.cuadrilla||''), reporta:String(r.reporta||''),
    motivo: String(r.motivo_ausencia||'').trim() || '(sin motivo)', tipo:'ausente'
  }));

  // Huecos: la cuadrilla reportó ese día pero la persona no salió en el reporte.
  const festivos=getFestivos();
  const repDia={}, cuadRepDia={};
  enRango.forEach(function(r){
    const f=fdate(r.fecha), c=String(r.cuadrilla||'');
    (repDia[f]=repDia[f]||{})[keyPersona(r.codigo, r.cedula)]=true;
    (cuadRepDia[f]=cuadRepDia[f]||{})[c]=true;
  });
  const inactivas=cuadrillasInactivasSet();
  const personal=readSheet('PERSONAL', PERSONAL_HEADERS)
    .filter(p=> !esEventual(p) && enArea(p.cuadrilla) && !inactivas[p.cuadrilla]);
  const sinReportar=[];
  dias.forEach(function(f){
    if(tipoJornada(f, festivos)==='domfest') return;          // D81: dom/fest no se reporta por roster
    const rep=repDia[f]||{}, cuadOk=cuadRepDia[f]||{};
    personal.forEach(function(p){
      if(!cuadOk[String(p.cuadrilla||'')]) return;             // la cuadrilla no reportó: nada que concluir
      if(!activaEnFecha(p, f)) return;                          // aún no ingresaba / ya estaba retirada
      if(rep[keyPersona(p.codigo, p.cedula)]) return;            // sí salió en el reporte de ese día
      sinReportar.push({ fecha:f, codigo:String(p.codigo||''), cedula:String(p.cedula||''), nombre:String(p.nombre||''),
        cargo:String(p.cargo||''), cuadrilla:String(p.cuadrilla||''), reporta:'', motivo:'(no reportado)', tipo:'sin_reportar' });
    });
  });

  return json({ ok:true, desde, hasta, dias:dias.length, filas, sinReportar, catMotivos:motivosCatalogo() });
}

/* ---------- GET persona: horas de UNA persona en un RANGO (D112) ----------
 * `?action=persona&codigo=&cedula=&desde=&hasta=` — **solo lectura, no escribe nada.**
 *
 * PARA QUÉ. Es la vista INVERSA del resumen: el resumen está armado por DÍA (un día × todas las
 * cuadrillas), así que para reconstruir el mes de una persona —lo que hace falta cuando alguien
 * reclama por lo que le pagaron— había que abrir 26 días uno por uno. Esto devuelve de una vez sus
 * filas del período.
 *
 * REGLA DE ORO: aquí NO se clasifican horas. Se devuelven las filas CRUDAS de `ASISTENCIA` más
 * `config`, `festivos` y `turnos`, igual que `exportDia`, y la clasificación la hace el cliente con el
 * MISMO `horas-nomina.js` que genera el Parte de Navision. Es lo que garantiza que la pantalla de
 * reclamos y el archivo que se importa a Navision no puedan discrepar: no hay dos cálculos.
 *
 * CERROJO DE ÁREA EN EL BACKEND (D69h/D109), no en la interfaz: la identidad sale del token firmado,
 * así que un `residente_dren` que teclee en la URL el código de alguien de tierras recibe `ok:false`,
 * no los datos. Para el HISTÓRICO manda la cuadrilla de cada FILA de ASISTENCIA, no solo la actual de
 * PERSONAL: si a alguien lo movieron de cuadrilla, el área de sus días pasados es la de cada fila.
 * Por eso: (1) cada fila se filtra por el área de SU cuadrilla; (2) el acceso se concede si la persona
 * es del área hoy (PERSONAL) o lo fue en alguna fila del rango; si no, se rechaza.
 */
function horasPersona(e){
  const desde=fdateValida_(e.parameter.desde), hasta=fdateValida_(e.parameter.hasta);   // D106
  if(!desde || !hasta) return json({ok:false, error:'Faltan las fechas del período (desde/hasta), o llegaron con un formato que no se entiende.'});
  if(hasta < desde)    return json({ok:false, error:'El período está invertido: "hasta" es anterior a "desde".'});
  const dias=diasDelRango(desde, hasta);
  if(dias.length > MAX_DIAS_RANGO) return json({ok:false, error:'Período demasiado largo (máximo '+MAX_DIAS_RANGO+' días). Consulta por tramos.'});

  // Identidad de la persona: `codigo` manda; si viene vacío, `cedula` (mismo criterio que keyPersona/
  // keyOf en el resto del módulo). No se mezclan: buscar por código y "además" por cédula podría traer
  // filas de otra persona cuando una de las dos columnas está vacía en el histórico.
  const codigo=String(e.parameter.codigo||'').trim();
  const cedula=String(e.parameter.cedula||'').trim();
  if(!codigo && !cedula) return json({ok:false, error:'Falta el código (o la cédula) de la persona.'});
  const esLaPersona=function(r){
    return codigo ? (String(r.codigo||'').trim()===codigo) : (String(r.cedula||'').trim()===cedula);
  };

  const areas=areasEfectivas(e);
  const cuadArea=areaDeCuadrillaMap();
  const enArea=function(c){ return cuadrillaEnAreas(c, areas, cuadArea); };

  // Ficha desde PERSONAL (la de hoy). Puede no existir: alguien reportado y luego borrado de PERSONAL
  // sigue teniendo histórico en ASISTENCIA, y ese histórico es justamente lo que se viene a consultar.
  const personal=readSheet('PERSONAL', PERSONAL_HEADERS).filter(esLaPersona);
  // Si hay varias filas (reingreso, D72: el reingreso crea fila NUEVA), manda la más reciente por
  // fecha_ingreso — es la que describe su situación actual.
  personal.sort(function(a,b){ return fdate(a.fecha_ingreso) < fdate(b.fecha_ingreso) ? -1 : 1; });
  const p=personal.length ? personal[personal.length-1] : null;

  // D102: lectura acotada al rango (escaneo de la columna `fecha` + solo los bloques de esos días; con
  // rangos largos el helper cae solo a la lectura completa de siempre). El filtro por persona va en
  // memoria: NADA de getDataRange() sobre la hoja entera.
  const enRango=leerFilasPorFecha_('ASISTENCIA', desde, hasta).filter(esLaPersona);

  // --- Cerrojo de área ---
  const deSuAreaHoy = p ? enArea(String(p.cuadrilla||'')) : false;
  const deSuAreaAntes = enRango.some(function(r){ return enArea(String(r.cuadrilla||'')); });
  if(areas.length && !deSuAreaHoy && !deSuAreaAntes){
    return json({ok:false, error:'Esa persona no es de tu área.'});
  }

  const filas=enRango.filter(function(r){ return enArea(String(r.cuadrilla||'')); })
    .map(function(r){
      return { fecha:fdate(r.fecha), reporta:String(r.reporta||''), cuadrilla:String(r.cuadrilla||''),
        codigo:String(r.codigo||''), cedula:String(r.cedula||''), nombre:String(r.nombre||''),
        cargo:String(r.cargo||''), cc:String(r.cc||''), proyecto:String(r.proyecto||''),
        hora_entrada:ftime(r.hora_entrada), hora_salida:ftime(r.hora_salida),
        presente:String(r.presente||'Si'), motivo_ausencia:String(r.motivo_ausencia||''),
        observacion:String(r.observacion||''), turno:String(r.turno||'') };
    })
    .sort(function(a,b){ return a.fecha<b.fecha ? -1 : (a.fecha>b.fecha ? 1 : 0); });

  // La ficha se arma con PERSONAL si existe; si no (histórico de alguien ya borrado), con lo que traen
  // sus propias filas, para que la pantalla no salga sin nombre.
  const ult = filas.length ? filas[filas.length-1] : null;
  const persona = p ? {
      codigo:String(p.codigo||''), cedula:String(p.cedula||''), nombre:String(p.nombre||''),
      cargo:String(p.cargo||''), cuadrilla:String(p.cuadrilla||''), estado:String(p.estado||'activo'),
      fecha_ingreso:fdate(p.fecha_ingreso), fecha_retiro:fdate(p.fecha_retiro), enPersonal:true
    } : (ult ? {
      codigo:ult.codigo, cedula:ult.cedula, nombre:ult.nombre, cargo:ult.cargo, cuadrilla:ult.cuadrilla,
      estado:'', fecha_ingreso:'', fecha_retiro:'', enPersonal:false
    } : null);
  if(!persona) return json({ok:false, error:'No se encontró a esa persona (ni en PERSONAL ni en lo reportado del período).'});

  // Mismos catálogos que `exportDia` para que el cliente clasifique IGUAL que el Parte: CONFIG (topes,
  // ventana nocturna, almuerzo), FESTIVOS (tipo de jornada) y TURNOS (jornada programada).
  return json({ ok:true, desde, hasta, dias:dias.length, persona, filas,
    config:getConfigMap(), festivos:getFestivos(),
    turnos: readSheet('TURNOS', TURNOS_HEADERS).map(function(t){
      return { turno:String(t.turno||''), tipo_dia:norm(t.tipo_dia), entrada:ftime(t.entrada), salida:ftime(t.salida),
        descanso_ini:ftime(t.descanso_ini), descanso_fin:ftime(t.descanso_fin),
        cruza_medianoche: String(t.cruza_medianoche||'').toUpperCase()==='SI' };
    }) });
}

/* ---------- GET persona_admin: las horas del PROPIO admin (D142) ----------
 * `?action=persona_admin&desde=&hasta=` — **solo lectura, no escribe nada.**
 *
 * POR QUÉ HACE FALTA. `?action=persona` (D112) reconstruye el período de una persona leyendo
 * `ASISTENCIA` + su ficha de `PERSONAL`. El admin no está en ninguna de las dos: por diseño de D73 su
 * jornada ordinaria va por fuera del sistema y solo registra sus horas EXTRA de días puntuales, que
 * viven aisladas en `EXTRAS_ADMIN`. Consecuencia observada por el dueño (ago-2026): la pantalla de
 * revisión de horas servía para todo el mundo menos para él — se buscaba a sí mismo y no aparecía,
 * porque no hay a quién buscar. Este endpoint es su equivalente, sobre la hoja que sí lo tiene.
 *
 * LA HOJA NO GUARDA HORARIO, guarda un TOTAL de horas y un TIPO (`diurna`/`nocturna`/`domfest`), así
 * que aquí no hay entrada/salida que devolver: el cliente reparte a columnas del Parte con
 * `clasificarExtraAdmin` de `horas-nomina.js` — el MISMO que usa `buildAdminExtraRow` al generar el
 * Excel de Navision (D112: una sola fuente, nunca dos copias). Por eso se devuelve `config`
 * (los topes) y `festivos`, igual que `?action=persona`.
 *
 * CERROJO: no es de área, es de PERSONA. `EXTRAS_ADMIN` es el canal privado del admin y ningún otro
 * rol lo ve (ni siquiera el residente: `exportDia` ya se lo entrega solo a quien exporta tierras,
 * D74b/D84). Aquí se exige `rol === 'admin'` **del token firmado** (`_rol`, puesto por `doGet`), no
 * del parámetro que mande el cliente. Un `residente` que teclee esta URL recibe `ok:false`.
 */
function horasAdmin(e){
  if(norm(e.parameter._rol)!=='admin'){
    return json({ok:false, error:'Estas horas son el canal propio del administrador (D73): solo él las consulta.'});
  }
  const desde=fdateValida_(e.parameter.desde), hasta=fdateValida_(e.parameter.hasta);   // D106
  if(!desde || !hasta) return json({ok:false, error:'Faltan las fechas del período (desde/hasta), o llegaron con un formato que no se entiende.'});
  if(hasta < desde)    return json({ok:false, error:'El período está invertido: "hasta" es anterior a "desde".'});
  const dias=diasDelRango(desde, hasta);
  if(dias.length > MAX_DIAS_RANGO) return json({ok:false, error:'Período demasiado largo (máximo '+MAX_DIAS_RANGO+' días). Consulta por tramos.'});

  /* `EXTRAS_ADMIN` es una hoja MINÚSCULA —una fila por día CON extra, no una por día— así que se lee
   * entera y se filtra en memoria: el lector acotado por fecha de D102 está pensado para `ASISTENCIA`
   * (miles de filas) y aquí no compraría nada. Nunca se cachea (D99): es de las tres hojas vivas. */
  const filas=readSheet('EXTRAS_ADMIN', EXTRAS_ADMIN_HEADERS)
    .map(function(r){
      return { fecha:fdate(r.fecha), cc:String(r.cc||''), proyecto:String(r.proyecto||''),
        horas:Number(r.horas)||0, tipo:norm(r.tipo), reporta:String(r.reporta||'') };
    })
    .filter(function(r){ return r.fecha && r.fecha>=desde && r.fecha<=hasta; })
    .sort(function(a,b){ return a.fecha<b.fecha ? -1 : (a.fecha>b.fecha ? 1 : 0); });

  const cfg=getConfigMap();
  return json({ ok:true, esAdmin:true, desde, hasta, dias:dias.length,
    persona:{ codigo:String(cfg.admin_recurso||''), cedula:'', nombre:String(e.parameter.usuario||'admin'),
      cargo:'Administrador', cuadrilla:'', estado:'', fecha_ingreso:'', fecha_retiro:'', enPersonal:false },
    filas, config:cfg, festivos:getFestivos() });
}

/* ---------- EXTRAS_ADMIN (D73): canal "solo extras" del admin ----------
 * El admin registra sus horas de días puntuales (máx 2h extra en día normal; máx 7h en dom/festivo, que
 * van a las ordinarias dom/fest col D del Parte). Aislado del roster: el admin NO
 * está en PERSONAL/CUADRILLAS/ASISTENCIA. Clave lógica = `fecha` (una fila por día; re-guardar pisa el día,
 * sin bandeja/staging). `proyecto` se deriva del `cc` (proyectoFromCC, misma regla D63 del resto del módulo).
 * Fechas por duck-typing al leer/comparar (fdate), nunca instanceof Date (D31). */
function extrasAdminDelDia(fecha){
  const f=fdate(fecha); if(!f) return [];
  return readSheet('EXTRAS_ADMIN', EXTRAS_ADMIN_HEADERS)
    .filter(r=> fdate(r.fecha)===f)
    .map(r=>({ fecha:fdate(r.fecha), cc:String(r.cc||''), proyecto:String(r.proyecto||''),
      horas:Number(r.horas)||0, tipo:norm(r.tipo), timestamp:r.timestamp, reporta:String(r.reporta||'') }));
}
// GET ?action=extras_admin&fecha=YYYY-MM-DD → registro del día (o null) para prefill/edición.
function extrasAdminDia(e){
  const fecha=fdateValida_(e.parameter.fecha);   // D106
  const regs=extrasAdminDelDia(fecha);
  return json({ ok:true, fecha, registro: regs.length? regs[0] : null });
}
// POST {action:'extras_admin', fecha, cc, horas, tipo} → upsert por `fecha`. Deriva `proyecto` del CC.
function guardarExtrasAdmin(body){
  const fecha=fdateValida_(body.fecha);   // D106: ya rechazaba la vacía; ahora también la mal formada
  const cc=String(body.cc||'').trim();
  const horas=Number(body.horas);
  const tipo=norm(body.tipo);
  if(!fecha) return json({ok:false, error:'Falta la fecha.'});
  if(!cc)    return json({ok:false, error:'Falta el centro de costo.'});
  if(['diurna','nocturna','domfest'].indexOf(tipo)<0) return json({ok:false, error:'Tipo inválido (usa diurna, nocturna o domfest).'});
  /* Tope según el tipo: día normal (diurna/nocturna) máx `max_extras_dia`; domingo/festivo
   * `domfest_tope` + `max_extras_dia`.
   *
   * D124 — este tope estaba CABLEADO en `(tipo==='domfest') ? 7 : 2` y se quedó fuera de D120, que solo
   * tocó el frontend. Resultado: la pantalla dejaba teclear 9h en un festivo y mostraba el reparto
   * correcto (7 a col D + 2 a col H), pero al Guardar el servidor lo rechazaba con "máximo 7". Ahora los
   * dos topes salen de CONFIG, igual que en `mis-extras.html` y que en `clasificarHoras`, así que las
   * tres partes no pueden volver a divergir. El reparto a col D / col H lo sigue haciendo el generador
   * del Parte (`buildAdminExtraRow`); aquí solo se guarda el TOTAL de horas del día. */
  const cfgTopes=getConfigMap();
  const _tD=parseFloat(cfgTopes.domfest_tope),   topeD=isNaN(_tD)?7:_tD;
  const _tE=parseFloat(cfgTopes.max_extras_dia), topeE=isNaN(_tE)?2:_tE;
  const maxH = (tipo==='domfest') ? (topeD+topeE) : topeE;
  if(isNaN(horas) || !(horas>0 && horas<=maxH)) return json({ok:false, error:'Las horas deben ser un número mayor que 0 y máximo '+maxH+' ('+(tipo==='domfest'?'domingo/festivo':'día normal')+').'});
  const proyecto=proyectoFromCC(cc);
  const sh=getSheet('EXTRAS_ADMIN', EXTRAS_ADMIN_HEADERS), need=EXTRAS_ADMIN_HEADERS.length, last=sh.getLastRow();
  let rows = last>1 ? leerRango_(sh,2,1,last-1,need) : [];
  rows = rows.filter(r=> fdate(r[0])!==fecha);         // clave lógica = fecha: re-guardar pisa el día
  rows.push([fecha, cc, proyecto, horas, tipo, new Date(), body.reporta||'admin']);
  sh.clearContents();
  sh.getRange(1,1,1,need).setValues([EXTRAS_ADMIN_HEADERS]);
  if(rows.length){ ensureRows_(sh, rows.length);   // D93
    sh.getRange(2,1,rows.length,need).setValues(rows); }
  invalidarHoja_('EXTRAS_ADMIN');   // D99
  return json({ ok:true, msg:'Extra guardada: '+fecha+' · '+horas+'h '+tipo+' · '+cc+' (proyecto '+(proyecto||'?')+').', proyecto });
}
// POST {action:'extras_admin_delete', fecha} → elimina la fila del día.
function borrarExtrasAdmin(body){
  const fecha=fdateValida_(body.fecha);   // D106
  if(!fecha) return json({ok:false, error:'Falta la fecha.'});
  const sh=getSheet('EXTRAS_ADMIN', EXTRAS_ADMIN_HEADERS), need=EXTRAS_ADMIN_HEADERS.length, last=sh.getLastRow();
  let rows = last>1 ? leerRango_(sh,2,1,last-1,need) : [];
  const antes=rows.length;
  rows = rows.filter(r=> fdate(r[0])!==fecha);
  sh.clearContents();
  sh.getRange(1,1,1,need).setValues([EXTRAS_ADMIN_HEADERS]);
  // D93: aquí el bloque solo puede DECRECER (se filtra el día), así que ensureRows_ nunca expandirá;
  // se llama igual para que toda escritura en bloque pase por el mismo guardián (es barata y no
  // escribe si hay espacio).
  if(rows.length){ ensureRows_(sh, rows.length);
    sh.getRange(2,1,rows.length,need).setValues(rows); }
  invalidarHoja_('EXTRAS_ADMIN');   // D99
  const borradas=antes-rows.length;
  return json({ ok:true, msg: borradas ? ('Extra del '+fecha+' eliminada.') : ('No había extra registrada el '+fecha+'.'), borradas });
}

/* ---------- POST reporte_asistencia: escritura directa (sin bandeja), pisa fecha+cuadrilla (D03) ---------- */
/* D82 — VERIFICADO para el modo offline (no tocar): este upsert BORRA-E-INSERTA el bloque completo de
 * fecha+cuadrilla (filtra `keep` = todo lo que NO es esa fecha+cuadrilla, clearContents y reescribe;
 * NO hace append). Un reenvío idéntico desde la cola offline re-pisa con el mismo contenido =>
 * IDEMPOTENTE POR DISEÑO, no necesita id_registro/UUID de cliente ni dedupe. Si hay dos envíos
 * encolados de la misma fecha+cuadrilla, el orden FIFO de la cola hace que gane el último (correcto:
 * es el más reciente). upsertNotaDia (D74) sigue la misma regla. */
function guardarAsistencia(body){
  const fecha=fdateValida_(body.fecha), cuadrilla=body.cuadrilla||'', reporta=body.reporta||'', ts=new Date();
  // D106: portero de fecha ANTES de tocar la hoja. Es el punto exacto por donde entraron las dos
  // veces los bloques sin fecha: con `fecha=''` este upsert escribía la cuadrilla entera con la
  // columna C en blanco y, en el siguiente envío igual, se borraba a sí mismo (ver fdateValida_).
  if(!fecha) return json({ok:false, error:ERROR_FECHA});
  // D101: quien tiene área forzada por su rol no puede reportar cuadrillas de otra área (D69h).
  if(!cuadrillaPermitidaPara(reporta, cuadrilla))
    return json({ok:false, error:'Esa cuadrilla no es de tu área.'});
  const sh=getSheet('ASISTENCIA', ASISTENCIA_HEADERS);
  const need=ASISTENCIA_HEADERS.length;
  // D119: red de seguridad — si el envío trae DOS renglones de la misma persona, se guarda uno. D118 ya
  // deduplica el roster (que es de donde salía el renglón repetido), pero un teléfono con la pantalla
  // vieja en caché, o un reporte que pasó el fin de semana en la cola offline (D82), puede seguir
  // mandando el payload duplicado. Ese día terminaba con las horas repetidas en el Parte, así que el
  // cerrojo va también aquí, en el punto de escritura.
  const entrantes=unicasPorPersona_(body.filas||[]);
  const nuevas=entrantes.map(f=>[
    Utilities.getUuid(), ts, fecha, reporta, cuadrilla, f.codigo||'', f.cedula||'', f.nombre||'', f.cargo||'',
    f.cc||'', f.proyecto||'', f.hora_entrada||'', f.hora_salida||'',
    f.presente===false||f.presente==='No' ? 'No':'Si', f.motivo_ausencia||'', f.observacion||'', f.turno||''
  ]);
  /* D107: borrado quirúrgico del bloque fecha+cuadrilla + anexo al final, en vez de reescribir la hoja.
   *
   * D126 — ADEMÁS se borra la fila de ese día de CUALQUIER persona que venga en el envío, esté en la
   * cuadrilla que esté. Pisar solo `fecha+cuadrilla` dejaba un agujero estructural en cuanto alguien
   * CAMBIA DE CUADRILLA, que en drenajes pasa a menudo: OSMEL se reportó el 27-jul con JAIRO; el 4-ago
   * lo movieron a MAURICIO; al volver a subir ese 27-jul —ahora desde MAURICIO, porque es donde está
   * hoy— el envío pisaba el bloque de MAURICIO y la fila vieja de JAIRO seguía viva. Resultado: la
   * persona duplicada ese día en dos cuadrillas, que es justo lo que el aviso del resumen venía
   * marcando. Nadie hizo nada mal: la clave de pisado era la equivocada.
   *
   * Con esto, "volver a subir el día" queda cerrado de verdad — la persona termina UNA sola vez, en la
   * cuadrilla desde la que se reportó de último. Se usa el mismo emparejador que el upsert por persona,
   * así que el código manda y dos personas con la misma cédula no se pisan entre sí (D123).
   *
   * Coste: el escaneo pasa de leer las columnas 3–5 a las 3–8 (tres columnas más de las 17 de la hoja,
   * y ninguna lectura completa extra). Es la misma pasada, así que en la práctica no se nota — muy
   * lejos de la lectura íntegra que hacía este endpoint antes de D107. */
  const esDeLosEntrantes=emparejadorDePersonas_(entrantes);
  const aBorrar=localizarFilas_(sh, ASISTENCIA_HEADERS, ['fecha','cuadrilla','codigo','cedula','nombre'], function(o){
    if(fdate(o.fecha)!==fecha) return false;
    return String(o.cuadrilla)===cuadrilla || esDeLosEntrantes(o);
  });
  // D129: misma estrategia que el upsert por persona — se pisa en sitio, se borra solo lo sobrante y se
  // anexa únicamente lo que no cupo. Un `deleteRows` que no surta efecto ya no puede duplicar el día.
  const posiciones=aBorrar.slice().sort(function(a,b){ return a-b; });
  const enSitio=Math.min(posiciones.length, nuevas.length);
  for(let i=0;i<enSitio;i++) sh.getRange(posiciones[i], 1, 1, need).setValues([nuevas[i]]);
  const sobrantes=posiciones.slice(enSitio);
  if(sobrantes.length) borrarFilas_(sh, sobrantes);
  const porAnexar=nuevas.slice(enSitio);
  if(porAnexar.length) anexarFilas_(sh, porAnexar, need);
  invalidarHoja_('ASISTENCIA');   // D99
  // D74: nota libre del día por cuadrilla (pisa fecha+cuadrilla, igual que las filas).
  upsertNotaDia(fecha, cuadrilla, reporta, body.nota, ts);
  return json({ ok:true, filas:nuevas.length });
}

/* ---------- NOTAS_ASISTENCIA (D74): nota libre del día por cuadrilla ---------- */
// Upsert por fecha+cuadrilla. Nota vacía = borra la del día (re-envío sin nota la limpia).
function upsertNotaDia(fecha, cuadrilla, reporta, nota, ts){
  const f=fdateValida_(fecha), c=cuadrilla||'', txt=String(nota==null?'':nota).trim();
  if(!f) return;   // D106: su único llamador ya valida; la nota nunca se queda sin fecha por su cuenta
  const sh=getSheet('NOTAS_ASISTENCIA', NOTAS_ASISTENCIA_HEADERS), need=NOTAS_ASISTENCIA_HEADERS.length, last=sh.getLastRow();
  let rows = last>1 ? leerRango_(sh,2,1,last-1,need) : [];
  rows = rows.filter(r=> !(fdate(r[0])===f && String(r[1])===c));   // quita la del día+cuadrilla
  if(txt) rows.push([f, c, reporta||'', txt, ts||new Date()]);       // si hay texto, la reescribe
  sh.clearContents();
  sh.getRange(1,1,1,need).setValues([NOTAS_ASISTENCIA_HEADERS]);
  if(rows.length){ ensureRows_(sh, rows.length);   // D93
    sh.getRange(2,1,rows.length,need).setValues(rows); }
  invalidarHoja_('NOTAS_ASISTENCIA');   // D99
}
function notasDelDia(fecha){
  const f=fdate(fecha);
  return readSheet('NOTAS_ASISTENCIA', NOTAS_ASISTENCIA_HEADERS)
    .filter(r=> fdate(r.fecha)===f && String(r.nota||'').trim())
    .map(r=>({ cuadrilla:String(r.cuadrilla||''), reporta:String(r.reporta||''), nota:String(r.nota||'') }));
}

/* ---------- POST personal: alta / retiro / mover / reactivar — SOLO residente/admin ---------- */
function gestionPersonal(body){
  const usuario=norm(body.usuario);
  // D72/D74b/D84: admin gestiona TODO; residente/jeisson gestionan tierras; residente_odt/odl gestionan su
  // área; residente_dren gestiona ODT+ODL (incluido MOVER una persona de una cuadrilla ODT a una ODL y
  // viceversa — la validación de área acepta el ARRAY de áreas del usuario, no un valor único).
  // D88: `duvan` gestiona el personal de ODT+ODL (mismo alcance que residente_dren en asistencias).
  // D101: `residente_uf3` gestiona el personal de UF3 y NADA más — `areasDeUsuario` le devuelve ['uf3'],
  // así que `okArea` le rechaza cualquier alta/mover hacia (o desde) tierras, ODT u ODL.
  // D119: `angie` gestiona el personal de tierras+ODT+ODL — incluido MOVER a alguien de tierras a ODL
  // y viceversa, que `okArea` acepta porque valida contra el ARRAY de áreas. Lo que le rechaza, por la
  // misma vía, es cualquier alta o movimiento hacia (o desde) una cuadrilla de UF3.
  if(['residente','admin','jeisson','duvan','residente_uf3','angie','residente_odt','residente_odl','residente_dren'].indexOf(usuario)<0)
    return json({ok:false, error:'No autorizado: solo residente o admin.'});
  const areasUsr=areasDeUsuario(usuario);            // [] = todas (residente general/admin)
  const cuadArea=areaDeCuadrillaMap();
  const okArea=function(cuadrilla){ return cuadrillaEnAreas(cuadrilla, areasUsr, cuadArea); };
  const sh=getSheet('PERSONAL', PERSONAL_HEADERS);
  const op=body.op||'';

  const hoy=Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd');
  if(op==='alta'){
    const cuadrilla=body.cuadrilla||'';
    if(!okArea(cuadrilla)) return json({ok:false, error:'Esa cuadrilla no es de tu área.'});
    const responsable=responsableDeCuadrilla(cuadrilla);
    // D72: fecha_ingreso (col 9) permite el alta retroactiva ("desde cierto día"); por defecto, hoy.
    const fechaIng=fdate(body.fecha_ingreso)||hoy;
    // D118: no se dan de alta dos veces a la misma persona. Un `appendRow` a ciegas dejaba dos filas
    // ACTIVAS con el mismo código y el formulario del capataz mostraba a esa persona dos veces, así que
    // un solo envío escribía dos filas en ASISTENCIA y sus horas salían repetidas al Parte. Para un
    // REINGRESO (persona que ya estuvo y volvió) está `op:'reingreso'`, que sí crea fila nueva pero
    // exige que la anterior esté retirada — así el hueco de días inactivos se conserva.
    const yaExiste=readSheet('PERSONAL', PERSONAL_HEADERS).find(function(p){
      return clavePersona_(p)===clavePersona_(body) && activaEnFecha(p, hoy);
    });
    if(yaExiste){
      return json({ok:false, error:'Ya existe una persona activa con ese '+(String(body.codigo||'').trim()?'código':'documento')
        +' ('+(yaExiste.nombre||'')+', cuadrilla '+(yaExiste.cuadrilla||'')+'). '
        +'Si cambió de cuadrilla usa MOVER; si volvió a la obra usa REINGRESO. Dar de alta otra vez la duplicaría en el Parte.'});
    }
    sh.appendRow([body.cedula||'', body.codigo||'', body.nombre||'', body.cargo||'', cuadrilla, responsable, 'activo', '', fechaIng]);
    invalidarHoja_('PERSONAL');   // D99
    return json({ok:true, op:'alta'});
  }
  const row=Number(body._row);
  if(!row || row<2) return json({ok:false, error:'Falta identificar la persona (_row).'});
  // D72/D84: un residente de área (o el unificado) solo puede retirar/reactivar/reingresar/mover filas
  // de sus áreas. [] = sin restricción (residente general/admin).
  if(areasUsr.length){
    const srcChk=readSheet('PERSONAL', PERSONAL_HEADERS).find(p=>p._row===row);
    if(!srcChk || !okArea(srcChk.cuadrilla)) return json({ok:false, error:'Esa persona no es de tu área.'});
  }

  if(op==='retiro'){
    // D72: la fecha de retiro la elige el residente (default hoy). Es el PRIMER día NO trabajado:
    // la persona aparece reportable hasta el día anterior (ver activaEnFecha).
    const fechaRet=fdate(body.fecha_retiro)||hoy;
    sh.getRange(row,7).setValue('inactivo');       // col 7 = estado
    sh.getRange(row,8).setValue(fechaRet);         // col 8 = fecha_retiro
    invalidarHoja_('PERSONAL');   // D99
    return json({ok:true, op:'retiro'});
  }
  if(op==='reactivar'){
    sh.getRange(row,7).setValue('activo');
    sh.getRange(row,8).setValue('');               // limpia el retiro; conserva fecha_ingreso (col 9)
    invalidarHoja_('PERSONAL');   // D99
    return json({ok:true, op:'reactivar'});
  }
  if(op==='reingreso'){
    // D72: reingreso REAL con historial. NO reactiva la fila vieja (conservaría el hueco perdido);
    // crea una fila NUEVA copiando los datos de la persona con fecha_ingreso = fecha del reingreso.
    // Evita la doble digitación (no se reescribe cédula/código/nombre) y respeta los días inactivos:
    // la fila vieja aplica hasta su retiro y la nueva desde el reingreso; el hueco no lo cubre ninguna.
    const fechaIng=fdate(body.fecha_ingreso)||hoy;
    const src=readSheet('PERSONAL', PERSONAL_HEADERS).find(p=>p._row===row);
    if(!src) return json({ok:false, error:'No se encontró la persona a reingresar.'});
    // D118: la fila de origen tiene que estar RETIRADA. Reingresar a alguien que sigue activo deja dos
    // filas vivas de la misma persona: el formulario se la muestra dos veces al responsable y el día
    // queda con las horas duplicadas. Si solo cambió de cuadrilla, la operación correcta es MOVER.
    if(activaEnFecha(src, fechaIng)){
      return json({ok:false, error:'Esa persona sigue ACTIVA'+(src.cuadrilla?' en la cuadrilla '+src.cuadrilla:'')
        +', así que no hay reingreso que registrar. Retírala primero (con su fecha de salida) y reingrésala, '
        +'o usa MOVER si lo que cambió fue la cuadrilla.'});
    }
    const responsable=responsableDeCuadrilla(src.cuadrilla)||src.responsable||'';
    sh.appendRow([src.cedula||'', src.codigo||'', src.nombre||'', src.cargo||'', src.cuadrilla||'', responsable, 'activo', '', fechaIng]);
    invalidarHoja_('PERSONAL');   // D99
    return json({ok:true, op:'reingreso'});
  }
  if(op==='mover'){
    const cuadrilla=body.cuadrilla||'';
    if(!okArea(cuadrilla)) return json({ok:false, error:'Esa cuadrilla no es de tu área.'});
    const responsable=responsableDeCuadrilla(cuadrilla);
    sh.getRange(row,5).setValue(cuadrilla);        // col 5 = cuadrilla
    sh.getRange(row,6).setValue(responsable);       // col 6 = responsable
    invalidarHoja_('PERSONAL');   // D99
    return json({ok:true, op:'mover'});
  }
  return json({ok:false, error:'op no reconocida'});
}
function responsableDeCuadrilla(cuadrilla){
  const rows=readSheet('CUADRILLAS', CUADRILLAS_HEADERS);
  const r=rows.find(x=>x.cuadrilla===cuadrilla);
  return r ? String(r.responsables||'') : '';
}

/* ---------- setupHojas(): un solo uso, crea hojas + encabezados + semillas fijas ----------
 * Ejecutar UNA VEZ desde el editor de Apps Script tras crear el Sheet y pegar el SHEET_ID arriba.
 * NO pisa datos si la hoja ya tiene filas (salvo encabezados, que se auto-sanan con getSheet).
 * PERSONAL (semilla PERSONAL_seed.csv), CAT_TRABAJADORES, CAT_CC y CAT_MOTIVOS los pega el usuario
 * a mano (catálogos de la plantilla Navision, no se inventan aquí). CONFIG/CUADRILLAS/FESTIVOS sí
 * llevan semilla fija porque el prompt las define explícitamente. */
function setupHojas(){
  getSheet('LOG', LOG_HEADERS);   // D166: registro de peticiones (la primera petición la crearía igual)
  getSheet('PERSONAL', PERSONAL_HEADERS);
  getSheet('ASISTENCIA', ASISTENCIA_HEADERS);
  getSheet('CAT_TRABAJADORES', CAT_TRABAJADORES_HEADERS);
  getSheet('CAT_CC', CAT_CC_HEADERS);
  getSheet('CC_USADOS', CC_USADOS_HEADERS);   // el usuario pega aquí los ~5-20 CC frecuentes (opcional)
  getSheet('CAT_MOTIVOS', CAT_MOTIVOS_HEADERS);
  getSheet('MOTIVOS_USADOS', MOTIVOS_USADOS_HEADERS);   // D78: motivos frecuentes para el capataz (opcional; vacía = todos)
  getSheet('EXTRAS_ADMIN', EXTRAS_ADMIN_HEADERS);   // D73: canal "solo extras" del admin (mis-extras.html)
  getSheet('NOTAS_ASISTENCIA', NOTAS_ASISTENCIA_HEADERS);   // D74: nota libre del día por cuadrilla

  // D72: TURNOS asignados (5 turnos × tipo de día). Semilla fija con los horarios entregados; si el
  // usuario ya cargó la hoja, no se pisa. Horas como texto 'HH:MM' (00:00 = medianoche, fin de cena).
  const turSh=getSheet('TURNOS', TURNOS_HEADERS);
  if(turSh.getLastRow()<2){
    ensureRows_(turSh, 10);   // D93 (no-op en hoja nueva: la semilla cabe de sobra en las 1.000 filas)
    turSh.getRange(2,1,10,7).setValues([
      ['1','lv',     '07:00','15:30','12:00','13:00','NO'],
      ['1','sabado', '07:00','11:30','',     '',     'NO'],
      ['2','lv',     '17:30','02:00','22:00','23:00','SI'],
      ['2','sabado', '13:30','18:00','',     '',     'NO'],
      ['3','lj',     '17:00','02:30','23:00','00:00','SI'],
      ['3','viernes','17:00','02:00','23:00','00:00','SI'],
      ['4','lj',     '19:00','04:30','23:00','00:00','SI'],
      ['4','viernes','19:00','04:00','23:00','00:00','SI'],
      ['5','lv',     '18:00','02:30','23:00','00:00','SI'],
      ['5','sabado', '14:00','18:30','',     '',     'NO']
    ]);
    turSh.getRange(2,3,10,4).setNumberFormat('@'); // entrada/salida/descanso como TEXTO, no como hora
  }

  const cuadSh=getSheet('CUADRILLAS', CUADRILLAS_HEADERS);
  if(cuadSh.getLastRow()<2){
    // D72: 3ª columna = área. D84: 4ª columna = estado (vacío = activa). Las cuadrillas de drenajes
    // (ODT/ODL) las pega el usuario cuando llegue el listado real (cuadrilla · responsables(login) ·
    // odt|odl · estado); aquí solo van las de tierras.
    // D84 (post-salida a UF3): ALBERT queda con `maleja` como ÚNICA responsable (albert salió a UF3;
    // maleja ya la reportaba, D75). ARIEL queda INACTIVA y sin responsable (ariel salió a UF3; su gente
    // se movió a ROBINSON). Ambas conservan su nombre para no dejar huérfano el histórico de ASISTENCIA.
    // D134 (TEMPORAL, vacaciones de `maleja`): `maria` se suma como segunda responsable de ALBERT. La
    // columna admite varios logins separados por coma y los dos canales COEXISTEN (el envío pisa
    // fecha+cuadrilla, D03/D107: manda el último que reporte ese día). Al volver `maleja`, quitar
    // `maria` de la celda — es un dato, no código.
    // D145 (`albert` vuelve de UF3 a tierras): esta semilla NO cambia. Recupera su login y su reporte
    // de OBRA, pero la cuadrilla ALBERT se queda con `maleja`/`maria`: devolverle el canal pondría dos
    // sobre la misma fecha+cuadrilla, que se pisan. Si algún día se decide devolvérsela, es la misma
    // celda `responsables` — un dato, no código.
    ensureRows_(cuadSh, 7);   // D93
    cuadSh.getRange(2,1,7,4).setValues([
      ['ANGEL','angel','tierras',''], ['ROBINSON','robinson','tierras',''], ['ALBERT','maleja,maria','tierras',''],
      ['ARIEL','','tierras','inactiva'], ['ALEJANDRO','alejandro','tierras',''], ['OPERADORES','jeisson','tierras',''],
      ['VOLQUETEROS','mairy','tierras','']
    ]);
  }

  const cfgSh=getSheet('CONFIG', CONFIG_HEADERS);
  if(cfgSh.getLastRow()<2){
    ensureRows_(cfgSh, 16);   // D93
    cfgSh.getRange(2,1,16,2).setValues([
      ['ord_lun_vie','7.5'], ['ord_sabado','4.5'], ['ord_domingo','0'],
      ['entrada_lv','07:00'], ['salida_lv','15:30'], ['entrada_sab','07:00'], ['salida_sab','11:30'],
      ['almuerzo_ini','12:00'], ['almuerzo_fin','13:00'],
      ['max_extras_dia','2'], ['nocturno_desde','19:00'], ['nocturno_hasta','06:00'],
      // Dom/Fest (criterio de nómina, D72): MÁXIMO de horas ordinarias Dom/Fest (col D); nada en col L.
      ['domfest_tope','7'],
      // D77: horario típico de domingo/festivo (07:00–15:00 = 8h − 1h almuerzo = 7h Dom/Fest). Solo
      // pre-llena el formulario; instalaciones viejas sin estas claves usan el mismo default del cliente.
      ['entrada_dom','07:00'], ['salida_dom','15:00'],
      ['proyecto_3701','3701| T2 - UF1 - R4513 PR 09+800 - PR 30+000']
    ]);
    cfgSh.appendRow(['proyecto_3702','PENDIENTE']); // parámetro abierto (§2 del prompt)
    // D101: proyecto 3703 (UF3). String EXACTO tomado de la hoja `Proyectos` de la plantilla Navision
    // de UF3 que entregó el usuario (jul-2026) — no se inventó. El generador lo lee por clave
    // (`proyecto_` + prefijo del CC), así que un proyecto nuevo solo necesita su fila en CONFIG.
    // En la instalación VIVA hay que agregar esta fila A MANO en la hoja CONFIG (setupHojas solo
    // siembra con la hoja vacía). Sin ella, el export avisa y usa "3703" pelado.
    cfgSh.appendRow(['proyecto_3703','3703| T2 - UF3 - R4513 PR 09+800 - PR 90+718']);
    // D73: No. Recurso del admin en Navision ("código| NOMBRE"), string EXACTO tal cual el listado de
    // Trabajadores (Navision lo lee verbatim). Valor del dueño (jul-2026). Si se deja vacío, el generador
    // NO agrega la fila del admin y avisa. OJO: debe coincidir carácter por carácter con Navision.
    cfgSh.appendRow(['admin_recurso','77463| CESAR AUGUSTO GALVIS SANDINO']);
    // Corrección jul-2026 (extiende D72f): SUFIJO del CC propio del capataz (sin prefijo de proyecto).
    // El frontend antepone el prefijo 3701/3702 por mayoría de UF. Si esta clave no existe, asistencia.html
    // usa su valor por defecto (mismo string), así que NO exige redeploy en instalaciones ya andando.
    cfgSh.appendRow(['cc_capataz','I010305| ENCARGADOS, INSPECTORES Y CAPATACES']);
  }

  const festSh=getSheet('FESTIVOS', FESTIVOS_HEADERS);
  if(festSh.getLastRow()<2){
    // Colombia 2026-2027, Ley Emiliani aplicada (verificado contra el algoritmo de Pascua + traslado a lunes).
    // '2026-07-13' NO es festivo de calendario: se decretó como día no laboral puntual para la obra
    // (jul-2026). Va en la semilla para instalaciones nuevas; en una hoja ya sembrada hay que añadir la
    // fila '2026-07-13' a mano en FESTIVOS (el seed solo corre con la hoja vacía).
    const festivos=[
      '2026-01-01','2026-01-12','2026-03-23','2026-04-02','2026-04-03','2026-05-01','2026-05-18',
      '2026-06-08','2026-06-15','2026-06-29','2026-07-13','2026-07-20','2026-08-07','2026-08-17','2026-10-12',
      '2026-11-02','2026-11-16','2026-12-08','2026-12-25',
      '2027-01-01','2027-01-11','2027-03-22','2027-03-25','2027-03-26','2027-05-01','2027-05-10',
      '2027-05-31','2027-06-07','2027-07-05','2027-07-20','2027-08-07','2027-08-16','2027-10-18',
      '2027-11-01','2027-11-15','2027-12-08','2027-12-25'
    ];
    ensureRows_(festSh, festivos.length);   // D93
    festSh.getRange(2,1,festivos.length,1).setValues(festivos.map(f=>[f]));
  }
  cacheBorrarTodo_();   // D99: siembra hojas nuevas -> el caché de catálogos queda obsoleto
}

/**
 * D93 — Diagnóstico de CAPACIDAD de la grilla. Ejecutar desde el editor de Apps Script y revisar el
 * log (Ver > Registro de ejecución). Muestra, por hoja: filas usadas / filas totales / columnas
 * usadas / columnas totales y cuántas filas libres quedan. NO escribe datos: es solo lectura.
 */
function diagnosticoCapacidad() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  ss.getSheets().forEach(function (sh) {
    Logger.log(
      sh.getName() + ' → filas ' + sh.getLastRow() + '/' + sh.getMaxRows() +
      ' (libres ' + (sh.getMaxRows() - sh.getLastRow()) + ')' +
      ' · cols ' + sh.getLastColumn() + '/' + sh.getMaxColumns()
    );
  });
}

/* ---------- D106 — FILAS SIN FECHA: diagnóstico y reparación puntual ----------
 * Herramientas de MANTENIMIENTO, no endpoints: se corren A MANO desde el editor de Apps Script
 * (basta guardar el archivo, no exigen redesplegar). Mismo patrón previsualizar/aplicar que
 * `previsualizarDescripcionesData` / `actualizarDescripcionesData` de Codigo.gs.
 *
 *   1) diagnosticoFechasAsistencia()      -> SOLO LEE. Lista en el Log las filas de ASISTENCIA cuya
 *      columna `fecha` está vacía o mal formada, con su fila real, cuadrilla, quién reportó y su
 *      `timestamp`. Sirve para saber si el problema volvió sin tener que revisar la hoja a ojo.
 *   2) repararFechasAsistencia(false)     -> PREVISUALIZA la reparación (no escribe nada).
 *      repararFechasAsistencia(true)      -> aplica: escribe SOLO la celda de la columna `fecha` de
 *      esas filas, tomando el DÍA DEL `timestamp` (hora de Bogotá). No toca ninguna otra columna,
 *      ninguna otra hoja ni los .xlsx maestros (D24).
 *
 * ⚠️ DOS LÍMITES QUE HAY QUE LEER ANTES DE APLICAR:
 *   · El `timestamp` es CUÁNDO SE SUBIÓ, no el día trabajado. Coinciden en el envío normal del mismo
 *     día, pero NO en un reporte que salió de la cola offline al día siguiente (D82) ni en un
 *     "completar faltantes" hecho días después. Por eso la previsualización imprime fila por fila lo
 *     que pondría: hay que mirarla contra lo que se sabe del día antes de aplicar.
 *   · Esto NO resucita filas borradas. Si un segundo envío con la fecha vacía pisó al primero (el
 *     upsert de D03 quita "fecha+cuadrilla", y con fecha vacía eso son las huérfanas anteriores), esas
 *     filas ya no están en la hoja: para eso está el historial de versiones del Sheet.
 */
function _fechasAsistenciaPass(aplicar, soloListar){
  const sh=ss_().getSheetByName('ASISTENCIA');
  if(!sh || sh.getLastRow()<2){ Logger.log('ASISTENCIA vacía: nada que revisar.'); return 0; }
  const need=ASISTENCIA_HEADERS.length, nFilas=sh.getLastRow()-1;
  const colFecha=ASISTENCIA_HEADERS.indexOf('fecha')+1;       // por NOMBRE, nunca un 3 cableado
  const v=leerRango_(sh, 2, 1, nFilas, need);
  const tz='America/Bogota';
  let malas=0, reparables=0;
  for(let i=0;i<nFilas;i++){
    const fila=i+2, cruda=v[i][colFecha-1];
    if(fdateValida_(cruda)) continue;                          // fecha buena: no se toca
    malas++;
    const ts=v[i][1];                                          // col B timestamp
    const propuesta=(ts && typeof ts==='object' && typeof ts.getFullYear==='function')
      ? Utilities.formatDate(ts, tz, 'yyyy-MM-dd') : fdateValida_(ts);
    Logger.log('fila '+fila+' · cuadrilla '+JSON.stringify(String(v[i][4]||''))
      +' · reportó '+JSON.stringify(String(v[i][3]||''))+' · '+JSON.stringify(String(v[i][7]||''))
      +' · fecha actual '+JSON.stringify(String(cruda==null?'':cruda))
      +' · timestamp '+String(ts)+' -> propuesta '+(propuesta||'(no se puede deducir)'));
    if(soloListar || !propuesta) continue;
    reparables++;
    if(aplicar) sh.getRange(fila, colFecha).setValue(propuesta);   // SOLO la celda de fecha
  }
  if(aplicar && reparables) invalidarHoja_('ASISTENCIA');
  Logger.log((soloListar ? 'DIAGNÓSTICO (solo lectura).'
              : (aplicar ? 'APLICADO.' : 'PREVISUALIZACIÓN (no se escribió nada).'))
    +' Filas revisadas: '+nFilas+' · sin fecha válida: '+malas
    +(soloListar ? '' : ' · reparables desde el timestamp: '+reparables));
  return malas;
}
function diagnosticoFechasAsistencia(){ return _fechasAsistenciaPass(false, true); }
function repararFechasAsistencia(aplicar){ return _fechasAsistenciaPass(aplicar===true, false); }

/* ---------- D118 — mantenimiento a mano: personas repetidas en la hoja PERSONAL ----------
 * Mismo patrón que `diagnosticoFechasAsistencia` (D106): se ejecuta desde el editor de Apps Script y
 * SOLO LISTA — no borra ni modifica nada, porque cuál de las dos filas sobra lo tiene que decidir el
 * usuario (pueden diferir en cuadrilla, cargo o fecha_ingreso, y la buena es la que refleje la realidad).
 *
 * Qué busca: personas con MÁS DE UNA fila ACTIVA hoy (misma clave que el resto del módulo: código, o
 * cédula si no tiene código). Son las que el formulario del responsable muestra dos veces y las que
 * terminan con horas repetidas en el Parte de Navision.
 *
 * Cómo corregir cada una: dejar UNA fila y, en la sobrante, borrar la fila o ponerle `estado=inactivo`
 * con su `fecha_retiro`. Después hay que pedirle a esa cuadrilla que VUELVA A ENVIAR los días afectados
 * (el envío pisa fecha+cuadrilla, así que el reenvío deja el día limpio). Los días ya exportados a
 * Navision hay que revisarlos aparte: el archivo salió con la línea repetida. */
function diagnosticoPersonalDuplicado(){
  const hoy=Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd');
  const activos=readSheet('PERSONAL', PERSONAL_HEADERS).filter(function(p){ return activaEnFecha(p, hoy); });
  const grupos={};
  activos.forEach(function(p){
    const k=clavePersona_(p);
    if(k==='COD:' || k==='CED:') return;             // sin código ni cédula: no se puede agrupar
    (grupos[k]=grupos[k]||[]).push(p);
  });
  const dups=Object.keys(grupos).filter(function(k){ return grupos[k].length>1; });
  const lineas=dups.map(function(k){
    const g=grupos[k];
    return '  · '+k+' '+(g[0].nombre||'(sin nombre)')+' — '+g.length+' filas: '
      + g.map(function(p){ return 'fila '+p._row+' ('+(p.cuadrilla||'sin cuadrilla')+')'; }).join(' · ');
  });
  const msg='PERSONAL — personas con más de una fila activa: '+dups.length
    + ' (de '+activos.length+' filas activas).'
    + (lineas.length ? '\n'+lineas.join('\n')
        + '\n\nDeja UNA fila por persona (borra la sobrante o ponle estado=inactivo con su fecha_retiro)'
        + '\ny pide a esas cuadrillas que vuelvan a enviar los días afectados.'
      : '\nSin duplicados.');
  Logger.log(msg);
  return { total:dups.length, detalle:lineas };
}

/* ---------- D127 — mantenimiento a mano: duplicados de ASISTENCIA en un día ----------
 * Se ejecuta DESDE EL EDITOR de Apps Script, igual que `diagnosticoFechasAsistencia` (D106) y
 * `diagnosticoPersonalDuplicado` (D118). Eso importa aquí más que en los otros dos: el editor corre el
 * código GUARDADO, no la versión desplegada del web app, así que sirve para limpiar la hoja aunque el
 * redespliegue aún no se haya hecho o haya quedado a medias.
 *
 * Qué hace: agrupa las filas de UN día por persona y, de cada grupo con más de una fila, conserva la
 * MÁS RECIENTE (por timestamp; a igualdad, la de más abajo en la hoja) y borra las demás. Es la regla
 * que ya aplica el resto del módulo: la última edición manda.
 *
 * Clave de persona: código si lo tiene, si no la cédula (`clavePersona_`, la misma de todo el módulo).
 * Dos personas con códigos distintos NUNCA se mezclan aunque compartan cédula (D123).
 *
 * USO — primero en seco, que solo LISTA:
 *     diagnosticoDuplicadosAsistencia('2026-08-06')
 * y cuando el listado cuadre, aplicando de verdad:
 *     limpiarDuplicadosAsistencia('2026-08-06', true)
 * Sin el `true` no borra nada. Revisa el resultado en Ver > Registro de ejecución. */
function _duplicadosDia_(fechaISO, aplicar){
  const fecha=fdateValida_(fechaISO);
  if(!fecha){ Logger.log('Fecha inválida. Usa el formato 2026-08-06.'); return {error:'fecha'}; }
  const sh=getSheet('ASISTENCIA', ASISTENCIA_HEADERS);
  const filas=leerFilasPorFecha_('ASISTENCIA', fecha, fecha);
  const grupos={};
  filas.forEach(function(r){
    const k=clavePersona_(r);
    if(k==='COD:' || k==='CED:') return;          // sin ningún identificador: no se toca
    (grupos[k]=grupos[k]||[]).push(r);
  });
  const aBorrar=[], lineas=[];
  Object.keys(grupos).forEach(function(k){
    const g=grupos[k];
    if(g.length<2) return;
    // La más reciente se queda. `timestamp` puede ser Date o texto: se ordena por su valor de tiempo
    // cuando lo tiene, y si no, por el número de fila (más abajo = escrita después).
    const conOrden=g.map(function(r){
      const t=r.timestamp;
      const ms=(t && typeof t.getTime==='function') ? t.getTime() : Date.parse(String(t||'')) ;
      return { r:r, ms:isNaN(ms)?null:ms };
    });
    conOrden.sort(function(a,b){
      if(a.ms!==null && b.ms!==null && a.ms!==b.ms) return a.ms-b.ms;
      return a.r._row-b.r._row;
    });
    const queda=conOrden[conOrden.length-1].r;
    conOrden.slice(0, -1).forEach(function(x){ aBorrar.push(x.r._row); });
    lineas.push('  · '+(queda.nombre||'(sin nombre)')+' ['+k+'] — '+g.length+' filas: se queda la '+queda._row
      +' ('+(queda.cuadrilla||'?')+'), se borran '+conOrden.slice(0,-1).map(function(x){ return x.r._row+' ('+(x.r.cuadrilla||'?')+')'; }).join(', '));
  });
  let msg='ASISTENCIA '+fecha+' — filas del día: '+filas.length+' · personas con más de una fila: '+lineas.length
    + ' · filas sobrantes: '+aBorrar.length;
  msg += lineas.length ? ('\n'+lineas.join('\n')) : '\nSin duplicados.';
  if(!aplicar){
    msg += '\n\n(SIMULACIÓN: no se borró nada. Para aplicarlo: limpiarDuplicadosAsistencia("'+fecha+'", true))';
    Logger.log(msg); return { fecha:fecha, personas:lineas.length, sobrantes:aBorrar.length, aplicado:false };
  }
  borrarFilas_(sh, aBorrar);                 // agrupa en tramos y borra de abajo hacia arriba
  invalidarHoja_('ASISTENCIA');
  msg += '\n\nAPLICADO: '+aBorrar.length+' fila(s) borrada(s).';
  Logger.log(msg);
  return { fecha:fecha, personas:lineas.length, sobrantes:aBorrar.length, aplicado:true };
}
function diagnosticoDuplicadosAsistencia(fechaISO){ return _duplicadosDia_(fechaISO, false); }
function limpiarDuplicadosAsistencia(fechaISO, aplicar){ return _duplicadosDia_(fechaISO, aplicar===true); }

/* ---------- D128 — la misma limpieza, pero por RANGO de fechas ----------
 * La versión por día no bastaba: al mirar la hoja aparecieron duplicados de la MISMA persona repartidos
 * por varios días seguidos (CESAR 77938 el 29, 30 y 31 de julio). Limpiar de uno en uno obliga a saber
 * de antemano qué días están sucios, y justamente no se sabe: el aviso del resumen solo mira el día que
 * se está viendo.
 *
 * Lee la hoja UNA vez y resuelve todos los días del rango de una pasada — no una lectura por día. El
 * criterio es idéntico al de `_duplicadosDia_`: agrupa por FECHA + persona (`clavePersona_`: código, o
 * cédula si no hay código) y de cada grupo conserva la fila MÁS RECIENTE. Dos personas con códigos
 * distintos nunca se mezclan aunque compartan cédula (D123).
 *
 * USO — primero en seco, que solo LISTA:
 *     diagnosticoDuplicadosRango('2026-07-01', '2026-08-07')
 * y cuando el listado cuadre:
 *     limpiarDuplicadosRango('2026-07-01', '2026-08-07', true)
 * Sin el `true` no borra nada. El resultado sale en Ver > Registro de ejecución. */
function _duplicadosRango_(desdeISO, hastaISO, aplicar){
  const desde=fdateValida_(desdeISO), hasta=fdateValida_(hastaISO);
  if(!desde || !hasta){ Logger.log('Fechas inválidas. Usa el formato 2026-07-01.'); return {error:'fecha'}; }
  if(hasta < desde){ Logger.log('El rango está al revés: "desde" tiene que ser anterior a "hasta".'); return {error:'rango'}; }
  const sh=getSheet('ASISTENCIA', ASISTENCIA_HEADERS);
  // Lectura ÚNICA de la hoja: para un rango sale más barato que un escaneo acotado por cada día.
  const filas=readSheet('ASISTENCIA', ASISTENCIA_HEADERS).filter(function(r){
    const f=fdate(r.fecha); return f>=desde && f<=hasta;
  });
  const grupos={}, dias={};
  filas.forEach(function(r){
    const k=clavePersona_(r);
    if(k==='COD:' || k==='CED:') return;              // sin ningún identificador: no se toca
    const f=fdate(r.fecha);
    dias[f]=true;
    (grupos[f+'|'+k]=grupos[f+'|'+k]||[]).push(r);
  });
  const aBorrar=[], lineas=[], porDia={};
  Object.keys(grupos).sort().forEach(function(gk){
    const g=grupos[gk];
    if(g.length<2) return;
    const sobra=_sobrantesDelGrupo_(g);
    sobra.borrar.forEach(function(row){ aBorrar.push(row); });
    const f=gk.split('|')[0];
    porDia[f]=(porDia[f]||0)+sobra.borrar.length;
    lineas.push('  · '+f+'  '+(sobra.queda.nombre||'(sin nombre)')+' ['+gk.split('|').slice(1).join('|')+'] — '
      + g.length+' filas: se queda la '+sobra.queda._row+' ('+(sobra.queda.cuadrilla||'?')+'), se borran '+sobra.borrar.join(', '));
  });
  let msg='ASISTENCIA '+desde+' → '+hasta+' — días con datos: '+Object.keys(dias).length
    + ' · filas en el rango: '+filas.length
    + ' · personas-día con más de una fila: '+lineas.length
    + ' · filas sobrantes: '+aBorrar.length;
  msg += lineas.length ? ('\n'+lineas.join('\n')) : '\nSin duplicados en el rango.';
  if(lineas.length){
    msg += '\n\nResumen por día: '+Object.keys(porDia).sort().map(function(f){ return f+'='+porDia[f]; }).join(' · ');
  }
  if(!aplicar){
    msg += '\n\n(SIMULACIÓN: no se borró nada. Para aplicarlo: limpiarDuplicadosRango("'+desde+'", "'+hasta+'", true))';
    Logger.log(msg);
    return { desde:desde, hasta:hasta, personasDia:lineas.length, sobrantes:aBorrar.length, porDia:porDia, aplicado:false };
  }
  borrarFilas_(sh, aBorrar);                 // agrupa en tramos y borra de abajo hacia arriba
  invalidarHoja_('ASISTENCIA');
  msg += '\n\nAPLICADO: '+aBorrar.length+' fila(s) borrada(s).';
  Logger.log(msg);
  return { desde:desde, hasta:hasta, personasDia:lineas.length, sobrantes:aBorrar.length, porDia:porDia, aplicado:true };
}
function diagnosticoDuplicadosRango(desdeISO, hastaISO){ return _duplicadosRango_(desdeISO, hastaISO, false); }
function limpiarDuplicadosRango(desdeISO, hastaISO, aplicar){ return _duplicadosRango_(desdeISO, hastaISO, aplicar===true); }

/* De un grupo de filas de la MISMA persona en el MISMO día: cuál se queda y cuáles sobran.
 * Se queda la más reciente por `timestamp` (Date o texto); a igualdad, la de más abajo en la hoja —
 * que es la escrita después. Es la regla del resto del módulo: la última edición manda. */
function _sobrantesDelGrupo_(g){
  const orden=g.map(function(r){
    const t=r.timestamp;
    const ms=(t && typeof t.getTime==='function') ? t.getTime() : Date.parse(String(t||''));
    return { r:r, ms:isNaN(ms)?null:ms };
  });
  orden.sort(function(a,b){
    if(a.ms!==null && b.ms!==null && a.ms!==b.ms) return a.ms-b.ms;
    return a.r._row-b.r._row;
  });
  return { queda: orden[orden.length-1].r,
           borrar: orden.slice(0,-1).map(function(x){ return x.r._row; }) };
}

/* ============ D132 — "LA HOJA NO ABRE": PESO DE LA GRILLA, CENSO POR DÍA Y RESCATE ============
 *
 * EL SÍNTOMA. El Sheet de asistencias se queda cargando y no abre — ni en el navegador ni, por
 * consiguiente, en el aplicativo. Cuando pasa eso NO se puede diagnosticar mirando la hoja, que es
 * justo lo que no abre. Pero el **editor de Apps Script sí abre siempre** (script.google.com es otro
 * producto y habla con Sheets por API, no renderiza la grilla), así que todo lo de aquí se ejecuta
 * desde ahí, igual que `diagnosticoFechasAsistencia` (D106) o `limpiarDuplicadosRango` (D128).
 *
 * LAS TRES CAUSAS POSIBLES, y cómo se distinguen sin abrir el archivo:
 *   1) **Demasiadas celdas.** Un Sheet aguanta 10.000.000 de celdas sumando TODAS las hojas, y mucho
 *      antes de ese techo la interfaz web se arrastra. `ASISTENCIA` crece 1 fila por persona y día
 *      (~7.800 filas/mes con 300 personas, ~94.000 al año × 17 columnas ≈ 1,6 M celdas al año): eso
 *      solo NO tumba el archivo. Lo que sí lo tumba es que crezca de más — y este módulo viene de una
 *      racha de duplicación (D118 → D129) en la que las filas se anexaban sin borrar las viejas.
 *   2) **Grilla inflada de celdas VACÍAS.** `ensureRows_` (D93) crece en bloques de 1.000 filas y la
 *      grilla nunca se encoge sola: una hoja puede tener 200.000 filas de rejilla con 8.000 de datos.
 *      Las celdas vacías consumen cupo y peso igual que las llenas.
 *   3) **Nada de lo anterior** — el archivo pesa lo normal y el problema está del lado del navegador
 *      (sesión, extensión, caché, red). Descartar 1 y 2 con números es lo que permite dejar de
 *      buscar en el sitio equivocado.
 *
 * ORDEN DE USO (los dos primeros SOLO LEEN, no tocan nada):
 *   1. `diagnosticoPeso()`                 → cuánto pesa cada hoja y el archivo entero. Es lo primero
 *                                            SIEMPRE: no lee ni una celda de datos, así que responde
 *                                            en segundos por gigante que esté el archivo.
 *   2. `diagnosticoVolumenAsistencia()`    → filas de ASISTENCIA por día. Un día con 3× la mediana es
 *                                            duplicación; el histórico completo en un solo vistazo.
 *   3. `limpiarDuplicadosTodo(false)`      → simula la limpieza de TODO el histórico (la de D128 pero
 *                                            leyendo 6 de las 17 columnas, para que no reviente en una
 *                                            hoja enorme).       `limpiarDuplicadosTodo(true)` aplica.
 *   4. `compactarGrilla(false)`            → simula el recorte de la rejilla sobrante de cada hoja.
 *                                            `compactarGrilla(true)` aplica. Va AL FINAL: primero se
 *                                            borran las filas que sobran, después se recorta la
 *                                            rejilla que quedó libre.
 *
 * NADA DE ESTO CAMBIA EL COMPORTAMIENTO DEL WEB APP: son funciones de mantenimiento, no endpoints, y
 * no las llama `doGet`/`doPost`. Basta con GUARDAR el archivo en el editor — no hace falta redesplegar.
 */

// Techo duro de Google Sheets, sumando todas las hojas del archivo.
const LIMITE_CELDAS_ARCHIVO = 10000000;
// Colchón de filas libres que deja `compactarGrilla` al final de cada hoja. No hace falta que sea
// grande: `ensureRows_` (D93) crece sola en bloques de BLOQUE_FILAS cuando se agota.
const MARGEN_FILAS_LIBRES = 200;
// Presupuesto de tiempo para el borrado de una pasada. El tope de Apps Script son 6 minutos; se corta
// antes y se informa cuántas filas quedaron, para volver a ejecutar. Como se borra de abajo hacia
// arriba, lo que queda pendiente conserva su número de fila: la segunda pasada sigue donde iba.
const MS_PRESUPUESTO_BORRADO = 240000;

/**
 * Peso de la grilla, hoja por hoja. SOLO LEE metadatos (`getMaxRows`/`getLastRow`/…): cero celdas de
 * datos, así que corre igual de rápido con la hoja vacía o con dos millones de filas.
 */
function diagnosticoPeso(){
  const hojas=ss_().getSheets().map(function(sh){
    const maxR=sh.getMaxRows(), maxC=sh.getMaxColumns();
    const lastR=sh.getLastRow(), lastC=sh.getLastColumn();
    let reglas=0;
    try{ reglas=sh.getConditionalFormatRules().length; }catch(err){}
    return { nombre:sh.getName(), lastR:lastR, maxR:maxR, lastC:lastC, maxC:maxC,
             celdas:maxR*maxC, usadas:lastR*lastC, reglas:reglas };
  });
  hojas.sort(function(a,b){ return b.celdas-a.celdas; });
  const total=hojas.reduce(function(s,h){ return s+h.celdas; }, 0);
  const usadas=hojas.reduce(function(s,h){ return s+h.usadas; }, 0);
  const pct=function(n){ return (n*100/LIMITE_CELDAS_ARCHIVO).toFixed(1)+'%'; };

  const lineas=hojas.map(function(h){
    return '  · '+h.nombre+' — rejilla '+h.maxR+'×'+h.maxC+' = '+h.celdas+' celdas ('+pct(h.celdas)+' del techo)'
      + ' · con datos '+h.lastR+'×'+h.lastC+' = '+h.usadas
      + ' · vacías '+(h.celdas-h.usadas)
      + (h.reglas ? ' · '+h.reglas+' reglas de formato condicional' : '');
  });

  const asis=hojas.filter(function(h){ return h.nombre==='ASISTENCIA'; })[0];
  const veredicto=[];
  if(total > LIMITE_CELDAS_ARCHIVO)
    veredicto.push('🔴 El archivo SUPERA el techo de '+LIMITE_CELDAS_ARCHIVO+' celdas. Eso explica que no abra.');
  else if(total > LIMITE_CELDAS_ARCHIVO*0.6)
    veredicto.push('🟠 El archivo va por el '+pct(total)+' del techo. A partir de aquí la interfaz web se arrastra.');
  else
    veredicto.push('🟢 El archivo va por el '+pct(total)+' del techo: el TAMAÑO no explica que no abra.');
  if(total-usadas > 500000)
    veredicto.push('· Hay '+(total-usadas)+' celdas de rejilla VACÍA. Recórtalas con compactarGrilla(false) y luego (true).');
  if(asis && asis.lastR > 120000)
    veredicto.push('· ASISTENCIA tiene '+asis.lastR+' filas — más de lo que da un año normal (~94.000). '
      +'Revisa el reparto por día con diagnosticoVolumenAsistencia().');

  Logger.log('PESO DEL ARCHIVO — '+hojas.length+' hojas · rejilla total '+total+' celdas ('+pct(total)+' del techo)'
    + ' · con datos '+usadas+' · vacías '+(total-usadas)
    + '\n'+lineas.join('\n')
    + '\n\n'+veredicto.join('\n'));
  return { hojas:hojas, total:total, usadas:usadas, vacias:total-usadas, limite:LIMITE_CELDAS_ARCHIVO };
}

/**
 * Censo de `ASISTENCIA` por día. Lee UNA sola columna (la de `fecha`, por nombre, nunca un 3 cableado),
 * que es lo más barato que se puede leer de la hoja: con 200.000 filas son 200.000 celdas, no 3,4 M.
 * Muestra la mediana de filas/día y marca los días que la triplican — la firma de la duplicación.
 */
function diagnosticoVolumenAsistencia(){
  const sh=ss_().getSheetByName('ASISTENCIA');
  if(!sh || sh.getLastRow()<2){ Logger.log('ASISTENCIA vacía: nada que contar.'); return { filas:0 }; }
  const n=sh.getLastRow()-1, colFecha=ASISTENCIA_HEADERS.indexOf('fecha')+1;
  const v=leerRango_(sh, 2, colFecha, n, 1);
  const porDia={}; let sinFecha=0;
  for(let i=0;i<n;i++){
    const f=fdateValida_(fdate(v[i][0]));
    if(!f){ sinFecha++; continue; }
    porDia[f]=(porDia[f]||0)+1;
  }
  const dias=Object.keys(porDia).sort();
  if(!dias.length){
    Logger.log('ASISTENCIA — '+n+' filas y NINGUNA con fecha válida ('+sinFecha+' sin fecha). Mira diagnosticoFechasAsistencia() (D106).');
    return { filas:n, dias:0, sinFecha:sinFecha };
  }
  const ordenadas=dias.map(function(d){ return porDia[d]; }).sort(function(a,b){ return a-b; });
  const mediana=ordenadas[Math.floor(ordenadas.length/2)];
  const sospechosos=dias.filter(function(d){ return porDia[d] > mediana*3; });
  const top=dias.slice().sort(function(a,b){ return porDia[b]-porDia[a]; }).slice(0,20);

  Logger.log('ASISTENCIA — '+n+' filas de datos · '+dias.length+' días ('+dias[0]+' → '+dias[dias.length-1]+')'
    + ' · sin fecha válida: '+sinFecha
    + '\nFilas por día: mediana '+mediana+' · mínimo '+ordenadas[0]+' · máximo '+ordenadas[ordenadas.length-1]
    + '\nLos 20 días con más filas:\n'
    + top.map(function(d){ return '  · '+d+' — '+porDia[d]+' filas'+(porDia[d]>mediana*3?'   ⟵ '+(porDia[d]/mediana).toFixed(1)+'× la mediana':''); }).join('\n')
    + (sospechosos.length
        ? '\n\n🔴 '+sospechosos.length+' día(s) triplican la mediana: eso es duplicación, no gente de más.'
          +'\n   Simula la limpieza con limpiarDuplicadosTodo(false).'
        : '\n\n🟢 Ningún día se sale de lo normal: el volumen de ASISTENCIA no es el problema.'));
  return { filas:n, dias:dias.length, sinFecha:sinFecha, mediana:mediana, porDia:porDia, sospechosos:sospechosos };
}

/**
 * D128 aplicado a TODO el histórico, sin límite de fechas y sin leer la hoja entera.
 * Diferencia con `limpiarDuplicadosRango`: aquel usa `readSheet`, que trae las 17 columnas — en una
 * hoja desbocada eso son millones de celdas y revienta el tope de 6 minutos antes de borrar nada.
 * Este lee el bloque 2–7 (`timestamp`…`cedula`), las 6 columnas que deciden, con el mismo lector
 * acotado por columnas de D102. El CRITERIO es idéntico: agrupa por fecha + persona (`clavePersona_`:
 * código, o cédula si no hay código) y de cada grupo conserva la fila MÁS RECIENTE (`_sobrantesDelGrupo_`).
 * Dos personas con códigos distintos nunca se mezclan aunque compartan cédula (D123).
 *
 * Las filas SIN fecha válida no se tocan: son las huérfanas de D106 y se arreglan con
 * `repararFechasAsistencia`, no borrándolas.
 */
function _duplicadosTodo_(aplicar){
  const sh=getSheet('ASISTENCIA', ASISTENCIA_HEADERS);
  if(sh.getLastRow()<2){ Logger.log('ASISTENCIA vacía: nada que limpiar.'); return { sobrantes:0 }; }
  const colFin=ASISTENCIA_HEADERS.indexOf('cedula')+1;          // por NOMBRE: 2..7 hoy, se mueve solo si cambia el layout
  const filas=leerColumnasDeHoja_('ASISTENCIA', 2, colFin);
  const grupos={}; let sinFecha=0, sinId=0;
  filas.forEach(function(r){
    const f=fdateValida_(fdate(r.fecha));
    if(!f){ sinFecha++; return; }                                // huérfanas de D106: no son duplicados
    const k=clavePersona_(r);
    if(k==='COD:' || k==='CED:'){ sinId++; return; }              // sin ningún identificador: no se toca
    (grupos[f+'|'+k]=grupos[f+'|'+k]||[]).push(r);
  });
  const aBorrar=[], porDia={};
  let personasDia=0;
  Object.keys(grupos).forEach(function(gk){
    const g=grupos[gk];
    if(g.length<2) return;
    personasDia++;
    const f=gk.split('|')[0], sobra=_sobrantesDelGrupo_(g);
    sobra.borrar.forEach(function(row){ aBorrar.push(row); });
    porDia[f]=(porDia[f]||0)+sobra.borrar.length;
  });
  const resumenDias=Object.keys(porDia).sort().map(function(f){ return f+'='+porDia[f]; });
  let msg='ASISTENCIA (histórico completo) — filas leídas: '+filas.length
    + ' · sin fecha válida (intactas): '+sinFecha
    + ' · sin código ni cédula (intactas): '+sinId
    + ' · personas-día con más de una fila: '+personasDia
    + ' · filas sobrantes: '+aBorrar.length
    + (resumenDias.length ? '\nSobrantes por día: '+resumenDias.join(' · ') : '\nSin duplicados.');

  if(!aplicar){
    msg += '\n\n(SIMULACIÓN: no se borró nada. Para aplicarlo: limpiarDuplicadosTodo(true))';
    Logger.log(msg);
    return { filas:filas.length, personasDia:personasDia, sobrantes:aBorrar.length, porDia:porDia, aplicado:false };
  }
  const r=_borrarConPresupuesto_(sh, aBorrar, MS_PRESUPUESTO_BORRADO);
  invalidarHoja_('ASISTENCIA');
  msg += '\n\nAPLICADO: '+r.borradas+' fila(s) borrada(s).'
    + (r.pendientes ? '\n⏳ Quedaron '+r.pendientes+' por borrar (se agotó el presupuesto de tiempo). '
                      +'Vuelve a ejecutar limpiarDuplicadosTodo(true): sigue donde iba.' : '');
  Logger.log(msg);
  return { filas:filas.length, personasDia:personasDia, sobrantes:aBorrar.length, porDia:porDia,
           borradas:r.borradas, pendientes:r.pendientes, aplicado:true };
}
function diagnosticoDuplicadosTodo(){ return _duplicadosTodo_(false); }
function limpiarDuplicadosTodo(aplicar){ return _duplicadosTodo_(aplicar===true); }

/**
 * `borrarFilas_` con presupuesto de tiempo. Mismos tramos contiguos y mismo orden (de abajo hacia
 * arriba, si no cada borrado correría los números de las siguientes); lo único que añade es que corta
 * al agotarse `ms` y devuelve cuántas quedaron. Cortar es SEGURO precisamente por el orden: lo que
 * queda pendiente está por ENCIMA de lo ya borrado, así que conserva su número de fila.
 */
function _borrarConPresupuesto_(sh, filas, ms){
  if(!filas || !filas.length) return { borradas:0, pendientes:0 };
  const orden=filas.slice().sort(function(a,b){ return a-b; });
  const tramos=[]; let ini=orden[0], prev=orden[0];
  for(let i=1;i<orden.length;i++){
    if(orden[i]!==prev+1){ tramos.push([ini,prev]); ini=orden[i]; }
    prev=orden[i];
  }
  tramos.push([ini,prev]);
  const t0=Date.now();
  let borradas=0, t=tramos.length-1;
  for(; t>=0; t--){
    if(Date.now()-t0 > ms) break;
    sh.deleteRows(tramos[t][0], tramos[t][1]-tramos[t][0]+1);
    borradas += tramos[t][1]-tramos[t][0]+1;
  }
  let pendientes=0;
  for(let k=0;k<=t;k++) pendientes += tramos[k][1]-tramos[k][0]+1;
  return { borradas:borradas, pendientes:pendientes };
}

/**
 * Recorta la rejilla SOBRANTE de cada hoja: las filas por debajo de la última con datos (dejando
 * MARGEN_FILAS_LIBRES de colchón) y las columnas a la derecha de la última con datos. La grilla nunca
 * se encoge sola —`ensureRows_` solo crece, en bloques de 1.000— y esas celdas vacías cuentan para el
 * techo de 10 M y para lo que el navegador tiene que cargar.
 *
 * DOS GUARDAS, porque esto sí borra:
 *   · Nunca por debajo de `getLastRow()`/`getLastColumn()`: se borra únicamente rejilla VACÍA.
 *   · Nunca por debajo de los encabezados que el código define para esa hoja (`HEADERS_DE_HOJA`),
 *     aunque hoy estén vacíos — si no, la siguiente escritura tendría que volver a crear las columnas.
 * Se ejecuta al FINAL, después de borrar las filas que sobren: si no, se recorta un hueco que la
 * limpieza va a dejar libre un minuto después.
 *
 * LO ÚNICO QUE HAY QUE MIRAR ANTES DE APLICAR: si alguien ancló a mano un gráfico, un rango con nombre
 * o una nota MUY por debajo/a la derecha de los datos, se va con el recorte. En este archivo no hay
 * nada de eso (lo escribe todo el script), pero la simulación imprime hoja por hoja lo que dejaría.
 */
function _compactarGrilla_(aplicar){
  const lineas=[]; let ganadas=0;
  ss_().getSheets().forEach(function(sh){
    const nombre=sh.getName();
    const headers=HEADERS_DE_HOJA[nombre];
    const maxR=sh.getMaxRows(), maxC=sh.getMaxColumns();
    const baseR=Math.max(sh.getLastRow(), 1), baseC=Math.max(sh.getLastColumn(), headers?headers.length:1, 1);
    const sobranR=maxR-baseR-MARGEN_FILAS_LIBRES, sobranC=maxC-baseC;
    if(sobranR<=0 && sobranC<=0) return;
    const antes=maxR*maxC;
    const despues=(sobranR>0 ? baseR+MARGEN_FILAS_LIBRES : maxR) * (sobranC>0 ? baseC : maxC);
    ganadas += antes-despues;
    lineas.push('  · '+nombre+' — '+maxR+'×'+maxC+' → '+(sobranR>0?baseR+MARGEN_FILAS_LIBRES:maxR)+'×'+(sobranC>0?baseC:maxC)
      + '  (libera '+(antes-despues)+' celdas)');
    if(!aplicar) return;
    // Columnas primero: borrar filas no cambia la numeración de las columnas, y al revés tampoco,
    // pero hacerlo en este orden deja el `deleteRows` sobre una hoja ya más angosta.
    if(sobranC>0) sh.deleteColumns(baseC+1, sobranC);
    if(sobranR>0) sh.deleteRows(baseR+MARGEN_FILAS_LIBRES+1, sobranR);
  });
  const msg='COMPACTAR GRILLA — '+(lineas.length?lineas.length+' hoja(s) con rejilla sobrante:':'no hay rejilla sobrante que recortar.')
    + (lineas.length ? '\n'+lineas.join('\n')+'\n\nTotal a liberar: '+ganadas+' celdas.' : '')
    + (lineas.length && !aplicar ? '\n\n(SIMULACIÓN: no se borró nada. Para aplicarlo: compactarGrilla(true))' : '')
    + (lineas.length && aplicar ? '\n\nAPLICADO.' : '');
  Logger.log(msg);
  return { hojas:lineas.length, celdas:ganadas, aplicado:!!aplicar };
}
function compactarGrilla(aplicar){ return _compactarGrilla_(aplicar===true); }
