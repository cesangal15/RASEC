/* D170: antes eran dos <script> en línea de tablero-produccion.html (motor + datos/UI), en este orden. */
/* esc() — escape de HTML. Es la MISMA función de `tema.js`, copiada aquí porque el tablero
 * es la única pantalla que NO carga tema.js (es pública y no lleva el interruptor de tema,
 * D161). Si se cambia una, cambiar la otra. Solo al pintar HTML; nunca en payloads. */
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
/* ============================================================================
 * MOTOR — reconstruye los datos del tablero leyendo los DOS Excel.
 *
 * Es la misma lógica verificada contra las hojas del jefe: 56 celdas de
 * `CALCULOS` sin una discrepancia y el avance a 0,0 contra `GRAFICOS`.
 *
 * Vive aparte del pintado para poder correrlo en Node contra los archivos
 * reales y comprobar que el navegador saca EXACTAMENTE los mismos números.
 *
 * D183 · V3-11 Fase A: la PROYECCIÓN (plan, rendimiento, fc, contrato, línea
 * base) puede venir de Galca — construir(wbProd, wbMaq, proy) —; sin `proy`, el
 * camino de siempre. tools/sandbox/comparar_proyeccion.mjs corre los dos en Node
 * y comprueba que salen idénticos.
 *
 * D185 · V3-11 Fases B+C: la PÁGINA ya no lee ningún Excel de producción. Calcula
 * EN VIVO con construir({vivo:true, dias}, {H}, proy): los días plegados de la DATA
 * de Galca (?action=tablero_vivo), las horas del libro de partes GUARDADAS en Galca
 * (la salida cruda de leerHoras) y la proyección de Galca. El camino de archivos
 * (wbProd = libro con DATOS, wbMaq = libro de partes) sigue aquí, idéntico, para las
 * herramientas del sandbox (comparar_proyeccion.mjs, comparar_datos_vs_data.mjs).
 * ==========================================================================*/

const FC_DEFECTO = 1.3;                         // suelto -> compacto (CALCULOS)
const PERIODO_PISO = '2025-06';                // MAPEO!B19: piso de DATOS!C (períodos en vivo, D185)
const DESDE = '2025-08';                        // arranque histórico (ya no se usa en el avance)
/* CONTRATO TOTAL de la obra, en m³ compactos (cuadro «Programado» del jefe, UF1+UF2).
   La excavación es la COMÚN; el préstamo va como partida aparte. Reemplaza a los
   números de antes, que no eran los del contrato real. */
const CONTRATO = { excavacion:747202.97, terraplen:665465.73, subbase:84203.87,
                   base:92573.49, prestamo:168462 };
/* AVANCE ANCLADO AL ACTA. El acumulado NO se re-suma desde el histórico —no cuadraba
   con el acta—: se parte de la producción oficial DE ORIGEN HASTA EL 15-AGO-2026
   (cuadro «Producción» del jefe, compacto, UF1+UF2) y se le suma sólo lo ejecutado
   DESDE EL 16-AGO. Excavación = común; préstamo aparte. Es un corte fijo, va a mano. */
const BASE_CORTE = '2026-08-16';                // desde aquí se suma lo diario
const BASE_ACUM  = { excavacion:549153.95, terraplen:385854.98, subbase:46523.83,
                     base:38103.26, prestamo:51895 };
/* Getter de la producción de cada partida para el avance, en suelto (se pasa a
   compacto ÷ fc al sumar). D185 · V3-11 (decisión final del dueño, 19-sep-2026):
   la EXCAVACIÓN COMÚN = APROVECHABLE + NO APROVECHABLE (campos `apr` + `nap`, así
   la certifica el acta); antes era solo `apr`. El préstamo (`pre`) va aparte. */
const AV_GET = { excavacion:d=>(d.apr||0)+(d.nap||0),
                 terraplen:d=>d.ter||0, subbase:d=>d.sub||0, base:d=>d.bas||0 };
/* Rendimiento esperado POR MÁQUINA, en compacto/día = «proyectado suelto equipo»
   de CALCULOS ÷ fc. De respaldo por si el archivo no trae la fila; lo normal es
   leerlo del Excel. Excavación 1105/1,3=850 · terraplén 585/1,3=450 · subbase
   455/1,3=350 · BTC 611/1,3=470. */
const META_D = { excavacion:850, terraplen:450, subbase:350, base:470 };
/* La vara por hora es META_D ÷ 8. */
const META_H = { excavacion:106.25, terraplen:56.25, subbase:43.75, base:58.75 };
const NOMBRE = { excavacion:'Excavación', terraplen:'Terraplén', subbase:'Subbase', base:'BTC / Base' };

/* Flota del reparto. El resto de la obra —vibros, minis, volquetas, la RT-02—
   mueve tierra pero NO produce estos m³, así que sus horas no entran. */
const TIPO = { EXC001:'EXC', EXC013:'EXC', EXC014:'EXC', EXC015:'EXC', CAT320:'EXC',
               BL005:'BULL', BL009:'BULL', NH69:'BULL',
               MO03:'MOTO', MO04:'MOTO', MO09:'MOTO', MC705:'MOTO', FNG002:'FIN' };
const NOMTIPO = { EXC:'EXCAVADORA', BULL:'BULLDOZER', MOTO:'MOTONIVELADORA', FIN:'FINISHER' };

/* HORAS PROGRAMADAS AL DÍA — el «standby» del que habla el jefe.
   NO se lee del libro: su columna Standby viene vacía o mal. Se calcula con la
   JORNADA CONTRATADA de cada máquina: 6,4 h las PROPIAS de Ortiz, 5 h las
   ALQUILADAS a terceros (NH69, CAT320, MC705). Este standby es el de la
   UTILIZACIÓN (cuánto de su tiempo contratado usó). La VELOCIDAD NO usa esto:
   va sobre 8 h/día, que es como se calcula el rendimiento (proyectado ÷ 8) —son
   cosas distintas. Al standby se le restan las paradas de taller (mtto/varada/
   avería), que se le cobran al dueño; la lluvia no. */
const HPROG = { EXC001:6.4, EXC013:6.4, EXC014:6.4, EXC015:6.4, CAT320:5,
                BL005:6.4, BL009:6.4, NH69:5,
                MO03:6.4, MO04:6.4, MO09:6.4, MC705:5, FNG002:6.4 };
const HPROG_DEF = 6.4;             // una máquina nueva se supone propia

/* Centro de coste -> actividad. Es la regla; lo que cambia cada mes es qué CC
   lleva cada parte, y eso se lee del archivo, así que las correcciones del jefe
   entran solas al actualizar. */
const CC_ACT = { '02.05':'excavacion', '02.06':'excavacion', '02.07':'terraplen',
                 '03.01':'subbase', '03.03':'base' };
/* Qué tipo de máquina cuenta en cada actividad (coherencia del reparto). */
const COH = { excavacion:['EXC'], terraplen:['BULL','MOTO'], subbase:['MOTO'], base:['MOTO','FIN'] };
/* El terraplén reparte la producción por grupo y mide cada uno contra SUS
   horas, como el informe mensual. */
const SPLIT = { terraplen:{ BULLDOZER:0.75, MOTONIVELADORA:0.25 } };
/* Vara por TIPO para el terraplén, en m³/h compactos. El bulldozer mueve el
   grueso del volumen y la motoniveladora nivela, así que rinden muy distinto:
   no se les puede medir a las dos con el 85 combinado. Derivadas del 85 y del
   reparto 75/25 (85 = 0,75·127,5 + 0,25·42,5), promedian 85 cuando trabaja un
   bulldozer y una moto. Así un día de solo motos se juzga contra 42,5, no
   contra 85, que lo mataba. Decisión del usuario (varas derivadas). */
/* EN PAUSA (decisión del jefe, «de momento»): el terraplén vuelve a medirse con
   el rendimiento estándar de la partida, motos incluidas, tal cual el archivo
   maestro. Estas varas por tipo quedan aquí listas para reactivarlas cuando el
   jefe dé los rendimientos por tipo definitivos — es cambiar el cálculo de `ef`
   para que use META_TIPO otra vez. */
const META_TIPO = { BULLDOZER:127.5, MOTONIVELADORA:42.5 };  // sin uso mientras esté en pausa

const ALIAS = { NG002:'FNG002', FNG02:'FNG002' };
/* El mismo equipo se escribe de varias formas: MO003/MO-03/MO03. */
function normCod(c){
  let s = String(c==null?'':c).trim().toUpperCase().replace(/-/g,'').replace(/^40BUP/,'');
  const m = /^(MO|CR)0*(\d+)$/.exec(s);
  if (m) return m[1] + String(Number(m[2])).padStart(2,'0');
  return ALIAS[s] || s;
}
const num = v => (typeof v === 'number' && isFinite(v)) ? v : 0;
function aFecha(v){
  if (v instanceof Date) return v;
  if (typeof v === 'number'){                       // serial de Excel
    const ms = Math.round((v - 25569) * 86400000);
    return new Date(ms);
  }
  return null;
}
const iso = d => d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+
                 String(d.getUTCDate()).padStart(2,'0');
/* El período va del 16 al 15 y se nombra por el mes en que termina. */
function periodoDe(d){
  let y = d.getUTCFullYear(), m = d.getUTCMonth()+1;
  if (d.getUTCDate() > 15){ m++; if (m>12){ m=1; y++; } }
  return y+'-'+String(m).padStart(2,'0');
}
const filas = (wb,nombre) => XLSX.utils.sheet_to_json(wb.Sheets[nombre],
  { header:1, raw:true, defval:null, blankrows:false });

/* ------------------------------------------------------------ producción */
function leerProduccion(wb){
  if (!wb.Sheets['DATOS']) throw new Error('El libro de producción no trae la hoja DATOS');
  const dd = [];
  for (const r of filas(wb,'DATOS').slice(2)){
    const f = aFecha(r[1]), p = aFecha(r[2]);
    if (!f || !p) continue;
    if (f.getUTCFullYear() < 2020) continue;        // errata de tecleo (año 2005)
    /* El período lo manda la columna `periodo` del Excel, no la fecha: en los
       días de borde (un 15) el Excel decide, y es contra su reparto contra el
       que están verificadas las 56 celdas de CALCULOS. */
    const pk = p.getUTCFullYear()+'-'+String(p.getUTCMonth()+1).padStart(2,'0');
    dd.push({ f:iso(f), p:pk,
      exc:num(r[3]), apr:num(r[5]), pre:num(r[6]), nap:num(r[7]),
      ter1:num(r[10]), ter2:num(r[11]), ter:num(r[12]),
      sub1:num(r[14]), sub2:num(r[15]), sub:num(r[16]),
      bas1:num(r[18]), bas2:num(r[19]), bas:num(r[20]),
      t:(typeof r[23]==='string' ? r[23].trim().toUpperCase() : '') });
  }
  if (!dd.length) throw new Error('La hoja DATOS no trajo ningún día con fecha');
  return dd;
}

/* ------------------------------------ producción EN VIVO (D185 · V3-11 B+C) */
/* Los días que devuelve ?action=tablero_vivo: el Worker pliega TODA la DATA de Galca
   (todas las fechas, cualquier área; un día sin partida va en ceros) por fecha y por
   el MAPEO (descripción + UF, como MAPEO A2:C10 del Excel) y los entrega con la MISMA
   forma y la MISMA unidad que leerProduccion: {f, p, exc, apr, pre, nap, ter1, ter2,
   ter, sub1, sub2, sub, bas1, bas2, bas, t} en SUELTO-EQUIVALENTE = Σ CANTIDAD × fc
   de la Proyección (la multiplicación la hace el Worker en numeric). CANTIDAD es la
   de cada fila, que ya respeta su FC y su espesor. El motor y la página trabajan en
   suelto y dividen por ese mismo fc al mostrar, así que toda cifra compacta que se
   ve es EXACTAMENTE Σ CANTIDAD (error de coma flotante, ~1e-16), y el m³/h de la
   maquinaria (que va en suelto) sale coherente con lo mostrado.
   `fcDias` = el fc con que el Worker escaló los días (viene en la respuesta); si no
   coincide con el de la proyección que usa el motor (alguien cambió el FC entre las
   dos lecturas), se reescala para que la división devuelva Σ CANTIDAD igual.
   Lanza un Error legible si algo no cuadra; nunca devuelve algo a medias. */
const CAMPOS_DIA = ['exc','apr','pre','nap','ter1','ter2','ter','sub1','sub2','sub','bas1','bas2','bas'];
function diasDeGalca(lista, FC, fcDias){
  if (!Array.isArray(lista) || !lista.length) throw new Error('Galca no trajo ningún día de DATA');
  if (!(FC > 0)) throw new Error('fc no válido para la producción en vivo (' + FC + ')');
  const escala = (fcDias > 0 && fcDias !== FC) ? FC / fcDias : 1;
  const dd = [];
  for (const x of lista){
    const f = String((x && x.f) || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new Error('Galca trae un día de DATA con fecha no válida (' + f + ')');
    const p = String(x.p || '');
    if (!/^\d{4}-\d{2}$/.test(p)) throw new Error('Galca trae el día ' + f + ' con un periodo no válido (' + p + ')');
    const o = { f, p };
    for (const k of CAMPOS_DIA){
      const n = (x[k] == null || x[k] === '') ? 0 : Number(x[k]);
      if (!isFinite(n)) throw new Error('Galca trae un valor no válido el ' + f + ' en ' + k + ' (' + x[k] + ')');
      o[k] = escala === 1 ? n : n * escala;
    }
    o.t = (typeof x.t === 'string' ? x.t.trim().toUpperCase() : '');
    dd.push(o);
  }
  dd.sort((a,b) => a.f < b.f ? -1 : a.f > b.f ? 1 : 0);
  return dd;
}

/* ------------------------------------------- planificado del período */
/* La hoja CALCULOS lleva, por período, `planificado` y `ejecutado` de cada
   partida más NO APROV. El ejecutado ya lo calculamos de los días —y cuadra al
   céntimo con esta columna, 56 celdas verificadas—, así que de aquí sólo se
   toma el PLANIFICADO, que no está en ninguna otra parte. */
const CAL_COL = { excavacion:1, terraplen:3, subbase:5, base:7, noaprov:9 };
function leerPlan(wb){
  if (!wb.Sheets['CALCULOS']) return {};
  const out = {};
  for (const r of filas(wb,'CALCULOS').slice(2)){
    const f = aFecha(r[0]); if (!f) continue;
    const k = f.getUTCFullYear()+'-'+String(f.getUTCMonth()+1).padStart(2,'0');
    const o = {};
    for (const [act,col] of Object.entries(CAL_COL)) o[act] = num(r[col]);
    out[k] = o;
  }
  return out;
}

/* RENDIMIENTO POR MÁQUINA, leído del ARCHIVO. Está en CALCULOS, en la fila
   «PROYECTADO SUELTO equipo» (columna O), en SUELTO POR EQUIPO: excavación 1105,
   terraplén 585, subbase 455, BTC 611. Se lee ESA fila, NO la de «rendimiento
   esperado», porque esa última ya viene multiplicada por el # de equipos (con 2
   máquinas de terraplén da 1.170/1,3 = 900, que es el total de la flota, no el
   ritmo de UNA máquina). El proyectado suelto es por equipo, así que no cambia
   cuando el jefe mueve el # de equipos. Devuelve el valor tal cual (suelto); en
   `construir` se pasa a compacto ÷ fc y a hora ÷ 8. Se busca por rótulo para que
   aguante inserciones de filas; si no aparece, cae a META_D. Columnas:
   P=excavación(15) Q=terraplén(16) R=subbase(17) T=BTC(19). */
const REND_COL = { excavacion:15, terraplen:16, subbase:17, base:19 };
function leerProyectado(wb){
  if (!wb.Sheets['CALCULOS']) return {};
  for (const r of filas(wb,'CALCULOS')){
    const et = String(r[14]==null?'':r[14]).toLowerCase();
    if (et.indexOf('proyectado suelto') < 0) continue;
    const o = {};
    for (const [act,col] of Object.entries(REND_COL)){
      const v = num(r[col]);
      if (v > 0) o[act] = v;                 // suelto por equipo; sólo pisa si trae número
    }
    return o;
  }
  return {};
}

/* ---------------------------------- proyección desde Galca (D183 · V3-11) */
/* Desde la Fase A de V3-11 el plan mensual, el rendimiento por equipo, el fc, el
   contrato y la línea base se editan en Galca (pantalla Proyección, tablas proy_*)
   y «Actualizar» los pide a ?action=proyeccion_tablero. El Excel y las constantes
   de arriba (FC_DEFECTO, CONTRATO, BASE_ACUM, BASE_CORTE) quedan de RESPALDO: si
   Galca no responde, el tablero sale como siempre. La PRODUCCIÓN diaria (DATOS) y
   las HORAS (partes) siguen saliendo del Excel en esta fase.
   D185 (Fases B+C): la página ya no pulsa «Actualizar» ni lee Excel; la proyección
   llega dentro de ?action=tablero_vivo (campo `proy`, la misma forma sin usuario) y
   pasa por esta misma función. Las constantes y el Excel quedan para el sandbox. */
const PARTIDAS_AV = ['excavacion','terraplen','subbase','base','prestamo'];
const TOL_PROY = 0.005;                // diferencia mínima que cuenta al comparar Galca vs Excel

/* Convierte la respuesta de ?action=proyeccion_tablero en el `proy` que entiende
   construir(): la MISMA forma que ya daban leerPlan / leerProyectado y las
   constantes. Lanza un Error con el motivo, en claro, si algo no cuadra: quien
   llama cae entonces al Excel y lo dice en el estado. Nunca devuelve algo a medias. */
function proyDeGalca(j){
  if (!j || typeof j !== 'object') throw new Error('Galca devolvió una respuesta vacía');
  if (j.ok !== true) throw new Error(j.error ? String(j.error) : 'Galca no devolvió la proyección');
  /* Un Worker anterior a D183 (o la vuelta atrás a `sheets`) no conoce la acción y contesta
     {ok:true, msg:'API viva'}: se dice eso, no «un fc no válido». */
  if (j.fuente !== 'galca' || !j.plan) throw new Error('el servidor aún no tiene la Proyección (falta desplegar el Worker de D183)');
  const numero = (v, que, positivo) => {
    const n = (v == null || v === '') ? 0 : Number(v);
    if (!isFinite(n) || n < 0 || (positivo && !(n > 0)))
      throw new Error('Galca trae un valor no válido en ' + que + ' (' + v + ')');
    return n;
  };
  const fc = Number(j.fc);
  if (!isFinite(fc) || !(fc > 0)) throw new Error('Galca trae un fc no válido (' + j.fc + ')');
  if (!j.plan || typeof j.plan !== 'object') throw new Error('Galca no trae el plan mensual');
  const plan = {};
  for (const k of Object.keys(j.plan)){
    if (!/^\d{4}-\d{2}$/.test(k)) throw new Error('Galca trae un periodo de plan no válido (' + k + ')');
    const o = {};
    for (const act of Object.keys(CAL_COL)) o[act] = numero((j.plan[k] || {})[act], 'el plan ' + k + ' · ' + act);
    plan[k] = o;
  }
  const proyectado = {}, contrato = {}, base_acum = {};
  for (const act of Object.keys(REND_COL))
    proyectado[act] = numero((j.proyectado || {})[act], 'el proyectado de ' + act, true);
  for (const k of PARTIDAS_AV){
    contrato[k]  = numero((j.contrato  || {})[k], 'el contrato de ' + k);
    base_acum[k] = numero((j.base_acum || {})[k], 'la línea base de ' + k);
  }
  const base_corte = String(j.base_corte || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base_corte)) throw new Error('Galca trae un corte de línea base no válido (' + base_corte + ')');
  return { fc, plan, proyectado, contrato, base_acum, base_corte,
           acta_base: String(j.acta_base == null ? '' : j.acta_base),
           actualizado: String(j.actualizado || ''), usuario: String(j.usuario || '') };
}

/* MAPEO!I7:M16 — el cuadro «Programado» / «Produccion» del jefe, por UF. Solo se
   lee para COMPARAR con Galca (el camino del Excel sigue usando las constantes
   CONTRATO y BASE_ACUM, que se sacaron de aquí). Se busca por rótulo en la columna
   I, como leerProyectado, para que aguante inserciones de filas; el valor va en la
   fila de abajo: I/J = programado UF1/UF2, L/M = producción UF1/UF2. Sin la hoja,
   null (la comparación se salta ese bloque). */
const MAPEO_ROT = { 'excavacion comun':'excavacion', 'terraplen':'terraplen', 'subbase':'subbase',
                    'btc':'base', 'excavacion prestamos':'prestamo' };
function leerMapeo(wb){
  if (!wb.Sheets['MAPEO']) return null;
  const F = XLSX.utils.sheet_to_json(wb.Sheets['MAPEO'], { header:1, raw:true, defval:null, blankrows:true });
  const norma = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
                                               .toLowerCase().replace(/\s+/g, ' ').trim();
  const out = { contrato:{}, base_acum:{} };
  for (let i = 0; i + 1 < F.length; i++){
    const k = MAPEO_ROT[norma((F[i] || [])[8])];
    if (!k || k in out.contrato) continue;
    const r = F[i+1] || [];
    out.contrato[k]  = num(r[8])  + num(r[9]);
    out.base_acum[k] = num(r[11]) + num(r[12]);
  }
  return out;
}

/* Diferencias de ENTRADA entre la proyección de Galca y lo que el tablero habría
   usado sin ella: el plan por periodo × partida y el proyectado por equipo
   (CALCULOS), el contrato y la línea base (MAPEO, si la hoja viene) y las
   constantes del código (CONTRATO, BASE_ACUM, BASE_CORTE, FC_DEFECTO). Tolerancia
   TOL_PROY, para no avisar del ruido de coma flotante de las celdas con fórmula.
   Se ignoran las claves de plan anteriores a 2000: son la «1899-12» fantasma que
   sale de A20=1 y A53=0 leídos como fecha. Lista vacía = todo cuadra. */
function difProy(wbProd, proy){
  const out = [];
  const NOM = { excavacion:'Excavación', terraplen:'Terraplén', subbase:'Subbase', base:'BTC / Base',
                noaprov:'No aprov.', prestamo:'Préstamo' };
  const cuenta = v => (typeof v === 'number' && isFinite(v)) ? v : 0;
  const mete = (x, g, e) => {
    const distinto = (typeof g === 'string' || typeof e === 'string')
      ? String(g == null ? '' : g) !== String(e == null ? '' : e)
      : Math.abs(cuenta(g) - cuenta(e)) > TOL_PROY;
    if (distinto) out.push(Object.assign(x, { galca: g == null ? null : g, excel: e == null ? null : e }));
  };
  if (wbProd.Sheets['CALCULOS']){
    const pe = leerPlan(wbProd), pg = proy.plan || {};
    const claves = [...new Set(Object.keys(pe).concat(Object.keys(pg)))]
      .filter(k => /^\d{4}-\d{2}$/.test(k) && k >= '2000').sort();
    for (const k of claves) for (const act of Object.keys(CAL_COL))
      mete({ grupo:'plan', periodo:k, partida:act, dato:'Plan ' + k + ' · ' + NOM[act], origen:'CALCULOS' },
           pg[k] ? pg[k][act] : null, pe[k] ? pe[k][act] : null);
    const re = leerProyectado(wbProd);
    for (const act of Object.keys(REND_COL))
      mete({ grupo:'proyectado', partida:act, dato:'Proyectado suelto por equipo · ' + NOM[act],
             origen:'CALCULOS (proyectado suelto equipo)' }, proy.proyectado[act], re[act]);
  }
  const mp = leerMapeo(wbProd);
  for (const [grupo, campo, cte, nom, cteNom] of [
      ['contrato', 'contrato', CONTRATO, 'Contrato', 'CONTRATO'],
      ['base', 'base_acum', BASE_ACUM, 'Línea base', 'BASE_ACUM']]){
    for (const k of PARTIDAS_AV){
      if (mp) mete({ grupo, partida:k, dato:nom + ' · ' + NOM[k], origen:'MAPEO' },
                   proy[campo][k], k in mp[campo] ? mp[campo][k] : null);
      mete({ grupo, partida:k, dato:nom + ' · ' + NOM[k], origen:'código (' + cteNom + ')' },
           proy[campo][k], cte[k]);
    }
  }
  mete({ grupo:'corte', dato:'Corte de la línea base', origen:'código (BASE_CORTE)' }, proy.base_corte, BASE_CORTE);
  mete({ grupo:'fc', dato:'FC suelto → compacto', origen:'código (FC_DEFECTO)' }, proy.fc, FC_DEFECTO);
  return out;
}

/* --------------------------------------------------------------- horas */
function leerHoras(wb){
  const hoja = wb.SheetNames.find(n => n.toUpperCase().includes('BASE MAQUINARIA'));
  if (!hoja) throw new Error('El libro de maquinaria no trae la hoja BASE MAQUINARIA');
  const out = [], ccVistos = Object.create(null);
  let descartadas = 0, negativas = 0, ultima = null;
  for (const r of filas(wb,hoja).slice(3)){
    const f = aFecha(r[2]); if (!f) continue;
    if (!ultima || f > ultima) ultima = f;
    const cod = normCod(r[5]);
    const cc = String(r[27]==null?'':r[27]).trim();
    const m = /^(3701|3702)\.(\d{2}\.\d{2})$/.exec(cc);
    const h = (typeof r[14]==='number' && isFinite(r[14])) ? r[14] : null;
    if (m){                                          // se anota todo CC válido,
      const k = m[2];                                // mapee o no: el panel lo lista
      (ccVistos[k] = ccVistos[k] || { cc:k, horas:0, filas:0, act:CC_ACT[k]||null,
                                      flota:0 }).filas++;
      if (h!=null && h>=0){ ccVistos[k].horas += h; if (TIPO[cod]) ccVistos[k].flota += h; }
    }
    if (!TIPO[cod]){ descartadas++; continue; }      // fuera de la flota del reparto
    if (h==null){ continue; }
    if (h < 0){ negativas++; continue; }             // horómetro reseteado
    if (!m) continue;
    const act = CC_ACT[m[2]];
    if (!act) continue;
    if (COH[act].indexOf(TIPO[cod]) < 0) continue;   // máquina incoherente
    out.push({ p:periodoDe(f), f:iso(f), act, cod, tipo:NOMTIPO[TIPO[cod]],
      uf: m[1]==='3701' ? 'UF1' : 'UF2', h,
      /* Horas perdidas REALES: mantenimiento, varada, lluvia y avería/cama baja.
         `Standby` (c19) viene vacía en todo el libro, así que no suma nada. La
         lluvia es la mayor con diferencia y va aparte para poder nombrarla. */
      mtto:Math.max(0,num(r[15])), varada:Math.max(0,num(r[16])),
      lluvia:Math.max(0,num(r[17])), averia:Math.max(0,num(r[19])) });
  }
  return { partes:out, cc:Object.values(ccVistos).sort((a,b)=>b.horas-a.horas),
           descartadas, negativas, corte: ultima ? iso(ultima) : null };
}

/* HORAS GUARDADAS EN GALCA (D185 · V3-11 B+C). El libro de partes ya no se lee cada
   vez: admin o jefe lo cargan UNA vez cuando llega uno nuevo («Cargar partes de
   maquinaria»), el navegador corre leerHoras y sube su salida CRUDA —{partes, cc,
   corte, descartadas, negativas}— a la tabla tablero_horas (POST
   tablero_horas_guardar). ?action=tablero_vivo la devuelve tal cual y construir la
   recibe como wbMaq = {H}. Aquí solo se comprueba la forma: lo que venga es
   exactamente lo que dio leerHoras, así que la maquinaria sale idéntica a leer el
   libro. Sin horas (null) = sin maquinaria, como un libro de partes ausente. */
const SIN_HORAS = () => ({ partes:[], cc:[], corte:null, negativas:0, descartadas:0 });
function horasGuardadas(H){
  if (!H || typeof H !== 'object' || !Array.isArray(H.partes))
    throw new Error('las horas guardadas en Galca no tienen la forma de leerHoras (falta partes)');
  const esNum = v => typeof v === 'number' && isFinite(v);
  for (const x of H.partes){
    if (!x || typeof x.p !== 'string' || typeof x.f !== 'string' || typeof x.act !== 'string' ||
        typeof x.cod !== 'string' || typeof x.uf !== 'string' ||
        !esNum(x.h) || !esNum(x.mtto) || !esNum(x.varada) || !esNum(x.lluvia) || !esNum(x.averia))
      throw new Error('las horas guardadas en Galca traen un parte que no es de leerHoras');
  }
  return { partes:H.partes, cc:Array.isArray(H.cc) ? H.cc : [],
           descartadas:num(H.descartadas), negativas:num(H.negativas),
           corte:(typeof H.corte === 'string' && H.corte) ? H.corte : null };
}
function horasDe(wbMaq){
  if (!wbMaq) return SIN_HORAS();
  if (wbMaq.H !== undefined) return wbMaq.H === null ? SIN_HORAS() : horasGuardadas(wbMaq.H);
  return leerHoras(wbMaq);
}

/* ---------------------------------------------------------- agregación */
/* `proy` (opcional, D183 · V3-11): la proyección de Galca ya pasada por
   proyDeGalca(). Si viene, el plan, el proyectado por equipo, el fc, el contrato,
   la línea base y su corte salen de ahí; si no, del Excel y de las constantes de
   arriba, EXACTAMENTE como antes. Van como locales: las constantes no se tocan y
   siguen de respaldo.
   D185 · V3-11 B+C — EN VIVO: wbProd = {vivo:true, dias, fc} (los días de la DATA
   de Galca en suelto-equivalente y el fc con que se escalaron; ver diasDeGalca) y
   wbMaq = {H} (las horas guardadas en Galca, o {H:null} sin maquinaria); `proy` es
   obligatoria (su fc es el que devuelve cada cifra a Σ CANTIDAD). Dos
   cosas cambian SOLO en vivo, pedidas por el dueño (18-sep-2026):
     · las cifras compactas no se redondean aquí (la página redondea al pintar), para
       que cada una sea exactamente Σ CANTIDAD y no Σ redondeado;
     · fuente/unidad dicen de dónde sale.
   El AVANCE es el mismo en los dos caminos (decisión final, 19-sep-2026): la
   producción base certificada de la Proyección + lo de la DATA desde el corte, con
   la excavación común = aprovechable + NO aprovechable (ver abajo). */
