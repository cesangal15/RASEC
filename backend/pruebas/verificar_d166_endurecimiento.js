#!/usr/bin/env node
/**
 * Verificación de D166 — endurecimiento de los dos Apps Script (obra + Parte, asistencias).
 *
 * Ejecuta el CÓDIGO REAL de `backend/Codigo.gs` + `backend/CodigoParte.gs` y de
 * `backend/CodigoAsistencias.gs` en un sandbox de `vm` con los servicios de Apps Script de mentira
 * (Sheet en memoria, CacheService que cuenta de verdad, DriveApp/ScriptApp que registran lo que se les
 * pide). El HMAC es el real (módulo `crypto`), así que los tokens buenos y malos son de verdad.
 *
 *   1 · LOG: una fila por petición con fecha-hora, usuario, rol, action, resultado, motivo y ms; una
 *       sola appendRow; la causa exacta del token malo va al LOG y NO al cliente; `tablero` no se anota;
 *       si la hoja LOG falla, la petición sale bien igual.
 *   2 · Respuesta genérica ante token inválido; el mensaje de AUTH_SECRETO ausente se conserva en asistencias.
 *   3 · Rate limit 60/min por usuario+action (el 61º no toca el Sheet); login 10/min por usuario; una
 *       sola fila de LOG por ventana para los rechazos.
 *   4 · Validación de payload por action: tipos, rangos, longitudes, fecha futura → {ok:false,
 *       error:'payload', campo}; un payload viejo (sin ids, campos mínimos) sigue entrando (D82).
 *   5 · Respaldo diario: copia `Obra_TM2_<hoy>` en Galca_respaldos/TM2_Sur, no duplica, borra solo las
 *       copias de su prefijo con más de 30 días; el trigger queda a las 02:00 y no se duplica.
 *   6 · Parte: equipo inactivo o inexistente → error:'equipo'; 20 envíos/hora por equipo y 200 global;
 *       LOG con el código de equipo; payload de tramo mal tipado → 'payload'; flujo del QR intacto.
 *
 *   node backend/pruebas/verificar_d166_endurecimiento.js
 */
const fs=require('fs'), path=require('path'), vm=require('vm'), crypto=require('crypto');
const REPO=path.resolve(__dirname,'..','..');
const SRC_OBRA=fs.readFileSync(path.join(REPO,'backend','Codigo.gs'),'utf8')+'\n'+fs.readFileSync(path.join(REPO,'backend','CodigoParte.gs'),'utf8');
const SRC_ASIS=fs.readFileSync(path.join(REPO,'backend','CodigoAsistencias.gs'),'utf8');
const HOY=new Date().toLocaleDateString('en-CA',{ timeZone:'America/Bogota' });
const SECRETO='secreto-de-banco-largo-xxxxxxxx-yyyyyyyy';
let fallos=0, casos=0;
function ok(n,c,x){ casos++; if(!c){ fallos++; console.log('  ✗ '+n+(x?'  → '+x:'')); } else console.log('  ✓ '+n); }
function masDias(iso,d){ const p=iso.split('-').map(Number); const dt=new Date(p[0],p[1]-1,p[2]); dt.setDate(dt.getDate()+d); return dt.toLocaleDateString('en-CA'); }

