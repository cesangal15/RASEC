/**
 * Contrato de /obra (Codigo.gs): ?action=… con token (D109) salvo `tablero` (D159) y `login` (D108).
 * Cada caso es una petición real con la FORMA de respuesta que las pantallas leen. Lo que se compara son
 * claves, tipos y los mensajes que el frontend reconoce (auth genérico, `error:'payload'`, `rate_limit`).
 */
'use strict';
const { tiene, faltan, esFecha, esLista } = require('./arnes');

function reporteCapataz(api, fecha){   // payload NUEVO (D82: ids de cliente; D171: equipos como códigos)
  return { fecha, rol: 'capataz', capataz: 'ANGEL', id_reporte: api.uuid(), cantidades: [
    { id_registro: api.uuid(), grupo: 'TIERRAS', capitulo: 'EXPLANACIONES', actividad: 'Excavación', descripcion: 'Excavación en material común',
      centro_costo: '3701.02.05', unidad: 'm3', uf: '1', proyecto: '3701', elemento: 'K0+100', pk_inicial: 'K0+100', pk_final: 'K0+200', largo: 120,
      equipos: ['EX01'] } ] };
}

module.exports = [
  { id: 'obra.ping', modulo: 'obra', nombre: 'GET sin action con token → API viva',
    async run(api, t){ const r = await api.obra.get({ token: await api.sesion('admin') });
      t.ok('ok:true y msg', r.ok === true && /API viva/.test(String(r.msg)), r);
      t.ok('_ms numérico (D100)', typeof r._ms === 'number', r._ms); } },

  { id: 'obra.auth.sin_token', modulo: 'obra', nombre: 'lectura sin token → auth:false con el mensaje genérico (D166)',
    async run(api, t){ const r = await api.obra.get({ action: 'bandeja', fecha: api.hoy });
      t.ok('ok:false · auth:false', r.ok === false && r.auth === false, r);
      t.ok('mensaje genérico exacto', r.error === api.MENSAJE_AUTH, r.error); } },

  { id: 'obra.auth.token_roto', modulo: 'obra', nombre: 'token con la firma alterada → mismo mensaje genérico',
    async run(api, t){ const tok = await api.sesion('admin'); const r = await api.obra.get({ action: 'cubicaje', token: tok.slice(0, -3) + 'xyz' });
      t.ok('auth:false genérico', r.ok === false && r.auth === false && r.error === api.MENSAJE_AUTH, r);
      const b = await api.obra.get({ action: 'cubicaje', token: 'basura-sin-punto' });
      t.ok('basura → genérico', b.auth === false && b.error === api.MENSAJE_AUTH, b); } },

  { id: 'obra.login', modulo: 'obra', nombre: 'POST action=login: credenciales malas → rechazo único; buenas → token + rol + redirige',
    async run(api, t){
      const malo = await api.obra.post({ action: 'login', usuario: 'nadie-contrato', clave: 'x' });
      t.ok('usuario inexistente → «Usuario o contraseña incorrectos.»', malo.ok === false && malo.error === 'Usuario o contraseña incorrectos.', malo);
      const vacio = await api.obra.post({ action: 'login', usuario: '', clave: '' });
      t.ok('sin usuario/clave → «Faltan el usuario o la contraseña.»', vacio.ok === false && /Faltan/.test(vacio.error), vacio);
      const pl = await api.obra.post({ action: 'login', usuario: { a: 1 }, clave: 'x' });
      t.ok('usuario que no es texto → error:payload campo usuario', pl.ok === false && pl.error === 'payload' && pl.campo === 'usuario', pl);
      const c = api.credenciales.admin; if (!c) t.omitir('sin credenciales admin');
      const bien = await api.obra.post({ action: 'login', usuario: c.usuario, clave: c.clave });
      t.ok('ok:true con token, rol, areas[], redirige', bien.ok === true && typeof bien.token === 'string' && bien.token.indexOf('.') > 0 && typeof bien.rol === 'string' && esLista(bien.areas) && /\.html$/.test(bien.redirige), bien);
      t.ok('usuario en minúsculas', bien.usuario === c.usuario.toLowerCase(), bien.usuario); } },

  { id: 'obra.login.inactivo', modulo: 'obra', nombre: 'usuario inactivo → mismo rechazo que credenciales malas', soloVm: true,
    async run(api, t){ const r = await api.obra.post({ action: 'login', usuario: 'inactivo', clave: '1234' });
      t.ok('«Usuario o contraseña incorrectos.»', r.ok === false && r.error === 'Usuario o contraseña incorrectos.', r); } },

  { id: 'obra.tablero.publico', modulo: 'obra', nombre: 'GET action=tablero SIN token → ok con foto|null y meta (D159)',
    async run(api, t){ const r = await api.obra.get({ action: 'tablero' });
      t.ok('ok:true', r.ok === true, r);
      t.ok('claves foto y meta', tiene(r, ['foto', 'meta']), faltan(r, ['foto', 'meta']));
      t.ok('foto es null o un objeto con per[]', r.foto === null || (r.foto && esLista(r.foto.per)), r.foto && Object.keys(r.foto)); } },

  { id: 'obra.cubicaje', modulo: 'obra', nombre: 'GET cubicaje → {ok, cubicaje:{placa→m3}}',
    async run(api, t){ const r = await api.obra.get({ action: 'cubicaje', token: await api.sesion('admin') });
      t.ok('ok y objeto cubicaje', r.ok === true && r.cubicaje && typeof r.cubicaje === 'object' && !esLista(r.cubicaje), r);
      if (api.modo === 'vm') t.ok('semilla: NNM180 → 14', r.cubicaje.NNM180 === 14, r.cubicaje); } },

  { id: 'obra.bandeja', modulo: 'obra', nombre: 'GET bandeja&fecha[&area] → {fecha, area, cantidades[], maquinas[], observaciones[]}',
    async run(api, t){ const tok = await api.sesion('admin');
      const r = await api.obra.get({ action: 'bandeja', fecha: api.FECHA_BANCO, token: tok });
      t.ok('forma', tiene(r, ['fecha', 'area', 'cantidades', 'maquinas', 'observaciones']) && esLista(r.cantidades) && esLista(r.maquinas) && esLista(r.observaciones), faltan(r, ['fecha', 'area', 'cantidades', 'maquinas', 'observaciones']));
      t.ok('eco de la fecha', r.fecha === api.FECHA_BANCO, r.fecha);
      const a = await api.obra.get({ action: 'bandeja', fecha: api.FECHA_BANCO, area: 'odt', token: tok });
      t.ok('eco del área (D69)', a.area === 'odt', a.area); } },

  { id: 'obra.consolidado.dia', modulo: 'obra', nombre: 'GET consolidado&fecha → {fecha, cantidades[]}',
    async run(api, t){ const r = await api.obra.get({ action: 'consolidado', fecha: api.FECHA_BANCO, token: await api.sesion('admin') });
      t.ok('forma', r.fecha === api.FECHA_BANCO && esLista(r.cantidades), r); } },

  { id: 'obra.consolidado.rango', modulo: 'obra', nombre: 'GET consolidado&desde&hasta → header A–T+actividad, cols, filas[], climaPorDia (D113)',
    async run(api, t){ const r = await api.obra.get({ action: 'consolidado', desde: api.FECHA_BANCO, hasta: api.FECHA_BANCO, token: await api.sesion('admin') });
      t.ok('ok + forma', r.ok === true && tiene(r, ['desde', 'hasta', 'header', 'cols', 'climaPorDia', 'filas']) && esLista(r.filas), faltan(r, ['desde', 'hasta', 'header', 'cols', 'climaPorDia', 'filas']));
      t.ok('header: 20 columnas del maestro + actividad', esLista(r.header) && r.header.length === 21 && r.header[0] === 'FECHA' && r.header[20] === 'actividad', r.header);
      t.ok('cols con COPY_END=15 (el paste A:S no cambia)', r.cols && r.cols.COPY_END === 15 && r.cols.ACTIVIDAD === 20, r.cols); } },

  { id: 'obra.estado', modulo: 'obra', nombre: 'GET estado&fecha → {reportadas[]}',
    async run(api, t){ const r = await api.obra.get({ action: 'estado', fecha: api.FECHA_BANCO, token: await api.sesion('admin') });
      t.ok('reportadas es lista', esLista(r.reportadas), r); } },

  { id: 'obra.volquetas', modulo: 'obra', nombre: 'GET volquetas&fecha → {ok, fecha, filas[]}',
    async run(api, t){ const r = await api.obra.get({ action: 'volquetas', fecha: api.FECHA_BANCO, token: await api.sesion('admin') });
      t.ok('forma', r.ok === true && r.fecha === api.FECHA_BANCO && esLista(r.filas), r); } },

  { id: 'obra.drenajes', modulo: 'obra', nombre: 'GET drenajes → {ok, marcadores, items[]}',
    async run(api, t){ const r = await api.obra.get({ action: 'drenajes', token: await api.sesion('admin') });
      t.ok('forma', r.ok === true && tiene(r, ['marcadores', 'items']) && esLista(r.items), faltan(r, ['marcadores', 'items'])); } },

  { id: 'obra.tramos', modulo: 'obra', nombre: 'GET tramos → {ok, tramos[]} (D104)',
    async run(api, t){ const r = await api.obra.get({ action: 'tramos', token: await api.sesion('admin') });
      t.ok('forma', r.ok === true && esLista(r.tramos), r); } },

  { id: 'obra.maquinas', modulo: 'obra', nombre: 'GET maquinas[&fecha] → {ok, fecha, fuente, maquinas[], equipos[], avisos} (D138/D171)',
    async run(api, t){ const r = await api.obra.get({ action: 'maquinas', fecha: api.hoy, token: await api.sesion('admin') });
      t.ok('forma', r.ok === true && esFecha(r.fecha) && tiene(r, ['fuente', 'maquinas', 'equipos', 'avisos']) && esLista(r.maquinas) && esLista(r.equipos), faltan(r, ['fuente', 'maquinas', 'equipos', 'avisos']));
      if (r.maquinas.length) t.ok('cada máquina: id_maquina, tipo, prog, propiedad, produce, esperada', tiene(r.maquinas[0], ['id_maquina', 'tipo', 'prog', 'propiedad', 'produce', 'esperada']), r.maquinas[0]);
      if (api.modo === 'vm') t.ok('semilla: EX01 vigente hoy', r.maquinas.some(m => m.id_maquina === 'EX01'), r.maquinas.map(m => m.id_maquina)); } },

  { id: 'obra.flota', modulo: 'obra', nombre: 'GET flota[&fecha] → {ok, fecha, estancias[], avisos} (D139)',
    async run(api, t){ const r = await api.obra.get({ action: 'flota', fecha: api.hoy, token: await api.sesion('admin') });
      t.ok('forma', r.ok === true && esFecha(r.fecha) && esLista(r.estancias) && tiene(r, ['avisos']), faltan(r, ['fecha', 'estancias', 'avisos'])); } },

  { id: 'obra.acumulado_drenajes', modulo: 'obra', nombre: 'GET acumulado_drenajes&area → {ok, area, acumulado}',
    async run(api, t){ const r = await api.obra.get({ action: 'acumulado_drenajes', area: 'odt', token: await api.sesion('admin') });
      t.ok('forma', r.ok === true && r.area === 'odt' && tiene(r, ['acumulado']), r); } },

  { id: 'obra.maquinaria_produccion', modulo: 'obra', nombre: 'GET maquinaria_produccion&fecha → {ok, fecha, frentes, otras, flota_produccion, faltantes}',
    async run(api, t){ const r = await api.obra.get({ action: 'maquinaria_produccion', fecha: api.FECHA_BANCO, token: await api.sesion('admin') });
      t.ok('forma', r.ok === true && r.fecha === api.FECHA_BANCO && tiene(r, ['frentes', 'otras', 'flota_produccion', 'faltantes']), faltan(r, ['frentes', 'otras', 'flota_produccion', 'faltantes'])); } },

  /* ---------- escrituras ---------- */
  { id: 'obra.reporte.payload', modulo: 'obra', nombre: 'POST reporte: validación D166 → {ok:false, error:"payload", campo}; la cola conserva el ítem',
    async run(api, t){ const tok = await api.sesion('admin');
      const p = async (mut) => { const b = Object.assign({ token: tok }, reporteCapataz(api, api.FECHA_BANCO)); mut(b); return api.obra.post(b); };
      let r = await p(b => { b.fecha = '2999-01-01'; });               t.ok('fecha futura → payload/fecha', r.ok === false && r.error === 'payload' && r.campo === 'fecha', r);
      r = await p(b => { b.fecha = '31/12/2026'; });                   t.ok('fecha mal formada → payload/fecha', r.error === 'payload' && r.campo === 'fecha', r);
      r = await p(b => { b.cantidades[0].largo = 'abc'; });            t.ok('largo no numérico → payload/cantidades[0].largo', r.error === 'payload' && r.campo === 'cantidades[0].largo', r);
      r = await p(b => { b.cantidades = 'no-es-lista'; });             t.ok('cantidades que no es lista → payload/cantidades', r.error === 'payload' && r.campo === 'cantidades', r);
      r = await p(b => { b.cantidades[0].observacion = 'x'.repeat(2001); }); t.ok('observación > 2000 → payload', r.error === 'payload' && r.campo === 'cantidades[0].observacion', r); } },

  { id: 'obra.reporte.idempotente', modulo: 'obra', escribe: true, nombre: 'POST reporte de capataz: guarda; el reenvío idéntico cuenta como duplicadas (D82); la bandeja del día lo muestra',
    async run(api, t){ const tok = await api.sesion('admin'); const body = Object.assign({ token: tok }, reporteCapataz(api, api.FECHA_BANCO)); const id = body.cantidades[0].id_registro;
      const r1 = await api.obra.post(body);
      t.ok('1º envío: ok, cantidades:1, maquinas:1, guardadas:2, duplicadas:0', r1.ok === true && r1.cantidades === 1 && r1.maquinas === 1 && r1.volquetas === 0 && r1.guardadas === 2 && r1.duplicadas === 0, r1);
      const r2 = await api.obra.post(body);
      t.ok('reenvío: mismos conteos, guardadas:0, duplicadas:2', r2.ok === true && r2.cantidades === 1 && r2.maquinas === 1 && r2.guardadas === 0 && r2.duplicadas === 2, r2);
      const b = await api.obra.get({ action: 'bandeja', fecha: api.FECHA_BANCO, token: tok });
      const fila = b.cantidades.find(c => c.id_registro === id);
      t.ok('bandeja del día trae la línea por id_registro, estado pendiente', !!fila && (fila.estado === 'pendiente' || fila.estado === ''), fila || b.cantidades.length);
      t.ok('…con los campos crudos que lee el encargado', !!fila && fila.centro_costo === '3701.02.05' && String(fila.largo) === '120' && fila.reporta === 'ANGEL', fila);
      t.ok('la máquina del reporte sale en maquinas[] con id_cantidad = id de la línea (D171)', b.maquinas.some(m => m.id_maquina === 'EX01' && m.id_cantidad === id), b.maquinas.map(m => [m.id_maquina, m.id_cantidad]));
      const e = await api.obra.get({ action: 'estado', fecha: api.FECHA_BANCO, token: tok });
      t.ok('estado&fecha la lista como reportada', e.reportadas.some(m => m.id_maquina === 'EX01'), e.reportadas); } },

  { id: 'obra.reporte.chequeadora', modulo: 'obra', escribe: true, nombre: 'POST reporte de chequeadora con volquetas → cuenta volquetas y las lista volquetas&fecha',
    async run(api, t){ const tok = await api.sesion('admin'); const idv = api.uuid();
      const r = await api.obra.post({ token: tok, fecha: api.FECHA_BANCO, rol: 'chequeadora', capataz: 'MALEJA', m3viaje: 14,
        volquetas: [{ id_registro: idv, origen: 'Masivo 2', destino: 'K1+000', tipo_destino: 'Terraplén', uf: '1', placas: [{ placa: 'NNM180', viajes: 3 }] }], cantidades: [] });
      t.ok('ok, volquetas:1', r.ok === true && r.volquetas === 1, r);
      const v = await api.obra.get({ action: 'volquetas', fecha: api.FECHA_BANCO, token: tok });
      const f = v.filas.find(x => x.id_registro === idv);
      t.ok('volquetas&fecha trae la placa con viajes, cubicaje y cubicaje_origen (D53)', !!f && f.placa === 'NNM180' && f.viajes === 3 && typeof f.cubicaje === 'number' && tiene(f, ['origen', 'destino', 'tipo_destino', 'uf', 'cubicaje_origen']), f || v.filas.length);
      if (api.modo === 'vm') t.ok('semilla: cubicaje 14 de la hoja CUBICAJE, origen «catalogo»', f.cubicaje === 14 && /catalogo/i.test(f.cubicaje_origen), f); } },

  { id: 'obra.enviar_data.vacio', modulo: 'obra', escribe: true, nombre: 'POST enviar_data sin cantidades → ok, enviadas:0 (no toca DATA); tierras sin clima → rechazo D130',
    async run(api, t){ const tok = await api.sesion('admin');
      const r = await api.obra.post({ token: tok, action: 'enviar_data', fecha: api.FECHA_BANCO, area: 'odt', clima: '', cantidades: [] });
      t.ok('odt sin clima: ok, enviadas:0, area:odt', r.ok === true && r.enviadas === 0 && r.area === 'odt', r);
      const s = await api.obra.post({ token: tok, action: 'enviar_data', fecha: api.FECHA_BANCO, area: 'tierras', clima: '', cantidades: [] });
      t.ok('tierras sin clima → ok:false con mensaje', s.ok === false && typeof s.error === 'string' && s.error.length > 0, s);
      const a = await api.obra.post({ token: tok, action: 'enviar_data', fecha: api.FECHA_BANCO, area: 'marte', clima: 'Seco', cantidades: [] });
      t.ok('área fuera de lista → payload/area', a.ok === false && a.error === 'payload' && a.campo === 'area', a); } },

  { id: 'obra.flota.guard', modulo: 'obra', nombre: 'POST flota_guardar: op fuera de lista → payload/op; sin campos → error explícito; jefe no escribe (D139)',
    async run(api, t){ const tok = await api.sesion('admin');
      const r = await api.obra.post({ token: tok, action: 'flota_guardar', op: 'x' });
      t.ok('op inválida → payload/op', r.ok === false && r.error === 'payload' && r.campo === 'op', r);
      const f = await api.obra.post({ token: tok, action: 'flota_guardar', op: 'alta', id_maquina: '', fecha_ingreso: 'no-fecha' });
      t.ok('fecha_ingreso inválida → payload/fecha_ingreso', f.ok === false && f.error === 'payload' && f.campo === 'fecha_ingreso', f);
      if (api.modo === 'vm'){ const j = await api.obra.post({ token: await api.sesion('jefe'), action: 'flota_guardar', op: 'alta', id_maquina: 'ZZ99', tipo: 'Excavadora', fecha_ingreso: api.hoy });
        t.ok('jefe → «solo lectura», no guarda', j.ok === false && /SOLO LECTURA/.test(j.error), j); } } },

  { id: 'obra.flota.alta_baja', modulo: 'obra', escribe: true, soloVm: true, nombre: 'POST flota_guardar alta → estancia vigente; baja → deja de estar (ventana semiabierta D138)',
    async run(api, t){ const tok = await api.sesion('admin');
      const alta = { token: tok, action: 'flota_guardar', op: 'alta', id_maquina: 'RT02', tipo: 'Retroexcavadora', horas_prog: 10, propiedad: 'alquilada', fecha_ingreso: '2026-01-01', frente: 'UF1-UF2' };
      const a0 = await api.obra.post(alta);
      t.ok('código nuevo sin historial → pide confirmación (confirmar:true) sin escribir (D139)', a0.ok === false && a0.confirmar === true && a0.id_maquina === 'RT02', a0);
      const a = await api.obra.post(Object.assign({ confirmado: true }, alta));
      t.ok('alta confirmada ok', a.ok === true, a);
      let m = await api.obra.get({ action: 'maquinas', fecha: '2026-02-01', token: tok });
      t.ok('vigente el 2026-02-01', m.maquinas.some(x => x.id_maquina === 'RT02'), m.maquinas.map(x => x.id_maquina));
      const b = await api.obra.post({ token: tok, action: 'flota_guardar', op: 'baja', clave: { id_maquina: 'RT02', fecha_ingreso: '2026-01-01' }, id_maquina: 'RT02', fecha_retiro: '2026-03-01' });
      t.ok('baja ok', b.ok === true, b);
      m = await api.obra.get({ action: 'maquinas', fecha: '2026-03-01', token: tok });
      t.ok('el primer día que ya no estuvo no aparece', !m.maquinas.some(x => x.id_maquina === 'RT02'), m.maquinas.map(x => x.id_maquina)); } },

  { id: 'obra.tablero.guardar', modulo: 'obra', nombre: 'POST tablero_guardar: foto vacía → rechazo sin escribir; capataz → sin permiso (D158)',
    async run(api, t){ const tok = await api.sesion('admin');
      const r = await api.obra.post({ token: tok, action: 'tablero_guardar', foto: { per: [] } });
      t.ok('foto sin períodos → ok:false «llegó vacía»', r.ok === false && /vac/.test(String(r.error)), r);
      const p = await api.obra.post({ token: tok, action: 'tablero_guardar', foto: 'no-objeto' });
      t.ok('foto que no es objeto → payload/foto', p.ok === false && p.error === 'payload' && p.campo === 'foto', p);
      if (api.modo === 'vm'){ const c = await api.obra.post({ token: await api.sesion('capataz'), action: 'tablero_guardar', foto: { per: [{ p: '2026-08' }] } });
        t.ok('capataz → «Tu usuario no puede publicar…»', c.ok === false && /no puede/.test(c.error), c); } } },

  { id: 'obra.tablero.ciclo', modulo: 'obra', escribe: true, soloVm: true, nombre: 'tablero_guardar (admin) → tablero público devuelve la misma foto y meta',
    async run(api, t){ const foto = { fc: 1.3, generado: '2026-09-09 10:00', per: [{ p: '2026-08', d: [], a: {}, m: {} }] };
      const g = await api.obra.post({ token: await api.sesion('admin'), action: 'tablero_guardar', foto });
      t.ok('guardar ok con meta{periodos:1, trozos:1}', g.ok === true && g.meta && g.meta.periodos === 1 && g.meta.trozos === 1, g);
      const l = await api.obra.get({ action: 'tablero' });
      t.ok('lectura pública: la misma foto', l.ok === true && JSON.stringify(l.foto) === JSON.stringify(foto) && l.meta.usuario === 'admin', l); } },

  { id: 'obra.maqprod.vacio', modulo: 'obra', escribe: true, nombre: 'POST maquinaria_produccion sin ajustes ni nuevas → ok, actualizadas:0, creadas:0',
    async run(api, t){ const r = await api.obra.post({ token: await api.sesion('admin'), action: 'maquinaria_produccion', fecha: api.FECHA_BANCO, ajustes: [], nuevas: [] });
      t.ok('ok con conteos en 0', r.ok === true && r.actualizadas === 0 && r.creadas === 0, r); } },

  { id: 'obra.rate_limit', modulo: 'obra', soloVm: true, nombre: '61ª petición del mismo usuario+action en un minuto → error:rate_limit (D166)',
    async run(api, t){ const tok = await api.sesion('capataz'); let u = null;
      for (let i = 0; i < 60; i++) u = await api.obra.get({ action: 'cubicaje', token: tok });
      t.ok('60 pasan', u.ok === true, u);
      const r = await api.obra.get({ action: 'cubicaje', token: tok });
      t.ok('la 61ª → {ok:false, error:"rate_limit"}', r.ok === false && r.error === 'rate_limit', r);
      t.ok('otra action del mismo usuario sigue pasando', esLista((await api.obra.get({ action: 'estado', fecha: api.hoy, token: tok })).reportadas)); } },

  { id: 'obra.log', modulo: 'obra', soloVm: true, nombre: 'cada petición con identidad deja UNA fila en LOG con los 7 campos (D166); tablero no',
    async run(api, t){ const LOG = () => api.hojas.obra.LOG ? api.hojas.obra.LOG._f.slice(1) : []; const antes = LOG().length;
      await api.obra.get({ action: 'cubicaje', token: await api.sesion('residente') });   // residente: sin rate limit gastado en este arnés
      const f = LOG()[LOG().length - 1];
      t.ok('encabezados de LOG', JSON.stringify(api.hojas.obra.LOG._f[0]) === JSON.stringify(['fecha_hora', 'usuario', 'rol', 'action', 'resultado', 'motivo', 'ms']), api.hojas.obra.LOG._f[0]);
      t.ok('fila: usuario residente, rol residente, action cubicaje, ok, ms numérico', LOG().length === antes + 1 && f[1] === 'residente' && f[2] === 'residente' && f[3] === 'cubicaje' && f[4] === 'ok' && typeof f[6] === 'number', f);
      await api.obra.get({ action: 'tablero' });
      t.ok('tablero (público) no se anota', LOG().length === antes + 1, LOG().length); } }
];
