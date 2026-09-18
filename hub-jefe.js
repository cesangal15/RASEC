/* ============================================================================
 * HUB DEL JEFE (V3-10 / D181) — un panel con pestañas que montan las pantallas
 * existentes en un iframe del mismo origen (?embed=1), sin fusionar su código:
 *   Resumen (jefe.html) · Revisión de DATA (data.html) · Catálogos BASE (grilla.html)
 * + enlace al Tablero. Los iframes se crean perezosamente y se conservan vivos
 * (cambiar de pestaña NO pierde lo editado). Rango de fechas común para Resumen y
 * DATA. CSP D170: eventos por data-on-* (tema.js), funciones globales.
 * ==========================================================================*/
if(window.TM2Estilos) TM2Estilos.aplicar();

const ROLES_HUB = ['admin','jefe','residente','residente_dren','residente_odt','residente_odl'];
const USUARIOS_OK = ['jeisson'];
const VOLVER = { admin:'menu.html', residente:'residente.html' };

const rol = localStorage.getItem('rol')||'', usuario = (localStorage.getItem('usuario')||'').trim().toLowerCase();
if(!rol || (ROLES_HUB.indexOf(rol)<0 && USUARIOS_OK.indexOf(usuario)<0) || !(window.TM2Auth && TM2Auth.get())){ location.href='index.html'; }
const PUEDE_EDITAR = ['admin','jefe','residente'].indexOf(rol)>=0 || USUARIOS_OK.indexOf(usuario)>=0;
document.getElementById('userDisplay').textContent = usuario+' · '+rol;
const VOLVER_A = VOLVER[rol] || (USUARIOS_OK.indexOf(usuario)>=0 ? 'seleccion-reporte.html' : '');
if(VOLVER_A){ const bm=document.getElementById('btnMenu'); bm.style.display='inline-block'; bm.setAttribute('data-on-click', "irA('"+VOLVER_A+"')"); }

function logout(){ localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token'); location.href='index.html'; }

const TABS = [
  { id:'resumen', label:'Resumen',           page:'jefe.html',   fecha:true,  ver:true },
  { id:'data',    label:'Revisión de DATA',  page:'data.html',   fecha:true,  ver:PUEDE_EDITAR },
  { id:'base',    label:'Catálogos BASE',    page:'grilla.html', fecha:false, ver:PUEDE_EDITAR },
];
const EXT = [ { id:'tablero', label:'Tablero ↗', href:'tablero-produccion.html' } ];
const PAGE2TAB = { data:'data', grilla:'base' };

let desde='', hasta='', actTab='', frames={}, dirtyByTab={}, stale={};

/* rango por defecto: periodo 16→15 que contiene hoy */
function periodoDeHoy(){
  const h=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'}); const y=+h.slice(0,4), m=+h.slice(5,7), d=+h.slice(8,10);
  const fin=new Date(Date.UTC(y,m-1,15)); let ini=new Date(Date.UTC(y,m-2,16));
  if(d>=16){ ini=new Date(Date.UTC(y,m-1,16)); fin.setUTCMonth(fin.getUTCMonth()+1); }
  const iso=(dt)=>dt.toISOString().slice(0,10); return { desde:iso(ini), hasta:iso(fin) };
}
function frameSrc(tab){ let s=tab.page+'?embed=1'; if(tab.fecha) s+='&desde='+encodeURIComponent(desde)+'&hasta='+encodeURIComponent(hasta); return s; }

function pintarTabs(){
  let h='';
  TABS.filter(function(t){ return t.ver; }).forEach(function(t){
    h+='<button class="tab'+(t.id===actTab?' on':'')+'" data-on-click="verTab(\''+t.id+'\')">'+esc(t.label)+(dirtyByTab[t.id]>0?'<span class="dot" title="cambios sin guardar"></span>':'')+'</button>';
  });
  EXT.forEach(function(e){ h+='<button class="tab ext" data-on-click="irA(\''+e.href+'\')">'+esc(e.label)+'</button>'; });
  document.getElementById('tabs').innerHTML=h;
}
function verTab(id){ const tab=TABS.filter(function(t){ return t.id===id && t.ver; })[0]; if(tab) mostrar(id); }
function mostrar(id){
  const tab=TABS.filter(function(t){ return t.id===id; })[0]; if(!tab) return;
  let f=frames[id];
  if(f && stale[id]){   // el rango cambió mientras esta pestaña no estaba visible → recargar
    if(!(id==='data' && dirtyByTab[id]>0 && !confirm('Hay cambios sin guardar en Revisión de DATA. ¿Recargar con el nuevo rango y descartarlos?'))){
      f.src=frameSrc(tab); dirtyByTab[id]=0;
    }
    delete stale[id];
  }
  if(!f){ f=document.createElement('iframe'); f.id='if-'+id; f.title=tab.label; frames[id]=f; f.src=frameSrc(tab); document.getElementById('marco').appendChild(f); }
  Object.keys(frames).forEach(function(k){ frames[k].classList.toggle('oculto', k!==id); });
  const cg=document.getElementById('cargando'); if(cg) cg.style.display='none';
  actTab=id; try{ localStorage.setItem('tm2_hub_tab', id); }catch(e){} if(location.hash!=='#'+id) location.hash=id;
  pintarTabs();
}
function verFechas(){
  desde=document.getElementById('desde').value; hasta=document.getElementById('hasta').value||desde;
  if(!desde){ return; }
  TABS.forEach(function(t){
    if(!t.fecha || !frames[t.id]) return;
    if(t.id===actTab){
      if(t.id==='data' && dirtyByTab[t.id]>0 && !confirm('Hay cambios sin guardar en Revisión de DATA. ¿Recargar con el nuevo rango y descartarlos?')) return;
      frames[t.id].src=frameSrc(t); dirtyByTab[t.id]=0;
    } else { stale[t.id]=true; }
  });
  pintarTabs();
}

/* dirty avisado por cada iframe hija (postMessage) */
window.addEventListener('message', function(ev){
  if(ev.origin!==location.origin) return;
  const m=ev.data; if(!m || m.tm2!=='dirty') return;
  const tab=PAGE2TAB[m.page]; if(!tab) return;
  dirtyByTab[tab]=m.n||0; pintarTabs();
});
window.addEventListener('beforeunload', function(e){
  const hayDirty=Object.keys(dirtyByTab).some(function(k){ return dirtyByTab[k]>0; });
  if(hayDirty){ e.preventDefault(); e.returnValue=''; }
});

/* arranque */
(function(){
  const p=periodoDeHoy(); desde=p.desde; hasta=p.hasta;
  document.getElementById('desde').value=desde; document.getElementById('hasta').value=hasta;
  pintarTabs();
  let inicial=(location.hash||'').replace('#','');
  if(!TABS.some(function(t){ return t.id===inicial && t.ver; })){ try{ inicial=localStorage.getItem('tm2_hub_tab')||''; }catch(e){} }
  if(!TABS.some(function(t){ return t.id===inicial && t.ver; })) inicial='resumen';
  mostrar(inicial);
})();
