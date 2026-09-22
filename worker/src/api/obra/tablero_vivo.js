/**
 * api/obra/tablero_vivo.js — el Tablero de Producción EN VIVO desde la DATA de Galca (V3-11 Fases B+C · D185, sep-2026;
 * V3-16 añade `personal`, sep-2026).
 *
 * Lo que decidió el dueño (18-sep-2026): «la DATA en línea que actualice plenamente el Tablero». El Tablero deja de
 * leer la hoja DATOS del Excel (toda la producción, de todos los periodos, sale de la DATA de Galca) y se calcula AL
 * ABRIRLO, para cualquiera — también el enlace público sin sesión de los directivos —, sin «Actualizar» ni publicar.
 * El cálculo del motor (construir) sigue en el NAVEGADOR (medido: ~0,7 s de CPU con los libros reales, casi todo
 * parsear xlsx): aquí solo se entregan sus ENTRADAS ya listas.
 *
 *   GET  ?action=tablero_vivo                   PÚBLICO (sin token, como `tablero`: ampliación de D161 decidida por el
 *                                               dueño; index.js lo deja pasar sin token, no escribe LOG y lo cachea 60 s)
 *        → {ok, fuente:'galca', dias, proy, horas, horas_meta, datos_hasta, generado, fc_dias, personal, personal_hasta}
 *          dias        = la MISMA forma que leerProduccion del motor: [{f, p, exc, apr, pre, nap, ter1, ter2, ter, sub1,
 *                        sub2, sub, bas1, bas2, bas, t}] — una por FECHA de la DATA (cualquier área; sin partida = ceros),
 *                        en SUELTO-EQUIVALENTE = Σ CANTIDAD compacta × fc de la Proyección (pliegue.js). El motor divide
 *                        por ese mismo fc (proy.fc = fc_dias), así que TODA cifra compacta del Tablero es Σ CANTIDAD.
 *                        p = mes de CIERRE del periodo 16→15 con piso 2025-06 (MAPEO!B19, la fórmula de DATOS!C);
 *                        t = clima del DÍA (regla D182) en MAYÚSCULAS, como leía la columna X de DATOS.
 *          proy        = lo mismo que ?action=proyeccion_tablero (plan, proyectado, fc, contrato, base_acum, base_corte,
 *                        acta_base, actualizado, ok, fuente) SIN `usuario` (nadie con nombre en la lectura pública);
 *                        null (+ proy_error) si la Proyección no está en la BD: el Tablero cae a sus constantes.
 *          horas       = la salida CRUDA de leerHoras que subió admin/jefe (tablero_horas, 008) o null si nunca se subió.
 *                        Solo códigos de máquina, tipos, CC y horas: la validación de tableroHorasGuardar rechaza
 *                        cualquier otra clave, así que no puede colarse un nombre de operador.
 *          horas_meta  = {archivo, cargado_ts ('YYYY-MM-DD HH:MM' Bogotá)} o null. Sin `cargado_por`.
 *          datos_hasta = la última FECHA de la DATA ('' si no hay); generado = ahora en Bogotá 'YYYY-MM-DD HH:MM'.
 *          personal    = V3-16: horas-hombre y nº de personas por partida, desde ASISTENCIA (solo UF1/UF2, presentes,
 *                        con CC). [{f, uf:'UF1'|'UF2', act:'excavacion'|'terraplen'|'subbase'|'base'|'otras', n, h,
 *                        c:[{k, n, h}]}], una entrada por (f, uf, act) con n>0 o h>0, ordenada por f/uf/act. `h` con
 *                        el MISMO clasificador del Parte de Navision (horas-nomina.js, D112: una sola fuente) — nunca
 *                        copiado. `c` = desglose por CARGO normalizado (sin tildes/mayúsculas/espacios de más;
 *                        etiqueta capitalizada), ordenado por h desc y luego k asc; Σn/Σh de `c` = n/h de la entrada
 *                        (con redondeo). Cargo = asistencia.cargo si no está vacío, si no la ficha de PERSONAL (la
 *                        estancia de fecha_ingreso más reciente); vacío en ambos → 'Sin cargo registrado'. Una
 *                        persona con 2 filas de cargo distinto el mismo (f,uf,act) cuenta en `c` por el cargo de su
 *                        PRIMERA fila. null (+ `personal_error`) si ASISTENCIA no se pudo leer: el resto de
 *                        tablero_vivo sigue igual. Sin ningún nombre/cédula/código/cuadrilla/CC crudo (D161: lectura
 *                        pública sin token); `c` solo lleva etiquetas de cargo y cifras agregadas.
 *          personal_hasta = la última fecha con filas de asistencia incluidas ('' si ninguna).
 *   POST {action:'tablero_horas_guardar', horas, archivo}  TOKEN, admin/jefe → guarda la salida de leerHoras del libro
 *        de partes (una vez, cuando llega uno nuevo) → {ok, horas_meta:{archivo, cargado_ts, partes, corte}, version}
 *
 * El AVANCE contra el contrato lo arma el motor en el navegador con `proy` (decisión final del dueño, 19-sep-2026):
 * base_acum (producción base certificada hasta el cierre del acta base) + Σ de `dias` con f ≥ base_corte (excavación
 * común = aprovechable + no aprovechable; préstamo aparte) ÷ contrato. Aquí no hay nada más que entregar para eso.
 * Sin 008 en la BD, la lectura responde ok:false legible y el Tablero cae a la foto. Sin 006 (Proyección) sí calcula
 * en vivo: fc = FC_RESPALDO (pliegue.js) y proy = null + proy_error, así que el Tablero usa sus constantes (D185).
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 */
import { OBRA_ID, ZONA_HORARIA, json, permiso_, logMarcar_, fdateValida_, fdate, deriveArea } from '../../comun.js';
import { sumaPorDia_ } from './pliegue.js';
import { proyeccionTableroDatos_ } from './proyeccion.js';
import { gzipB64_, gunzipB64_ } from './tablero.js';
import { getConfigMap, getFestivos } from '../asistencias/catalogos.js';
import { turnosCliente_ } from '../asistencias/lectura.js';
// D112: una sola fuente para el clasificador de horas (Parte de Navision / horas-persona); NUNCA se copia
// su lógica. horas-nomina.js es un script CJS-condicional (module.exports guardado por typeof) pensado
// para <script> en el navegador; esbuild (wrangler) detecta ese module.exports como objeto literal y
// sintetiza los named exports de abajo sin tocar una línea del archivo.
import { clasificarHoras, turnoRowFor, tipoJornadaDeFecha } from '../../../../horas-nomina.js';

