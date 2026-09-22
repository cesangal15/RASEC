#!/usr/bin/env node
/**
 * Verificación V3-15 / V3-16 — Tablero de producción: reordenado de secciones,
 * escala de tiempo didáctica (día/rango con clic, arrastre y teclado) y
 * «Horas del personal por actividad» con desglose por cargo.
 *
 * Chromium (Playwright) abre `tablero-produccion.html` servido desde el repo (estático,
 * sin backend real) e intercepta `?action=tablero_vivo` con una respuesta fija que trae
 * dos períodos, unos días conocidos y un `personal` simulado (con desglose por cargo,
 * V3-16): así los totales que pinta la pantalla se pueden comprobar contra la aritmética
 * hecha a mano aquí, sin depender del Worker/Sheet reales (que otro desarrollador está
 * tocando en paralelo).
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
 * FIXTURE — dos períodos con días conocidos + `personal` simulado (V3-16, con
 * desglose por cargo `c`). FC=1 en toda la respuesta para que las cifras
 * compactas mostradas sean EXACTAMENTE las que se suman aquí (sin redondeos
 * de conversión que compliquen las cuentas). */
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
/* Desglose por cargo (V3-16): en el 12-sep «Sin cargo registrado» pesa MÁS
 * horas que Ayudante (90 > 72) a propósito — así se comprueba que igual queda
 * AL FINAL de la lista, no ordenado por horas como el resto. */
const PERSONAL=[
  {f:'2026-09-10',uf:'UF1',act:'excavacion',n:10,h:80,c:[{k:'Oficial de obra',n:6,h:48},{k:'Ayudante',n:4,h:32}]},
  {f:'2026-09-10',uf:'UF2',act:'excavacion',n:5, h:40,c:[{k:'Oficial de obra',n:3,h:24},{k:'Ayudante',n:2,h:16}]},
  {f:'2026-09-11',uf:'UF1',act:'excavacion',n:8, h:64,c:[{k:'Oficial de obra',n:5,h:40},{k:'Ayudante',n:3,h:24}]},
  {f:'2026-09-12',uf:'UF1',act:'excavacion',n:12,h:96,c:[{k:'Oficial de obra',n:2,h:6},{k:'Sin cargo registrado',n:10,h:90}]},
  {f:'2026-09-10',uf:'UF1',act:'terraplen', n:6, h:48},
  {f:'2026-09-11',uf:'UF1',act:'terraplen', n:7, h:56},
  {f:'2026-09-10',uf:'UF1',act:'otras',     n:2, h:16},
];
/* Misma foto pero SIN `c` en ninguna entrada — «foto vieja» (D316): ninguna
 * fila debe poder desplegarse. */
const PERSONAL_SIN_CARGO=PERSONAL.map(x=>{ const y=Object.assign({},x); delete y.c; return y; });
const PROY={
  fc:1,
  plan:{ '2026-09':{excavacion:5000,terraplen:2000,subbase:200,base:0,noaprov:300} },
  proyectado:{excavacion:850,terraplen:450,subbase:350,base:470},
  contrato:{excavacion:747202.97,terraplen:665465.73,subbase:84203.87,base:92573.49,prestamo:168462},
  base_acum:{excavacion:549153.95,terraplen:385854.98,subbase:46523.83,base:38103.26,prestamo:51895},
  base_corte:'2026-08-16', acta_base:'', actualizado:'', usuario:''
};
/* `conHoras`: incluye maquinaria guardada + `horas_meta.archivo` — sirve para
 * comprobar que el renglón EN VIVO no repite el nombre del archivo (encargo
 * adicional del dueño). */