function construir(wbProd, wbMaq, proy){
  const vivo = !!(wbProd && wbProd.vivo);
  if (vivo && !proy) throw new Error('La producción en vivo necesita la proyección de Galca (su fc)');
  const FC = proy ? proy.fc : FC_DEFECTO;
  const dias = vivo ? diasDeGalca(wbProd.dias, FC, Number(wbProd.fc)) : leerProduccion(wbProd);
  const PLAN = proy ? proy.plan : leerPlan(wbProd);
  /* Redondeo de las cifras de producción: el de siempre en el camino de archivos
     (la foto y el comparador no cambian) y ninguno en vivo (ver arriba). */
  const r1 = vivo ? (x => x) : (x => +x.toFixed(1));
  const r0 = vivo ? (x => x) : (x => Math.round(x));
  const r2 = vivo ? (x => x) : (x => +x.toFixed(2));
  const CONT   = proy ? proy.contrato   : CONTRATO;
  const BACUM  = proy ? proy.base_acum  : BASE_ACUM;
  const BCORTE = proy ? proy.base_corte : BASE_CORTE;
  const KEY = { excavacion:'exc', terraplen:'ter', subbase:'sub', base:'bas' };
  const ACTS = Object.keys(KEY);
  /* Vara POR MÁQUINA del ARCHIVO: «proyectado suelto equipo» de CALCULOS (suelto
     por equipo) ÷ fc = compacto/día por máquina; ÷ 8 = compacto/hora. Se lee el
     proyectado suelto y NO el «rendimiento esperado», porque ese último ya está
     multiplicado por el # de equipos y daría el total de la flota, no el ritmo de
     una máquina. Lo que no venga en el archivo cae a META_D. Un solo punto: de
     aquí salen las varas de toda la página. */
  const REND = proy ? proy.proyectado : leerProyectado(wbProd);
  const metaD = Object.assign({}, META_D);
  ACTS.forEach(k => { if (REND[k] > 0) metaD[k] = +(REND[k]/FC).toFixed(4); });
  const metaH = {}; ACTS.forEach(k => metaH[k] = +(metaD[k]/8).toFixed(4));

  /* D185 · V3-11: en vivo los períodos son los de la DATA MÁS los de los partes de maquinaria
     guardados (desde el piso 2025-06 de DATOS!C). Un período con horas y sin DATA (hoy jun y
     jul-2025) sale con producción 0 y su maquinaria (como salía con la hoja DATOS), en vez de
     desaparecer del selector con sus horas. Por archivos, los de DATOS, como siempre. */
  const H = horasDe(wbMaq);
  const pers = [...new Set(dias.map(d=>d.p).concat(vivo
    ? H.partes.map(x=>x.p).filter(p=>p >= PERIODO_PISO) : []))].sort();
  const porPer = {}; for (const p of pers) porPer[p] = [];
  for (const d of dias) porPer[d.p].push(d);
  for (const p of pers) porPer[p].sort((a,b)=> a.f < b.f ? -1 : 1);

  /* Horas agrupadas por período y actividad. Es una función porque se llama TRES
     veces: con todos los partes (el total de siempre) y con los de cada UF por
     separado. Cada parte trae su `uf` (3701 → UF1, 3702 → UF2), así que las horas
     de máquina SÍ vienen partidas por UF en origen; lo que las fundía era esta
     agregación, que juntaba en una sola máquina lo que hizo en las dos. */
  function agregaHoras(partes){
    const hAgg = {};
    for (const x of partes){
      const a = ((hAgg[x.p] = hAgg[x.p] || {})[x.act] = hAgg[x.p][x.act] ||
        { horas:0, mtto:0, varada:0, lluvia:0, averia:0, maq:{} });
      a.horas += x.h; a.mtto += x.mtto; a.varada += x.varada;
      a.lluvia += x.lluvia; a.averia += x.averia;
      const q = (a.maq[x.cod] = a.maq[x.cod] || { cod:x.cod, tipo:x.tipo, h:0, perd:0,
                                                  uf:new Set(), dias:new Set(),
                                                  lluvia:0, ajuste:0 });
      q.h += x.h; q.perd += x.mtto + x.varada + x.lluvia + x.averia; q.uf.add(x.uf);
      q.lluvia += x.lluvia;                       // se nombra, no se descuenta
      q.ajuste += x.mtto + x.varada + x.averia;   // esto sí sale del standby
      /* Días DISTINTOS en que esta máquina tuvo parte en esta actividad: es lo que
         multiplica a sus horas programadas para dar su standby del período. Un
         mismo día con dos partes (dos centros de coste de la misma actividad) es
         UN día, no dos: por eso un Set y no un contador. */
      q.dias.add(x.f);
    }
    return hAgg;
  }
  const hAgg  = agregaHoras(H.partes);
  const hAggU = { UF1: agregaHoras(H.partes.filter(x=>x.uf==='UF1')),
                  UF2: agregaHoras(H.partes.filter(x=>x.uf==='UF2')) };

  /* BLOQUE de un período para UN ámbito: la producción por actividad (`a`) y la
     maquinaria (`m`). `suf` es el sufijo de la columna de producción del DATOS:
     '' = total, '1' = UF1, '2' = UF2. Con esto el filtro de UF llega también a
     horas, utilización, eficiencia y velocidad (lo pidió el jefe), calculadas
     con las máquinas y la producción de ESA UF y no con el total. La excavación
     no viene partida por UF en el DATOS (una sola columna), así que con sufijo
     se omite —igual que ya hacían las gráficas—. */
  function bloque(p, dd, hP, suf){
    const a = {};
    for (const act of ACTS){
      if (suf && act==='excavacion') continue;
      const k = KEY[act]+suf;
      const prod = dd.reduce((s,d)=>s+(d[k]||0),0) / FC;     // compacto
      const nd = dd.filter(d=>(d[k]||0)>0).length;
      /* EQUIPOS = los que de verdad estuvieron. Una máquina cuyo parte trae CERO
         horas operadas y CERO horas perdidas no estuvo: es un parte vacío, y
         contarla infla el denominador de la velocidad y hunde el porcentaje.
         Si trae horas perdidas SÍ cuenta —estuvo asignada y no produjo, que es
         justo lo que la velocidad tiene que reflejar. */
      const _mq = ((hP||{})[act]||{}).maq;
      const _vivas = _mq ? Object.values(_mq).filter(q=>(q.h+q.perd)>0) : [];
      const eq = _vivas.length;
      /* LA META SE PROYECTA SOBRE DÍAS-MÁQUINA, no sobre máquinas × días.
         Contar máquinas enteras le exige a una máquina que estuvo 1 de los 17
         días la producción de los 17: en el período en curso eso partía la
         velocidad por la mitad —39% en vez de 79%— por una excavadora con dos
         horas. El día-máquina es la unidad de lo que de verdad se tuvo.
         `equiv` es ese mismo número dicho en máquinas: días-máquina ÷ días de
         la actividad. Con la flota estable coincide con el conteo de siempre;
         cuando una máquina entra o sale a mitad de mes, no. */
      const dm = _vivas.reduce((s,q)=>s+q.dias.size,0);
      const den = dm>0 ? metaD[act]*dm : metaD[act]*eq*nd;
      a[act] = { prod:r1(prod), dias:nd, equipos:eq,
                 dias_maq:dm, equiv:nd>0&&dm>0 ? +(dm/nd).toFixed(2) : eq,
                 meta_dia:+metaD[act].toFixed(2), proy:+den.toFixed(1),
                 vel: den>0 ? +(prod/den).toFixed(4) : null,
                 rend: nd>0 ? +(prod/nd).toFixed(1) : 0,
                 plan_per: +((PLAN[p]||{})[act]||0).toFixed(0) };
    }
    let m = null;
    if (hP){
      m = {};
      for (const act of ACTS){
        if (suf && act==='excavacion') continue;   // sin desglose por UF en el DATOS
        const g = hP[act]; if (!g || g.horas<=0) continue;
        const suelto = dd.reduce((s,d)=>s+(d[KEY[act]+suf]||0),0);   // los m³/h van en suelto
        const maq = Object.values(g.maq).map(q=>({ cod:q.cod, tipo:q.tipo,
          uf:[...q.uf].sort().join('·')||'—', h:+q.h.toFixed(1), perd:+q.perd.toFixed(1),
          lluvia:+q.lluvia.toFixed(1), ajuste:+q.ajuste.toFixed(1),
          dias:q.dias.size, hprog:HPROG[q.cod]||HPROG_DEF,
          sb:+(q.dias.size*(HPROG[q.cod]||HPROG_DEF)).toFixed(1),
          sb_aj:+Math.max(0, q.dias.size*(HPROG[q.cod]||HPROG_DEF)-q.ajuste).toFixed(1) }))
          .sort((x,y)=>y.h-x.h);
        /* Rendimiento = producción ÷ horas operadas, DIRECTO, para toda partida.
           El reparto 75/25 del terraplén (bulldozer/moto) queda EN PAUSA por
           decisión del jefe: cuando un período traía horas de un solo tipo, el
           reparto acreditaba solo su cuota (25% si eran motos) y el m³/h salía
           a la cuarta parte de lo real —43 en vez de 173—, que no cuadra con
           «producción ÷ horas». Ahora es la división de siempre, motos incluidas. */
        const grupos = null;
        const mh = r2(suelto/g.horas);
        /* STANDBY DEL PERÍODO = suma de (días × horas programadas) de cada
           máquina que de verdad estuvo. La del parte vacío —cero operadas y
           cero perdidas— NO suma standby: casi siempre es el digitador
           repitiendo la máquina un fin de semana, y cargarle 6,4 h de standby
           a algo que nunca se usó hunde la utilización por un error de tecleo. */
        const vivas = maq.filter(q=>(q.h+q.perd)>0);
        const sb = +vivas.reduce((s,q)=>s+q.sb,0).toFixed(1);
        /* Al standby se le RESTAN mantenimiento y paradas (varada y avería/cama
           baja): esas horas no recaen en nuestro centro de coste, se le
           repercuten al dueño o al alquilador, así que no se nos pueden contar
           como máquina que no usamos.
           LA LLUVIA NO SE RESTA (decisión del usuario): no se le cobra a nadie,
           y una máquina parada por lluvia es tiempo que la obra no aprovechó.
           Se nombra aparte en pantalla para explicar el hueco, pero no lo tapa. */
        const ajuste = +(g.mtto+g.varada+g.averia).toFixed(1);
        const sbAj = +Math.max(0, sb-ajuste).toFixed(1);
        m[act] = { nombre:NOMBRE[act], prod:r0(suelto), horas:+g.horas.toFixed(1),
          equipos:vivas.length, meta_hora:+metaH[act].toFixed(2), mh, grupos, maq,
          mtto:+g.mtto.toFixed(1), varada:+g.varada.toFixed(1),
          lluvia:+g.lluvia.toFixed(1), averia:+g.averia.toFixed(1),
          perd:+(g.mtto+g.varada+g.lluvia+g.averia).toFixed(1),
          sb, ajuste, sb_aj:sbAj,
          /* Por encima del standby la utilización es 100% y lo que sobra es
             GANANCIA: se guarda para poder decirlo, no para inflar el %. */
          util: sbAj>0 ? +Math.min(1, g.horas/sbAj).toFixed(4) : null,
          ganancia: +Math.max(0, g.horas-sbAj).toFixed(1),
          dudoso: mh > 2.5*metaH[act] };
      }
      if (!Object.keys(m).length) m = null;
    }
    return { a, m };
  }

  /* V3-15b: el mismo `bloque` de arriba, pero para un SUBCONJUNTO de días dentro
     de un período —fechas ISO `a`..`b`, ambas incluidas—, para que el filtro de
     días de la escala de tiempo (V3-15(b)) alcance también la maquinaria de
     «Por qué vamos así», como ya alcanza la producción diaria y «Horas del
     personal». No duplica ninguna fórmula: recorta `dd` (días de producción) y
     los partes de horas a ese rango (y, con `suf`, a esa UF) ANTES de agregarlos,
     así que `bloque()` calcula standby, utilización, eficiencia y velocidad
     exactamente como por período completo — el standby de cada máquina sale de
     sus días DISTINTOS dentro de la selección (los agrupa `agregaHoras()`) por
     sus horas programadas, el mismo criterio de siempre. Solo vive en el objeto
     que devuelve `construir()` en esta misma sesión: una función no sobrevive a
     publicar la foto en JSON, así que una foto vieja simplemente no la trae (la
     página lo dice y pide el cálculo en vivo). */
  function bloqueDias(p, a, b, suf){
    const dd = (porPer[p] || []).filter(d => d.f >= a && d.f <= b);
    let partes = H.partes.filter(x => x.p === p && x.f >= a && x.f <= b);
    if (suf) partes = partes.filter(x => x.uf === (suf === '1' ? 'UF1' : 'UF2'));
    const hP = agregaHoras(partes)[p];
    return bloque(p, dd, hP, suf);
  }

  const per = pers.map(p => {
    const dd = porPer[p];
    /* El total (lo de siempre) y, aparte, el bloque de cada UF para que el filtro
       llegue a la zona de maquinaria. `a` y `m` siguen siendo el total: las fotos
       viejas y todo lo que ya leía de ahí no cambian. */
    const T = bloque(p, dd, hAgg[p], '');
    const a = T.a, m = T.m;
    const ufb = { UF1: bloque(p, dd, hAggU.UF1[p], '1'),
                  UF2: bloque(p, dd, hAggU.UF2[p], '2') };
    /* El no aprovechable no es una partida del contrato, pero SÍ se planifica y
       se sigue en el período —sale de la excavación—, así que va como una fila
       más del bloque planificado vs ejecutado. */
    a.noaprov = { prod:r1(dd.reduce((s,d)=>s+d.nap,0)/FC),
                  plan_per:+((PLAN[p]||{}).noaprov||0).toFixed(0),
                  dias:dd.filter(d=>d.nap>0).length, soloPlan:true };
    /* El común, el préstamo y el no aprovechable se leen TAL CUAL de sus columnas
       del DATOS (apr=F, pre=G, nap=H); no se derivan del total. */
    const split = { apr:r1(dd.reduce((s,d)=>s+d.apr,0)/FC),
                    pre:r1(dd.reduce((s,d)=>s+d.pre,0)/FC),
                    nap:r1(dd.reduce((s,d)=>s+d.nap,0)/FC) };
    return { p, d:dd.map(({p:_,...q})=>q), a, split, m, uf:ufb };
  });

  /* AVANCE contra el contrato — D185 · V3-11, decisión final del dueño (19-sep-2026),
     «como tenemos lo de Proyección», igual en vivo y en el camino de archivos: la
     PRODUCCIÓN BASE CERTIFICADA (base_acum de la Proyección, de origen hasta el cierre
     del acta base) + Σ compacto de los días con fecha ≥ base_corte, ÷ contrato. En esa
     suma posterior al corte la EXCAVACIÓN COMÚN = aprovechable + NO aprovechable
     (AV_GET, así la certifica el acta) y el préstamo es partida propia (`pre`). En vivo
     no se redondea (r1 = identidad: la página redondea al pintar); por archivos, a 0,1. */
  const desde16 = dias.filter(d => d.f >= BCORTE);
  const trasCorte = get => desde16.reduce((s,d)=>s+get(d),0)/FC;
  const avance = ACTS.map(act => ({ k:act,
    n:act==='excavacion' ? 'Excavación común' : NOMBRE[act].replace(' / Base',''),
    eje:r1(BACUM[act] + trasCorte(AV_GET[act])), plan:CONT[act] }));
  avance.push({ k:'prestamo', n:'Excavación préstamo',
    eje:r1(BACUM.prestamo + trasCorte(d=>d.pre||0)), plan:CONT.prestamo });

  return { fc:FC, desde:DESDE, per, avance, bloqueDias,
    maq_periodos: per.filter(x=>x.m).map(x=>x.p),
    metas_hora: metaH, cc: H.cc, corte_horas: H.corte, atraso_horas: 2,
    corte_prod: dias.length ? dias.map(d=>d.f).sort().slice(-1)[0] : '',
    descartes: { fuera_flota:H.descartadas, horas_negativas:H.negativas },
    fuente: vivo ? 'DATA de Galca en vivo (pliegue por el mapeo, D185) · proyección de Galca'
          : proy ? 'TM2_SUR_REPORTE_DIARIO_OBRA · hoja DATOS · proyección de Galca (D183)'
                 : 'TM2_SUR_REPORTE_DIARIO_OBRA · hojas DATOS y CALCULOS',
    fuente_horas:(wbMaq && wbMaq.H !== undefined)
      ? 'BASE MAQUINARIA (partes diarios, guardados en Galca, D185) · horas por centro de coste'
      : 'BASE MAQUINARIA (partes diarios) · horas por centro de coste',
    /* Con el fc de siempre dice «1,3», igual que antes; con otro fc de Galca, el suyo.
       En vivo la producción ya llega en compacto: Σ CANTIDAD de la DATA (D185). */
    unidad: vivo ? 'm³ compactos (Σ CANTIDAD de la DATA)'
                 : 'm³ compactos (suelto ÷ '+String(FC).replace('.',',')+')',
    unidad_mh:'m³ compactos por hora de operación',
    generado: new Date().toISOString().slice(0,16).replace('T',' ') };
}

const MOTOR = { construir, normCod, periodoDe, proyDeGalca, difProy, leerHoras };

