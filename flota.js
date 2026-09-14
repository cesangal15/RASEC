/**
 * TM2 Sur — Catálogo de máquinas VIVO en el cliente (D138, backlog 2.28)
 *
 * Las máquinas entran y salen de la obra continuamente (alquilar y tener parado es caro: el finisher
 * FNG02 y el vibro CR08 solo se traen cuando hay BTC que hacer). Hasta D138 la lista vivía escrita a
 * mano en cuatro pantallas + `Codigo.gs`, así que cada alta o baja era una edición de código y un
 * redespliegue. Ahora la sirve `?action=maquinas&fecha=` desde la hoja MAQUINAS, y este archivo es el
 * pedazo compartido que las cuatro pantallas usan para pedirla — el mismo movimiento que D112 hizo
 * con `horas-nomina.js`: una sola copia, para que no puedan divergir.
 *
 * LO QUE RESUELVE DE VERDAD, Y POR QUÉ NO ES UN `fetch` A SECAS: `reporte-capataz.html` y
 * `reporte-chequeadora.html` FUNCIONAN SIN SEÑAL (D82). Si la lista de máquinas dependiera de la red,
 * el capataz en zona muerta se quedaría sin poder reportar equipos — justo lo que la cola offline
 * existe para evitar. Por eso hay tres niveles, en este orden:
 *
 *   1. SERVIDOR  — la flota vigente ese día (y se guarda copia local).
 *   2. CACHÉ     — lo último que vio ESTE teléfono. Es lo que se usa sin señal.
 *   3. RESPALDO  — la lista que la pantalla lleva escrita, por si nunca hubo señal en este equipo.
 *
 * La caché NO se reinventa aquí: se reusa `TM2Offline.catalogoCache`, el mismo mecanismo con el que
 * la chequeadora guarda el cubicaje (D82 §2.7). Donde no hay `offline.js` cargado —los paneles de
 * encargado y estado, que son online-only por D49— cae solo al fetch, que es lo correcto: esas
 * pantallas ya no funcionan sin señal por otras razones.
 *
 * La consecuencia honesta del nivel 2: sin señal, una máquina que llegó hoy no aparece en el
 * desplegable hasta que ese teléfono tenga señal una vez. Se prefiere eso a bloquear la captura.
 * Nunca se sirve una flota VACÍA: sin máquinas el capataz no podría reportar nada.
 *
 * D171: el reporte del capataz ya no elige de la hoja MAQUINAS sino de PARTE_EQUIPOS (catálogo único
 * de máquinas, el mismo del Parte Digital), que el mismo endpoint devuelve como `equipos`; ver
 * `equiposCapataz`. `maquinas` (estancias de la hoja MAQUINAS) sigue sirviendo a la chequeadora, al
 * panel del encargado y a produccion-maquinaria.html.
 *
 * SOLO LECTURA. Este archivo no escribe nada en el servidor.
 */
