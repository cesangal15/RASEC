#!/usr/bin/env node
/**
 * aplicar_decisiones.js — aplica sobre una sesión del conciliador las decisiones que la herramienta deja
 * a la mano del dueño (Paso 5 · soportes y Paso 6 · revisión) y vuelve a sacar los exportes del Paso 7
 * con el MISMO código de conciliador.js (Sesion._aplicar + setEstado + Exportes.*). No tiene lógica
 * propia de CC/km: los pendientes salen con propuestaPendiente()/derivadosProforma() de la herramienta.
 *
 *   node aplicar_decisiones.js --sesion=<conciliador_sesion_*.json> --decisiones=<decisiones.json>
 *        --config=<config.json> --salida=<carpeta APARTE>
 *
 * decisiones.json: [{ remision, estado, nota, evidencia?:{archivo,pagina}, area?, cc?, m3?, viajes? }]
 *   estado ∈ PENDIENTE_DIGITACION (soporte confirmado → al acta) · EXCLUIDA_UF3 · EXCLUIDA_ASFALTO ·
 *            EXCLUIDA_OTRA_AREA · ACEPTADA_MANUAL · RECHAZADA · (cualquier estado válido de la herramienta)
 *   area/cc → rc.actaPend (lo mismo que editar área/CC del pendiente en pantalla; PUENTES/TM1 → 3701.11.03)
 *   m3 / viajes → corrige la cantidad reclamada en la proforma (recibo con «N viajes»: m3 × N)
 *   destino / origen → corrige el PK de la proforma (p. ej. el que dice la programación de WhatsApp)
 * La salida incluye la sesión resultante (importable en la herramienta con 💾 Importar sesión).
 */
'use strict';
const fs = require('fs'), path = require('path');
const { crearContexto } = require('./cargar_conciliador.js');

const args = {};
process.argv.slice(2).forEach(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args[m[1]] = m[2] === undefined ? true : m[2]; });
function fallar(msg){ console.error('✗ ' + msg); process.exit(2); }
if (!args.sesion || !args.decisiones || !args.salida) fallar('Faltan --sesion, --decisiones o --salida.');

const salida = path.resolve(args.salida); fs.mkdirSync(salida, { recursive: true });
const config = args.config ? JSON.parse(fs.readFileSync(args.config, 'utf8')) : null;
const sesion = JSON.parse(fs.readFileSync(args.sesion, 'utf8'));
const decisiones = JSON.parse(fs.readFileSync(args.decisiones, 'utf8'));
if (sesion.tipo !== 'conciliador_sesion' || !sesion.corte) fallar('--sesion no parece una sesión del conciliador.');

const T = crearContexto({ repo: args.repo, config, salida });
const J = e => T.eval(e);
T.set('__s', sesion);
J('Sesion._aplicar(__s)');
if (!J('!!S.corte')) fallar('No se pudo cargar la sesión.');

const validos = J('ESTADOS');
const informe = [];
for (const d of decisiones) {
  if (validos.indexOf(d.estado) < 0) { informe.push('⚠ ' + d.remision + ': estado desconocido ' + d.estado); continue; }
  T.set('__d', d);
  const r = J(`(()=>{
    const d=__d; const rcs=S.corte.reclamos.filter(x=>String(x.remision)===String(d.remision));
    if(!rcs.length) return {ok:false,msg:'no está en la sesión'};
    const rc=rcs[0];
    const antes=rc.estado;
    if(d.evidencia) rc.evidencia={archivo:d.evidencia.archivo,pagina:d.evidencia.pagina};
    if(d.area!=null||d.cc!=null){ rc.actaPend=rc.actaPend||{}; if(d.area!=null) rc.actaPend.area=d.area; if(d.cc!=null) rc.actaPend.cc=d.cc; }
    if(d.m3!=null){ rc.secundarios=rc.secundarios||{}; rc.secundarios.cantidadProforma=rc.secundarios.cantidad; rc.secundarios.cantidad=String(d.m3); }
    if(d.viajes!=null){ rc.secundarios=rc.secundarios||{}; rc.secundarios.viajes=String(d.viajes); }
    // Destino/origen corregidos por la programación (p. ej. TM1: «botar en el 15+800» aunque la proforma diga 21+500)
    if(d.destino!=null){ rc.secundarios=rc.secundarios||{}; rc.secundarios.destinoProforma=rc.secundarios.destino; rc.secundarios.destino=String(d.destino); }
    if(d.origen!=null){ rc.secundarios=rc.secundarios||{}; rc.secundarios.origenProforma=rc.secundarios.origen; rc.secundarios.origen=String(d.origen); }
    if(antes!==d.estado) setEstado(rc,d.estado,'skill: '+(d.nota||''),false);
    return {ok:true,antes:antes,despues:rc.estado,duplicados:rcs.length};
  })()`);
  informe.push((r.ok ? '✓ ' : '✗ ') + d.remision + ': ' + (r.ok ? r.antes + ' → ' + r.despues + (r.duplicados > 1 ? ' (⚠ ' + r.duplicados + ' reclamos con esa remisión: se tocó el primero)' : '') : r.msg));
}

['xlsxActa', 'xlsxActaPend', 'xlsxDigitadora', 'xlsxResumen'].forEach(fn => {
  try { J('Exportes.' + fn + '()'); } catch (e) { informe.push('⚠ Exportes.' + fn + ': ' + e.message); }
});
const base = J('Exportes._nombre("X","txt")').replace(/^X_/, '').replace(/\.txt$/, '');
const fRes = path.join(salida, 'resumen_' + base + '.txt'); fs.writeFileSync(fRes, J('resumenCorte()') + '\n');
const fSes = path.join(salida, 'conciliador_sesion_' + base + '.json'); fs.writeFileSync(fSes, J('sesionJSON(true)'));

console.log(informe.join('\n'));
console.log('\nConteo: ' + JSON.stringify(J('conteoEstados()')));
console.log('Al acta (encontradas + aceptadas): ' + J('filasActa().length') + ' · pendientes de digitación: ' + J('pendientesOrdenadas().length'));
console.log('\nArchivos:\n  ' + T.escrituras.concat([fRes, fSes]).join('\n  '));
