#!/usr/bin/env node
/**
 * Verificación del Resumen ejecutivo — módulo PURO worker/src/api/obra/resumen_texto.js
 * (redactarResumen + validarNumerosTexto). Sin red, sin BD: casos de indicadores ya calculados.
 *
 *   node backend/pruebas/verificar_resumen_ejecutivo.js
 */
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');

let redactarResumen, validarNumerosTexto, CUMPL_BUENA, CUMPL_DENTRO;
let fallos = 0, casos = 0;
function ok(n, c, x) { casos++; if (!c) { fallos++; console.log('  ✗ ' + n + (x !== undefined ? '  → ' + x : '')); } else console.log('  ✓ ' + n); }

async function main() {
  const mod = await import('file://' + path.join(REPO, 'worker', 'src', 'api', 'obra', 'resumen_texto.js').replace(/\\/g, '/'));
  ({ redactarResumen, validarNumerosTexto, CUMPL_BUENA, CUMPL_DENTRO } = mod);

  ok('umbrales: muy buena ≥ 100%, dentro 75–100%, por debajo < 75%', CUMPL_BUENA === 1.00 && CUMPL_DENTRO === 0.75);

  const principalesBase = {
    excavacion: { prod: 5000, plan: 4500, cumpl: 5000 / 4500, prod_ant: 4800, var_pct: (5000 - 4800) / 4800 },
    terraplen: { prod: 3000, plan: 3200, cumpl: 3000 / 3200, prod_ant: 2900, var_pct: (3000 - 2900) / 2900 },
    subbase: { prod: 800, plan: 900, cumpl: 800 / 900, prod_ant: 750, var_pct: (800 - 750) / 750 },
    base: { prod: 400, plan: 500, cumpl: 400 / 500, prod_ant: 420, var_pct: (400 - 420) / 420 },
  };
  function indBase(over) {
    const base = {
      desde: '2026-09-01', hasta: '2026-09-15',
      principales: principalesBase,
      global: { prod_total: 9200, plan_total: 9100, cumpl: 9200 / 9100, prod_ant: 8870, var_pct: (9200 - 8870) / 8870, clase: 'muy_buena' },
      clima: { dias_rango: 15, dias_con_registro: 15, dias_lluvia: 0, horas_lluvia: null, horas_varada: null, por_clima: { SOLEADO: 15 } },
      drenajes: {
        odt: { actividades: [{ actividad: 'Excavaciones varias', unidad: 'm3', cantidad: 320, dias: 10 }] },
        odl: { actividades: [{ actividad: 'Tubería', unidad: 'ml', cantidad: 210, dias: 8 }] },
        otras: { actividades: [] },
      },
      avance: { partidas: {}, global: { cumpl: 0.62 }, hasta: '2026-09-15' },
    };
    return Object.assign(base, over || {});
  }

  console.log('\n== redactarResumen: casos de clasificación ==');
  {
    const t = redactarResumen(indBase());
    ok('muy_buena: menciona "muy buena producción"', /muy buena producción/.test(t), t);
    ok('trae 2 párrafos (drenajes + avance)', t.indexOf('\n\n') > 0);
    ok('cifra de producción total formateada es-CO', t.indexOf('9.200') >= 0 || t.indexOf('9200') >= 0, t);
  }
  {
    const ind = indBase({ global: { prod_total: 6900, plan_total: 9100, cumpl: 6900 / 9100, prod_ant: 8870, var_pct: (6900 - 8870) / 8870, clase: 'dentro' } });
    const t = redactarResumen(ind);
    ok('dentro: "dentro de lo planeado"', /dentro de lo planeado/.test(t), t);
  }
  {
    // por_debajo CON lluvia relevante (≥25% de los días)
    const ind = indBase({
      global: { prod_total: 4000, plan_total: 9100, cumpl: 4000 / 9100, prod_ant: 8870, var_pct: (4000 - 8870) / 8870, clase: 'por_debajo' },
      clima: { dias_rango: 15, dias_con_registro: 15, dias_lluvia: 5, horas_lluvia: 22, horas_varada: 3, por_clima: { LLUVIA: 5, SOLEADO: 10 } },
    });
    const t = redactarResumen(ind);
    ok('por_debajo con lluvia fuerte: "afectó de forma importante"', /afectó de forma importante/.test(t), t);
    ok('  · incluye horas de lluvia', /22/.test(t));
    ok('por debajo del plan mencionado', /por debajo del plan/.test(t));
  }
  {
    // por_debajo SIN lluvia relevante: cita la partida más rezagada
    const ind = indBase({
      global: { prod_total: 4000, plan_total: 9100, cumpl: 4000 / 9100, prod_ant: 8870, var_pct: (4000 - 8870) / 8870, clase: 'por_debajo' },
      clima: { dias_rango: 15, dias_con_registro: 15, dias_lluvia: 0, horas_lluvia: null, horas_varada: null, por_clima: { SOLEADO: 15 } },
    });
    const t = redactarResumen(ind);
    ok('por_debajo sin lluvia: "no se explica por el clima"', /no se explica por el clima/.test(t), t);
    ok('  · cita la partida más rezagada (Base\\/BTC)', /Base\/BTC/.test(t), t);
  }
  {
    // Límite exacto 0.75 → 'dentro' (lo decide el handler, aquí solo se prueba el TEXTO con esa clase)
    const ind = indBase({ global: { prod_total: 6825, plan_total: 9100, cumpl: 0.75, prod_ant: 8870, var_pct: -0.23, clase: 'dentro' } });
    ok('límite exacto 0.75 → texto "dentro"', /dentro de lo planeado/.test(redactarResumen(ind)));
  }
  {
    // Límite exacto 1.00 → 'muy_buena'
    const ind = indBase({ global: { prod_total: 9100, plan_total: 9100, cumpl: 1.00, prod_ant: 8870, var_pct: 0.026, clase: 'muy_buena' } });
    ok('límite exacto 1.00 → texto "muy buena"', /muy buena producción/.test(redactarResumen(ind)));
  }
  {
    // Sin datos en el rango
    const ind = indBase({
      global: { prod_total: 0, plan_total: 0, cumpl: null, prod_ant: 0, var_pct: null, clase: null },
      clima: { dias_rango: 5, dias_con_registro: 0, dias_lluvia: 0, horas_lluvia: null, horas_varada: null, por_clima: {} },
      principales: { excavacion: { prod: 0, plan: 0, cumpl: null, prod_ant: 0, var_pct: null }, terraplen: { prod: 0, plan: 0, cumpl: null, prod_ant: 0, var_pct: null }, subbase: { prod: 0, plan: 0, cumpl: null, prod_ant: 0, var_pct: null }, base: { prod: 0, plan: 0, cumpl: null, prod_ant: 0, var_pct: null } },
      drenajes: { odt: { actividades: [] }, odl: { actividades: [] }, otras: { actividades: [] } },
      avance: null,
    });
    const t = redactarResumen(ind);
    ok('sin datos → texto de "sin registros"', /no hay registros de producción/.test(t), t);
  }
  {
    // Sin plan cargado (plan_total 0 con producción > 0): no debe inventar cumplimiento
    const ind = indBase({
      global: { prod_total: 3000, plan_total: 0, cumpl: null, prod_ant: 0, var_pct: null, clase: null },
      principales: { excavacion: { prod: 3000, plan: 0, cumpl: null, prod_ant: 0, var_pct: null }, terraplen: { prod: 0, plan: 0, cumpl: null, prod_ant: 0, var_pct: null }, subbase: { prod: 0, plan: 0, cumpl: null, prod_ant: 0, var_pct: null }, base: { prod: 0, plan: 0, cumpl: null, prod_ant: 0, var_pct: null } },
      avance: null,
    });
    const t = redactarResumen(ind);
    ok('sin plan: "sin plan cargado"', /sin plan cargado/.test(t), t);
    ok('  · no dice ningún porcentaje inventado de cumplimiento', !/\d+% de cumplimiento/.test(t), t);
  }

  console.log('\n== prorrateo del plan en un rango que cruza 15/16 (lo prueba el handler; aquí solo la fórmula) ==');
  {
    // Periodo agosto (16-jul→15-ago, 31 días) y periodo septiembre (16-ago→15-sep, 31 días): un rango
    // 10-ago a 20-ago cruza el corte del día 15/16. Replica la MISMA fórmula que usará resumen_ejecutivo.js
    // (periodoDia_ + días calendario del periodo 16→15) para dejar la regla probada de forma aislada.
    function periodoDia(f) {
      let y = Number(f.slice(0, 4)), m = Number(f.slice(5, 7));
      if (Number(f.slice(8, 10)) > 15) { m++; if (m > 12) { m = 1; y++; } }
      return y + '-' + String(m).padStart(2, '0');
    }
    function diasEnPeriodo(periodo) {
      const y = Number(periodo.slice(0, 4)), m = Number(periodo.slice(5, 7));
      const fin = new Date(Date.UTC(y, m - 1, 15));
      let iniY = y, iniM = m - 1; if (iniM < 1) { iniM = 12; iniY = y - 1; }
      const ini = new Date(Date.UTC(iniY, iniM - 1, 16));
      return Math.round((fin - ini) / 86400000) + 1;
    }
    ok('10-ago pertenece al periodo 2026-08 (cierra el 15)', periodoDia('2026-08-10') === '2026-08');
    ok('16-ago pertenece al periodo 2026-09 (el que cierra el 15-sep)', periodoDia('2026-08-16') === '2026-09');
    const plan = { '2026-08': { excavacion: 3100 }, '2026-09': { excavacion: 3000 } };
    function fechasEnRango(desde, hasta) {
      const out = []; let d = desde;
      while (d <= hasta) { out.push(d); const dt = new Date(d + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + 1); d = dt.toISOString().slice(0, 10); }
      return out;
    }
    let total = 0;
    fechasEnRango('2026-08-10', '2026-08-20').forEach(function (f) {
      const p = periodoDia(f), dias = diasEnPeriodo(p);
      total += (plan[p] ? plan[p].excavacion : 0) / dias;
    });
    // 6 días de agosto (10..15) a 3100/31 + 5 días de septiembre (16..20) a 3000/31
    const esperado = 6 * (3100 / 31) + 5 * (3000 / 31);
    ok('prorrateo cruzando 15/16 = 6 días del periodo agosto + 5 del de septiembre', Math.abs(total - esperado) < 1e-9, total + ' vs ' + esperado);
  }

  console.log('\n== validarNumerosTexto: acepta texto fiel, rechaza cifra inventada ==');
  {
    const ind = indBase();
    const fiel = 'Del 1 al 15 de septiembre la obra tuvo una producción de 9.200 m³ compactos frente a un plan de 9.100 m³ (101% de cumplimiento). '
      + 'El avance del contrato llegó a 62%.';
    const r1 = validarNumerosTexto(fiel, ind);
    ok('texto fiel a las cifras → válido', r1.ok === true, JSON.stringify(r1));

    const inventado = fiel + ' La producción de terraplén fue de 3.456 m³, un récord histórico.';
    const r2 = validarNumerosTexto(inventado, ind);
    ok('texto con una cifra inventada (3.456) → rechazado', r2.ok === false && r2.cifra, JSON.stringify(r2));

    const conTolerancia = 'Se produjeron 9.201 m³ frente al plan de 9.099 m³.';
    const r3 = validarNumerosTexto(conTolerancia, ind);
    ok('tolerancia de redondeo ±1 (9.201≈9.200, 9.099≈9.100)', r3.ok === true, JSON.stringify(r3));

    const fechaOk = 'Informe del 15 de septiembre de 2026, con 320 m³ en ODT y 210 ml en ODL.';
    const r4 = validarNumerosTexto(fechaOk, ind);
    ok('cifras de fecha (15, 09→sep, 2026) y de drenajes (320, 210) no se rechazan', r4.ok === true, JSON.stringify(r4));
  }

  console.log('\n' + (fallos ? '✗ ' + fallos + ' fallo(s) de ' + casos : '✓ ' + casos + ' comprobaciones OK'));
  process.exit(fallos ? 1 : 0);
}
main().catch(function (err) { console.error(err && err.stack || err); process.exit(2); });
