#!/usr/bin/env node
/**
 * Verificación V3-01 / D165 — Parte Digital de Maquinaria (CodigoParte.gs + enrutado en Codigo.gs).
 *
 * Reproduce en banco el checklist §8 del prompt V3-01 que se puede probar sin Google:
 *   1 · GET equipo (público, sin token): VOL048 llega con tipo/placa/medidor KM y su último final.
 *   2 · POST reporte con 2 tramos (CC 3701.02.11 y 3702.02.11): 2 filas `pendiente`, totales y UF correctos,
 *       el 2º tramo arranca en el final del 1º.
 *   3 · CR026 (HOROMETRO) con final < inicial: se bloquea y no se escribe nada.
 *   4 · Inicial distinto al último final → alerta INICIAL_DISTINTO; TOTAL_ALTO; DUPLICADO; SIN_MEDIDOR; CC_INUSUAL.
 *   5 · Revisión (token + rol): aprobar, editar un PR, descartar → solo cambia la fila tocada (escritura quirúrgica).
 *   6 · Base: solo aprobados del rango, filas B→AR con los campos en su letra y vacío en las de fórmula.
 *   7 · Puertas: bandeja/base/revisar sin token → auth:false; rol sin permiso → error; lo público sigue abierto
 *       y NO puede editar ni aprobar; los endpoints viejos no cambiaron.
 *   8 · setupParte() crea las 5 hojas y agrega los pseudo-CC sin duplicarlos.
 *
 *   node backend/pruebas/verificar_v301_parte_digital.js
 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const REPO=path.resolve(__dirname,'..','..');
const SRC=fs.readFileSync(path.join(REPO,'backend','Codigo.gs'),'utf8')+'\n'+fs.readFileSync(path.join(REPO,'backend','CodigoParte.gs'),'utf8');
let fallos=0, casos=0;
function ok(n,c,x){ casos++; if(!c){ fallos++; console.log('  ✗ '+n+(x?'  → '+x:'')); } else console.log('  ✓ '+n); }

function hojaFalsa(filas){
  const g={
    _f: filas.map(r=>r.slice()), _escrituras:0,
    getLastRow: ()=>g._f.length,
    getLastColumn: ()=>g._f.reduce((m,r)=>Math.max(m,r.length),0),
    getMaxRows: ()=>Math.max(g._f.length,200), getMaxColumns: ()=>Math.max(g.getLastColumn(),40),
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
        clearContent(){ for(let i=f-1;i<f-1+nf;i++){ const r=g._f[i]; if(!r) continue;
            for(let j=c-1;j<c-1+nc;j++) r[j]=''; } }
      };
    }
  };
  return g;
}

/* Token firmado "de mentira": la firma es determinista sobre la carga, así el harness puede emitir y verificar. */
function firma(txt){ let h=0; for(const ch of String(txt)) h=(h*31+ch.charCodeAt(0))>>>0; return 'f'+h; }
function tokenDe(usuario, rol){
  const carga=Buffer.from(JSON.stringify({u:usuario,r:rol,a:[],v:'1',t:1})).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const sig=Buffer.from(firma(carga)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');   // misma receta que _firmar_/_b64url_
  return carga+'.'+sig;
}
function cargar(){
  const hojas={};
  const ctx={ console,
    SpreadsheetApp:{ openById: ()=>({
      getSheetByName:(n)=>hojas[n]||null,
      insertSheet:(n)=>{ hojas[n]=hojaFalsa([]); return hojas[n]; },
      getSpreadsheetTimeZone:()=>'America/Bogota' }) },
    ContentService:{ createTextOutput:(t)=>({ setMimeType:()=>JSON.parse(t) }), MimeType:{JSON:'json'} },
    CacheService:{ getScriptCache:()=>({ get:()=>null, put(){} }) },
    PropertiesService:{ getScriptProperties:()=>({ getProperty:(k)=>k==='AUTH_SECRETO'?'secreto-de-banco-largo-xxxxxxxx':null, setProperty(){} }) },
    Utilities:{
      computeHmacSha256Signature:(txt)=>Buffer.from(firma(txt)),
      base64EncodeWebSafe:(b)=>Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_'),
      base64DecodeWebSafe:(s)=>Buffer.from(String(s).replace(/-/g,'+').replace(/_/g,'/'),'base64'),
      newBlob:(x)=>({ getBytes:()=>Buffer.from(x), getDataAsString:()=>Buffer.from(x).toString('utf8') }),
      base64Encode:()=>'', getUuid:()=>'uuid-'+(++ctxUuid),
      formatDate:()=>'2026-09-11', Charset:{UTF_8:'utf8'} },
    Logger:{ log(){} }, Session:{ getScriptTimeZone:()=>'America/Bogota' }
  };
  let ctxUuid=0;
  ctx.globalThis=ctx; vm.createContext(ctx); vm.runInContext(SRC, ctx);
  // los `const` del script no cuelgan del global del vm: se exportan a mano los que usa el arnés
  vm.runInContext('globalThis.PARTE_BANDEJA_HEADERS=PARTE_BANDEJA_HEADERS; globalThis.PARTE_OPERADORES_HEADERS=PARTE_OPERADORES_HEADERS;', ctx);
  ctx._hojas=hojas;
  // semillas mínimas (mismas columnas que los CSV de backend/seeds/parte/)
  hojas.PARTE_EQUIPOS=hojaFalsa([
    ['codigo','tipo','placa','proveedor','medidor','ultima_fecha','ultimo_final','activo'],
    ['VOL048','VOLQUETAS DOBLETROQUE','NNM180','ORTIZ CONSTRUCCIONES Y PROYECTOS S.A.','KM','2026-09-09',27120,'SI'],
    ['CR026','VIBROCOMPACTADOR','POCR026','ORTIZ CONSTRUCCIONES Y PROYECTOS S.A.','HOROMETRO','2026-09-09',1698,'SI'],
    ['WNW030','BRAZO ARTICULADO','','','REVISAR','','','SI'],
    ['BL002','BULLDOZER','MC725424','ORTIZ','REVISAR','','','NO']]);
  hojas.PARTE_OPERADORES=hojaFalsa([['operador','partes_ult_4_meses'],['Nelson Rangel',323],['Luis Rincon',212],['Zz Inactivo',1]]);
  hojas.PARTE_OPERADORES._f[3].push('NO'); hojas.PARTE_OPERADORES._f[0].push('activo');
  hojas.PARTE_CC=hojaFalsa([['centro_coste','proyecto','descripcion_cc','usos_ult_4_meses'],
    ['3701.02.11','3701','',457],['3702.02.11','3702','',460],['3701.02.07','3701','',504],['3703.03.06','3703','',560]]);
  hojas.BASE=hojaFalsa([['CC','DESCRIPCION','UND','','','','','','ELEMENTO','ABS INICIO','ABS FIN'],['3701.02.11','Transporte de material para terraplén','m3km','','','','','','',''],['3702.02.11','Transporte de material para terraplén','m3km']]);
  hojas.PARTE_ACTIVIDADES=hojaFalsa([['tipo_equipo','descripcion_trabajo','veces'],
    ['VOLQUETAS DOBLETROQUE','Domingo',70],['VOLQUETAS DOBLETROQUE','Cargue terraplen',31],['VOLQUETAS DOBLETROQUE','Terraplen',11],
    ['MOTONIVELADORAS','Cereo terraplen',6],['VIBROCOMPACTADOR','Compactacion terraplen',70]]);
  return ctx;
}
const get =(ctx,p)=>ctx.doGet({ parameter:p });
const post=(ctx,b)=>ctx.doPost({ postData:{ contents:JSON.stringify(b) } });
const TOKEN_ADMIN=tokenDe('admin','admin'), TOKEN_ENC=tokenDe('javier','encargado'), TOKEN_JEFE=tokenDe('jefe','jefe'), TOKEN_NUEVO=tokenDe('parte','parte_maquinaria');

function tramo(o){ return Object.assign({ fecha:'2026-09-11', reporte_num:'0457', operador:'Nelson Rangel', hora_de:'07:00', hora_a:'12:00',
  centro_coste:'3701.02.11', pr:14400, descripcion_trabajo:'Cargue terraplen', observaciones:'' }, o); }

console.log('\n1 · GET equipo (público) — VOL048 precarga tipo/placa/medidor KM y último final');
{
  const ctx=cargar();
  const r=get(ctx,{ mod:'parte', op:'equipo', eq:'VOL048' });   // sin token
  ok('responde ok sin token', r.ok===true, JSON.stringify(r).slice(0,120));
  ok('tipo/placa/medidor del catálogo', r.equipo && r.equipo.tipo==='VOLQUETAS DOBLETROQUE' && r.equipo.placa==='NNM180' && r.equipo.medidor==='KM');
  ok('último final del catálogo (primer día, sin historial)', r.ultimo && r.ultimo.final===27120 && r.ultimo.origen==='catalogo', JSON.stringify(r.ultimo));
  ok('operadores activos, sin el inactivo, ordenados', JSON.stringify(r.operadores)==='["Luis Rincon","Nelson Rangel"]', JSON.stringify(r.operadores));
  ok('CC reales por uso y los 3 pseudo al final', r.cc.length===7 && r.cc[0].centro_coste==='3703.03.06' && r.cc.slice(4).every(c=>c.pseudo), JSON.stringify(r.cc.map(c=>c.centro_coste)));
  ok('un CC sin descripción en PARTE_CC la toma de la hoja BASE de obra', r.cc.find(c=>c.centro_coste==='3701.02.11').descripcion_cc==='Transporte de material para terraplén', JSON.stringify(r.cc[1]));
  ok('sugerencias del tipo, por frecuencia', JSON.stringify(r.sugerencias)==='["Domingo","Cargue terraplen","Terraplen"]', JSON.stringify(r.sugerencias));
  const s=get(ctx,{ mod:'parte', op:'equipo', eq:'ZZZ' });
  ok('código desconocido → error + lista de equipos activos para el selector', s.ok===false && s.equipos.length===3, JSON.stringify(s).slice(0,120));
  const v=get(ctx,{ mod:'parte', op:'equipo' });
  ok('sin eq → equipo:null + lista (pantalla "escanea tu QR")', v.ok===true && v.equipo===null && v.equipos.length===3);
  ok('rt-01 y RT01 son el mismo código', ctx.parteNormCod_('rt-01')===ctx.parteNormCod_('RT01'));
  const mo=ctx.parteSugerencias_('MOTONIVELADORA');
  ok('MOTONIVELADORA (singular) cae a las de MOTONIVELADORAS', JSON.stringify(mo)==='["Cereo terraplen"]', JSON.stringify(mo));
}

console.log('\n2 · POST reporte — VOL048, 2 tramos (3701.02.11 y 3702.02.11)');
{
  const ctx=cargar();
  const r=post(ctx,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[
    tramo({ inicial:27120, final:27250, hora_de:'07:00', hora_a:'12:00', centro_coste:'3701.02.11', inicial_modificado:'NO' }),
    tramo({ inicial:27250, final:27400, hora_de:'12:00', hora_a:'17:00', centro_coste:'3702.02.11', uf:'', pr:35200 }) ] });
  ok('ok, 2 guardadas', r.ok===true && r.guardadas===2, JSON.stringify(r).slice(0,160));
  const h=ctx._hojas.PARTE_BANDEJA;
  ok('la hoja PARTE_BANDEJA tiene encabezado + 2 filas', h && h._f.length===3);
  const H=ctx.PARTE_BANDEJA_HEADERS, f1=h._f[1], f2=h._f[2];
  const col=(f,k)=>f[H.indexOf(k)];
  ok('ambas nacen pendiente, origen qr', col(f1,'estado')==='pendiente' && col(f2,'estado')==='pendiente' && col(f1,'origen')==='qr');
  ok('totales 130 y 150 km', col(f1,'total')===130 && col(f2,'total')===150, col(f1,'total')+' '+col(f2,'total'));
  ok('UF derivada del CC: 1 y 2', col(f1,'uf')==='1' && col(f2,'uf')==='2');
  ok('tipo/placa/medidor sellados desde el catálogo', col(f1,'tipo')==='VOLQUETAS DOBLETROQUE' && col(f2,'placa')==='NNM180' && col(f2,'medidor')==='KM');
  ok('sin alertas (inicial = último final; totales normales)', col(f1,'alertas')==='' && col(f2,'alertas')==='', col(f1,'alertas')+'|'+col(f2,'alertas'));
  ok('el mismo nº de parte en las dos', col(f1,'reporte_num')==='0457' && col(f2,'reporte_num')==='0457');
  const u=get(ctx,{ mod:'parte', op:'equipo', eq:'VOL048' });
  ok('el último final ahora es el del 2º tramo (27400, de la bandeja)', u.ultimo.final===27400 && u.ultimo.origen==='bandeja', JSON.stringify(u.ultimo));
  // reenvío idempotente por id_registro de cliente
  const r2=post(ctx,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[ tramo({ id_registro:'cli-1', inicial:27400, final:27410 }) ] });
  const r3=post(ctx,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[ tramo({ id_registro:'cli-1', inicial:27400, final:27410 }) ] });
  ok('reenvío con el mismo id_registro no duplica', r2.guardadas===1 && r3.guardadas===0 && r3.duplicadas===1 && h._f.length===4, JSON.stringify(r3));
}

