/**
 * Semillas del modo `vm`: las hojas mínimas para que los tres backends respondan con datos conocidos.
 * Cada hoja = [[encabezados], [fila], …], con los MISMOS encabezados que definen los .gs (copiados de ahí).
 * Contra una URL no se usan (allí manda lo que haya en el Sheet de prueba); los casos que dependen de
 * estos valores concretos lo dicen con `soloVm:true`.
 */
'use strict';

const NBSP = String.fromCharCode(160);   // espacio duro U+00A0 (el sello de la revisión D182, sin el carácter invisible en el fuente)

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
      // V3-08/D181: subtramos para la grilla editable. Dos TRAMO encadenados (comparten 11000/12000: NO
      // es solape), un marcador ODT puntual y los DOS «ajuste a origen» (no operativos, corredor completo).
      base_elementos: [['elemento','abs_inicio','abs_fin','uf','tipo','orden'],
        ['tm2 pk 10+000 - 11+000', '10000', '11000', 'UF1', 'TRAMO', 1],
        ['tm2 pk 11+000 - 12+000', '11000', '12000', 'UF1', 'TRAMO', 2],
        ['ODT1-001',                '11012', '11012', 'UF1', 'ODT',   3],
        ['ajuste origen UF1',       '9800',  '29950', 'UF1', '',      4],
        ['ajuste origen UF2',       '30000', '39600', 'UF2', '',      5]],
      // V3-08b/D181: catálogo de actividades (BASE A–H) para derivar CC/grupo/capítulo/unidad desde descripción+UF.
      base_items: [['cc','descripcion','unidad','capitulo','grupo','uf','proyecto','orden'],
        ['3701.02.05','Excavación en material común','m3','EXPLANACIONES','TIERRAS','UF1','3701',10],
        ['3701.02.07','Terraplenes','m3','EXPLANACIONES','TIERRAS','UF1','3701',12],
        ['3702.02.05','Excavación en material común','m3','EXPLANACIONES','TIERRAS','UF2','3702',210],
        // D184: el texto REAL de la BASE, que es el que está en fc_actividad (FC 1.3, 007). Con dos ítems en el CC
        // 3701.02.07, lookupDescripcion (enviar_data) elige el más completo que empieza por lo reportado.
        ['3701.02.07','Terraplenes (solo conformación)','m3','EXPLANACIONES','TIERRAS','UF1','3701',13]],
      // D184: dos ACTAS DE BANCO en 2020 (la tabla real empieza en el acta 10 = 2025-07-16 y la fórmula de respaldo da
      // < 1 → '' antes de 2024-10-16), para probar el borde 15/16 con fechas que ningún dato real comparte. Van en
      // meses que no usan las otras semillas ni los periodos de banco del plan (2020-01…03).
      periodos: [['acta','fecha_inicial','fecha_final'],
        ['B06','2020-05-16','2020-06-15'],
        ['B07','2020-06-16','2020-07-15']],
      // V3-08b/D181: una fila de DATA sembrada para probar lectura por rango, corrección y versión.
      // D182 (clima del día, campos ocultos, 005): solo la usa el banco SQL (worker/pruebas); el .gs lee 'DATA'.
      //   2020-01-20 · fila FUERA de catálogo con liberación TOPOGRAFIA y orden/proyecto propios (se conservan).
      //   2020-01-21 · tierras con clima + una de drenajes (odt) con '' → propagación del clima del día.
      //   2020-01-22 · sello '[Clima: Lluvias]' en la observación con clima '' (lo mueve 005); una fila con clima
      //                propio y sello (se conserva su clima; timestamp NULL → va DESPUÉS: el día es 'Lluvias');
      //                y una odt sin clima (toma el del día en data_maestro).
      //   2020-01-23 · clima histórico fuera de la lista ('SOLEADO'): se muestra tal cual.
      //   2020-01-24 · un día sin ningún clima (CLIMA '' en data_maestro; un alta ahí no hereda nada).
      //   Revisión de D182:
      //   2020-01-23 · otro sello con espacio duro (U+00A0) alrededor del '·' (005 lo limpia como el \s de JS).
      //   2020-01-27 · tierras con derivados «viejos» (cantidad 50 ≠ 100÷1.3, orden 13 ≠ 10 del catálogo) + una de
      //                drenajes D71 (demolición 3701.01.02 con area 'odt', que su CC no deriva) sin clima.
      //   2020-01-28 · la ÚNICA fila con clima es de tierras; dos de drenajes con '' (una baja no se lleva el clima).
      //   2020-01-29 → 2020-01-30 · ídem en el 29, para mover su fila con clima al 30 (clima propio a las 10:00).
      //   Fechas de 2020, como FECHA_BANCO: ningún dato real las comparte, así el «clima del día» es solo el sembrado.
      //   D184 (relleno de 007: solo donde falta, version+1 una vez; las banco B06/B07 de `periodos` dan el acta):
      //   2020-06-10 · terraplén con ACTA/ESPESOR/FC/CANTIDAD vacías (→ B06, 1, 1.3, 100) y una conformación con FC 1.8
      //                escrito a mano y la cantidad vacía (el FC se respeta: cantidad = 90 ÷ 1.8 = 50; acta B06).
      //   2020-06-20 · una fila COMPLETA con acta a mano '7' y cantidad 99 (007 no la toca: version 0); préstamo
      //                tecleado sin tildes ni mayúsculas (cruce normalizado → FC 1.3); otra actividad con espesor
      //                0.5 (se respeta, FC 1 → 20); una sin LARGO (solo gana el acta B07).
      //   2020-08-03 · fuera de B06/B07 y antes del acta 1 → acta '' (la fórmula da < 1), pero espesor/FC/cantidad sí.
      //   (2020-06-15 y 2020-06-16 quedan libres: son los días que pisan los casos de enviar_data de D184.)
      //   D185 (V3-11 Fases B+C, el Tablero en vivo):
      //   2020-07-07 · el PLIEGUE de un día: aprovechable UF1 (10) y otra en UF2 tecleada en minúsculas y sin tildes
      //                (5: la fila '*' del mapeo casa cualquier UF), no aprovechable UF2 (4), préstamo sin UF (3),
      //                terraplén UF1 (20) y UF2 (7), subbase UF2 (2), base UF1 (1.5), un terraplén con la UF VACÍA
      //                (no casa: el mapeo del terraplén es por UF) y un pedraplén (fuera del mapeo). Clima en
      //                minúsculas: el Tablero lo recibe en MAYÚSCULAS. Cantidades compactas ya escritas.
      //   2020-07-08 · [O] FC 1 en «ajuste origen»: un terraplén de «ajuste origen UF2» con FC 1.3 (el error del Excel:
      //                007 lo pasa a FC 1 y cantidad 130), una subbase de «ajuste origen UF1» con ESPESOR/FC/CANTIDAD
      //                vacías (→ 1, 1, 26: no el 1.3 de la actividad), otra sin LARGO con FC 1.3 (→ FC 1, la
      //                cantidad 7 se queda) y un terraplén normal de control (→ FC 1.3 de la actividad, 10).
      data: [['fecha','orden','centro_de_costo','descripcion','unidad_funcional','proyecto','elemento','abs_inicial','abs_final','liberacion','acta','unidad_medida','grupo','capitulo','largo','espesor','fc','cantidad','observacion','clima','area','timestamp','id_registro'],
        ['2025-09-20','','3701.02.05','Excavación en material común','UF1','3701','tm2 pk 10+000 - 11+000','10000','11000','CAMPO','12','m3','TIERRAS','EXPLANACIONES',100,1,1.3,76.92,'','','','','seed-data-1'],
        ['2020-01-20','999','3701.99.01','Actividad manual de contrato','UF1','P-X','tm2 pk 10+000 - 11+000','10000','11000','TOPOGRAFIA','','m2','MANUAL','PRUEBA',10,1,1,10,'fila a mano','Soleado','tierras','2020-01-20 08:00','seed-dg-ocultos'],
        ['2020-01-21','10','3701.02.05','Excavación en material común','UF1','3701','tm2 pk 10+000 - 11+000','10000','11000','CAMPO','','m3','TIERRAS','EXPLANACIONES',100,1,1.3,76.92,'','Soleado','tierras','2020-01-21 08:00','seed-dg-clima-t'],
        ['2020-01-21','30','3701.06.01','Excavaciones varias sin clasicar','UF1','3701','ODT1-001','11012','11012','CAMPO','','m3','DRENAJES Y ESTRUCTURAS','DRENAJE TRANSVERSAL',6,1,1,6,'','','odt','2020-01-21 09:00','seed-dg-clima-o'],
        ['2020-01-22','10','3701.02.05','Excavación en material común','UF1','3701','tm2 pk 10+000 - 11+000','10000','11000','CAMPO','','m3','TIERRAS','EXPLANACIONES',50,1,1.3,38.46,'[Clima: Lluvias] · nota del día','','tierras','2020-01-22 07:00','seed-dg-sello'],
        ['2020-01-22','10','3701.02.05','Excavación en material común','UF1','3701','tm2 pk 11+000 - 12+000','11000','12000','CAMPO','','m3','TIERRAS','EXPLANACIONES',20,1,1.3,15.38,'[clima: SOLEADO]','Lluvias parciales','tierras','','seed-dg-a-propio'],
        ['2020-01-22','30','3701.06.01','Excavaciones varias sin clasicar','UF1','3701','ODT1-001','11012','11012','CAMPO','','m3','DRENAJES Y ESTRUCTURAS','DRENAJE TRANSVERSAL',3,1,1,3,'sin sello','','odt','2020-01-22 09:00','seed-dg-sin-clima'],
        ['2020-01-23','10','3701.02.05','Excavación en material común','UF1','3701','tm2 pk 10+000 - 11+000','10000','11000','CAMPO','','m3','TIERRAS','EXPLANACIONES',30,1,1.3,23.08,'','SOLEADO','tierras','2020-01-23 08:00','seed-dg-historico'],
        ['2020-01-24','10','3701.02.05','Excavación en material común','UF1','3701','tm2 pk 10+000 - 11+000','10000','11000','CAMPO','','m3','TIERRAS','EXPLANACIONES',40,1,1.3,30.77,'','','tierras','2020-01-24 08:00','seed-dg-sin-dia'],
        ['2020-01-23','10','3701.02.05','Excavación en material común','UF1','3701','tm2 pk 11+000 - 12+000','11000','12000','CAMPO','','m3','TIERRAS','EXPLANACIONES',5,1,1.3,3.85,'[Clima: SOLEADO]'+NBSP+'·'+NBSP+'nbsp'+NBSP,'SOLEADO','tierras','2020-01-23 09:00','seed-dg-nbsp'],
        ['2020-01-27','13','3701.02.05','Excavación en material común','UF1','3701','tm2 pk 10+000 - 11+000','10000','11000','CAMPO','','m3','TIERRAS','EXPLANACIONES',100,1,1.3,50,'','Soleado','tierras','2020-01-27 08:00','seed-dg-op-t'],
        ['2020-01-27','30','3701.01.02','Demolición de estructuras','UF1','3701','ODT1-001','11012','11012','CAMPO','','m3','DRENAJES Y ESTRUCTURAS','DEMOLICIONES Y REUBICACIONES',2,1,1,2,'','','odt','2020-01-27 09:00','seed-dg-op-d71'],
        ['2020-01-28','10','3701.02.05','Excavación en material común','UF1','3701','tm2 pk 10+000 - 11+000','10000','11000','CAMPO','','m3','TIERRAS','EXPLANACIONES',10,1,1.3,7.69,'','Lluvias','tierras','2020-01-28 07:00','seed-dg-port'],
        ['2020-01-28','30','3701.06.01','Excavaciones varias sin clasicar','UF1','3701','ODT1-001','11012','11012','CAMPO','','m3','DRENAJES Y ESTRUCTURAS','DRENAJE TRANSVERSAL',1,1,1,1,'','','odt','2020-01-28 09:00','seed-dg-port-o1'],
        ['2020-01-28','30','3701.06.01','Excavaciones varias sin clasicar','UF1','3701','ODT1-001','11012','11012','CAMPO','','m3','DRENAJES Y ESTRUCTURAS','DRENAJE TRANSVERSAL',2,1,1,2,'','','odt','2020-01-28 10:00','seed-dg-port-o2'],
        ['2020-01-29','10','3701.02.05','Excavación en material común','UF1','3701','tm2 pk 10+000 - 11+000','10000','11000','CAMPO','','m3','TIERRAS','EXPLANACIONES',10,1,1.3,7.69,'','Soleado','tierras','2020-01-29 07:00','seed-dg-mov'],
        ['2020-01-29','30','3701.06.01','Excavaciones varias sin clasicar','UF1','3701','ODT1-001','11012','11012','CAMPO','','m3','DRENAJES Y ESTRUCTURAS','DRENAJE TRANSVERSAL',1,1,1,1,'','','odt','2020-01-29 09:00','seed-dg-mov-o'],
        ['2020-01-30','10','3701.02.05','Excavación en material común','UF1','3701','tm2 pk 10+000 - 11+000','10000','11000','CAMPO','','m3','TIERRAS','EXPLANACIONES',10,1,1.3,7.69,'','Lluvias','tierras','2020-01-30 10:00','seed-dg-dest'],
        ['2020-01-30','30','3701.06.01','Excavaciones varias sin clasicar','UF1','3701','ODT1-001','11012','11012','CAMPO','','m3','DRENAJES Y ESTRUCTURAS','DRENAJE TRANSVERSAL',1,1,1,1,'','','odt','2020-01-30 11:00','seed-dg-dest-o'],
        ['2020-06-10','','3701.02.07','Terraplenes (solo conformación)','UF1','3701','tm2 pk 10+000 - 11+000','10000','11000','CAMPO','','m3','TIERRAS','EXPLANACIONES',130,'','','','','Soleado','tierras','2020-06-10 08:00','seed-d184-terr'],
        ['2020-06-10','','3701.02.08','Conformación y disposición de sobrantes (incluye obras de adecuación)','UF1','3701','RCD 15+800','15800','15800','CAMPO','','m3','TIERRAS','EXPLANACIONES',90,1,1.8,'','fc a mano','Soleado','tierras','2020-06-10 09:00','seed-d184-mano'],
        ['2020-06-20','','3701.03.01','Subbase Granular','UF1','3701','tm2 pk 10+000 - 11+000','10000','11000','CAMPO','7','m3','TIERRAS','BASES, SUBBASES Y AFIRMADOS',26,1,1.3,99,'completa','','tierras','2020-06-20 08:00','seed-d184-lleno'],
        ['2020-06-20','','3701.02.06','  excavacion en material COMUN de   prestamos ','UF1','3701','EL DIVISO','21500','21500','CAMPO','','m3','TIERRAS','EXPLANACIONES',13,'','','','','','tierras','2020-06-20 09:00','seed-d184-norm'],
        ['2020-06-20','','3701.02.05','Excavación en material común','UF1','3701','tm2 pk 10+000 - 11+000','10000','11000','CAMPO','','m3','TIERRAS','EXPLANACIONES',40,0.5,'','','','','tierras','2020-06-20 10:00','seed-d184-otra'],
        ['2020-06-20','','3701.03.01','Subbase Granular','UF1','3701','tm2 pk 10+000 - 11+000','10000','11000','CAMPO','','m3','TIERRAS','BASES, SUBBASES Y AFIRMADOS','','','',7,'sin largo','','tierras','2020-06-20 11:00','seed-d184-sinlargo'],
        ['2020-08-03','','3701.02.07','Terraplenes (solo conformación)','UF1','3701','tm2 pk 10+000 - 11+000','10000','11000','CAMPO','','m3','TIERRAS','EXPLANACIONES',26,'','','','','','tierras','2020-08-03 08:00','seed-d184-sinacta'],
        ['2020-07-07','','3701.02.05','Excavaciones en material común APROVECHABLE','UF1','3701','tm2 pk 10+000 - 11+000','10000','11000','CAMPO','','m3','TIERRAS','EXPLANACIONES',13,1,1.3,10,'','lluvias parciales','tierras','2020-07-07 08:00','seed-d185-apr1'],
        ['2020-07-07','','3702.02.05','excavaciones en material comun  aprovechable','UF2','3702','tm2 pk 31+000 - 32+000','31000','32000','CAMPO','','m3','TIERRAS','EXPLANACIONES',6.5,1,1.3,5,'','','tierras','2020-07-07 08:10','seed-d185-apr2'],
        ['2020-07-07','','3702.02.05','Excavaciones en material común NO APROVECHABLE','UF2','3702','tm2 pk 31+000 - 32+000','31000','32000','CAMPO','','m3','TIERRAS','EXPLANACIONES',5.2,1,1.3,4,'','','tierras','2020-07-07 08:20','seed-d185-nap2'],
        ['2020-07-07','','3701.02.06','Excavación en material común de préstamos','','3701','EL DIVISO','21500','21500','CAMPO','','m3','TIERRAS','EXPLANACIONES',3.9,1,1.3,3,'','','tierras','2020-07-07 08:30','seed-d185-pre'],
        ['2020-07-07','','3701.02.07','Terraplenes (solo conformación)','UF1','3701','tm2 pk 10+000 - 11+000','10000','11000','CAMPO','','m3','TIERRAS','EXPLANACIONES',26,1,1.3,20,'','','tierras','2020-07-07 08:40','seed-d185-ter1'],
        ['2020-07-07','','3702.02.07','Terraplenes (solo conformación)','UF2','3702','tm2 pk 31+000 - 32+000','31000','32000','CAMPO','','m3','TIERRAS','EXPLANACIONES',9.1,1,1.3,7,'','','tierras','2020-07-07 08:50','seed-d185-ter2'],
        ['2020-07-07','','3702.03.01','Subbase Granular','UF2','3702','tm2 pk 31+000 - 32+000','31000','32000','CAMPO','','m3','TIERRAS','BASES, SUBBASES Y AFIRMADOS',2.6,1,1.3,2,'','','tierras','2020-07-07 09:00','seed-d185-sub2'],
        ['2020-07-07','','3701.03.03','Base granular estabilizada con cemento (No incluye cemento)','UF1','3701','tm2 pk 10+000 - 11+000','10000','11000','CAMPO','','m3','TIERRAS','BASES, SUBBASES Y AFIRMADOS',1.95,1,1.3,1.5,'','','tierras','2020-07-07 09:10','seed-d185-bas1'],
        ['2020-07-07','','3701.02.07','Terraplenes (solo conformación)','','3701','','','','CAMPO','','m3','TIERRAS','EXPLANACIONES',130,1,1.3,100,'UF vacía','','tierras','2020-07-07 09:20','seed-d185-ter-sinuf'],
        ['2020-07-07','','3701.02.09','Pedraplen compacto','UF1','3701','tm2 pk 10+000 - 11+000','10000','11000','CAMPO','','m3','TIERRAS','EXPLANACIONES',50,1,1,50,'fuera del mapeo','','tierras','2020-07-07 09:30','seed-d185-pedra'],
        ['2020-07-08','','3702.02.07','Terraplenes (solo conformación)','UF2','3702','ajuste origen UF2','30000','39600','CAMPO','','m3','TIERRAS','EXPLANACIONES',130,1,1.3,100,'','','tierras','2020-07-08 08:00','seed-d185-ao-fix'],
        ['2020-07-08','','3701.03.01','Subbase Granular','UF1','3701','ajuste origen UF1','9800','29950','CAMPO','','m3','TIERRAS','BASES, SUBBASES Y AFIRMADOS',26,'','','','','','tierras','2020-07-08 08:10','seed-d185-ao-vacio'],
        ['2020-07-08','','3701.03.01','Subbase Granular','UF1','3701','  Ajuste  Origen UF1','9800','29950','CAMPO','','m3','TIERRAS','BASES, SUBBASES Y AFIRMADOS','','',1.3,7,'sin largo','','tierras','2020-07-08 08:20','seed-d185-ao-sinlargo'],
        ['2020-07-08','','3701.02.07','Terraplenes (solo conformación)','UF1','3701','tm2 pk 10+000 - 11+000','10000','11000','CAMPO','','m3','TIERRAS','EXPLANACIONES',13,'','','','control','','tierras','2020-07-08 08:30','seed-d185-control']],
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
