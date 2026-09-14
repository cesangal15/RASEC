// D170: aplica los data-estilo del marcado ANTES de que corra la lógica de la pantalla (ver tema.js).
if(window.TM2Estilos) TM2Estilos.aplicar();
const APPS_SCRIPT_URL = GALCA_ENV.url.obra;          // entorno.js (D168): producción o prueba
// D138: la flota esperada la sirve la hoja MAQUINAS por fecha (`?action=maquinas`), así que esta
// pantalla ya dice la verdad hacia atrás: consultar el 15-jul compara contra las máquinas que había
// ESE día, no contra las de hoy. Lo de abajo es el respaldo si el catálogo no responde.
// D137: se esperan TODAS las del catálogo, no solo las productivas — de un vibro o del finisher
// también hay que poder saber si trabajó o si nadie lo reportó.
// D136: NH69, BL009, EXC001, EXC013, EXC014, CS78B, NH404, NH420, CAT900 y NH421 devueltas (ago-2026).
const MAQUINAS_RESPALDO = ['BL005','EXC015','MO03','MO04','MO09','FNG02','CR019','CR013','CR016','CR08','NH403','CR026','RT-02'];
const TIPO_RESPALDO = {
  'BL005':'BULLDOZER',
  'EXC015':'EXCAVADORA',
  'MO03':'MOTONIVELADORA','MO04':'MOTONIVELADORA','MO09':'MOTONIVELADORA',
  'FNG02':'FINISHER',
  'CR019':'VIBROCOMPACTADOR','CR013':'VIBROCOMPACTADOR','CR016':'VIBROCOMPACTADOR','CR08':'VIBROCOMPACTADOR','NH403':'VIBROCOMPACTADOR',
  'CR026':'MINIBULDOZER',
  'RT-02':'RETROEXCAVADORA'
};
let TODAS_MAQUINAS = MAQUINAS_RESPALDO.slice();
let TIPO_EQUIPO = Object.assign({}, TIPO_RESPALDO);

window.onload = function() {
  const rol = localStorage.getItem('rol');
  const usuario = localStorage.getItem('usuario');
  if (!rol || rol !== 'admin') { window.location.href = 'index.html'; return; }
  document.getElementById('userDisplay').textContent = usuario;
  if(rol==='admin'){var _bm=document.getElementById('btnMenu');if(_bm)_bm.style.display='inline-block';}
  document.getElementById('fechaConsulta').value = new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
};

function logout() { localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token'); window.location.href = 'index.html'; }

async function consultar() {
  const fecha = document.getElementById('fechaConsulta').value;
  const proyecto = document.getElementById('proyectoFiltro').value;
  if (!fecha) { alert('Selecciona una fecha'); return; }

  document.getElementById('resultados').innerHTML = '<div class="loading">⏳ Consultando datos...</div>';

  try {
    let url = `${APPS_SCRIPT_URL}?action=estado&fecha=${fecha}`;
    if (proyecto) url += `&proyecto=${encodeURIComponent(proyecto)}`;
    // D138: la flota vigente de ESE día va en paralelo con el estado; si falla, queda el respaldo.
    const [resp] = await Promise.all([fetch(url), cargarFlota(fecha)]);
    const data = await resp.json();
    renderResultados(data.reportadas || [], fecha, proyecto);
  } catch(err) {
    document.getElementById('resultados').innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Error al consultar. Verifica tu conexión.</p></div>`;
  }
}

/* D138 — flota ESPERADA en la fecha consultada (hoja MAQUINAS). Solo entran las esperadas: el
 * finisher y su vibro, que entran y salen de la obra, no salen como "FALTA" los días que no están. */
async function cargarFlota(fecha){
  const fl = await TM2Flota.cargar(APPS_SCRIPT_URL, fecha, {ids:MAQUINAS_RESPALDO, tipos:TIPO_RESPALDO, prog:{}});
  const esperadas = fl.maquinas.filter(m => m.esperada !== false);
  if(esperadas.length){ TODAS_MAQUINAS = TM2Flota.ids(esperadas); TIPO_EQUIPO = TM2Flota.tipos(esperadas); }
}

function renderResultados(reportadas, fecha, proyecto) {
  const reportadasSet = new Set(reportadas.map(r => r.id_maquina));
  const faltantes = TODAS_MAQUINAS.filter(m => !reportadasSet.has(m));
  const fechaDisplay = new Date(fecha + 'T12:00:00').toLocaleDateString('es-CO', {weekday:'long',year:'numeric',month:'long',day:'numeric'});

  let html = `
  <div class="resumen-grid">
    <div class="resumen-card total"><div class="num">${TODAS_MAQUINAS.length}</div><div class="lbl">Total Máquinas</div></div>
    <div class="resumen-card ok"><div class="num">${reportadasSet.size}</div><div class="lbl">Reportadas</div></div>
    <div class="resumen-card falta"><div class="num">${faltantes.length}</div><div class="lbl">Faltantes</div></div>
  </div>`;

  if (faltantes.length > 0) {
    html += `<div class="section-title">❌ Sin reporte — ${esc(fechaDisplay)}</div><div class="maq-grid">`;
    faltantes.forEach(m => {
      html += `<div class="maq-item faltante">
        <div class="maq-id">${esc(m)}</div>
        <div class="maq-tipo">${esc(TIPO_EQUIPO[m]||'')}</div>
        <span class="maq-badge no">FALTA</span>
      </div>`;
    });
    html += `</div>`;
  }

  if (reportadas.length > 0) {
    html += `<div class="section-title">✅ Reportadas</div><div class="maq-grid">`;
    // Dedup por máquina
    const vistas = new Set();
    reportadas.forEach(r => {
      if (vistas.has(r.id_maquina)) return;
      vistas.add(r.id_maquina);
      html += `<div class="maq-item reportada">
        <div class="maq-id">${esc(r.id_maquina)}</div>
        <div class="maq-tipo">${esc(TIPO_EQUIPO[r.id_maquina]||'')}</div>
        <span class="maq-badge ok">✓ OK</span>
        <div class="maq-capataz">${esc(r.capataz||'')}</div>
      </div>`;
    });
    html += `</div>`;
  }

  if (reportadas.length === 0 && faltantes.length === TODAS_MAQUINAS.length) {
    html += `<div class="empty-state"><div class="icon">📭</div><p>No hay reportes para esta fecha</p></div>`;
  }

  document.getElementById('resultados').innerHTML = html;
}