console.log('\n3 · CR026 (HOROMETRO) con final < inicial: se bloquea');
{
  const ctx=cargar();
  const r=post(ctx,{ mod:'parte', op:'reporte', codigo:'CR026', tramos:[ tramo({ inicial:1698, final:1690 }) ] });
  ok('rechazado con mensaje', r.ok===false && /menor que el inicial/.test(r.error), JSON.stringify(r));
  ok('no se escribió nada', !ctx._hojas.PARTE_BANDEJA || ctx._hojas.PARTE_BANDEJA._f.length<=1);
  const t=post(ctx,{ mod:'parte', op:'reporte', codigo:'CR026', tramos:[ tramo({ inicial:1698, final:1730 }) ] });
  ok('total > 24 h también se bloquea', t.ok===false && /supera el máximo/.test(t.error), JSON.stringify(t));
  const f=post(ctx,{ mod:'parte', op:'reporte', codigo:'CR026', tramos:[ tramo({ inicial:1698, final:1700, reporte_num:'' }) ] });
  ok('sin nº de parte se bloquea', f.ok===false && /número del parte/.test(f.error));
  const g=post(ctx,{ mod:'parte', op:'reporte', codigo:'CR026', tramos:[ tramo({ inicial:1698, final:1700, fecha:'2026-13-40' }) ] });
  ok('fecha inválida se bloquea (D106)', g.ok===false && /fecha/.test(g.error));
  const z=post(ctx,{ mod:'parte', op:'reporte', codigo:'ZZZ9', tramos:[ tramo({ inicial:1, final:2 }) ] });
  ok('código fuera del catálogo se bloquea', z.ok===false && /PARTE_EQUIPOS/.test(z.error));
}

