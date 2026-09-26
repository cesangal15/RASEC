/**
 * api/obra/resumen_texto.js — redacción POR REGLAS del Resumen ejecutivo (gratis, determinista).
 *
 * Módulo PURO (sin I/O, sin `c`/`sql`): recibe los `indicadores` que ya calculó resumen_ejecutivo.js y
 * devuelve 1–2 párrafos en español colombiano, tono ejecutivo, m³ compactos, números en formato es-CO.
 * También vive aquí el VALIDADOR de números del texto de la IA (resumen_ejecutivo_ia): puro por lo mismo
 * (nunca confiar en la IA sin comprobar sus cifras contra las de `indicadores`).
 *
 * D218: las 4 partidas (excavación/terraplén/subbase/base) son materiales DISTINTOS — nunca se suman en
 * un total de producción ni de plan (16.649 m³ de "plan total" no tiene sentido). El texto va SIEMPRE por
 * partida, agrupando por su propia clasificación (muy buena / dentro de lo planeado / por debajo / sin
 * producción / sin plan). `global` puede seguir viniendo en `indicadores` para quien lo use, pero
 * redactarResumen ya NO lo lee.
 *
 * Forma esperada de `indicadores` (la arma resumen_ejecutivo.js):
 *   { desde, hasta, hasta_pedido?,
 *     principales: { excavacion|terraplen|subbase|base: {prod, plan, cumpl, prod_ant, var_pct} },
 *     clima: { dias_rango, dias_con_registro, dias_lluvia, horas_lluvia, horas_varada, por_clima:{...} },
 *     drenajes: { odt:{actividades:[{actividad,unidad,cantidad,dias}]}, odl:{...}, otras:{...} },
 *     avance: { partidas:{...}, global:{cumpl,...}, hasta } | null }
 *
 * Umbrales (D-xx pendiente de cierre documental por el orquestador): CUMPL_BUENA/CUMPL_DENTRO clasifican
 * el cumplimiento de CADA partida (≥100% muy buena, 75–100% dentro de lo planeado, <75% por debajo — umbral
 * fijado por el jefe); UMBRAL_LLUVIA_FUERTE decide si la lluvia se menciona como causa principal, ahora
 * sobre `dias_con_registro` (D218-C), no sobre el rango calendario. Un solo lugar: el handler del endpoint
 * importa estas mismas constantes para clasificar cada partida (nunca las repite).
 */

export const CUMPL_BUENA = 1.00;
export const CUMPL_DENTRO = 0.75;
export const UMBRAL_LLUVIA_FUERTE = 0.25;

const ETQ_PARTIDA = { excavacion: 'Excavación', terraplen: 'Terraplén', subbase: 'Subbase', base: 'Base/BTC' };
const ETQ_PARTIDA_ART = { excavacion: 'la excavación', terraplen: 'el terraplén', subbase: 'la subbase', base: 'la base/BTC' };
const ORDEN_PARTIDAS = ['excavacion', 'terraplen', 'subbase', 'base'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function txt_(v) { return String(v == null ? '' : v).trim(); }
function fmtN_(n) {
  if (n == null || !isFinite(n)) return '0';
  return Math.round(n).toLocaleString('es-CO');
}
function fmtPct_(n) {
  if (n == null || !isFinite(n)) return 's/d';
  return Math.round(n * 100) + '%';
}
function fechaLarga_(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt_(iso));
  if (!m) return txt_(iso);
  return Number(m[3]) + ' de ' + MESES[Number(m[2]) - 1] + ' de ' + m[1];
}
// La fecha de inicio sin el mes/año que repite la de cierre: «Del 1 al 15 de septiembre de 2026».
function fechaCorta_(desde, hasta) {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt_(desde)), b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt_(hasta));
  if (!a || !b) return fechaLarga_(desde);
  if (a[1] !== b[1]) return fechaLarga_(desde);
  if (a[2] !== b[2]) return Number(a[3]) + ' de ' + MESES[Number(a[2]) - 1];
  return String(Number(a[3]));
}
// D218-B: si el rango pedido pasa del último día con datos, `hasta` ya viene recortado (lo hace el
// handler) y `hastaPedido` es el que se pidió de verdad: se avisa en una coletilla breve.
function aperturaFechas_(desde, hasta, hastaPedido) {
  let base = (desde === hasta) ? 'El ' + fechaLarga_(desde) : 'Del ' + fechaCorta_(desde, hasta) + ' al ' + fechaLarga_(hasta);
  if (hastaPedido && hastaPedido !== hasta) base += ' (último día con datos; se pidió hasta el ' + fechaLarga_(hastaPedido) + ')';
  return base;
}

