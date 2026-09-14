#!/usr/bin/env node
/**
 * Verificación D170 — Recorte de equipos en el reporte del capataz: solo el CÓDIGO de la máquina.
 *
 * Reproduce en banco, con el código real de `Codigo.gs` + `CodigoParte.gs` (mismo arnés que D166: HMAC de
 * verdad, hojas falsas, LOG que anota), lo que pide el prompt de cierre de V3-01:
 *   1 · `?action=maquinas` devuelve además `equipos` = PARTE_EQUIPOS activos (código·tipo·placa), por tipo y código.
 *   2 · Reporte de capataz con 1 actividad y 2 equipos → 2 filas en MAQUINARIA con código y producción de la
 *       línea; G operador · L horas · O h_mant · R ESTADO · app_horas_programadas · app_horas_muertas · motivo VACÍOS.
 *   3 · `equipos` como lista de códigos ('CR026') → aceptado; el tipo sale de PARTE_EQUIPOS; los vibros sin producción;
 *       reenvío deduplicado con id determinístico (D82).
 *   4 · Payload VIEJO de la cola offline (horas_operadas/operador/motivo/programadas/muertas) → aceptado, fila escrita
 *       SIN esos campos, LOG en `ok`, reenvío deduplicado.
 *   5 · `bandeja`, `estado` y `maquinaria_produccion` abren con filas nuevas (vacías) y viejas (con horas) mezcladas.
 *   6 · Validación (D166): un equipo mal formado sigue rechazándose con error `payload`.
 *   7 · `esTipoSinProduccion` entiende el vocabulario de PARTE_EQUIPOS (COMPACTADORES, RETROCARGADOR…).
 *   8 · Frontend: reporte-capataz.html sin horas/operador/motivo; flota.js con `equiposCapataz` (y su caída a
 *       `maquinas`); encargado.html sin horas; estado.html/menu.html marcados obsoletos; sw.js con CACHE_V nuevo.
 *
 *   node backend/pruebas/verificar_d170_recorte_equipos.js
 */
const fs=require('fs'), path=require('path'), vm=require('vm'), crypto=require('crypto');
const REPO=path.resolve(__dirname,'..','..');
const leer=(p)=>fs.readFileSync(path.join(REPO,p),'utf8');
const SRC=leer('backend/Codigo.gs')+'\n'+leer('backend/CodigoParte.gs');
const HOY=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
const SECRETO='secreto-de-banco-largo-xxxxxxxxxxxxxxxx';
let fallos=0, casos=0;
function ok(n,c,x){ casos++; if(!c){ fallos++; console.log('  ✗ '+n+(x?'  → '+x:'')); } else console.log('  ✓ '+n); }