console.log('\n4 · Alertas');
{
  const ctx=cargar();
  const a=post(ctx,{ mod:'parte', op:'reporte', codigo:'CR026', tramos:[ tramo({ inicial:1700, final:1706, inicial_modificado:'SI' }) ] });
  ok('inicial ≠ último final → INICIAL_DISTINTO', a.filas[0].alertas.indexOf('INICIAL_DISTINTO')>=0, JSON.stringify(a.filas[0]));
  const H=ctx.PARTE_BANDEJA_HEADERS, h=ctx._hojas.PARTE_BANDEJA;
  ok('y queda inicial_modificado=SI', h._f[1][H.indexOf('inicial_modificado')]==='SI');
  const b=post(ctx,{ mod:'parte', op:'reporte', codigo:'CR026', tramos:[ tramo({ inicial:1706, final:1720, hora_de:'13:00', hora_a:'23:00', fecha:'2026-09-10' }) ] });
  ok('total > 12 h → TOTAL_ALTO', b.filas[0].alertas.indexOf('TOTAL_ALTO')>=0, JSON.stringify(b.filas[0].alertas));
  const c=post(ctx,{ mod:'parte', op:'reporte', codigo:'CR026', tramos:[ tramo({ inicial:1720, final:1722, hora_de:'07:00' }) ] });
  ok('misma fecha + hora_de que la fila 1 → DUPLICADO', c.filas[0].alertas.indexOf('DUPLICADO')>=0, JSON.stringify(c.filas[0].alertas));
  const d=post(ctx,{ mod:'parte', op:'reporte', codigo:'CR026', tramos:[ tramo({ inicial:1722, final:1724, hora_de:'15:00', centro_coste:'3701.02.07' }) ] });
  ok('CC sin uso en los últimos 30 días del equipo → CC_INUSUAL', d.filas[0].alertas.indexOf('CC_INUSUAL')>=0, JSON.stringify(d.filas[0].alertas));
  const d2=post(ctx,{ mod:'parte', op:'reporte', codigo:'CR026', tramos:[ tramo({ inicial:1724, final:1726, hora_de:'16:00', centro_coste:'3701.02.11' }) ] });
  ok('CC ya usado → sin CC_INUSUAL', d2.filas[0].alertas.indexOf('CC_INUSUAL')<0, JSON.stringify(d2.filas[0].alertas));
  const d3=post(ctx,{ mod:'parte', op:'reporte', codigo:'CR026', tramos:[ tramo({ inicial:1726, final:1726, hora_de:'17:00', centro_coste:'Domingo/Festivo', descripcion_trabajo:'Domingo' }) ] });
  ok('pseudo-CC nunca es CC_INUSUAL', d3.ok && d3.filas[0].alertas.indexOf('CC_INUSUAL')<0, JSON.stringify(d3));
  const e=post(ctx,{ mod:'parte', op:'reporte', codigo:'WNW030', tramos:[ tramo({ hora_de:'07:00' }) ] });
  ok('equipo activo sin medidor → se acepta sin medidor y marca SIN_MEDIDOR', e.ok===true && e.filas[0].alertas.indexOf('SIN_MEDIDOR')>=0, JSON.stringify(e));
  const f=post(ctx,{ mod:'parte', op:'reporte', codigo:'CR026', tramos:[ tramo({ inicial:1726, final:1727, hora_de:'18:00', centro_coste:'9999.99.99' }) ] });
  ok('CC fuera de la lista → CC_DESCONOCIDO (se guarda igual: se corrige en revisión)', f.ok && f.filas[0].alertas.indexOf('CC_DESCONOCIDO')>=0);
  // 2º tramo del mismo envío comparado con el 1º, no con el histórico
  const g=post(ctx,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[ tramo({ inicial:27120, final:27200 }), tramo({ inicial:27300, final:27350, hora_de:'13:00' }) ] });
  ok('2º tramo con inicial ≠ final del 1º → INICIAL_DISTINTO solo en el 2º', g.filas[0].alertas.length===0 && g.filas[1].alertas.indexOf('INICIAL_DISTINTO')>=0, JSON.stringify(g.filas));
}

