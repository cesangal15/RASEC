#!/usr/bin/env node
/**
 * Verificación V3-06(b) / D177 — Recorte de maquinaria en el reporte de la CHEQUEADORA: solo el CÓDIGO.
 *
 * Reproduce en banco, con el código REAL de `Codigo.gs` + `CodigoParte.gs` (mismo arnés que D166/D171:
 * HMAC de verdad, hojas falsas, LOG que anota), lo que pide el prompt de cierre de V3-06(b):
 *   1 · Reporte de chequeadora con 2 excavadoras y 700 m³ excavados → 2 filas en MAQUINARIA, cada una con
 *       su código en E y T = 350 (total ÷ nº excavadoras, D54 confirmado); G operador · L horas · O h_mant ·
 *       R ESTADO · app_horas_programadas · app_horas_muertas · motivo VACÍOS (V3-06(b)/D177).
 *   2 · `maquinaria` como lista de CÓDIGOS ('EXC015') → aceptado; el tipo sale de PARTE_EQUIPOS; el reparto
 *       excluye vibros/retros (esTipoSinProduccion); reenvío deduplicado por id_registro (D82).
 *   3 · Payload VIEJO de la cola offline (operador/horas/programadas/muertas/motivo, o máquinas como objetos
 *       completos) → aceptado, fila escrita SIN esos campos, LOG en `ok`, reenvío deduplicado.
 *   4 · Reporte sin excavadoras → se envía igual, sin filas de MAQUINARIA.
 *   5 · Conflicto D51: chequeadora y capataz reportan la misma máquina → dos filas en MAQUINARIA con distinto
 *       `reporta` (la materia prima del panel del encargado); encargado.js agrupa por id_maquina y marca
 *       conflicto con ≥2 `reporta`, sin leer horas.
 *   6 · `maquinaria_produccion` (panel de producción) abre con filas nuevas (vacías) y viejas (con horas)
 *       mezcladas: no lanza, la excavadora de la chequeadora sale con horas "" y su producción.
 *   7 · Validación (D166): la maquinaria admite códigos y objetos sin horas; un objeto con horas fuera de
 *       rango sigue rechazándose con error `payload`; el viejo con horas válidas pasa.
 *   8 · Frontend: reporte-chequeadora.js sin operador/horas/motivo (chips `data-on-*`, CSP sin inline D170);
 *       el payload de cada excavadora es {id_registro,id_maquina,tipo_equipo}; encargado tolerante; sw.js con
 *       los archivos de la chequeadora en el precache (sin subir CACHE_V: solo cambia su contenido).
 *   9 · MUTACIÓN deliberada (prueba de que no es ciega): (a) quitar el ÷nº pone 700 en cada fila; (b) reponer
 *       el operador recortado lo vuelve a escribir. Ambas las DETECTAN las aserciones de arriba.
 *
 *   node backend/pruebas/verificar_v306b_recorte_chequeadora.js
 */