const TM2_EMBEBIDO={"fc":1.3,"desde":"2025-08","per":[{"p":"2025-06","d":[{"f":"2025-05-15","exc":864,"apr":772,"pre":0,"nap":92,"ter1":0,"ter2":772,"ter":772,"sub1":0,"sub2":1,"sub":1,"bas1":0,"bas2":1,"bas":1,"t":""},{"f":"2025-05-16","exc":773,"apr":773,"pre":0,"nap":0,"ter1":0,"ter2":773,"ter":773,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-05-17","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-05-19","exc":494,"apr":494,"pre":0,"nap":0,"ter1":0,"ter2":494,"ter":494,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-05-20","exc":1262,"apr":1262,"pre":0,"nap":0,"ter1":0,"ter2":1262,"ter":1262,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-05-21","exc":738,"apr":738,"pre":0,"nap":0,"ter1":0,"ter2":738,"ter":738,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-05-22","exc":1077,"apr":1077,"pre":0,"nap":0,"ter1":0,"ter2":1076.92,"ter":1076.92,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-05-23","exc":1197,"apr":1197,"pre":0,"nap":0,"ter1":0,"ter2":1196.92,"ter":1196.92,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-05-24","exc":743.0769230769231,"apr":743.0769230769231,"pre":0,"nap":0,"ter1":0,"ter2":743.0769230769231,"ter":743.0769230769231,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-05-26","exc":616,"apr":292,"pre":0,"nap":324,"ter1":0,"ter2":292.3076923076923,"ter":292.3076923076923,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-05-27","exc":1170,"apr":1077,"pre":0,"nap":93,"ter1":0,"ter2":769.2307692307692,"ter":769.2307692307692,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-05-28","exc":1852.3076923076922,"apr":1852.3076923076922,"pre":0,"nap":0,"ter1":0,"ter2":1544.6153846153845,"ter":1544.6153846153845,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-05-29","exc":2109,"apr":1885,"pre":0,"nap":224,"ter1":0,"ter2":1885,"ter":1885,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-05-30","exc":2143,"apr":1917,"pre":0,"nap":226,"ter1":0,"ter2":1809,"ter":1809,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-05-31","exc":668,"apr":668,"pre":0,"nap":0,"ter1":0,"ter2":668,"ter":668,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-02","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-03","exc":495,"apr":323,"pre":0,"nap":172,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-04","exc":1004,"apr":808,"pre":0,"nap":196,"ter1":0,"ter2":308,"ter":308,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-05","exc":986,"apr":986,"pre":0,"nap":0,"ter1":0,"ter2":986,"ter":986,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-06","exc":1691,"apr":1454,"pre":0,"nap":237,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-07","exc":1625,"apr":1062,"pre":0,"nap":563,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-09","exc":1730,"apr":993,"pre":0,"nap":737,"ter1":531,"ter2":0,"ter":531,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-10","exc":516,"apr":118,"pre":0,"nap":398,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-11","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-12","exc":1475,"apr":700,"pre":0,"nap":775,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-13","exc":1098,"apr":484,"pre":0,"nap":614,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-14","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""}],"a":{"excavacion":{"prod":20251.1,"dias":23,"equipos":2,"meta_dia":850,"proy":39100,"vel":0.5179,"rend":880.5,"plan_per":0},"terraplen":{"prod":12191.6,"dias":17,"equipos":4,"meta_dia":680,"proy":46240,"vel":0.2637,"rend":717.2,"plan_per":0},"subbase":{"prod":0.8,"dias":1,"equipos":0,"meta_dia":430.77,"proy":0,"vel":null,"rend":0.8,"plan_per":0},"base":{"prod":0.8,"dias":1,"equipos":0,"meta_dia":430.77,"proy":0,"vel":null,"rend":0.8,"plan_per":0},"noaprov":{"prod":3577.7,"plan_per":0,"dias":13,"soloPlan":true}},"split":{"apr":16673.4,"pre":0,"nap":3577.7},"m":{"excavacion":{"nombre":"Excavación","prod":26326,"horas":272,"equipos":2,"meta_hora":106.25,"mh":96.79,"grupos":null,"maq":[{"cod":"EXC001","tipo":"EXCAVADORA","uf":"UF1·UF2","h":153,"perd":5},{"cod":"EXC015","tipo":"EXCAVADORA","uf":"UF1·UF2","h":119,"perd":5}],"mtto":0,"varada":10,"lluvia":0,"averia":0,"perd":10,"dudoso":false},"terraplen":{"nombre":"Terraplén","prod":15849,"horas":317.9,"equipos":4,"meta_hora":85,"mh":49.86,"grupos":[{"tipo":"BULLDOZER","cuota":0.75,"horas":147.1,"prod":11887,"mh":80.81},{"tipo":"MOTONIVELADORA","cuota":0.25,"horas":170.8,"prod":3962,"mh":23.2}],"maq":[{"cod":"BL005","tipo":"BULLDOZER","uf":"UF2","h":133.5,"perd":6.4},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":106,"perd":1},{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF2","h":64.8,"perd":6.4},{"cod":"BL009","tipo":"BULLDOZER","uf":"UF1·UF2","h":13.6,"perd":5}],"mtto":9,"varada":9.8,"lluvia":0,"averia":0,"perd":18.8,"dudoso":false}}},{"p":"2025-07","d":[{"f":"2025-06-16","exc":1098,"apr":678,"pre":0,"nap":420,"ter1":678,"ter2":0,"ter":678,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-17","exc":323,"apr":0,"pre":0,"nap":323,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-18","exc":1462,"apr":666,"pre":0,"nap":796,"ter1":666,"ter2":0,"ter":666,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-19","exc":1109,"apr":1066,"pre":0,"nap":43,"ter1":1066,"ter2":0,"ter":1066,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-20","exc":1744,"apr":915,"pre":0,"nap":829,"ter1":915,"ter2":0,"ter":915,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-21","exc":1292,"apr":743,"pre":0,"nap":549,"ter1":743,"ter2":0,"ter":743,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-23","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-24","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-25","exc":1227,"apr":958,"pre":0,"nap":269,"ter1":958,"ter2":0,"ter":958,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-26","exc":1593,"apr":592,"pre":0,"nap":1001,"ter1":538,"ter2":0,"ter":538,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-27","exc":1636,"apr":775,"pre":0,"nap":861,"ter1":0,"ter2":754,"ter":754,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-28","exc":1410,"apr":1023,"pre":0,"nap":387,"ter1":506,"ter2":517,"ter":1023,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-06-30","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-07-01","exc":1992,"apr":1497,"pre":0,"nap":495,"ter1":786,"ter2":538,"ter":1324,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-07-02","exc":2649,"apr":1562,"pre":0,"nap":1087,"ter1":840,"ter2":549,"ter":1389,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-07-03","exc":2234,"apr":1134,"pre":0,"nap":1100,"ter1":588,"ter2":294,"ter":882,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-07-04","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-07-05","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-07-07","exc":2828,"apr":1624,"pre":0,"nap":1204,"ter1":1050,"ter2":476,"ter":1526,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-07-08","exc":1834,"apr":1162,"pre":0,"nap":672,"ter1":728,"ter2":392,"ter":1120,"sub1":0,"sub2":266,"sub":266,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-07-09","exc":2828,"apr":2254,"pre":0,"nap":574,"ter1":1372,"ter2":672,"ter":2044,"sub1":0,"sub2":140,"sub":140,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-07-10","exc":1765,"apr":1453,"pre":0,"nap":312,"ter1":776,"ter2":463,"ter":1239,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-07-11","exc":1991,"apr":1324,"pre":0,"nap":667,"ter1":678,"ter2":516,"ter":1194,"sub1":0,"sub2":174,"sub":174,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-07-12","exc":1407,"apr":1152,"pre":0,"nap":255,"ter1":1066,"ter2":75,"ter":1141,"sub1":0,"sub2":220,"sub":220,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-07-14","exc":1679,"apr":1486,"pre":0,"nap":193,"ter1":1421,"ter2":0,"ter":1421,"sub1":0,"sub2":82,"sub":82,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-07-15","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""}],"a":{"excavacion":{"prod":26231.5,"dias":20,"equipos":3,"meta_dia":850,"proy":51000,"vel":0.5143,"rend":1311.6,"plan_per":0},"terraplen":{"prod":15862.3,"dias":19,"equipos":3,"meta_dia":680,"proy":38760,"vel":0.4092,"rend":834.9,"plan_per":0},"subbase":{"prod":678.5,"dias":5,"equipos":1,"meta_dia":430.77,"proy":2153.8,"vel":0.315,"rend":135.7,"plan_per":0},"base":{"prod":0,"dias":0,"equipos":0,"meta_dia":430.77,"proy":0,"vel":null,"rend":0,"plan_per":0},"noaprov":{"prod":9259.2,"plan_per":0,"dias":20,"soloPlan":true}},"split":{"apr":16972.3,"pre":0,"nap":9259.2},"m":{"excavacion":{"nombre":"Excavación","prod":34101,"horas":162.1,"equipos":3,"meta_hora":106.25,"mh":210.37,"grupos":null,"maq":[{"cod":"EXC001","tipo":"EXCAVADORA","uf":"UF1·UF2","h":110.8,"perd":0},{"cod":"EXC014","tipo":"EXCAVADORA","uf":"UF1","h":41.3,"perd":0},{"cod":"EXC015","tipo":"EXCAVADORA","uf":"UF1","h":10,"perd":0}],"mtto":0,"varada":0,"lluvia":0,"averia":0,"perd":0,"dudoso":false},"terraplen":{"nombre":"Terraplén","prod":20621,"horas":289,"equipos":3,"meta_hora":85,"mh":71.35,"grupos":[{"tipo":"BULLDOZER","cuota":0.75,"horas":78,"prod":15466,"mh":198.28},{"tipo":"MOTONIVELADORA","cuota":0.25,"horas":211,"prod":5155,"mh":24.43}],"maq":[{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":110,"perd":2},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":101,"perd":0},{"cod":"BL009","tipo":"BULLDOZER","uf":"UF1·UF2","h":78,"perd":0}],"mtto":2,"varada":0,"lluvia":0,"averia":0,"perd":2,"dudoso":false},"subbase":{"nombre":"Subbase","prod":882,"horas":26,"equipos":1,"meta_hora":43.75,"mh":33.92,"grupos":null,"maq":[{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF2","h":26,"perd":0}],"mtto":0,"varada":0,"lluvia":0,"averia":0,"perd":0,"dudoso":false}}},{"p":"2025-08","d":[{"f":"2025-07-16","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-08-13","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-08-14","exc":546,"apr":182,"pre":0,"nap":364,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":294,"sub":294,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2025-08-15","exc":2050,"apr":1092,"pre":0,"nap":958,"ter1":798,"ter2":294,"ter":1092,"sub1":0,"sub2":428,"sub":428,"bas1":0,"bas2":0,"bas":0,"t":""}],"a":{"excavacion":{"prod":1996.9,"dias":2,"equipos":2,"meta_dia":850,"proy":3400,"vel":0.5873,"rend":998.5,"plan_per":38939},"terraplen":{"prod":840,"dias":1,"equipos":2,"meta_dia":680,"proy":1360,"vel":0.6176,"rend":840,"plan_per":34328},"subbase":{"prod":555.4,"dias":2,"equipos":1,"meta_dia":430.77,"proy":861.5,"vel":0.6446,"rend":277.7,"plan_per":7758},"base":{"prod":0,"dias":0,"equipos":0,"meta_dia":430.77,"proy":0,"vel":null,"rend":0,"plan_per":0},"noaprov":{"prod":1016.9,"plan_per":2251,"dias":2,"soloPlan":true}},"split":{"apr":980,"pre":0,"nap":1016.9},"m":{"excavacion":{"nombre":"Excavación","prod":2596,"horas":33,"equipos":2,"meta_hora":106.25,"mh":78.67,"grupos":null,"maq":[{"cod":"EXC014","tipo":"EXCAVADORA","uf":"UF1","h":26,"perd":0},{"cod":"EXC001","tipo":"EXCAVADORA","uf":"UF1","h":7,"perd":0}],"mtto":0,"varada":0,"lluvia":0,"averia":0,"perd":0,"dudoso":false},"terraplen":{"nombre":"Terraplén","prod":1092,"horas":13,"equipos":2,"meta_hora":85,"mh":84,"grupos":[{"tipo":"BULLDOZER","cuota":0.75,"horas":8,"prod":819,"mh":102.38},{"tipo":"MOTONIVELADORA","cuota":0.25,"horas":5,"prod":273,"mh":54.6}],"maq":[{"cod":"BL009","tipo":"BULLDOZER","uf":"UF1","h":8,"perd":0},{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF2","h":5,"perd":0}],"mtto":0,"varada":0,"lluvia":0,"averia":0,"perd":0,"dudoso":false},"subbase":{"nombre":"Subbase","prod":722,"horas":21,"equipos":1,"meta_hora":43.75,"mh":34.38,"grupos":null,"maq":[{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":21,"perd":0}],"mtto":0,"varada":0,"lluvia":0,"averia":0,"perd":0,"dudoso":false}}},{"p":"2025-09","d":[{"f":"2025-08-16","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":174.38,"sub":174.38,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-08-18","exc":1834,"apr":1638,"pre":0,"nap":196,"ter1":1036,"ter2":602,"ter":1638,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-08-19","exc":2044,"apr":2044,"pre":0,"nap":0,"ter1":1036,"ter2":1008,"ter":2044,"sub1":0,"sub2":482.3,"sub":482.3,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-08-20","exc":2548,"apr":2310,"pre":0,"nap":238,"ter1":1456,"ter2":826,"ter":2282,"sub1":0,"sub2":191.03,"sub":191.03,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-08-21","exc":2612,"apr":2098,"pre":0,"nap":514,"ter1":1162,"ter2":888,"ter":2050,"sub1":0,"sub2":193.65,"sub":193.65,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-08-22","exc":854,"apr":854,"pre":0,"nap":0,"ter1":476,"ter2":350,"ter":826,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-08-23","exc":3416,"apr":3416,"pre":0,"nap":0,"ter1":3416,"ter2":0,"ter":3416,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-08-25","exc":2086,"apr":1806,"pre":0,"nap":280,"ter1":1736,"ter2":70,"ter":1806,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-08-26","exc":4088,"apr":3234,"pre":0,"nap":854,"ter1":3234,"ter2":0,"ter":3234,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-08-27","exc":3738,"apr":3010,"pre":0,"nap":728,"ter1":2800,"ter2":0,"ter":2800,"sub1":0,"sub2":81.3,"sub":81.3,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-08-28","exc":3248,"apr":2562,"pre":0,"nap":686,"ter1":2282,"ter2":0,"ter":2282,"sub1":0,"sub2":272.3,"sub":272.3,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-08-29","exc":3573,"apr":2729,"pre":0,"nap":844,"ter1":2266,"ter2":0,"ter":2266,"sub1":0,"sub2":404.75,"sub":404.75,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-08-30","exc":1932,"apr":1512,"pre":0,"nap":420,"ter1":1330,"ter2":0,"ter":1330,"sub1":0,"sub2":97.21,"sub":97.21,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-09-01","exc":3346,"apr":2520,"pre":0,"nap":826,"ter1":2506,"ter2":0,"ter":2506,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-09-02","exc":3164,"apr":1680,"pre":0,"nap":1484,"ter1":1638,"ter2":42,"ter":1680,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-09-03","exc":2590,"apr":2548,"pre":0,"nap":42,"ter1":2548,"ter2":112,"ter":2660,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-09-04","exc":2800,"apr":2646,"pre":0,"nap":154,"ter1":2590,"ter2":56,"ter":2646,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-09-05","exc":3234,"apr":2870,"pre":0,"nap":364,"ter1":2842,"ter2":0,"ter":2842,"sub1":0,"sub2":547.5,"sub":547.5,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-09-06","exc":2080,"apr":1996,"pre":0,"nap":84,"ter1":1525,"ter2":0,"ter":1525,"sub1":0,"sub2":464.46,"sub":464.46,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-09-08","exc":3479,"apr":2492,"pre":0,"nap":987,"ter1":2394,"ter2":98,"ter":2492,"sub1":0,"sub2":260.89,"sub":260.89,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-09-09","exc":3885,"apr":3248,"pre":0,"nap":637,"ter1":3024,"ter2":0,"ter":3024,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-09-10","exc":3780,"apr":3444,"pre":0,"nap":336,"ter1":3094,"ter2":0,"ter":3094,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-09-11","exc":2632,"apr":2184,"pre":0,"nap":448,"ter1":2030,"ter2":0,"ter":2030,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-09-12","exc":2898,"apr":2632,"pre":0,"nap":266,"ter1":2632,"ter2":0,"ter":2632,"sub1":0,"sub2":339.07,"sub":339.07,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-09-13","exc":1960,"apr":1960,"pre":0,"nap":0,"ter1":1960,"ter2":0,"ter":1960,"sub1":0,"sub2":453.34,"sub":453.34,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-09-15","exc":3626,"apr":3570,"pre":0,"nap":56,"ter1":3528,"ter2":28,"ter":3556,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"}],"a":{"excavacion":{"prod":54959.2,"dias":25,"equipos":3,"meta_dia":850,"proy":63750,"vel":0.8621,"rend":2198.4,"plan_per":54617},"terraplen":{"prod":45093.1,"dias":25,"equipos":4,"meta_dia":680,"proy":68000,"vel":0.6631,"rend":1803.7,"plan_per":33531},"subbase":{"prod":3047.8,"dias":13,"equipos":1,"meta_dia":430.77,"proy":5600,"vel":0.5443,"rend":234.4,"plan_per":14003},"base":{"prod":0,"dias":0,"equipos":0,"meta_dia":430.77,"proy":0,"vel":null,"rend":0,"plan_per":0},"noaprov":{"prod":8033.8,"plan_per":5784,"dias":21,"soloPlan":true}},"split":{"apr":46925.4,"pre":0,"nap":8033.8},"m":{"excavacion":{"nombre":"Excavación","prod":71447,"horas":466.3,"equipos":3,"meta_hora":106.25,"mh":153.22,"grupos":null,"maq":[{"cod":"EXC014","tipo":"EXCAVADORA","uf":"UF1·UF2","h":223.3,"perd":0},{"cod":"EXC001","tipo":"EXCAVADORA","uf":"UF1","h":207.6,"perd":0},{"cod":"EXC015","tipo":"EXCAVADORA","uf":"UF1","h":35.4,"perd":0}],"mtto":0,"varada":0,"lluvia":0,"averia":0,"perd":0,"dudoso":false},"terraplen":{"nombre":"Terraplén","prod":58621,"horas":541,"equipos":4,"meta_hora":85,"mh":108.36,"grupos":[{"tipo":"BULLDOZER","cuota":0.75,"horas":267,"prod":43966,"mh":164.67},{"tipo":"MOTONIVELADORA","cuota":0.25,"horas":274,"prod":14655,"mh":53.49}],"maq":[{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":184,"perd":0},{"cod":"BL009","tipo":"BULLDOZER","uf":"UF1","h":161,"perd":0},{"cod":"BL005","tipo":"BULLDOZER","uf":"UF1·UF2","h":106,"perd":16.8},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":90,"perd":4}],"mtto":6.4,"varada":4,"lluvia":0,"averia":10.4,"perd":20.8,"dudoso":false},"subbase":{"nombre":"Subbase","prod":3962,"horas":71,"equipos":1,"meta_hora":43.75,"mh":55.81,"grupos":null,"maq":[{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF2","h":71,"perd":25.6}],"mtto":0,"varada":12.8,"lluvia":0,"averia":12.8,"perd":25.6,"dudoso":false}}},{"p":"2025-10","d":[{"f":"2025-09-16","exc":1666,"apr":1414,"pre":0,"nap":252,"ter1":1330,"ter2":0,"ter":1330,"sub1":0,"sub2":1004,"sub":1004,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2025-09-17","exc":144,"apr":144,"pre":0,"nap":0,"ter1":84,"ter2":0,"ter":84,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-09-18","exc":532,"apr":42,"pre":0,"nap":490,"ter1":42,"ter2":0,"ter":42,"sub1":0,"sub2":1019,"sub":1019,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-09-19","exc":530,"apr":530,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":254,"sub":254,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-09-20","exc":2296,"apr":2296,"pre":0,"nap":0,"ter1":2282,"ter2":0,"ter":2282,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-09-22","exc":2884,"apr":2436,"pre":0,"nap":448,"ter1":2394,"ter2":0,"ter":2394,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-09-23","exc":3052,"apr":2828,"pre":0,"nap":224,"ter1":2828,"ter2":0,"ter":2828,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-09-24","exc":3038,"apr":1512,"pre":0,"nap":1526,"ter1":1512,"ter2":0,"ter":1512,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-09-25","exc":3720,"apr":1970,"pre":0,"nap":1750,"ter1":1834,"ter2":0,"ter":1834,"sub1":315,"sub2":0,"sub":315,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-09-26","exc":2380,"apr":1792,"pre":0,"nap":588,"ter1":1708,"ter2":0,"ter":1708,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-09-27","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-09-29","exc":2114,"apr":2114,"pre":0,"nap":0,"ter1":2044,"ter2":0,"ter":2044,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-09-30","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-10-01","exc":1613,"apr":1358,"pre":0,"nap":255,"ter1":1288,"ter2":0,"ter":1288,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-10-02","exc":2902,"apr":2800,"pre":0,"nap":102,"ter1":2800,"ter2":0,"ter":2800,"sub1":344,"sub2":0,"sub":344,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-10-03","exc":2946,"apr":2582,"pre":0,"nap":364,"ter1":2456,"ter2":98,"ter":2554,"sub1":309,"sub2":0,"sub":309,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2025-10-04","exc":1904,"apr":1904,"pre":0,"nap":0,"ter1":1792,"ter2":56,"ter":1848,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-10-06","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-10-07","exc":2534,"apr":2086,"pre":0,"nap":448,"ter1":1820,"ter2":0,"ter":1820,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-10-08","exc":2624,"apr":2244,"pre":0,"nap":380,"ter1":2244,"ter2":0,"ter":2244,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-10-09","exc":2250,"apr":1610,"pre":0,"nap":640,"ter1":1540,"ter2":0,"ter":1540,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-10-10","exc":224,"apr":224,"pre":0,"nap":0,"ter1":224,"ter2":0,"ter":224,"sub1":345,"sub2":0,"sub":345,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-10-11","exc":452,"apr":308,"pre":0,"nap":144,"ter1":308,"ter2":0,"ter":308,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2025-10-14","exc":3796,"apr":3220,"pre":0,"nap":576,"ter1":3500,"ter2":0,"ter":3500,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2025-10-15","exc":3810,"apr":2184,"pre":0,"nap":1626,"ter1":2262,"ter2":0,"ter":2262,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"}],"a":{"excavacion":{"prod":36470,"dias":22,"equipos":3,"meta_dia":850,"proy":56100,"vel":0.6501,"rend":1657.7,"plan_per":51137},"terraplen":{"prod":28035.4,"dias":21,"equipos":4,"meta_dia":680,"proy":57120,"vel":0.4908,"rend":1335,"plan_per":32565},"subbase":{"prod":2761.5,"dias":7,"equipos":2,"meta_dia":430.77,"proy":6030.8,"vel":0.4579,"rend":394.5,"plan_per":8218},"base":{"prod":0,"dias":0,"equipos":0,"meta_dia":430.77,"proy":0,"vel":null,"rend":0,"plan_per":0},"noaprov":{"prod":7548.5,"plan_per":6182,"dias":16,"soloPlan":true}},"split":{"apr":28921.5,"pre":0,"nap":7548.5},"m":{"excavacion":{"nombre":"Excavación","prod":47411,"horas":456.2,"equipos":3,"meta_hora":106.25,"mh":103.94,"grupos":null,"maq":[{"cod":"EXC014","tipo":"EXCAVADORA","uf":"UF1","h":175,"perd":0},{"cod":"EXC001","tipo":"EXCAVADORA","uf":"UF1","h":155.1,"perd":8},{"cod":"EXC015","tipo":"EXCAVADORA","uf":"UF1","h":126,"perd":0}],"mtto":0,"varada":4,"lluvia":0,"averia":4,"perd":8,"dudoso":false},"terraplen":{"nombre":"Terraplén","prod":36446,"horas":345,"equipos":4,"meta_hora":85,"mh":105.64,"grupos":[{"tipo":"BULLDOZER","cuota":0.75,"horas":132,"prod":27335,"mh":207.08},{"tipo":"MOTONIVELADORA","cuota":0.25,"horas":213,"prod":9112,"mh":42.78}],"maq":[{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF1","h":118,"perd":4},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":95,"perd":0},{"cod":"BL005","tipo":"BULLDOZER","uf":"UF1","h":76,"perd":0},{"cod":"BL009","tipo":"BULLDOZER","uf":"UF1","h":56,"perd":0}],"mtto":2,"varada":0,"lluvia":0,"averia":2,"perd":4,"dudoso":false},"subbase":{"nombre":"Subbase","prod":3590,"horas":40,"equipos":2,"meta_hora":43.75,"mh":89.75,"grupos":null,"maq":[{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":23,"perd":0},{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF1","h":17,"perd":0}],"mtto":0,"varada":0,"lluvia":0,"averia":0,"perd":0,"dudoso":false}}},{"p":"2025-11","d":[{"f":"2025-10-16","exc":200,"apr":0,"pre":0,"nap":200,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-10-17","exc":2418,"apr":1714,"pre":0,"nap":704,"ter1":2036,"ter2":0,"ter":2036,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2025-10-18","exc":1428,"apr":1162,"pre":0,"nap":266,"ter1":1120,"ter2":0,"ter":1120,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-10-20","exc":2122,"apr":1232,"pre":0,"nap":890,"ter1":1232,"ter2":0,"ter":1232,"sub1":616,"sub2":0,"sub":616,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2025-10-21","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":420,"sub2":0,"sub":420,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-10-22","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":56,"sub2":0,"sub":56,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2025-10-23","exc":2122,"apr":1862,"pre":0,"nap":260,"ter1":1694,"ter2":168,"ter":1862,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-10-24","exc":3528,"apr":3528,"pre":0,"nap":0,"ter1":2898,"ter2":462,"ter":3360,"sub1":490,"sub2":0,"sub":490,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-10-25","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-10-27","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-10-28","exc":4578,"apr":4578,"pre":0,"nap":0,"ter1":3276,"ter2":1036,"ter":4312,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-10-29","exc":3234,"apr":3108,"pre":0,"nap":126,"ter1":2338,"ter2":770,"ter":3108,"sub1":448,"sub2":0,"sub":448,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2025-10-30","exc":2422,"apr":1204,"pre":0,"nap":1218,"ter1":1204,"ter2":0,"ter":1204,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2025-10-31","exc":3458,"apr":3458,"pre":0,"nap":0,"ter1":2926,"ter2":448,"ter":3374,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2025-11-01","exc":1834,"apr":1834,"pre":0,"nap":0,"ter1":1778,"ter2":0,"ter":1778,"sub1":490,"sub2":0,"sub":490,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-11-04","exc":923,"apr":0,"pre":0,"nap":923,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-11-05","exc":2781,"apr":0,"pre":0,"nap":2781,"ter1":0,"ter2":0,"ter":0,"sub1":210,"sub2":0,"sub":210,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-11-06","exc":1470,"apr":252,"pre":0,"nap":1218,"ter1":168,"ter2":0,"ter":168,"sub1":84,"sub2":0,"sub":84,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-11-07","exc":4388,"apr":3716,"pre":0,"nap":672,"ter1":2358,"ter2":1120,"ter":3478,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-11-08","exc":2982,"apr":2562,"pre":0,"nap":420,"ter1":1778,"ter2":448,"ter":2226,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-11-09","exc":3122,"apr":2296,"pre":0,"nap":826,"ter1":1764,"ter2":532,"ter":2296,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-11-10","exc":2286,"apr":1834,"pre":0,"nap":452,"ter1":1778,"ter2":0,"ter":1778,"sub1":336,"sub2":0,"sub":336,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2025-11-11","exc":480,"apr":0,"pre":0,"nap":480,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-11-12","exc":1274,"apr":1274,"pre":0,"nap":0,"ter1":1022,"ter2":252,"ter":1274,"sub1":0,"sub2":154,"sub":154,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2025-11-13","exc":140,"apr":0,"pre":0,"nap":140,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-11-14","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-11-15","exc":1512,"apr":1064,"pre":0,"nap":448,"ter1":840,"ter2":224,"ter":1064,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"}],"a":{"excavacion":{"prod":37463.1,"dias":22,"equipos":3,"meta_dia":850,"proy":56100,"vel":0.6678,"rend":1702.9,"plan_per":51137},"terraplen":{"prod":27438.5,"dias":17,"equipos":5,"meta_dia":680,"proy":57800,"vel":0.4747,"rend":1614,"plan_per":32565},"subbase":{"prod":2541.5,"dias":10,"equipos":3,"meta_dia":430.77,"proy":12923.1,"vel":0.1967,"rend":254.2,"plan_per":8218},"base":{"prod":0,"dias":0,"equipos":0,"meta_dia":430.77,"proy":0,"vel":null,"rend":0,"plan_per":0},"noaprov":{"prod":9249.2,"plan_per":6182,"dias":17,"soloPlan":true}},"split":{"apr":28213.8,"pre":0,"nap":9249.2},"m":{"excavacion":{"nombre":"Excavación","prod":48702,"horas":348.2,"equipos":3,"meta_hora":106.25,"mh":139.87,"grupos":null,"maq":[{"cod":"EXC015","tipo":"EXCAVADORA","uf":"UF1","h":144.5,"perd":1},{"cod":"EXC001","tipo":"EXCAVADORA","uf":"UF1","h":103.5,"perd":22.8},{"cod":"EXC014","tipo":"EXCAVADORA","uf":"UF1","h":100.1,"perd":0}],"mtto":0,"varada":3.4,"lluvia":17,"averia":3.4,"perd":23.8,"dudoso":false},"terraplen":{"nombre":"Terraplén","prod":35670,"horas":341.1,"equipos":5,"meta_hora":85,"mh":104.57,"grupos":[{"tipo":"BULLDOZER","cuota":0.75,"horas":136,"prod":26753,"mh":196.71},{"tipo":"MOTONIVELADORA","cuota":0.25,"horas":205.1,"prod":8918,"mh":43.48}],"maq":[{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1","h":96.6,"perd":36.2},{"cod":"BL009","tipo":"BULLDOZER","uf":"UF1","h":75,"perd":35},{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF1","h":67,"perd":24},{"cod":"BL005","tipo":"BULLDOZER","uf":"UF1","h":61,"perd":12},{"cod":"MO04","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":41.5,"perd":44.8}],"mtto":8,"varada":14.4,"lluvia":107.2,"averia":22.4,"perd":152,"dudoso":false},"subbase":{"nombre":"Subbase","prod":3304,"horas":83,"equipos":3,"meta_hora":43.75,"mh":39.81,"grupos":null,"maq":[{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":51,"perd":7},{"cod":"MO04","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":20.5,"perd":8},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1","h":11.5,"perd":8}],"mtto":0,"varada":1,"lluvia":21,"averia":1,"perd":23,"dudoso":false}}},{"p":"2025-12","d":[{"f":"2025-11-18","exc":2436,"apr":1890,"pre":0,"nap":546,"ter1":1876,"ter2":0,"ter":1876,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-11-19","exc":3682,"apr":3066,"pre":0,"nap":616,"ter1":2310,"ter2":588,"ter":2898,"sub1":616,"sub2":0,"sub":616,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-11-20","exc":3668,"apr":3570,"pre":0,"nap":98,"ter1":3514,"ter2":0,"ter":3514,"sub1":420,"sub2":0,"sub":420,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-11-21","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-11-22","exc":2506,"apr":2366,"pre":0,"nap":140,"ter1":2142,"ter2":0,"ter":2142,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2025-11-24","exc":4102,"apr":2478,"pre":0,"nap":1624,"ter1":2212,"ter2":0,"ter":2212,"sub1":420,"sub2":0,"sub":420,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-11-25","exc":3654,"apr":3654,"pre":0,"nap":0,"ter1":3472,"ter2":0,"ter":3472,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-11-26","exc":2954,"apr":2954,"pre":0,"nap":0,"ter1":2884,"ter2":0,"ter":2884,"sub1":434,"sub2":0,"sub":434,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-11-27","exc":1833,"apr":1218,"pre":0,"nap":615,"ter1":1078,"ter2":0,"ter":1078,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2025-11-28","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-11-29","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2025-12-01","exc":324,"apr":0,"pre":0,"nap":324,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-12-02","exc":1834,"apr":280,"pre":0,"nap":1554,"ter1":280,"ter2":0,"ter":280,"sub1":462,"sub2":0,"sub":462,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-12-03","exc":1484,"apr":0,"pre":0,"nap":1484,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2025-12-04","exc":1022,"apr":238,"pre":0,"nap":784,"ter1":238,"ter2":0,"ter":238,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":142,"bas":142,"t":"SOLEADO"},{"f":"2025-12-05","exc":2506,"apr":2030,"pre":0,"nap":476,"ter1":2030,"ter2":0,"ter":2030,"sub1":224,"sub2":0,"sub":224,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-12-06","exc":966,"apr":588,"pre":0,"nap":378,"ter1":588,"ter2":0,"ter":588,"sub1":84,"sub2":0,"sub":84,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-12-09","exc":200,"apr":0,"pre":0,"nap":200,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2025-12-10","exc":227,"apr":0,"pre":0,"nap":227,"ter1":0,"ter2":0,"ter":0,"sub1":700,"sub2":0,"sub":700,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2025-12-11","exc":1708,"apr":126,"pre":0,"nap":1582,"ter1":126,"ter2":0,"ter":126,"sub1":686,"sub2":0,"sub":686,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-12-12","exc":1137,"apr":882,"pre":0,"nap":255,"ter1":770,"ter2":0,"ter":770,"sub1":672,"sub2":0,"sub":672,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-12-13","exc":255,"apr":0,"pre":0,"nap":255,"ter1":0,"ter2":0,"ter":0,"sub1":350,"sub2":0,"sub":350,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2025-12-15","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"}],"a":{"excavacion":{"prod":28075.4,"dias":19,"equipos":3,"meta_dia":850,"proy":48450,"vel":0.5795,"rend":1477.7,"plan_per":31639},"terraplen":{"prod":18544.6,"dias":14,"equipos":5,"meta_dia":680,"proy":47600,"vel":0.3896,"rend":1324.6,"plan_per":25515},"subbase":{"prod":3898.5,"dias":11,"equipos":3,"meta_dia":430.77,"proy":14215.4,"vel":0.2742,"rend":354.4,"plan_per":4758},"base":{"prod":109.2,"dias":1,"equipos":0,"meta_dia":430.77,"proy":0,"vel":null,"rend":109.2,"plan_per":4142},"noaprov":{"prod":8583.1,"plan_per":2654,"dias":17,"soloPlan":true}},"split":{"apr":19492.3,"pre":0,"nap":8583.1},"m":{"excavacion":{"nombre":"Excavación","prod":36498,"horas":327.2,"equipos":3,"meta_hora":106.25,"mh":111.56,"grupos":null,"maq":[{"cod":"EXC001","tipo":"EXCAVADORA","uf":"UF1","h":147.4,"perd":13.6},{"cod":"EXC014","tipo":"EXCAVADORA","uf":"UF1·UF2","h":101.8,"perd":12},{"cod":"EXC015","tipo":"EXCAVADORA","uf":"UF1","h":78,"perd":19.4}],"mtto":0,"varada":6.4,"lluvia":38.6,"averia":0,"perd":45,"dudoso":false},"terraplen":{"nombre":"Terraplén","prod":24108,"horas":322.6,"equipos":5,"meta_hora":85,"mh":74.73,"grupos":[{"tipo":"BULLDOZER","cuota":0.75,"horas":86,"prod":18081,"mh":210.24},{"tipo":"MOTONIVELADORA","cuota":0.25,"horas":236.6,"prod":6027,"mh":25.47}],"maq":[{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1","h":124.3,"perd":36},{"cod":"BL009","tipo":"BULLDOZER","uf":"UF1","h":78,"perd":54},{"cod":"MO04","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":76.3,"perd":42},{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":36,"perd":21},{"cod":"BL005","tipo":"BULLDOZER","uf":"UF1","h":8,"perd":0}],"mtto":3,"varada":0,"lluvia":150,"averia":0,"perd":153,"dudoso":false},"subbase":{"nombre":"Subbase","prod":5068,"horas":165.2,"equipos":3,"meta_hora":43.75,"mh":30.68,"grupos":null,"maq":[{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF2","h":87,"perd":13},{"cod":"MO04","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":45,"perd":3},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1","h":33.2,"perd":0}],"mtto":3,"varada":0,"lluvia":13,"averia":0,"perd":16,"dudoso":false}}},{"p":"2026-01","d":[{"f":"2025-12-16","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2025-12-17","exc":1400,"apr":1400,"pre":0,"nap":0,"ter1":1400,"ter2":0,"ter":1400,"sub1":168,"sub2":0,"sub":168,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2025-12-18","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":590,"bas":590,"t":"SOLEADO"},{"f":"2025-12-19","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":365,"bas":365,"t":"SOLEADO"},{"f":"2026-01-06","exc":412,"apr":0,"pre":0,"nap":412,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-01-07","exc":1584,"apr":1134,"pre":0,"nap":450,"ter1":1134,"ter2":0,"ter":1134,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":350,"bas":350,"t":"LLUVIAS PARCIALES"},{"f":"2026-01-08","exc":2144,"apr":1890,"pre":0,"nap":254,"ter1":1750,"ter2":0,"ter":1750,"sub1":700,"sub2":0,"sub":700,"bas1":0,"bas2":504,"bas":504,"t":"LLUVIAS"},{"f":"2026-01-09","exc":3892,"apr":2492,"pre":0,"nap":1400,"ter1":2240,"ter2":0,"ter":2240,"sub1":140,"sub2":0,"sub":140,"bas1":0,"bas2":630,"bas":630,"t":"SOLEADO"},{"f":"2026-01-10","exc":2682,"apr":1442,"pre":0,"nap":1240,"ter1":1260,"ter2":0,"ter":1260,"sub1":574,"sub2":0,"sub":574,"bas1":0,"bas2":630,"bas":630,"t":"SOLEADO"},{"f":"2026-01-13","exc":3234.25,"apr":3038,"pre":0,"nap":196.25,"ter1":3038,"ter2":0,"ter":3038,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":406,"bas":406,"t":"SOLEADO"},{"f":"2026-01-14","exc":2839,"apr":2604,"pre":0,"nap":235,"ter1":2030,"ter2":532,"ter":2562,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":434,"bas":434,"t":"SOLEADO"},{"f":"2026-01-15","exc":2277,"apr":2072,"pre":0,"nap":205,"ter1":882,"ter2":1190,"ter":2072,"sub1":714,"sub2":0,"sub":714,"bas1":0,"bas2":182,"bas":182,"t":"LLUVIAS PARCIALES"}],"a":{"excavacion":{"prod":15741.7,"dias":9,"equipos":3,"meta_dia":850,"proy":22950,"vel":0.6859,"rend":1749.1,"plan_per":31639},"terraplen":{"prod":11889.2,"dias":8,"equipos":4,"meta_dia":680,"proy":21760,"vel":0.5464,"rend":1486.2,"plan_per":25515},"subbase":{"prod":1766.2,"dias":5,"equipos":2,"meta_dia":430.77,"proy":4307.7,"vel":0.41,"rend":353.2,"plan_per":4758},"base":{"prod":3146.9,"dias":9,"equipos":3,"meta_dia":430.77,"proy":11630.8,"vel":0.2706,"rend":349.7,"plan_per":4142},"noaprov":{"prod":3378.7,"plan_per":2650,"dias":8,"soloPlan":true}},"split":{"apr":12363.1,"pre":0,"nap":3378.7},"m":{"excavacion":{"nombre":"Excavación","prod":20464,"horas":90.5,"equipos":3,"meta_hora":106.25,"mh":226.12,"grupos":null,"maq":[{"cod":"EXC015","tipo":"EXCAVADORA","uf":"UF1","h":55.9,"perd":0},{"cod":"EXC014","tipo":"EXCAVADORA","uf":"UF1·UF2","h":34.6,"perd":0},{"cod":"EXC001","tipo":"EXCAVADORA","uf":"UF1","h":0,"perd":0}],"mtto":0,"varada":0,"lluvia":0,"averia":0,"perd":0,"dudoso":false},"terraplen":{"nombre":"Terraplén","prod":15456,"horas":200.9,"equipos":4,"meta_hora":85,"mh":76.93,"grupos":[{"tipo":"BULLDOZER","cuota":0.75,"horas":89,"prod":11592,"mh":130.25},{"tipo":"MOTONIVELADORA","cuota":0.25,"horas":111.9,"prod":3864,"mh":34.53}],"maq":[{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1","h":63.9,"perd":0},{"cod":"BL009","tipo":"BULLDOZER","uf":"UF1·UF2","h":51,"perd":0},{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF2","h":48,"perd":0},{"cod":"BL005","tipo":"BULLDOZER","uf":"UF1","h":38,"perd":0}],"mtto":0,"varada":0,"lluvia":0,"averia":0,"perd":0,"dudoso":false},"subbase":{"nombre":"Subbase","prod":2296,"horas":34.2,"equipos":2,"meta_hora":43.75,"mh":67.13,"grupos":null,"maq":[{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1","h":22.7,"perd":0},{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF2","h":11.5,"perd":0}],"mtto":0,"varada":0,"lluvia":0,"averia":0,"perd":0,"dudoso":false},"base":{"nombre":"BTC / Base","prod":4091,"horas":63.2,"equipos":3,"meta_hora":58.75,"mh":64.73,"grupos":null,"maq":[{"cod":"FNG002","tipo":"FINISHER","uf":"UF2","h":30,"perd":6},{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF2","h":24.5,"perd":0},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF2","h":8.7,"perd":0}],"mtto":6,"varada":0,"lluvia":0,"averia":0,"perd":6,"dudoso":false}}},{"p":"2026-02","d":[{"f":"2026-01-16","exc":3038,"apr":3038,"pre":0,"nap":0,"ter1":420,"ter2":2436,"ter":2856,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-01-17","exc":1876,"apr":1876,"pre":0,"nap":0,"ter1":924,"ter2":840,"ter":1764,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-01-19","exc":3526,"apr":2086,"pre":0,"nap":1440,"ter1":756,"ter2":994,"ter":1750,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":420,"bas":420,"t":"SOLEADO"},{"f":"2026-01-20","exc":2064,"apr":2064,"pre":0,"nap":0,"ter1":220,"ter2":994,"ter":1214,"sub1":560,"sub2":0,"sub":560,"bas1":0,"bas2":420,"bas":420,"t":"LLUVIAS PARCIALES"},{"f":"2026-01-21","exc":2208,"apr":2208,"pre":0,"nap":0,"ter1":966,"ter2":1218,"ter":2184,"sub1":616,"sub2":0,"sub":616,"bas1":0,"bas2":560,"bas":560,"t":"SOLEADO"},{"f":"2026-01-22","exc":1680,"apr":1680,"pre":0,"nap":0,"ter1":882,"ter2":742,"ter":1624,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":546,"bas":546,"t":"SOLEADO"},{"f":"2026-01-23","exc":2828,"apr":2478,"pre":0,"nap":350,"ter1":938,"ter2":1540,"ter":2478,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-01-24","exc":1814,"apr":1134,"pre":0,"nap":680,"ter1":476,"ter2":644,"ter":1120,"sub1":240,"sub2":0,"sub":240,"bas1":0,"bas2":240,"bas":240,"t":"SOLEADO"},{"f":"2026-01-26","exc":2346,"apr":1596,"pre":0,"nap":750,"ter1":0,"ter2":1470,"ter":1470,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2026-01-27","exc":828,"apr":0,"pre":0,"nap":828,"ter1":0,"ter2":0,"ter":0,"sub1":182,"sub2":0,"sub":182,"bas1":0,"bas2":70,"bas":70,"t":"LLUVIAS"},{"f":"2026-01-28","exc":1974,"apr":1862,"pre":0,"nap":112,"ter1":1176,"ter2":1092,"ter":2268,"sub1":336,"sub2":476,"sub":812,"bas1":0,"bas2":560,"bas":560,"t":"LLUVIAS PARCIALES"},{"f":"2026-01-29","exc":2009,"apr":1652,"pre":0,"nap":357,"ter1":574,"ter2":1008,"ter":1582,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":611,"bas":611,"t":"SOLEADO"},{"f":"2026-01-30","exc":2333,"apr":1988,"pre":0,"nap":345,"ter1":966,"ter2":952,"ter":1918,"sub1":392,"sub2":196,"sub":588,"bas1":0,"bas2":563,"bas":563,"t":"LLUVIAS PARCIALES"},{"f":"2026-01-31","exc":1910,"apr":1190,"pre":0,"nap":720,"ter1":644,"ter2":546,"ter":1190,"sub1":154,"sub2":84,"sub":238,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-02-02","exc":325,"apr":0,"pre":0,"nap":325,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":336,"bas":336,"t":"LLUVIAS"},{"f":"2026-02-03","exc":2086,"apr":1806,"pre":0,"nap":280,"ter1":728,"ter2":1036,"ter":1764,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":392,"bas":392,"t":"LLUVIAS"},{"f":"2026-02-04","exc":1508,"apr":0,"pre":0,"nap":1508,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":308,"bas":308,"t":"LLUVIAS"},{"f":"2026-02-05","exc":2873,"apr":2749,"pre":0,"nap":124,"ter1":1456,"ter2":1008,"ter":2464,"sub1":154,"sub2":0,"sub":154,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-02-06","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":450,"sub2":0,"sub":450,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2026-02-07","exc":1473,"apr":0,"pre":0,"nap":1473,"ter1":0,"ter2":0,"ter":0,"sub1":225,"sub2":0,"sub":225,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2026-02-09","exc":2800,"apr":2268,"pre":0,"nap":532,"ter1":2268,"ter2":0,"ter":2268,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-02-10","exc":3098,"apr":2800,"pre":0,"nap":298,"ter1":2660,"ter2":0,"ter":2660,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-02-11","exc":1904,"apr":1904,"pre":0,"nap":0,"ter1":2978,"ter2":0,"ter":2978,"sub1":588,"sub2":0,"sub":588,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-02-12","exc":2250,"apr":2250,"pre":0,"nap":0,"ter1":3676,"ter2":0,"ter":3676,"sub1":615,"sub2":0,"sub":615,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-02-13","exc":3318,"apr":1750,"pre":0,"nap":1568,"ter1":2650,"ter2":0,"ter":2650,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-02-14","exc":0,"apr":0,"pre":0,"nap":0,"ter1":510,"ter2":0,"ter":510,"sub1":405,"sub2":0,"sub":405,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"}],"a":{"excavacion":{"prod":40053.1,"dias":24,"equipos":3,"meta_dia":850,"proy":61200,"vel":0.6545,"rend":1668.9,"plan_per":51640},"terraplen":{"prod":32606.2,"dias":21,"equipos":4,"meta_dia":680,"proy":57120,"vel":0.5708,"rend":1552.7,"plan_per":45516},"subbase":{"prod":4363.8,"dias":13,"equipos":2,"meta_dia":430.77,"proy":11200,"vel":0.3896,"rend":335.7,"plan_per":4759},"base":{"prod":3866.2,"dias":12,"equipos":2,"meta_dia":430.77,"proy":10338.5,"vel":0.374,"rend":322.2,"plan_per":4143},"noaprov":{"prod":8992.3,"plan_per":5700,"dias":17,"soloPlan":true}},"split":{"apr":31060.8,"pre":0,"nap":8992.3},"m":{"excavacion":{"nombre":"Excavación","prod":52069,"horas":506.8,"equipos":3,"meta_hora":106.25,"mh":102.74,"grupos":null,"maq":[{"cod":"EXC014","tipo":"EXCAVADORA","uf":"UF1","h":199.7,"perd":16},{"cod":"EXC015","tipo":"EXCAVADORA","uf":"UF1","h":172,"perd":6},{"cod":"EXC001","tipo":"EXCAVADORA","uf":"UF1·UF2","h":135.1,"perd":8}],"mtto":0,"varada":0,"lluvia":30,"averia":0,"perd":30,"dudoso":false},"terraplen":{"nombre":"Terraplén","prod":42388,"horas":455.5,"equipos":4,"meta_hora":85,"mh":93.06,"grupos":[{"tipo":"BULLDOZER","cuota":0.75,"horas":294,"prod":31791,"mh":108.13},{"tipo":"MOTONIVELADORA","cuota":0.25,"horas":161.5,"prod":10597,"mh":65.62}],"maq":[{"cod":"BL009","tipo":"BULLDOZER","uf":"UF1·UF2","h":166,"perd":27},{"cod":"BL005","tipo":"BULLDOZER","uf":"UF1","h":128,"perd":40},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":90.5,"perd":17},{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF1","h":71,"perd":22}],"mtto":4,"varada":0,"lluvia":98,"averia":4,"perd":106,"dudoso":false},"subbase":{"nombre":"Subbase","prod":5673,"horas":161.9,"equipos":2,"meta_hora":43.75,"mh":35.04,"grupos":null,"maq":[{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":82,"perd":16},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":79.9,"perd":0}],"mtto":0,"varada":0,"lluvia":16,"averia":0,"perd":16,"dudoso":false},"base":{"nombre":"BTC / Base","prod":5026,"horas":72.9,"equipos":2,"meta_hora":58.75,"mh":68.94,"grupos":null,"maq":[{"cod":"FNG002","tipo":"FINISHER","uf":"UF2","h":56,"perd":8},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF2","h":16.9,"perd":0}],"mtto":4,"varada":0,"lluvia":0,"averia":4,"perd":8,"dudoso":false}}},{"p":"2026-03","d":[{"f":"2026-02-16","exc":763,"apr":0,"pre":0,"nap":763,"ter1":525,"ter2":0,"ter":525,"sub1":405,"sub2":0,"sub":405,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2026-02-17","exc":1820,"apr":1540,"pre":0,"nap":280,"ter1":1580,"ter2":0,"ter":1580,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-02-18","exc":1972,"apr":1582,"pre":0,"nap":390,"ter1":1582,"ter2":0,"ter":1582,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-02-19","exc":1336,"apr":1210,"pre":0,"nap":126,"ter1":1106,"ter2":0,"ter":1106,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-02-20","exc":1792,"apr":868,"pre":0,"nap":924,"ter1":1240,"ter2":112,"ter":1352,"sub1":345,"sub2":735,"sub":1080,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-02-21","exc":574,"apr":574,"pre":0,"nap":0,"ter1":934,"ter2":0,"ter":934,"sub1":0,"sub2":375,"sub":375,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2026-02-23","exc":450,"apr":0,"pre":0,"nap":450,"ter1":525,"ter2":0,"ter":525,"sub1":60,"sub2":135,"sub":195,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2026-02-24","exc":0,"apr":0,"pre":0,"nap":0,"ter1":450,"ter2":0,"ter":450,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2026-02-25","exc":1178,"apr":728,"pre":0,"nap":450,"ter1":728,"ter2":0,"ter":728,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":450,"bas":450,"t":"LLUVIAS"},{"f":"2026-02-26","exc":3442,"apr":2056,"pre":0,"nap":1386,"ter1":2056,"ter2":0,"ter":2056,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":195,"bas":195,"t":"SOLEADO"},{"f":"2026-02-27","exc":2270,"apr":1500,"pre":0,"nap":770,"ter1":1500,"ter2":0,"ter":1500,"sub1":405,"sub2":0,"sub":405,"bas1":225,"bas2":0,"bas":225,"t":"SOLEADO"},{"f":"2026-02-28","exc":2880,"apr":1550,"pre":0,"nap":1330,"ter1":2351,"ter2":0,"ter":2351,"sub1":0,"sub2":0,"sub":0,"bas1":300,"bas2":0,"bas":300,"t":"SOLEADO"},{"f":"2026-03-02","exc":3128,"apr":2386,"pre":0,"nap":742,"ter1":2372,"ter2":0,"ter":2372,"sub1":28,"sub2":0,"sub":28,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-03-03","exc":2679,"apr":1699,"pre":0,"nap":980,"ter1":1626,"ter2":0,"ter":1626,"sub1":0,"sub2":0,"sub":0,"bas1":480,"bas2":0,"bas":480,"t":"SOLEADO"},{"f":"2026-03-04","exc":4422,"apr":3626,"pre":0,"nap":796,"ter1":3506,"ter2":0,"ter":3506,"sub1":0,"sub2":0,"sub":0,"bas1":585,"bas2":0,"bas":585,"t":"LLUVIAS PARCIALES"},{"f":"2026-03-05","exc":3423,"apr":2506,"pre":0,"nap":917,"ter1":2030,"ter2":0,"ter":2030,"sub1":15,"sub2":0,"sub":15,"bas1":315,"bas2":0,"bas":315,"t":"SOLEADO"},{"f":"2026-03-06","exc":480,"apr":380,"pre":0,"nap":100,"ter1":700,"ter2":0,"ter":700,"sub1":0,"sub2":0,"sub":0,"bas1":207,"bas2":0,"bas":207,"t":"LLUVIAS"},{"f":"2026-03-07","exc":3112,"apr":2877,"pre":0,"nap":235,"ter1":1813,"ter2":0,"ter":1813,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2026-03-09","exc":1187,"apr":907,"pre":0,"nap":280,"ter1":1037,"ter2":0,"ter":1037,"sub1":0,"sub2":0,"sub":0,"bas1":605,"bas2":0,"bas":605,"t":"LLUVIAS"},{"f":"2026-03-10","exc":3010,"apr":2890,"pre":0,"nap":120,"ter1":2764,"ter2":0,"ter":2764,"sub1":570,"sub2":0,"sub":570,"bas1":705,"bas2":0,"bas":705,"t":"LLUVIAS PARCIALES"},{"f":"2026-03-11","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":645,"sub2":0,"sub":645,"bas1":270,"bas2":0,"bas":270,"t":"LLUVIAS"},{"f":"2026-03-12","exc":2224,"apr":2224,"pre":0,"nap":0,"ter1":1972,"ter2":0,"ter":1972,"sub1":435,"sub2":0,"sub":435,"bas1":165,"bas2":0,"bas":165,"t":"SOLEADO"},{"f":"2026-03-13","exc":1946,"apr":1946,"pre":0,"nap":0,"ter1":1288,"ter2":0,"ter":1288,"sub1":525,"sub2":300,"sub":825,"bas1":751,"bas2":0,"bas":751,"t":"LLUVIAS PARCIALES"},{"f":"2026-03-14","exc":1904,"apr":1904,"pre":0,"nap":0,"ter1":1708,"ter2":0,"ter":1708,"sub1":300,"sub2":0,"sub":300,"bas1":316,"bas2":0,"bas":316,"t":"LLUVIAS"}],"a":{"excavacion":{"prod":35378.5,"dias":22,"equipos":3,"meta_dia":850,"proy":56100,"vel":0.6306,"rend":1608.1,"plan_per":51640},"terraplen":{"prod":27311.5,"dias":23,"equipos":4,"meta_dia":680,"proy":62560,"vel":0.4366,"rend":1187.5,"plan_per":45516},"subbase":{"prod":4060,"dias":12,"equipos":3,"meta_dia":430.77,"proy":15507.7,"vel":0.2618,"rend":338.3,"plan_per":4759},"base":{"prod":4283.8,"dias":14,"equipos":3,"meta_dia":430.77,"proy":18092.3,"vel":0.2368,"rend":306,"plan_per":4143},"noaprov":{"prod":8491.5,"plan_per":5700,"dias":18,"soloPlan":true}},"split":{"apr":26886.9,"pre":0,"nap":8491.5},"m":{"excavacion":{"nombre":"Excavación","prod":45992,"horas":399.8,"equipos":3,"meta_hora":106.25,"mh":115.04,"grupos":null,"maq":[{"cod":"EXC001","tipo":"EXCAVADORA","uf":"UF1","h":149.1,"perd":0},{"cod":"EXC015","tipo":"EXCAVADORA","uf":"UF1","h":133.9,"perd":4},{"cod":"EXC014","tipo":"EXCAVADORA","uf":"UF1","h":116.7,"perd":0}],"mtto":0,"varada":0,"lluvia":4,"averia":0,"perd":4,"dudoso":false},"terraplen":{"nombre":"Terraplén","prod":35505,"horas":410.2,"equipos":4,"meta_hora":85,"mh":86.56,"grupos":[{"tipo":"BULLDOZER","cuota":0.75,"horas":258,"prod":26629,"mh":103.21},{"tipo":"MOTONIVELADORA","cuota":0.25,"horas":152.2,"prod":8876,"mh":58.32}],"maq":[{"cod":"BL009","tipo":"BULLDOZER","uf":"UF1","h":184,"perd":21},{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF1","h":78,"perd":47},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":74.2,"perd":8},{"cod":"BL005","tipo":"BULLDOZER","uf":"UF1","h":74,"perd":4}],"mtto":0,"varada":0,"lluvia":80,"averia":0,"perd":80,"dudoso":false},"subbase":{"nombre":"Subbase","prod":5278,"horas":169.5,"equipos":3,"meta_hora":43.75,"mh":31.14,"grupos":null,"maq":[{"cod":"MO04","tipo":"MOTONIVELADORA","uf":"UF1","h":92,"perd":0},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":61.5,"perd":8},{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF1","h":16,"perd":13}],"mtto":0,"varada":0,"lluvia":21,"averia":0,"perd":21,"dudoso":false},"base":{"nombre":"BTC / Base","prod":5569,"horas":65.6,"equipos":3,"meta_hora":58.75,"mh":84.89,"grupos":null,"maq":[{"cod":"FNG002","tipo":"FINISHER","uf":"UF1","h":51,"perd":4},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF2","h":8.6,"perd":5},{"cod":"MO04","tipo":"MOTONIVELADORA","uf":"UF1","h":6,"perd":0}],"mtto":0,"varada":0,"lluvia":9,"averia":0,"perd":9,"dudoso":false}}},{"p":"2026-04","d":[{"f":"2026-03-16","exc":3938,"apr":3866,"pre":0,"nap":72,"ter1":3714,"ter2":0,"ter":3714,"sub1":675,"sub2":0,"sub":675,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-03-17","exc":3092,"apr":2962,"pre":0,"nap":130,"ter1":2198,"ter2":0,"ter":2198,"sub1":0,"sub2":0,"sub":0,"bas1":349,"bas2":0,"bas":349,"t":"SOLEADO"},{"f":"2026-03-18","exc":132,"apr":0,"pre":0,"nap":132,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2026-03-19","exc":2310,"apr":2226,"pre":0,"nap":84,"ter1":1960,"ter2":0,"ter":1960,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2026-03-20","exc":5096,"apr":5096,"pre":0,"nap":0,"ter1":4872,"ter2":0,"ter":4872,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-03-21","exc":308,"apr":0,"pre":0,"nap":308,"ter1":0,"ter2":0,"ter":0,"sub1":255,"sub2":0,"sub":255,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2026-03-23","exc":3360,"apr":3360,"pre":0,"nap":0,"ter1":3080,"ter2":0,"ter":3080,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-03-24","exc":4157,"apr":4157,"pre":0,"nap":0,"ter1":4157,"ter2":0,"ter":4157,"sub1":0,"sub2":0,"sub":0,"bas1":525,"bas2":0,"bas":525,"t":"LLUVIAS PARCIALES"},{"f":"2026-03-25","exc":1464,"apr":759,"pre":0,"nap":705,"ter1":759,"ter2":0,"ter":759,"sub1":103,"sub2":0,"sub":103,"bas1":76,"bas2":0,"bas":76,"t":"LLUVIAS"},{"f":"2026-03-26","exc":2543,"apr":2268,"pre":0,"nap":275,"ter1":1834,"ter2":0,"ter":1834,"sub1":0,"sub2":0,"sub":0,"bas1":690,"bas2":0,"bas":690,"t":"LLUVIAS PARCIALES"},{"f":"2026-03-27","exc":1330,"apr":1330,"pre":0,"nap":0,"ter1":1148,"ter2":0,"ter":1148,"sub1":0,"sub2":0,"sub":0,"bas1":638,"bas2":0,"bas":638,"t":"LLUVIAS"},{"f":"2026-03-28","exc":2926,"apr":2406,"pre":0,"nap":520,"ter1":2086,"ter2":224,"ter":2310,"sub1":1275,"sub2":0,"sub":1275,"bas1":589,"bas2":0,"bas":589,"t":"SOLEADO"},{"f":"2026-03-30","exc":4591,"apr":4591,"pre":0,"nap":0,"ter1":4283,"ter2":308,"ter":4591,"sub1":522,"sub2":0,"sub":522,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-03-31","exc":2730,"apr":2492,"pre":0,"nap":238,"ter1":1960,"ter2":532,"ter":2492,"sub1":180,"sub2":0,"sub":180,"bas1":771,"bas2":0,"bas":771,"t":"SOLEADO"},{"f":"2026-04-07","exc":3810,"apr":3810,"pre":0,"nap":0,"ter1":2536,"ter2":1176,"ter":3712,"sub1":0,"sub2":0,"sub":0,"bas1":685,"bas2":0,"bas":685,"t":"SOLEADO"},{"f":"2026-04-08","exc":2809,"apr":2593,"pre":0,"nap":216,"ter1":1736,"ter2":560,"ter":2296,"sub1":0,"sub2":0,"sub":0,"bas1":526,"bas2":0,"bas":526,"t":"LLUVIAS PARCIALES"},{"f":"2026-04-09","exc":5124,"apr":4494,"pre":0,"nap":630,"ter1":3472,"ter2":308,"ter":3780,"sub1":0,"sub2":0,"sub":0,"bas1":715,"bas2":0,"bas":715,"t":"LLUVIAS PARCIALES"},{"f":"2026-04-10","exc":1498,"apr":672,"pre":0,"nap":826,"ter1":672,"ter2":0,"ter":672,"sub1":420,"sub2":0,"sub":420,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2026-04-11","exc":910,"apr":910,"pre":0,"nap":0,"ter1":910,"ter2":0,"ter":910,"sub1":30,"sub2":0,"sub":30,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-04-13","exc":108,"apr":0,"pre":0,"nap":108,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2026-04-14","exc":3776,"apr":2772,"pre":0,"nap":1004,"ter1":2772,"ter2":0,"ter":2772,"sub1":270,"sub2":0,"sub":270,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-04-15","exc":4371,"apr":3687,"pre":0,"nap":684,"ter1":2609,"ter2":686,"ter":3295,"sub1":0,"sub2":0,"sub":0,"bas1":598,"bas2":0,"bas":598,"t":"SOLEADO"}],"a":{"excavacion":{"prod":46448.5,"dias":22,"equipos":4,"meta_dia":850,"proy":74800,"vel":0.621,"rend":2111.3,"plan_per":51641},"terraplen":{"prod":38886.2,"dias":19,"equipos":5,"meta_dia":680,"proy":64600,"vel":0.602,"rend":2046.6,"plan_per":45517},"subbase":{"prod":2869.2,"dias":9,"equipos":3,"meta_dia":430.77,"proy":11630.8,"vel":0.2467,"rend":318.8,"plan_per":4760},"base":{"prod":4740,"dias":11,"equipos":3,"meta_dia":430.77,"proy":14215.4,"vel":0.3334,"rend":430.9,"plan_per":4144},"noaprov":{"prod":4563.1,"plan_per":5701,"dias":15,"soloPlan":true}},"split":{"apr":41885.4,"pre":0,"nap":4563.1},"m":{"excavacion":{"nombre":"Excavación","prod":60383,"horas":413.2,"equipos":4,"meta_hora":106.25,"mh":146.12,"grupos":null,"maq":[{"cod":"EXC015","tipo":"EXCAVADORA","uf":"UF1·UF2","h":199.9,"perd":0},{"cod":"EXC014","tipo":"EXCAVADORA","uf":"UF1·UF2","h":106.4,"perd":0},{"cod":"EXC001","tipo":"EXCAVADORA","uf":"UF1","h":93.4,"perd":0},{"cod":"CAT320","tipo":"EXCAVADORA","uf":"UF1","h":13.5,"perd":0}],"mtto":0,"varada":0,"lluvia":0,"averia":0,"perd":0,"dudoso":false},"terraplen":{"nombre":"Terraplén","prod":50552,"horas":419.2,"equipos":5,"meta_hora":85,"mh":120.59,"grupos":[{"tipo":"BULLDOZER","cuota":0.75,"horas":225,"prod":37914,"mh":168.51},{"tipo":"MOTONIVELADORA","cuota":0.25,"horas":194.2,"prod":12638,"mh":65.08}],"maq":[{"cod":"BL009","tipo":"BULLDOZER","uf":"UF1","h":171,"perd":28},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1","h":89.7,"perd":8},{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF1","h":88.5,"perd":21},{"cod":"BL005","tipo":"BULLDOZER","uf":"UF1","h":54,"perd":0},{"cod":"MO04","tipo":"MOTONIVELADORA","uf":"UF1","h":16,"perd":0}],"mtto":0,"varada":0,"lluvia":57,"averia":0,"perd":57,"dudoso":false},"subbase":{"nombre":"Subbase","prod":3730,"horas":128.8,"equipos":3,"meta_hora":43.75,"mh":28.96,"grupos":null,"maq":[{"cod":"MO04","tipo":"MOTONIVELADORA","uf":"UF1","h":89,"perd":0},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1","h":36.8,"perd":0},{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF1","h":3,"perd":5}],"mtto":5,"varada":0,"lluvia":0,"averia":0,"perd":5,"dudoso":false},"base":{"nombre":"BTC / Base","prod":6162,"horas":84.5,"equipos":3,"meta_hora":58.75,"mh":72.92,"grupos":null,"maq":[{"cod":"MO04","tipo":"MOTONIVELADORA","uf":"UF1","h":50,"perd":0},{"cod":"FNG002","tipo":"FINISHER","uf":"UF1","h":30,"perd":18},{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF1","h":4.5,"perd":0}],"mtto":0,"varada":9,"lluvia":0,"averia":9,"perd":18,"dudoso":false}}},{"p":"2026-05","d":[{"f":"2026-04-16","exc":240,"apr":0,"pre":0,"nap":240,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2026-04-17","exc":425,"apr":0,"pre":0,"nap":425,"ter1":0,"ter2":0,"ter":0,"sub1":297,"sub2":0,"sub":297,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2026-04-18","exc":896,"apr":896,"pre":0,"nap":0,"ter1":728,"ter2":0,"ter":728,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2026-04-20","exc":3899,"apr":3133,"pre":0,"nap":766,"ter1":2387,"ter2":614,"ter":3001,"sub1":0,"sub2":0,"sub":0,"bas1":542,"bas2":0,"bas":542,"t":"LLUVIAS PARCIALES"},{"f":"2026-04-21","exc":4363,"apr":2451,"pre":574,"nap":1338,"ter1":2422,"ter2":574,"ter":2996,"sub1":0,"sub2":0,"sub":0,"bas1":481,"bas2":0,"bas":481,"t":"LLUVIAS PARCIALES"},{"f":"2026-04-22","exc":4556,"apr":1666,"pre":700,"nap":2190,"ter1":1330,"ter2":700,"ter":2030,"sub1":0,"sub2":0,"sub":0,"bas1":508,"bas2":0,"bas":508,"t":"LLUVIAS PARCIALES"},{"f":"2026-04-23","exc":2051,"apr":826,"pre":196,"nap":1029,"ter1":826,"ter2":364,"ter":1190,"sub1":448,"sub2":0,"sub":448,"bas1":538,"bas2":0,"bas":538,"t":"LLUVIAS"},{"f":"2026-04-24","exc":4356,"apr":3136,"pre":252,"nap":968,"ter1":3066,"ter2":365,"ter":3431,"sub1":148,"sub2":0,"sub":148,"bas1":518,"bas2":0,"bas":518,"t":"LLUVIAS PARCIALES"},{"f":"2026-04-25","exc":644,"apr":504,"pre":0,"nap":140,"ter1":0,"ter2":504,"ter":504,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2026-04-27","exc":2649,"apr":1512,"pre":504,"nap":633,"ter1":1470,"ter2":619,"ter":2089,"sub1":0,"sub2":0,"sub":0,"bas1":472,"bas2":0,"bas":472,"t":"LLUVIAS PARCIALES"},{"f":"2026-04-28","exc":1482,"apr":518,"pre":259,"nap":705,"ter1":518,"ter2":315,"ter":833,"sub1":0,"sub2":0,"sub":0,"bas1":499,"bas2":0,"bas":499,"t":"LLUVIAS"},{"f":"2026-04-29","exc":3830,"apr":1960,"pre":826,"nap":1044,"ter1":1862,"ter2":1059,"ter":2921,"sub1":0,"sub2":0,"sub":0,"bas1":538,"bas2":0,"bas":538,"t":"LLUVIAS PARCIALES"},{"f":"2026-04-30","exc":2324,"apr":994,"pre":1330,"nap":0,"ter1":980,"ter2":1439,"ter":2419,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-05-04","exc":450,"apr":0,"pre":0,"nap":450,"ter1":0,"ter2":240,"ter":240,"sub1":0,"sub2":0,"sub":0,"bas1":354,"bas2":0,"bas":354,"t":"LLUVIAS"},{"f":"2026-05-05","exc":2662,"apr":574,"pre":1233,"nap":855,"ter1":574,"ter2":1361,"ter":1935,"sub1":0,"sub2":0,"sub":0,"bas1":368,"bas2":0,"bas":368,"t":"SOLEADO"},{"f":"2026-05-06","exc":1960,"apr":238,"pre":826,"nap":896,"ter1":238,"ter2":826,"ter":1064,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":358,"bas":358,"t":"LLUVIAS PARCIALES"},{"f":"2026-05-07","exc":2898,"apr":1078,"pre":1190,"nap":630,"ter1":784,"ter2":1392,"ter":2176,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":545,"bas":545,"t":"SOLEADO"},{"f":"2026-05-08","exc":1781,"apr":658,"pre":322,"nap":801,"ter1":658,"ter2":322,"ter":980,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":543,"bas":543,"t":"LLUVIAS"},{"f":"2026-05-09","exc":4198,"apr":742,"pre":3456,"nap":0,"ter1":1290,"ter2":3048,"ter":4338,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-05-11","exc":3038,"apr":1092,"pre":1820,"nap":126,"ter1":980,"ter2":1820,"ter":2800,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":380,"bas":380,"t":"SOLEADO"},{"f":"2026-05-12","exc":4340,"apr":1092,"pre":2492,"nap":756,"ter1":1092,"ter2":2492,"ter":3584,"sub1":286,"sub2":302,"sub":588,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-05-13","exc":1708,"apr":770,"pre":602,"nap":336,"ter1":770,"ter2":602,"ter":1372,"sub1":173,"sub2":0,"sub":173,"bas1":685,"bas2":0,"bas":685,"t":"LLUVIAS"},{"f":"2026-05-14","exc":3906,"apr":868,"pre":2632,"nap":406,"ter1":868,"ter2":2632,"ter":3500,"sub1":15.8,"sub2":0,"sub":15.8,"bas1":604.7,"bas2":0,"bas":604.7,"t":"SOLEADO"},{"f":"2026-05-15","exc":4244,"apr":506,"pre":2478,"nap":1260,"ter1":506,"ter2":2478,"ter":2984,"sub1":518,"sub2":28,"sub":546,"bas1":317,"bas2":44,"bas":361,"t":"SOLEADO"}],"a":{"excavacion":{"prod":48384.6,"dias":24,"equipos":4,"meta_dia":850,"proy":81600,"vel":0.5929,"rend":2016,"plan_per":51642},"terraplen":{"prod":36242.3,"dias":22,"equipos":4,"meta_dia":680,"proy":59840,"vel":0.6057,"rend":1647.4,"plan_per":45518},"subbase":{"prod":1704.5,"dias":7,"equipos":2,"meta_dia":430.77,"proy":6030.8,"vel":0.2826,"rend":243.5,"plan_per":4761},"base":{"prod":6380.5,"dias":17,"equipos":3,"meta_dia":430.77,"proy":21969.2,"vel":0.2904,"rend":375.3,"plan_per":4145},"noaprov":{"prod":12303.1,"plan_per":5702,"dias":21,"soloPlan":true}},"split":{"apr":19395.4,"pre":16686.2,"nap":12303.1},"m":{"excavacion":{"nombre":"Excavación","prod":62900,"horas":570.7,"equipos":4,"meta_hora":106.25,"mh":110.22,"grupos":null,"maq":[{"cod":"EXC015","tipo":"EXCAVADORA","uf":"UF1","h":174.5,"perd":13},{"cod":"EXC013","tipo":"EXCAVADORA","uf":"UF1","h":154,"perd":23},{"cod":"EXC001","tipo":"EXCAVADORA","uf":"UF1","h":145.8,"perd":0},{"cod":"EXC014","tipo":"EXCAVADORA","uf":"UF1·UF2","h":96.4,"perd":0}],"mtto":4,"varada":9,"lluvia":14,"averia":9,"perd":36,"dudoso":false},"terraplen":{"nombre":"Terraplén","prod":47115,"horas":344.6,"equipos":4,"meta_hora":85,"mh":136.72,"grupos":[{"tipo":"BULLDOZER","cuota":0.75,"horas":118,"prod":35336,"mh":299.46},{"tipo":"MOTONIVELADORA","cuota":0.25,"horas":226.6,"prod":11779,"mh":51.98}],"maq":[{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF1","h":125,"perd":25.6},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":101.6,"perd":0},{"cod":"BL005","tipo":"BULLDOZER","uf":"UF1·UF2","h":98,"perd":12},{"cod":"NH69","tipo":"BULLDOZER","uf":"UF1","h":20,"perd":10}],"mtto":0,"varada":7,"lluvia":34.6,"averia":6,"perd":47.6,"dudoso":false},"subbase":{"nombre":"Subbase","prod":2216,"horas":105.6,"equipos":2,"meta_hora":43.75,"mh":20.98,"grupos":null,"maq":[{"cod":"MO04","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":75,"perd":0},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":30.6,"perd":8}],"mtto":0,"varada":0,"lluvia":8,"averia":0,"perd":8,"dudoso":false},"base":{"nombre":"BTC / Base","prod":8295,"horas":139.7,"equipos":3,"meta_hora":58.75,"mh":59.38,"grupos":null,"maq":[{"cod":"MO04","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":92,"perd":0},{"cod":"FNG002","tipo":"FINISHER","uf":"UF1·UF2","h":30,"perd":4},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1","h":17.7,"perd":0}],"mtto":0,"varada":2,"lluvia":0,"averia":2,"perd":4,"dudoso":false}}},{"p":"2026-06","d":[{"f":"2026-05-16","exc":2506,"apr":728,"pre":1470,"nap":308,"ter1":728,"ter2":1470,"ter":2198,"sub1":275,"sub2":0,"sub":275,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-05-17","exc":3234,"apr":0,"pre":3234,"nap":0,"ter1":1162,"ter2":2072,"ter":3234,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-05-18","exc":4870,"apr":756,"pre":2730,"nap":1384,"ter1":1120,"ter2":2366,"ter":3486,"sub1":559.6,"sub2":0,"sub":559.6,"bas1":861,"bas2":0,"bas":861,"t":"SOLEADO"},{"f":"2026-05-19","exc":3766,"apr":2524,"pre":752,"nap":490,"ter1":336,"ter2":2940,"ter":3276,"sub1":1338,"sub2":0,"sub":1338,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2026-05-20","exc":3521,"apr":1624,"pre":1148,"nap":749,"ter1":154,"ter2":2506,"ter":2660,"sub1":876,"sub2":0,"sub":876,"bas1":383,"bas2":0,"bas":383,"t":"SOLEADO"},{"f":"2026-05-21","exc":1866,"apr":1474,"pre":392,"nap":0,"ter1":0,"ter2":1764,"ter":1764,"sub1":351,"sub2":0,"sub":351,"bas1":604,"bas2":0,"bas":604,"t":"LLUVIAS PARCIALES"},{"f":"2026-05-22","exc":4694,"apr":3206,"pre":1008,"nap":480,"ter1":1148,"ter2":2884,"ter":4032,"sub1":0,"sub2":0,"sub":0,"bas1":353,"bas2":0,"bas":353,"t":"SOLEADO"},{"f":"2026-05-23","exc":2860,"apr":798,"pre":1162,"nap":900,"ter1":350,"ter2":1680,"ter":2030,"sub1":863,"sub2":0,"sub":863,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2026-05-25","exc":2394,"apr":1358,"pre":350,"nap":686,"ter1":1106,"ter2":560,"ter":1666,"sub1":141,"sub2":0,"sub":141,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2026-05-26","exc":3856,"apr":2044,"pre":1162,"nap":650,"ter1":1036,"ter2":2100,"ter":3136,"sub1":566,"sub2":0,"sub":566,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2026-05-27","exc":6229,"apr":3444,"pre":1750,"nap":1035,"ter1":1428,"ter2":3626,"ter":5054,"sub1":685,"sub2":0,"sub":685,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-05-28","exc":4862,"apr":4144,"pre":0,"nap":718,"ter1":1750,"ter2":2184,"ter":3934,"sub1":617.2,"sub2":0,"sub":617.2,"bas1":605,"bas2":0,"bas":605,"t":"SOLEADO"},{"f":"2026-05-29","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2026-05-30","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":91.83,"sub2":0,"sub":91.83,"bas1":419,"bas2":0,"bas":419,"t":"LLUVIAS"},{"f":"2026-06-01","exc":5812,"apr":3640,"pre":1092,"nap":1080,"ter1":1694,"ter2":2800,"ter":4494,"sub1":275.59,"sub2":0,"sub":275.59,"bas1":687,"bas2":0,"bas":687,"t":"SOLEADO"},{"f":"2026-06-02","exc":4928,"apr":2744,"pre":2044,"nap":140,"ter1":2254,"ter2":2394,"ter":4648,"sub1":352,"sub2":0,"sub":352,"bas1":425,"bas2":0,"bas":425,"t":"SOLEADO"},{"f":"2026-06-03","exc":4900,"apr":1302,"pre":2898,"nap":700,"ter1":882,"ter2":2968,"ter":3850,"sub1":565,"sub2":0,"sub":565,"bas1":393,"bas2":0,"bas":393,"t":"SOLEADO"},{"f":"2026-06-04","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2026-06-05","exc":3300,"apr":1092,"pre":1904,"nap":304,"ter1":1596,"ter2":1638,"ter":3234,"sub1":156.3,"sub2":0,"sub":156.3,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2026-06-06","exc":2870,"apr":924,"pre":1946,"nap":0,"ter1":602,"ter2":1540,"ter":2142,"sub1":112.4,"sub2":0,"sub":112.4,"bas1":366,"bas2":0,"bas":366,"t":"LLUVIAS PARCIALES"},{"f":"2026-06-08","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2026-06-09","exc":1757,"apr":1082,"pre":0,"nap":675,"ter1":448,"ter2":0,"ter":448,"sub1":126.3,"sub2":0,"sub":126.3,"bas1":491,"bas2":0,"bas":491,"t":"LLUVIAS PARCIALES"},{"f":"2026-06-10","exc":4400,"apr":2800,"pre":1600,"nap":0,"ter1":1330,"ter2":2996,"ter":4326,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-06-11","exc":4354,"apr":1904,"pre":2450,"nap":0,"ter1":2142,"ter2":1946,"ter":4088,"sub1":451.41,"sub2":0,"sub":451.41,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-06-12","exc":4326,"apr":2478,"pre":1848,"nap":0,"ter1":1316,"ter2":2492,"ter":3808,"sub1":375,"sub2":0,"sub":375,"bas1":349,"bas2":0,"bas":349,"t":"SOLEADO"},{"f":"2026-06-13","exc":2002,"apr":1092,"pre":798,"nap":112,"ter1":854,"ter2":966,"ter":1820,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-06-14","exc":2072,"apr":518,"pre":1554,"nap":0,"ter1":0,"ter2":2016,"ter":2016,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2026-06-15","exc":2310,"apr":868,"pre":1442,"nap":0,"ter1":0,"ter2":2212,"ter":2212,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"}],"a":{"excavacion":{"prod":67453.1,"dias":24,"equipos":5,"meta_dia":850,"proy":102000,"vel":0.6613,"rend":2810.5,"plan_per":60000},"terraplen":{"prod":56581.5,"dias":24,"equipos":5,"meta_dia":680,"proy":81600,"vel":0.6934,"rend":2357.6,"plan_per":45000},"subbase":{"prod":6752,"dias":19,"equipos":3,"meta_dia":430.77,"proy":24553.8,"vel":0.275,"rend":355.4,"plan_per":6600},"base":{"prod":4566.2,"dias":12,"equipos":2,"meta_dia":430.77,"proy":10338.5,"vel":0.4417,"rend":380.5,"plan_per":7200},"noaprov":{"prod":8008.5,"plan_per":5703,"dias":16,"soloPlan":true}},"split":{"apr":32726.2,"pre":26718.5,"nap":8008.5},"m":{"excavacion":{"nombre":"Excavación","prod":87689,"horas":838.1,"equipos":5,"meta_hora":106.25,"mh":104.63,"grupos":null,"maq":[{"cod":"EXC013","tipo":"EXCAVADORA","uf":"UF1","h":213.4,"perd":25},{"cod":"CAT320","tipo":"EXCAVADORA","uf":"UF1","h":181.2,"perd":13},{"cod":"EXC001","tipo":"EXCAVADORA","uf":"UF1","h":178.2,"perd":12},{"cod":"EXC015","tipo":"EXCAVADORA","uf":"UF1","h":144.2,"perd":8},{"cod":"EXC014","tipo":"EXCAVADORA","uf":"UF1·UF2","h":121.1,"perd":10.3}],"mtto":0,"varada":5,"lluvia":58.3,"averia":5,"perd":68.3,"dudoso":false},"terraplen":{"nombre":"Terraplén","prod":73556,"horas":543.1,"equipos":5,"meta_hora":85,"mh":135.44,"grupos":[{"tipo":"BULLDOZER","cuota":0.75,"horas":270,"prod":55167,"mh":204.32},{"tipo":"MOTONIVELADORA","cuota":0.25,"horas":273.1,"prod":18389,"mh":67.33}],"maq":[{"cod":"NH69","tipo":"BULLDOZER","uf":"UF1·UF2","h":139,"perd":33},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1","h":131.1,"perd":12},{"cod":"BL005","tipo":"BULLDOZER","uf":"UF1·UF2","h":131,"perd":12},{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF1","h":109,"perd":27},{"cod":"MO04","tipo":"MOTONIVELADORA","uf":"UF1","h":33,"perd":8}],"mtto":0,"varada":4,"lluvia":86,"averia":2,"perd":92,"dudoso":false},"subbase":{"nombre":"Subbase","prod":8778,"horas":167.1,"equipos":3,"meta_hora":43.75,"mh":52.53,"grupos":null,"maq":[{"cod":"MO04","tipo":"MOTONIVELADORA","uf":"UF1","h":106,"perd":6},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1","h":48.1,"perd":22},{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF1","h":13,"perd":4}],"mtto":0,"varada":8,"lluvia":16,"averia":8,"perd":32,"dudoso":false},"base":{"nombre":"BTC / Base","prod":5936,"horas":54,"equipos":2,"meta_hora":58.75,"mh":109.93,"grupos":null,"maq":[{"cod":"FNG002","tipo":"FINISHER","uf":"UF1","h":39,"perd":8},{"cod":"MO04","tipo":"MOTONIVELADORA","uf":"UF1","h":15,"perd":0}],"mtto":0,"varada":0,"lluvia":8,"averia":0,"perd":8,"dudoso":false}}},{"p":"2026-07","d":[{"f":"2026-06-16","exc":4756,"apr":1876,"pre":1806,"nap":1074,"ter1":210,"ter2":3416,"ter":3626,"sub1":559,"sub2":0,"sub":559,"bas1":380,"bas2":0,"bas":380,"t":"SOLEADO"},{"f":"2026-06-17","exc":3746,"apr":1804,"pre":1402,"nap":540,"ter1":1806,"ter2":1078,"ter":2884,"sub1":420,"sub2":0,"sub":420,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-06-18","exc":5844,"apr":2604,"pre":2590,"nap":650,"ter1":2129,"ter2":2968,"ter":5097,"sub1":210,"sub2":0,"sub":210,"bas1":548.45,"bas2":0,"bas":548.45,"t":"SOLEADO"},{"f":"2026-06-19","exc":4873,"apr":1547,"pre":2906,"nap":420,"ter1":1455,"ter2":2774,"ter":4229,"sub1":0,"sub2":0,"sub":0,"bas1":489.13,"bas2":0,"bas":489.13,"t":"SOLEADO"},{"f":"2026-06-20","exc":1815.67,"apr":1815.67,"pre":0,"nap":0,"ter1":829.55,"ter2":944.12,"ter":1773.67,"sub1":462.7,"sub2":0,"sub":462.7,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-06-22","exc":2676.7,"apr":140.7,"pre":2410,"nap":126,"ter1":798,"ter2":1488,"ter":2286,"sub1":569.94,"sub2":0,"sub":569.94,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2026-06-23","exc":4598,"apr":1999,"pre":2263,"nap":336,"ter1":952,"ter2":3003,"ter":3955,"sub1":300,"sub2":0,"sub":300,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-06-24","exc":5173,"apr":2967,"pre":1898,"nap":308,"ter1":1832,"ter2":2838,"ter":4670,"sub1":0,"sub2":0,"sub":0,"bas1":751.98,"bas2":0,"bas":751.98,"t":"SOLEADO"},{"f":"2026-06-25","exc":2117.2799999999997,"apr":1967.28,"pre":0,"nap":150,"ter1":448,"ter2":1435.28,"ter":1883.28,"sub1":0,"sub2":0,"sub":0,"bas1":724.45,"bas2":0,"bas":724.45,"t":"SOLEADO"},{"f":"2026-06-26","exc":3805.38,"apr":3805.38,"pre":0,"nap":0,"ter1":2176,"ter2":1629.38,"ter":3805.38,"sub1":0,"sub2":0,"sub":0,"bas1":740.73,"bas2":0,"bas":740.73,"t":"SOLEADO"},{"f":"2026-06-27","exc":1948.01,"apr":1819.01,"pre":0,"nap":129,"ter1":868.86,"ter2":950.15,"ter":1819.01,"sub1":0,"sub2":0,"sub":0,"bas1":365.05,"bas2":0,"bas":365.05,"t":"SOLEADO"},{"f":"2026-06-29","exc":3986.8,"apr":2502.8,"pre":0,"nap":1484,"ter1":2600.8,"ter2":0,"ter":2600.8,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-06-30","exc":3010.56,"apr":2954.56,"pre":0,"nap":56,"ter1":1185.66,"ter2":1810.9,"ter":2996.5600000000004,"sub1":155.4,"sub2":0,"sub":155.4,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-07-01","exc":3056.48,"apr":2748.48,"pre":0,"nap":308,"ter1":1824,"ter2":1120.06,"ter":2944.06,"sub1":139.84,"sub2":0,"sub":139.84,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-07-02","exc":2986.87,"apr":2846.87,"pre":0,"nap":140,"ter1":844,"ter2":1796.87,"ter":2640.87,"sub1":0,"sub2":450.32,"sub":450.32,"bas1":683.02,"bas2":0,"bas":683.02,"t":"SOLEADO"},{"f":"2026-07-03","exc":3627.86,"apr":3012.86,"pre":0,"nap":615,"ter1":630,"ter2":2592.86,"ter":3222.86,"sub1":0,"sub2":0,"sub":0,"bas1":722.72,"bas2":0,"bas":722.72,"t":"LLUVIAS PARCIALES"},{"f":"2026-07-04","exc":1679.47,"apr":1153.47,"pre":0,"nap":526,"ter1":0,"ter2":1153,"ter":1153,"sub1":0,"sub2":437,"sub":437,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-07-06","exc":4293.2,"apr":3313.2,"pre":0,"nap":980,"ter1":1900.44,"ter2":1356,"ter":3256.44,"sub1":0,"sub2":188,"sub":188,"bas1":799.94,"bas2":0,"bas":799.94,"t":"SOLEADO"},{"f":"2026-07-07","exc":2772.89,"apr":2598.89,"pre":0,"nap":174,"ter1":168,"ter2":2500.89,"ter":2668.89,"sub1":172.34,"sub2":390.49,"sub":562.83,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-07-08","exc":4559.18,"apr":4559.18,"pre":0,"nap":0,"ter1":1639,"ter2":2818.92,"ter":4457.92,"sub1":177.9,"sub2":0,"sub":177.9,"bas1":622.77,"bas2":0,"bas":622.77,"t":"SOLEADO"},{"f":"2026-07-09","exc":1022,"apr":140,"pre":0,"nap":882,"ter1":140,"ter2":0,"ter":140,"sub1":0,"sub2":30,"sub":30,"bas1":830,"bas2":0,"bas":830,"t":"LLUVIAS"},{"f":"2026-07-10","exc":2583,"apr":2433,"pre":0,"nap":150,"ter1":1245.48,"ter2":1421,"ter":2666.48,"sub1":0,"sub2":312,"sub":312,"bas1":813.08,"bas2":0,"bas":813.08,"t":"SOLEADO"},{"f":"2026-07-11","exc":1466,"apr":1316,"pre":0,"nap":150,"ter1":434,"ter2":1022,"ter":1456,"sub1":0,"sub2":453.5,"sub":453.5,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-07-13","exc":1226,"apr":196,"pre":0,"nap":1030,"ter1":84,"ter2":0,"ter":84,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2026-07-14","exc":2201,"apr":1215,"pre":0,"nap":986,"ter1":224,"ter2":1045.02,"ter":1269.02,"sub1":363.12,"sub2":549.03,"sub":912.15,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-07-15","exc":4646.2,"apr":3264.88,"pre":0,"nap":1381.32,"ter1":224,"ter2":3124.88,"ter":3348.88,"sub1":140.27,"sub2":437.02,"sub":577.29,"bas1":663.82,"bas2":0,"bas":663.82,"t":"SOLEADO"}],"a":{"excavacion":{"prod":64977.3,"dias":26,"equipos":5,"meta_dia":850,"proy":110500,"vel":0.588,"rend":2499.1,"plan_per":60000},"terraplen":{"prod":54564.7,"dias":26,"equipos":5,"meta_dia":680,"proy":88400,"vel":0.6172,"rend":2098.6,"plan_per":45000},"subbase":{"prod":5321.4,"dias":18,"equipos":2,"meta_dia":430.77,"proy":15507.7,"vel":0.3431,"rend":295.6,"plan_per":6600},"base":{"prod":7027,"dias":14,"equipos":2,"meta_dia":430.77,"proy":12061.5,"vel":0.5826,"rend":501.9,"plan_per":7200},"noaprov":{"prod":9688.7,"plan_per":5703,"dias":23,"soloPlan":true}},"split":{"apr":43538.6,"pre":11750,"nap":9688.7},"m":{"excavacion":{"nombre":"Excavación","prod":84471,"horas":697,"equipos":5,"meta_hora":106.25,"mh":121.19,"grupos":null,"maq":[{"cod":"EXC013","tipo":"EXCAVADORA","uf":"UF1","h":186.6,"perd":0},{"cod":"EXC015","tipo":"EXCAVADORA","uf":"UF1","h":184.3,"perd":0},{"cod":"EXC001","tipo":"EXCAVADORA","uf":"UF1","h":155,"perd":0},{"cod":"EXC014","tipo":"EXCAVADORA","uf":"UF1","h":134.9,"perd":0},{"cod":"CAT320","tipo":"EXCAVADORA","uf":"UF1","h":36.2,"perd":0}],"mtto":0,"varada":0,"lluvia":0,"averia":0,"perd":0,"dudoso":false},"terraplen":{"nombre":"Terraplén","prod":70934,"horas":531.6,"equipos":5,"meta_hora":85,"mh":133.44,"grupos":[{"tipo":"BULLDOZER","cuota":0.75,"horas":313,"prod":53201,"mh":169.97},{"tipo":"MOTONIVELADORA","cuota":0.25,"horas":218.6,"prod":17734,"mh":81.12}],"maq":[{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":170,"perd":0},{"cod":"NH69","tipo":"BULLDOZER","uf":"UF2","h":158,"perd":0},{"cod":"BL005","tipo":"BULLDOZER","uf":"UF1·UF2","h":155,"perd":17.2},{"cod":"MO04","tipo":"MOTONIVELADORA","uf":"UF1","h":28,"perd":0},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":20.6,"perd":10}],"mtto":0,"varada":9.6,"lluvia":8,"averia":9.6,"perd":27.2,"dudoso":false},"subbase":{"nombre":"Subbase","prod":6918,"horas":137.6,"equipos":2,"meta_hora":43.75,"mh":50.28,"grupos":null,"maq":[{"cod":"MO04","tipo":"MOTONIVELADORA","uf":"UF1","h":118,"perd":0},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1","h":19.6,"perd":10}],"mtto":0,"varada":5,"lluvia":0,"averia":5,"perd":10,"dudoso":false},"base":{"nombre":"BTC / Base","prod":9135,"horas":93,"equipos":2,"meta_hora":58.75,"mh":98.23,"grupos":null,"maq":[{"cod":"FNG002","tipo":"FINISHER","uf":"UF1","h":66,"perd":0},{"cod":"MO04","tipo":"MOTONIVELADORA","uf":"UF1","h":27,"perd":0}],"mtto":0,"varada":0,"lluvia":0,"averia":0,"perd":0,"dudoso":false}}},{"p":"2026-08","d":[{"f":"2026-07-16","exc":2342,"apr":1946,"pre":0,"nap":396,"ter1":630,"ter2":1078.09,"ter":1708.09,"sub1":264.65,"sub2":0,"sub":264.65,"bas1":649.67,"bas2":0,"bas":649.67,"t":"SOLEADO"},{"f":"2026-07-17","exc":2951.97,"apr":2363.97,"pre":0,"nap":588,"ter1":434,"ter2":1591.44,"ter":2025.44,"sub1":0,"sub2":0,"sub":0,"bas1":644.81,"bas2":0,"bas":644.81,"t":"SOLEADO"},{"f":"2026-07-18","exc":1500.97,"apr":1500.97,"pre":0,"nap":0,"ter1":434,"ter2":743.17,"ter":1177.17,"sub1":911.61,"sub2":0,"sub":911.61,"bas1":317.24,"bas2":0,"bas":317.24,"t":"SOLEADO"},{"f":"2026-07-21","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":496.61,"sub2":0,"sub":496.61,"bas1":281.01,"bas2":0,"bas":281.01,"t":"LLUVIAS"},{"f":"2026-07-22","exc":2539.2,"apr":2483.2,"pre":0,"nap":56,"ter1":616,"ter2":1848,"ter":2464,"sub1":231.26,"sub2":0,"sub":231.26,"bas1":402.12,"bas2":0,"bas":402.12,"t":"SOLEADO"},{"f":"2026-07-23","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":409.53,"bas2":0,"bas":409.53,"t":"LLUVIAS"},{"f":"2026-07-24","exc":2581.48,"apr":2581.48,"pre":0,"nap":0,"ter1":28,"ter2":2236.06,"ter":2264.06,"sub1":0,"sub2":0,"sub":0,"bas1":318.09,"bas2":0,"bas":318.09,"t":"SOLEADO"},{"f":"2026-07-25","exc":2045.55,"apr":2045.55,"pre":0,"nap":0,"ter1":574.06,"ter2":1104.63,"ter":1678.69,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2026-07-27","exc":718,"apr":718,"pre":0,"nap":0,"ter1":938,"ter2":0,"ter":938,"sub1":683.33,"sub2":0,"sub":683.33,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2026-07-28","exc":1561.8,"apr":1561.8,"pre":0,"nap":0,"ter1":396.18,"ter2":1267.8,"ter":1663.98,"sub1":466.47,"sub2":559.76,"sub":1026.23,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-07-29","exc":1957.08,"apr":1957.08,"pre":0,"nap":0,"ter1":1442,"ter2":918.4,"ter":2360.4,"sub1":371.3,"sub2":986.11,"sub":1357.41,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-07-30","exc":2716.99,"apr":2005.98,"pre":0,"nap":711.01,"ter1":1739.1,"ter2":252,"ter":1991.1,"sub1":0,"sub2":300,"sub":300,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-07-31","exc":2514.12,"apr":739.31,"pre":0,"nap":1774.81,"ter1":709.2,"ter2":14,"ter":723.2,"sub1":400.55,"sub2":588.09,"sub":988.6400000000001,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-08-01","exc":1051.75,"apr":291.08,"pre":0,"nap":760.67,"ter1":398.08,"ter2":0,"ter":398.08,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2026-08-03","exc":1584.6000000000001,"apr":1213.4,"pre":0,"nap":371.2,"ter1":1629.4,"ter2":0,"ter":1629.4,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-08-04","exc":1630.29,"apr":972.7,"pre":0,"nap":657.59,"ter1":972.7,"ter2":0,"ter":972.7,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2026-08-05","exc":1068,"apr":908,"pre":0,"nap":160,"ter1":908,"ter2":0,"ter":908,"sub1":315.03,"sub2":0,"sub":315.03,"bas1":438.91,"bas2":0,"bas":438.91,"t":"SOLEADO"},{"f":"2026-08-06","exc":1896,"apr":1728,"pre":0,"nap":168,"ter1":1700,"ter2":0,"ter":1700,"sub1":0,"sub2":0,"sub":0,"bas1":799.68,"bas2":0,"bas":799.68,"t":"LLUVIAS"},{"f":"2026-08-07","exc":2404.1099999999988,"apr":988.5,"pre":0,"nap":1415.609999999999,"ter1":946.2,"ter2":0,"ter":946.2,"sub1":183.13000000000002,"sub2":1620.87,"sub":1804,"bas1":427.28000000000003,"bas2":0,"bas":427.28000000000003,"t":"SOLEADO"},{"f":"2026-08-08","exc":1146.51,"apr":74.49,"pre":0,"nap":1072.02,"ter1":74.49,"ter2":0,"ter":74.49,"sub1":163.27,"sub2":234.26,"sub":397.53,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-08-09","exc":942.4200000000001,"apr":28,"pre":0,"nap":914.4200000000001,"ter1":28,"ter2":0,"ter":28,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-08-10","exc":1560.54,"apr":882.52,"pre":0,"nap":678.02,"ter1":714.52,"ter2":168,"ter":882.52,"sub1":445.59,"sub2":0,"sub":445.59,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-08-11","exc":2800.29,"apr":439.55,"pre":0,"nap":2360.74,"ter1":439.55,"ter2":0,"ter":439.55,"sub1":0,"sub2":85.85,"sub":85.85,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-08-12","exc":937.23,"apr":476,"pre":0,"nap":461.23,"ter1":476,"ter2":0,"ter":476,"sub1":322.74,"sub2":105,"sub":427.74,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-08-13","exc":1109.62,"apr":641.56,"pre":0,"nap":468.06,"ter1":362.27,"ter2":437.52,"ter":799.79,"sub1":283.5,"sub2":106.69999999999999,"sub":390.2,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-08-14","exc":1607.6599999999999,"apr":1089.6599999999999,"pre":0,"nap":518,"ter1":459.68,"ter2":503.98,"ter":963.6600000000001,"sub1":0,"sub2":52.46,"sub":52.46,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2026-08-15","exc":318.44,"apr":304.44,"pre":0,"nap":14,"ter1":74,"ter2":230.44,"ter":304.44,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"}],"a":{"excavacion":{"prod":33451.2,"dias":25,"equipos":3,"meta_dia":850,"proy":63750,"vel":0.5247,"rend":1338,"plan_per":35000},"terraplen":{"prod":22705.4,"dias":25,"equipos":2,"meta_dia":680,"proy":34000,"vel":0.6678,"rend":908.2,"plan_per":24500},"subbase":{"prod":7829.3,"dias":17,"equipos":2,"meta_dia":430.77,"proy":14646.2,"vel":0.5346,"rend":460.5,"plan_per":6600},"base":{"prod":3606.4,"dias":10,"equipos":1,"meta_dia":430.77,"proy":4307.7,"vel":0.8372,"rend":360.6,"plan_per":4500},"noaprov":{"prod":10419.5,"plan_per":9500,"dias":19,"soloPlan":true}},"split":{"apr":23031.7,"pre":0,"nap":10419.5},"m":{"excavacion":{"nombre":"Excavación","prod":43487,"horas":354.6,"equipos":3,"meta_hora":106.25,"mh":122.65,"grupos":null,"maq":[{"cod":"EXC001","tipo":"EXCAVADORA","uf":"UF1·UF2","h":228.6,"perd":0},{"cod":"EXC015","tipo":"EXCAVADORA","uf":"UF1·UF2","h":102.2,"perd":0},{"cod":"EXC014","tipo":"EXCAVADORA","uf":"UF1","h":23.8,"perd":0}],"mtto":0,"varada":0,"lluvia":0,"averia":0,"perd":0,"dudoso":false},"terraplen":{"nombre":"Terraplén","prod":29517,"horas":212.4,"equipos":2,"meta_hora":85,"mh":138.97,"grupos":[{"tipo":"BULLDOZER","cuota":0.75,"horas":61.4,"prod":22138,"mh":360.55},{"tipo":"MOTONIVELADORA","cuota":0.25,"horas":151,"prod":7379,"mh":48.87}],"maq":[{"cod":"MO04","tipo":"MOTONIVELADORA","uf":"UF1","h":151,"perd":0},{"cod":"NH69","tipo":"BULLDOZER","uf":"UF1·UF2","h":61.4,"perd":10}],"mtto":0,"varada":0,"lluvia":10,"averia":0,"perd":10,"dudoso":false},"subbase":{"nombre":"Subbase","prod":10178,"horas":245.6,"equipos":2,"meta_hora":43.75,"mh":41.44,"grupos":null,"maq":[{"cod":"MO03","tipo":"MOTONIVELADORA","uf":"UF1·UF2","h":131,"perd":16},{"cod":"MO09","tipo":"MOTONIVELADORA","uf":"UF1","h":114.6,"perd":25.3}],"mtto":0,"varada":0,"lluvia":41.3,"averia":0,"perd":41.3,"dudoso":false},"base":{"nombre":"BTC / Base","prod":4688,"horas":43,"equipos":1,"meta_hora":58.75,"mh":109.03,"grupos":null,"maq":[{"cod":"FNG002","tipo":"FINISHER","uf":"UF1","h":43,"perd":0}],"mtto":0,"varada":0,"lluvia":0,"averia":0,"perd":0,"dudoso":false}}},{"p":"2026-09","d":[{"f":"2026-08-18","exc":1,"apr":1,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS"},{"f":"2026-08-19","exc":1402.31,"apr":336,"pre":0,"nap":1066.31,"ter1":0,"ter2":336,"ter":336,"sub1":0,"sub2":282.48,"sub":282.48,"bas1":0,"bas2":0,"bas":0,"t":"LLUVIAS PARCIALES"},{"f":"2026-08-20","exc":28,"apr":28,"pre":0,"nap":0,"ter1":70,"ter2":0,"ter":70,"sub1":0,"sub2":274.48,"sub":274.48,"bas1":774.36,"bas2":0,"bas":774.36,"t":"SOLEADO"},{"f":"2026-08-21","exc":939.5,"apr":939.5,"pre":0,"nap":0,"ter1":420,"ter2":519.5,"ter":939.5,"sub1":0,"sub2":104,"sub":104,"bas1":517.54,"bas2":0,"bas":517.54,"t":"SOLEADO"},{"f":"2026-08-22","exc":397.36,"apr":397.36,"pre":0,"nap":0,"ter1":0,"ter2":397.36,"ter":397.36,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-08-24","exc":168,"apr":168,"pre":0,"nap":0,"ter1":0,"ter2":168,"ter":168,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":809.75,"bas":809.75,"t":"SOLEADO"},{"f":"2026-08-25","exc":406,"apr":196,"pre":0,"nap":210,"ter1":196,"ter2":0,"ter":196,"sub1":0,"sub2":1068.99,"sub":1068.99,"bas1":0,"bas2":714.58,"bas":714.58,"t":"SOLEADO"},{"f":"2026-08-26","exc":280,"apr":182,"pre":0,"nap":98,"ter1":98,"ter2":84,"ter":182,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":"SOLEADO"},{"f":"2026-08-27","exc":120,"apr":120,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":531.45,"sub":531.45,"bas1":0,"bas2":771.46,"bas":771.46,"t":"SOLEADO"},{"f":"2026-08-28","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""},{"f":"2026-08-29","exc":0,"apr":0,"pre":0,"nap":0,"ter1":0,"ter2":0,"ter":0,"sub1":0,"sub2":0,"sub":0,"bas1":0,"bas2":0,"bas":0,"t":""}],"a":{"excavacion":{"prod":2878.6,"dias":9,"equipos":0,"meta_dia":850,"proy":0,"vel":null,"rend":319.8,"plan_per":35000},"terraplen":{"prod":1760.7,"dias":7,"equipos":0,"meta_dia":680,"proy":0,"vel":null,"rend":251.5,"plan_per":24500},"subbase":{"prod":1739.5,"dias":5,"equipos":0,"meta_dia":430.77,"proy":0,"vel":null,"rend":347.9,"plan_per":6600},"base":{"prod":2759.8,"dias":5,"equipos":0,"meta_dia":430.77,"proy":0,"vel":null,"rend":552,"plan_per":4500},"noaprov":{"prod":1057.2,"plan_per":9500,"dias":3,"soloPlan":true}},"split":{"apr":1821.4,"pre":0,"nap":1057.2},"m":null}],"avance":[{"k":"excavacion","n":"Excavación","eje":513731.2,"plan":620671},{"k":"terraplen","n":"Terraplén","eje":402499.2,"plan":480586},{"k":"subbase","n":"Subbase","eje":49210.8,"plan":86552},{"k":"base","n":"BTC","eje":40486.1,"plan":43759}],"maq_periodos":["2025-06","2025-07","2025-08","2025-09","2025-10","2025-11","2025-12","2026-01","2026-02","2026-03","2026-04","2026-05","2026-06","2026-07","2026-08"],"metas_hora":{"excavacion":106.25,"terraplen":85,"subbase":43.75,"base":58.75},"cc":[{"cc":"02.07","horas":13573.328799999972,"filas":2900,"act":"terraplen","flota":5824.550000000002},{"cc":"02.05","horas":10098.940499722316,"filas":1088,"act":"excavacion","flota":5710.174099722328},{"cc":"03.01","horas":3737.769999999996,"filas":859,"act":"subbase","flota":1556.4999999999995},{"cc":"02.03","horas":1853.84,"filas":201,"act":null,"flota":1020.1199999999999},{"cc":"03.03","horas":1673.7999999999984,"filas":404,"act":"base","flota":615.8999999999999},{"cc":"02.11","horas":1656.300000000002,"filas":2199,"act":null,"flota":9.700000000000045},{"cc":"06.01","horas":1569.7800000000025,"filas":358,"act":null,"flota":250.11000000000018},{"cc":"02.08","horas":1561.7329997223337,"filas":317,"act":null,"flota":1268.0829997223336},{"cc":"06.09","horas":1496.0700000000027,"filas":157,"act":null,"flota":0},{"cc":"05.04","horas":1371.7259999999994,"filas":289,"act":null,"flota":125.5},{"cc":"06.02","horas":909.9799999999981,"filas":239,"act":null,"flota":90.95000000000016},{"cc":"02.01","horas":676.7099999999988,"filas":153,"act":null,"flota":486.5600000000005},{"cc":"02.06","horas":657.1499999999999,"filas":109,"act":"excavacion","flota":549.5000000000002},{"cc":"06.04","horas":614.7749999999864,"filas":207,"act":null,"flota":0},{"cc":"06.05","horas":552.0549999999985,"filas":204,"act":null,"flota":0},{"cc":"02.09","horas":543.7690001003396,"filas":330,"act":null,"flota":70.21400010033341},{"cc":"06.07","horas":493.54999999999814,"filas":36,"act":null,"flota":3.9400000000000546},{"cc":"06.69","horas":370.3449999999999,"filas":25,"act":null,"flota":0},{"cc":"02.12","horas":347.0000000000017,"filas":73,"act":null,"flota":70.20000000000027},{"cc":"02.10","horas":328.20000000000005,"filas":552,"act":null,"flota":7},{"cc":"03.02","horas":280.7000000000006,"filas":305,"act":null,"flota":0},{"cc":"03.04","horas":203.00000000000045,"filas":332,"act":null,"flota":6},{"cc":"11.01","horas":180.5300000000011,"filas":102,"act":null,"flota":0},{"cc":"07.01","horas":162.910000000001,"filas":34,"act":null,"flota":9.700000000000045},{"cc":"02.02","horas":152.69999999999993,"filas":30,"act":null,"flota":40.69999999999993},{"cc":"11.04","horas":133.40000000000165,"filas":456,"act":null,"flota":82.70000000000127},{"cc":"07.03","horas":65.13999999999942,"filas":15,"act":null,"flota":0},{"cc":"11.03","horas":59.200000000000045,"filas":3,"act":null,"flota":6.899999999999864},{"cc":"06.03","horas":51.62000000000171,"filas":16,"act":null,"flota":0},{"cc":"05.05","horas":39.660000000000764,"filas":6,"act":null,"flota":0},{"cc":"07.07","horas":26.90000000000009,"filas":5,"act":null,"flota":0},{"cc":"01.02","horas":26.6350000000009,"filas":11,"act":null,"flota":0},{"cc":"06.70","horas":18.025000000000546,"filas":3,"act":null,"flota":0},{"cc":"07.02","horas":13.11999999999989,"filas":14,"act":null,"flota":0},{"cc":"04.01","horas":12.100000000000364,"filas":3,"act":null,"flota":0},{"cc":"06.48","horas":10,"filas":1,"act":null,"flota":0},{"cc":"02.04","horas":9.809999999999945,"filas":3,"act":null,"flota":3.099999999999909},{"cc":"03.05","horas":9.699999999999818,"filas":1,"act":null,"flota":9.699999999999818},{"cc":"09.02","horas":8.100000000000136,"filas":5,"act":null,"flota":0},{"cc":"06.52","horas":8,"filas":2,"act":null,"flota":0},{"cc":"06.60","horas":7.400000000000091,"filas":1,"act":null,"flota":0},{"cc":"07.05","horas":7,"filas":1,"act":null,"flota":0},{"cc":"01.03","horas":6.100000000000364,"filas":2,"act":null,"flota":0},{"cc":"03.07","horas":4,"filas":2,"act":null,"flota":4},{"cc":"11.02","horas":2.6000000000000014,"filas":3,"act":null,"flota":2.6000000000000014},{"cc":"06.38","horas":1.925000000000182,"filas":1,"act":null,"flota":0},{"cc":"00.02","horas":0.5,"filas":1,"act":null,"flota":0},{"cc":"01.10","horas":0,"filas":2,"act":null,"flota":0},{"cc":"04.02","horas":0,"filas":3,"act":null,"flota":0},{"cc":"11.09","horas":0,"filas":1,"act":null,"flota":0},{"cc":"11.07","horas":0,"filas":1,"act":null,"flota":0},{"cc":"01.05","horas":0,"filas":1,"act":null,"flota":0},{"cc":"04.03","horas":0,"filas":7,"act":null,"flota":0},{"cc":"04.05","horas":0,"filas":4,"act":null,"flota":0},{"cc":"07.10","horas":0,"filas":11,"act":null,"flota":0},{"cc":"09.01","horas":0,"filas":1,"act":null,"flota":0},{"cc":"06.06","horas":0,"filas":1,"act":null,"flota":0},{"cc":"07.08","horas":0,"filas":2,"act":null,"flota":0},{"cc":"05.02","horas":0,"filas":1,"act":null,"flota":0},{"cc":"06.49","horas":0,"filas":1,"act":null,"flota":0}],"corte_horas":"2026-08-15","atraso_horas":2,"descartes":{"fuera_flota":15160,"horas_negativas":1},"fuente":"TM2_SUR_REPORTE_DIARIO_OBRA · hojas DATOS y CALCULOS","fuente_horas":"BASE MAQUINARIA (partes diarios) · horas por centro de coste","unidad":"m³ compactos (suelto ÷ 1,3)","unidad_mh":"m³ sueltos por hora de operación","generado":"2026-09-04 18:37"};

/* ===========================================================================
 * MODELO — verificado contra las hojas del jefe:
 *
 *   compacto    = suelto / 1,3                              (fc de CALCULOS)
 *   rendimiento = ejecutado / días trabajados               -> m³/día
 *   velocidad   = ejecutado / (meta diaria × EQUIPOS × días)
 *   avance      = producción base certificada (proy.base_acum) + Σ compacto desde
 *                 proy.base_corte (exc. común = apr + nap) / contrato   (D163, D185)
 *
 * EQUIPOS son los que REALMENTE trabajaron ese período, contados de los partes
 * diarios (BASE MAQUINARIA). El Excel del jefe los tiene anclados a la flota de
 * HOY, y por eso los meses viejos salían al 300% — comparaba la producción de
 * tres excavadoras contra la meta de una.
 *
 * m³/h = producción SUELTA / horas de operación de las máquinas coherentes con
 * la actividad, por centro de coste. El terraplén reparte 75% al bulldozer y
 * 25% a la motoniveladora, cada grupo contra sus propias horas.
 * =========================================================================*/

let TM2=TM2_EMBEBIDO;
/* c = color que RELLENA la marca · l = color que ESCRIBE encima de esa marca,
   elegido para tener contraste sobre ella · d = prefijo de las columnas de DATOS. */
const ACT=[
  {k:'excavacion',n:'Excavación',c:'var(--s1)',l:'var(--s1-lbl)',d:'exc'},
  {k:'terraplen', n:'Terraplén', c:'var(--s2)',l:'var(--s2-lbl)',d:'ter'},
  {k:'subbase',   n:'Subbase',   c:'var(--s3)',l:'var(--s3-lbl)',d:'sub'},
  {k:'base',      n:'BTC / Base',c:'var(--s4)',l:'var(--s4-lbl)',d:'bas'}
];
const MES=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const CLIMA={'SOLEADO':['Soleado','c-sol'],'LLUVIAS PARCIALES':['Lluvias parciales','c-par'],
             'LLUVIAS':['Lluvias','c-llu'],'':['Sin registro','c-nd']};
const f0=n=>Math.round(n||0).toLocaleString('es-CO');
const f1=n=>(n||0).toLocaleString('es-CO',{minimumFractionDigits:1,maximumFractionDigits:1});
/* TODO lo que se MUESTRA va en m³ compactos (decisión del jefe: una sola unidad, sin
   confusiones). Los datos siguen guardándose en suelto tal cual el Excel; se dividen por
   el factor SÓLO al pintar. Como numerador y denominador de la eficiencia se dividen por
   el mismo factor, el porcentaje no cambia: sólo cambian las cifras absolutas. */
const comp=v=>(v||0)/(TM2.fc||1.3);
const pct=n=>Math.round((n||0)*100)+'%';
/* Las barras de objetivo llegan al 150% y llevan la marca del 100% al 66,7%.
   El 150% sale de los datos: el mes más alto del libro cumplió el 154% del plan,
   así que con este tope casi todo cabe dentro y lo que se pase satura la barra
   con su cifra al lado diciendo la verdad. */
const TOPE_OBJ=1.5;
const anchoObj=v=>Math.min(100, (v||0)/TOPE_OBJ*100)+'%';
function marca100(barra, texto){
  const u=el('u'); u.style.left=(100/TOPE_OBJ)+'%';
  u.title=texto||'objetivo: 100%'; barra.appendChild(u);
}

/* Etiqueta el segmento con SU valor, en vertical dentro de la barra. Si la
   barra no da de alto para el número —a 8 px, cada dígito pide ~5,2 px más
   holgura— la etiqueta sale justo encima, en tinta apagada, en vez de
   desbordarse por dentro y quedar pisada. Los ceros no se escriben: la barra
   ausente ya lo dice y llenarlo de ceros es ruido. */
function etiquetaBarra(bar, valor, altoPx, colorLbl){
  if (!(valor >= 0.5)) return;
  const txt = f0(valor);
  const b = el('b', null, txt);
  const necesita = txt.length * 5.2 + 7;
  if (necesita <= altoPx){ b.className = 'dentro'; b.style.color = colorLbl; }
  else { b.className = 'fuera'; }
  bar.appendChild(b);
}

const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;};

let sel=TM2.per.length-1, uf='Todo', abierto=null;
/* V3-15(b)/V3-15b: filtro de un día/rango dentro del período, sobre la gráfica
   diaria de producción. `selDias` es null (sin filtro) o {a,b} con a<=b (a===b =
   un solo día), en fechas ISO de la propia `p.d`. Se reinicia SOLO al cambiar de
   período (lo hace `pinta()`, comparando contra `perActual`); el filtro de UF no
   lo toca. Afecta: la gráfica diaria, «Horas del personal» (`personal()`) y,
   desde V3-15b, la maquinaria de «Por qué vamos así» (`cadena()`, vía
   `bloqueDias()` del motor) — horas, utilización, eficiencia, velocidad y el
   despliegue por máquina, con el mismo filtro de UF de siempre. NO afecta
   «Planificado vs ejecutado», «Avance acumulado» ni «Evolución»: esos van por el
   PERÍODO completo, sea cual sea la selección de días. */
let selDias=null, perActual=null;
/* V3-16: qué partida tiene abierto su desglose por cargo (una sola a la vez,
   mismo patrón que `abierto` en la cadena). Se reinicia solo al cambiar de
   período; sobrevive a cambios de UF/selección de días. */
let personalAbierto=null;

/* La excavación no viene desglosada por UF en el origen (DATOS trae una sola
   columna). Con filtro de UF se omite en vez de repetir el total en las dos. */
const visibles=()=>uf==='Todo'?ACT:ACT.filter(a=>a.k!=='excavacion');
/* Devuelve la producción del día EN COMPACTO. El Excel la registra en suelto y así
   se guarda; aquí se divide por el factor para que TODA la página hable en una sola
   unidad —la del acta— y no haya que preguntarse nunca si un número es suelto o
   compacto. Antes estas dos gráficas iban en suelto y el resto en compacto, con la
   misma partida apareciendo con dos cifras; el jefe pidió unificar y esto lo hace en
   un solo punto: todo lo que pasa por aquí sale ya convertido. */
function valDia(d,a){
  let v;
  if(a.k==='excavacion') v=d.exc||0;
  else if(uf==='UF1') v=d[a.d+'1']||0;
  else if(uf==='UF2') v=d[a.d+'2']||0;
  else v=d[a.d]||0;
  return comp(v);
}
const valPer=(p,a)=>p.d.reduce((s,d)=>s+valDia(d,a),0);
const eti=k=>{const[y,m]=k.split('-').map(Number);return MES[m-1]+' '+String(y).slice(2);};
function rango(k){
  const[y,m]=k.split('-').map(Number), pm=m===1?12:m-1, py=m===1?y-1:y;
  return '16 '+MES[pm-1]+' '+py+' — 15 '+MES[m-1]+' '+y;
}

/* -------------------------------------------------- V3-15(b): filtro de días */
/* Los días del período que caen dentro de la selección; sin selección, todos. */
function diasFiltrados(p){
  if(!selDias) return p.d;
  return p.d.filter(d=>d.f>=selDias.a && d.f<=selDias.b);
}
/* '2026-09-15' -> '15 sep'; rango en el mismo mes -> '15–16 sep'; en meses
   distintos -> '15 sep – 3 oct'. */
function etiquetaSel(a,b){
  const pa=a.split('-').map(Number), pb=b.split('-').map(Number);
  if(a===b) return pa[2]+' '+MES[pa[1]-1];
  if(pa[1]===pb[1] && pa[0]===pb[0]) return pa[2]+'–'+pb[2]+' '+MES[pa[1]-1];
  return pa[2]+' '+MES[pa[1]-1]+' – '+pb[2]+' '+MES[pb[1]-1];
}
/* V3-15b: la misma selección dicha en prosa para la nota de la cadena «Por qué
   vamos así» — «el 12 sep» / «del 10 al 12 sep» / «del 28 sep al 3 oct». */
function textoRangoSel(a,b){
  const pa=a.split('-').map(Number), pb=b.split('-').map(Number);
  if(a===b) return 'el '+pa[2]+' '+MES[pa[1]-1];
  if(pa[1]===pb[1] && pa[0]===pb[0]) return 'del '+pa[2]+' al '+pb[2]+' '+MES[pa[1]-1];
  return 'del '+pa[2]+' '+MES[pa[1]-1]+' al '+pb[2]+' '+MES[pb[1]-1];
}
/* Clic/Enter en un día de la gráfica diaria:
   · sin selección           -> selecciona ESE día (rango de 1).
   · un solo día seleccionado y se clica OTRO día -> forma el rango entre los dos
     (en cualquier orden: se ordenan al guardar).
   · el mismo día ya seleccionado en solitario -> lo quita (mismo efecto que el
     botón «Quitar filtro», evita dejar el clic sin salida en la propia gráfica).
   · ya hay un rango formado -> el clic EMPIEZA una selección nueva en ese día. */
function seleccionarDia(f){
  if(!selDias){ selDias={a:f,b:f}; }
  else if(selDias.a===selDias.b){
    if(f===selDias.a) selDias=null;
    else selDias = f<selDias.a ? {a:f,b:selDias.a} : {a:selDias.a,b:f};
  } else {
    selDias={a:f,b:f};
  }
  pinta();
}
function quitarFiltroDia(){ selDias=null; pinta(); }

function controles(){
  const c=document.getElementById('uf');c.innerHTML='';
  ['Todo','UF1','UF2'].forEach(n=>{
    const b=el('button',null,n);b.type='button';b.setAttribute('aria-pressed',uf===n);
    b.onclick=()=>{uf=n;pinta();};c.appendChild(b);
  });
  const t=document.getElementById('tema');
  t.textContent=document.documentElement.getAttribute('data-tema')==='claro'?'Tema oscuro':'Tema claro';
  t.onclick=()=>{
    const h=document.documentElement.getAttribute('data-tema');
    const osc=h?h==='oscuro':matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-tema',osc?'claro':'oscuro');
    try{localStorage.setItem('tm2-tema',osc?'claro':'oscuro');}catch(e){}
    controles();
  };
}

/* -------------------------------------------------------------- evolución */
const ALTO_EVO=132, ALTO_DIA=214;
function evolucion(){
  const vis=visibles(), per=TM2.per;
  const vals=per.map(p=>vis.map(a=>valPer(p,a)));
  const max=Math.max(1,...vals.flat());
  document.getElementById('maxEvo').innerHTML=f0(max)+'<span>m³ máx</span>';
  document.getElementById('capEvo').textContent=
    'Evolución período a período'+(uf==='Todo'?'':' · sólo '+uf);
  /* Leyenda de partidas. Sin ella, las cuatro barras de cada mes son cuatro
     colores sin nombre; con el filtro de UF puesto, además, la excavación
     desaparece y hay que ver por qué. */
  const lg=document.getElementById('legEvo'); lg.innerHTML='';
  vis.forEach(a=>{
    const it=el('div','it'); const sw=el('span','sw'); sw.style.background=a.c;
    it.append(sw,el('span',null,a.n)); lg.appendChild(it);
  });
  const g=document.getElementById('evo'), x=document.getElementById('evoX');
  g.innerHTML='';x.innerHTML='';
  per.forEach((p,i)=>{
    const col=el('div','col');
    /* El mes elegido se marca con fondo, no apagando los demás: proyectado, un
       mes apagado se lee como «ese mes vale menos», y no es eso lo que dice. */
    if(i===sel)col.style.background='var(--card)';
    col.title=eti(p.p)+' · '+f0(vals[i].reduce((s,v)=>s+v,0))+' m³';
    vis.forEach((a,j)=>{
      const b=el('i'), fr=vals[i][j]/max;
      b.style.height=(fr*100)+'%'; b.style.background=a.c;
      etiquetaBarra(b, vals[i][j], fr*ALTO_EVO, a.l);
      col.appendChild(b);});
    const ir=()=>{sel=i;abierto=null;pinta();};
    col.onclick=ir;g.appendChild(col);
    const s=el('span',i===sel?'sel':null,eti(p.p));s.onclick=ir;x.appendChild(s);
  });
}

/* VELOCIDAD DE LA MAQUINARIA — a qué ritmo produjo la máquina contra lo que
 * DEBERÍA producir con las horas que tuvo disponibles, a su rendimiento nominal.
 *
 *     producción esperada = rendimiento nominal × 8 h/día × días-máquina
 *     VELOCIDAD           = producción real ÷ producción esperada
 *
 * Va sobre 8 h/día PORQUE ASÍ SE CALCULA EL RENDIMIENTO (proyectado suelto ÷ fc
 * ÷ 8): la vara es «lo que una máquina debería hacer en un día de 8 h», así que
 * la velocidad la mide contra esa misma base. Es, en el fondo, la vieja medida
 * por DÍAS-MÁQUINA a jornada completa: producción ÷ (proyectado × días-máquina).
 * 100% = hizo lo que se esperaba de cada día que estuvo; por debajo, más lenta;
 * por encima, más rápida. Castiga más que las 6,4 h, pero es el estándar real.
 *
 * OJO — NO es la utilización. La UTILIZACIÓN va contra las 6,4/5 h CONTRATADAS
 * (cuánto de su tiempo pagado usó la máquina); la VELOCIDAD va contra las 8 h del
 * rendimiento. Son cosas distintas y por eso la velocidad NO es eficiencia ×
 * utilización: usan bases de horas distintas.
 *
 * NO es el avance del contrato ni el cumplimiento del plan del mes —cada uno
 * tiene su propio apartado más abajo—. Aquí sólo habla la máquina.
 *
 * Necesita los DÍAS POR MÁQUINA (para el × 8). En una foto anterior sin días por
 * máquina no se puede reconstruir: se dice «—» (antes «pulsa Actualizar»; desde
 * D185, «se verá al calcular en vivo»), igual que la utilización, en vez de enseñar
 * un número que no es.
 */

/* ------------------------------------------- cadena «Por qué vamos así» */
function cadena(sel_p){
  const c=document.getElementById('chain');c.innerHTML='';
  const nota=document.getElementById('chainNote');
  /* El período en curso todavía no trae partes de horas —el digitador va un par
     de días por detrás—, así que la cadena RETROCEDE al último período cerrado
     que sí los tiene, y lo dice. Es lo que hacía el lienzo original: más vale la
     cadena del mes cerrado que un hueco en mitad de la presentación. */
  /* ÁMBITO. Con el filtro de UF puesto, horas, utilización, eficiencia y
     velocidad salen del bloque de ESA UF (el motor lo trae en `p.uf`), calculado
     con sus máquinas y su producción; sin filtro, el total de siempre en `p.a`/`p.m`.
     Una foto guardada antes de este cambio no trae `p.uf`: se dice y se pide
     Actualizar, en vez de enseñar el total con la etiqueta de una UF. */
  const amb = q => uf==='Todo' ? { a:q.a, m:q.m } : ((q.uf && q.uf[uf]) || { a:{}, m:null });
  /* V3-15b: con selección de días (V3-15(b)) la cadena usa el bloque de ESOS días,
     recalculado por bloqueDias() del motor —mismas fórmulas que por período, solo
     que sobre los días elegidos (standby = días DISTINTOS de cada máquina DENTRO
     de la selección × sus horas programadas)—. El filtro de UF entra ahí mismo,
     como `suf`, sin pasar por `p.uf`. `bloqueDias` es una función y no sobrevive
     a una foto publicada en JSON: sin ella (foto de respaldo) se pide el cálculo
     en vivo. Con selección NO se retrocede a otro período: si esos días no traen
     partes, se dice tal cual — el retroceso es solo del período completo. */
  let p=sel_p, retro='', B;
  const av=[];
  if(selDias){
    if(typeof TM2.bloqueDias!=='function'){
      nota.textContent='';
      const v=el('div','nota');
      v.innerHTML='El filtro de días de la maquinaria necesita el cálculo en vivo — se verá en cuanto el Tablero recalcule.';
      v.style.padding='18px 0';c.appendChild(v);
      return;
    }
    const suf=uf==='Todo'?'':(uf==='UF1'?'1':'2');
    B=TM2.bloqueDias(sel_p.p, selDias.a, selDias.b, suf);
    const rangoTxt=textoRangoSel(selDias.a,selDias.b);
    const fueraCorte=TM2.corte_horas && selDias.b>TM2.corte_horas;
    if(!B.m){
      nota.textContent='';
      const v=el('div','nota');
      v.innerHTML='Sin partes de maquinaria '+esc(rangoTxt)+(uf==='Todo'?'':' en '+esc(uf))+'.'+
        (fueraCorte ? ' Maquinaria cargada hasta el '+esc(fechaCorta(TM2.corte_horas))+'.' : '');
      v.style.padding='18px 0';c.appendChild(v);
      return;
    }
    av.push('Maquinaria '+rangoTxt);
    if(uf!=='Todo') av.push('Sólo '+uf+' · la excavación no viene partida por UF');
    if(fueraCorte) av.push('maquinaria cargada hasta el '+fechaCorta(TM2.corte_horas));
  } else {
    if(uf!=='Todo' && !sel_p.uf){
      nota.textContent='';
      const v=el('div','nota');
      /* D185: ya no hay «Actualizar»; una foto así solo se ve si el cálculo en vivo falló. */
      v.innerHTML='Esta foto no trae la maquinaria desglosada por UF — se verá en cuanto el Tablero pueda calcular en vivo.';
      v.style.padding='18px 0';c.appendChild(v);
      return;
    }
    B=amb(p);
    if(!B.m){
      const i=TM2.per.findIndex(x=>x.p===sel_p.p);
      for(let j=i;j>=0;j--){ const Bj=amb(TM2.per[j]); if(Bj.m){ p=TM2.per[j]; B=Bj; break; } }
      if(B.m) retro='Período en curso sin partes de horas todavía — cadena y desglose '+
        'del último período cerrado ('+eti(p.p)+')';
    }
    if(!B.m){
      nota.textContent='';
      const v=el('div','nota');
      /* D185: en vivo, sin partes cargados en Galca no hay ningún período con horas. */
      if(!TM2.maq_periodos || !TM2.maq_periodos.length)
        v.innerHTML='Aún no hay partes de maquinaria cargados en Galca'+
          ($('btnPartes')?': pulsa <b>«Cargar partes de maquinaria»</b> y elige el libro de partes':'')+
          '. Sin horas de máquina la cadena no se puede calcular; la producción sí se ve abajo.';
      else
      v.innerHTML='Sin partes de maquinaria para '+esc(eti(sel_p.p))+(uf==='Todo'?'':' en '+esc(uf))+
        '. Los partes diarios cubren de <b>'+
        esc(eti(TM2.maq_periodos[0]))+'</b> a <b>'+esc(eti(TM2.maq_periodos[TM2.maq_periodos.length-1]))+
        '</b>; fuera de ahí sólo hay producción, así que la cadena no se puede calcular.';
      v.style.padding='18px 0';c.appendChild(v);
      return;
    }
    if(retro) av.push(retro);
    if(uf!=='Todo') av.push('Sólo '+uf+' · la excavación no viene partida por UF');
  }
  nota.textContent=av.join(' · ');
  const maxH=Math.max(1,...ACT.map(a=>(B.m[a.k]||{}).horas||0));
  ACT.forEach(a=>{
    const m=B.m[a.k], r=B.a[a.k]||{dias:0};
    if(!m) return;
    const perd=m.perd||0;
    /* UTILIZACIÓN = horas operadas ÷ standby ajustado, donde el standby son las
       horas CONTRATADAS de cada máquina (6,4 propia / 5 alquilada) por sus días
       de parte, menos mantenimiento y paradas de taller (la lluvia no se resta).
       Es el tiempo PAGADO; la velocidad, en cambio, va sobre 8 h. Por encima del
       standby es 100% y lo que sobra se dice como ganancia.
       `m.util` sólo viene en las fotos generadas a partir de este cambio; en una
       anterior no hay días por máquina y el standby NO se puede reconstruir, así
       que se dice que falta en vez de enseñar el número viejo con la etiqueta
       nueva, que sería lo peor de las dos cosas. */
    const hayU = m.util!=null || (m.sb_aj!=null && m.sb_aj>0);
    const ut = hayU ? (m.util!=null ? m.util : Math.min(1, m.horas/m.sb_aj)) : null;
    /* Eficiencia y velocidad en COMPACTO, la unidad del resto del tablero. La
       vara `m.meta_hora` YA viene en compacto —proyectado suelto por equipo de
       CALCULOS ÷ fc ÷ 8 h— así que se compara contra la
       producción por hora también en compacto, comp(m.mh). Antes se comparaba el
       m³/h SUELTO contra esa vara compacta y la eficiencia salía inflada por el
       factor 1,3 (un 115% real era ~89%). */
    const mhC=comp(m.mh);
    /* EFICIENCIA = m³/h real ÷ vara de la partida, todo compacto. La vara
       (m.meta_hora) es el proyectado suelto por equipo ÷ fc ÷ 8 h, POR MÁQUINA,
       la MISMA para toda la partida — el terraplén incluye motos y bulldozer con
       el mismo rendimiento estándar (las varas por tipo quedaron en pausa).
       SIEMPRE se muestra la cifra, salga alta o baja: el equipo interpreta el
       motivo y cómo proceder (decisión del jefe). No se oculta nada. */
    const ef=m.meta_hora?mhC/m.meta_hora:0;
    const abierta=abierto===a.k;
    /* Los equipos se cuentan AQUÍ, sobre el detalle por máquina, y no se toma
       el número que venga en la foto: las fotos guardadas antes de esta
       corrección contaban las máquinas con el parte en cero. Con el mismo
       criterio que el motor, así las dos vías dan lo mismo. */
    const vivas=m.maq.filter(q=>(q.h+q.perd)>0);
    const eqReal=vivas.length || m.equipos;
    /* EQUIPO MEDIO = días-máquina ÷ días de la actividad: a cuántas máquinas
       equivale el tiempo que de verdad estuvieron. Si una máquina entra a mitad
       de mes, «2 máquinas» miente y «1,3 equipo medio» dice la verdad. Se enseña
       el equivalente (equipo medio), NO el número crudo de días-máquina, que en
       la sala confundía. Si la foto es vieja y no trae días por máquina, se cae
       al conteo entero. */
    const dmaq=vivas.reduce((s,q)=>s+(q.dias||0),0);
    const equiv=(dmaq>0&&r.dias>0)?dmaq/r.dias:eqReal;

    const row=el('div','chainR');row.tabIndex=0;row.setAttribute('role','button');
    if(abierta)row.style.background='var(--grid)';
    // --- actividad
    const ac=el('div','actC');
    const sw=el('span','sw');sw.style.background=a.c;
    const box=el('div');box.style.cssText='display:flex;flex-direction:column;gap:2px;';
    const nm=el('div','syne nm',a.n);nm.style.fontWeight='700';
    /* En compacto, como todo lo que se muestra ahora (decisión del jefe: una sola
       unidad). El dato se guarda en suelto y se convierte aquí al pintar. */
    const eqs=k=>k+(k===1?' equipo':' equipos');
    /* «2 máquinas · 1,3 equipo medio»: cuántas pasaron por la actividad y a
       cuántas equivalen por el tiempo que estuvieron. Con la flota estable los
       dos números coinciden y se muestra sólo el conteo. */
    const subEq = (dmaq>0 && Math.abs(equiv-eqReal)>0.05)
      ? eqReal+' máquinas · '+f1(equiv)+' equipo medio'
      : eqs(eqReal);
    box.append(nm,el('div','sub',f0(comp(m.prod))+' m³ · '+subEq),
      el('div','hint',abierta?'Cerrar desglose':(m.maq.length?'Ver '+eqs(m.maq.length):'')));
    ac.append(sw,box);
    // --- eslabones
    /* `lab` = rótulo de la columna. En pantalla ancha lo da la cabecera `.chainH`;
       en móvil ESA cabecera se oculta (no cabe), así que cada eslabón lleva su
       propio rótulo (`.lnkLab`) que el CSS sólo muestra cuando la cabecera no está.
       Sin él, en el teléfono se veían tres «89%» sin decir cuál es cuál. */
    const mk=(sep,val,unit,sub,w,col,lab)=>{
      const d=el('div','lnk');
      if(lab)d.appendChild(el('div','lnkLab',lab));
      if(sep)d.appendChild(el('div','sep',sep));
      const v=el('div','v');
      const b=el('div','syne val',val);if(col)b.style.color=col;
      v.append(b);if(unit)v.appendChild(el('div','u',unit));
      const bar=el('div','mini');const i=el('i');i.style.width=Math.min(100,w*100)+'%';bar.appendChild(i);
      d.append(v,bar,el('div','s',sub));
      return d;
    };
    const l1=mk('',f0(m.horas),'h',r.dias+' días con registro',m.horas/maxH,null,'Horas operadas');
    /* Debajo de la cifra se dice DE DÓNDE sale: cuánto standby había, si sobró
       o faltó, y qué explica el hueco. Un porcentaje de utilización sin su
       standby al lado no se puede discutir en una reunión. */
    let subU;
    if(!hayU){
      subU='sin standby en esta foto — se verá al calcular en vivo';   // D185: ya no hay «Actualizar»
    } else {
      const falta=+(m.sb_aj-m.horas).toFixed(1);
      if(falta<=0){
        subU = f1(m.horas)+' de '+f1(m.sb_aj)+' h de standby · '+f1(m.ganancia||-falta)+' h de más';
      } else {
        /* El hueco NO es la columna «perdidas», y decirlo así confundía: se
           buscaba el total en la tabla y no aparecía. El hueco son horas que la
           máquina estuvo disponible y no trabajó; la lluvia explica una parte y
           el RESTO no tiene motivo anotado en el parte, que es un dato en sí
           mismo — le señala al digitador lo que falta por llenar. */
        const llu=Math.min(m.lluvia||0, falta);
        const mudo=+(falta-llu).toFixed(1);
        const trozos=[];
        if(llu>0)  trozos.push(f1(llu)+' por lluvia');
        if(mudo>0) trozos.push(f1(mudo)+' sin motivo anotado');
        subU = f1(m.horas)+' de '+f1(m.sb_aj)+' h de standby · faltaron '+f1(falta)+' h'+
               (trozos.length?': '+trozos.join(' y '):'');
      }
    }
    const l2=mk('×',hayU?pct(ut):'—','',subU,ut||0,null,'Utilización');
    const l3=mk('×',pct(ef),'',
      f1(mhC)+' de '+f1(m.meta_hora)+' m³ hora-máquina',
      Math.min(1,ef),null,'Eficiencia');
    // --- velocidad
    /* VELOCIDAD DE LA MAQUINARIA (ver el bloque de arriba): producción real
       contra lo que el tiempo disponible daba a ritmo nominal. Rendimiento de la
       máquina, no avance del contrato —eso vive en su propio apartado— ni
       cumplimiento del plan del mes —que vive en «planificado vs ejecutado»—. */
    /* VELOCIDAD anclada al STANDBY, no a las horas operadas: producción real ÷
       (rendimiento nominal × horas disponibles). Sobrevive a las horas que el
       digitador no alcanzó a teclear, porque el tiempo disponible sale de los
       días con parte, no de las horas operadas. Sin standby en la foto → «—». */
    /* VELOCIDAD sobre 8 h/día (la base del rendimiento), NO sobre el standby de
       6,4 de la utilización: producción real ÷ (vara × 8 h × días-máquina). Es
       independiente de la utilización —usan horas distintas— y equivale a la
       vieja medida por días-máquina a jornada completa. */
    const espVel = (m.meta_hora && dmaq>0) ? m.meta_hora*8*dmaq : null;
    const vel = espVel ? comp(m.prod)/espVel : null;
    const vc=el('div','velC');
    vc.appendChild(el('div','velLab','Velocidad'));
    vc.appendChild(el('div','eq','→'));
    const vv=el('div','v');
    const big=el('div','syne big', vel==null?'—':pct(vel));
    vv.append(big,el('div','u','del rendimiento esperado'));
    const vb=el('div','velBar');const vi=el('i');
    vi.style.width=anchoObj(vel);vb.appendChild(vi);
    marca100(vb,'rendimiento esperado: 100%');
    vc.append(vv,vb);
    if(vel!=null){
      /* Solo lo que lleva contra lo que debería llevar. El jefe pidió quitar la
         explicación de debajo: se queda el dato pelado, «5.016 m³ de 6.110 m³». */
      vc.append(el('div','s',f0(comp(m.prod))+' m³ de '+f0(espVel)+' m³'));
    } else {
      vc.append(el('div','s','sin días por máquina en esta foto — se verá al calcular en vivo'));   // D185
    }

    row.append(ac,l1,l2,l3,vc);
    const abrir=()=>{abierto=abierta?null:a.k;pinta();};
    row.onclick=abrir;
    row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();abrir();}};
    c.appendChild(row);

    if(abierta){
      const d=el('div','drop');
      /* La tabla de equipos tiene 8 columnas y no encoge por debajo de ~580 px:
         en el teléfono se salía por la derecha y arrastraba TODA la página con
         ella. Va dentro de `.mtWrap`, que en móvil scrollea SOLO ella en
         horizontal —la página no se mueve— y deja las columnas legibles. */
      const tbl=el('div','mtWrap');
      const h=el('div','mtH');
      ['Equipo','Tipo','UF','Horas','Standby','Sin usar','Utilización','Peso en las horas']
        .forEach((x,i)=>{const s=el('div',null,x);if(i>=3&&i<=6)s.style.textAlign='right';h.appendChild(s);});
      tbl.appendChild(h);
      const tot=Math.max(1,...m.maq.map(x=>x.h));
      m.maq.forEach(q=>{
        /* PARTE VACÍO: cero operadas y cero perdidas. No entra en el standby de
           la actividad —eso ya lo hace el motor—, así que tampoco puede
           enseñarse aquí con su standby y un 0% como si contara: la fila decía
           «6,4 h de standby, 0% de utilización» mientras el total de arriba la
           ignoraba, y las dos cosas no podían ser ciertas a la vez. Se muestra
           igual, porque saber que el digitador la cargó es útil, pero dicha
           como lo que es: descartada. */
        const vacia = (q.h+q.perd)===0;
        /* Standby de ESTA máquina: sus días de parte por sus horas programadas,
           menos su mantenimiento y sus paradas. La celda lleva la cuenta en el
           title para que nadie tenga que fiarse: «17 días × 6,4 h propia». */
        const sbq = (!vacia && q.sb_aj!=null) ? q.sb_aj : null;
        const u = (sbq!=null && sbq>0) ? Math.min(1, q.h/sbq) : null;
        const t=el('div','mtR');
        if(vacia) t.style.opacity='.5';
        const cSb=el('div','num', vacia?'—':(sbq!=null?f1(sbq):'—'));
        if(!vacia && q.dias!=null) cSb.title=q.dias+' días × '+f1(q.hprog)+' h ('+
          (q.hprog>=6?'propia':'alquilada')+')'+(q.ajuste>0?' − '+f1(q.ajuste)+' h de mtto y paradas':'');
        const cUt=el('div','num', vacia?'no cuenta':(u!=null?pct(u):'—'));
        if(vacia){ cUt.style.fontSize='10.5px'; cUt.style.color='var(--accent-txt)';
                   cUt.title='Parte sin horas operadas ni perdidas: no suma standby '+
                     'ni cuenta como equipo. Casi siempre es un parte repetido por error.'; }
        /* «Sin usar» = standby − horas operadas, que es lo que faltó por usar de
           esa máquina. Antes esta celda decía «perdidas» y traía las horas de
           lluvia/mantenimiento del parte: no cuadraba con el hueco de arriba y
           obligaba a buscar un total que no existía en ninguna columna. El
           desglose de por qué faltaron va en el title. */
        const sinUsar = (!vacia && sbq!=null) ? Math.max(0, +(sbq-q.h).toFixed(1)) : null;
        const cSu=el('div','num', sinUsar==null?'—':(sinUsar>0?f1(sinUsar):'—'));
        if(sinUsar>0){
          const llu=Math.min(q.lluvia||0, sinUsar), mudo=+(sinUsar-llu).toFixed(1), tr=[];
          if(llu>0)  tr.push(f1(llu)+' h por lluvia');
          if(mudo>0) tr.push(f1(mudo)+' h sin motivo anotado en el parte');
          cSu.title = tr.length ? tr.join(' · ') : 'sin motivo anotado en el parte';
        }
        t.append(el('div','syne cod',q.cod),el('div','dim',q.tipo),el('div','dim',q.uf),
          el('div','num',vacia?'—':f1(q.h)),cSb,cSu,cUt);
        const bw=el('div','mtBar');const bi=el('i');
        bi.style.width=(q.h/tot*100)+'%';bi.style.background=a.c;bw.appendChild(bi);
        t.appendChild(bw);
        tbl.appendChild(t);
      });
      d.appendChild(tbl);
      const nt=el('div','nota');
      /* Las definiciones de standby y de días-máquina vivían aquí en dos
         parrafadas. Fuera: esto se proyecta ante directivos y ahí no aportan —
         quedan en los comentarios del código y en el registro de decisiones,
         que es donde se consultan. Se conserva sólo lo que cambia mes a mes y
         responde a la pregunta que sí se hace en la sala: por qué esta máquina
         y no aquella. */
      let txt='Peso en las horas de '+a.n.toLowerCase()+' sobre <b>'+f1(m.horas)+' h</b> '+(selDias?textoRangoSel(selDias.a,selDias.b):'del período')+'. '+
        'Sólo cuentan las máquinas coherentes con la actividad, por centro de coste: excavación '+
        'excavadoras (02.05/02.06), terraplén bulldozer y motoniveladora (02.07), subbase '+
        'motoniveladora (03.01), BTC motoniveladora y finisher (03.03). Vibros, minicargadores, '+
        'volquetas y la RT-02 quedan fuera: mueven obra, pero no producen estos m³.';
      if(m.grupos&&m.grupos.length){
        txt+='<br><br>El terraplén reparte la producción por grupo, cada uno contra SUS horas: '+
          m.grupos.map(g=>'<b>'+esc(g.tipo.toLowerCase())+'</b> '+pct(g.cuota)+' → '+f1(comp(g.mh))+' m³/h en '+
          f1(g.horas)+' h').join(' · ')+'.';
      }
      /* Referencia para interpretar la cifra —salga alta o baja—: cuántas horas
         por día trabajado trae el parte frente a las 8 programadas. Si son pocas,
         suele faltar horas por anotar; el equipo lo juzga. Se muestra siempre, no
         para ocultar nada. */
      const dm=(m.maq||[]).filter(q=>(q.h+q.perd)>0).reduce((s,q)=>s+(q.dias||0),0);
      if(dm>0) txt+='<br><br>El parte trae <b>'+f1(m.horas)+' h</b> en <b>'+dm+
        ' días</b> de máquina — '+f1(m.horas/dm)+' h por día, de las 8 programadas.'+
        (m.horas/dm < 5 ? ' Pocas horas por día: puede faltar registro.' : '');
      nt.innerHTML=txt;
      d.appendChild(nt);
      c.appendChild(d);
    }
  });
}

