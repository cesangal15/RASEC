// D170: aplica los data-estilo del marcado ANTES de que corra la lógica de la pantalla (ver tema.js).
if(window.TM2Estilos) TM2Estilos.aplicar();
// Tiles por usuario (§3 del prompt): capataces y las chequeadoras con doble deber (mairy/maleja/luzdary)
// conservan su reporte de obra + asistencia; jeisson (rol asistencia_plus) solo tiene asistencia
// (reporta operadores) + resumen sin gestión.
// D84: `albert` y `ariel` salieron a UF3 → se eliminaron sus tiles (ya no tenían login).
// D145: `albert` VUELVE a tierras (UF1/UF2) y recupera su reporte de obra. NO recupera la asistencia:
// la cuadrilla ALBERT sigue conservando el nombre pero la reportan `maleja`/`maria` (D84(3)/D134), así
// que se le excluye del ASISTENCIA_TILE de abajo — con la cuadrilla en manos de otro, el formulario no
// le traería a nadie. Su fila de USUARIOS lo lleva DIRECTO a `reporte-capataz.html` (un solo tile no
// merece pantalla de selección); esta entrada es la red de seguridad por si algún día se le apunta
// aquí. `ariel` sigue fuera.
const TILES = {
  'angel':      [{href:'reporte-capataz.html', ico:'📋', t:'Reporte de Capataz', p:'Actividades del día con producción y maquinaria'}],
  'albert':     [{href:'reporte-capataz.html', ico:'📋', t:'Reporte de Capataz', p:'Actividades del día con producción y maquinaria'}],
  'alejo':      [{href:'reporte-capataz.html', ico:'📋', t:'Reporte de Capataz', p:'Actividades del día con producción y maquinaria'}],
  'alejandro':  [{href:'reporte-capataz.html', ico:'📋', t:'Reporte de Capataz', p:'Actividades del día con producción y maquinaria'}],
  'robinson':   [{href:'reporte-capataz.html', ico:'📋', t:'Reporte de Capataz', p:'Actividades del día con producción y maquinaria'}],
  'mairy':      [{href:'reporte-chequeadora.html', ico:'🚛', t:'Reporte de Chequeadora', p:'Viajes por PK destino con origen del material'}],
  // Chequeadoras con doble deber (jul-2026): además de su reporte de obra, reportan la asistencia de
  // su cuadrilla (maleja -> ALBERT, luzdary -> ALEJANDRO; el ASISTENCIA_TILE se agrega abajo automático).
  'maleja':     [{href:'reporte-chequeadora.html', ico:'🚛', t:'Reporte de Chequeadora', p:'Viajes por PK destino con origen del material'}],
  'luzdary':    [{href:'reporte-chequeadora.html', ico:'🚛', t:'Reporte de Chequeadora', p:'Viajes por PK destino con origen del material'}],
  // D134 (TEMPORAL, vacaciones de `maleja`): `maria` entra al doble deber con el mismo par de tiles que
  // las otras chequeadoras. La cuadrilla que reporta NO se decide aquí sino en la hoja CUADRILLAS
  // (`responsables` de ALBERT = `maleja,maria`): esta entrada solo le abre la puerta a asistencia.html.
  // Para revertir: quitar `maria` de esa celda y devolverle `redirige=reporte-chequeadora.html` en
  // USUARIOS — con eso vuelve a entrar directo a su reporte y ya no pasa por aquí (esta línea puede
  // quedarse: sin cuadrillas a cargo el formulario de asistencia no le traería a nadie).
  'maria':      [{href:'reporte-chequeadora.html', ico:'🚛', t:'Reporte de Chequeadora', p:'Viajes por PK destino con origen del material'}],
  // Drenajes (D72): capataces ODT/ODL con doble deber — su reporte de drenajes + asistencia de su
  // cuadrilla (el ASISTENCIA_TILE se agrega abajo automáticamente por no ser jeisson).
  'mauricio':   [{href:'reporte-drenajes.html', ico:'🌧️', t:'Reporte de Drenajes', p:'Actividades ODT con personal y maquinaria'}],
  'eduardo':    [{href:'reporte-drenajes.html', ico:'🌧️', t:'Reporte de Drenajes', p:'Actividades ODT con personal y maquinaria'}],
  'enrique':    [{href:'reporte-drenajes.html', ico:'🌧️', t:'Reporte de Drenajes', p:'Actividades ODT con personal y maquinaria'}],
  'jairo':      [{href:'reporte-drenajes.html', ico:'🌧️', t:'Reporte de Drenajes', p:'Actividades ODL con personal y maquinaria'}],
  // D139: `jeisson` suma un tercer tile a OBRA — la flota de maquinaria. Es el primer usuario de
  // asistencias que entra a una pantalla de obra, aceptado a propósito: su cuadrilla es OPERADORES,
  // los operadores de estas máquinas. NO mezcla los módulos — `produccion-maquinaria.html` habla con
  // el Apps Script de obra y el aislamiento de D69 (Sheet y script propios de asistencias) no se toca.
  // Solo ve la pestaña de Flota; la de producción del día es de admin/residente.
  'jeisson':    [{href:'asistencia.html', ico:'👷', t:'Asistencia de mi grupo', p:'Reporta la asistencia de los operadores'},
                 {href:'resumen-asistencia.html', ico:'📋', t:'Resumen de asistencias', p:'Resumen del día y descarga del Excel Navision'},
                 {href:'produccion-maquinaria.html', ico:'🚜', t:'Flota de maquinaria', p:'Alta, baja y reingreso de máquinas de la obra'}],
  // D88: duvan = el jeisson de DRENAJES (solo asistencias). Reporta CUALQUIER cuadrilla de ODT/ODL —
  // el formulario le muestra el selector de cuadrilla igual que al admin, porque el backend le entrega
  // las cuatro (cuadrillasDeUsuario acota por área) — y revisa el resumen combinado ODT+ODL.
  'duvan':      [{href:'asistencia.html', ico:'👷', t:'Asistencia de drenajes', p:'Reporta la asistencia de cualquier cuadrilla ODT/ODL'},
                 {href:'resumen-asistencia.html', ico:'📋', t:'Resumen de asistencias', p:'Resumen del día y Excel Navision de ODT y ODL'}],
  // D101: residente de UF3 — mismo par de tiles que duvan, pero sobre el área `uf3` (proyecto 3703).
  // Reporta por CUALQUIER cuadrilla de UF3 porque hoy ninguna tiene capataz con login; el backend le
  // entrega solo las suyas (cuadrillasDeUsuario acota por área). Exactamente DOS tiles: nada de obra.
  'residente_uf3': [{href:'asistencia.html', ico:'👷', t:'Asistencia de UF3', p:'Reporta la asistencia de las cuadrillas de UF3, incluidos días anteriores'},
                 {href:'resumen-asistencia.html', ico:'📋', t:'Resumen de asistencias', p:'Resumen del día y Excel Navision de 3703'}],
  // D119: `angie` — asistencias de TM2 Sur. Mismo par de tiles que duvan y residente_uf3, pero sobre
  // TRES áreas (tierras + ODT + ODL). El backend le entrega todas las cuadrillas activas de las tres
  // (cuadrillasDeUsuario acota por área) y el selector del formulario las etiqueta por área. UF3 fuera.
  'angie':      [{href:'asistencia.html', ico:'👷', t:'Asistencia de personal', p:'Reporta la asistencia de cualquier cuadrilla de tierras, ODT u ODL, incluidos días anteriores'},
                 {href:'resumen-asistencia.html', ico:'📋', t:'Resumen de asistencias', p:'Resumen del día y Excel Navision de 3701 y 3702'}],
  // Residentes de área (D72): su panel de drenajes + el resumen de asistencia SOLO de su área (odt/odl).
  'residente_odt': [{href:'residente-drenajes.html', ico:'🌧️', t:'Panel de Drenajes ODT', p:'Bandeja, envío a DATA y WhatsApp de tu área'},
                    {href:'resumen-asistencia.html', ico:'📋', t:'Resumen de asistencias ODT', p:'Resumen del día y Excel Navision de tu área'}],
  'residente_odl': [{href:'residente-drenajes.html', ico:'🌧️', t:'Panel de Drenajes ODL', p:'Bandeja, envío a DATA y WhatsApp de tu área'},
                    {href:'resumen-asistencia.html', ico:'📋', t:'Resumen de asistencias ODL', p:'Resumen del día y Excel Navision de tu área'}],
  // D84: residente de drenajes UNIFICADO (ODT + ODL en un solo usuario). El panel y el resumen le
  // muestran las dos áreas juntas.
  // D158: además, el TABLERO DE PRODUCCIÓN mensual — el mismo que ven el jefe y
  // el residente de tierras. Es de tierras, no de drenajes, y aun así entra:
  // el residente de drenajes ya consulta el resumen de obra completo (D131), y
  // en la reunión mensual se le pregunta por las mismas cifras. Solo lectura:
  // el tablero le esconde los botones de actualizar a todo el que no es admin.
  'residente_dren': [{href:'residente-drenajes.html', ico:'🌧️', t:'Panel de Drenajes', p:'Bandeja combinada ODT + ODL, envío a DATA y WhatsApp'},
                     {href:'resumen-asistencia.html', ico:'📋', t:'Resumen de asistencias', p:'Resumen del día y Excel Navision de ODT y ODL'},
                     {href:'tablero-produccion.html', ico:'📊', t:'Tablero de Producción (mensual)', p:'Velocidad contra meta, avance del contrato y clima de la obra'}]
};
const ASISTENCIA_TILE = {href:'asistencia.html', ico:'👷', t:'Asistencia de personal', p:'Reporta la asistencia de tu cuadrilla'};
// Admin tiene acceso a todo el sistema (D65): si llega aquí (p. ej. con "atrás" del navegador en vez
// de menu.html) ve TODOS los tiles en lugar de ser expulsado a index.html.
const ADMIN_TILES=[
  {href:'reporte-capataz.html', ico:'📋', t:'Reporte de Capataz', p:'Actividades del día con producción y maquinaria'},
  {href:'reporte-chequeadora.html', ico:'🚛', t:'Reporte de Chequeadora', p:'Viajes por PK destino con origen del material'},
  {href:'asistencia.html', ico:'👷', t:'Asistencia (formulario)', p:'Reporta la asistencia de cualquier cuadrilla'},
  {href:'resumen-asistencia.html', ico:'📋', t:'Resumen de asistencias', p:'Resumen del día, Excel Navision y gestión de personal'}
];

