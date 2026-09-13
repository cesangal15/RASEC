#!/usr/bin/env node
/**
 * Verificación D159 — el tablero se abre al público, la escritura no.
 *
 * El tablero de producción se comparte por enlace con los directivos, que no tienen usuario en la
 * plataforma. Para eso `doGet` despacha `action=tablero` ANTES de la puerta de sesión de D109. Es la
 * única lectura sin token de toda la API, y por eso hay que vigilarla: el riesgo no es que deje de
 * funcionar —eso se nota al abrir el enlace—, sino que la excepción CREZCA y se lleve por delante
 * las otras lecturas o la escritura.
 *
 * Lo que se comprueba:
 *   · `action=tablero` SIN token devuelve la foto (si no, el directivo ve una página muerta);
 *   · las demás lecturas siguen pidiendo token (la excepción no se derramó);
 *   · publicar sigue pidiendo token Y rol (admin/jefe), tanto por doPost como en el guard;
 *   · la foto que se sirve al público no lleva datos de personas.
 *
 * Y al final se muta el código a propósito para comprobar que el arnés no es ciego.
 *
 *   node backend/pruebas/verificar_d159_tablero_publico.js
 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const REPO=path.resolve(__dirname,'..','..');
const SRC=fs.readFileSync(path.join(REPO,'backend','Codigo.gs'),'utf8');
let fallos=0, casos=0;
function ok(n,c,x){ casos++; if(!c){ fallos++; console.log('  ✗ '+n+(x?'  → '+x:'')); } else console.log('  ✓ '+n); }

function hojaFalsa(filas){
  const g={
    _f: filas.map(r=>r.slice()),
    getLastRow: ()=>g._f.length,
    getLastColumn: ()=>g._f.reduce((m,r)=>Math.max(m,r.length),0),
    getMaxRows: ()=>Math.max(g._f.length,200), getMaxColumns: ()=>Math.max(g.getLastColumn(),26),
    insertRowsAfter(){}, insertColumnsAfter(){},
    _fila(i){ while(g._f.length<=i) g._f.push([]); return g._f[i]; },
    getRange(f,c,nf,nc){
      nf=(nf===undefined?1:nf); nc=(nc===undefined?1:nc);
      return {
        getValues(){ const out=[];
          for(let i=f-1;i<f-1+nf;i++){ const r=g._f[i]||[], fila=[];
            for(let j=c-1;j<c-1+nc;j++) fila.push(r[j]===undefined?'':r[j]);
            out.push(fila); } return out; },
        setValues(m){ for(let i=0;i<m.length;i++){ const r=g._fila(f-1+i);
            for(let j=0;j<m[i].length;j++) r[c-1+j]=m[i][j]; } },
        setValue(v){ g._fila(f-1)[c-1]=v; },
        clearContent(){ for(let i=f-1;i<f-1+nf;i++){ const r=g._f[i]; if(!r) continue;
            for(let j=c-1;j<c-1+nc;j++) r[j]=''; } }
      };
    }
  };
  return g;
}

function cargar(mutar){
  const src = mutar ? mutar(SRC) : SRC;
  const hojas={};
  const ctx={ console,
    SpreadsheetApp:{ openById: ()=>({
      getSheetByName:(n)=>hojas[n]||null,
      insertSheet:(n)=>{ hojas[n]=hojaFalsa([]); return hojas[n]; },
      getSpreadsheetTimeZone:()=>'America/Bogota' }) },
    ContentService:{ createTextOutput:(t)=>({ setMimeType:()=>JSON.parse(t) }), MimeType:{JSON:'json'} },
    CacheService:{ getScriptCache:()=>({ get:()=>null, put(){} }) },
    PropertiesService:{ getScriptProperties:()=>({ getProperty:()=>null, setProperty(){} }) },
    Utilities:{ computeHmacSha256Signature:()=>[], base64Encode:()=>'', getUuid:()=>'uuid',
                formatDate:(d)=>'2026-09-09' },
    Logger:{ log(){} }, Session:{ getScriptTimeZone:()=>'America/Bogota' }
  };
  ctx.globalThis=ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
  ctx._hojas=hojas; return ctx;
}

/* Una foto pequeña pero con la forma real: períodos, días y actividades. */
function foto(){
  return { fc:1.3, desde:'2025-08', generado:'2026-09-09 10:00', fuente:'TM2_SUR.xlsx',
           per:[{ p:'2026-08', d:[{f:'2026-08-01', exc:1200, ter:800, sub:0, bas:0, t:'SOLEADO'}],
                  a:{ exc:{prod:1200, dias:1} },
                  m:{ exc:{ h:12.5, maq:[{cod:'EXC001', tipo:'Excavadora', h:6.4}] } } }] };
}
function publicada(ctx){
  ctx.tableroGuardar({ action:'tablero_guardar', foto:foto(), _rol:'admin', usuario:'admin' });
  return ctx;
}

