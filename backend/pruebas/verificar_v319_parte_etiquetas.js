#!/usr/bin/env node
/**
 * Verificación V3-19 — chips de actividad del Parte Digital sin frases repetidas (sep-2026), sobre el backend
 * REAL en banco (Codigo.gs + CodigoParte.gs en un `vm` con hojas falsas, mismo arnés que verificar_d178).
 *
 *   1 · Catálogo sucio (la retro de llantas real: «Excavacion» en 06.01, 06.02, 02.09 y 06.05): cada chip sale
 *       con frase distinta, el orden y los ítems no cambian y siguen siendo ≤ 5 (D178).
 *   2 · Sin choque la frase no se toca (la más usada del ítem).
 *   3 · Paridad: `parteEtiquetasUnicas_` es idéntica en CodigoParte.gs y en worker/src/api/parte.js.
 *
 *   node backend/pruebas/verificar_v319_parte_etiquetas.js
 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const REPO=path.resolve(__dirname,'..','..');
const GS=fs.readFileSync(path.join(REPO,'backend','CodigoParte.gs'),'utf8');
const SRC=fs.readFileSync(path.join(REPO,'backend','Codigo.gs'),'utf8')+'\n'+GS;
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
      setNumberFormat(){ return this; }, setValue(v){ g._fila(f-1)[c-1]=v; },
      clearContent(){ for(let i=f-1;i<f-1+nf;i++){ const r=g._f[i]; if(!r) continue; for(let j=c-1;j<c-1+nc;j++) r[j]=''; } } }; } };
  return g;
}
function cargar(items){
  const hojas={}; let n=0;
  const ctx={ console,
    SpreadsheetApp:{ openById: ()=>({ getSheetByName:(x)=>hojas[x]||null, insertSheet:(x)=>{ hojas[x]=hojaFalsa([]); return hojas[x]; }, getSpreadsheetTimeZone:()=>'America/Bogota' }) },
    ContentService:{ createTextOutput:(t)=>({ setMimeType:()=>JSON.parse(t) }), MimeType:{JSON:'json'} },
    CacheService:{ getScriptCache:()=>({ get:()=>null, put(){} }) },
    PropertiesService:{ getScriptProperties:()=>({ getProperty:(k)=>k==='AUTH_SECRETO'?'secreto-de-banco-largo-xxxxxxxx':null, setProperty(){} }) },
    Utilities:{ computeHmacSha256Signature:(t)=>Buffer.from(String(t)), base64EncodeWebSafe:(b)=>Buffer.from(b).toString('base64'),
      base64DecodeWebSafe:(s)=>Buffer.from(String(s),'base64'), newBlob:(x)=>({ getBytes:()=>Buffer.from(x), getDataAsString:()=>String(x) }),
      base64Encode:()=>'', getUuid:()=>'uuid-'+(++n), formatDate:()=>'2026-09-21', Charset:{UTF_8:'utf8'} },
    Logger:{ log(){} }, Session:{ getScriptTimeZone:()=>'America/Bogota' } };
  ctx.globalThis=ctx; vm.createContext(ctx); vm.runInContext(SRC, ctx);
  hojas.PARTE_EQUIPOS=hojaFalsa([['codigo','tipo','placa','proveedor','medidor','ultima_fecha','ultimo_final','activo'],
    ['MC64','RETRO DE LLANTAS','','ORTIZ','HOROMETRO','2026-09-19',1500,'SI'],
    ['BL002','BULLDOZER','','ORTIZ','HOROMETRO','2026-09-19',900,'SI']]);
  hojas.PARTE_OPERADORES=hojaFalsa([['operador','partes_ult_4_meses'],['Nelson Rangel',3]]);
  hojas.PARTE_CC=hojaFalsa([['centro_coste','proyecto','descripcion_cc','usos_ult_4_meses'],
    ['3702.06.01','3702','Excavaciones varias sin clasicar',50],['3702.06.02','3702','Rellenos con material seleccionado',40],
    ['3701.02.09','3701','Caminos y accesos',30],['3702.06.05','3702','Tubería de Concreto Reforzado de 900mm',20],
    ['3701.02.05','3701','Excavaciones en material común',60],['3701.02.03','3701','Desmonte y limpieza en zonas no boscosas',10],
    ['3701.02.07','3701','Terraplenes (solo conformación)',99],['3701.02.08','3701','Conformación y disposición de sobrantes',30],['3701.11.04','3701','Imprevistos (bloqueos - Paros)',5]]);
  hojas.PARTE_ITEMS=hojaFalsa([['tipo_equipo','item','actividad','veces','activo']].concat(items));
  hojas.PARTE_ACTIVIDADES=hojaFalsa([['tipo_equipo','descripcion_trabajo','veces']]);
  return ctx;
}
const equipo=(c,eq)=>c.doGet({ parameter:{ mod:'parte', op:'equipo', eq:eq } });
const norm=s=>String(s).normalize('NFD').replace(/\p{M}/gu,'').toUpperCase().trim();

console.log('\n1 · Retro de llantas con «Excavacion» en cuatro ítems (catálogo real de sep-2026)');
{
  // tal cual lo trae parte_items en producción (21-sep-2026)
  const c=cargar([
    ['RETRO DE LLANTAS','6.01','Excavacion',27,''],['RETRO DE LLANTAS','6.02','Excavacion',21,''],['RETRO DE LLANTAS','2.09','Excavacion',8,''],
    ['RETRO DE LLANTAS','6.01','Cargue de volquetas odt',6,''],['RETRO DE LLANTAS','6.01','Cargue de volqueta',5,''],['RETRO DE LLANTAS','6.05','Excavacion',5,''],
    ['RETRO DE LLANTAS','2.05','Paisajeo',5,''],['RETRO DE LLANTAS','2.05','Excavacion',4,''],['RETRO DE LLANTAS','2.03','Paisajeo',3,'']]);
  const r=equipo(c,'MC64'), h=(r.actividades||{}).habituales||[];
  ok('responde ok', r.ok===true, JSON.stringify(r).slice(0,150));
  ok('sigue el tope de 5 (D178)', h.length===5, String(h.length));
  ok('mismos ítems y mismo orden por uso: 06.01, 06.02, 02.09, 06.05, 02.05', JSON.stringify(h.map(a=>a.item))==='["06.01","06.02","02.09","06.05","02.05"]', JSON.stringify(h.map(a=>a.item)));
  ok('ninguna frase se repite', new Set(h.map(a=>norm(a.actividad))).size===h.length, JSON.stringify(h.map(a=>a.actividad)));
  ok('el más usado conserva su frase («Excavacion»)', h[0].actividad==='Excavacion', h[0].actividad);
  ok('06.02 y 02.09 (sin otra frase propia) toman el nombre de catálogo', h[1].actividad==='Rellenos con material seleccionado' && h[2].actividad==='Caminos y accesos', h[1].actividad+' | '+h[2].actividad);
  ok('02.05 cambia a su otra frase del tipo, sin chocar con 06.01', h[4].actividad==='Paisajeo' || norm(h[4].actividad)!=='EXCAVACION', h[4].actividad);
}

console.log('\n2 · Sin choque, la frase no se toca');
{
  const c=cargar([
    ['BULLDOZER','2.07','Conformacion de terraplen',80,''],['BULLDOZER','2.07','Conformacion terraplen',35,''],
    ['BULLDOZER','2.08','Conformacion de botadero',31,''],['BULLDOZER','2.03','Desmonte y limpieza en zonas no boscosas',5,''],['BULLDOZER','11.04','Imprevistos (bloqueos - Paros)',4,'']]);
  const h=equipo(c,'BL002').actividades.habituales;
  ok('4 chips (4 ítems), la frase más usada de cada uno', JSON.stringify(h.map(a=>a.actividad))==='["Conformacion de terraplen","Conformacion de botadero","Desmonte y limpieza en zonas no boscosas","Imprevistos (bloqueos - Paros)"]', JSON.stringify(h.map(a=>a.actividad)));
}

console.log('\n3 · Paridad Apps Script ↔ Worker');
{
  const W=fs.readFileSync(path.join(REPO,'worker','src','api','parte.js'),'utf8');
  const cuerpo=s=>{ const m=/function parteEtiquetasUnicas_\([\s\S]*?\n}\r?\n/.exec(s); return m ? m[0].replace(/\r/g,'') : ''; };
  ok('parteEtiquetasUnicas_ existe en los dos', !!cuerpo(GS) && !!cuerpo(W));
  ok('y es idéntica', cuerpo(GS)===cuerpo(W));
  ok('las dos la aplican al recorte de 5', /parteEtiquetasUnicas_\(habituales\.slice\(0,PARTE_MAX_HABITUALES\)/.test(GS) && /parteEtiquetasUnicas_\(habituales\.slice\(0,PARTE_MAX_HABITUALES\)/.test(W));
}

console.log('\n'+(fallos?'✗ '+fallos+' de '+casos+' fallaron':'✓ '+casos+' comprobaciones en verde'));
process.exit(fallos?1:0);