function hojaFalsa(filas){
  const g={
    _f: filas.map(r=>r.slice()), _escrituras:0,
    getLastRow: ()=>g._f.length,
    getLastColumn: ()=>g._f.reduce((m,r)=>Math.max(m,r.length),0),
    getMaxRows: ()=>Math.max(g._f.length,200), getMaxColumns: ()=>Math.max(g.getLastColumn(),60),
    insertRowsAfter(){}, insertColumnsAfter(){},
    _fila(i){ while(g._f.length<=i) g._f.push([]); return g._f[i]; },
    getDataRange(){ return g.getRange(1,1,Math.max(g._f.length,1),Math.max(g.getLastColumn(),1)); },
    appendRow(r){ g._f.push(r.slice()); g._escrituras++; },
    getRange(f,c,nf,nc){
      nf=(nf===undefined?1:nf); nc=(nc===undefined?1:nc);
      return {
        getValues(){ const out=[];
          for(let i=f-1;i<f-1+nf;i++){ const r=g._f[i]||[], fila=[];
            for(let j=c-1;j<c-1+nc;j++) fila.push(r[j]===undefined?'':r[j]);
            out.push(fila); } return out; },
        setValues(m){ g._escrituras++; for(let i=0;i<m.length;i++){ const r=g._fila(f-1+i);
            for(let j=0;j<m[i].length;j++) r[c-1+j]=m[i][j]; } },
        setNumberFormat(){ return this; },
        setValue(v){ g._escrituras++; g._fila(f-1)[c-1]=v; },
        clearContent(){ for(let i=f-1;i<f-1+nf;i++){ const r=g._f[i]; if(!r) continue; for(let j=c-1;j<c-1+nc;j++) r[j]=''; } }
      };
    }
  };
  return g;
}
function cacheFalsa(){ const m=new Map(); return { get:(k)=>m.has(k)?m.get(k):null, put:(k,v)=>{ m.set(k,String(v)); }, remove:(k)=>m.delete(k) }; }
function cargar(opts){
  opts=opts||{};
  const hojas={};
  hojas.USUARIOS=hojaFalsa([['usuario','clave','rol','areas','redirige','estado'],
    ['admin','1234','admin','','menu.html','activo'], ['angel','clave','capataz','','seleccion-reporte.html','activo'], ['javier','clave','encargado','','encargado.html','activo']]);
  if(!opts.sinParteEquipos) hojas.PARTE_EQUIPOS=hojaFalsa([
    ['codigo','tipo','placa','proveedor','medidor','ultima_fecha','ultimo_final','activo'],
    ['VOL048','VOLQUETAS DOBLETROQUE','NNM180','ORTIZ','KM','2026-09-09',27120,'SI'],
    ['CR026','VIBROCOMPACTADOR','POCR026','ORTIZ','HOROMETRO','2026-09-09',1698,'SI'],
    ['EXC015','EXCAVADORAS','MC706830','ORTIZ','HOROMETRO','2026-09-09',2711.6,'SI'],
    ['BL005','BULLDOZER','MC705987','ORTIZ','HOROMETRO','2026-09-09',2546,''],        // activo vacío = activo
    ['RT-02','RETROCARGADOR','','MAQUISABANA','HOROMETRO','2026-09-09',7049.6,'SI'],
    ['BL002','BULLDOZER','MC725424','ORTIZ','REVISAR','','','NO']]);
  hojas.PARTE_OPERADORES=hojaFalsa([['operador','partes_ult_4_meses'],['Nelson Rangel',323]]);
  hojas.PARTE_CC=hojaFalsa([['centro_coste','proyecto','descripcion_cc','usos_ult_4_meses'],['3701.02.07','3701','Terraplén',457]]);
  hojas.PARTE_ACTIVIDADES=hojaFalsa([['tipo_equipo','descripcion_trabajo','veces']]);
  hojas.CUBICAJE=hojaFalsa([['placa','cubicaje']]);
  const cache=cacheFalsa();
  const ss={ getSheetByName:(n)=>hojas[n]||null, insertSheet:(n)=>{ hojas[n]=hojaFalsa([]); return hojas[n]; }, getSpreadsheetTimeZone:()=>'America/Bogota' };
  const ctx={ console,
    SpreadsheetApp:{ openById:()=>ss },
    ContentService:{ createTextOutput:(t)=>({ setMimeType:()=>JSON.parse(t) }), MimeType:{JSON:'json'} },
    CacheService:{ getScriptCache:()=>cache },
    PropertiesService:{ getScriptProperties:()=>({ getProperty:(k)=>k==='AUTH_SECRETO'?SECRETO:k==='AUTH_V'?'1':null, setProperty(){} }) },
    LockService:{ getScriptLock:()=>({ waitLock:()=>true, releaseLock(){} }) },
    Utilities:{
      computeHmacSha256Signature:(txt, clave)=>crypto.createHmac('sha256', String(clave)).update(String(txt),'utf8').digest(),
      base64EncodeWebSafe:(b)=>Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_'),
      base64DecodeWebSafe:(s)=>Buffer.from(String(s).replace(/-/g,'+').replace(/_/g,'/'),'base64'),
      newBlob:(x)=>{ const b=Buffer.isBuffer(x)?x:Buffer.from(String(x),'utf8'); return { getBytes:()=>b, getDataAsString:()=>b.toString('utf8') }; },
      computeDigest:(alg, txt)=>crypto.createHash('sha256').update(String(txt),'utf8').digest(),
      DigestAlgorithm:{ SHA_256:'sha256' },
      getUuid:()=>'uuid-'+(++ctx._uuid), formatDate:()=>HOY, Charset:{UTF_8:'utf8'} },
    Logger:{ log(){} }, Session:{ getScriptTimeZone:()=>'America/Bogota' }, _uuid:0, _hojas:hojas };
  ctx.globalThis=ctx; vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename:'Codigo.gs+CodigoParte.gs' });
  vm.runInContext('globalThis.MAQ_HEADERS=MAQ_HEADERS; globalThis.BANDEJA_HEADERS=BANDEJA_HEADERS;', ctx);
  return ctx;
}
const get =(ctx,p)=>ctx.doGet({ parameter:p });
const post=(ctx,b)=>ctx.doPost({ postData:{ contents:JSON.stringify(b) } });
const tok =(ctx,u,r)=>ctx.emitirToken_(u,r,[]);
const LOG=(ctx)=>ctx._hojas.LOG ? ctx._hojas.LOG._f.slice(1) : [];
const ultimaLog=(ctx)=>{ const l=LOG(ctx); return l[l.length-1]||[]; };
const colM=(ctx,fila,k)=>fila[ctx.MAQ_HEADERS.indexOf(k)];
const maqFilas=(ctx)=>ctx._hojas.MAQUINARIA ? ctx._hojas.MAQUINARIA._f.slice(1) : [];

