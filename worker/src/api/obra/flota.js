/**
 * api/obra/flota.js — flota de maquinaria (catálogo VIVO) de OBRA portada al Worker (4.01 · Fase 4 · D180).
 *
 * Es el bloque de backend/Codigo.gs L1722–L2155 (D138 / D139 / D173 / D111 / D10) función por función,
 * con los MISMOS nombres y el MISMO contrato, pero contra la tabla `maquinas` (+ `parte_equipos`,
 * `maquinaria`) en vez de las hojas MAQUINAS / PARTE_EQUIPOS / MAQUINARIA:
 *
 *   GET  ?action=maquinas&fecha=      TOKEN → maquinasCatalogo: flota VIGENTE del día (solo producción,
 *                                             frente UF1-UF2) + equipos del capataz (D171)
 *   GET  ?action=flota&fecha=         TOKEN → flotaLeer: TODAS las estancias (historial) con avisos, tipos,
 *                                             frentes, fichas del Parte y nº de ids en el histórico
 *   POST {action:'flota_guardar', op} TOKEN → flotaGuardar: alta | baja | corregir (D139)
 *
 * Qué cambia respecto al .gs y por qué:
 *   · Los catálogos y helpers de lectura de la hoja MAQUINAS viven en src/catalogos.js con los mismos
 *     nombres (flotaFilas_ = getFlotaRows_, flotaEnFecha_, _flotaFilasNorm_, _flotaTraslapa_,
 *     idsMaquinariaHistorico_, fichasParte_, normMaqId/normMaqClave_/normFrente_/progPorPropiedad_,
 *     MAQ_TIPOS_x / FLOTA_FRENTES / FLOTA_INFINITO): OBRA y el Parte los comparten. Aquí solo se importan.
 *   · Los memos de ejecución (`_flotaRows`, `_idsMaquinaria`, `_fichasParte`) pasan a `c.memo` (una
 *     consulta por tabla y petición). Tras escribir, flotaGuardar y fichaParteAsegurar_ llaman
 *     invalidarMemo_(c, ['maquinas','equipos','ids_maquinaria']) (decisión 10) y flotaPayload_ relee.
 *   · Escritura: UNA transacción por op (`sql.begin`, sin lock; decisión 10). alta = INSERT; baja =
 *     UPDATE fecha_retiro por (id_maquina, fecha_ingreso); corregir = UPDATE de la fila entera hallada
 *     por la clave (incluidas las columnas de la PK, porque corregir puede cambiar id o fecha_ingreso).
 *     Las comprobaciones (dup, traslape, guard de typos) se hacen en JS sobre _flotaFilasNorm_(c) —igual
 *     que el .gs sobre el memo—, conservando los mensajes de error literales.
 *   · La identidad de la estancia sigue siendo (id_maquina, fecha_ingreso), NUNCA el número de fila. Los
 *     avisos que en el .gs citaban «Fila N» citan ahora la estancia (id + fecha_ingreso): ninguna pantalla
 *     los parsea. El campo `fila` de cada estancia (ordinal estable de flotaFilas_) se conserva porque
 *     produccion-maquinaria.js lo muestra.
 *   · fichaParteAsegurar_ (D173) → INSERT … ON CONFLICT (obra_id, codigo) DO NOTHING (ficha nueva) o
 *     UPDATE que completa SOLO placa/proveedor/medidor vacíos y pone activo='SI' si estaba en 'NO'; con
 *     try/catch: si falla, la estancia igual queda guardada y se avisa en `mensaje`.
 *   · El CHECK de la tabla (fecha_retiro >= fecha_ingreso) coincide con la regla ret<=ing → error, que se
 *     valida antes en JS para devolver el mensaje literal; el aviso «retiro anterior al ingreso» de
 *     flotaEnFecha_/flotaEstancias_ deja de poder ocurrir en datos ya guardados, pero se conserva por si
 *     la tabla trae filas antiguas.
 *
 * El guard de rol/usuario (D109) usa permiso_ de comun.js con la sesión de puerta_ (no `body._rol`).
 * FLOTA_ROLES_ESCRIBEN / FLOTA_USUARIOS_ESCRIBEN se cablean aquí igual que en el .gs (decisión 12).
 *
 * Contexto `c` = { sql, env, secreto, authV, pet:{t0, log}, memo }. Lo arma src/index.js por petición.
 */
