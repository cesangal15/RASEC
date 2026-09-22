/**
 * casos_sql.js — casos de contrato que miran la BASE directamente (PGlite), para lo que el arnés HTTP no ve:
 * la migración 005_data_clima.sql y la vista data_maestro que leerá Power Query (D182, sep-2026), y la
 * migración 007_data_completa.sql con la regla única de ACTA del Worker (D184, sep-2026), y D185 (V3-11 Fases B+C):
 * la regla [O] de 007 (FC 1 en los «ajuste origen»), 008_tablero_vivo.sql y el PLIEGUE de la DATA del Tablero en vivo.
 *
 * Mismo formato que backend/pruebas/contrato/casos_*.js ({ id, modulo, nombre, run(api, t) }) y el mismo
 * ejecutor (correrCasos de arnes.js); aquí `api` = { modo:'sql', sql, sqlDir }. Los corre contrato_local.js
 * ANTES del arnés HTTP, con 005 ya re-aplicada sobre los datos cargados (backfill + semillas.js), que es como
 * se aplica en Supabase. Las filas que miran son las de `data` en semillas.js (2020-01-20…24).
 */
import fs from 'node:fs';
import path from 'node:path';
import { actaDeFecha } from '../src/api/obra/periodos.js';   // D184: la regla única de ACTA del Worker
import { tableroVivoLeer } from '../src/api/obra/tablero_vivo.js';   // D185: el pliegue del Tablero en vivo

// Encabezados EXACTOS de data_maestro desde D182, en orden (sin ORDEN/PROYECTO/LIBERACION/Columna1 ni `clima` cruda).
export const MAESTRO_D182 = ['obra_id', 'FECHA', 'GRUPO', 'CENTRO DE COSTO', 'CAPITULO', 'DESCRIPCION', 'UNIDAD FUNCIONAL',
  'ELEMENTO', 'ABS INICIAL', 'ABS FINAL', 'ACTA', 'UNIDAD MEDIDA', 'LARGO', 'ESPESOR', 'FC', 'CANTIDAD', 'CLIMA', 'OBSERVACION',
  'id_registro', 'timestamp', 'capataz', 'rol', 'actividad', 'pk_inicial', 'pk_final', 'area'];

const aplicar005 = (api) => api.sql.exec(fs.readFileSync(path.join(api.sqlDir, '005_data_clima.sql'), 'utf8'));
async function fila(api, id){
  const r = await api.sql`SELECT id_registro, clima, observacion, version FROM data WHERE obra_id='tm2sur' AND id_registro=${id}`;
  return r[0] || null;
}
// Todo lo que 005 puede tocar: las filas de `data`, la definición de la vista y esquema_version.
async function foto(api){
  const data = await api.sql.unsafe(`SELECT to_jsonb(d) AS j FROM data d ORDER BY obra_id, id_registro`);
  const vista = await api.sql.unsafe(`SELECT pg_get_viewdef('data_maestro'::regclass, true) AS v`);
  const ver = await api.sql.unsafe(`SELECT version, nota FROM esquema_version ORDER BY version`);
  return JSON.stringify({ data: data.map(r => r.j), vista: vista[0].v, ver });
}

