// D170: aplica los data-estilo del marcado ANTES de que corra la lógica de la pantalla (ver tema.js).
if(window.TM2Estilos) TM2Estilos.aplicar();
const APPS_SCRIPT_URL = GALCA_ENV.url.parte;         // entorno.js (D168) sobre auth.js (D169): ruta /parte del Worker, SIN token (público por QR)
const API = APPS_SCRIPT_URL + '?mod=parte';

/* ---------- MODO DE PRUEBA (?demo=1 o ?eq=DEMO) ----------
 * Datos de ejemplo en el propio archivo: sirve para enseñar la pantalla y ensayar sin señal y sin
 * guardar nada. Lo que se «envía» solo se muestra en la confirmación. */
const PARAMS = new URLSearchParams(location.search);
const DEMO = (window.PARTE_DEMO===true) || PARAMS.get('demo')==='1' || (PARAMS.get('eq')||'').toUpperCase()==='DEMO';
const DEMO_DATOS = {
  equipos: [
    { codigo:'VOL048', tipo:'VOLQUETAS DOBLETROQUE', placa:'NNM180', proveedor:'ORTIZ CONSTRUCCIONES Y PROYECTOS S.A.', medidor:'KM', activo:true, ultimo:{ final:27120, fecha:'2026-09-10', hora_a:'17:00', origen:'bandeja' } },
    { codigo:'CR026',  tipo:'VIBROCOMPACTADOR', placa:'POCR026', proveedor:'ORTIZ CONSTRUCCIONES Y PROYECTOS S.A.', medidor:'HOROMETRO', activo:true, ultimo:{ final:1698, fecha:'2026-09-10', hora_a:'16:30', origen:'bandeja' } },
    { codigo:'EXC015', tipo:'EXCAVADORAS', placa:'MC706830', proveedor:'ORTIZ CONSTRUCCIONES Y PROYECTOS S.A.', medidor:'HOROMETRO', activo:true, ultimo:{ final:2711.6, fecha:'2026-09-10', hora_a:'17:00', origen:'bandeja' } },
    { codigo:'MO004',  tipo:'MOTONIVELADORAS', placa:'MC725594', proveedor:'ORTIZ CONSTRUCCIONES Y PROYECTOS S.A.', medidor:'HOROMETRO', activo:true, ultimo:{ final:2337, fecha:'2026-09-09', hora_a:'17:00', origen:'catalogo' } },
    { codigo:'RT-02',  tipo:'RETROCARGADOR', placa:'', proveedor:'MAQUISABANA', medidor:'HOROMETRO', activo:true, ultimo:{ final:7049.6, fecha:'2026-09-10', hora_a:'17:00', origen:'bandeja' } }
  ],
  operadores: ['Adonis Polo','Aleixer Lizarazo','Alexander Garcia','Alexander Sanchez','Anthony Riales','Brayan Castel','Carlos Valdiviejo','Cristian Sepulveda','Ever Coronel','Farid Navarro','Franklin Basto','German Florez','Gisela Vera','Jaime Niño','Javier Ayala','Jeiner Ortiz','Johan Rugeles','Jorge Sepulveda','Jose Miguel Prada','Jose Robles','Luis Hurtado','Luis Rincon','Mauricio Merchan','Nelson Rangel','Nicolle Bermudez','Oscar Ramirez','Reinaldo Florez','Richard Almeida','Ruideiver Montes','Samuel Camacho','Samuel Carrillo','Wilmar Pahuana','Wilson Lozano','Yeison Fernandez','Yerson Sandoval'],
  cc: [
    { centro_coste:'3701.02.07', proyecto:'3701', descripcion_cc:'Terraplenes (solo conformación)', usos:504 },
    { centro_coste:'3702.02.11', proyecto:'3702', descripcion_cc:'Transporte de material para terraplén', usos:460 },
    { centro_coste:'3701.02.11', proyecto:'3701', descripcion_cc:'Transporte de material para terraplén', usos:457 },
    { centro_coste:'3702.02.07', proyecto:'3702', descripcion_cc:'Terraplenes (solo conformación)', usos:417 },
    { centro_coste:'3701.05.04', proyecto:'3701', descripcion_cc:'Terraplén en MSR', usos:376 },
    { centro_coste:'3701.03.01', proyecto:'3701', descripcion_cc:'Subbase granular', usos:316 },
    { centro_coste:'3701.02.05', proyecto:'3701', descripcion_cc:'Excavación común', usos:243 },
    { centro_coste:'3703.03.06', proyecto:'3703', descripcion_cc:'Base granular', usos:560 },
    { centro_coste:'3703.03.02', proyecto:'3703', descripcion_cc:'Subbase granular', usos:421 },
    { centro_coste:'3703.02.05', proyecto:'3703', descripcion_cc:'Excavación sin clasificar', usos:263 },
    { centro_coste:'3701.03.03', proyecto:'3701', descripcion_cc:'Base granular', usos:172 },
    { centro_coste:'3702.03.01', proyecto:'3702', descripcion_cc:'Subbase granular', usos:157 },
    { centro_coste:'3701.02.10', proyecto:'3701', descripcion_cc:'Excavación de préstamo', usos:132 },
    { centro_coste:'3701.02.08', proyecto:'3701', descripcion_cc:'Conformación de botadero (ZODME)', usos:82 },
    { centro_coste:'3701.I0408', proyecto:'3701', descripcion_cc:'Paisajismo y zonas verdes', usos:88 },
    { centro_coste:'3701.06.02', proyecto:'3701', descripcion_cc:'Rellenos con material seleccionado', usos:34 },
    { centro_coste:'3701.06.01', proyecto:'3701', descripcion_cc:'Excavaciones varias sin clasificar', usos:32 },
    { centro_coste:'3702.06.05', proyecto:'3702', descripcion_cc:'Tubería de concreto reforzado', usos:48 },
    { centro_coste:'3701.07.01', proyecto:'3701', descripcion_cc:'Cunetas en concreto', usos:11 },
    { centro_coste:'Taller', proyecto:'', descripcion_cc:'Taller / mantenimiento / equipo varado', usos:0, pseudo:true },
    { centro_coste:'Disponible', proyecto:'', descripcion_cc:'Disponible (sin frente, lluvia, sin operador)', usos:0, pseudo:true },
    { centro_coste:'Domingo/Festivo', proyecto:'', descripcion_cc:'Domingo o festivo', usos:0, pseudo:true }
  ],
  sugerencias: {
    'VOLQUETAS DOBLETROQUE': ['Cargue terraplen','Terraplen','Viaje corte de talud','Disponible por lluvia','Domingo','Taller'],
    'VIBROCOMPACTADOR': ['Compactacion en berma, material base y sub base','Compactacion sub base y base','Compactacion terraplen','Compactando terraplen PR14+400','Conformacion terraplen','Disponible por lluvia'],
    'EXCAVADORAS': ['Cargue terraplen','Cargue de volquetas','Cargue de material','Corte y cargue de material','Cargando terraplen y cortando talud','Descapote'],
    'MOTONIVELADORAS': ['Extendiendo y conformando terraplen','Extendido terraplen','Cereo terraplen','Conformando terraplen','Cereo sub base','Aproximacion terraplen'],
    'RETROCARGADOR': ['Excavacion de tuberia para solado, movimiento de tuberia y colocacion','Descalificada de berma de ampliacion','Llenado de terraza de ODT','Arreglo acceso de mixer']
  }
};
DEMO_DATOS.actividades={
  'VOLQUETAS DOBLETROQUE': { habituales:[{item:'02.11',actividad:'Cargue terraplen (más de 1 km)',nombre:'Transporte materiales de excavación y préstamos (>1.000 m)',veces:40,propio:true},{item:'02.10',actividad:'Cargue terraplen (100 m a 1 km)',nombre:'Transporte materiales de excavación y préstamos (100 - 1.000 m)',veces:9,propio:true},{item:'03.04',actividad:'Cargue btc',nombre:'Transporte de base granular',veces:6,propio:false},{item:'03.02',actividad:'Cargue sub base',nombre:'Transporte de subbase granular',veces:4,propio:false},{item:'02.08',actividad:'Viaje a botadero',nombre:'Conformación y disposición de sobrantes',veces:2,propio:false}], proyecto_habitual:'3702' },
  'EXCAVADORAS': { habituales:[{item:'02.05',actividad:'Excavación (cargue de volquetas)',veces:22,propio:true},{item:'02.06',actividad:'Excavación de préstamo',veces:5,propio:false},{item:'02.03',actividad:'Descapote',veces:4,propio:false}], proyecto_habitual:'3701' },
  'MOTONIVELADORAS': { habituales:[{item:'02.07',actividad:'Terraplén',veces:18,propio:true},{item:'03.01',actividad:'Subbase granular',veces:7,propio:true}], proyecto_habitual:'3702' },
  'VIBROCOMPACTADOR': { habituales:[{item:'02.07',actividad:'Terraplén',veces:12,propio:true},{item:'05.04',actividad:'Terraplén en MSR',veces:9,propio:true},{item:'03.01',actividad:'Subbase granular',veces:3,propio:false}], proyecto_habitual:'3701' },
  'RETROCARGADOR': { habituales:[{item:'05.04',actividad:'Terraplén en MSR',veces:8,propio:true},{item:'06.02',actividad:'Relleno de drenajes (ODT)',veces:4,propio:true},{item:'07.01',actividad:'Cunetas en concreto',veces:2,propio:false}], proyecto_habitual:'3701' },
  todas:[{item:'02.03',actividad:'Descapote'},{item:'02.05',actividad:'Excavación (cargue de volquetas)'},{item:'02.06',actividad:'Excavación de préstamo'},{item:'02.07',actividad:'Terraplén'},{item:'02.08',actividad:'Botadero / ZODME'},{item:'02.10',actividad:'Cargue terraplen (100 m a 1 km)'},{item:'02.11',actividad:'Cargue terraplen (más de 1 km)'},{item:'03.01',actividad:'Subbase granular'},{item:'03.03',actividad:'Base granular / BTC'},{item:'03.04',actividad:'Transporte de BTC'},{item:'05.04',actividad:'Terraplén en MSR'},{item:'06.01',actividad:'Excavación para drenajes (ODT)'},{item:'06.02',actividad:'Relleno de drenajes (ODT)'},{item:'07.01',actividad:'Cunetas en concreto'},{item:'I0408',actividad:'Paisajismo / zonas verdes'},{item:'11.01',actividad:'Señalización / PMT'}]
};
function demoEquipo(eq){
  const lista=DEMO_DATOS.equipos.map(q=>({ codigo:q.codigo, tipo:q.tipo, placa:q.placa }));
  const q=DEMO_DATOS.equipos.find(x=>x.codigo.replace(/[^A-Z0-9]/gi,'').toUpperCase()===String(eq||'').replace(/[^A-Z0-9]/gi,'').toUpperCase());
  if(!q) return { ok:true, equipo:null, equipos:lista, hoy:hoyBogota() };
  return { ok:true, equipo:{ codigo:q.codigo, tipo:q.tipo, placa:q.placa, proveedor:q.proveedor, medidor:q.medidor, activo:q.activo }, ultimo:q.ultimo,
    operadores:DEMO_DATOS.operadores, cc:DEMO_DATOS.cc, sugerencias:DEMO_DATOS.sugerencias[q.tipo]||[],
    actividades:Object.assign({ todas:DEMO_DATOS.actividades.todas }, DEMO_DATOS.actividades[q.tipo]||{ habituales:[], proyecto_habitual:'3701' }), hoy:hoyBogota() };
}
function demoReporte(payload){
  // imita las alertas del servidor para que la confirmación se vea igual que en real
  const filas=[]; let finalPrevio=ULTIMO?ULTIMO.final:null, guardadas=0;
  payload.tramos.forEach(t=>{
    const partes = (t.reparto&&t.reparto.length>1) ? t.reparto : [null];
    partes.forEach(p=>{
      const alertas=[];
      const ccF=(p?p.cc:(t.reparto&&t.reparto[0]&&t.reparto[0].cc)); if(!ccF) alertas.push('SIN_CC'); else if(!/^(37\d\d\.\d\d\.\d\d|Taller|Disponible|Domingo\/Festivo)$/.test(ccF)&&!DEMO_DATOS.cc.some(c=>c.centro_coste===ccF)) alertas.push('CC_DESCONOCIDO');
      if(!p && finalPrevio!==null && num(t.inicial)!==null && Math.abs(num(t.inicial)-finalPrevio)>0.001) alertas.push('INICIAL_DISTINTO');
      const tot=(num(t.final)!==null&&num(t.inicial)!==null)?num(t.final)-num(t.inicial):0, tope=TOPES[EQ.medidor];
      if(!p && tope && tot>tope.alerta) alertas.push('TOTAL_ALTO');
      filas.push({ id_registro:'demo', alertas:alertas }); guardadas++;
    });
    if(num(t.final)!==null) finalPrevio=num(t.final);
  });
  return { ok:true, guardadas:guardadas, duplicadas:0, filas:filas };
}