import { OBRA_ID, json, fdate, fdateValida_, hoyBogota, permiso_, logMarcar_ } from '../../comun.js';
import {
  flotaEnFecha_, flotaFilas_, equiposCapataz_, esTipoSinProduccion,
  normMaqId, normMaqClave_, normFrente_, normGrupo_, progPorPropiedad_,
  MAQ_ORDEN_TIPO, MAQ_TIPOS_FLOTA, MAQ_TIPOS_PRODUCCION,
  FLOTA_FRENTES, FLOTA_FRENTE_DEFECTO, PARTE_FRENTES, FLOTA_GRUPOS, FLOTA_GRUPO_DEFECTO,
  _flotaFilasNorm_, _flotaTraslapa_, idsMaquinariaHistorico_, fichasParte_, invalidarMemo_
} from '../../catalogos.js';

/* ---------- Codigo.gs L1772–L1774: quién ESCRIBE la flota (guard en el SERVIDOR, D109) ----------
 * Cableado, como en el .gs (decisión 12). `jeisson` (asistencia_plus) es el único usuario suelto. */
const FLOTA_ROLES_ESCRIBEN    = ['admin','residente'];
const FLOTA_USUARIOS_ESCRIBEN = ['jeisson'];
/* D205: el residente de drenajes y `duvan` administran la flota de SU grupo. Escriben (alta · baja ·
 * corregir) SOLO estancias con grupo `drenajes`: el alta y la corrección tienen que quedar en drenajes y
 * la baja/corrección solo toca una estancia que ya era de drenajes. Leen toda la flota, como todos. */
const FLOTA_ROLES_DRENAJES    = ['residente_dren'];
const FLOTA_USUARIOS_DRENAJES = ['duvan'];
const FLOTA_GRUPO_ACOTADO     = 'drenajes';

/* ---------- Codigo.gs L1957–L1961: mensajes literales de fecha (D106) ---------- */
const ERROR_FECHA_INGRESO = 'La fecha de ingreso llegó vacía o con un formato que no se entiende. '
  + 'Elige el día y vuelve a guardar. No se escribió nada a propósito (D106): una estancia sin fecha '
  + 'de ingreso no está vigente ningún día y la máquina desaparecería de las capturas.';
const ERROR_FECHA_RETIRO = 'La fecha de retiro llegó con un formato que no se entiende. '
  + 'Déjala vacía si la máquina sigue en obra, o elige el PRIMER DÍA QUE YA NO ESTUVO. No se escribió nada.';

// Codigo.gs L1950–L1952 — puedeEscribirFlota_ (permiso_ sobre la sesión del token, no sobre `body._rol`).
export function puedeEscribirFlota_(ses){
  const p=permiso_(ses, FLOTA_ROLES_ESCRIBEN, FLOTA_USUARIOS_ESCRIBEN, 'dar de alta ni de baja máquinas');
  if(p.ok) return p;
  // D205: permiso ACOTADO al grupo drenajes (el guard por estancia lo hace flotaGuardar con `soloGrupo`).
  const d=permiso_(ses, FLOTA_ROLES_DRENAJES, FLOTA_USUARIOS_DRENAJES, 'dar de alta ni de baja máquinas');
  if(d.ok) return { ok:true, soloGrupo:FLOTA_GRUPO_ACOTADO };
  return p;
}
function _errGrupo_(id){
  return 'Tu usuario solo administra la flota de DRENAJES'+(id?(' y «'+id+'» no es de ese grupo'):'')+'. '
    + 'Las máquinas de tierras las cambia el residente de tierras, jeisson o el administrador. No se guardó nada.';
}

/* ---------- Codigo.gs L1722–L1734: `?action=maquinas&fecha=` — flota VIGENTE del día (SOLO LECTURA) ----------
 * Sin `fecha` responde con la flota de HOY (flotaEnFecha_ lo resuelve). `equipos` = PARTE_EQUIPOS activos
 * (D171), la lista que usa el reporte del capataz. */