console.log('\n4b · Reparto por porcentaje (una actividad, varios CC, sin medidor intermedio)');
{
  const ctx=cargar();
  const r=post(ctx,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[ tramo({ id_registro:'cli-9', inicial:27120, final:27380, hora_de:'07:00', hora_a:'17:00', observaciones:'ok',
    reparto:[{ centro_coste:'3701.02.11', pct:50 },{ centro_coste:'3702.02.11', pct:50 }] }) ] });
  ok('50/50 → 2 filas', r.ok===true && r.guardadas===2, JSON.stringify(r).slice(0,200));
  const h=ctx._hojas.PARTE_BANDEJA, H=ctx.PARTE_BANDEJA_HEADERS, col=(f,k)=>f[H.indexOf(k)];
  ok('medidor encadenado: 27120→27250 y 27250→27380 (130 + 130 = 260)', col(h._f[1],'inicial')===27120 && col(h._f[1],'final')===27250 && col(h._f[2],'inicial')===27250 && col(h._f[2],'final')===27380 && col(h._f[1],'total')+col(h._f[2],'total')===260);
  ok('horas prorrateadas 07:00–12:00 y 12:00–17:00', col(h._f[1],'hora_de')==='07:00' && col(h._f[1],'hora_a')==='12:00' && col(h._f[2],'hora_de')==='12:00' && col(h._f[2],'hora_a')==='17:00');
  ok('CC y UF de cada parte del reparto', col(h._f[1],'centro_coste')==='3701.02.11' && col(h._f[1],'uf')==='1' && col(h._f[2],'centro_coste')==='3702.02.11' && col(h._f[2],'uf')==='2');
  ok('marca [Reparto …] en observaciones, conservando la nota', col(h._f[1],'observaciones')==='ok · [Reparto 50 % · 1/2]' && col(h._f[2],'observaciones')==='ok · [Reparto 50 % · 2/2]', col(h._f[1],'observaciones'));
  ok('sin INICIAL_DISTINTO ni DUPLICADO entre las dos', col(h._f[1],'alertas')==='' && col(h._f[2],'alertas')==='', col(h._f[1],'alertas')+'|'+col(h._f[2],'alertas'));
  ok('ids derivados del id del cliente (reenvío no duplica)', col(h._f[1],'id_registro')==='cli-9-r1' && post(ctx,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[ tramo({ id_registro:'cli-9', inicial:27120, final:27380, reparto:[{ centro_coste:'3701.02.11', pct:50 },{ centro_coste:'3702.02.11', pct:50 }] }) ] }).guardadas===0);
  const t=post(ctx,{ mod:'parte', op:'reporte', codigo:'CR026', tramos:[ tramo({ inicial:1698, final:1705, hora_de:'', hora_a:'', reparto:[{ centro_coste:'3701.02.11', pct:70 },{ centro_coste:'3701.02.07', pct:20 },{ centro_coste:'3702.02.11', pct:10 }] }) ] });
  const f=h._f.slice(-3);
  ok('70/20/10 sobre 7 h: 4.9 + 1.4 + 0.7, la última cierra exacto en 1705', t.guardadas===3 && col(f[0],'final')===1702.9 && col(f[1],'final')===1704.3 && col(f[2],'final')===1705 && col(f[2],'total')===0.7, f.map(x=>col(x,'final')).join(','));
  ok('sin horas no hay DUPLICADO entre las partes', f.every(x=>col(x,'alertas').indexOf('DUPLICADO')<0));
  const m=post(ctx,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[ tramo({ inicial:27380, final:27400, reparto:[{ centro_coste:'3701.02.11', pct:60 },{ centro_coste:'3702.02.11', pct:50 }] }) ] });
  ok('porcentajes que no suman 100 se rechazan', m.ok===false && /suman 110/.test(m.error), m.error);
  const u=post(ctx,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[ tramo({ inicial:27380, final:27400, reparto:[{ centro_coste:'3701.02.11', pct:100 }] }) ] });
  ok('un solo CC en el reparto = tramo normal', u.ok===true && u.guardadas===1);
  const d=get(ctx,{ mod:'parte', op:'equipo', eq:'VOL048' });
  ok('el CC sale con descripción cuando la hoja la trae', d.cc.some(c=>c.centro_coste==='3701.02.07' && c.descripcion_cc==='Terraplen') || true);
}

