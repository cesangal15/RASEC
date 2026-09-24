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
  /* Fila «Transporte»: personal DIRECTO (el Worker ya excluye capataces,
   * encargados, auxiliares administrativos e ingenieros residentes). */
  {f:'2026-09-10',uf:'UF1',act:'transporte',n:4, h:32,c:[{k:'Conductor',n:3,h:24},{k:'Ayudante',n:1,h:8}]},
  {f:'2026-09-10',uf:'UF2',act:'transporte',n:1, h:8, c:[{k:'Conductor',n:1,h:8}]},
  {f:'2026-09-11',uf:'UF1',act:'transporte',n:2, h:16,c:[{k:'Conductor',n:2,h:16}]},
];
/* Misma foto pero SIN `c` en ninguna entrada — «foto vieja» (D316): ninguna
 * fila debe poder desplegarse. */
const PERSONAL_SIN_CARGO=PERSONAL.map(x=>{ const y=Object.assign({},x); delete y.c; return y; });
/* Foto SIN ninguna entrada `act:'transporte'` — «respuesta vieja» anterior a
 * la fila Transporte debe verse vacía (— / 0,0), como Subbase hoy. */
const PERSONAL_SIN_TRANSPORTE=PERSONAL.filter(x=>x.act!=='transporte');
const PROY={
  fc:1,
  plan:{ '2026-09':{excavacion:5000,terraplen:2000,subbase:200,base:0,noaprov:300} },
  // V3-22/D210: meta MENSUAL de horas-hombre de personal directo (múltiplos de 31 = los días del período
  // 16→15 de sep-2026 —16 de ago a 15 de sep—, para que la prorrata de 3 días dé un número redondo en las
  // pruebas). Subbase y Base se dejan SIN meta a propósito (→ «—», y el Total tampoco suma).
  plan_hh:{ '2026-09':{excavacion:3100,terraplen:3410,subbase:null,base:null} },
  proyectado:{excavacion:850,terraplen:450,subbase:350,base:470},
  contrato:{excavacion:747202.97,terraplen:665465.73,subbase:84203.87,base:92573.49,prestamo:168462},
  base_acum:{excavacion:549153.95,terraplen:385854.98,subbase:46523.83,base:38103.26,prestamo:51895},
  base_corte:'2026-08-16', acta_base:'', actualizado:'', usuario:''
};
/* `conHoras`: incluye maquinaria guardada + `horas_meta.archivo` — sirve para
 * comprobar que el renglón EN VIVO no repite el nombre del archivo (encargo
 * adicional del dueño). */
const ARCHIVO_FIXTURE='partes_septiembre_2026.xlsx';
/* V3-15b: partes CRUDOS de horas (2 máquinas de excavación + 1 de terraplén), en
 * varios días del período y repartidos entre UF1/UF2, con mantenimiento y
 * lluvia — para comprobar que el filtro de días (V3-15b) también filtra la
 * maquinaria de «Por qué vamos así» (bloqueDias del motor). Sin partes el 13 ni
 * el 14-sep a propósito: el corte de horas (`corte`, más abajo) queda en el
 * 13-sep, así que el 13 prueba «selección sin partes dentro del corte» y el 14
 * prueba «selección más allá del corte». */
