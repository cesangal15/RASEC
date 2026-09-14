#!/usr/bin/env python3
"""
generar_qr.py — Códigos QR, etiquetas y listado para el Parte Digital de Maquinaria (V3-01 / D165).

Cada equipo activo recibe un QR con la URL de SU formulario:
    https://tm2.galca.app/parte.html?eq=<codigo>
El QR es solo esa URL codificada en imagen: el teléfono la abre con la cámara. No hace falta
cuenta, servicio ni impresora especial. El personal rota; el equipo no — por eso la identidad
la da la máquina (principio 1 del módulo). `parte.html` lee el parámetro `eq` tal cual y el
backend lo normaliza (mayúsculas/minúsculas y guiones no importan: `rt-02` = `RT-02`).

FUENTE DE VERDAD DE LOS EQUIPOS: la hoja `PARTE_EQUIPOS` del Google Sheet de obra. Por defecto
este script lee la semilla del repo (`backend/seeds/parte/PARTE_EQUIPOS_semilla.csv`), que es
una foto de esa hoja. Cuando el usuario haya cambiado `activo` (o dado de alta un equipo) en el
Sheet, exporta la hoja (Archivo → Descargar → Valores separados por comas) y la pasa con `--csv`.

Qué entra: filas con `activo = SI` (vacío también cuenta como activo, igual que el backend) que
tengan `codigo` y `tipo`. Quedan fuera: `activo = NO`, códigos vacíos / `#N/A` / `None`, y las
placas sueltas sin `tipo` (p. ej. GQW139, SJQ401, TAR538 en la semilla): hasta que el usuario
les ponga tipo en `PARTE_EQUIPOS` no se les imprime QR.

Salida (carpeta `qr/`, se crea si no existe):
    qr/<codigo>.png      — un PNG por equipo activo (corrección de errores H = 30 %, ≥ 600 px)
    qr/etiquetas.pdf     — hoja carta, etiquetas de 7×7 cm, 6 por hoja (2×3), líneas de corte
                           punteadas, marco negro de 1 mm, fondo blanco. Dentro: QR (4,5 cm),
                           código en grande, tipo y placa en gris, y al pie la URL y la leyenda
                           «Escanea para reportar tu parte». Sin logo ni color: etiqueta de campo.
    qr/LISTADO.md        — inventario: código · tipo · placa · medidor · URL · PNG (por tipo y código)

Uso:
    pip install "qrcode[pil]" reportlab
    python3 tools/generar_qr.py                          # semilla del repo → qr/
    python3 tools/generar_qr.py --csv PARTE_EQUIPOS.csv  # hoja exportada del Sheet
    python3 tools/generar_qr.py --solo VOL048,CR026      # solo esos códigos (p. ej. un equipo nuevo)
    python3 tools/generar_qr.py --url-base https://tm2.galca.app
"""
import argparse
import csv
import os
import sys

# ---------------------------------------------------------------------------
# URL BASE — confirmada por el usuario (sep-2026): dominio propio del sitio, sin barra final.
# ---------------------------------------------------------------------------
URL_BASE = "https://tm2.galca.app"
RUTA_PARTE = "parte.html?eq="
LEYENDA = "Escanea para reportar tu parte"

AQUI = os.path.dirname(os.path.abspath(__file__))
CSV_DEFECTO = os.path.join(AQUI, "..", "backend", "seeds", "parte", "PARTE_EQUIPOS_semilla.csv")
SALIDA_DEFECTO = os.path.join(AQUI, "..", "qr")
CODIGOS_INVALIDOS = {"", "#N/A", "N/A", "NONE", "NULL", "#REF!"}

try:
    import qrcode
    from qrcode.constants import ERROR_CORRECT_H
except ImportError:  # pragma: no cover
    sys.exit("Falta `qrcode`. Instala con:  pip install \"qrcode[pil]\" reportlab")
try:
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import cm, mm
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
except ImportError:  # pragma: no cover
    sys.exit("Falta `reportlab`. Instala con:  pip install \"qrcode[pil]\" reportlab")


def es_si(v):
    """`activo`: vacío cuenta como activo (mismo criterio que CodigoParte.gs / parteSiNo_)."""
    s = (v or "").strip().upper()
    return s not in ("NO", "N", "FALSE", "0", "INACTIVO", "INACTIVA")


def limpio(v):
    s = (v or "").strip()
    return "" if s.upper() in CODIGOS_INVALIDOS else s


def leer_equipos(ruta, solo=None):
    """Lee el CSV por NOMBRE de columna (mismo criterio que el backend): codigo, tipo, placa, medidor, activo.
    Devuelve (equipos, excluidos) — los excluidos se listan para que no pasen desapercibidos."""
    with open(ruta, newline="", encoding="utf-8-sig") as f:
        filas = list(csv.DictReader(f))
    out, excluidos = [], []
    for r in filas:
        cod = limpio(r.get("codigo"))
        tipo = limpio(r.get("tipo"))
        activo = es_si(r.get("activo"))
        if not cod:
            continue                                   # fila en blanco / #N/A: ni se lista
        if solo and cod.upper() not in solo:
            continue
        if not activo:
            excluidos.append((cod, "activo=NO")); continue
        if not tipo:
            excluidos.append((cod, "sin tipo (placa suelta): completar `tipo` en PARTE_EQUIPOS")); continue
        out.append({
            "codigo": cod,
            "tipo": tipo,
            "placa": limpio(r.get("placa")),
            "medidor": limpio(r.get("medidor")),
        })
    out.sort(key=lambda q: (q["tipo"].upper(), q["codigo"].upper()))
    return out, excluidos