function linea(equipos, extra){
  return Object.assign({ id_registro:'cant-1', grupo:'TIERRAS', capitulo:'EXPLANACIONES', actividad:'Núcleo de terraplén',
    descripcion:'Terraplenes (solo conformación)', sub_actividad:'', centro_costo:'3701.02.07', unidad:'m3', data:true, uf:'UF1', proyecto:'3701',
    elemento:'tm2 pk 14+600 - 14+900', pk_inicial:'14+600', pk_final:'14+900', abs_inicial:14600, abs_final:14900, liberacion:'CAMPO',
    largo:300, observacion:'nota', equipos:equipos }, extra||{});
}
function reporte(cantidades, extra){ return Object.assign({ id_reporte:'rep-1', fecha:HOY, rol:'capataz', capataz:'angel', cantidades:cantidades, observacion_general:'' }, extra||{}); }
const VACIAS=['operador','horas_operadas','horas_mantenimiento','estado','app_horas_programadas','app_horas_muertas','motivo'];
function vacias(ctx, f){ return VACIAS.filter(k=>colM(ctx,f,k)!=='' && colM(ctx,f,k)!=null); }

console.log('\n1 · ?action=maquinas trae `equipos` = PARTE_EQUIPOS activos (código·tipo·placa), por tipo y código');
{
  const ctx=cargar(); const t=tok(ctx,'angel','capataz');
  const r=get(ctx,{ action:'maquinas', fecha:HOY, token:t });
  ok('responde ok y sigue trayendo `maquinas` (flota de MAQUINAS/respaldo)', r.ok===true && Array.isArray(r.maquinas) && r.maquinas.length>0, JSON.stringify(r).slice(0,120));
  ok('`equipos` con los 5 activos (BL005 con activo vacío incluido) y sin BL002', Array.isArray(r.equipos) && r.equipos.length===5 && !r.equipos.some(q=>q.codigo==='BL002'), JSON.stringify(r.equipos));
  ok('orden por tipo y luego código', JSON.stringify(r.equipos.map(q=>q.codigo))==='["BL005","EXC015","RT-02","VIBROCOMPACTADOR"===""?"":"CR026","VOL048"]'.replace('"VIBROCOMPACTADOR"===""?"":',''), JSON.stringify(r.equipos.map(q=>q.codigo)));
  ok('cada equipo trae código, tipo y placa', r.equipos.every(q=>'codigo' in q && 'tipo' in q && 'placa' in q) && r.equipos.find(q=>q.codigo==='VOL048').placa==='NNM180');
  const sin=cargar({ sinParteEquipos:true });
  const r2=get(sin,{ action:'maquinas', fecha:HOY, token:tok(sin,'angel','capataz') });
  ok('sin hoja PARTE_EQUIPOS: `equipos` vacío y `maquinas` intacto (el cliente cae a la flota)', r2.ok===true && r2.equipos.length===0 && r2.maquinas.length>0);
}

