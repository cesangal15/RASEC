// D170: aplica los data-estilo del marcado ANTES de que corra la lógica de la pantalla (ver tema.js).
if(window.TM2Estilos) TM2Estilos.aplicar();
const APPS_SCRIPT_URL = GALCA_ENV.url.obra;          // entorno.js (D168): producción o prueba
const TIPOS = ['Terraplén','Puente','UF3','ODL','ODT','Botadero'];

let FECHA = '';
let grupos = [];   // {gid, placa, origen, destino, tipo_destino, uf, cub, esDefault, viajes, modo, cantAgr, renglones:[{rid,pk,remision,hs,hl,conductor}], renAgr:{pk,remision,conductor}}
let externos = []; // {eid, placa, origen, pkDestino, tipo_destino, cub, remision, hs, hl, conductor}
let gidSeq = 0, ridSeq = 0, eidSeq = 0;

window.onload = function(){
  // Sesión en localStorage (D82). Solo digitadora y admin entran aquí.
  const rol = localStorage.getItem('rol');
  const usuario = localStorage.getItem('usuario');
  if(!rol || (rol!=='digitadora' && rol!=='admin')){ window.location.href='index.html'; return; }
  document.getElementById('userDisplay').textContent = usuario || 'digitadora';
  if(rol==='admin'){ const bm=document.getElementById('btnMenu'); if(bm) bm.style.display='inline-block'; }
  // Fecha por defecto = hoy en America/Bogota (UTC−5), nunca toISOString (D50).
  document.getElementById('fecha').value = new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
};
function logout(){ localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token'); window.location.href='index.html'; }

/* ---------- helpers de PK / UF (mismo criterio que el resto del proyecto, D63/D04) ---------- */
function pkMeters(s){
  if(s==null) return null;
  // el destino de VOLQUETAS viene como "tm2 pk 34+500": quitar el token tm2 ANTES de compactar,
  // o su "2" se pega al PK ("tm222+000" → 222+000)
  const t=String(s).toLowerCase().replace(/tm2/g,'').replace(/pk/g,'').replace(/\s+/g,'');
  const m=t.match(/(\d+)\+(\d+)/);
  if(m) return parseInt(m[1],10)*1000 + parseInt(m[2],10);
  const n=parseFloat(t); return isNaN(n)?null:n*1000;
}
function pkFmt(meters){ if(meters==null||isNaN(meters)) return ''; const km=Math.floor(meters/1000), r=Math.round(meters-km*1000); return km+'+'+('00'+r).slice(-3); }
function pkNorm(s){ return pkFmt(pkMeters(s)); }
function ufDeMetros(m){ return m==null?'':(m<=30000?'UF1':'UF2'); }
// Mapeo origen → Pk inicial en metros (§5, D63): Masivo2=19800, Masivo1=14400, Diviso=21500.
// Complementario/Otro = el PK que tecleó la chequeadora (viene en `origen`), convertido a metros.
function origenPkMeters(origen){
  const s=String(origen||'').toLowerCase();
  if(s.indexOf('masivo 2')>=0 || s.indexOf('masivo2')>=0) return 19800;
  if(s.indexOf('masivo 1')>=0 || s.indexOf('masivo1')>=0) return 14400;
  if(s.indexOf('diviso')>=0) return 21500;
  return pkMeters(origen);
}
/* ---------- mapeo tipo_destino → I Actividad / J Material / L Centro de costo (§5) ---------- */
function normTipo(t){ return String(t||'').toLowerCase().replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i').replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').trim(); }
function actividadDe(t){ return normTipo(t)==='botadero' ? '' : 'CONFORMACIÓN TERRAPLÉN'; }
function materialDe(t){ return normTipo(t)==='botadero' ? '' : 'MATERIAL CORTE PARA TERRAPLÉN'; }
function ccDe(t, pkDestM){
  const n=normTipo(t);
  if(n==='terraplen'){ const proy=(pkDestM!=null && pkDestM<=30000)?'3701':'3702'; return proy+'.02.11'; } // proyecto por PK destino (D04) + .02.11
  if(n==='puente') return '3701.11.03';  // fijo (confirmado por el usuario)
  return '';                              // UF3 / ODL / ODT / Botadero: CC en blanco, lo pone la digitadora
}
function fmtNum(n){ if(n==null||n==='') return ''; const x=Number(n); if(isNaN(x)) return ''; return String(x).replace('.', ','); }
function fechaExcel(iso){ const p=String(iso||'').slice(0,10).split('-'); if(p.length<3) return ''; return p[2]+'/'+p[1]+'/'+p[0]; } // dd/mm/yyyy