/* ---------- Sheet en memoria (mismo molde que verificar_v301_parte_digital.js) ---------- */
function hojaFalsa(filas){
  const g={ _f:filas.map(r=>r.slice()), _escrituras:0, _appends:0,
    getLastRow: ()=>{ let n=g._f.length; while(n>0 && g._f[n-1].every(v=>v===''||v===undefined)) n--; return n; },
    getLastColumn: ()=>g._f.reduce((m,r)=>Math.max(m,r.length),0),
    getMaxRows: ()=>Math.max(g._f.length,200), getMaxColumns: ()=>Math.max(g.getLastColumn(),40),
    insertRowsAfter(){}, insertColumnsAfter(){},
    deleteRows(f,n){ g._f.splice(f-1, n||1); g._escrituras++; },
    _fila(i){ while(g._f.length<=i) g._f.push([]); return g._f[i]; },
    getDataRange(){ return g.getRange(1,1,Math.max(g._f.length,1),Math.max(g.getLastColumn(),1)); },
    appendRow(r){ g._f.push(r.slice()); g._escrituras++; g._appends++; },
    clearContents(){ g._f=[]; g._escrituras++; },
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
        clearContent(){ for(let i=f-1;i<f-1+nf;i++){ const r=g._f[i]; if(!r) continue;
            for(let j=c-1;j<c-1+nc;j++) r[j]=''; } }
      };
    }
  };
  return g;
}
/* CacheService que CUENTA de verdad (sin caducidad: la ventana la fija la clave por minuto). */
function cacheFalsa(){ const m=new Map(); return { get:(k)=>m.has(k)?m.get(k):null, put:(k,v)=>{ m.set(k,String(v)); }, remove:(k)=>m.delete(k), _m:m }; }
/* Drive de mentira: carpetas anidadas por nombre y archivos con nombre + papelera. */
function driveFalso(){
  const mkFolder=(nombre)=>{ const f={ nombre, carpetas:[], archivos:[],
    getFoldersByName(n){ const l=f.carpetas.filter(x=>x.nombre===n); let i=0; return { hasNext:()=>i<l.length, next:()=>l[i++] }; },
    createFolder(n){ const c=mkFolder(n); f.carpetas.push(c); return c; },
    getFilesByName(n){ const l=f.archivos.filter(x=>x.nombre===n && !x.papelera); let i=0; return { hasNext:()=>i<l.length, next:()=>l[i++] }; },
    getFiles(){ const l=f.archivos.filter(x=>!x.papelera); let i=0; return { hasNext:()=>i<l.length, next:()=>l[i++] }; } }; return f; };
  const raiz=mkFolder('raíz'); const copias=[];
  const mkFile=(nombre)=>({ nombre, papelera:false, getName(){ return nombre; }, setTrashed(v){ this.papelera=!!v; } });
  return { raiz, copias, mkFile,
    getRootFolder:()=>raiz,
    getFileById:(id)=>({ makeCopy(nombre, carpeta){ const f=mkFile(nombre); f.origen=id; carpeta.archivos.push(f); copias.push(f); return f; } }) };
}
function scriptAppFalso(){
  const triggers=[];
  const mk=(fn)=>{ const t={ fn, hora:null, getHandlerFunction:()=>fn }; return t; };
  return { _triggers:triggers,
    getProjectTriggers:()=>triggers.slice(),
    deleteTrigger:(t)=>{ const i=triggers.indexOf(t); if(i>=0) triggers.splice(i,1); },
    newTrigger:(fn)=>{ const t=mk(fn); return { timeBased:()=>({ everyDays:(n)=>({ atHour:(h)=>{ const b={ inTimezone:(tz)=>{ t.tz=tz; return b; }, create:()=>{ t.hora=h; t.dias=n; triggers.push(t); return t; } }; return b; } }) }) }; } };
}
function servicios(props, hojas, extra){
  const cache=cacheFalsa();
  const ss={ getSheetByName:(n)=>hojas[n]||null,
             insertSheet:(n)=>{ if(extra && extra.insertFalla===n) throw new Error('insertSheet falló a propósito'); hojas[n]=hojaFalsa([]); return hojas[n]; },
             getSpreadsheetTimeZone:()=>'America/Bogota' };
  const ctx={ console,
    SpreadsheetApp:{ openById:()=>ss },
    ContentService:{ createTextOutput:(t)=>({ setMimeType:()=>JSON.parse(t) }), MimeType:{JSON:'json'} },
    CacheService:{ getScriptCache:()=>cache },
    PropertiesService:{ getScriptProperties:()=>({ getProperty:(k)=>Object.prototype.hasOwnProperty.call(props,k)?props[k]:null, setProperty:(k,v)=>{ props[k]=String(v); } }) },
    LockService:{ getScriptLock:()=>({ waitLock:()=>true, releaseLock(){} }) },
    DriveApp: driveFalso(), ScriptApp: scriptAppFalso(),
    Utilities:{
      computeHmacSha256Signature:(txt, clave)=>crypto.createHmac('sha256', String(clave)).update(String(txt),'utf8').digest(),
      base64EncodeWebSafe:(b)=>Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_'),
      base64DecodeWebSafe:(s)=>Buffer.from(String(s).replace(/-/g,'+').replace(/_/g,'/'),'base64'),
      newBlob:(x)=>{ const b=Buffer.isBuffer(x)?x:Buffer.from(String(x),'utf8'); return { getBytes:()=>b, getDataAsString:()=>b.toString('utf8') }; },
      computeDigest:(alg, txt)=>crypto.createHash('sha256').update(String(txt),'utf8').digest(),
      DigestAlgorithm:{ SHA_256:'sha256' },
      getUuid:()=>'uuid-'+(++ctx._uuid), formatDate:()=>HOY, Charset:{UTF_8:'utf8'} },
    Logger:{ log(){} }, Session:{ getScriptTimeZone:()=>'America/Bogota' }, _uuid:0, _cache:cache, _hojas:hojas };
  ctx.globalThis=ctx; vm.createContext(ctx); return ctx;
}
function tokenDe(ctx, usuario, rol){ return ctx.emitirToken_(usuario, rol, []); }
const get =(ctx,p)=>ctx.doGet({ parameter:p });
const post=(ctx,b)=>ctx.doPost({ postData:{ contents:JSON.stringify(b) } });
const LOG=(ctx)=>ctx._hojas.LOG ? ctx._hojas.LOG._f.slice(1) : [];
const ultimaLog=(ctx)=>{ const l=LOG(ctx); return l[l.length-1]||[]; };