/* ---------- estado ---------- */
let EQ = null;            // {codigo,tipo,placa,proveedor,medidor,activo}
let ULTIMO = null;        // {final,fecha,hora_a,origen}
const HORA_DE_DEF='07:00', HORA_A_DEF='15:30';   // jornada estándar del parte (solo valor inicial, editable)
let OPERADORES = [], CC = [], SUGS = [], TOPES = {HOROMETRO:{bloquea:24,alerta:12,unidad:'h'},KM:{bloquea:700,alerta:400,unidad:'km'}};
/* D174 — actividad primero, CC derivado (backlog 4.06). El operador elige QUÉ HIZO en palabras de obra;
 * el ítem sale de la actividad y el proyecto (3701/3702) del PR: PR ≤ 30+000 → 3701, si no 3702; sin PR,
 * el proyecto habitual del equipo. Tres capas: habituales (chips) · todas (picker) · texto libre (sin
 * CC, llega con SIN_CC y lo pone revisión). El CC sigue visible y se puede elegir directo. */
/* D178 — solo las 5 actividades más usadas (chips) y, si no está, «Otra» = texto libre con centro de coste
 * opcional escrito a mano (llega con SIN_CC o CC_DESCONOCIDO y lo corrige revisión). El buscador con todas
 * las actividades y los CC directos se retiró del formulario a pedido del residente: menos lista, menos error.
 * El PR se admite en METROS (14400) o en KILÓMETROS (14.4 · 32): un valor menor que 100 se lee como km. */