console.log('\n2 · Reporte con 1 actividad y 2 equipos (objetos {id_registro,id_maquina,tipo_equipo}) → 2 filas sin horas');
{
  const ctx=cargar(); const t=tok(ctx,'angel','capataz');
  const r=post(ctx, reporte([ linea([ { id_registro:'m-1', id_maquina:'EXC015', tipo_equipo:'EXCAVADORAS' }, { id_registro:'m-2', id_maquina:'CR026', tipo_equipo:'VIBROCOMPACTADOR' } ]) ], { token:t }));
  ok('ok: 1 cantidad, 2 máquinas', r.ok===true && r.cantidades===1 && r.maquinas===2, JSON.stringify(r));
  const f=maqFilas(ctx);
  ok('2 filas en MAQUINARIA', f.length===2, String(f.length));
  ok('E id_maquina = EXC015 y CR026', colM(ctx,f[0],'id_maquina')==='EXC015' && colM(ctx,f[1],'id_maquina')==='CR026');
  ok('T producción: 300 m3 en la excavadora, vacía en el vibro (regla por tipo)', colM(ctx,f[0],'produccion')===300 && colM(ctx,f[0],'unidad_prod')==='m3' && colM(ctx,f[1],'produccion')==='', JSON.stringify([colM(ctx,f[0],'produccion'),colM(ctx,f[1],'produccion')]));
  ok('G operador · L horas · O h_mant · R ESTADO · app_horas_programadas · app_horas_muertas · motivo VACÍOS', vacias(ctx,f[0]).length===0 && vacias(ctx,f[1]).length===0, JSON.stringify(vacias(ctx,f[0]).concat(vacias(ctx,f[1]))));
  ok('B fecha · D proyecto · H/I derivadas · AA observación · reporta · id_cantidad · app_tipo_equipo', colM(ctx,f[0],'fecha')===HOY && colM(ctx,f[0],'proyecto')==='3701' && colM(ctx,f[0],'actividad')==='TERRAPLEN' && colM(ctx,f[0],'observacion')==='nota' && colM(ctx,f[0],'reporta')==='angel' && colM(ctx,f[0],'id_cantidad')==='cant-1' && colM(ctx,f[0],'app_tipo_equipo')==='EXCAVADORAS', JSON.stringify(f[0]));
  ok('app_id_registro = ids del cliente (D82)', colM(ctx,f[0],'app_id_registro')==='m-1' && colM(ctx,f[1],'app_id_registro')==='m-2');
  ok('la fila de BANDEJA se escribió igual que siempre', ctx._hojas.BANDEJA._f.length===2 && ctx._hojas.BANDEJA._f[1][0]==='cant-1');
  ok('LOG: ok', ultimaLog(ctx)[4]==='ok', JSON.stringify(ultimaLog(ctx)));
  const r2=post(ctx, reporte([ linea([ { id_registro:'m-1', id_maquina:'EXC015', tipo_equipo:'EXCAVADORAS' }, { id_registro:'m-2', id_maquina:'CR026', tipo_equipo:'VIBROCOMPACTADOR' } ]) ], { token:t }));
  ok('reenvío desde la cola: mismo conteo, 0 guardadas, 3 duplicadas, sin filas nuevas', r2.ok && r2.maquinas===2 && r2.guardadas===0 && r2.duplicadas===3 && maqFilas(ctx).length===2, JSON.stringify(r2));
}

