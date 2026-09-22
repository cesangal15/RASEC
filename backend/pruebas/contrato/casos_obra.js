/**
 * Contrato de /obra (Codigo.gs): ?action=… con token (D109) salvo `tablero` (D159) y `login` (D108).
 * Cada caso es una petición real con la FORMA de respuesta que las pantallas leen. Lo que se compara son
 * claves, tipos y los mensajes que el frontend reconoce (auth genérico, `error:'payload'`, `rate_limit`).
 */
'use strict';
const { tiene, faltan, esFecha, esLista } = require('./arnes');

// D182: columnas de la grilla de DATA, en orden (sin orden/proyecto/liberacion; clima antes de observación,
// que va al final) y las opciones de clima (las mismas que CLIMA_OPS de encargado.js).
const DG_COLUMNAS_D182 = ['fecha', 'descripcion', 'elemento', 'centro_de_costo', 'grupo', 'capitulo', 'unidad_funcional',
  'abs_inicial', 'abs_final', 'acta', 'unidad_medida', 'largo', 'espesor', 'fc', 'cantidad', 'clima', 'observacion'];
const CLIMA_OPC_D182 = ['', 'Soleado', 'Lluvias', 'Lluvias parciales'];
const RANGO_D182 = { desde: '2020-01-20', hasta: '2020-01-24' };   // filas de `data` sembradas para D182 (semillas.js)
const RANGO_D182B = { desde: '2020-01-27', hasta: '2020-01-30' };  // las de la revisión de D182: op clima, D71, bajas y cambios de fecha
const filaDe = (r, id) => ((r && r.filas) || []).filter(x => x.id_registro === id)[0];
// Lo que la grilla manda de una fila en un update: las columnas VISIBLES (sin clima: solo viaja si cambió).
function visiblesDe(f){ const o = { id_registro: f.id_registro };
  DG_COLUMNAS_D182.forEach(k => { if (k !== 'clima') o[k] = f[k]; }); return o; }

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

  /* ---------- grilla editable de catálogos fundacionales (V3-08 / D181) — endpoints DB-only del Worker ---------- */
  { id: 'obra.grid.leer', modulo: 'obra', nombre: 'GET grid&tabla=subtramos → {ok, columnas[], filas[], analisis}; cadena encadenada NO es solape; los dos «ajuste a origen» quedan no operativos',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('grid es DB-only del Worker (4.01/D181); no está en el .gs vm');
      const r = await api.obra.get({ action: 'grid', tabla: 'subtramos', token: await api.sesion('admin') });
      t.ok('forma', r.ok === true && esLista(r.columnas) && esLista(r.filas) && !!r.analisis, r);
      t.ok('cada fila: orden, elemento, version, tipo, no_operativo', r.filas.length > 0 && tiene(r.filas[0], ['orden', 'elemento', 'version', 'tipo', 'no_operativo']), r.filas[0]);
      t.ok('cadena (fin==inicio del siguiente) NO se marca como solape', esLista(r.analisis.overlaps) && r.analisis.overlaps.length === 0, r.analisis.overlaps);
      t.ok('los dos «ajuste a origen» quedan no operativos', esLista(r.analisis.no_operativos) && r.analisis.no_operativos.length >= 2, r.analisis.no_operativos); } },

  { id: 'obra.grid.version', modulo: 'obra', escribe: true, nombre: 'POST grid_guardar: update con if_version bueno guarda y sube version; con if_version viejo → conflicto (V3-08/D181)',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('grid es DB-only del Worker (4.01/D181)');
      const tok = await api.sesion('admin');
      const r0 = await api.obra.get({ action: 'grid', tabla: 'subtramos', token: tok });
      const fila = (r0.filas || []).filter(f => f.elemento === 'tm2 pk 10+000 - 11+000')[0];
      t.ok('semilla presente', !!fila, (r0.filas || []).map(f => f.elemento));
      if (!fila) return;
      const v0 = fila.version;
      const g1 = await api.obra.post({ token: tok, action: 'grid_guardar', tabla: 'subtramos',
        cambios: [{ op: 'update', orden: fila.orden, if_version: v0, elemento: fila.elemento, abs_inicio: fila.abs_inicio, abs_fin: fila.abs_fin, uf: 'UF1', no_operativo: false }] });
      t.ok('update ok, guardadas:1', g1.ok === true && g1.guardadas === 1, g1);
      const nueva = (g1.filas || []).filter(f => f.orden === fila.orden)[0];
      t.ok('version subió a v0+1', !!nueva && nueva.version === v0 + 1, nueva);
      const g2 = await api.obra.post({ token: tok, action: 'grid_guardar', tabla: 'subtramos',
        cambios: [{ op: 'update', orden: fila.orden, if_version: v0, elemento: fila.elemento, abs_inicio: fila.abs_inicio, abs_fin: fila.abs_fin, uf: 'UF2', no_operativo: false }] });
      t.ok('if_version viejo → {ok:false, error:"version", conflictos[]}', g2.ok === false && g2.error === 'version' && esLista(g2.conflictos) && g2.conflictos.length >= 1, g2); } },

  { id: 'obra.grid.solape', modulo: 'obra', escribe: true, nombre: 'POST grid_guardar: alta de un TRAMO que se pisa con otro → rechazo «solape» (D181: no se dejan los dos)',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('grid es DB-only del Worker (4.01/D181)');
      const tok = await api.sesion('admin');
      const g = await api.obra.post({ token: tok, action: 'grid_guardar', tabla: 'subtramos',
        cambios: [{ op: 'alta', elemento: 'tm2 pk 10+500 - 11+500', abs_inicio: '10500', abs_fin: '11500', uf: 'UF1', no_operativo: false }] });
      t.ok('rechazo solape con lista de solapes', g.ok === false && g.error === 'solape' && esLista(g.solapes) && g.solapes.length >= 1, g); } },

  { id: 'obra.grid.rol', modulo: 'obra', escribe: true, nombre: 'grid_guardar: el capataz NO edita; el JEFE SÍ (D181 le devuelve los catálogos, a diferencia de Maquinaria)',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('grid es DB-only del Worker (4.01/D181)');
      const cap = await api.obra.post({ token: await api.sesion('capataz'), action: 'grid_guardar', tabla: 'subtramos',
        cambios: [{ op: 'update', orden: 3, if_version: 0, elemento: 'ODT1-001', abs_inicio: '11012', abs_fin: '11012', uf: 'UF1', no_operativo: false }] });
      t.ok('capataz rechazado (no toca la BD)', cap.ok === false && /no puede/i.test(String(cap.error)), cap);
      const tokJ = await api.sesion('jefe');
      const r0 = await api.obra.get({ action: 'grid', tabla: 'subtramos', token: tokJ });
      const odt = (r0.filas || []).filter(f => f.elemento === 'ODT1-001')[0];
      t.ok('semilla ODT1-001 presente', !!odt, (r0.filas || []).map(f => f.elemento));
      if (!odt) return;
      const gj = await api.obra.post({ token: tokJ, action: 'grid_guardar', tabla: 'subtramos',
        cambios: [{ op: 'update', orden: odt.orden, if_version: odt.version, elemento: odt.elemento, abs_inicio: odt.abs_inicio, abs_fin: odt.abs_fin, uf: 'UF1', no_operativo: false }] });
      t.ok('el JEFE sí guarda (guardadas:1)', gj.ok === true && gj.guardadas === 1, gj); } },

  /* ---------- revisión editable de DATA (V3-08b / D181) — endpoints DB-only del Worker ---------- */
  { id: 'obra.data_grid.leer', modulo: 'obra', nombre: 'GET data_grid&desde&hasta → {ok, columnas, filas, actividades, subtramos, periodos}; trae la fila sembrada con version',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('data_grid es DB-only del Worker (4.01/D181)');
      const r = await api.obra.get({ action: 'data_grid', desde: '2025-09-01', hasta: '2025-09-30', token: await api.sesion('admin') });
      t.ok('forma', r.ok === true && esLista(r.columnas) && esLista(r.filas) && esLista(r.actividades) && esLista(r.periodos), r);
      const f = (r.filas || []).filter(x => x.id_registro === 'seed-data-1')[0];
      t.ok('fila sembrada con version y CC', !!f && f.version === 0 && f.centro_de_costo === '3701.02.05', f); } },

  { id: 'obra.data_grid.alta_deriva', modulo: 'obra', escribe: true, nombre: 'POST data_grid_guardar alta: deriva CC/UF/abscisas/acta/cantidad de descripción+subtramo+fecha (V3-08b/D181)',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('data_grid es DB-only del Worker (4.01/D181)');
      const tok = await api.sesion('jefe'); const id = 'dg-' + api.uuid();
      const g = await api.obra.post({ token: tok, action: 'data_grid_guardar', desde: '2025-09-01', hasta: '2025-09-30',
        cambios: [{ op: 'alta', id_registro: id, fecha: '2025-09-20', descripcion: 'Terraplenes', elemento: 'tm2 pk 10+000 - 11+000', liberacion: 'CAMPO', largo: 200, espesor: 1, fc: 1.3 }] });
      t.ok('alta ok', g.ok === true && g.guardadas === 1, g);
      const f = (g.filas || []).filter(x => x.id_registro === id)[0];
      t.ok('CC derivado de descripción+UF', !!f && f.centro_de_costo === '3701.02.07', f);
      t.ok('UF del subtramo', f && f.unidad_funcional === 'UF1', f);
      t.ok('abscisas del subtramo', f && f.abs_inicial === '10000' && f.abs_final === '11000', f);
      t.ok('acta del periodo (12)', f && f.acta === '12', f);
      t.ok('cantidad = largo×espesor÷fc', f && Math.abs(Number(f.cantidad) - 200 / 1.3) < 0.01, f && f.cantidad);
      t.ok('grupo/capítulo/unidad derivados', f && f.grupo === 'TIERRAS' && f.capitulo === 'EXPLANACIONES' && f.unidad_medida === 'm3', f); } },

  { id: 'obra.data_grid.version', modulo: 'obra', escribe: true, nombre: 'POST data_grid_guardar update: if_version bueno guarda y recalcula cantidad; viejo → conflicto (V3-08b/D181)',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('data_grid es DB-only del Worker (4.01/D181)');
      const tok = await api.sesion('jefe');
      const r0 = await api.obra.get({ action: 'data_grid', desde: '2025-09-01', hasta: '2025-09-30', token: tok });
      const f = (r0.filas || []).filter(x => x.id_registro === 'seed-data-1')[0];
      t.ok('semilla presente', !!f, (r0.filas || []).map(x => x.id_registro));
      if (!f) return;
      const v0 = f.version;
      const g1 = await api.obra.post({ token: tok, action: 'data_grid_guardar', desde: '2025-09-01', hasta: '2025-09-30',
        cambios: [{ op: 'update', id_registro: 'seed-data-1', if_version: v0, fecha: f.fecha, descripcion: f.descripcion, elemento: f.elemento, liberacion: f.liberacion, largo: 260, espesor: 1, fc: 1.3 }] });
      t.ok('update ok', g1.ok === true && g1.guardadas === 1, g1);
      const n = (g1.filas || []).filter(x => x.id_registro === 'seed-data-1')[0];
      t.ok('version subió y cantidad recalculó', !!n && n.version === v0 + 1 && Math.abs(Number(n.cantidad) - 260 / 1.3) < 0.01, n);
      const g2 = await api.obra.post({ token: tok, action: 'data_grid_guardar', desde: '2025-09-01', hasta: '2025-09-30',
        cambios: [{ op: 'update', id_registro: 'seed-data-1', if_version: v0, fecha: f.fecha, descripcion: f.descripcion, elemento: f.elemento, liberacion: f.liberacion, largo: 99, espesor: 1, fc: 1.3 }] });
      t.ok('if_version viejo → {ok:false, error:"version"}', g2.ok === false && g2.error === 'version' && esLista(g2.conflictos), g2); } },

  { id: 'obra.data_grid.rol', modulo: 'obra', escribe: true, nombre: 'data_grid_guardar: el capataz NO edita DATA; el jefe SÍ (D181)',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('data_grid es DB-only del Worker (4.01/D181)');
      const cap = await api.obra.post({ token: await api.sesion('capataz'), action: 'data_grid_guardar', desde: '2025-09-01', hasta: '2025-09-30',
        cambios: [{ op: 'update', id_registro: 'seed-data-1', if_version: 0, fecha: '2025-09-20', descripcion: 'Terraplenes', elemento: 'tm2 pk 10+000 - 11+000', largo: 1, espesor: 1, fc: 1 }] });
      t.ok('capataz rechazado (no toca la BD)', cap.ok === false && /no puede/i.test(String(cap.error)), cap); } },

  /* ---------- D182: DATA online simplificada — clima del DÍA y campos ocultos (DB-only del Worker) ---------- */
  { id: 'obra.data_grid.columnas_d182', modulo: 'obra', nombre: 'GET data_grid (D182): columnas exactas y en orden, clima_opciones, cada fila con su clima (o el del DÍA) y los ocultos orden/proyecto/liberacion',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('data_grid es DB-only del Worker (4.01/D181)');
      const r = await api.obra.get(Object.assign({ action: 'data_grid', token: await api.sesion('admin') }, RANGO_D182));
      t.ok('ok', r.ok === true && esLista(r.columnas) && esLista(r.filas), r);
      const ks = (r.columnas || []).map(c => c.k);
      t.ok('columnas exactas y en orden (sin orden/proyecto/liberacion; clima y observación al final)', JSON.stringify(ks) === JSON.stringify(DG_COLUMNAS_D182), ks);
      const cl = (r.columnas || []).filter(c => c.k === 'clima')[0];
      t.ok('clima: lista editable con las opciones del encargado', !!cl && cl.tipo === 'lista' && cl.edita === true && JSON.stringify(cl.opciones) === JSON.stringify(CLIMA_OPC_D182), cl);
      t.ok('payload.clima_opciones', JSON.stringify(r.clima_opciones) === JSON.stringify(CLIMA_OPC_D182), r.clima_opciones);
      t.ok('cada fila trae clima y los ocultos (ida y vuelta)', (r.filas || []).length >= 8 && r.filas.every(f => tiene(f, ['clima', 'orden', 'proyecto', 'liberacion'])), (r.filas || [])[0]);
      const f = (id) => filaDe(r, id) || {};
      t.ok('drenajes con clima "" → el del DÍA (Soleado, de la fila de tierras)', f('seed-dg-clima-o').clima === 'Soleado', f('seed-dg-clima-o'));
      t.ok('día 22: la odt sin clima toma «Lluvias» (el del sello movido por 005; "timestamp" NULLS LAST)', f('seed-dg-sin-clima').clima === 'Lluvias', f('seed-dg-sin-clima'));
      t.ok('una fila con clima propio lo conserva aunque el día diga otro', f('seed-dg-a-propio').clima === 'Lluvias parciales', f('seed-dg-a-propio'));
      t.ok('valor histórico fuera de la lista, tal cual', f('seed-dg-historico').clima === 'SOLEADO', f('seed-dg-historico'));
      t.ok('día sin clima → ""', f('seed-dg-sin-dia').clima === '', f('seed-dg-sin-dia'));
      t.ok('005: la observación llega sin el sello', f('seed-dg-sello').observacion === 'nota del día', f('seed-dg-sello'));
      t.ok('ocultos de la fila fuera de catálogo', f('seed-dg-ocultos').liberacion === 'TOPOGRAFIA' && f('seed-dg-ocultos').orden === '999' && f('seed-dg-ocultos').proyecto === 'P-X', f('seed-dg-ocultos')); } },

  { id: 'obra.data_grid.ocultos_d182', modulo: 'obra', escribe: true, nombre: 'POST data_grid_guardar update SIN orden/proyecto/liberación/clima (D182) → se conservan los guardados (fila fuera de catálogo con TOPOGRAFIA)',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('data_grid es DB-only del Worker (4.01/D181)');
      const tok = await api.sesion('jefe');
      const r0 = await api.obra.get(Object.assign({ action: 'data_grid', token: tok }, RANGO_D182));
      const f = filaDe(r0, 'seed-dg-ocultos');
      t.ok('semilla presente', !!f, (r0.filas || []).map(x => x.id_registro));
      if (!f) return;
      const cambio = Object.assign(visiblesDe(f), { op: 'update', if_version: f.version, largo: 25 });
      t.ok('el cambio NO lleva orden/proyecto/liberacion/clima', ['orden', 'proyecto', 'liberacion', 'clima'].every(k => !(k in cambio)), Object.keys(cambio));
      const g = await api.obra.post(Object.assign({ token: tok, action: 'data_grid_guardar', cambios: [cambio] }, RANGO_D182));
      const n = filaDe(g, 'seed-dg-ocultos');
      t.ok('guardó, version+1 y recalculó la cantidad', g.ok === true && g.guardadas === 1 && !!n && n.version === f.version + 1 && Number(n.cantidad) === 25, n || g);
      t.ok('liberación TOPOGRAFIA conservada', !!n && n.liberacion === 'TOPOGRAFIA', n);
      t.ok('orden/proyecto fuera de catálogo conservados', !!n && n.orden === '999' && n.proyecto === 'P-X', n);
      t.ok('clima conservado y nada propagado', !!n && n.clima === 'Soleado' && g.clima_propagadas === 0, [n && n.clima, g.clima_propagadas]);
      t.ok('CC y observación como los mandó (override de fila fuera de catálogo)', !!n && n.centro_de_costo === '3701.99.01' && n.observacion === 'fila a mano', n); } },

  { id: 'obra.data_grid.clima_dia_d182', modulo: 'obra', escribe: true, nombre: 'POST data_grid_guardar con clima (D182): se PROPAGA a todas las filas de la fecha (también drenajes) con version+1; dos climas del mismo día en un lote → gana el último',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('data_grid es DB-only del Worker (4.01/D181)');
      const tok = await api.sesion('jefe');
      const r0 = await api.obra.get(Object.assign({ action: 'data_grid', token: tok }, RANGO_D182));
      const ti = filaDe(r0, 'seed-dg-clima-t'), od = filaDe(r0, 'seed-dg-clima-o'), otro = filaDe(r0, 'seed-dg-historico');
      t.ok('semillas presentes', !!ti && !!od && !!otro, (r0.filas || []).map(x => x.id_registro));
      if (!ti || !od || !otro) return;
      const g = await api.obra.post(Object.assign({ token: tok, action: 'data_grid_guardar',
        cambios: [Object.assign(visiblesDe(ti), { op: 'update', if_version: ti.version, orden: ti.orden, proyecto: ti.proyecto, liberacion: ti.liberacion, clima: 'Lluvias parciales' })] }, RANGO_D182));
      t.ok('ok, guardadas:1, clima_propagadas:1', g.ok === true && g.guardadas === 1 && g.clima_propagadas === 1, g);
      const ti1 = filaDe(g, 'seed-dg-clima-t'), od1 = filaDe(g, 'seed-dg-clima-o'), otro1 = filaDe(g, 'seed-dg-historico');
      t.ok('la fila editada: clima nuevo y version+1 (no +2)', !!ti1 && ti1.clima === 'Lluvias parciales' && ti1.version === ti.version + 1, ti1);
      t.ok('la de drenajes (otra área) del mismo día: clima propagado, version+1, editado_por jefe', !!od1 && od1.clima === 'Lluvias parciales' && od1.version === od.version + 1 && od1.editado_por === 'jefe', od1);
      t.ok('otro día intacto (clima y version)', !!otro1 && otro1.clima === 'SOLEADO' && otro1.version === otro.version, otro1);
      if (!ti1 || !od1) return;
      const g2 = await api.obra.post(Object.assign({ token: tok, action: 'data_grid_guardar', cambios: [
        Object.assign(visiblesDe(ti1), { op: 'update', if_version: ti1.version, clima: 'Soleado' }),
        Object.assign(visiblesDe(od1), { op: 'update', if_version: od1.version, clima: 'Lluvias' })] }, RANGO_D182));
      const dia = ((g2.filas || []).filter(x => x.fecha === '2020-01-21'));
      t.ok('lote de 2 ok', g2.ok === true && g2.guardadas === 2, g2);
      t.ok('gana el ÚLTIMO del lote: todo el día 21 queda «Lluvias»', dia.length === 2 && dia.every(x => x.clima === 'Lluvias'), dia.map(x => [x.id_registro, x.clima, x.version]));
      const od2 = filaDe(g2, 'seed-dg-clima-o');
      t.ok('drenajes conserva su área/CC al editarla (sigue siendo odt: 3701.06.01)', !!od2 && od2.centro_de_costo === '3701.06.01', od2);
      const v = await api.obra.post(Object.assign({ token: tok, action: 'data_grid_guardar',
        cambios: [Object.assign(visiblesDe(ti1), { op: 'update', if_version: ti1.version, clima: 'Soleado' })] }, RANGO_D182));
      t.ok('if_version viejo con clima → conflicto y rollback (nada se propaga)', v.ok === false && v.error === 'version' && (v.filas || []).filter(x => x.fecha === '2020-01-21').every(x => x.clima === 'Lluvias'), v); } },

  { id: 'obra.data_grid.alta_d182', modulo: 'obra', escribe: true, nombre: 'POST data_grid_guardar alta sin liberación ni clima (D182) → liberación CAMPO y hereda el clima del DÍA; en un día sin clima queda ""; fuera de catálogo, PROYECTO sale de la UF (D04)',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('data_grid es DB-only del Worker (4.01/D181)');
      const tok = await api.sesion('jefe'), id1 = 'dg-' + api.uuid(), id2 = 'dg-' + api.uuid(), id3 = 'dg-' + api.uuid();
      const base = { op: 'alta', descripcion: 'Terraplenes', elemento: 'tm2 pk 10+000 - 11+000', largo: 10, espesor: 1, fc: 1 };
      const g = await api.obra.post(Object.assign({ token: tok, action: 'data_grid_guardar', cambios: [
        Object.assign({ id_registro: id1, fecha: '2020-01-22' }, base), Object.assign({ id_registro: id2, fecha: '2020-01-24' }, base),
        Object.assign({ id_registro: id3, fecha: '2020-01-24' }, base, { descripcion: 'Actividad nueva fuera de catálogo', centro_de_costo: '3701.99.02' })] }, RANGO_D182));
      t.ok('altas ok, sin propagar nada', g.ok === true && g.guardadas === 3 && g.clima_propagadas === 0, g);
      const a = filaDe(g, id1), b = filaDe(g, id2), n = filaDe(g, id3);
      t.ok('liberación por defecto CAMPO', !!a && !!b && a.liberacion === 'CAMPO' && b.liberacion === 'CAMPO', [a, b]);
      t.ok('hereda el clima del día 22 (Lluvias)', !!a && a.clima === 'Lluvias', a);
      t.ok('día 24 sin clima → ""', !!b && b.clima === '', b);
      t.ok('orden/proyecto del catálogo (Terraplenes UF1 → 3701 / 12)', !!a && a.proyecto === '3701' && a.orden === '12', a);
      t.ok('fuera de catálogo: PROYECTO de la UF del subtramo (UF1 → 3701) y ORDEN vacío', !!n && n.proyecto === '3701' && n.orden === '' && n.centro_de_costo === '3701.99.02', n);
      // limpieza: las altas se dan de baja, así el caso no deja filas en el destino (contra una URL, con --escribir)
      const l = await api.obra.post(Object.assign({ token: tok, action: 'data_grid_guardar',
        cambios: [a, b, n].filter(Boolean).map(x => ({ op: 'baja', id_registro: x.id_registro, if_version: x.version })) }, RANGO_D182));
      t.ok('limpieza: las altas dadas de baja, sin tocar el clima de sus días', l.ok === true && [id1, id2, id3].every(id => !filaDe(l, id)) && l.clima_propagadas === 0, l); } },

  { id: 'obra.data_grid.clima_op_d182', modulo: 'obra', escribe: true, nombre: 'POST data_grid_guardar {op:"clima"} (D182): fija el clima del DÍA en todas sus filas SIN reescribirlas ni re-derivarlas; la fila D71 conserva su área al corregirla; un reenvío de tierras lleva su clima a las otras áreas',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('data_grid es DB-only del Worker (4.01/D181)');
      const tok = await api.sesion('jefe');
      const r0 = await api.obra.get(Object.assign({ action: 'data_grid', token: tok }, RANGO_D182B));
      const ti = filaDe(r0, 'seed-dg-op-t'), d71 = filaDe(r0, 'seed-dg-op-d71');
      t.ok('semillas presentes (el día 27 muestra Soleado en las dos)', !!ti && !!d71 && ti.clima === 'Soleado' && d71.clima === 'Soleado', [ti, d71]);
      if (!ti || !d71) return;
      const mal = await api.obra.post(Object.assign({ token: tok, action: 'data_grid_guardar', cambios: [{ op: 'clima', fecha: '2020-01-27' }] }, RANGO_D182B));
      t.ok('op clima sin la clave clima → error explícito (no vacía el día)', mal.ok === false && /sin el clima/.test(String(mal.error)), mal);
      const g = await api.obra.post(Object.assign({ token: tok, action: 'data_grid_guardar', cambios: [{ op: 'clima', fecha: '2020-01-27', clima: 'Lluvias' }] }, RANGO_D182B));
      t.ok('ok, guardadas:1, clima_propagadas:2 (las dos filas del día)', g.ok === true && g.guardadas === 1 && g.clima_propagadas === 2, g);
      const ti1 = filaDe(g, 'seed-dg-op-t'), d711 = filaDe(g, 'seed-dg-op-d71');
      t.ok('las dos: clima Lluvias, version+1, editado_por jefe', !!ti1 && !!d711 && ti1.clima === 'Lluvias' && d711.clima === 'Lluvias'
        && ti1.version === ti.version + 1 && d711.version === d71.version + 1 && ti1.editado_por === 'jefe', [ti1, d711]);
      t.ok('la fila NO se re-derivó: cantidad 50 y orden 13 como estaban (derivar daría 76.92 y 10)', !!ti1 && Number(ti1.cantidad) === 50 && ti1.orden === '13', ti1);
      t.ok('otro día intacto', (g.filas || []).filter(x => x.fecha === '2020-01-28').every(x => x.clima === 'Lluvias' && x.version === 0), (g.filas || []).filter(x => x.fecha === '2020-01-28'));
      if (!d711) return;
      const u = await api.obra.post(Object.assign({ token: tok, action: 'data_grid_guardar',
        cambios: [Object.assign(visiblesDe(d711), { op: 'update', if_version: d711.version, observacion: 'corregida' })] }, RANGO_D182B));
      const d712 = filaDe(u, 'seed-dg-op-d71');
      t.ok('corregir la fila D71 (mismo CC 3701.01.02) ok', u.ok === true && u.guardadas === 1 && !!d712 && d712.centro_de_costo === '3701.01.02', u);
      const e = await api.obra.post({ token: await api.sesion('admin'), action: 'enviar_data', fecha: '2020-01-27', area: 'tierras', clima: 'Soleado', cantidades: [
        { id_registro: 'seed-dg-op-t', area: 'tierras', estado: 'pendiente', grupo: 'TIERRAS', capitulo: 'EXPLANACIONES', actividad: 'Excavación',
          descripcion: 'Excavación en material común', centro_costo: '3701.02.05', unidad: 'm3', uf: '1', proyecto: '3701',
          pk_inicial: 'K10+100', pk_final: 'K10+200', largo: 80, observacion: '', reporta: 'ANGEL', rol: 'capataz' }] });
      t.ok('reenvío de tierras del 27 ok', e.ok === true && e.enviadas === 1, e);
      const g2 = await api.obra.get(Object.assign({ action: 'data_grid', token: tok }, RANGO_D182B));
      const d713 = filaDe(g2, 'seed-dg-op-d71');
      t.ok('la fila D71 sigue ahí (conservó area odt: el reenvío de tierras no la borró)', !!d713 && d713.observacion === 'corregida', (g2.filas || []).filter(x => x.fecha === '2020-01-27'));
      t.ok('…y tomó el clima del reenvío (Soleado) con version+1: el día no queda con dos climas', !!d713 && !!d712 && d713.clima === 'Soleado' && d713.version === d712.version + 1, d713); } },

  { id: 'obra.data_grid.clima_origen_d182', modulo: 'obra', escribe: true, nombre: 'POST data_grid_guardar (D182): una baja o un cambio de fecha que se lleva la única fila con el clima del día NO lo borra; la fila movida sin clave clima toma el del día de DESTINO',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('data_grid es DB-only del Worker (4.01/D181)');
      const tok = await api.sesion('jefe');
      const r0 = await api.obra.get(Object.assign({ action: 'data_grid', token: tok }, RANGO_D182B));
      const dia = (r, f) => ((r && r.filas) || []).filter(x => x.fecha === f);
      const port = filaDe(r0, 'seed-dg-port'), mov = filaDe(r0, 'seed-dg-mov');
      t.ok('semillas presentes: el 28 muestra Lluvias y el 29 Soleado en todas sus filas', !!port && !!mov
        && dia(r0, '2020-01-28').length === 3 && dia(r0, '2020-01-28').every(x => x.clima === 'Lluvias')
        && dia(r0, '2020-01-29').length === 2 && dia(r0, '2020-01-29').every(x => x.clima === 'Soleado'), [dia(r0, '2020-01-28'), dia(r0, '2020-01-29')]);
      if (!port || !mov) return;
      const b = await api.obra.post(Object.assign({ token: tok, action: 'data_grid_guardar', cambios: [{ op: 'baja', id_registro: 'seed-dg-port', if_version: port.version }] }, RANGO_D182B));
      t.ok('baja de la única fila con clima: ok y el clima pasa a las 2 que quedan', b.ok === true && b.clima_propagadas === 2, b);
      t.ok('el 28 sigue en Lluvias', dia(b, '2020-01-28').length === 2 && dia(b, '2020-01-28').every(x => x.clima === 'Lluvias'), dia(b, '2020-01-28'));
      const m = await api.obra.post(Object.assign({ token: tok, action: 'data_grid_guardar',
        cambios: [Object.assign(visiblesDe(mov), { op: 'update', if_version: mov.version, fecha: '2020-01-30' })] }, RANGO_D182B));
      t.ok('cambio de fecha 29 → 30 sin clave clima: ok', m.ok === true && m.guardadas === 1, m);
      const mv = filaDe(m, 'seed-dg-mov'), dst = filaDe(m, 'seed-dg-dest-o'), org = filaDe(m, 'seed-dg-mov-o');
      t.ok('la fila movida toma el clima del día de destino (Lluvias), no su Soleado viejo', !!mv && mv.fecha === '2020-01-30' && mv.clima === 'Lluvias', mv);
      t.ok('drenajes del 30 sigue en Lluvias (el clima viejo, con "timestamp" anterior, no se volvió el del día)', !!dst && dst.clima === 'Lluvias', dst);
      t.ok('el 29 conserva Soleado en la fila que queda', !!org && org.clima === 'Soleado', org); } },

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

  { id: 'obra.enviar_data.sin_sello_d182', modulo: 'obra', escribe: true, nombre: 'POST enviar_data tierras (D182): el clima va a su columna y la OBSERVACIÓN llega SIN sello «[Clima: …]»; climaPorDia (copiado del jefe) sigue igual',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('D182 es del Worker: el .gs (vuelta atrás) sigue sellando la observación (D130) y no tiene data_grid');
      const tok = await api.sesion('admin'), id = api.uuid();
      const linea = { id_registro: id, area: 'tierras', estado: 'pendiente', grupo: 'TIERRAS', capitulo: 'EXPLANACIONES', actividad: 'Excavación',
        descripcion: 'Excavación en material común', centro_costo: '3701.02.05', unidad: 'm3', uf: '1', proyecto: '3701',
        pk_inicial: 'K10+100', pk_final: 'K10+200', largo: 80, observacion: 'nota del capataz', reporta: 'ANGEL', rol: 'capataz' };
      const e = await api.obra.post({ token: tok, action: 'enviar_data', fecha: api.FECHA_BANCO, area: 'tierras', clima: 'Soleado', cantidades: [linea] });
      t.ok('ok, enviadas:1', e.ok === true && e.enviadas === 1, e);
      const g = await api.obra.get({ action: 'data_grid', desde: api.FECHA_BANCO, hasta: api.FECHA_BANCO, token: tok });
      const f = filaDe(g, id);
      t.ok('la observación llega tal cual, sin sello', !!f && f.observacion === 'nota del capataz' && !/\[Clima:/i.test(f.observacion), f);
      t.ok('el clima va en su columna', !!f && f.clima === 'Soleado', f);
      const c = await api.obra.get({ action: 'consolidado', desde: api.FECHA_BANCO, hasta: api.FECHA_BANCO, token: tok });
      t.ok('consolidado.climaPorDia (de donde el jefe arma su sello, D131) trae el clima', !!c.climaPorDia && c.climaPorDia[api.FECHA_BANCO] === 'Soleado', c.climaPorDia);
      t.ok('…y ninguna fila del consolidado lleva el sello en OBSERVACION', esLista(c.filas) && c.filas.every(x => !/\[Clima:/i.test(String(x[18] || ''))), (c.filas || []).map(x => x[18]));
      // limpieza: reenviar tierras sin filas pisa el día del área (D69) y deja DATA de FECHA_BANCO como estaba
      const l = await api.obra.post({ token: tok, action: 'enviar_data', fecha: api.FECHA_BANCO, area: 'tierras', clima: 'Soleado', cantidades: [] });
      t.ok('limpieza: ok, enviadas:0', l.ok === true && l.enviadas === 0, l); } },

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
      t.ok('tablero (público) no se anota', LOG().length === antes + 1, LOG().length); } },

  /* ---------- V3-11 Fase A / D183: módulo de Proyección editable (DB-only del Worker) ----------
   * Semillas = 006_proyeccion.sql (los valores del Excel del jefe). Las escrituras del plan van sobre periodos de
   * BANCO (2020-01 … 2020-03) y se limpian; contrato/rendimiento/parámetros solo se editan contra el banco local
   * (127.0.0.1 / PGlite) y se restauran al final. `proyeccion_tablero_paridad` corre ANTES de cualquier escritura. */
  { id: 'obra.proyeccion.leer', modulo: 'obra', nombre: 'GET proyeccion (V3-11/D183) → {ok, tablas{plan,contrato,rendimiento,parametros}{columnas,filas}, actas, puede_editar, roles_editan}; 17 periodos sembrados; el jefe edita, el residente solo ve',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('proyeccion es DB-only del Worker (4.01/D183); no está en el .gs vm');
      const r = await api.obra.get({ action: 'proyeccion', token: await api.sesion('jefe') });
      const tb = (r && r.tablas) || {};
      t.ok('forma', r.ok === true && PROY_TABLAS.every(k => tb[k] && esLista(tb[k].columnas) && esLista(tb[k].filas)) && esLista(r.actas)
        && JSON.stringify(r.roles_editan) === JSON.stringify(['admin', 'jefe']), r);
      t.ok('columnas {k, etiqueta, tipo, edita} en las 4 pestañas', PROY_TABLAS.every(k => (tb[k] ? tb[k].columnas : []).every(c => tiene(c, ['k', 'etiqueta', 'tipo', 'edita']))), tb.plan && tb.plan.columnas);
      t.ok('actas [{acta, fi, ff}] de la tabla periodos', (r.actas || []).length > 0 && (r.actas || []).every(a => tiene(a, ['acta', 'fi', 'ff']) && esFecha(a.fi) && esFecha(a.ff)), r.actas);
      const plan = proyPlan(r), local = proyBancoLocal(api);
      if (local) t.ok('17 periodos sembrados (2025-08 … 2026-12)', plan.length === 17 && plan[0].periodo === '2025-08-01' && plan[16].periodo === '2026-12-01', plan.map(f => f.periodo));
      else t.ok('el plan trae periodos', plan.length > 0, plan.length);
      const s = plan.filter(f => f.periodo === '2026-09-01')[0];
      t.ok('fila del plan: periodo, 5 partidas, formulas{}, acta, version, editado_por, editado_ts', !!s && tiene(s, ['periodo', 'excavacion', 'terraplen', 'subbase', 'base', 'noaprov', 'formulas', 'acta', 'version', 'editado_por', 'editado_ts'])
        && !!s.formulas && typeof s.formulas === 'object', s);
      t.ok('el periodo 2026-09 es el acta 23 (cierra el 15-sep)', !!s && s.acta === '23', s);
      if (local) {
        const n = plan.filter(f => f.periodo === '2025-11-01')[0];
        t.ok('celda vacía (H6: base de 2025-11) → "" y fórmula de B6 guardada', !!n && n.base === '' && n.formulas.excavacion === '=47724+3413', n);
        t.ok('contrato: 9 filas (4 partidas × UF1/UF2 + préstamo sin UF)', tb.contrato.filas.length === 9 && tb.contrato.filas.some(f => f.partida === 'prestamo' && f.uf === ''), tb.contrato.filas);
        t.ok('rendimiento: suelto_equipo = rend × fc (1105 / 585 / 455 / 611)', proyExacto(proyObj(tb.rendimiento.filas, 'suelto_equipo'), PROY_PARIDAD.proyectado), tb.rendimiento.filas);
        const p = tb.parametros.filas[0];
        t.ok('parámetros: fc 1.3, acta base 22, corte 2026-08-16', !!p && p.fc === 1.3 && p.acta_base === '22' && p.base_corte === '2026-08-16', p);
      }
      t.ok('jefe: puede_editar true (lo decide el SERVIDOR)', r.puede_editar === true, r.puede_editar);
      const adm = await api.obra.get({ action: 'proyeccion', token: await api.sesion('admin') });
      t.ok('admin: puede_editar true', adm.ok === true && adm.puede_editar === true, adm.puede_editar);
      const res = await api.obra.get({ action: 'proyeccion', token: await api.sesion('residente') });
      t.ok('residente: lee (ok) con puede_editar false', res.ok === true && res.puede_editar === false, { ok: res.ok, puede_editar: res.puede_editar, error: res.error }); } },

  { id: 'obra.proyeccion.tablero_paridad', modulo: 'obra', nombre: 'GET proyeccion_tablero (D183) ANTES de escribir = lo que hoy saca el tablero del Excel y de sus constantes (plan CALCULOS, proyectado P1:T1, CONTRATO, BASE_ACUM, BASE_CORTE, FC_DEFECTO); sin token → auth:false',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('proyeccion_tablero es DB-only del Worker (4.01/D183)');
      const sin = await api.obra.get({ action: 'proyeccion_tablero' });
      t.ok('sin token → auth:false (NO es pública: la lectura pública sigue siendo la foto, D161)', sin.ok === false && sin.auth === false, sin);
      const r = await api.obra.get({ action: 'proyeccion_tablero', token: await api.sesion('residente') });
      t.ok('forma {ok, fuente:"galca", actualizado, usuario, fc, acta_base, base_corte, plan, proyectado, contrato, base_acum}', r.ok === true && r.fuente === 'galca'
        && tiene(r, ['actualizado', 'usuario', 'fc', 'acta_base', 'base_corte', 'plan', 'proyectado', 'contrato', 'base_acum']) && esFecha(r.base_corte), r);
      const ks = Object.keys(r.plan || {});
      t.ok('plan: claves YYYY-MM, sin la fantasma 1899-12, SIEMPRE las 5 partidas numéricas', ks.length > 0 && ks.every(k => /^\d{4}-\d{2}$/.test(k)) && ks.indexOf('1899-12') < 0
        && ks.every(k => Object.keys(r.plan[k]).length === 5 && PROY_COLS.every(p => typeof r.plan[k][p] === 'number')), r.plan);
      t.ok('contrato y base_acum con las 5 partidas; proyectado con 4', PROY_PARTIDAS.every(k => typeof (r.contrato || {})[k] === 'number' && typeof (r.base_acum || {})[k] === 'number')
        && Object.keys(r.proyectado || {}).length === 4, r);
      if (!proyBancoLocal(api)) return;   // contra una URL real los valores pueden estar editados: solo la forma
      t.ok('17 periodos 2025-08 … 2026-12', ks.length === 17 && ks[0] === '2025-08' && ks[16] === '2026-12', ks);
      t.ok('plan 2026-09 = 24495.6 / 20413 / 3913 / 5016 / 4899.12 (CALCULOS fila 16)', proyExacto(r.plan['2026-09'], PROY_PARIDAD.plan_2026_09), r.plan['2026-09']);
      t.ok('plan 2025-11: base vacía (H6) → 0', !!r.plan['2025-11'] && r.plan['2025-11'].base === 0, r.plan['2025-11']);
      t.ok('plan 2026-12: excavación / terraplén / no aprov vacías → 0', !!r.plan['2026-12'] && r.plan['2026-12'].excavacion === 0 && r.plan['2026-12'].terraplen === 0 && r.plan['2026-12'].noaprov === 0 && r.plan['2026-12'].base === 6694, r.plan['2026-12']);
      t.ok('proyectado = rend × fc en numeric: 1105 / 585 / 455 / 611 (CALCULOS P1:T1)', proyExacto(r.proyectado, PROY_PARIDAD.proyectado), r.proyectado);
      t.ok('contrato = CONTRATO (UF1+UF2 en numeric): 747202.97 / 665465.73 / 84203.87 / 92573.49 / 168462', proyExacto(r.contrato, PROY_PARIDAD.contrato), r.contrato);
      t.ok('base_acum = BASE_ACUM: 549153.95 / 385854.98 / 46523.83 / 38103.26 / 51895', proyExacto(r.base_acum, PROY_PARIDAD.base_acum), r.base_acum);
      t.ok('base_corte 2026-08-16 (BASE_CORTE = cierre del acta 22 + 1 día) y fc 1.3 (FC_DEFECTO)', r.base_corte === '2026-08-16' && r.acta_base === '22' && r.fc === 1.3, r);
      t.ok('sin ediciones todavía: actualizado "" y usuario ""', r.actualizado === '' && r.usuario === '', r); } },

  { id: 'obra.proyeccion.plan_ciclo', modulo: 'obra', escribe: true, nombre: 'POST proyeccion_guardar (D183) sobre el periodo de BANCO 2020-01: alta → update (versión nueva de la secuencia, editado_por, el número limpia la fórmula) → if_version viejo = conflicto con rollback de TODO el lote → alta duplicada = «duplicado» → baja → re-alta SIN repetir versión (ABA) → baja; queda limpio',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('proyeccion es DB-only del Worker (4.01/D183)');
      const tok = await api.sesion('jefe');
      await proyLimpiarBanco(api, tok);
      const n0 = proyPlan(await api.obra.get({ action: 'proyeccion', token: tok })).length;
      const a = await api.obra.post({ token: tok, action: 'proyeccion_guardar', cambios: [
        { tabla: 'plan', op: 'alta', periodo: '2020-01', excavacion: 100, terraplen: '', subbase: '12,5', formulas: { excavacion: '=40+60' } }] });
      let f = proyFila(a, 'plan', x => x.periodo === '2020-01-01');
      t.ok('alta ok (guardadas:1); el periodo YYYY-MM queda YYYY-MM-01', a.ok === true && a.guardadas === 1 && !!f, a);
      // Versiones del plan: salen de la secuencia proy_plan_version_seq (revisión D183), no de 0 / version+1.
      const v0 = f ? f.version : -1;
      t.ok('alta: versión > 0 (de la secuencia), editado_por jefe (del token), vacío → "", coma decimal, fórmula guardada', !!f && v0 > 0 && f.editado_por === 'jefe' && f.excavacion === 100
        && f.terraplen === '' && f.subbase === 12.5 && f.base === '' && f.formulas.excavacion === '=40+60' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(f.editado_ts), f);
      const u = await api.obra.post({ token: tok, action: 'proyeccion_guardar', cambios: [
        { tabla: 'plan', op: 'update', periodo: '2020-01-01', if_version: v0, excavacion: 150 }] });
      f = proyFila(u, 'plan', x => x.periodo === '2020-01-01');
      const v1 = f ? f.version : -1;
      t.ok('update con if_version bueno → versión nueva (mayor), valor nuevo, la subbase (no vino) intacta', u.ok === true && u.guardadas === 1 && !!f && v1 > v0 && f.excavacion === 150 && f.subbase === 12.5 && f.editado_por === 'jefe', f);
      t.ok('teclear un número limpia la fórmula de esa columna', !!f && f.formulas.excavacion === undefined, f && f.formulas);
      const v = await api.obra.post({ token: tok, action: 'proyeccion_guardar', cambios: [
        { tabla: 'plan', op: 'alta', periodo: '2020-02', excavacion: 1 },
        { tabla: 'plan', op: 'update', periodo: '2020-01', if_version: v0, excavacion: 999 }] });
      t.ok('if_version viejo → {ok:false, error:"version", conflictos:[{tabla:"plan", clave:"2020-01-01", motivo:"version"}], mensaje}', v.ok === false && v.error === 'version' && esLista(v.conflictos)
        && v.conflictos.length === 1 && v.conflictos[0].tabla === 'plan' && v.conflictos[0].clave === '2020-01-01' && v.conflictos[0].motivo === 'version' && typeof v.mensaje === 'string', v);
      f = proyFila(v, 'plan', x => x.periodo === '2020-01-01');
      t.ok('rollback de TODO el lote: el alta 2020-02 no quedó y 2020-01 sigue en 150 con su versión (payload fresco)', !proyFila(v, 'plan', x => x.periodo === '2020-02-01') && !!f && f.excavacion === 150 && f.version === v1,
        proyPlan(v).filter(x => x.periodo < '2021').map(x => x.periodo + ':' + x.excavacion + ':v' + x.version));
      const d = await api.obra.post({ token: tok, action: 'proyeccion_guardar', cambios: [{ tabla: 'plan', op: 'alta', periodo: '2020-01-01', excavacion: 5 }] });
      t.ok('alta de un periodo que ya existe → conflicto «duplicado» (no cuenta como guardada)', d.ok === false && d.error === 'version' && esLista(d.conflictos) && d.conflictos.length === 1
        && d.conflictos[0].motivo === 'duplicado' && d.guardadas === undefined && /ya existe/.test(String(d.mensaje)), d);
      f = proyFila(d, 'plan', x => x.periodo === '2020-01-01');
      t.ok('…y no pisó nada', !!f && f.excavacion === 150 && f.version === v1, f);
      const b = await api.obra.post({ token: tok, action: 'proyeccion_guardar', cambios: [{ tabla: 'plan', op: 'baja', periodo: '2020-01', if_version: v1 }] });
      t.ok('baja con su version → ok, el periodo desaparece y el plan queda como estaba', b.ok === true && b.guardadas === 1 && !proyFila(b, 'plan', x => x.periodo === '2020-01-01') && proyPlan(b).length === n0,
        { ok: b.ok, error: b.error, n: proyPlan(b).length, n0 });
      // ABA: otra persona lo vuelve a crear; quien tenga la foto de su primera vida (v0 o v1) CHOCA, no lo pisa.
      const ra = await api.obra.post({ token: tok, action: 'proyeccion_guardar', cambios: [{ tabla: 'plan', op: 'alta', periodo: '2020-01', excavacion: 77 }] });
      f = proyFila(ra, 'plan', x => x.periodo === '2020-01-01');
      const v2 = f ? f.version : -1;
      t.ok('re-alta del periodo borrado → una versión que NO había tenido (ni la del alta ni la de la corrección)', ra.ok === true && !!f && v2 > v1 && v2 !== v0, { v0, v1, v2 });
      const viejo = await api.obra.post({ token: tok, action: 'proyeccion_guardar', cambios: [{ tabla: 'plan', op: 'update', periodo: '2020-01', if_version: v1, excavacion: 1 }] });
      f = proyFila(viejo, 'plan', x => x.periodo === '2020-01-01');
      t.ok('update con la versión de su vida anterior → conflicto «version» y el 77 sigue (sin ABA)', viejo.ok === false && viejo.error === 'version' && !!f && f.excavacion === 77 && f.version === v2, viejo.conflictos || viejo);
      const b2 = await api.obra.post({ token: tok, action: 'proyeccion_guardar', cambios: [{ tabla: 'plan', op: 'baja', periodo: '2020-01', if_version: v2 }] });
      t.ok('baja final con su versión → el plan queda como estaba', b2.ok === true && !proyFila(b2, 'plan', x => x.periodo === '2020-01-01') && proyPlan(b2).length === n0, { ok: b2.ok, error: b2.error }); } },

  { id: 'obra.proyeccion.if_version', modulo: 'obra', escribe: true, nombre: 'POST proyeccion_guardar (D183): update o baja SIN if_version → rechazo legible y nada cambia (DATA lo convertía en 0)',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('proyeccion es DB-only del Worker (4.01/D183)');
      const tok = await api.sesion('jefe');
      const r0 = await api.obra.get({ action: 'proyeccion', token: tok });
      const u = await api.obra.post({ token: tok, action: 'proyeccion_guardar', cambios: [{ tabla: 'plan', op: 'update', periodo: '2026-09', terraplen: 1 }] });
      t.ok('update del plan sin if_version → ok:false legible', proyLegible(u) && /versi/i.test(u.error), u);
      const b = await api.obra.post({ token: tok, action: 'proyeccion_guardar', cambios: [{ tabla: 'plan', op: 'baja', periodo: '2026-09' }] });
      t.ok('baja sin if_version → ok:false legible', proyLegible(b) && /versi/i.test(b.error), b);
      const p = await api.obra.post({ token: tok, action: 'proyeccion_guardar', cambios: [{ tabla: 'parametros', op: 'update', fc: 1.3 }] });
      t.ok('parámetros sin if_version → ok:false legible', proyLegible(p) && /versi/i.test(p.error), p);
      const r1 = await api.obra.get({ action: 'proyeccion', token: tok });
      t.ok('nada cambió en las 4 tablas', JSON.stringify(r0.tablas) === JSON.stringify(r1.tablas), ''); } },

  { id: 'obra.proyeccion.invalidos', modulo: 'obra', escribe: true, nombre: 'POST proyeccion_guardar (D183): FC 0, rendimiento negativo, acta base «x», partida fuera de catálogo, alta en contrato, préstamo con UF, plan negativo, periodo imposible, campo fuera de la lista blanca… → error LEGIBLE (nunca 500) y nada cambia',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('proyeccion es DB-only del Worker (4.01/D183)');
      const tok = await api.sesion('jefe');
      const r0 = await api.obra.get({ action: 'proyeccion', token: tok });
      const par = r0.tablas.parametros.filas[0];
      const ren = proyFila(r0, 'rendimiento', x => x.partida === 'terraplen');
      const con = proyFila(r0, 'contrato', x => x.partida === 'excavacion' && x.uf === 'UF1');
      const s = proyFila(r0, 'plan', x => x.periodo === '2026-09-01');
      const malos = [
        ['FC 0', { tabla: 'parametros', op: 'update', if_version: par.version, fc: 0 }, /FC/],
        ['FC 9 (fuera de lo razonable)', { tabla: 'parametros', op: 'update', if_version: par.version, fc: 9 }, /FC/],
        ['rendimiento negativo', { tabla: 'rendimiento', op: 'update', partida: 'terraplen', if_version: ren.version, rend_compacto_equipo: -5 }, /negativo/],
        ['rendimiento 0', { tabla: 'rendimiento', op: 'update', partida: 'terraplen', if_version: ren.version, rend_compacto_equipo: 0 }, /mayor que 0/],
        ['acta base «x»', { tabla: 'parametros', op: 'update', if_version: par.version, acta_base: 'x' }, /acta base/i],
        ['partida fuera de catálogo', { tabla: 'contrato', op: 'update', partida: 'asfalto', uf: 'UF1', if_version: 0, programado: 1 }, /partida/i],
        ['alta en contrato', { tabla: 'contrato', op: 'alta', partida: 'excavacion', uf: 'UF1', programado: 1 }, /solo se corrigen/],
        ['baja en rendimiento', { tabla: 'rendimiento', op: 'baja', partida: 'base', if_version: 0 }, /solo se corrigen/],
        ['préstamo con UF', { tabla: 'contrato', op: 'update', partida: 'prestamo', uf: 'UF1', if_version: 0, programado: 1 }, /sin UF/],
        ['excavación sin UF', { tabla: 'contrato', op: 'update', partida: 'excavacion', uf: '', if_version: con.version, programado: 1 }, /UF1 o UF2/],
        ['programado vacío', { tabla: 'contrato', op: 'update', partida: 'excavacion', uf: 'UF1', if_version: con.version, programado: '' }, /vac/],
        ['plan negativo', { tabla: 'plan', op: 'update', periodo: '2026-09', if_version: s.version, base: -1 }, /negativo/],
        ['periodo imposible (2026-13)', { tabla: 'plan', op: 'alta', periodo: '2026-13', excavacion: 1 }, /periodo/i],
        ['campo fuera de la lista blanca', { tabla: 'rendimiento', op: 'update', partida: 'base', if_version: 0, obra_id: 'otra' }, /obra_id/],
        ['fórmula sin «=»', { tabla: 'plan', op: 'alta', periodo: '2020-03', excavacion: 2, formulas: { excavacion: '1+1' } }, /fórmula/i],
        // revisión D183: if_version de solo espacios no vale como 0; una fórmula viaja con su número; formulas:{} no es un cambio
        ['update con if_version de solo espacios', { tabla: 'plan', op: 'update', periodo: '2026-09', if_version: ' ', terraplen: 1 }, /versi/],
        ['baja con if_version de un tabulador', { tabla: 'plan', op: 'baja', periodo: '2026-09', if_version: '\t' }, /versi/],
        ['fórmula sin el número de su columna', { tabla: 'plan', op: 'update', periodo: '2026-09', if_version: s.version, formulas: { subbase: '=1+1' } }, /sin su resultado/],
        ['fórmula en una celda vacía (alta)', { tabla: 'plan', op: 'alta', periodo: '2020-03', excavacion: '', formulas: { excavacion: '=1+1' } }, /sin su resultado/],
        ['update que solo trae formulas:{}', { tabla: 'plan', op: 'update', periodo: '2026-09', if_version: s.version, formulas: {} }, /nada que guardar/],
        ['tabla desconocida', { tabla: 'maquinaria', op: 'update' }, null]
      ];
      for (const [nombre, cambio, re] of malos) {
        const r = await api.obra.post({ token: tok, action: 'proyeccion_guardar', cambios: [cambio] });
        if (re) t.ok(nombre + ' → error legible', proyLegible(r) && re.test(r.error), r);
        else t.ok(nombre + ' → D166 payload con el campo (no 500)', r.ok === false && r.error === 'payload' && r.campo === 'cambios[0].tabla', r);
      }
      const txt = await api.obra.post({ token: tok, action: 'proyeccion_guardar', cambios: [{ tabla: 'plan', op: 'update', periodo: '2026-09', if_version: s.version, excavacion: 'abc' }] });
      t.ok('texto donde va un número → D166 payload con el campo (no 500)', txt.ok === false && txt.error === 'payload' && txt.campo === 'cambios[0].excavacion', txt);
      const r1 = await api.obra.get({ action: 'proyeccion', token: tok });
      t.ok('nada cambió en las 4 tablas', JSON.stringify(r0.tablas) === JSON.stringify(r1.tablas), ''); } },

  { id: 'obra.proyeccion.lote_atomico', modulo: 'obra', escribe: true, nombre: 'POST proyeccion_guardar (D183): un lote de VARIAS pestañas con un cambio malo (prevalidación) o que choca (versión) no guarda NADA; la misma fila dos veces → rechazo',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('proyeccion es DB-only del Worker (4.01/D183)');
      const tok = await api.sesion('jefe');
      await proyLimpiarBanco(api, tok);
      const r0 = await api.obra.get({ action: 'proyeccion', token: tok });
      const par = r0.tablas.parametros.filas[0], ren = proyFila(r0, 'rendimiento', x => x.partida === 'subbase');
      const a = await api.obra.post({ token: tok, action: 'proyeccion_guardar', cambios: [
        { tabla: 'plan', op: 'alta', periodo: '2020-03', excavacion: 7 },
        { tabla: 'rendimiento', op: 'update', partida: 'subbase', if_version: ren.version, rend_compacto_equipo: ren.rend_compacto_equipo },
        { tabla: 'parametros', op: 'update', if_version: par.version, fc: 0 }] });
      t.ok('prevalidación: el FC 0 del 3er cambio rechaza el lote entero con texto legible', proyLegible(a) && /FC/.test(a.error), a);
      const b = await api.obra.post({ token: tok, action: 'proyeccion_guardar', cambios: [
        { tabla: 'plan', op: 'alta', periodo: '2020-03', excavacion: 7 },
        { tabla: 'rendimiento', op: 'update', partida: 'subbase', if_version: ren.version + 50, rend_compacto_equipo: ren.rend_compacto_equipo }] });
      t.ok('versión vieja en rendimiento → conflicto {tabla:"rendimiento", clave:"subbase"} + payload fresco', b.ok === false && b.error === 'version' && esLista(b.conflictos) && b.conflictos.length === 1
        && b.conflictos[0].tabla === 'rendimiento' && b.conflictos[0].clave === 'subbase' && !!b.tablas, b);
      const dup = await api.obra.post({ token: tok, action: 'proyeccion_guardar', cambios: [
        { tabla: 'plan', op: 'alta', periodo: '2020-03', excavacion: 1 },
        { tabla: 'plan', op: 'update', periodo: '2020-03-01', if_version: 0, excavacion: 2 }] });
      t.ok('la misma fila dos veces en un lote → rechazo legible', proyLegible(dup) && /dos veces/.test(dup.error), dup);
      const r1 = await api.obra.get({ action: 'proyeccion', token: tok });
      t.ok('no quedó el alta 2020-03 ni cambió nada de las 4 tablas', !proyFila(r1, 'plan', x => x.periodo === '2020-03-01') && JSON.stringify(r0.tablas) === JSON.stringify(r1.tablas), ''); } },

  { id: 'obra.proyeccion.rol', modulo: 'obra', escribe: true, nombre: 'proyeccion_guardar (D183): residente y capataz «no pueden» (editan SOLO admin y jefe) y no se toca la BD',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('proyeccion es DB-only del Worker (4.01/D183)');
      for (const perfil of ['residente', 'capataz']) {
        const r = await api.obra.post({ token: await api.sesion(perfil), action: 'proyeccion_guardar', cambios: [{ tabla: 'plan', op: 'alta', periodo: '2020-03', excavacion: 1 }] });
        t.ok(perfil + ' → «no puede» (no toca la BD)', r.ok === false && /no puede/i.test(String(r.error)), r);
      }
      const chk = await api.obra.get({ action: 'proyeccion', token: await api.sesion('jefe') });
      t.ok('no quedó el periodo 2020-03', chk.ok === true && !proyFila(chk, 'plan', x => x.periodo === '2020-03-01'), ''); } },

  { id: 'obra.proyeccion.editar_banco', modulo: 'obra', escribe: true, nombre: 'POST proyeccion_guardar (D183) contrato + rendimiento + parámetros en UN lote (solo contra el banco local): update parcial, lo ve proyeccion_tablero (sumas en numeric, rend × fc, corte del acta o por fórmula) y se restaura',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('proyeccion es DB-only del Worker (4.01/D183)');
      if (!proyBancoLocal(api)) return t.omitir('edita el contrato, los rendimientos y los parámetros de verdad: solo contra el banco local (127.0.0.1 / PGlite)');
      const tok = await api.sesion('jefe');
      const r0 = await api.obra.get({ action: 'proyeccion', token: tok });
      const con = proyFila(r0, 'contrato', x => x.partida === 'excavacion' && x.uf === 'UF1');
      const pre = proyFila(r0, 'contrato', x => x.partida === 'prestamo');
      const ren = proyFila(r0, 'rendimiento', x => x.partida === 'terraplen');
      const par = r0.tablas.parametros.filas[0];
      const g = await api.obra.post({ token: tok, action: 'proyeccion_guardar', cambios: [
        { tabla: 'contrato', op: 'update', partida: 'excavacion', uf: 'UF1', if_version: con.version, programado: 685848.33, etiqueta: 'se ignora' },
        { tabla: 'contrato', op: 'update', partida: 'prestamo', uf: '', if_version: pre.version, produccion_base: '51900,5' },
        { tabla: 'rendimiento', op: 'update', partida: 'terraplen', if_version: ren.version, rend_compacto_equipo: 460, suelto_equipo: 1 },
        { tabla: 'parametros', op: 'update', if_version: par.version, fc: 1.25, acta_base: '21', base_corte: 'se ignora' }] });
      t.ok('un solo POST con 4 cambios de 3 pestañas → ok, guardadas 4 (los derivados que llegan se ignoran)', g.ok === true && g.guardadas === 4, g);
      const c1 = proyFila(g, 'contrato', x => x.partida === 'excavacion' && x.uf === 'UF1'), p1 = proyFila(g, 'contrato', x => x.partida === 'prestamo');
      const n1 = proyFila(g, 'rendimiento', x => x.partida === 'terraplen'), q1 = g.tablas.parametros.filas[0];
      t.ok('update parcial: solo el campo que llegó; version+1 y editado_por jefe', !!c1 && !!p1 && c1.programado === 685848.33 && c1.produccion_base === con.produccion_base && c1.version === con.version + 1
        && c1.editado_por === 'jefe' && p1.produccion_base === 51900.5 && p1.programado === pre.programado, [c1, p1]);
      t.ok('rendimiento 460 → suelto 460 × 1.25 = 575; parámetros fc 1.25, acta 21 → corte 2026-07-16', !!n1 && n1.rend_compacto_equipo === 460 && n1.suelto_equipo === 575
        && q1.fc === 1.25 && q1.acta_base === '21' && q1.base_corte === '2026-07-16', [n1, q1]);
      const tb = await api.obra.get({ action: 'proyeccion_tablero', token: tok });
      t.ok('tablero: contrato.excavacion 747203.97 y base_acum.prestamo 51900.5 (numeric)', tb.contrato.excavacion === 747203.97 && tb.base_acum.prestamo === 51900.5, tb.contrato);
      t.ok('tablero: proyectado terraplén 575 y excavación 850 × 1.25 = 1062.5; fc 1.25', tb.proyectado.terraplen === 575 && tb.proyectado.excavacion === 1062.5 && tb.fc === 1.25, tb.proyectado);
      t.ok('tablero: acta base 21 → corte 2026-07-16; actualizado (Bogotá) y usuario jefe', tb.acta_base === '21' && tb.base_corte === '2026-07-16'
        && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(tb.actualizado) && tb.usuario === 'jefe', tb);
      const f27 = await api.obra.post({ token: tok, action: 'proyeccion_guardar', cambios: [{ tabla: 'parametros', op: 'update', if_version: q1.version, acta_base: '027' }] });
      const q2 = f27.ok ? f27.tablas.parametros.filas[0] : q1;
      t.ok('acta base 27 (aún no está en periodos) → corte por fórmula 2027-01-16', f27.ok === true && q2.acta_base === '27' && q2.base_corte === '2027-01-16', f27.ok ? q2 : f27);
      const back = await api.obra.post({ token: tok, action: 'proyeccion_guardar', cambios: [
        { tabla: 'contrato', op: 'update', partida: 'excavacion', uf: 'UF1', if_version: c1.version, programado: con.programado },
        { tabla: 'contrato', op: 'update', partida: 'prestamo', uf: '', if_version: p1.version, produccion_base: pre.produccion_base },
        { tabla: 'rendimiento', op: 'update', partida: 'terraplen', if_version: n1.version, rend_compacto_equipo: ren.rend_compacto_equipo },
        { tabla: 'parametros', op: 'update', if_version: q2.version, fc: par.fc, acta_base: par.acta_base }] });
      t.ok('restaurado (guardadas 4)', back.ok === true && back.guardadas === 4, back);
      const tb2 = await api.obra.get({ action: 'proyeccion_tablero', token: tok });
      t.ok('proyeccion_tablero vuelve a la paridad (contrato, base, proyectado, corte, fc)', proyExacto(tb2.contrato, PROY_PARIDAD.contrato) && proyExacto(tb2.base_acum, PROY_PARIDAD.base_acum)
        && proyExacto(tb2.proyectado, PROY_PARIDAD.proyectado) && tb2.base_corte === '2026-08-16' && tb2.fc === 1.3, tb2); } },

  /* ---------- D184 (sep-2026): DATA completa — ACTA de la fecha y FC por actividad (Worker; el .gs no) ----------
   * Fechas de BANCO 2020-06-15 / 2020-06-16 (el borde 15/16): en el banco local caen en las actas de banco B06/B07
   * de semillas.js (`periodos`); contra una URL sin ellas, la regla da '' en las dos (antes del acta 1) y el caso
   * compara con esa misma regla. Cada caso deja los días como estaban (reenvío vacío / bajas). */
  { id: 'obra.enviar_data.d184_tierras', modulo: 'obra', escribe: true, nombre: 'POST enviar_data tierras (D184): cada fila sale con ACTA de la fecha (15 → un acta, 16 → la siguiente), ESPESOR 1, FC de la actividad (terraplén 1.3, otra 1) y CANTIDAD = LARGO × ESPESOR ÷ FC redondeada',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('D184 es del Worker: el .gs (vuelta atrás) deja ACTA/ESPESOR/FC/CANTIDAD vacías para las fórmulas del Excel');
      const tok = await api.sesion('admin'), idT = api.uuid(), idO = api.uuid(), id16 = api.uuid();
      const linea = (id, cc, desc, largo, extra) => Object.assign({ id_registro: id, area: 'tierras', estado: 'pendiente', grupo: 'TIERRAS', capitulo: 'EXPLANACIONES',
        actividad: 'D184', descripcion: desc, centro_costo: cc, unidad: 'm3', uf: '1', proyecto: '3701', pk_inicial: 'K10+100', pk_final: 'K10+200',
        largo: largo, observacion: '', reporta: 'ANGEL', rol: 'capataz' }, extra || {});
      const e15 = await api.obra.post({ token: tok, action: 'enviar_data', fecha: D184_F15, area: 'tierras', clima: 'Soleado', cantidades: [
        linea(idT, '3701.02.07', 'Terraplenes (solo conformación)', 100),
        linea(idO, '3701.04.01', 'Riego de imprimación con emulsión asfáltica', 40, { grupo: 'PAVIMENTOS', capitulo: 'PAVIMENTOS ASFALTICOS', unidad: 'm2' })] });
      const e16 = await api.obra.post({ token: tok, action: 'enviar_data', fecha: D184_F16, area: 'tierras', clima: 'Soleado', cantidades: [
        linea(id16, '3701.02.07', 'Terraplenes', 13)] });   // «Terraplenes» a secas → la BASE da el texto completo (lookupDescripcion) → FC 1.3
      t.ok('envíos ok (2 filas el 15, 1 el 16)', e15.ok === true && e15.enviadas === 2 && e16.ok === true && e16.enviadas === 1, [e15, e16]);
      const g = await api.obra.get({ action: 'data_grid', desde: D184_F15, hasta: D184_F16, token: tok });
      const ft = filaDe(g, idT), fo = filaDe(g, idO), f16 = filaDe(g, id16);
      t.ok('terraplén: ESPESOR 1, FC 1.3, CANTIDAD 100 ÷ 1.3 = 76.923077 (6 decimales)', !!ft && ft.espesor === 1 && ft.fc === 1.3 && ft.cantidad === 76.923077, ft);
      t.ok('otra actividad (imprimación, sin fila en fc_actividad): ESPESOR 1, FC 1, CANTIDAD = LARGO (40)', !!fo && fo.espesor === 1 && fo.fc === 1 && fo.cantidad === 40, fo);
      t.ok('el 16: «Terraplenes» llega verbatim de la BASE y con FC 1.3 → 13 ÷ 1.3 = 10', !!f16 && f16.descripcion === 'Terraplenes (solo conformación)' && f16.fc === 1.3 && f16.cantidad === 10, f16);
      const a15 = actaD184(g.periodos, D184_F15), a16 = actaD184(g.periodos, D184_F16);
      t.ok('ACTA = la del periodo 16→15 de la FECHA (' + D184_F15 + ' → «' + a15 + '», ' + D184_F16 + ' → «' + a16 + '»)', !!ft && !!fo && !!f16 && ft.acta === a15 && fo.acta === a15 && f16.acta === a16, [ft && ft.acta, fo && fo.acta, f16 && f16.acta]);
      if (proyBancoLocal(api)) t.ok('banco local: el 15 cierra B06 y el 16 abre B07 (borde)', a15 === 'B06' && a16 === 'B07', [a15, a16]);
      // limpieza: reenviar tierras sin filas pisa el día del área (D69)
      const l15 = await api.obra.post({ token: tok, action: 'enviar_data', fecha: D184_F15, area: 'tierras', clima: 'Soleado', cantidades: [] });
      const l16 = await api.obra.post({ token: tok, action: 'enviar_data', fecha: D184_F16, area: 'tierras', clima: 'Soleado', cantidades: [] });
      t.ok('limpieza: los dos días sin filas de tierras', l15.ok === true && l16.ok === true && l15.enviadas === 0 && l16.enviadas === 0, [l15, l16]); } },

  { id: 'obra.enviar_data.d184_drenajes', modulo: 'obra', escribe: true, nombre: 'POST enviar_data drenajes (D184): la fila de ODT sale con ACTA de la fecha, ESPESOR 1, FC 1 y CANTIDAD = LARGO',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('D184 es del Worker: el .gs (vuelta atrás) deja ACTA/ESPESOR/FC/CANTIDAD vacías');
      const tok = await api.sesion('admin'), id = api.uuid();
      const e = await api.obra.post({ token: tok, action: 'enviar_data', fecha: D184_F15, area: 'odt', clima: '', cantidades: [
        { id_registro: id, area: 'odt', estado: 'pendiente', grupo: 'DRENAJES Y ESTRUCTURAS', capitulo: 'DRENAJE TRANSVERSAL', actividad: 'Excavación',
          descripcion: 'Excavaciones varias sin clasicar', centro_costo: '3701.06.01', unidad: 'm3', uf: '1', proyecto: '3701', elemento: 'ODT1-001',
          pk_inicial: '', pk_final: '', largo: 6.5, observacion: '', reporta: 'mauricio', rol: 'capataz_odt' }] });
      t.ok('envío odt ok (1 fila)', e.ok === true && e.enviadas === 1 && e.area === 'odt', e);
      const g = await api.obra.get({ action: 'data_grid', desde: D184_F15, hasta: D184_F15, token: tok });
      const f = filaDe(g, id);
      t.ok('marcador ODT y CC de drenajes', !!f && f.elemento === 'ODT1-001' && f.centro_de_costo === '3701.06.01' && f.grupo === 'DRENAJES Y ESTRUCTURAS', f);
      t.ok('ESPESOR 1, FC 1 (drenajes), CANTIDAD = LARGO (6.5)', !!f && f.espesor === 1 && f.fc === 1 && f.cantidad === 6.5, f);
      t.ok('ACTA de la fecha (la misma regla que tierras)', !!f && f.acta === actaD184(g.periodos, D184_F15) && (!proyBancoLocal(api) || f.acta === 'B06'), [f && f.acta, actaD184(g.periodos, D184_F15)]);
      const l = await api.obra.post({ token: tok, action: 'enviar_data', fecha: D184_F15, area: 'odt', clima: '', cantidades: [] });
      t.ok('limpieza: ok, enviadas:0', l.ok === true && l.enviadas === 0, l); } },

  { id: 'obra.data_grid.fc_d184', modulo: 'obra', escribe: true, nombre: 'data_grid (D184): actividades[] trae su FC; alta sin espesor/FC → 1 y el FC de la actividad; update con FC escrito → se respeta; update con espesor/FC vacíos → los defaults',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('data_grid es DB-only del Worker (4.01/D181)');
      const tok = await api.sesion('jefe'), id = 'dg-' + api.uuid(), rango = { desde: D184_F16, hasta: D184_F16 };
      const r0 = await api.obra.get(Object.assign({ action: 'data_grid', token: tok }, rango));
      const act = (d) => ((r0.actividades || []).filter(a => a.descripcion === d && a.uf === 'UF1')[0]);
      const aT = act('Terraplenes (solo conformación)'), aC = act('Terraplenes');
      t.ok('actividades[].fc: «Terraplenes (solo conformación)» 1.3; «Terraplenes» (sin fila en fc_actividad) 1; todas con un número > 0',
        !!aT && aT.fc === 1.3 && (proyBancoLocal(api) ? (!!aC && aC.fc === 1) : (!aC || aC.fc === 1)) && (r0.actividades || []).every(a => typeof a.fc === 'number' && a.fc > 0), [aT, aC]);
      const g = await api.obra.post(Object.assign({ token: tok, action: 'data_grid_guardar', cambios: [
        { op: 'alta', id_registro: id, fecha: D184_F16, descripcion: 'Terraplenes (solo conformación)', elemento: 'tm2 pk 10+000 - 11+000', largo: 130 }] }, rango));
      const a = filaDe(g, id);
      t.ok('alta sin espesor ni FC → espesor 1, FC 1.3 (la actividad), cantidad 130 ÷ 1.3 = 100, CC 3701.02.07', g.ok === true && !!a && a.espesor === 1 && a.fc === 1.3 && a.cantidad === 100 && a.centro_de_costo === '3701.02.07', a || g);
      t.ok('…y ACTA de la fecha', !!a && a.acta === actaD184(g.periodos, D184_F16) && (!proyBancoLocal(api) || a.acta === 'B07'), a && a.acta);
      if (!a) return;
      const u1 = await api.obra.post(Object.assign({ token: tok, action: 'data_grid_guardar', cambios: [Object.assign(visiblesDe(a), { op: 'update', if_version: a.version, fc: 1.8 })] }, rango));
      const b = filaDe(u1, id);
      t.ok('update con FC 1.8 escrito → se respeta y recalcula (130 ÷ 1.8 = 72.222222), version+1', u1.ok === true && !!b && b.fc === 1.8 && b.cantidad === 72.222222 && b.version === a.version + 1, b || u1);
      if (!b) return;
      const u2 = await api.obra.post(Object.assign({ token: tok, action: 'data_grid_guardar', cambios: [Object.assign(visiblesDe(b), { op: 'update', if_version: b.version, fc: '', espesor: '' })] }, rango));
      const c = filaDe(u2, id);
      t.ok('update con espesor y FC VACÍOS → los defaults (1 y 1.3) y cantidad 100', u2.ok === true && !!c && c.espesor === 1 && c.fc === 1.3 && c.cantidad === 100, c || u2);
      const l = await api.obra.post(Object.assign({ token: tok, action: 'data_grid_guardar', cambios: [{ op: 'baja', id_registro: id, if_version: (c || b).version }] }, rango));
      t.ok('limpieza: la fila dada de baja', l.ok === true && !filaDe(l, id), l); } },

  /* ---------- D185 (V3-11 Fases B+C): el Tablero EN VIVO desde la DATA de Galca ---------- */
  { id: 'obra.tablero_vivo.publico', modulo: 'obra', nombre: 'GET tablero_vivo SIN token (D185, ampliación de D161) → {ok, fuente, dias[] con la forma de leerProduccion, proy = proyeccion_tablero sin usuario, horas, horas_meta, datos_hasta, generado}; sin nombres de personas; el día sembrado = Σ CANTIDAD',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('tablero_vivo es DB-only del Worker (4.01/D185); no está en el .gs vm');
      const r = await api.obra.get({ action: 'tablero_vivo' });
      t.ok('sin token: ok:true, fuente "galca" (no pide sesión)', r.ok === true && r.fuente === 'galca' && r.auth !== false, { ok: r.ok, error: r.error, auth: r.auth });
      t.ok('forma {dias[], proy{}, horas (null u objeto), horas_meta (null o {archivo, cargado_ts}), datos_hasta, generado, fc_dias}', esLista(r.dias) && !!r.proy && typeof r.proy === 'object'
        && (r.horas === null || (typeof r.horas === 'object' && esLista(r.horas.partes)))
        && (r.horas_meta === null || JSON.stringify(Object.keys(r.horas_meta)) === JSON.stringify(['archivo', 'cargado_ts']))
        && esFecha(r.datos_hasta) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r.generado) && typeof r.fc_dias === 'number' && r.fc_dias > 0, Object.keys(r));
      t.ok('cada día con la forma EXACTA de leerProduccion (' + VIVO_FORMA.join(', ') + '), números finitos, en orden de fecha', (r.dias || []).length > 0
        && r.dias.every((d, i) => JSON.stringify(Object.keys(d)) === JSON.stringify(VIVO_FORMA) && VIVO_CAMPOS.every(k => typeof d[k] === 'number' && isFinite(d[k])) && typeof d.t === 'string' && /^\d{4}-\d{2}$/.test(d.p) && (i === 0 || r.dias[i - 1].f < d.f)), (r.dias || [])[0]);
      t.ok('datos_hasta = la última fecha', !!r.dias.length && r.datos_hasta === r.dias[r.dias.length - 1].f, r.datos_hasta);
      const ks = vivoClaves(r), malas = VIVO_PROHIBIDAS.filter(k => ks.has(k));
      t.ok('ninguna clave con nombres de personas (' + VIVO_PROHIBIDAS.join(', ') + ')', malas.length === 0, malas);
      const pt = await api.obra.get({ action: 'proyeccion_tablero', token: await api.sesion('jefe') });
      const esp = Object.assign({}, pt); delete esp.usuario; delete esp._ms;
      t.ok('proy = proyeccion_tablero SIN `usuario` (y fc_dias = proy.fc)', JSON.stringify(r.proy) === JSON.stringify(esp) && !('usuario' in r.proy) && r.fc_dias === r.proy.fc, [Object.keys(r.proy), Object.keys(esp)]);
      if (!proyBancoLocal(api)) return;   // contra una URL real: solo la forma
      const fc = r.fc_dias, d7 = r.dias.filter(d => d.f === '2020-07-07')[0], d8 = r.dias.filter(d => d.f === '2020-07-08')[0];
      const e7 = { apr: 15, pre: 3, nap: 4, exc: 22, ter1: 20, ter2: 7, ter: 27, sub1: 0, sub2: 2, sub: 2, bas1: 1.5, bas2: 0, bas: 1.5 };
      const mal7 = d7 ? Object.keys(e7).filter(k => Math.abs(d7[k] / fc - e7[k]) > 1e-9 * Math.max(1, e7[k])) : ['sin día'];
      t.ok('banco 2020-07-07: cada campo ÷ fc = Σ CANTIDAD sembrada (apr 10+5 con «*», pre 3, nap 4, ter 20/7 sin el de UF vacía, sub 0/2, bas 1.5/0; pedraplén fuera)', mal7.length === 0, { mal7, d7 });
      t.ok('…p = 2025-06 (piso) y t = «LLUVIAS PARCIALES»', !!d7 && d7.p === '2025-06' && d7.t === 'LLUVIAS PARCIALES', d7 && [d7.p, d7.t]);
      t.ok('banco 2020-07-08 [O]: el «ajuste origen UF2» llega con FC 1 (ter2 130, no 100) y las subbases de «ajuste origen UF1» 26 + 7 (la sin largo) = 33; el control 10', !!d8
        && Math.abs(d8.ter2 / fc - 130) < 1e-9 && Math.abs(d8.sub1 / fc - 33) < 1e-9 && Math.abs(d8.ter1 / fc - 10) < 1e-9, d8); } },

  { id: 'obra.tablero_vivo.cache', modulo: 'obra', nombre: 'tablero_vivo (D185): caché de 60 s por entorno — la 2ª petición anónima sale de la caché (HIT, cuerpo idéntico); token de jefe/admin la SALTA (BYPASS); residente = lector anónimo (HIT)',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('la caché es del Worker (Cache API)');
      const pedir = async (tok) => { const u = api.urls.obra + '?action=tablero_vivo' + (tok ? '&token=' + encodeURIComponent(tok) : '');
        const r = await fetch(u); return { xc: r.headers.get('X-Tablero-Cache'), cc: r.headers.get('Cache-Control'), texto: await r.text() }; };
      const a = await pedir();
      if (!a.xc) return t.omitir('el destino no deja ver X-Tablero-Cache');
      if (a.xc === 'SIN') return t.omitir('el destino no tiene Cache API (X-Tablero-Cache: SIN)');
      const b2 = await pedir();
      t.ok('2ª petición anónima: HIT con el cuerpo idéntico (mismo generado) y Cache-Control no-store hacia el cliente', b2.xc === 'HIT' && b2.texto === (a.xc === 'HIT' ? a.texto : b2.texto) && /no-store/.test(b2.cc || ''), [a.xc, b2.xc, b2.cc]);
      const j = await pedir(await api.sesion('jefe'));
      t.ok('token de JEFE: BYPASS (calcula al momento) y ok', j.xc === 'BYPASS' && JSON.parse(j.texto).ok === true, j.xc);
      const ad = await pedir(await api.sesion('admin'));
      t.ok('token de ADMIN: BYPASS', ad.xc === 'BYPASS', ad.xc);
      const c = await pedir();
      t.ok('…y deja su respuesta en la caché: el anónimo siguiente la lee (HIT = la del admin)', c.xc === 'HIT' && c.texto === ad.texto, c.xc);
      const rs = await pedir(await api.sesion('residente'));
      t.ok('residente: lector anónimo (HIT)', rs.xc === 'HIT', rs.xc); } },

  { id: 'obra.tablero_horas.guardar', modulo: 'obra', escribe: true, nombre: 'POST tablero_horas_guardar (D185): admin/jefe guardan la salida de leerHoras (comprimida) y tablero_vivo la devuelve igual con horas_meta sin quién la cargó; residente/capataz no; forma inválida → error legible; una grande (~450 KB) entra',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('tablero_horas es DB-only del Worker (4.01/D185)');
      if (!proyBancoLocal(api)) return t.omitir('pisaría las horas guardadas del entorno: solo contra el banco local');
      const h = vivoHoras(40), archivo = 'partes_banco_d185.xlsx';
      for (const rol of ['residente', 'capataz']) {
        const r = await api.obra.post({ token: await api.sesion(rol), action: 'tablero_horas_guardar', horas: h, archivo });
        t.ok(rol + ': «no puede cargar las horas…»', r.ok === false && /no puede cargar las horas/.test(String(r.error)), r);
      }
      const tj = await api.sesion('jefe');
      const inv = [
        ['horas no es un objeto', 'x', (r) => r.error === 'payload' && r.campo === 'horas'],
        ['un parte con «operador»', Object.assign({}, h, { partes: [Object.assign({ operador: 'NOMBRE APELLIDO' }, h.partes[0])] }), (r) => /«operador»/.test(r.error) && /No se guardó nada/.test(r.error)],
        ['cero partes', Object.assign({}, h, { partes: [] }), (r) => /ningún parte/.test(r.error)],
        ['un código de máquina con un nombre', Object.assign({}, h, { partes: [Object.assign({}, h.partes[0], { cod: 'NOMBRE APELLIDO' })] }), (r) => /código de máquina/.test(r.error)],
        ['horas negativas', Object.assign({}, h, { partes: [Object.assign({}, h.partes[0], { h: -1 })] }), (r) => /«h» fuera de rango/.test(r.error)]];
      const malos = [];
      for (const [n, horas, pred] of inv) { const r = await api.obra.post({ token: tj, action: 'tablero_horas_guardar', horas, archivo }); if (!(r.ok === false && pred(r))) malos.push(n + ' → ' + JSON.stringify(r).slice(0, 160)); }
      t.ok('forma inválida → error LEGIBLE (o payload D166), nunca 500 (' + inv.length + ' casos)', malos.length === 0, malos);
      const g = await api.obra.post({ token: tj, action: 'tablero_horas_guardar', horas: h, archivo });
      t.ok('JEFE guarda: ok, version, horas_meta {archivo, cargado_ts, partes 40, corte}', g.ok === true && typeof g.version === 'number' && !!g.horas_meta && g.horas_meta.archivo === archivo && g.horas_meta.partes === 40 && g.horas_meta.corte === h.corte, g);
      const v = await api.obra.get({ action: 'tablero_vivo' });
      t.ok('GET tablero_vivo (sin token) trae EXACTAMENTE esas horas y horas_meta {archivo, cargado_ts}', JSON.stringify(v.horas) === JSON.stringify(h) && !!v.horas_meta && v.horas_meta.archivo === archivo
        && JSON.stringify(Object.keys(v.horas_meta)) === JSON.stringify(['archivo', 'cargado_ts']) && esFecha(String(v.horas_meta.cargado_ts).slice(0, 10)), v.horas_meta);
      t.ok('…sin el usuario que la cargó (ni en claves ni en el texto)', VIVO_PROHIBIDAS.every(k => !vivoClaves(v).has(k)) && JSON.stringify(v).indexOf('"jefe"') < 0);
      const grande = vivoHoras(3200), n = JSON.stringify(grande).length;
      const gg = await api.obra.post({ token: await api.sesion('admin'), action: 'tablero_horas_guardar', horas: grande, archivo: 'grande.xlsx' });
      const vg = await api.obra.get({ action: 'tablero_vivo' });
      t.ok('ADMIN guarda una GRANDE (' + grande.partes.length + ' partes, ' + n + ' caracteres) y se lee igual (version + 1)', gg.ok === true && gg.version === g.version + 1 && JSON.stringify(vg.horas) === JSON.stringify(grande), gg.ok ? gg.version : gg); } },

  { id: 'obra.proyeccion.sin_conciliacion', modulo: 'obra', nombre: 'GET proyeccion (D185, decisión final 19-sep-2026) NO trae conciliación: ni conciliacion/conciliacion_error, ni columnas ni campos «DATA al corte»/«Diferencia» en el contrato (vuelve a la forma de D183)',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('proyeccion es DB-only del Worker (4.01/D183/D185)');
      const r = await api.obra.get({ action: 'proyeccion', token: await api.sesion('residente') });
      t.ok('sin claves conciliacion / conciliacion_error', r.ok === true && !('conciliacion' in r) && !('conciliacion_error' in r), Object.keys(r || {}));
      const tc = (r.tablas || {}).contrato || {};
      t.ok('columnas del contrato = partida, uf, programado, produccion_base', JSON.stringify((tc.columnas || []).map(c => c.k)) === JSON.stringify(['partida', 'uf', 'programado', 'produccion_base']), (tc.columnas || []).map(c => c.k));
      t.ok('ninguna fila del contrato lleva data_al_corte ni diferencia', esLista(tc.filas) && tc.filas.length > 0 && tc.filas.every(f => !('data_al_corte' in f) && !('diferencia' in f)), (tc.filas || [])[0]); } },

  /* ---------- D185 [O]: FC 1 en los «ajuste origen» por enviar_data y por la Revisión de DATA ---------- */
  { id: 'obra.enviar_data.ajuste_origen_d185', modulo: 'obra', escribe: true, nombre: 'POST enviar_data tierras (D185 [O]): una línea cuyo ELEMENTO es «ajuste origen UF2» sale con FC 1 (cantidad = largo), no el 1.3 de la actividad; la de un tramo normal sigue con 1.3',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('D184/D185 son del Worker: el .gs deja ESPESOR/FC/CANTIDAD vacías');
      const tok = await api.sesion('admin'), idA = api.uuid(), idN = api.uuid();
      const linea = (id, cc, extra) => Object.assign({ id_registro: id, area: 'tierras', estado: 'pendiente', grupo: 'TIERRAS', capitulo: 'EXPLANACIONES',
        actividad: 'D185', descripcion: 'Terraplenes (solo conformación)', centro_costo: cc, unidad: 'm3', largo: 130, observacion: '', reporta: 'ANGEL', rol: 'capataz' }, extra);
      const e = await api.obra.post({ token: tok, action: 'enviar_data', fecha: D185_F, area: 'tierras', clima: 'Soleado', cantidades: [
        linea(idA, '3702.02.07', { uf: '2', proyecto: '3702', elemento: 'ajuste origen UF2' }),
        linea(idN, '3701.02.07', { uf: '1', proyecto: '3701', pk_inicial: 'K10+100', pk_final: 'K10+200' })] });
      t.ok('envío ok (2 filas)', e.ok === true && e.enviadas === 2, e);
      const g = await api.obra.get({ action: 'data_grid', desde: D185_F, hasta: D185_F, token: tok });
      const a = filaDe(g, idA), n = filaDe(g, idN);
      t.ok('elemento «ajuste origen UF2» → ESPESOR 1, FC 1, CANTIDAD 130', !!a && a.elemento === 'ajuste origen UF2' && a.espesor === 1 && a.fc === 1 && a.cantidad === 130, a);
      t.ok('tramo normal → FC 1.3 de la actividad, CANTIDAD 100', !!n && n.fc === 1.3 && n.cantidad === 100, n);
      const l = await api.obra.post({ token: tok, action: 'enviar_data', fecha: D185_F, area: 'tierras', clima: 'Soleado', cantidades: [] });
      t.ok('limpieza: el día sin filas de tierras', l.ok === true && l.enviadas === 0, l); } },

  { id: 'obra.data_grid.ajuste_origen_d185', modulo: 'obra', escribe: true, nombre: 'data_grid (D185 [O]): subtramos[] marca los «ajuste origen» como no_operativo; un alta en «ajuste origen UF2» con FC vacío → 1 (cantidad = largo); llevarla a un tramo normal con FC vacío → el de la actividad',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('data_grid es DB-only del Worker (4.01/D181)');
      const tok = await api.sesion('jefe'), id = 'dg-' + api.uuid(), rango = { desde: D185_F, hasta: D185_F };
      const r0 = await api.obra.get(Object.assign({ action: 'data_grid', token: tok }, rango));
      const sub = (e) => (r0.subtramos || []).filter(s => s.elemento === e)[0];
      t.ok('subtramos[].no_operativo: «ajuste origen UF1/UF2» true, «tm2 pk 10+000 - 11+000» false', !!sub('ajuste origen UF1') && sub('ajuste origen UF1').no_operativo === true && !!sub('ajuste origen UF2') && sub('ajuste origen UF2').no_operativo === true
        && !!sub('tm2 pk 10+000 - 11+000') && sub('tm2 pk 10+000 - 11+000').no_operativo === false, [sub('ajuste origen UF2'), sub('tm2 pk 10+000 - 11+000')]);
      const g = await api.obra.post(Object.assign({ token: tok, action: 'data_grid_guardar', cambios: [
        { op: 'alta', id_registro: id, fecha: D185_F, descripcion: 'Terraplenes (solo conformación)', elemento: 'ajuste origen UF2', largo: 130 }] }, rango));
      const a = filaDe(g, id);
      t.ok('alta en «ajuste origen UF2» sin FC → ESPESOR 1, FC 1, CANTIDAD 130, UF2', g.ok === true && !!a && a.fc === 1 && a.espesor === 1 && a.cantidad === 130 && a.unidad_funcional === 'UF2', a || g);
      if (!a) return;
      const u = await api.obra.post(Object.assign({ token: tok, action: 'data_grid_guardar', cambios: [Object.assign(visiblesDe(a), { op: 'update', if_version: a.version, elemento: 'tm2 pk 10+000 - 11+000', fc: '' })] }, rango));
      const b2 = filaDe(u, id);
      t.ok('a un tramo normal con FC vacío → 1.3 de la actividad, CANTIDAD 100', u.ok === true && !!b2 && b2.fc === 1.3 && b2.cantidad === 100, b2 || u);
      const u2 = b2 ? await api.obra.post(Object.assign({ token: tok, action: 'data_grid_guardar', cambios: [Object.assign(visiblesDe(b2), { op: 'update', if_version: b2.version, elemento: 'ajuste origen UF2', fc: 1.3 })] }, rango)) : null;
      const c2 = filaDe(u2, id);
      t.ok('un FC escrito por el jefe (1.3) en un ajuste origen se respeta (la regla [O] es el valor POR DEFECTO)', !!c2 && c2.fc === 1.3 && c2.cantidad === 100, c2 || u2);
      const l = await api.obra.post(Object.assign({ token: tok, action: 'data_grid_guardar', cambios: [{ op: 'baja', id_registro: id, if_version: (c2 || b2 || a).version }] }, rango));
      t.ok('limpieza: la fila dada de baja', l.ok === true && !filaDe(l, id), l); } },

  /* ---------- D187: la DATA (y la Proyección) en CSV para el Excel maestro por Power Query «Desde la Web» ---------- */
  { id: 'obra.data_csv', modulo: 'obra', nombre: 'GET data_csv / proyeccion_csv (D187): CSV con CLAVE DE LECTURA, antes de la puerta de token — sin clave o mala → 401 texto plano; buena → text/csv UTF-8 con BOM, las 17 cabeceras de data_maestro, RFC 4180, números con punto, FECHA YYYY-MM-DD; las 4 tablas de la Proyección',
    async run(api, t){ if (api.modo === 'vm') return t.omitir('data_csv es DB-only del Worker (D187); no está en el .gs vm');
      const clave = String(process.env.CLAVE_LECTURA_EXCEL || '');
      if (!clave) return t.omitir('falta la variable de entorno CLAVE_LECTURA_EXCEL (la clave de lectura del destino; contrato_local.js la pone)');
      const pedir = async (qs) => { const r = await fetch(api.urls.obra + '?' + new URLSearchParams(qs).toString());
        const b = Buffer.from(await r.arrayBuffer()); return { st: r.status, ct: r.headers.get('Content-Type') || '', b, tx: b.toString('utf8') }; };
      const s0 = await pedir({ action: 'data_csv' });
      t.ok('sin clave → 401 en TEXTO PLANO (no el JSON {auth:false} del filtro de token)', s0.st === 401 && /^text\/plain/.test(s0.ct) && !/^\s*\{/.test(s0.tx), [s0.st, s0.ct, s0.tx.slice(0, 120)]);
      const s1 = await pedir({ action: 'data_csv', clave: clave + '-mala' });
      t.ok('clave mala → 401 texto', s1.st === 401 && /^text\/plain/.test(s1.ct), [s1.st, s1.tx.slice(0, 120)]);
      const r = await pedir({ action: 'data_csv', clave });
      t.ok('clave buena → 200 text/csv; charset=utf-8 con BOM (EF BB BF)', r.st === 200 && /^text\/csv; charset=utf-8/i.test(r.ct) && r.b[0] === 0xEF && r.b[1] === 0xBB && r.b[2] === 0xBF, [r.st, r.ct, r.tx.slice(0, 120)]);
      const { filas, err } = csvRfc4180(r.tx.replace(/^﻿/, ''));
      const cab = filas.shift() || [];
      t.ok('RFC 4180 sin errores y cabecera = las 17 de data_maestro en su orden', !err && JSON.stringify(cab) === JSON.stringify(CSV_COLS_D187), [err, cab]);
      t.ok('cada fila con 17 celdas; FECHA YYYY-MM-DD en orden; LARGO/ESPESOR/FC/CANTIDAD vacías o con punto decimal (sin miles ni exponente)', filas.length > 0
        && filas.every((f, i) => f.length === 17 && /^\d{4}-\d{2}-\d{2}$/.test(f[0]) && (i === 0 || filas[i - 1][0] <= f[0]) && [11, 12, 13, 14].every(j => f[j] === '' || /^-?\d+(\.\d+)?$/.test(f[j]))),
        filas.filter(f => f.length !== 17 || !/^\d{4}-\d{2}-\d{2}$/.test(f[0])).slice(0, 2));
      for (const tabla of ['plan', 'contrato', 'rendimiento', 'parametros']){
        const p = await pedir({ action: 'proyeccion_csv', tabla, clave });
        const x = csvRfc4180(p.tx.replace(/^﻿/, ''));
        t.ok('proyeccion_csv ' + tabla + ' → 200 text/csv con BOM, cabecera ' + CSV_PROY_D187[tabla].join(' | ') + ' y filas', p.st === 200 && /^text\/csv/.test(p.ct) && p.b[0] === 0xEF && !x.err
          && JSON.stringify(x.filas[0]) === JSON.stringify(CSV_PROY_D187[tabla]) && x.filas.length > 1 && x.filas.every(f => f.length === CSV_PROY_D187[tabla].length), [p.st, x.err, x.filas[0]]);
      }
      const pm = await pedir({ action: 'proyeccion_csv', tabla: 'otra', clave });
      t.ok('proyeccion_csv con tabla inválida → 400 texto', pm.st === 400 && /^text\/plain/.test(pm.ct), [pm.st, pm.tx.slice(0, 120)]); } }
];