export default [
  { id: 'obra.sql.005.sello', modulo: 'obra', nombre: '005 (D182): el sello «[Clima: X]» de la observación pasa a data.clima (si estaba vacío) y la observación queda limpia; version+1 una sola vez',
    async run(api, t){
      const s = await fila(api, 'seed-dg-sello');
      t.ok('clima vacío → el del sello (Lluvias)', !!s && s.clima === 'Lluvias', s);
      t.ok('observación sin sello ni «·» (nota del día)', !!s && s.observacion === 'nota del día', s);
      t.ok('version 0 → 1 (una sola subida aunque cambian clima y observación)', !!s && s.version === 1, s);
      const p = await fila(api, 'seed-dg-a-propio');
      t.ok('fila con clima propio: se conserva (Lluvias parciales), no lo pisa el sello', !!p && p.clima === 'Lluvias parciales', p);
      t.ok('…y su observación, que solo era el sello (en minúsculas), queda vacía', !!p && p.observacion === '' && p.version === 1, p);
      const n = await fila(api, 'seed-dg-sin-clima');
      t.ok('fila sin sello: intacta (observación, clima "" y version 0)', !!n && n.observacion === 'sin sello' && n.clima === '' && n.version === 0, n);
      const nb = await fila(api, 'seed-dg-nbsp');
      t.ok('sello con espacio duro (U+00A0) junto al «·»: la observación queda limpia, como con el \\s de JS', !!nb && nb.observacion === 'nbsp' && nb.clima === 'SOLEADO', nb);
      const quedan = await api.sql.unsafe(`SELECT count(*)::int AS n FROM data WHERE observacion ~* '\\[Clima:\\s*[^\\]]*\\]'`);
      t.ok('no queda ningún sello en DATA', quedan[0].n === 0, quedan[0]); } },

  { id: 'obra.sql.005.idempotente', modulo: 'obra', nombre: '005 corrida otra vez no cambia nada (datos, vista, esquema_version) y re-otorga el SELECT del lector del maestro si el rol existe',
    async run(api, t){
      // El rol de roles_lectura_maestro.sql (en Supabase se crea a mano): aquí NOLOGIN y con el GRANT de siempre.
      await api.sql.exec(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tm2_lector_maestro') THEN CREATE ROLE tm2_lector_maestro NOLOGIN; END IF; END $$;
        GRANT SELECT ON data_maestro TO tm2_lector_maestro;`);
      const antes = await foto(api);
      await aplicar005(api);
      const despues = await foto(api);
      t.ok('segunda pasada: data, vista y esquema_version idénticos', antes === despues, antes === despues ? '' : 'difieren');
      // D183: 006_proyeccion.sql ya lleva el máximo a 6; lo que mira este caso es que la 5 quedó UNA vez.
      const v = await api.sql.unsafe(`SELECT max(version)::int AS v, count(*) FILTER (WHERE version = 5)::int AS v5 FROM esquema_version`);
      t.ok('esquema_version tiene la 5 (una vez) y llega al menos a 5', v[0].v5 === 1 && v[0].v >= 5, v[0]);
      const g = await api.sql.unsafe(`SELECT has_table_privilege('tm2_lector_maestro', 'data_maestro', 'SELECT') AS p`);
      t.ok('el DROP VIEW no le quitó el SELECT a tm2_lector_maestro (005 lo re-otorga)', g[0].p === true, g[0]); } },

  { id: 'obra.sql.data_maestro', modulo: 'obra', nombre: 'data_maestro (D182): encabezados exactos y en orden; CLIMA = el de la fila o el del DÍA ("timestamp" NULLS LAST, id_registro)',
    async run(api, t){
      const cols = (await api.sql.unsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'data_maestro' ORDER BY ordinal_position`)).map(r => r.column_name);
      t.ok('encabezados exactos y en orden', JSON.stringify(cols) === JSON.stringify(MAESTRO_D182), cols);
      const m = {}; (await api.sql.unsafe(`SELECT id_registro, "FECHA", "CLIMA", "OBSERVACION" FROM data_maestro WHERE obra_id='tm2sur' AND "FECHA" BETWEEN '2020-01-20' AND '2020-01-24'`)).forEach(r => { m[r.id_registro] = r; });
      t.ok('FECHA como texto yyyy-MM-dd', !!m['seed-dg-sello'] && m['seed-dg-sello'].FECHA === '2020-01-22', m['seed-dg-sello']);
      t.ok('fila odt con clima "" → CLIMA del día (Lluvias: la de timestamp gana a la de timestamp NULL)', !!m['seed-dg-sin-clima'] && m['seed-dg-sin-clima'].CLIMA === 'Lluvias', m['seed-dg-sin-clima']);
      t.ok('fila con clima propio → el suyo', !!m['seed-dg-a-propio'] && m['seed-dg-a-propio'].CLIMA === 'Lluvias parciales', m['seed-dg-a-propio']);
      t.ok('drenajes del 21 sin clima → Soleado (el de tierras)', !!m['seed-dg-clima-o'] && m['seed-dg-clima-o'].CLIMA === 'Soleado', m['seed-dg-clima-o']);
      t.ok('clima histórico fuera de la lista, tal cual', !!m['seed-dg-historico'] && m['seed-dg-historico'].CLIMA === 'SOLEADO', m['seed-dg-historico']);
      t.ok('día sin ningún clima → CLIMA ""', !!m['seed-dg-sin-dia'] && m['seed-dg-sin-dia'].CLIMA === '', m['seed-dg-sin-dia']);
      t.ok('OBSERVACION ya sin sello', !!m['seed-dg-sello'] && m['seed-dg-sello'].OBSERVACION === 'nota del día', m['seed-dg-sello']); } },

  /* ---------- D184 · 007_data_completa.sql (fc_actividad + relleno de DATA) y la regla de ACTA ----------
   * Filas de `data` de semillas.js en 2020-06-10/20 y 2020-08-03; actas de banco B06 (2020-05-16..06-15) y B07
   * (2020-06-16..07-15) en `periodos`. 007 ya se re-aplicó sobre lo cargado (paso 2b de contrato_local.js). */
  { id: 'obra.sql.007.semillas', modulo: 'obra', nombre: '007 (D184): fc_actividad con las 7 descripciones VERBATIM de la BASE en FC 1.3 (nota con el conteo del histórico), RLS activada, esquema_version 7 una vez',
    async run(api, t){
      const f = await api.sql`SELECT descripcion, fc, nota, version FROM fc_actividad WHERE obra_id='tm2sur' ORDER BY descripcion`;
      t.ok('7 filas, todas FC 1.3 y version 0', f.length === 7 && f.every(r => r.fc === 1.3 && r.version === 0), f);
      t.ok('las 7 descripciones exactas', JSON.stringify(f.map(r => r.descripcion).sort()) === JSON.stringify(FC13_D184.slice().sort()), f.map(r => r.descripcion));
      t.ok('cada nota cita D184 y el conteo del histórico', f.every(r => /D184/.test(r.nota) && /\d+ de \d+ filas/.test(r.nota)), f.map(r => r.nota));
      // Verbatim: las 7 están tal cual como descripción en la BASE real (tools/sandbox/base_items.real.csv, sacada del Excel).
      const csv = path.join(api.sqlDir, '..', '..', 'tools', 'sandbox', 'base_items.real.csv');
      if (fs.existsSync(csv)) {
        const txt = fs.readFileSync(csv, 'utf8');
        const falta = FC13_D184.filter(d => txt.indexOf(',' + d + ',') < 0 && txt.indexOf(',"' + d + '",') < 0);
        t.ok('las 7 están verbatim en base_items.real.csv (hoja BASE del Excel)', falta.length === 0, falta);
      }
      const rls = await api.sql.unsafe(`SELECT relrowsecurity AS r FROM pg_class WHERE relname = 'fc_actividad'`);
      t.ok('RLS activada en fc_actividad', rls.length === 1 && rls[0].r === true, rls);
      const v = await api.sql.unsafe(`SELECT max(version)::int AS v, count(*) FILTER (WHERE version = 7)::int AS v7 FROM esquema_version`);
      t.ok('esquema_version: la 7 una sola vez y llega al menos a 7', v[0].v7 === 1 && v[0].v >= 7, v[0]); } },

  { id: 'obra.sql.007.relleno', modulo: 'obra', nombre: '007 (D184): rellena SOLO lo vacío (ACTA de la fecha, espesor 1, FC de la actividad por descripción normalizada, cantidad) con version+1 una vez; un FC 1.8 escrito a mano y una fila completa no cambian',
    async run(api, t){
      const f = async (id) => (await api.sql`SELECT acta, largo, espesor, fc, cantidad, version FROM data WHERE obra_id='tm2sur' AND id_registro=${id}`)[0] || null;
      const terr = await f('seed-d184-terr');
      t.ok('terraplén vacío → acta B06, espesor 1, FC 1.3, cantidad 130 ÷ 1.3 = 100, version 1', !!terr && terr.acta === 'B06' && terr.espesor === 1 && terr.fc === 1.3 && terr.cantidad === 100 && terr.version === 1, terr);
      const mano = await f('seed-d184-mano');
      t.ok('FC 1.8 escrito a mano: NO cambia (la conformación sería 1.3); la cantidad vacía sale con SU FC (90 ÷ 1.8 = 50); acta B06; version 1', !!mano && mano.fc === 1.8 && mano.cantidad === 50 && mano.espesor === 1 && mano.acta === 'B06' && mano.version === 1, mano);
      const lleno = await f('seed-d184-lleno');
      t.ok('fila completa (acta «7» a mano, cantidad 99 que no cuadra): intacta, version 0', !!lleno && lleno.acta === '7' && lleno.cantidad === 99 && lleno.fc === 1.3 && lleno.espesor === 1 && lleno.version === 0, lleno);
      const norm = await f('seed-d184-norm');
      t.ok('«  excavacion en material COMUN de   prestamos » (sin tildes, espacios de más) cruza con el préstamo → FC 1.3, cantidad 10, acta B07', !!norm && norm.fc === 1.3 && norm.espesor === 1 && norm.cantidad === 10 && norm.acta === 'B07' && norm.version === 1, norm);
      const otra = await f('seed-d184-otra');
      t.ok('actividad sin fila en fc_actividad → FC 1; espesor 0.5 escrito se respeta → cantidad 20', !!otra && otra.fc === 1 && otra.espesor === 0.5 && otra.cantidad === 20 && otra.acta === 'B07' && otra.version === 1, otra);
      const sl = await f('seed-d184-sinlargo');
      t.ok('sin LARGO: solo gana el acta (B07); espesor/FC siguen vacíos y la cantidad 7 no se toca', !!sl && sl.acta === 'B07' && sl.espesor === null && sl.fc === null && sl.cantidad === 7 && sl.version === 1, sl);
      const sa = await f('seed-d184-sinacta');
      t.ok('2020-08-03 (fuera de B06/B07, antes del acta 1) → acta "" pero espesor/FC/cantidad sí (26 ÷ 1.3 = 20)', !!sa && sa.acta === '' && sa.espesor === 1 && sa.fc === 1.3 && sa.cantidad === 20 && sa.version === 1, sa);
      const d182 = await f('seed-dg-historico');
      t.ok('fila de D182 ya completa (2020-01-23, acta "" que la fórmula deja en ""): intacta, version 0', !!d182 && d182.acta === '' && d182.version === 0, d182);
      const quedan = await api.sql.unsafe(`SELECT count(*)::int AS n FROM data WHERE obra_id='tm2sur' AND largo IS NOT NULL AND (espesor IS NULL OR fc IS NULL OR cantidad IS NULL)`);
      t.ok('no queda ninguna fila con LARGO y espesor/FC/cantidad vacíos', quedan[0].n === 0, quedan[0]); } },

  { id: 'obra.sql.007.ajuste_origen_d185', modulo: 'obra', nombre: '007 [O] (D185, enmienda de D184): en un «ajuste origen» (subtramo no operativo, por nombre o por la bandera de base_elementos) el FC es 1 — relleno fc NULL → 1 y corrección fc 1.3 → 1 con cantidad = largo × espesor —, version+1 una vez; el resto sigue con el FC de la actividad',
    async run(api, t){
      const f = async (id) => (await api.sql`SELECT elemento, largo, espesor, fc, cantidad, version FROM data WHERE obra_id='tm2sur' AND id_registro=${id}`)[0] || null;
      const fix = await f('seed-d185-ao-fix');
      t.ok('«ajuste origen UF2» con FC 1.3 (el error del Excel) → FC 1 y cantidad 130 (= largo × espesor), version 1', !!fix && fix.fc === 1 && fix.cantidad === 130 && fix.espesor === 1 && fix.version === 1, fix);
      const vac = await f('seed-d185-ao-vacio');
      t.ok('«ajuste origen UF1» con espesor/FC/cantidad vacías → 1 / 1 / 26 (no el 1.3 de la subbase), version 1', !!vac && vac.espesor === 1 && vac.fc === 1 && vac.cantidad === 26 && vac.version === 1, vac);
      const sl = await f('seed-d185-ao-sinlargo');
      t.ok('«  Ajuste  Origen UF1» (mayúsculas y espacios) sin LARGO con FC 1.3 → FC 1 y la cantidad 7 se queda, version 1', !!sl && sl.fc === 1 && sl.cantidad === 7 && sl.largo === null && sl.version === 1, sl);
      const ctl = await f('seed-d185-control');
      t.ok('control (terraplén en un tramo normal): el FC de la actividad, 1.3 → 10', !!ctl && ctl.fc === 1.3 && ctl.cantidad === 10 && ctl.version === 1, ctl);
      // Por la BANDERA no_operativo de base_elementos (003), con un nombre que no dice «ajuste origen».
      try {
        await api.sql`INSERT INTO base_elementos (obra_id, elemento, abs_inicio, abs_fin, no_operativo) VALUES ('tm2sur', 'CORREDOR PRUEBA D185', '9000', '9100', true)`;
        await api.sql`INSERT INTO data (obra_id, fecha, descripcion, unidad_funcional, elemento, largo, espesor, fc, cantidad, id_registro)
          VALUES ('tm2sur', '2020-07-08', 'Terraplenes (solo conformación)', 'UF1', ' corredor  prueba d185 ', 26, 1, 1.3, 20, 'tmp-d185-bandera'),
                 ('tm2sur', '2020-07-08', 'Terraplenes (solo conformación)', 'UF1', 'CORREDOR PRUEBA D185', 13, NULL, NULL, NULL, 'tmp-d185-bandera-vacia')`;
        await aplicar007(api);
        const a = await f('tmp-d185-bandera'), v = await f('tmp-d185-bandera-vacia');
        t.ok('subtramo con la BANDERA no_operativo (cruce por elemento normalizado): 1.3 → 1 y 26; vacío → 1 y 13', !!a && a.fc === 1 && a.cantidad === 26 && a.version === 1 && !!v && v.fc === 1 && v.espesor === 1 && v.cantidad === 13, [a, v]);
        const antes = await foto007(api); await aplicar007(api);
        t.ok('una segunda pasada no cambia nada (la corrección es idempotente)', antes === await foto007(api));
      } finally {
        await api.sql.unsafe(`DELETE FROM data WHERE id_registro LIKE 'tmp-d185-bandera%'`);
        await api.sql.unsafe(`DELETE FROM base_elementos WHERE elemento = 'CORREDOR PRUEBA D185'`);
      }
      const quedan = await api.sql.unsafe(`SELECT count(*)::int AS n FROM data WHERE elemento ~* '^\\s*ajuste\\s*origen' AND fc IS NOT NULL AND fc <> 1`);
      t.ok('no queda ningún «ajuste origen» con un FC distinto de 1', quedan[0].n === 0, quedan[0]); } },

  { id: 'obra.sql.007.idempotente', modulo: 'obra', nombre: '007 corrida otra vez no cambia nada (DATA con sus versiones, fc_actividad, esquema_version)',
    async run(api, t){
      const antes = await foto007(api);
      await aplicar007(api);
      const despues = await foto007(api);
      t.ok('segunda pasada: DATA (versiones incluidas), fc_actividad y esquema_version idénticos', antes === despues, antes === despues ? '' : 'difieren'); } },

  { id: 'obra.sql.007.permisos', modulo: 'obra', nombre: '007 con los roles de la API REST de Supabase (anon/authenticated) presentes: les quita todo sobre fc_actividad; sin ellos, el bloque DO no hace nada',
    async run(api, t){
      const habia = (await api.sql.unsafe(`SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')`)).map(r => r.rolname);
      await api.sql.exec(`DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        END $$;
        GRANT ALL ON fc_actividad TO anon, authenticated;`);   // lo que dan los privilegios por defecto de Supabase
      try {
        await aplicar007(api);
        const p = await api.sql.unsafe(`SELECT has_table_privilege('anon','fc_actividad','SELECT') AS a, has_table_privilege('authenticated','fc_actividad','SELECT') AS b,
                                               has_table_privilege('anon','fc_actividad','UPDATE') AS c`);
        t.ok('anon/authenticated sin SELECT ni UPDATE en fc_actividad', p[0].a === false && p[0].b === false && p[0].c === false, p[0]);
      } finally {
        // los roles que creó este caso se van (el banco no los tenía); si ya existían, se quedan
        for (const r of ['anon', 'authenticated']) if (habia.indexOf(r) < 0) await api.sql.exec(`DROP OWNED BY ${r}; DROP ROLE ${r};`);
      } } },

  { id: 'obra.sql.007.no_resucita', modulo: 'obra', nombre: '007 re-aplicada NO pisa un FC editado ni resucita filas borradas de fc_actividad (ni vaciando la tabla entera); se restaura al final',
    async run(api, t){
      const orig = await api.sql`SELECT obra_id, descripcion, fc, nota, version, editado_por, editado_ts FROM fc_actividad ORDER BY descripcion`;
      try {
        await api.sql`UPDATE fc_actividad SET fc = 1.25, version = version + 1, editado_por = 'prueba' WHERE obra_id='tm2sur' AND descripcion = 'Subbase Granular'`;
        await api.sql`DELETE FROM fc_actividad WHERE obra_id='tm2sur' AND descripcion = 'Excavación en material común de préstamos'`;
        await aplicar007(api);
        const a = await api.sql`SELECT descripcion, fc FROM fc_actividad WHERE obra_id='tm2sur'`;
        t.ok('el FC editado (1.25) sigue', a.some(r => r.descripcion === 'Subbase Granular' && r.fc === 1.25), a);
        t.ok('la fila borrada no vuelve (quedan 6)', a.length === 6 && !a.some(r => r.descripcion === 'Excavación en material común de préstamos'), a.map(r => r.descripcion));
        await api.sql`DELETE FROM fc_actividad WHERE obra_id='tm2sur'`;
        await aplicar007(api);
        const b = await api.sql`SELECT count(*)::int AS n FROM fc_actividad`;
        t.ok('tabla vaciada entera: 007 tampoco la re-siembra (la guarda es esquema_version 7)', b[0].n === 0, b[0]);
      } finally {
        // Restaura las 7 tal como estaban: los casos HTTP de D184 (casos_obra.js) corren después y las usan.
        await api.sql`DELETE FROM fc_actividad`;
        for (const r of orig) await api.sql`INSERT INTO fc_actividad (obra_id, descripcion, fc, nota, version, editado_por, editado_ts)
          VALUES (${r.obra_id}, ${r.descripcion}, ${r.fc}, ${r.nota}, ${r.version}, ${r.editado_por}, ${r.editado_ts})`;
      }
      const c = await api.sql`SELECT count(*)::int AS n FROM fc_actividad WHERE fc = 1.3 AND version = 0`;
      t.ok('restaurada: las 7 en 1.3 y version 0', c[0].n === 7, c[0]); } },

  { id: 'obra.sql.007.acta', modulo: 'obra', nombre: 'ACTA (D184): actaDeFecha del Worker y el relleno SQL de 007 dan la regla (a) —periodos o fórmula, borde 15/16, < 1 → ""— y cuadran con la ACTA de la Proyección (D183) mes a mes',
    async run(api, t){
      const per = await api.sql`SELECT acta, to_char(fecha_inicial,'YYYY-MM-DD') AS fi, to_char(fecha_final,'YYYY-MM-DD') AS ff FROM periodos WHERE obra_id='tm2sur' ORDER BY fecha_inicial`;
      const casos = [['2025-07-16', '10'], ['2026-08-15', '22'], ['2026-08-16', '23'], ['2026-09-15', '23'], ['2026-09-18', '24'],
                     ['2027-02-03', '28'], ['2027-01-15', '27'], ['2027-01-16', '28'], ['2027-12-20', '39'],
                     ['2020-01-10', ''], ['2024-10-15', ''], ['2024-10-16', '1']];
      const ver = (lista) => casos.map(([f, a]) => f + '→' + actaDeFecha(lista, f) + (actaDeFecha(lista, f) === a ? '' : ' (esperaba «' + a + '»)'));
      t.ok('actaDeFecha(periodos de la BD) = la regla en ' + casos.length + ' fechas (2026-09-18 = 24, 2027-02-03 = 28, 2020-01-10 = "")', casos.every(([f, a]) => actaDeFecha(per, f) === a), ver(per));
      t.ok('la fórmula sola (sin periodos) da lo mismo', casos.every(([f, a]) => actaDeFecha([], f) === a), ver([]));
      const reales = per.filter(p => /^\d+$/.test(p.acta));
      t.ok('la fórmula coincide con la tabla el primer y el último día de cada acta real (' + reales.length + ')', reales.length >= 17 && reales.every(p => actaDeFecha([], p.fi) === p.acta && actaDeFecha([], p.ff) === p.acta),
        reales.filter(p => actaDeFecha([], p.fi) !== p.acta || actaDeFecha([], p.ff) !== p.acta));
      t.ok('banco: 2020-06-15 → B06 y 2020-06-16 → B07 (borde 15/16 por la tabla)', actaDeFecha(per, '2020-06-15') === 'B06' && actaDeFecha(per, '2020-06-16') === 'B07', [actaDeFecha(per, '2020-06-15'), actaDeFecha(per, '2020-06-16')]);
      t.ok('fecha vacía o inválida → ""', actaDeFecha(per, '') === '' && actaDeFecha(per, '2026-13') === '' && actaDeFecha(per, null) === '', '');
      // El relleno SQL de 007 con la MISMA regla: filas temporales con la ACTA vacía (sin largo: solo puede cambiar el acta).
      try {
        for (const [f] of casos) await api.sql`INSERT INTO data (obra_id, fecha, descripcion, id_registro) VALUES ('tm2sur', ${f}, 'prueba acta D184', ${'tmp-d184-acta-' + f})`;
        await aplicar007(api);
        const r = await api.sql.unsafe(`SELECT to_char(fecha,'YYYY-MM-DD') AS f, acta, version FROM data WHERE id_registro LIKE 'tmp-d184-acta-%' ORDER BY fecha`);
        const m = {}; r.forEach(x => { m[x.f] = x; });
        t.ok('007 escribe la misma ACTA que actaDeFecha en las ' + casos.length + ' fechas', casos.every(([f, a]) => m[f] && m[f].acta === a), r.map(x => x.f + '→' + x.acta));
        t.ok('version+1 solo donde el acta cambió (las que dan "" se quedan en 0)', casos.every(([f, a]) => m[f] && m[f].version === (a ? 1 : 0)), r.map(x => x.f + ':' + x.version));
      } finally {
        await api.sql.unsafe(`DELETE FROM data WHERE id_registro LIKE 'tmp-d184-acta-%'`);
      }
      // Proyección (D183, actaDePeriodo_ se queda como está): la ACTA de cada mes del plan (la que CIERRA ese mes, vista
      // proyeccion_plan_maestro) = la de cualquier fecha del periodo que cierra ese mes (su día 15).
      const plan = await api.sql.unsafe(`SELECT to_char(periodo,'YYYY-MM-DD') AS p, "ACTA" AS a FROM proyeccion_plan_maestro WHERE obra_id='tm2sur' ORDER BY periodo`);
      t.ok('proyeccion_plan_maestro: ACTA del mes = actaDeFecha(día 15 de ese mes) en los ' + plan.length + ' periodos del plan', plan.length > 0 && plan.every(x => String(x.a == null ? '' : x.a) === actaDeFecha(per, x.p.slice(0, 8) + '15')),
        plan.map(x => x.p.slice(0, 7) + ':' + x.a + '/' + actaDeFecha(per, x.p.slice(0, 8) + '15')));
      t.ok('…y fuera de la tabla, la fórmula de actaDePeriodo_ (2027-01 → 27; 2020-01 → sin acta)', actaDeFecha(per, '2027-01-15') === '27' && actaDeFecha(per, '2027-01-01') === '27' && actaDeFecha(per, '2020-01-15') === '', ''); } },

  /* ---------- D185 · 008_tablero_vivo.sql (tablero_mapeo, tablero_horas, vista tablero_data_campo) y el pliegue ----------
   * Filas de `data` de semillas.js del 2020-07-07 (una por campo del Tablero, con '*' y UF1/UF2, una sin UF y otra
   * fuera del mapeo) y del 2020-07-08 ([O]). El pliegue se lee con tableroVivoLeer (lo mismo que GET tablero_vivo). */
  { id: 'obra.sql.008.esquema', modulo: 'obra', nombre: '008 (D185): esquema_version 8 una vez; tablero_mapeo = MAPEO A2:C10 (9 filas verbatim de la BASE); tablero_horas y la vista tablero_data_campo; RLS en las dos tablas',
    async run(api, t){
      const v = await api.sql.unsafe(`SELECT max(version)::int AS v, count(*) FILTER (WHERE version = 8)::int AS v8 FROM esquema_version`);
      t.ok('esquema_version: la 8 una sola vez', v[0].v8 === 1 && v[0].v >= 8, v[0]);
      const m = await api.sql.unsafe(`SELECT descripcion, uf, campo, orden FROM tablero_mapeo WHERE obra_id='tm2sur' ORDER BY orden`);
      t.ok('las 9 filas de MAPEO A2:C10 (descripción, UF, campo, orden)', JSON.stringify(m.map(r => [r.descripcion, r.uf, r.campo, r.orden])) === JSON.stringify(MAPEO_D185.map((x, i) => x.concat(i + 1))), m);
      const rls = await api.sql.unsafe(`SELECT relname, relrowsecurity AS r FROM pg_class WHERE relname IN ('tablero_mapeo','tablero_horas') ORDER BY relname`);
      t.ok('RLS activada en tablero_mapeo y tablero_horas', rls.length === 2 && rls.every(x => x.r === true), rls);
      const cols = (await api.sql.unsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'tablero_horas' ORDER BY ordinal_position`)).map(r => r.column_name);
      t.ok('tablero_horas (obra_id, horas, archivo, cargado_por, cargado_ts, version)', JSON.stringify(cols) === JSON.stringify(['obra_id', 'horas', 'archivo', 'cargado_por', 'cargado_ts', 'version']), cols);
      let rechazo = '';
      try { await api.sql.unsafe(`INSERT INTO tablero_mapeo (obra_id, descripcion, uf, campo) VALUES ('tm2sur', 'x', 'UF3', 'ter')`); } catch (e) { rechazo = String(e.message || e); }
      t.ok('una UF fuera de la lista (UF3) la rechaza el CHECK', /check/i.test(rechazo), rechazo); } },

  { id: 'obra.sql.008.pliegue', modulo: 'obra', nombre: 'PLIEGUE (D185): por FECHA × campo = Σ CANTIDAD compacta (× fc de la Proyección = suelto-equivalente); «*» casa cualquier UF, ter/sub/bas por UF; CANTIDAD NULL → largo·espesor/fc; clima del día en MAYÚSCULAS; periodo 16→15 con piso 2025-06; TODOS los días = cálculo aparte en JS',
    async run(api, t){
      const c = () => ({ sql: api.sql, memo: {}, pet: { t0: Date.now(), log: null } });
      const r = await tableroVivoLeer(c(), {});
      t.ok('ok, fuente galca, fc_dias = el fc de la Proyección (1.3)', r.ok === true && r.fuente === 'galca' && r.fc_dias === 1.3, { ok: r.ok, error: r.error, fc: r.fc_dias });
      const fc = r.fc_dias, d = (r.dias || []).filter(x => x.f === '2020-07-07')[0];
      const esp = { apr: 15, pre: 3, nap: 4, exc: 22, ter1: 20, ter2: 7, ter: 27, sub1: 0, sub2: 2, sub: 2, bas1: 1.5, bas2: 0, bas: 1.5 };
      const mal = d ? Object.keys(esp).filter(k => Math.abs(d[k] / fc - esp[k]) > 1e-9 * Math.max(1, esp[k])) : ['sin día'];
      t.ok('2020-07-07 ÷ fc = Σ CANTIDAD: apr 10+5 (la UF2 en minúsculas casa la fila «*»), pre 3 (sin UF), nap 4, exc 22, ter 20/7 (el de UF vacía NO cuenta), sub 0/2, bas 1.5/0; el pedraplén no suma', mal.length === 0, { mal, d });
      t.ok('…con p = 2025-06 (piso) y t = «LLUVIAS PARCIALES» (el clima del día, en mayúsculas)', !!d && d.p === '2025-06' && d.t === 'LLUVIAS PARCIALES', d && [d.p, d.t]);
      // CANTIDAD NULL (007 ya no deja ninguna con LARGO: se meten a mano después) → LARGO × COALESCE(espesor,1) ÷ COALESCE(NULLIF(fc,0),1).
      try {
        await api.sql`INSERT INTO data (obra_id, fecha, descripcion, unidad_funcional, elemento, largo, espesor, fc, cantidad, id_registro) VALUES
          ('tm2sur', '2020-07-07', 'Terraplenes (solo conformación)', 'UF1', 'tm2 pk 10+000 - 11+000', 26, 0.5, 1.3, NULL, 'tmp-d185-nulo-a'),
          ('tm2sur', '2020-07-07', 'Subbase Granular', 'uf 1', 'tm2 pk 10+000 - 11+000', 4, NULL, 0, NULL, 'tmp-d185-nulo-b'),
          ('tm2sur', '2020-07-07', 'Base granular estabilizada con cemento (No incluye cemento)', 'UF2', 'tm2 pk 31+000 - 32+000', NULL, NULL, NULL, NULL, 'tmp-d185-nulo-c')`;
        const r2 = await tableroVivoLeer(c(), {}), d2 = (r2.dias || []).filter(x => x.f === '2020-07-07')[0];
        t.ok('CANTIDAD NULL: terraplén 26 × 0.5 ÷ 1.3 = 10 (ter1 30); subbase «uf 1» 4 × 1 ÷ (fc 0 → 1) = 4 (sub1 4); sin largo ni cantidad = 0',
          !!d2 && Math.abs(d2.ter1 / fc - 30) < 1e-9 && Math.abs(d2.sub1 / fc - 4) < 1e-9 && Math.abs(d2.bas2 / fc) < 1e-12 && Math.abs(d2.ter / fc - 37) < 1e-9, d2);
      } finally { await api.sql.unsafe(`DELETE FROM data WHERE id_registro LIKE 'tmp-d185-nulo-%'`); }
      // TODOS los días del banco contra un cálculo aparte en JS (otra normalización), leyendo `data` crudo.
      const filas = await api.sql.unsafe(`SELECT to_char(fecha,'YYYY-MM-DD') AS f, descripcion, unidad_funcional AS uf, largo, espesor, fc, cantidad FROM data WHERE obra_id='tm2sur'`);
      const ind = pliegueJs(filas);
      const fW = (r.dias || []).map(x => x.f), fI = Object.keys(ind).sort();
      t.ok('las mismas fechas (' + fI.length + ': todas las de DATA ≥ 2020, cualquier área)', JSON.stringify(fW) === JSON.stringify(fI), { soloW: fW.filter(x => !ind[x]).slice(0, 5), soloI: fI.filter(x => fW.indexOf(x) < 0).slice(0, 5) });
      let peor = { e: 0 };
      for (const x of r.dias || []) { const e = ind[x.f]; if (!e) continue;
        for (const k of CAMPOS_D185) { const er = Math.abs(x[k] / fc - e[k]) / Math.max(1, Math.abs(e[k])); if (er > peor.e) peor = { e: er, f: x.f, k, w: x[k] / fc, i: e[k] }; } }
      t.ok('por FECHA × 13 campos: ÷ fc = Σ CANTIDAD del cálculo aparte (error relativo máx. ' + peor.e.toExponential(1) + ' < 1e-9)', peor.e < 1e-9, peor);
      t.ok('periodo = mes de CIERRE 16→15 con piso 2025-06 en todos los días', (r.dias || []).every(x => x.p === periodoJs(x.f)), (r.dias || []).filter(x => x.p !== periodoJs(x.f)).slice(0, 3)); } },

  { id: 'obra.sql.008.idempotente', modulo: 'obra', nombre: '008 corrida otra vez no cambia nada (mapeo, horas, vista, esquema_version)',
    async run(api, t){
      const foto = async () => JSON.stringify({ m: await api.sql.unsafe(`SELECT to_jsonb(x) AS j FROM tablero_mapeo x ORDER BY descripcion, uf`),
        h: await api.sql.unsafe(`SELECT obra_id, version FROM tablero_horas ORDER BY obra_id`),
        v: await api.sql.unsafe(`SELECT pg_get_viewdef('tablero_data_campo'::regclass, true) AS d`),
        e: await api.sql.unsafe(`SELECT version, nota FROM esquema_version ORDER BY version`) });
      const antes = await foto();
      await api.sql.exec(fs.readFileSync(path.join(api.sqlDir, '008_tablero_vivo.sql'), 'utf8'));
      t.ok('segunda pasada: idénticos', antes === await foto()); } }
];

/* ---------- D185: ayudas de los casos de 008 (declaradas después del array; solo se usan dentro de run()) ---------- */
// MAPEO A2:C10 del Excel del jefe (descripción verbatim de la BASE, UF, campo), en orden.
const MAPEO_D185 = [['Excavaciones en material común APROVECHABLE', '*', 'apr'], ['Excavación en material común de préstamos', '*', 'pre'],
  ['Excavaciones en material común NO APROVECHABLE', '*', 'nap'], ['Terraplenes (solo conformación)', 'UF1', 'ter'], ['Terraplenes (solo conformación)', 'UF2', 'ter'],
  ['Subbase Granular', 'UF1', 'sub'], ['Subbase Granular', 'UF2', 'sub'],
  ['Base granular estabilizada con cemento (No incluye cemento)', 'UF1', 'bas'], ['Base granular estabilizada con cemento (No incluye cemento)', 'UF2', 'bas']];
const CAMPOS_D185 = ['exc', 'apr', 'pre', 'nap', 'ter1', 'ter2', 'ter', 'sub1', 'sub2', 'sub', 'bas1', 'bas2', 'bas'];
const normJs = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u00a0\u2007\u202f\u200b-\u200d\ufeff]/g, ' ').toUpperCase().replace(/\s+/g, ' ').trim();
function periodoJs(f){ let y = +f.slice(0, 4), m = +f.slice(5, 7); if (+f.slice(8, 10) > 15) { m++; if (m > 12) { m = 1; y++; } } const p = y + '-' + String(m).padStart(2, '0'); return p < '2025-06' ? '2025-06' : p; }
// Σ CANTIDAD por fecha × campo, a mano: la fila de su UF gana a la de '*'; CANTIDAD NULL → largo·espesor/fc (fc 0 → 1).
function pliegueJs(filas){
  const M = MAPEO_D185.map(x => ({ k: normJs(x[0]), uf: x[1], campo: x[2] })), out = {};
  for (const r of filas){
    if (r.f < '2020-01-01') continue;
    const o = out[r.f] || (out[r.f] = Object.fromEntries(CAMPOS_D185.map(k => [k, 0])));
    const uf = String(r.uf || '').replace(/\s/g, '').toUpperCase(), k = normJs(r.descripcion);
    const m = M.filter(x => x.k === k && x.uf === uf)[0] || M.filter(x => x.k === k && x.uf === '*')[0];
    if (!m) continue;
    const q = r.cantidad != null ? Number(r.cantidad) : (r.largo != null ? Number(r.largo) * (r.espesor != null ? Number(r.espesor) : 1) / ((r.fc != null && Number(r.fc) !== 0) ? Number(r.fc) : 1) : 0);
    o[m.campo] += q;
    if (m.campo === 'apr' || m.campo === 'pre' || m.campo === 'nap') o.exc += q;
    else if (uf === 'UF1' || uf === 'UF2') o[m.campo + uf.slice(-1)] += q;
  }
  return out;
}

/* ---------- D184: ayudas de los casos de 007 (declaradas después del array: solo se usan dentro de run()) ---------- */
// Las 7 descripciones con FC 1.3: texto COMPLETO de la hoja BASE (= base_items.real.csv).
const FC13_D184 = ['Terraplenes (solo conformación)', 'Excavaciones en material común APROVECHABLE', 'Excavaciones en material común NO APROVECHABLE',
  'Excavación en material común de préstamos', 'Subbase Granular', 'Base granular estabilizada con cemento (No incluye cemento)',
  'Conformación y disposición de sobrantes (incluye obras de adecuación)'];
const aplicar007 = (api) => api.sql.exec(fs.readFileSync(path.join(api.sqlDir, '007_data_completa.sql'), 'utf8'));
// Todo lo que 007 puede tocar: las filas de `data`, fc_actividad y esquema_version.
async function foto007(api){
  const data = await api.sql.unsafe(`SELECT to_jsonb(d) AS j FROM data d ORDER BY obra_id, id_registro`);
  const fca = await api.sql.unsafe(`SELECT to_jsonb(f) AS j FROM fc_actividad f ORDER BY obra_id, descripcion`);
  const ver = await api.sql.unsafe(`SELECT version, nota FROM esquema_version ORDER BY version`);
  return JSON.stringify({ data: data.map(r => r.j), fca: fca.map(r => r.j), ver });
}