console.log('\n3 · `equipos` como lista de códigos → aceptado; tipo de PARTE_EQUIPOS; dedupe determinístico');
{
  const ctx=cargar(); const t=tok(ctx,'angel','capataz');
  const r=post(ctx, reporte([ linea(['VOL048','cr026','RT-02']) ], { token:t }));
  ok('ok con 3 máquinas', r.ok===true && r.maquinas===3, JSON.stringify(r));
  const f=maqFilas(ctx);
  ok('el código se escribe tal cual llegó', colM(ctx,f[0],'id_maquina')==='VOL048' && colM(ctx,f[1],'id_maquina')==='cr026');
  ok('tipo completado desde PARTE_EQUIPOS (normalizando el código)', colM(ctx,f[0],'app_tipo_equipo')==='VOLQUETAS DOBLETROQUE' && colM(ctx,f[1],'app_tipo_equipo')==='VIBROCOMPACTADOR' && colM(ctx,f[2],'app_tipo_equipo')==='RETROCARGADOR', JSON.stringify(f.map(x=>colM(ctx,x,'app_tipo_equipo'))));
  ok('producción: volqueta 300, vibro y retrocargador vacíos', colM(ctx,f[0],'produccion')===300 && colM(ctx,f[1],'produccion')==='' && colM(ctx,f[2],'produccion')==='');
  ok('id determinístico por línea (cant-1-m0…) para deduplicar', colM(ctx,f[0],'app_id_registro')==='cant-1-m0' && colM(ctx,f[2],'app_id_registro')==='cant-1-m2');
  ok('columnas de horas vacías', f.every(x=>vacias(ctx,x).length===0));
  const r2=post(ctx, reporte([ linea(['VOL048','cr026','RT-02']) ], { token:t }));
  ok('reenvío no duplica', r2.duplicadas===4 && maqFilas(ctx).length===3, JSON.stringify(r2));
  const r3=post(ctx, reporte([ linea(['ZZ99'], { id_registro:'cant-2' }) ], { token:t }));
  ok('código fuera del catálogo se guarda igual (D138/D82: la recepción no valida contra el catálogo), tipo vacío', r3.ok && maqFilas(ctx).length===4 && colM(ctx,maqFilas(ctx)[3],'id_maquina')==='ZZ99' && colM(ctx,maqFilas(ctx)[3],'app_tipo_equipo')==='');
  const r4=post(ctx, reporte([ linea(['', null, 'EXC015'], { id_registro:'cant-3' }) ], { token:t }));
  ok('códigos vacíos/null se saltan sin error', r4.ok && r4.maquinas===1);
}

