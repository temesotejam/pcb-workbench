"""Generate *draft* JLCPCB data from the same KiCad board, never synthetic traces.
A production release is deliberately disabled in v0.1. No ordering API.
"""
import csv
import json
import math
import pathlib
import re
import subprocess
import sys
import zipfile

def csv_write(path, fields, rows):
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)

def assembly_rows(parts, positions):
    """Use KiCad native placement coordinates; require exact reference parity."""
    refs = [p["ref"] for p in parts]
    if len(refs) != len(set(refs)):
        raise ValueError("Duplicate part reference")
    if any(not re.fullmatch(r"[A-Za-z]+[0-9]+", r) for r in refs):
        raise ValueError("Invalid reference")
    pos = {}
    for row in positions:
        ref = row["Ref"]
        if ref in pos:
            raise ValueError("Duplicate placement: " + ref)
        pos[ref] = row
    if set(refs) != set(pos):
        raise ValueError("BOM/CPL references differ: " + repr(set(refs) ^ set(pos)))
    bom, cpl, blockers = [], [], []
    for p in sorted(parts, key=lambda p: p["ref"]):
        ref = p["ref"]
        row = pos[ref]
        if row["Side"].lower() not in ("top","bottom","front","back"):
            raise ValueError("Unknown board side: " + row["Side"])
        x, y, angle = (float(row[k]) for k in ("PosX","PosY","Rot"))
        if not all(math.isfinite(v) for v in (x,y,angle)):
            raise ValueError("Nonfinite placement: " + ref)
        number = p.get("lcsc") or ""
        offset = p.get("rotationOffset")
        if not re.fullmatch(r"C[0-9]+", number) or not p.get("manufacturerPart") or p.get("reviewed") is not True:
            blockers.append(ref + ": exact part and availability review required")
        if not isinstance(offset,(int,float)) or isinstance(offset,bool) or not math.isfinite(offset):
            blockers.append(ref + ": centroid and JLCPCB rotation review required")
            offset = 0
        if p.get("assembly") != "smd":
            blockers.append(ref + ": non-SMD assembly not yet supported")
        bom.append({"Comment":p["value"],"Designator":ref,"Footprint":p.get("package",p["footprint"]),"LCSC Part #":number,"Quantity":"1"})
        cpl.append({"Designator":ref,"Mid X":f"{x:.6f}","Mid Y":f"{y:.6f}","Rotation":f"{(angle+offset)%360:.4f}","Layer":"Top" if row["Side"].lower() in ("top","front") else "Bottom"})
    return bom, cpl, blockers

def run(cmd, log):
    cp = subprocess.run(["kicad-cli", *map(str,cmd)],text=True,capture_output=True)
    log.append({"command":["kicad-cli",*map(str,cmd)],"exit":cp.returncode,"output":cp.stdout+cp.stderr})
    return cp.returncode

