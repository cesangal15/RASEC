// D170: aplica los data-estilo del marcado ANTES de que corra la lógica de la pantalla (ver tema.js).
if(window.TM2Estilos) TM2Estilos.aplicar();
/* ============ D108 — LOGIN VALIDADO EN EL BACKEND (backlog 2.21) ============
 * Antes, este archivo llevaba dentro el mapa `USUARIOS` con TODAS las contraseñas en claro. Como
 * GitHub Pages sirve el archivo tal cual, se leían con «ver código fuente» sin siquiera entrar.
 * Ahora las claves viven en la hoja privada `USUARIOS` y las valida el Apps Script.
 *
 * SIN SEÑAL (D82) — el punto que había que resolver antes de mover nada. El `start_url` del PWA es
 * esta pantalla, y antes SIEMPRE pedía credenciales; validar contra el servidor habría dejado fuera
 * a un capataz en zona muerta. Dos piezas lo evitan:
 *   1. SESIÓN RECORDADA: si en este teléfono ya se entró, se ofrece «Continuar» y no se teclea nada.
 *      De paso desaparece el login diario que hoy sufren en campo.
 *   2. CREDENCIAL RECORDADA: tras el primer login CON señal se guarda el HASH (nunca la contraseña)
 *      de `usuario:clave`, con el mismo algoritmo del backend. Sin señal, la clave se valida contra
 *      ese hash y se restaura el rol que devolvió el servidor la última vez.
 * O sea: hace falta señal UNA vez por teléfono, igual que ya pasa con el roster de asistencia.
 *
 * Lo que esto NO es: autenticación de verdad. Los endpoints siguen abiertos y el rol vive en el
 * navegador. Sacar las claves del código público era el objetivo de 2.21; el resto es otro trabajo.
 */
const APPS_SCRIPT_URL = GALCA_ENV.url.obra;          // entorno.js (D168): producción o prueba
const TIMEOUT_LOGIN_MS = 12000;

// SHA-256 de `usuario:clave` en hex minúscula — MISMO texto y MISMO formato que hashClave_ del
// backend, o el login sin señal no cuadraría. SubtleCrypto exige contexto seguro: GitHub Pages es
// https, así que está disponible; si no lo estuviera, se devuelve '' y simplemente no se recuerda
// la credencial (se sigue pudiendo entrar con señal).
async function hashClave(usuario, clave){
  try{
    if(!(window.crypto && crypto.subtle)) return '';
    const txt = String(usuario||'').trim().toLowerCase() + ':' + String(clave==null?'':clave);
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
    return Array.from(new Uint8Array(buf)).map(b=>('0'+b.toString(16)).slice(-2)).join('');
  }catch(e){ return ''; }
}

function verError(msg){
  const err=document.getElementById('errorMsg');
  err.textContent = msg || 'Usuario o contraseña incorrectos';
  err.classList.add('visible');
}
function limpiarError(){ document.getElementById('errorMsg').classList.remove('visible'); }

// Guarda la sesión y entra. `redirige` viaja con la sesión para que el camino sin señal sepa a dónde
// mandar a cada quien sin tener que consultar nada.
function entrar(sesion){
  localStorage.setItem('usuario', sesion.usuario);
  localStorage.setItem('rol', sesion.rol);
  localStorage.setItem('redirige', sesion.redirige || 'menu.html');
  // D84: `areas` solo si viene con contenido; si no, las pantallas lo derivan del rol (no-regresión).
  if(Array.isArray(sesion.areas) && sesion.areas.length) localStorage.setItem('areas', JSON.stringify(sesion.areas));
  else localStorage.removeItem('areas');
  sessionStorage.removeItem('usuario');   // limpieza de versiones anteriores a D82
  sessionStorage.removeItem('rol');
  window.location.href = sesion.redirige || 'menu.html';
}

/* ---------- sesión recordada ---------- */
/* Pantalla de aterrizaje por ROL. Solo se usa como RESPALDO para las sesiones que quedaron guardadas
 * por el login ANTERIOR, que no dejaba `redirige` en el almacenamiento: sin esto, quien ya estuviera
 * dentro al actualizar la app caería en `menu.html` (que es del admin) y su guard lo devolvería al
 * login — justo en campo y quizá sin señal. Tras el siguiente login con señal manda el `redirige` que
 * responde el servidor, que es el exacto. No es un secreto: es navegación. */