const PERIODO_PISO = '2025-06';                    // MAPEO!B19: DATOS!C = MAX(B19, mes de cierre)
const HORAS_ROLES = ['admin','jefe'];              // D185: suben el libro de partes los mismos que publicaban la foto
export const VAL_MAX_HORAS_CHARS = 1000000;        // = MAX_BODY_BYTES de index.js (la salida real pesa ~340 KB)
const H_MAX_PARTES = 20000, H_MAX_CC = 500, H_MAX_NUM = 100000;
// La forma EXACTA de leerHoras (tablero-produccion.js). Listas blancas: lo que no esté aquí no se guarda.
const H_CLAVES = ['partes','cc','corte','descartadas','negativas'];
const H_PARTE  = ['p','f','act','cod','tipo','uf','h','mtto','varada','lluvia','averia'];
const H_CC     = ['cc','horas','filas','act','flota'];
const H_ACTS   = ['excavacion','terraplen','subbase','base'];                   // CC_ACT del motor
const H_TIPOS  = ['EXCAVADORA','BULLDOZER','MOTONIVELADORA','FINISHER'];        // NOMTIPO del motor
const H_COD_RE = /^[A-Z]{1,8}[0-9]{1,6}$/;         // código de máquina ya normalizado (normCod): EXC001, MO03, NH69…
const TV_SIN_008 = 'El Tablero en vivo todavía no está en la base de datos (falta aplicar worker/sql/008_tablero_vivo.sql).';
// V3-16: partida por el SUFIJO del CC (mismo mapeo que CC_ACT de tablero-produccion.js). Solo estos dos
// pares abren excavacion/terraplen/subbase/base; cualquier otro sufijo (I010305, tres segmentos…) = 'otras'.
const PERS_ACT = { '02.05':'excavacion', '02.06':'excavacion', '02.07':'terraplen', '03.01':'subbase', '03.03':'base' };

