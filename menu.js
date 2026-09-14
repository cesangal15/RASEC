// D170: aplica los data-estilo del marcado ANTES de que corra la lógica de la pantalla (ver tema.js).
if(window.TM2Estilos) TM2Estilos.aplicar();
  // D82: sesión en localStorage (sobrevive cierre del navegador en zona muerta)
  const rol=localStorage.getItem('rol');
  if(!rol || rol!=='admin'){ window.location.href='index.html'; }
  const usuario=localStorage.getItem('usuario')||'admin';
  document.getElementById('userDisplay').textContent=usuario;
  // Hero de PC: mismo dato de sesión y la fecha de hoy (solo presentación)
  document.getElementById('heroUser').textContent=usuario;
  const hoy=new Date().toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'});
  document.getElementById('heroDate').textContent=hoy.charAt(0).toUpperCase()+hoy.slice(1);
  // solo la sesión: la cola de envíos pendientes NO se borra al cerrar sesión (D82)
  function logout(){ localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token'); window.location.href='index.html'; }