/* ---------- D187: columnas del CSV y un parser RFC 4180 mínimo (comillas, "" y saltos de línea dentro de comillas) ---------- */
const CSV_COLS_D187 = ['FECHA', 'GRUPO', 'CENTRO DE COSTO', 'CAPITULO', 'DESCRIPCION', 'UNIDAD FUNCIONAL', 'ELEMENTO', 'ABS INICIAL', 'ABS FINAL',
  'ACTA', 'UNIDAD MEDIDA', 'LARGO', 'ESPESOR', 'FC', 'CANTIDAD', 'CLIMA', 'OBSERVACION'];
const CSV_PROY_D187 = { plan: ['periodo', 'EXCAVACION', 'TERRAPLEN', 'SUBBASE', 'BASE', 'NO APROV', 'ACTA'],
  contrato: ['PARTIDA', 'Programado UF1', 'Programado UF2', 'Programado', 'Produccion UF1', 'Produccion UF2', 'Produccion'],
  rendimiento: ['concepto', 'EXCAVACION', 'TERRAPLEN', 'SUBBASE', 'BASE'], parametros: ['FC', 'ACTA BASE', 'CORTE BASE'] };
function csvRfc4180(s){
  const filas = []; let fila = [], c = '', q = false, err = '';
  for (let i = 0; i < s.length; i++){ const ch = s[i];
    if (q){ if (ch === '"'){ if (s[i + 1] === '"'){ c += '"'; i++; } else q = false; } else c += ch; continue; }
    if (ch === '"'){ if (c !== '') err = err || 'comilla suelta'; q = true; }
    else if (ch === ','){ fila.push(c); c = ''; }
    else if (ch === '\r' || ch === '\n'){ if (ch === '\r' && s[i + 1] === '\n') i++; fila.push(c); c = ''; filas.push(fila); fila = []; }
    else c += ch; }
  if (q) err = err || 'comillas sin cerrar';
  if (c !== '' || fila.length){ fila.push(c); filas.push(fila); }
  return { filas, err };
}