const MAX_HABITUALES = 5;
let ACTS = { habituales:[], todas:[], proyecto_habitual:'3701' };
function prMetros(pr){ const n=num(pr); if(n===null) return null; return n<100 ? Math.round(n*1000) : n; }
function proyectoDe(pr){ const n=prMetros(pr); if(n===null) return ACTS.proyecto_habitual||'3701'; return n<=30000 ? '3701' : '3702'; }
function ccDeItem(item, pr){ return item ? proyectoDe(pr)+'.'+item : ''; }
// D178: un CC derivado o escrito con proyecto 3701/3702 sigue al PR; los pseudo-CC y 3703 no se tocan.
function ccConProyecto(cc, pr){ const m=/^370[12]\.(.+)$/.exec(String(cc||'')); return m ? proyectoDe(pr)+'.'+m[1] : cc; }
// «3701.2.7» escrito a mano: se lee como 02.07 si ese CC existe en la lista y 02.70 no (misma regla que el backend).
function normCCTexto(cc){ const m=/^(37\d\d)\.(\d{1,2})\.(\d{1,2})$/.exec(String(cc||'').trim()); if(!m) return String(cc||'').trim(); const p2=x=>x.length>=2?x:('0'+x).slice(-2), pd=x=>x.length>=2?x.slice(0,2):(x+'00').slice(0,2); const num=m[1]+'.'+p2(m[2])+'.'+pd(m[3]), abr=m[1]+'.'+p2(m[2])+'.'+p2(m[3]); if(m[3].length===2) return num; return (!ccDe(num) && ccDe(abr)) ? abr : num; }
function habituales(){ return (ACTS.habituales||[]).slice(0, MAX_HABITUALES); }
function actLabel(item){ const a=(ACTS.habituales||[]).concat(ACTS.todas||[]).find(x=>x.item===item); return a ? a.actividad : item; }
function actLabelHTML(r){
  if(r.libre) return '<b>Otra actividad (escrita a mano)</b><small>'+(r.cc?'CC '+esc(r.cc)+' · UF'+ufDe(r.cc)+' · lo verifica revisión':'sin centro de coste: lo pone quien revisa el parte')+'</small>';
  if(r.item){ const a=(ACTS.habituales||[]).concat(ACTS.todas||[]).find(x=>x.item===r.item); return '<b>'+esc(r.act||actLabel(r.item))+'</b><small>CC '+esc(r.cc||'')+(r.cc?' · UF'+ufDe(r.cc):'')+(a&&a.nombre?' · '+esc(a.nombre):'')+'</small>'; }
  return ccLabelHTML(r.cc);
}
let HOY = hoyBogota();
let CACHE_FRESCO = true, CACHE_GUARDADO = '';   // D176: ¿la ficha del equipo vino del servidor o de la copia del teléfono?
let tramos = [];          // [{id, inicial, final, hora_de, hora_a, cc, pr, uf, desc, varada, lluvia, obs, iniPre, reparto:null|[{cc,pct,pr}]}]
let operador = '';
let pickerCtx = null;     // {tipo:'operador'|'cc', tramoId, repIdx}
let enviando = false;
let ultimoEnvio = null;   // para "Reportar otro tramo"
let intento = false;      // ya intentó enviar: se marcan en rojo los campos que faltan

