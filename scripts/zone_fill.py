"""Bounded rectangular copper-zone adapter for generated KiCad boards.

KiCad performs the actual fill, thermal relief and DRC; this module never
invents filled copper. The pinned converter uses (100+x, 100-y) in mm.
"""
import math
import re
import uuid

TOKEN = re.compile(r'\s*(\(|\)|"(?:\\.|[^"\\])*"|[^\s()"]+)')
LAYERS = {"top": "F.Cu", "bottom": "B.Cu"}


def parse_board(source):
    stack = []
    root = None
    pos = 0
    while pos < len(source):
        m = TOKEN.match(source, pos)
        if not m:
            if not source[pos:].strip():
                break
            raise ValueError("Invalid KiCad token")
        pos = m.end()
        token = m[1]
        if token == "(":
            node = []
            if stack:
                stack[-1].append(node)
            elif root is not None:
                raise ValueError("Multiple KiCad roots")
            else:
                root = node
            stack.append(node)
        elif token == ")":
            if not stack:
                raise ValueError("Unexpected KiCad closing token")
            stack.pop()
        elif stack:
            stack[-1].append(token[1:-1] if token.startswith('"') else token)
        else:
            raise ValueError("KiCad atom outside root")
    if stack or not root or root[0] != "kicad_pcb":
        raise ValueError("Invalid KiCad PCB root")
    return root


def children(node, name):
    return [x for x in node if isinstance(x, list) and x and x[0] == name]


def one(node, name):
    values = children(node, name)
    if len(values) != 1:
        raise ValueError("Missing or ambiguous KiCad " + name)
    return values[0]


def finite(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("Invalid zone number")
    return value


def zone_specs(zones):
    if not isinstance(zones, list) or not 1 <= len(zones) <= 2:
        raise ValueError("Zone fill supports one zone per outer layer")
    result = {}
    used_layers = set()
    for z in zones:
        name, net, layer = z["id"], z["net"], z["layer"]
        if (not re.fullmatch(r"Z[1-9][0-9]{0,5}", name)
                or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", net)
                or layer not in LAYERS or layer in used_layers or name in result):
            raise ValueError("Invalid or overlapping zone identity/layer")
        used_layers.add(layer)
        c = finite(z["clearance"])
        b = z["bounds"]
        x0, y0, x1, y1 = (finite(b[k]) for k in ("xMin", "yMin", "xMax", "yMax"))
        if not .05 <= c <= 5 or x1-x0 < .05 or y1-y0 < .05 or max(map(abs,(x0,y0,x1,y1))) > 500:
            raise ValueError("Invalid zone clearance or bounds")
        corners = [(100+x0,100-y1),(100+x1,100-y1),(100+x1,100-y0),(100+x0,100-y0)]
        result[name] = ("/"+net, LAYERS[layer], c, corners)
    return result


def net_table(root):
    table = {}
    for node in children(root,"net"):
        if len(node) != 3 or node[1] in table:
            raise ValueError("Invalid KiCad net table")
        table[node[1]] = node[2]
    return table


def inject_zones(source, zones):
    root = parse_board(source)
    if children(root,"zone"):
        raise ValueError("Unexpected existing PCB zones")
    nets = net_table(root)
    out = []
    for name,(net,layer,c,corners) in zone_specs(zones).items():
        ids = [k for k,v in nets.items() if v == net and k.isdecimal() and int(k)>0]
        if len(ids) != 1:
            raise ValueError("Missing or ambiguous zone net: "+net)
        xy = " ".join(f"(xy {x:.6f} {y:.6f})" for x,y in corners)
        out.append(f'''(zone (net {ids[0]}) (net_name "{net}") (layer "{layer}")
          (uuid "{uuid.uuid4()}") (name "{name}") (hatch edge 0.5)
          (connect_pads (clearance {c:.6f})) (min_thickness 0.2)
          (fill yes (thermal_gap 0.25) (thermal_bridge_width 0.25) (island_removal_mode 0))
          (polygon (pts {xy})))''')
    return source.rstrip()[:-1] + "\n" + "\n".join(out) + "\n)\n"


def points(node):
    pts = one(node, "pts")
    xy = children(pts,"xy")
    if len(xy) != len(pts)-1 or any(len(p)!=3 for p in xy):
        raise ValueError("Unsupported zone polygon")
    result = [(float(p[1]),float(p[2])) for p in xy]
    if len(result)<3 or not all(math.isfinite(v) for p in result for v in p):
        raise ValueError("Invalid zone polygon")
    return result


def area(pts):
    return abs(sum(x*y2-y*x2 for (x,y),(x2,y2) in zip(pts,pts[1:]+pts[:1])))/2


def audit_filled_zones(source, zones):
    root = parse_board(source)
    expected = zone_specs(zones)
    table = net_table(root)
    actual = children(root,"zone")
    if len(actual) != len(expected):
        raise ValueError("Serialized zone count mismatch")
    results = []
    for z in actual:
        name = one(z,"name")[1]
        if name not in expected:
            raise ValueError("Unexpected serialized zone name: "+name)
        net,layer,c,corners = expected.pop(name)
        actual_net = one(z,"net")[1]
        if table.get(actual_net,actual_net)!=net:
            raise ValueError("Zone net mismatch: "+name)
        if children(z,"net_name") and one(z,"net_name")[1]!=net:
            raise ValueError("Zone net name mismatch: "+name)
        layer_fields = children(z,"layer") + children(z,"layers")
        if len(layer_fields)!=1 or layer_fields[0][1:]!=[layer]:
            raise ValueError("Zone layer mismatch: "+name)
        if abs(float(one(one(z,"connect_pads"),"clearance")[1])-c)>1e-6:
            raise ValueError("Zone clearance mismatch: "+name)
        outline = points(one(z,"polygon"))
        rounded = lambda ps: sorted((round(x,6),round(y,6)) for x,y in ps)
        if rounded(outline)!=rounded(corners):
            raise ValueError("Zone outline mismatch: "+name)
        x0,y0=corners[0]
        x1,y1=corners[2]
        fills=children(z,"filled_polygon")
        total=0
        for f in fills:
            if one(f,"layer")[1]!=layer:
                raise ValueError("Filled polygon layer mismatch: "+name)
            ps=points(f)
            if any(not x0-1e-5<=x<=x1+1e-5 or not y0-1e-5<=y<=y1+1e-5 for x,y in ps):
                raise ValueError("Filled copper outside zone outline: "+name)
            total+=area(ps)
        if total<=1e-6:
            raise ValueError("Zone has no filled copper: "+name)
        results.append({"id":name,"net":net,"layer":layer,"filledPolygons":len(fills),"polygonAreaMm2":round(total,6)})
    return results


def audit_zone_gerbers(paths, results):
    # X2 copper file function identifies the layer; region records are
    # evidence of plotting, not a full independent Gerber polygon audit.
    for layer in {z["layer"] for z in results}:
        side = "Top" if layer=="F.Cu" else "Bot"
        found=[]
        for p in paths:
            if p.suffix.lower() not in (".gbr",".gtl",".gbl"):
                continue
            s=p.read_text(encoding="ascii",errors="replace")
            if re.search(r"TF\.FileFunction,Copper,L\d+,"+side+r"(?:,|\*)",s):
                found.append(s)
        if len(found)!=1 or "G36*" not in found[0] or "G37*" not in found[0]:
            raise ValueError("Missing copper region Gerber evidence: "+layer)