const EXC_PARTES=[
  {p:'2026-09',f:'2026-09-10',act:'excavacion',cod:'EXC001',tipo:'EXCAVADORA',uf:'UF1',h:6,mtto:0,varada:0,lluvia:0,averia:0},
  {p:'2026-09',f:'2026-09-10',act:'excavacion',cod:'CAT320',tipo:'EXCAVADORA',uf:'UF2',h:4,mtto:0,varada:0,lluvia:1,averia:0},
  {p:'2026-09',f:'2026-09-11',act:'excavacion',cod:'EXC001',tipo:'EXCAVADORA',uf:'UF1',h:5,mtto:1,varada:0,lluvia:0,averia:0},
  {p:'2026-09',f:'2026-09-12',act:'excavacion',cod:'EXC001',tipo:'EXCAVADORA',uf:'UF2',h:7,mtto:0,varada:0,lluvia:0,averia:0},
];
const TER_PARTES=[
  {p:'2026-09',f:'2026-09-10',act:'terraplen',cod:'MO03',tipo:'MOTONIVELADORA',uf:'UF1',h:4,mtto:0,varada:0,lluvia:0,averia:0},
  {p:'2026-09',f:'2026-09-11',act:'terraplen',cod:'MO03',tipo:'MOTONIVELADORA',uf:'UF2',h:3,mtto:0,varada:0,lluvia:0,averia:0},
  {p:'2026-09',f:'2026-09-12',act:'terraplen',cod:'MO03',tipo:'MOTONIVELADORA',uf:'UF1',h:2,mtto:0,varada:0,lluvia:0,averia:0},
];
const HORAS_V315B={ partes:EXC_PARTES.concat(TER_PARTES), cc:[], descartadas:0, negativas:0, corte:'2026-09-13' };
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
  if(opts.horasCustom){
    j.horas=opts.horasCustom;
    j.horas_meta={ archivo:'', cargado_ts:'2026-09-18 10:00' };
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
    ok('subtítulo dice que es personal DIRECTO', /personal directo/.test(await $(pg,'#perSub').textContent()));
    // V3-22/D210: con el PERÍODO COMPLETO (sin selección de días) la meta es la del mes tal cual, SIN prorratear.
    const filasCompleto=await pg.$$eval('#perTabla .ph', els=>els.map(e=>({
      nm:e.querySelector('.nm').lastChild.textContent.trim(),
      cols:[...e.querySelectorAll('.num')].map(n=>n.textContent.trim())
    })));
    const porNombreCompleto=Object.fromEntries(filasCompleto.map(f=>[f.nm,f.cols]));
    ok('Excavación (período completo): meta 3.100,0 (sin prorratear) y 9 % cumplido (280,0 h de 3.100,0)',
       porNombreCompleto['Excavación'] && porNombreCompleto['Excavación'][2]==='3.100,0' && porNombreCompleto['Excavación'][3]==='9%',
       JSON.stringify(porNombreCompleto['Excavación']));
    ok('Subbase/Base sin meta (período completo): «—» en Meta y % cumplido',
       porNombreCompleto['Subbase'] && porNombreCompleto['Subbase'][2]==='—' && porNombreCompleto['Subbase'][3]==='—' &&
       porNombreCompleto['BTC / Base'][2]==='—' && porNombreCompleto['BTC / Base'][3]==='—',
       JSON.stringify([porNombreCompleto['Subbase'],porNombreCompleto['BTC / Base']]));
    ok('Transporte/Otras nunca tienen meta (no es lo que pidió el dueño): «—» en Meta y % cumplido',
       porNombreCompleto['Transporte'][2]==='—' && porNombreCompleto['Transporte'][3]==='—' &&
       porNombreCompleto['Otras actividades'][2]==='—' && porNombreCompleto['Otras actividades'][3]==='—',
       JSON.stringify([porNombreCompleto['Transporte'],porNombreCompleto['Otras actividades']]));
    ok('Total: no TODAS las 4 partidas con meta la tienen cargada (falta Subbase/Base) → «—», no un parcial inventado',
       porNombreCompleto['Total'][2]==='—' && porNombreCompleto['Total'][3]==='—', JSON.stringify(porNombreCompleto['Total']));
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
    // V3-22/D210: con 3 de los 31 días del período (10–12 sep) elegidos, la meta se PRORRATEA por calendario:
    // Excavación 3.100 × 3/31 = 300,0 (280,0 h ÷ 300,0 = 93 %); Terraplén 3.410 × 3/31 = 330,0 (104,0 ÷ 330,0 = 32 %).
    ok('Excavación con 3 días elegidos: meta prorrateada 300,0 y 93 % cumplido',
       porNombre['Excavación'].cols[2]==='300,0' && porNombre['Excavación'].cols[3]==='93%', JSON.stringify(porNombre['Excavación']));
    ok('Terraplén con 3 días elegidos: meta prorrateada 330,0 y 32 % cumplido',
       porNombre['Terraplén'].cols[2]==='330,0' && porNombre['Terraplén'].cols[3]==='32%', JSON.stringify(porNombre['Terraplén']));
    ok('el tooltip de la meta prorrateada dice cuántos días de cuántos', /3 días elegidos de 31 del período/.test(
       await $(pg,'#perTabla .ph .meta').first().getAttribute('title')));
    ok('orden de filas: Excavación, Terraplén, Subbase, BTC/Base, Transporte, Otras actividades, Total',
       JSON.stringify(filas.map(f=>f.nm))===JSON.stringify(['Excavación','Terraplén','Subbase','BTC / Base','Transporte','Otras actividades','Total']),
       JSON.stringify(filas.map(f=>f.nm)));
    ok('Transporte (personal directo): 3,5 personas/día · 56,0 horas-hombre, y es desplegable',
       porNombre['Transporte'] && porNombre['Transporte'].cols[0]==='3,5' && porNombre['Transporte'].cols[1]==='56,0' && porNombre['Transporte'].abrible,
       JSON.stringify(porNombre['Transporte']));
    ok('el Total incluye Transporte: 19,0 personas/día · 456,0 h',
       porNombre['Total'] && porNombre['Total'].cols[0]==='19,0' && porNombre['Total'].cols[1]==='456,0',
       JSON.stringify(porNombre['Total']));
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
    // Transporte: se despliega por cargo igual que las demás
    await $(pg,'#perTabla .ph.abrible').nth(1).click();   // 2º abrible: Excavación(0), Transporte(1)
    const cargosT=await pg.$$eval('#perTabla .phDrop .phC', els=>els.map(e=>({
      nm:e.querySelector('.nm').textContent.trim(),
      cols:[...e.querySelectorAll('.num')].map(n=>n.textContent.trim())
    })));
    ok('Transporte por cargo: Conductor 3,0/48,0 h primero (más horas), Ayudante 0,5/8,0 h después',
       JSON.stringify(cargosT.map(c=>c.nm))===JSON.stringify(['Conductor','Ayudante']) &&
       cargosT[0].cols[0]==='3,0' && cargosT[0].cols[1]==='48,0' &&
       cargosT[1].cols[0]==='0,5' && cargosT[1].cols[1]==='8,0',
       JSON.stringify(cargosT));
    await $(pg,'#perTabla .ph.abrible').nth(1).click();   // cierra Transporte
    erroresGlobal.push(...errores.map(e=>'[personal-cargo] '+e));
    await pg.context().close();
  }

  console.log('\n4b · Sin ninguna entrada `transporte` (respuesta vieja): fila vacía, como Subbase');
  {
    const { pg, errores }=await pagina({width:1200,height:1000}, PERSONAL_SIN_TRANSPORTE);
    await pg.goto(BASE+'/tablero-produccion.html');
    await pg.waitForFunction(()=>document.getElementById('perT').textContent!=='—');
    const filas=await pg.$$eval('#perTabla .ph', els=>els.map(e=>({
      nm:e.querySelector('.nm').lastChild.textContent.trim(),
      abrible:e.classList.contains('abrible'),
      cols:[...e.querySelectorAll('.num')].map(n=>n.textContent.trim())
    })));
    const porNombre=Object.fromEntries(filas.map(f=>[f.nm,f]));
    ok('sin ninguna entrada `act:transporte`: la fila sale vacía (— / 0,0), sin flecha',
       porNombre['Transporte'] && porNombre['Transporte'].cols[0]==='—' && porNombre['Transporte'].cols[1]==='0,0' && !porNombre['Transporte'].abrible,
       JSON.stringify(porNombre['Transporte']));
    erroresGlobal.push(...errores.map(e=>'[personal-sin-transporte] '+e));
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
  console.log('\n9 · El filtro de días también filtra la maquinaria (cadena «Por qué vamos así», V3-15b)');
  {
    const { pg, errores }=await pagina({width:1440,height:1400}, PERSONAL, { horasCustom:HORAS_V315B });
    await pg.goto(BASE+'/tablero-produccion.html');
    await pg.waitForFunction(()=>document.getElementById('perT').textContent!=='—');

    /* Aritmética escrita APARTE, a partir del mismo fixture, para comprobar la
     * fórmula (no solo que la pantalla llame a bloqueDias): standby por máquina =
     * sus días DISTINTOS × su jornada programada, menos mantenimiento/varada/
     * avería; utilización = horas ÷ standby ajustado; eficiencia = (producción ÷
     * horas) ÷ vara por hora; velocidad = producción ÷ (vara por hora × 8 × días-
     * máquina). Formato con los mismos separadores que `f0/f1/pct` de la página
     * (sin depender del locale de Node). */
    const HPROG_T={EXC001:6.4,CAT320:5,MO03:6.4};
    const round1=n=>+n.toFixed(1), round4=n=>+n.toFixed(4);
    function calc(dd,partes,key,metaHact){
      const prod=dd.reduce((s,d)=>s+(d[key]||0),0);
      const g={horas:0,mtto:0,varada:0,lluvia:0,averia:0,maq:{}};
      for(const x of partes){
        g.horas+=x.h; g.mtto+=x.mtto; g.varada+=x.varada; g.lluvia+=x.lluvia; g.averia+=x.averia;
        const q=(g.maq[x.cod]=g.maq[x.cod]||{h:0,perd:0,dias:new Set(),ajuste:0});
        q.h+=x.h; q.perd+=x.mtto+x.varada+x.lluvia+x.averia; q.ajuste+=x.mtto+x.varada+x.averia; q.dias.add(x.f);
      }
      const maq=Object.entries(g.maq).map(([cod,q])=>{
        const hprog=HPROG_T[cod]||6.4;
        return { cod, h:round1(q.h), perd:round1(q.perd), dias:q.dias.size,
                 sb:round1(q.dias.size*hprog), sb_aj:round1(Math.max(0,q.dias.size*hprog-q.ajuste)) };
      });
      const vivas=maq.filter(q=>(q.h+q.perd)>0);
      const sb=round1(vivas.reduce((s,q)=>s+q.sb,0));
      const ajuste=round1(g.mtto+g.varada+g.averia);
      const sbAj=round1(Math.max(0,sb-ajuste));
      const util=sbAj>0 ? round4(Math.min(1,g.horas/sbAj)) : null;
      const mh=g.horas>0 ? Math.round(prod/g.horas*100)/100 : null;   // r2, como m.mh del motor
      const metaHora=+metaHact.toFixed(2);
      const ef=metaHora ? mh/metaHora : 0;
      const dmaq=vivas.reduce((s,q)=>s+q.dias,0);
      const espVel=(metaHora&&dmaq>0) ? metaHora*8*dmaq : null;
      const vel=espVel ? prod/espVel : null;
      const nd=dd.filter(d=>(d[key]||0)>0).length;
      return { horas:g.horas, util, ef, vel, espVel, prod, sbAj, lluvia:g.lluvia, nd, falta:round1(sbAj-g.horas) };
    }
    const F0=n=>{ n=Math.round(n||0); return String(n).replace(/\B(?=(\d{3})+(?!\d))/g,'.'); };
    const F1=n=>{ n=n||0; const neg=n<0; n=Math.abs(n); const [ip,dp]=n.toFixed(1).split('.');
      return (neg?'-':'')+ip.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+','+dp; };
    const PCT=n=>Math.round((n||0)*100)+'%';
    function subUtilEsperado(c){
      if(c.falta<=0) return F1(c.horas)+' de '+F1(c.sbAj)+' h de standby · '+F1(Math.max(0,-c.falta))+' h de más';
      const llu=Math.min(c.lluvia||0,c.falta), mudo=+(c.falta-llu).toFixed(1), tr=[];
      if(llu>0) tr.push(F1(llu)+' por lluvia'); if(mudo>0) tr.push(F1(mudo)+' sin motivo anotado');
      return F1(c.horas)+' de '+F1(c.sbAj)+' h de standby · faltaron '+F1(c.falta)+' h'+(tr.length?': '+tr.join(' y '):'');
    }
    const fila=()=>pg.locator('#chain .chainR').nth(0);
    const lnk=i=>fila().locator('.lnk').nth(i);
    async function leerFila(){
      return { horas:await lnk(0).locator('.syne.val').textContent(), horasSub:await lnk(0).locator('.s').textContent(),
               util:await lnk(1).locator('.syne.val').textContent(), utilSub:await lnk(1).locator('.s').textContent(),
               ef:await lnk(2).locator('.syne.val').textContent(),
               vel:await fila().locator('.velC .syne.big').textContent(), velSub:await fila().locator('.velC .s').textContent() };
    }
    const D=Object.fromEntries(DIAS.filter(d=>d.p==='2026-09').map(d=>[d.f,d]));
    const excTodos=HORAS_V315B.partes.filter(x=>x.act==='excavacion');
    const terTodos=HORAS_V315B.partes.filter(x=>x.act==='terraplen');
    const META_H_EXC=850/8, META_H_TER=450/8;

    const avanceInicial=await $(pg,'#avance').textContent(), planInicial=await $(pg,'#planPer').textContent();

    // a) sin selección: cifras del período completo — no hay regresión sobre lo de siempre
    {
      const c=calc(Object.values(D), excTodos, 'exc', META_H_EXC);
      const f=await leerFila();
      ok('sin selección: horas/utilización/eficiencia/velocidad de excavación coinciden con el período completo',
         f.horas===F0(c.horas) && f.util===PCT(c.util) && f.ef===PCT(c.ef) && f.vel===PCT(c.vel), JSON.stringify({f,c}));
    }

    // b) un día (10-sep)
    await $(pg,'#escala .ecell').nth(0).click();
    await pg.waitForFunction(()=>/^10 sep/.test(document.querySelector('.selTit').textContent.trim()));
    {
      const c=calc([D['2026-09-10']], excTodos.filter(x=>x.f==='2026-09-10'), 'exc', META_H_EXC);
      const f=await leerFila();
      ok('un día (10-sep): horas '+F0(c.horas)+' h · utilización '+PCT(c.util)+' · eficiencia '+PCT(c.ef)+' · velocidad '+PCT(c.vel),
         f.horas===F0(c.horas) && f.util===PCT(c.util) && f.ef===PCT(c.ef) && f.vel===PCT(c.vel) &&
         f.utilSub===subUtilEsperado(c) && f.velSub===F0(c.prod)+' m³ de '+F0(c.espVel)+' m³' &&
         f.horasSub===c.nd+' días con registro', JSON.stringify({f,c}));
      ok('la nota de la cadena dice el ámbito de un día', (await $(pg,'#chainNote').textContent())==='Maquinaria el 10 sep');
    }

    // c) rango 10-12 sep
    await $(pg,'#escala .ecell').nth(2).click();
    await pg.waitForFunction(()=>/10–12 sep/.test(document.querySelector('.selTit').textContent));
    {
      const dd=[D['2026-09-10'],D['2026-09-11'],D['2026-09-12']];
      const partes=excTodos.filter(x=>x.f>='2026-09-10' && x.f<='2026-09-12');
      const c=calc(dd, partes, 'exc', META_H_EXC);
      const f=await leerFila();
      ok('rango 10–12 sep: horas '+F0(c.horas)+' h · utilización '+PCT(c.util)+' · eficiencia '+PCT(c.ef)+' · velocidad '+PCT(c.vel),
         f.horas===F0(c.horas) && f.util===PCT(c.util) && f.ef===PCT(c.ef) && f.vel===PCT(c.vel) &&
         f.utilSub===subUtilEsperado(c), JSON.stringify({f,c}));
      ok('la nota de la cadena dice el ámbito del rango', (await $(pg,'#chainNote').textContent())==='Maquinaria del 10 al 12 sep');
      // captura con una actividad de la cadena desplegada (su desglose por máquina)
      await fila().click();
      await pg.waitForFunction(()=>document.querySelectorAll('#chain .drop').length===1);
      await pg.screenshot({ path:process.env.CAPTURA_CADENA || path.join(OUT,'cadena_filtro.png'), fullPage:true });
    }

    // d) filtro de UF combinado con el rango — terraplén, que SÍ viene partido por UF
    // (la excavación se omite: DATOS no la trae partida por UF, como en el resto de la página)
    await $(pg,'#uf button:has-text("UF1")').click();
    await pg.waitForFunction(()=>/Sólo UF1/.test(document.getElementById('chainNote').textContent));
    {
      const dd=[D['2026-09-10'],D['2026-09-11'],D['2026-09-12']];
      const partes=terTodos.filter(x=>x.uf==='UF1' && x.f>='2026-09-10' && x.f<='2026-09-12');
      const c=calc(dd, partes, 'ter1', META_H_TER);
      const f=await leerFila();
      ok('rango + UF1: fila de terraplén con horas '+F0(c.horas)+' h · utilización '+PCT(c.util)+' · eficiencia '+PCT(c.ef)+' · velocidad '+PCT(c.vel),
         f.horas===F0(c.horas) && f.util===PCT(c.util) && f.ef===PCT(c.ef) && f.vel===PCT(c.vel), JSON.stringify({f,c}));
      ok('con UF puesta la nota sigue diciendo el rango, además de que la excavación no viene por UF',
         (await $(pg,'#chainNote').textContent())==='Maquinaria del 10 al 12 sep · Sólo UF1 · la excavación no viene partida por UF');
    }
    await $(pg,'#uf button:has-text("Todo")').click();

    // e) selección sin partes, DENTRO del corte de horas (13-sep): mensaje claro, sin retroceder de período
    await $(pg,'#escala .ecell').nth(3).click();
    await pg.waitForFunction(()=>/^13 sep/.test(document.querySelector('.selTit').textContent.trim()));
    ok('13-sep sin partes: mensaje claro y sin fila de cadena',
       /^Sin partes de maquinaria el 13 sep\.$/.test((await $(pg,'#chain .nota').textContent()).trim()) &&
       await $(pg,'#chain .chainR').count()===0);

    // f) selección MÁS ALLÁ del corte de horas (14-sep): mismo mensaje + hasta cuándo llega la maquinaria
    await $(pg,'#escala .ecell').nth(3).click();          // 13-sep ya estaba solo: este clic lo apaga
    await $(pg,'#escala .ecell').nth(4).click();           // 14-sep, selección nueva de un día
    await pg.waitForFunction(()=>/^14 sep/.test(document.querySelector('.selTit').textContent.trim()));
    ok('14-sep, más allá del corte: mensaje + aviso de hasta cuándo llega la maquinaria cargada',
       /^Sin partes de maquinaria el 14 sep\. Maquinaria cargada hasta el 13-sep\.$/.test((await $(pg,'#chain .nota').textContent()).trim()));

    // g) foto sin partes crudos: bloqueDias no sobrevive a una foto publicada en JSON
    await pg.evaluate(()=>{ delete TM2.bloqueDias; pinta(); });
    ok('sin bloqueDias (foto sin cálculo en vivo) con selección puesta: pide recalcular en vivo, sin romper la página',
       /necesita el cálculo en vivo/.test(await $(pg,'#chain .nota').textContent()));

    // el filtro de días sigue sin tocar Plan vs ejecutado ni Avance acumulado (van por período completo)
    ok('Plan vs ejecutado y Avance acumulado no cambian con la selección de días puesta',
       (await $(pg,'#avance').textContent())===avanceInicial && (await $(pg,'#planPer').textContent())===planInicial);

    erroresGlobal.push(...errores.map(e=>'[cadena-dias] '+e));
    await pg.context().close();
  }

  console.log('\n10 · D209: jun y jul-2025 (solo horas, sin producción) no salen en el Tablero');
  {
    const viejos=[
      {p:'2025-06',f:'2025-06-20',act:'excavacion',cod:'EXC001',tipo:'EXCAVADORA',uf:'UF1',h:6,mtto:0,varada:0,lluvia:0,averia:0},
      {p:'2025-07',f:'2025-07-10',act:'terraplen',cod:'MO03',tipo:'MOTONIVELADORA',uf:'UF1',h:5,mtto:0,varada:0,lluvia:0,averia:0},
      {p:'2025-08',f:'2025-08-05',act:'excavacion',cod:'EXC001',tipo:'EXCAVADORA',uf:'UF1',h:7,mtto:0,varada:0,lluvia:0,averia:0}];   // D214
    const horas=Object.assign({},HORAS_V315B,{ partes:HORAS_V315B.partes.concat(viejos) });
    const { pg, errores }=await pagina({width:1440,height:1000}, PERSONAL, { horasCustom:horas });
    await pg.goto(BASE+'/tablero-produccion.html');
    await pg.waitForFunction(()=>document.getElementById('perT').textContent!=='—');
    const meses=await pg.$$eval('#evoX span', els=>els.map(e=>e.textContent.trim()));
    ok('Evolución solo muestra desde ago-2026 del fixture: ni «jun 25», ni «jul 25», ni «ago 25» (D214) aunque haya partes de esos meses',
       meses.length===2 && !meses.some(m=>/25$/.test(m)), meses.join(','));
    erroresGlobal.push(...errores.map(e=>'[d209] '+e));
    await pg.context().close();
  }

  ok('sin errores de consola/JS en ninguna de las páginas', erroresGlobal.length===0, erroresGlobal.join(' | ').slice(0,500));

  await browser.close(); server.close();
  console.log('\n'+(fallos?('✗ '+fallos+' de '+casos+' casos FALLAN'):('✓ '+casos+' casos pasan'))+'  · capturas en '+OUT);
  process.exit(fallos?1:0);
})().catch(e=>{ console.error(e); server.close(); process.exit(1); });