function hoyBogota(){ return new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'}); }
// D179: el parte se admite hasta 7 días atrás (antes hoy/ayer): un operador que pasó la semana sin señal o
// sin teléfono transcribe los partes físicos atrasados él mismo. El backend solo rechaza fechas futuras.
const DIAS_ATRAS = 7;
function diasAntes(f, n){ const d=new Date(f+'T12:00:00'); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); }
function num(v){ if(v===''||v===null||v===undefined) return null; const n=Number(String(v).replace(',','.')); return isFinite(n)?n:null; }
function fmt(n){ return (Math.round(n*100)/100).toLocaleString('es-CO',{maximumFractionDigits:2}); }
function ufDe(cc){ const s=String(cc||''); return s.indexOf('3701')===0?'1':s.indexOf('3702')===0?'2':s.indexOf('3703')===0?'3':''; }
function norm(s){ return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().trim(); }
function uuid(){ if(window.crypto && crypto.randomUUID) return crypto.randomUUID(); return 'p-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10); }
function keyOp(){ return 'tm2_parte_op_'+(EQ?EQ.codigo:''); }
function normCod(c){ return String(c||'').replace(/[^A-Z0-9]/gi,'').toUpperCase(); }
// D176: último final entre los partes de este equipo que aún esperan señal (cola local, FIFO → el último manda).
function ultimoFinalPendiente(){
  if(!EQ || !EQ.medidor || !window.TM2Offline || !TM2Offline.pendientes) return null;
  const mios=TM2Offline.pendientes(it=>it.tipo==='parte' && it.payload && normCod(it.payload.codigo)===normCod(EQ.codigo));
  if(!mios.length) return null;
  const ts=mios[mios.length-1].payload.tramos||[], t=ts[ts.length-1];
  if(!t || num(t.final)===null) return null;
  return { final:num(t.final), fecha:t.fecha||'', hora_a:t.hora_a||'', origen:'telefono' };
}
function mostrar(id){ ['pantallaQR','pantallaError','formMain','pantallaOk'].forEach(p=>document.getElementById(p).classList.toggle('hidden', p!==id)); document.getElementById('submitBar').classList.toggle('hidden', id!=='formMain'); }
function ccDe(cc){ return CC.find(x=>x.centro_coste===cc); }
function ccLabelHTML(cc){ const c=ccDe(cc); if(!c) return '<b>'+esc(cc||'')+'</b>'; return '<b>'+esc(c.centro_coste)+'</b>'+(c.descripcion_cc?'<small>'+esc(c.descripcion_cc)+'</small>':''); }
function ccTexto(cc){ const c=ccDe(cc); return c ? c.centro_coste+(c.descripcion_cc?' · '+c.descripcion_cc:'') : (cc||''); }

/* ---------- carga ---------- */
async function cargar(){
  const eq=(PARAMS.get('eq')||'').trim();
  let data;
  if(DEMO){
    document.getElementById('demoBar').classList.remove('hidden');
    const sel=document.getElementById('demoEq');
    sel.innerHTML=DEMO_DATOS.equipos.map(q=>'<option value="'+esc(q.codigo)+'">'+esc(q.codigo)+' · '+esc(q.tipo)+'</option>').join('');
    const cod = (eq && eq.toUpperCase()!=='DEMO') ? eq : DEMO_DATOS.equipos[0].codigo;
    sel.value=cod; data=demoEquipo(cod);
  } else {
    // D176: la ficha del equipo (último final, operadores, CC, actividades) se guarda en el teléfono la
    // última vez que abrió con señal (`tm2_cat_parte_<eq>`, mismo mecanismo que drenajes/asistencia/flota,
    // D82). Sin señal se abre con esa copia; sin copia, el aviso dice que hay que abrirlo una vez con señal.
    let r;
    try{
      r=await TM2Offline.catalogoCache('parte_'+(eq ? eq.toUpperCase().replace(/[^A-Z0-9]/g,'') : 'lista'), async function(){
        const resp=await fetch(API+'&op=equipo&eq='+encodeURIComponent(eq), {cache:'no-store'});
        const d=await resp.json();
        if(!d || typeof d!=='object') throw new Error('respuesta ilegible');
        return d;
      }, 72);
    }catch(e){
      document.getElementById('errorMsg').textContent= navigator.onLine
        ? 'Sin señal o el servidor no responde. Revisa la conexión del teléfono y vuelve a intentar.'
        : 'Sin señal, y este teléfono no tiene guardada la ficha de este equipo. Abre el parte una vez con señal: desde ahí funciona también sin señal.';
      mostrar('pantallaError'); return;
    }
    data=r.data; CACHE_FRESCO=r.fresco; CACHE_GUARDADO=r.guardado;
  }
  if(data.hoy && CACHE_FRESCO) HOY=data.hoy; else HOY=hoyBogota();   // con copia vieja, «hoy» es el del teléfono, no el de la copia
  if((!eq && !DEMO) || !data.ok || !data.equipo){
    // pantalla "escanea tu QR" + selector de respaldo
    const sel=document.getElementById('selEquipo');
    const lista=(data.equipos||[]);
    // D173b: vigentes hoy primero; debajo, el resto de fichas (reemplazos, equipos fuera): todos pueden reportar.
    const opt=q=>'<option value="'+esc(q.codigo)+'">'+esc(q.codigo)+' · '+esc(q.tipo)+(q.placa?' · '+esc(q.placa):'')+'</option>';
    const vig=lista.filter(q=>q.en_flota!==false), otros=lista.filter(q=>q.en_flota===false);
    sel.innerHTML='<option value="">— Elige tu equipo —</option>'+
      (otros.length ? '<optgroup label="En la flota hoy">'+vig.map(opt).join('')+'</optgroup><optgroup label="Otros equipos con ficha (reemplazos, fuera de la flota)">'+otros.map(opt).join('')+'</optgroup>'
                    : vig.map(opt).join(''));
    document.getElementById('qrError').textContent = (eq && !data.ok) ? (data.error||'') : '';
    document.getElementById('hCodigo').textContent='🚜 Parte'; document.getElementById('hSub').textContent='Elige tu equipo';
    mostrar('pantallaQR'); return;
  }
  EQ=data.equipo; ULTIMO=data.ultimo||null; OPERADORES=data.operadores||[]; CC=data.cc||[]; SUGS=data.sugerencias||[];
  // D176: si hay partes de ESTE equipo esperando señal en el teléfono, el último final es el de ellos
  // (el servidor todavía no los conoce). Nada más se toma de la cola: solo el medidor.
  const pend=ultimoFinalPendiente();
  if(pend) ULTIMO=pend;
  if(data.actividades) ACTS=Object.assign({ habituales:[], todas:[], proyecto_habitual:'3701' }, data.actividades);
  if(data.topes) TOPES=data.topes;
  document.getElementById('hCodigo').textContent='🚜 '+EQ.codigo;
  document.getElementById('hSub').textContent=EQ.tipo+(EQ.placa?' · '+EQ.placa:'')+(EQ.proveedor?' · '+EQ.proveedor:'');
  document.getElementById('hMedidor').textContent= EQ.medidor==='HOROMETRO' ? 'HORÓMETRO' : EQ.medidor==='KM' ? 'KILÓMETROS' : 'SIN MEDIDOR';
  document.title='Parte '+EQ.codigo;
  const f=document.getElementById('fecha'); f.value=HOY; f.max=HOY; f.min=diasAntes(HOY, DIAS_ATRAS);
  operador = localStorage.getItem(keyOp()) || '';
  pintarOperador();
  const av=document.getElementById('avisoTop'); av.classList.add('hidden');
  const viejo=document.querySelector('#formMain .tm2off-banner-cat'); if(viejo) viejo.remove();
  if(!CACHE_FRESCO) TM2Offline.bannerCatalogoViejo(document.querySelector('#formMain .container'),
    'Sin señal: usando la ficha del equipo guardada el '+TM2Offline.fechaCorta(CACHE_GUARDADO)+'. El parte se guarda en el teléfono y sube solo al volver la señal.');
  if(!EQ.medidor){ av.innerHTML='Este equipo está <b>sin medidor definido</b> en el catálogo (PARTE_EQUIPOS). Se registra sin horómetro/kilometraje y quien revisa lo verá con la alerta <b>SIN_MEDIDOR</b>.'; av.classList.remove('hidden'); }
  // D173b: fuera de la flota de hoy (reemplazo, equipo devuelto o de otro frente): se reporta igual, con aviso.
  if(EQ.en_flota===false){ av.innerHTML=(av.classList.contains('hidden')?'':av.innerHTML+'<br>')+'Este equipo <b>no figura hoy en la flota</b> de la obra (¿reemplazo de otro varado?). Puedes reportar normal: quien revisa lo verá con la alerta <b>FUERA_DE_FLOTA</b>.'; av.classList.remove('hidden'); }
  else if(!ULTIMO){ av.innerHTML='No hay un <b>medidor anterior</b> registrado para este equipo: escribe el inicial tal como está en el parte físico.'; av.classList.remove('hidden'); }
  else if(!EQ.activo){ av.innerHTML='Este equipo figura <b>inactivo</b> en el catálogo. El parte se guarda igual y lo revisa maquinaria.'; av.classList.remove('hidden'); }
  tramos=[]; intento=false; addTramo();
  mostrar('formMain');
}
function cambiarDemo(cod){ const u=new URL(location.href); u.searchParams.set('demo','1'); u.searchParams.set('eq',cod); history.replaceState(null,'',u.toString()); PARAMS.set('eq',cod); cargar(); }
function abrirEquipoElegido(){
  const v=document.getElementById('selEquipo').value;
  if(!v){ document.getElementById('qrError').textContent='Elige un equipo de la lista.'; return; }
  const u=new URL(location.href); u.searchParams.set('eq', v); location.href=u.toString();
}

/* ---------- operador ---------- */
function pintarOperador(){
  const b=document.getElementById('btnOperador');
  b.textContent= operador || 'Toca para elegir…'; b.classList.toggle('vacio', !operador);
  pintarResumen();
}

/* ---------- tramos ---------- */
function nuevoTramo(base){
  const prev=tramos[tramos.length-1];
  const iniPre = prev ? (prev.final!==''?prev.final:prev.inicial) : (ULTIMO ? ULTIMO.final : '');
  // Jornada estándar por defecto (pedido del dueño, sep-2026): 07:00–15:30 en el primer tramo; el
  // operador solo la toca si hubo extras. Un tramo siguiente arranca donde acabó el anterior, sin hora fin.
  return Object.assign({ id:uuid(), inicial: iniPre===null?'':iniPre, final:'', hora_de: prev ? prev.hora_a : HORA_DE_DEF, hora_a: prev ? '' : HORA_A_DEF, cc:'', pr: prev?prev.pr:'', uf:'', desc:'', varada:'', lluvia:'', obs:'', iniPre: iniPre===null?'':iniPre, reparto:null }, base||{});
}
function addTramo(){
  const t=nuevoTramo(); tramos.push(t); render();
  if(tramos.length>1){ const el=document.getElementById('tramo-'+t.id); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); }
}
function delTramo(id){
  if(tramos.length<=1) return;
  tramos=tramos.filter(t=>t.id!==id); render();
}
function render(){
  const cont=document.getElementById('tramos');
  cont.innerHTML=tramos.map((t,i)=>tramoHTML(t,i)).join('');
  tramos.forEach(t=>{ pintarTotal(t.id); pintarSugs(t.id); });
  pintarResumen();
}
function tramoHTML(t,i){
  const sinMed=!EQ.medidor;
  const unidad = EQ.medidor==='KM' ? 'km' : 'h';
  if(!t.reparto) t.reparto=[{ cc:t.cc||'', pct:100, pr:'' }];
  const rep = true;
  return '<div class="tramo" id="tramo-'+t.id+'">'
   +(sinMed ? '' :
     '<div class="field"><label>'+(EQ.medidor==='KM'?'Kilometraje':'Horómetro')+' <span class="req">*</span></label>'
     +'<div class="medidor">'
     +'<div><input type="number" inputmode="decimal" step="0.1" placeholder="Inicial" value="'+esc(t.inicial)+'" data-on-input="setT(\''+t.id+'\',\'inicial\',this.value)"><div class="sub">INICIAL<br>con que arrancó el día</div></div>'
     +'<div><input type="number" inputmode="decimal" step="0.1" placeholder="Final" value="'+esc(t.final)+'" data-on-input="setT(\''+t.id+'\',\'final\',this.value)"><div class="sub">FINAL<br>lo que marca al terminar</div></div>'
     +'</div>'
     +'<div class="total-box" id="total-'+t.id+'"><span class="t-label">Total</span><span class="t-val">—<small>'+unidad+'</small></span></div>'
     +'<div class="hint" id="hintIni-'+t.id+'"></div>'
     +'</div>')
   +'<div class="grid2">'
   +'<div class="field"><label>Hora de</label><input type="time" value="'+esc(t.hora_de)+'" data-on-input="setT(\''+t.id+'\',\'hora_de\',this.value)"></div>'
   +'<div class="field"><label>Hora a</label><input type="time" value="'+esc(t.hora_a)+'" data-on-input="setT(\''+t.id+'\',\'hora_a\',this.value)"></div>'
   +'</div>'
   +'<div class="bloque"><div class="bloque-t">¿Qué hizo la máquina? <span class="req">*</span></div>'
   +repartoHTML(t)
   +'<div class="hint">Toca una de las actividades habituales o «Otra» para escribirla. El centro de coste sale solo con la actividad y el PR (hasta 30+000 → 3701; de ahí en adelante → 3702). El PR va en metros (14400) o en km (14.4).</div>'
   +'</div>'
   +'<div class="field"><label>Descripción del trabajo</label>'
   +'<textarea rows="2" placeholder="ej. Cargue terraplen PR14+400" data-on-input="setT(\''+t.id+'\',\'desc\',this.value)">'+esc(t.desc)+'</textarea>'
   +'<div class="sugs" id="sugs-'+t.id+'"></div></div>'
   +'<details class="opc"'+((t.varada!==''||t.lluvia!=='')?' open':'')+'><summary>Horas varada / lluvia (opcional)</summary>'
   +'<div class="grid2" data-estilo="margin-top:8px">'
   +'<div class="field"><label>Horas varada</label><input type="number" inputmode="decimal" step="0.5" min="0" value="'+esc(t.varada)+'" data-on-input="setT(\''+t.id+'\',\'varada\',this.value)"></div>'
   +'<div class="field"><label>Horas lluvia</label><input type="number" inputmode="decimal" step="0.5" min="0" value="'+esc(t.lluvia)+'" data-on-input="setT(\''+t.id+'\',\'lluvia\',this.value)"></div>'
   +'</div></details>'
   +'<div class="field"><label>Observaciones <span class="opt">(opcional)</span></label>'
   +'<textarea rows="2" data-on-input="setT(\''+t.id+'\',\'obs\',this.value)">'+esc(t.obs)+'</textarea></div>'
   +'</div>';
}
/* ---------- D174/D178: actividades habituales por fila del reparto ---------- */
function actsHTML(t, j){
  const r=(t.reparto||[])[j]||{}, hab=habituales();
  return '<div class="acts">'
    +hab.map(a=>'<button type="button" class="sug'+(r.item===a.item?' sel':'')+'" data-on-click="usarAct(\''+t.id+'\','+j+','+esc(JSON.stringify(a.item))+')" title="CC '+esc(a.item)+(a.propio?' · esta máquina lo usó hace poco':'')+'">'+esc(a.actividad)+'</button>').join('')
    +'<button type="button" class="sug mas'+(r.libre?' sel':'')+'" data-on-click="elegirLibre(\''+t.id+'\','+j+')">✍ Otra…</button>'
    +'</div>'
    +(r.libre ? '<div class="cc-libre"><label>Centro de coste <span class="opt">(opcional, si lo sabes: ej. 3701.02.07)</span></label><input type="text" inputmode="decimal" placeholder="lo pone revisión si va vacío" value="'+esc(r.cc||'')+'" data-on-input="setRep(\''+t.id+'\','+j+',\'cc\',this.value)"></div>' : '');
}
function usarAct(id, j, item, frase){
  const t=tramos.find(x=>x.id===id); if(!t||!t.reparto||!t.reparto[j]) return;
  const r=t.reparto[j], prev=r.act||'';
  r.item=item; r.libre=false; r.cc=ccDeItem(item, r.pr||t.pr); r.act=frase||actLabel(item);
  if(!String(t.desc||'').trim() || t.desc===prev) t.desc=r.act;   // la descripción arranca con la frase elegida; el operador la afina
  render();
}
// D178: «Otra» = actividad escrita a mano en la descripción, con CC opcional tecleado; sin CC llega SIN_CC.
function elegirLibre(id, j){
  const t=tramos.find(x=>x.id===id); if(!t||!t.reparto||!t.reparto[j]) return;
  const r=t.reparto[j]; r.item=''; r.cc=''; r.act=''; r.libre=true;
  render();
  const ta=document.querySelector('#tramo-'+id+' textarea'); if(ta && !String(t.desc||'').trim()) ta.focus();
}
/* ---------- reparto por porcentaje ---------- */
function repartoHTML(t){
  const rep=t.reparto, varios=rep.length>1, suma=rep.reduce((a,r)=>a+(num(r.pct)||0),0), tot=totalDe(t), tope=TOPES[EQ.medidor];
  return '<div class="rep'+(varios?'':' uno')+'" id="rep-'+t.id+'">'
    +(varios ? '<div class="rep-quick">'+[[50,50],[70,30],[30,70]].map(p=>'<button type="button" data-on-click="repRapido(\''+t.id+'\','+JSON.stringify(p)+')">'+p.join(' / ')+'</button>').join('')+'<button type="button" data-on-click="repIguales(\''+t.id+'\')">partes iguales</button></div>' : '')
    +rep.map((r,j)=>'<div class="rep-row">'
      +'<div class="rep-sel '+((r.cc||r.libre)?'':'vacio')+'" id="ccr-'+t.id+'-'+j+'">'+((r.cc||r.libre)?actLabelHTML(r):'<b>'+(varios?'Actividad / centro de coste '+(j+1):'Elige la actividad')+'</b><small>toca una de abajo</small>')+'</div>'
      +(varios ? '<input type="number" inputmode="decimal" min="0" max="100" step="1" placeholder="%" value="'+esc(r.pct)+'" data-on-input="setRep(\''+t.id+'\','+j+',\'pct\',this.value)" aria-label="porcentaje">'
               +'<button type="button" class="btn-del" data-on-click="delRep(\''+t.id+'\','+j+')" title="Quitar">✕</button>' : '')
      +actsHTML(t, j)
      +'<div class="pr"><label>PR</label><input type="number" inputmode="decimal" step="any" placeholder="ej. 14400 (o 14.4 en km)" value="'+esc(r.pr)+'" data-on-input="setRep(\''+t.id+'\','+j+',\'pr\',this.value)"></div>'
      +'</div>').join('')
    +(varios ? '<div class="rep-sum'+(Math.abs(suma-100)>0.5?' mal':'')+'"><span>'+(tot!==null&&tope?rep.map(r=>fmt(tot*(num(r.pct)||0)/100)+' '+esc(tope.unidad)).join(' + '):'los porcentajes deben sumar 100 %')+'</span><b>'+fmt(suma)+' %</b></div>' : '')
    +'<button type="button" class="btn-add mini" data-on-click="addRep(\''+t.id+'\')">+ '+(varios?'Otro centro de coste':'Fue a otro centro de coste también (se reparte por %)')+'</button>'
    +'</div>';
}
function setRep(id,j,k,v){
  const t=tramos.find(x=>x.id===id); if(!t||!t.reparto||!t.reparto[j]) return; const r=t.reparto[j]; r[k]=v;
  if(k==='pct') pintarRepSuma(t);
  // D174/D178: el PR manda sobre el proyecto (3701/3702) del CC, venga de la actividad o escrito a mano
  if(k==='pr'){ if(r.item) r.cc=ccDeItem(r.item, v); else if(r.cc) r.cc=ccConProyecto(r.cc, v); const b=document.getElementById('ccr-'+id+'-'+j); if(b) b.innerHTML=actLabelHTML(r); }
  if(k==='cc'){ r.cc=normCCTexto(v); const b=document.getElementById('ccr-'+id+'-'+j); if(b){ b.innerHTML=actLabelHTML(r); b.classList.toggle('vacio', !(r.cc||r.libre)); } }
  pintarResumen();
}
function pintarRepSuma(t){
  const box=document.querySelector('#rep-'+t.id+' .rep-sum'); if(!box) return;
  const suma=t.reparto.reduce((a,r)=>a+(num(r.pct)||0),0), tot=totalDe(t), tope=TOPES[EQ.medidor];
  box.classList.toggle('mal', Math.abs(suma-100)>0.5);
  box.innerHTML='<span>'+(tot!==null&&tope?t.reparto.map(r=>fmt(tot*(num(r.pct)||0)/100)+' '+esc(tope.unidad)).join(' + '):'los porcentajes deben sumar 100 %')+'</span><b>'+fmt(suma)+' %</b>';
}
function addRep(id){ const t=tramos.find(x=>x.id===id); if(!t||!t.reparto) return; t.reparto.push({ cc:'', pct:'', pr:'', item:'', libre:false }); repIguales(id); }
function delRep(id,j){ const t=tramos.find(x=>x.id===id); if(!t||!t.reparto||t.reparto.length<=1) return; t.reparto.splice(j,1); if(t.reparto.length===1) t.reparto[0].pct=100; else repIguales(id); render(); }
function repRapido(id,p){ const t=tramos.find(x=>x.id===id); if(!t||!t.reparto) return; while(t.reparto.length<2) t.reparto.push({cc:'',pct:'',pr:'',item:'',libre:false}); t.reparto=t.reparto.slice(0,2); t.reparto[0].pct=p[0]; t.reparto[1].pct=p[1]; render(); }
function repIguales(id){ const t=tramos.find(x=>x.id===id); if(!t||!t.reparto) return; const n=t.reparto.length, base=Math.floor(100/n*100)/100; t.reparto.forEach((r,j)=>{ r.pct = j===n-1 ? Math.round((100-base*(n-1))*100)/100 : base; }); render(); }