const REDIRIGE_POR_ROL = {
  admin:'menu.html', encargado:'encargado.html', residente:'residente.html', jefe:'hub-jefe.html',
  digitadora:'digitadora.html', chequeadora:'seleccion-reporte.html', capataz:'seleccion-reporte.html',
  capataz_odt:'seleccion-reporte.html', capataz_odl:'seleccion-reporte.html',
  residente_dren:'seleccion-reporte.html', residente_odt:'seleccion-reporte.html',
  residente_odl:'seleccion-reporte.html', asistencia_plus:'seleccion-reporte.html',
  asistencia_plus_dren:'seleccion-reporte.html', asistencia_plus_uf3:'seleccion-reporte.html',
  asistencia_plus_tm2:'seleccion-reporte.html',  // D119: asistencias de TM2 Sur (tierras+ODT+ODL)
  parte_maquinaria:'revision-maquinaria.html'    // D165: revisor dedicado del parte digital de maquinaria
};
function sesionGuardada(){
  const u=localStorage.getItem('usuario'), r=localStorage.getItem('rol');
  if(!u || !r) return null;
  // D109: una sesión SIN token no sirve para nada — el backend rechaza todas sus llamadas. Pasa con
  // las sesiones que dejó la versión anterior (entonces no existían los tokens). En vez de dejar
  // "Continuar" y que la persona entre a una pantalla que falla en cada consulta, se pide el login
  // otra vez: es un único trámite y sale de ahí con token.
  if(!(window.TM2Auth && TM2Auth.get())) return null;
  let areas=[]; try{ areas=JSON.parse(localStorage.getItem('areas')||'[]'); }catch(e){}
  const destino = localStorage.getItem('redirige') || REDIRIGE_POR_ROL[r] || 'seleccion-reporte.html';
  return { usuario:u, rol:r, areas:Array.isArray(areas)?areas:[], redirige:destino };
}
function continuarSesion(){ const s=sesionGuardada(); if(s) entrar(s); }
function otraCuenta(){
  document.getElementById('sesionBox').style.display='none';
  document.getElementById('formBox').style.display='block';
  limpiarError();
  document.getElementById('usuario').focus();
}

/* ---------- login ---------- */
async function login(){
  const u=document.getElementById('usuario').value.trim().toLowerCase();
  const c=document.getElementById('clave').value;
  const btn=document.getElementById('btnLogin');
  limpiarError();
  if(!u || !c){ verError('Escribe tu usuario y tu contraseña.'); return; }
  btn.disabled=true; btn.textContent='VALIDANDO…';
  try{
    const ctrl = window.AbortController ? new AbortController() : null;
    const t = ctrl ? setTimeout(()=>ctrl.abort(), TIMEOUT_LOGIN_MS) : null;
    const resp = await fetch(APPS_SCRIPT_URL, {
      method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
      body: JSON.stringify({ action:'login', usuario:u, clave:c }),
      signal: ctrl ? ctrl.signal : undefined
    });
    if(t) clearTimeout(t);
    const data = await resp.json();
    if(!data || !data.ok){ document.getElementById('clave').value=''; verError((data&&data.error)||'Usuario o contraseña incorrectos'); return; }
    // Login bueno CON señal: se recuerda el hash para poder entrar sin señal la próxima vez.
    const h = await hashClave(u, c);
    // D109: el token firmado se guarda junto a la credencial recordada, para que el ingreso SIN señal
    // recupere también la sesión con la que hablar al backend cuando vuelva la cobertura.
    if(h) localStorage.setItem('cred_'+u, JSON.stringify({ h:h, rol:data.rol, areas:data.areas||[], redirige:data.redirige, token:data.token||'' }));
    if(data.token) TM2Auth.set(data.token);
    entrar({ usuario:u, rol:data.rol, areas:data.areas||[], redirige:data.redirige });
  }catch(err){
    // Sin señal (o el servidor no contestó): se intenta contra la credencial recordada de ESTE usuario.
    const guardada = localStorage.getItem('cred_'+u);
    if(guardada){
      try{
        const g=JSON.parse(guardada), h=await hashClave(u,c);
        if(h && h===g.h){
          if(g.token) TM2Auth.set(g.token);   // D109: se reusa el token del último ingreso con señal
          entrar({ usuario:u, rol:g.rol, areas:g.areas||[], redirige:g.redirige }); return;
        }
        document.getElementById('clave').value='';
        verError('Contraseña incorrecta (validada sin señal, con la última que usaste en este teléfono).');
        return;
      }catch(e){}
    }
    verError('Sin señal y este usuario todavía no ha entrado en este teléfono. '
      + 'Hay que entrar UNA vez con señal; después ya se puede sin conexión.');
  }finally{
    btn.disabled=false; btn.textContent='INGRESAR →';
  }
}

// Arranque: si ya hay sesión, se ofrece continuar en vez de pedir credenciales otra vez.
(function(){
  const s=sesionGuardada();
  if(!s){
    // Sesión vieja (usuario/rol guardados pero sin token): se explica por qué se vuelve a pedir la
    // clave, para que no parezca que el sistema se rompió.
    if(localStorage.getItem('usuario') && !(window.TM2Auth && TM2Auth.get())){
      const c=document.querySelector('.card'), d=document.createElement('div');
      d.className='aviso';
      d.textContent='Actualizamos la seguridad del sistema: entra una vez con tu usuario y contraseña. '
        + 'Después el teléfono te deja entrar solo, también sin señal.';
      c.insertBefore(d, document.getElementById('formBox'));
    }
    return;
  }
  document.getElementById('btnSesion').textContent='CONTINUAR COMO '+s.usuario.toUpperCase()+' →';
  document.getElementById('sesionBox').style.display='block';
  document.getElementById('formBox').style.display='none';
})();

// D170: antes era onkeydown en línea en el campo de la clave; la CSP ya no lo admite.
document.getElementById('clave').addEventListener('keydown', function(ev){ if(ev.key==='Enter') login(); });