console.log('\n1 · Un directivo SIN sesión abre el enlace y ve la foto');
{
  const ctx=publicada(cargar());
  const r=ctx.doGet({ parameter:{ action:'tablero' } });     // sin token, sin usuario, sin nada
  ok('doGet(tablero) sin token responde ok', r && r.ok===true, JSON.stringify(r&&r.error||''));
  ok('y trae la foto, no un auth:false', !!(r && r.foto && r.foto.per && r.foto.per.length===1),
     JSON.stringify(r&&r.auth));
  ok('con los datos dentro', !!(r && r.foto.per[0].a && r.foto.per[0].a.exc.prod===1200));
  const sinPublicar=cargar().doGet({ parameter:{ action:'tablero' } });
  ok('y si aún no se ha publicado nada, foto:null (el tablero se queda con la suya)',
     sinPublicar.ok===true && sinPublicar.foto===null);
}

console.log('\n2 · La excepción no se derramó: las demás lecturas siguen cerradas');
{
  const ctx=publicada(cargar());
  for(const a of ['consolidado','bandeja','estado','flota','maquinaria_produccion','debug']){
    const r=ctx.doGet({ parameter:{ action:a } });
    ok('doGet('+a+') sin token sigue rechazado', !!(r && r.ok===false && r.auth===false),
       JSON.stringify(r).slice(0,90));
  }
}

console.log('\n3 · Publicar sigue pidiendo token Y rol');
{
  const ctx=publicada(cargar());
  const post={ postData:{ contents: JSON.stringify({ action:'tablero_guardar', foto:foto(), token:'' }) } };
  const r=ctx.doPost(post);
  ok('doPost(tablero_guardar) sin token: rechazado', !!(r && r.ok===false && r.auth===false),
     JSON.stringify(r).slice(0,90));
  const antes=JSON.stringify(ctx._hojas.TABLERO._f);
  ctx.doPost(post);
  ok('y la hoja no se tocó', JSON.stringify(ctx._hojas.TABLERO._f)===antes);
  for(const [rol,puede] of [['admin',true],['jefe',true],['residente',false],['capataz',false],['',false]]){
    const c=cargar();
    const g=c.tableroGuardar({ action:'tablero_guardar', foto:foto(), _rol:rol, usuario:rol||'anon' });
    ok('rol "'+(rol||'(vacío)')+'" '+(puede?'publica':'NO publica'), !!g.ok===puede);
  }
}

console.log('\n4 · Lo que se sirve al público no lleva personas');
{
  const r=publicada(cargar()).doGet({ parameter:{ action:'tablero' } });
  const crudo=JSON.stringify(r.foto).toLowerCase();
  for(const palabra of ['usuario','clave','operador','cedula','cédula','contrase'])
    ok('la foto no contiene «'+palabra+'»', crudo.indexOf(palabra)<0);
}

console.log('\n5 · El arnés no es ciego (se rompe el código a propósito)');
{
  // Si el despacho público volviera DEBAJO de la puerta de sesión, el punto 1 fallaría.
  const detras=cargar(s=>s.replace(
    "  if(a==='tablero')     return tableroLeer();\n", ''));
  const r=publicada(detras).doGet({ parameter:{ action:'tablero' } });
  ok('sin el despacho antes de la puerta, el directivo se queda fuera',
     !(r && r.ok===true && r.foto), JSON.stringify(r).slice(0,90));
  // Si la puerta desapareciera del todo, el punto 2 fallaría.
  const sinPuerta=cargar(s=>s.replace(
    // D166: la puerta ahora es `puerta_` (sesion_ + LOG + rate limit); se anula igual que antes.
    "const p=puerta_(e, null, a||'ping');\n    if(!p.ok) return p.respuesta;",
    'const p={ok:true, ses:{ok:true}};'));
  const c=sinPuerta.doGet({ parameter:{ action:'consolidado' } });
  ok('sin la puerta, `consolidado` se abriría al público', !(c && c.ok===false && c.auth===false));
}

console.log('\n'+(fallos?('✗ '+fallos+' de '+casos+' comprobaciones fallaron'):('✓ '+casos+' comprobaciones, todas bien')));
process.exit(fallos?1:0);
