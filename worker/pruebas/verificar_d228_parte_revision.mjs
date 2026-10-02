#!/usr/bin/env node
/**
 * Verificación D228 — revisión del Parte Digital: día pseudo con CC real, CC a mano, deshacer reparto, «más» actividades.
 * Funciones REALES del Worker (api/parte.js) sobre Postgres en memoria (PGlite) con el esquema 001–017:
 *
 *   1 · op=equipo: actividades.mas (tipo con >5 activas; sin duplicar habituales ni frases; respeta activo=NO).
 *   2 · op=bandeja: cc_sugerido (faltantes incluidos; ignora descartadas, pseudo y fechas posteriores; desempate por
 *       hora) y listas.cc sin Disponible / Domingo-Festivo (sí Taller).
 *   3 · op=reporte: día pseudo → CC sugerido + CC_SUGERIDO; sin historial → '' + SIN_CC; Taller intacto;
 *       sin_operacion; exención del nº de parte físico (manual sí, QR no).
 *   4 · op=revisar: cambiar CC recalcula alertas, CC a mano sin CC_DESCONOCIDO, aprobar Disponible → error,
 *       Taller se aprueba, aprobar quita CC_SUGERIDO.
 *   5 · op=deshacer_reparto: feliz, hija aprobada, re-repartida, desde id de hija, payload, permisos, auditoría.
 *   6 · 016_parte_auditoria_deshacer.sql (CHECK con deshacer_reparto) y 017_depurar_tractocamion.sql: solo los 6
 *       ítems, idempotente, respaldo una sola vez.
 *
 *   node worker/pruebas/verificar_d228_parte_revision.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPglite } from './pglite.js';
import { parteReporte, parteBandeja, parteRevisar, parteRepartir, parteEquipo, parteDeshacerReparto, parteDoPost_ } from '../src/api/parte.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL = path.join(RAIZ, 'sql');
let fallos = 0, casos = 0;
const ok = (n, c, x) => { casos++; if (!c) { fallos++; console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); } else console.log('  ✓ ' + n); };
const M17 = fs.readFileSync(path.join(SQL, '017_depurar_tractocamion.sql'), 'utf8');

const { pg, sql } = await abrirPglite();
for (const f of fs.readdirSync(SQL).filter((x) => /^0\d\d_.*\.sql$/.test(x)).sort()) await pg.exec(fs.readFileSync(path.join(SQL, f), 'utf8'));

await pg.exec(`
  INSERT INTO parte_equipos (codigo,tipo,placa,medidor,activo) VALUES
    ('CR100','CARGADOR','','HOROMETRO','SI'),('CR200','CARGADOR','','HOROMETRO','SI'),
    ('CR300','CARGADOR','','HOROMETRO','SI'),('CR400','CARGADOR','','HOROMETRO','SI'),
    ('VOL1','VOLQUETA','','KM','SI');
  INSERT INTO parte_cc (centro_coste,proyecto,descripcion_cc,usos_ult_4_meses,activo) VALUES
    ('3701.02.03','3701','Terraplén UF1',50,'SI'),('3701.07.01','3701','Cuneta UF1',20,'SI'),
    ('Taller','','Taller',0,'SI'),('Disponible','','Disponible',0,'SI'),('Domingo/Festivo','','Domingo o festivo',0,'SI');
  INSERT INTO parte_operadores (operador,activo) VALUES ('Juan Perez','SI');
  INSERT INTO parte_items (tipo_equipo,item,actividad,veces,activo) VALUES
    ('VOLQUETA','2.07','Transporte A',100,'SI'),('VOLQUETA','3.02','Transporte B',90,'SI'),('VOLQUETA','3.03','Transporte C',80,'SI'),
    ('VOLQUETA','4.03','Transporte D',70,'SI'),('VOLQUETA','5.04','Transporte E',60,'SI'),('VOLQUETA','6.02','Transporte F',50,'SI'),
    ('VOLQUETA','6.04','Transporte A',40,'SI'),('VOLQUETA','6.04','Cargue de hierro',5,'SI'),('VOLQUETA','11.04','Imprevisto',30,'NO');
`);

const ctx = (env) => ({ sql, env: env || {}, memo: {}, pet: { t0: Date.now(), log: {} } });
const ses = { ok: true, usuario: 'ana', rol: 'residente' };
const fila = (o) => sql`INSERT INTO parte_bandeja (id_registro,"timestamp",estado,fecha,codigo,medidor,reporte_num,inicial,final,hora_de,hora_a,centro_coste,descripcion_trabajo,operador,origen,alertas,observaciones)
  VALUES (${o.id}, ${o.ts || '2026-09-20T12:00:00Z'}, ${o.estado || 'pendiente'}, ${o.fecha}, ${o.codigo}, 'HOROMETRO', ${o.rep || ''}, ${o.ini ?? null}, ${o.fin ?? null},
          ${o.de || '07:00'}, ${o.a || '16:00'}, ${o.cc || ''}, ${o.desc || ''}, 'Juan Perez', 'manual', ${o.alertas || ''}, ${o.obs || ''})`;
const leer = async (id) => (await sql`SELECT * FROM parte_bandeja WHERE id_registro = ${id}`)[0];
const alertasDe = (r) => String(r.alertas || '').split(';').filter(Boolean);

console.log('\n1 · op=equipo: actividades.mas');
{
  const e = await parteEquipo(ctx(), { eq: 'VOL1' });
  const hab = e.actividades.habituales.map((x) => x.item), mas = e.actividades.mas;
  ok('ok y trae mas', e.ok === true && Array.isArray(mas), e.ok);
  ok('habituales: los 5 primeros por uso', JSON.stringify(hab) === JSON.stringify(['02.07', '03.02', '03.03', '04.03', '05.04']), hab);
  ok('mas: 06.02 y 06.04 (orden por veces), sin 11.04 (activo=NO)', JSON.stringify(mas.map((x) => x.item)) === JSON.stringify(['06.02', '06.04']), mas);
  ok('mas no repite ítems de las habituales', mas.every((m) => !hab.includes(m.item)));
  const frases = e.actividades.habituales.concat(mas).map((x) => x.actividad.toLowerCase());
  ok('ninguna frase repetida entre habituales y mas (6.04 cambia «Transporte A» por «Cargue de hierro»)', new Set(frases).size === frases.length && mas[1].actividad === 'Cargue de hierro', frases);
  ok('cada elemento de mas trae item, actividad y nombre', mas.every((m) => 'item' in m && 'actividad' in m && 'nombre' in m), mas);
  ok('habituales y todas siguen', e.actividades.habituales.length === 5 && Array.isArray(e.actividades.todas) && e.actividades.todas.length > 0);
  const e2 = await parteEquipo(ctx(), { eq: 'CR100' });
  ok('tipo sin lista: mas = []', Array.isArray(e2.actividades.mas) && e2.actividades.mas.length === 0, e2.actividades.mas);
  ok('el CC del formulario del operador (parteCC_) conserva los pseudo', ['Taller', 'Disponible', 'Domingo/Festivo'].every((k) => e.cc.some((x) => x.centro_coste === k)));
}

console.log('\n2 · op=bandeja: cc_sugerido y listas.cc');
{
  // CR100: lo más reciente con CC real hasta el 25-sep es 3701.07.01 (22-sep); ignora Disponible (24), descartada (24).
  await fila({ id: 'h1', fecha: '2026-09-20', codigo: 'CR100', cc: '3701.02.03', estado: 'aprobado' });
  await fila({ id: 'h2', fecha: '2026-09-22', codigo: 'CR100', cc: '3701.07.01', desc: 'Cuneta', estado: 'aprobado' });
  await fila({ id: 'h3', fecha: '2026-09-24', codigo: 'CR100', cc: 'Disponible', estado: 'aprobado' });
  await fila({ id: 'h4', fecha: '2026-09-24', codigo: 'CR100', cc: '3701.02.03', estado: 'descartado', de: '09:00' });
  // CR300 (faltante ese día): dos filas el 10-sep, gana la de hora_de mayor; y una posterior a la bandeja que se ignora.
  await fila({ id: 'h5', fecha: '2026-09-10', codigo: 'CR300', cc: '3701.02.03', de: '07:00', estado: 'aprobado' });
  await fila({ id: 'h6', fecha: '2026-09-10', codigo: 'CR300', cc: '3701.07.01', de: '13:00', a: '17:00', estado: 'aprobado' });
  await fila({ id: 'h7', fecha: '2026-09-30', codigo: 'CR300', cc: '3703.01.01', estado: 'aprobado' });
  // CR200 sin historial; pendiente del día.
  await fila({ id: 'p1', fecha: '2026-09-25', codigo: 'CR100', cc: 'Disponible', de: '08:00' });
  await fila({ id: 'p2', fecha: '2026-09-25', codigo: 'CR200', cc: 'Disponible', de: '08:00' });
  const b = await parteBandeja(ctx(), { fecha: '2026-09-25' });
  const s = b.cc_sugerido;
  ok('cc_sugerido es un objeto', s && typeof s === 'object' && !Array.isArray(s), s);
  ok('CR100 (pendiente) → 3701.07.01 del 22-sep con su descripción', s.CR100 && s.CR100.centro_coste === '3701.07.01' && s.CR100.fecha === '2026-09-22' && s.CR100.descripcion_trabajo === 'Cuneta', s.CR100);
  ok('CR200 sin historial → no aparece', !('CR200' in s), s);
  ok('CR300 (faltante) → hora_de mayor del mismo día (3701.07.01) e ignora la fecha posterior', s.CR300 && s.CR300.centro_coste === '3701.07.01' && s.CR300.fecha === '2026-09-10', s.CR300);
  ok('CR400 (faltante sin historial) → no aparece', !('CR400' in s));
  ok('CR300 y CR400 están en faltantes', b.faltantes.some((q) => q.codigo === 'CR300') && b.faltantes.some((q) => q.codigo === 'CR400'));
  const cc = b.listas.cc.map((x) => x.centro_coste);
  ok('listas.cc sin Disponible ni Domingo/Festivo', !cc.includes('Disponible') && !cc.includes('Domingo/Festivo'), cc);
  ok('listas.cc conserva Taller (al final) y los CC reales', cc.includes('Taller') && cc.includes('3701.02.03') && b.listas.cc[b.listas.cc.length - 1].centro_coste === 'Taller', cc);
}

console.log('\n3 · op=reporte');
const man = (extra) => Object.assign({ fecha: '2026-09-25', operador: 'Juan Perez', inicial: 5, final: 5, hora_de: '10:00', hora_a: '11:00' }, extra);
let idDisp, idDom, idSin, idTaller;
{
  const r1 = await parteReporte(ctx(), { codigo: 'CR100', origen: 'manual', tramos: [man({ centro_coste: 'Disponible', sin_operacion: 'Disponible' })] }, ses);
  ok('manual Disponible sin nº de parte → guardado', r1.ok === true && r1.guardadas === 1, r1);
  idDisp = r1.filas[0].id_registro;
  const f1 = await leer(idDisp);
  ok('CC = sugerido del historial (3701.07.01) y uf 1', f1.centro_coste === '3701.07.01' && f1.uf === '1', [f1.centro_coste, f1.uf]);
  ok('descripcion = texto del pseudo-CC cuando venía vacía', f1.descripcion_trabajo === 'Disponible', f1.descripcion_trabajo);
  const a1 = alertasDe(f1);
  ok('alerta CC_SUGERIDO, sin SIN_CC / CC_INUSUAL / CC_DESCONOCIDO', a1.includes('CC_SUGERIDO') && !a1.includes('SIN_CC') && !a1.includes('CC_INUSUAL') && !a1.includes('CC_DESCONOCIDO'), a1);

  const r2 = await parteReporte(ctx(), { codigo: 'CR100', origen: 'manual', tramos: [man({ centro_coste: 'domingo/festivo', descripcion_trabajo: 'Domingo sin frente', hora_de: '12:00', hora_a: '13:00', sin_operacion: 'Domingo' })] }, ses);
  idDom = r2.filas && r2.filas[0].id_registro;
  const f2 = r2.ok && await leer(idDom);
  ok('Domingo/Festivo en minúsculas: conserva la descripción recibida y pone el CC sugerido', f2 && f2.descripcion_trabajo === 'Domingo sin frente' && f2.centro_coste === '3701.07.01' && alertasDe(f2).includes('CC_SUGERIDO'), f2 || r2);

  const r3 = await parteReporte(ctx(), { codigo: 'CR200', origen: 'manual', tramos: [man({ centro_coste: 'Disponible', sin_operacion: 'Sin operador' })] }, ses);
  idSin = r3.ok && r3.filas[0].id_registro;
  const f3 = r3.ok && await leer(idSin);
  ok('sin historial → CC vacío, SIN_CC y sin CC_SUGERIDO', f3 && f3.centro_coste === '' && f3.uf === '' && alertasDe(f3).includes('SIN_CC') && !alertasDe(f3).includes('CC_SUGERIDO'), f3 || r3);
  ok('descripcion del pseudo guardada también sin historial', f3 && f3.descripcion_trabajo === 'Disponible', f3 && f3.descripcion_trabajo);

  const r4 = await parteReporte(ctx(), { codigo: 'CR100', origen: 'manual', tramos: [man({ centro_coste: 'Taller', hora_de: '14:00', hora_a: '15:00' })] }, ses);
  idTaller = r4.ok && r4.filas[0].id_registro;
  const f4 = r4.ok && await leer(idTaller);
  ok('Taller sin nº de parte (manual) → se guarda como «Taller», sin SIN_CC ni CC_SUGERIDO', f4 && f4.centro_coste === 'Taller' && !alertasDe(f4).includes('SIN_CC') && !alertasDe(f4).includes('CC_SUGERIDO'), f4 || r4);

  const r5 = await parteReporte(ctx(), { codigo: 'CR100', origen: 'manual', tramos: [man({ centro_coste: '3701.02.03', sin_operacion: 'Lluvia', hora_de: '16:00', hora_a: '17:00' })] }, ses);
  ok('manual con sin_operacion y CC real, sin nº de parte → guardado', r5.ok === true && r5.guardadas === 1, r5);

  const r6 = await parteReporte(ctx(), { codigo: 'CR100', origen: 'manual', tramos: [man({ centro_coste: '3701.02.03', hora_de: '17:00', hora_a: '18:00' })] }, ses);
  ok('manual con CC real, sin sin_operacion y sin nº → rechazado', r6.ok === false && /número del parte/.test(r6.error || ''), r6);

  const r7 = await parteReporte(ctx(), { codigo: 'CR100', origen: 'qr', tramos: [man({ centro_coste: 'Disponible', hora_de: '18:00', hora_a: '19:00' })] }, null);
  ok('QR sin nº de parte → rechazado aunque sea Disponible', r7.ok === false && /número del parte/.test(r7.error || ''), r7);
  const r8 = await parteReporte(ctx(), { codigo: 'CR100', origen: 'qr', tramos: [man({ centro_coste: 'Disponible', reporte_num: '777', hora_de: '18:00', hora_a: '19:00' })] }, null);
  ok('QR Disponible con nº de parte → CC sugerido + CC_SUGERIDO (formulario viejo)', r8.ok === true && r8.filas[0].alertas.includes('CC_SUGERIDO'), r8);
  const r9 = await parteReporte(ctx(), { codigo: 'CR100', origen: 'qr', tramos: [man({ centro_coste: '3701.02.03', reporte_num: '778', hora_de: '19:00', hora_a: '20:00', sin_operacion: 'x'.repeat(41) })] }, null);
  ok('sin_operacion > 40 caracteres → rechazo de payload (D166)', r9.ok === false, r9);
  const r10 = await parteReporte(ctx(), { codigo: 'CR100', origen: 'qr', tramos: [man({ centro_coste: '3701.02.03', reporte_num: '779', hora_de: '20:00', hora_a: '21:00' })] }, null);
  ok('payload viejo (sin sin_operacion) sigue valiendo', r10.ok === true && r10.guardadas === 1, r10);
}

console.log('\n4 · op=revisar');
{
  const r1 = await parteRevisar(ctx(), { cambios: [{ id_registro: idDisp, campos: { centro_coste: '3700.12' } }] }, ses);
  ok('CC escrito a mano aceptado', r1.ok === true && r1.cambiadas === 1, r1);
  const f1 = await leer(idDisp), a1 = alertasDe(f1);
  ok('alertas recalculadas y guardadas: sin CC_SUGERIDO ni CC_DESCONOCIDO ni SIN_CC', f1.centro_coste === '3700.12' && !a1.includes('CC_SUGERIDO') && !a1.includes('CC_DESCONOCIDO') && !a1.includes('SIN_CC'), a1);
  ok('la fila de respuesta trae las mismas alertas', r1.filas[0].alertas === f1.alertas, r1.filas[0].alertas);

  const r2 = await parteRevisar(ctx(), { cambios: [{ id_registro: idSin, campos: { centro_coste: '37P1.A01' } }] }, ses);
  const a2 = alertasDe(await leer(idSin));
  ok('SIN_CC desaparece al poner un CC (puentes 37P1…)', r2.ok === true && !a2.includes('SIN_CC') && !a2.includes('CC_DESCONOCIDO'), a2);
  await parteRevisar(ctx(), { cambios: [{ id_registro: idSin, campos: { centro_coste: '' } }] }, ses);
  ok('CC vaciado → vuelve SIN_CC', alertasDe(await leer(idSin)).includes('SIN_CC'));
  await parteRevisar(ctx(), { cambios: [{ id_registro: idSin, campos: { centro_coste: 'Disponible' } }] }, ses);
  ok('CC puesto a Disponible → SIN_CC', alertasDe(await leer(idSin)).includes('SIN_CC'));

  const r3 = await parteRevisar(ctx(), { cambios: [{ id_registro: idSin, estado: 'aprobado' }] }, ses);
  ok('aprobar con «Disponible» → error de día disponible/festivo', r3.cambiadas === 0 && r3.errores.length === 1 && /día disponible\/festivo sin centro de coste; ponle el CC al que se carga antes de aprobar/.test(r3.errores[0].error) && r3.errores[0].error.startsWith('CR200: '), r3.errores);
  ok('…y no escribió nada (sigue pendiente)', (await leer(idSin)).estado === 'pendiente');
  await parteRevisar(ctx(), { cambios: [{ id_registro: idSin, campos: { centro_coste: '' } }] }, ses);
  const r3b = await parteRevisar(ctx(), { cambios: [{ id_registro: idSin, estado: 'aprobado' }] }, ses);
  ok('aprobar con CC vacío → error actual', r3b.errores.length === 1 && /sin centro de coste; ponlo antes de aprobar/.test(r3b.errores[0].error), r3b.errores);

  const r4 = await parteRevisar(ctx(), { cambios: [{ id_registro: idTaller, estado: 'aprobado' }] }, ses);
  ok('aprobar con Taller → ok', r4.ok === true && r4.cambiadas === 1 && (await leer(idTaller)).estado === 'aprobado', r4);

  const r5 = await parteRevisar(ctx(), { cambios: [{ id_registro: idDom, estado: 'aprobado' }] }, ses);
  const f5 = await leer(idDom);
  ok('aprobar un CC sugerido (sin tocarlo) lo confirma: estado aprobado y sin CC_SUGERIDO', r5.cambiadas === 1 && f5.estado === 'aprobado' && !alertasDe(f5).includes('CC_SUGERIDO'), [f5.estado, f5.alertas]);

  // (revisión del diff) reenviar el MISMO CC no borra CC_INUSUAL (solo se recalcula si el CC cambia)
  await fila({ id: 'inu1', fecha: '2026-09-25', codigo: 'CR400', cc: '3701.02.03', alertas: 'CC_INUSUAL', rep: '501', de: '06:00', a: '07:00' });
  await parteRevisar(ctx(), { cambios: [{ id_registro: 'inu1', campos: { centro_coste: '3701.02.03', descripcion_trabajo: 'Terraplén' } }] }, ses);
  ok('mismo CC reenviado con otros campos → conserva CC_INUSUAL', alertasDe(await leer('inu1')).includes('CC_INUSUAL'), (await leer('inu1')).alertas);

  // (revisión del diff) una fila APROBADA no puede quedar sin CC real al corregirla (quien revisa o el jefe en la Base)
  const r6 = await parteRevisar(ctx(), { cambios: [{ id_registro: idDom, campos: { centro_coste: '' } }] }, ses);
  ok('fila aprobada: vaciar el CC → error y no cambia', r6.cambiadas === 0 && /una fila aprobada necesita un centro de coste real/.test((r6.errores[0] || {}).error || '') && (await leer(idDom)).centro_coste === '3701.07.01', r6);
  const jefe = { ok: true, usuario: 'jefe', rol: 'jefe' };
  const r7 = await parteRevisar(ctx(), { cambios: [{ id_registro: idDom, campos: { centro_coste: 'Disponible' } }] }, jefe);
  ok('jefe (Base, D198): poner Disponible en una fila aprobada → error y no cambia', r7.cambiadas === 0 && /una fila aprobada necesita un centro de coste real/.test((r7.errores[0] || {}).error || '') && (await leer(idDom)).centro_coste === '3701.07.01', r7);
  const r8 = await parteRevisar(ctx(), { cambios: [{ id_registro: idDom, campos: { centro_coste: '3701.02.03' } }] }, jefe);
  ok('jefe (Base): cambiar a otro CC real en una fila aprobada → ok', r8.cambiadas === 1 && (await leer(idDom)).centro_coste === '3701.02.03', r8);

  // (revisión del diff) parte ATRASADO con Disponible: el CC sugerido es de su fecha o antes, nunca de un día posterior
  const r9 = await parteReporte(ctx(), { codigo: 'CR300', origen: 'manual', tramos: [man({ fecha: '2026-09-12', centro_coste: 'Disponible', sin_operacion: 'Lluvia' })] }, ses);
  const f9 = r9.ok && await leer(r9.filas[0].id_registro);
  ok('Disponible del 12-sep → 3701.07.01 (10-sep), no 3703.01.01 (30-sep)', f9 && f9.centro_coste === '3701.07.01', f9 || r9);

  // (revisión del diff) envío de varios tramos: el Disponible hereda el CC real del tramo anterior del MISMO envío
  const r10 = await parteReporte(ctx(), { codigo: 'CR200', origen: 'manual', tramos: [
    man({ fecha: '2026-09-26', centro_coste: '3701.02.03', reporte_num: '901', hora_de: '07:00', hora_a: '10:00', inicial: 5, final: 8 }),
    man({ fecha: '2026-09-26', centro_coste: 'Disponible', sin_operacion: 'Lluvia', hora_de: '10:00', hora_a: '15:00', inicial: 8, final: 8 }) ] }, ses);
  const f10 = r10.ok && await leer(r10.filas[1].id_registro);
  ok('multi-tramo: el tramo Disponible toma 3701.02.03 del tramo anterior + CC_SUGERIDO', f10 && f10.centro_coste === '3701.02.03' && alertasDe(f10).includes('CC_SUGERIDO'), f10 || r10);
}

console.log('\n5 · op=deshacer_reparto');
const reparto = async (id, cc1, cc2, extra) => {
  await fila(Object.assign({ id, fecha: '2026-09-23', codigo: 'CR100', cc: '3701.02.03', ini: 10, fin: 20, obs: 'nota' }, extra || {}));
  return parteRepartir(ctx(), { id_registro: id, reparto: [{ centro_coste: cc1 || '3701.02.03', pct: 50 }, { centro_coste: cc2 || '3701.07.01', pct: 50 }] }, ses);
};
{
  const rp = await reparto('orig1');
  ok('preparación: repartida en 2 hijas', rp.ok === true && rp.filas.length === 2 && rp.filas[0].id_registro === 'orig1-r1', rp);
  const r = await parteDeshacerReparto(ctx(), { id_registro: 'orig1' }, ses);
  ok('deshacer ok: cambiadas 3, original + 2 hijas', r.ok === true && r.cambiadas === 3 && r.filas.length === 2 && r.original.id_registro === 'orig1' && r.continuidad && typeof r.continuidad === 'object', r);
  const o = await leer('orig1'), h1 = await leer('orig1-r1'), h2 = await leer('orig1-r2');
  ok('original: pendiente y sin la marca (observación «nota»)', o.estado === 'pendiente' && o.observaciones === 'nota' && o.revisado_por === 'ana', [o.estado, o.observaciones]);
  ok('hijas: descartadas con «[Reparto deshecho]»', h1.estado === 'descartado' && h2.estado === 'descartado' && /\[Reparto deshecho\]$/.test(h1.observaciones) && /\[Reparto deshecho\]$/.test(h2.observaciones), [h1.observaciones, h2.observaciones]);
  ok('la respuesta refleja el nuevo estado', r.original.estado === 'pendiente' && r.filas.every((f) => f.estado === 'descartado'));
  const aud = await sql`SELECT op, usuario FROM parte_auditoria WHERE id_registro = ANY(${['orig1', 'orig1-r1', 'orig1-r2']}) AND op = 'deshacer_reparto'`;
  ok('auditoría: 3 filas con op deshacer_reparto y usuario del revisor', aud.length === 3 && aud.every((a) => a.usuario === 'ana'), aud);
  const de2 = await parteDeshacerReparto(ctx(), { id_registro: 'orig1' }, ses);
  ok('deshacer otra vez → error (ya no está repartida)', de2.ok === false, de2);

  // hija aprobada → error y nada cambia
  await reparto('orig2');
  await parteRevisar(ctx(), { cambios: [{ id_registro: 'orig2-r1', estado: 'aprobado' }] }, ses);
  const e1 = await parteDeshacerReparto(ctx(), { id_registro: 'orig2' }, ses);
  ok('hija aprobada → error con código, horas y guion', e1.ok === false && /^CR100 07:00–\d\d:\d\d: esa parte del reparto ya está aprobada; devuélvela a pendiente o descártala antes de deshacer el reparto\.$/.test(e1.error), e1);
  const o2 = await leer('orig2'), q2 = await leer('orig2-r2');
  ok('…sin cambios (original descartada, hija 2 pendiente)', o2.estado === 'descartado' && /\[Repartido en 2 filas\]/.test(o2.observaciones) && q2.estado === 'pendiente');
  await parteRevisar(ctx(), { cambios: [{ id_registro: 'orig2-r1', estado: 'pendiente' }] }, ses);
  const e1b = await parteDeshacerReparto(ctx(), { id_registro: 'orig2-r1' }, ses);
  ok('devuelta a pendiente, desde el id de una hija → funciona', e1b.ok === true && (await leer('orig2')).estado === 'pendiente', e1b);

  // hija re-repartida → error; deshaciendo primero la hija se puede
  await reparto('orig3');
  const rr = await parteRepartir(ctx(), { id_registro: 'orig3-r1', reparto: [{ centro_coste: '3701.02.03', pct: 60 }, { centro_coste: '3701.07.01', pct: 40 }] }, ses);
  ok('preparación: hija orig3-r1 repartida (orig3-r1-r1, orig3-r1-r2)', rr.ok === true && rr.filas[1].id_registro === 'orig3-r1-r2', rr);
  const e2 = await parteDeshacerReparto(ctx(), { id_registro: 'orig3' }, ses);
  ok('hija re-repartida → «deshaz primero el reparto de la fila orig3-r1»', e2.ok === false && /^deshaz primero el reparto de la fila orig3-r1 /.test(e2.error), e2);
  ok('…sin cambios', (await leer('orig3')).estado === 'descartado');
  const e3 = await parteDeshacerReparto(ctx(), { id_registro: 'orig3-r1-r2' }, ses);
  ok('desde la hija anidada → deshace el reparto de orig3-r1', e3.ok === true && e3.original.id_registro === 'orig3-r1' && (await leer('orig3-r1')).estado === 'pendiente' && (await leer('orig3-r1-r1')).estado === 'descartado', e3);
  const e4 = await parteDeshacerReparto(ctx(), { id_registro: 'orig3' }, ses);
  ok('ahora orig3 ya se puede deshacer (orig3-r1 vuelve pendiente → se descarta)', e4.ok === true && (await leer('orig3')).estado === 'pendiente' && (await leer('orig3-r1')).estado === 'descartado' && (await leer('orig3-r2')).estado === 'descartado', e4);

  // desde el id de una hija
  await reparto('orig4');
  const e5 = await parteDeshacerReparto(ctx(), { id_registro: 'orig4-r2' }, ses);
  ok('desde el id de la hija «-r2» → deshace el reparto de la original', e5.ok === true && e5.original.id_registro === 'orig4' && (await leer('orig4')).estado === 'pendiente', e5);

  // colisión de ids (-rN-k): repartir, deshacer y repartir otra vez
  const rp2 = await parteRepartir(ctx(), { id_registro: 'orig4', reparto: [{ centro_coste: '3701.02.03', pct: 50 }, { centro_coste: '3701.07.01', pct: 50 }] }, ses);
  ok('preparación: segundo reparto usa ids con sufijo -k', rp2.ok === true && rp2.filas[0].id_registro === 'orig4-r1-2', rp2.filas && rp2.filas.map((f) => f.id_registro));
  const e6 = await parteDeshacerReparto(ctx(), { id_registro: 'orig4-r2-2' }, ses);
  ok('hija «-rN-k» → deshace', e6.ok === true && (await leer('orig4')).estado === 'pendiente' && (await leer('orig4-r1-2')).estado === 'descartado', e6);

  // validaciones y permisos
  const v1 = await parteDeshacerReparto(ctx(), {}, ses);
  ok('sin id_registro → error', v1.ok === false, v1);
  const v2 = await parteDeshacerReparto(ctx(), { id_registro: 'x'.repeat(101) }, ses);
  ok('id_registro de 101 caracteres → rechazo de payload (D166)', v2.ok === false, v2);
  const v3 = await parteDeshacerReparto(ctx(), { id_registro: { a: 1 } }, ses);
  ok('id_registro no es texto → rechazo', v3.ok === false, v3);
  const v4 = await parteDeshacerReparto(ctx(), { id_registro: 'h1' }, ses);
  ok('una fila que no es reparto → error', v4.ok === false && /no es un reparto/.test(v4.error), v4);
  const v5 = await parteDeshacerReparto(ctx(), { id_registro: 'orig4' }, { ok: true, usuario: 'pepe', rol: 'operador' });
  ok('rol sin permiso → error de permiso', v5.ok === false && /no revisa partes/.test(v5.error), v5);
  ok('parteDoPost_ enruta op=deshacer_reparto (sin token válido → no es «op desconocida»)', !/op desconocida/.test(String((await parteDoPost_(ctx(), { op: 'deshacer_reparto', token: 'x' })).error || '')));
}

console.log('\n6 · 017_depurar_tractocamion.sql');
{
  const { pg: pg2, sql: sql2 } = await abrirPglite();
  for (const f of fs.readdirSync(SQL).filter((x) => /^0\d\d_.*\.sql$/.test(x) && x < '017').sort()) await pg2.exec(fs.readFileSync(path.join(SQL, f), 'utf8'));
  await pg2.exec(`
    INSERT INTO parte_items (tipo_equipo,item,actividad,veces,activo) VALUES
      ('TRACTOCAMION','11.01','PMT',25,'SI'),('TRACTOCAMION','2.07','Traslado de compactador a terraplén',9,'SI'),('TRACTOCAMION','2.03','Desmonte y limpieza',8,'SI'),
      ('TRACTOCAMION','2.05','Excavación en material común',7,'SI'),('TRACTOCAMION','06.01','Excavaciones varias (ODT)',6,'SI'),('TRACTOCAMION','7.01','Excavaciones varias (ODL)',5,'SI'),
      ('TRACTOCAMION','2.1','Transporte de terraplén',50,'SI'),('TRACTOCAMION','3.02','Transporte de subbase',40,'SI'),('TRACTOCAMION','3.03','Base estabilizada',30,'SI'),
      ('TRACTOCAMION','4.03','Mezcla asfáltica',20,'SI'),('TRACTOCAMION','5.04','Relleno MSR',15,'SI'),('TRACTOCAMION','6.02','Rellenos',12,'SI'),
      ('TRACTOCAMION','6.04','Cargue de hierro',11,'SI'),('TRACTOCAMION','11.04','Imprevistos',10,'SI'),
      ('CAMABAJA','2.07','Traslado de equipo a terraplén',9,'SI'),('CAMABAJA','11.01','PMT',3,'SI'),('TRACTOCAMIONES','2.07','Otro tipo',1,'SI');
  `);
  const estado = async () => Object.fromEntries((await sql2`SELECT tipo_equipo||'|'||item AS k, activo FROM parte_items ORDER BY 1`).map((r) => [r.k, r.activo]));
  await pg2.exec(M17);
  const a = await estado();
  // Dueño (2-oct): la mula solo transporta granulares → quedan 03.02 y 03.04 (nueva); todo lo demás se apaga.
  const apagados = ['11.01', '2.07', '2.03', '2.05', '06.01', '7.01', '2.1', '3.03', '4.03', '5.04', '6.02', '6.04', '11.04'].map((i) => 'TRACTOCAMION|' + i);
  ok('los 13 ítems que no son transporte de granulares quedan en activo=NO (también «06.01» con ceros)', apagados.every((k) => a[k] === 'NO'), a);
  ok('03.02 Transporte de subbase sigue activo', a['TRACTOCAMION|3.02'] === 'SI', a);
  const n34 = await sql2`SELECT item, actividad, activo FROM parte_items WHERE tipo_equipo='TRACTOCAMION' AND actividad='Transporte de BTC (La Putana)'`;
  ok('se agrega 03.04 «Transporte de BTC (La Putana)» activo', n34.length === 1 && n34[0].activo === 'SI' && n34[0].item === '3.04', n34);
  ok('otros tipos (CAMABAJA, TRACTOCAMIONES) intactos', a['CAMABAJA|2.07'] === 'SI' && a['CAMABAJA|11.01'] === 'SI' && a['TRACTOCAMIONES|2.07'] === 'SI', a);
  const res1 = await sql2`SELECT item FROM parte_items_respaldo_017 ORDER BY item`;
  ok('respaldo con exactamente las 13 filas apagadas, con su estado anterior', res1.length === 13, res1);
  ok('el respaldo guarda activo=SI (estado previo)', (await sql2`SELECT count(*)::int AS n FROM parte_items_respaldo_017 WHERE activo='SI'`)[0].n === 13);
  ok('esquema_version 17 una vez', (await sql2`SELECT count(*)::int AS n FROM esquema_version WHERE version=17`)[0].n === 1);
  // una fila nueva entre corridas: se apaga, pero el respaldo ya no se vuelve a llenar
  await pg2.exec(`INSERT INTO parte_items (tipo_equipo,item,actividad,veces,activo) VALUES ('TRACTOCAMION','2.03','Otra frase',1,'SI')`);
  await pg2.exec(M17);
  const b = await estado();
  ok('segunda corrida idempotente: mismo estado salvo la fila nueva (también apagada)', JSON.stringify(Object.entries(b).filter(([k]) => k !== 'TRACTOCAMION|2.03')) === JSON.stringify(Object.entries(a).filter(([k]) => k !== 'TRACTOCAMION|2.03')) && true, null);
  ok('la fila nueva del ítem 2.03 también queda NO', (await sql2`SELECT activo FROM parte_items WHERE actividad='Otra frase'`)[0].activo === 'NO');
  ok('respaldo: una sola vez (sigue con 13 filas)', (await sql2`SELECT count(*)::int AS n FROM parte_items_respaldo_017`)[0].n === 13);
  ok('03.04 no se duplica en la segunda corrida', (await sql2`SELECT count(*)::int AS n FROM parte_items WHERE tipo_equipo='TRACTOCAMION' AND actividad='Transporte de BTC (La Putana)'`)[0].n === 1);
  ok('esquema_version 17 sigue una vez', (await sql2`SELECT count(*)::int AS n FROM esquema_version WHERE version=17`)[0].n === 1);
  // vuelta atrás desde el respaldo (bloque comentado de la migración)
  await pg2.exec(`UPDATE parte_items p SET activo = r.activo FROM parte_items_respaldo_017 r WHERE p.obra_id=r.obra_id AND p.tipo_equipo=r.tipo_equipo AND p.item=r.item AND p.actividad=r.actividad;
    DELETE FROM parte_items WHERE obra_id='tm2sur' AND tipo_equipo='TRACTOCAMION' AND actividad='Transporte de BTC (La Putana)';
    DELETE FROM parte_items WHERE actividad='Otra frase';`);   // fila de prueba creada entre corridas (no está en el respaldo)
  const c0 = await estado();
  ok('vuelta atrás desde el respaldo restaura los 13 ítems y quita la fila agregada', apagados.every((k) => c0[k] === 'SI') && !('TRACTOCAMION|3.04' in c0), c0);
}

console.log('\n' + casos + ' comprobaciones · ' + fallos + ' fallo(s)');
process.exit(fallos ? 1 : 0);