/* -------------------------------------------------- producción diaria */
/* V3-15(b): la gráfica se AMPLÍA a la selección de la escala — con selección,
   `dd` son SOLO esos días (barras más anchas, eje y curvas recalculados sobre
   ellos); sin selección, el período completo, igual que antes. Las barras ya
   NO son clicables (la escala de abajo es el único selector): solo tooltip. */
function diaria(p){
  const vis=visibles(), dd=diasFiltrados(p);
  const vals=dd.map(d=>vis.map(a=>valDia(d,a)));
  const max=Math.max(1,...vals.flat());
  document.getElementById('maxDia').innerHTML=f0(max)+'<span>m³ máx</span>';
  document.getElementById('capDia').textContent=
    'Producción diaria del período'+(uf==='Todo'?'':' · sólo '+uf);
  /* V3-15(a) enmendado: el selector de mes vive arriba (Evolución); aquí solo el
     apunte discreto de qué período se ve, sin enlace (ya no hace falta). */
  const nota=document.getElementById('capDiaNota');
  if(nota) nota.textContent='Periodo '+eti(p.p);
  const bg=document.getElementById('diaBg'), g=document.getElementById('dia'),
        x=document.getElementById('diaX');
  bg.innerHTML='';g.innerHTML='';x.innerHTML='';
  dd.forEach((d,i)=>{
    const b=el('span');
    if(d.t==='LLUVIAS')b.style.background='var(--lluvia)';
    else if(d.t==='LLUVIAS PARCIALES')b.style.background='var(--lluvia-par)';
    bg.appendChild(b);
    const col=el('div','col');
    const tot=vals[i].reduce((s,v)=>s+v,0);
    const climaTxt=(CLIMA[d.t]||CLIMA[''])[0];
    col.title=d.f+' · '+f0(tot)+' m³ · '+climaTxt;
    vis.forEach((a,j)=>{
      const s=el('i'), fr=vals[i][j]/max;
      s.style.height=(fr*100)+'%'; s.style.background=a.c;
      etiquetaBarra(s, vals[i][j], fr*ALTO_DIA, a.l);
      col.appendChild(s);});
    g.appendChild(col);
    x.appendChild(el('span',null,d.f.slice(8)));
  });
  /* Curvas punteadas: media acumulada día a día, en EJE PROPIO Y LOGARÍTMICO.
     Vuelve a petición del usuario, y con un objetivo distinto del que tuvo la
     primera vez: aquí no se trata de comparar una actividad con otra —eso no
     dice nada, cada partida mueve su volumen— sino de VER LA TENDENCIA DE CADA
     UNA. Para eso el eje compartido con las barras no sirve: subbase y BTC
     viven entre el 4% y el 22% de la altura y su curva es una raya casi plana.
     En logarítmico las cuatro reparten el alto y se les ve la pendiente.

     EL PRECIO, y por eso el eje va ROTULADO con marcas a la derecha y declarado
     en la leyenda: la distancia vertical ya no es proporcional a la diferencia.
     Se conservan el ORDEN y las PROPORCIONES —el doble sigue por encima—, pero
     dos curvas separadas un dedo pueden diferir en un factor de tres. Una
     segunda escala sin rotular es una trampa; rotulada es una lupa declarada.

     Y sólo se usa cuando el reparto lo pide: por debajo de un factor de 4 entre
     la media mayor y la menor, el eje se queda LINEAL y no se le pide a la sala
     que entienda una escala que no hace falta.

     EL SUELO SALE DE LAS MEDIAS FINALES, no del mínimo de todos los puntos: el
     primer día de una partida que apenas arranca deja una media de 4 m³ que no
     es el nivel de nada, y apoyar ahí el eje mandaría las cuatro curvas al
     techo con un rótulo falso. Si el mínimo real cabe dentro de un factor de
     60, el suelo baja hasta él y no se aplasta ninguna curva. */
  const SVGNS='http://www.w3.org/2000/svg';
  const svg=document.getElementById('curvas');svg.innerHTML='';
  const ejeD=document.getElementById('ejeMed');if(ejeD)ejeD.innerHTML='';
  const n=dd.length;
  const medias=vis.map((a,j)=>{
    let acc=0;
    return dd.map((d,i)=>{ acc+=vals[i][j]; return acc/(i+1); });
  });
  const pos=medias.flat().filter(v=>v>0);
  const medHi=Math.max(1,...pos);
  const fin=medias.map(m=>m[m.length-1]).filter(v=>v>0);
  const suelo=fin.length?Math.min(...fin):medHi;
  const minTodos=pos.length?Math.min(...pos):medHi;
  const medLo=Math.min(suelo, minTodos>=medHi/60 ? minTodos : suelo);
  const LOG=medHi/medLo>=4;
  const lnR=Math.log(medHi)-Math.log(medLo);
  const yMed=LOG
    ? v=>100-(Math.log(Math.max(v,medLo))-Math.log(medLo))/lnR*100
    : v=>100-Math.min(100,v/medHi*100);
  document.getElementById('capCurva').innerHTML=
    'Curva punteada = media acumulada día a día · '+
    '<b class="u-eje-propio">eje propio, '+
    (LOG?('logarítmico '+f0(medLo)+' → '+f0(medHi)):('máx '+f0(medHi)))+' m³</b>';
  /* Marcas del eje con su línea de guía. Sin ellas la segunda escala no se
     puede leer, y un gráfico que no deja leer su escala miente por omisión. */
  const marcas=LOG
    ? [0,1,2,3].map(i=>Math.exp(Math.log(medLo)+lnR*i/3))
    : [medHi,medHi*2/3,medHi/3].filter(v=>v>0);
  marcas.forEach(v=>{
    const y=yMed(v);
    const ln=document.createElementNS(SVGNS,'line');
    ln.setAttribute('x1','0');ln.setAttribute('x2','100');
    ln.setAttribute('y1',y.toFixed(2));ln.setAttribute('y2',y.toFixed(2));
    ln.setAttribute('stroke','var(--rule)');ln.setAttribute('stroke-width','1');
    ln.setAttribute('stroke-dasharray','2 6');
    ln.setAttribute('vector-effect','non-scaling-stroke');ln.setAttribute('opacity','.75');
    svg.appendChild(ln);
    if(ejeD){ const b=el('b',null,f0(v));b.style.top=y.toFixed(2)+'%';ejeD.appendChild(b); }
  });
  vis.forEach((a,j)=>{
    const pts=medias[j].map((v,i)=>{
      const px=n>1?(i+.5)/n*100:50;
      return px.toFixed(2)+','+yMed(v).toFixed(2);
    }).join(' ');
    const pl=document.createElementNS(SVGNS,'polyline');
    pl.setAttribute('points',pts);pl.setAttribute('fill','none');
    pl.setAttribute('stroke',a.c);pl.setAttribute('stroke-width','1.6');
    pl.setAttribute('stroke-dasharray','3 2.4');pl.setAttribute('vector-effect','non-scaling-stroke');
    pl.setAttribute('stroke-linejoin','round');
    svg.appendChild(pl);
  });
  resumenDia(p);
  // relación lluvia/producción sobre lo mostrado (período completo o selección)
  const lc=document.getElementById('legClima');
  const relLluvia=lc?lc.querySelector('.relLluvia'):null;
  if(relLluvia) relLluvia.remove();
  const tot=dd.map((d,i)=>vals[i].reduce((s,v)=>s+v,0));
  const llu=[],sec=[];
  dd.forEach((d,i)=>{if(d.t==='LLUVIAS')llu.push(tot[i]);else if(d.t==='SOLEADO')sec.push(tot[i]);});
  const med=v=>v.length?v.reduce((s,x)=>s+x,0)/v.length:0;
  if(lc && llu.length>=3&&sec.length>=3){
    const s=el('div','relLluvia');s.style.color='var(--accent-txt)';
    s.textContent=llu.length+' días de lluvia promedian '+f0(med(llu))+' m³ frente a '+
      f0(med(sec))+' en los '+sec.length+' soleados';
    lc.appendChild(s);
  }
}