/* ---------- carga del día ---------- */
function setMsg(txt, tipo){ const m=document.getElementById('msg'); if(!txt){ m.className='msg'; m.textContent=''; return; } m.className='msg '+(tipo||'info'); m.textContent=txt; }
function hayRemisiones(){ return grupos.some(g=> g.modo==='agrupado' ? !!(g.renAgr.remision||'').trim() : g.renglones.some(r=>(r.remision||'').trim()) ) || externos.some(x=>(x.remision||'').trim()); }

async function cargarDia(){
  const fecha=document.getElementById('fecha').value;
  if(!fecha){ setMsg('Elige una fecha primero.','err'); return; }
  if((grupos.length||externos.length) && hayRemisiones() && !confirm('Recargar del servidor descarta lo que ya tecleaste (remisiones, horas, conductores). ¿Continuar?')) return;
  const btn=document.getElementById('btnCargar'); btn.disabled=true; btn.textContent='Cargando…'; setMsg('');
  try{
    const resp=await fetch(APPS_SCRIPT_URL+'?action=volquetas&fecha='+encodeURIComponent(fecha));
    const data=await resp.json();
    if(!data || !data.ok) throw new Error((data&&data.error)||'Respuesta inesperada del servidor');
    FECHA=fecha; externos=[]; construirGrupos(data.filas||[]);
    renderExternos();
    if(!grupos.length) setMsg('No hay viajes capturados en VOLQUETAS para el '+fecha+'. Puedes registrar viajes externos abajo.','info');
    else setMsg((data.filas.length)+' línea(s) de VOLQUETAS · '+totalGuia()+' viajes guía.','info');
  }catch(err){
    setMsg('No se pudo cargar del servidor: '+err.message+'. Revisa la señal e intenta de nuevo.','err');
  }
  btn.disabled=false; btn.textContent='Cargar viajes del día';
}
function totalGuia(){ return grupos.reduce((s,g)=>s+g.viajes,0); }

function construirGrupos(filas){
  grupos=[]; gidSeq=0; ridSeq=0;
  filas.forEach(f=>{
    const g={
      gid:gidSeq++, placa:String(f.placa||''), origen:String(f.origen||''), destino:String(f.destino||''),
      tipo_destino:String(f.tipo_destino||''), uf:String(f.uf||''),
      cub:Number(f.cubicaje)||0, esDefault:(String(f.cubicaje_origen||'').toLowerCase()==='default'),
      viajes:Number(f.viajes)||0, modo:'explotar', cantAgr:(Number(f.viajes)||0),
      renglones:[], renAgr:{pk:pkNorm(f.destino), remision:'', conductor:''}
    };
    const n=Math.max(g.viajes,0);
    for(let i=0;i<n;i++) g.renglones.push(nuevoRen(g));
    if(g.renglones.length===0) g.renglones.push(nuevoRen(g)); // línea sin viajes → al menos 1 renglón editable
    grupos.push(g);
  });
  renderGrupos();
}
function nuevoRen(g){ return {rid:ridSeq++, pk:pkNorm(g.destino), remision:'', hs:'', hl:'', conductor:''}; }

