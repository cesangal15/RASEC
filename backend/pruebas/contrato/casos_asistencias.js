/**
 * Contrato de /asistencias (CodigoAsistencias.gs): todo con token emitido por OBRA (AUTH_EMISOR=false aquí).
 * Las escrituras usan FECHA_BANCO y se limpian solas: reenviar la cuadrilla con filas:[] borra el bloque
 * (upsert D03/D107) y extras_admin_delete borra el día.
 */
'use strict';
const { tiene, faltan, esFecha, esLista } = require('./arnes');

module.exports = [
  { id: 'asis.ping', modulo: 'asistencias', nombre: 'GET sin action con token → API Asistencias viva',
    async run(api, t){ const r = await api.asistencias.get({ token: await api.sesion('admin') });
      t.ok('ok + msg + _ms', r.ok === true && /Asistencias viva/.test(String(r.msg)) && typeof r._ms === 'number', r); } },

  { id: 'asis.auth.sin_token', modulo: 'asistencias', nombre: 'lectura sin token → auth:false genérico (D166)',
    async run(api, t){ const r = await api.asistencias.get({ action: 'roster' });
      t.ok('auth:false con el mensaje genérico', r.ok === false && r.auth === false && r.error === api.MENSAJE_AUTH, r); } },

  { id: 'asis.auth.token_obra', modulo: 'asistencias', nombre: 'el token emitido por OBRA vale aquí (mismo secreto, D109)',
    async run(api, t){ const r = await api.asistencias.get({ action: 'roster', fecha: api.hoy, token: await api.sesion('admin') });
      t.ok('ok:true', r.ok === true, r); } },

  { id: 'asis.roster', modulo: 'asistencias', nombre: 'GET roster[&fecha] → cuadrillas[], personas[], config, festivos, jornada, catCC, catCCUsados, catMotivos, recientesCC, turnos',
    async run(api, t){ const r = await api.asistencias.get({ action: 'roster', fecha: api.hoy, token: await api.sesion('admin') });
      const claves = ['cuadrillas', 'personas', 'config', 'festivos', 'jornada', 'catCC', 'catCCUsados', 'catMotivos', 'recientesCC', 'turnos'];
      t.ok('forma', r.ok === true && tiene(r, claves) && esLista(r.cuadrillas) && esLista(r.personas) && esLista(r.catCC), faltan(r, claves));
      if (r.personas.length) t.ok('cada persona: cedula, codigo, nombre, cargo, cuadrilla', tiene(r.personas[0], ['cedula', 'codigo', 'nombre', 'cargo', 'cuadrilla']), r.personas[0]);
      if (api.modo === 'vm'){ t.ok('semilla: admin ve ANGEL y EDUARDO, no ARIEL (inactiva, D84)', r.cuadrillas.indexOf('ANGEL') >= 0 && r.cuadrillas.indexOf('EDUARDO') >= 0 && r.cuadrillas.indexOf('ARIEL') < 0, r.cuadrillas);
        t.ok('semilla: 3 personas activas', r.personas.length === 3, r.personas.length); } } },

  { id: 'asis.asistencia.sin_fecha', modulo: 'asistencias', nombre: 'GET asistencia sin fecha → ok:false con mensaje (D106)',
    async run(api, t){ const r = await api.asistencias.get({ action: 'asistencia', token: await api.sesion('admin') });
      t.ok('rechazo explícito', r.ok === false && /fecha/i.test(String(r.error)), r); } },

  { id: 'asis.asistencia.dia', modulo: 'asistencias', nombre: 'GET asistencia&fecha → filas compactas + cuadrillas, faltantes, jornada, catálogos, notas, areas (D133)',
    async run(api, t){ const r = await api.asistencias.get({ action: 'asistencia', fecha: api.FECHA_BANCO, token: await api.sesion('admin') });
      const claves = ['fecha', 'filas', 'cuadrillas', 'faltantes', 'eventuales', 'jornada', 'catCC', 'catCCv', 'catCCUsados', 'catMotivos', 'turnos', 'extrasAdmin', 'notas', 'config', 'festivos', 'areas'];
      t.ok('forma', r.ok === true && r.fecha === api.FECHA_BANCO && tiene(r, claves), faltan(r, claves));
      t.ok('filas y faltantes compactadas {cols, datos} (D133)', r.filas && esLista(r.filas.cols) && esLista(r.filas.datos) && r.faltantes && esLista(r.faltantes.cols) && esLista(r.faltantes.datos), r.filas && Object.keys(r.filas));
      t.ok('cols de filas en el orden que la pantalla compara', JSON.stringify(r.filas.cols) === JSON.stringify(['_row', 'fecha', 'reporta', 'cuadrilla', 'codigo', 'cedula', 'nombre', 'cargo', 'cc', 'proyecto', 'hora_entrada', 'hora_salida', 'presente', 'motivo_ausencia', 'turno']), r.filas.cols);
      const c = await api.asistencias.get({ action: 'asistencia', fecha: api.FECHA_BANCO, ccv: r.catCCv, token: await api.sesion('admin') });
      t.ok('con &ccv= igual no viaja catCC (D133)', c.ok === true && !tiene(c, ['catCC']), Object.keys(c).indexOf('catCC')); } },

  { id: 'asis.personal', modulo: 'asistencias', nombre: 'GET personal → {ok, personal[], cuadrillas[]}',
    async run(api, t){ const r = await api.asistencias.get({ action: 'personal', token: await api.sesion('admin') });
      t.ok('forma', r.ok === true && esLista(r.personal) && esLista(r.cuadrillas), r);
      if (r.personal.length) t.ok('cada persona con _row, codigo, cedula, nombre, cuadrilla, estado, fecha_ingreso, fecha_retiro', tiene(r.personal[0], ['_row', 'codigo', 'cedula', 'nombre', 'cuadrilla', 'estado', 'fecha_ingreso', 'fecha_retiro']), r.personal[0]); } },

  { id: 'asis.export', modulo: 'asistencias', nombre: 'GET export&fecha → filas, proyectoDefecto, catTrabajadores, config, festivos, turnos, extrasAdmin (Navision, D72)',
    async run(api, t){ const r = await api.asistencias.get({ action: 'export', fecha: api.FECHA_BANCO, token: await api.sesion('admin') });
      const claves = ['fecha', 'filas', 'proyectoDefecto', 'catTrabajadores', 'config', 'festivos', 'turnos', 'extrasAdmin'];
      t.ok('forma', r.ok === true && tiene(r, claves) && esLista(r.filas), faltan(r, claves));
      const s = await api.asistencias.get({ action: 'export', token: await api.sesion('admin') });
      t.ok('sin fecha → rechazo (D106)', s.ok === false && /fecha/i.test(String(s.error)), s); } },

  { id: 'asis.ausencias', modulo: 'asistencias', nombre: 'GET ausencias&desde&hasta → dias, filas, sinReportar, catMotivos; rango invertido → error (D94)',
    async run(api, t){ const tok = await api.sesion('admin');
      const r = await api.asistencias.get({ action: 'ausencias', desde: api.FECHA_BANCO, hasta: '2020-01-14', token: tok });
      t.ok('forma', r.ok === true && r.dias === 2 && esLista(r.filas) && esLista(r.sinReportar) && esLista(r.catMotivos), r);
      const i = await api.asistencias.get({ action: 'ausencias', desde: '2020-01-14', hasta: api.FECHA_BANCO, token: tok });
      t.ok('invertido → ok:false', i.ok === false && /invertido/.test(String(i.error)), i);
      const l = await api.asistencias.get({ action: 'ausencias', desde: '2020-01-01', hasta: '2021-01-01', token: tok });
      t.ok('más de 186 días → «demasiado largo»', l.ok === false && /largo/.test(String(l.error)), l); } },

  { id: 'asis.persona', modulo: 'asistencias', nombre: 'GET persona&codigo&desde&hasta → persona, filas, dias (D112); sin código → error',
    async run(api, t){ const tok = await api.sesion('admin');
      const s = await api.asistencias.get({ action: 'persona', desde: api.FECHA_BANCO, hasta: api.FECHA_BANCO, token: tok });
      t.ok('sin código ni cédula → ok:false', s.ok === false && /código/.test(String(s.error)), s);
      const r = await api.asistencias.get({ action: 'persona', codigo: '75781', desde: api.FECHA_BANCO, hasta: api.FECHA_BANCO, token: tok });
      t.ok('forma', r.ok === true && r.dias === 1 && tiene(r, ['persona', 'filas']) && esLista(r.filas), r); } },

  { id: 'asis.persona_admin', modulo: 'asistencias', nombre: 'GET persona_admin (rol admin) → esAdmin:true, dias, filas (D142); otro rol → rechazo',
    async run(api, t){ const r = await api.asistencias.get({ action: 'persona_admin', desde: api.FECHA_BANCO, hasta: api.FECHA_BANCO, token: await api.sesion('admin') });
      t.ok('admin: ok, esAdmin:true, dias:1', r.ok === true && r.esAdmin === true && r.dias === 1, r);
      if (api.modo === 'vm'){ const c = await api.asistencias.get({ action: 'persona_admin', desde: api.FECHA_BANCO, hasta: api.FECHA_BANCO, token: await api.sesion('capataz') });
        t.ok('capataz → ok:false', c.ok === false, c); } } },

  { id: 'asis.extras_admin.dia', modulo: 'asistencias', nombre: 'GET extras_admin&fecha → {ok, fecha, registro:null|{…}} (D73)',
    async run(api, t){ const r = await api.asistencias.get({ action: 'extras_admin', fecha: api.FECHA_BANCO, token: await api.sesion('admin') });
      t.ok('forma', r.ok === true && r.fecha === api.FECHA_BANCO && tiene(r, ['registro']), r);
      const a = await api.asistencias.get({ action: 'extras_admin_dia', fecha: api.FECHA_BANCO, token: await api.sesion('admin') });
      t.ok('alias extras_admin_dia responde igual', a.ok === true && tiene(a, ['registro']), a); } },

  { id: 'asis.post.desconocida', modulo: 'asistencias', nombre: 'POST action desconocida → {ok:false, error:"acción no reconocida"}',
    async run(api, t){ const r = await api.asistencias.post({ token: await api.sesion('admin'), action: 'nada' });
      t.ok('rechazo exacto', r.ok === false && r.error === 'acción no reconocida', r); } },

  { id: 'asis.reporte.payload', modulo: 'asistencias', nombre: 'POST reporte_asistencia: fecha futura / hora mal formada / filas no lista → error:payload (D166)',
    async run(api, t){ const tok = await api.sesion('admin');
      let r = await api.asistencias.post({ token: tok, action: 'reporte_asistencia', fecha: '2999-01-01', cuadrilla: 'X', filas: [] });
      t.ok('fecha futura → payload/fecha', r.ok === false && r.error === 'payload' && r.campo === 'fecha', r);
      r = await api.asistencias.post({ token: tok, action: 'reporte_asistencia', fecha: api.FECHA_BANCO, cuadrilla: 'X', filas: 'no' });
      t.ok('filas no lista → payload/filas', r.error === 'payload' && r.campo === 'filas', r);
      r = await api.asistencias.post({ token: tok, action: 'reporte_asistencia', fecha: api.FECHA_BANCO, cuadrilla: 'X', filas: [{ codigo: '1', hora_entrada: 'siete' }] });
      t.ok('hora sin formato HH:MM → payload/filas[0].hora_entrada', r.error === 'payload' && r.campo === 'filas[0].hora_entrada', r);
      r = await api.asistencias.post({ token: tok, action: 'extras_admin', fecha: api.FECHA_BANCO, cc: '3701.02.05| X', horas: 1, tipo: 'rara' });
      t.ok('extras_admin tipo fuera de lista → payload/tipo', r.error === 'payload' && r.campo === 'tipo', r); } },

  { id: 'asis.reporte.ciclo', modulo: 'asistencias', escribe: true, nombre: 'reporte_asistencia (upsert fecha+cuadrilla, D03/D107): guarda, se lee en asistencia&fecha, y filas:[] borra el bloque',
    async run(api, t){ const tok = await api.sesion('admin');
      const ro = await api.asistencias.get({ action: 'roster', fecha: api.hoy, token: tok });
      if (!ro.ok || !ro.cuadrillas.length) t.omitir('el usuario no tiene cuadrillas en roster');
      const cuadrilla = ro.cuadrillas[0], codigo = 'CONTRATO-1';
      const fila = { codigo, cedula: '', nombre: 'PRUEBA CONTRATO', cargo: 'AYUDANTE', cuadrilla, cc: '3701.02.05| EXCAVACION', proyecto: '3701', hora_entrada: '07:00', hora_salida: '15:30', presente: 'Si', motivo_ausencia: '', observacion: 'fila del arnés de contrato', turno: '1' };
      const g = await api.asistencias.post({ token: tok, action: 'reporte_asistencia', fecha: api.FECHA_BANCO, cuadrilla, reporta: 'admin', nota: '', filas: [fila, fila] });
      t.ok('guarda: ok, filas:1 (la persona repetida en el envío se deduplica, D119)', g.ok === true && g.filas === 1, g);
      const d = await api.asistencias.get({ action: 'asistencia', fecha: api.FECHA_BANCO, token: tok });
      const iCod = d.filas.cols.indexOf('codigo'), iCua = d.filas.cols.indexOf('cuadrilla'), iHe = d.filas.cols.indexOf('hora_entrada');
      const mia = d.filas.datos.find(r => r[iCod] === codigo);
      t.ok('asistencia&fecha trae la fila con cuadrilla y hora_entrada verbatim', !!mia && mia[iCua] === cuadrilla && mia[iHe] === '07:00', mia || d.filas.datos.length);
      const p = await api.asistencias.get({ action: 'persona', codigo, desde: api.FECHA_BANCO, hasta: api.FECHA_BANCO, token: tok });
      t.ok('persona&codigo la encuentra ese día', p.ok === true && esLista(p.filas) && p.filas.length === 1, p.filas);
      const b = await api.asistencias.post({ token: tok, action: 'reporte_asistencia', fecha: api.FECHA_BANCO, cuadrilla, reporta: 'admin', nota: '', filas: [] });
      t.ok('reenvío con filas:[] → ok, filas:0', b.ok === true && b.filas === 0, b);
      const d2 = await api.asistencias.get({ action: 'asistencia', fecha: api.FECHA_BANCO, token: tok });
      t.ok('el bloque fecha+cuadrilla quedó borrado', !d2.filas.datos.some(r => r[iCod] === codigo), d2.filas.datos.length); } },

  { id: 'asis.extras.ciclo', modulo: 'asistencias', escribe: true, perfil: 'admin', nombre: 'extras_admin (upsert por fecha) → extras_admin&fecha lo devuelve → extras_admin_delete lo borra (D73)',
    async run(api, t){ const tok = await api.sesion('admin');
      const g = await api.asistencias.post({ token: tok, action: 'extras_admin', fecha: api.FECHA_BANCO, cc: '3701.02.05| EXCAVACION', horas: 1, tipo: 'diurna' });
      t.ok('guarda: ok, proyecto derivado del CC = 3701', g.ok === true && g.proyecto === '3701', g);
      const g2 = await api.asistencias.post({ token: tok, action: 'extras_admin', fecha: api.FECHA_BANCO, cc: '3702.02.05| EXCAVACION', horas: 1.5, tipo: 'diurna' });
      t.ok('re-guardar el mismo día pisa (proyecto 3702)', g2.ok === true && g2.proyecto === '3702', g2);
      const l = await api.asistencias.get({ action: 'extras_admin', fecha: api.FECHA_BANCO, token: tok });
      t.ok('lectura: un solo registro con horas 1.5 y tipo diurna', l.ok === true && l.registro && Number(l.registro.horas) === 1.5 && l.registro.tipo === 'diurna', l.registro);
      const x = await api.asistencias.post({ token: tok, action: 'extras_admin', fecha: api.FECHA_BANCO, cc: '3701.02.05| X', horas: 9, tipo: 'diurna' });
      t.ok('9 h en día normal → rechazo por tope (CONFIG max_extras_dia, D124)', x.ok === false && /máximo/.test(String(x.error)), x);
      const b = await api.asistencias.post({ token: tok, action: 'extras_admin_delete', fecha: api.FECHA_BANCO });
      t.ok('borrar: ok, borradas:1', b.ok === true && b.borradas === 1, b);
      const l2 = await api.asistencias.get({ action: 'extras_admin', fecha: api.FECHA_BANCO, token: tok });
      t.ok('ya no hay registro', l2.ok === true && l2.registro === null, l2); } },

  { id: 'asis.personal.guard', modulo: 'asistencias', nombre: 'POST personal: op fuera de lista → payload/op; capataz → no autorizado',
    async run(api, t){ const r = await api.asistencias.post({ token: await api.sesion('admin'), action: 'personal', op: 'borrar' });
      t.ok('op inválida → payload/op', r.ok === false && r.error === 'payload' && r.campo === 'op', r);
      if (api.modo === 'vm'){ const c = await api.asistencias.post({ token: await api.sesion('capataz'), action: 'personal', op: 'alta', codigo: '1', nombre: 'X', cuadrilla: 'ANGEL' });
        t.ok('capataz → «No autorizado»', c.ok === false && /No autorizado/.test(c.error), c); } } },

  { id: 'asis.personal.alta_dup', modulo: 'asistencias', escribe: true, soloVm: true, nombre: 'POST personal alta: crea; una segunda alta de la misma persona activa se rechaza (D118)',
    async run(api, t){ const tok = await api.sesion('admin');
      const a = await api.asistencias.post({ token: tok, action: 'personal', op: 'alta', codigo: '99001', cedula: '', nombre: 'NUEVO CONTRATO', cargo: 'AYUDANTE', cuadrilla: 'ANGEL' });
      t.ok('alta ok', a.ok === true && a.op === 'alta', a);
      const b = await api.asistencias.post({ token: tok, action: 'personal', op: 'alta', codigo: '99001', nombre: 'NUEVO CONTRATO', cuadrilla: 'ANGEL' });
      t.ok('segunda alta → «Ya existe una persona activa»', b.ok === false && /Ya existe/.test(b.error), b);
      const p = await api.asistencias.get({ action: 'personal', token: tok });
      t.ok('personal la lista una vez, activa, en ANGEL', p.personal.filter(x => x.codigo === '99001').length === 1 && p.personal.find(x => x.codigo === '99001').cuadrilla === 'ANGEL', p.personal.map(x => x.codigo)); } },

  { id: 'asis.cache_reset', modulo: 'asistencias', nombre: 'GET cache_reset → ok con msg (D99)',
    async run(api, t){ const r = await api.asistencias.get({ action: 'cache_reset', token: await api.sesion('admin') });
      t.ok('ok + msg', r.ok === true && typeof r.msg === 'string', r); } }
];