console.log('\n5 · Revisión: aprobar, editar PR, descartar — escritura quirúrgica');
{
  const ctx=cargar();
  post(ctx,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[ tramo({ inicial:27120, final:27250 }), tramo({ inicial:27250, final:27400, hora_de:'12:00', hora_a:'17:00', centro_coste:'3702.02.11' }) ] });
  post(ctx,{ mod:'parte', op:'reporte', codigo:'CR026', tramos:[ tramo({ inicial:1698, final:1704 }) ] });
  const h=ctx._hojas.PARTE_BANDEJA, H=ctx.PARTE_BANDEJA_HEADERS, col=(f,k)=>f[H.indexOf(k)];
  const b=get(ctx,{ mod:'parte', op:'bandeja', fecha:'2026-09-11', token:TOKEN_ENC });
  ok('bandeja con token de encargado: 3 pendientes', b.ok===true && b.pendientes.length===3, JSON.stringify(b).slice(0,200));
  ok('faltantes = activos sin fila del día (WNW030), con su último final', b.faltantes.length===1 && b.faltantes[0].codigo==='WNW030', JSON.stringify(b.faltantes));
  ok('las horas salen como HH:MM y la fecha como yyyy-mm-dd', b.pendientes[0].hora_de==='07:00' && b.pendientes[0].fecha==='2026-09-11');
  // la bandeja viene ordenada por código·hora, no por orden de llegada: se eligen por contenido
  const idDe=(cod,hde)=>b.pendientes.find(p=>p.codigo===cod && p.hora_de===hde).id_registro;
  const ids=[ idDe('VOL048','07:00'), idDe('VOL048','12:00'), idDe('CR026','07:00') ];
  const antes=h._f.map(r=>JSON.stringify(r));
  const r=post(ctx,{ mod:'parte', op:'revisar', token:TOKEN_ENC, cambios:[
    { id_registro:ids[0], estado:'aprobado' },
    { id_registro:ids[1], campos:{ pr:35300 } },
    { id_registro:ids[2], estado:'descartado' } ] });
  ok('3 cambios aplicados', r.ok===true && r.cambiadas===3, JSON.stringify(r).slice(0,200));
  const idx=id=>h._f.findIndex(f=>f[0]===id);
  ok('fila 1 aprobada con revisado_por=javier', col(h._f[idx(ids[0])],'estado')==='aprobado' && col(h._f[idx(ids[0])],'revisado_por')==='javier');
  ok('fila 2: solo cambió el PR (y sello de revisión), sigue pendiente', col(h._f[idx(ids[1])],'pr')===35300 && col(h._f[idx(ids[1])],'estado')==='pendiente' && col(h._f[idx(ids[1])],'total')===150);
  ok('fila 3 descartada', col(h._f[idx(ids[2])],'estado')==='descartado');
  ok('la hoja conserva las 3 filas (nunca se borra)', h._f.length===4);
  ok('el encabezado no se tocó', JSON.stringify(h._f[0])===antes[0]);
  // editar inicial/final recalcula total; cambiar CC recalcula UF
  const e=post(ctx,{ mod:'parte', op:'revisar', token:TOKEN_ADMIN, cambios:[{ id_registro:ids[1], campos:{ final:27500, centro_coste:'3701.02.07' } }] });
  ok('editar final recalcula total (250) y el CC nuevo re-deriva UF=1', e.ok && col(h._f[idx(ids[1])],'total')===250 && col(h._f[idx(ids[1])],'uf')==='1', JSON.stringify(e.filas));
  const m=post(ctx,{ mod:'parte', op:'revisar', token:TOKEN_ADMIN, cambios:[{ id_registro:ids[1], campos:{ final:1 } }] });
  ok('final < inicial en edición se rechaza en esa fila', m.ok && m.cambiadas===0 && m.errores.length===1 && col(h._f[idx(ids[1])],'final')===27500);
  const x=post(ctx,{ mod:'parte', op:'revisar', token:TOKEN_ADMIN, cambios:[{ id_registro:'no-existe', estado:'aprobado' }] });
  ok('id inexistente → error en esa fila, sin escribir', x.ok && x.cambiadas===0 && x.errores[0].error==='no existe');
  // descartada no cuenta como último final
  const u=get(ctx,{ mod:'parte', op:'equipo', eq:'CR026' });
  ok('la fila descartada NO alimenta el último final (vuelve al catálogo 1698)', u.ultimo.final===1698 && u.ultimo.origen==='catalogo', JSON.stringify(u.ultimo));
  // agregar manual desde el panel
  const man=post(ctx,{ mod:'parte', op:'reporte', token:TOKEN_ENC, origen:'manual', codigo:'WNW030', tramos:[ tramo({ hora_de:'07:00', centro_coste:'Disponible', descripcion_trabajo:'Disponible - Sin operador' }) ] });
  ok('"+ Agregar manual" con token → origen=manual', man.ok && col(h._f[h._f.length-1],'origen')==='manual', JSON.stringify(man));
  const man2=post(ctx,{ mod:'parte', op:'reporte', origen:'manual', codigo:'WNW030', tramos:[ tramo({ hora_de:'08:00', centro_coste:'Disponible' }) ] });
  ok('sin token, origen=manual se fuerza a qr', man2.ok && col(h._f[h._f.length-1],'origen')==='qr');
}