/* ---------- render de grupos ---------- */
function renderGrupos(){
  const cont=document.getElementById('gruposContainer');
  document.getElementById('emptyGrupos').style.display=grupos.length?'none':'block';
  cont.innerHTML=grupos.map(grupoHTML).join('');
  refresh();
}
function grupoHTML(g){
  const gi=g.gid;
  const prog=pkNorm(g.destino)||esc(g.destino);
  const ufcls=g.uf==='UF1'?'uf1':g.uf==='UF2'?'uf2':'';
  const cubBadge = g.esDefault
    ? '<span class="badge m3 warn" title="Placa sin catálogo: verifica el m³ contra el parte">m³/viaje <input type="number" step="any" class="cub-inp" value="'+esc(g.cub)+'" data-on-input="setCub('+gi+',this.value)"> ⚠</span>'
    : '<span class="badge m3">'+esc(fmtNum(g.cub))+' m³/viaje</span>';
  let cuerpo;
  if(g.modo==='agrupado'){
    cuerpo='<div class="tblwrap"><div class="tbl agr">'
      +'<div class="tbl-head"><span>PK destino real</span><span>Cant. viajes</span><span>Remisión</span><span>Conductor</span><span></span></div>'
      +renAgrHTML(g)
      +'</div></div>';
  } else {
    const items=g.renglones.map((r,k)=>renHTML(g,r,k)).join('');
    let warn='';
    if(g.renglones.length!==g.viajes) warn='<div class="grp-warn">⚠ '+g.renglones.length+' renglón(es) vs '+g.viajes+' viajes de la guía — ajusta si el parte físico dice otra cosa.</div>';
    cuerpo='<div class="tblwrap"><div class="tbl">'
      +'<div class="tbl-head"><span>#</span><span>PK destino real</span><span>Remisión</span><span>H. salida</span><span>H. llegada</span><span>Conductor</span><span></span></div>'
      +items
      +'</div></div>'
      +warn
      +'<button class="btn-add" data-on-click="addRen('+gi+')">＋ Agregar renglón</button>';
  }
  return '<div class="grupo" id="grupo_'+gi+'">'
    +'<div class="grp-head"><div><span class="grp-placa">'+esc(g.placa||'—')+'</span>'
    +'<span class="grp-route"><b>'+esc(g.origen||'—')+'</b> → <b>'+prog+'</b> <span class="guia">programado · guía</span></span></div>'
    +'<div class="seg">'
    +'<button class="seg-btn'+(g.modo==='explotar'?' active':'')+'" data-on-click="setModo('+gi+',\'explotar\')">Explotar</button>'
    +'<button class="seg-btn'+(g.modo==='agrupado'?' active':'')+'" data-on-click="setModo('+gi+',\'agrupado\')">Agrupado</button>'
    +'</div></div>'
    +'<div class="meta-row">'
    +'<span class="badge">'+esc(g.tipo_destino||'—')+'</span>'
    +(g.uf?'<span class="badge '+ufcls+'">'+esc(g.uf)+'</span>':'')
    +cubBadge
    +'<span class="badge">guía: '+g.viajes+' viajes</span></div>'
    +cuerpo
    +'</div>';
}
function renHTML(g,r,k){
  const diff = pkDiff(g,r.pk);
  return '<div class="tbl-row" id="ren_'+g.gid+'_'+r.rid+'">'
    +'<span class="tbl-num">'+(k+1)+'</span>'
    +'<input type="text" class="pk-inp'+(diff?' pk-diff':'')+'" value="'+esc(r.pk)+'" placeholder="'+esc(pkNorm(g.destino))+'" data-on-input="setRenPk('+g.gid+','+r.rid+',this)">'
    +'<input type="text" value="'+esc(r.remision)+'" placeholder="remisión" data-on-input="setRen('+g.gid+','+r.rid+',\'remision\',this.value)">'
    +'<input type="text" inputmode="numeric" placeholder="HH:MM" value="'+esc(r.hs)+'" data-on-input="setRen('+g.gid+','+r.rid+',\'hs\',this.value)">'
    +'<input type="text" inputmode="numeric" placeholder="HH:MM" value="'+esc(r.hl)+'" data-on-input="setRen('+g.gid+','+r.rid+',\'hl\',this.value)">'
    +'<input type="text" value="'+esc(r.conductor)+'" placeholder="conductor" data-on-input="setRen('+g.gid+','+r.rid+',\'conductor\',this.value)">'
    +'<button class="btn-del" title="Quitar renglón" data-on-click="delRen('+g.gid+','+r.rid+')">✕</button>'
    +'</div>';
}
function renAgrHTML(g){
  const r=g.renAgr; const diff=pkDiff(g,r.pk);
  return '<div class="tbl-row">'
    +'<input type="text" class="pk-inp'+(diff?' pk-diff':'')+'" value="'+esc(r.pk)+'" placeholder="'+esc(pkNorm(g.destino))+'" data-on-input="setAgrPk('+g.gid+',this)">'
    +'<input type="number" min="0" step="1" value="'+esc(g.cantAgr)+'" data-on-input="setCantAgr('+g.gid+',this.value)">'
    +'<input type="text" value="'+esc(r.remision)+'" placeholder="remisión" data-on-input="setAgr('+g.gid+',\'remision\',this.value)">'
    +'<input type="text" value="'+esc(r.conductor)+'" placeholder="conductor" data-on-input="setAgr('+g.gid+',\'conductor\',this.value)">'
    +'<span></span>'
    +'</div>';
}
function pkDiff(g,pk){ const a=pkMeters(pk), b=pkMeters(g.destino); return (a!=null && b!=null && a!==b); }
function grupoById(gid){ return grupos.find(g=>g.gid===gid); }