// «a», «a y b», «a, b y c».
function listaY_(xs) {
  return xs.length <= 1 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1];
}

/* ---------- D218-A: clasificación y redacción POR PARTIDA (nunca un total) ---------- */
// Clasifica una partida sola: con plan>0 usa los mismos umbrales que antes clasificaban el global; sin
// plan, si produjo algo se dice sin comparar contra nada; sin plan y sin producción no hay nada que decir.
export function clasificarPartida_(v) {
  if (!v) return null;
  const plan = Number(v.plan) || 0, prod = Number(v.prod) || 0;
  if (plan > 0) {
    if (prod === 0) return 'sin_produccion';
    const c = v.cumpl;
    if (c == null) return null;
    if (c >= CUMPL_BUENA) return 'muy_buena';
    if (c >= CUMPL_DENTRO) return 'dentro';
    return 'por_debajo';
  }
  if (prod > 0) return 'sin_plan';
  return null;
}
function agruparPartidas_(principales) {
  const grupos = { muy_buena: [], dentro: [], por_debajo: [], sin_produccion: [], sin_plan: [] };
  ORDEN_PARTIDAS.forEach(function (k) {
    const v = principales && principales[k];
    const clase = clasificarPartida_(v);
    if (clase) grupos[clase].push({ k: k, v: v });
  });
  return grupos;
}
// Cifra entre paréntesis de una partida dentro de su frase de grupo. `esPrimeroDelGrupo`: solo el primer
// elemento de un grupo positivo dice "del plan" (los siguientes ya lo tienen implícito, D218-A: "sin
// repetir la unidad de más si queda pesado").
function cifraPartida_(it, tipo, esPrimeroDelGrupo) {
  const v = it.v, nombre = ETQ_PARTIDA[it.k];
  if (tipo === 'muy_buena' || tipo === 'dentro') {
    return nombre + ' (' + fmtN_(v.prod) + ' m³' + (v.plan > 0 ? ', ' + fmtPct_(v.cumpl) + (esPrimeroDelGrupo ? ' del plan' : '') : '') + ')';
  }
  if (tipo === 'por_debajo') return nombre + ' (' + fmtN_(v.prod) + ' m³, ' + fmtPct_(v.cumpl) + ')';
  if (tipo === 'sin_produccion') return nombre + ' (plan ' + fmtN_(v.plan) + ' m³)';
  return nombre; // sin_plan: la cifra va en el verbo (produjo/produjeron X m³)
}
function verbo_(tipo, plural) {
  if (tipo === 'muy_buena') return plural ? 'tuvieron muy buena producción' : 'tuvo muy buena producción';
  if (tipo === 'dentro') return plural ? 'tuvieron una producción dentro de lo planeado' : 'tuvo una producción dentro de lo planeado';
  if (tipo === 'por_debajo') return plural ? 'quedaron por debajo del plan' : 'quedó por debajo del plan';
  if (tipo === 'sin_produccion') return plural ? 'no registraron producción' : 'no registró producción';
  return '';
}
function fraseGrupo_(items, tipo) {
  if (!items || !items.length) return '';
  const plural = items.length > 1;
  if (tipo === 'sin_plan') {
    const partes = items.map(function (it) { return ETQ_PARTIDA[it.k] + ' produj' + (plural ? 'eron' : 'o') + ' ' + fmtN_(it.v.prod) + ' m³'; });
    return partes.join(' y ') + ' (sin plan cargado para comparar)';
  }
  const nombres = items.map(function (it, i) { return cifraPartida_(it, tipo, i === 0); }).join(' y ');
  return nombres + ' ' + verbo_(tipo, plural);
}
const ORDEN_GRUPOS = ['muy_buena', 'dentro', 'por_debajo', 'sin_produccion', 'sin_plan'];