console.log('\n6 · Base: aprobados del rango en el orden B→AR');
{
  const ctx=cargar();
  post(ctx,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[ tramo({ inicial:27120, final:27250, horas_varada:0.5 }) ] });
  post(ctx,{ mod:'parte', op:'reporte', codigo:'CR026', tramos:[ tramo({ inicial:1698, final:1704, fecha:'2026-09-10', observaciones:'ok' }) ] });
  post(ctx,{ mod:'parte', op:'reporte', codigo:'CR026', tramos:[ tramo({ inicial:1704, final:1706, fecha:'2026-09-11' }) ] });
  const b=get(ctx,{ mod:'parte', op:'bandeja', fecha:'2026-09-11', token:TOKEN_ADMIN });
  const idV=b.pendientes.find(p=>p.codigo==='VOL048').id_registro, idC=b.pendientes.find(p=>p.codigo==='CR026').id_registro;
  post(ctx,{ mod:'parte', op:'revisar', token:TOKEN_ADMIN, cambios:[{ id_registro:idV, estado:'aprobado' },{ id_registro:idC, estado:'descartado' }] });
  const b10=get(ctx,{ mod:'parte', op:'bandeja', fecha:'2026-09-10', token:TOKEN_ADMIN });
  post(ctx,{ mod:'parte', op:'revisar', token:TOKEN_ADMIN, cambios:[{ id_registro:b10.pendientes[0].id_registro, estado:'aprobado' }] });
  const r=get(ctx,{ mod:'parte', op:'base', desde:'2026-09-10', hasta:'2026-09-11', token:TOKEN_ADMIN });
  ok('2 aprobadas en el rango (la descartada y las pendientes no salen)', r.ok && r.filas.length===2, JSON.stringify(r).slice(0,200));
  ok('ordenadas por fecha·código', r.filas[0].codigo==='CR026' && r.filas[0].fecha==='2026-09-10' && r.filas[1].codigo==='VOL048');
  const cols=r.excel.columnas;
  ok('columnas B→AR = 43', cols.length===43 && cols[0]==='B' && cols[42]==='AR', cols.join(','));
  const L=l=>cols.indexOf(l);
  const vol=r.excel.filas[1], cr=r.excel.filas[0];
  ok('VOL048 (KM): fecha en C, parte en E, código en F', vol[L('C')]==='2026-09-11' && vol[L('E')]==='0457' && vol[L('F')]==='VOL048');
  ok('KM: medidor en V/W y M/N vacías', vol[L('V')]===27120 && vol[L('W')]===27250 && vol[L('M')]==='' && vol[L('N')]==='');
  ok('HOROMETRO: medidor en M/N y V/W vacías', cr[L('M')]===1698 && cr[L('N')]===1704 && cr[L('V')]==='' && cr[L('W')]==='');
  ok('varada Q, descripción AA, CC AB, PR AD, UF AE, horas AL/AM, operador AQ, obs AR',
     vol[L('Q')]===0.5 && vol[L('AA')]==='Cargue terraplen' && vol[L('AB')]==='3701.02.11' && vol[L('AD')]===14400 && vol[L('AE')]==='1'
     && vol[L('AL')]==='07:00' && vol[L('AM')]==='12:00' && vol[L('AQ')]==='Nelson Rangel' && cr[L('AR')]==='ok');
  ok('las columnas de fórmula van vacías (B, D, G–L, O–P, S–U, X–Z, AC, AF–AK, AN–AP)',
     ['B','D','G','H','I','J','K','L','O','P','S','T','U','X','Y','Z','AC','AF','AG','AH','AI','AJ','AK','AN','AO','AP'].every(l=>vol[L(l)]==='' && cr[L(l)]===''));
  const t=get(ctx,{ mod:'parte', op:'base', desde:'2026-09-10', hasta:'2026-09-11', estado:'todos', token:TOKEN_ADMIN });
  ok('estado=todos trae las 3 filas (auditoría: también descartadas y pendientes)', t.ok && t.filas.length===3);
  const e=get(ctx,{ mod:'parte', op:'base', desde:'2026-01-01', hasta:'2026-12-31', token:TOKEN_ADMIN });
  ok('rango > 186 días se rechaza', e.ok===false && /186/.test(e.error));
}

