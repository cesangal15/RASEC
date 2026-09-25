"""tm2-conciliador · armar_filas.py

Convierte los bloques A..S que exporta la herramienta (bloque_acta_* = encontradas/aceptadas y
bloque_acta_pendientes_* = pendientes de digitación con comprobante) en el JSON de filas que consume
`escribir_acta.ps1` (solo las columnas de ENTRADA del acta del contratista: las calculadas las pone la
tabla de Excel con sus fórmulas).

  python armar_filas.py --bloque bloque_acta_*.xlsx [--pendientes bloque_acta_pendientes_*.xlsx]
                        [--decisiones decisiones.json] --out filas.json

- «Kilómetros Totales» solo se manda cuando el km inicial no es numérico (p. ej. «Planta Putana»): la
  fórmula del acta (|fin − ini| / 1000) no puede calcularlo.
- TM1: la fórmula de Observaciones solo conoce PUENTES (CC 3701.11.03), así que para las filas decididas
  como TM1 se manda la observación literal «TM1 - <tramo>» (≤3 km interno, ≤5 km 3 a 5, si no > 5 km),
  igual que la escribe el dueño.
"""
from __future__ import annotations

import argparse
import json
import sys

import openpyxl

COLS = {"fecha": 2, "uf": 5, "actividad": 6, "cc": 7, "remision": 8, "placa": 9, "kmIni": 10, "kmFin": 11,
        "kmTot": 12, "m3": 15, "unidad": 17}   # índices 0-based de A..S


def _num(v):
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return None


def _tramo(km):
    if km is None:
        return "VIAJE CORTO MAYOR A 5KM"
    if km <= 3:
        return "VIAJE INTERNO"
    if km <= 5:
        return "VIAJE CORTO ENTRE 3 KM A 5 KM"
    return "VIAJE CORTO MAYOR A 5KM"


def leer(ruta):
    ws = openpyxl.load_workbook(ruta, data_only=True).active
    filas = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        if not r or r[COLS["remision"]] in (None, ""):
            continue
        filas.append({k: r[i] for k, i in COLS.items()})
    return filas


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bloque", required=True)
    ap.add_argument("--pendientes")
    ap.add_argument("--decisiones")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    area = {}
    if a.decisiones:
        for d in json.load(open(a.decisiones, encoding="utf-8")):
            if d.get("area"):
                area[str(d["remision"])] = d["area"]

    filas = leer(a.bloque) + (leer(a.pendientes) if a.pendientes else [])
    salida = []
    for f in filas:
        rem = str(f["remision"]).strip()
        fila = {
            "fecha": str(f["fecha"] or ""), "uf": f["uf"] or "", "actividad": f["actividad"] or "",
            "cc": str(f["cc"] or ""), "remision": int(rem) if rem.isdigit() else rem, "placa": f["placa"] or "",
            "kmIni": f["kmIni"], "kmFin": f["kmFin"], "m3": _num(f["m3"]), "unidad": f["unidad"] or "m3km",
        }
        if _num(f["kmIni"]) is None:
            fila["kmTot"] = _num(f["kmTot"])
        if area.get(rem) == "TM1":
            fila["obs"] = "TM1 - " + _tramo(_num(f["kmTot"]))
        salida.append(fila)
    json.dump(salida, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{len(salida)} filas -> {a.out} (TM1: {sum(1 for x in salida if 'obs' in x)}, km literal: {sum(1 for x in salida if 'kmTot' in x)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
