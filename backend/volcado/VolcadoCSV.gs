/**
 * VolcadoCSV.gs — volcado Sheet → CSV por hoja (Fase 1 de la migración 4.01, D180).
 *
 * QUÉ ES. Un Apps Script APARTE (proyecto independiente, NO se pega en Codigo.gs ni en
 * CodigoAsistencias.gs: los .gs de producción no se tocan) que lee cada hoja con `getValues()` y deja
 * un CSV por hoja en una carpeta de Drive, más un `manifiesto.json` con filas, columnas y encabezados.
 * Es la materia prima del BACKFILL de cada fase (§3 del informe): los CSV se cargan en Postgres con
 * `\copy` sobre las tablas de worker/sql/001_esquema.sql (ver worker/sql/README.md).
 *
 * INSTALACIÓN (una vez):
 *   1. script.google.com → Nuevo proyecto → pegar este archivo entero → guardar como «Volcado CSV TM2».
 *   2. Ejecutar `volcarObra()` (o `volcarAsistencias()`, o `volcarTodo()`). La primera vez pide permiso
 *      de Sheets y Drive (la cuenta del dueño, la misma que es propietaria de los Sheets).
 *   3. Los CSV quedan en Drive: `Galca_volcado/<obra_id>/<yyyy-MM-dd_HHmm>/<HOJA>.csv`.
 * Opcional: `programarVolcadoDiario()` deja un trigger a las 03:00 (después del respaldo de las 02:00).
 *
 * FORMATO DEL CSV (pensado para `\copy … CSV HEADER` de Postgres):
 *   · UTF-8, coma, comillas dobles (RFC 4180): cualquier celda con coma, comilla o salto de línea va
 *     entre comillas y las comillas internas se duplican.
 *   · Primera fila = encabezados TAL CUAL están en la hoja (así se ve si alguna columna se movió).
 *   · Fechas (celdas Date de Sheets) → 'yyyy-MM-dd' si son fecha pura y 'yyyy-MM-dd HH:mm:ss' (hora de
 *     America/Bogota) si traen hora (columnas `timestamp`). Números → tal cual (punto decimal).
 *     Booleanos → TRUE/FALSE. Vacío → cadena vacía (Postgres lo lee como '' en text; para date/numeric
 *     se usa `NULL ''` en el \copy, ver README).
 *   · Solo filas hasta `getLastRow()`: la rejilla vacía que inserta ensureRows_ no se vuelca.
 *   · Las filas se leen en bloques de BLOQUE filas para no pasarse del límite de memoria en hojas grandes.
 *
 * QUÉ NO HACE: no transforma nombres ni valores (el mapeo hoja→tabla y las normalizaciones son cosa de la
 * carga), no borra nada, no toca los Sheets (solo lee). Idempotente: cada corrida crea su carpeta con hora.
 */

/* ---------- configuración ---------- */
var VOLCADO_OBRA_ID   = 'tm2sur';                    // obra_id de worker/sql/001_esquema.sql
var VOLCADO_CARPETA   = 'Galca_volcado';             // carpeta raíz en «Mi unidad»
var VOLCADO_TZ        = 'America/Bogota';
var VOLCADO_BLOQUE    = 5000;                        // filas por lectura (ASISTENCIA ya pasa de 15k)

// Los DOS Sheets: mismos ids que SHEET_ID en backend/Codigo.gs y backend/CodigoAsistencias.gs.
var VOLCADO_SHEETS = {
  obra: {
    id: '1OEAZCcj_kgVS6jWXxOSgyvm57sOsJ7fA1mRTJPU-icM',
    // transaccionales (backfill) + catálogos a mano (pull inicial). LOG se vuelca por si sirve de histórico.
    hojas: ['BANDEJA','DATA','MAQUINARIA','VOLQUETAS','OBSERVACIONES','MAQUINAS','TABLERO','USUARIOS','LOG',
            'PARTE_BANDEJA','PARTE_EQUIPOS','PARTE_OPERADORES','PARTE_CC','PARTE_ITEMS','PARTE_ACTIVIDADES',
            'BASE','CUBICAJE']
  },
  asistencias: {
    id: '1KrhzaIg3BSspyi0oH0gHkAJnSRXaOIdel_pKaMVHX9w',
    hojas: ['ASISTENCIA','PERSONAL','EXTRAS_ADMIN','NOTAS_ASISTENCIA','LOG',
            'CUADRILLAS','CONFIG','FESTIVOS','TURNOS','CAT_CC','CC_USADOS','CAT_MOTIVOS','MOTIVOS_USADOS','CAT_TRABAJADORES']
  }
};

