#!/usr/bin/env node
/**
 * Verificación V3-01 / D165 — las DOS pantallas del Parte Digital contra el backend REAL en banco.
 *
 * Chromium (Playwright) abre `parte.html` y `revision-maquinaria.html` servidos desde el repo y
 * cada llamada a script.google.com se desvía al Codigo.gs + CodigoParte.gs corriendo en un `vm`
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
    const c=await browser.newContext({ viewport:vp, permissions:['clipboard-read','clipboard-write'] });
    const pg=await c.newPage();
    pg.on('pageerror',e=>errores.push(String(e))); pg.on('console',m=>{ if(m.type()==='error' && !/ERR_FAILED/.test(m.text())) errores.push(m.text()); });   // fuentes abortadas a propósito
    await pg.route(/fonts\.(googleapis|gstatic)\.com/, r=>r.abort());
    // la API: cada petición se atiende con el backend en banco
    await pg.route(/script\.google\.com/, async r=>{
      const u=new URL(r.request().url()); let out;
      if(r.request().method()==='POST') out=ctx.doPost({ postData:{ contents:r.request().postData()||'{}' } });
      else { const parameter={}; u.searchParams.forEach((v,k)=>parameter[k]=v); out=ctx.doGet({ parameter }); }
      await r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(out) });
    });
    if(storage){ await pg.goto(BASE+'/tema.css'); await pg.evaluate(s=>{ for(const k in s) localStorage.setItem(k,s[k]); }, storage); }
    return pg;
  }
  const $=(pg,sel)=>pg.locator(sel);

  console.log('\n1 · parte.html?eq=VOL048 (390px): precarga y envío de 2 tramos');
  {
    const pg=await pagina({width:390,height:844});
    await pg.goto(BASE+'/parte.html?eq=VOL048'); await pg.waitForSelector('#formMain:not(.hidden)');
    ok('cabecera con el código y tipo/placa', (await $(pg,'#hCodigo').textContent()).includes('VOL048') && (await $(pg,'#hSub').textContent()).includes('NNM180'));
    ok('chip del medidor = KILÓMETROS', (await $(pg,'#hMedidor').textContent())==='KILÓMETROS');
    ok('fecha por defecto hoy (Bogotá)', await $(pg,'#fecha').inputValue()===HOY);
    const ini=$(pg,'.tramo .medidor input').first();
    ok('inicial precargado con el último final (27120)', await ini.inputValue()==='27120');
    await $(pg,'#reporteNum').fill('0457');
    await $(pg,'#btnOperador').click(); await $(pg,'#pickerBuscar').fill('nels'); await $(pg,'.picker-item').first().click();
    ok('operador elegido con el buscador', (await $(pg,'#btnOperador').textContent())==='Nelson Rangel');
    ok('el operador queda recordado para este equipo (localStorage)', await pg.evaluate(()=>localStorage.getItem('tm2_parte_op_VOL048'))==='Nelson Rangel');
    await $(pg,'.tramo .medidor input').nth(1).fill('27250');
    ok('total en vivo = 130 km', (await $(pg,'.total-box .t-val').first().textContent()).startsWith('130'));
    await $(pg,'.tramo input[type=time]').nth(0).fill('07:00'); await $(pg,'.tramo input[type=time]').nth(1).fill('12:00');
    await $(pg,'.tramo .picker-btn').first().click(); await $(pg,'#pickerBuscar').fill('3701.02.11'); await $(pg,'.picker-item').first().click();
    ok('CC elegido (código + descripción de la BASE)', (await $(pg,'.tramo .picker-btn').first().textContent()).includes('3701.02.11'));
    await $(pg,'.rep-row .pr input').first().fill('14400');
    await $(pg,'.tramo .sug').first().click();
    ok('sugerencia de actividad al textarea', (await $(pg,'.tramo textarea').first().inputValue())!=='');
    await pg.screenshot({ path:path.join(OUT,'parte_390_tramo1.png'), fullPage:true });
    // fue a otro CC también: aparece el % y la fila nueva
    await pg.click('.rep button:has-text("otro centro de coste")'); await pg.waitForSelector('.rep-row:nth-of-type(3)');
    ok('«Fue a otro centro de coste también» abre el reparto a 50/50 conservando el primero', (await $(pg,'.rep-row').count())===2 && await $(pg,'.rep-row input[aria-label=porcentaje]').first().inputValue()==='50' && (await $(pg,'.rep-row .picker-btn').first().textContent()).includes('3701.02.11'));
    await $(pg,'.rep-row .picker-btn').nth(1).click(); await $(pg,'#pickerBuscar').fill('3702.02.11'); await $(pg,'.picker-item').first().click();
    await $(pg,'.rep-row .pr input').nth(1).fill('35200');
    await $(pg,'.tramo input[type=time]').nth(1).fill('17:00');
    await $(pg,'.tramo .medidor input').nth(1).fill('27400');
    await $(pg,'#btnSubmit').click(); await pg.waitForSelector('#pantallaOk:not(.hidden)');
    ok('pantalla de confirmación con resumen', (await $(pg,'#okMsg').textContent()).includes('2 fila(s)'));
    await pg.screenshot({ path:path.join(OUT,'parte_390_ok.png'), fullPage:true });
    const h=ctx._hojas.PARTE_BANDEJA;
    ok('2 filas pendiente en PARTE_BANDEJA: 27120→27260 y 27260→27400 (140 + 140)', h._f.length===3 && col(h._f[1],'total')===140 && col(h._f[2],'total')===140 && col(h._f[2],'final')===27400 && col(h._f[1],'estado')==='pendiente');
    ok('UF 1 y 2, PR propio de cada CC, mismo nº de parte, origen qr', col(h._f[1],'uf')==='1' && col(h._f[2],'uf')==='2' && col(h._f[1],'pr')===14400 && col(h._f[2],'pr')===35200 && col(h._f[2],'reporte_num')==='0457' && col(h._f[2],'origen')==='qr');
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
    await $(pg,'.tramo .picker-btn').first().click(); await $(pg,'.picker-item').first().click();
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
    ok('un tramo con inicial = final y CC Domingo/Festivo', await $(pg,'.tramo .medidor input').first().inputValue()==='2711.6' && await $(pg,'.tramo .medidor input').nth(1).inputValue()==='2711.6' && (await $(pg,'.tramo .picker-btn').first().textContent()).includes('Domingo/Festivo'));
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
    await pg.click('.rep button:has-text("otro centro de coste")'); await pg.waitForSelector('.rep-quick');
    ok('«Fue a otro centro de coste también» abre dos renglones a 50/50', (await $(pg,'.rep-row').count())===2 && await $(pg,'.rep-row input[aria-label=porcentaje]').first().inputValue()==='50');
    await $(pg,'.rep-row .picker-btn').nth(0).click(); await $(pg,'#pickerBuscar').fill('3701.02.11'); await $(pg,'.picker-item').first().click();
    await $(pg,'.rep-row .picker-btn').nth(1).click(); await $(pg,'#pickerBuscar').fill('3702.02.11'); await $(pg,'.picker-item').first().click();
    ok('el resumen muestra 4 h + 4 h', /4 h/.test(await $(pg,'.rep-sum').textContent()) && (await $(pg,'.rep-sum b').textContent())==='100 %');
    await pg.click('.rep-quick button:has-text("70 / 30")'); await pg.waitForSelector('.rep');
    ok('«70 / 30» ajusta los porcentajes y conserva los CC', await $(pg,'.rep-row input[aria-label=porcentaje]').first().inputValue()==='70' && (await $(pg,'.rep-row .picker-btn').nth(1).textContent()).includes('3702.02.11'));
    await $(pg,'.rep-row input[aria-label=porcentaje]').nth(1).fill('40');
    ok('si no suma 100 se avisa en rojo', await $(pg,'.rep-sum').evaluate(e=>e.classList.contains('mal')) && /110/.test(await $(pg,'#resumenBody .falta').textContent()));
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
    await pd.route(/script\.google\.com/, r=>r.abort());   // en demo no debe salir ninguna llamada
    await pd.goto(BASE+'/parte.html?demo=1'); await pd.waitForSelector('#formMain:not(.hidden)');
    ok('demo: carga sin servidor con VOL048 y la barra «MODO DE PRUEBA»', (await $(pd,'#hCodigo').textContent()).includes('VOL048') && !(await $(pd,'#demoBar').evaluate(e=>e.classList.contains('hidden'))));
    await $(pd,'#demoEq').selectOption('CR026'); await pd.waitForFunction(()=>document.getElementById('hCodigo').textContent.includes('CR026'));
    ok('demo: cambia de equipo desde la barra', (await $(pd,'#hMedidor').textContent())==='HORÓMETRO' && await $(pd,'.tramo .medidor input').first().inputValue()==='1698');
    await $(pd,'.tramo .picker-btn').first().click();
    ok('demo: el buscador de CC muestra la descripción', (await $(pd,'.picker-item small').first().textContent()).length>3);
    await $(pd,'.picker-item').first().click();
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
    await $(pg,'#m_reporte').fill('0460'); await $(pg,'#m_operador').selectOption('Sin operador'); await $(pg,'#m_cc').selectOption('Disponible'); await $(pg,'#m_desc').fill('Disponible - Sin operador');
    await $(pg,'#mGuardar').click(); await pg.waitForFunction(()=>document.querySelectorAll('#pendientes .fila').length===5);
    const fM=h._f[h._f.length-1];
    ok('fila manual creada pendiente con origen=manual y alerta SIN_MEDIDOR', col(fM,'origen')==='manual' && col(fM,'estado')==='pendiente' && col(fM,'alertas')==='SIN_MEDIDOR');
    ok('y WNW030 ya no está en faltantes', !(await $(pg,'#faltantes').textContent()).includes('WNW030'));
    // aprobar todo lo sin alertas (2: VOL048 12:00 y EXC015 domingo)
    pg.once('dialog', d=>d.accept());
    await $(pg,'#btnAprobarTodo').click(); await pg.waitForFunction(()=>document.querySelectorAll('#pendientes .fila').length===1);
    ok('«Aprobar todo lo sin alertas» deja solo la manual (con alerta)', (await $(pg,'#pendientes .fila').textContent()).includes('WNW030'));
    // Base
    await $(pg,'#tabBase').click(); await pg.waitForSelector('#tbBase tr td b');
    const filasBase=await $(pg,'#tbBase tr').count();
    ok('Base: 5 aprobadas en el rango', filasBase===5, String(filasBase));
    await pg.screenshot({ path:path.join(OUT,'revision_1440_base.png'), fullPage:true });
    await $(pg,'#btnCopiar').click(); await pg.waitForTimeout(200);
    const tsv=await pg.evaluate(()=>navigator.clipboard.readText());
    const lineas=tsv.split('\n');
    ok('«Copiar para Excel»: 5 líneas de 43 columnas (B→AR)', lineas.length===5 && lineas.every(l=>l.split('\t').length===43), lineas.map(l=>l.split('\t').length).join(','));
    const L=l=>{ let n=0; for(const ch of l) n=n*26+(ch.charCodeAt(0)-64); return n-2; };
    const vol=lineas.map(l=>l.split('\t')).find(c=>c[L('F')]==='VOL048' && c[L('AL')]==='07:00');
    const [d,m,y]=HOY.split('-').reverse();
    ok('fecha dd/mm/aaaa en C, KM en V/W, M/N vacías, PR editado en AD, decimales con coma', vol[L('C')]===d+'/'+m+'/'+y && vol[L('V')]==='27120' && vol[L('W')]==='27260' && vol[L('M')]==='' && vol[L('AD')]==='14500' && vol[L('AQ')]==='Nelson Rangel', JSON.stringify(vol));
    const exc=lineas.map(l=>l.split('\t')).find(c=>c[L('F')]==='EXC015');
    ok('horómetro con decimal en coma (2711,6) en M/N', exc[L('M')]==='2711,6' && exc[L('N')]==='2711,6', JSON.stringify(exc));
    // edición en Base
    await $(pg,'#tbBase tr').first().locator('button:has-text("✎")').click(); await pg.waitForSelector('tr.edit');
    await $(pg,'tr.edit textarea[data-k=observaciones]').fill('corregido en base'); await $(pg,'tr.edit button.ok').click();
    await pg.waitForFunction(()=>!document.querySelector('tr.edit'));
    ok('editar en Base reescribe solo esa fila', h._f.some(r=>col(r,'observaciones')==='corregido en base') && h._f.filter(r=>col(r,'observaciones')==='corregido en base').length===1);
    // filtro
    await $(pg,'#fEq').fill('EXC'); await pg.waitForTimeout(100);
    ok('el filtro por equipo acota lo que se copia', (await $(pg,'#kBaseF').textContent())==='1');
    await pg.context().close();
  }

  console.log('\n5 · Guards y menú');
  {
    const pg=await pagina({width:390,height:844}, { usuario:'jefe', rol:'jefe', tm2_token:tokenDe('jefe','jefe') });
    await pg.goto(BASE+'/revision-maquinaria.html'); await pg.waitForTimeout(300);
    ok('rol jefe es devuelto al login', /index\.html/.test(pg.url()));
    await pg.context().close();
    const pg2=await pagina({width:390,height:844}, { usuario:'parte', rol:'parte_maquinaria', tm2_token:tokenDe('parte','parte_maquinaria') });
    await pg2.goto(BASE+'/revision-maquinaria.html'); await pg2.waitForSelector('.fila, .vacio');
    ok('rol parte_maquinaria entra (390px)', /revision-maquinaria/.test(pg2.url()) && (await $(pg2,'#kPend').textContent())==='1');
    const ancho=await pg2.evaluate(()=>{ const w=window.innerWidth; let peor=null; document.querySelectorAll('body *').forEach(e=>{ const r=e.getBoundingClientRect(); if(r.right>w+1 && (!peor||r.right>peor.r)) peor={r:r.right, s:e.tagName+'.'+e.className}; }); return { sw:document.documentElement.scrollWidth, w:w, peor:peor }; });
    ok('a 390px no hay desborde horizontal', ancho.sw<=ancho.w+1, JSON.stringify(ancho));
    await pg2.screenshot({ path:path.join(OUT,'revision_390.png'), fullPage:true });
    await pg2.context().close();
    const pg3=await pagina({width:1440,height:900}, { usuario:'admin', rol:'admin', tm2_token:tokenDe('admin','admin') });
    await pg3.goto(BASE+'/menu.html'); await pg3.waitForSelector('.tile');
    ok('menu.html: accesos a revision-maquinaria.html y parte.html en el grupo Maquinaria', await $(pg3,'a.tile[href="revision-maquinaria.html"]').count()===1 && await $(pg3,'a.tile[href="parte.html"]').count()===1 && await $(pg3,'.pc-g5 .group-label').count()===1);
    ok('los 15 accesos anteriores siguen (18 en total)', await $(pg3,'a.tile').count()===18);
    await pg3.screenshot({ path:path.join(OUT,'menu_1440.png'), fullPage:true });
    await pg3.context().close();
  }

  ok('sin errores de JS en ninguna pantalla', errores.length===0, errores.join(' | ').slice(0,300));
  await browser.close(); server.close();
  console.log('\n'+(fallos?('✗ '+fallos+' de '+casos+' casos FALLAN'):('✓ '+casos+' casos pasan'))+'  · capturas en '+OUT);
  process.exit(fallos?1:0);
})().catch(e=>{ console.error(e); server.close(); process.exit(1); });
