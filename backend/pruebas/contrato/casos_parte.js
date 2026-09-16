/**
 * Contrato del Parte Digital (CodigoParte.gs, D165–D178): ?mod=parte&op=… sobre la URL de OBRA.
 * `equipo` y `reporte` son públicos (la identidad es el código del equipo); `bandeja`, `base`, `revisar`
 * y `repartir` exigen token y rol de revisión. Es el módulo que migra primero (Fase 2), así que este
 * archivo es el que más se va a usar contra el backend nuevo.
 */
'use strict';
const { tiene, faltan, esFecha, esLista } = require('./arnes');

async function equipoDePrueba(api, t){
  // vm: VOL048 (KM) de la semilla. url: el primer equipo con ficha que devuelva la lista del selector.
  const lista = await api.parte.get({ op: 'equipo' });
  if (!lista.ok || !esLista(lista.equipos) || !lista.equipos.length) t.omitir('sin equipos en PARTE_EQUIPOS');
  const cod = api.modo === 'vm' ? 'VOL048' : lista.equipos[0].codigo;
  const q = await api.parte.get({ op: 'equipo', eq: cod });
  if (!q.ok) t.omitir('el equipo ' + cod + ' no responde: ' + JSON.stringify(q).slice(0, 120));
  return q;
}
function tramo(api, q, o){
  const ini = (q.ultimo && typeof q.ultimo.final === 'number') ? q.ultimo.final : 100;
  return Object.assign({ id_registro: api.uuid(), fecha: api.FECHA_BANCO, reporte_num: '0501', operador: q.operadores[0] || 'Operador Contrato',
    inicial: ini, final: ini + 5, hora_de: '07:00', hora_a: '15:30', centro_coste: (q.cc[0] && q.cc[0].centro_coste) || '3701.02.11', pr: 14400,
    descripcion_trabajo: 'Prueba de contrato', observaciones: 'arnés de contrato' }, o || {});
}