export async function maquinasCatalogo(c, params){
  const fl=await flotaEnFecha_(c, (params && params.fecha) || '');
  const maquinas=Object.keys(fl.catalogo).map(function(id){
    const x=fl.catalogo[id];
    return { id_maquina:id, tipo:x.tipo, prog:x.prog, propiedad:x.propiedad, notas:x.notas,
             produce: !esTipoSinProduccion(x.tipo), esperada: fl.esperadas.indexOf(id)>=0 };
  }).sort(function(a,b){
    const ta=MAQ_ORDEN_TIPO.indexOf(a.tipo), tb=MAQ_ORDEN_TIPO.indexOf(b.tipo);
    return ((ta<0?99:ta)-(tb<0?99:tb)) || (a.id_maquina<b.id_maquina?-1:a.id_maquina>b.id_maquina?1:0);
  });
  return json(c, { ok:true, fecha:fl.fecha, fuente:fl.fuente, maquinas:maquinas,
                   equipos:await equiposCapataz_(c, fl.fecha), avisos:fl.avisos });
}

/* ---------- Codigo.gs L1812–L1829: flotaSugerencia_ — ¿este ID ya se conoce, y si no, a qué se parece? ----------
 * `conocido` = aparece en el histórico de MAQUINARIA, o ya está en `maquinas`, o tiene ficha en
 * PARTE_EQUIPOS (un reingreso no debe preguntar nada, D173). `sugerencia` = otro ID que colapsa al mismo
 * normalizado (el typo típico de D111: RT02 / RT-02). */
export async function flotaSugerencia_(c, id){
  const objetivo=normMaqId(id), clave=normMaqClave_(objetivo);
  if(!clave) return { conocido:false, sugerencia:'' };
  const hist=await idsMaquinariaHistorico_(c);
  if(hist.ids[objetivo]) return { conocido:true, sugerencia:'' };
  const rows=await flotaFilas_(c);
  if(rows.filter(function(r){ return normMaqId(r.id)===objetivo; }).length) return { conocido:true, sugerencia:'' };
  const fichas=await fichasParte_(c);
  if(fichas[normMaqClave_(objetivo)]) return { conocido:true, sugerencia:'' };
  const cand=(hist.porClave[clave]||[]).slice();
  rows.forEach(function(r){
    const x=normMaqId(r.id);
    if(x && x!==objetivo && normMaqClave_(x)===clave && cand.indexOf(x)<0) cand.push(x);
  });
  return { conocido:false, sugerencia: cand.length ? cand[0] : '' };
}

// Cita una estancia en los avisos por su identidad (id + fecha_ingreso), en vez del «Fila N» de la hoja
// (misma decisión que flotaEnFecha_ en catalogos.js: ninguna pantalla los parsea).
function _est_(r){ return 'Estancia '+normMaqId(r.id)+(r.ing?(' desde '+r.ing):''); }

/* ---------- Codigo.gs L1866–L1917: flotaEstancias_ — TODAS las estancias (historial) + avisos ----------
 * La pestaña Flota muestra el historial completo, no solo lo vigente. Los avisos son la mitad del valor
 * de la pantalla (D139). `_flotaFilasNorm_`, `fichasParte_` e `idsMaquinariaHistorico_` de catalogos.js. */