function cargarObra(opts){
  opts=opts||{};
  const hojas={};
  hojas.USUARIOS=hojaFalsa([['usuario','clave','rol','areas','redirige','estado'],
    ['admin','1234','admin','','menu.html','activo'], ['angel','clave-angel','capataz','','seleccion-reporte.html','activo']]);
  hojas.PARTE_EQUIPOS=hojaFalsa([
    ['codigo','tipo','placa','proveedor','medidor','ultima_fecha','ultimo_final','activo'],
    ['VOL048','VOLQUETAS DOBLETROQUE','NNM180','ORTIZ','KM','2026-09-09',27120,'SI'],
    ['BL002','BULLDOZER','MC725424','ORTIZ','REVISAR','','','NO']]);
  hojas.PARTE_OPERADORES=hojaFalsa([['operador','partes_ult_4_meses'],['Nelson Rangel',323]]);
  hojas.PARTE_CC=hojaFalsa([['centro_coste','proyecto','descripcion_cc','usos_ult_4_meses'],['3701.02.11','3701','Transporte',457]]);
  hojas.PARTE_ACTIVIDADES=hojaFalsa([['tipo_equipo','descripcion_trabajo','veces']]);
  hojas.TABLERO=hojaFalsa([['orden','texto'],[0,'~{"generado":"x"}'],[1,'~{"per":[1]}']]);
  const ctx=servicios(Object.assign({ AUTH_SECRETO:SECRETO, AUTH_V:'1' }, opts.props||{}), hojas, opts);
  vm.runInContext(SRC_OBRA, ctx, { filename:'Codigo.gs+CodigoParte.gs' });
  vm.runInContext('globalThis.SHEET_ID=SHEET_ID;', ctx);   // los `const` no cuelgan del global del vm
  return ctx;
}
function cargarAsis(opts){
  opts=opts||{};
  const hojas={};
  hojas.CUADRILLAS=hojaFalsa([['cuadrilla','responsables','area','estado'],['ANGEL','angel','','']]);
  hojas.CONFIG=hojaFalsa([['clave','valor'],['max_extras_dia',2],['domfest_tope',7]]);
  hojas.PERSONAL=hojaFalsa([['cedula','codigo','nombre','cargo','cuadrilla','responsable','estado','fecha_retiro','fecha_ingreso']]);
  const props=Object.assign({ AUTH_SECRETO:SECRETO, AUTH_V:'1' }, opts.props||{});
  if(opts.sinSecreto) delete props.AUTH_SECRETO;   // verificador sin secreto copiado (D109)
  const ctx=servicios(props, hojas, opts);
  vm.runInContext(SRC_ASIS, ctx, { filename:'CodigoAsistencias.gs' });
  return ctx;
}
function reporteViejo(fecha){   // payload de capataz SIN ids (frontend viejo en caché, D82)
  return { fecha:fecha||HOY, rol:'capataz', capataz:'ANGEL', cantidades:[
    { grupo:'TIERRAS', capitulo:'EXPLANACIONES', actividad:'Excavación', descripcion:'Excavación en material común', centro_costo:'3701.02.05',
      unidad:'m3', uf:'1', proyecto:'3701', elemento:'K0+100', pk_inicial:'K0+100', pk_final:'K0+200', largo:120,
      equipos:[{ id_maquina:'EX01', operador:'Pedro', tipo_equipo:'EXCAVADORA', horas_operadas:8, horas_programadas:8 }] } ] };
}

console.log('\n1 · LOG — una fila por petición, en la puerta única');
{
  const ctx=cargarObra(); const tok=tokenDe(ctx,'angel','capataz');
  const r=get(ctx,{ action:'cubicaje', token:tok });
  ok('GET con token válido responde ok', r.ok===true, JSON.stringify(r).slice(0,100));
  ok('la hoja LOG se creó sola con sus 7 encabezados', ctx._hojas.LOG && JSON.stringify(ctx._hojas.LOG._f[0])===JSON.stringify(['fecha_hora','usuario','rol','action','resultado','motivo','ms']));
  const f=ultimaLog(ctx);
  ok('una fila: fecha-hora Date, usuario, rol, action, resultado ok, ms numérico',
     LOG(ctx).length===1 && typeof f[0].getFullYear==='function' && f[1]==='angel' && f[2]==='capataz' && f[3]==='cubicaje' && f[4]==='ok' && typeof f[6]==='number', JSON.stringify(f));
  ok('una sola appendRow en LOG por petición', ctx._hojas.LOG._appends===2 /* encabezado + fila */, String(ctx._hojas.LOG._appends));
  post(ctx,{ token:tok, fecha:HOY, rol:'capataz', capataz:'ANGEL', cantidades:[] });
  const g=ultimaLog(ctx);
  ok('POST sin action se anota como `reporte`', LOG(ctx).length===2 && g[3]==='reporte' && g[4]==='ok', JSON.stringify(g));
  get(ctx,{ action:'tablero' });
  ok('`tablero` (lectura pública) no pasa por la puerta y no se anota', LOG(ctx).length===2);
  // LOG que falla no tumba la petición
  const ctx2=cargarObra({ insertFalla:'LOG' });
  const r2=get(ctx2,{ action:'cubicaje', token:tokenDe(ctx2,'angel','capataz') });
  ok('si la hoja LOG no se puede crear, la petición sale bien igual', r2.ok===true && !ctx2._hojas.LOG, JSON.stringify(r2).slice(0,80));
}

