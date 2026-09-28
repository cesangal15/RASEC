"""tm2-conciliador · ya_pagadas.py

Busca en el libro de actas del contratista (hoja CORTOS-INTERNOS-PUTANA, solo lectura) las remisiones que
la proforma vuelve a cobrar: mismo número de remisión, misma placa y fecha a ±3 días (la numeración de
tiquetes de Putana se repite con los años, así que el número solo no basta; si coinciden número y placa
con otra fecha, se lista como informativo). Lo que salga va a preguntas.md; si el dueño
confirma que ya se pagó, la decisión es RECHAZADA «ya pagado en <Acta No.>».

  python ya_pagadas.py --libro <copia del libro de actas en bases/> --sesion 01_cruce/conciliador_sesion_*.json

Caso real (Asotrasaat 2.ª Q sep-2026): 8655 y 8689 (SSZ126, 27/08) ya pagados en «Memoria 6 UF2»; la
proforma de la 1.ª Q los traía dos veces (triturado y subbase) y la 2.ª Q volvió a cobrar uno de cada par.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys

import openpyxl


def _rem(v):
    s = str(v if v is not None else "").strip()
    if s.endswith(".0"):
        s = s[:-2]
    return s.lstrip("0")


def _placa(v):
    return str(v or "").replace(" ", "").replace("-", "").upper()


def _fecha(v):
    """Fecha del libro (datetime o «dd/mm/aaaa») o de la sesión («aaaa-mm-dd») → date, o None."""
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    s = str(v or "").strip()[:10]
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


MARGEN_DIAS = 3   # la proforma a veces trae la fecha corrida; más allá es numeración reutilizada


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--libro", required=True)
    ap.add_argument("--sesion", required=True)
    ap.add_argument("--hoja", default="CORTOS-INTERNOS-PUTANA")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    reclamos = json.load(open(a.sesion, encoding="utf-8"))["corte"]["reclamos"]
    buscados = {}
    for r in reclamos:
        buscados.setdefault(_rem(r["remision"]), []).append(r)

    ws = openpyxl.load_workbook(a.libro, read_only=True, data_only=True)[a.hoja]
    cab, hallados = None, []
    for i, fila in enumerate(ws.iter_rows(values_only=True), 1):
        if cab is None:
            textos = [str(v or "").strip().lower() for v in fila]
            if "remisión" in textos or "remision" in textos:
                cab = {t: j for j, t in enumerate(textos)}
                c_rem = cab.get("remisión", cab.get("remision"))
                c_pla = next((j for t, j in cab.items() if t.startswith(("código equipo", "codigo equipo", "placa"))), None)
                if c_pla is None:
                    print(f"✗ La hoja {a.hoja} no tiene columna de placa («Código equipo o Placa»).")
                    return 2
                c_acta = cab.get("acta no.")
                c_fec = cab.get("fecha")
            continue
        rem = _rem(fila[c_rem])
        if rem not in buscados:
            continue
        for r in buscados[rem]:
            if _placa(fila[c_pla]) == _placa((r.get("secundarios") or {}).get("placa")):
                hallados.append((r, i, fila[c_acta] if c_acta is not None else "", _fecha(fila[c_fec]) if c_fec is not None else ""))
    if cab is None:
        print(f"✗ No encontré la cabecera (Remisión) en la hoja {a.hoja}.")
        return 2

    pagadas, reutilizadas = [], []
    for h in hallados:
        f_prof, f_libro = _fecha((h[0].get("secundarios") or {}).get("fecha")), h[3]
        cerca = f_prof is None or f_libro is None or abs((f_prof - f_libro).days) <= MARGEN_DIAS
        (pagadas if cerca else reutilizadas).append(h)

    def linea(h):
        r, fila, acta, fecha = h
        s = r.get("secundarios") or {}
        return (f"  - {r['remision']} {s.get('placa')} {s.get('fecha')} ({r['estado']}): fila {fila} del libro, "
                f"{acta or 'sin Acta No.'}, fecha {fecha.strftime('%d/%m/%Y') if fecha else '?'}")

    if not pagadas:
        print("Ninguna remisión de la proforma está ya pagada en el libro de actas (misma remisión, placa y fecha).")
    else:
        print(f"⚠ {len(pagadas)} remisión(es) de la proforma YA están pagadas en el libro de actas → preguntas.md:")
        for h in pagadas:
            print(linea(h))
    if reutilizadas:
        print(f"(informativo) {len(reutilizadas)} con el mismo número y placa pero otra fecha (numeración reutilizada):")
        for h in reutilizadas:
            print(linea(h))
    return 0


if __name__ == "__main__":
    sys.exit(main())
