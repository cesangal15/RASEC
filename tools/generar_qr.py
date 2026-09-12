#!/usr/bin/env python3
"""
generar_qr.py — Códigos QR y etiquetas para el Parte Digital de Maquinaria (V3-01 / D165).

Cada equipo activo recibe un QR con la URL de SU formulario:
    <URL_BASE>/parte.html?eq=<codigo>
El QR es solo esa URL codificada en imagen: el teléfono la abre con la cámara. No hace falta
cuenta, servicio ni impresora especial. El personal rota; el equipo no — por eso la identidad
la da la máquina (principio 1 del módulo).

Salida (carpeta `qr/`, se crea si no existe):
    qr/<codigo>.png      — un PNG por equipo activo
    qr/etiquetas.pdf     — hoja carta con etiquetas de 7×7 cm (2×3 por página): QR, el código en
                           grande, tipo y placa; fondo blanco, borde negro grueso. Van impresas en
                           adhesivo y pegadas en la cabina: deben leerse con mugre, por eso el QR
                           lleva corrección de errores ALTA (30 %) y margen generoso.

Uso:
    pip install "qrcode[pil]" reportlab
    python3 tools/generar_qr.py                        # lee backend/seeds/parte/PARTE_EQUIPOS_semilla.csv
    python3 tools/generar_qr.py --csv PARTE_EQUIPOS.csv --salida qr --solo VOL048,CR026,EXC015
    python3 tools/generar_qr.py --url-base https://usuario.github.io/repo

Fuente de equipos: el CSV semilla o la hoja PARTE_EQUIPOS exportada como CSV (Archivo → Descargar →
CSV). Solo se generan los de `activo = SI` (columna `activo`; vacía cuenta como activo).
"""
import argparse
import csv
import os
import sys

# ---------------------------------------------------------------------------
# URL BASE — la confirma el usuario. Es la de GitHub Pages del repo (sin barra final).
# ---------------------------------------------------------------------------
URL_BASE = "https://cesangal15.github.io/Ortiz-tm2-sur"

CSV_DEFECTO = os.path.join(os.path.dirname(__file__), "..", "backend", "seeds", "parte", "PARTE_EQUIPOS_semilla.csv")
SALIDA_DEFECTO = os.path.join(os.path.dirname(__file__), "..", "qr")

try:
    import qrcode
    from qrcode.constants import ERROR_CORRECT_H
except ImportError:  # pragma: no cover
    sys.exit("Falta `qrcode`. Instala con:  pip install \"qrcode[pil]\" reportlab")
try:
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import cm
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
except ImportError:  # pragma: no cover
    sys.exit("Falta `reportlab`. Instala con:  pip install \"qrcode[pil]\" reportlab")


def es_si(v):
    s = (v or "").strip().upper()
    return s not in ("NO", "N", "FALSE", "0", "INACTIVO", "INACTIVA")


def leer_equipos(ruta, solo=None):
    """Lee el CSV por NOMBRE de columna (mismo criterio que el backend): codigo, tipo, placa, activo."""
    with open(ruta, newline="", encoding="utf-8-sig") as f:
        filas = list(csv.DictReader(f))
    out = []
    for r in filas:
        cod = (r.get("codigo") or "").strip()
        if not cod or not es_si(r.get("activo")):
            continue
        if solo and cod.upper() not in solo:
            continue
        out.append({
            "codigo": cod,
            "tipo": (r.get("tipo") or "").strip(),
            "placa": (r.get("placa") or "").strip(),
            "medidor": (r.get("medidor") or "").strip(),
        })
    out.sort(key=lambda q: q["codigo"])
    return out


def url_de(base, codigo):
    return f"{base.rstrip('/')}/parte.html?eq={codigo}"


def generar_png(url, ruta):
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, box_size=10, border=4)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    img.save(ruta)


def fuente_syne():
    """Syne bold si está instalada (o en ./tools/fonts/); si no, Helvetica-Bold. El código debe verse
    igual de grande y legible con cualquiera de las dos."""
    candidatos = [
        os.path.join(os.path.dirname(__file__), "fonts", "Syne-Bold.ttf"),
        os.path.join(os.path.dirname(__file__), "fonts", "Syne-ExtraBold.ttf"),
        "/usr/share/fonts/truetype/syne/Syne-Bold.ttf",
    ]
    for c in candidatos:
        if os.path.exists(c):
            try:
                pdfmetrics.registerFont(TTFont("Syne-Bold", c))
                return "Syne-Bold"
            except Exception:
                pass
    return "Helvetica-Bold"


