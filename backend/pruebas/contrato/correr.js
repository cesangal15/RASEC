#!/usr/bin/env node
/**
 * Corre el juego de pruebas de CONTRATO contra el backend en `vm` (por defecto) o contra una URL.
 *
 *   node backend/pruebas/contrato/correr.js                         # vm: los .gs reales con hojas en memoria
 *   node backend/pruebas/contrato/correr.js --url=https://api.galca.app/prueba --usuario=admin --clave=…
 *   node backend/pruebas/contrato/correr.js --url=… --usuario=… --clave=… --escribir     # también las escrituras
 *   node backend/pruebas/contrato/correr.js --obra=https://script.google.com/…/exec --asistencias=…/exec …
 *
 * Opciones:
 *   --url=BASE           base del Worker; se le añaden /obra, /asistencias (el Parte va por /obra con mod=parte)
 *   --obra=URL --asistencias=URL [--parte=URL]   URLs directas (p. ej. los /exec de prueba)
 *   --usuario= --clave=  credenciales del perfil `admin` (login real contra obra). También CONTRATO_USUARIO / CONTRATO_CLAVE.
 *   --perfil.<nombre>=usuario:clave   más perfiles (capataz, jefe…) para los casos que los piden
 *   --escribir           contra una URL, corre también los casos que escriben (usan FECHA_BANCO=2020-01-13 y se limpian)
 *   --solo=obra,parte    módulos a correr        --caso=regex   filtra por id de caso
 *   --verboso            imprime cada comprobación que pasa      --json   resumen en JSON al final
 *
 * Sale con código 1 si algún caso falla. Los omitidos (sin credenciales, soloVm contra URL, escrituras sin
 * --escribir) se listan pero no fallan.
 */
'use strict';
const { apiVm, apiUrl, correrCasos } = require('./arnes');
const { semillas } = require('./semillas');

const args = {}; process.argv.slice(2).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });
const CASOS = [].concat(require('./casos_obra'), require('./casos_asistencias'), require('./casos_parte'));

async function main(){
  const modoUrl = !!(args.url || args.obra);
  let api;
  if (modoUrl){
    const perfiles = {};
    const u = args.usuario || process.env.CONTRATO_USUARIO, c = args.clave || process.env.CONTRATO_CLAVE;
    if (u && c) perfiles.admin = { usuario: u, clave: c };
    Object.keys(args).filter(k => k.indexOf('perfil.') === 0).forEach(k => { const [usuario, clave] = String(args[k]).split(':'); perfiles[k.slice(7)] = { usuario, clave }; });
    api = apiUrl({ base: args.url, obra: args.obra, asistencias: args.asistencias, parte: args.parte, perfiles });
    console.log('Contrato contra URL · obra=' + api.urls.obra + ' · asistencias=' + api.urls.asistencias + (args.escribir ? ' · CON escrituras (FECHA_BANCO ' + api.FECHA_BANCO + ')' : ' · solo lectura'));
    if (!perfiles.admin) console.log('  (sin --usuario/--clave: los casos con token se omiten)');
  } else {
    api = apiVm(semillas());
    console.log('Contrato en modo vm · Codigo.gs + CodigoParte.gs + CodigoAsistencias.gs con hojas en memoria');
  }
  const solo = args.solo ? String(args.solo).split(',') : null, re = args.caso ? new RegExp(args.caso) : null;
  const filtro = (c) => (!solo || solo.indexOf(c.modulo) >= 0) && (!re || re.test(c.id));
  let modulo = '';
  const casos = CASOS.filter(filtro);
  const res = { casos: 0, comprobaciones: 0, fallos: 0, omitidos: 0, detalle: [] };
  for (const c of casos){
    if (c.modulo !== modulo){ modulo = c.modulo; console.log('\n[' + modulo + ']'); }
    const r = await correrCasos(api, [c], { escribir: !!args.escribir || !modoUrl, verboso: !!args.verboso });
    res.casos += r.casos; res.comprobaciones += r.comprobaciones; res.fallos += r.fallos; res.omitidos += r.omitidos; res.detalle.push(...r.detalle);
  }
  console.log('\n' + res.casos + ' casos · ' + res.comprobaciones + ' comprobaciones · ' + res.fallos + ' fallo(s) · ' + res.omitidos + ' omitido(s)');
  if (args.json) console.log(JSON.stringify(res, null, 1));
  process.exit(res.fallos ? 1 : 0);
}
main().catch(err => { console.error('El arnés no pudo correr: ' + (err && err.stack || err)); process.exit(2); });