/* ---------- redacción por reglas ---------- */
export function redactarResumen(ind) {
  if (!ind || typeof ind !== 'object') return 'No hay información suficiente para redactar el resumen.';
  const desde = txt_(ind.desde), hasta = txt_(ind.hasta);
  const clima = ind.clima || {};
  const grupos = agruparPartidas_(ind.principales);
  const frasesProd = ORDEN_GRUPOS.map(function (t) { return fraseGrupo_(grupos[t], t); }).filter(Boolean);

  if (!frasesProd.length) {
    return aperturaFechas_(desde, hasta, ind.hasta_pedido) + ' no hay registros de producción en Galca para este rango: sin datos para redactar el resumen.';
  }

  const p1 = [];
  p1.push(aperturaFechas_(desde, hasta, ind.hasta_pedido) + ', ' + frasesProd.join('; ') + '.');

  // Causa: clima primero (D182), sobre `dias_con_registro` (D218-C, no el rango calendario completo).
  const diasConRegistro = clima.dias_con_registro || 0;
  const propLluvia = diasConRegistro > 0 ? (clima.dias_lluvia || 0) / diasConRegistro : 0;
  const detLluvia = (clima.dias_lluvia || 0) + ' de ' + diasConRegistro + ' días con lluvia'
    + (clima.horas_lluvia != null ? ', ' + fmtN_(clima.horas_lluvia) + ' horas de lluvia registradas en los partes de maquinaria' : '');
  const partidasPorDebajo = grupos.por_debajo.length + grupos.sin_produccion.length;
  if (propLluvia >= UMBRAL_LLUVIA_FUERTE) {
    if (partidasPorDebajo > 0) p1.push('La lluvia afectó la producción (' + detLluvia + ').');
    else p1.push('El resultado se logró pese a la lluvia (' + detLluvia + ').');
  } else if ((clima.dias_lluvia || 0) >= 1) {
    p1.push('Hubo lluvia en ' + clima.dias_lluvia + ' día' + (clima.dias_lluvia === 1 ? '' : 's') + ' del periodo, sin afectar de forma determinante el resultado.');
  } else if (partidasPorDebajo > 0) {
    p1.push('El rezago no se explica por el clima.');
  }

  // Segundo párrafo: drenajes, avance y variación vs periodo anterior (por partida, D218-A).
  const p2 = [];
  ['odt', 'odl'].forEach(function (a) {
    const d = ind.drenajes && ind.drenajes[a];
    if (d && Array.isArray(d.actividades) && d.actividades.length) {
      const top = d.actividades.slice(0, 3).map(function (x) { return x.actividad + ' (' + fmtN_(x.cantidad) + ' ' + x.unidad + ')'; }).join(', ');
      p2.push((a === 'odt' ? 'En drenaje transversal (ODT)' : 'En drenaje longitudinal (ODL)') + ' se reportó ' + top + '.');
    }
  });
  const otras = ind.drenajes && ind.drenajes.otras;
  if (otras && Array.isArray(otras.actividades) && otras.actividades.length) {
    const top = otras.actividades.slice(0, 3).map(function (x) { return x.actividad + ' (' + fmtN_(x.cantidad) + ' ' + x.unidad + ')'; }).join(', ');
    p2.push('En otras actividades se reportó ' + top + '.');
  }
  // Avance del contrato POR PARTIDA (D218-A): cada material contra su propia cantidad contratada.
  const avP = (ind.avance && ind.avance.partidas) || {};
  const avances = ORDEN_PARTIDAS.filter(function (k) { return avP[k] && avP[k].cumpl != null; })
    .map(function (k) { return ETQ_PARTIDA_ART[k].replace(/^(la|el) /, '') + ' ' + fmtPct_(avP[k].cumpl); });
  if (avances.length) {
    p2.push('Avance del contrato al ' + fechaLarga_(ind.avance.hasta || hasta) + ': ' + listaY_(avances) + '.');
  }
  const conVariacion = ORDEN_PARTIDAS.map(function (k) { return { k: k, v: ind.principales && ind.principales[k] }; })
    .filter(function (x) { return x.v && x.v.prod_ant > 0 && x.v.var_pct != null; });
  if (conVariacion.length) {
    // Un grupo por dirección («subió … y …; bajó … y …»), para no encadenar «y» de más.
    const grupo = function (sube) {
      const xs = conVariacion.filter(function (x) { return (x.v.var_pct >= 0) === sube; });
      if (!xs.length) return '';
      const verbo = sube ? 'subió' : 'bajó';
      return listaY_(xs.map(function (x, i) {
        return ETQ_PARTIDA_ART[x.k] + (i === 0 ? ' ' + verbo : '') + ' ' + fmtPct_(Math.abs(x.v.var_pct));
      }));
    };
    const grupos = [grupo(true), grupo(false)].filter(Boolean);
    p2.push('Frente al periodo anterior, ' + grupos.join('; ') + '.');
  }

  const t1 = p1.join(' '), t2 = p2.join(' ');
  return t2 ? (t1 + '\n\n' + t2) : t1;
}

