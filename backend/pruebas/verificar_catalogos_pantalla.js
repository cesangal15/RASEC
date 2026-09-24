#!/usr/bin/env node
/**
 * Verificación — pantalla «Catálogos» (admin), solo FRONTEND, contra una API SIMULADA que respeta
 * el contrato del backend (worker/src/api/obra/catalogos_admin.js): cat_tablas / cat_leer / cat_guardar
 * en la ruta /obra. No corre nada de worker/ ni toca Supabase: cada llamada se intercepta con Playwright
 * (`page.route` + `fulfill`) y se contesta con datos fabricados aquí mismo.
 *
 * La pantalla es la MISMA hoja que «Revisión de DATA» (enlaza data.css y copia su motor de cuadrícula),
 * así que se prueba como tal: selector agrupado, carga automática (bandeja con las fechas por defecto),
 * flechas / Shift, escribir para editar, Enter/Esc, celdas no editables, Ctrl+C/V/D/Z/Y, clic derecho
 * según alta/baja de la tabla, filtros por columna (selección múltiple), payload de guardado
 * (op/k/antes/campos, alta y baja), errores por celda, aviso de bandeja enviada a DATA, conflicto,
 * «Copiar» con cabeceras, clave enmascarada, no-admin bloqueado, sin errores de consola ni CSP.
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
  process.exit(1);
}
const fs=require('fs'), path=require('path'), http=require('http');
const REPO=path.resolve(__dirname,'..','..');
let fallos=0, casos=0;
function ok(n,c,x){ casos++; if(!c){ fallos++; console.log('  ✗ '+n+(x!==undefined?'  → '+JSON.stringify(x):'')); } else console.log('  ✓ '+n); }

/* ======================================================================================================
 * METADATA SIMULADA — mismo shape que catTablas() del Worker.
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
    { id:'reporta', tipo:'texto', etiqueta:'Reporta' },
    { id:'area', tipo:'lista', etiqueta:'Área', opciones:['','odt','odl'] },
    { id:'estado', tipo:'lista', etiqueta:'Estado', opciones:['pendiente','incluido','descartado'] },
    { id:'pk_desde', tipo:'pk', etiqueta:'PK desde' }
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
    { id:'descripcion_cc', etiqueta:'Descripción', tipo:'texto', editable:true },
    { id:'usos', etiqueta:'Usos', tipo:'numero', editable:true }
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

const FILAS={
  bandeja:()=>[
    { id_registro:'R1', timestamp:'2026-09-01T08:00:00Z', fecha:'2026-09-01', reporta:'Juan', estado:'pendiente', area:'',    _k:{ id_registro:'R1' } },
    { id_registro:'R2', timestamp:'2026-09-02T08:00:00Z', fecha:'2026-09-02', reporta:'Pedro', estado:'incluido',  area:'odt', _k:{ id_registro:'R2' } }
  ],
  parte_cc:()=>[
    { centro_coste:'3701.02.07', descripcion_cc:'Terraplenes', usos:'504', _k:{ centro_coste:'3701.02.07' } },
    { centro_coste:'3701.02.10', descripcion_cc:'Transporte', usos:'132', _k:{ centro_coste:'3701.02.10' } }
  ],
  usuarios:()=>[
    { usuario:'admin', rol:'admin', estado:'activo', _k:{ usuario:'admin' } },
    { usuario:'jefe',  rol:'jefe',  estado:'activo', _k:{ usuario:'jefe' } }
  ]
};

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

  // `respuestasGuardar` es una cola: cada cat_guardar consume la siguiente (o repite la última).
  async function pagina(storage, respuestasGuardar, vp){
    const cola=(respuestasGuardar||[]).slice();
    const c=await browser.newContext({ viewport:vp||{width:1440,height:900}, permissions:['clipboard-read','clipboard-write'], serviceWorkers:'block' });
    const pg=await c.newPage();
    const errores=[], llamadas=[], dialogos=[];
    pg.on('pageerror', e=>errores.push(String(e)));
    pg.on('console', m=>{ if(m.type()==='error' && !/ERR_FAILED/.test(m.text())) errores.push(m.text()); });
    pg.on('dialog', d=>{ dialogos.push(d.message()); d.accept(); });
    await pg.addInitScript(()=>{
      window.__csp=[];
      document.addEventListener('securitypolicyviolation', function(e){ window.__csp.push(e.violatedDirective+' :: '+e.blockedURI); });
    });
    await pg.route(/fonts\.(googleapis|gstatic)\.com/, r=>r.abort());
    await pg.route(u=>u.pathname==='/obra', async r=>{
      const req=r.request();
      if(req.method()==='POST'){
        let body={}; try{ body=JSON.parse(req.postData()||'{}'); }catch(e){}
        llamadas.push({ tipo:'POST', body:body, ctype:req.headers()['content-type'] });
        const out = cola.length>1 ? cola.shift() : cola[0];
        await r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(out||{ok:false,error:'sin mock'}) });
        return;
      }
      const u=new URL(req.url()); const accion=u.searchParams.get('action');
      llamadas.push({ tipo:'GET', accion:accion, url:req.url(), tabla:u.searchParams.get('tabla'), filtros:u.searchParams.get('filtros') });
      if(accion==='cat_tablas'){ await r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, grupos:GRUPOS, tablas:TABLAS, tope:5000 }) }); return; }
      if(accion==='cat_leer'){
        const f=FILAS[u.searchParams.get('tabla')]; const filas=f?f():[];
        await r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, filas:filas, total:filas.length, truncado:false }) });
        return;
      }
      await r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ok:false,error:'accion no simulada'}) });
    });
    if(storage){ await pg.goto(BASE+'/tema.css'); await pg.evaluate(s=>{ localStorage.clear(); for(const k in s) localStorage.setItem(k,s[k]); }, storage); }
    return { pg, errores, llamadas, dialogos, cspAl:()=>pg.evaluate(()=>window.__csp||[]) };
  }
  // page.waitForFunction usa `new Function`, que la CSP real (sin 'unsafe-eval') bloquea: se sondea con evaluate.
  async function esperar(pg, fn, ms){ const fin=Date.now()+(ms||5000); while(Date.now()<fin){ if(await pg.evaluate(fn)) return true; await pg.waitForTimeout(50); } return false; }
  function firma(txt){ let h=0; for(const ch of String(txt)) h=(h*31+ch.charCodeAt(0))>>>0; return 'f'+h; }
  function b64u(b){ return Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
  function tokenDe(usuario, rol){ const carga=b64u(JSON.stringify({u:usuario,r:rol,a:[],v:'1',t:1})); return carga+'.'+b64u(firma(carga)); }
  const ADMIN={ usuario:'admin', rol:'admin', tm2_token:tokenDe('admin','admin') };
  const $=(pg,sel)=>pg.locator(sel);
  const td=(pg,r,c)=>pg.locator('#cuerpo td.cell[data-r="'+r+'"][data-c="'+c+'"]');
  const txt=async(pg,r,c)=>(await td(pg,r,c).locator('.cv').textContent());
  async function abrir(pg, tabla){ await pg.goto(BASE+'/catalogos.html'+(tabla?'?tabla='+tabla:'')); await pg.waitForSelector('#cuerpo tr[data-fila]'); }
  const hoy=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});

  console.log('\n1 · usuario no admin: mensaje + bloqueo (no llama a cat_tablas)');
  {
    const { pg, errores, llamadas } = await pagina({ usuario:'jefe', rol:'jefe', tm2_token:tokenDe('jefe','jefe') }, []);
    await pg.goto(BASE+'/catalogos.html'); await pg.waitForTimeout(300);
    ok('el bloqueo se ve y el panel de admin está oculto', await $(pg,'#bloqueado').isVisible() && !(await $(pg,'#app').isVisible()));
    ok('no se llamó a cat_tablas (el guard de cliente corta antes)', !llamadas.some(l=>l.accion==='cat_tablas'));
    ok('sin errores de consola', errores.length===0, errores);
    await pg.context().close();
  }

  console.log('\n2 · admin: misma hoja que DATA, selector agrupado y carga automática de «Bandeja»');
  const CTX = await pagina(ADMIN, [
    { ok:true, aplicados:2, avisos:[ { clave:{ id_registro:'R2' }, texto:'Ya enviada a DATA el 2026-09-02: DATA no cambia; corrígela también en data.html.' } ], filas:[] }
  ]);
  {
    const { pg, llamadas } = CTX;
    await abrir(pg);
    ok('enlaza data.css (misma hoja que Revisión de DATA) y el contenedor usa su ancho', (await $(pg,'link[href="data.css"]').count())===1 && await pg.evaluate(()=>getComputedStyle(document.querySelector('.container')).maxWidth==='1480px'));
    ok('el panel de admin se ve (sin bloqueo)', await $(pg,'#app').isVisible() && !(await $(pg,'#bloqueado').isVisible()));
    ok('los 5 grupos entran como <optgroup> con la etiqueta del servidor', (await $(pg,'#selTabla optgroup').count())===5 && (await $(pg,'#selTabla optgroup[label="Registros"] option[value="bandeja"]').count())===1);
    ok('bandeja se carga sola con 2 filas y el contador «2 filas»', (await $(pg,'#cuerpo tr[data-fila]').count())===2 && (await $(pg,'#kFilas').textContent())==='2');
    ok('cabecera: # + 6 columnas declaradas + acciones', (await $(pg,'#cab th').count())===8 && (await $(pg,'#cab th').first().textContent())==='#');
    ok('columna # numera las filas (1, 2)', (await $(pg,'#cuerpo tr[data-fila] td.rownum').first().textContent())==='1');
    ok('no editables en gris (clase deriv, como las calculadas de DATA)', await td(pg,0,0).evaluate(e=>e.classList.contains('deriv')) && !(await td(pg,0,3).evaluate(e=>e.classList.contains('deriv'))));
    const leer=llamadas.filter(l=>l.accion==='cat_leer').pop(); const f=JSON.parse(leer.filtros||'{}');
    ok('cat_leer manda filtros planos con desde = hoy−6 y hasta = hoy (chip «7 días» encendido)', leer.tabla==='bandeja' && f.hasta===hoy && f.desde<hoy && (await $(pg,'#rapidos .chip.on').textContent())==='7 días', f);
    ok('chips Hoy/Ayer/Esta semana/7 días y Consultar visibles', (await $(pg,'#rapidos .chip').count())===4 && await $(pg,'#btnConsultar').isVisible());
    ok('filtros de servidor propios (Reporta, Área, Estado, PK desde) en su fila', await $(pg,'#srvExtra').isVisible() && (await $(pg,'#srvExtra [data-filtro]').count())===4);
    ok('bandeja no admite altas: «＋ Fila» oculto', !(await $(pg,'#btnAlta').isVisible()));
  }

  console.log('\n3 · teclado tipo Excel: flechas, Shift, escribir para editar, Enter, Esc, Ctrl+Z / Ctrl+Y');
  {
    const { pg } = CTX;
    ok('arranca en 0 cambios sin guardar', (await $(pg,'#nDirty').textContent())==='0' && await $(pg,'#btnGuardar').isDisabled());
    await td(pg,0,2).click();
    await pg.keyboard.press('ArrowRight');
    ok('flecha derecha mueve la celda activa', await td(pg,0,3).evaluate(e=>e.classList.contains('activa')));
    await pg.keyboard.press('Shift+ArrowDown');
    ok('Shift+flecha marca un rango (2 celdas)', (await $(pg,'#cuerpo td.cell.sel').count())===2);
    await pg.keyboard.press('ArrowUp');
    await pg.keyboard.type('Juan Camilo');
    ok('escribir abre el editor en la celda', (await td(pg,0,3).locator('.editor').count())===1);
    await pg.keyboard.press('Enter');
    ok('Enter confirma: valor nuevo, contador 1 y la fila «dirty»', (await txt(pg,0,3))==='Juan Camilo' && (await $(pg,'#nDirty').textContent())==='1' && await $(pg,'#cuerpo tr[data-fila]').first().evaluate(e=>e.classList.contains('dirty')));
    ok('Enter baja a la fila siguiente', await td(pg,1,3).evaluate(e=>e.classList.contains('activa')));
    await pg.keyboard.type('xx'); await pg.keyboard.press('Escape');
    ok('Esc cancela la edición sin cambiar el valor', (await txt(pg,1,3))==='Pedro' && (await td(pg,1,3).locator('.editor').count())===0);
    await pg.keyboard.press('Control+z');
    ok('Ctrl+Z deshace: 0 cambios y el valor original', (await $(pg,'#nDirty').textContent())==='0' && (await txt(pg,0,3))==='Juan');
    await pg.keyboard.press('Control+y');
    ok('Ctrl+Y rehace', (await txt(pg,0,3))==='Juan Camilo');
    await pg.keyboard.press('Control+z');
    await td(pg,0,0).click(); await pg.keyboard.type('Z');
    ok('una celda no editable (ID) no abre editor al escribir', (await td(pg,0,0).locator('.editor').count())===0 && (await txt(pg,0,0))==='R1');
    await td(pg,0,4).click(); await pg.keyboard.press('F2');
    ok('F2 sobre una columna lista abre un desplegable con sus opciones', (await td(pg,0,4).locator('select.editor option').count())>=3);
    await pg.keyboard.press('Escape');
  }

  console.log('\n4 · Ctrl+C / Ctrl+V (TSV) y Ctrl+D (rellenar hacia abajo)');
  {
    const { pg } = CTX;
    await td(pg,0,2).click(); await td(pg,1,3).click({ modifiers:['Shift'] });
    const copiado=await pg.evaluate(()=>{ const dt=new DataTransfer(); document.dispatchEvent(new ClipboardEvent('copy',{clipboardData:dt,bubbles:true,cancelable:true})); return dt.getData('text/plain'); });
    ok('Ctrl+C copia el rango como TSV (fecha\\treporta por fila)', copiado==='2026-09-01\tJuan\n2026-09-02\tPedro', copiado);
    await td(pg,0,3).click();
    await pg.evaluate(()=>{ const dt=new DataTransfer(); dt.setData('text/plain','Pegado uno\nPegado dos'); document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true})); });
    ok('pegar 2 líneas TSV llena las 2 filas de «reporta»', (await txt(pg,0,3))==='Pegado uno' && (await txt(pg,1,3))==='Pegado dos');
    ok('el contador sube a 2 cambios', (await $(pg,'#nDirty').textContent())==='2');
    await td(pg,0,3).click(); await td(pg,1,3).click({ modifiers:['Shift'] });
    await pg.keyboard.press('Control+d');
    ok('Ctrl+D rellena hacia abajo: la fila 2 copia la fila 1', (await txt(pg,1,3))==='Pegado uno');
  }

  console.log('\n5 · clic derecho y filtros por columna');
  {
    const { pg } = CTX;
    await td(pg,0,3).click({ button:'right' });
    const menu=await $(pg,'#menuCtx').textContent();
    ok('el menú del clic derecho se abre con «Descartar» (bandeja) y sin «Insertar» (no admite alta)', await $(pg,'#menuCtx').isVisible() && /Descartar (fila|2 filas)/.test(menu) && !/Insertar/.test(menu), menu);
    await pg.keyboard.press('Escape');
    ok('hay filtros por columna tipo lista («Estado Todos», «Área Todos»)', /Estado\s*Todos/.test(await $(pg,'#fCols').textContent()) && /Área\s*Todos/.test(await $(pg,'#fCols').textContent()));
    const box=$(pg,'#fCols .ms').filter({ hasText:'Estado' }).first();
    await box.locator('.ms-btn').click();
    await box.locator('.ms-op input[value="incluido"]').check();
    ok('marcar «incluido» deja 1 fila visible y el filtro activo', (await $(pg,'#kFilas').textContent())==='1' && await box.evaluate(e=>e.classList.contains('activo')));
    await pg.mouse.click(5,5);
    await $(pg,'#btnLimpiar').click();
    ok('«Limpiar filtros» vuelve a las 2 filas', (await $(pg,'#kFilas').textContent())==='2');
    await $(pg,'#q').fill('pegado');
    ok('«Buscar en cualquier columna» filtra en vivo', (await $(pg,'#kFilas').textContent())==='2');
    await $(pg,'#q').fill('zzz');
    ok('una búsqueda sin coincidencias deja 0 filas', (await $(pg,'#kFilas').textContent())==='0');
    await $(pg,'#q').fill(''); await pg.evaluate(()=>pintar());
  }

  console.log('\n6 · Guardar: payload (op/k/antes/campos), text/plain y aviso de bandeja enviada a DATA');
  {
    const { pg, llamadas } = CTX;
    await $(pg,'#btnGuardar').click();
    await esperar(pg, ()=>document.getElementById('nDirty').textContent==='0');
    const g=llamadas.filter(l=>l.tipo==='POST' && l.body.action==='cat_guardar').pop();
    ok('POST action=cat_guardar, tabla=bandeja, Content-Type text/plain', !!g && g.body.tabla==='bandeja' && /text\/plain/.test(g.ctype||''));
    const camb=(g && g.body.cambios)||[];
    ok('2 cambios «update», uno por fila tocada, con k = la _k de cat_leer', camb.length===2 && camb.every(c=>c.op==='update') && camb[0].k.id_registro==='R1' && camb[1].k.id_registro==='R2');
    ok('«antes» trae el original y «campos» solo lo cambiado', camb[0].antes.reporta==='Juan' && camb[0].campos.reporta==='Pegado uno' && Object.keys(camb[0].campos).length===1 && camb[1].antes.reporta==='Pedro');
    ok('aviso amarillo «Ya enviada a DATA» con enlace a data.html', await $(pg,'#avisos').isVisible() && /Ya enviada a DATA/.test(await $(pg,'#avisos').textContent()) && (await $(pg,'#avisos a[href="data.html"]').count())===1);
    ok('la fila con aviso queda marcada', (await $(pg,'#cuerpo tr.con-aviso').count())===1);
  }

  console.log('\n7 · baja en bandeja = descartar (Ctrl + −) → op «baja» con k');
  {
    const { pg, llamadas, dialogos } = CTX;
    await td(pg,0,3).click(); await pg.keyboard.press('Control+-');
    ok('pide confirmación explicando que se descarta', dialogos.some(m=>/descartado/.test(m)));
    ok('la fila desaparece de la vista y el contador sube a 1', (await $(pg,'#kFilas').textContent())==='1' && (await $(pg,'#nDirty').textContent())==='1');
    await $(pg,'#btnGuardar').click(); await esperar(pg, ()=>document.getElementById('nDirty').textContent==='0');
    const g=llamadas.filter(l=>l.tipo==='POST').pop(); const c0=g.body.cambios[0];
    ok('manda {op:"baja", k:{id_registro:"R1"}, antes}', g.body.cambios.length===1 && c0.op==='baja' && c0.k.id_registro==='R1' && c0.antes && c0.antes.reporta==='Juan', g.body.cambios);
  }

  console.log('\n8 · errores de validación pintados en la celda');
  {
    const { pg } = await pagina(ADMIN, [ { ok:false, error:'payload', errores:[ { i:0, campo:'reporta', motivo:'el campo «Reporta» es obligatorio.' } ] } ]);
    await abrir(pg);
    await td(pg,0,3).click(); await pg.keyboard.press('Delete');
    await $(pg,'#btnGuardar').click(); await pg.waitForTimeout(250);
    const cel=td(pg,0,3);
    ok('la celda queda en rojo con el motivo del servidor', await cel.evaluate(e=>e.classList.contains('error')) && /obligatorio/.test(await cel.locator('.cv').getAttribute('title')));
    ok('el resumen muestra «1 con error» y los cambios siguen pendientes', await $(pg,'#kpiErr').isVisible() && (await $(pg,'#nDirty').textContent())==='1');
    await pg.context().close();
  }

  console.log('\n9 · conflicto: aviso y recarga');
  {
    const { pg, llamadas } = await pagina(ADMIN, [ { ok:false, conflicto:true, error:'Otra persona cambió 1 fila(s) mientras tanto; recarga e intenta de nuevo.' } ]);
    await abrir(pg);
    await td(pg,0,3).click(); await pg.keyboard.type('otro'); await pg.keyboard.press('Enter');
    const antes=llamadas.filter(l=>l.accion==='cat_leer').length;
    await $(pg,'#btnGuardar').click(); await pg.waitForTimeout(300);
    ok('el conflicto recarga la tabla (nueva cat_leer tras aceptar el diálogo)', llamadas.filter(l=>l.accion==='cat_leer').length>antes);
    await pg.context().close();
  }

  console.log('\n10 · «Copiar» sin rango: TSV con cabeceras de todo lo visible');
  {
    const { pg } = await pagina(ADMIN, []);
    await abrir(pg);
    await $(pg,'#btnCopiar').click(); await pg.waitForTimeout(150);
    const lineas=(await pg.evaluate(()=>navigator.clipboard.readText())).split('\n');
    ok('cabecera (6 columnas) + 2 filas', lineas.length===3 && lineas[0].split('\t').length===6 && lineas[0].startsWith('ID\t'), lineas);
    ok('las filas llevan los valores (Juan/Pedro)', /Juan/.test(lineas[1]) && /Pedro/.test(lineas[2]));
    await pg.context().close();
  }

  console.log('\n11 · parte_cc (alta/baja reales): insertar por clic derecho, PK editable solo en la nueva, payload alta');
  {
    const { pg, llamadas } = await pagina(ADMIN, [ { ok:true, aplicados:1, avisos:[], filas:[] } ]);
    await abrir(pg, 'parte_cc');
    ok('sin filtros de servidor: no hay fechas ni Consultar', !(await $(pg,'#srvFechas').isVisible()) && !(await $(pg,'#btnConsultar').isVisible()));
    ok('«＋ Fila» visible (admite alta)', await $(pg,'#btnAlta').isVisible());
    await td(pg,0,1).click({ button:'right' });
    ok('el menú ofrece Insertar, Duplicar y Eliminar', /Insertar fila debajo/.test(await $(pg,'#menuCtx').textContent()) && /Eliminar fila/.test(await $(pg,'#menuCtx').textContent()));
    await $(pg,'#menuCtx button[data-a="ins"]').click();
    ok('queda una fila nueva «+» debajo de la 1', (await $(pg,'#cuerpo tr[data-r="1"] td.rownum').first().textContent())==='+');
    await td(pg,1,0).click(); await pg.keyboard.type('3799.01.01'); await pg.keyboard.press('Tab');
    await pg.keyboard.type('Nueva'); await pg.keyboard.press('Tab'); await pg.keyboard.type('7'); await pg.keyboard.press('Enter');
    ok('en la fila nueva la PK sí se escribe', (await txt(pg,1,0))==='3799.01.01' && (await txt(pg,1,1))==='Nueva');
    await $(pg,'#btnGuardar').click(); await pg.waitForTimeout(250);
    const g=llamadas.filter(l=>l.tipo==='POST').pop(); const c0=g && g.body.cambios[0];
    ok('manda {op:"alta", campos:{centro_coste, descripcion_cc, usos}}', !!c0 && c0.op==='alta' && c0.campos.centro_coste==='3799.01.01' && c0.campos.descripcion_cc==='Nueva' && c0.campos.usos==='7', c0);
    await pg.context().close();
  }

  console.log('\n12 · usuarios: clave enmascarada, sin baja');
  {
    const { pg, llamadas } = await pagina(ADMIN, [ { ok:true, aplicados:1, avisos:[], filas:[] } ]);
    await abrir(pg, 'usuarios');
    await td(pg,1,1).click(); await pg.keyboard.press('Enter');
    ok('el editor de «Clave nueva» es de tipo password', (await td(pg,1,1).locator('input.editor[type="password"]').count())===1);
    await pg.keyboard.type('secreta9'); await pg.keyboard.press('Enter');
    ok('la clave se ve enmascarada en la celda', (await txt(pg,1,1))==='••••••');
    const tsv=await pg.evaluate(()=>{ marcar(1,1,1,1); const dt=new DataTransfer(); document.getElementById('wrap').focus(); document.dispatchEvent(new ClipboardEvent('copy',{clipboardData:dt,bubbles:true,cancelable:true})); return dt.getData('text/plain'); });
    ok('Ctrl+C no copia la clave', tsv==='');
    await td(pg,1,0).click({ button:'right' });
    ok('el menú no ofrece eliminar (usuarios sin baja)', !/Eliminar/.test(await $(pg,'#menuCtx').textContent()));
    await pg.keyboard.press('Escape');
    await td(pg,1,0).click(); await pg.keyboard.press('Control+-');
    ok('Ctrl + − no marca baja', (await $(pg,'#nDirty').textContent())==='1' && (await $(pg,'#kFilas').textContent())==='2');
    await $(pg,'#btnGuardar').click(); await pg.waitForTimeout(250);
    const c0=llamadas.filter(l=>l.tipo==='POST').pop().body.cambios[0];
    ok('update con campos.clave_nueva y k.usuario', c0.op==='update' && c0.k.usuario==='jefe' && c0.campos.clave_nueva==='secreta9' && Object.keys(c0.campos).length===1, c0);
    await pg.context().close();
  }

  console.log('\n13 · móvil (390×844): carga y sin desbordes de la página');
  {
    const { pg, errores } = await pagina(ADMIN, [], { width:390, height:844 });
    await abrir(pg, 'parte_cc');
    ok('la hoja se ve y la página no desborda a lo ancho', await $(pg,'#wrap').isVisible() && await pg.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
    ok('sin errores de consola', errores.length===0, errores);
    await pg.context().close();
  }

  console.log('\n14 · sin errores de consola ni violaciones de CSP');
  {
    const { pg, errores, cspAl } = CTX;
    ok('sin errores de consola', errores.length===0, errores);
    const viol=await cspAl();
    ok('sin violaciones de Content-Security-Policy', viol.length===0, viol);
    await pg.context().close();
  }

  await browser.close(); server.close();
  console.log('\n'+(fallos?('✗ '+fallos+' de '+casos+' casos FALLAN'):('✓ '+casos+' casos pasan')));
  process.exit(fallos?1:0);
})().catch(e=>{ console.error(e); server.close(); process.exit(1); });
