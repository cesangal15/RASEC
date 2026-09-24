"""tm2-conciliador · chats.py

Parsea exports de WhatsApp (formato `[M/D/YY, H:MM:SS AM] Autor: texto`, multilínea)
y construye, para cada viaje pendiente de clasificar, el contexto de programación
(pedidos del día anterior/mismo día, respuestas con placas, menciones de PK) que
Claude usa para decidir NUESTRO/PUENTES/TM1/UF3/ASFALTO/DUDA.

Subcomandos:
  chats.py parsear --chat DIR_O_TXT [--chat ...] --out mensajes.json
  chats.py contexto --mensajes mensajes.json --viajes viajes.json \
      --participantes C:/GALCA/conciliacion/privado/participantes.json --out contexto.json

No escribe nunca sobre los chats de origen.
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from datetime import date, datetime, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# parsear
# ---------------------------------------------------------------------------

_LINEA = re.compile(
    r"^\[(\d{1,2})/(\d{1,2})/(\d{2}), (\d{1,2}):(\d{2}):(\d{2})\s?(AM|PM)\]\s(.*?):\s(.*)$"
)


def _limpia(texto: str) -> str:
    return texto.replace("‎", "").replace("﻿", "")


def _resuelve_chat_txt(ruta: Path) -> Path:
    if ruta.is_dir():
        candidato = ruta / "chat.txt"
        if candidato.exists():
            return candidato
        raise FileNotFoundError(f"No hay chat.txt en {ruta}")
    return ruta


def _parsea_chat(ruta_txt: Path, chat_origen: str) -> list[dict]:
    texto = _limpia(ruta_txt.read_text(encoding="utf-8", errors="replace"))
    lineas = texto.split("\n")

    mensajes: list[dict] = []
    actual: dict | None = None

    for linea in lineas:
        m = _LINEA.match(linea)
        if m:
            if actual is not None:
                actual["texto"] = actual["texto"].rstrip("\n")
                mensajes.append(actual)
            mes, dia, anio2, hh, mm, ss, ampm, autor, resto = m.groups()
            anio = 2000 + int(anio2)
            hh = int(hh)
            if ampm.upper() == "PM" and hh != 12:
                hh += 12
            if ampm.upper() == "AM" and hh == 12:
                hh = 0
            try:
                fecha_iso = date(anio, int(mes), int(dia)).isoformat()
            except ValueError:
                fecha_iso = None
            hora = f"{hh:02d}:{mm}:{ss}"
            actual = {
                "fecha_iso": fecha_iso,
                "hora": hora,
                "ts_raw": f"[{mes}/{dia}/{anio2}, {m.group(4)}:{mm}:{ss} {ampm}]",
                "autor": autor.strip(),
                "texto": resto,
                "chat_origen": chat_origen,
            }
        else:
            if actual is not None:
                actual["texto"] += "\n" + linea

    if actual is not None:
        actual["texto"] = actual["texto"].rstrip("\n")
        mensajes.append(actual)

    return mensajes


def cmd_parsear(args: argparse.Namespace) -> int:
    todos: list[dict] = []
    vistos: set[tuple] = set()
    duplicados = 0

    for chat_str in args.chat:
        ruta = Path(chat_str)
        txt = _resuelve_chat_txt(ruta)
        origen = ruta.name if ruta.is_dir() else ruta.parent.name or ruta.name
        for msg in _parsea_chat(txt, origen):
            clave = (msg["fecha_iso"], msg["hora"], msg["autor"], msg["texto"])
            if clave in vistos:
                duplicados += 1
                continue
            vistos.add(clave)
            todos.append(msg)

    todos.sort(key=lambda m: (m["fecha_iso"] or "", m["hora"]))

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(todos, f, ensure_ascii=False, indent=2)

    print(f"{len(todos)} mensajes ({duplicados} duplicados descartados) -> {args.out}")
    return 0


# ---------------------------------------------------------------------------
# contexto
# ---------------------------------------------------------------------------

def _sin_tildes(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c))


def _rol_de(autor: str, participantes: list[dict]) -> tuple[str, str]:
    autor_norm = _sin_tildes(autor).lower()
    for p in participantes:
        clave_norm = _sin_tildes(p["clave"]).lower()
        # Coincidencia por fragmento distintivo, pero con límites (evita que
        # claves cortas como "tú" hagan falso match dentro de "beTUlia").
        patron = r"(?<!\w)" + re.escape(clave_norm) + r"(?!\w)"
        if re.search(patron, autor_norm) or re.search(
            r"(?<!\w)" + re.escape(autor_norm) + r"(?!\w)", clave_norm
        ):
            return p["rol"], p.get("nombre", autor)
    return "DESCONOCIDO", autor


def _normaliza_placa(p) -> str:
    if not p:
        return ""
    return re.sub(r"[^A-Z0-9]", "", str(p).upper())


_PLACA_RE = re.compile(r"\b([A-Z]{3}\s?\d{3})\b")


def _placas_en_texto(texto: str) -> set[str]:
    return {_normaliza_placa(m.group(1)) for m in _PLACA_RE.finditer(texto.upper())}


# PK/PR + progresiva -> metros. Admite "PK14+700", "PR14+700", "14+700", "14700",
# "14 +700", "Pk14", "pk 20+400".
_PK_RE = re.compile(
    r"(?:P[KR]\s?)?(\d{1,3})\s*\+\s*(\d{1,3})"  # con '+'
    r"|(?:P[KR]\s?)(\d{2,5})(?!\+)"  # PK14000 sin '+', o PK14 (progresiva corta)
)


def _pks_en_texto(texto: str) -> set[int]:
    metros: set[int] = set()
    for m in _PK_RE.finditer(texto.upper()):
        if m.group(1) is not None and m.group(2) is not None:
            km = int(m.group(1))
            resto = m.group(2)
            metros.add(km * 1000 + int(resto.ljust(3, "0")[:3]))
        elif m.group(3) is not None:
            val = m.group(3)
            if len(val) <= 2:
                metros.add(int(val) * 1000)
            else:
                metros.add(int(val))
    return metros


def _pk_a_metros(valor) -> int | None:
    if valor is None:
        return None
    if isinstance(valor, (int, float)):
        return int(valor)
    s = str(valor).strip()
    pks = _pks_en_texto(s if re.search(r"[PpKkRr]", s) else "PK" + s)
    if pks:
        return next(iter(pks))
    try:
        return int(float(s))
    except ValueError:
        return None


def _distancia_min(pks_texto: set[int], objetivo: int | None, tolerancia: int) -> tuple[int | None, bool]:
    if objetivo is None or not pks_texto:
        return None, False
    mejor = min(abs(p - objetivo) for p in pks_texto)
    return mejor, mejor <= tolerancia


ROLES_SOLICITANTES = {"NOSOTROS", "UF3", "PUENTES", "TM1", "ASFALTOS"}


def _ventana(fecha_iso: str) -> tuple[str, str]:
    f = date.fromisoformat(fecha_iso)
    return (f - timedelta(days=1)).isoformat(), f.isoformat()


def cmd_contexto(args: argparse.Namespace) -> int:
    with open(args.mensajes, encoding="utf-8") as f:
        mensajes = json.load(f)
    with open(args.viajes, encoding="utf-8") as f:
        viajes = json.load(f)
    with open(args.participantes, encoding="utf-8") as f:
        participantes = json.load(f)["participantes"]

    # Enriquecer mensajes con rol (una sola vez).
    for m in mensajes:
        m["rol"], m["nombre_autor"] = _rol_de(m["autor"], participantes)

    tolerancia = args.tolerancia_m

    salida = []
    for viaje in viajes:
        fecha = viaje.get("fecha")
        placa = _normaliza_placa(viaje.get("placa"))
        origen_m = _pk_a_metros(viaje.get("origen"))
        destino_m = _pk_a_metros(viaje.get("destino"))

        if not fecha:
            salida.append({**viaje, "error": "sin fecha, no se puede acotar ventana"})
            continue

        d_ini, d_fin = _ventana(fecha)
        en_ventana = [m for m in mensajes if m["fecha_iso"] in (d_ini, d_fin)]

        pedidos = [m for m in en_ventana if m["rol"] in ROLES_SOLICITANTES]
        respuestas_con_placa = [
            m for m in en_ventana if placa and placa in _placas_en_texto(m["texto"])
        ]
        menciones_pk = []
        for m in en_ventana:
            pks_msg = _pks_en_texto(m["texto"])
            if not pks_msg:
                continue
            d_o, ok_o = _distancia_min(pks_msg, origen_m, tolerancia)
            d_d, ok_d = _distancia_min(pks_msg, destino_m, tolerancia)
            if ok_o or ok_d:
                menciones_pk.append({
                    "mensaje": m,
                    "coincide_origen": ok_o,
                    "coincide_destino": ok_d,
                })

        # Heurística: puntuar cada pedido de la ventana por cercanía de sus PK
        # a la ruta del viaje (origen+destino). Menor distancia total = mejor.
        mejor_pedido = None
        mejor_score = None
        for m in pedidos:
            pks_msg = _pks_en_texto(m["texto"])
            if not pks_msg:
                continue
            d_o, ok_o = _distancia_min(pks_msg, origen_m, 10**9)
            d_d, ok_d = _distancia_min(pks_msg, destino_m, 10**9)
            distancias = [d for d in (d_o, d_d) if d is not None]
            if not distancias:
                continue
            score = sum(distancias)
            match_estricto = bool(origen_m is not None and destino_m is not None and ok_o and ok_d)
            if mejor_score is None or score < mejor_score:
                mejor_score = score
                mejor_pedido = {
                    "mensaje": m,
                    "distancia_total_m": score,
                    "match_estricto_ambos_pk": match_estricto,
                }

        sugerencia = None
        if mejor_pedido is not None:
            m = mejor_pedido["mensaje"]
            sugerencia = {
                "rol_sugerido": m["rol"],
                "autor": m["autor"],
                "nombre_autor": m["nombre_autor"],
                "fecha_iso": m["fecha_iso"],
                "hora": m["hora"],
                "distancia_total_m": mejor_pedido["distancia_total_m"],
                "match_estricto_ambos_pk": mejor_pedido["match_estricto_ambos_pk"],
                "es_sugerencia_no_decision": True,
            }

        salida.append({
            "viaje": viaje,
            "ventana": {"desde": d_ini, "hasta": d_fin},
            "pedidos": [
                {"fecha_iso": m["fecha_iso"], "hora": m["hora"], "autor": m["autor"],
                 "rol": m["rol"], "nombre_autor": m["nombre_autor"], "texto": m["texto"],
                 "chat_origen": m["chat_origen"]}
                for m in pedidos
            ],
            "respuestas_con_placa": [
                {"fecha_iso": m["fecha_iso"], "hora": m["hora"], "autor": m["autor"],
                 "rol": m["rol"], "nombre_autor": m["nombre_autor"], "texto": m["texto"],
                 "chat_origen": m["chat_origen"]}
                for m in respuestas_con_placa
            ],
            "menciones_pk": [
                {"fecha_iso": mm["mensaje"]["fecha_iso"], "hora": mm["mensaje"]["hora"],
                 "autor": mm["mensaje"]["autor"], "rol": mm["mensaje"]["rol"],
                 "coincide_origen": mm["coincide_origen"], "coincide_destino": mm["coincide_destino"],
                 "texto": mm["mensaje"]["texto"]}
                for mm in menciones_pk
            ],
            "sugerencia": sugerencia,
        })

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, indent=2)

    print(f"{len(salida)} viajes con contexto -> {args.out}")
    con_sugerencia = sum(1 for x in salida if x.get("sugerencia"))
    print(f"  con sugerencia heurística: {con_sugerencia}")
    return 0


# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="comando", required=True)

    p_parsear = sub.add_parser("parsear", help="chat.txt(s) -> mensajes.json")
    p_parsear.add_argument("--chat", action="append", required=True, dest="chat")
    p_parsear.add_argument("--out", required=True)
    p_parsear.set_defaults(func=cmd_parsear)

    p_contexto = sub.add_parser("contexto", help="mensajes.json + viajes.json -> contexto.json")
    p_contexto.add_argument("--mensajes", required=True)
    p_contexto.add_argument("--viajes", required=True)
    p_contexto.add_argument("--participantes", required=True)
    p_contexto.add_argument("--out", required=True)
    p_contexto.add_argument("--tolerancia-m", type=int, default=300, dest="tolerancia_m")
    p_contexto.set_defaults(func=cmd_contexto)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
