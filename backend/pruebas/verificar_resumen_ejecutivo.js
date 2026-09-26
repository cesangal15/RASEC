#!/usr/bin/env node
/**
 * Verificación del Resumen ejecutivo — módulo PURO worker/src/api/obra/resumen_texto.js
 * (redactarResumen + validarNumerosTexto + clasificarPartida_). Sin red, sin BD: casos de indicadores ya
 * calculados. D218: nunca un total sumando las 4 partidas (materiales distintos) — todo por partida.
 *
 *   node backend/pruebas/verificar_resumen_ejecutivo.js
 */
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');

let redactarResumen, validarNumerosTexto, textoDeRespuestaIA, clasificarPartida_, CUMPL_BUENA, CUMPL_DENTRO;
let fallos = 0, casos = 0;
function ok(n, c, x) { casos++; if (!c) { fallos++; console.log('  ✗ ' + n + (x !== undefined ? '  → ' + x : '')); } else console.log('  ✓ ' + n); }

async function main() {
  const mod = await import('file://' + path.join(REPO, 'worker', 'src', 'api', 'obra', 'resumen_texto.js').replace(/\\/g, '/'));
  ({ redactarResumen, validarNumerosTexto, textoDeRespuestaIA, clasificarPartida_, CUMPL_BUENA, CUMPL_DENTRO } = mod);

  ok('umbrales: muy buena ≥ 100%, dentro 75–100%, por debajo < 75%', CUMPL_BUENA === 1.00 && CUMPL_DENTRO === 0.75);

  function P(prod, plan, prodAnt) {
    const cumpl = plan > 0 ? prod / plan : null;
    const var_pct = prodAnt > 0 ? (prod - prodAnt) / prodAnt : null;
    return { prod: prod, plan: plan, cumpl: cumpl, prod_ant: prodAnt, var_pct: var_pct };
  }
  function indBase(over) {
    const base = {
      desde: '2026-09-21', hasta: '2026-09-24',
      principales: {
        excavacion: P(8509, 7735, 6500),   // 110% → muy_buena
        terraplen: P(7152, 6502, 4966),    // 110% → muy_buena
        subbase: P(619, 1105, 700),        // 56%  → por_debajo
        base: P(0, 1297, 300),             // sin producción, con plan
      },
      clima: { dias_rango: 4, dias_con_registro: 4, dias_lluvia: 0, horas_lluvia: null, horas_varada: null, por_clima: { SOLEADO: 4 } },
      drenajes: { odt: { actividades: [] }, odl: { actividades: [] }, otras: { actividades: [] } },
      avance: null,
    };
    return Object.assign(base, over || {});
  }

  console.log('\n== clasificarPartida_: umbrales por partida ==');
  {
    ok('plan>0, cumpl≥1.00 → muy_buena', clasificarPartida_(P(110, 100, 0)) === 'muy_buena');
    ok('plan>0, cumpl exacto 1.00 → muy_buena', clasificarPartida_(P(100, 100, 0)) === 'muy_buena');
    ok('plan>0, 0.75≤cumpl<1.00 → dentro', clasificarPartida_(P(80, 100, 0)) === 'dentro');
    ok('plan>0, cumpl exacto 0.75 → dentro', clasificarPartida_(P(75, 100, 0)) === 'dentro');
    ok('plan>0, cumpl<0.75 → por_debajo', clasificarPartida_(P(50, 100, 0)) === 'por_debajo');
    ok('plan>0, prod=0 → sin_produccion (nunca por_debajo con 0%)', clasificarPartida_(P(0, 100, 0)) === 'sin_produccion');
    ok('plan=0, prod>0 → sin_plan', clasificarPartida_(P(50, 0, 0)) === 'sin_plan');
    ok('plan=0, prod=0 → null (nada que decir)', clasificarPartida_(P(0, 0, 0)) === null);
  }

  console.log('\n== redactarResumen: NUNCA un total sumado, agrupación por clasificación (D218-A) ==');
  {
    const t = redactarResumen(indBase());
    ok('menciona Excavación y Terraplén como muy buena producción', /Excavación.*Terraplén.*tuvieron muy buena producción/.test(t) || /Excavación \(8\.509/.test(t), t);
    ok('menciona Subbase por debajo del plan con su cifra y %', /Subbase.*619.*56%.*quedó por debajo del plan/.test(t.replace(/\n/g, ' ')), t);
    ok('menciona Base\\/BTC sin producción y su plan', /Base\/BTC.*1\.297.*no registró producción/.test(t.replace(/\n/g, ' ')), t);
    ok('NO aparece ningún "16.649" (suma de las 4 partidas) ni "de plan total"', !/16[.,]?649/.test(t) && !/plan total/i.test(t), t);
    ok('NO aparece la frase de "mejor cumplimiento / más bajo" (ya va en la apertura)', !/mejor cumplimiento/.test(t), t);
  }
  {
    // Todas dentro de lo planeado (ninguna muy_buena/por_debajo)
    const ind = indBase({ principales: { excavacion: P(90, 100, 0), terraplen: P(80, 100, 0), subbase: P(0, 0, 0), base: P(0, 0, 0) } });
    const t = redactarResumen(ind);
    ok('grupo "dentro": ambas partidas, un solo verbo en plural', /Excavación.*Terraplén.*tuvieron una producción dentro de lo planeado/.test(t.replace(/\n/g, ' ')), t);
  }
  {
    // Sin plan cargado para una partida que sí produjo
    const ind = indBase({ principales: { excavacion: P(3000, 0, 0), terraplen: P(0, 0, 0), subbase: P(0, 0, 0), base: P(0, 0, 0) } });
    const t = redactarResumen(ind);
    ok('sin plan: "produjo X m³ (sin plan cargado…)"', /Excavación produjo 3\.000 m³ \(sin plan cargado/.test(t), t);
    ok('  · no inventa ningún % de cumplimiento', !/\d+% de cumplimiento/.test(t) && !/, \d+% del plan\)/.test(t), t);
  }
  {
    // Sin ningún dato en el rango (todas plan=0 y prod=0, sin registros de clima)
    const ind = indBase({
      principales: { excavacion: P(0, 0, 0), terraplen: P(0, 0, 0), subbase: P(0, 0, 0), base: P(0, 0, 0) },
      clima: { dias_rango: 4, dias_con_registro: 0, dias_lluvia: 0, horas_lluvia: null, horas_varada: null, por_clima: {} },
    });
    const t = redactarResumen(ind);
    ok('sin datos → texto de "no hay registros"', /no hay registros de producción/.test(t), t);
  }

  console.log('\n== lluvia sobre DÍAS CON REGISTRO, no sobre el rango calendario (D218-C) ==');
  {
    // 6 días de rango, solo 4 con registro; 2 de esos 4 con lluvia → 50% de los días CON REGISTRO (fuerte)
    // aunque sobre el rango completo (2/6=33%) también daría fuerte: se prueba con un caso donde difiere.
    const ind = indBase({
      desde: '2026-09-19', hasta: '2026-09-24',
      clima: { dias_rango: 6, dias_con_registro: 4, dias_lluvia: 1, horas_lluvia: null, horas_varada: null, por_clima: { LLUVIA: 1, SOLEADO: 3 } },
    });
    // 1/4 = 25% ≥ UMBRAL_LLUVIA_FUERTE(0.25) por días CON REGISTRO; 1/6=16.6% NO llegaría por días de rango.
    const t = redactarResumen(ind);
    ok('25% sobre dias_con_registro (no sobre dias_rango) activa la lluvia fuerte', /lluvia afectó la producción|pese a la lluvia/.test(t), t);
    ok('el detalle dice "de 4 días con lluvia" (denominador = dias_con_registro)', /de 4 días con lluvia/.test(t), t);
  }
  {
    // Con alguna partida por debajo y lluvia fuerte → "La lluvia afectó la producción"
    const t = redactarResumen(indBase()); // subbase por_debajo, base sin_produccion, sin lluvia en este caso base
    ok('sin lluvia relevante y alguna por debajo → "El rezago no se explica por el clima"', /El rezago no se explica por el clima/.test(t), t);
  }
  {
    const ind = indBase({ clima: { dias_rango: 4, dias_con_registro: 4, dias_lluvia: 2, horas_lluvia: 15, horas_varada: 2, por_clima: { LLUVIA: 2, SOLEADO: 2 } } });
    const t = redactarResumen(ind); // subbase por_debajo, base sin_produccion → alguna por debajo, lluvia 2/4=50%≥25%
    ok('lluvia fuerte + alguna partida por debajo → "La lluvia afectó la producción"', /La lluvia afectó la producción \(2 de 4 días con lluvia, 15 horas/.test(t), t);
  }
  {
    // Todo muy_buena/dentro (nada por debajo) con lluvia fuerte → "pese a la lluvia"
    const ind = indBase({
      principales: { excavacion: P(110, 100, 0), terraplen: P(90, 100, 0), subbase: P(0, 0, 0), base: P(0, 0, 0) },
      clima: { dias_rango: 4, dias_con_registro: 4, dias_lluvia: 3, horas_lluvia: null, horas_varada: null, por_clima: { LLUVIA: 3 } },
    });
    const t = redactarResumen(ind);
    ok('sin partida por debajo + lluvia fuerte → "El resultado se logró pese a la lluvia"', /pese a la lluvia \(3 de 4 días con lluvia\)/.test(t), t);
  }

  console.log('\n== D218-D: horas de lluvia/varada NULL (sin partes del rango) → el texto no las menciona ==');
  {
    const ind = indBase({
      clima: { dias_rango: 4, dias_con_registro: 4, dias_lluvia: 3, horas_lluvia: null, horas_varada: null, por_clima: { LLUVIA: 3 } },
      principales: { excavacion: P(110, 100, 0), terraplen: P(90, 100, 0), subbase: P(0, 0, 0), base: P(0, 0, 0) },
    });
    const t = redactarResumen(ind);
    ok('con horas_lluvia=null no aparece "horas de lluvia" en el texto', !/horas de lluvia/.test(t), t);
    ok('sí aparece "3 de 4 días con lluvia"', /3 de 4 días con lluvia/.test(t), t);
  }

  console.log('\n== D218-B: recorte al último día con datos → coletilla en la apertura ==');
  {
    const ind = indBase({ hasta: '2026-09-24', hasta_pedido: '2026-09-26' });
    const t = redactarResumen(ind);
    ok('la apertura avisa "se pidió hasta el 26 de septiembre de 2026"', /último día con datos; se pidió hasta el 26 de septiembre de 2026/.test(t), t);
    ok('la fecha final del texto es la efectiva (24), no la pedida (26)', /al 24 de septiembre de 2026 \(último día con datos/.test(t), t);
  }
  {
    // Sin coletilla cuando hasta_pedido === hasta (no hubo recorte)
    const t = redactarResumen(indBase({ hasta_pedido: '2026-09-24' }));
    ok('sin recorte real (hasta_pedido = hasta) → sin coletilla', !/se pidió hasta el/.test(t), t);
  }

  console.log('\n== periodo anterior POR PARTIDA (D218-A), solo partidas con prod_ant>0 ==');
  {
    const t = redactarResumen(indBase()); // excavacion 8509 vs 6500 (+31%), terraplen 7152 vs 4966 (+44%), subbase 619 vs 700 (-11.6%), base 0 vs 300 (var_pct null: prod=0 no es "producción")
    ok('menciona la variación de excavación (subió ~31%)', /excavación subió 31%/.test(t), t);
    ok('menciona la variación de terraplén (subió ~44%)', /terraplén (subió )?44%/.test(t), t);
    ok('menciona la variación de subbase (bajó ~12%)', /subbase bajó 12%/.test(t), t);
  }
  {
    // Ninguna partida con prod_ant>0 → se omite la frase de periodo anterior
    const ind = indBase({ principales: { excavacion: P(100, 100, 0), terraplen: P(0, 0, 0), subbase: P(0, 0, 0), base: P(0, 0, 0) } });
    const t = redactarResumen(ind);
    ok('sin ninguna partida comparable → sin frase de "periodo anterior"', !/periodo anterior/.test(t), t);
  }

  console.log('\n== drenajes y avance (sin cambios de forma) ==');
  {
    const ind = indBase({
      drenajes: { odt: { actividades: [{ actividad: 'Excavaciones varias', unidad: 'm3', cantidad: 320, dias: 10 }] }, odl: { actividades: [] }, otras: { actividades: [] } },
      avance: { partidas: { excavacion: { cumpl: 0.70 }, terraplen: { cumpl: 0.62 }, subbase: { cumpl: 0.40 }, base: { cumpl: 0.20 }, prestamo: { cumpl: 0.9 } }, global: { cumpl: 0.62 }, hasta: '2026-09-24' },
    });
    const t = redactarResumen(ind);
    ok('ODT con su actividad', /En drenaje transversal \(ODT\) se reportó Excavaciones varias \(320 m3\)/.test(t), t);
    ok('avance del contrato POR PARTIDA', /Avance del contrato al 24 de septiembre de 2026: excavación 70%, terraplén 62%, subbase 40% y base\/BTC 20%\./.test(t), t);
    ok('avance sin % global mezclado', !/llegó a 62%/.test(t), t);
  }

  console.log('\n== validarNumerosTexto: acepta texto fiel, rechaza cifra inventada ==');
  {
    const ind = indBase();
    const fiel = 'Del 21 al 24 de septiembre de 2026, Excavación (8.509 m³, 110% del plan) y Terraplén (7.152 m³, 110%) tuvieron muy buena producción; '
      + 'Subbase quedó por debajo del plan (619 m³, 56%) y Base/BTC no registró producción (plan 1.297 m³).';
    const r1 = validarNumerosTexto(fiel, ind);
    ok('texto fiel a las cifras por partida → válido', r1.ok === true, JSON.stringify(r1));

    const inventado = fiel + ' En total se produjeron 16.649 m³, un récord histórico.';
    const r2 = validarNumerosTexto(inventado, ind);
    ok('texto que INVENTA un total sumado (16.649, no está en ninguna cifra del JSON) → rechazado', r2.ok === false && r2.cifra, JSON.stringify(r2));

    const conTolerancia = 'Excavación produjo 8.510 m³ (110% del plan de 7.734 m³).';
    const r3 = validarNumerosTexto(conTolerancia, ind);
    ok('tolerancia de redondeo ±1', r3.ok === true, JSON.stringify(r3));
  }

  console.log('\n== textoDeRespuestaIA: formatos de Workers AI (el «[object Object]» de producción) ==');
  {
    const T = 'Del 21 al 24 de septiembre de 2026, la excavación tuvo muy buena producción.';
    ok('{response:"…"}', textoDeRespuestaIA({ response: T }) === T);
    ok('formato OpenAI choices[0].message.content', textoDeRespuestaIA({ choices: [{ message: { role: 'assistant', content: T } }] }) === T);
    ok('content como lista de partes', textoDeRespuestaIA({ choices: [{ message: { content: [{ type: 'text', text: T }] } }] }) === T);
    ok('anidado en result', textoDeRespuestaIA({ result: { response: T } }) === T);
    ok('objeto sin texto → "" (cae a reglas, nunca «[object Object]»)', textoDeRespuestaIA({ response: { foo: 1 } }) === '' && textoDeRespuestaIA({}) === '' && textoDeRespuestaIA(null) === '');
    ok('«[object Object]» literal → ""', textoDeRespuestaIA({ response: '[object Object] y algo más de texto para pasar el largo mínimo' }) === '');
  }

  console.log('\n' + (fallos ? '✗ ' + fallos + ' fallo(s) de ' + casos : '✓ ' + casos + ' comprobaciones OK'));
  process.exit(fallos ? 1 : 0);
}
main().catch(function (err) { console.error(err && err.stack || err); process.exit(2); });