/* ---------- edición de estado (sin re-render para no perder el foco) ---------- */
function setCub(gid,val){ const g=grupoById(gid); if(g) g.cub=parseFloat(val)||0; }
function setRen(gid,rid,campo,val){ const g=grupoById(gid); if(!g) return; const r=g.renglones.find(x=>x.rid===rid); if(r){ r[campo]=val; if(campo==='remision') refresh(); } }
function setRenPk(gid,rid,el){ const g=grupoById(gid); if(!g) return; const r=g.renglones.find(x=>x.rid===rid); if(r){ r.pk=el.value; el.classList.toggle('pk-diff', pkDiff(g,el.value)); } }
function setAgr(gid,campo,val){ const g=grupoById(gid); if(g){ g.renAgr[campo]=val; if(campo==='remision') refresh(); } }
function setAgrPk(gid,el){ const g=grupoById(gid); if(g){ g.renAgr.pk=el.value; el.classList.toggle('pk-diff', pkDiff(g,el.value)); } }
function setCantAgr(gid,val){ const g=grupoById(gid); if(g){ g.cantAgr=Math.max(0, parseInt(val,10)||0); refresh(); } }

/* ---------- ops estructurales (re-render del grupo) ---------- */
function rerenderGrupo(gid){ const el=document.getElementById('grupo_'+gid); const g=grupoById(gid); if(el&&g){ el.outerHTML=grupoHTML(g); refresh(); } }
function setModo(gid,modo){ const g=grupoById(gid); if(g && g.modo!==modo){ g.modo=modo; rerenderGrupo(gid); } }
function addRen(gid){ const g=grupoById(gid); if(g){ g.renglones.push(nuevoRen(g)); rerenderGrupo(gid); } }
function delRen(gid,rid){ const g=grupoById(gid); if(g){ g.renglones=g.renglones.filter(r=>r.rid!==rid); rerenderGrupo(gid); } }