/* -------------------------------------------------- V3-15(b): escala de tiempo
   Tira de días del PERÍODO COMPLETO (siempre, no se amplía) que hace de selector
   único: clic = un día; arrastre (ratón/táctil, pointer events) = rango; clic en
   otro día con uno ya elegido = rango entre ambos (mismo criterio de
   `seleccionarDia`); teclado: flechas mueven el foco, Shift+flecha extiende el
   rango, Enter/Espacio elige, Esc quita el filtro. Cada celda lleva el número del
   día y su color de clima (mismos colores/leyenda de siempre). */
let arrastre=null;        // {origen:idx} mientras se arrastra con el puntero
let anclaTeclado=null;    // idx fijo del rango mientras se extiende con Shift+flecha
let escalaPeriodoDom=null;   // período para el que YA existen las celdas en el DOM
/* Las celdas se CREAN una sola vez por período (`construirEscala`) y en cada
   repintado solo se les actualizan clases/atributos (`actualizarEscala`): si se
   recrearan con cada `pinta()` —como al Shift+flecha, que la llama para
   extender el rango— el nodo enfocado quedaría desprendido del DOM y el
   teclado perdería el foco a media navegación. */
function construirEscala(cont,p){
  cont.innerHTML='';
  const dias=p.d;
  /* clic/tap simple (sin arrastre real) = mismo comportamiento de siempre. */
  const clicSimple=idx=>{ anclaTeclado=null; seleccionarDia(dias[idx].f); };
  const rangoEntre=(i0,i1)=>{
    const a=Math.min(i0,i1), b=Math.max(i0,i1);
    selDias={a:dias[a].f,b:dias[b].f};
  };
  dias.forEach((d,i)=>{
    const cl=(CLIMA[d.t]||CLIMA[''])[1];
    const cel=el('div','ecell '+cl);
    cel.dataset.idx=i;
    cel.tabIndex=0; cel.setAttribute('role','button');
    cel.appendChild(el('span','num',d.f.slice(8).replace(/^0/,'')));
    cel.onpointerdown=e=>{
      if(e.button!=null && e.button!==0) return;
      arrastre={origen:i, movido:false};
      cont.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    cel.onkeydown=e=>{
      if(e.key==='ArrowRight'||e.key==='ArrowLeft'){
        e.preventDefault();
        const dir=e.key==='ArrowRight'?1:-1;
        const dest=Math.max(0,Math.min(dias.length-1,i+dir));
        if(e.shiftKey){
          if(anclaTeclado==null) anclaTeclado=i;
          rangoEntre(anclaTeclado,dest);
          pinta();
        }
        const viva=cont.children[dest];
        if(viva) viva.focus();
      } else if(e.key==='Enter'||e.key===' '){
        e.preventDefault(); clicSimple(i);
      } else if(e.key==='Escape'){
        e.preventDefault(); anclaTeclado=null; quitarFiltroDia();
      }
    };
    cont.appendChild(cel);
  });
  cont.onpointermove=e=>{
    if(!arrastre) return;
    const t=document.elementFromPoint(e.clientX,e.clientY);
    const c=t&&t.closest('.ecell');
    if(!c || !cont.contains(c)) return;
    const idx=+c.dataset.idx;
    if(idx!==arrastre.origen) arrastre.movido=true;
    if(arrastre.movido){ rangoEntre(arrastre.origen, idx); pinta(); }
  };
  cont.onpointerup=e=>{
    if(!arrastre) return;
    try{ cont.releasePointerCapture(e.pointerId); }catch(err){}
    if(!arrastre.movido) clicSimple(arrastre.origen);
    arrastre=null;
  };
  cont.onpointercancel=()=>{ arrastre=null; };
}
function actualizarEscala(cont,p){
  const dias=p.d;
  Array.from(cont.children).forEach((cel,i)=>{
    const d=dias[i]; if(!d) return;
    const enSel=!selDias || (d.f>=selDias.a && d.f<=selDias.b);
    cel.classList.toggle('sel', !!(selDias && enSel));
    cel.classList.toggle('atenuado', !!(selDias && !enSel));
    cel.setAttribute('aria-pressed', (selDias && enSel) ? 'true' : 'false');
    const climaTxt=(CLIMA[d.t]||CLIMA[''])[0];
    const totDia=ACT.reduce((s,a)=>s+valDia(d,a),0);
    cel.setAttribute('aria-label',d.f.slice(8)+' '+MES[+d.f.slice(5,7)-1]+' · '+
      climaTxt.toLowerCase()+' · '+f0(totDia)+' m³'+(selDias&&enSel?', dentro de la selección':''));
    cel.title=cel.getAttribute('aria-label');
  });
  // leyenda de clima (siempre el período completo, no se amplía)
  const lc=document.getElementById('legClima'); if(!lc) return;
  lc.innerHTML='';
  Object.keys(CLIMA).forEach(k=>{
    const it=el('div','it');const sw=el('span','sw '+CLIMA[k][1]);
    it.append(sw,el('span',null,CLIMA[k][0]));lc.appendChild(it);
  });
}
function escala(p){
  const cont=document.getElementById('escala'); if(!cont) return;
  if(escalaPeriodoDom!==p.p || cont.children.length!==p.d.length){
    construirEscala(cont,p);
    escalaPeriodoDom=p.p;
  }
  actualizarEscala(cont,p);
}

/* Franja de resumen de la gráfica diaria (V3-15b): con selección, el día o rango
   elegido; sin selección, el período completo — nunca se oculta, así siempre hay
   un total a la vista. Los totales por partida respetan `visibles()`/`valDia()`,
   igual que las barras (mismo filtro Todo/UF1/UF2). */
function resumenDia(p){
  const c=document.getElementById('diaResumen'); if(!c) return;
  c.innerHTML='';
  const dd=diasFiltrados(p), vis=visibles();
  const etiqueta = selDias
    ? etiquetaSel(selDias.a,selDias.b)+(selDias.a===selDias.b?'':' · '+dd.length+' días')
    : 'Período completo · '+dd.length+' días';
  c.appendChild(el('div','selTit',etiqueta));
  const tots=el('div','selTots');
  vis.forEach(a=>{
    const v=dd.reduce((s,d)=>s+valDia(d,a),0);
    const it=el('div','it'); const sw=el('span','sw'); sw.style.background=a.c;
    it.append(sw, el('span',null,a.n+' '+f0(v)+' m³')); tots.appendChild(it);
  });
  c.appendChild(tots);
  const cu={}; dd.forEach(d=>{ const k=d.t||''; cu[k]=(cu[k]||0)+1; });
  const climaTxt=Object.keys(CLIMA).filter(k=>cu[k]).map(k=>cu[k]+' '+CLIMA[k][0].toLowerCase()).join(' · ');
  if(climaTxt) c.appendChild(el('div','selClima',climaTxt));
  if(selDias){
    const b=document.createElement('button'); b.type='button'; b.className='tbtn';
    b.textContent='✕ Quitar filtro'; b.onclick=quitarFiltroDia;
    c.appendChild(b);
  }
}

/* ============================================================================
 * V3-16 — HORAS DEL PERSONAL POR ACTIVIDAD
 *
 * `TM2.personal`: [{f,uf,act,n,h,c}] (un renglón por fecha·UF·actividad, D316) o
 * null (+ `TM2.personal_error`) si Galca no lo pudo traer, o simplemente ausente
 * en una respuesta vieja / la foto de respaldo — los tres casos se tratan igual:
 * "sin datos". Ámbito = los días del filtro V3-15(b) si hay selección, si no el
 * período completo; UF = Todo (UF1+UF2) / UF1 / UF2, tal cual el filtro de la
 * cabecera — aquí la excavación SÍ se reparte por UF (a diferencia de la
 * producción), así que las cinco filas se ven en cualquier UF.
 *
 * `c`: [{k,n,h}] desglose por cargo (k ya normalizado por el Worker; "Sin cargo
 * registrado" cuando falta en la ficha de personal). Una foto vieja sin `c` en
 * NINGUNA entrada -> ninguna fila se despliega (sin flecha, D316). */
const ACT_PERS=[
  {k:'excavacion',n:'Excavación',   c:'var(--s1)'},
  {k:'terraplen', n:'Terraplén',    c:'var(--s2)'},
  {k:'subbase',   n:'Subbase',      c:'var(--s3)'},
  {k:'base',      n:'BTC / Base',   c:'var(--s4)'},
  {k:'otras',     n:'Otras actividades', c:'var(--neutro)'}
];
function ambitoTxt(p){
  return (selDias?etiquetaSel(selDias.a,selDias.b):rango(p.p))+(uf==='Todo'?'':' · '+uf);
}
function personal(p){
  const sub=document.getElementById('perSub'), c=document.getElementById('perTabla');
  if(!sub||!c) return;
  const amb=ambitoTxt(p);
  /* `personal` solo trae TIERRAS (deriveArea, D70): drenajes (ODT/ODL) queda
     fuera porque este Tablero es de tierras. */
  sub.textContent='personas y horas-hombre de tierras cargadas en la asistencia · '+amb;
  c.innerHTML='';
  if(!Array.isArray(TM2.personal)){
    c.appendChild(el('div','nota', TM2.personal_error
      ? 'Sin datos de asistencia (' + TM2.personal_error + ').'
      : 'Sin datos de asistencia en esta fuente.'));
    return;
  }
  const fechas=diasFiltrados(p).map(d=>d.f), enAmbito=new Set(fechas);
  const ufOk=x=>uf==='Todo'||x.uf===uf;
  /* Foto vieja sin `c` en absoluto -> ninguna fila se despliega (D316). */
  const hayCargo=TM2.personal.some(x=>x && Array.isArray(x.c));
  const filas=[]; let maxH=0;
  const totPorDia={};
  ACT_PERS.forEach(a=>{
    const porDia={}, cargos={};
    TM2.personal.forEach(x=>{
      if(!x || x.act!==a.k || !ufOk(x) || !enAmbito.has(x.f)) return;
      const r=(porDia[x.f]=porDia[x.f]||{n:0,h:0});
      r.n+=num(x.n); r.h+=num(x.h);
      const rt=(totPorDia[x.f]=totPorDia[x.f]||{n:0,h:0});
      rt.n+=num(x.n); rt.h+=num(x.h);
      if(Array.isArray(x.c)) x.c.forEach(cg=>{
        const k=cg.k||'Sin cargo registrado';
        const rc=(cargos[k]=cargos[k]||{n:0,h:0});
        rc.n+=num(cg.n); rc.h+=num(cg.h);
      });
    });
    const claves=Object.keys(porDia), nd=claves.length;
    const sn=claves.reduce((s,f)=>s+porDia[f].n,0);
    const sh=claves.reduce((s,f)=>s+porDia[f].h,0);
    if(sh>maxH) maxH=sh;
    /* Personas/día del cargo = Σn del cargo ÷ nº de días con reporte de ESTA
       partida (el mismo `nd` de arriba, no un conteo de días por cargo). */
    const cargoFilas=Object.keys(cargos).map(k=>
      ({k, n:cargos[k].n, h:cargos[k].h, prom:nd?cargos[k].n/nd:0}));
    /* «Sin cargo registrado» siempre al final; el resto por horas desc. */
    const sinCargo=x=>x.k==='Sin cargo registrado'?1:0;
    cargoFilas.sort((x,y)=>sinCargo(x)-sinCargo(y) || (y.h-x.h));
    filas.push({a, prom:nd?sn/nd:0, sh, sn, nd, cargos:cargoFilas});
  });
  const clavesT=Object.keys(totPorDia);
  const snT=clavesT.reduce((s,f)=>s+totPorDia[f].n,0);
  const shT=clavesT.reduce((s,f)=>s+totPorDia[f].h,0);
  /* Nota de corte: si la asistencia cargada no llega hasta el último día del
     ámbito, se avisa (igual criterio que el resto de renglones de estado). */
  const ultimoDia=fechas.length?fechas[fechas.length-1]:'';
  if(TM2.personal_hasta && ultimoDia && TM2.personal_hasta<ultimoDia){
    sub.textContent+=' · asistencia hasta el '+fechaCorta(TM2.personal_hasta);
  }
  if(!(shT>0 || snT>0)){
    c.appendChild(el('div','nota','Sin asistencia registrada para '+amb+'.'));
    return;
  }
  const head=el('div','phH');
  head.append(el('div',null,'Actividad'),el('div',null,'Personas/día'),
              el('div',null,'Horas-hombre'),el('div'));
  c.appendChild(head);
  filas.forEach(({a,prom,sh,sn,nd,cargos})=>{
    /* V3-16: fila desplegable como en la cadena «Por qué vamos así» (misma
       idea de `abierto`/`.chainR`): solo se abre si hay desglose por cargo. */
    const puedeAbrir=hayCargo && cargos.length>0;
    const abierta=puedeAbrir && personalAbierto===a.k;
    const r=el('div','ph'+(puedeAbrir?' abrible':''));
    r.title=sn?'persona-días: '+f0(sn):'sin asistencia en '+amb;
    const nm=el('div','nm');
    if(puedeAbrir) nm.appendChild(el('span','flecha',abierta?'▾':'▸'));
    nm.appendChild(document.createTextNode(a.n));
    nm.title=a.n;
    r.append(nm);
    r.append(el('div','num',nd?f1(prom):'—'));
    r.append(el('div','num',f1(sh)));
    const bar=el('div','phBar'); const i=el('i');
    i.style.width=(maxH>0?sh/maxH*100:0)+'%'; i.style.background=a.c;
    bar.appendChild(i); r.appendChild(bar);
    if(puedeAbrir){
      r.tabIndex=0; r.setAttribute('role','button');
      r.setAttribute('aria-expanded', abierta?'true':'false');
      if(abierta) r.style.background='var(--grid)';
      const abrir=()=>{ personalAbierto=abierta?null:a.k; pinta(); };
      r.onclick=abrir;
      r.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); abrir(); } };
    }
    c.appendChild(r);
    if(abierta){
      const drop=el('div','phDrop');
      const maxCH=Math.max(1,...cargos.map(cg=>cg.h));
      cargos.forEach(cg=>{
        const sin=cg.k==='Sin cargo registrado';
        const cr=el('div','phC'+(sin?' phCsin':''));
        if(sin) cr.title='falta el cargo en la ficha de personal';
        cr.append(el('div','nm',cg.k));
        cr.append(el('div','num',nd?f1(cg.prom):'—'));
        cr.append(el('div','num',f1(cg.h)));
        const cbar=el('div','phBar phBarL'); const ci=el('i');
        ci.style.width=(maxCH>0?cg.h/maxCH*100:0)+'%'; ci.style.background=a.c;
        cbar.appendChild(ci); cr.appendChild(cbar);
        drop.appendChild(cr);
      });
      c.appendChild(drop);
    }
    /* Punto de extensión (backlog, aún sin definir): una futura columna «Meta
       del mes» por cargo iría aquí, junto a Personas/día y Horas-hombre. */
  });
  const rt=el('div','ph phTot');
  rt.title=snT?'persona-días: '+f0(snT):'';
  rt.append(el('div','nm','Total'));
  rt.append(el('div','num',clavesT.length?f1(snT/clavesT.length):'—'));
  rt.append(el('div','num',f1(shT)));
  rt.append(el('div'));
  c.appendChild(rt);
}