def url_de(base, codigo):
    return f"{base.rstrip('/')}/{RUTA_PARTE}{codigo}"


def generar_png(url, ruta):
    """Nivel H (30 % de corrección: se lee con mugre) y box_size 20 → ≥ 600×600 px para cualquier código."""
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, box_size=20, border=4)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    img.save(ruta)
    return img.size


def fuente_codigo():
    """La sans más gruesa disponible para el código: Red Hat Display Black (en tools/fonts/, licencia
    OFL; se prefiere a Syne porque sus cifras son de caja alta y el 0 no se confunde con la o), si no
    Syne ExtraBold, si no DejaVu Sans Bold del sistema, si no Helvetica-Bold (siempre existe)."""
    candidatos = [
        ("RedHatDisplay-Black", os.path.join(AQUI, "fonts", "RedHatDisplay-Black.ttf")),
        ("Syne-ExtraBold", os.path.join(AQUI, "fonts", "Syne-ExtraBold.ttf")),
        ("DejaVuSans-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ]
    for nombre, ruta in candidatos:
        if os.path.exists(ruta):
            try:
                pdfmetrics.registerFont(TTFont(nombre, ruta))
                return nombre
            except Exception:
                pass
    return "Helvetica-Bold"


def texto_recortado(c, s, fuente, tam, ancho):
    while s and c.stringWidth(s, fuente, tam) > ancho:
        s = s[:-1]
    return s


def generar_pdf(equipos, carpeta, ruta_pdf, url_base):
    """Hoja carta, etiquetas de 7×7 cm en rejilla 2×3, marco negro de 1 mm, líneas de corte punteadas."""
    ancho_pag, alto_pag = letter
    lado = 7 * cm
    cols, filas_pag = 2, 3
    sep = 1.0 * cm                      # espacio entre etiquetas (por ahí van las líneas de corte)
    ancho_bloque = cols * lado + (cols - 1) * sep
    alto_bloque = filas_pag * lado + (filas_pag - 1) * sep
    x0 = (ancho_pag - ancho_bloque) / 2
    y0 = (alto_pag - alto_bloque) / 2
    fuente = fuente_codigo()
    GRIS = (0.35, 0.35, 0.35)

    c = canvas.Canvas(ruta_pdf, pagesize=letter)
    c.setTitle("Etiquetas QR — Parte Digital de Maquinaria (TM2 Sur)")
    c.setAuthor("tools/generar_qr.py")
    por_pagina = cols * filas_pag

    def lineas_de_corte():
        # Punteadas, de borde a borde de la hoja, por cada lado de cada etiqueta.
        c.saveState()
        c.setStrokeColorRGB(0.55, 0.55, 0.55)
        c.setLineWidth(0.4)
        c.setDash(3, 3)
        xs, ys = set(), set()
        for col in range(cols):
            x = x0 + col * (lado + sep); xs.add(x); xs.add(x + lado)
        for fila in range(filas_pag):
            y = y0 + fila * (lado + sep); ys.add(y); ys.add(y + lado)
        for x in xs:
            c.line(x, 0.6 * cm, x, alto_pag - 0.6 * cm)
        for y in ys:
            c.line(0.6 * cm, y, ancho_pag - 0.6 * cm, y)
        c.restoreState()

    for i, q in enumerate(equipos):
        if i and i % por_pagina == 0:
            c.showPage()
        if i % por_pagina == 0:
            lineas_de_corte()
        k = i % por_pagina
        col, fila = k % cols, k // cols
        x = x0 + col * (lado + sep)
        y = y0 + (filas_pag - 1 - fila) * (lado + sep)

        # fondo blanco + marco negro de 1 mm (dibujado hacia dentro para que el corte no se lo lleve)
        c.setFillColorRGB(1, 1, 1)
        c.setStrokeColorRGB(0, 0, 0)
        c.setLineWidth(1 * mm)
        c.rect(x + 0.5 * mm, y + 0.5 * mm, lado - 1 * mm, lado - 1 * mm, stroke=1, fill=1)

        # QR arriba, centrado (4,5 cm)
        png = os.path.join(carpeta, f"{q['codigo']}.png")
        qr_lado = 4.5 * cm
        c.drawImage(png, x + (lado - qr_lado) / 2, y + lado - qr_lado - 0.25 * cm, qr_lado, qr_lado)

        # código en grande (la sans más gruesa disponible)
        c.setFillColorRGB(0, 0, 0)
        tam = 30
        while tam > 12 and c.stringWidth(q["codigo"], fuente, tam) > lado - 1.0 * cm:
            tam -= 2
        c.setFont(fuente, tam)
        c.drawCentredString(x + lado / 2, y + 1.45 * cm, q["codigo"])

        # tipo y placa en gris
        c.setFillColorRGB(*GRIS)
        c.setFont("Helvetica-Bold", 8)
        sub = q["tipo"]
        if q["placa"] and q["placa"].upper() not in ("N/A", "PENDIENTE"):
            sub += "  ·  " + q["placa"]
        c.drawCentredString(x + lado / 2, y + 1.0 * cm, texto_recortado(c, sub, "Helvetica-Bold", 8, lado - 0.8 * cm))

        # pie: URL en texto y leyenda, en letra pequeña
        c.setFont("Helvetica", 5.5)
        c.drawCentredString(x + lado / 2, y + 0.62 * cm, texto_recortado(c, url_de(url_base, q["codigo"]), "Helvetica", 5.5, lado - 0.6 * cm))
        c.setFont("Helvetica-Bold", 6.5)
        c.drawCentredString(x + lado / 2, y + 0.3 * cm, LEYENDA)
    c.save()


def generar_listado(equipos, excluidos, ruta_md, url_base, csv_origen):
    lineas = [
        "# LISTADO — QR del Parte Digital de Maquinaria",
        "",
        f"**Total: {len(equipos)} equipos activos con QR** (fuente: `{os.path.relpath(csv_origen, os.path.join(AQUI, '..'))}`; "
        f"URL base `{url_base}`). Generado por `tools/generar_qr.py`; ordenado por tipo y código.",
        "",
        "Inventario para saber qué se imprimió (`etiquetas.pdf`, 6 por hoja en este mismo orden) y qué se pegó en cabina: "
        "marca la columna **Pegado** a mano o en una copia.",
        "",
        "| # | Código | Tipo | Placa | Medidor | URL | PNG | Pegado |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for n, q in enumerate(equipos, 1):
        u = url_de(url_base, q["codigo"])
        lineas.append(f"| {n} | **{q['codigo']}** | {q['tipo']} | {q['placa'] or '—'} | {q['medidor'] or '—'} | [{u}]({u}) | `{q['codigo']}.png` | ☐ |")
    if excluidos:
        lineas += ["", f"## Sin QR ({len(excluidos)})", "",
                   "Están en el CSV pero no se generaron. Para incluirlos: corregir la fila en `PARTE_EQUIPOS`, "
                   "exportar el CSV y correr el script con `--csv` (ver `README.md`).", "",
                   "| Código | Motivo |", "|---|---|"]
        for cod, motivo in excluidos:
            lineas.append(f"| {cod} | {motivo} |")
    with open(ruta_md, "w", encoding="utf-8") as f:
        f.write("\n".join(lineas) + "\n")


def main():
    ap = argparse.ArgumentParser(description="Genera QR, etiquetas y listado del Parte Digital de Maquinaria.")
    ap.add_argument("--csv", default=CSV_DEFECTO, help="CSV con las columnas codigo,tipo,placa,medidor,activo (semilla u hoja PARTE_EQUIPOS exportada)")
    ap.add_argument("--salida", default=SALIDA_DEFECTO, help="carpeta de salida (default: qr/)")
    ap.add_argument("--url-base", default=URL_BASE, help="URL base del sitio, sin barra final")
    ap.add_argument("--solo", default="", help="códigos separados por coma para generar solo esos PNG (p. ej. VOL048,CR026); el PDF y el listado también se acotan")
    args = ap.parse_args()

    solo = {s.strip().upper() for s in args.solo.split(",") if s.strip()} or None
    equipos, excluidos = leer_equipos(args.csv, solo)
    if not equipos:
        sys.exit("No hay equipos activos que generar (revisa el CSV o --solo).")
    os.makedirs(args.salida, exist_ok=True)
    for q in equipos:
        w, h = generar_png(url_de(args.url_base, q["codigo"]), os.path.join(args.salida, f"{q['codigo']}.png"))
        assert min(w, h) >= 600, f"{q['codigo']}: PNG de {w}×{h} px (< 600)"
    pdf = os.path.join(args.salida, "etiquetas.pdf")
    generar_pdf(equipos, args.salida, pdf, args.url_base)
    listado = os.path.join(args.salida, "LISTADO.md")
    generar_listado(equipos, excluidos, listado, args.url_base, os.path.abspath(args.csv))
    print(f"{len(equipos)} QR en {os.path.abspath(args.salida)}  ·  etiquetas: {os.path.abspath(pdf)}  ·  listado: {os.path.abspath(listado)}")
    for q in equipos:
        print(f"  {q['codigo']:<8} {q['tipo']:<28} {url_de(args.url_base, q['codigo'])}")
    if excluidos:
        print(f"Sin QR ({len(excluidos)}): " + ", ".join(f"{c} ({m.split(':')[0]})" for c, m in excluidos))


if __name__ == "__main__":
    main()