/* ---------- viajes externos ---------- */
function renderExternos(){
  const cont=document.getElementById('externosContainer');
  document.getElementById('cntExt').textContent=externos.length;
  document.getElementById('emptyExt').style.display=externos.length?'none':'block';
  cont.innerHTML = externos.length
    ? '<div class="tblwrap"><div class="tbl ext">'
      +'<div class="tbl-head"><span>Placa</span><span>Origen (PK o texto)</span><span>PK destino</span><span>Tipo destino</span><span>m³/viaje</span><span>Remisión</span><span>H. salida</span><span>H. llegada</span><span>Conductor</span><span></span></div>'
      +externos.map(externoHTML).join('')
      +'</div></div>'
    : '';
  refresh();
}
function externoHTML(x){
  const ei=x.eid;
  const tipoOpts=TIPOS.map(t=>'<option'+(t===x.tipo_destino?' selected':'')+'>'+esc(t)+'</option>').join('');
  return '<div class="tbl-row" id="ext_'+ei+'">'
    +'<input type="text" value="'+esc(x.placa)+'" placeholder="ABC123" data-on-input="setExt('+ei+',\'placa\',this.value)">'
    +'<input type="text" value="'+esc(x.origen)+'" placeholder="19+800 / Masivo 2" data-on-input="setExt('+ei+',\'origen\',this.value)">'
    +'<input type="text" value="'+esc(x.pkDestino)+'" placeholder="34+500" data-on-input="setExt('+ei+',\'pkDestino\',this.value)">'
    +'<select data-on-change="setExt('+ei+',\'tipo_destino\',this.value)">'+tipoOpts+'</select>'
    +'<input type="number" step="any" value="'+esc(x.cub)+'" data-on-input="setExt('+ei+',\'cub\',this.value)">'
    +'<input type="text" value="'+esc(x.remision)+'" placeholder="remisión" data-on-input="setExt('+ei+',\'remision\',this.value)">'
    +'<input type="text" inputmode="numeric" placeholder="HH:MM" value="'+esc(x.hs)+'" data-on-input="setExt('+ei+',\'hs\',this.value)">'
    +'<input type="text" inputmode="numeric" placeholder="HH:MM" value="'+esc(x.hl)+'" data-on-input="setExt('+ei+',\'hl\',this.value)">'
    +'<input type="text" value="'+esc(x.conductor)+'" placeholder="conductor" data-on-input="setExt('+ei+',\'conductor\',this.value)">'
    +'<button class="btn-del" title="Quitar" data-on-click="delExterno('+ei+')">✕</button>'
    +'</div>';
}
function addExterno(){ externos.push({eid:eidSeq++, placa:'', origen:'', pkDestino:'', tipo_destino:'Terraplén', cub:'', remision:'', hs:'', hl:'', conductor:''}); renderExternos(); }
function delExterno(eid){ externos=externos.filter(x=>x.eid!==eid); renderExternos(); }
function setExt(eid,campo,val){ const x=externos.find(e=>e.eid===eid); if(x){ x[campo]=val; if(campo==='remision') refresh(); } }