/* --------------------------------- planificado vs ejecutado del período */
/* El avance contra el contrato dice cómo va la obra entera; esto dice cómo va
   EL MES, que es de lo que trata la reunión. Van uno encima del otro y con la
   misma barra a propósito: se leen de corrido, período y contrato.
   El no aprovechable entra aquí aunque no sea partida del contrato, porque se
   planifica y se sigue igual — sale de la excavación. */
const PP=[['excavacion','Excavación'],['terraplen','Terraplén'],['subbase','Subbase'],
          ['base','BTC / Base'],['noaprov','Excav. no aprov.']];
function planPeriodo(p){
  const c=document.getElementById('planPer'); c.innerHTML='';
  let hay=false;
  PP.forEach(([k,nom])=>{
    const r=p.a[k]; if(!r) return;
    const plan=r.plan_per||0; if(plan>0) hay=true;
    const act=ACT.find(z=>z.k===k);
    const col=act?act.c:'var(--neutro)';
    const rel=plan>0?r.prod/plan:0;
    const w=el('div','pp');
    w.append(el('div','nm',nom));
    const bar=el('div','ppBar');
    const i=el('i');i.style.width=plan>0?anchoObj(rel):'0';i.style.background=col;
    i.style.opacity=k==='noaprov'?'.55':'1';
    const b=el('b',null,plan>0?f0(r.prod)+' · '+pct(rel):f0(r.prod)+' m³');
    bar.append(i,b);
    if(plan>0) marca100(bar,'plan del período: 100%');
    w.append(bar,el('div','plan',plan>0?f0(plan):'—'));
    c.appendChild(w);
  });
  /* Sin nota explicativa cuando hay plan (el jefe la pidió fuera). Solo se avisa
     cuando el período NO trae planificado, porque ahí las barras aparecen vacías
     y sin ese aviso no se entendería por qué. */
  if(!hay){
    const nt=el('div','nota');
    /* D183: el plan sale de la Proyección de Galca o, de respaldo, de CALCULOS. */
    const org=TM2.fuente_proy&&TM2.fuente_proy.origen;
    /* D185: 'codigo' = en vivo sin la Proyección de Galca (constantes de respaldo, sin plan). */
    nt.innerHTML=org==='codigo' ? 'Galca no entregó la Proyección, así que no hay planificado: sólo se ve lo ejecutado.'
      : 'Este período no trae planificado en '+(org==='galca'?'la <b>Proyección de Galca</b>':'la hoja <b>CALCULOS</b>')+
        ', así que sólo se ve lo ejecutado.';
    c.appendChild(nt);
  }
}