/* ---------- utilidades ---------- */
function txt_(v){ return String(v==null?'':v).trim(); }
function esSinTablas_(err){ return String((err && err.code) || '')==='42P01'; }
// Periodo 16→15 nombrado por el mes en que CIERRA (periodoDe del motor), con el piso de DATOS!C.
export function periodoDia_(f){
  let y = Number(f.slice(0,4)), m = Number(f.slice(5,7));
  if(Number(f.slice(8,10)) > 15){ m++; if(m>12){ m=1; y++; } }
  const p = y+'-'+String(m).padStart(2,'0');
  return p < PERIODO_PISO ? PERIODO_PISO : p;
}
function ahoraBogota_(){
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone:ZONA_HORARIA, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(new Date()).forEach(function(x){ p[x.type]=x.value; });
  return p.year+'-'+p.month+'-'+p.day+' '+p.hour+':'+p.minute;
}
// jsonb que postgres.js/PGlite devuelve como objeto, o como TEXTO JSON si quedó doble-codificado (ver tablero.js).
function jsonbObjeto_(v){
  if(v && typeof v==='object' && !Array.isArray(v)) return v;
  if(typeof v==='string' && v){ try{ const o=JSON.parse(v); return (o && typeof o==='object' && !Array.isArray(o)) ? o : null; }catch(err){ return null; } }
  return null;
}

/* ---------- V3-16: personal (horas-hombre y nº de personas) por (fecha, UF, partida) ----------
 * Del CC crudo de ASISTENCIA ('3701.02.05| EXCAVACION…') solo el código antes de '|' importa: el prefijo
 * (3701→UF1, 3702→UF2; cualquier otro —3703, etc.— se EXCLUYE) y, si el código completo es «NNNN.NN.NN»,
 * el sufijo decide la partida (PERS_ACT); cualquier otra forma (I010305, más segmentos…) es 'otras'.
 * El Tablero es de TIERRAS: las filas de drenajes (deriveArea de comun.js, D70: capítulo 06.* ODT, 07.* ODL)
 * no entran, así que «otras» son solo los demás CC de tierras (conformación, transporte, encargados…). */