export async function flotaEstancias_(c, fecha){
  const f=fdateValida_(fecha) || hoyBogota();
  const filas=await _flotaFilasNorm_(c);
  const fichas=await fichasParte_(c);
  const hist=await idsMaquinariaHistorico_(c);
  const avisos=[], porMaquina={}, porClave={};
  const estancias=filas.map(function(r){
    if(!r.ing) avisos.push(_est_(r)+': sin fecha_ingreso válida (yyyy-mm-dd); esa estancia se ignora.');
    if(r.retCrudo && !r.ret) avisos.push(_est_(r)+': fecha_retiro "'+r.retCrudo+'" no se entiende; se toma como si siguiera en obra.');
    if(r.ing && r.ret && r.ret<r.ing) avisos.push(_est_(r)+': fecha_retiro anterior al ingreso; esa estancia nunca está vigente.');
    if(!r.tipo) avisos.push(_est_(r)+': sin tipo; no lleva producción y solo sale en la flota del parte.');
    else if(MAQ_TIPOS_FLOTA.indexOf(r.tipo)<0) avisos.push(_est_(r)+': tipo "'+r.tipo+'" no está en la lista conocida; no lleva producción y solo sale en la flota del parte.');
    if(FLOTA_FRENTES.indexOf(r.frente)<0) avisos.push(_est_(r)+': frente "'+r.frenteCrudo+'" no se reconoce ('+FLOTA_FRENTES.join(' · ')+'); ese equipo no lo espera ningún parte.');
    if(FLOTA_GRUPOS.indexOf(r.grupo)<0) avisos.push(_est_(r)+': grupo "'+r.grupoCrudo+'" no se reconoce ('+FLOTA_GRUPOS.join(' · ')+'); corrígelo a tierras o drenajes.');
    const ficha=fichas[normMaqClave_(r.id)]||null;
    const progHoja=parseFloat(r.prog);
    const e={ id_maquina:r.id, tipo:r.tipo, propiedad:r.propiedad, notas:r.nota, fila:r.fila,
              frente:r.frente, grupo:r.grupo, produce_tipo: MAQ_TIPOS_PRODUCCION.indexOf(r.tipo)>=0,
              placa:ficha?ficha.placa:'', proveedor:ficha?ficha.proveedor:'', medidor:ficha?ficha.medidor:'', con_ficha:!!ficha,
              horas_prog:(isNaN(progHoja)||progHoja<=0) ? '' : progHoja,
              prog:(isNaN(progHoja)||progHoja<=0) ? progPorPropiedad_(r.propiedad) : progHoja,
              fecha_ingreso:r.ing, fecha_retiro:r.ret, valida:!!r.ing,
              produce: !esTipoSinProduccion(r.tipo),
              vigente: !!(r.ing && r.ing<=f && (!r.ret || f<r.ret)) };
    (porMaquina[r.id]=porMaquina[r.id]||[]).push(e);
    const k=normMaqClave_(r.id); if(k){ const l=(porClave[k]=porClave[k]||[]); if(l.indexOf(r.id)<0) l.push(r.id); }
    return e;
  });
  // Estancias de la misma máquina que se pisan.
  Object.keys(porMaquina).forEach(function(id){
    const ls=porMaquina[id].filter(function(x){ return x.valida; });
    for(let i=0;i<ls.length;i++) for(let j=i+1;j<ls.length;j++){
      if(_flotaTraslapa_({ing:ls[i].fecha_ingreso, ret:ls[i].fecha_retiro}, {ing:ls[j].fecha_ingreso, ret:ls[j].fecha_retiro}))
        avisos.push('Estancias de '+id+' que se pisan ('+ls[i].fecha_ingreso+' y '+ls[j].fecha_ingreso+'): '
          + 'una máquina no puede estar dos veces en obra el mismo día.');
    }
  });
  // Dos IDs distintos que colapsan al mismo normalizado: casi siempre el typo de D111 (RT02/RT-02).
  Object.keys(porClave).forEach(function(k){
    if(porClave[k].length>1)
      avisos.push('«'+porClave[k].join('» y «')+'» se escriben distinto pero son el mismo código. '
        + 'Solo UNO puede coincidir con dim_maquinaria del maestro (D111): revisa cuál.');
  });
  // Un ID de la tabla que no está en el histórico de MAQUINARIA y se parece a uno que sí.
  Object.keys(porMaquina).forEach(function(id){
    if(hist.ids[id]) return;
    const cand=(hist.porClave[normMaqClave_(id)]||[]).filter(function(x){ return x!==id; });
    if(cand.length) avisos.push('«'+id+'» no aparece en el histórico de MAQUINARIA, pero «'+cand[0]+'» sí. '
      + 'Si son la misma máquina, el que cruza con el maestro es «'+cand[0]+'».');
  });
  return { fecha:f, estancias:estancias, avisos:avisos, filas_utiles:filas.filter(function(r){ return !!r.ing; }).length };
}

/* ---------- Codigo.gs L1921–L1929: flotaPayload_ — cuerpo de la respuesta de lectura ----------
 * Se reusa tras escribir para devolver la tabla YA actualizada en la MISMA petición (prueba de que los
 * memos quedaron invalidados). Devuelve un objeto PLANO (flotaLeer/flotaGuardar lo envuelven con json). */
export async function flotaPayload_(c, fecha){
  const fl=await flotaEstancias_(c, fecha);
  return { ok:true, fecha:fl.fecha, estancias:fl.estancias, avisos:fl.avisos,
           fuente: fl.filas_utiles ? 'hoja' : 'vacia',
           tipos:MAQ_TIPOS_FLOTA, tipos_produccion:MAQ_TIPOS_PRODUCCION, orden_tipo:MAQ_ORDEN_TIPO,
           frentes:FLOTA_FRENTES, frente_defecto:FLOTA_FRENTE_DEFECTO,
           frentes_parte:PARTE_FRENTES,
           grupos:FLOTA_GRUPOS, grupo_defecto:FLOTA_GRUPO_DEFECTO,
           historico_maquinaria: (await idsMaquinariaHistorico_(c)).n };
}