/* ---------- export (A→AH, §5) ---------- */
function grupoCub(g){ return Number(g.cub)||0; }
function buildRow(o){
  const ufDest=ufDeMetros(o.pkDestinoM), ufIni=ufDeMetros(o.pkOrigenM);
  const row=new Array(34).fill('');
  row[0]=fechaExcel(FECHA);                                 // A  Fecha (dd/mm/yyyy)
  row[1]=o.remision||'';                                    // B  No. Remisión
  row[2]=o.placa||'';                                       // C  Código equipo o Placa
  // D  Contratista → vacío (la empresa no entra a la app, D53)
  row[4]='N/A';                                             // E  Planta
  row[5]=fmtNum(o.cubicaje);                                // F  Cant. transportada (m3)
  row[6]=(o.viajes!=null&&o.viajes!=='')?String(o.viajes):''; // G  Cant. viajes
  // H  Cant. total transportada → fórmula (F×G): vacío
  row[8]=actividadDe(o.tipo_destino);                       // I  Descripción Actividad
  row[9]=materialDe(o.tipo_destino);                        // J  Descripción Material
  row[10]=ufDest;                                           // K  UF (del destino real)
  row[11]=ccDe(o.tipo_destino,o.pkDestinoM);                // L  Centro de costo
  // M  Descripción centro de costo → fórmula: vacío
  row[13]=o.horaSalida||'';                                 // N  Hora salida
  row[14]=o.horaLlegada||'';                                // O  Hora llegada
  row[15]=(o.pkOrigenM!=null)?String(o.pkOrigenM):'';       // P  Pk inicial (origen en metros)
  row[16]='4513';                                           // Q  Ruta Nacional inicial
  row[17]=ufIni;                                            // R  UF inicial
  row[18]=(o.pkDestinoM!=null)?String(o.pkDestinoM):'';     // S  Pk final (destino real en metros)
  row[19]='4513';                                           // T  Ruta Nacional final
  row[20]=ufDest;                                           // U  UF final
  // V  Distancia (km) → fórmula: vacío
  // W  Transporte de material m3*Km → fórmula: vacío
  row[23]='m3km';                                           // X  UNIDAD
  // Y  CATEGORIA → vacío
  row[25]=o.conductor||'';                                  // Z  Conductor
  row[26]=o.esDefault?'Pendiente por cubicar':'';           // AA Observaciones
  // AB–AH (27–33) → AREA RESPONSABLE·TIEMPO·CORTE·TIPO DE VIAJE·volqueta·ACTA·CONTRATISTA: vacío (fórmula / la digitadora)
  return row;
}
function collectRows(){
  const rows=[];
  grupos.forEach(g=>{
    const cub=grupoCub(g);
    if(g.modo==='agrupado'){
      const r=g.renAgr;
      rows.push(buildRow({remision:r.remision, placa:g.placa, cubicaje:cub, viajes:g.cantAgr,
        tipo_destino:g.tipo_destino, pkOrigenM:origenPkMeters(g.origen), pkDestinoM:pkMeters(r.pk),
        horaSalida:'', horaLlegada:'', conductor:r.conductor, esDefault:g.esDefault}));
    } else {
      g.renglones.forEach(r=>{
        rows.push(buildRow({remision:r.remision, placa:g.placa, cubicaje:cub, viajes:1,
          tipo_destino:g.tipo_destino, pkOrigenM:origenPkMeters(g.origen), pkDestinoM:pkMeters(r.pk),
          horaSalida:r.hs, horaLlegada:r.hl, conductor:r.conductor, esDefault:g.esDefault}));
      });
    }
  });
  externos.forEach(x=>{
    rows.push(buildRow({remision:x.remision, placa:x.placa, cubicaje:x.cub, viajes:1,
      tipo_destino:x.tipo_destino, pkOrigenM:pkMeters(x.origen), pkDestinoM:pkMeters(x.pkDestino),
      horaSalida:x.hs, horaLlegada:x.hl, conductor:x.conductor, esDefault:false}));
  });
  return rows;
}

/* ---------- progreso / totales ---------- */
function refresh(){
  let tot=0, rem=0;
  grupos.forEach(g=>{
    if(g.modo==='agrupado'){ tot++; if((g.renAgr.remision||'').trim()) rem++; }
    else g.renglones.forEach(r=>{ tot++; if((r.remision||'').trim()) rem++; });
  });
  externos.forEach(x=>{ tot++; if((x.remision||'').trim()) rem++; });
  document.getElementById('progRem').textContent=rem;
  document.getElementById('progTot').textContent=tot;
  document.getElementById('progFilas').textContent=tot;
  const vacio=(tot===0);
  document.getElementById('btnCopiar').disabled=vacio;
  document.getElementById('btnCsv').disabled=vacio;
}

/* ---------- copiar / descargar ---------- */
function copiarTodo(btn){
  const rows=collectRows();
  if(!rows.length){ alert('No hay renglones para copiar.'); return; }
  const tsv=rows.map(r=>r.join('\t')).join('\n');
  const ok=()=>{ const o=btn.innerHTML; btn.classList.add('copied'); btn.innerHTML='✓ Copiado'; setTimeout(()=>{btn.classList.remove('copied');btn.innerHTML=o;},1600); };
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tsv).then(ok).catch(()=>fallbackCopiar(tsv,ok));
  else fallbackCopiar(tsv,ok);
}
function fallbackCopiar(text, ok){
  const ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.top='-1000px'; ta.style.opacity='0';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try{ document.execCommand('copy'); ok(); }catch(e){ alert('No se pudo copiar automáticamente.'); }
  document.body.removeChild(ta);
}
function csvCell(v){ const s=String(v==null?'':v); return /[;"\r\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; }
function descargarCsv(){
  const rows=collectRows();
  if(!rows.length){ alert('No hay renglones para exportar.'); return; }
  const csv='﻿'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n');   // UTF-8 con BOM, separador ;
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='volquetas_'+(FECHA||'export')+'.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
