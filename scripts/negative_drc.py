"""Independent negative DRC tests against copies of a real generated board.
Never mutate the positive fixture or publish defective fabrication files.
"""
import json
import math
import pathlib
import re
import shutil
import sys
import tempfile
import uuid

from scripts.fabricate import process

SEGMENT = re.compile(r"\(segment\s+(?:[^()]|\([^()]*\))*\)")

def point(segment, key):
    m = re.search(r"\(" + key + r"\s+([^\s()]+)\s+([^\s()]+)\)", segment)
    return tuple(map(float, m.groups()))

def midpoint(segment):
    a, b = point(segment,"start"),point(segment,"end")
    return tuple((x+y)/2 for x,y in zip(a,b))

def width(segment):
    return float(re.search(r"\(width\s+([^\s()]+)\)",segment)[1])

def stub(segment, a, b):
    for key, p in (("start",a),("end",b)):
        segment = re.sub(r"\(" + key + r"\s+[^()]+\)",f"({key} {p[0]:.8f} {p[1]:.8f})",segment)
    return re.sub(r"\((uuid|tstamp)\s+[^()]+\)",lambda m:f'({m[1]} "{uuid.uuid4()}")',segment)

def cases(board):
    segments = SEGMENT.findall(board)
    assert len(segments) == 2, "expected two straight tracks in resistor fixture"
    s,t = segments
    a,b = midpoint(s),midpoint(t)
    distance = math.dist(a,b)
    gap = (width(s)+width(t))/2 + .03
    assert distance > gap
    near = tuple(y+(x-y)*gap/distance for x,y in zip(a,b))
    def insert(extra):
        end = board.rfind(")")
        return board[:end] + "\n" + extra + "\n" + board[end:]
    return [
        ("short",insert(stub(s,a,b)),"shorting_items"),
        ("clearance",insert(stub(s,a,near)),"clearance"),
        ("unconnected",board.replace(s,"",1),"unconnected_items")
    ]

def main(dist, meta):
    original = dist/"projects"/"native-resistors-manual"
    board = (original/"board.kicad_pcb").read_text()
    for name, mutated, expected in cases(board):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            dest = root/"projects"/"native-resistors-manual"
            shutil.copytree(original,dest)
            (dest/"board.kicad_pcb").write_text(mutated)
            summary = json.loads((dest/"project.json").read_text())
            summary["status"] = "preview"
            (dest/"project.json").write_text(json.dumps(summary))
            assert not process(root,meta), name + ": defective board accepted"
            report = json.loads((dest/"drc.json").read_text())
            types = {v.get("type") for v in report.get("violations",[])}
            if expected == "unconnected_items":
                assert report.get(expected), (name, report)
            else:
                assert expected in types, (name, types, report)
            assert not (dest/"draft").exists(), name + ": stale or invalid fabrication files remain"
            result = json.loads((dest/"project.json").read_text())
            assert result["status"] == "blocked" and result["orderReady"] is False
            assert "draftFiles" not in result
            print(f"{name}: PASS (KiCad detected {expected}; export blocked)",flush=True)

if __name__ == "__main__":
    main(pathlib.Path(sys.argv[1]).resolve(),pathlib.Path(sys.argv[2]).resolve())