/* ------------------------------------------------------------- avance */
function avance(){
  const c=document.getElementById('avance');c.innerHTML='';
  TM2.avance.forEach(a=>{
    const act=ACT.find(z=>z.k===a.k)||ACT[0];   // color de una sola fuente
    const r=a.plan?a.eje/a.plan:0;
    const w=el('div','av');
    const row=el('div','r');
    const rt=el('div');rt.style.cssText='display:flex;align-items:baseline;gap:7px;';
    const p=el('div','syne pc',pct(r));p.style.fontWeight='700';
    rt.append(p,el('div','of',f0(a.eje)+' / '+f0(a.plan)+' m³'));
    row.append(el('div','nm',a.n||act.n),rt);
    const bar=el('div','avBar');const i=el('i');
    i.style.width=Math.min(100,r*100)+'%';i.style.background=act.c;bar.appendChild(i);
    w.append(row,bar);c.appendChild(w);
  });
}

/* --------------------------------------------------- aprovechamiento */
function aprov(p){
  const c=document.getElementById('aprov');c.innerHTML='';
  const s=p.split||{apr:0,pre:0,nap:0};
  const tot=(s.apr||0)+(s.pre||0)+(s.nap||0);
  const ap=(s.apr||0)+(s.pre||0);
  const sh=v=>tot>0?v/tot*100:0;
  const big=el('div');big.style.cssText='display:flex;align-items:baseline;gap:10px;margin-bottom:13px;';
  const n=el('div','syne',tot>0?pct(ap/tot):'—');
  n.style.cssText='font-size:38px;line-height:1;color:var(--accent-txt);';
  big.append(n,el('div','of','de lo excavado es aprovechable: común más préstamo'));
  const bar=el('div','aprB');
  const i1=el('i');i1.style.cssText='width:'+sh(s.apr)+'%;background:var(--accent);';
  const i2=el('i');i2.style.cssText='width:'+sh(s.pre)+
    '%;background:repeating-linear-gradient(135deg,var(--accent) 0 5px,var(--bg) 5px 9px);';
  const i3=el('i');i3.style.cssText='width:'+sh(s.nap)+'%;background:var(--neutro);';
  const dv=el('div','div');dv.style.left=sh(ap)+'%';
  bar.append(i1,i2,i3,dv);
  const ends=el('div','aprE');
  ends.append(el('div',null,'← Aprovechable'),el('div',null,'No aprovechable →'));
  c.append(big,bar,ends);
  [['Excavación común','apr','var(--accent)'],
   ['Préstamo (comprado)','pre','repeating-linear-gradient(135deg,var(--accent) 0 4px,var(--bg) 4px 7px)'],
   ['No aprovechable','nap','var(--neutro)']].forEach(([nm,k,col])=>{
    const r=el('div','cmp');
    const l=el('div','l');const sw=el('span','sw');sw.style.background=col;
    l.append(sw,el('span',null,nm));
    const rr=el('div','r');
    /* `s[k]` YA viene en compacto: el motor divide `apr/pre/nap` por FC al armar
       el split. Aplicarle `comp()` aquí volvía a dividir por 1,3 —doble conversión—
       y el común salía 15.868 en vez de los 20.628 reales (26.816 suelto ÷ 1,3). */
    rr.append(el('div','syne v',f0(s[k])+' m³'),el('div','p',tot>0?pct(s[k]/tot):'—'));
    r.append(l,rr);c.appendChild(r);
  });
  const nt=el('div','nota');nt.style.marginTop='10px';
  nt.textContent='El préstamo se compra e ingresa a la obra, pero cuenta del lado aprovechable.';
  c.appendChild(nt);
}