const fs=require('fs'), path=require('path'), vm=require('vm'), crypto=require('crypto');
const REPO=path.resolve(__dirname,'..','..');
const leer=(p)=>fs.readFileSync(path.join(REPO,p),'utf8');
const SRC_BASE=leer('backend/Codigo.gs')+'\n'+leer('backend/CodigoParte.gs');
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
  const SRC = opts.mutar ? opts.mutar(SRC_BASE) : SRC_BASE;
  const hojas={};
  hojas.USUARIOS=hojaFalsa([['usuario','clave','rol','areas','redirige','estado'],
    ['admin','1234','admin','','menu.html','activo'],
    ['angel','clave','capataz','','seleccion-reporte.html','activo'],
    ['pedro','clave','chequeadora','','reporte-chequeadora.html','activo'],
    ['javier','clave','encargado','','encargado.html','activo']]);
  hojas.PARTE_EQUIPOS=hojaFalsa([
    ['codigo','tipo','placa','proveedor','medidor','ultima_fecha','ultimo_final','activo'],
    ['EXC015','EXCAVADORAS','MC706830','ORTIZ','HOROMETRO','2026-09-09',2711.6,'SI'],
    ['EXC030','EXCAVADORA','','EQUINORTE','HOROMETRO','2026-09-09',126,'SI'],
    ['EXC026','EXCAVADORA SOBRE LLANTAS','','ORTIZ','HOROMETRO','2026-09-05',11363,'SI'],
    ['CR026','VIBROCOMPACTADOR','POCR026','ORTIZ','HOROMETRO','2026-09-09',1698,'SI'],
    ['RT-02','RETROEXCAVADORA','','MAQUISABANA','HOROMETRO','2026-09-09',7049.6,'SI'],
    ['BL005','BULLDOZER','MC705987','ORTIZ','HOROMETRO','2026-09-09',2546,'SI']]);
  hojas.PARTE_OPERADORES=hojaFalsa([['operador','partes_ult_4_meses'],['Nelson Rangel',323]]);
  hojas.PARTE_CC=hojaFalsa([['centro_coste','proyecto','descripcion_cc','usos_ult_4_meses'],['3701.02.05','3701','Excavación',457]]);
  hojas.PARTE_ACTIVIDADES=hojaFalsa([['tipo_equipo','descripcion_trabajo','veces']]);
  hojas.CUBICAJE=hojaFalsa([['placa','cubicaje']]);   // vacío = todo cae al factor (14, D54)
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
const VACIAS=['operador','horas_operadas','horas_mantenimiento','estado','app_horas_programadas','app_horas_muertas','motivo'];
function vacias(ctx, f){ return VACIAS.filter(k=>colM(ctx,f,k)!=='' && colM(ctx,f,k)!=null); }

// Excavación acumulada al origen (una fila) + terraplén por línea, como las arma el frontend de la chequeadora.
function cantExc(extra){
  return Object.assign({ id_registro:'cant-exc', _acumOrigen:true, origen:'Masivo 2 (PK 19)', grupo:'TIERRAS',
    capitulo:'EXPLANACIONES', actividad:'Excavación aprovechable (masivo)', descripcion:'Excavaciones en material común APROVECHABLE',
    centro_costo:'3701.02.05', unidad:'m3', data:true, uf:'UF1', proyecto:'3701', elemento:'tm2 pk 19+800',
    pk_inicial:'19+800', pk_final:'', abs_inicial:19800, abs_final:null, liberacion:'CAMPO', largo:0, observacion:'Masivo 2 · 50 viajes' }, extra||{});
}
function cantTerr(){ return { id_registro:'cant-terr', _linea:0, grupo:'TIERRAS', capitulo:'EXPLANACIONES',
  actividad:'Terraplén (conformación)', descripcion:'Terraplenes (solo conformación)', centro_costo:'3701.02.07',
  unidad:'m3', data:true, uf:'UF1', proyecto:'3701', elemento:'tm2 pk 16+200', pk_inicial:'16+200', pk_final:'',
  abs_inicial:16200, abs_final:null, liberacion:'CAMPO', largo:0, observacion:'Masivo 2 · 50 viajes' }; }
// una placa con 50 viajes × factor 14 = 700 m³ (D53: CUBICAJE vacío → factor 14, D54)
function volq(){ return [{ id_registro:'vol-0', origen:'Masivo 2 (PK 19)', destino:'16+200', tipo_destino:'Terraplén', uf:'UF1', placas:[{placa:'USD360', viajes:50}], _linea:0 }]; }
function reporteCheq(maquinaria, extra){
  return Object.assign({ fecha:HOY, rol:'chequeadora', capataz:'pedro', m3viaje:14,
    cantidades:[ cantExc(), cantTerr() ], volquetas:volq(), maquinaria:maquinaria }, extra||{});
}