/* ---------- puntos de entrada (se ejecutan a mano desde el editor) ---------- */
function volcarObra(){        return volcarSheet_('obra', VOLCADO_SHEETS.obra); }
function volcarAsistencias(){ return volcarSheet_('asistencias', VOLCADO_SHEETS.asistencias); }
function volcarTodo(){        return [volcarObra(), volcarAsistencias()]; }
/* Volcado de UNA hoja suelta (p. ej. volcarHoja('obra','PARTE_BANDEJA')). */
function volcarHoja(modulo, nombreHoja){ var s=VOLCADO_SHEETS[modulo]; return volcarSheet_(modulo, { id:s.id, hojas:[nombreHoja] }); }
/* Trigger diario a las 03:00 Bogotá (después del respaldoDiario de las 02:00). Idempotente. */
function programarVolcadoDiario(){
  quitarVolcadoDiario();
  ScriptApp.newTrigger('volcarTodo').timeBased().everyDays(1).atHour(3).inTimezone(VOLCADO_TZ).create();
  Logger.log('Trigger diario de volcarTodo a las 03:00 ('+VOLCADO_TZ+') instalado.');
}
function quitarVolcadoDiario(){
  ScriptApp.getProjectTriggers().forEach(function(t){ if(t.getHandlerFunction()==='volcarTodo') ScriptApp.deleteTrigger(t); });
}

/* ---------- motor ---------- */
function volcarSheet_(modulo, cfg){
  var t0=Date.now();
  var ss=SpreadsheetApp.openById(cfg.id);
  var sello=Utilities.formatDate(new Date(), VOLCADO_TZ, 'yyyy-MM-dd_HHmm');
  var carpeta=carpetaAnidada_([VOLCADO_CARPETA, VOLCADO_OBRA_ID, sello+'_'+modulo]);
  var manifiesto={ obra_id:VOLCADO_OBRA_ID, modulo:modulo, sheet_id:cfg.id, sheet_nombre:ss.getName(), generado:sello, zona_horaria:VOLCADO_TZ, hojas:[] };
  cfg.hojas.forEach(function(nombre){
    var sh=ss.getSheetByName(nombre);
    if(!sh){ manifiesto.hojas.push({ hoja:nombre, existe:false }); Logger.log('· '+nombre+': no existe (se salta)'); return; }
    var r=volcarHoja_(sh, carpeta);
    r.hoja=nombre; r.existe=true; manifiesto.hojas.push(r);
    Logger.log('· '+nombre+': '+r.filas+' filas × '+r.columnas+' col → '+r.archivo+' ('+r.bytes+' bytes)');
  });
  manifiesto.ms=Date.now()-t0;
  carpeta.createFile('manifiesto.json', JSON.stringify(manifiesto, null, 1), 'application/json');
  Logger.log(modulo+': '+manifiesto.hojas.length+' hoja(s) en '+manifiesto.ms+' ms → '+carpeta.getUrl());
  return { carpeta:carpeta.getUrl(), manifiesto:manifiesto };
}

/* Lee la hoja por bloques y escribe HOJA.csv. Devuelve {archivo, filas, columnas, encabezados, bytes}. */
function volcarHoja_(sh, carpeta){
  var last=sh.getLastRow(), nCols=sh.getLastColumn();
  var encabezados = last>=1 && nCols>=1 ? sh.getRange(1,1,1,nCols).getValues()[0].map(function(v){ return String(v==null?'':v).trim(); }) : [];
  var lineas=[ csvFila_(encabezados) ];
  var filas=0;
  for(var f=2; f<=last; f+=VOLCADO_BLOQUE){
    var n=Math.min(VOLCADO_BLOQUE, last-f+1);
    var v=sh.getRange(f,1,n,nCols).getValues();
    for(var i=0;i<v.length;i++){
      if(filaVacia_(v[i])) continue;                     // huecos de la rejilla: no son datos
      lineas.push(csvFila_(v[i].map(celdaCsv_))); filas++;
    }
  }
  var contenido=lineas.join('\r\n')+'\r\n';
  var archivo=carpeta.createFile(sh.getName()+'.csv', contenido, 'text/csv');
  return { archivo:archivo.getName(), filas:filas, columnas:nCols, encabezados:encabezados, bytes:contenido.length, url:archivo.getUrl() };
}

/* ---------- formato ---------- */
function celdaCsv_(v){
  if(v===null || v===undefined) return '';
  if(typeof v==='object' && typeof v.getFullYear==='function'){    // Date de Sheets (duck-typing, como fdate)
    var h=Utilities.formatDate(v, VOLCADO_TZ, 'HH:mm:ss');
    return Utilities.formatDate(v, VOLCADO_TZ, h==='00:00:00' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss');
  }
  if(typeof v==='boolean') return v ? 'TRUE' : 'FALSE';
  if(typeof v==='number') return String(v);                          // punto decimal, sin separador de miles
  return String(v);
}
function csvCampo_(s){
  s=String(s==null?'':s);
  return /[",\r\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}
function csvFila_(campos){ return campos.map(csvCampo_).join(','); }
function filaVacia_(r){ for(var j=0;j<r.length;j++){ if(r[j]!=='' && r[j]!==null && r[j]!==undefined) return false; } return true; }

/* ---------- Drive ---------- */
function carpetaAnidada_(nombres){
  var actual=DriveApp.getRootFolder();
  nombres.forEach(function(n){ var it=actual.getFoldersByName(n); actual = it.hasNext() ? it.next() : actual.createFolder(n); });
  return actual;
}
