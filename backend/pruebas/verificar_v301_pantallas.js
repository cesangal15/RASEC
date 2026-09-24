#!/usr/bin/env node
/**
 * Verificación V3-01 / D165 — las DOS pantallas del Parte Digital contra el backend REAL en banco.
 *
 * Chromium (Playwright) abre `parte.html` y `revision-maquinaria.html` servidos desde el repo y
 * cada llamada a la API (api.galca.app, D169) se desvía al Codigo.gs + CodigoParte.gs corriendo en un `vm`
 * de Node con hojas falsas (el mismo arnés de verificar_v301_parte_digital.js). Así lo que se
 * prueba es el flujo completo del checklist §8 del prompt: formulario → filas pendientes → revisión
 * → Base → «Copiar para Excel», con el JS de verdad de las pantallas y sin tocar Google.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node backend/pruebas/verificar_v301_pantallas.js
 */
const fs=require('fs'), path=require('path'), vm=require('vm'), http=require('http');
const { chromium } = require('playwright');
const REPO=path.resolve(__dirname,'..','..');
const SRC=fs.readFileSync(path.join(REPO,'backend','Codigo.gs'),'utf8')+'\n'+fs.readFileSync(path.join(REPO,'backend','CodigoParte.gs'),'utf8');
const OUT=process.env.CAPTURAS || path.join(process.env.TMPDIR||'/tmp','v301-capturas'); fs.mkdirSync(OUT,{recursive:true});
let fallos=0, casos=0;
function ok(n,c,x){ casos++; if(!c){ fallos++; console.log('  ✗ '+n+(x?'  → '+x:'')); } else console.log('  ✓ '+n); }

/* ---------- backend en banco (mismo arnés que verificar_v301_parte_digital.js) ---------- */
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
      base64Encode:()=>'', getUuid:()=>'uuid-'+(++n), formatDate:()=>HOY, Charset:{UTF_8:'utf8'} },
    Logger:{ log(){} }, Session:{ getScriptTimeZone:()=>'America/Bogota' } };
  ctx.globalThis=ctx; vm.createContext(ctx); vm.runInContext(SRC, ctx);
  vm.runInContext('globalThis.PARTE_BANDEJA_HEADERS=PARTE_BANDEJA_HEADERS;', ctx);
  ctx._hojas=hojas;
  hojas.PARTE_EQUIPOS=hojaFalsa([['codigo','tipo','placa','proveedor','medidor','ultima_fecha','ultimo_final','activo'],
    ['VOL048','VOLQUETAS DOBLETROQUE','NNM180','ORTIZ CONSTRUCCIONES Y PROYECTOS S.A.','KM','2026-09-09',27120,'SI'],
    ['CR026','VIBROCOMPACTADOR','POCR026','ORTIZ CONSTRUCCIONES Y PROYECTOS S.A.','HOROMETRO','2026-09-09',1698,'SI'],
    ['EXC015','EXCAVADORAS','MC706830','ORTIZ CONSTRUCCIONES Y PROYECTOS S.A.','HOROMETRO','2026-09-09',2711.6,'SI'],
    ['MO004','MOTONIVELADORAS','MC725594','ORTIZ','HOROMETRO','2026-09-09',2337,'SI'],
    ['WNW030','BRAZO ARTICULADO','','','REVISAR','','','SI']]);
  hojas.PARTE_OPERADORES=hojaFalsa([['operador','partes_ult_4_meses'],['Nelson Rangel',323],['Luis Rincon',212],['Alexander Garcia',211]]);
  hojas.PARTE_CC=hojaFalsa([['centro_coste','proyecto','descripcion_cc','usos_ult_4_meses'],['3701.02.11','3701','',457],['3702.02.11','3702','',460],['3701.02.07','3701','Terraplen',504],['3703.03.06','3703','',560]]);
  hojas.PARTE_ACTIVIDADES=hojaFalsa([['tipo_equipo','descripcion_trabajo','veces'],['VOLQUETAS DOBLETROQUE','Domingo',70],['VOLQUETAS DOBLETROQUE','Cargue terraplen',31],['VIBROCOMPACTADOR','Compactacion terraplen',70]]);
  // D174/D178: tabla actividad → ítem (el ítem 2.11 va como NÚMERO, como lo deja Sheets al importar)
  hojas.PARTE_ITEMS=hojaFalsa([['tipo_equipo','item','actividad','veces','activo'],
    ['VOLQUETAS DOBLETROQUE',2.11,'Cargue terraplen (más de 1 km)',40,'SI'],['VOLQUETAS DOBLETROQUE','02.07','Terraplen',5,'SI'],
    ['VIBROCOMPACTADOR','02.11','Compactando terraplen',30,'SI'],['EXCAVADORAS','02.11','Cargue de volquetas',30,'SI'],['MOTONIVELADORAS','02.11','Cereo terraplen',20,'SI']]);
  return ctx;
}
const HOY=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
const ctx=cargar();
const H=ctx.PARTE_BANDEJA_HEADERS, col=(f,k)=>f[H.indexOf(k)];