/* ===========================================================================
 * ORIGEN DE LOS DATOS — EN VIVO (D185 · V3-11 Fases B+C)
 *
 * «La DATA en línea que actualice plenamente el Tablero» (dueño, 18-sep-2026).
 * Cada vez que CUALQUIERA abre esta página —también el enlace público de los
 * directivos, sin sesión— se pide ?action=tablero_vivo y el Tablero se calcula
 * AQUÍ, en el navegador, con el mismo motor de siempre (construir en vivo tarda
 * milisegundos; lo caro era parsear Excel, y eso ya no se hace al abrir):
 *   · la PRODUCCIÓN: los días de la DATA de Galca plegados por el mapeo (todas las
 *     fechas, también las viejas; la hoja DATOS del Excel ya no se usa);
 *   · la MAQUINARIA: las horas del libro de partes, guardadas en Galca la última
 *     vez que admin o jefe lo cargaron;
 *   · la PROYECCIÓN (plan, rendimientos, fc, contrato) de Galca.
 * No hay «Actualizar» ni hay que publicar: mientras la página está abierta se
 * recalcula cada 5 minutos (y al volver a la pestaña, si pasó más de un minuto).
 * El Worker lo sirve con una caché de 60 s; admin y jefe, con su token, la saltan
 * y ven al instante la corrección que acaban de hacer en la Revisión de DATA.
 *
 * NUNCA PANTALLA EN BLANCO delante de una sala: se pinta YA con lo último que vio
 * este equipo (o la copia incluida en el archivo) y, si el cálculo en vivo falla,
 * se cae a la foto publicada —o se queda lo pintado si es más nuevo—, con aviso
 * ámbar que dice qué se está viendo y por qué.
 *
 * LA FOTO PUBLICADA (D158) QUEDA DE RESPALDO: admin y jefe, tras calcular en vivo,
 * la publican solos cuando lo calculado cambió respecto de la publicada (nunca una
 * sin maquinaria: pisaría la buena). Es la que ve quien abre sin conexión a la API.
 * =========================================================================*/
const LS_DAT='tm2-datos';
const $=id=>document.getElementById(id);
const REFRESCO_MS=5*60*1000;     // recálculo automático mientras la página está abierta
const ESPERA_VIVO=25000;         // ms; pasado esto se cae a la foto publicada
const VOLVER_MS=60*1000;         // al volver a la pestaña, recalcular si el último cálculo es más viejo

/* Qué hay en pantalla y por qué. `tipo`: 'vivo' (calculado ahora con Galca),
   'foto' (la publicada), 'local' (la última vista en este equipo) o 'embebida' (la
   copia del archivo). `motivo`: por qué no es 'vivo' (va en ámbar). `aviso`: una
   nota pasajera tras una acción (cargar partes, un refresco fallido), `respaldo`:
   lo que pasó al publicar la foto de respaldo (solo admin/jefe). */
let ORIGEN={ tipo:'embebida', calculando:true, motivo:'', aviso:'', respaldo:'' };
let ultimoVivo=0;                // Date.now() del último cálculo en vivo que salió bien

function estado(txt,warn,titulo){
  const e=$('estado');
  e.innerHTML=txt;
  e.className='est'+(warn?' warn':'');
  e.title=titulo||'';
}
/* El detalle de centros de coste no se pinta —esta página se proyecta ante
   directivos, no es una pantalla de diagnóstico—, pero se deja en la consola:
   si algún día las horas bailan, ahí está sin ensuciar la presentación. */
function logCC(){
  if(!TM2.cc||!TM2.cc.length||!window.console||!console.table) return;
  try{ console.groupCollapsed('TM2 · centros de coste de las horas');
       console.table(TM2.cc.map(x=>({centro:x.cc,actividad:x.act||'(no mapeado)',
         horas_flota:x.flota,horas_totales:x.horas,partes:x.filas})));
       console.groupEnd(); }catch(e){}
}
/* Último día con producción, derivado de los propios períodos. Sirve de respaldo
   para fotos guardadas antes de que el motor trajera `corte_prod`. */
function ultimaProd(){
  try{
    let mx='';
    for(const p of TM2.per) for(const d of p.d) if(d.f>mx) mx=d.f;
    return mx;
  }catch(e){ return ''; }
}
/* '2026-09-18 14:05' → '18-sep 14:05'; '2026-09-17' → '17-sep' */
function fechaCorta(s){
  const m=/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(String(s||''));
  return m ? (+m[3])+'-'+MES[+m[2]-1]+(m[4]?' '+m[4]:'') : String(s||'');
}
/* Renglón EN VIVO (lo pidió el dueño así): «En vivo · DATA al dd-mmm · maquinaria
   al dd-mmm». DATA al = último día con DATA en Galca; maquinaria al = último
   parte del libro guardado. SIN el nombre del archivo (pedido del dueño): el
   renglón normal y los avisos de éxito quedan limpios; solo los ERRORES de
   carga siguen nombrando el archivo que falló (ver `cargarPartes`). */
function txtVivo(d){
  const v=d.vivo||{};
  let s='<b>En vivo</b> · DATA al <b>'+esc(fechaCorta(v.datos_hasta||d.corte_prod||ultimaProd()))+'</b>';
  if(d.corte_horas) s+=' · maquinaria al <b>'+esc(fechaCorta(d.corte_horas))+'</b>';
  else s+=' · sin partes de maquinaria cargados';
  return s;
}
/* Hasta dónde llega una foto que NO es el cálculo en vivo de ahora. */
function txtCorte(d){
  const v=d.vivo||null;
  const prod=(v&&v.datos_hasta)||d.corte_prod||ultimaProd();
  const maq=d.corte_horas||'';
  const que=v?'DATA':'producción';
  let s;
  if(prod&&maq) s=que+' al <b>'+esc(fechaCorta(prod))+'</b> y maquinaria al <b>'+esc(fechaCorta(maq))+'</b>';
  else if(prod) s=que+' al <b>'+esc(fechaCorta(prod))+'</b>';
  else          s='datos de '+(d.generado?'<b>'+esc(d.generado)+'</b>':'la copia incluida');
  return s+(v&&d.generado?' (calculada en vivo el '+esc(fechaCorta(d.generado))+' UTC)':'');
}
/* De dónde salió la proyección (va en el title del renglón, no en el renglón). */
function txtProy(d){
  const f=d && d.fuente_proy; if(!f) return '';
  if(f.origen==='galca') return 'Proyección de Galca ('+(f.actualizado?'act. '+fechaCorta(f.actualizado):'valores iniciales, sin ediciones')+')';
  if(f.origen==='codigo') return 'Proyección de respaldo (constantes del Tablero)';
  return 'Proyección del Excel';
}
function pintaEstado(){
  const o=ORIGEN;
  const extra=(o.aviso?' · '+o.aviso:'')+(o.respaldo?' · '+o.respaldo:'');
  if(o.tipo==='vivo' && TM2.vivo){
    const t=['Calculada en este navegador con la DATA de Galca'+
             (TM2.vivo.generado?' (servida '+TM2.vivo.generado+')':''),
             txtProy(TM2), 'se recalcula sola cada 5 minutos'].filter(Boolean).join(' · ');
    estado(txtVivo(TM2)+extra, false, t);
    return;
  }
  const que = o.tipo==='foto'  ? 'la <b>foto publicada</b>'
            : o.tipo==='local' ? 'la última copia vista en este equipo'
            :                    'la copia incluida en la página';
  if(o.calculando){
    estado('Calculando en vivo con la DATA de Galca… (mientras, '+que+': '+txtCorte(TM2)+')'+extra, false);
    return;
  }
  estado('No se pudo calcular en vivo'+(o.motivo?' ('+esc(o.motivo)+')':'')+
         ': se muestra '+que+' · '+txtCorte(TM2)+extra, true);
}
function guardaDatos(d){
  try{ localStorage.setItem(LS_DAT,JSON.stringify(d)); }
  catch(e){ /* si no cabe, se sigue usando en memoria */ }
}

const API = GALCA_ENV.url.obra;   // entorno.js (D168): producción o prueba

/* El token de sesión (D109) va a mano en las llamadas que lo usan. `auth.js` se
   carga desde D169 solo porque es el único sitio con la URL base de la API (Worker
   api.galca.app), de la que entorno.js arma `GALCA_ENV.url`. LEER es público (D161,
   ampliado en D185 al cálculo en vivo): el directivo sin sesión no manda nada. Si
   hay token se manda —admin/jefe saltan así la caché de 60 s—; ESCRIBIR (guardar
   partes, publicar la foto) lo decide el servidor con ese token firmado. */
function token(){ try{ return localStorage.getItem('tm2_token')||''; }catch(e){ return ''; } }

/* ---------------------------------------------------------------------------
 * CÁLCULO EN VIVO
 * ------------------------------------------------------------------------ */
/* Pide ?action=tablero_vivo. Lanza un Error con el motivo, en claro. Si un token
   viejo hiciera que el servidor rechazara la lectura, se reintenta sin token: la
   lectura es pública y un token vencido no puede dejar al jefe sin Tablero. */
async function pedirVivo(conToken){
  const t=conToken===false?'':token();
  const ac=(typeof AbortController==='function')?new AbortController():null;
  const reloj=ac?setTimeout(()=>ac.abort(),ESPERA_VIVO):null;
  let r, j=null;
  try{
    r=await fetch(API+'?action=tablero_vivo'+(t?'&token='+encodeURIComponent(t):''),
                  { cache:'no-store', signal:ac?ac.signal:undefined });
    try{ j=await r.json(); }catch(e){ j=null; }
  }catch(e){
    throw new Error((e && e.name==='AbortError') ? 'Galca no respondió en '+(ESPERA_VIVO/1000)+' s'
                                                 : 'sin conexión con Galca');
  }finally{ if(reloj) clearTimeout(reloj); }
  if(j && j.ok===false && j.auth===false){
    if(t) return pedirVivo(false);
    throw new Error('el servidor aún no tiene el Tablero en vivo (falta desplegar el Worker de D185)');
  }
  if(!r.ok) throw new Error('Galca respondió '+r.status+(j&&j.error?' — '+j.error:''));
  if(!j || j.ok!==true) throw new Error((j&&j.error)||'Galca no devolvió la DATA');
  /* Un Worker anterior a D185 contesta {ok:true, msg:'API viva'} a una acción que no conoce. */
  if(!Array.isArray(j.dias)) throw new Error('el servidor aún no tiene el Tablero en vivo (falta desplegar el Worker de D185)');
  return j;
}
/* Huella del contenido calculado (sin sellos de hora): decide si la foto publicada
   ya es esta misma y no hace falta volver a publicarla. FNV-1a de 32 bits. */
function firma(d){
  const s=JSON.stringify([d.fc,d.per,d.avance,d.cc,d.corte_horas,d.metas_hora]);
  let h=0x811c9dc5;
  for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193)>>>0; }
  return ('0000000'+h.toString(16)).slice(-8)+'-'+s.length.toString(36);
}
/* Respuesta de tablero_vivo → datos del Tablero, con el MISMO motor. La proyección
   pasa por proyDeGalca (la validación de D183); los días por diasDeGalca (ya vienen
   en suelto-equivalente) y las horas guardadas por horasGuardadas. Si las horas no se
   pueden leer, la producción sale igual, sin maquinaria, y se dice. */
/* Proyección de RESPALDO: si Galca entrega la DATA pero no la Proyección (proy null +
   proy_error), el Tablero sale igual con las constantes de arriba —el contrato del jefe
   y el fc de siempre—, sin plan mensual, y lo dice en ámbar. Mejor la producción viva
   sin plan que una foto vieja. */
function proyRespaldo(){
  const proyectado={}; Object.keys(META_D).forEach(k=>{ proyectado[k]=META_D[k]*FC_DEFECTO; });
  return { fc:FC_DEFECTO, plan:{}, proyectado, contrato:Object.assign({},CONTRATO), base_acum:Object.assign({},BASE_ACUM),
           base_corte:BASE_CORTE, acta_base:'', actualizado:'', usuario:'' };
}
function calcularVivo(j){
  let proy, aviso='', origenProy='galca';
  try{ proy=MOTOR.proyDeGalca(Object.assign({ ok:true, fuente:'galca' }, j.proy||{})); }
  catch(e){
    proy=proyRespaldo(); origenProy='codigo';
    aviso='<span class="warn">sin la Proyección de Galca ('+esc(j.proy_error||(e&&e.message)||'no llegó')+'): contrato de respaldo y sin plan del mes</span>';
  }
  const H=(j.horas && typeof j.horas==='object') ? j.horas : null;
  if(!H && j.horas_error) aviso+=(aviso?' · ':'')+'<span class="warn">'+esc(j.horas_error)+'</span>';
  let d;
  // `fc` = con el que el Worker escaló los días a suelto-equivalente (ver diasDeGalca).
  const prod={ vivo:true, dias:j.dias, fc:(j.fc_dias!=null ? j.fc_dias : j.fc) };
  try{ d=MOTOR.construir(prod, { H }, proy); }
  catch(e){
    if(!H) throw e;
    d=MOTOR.construir(prod, { H:null }, proy);
    aviso+=(aviso?' · ':'')+'<span class="warn">sin maquinaria: '+esc((e&&e.message)||'las horas guardadas no se pudieron leer')+'</span>';
  }
  const hm=j.horas_meta||{};
  d.fuente_proy={ origen:origenProy, actualizado:String(proy.actualizado||'') };
  d.vivo={ datos_hasta:String(j.datos_hasta||d.corte_prod||''), generado:String(j.generado||''),
           horas_archivo:H?String(hm.archivo||''):'', horas_cargado:H?String(hm.cargado_ts||''):'' };
  d.vivo.firma=firma(d);
  /* V3-16: personas/horas-hombre de la asistencia, sin nombres. `personal` viaja
     TAL CUAL a la sección «Horas del personal» (personal() la lee de TM2.personal);
     null/ausente cuando Galca no lo trajo (respuesta vieja o error), y ahí queda
     dicho en `personal_error`. Se incluye en la foto de respaldo porque `respaldo()`
     publica el objeto `d` completo — no hace falta nada más para que viaje. */
  d.personal = Array.isArray(j.personal) ? j.personal : null;
  d.personal_error = String(j.personal_error||'');
  d.personal_hasta = String(j.personal_hasta||'');
  return { d, aviso };
}

let enCurso=null;
/* Calcula en vivo y pinta. opts.primero = al abrir (se va al último período);
   opts.auto = refresco (si falla y ya había un cálculo en vivo, se queda y avisa).
   Devuelve true si pintó un cálculo en vivo. Nunca lanza. */
function enVivo(opts){
  if(enCurso) return enCurso;
  enCurso=(async ()=>{
    opts=opts||{};
    try{
      const j=await pedirVivo();
      const { d, aviso }=calcularVivo(j);
      const prev=(TM2.per[sel]||{}).p, eraUltimo=sel>=TM2.per.length-1;
      TM2=d; guardaDatos(d);
      /* En un refresco se conserva el mes que se estaba mirando (y el desglose
         abierto); si se miraba el último, se sigue en el último aunque haya uno nuevo. */
      const i=(!opts.primero && !eraUltimo && prev) ? TM2.per.findIndex(p=>p.p===prev) : -1;
      if(i>=0) sel=i; else { sel=TM2.per.length-1; if(opts.primero || !eraUltimo) abierto=null; }
      ORIGEN={ tipo:'vivo', calculando:false, motivo:'', aviso, respaldo:'' };
      ultimoVivo=Date.now();
      pinta();
      if(opts.primero) logCC();
      respaldo(d);                     // admin/jefe: en segundo plano
      return true;
    }catch(err){
      const motivo=String((err&&err.message)||'error desconocido').replace(/[\s.]+$/,'');
      if(ORIGEN.tipo==='vivo'){
        /* Un refresco que falla no tira el cálculo en vivo que ya está en pantalla. */
        ORIGEN.aviso='<span class="warn">el último refresco falló ('+esc(motivo)+'); se ve el cálculo de las '+
                     esc(new Date(ultimoVivo).toTimeString().slice(0,5))+'</span>';
        pintaEstado();
        return false;
      }
      await caerAFoto(motivo);
      return false;
    }finally{ enCurso=null; }
  })();
  return enCurso;
}

/* Trae la foto publicada. Va con el token SOLO si lo hay: la lectura es pública
   (D161). Nunca lanza: si algo falla, devuelve null. */
async function fotoCompartida(){
  try{
    const t = token();
    const r = await fetch(API+'?action=tablero'+(t?'&token='+encodeURIComponent(t):''), { cache:'no-store' });
    if(!r.ok) return null;
    const d = await r.json();
    if(!d || d.ok===false || !d.foto || !d.foto.per || !d.foto.per.length) return null;
    return d.foto;
  }catch(e){ return null; }
}
/* Respaldo cuando el cálculo en vivo falla: la foto publicada si es más nueva que lo
   que ya está pintado (la última vista en este equipo o la copia incluida); si no,
   se queda lo pintado. En los dos casos el renglón lo dice en ámbar. */
async function caerAFoto(motivo){
  const f=await fotoCompartida();
  if(f && (ORIGEN.tipo==='embebida' || !TM2.generado || !f.generado || f.generado > TM2.generado)){
    TM2=f; guardaDatos(f);
    sel=TM2.per.length-1; abierto=null;
    ORIGEN={ tipo:'foto', calculando:false, motivo, aviso:'', respaldo:'' };
    pinta();
    return;
  }
  ORIGEN.calculando=false; ORIGEN.motivo=motivo;
  pintaEstado();
}

/* Escribir en la API (guardar partes, publicar la foto). Sesión vencida o sin token
   (200 o 401 con auth:false) → error marcado para aconsejar volver a entrar. */
async function escribir(cuerpo){
  const r = await fetch(API, { method:'POST',
    headers:{ 'Content-Type':'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({}, cuerpo, { token:token() })) });
  let j=null; try{ j=await r.json(); }catch(e){ j=null; }
  if(j && j.ok===false && j.auth===false){
    const e=new Error(j.error||'la sesión venció'); e.sesion=true; throw e;
  }
  if(!r.ok) throw new Error('el servidor respondió '+r.status+(j&&j.error?' — '+j.error:''));
  if(!j || j.ok===false) throw new Error((j&&(j.error||j.mensaje))||'el servidor no lo guardó');
  return j;
}
async function publicar(d){ return (await escribir({ action:'tablero_guardar', foto:d })).meta||{}; }

/* FOTO DE RESPALDO (admin/jefe). Tras cada cálculo en vivo se compara con la foto
   publicada y se publica solo si lo calculado cambió (misma huella → nada). Nunca
   se publica una foto sin maquinaria —pisaría la buena de todos— ni por encima de
   una más nueva. Lo que pase va al renglón (en ámbar si falló) y al title. */
async function respaldo(d){
  if(PUEDEN_ACTUALIZAR.indexOf(ROL)<0 || !token()) return;
  if(!d.maq_periodos || !d.maq_periodos.length) return;
  try{
    const pub=await fotoCompartida();
    if(pub && pub.vivo && pub.vivo.firma===d.vivo.firma) return;
    if(pub && pub.generado && d.generado && pub.generado > d.generado) return;
    await publicar(d);
    if(TM2===d){ ORIGEN.respaldo='foto de respaldo publicada'; pintaEstado(); }
  }catch(err){
    if(TM2!==d) return;
    const motivo=String((err&&err.message)||'error desconocido').replace(/[\s.]+$/,'');
    ORIGEN.respaldo='<span class="warn">la foto de respaldo no se publicó ('+esc(motivo)+
                    (err&&err.sesion?'; vuelve a entrar con tu usuario':'')+')</span>';
    pintaEstado();
  }
}

/* ---------------------------------------------------------------------------
 * CARGAR PARTES DE MAQUINARIA (admin/jefe · D185)
 *
 * La maquinaria sigue saliendo del libro de partes (hoja BASE MAQUINARIA), pero se
 * carga UNA vez, cuando llega uno nuevo: se elige SOLO ese libro, el navegador lo
 * lee con el mismo leerHoras de siempre y sube su salida cruda a Galca
 * (tablero_horas_guardar). Desde ahí la ve cualquiera que abra el Tablero. Lleva
 * códigos de máquina, horas y centros de coste; ningún nombre de persona.
 * ------------------------------------------------------------------------ */
async function leerLibro(archivo,hojas){
  const buf=await archivo.arrayBuffer();
  return XLSX.read(new Uint8Array(buf),{type:'array',cellDates:true,sheets:hojas});
}
async function cargarPartes(archivo){
  const b=$('btnPartes'); if(b) b.disabled=true;
  const t0=Date.now();
  try{
    /* Aviso transitorio sin nombre de archivo (pedido del dueño); los errores de
       carga, más abajo, SÍ lo llevan — ahí importa saber cuál libro falló. */
    estado('Leyendo el libro de partes… (uno grande tarda unos segundos)',false);
    await new Promise(r=>setTimeout(r,40));        // deja pintar el aviso antes del XLSX.read, que bloquea
    const wb=await leerLibro(archivo,['BASE MAQUINARIA']);
    const H=MOTOR.leerHoras(wb);
    if(!H.partes.length) throw new Error('el libro no trae partes con horas de la flota del reparto (¿es el libro de partes diarios?)');
    estado('Guardando la maquinaria en Galca ('+H.partes.length+' partes)…',false);
    await escribir({ action:'tablero_horas_guardar', horas:H, archivo:archivo.name });
    const seg=((Date.now()-t0)/1000).toFixed(1);
    const txt='maquinaria guardada en Galca en '+seg+' s: '+H.partes.length+' partes hasta el '+
              esc(fechaCorta(H.corte))+' · ya la ve todo el que abra el Tablero';
    if(enCurso) await enCurso;                     // un refresco ya lanzado no traería las horas nuevas
    const ok=await enVivo({});                     // admin/jefe saltan la caché: sale con las horas nuevas
    ORIGEN.aviso = ok ? txt : '<span class="warn">la '+txt+', pero no se pudo recalcular en vivo: recarga la página</span>';
    pintaEstado();
  }catch(err){
    /* En el renglón (ORIGEN.aviso) y no con estado(): así sobrevive a repintar al elegir otro mes.
       Los ERRORES sí llevan el nombre del archivo (a diferencia del renglón normal y los avisos de
       éxito, D316): hace falta saber cuál libro falló. */
    const motivo=String((err&&err.message)||'error desconocido').replace(/[\s.]+$/,'');
    ORIGEN.aviso='<span class="warn">no se pudo cargar «'+esc(archivo.name)+'»: '+esc(motivo)+
      '; la maquinaria guardada sigue siendo la anterior'+(err&&err.sesion?' (vuelve a entrar con tu usuario y cárgalo otra vez)':'')+'</span>';
    pintaEstado();
  }finally{ if(b) b.disabled=false; }
}


/* ===========================================================================
 * QUIÉN ENTRA Y QUÉ PUEDE TOCAR (D158, abierta al público en D161, en vivo en D185)
 *
 * ESTA PÁGINA ES PÚBLICA. Se comparte por enlace con los directivos, que no
 * tienen usuario en la plataforma ni tienen por qué tenerlo: abren el enlace y
 * la ven, sin login y sin instalar nada —y desde D185, calculada al momento con
 * la DATA de Galca—. Quien SÍ entra por la plataforma la sigue teniendo en su
 * panel —jefe.html, residente.html, seleccion-reporte.html— y además le sale el
 * botón de volver, que el visitante público no necesita.
 *
 * QUÉ QUEDA A LA VISTA: producción, horas de máquina y avance. Ni claves ni
 * nombres de personas: ?action=tablero_vivo trae días, códigos de máquina, horas,
 * la proyección SIN el usuario que la editó y, de la maquinaria, solo el nombre del
 * archivo y cuándo se cargó. Las CIFRAS DE OBRA sí las ve cualquiera que tenga el
 * enlace: es la decisión que se tomó (D161, ampliada por el dueño en D185).
 *
 * QUIÉN PUEDE TOCAR. El único botón, «Cargar partes de maquinaria», y la
 * publicación automática de la foto de respaldo son de ADMIN y JEFE; los
 * residentes y el público no lo ven. Quitarlo aquí es solo cosmético: lo que de
 * verdad guarda es el SERVIDOR, que comprueba el rol con el token firmado (D109).
 * =========================================================================*/
const PUEDEN_ACTUALIZAR=['admin','jefe'];
const PANEL={ admin:'menu.html', jefe:'hub-jefe.html', residente:'residente.html',
              residente_dren:'seleccion-reporte.html',
              residente_odt:'seleccion-reporte.html',
              residente_odl:'seleccion-reporte.html' };
function sesion(){
  try{ return { rol:localStorage.getItem('rol')||'', usuario:localStorage.getItem('usuario')||'' }; }
  catch(e){ return { rol:'', usuario:'' }; }
}
/* Quién está mirando. Cadena vacía = visitante público, o una copia suelta del
   archivo: ve el tablero entero, en solo lectura. Ya no expulsa a nadie, así
   que nunca devuelve null y la página siempre se pinta. */
function portero(){
  const {rol}=sesion();
  return PANEL[rol] ? rol : '';
}
function segunRol(rol){
  const v=$('volver');
  if(v && PANEL[rol]){
    v.textContent='← Volver';
    v.onclick=()=>{ location.href=PANEL[rol]; };
    v.hidden=false;
  }else if(v && location.protocol!=='file:'){
    /* Visitante público: no hay panel al que volver. El mismo botón le sirve
       de entrada a quien es de la obra y llegó por el enlace sin sesión. Dice
       «Iniciar sesión» y no «Entrar» a propósito: el directivo tiene que leer
       de un vistazo que eso NO es para él —ya está dentro— y seguir de largo. */
    v.textContent='Iniciar sesión';
    v.onclick=()=>{ location.href='index.html'; };
    v.hidden=false;
  }
  if(PUEDEN_ACTUALIZAR.indexOf(rol)>=0) return;
  /* Se retira el botón de cargar partes. El renglón de estado se queda: dice de
     cuándo son los datos, que es justamente lo que hay que saber al proyectarlo. */
  ['btnPartes','filPartes'].forEach(id=>{ const b=$(id); if(b) b.remove(); });
}

/* ------------------------------------------------------------- arranque */
function wire(){
  const b=$('btnPartes'), f=$('filPartes');
  if(!b || !f) return;             // solo lectura: no hay nada que cablear
  b.onclick=()=>{ f.value=''; f.click(); };
  f.onchange=()=>{ if(f.files && f.files[0]) cargarPartes(f.files[0]); };
}

function pinta(){
  const p=TM2.per[sel];
  /* V3-15(b): el filtro de días es del PERÍODO, no de la sesión: cambiar de mes
     lo reinicia (cambiar de UF, no — eso lo deja intacto `evolucion()`/`controles()`). */
  if(perActual!==p.p){ perActual=p.p; selDias=null; personalAbierto=null; anclaTeclado=null; }
  document.getElementById('perT').textContent=eti(p.p);
  document.getElementById('perR').textContent=rango(p.p)+' · '+p.d.length+' días registrados';
  document.getElementById('perC').textContent='';
  controles();evolucion();escala(p);diaria(p);planPeriodo(p);avance();aprov(p);cadena(p);personal(p);pintaEstado();
}
try{const g=localStorage.getItem('tm2-tema');if(g)document.documentElement.setAttribute('data-tema',g);}catch(e){}
/* 1. Se pinta YA con lo último visto en este equipo (o la copia incluida)… */
try{const s=localStorage.getItem(LS_DAT);
    if(s){const d=JSON.parse(s); if(d&&d.per&&d.per.length){ TM2=d; ORIGEN.tipo='local'; }}}catch(e){}
sel=TM2.per.length-1;
const ROL=portero();
segunRol(ROL);
wire();
pinta();
/* 2. …y enseguida se calcula en vivo con la DATA de Galca (D185). */
enVivo({ primero:true });
/* 3. Mientras la página esté abierta, cada 5 minutos; con la pestaña oculta se
   espera a que vuelva, y al volver se recalcula si el último cálculo tiene más de
   un minuto (el jefe que corrigió la DATA en otra pestaña lo ve al volver). */
setInterval(()=>{ if(!document.hidden) enVivo({ auto:true }); }, REFRESCO_MS);
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden && Date.now()-ultimoVivo>VOLVER_MS) enVivo({ auto:true });
});
