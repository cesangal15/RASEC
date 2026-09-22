#!/usr/bin/env node
/**
 * Verificación V3-15 / V3-16 — Tablero de producción: reordenado de secciones,
 * filtro de un día/rango en la gráfica diaria y «Horas del personal por actividad».
 *
 * Chromium (Playwright) abre `tablero-produccion.html` servido desde el repo (estático,
 * sin backend real) e intercepta `?action=tablero_vivo` con una respuesta fija que trae
 * dos períodos, unos días conocidos y un `personal` simulado: así los totales que pinta
 * la pantalla se pueden comprobar contra la aritmética hecha a mano aquí, sin depender
 * del Worker/Sheet reales (que otro desarrollador está tocando en paralelo).
 *
 *   NODE_PATH=<node_modules con playwright> node backend/pruebas/verificar_v315_v316_tablero.js
 */
const fs=require('fs'), path=require('path'), http=require('http');
const { chromium } = require('playwright');
const REPO=path.resolve(__dirname,'..','..');
const OUT=process.env.CAPTURAS || path.join(process.env.TMPDIR||'/tmp','v315-v316-capturas'); fs.mkdirSync(OUT,{recursive:true});
let fallos=0, casos=0;
function ok(n,c,x){ casos++; if(!c){ fallos++; console.log('  ✗ '+n+(x?'  → '+x:'')); } else console.log('  ✓ '+n); }

/* ---------------------------------------------------------------------------
 * FIXTURE — dos períodos con días conocidos + `personal` simulado (V3-16).
 * FC=1 en toda la respuesta para que las cifras compactas mostradas sean EXACTAMENTE
 * las que se suman aquí (sin redondeos de conversión que compliquen las cuentas). */
function dia(f,p,exc,ter1,ter2,sub1,sub2,t){
  const nap=Math.round(exc*0.08), apr=exc-nap;
  return { f, p, exc, apr, pre:0, nap, ter1, ter2, ter:ter1+ter2, sub1, sub2, sub:sub1+sub2, bas1:0, bas2:0, bas:0, t };
}
const DIAS=[
  dia('2026-08-20','2026-08', 500,0,300,0,0,'SOLEADO'),
  dia('2026-08-21','2026-08', 600,0,350,0,0,'SOLEADO'),
  dia('2026-08-22','2026-08', 400,0,250,0,0,'LLUVIAS'),
  dia('2026-09-10','2026-09',1000,400,200,50,0,'SOLEADO'),
  dia('2026-09-11','2026-09',1200,500,300,60,0,'LLUVIAS'),
  dia('2026-09-12','2026-09', 800,300,100,40,0,'LLUVIAS PARCIALES'),
  dia('2026-09-13','2026-09', 900,350,150,0,0,'SOLEADO'),
  dia('2026-09-14','2026-09', 700,250,100,0,0,'SOLEADO'),
];
const PERSONAL=[
  {f:'2026-09-10',uf:'UF1',act:'excavacion',n:10,h:80},
  {f:'2026-09-10',uf:'UF2',act:'excavacion',n:5, h:40},
  {f:'2026-09-11',uf:'UF1',act:'excavacion',n:8, h:64},
  {f:'2026-09-12',uf:'UF1',act:'excavacion',n:12,h:96},
  {f:'2026-09-10',uf:'UF1',act:'terraplen', n:6, h:48},
  {f:'2026-09-11',uf:'UF1',act:'terraplen', n:7, h:56},
  {f:'2026-09-10',uf:'UF1',act:'otras',     n:2, h:16},
];
const PROY={
  fc:1,
  plan:{ '2026-09':{excavacion:5000,terraplen:2000,subbase:200,base:0,noaprov:300} },
  proyectado:{excavacion:850,terraplen:450,subbase:350,base:470},
  contrato:{excavacion:747202.97,terraplen:665465.73,subbase:84203.87,base:92573.49,prestamo:168462},
  base_acum:{excavacion:549153.95,terraplen:385854.98,subbase:46523.83,base:38103.26,prestamo:51895},
  base_corte:'2026-08-16', acta_base:'', actualizado:'', usuario:''
};
function fixtureVivo(personal){
  const j={ ok:true, dias:DIAS, fc:1, fc_dias:1, proy:PROY, horas:null,
            datos_hasta:'2026-09-14', generado:'2026-09-20 08:00' };
  if(personal===null){ j.personal=null; j.personal_error='no llegó de la asistencia (banco)'; }
  else if(personal===undefined){ /* respuesta "vieja": ni personal ni personal_hasta */ }
  else { j.personal=personal; j.personal_hasta='2026-09-12'; }
  return j;
}