console.log('\n4 · Payload VIEJO de la cola offline (con horas/operador/motivo) → aceptado y descartado en silencio');
{
  const ctx=cargar(); const t=tok(ctx,'angel','capataz');
  const viejo=linea([ { id_registro:'v-1', id_maquina:'EXC015', tipo_equipo:'EXCAVADORA', operador:'Pedro', horas_operadas:5.5, horas_programadas:6.4, horas_muertas:0.9, motivo:'Lluvia / clima', produccion:300 } ]);
  const r=post(ctx, reporte([ viejo ], { token:t }));
  ok('aceptado (ok, 1 máquina)', r.ok===true && r.maquinas===1, JSON.stringify(r));
  const f=maqFilas(ctx);
  ok('fila escrita con código y producción', f.length===1 && colM(ctx,f[0],'id_maquina')==='EXC015' && colM(ctx,f[0],'produccion')===300);
  ok('horas/operador/motivo/programadas/muertas/ESTADO NO se escribieron', vacias(ctx,f[0]).length===0, JSON.stringify(vacias(ctx,f[0])));
  ok('el tipo que mandó el cliente se conserva (informativo)', colM(ctx,f[0],'app_tipo_equipo')==='EXCAVADORA');
  ok('LOG en ok, sin error', ultimaLog(ctx)[4]==='ok', JSON.stringify(ultimaLog(ctx)));
  const r2=post(ctx, reporte([ viejo ], { token:t }));
  ok('reenvío del mismo payload viejo: deduplicado', r2.duplicadas===2 && maqFilas(ctx).length===1);
  // payload MUY viejo: sin ids (frontend anterior a D82) — se acepta y genera ids en el servidor
  const sinIds={ fecha:HOY, rol:'capataz', capataz:'angel', cantidades:[ { actividad:'Núcleo de terraplén', descripcion:'Terraplenes (solo conformación)', centro_costo:'3701.02.07', unidad:'m3', uf:'UF1', proyecto:'3701', pk_inicial:'14+600', largo:50,
    equipos:[ { id_maquina:'BL005', tipo_equipo:'BULLDOZER', operador:'Juan', horas_operadas:8 } ] } ], token:t };
  const r3=post(ctx, sinIds);
  ok('payload sin ids (pre-D82) sigue entrando; horas descartadas', r3.ok && r3.maquinas===1 && maqFilas(ctx).length===2 && vacias(ctx,maqFilas(ctx)[1]).length===0, JSON.stringify(r3));
  // desmonte/descapote (D58): dos filas por máquina, mismo código, ids distintos, sin horas
  const desm=[ linea([ { id_registro:'d-1', id_maquina:'EXC015', tipo_equipo:'EXCAVADORAS' } ], { id_registro:'cant-d', actividad:'Desmonte', descripcion:'Desmonte y limpieza', centro_costo:'3701.02.01', unidad:'Ha', largo:0.5, prod_maquina:5000, unidad_maquina:'m²' }),
               linea([ { id_registro:'d-2', id_maquina:'EXC015', tipo_equipo:'EXCAVADORAS' } ], { id_registro:'cant-e', actividad:'Excavación no aprovechable', descripcion:'Excavaciones en material común NO APROVECHABLE', centro_costo:'3701.02.05', unidad:'m3', largo:1000, derivada:'descapote_desmonte' }) ];
  const r4=post(ctx, reporte(desm, { id_reporte:'rep-d', token:t }));
  const f4=maqFilas(ctx).slice(2);
  ok('desmonte: 2 filas de la misma máquina, producción 5000 m² y 1000 m3, sin horas', r4.ok && f4.length===2 && colM(ctx,f4[0],'produccion')===5000 && colM(ctx,f4[0],'unidad_prod')==='m²' && colM(ctx,f4[1],'produccion')===1000 && f4.every(x=>vacias(ctx,x).length===0), JSON.stringify(f4.map(x=>[colM(ctx,x,'produccion'),colM(ctx,x,'unidad_prod')])));
}

