"""tm2-conciliador · soportes.py

Renderiza páginas de PDF escaneado a PNG (para que Claude lea los recibos
"ORTIZ RECIBO DE TRANSPORTE DE MATERIAL") y cruza las lecturas resultantes
(JSON hecho por Claude, ver ../references/lectura_recibos.md) con los
reclamos NO_ENCONTRADA / ENCONTRADA de una sesión conciliador_sesion_*.json.

Requiere PyMuPDF: PYTHONPATH=<tmp>/py (import pymupdf).

Subcomandos:
  soportes.py render --pdf A.pdf [--pdf B.pdf] --out DIR [--dpi 110]
  soportes.py cruzar --lecturas lecturas.json --sesion conciliador_sesion_*.json [--proforma-campos]
  soportes.py paginas-candidatas --ocr sesion_de_la_pagina.json --sesion conciliador_sesion_*.json [--vecinas 1]
  soportes.py pdf-pendientes --sesion conciliador_sesion_*.json --pdf-dir DIR [--pdf-dir DIR2] --out digitadora.pdf

No escribe nunca sobre los PDF ni la sesión de origen; todo va a --out o a
stdout.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# render
# ---------------------------------------------------------------------------

def _slug(nombre: str) -> str:
    base = Path(nombre).stem
    base = re.sub(r"\s+", "_", base.strip())
    base = re.sub(r"[^A-Za-z0-9_\-]", "", base)
    return base or "pdf"


def cmd_render(args: argparse.Namespace) -> int:
    import pymupdf  # type: ignore

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    dpi = args.dpi
    zoom = dpi / 72.0
    matriz = pymupdf.Matrix(zoom, zoom)

    indice: list[dict] = []
    for pdf_path_str in args.pdf:
        pdf_path = Path(pdf_path_str)
        slug = _slug(pdf_path.name)
        doc = pymupdf.open(pdf_path)
        try:
            for i in range(len(doc)):
                pagina = i + 1
                pix = doc[i].get_pixmap(matrix=matriz)
                nombre_png = f"{slug}__p{pagina:03d}.png"
                ruta_png = out_dir / nombre_png
                pix.save(ruta_png)
                indice.append({
                    "archivo": pdf_path.name,
                    "pagina": pagina,
                    "png": str(ruta_png),
                })
        finally:
            doc.close()

    with open(out_dir / "indice.json", "w", encoding="utf-8") as f:
        json.dump(indice, f, ensure_ascii=False, indent=2)

    print(f"Renderizadas {len(indice)} páginas en {out_dir} (dpi={dpi}).")
    print(f"Índice: {out_dir / 'indice.json'}")
    return 0


# ---------------------------------------------------------------------------
# cruzar
# ---------------------------------------------------------------------------

def _normaliza_placa(p) -> str:
    if not p:
        return ""
    return re.sub(r"[^A-Z0-9]", "", str(p).upper())


def _num_recibo(s) -> str:
    if s is None:
        return ""
    return re.sub(r"\D", "", str(s))


def _materiales_compatibles(a: str, b: str) -> bool:
    """Compatibilidad laxa: mismas siglas/palabras en común o vacíos."""
    if not a or not b:
        return True
    import unicodedata
    sin_tildes = lambda t: "".join(c for c in unicodedata.normalize("NFD", str(t)) if unicodedata.category(c) != "Mn")
    na = re.sub(r"[^A-Z0-9]", " ", sin_tildes(a).upper())   # «terraplén» = «TERRAPLEN»
    nb = re.sub(r"[^A-Z0-9]", " ", sin_tildes(b).upper())
    ta = set(na.split())
    tb = set(nb.split())
    if not ta or not tb:
        return True
    return bool(ta & tb)


def _fecha_iso(s):
    if not s:
        return None
    s = str(s).strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.match(r"^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$", s)
    if m:
        d, mo, y = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    return s


def _placas_parecidas(a: str, b: str) -> bool:
    """Misma placa admitiendo UN carácter mal leído (letra a mano: TAW895/THW895, SSZ126/SS2126)."""
    if not a or not b:
        return False
    if a == b:
        return True
    if len(a) == len(b):
        return sum(1 for x, y in zip(a, b) if x != y) <= 1
    if abs(len(a) - len(b)) == 1:  # un carácter de más o de menos
        corto, largo = (a, b) if len(a) < len(b) else (b, a)
        return any(largo[:i] + largo[i + 1:] == corto for i in range(len(largo)))
    return False


def _dias_entre(a, b):
    try:
        from datetime import date
        return abs((date.fromisoformat(a) - date.fromisoformat(b)).days)
    except (TypeError, ValueError):
        return None


def _calidad(item: dict, sec: dict, lec: dict) -> tuple[str, int]:
    """El mismo número de recibo se repite en talonarios de otros viajes/contratistas: el número solo no
    basta. CONFIRMADO = número + placa (±1 carácter) + fecha (±1 día); PROBABLE = número + una de las dos
    (o ninguna contradice); DESCARTADO = mismo número pero placa Y fecha no casan (otro viaje)."""
    placa_ok = _placas_parecidas(_normaliza_placa(sec.get("placa")), _normaliza_placa(lec.get("placa")))
    d = _dias_entre(_fecha_iso(sec.get("fecha")), _fecha_iso(lec.get("fecha")))
    fecha_ok = d is not None and d <= 1
    puntos = (2 if placa_ok else 0) + (2 if fecha_ok else 0) + (1 if item["tipo_match"] == "exacta" else 0)
    if placa_ok and fecha_ok:
        return "CONFIRMADO", puntos
    if placa_ok or fecha_ok:
        return "PROBABLE", puntos
    return "DESCARTADO", puntos


def cmd_cruzar(args: argparse.Namespace) -> int:
    with open(args.lecturas, encoding="utf-8") as f:
        lecturas = json.load(f)
    with open(args.sesion, encoding="utf-8") as f:
        sesion = json.load(f)

    reclamos = sesion.get("corte", {}).get("reclamos", [])

    # Índice de lecturas por número de recibo exacto.
    por_recibo: dict[str, list[dict]] = {}
    for lec in lecturas:
        n = _num_recibo(lec.get("recibo_n"))
        if not n:
            continue
        por_recibo.setdefault(n, []).append(lec)

    objetivo = [
        r for r in reclamos
        if r.get("estado") in ("NO_ENCONTRADA", "ENCONTRADA", "PENDIENTE_DIGITACION")
    ]

    resultados = []
    for r in objetivo:
        rem = _num_recibo(r.get("remision") or r.get("remSC") or r.get("raw"))
        if not rem:
            continue

        coincidencias = por_recibo.get(rem, [])
        candidato_tipo = "exacta" if coincidencias else None

        if not coincidencias:
            # ±1 dígito como candidato naranja (mismo criterio que la herramienta).
            for n, lecs in por_recibo.items():
                if len(n) == len(rem):
                    difs = sum(1 for a, b in zip(n, rem) if a != b)
                    if difs == 1:
                        coincidencias.extend(lecs)
                        candidato_tipo = "aproximada(+/-1 digito)"

        if not coincidencias:
            continue

        sec = r.get("secundarios") or {}
        discrepancias = []

        for lec in coincidencias:
            item = {
                "reclamo_id": r.get("id"),
                "remision": r.get("remision"),
                "estado_previo": r.get("estado"),
                "tipo_match": candidato_tipo,
                "encontrado": {"archivo": lec.get("archivo"), "pagina": lec.get("pagina")},
                "lectura": lec,
                "discrepancias": [],
            }

            placa_prof = _normaliza_placa(sec.get("placa"))
            placa_lec = _normaliza_placa(lec.get("placa"))
            if placa_prof and placa_lec and placa_prof != placa_lec:
                # Un solo carácter distinto suele ser letra a mano mal leída (SSZ126/SS2126): informativo.
                parecida = _placas_parecidas(placa_prof, placa_lec)
                item["discrepancias"].append({
                    "campo": "placa_dudosa" if parecida else "placa",
                    "proforma": sec.get("placa"),
                    "recibo": lec.get("placa"),
                    **({"informativo": True} if parecida else {}),
                })

            fecha_prof = _fecha_iso(sec.get("fecha"))
            fecha_lec = _fecha_iso(lec.get("fecha"))
            if fecha_prof and fecha_lec and fecha_prof != fecha_lec:
                item["discrepancias"].append({
                    "campo": "fecha",
                    "proforma": sec.get("fecha"),
                    "recibo": lec.get("fecha"),
                })

            try:
                cant_prof = float(str(sec.get("cantidad", "")).replace(",", "."))
            except (TypeError, ValueError):
                cant_prof = None
            try:
                cant_lec = float(str(lec.get("cantidad_m3", "")).replace(",", "."))
            except (TypeError, ValueError):
                cant_lec = None

            viajes = lec.get("viajes")
            cant_propuesta = None
            if isinstance(viajes, int) and viajes and viajes > 1 and cant_lec is not None:
                cant_propuesta = round(cant_lec * viajes, 2)
                item["discrepancias"].append({
                    "campo": "viajes",
                    "viajes": viajes,
                    "m3_recibo": cant_lec,
                    "propuesta_m3_total": cant_propuesta,
                    "nota": "observaciones indican varios viajes; multiplicar m3 x viajes",
                })

            cant_comparar = cant_propuesta if cant_propuesta is not None else cant_lec
            if cant_prof is not None and cant_comparar is not None:
                if abs(cant_prof - cant_comparar) > 0.05:
                    item["discrepancias"].append({
                        "campo": "cantidad_m3",
                        "proforma": cant_prof,
                        "recibo": cant_comparar,
                    })

            mat_prof = sec.get("material")
            mat_lec = lec.get("material")
            if not _materiales_compatibles(mat_prof, mat_lec):
                # La proforma y el recibo nombran el material con palabras distintas («corte terraplén» vs
                # «VIAJES- MATERIAL TERRAPLEN»): se muestra, pero no cuenta como discrepancia a revisar.
                item["discrepancias"].append({
                    "campo": "material",
                    "proforma": mat_prof,
                    "recibo": mat_lec,
                    # En un viaje SIN base el material del recibo sí decide (CC, ítem): se pregunta.
                    **({} if r.get("estado") == "NO_ENCONTRADA" else {"informativo": True}),
                })

            cond_lec = lec.get("conductor")
            if cond_lec:
                item["discrepancias"].append({
                    "campo": "conductor",
                    "informativo": True,
                    "recibo": cond_lec,
                })

            item["calidad"], item["puntos"] = _calidad(item, sec, lec)
            discrepancias.extend(item["discrepancias"])
            resultados.append(item)

    # Por reclamo, la MEJOR evidencia (la de más puntos); las demás lecturas del mismo número quedan
    # como alternativas (a menudo el mismo recibo fotocopiado en los dos PDF, o un recibo de otro viaje).
    mejores: dict[str, dict] = {}
    for x in resultados:
        k = x["reclamo_id"]
        if k not in mejores or x["puntos"] > mejores[k]["puntos"]:
            mejores[k] = x
    for x in resultados:
        x["elegido"] = mejores.get(x["reclamo_id"]) is x

    resumen_lineas = []
    resumen_lineas.append(f"Lecturas: {len(lecturas)} recibos en {len(por_recibo)} números distintos.")
    no_enc = [r for r in objetivo if r.get("estado") == "NO_ENCONTRADA"]
    for est_nombre, lista in (("NO_ENCONTRADA", no_enc),):
        conf = [m for m in mejores.values() if m["estado_previo"] == est_nombre and m["calidad"] == "CONFIRMADO"]
        prob = [m for m in mejores.values() if m["estado_previo"] == est_nombre and m["calidad"] == "PROBABLE"]
        desc = [m for m in mejores.values() if m["estado_previo"] == est_nombre and m["calidad"] == "DESCARTADO"]
        resumen_lineas.append(
            f"{est_nombre}: {len(lista)} · soporte CONFIRMADO {len(conf)} · PROBABLE {len(prob)} · "
            f"solo número repetido (otro viaje) {len(desc)} · sin soporte {len(lista) - len(conf) - len(prob) - len(desc)}")
        for m in sorted(conf + prob, key=lambda z: (z["calidad"], z["remision"])):
            campos = ", ".join(d["campo"] for d in m["discrepancias"] if not d.get("informativo"))
            resumen_lineas.append(
                f"  - {m['calidad']:<10} {m['remision']} → {m['encontrado']['archivo']} p.{m['encontrado']['pagina']}"
                + (f" · revisar: {campos}" if campos else ""))
    # En las ya ENCONTRADAS manda la base (se paga con sus datos): la cantidad escrita a mano o una fecha a
    # ±1 día no cambian nada. Solo se avisa si el recibo dice VARIOS viajes (hay que multiplicar).
    # (La placa distinta no aplica aquí: si casó con placa distinta, _calidad ya no la da por CONFIRMADA.)
    CLAVE_ENC = {"viajes"}
    enc_disc = [m for m in mejores.values() if m["estado_previo"] != "NO_ENCONTRADA" and m["calidad"] == "CONFIRMADO"
                and any(d["campo"] in CLAVE_ENC for d in m["discrepancias"])]
    resumen_lineas.append(f"Encontradas en base cuyo recibo indica varios viajes: {len(enc_disc)}")
    for m in enc_disc:
        campos = ", ".join(d["campo"] for d in m["discrepancias"] if d["campo"] in CLAVE_ENC)
        resumen_lineas.append(f"  - {m['remision']} ({m['estado_previo']}) p.{m['encontrado']['pagina']}: {campos}")

    salida = {
        "generado_por": "soportes.py cruzar",
        "resultados": resultados,
        "resumen": resumen_lineas,
    }

    print(json.dumps(salida, ensure_ascii=False, indent=2))
    print("\n--- resumen ---", file=sys.stderr)
    for l in resumen_lineas:
        print(l, file=sys.stderr)

    return 0


# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# pdf-pendientes (lo mismo que Exportes.pdfPendientes() de la herramienta, fuera del navegador)
# ---------------------------------------------------------------------------

def _clave_rem(rem):
    """cmpRemision de la herramienta: numérico si ambos son números, si no texto."""
    r = str(rem or "")
    return (0, int(r), "") if r.isdigit() else (1, 0, r)


def cmd_pdf_pendientes(args: argparse.Namespace) -> int:
    """PDF para la digitadora: una página por comprobante de cada PENDIENTE_DIGITACION con evidencia,
    en el MISMO orden que su Excel (fecha de la proforma y luego remisión), sin repetir páginas."""
    import pymupdf  # PyMuPDF
    with open(args.sesion, encoding="utf-8") as f:
        sesion = json.load(f)
    pend = [r for r in sesion.get("corte", {}).get("reclamos", [])
            if r.get("estado") == "PENDIENTE_DIGITACION" and r.get("evidencia")]
    pend.sort(key=lambda r: (((r.get("secundarios") or {}).get("fecha")) or "9999-99-99", _clave_rem(r.get("remision"))))
    if not pend:
        print("No hay pendientes con comprobante confirmado.")
        return 1
    dirs = [Path(d) for d in args.pdf_dir]
    orden, vistos = [], set()
    for r in pend:
        ev = r["evidencia"]
        k = (ev["archivo"], int(ev["pagina"]))
        if k not in vistos:
            vistos.add(k)
            orden.append(k)
    out = pymupdf.open()
    abiertos, fallos = {}, []
    try:
        for archivo, pagina in orden:
            if archivo not in abiertos:
                ruta = next((d / archivo for d in dirs if (d / archivo).exists()), None)
                abiertos[archivo] = pymupdf.open(str(ruta)) if ruta else None
            src = abiertos[archivo]
            if src is None or not (1 <= pagina <= src.page_count):
                fallos.append(f"{archivo} p.{pagina}")
                continue
            out.insert_pdf(src, from_page=pagina - 1, to_page=pagina - 1)
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        out.save(args.out, garbage=3, deflate=True)
    finally:
        out.close()
        for d in abiertos.values():
            if d is not None:
                d.close()
    print(f"PDF digitadora: {len(orden) - len(fallos)} páginas para {len(pend)} pendientes -> {args.out}")
    for x in fallos:
        print(f"  ⚠ no se pudo copiar {x} (¿está el PDF en --pdf-dir?)")
    return 0 if not fallos else 1


# ---------------------------------------------------------------------------
# paginas-candidatas (primera pasada barata: reutiliza el OCR de números de la página del conciliador)
# ---------------------------------------------------------------------------

def cmd_paginas_candidatas(args: argparse.Namespace) -> int:
    """Con la sesión que exporta la herramienta tras su Paso 5 (ocr.paginas = números leídos por
    tesseract en cada página), lista las páginas donde aparece alguna remisión NO_ENCONTRADA de la sesión
    del skill, más ±N páginas vecinas (los talonarios van seguidos). Solo esas se leen a fondo con visión:
    en el caso de prueba bajó de 162 páginas a ~10. Sin sesión con OCR, se leen todas."""
    ocr = json.load(open(args.ocr, encoding="utf-8")).get("ocr", {}).get("paginas", {})
    ses = json.load(open(args.sesion, encoding="utf-8"))
    buscar = {_num_recibo(r.get("remision")) for r in ses.get("corte", {}).get("reclamos", [])
              if r.get("estado") == "NO_ENCONTRADA"}
    buscar.discard("")
    if args.solo:   # p. ej. solo las que WhatsApp mandó al acta o dejó en duda (las de UF3/asfaltos no necesitan soporte)
        solo = {_num_recibo(x) for x in (open(args.solo, encoding="utf-8").read() if Path(args.solo).exists() else args.solo).replace(",", " ").split()}
        buscar &= solo
    hits: dict[str, set] = {}
    for clave, toks in ocr.items():
        archivo, _, pag = clave.rpartition("#")
        nums = set(re.findall(r"\d{3,6}", json.dumps(toks)))
        for rem in buscar & nums:
            hits.setdefault(archivo, set()).add(int(pag))
    salida = {}
    for archivo, pags in hits.items():
        todas = set()
        for p in pags:
            todas.update(range(max(1, p - args.vecinas), p + args.vecinas + 1))
        salida[archivo] = sorted(todas)
    encontradas = {rem for rem in buscar if any(rem in set(re.findall(r"\d{3,6}", json.dumps(v))) for v in ocr.values())}
    print(json.dumps({"paginas": salida, "remisiones_con_ocr": sorted(encontradas),
                      "remisiones_sin_ocr": sorted(buscar - encontradas)}, ensure_ascii=False, indent=1))
    print(f"{sum(len(v) for v in salida.values())} páginas a leer a fondo; {len(buscar - encontradas)} "
          f"remisiones sin rastro en el OCR (buscarlas leyendo las vecinas o todo el PDF).", file=sys.stderr)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="comando", required=True)

    p_render = sub.add_parser("render", help="PDF -> PNG por página + indice.json")
    p_render.add_argument("--pdf", action="append", required=True, dest="pdf")
    p_render.add_argument("--out", required=True)
    p_render.add_argument("--dpi", type=int, default=110)
    p_render.set_defaults(func=cmd_render)

    p_cruzar = sub.add_parser("cruzar", help="Cruza lecturas de recibos con la sesión")
    p_cruzar.add_argument("--lecturas", required=True)
    p_cruzar.add_argument("--sesion", required=True)
    p_cruzar.add_argument("--proforma-campos", action="store_true", dest="proforma_campos")
    p_cruzar.set_defaults(func=cmd_cruzar)

    p_cand = sub.add_parser("paginas-candidatas", help="Páginas a leer a fondo según el OCR de la herramienta")
    p_cand.add_argument("--ocr", required=True, help="sesión exportada por la herramienta tras su Paso 5 (con ocr.paginas)")
    p_cand.add_argument("--sesion", required=True, help="sesión del skill (conciliar.js) con los NO_ENCONTRADA")
    p_cand.add_argument("--vecinas", type=int, default=1)
    p_cand.add_argument("--solo", help="remisiones a buscar (lista separada por comas o archivo de texto)")
    p_cand.set_defaults(func=cmd_paginas_candidatas)

    p_pdf = sub.add_parser("pdf-pendientes", help="PDF de comprobantes para la digitadora (orden fecha→remisión)")
    p_pdf.add_argument("--sesion", required=True, help="sesión con los PENDIENTE_DIGITACION y su evidencia")
    p_pdf.add_argument("--pdf-dir", action="append", required=True, help="carpeta con los PDF de soportes (repetible)")
    p_pdf.add_argument("--out", required=True)
    p_pdf.set_defaults(func=cmd_pdf_pendientes)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