def generar_pdf(equipos, carpeta, ruta_pdf, url_base):
    """Hoja carta, etiquetas de 7×7 cm en rejilla 2×3, borde negro de 1,2 mm, fondo blanco."""
    ancho_pag, alto_pag = letter
    lado = 7 * cm
    cols, filas_pag = 2, 3
    sep = 0.8 * cm
    ancho_bloque = cols * lado + (cols - 1) * sep
    alto_bloque = filas_pag * lado + (filas_pag - 1) * sep
    x0 = (ancho_pag - ancho_bloque) / 2
    y0 = (alto_pag - alto_bloque) / 2
    fuente = fuente_syne()

    c = canvas.Canvas(ruta_pdf, pagesize=letter)
    c.setTitle("Etiquetas QR — Parte Digital de Maquinaria")
    por_pagina = cols * filas_pag
    for i, q in enumerate(equipos):
        if i and i % por_pagina == 0:
            c.showPage()
        k = i % por_pagina
        col, fila = k % cols, k // cols
        x = x0 + col * (lado + sep)
        y = y0 + (filas_pag - 1 - fila) * (lado + sep)

        # marco
        c.setFillColorRGB(1, 1, 1)
        c.setStrokeColorRGB(0, 0, 0)
        c.setLineWidth(3.4)  # ≈1,2 mm
        c.roundRect(x, y, lado, lado, 0.3 * cm, stroke=1, fill=1)

        # QR (arriba, centrado)
        png = os.path.join(carpeta, f"{q['codigo']}.png")
        qr_lado = 4.3 * cm
        c.drawImage(png, x + (lado - qr_lado) / 2, y + lado - qr_lado - 0.35 * cm, qr_lado, qr_lado)

        # código en grande
        c.setFillColorRGB(0, 0, 0)
        tam = 26
        while tam > 12 and c.stringWidth(q["codigo"], fuente, tam) > lado - 0.8 * cm:
            tam -= 2
        c.setFont(fuente, tam)
        c.drawCentredString(x + lado / 2, y + 1.35 * cm, q["codigo"])

        # tipo y placa
        c.setFont("Helvetica", 8)
        tipo = q["tipo"][:38]
        c.drawCentredString(x + lado / 2, y + 0.85 * cm, tipo)
        sub = " · ".join(v for v in (q["placa"], q["medidor"]) if v and v.upper() not in ("N/A", "PENDIENTE", "REVISAR"))
        c.setFont("Helvetica", 7)
        c.drawCentredString(x + lado / 2, y + 0.45 * cm, sub or "Parte digital de maquinaria")
    c.save()


def main():
    ap = argparse.ArgumentParser(description="Genera QR y etiquetas del Parte Digital de Maquinaria.")
    ap.add_argument("--csv", default=CSV_DEFECTO, help="CSV con las columnas codigo,tipo,placa,activo (semilla u hoja PARTE_EQUIPOS exportada)")
    ap.add_argument("--salida", default=SALIDA_DEFECTO, help="carpeta de salida (default: qr/)")
    ap.add_argument("--url-base", default=URL_BASE, help="URL base de GitHub Pages, sin barra final")
    ap.add_argument("--solo", default="", help="códigos separados por coma para generar solo esos (p. ej. VOL048,CR026)")
    args = ap.parse_args()

    solo = {s.strip().upper() for s in args.solo.split(",") if s.strip()} or None
    equipos = leer_equipos(args.csv, solo)
    if not equipos:
        sys.exit("No hay equipos activos que generar (revisa el CSV o --solo).")
    os.makedirs(args.salida, exist_ok=True)
    for q in equipos:
        generar_png(url_de(args.url_base, q["codigo"]), os.path.join(args.salida, f"{q['codigo']}.png"))
    pdf = os.path.join(args.salida, "etiquetas.pdf")
    generar_pdf(equipos, args.salida, pdf, args.url_base)
    print(f"{len(equipos)} QR en {os.path.abspath(args.salida)}  ·  etiquetas: {os.path.abspath(pdf)}")
    for q in equipos:
        print(f"  {q['codigo']:<8} {url_de(args.url_base, q['codigo'])}")


if __name__ == "__main__":
    main()