console.log('\n2 · Respuesta genérica ante token inválido (la causa va al LOG)');
{
  const ctx=cargarObra();
  const a=get(ctx,{ action:'bandeja', fecha:HOY });
  ok('sin token → auth:false con mensaje genérico', a.ok===false && a.auth===false && a.error==='Sesión no válida. Vuelve a entrar.', JSON.stringify(a));
  ok('…y el LOG guarda la causa exacta («Falta el token»)', ultimaLog(ctx)[4]==='rechazado' && /Falta el token/.test(ultimaLog(ctx)[5]), JSON.stringify(ultimaLog(ctx)));
  const tok=tokenDe(ctx,'angel','capataz');
  const roto=tok.slice(0,-3)+'xyz';
  const b=get(ctx,{ action:'bandeja', fecha:HOY, token:roto });
  ok('firma alterada → mismo mensaje genérico', b.auth===false && b.error==='Sesión no válida. Vuelve a entrar.');
  const c=get(ctx,{ action:'bandeja', fecha:HOY, token:'basura-sin-punto' });
  ok('basura → mismo mensaje genérico', c.auth===false && c.error==='Sesión no válida. Vuelve a entrar.');
  const ctxV=cargarObra({ props:{ AUTH_V:'2' } });
  const d=get(ctxV,{ action:'bandeja', fecha:HOY, token:tok });
  ok('versión vencida → mismo mensaje genérico, causa en LOG', d.auth===false && d.error==='Sesión no válida. Vuelve a entrar.' && /Sesión cerrada/.test(ultimaLog(ctxV)[5]), JSON.stringify(ultimaLog(ctxV)));
  ok('la sesión buena sigue entrando (regresión cero)', get(ctx,{ action:'cubicaje', token:tok }).ok===true);
  // asistencias: el mensaje explícito de AUTH_SECRETO ausente se conserva (D109)
  const as=cargarAsis({ sinSecreto:true });
  const s=get(as,{ action:'roster', token:tok });
  ok('asistencias SIN AUTH_SECRETO: mensaje explícito (D109), no el genérico', s.ok===false && s.auth===false && /AUTH_SECRETO/.test(s.error), JSON.stringify(s).slice(0,120));
  const as2=cargarAsis();
  const s2=get(as2,{ action:'roster' });
  ok('asistencias sin token: genérico', s2.auth===false && s2.error==='Sesión no válida. Vuelve a entrar.');
  const s3=get(as2,{ action:'roster', token:tokenDe(as2,'angel','capataz') });
  ok('asistencias con token válido: ok + fila LOG', s3.ok===true && ultimaLog(as2)[1]==='angel' && ultimaLog(as2)[3]==='roster', JSON.stringify(ultimaLog(as2)));
}

console.log('\n3 · Rate limit por usuario+action (CacheService)');
{
  const ctx=cargarObra(); const tok=tokenDe(ctx,'angel','capataz');
  let ultimo=null; for(let i=0;i<60;i++) ultimo=get(ctx,{ action:'cubicaje', token:tok });
  ok('60 peticiones/min pasan', ultimo.ok===true);
  const logAntes=LOG(ctx).length;
  const r61=get(ctx,{ action:'cubicaje', token:tok });
  ok('la 61ª → {ok:false, error:"rate_limit"}', r61.ok===false && r61.error==='rate_limit', JSON.stringify(r61));
  ok('se anota UNA fila de LOG con rate_limit', LOG(ctx).length===logAntes+1 && ultimaLog(ctx)[5]==='rate_limit');
  for(let i=0;i<5;i++) get(ctx,{ action:'cubicaje', token:tok });
  ok('los rechazos siguientes de la misma ventana NO inflan el LOG', LOG(ctx).length===logAntes+1, String(LOG(ctx).length));
  ok('otra action del mismo usuario sigue pasando', Array.isArray(get(ctx,{ action:'estado', fecha:HOY, token:tok }).reportadas));
  ok('otro usuario con la misma action sigue pasando', get(ctx,{ action:'cubicaje', token:tokenDe(ctx,'admin','admin') }).ok===true);
  // escritura: el 61º reporte no toca el Sheet
  const c2=cargarObra(); const t2=tokenDe(c2,'angel','capataz');
  for(let i=0;i<60;i++) post(c2, Object.assign({ token:t2 }, reporteViejo()));
  const escr=c2._hojas.BANDEJA._escrituras;
  const r=post(c2, Object.assign({ token:t2 }, reporteViejo()));
  ok('61º reporte → rate_limit y BANDEJA sin una escritura más', r.error==='rate_limit' && c2._hojas.BANDEJA._escrituras===escr);
  // login 10/min por usuario
  const c3=cargarObra();
  let l=null; for(let i=0;i<10;i++) l=post(c3,{ action:'login', usuario:'admin', clave:'mala' });
  ok('10 intentos de login pasan (rechazados por credenciales, no por límite)', l.ok===false && /incorrectos/.test(l.error));
  ok('el LOG anota el intento: usuario dicho + rechazado + credenciales', ultimaLog(c3)[1]==='admin' && ultimaLog(c3)[3]==='login' && ultimaLog(c3)[4]==='rechazado' && /credenciales/.test(ultimaLog(c3)[5]), JSON.stringify(ultimaLog(c3)));
  const l11=post(c3,{ action:'login', usuario:'admin', clave:'1234' });
  ok('el 11º → rate_limit aunque la clave sea buena', l11.ok===false && l11.error==='rate_limit');
  const lo=post(c3,{ action:'login', usuario:'angel', clave:'clave-angel' });
  ok('otro usuario entra y recibe token; LOG con rol', lo.ok===true && lo.token && ultimaLog(c3)[1]==='angel' && ultimaLog(c3)[2]==='capataz' && ultimaLog(c3)[4]==='ok', JSON.stringify(ultimaLog(c3)));
  // sin CacheService: fail-open
  const c4=cargarObra(); delete c4.CacheService; const t4=tokenDe(c4,'angel','capataz');
  let u=null; for(let i=0;i<70;i++) u=get(c4,{ action:'cubicaje', token:t4 });
  ok('sin CacheService disponible no se bloquea a nadie (fail-open)', u.ok===true);
}

