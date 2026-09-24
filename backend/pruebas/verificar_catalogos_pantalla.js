#!/usr/bin/env node
/**
 * Verificación — pantalla «Catálogos» (admin), solo FRONTEND, contra una API SIMULADA que respeta
 * el contrato acordado con el backend (worker/src/api/obra/catalogos_admin.js): cat_tablas / cat_leer /
 * cat_guardar en la ruta /obra. No corre nada de worker/ ni toca Supabase: cada llamada se intercepta
 * con Playwright (`page.route` + `fulfill`) y se contesta con datos fabricados aquí mismo.
 *
 * Chequea (checklist del encargo): render del selector agrupado, carga de una tabla, editar celda →
 * contador de cambios, pegar TSV en rango, Ctrl+D, Ctrl+Z, que Guardar mande el payload correcto
 * (op/k/antes/campos), errores por fila pintados en la celda, aviso amarillo de bandeja incluida,
 * conflicto, «Copiar a Excel», usuario no admin bloqueado, sin errores de consola ni violaciones CSP.
 *
 * Uso (requiere Playwright con Chromium instalado):
 *   npm i -D playwright && npx playwright install chromium
 *   node backend/pruebas/verificar_catalogos_pantalla.js
 */
let chromium;
try{ ({ chromium } = require('playwright')); }
catch(e){
  console.log('⚠ Falta el módulo «playwright» en este entorno (no se pudo `require(\'playwright\')`).');
  console.log('  Instala con:  npm i -D playwright && npx playwright install chromium');
  console.log('  El script queda listo (contra la API simulada del contrato); solo falta el navegador para correrlo.');
  process.exit(1);
}
const fs=require('fs'), path=require('path'), http=require('http');
const REPO=path.resolve(__dirname,'..','..');
let fallos=0, casos=0;
function ok(n,c,x){ casos++; if(!c){ fallos++; console.log('  ✗ '+n+(x?'  → '+JSON.stringify(x):'')); } else console.log('  ✓ '+n); }

/* ======================================================================================================
 * METADATA SIMULADA — mismo shape que catTablas() en worker/src/api/obra/catalogos_admin.js. Solo hace
 * falta lo bastante para probar el FRONTEND: la lista blanca real y sus validaciones son cosa del backend.
 * ====================================================================================================== */
const GRUPOS=[
  { id:'registros',  titulo:'Registros' },
  { id:'parte',       titulo:'Parte Digital' },
  { id:'usuarios',    titulo:'Usuarios' },
  { id:'obra',        titulo:'Obra' },
  { id:'asistencias', titulo:'Asistencias' }
];
const TABLA_BANDEJA={
  id:'bandeja', grupo:'registros', titulo:'Bandeja', descripcion:'Crudo de capataz/chequeadora/drenajes.',
  pk:['id_registro'], alta:false, baja:true, baja_es:'descartar',
  filtros:[
    { id:'desde', tipo:'fecha', etiqueta:'Desde', requerido:true },
    { id:'hasta', tipo:'fecha', etiqueta:'Hasta', requerido:true },
    { id:'area', tipo:'lista', etiqueta:'Área', opciones:['','odt','odl'] },
    { id:'estado', tipo:'lista', etiqueta:'Estado', opciones:['pendiente','incluido','descartado'] }
  ],
  columnas:[
    { id:'id_registro', etiqueta:'ID', tipo:'texto', editable:false },
    { id:'timestamp', etiqueta:'Marca', tipo:'fecha', editable:false },
    { id:'fecha', etiqueta:'Fecha', tipo:'fecha', editable:true, requerido:true },
    { id:'reporta', etiqueta:'Reporta', tipo:'texto', editable:true },
    { id:'estado', etiqueta:'Estado', tipo:'lista', opciones:['pendiente','incluido','descartado'], editable:true },
    { id:'area', etiqueta:'Área', tipo:'lista', opciones:['','odt','odl'], editable:true }
  ]
};
const TABLA_PARTECC={ id:'parte_cc', grupo:'parte', titulo:'CC del Parte', descripcion:'', pk:['centro_coste'], alta:true, baja:true, baja_es:'borrar',
  filtros:[], columnas:[
    { id:'centro_coste', etiqueta:'Centro coste', tipo:'texto', editable:false, requerido:true },
    { id:'descripcion_cc', etiqueta:'Descripción', tipo:'texto', editable:true }
  ] };