/* ---------- servidor estático del repo ---------- */
const MIME={ '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png' };
const server=http.createServer((req,res)=>{
  const p=path.join(REPO, decodeURIComponent(req.url.split('?')[0]));
  if(!p.startsWith(REPO) || !fs.existsSync(p) || fs.statSync(p).isDirectory()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(fs.readFileSync(p));
});

(async()=>{
  await new Promise(r=>server.listen(0,r)); const BASE='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch();
  const errores=[];
  async function pagina(vp, storage){
    // sin service worker (como verificar_d176): con la API en el mismo origen (auth.js, modo sandbox) el SW
    // pediría /parte por su cuenta y Playwright no intercepta las peticiones de un SW (404 del estático).
    const c=await browser.newContext({ viewport:vp, permissions:['clipboard-read','clipboard-write'], serviceWorkers:'block' });
    const pg=await c.newPage();
    pg.on('pageerror',e=>errores.push(String(e))); pg.on('console',m=>{ if(m.type()==='error' && !/ERR_FAILED/.test(m.text())) errores.push(m.text()); });   // fuentes abortadas a propósito
    await pg.route(/fonts\.(googleapis|gstatic)\.com/, r=>r.abort());
    // la API: cada petición se atiende con el backend en banco. Servida desde 127.0.0.1, auth.js (modo
    // sandbox) manda la API al MISMO origen (/obra, /asistencias, /parte): se interceptan las dos formas.
    await pg.route(u=>/api\.galca\.app/.test(u.href) || /^\/(obra|asistencias|parte)$/.test(u.pathname), async r=>{
      const u=new URL(r.request().url()); let out;
      if(r.request().method()==='POST') out=ctx.doPost({ postData:{ contents:r.request().postData()||'{}' } });
      else { const parameter={}; u.searchParams.forEach((v,k)=>parameter[k]=v); out=ctx.doGet({ parameter }); }
      await r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(out) });
    });
    if(storage){ await pg.goto(BASE+'/tema.css'); await pg.evaluate(s=>{ for(const k in s) localStorage.setItem(k,s[k]); }, storage); }
    return pg;
  }
  const $=(pg,sel)=>pg.locator(sel);
  // D207: el CC de revisión es un selector con buscador (botón .cc-pick → escribir → Enter), ya no un <select>.
  const elegirCC=async(pg,boton,cc)=>{ await boton.click(); await pg.locator('.cc-pop .cc-q').fill(cc); await pg.locator('.cc-pop .cc-q').press('Enter'); };
  const post=(c,b,token)=>c.doPost({ postData:{ contents:JSON.stringify(token?Object.assign({token:token},b):b) } });   // directo al backend en banco

  console.log('\n1 · parte.html?eq=VOL048 (390px): precarga y envío de 2 tramos');
  {
    const pg=await pagina({width:390,height:844});
    await pg.goto(BASE+'/parte.html?eq=VOL048'); await pg.waitForSelector('#formMain:not(.hidden)');
    ok('cabecera con el código y tipo/placa', (await $(pg,'#hCodigo').textContent()).includes('VOL048') && (await $(pg,'#hSub').textContent()).includes('NNM180'));
    ok('chip del medidor = KILÓMETROS', (await $(pg,'#hMedidor').textContent())==='KILÓMETROS');
    ok('fecha por defecto hoy (Bogotá)', await $(pg,'#fecha').inputValue()===HOY);
    ok('D179: el campo fecha admite hasta 7 días atrás', await pg.evaluate(()=>{ const f=document.getElementById('fecha'), d=new Date(f.max+'T12:00:00'); d.setDate(d.getDate()-7); return f.min===d.toISOString().slice(0,10); }));
    const ini=$(pg,'.tramo .medidor input').first();
    ok('inicial precargado con el último final (27120)', await ini.inputValue()==='27120');
    await $(pg,'#reporteNum').fill('0457');
    await $(pg,'#btnOperador').click(); await $(pg,'#pickerBuscar').fill('nels'); await $(pg,'.picker-item').first().click();
    ok('operador elegido con el buscador', (await $(pg,'#btnOperador').textContent())==='Nelson Rangel');
    ok('el operador queda recordado para este equipo (localStorage)', await pg.evaluate(()=>localStorage.getItem('tm2_parte_op_VOL048'))==='Nelson Rangel');
    await $(pg,'.tramo .medidor input').nth(1).fill('27250');
    ok('total en vivo = 130 km', (await $(pg,'.total-box .t-val').first().textContent()).startsWith('130'));
    await $(pg,'.tramo input[type=time]').nth(0).fill('07:00'); await $(pg,'.tramo input[type=time]').nth(1).fill('12:00');
    ok('D178: como máximo 5 chips de actividad + «Otra…», sin buscador de CC', (await $(pg,'.rep-row .acts .sug').count())<=6 && (await $(pg,'.rep-row .acts .sug.mas').count())===1 && (await $(pg,'.tramo .picker-btn').count())===0);
    await $(pg,'.rep-row .pr input').first().fill('14400');
    await $(pg,'.rep-row .acts .sug').first().click();
    ok('actividad elegida → frase del operador + CC derivado 3701.02.11 (ítem 2.11 numérico normalizado, D178) · UF1', (await $(pg,'.rep-sel').first().textContent()).includes('3701.02.11') && (await $(pg,'.rep-sel').first().textContent()).includes('Cargue terraplen') && (await $(pg,'.rep-sel').first().textContent()).includes('UF1'));
    await $(pg,'.tramo .sug').first().click();
    ok('sugerencia de actividad al textarea', (await $(pg,'.tramo textarea').first().inputValue())!=='');
    await pg.screenshot({ path:path.join(OUT,'parte_390_tramo1.png'), fullPage:true });
    // V3-18: «＋ Agregar otra actividad» — aparece la tarjeta 2 con su %, la ayuda y la primera se conserva
    ok('V3-18: con UNA actividad no hay tarjetas, % ni ayuda; sí el botón grande', (await $(pg,'.act-card').count())===0 && (await $(pg,'.rep-ayuda').count())===0 && (await $(pg,'.btn-add-act').count())===1);
    await pg.click('.btn-add-act'); await pg.waitForSelector('#act-'+(await $(pg,'.tramo').first().getAttribute('id')).slice(6)+'-1');
    ok('«＋ Agregar otra actividad» abre el reparto a 50/50 conservando el primero', (await $(pg,'.rep-row').count())===2 && await $(pg,'.rep-row input[aria-label=porcentaje]').first().inputValue()==='50' && (await $(pg,'.rep-sel').first().textContent()).includes('3701.02.11'));
    ok('V3-18: dos tarjetas numeradas «Actividad 1/2» con «Quitar», ayuda visible y la nueva resaltada', (await $(pg,'.act-card').count())===2 && (await $(pg,'.act-cab b').nth(1).textContent())==='Actividad 2' && (await $(pg,'.act-cab .btn-del').count())===2 && /2 actividades/.test(await $(pg,'.rep-ayuda').textContent()) && await $(pg,'.act-card').nth(1).evaluate(e=>e.classList.contains('nueva')));
    ok('V3-18: cada tarjeta muestra sus horas junto al % (130 km × 50 % = 65 km)', /65 km/.test(await $(pg,'.pct-h').first().textContent()) && /65 km/.test(await $(pg,'.pct-h').nth(1).textContent()));
    ok('V3-18: la tarjeta 2 sin elegir pide «Falta elegir la actividad 2»', /Falta elegir la actividad 2/.test(await $(pg,'#resumenBody .falta').textContent()));
    await $(pg,'.rep-row').nth(1).locator('.acts .sug').first().click();
    await $(pg,'.rep-row .pr input').nth(1).fill('35.2');   // D178: PR en km
    ok('el PR en km (35.2) manda el proyecto a 3702', (await $(pg,'.rep-sel').nth(1).textContent()).includes('3702.02.11'));
    await $(pg,'.tramo input[type=time]').nth(1).fill('17:00');
    await $(pg,'.tramo .medidor input').nth(1).fill('27400');
    await $(pg,'#btnSubmit').click(); await pg.waitForSelector('#pantallaOk:not(.hidden)');
    ok('pantalla de confirmación con resumen', (await $(pg,'#okMsg').textContent()).includes('2 fila(s)'));
    await pg.screenshot({ path:path.join(OUT,'parte_390_ok.png'), fullPage:true });
    const h=ctx._hojas.PARTE_BANDEJA;
    ok('2 filas pendiente en PARTE_BANDEJA: 27120→27260 y 27260→27400 (140 + 140)', h._f.length===3 && col(h._f[1],'total')===140 && col(h._f[2],'total')===140 && col(h._f[2],'final')===27400 && col(h._f[1],'estado')==='pendiente');
    ok('UF 1 y 2, PR propio de cada CC (35.2 km → 35200 m), mismo nº de parte, origen qr', col(h._f[1],'uf')==='1' && col(h._f[2],'uf')==='2' && col(h._f[1],'pr')===14400 && col(h._f[2],'pr')===35200 && col(h._f[2],'reporte_num')==='0457' && col(h._f[2],'origen')==='qr');
    ok('sin alertas', col(h._f[1],'alertas')==='' && col(h._f[2],'alertas')==='');
    // «Reportar otro tramo»: arranca en 27400
    await pg.click('text=AGREGAR OTRO REGISTRO'); await pg.waitForSelector('#formMain:not(.hidden)');
    ok('«Agregar otro registro» conserva nº de parte y arranca en 27400', await $(pg,'#reporteNum').inputValue()==='0457' && await $(pg,'.tramo .medidor input').first().inputValue()==='27400');
    await pg.context().close();
  }

  console.log('\n2 · parte.html?eq=CR026 (HORÓMETRO): final < inicial bloquea; inicial distinto → alerta');
  {
    const pg=await pagina({width:390,height:844});
    let dialogo=''; pg.on('dialog', async d=>{ dialogo=d.message(); await d.dismiss(); });
    await pg.goto(BASE+'/parte.html?eq=CR026'); await pg.waitForSelector('#formMain:not(.hidden)');
    ok('chip HORÓMETRO e inicial 1698', (await $(pg,'#hMedidor').textContent())==='HORÓMETRO' && await $(pg,'.tramo .medidor input').first().inputValue()==='1698');
    await $(pg,'#reporteNum').fill('0458'); await $(pg,'#btnOperador').click(); await $(pg,'.picker-item').first().click();
    await $(pg,'.tramo .medidor input').nth(1).fill('1690');
    ok('el total sale en rojo', await $(pg,'.total-box').first().evaluate(e=>e.classList.contains('mal')));
    await $(pg,'.rep-row .acts .sug').first().click();
    const antes=ctx._hojas.PARTE_BANDEJA._f.length;
    await $(pg,'#btnSubmit').click(); await pg.waitForTimeout(300);
    ok('el envío se bloquea con el mensaje de final < inicial', /menor que el inicial/.test(dialogo), dialogo);
    ok('y no se escribió nada', ctx._hojas.PARTE_BANDEJA._f.length===antes);
    // inicial distinto al último final
    await $(pg,'.tramo .medidor input').first().fill('1700'); await $(pg,'.tramo .medidor input').nth(1).fill('1706');
    ok('aviso en pantalla de que el inicial cambió', /último registrado era/.test(await $(pg,'.hint').filter({hasText:'último registrado'}).first().textContent()));
    await $(pg,'#btnSubmit').click(); await pg.waitForSelector('#pantallaOk:not(.hidden)');
    const f=ctx._hojas.PARTE_BANDEJA._f[antes];
    ok('llega con alerta INICIAL_DISTINTO e inicial_modificado=SI', col(f,'alertas')==='INICIAL_DISTINTO' && col(f,'inicial_modificado')==='SI', col(f,'alertas'));
    ok('la confirmación lo dice', /INICIAL_DISTINTO/.test(await $(pg,'#okMsg').textContent()));
    await pg.context().close();
  }

  console.log('\n3 · parte.html sin eq: selector de respaldo · Día sin operación');
  {
    const pg=await pagina({width:390,height:844});
    await pg.goto(BASE+'/parte.html'); await pg.waitForSelector('#pantallaQR:not(.hidden)');
    ok('pantalla «Escanea el QR» con la lista de equipos activos', (await $(pg,'#selEquipo option').count())===6);
    await $(pg,'#selEquipo').selectOption('EXC015'); await $(pg,'#pantallaQR .btn-submit').click();
    await pg.waitForSelector('#formMain:not(.hidden)');
    ok('abre el parte del equipo elegido', (await $(pg,'#hCodigo').textContent()).includes('EXC015'));
    await $(pg,'#reporteNum').fill('0459');
    await pg.click('text=Día sin operación'); await pg.click('.motivo:has-text("Domingo")');
    ok('un tramo con inicial = final y CC Domingo/Festivo', await $(pg,'.tramo .medidor input').first().inputValue()==='2711.6' && await $(pg,'.tramo .medidor input').nth(1).inputValue()==='2711.6' && (await $(pg,'.rep-sel').first().textContent()).includes('Domingo/Festivo'));
    await $(pg,'#btnOperador').click(); await $(pg,'.picker-item').first().click();
    await $(pg,'#btnSubmit').click(); await pg.waitForSelector('#pantallaOk:not(.hidden)');
    const f=ctx._hojas.PARTE_BANDEJA._f[ctx._hojas.PARTE_BANDEJA._f.length-1];
    ok('fila con total 0, CC pseudo y descripción = motivo', col(f,'total')===0 && col(f,'centro_coste')==='Domingo/Festivo' && col(f,'descripcion_trabajo')==='Domingo');
    await pg.context().close();
  }

  console.log('\n3b · Reparto por porcentaje desde el formulario · modo demo');
  {
    const pg=await pagina({width:390,height:844});
    await pg.goto(BASE+'/parte.html?eq=MO004'); await pg.waitForSelector('#formMain:not(.hidden)');
    await $(pg,'#reporteNum').fill('0470'); await $(pg,'#btnOperador').click(); await $(pg,'.picker-item').first().click();
    await $(pg,'.tramo .medidor input').first().fill('2337'); await $(pg,'.tramo .medidor input').nth(1).fill('2345');
    await $(pg,'.tramo input[type=time]').nth(0).fill('07:00'); await $(pg,'.tramo input[type=time]').nth(1).fill('15:00');
    await pg.click('.btn-add-act'); await pg.waitForSelector('.rep-quick');
    ok('«＋ Agregar otra actividad» abre dos tarjetas a 50/50', (await $(pg,'.rep-row').count())===2 && await $(pg,'.rep-row input[aria-label=porcentaje]').first().inputValue()==='50');
    await $(pg,'.rep-row').nth(0).locator('.acts .sug').first().click();
    await $(pg,'.rep-row').nth(1).locator('.acts .sug').first().click(); await $(pg,'.rep-row .pr input').nth(1).fill('35200');
    ok('el resumen muestra 4 h + 4 h', /4 h/.test(await $(pg,'.rep-sum').textContent()) && (await $(pg,'.rep-sum b').textContent())==='100 %');
    await pg.click('.rep-quick button:has-text("70 / 30")'); await pg.waitForSelector('.rep');
    ok('«70 / 30» ajusta los porcentajes y conserva los CC', await $(pg,'.rep-row input[aria-label=porcentaje]').first().inputValue()==='70' && (await $(pg,'.rep-sel').nth(1).textContent()).includes('3702.02.11'));
    await $(pg,'.rep-row input[aria-label=porcentaje]').nth(1).fill('40');
    ok('si no suma 100 se avisa en rojo', await $(pg,'.rep-sum').evaluate(e=>e.classList.contains('mal')) && /110/.test(await $(pg,'#resumenBody .falta').textContent()));
    ok('V3-18: y dice cuánto sobra («sobran 10 %»)', /sobran 10 %/.test(await $(pg,'.rep-sum').textContent()));
    // V3-18: una 3ª actividad reparte en partes iguales y quita el reparto rápido de a dos (perdería la 3ª); «Quitar» vuelve a dos
    await pg.click('.btn-add-act'); await pg.waitForSelector('.act-card:nth-child(5)');
    ok('V3-18: con 3 actividades: 33.33 / 33.33 / 33.34, sin «70 / 30», con «partes iguales»', (await $(pg,'.act-card').count())===3 && await $(pg,'.rep-row input[aria-label=porcentaje]').nth(2).inputValue()==='33.34' && (await $(pg,'.rep-quick button:has-text("70 / 30")').count())===0 && (await $(pg,'.rep-quick button:has-text("partes iguales")').count())===1);
    await $(pg,'.act-cab .btn-del').nth(2).click(); await pg.waitForSelector('.rep-quick button:has-text("70 / 30")');
    ok('V3-18: «Quitar» la 3ª vuelve a dos tarjetas a 50/50 conservando sus actividades', (await $(pg,'.act-card').count())===2 && await $(pg,'.rep-row input[aria-label=porcentaje]').first().inputValue()==='50' && (await $(pg,'.rep-sel').nth(1).textContent()).includes('3702.02.11'));
    await pg.click('.rep-quick button:has-text("70 / 30")'); await pg.waitForSelector('.rep');
    await $(pg,'.rep-row input[aria-label=porcentaje]').nth(1).fill('30');
    await pg.screenshot({ path:path.join(OUT,'parte_390_reparto.png'), fullPage:true });
    const antes=ctx._hojas.PARTE_BANDEJA._f.length;
    await $(pg,'#btnSubmit').click(); await pg.waitForSelector('#pantallaOk:not(.hidden)');
    const f=ctx._hojas.PARTE_BANDEJA._f.slice(antes);
    ok('llegan 2 filas: 2337→2342.6 (5.6 h, 70 %) y 2342.6→2345 (2.4 h, 30 %)', f.length===2 && col(f[0],'final')===2342.6 && col(f[0],'total')===5.6 && col(f[1],'inicial')===2342.6 && col(f[1],'total')===2.4, f.map(x=>col(x,'inicial')+'→'+col(x,'final')).join(' | '));
    ok('horas 07:00–12:36 y 12:36–15:00, CC 3701.02.11 / 3702.02.11', col(f[0],'hora_a')==='12:36' && col(f[1],'hora_de')==='12:36' && col(f[1],'hora_a')==='15:00' && col(f[0],'centro_coste')==='3701.02.11' && col(f[1],'centro_coste')==='3702.02.11');
    ok('la confirmación desglosa el reparto', /Parte 1 de 2/.test(await $(pg,'#okTramos').textContent()) && /70 %/.test(await $(pg,'#okTramos').textContent()));
    await pg.context().close();
    // modo demo: sin servidor
    const pd=await pagina({width:390,height:844});
    await pd.route(/api\.galca\.app/, r=>r.abort());   // en demo no debe salir ninguna llamada
    await pd.goto(BASE+'/parte.html?demo=1'); await pd.waitForSelector('#formMain:not(.hidden)');
    ok('demo: carga sin servidor con VOL048 y la barra «MODO DE PRUEBA»', (await $(pd,'#hCodigo').textContent()).includes('VOL048') && !(await $(pd,'#demoBar').evaluate(e=>e.classList.contains('hidden'))));
    await $(pd,'#demoEq').selectOption('CR026'); await pd.waitForFunction(()=>document.getElementById('hCodigo').textContent.includes('CR026'));
    ok('demo: cambia de equipo desde la barra', (await $(pd,'#hMedidor').textContent())==='HORÓMETRO' && await $(pd,'.tramo .medidor input').first().inputValue()==='1698');
    ok('demo: 5 chips de actividad + «Otra…»', (await $(pd,'.rep-row .acts .sug').count())===4 || (await $(pd,'.rep-row .acts .sug').count())===6);
    await $(pd,'.rep-row .acts .sug.mas').click();
    ok('demo: «Otra…» abre el CC opcional y la etiqueta lo dice', (await $(pd,'.rep-row .cc-libre input').count())===1 && /escrita a mano/.test(await $(pd,'.rep-sel').first().textContent()));
    await $(pd,'.rep-row .cc-libre input').fill('3701.2.7');
    ok('demo: «3701.2.7» escrito a mano se normaliza a 3701.02.07 (existe en la lista)', (await $(pd,'.rep-sel').first().textContent()).includes('3701.02.07'));
    await $(pd,'.rep-row .acts .sug').first().click();
    await $(pd,'#reporteNum').fill('1'); await $(pd,'#btnOperador').click(); await $(pd,'.picker-item').first().click(); await $(pd,'.tramo .medidor input').nth(1).fill('1704');
    await $(pd,'#btnSubmit').click(); await pd.waitForSelector('#pantallaOk:not(.hidden)');
    ok('demo: «envía» y avisa que no se guardó nada', /no se guardó nada/.test(await $(pd,'#okMsg').textContent()));
    await pd.context().close();
  }

  console.log('\n4 · revision-maquinaria.html (1440px, admin): pendientes, alertas, aprobar/editar/descartar, manual');
  {
    const pg=await pagina({width:1440,height:900}, { usuario:'admin', rol:'admin', tm2_token:tokenDe('admin','admin') });
    await pg.goto(BASE+'/revision-maquinaria.html'); await pg.waitForSelector('.fila');
    const n=await $(pg,'#pendientes .fila').count();
    ok('carga las 6 pendientes del día (4 + las 2 del reparto)', n===6, String(n));
    ok('la de CR026 muestra la alerta INICIAL_DISTINTO en naranja', await $(pg,'.fila.con-alertas .badge.alerta:has-text("INICIAL_DISTINTO")').count()===1);
    ok('«Equipos sin parte» = WNW030', (await $(pg,'#faltantes .falt').count())===1 && (await $(pg,'#faltantes').textContent()).includes('WNW030'));
    ok('el botón «Aprobar todo lo sin alertas» cuenta 5', /\(5\)/.test(await $(pg,'#btnAprobarTodo').textContent()));
    await pg.screenshot({ path:path.join(OUT,'revision_1440_pendientes.png'), fullPage:true });
    // D207: el CC se elige con un buscador agrupado por UF (también con el backend .gs, que no manda uf/area)
    {
      const b=$(pg,'#pendientes .fila .cc-pick').first(); await b.click(); await pg.waitForSelector('.cc-pop:not(.hidden)');
      await $(pg,'.cc-pop .cc-uf button[data-uf=""]').click();
      const grupos=await $(pg,'.cc-pop .cc-grupo').allTextContents();
      ok('D207: selector de CC agrupado (UF1 antes que UF2, «Sin operación» al final, sin encabezados repetidos)',
        grupos.length>=3 && grupos[0].startsWith('UF1') && grupos.indexOf('Sin operación')===grupos.length-1 && new Set(grupos).size===grupos.length, grupos);
      await $(pg,'.cc-pop .cc-q').fill('terraplen');
      ok('D207: buscar «terraplen» deja solo 3701.02.07', JSON.stringify(await $(pg,'.cc-pop .cc-op b').allTextContents())==='["3701.02.07"]');
      await $(pg,'.cc-pop .cc-q').fill('2.11');
      ok('D207: «2.11» encuentra 3701.02.11 y 3702.02.11 (código abreviado)', (await $(pg,'.cc-pop .cc-op b').allTextContents()).join()==='3701.02.11,3702.02.11');
      await $(pg,'.cc-pop .cc-q').press('Escape');
      ok('D207: Escape cierra sin cambiar el CC ni marcar la tarjeta', await $(pg,'.cc-pop.hidden').count()===1 && await $(pg,'.fila.dirty').count()===0);
    }
    // editar PR en la fila de VOL048 07:00 y aprobarla (campos + estado en una llamada)
    const filaV=$(pg,'#pendientes .fila').filter({ has: pg.locator('input[data-k=hora_de][value="07:00"]') }).filter({ hasText:'VOL048' }).first();
    await filaV.locator('input[data-k=pr]').fill('14500'); await filaV.locator('input[data-k=pr]').dispatchEvent('change');
    await pg.waitForSelector('.fila.dirty');
    ok('al editar, la tarjeta queda marcada y aparece «Guardar»', await $(pg,'.fila.dirty button:has-text("Guardar")').count()===1);
    await $(pg,'.fila.dirty button:has-text("Aprobar")').click(); await pg.waitForFunction(()=>document.querySelectorAll('#pendientes .fila').length===5);
    const h=ctx._hojas.PARTE_BANDEJA, fV=h._f.find(r=>col(r,'codigo')==='VOL048' && col(r,'hora_de')==='07:00');
    ok('la fila quedó aprobada con PR 14500 y revisado_por=admin, el resto intacto', col(fV,'estado')==='aprobado' && col(fV,'pr')===14500 && col(fV,'revisado_por')==='admin' && col(fV,'total')===140);
    // descartar la de CR026
    await $(pg,'#pendientes .fila').filter({hasText:'CR026'}).first().locator('button:has-text("Descartar")').click();
    await pg.waitForFunction(()=>document.querySelectorAll('#pendientes .fila').length===4);
    ok('CR026 descartada y ahora figura en «Equipos sin parte»', col(h._f.find(r=>col(r,'codigo')==='CR026'),'estado')==='descartado' && (await $(pg,'#faltantes').textContent()).includes('CR026'));
    ok('KPI aprobadas = 1', (await $(pg,'#kAprob').textContent())==='1');
    // agregar manual para WNW030
    await $(pg,'#faltantes .falt').filter({hasText:'WNW030'}).locator('button').click(); await pg.waitForSelector('#modal:not(.hidden)');
    await $(pg,'#m_reporte').fill('0460'); await $(pg,'#m_operador').selectOption('Sin operador'); await elegirCC(pg,$(pg,'#m_cc'),'Disponible'); await $(pg,'#m_desc').fill('Disponible - Sin operador');
    await $(pg,'#mGuardar').click(); await pg.waitForFunction(()=>document.querySelectorAll('#pendientes .fila').length===5);
    const fM=h._f[h._f.length-1];
    ok('fila manual creada pendiente con origen=manual y alerta SIN_MEDIDOR', col(fM,'origen')==='manual' && col(fM,'estado')==='pendiente' && col(fM,'alertas')==='SIN_MEDIDOR');
    ok('y WNW030 ya no está en faltantes', !(await $(pg,'#faltantes').textContent()).includes('WNW030'));
    // «Día sin operación» desde Equipos sin parte: CR026 (descartada arriba) marcada como Domingo, sin nº de parte, aprobada de una vez
    ok('la barra «Día sin operación» aparece con CR026 marcada (1 seleccionado)', !(await $(pg,'#sinopBar').evaluate(e=>e.classList.contains('hidden'))) && (await $(pg,'#nSel').textContent())==='1' && await $(pg,'#faltantes .falt input[type=checkbox]').first().isChecked());
    // la misma barra en el teléfono (390px): sin desborde y con el modal abierto
    {
      const pm=await pagina({width:390,height:844}, { usuario:'admin', rol:'admin', tm2_token:tokenDe('admin','admin') });
      await pm.goto(BASE+'/revision-maquinaria.html'); await pm.waitForSelector('#faltantes .falt');
      await $(pm,'.kpi.link').click(); await pm.waitForTimeout(1200);
      await pm.screenshot({ path:path.join(OUT,'revision_390_sinop_lista.png'), fullPage:false });
      await $(pm,'#sinopBar .motivos button:has-text("Lluvia")').click(); await pm.waitForSelector('#modalSinOp:not(.hidden)');
      await pm.screenshot({ path:path.join(OUT,'revision_390_sinop_modal.png'), fullPage:false });
      const an=await pm.evaluate(()=>({ sw:document.documentElement.scrollWidth, w:window.innerWidth, mb:document.querySelector('#modalSinOp .modal-box').scrollWidth, mc:document.querySelector('#modalSinOp .modal-box').clientWidth }));
      ok('390px: la barra y el modal «Día sin operación» no desbordan', an.sw<=an.w+1 && an.mb<=an.mc+1, JSON.stringify(an));
      ok('390px: el motivo Lluvia precarga «Disponible por lluvia» → CC Disponible', await $(pm,'#so_desc').inputValue()==='Disponible por lluvia' && /Disponible$/.test(await $(pm,'#so_motivo option:checked').textContent()));
      await pm.context().close();
    }
    await $(pg,'#sinopBar .motivos button:has-text("Domingo")').click(); await pg.waitForSelector('#modalSinOp:not(.hidden)');
    ok('el modal precarga el medidor de CR026 con su último final (1698), operador «Sin operador» y CC Domingo/Festivo', await $(pg,'#so_med_0').inputValue()==='1698' && await $(pg,'#so_operador').inputValue()==='Sin operador' && /Domingo\/Festivo/.test(await $(pg,'#so_motivo option:checked').textContent()) && await $(pg,'#so_desc').inputValue()==='Domingo');
    await pg.screenshot({ path:path.join(OUT,'revision_1440_sinop.png'), fullPage:true });
    const antesSO=h._f.length;
    await $(pg,'#soGuardar').click(); await pg.waitForFunction(()=>document.getElementById('modalSinOp').classList.contains('hidden') && document.querySelector('#faltantes .vacio'));
    const fSO=h._f[antesSO];
    ok('fila de CR026 creada con inicial = final = 1698, total 0, CC Domingo/Festivo, sin nº de parte y origen manual', h._f.length===antesSO+1 && col(fSO,'codigo')==='CR026' && col(fSO,'inicial')===1698 && col(fSO,'final')===1698 && col(fSO,'total')===0 && col(fSO,'centro_coste')==='Domingo/Festivo' && col(fSO,'reporte_num')==='' && col(fSO,'origen')==='manual' && col(fSO,'descripcion_trabajo')==='Domingo', JSON.stringify(fSO));
    ok('y quedó aprobada de una vez por admin, sin alertas', col(fSO,'estado')==='aprobado' && col(fSO,'revisado_por')==='admin' && col(fSO,'alertas')==='');
    ok('«Equipos sin parte» queda vacío y la KPI en 0', (await $(pg,'#kFalt').textContent())==='0' && (await $(pg,'#faltantes').textContent()).includes('Todos los equipos activos tienen parte'));
    ok('el backend sigue exigiendo nº de parte a un envío QR', /parte físico/.test((post(ctx,{ mod:'parte', op:'reporte', codigo:'MO004', tramos:[{ fecha:HOY, reporte_num:'', operador:'Sin operador', inicial:2337, final:2337, centro_coste:'Domingo/Festivo', descripcion_trabajo:'Domingo' }] })).error||''));
    ok('y a una fila manual con CC real', /parte físico/.test((post(ctx,{ mod:'parte', op:'reporte', origen:'manual', codigo:'MO004', tramos:[{ fecha:HOY, reporte_num:'', operador:'Nelson Rangel', inicial:2337, final:2340, centro_coste:'3701.02.11', descripcion_trabajo:'Cargue' }] }, tokenDe('admin','admin'))).error||''));
    // D178: «⑂ Repartir» la de VOL048 12:00 (27260→27400) en 3701.02.11 70 % / 3702.02.07 30 %
    const filaR=$(pg,'#pendientes .fila').filter({ has: pg.locator('input[data-k=hora_de][value="12:00"]') }).filter({ hasText:'VOL048' }).first();
    await filaR.locator('button:has-text("Repartir")').click(); await pg.waitForSelector('#modalRep:not(.hidden)');
    ok('el modal precarga dos filas 50/50 con el CC actual en la primera', (await $(pg,'#rpFilas .rp-fila').count())===2 && await $(pg,'#rpFilas .rp-fila .cc-pick').first().getAttribute('value')==='3702.02.11' && (await $(pg,'#rpSuma').textContent())==='100 %');
    ok('sin CC en la segunda, el botón está deshabilitado', await $(pg,'#rpGuardar').isDisabled());
    await pg.click('#modalRep .rep-quick button:has-text("70 / 30")');
    await elegirCC(pg,$(pg,'#rpFilas .rp-fila .cc-pick').nth(1),'3701.02.07'); await $(pg,'#rpFilas .rp-fila input[type=text]').nth(1).fill('Terraplen');
    await pg.screenshot({ path:path.join(OUT,'revision_1440_repartir.png'), fullPage:false });
    const antesR=h._f.length;
    await $(pg,'#rpGuardar').click(); await pg.waitForFunction(()=>document.getElementById('modalRep').classList.contains('hidden'));
    await pg.waitForFunction(n=>document.querySelectorAll('#pendientes .fila').length===n, 6);   // 5 − la original + 2 hijas
    const hijas=h._f.slice(antesR), orig=h._f.find(r=>col(r,'codigo')==='VOL048' && col(r,'hora_de')==='12:00' && col(r,'estado')==='descartado');
    ok('la original queda descartada con [Repartido en 2 filas]', !!orig && /Repartido en 2 filas/.test(col(orig,'observaciones')), orig&&col(orig,'observaciones'));
    ok('2 hijas pendientes encadenadas 27260→27358 (98 km, 70 %) y 27358→27400 (42 km, 30 %)', hijas.length===2 && col(hijas[0],'inicial')===27260 && col(hijas[0],'final')===27358 && col(hijas[0],'total')===98 && col(hijas[1],'inicial')===27358 && col(hijas[1],'total')===42 && col(hijas[1],'estado')==='pendiente', hijas.map(x=>col(x,'inicial')+'→'+col(x,'final')).join(' | '));
    ok('CC 3702.02.11 / 3701.02.07, descripción propia en la segunda, chip de reparto en pantalla', col(hijas[0],'centro_coste')==='3702.02.11' && col(hijas[1],'centro_coste')==='3701.02.07' && col(hijas[1],'descripcion_trabajo')==='Terraplen' && (await $(pg,'#pendientes .badge:has-text("Reparto 30")').count())===1);
    ok('las hijas se pueden aprobar (sin alertas): el botón cuenta 5', /\(5\)/.test(await $(pg,'#btnAprobarTodo').textContent()), await $(pg,'#btnAprobarTodo').textContent());
    // aprobar todo lo sin alertas (5: EXC015 domingo, las 2 del reparto de MO004 y las 2 hijas)
    pg.once('dialog', d=>d.accept());
    await $(pg,'#btnAprobarTodo').click(); await pg.waitForFunction(()=>document.querySelectorAll('#pendientes .fila').length===1);
    ok('«Aprobar todo lo sin alertas» deja solo la manual (con alerta)', (await $(pg,'#pendientes .fila').textContent()).includes('WNW030'));
    // Base
    await $(pg,'#tabBase').click(); await pg.waitForSelector('#gridBase td.cq-c');   // D197: cuadrícula tipo Excel
    const filasBase=await $(pg,'#gridBase tbody tr').count();
    ok('Base: 7 aprobadas en el rango (4 + el domingo de CR026 + las 2 hijas del reparto)', filasBase===7, String(filasBase));
    await pg.screenshot({ path:path.join(OUT,'revision_1440_base.png'), fullPage:true });
    await $(pg,'#btnCopiar').click(); await pg.waitForTimeout(200);
    const tsv=await pg.evaluate(()=>navigator.clipboard.readText());
    const lineas=tsv.split('\n');
    ok('«Copiar para Excel»: 7 líneas de 43 columnas (B→AR)', lineas.length===7 && lineas.every(l=>l.split('\t').length===43), lineas.map(l=>l.split('\t').length).join(','));
    const L=l=>{ let n=0; for(const ch of l) n=n*26+(ch.charCodeAt(0)-64); return n-2; };
    const vol=lineas.map(l=>l.split('\t')).find(c=>c[L('F')]==='VOL048' && c[L('AL')]==='07:00');
    const [d,m,y]=HOY.split('-').reverse();
    ok('fecha dd/mm/aaaa en C, KM en V/W, M/N vacías, PR editado en AD, decimales con coma', vol[L('C')]===d+'/'+m+'/'+y && vol[L('V')]==='27120' && vol[L('W')]==='27260' && vol[L('M')]==='' && vol[L('AD')]==='14500' && vol[L('AQ')]==='Nelson Rangel', JSON.stringify(vol));
    const exc=lineas.map(l=>l.split('\t')).find(c=>c[L('F')]==='EXC015');
    ok('horómetro con decimal en coma (2711,6) en M/N', exc[L('M')]==='2711,6' && exc[L('N')]==='2711,6', JSON.stringify(exc));
    // edición en Base
    // D197: se edita en la celda (doble clic), queda pendiente y se manda con «Guardar».
    const ciObs=await pg.evaluate(()=>COLS_BASE.findIndex(c=>c.k==='observaciones'));
    await $(pg,'#gridBase td.cq-c[data-r="0"][data-c="'+ciObs+'"]').dblclick(); await pg.waitForSelector('#gridBase .cq-ed');
    await $(pg,'#gridBase .cq-ed').fill('corregido en base'); await pg.keyboard.press('Enter');
    ok('D197: la celda editada queda pendiente (Guardar 1)', (await $(pg,'#nBase').textContent())==='1');
    await $(pg,'#btnGuardarBase').click(); await pg.waitForFunction(()=>document.getElementById('nBase').textContent==='0');
    ok('editar en Base reescribe solo esa fila', h._f.some(r=>col(r,'observaciones')==='corregido en base') && h._f.filter(r=>col(r,'observaciones')==='corregido en base').length===1);
    // filtro
    await $(pg,'#qBase').fill('EXC015'); await pg.waitForTimeout(100);
    ok('el filtro por equipo acota lo que se copia', (await $(pg,'#kBaseF').textContent())==='1');
    await pg.context().close();
  }

  console.log('\n5 · Guards y menú');
  {
    const pg=await pagina({width:390,height:844}, { usuario:'jefe', rol:'jefe', tm2_token:tokenDe('jefe','jefe') });
    await pg.goto(BASE+'/revision-maquinaria.html'); await pg.waitForTimeout(300);
    // D198: el jefe ya no vuelve al login: entra SOLO a la Base (sin la pestaña ni la vista de Pendientes).
    ok('D198: rol jefe entra solo a la Base (sin Pendientes)', /revision-maquinaria\.html/.test(pg.url())
      && await pg.evaluate(()=>document.getElementById('vistaPend').classList.contains('hidden') && !document.getElementById('vistaBase').classList.contains('hidden')));
    await pg.context().close();
    const pg2=await pagina({width:390,height:844}, { usuario:'parte', rol:'parte_maquinaria', tm2_token:tokenDe('parte','parte_maquinaria') });
    await pg2.goto(BASE+'/revision-maquinaria.html'); await pg2.waitForSelector('.fila, .vacio');
    ok('rol parte_maquinaria entra (390px)', /revision-maquinaria/.test(pg2.url()) && (await $(pg2,'#kPend').textContent())==='1');
    const ancho=await pg2.evaluate(()=>{ const w=window.innerWidth; let peor=null; document.querySelectorAll('body *').forEach(e=>{ const r=e.getBoundingClientRect(); if(r.right>w+1 && (!peor||r.right>peor.r)) peor={r:r.right, s:e.tagName+'.'+e.className}; }); return { sw:document.documentElement.scrollWidth, w:w, peor:peor }; });
    ok('a 390px no hay desborde horizontal', ancho.sw<=ancho.w+1, JSON.stringify(ancho));
    await pg2.screenshot({ path:path.join(OUT,'revision_390.png'), fullPage:true });
    await pg2.context().close();
    // D178: jeisson (asistencia_plus) entra por usuario; el «← Menú» lo devuelve a sus tiles; duvan no entra
    const pgJ=await pagina({width:1440,height:900}, { usuario:'jeisson', rol:'asistencia_plus', tm2_token:tokenDe('jeisson','asistencia_plus') });
    await pgJ.goto(BASE+'/revision-maquinaria.html'); await pgJ.waitForSelector('.fila, .vacio');
    ok('jeisson entra a la revisión y su «← Menú» va a seleccion-reporte.html', /revision-maquinaria/.test(pgJ.url()) && (await $(pgJ,'#btnMenu').getAttribute('data-on-click'))==="irA('seleccion-reporte.html')" && await $(pgJ,'#btnMenu').isVisible());
    await pgJ.goto(BASE+'/seleccion-reporte.html'); await pgJ.waitForSelector('#tiles .tile');
    ok('jeisson ve 5 tiles: asistencia, resumen, flota, revisión de partes y parte digital', (await $(pgJ,'#tiles a.tile').count())===5 && (await $(pgJ,'#tiles a.tile[href="revision-maquinaria.html"]').count())===1 && (await $(pgJ,'#tiles a.tile[href="parte.html"]').count())===1);
    await pgJ.context().close();
    // D193: duvan (lo usa Stiven) y el residente de drenajes revisan; abren filtrados en Drenajes y pueden cambiar.
    const pgD=await pagina({width:390,height:844}, { usuario:'duvan', rol:'asistencia_plus_dren', tm2_token:tokenDe('duvan','asistencia_plus_dren') });
    await pgD.goto(BASE+'/revision-maquinaria.html'); await pgD.waitForSelector('.fila, .vacio');
    ok('D193: duvan entra a la revisión, abre en «Drenajes» y su «← Menú» va a seleccion-reporte.html', /revision-maquinaria/.test(pgD.url()) && (await $(pgD,'#segGrupo button.on').textContent())==='Drenajes' && (await $(pgD,'#btnMenu').getAttribute('data-on-click'))==="irA('seleccion-reporte.html')");
    // el backend de banco (.gs) no manda el grupo de la flota (lo manda el Worker, D190): se marca VOL048 como drenajes
    const cuenta=async()=>pgD.evaluate(()=>[...document.querySelectorAll('#pendientes .fila, #revisadas .fila')].filter(f=>/VOL048/.test(f.textContent)).length);
    await pgD.evaluate(()=>{ LISTAS.equipos=(LISTAS.equipos||[]).map(q=>q.codigo==='VOL048'?Object.assign({}, q, {grupo:'drenajes'}):q); if(!LISTAS.equipos.some(q=>q.codigo==='VOL048')) LISTAS.equipos.push({codigo:'VOL048', grupo:'drenajes'}); setGrupo('drenajes'); });
    const enDren=await cuenta();
    await pgD.click('#segGrupo button[data-g=tierras]');
    const enTie=await cuenta();
    await pgD.click('#segGrupo button[data-g=todos]');
    ok('D193: el filtro separa: VOL048 (drenajes) sale en Drenajes y en Todos, no en Tierras', enDren>0 && enTie===0 && (await cuenta())===enDren, JSON.stringify({enDren, enTie}));
    ok('D193: la elección se recuerda en el navegador', await pgD.evaluate(()=>localStorage.getItem('tm2_rev_grupo'))==='todos');
    await pgD.goto(BASE+'/seleccion-reporte.html'); await pgD.waitForSelector('#tiles .tile');
    ok('D193: duvan ve el acceso a la revisión de partes', (await $(pgD,'#tiles a.tile[href="revision-maquinaria.html"]').count())===1);
    await pgD.context().close();
    const pgRD=await pagina({width:390,height:844}, { usuario:'residente_dren', rol:'residente_dren', tm2_token:tokenDe('residente_dren','residente_dren') });
    await pgRD.goto(BASE+'/seleccion-reporte.html'); await pgRD.waitForSelector('#tiles .tile');
    ok('D193: residente_dren ve el acceso a la revisión de partes', (await $(pgRD,'#tiles a.tile[href="revision-maquinaria.html"]').count())===1);
    await pgRD.goto(BASE+'/revision-maquinaria.html'); await pgRD.waitForSelector('.fila, .vacio');
    ok('D193: residente_dren entra y abre en «Drenajes»', /revision-maquinaria/.test(pgRD.url()) && (await $(pgRD,'#segGrupo button.on').textContent())==='Drenajes');
    await pgRD.context().close();
    const pgU=await pagina({width:390,height:844}, { usuario:'residente_uf3', rol:'asistencia_plus_uf3', tm2_token:tokenDe('residente_uf3','asistencia_plus_uf3') });
    await pgU.goto(BASE+'/revision-maquinaria.html'); await pgU.waitForTimeout(300);
    ok('residente_uf3 (asistencia_plus_uf3) sigue sin entrar: vuelve al login', /index\.html/.test(pgU.url()));
    await pgU.context().close();
    const pgR=await pagina({width:390,height:844}, { usuario:'residente', rol:'residente', tm2_token:tokenDe('residente','residente') });
    await pgR.goto(BASE+'/residente.html'); await pgR.waitForSelector('.tile');
    ok('residente.html: grupo «Maquinaria · parte digital» con revisión y formulario', (await $(pgR,'a.tile[href="revision-maquinaria.html"]').count())===1 && (await $(pgR,'a.tile[href="parte.html"]').count())===1);
    await pgR.goto(BASE+'/revision-maquinaria.html'); await pgR.waitForSelector('.fila, .vacio');
    ok('residente: «← Menú» vuelve a residente.html', (await $(pgR,'#btnMenu').getAttribute('data-on-click'))==="irA('residente.html')");
    await pgR.context().close();
    const pg3=await pagina({width:1440,height:900}, { usuario:'admin', rol:'admin', tm2_token:tokenDe('admin','admin') });
    await pg3.goto(BASE+'/menu.html'); await pg3.waitForSelector('.tile');
    ok('menu.html: accesos a revision-maquinaria.html y parte.html en el grupo Maquinaria', await $(pg3,'a.tile[href="revision-maquinaria.html"]').count()===1 && await $(pg3,'a.tile[href="parte.html"]').count()===1 && await $(pg3,'.pc-g5 .group-label').count()===1);
    ok('menú admin: 18 accesos (D194: Resumen/DATA/BASE/Proyección van por el Hub; sin modo prueba ni estado obsoleto; entra Catálogos)', await $(pg3,'a.tile').count()===18);
    await pg3.screenshot({ path:path.join(OUT,'menu_1440.png'), fullPage:true });
    await pg3.context().close();
  }

  ok('sin errores de JS en ninguna pantalla', errores.length===0, errores.join(' | ').slice(0,300));
  await browser.close(); server.close();
  console.log('\n'+(fallos?('✗ '+fallos+' de '+casos+' casos FALLAN'):('✓ '+casos+' casos pasan'))+'  · capturas en '+OUT);
  process.exit(fallos?1:0);
})().catch(e=>{ console.error(e); server.close(); process.exit(1); });