console.log('\n4 · Validación de payload por action de escritura');
{
  const ctx=cargarObra(); const tok=tokenDe(ctx,'angel','capataz');
  const viejo=post(ctx, Object.assign({ token:tok }, reporteViejo()));
  ok('payload VIEJO (sin ids, campos mínimos) sigue entrando: ok:true (D82)', viejo.ok===true && viejo.cantidades===1 && viejo.maquinas===1, JSON.stringify(viejo).slice(0,120));
  const p=(mut)=>{ const b=Object.assign({ token:tok }, reporteViejo()); mut(b); return post(ctx,b); };
  let r=p(b=>{ b.cantidades[0].largo='abc'; });
  ok('largo no numérico → payload/cantidades[0].largo', r.ok===false && r.error==='payload' && r.campo==='cantidades[0].largo', JSON.stringify(r));
  ok('…y el LOG lo anota como rechazado payload:campo', ultimaLog(ctx)[4]==='rechazado' && /payload:cantidades\[0\]\.largo/.test(ultimaLog(ctx)[5]), JSON.stringify(ultimaLog(ctx)));
  r=p(b=>{ b.cantidades[0].largo=-5; });                       ok('largo negativo → payload', r.error==='payload' && r.campo==='cantidades[0].largo');
  r=p(b=>{ b.cantidades[0].largo='12,5'; });                   ok('largo con coma decimal se acepta (no es un rechazo de tipo)', r.ok===true);
  r=p(b=>{ b.fecha=masDias(HOY,1); });                          ok('fecha futura → payload/fecha', r.error==='payload' && r.campo==='fecha', JSON.stringify(r));
  r=p(b=>{ b.fecha=masDias(HOY,-40); });                        ok('fecha de hace 40 días (cola offline) se acepta', r.ok===true);
  r=p(b=>{ b.fecha='31/12/2026'; });                            ok('fecha mal formada → payload/fecha', r.error==='payload' && r.campo==='fecha');
  r=p(b=>{ b.cantidades[0].observacion='x'.repeat(2001); });    ok('observación > 2000 → payload', r.error==='payload' && r.campo==='cantidades[0].observacion');
  r=p(b=>{ b.cantidades[0].observacion='x'.repeat(1500); });    ok('observación de 1500 se acepta', r.ok===true);
  r=p(b=>{ b.cantidades[0].equipos[0].horas_operadas=30; });    ok('horas_operadas 30 → payload/…equipos[0].horas_operadas', r.error==='payload' && r.campo==='cantidades[0].equipos[0].horas_operadas');
  r=p(b=>{ b.cantidades[0].centro_costo={ a:1 }; });            ok('texto que llega como objeto → payload', r.error==='payload' && r.campo==='cantidades[0].centro_costo');
  r=p(b=>{ b.cantidades='no-es-lista'; });                      ok('cantidades que no es lista → payload/cantidades', r.error==='payload' && r.campo==='cantidades');
  r=p(b=>{ b.volquetas=[{ origen:'Masivo 2', placas:[{ placa:'ABC123', viajes:5000 }] }]; }); ok('viajes 5000 → payload/volquetas[0].placas[0].viajes', r.campo==='volquetas[0].placas[0].viajes');
  r=p(b=>{ b.m3viaje=14; b.volquetas=[{ origen:'Masivo 2', destino:'K1', tipo_destino:'Terraplén', placas:[{ placa:'ABC123', viajes:12 }] }]; b.rol='chequeadora'; });
  ok('reporte de chequeadora bien formado entra', r.ok===true && r.volquetas===1, JSON.stringify(r).slice(0,100));
  // enviar_data / flota / maquinaria_produccion / tablero
  const tokE=tokenDe(ctx,'admin','admin');
  r=post(ctx,{ token:tokE, action:'enviar_data', fecha:HOY, area:'norte', clima:'Seco', cantidades:[] });
  ok('enviar_data con área desconocida → payload/area', r.error==='payload' && r.campo==='area');
  r=post(ctx,{ token:tokE, action:'enviar_data', fecha:HOY, area:'tierras', clima:'Seco', cantidades:[{ centro_costo:'3701.02.05', largo:'1e9' }] });
  ok('enviar_data con largo desmedido → payload', r.error==='payload' && r.campo==='cantidades[0].largo');
  r=post(ctx,{ token:tokE, action:'enviar_data', fecha:HOY, area:'tierras', cantidades:[] });
  ok('enviar_data sin clima conserva su mensaje de negocio (D130), no es «payload»', r.ok===false && /clima/.test(r.error) && r.error!=='payload');
  r=post(ctx,{ token:tokE, action:'flota_guardar', op:'alta', id_maquina:'EX99', tipo:'EXCAVADORA', horas_prog:6.4, propiedad:'propia', fecha_ingreso:masDias(HOY,10) });
  ok('flota: fecha de ingreso 10 días adelante se acepta (programada)', r.error!=='payload', JSON.stringify(r).slice(0,100));
  r=post(ctx,{ token:tokE, action:'flota_guardar', op:'alta', id_maquina:'EX99', horas_prog:40 });
  ok('flota: horas_prog 40 → payload/horas_prog', r.error==='payload' && r.campo==='horas_prog');
  r=post(ctx,{ token:tokE, action:'flota_guardar', op:'romper' });
  ok('flota: op fuera de lista → payload/op', r.error==='payload' && r.campo==='op');
  r=post(ctx,{ token:tokE, action:'maquinaria_produccion', fecha:HOY, ajustes:[{ id_registro:'x', produccion:'mucho' }] });
  ok('maquinaria_produccion: producción no numérica → payload', r.error==='payload' && r.campo==='ajustes[0].produccion');
  r=post(ctx,{ token:tokE, action:'tablero_guardar', foto:'texto' });
  ok('tablero_guardar: foto que no es objeto → payload/foto', r.error==='payload' && r.campo==='foto');
  r=post(ctx,{ action:'login', usuario:{ a:1 }, clave:'x' });
  ok('login: usuario que no es texto → payload/usuario', r.error==='payload' && r.campo==='usuario');
  r=post(ctx,{ action:'login', usuario:'admin', clave:'x'.repeat(201) });
  ok('login: clave > 200 → payload/clave', r.error==='payload' && r.campo==='clave');
  // asistencias
  const as=cargarAsis(); const ta=tokenDe(as,'admin','admin');
  const fila={ codigo:'C1', cedula:'1', nombre:'Juan', cargo:'Ayudante', cc:'3701.I010305', proyecto:'3701', hora_entrada:'07:00', hora_salida:'17:00', presente:'Si', motivo_ausencia:'', observacion:'', turno:'1' };
  r=post(as,{ token:ta, action:'reporte_asistencia', fecha:HOY, cuadrilla:'ANGEL', reporta:'admin', filas:[fila] });
  ok('asistencias: reporte bien formado entra', r.ok===true && r.filas===1, JSON.stringify(r).slice(0,100));
  ok('…con su fila de LOG (usuario del token, action, ok)', ultimaLog(as)[1]==='admin' && ultimaLog(as)[3]==='reporte_asistencia' && ultimaLog(as)[4]==='ok');
  r=post(as,{ token:ta, action:'reporte_asistencia', fecha:HOY, cuadrilla:'ANGEL', filas:[Object.assign({}, fila, { hora_entrada:'a las siete' })] });
  ok('hora_entrada ilegible → payload/filas[0].hora_entrada', r.error==='payload' && r.campo==='filas[0].hora_entrada', JSON.stringify(r));
  r=post(as,{ token:ta, action:'reporte_asistencia', fecha:masDias(HOY,2), cuadrilla:'ANGEL', filas:[fila] });
  ok('fecha futura → payload/fecha', r.error==='payload' && r.campo==='fecha');
  r=post(as,{ token:ta, action:'extras_admin', fecha:HOY, cc:'3701.I010305', horas:30, tipo:'diurna' });
  ok('extras_admin horas 30 → payload/horas', r.error==='payload' && r.campo==='horas');
  r=post(as,{ token:ta, action:'extras_admin', fecha:HOY, cc:'3701.I010305', horas:1.5, tipo:'diurna' });
  ok('extras_admin bien formada entra', r.ok===true, JSON.stringify(r).slice(0,100));
  r=post(as,{ token:ta, action:'personal', op:'alta', codigo:'C9', cedula:'9', nombre:'x'.repeat(201), cuadrilla:'ANGEL' });
  ok('personal: nombre > 200 → payload/nombre', r.error==='payload' && r.campo==='nombre');
}

