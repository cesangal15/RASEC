#!/usr/bin/env node
/**
 * Verificación D228 — Tablero de producción, «Horas del personal» con HH/m³.
 * Carga SOLO el bloque `D228-PURO` de tablero-produccion.js (funciones puras, sin DOM) en un vm y comprueba:
 * Ref. con 0/1/2/3/4 cortes previos, piso 2026-08, ponderado Σ/Σ, ΣHH o Σm³ = 0 → null, Resultado con signo,
 * meta manual sobre automática, meta prorrateada, UF ≠ Todo, Total solo con las 4.
 *   node backend/pruebas/verificar_d228_hh_m3.js
 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const SRC=fs.readFileSync(path.join(__dirname,'..','..','tablero-produccion.js'),'utf8');
const m=/\/\*D228-PURO-INICIO\*\/([\s\S]*?)\/\*D228-PURO-FIN\*\//.exec(SRC);
let fallos=0, casos=0;
function ok(n,c,x){ casos++; if(!c){ fallos++; console.log('  ✗ '+n+(x?'  → '+x:'')); } else console.log('  ✓ '+n); }
ok('el bloque D228-PURO existe en tablero-produccion.js', !!m);
if(!m){ process.exit(1); }
const ctx={}; vm.createContext(ctx);
vm.runInContext(m[1]+'\nthis.X={HH_REF_DESDE,HH_REF_CORTES,periodoDeISO,m3Dias,refHHm3,filaHH,metaHHPartida,sumaCuatro};',ctx);
const X=ctx.X;
const cerca=(a,b)=>a!=null && Math.abs(a-b)<1e-9;

// Fixture: un día por período con m³ conocidos (fc=1 salvo donde se diga) y asistencia el mismo día
const dia=(f,exc,ter,sub,bas)=>({f,exc,ter,ter1:ter/2,ter2:ter/2,sub,sub1:sub,sub2:0,bas,bas1:0,bas2:bas});
const per=(p,f,exc,ter,sub,bas)=>({p,d:[dia(f,exc,ter,sub,bas)]});
const PER=[
  per('2026-06','2026-06-10',1000,1000,1000,1000),   // anterior al piso: NO cuenta
  per('2026-07','2026-07-10',1000,1000,1000,1000),   // anterior al piso: NO cuenta
  per('2026-08','2026-08-10',1000,500,100,100),
  per('2026-09','2026-09-10',2000,1500,300,200),
  per('2026-10','2026-10-10',3000,2500,500,300),
  per('2026-11','2026-11-10',4000,3500,700,400),
  per('2026-12','2026-12-10',5000,4500,900,500),
];
const h=(f,act,hh)=>({f,uf:'UF1',act,n:1,h:hh});
const PERS=[
  h('2026-06-10','excavacion',9999), h('2026-07-10','excavacion',9999),    // fuera del piso
  h('2026-08-10','excavacion',100), h('2026-08-10','terraplen',100), h('2026-08-10','subbase',10), h('2026-08-10','base',10),
  h('2026-09-10','excavacion',300), h('2026-09-10','terraplen',300), h('2026-09-10','subbase',30), h('2026-09-10','base',30),
  h('2026-10-10','excavacion',400), h('2026-10-10','terraplen',500), h('2026-10-10','subbase',50), h('2026-10-10','base',50),
  h('2026-11-10','excavacion',800), h('2026-11-10','terraplen',700), h('2026-11-10','subbase',70), h('2026-11-10','base',70),
  h('2026-09-10','transporte',500),
];

console.log('1 · Asignación de período (16→15)');
ok('15-ago -> 2026-08 y 16-ago -> 2026-09', X.periodoDeISO('2026-08-15')==='2026-08' && X.periodoDeISO('2026-08-16')==='2026-09');
ok('16-dic -> 2027-01', X.periodoDeISO('2026-12-16')==='2027-01');

console.log('\n2 · Ref. HH/m³: cuántos cortes entran');
let R=X.refHHm3(PER,PERS,'2026-08',1);
ok('2026-08 (primer corte): 0 previos ≥ piso -> todo null y sin cortes', R.cortes.length===0 && Object.values(R.ref).every(v=>v===null), JSON.stringify(R));
R=X.refHHm3(PER,PERS,'2026-09',1);
ok('2026-09: 1 corte (ago) -> excavación 100/1000, terraplén 100/500; jun/jul NO cuentan', JSON.stringify(R.cortes)==='["2026-08"]' && cerca(R.ref.excavacion,0.1) && cerca(R.ref.terraplen,0.2), JSON.stringify(R));
R=X.refHHm3(PER,PERS,'2026-10',1);
ok('2026-10: 2 cortes (ago, sep) -> excavación (100+300)/(1000+2000)', JSON.stringify(R.cortes)==='["2026-08","2026-09"]' && cerca(R.ref.excavacion,400/3000), JSON.stringify(R));
R=X.refHHm3(PER,PERS,'2026-11',1);
ok('2026-11: 3 cortes (ago, sep, oct) -> excavación 800/6000', R.cortes.length===3 && cerca(R.ref.excavacion,800/6000), JSON.stringify(R));
R=X.refHHm3(PER,PERS,'2026-12',1);
ok('2026-12: 4 previos -> usa SOLO los 3 últimos (sep, oct, nov) -> excavación 1500/9000', JSON.stringify(R.cortes)==='["2026-09","2026-10","2026-11"]' && cerca(R.ref.excavacion,1500/9000), JSON.stringify(R));
ok('ponderado Σ/Σ de los 3 últimos: subbase 150/1500', cerca(R.ref.subbase,(30+50+70)/(300+500+700)));
const PER2=[per('2026-08','2026-08-10',1000,500,100,100), per('2026-09','2026-09-10',3000,500,100,900)];
const PERS2=[h('2026-08-10','excavacion',100), h('2026-09-10','excavacion',100)];
R=X.refHHm3(PER2,PERS2,'2026-10',1);
ok('Σ/Σ ≠ promedio de razones: 200/4000=0,05 (el promedio daría 0,0667)', cerca(R.ref.excavacion,0.05), String(R.ref.excavacion));
R=X.refHHm3(PER,PERS.filter(x=>x.act!=='subbase'),'2026-10',1);
ok('ΣHH = 0 -> null (subbase sin horas), el resto sigue', R.ref.subbase===null && R.ref.excavacion!==null);
R=X.refHHm3(PER.map(x=>Object.assign({},x,{d:x.d.map(d=>Object.assign({},d,{bas:0,bas1:0,bas2:0}))})),PERS,'2026-10',1);
ok('Σm³ = 0 -> null (base sin m³)', R.ref.base===null);
R=X.refHHm3(PER,PERS,'2026-12',2);
ok('fc: los m³ se pasan a compacto (÷fc=2 duplica la Ref.)', cerca(R.ref.excavacion,2*1500/9000));
ok('solo las 4 partidas (Transporte/Otras no entran a la Ref.)', Object.keys(R.ref).join()==='excavacion,terraplen,subbase,base');
R=X.refHHm3(PER,PERS,'2026-09',1);
ok('la HH del 10-sep de Transporte no contamina ninguna Ref.', cerca(R.ref.terraplen,0.2));
R=X.refHHm3(PER,[h('2026-08-15','excavacion',100),h('2026-08-16','excavacion',500)],'2026-10',1);
ok('asistencia del 15-ago cuenta en ago (100/1000 en el corte ago; el 16-ago cae en sep: 500/(1000+2000))', cerca(R.ref.excavacion,600/3000), String(R.ref.excavacion));

// Día de borde: el Excel decide el período del día; la regla 16→15 de la fecha solo es respaldo.
const PERB=[
  {p:'2026-08',d:[dia('2026-08-10',1000,500,100,100),dia('2026-08-16',1000,0,0,0)]},   // el Excel puso el 16-ago en ago (la regla diría sep)
  {p:'2026-09',d:[dia('2026-09-10',1000,0,0,0)]},
];
R=X.refHHm3(PERB,[h('2026-08-16','excavacion',200),h('2026-09-10','excavacion',999)],'2026-09',1);
ok('borde: HH del 16-ago van a ago porque la DATA así lo dice (200/2000), no a sep por la regla de fechas', JSON.stringify(R.cortes)==='["2026-08"]' && cerca(R.ref.excavacion,0.1), JSON.stringify(R));
R=X.refHHm3(PERB,[h('2026-08-05','excavacion',100),h('2026-08-13','excavacion',100)],'2026-09',1);
ok('fecha sin fila en la DATA: respaldo por la regla 16→15 (el 13-ago cuenta en ago: 200/2000)', cerca(R.ref.excavacion,0.1), JSON.stringify(R));
R=X.refHHm3(PERB,[h('2026-08-20','excavacion',100)],'2026-09',1);
ok('fecha sin fila en la DATA y de otro período por la regla (20-ago -> sep): no cuenta en ago -> null', R.ref.excavacion===null, JSON.stringify(R));

console.log('\n3 · m³ del ámbito por UF');
const dd=[dia('2026-10-10',3000,2000,300,200)];
ok('Todo: terraplén 2000 · excavación 3000', X.m3Dias(dd,'terraplen','Todo',1)===2000 && X.m3Dias(dd,'excavacion','Todo',1)===3000);
ok('UF1: terraplén 1000, subbase 300; UF2: base 200', X.m3Dias(dd,'terraplen','UF1',1)===1000 && X.m3Dias(dd,'subbase','UF1',1)===300 && X.m3Dias(dd,'base','UF2',1)===200);
ok('UF1/UF2: excavación -> null (no viene por UF)', X.m3Dias(dd,'excavacion','UF1',1)===null && X.m3Dias(dd,'excavacion','UF2',1)===null);
ok('la Ref. no recibe UF (siempre Todo): refHHm3 tiene 4 parámetros y ninguno es la UF', X.refHHm3.length===4);

console.log('\n4 · HH/m³, HH ganadas y Resultado con signo');
let f=X.filaHH(300,2000,0.2);
ok('300 HH, 2000 m³, Ref. 0,2 -> HH/m³ 0,15 · ganadas 400 · Resultado +100', cerca(f.hhm3,0.15) && cerca(f.ganadas,400) && cerca(f.resultado,100), JSON.stringify(f));
f=X.filaHH(500,2000,0.2);
ok('500 HH -> Resultado −100 (perdimos)', cerca(f.resultado,-100), JSON.stringify(f));
f=X.filaHH(300,null,0.2);
ok('sin m³ (excavación con UF) -> todo null', f.hhm3===null && f.ganadas===null && f.resultado===null);
f=X.filaHH(300,2000,null);
ok('sin Ref. -> ganadas y Resultado null, HH/m³ real sí', cerca(f.hhm3,0.15) && f.resultado===null);
f=X.filaHH(100,0,0.2);
ok('m³ = 0 -> HH/m³ null; Resultado = 0 − HH = −100', f.hhm3===null && cerca(f.resultado,-100));

console.log('\n5 · Meta: manual manda, automática = plan × Ref., prorrata y UF');
let M=X.metaHHPartida(3100,5000,0.2,'Todo',1);
ok('manual cargada manda sobre plan × Ref.: 3100, fuente manual', M.valor===3100 && M.fuente==='manual', JSON.stringify(M));
M=X.metaHHPartida(null,5000,0.2,'Todo',1);
ok('sin manual: 5000 × 0,2 = 1000, fuente auto', cerca(M.valor,1000) && M.fuente==='auto', JSON.stringify(M));
M=X.metaHHPartida(undefined,5000,0.2,'Todo',3/31);
ok('automática prorrateada por días: 1000 × 3/31', cerca(M.valor,1000*3/31) && M.fuente==='auto');
M=X.metaHHPartida(3100,5000,0.2,'Todo',3/31);
ok('manual también se prorratea: 3100 × 3/31 = 300', cerca(M.valor,300) && M.fuente==='manual');
M=X.metaHHPartida(null,5000,null,'Todo',1);
ok('sin manual y sin Ref. -> null', M.valor===null && M.fuente===null);
M=X.metaHHPartida(null,0,0.2,'Todo',1);
ok('sin manual y plan 0 -> null', M.valor===null);
M=X.metaHHPartida(3100,5000,0.2,'UF1',1);
ok('UF1 -> null con fuente «uf» (aunque haya manual)', M.valor===null && M.fuente==='uf');
M=X.metaHHPartida(0,5000,0.2,'Todo',1);
ok('manual = 0 cargada sigue mandando (0, no automática)', M.valor===0 && M.fuente==='manual');

console.log('\n6 · Total: suma de las 4 solo si las 4 tienen valor');
ok('4 valores -> suma', X.sumaCuatro([1,2,3,4])===10);
ok('3 valores y 1 null -> null (sin parcial)', X.sumaCuatro([1,2,3,null])===null);
ok('negativos suman con signo', X.sumaCuatro([-5,2,3,-1])===-1);
ok('menos de 4 -> null', X.sumaCuatro([1,2,3])===null);
ok('constantes: piso 2026-08 y 3 cortes', X.HH_REF_DESDE==='2026-08' && X.HH_REF_CORTES===3);

console.log('\n'+(fallos?'✗ '+fallos+' de '+casos+' fallan':'✓ '+casos+'/'+casos+' en verde'));
process.exit(fallos?1:0);