console.log('\n1 · Reporte con 2 excavadoras y 700 m³ → 2 filas, T=350 c/u, columnas de horas VACÍAS');
{
  const ctx=cargar(); const t=tok(ctx,'pedro','chequeadora');
  const r=post(ctx, reporteCheq([ { id_registro:'m-1', id_maquina:'EXC015', tipo_equipo:'EXCAVADORAS' },
                                   { id_registro:'m-2', id_maquina:'EXC030', tipo_equipo:'EXCAVADORA' } ], { token:t }));
  ok('ok: filas de excavación/terraplén + 2 máquinas', r.ok===true && r.maquinas===2, JSON.stringify(r));
  const f=maqFilas(ctx);
  ok('2 filas en MAQUINARIA', f.length===2, String(f.length));
  ok('E id_maquina = EXC015 y EXC030', colM(ctx,f[0],'id_maquina')==='EXC015' && colM(ctx,f[1],'id_maquina')==='EXC030');
  ok('T producción = 350 en cada una (700 ÷ 2), unidad m3', colM(ctx,f[0],'produccion')===350 && colM(ctx,f[1],'produccion')===350 && colM(ctx,f[0],'unidad_prod')==='m3', JSON.stringify([colM(ctx,f[0],'produccion'),colM(ctx,f[1],'produccion')]));
  ok('G operador · L horas · O h_mant · R ESTADO · app_horas_programadas · app_horas_muertas · motivo VACÍOS', vacias(ctx,f[0]).length===0 && vacias(ctx,f[1]).length===0, JSON.stringify(vacias(ctx,f[0]).concat(vacias(ctx,f[1]))));
  ok('B fecha · D proyecto · H/I derivadas · reporta · app_tipo_equipo · cap_actividad · a_captura', colM(ctx,f[0],'fecha')===HOY && colM(ctx,f[0],'proyecto')==='3701' && colM(ctx,f[0],'actividad')==='EXCAVACION COMUN' && colM(ctx,f[0],'sub_actividad')==='EXCAVACION APROVECHABLE' && colM(ctx,f[0],'reporta')==='pedro' && colM(ctx,f[0],'app_tipo_equipo')==='EXCAVADORAS' && colM(ctx,f[0],'cap_actividad')==='Excavación aprovechable (masivo)' && colM(ctx,f[0],'a_captura')==='SI', JSON.stringify(f[0]));
  ok('AA observación vacía (la chequeadora no captura nota por máquina)', colM(ctx,f[0],'observacion')==='');
  ok('app_id_registro = ids del cliente (D82)', colM(ctx,f[0],'app_id_registro')==='m-1' && colM(ctx,f[1],'app_id_registro')==='m-2');
  ok('BANDEJA: excavación (700) + terraplén, sin duplicar', ctx._hojas.BANDEJA._f.length===3);
  ok('LOG: ok', ultimaLog(ctx)[4]==='ok', JSON.stringify(ultimaLog(ctx)));
  const r2=post(ctx, reporteCheq([ { id_registro:'m-1', id_maquina:'EXC015', tipo_equipo:'EXCAVADORAS' },
                                   { id_registro:'m-2', id_maquina:'EXC030', tipo_equipo:'EXCAVADORA' } ], { token:t }));
  ok('reenvío desde la cola: mismo conteo, 0 guardadas, sin filas nuevas', r2.ok && r2.maquinas===2 && r2.guardadas===0 && maqFilas(ctx).length===2, JSON.stringify(r2));
}

console.log('\n2 · `maquinaria` como lista de CÓDIGOS → aceptado; tipo de PARTE_EQUIPOS; vibro/retro sin reparto');
{
  const ctx=cargar(); const t=tok(ctx,'pedro','chequeadora');
  const r=post(ctx, reporteCheq(['EXC015','exc030'], { token:t }));
  ok('ok con 2 máquinas', r.ok===true && r.maquinas===2, JSON.stringify(r));
  const f=maqFilas(ctx);
  ok('el código se escribe tal cual llegó', colM(ctx,f[0],'id_maquina')==='EXC015' && colM(ctx,f[1],'id_maquina')==='exc030');
  ok('tipo completado desde PARTE_EQUIPOS (normalizando el código)', colM(ctx,f[0],'app_tipo_equipo')==='EXCAVADORAS' && colM(ctx,f[1],'app_tipo_equipo')==='EXCAVADORA', JSON.stringify(f.map(x=>colM(ctx,x,'app_tipo_equipo'))));
  ok('reparto 700 ÷ 2 = 350 a cada excavadora', colM(ctx,f[0],'produccion')===350 && colM(ctx,f[1],'produccion')===350);
  ok('sin horas ni operador', f.every(x=>vacias(ctx,x).length===0));
  // vibro/retro entre la maquinaria (robustez): no cuentan en el reparto ni llevan producción (D44)
  const ctx2=cargar(); const t2=tok(ctx2,'pedro','chequeadora');
  post(ctx2, reporteCheq(['EXC015','CR026','RT-02'], { token:t2 }));
  const g=maqFilas(ctx2);
  ok('excavadora sola en el reparto: 700 ÷ 1 = 700; vibro y retro sin producción', colM(ctx2,g[0],'produccion')===700 && colM(ctx2,g[1],'produccion')==='' && colM(ctx2,g[2],'produccion')==='', JSON.stringify(g.map(x=>[colM(ctx2,x,'id_maquina'),colM(ctx2,x,'produccion')])));
  // código fuera del catálogo se guarda igual (D138: la recepción no valida contra el catálogo)
  const ctx3=cargar(); post(ctx3, reporteCheq(['ZZ99'], { token:tok(ctx3,'pedro','chequeadora') }));
  const h=maqFilas(ctx3);
  ok('código fuera del catálogo se guarda; tipo vacío; producción 700 (única máquina, no es vibro)', h.length===1 && colM(ctx3,h[0],'id_maquina')==='ZZ99' && colM(ctx3,h[0],'app_tipo_equipo')==='' && colM(ctx3,h[0],'produccion')===700);
  // códigos vacíos/null se saltan sin error
  const ctx4=cargar(); const r4=post(ctx4, reporteCheq(['', null, 'EXC015'], { token:tok(ctx4,'pedro','chequeadora') }));
  ok('códigos vacíos/null se saltan sin error', r4.ok && r4.maquinas===1);
}