const ARCHIVO_FIXTURE='partes_septiembre_2026.xlsx';
function fixtureVivo(personal, opts){
  opts=opts||{};
  const j={ ok:true, dias:DIAS, fc:1, fc_dias:1, proy:PROY, horas:null,
            datos_hasta:'2026-09-14', generado:'2026-09-20 08:00' };
  if(personal===null){ j.personal=null; j.personal_error='no llegó de la asistencia (banco)'; }
  else if(personal===undefined){ /* respuesta "vieja": ni personal ni personal_hasta */ }
  else { j.personal=personal; j.personal_hasta='2026-09-12'; }
  if(opts.conHoras){
    j.horas={ partes:[{p:'2026-09',f:'2026-09-14',act:'excavacion',cod:'EXC001',tipo:'EXCAVADORA',
                        uf:'UF1',h:5,mtto:0,varada:0,lluvia:0,averia:0}],
              cc:[], descartadas:0, negativas:0, corte:'2026-09-14' };
    j.horas_meta={ archivo:ARCHIVO_FIXTURE, cargado_ts:'2026-09-18 10:00' };
  }
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

  async function pagina(vp, personal, opts){
    const c=await browser.newContext({ viewport:vp, serviceWorkers:'block' });
    await c.addInitScript(()=>{ try{ localStorage.setItem('rol','admin'); }catch(e){} });
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
      const req=r.request();
      const u=new URL(req.url());
      // GET (tablero/tablero_vivo) manda `action` por query; POST (escribir/tablero_horas_guardar)
      // lo manda en el cuerpo JSON (Content-Type: text/plain, D como en el resto de la app).
      let accion=u.searchParams.get('action');
      if(!accion){ try{ accion=JSON.parse(req.postData()||'{}').action; }catch(e){} }
      let body;
      if(accion==='tablero_vivo') body=fixtureVivo(personal, opts);
      else if(accion==='tablero') body={ ok:true, foto:null };
      else if(accion==='tablero_horas_guardar'){
        if(opts && opts.falloGuardar) body={ ok:false, error:'el Worker rechazó el archivo (demasiado grande)' };
        else body={ ok:true };
      }
      else body={ ok:true, msg:'API viva' };
      await r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(body) });
    });
    return { pg, errores };
  }
  const $=(pg,sel)=>pg.locator(sel);

  console.log('\n1 · Orden de las secciones (V3-15a, enmendado)');
  {
    const { pg, errores }=await pagina({width:1440,height:1400}, PERSONAL);
    await pg.goto(BASE+'/tablero-produccion.html');
    await pg.waitForFunction(()=>document.getElementById('perT').textContent!=='—');
    const titulos=await pg.$$eval('.secT, .secT2, .secK', els=>els.map(e=>e.textContent.trim()));
    const esperado=['Evolución período a período','Producción diaria del período',
      'Planificado vs ejecutado del período','Aprovechamiento de la excavación',
      'Avance acumulado contra el contrato','Por qué vamos así','Horas del personal por actividad'];
    ok('las 7 secciones salen en el orden decidido por el dueño (evolución arriba, personal al final)',
       JSON.stringify(titulos)===JSON.stringify(esperado), JSON.stringify(titulos));
    ok('la nota de periodo ya no enlaza a Evolución (nota discreta)',
       (await $(pg,'#capDiaNota').textContent()).trim()==='Periodo sep 26' && await $(pg,'#capDiaNota a').count()===0);
    erroresGlobal.push(...errores.map(e=>'[orden] '+e));
    await pg.screenshot({ path:path.join(OUT,'tablero_1440.png'), fullPage:true });
    await pg.context().close();
  }

  console.log('\n2 · Escala de tiempo: clic y arrastre (V3-15b)');
  {
    const { pg, errores }=await pagina({width:1440,height:1400}, PERSONAL);
    await pg.goto(BASE+'/tablero-produccion.html');
    await pg.waitForFunction(()=>document.getElementById('perT').textContent!=='—');
    ok('período inicial = sep 2026', (await $(pg,'#perT').textContent())==='sep 26');
    ok('sin selección, la franja muestra el período completo', /Período completo · 5 días/.test(await $(pg,'#diaResumen').textContent()));
    const celdas=$(pg,'#escala .ecell');
    ok('5 celdas en la escala (todo el período), focusables con aria-pressed=false',
       await celdas.count()===5 && await pg.$$eval('#escala .ecell', els=>els.every(e=>e.tabIndex===0 && e.getAttribute('aria-pressed')==='false')));
    ok('cada celda lleva el número del día', JSON.stringify(await pg.$$eval('#escala .ecell .num', els=>els.map(e=>e.textContent.trim())))===JSON.stringify(['10','11','12','13','14']));
    ok('la gráfica grande, sin selección, muestra el período completo (5 barras · máx 1.200)',
       await $(pg,'#dia .col').count()===5 && /1\.200/.test(await $(pg,'#maxDia').textContent()));
    // clic en la 1ª celda (10 sep) -> un día
    await celdas.nth(0).click();
    ok('un día: aria-pressed=true SOLO en esa celda', JSON.stringify(await pg.$$eval('#escala .ecell', els=>els.map(e=>e.getAttribute('aria-pressed'))))===JSON.stringify(['true','false','false','false','false']));
    ok('franja: «10 sep» y excavación = 1000 (solo ese día)', /^10 sep/.test((await $(pg,'.selTit').textContent()).trim()) && /Excavación 1\.000 m³/.test(await $(pg,'.selTots').textContent()));
    ok('la gráfica AMPLÍA a 1 día (1 barra) con su propio máximo (1.000)',
       await $(pg,'#dia .col').count()===1 && /1\.000/.test(await $(pg,'#maxDia').textContent()));
    // clic en la 3ª celda (12 sep) -> rango 10-12
    await celdas.nth(2).click();
    ok('rango 10–12 sep · 3 días', /10–12 sep · 3 días/.test(await $(pg,'.selTit').textContent()));
    ok('celdas fuera del rango quedan atenuadas (día 4 y 5)', await pg.$$eval('#escala .ecell', els=>[els[3],els[4]].every(e=>e.classList.contains('atenuado'))) &&
       await pg.$$eval('#escala .ecell', els=>[els[0],els[1],els[2]].every(e=>!e.classList.contains('atenuado'))));
    ok('la gráfica AMPLÍA a los 3 días del rango (recalcula el máximo a 1.200, el de 11-sep)',
       await $(pg,'#dia .col').count()===3 && /1\.200/.test(await $(pg,'#maxDia').textContent()));
    ok('los números de día bajo las barras son los del rango (10,11,12)',
       JSON.stringify(await pg.$$eval('#diaX span', els=>els.map(e=>e.textContent)))===JSON.stringify(['10','11','12']));
    ok('totales del rango: excavación 3000 · terraplén 1800 · subbase 150', /Excavación 3\.000 m³/.test(await $(pg,'.selTots').textContent()) &&
       /Terraplén 1\.800 m³/.test(await $(pg,'.selTots').textContent()) && /Subbase 150 m³/.test(await $(pg,'.selTots').textContent()));
    // arrastre con el ratón (mouse down/move/up): de la celda 12-sep (idx2) a 14-sep (idx4)
    const c2=await celdas.nth(2).boundingBox(), c4=await celdas.nth(4).boundingBox();
    await pg.mouse.move(c2.x+c2.width/2, c2.y+c2.height/2);
    await pg.mouse.down();
    await pg.mouse.move(c4.x+c4.width/2, c4.y+c4.height/2, {steps:6});
    await pg.mouse.up();
    ok('arrastre: rango 12–14 sep · 3 días', /12–14 sep · 3 días/.test(await $(pg,'.selTit').textContent()));
    ok('la gráfica sigue el arrastre: 3 días, máximo recalculado a 900 (12/13/14-sep)',
       await $(pg,'#dia .col').count()===3 && /^900/.test(await $(pg,'#maxDia').textContent()));
    ok('clima del rango arrastrado: 2 soleado · 1 lluvias parciales', /2 soleado/.test(await $(pg,'.selClima').textContent()) &&
       /1 lluvias parciales/.test(await $(pg,'.selClima').textContent()));
    // botón «Quitar filtro»
    await $(pg,'.franjaSel .tbtn').click();
    ok('«✕ Quitar filtro» vuelve al período completo, sin celdas atenuadas', /Período completo · 5 días/.test(await $(pg,'.franjaSel').textContent()) &&
       await pg.$$eval('#escala .ecell', els=>els.every(e=>!e.classList.contains('atenuado') && e.getAttribute('aria-pressed')==='false')) &&
       await $(pg,'#dia .col').count()===5);
    // el filtro de UF NO reinicia la selección
    await celdas.nth(0).click(); await celdas.nth(1).click();
    await $(pg,'#uf button:has-text("UF1")').click();
    ok('cambiar de UF conserva la selección de días', /10–11 sep · 2 días/.test(await $(pg,'.selTit').textContent()));
    // cambiar de período SÍ la reinicia
    await $(pg,'#uf button:has-text("Todo")').click();
    await $(pg,'#evoX span').first().click();   // el mes más viejo del selector (2026-08)
    await pg.waitForFunction(()=>document.getElementById('perT').textContent==='ago 26');
    ok('cambiar de período reinicia el filtro de días', /Período completo · 3 días/.test(await $(pg,'.franjaSel').textContent()));
    erroresGlobal.push(...errores.map(e=>'[escala-clic] '+e));
    await pg.context().close();
  }

  console.log('\n3 · Escala de tiempo: teclado (V3-15b)');
  {
    const { pg, errores }=await pagina({width:1440,height:1400}, PERSONAL);
    await pg.goto(BASE+'/tablero-produccion.html');
    await pg.waitForFunction(()=>document.getElementById('perT').textContent!=='—');
    const celdas=$(pg,'#escala .ecell');
    await celdas.nth(1).focus();                                     // 11-sep
    await pg.keyboard.press('ArrowRight');                            // mueve el foco a 12-sep, sin seleccionar
    ok('flecha sin Shift: mueve el foco, no selecciona', /Período completo/.test(await $(pg,'#diaResumen').textContent()) &&
       await pg.evaluate(()=>document.activeElement.dataset.idx)==='2');
    await pg.keyboard.press('Shift+ArrowRight');                      // ancla en 12-sep, extiende a 13-sep
    ok('Shift+flecha: extiende el rango (12–13 sep · 2 días)', /12–13 sep · 2 días/.test(await $(pg,'.selTit').textContent()));
    await pg.keyboard.press('Shift+ArrowRight');                      // sigue extendiendo desde la misma ancla -> 12-14
    ok('Shift+flecha otra vez: sigue extendiendo desde la misma ancla (12–14 sep · 3 días)', /12–14 sep · 3 días/.test(await $(pg,'.selTit').textContent()));
    await pg.keyboard.press('Enter');                                 // en el foco actual (14-sep): empieza selección nueva de 1 día
    ok('Enter en un rango ya formado: EMPIEZA una selección nueva de 1 día ahí', /^14 sep/.test((await $(pg,'.selTit').textContent()).trim()));
    await pg.keyboard.press('Escape');
    ok('Esc quita el filtro', /Período completo · 5 días/.test(await $(pg,'.franjaSel').textContent()));
    erroresGlobal.push(...errores.map(e=>'[escala-teclado] '+e));
    await pg.context().close();
  }

  console.log('\n4 · Horas del personal: desglose por cargo (V3-16)');
  {
    const { pg, errores }=await pagina({width:1440,height:1400}, PERSONAL);
    await pg.goto(BASE+'/tablero-produccion.html');
    await pg.waitForFunction(()=>document.getElementById('perT').textContent!=='—');
    ok('con el período completo se avisa que la asistencia llega solo hasta el 12 sep', /asistencia hasta el 12-sep/.test(await $(pg,'#perSub').textContent()));
    // se filtra al rango 10–12 sep (3 días) para las cuentas exactas
    await $(pg,'#escala .ecell').nth(0).click(); await $(pg,'#escala .ecell').nth(2).click();
    await pg.waitForFunction(()=>/10–12 sep/.test(document.getElementById('diaResumen').textContent));
    const filas=await pg.$$eval('#perTabla .ph', els=>els.map(e=>({
      nm:e.querySelector('.nm').lastChild.textContent.trim(),    // sin la flecha (span aparte)
      abrible:e.classList.contains('abrible'),
      cols:[...e.querySelectorAll('.num')].map(n=>n.textContent.trim())
    })));
    const porNombre=Object.fromEntries(filas.map(f=>[f.nm,f]));
    ok('Excavación: 11,7 personas/día · 280,0 horas-hombre, y es desplegable',
       porNombre['Excavación'] && porNombre['Excavación'].cols[0]==='11,7' && porNombre['Excavación'].cols[1]==='280,0' && porNombre['Excavación'].abrible,
       JSON.stringify(porNombre['Excavación']));
    ok('Terraplén trae cifras correctas pero NO es desplegable (sin `c` en sus entradas)',
       porNombre['Terraplén'] && porNombre['Terraplén'].cols[0]==='6,5' && porNombre['Terraplén'].cols[1]==='104,0' && !porNombre['Terraplén'].abrible);
    // abre el desglose de Excavación
    ok('cerrado por defecto: sin subfilas', await $(pg,'#perTabla .phDrop').count()===0);
    await $(pg,'#perTabla .ph.abrible').first().click();
    const cargos=await pg.$$eval('#perTabla .phDrop .phC', els=>els.map(e=>({
      nm:e.querySelector('.nm').textContent.trim(),
      sin:e.classList.contains('phCsin'),
      cols:[...e.querySelectorAll('.num')].map(n=>n.textContent.trim())
    })));
    ok('3 cargos, orden por horas desc salvo «Sin cargo registrado» que va SIEMPRE al final (aunque tenga más horas que Ayudante)',
       JSON.stringify(cargos.map(c=>c.nm))===JSON.stringify(['Oficial de obra','Ayudante','Sin cargo registrado']), JSON.stringify(cargos));
    ok('Oficial de obra: 5,3 personas/día · 118,0 h (Σ6+3+5+2÷3 · Σ48+24+40+6)', cargos[0].cols[0]==='5,3' && cargos[0].cols[1]==='118,0', JSON.stringify(cargos[0]));
    ok('Ayudante: 3,0 personas/día · 72,0 h', cargos[1].cols[0]==='3,0' && cargos[1].cols[1]==='72,0', JSON.stringify(cargos[1]));
    ok('Sin cargo registrado: 3,3 personas/día · 90,0 h, en gris/cursiva con title', cargos[2].cols[0]==='3,3' && cargos[2].cols[1]==='90,0' && cargos[2].sin, JSON.stringify(cargos[2]));
    ok('«Sin cargo registrado» lleva el title del motivo', /falta el cargo en la ficha de personal/.test(
       await $(pg,'#perTabla .phC.phCsin').getAttribute('title')));
    ok('la flecha de Excavación ahora apunta hacia abajo (abierta)', (await $(pg,'#perTabla .ph.abrible .flecha').first().textContent())==='▾');
    // se conserva al cambiar de UF
    await $(pg,'#uf button:has-text("UF1")').click();
    ok('el desglose sigue abierto al cambiar de UF', await $(pg,'#perTabla .phDrop').count()===1);
    const filasU=await pg.$$eval('#perTabla .ph', els=>els.map(e=>({ nm:e.querySelector('.nm').lastChild.textContent.trim(), cols:[...e.querySelectorAll('.num')].map(n=>n.textContent.trim()) })));
    const porNombreU=Object.fromEntries(filasU.map(f=>[f.nm,f.cols]));
    ok('con UF1 la excavación SÍ sale (10,0 personas/día · 240,0 h): a diferencia de la producción, no se omite',
       porNombreU['Excavación'] && porNombreU['Excavación'][0]==='10,0' && porNombreU['Excavación'][1]==='240,0', JSON.stringify(porNombreU['Excavación']));
    const cargosU=await pg.$$eval('#perTabla .phDrop .phC .num', els=>els.map(e=>e.textContent.trim()));
    ok('el desglose por cargo también se recalcula por UF (Oficial 94,0 h de las 240,0 totales)', cargosU.includes('94,0'), JSON.stringify(cargosU));
    // se cierra al volver a hacer clic
    await $(pg,'#uf button:has-text("Todo")').click();
    await $(pg,'#perTabla .ph.abrible').first().click();
    ok('un segundo clic cierra el desglose', await $(pg,'#perTabla .phDrop').count()===0);
    erroresGlobal.push(...errores.map(e=>'[personal-cargo] '+e));
    await pg.context().close();
  }

  console.log('\n5 · `personal:null`, respuesta vieja y sin desglose por cargo');
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

    // foto con `personal` pero SIN `c` en ninguna entrada: las cifras salen, pero ninguna fila se despliega
    const { pg:pgC, errores:errC }=await pagina({width:1200,height:1000}, PERSONAL_SIN_CARGO);
    await pgC.goto(BASE+'/tablero-produccion.html');
    await pgC.waitForFunction(()=>document.getElementById('perT').textContent!=='—');
    ok('sin `c` en ninguna entrada: las cifras se ven pero ninguna fila es desplegable (sin flecha)',
       await pgC.locator('#perTabla .ph').count()>0 && await pgC.locator('#perTabla .ph.abrible').count()===0 &&
       await pgC.locator('#perTabla .flecha').count()===0);
    erroresGlobal.push(...errC.map(e=>'[personal-sin-c] '+e));
    await pgC.context().close();
  }

  console.log('\n6 · Renglón EN VIVO sin nombre de archivo; los errores de carga SÍ lo llevan');
  {
    const { pg, errores }=await pagina({width:1200,height:1000}, PERSONAL, { conHoras:true });
    await pg.goto(BASE+'/tablero-produccion.html');
    await pg.waitForFunction(()=>document.getElementById('perT').textContent!=='—');
    await pg.waitForFunction(()=>/maquinaria al/.test(document.getElementById('estado').textContent));
    const txtEstado=await $(pg,'#estado').textContent();
    ok('el renglón normal NO trae el nombre del archivo ni «.xlsx»', !txtEstado.includes('.xlsx') && !txtEstado.includes(ARCHIVO_FIXTURE), txtEstado);
    ok('el renglón sigue diciendo hasta qué día llega la maquinaria', /maquinaria al 14-sep/.test(txtEstado), txtEstado);
    erroresGlobal.push(...errores.map(e=>'[estado-sin-archivo] '+e));
    await pg.context().close();
  }

  console.log('\n7 · Fallo al GUARDAR los partes: el error SÍ nombra el archivo');
  {
    const { pg, errores }=await pagina({width:1200,height:1000}, PERSONAL, { falloGuardar:true });
    await pg.goto(BASE+'/tablero-produccion.html');
    await pg.waitForFunction(()=>document.getElementById('perT').textContent!=='—');
    // arma un .xlsx mínimo con la hoja BASE MAQUINARIA (una fila coherente con el reparto)
    // y llama a `cargarPartes` directo (función global, sin módulos, D170): evita simular
    // el <input type=file> con un archivo real en disco.
    await pg.evaluate(async()=>{
      const filas=[['#'],['#'],['#']];
      const r=new Array(28).fill(null);
      r[2]=new Date(Date.UTC(2026,8,18));      // C: fecha
      r[5]='EXC001';                           // F: código de máquina (flota del reparto)
      r[14]=5;                                 // O: horas operadas
      r[27]='3701.02.05';                      // AB: centro de coste -> excavación UF1
      filas.push(r);
      const wb=XLSX.utils.book_new();
      const ws=XLSX.utils.aoa_to_sheet(filas,{cellDates:true});
      XLSX.utils.book_append_sheet(wb,ws,'BASE MAQUINARIA');
      const buf=XLSX.write(wb,{type:'array',bookType:'xlsx'});
      const archivo=new File([buf],'partes_prueba_falla.xlsx',{type:'application/octet-stream'});
      await window.cargarPartes(archivo);
    });
    await pg.waitForFunction(()=>/no se pudo cargar/.test(document.getElementById('estado').textContent));
    const txt=await $(pg,'#estado').textContent();
    ok('el error de guardado nombra el archivo que falló', txt.includes('partes_prueba_falla.xlsx'), txt);
    ok('el error de guardado muestra el motivo que dio el servidor', /demasiado grande/.test(txt), txt);
    ok('sigue siendo un aviso ámbar (span.warn dentro del renglón) y no se suavizó', await $(pg,'#estado span.warn').count()===1);
    erroresGlobal.push(...errores.map(e=>'[fallo-guardar] '+e));
    await pg.context().close();
  }

  console.log('\n8 · Capturas PC y móvil, sin errores de consola ni violaciones de CSP');
  {
    const { pg, errores }=await pagina({width:1440,height:1500}, PERSONAL);
    await pg.goto(BASE+'/tablero-produccion.html');
    await pg.waitForFunction(()=>document.getElementById('perT').textContent!=='—');
    // deja una selección de rango y un desglose abierto para la captura
    await $(pg,'#escala .ecell').nth(0).click(); await $(pg,'#escala .ecell').nth(2).click();
    await $(pg,'#perTabla .ph.abrible').first().click();
    await pg.screenshot({ path:path.join(OUT,'tablero_1440.png'), fullPage:true });
    erroresGlobal.push(...errores.map(e=>'[1440] '+e));
    await pg.context().close();
  }
  {
    const { pg, errores }=await pagina({width:390,height:2200}, PERSONAL);
    await pg.goto(BASE+'/tablero-produccion.html');
    await pg.waitForFunction(()=>document.getElementById('perT').textContent!=='—');
    await $(pg,'#escala .ecell').nth(0).click(); await $(pg,'#escala .ecell').nth(2).click();
    await $(pg,'#perTabla .ph.abrible').first().click();
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