console.log('\n5 · Lectores con filas nuevas (vacías) y viejas (con horas) mezcladas: bandeja · estado · maquinaria_produccion');
{
  const ctx=cargar(); const t=tok(ctx,'angel','capataz'), te=tok(ctx,'javier','encargado');
  // fila NUEVA por el endpoint
  post(ctx, reporte([ linea([ { id_registro:'n-1', id_maquina:'EXC015', tipo_equipo:'EXCAVADORAS' } ]) ], { token:t }));
  // fila VIEJA escrita a mano con el layout D52 (con horas, operador, estado y motivo)
  const H=ctx.MAQ_HEADERS, vieja=new Array(H.length).fill('');
  const set=(k,v)=>{ vieja[H.indexOf(k)]=v; };
  set('fecha',HOY); set('proyecto','3701'); set('id_maquina','MO04'); set('operador','Luis'); set('actividad','TERRAPLEN'); set('sub_actividad','NUCLEO DE TERRAPLEN');
  set('horas_operadas',6); set('estado','OPERANDO'); set('produccion',250); set('app_id_registro','old-1'); set('id_cantidad','cant-old'); set('reporta','robinson');
  set('app_tipo_equipo','MOTONIVELADORA'); set('app_horas_programadas',6.4); set('app_horas_muertas',0.4); set('motivo','Lluvia / clima'); set('unidad_prod','m3'); set('cap_actividad','Núcleo de terraplén'); set('a_captura','SI');
  ctx._hojas.MAQUINARIA._f.push(vieja);
  ctx.invalidarHoja_ && ctx.invalidarHoja_('MAQUINARIA');
  let b, e, mp, err='';
  try{ b=get(ctx,{ action:'bandeja', fecha:HOY, area:'tierras', token:te }); e=get(ctx,{ action:'estado', fecha:HOY, token:te }); mp=get(ctx,{ action:'maquinaria_produccion', fecha:HOY, token:tok(ctx,'admin','admin') }); }
  catch(x){ err=String(x&&x.stack||x); }
  ok('ninguno lanza', !err, err.slice(0,200));
  ok('bandeja: 2 máquinas; la nueva con horas_operadas vacía y la vieja con 6', b && b.maquinas && b.maquinas.length===2 && b.maquinas.find(m=>m.id_maquina==='EXC015').horas_operadas==='' && b.maquinas.find(m=>m.id_maquina==='MO04').horas_operadas===6, JSON.stringify(b&&b.maquinas&&b.maquinas.map(m=>[m.id_maquina,m.horas_operadas])));
  ok('estado: reportadas EXC015 (angel) y MO04 (robinson)', e && e.reportadas.length===2 && e.reportadas.some(x=>x.id_maquina==='EXC015'&&x.capataz==='angel'), JSON.stringify(e));
  ok('maquinaria_produccion: ok, la excavadora en el frente de terraplén con horas "" y la moto con 6', mp && mp.ok===true && (function(){ const filas=[].concat.apply([], mp.frentes.map(f=>f.filas)); const ex=filas.find(x=>x.id_maquina==='EXC015'), mo=filas.find(x=>x.id_maquina==='MO04'); return ex && ex.horas==='' && mo && mo.horas===6; })(), JSON.stringify(mp&&mp.frentes).slice(0,300));
}

console.log('\n6 · Validación (D166) sigue viva sobre `equipos`');
{
  const ctx=cargar(); const t=tok(ctx,'angel','capataz');
  const a=post(ctx, reporte([ linea([ { id_maquina:'EXC015', horas_operadas:999 } ]) ], { token:t }));
  ok('objeto con horas fuera de rango → error payload con campo', a.ok===false && a.error==='payload' && /equipos\[0\]\.horas_operadas/.test(a.campo), JSON.stringify(a));
  const b=post(ctx, reporte([ linea([ 'X'.repeat(80) ]) ], { token:t }));
  ok('código de más de 50 caracteres → error payload', b.ok===false && b.error==='payload' && /equipos\[0\]/.test(b.campo), JSON.stringify(b));
  const c=post(ctx, reporte([ linea(42) ], { token:t }));
  ok('`equipos` que no es lista → error payload', c.ok===false && c.error==='payload', JSON.stringify(c));
  ok('no se escribió nada', maqFilas(ctx).length===0 && !(ctx._hojas.BANDEJA && ctx._hojas.BANDEJA._f.length>1));
}

console.log('\n7 · esTipoSinProduccion con el vocabulario de PARTE_EQUIPOS');
{
  const ctx=cargar();
  const si=['VIBROCOMPACTADOR','COMPACTADORES','VIBROCOMPACTADOR RENTAL 900','MINICARGADOR','MINIBULDOZER','RETROEXCAVADORA','RETROCARGADOR','retrocargador'];
  const no=['EXCAVADORAS','EXCAVADORA SOBRE LLANTAS','BULLDOZER','MOTONIVELADORAS','VOLQUETAS DOBLETROQUE','FINISHER','EXTENDEDORAS','',undefined,null];
  ok('sin producción: '+si.join(', '), si.every(x=>ctx.esTipoSinProduccion(x)===true), JSON.stringify(si.map(x=>ctx.esTipoSinProduccion(x))));
  ok('con producción: '+no.map(String).join(', '), no.every(x=>ctx.esTipoSinProduccion(x)===false), JSON.stringify(no.map(x=>ctx.esTipoSinProduccion(x))));
}