function ufDeCC_(cod){
  const m = /^(3701|3702)\./.exec(cod);
  return m ? (m[1]==='3701' ? 'UF1' : 'UF2') : '';
}
function actDeCC_(cod){
  const m = /^(?:3701|3702)\.(\d{2}\.\d{2})$/.exec(cod);
  return m ? (PERS_ACT[m[1]] || 'otras') : 'otras';
}
export const SIN_CARGO = 'Sin cargo registrado';        // etiqueta cuando el cargo falta en asistencia y en la ficha
// 'ñ'/'Ñ' se preservan (D112-style, sin tocar la lógica de terceros): NFD descompondría la tilde de la eñe
// junto con los acentos normales, así que se protege antes de quitar diacríticos.
function sinTildes_(s){
  return String(s||'').replace(/[ñÑ]/g, function(ch){ return ch==='ñ' ? '\u0001' : '\u0002'; })
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\u0001/g, 'ñ').replace(/\u0002/g, 'Ñ');
}
// Clave para agrupar variantes de escritura (sin tildes, MAYÚSCULAS, espacios colapsados) + etiqueta a mostrar
// (la clave en minúsculas con la primera letra en mayúscula). NO corrige erratas ni inventa sinónimos.
function normCargo_(s){
  const t = sinTildes_(s).toUpperCase().replace(/\s+/g, ' ').trim();
  if(!t) return { key:'', label:SIN_CARGO };
  return { key:t, label: t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() };
}
// Mapa codigo/cedula -> cargo de PERSONAL, con la estancia de fecha_ingreso MÁS RECIENTE (NULL = la más
// antigua; MISMO criterio que horasPersona, asistencias/lectura.js). Una sola consulta, sin filas repetidas.
function fichaCargoMapa_(filasPersonal){
  const porCodigo = new Map(), porCedula = new Map();
  filasPersonal.forEach(function(p){
    const codigo = String(p.codigo||'').trim(), cedula = String(p.cedula||'').trim(), fi = fdate(p.fecha_ingreso);
    const cargo = String(p.cargo||'').trim();
    if(codigo){ const a = porCodigo.get(codigo); if(!a || fi >= a.fi) porCodigo.set(codigo, { cargo:cargo, fi:fi }); }
    if(cedula){ const a = porCedula.get(cedula); if(!a || fi >= a.fi) porCedula.set(cedula, { cargo:cargo, fi:fi }); }
  });
  return function(codigo, cedula){
    if(codigo && porCodigo.has(codigo)) return porCodigo.get(codigo).cargo;
    if(cedula && porCedula.has(cedula)) return porCedula.get(cedula).cargo;
    return '';
  };
}
// {personal, personal_hasta} o {personal:null, personal_error}. Nunca tumba tablero_vivo: el que llama
// atrapa cualquier excepción (tabla sin migrar, columna que falte…) y sigue sin este bloque.
async function personalDelTablero_(c){
  const filas = await c.sql`SELECT fecha, codigo, cedula, nombre, cargo, cc, hora_entrada, hora_salida, turno, id_registro
    FROM asistencia WHERE obra_id=${OBRA_ID} AND presente='Si' AND cc<>'' ORDER BY fecha, id_registro`;
  const cfg = await getConfigMap(c), festivos = await getFestivos(c), turnos = await turnosCliente_(c);
  // Respaldo de cargo desde la FICHA (PERSONAL): si esta consulta falla, se sigue sin ese respaldo (regla 1).
  let cargoDeFicha_ = function(){ return ''; };
  try{
    const fp = await c.sql`SELECT codigo, cedula, cargo, fecha_ingreso FROM personal WHERE obra_id=${OBRA_ID}`;
    cargoDeFicha_ = fichaCargoMapa_(fp);
  }catch(err){ /* sin respaldo de ficha; el cargo de la fila (o SIN_CARGO) sigue funcionando */ }

  const grupos = new Map();       // 'f|uf|act' -> { f, uf, act, personas:Set, h, cargos:Map<clave,{label,personas,h}>, asig:Map<id,clave> }
  let hasta = '';
  for(let i=0;i<filas.length;i++){
    const r = filas[i];
    const cod = String(r.cc||'').split('|')[0].trim();
    const uf = ufDeCC_(cod);
    if(!uf) continue;                                    // no es UF1/UF2 (p. ej. 3703 = UF3): se excluye
    if(deriveArea(cod)!=='tierras') continue;            // el Tablero es de TIERRAS: drenajes ODT (.06.*) y ODL (.07.*) fuera (D70)
    const f = fdate(r.fecha);
    if(f > hasta) hasta = f;
    const act = actDeCC_(cod);
    const key = f+'|'+uf+'|'+act;
    let g = grupos.get(key);
    if(!g){ g = { f:f, uf:uf, act:act, personas:new Set(), h:0, cargos:new Map(), asig:new Map() }; grupos.set(key, g); }
    const codigo = String(r.codigo||'').trim(), cedula = String(r.cedula||'').trim();
    const idPersona = codigo || cedula || String(r.nombre||'').trim();
    if(idPersona) g.personas.add(idPersona);              // dedupe por identidad (por seguridad; D126)
    // Sin identidad (codigo/cedula/nombre vacíos, caso raro): cada fila es su propia "persona" para el
    // desglose por cargo, así una fila anónima nunca se funde con otra (no cuenta en `n`, igual que antes).
    const id = idPersona || ('__anon'+i);
    const tipoJ = tipoJornadaDeFecha(f, festivos);
    const tr = turnoRowFor(r.turno, f, turnos, tipoJ);
    const cl = clasificarHoras(tipoJ, r.hora_entrada, r.hora_salida, cfg, tr);
    const horasFila = (cl.ordinarias||0) + (cl.ord_domfest||0) + (cl.extra_diurna||0) + (cl.extra_nocturna||0) + (cl.extra_domfest||0);
    g.h += horasFila;
    // Cargo por fila: asistencia.cargo si no está vacío, si no la ficha de PERSONAL. Dos filas de la MISMA
    // persona con cargos distintos el mismo (f,uf,act): manda el cargo de su PRIMERA fila (regla 3).
    let clave = g.asig.get(id);
    if(clave === undefined){
      const cargoTxt = String(r.cargo||'').trim() || cargoDeFicha_(codigo, cedula);
      const nc = normCargo_(cargoTxt);
      clave = nc.key;
      g.asig.set(id, clave);
      if(!g.cargos.has(clave)) g.cargos.set(clave, { label:nc.label, personas:new Set(), h:0 });
      if(idPersona) g.cargos.get(clave).personas.add(idPersona);
    }
    g.cargos.get(clave).h += horasFila;
  }
  const claves = [...grupos.keys()].sort();
  const personal = claves.map(function(k){
    const g = grupos.get(k);
    const c2 = [...g.cargos.values()].map(function(x){ return { k:x.label, n:x.personas.size, h:Math.round(x.h*100)/100 }; })
      .sort(function(a, b){ return b.h !== a.h ? b.h - a.h : (a.k < b.k ? -1 : (a.k > b.k ? 1 : 0)); });
    return { f:g.f, uf:g.uf, act:g.act, n:g.personas.size, h:Math.round(g.h*100)/100, c:c2 };
  }).filter(function(x){ return x.n>0 || x.h>0; });
  return { personal:personal, personal_hasta:hasta };
}