/* ---------- D185: ayudas de los casos del Tablero en vivo (declaradas después del array; solo se usan en run()) ---------- */
const D185_F = '2020-07-09';   // fecha de BANCO libre para los envíos de [O] (semillas.js usa el 07 y el 08)
const VIVO_CAMPOS = ['exc', 'apr', 'pre', 'nap', 'ter1', 'ter2', 'ter', 'sub1', 'sub2', 'sub', 'bas1', 'bas2', 'bas'];
const VIVO_FORMA = ['f', 'p', 'exc', 'apr', 'pre', 'nap', 'ter1', 'ter2', 'ter', 'sub1', 'sub2', 'sub', 'bas1', 'bas2', 'bas', 't'];
const VIVO_PROHIBIDAS = ['usuario', 'editado_por', 'cargado_por', 'capataz', 'operador', 'reporta', 'rol'];
function vivoClaves(o, out){ out = out || new Set(); if (o && typeof o === 'object'){ if (Array.isArray(o)) o.forEach(x => vivoClaves(x, out)); else Object.keys(o).forEach(k => { out.add(k); vivoClaves(o[k], out); }); } return out; }
// n partes con la forma EXACTA de leerHoras del motor del Tablero (solo códigos, tipos, CC y horas).
function vivoHoras(n){
  const tipos = [['EXC001', 'EXCAVADORA', 'excavacion'], ['BL005', 'BULLDOZER', 'terraplen'], ['MO03', 'MOTONIVELADORA', 'subbase'], ['FNG002', 'FINISHER', 'base']];
  const partes = [];
  for (let i = 0; i < n; i++){ const tp = tipos[i % 4], d = new Date(Date.UTC(2025, 7, 1 + (i % 400))), f = d.toISOString().slice(0, 10);
    let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; if (d.getUTCDate() > 15){ m++; if (m > 12){ m = 1; y++; } }
    partes.push({ p: y + '-' + String(m).padStart(2, '0'), f, act: tp[2], cod: tp[0], tipo: tp[1], uf: i % 3 ? 'UF1' : 'UF2', h: 7.5 + (i % 5) / 10, mtto: i % 7 ? 0 : 1, varada: 0, lluvia: i % 11 ? 0 : 2.5, averia: 0 }); }
  return { partes, cc: [{ cc: '02.05', horas: 1234.5, filas: 300, act: 'excavacion', flota: 1000.25 }, { cc: '06.01', horas: 12, filas: 4, act: null, flota: 0 }],
    corte: partes[partes.length - 1].f, descartadas: 17, negativas: 1 };
}