/* ---------- Codigo.gs L1933–L1936: `?action=flota&fecha=` — historial completo (SOLO LECTURA) ---------- */
export async function flotaLeer(c, params){
  return json(c, await flotaPayload_(c, (params && params.fecha) || ''));
}

/* ---------- Codigo.gs L2120–L2155: fichaParteAsegurar_ (D173) — asegura la FICHA en PARTE_EQUIPOS ----------
 * Sin ficha → fila nueva (codigo · tipo · placa · proveedor · medidor · activo='SI'). Con ficha → completa
 * SOLO los campos vacíos que lleguen con valor (placa/proveedor/medidor); nunca pisa lo escrito ni toca el
 * último medidor; `activo` pasa a 'SI' si estaba en 'NO'. Devuelve un texto corto para el mensaje ('' si no
 * hizo nada). Con try/catch: si falla, la estancia igual queda guardada (la flota no depende del Parte). */
export async function fichaParteAsegurar_(c, id, tipo, ficha){
  try{
    const clave=normMaqClave_(id);
    const filasEq=await c.sql`SELECT codigo, placa, proveedor, medidor, activo FROM parte_equipos WHERE obra_id=${OBRA_ID}`;
    const r=filasEq.filter(function(x){ return normMaqClave_(x.codigo)===clave; })[0] || null;
    const cambios=[];
    if(!r){
      await c.sql`INSERT INTO parte_equipos (obra_id, codigo, tipo, placa, proveedor, medidor, activo)
        VALUES (${OBRA_ID}, ${id}, ${tipo||''}, ${ficha.placa||''}, ${ficha.proveedor||''}, ${ficha.medidor||''}, 'SI')
        ON CONFLICT (obra_id, codigo) DO NOTHING`;
      cambios.push('ficha nueva en PARTE_EQUIPOS'+(ficha.medidor?'':' (sin medidor: completa HOROMETRO o KM para que el parte no avise SIN_MEDIDOR)'));
    }else{
      const vacio=function(v){ return String(v==null?'':v).trim()===''; };
      let placa=String(r.placa==null?'':r.placa), proveedor=String(r.proveedor==null?'':r.proveedor), medidor=String(r.medidor==null?'':r.medidor);
      let activo=String(r.activo==null?'':r.activo);
      if(ficha.placa && vacio(placa)){ placa=ficha.placa; cambios.push('placa'); }
      if(ficha.proveedor && vacio(proveedor)){ proveedor=ficha.proveedor; cambios.push('proveedor'); }
      if(ficha.medidor && vacio(medidor)){ medidor=ficha.medidor; cambios.push('medidor'); }
      if(activo.trim().toUpperCase()==='NO'){ activo='SI'; cambios.push('activo=SI'); }
      if(cambios.length)
        await c.sql`UPDATE parte_equipos SET placa=${placa}, proveedor=${proveedor}, medidor=${medidor}, activo=${activo}
          WHERE obra_id=${OBRA_ID} AND codigo=${r.codigo}`;
    }
    if(cambios.length) invalidarMemo_(c, ['maquinas','equipos','ids_maquinaria']);   // decisión 10
    return cambios.length ? ('Ficha: '+cambios.join(', ')+'.') : '';
  }catch(err){ return 'No se pudo tocar la ficha en PARTE_EQUIPOS ('+String(err&&err.message||err)+'); la estancia sí quedó guardada.'; }
}