console.log('\n5 · Respaldo diario a Drive + trigger 02:00 + poda del LOG');
{
  const ctx=cargarObra();
  // copias viejas: una de este prefijo (se borra), una de hace 10 días (se queda) y una ajena (no se toca)
  const carpeta=ctx.respaldoCarpeta_();
  const vieja=ctx.DriveApp.mkFile('Obra_TM2_'+masDias(HOY,-31)), reciente=ctx.DriveApp.mkFile('Obra_TM2_'+masDias(HOY,-10)), ajena=ctx.DriveApp.mkFile('Asistencias_TM2_'+masDias(HOY,-90));
  carpeta.archivos.push(vieja, reciente, ajena);
  // LOG con una fila de hace 40 días y otra de hoy
  ctx._hojas.LOG=hojaFalsa([['fecha_hora','usuario','rol','action','resultado','motivo','ms'],[new Date(Date.now()-40*86400000),'a','r','x','ok','',1],[new Date(),'b','r','y','ok','',1]]);
  const hechos=ctx.respaldoDiario();
  ok('carpeta Galca_respaldos/TM2_Sur creada bajo la raíz', ctx.DriveApp.raiz.carpetas[0].nombre==='Galca_respaldos' && ctx.DriveApp.raiz.carpetas[0].carpetas[0].nombre==='TM2_Sur');
  ok('copia con nombre <prefijo>_<fecha ISO> del Sheet de obra', hechos[0]==='Obra_TM2_'+HOY && ctx.DriveApp.copias.length===1 && ctx.DriveApp.copias[0].origen===ctx.SHEET_ID, JSON.stringify(hechos));
  ok('la copia de hace 31 días va a la papelera; la de hace 10 y la de otro prefijo se quedan', vieja.papelera===true && reciente.papelera===false && ajena.papelera===false);
  ok('LOG podado: la fila de hace 40 días sale, la de hoy se queda', ctx._hojas.LOG._f.length===2 && ctx._hojas.LOG._f[1][1]==='b');
  ctx.respaldoDiario();
  ok('segunda corrida el mismo día: no duplica la copia', ctx.DriveApp.copias.length===1);
  ctx.PropertiesService.getScriptProperties().setProperty('PARTE_SHEET_ID','otro-sheet-del-parte');
  const h2=ctx.respaldoDiario();
  ok('con PARTE_SHEET_ID distinto al de obra, el Parte entra en la misma corrida', h2.length===2 && h2[1]==='Parte_TM2_'+HOY && ctx.DriveApp.copias[1].origen==='otro-sheet-del-parte', JSON.stringify(h2));
  ctx.ScriptApp._triggers.push({ fn:'respaldoDiario', getHandlerFunction:()=>'respaldoDiario' }, { fn:'calentarCache', getHandlerFunction:()=>'calentarCache' });
  ctx.instalarTriggerRespaldo();
  const ts=ctx.ScriptApp._triggers;
  ok('instalarTriggerRespaldo deja UN trigger diario a las 02:00 y respeta los ajenos', ts.filter(t=>t.fn==='respaldoDiario').length===1 && ts.find(t=>t.fn==='respaldoDiario').hora===2 && ts.find(t=>t.fn==='respaldoDiario').tz==='America/Bogota' && ts.some(t=>t.fn==='calentarCache'), JSON.stringify(ts.map(t=>t.fn+':'+t.hora)));
  // asistencias: mismo bloque, prefijo propio
  const as=cargarAsis();
  const ha=as.respaldoDiario();
  ok('asistencias respalda con su prefijo en la misma carpeta', ha[0]==='Asistencias_TM2_'+HOY && as.DriveApp.raiz.carpetas[0].carpetas[0].nombre==='TM2_Sur', JSON.stringify(ha));
  ok('setupHojas de asistencias crea LOG', (as.setupHojas(), !!as._hojas.LOG));
  ok('setupLog de obra es idempotente', (cargarObra().setupLog()==='ok'));
}

