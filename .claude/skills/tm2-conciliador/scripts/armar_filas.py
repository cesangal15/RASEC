"""tm2-conciliador · armar_filas.py

Convierte los bloques A..S que exporta la herramienta (bloque_acta_* = encontradas/aceptadas y
bloque_acta_pendientes_* = pendientes de digitación con comprobante) en el JSON de filas que consume
`escribir_acta.ps1` (solo las columnas de ENTRADA del acta del contratista: las calculadas las pone la
tabla de Excel con sus fórmulas).

  python armar_filas.py --bloque bloque_acta_*.xlsx [--pendientes bloque_acta_pendientes_*.xlsx]
                        [--decisiones decisiones.json] [--internos internos.json] --out filas.json

- «Kilómetros Totales» solo se manda cuando el km inicial no es numérico (p. ej. «Planta Putana»): la
  fórmula del acta (|fin − ini| / 1000) no puede calcularlo.
- TM1: la fórmula de Observaciones solo conoce PUENTES (CC 3701.11.03), así que para las filas decididas
  como TM1 se manda la observación literal «TM1 - <tramo>» (≤5 km 3 a 5, si no > 5 km), igual que la
  escribe el dueño.
- Días internos (references/internos_y_cuota.md): el dueño filtra el acta por Observaciones y pone la
  cuota en la dinámica, así que TODAS las filas de esa placa ese día llevan el mismo CC y la observación
  de interno escrita («VIAJE INTERNO», «PUENTES - VIAJE INTERNO», «TM1 - VIAJE INTERNO»), aunque algún
  viaje sea largo. internos.json (lo que confirmó el dueño):
    [{"fecha": "18/09/2026", "placa": "TAW895", "tipo": "PROPIO|PUENTES|TM1", "cc": "3701.02.10",
      "remisiones": ["42931"] (opcional: solo esas filas, p. ej. si ese día tuvo dos programaciones),
      "nota": "media jornada" (opcional, informativa)}]
- Un viaje de ≤3 km que NO es de un día interno (un viaje suelto) no se paga como interno aunque la
  fórmula lo marque así por los km: va con «<área> - VIAJE CORTO ENTRE 3 KM A 5 KM» y se lista para que
  el dueño lo confirme.
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


CC_PUENTES = "3701.11.03"
INTERNO = "VIAJE INTERNO"
CORTO_3_5 = "VIAJE CORTO ENTRE 3 KM A 5 KM"
PREFIJO = {"PROPIO": "", "PUENTES": "PUENTES - ", "TM1": "TM1 - "}


def _tramo(km):
    """Tramo de un viaje que no es de día interno: ≤5 km (incluido ≤3, viaje suelto) 3 a 5, si no > 5."""
    if km is None:
        return "VIAJE CORTO MAYOR A 5KM"
    if km <= 5:
        return CORTO_3_5
    return "VIAJE CORTO MAYOR A 5KM"


def _km(f):
    """Km del viaje: el literal si viene, si no |fin − ini| / 1000 como la fórmula del acta."""
    kt = _num(f.get("kmTot"))
    ini, fin = _num(f.get("kmIni")), _num(f.get("kmFin"))
    if ini is not None and fin is not None:
        return abs(fin - ini) / 1000
    return kt


def _norm_fecha(v):
    return str(v or "").strip()


def _norm_placa(v):
    return str(v or "").replace(" ", "").replace("-", "").upper()


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
    ap.add_argument("--internos", help="días internos confirmados por el dueño (ver docstring)")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    area = {}
    if a.decisiones:
        for d in json.load(open(a.decisiones, encoding="utf-8")):
            if d.get("area"):
                area[str(d["remision"])] = d["area"]
    internos = json.load(open(a.internos, encoding="utf-8")) if a.internos else []
    # Las entradas con «remisiones» (dos programaciones el mismo día) casan antes que la genérica del día.
    internos.sort(key=lambda d: 0 if d.get("remisiones") else 1)
    genericas = {}
    for d in internos:
        k = (_norm_fecha(d.get("fecha")), _norm_placa(d.get("placa")))
        if not d.get("remisiones"):
            if k in genericas:
                print(f"⚠ {k[0]} {k[1]}: dos días internos sin «remisiones» para la misma placa y fecha; se usa el primero")
            genericas[k] = d

    def dia_interno(fila):
        for d in internos:
            if (_norm_fecha(d.get("fecha")) == fila["fecha"] and _norm_placa(d.get("placa")) == _norm_placa(fila["placa"])
                    and (not d.get("remisiones") or str(fila["remision"]) in {str(r) for r in d["remisiones"]})):
                return d
        return None

    filas = leer(a.bloque) + (leer(a.pendientes) if a.pendientes else [])
    salida, sueltos, usados = [], [], set()
    for f in filas:
        rem = str(f["remision"]).strip()
        fila = {
            "fecha": str(f["fecha"] or ""), "uf": f["uf"] or "", "actividad": f["actividad"] or "",
            "cc": str(f["cc"] or ""), "remision": int(rem) if rem.isdigit() else rem, "placa": f["placa"] or "",
            "kmIni": f["kmIni"], "kmFin": f["kmFin"], "m3": _num(f["m3"]), "unidad": f["unidad"] or "m3km",
        }
        if _num(f["kmIni"]) is None:
            fila["kmTot"] = _num(f["kmTot"])
        km = _km(f)
        d = dia_interno(fila)
        if d:
            usados.add(id(d))
            tipo = str(d.get("tipo") or "PROPIO").upper()
            if d.get("cc"):
                fila["cc"] = str(d["cc"])
            fila["obs"] = PREFIJO.get(tipo, "") + INTERNO
        elif area.get(rem) == "TM1":
            fila["obs"] = "TM1 - " + _tramo(km)
            if km is not None and km <= 3:
                sueltos.append(f"{fila['fecha']} {fila['placa']} {rem} ({km:.2f} km) → {fila['obs']}")
        elif km is not None and km <= 3:
            # viaje suelto de ≤3 km: la fórmula lo marcaría interno; se paga como corto 3 a 5 km
            fila["obs"] = ("PUENTES - " if fila["cc"] == CC_PUENTES else "") + CORTO_3_5
            sueltos.append(f"{fila['fecha']} {fila['placa']} {rem} ({km:.2f} km) → {fila['obs']}")
        salida.append(fila)

    # Un día interno debe quedar con un solo CC (si no se dio uno en internos.json, avisar)
    for d in internos:
        if id(d) not in usados:
            print(f"⚠ día interno sin filas en el acta: {d.get('fecha')} {d.get('placa')}")
        ccs = {x["cc"] for x in salida if dia_interno(x) is d}
        if len(ccs) > 1:
            print(f"⚠ {d.get('fecha')} {d.get('placa')}: el día interno tiene varios CC {sorted(ccs)} — pon 'cc' en internos.json")
    json.dump(salida, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    n_int = sum(1 for x in salida if str(x.get("obs", "")).endswith(INTERNO))
    print(f"{len(salida)} filas -> {a.out} (obs literal: {sum(1 for x in salida if 'obs' in x)}, de días internos: {n_int}, "
          f"km literal: {sum(1 for x in salida if 'kmTot' in x)})")
    if sueltos:
        print(f"Viajes sueltos de ≤3 km (no son día interno; van como corto 3 a 5 km — confírmalo con el dueño): {len(sueltos)}")
        for s in sueltos:
            print("  " + s)
    return 0


if __name__ == "__main__":
    sys.exit(main())