/* ---------- servidor estático del repo + intercepción de la API en Playwright ---------- */
const MIME={ '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml' };
const server=http.createServer((req,res)=>{
  const p=path.join(REPO, decodeURIComponent(req.url.split('?')[0]));
  if(!p.startsWith(REPO) || !fs.existsSync(p) || fs.statSync(p).isDirectory()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(fs.readFileSync(p));
});

(async()=>{
  await new Promise(r=>server.listen(0,r)); const BASE='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch();
  const erroresGlobal=[];

  async function pagina(vp, personal){
    const c=await browser.newContext({ viewport:vp, serviceWorkers:'block' });
    const pg=await c.newPage();
    const errores=[];
    pg.on('pageerror', e=>errores.push('pageerror: '+String(e)));
    pg.on('console', m=>{ if(m.type()==='error') errores.push('console: '+m.text()); });
    // Violaciones de CSP: se disparan como evento DOM `securitypolicyviolation`.
    await pg.addInitScript(()=>{
      window.__csp=[];
      document.addEventListener('securitypolicyviolation', e=>{
        window.__csp.push(e.violatedDirective+' :: '+e.blockedURI);
      });
    });
    await pg.route(u=>/api\.galca\.app/.test(u.href) || /^\/(obra|asistencias|parte)$/.test(u.pathname), async r=>{
      const u=new URL(r.request().url());
      const accion=u.searchParams.get('action');
      let body;
      if(accion==='tablero_vivo') body=fixtureVivo(personal);
      else if(accion==='tablero') body={ ok:true, foto:null };
      else body={ ok:true, msg:'API viva' };
      await r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(body) });
    });
    return { pg, errores };
  }
  const $=(pg,sel)=>pg.locator(sel);

  console.log('\n1 · Orden de las secciones (V3-15a)');
  {
    const { pg, errores }=await pagina({width:1440,height:1400}, PERSONAL);
    await pg.goto(BASE+'/tablero-produccion.html');
    await pg.waitForFunction(()=>document.getElementById('perT').textContent!=='—');
    const titulos=await pg.$$eval('.secT, .secT2, .secK', els=>els.map(e=>e.textContent.trim()));
    const esperado=['Producción diaria del período','Horas del personal por actividad',
      'Planificado vs ejecutado del período','Aprovechamiento de la excavación',
      'Avance acumulado contra el contrato','Por qué vamos así','Evolución período a período'];
    ok('las 7 secciones salen en el orden decidido por el dueño', JSON.stringify(titulos)===JSON.stringify(esperado), JSON.stringify(titulos));
    ok('la nota de periodo enlaza a la sección de Evolución', await $(pg,'#capDiaNota a').getAttribute('href')==='#secEvolucion');
    ok('el ancla existe en el bloque de Evolución', await $(pg,'#secEvolucion').count()===1);
    erroresGlobal.push(...errores.map(e=>'[orden] '+e));
    await pg.screenshot({ path:path.join(OUT,'tablero_1440.png'), fullPage:true });
    await pg.context().close();
  }

  console.log('\n2 · Filtro de un día y de un rango (V3-15b)');
  {
    const { pg, errores }=await pagina({width:1440,height:1400}, PERSONAL);
    await pg.goto(BASE+'/tablero-produccion.html');
    await pg.waitForFunction(()=>document.getElementById('perT').textContent!=='—');
    // el período que se ve al abrir es el último = 2026-09 (5 días)
    ok('período inicial = sep 2026', (await $(pg,'#perT').textContent())==='sep 26');
    ok('sin selección, la franja muestra el período completo', /Período completo · 5 días/.test(await $(pg,'#diaResumen').textContent()));
    const cols=$(pg,'#dia .col');
    ok('5 columnas de día, focusables (tabindex=0) con aria-pressed=false', await cols.count()===5 &&
       (await pg.$$eval('#dia .col', els=>els.every(e=>e.tabIndex===0 && e.getAttribute('aria-pressed')==='false'))));
    // clic en el 3er día (2026-09-12) → selección de 1 día
    await cols.nth(2).click();
    ok('un día: aria-pressed=true SOLO en esa columna', JSON.stringify(await pg.$$eval('#dia .col', els=>els.map(e=>e.getAttribute('aria-pressed'))))===JSON.stringify(['false','false','true','false','false']));
    ok('franja: «12 sep» y excavación = 800 (solo ese día)', /^12 sep/.test((await $(pg,'.selTit').textContent()).trim()) && /Excavación 800 m³/.test(await $(pg,'.selTots').textContent()));
    // clic en el 1er día (2026-09-10, anterior) → rango entre los dos, en orden inverso al de los clics
    await cols.nth(0).click();
    ok('rango 10–12 sep · 3 días, en el orden correcto aunque se clicó al revés', /10–12 sep · 3 días/.test(await $(pg,'.selTit').textContent()));
    ok('los días fuera del rango quedan atenuados (día 4 y 5)', await pg.$$eval('#dia .col', els=>[els[3],els[4]].every(e=>e.classList.contains('atenuado'))) &&
       await pg.$$eval('#dia .col', els=>[els[0],els[1],els[2]].every(e=>!e.classList.contains('atenuado'))));
    ok('totales del rango: excavación 3000 · terraplén 1800 · subbase 150', /Excavación 3\.000 m³/.test(await $(pg,'.selTots').textContent()) &&
       /Terraplén 1\.800 m³/.test(await $(pg,'.selTots').textContent()) && /Subbase 150 m³/.test(await $(pg,'.selTots').textContent()));
    ok('clima del rango: 1 soleado · 1 lluvias · 1 lluvias parciales', /1 soleado/.test(await $(pg,'.selClima').textContent()) &&
       /1 lluvias(?! parciales)/.test(await $(pg,'.selClima').textContent()) && /1 lluvias parciales/.test(await $(pg,'.selClima').textContent()));
    // teclado: Enter en el 2º día (dentro del rango) reinicia la selección a un solo día ahí
    await cols.nth(1).focus(); await pg.keyboard.press('Enter');
    ok('un rango ya formado: Enter en otro día EMPIEZA una selección nueva en ese día', /^11 sep/.test((await $(pg,'.selTit').textContent()).trim()));
    // botón «Quitar filtro»
    await $(pg,'.franjaSel .tbtn').click();
    ok('«✕ Quitar filtro» vuelve al período completo, sin columnas atenuadas', /Período completo · 5 días/.test(await $(pg,'.franjaSel').textContent()) &&
       await pg.$$eval('#dia .col', els=>els.every(e=>!e.classList.contains('atenuado') && e.getAttribute('aria-pressed')==='false')));
    // el filtro de UF NO reinicia la selección
    await cols.nth(0).click(); await cols.nth(1).click();
    await $(pg,'#uf button:has-text("UF1")').click();
    ok('cambiar de UF conserva la selección de días', /10–11 sep · 2 días/.test(await $(pg,'.selTit').textContent()));
    // cambiar de período SÍ la reinicia
    await $(pg,'#uf button:has-text("Todo")').click();
    await $(pg,'#evoX span').first().click();   // el mes más viejo del selector (2026-08)
    await pg.waitForFunction(()=>document.getElementById('perT').textContent==='ago 26');
    ok('cambiar de período reinicia el filtro de días', /Período completo · 3 días/.test(await $(pg,'.franjaSel').textContent()));
    erroresGlobal.push(...errores.map(e=>'[filtro] '+e));
    await pg.context().close();
  }

  console.log('\n3 · Horas del personal por actividad (V3-16)');
  {
    const { pg, errores }=await pagina({width:1440,height:1400}, PERSONAL);
    await pg.goto(BASE+'/tablero-produccion.html');
    await pg.waitForFunction(()=>document.getElementById('perT').textContent!=='—');
    // ámbito = período completo (sep, 5 días): nota de corte, porque personal_hasta (12 sep) < último día (14 sep)
    // (fechaCorta formatea "12-sep", con guion, no con espacio)
    ok('con el período completo se avisa que la asistencia llega solo hasta el 12 sep', /asistencia hasta el 12-sep/.test(await $(pg,'#perSub').textContent()));
    // se filtra al rango 10–12 sep (3 días) para las cuentas exactas
    await $(pg,'#dia .col').nth(0).click(); await $(pg,'#dia .col').nth(2).click();
    await pg.waitForFunction(()=>/10–12 sep/.test(document.getElementById('diaResumen').textContent));
    ok('con el rango 10–12, ya NO se avisa del corte (llega justo hasta el último día del ámbito)', !/asistencia hasta/.test(await $(pg,'#perSub').textContent()));
    const filas=await pg.$$eval('#perTabla .ph', els=>els.map(e=>({
      nm:e.querySelector('.nm').textContent.trim(),
      cols:[...e.querySelectorAll('.num')].map(n=>n.textContent.trim())
    })));
    const porNombre=Object.fromEntries(filas.map(f=>[f.nm,f.cols]));
    ok('Excavación: 11,7 personas/día · 280,0 horas-hombre (Σ15+8+12 ÷ 3 días · Σ80+40+64+96)',
       porNombre['Excavación'] && porNombre['Excavación'][0]==='11,7' && porNombre['Excavación'][1]==='280,0', JSON.stringify(porNombre['Excavación']));
    ok('Terraplén: 6,5 personas/día · 104,0 horas-hombre (Σ6+7 ÷ 2 días con reporte · Σ48+56)',
       porNombre['Terraplén'] && porNombre['Terraplén'][0]==='6,5' && porNombre['Terraplén'][1]==='104,0', JSON.stringify(porNombre['Terraplén']));
    ok('Subbase y BTC/Base sin asistencia: «—» y 0,0 h', porNombre['Subbase'][0]==='—' && porNombre['Subbase'][1]==='0,0' &&
       porNombre['BTC / Base'][0]==='—' && porNombre['BTC / Base'][1]==='0,0');
    ok('Otras actividades: 2,0 personas/día · 16,0 horas-hombre (un solo día con reporte)',
       porNombre['Otras actividades'] && porNombre['Otras actividades'][0]==='2,0' && porNombre['Otras actividades'][1]==='16,0');
    ok('Total: 16,7 personas/día · 400,0 horas-hombre (suma por día de TODAS las actividades, no la suma de promedios)',
       porNombre['Total'] && porNombre['Total'][0]==='16,7' && porNombre['Total'][1]==='400,0', JSON.stringify(porNombre['Total']));
    // filtro por UF1: la excavación SÍ se ve partida por UF (a diferencia de la producción)
    await $(pg,'#uf button:has-text("UF1")').click();
    const filasU=await pg.$$eval('#perTabla .ph', els=>els.map(e=>({
      nm:e.querySelector('.nm').textContent.trim(), cols:[...e.querySelectorAll('.num')].map(n=>n.textContent.trim()) })));
    const porNombreU=Object.fromEntries(filasU.map(f=>[f.nm,f.cols]));
    ok('con UF1 la excavación SÍ sale (10,0 personas/día · 240,0 h): a diferencia de la producción, no se omite',
       porNombreU['Excavación'] && porNombreU['Excavación'][0]==='10,0' && porNombreU['Excavación'][1]==='240,0', JSON.stringify(porNombreU['Excavación']));
    // día sin ninguna asistencia (13 sep): «sin asistencia registrada»
    await $(pg,'#uf button:has-text("Todo")').click();
    await $(pg,'.franjaSel .tbtn').click();                    // quitar filtro
    await $(pg,'#dia .col').nth(3).click();                    // 13 sep, sin personal en el fixture
    await pg.waitForFunction(()=>/13 sep/.test(document.getElementById('diaResumen').textContent));
    ok('día sin asistencia: mensaje discreto «Sin asistencia registrada…»', /Sin asistencia registrada para 13 sep/.test(await $(pg,'#perTabla').textContent()));
    erroresGlobal.push(...errores.map(e=>'[personal] '+e));
    await pg.context().close();
  }

  console.log('\n4 · `personal:null` y respuesta vieja (sin el campo) — «sin datos», nunca vacío en silencio');
  {
    const { pg:pgN, errores:errN }=await pagina({width:1200,height:1000}, null);
    await pgN.goto(BASE+'/tablero-produccion.html');
    await pgN.waitForFunction(()=>document.getElementById('perT').textContent!=='—');
    ok('personal:null + personal_error: se ve el motivo, no una tabla en blanco', /Sin datos de asistencia \(no llegó de la asistencia \(banco\)\)/.test(await $(pgN,'#perTabla').textContent()));
    erroresGlobal.push(...errN.map(e=>'[personal-null] '+e));
    await pgN.context().close();

    const { pg:pgV, errores:errV }=await pagina({width:1200,height:1000}, undefined);
    await pgV.goto(BASE+'/tablero-produccion.html');
    await pgV.waitForFunction(()=>document.getElementById('perT').textContent!=='—');
    ok('respuesta vieja sin el campo `personal`: mismo aviso discreto de «sin datos»', /Sin datos de asistencia en esta fuente/.test(await $(pgV,'#perTabla').textContent()));
    erroresGlobal.push(...errV.map(e=>'[personal-viejo] '+e));
    await pgV.context().close();
  }

  console.log('\n5 · Capturas PC y móvil, sin errores de consola ni violaciones de CSP');
  {
    const { pg, errores }=await pagina({width:390,height:1600}, PERSONAL);
    await pg.goto(BASE+'/tablero-produccion.html');
    await pg.waitForFunction(()=>document.getElementById('perT').textContent!=='—');
    await pg.screenshot({ path:path.join(OUT,'tablero_390.png'), fullPage:true });
    const ancho=await pg.evaluate(()=>({ sw:document.documentElement.scrollWidth, w:window.innerWidth }));
    ok('390px: sin desborde horizontal', ancho.sw<=ancho.w+1, JSON.stringify(ancho));
    const csp=await pg.evaluate(()=>window.__csp||[]);
    ok('390px: sin violaciones de CSP', csp.length===0, JSON.stringify(csp));
    erroresGlobal.push(...errores.map(e=>'[390] '+e));
    await pg.context().close();
  }
  ok('sin errores de consola/JS en ninguna de las páginas', erroresGlobal.length===0, erroresGlobal.join(' | ').slice(0,500));

  await browser.close(); server.close();
  console.log('\n'+(fallos?('✗ '+fallos+' de '+casos+' casos FALLAN'):('✓ '+casos+' casos pasan'))+'  · capturas en '+OUT);
  process.exit(fallos?1:0);
})().catch(e=>{ console.error(e); server.close(); process.exit(1); });