function setT(id, k, v){
  const t=tramos.find(x=>x.id===id); if(!t) return;
  t[k]=v;
  if(k==='inicial'||k==='final'){
    pintarTotal(id); if(t.reparto) pintarRepSuma(t);
    // el siguiente tramo arranca donde termina este (si el operador no lo cambió a mano)
    const i=tramos.indexOf(t), sig=tramos[i+1];
    if(k==='final' && sig && (sig.inicial===''||String(sig.inicial)===String(sig.iniPre))){ sig.inicial=v; sig.iniPre=v; const el=document.querySelector('#tramo-'+sig.id+' .medidor input'); if(el) el.value=v; pintarTotal(sig.id); }
  }
  if(k==='hora_a'){ const i=tramos.indexOf(t), sig=tramos[i+1]; if(sig && !sig.hora_de){ sig.hora_de=v; const el=document.querySelectorAll('#tramo-'+sig.id+' input[type=time]')[0]; if(el) el.value=v; } }
  if(k==='desc') pintarSugs(id);
  pintarResumen();
}
function totalDe(t){ const a=num(t.inicial), b=num(t.final); if(a===null||b===null) return null; return Math.round((b-a)*100)/100; }
function pintarTotal(id){
  const t=tramos.find(x=>x.id===id), box=document.getElementById('total-'+id); if(!t||!box) return;
  const tot=totalDe(t), tope=TOPES[EQ.medidor], unidad=tope?esc(tope.unidad):'';
  box.classList.remove('alto','mal');
  let txt='—';
  if(tot!==null){ txt=fmt(tot); if(tot<0) box.classList.add('mal'); else if(tope && tot>tope.bloquea) box.classList.add('mal'); else if(tope && tot>tope.alerta) box.classList.add('alto'); }
  box.querySelector('.t-val').innerHTML=txt+'<small>'+unidad+'</small>';
  const h=document.getElementById('hintIni-'+id);
  if(h){
    const i=tramos.indexOf(t);
    if(tot!==null && tot<0) h.innerHTML='<span class="err">El final es menor que el inicial: revisa los dos números.</span>';
    else if(i===0 && ULTIMO && num(t.inicial)!==null && Math.abs(num(t.inicial)-ULTIMO.final)>0.001)
      h.innerHTML='El inicial cambió: el último registrado era <b>'+fmt(ULTIMO.final)+'</b>'+(ULTIMO.fecha?' ('+esc(ULTIMO.fecha)+')':'')+'. Se enviará marcado para revisión.';
    else if(i===0 && ULTIMO) h.innerHTML='Inicial precargado del último parte'+(ULTIMO.fecha?' ('+esc(ULTIMO.fecha)+')':'')+(ULTIMO.origen==='telefono'?', guardado en este teléfono y pendiente de subir':'')+'. Cámbialo solo si el parte físico dice otra cosa.';
    else h.innerHTML='';
  }
}
function pintarSugs(id){
  const t=tramos.find(x=>x.id===id), box=document.getElementById('sugs-'+id); if(!t||!box) return;
  const q=norm(t.desc);
  // con el campo vacío o con una sugerencia ya elegida se ofrecen todas (menos la elegida): así se puede cambiar de idea
  const exacta = q && SUGS.some(s=>norm(s)===q);
  let lista = (q && !exacta) ? SUGS.filter(s=>norm(s).indexOf(q)>=0) : SUGS.filter(s=>norm(s)!==q);
  const mas = lista.length>6 && !box.dataset.todo;
  if(mas) lista=lista.slice(0,6);
  box.innerHTML=lista.map(s=>'<button type="button" class="sug" data-on-click="usarSug(\''+id+'\',this.textContent)">'+esc(s)+'</button>').join('')
    +(mas?'<button type="button" class="sug mas" data-on-click="verMasSugs(this,\''+id+'\')">más…</button>':'');
}
function usarSug(id, txt){ const t=tramos.find(x=>x.id===id); t.desc=txt; const ta=document.querySelector('#tramo-'+id+' textarea'); if(ta) ta.value=txt; pintarSugs(id); pintarResumen(); }

