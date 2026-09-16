/**
 * Semillas del modo `vm`: las hojas mínimas para que los tres backends respondan con datos conocidos.
 * Cada hoja = [[encabezados], [fila], …], con los MISMOS encabezados que definen los .gs (copiados de ahí).
 * Contra una URL no se usan (allí manda lo que haya en el Sheet de prueba); los casos que dependen de
 * estos valores concretos lo dicen con `soloVm:true`.
 */
'use strict';

function semillas(){
  return {
    obra: {
      // D108: `clave` en claro o hash SHA-256 de `usuario:clave`; el login acepta las dos. Aquí en claro.
      USUARIOS: [['usuario','clave','rol','areas','redirige','estado'],
        ['admin','1234','admin','','menu.html','activo'],
        ['angel','clave-angel','capataz','','seleccion-reporte.html','activo'],
        ['jefe','clave-jefe','jefe','','jefe.html','activo'],
        ['residente','clave-res','residente','','residente.html','activo'],
        ['encargado','clave-enc','encargado','','encargado.html','activo'],
        ['inactivo','1234','capataz','','menu.html','inactivo']],
      CUBICAJE: [['placa','cubicaje','tipo'], ['NNM180', 14, 'dobletroque'], ['ABC123', 12, 'sencilla']],
      // D138/D139: estancias de la flota. `frente` (D173) es lo que el Parte usa para saber qué equipos espera.
      MAQUINAS: [['id_maquina','tipo','horas_prog','propiedad','fecha_ingreso','fecha_retiro','notas','frente'],
        ['EX01','Excavadora',10,'propia','2000-01-01','','','UF1-UF2'],
        ['VOL048','Volqueta',10,'alquilada','2000-01-01','','','UF1-UF2'],
        ['MO004','Motoniveladora',10,'alquilada','2000-01-01','','','UF1-UF2']],
      TABLERO: [['orden','texto']],
      PARTE_EQUIPOS: [['codigo','tipo','placa','proveedor','medidor','ultima_fecha','ultimo_final','activo'],
        ['VOL048','VOLQUETAS DOBLETROQUE','NNM180','ORTIZ','KM','2026-09-09',27120,'SI'],
        ['MO004','MOTONIVELADORAS','MC725594','ORTIZ','HOROMETRO','2026-09-09',2337,'SI'],
        ['BL002','BULLDOZER','MC725424','ORTIZ','HOROMETRO','','','NO']],
      PARTE_OPERADORES: [['operador','partes_ult_4_meses'], ['Nelson Rangel',323], ['Aleyxer Rincon',124], ['Wilmar Pawana',47]],
      PARTE_CC: [['centro_coste','proyecto','descripcion_cc','usos_ult_4_meses'],
        ['3701.02.11','3701','Transporte >1 km',457], ['3702.02.11','3702','Transporte >1 km',460],
        ['3701.02.10','3701','Transporte 100 m - 1 km',132], ['3701.02.07','3701','Terraplenes',504], ['3701.03.03','3701','Base granular',172]],
      PARTE_ITEMS: [['tipo_equipo','item','actividad','veces','activo'],
        ['VOLQUETAS DOBLETROQUE','02.11','Cargue terraplen (más de 1 km)',40,'SI'],
        ['VOLQUETAS DOBLETROQUE',2.1,'Cargue terraplen (100 m a 1 km)',9,'SI'],     // convertido a número por Sheets (D178)
        ['VOLQUETAS DOBLETROQUE','03.03','Cargue btc',6,'SI'],
        ['VOLQUETAS DOBLETROQUE','02.07','Terraplen',3,'SI'],
        ['MOTONIVELADORAS','02.07','Cereo terraplen',18,'SI']],
      PARTE_ACTIVIDADES: [['tipo_equipo','descripcion_trabajo','veces']],
      PARTE_BANDEJA: [['id_registro','timestamp','estado','fecha','codigo','tipo','placa','medidor','reporte_num','inicial','final','total','inicial_modificado',
        'horas_varada','horas_lluvia','hora_de','hora_a','descripcion_trabajo','centro_coste','pr','uf','operador','observaciones','alertas','revisado_por','revisado_ts','origen']]
    },
    asistencias: {
      CUADRILLAS: [['cuadrilla','responsables','area','estado'], ['ANGEL','angel','',''], ['EDUARDO','eduardo','odt','activa'], ['ARIEL','ariel','','inactiva']],
      PERSONAL: [['cedula','codigo','nombre','cargo','cuadrilla','responsable','estado','fecha_retiro','fecha_ingreso'],
        ['1090','75781','JUAN TIERRAS','AYUDANTE','ANGEL','angel','activo','',''],
        ['1091','75782','PEDRO TIERRAS','OFICIAL','ANGEL','angel','activo','',''],
        ['2200','80001','PEDRO ODT','OFICIAL','EDUARDO','eduardo','activo','','']],
      ASISTENCIA: [['id_registro','timestamp','fecha','reporta','cuadrilla','codigo','cedula','nombre','cargo','cc','proyecto','hora_entrada','hora_salida','presente','motivo_ausencia','observacion','turno']],
      CONFIG: [['clave','valor'], ['max_extras_dia',2], ['domfest_tope',7], ['proyecto_3701','3701| TM2 SUR UF1'], ['proyecto_3702','3702| TM2 SUR UF2']],
      FESTIVOS: [['fecha']], TURNOS: [['turno','tipo_dia','entrada','salida','descanso_ini','descanso_fin','cruza_medianoche']],
      CAT_CC: [['string_cc'], ['3701.02.05| EXCAVACION'], ['3701.06.01| CUNETA']],
      CC_USADOS: [['string_cc','area'], ['3701.02.05| EXCAVACION',''], ['3701.06.01| CUNETA','odt']],
      CAT_MOTIVOS: [['string_motivo'], ['Incapacidad'], ['Permiso']], MOTIVOS_USADOS: [['string_motivo']],
      CAT_TRABAJADORES: [['codigo','string_navision'], ['75781','75781| JUAN TIERRAS']],
      EXTRAS_ADMIN: [['fecha','cc','proyecto','horas','tipo','timestamp','reporta']],
      NOTAS_ASISTENCIA: [['fecha','cuadrilla','reporta','nota','timestamp']]
    }
  };
}
module.exports = { semillas };