/* ---------- D184: ayudas de los casos de DATA completa (declaradas después del array; solo se usan en run()) ---------- */
const D184_F15 = '2020-06-15', D184_F16 = '2020-06-16';   // borde 15/16 en fechas de BANCO (semillas.js: B06 / B07)
// La regla (a) de D184, escrita aparte para comparar: el periodo de `periodos` que contiene la fecha y, si no hay,
// mes de cierre (día ≤ 15 → ese mes; si no, el siguiente) y acta = (año − 2025)·12 + mes + 2; < 1 → ''.
function actaD184(periodos, fecha){
  const p = (periodos || []).filter(x => fecha >= x.fi && fecha <= x.ff)[0];
  if (p) return String(p.acta);
  let y = +fecha.slice(0, 4), m = +fecha.slice(5, 7);
  if (+fecha.slice(8, 10) > 15) { m++; if (m > 12) { m = 1; y++; } }
  const n = (y - 2025) * 12 + m + 2;
  return n >= 1 ? String(n) : '';
}

/* ---------- V3-11 / D183: ayudas de los casos de la Proyección (declaradas después del array: solo se usan
 * dentro de run(), cuando el módulo ya cargó entero) ---------- */
const PROY_TABLAS = ['plan', 'contrato', 'rendimiento', 'parametros'];
const PROY_COLS = ['excavacion', 'terraplen', 'subbase', 'base', 'noaprov'];
const PROY_PARTIDAS = ['excavacion', 'terraplen', 'subbase', 'base', 'prestamo'];
const PROY_BANCO = ['2020-01-01', '2020-02-01', '2020-03-01'];   // periodos de BANCO: no existen en el plan real
// Lo que hoy saca el tablero del Excel (CALCULOS fila 16, P1:T1) y de sus constantes (CONTRATO, BASE_ACUM).
const PROY_PARIDAD = {
  plan_2026_09: { excavacion: 24495.6, terraplen: 20413, subbase: 3913, base: 5016, noaprov: 4899.12 },
  proyectado: { excavacion: 1105, terraplen: 585, subbase: 455, base: 611 },
  contrato: { excavacion: 747202.97, terraplen: 665465.73, subbase: 84203.87, base: 92573.49, prestamo: 168462 },
  base_acum: { excavacion: 549153.95, terraplen: 385854.98, subbase: 46523.83, base: 38103.26, prestamo: 51895 }
};
// ¿El arnés corre contra el banco local (contrato_local.js: Worker + PGlite en 127.0.0.1)?
function proyBancoLocal(api){ return api.modo === 'url' && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(String((api.urls && api.urls.obra) || '')); }
function proyExacto(o, esp){ return !!o && Object.keys(esp).every(k => o[k] === esp[k]); }
function proyObj(filas, campo){ const o = {}; (filas || []).forEach(f => { o[f.partida] = f[campo]; }); return o; }
function proyPlan(r){ return (((r || {}).tablas || {}).plan || {}).filas || []; }
function proyFila(r, tabla, pred){ return ((((r || {}).tablas || {})[tabla] || {}).filas || []).filter(pred)[0]; }
// Rechazo LEGIBLE: ok:false con un texto, que no es el de D166 ('payload'), ni un 500 ('worker'), ni un conflicto.
function proyLegible(r){ return !!r && r.ok === false && typeof r.error === 'string' && r.error.length > 12 && ['payload', 'worker', 'version'].indexOf(r.error) < 0; }
// Deja el banco limpio: baja (con su versión) de los periodos de banco que hayan quedado de una corrida cortada.
async function proyLimpiarBanco(api, tok){
  const r = await api.obra.get({ action: 'proyeccion', token: tok });
  const restos = proyPlan(r).filter(f => PROY_BANCO.indexOf(f.periodo) >= 0);
  if (!restos.length) return r;
  return api.obra.post({ token: tok, action: 'proyeccion_guardar', cambios: restos.map(f => ({ tabla: 'plan', op: 'baja', periodo: f.periodo, if_version: f.version })) });
}
