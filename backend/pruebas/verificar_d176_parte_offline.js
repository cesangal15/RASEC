#!/usr/bin/env node
/**
 * Verificación D176 — el Parte Digital (parte.html) funciona SIN SEÑAL: ficha del equipo desde la
 * copia del teléfono, envío a la cola local `tm2_cola_envios` y subida automática al volver la señal,
 * sin duplicar filas en PARTE_BANDEJA (dedupe por `id_registro`, D165/D82).
 *
 * Mismo arnés que verificar_v301_pantallas.js: Chromium (Playwright) abre parte.html servido desde el
 * repo y cada llamada a api.galca.app se atiende con Codigo.gs + CodigoParte.gs en un `vm` de Node
 * con hojas falsas. La «señal» se simula desde el propio route (abort) + context.setOffline.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node backend/pruebas/verificar_d176_parte_offline.js
 */
const fs=require('fs'), path=require('path'), vm=require('vm'), http=require('http');
const { chromium } = require('playwright');
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
      setNumberFormat(){ return this; },
      setValue(v){ g._fila(f-1)[c-1]=v; },
      clearContent(){ for(let i=f-1;i<f-1+nf;i++){ const r=g._f[i]; if(!r) continue; for(let j=c-1;j<c-1+nc;j++) r[j]=''; } } }; } };
  return g;
}
function firma(txt){ let h=0; for(const ch of String(txt)) h=(h*31+ch.charCodeAt(0))>>>0; return 'f'+h; }
const HOY=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
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
      base64Encode:()=>'', getUuid:()=>'uuid-'+(++n), formatDate:()=>HOY, Charset:{UTF_8:'utf8'} },
    Logger:{ log(){} }, Session:{ getScriptTimeZone:()=>'America/Bogota' } };
  ctx.globalThis=ctx; vm.createContext(ctx); vm.runInContext(SRC, ctx);
  vm.runInContext('globalThis.PARTE_BANDEJA_HEADERS=PARTE_BANDEJA_HEADERS;', ctx);
  ctx._hojas=hojas;
  hojas.PARTE_EQUIPOS=hojaFalsa([['codigo','tipo','placa','proveedor','medidor','ultima_fecha','ultimo_final','activo'],
    ['VOL048','VOLQUETAS DOBLETROQUE','NNM180','ORTIZ CONSTRUCCIONES Y PROYECTOS S.A.','KM','2026-09-09',27120,'SI'],
    ['EXC015','EXCAVADORAS','MC706830','ORTIZ CONSTRUCCIONES Y PROYECTOS S.A.','HOROMETRO','2026-09-09',2711.6,'SI']]);
  hojas.PARTE_OPERADORES=hojaFalsa([['operador','partes_ult_4_meses'],['Nelson Rangel',323],['Luis Rincon',212]]);
  hojas.PARTE_CC=hojaFalsa([['centro_coste','proyecto','descripcion_cc','usos_ult_4_meses'],['3701.02.11','3701','',457],['3702.02.11','3702','',460]]);
  hojas.PARTE_ACTIVIDADES=hojaFalsa([['tipo_equipo','descripcion_trabajo','veces'],['VOLQUETAS DOBLETROQUE','Cargue terraplen',31]]);
  hojas.PARTE_ITEMS=hojaFalsa([['tipo_equipo','item','actividad','veces','activo'],['VOLQUETAS DOBLETROQUE','02.11','Cargue terraplen (más de 1 km)',40,'SI']]);   // D174/D178: chips
  return ctx;
}
const ctx=cargar();
const H=ctx.PARTE_BANDEJA_HEADERS, col=(f,k)=>f[H.indexOf(k)];
const bandeja=()=>(ctx._hojas.PARTE_BANDEJA?ctx._hojas.PARTE_BANDEJA._f.slice(1):[]);