/* ---------- buscador (solo operador desde D178) ---------- */
function abrirPicker(tipo){
  pickerCtx={tipo:'operador'};
  const inp=document.getElementById('pickerBuscar'); inp.value=''; inp.placeholder='Buscar operador por nombre…';
  document.getElementById('pickerTit').textContent='Toca tu nombre';
  document.getElementById('picker').classList.remove('hidden');
  pintarPicker(); setTimeout(()=>inp.focus(), 50);
}
function cerrarPicker(){ document.getElementById('picker').classList.add('hidden'); pickerCtx=null; }
document.getElementById('pickerBuscar').addEventListener('input', pintarPicker);
function pintarPicker(){
  if(!pickerCtx) return;
  const q=norm(document.getElementById('pickerBuscar').value), list=document.getElementById('pickerList');
  const items=OPERADORES.filter(o=>!q || norm(o).indexOf(q)>=0);
  let html=items.map(o=>'<button type="button" class="picker-item'+(o===operador?' sel':'')+'" data-on-click="elegir('+esc(JSON.stringify(o))+')">'+esc(o)+'</button>').join('');
  if(q && !items.some(o=>norm(o)===q)) html+='<button type="button" class="picker-item" data-on-click="elegirTecleado()">➕ Usar «'+esc(document.getElementById('pickerBuscar').value.trim())+'» <small>nombre que no está en la lista (maquinaria lo revisa)</small></button>';
  list.innerHTML=html||'<div class="picker-vacio">Sin resultados</div>';
}
function elegir(v){
  if(!pickerCtx) return;
  operador=String(v||'').trim(); try{ localStorage.setItem(keyOp(), operador); }catch(e){} pintarOperador();
  cerrarPicker();
}

