#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genera tools/sandbox/data.real.csv a partir de la hoja DATA del Excel maestro
(TM2_SUR_REPORTE_nuevo.xlsx). Es la carga de datos reales del sandbox: sin él
la pantalla «Revisión de DATA» solo tendría una muestra.

Uso:
    python3 tools/sandbox/extraer_data_real.py /ruta/a/TM2_SUR_REPORTE_nuevo.xlsx
    # (opcional) segundo argumento: CSV de salida; por defecto tools/sandbox/data.real.csv

Requiere openpyxl:  pip install openpyxl

Mapeo hoja DATA (columnas A..S) -> CSV:
    fecha, orden, grupo, centro_de_costo, capitulo, descripcion, unidad_funcional,
    proyecto, elemento, abs_inicial, abs_final, liberacion, acta, unidad_medida,
    largo, espesor, fc, cantidad, observacion
más id_registro = "xls-<fila_excel - 1>" (fila Excel 2 -> xls-1), único por fila.

Transformación (celda_texto):
  - fecha  : datetime -> "YYYY-MM-DD".
  - números: enteros exactos sin ".0" (largo 210, no 210.0); no enteros con repr()
             (round-trip exacto: 1.3, 118.46153846153845); decimal con PUNTO, nunca coma.
  - vacío  : None -> "" (cadena vacía).
  - texto  : str(v).strip()  <-- normalización INTENCIONAL: recorta espacios al
             inicio/fin (afecta ~451 celdas de capitulo/descripcion en el maestro
             actual). Es solo whitespace, no pierde datos, y coincide con el trim
             que el tool ya aplica al derivar CC (worker/src/api/obra/datagrid.js).
             Los dobles espacios INTERNOS (p.ej. "Concreto clase  28 MPA") se
             conservan tal cual, porque base_items los tiene igual y así el CC casa.

Solo se exportan filas con FECHA (el cargador del sandbox exige fecha + id_registro).
Al final autoverifica que el CSV re-parsea y que reproduce por VALOR cada celda del
Excel (números por float con tolerancia, fechas y texto tras strip).
"""
import sys, os, csv, datetime, math

CAB = ['fecha','orden','grupo','centro_de_costo','capitulo','descripcion','unidad_funcional','proyecto',
       'elemento','abs_inicial','abs_final','liberacion','acta','unidad_medida','largo','espesor','fc',
       'cantidad','observacion','id_registro']
NCOL = 19  # columnas A..S del Excel (las 19 primeras de CAB)
NUMERICAS = {'orden','abs_inicial','abs_final','acta','largo','espesor','fc','cantidad'}


def celda_texto(v):
    if v is None:
        return ''
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime('%Y-%m-%d')
    if isinstance(v, bool):          # openpyxl podría devolver bool; trátalo como texto
        return str(v)
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else repr(v)   # entero sin ".0"; resto round-trip
    if isinstance(v, int):
        return str(v)
    return str(v).strip()


def extraer(xlsx_path, out_path):
    import openpyxl
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    if 'DATA' not in wb.sheetnames:
        sys.exit('El Excel no tiene una hoja llamada "DATA". Hojas: ' + ', '.join(wb.sheetnames))
    ws = wb['DATA']
    filas, crudo = [], []
    for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        vals = list(row)[:NCOL]
        if vals[0] is None or str(vals[0]).strip() == '':   # sin fecha -> se omite
            continue
        out = [celda_texto(v) for v in vals]
        out.append('xls-' + str(i - 1))
        filas.append(out)
        crudo.append(vals)
    with open(out_path, 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh, quoting=csv.QUOTE_MINIMAL)
        w.writerow(CAB)
        w.writerows(filas)
    return filas, crudo


def verificar(out_path, filas, crudo):
    # 1) re-parseo íntegro
    with open(out_path, encoding='utf-8') as fh:
        releido = list(csv.DictReader(fh))
    assert len(releido) == len(filas), 're-parseo: %d != %d' % (len(releido), len(filas))
    # 2) ids únicos
    ids = [f[-1] for f in filas]
    assert len(set(ids)) == len(ids), 'ids duplicados'
    # 3) fidelidad por valor contra el Excel
    difs = 0
    for vals, f in zip(crudo, filas):
        for k, raw, txt in zip(CAB[:NCOL], vals, f[:NCOL]):
            if k in NUMERICAS and raw is not None and txt != '':
                if not math.isclose(float(raw), float(txt), rel_tol=1e-9, abs_tol=1e-12):
                    difs += 1
            elif isinstance(raw, (datetime.datetime, datetime.date)):
                if raw.strftime('%Y-%m-%d') != txt:
                    difs += 1
            else:
                if (('' if raw is None else str(raw)).strip()) != txt:
                    difs += 1
    return len(releido), len(set(ids)), difs


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    xlsx = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), 'data.real.csv')
    if not os.path.exists(xlsx):
        sys.exit('No existe el Excel: ' + xlsx)
    filas, crudo = extraer(xlsx, out)
    n, uniq, difs = verificar(out, filas, crudo)
    print('Filas escritas : %d  (ids únicos: %d)' % (len(filas), uniq))
    print('Re-parseo      : %d filas OK' % n)
    print('Fidelidad      : %d celdas distintas por valor (0 = extracción fiel)' % difs)
    if difs:
        sys.exit('¡Hay diferencias de valor! Revisa celda_texto antes de usar el CSV.')
    print('OK -> ' + out)


if __name__ == '__main__':
    main()