const TABLA_USUARIOS={ id:'usuarios', grupo:'usuarios', titulo:'Usuarios', descripcion:'', pk:['usuario'], alta:true, baja:false,
  filtros:[], columnas:[
    { id:'usuario', etiqueta:'Usuario', tipo:'texto', editable:false, requerido:true },
    { id:'clave_nueva', etiqueta:'Clave nueva', tipo:'clave', editable:true },
    { id:'rol', etiqueta:'Rol', tipo:'lista', opciones:['admin','jefe'], editable:true, requerido:true },
    { id:'estado', etiqueta:'Estado', tipo:'lista', opciones:['activo','inactivo'], editable:true }
  ] };
const TABLA_BASEITEMS={ id:'base_items', grupo:'obra', titulo:'Base — ítems (CC)', descripcion:'', pk:['cc','descripcion'], alta:true, baja:true, baja_es:'borrar',
  filtros:[], columnas:[
    { id:'cc', etiqueta:'CC', tipo:'texto', editable:false, requerido:true },
    { id:'descripcion', etiqueta:'Descripción', tipo:'texto', editable:false, requerido:true }
  ] };
const TABLA_CUADRILLAS={ id:'cuadrillas', grupo:'asistencias', titulo:'Cuadrillas', descripcion:'', pk:['cuadrilla'], alta:true, baja:true, baja_es:'borrar',
  filtros:[], columnas:[
    { id:'cuadrilla', etiqueta:'Cuadrilla', tipo:'texto', editable:false, requerido:true },
    { id:'area', etiqueta:'Área', tipo:'texto', editable:true }
  ] };
const TABLAS=[TABLA_BANDEJA, TABLA_PARTECC, TABLA_USUARIOS, TABLA_BASEITEMS, TABLA_CUADRILLAS];

function filasBandeja(){
  return [
    { id_registro:'R1', timestamp:'2026-09-01T08:00:00Z', fecha:'2026-09-01', reporta:'Juan', estado:'pendiente', area:'',    _k:{ id_registro:'R1' } },
    { id_registro:'R2', timestamp:'2026-09-02T08:00:00Z', fecha:'2026-09-02', reporta:'Pedro', estado:'incluido',  area:'odt', _k:{ id_registro:'R2' } }
  ];
}

