// D170: aplica los data-estilo del marcado ANTES de que corra la lógica de la pantalla (ver tema.js).
if(window.TM2Estilos) TM2Estilos.aplicar();
  const rol=localStorage.getItem('rol');
  if(!rol || (rol!=='residente' && rol!=='admin')){ window.location.href='index.html'; }
  document.getElementById('userDisplay').textContent=localStorage.getItem('usuario')||'residente';
  if(rol==='admin'){var _bm=document.getElementById('btnMenu');if(_bm)_bm.style.display='inline-block';}
  function logout(){ localStorage.removeItem('usuario'); localStorage.removeItem('rol'); localStorage.removeItem('tm2_token'); window.location.href='index.html'; }