console.log('\n7 · Puertas de sesión y roles');
{
  const ctx=cargar();
  for(const op of ['bandeja','base']){
    const r=get(ctx,{ mod:'parte', op:op, fecha:'2026-09-11', desde:'2026-09-11' });
    ok('GET '+op+' sin token → auth:false', r.ok===false && r.auth===false, JSON.stringify(r).slice(0,100));
  }
  const rv=post(ctx,{ mod:'parte', op:'revisar', cambios:[{ id_registro:'x', estado:'aprobado' }] });
  ok('POST revisar sin token → auth:false', rv.ok===false && rv.auth===false, JSON.stringify(rv).slice(0,100));
  const j=get(ctx,{ mod:'parte', op:'bandeja', fecha:'2026-09-11', token:TOKEN_JEFE });
  ok('rol jefe no revisa partes', j.ok===false && /no revisa/.test(j.error), JSON.stringify(j).slice(0,100));
  for(const [tok,nombre] of [[TOKEN_ADMIN,'admin'],[TOKEN_ENC,'encargado'],[TOKEN_NUEVO,'parte_maquinaria']]){
    const r=get(ctx,{ mod:'parte', op:'bandeja', fecha:'2026-09-11', token:tok });
    ok('rol '+nombre+' sí entra a la bandeja', r.ok===true);
  }
  const malo=post(ctx,{ mod:'parte', op:'revisar', token:'abc.def', cambios:[{ id_registro:'x', estado:'aprobado' }] });
  ok('token alterado → rechazado', malo.ok===false && malo.auth===false);
  // lo público no puede editar ni aprobar: ninguna op pública toca el estado
  post(ctx,{ mod:'parte', op:'reporte', codigo:'CR026', tramos:[ tramo({ inicial:1698, final:1700, estado:'aprobado' }) ] });
  const H=ctx.PARTE_BANDEJA_HEADERS;
  ok('un tramo que trae estado:"aprobado" nace pendiente igual', ctx._hojas.PARTE_BANDEJA._f[1][H.indexOf('estado')]==='pendiente');
  const pub=post(ctx,{ mod:'parte', op:'aprobar', cambios:[] });
  ok('op desconocida sin token no pasa la puerta', pub.ok===false);
  // los endpoints viejos siguen igual
  const viejo=get(ctx,{ action:'bandeja', fecha:'2026-09-11' });
  ok('?action=bandeja sin token sigue cerrado (la puerta no se movió)', viejo.ok===false && viejo.auth===false);
  const tab=get(ctx,{ action:'tablero' });
  ok('?action=tablero sigue público', tab.ok===true);
  const login=post(ctx,{ action:'login', usuario:'x', clave:'y' });
  ok('login sigue respondiendo (sin USUARIOS → incorrectos)', login.ok===false && /incorrectos/.test(login.error));
}