console.log('\n3 · Payload VIEJO de la cola offline (objetos con operador/horas/motivo) → aceptado y recortado en silencio');
{
  const ctx=cargar(); const t=tok(ctx,'pedro','chequeadora');
  const viejo=[ { id_registro:'v-1', id_maquina:'EXC015', tipo_equipo:'EXCAVADORA', operador:'Pedro', horas_operadas:5.5, horas_programadas:6.4, horas_muertas:0.9, motivo:'Lluvia / clima' },
                { id_registro:'v-2', id_maquina:'EXC030', tipo_equipo:'EXCAVADORA', operador:'Luis', horas_operadas:6.4, horas_programadas:6.4, horas_muertas:0, motivo:'' } ];
  const r=post(ctx, reporteCheq(viejo, { token:t }));
  ok('aceptado (ok, 2 máquinas)', r.ok===true && r.maquinas===2, JSON.stringify(r));
  const f=maqFilas(ctx);
  ok('filas escritas con código y producción 350 c/u', f.length===2 && colM(ctx,f[0],'produccion')===350 && colM(ctx,f[1],'produccion')===350);
  ok('operador/horas/motivo/programadas/muertas/ESTADO NO se escribieron', vacias(ctx,f[0]).length===0 && vacias(ctx,f[1]).length===0, JSON.stringify(vacias(ctx,f[0]).concat(vacias(ctx,f[1]))));
  ok('el tipo que mandó el cliente se conserva (informativo)', colM(ctx,f[0],'app_tipo_equipo')==='EXCAVADORA');
  ok('LOG en ok, sin error', ultimaLog(ctx)[4]==='ok');
  const r2=post(ctx, reporteCheq(viejo, { token:t }));
  ok('reenvío del mismo payload viejo: deduplicado, sin filas nuevas', r2.ok && maqFilas(ctx).length===2 && r2.guardadas===0);
  // payload MUY viejo: sin ids (frontend anterior a D82) — se acepta y el servidor genera ids
  const sinIds={ fecha:HOY, rol:'chequeadora', capataz:'pedro', m3viaje:14, cantidades:[ cantExc(), cantTerr() ], volquetas:volq(),
    maquinaria:[ { id_maquina:'EXC015', tipo_equipo:'EXCAVADORA', operador:'Juan', horas_operadas:8 } ], token:t };
  const ctx3=cargar(); const r3=post(ctx3, sinIds);
  ok('payload sin ids (pre-D82) entra; horas descartadas; producción 700 (única)', r3.ok && r3.maquinas===1 && vacias(ctx3,maqFilas(ctx3)[0]).length===0 && colM(ctx3,maqFilas(ctx3)[0],'produccion')===700, JSON.stringify(r3));
}