/* ---------- día sin operación ---------- */
function abrirSinOperacion(){ document.getElementById('sheetSinOp').classList.remove('hidden'); }
function cerrarSinOperacion(){ document.getElementById('sheetSinOp').classList.add('hidden'); }
function sinOperacion(motivo, cc){
  cerrarSinOperacion();
  const ini = ULTIMO ? ULTIMO.final : (num(tramos[0]&&tramos[0].inicial));
  tramos=[nuevoTramo({ inicial: ini===null||ini===undefined?'':ini, final: ini===null||ini===undefined?'':ini, hora_de:'', hora_a:'', cc:cc, pr:'', uf:'', desc:motivo, iniPre: ini===null||ini===undefined?'':ini, reparto:[{ cc:cc, pct:100, pr:'' }] })];
  if(!operador && /sin operador/i.test(motivo)){ operador='Sin operador'; pintarOperador(); }
  render();
  window.scrollTo({top:0,behavior:'smooth'});
}

/* ---------- validación y resumen ---------- */
function validar(){
  const errs=[];
  const fecha=document.getElementById('fecha').value;
  if(!fecha) errs.push('Falta la fecha.');
  else if(fecha>HOY) errs.push('La fecha no puede ser futura.');
  else if(fecha<diasAntes(HOY, DIAS_ATRAS)) errs.push('Solo se admiten partes de los últimos '+DIAS_ATRAS+' días. Uno más viejo lo captura maquinaria desde revisión.');
  if(!document.getElementById('reporteNum').value.trim()) errs.push('Falta el nº del parte físico.');
  if(!operador) errs.push('Falta el operador.');
  const tope=TOPES[EQ.medidor];
  tramos.forEach((t,i)=>{
    const n='';
    if(EQ.medidor){
      const a=num(t.inicial), b=num(t.final);
      if(a===null||b===null) errs.push(n+'faltan el medidor inicial o final.');
      else if(b<a) errs.push(n+'el final ('+fmt(b)+') es menor que el inicial ('+fmt(a)+').');
      else if(tope && b-a>tope.bloquea) errs.push(n+'el total ('+fmt(b-a)+' '+tope.unidad+') pasa de '+tope.bloquea+' '+tope.unidad+'. Revisa el medidor.');
    }
    const rep=t.reparto||[];
    // D174: sin CC vale SOLO en texto libre (una fila, actividad escrita): llega con SIN_CC y lo pone revisión.
    // D178: «Otra» vale sin CC si hay descripción (SIN_CC → revisión) o con un CC escrito a mano.
    const filaOk = r => r.cc || (r.libre && String(t.desc||'').trim());
    if(!rep.length || rep.some(r=>!filaOk(r))) errs.push(rep.some(r=>r.libre&&!r.cc) ? 'Escribe qué hizo la máquina en la descripción (elegiste «Otra», sin centro de coste).' : (rep.length>1 ? 'Falta la actividad de un centro de coste del reparto.' : 'Falta la actividad.'));
    if(rep.length>1){
      if(rep.some(r=>!(num(r.pct)>0))) errs.push('Cada centro de coste necesita su porcentaje.');
      const suma=rep.reduce((a,r)=>a+(num(r.pct)||0),0);
      if(Math.abs(suma-100)>0.5) errs.push('Los porcentajes suman '+fmt(suma)+' % y deben sumar 100 %.');
    }
  });
  return errs;
}
function marcarFaltantes(){
  if(!intento) return;
  document.getElementById('reporteNum').classList.toggle('field-error', !document.getElementById('reporteNum').value.trim());
  document.getElementById('btnOperador').classList.toggle('field-error', !operador);
  tramos.forEach(t=>{
    if(t.reparto) t.reparto.forEach((r,j)=>{ const rb=document.getElementById('ccr-'+t.id+'-'+j); if(rb) rb.classList.toggle('field-error', !(r.cc || (r.libre && String(t.desc||'').trim()))); });
    if(EQ.medidor){ const ins=document.querySelectorAll('#tramo-'+t.id+' .medidor input'); if(ins.length===2){ ins[0].classList.toggle('field-error', num(t.inicial)===null); ins[1].classList.toggle('field-error', num(t.final)===null || (num(t.inicial)!==null && num(t.final)<num(t.inicial))); } }
  });
}
function pintarResumen(){
  if(!EQ) return;
  const errs=validar();
  const b=document.getElementById('resumenBody');
  const tope=TOPES[EQ.medidor];
  let html='';
  tramos.forEach((t,i)=>{
    const tot=totalDe(t);
    const rep=t.reparto||[], varios=rep.length>1;
    let cc = rep.length ? rep.map(r=>(r.cc?(r.item?esc(r.act||actLabel(r.item))+' · ':'')+esc(ccTexto(r.cc)):(r.libre?'<span data-estilo="color:var(--accent-txt)">otra actividad · sin centro de coste, lo pone revisión</span>':'<span data-estilo="color:var(--error-txt)">sin actividad</span>'))+(r.pr?' · PR '+esc(r.pr):'')+(varios?' <b>'+fmt(num(r.pct)||0)+' %</b>'+(tot!==null&&tope?' ('+fmt(tot*(num(r.pct)||0)/100)+' '+esc(tope.unidad)+')':''):'')).join('<br>')
                        : '<span data-estilo="color:var(--error-txt)">sin actividad</span>';
    html+='<div class="r-row">'
      +'<b>'+esc(EQ.codigo)+'</b>'+((t.hora_de||t.hora_a)?' · '+esc(t.hora_de||'?')+'–'+esc(t.hora_a||'?'):'')
      +(EQ.medidor?'<br>'+esc(t.inicial||'—')+' → '+esc(t.final||'—')+' = <b>'+(tot===null?'—':fmt(tot))+' '+(tope?esc(tope.unidad):'')+'</b>':'')
      +'<br>'+cc
      +(t.desc?'<br><i>'+esc(t.desc)+'</i>':'')
      +'</div>';
  });
  html+='<div>'+esc(EQ.codigo)+' · '+esc(document.getElementById('fecha').value||'sin fecha')+' · parte nº <b>'+esc(document.getElementById('reporteNum').value||'—')+'</b> · <b>'+esc(operador||'sin operador')+'</b></div>';
  if(errs.length) html+='<div class="falta"><b>Antes de enviar:</b><br>'+errs.map(esc).join('<br>')+'</div>';
  else html+='<div class="listo">✓ Todo listo. Pulsa ENVIAR PARTE.</div>';
  b.innerHTML=html;
  document.getElementById('btnSubmit').disabled = enviando;
  marcarFaltantes();
}
document.getElementById('fecha').addEventListener('input', pintarResumen);
document.getElementById('reporteNum').addEventListener('input', pintarResumen);