window.onload = function(){
  // D82: sesión en localStorage (sobrevive cierre del navegador en zona muerta)
  const rol=localStorage.getItem('rol'), usuario=(localStorage.getItem('usuario')||'').trim().toLowerCase();
  if(!rol || !usuario || (!TILES[usuario] && rol!=='admin')){ window.location.href='index.html'; return; }
  document.getElementById('userDisplay').textContent=usuario;
  if(rol==='admin'){
    const bm=document.createElement('button');
    bm.className='logout-btn'; bm.textContent='← Menú'; bm.style.borderColor='var(--accent)'; bm.style.color='var(--accent)'; bm.style.marginRight='6px';
    bm.onclick=function(){location.href='menu.html';};
    document.querySelector('.header-user').prepend(bm);
    document.getElementById('tiles').innerHTML = ADMIN_TILES.map(t=>
      `<a class="tile" href="${esc(t.href)}"><div class="ico">${t.ico}</div><div class="t-main"><h2>${esc(t.t)}</h2><p>${esc(t.p)}</p></div><div class="arrow">→</div></a>`
    ).join('');
    return;
  }
  let tiles=TILES[usuario].slice();
  // El tile de "reportar asistencia de tu cuadrilla" es solo para quien reporta gente (capataces/mairy).
  // jeisson y duvan (D88) ya lo traen en su lista; los residentes de área (D72) y el unificado (D84)
  // revisan, no reportan.
  // D101: residente_uf3 también trae sus dos tiles en la lista (no se le agrega el genérico).
  // D119: `angie` tampoco lo recibe — sus dos tiles ya vienen en la lista, y el genérico ("Asistencia
  // de tu cuadrilla") le duplicaría el mismo destino con un texto que no describe su alcance.
  // D145: `albert` tampoco — vuelve a tierras solo para el reporte de obra; la asistencia de la
  // cuadrilla ALBERT la siguen reportando `maleja`/`maria` (D84(3)/D134). Si algún día la cuadrilla
  // vuelve a ser suya (su login en la celda `responsables`), se quita esta condición y ya.
  if(usuario!=='jeisson' && usuario!=='duvan' && usuario!=='residente_uf3' && usuario!=='angie'
     && usuario!=='albert'
     && rol!=='residente_odt' && rol!=='residente_odl' && rol!=='residente_dren') tiles.push(ASISTENCIA_TILE);
  document.getElementById('tiles').innerHTML = tiles.map(t=>
    `<a class="tile" href="${esc(t.href)}"><div class="ico">${t.ico}</div><div class="t-main"><h2>${esc(t.t)}</h2><p>${esc(t.p)}</p></div><div class="arrow">→</div></a>`
  ).join('');
};
function logout(){
  // solo la sesión: la cola de envíos pendientes NO se borra al cerrar sesión (D82)
  localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token');
  window.location.href='index.html';
}