/* ---------- Codigo.gs L1973–L2111: flotaGuardar — alta | baja | corregir (ESCRIBE `maquinas`) ---------- */
export async function flotaGuardar(c, body, ses){
  const permiso=puedeEscribirFlota_(ses);
  if(!permiso.ok){ logMarcar_(c, 'rechazado', 'flota: '+permiso.error); return json(c, { ok:false, error:permiso.error }); }

  const op=String(body.op||'').trim().toLowerCase();
  if(['alta','baja','corregir'].indexOf(op)<0)
    return json(c, { ok:false, error:'Operación de flota no reconocida: "'+op+'". Se esperaba alta, baja o corregir.' });

  const filas=await _flotaFilasNorm_(c);   // estado actual (memo 'maquinas'), como el .gs sobre getFlotaRows_

  // Cierre común: invalida los memos (decisión 10) y relee la tabla YA actualizada en la misma petición.
  async function fin(extra){
    invalidarMemo_(c, ['maquinas','equipos','ids_maquinaria']);
    const out=await flotaPayload_(c, body.fecha||'');
    Object.keys(extra||{}).forEach(function(k){ out[k]=extra[k]; });
    return json(c, out);
  }

  /* ---------- baja: cerrar la estancia abierta ---------- */
  if(op==='baja'){
    const cl=body.clave||{};
    const id=normMaqId(cl.id_maquina), ing=fdateValida_(cl.fecha_ingreso);
    if(!id || !ing) return json(c, { ok:false, error:'No llegó la estancia que se quiere cerrar (máquina + fecha de ingreso).' });
    const ret=fdateValida_(body.fecha_retiro);
    if(!ret) return json(c, { ok:false, error:ERROR_FECHA_RETIRO });
    const halladas=filas.filter(function(r){ return r.id===id && r.ing===ing; });
    if(!halladas.length) return json(c, { ok:false, error:'No se encontró la estancia de '+id+' con ingreso '+ing+'. '
      + 'Puede que alguien la haya cambiado mientras tanto: vuelve a cargar la pantalla.' });
    if(halladas.length>1) return json(c, { ok:false, error:'Hay '+halladas.length+' estancias de '+id+' con el mismo ingreso '+ing
      + '. Arregla los datos antes: la estancia se identifica por máquina + fecha de ingreso.' });
    const est=halladas[0];
    if(permiso.soloGrupo && normGrupo_(est.grupo)!==permiso.soloGrupo){ logMarcar_(c, 'rechazado', 'flota: grupo'); return json(c, { ok:false, error:_errGrupo_(id) }); }
    if(est.ret) return json(c, { ok:false, error:'Esa estancia de '+id+' ya está cerrada el '+est.ret+'. '
      + 'Si la fecha está mal, usa "Corregir"; si la máquina volvió a la obra, va un ALTA nueva (nunca editar la vieja: se perdería el hueco en que no estuvo).' });
    if(ret<=ing) return json(c, { ok:false, error:'La fecha de retiro ('+ret+') tiene que ser POSTERIOR al ingreso ('+ing+'). '
      + 'Recuerda que el retiro es el PRIMER DÍA QUE YA NO ESTUVO, no el último que trabajó.' });
    const choque=filas.filter(function(r){ return r.id===id && r.ing!==ing && r.ing; })
                      .filter(function(r){ return _flotaTraslapa_(r, {ing:ing, ret:ret}); });
    if(choque.length) return json(c, { ok:false, error:'Con ese retiro la estancia se pisaría con otra de '+id
      + ' ('+choque[0].ing+' → '+(choque[0].ret||'sigue en obra')+').' });
    await c.sql.begin(async function(sql){
      await sql`UPDATE maquinas SET fecha_retiro=${ret} WHERE obra_id=${OBRA_ID} AND id_maquina=${id} AND fecha_ingreso=${ing}`;
    });
    return fin({ op:'baja', id_maquina:id, fecha_ingreso:ing, fecha_retiro:ret,
                 mensaje:id+' queda fuera de la obra desde el '+ret+' (ese día ya no estuvo). Los reportes anteriores no se tocan.' });
  }

  /* ---------- alta / corregir: datos completos de la estancia ---------- */
  const id=normMaqId(body.id_maquina);
  if(!id) return json(c, { ok:false, error:'Falta el código de la máquina (id_maquina).' });
  const ing=fdateValida_(body.fecha_ingreso);
  if(!ing) return json(c, { ok:false, error:ERROR_FECHA_INGRESO });
  const retTxt=String(body.fecha_retiro==null?'':body.fecha_retiro).trim();
  const ret=retTxt ? fdateValida_(retTxt) : '';
  if(retTxt && !ret) return json(c, { ok:false, error:ERROR_FECHA_RETIRO });
  if(ret && ret<=ing) return json(c, { ok:false, error:'La fecha de retiro ('+ret+') tiene que ser POSTERIOR al ingreso ('+ing+'). '
    + 'La ventana es semiabierta: el retiro es el primer día que la máquina YA NO estuvo.' });
  const tipo=String(body.tipo||'').toUpperCase().replace(/\s+/g,' ').trim();
  if(!tipo) return json(c, { ok:false, error:'Falta el tipo de equipo. Elige uno de la lista ('+MAQ_TIPOS_FLOTA.join(' · ')+') o escribe uno nuevo.' });
  const tipoAviso = (MAQ_TIPOS_FLOTA.indexOf(tipo)<0)
    ? ('El tipo «'+tipo+'» no está en la lista conocida: se guardó igual, sin regla de producción (solo flota y parte).') : '';
  const frente=normFrente_(body.frente);
  if(FLOTA_FRENTES.indexOf(frente)<0) return json(c, { ok:false, error:'El frente "'+(body.frente||'')+'" no se reconoce. Opciones: '+FLOTA_FRENTES.join(' · ')+'.' });
  const grupo=normGrupo_(body.grupo);   // D190: disciplina (tierras/drenajes), ortogonal al frente
  if(FLOTA_GRUPOS.indexOf(grupo)<0) return json(c, { ok:false, error:'El grupo "'+(body.grupo||'')+'" no se reconoce. Opciones: '+FLOTA_GRUPOS.join(' · ')+'.' });
  if(permiso.soloGrupo && grupo!==permiso.soloGrupo){ logMarcar_(c, 'rechazado', 'flota: grupo'); return json(c, { ok:false, error:_errGrupo_('') }); }
  const ficha={ placa:String(body.placa==null?'':body.placa).trim().toUpperCase(),
                proveedor:String(body.proveedor==null?'':body.proveedor).trim(),
                medidor:String(body.medidor==null?'':body.medidor).trim().toUpperCase() };
  if(ficha.medidor && ficha.medidor!=='HOROMETRO' && ficha.medidor!=='KM')
    return json(c, { ok:false, error:'El medidor tiene que ser HOROMETRO o KM (o quedar vacío si aún no se sabe).' });
  const propiedad=String(body.propiedad||'').trim().toLowerCase();
  if(propiedad!=='propia' && propiedad!=='alquilada')
    return json(c, { ok:false, error:'La propiedad tiene que ser "propia" o "alquilada": de ahí salen las horas programadas (6.4 / 5, D10).' });
  const progTxt=String(body.horas_prog==null?'':body.horas_prog).trim();
  let prog='';
  if(progTxt!==''){
    const p=parseFloat(progTxt);
    if(isNaN(p) || p<=0 || p>24) return json(c, { ok:false, error:'Las horas programadas tienen que ser un número entre 0 y 24, o quedar vacías para deducirlas de la propiedad (5 h alquilada / 6.4 h propia, D10).' });
    prog=p;
  }
  const notas=String(body.notas==null?'':body.notas).trim();

  // Estancia que se corrige (si es el caso): se identifica por la clave y se excluye de sus propios choques.
  let cid='', cing='', original=null;
  if(op==='corregir'){
    const cl=body.clave||{};
    cid=normMaqId(cl.id_maquina); cing=fdateValida_(cl.fecha_ingreso);
    if(!cid || !cing) return json(c, { ok:false, error:'No llegó la estancia que se quiere corregir (máquina + fecha de ingreso).' });
    const halladas=filas.filter(function(r){ return r.id===cid && r.ing===cing; });
    if(!halladas.length) return json(c, { ok:false, error:'No se encontró la estancia de '+cid+' con ingreso '+cing+'. '
      + 'Puede que alguien la haya cambiado mientras tanto: vuelve a cargar la pantalla.' });
    if(halladas.length>1) return json(c, { ok:false, error:'Hay '+halladas.length+' estancias de '+cid+' con el mismo ingreso '+cing
      + '. Arregla los datos antes: la estancia se identifica por máquina + fecha de ingreso.' });
    original=halladas[0];
    if(permiso.soloGrupo && normGrupo_(original.grupo)!==permiso.soloGrupo){ logMarcar_(c, 'rechazado', 'flota: grupo'); return json(c, { ok:false, error:_errGrupo_(cid) }); }
  }
  // ¿La fila que estamos tocando? (para excluirla de dup/choque): la misma (id, ing) de la clave a corregir.
  const esOriginal=function(r){ return !!original && r.id===cid && r.ing===cing; };

  // Clave duplicada: dos estancias de la misma máquina con el mismo ingreso.
  const dup=filas.filter(function(r){ return r.id===id && r.ing===ing && !esOriginal(r); });
  if(dup.length) return json(c, { ok:false, error:'Ya existe una estancia de '+id+' que empieza el '+ing+'. '
    + 'Si la máquina volvió después, el alta va con la fecha del REINGRESO; si esa estancia está mal, corrígela.' });

  // Traslape con otra estancia de la misma máquina.
  const choque=filas.filter(function(r){ return r.id===id && !esOriginal(r) && r.ing; })
                    .filter(function(r){ return _flotaTraslapa_(r, {ing:ing, ret:ret}); });
  if(choque.length) return json(c, { ok:false, error:id+' ya está en obra en ese rango ('
    + choque[0].ing+' → '+(choque[0].ret||'sigue en obra')+'). Cierra esa estancia antes de abrir otra.' });

  // EL GUARD DE TYPOS (D111): no escribe, pregunta.
  if(!body.confirmado){
    const s=await flotaSugerencia_(c, id);
    if(!s.conocido){
      const msg = s.sugerencia
        ? ('«'+id+'» no aparece en el histórico de MAQUINARIA. El parecido más cercano es «'+s.sugerencia+'». ¿Es una máquina nueva de verdad?')
        : ('«'+id+'» no aparece en el histórico de MAQUINARIA ni en la flota. El código tiene que coincidir letra por letra con dim_maquinaria del maestro (D111) o el pegado a Captura_Diaria deja de cruzar en silencio. ¿Es una máquina nueva de verdad?');
      return json(c, { ok:false, confirmar:true, id_maquina:id, sugerencia:s.sugerencia, error:msg });
    }
  }

  // D173: la FICHA (placa · proveedor · medidor) vive en PARTE_EQUIPOS. El alta/corregir la asegura ANTES
  // de escribir la estancia (mismo orden que el .gs); si falla, la estancia igual se guarda y se avisa.
  const fichaMsg=await fichaParteAsegurar_(c, id, tipo, ficha);
  const extra = (tipoAviso ? ' '+tipoAviso : '') + (fichaMsg ? ' '+fichaMsg : '');

  try{
    await c.sql.begin(async function(sql){
      if(op==='corregir'){
        // Puede cambiar id_maquina o fecha_ingreso (columnas de la PK): se actualizan en la transacción.
        await sql`UPDATE maquinas SET id_maquina=${id}, tipo=${tipo}, horas_prog=${prog===''?null:prog}, propiedad=${propiedad},
          fecha_ingreso=${ing}, fecha_retiro=${ret||null}, notas=${notas}, frente=${frente}, grupo=${grupo}
          WHERE obra_id=${OBRA_ID} AND id_maquina=${cid} AND fecha_ingreso=${cing}`;
      }else{
        await sql`INSERT INTO maquinas (obra_id, id_maquina, tipo, horas_prog, propiedad, fecha_ingreso, fecha_retiro, notas, frente, grupo)
          VALUES (${OBRA_ID}, ${id}, ${tipo}, ${prog===''?null:prog}, ${propiedad}, ${ing}, ${ret||null}, ${notas}, ${frente}, ${grupo})`;
      }
    });
  }catch(err){
    // D190: si la columna `grupo` aún no existe (Worker desplegado antes de aplicar la migración 009),
    // el INSERT/UPDATE con `grupo` falla (42703). Mensaje claro en vez de un 500 opaco. La ficha del Parte
    // ya quedó asegurada (fichaParteAsegurar_ arriba); no es huérfana dañina (equivale a un equipo con ficha
    // sin estancia) y se adopta sola al reintentar el alta tras aplicar 009.
    const m=String(err&&err.message||err);
    if(err&&err.code==='42703' && /grupo/i.test(m))
      return json(c, { ok:false, error:'Falta aplicar la migración 009_grupo_flota.sql en la base de datos (columna «grupo» de la flota). Avisa a soporte; la estancia no se guardó.' });
    throw err;
  }

  if(op==='corregir')
    return fin({ op:'corregir', id_maquina:id, fecha_ingreso:ing, mensaje:'Estancia de '+id+' corregida.'+extra });
  return fin({ op:'alta', id_maquina:id, fecha_ingreso:ing,
               mensaje:id+' entra a la obra desde el '+ing+(ret?(' y sale el '+ret):'')+'.'+extra });
}