/* ---------- envío ---------- */
function armarPayload(){
  const fecha=document.getElementById('fecha').value, reporte=document.getElementById('reporteNum').value.trim();
  return { mod:'parte', op:'reporte', codigo:EQ.codigo, origen:'qr',
    tramos: tramos.map((t,i)=>{
      const o={ id_registro:t.id, fecha:fecha, reporte_num:reporte, operador:operador,
        inicial: EQ.medidor?num(t.inicial):'', final: EQ.medidor?num(t.final):'',
        inicial_modificado: (i===0 && ULTIMO && num(t.inicial)!==null && Math.abs(num(t.inicial)-ULTIMO.final)>0.001) ? 'SI' : 'NO',
        hora_de:t.hora_de, hora_a:t.hora_a, centro_coste:(t.reparto&&t.reparto[0]?t.reparto[0].cc:t.cc), pr:prMetros(t.reparto&&t.reparto[0]?t.reparto[0].pr:t.pr)===null?'':prMetros(t.reparto&&t.reparto[0]?t.reparto[0].pr:t.pr), uf:ufDe(t.reparto&&t.reparto[0]?t.reparto[0].cc:t.cc),
        descripcion_trabajo:t.desc.trim(), horas_varada:num(t.varada)===null?'':num(t.varada), horas_lluvia:num(t.lluvia)===null?'':num(t.lluvia),
        observaciones:t.obs.trim() };
      if(t.reparto && t.reparto.length>1) o.reparto=t.reparto.map(r=>({ centro_coste:r.cc, pct:num(r.pct), pr:prMetros(r.pr)===null?'':prMetros(r.pr), uf:ufDe(r.cc) }));
      return o; }) };
}
async function enviar(){
  if(enviando) return;
  intento=true;
  const errs=validar();
  if(errs.length){ pintarResumen(); document.getElementById('resumenCard').scrollIntoView({behavior:'smooth',block:'start'}); alert('Revisa antes de enviar:\n\n• '+errs.join('\n• ')); return; }
  const payload=armarPayload(), fecha=payload.tramos[0].fecha, reporte=payload.tramos[0].reporte_num;
  enviando=true; const btn=document.getElementById('btnSubmit'); btn.disabled=true; btn.textContent='ENVIANDO…';
  let data=null, encolado=false;
  if(DEMO){ await new Promise(r=>setTimeout(r,400)); data=demoReporte(payload); }
  else {
    // D176: POST directo (15 s); sin red / timeout / respuesta ilegible → cola local `tm2_cola_envios`
    // (offline.js, D82). El servidor deduplica por `id_registro` (D165), así que un reenvío no duplica.
    const r=await TM2Offline.enviarConCola({ tipo:'parte', url:APPS_SCRIPT_URL, payload:payload, fecha_obra:fecha, usuario:EQ.codigo+' · '+operador });
    if(r.enviado) data=r.res;
    else { encolado=true; data={ ok:true, guardadas:0, duplicadas:0, filas:[] }; }
  }
  enviando=false; btn.disabled=false; btn.textContent='ENVIAR PARTE →';
  if(!data || !data.ok){ alert('No se guardó:\n\n'+((data&&data.error)||'error desconocido')); return; }
  ultimoEnvio={ fecha:fecha, reporte:reporte, tramos:tramos.slice(), filas:data.filas||[] };
  document.getElementById('okIco').textContent = encolado ? '📥' : '✅';
  document.getElementById('okTit').textContent = encolado ? 'Parte guardado en el teléfono' : 'Parte enviado';
  const alertas=(data.filas||[]).reduce((a,f)=>a.concat(f.alertas||[]),[]);
  const okT=document.getElementById('okTramos');
  let k=0;
  okT.innerHTML=tramos.map((t,i)=>{ const tot=totalDe(t), tope=TOPES[EQ.medidor];
    const partes = (t.reparto&&t.reparto.length>1) ? t.reparto : [null];
    return partes.map((p,j)=>{ const f=(data.filas||[])[k++]||{};
      const r0=t.reparto&&t.reparto[0]?t.reparto[0]:{cc:t.cc};
      const etq=r=> r.item ? (r.act||actLabel(r.item))+' · '+(r.cc||'') : r.libre ? (r.cc?'otra actividad · '+r.cc:'otra actividad · sin CC (lo pone revisión)') : ccTexto(r.cc);
      const cc = p ? etq(p)+' · '+fmt(num(p.pct)||0)+' %'+(tot!==null&&tope?' = '+fmt(tot*(num(p.pct)||0)/100)+' '+tope.unidad:'') : etq(r0);
      return '<div class="r-row"><b>'+(p?'Parte '+(j+1)+' de '+partes.length:esc(EQ.codigo))+'</b><br>'+esc(cc)+(!p&&EQ.medidor?'<br>'+esc(t.inicial)+' → '+esc(t.final)+' = <b>'+(tot===null?'—':fmt(tot))+' '+(tope?esc(tope.unidad):'')+'</b>':'')+(t.desc?'<br><i>'+esc(t.desc)+'</i>':'')
        +((f.alertas&&f.alertas.length)?'<br><span data-estilo="color:var(--accent-txt)">Para revisión: '+esc(f.alertas.join(', '))+'</span>':'')+'</div>'; }).join(''); }).join('');
  const nFilas=(data.guardadas||0)+(data.duplicadas||0);
  document.getElementById('okMsg').innerHTML='<b>'+esc(EQ.codigo)+'</b> · '+esc(fecha)+' · parte nº '+esc(reporte)+' · '+esc(operador)+'<br>'
    +(encolado
      ? '<span data-estilo="color:var(--accent-txt)">Sin señal: el parte quedó <b>guardado en este teléfono</b> y subirá solo cuando vuelva la señal (también al abrir cualquier pantalla de la app). No borres los datos del navegador mientras haya pendientes.</span>'
      : nFilas+' fila(s) registrada(s) como <b>pendiente</b> de revisión.')
    +(DEMO?'<br><span data-estilo="color:var(--accent-txt)">Modo de prueba: no se guardó nada.</span>':'')
    +(alertas.length?'<br><span data-estilo="color:var(--accent-txt)">Quedó marcado para que maquinaria lo mire ('+esc([...new Set(alertas)].join(', '))+'). No tienes que hacer nada más.</span>':'');
  // el último final ahora es el del último tramo enviado
  const ultT=tramos[tramos.length-1]; if(EQ.medidor && num(ultT.final)!==null) ULTIMO={ final:num(ultT.final), fecha:fecha, hora_a:ultT.hora_a, origen:encolado?'telefono':'bandeja' };
  mostrar('pantallaOk'); window.scrollTo(0,0);
}
function otroTramo(){
  // mismo parte físico, mismo operador, mismo día: un tramo nuevo que arranca donde terminó el anterior
  const u=ultimoEnvio, prev=u?u.tramos[u.tramos.length-1]:null;
  tramos=[]; intento=false;
  tramos=[nuevoTramo({ inicial: ULTIMO?ULTIMO.final:'', hora_de: prev?prev.hora_a:HORA_DE_DEF, hora_a: prev?'':HORA_A_DEF, pr: prev?prev.pr:'', iniPre: ULTIMO?ULTIMO.final:'' })];
  if(u){ document.getElementById('fecha').value=u.fecha; document.getElementById('reporteNum').value=u.reporte; }
  render(); mostrar('formMain'); window.scrollTo(0,0);
}
function nuevoParte(){
  tramos=[]; intento=false; document.getElementById('reporteNum').value=''; document.getElementById('fecha').value=HOY;
  addTramo(); mostrar('formMain'); window.scrollTo(0,0);
}

cargar();

// D170: antes eran expresiones en línea en el marcado; la CSP ya no las admite.
function cerrarSinOperacionFondo(ev, el){ if(ev.target===el) cerrarSinOperacion(); }
function verMasSugs(btn, id){ btn.parentNode.dataset.todo=1; pintarSugs(id); }
function elegirTecleado(){ elegir(document.getElementById('pickerBuscar').value.trim()); }
// (D178) `usarActPicker`/picker de CC retirados: la actividad se elige con los chips de cada fila o con «Otra…».
