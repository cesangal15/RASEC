/* ============================================================================
 * __NOMBRE__ — __TITULO__ (__DECISION__)
 * Qué hace y quién la usa, en dos líneas. CSP D170: sin JS/CSS en línea;
 * eventos con data-on-<evento>="fn(args)" (despachador de tema.js), estilos con
 * clase o data-estilo. Todo texto que viene del servidor o del usuario pasa por
 * esc() antes de entrar en innerHTML (D167).
 * ==========================================================================*/
// D170: aplica los data-estilo del marcado ANTES de que corra la lógica de la pantalla (ver tema.js).
if(window.TM2Estilos) TM2Estilos.aplicar();

// entorno.js (D168) arma la URL sobre auth.js (D169): producción o /prueba. NUNCA escribir una URL de la API aquí.
const API = GALCA_ENV.url.__MODULO__;

// Guard de sesión (D108/D109). Es solo de interfaz: el Worker vuelve a comprobar el rol con el token firmado.
const ROLES = [__ROLES__];
const VOLVER = { admin:'menu.html' };   // a dónde vuelve cada rol con «← Menú» (p. ej. residente:'residente.html')
const rol = localStorage.getItem('rol')||'', usuario = (localStorage.getItem('usuario')||'').trim().toLowerCase();
if(ROLES.indexOf(rol)<0 || !(window.TM2Auth && TM2Auth.get())){ location.href='index.html'; }
document.getElementById('userDisplay').textContent = usuario;
if(VOLVER[rol]) document.getElementById('btnMenu').style.display='inline-block';
function volver(){ irA(VOLVER[rol]||'index.html'); }
// Solo la sesión: la cola de envíos pendientes NO se borra al cerrar sesión (D82).
function logout(){ localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token'); location.href='index.html'; }

// Fecha por defecto en hora de Colombia (D50): nunca toISOString(), que de noche da el día siguiente.
function hoy(){ return new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'}); }

// Lectura: GET ?action=… (auth.js adjunta el token a toda llamada a la API).
async function leer(action, params){
  const q = new URLSearchParams(Object.assign({ action:action }, params||{}));
  const r = await fetch(API+'?'+q.toString());
  return r.json();
}
// Escritura: POST con Content-Type text/plain para poder leer la respuesta real (D30). El servidor valida
// el payload (D166); un id_registro generado en el cliente hace el reenvío idempotente (D82).
async function escribir(payload){
  const r = await fetch(API, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(payload) });
  return r.json();
}

async function cargar(){
  const z = document.getElementById('zonaPrincipal');
  try{
    const d = await leer('__ACCION__', { fecha:hoy() });
    if(!d.ok) throw new Error(d.error||'respuesta sin ok');
    render(d);
  }catch(err){
    z.innerHTML = '<div class="empty-state">⚠️ No se pudo cargar. Revisa la conexión.<br><small>'+esc(err.message||err)+'</small></div>';
  }
}

function render(d){
  document.getElementById('zonaPrincipal').innerHTML =
    '<div class="card"><h3>'+esc('__TITULO__')+'</h3><p class="intro">'+esc(JSON.stringify(d).slice(0,200))+'</p></div>';
}

cargar();