console.log('\n4 · Reporte SIN excavadoras → se envía igual, sin filas de MAQUINARIA');
{
  const ctx=cargar(); const t=tok(ctx,'pedro','chequeadora');
  const r=post(ctx, reporteCheq([], { token:t }));
  ok('ok, 0 máquinas, sin filas en MAQUINARIA', r.ok===true && r.maquinas===0 && maqFilas(ctx).length===0, JSON.stringify(r));
  ok('las filas de excavación/terraplén sí se escribieron en BANDEJA', ctx._hojas.BANDEJA._f.length===3);
  const r2=post(ctx, Object.assign(reporteCheq([], { token:t })));   // sin la clave `maquinaria`
  delete r2; const r3=post(ctx, { fecha:HOY, rol:'chequeadora', capataz:'pedro', m3viaje:14, cantidades:[cantExc(),cantTerr()], volquetas:volq(), token:t });
  ok('reporte sin la clave `maquinaria` tampoco rompe', r3.ok===true && r3.maquinas===0, JSON.stringify(r3));
}

console.log('\n5 · Conflicto D51: chequeadora + capataz reportan la misma máquina');
{
  const ctx=cargar();
  // chequeadora reporta EXC015
  post(ctx, reporteCheq([ { id_registro:'c-1', id_maquina:'EXC015', tipo_equipo:'EXCAVADORAS' } ], { token:tok(ctx,'pedro','chequeadora') }));
  // capataz angel reporta la misma EXC015 en su actividad
  post(ctx, { id_reporte:'rep-cap', fecha:HOY, rol:'capataz', capataz:'angel', token:tok(ctx,'angel','capataz'),
    cantidades:[ { id_registro:'cap-1', grupo:'TIERRAS', capitulo:'EXPLANACIONES', actividad:'Núcleo de terraplén',
      descripcion:'Terraplenes (solo conformación)', centro_costo:'3701.02.07', unidad:'m3', data:true, uf:'UF1', proyecto:'3701',
      pk_inicial:'14+600', largo:200, equipos:[ { id_registro:'cap-m1', id_maquina:'EXC015', tipo_equipo:'EXCAVADORA' } ] } ] });
  const f=maqFilas(ctx).filter(x=>colM(ctx,x,'id_maquina')==='EXC015');
  const reps=[...new Set(f.map(x=>colM(ctx,x,'reporta')))];
  ok('EXC015 aparece con DOS reporta distintos (pedro y angel) — la materia prima del conflicto D51', f.length===2 && reps.length===2 && reps.indexOf('pedro')>=0 && reps.indexOf('angel')>=0, JSON.stringify(reps));
  // encargado.js: agrupa por id_maquina y marca conflicto cuando hay ≥2 `reporta`, sin leer horas
  const enc=leer('encargado.js');
  ok('encargado.js agrupa por id_maquina (maqGroups) y detecta conflicto con reps.length>=2', /function maqGroups\(\)/.test(enc) && /reps\.length>=2/.test(enc) && /renderMaqConflict/.test(enc));
  ok('encargado.js: el equipo se pinta sin horas ni operador (D171)', /D171: sin horas/.test(enc) || /sin horas ni operador/.test(enc));
}

console.log('\n6 · Panel de producción: maquinaria_produccion con filas nuevas (vacías) y viejas (con horas)');
{
  const ctx=cargar();
  post(ctx, reporteCheq([ { id_registro:'n-1', id_maquina:'EXC015', tipo_equipo:'EXCAVADORAS' } ], { token:tok(ctx,'pedro','chequeadora') }));
  // fila VIEJA a mano con el layout D52 (con horas/operador/estado/motivo), como las que quedaron en la hoja
  const H=ctx.MAQ_HEADERS, vieja=new Array(H.length).fill('');
  const set=(k,v)=>{ vieja[H.indexOf(k)]=v; };
  set('fecha',HOY); set('proyecto','3701'); set('id_maquina','EXC013'); set('operador','Luis'); set('actividad','EXCAVACION COMUN'); set('sub_actividad','EXCAVACION APROVECHABLE');
  set('horas_operadas',6); set('estado','OPERANDO'); set('produccion',250); set('app_id_registro','old-1'); set('reporta','otro_cheq');
  set('app_tipo_equipo','EXCAVADORA'); set('app_horas_programadas',6.4); set('app_horas_muertas',0.4); set('motivo','Lluvia / clima'); set('unidad_prod','m3'); set('cap_actividad','Excavación aprovechable (masivo)'); set('a_captura','SI');
  ctx._hojas.MAQUINARIA._f.push(vieja);
  ctx.invalidarHoja_ && ctx.invalidarHoja_('MAQUINARIA');
  let mp, err='';
  try{ mp=get(ctx,{ action:'maquinaria_produccion', fecha:HOY, token:tok(ctx,'admin','admin') }); }
  catch(x){ err=String(x&&x.stack||x); }
  ok('maquinaria_produccion no lanza', !err, err.slice(0,200));
  ok('ok: la excavadora nueva sale con horas "" y la vieja con 6', mp && mp.ok===true && (function(){ const filas=[].concat.apply([], mp.frentes.map(f=>f.filas)); const ex=filas.find(x=>x.id_maquina==='EXC015'), ex13=filas.find(x=>x.id_maquina==='EXC013'); return ex && ex.horas==='' && ex13 && ex13.horas===6; })(), JSON.stringify(mp&&mp.frentes).slice(0,300));
}