module.exports = [
  { id: 'parte.equipo.lista', modulo: 'parte', nombre: 'GET op=equipo sin eq → {ok, equipo:null, equipos[], hoy}',
    async run(api, t){ const r = await api.parte.get({ op: 'equipo' });
      t.ok('forma', r.ok === true && r.equipo === null && esLista(r.equipos) && esFecha(r.hoy), r);
      if (r.equipos.length) t.ok('cada equipo: codigo, tipo, placa, en_flota (D173b)', tiene(r.equipos[0], ['codigo', 'tipo', 'placa', 'en_flota']), r.equipos[0]);
      t.ok('primero los vigentes en la flota, después el resto de fichas', r.equipos.every((e, i, l) => i === 0 || !e.en_flota || l[i-1].en_flota), r.equipos.map(e => [e.codigo, e.en_flota]));
      if (api.modo === 'vm') t.ok('semilla: VOL048 y MO004 vigentes (MAQUINAS, frente UF1-UF2); BL002 solo ficha', r.equipos.some(e => e.codigo === 'VOL048' && e.en_flota) && r.equipos.some(e => e.codigo === 'MO004' && e.en_flota) && r.equipos.some(e => e.codigo === 'BL002' && !e.en_flota), r.equipos.map(e => [e.codigo, e.en_flota])); } },

  { id: 'parte.equipo.desconocido', modulo: 'parte', nombre: 'GET op=equipo&eq=ZZZ999 → ok:false con la lista para elegir',
    async run(api, t){ const r = await api.parte.get({ op: 'equipo', eq: 'ZZZ999' });
      t.ok('ok:false, error con el código, equipos[]', r.ok === false && /ZZZ999/.test(String(r.error)) && esLista(r.equipos), r); } },

  { id: 'parte.equipo.ficha', modulo: 'parte', nombre: 'GET op=equipo&eq=<código> → equipo, ultimo, operadores, cc, sugerencias, actividades{habituales≤5, todas}, topes, hoy (D174/D178)',
    async run(api, t){ const q = await equipoDePrueba(api, t);
      const claves = ['equipo', 'ultimo', 'operadores', 'cc', 'sugerencias', 'actividades', 'topes', 'hoy'];
      t.ok('forma', tiene(q, claves), faltan(q, claves));
      t.ok('equipo{codigo,tipo,placa,proveedor,medidor,activo,en_flota}', tiene(q.equipo, ['codigo', 'tipo', 'placa', 'proveedor', 'medidor', 'activo', 'en_flota']), q.equipo);
      t.ok('operadores[] es una lista de nombres y cc[] trae centro_coste/proyecto/descripcion_cc', esLista(q.operadores) && q.operadores.every(o => typeof o === 'string') && esLista(q.cc) && (!q.cc.length || tiene(q.cc[0], ['centro_coste', 'proyecto', 'descripcion_cc'])), q.cc[0]);
      t.ok('pseudo-CC Taller/Disponible/Domingo-Festivo siempre presentes', ['Taller', 'Disponible', 'Domingo/Festivo'].every(p => q.cc.some(c => c.centro_coste === p)), q.cc.map(c => c.centro_coste).slice(-5));
      t.ok('actividades.habituales ≤ 5 y todas[]', q.actividades && esLista(q.actividades.habituales) && q.actividades.habituales.length <= 5 && esLista(q.actividades.todas), q.actividades && q.actividades.habituales.length);
      t.ok('topes HOROMETRO y KM con bloquea/alerta', q.topes && q.topes.HOROMETRO && q.topes.KM && q.topes.KM.bloquea === 700, q.topes);
      t.ok('ítems normalizados a dos dígitos (D178)', q.actividades.todas.every(a => /^\d\d\.\d\d$/.test(a.item) || /^[A-Z]/.test(a.item)), q.actividades.todas.map(a => a.item));
      if (api.modo === 'vm'){ t.ok('semilla: ítem 2.1 (número en la hoja) sale «02.10»', q.actividades.habituales.some(a => a.item === '02.10'), q.actividades.habituales.map(a => a.item));
        t.ok('semilla: alias de operador fundido (Wilmar Pawana → Wilmar Pahuana)', q.operadores.indexOf('Wilmar Pahuana') >= 0 && q.operadores.indexOf('Wilmar Pawana') < 0, q.operadores); } } },

  { id: 'parte.reporte.payload', modulo: 'parte', nombre: 'POST op=reporte: tramos no lista / inicial no numérico / hora imposible → error:payload; sin ficha → error:equipo',
    async run(api, t){ const q = await equipoDePrueba(api, t); const cod = q.equipo.codigo;
      let r = await api.parte.post({ op: 'reporte', codigo: cod, tramos: 'no' });
      t.ok('tramos no lista → payload/tramos', r.ok === false && r.error === 'payload' && r.campo === 'tramos', r);
      r = await api.parte.post({ op: 'reporte', codigo: cod, tramos: [tramo(api, q, { inicial: 'abc' })] });
      t.ok('inicial no numérico → payload/tramos[0].inicial', r.error === 'payload' && r.campo === 'tramos[0].inicial', r);
      r = await api.parte.post({ op: 'reporte', codigo: cod, tramos: [tramo(api, q, { hora_de: 'siete' })] });
      t.ok('hora sin formato HH:MM → payload/tramos[0].hora_de', r.error === 'payload' && r.campo === 'tramos[0].hora_de', r);
      r = await api.parte.post({ op: 'reporte', codigo: 'ZZZ999', tramos: [tramo(api, q)] });
      t.ok('código sin ficha → error:"equipo" con detalle', r.ok === false && r.error === 'equipo' && /ZZZ999/.test(String(r.detalle)), r);
      r = await api.parte.post({ op: 'reporte', codigo: cod, tramos: [] });
      t.ok('sin tramos → «llegó sin tramos»', r.ok === false && /sin tramos/.test(String(r.error)), r); } },

  { id: 'parte.ciclo', modulo: 'parte', escribe: true, nombre: 'reporte (público) → pendiente en bandeja (token) → revisar descartado → base la lista; el reenvío cuenta duplicadas (D82)',
    async run(api, t){ const q = await equipoDePrueba(api, t); const cod = q.equipo.codigo; const tr = tramo(api, q);
      const r1 = await api.parte.post({ op: 'reporte', codigo: cod, tramos: [tr] });
      t.ok('1º envío: ok, guardadas:1, duplicadas:0, equipo{codigo,tipo,placa,medidor}', r1.ok === true && r1.guardadas === 1 && r1.duplicadas === 0 && tiene(r1.equipo, ['codigo', 'tipo', 'placa', 'medidor']), r1);
      t.ok('filas[0] (resumen para el formulario): id_registro eco, fecha, total 5, uf derivada del CC, alertas[]', esLista(r1.filas) && r1.filas[0].id_registro === tr.id_registro && r1.filas[0].fecha === api.FECHA_BANCO && r1.filas[0].total === 5 && typeof r1.filas[0].uf === 'string' && esLista(r1.filas[0].alertas), r1.filas && r1.filas[0]);
      const r2 = await api.parte.post({ op: 'reporte', codigo: cod, tramos: [tr] });
      t.ok('reenvío idéntico: guardadas:0, duplicadas:1', r2.ok === true && r2.guardadas === 0 && r2.duplicadas === 1, r2);
      const sinTok = await api.parte.get({ op: 'bandeja', fecha: api.FECHA_BANCO });
      t.ok('bandeja sin token → auth:false genérico', sinTok.ok === false && sinTok.auth === false && sinTok.error === api.MENSAJE_AUTH, sinTok);
      const tok = await api.sesion('admin');
      const b = await api.parte.get({ op: 'bandeja', fecha: api.FECHA_BANCO, token: tok });
      const claves = ['fecha', 'pendientes', 'revisadas', 'faltantes', 'flota_fuente', 'listas', 'topes'];
      t.ok('bandeja: forma', b.ok === true && tiene(b, claves) && esLista(b.pendientes) && esLista(b.revisadas) && esLista(b.faltantes) && b.listas && esLista(b.listas.equipos), faltan(b, claves));
      const mia = b.pendientes.find(f => f.id_registro === tr.id_registro);
      t.ok('la fila está en pendientes con el CC normalizado, estado pendiente y origen qr', !!mia && mia.centro_coste === tr.centro_coste && mia.estado === 'pendiente' && mia.origen === 'qr', mia || b.pendientes.map(f => f.id_registro));
      t.ok('la fila de bandeja trae las 27 columnas de PARTE_BANDEJA (parteFilaSalida_)', !!mia && Object.keys(mia).length === 27 && mia.hora_de === '07:00' && mia.operador === tr.operador, mia && Object.keys(mia).length);
      t.ok('el equipo ya no está en faltantes', !b.faltantes.some(f => f.codigo === cod), b.faltantes.map(f => f.codigo));
      const rv = await api.parte.post({ op: 'revisar', token: tok, cambios: [{ id_registro: tr.id_registro, estado: 'descartado', campos: { observaciones: 'descartada por el arnés de contrato' } }, { id_registro: 'no-existe-' + api.uuid(), estado: 'aprobado' }] });
      t.ok('revisar: cambiadas:1, errores:[{no existe}]', rv.ok === true && rv.cambiadas === 1 && esLista(rv.errores) && rv.errores.length === 1 && rv.errores[0].error === 'no existe', rv);
      t.ok('la fila cambiada vuelve con estado, revisado_por y revisado_ts', rv.filas[0].estado === 'descartado' && typeof rv.filas[0].revisado_por === 'string' && rv.filas[0].revisado_por.length > 0 && !!rv.filas[0].revisado_ts, rv.filas[0]);
      const b2 = await api.parte.get({ op: 'bandeja', fecha: api.FECHA_BANCO, token: tok });
      t.ok('ahora está en revisadas como descartado (nunca se borra)', b2.revisadas.some(f => f.id_registro === tr.id_registro && f.estado === 'descartado'), b2.revisadas.map(f => [f.id_registro, f.estado]));
      const base = await api.parte.get({ op: 'base', desde: api.FECHA_BANCO, hasta: api.FECHA_BANCO, estado: 'todos', token: tok });
      t.ok('base estado=todos: filas[], excel{primera, ultima, columnas, mapa, filas}, listas', base.ok === true && esLista(base.filas) && base.excel && tiene(base.excel, ['primera', 'ultima', 'columnas', 'mapa', 'filas']) && base.listas, base && Object.keys(base));
      t.ok('base la incluye', base.filas.some(f => f.id_registro === tr.id_registro), base.filas.length);
      const apr = await api.parte.get({ op: 'base', desde: api.FECHA_BANCO, hasta: api.FECHA_BANCO, token: tok });
      t.ok('base por defecto (aprobado) NO la incluye', apr.ok === true && !apr.filas.some(f => f.id_registro === tr.id_registro), apr.filas.length);
      const rr = await api.parte.post({ op: 'revisar', token: tok, cambios: [{ id_registro: tr.id_registro, campos: { inicial: 100, final: 50 } }] });
      t.ok('revisar final<inicial → error en errores[], cambiadas:0', rr.ok === true && rr.cambiadas === 0 && rr.errores[0].error === 'final menor que inicial', rr); } },

  { id: 'parte.reparto', modulo: 'parte', escribe: true, nombre: 'reporte con reparto 50/50 → dos filas encadenadas (-r1/-r2); op=repartir desde revisión (D178) descarta la original',
    async run(api, t){ const q = await equipoDePrueba(api, t); const cod = q.equipo.codigo; const cc2 = (q.cc[1] && q.cc[1].centro_coste) || 'Taller';
      const tr = tramo(api, q, { final: undefined }); tr.final = tr.inicial + 10; tr.hora_a = '17:00';
      tr.reparto = [{ centro_coste: tr.centro_coste, pct: 50 }, { centro_coste: cc2, pct: 50 }];
      const r = await api.parte.post({ op: 'reporte', codigo: cod, tramos: [tr] });
      t.ok('guardadas:2', r.ok === true && r.guardadas === 2, r);
      t.ok('ids <id>-r1 y <id>-r2', r.filas[0].id_registro === tr.id_registro + '-r1' && r.filas[1].id_registro === tr.id_registro + '-r2', r.filas.map(f => f.id_registro));
      const tok = await api.sesion('admin');
      const b = await api.parte.get({ op: 'bandeja', fecha: api.FECHA_BANCO, token: tok });
      const h1 = b.pendientes.find(f => f.id_registro === tr.id_registro + '-r1'), h2 = b.pendientes.find(f => f.id_registro === tr.id_registro + '-r2');
      t.ok('encadenadas: r1 termina en inicial+5, r2 arranca ahí y cierra exacto en el final', !!h1 && !!h2 && h1.inicial === tr.inicial && h1.final === tr.inicial + 5 && h2.inicial === tr.inicial + 5 && h2.final === tr.final, [h1 && [h1.inicial, h1.final], h2 && [h2.inicial, h2.final]]);
      t.ok('horas prorrateadas (07:00–12:00 · 12:00–17:00) y marca [Reparto 50 % · 1/2]', !!h1 && h1.hora_de === '07:00' && h1.hora_a === '12:00' && h2.hora_de === '12:00' && h2.hora_a === '17:00' && /\[Reparto 50 % · 1\/2\]/.test(h1.observaciones), h1 && [h1.hora_de, h1.hora_a, h1.observaciones]);
      const rp = await api.parte.post({ op: 'repartir', token: tok, id_registro: tr.id_registro + '-r1', reparto: [{ centro_coste: tr.centro_coste, pct: 70 }, { centro_coste: cc2, pct: 30 }] });
      t.ok('repartir: ok, original descartada con [Repartido en 2 filas], 2 hijas pendientes', rp.ok === true && rp.original.estado === 'descartado' && /Repartido en 2 filas/.test(rp.original.observaciones) && rp.filas.length === 2 && rp.filas.every(f => f.estado === 'pendiente'), rp);
      const s = await api.parte.post({ op: 'repartir', token: tok, id_registro: tr.id_registro + '-r1', reparto: [{ centro_coste: 'Taller', pct: 100 }] });
      t.ok('una fila descartada no se reparte', s.ok === false, s);
      const bad = await api.parte.post({ op: 'repartir', token: tok, id_registro: tr.id_registro + '-r2', reparto: [{ centro_coste: 'Taller', pct: 60 }] });
      t.ok('reparto que no suma 100 → ok:false', bad.ok === false, bad);
      // limpieza: las hijas y la -r2 quedan descartadas
      const ids = rp.filas.map(f => f.id_registro).concat([tr.id_registro + '-r2']);
      const lim = await api.parte.post({ op: 'revisar', token: tok, cambios: ids.map(id => ({ id_registro: id, estado: 'descartado' })) });
      t.ok('limpieza: las 3 quedan descartadas', lim.ok === true && lim.cambiadas === 3, lim); } },

  { id: 'parte.revisar.permisos', modulo: 'parte', nombre: 'op=revisar sin token → auth:false; capataz (sin rol de revisión) → sin permiso',
    async run(api, t){ const r = await api.parte.post({ op: 'revisar', cambios: [] });
      t.ok('sin token → auth:false genérico', r.ok === false && r.auth === false && r.error === api.MENSAJE_AUTH, r);
      if (api.modo === 'vm'){ const c = await api.parte.post({ op: 'revisar', token: await api.sesion('capataz'), cambios: [{ id_registro: 'x', estado: 'aprobado' }] });
        t.ok('capataz → ok:false sin permiso', c.ok === false && !c.cambiadas, c);
        const j = await api.parte.get({ op: 'bandeja', fecha: api.hoy, token: await api.sesion('jefe') });
        t.ok('jefe tampoco ve la bandeja del parte', j.ok === false, j); } } },

  { id: 'parte.op_desconocida', modulo: 'parte', nombre: 'op desconocida con token → {ok:false, error:"op desconocida: …"}',
    async run(api, t){ const r = await api.parte.get({ op: 'nada', token: await api.sesion('admin') });
      t.ok('rechazo', r.ok === false && /op desconocida/.test(String(r.error)), r); } },

  { id: 'parte.rate_limit', modulo: 'parte', soloVm: true, nombre: '21º envío del mismo equipo en una hora → rate_limit sin tocar la hoja (D166)',
    async run(api, t){ const q = await api.parte.get({ op: 'equipo', eq: 'MO004' }); let u = null;   // MO004: sin envíos previos en esta corrida
      for (let i = 0; i < 20; i++) u = await api.parte.post({ op: 'reporte', codigo: q.equipo.codigo, tramos: [tramo(api, q, { inicial: 100 + i * 10, final: 105 + i * 10 })] });
      t.ok('20 envíos pasan', u.ok === true, u);
      const esc = api.hojas.obra.PARTE_BANDEJA._escrituras;
      const r = await api.parte.post({ op: 'reporte', codigo: q.equipo.codigo, tramos: [tramo(api, q)] });
      t.ok('el 21º → rate_limit y la hoja no se toca', r.ok === false && r.error === 'rate_limit' && api.hojas.obra.PARTE_BANDEJA._escrituras === esc, r); } }
];