const MIME={ '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };
const server=http.createServer((req,res)=>{
  const p=path.join(REPO, decodeURIComponent(req.url.split('?')[0]));
  if(!p.startsWith(REPO) || !fs.existsSync(p) || fs.statSync(p).isDirectory()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(fs.readFileSync(p));
});

(async()=>{
  await new Promise(r=>server.listen(0,r)); const BASE='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch();
  const errores=[];
  let sinSenal=false, posts=0;
  // Un solo contexto (el «teléfono»): localStorage compartido entre navegaciones. SW bloqueado para que
  // la prueba mida offline.js, no la caché del service worker.
  const c=await browser.newContext({ viewport:{width:390,height:844}, serviceWorkers:'block' });
  const pg=await c.newPage();
  pg.on('pageerror',e=>errores.push(String(e)));
  pg.on('console',m=>{ if(m.type()==='error' && !/ERR_FAILED|ERR_INTERNET_DISCONNECTED|net::/.test(m.text())) errores.push(m.text()); });
  pg.on('dialog',d=>d.dismiss());
  await pg.route(/fonts\.(googleapis|gstatic)\.com/, r=>r.abort());
  await pg.route(/api\.galca\.app/, async r=>{
    if(sinSenal){ await r.abort('internetdisconnected'); return; }
    const u=new URL(r.request().url()); let out;
    if(r.request().method()==='POST'){ posts++; out=ctx.doPost({ postData:{ contents:r.request().postData()||'{}' } }); }
    else { const parameter={}; u.searchParams.forEach((v,k)=>parameter[k]=v); out=ctx.doGet({ parameter }); }
    await r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(out) });
  });
  // «Señal» = la API responde. Sin señal se aborta la API y navigator.onLine dice false (en el teléfono
  // real el service worker sirve el HTML del precache; aquí lo sirve el servidor estático, así que NO
  // se usa context.setOffline, que cortaría también el HTML).
  await pg.addInitScript(()=>{ Object.defineProperty(navigator,'onLine',{ configurable:true, get:()=>localStorage.getItem('__prueba_sin_senal')!=='1' }); });
  async function senal(on){
    sinSenal=!on;
    await pg.evaluate(v=>{ if(v) localStorage.setItem('__prueba_sin_senal','1'); else localStorage.removeItem('__prueba_sin_senal'); }, !on);
    if(on) await pg.evaluate(()=>window.dispatchEvent(new Event('online')));
  }
  const $=(sel)=>pg.locator(sel);
  const cola=()=>pg.evaluate(()=>JSON.parse(localStorage.getItem('tm2_cola_envios')||'[]'));

  console.log('\n0 · estático: parte.html carga offline.js y sw.js lo precachea');
  {
    const html=fs.readFileSync(path.join(REPO,'parte.html'),'utf8'), sw=fs.readFileSync(path.join(REPO,'sw.js'),'utf8');
    ok('parte.html incluye offline.js antes de parte.js', html.indexOf('src="offline.js"')>0 && html.indexOf('src="offline.js"')<html.indexOf('src="parte.js"'));
    ok('sw.js precachea parte.html/.js/.css', /'\.\/parte\.html'/.test(sw) && /'\.\/parte\.js'/.test(sw) && /'\.\/parte\.css'/.test(sw));
    ok('CACHE_V subió (v13)', /CACHE_V = 'tm2-v13'/.test(sw));
  }

  console.log('\n1 · CON señal: abre parte.html?eq=VOL048 y guarda la ficha en el teléfono');
  {
    await pg.goto(BASE+'/tema.css'); await senal(true);
    await pg.goto(BASE+'/parte.html?eq=VOL048'); await pg.waitForSelector('#formMain:not(.hidden)');
    ok('chip de señal montado (offline.js)', await $('.tm2off-chip').count()===1);
    ok('ficha guardada en localStorage tm2_cat_parte_VOL048', !!(await pg.evaluate(()=>localStorage.getItem('tm2_cat_parte_VOL048'))));
    ok('sin banner de copia vieja', await $('.tm2off-banner-cat').count()===0);
    ok('inicial precargado del servidor (27120)', await $('.tramo .medidor input').first().inputValue()==='27120');
  }

  console.log('\n2 · SIN señal: abre desde la copia, llena y envía → cola local');
  {
    await senal(false);
    await pg.goto(BASE+'/parte.html?eq=VOL048'); await pg.waitForSelector('#formMain:not(.hidden)');
    ok('el formulario abre sin señal', await $('#formMain').isVisible());
    ok('banner «usando la ficha guardada»', (await $('.tm2off-banner-cat').textContent()).includes('guardada'));
    ok('fecha por defecto = hoy del teléfono', await $('#fecha').inputValue()===HOY);
    ok('inicial precargado de la copia (27120)', await $('.tramo .medidor input').first().inputValue()==='27120');
    await $('#reporteNum').fill('0458');
    await $('#btnOperador').click(); await $('#pickerBuscar').fill('nels'); await $('.picker-item').first().click();
    await $('.tramo .medidor input').nth(1).fill('27250');
    await $('.rep-row .acts .sug').first().click();   // D178: chip de actividad (CC derivado 3701.02.11)
    ok('resumen listo para enviar', (await $('#resumenBody').textContent()).includes('Todo listo'));
    await $('#btnSubmit').click();
    await pg.waitForSelector('#pantallaOk:not(.hidden)');
    ok('confirmación NARANJA «guardado en el teléfono»', (await $('#okTit').textContent()).includes('guardado en el teléfono') && (await $('#okIco').textContent())==='📥');
    const q=await cola();
    ok('1 ítem en la cola, tipo parte, con el payload del equipo', q.length===1 && q[0].tipo==='parte' && q[0].payload.codigo==='VOL048' && q[0].payload.tramos[0].final===27250);
    ok('chip marca 1 pendiente', (await $('.tm2off-chip').textContent()).includes('1 pendiente'));
    ok('el servidor NO recibió nada', posts===0 && bandeja().length===0);
  }

  console.log('\n3 · SIN señal: al reabrir, el inicial es el final del parte pendiente (no el del servidor)');
  {
    await pg.goto(BASE+'/parte.html?eq=VOL048'); await pg.waitForSelector('#formMain:not(.hidden)');
    ok('inicial precargado = 27250 (del parte en cola)', await $('.tramo .medidor input').first().inputValue()==='27250');
    ok('la pista dice que está pendiente de subir', (await $('[id^=hintIni-]').first().textContent()).includes('pendiente de subir'), await $('[id^=hintIni-]').first().textContent());
    ok('otro equipo sin copia → aviso claro, no pantalla rota', await (async()=>{ await pg.goto(BASE+'/parte.html?eq=EXC015'); await pg.waitForSelector('#pantallaError:not(.hidden)'); return (await $('#errorMsg').textContent()).includes('no tiene guardada'); })());
  }

  console.log('\n4 · VUELVE la señal: la cola sube sola y PARTE_BANDEJA recibe UNA copia');
  {
    await pg.goto(BASE+'/parte.html?eq=VOL048'); await pg.waitForSelector('#formMain:not(.hidden)');
    await senal(true);
    await pg.waitForFunction(()=>JSON.parse(localStorage.getItem('tm2_cola_envios')||'[]').length===0, null, {timeout:10000}).catch(()=>{});
    const q=await cola();
    ok('cola vacía tras el evento online', q.length===0, JSON.stringify(q).slice(0,200));
    const f=bandeja();
    ok('PARTE_BANDEJA tiene exactamente 1 fila del envío', f.length===1 && col(f[0],'codigo')==='VOL048' && String(col(f[0],'reporte_num'))==='0458' && Number(col(f[0],'final'))===27250, 'filas='+f.length);
    ok('estado pendiente · origen qr', f.length===1 && col(f[0],'estado')==='pendiente' && col(f[0],'origen')==='qr');
    ok('sin INICIAL_DISTINTO (el inicial cuadró con el último final del servidor)', f.length===1 && !String(col(f[0],'alertas')).includes('INICIAL_DISTINTO'), f.length?String(col(f[0],'alertas')):'');
  }

  console.log('\n5 · Reenvío del mismo payload (id_registro repetido) → duplicada, sin fila nueva');
  {
    const f=bandeja();
    const payload={ mod:'parte', op:'reporte', codigo:'VOL048', origen:'qr', tramos:[{ id_registro:col(f[0],'id_registro'), fecha:HOY, reporte_num:'0458', operador:'Nelson Rangel', inicial:27120, final:27250, hora_de:'07:00', hora_a:'15:30', centro_coste:'3701.02.11', pr:'', uf:'1', descripcion_trabajo:'', horas_varada:'', horas_lluvia:'', observaciones:'', inicial_modificado:'NO' }] };
    const out=ctx.doPost({ postData:{ contents:JSON.stringify(payload) } });
    ok('respuesta ok con duplicadas=1 y guardadas=0', out.ok===true && out.duplicadas===1 && out.guardadas===0, JSON.stringify(out).slice(0,200));
    ok('PARTE_BANDEJA sigue con 1 fila', bandeja().length===1);
  }

  console.log('\n6 · CON señal: reabrir refresca la copia y precarga el final ya guardado en el servidor');
  {
    await pg.goto(BASE+'/parte.html?eq=VOL048'); await pg.waitForSelector('#formMain:not(.hidden)');
    ok('inicial = 27250 desde el servidor, sin banner', await $('.tramo .medidor input').first().inputValue()==='27250' && await $('.tm2off-banner-cat').count()===0);
    ok('chip sin pendientes', !(await $('.tm2off-chip').textContent()).includes('pendiente'));
  }

  console.log('\n7 · Modo demo no toca la cola');
  {
    await pg.goto(BASE+'/parte.html?demo=1'); await pg.waitForSelector('#formMain:not(.hidden)');
    await $('#reporteNum').fill('0001'); await $('#btnOperador').click(); await $('.picker-item').first().click();
    await $('.tramo .medidor input').nth(1).fill('27200');
    await $('.rep-row .acts .sug').first().click();
    await $('#btnSubmit').click(); await pg.waitForSelector('#pantallaOk:not(.hidden)');
    ok('demo: confirmación verde y cola vacía', (await $('#okTit').textContent())==='Parte enviado' && (await cola()).length===0);
  }

  ok('sin errores de JS ni de consola en las pantallas', errores.length===0, errores.join(' | ').slice(0,400));
  await browser.close(); server.close();
  console.log('\n'+(casos-fallos)+'/'+casos+' verificaciones OK'+(fallos?' — '+fallos+' FALLARON':''));
  process.exit(fallos?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