/* ---------- GET ?action=tablero_vivo (PÚBLICO) ---------- */
export async function tableroVivoLeer(c, params){
  let pl;
  try{ pl = await sumaPorDia_(c); }
  catch(err){ if(esSinTablas_(err)) return json(c, { ok:false, error:TV_SIN_008 }); throw err; }
  const dias = pl.filas.map(function(r){
    return { f:r.f, p:periodoDia_(r.f), exc:r.exc, apr:r.apr, pre:r.pre, nap:r.nap,
             ter1:r.ter1, ter2:r.ter2, ter:r.ter, sub1:r.sub1, sub2:r.sub2, sub:r.sub,
             bas1:r.bas1, bas2:r.bas2, bas:r.bas, t:r.t.toUpperCase() };
  });

  // La proyección, la MISMA que ?action=proyeccion_tablero pero sin el nombre de quien la editó.
  let proy = null, proyError = '';
  try{
    const pr = await proyeccionTableroDatos_(c);
    if(pr && pr.ok){ proy = Object.assign({}, pr); delete proy.usuario; }
    else proyError = (pr && pr.error) || 'La Proyección no respondió.';
  }catch(err){ if(!esSinTablas_(err)) throw err; proyError = 'La Proyección todavía no está en la base de datos.'; }

  // Las horas de máquina guardadas (tablero_horas): la salida cruda de leerHoras, descomprimida.
  let horas = null, horasMeta = null, horasError = '';
  const hr = await c.sql`SELECT horas, archivo, to_char(cargado_ts AT TIME ZONE ${ZONA_HORARIA}, 'YYYY-MM-DD HH24:MI') AS ts
    FROM tablero_horas WHERE obra_id=${OBRA_ID} LIMIT 1`;
  if(hr.length){
    let h = jsonbObjeto_(hr[0].horas);
    if(h && typeof h.z==='string' && !Array.isArray(h.partes)){
      try{ h = JSON.parse(await gunzipB64_(h.z)); }catch(err){ h = null; horasError = 'Las horas guardadas no se pudieron leer: vuelve a cargar el libro de partes.'; }
    }
    horas = (h && Array.isArray(h.partes)) ? h : null;
    horasMeta = { archivo:txt_(hr[0].archivo), cargado_ts:txt_(hr[0].ts) };
  }

  // V3-16: personal (horas-hombre y nº de personas) por (fecha, UF, partida) desde ASISTENCIA. Público y
  // sin ningún dato de persona (D161): si falla, el Tablero sigue funcionando sin este bloque.
  let personal = null, personalHasta = '', personalError = '';
  try{ const pd = await personalDelTablero_(c); personal = pd.personal; personalHasta = pd.personal_hasta; }
  catch(err){ personalError = esSinTablas_(err) ? 'La asistencia todavía no está en la base de datos.' : 'La asistencia no se pudo leer.'; }

  // `ok` va PRIMERO: index.js reconoce una respuesta cacheable por el prefijo '{"ok":true'.
  const out = { ok:true, fuente:'galca', dias:dias, proy:proy, horas:horas, horas_meta:horasMeta,
                datos_hasta: dias.length ? dias[dias.length-1].f : '', generado:ahoraBogota_(), fc_dias:pl.fc,
                personal:personal, personal_hasta:personalHasta };
  if(proyError) out.proy_error = proyError;
  if(horasError) out.horas_error = horasError;
  if(personalError) out.personal_error = personalError;
  return json(c, out);
}