(function(){
  'use strict';

  // Normaliza la lista escrita a mano de una pantalla (respaldo) a la forma que devuelve el servidor.
  function desdeRespaldo(resp){
    var ids = (resp && resp.ids) || [], tipos = (resp && resp.tipos) || {}, prog = (resp && resp.prog) || {};
    return ids.map(function(id){
      var t = tipos[id] || '';
      return { id_maquina:id, tipo:t, prog:(prog[id]!==undefined?prog[id]:6.4),
               propiedad:'', notas:'', produce:!TM2Flota.sinProduccion(t), esperada:true };
    });
  }

  var TM2Flota = {
    // Tipos cuya producción es SIEMPRE nula (D41/D44/D111). Se decide por TIPO, no por ID, para que
    // una máquina nueva del mismo tipo se comporte bien sin tocar nada.
    TIPOS_SIN_PRODUCCION: ['VIBROCOMPACTADOR','MINICARGADOR','MINIBULDOZER','RETROEXCAVADORA'],

    sinProduccion: function(tipo){
      return TM2Flota.TIPOS_SIN_PRODUCCION.indexOf(String(tipo||'').toUpperCase()) >= 0;
    },

    /**
     * Pide la flota vigente en `fecha`. NUNCA lanza ni devuelve vacío: siempre entrega algo con qué
     * trabajar. Resuelve a { maquinas, fecha, fuente, guardado, avisos }, donde fuente es:
     *   'hoja'     — la hoja MAQUINAS del Sheet (lo normal)
     *   'codigo'   — el servidor cayó a su catálogo de respaldo (hoja vacía o inexistente)
     *   'cache'    — sin señal; lo último que vio este teléfono
     *   'respaldo' — sin señal y sin caché; la lista escrita en la pantalla
     *
     * @param {string} apiUrl  URL del Apps Script de obra
     * @param {string} fecha   yyyy-mm-dd; vacío = hoy
     * @param {object} resp    respaldo de la pantalla: {ids:[], tipos:{}, prog:{}}
     */
    cargar: function(apiUrl, fecha, resp){
      var url = apiUrl + '?action=maquinas' + (fecha ? ('&fecha=' + encodeURIComponent(fecha)) : '');
      var pedir = function(){
        return fetch(url).then(function(r){ return r.json(); }).then(function(d){
          if(!d || !d.ok || !d.maquinas || !d.maquinas.length) throw new Error('sin flota');
          // D171: `equipos` = catálogo PARTE_EQUIPOS (activo=SI) para el reporte del capataz.
          return { maquinas:d.maquinas, equipos:d.equipos||[], fecha:d.fecha||fecha||'', fuente:d.fuente||'hoja', avisos:d.avisos||[] };
        });
      };
      var conCache = (typeof TM2Offline !== 'undefined' && TM2Offline.catalogoCache)
        ? TM2Offline.catalogoCache('flota', pedir, 72)
        : pedir().then(function(d){ return { data:d, guardado:'', fresco:true }; });

      return conCache.then(function(r){
        var d = r.data || r;
        // `fresco:false` = la copia local; la `fuente` que traía guardada ya no describe de dónde
        // salió AHORA, así que manda el estado de la caché.
        return { maquinas:d.maquinas, equipos:d.equipos||[], fecha:d.fecha||'', avisos:d.avisos||[], guardado:r.guardado||'',
                 fuente: (r.fresco===false ? 'cache' : (d.fuente||'hoja')) };
      }).catch(function(){
        return { maquinas:desdeRespaldo(resp), equipos:[], fecha:fecha||'', fuente:'respaldo', guardado:'', avisos:[] };
      });
    },

    /**
     * D171 — catálogo de equipos del REPORTE DEL CAPATAZ: [{codigo,tipo,placa}] ordenado por tipo y
     * código. La fuente única es la hoja PARTE_EQUIPOS (`activo=SI`), que el servidor devuelve dentro de
     * `?action=maquinas` como `equipos`. Si la respuesta (o la copia en caché, o el respaldo) no lo trae
     * —backend sin redesplegar, caché anterior a D171, teléfono sin señal—, se deriva de `maquinas`
     * para que el capataz nunca se quede sin lista.
     */
    equiposCapataz: function(fl){
      var eq = (fl && fl.equipos && fl.equipos.length) ? fl.equipos : (fl && fl.maquinas || []).map(function(m){
        return { codigo:m.id_maquina, tipo:m.tipo||'', placa:'' };
      });
      return eq.map(function(q){ return { codigo:String(q.codigo||'').trim(), tipo:String(q.tipo||'').trim(), placa:String(q.placa||'').trim() }; })
        .filter(function(q){ return q.codigo; })
        .sort(function(a,b){
          var ta=a.tipo.toUpperCase(), tb=b.tipo.toUpperCase();
          return ta<tb?-1:ta>tb?1:(a.codigo<b.codigo?-1:a.codigo>b.codigo?1:0);
        });
    },

    // Atajos para armar lo que las pantallas ya usaban (ids, id->tipo, id->horas programadas).
    ids:    function(maquinas){ return (maquinas||[]).map(function(m){ return m.id_maquina; }); },
    tipos:  function(maquinas){ var o={}; (maquinas||[]).forEach(function(m){ o[m.id_maquina]=m.tipo; }); return o; },
    progs:  function(maquinas){ var o={}; (maquinas||[]).forEach(function(m){ o[m.id_maquina]=m.prog;  }); return o; },
    deTipo: function(maquinas, tipo){
      var t=String(tipo||'').toUpperCase();
      return (maquinas||[]).filter(function(m){ return String(m.tipo||'').toUpperCase()===t; });
    },

    // Frase corta para avisar en pantalla de dónde salió la lista. '' = todo normal, no se muestra.
    aviso: function(fl){
      var f = (fl && fl.fuente) || '', cuando = '';
      if(fl && fl.guardado && typeof TM2Offline !== 'undefined' && TM2Offline.fechaCorta){
        cuando = TM2Offline.fechaCorta(fl.guardado);
      }
      if(f==='cache')    return 'Sin señal: lista de máquinas guardada en este equipo'+(cuando?(' el '+cuando):'')+'. Puede estar desactualizada.';
      if(f==='respaldo') return 'Sin señal y sin lista guardada: se muestra la flota de referencia de la app.';
      if(f==='codigo')   return 'La hoja MAQUINAS está vacía o no existe: se muestra la flota de respaldo del servidor.';
      return '';
    }
  };

  window.TM2Flota = TM2Flota;
})();
