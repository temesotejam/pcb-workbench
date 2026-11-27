"""Fail-closed audit of KiCad's metric decimal via-only Excellon output.
Not a general Excellon reader: slots, other tools and alternate modes are rejected.
"""
from collections import Counter
from decimal import Decimal, ROUND_HALF_UP
import re

NUM = r"[+-]?\d+(?:\.\d+)?"
MICRON = Decimal("0.001")


def micron(value):
    return Decimal(str(value)).quantize(MICRON, rounding=ROUND_HALF_UP)


def parse_via_drills(text):
    lines = [s.strip() for s in text.splitlines() if s.strip()]
    if not lines or lines[0] != "M48" or lines[-1] != "M30":
        raise ValueError("Drill file missing header or terminator")
    header, body = True, []
    meta, tools, hits = set(), {}, []
    pending, selected = False, None
    for line in lines[1:-1]:
        if line.startswith(";"):
            if line.startswith("; FORMAT="):
                if not header or line != "; FORMAT={-:-/ absolute / metric / decimal}" or "format" in meta:
                    raise ValueError("Unsupported drill coordinate format")
                meta.add("format")
            elif line.startswith("; #@! TF.FileFunction,"):
                if not header or line != "; #@! TF.FileFunction,MixedPlating,1,2" or "function" in meta:
                    raise ValueError("Unsupported drill file function")
                meta.add("function")
            elif line.startswith("; #@! TA.AperFunction,"):
                if not header or pending or line != "; #@! TA.AperFunction,Plated,PTH,ViaDrill":
                    raise ValueError("Expected plated through-via drill tool")
                pending = True
            continue
        if header:
            if line in ("FMAT,2", "METRIC") and not pending and line not in meta:
                meta.add(line)
            elif line == "%" and not pending:
                header = False
            else:
                m = re.fullmatch(r"T(\d+)C(" + NUM + r")", line)
                if not m or not pending or m[1] in tools or Decimal(m[2]) <= 0 or Decimal(m[2]) != micron(m[2]):
                    raise ValueError("Unsupported or unclassified drill tool: " + line)
                tools[m[1]] = Decimal(m[2])
                pending = False
        elif len(body) < 2:
            if line != ("G90", "G05")[len(body)]:
                raise ValueError("Expected absolute drill mode")
            body.append(line)
        elif (m := re.fullmatch(r"T(\d+)", line)) and m[1] in tools:
            selected = m[1]
        elif (m := re.fullmatch(r"X(" + NUM + r")Y(" + NUM + r")", line)) and selected is not None:
            x, y = Decimal(m[1]), Decimal(m[2])
            if x != micron(x) or y != micron(y):
                raise ValueError("Unsupported sub-micron drill coordinate")
            hits.append((x, y, tools[selected]))
        else:
            raise ValueError("Unsupported drill command: " + line)
    if header or body != ["G90", "G05"] or meta != {"format", "function", "FMAT,2", "METRIC"}:
        raise ValueError("Incomplete drill mode or metadata")
    return Counter(hits)


def audit_manual_via_drills(plotted, expected):
    """Expected values are model-mm waypoints, not extracted from KiCad copper."""
    files = [p for p in plotted if p.suffix.lower() == ".drl"]
    if len(files) != 1:
        raise ValueError("Expected exactly one combined KiCad drill file")
    # Pinned converter: board (100+x, 100-y); KiCad absolute Excellon inverts Y.
    expected_hits = Counter((micron(100 + Decimal(str(p["x"]))),
                             micron(-100 + Decimal(str(p["y"]))),
                             micron(p["drill"])) for p in expected)
    actual = parse_via_drills(files[0].read_text(encoding="ascii"))
    if actual != expected_hits:
        raise ValueError("Plated via drill parity mismatch: missing " + str(list((expected_hits-actual).elements())) +
                         "; extra " + str(list((actual-expected_hits).elements())))
    return {"file": files[0].name, "platedViaHoles": sum(actual.values()), "resolutionMm": 0.001,
            "coordinateSystem": "absolute metric; x=100+x_model, y=-100+y_model"}