/* ---------- POST {action:'tablero_horas_guardar', horas, archivo} (TOKEN, admin/jefe) ---------- */
export async function tableroHorasGuardar(c, body, ses){
  const permiso = permiso_(ses, HORAS_ROLES, [], 'cargar las horas de maquinaria del Tablero');
  if(!permiso.ok){ logMarcar_(c, 'rechazado', 'tablero_horas: '+permiso.error); return json(c, { ok:false, error:permiso.error }); }

  const v = validarHoras_(body && body.horas);
  if(v.error){
    const msg = 'Las horas de maquinaria no tienen la forma del libro de partes: '+v.error+'. No se guardó nada.';
    logMarcar_(c, 'rechazado', 'tablero_horas: '+v.error);
    return json(c, { ok:false, error:msg });
  }
  const crudo = JSON.stringify(v.horas);
  if(crudo.length > VAL_MAX_HORAS_CHARS){
    logMarcar_(c, 'rechazado', 'tablero_horas: tamaño');
    return json(c, { ok:false, error:'Las horas de maquinaria pesan demasiado ('+crudo.length+' caracteres; máx. '+VAL_MAX_HORAS_CHARS+'). No se guardó nada.' });
  }
  const archivo = txt_(body.archivo).slice(0, 200);
  const usuario = txt_(ses && ses.usuario) || txt_(body.usuario);
  // Comprimida como la foto de `tablero` ({z:<gzip base64>}; ~340 KB → ~20 KB): el write grande al pooler de
  // Supabase es lo que se caía con «write CONNECTION_CLOSED» (tablero.js, 16-sep-2026). `::text::jsonb` para que
  // postgres.js no vuelva a hacer JSON.stringify del texto (doble codificación).
  const z = { z: await gzipB64_(crudo) };
  const r = await c.sql`INSERT INTO tablero_horas (obra_id, horas, archivo, cargado_por, cargado_ts, version)
    VALUES (${OBRA_ID}, ${JSON.stringify(z)}::text::jsonb, ${archivo}, ${usuario}, now(), 1)
    ON CONFLICT (obra_id) DO UPDATE SET horas=EXCLUDED.horas, archivo=EXCLUDED.archivo, cargado_por=EXCLUDED.cargado_por,
      cargado_ts=EXCLUDED.cargado_ts, version=tablero_horas.version+1
    RETURNING version, to_char(cargado_ts AT TIME ZONE ${ZONA_HORARIA}, 'YYYY-MM-DD HH24:MI') AS ts`;
  const meta = { archivo:archivo, cargado_ts:txt_(r[0].ts), partes:v.horas.partes.length, corte:v.horas.corte };
  return json(c, { ok:true, horas_meta:meta, version:Number(r[0].version),
    mensaje:'Se guardaron las horas de '+meta.partes+' partes de maquinaria'+(meta.corte ? ' (hasta el '+meta.corte+')' : '')+'.' });
}

/* ---------- forma de la salida de leerHoras (lista blanca) ----------
 * Devuelve {horas:<copia limpia>} o {error:'<texto legible>'}. Las claves tienen que ser EXACTAMENTE las de leerHoras
 * (ni una de más: así no puede entrar un nombre de operador a una lectura pública) y los valores, del tipo y rango de
 * lo que produce el motor. Un libro sin ningún parte de la flota del Tablero se rechaza: pisaría las horas buenas
 * con nada (el riesgo que tenía «publicar sin maquinaria»). */