console.log('\n7 · Validación (D166): maquinaria admite códigos y objetos sin horas; objeto con horas fuera de rango se rechaza');
{
  const ctx=cargar(); const t=tok(ctx,'pedro','chequeadora');
  const a=post(ctx, reporteCheq([ { id_maquina:'EXC015', horas_operadas:999 } ], { token:t }));
  ok('objeto con horas fuera de rango → error payload con campo', a.ok===false && a.error==='payload' && /maquinaria\[0\]\.horas_operadas/.test(a.campo), JSON.stringify(a));
  const b=post(ctx, reporteCheq([ 'X'.repeat(80) ], { token:t }));
  ok('código de más de 50 caracteres → error payload', b.ok===false && b.error==='payload' && /maquinaria\[0\]/.test(b.campo), JSON.stringify(b));
  const c=post(ctx, reporteCheq(42, { token:t }));
  ok('`maquinaria` que no es lista → error payload', c.ok===false && c.error==='payload', JSON.stringify(c));
  ok('no se escribió nada en MAQUINARIA', maqFilas(ctx).length===0);
  const d=post(ctx, reporteCheq([ 'EXC015', { id_registro:'ok-1', id_maquina:'EXC030', tipo_equipo:'EXCAVADORA' } ], { token:t }));
  ok('mezcla de código + objeto sin horas → aceptada', d.ok===true && d.maquinas===2, JSON.stringify(d));
}

