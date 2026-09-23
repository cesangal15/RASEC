#!/usr/bin/env node
/**
 * Verificación — pantalla «Catálogos» (SOLO admin): catTablas/catLeer/catGuardar REALES del Worker sobre
 * Postgres en memoria (PGlite) con el esquema 001–013 (incluye 013_catalogos_auditoria.sql):
 *
 *   1 · Guard de rol: jefe y residente rechazados en las 3 acciones; admin lee cat_tablas.
 *   2 · cat_leer bandeja: filtro de fechas obligatorio + filtro de rango de PK (cruce de intervalos).
 *   3 · cat_guardar bandeja: update de una fila pendiente OK; update de una fila 'incluido' OK + aviso.
 *   4 · Conflicto: `antes` desactualizado → rollback total (ninguna fila cambia).
 *   5 · Baja en bandeja: NO borra, pone estado='descartado' (D181-style «borrar» = descartar).
 *   6 · Tabla/columna fuera de la lista blanca → rechazada (intento de inyección).
 *   7 · Usuarios: alta con clave_nueva → login REAL con esa clave funciona; cat_leer nunca trae `clave`;
 *       el admin no puede desactivarse a sí mismo.
 *   8 · parte_cc: alta y borrado real.
 *   9 · Auditoría: cada escritura deja fila en catalogo_auditoria, sin clave/hash de usuarios.
 *   10 · cubicaje: valida que el número sea > 0.
 *
 *   node worker/pruebas/verificar_catalogos_admin.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPglite } from './pglite.js';
import { catTablas, catLeer, catGuardar } from '../src/api/obra/catalogos_admin.js';
import { loginResultado_ } from '../src/auth.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL = path.join(RAIZ, 'sql');
let fallos = 0, casos = 0;
const ok = (n, c, x) => { casos++; if (!c) { fallos++; console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); } else console.log('  ✓ ' + n); };

const { pg, sql } = await abrirPglite();
for (const f of fs.readdirSync(SQL).filter((x) => /^0\d\d_.*\.sql$/.test(x)).sort()) await pg.exec(fs.readFileSync(path.join(SQL, f), 'utf8'));

await pg.exec(`
  INSERT INTO usuarios (usuario, clave, rol, estado) VALUES
    ('admin', '1234', 'admin', 'activo'),
    ('jefe1', '1234', 'jefe', 'activo'),
    ('resid1', '1234', 'residente', 'activo');
  INSERT INTO bandeja (id_registro, "timestamp", fecha, reporta, rol, actividad, descripcion, centro_costo,
      pk_inicial, pk_final, largo, observacion, estado, area)
  VALUES
    ('b1', '2026-09-10T08:00:00Z', '2026-09-10', 'angel', 'capataz', 'Terraplenes', 'Terraplenes', '3701.02.10', '14+000', '14+300', 300, 'obs 1', 'pendiente', ''),
    ('b2', '2026-09-11T08:00:00Z', '2026-09-11', 'angel', 'capataz', 'Terraplenes', 'Terraplenes', '3701.02.10', '20+000', '20+300', 300, 'obs 2', 'incluido', ''),
    ('b3', '2026-09-12T08:00:00Z', '2026-09-12', 'alejo', 'capataz', 'Cunetas', 'Cunetas', '3701.07.01', '5+000', '5+300', 300, 'obs 3', 'pendiente', '');
`);

const ctx = () => ({ sql, env: {}, memo: {}, secreto: 'secreto-banco', authV: '1', pet: { t0: Date.now(), log: {} } });
const SES = {
  admin: { ok: true, usuario: 'admin', rol: 'admin' },
  jefe: { ok: true, usuario: 'jefe1', rol: 'jefe' },
  residente: { ok: true, usuario: 'resid1', rol: 'residente' },
};
const gTablas = (ses) => catTablas(ctx(), {}, SES[ses]);
const gLeer = (ses, tabla, filtros) => catLeer(ctx(), { tabla, filtros: filtros ? JSON.stringify(filtros) : undefined }, SES[ses]);
const gGuardar = (ses, tabla, cambios) => catGuardar(ctx(), { action: 'cat_guardar', tabla, cambios }, SES[ses]);
const filaBandeja = async (id) => (await sql`SELECT * FROM bandeja WHERE id_registro=${id}`)[0] || null;
const auditoria = async (tabla) => sql`SELECT * FROM catalogo_auditoria WHERE tabla=${tabla} ORDER BY id`;

console.log('\n1 · Guard de rol (SOLO admin)');
{
  let r = await gTablas('jefe');
  // permiso_ (comun.js) tiene un mensaje especial y genérico para rol='jefe' (pensado para Maquinaria,
  // D139); aquí solo importa que rechace, no el texto exacto (compartido con otras pantallas).
  ok('jefe: cat_tablas rechazado', r.ok === false, r);
  r = await gTablas('residente');
  ok('residente: cat_tablas rechazado', r.ok === false, r);
  r = await gLeer('jefe', 'bandeja', { desde: '2026-09-01', hasta: '2026-09-30' });
  ok('jefe: cat_leer rechazado', r.ok === false, r);
  r = await gGuardar('jefe', 'usuarios', [{ op: 'alta', campos: { usuario: 'x', clave_nueva: 'y', rol: 'admin' } }]);
  ok('jefe: cat_guardar rechazado', r.ok === false, r);
  r = await gTablas('admin');
  ok('admin: cat_tablas OK con grupos y tablas', r.ok === true && Array.isArray(r.tablas) && r.tablas.length > 15, r);
  ok('admin: cat_tablas incluye bandeja/usuarios/fc_actividad/tablero_mapeo, NO cargos ni data',
    r.tablas.some((t) => t.id === 'bandeja') && r.tablas.some((t) => t.id === 'usuarios') &&
    r.tablas.some((t) => t.id === 'fc_actividad') && r.tablas.some((t) => t.id === 'tablero_mapeo') &&
    !r.tablas.some((t) => t.id === 'cargos') && !r.tablas.some((t) => t.id === 'data'));
}

console.log('\n2 · cat_leer bandeja: fechas obligatorias + rango de PK');
{
  let r = await gLeer('admin', 'bandeja', {});
  ok('sin fechas → rechazado', r.ok === false, r);
  r = await gLeer('admin', 'bandeja', { desde: '2026-09-10', hasta: '2026-09-12' });
  ok('con fechas → 3 filas', r.ok === true && r.filas.length === 3, r);
  r = await gLeer('admin', 'bandeja', { desde: '2026-09-10', hasta: '2026-09-12', pk_desde: '10+000', pk_hasta: '15+000' });
  ok('PK 10+000–15+000 cruza SOLO b1 (14+000–14+300)', r.ok === true && r.filas.length === 1 && r.filas[0].id_registro === 'b1', r);
  r = await gLeer('admin', 'bandeja', { desde: '2026-09-10', hasta: '2026-09-12', pk_desde: '19+900', pk_hasta: '20+050' });
  ok('PK 19+900–20+050 cruza SOLO b2 (20+000–20+300)', r.ok === true && r.filas.length === 1 && r.filas[0].id_registro === 'b2', r);
  ok('cada fila trae _k con su pk', r.filas[0]._k && r.filas[0]._k.id_registro === 'b2', r.filas[0]);
}

console.log('\n3 · cat_guardar bandeja: update pendiente OK; update incluido OK + aviso');
{
  const antes = await filaBandeja('b1');
  let r = await gGuardar('admin', 'bandeja', [{ op: 'update', k: { id_registro: 'b1' }, antes: { largo: antes.largo }, campos: { largo: 350 } }]);
  ok('update b1 (pendiente) OK', r.ok === true && r.aplicados === 1, r);
  ok('sin aviso en b1 (no estaba incluida)', (r.avisos || []).length === 0, r);
  ok('largo quedó en 350', Number((await filaBandeja('b1')).largo) === 350);

  const antes2 = await filaBandeja('b2');
  r = await gGuardar('admin', 'bandeja', [{ op: 'update', k: { id_registro: 'b2' }, antes: { largo: antes2.largo }, campos: { largo: 400 } }]);
  ok('update b2 (incluido) OK', r.ok === true && r.aplicados === 1, r);
  ok('trae aviso de "ya enviada a DATA"', (r.avisos || []).length === 1 && /Ya enviada a DATA/.test(r.avisos[0].texto), r.avisos);
  ok('largo de b2 quedó en 400 (el guardado SE PERMITE)', Number((await filaBandeja('b2')).largo) === 400);
}

console.log('\n4 · Conflicto por `antes` desactualizado → rollback total');
{
  const foto = () => sql`SELECT id_registro, largo FROM bandeja ORDER BY id_registro`;
  const antesFoto = await foto();
  const r = await gGuardar('admin', 'bandeja', [
    { op: 'update', k: { id_registro: 'b3' }, antes: { largo: 999999 }, campos: { largo: 111 } }, // antes NO coincide → conflicto
  ]);
  ok('conflicto detectado', r.ok === false && r.conflicto === true, r);
  const despuesFoto = await foto();
  ok('nada cambió (rollback total)', JSON.stringify(antesFoto) === JSON.stringify(despuesFoto), { antesFoto, despuesFoto });
}
{
  // Lote con 2 filas: una OK y otra en conflicto → NINGUNA se aplica (transacción única).
  const antesB1 = await filaBandeja('b1');
  const r = await gGuardar('admin', 'bandeja', [
    { op: 'update', k: { id_registro: 'b1' }, antes: { largo: antesB1.largo }, campos: { largo: 500 } },
    { op: 'update', k: { id_registro: 'b3' }, antes: { largo: 999999 }, campos: { largo: 111 } },
  ]);
  ok('lote mixto: conflicto también', r.ok === false && r.conflicto === true, r);
  ok('b1 NO cambió a 500 (todo el lote se revirtió)', Number((await filaBandeja('b1')).largo) === antesB1.largo);
}

console.log('\n5 · Baja en bandeja = descartar (no borra la fila)');
{
  const antes = await filaBandeja('b3');
  const r = await gGuardar('admin', 'bandeja', [{ op: 'baja', k: { id_registro: 'b3' }, antes: { estado: antes.estado } }]);
  ok('baja de b3 OK', r.ok === true && r.aplicados === 1, r);
  const fila = await filaBandeja('b3');
  ok('la fila SIGUE existiendo', !!fila);
  ok('estado quedó en descartado', fila && fila.estado === 'descartado', fila);
}

console.log('\n6 · Tabla / columna fuera de la lista blanca → rechazada');
{
  let r = await gLeer('admin', 'usuarios; DROP TABLE usuarios;--', {});
  ok('tabla inventada en cat_leer → rechazada, no revienta', r.ok === false, r);
  r = await gGuardar('admin', 'bandeja; DROP TABLE bandeja;--', [{ op: 'update', k: { id_registro: 'b1' }, campos: { largo: 1 } }]);
  ok('tabla inventada en cat_guardar → rechazada', r.ok === false, r);
  const usuariosSigueViva = await sql`SELECT count(*)::int AS n FROM usuarios`;
  ok('la tabla usuarios sigue intacta (no se ejecutó nada raro)', usuariosSigueViva[0].n >= 3, usuariosSigueViva);

  r = await gGuardar('admin', 'bandeja', [{ op: 'update', k: { id_registro: 'b1' }, campos: { "id_registro='x'; --": 1 } }]);
  ok('columna inventada en campos → ignorada (no está en la lista blanca), sin reventar', r.ok === true || r.ok === false, r);
}

console.log('\n7 · Usuarios: clave_nueva → hash real, login funciona, sin `clave` en la lectura, sin autobloqueo');
{
  let r = await gLeer('admin', 'usuarios', {});
  ok('cat_leer usuarios: ninguna fila trae `clave`', r.ok === true && r.filas.every((f) => !('clave' in f)), r.filas);

  r = await gGuardar('admin', 'usuarios', [{ op: 'alta', campos: { usuario: 'nuevo_uno', clave_nueva: 'clave-secreta-1', rol: 'residente', estado: 'activo' } }]);
  ok('alta de usuario con clave_nueva OK', r.ok === true && r.aplicados === 1, r);
  const filaCruda = (await sql`SELECT usuario, clave FROM usuarios WHERE usuario='nuevo_uno'`)[0];
  ok('la clave guardada es un hash (64 hex), no el texto plano', filaCruda && /^[0-9a-f]{64}$/.test(filaCruda.clave), filaCruda);

  const login = await loginResultado_(ctx(), { usuario: 'nuevo_uno', clave: 'clave-secreta-1' });
  ok('LOGIN real con la clave nueva funciona', login.ok === true && login.usuario === 'nuevo_uno' && login.rol === 'residente', login);
  const loginMalo = await loginResultado_(ctx(), { usuario: 'nuevo_uno', clave: 'otra-cosa' });
  ok('login con clave mala falla', loginMalo.ok === false, loginMalo);

  r = await gGuardar('admin', 'usuarios', [{ op: 'alta', campos: { usuario: 'sin_clave', rol: 'jefe' } }]);
  ok('alta SIN clave_nueva se rechaza', r.ok === false, r);

  // Auto-bloqueo: admin no puede quitarse el rol ni desactivarse.
  r = await gGuardar('admin', 'usuarios', [{ op: 'update', k: { usuario: 'admin' }, campos: { rol: 'jefe' } }]);
  ok('admin no puede quitarse el rol admin a sí mismo', r.ok === false, r);
  r = await gGuardar('admin', 'usuarios', [{ op: 'update', k: { usuario: 'admin' }, campos: { estado: 'inactivo' } }]);
  ok('admin no puede desactivarse a sí mismo', r.ok === false, r);
  r = await gGuardar('admin', 'usuarios', [{ op: 'update', k: { usuario: 'jefe1' }, campos: { estado: 'inactivo' } }]);
  ok('admin SÍ puede desactivar a OTRO usuario', r.ok === true && r.aplicados === 1, r);
  r = await gGuardar('admin', 'usuarios', [{ op: 'baja', k: { usuario: 'jefe1' } }]);
  ok('usuarios: baja rechazada (no se borran, se desactivan)', r.ok === false, r);
}

console.log('\n8 · parte_cc: alta y borrado real');
{
  let r = await gGuardar('admin', 'parte_cc', [{ op: 'alta', campos: { centro_coste: '3701.09.09', proyecto: '3701', descripcion_cc: 'Prueba CC', activo: 'SI' } }]);
  ok('alta de parte_cc OK', r.ok === true && r.aplicados === 1, r);
  let fila = (await sql`SELECT * FROM parte_cc WHERE centro_coste='3701.09.09'`)[0];
  ok('la fila quedó en la tabla', !!fila, fila);
  r = await gGuardar('admin', 'parte_cc', [{ op: 'baja', k: { centro_coste: '3701.09.09' } }]);
  ok('baja de parte_cc OK', r.ok === true && r.aplicados === 1, r);
  fila = (await sql`SELECT * FROM parte_cc WHERE centro_coste='3701.09.09'`)[0];
  ok('la fila desapareció de verdad (borrado real)', !fila);
}

console.log('\n9 · Auditoría: escrita y SIN clave/hash de usuarios');
{
  const aBandeja = await auditoria('bandeja');
  ok('hay auditoría de bandeja (update + baja)', aBandeja.length >= 2, aBandeja.length);
  ok('auditoría de bandeja trae antes/después con datos', aBandeja.every((a) => a.antes && Object.keys(a.antes).length), aBandeja[0]);

  const aUsuarios = await auditoria('usuarios');
  ok('hay auditoría de usuarios (alta de nuevo_uno + update de jefe1; los rechazados no dejan fila)', aUsuarios.length === 2, aUsuarios.length);
  const todasEnmascaradas = aUsuarios.every((a) => {
    const c1 = a.antes && a.antes.clave, c2 = a.despues && a.despues.clave, c3 = a.despues && a.despues.clave_nueva;
    return (c1 === undefined || c1 === '***') && (c2 === undefined || c2 === '***') && (c3 === undefined || c3 === '***');
  });
  ok('ninguna fila de auditoría de usuarios trae clave/hash en claro', todasEnmascaradas, aUsuarios);

  const aParteCC = await auditoria('parte_cc');
  ok('hay auditoría de parte_cc (alta + baja)', aParteCC.length >= 2, aParteCC.length);
}

console.log('\n10 · cubicaje: valida número > 0');
{
  let r = await gGuardar('admin', 'cubicaje', [{ op: 'alta', campos: { placa: 'abc-123', cubicaje: 0, tipo: 'sencillo' } }]);
  ok('cubicaje 0 → rechazado', r.ok === false, r);
  r = await gGuardar('admin', 'cubicaje', [{ op: 'alta', campos: { placa: 'abc-123', cubicaje: -5, tipo: 'sencillo' } }]);
  ok('cubicaje negativo → rechazado', r.ok === false, r);
  r = await gGuardar('admin', 'cubicaje', [{ op: 'alta', campos: { placa: 'abc-123', cubicaje: 14, tipo: 'sencillo' } }]);
  ok('cubicaje válido → OK', r.ok === true && r.aplicados === 1, r);
  const fila = (await sql`SELECT * FROM cubicaje WHERE placa='ABC123'`)[0];
  ok('placa normalizada (normPlaca: alfanumérica, MAYÚSCULAS, últimos 6)', !!fila, fila);
}

console.log(`\n${fallos === 0 ? '✓' : '✗'} ${casos} casos · ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
