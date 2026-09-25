/**
 * api/obra/resumen_texto.js — redacción POR REGLAS del Resumen ejecutivo (gratis, determinista).
 *
 * Módulo PURO (sin I/O, sin `c`/`sql`): recibe los `indicadores` que ya calculó resumen_ejecutivo.js y
 * devuelve 1–2 párrafos en español colombiano, tono ejecutivo, m³ compactos, números en formato es-CO.
 * También vive aquí el VALIDADOR de números del texto de la IA (resumen_ejecutivo_ia): puro por lo mismo
 * (nunca confiar en la IA sin comprobar sus cifras contra las de `indicadores`).
 *
 * Forma esperada de `indicadores` (la arma resumen_ejecutivo.js):
 *   { desde, hasta,
 *     principales: { excavacion|terraplen|subbase|base: {prod, plan, cumpl, prod_ant, var_pct} },
 *     global: { prod_total, plan_total, cumpl, prod_ant, var_pct, clase: 'muy_buena'|'dentro'|'por_debajo'|null },
 *     clima: { dias_rango, dias_con_registro, dias_lluvia, horas_lluvia, horas_varada, por_clima:{...} },
 *     drenajes: { odt:{actividades:[{actividad,unidad,cantidad,dias}]}, odl:{...}, otras:{...} },
 *     avance: { partidas:{...}, global:{cumpl,...}, hasta } | null
 *   }
 *
 * Umbrales (D-xx pendiente de cierre documental por el orquestador): CUMPL_BUENA/CUMPL_DENTRO clasifican
 * el cumplimiento global (≥100% muy buena, 75–100% dentro de lo planeado, <75% por debajo — umbral fijado
 * por el jefe); UMBRAL_LLUVIA_FUERTE decide si la lluvia se menciona como causa principal. Un solo lugar:
 * el handler del endpoint importa estas mismas constantes para clasificar (nunca las repite).
 */

export const CUMPL_BUENA = 1.00;
export const CUMPL_DENTRO = 0.75;
export const UMBRAL_LLUVIA_FUERTE = 0.25;

const ETQ_PARTIDA = { excavacion: 'Excavación', terraplen: 'Terraplén', subbase: 'Subbase', base: 'Base/BTC' };
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
function aperturaFechas_(desde, hasta) {
  if (desde === hasta) return 'El ' + fechaLarga_(desde);
  return 'Del ' + fechaLarga_(desde) + ' al ' + fechaLarga_(hasta);
}
function clasificacionTexto_(clase) {
  if (clase === 'muy_buena') return 'una muy buena producción';
  if (clase === 'por_debajo') return 'una producción por debajo del plan';
  if (clase === 'dentro') return 'una producción dentro de lo planeado';
  return 'producción registrada (sin plan cargado para comparar)';
}
// La partida con mejor/peor cumplimiento de `principales` (solo entre las que tienen plan>0, cumpl≠null).
function partidaExtremo_(principales, mejor) {
  if (!principales) return null;
  let out = null;
  ORDEN_PARTIDAS.forEach(function (k) {
    const v = principales[k];
    if (!v || v.cumpl == null) return;
    if (!out || (mejor ? v.cumpl > out.v.cumpl : v.cumpl < out.v.cumpl)) out = { k: k, v: v };
  });
  return out;
}

/* ---------- redacción por reglas ---------- */
export function redactarResumen(ind) {
  if (!ind || typeof ind !== 'object') return 'No hay información suficiente para redactar el resumen.';
  const desde = txt_(ind.desde), hasta = txt_(ind.hasta);
  const g = ind.global || {};
  const clima = ind.clima || {};

  if (!clima.dias_con_registro && !(g.prod_total > 0)) {
    return aperturaFechas_(desde, hasta) + ' no hay registros de producción en Galca para este rango: sin datos para redactar el resumen.';
  }

  const p1 = [];
  p1.push(aperturaFechas_(desde, hasta) + ' la obra tuvo ' + clasificacionTexto_(g.clase) + ': '
    + fmtN_(g.prod_total) + ' m³ compactos'
    + (g.plan_total > 0 ? ' frente a un plan de ' + fmtN_(g.plan_total) + ' m³ (' + fmtPct_(g.cumpl) + ' de cumplimiento)' : ' (sin plan cargado para el periodo)')
    + '.');

  // Causa: clima primero (D182), si no explica → la partida más rezagada.
  const propLluvia = clima.dias_rango > 0 ? (clima.dias_lluvia || 0) / clima.dias_rango : 0;
  // El peso que se le da a la lluvia depende del resultado: con buena producción no puede «afectar de forma
  // importante» (se contradice con el cumplimiento); se dice que se logró pese a ella.
  const detLluvia = (clima.dias_lluvia || 0) + ' de ' + clima.dias_rango + ' días con lluvia'
    + (clima.horas_lluvia != null ? ', ' + fmtN_(clima.horas_lluvia) + ' horas de lluvia registradas en los partes de maquinaria' : '');
  if (propLluvia >= UMBRAL_LLUVIA_FUERTE && g.clase === 'muy_buena') {
    p1.push('El resultado se logró pese a la lluvia (' + detLluvia + ').');
  } else if (propLluvia >= UMBRAL_LLUVIA_FUERTE && g.clase === 'dentro') {
    p1.push('La lluvia restó producción en el periodo (' + detLluvia + ').');
  } else if (propLluvia >= UMBRAL_LLUVIA_FUERTE) {
    p1.push('La lluvia afectó de forma importante la producción (' + detLluvia + ').');
  } else if ((clima.dias_lluvia || 0) >= 1) {
    p1.push('Hubo lluvia en ' + clima.dias_lluvia + ' día' + (clima.dias_lluvia === 1 ? '' : 's') + ' del periodo, sin afectar de forma determinante el resultado.');
  } else if (g.clase === 'por_debajo') {
    const peor = partidaExtremo_(ind.principales, false);
    p1.push('El resultado no se explica por el clima' + (peor ? ': la partida más rezagada fue ' + ETQ_PARTIDA[peor.k] + ' (' + fmtPct_(peor.v.cumpl) + ' de cumplimiento).' : '.'));
  }

  // Partidas destacadas (mayor y menor cumplimiento), solo si hay al menos 2 partidas con plan.
  const mejor = partidaExtremo_(ind.principales, true), peor2 = partidaExtremo_(ind.principales, false);
  if (mejor && peor2 && mejor.k !== peor2.k) {
    p1.push('Por partida, ' + ETQ_PARTIDA[mejor.k] + ' tuvo el mejor cumplimiento (' + fmtPct_(mejor.v.cumpl) + ') y ' + ETQ_PARTIDA[peor2.k] + ' el más bajo (' + fmtPct_(peor2.v.cumpl) + ').');
  }

  // Segundo párrafo: drenajes, avance y variación vs periodo anterior.
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
  if (ind.avance && ind.avance.global && ind.avance.global.cumpl != null) {
    p2.push('El avance del contrato llegó a ' + fmtPct_(ind.avance.global.cumpl) + ' al ' + fechaLarga_(ind.avance.hasta || hasta) + '.');
  }
  if (g.prod_ant != null && g.prod_ant > 0 && g.var_pct != null) {
    p2.push('Frente al periodo anterior (' + fmtN_(g.prod_ant) + ' m³), la producción ' + (g.var_pct >= 0 ? 'subió' : 'bajó') + ' ' + fmtPct_(Math.abs(g.var_pct)) + '.');
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