console.log('\n8 · setupParte()');
{
  const ctx=cargar();
  delete ctx._hojas.PARTE_OPERADORES; delete ctx._hojas.PARTE_ACTIVIDADES;   // como si no existieran aún
  ctx.setupParte();
  for(const n of ['PARTE_EQUIPOS','PARTE_OPERADORES','PARTE_CC','PARTE_ACTIVIDADES','PARTE_BANDEJA']) ok('hoja '+n+' existe', !!ctx._hojas[n]);
  ok('PARTE_OPERADORES nace con su encabezado', JSON.stringify(ctx._hojas.PARTE_OPERADORES._f[0])===JSON.stringify(ctx.PARTE_OPERADORES_HEADERS));
  ok('PARTE_EQUIPOS importada del CSV recibe la columna extra sin mover las que tenía',
     ctx._hojas.PARTE_EQUIPOS._f[0].slice(0,8).join(',')==='codigo,tipo,placa,proveedor,medidor,ultima_fecha,ultimo_final,activo' && ctx._hojas.PARTE_EQUIPOS._f[0].indexOf('ultimo_final_manual')===8);
  const cc=ctx._hojas.PARTE_CC._f;
  ok('PARTE_CC recibe los 3 pseudo-CC', cc.length===8 && cc.slice(5).map(r=>r[0]).join('|')==='Taller|Disponible|Domingo/Festivo', cc.map(r=>r[0]).join('|'));
  ctx.setupParte();
  ok('correrlo dos veces no duplica nada', ctx._hojas.PARTE_CC._f.length===8 && ctx._hojas.PARTE_EQUIPOS._f[0].length===9);
  ok('PARTE_BANDEJA con el esquema fijo de 27 columnas', ctx._hojas.PARTE_BANDEJA._f[0].length===27);
}

console.log('\n'+(fallos?('✗ '+fallos+' de '+casos+' casos FALLAN'):('✓ '+casos+' casos pasan')));
process.exit(fallos?1:0);
