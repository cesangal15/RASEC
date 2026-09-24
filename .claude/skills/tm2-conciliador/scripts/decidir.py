"""tm2-conciliador · decidir.py

Une las dos fuentes de evidencia de los viajes NO_ENCONTRADA y produce `decisiones.json` para
`aplicar_decisiones.js`, más `preguntas.md` con lo que el dueño debe resolver.

  python decidir.py --cruce cruce.json --clasificacion clasificacion.json --out DIR

- cruce.json: salida de `soportes.py cruzar` (recibo leído por reclamo, con calidad CONFIRMADO/PROBABLE).
- clasificacion.json: grupos decididos leyendo la programación de WhatsApp (ver SKILL.md, paso 5):
  [{remisiones:[...], clasificacion: NOSOTROS|PUENTES|TM1|UF3|ASFALTOS|DUDA, confianza, pedido, respuesta, nota}]

Reglas (del dueño, sep-2026):
- UF3 → EXCLUIDA_UF3 · ASFALTOS → EXCLUIDA_ASFALTO (no son nuestros; fuera del acta).
- NOSOTROS / PUENTES / TM1 con soporte CONFIRMADO → PENDIENTE_DIGITACION con su evidencia (archivo, página);
  PUENTES y TM1 llevan área y CC 3701.11.03 (la fórmula del acta escribe «PUENTES - …»; TM1 va literal).
- Con soporte solo PROBABLE, sin soporte, DUDA o confianza baja → no se decide: va a preguntas.md
  (confianza media → se decide y además se pregunta). Las respuestas del dueño entran con --respuestas.
- Discrepancias del recibo (otra placa, fecha, m³, «N viajes» → m³×N) → preguntas.md; nunca se aplican solas.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

CC_AREA_AJENA = "3701.11.03"
AL_ACTA = {"NOSOTROS", "PUENTES", "TM1"}
FUERA = {"UF3": "EXCLUIDA_UF3", "ASFALTOS": "EXCLUIDA_ASFALTO"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cruce", required=True)
    ap.add_argument("--clasificacion", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--respuestas", help="decisiones del dueño a las preguntas (mismo formato que decisiones.json); mandan sobre las automáticas")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    cruce = json.load(open(a.cruce, encoding="utf-8"))
    clasif = json.load(open(a.clasificacion, encoding="utf-8"))
    # mejor lectura por remisión (la marcada «elegido» por soportes.py cruzar)
    soporte = {str(x["remision"]): x for x in cruce.get("resultados", []) if x.get("elegido")
               and x.get("estado_previo") == "NO_ENCONTRADA"}

    decisiones, preguntas, fuera, al_acta = [], [], 0, 0
    for g in clasif:
        cl, conf = g.get("clasificacion"), (g.get("confianza") or "").lower()
        cita = ""
        if g.get("pedido"):
            p = g["pedido"]; cita += f"pedido de {p.get('autor')} ({p.get('cuando')}): «{str(p.get('texto', ''))[:140]}»"
        if g.get("respuesta"):
            r = g["respuesta"]; cita += f" · respuesta de {r.get('autor')} ({r.get('cuando')}): «{str(r.get('texto', ''))[:80]}»"
        cab = f"{g.get('fecha')} · {g.get('placa')} · {g.get('origen')}→{g.get('destino')} · {len(g.get('remisiones', []))} viaje(s)"
        if cl in FUERA:
            for rem in g["remisiones"]:
                decisiones.append({"remision": str(rem), "estado": FUERA[cl], "nota": f"{cl} según programación WhatsApp", "detalle": cita})
                fuera += 1
            continue
        if cl not in AL_ACTA or conf == "baja":
            preguntas.append(f"- **{cab}** — no se pudo decidir con WhatsApp ({cl}, confianza {conf}). {g.get('nota') or ''} {cita}")
            continue
        for rem in g["remisiones"]:
            s = soporte.get(str(rem))
            if not s or s.get("calidad") != "CONFIRMADO":
                q = "sin recibo en los soportes" if not s else f"recibo solo {s.get('calidad')} en {s['encontrado']['archivo']} p.{s['encontrado']['pagina']}"
                preguntas.append(f"- **{rem}** ({cab}, {cl}): {q}. ¿Entra al acta?")
                continue
            d = {"remision": str(rem), "estado": "PENDIENTE_DIGITACION",
                 "evidencia": {"archivo": s["encontrado"]["archivo"], "pagina": s["encontrado"]["pagina"]},
                 "nota": f"{cl} · soporte {s['encontrado']['archivo']} p.{s['encontrado']['pagina']}", "detalle": cita}
            if cl in ("PUENTES", "TM1"):
                d["area"], d["cc"] = cl, CC_AREA_AJENA
            decisiones.append(d)
            al_acta += 1
            reales = [x for x in s.get("discrepancias", []) if not x.get("informativo")]
            for x in reales:
                if x["campo"] == "viajes":
                    preguntas.append(f"- **{rem}**: el recibo dice **{x['viajes']} viajes** ({x['m3_recibo']} m³ c/u); la proforma cobra 1. ¿Se reconoce {x['propuesta_m3_total']} m³?")
                else:
                    preguntas.append(f"- **{rem}**: {x['campo']} distinto — proforma «{x.get('proforma')}», recibo «{x.get('recibo')}» ({s['encontrado']['archivo']} p.{s['encontrado']['pagina']}).")
        if conf == "media":
            preguntas.append(f"- **{cab}** ({cl}, confianza media): {g.get('nota') or ''} {cita}")

    if a.respuestas:
        # Las respuestas del dueño reemplazan la decisión automática de esa remisión y quitan su pregunta.
        resp = {str(d["remision"]): d for d in json.load(open(a.respuestas, encoding="utf-8"))}
        decisiones = [d for d in decisiones if str(d["remision"]) not in resp] + list(resp.values())
        preguntas = [q for q in preguntas if not any(f"**{r}**" in q for r in resp)]
        al_acta = sum(1 for d in decisiones if d["estado"] == "PENDIENTE_DIGITACION")

    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    json.dump(decisiones, open(out / "decisiones.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    (out / "preguntas.md").write_text("# Preguntas para el dueño\n\n" + ("\n".join(preguntas) if preguntas else "Ninguna.") + "\n", encoding="utf-8")
    print(f"decisiones: {len(decisiones)} (al acta {al_acta}, fuera {fuera}) · preguntas: {len(preguntas)} -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