console.log('\n8 · Frontend: reporte-chequeadora.* recortada, sw.js y encargado');
{
  const js=leer('reporte-chequeadora.js'), html=leer('reporte-chequeadora.html'), css=leer('reporte-chequeadora.css');
  ok('reporte-chequeadora.js sin operador/horas/motivo (m-op, m-hrs, m-mot-sel, MOTIVOS, progHoras, horas_operadas)', !/m-op\b|m-hrs\b|m-mot-sel|const MOTIVOS|progHoras|horas_operadas|horas_muertas|derivarEstado/.test(js));
  ok('…con el selector de chips (togglePicker, renderPicker, toggleEquipo, quitarEquipo, equiposDe/getMaquinaria)', /function togglePicker/.test(js) && /function renderPicker/.test(js) && /function toggleEquipo/.test(js) && /function quitarEquipo/.test(js));
  ok('…y usa el catálogo de flota.js filtrado a EXCAVADORA (sin colar RETROEXCAVADORA)', /TM2Flota\.equiposCapataz/.test(js) && /indexOf\('EXCAVADORA'\)===0/.test(js));
  ok('…el payload de cada excavadora es {id_registro, id_maquina, tipo_equipo}', /id_registro:TM2Offline\.uuid\(\), id_maquina:cod, tipo_equipo:tipoDe\(cod\)/.test(js));
  ok('…sin manejadores ni estilos en línea (CSP D170): solo data-on-* / clases', !/ on(click|input|change)=| style="/.test(js) && /data-on-input="renderPicker\(/.test(js) && /data-on-click="toggleEquipo\(/.test(js));
  { let e=''; try{ new Function(js); }catch(x){ e=x.message; } ok('reporte-chequeadora.js compila', !e, e); }
  ok('reporte-chequeadora.html: sin <script> en línea, carga el .js, con el bloque de chips (#eqs/#eqpick) y togglePicker', !/<script>/.test(html) && /reporte-chequeadora\.js/.test(html) && /id="eqs"/.test(html) && /id="eqpick"/.test(html) && /data-on-click="togglePicker\(\)"/.test(html));
  ok('reporte-chequeadora.html: origenPill restaurado (bug previo: onOrigen leía un id inexistente)', /id="origenPill"/.test(html));
  ok('reporte-chequeadora.html: sin operador/horas/motivo en el marcado', !/Operador|Horas operadas|Motivo de horas/.test(html));
  ok('reporte-chequeadora.css: estilos de chips (eq-chip/eq-picker/eq-opt); sin los de fila (eq-top/eq-prog/eq-diff/eq-motivo)', /\.eq-chip\{/.test(css) && /\.eq-picker\{/.test(css) && /\.eq-opt\{/.test(css) && !/\.eq-top\{|\.eq-prog\{|\.eq-diff\{|\.eq-motivo\{/.test(css));
  // sw.js: NO se sube CACHE_V (solo cambia el CONTENIDO de archivos ya precacheados y refrescados por
  // network-first; la LISTA de precache no cambia y ningún archivo COMPARTIDO cambió). Se comprueba que
  // los tres archivos de la chequeadora sigan en el precache.
  const sw=leer('sw.js');
  ok('sw.js: los 3 archivos de la chequeadora siguen en el precache (lista sin cambios)', /reporte-chequeadora\.html/.test(sw) && /reporte-chequeadora\.js/.test(sw) && /reporte-chequeadora\.css/.test(sw));
  ok('sw.js: sigue en network-first (el contenido se refresca solo, no hace falta subir CACHE_V)', /NETWORK-FIRST/.test(sw));
  { let e=''; try{ new Function(leer('encargado.js')); }catch(x){ e=x.message; } ok('encargado.js compila', !e, e); }
}

console.log('\n9 · MUTACIÓN deliberada (la prueba NO es ciega)');
{
  // (a) quitar el ÷nº: la producción deja de repartirse → 700 en cada excavadora (lo detecta el caso 1)
  const mutA=(s)=>{ const out=s.replace('const prodCada=totalExc/nProd;','const prodCada=totalExc;');
    if(out===s) throw new Error('ancla ÷nProd no encontrada'); return out; };
  const ca=cargar({ mutar:mutA }); const ra=post(ca, reporteCheq([ { id_registro:'m-1', id_maquina:'EXC015', tipo_equipo:'EXCAVADORAS' }, { id_registro:'m-2', id_maquina:'EXC030', tipo_equipo:'EXCAVADORA' } ], { token:tok(ca,'pedro','chequeadora') }));
  const fa=maqFilas(ca);
  ok('sin ÷nº la producción sería 700 (no 350) — la aserción de T=350 lo detectaría', ra.ok && colM(ca,fa[0],'produccion')===700 && colM(ca,fa[1],'produccion')===700, JSON.stringify(fa.map(x=>colM(ca,x,'produccion'))));
  // (b) reponer el operador recortado: G volvería a escribir m.operador (lo detecta la aserción de VACÍOS)
  const mutB=(s)=>{ const out=s.replace("'', fecha, '', proyMaq, m.id_maquina, '', '',","'', fecha, '', proyMaq, m.id_maquina, '', m.operador,");
    if(out===s) throw new Error('ancla de la fila recortada de la chequeadora no encontrada'); return out; };
  const cb=cargar({ mutar:mutB });
  const rb=post(cb, reporteCheq([ { id_registro:'v-1', id_maquina:'EXC015', tipo_equipo:'EXCAVADORA', operador:'Pedro', horas_operadas:5.5 } ], { token:tok(cb,'pedro','chequeadora') }));
  const fb=maqFilas(cb);
  ok('sin el recorte el operador se escribiría (G="Pedro") — la aserción de VACÍOS lo detectaría', rb.ok && colM(cb,fb[0],'operador')==='Pedro' && vacias(cb,fb[0]).indexOf('operador')>=0, JSON.stringify(vacias(cb,fb[0])));
}

console.log('\n'+(fallos?('✗ '+fallos+' de '+casos+' casos fallan'):('✓ '+casos+' casos pasan')));
process.exit(fallos?1:0);