console.log('\n6 · Parte Digital (QR, sin token): equipo activo, rate limit por equipo/global, LOG por equipo');
{
  const tramo=(o)=>Object.assign({ fecha:HOY, reporte_num:'0457', operador:'Nelson Rangel', hora_de:'07:00', hora_a:'12:00', centro_coste:'3701.02.11', pr:14400, descripcion_trabajo:'Cargue', observaciones:'' }, o);
  const ctx=cargarObra();
  let r=post(ctx,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[tramo({ inicial:27120, final:27250 })] });
  ok('envío del operador (sin token) entra igual que antes', r.ok===true && r.guardadas===1, JSON.stringify(r).slice(0,120));
  ok('LOG con identidad = código de equipo, rol `equipo`, action parte:reporte', ultimaLog(ctx)[1]==='VOL048' && ultimaLog(ctx)[2]==='equipo' && ultimaLog(ctx)[3]==='parte:reporte' && ultimaLog(ctx)[4]==='ok', JSON.stringify(ultimaLog(ctx)));
  r=post(ctx,{ mod:'parte', op:'reporte', codigo:'BL002', tramos:[tramo({ inicial:1, final:2 })] });
  ok('equipo INACTIVO → {ok:false, error:"equipo"} (antes se guardaba con aviso)', r.ok===false && r.error==='equipo' && /INACTIVO/.test(r.detalle), JSON.stringify(r).slice(0,140));
  r=post(ctx,{ mod:'parte', op:'reporte', codigo:'ZZZ9', tramos:[tramo({ inicial:1, final:2 })] });
  ok('equipo inexistente → error:"equipo"', r.ok===false && r.error==='equipo' && ctx._hojas.PARTE_BANDEJA._f.length===2);
  r=post(ctx,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[tramo({ inicial:'abc', final:27300 })] });
  ok('inicial no numérico → payload/tramos[0].inicial', r.error==='payload' && r.campo==='tramos[0].inicial', JSON.stringify(r));
  r=post(ctx,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[tramo({ inicial:27250, final:27300, horas_lluvia:30 })] });
  ok('horas_lluvia 30 → payload', r.error==='payload' && r.campo==='tramos[0].horas_lluvia');
  r=post(ctx,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[tramo({ inicial:27250, final:27300, fecha:masDias(HOY,1) })] });
  ok('fecha futura conserva el mensaje de negocio del Parte y queda en LOG', r.ok===false && /futura/.test(r.error) && ultimaLog(ctx)[4]==='rechazado');
  r=post(ctx,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[tramo({ inicial:27250, final:29000 })] });
  ok('tope de 700 km sigue bloqueando con su texto', r.ok===false && /supera el máximo/.test(r.error));
  const eq=get(ctx,{ mod:'parte', op:'equipo', eq:'VOL048' });
  ok('GET equipo público sigue abierto y se anota con el código', eq.ok===true && ultimaLog(ctx)[1]==='VOL048' && ultimaLog(ctx)[3]==='parte:equipo');
  // 20/hora por equipo
  const c2=cargarObra(); let u=null;
  for(let i=0;i<20;i++) u=post(c2,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[tramo({ inicial:27120+i, final:27121+i, id_registro:'id-'+i })] });
  ok('20 envíos/hora del mismo equipo pasan', u.ok===true);
  const filas=c2._hojas.PARTE_BANDEJA._f.length;
  u=post(c2,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[tramo({ inicial:27200, final:27201 })] });
  ok('el 21º → rate_limit y la bandeja no crece', u.error==='rate_limit' && c2._hojas.PARTE_BANDEJA._f.length===filas);
  u=post(c2,{ mod:'parte', op:'reporte', codigo:'vol-048', tramos:[tramo({ inicial:27200, final:27201 })] });
  ok('el mismo código escrito distinto (vol-048) comparte el contador', u.error==='rate_limit');
  // 200/hora global
  const c3=cargarObra();
  for(let i=0;i<200;i++) c3._cache.put('rl:global:parte:reporte:'+Math.floor(Date.now()/3600000), String(i+1));
  u=post(c3,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[tramo({ inicial:27120, final:27121 })] });
  ok('con 200 envíos globales en la hora, el siguiente → rate_limit (cualquier equipo)', u.error==='rate_limit');
  // revisión con token: pasa por la puerta (genérico + LOG) y valida cambios
  const c4=cargarObra(); const tokA=tokenDe(c4,'admin','admin');
  post(c4,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[tramo({ inicial:27120, final:27250, id_registro:'fila-1' })] });
  let v=post(c4,{ mod:'parte', op:'revisar', cambios:[{ id_registro:'fila-1', estado:'aprobado' }] });
  ok('revisar sin token → genérico', v.auth===false && v.error==='Sesión no válida. Vuelve a entrar.');
  v=post(c4,{ mod:'parte', op:'revisar', token:tokA, cambios:[{ id_registro:'fila-1', campos:{ final:'muchos' } }] });
  ok('revisar con campo mal tipado → payload/cambios[0].campos.final', v.error==='payload' && v.campo==='cambios[0].campos.final', JSON.stringify(v));
  v=post(c4,{ mod:'parte', op:'revisar', token:tokA, cambios:[{ id_registro:'fila-1', estado:'aprobado' }] });
  ok('revisar bien formado aprueba y queda en LOG con el usuario del token', v.ok===true && v.cambiadas===1 && ultimaLog(c4)[1]==='admin' && ultimaLog(c4)[3]==='parte:revisar');
  const b=get(c4,{ mod:'parte', op:'bandeja', fecha:HOY, token:tokA });
  ok('bandeja con token sigue funcionando', b.ok===true && b.revisadas.length===1);
}

console.log('\n'+(fallos ? ('✗ '+fallos+' de '+casos+' comprobaciones fallaron') : ('✓ '+casos+' comprobaciones pasan')));
process.exit(fallos ? 1 : 0);