console.log('\n8 · Frontend: formulario, flota.js, encargado, estado, menú, sw.js');
{
  const cap=leer('reporte-capataz.html');
  ok('reporte-capataz.html sin horas/operador/motivo (e-hrs, e-op, e-mot-sel, MOTIVOS, gatherMachineGroups, progHoras)', !/e-hrs|e-op\b|e-mot-sel|const MOTIVOS|gatherMachineGroups|progHoras|horas_operadas/.test(cap));
  ok('…con el selector de chips (togglePicker, renderPicker, toggleEquipo, equiposDe) y el catálogo de flota.js', /togglePicker|renderPicker|toggleEquipo|equiposDe/.test(cap) && /TM2Flota\.equiposCapataz/.test(cap));
  ok('…y el payload de cada equipo es {id_registro, id_maquina, tipo_equipo}', /id_registro:TM2Offline\.uuid\(\), id_maquina:cod, tipo_equipo:tipoDe\(cod\)/.test(cap));
  (cap.match(/<script>([\s\S]*?)<\/script>/g)||[]).forEach((b,i)=>{ let e=''; try{ new Function(b.replace(/<\/?script>/g,'')); }catch(x){ e=x.message; } ok('script '+i+' del formulario compila', !e, e); });
  // flota.js en node
  const w={}; const ctxF={ window:w, fetch:()=>Promise.reject(new Error('sin red')), TM2Offline:undefined };
  vm.createContext(ctxF); vm.runInContext(leer('flota.js'), ctxF);
  const F=w.TM2Flota;
  ok('flota.js expone equiposCapataz', typeof F.equiposCapataz==='function');
  const e1=F.equiposCapataz({ equipos:[{codigo:'VOL048',tipo:'VOLQUETAS DOBLETROQUE',placa:'NNM180'},{codigo:'BL005',tipo:'BULLDOZER',placa:''}], maquinas:[{id_maquina:'ZZ',tipo:'X'}] });
  ok('con `equipos` los usa (ordenados por tipo y código) e ignora `maquinas`', JSON.stringify(e1.map(q=>q.codigo))==='["BL005","VOL048"]', JSON.stringify(e1));
  const e2=F.equiposCapataz({ equipos:[], maquinas:[{id_maquina:'MO04',tipo:'MOTONIVELADORA'},{id_maquina:'BL005',tipo:'BULLDOZER'}] });
  ok('sin `equipos` (backend viejo / caché / respaldo) cae a `maquinas`', JSON.stringify(e2.map(q=>q.codigo+'|'+q.tipo))==='["BL005|BULLDOZER","MO04|MOTONIVELADORA"]', JSON.stringify(e2));
  return F.cargar('http://x', HOY, { ids:['BL005'], tipos:{BL005:'BULLDOZER'}, prog:{} }).then(fl=>{
    ok('cargar() sin red → respaldo con `equipos:[]` (y equiposCapataz lo deriva)', fl.fuente==='respaldo' && Array.isArray(fl.equipos) && F.equiposCapataz(fl)[0].codigo==='BL005');
    const enc=leer('encargado.html');
    ok('encargado.html: bandeja y WhatsApp de equipos sin horas ni operador', !/maqResumen|horas_operadas|s\/op/.test(enc) && /D170/.test(enc));
    ok('estado.html: aviso de obsoleto que remite a revision-maquinaria.html', /obsoleta \(D170\)/.test(leer('estado.html')) && /revision-maquinaria\.html/.test(leer('estado.html')));
    ok('menu.html: «Estado maquinaria (capataz, obsoleto)»', /Estado maquinaria \(capataz, obsoleto\)/.test(leer('menu.html')));
    ok('sw.js: CACHE_V subido (flota.js cambió y el formulario nuevo depende de él)', /CACHE_V = 'tm2-v11'/.test(leer('sw.js')));
    console.log('\n'+(fallos?('✗ '+fallos+' de '+casos+' casos fallan'):('✓ '+casos+' casos pasan')));
    process.exit(fallos?1:0);
  });
}