/* ---------- validador de números del texto de la IA ----------
 * Recorre `ind` recogiendo todo número finito (redondeado y con 2 decimales) y, de cada fecha 'YYYY-MM-DD',
 * año/mes/día sueltos (para no rechazar «2026» o «15»); además añade la forma en % (×100) de toda razón
 * entre 0 y 5 (cumplimientos/variaciones). Luego extrae los números del texto (es-CO: punto de miles, coma
 * decimal) y exige que CADA UNO exista entre las cifras permitidas, con tolerancia de ±1 por redondeo. */
function extraerCifras_(ind) {
  const set = new Set();
  (function walk(o) {
    if (o == null) return;
    if (typeof o === 'number' && isFinite(o)) { set.add(Math.round(o)); set.add(Math.round(o * 100) / 100); return; }
    if (typeof o === 'string') {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(o);
      if (m) { set.add(Number(m[1])); set.add(Number(m[2])); set.add(Number(m[3])); }
      return;
    }
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (typeof o === 'object') { Object.keys(o).forEach(function (k) { walk(o[k]); }); }
  })(ind);
  const pct = [];
  set.forEach(function (n) { if (n >= 0 && n <= 5) pct.push(Math.round(n * 100)); });
  pct.forEach(function (n) { set.add(n); });
  return set;
}
export function validarNumerosTexto(texto, ind) {
  const permitidas = extraerCifras_(ind);
  const encontrados = String(texto || '').match(/\d[\d.,]*/g) || [];
  for (let i = 0; i < encontrados.length; i++) {
    let raw = encontrados[i].replace(/[.,]+$/, '');
    if (!raw) continue;
    // es-CO: '.' de miles (grupos de 3) se quita; ',' decimal se vuelve '.'
    let limpio = raw.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    const n = Number(limpio);
    if (!isFinite(n)) continue;
    let ok = permitidas.has(Math.round(n)) || permitidas.has(Math.round(n * 100) / 100);
    if (!ok) { for (const p of permitidas) { if (Math.abs(p - n) <= 1) { ok = true; break; } } }
    if (!ok) return { ok: false, cifra: raw };
  }
  return { ok: true };
}