def process(root, meta_path):
    meta = json.loads(meta_path.read_text())
    dest = root / "projects" / meta["id"]
    summary_path = dest / "project.json"
    summary = json.loads(summary_path.read_text())
    log, blockers = [], list(summary["errors"])
    if summary["status"] != "preview":
        return False
    board, sch = dest/"board.kicad_pcb", dest/"board.kicad_sch"
    draft = dest / "draft"
    gerber = draft / "gerber"
    gerber.mkdir(parents=True, exist_ok=True)
    # Absolute coordinates for all three exports; no independently shifted origins.
    checks = [
        ["sch","erc","--severity-all","--format","json","-o",dest/"erc.json",sch],
        ["pcb","drc","--schematic-parity","--severity-all","--format","json","-o",dest/"drc.json",board],
    ]
    checks_ok = True
    warnings = []
    for cmd in checks:
        if run(cmd,log) != 0:
            checks_ok = False
            blockers.append(cmd[1].upper() + " command failed")
    erc_path, drc_path = dest/"erc.json", dest/"drc.json"
    for report in ("erc.json","drc.json"):
        if (dest/report).is_file():
            summary["files"].append(report)
        else:
            checks_ok = False
            blockers.append(report + " missing")
    if erc_path.is_file():
        erc = json.loads(erc_path.read_text())
        violations = [v for sheet in erc.get("sheets",[]) for v in sheet.get("violations",[])]
        errors = [v for v in violations if str(v.get("severity","")).lower() in ("error","fatal","fatalerror")]
        unknown = [v for v in violations if str(v.get("severity","")).lower() not in ("error","fatal","fatalerror","warning","exclusion")]
        warnings.extend({"source":"ERC",**v} for v in violations if str(v.get("severity","")).lower()=="warning")
        if errors:
            checks_ok = False
            blockers.append("ERC has " + str(len(errors)) + " error(s)")
        if unknown:
            checks_ok = False
            blockers.append("ERC has findings with unknown severity")
    if drc_path.is_file():
        drc = json.loads(drc_path.read_text())
        violations = drc.get("violations",[])
        errors = [v for v in violations if str(v.get("severity","")).lower() in ("error","fatal","fatalerror")]
        unknown = [v for v in violations if str(v.get("severity","")).lower() not in ("error","fatal","fatalerror","warning","exclusion")]
        warnings.extend({"source":"DRC",**v} for v in violations if str(v.get("severity","")).lower()=="warning")
        parity = drc.get("schematic_parity",[])
        unconnected = drc.get("unconnected_items",[])
        if errors:
            checks_ok = False
            blockers.append("DRC has " + str(len(errors)) + " error(s)")
        if unknown:
            checks_ok = False
            blockers.append("DRC has findings with unknown severity")
        if parity:
            checks_ok = False
            blockers.append("Schematic/PCB parity has " + str(len(parity)) + " issue(s)")
        if unconnected:
            checks_ok = False
            blockers.append("PCB has " + str(len(unconnected)) + " unconnected item(s)")
    commands = [
        ["pcb","export","gerbers","--layers",",".join(meta["layers"]),"-o",str(gerber)+"/",board],
        ["pcb","export","drill","--format","excellon","-o",str(gerber)+"/",board],
        ["pcb","export","pos","--format","csv","--units","mm","--side","both","--exclude-dnp","-o",draft/"positions.csv",board],
    ]
    ok = all(run(cmd,log) == 0 for cmd in commands)
    try:
        if not ok:
            raise ValueError("KiCad export failed")
        plotted = sorted(p for p in gerber.iterdir() if p.is_file() and p.stat().st_size)
        if not any(p.suffix.lower() in (".gbr",".gtl") for p in plotted):
            raise ValueError("No Gerber copper files")
        if not any(p.suffix.lower()==".gko" or "edge_cuts" in p.name.lower() or "edge.cuts" in p.name.lower() for p in plotted):
            raise ValueError("No identifiable board-outline output")
        with (draft/"positions.csv").open(encoding="utf-8-sig",newline="") as f:
            bom,cpl,issues=assembly_rows(summary["parts"],list(csv.DictReader(f)))
        blockers.extend(issues)
        for p in summary["parts"]:
            if not p.get("geometryReviewed") or not p.get("datasheetReviewed") or not p.get("availabilityChecked") or not p.get("stock"):
                blockers.append(p["ref"]+": JLCPCB geometry, datasheet and stock approval incomplete")
        csv_write(draft/"BOM.csv",["Comment","Designator","Footprint","LCSC Part #","Quantity"],bom)
        csv_write(draft/"CPL.csv",["Designator","Mid X","Mid Y","Rotation","Layer"],cpl)
        with zipfile.ZipFile(draft/"Gerber.zip","w",zipfile.ZIP_DEFLATED) as z:
            for p in plotted:
                z.write(p,p.name)
        (draft/"DO_NOT_ORDER.txt").write_text("DRAFT ONLY. No verified component selection or release approval.\n")
        summary["draftFiles"]=["draft/Gerber.zip","draft/BOM.csv","draft/CPL.csv","draft/DO_NOT_ORDER.txt"]
    except (ValueError,KeyError,OSError) as e:
        blockers.append(str(e))
        ok = False
    # v0.1 always fails closed for manufacturing. Later releases must implement
    # revision-bound approval, part evidence, JLCPCB rule profiles and pin/net parity.
    blockers.append("Production release gate disabled in v0.1; manual JLCPCB preview and engineering review not implemented.")
    ok = ok and checks_ok
    summary.update(status="draft" if ok else "blocked", blockers=blockers, orderReady=False)
    validation_text = json.dumps({"blockers":blockers,"warnings":warnings,"commands":log,"orderReady":False},indent=2)
    (dest/"validation.json").write_text(validation_text)
    (draft/"validation.json").write_text(validation_text)
    for report in (erc_path,drc_path):
        if report.is_file():
            (draft/report.name).write_bytes(report.read_bytes())
    summary["files"].append("validation.json")
    summary_path.write_text(json.dumps(summary,indent=2))
    return ok

if __name__ == "__main__":
    dist = pathlib.Path(sys.argv[1] if len(sys.argv)>1 else "dist").resolve()
    projects = pathlib.Path(sys.argv[2] if len(sys.argv)>2 else "projects")
    outcomes = []
    for p in sorted(projects.glob("*/project.json")):
        ok = process(dist,p)
        outcomes.append(ok)
        meta = json.loads(p.read_text())
        report = dist / "projects" / meta["id"] / "validation.json"
        print(f"{meta['id']}: {'PASS (draft only)' if ok else 'FAIL'}", flush=True)
        if not ok and report.is_file():
            for blocker in json.loads(report.read_text()).get("blockers", []):
                print("  " + blocker, flush=True)
    sys.exit(0 if outcomes and all(outcomes) else 1)