/* ---------- servidor estático del repo (solo sirve los archivos; la API la intercepta Playwright) ---------- */
const MIME={ '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };
const server=http.createServer((req,res)=>{
  const p=path.join(REPO, decodeURIComponent(req.url.split('?')[0]));
  if(!p.startsWith(REPO) || !fs.existsSync(p) || fs.statSync(p).isDirectory()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(fs.readFileSync(p));
});

(async()=>{
  await new Promise(r=>server.listen(0,r)); const BASE='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch();

  /* ---------- helper: página con la API en banco (mismo patrón que verificar_v301_pantallas.js) ---------- */
  // `respuestasGuardar` es una cola: cada llamada a cat_guardar consume la siguiente (o repite la última si se acaba).
  async function pagina(storage, respuestasGuardar){
    const cola = (respuestasGuardar||[]).slice();
    const c=await browser.newContext({ viewport:{width:1440,height:900}, permissions:['clipboard-read','clipboard-write'], serviceWorkers:'block' });
    const pg=await c.newPage();
    const errores=[]; const llamadas=[]; const cspViolaciones=[];
    pg.on('pageerror', e=>errores.push(String(e)));
    pg.on('console', m=>{ if(m.type()==='error' && !/ERR_FAILED/.test(m.text())) errores.push(m.text()); });
    await pg.addInitScript(()=>{
      window.__csp=[];
      document.addEventListener('securitypolicyviolation', function(e){ window.__csp.push(e.violatedDirective+' :: '+e.blockedURI); });
    });
    await pg.route(/fonts\.(googleapis|gstatic)\.com/, r=>r.abort());
    await pg.route(u=>u.pathname==='/obra', async r=>{
      const req=r.request();
      if(req.method()==='POST'){
        let body={}; try{ body=JSON.parse(req.postData()||'{}'); }catch(e){}
        llamadas.push({ tipo:'POST', body:body });
        if(body.action==='cat_guardar'){
          const out = cola.length>1 ? cola.shift() : cola[0];
          await r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(out||{ok:false,error:'sin mock'}) });
          return;
        }
        await r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ok:false,error:'accion no simulada'}) });
        return;
      }
      const u=new URL(req.url());
      const accion=u.searchParams.get('action');
      llamadas.push({ tipo:'GET', accion:accion, url:req.url() });
      if(accion==='cat_tablas'){ await r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, grupos:GRUPOS, tablas:TABLAS, tope:5000 }) }); return; }
      if(accion==='cat_leer'){
        const tabla=u.searchParams.get('tabla');
        if(tabla==='bandeja'){ await r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, filas:filasBandeja(), total:2, truncado:false }) }); return; }
        await r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, filas:[], total:0, truncado:false }) });
        return;
      }
      await r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ok:false,error:'accion no simulada'}) });
    });
    if(storage){ await pg.goto(BASE+'/tema.css'); await pg.evaluate(s=>{ for(const k in s) localStorage.setItem(k,s[k]); }, storage); }
    return { pg, errores, llamadas, cspAl:()=>pg.evaluate(()=>window.__csp||[]) };
  }
  // page.waitForFunction compila la condición con `new Function(...)`, que la CSP real (script-src 'self',
  // sin 'unsafe-eval') bloquea dentro de la página — a propósito, es la misma CSP D170 de producción.
  // Se sondea con page.evaluate() (Runtime.evaluate por CDP, no pasa por el intérprete de la página).
  async function esperar(pg, fn, ms){
    const fin=Date.now()+(ms||5000);
    while(Date.now()<fin){ if(await pg.evaluate(fn)) return true; await pg.waitForTimeout(50); }
    return false;
  }
  function firma(txt){ let h=0; for(const ch of String(txt)) h=(h*31+ch.charCodeAt(0))>>>0; return 'f'+h; }
  function b64u(b){ return Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
  function tokenDe(usuario, rol){ const carga=b64u(JSON.stringify({u:usuario,r:rol,a:[],v:'1',t:1})); return carga+'.'+b64u(firma(carga)); }
  const $=(pg,sel)=>pg.locator(sel);

  console.log('\n1 · usuario no admin: mensaje + bloqueo (no llama a cat_tablas)');
  {
    const { pg, errores, llamadas } = await pagina({ usuario:'jefe', rol:'jefe', tm2_token:tokenDe('jefe','jefe') }, []);
    await pg.goto(BASE+'/catalogos.html'); await pg.waitForTimeout(300);
    ok('el bloqueo se ve y el panel de admin está oculto', await $(pg,'#bloqueado').isVisible() && !(await $(pg,'#app').isVisible()));
    ok('no se llamó a cat_tablas (el guard de cliente corta antes)', !llamadas.some(l=>l.accion==='cat_tablas'));
    ok('sin errores de consola', errores.length===0, errores);
    await pg.context().close();
  }

  console.log('\n2 · admin: selector agrupado (cat_tablas) y carga de «Bandeja»');
  let CTX;
  {
    CTX = await pagina({ usuario:'admin', rol:'admin', tm2_token:tokenDe('admin','admin') }, [
      { ok:true, aplicados:2, avisos:[ { clave:{ id_registro:'R2' }, texto:'Ya enviada a DATA el 2026-09-02: DATA no cambia; corrígela también en data.html.' } ], filas:filasBandeja() }
    ]);
    const { pg } = CTX;
    await pg.goto(BASE+'/catalogos.html'); await pg.waitForSelector('#selTabla option', { state:'attached' });
    ok('el panel de admin se ve (sin bloqueo)', await $(pg,'#app').isVisible() && !(await $(pg,'#bloqueado').isVisible()));
    ok('los 5 grupos entran como <optgroup> con la etiqueta del servidor', (await $(pg,'#selTabla optgroup').count())===5 && (await $(pg,'#selTabla optgroup[label="Registros"]').count())===1 && (await $(pg,'#selTabla optgroup[label="Asistencias"]').count())===1);
    ok('«Bandeja» entra en el grupo Registros', (await $(pg,'#selTabla optgroup[label="Registros"] option[value="bandeja"]').count())===1);
    ok('bandeja exige filtros: la grilla pide elegirlos antes de Buscar', /Elige los filtros/.test(await $(pg,'#cuerpo').textContent()));
    await $(pg,'#filtros button:has-text("Buscar")').click();
    await pg.waitForSelector('#cuerpo tr[data-fila]');
    ok('carga la tabla por defecto (bandeja) con sus 2 filas', (await $(pg,'#cuerpo tr[data-fila]').count())===2);
    ok('la cabecera pinta las 6 columnas declaradas + 2 de servicio', (await $(pg,'#cab th').count())===8);
    ok('el filtro «Desde» viene con hoy-7 (en-CA) y «Hasta» con hoy', await pg.evaluate(()=>{
      const hoy=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
      const d=new Date(); d.setDate(d.getDate()-7); const desde=d.toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
      const inputs=[...document.querySelectorAll('#filtros input[type=date]')];
      return inputs[0].value===desde && inputs[1].value===hoy;
    }));
  }

  console.log('\n3 · editar celda → contador de cambios; Ctrl+Z deshace');
  {
    const { pg } = CTX;
    ok('arranca en 0 cambios sin guardar', (await $(pg,'#nDirty').textContent())==='0' && await $(pg,'#btnGuardar').isDisabled());
    const celda=$(pg,'#cuerpo tr[data-fila] td.cell').filter({ has: pg.locator('input.cin') }).nth(3);   // columna «reporta» de la 1a fila
    const input=celda.locator('input.cin');
    await input.click(); await input.fill('Juan Camilo'); await input.dispatchEvent('input');
    ok('editar una celda sube el contador a 1 y habilita Guardar', (await $(pg,'#nDirty').textContent())==='1' && !(await $(pg,'#btnGuardar').isDisabled()));
    ok('la fila queda marcada «dirty»', await $(pg,'#cuerpo tr[data-fila]').first().evaluate(e=>e.classList.contains('dirty')));
    await pg.keyboard.press('Control+z');
    ok('Ctrl+Z deshace: vuelve a 0 cambios y el valor original', (await $(pg,'#nDirty').textContent())==='0' && await input.inputValue()==='Juan');
  }

  console.log('\n4 · pegar TSV en rango y Ctrl+D (rellenar hacia abajo)');
  {
    const { pg } = CTX;
    const filas=$(pg,'#cuerpo tr[data-fila]');
    const celdaR1=filas.nth(0).locator('td.cell').nth(3).locator('input.cin');   // «reporta» fila 1
    const celdaR2=filas.nth(1).locator('td.cell').nth(3).locator('input.cin');   // «reporta» fila 2
    await celdaR1.click();
    await pg.evaluate(()=>{
      const dt=new DataTransfer(); dt.setData('text/plain', 'Pegado uno\nPegado dos');
      const ev=new ClipboardEvent('paste', { clipboardData:dt, bubbles:true, cancelable:true });
      document.dispatchEvent(ev);
    });
    ok('pegar 2 líneas TSV llena las 2 filas de la columna «reporta»', await celdaR1.inputValue()==='Pegado uno' && await celdaR2.inputValue()==='Pegado dos');
    ok('el contador sube a 2 cambios', (await $(pg,'#nDirty').textContent())==='2');
    // Ctrl+D: selecciona ambas celdas de la columna (clic + Shift clic) y rellena con el valor de la 1a
    await celdaR1.click();
    await pg.locator('#cuerpo tr[data-fila] td.cell').nth(3+6).click({ modifiers:['Shift'] });   // misma columna, fila 2 (6 = nº de <td.cell> por fila)
    await pg.keyboard.press('Control+d');
    ok('Ctrl+D rellena hacia abajo: la fila 2 copia el valor de la fila 1', await celdaR2.inputValue()==='Pegado uno');
  }

  console.log('\n5 · Guardar: payload correcto (op/k/antes/campos) y aviso amarillo de bandeja incluida');
  {
    const { pg, llamadas } = CTX;
    await $(pg,'#btnGuardar').click();
    await esperar(pg, ()=>document.getElementById('nDirty').textContent==='0');
    const guardado = llamadas.filter(l=>l.tipo==='POST' && l.body.action==='cat_guardar').pop();
    ok('el POST manda action=cat_guardar y tabla=bandeja', !!guardado && guardado.body.tabla==='bandeja');
    const camb = guardado && guardado.body.cambios || [];
    ok('manda 2 cambios «update», uno por fila tocada', camb.length===2 && camb.every(c=>c.op==='update'));
    ok('cada cambio trae k = la _k de cat_leer', camb[0].k && camb[0].k.id_registro==='R1' && camb[1].k.id_registro==='R2');
    ok('«antes» trae el valor original de reporta (Juan/Pedro) y «campos» solo lo cambiado', camb[0].antes.reporta==='Juan' && camb[0].campos.reporta==='Pegado uno' && camb[1].antes.reporta==='Pedro' && camb[1].campos.reporta==='Pegado uno');
    ok('el aviso amarillo de «bandeja incluida» se ve y enlaza a data.html', await $(pg,'#avisos').isVisible() && /Ya enviada a DATA/.test(await $(pg,'#avisos').textContent()) && (await $(pg,'#avisos a[href="data.html"]').count())===1);
  }

  console.log('\n6 · errores por fila pintados en la celda correspondiente');
  {
    const { pg } = await (async()=>{
      const c2 = await pagina({ usuario:'admin', rol:'admin', tm2_token:tokenDe('admin','admin') }, [
        { ok:false, error:'payload', errores:[ { i:0, campo:'reporta', motivo:'el campo «Reporta» es obligatorio.' } ] }
      ]);
      return c2;
    })();
    await pg.goto(BASE+'/catalogos.html'); await pg.waitForSelector('#selTabla option', { state:'attached' });
    await $(pg,'#filtros button:has-text("Buscar")').click(); await pg.waitForSelector('#cuerpo tr[data-fila]');
    const celda=$(pg,'#cuerpo tr[data-fila]').first().locator('td.cell').nth(3);
    await celda.locator('input.cin').fill(''); await celda.locator('input.cin').dispatchEvent('input');
    await $(pg,'#btnGuardar').click(); await pg.waitForTimeout(200);
    ok('la celda con el error del servidor queda pintada en rojo con el motivo', await celda.evaluate(e=>e.classList.contains('error')) && /obligatorio/.test(await celda.getAttribute('title')));
    await pg.context().close();
  }

  console.log('\n7 · conflicto: aviso y recarga');
  {
    const c3 = await pagina({ usuario:'admin', rol:'admin', tm2_token:tokenDe('admin','admin') }, [
      { ok:false, conflicto:true, error:'Otra persona cambió 1 fila(s) mientras tanto; recarga e intenta de nuevo.' }
    ]);
    const { pg, llamadas } = c3;
    pg.on('dialog', d=>d.accept());
    await pg.goto(BASE+'/catalogos.html'); await pg.waitForSelector('#selTabla option', { state:'attached' });
    await $(pg,'#filtros button:has-text("Buscar")').click(); await pg.waitForSelector('#cuerpo tr[data-fila]');
    const celda=$(pg,'#cuerpo tr[data-fila]').first().locator('td.cell').nth(3).locator('input.cin');
    await celda.fill('otro valor'); await celda.dispatchEvent('input');
    const leidasAntes = llamadas.filter(l=>l.accion==='cat_leer').length;
    await $(pg,'#btnGuardar').click(); await pg.waitForTimeout(300);
    const leidasDespues = llamadas.filter(l=>l.accion==='cat_leer').length;
    ok('el conflicto recarga la tabla (nueva llamada a cat_leer tras aceptar el diálogo)', leidasDespues>leidasAntes);
    await pg.context().close();
  }

  console.log('\n8 · «Copiar a Excel»: TSV con cabeceras de todo lo visible');
  {
    const { pg } = await (async()=>{
      return await pagina({ usuario:'admin', rol:'admin', tm2_token:tokenDe('admin','admin') }, []);
    })();
    await pg.goto(BASE+'/catalogos.html'); await pg.waitForSelector('#selTabla option', { state:'attached' });
    await $(pg,'#filtros button:has-text("Buscar")').click(); await pg.waitForSelector('#cuerpo tr[data-fila]');
    await $(pg,'button:has-text("Copiar a Excel")').click(); await pg.waitForTimeout(150);
    const tsv=await pg.evaluate(()=>navigator.clipboard.readText());
    const lineas=tsv.split('\n');
    ok('la primera línea es la cabecera (6 columnas) y hay 3 líneas (cabecera + 2 filas)', lineas.length===3 && lineas[0].split('\t').length===6 && lineas[0].startsWith('ID\t'));
    ok('las filas llevan los valores de reporta (Juan/Pedro)', /Juan/.test(lineas[1]) && /Pedro/.test(lineas[2]));
    await pg.context().close();
  }

  console.log('\n9 · sin violaciones de CSP en ninguna pantalla cargada');
  {
    const { pg, cspAl } = CTX;
    const viol = await cspAl();
    ok('sin violaciones de Content-Security-Policy', viol.length===0, viol);
    await pg.context().close();
  }

  await browser.close(); server.close();
  console.log('\n'+(fallos?('✗ '+fallos+' de '+casos+' casos FALLAN'):('✓ '+casos+' casos pasan')));
  process.exit(fallos?1:0);
})().catch(e=>{ console.error(e); server.close(); process.exit(1); });