function validarHoras_(h){
  if(!h || typeof h!=='object' || Array.isArray(h)) return { error:'no llegó el resultado de leer el libro' };
  const extra = clavesDeMas_(h, H_CLAVES); if(extra) return { error:'«'+extra+'» no es un dato del resumen de horas' };
  if(!Array.isArray(h.partes)) return { error:'falta la lista de partes' };
  if(!h.partes.length) return { error:'no trae ningún parte de la flota del Tablero (¿es el libro de partes, con la hoja BASE MAQUINARIA?)' };
  if(h.partes.length > H_MAX_PARTES) return { error:'trae '+h.partes.length+' partes (máx. '+H_MAX_PARTES+')' };
  if(!Array.isArray(h.cc)) return { error:'falta la lista de centros de coste' };
  if(h.cc.length > H_MAX_CC) return { error:'trae '+h.cc.length+' centros de coste (máx. '+H_MAX_CC+')' };
  let corte = null;
  if(h.corte!==null && h.corte!==undefined && h.corte!==''){ corte = fdateValida_(h.corte); if(!corte || corte!==String(h.corte)) return { error:'la fecha de corte «'+txt_(h.corte)+'» no es válida' }; }
  const descartadas = entero_(h.descartadas), negativas = entero_(h.negativas);
  if(descartadas===null) return { error:'«descartadas» no es un entero ≥ 0' };
  if(negativas===null) return { error:'«negativas» no es un entero ≥ 0' };

  const partes = [];
  for(let i=0;i<h.partes.length;i++){
    const x = h.partes[i], n = 'el parte nº '+(i+1);
    if(!x || typeof x!=='object' || Array.isArray(x)) return { error:n+' no es válido' };
    const e = clavesDeMas_(x, H_PARTE); if(e) return { error:'«'+e+'» ('+n+') no es un dato de los partes' };
    const falta = H_PARTE.filter(function(k){ return !(k in x); })[0]; if(falta) return { error:n+' no trae «'+falta+'»' };
    if(typeof x.p!=='string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(x.p)) return { error:n+' trae un periodo no válido («'+txt_(x.p)+'»)' };
    if(typeof x.f!=='string' || fdateValida_(x.f)!==x.f) return { error:n+' trae una fecha no válida («'+txt_(x.f)+'»)' };
    if(H_ACTS.indexOf(x.act)<0) return { error:n+' trae una actividad fuera del Tablero («'+txt_(x.act)+'»)' };
    if(typeof x.cod!=='string' || !H_COD_RE.test(x.cod)) return { error:n+' trae un código de máquina no válido («'+txt_(x.cod).slice(0,30)+'»)' };
    if(H_TIPOS.indexOf(x.tipo)<0) return { error:n+' trae un tipo de máquina fuera del Tablero («'+txt_(x.tipo).slice(0,30)+'»)' };
    if(x.uf!=='UF1' && x.uf!=='UF2') return { error:n+' trae una UF no válida («'+txt_(x.uf)+'»)' };
    const nums = ['h','mtto','varada','lluvia','averia'];
    for(let j=0;j<nums.length;j++){ if(!numOk_(x[nums[j]])) return { error:n+' trae «'+nums[j]+'» fuera de rango ('+txt_(x[nums[j]]).slice(0,20)+')' }; }
    partes.push({ p:x.p, f:x.f, act:x.act, cod:x.cod, tipo:x.tipo, uf:x.uf, h:x.h, mtto:x.mtto, varada:x.varada, lluvia:x.lluvia, averia:x.averia });
  }
  const cc = [];
  for(let i=0;i<h.cc.length;i++){
    const x = h.cc[i], n = 'el centro de coste nº '+(i+1);
    if(!x || typeof x!=='object' || Array.isArray(x)) return { error:n+' no es válido' };
    const e = clavesDeMas_(x, H_CC); if(e) return { error:'«'+e+'» ('+n+') no es un dato de los centros de coste' };
    if(typeof x.cc!=='string' || !/^\d{2}\.\d{2}$/.test(x.cc)) return { error:n+' no es un CC válido («'+txt_(x.cc).slice(0,20)+'»)' };
    if(x.act!==null && x.act!==undefined && H_ACTS.indexOf(x.act)<0) return { error:n+' trae una actividad fuera del Tablero («'+txt_(x.act)+'»)' };
    if(!numOk_(x.horas, true) || !numOk_(x.flota, true)) return { error:n+' trae horas fuera de rango' };
    if(entero_(x.filas)===null) return { error:n+' trae «filas» que no es un entero ≥ 0' };
    cc.push({ cc:x.cc, horas:x.horas, filas:x.filas, act:(x.act===undefined ? null : x.act), flota:x.flota });
  }
  // En el MISMO orden de claves en que llegó (leerHoras: partes, cc, descartadas, negativas, corte): la lectura
  // devuelve la salida cruda tal cual, byte a byte.
  const limpio = { partes:partes, cc:cc, corte:corte, descartadas:descartadas, negativas:negativas }, horas = {};
  Object.keys(h).forEach(function(k){ if(k in limpio) horas[k]=limpio[k]; });
  Object.keys(limpio).forEach(function(k){ if(!(k in horas)) horas[k]=limpio[k]; });
  return { horas:horas };
}
function clavesDeMas_(o, permitidas){ const ks=Object.keys(o); for(let i=0;i<ks.length;i++){ if(permitidas.indexOf(ks[i])<0) return String(ks[i]).slice(0,40); } return ''; }
// Número finito ≥ 0 (horas de un parte: tope de cordura H_MAX_NUM; los totales por CC `sinTope`).
function numOk_(v, sinTope){ return typeof v==='number' && isFinite(v) && v>=0 && (sinTope || v<=H_MAX_NUM); }
function entero_(v){ return (typeof v==='number' && isFinite(v) && v>=0 && v%1===0) ? v : null; }
