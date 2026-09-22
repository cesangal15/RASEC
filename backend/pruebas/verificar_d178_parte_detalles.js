#!/usr/bin/env node
/**
 * Verificación D178 — detalles del Parte Digital (sep-2026), sobre el backend REAL en banco
 * (mismo arnés que verificar_v301_parte_digital.js: Codigo.gs + CodigoParte.gs en un `vm` con hojas falsas).
 *
 *   1 · Ítems y CC convertidos a NÚMERO por Sheets (2.1 → «02.10», 3701.2.1 → «3701.02.10»).
 *   2 · Solo 5 actividades habituales; el CC derivado con ítem numérico sale bien.
 *   3 · Un parte que llega con «3701.2.1» se guarda normalizado y sin CC_DESCONOCIDO; revisión también normaliza.
 *   4 · Alias de operadores: la lista funde variantes y el parte guarda el canónico.
 *   5 · `jeisson` (rol asistencia_plus) y, desde D193, `duvan` revisan; `residente_uf3` (asistencia_plus_uf3) no.
 *   6 · op=repartir: la original queda descartada, N filas pendientes encadenadas, ids únicos, SIN_CC recalculado.
 *   7 · depurarOperadoresParte(): simulación no toca; aplicar marca variantes NO y corrige la bandeja.
 *
 *   node backend/pruebas/verificar_d178_parte_detalles.js
 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const REPO=path.resolve(__dirname,'..','..');
const SRC=fs.readFileSync(path.join(REPO,'backend','Codigo.gs'),'utf8')+'\n'+fs.readFileSync(path.join(REPO,'backend','CodigoParte.gs'),'utf8');
let fallos=0, casos=0;
function ok(n,c,x){ casos++; if(!c){ fallos++; console.log('  ✗ '+n+(x?'  → '+x:'')); } else console.log('  ✓ '+n); }

function hojaFalsa(filas){
  const g={ _f: filas.map(r=>r.slice()),
    getLastRow: ()=>g._f.length, getLastColumn: ()=>g._f.reduce((m,r)=>Math.max(m,r.length),0),
    getMaxRows: ()=>Math.max(g._f.length,200), getMaxColumns: ()=>Math.max(g.getLastColumn(),40),
    insertRowsAfter(){}, insertColumnsAfter(){}, _fila(i){ while(g._f.length<=i) g._f.push([]); return g._f[i]; },
    getDataRange(){ return g.getRange(1,1,Math.max(g._f.length,1),Math.max(g.getLastColumn(),1)); },
    appendRow(r){ g._f.push(r.slice()); },
    getRange(f,c,nf,nc){ nf=(nf===undefined?1:nf); nc=(nc===undefined?1:nc); return {
      getValues(){ const out=[]; for(let i=f-1;i<f-1+nf;i++){ const r=g._f[i]||[], fila=[]; for(let j=c-1;j<c-1+nc;j++) fila.push(r[j]===undefined?'':r[j]); out.push(fila); } return out; },
      setValues(m){ for(let i=0;i<m.length;i++){ const r=g._fila(f-1+i); for(let j=0;j<m[i].length;j++) r[c-1+j]=m[i][j]; } },
      setNumberFormat(){ g._fmt=(g._fmt||0)+1; return this; },
      setValue(v){ g._fila(f-1)[c-1]=v; },
      clearContent(){ for(let i=f-1;i<f-1+nf;i++){ const r=g._f[i]; if(!r) continue; for(let j=c-1;j<c-1+nc;j++) r[j]=''; } } }; } };
  return g;
}
function firma(txt){ let h=0; for(const ch of String(txt)) h=(h*31+ch.charCodeAt(0))>>>0; return 'f'+h; }
function b64u(b){ return Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function tokenDe(usuario, rol){ const carga=b64u(JSON.stringify({u:usuario,r:rol,a:[],v:'1',t:1})); return carga+'.'+b64u(firma(carga)); }
function cargar(){
  const hojas={}; let n=0;
  const ctx={ console,
    SpreadsheetApp:{ openById: ()=>({ getSheetByName:(x)=>hojas[x]||null, insertSheet:(x)=>{ hojas[x]=hojaFalsa([]); return hojas[x]; }, getSpreadsheetTimeZone:()=>'America/Bogota' }) },
    ContentService:{ createTextOutput:(t)=>({ setMimeType:()=>JSON.parse(t) }), MimeType:{JSON:'json'} },
    CacheService:{ getScriptCache:()=>({ get:()=>null, put(){} }) },
    PropertiesService:{ getScriptProperties:()=>({ getProperty:(k)=>k==='AUTH_SECRETO'?'secreto-de-banco-largo-xxxxxxxx':null, setProperty(){} }) },
    Utilities:{ computeHmacSha256Signature:(txt)=>Buffer.from(firma(txt)), base64EncodeWebSafe:(b)=>Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_'),
      base64DecodeWebSafe:(s)=>Buffer.from(String(s).replace(/-/g,'+').replace(/_/g,'/'),'base64'),
      newBlob:(x)=>({ getBytes:()=>Buffer.from(x), getDataAsString:()=>Buffer.from(x).toString('utf8') }),
      base64Encode:()=>'', getUuid:()=>'uuid-'+(++n), formatDate:()=>'2026-09-16', Charset:{UTF_8:'utf8'} },
    Logger:{ log(){} }, Session:{ getScriptTimeZone:()=>'America/Bogota' } };
  ctx.globalThis=ctx; vm.createContext(ctx); vm.runInContext(SRC, ctx);
  vm.runInContext('globalThis.PARTE_BANDEJA_HEADERS=PARTE_BANDEJA_HEADERS; globalThis.PARTE_MAX_HABITUALES=PARTE_MAX_HABITUALES;', ctx);
  ctx._hojas=hojas;
  hojas.PARTE_EQUIPOS=hojaFalsa([['codigo','tipo','placa','proveedor','medidor','ultima_fecha','ultimo_final','activo'],
    ['VOL048','VOLQUETAS DOBLETROQUE','NNM180','ORTIZ','KM','2026-09-09',27120,'SI'],
    ['MO004','MOTONIVELADORAS','MC725594','ORTIZ','HOROMETRO','2026-09-09',2337,'SI']]);
  // variantes de la MISMA persona (semilla real antes de depurar) + una con tilde
  hojas.PARTE_OPERADORES=hojaFalsa([['operador','partes_ult_4_meses'],['Nelson Rangel',323],['Aleyxer Rincon',124],['Aleyxer Rincón',4],['Wilmar Pahuana',101],['Wilmar Pawana',47],['Wilmer Pahuana',1],['Jan Carlos',15]]);
  // Sheets convirtió «3701.02.10» NO (no es número) pero sí un ítem; aquí simulamos además un CC mal tecleado
  hojas.PARTE_CC=hojaFalsa([['centro_coste','proyecto','descripcion_cc','usos_ult_4_meses'],
    ['3701.02.11','3701','Transporte >1 km',457],['3702.02.11','3702','Transporte >1 km',460],['3701.02.10','3701','Transporte 100 m - 1 km',132],['3702.02.10','3702','Transporte 100 m - 1 km',80],
    ['3701.02.07','3701','Terraplenes',504],['3702.02.07','3702','Terraplenes',300],['3701.03.03','3701','Base granular',172],['3701.03.01','3701','Subbase',100],['3701.05.04','3701','Relleno MSR',50],['3701.02.05','3701','Excavación',20]]);
  // PARTE_ITEMS con el ítem YA convertido a número por Sheets (2.1 = «02.10», 3.3 = «03.30» no existe; 3.03 = «03.03»)
  hojas.PARTE_ITEMS=hojaFalsa([['tipo_equipo','item','actividad','veces','activo'],
    ['VOLQUETAS DOBLETROQUE',2.11,'Cargue terraplen (más de 1 km)',40,'SI'],
    ['VOLQUETAS DOBLETROQUE',2.1,'Cargue terraplen (100 m a 1 km)',9,'SI'],
    ['VOLQUETAS DOBLETROQUE',3.03,'Cargue btc',6,'SI'],
    ['VOLQUETAS DOBLETROQUE',3.01,'Cargue sub base',5,'SI'],
    ['VOLQUETAS DOBLETROQUE',2.05,'Viaje de excavacion',4,'SI'],
    ['VOLQUETAS DOBLETROQUE','02.07','Terraplen',3,'SI'],
    ['VOLQUETAS DOBLETROQUE','05.04','Relleno msr',2,'SI'],
    ['MOTONIVELADORAS',2.07,'Cereo terraplen',18,'SI']]);
  hojas.PARTE_ACTIVIDADES=hojaFalsa([['tipo_equipo','descripcion_trabajo','veces']]);
  return ctx;
}
const get =(ctx,p)=>ctx.doGet({ parameter:p });
const post=(ctx,b,token)=>ctx.doPost({ postData:{ contents:JSON.stringify(token?Object.assign({token:token},b):b) } });
const T_ADMIN=tokenDe('admin','admin'), T_JEISSON=tokenDe('jeisson','asistencia_plus'), T_DUVAN=tokenDe('duvan','asistencia_plus_dren'), T_UF3=tokenDe('residente_uf3','asistencia_plus_uf3');
function tramo(o){ return Object.assign({ fecha:'2026-09-16', reporte_num:'0501', operador:'Nelson Rangel', hora_de:'07:00', hora_a:'15:30',
  centro_coste:'3701.02.11', pr:14400, descripcion_trabajo:'Cargue terraplen', observaciones:'' }, o); }

console.log('\n1 · Normalización de ítems y CC convertidos a número');
{
  const c=cargar();
  ok('2.1 → 02.10', c.parteNormItem_(2.1)==='02.10', c.parteNormItem_(2.1));
  ok('2.01 → 02.01', c.parteNormItem_(2.01)==='02.01');
  ok('3.03 → 03.03 · 11.04 → 11.04 · 2.11 → 02.11', c.parteNormItem_(3.03)==='03.03' && c.parteNormItem_(11.04)==='11.04' && c.parteNormItem_(2.11)==='02.11');
  ok('«02.10» (texto) se respeta · «I0408» se respeta', c.parteNormItem_('02.10')==='02.10' && c.parteNormItem_('I0408')==='I0408');
  ok('«2.1» como texto también se corrige', c.parteNormItem_('2.1')==='02.10');
  ok('3701.2.1 → 3701.02.10 (existe la lectura numérica)', c.parteNormCC_('3701.2.1')==='3701.02.10', c.parteNormCC_('3701.2.1'));
  ok('3702.2.7 → 3702.02.07 (02.70 no existe en PARTE_CC, 02.07 sí: abreviatura humana)', c.parteNormCC_('3702.2.7')==='3702.02.07', c.parteNormCC_('3702.2.7'));
  ok('3701.11.4 → 3701.11.40 (ninguna existe: manda la lectura numérica)', c.parteNormCC_('3701.11.4')==='3701.11.40', c.parteNormCC_('3701.11.4'));
  ok('«3701.02.10», «Taller», «3701.I0408» se respetan', c.parteNormCC_('3701.02.10')==='3701.02.10' && c.parteNormCC_('Taller')==='Taller' && c.parteNormCC_('3701.I0408')==='3701.I0408');
}

console.log('\n2 · Solo 5 habituales; ítems numéricos salen como texto');
{
  const c=cargar();
  const r=get(c,{ mod:'parte', op:'equipo', eq:'VOL048' });
  ok('responde ok', r.ok===true, JSON.stringify(r).slice(0,150));
  ok('exactamente 5 habituales aunque la tabla trae 7 del tipo', r.actividades.habituales.length===5 && c.PARTE_MAX_HABITUALES===5, String(r.actividades.habituales.length));
  ok('ordenadas por uso: 02.11, 02.10, 03.03, 03.01, 02.05', JSON.stringify(r.actividades.habituales.map(a=>a.item))==='["02.11","02.10","03.03","03.01","02.05"]', JSON.stringify(r.actividades.habituales.map(a=>a.item)));
  ok('el ítem 2.1 de la hoja llega como «02.10» con su nombre de catálogo', r.actividades.habituales[1].item==='02.10' && r.actividades.habituales[1].nombre==='Transporte 100 m - 1 km', JSON.stringify(r.actividades.habituales[1]));
  ok('`todas` sigue completa (7 frases del tipo + 1 de moto)', r.actividades.todas.length===8 && r.actividades.todas.every(a=>/^\d\d\.\d\d$/.test(a.item)), JSON.stringify(r.actividades.todas.map(a=>a.item)));
}

console.log('\n3 · Un parte con «3701.2.1» se guarda como 3701.02.10, sin CC_DESCONOCIDO; revisión normaliza');
{
  const c=cargar(), H=c.PARTE_BANDEJA_HEADERS, col=(f,k)=>f[H.indexOf(k)];
  const r=post(c,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[ tramo({ id_registro:'a1', inicial:27120, final:27200, centro_coste:'3701.2.1' }) ] });
  ok('ok', r.ok===true, JSON.stringify(r).slice(0,200));
  const f=c._hojas.PARTE_BANDEJA._f[1];
  ok('CC guardado normalizado y UF 1', col(f,'centro_coste')==='3701.02.10' && col(f,'uf')==='1', col(f,'centro_coste'));
  ok('sin CC_DESCONOCIDO (está en PARTE_CC)', String(col(f,'alertas')).indexOf('CC_DESCONOCIDO')<0, col(f,'alertas'));
  // reparto por % con CC numérico en una de las filas
  const r2=post(c,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[ tramo({ id_registro:'a2', inicial:27200, final:27300, hora_de:'07:00', hora_a:'17:00',
    reparto:[{ centro_coste:'3701.2.1', pct:50 },{ centro_coste:'3702.02.11', pct:50 }] }) ] });
  ok('reparto con CC numérico: dos filas, la primera 3701.02.10', r2.ok && r2.guardadas===2 && col(c._hojas.PARTE_BANDEJA._f[2],'centro_coste')==='3701.02.10', JSON.stringify(r2).slice(0,200));
  // revisión: editar con CC mal escrito
  const e=post(c,{ mod:'parte', op:'revisar', cambios:[{ id_registro:'a1', campos:{ centro_coste:'3702.2.7' } }] }, T_ADMIN);
  ok('revisar normaliza el CC editado (3702.02.07, UF 2)', e.ok && e.filas[0].centro_coste==='3702.02.07' && e.filas[0].uf==='2', JSON.stringify(e).slice(0,200));
  // una fila VIEJA con el CC mal guardado sale corregida en la bandeja
  c._hojas.PARTE_BANDEJA._f[1][H.indexOf('centro_coste')]='3701.2.1';
  c.invalidarHoja_('PARTE_BANDEJA');
  const b=get(c,{ mod:'parte', op:'bandeja', fecha:'2026-09-16', token:T_ADMIN });
  const a1=b.pendientes.find(x=>x.id_registro==='a1');
  ok('bandeja: fila vieja con «3701.2.1» sale como 3701.02.10', a1 && a1.centro_coste==='3701.02.10', JSON.stringify(a1&&a1.centro_coste));
}

console.log('\n4 · Alias de operadores');
{
  const c=cargar();
  const r=get(c,{ mod:'parte', op:'equipo', eq:'VOL048' });
  ok('la lista funde las variantes: Aleyxer Rincon · Jean Carlos Muñoz · Nelson Rangel · Wilmar Pahuana', JSON.stringify(r.operadores)==='["Aleyxer Rincon","Jean Carlos Muñoz","Nelson Rangel","Wilmar Pahuana"]', JSON.stringify(r.operadores));
  const p=post(c,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[ tramo({ id_registro:'o1', inicial:27120, final:27200, operador:'Wilmar Pawana' }) ] });
  const H=c.PARTE_BANDEJA_HEADERS;
  ok('un parte con «Wilmar Pawana» se guarda como «Wilmar Pahuana»', p.ok && c._hojas.PARTE_BANDEJA._f[1][H.indexOf('operador')]==='Wilmar Pahuana');
  const e=post(c,{ mod:'parte', op:'revisar', cambios:[{ id_registro:'o1', campos:{ operador:'Aleyxer Rincón' } }] }, T_ADMIN);
  ok('revisión también aplica el alias', e.ok && e.filas[0].operador==='Aleyxer Rincon', JSON.stringify(e.filas&&e.filas[0]&&e.filas[0].operador));
  ok('un nombre que no es alias pasa tal cual', c.parteOperadorCanon_('Nelson Rangel')==='Nelson Rangel' && c.parteOperadorCanon_('')==='');
}

console.log('\n5 · jeisson y duvan revisan (D193); residente_uf3 no');
{
  const c=cargar();
  post(c,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[ tramo({ id_registro:'j1', inicial:27120, final:27200 }) ] });
  const b=get(c,{ mod:'parte', op:'bandeja', fecha:'2026-09-16', token:T_JEISSON });
  ok('jeisson (asistencia_plus) lee la bandeja', b.ok===true && b.pendientes.length===1, JSON.stringify(b).slice(0,150));
  const e=post(c,{ mod:'parte', op:'revisar', cambios:[{ id_registro:'j1', estado:'aprobado' }] }, T_JEISSON);
  ok('jeisson aprueba y queda como revisado_por', e.ok && e.filas[0].estado==='aprobado' && e.filas[0].revisado_por==='jeisson', JSON.stringify(e).slice(0,150));
  const d=get(c,{ mod:'parte', op:'bandeja', fecha:'2026-09-16', token:T_DUVAN });
  ok('duvan (asistencia_plus_dren) entra desde D193', d.ok===true, JSON.stringify(d).slice(0,150));
  const u=get(c,{ mod:'parte', op:'bandeja', fecha:'2026-09-16', token:T_UF3 });
  ok('residente_uf3 (asistencia_plus_uf3) NO entra', u.ok===false && /no revisa/.test(u.error), JSON.stringify(u).slice(0,150));
  const m=post(c,{ mod:'parte', op:'reporte', origen:'manual', codigo:'VOL048', tramos:[ tramo({ id_registro:'j2', inicial:27200, final:27210, reporte_num:'', centro_coste:'Taller', descripcion_trabajo:'Taller' }) ] }, T_JEISSON);
  ok('jeisson puede crear filas manuales (día sin operación)', m.ok && c._hojas.PARTE_BANDEJA._f[2][c.PARTE_BANDEJA_HEADERS.indexOf('origen')]==='manual', JSON.stringify(m).slice(0,150));
}

console.log('\n6 · op=repartir desde revisión');
{
  const c=cargar(), H=c.PARTE_BANDEJA_HEADERS, col=(f,k)=>f[H.indexOf(k)];
  post(c,{ mod:'parte', op:'reporte', codigo:'MO004', tramos:[ tramo({ id_registro:'m1', inicial:2337, final:2345, hora_de:'07:00', hora_a:'15:00', centro_coste:'3701.02.07', pr:14400, descripcion_trabajo:'Cereo terraplen', observaciones:'ok' }) ] });
  const sin=post(c,{ mod:'parte', op:'repartir', id_registro:'m1', reparto:[{ centro_coste:'3701.02.07', pct:50 }] }, T_ADMIN);
  ok('con una sola fila se rechaza', sin.ok===false && /dos centros/.test(sin.error), JSON.stringify(sin));
  const mal=post(c,{ mod:'parte', op:'repartir', id_registro:'m1', reparto:[{ centro_coste:'3701.02.07', pct:60 },{ centro_coste:'3702.02.07', pct:60 }] }, T_ADMIN);
  ok('si no suma 100 se rechaza y no se toca nada', mal.ok===false && /100/.test(mal.error) && c._hojas.PARTE_BANDEJA._f.length===2, JSON.stringify(mal));
  const noTok=post(c,{ mod:'parte', op:'repartir', id_registro:'m1', reparto:[{ centro_coste:'3701.02.07', pct:50 },{ centro_coste:'3702.02.07', pct:50 }] });
  ok('sin token no se puede', noTok.ok===false, JSON.stringify(noTok).slice(0,120));
  const r=post(c,{ mod:'parte', op:'repartir', id_registro:'m1', reparto:[{ centro_coste:'3701.02.07', pct:70, pr:14400 },{ centro_coste:'3702.2.7', pct:30, pr:35200, descripcion_trabajo:'Cereo sub base' }] }, T_JEISSON);
  ok('ok: original + 2 filas', r.ok===true && r.cambiadas===3 && r.filas.length===2, JSON.stringify(r).slice(0,200));
  const h=c._hojas.PARTE_BANDEJA._f;
  ok('la original queda descartada con la marca y revisado_por', col(h[1],'estado')==='descartado' && /\[Repartido en 2 filas\]/.test(col(h[1],'observaciones')) && col(h[1],'revisado_por')==='jeisson', col(h[1],'observaciones'));
  ok('filas nuevas encadenadas: 2337→2342.6 (5.6 h) y 2342.6→2345 (2.4 h)', col(h[2],'inicial')===2337 && col(h[2],'final')===2342.6 && col(h[2],'total')===5.6 && col(h[3],'inicial')===2342.6 && col(h[3],'final')===2345 && col(h[3],'total')===2.4, h.slice(2).map(x=>col(x,'inicial')+'→'+col(x,'final')).join(' | '));
  ok('horas 07:00–12:36 y 12:36–15:00', col(h[2],'hora_a')==='12:36' && col(h[3],'hora_de')==='12:36' && col(h[3],'hora_a')==='15:00');
  ok('CC de cada fila (el numérico normalizado) y UF', col(h[2],'centro_coste')==='3701.02.07' && col(h[2],'uf')==='1' && col(h[3],'centro_coste')==='3702.02.07' && col(h[3],'uf')==='2');
  ok('PR y descripción por fila; la 1ª hereda la descripción original', col(h[2],'pr')===14400 && col(h[3],'pr')===35200 && col(h[2],'descripcion_trabajo')==='Cereo terraplen' && col(h[3],'descripcion_trabajo')==='Cereo sub base');
  ok('ids m1-r1 y m1-r2, estado pendiente, mismo nº de parte y operador, origen heredado (qr)', col(h[2],'id_registro')==='m1-r1' && col(h[3],'id_registro')==='m1-r2' && col(h[2],'estado')==='pendiente' && col(h[3],'reporte_num')==='0501' && col(h[3],'operador')==='Nelson Rangel' && col(h[2],'origen')==='qr');
  ok('observaciones con la marca [Reparto 70 % · 1/2] tras la nota original', /^ok · \[Reparto 70 % · 1\/2\]$/.test(col(h[2],'observaciones')), col(h[2],'observaciones'));
  const otra=post(c,{ mod:'parte', op:'repartir', id_registro:'m1', reparto:[{ centro_coste:'3701.02.07', pct:50 },{ centro_coste:'3702.02.07', pct:50 }] }, T_ADMIN);
  ok('repartir de nuevo la original (ya descartada) se rechaza', otra.ok===false && /descartada/.test(otra.error), JSON.stringify(otra));
  const vacio=post(c,{ mod:'parte', op:'repartir', id_registro:'m1-r1', reparto:[{ centro_coste:'3701.02.07', pct:50 },{ centro_coste:'', pct:50 }] }, T_ADMIN);
  ok('una fila del reparto sin CC se rechaza (en revisión el CC es obligatorio)', vacio.ok===false && /vac/.test(vacio.error), JSON.stringify(vacio));
  // repartir una de las hijas: ids únicos con sufijo
  const r2=post(c,{ mod:'parte', op:'repartir', id_registro:'m1-r1', reparto:[{ centro_coste:'3701.02.07', pct:50 },{ centro_coste:'3701.05.04', pct:50 }] }, T_ADMIN);
  ok('una hija se puede repartir', r2.ok && r2.filas.length===2 && r2.filas[1].centro_coste==='3701.05.04', JSON.stringify(r2).slice(0,200));
  ok('ids de la segunda generación: m1-r1-r1 y m1-r1-r2', r2.filas[0].id_registro==='m1-r1-r1' && r2.filas[1].id_registro==='m1-r1-r2');
  const b=get(c,{ mod:'parte', op:'bandeja', fecha:'2026-09-16', token:T_ADMIN });
  ok('bandeja: 3 pendientes (m1-r2, m1-r1-r1, m1-r1-r2) y 2 descartadas; MO004 no sale como faltante', b.pendientes.length===3 && b.revisadas.length===2 && !b.faltantes.some(q=>q.codigo==='MO004'), b.pendientes.map(x=>x.id_registro).join(','));
  // una fila que llegó en texto libre (SIN_CC) se reparte en dos CC: las hijas ya no llevan SIN_CC
  post(c,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[ tramo({ id_registro:'v1', inicial:27120, final:27200, centro_coste:'', descripcion_trabajo:'Acarreo de piedra y tierra' }) ] });
  const v=post(c,{ mod:'parte', op:'repartir', id_registro:'v1', reparto:[{ centro_coste:'3701.02.11', pct:50 },{ centro_coste:'3701.02.05', pct:50 }] }, T_JEISSON);
  ok('texto libre repartido: hijas con CC y sin SIN_CC; CC_INUSUAL de la original se conserva (es registro)', v.ok && v.filas.every(f=>!/SIN_CC/.test(f.alertas)) && v.filas[1].centro_coste==='3701.02.05', JSON.stringify(v.filas.map(f=>f.centro_coste+':'+f.alertas)));
  const ap=post(c,{ mod:'parte', op:'revisar', cambios:[{ id_registro:'v1-r1', estado:'aprobado' },{ id_registro:'v1-r2', estado:'aprobado' }] }, T_JEISSON);
  ok('y se aprueban las dos', ap.ok && ap.cambiadas===2 && ap.errores.length===0, JSON.stringify(ap.errores));
  ok('el último final del equipo sigue siendo 2345', get(c,{ mod:'parte', op:'equipo', eq:'MO004' }).ultimo.final===2345);
  // payload malo
  const bad=post(c,{ mod:'parte', op:'repartir', id_registro:'m1-r2', reparto:[{ centro_coste:'3701.02.07', pct:'x' },{ centro_coste:'3702.02.07', pct:50 }] }, T_ADMIN);
  ok('pct no numérico → error de payload (D166)', bad.ok===false && bad.error==='payload', JSON.stringify(bad).slice(0,120));
}

console.log('\n7 · depurarOperadoresParte()');
{
  const c=cargar();
  post(c,{ mod:'parte', op:'reporte', codigo:'VOL048', tramos:[ tramo({ id_registro:'d1', inicial:27120, final:27200 }) ] });
  const H=c.PARTE_BANDEJA_HEADERS;
  c._hojas.PARTE_BANDEJA._f[1][H.indexOf('operador')]='Wilmer Pahuana';   // fila vieja con la variante
  c.invalidarHoja_('PARTE_BANDEJA');
  const antes=JSON.stringify(c._hojas.PARTE_OPERADORES._f);
  const sim=c.depurarOperadoresParte(false);
  ok('simulación: informa y no toca la hoja', /SIMULACI/.test(sim) && /Wilmar Pawana/.test(sim) && JSON.stringify(c._hojas.PARTE_OPERADORES._f)===antes && c._hojas.PARTE_BANDEJA._f[1][H.indexOf('operador')]==='Wilmer Pahuana');
  const ap=c.depurarOperadoresParte(true);
  const ops=c._hojas.PARTE_OPERADORES._f, iAct=ops[0].indexOf('activo');
  const fila=n=>ops.find(r=>r[0]===n);
  ok('aplicado: la hoja gana la columna activo y las variantes quedan NO', iAct>0 && fila('Aleyxer Rincón')[iAct]==='NO' && fila('Wilmar Pawana')[iAct]==='NO' && fila('Wilmer Pahuana')[iAct]==='NO', JSON.stringify(ops));
  ok('el canónico existente no se toca', fila('Wilmar Pahuana')[iAct]!=='NO' && fila('Nelson Rangel')[iAct]!=='NO');
  ok('un canónico que no existía se añade activo con los usos sumados (Jean Carlos Muñoz, 15)', fila('Jean Carlos Muñoz') && fila('Jean Carlos Muñoz')[1]===15 && fila('Jean Carlos Muñoz')[iAct]==='SI');
  ok('PARTE_BANDEJA: la fila vieja pasa al canónico', c._hojas.PARTE_BANDEJA._f[1][H.indexOf('operador')]==='Wilmar Pahuana' && /1 fila/.test(ap));
  const r=get(c,{ mod:'parte', op:'equipo', eq:'VOL048' });
  ok('la lista sigue limpia tras aplicar', JSON.stringify(r.operadores)==='["Aleyxer Rincon","Jean Carlos Muñoz","Nelson Rangel","Wilmar Pahuana"]', JSON.stringify(r.operadores));
  // setupParte: formato de texto en las columnas item / centro_coste
  c.setupParte();
  ok('setupParte fija formato de texto en PARTE_ITEMS.item y PARTE_CC.centro_coste', (c._hojas.PARTE_ITEMS._fmt||0)>=1 && (c._hojas.PARTE_CC._fmt||0)>=1);
}

console.log('\n'+(fallos?('✗ '+fallos+' de '+casos+' casos FALLAN'):('✓ '+casos+'/'+casos+' casos OK')));
process.exit(fallos?1:0);
