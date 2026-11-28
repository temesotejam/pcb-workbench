import pathlib
import tempfile
import unittest
from scripts.zone_fill import inject_zones, audit_filled_zones, audit_zone_gerbers

BOARD='(kicad_pcb (net 1 "/GND") (net 2 "/VCC"))'
ZONES=[dict(id="Z1",net="GND",layer="top",clearance=.2,bounds=dict(xMin=-2,yMin=-3,xMax=2,yMax=3))]
FILL='(filled_polygon (layer "F.Cu") (pts (xy 99 98) (xy 101 98) (xy 101 102) (xy 99 102)))'

def filled():
    s=inject_zones(BOARD,ZONES)
    return s.rstrip()[:-1].rstrip()[:-1]+FILL+'))'

class ZoneFillTests(unittest.TestCase):
    def test_inject_and_audit(self):
        s=filled()
        self.assertIn('(net 1) (net_name "/GND")',s)
        self.assertEqual(audit_filled_zones(s,ZONES)[0]["polygonAreaMm2"],8)
    def test_reject_unfilled(self):
        with self.assertRaisesRegex(ValueError,"no filled copper"):
            audit_filled_zones(inject_zones(BOARD,ZONES),ZONES)
    def test_reject_wrong_net_layer_outline_or_clearance(self):
        s=filled()
        for old,new in [('(net 1)','(net 2)'),('(layer "F.Cu")','(layer "B.Cu")'),('(xy 98.000000 97.000000)','(xy 97.000000 97.000000)'),('(clearance 0.200000)','(clearance 0.100000)')]:
            with self.subTest(old=old),self.assertRaises(ValueError):
                audit_filled_zones(s.replace(old,new),ZONES)
    def test_reject_outside_fill(self):
        with self.assertRaisesRegex(ValueError,"outside"):
            audit_filled_zones(filled().replace("(xy 99 98)","(xy 97 98)"),ZONES)
    def test_reject_duplicate_layer_and_existing_zone(self):
        with self.assertRaises(ValueError):
            inject_zones(BOARD,ZONES+[dict(ZONES[0],id="Z2")])
        with self.assertRaises(ValueError):
            inject_zones(inject_zones(BOARD,ZONES),ZONES)
    def test_new_net_name_serialization(self):
        s=filled().replace('(net 1) (net_name "/GND")','(net "/GND")').replace('(net 1 "/GND")','').replace('(net 2 "/VCC")','')
        self.assertEqual(audit_filled_zones(s,ZONES)[0]["net"],"/GND")
    def test_gerber_regions(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/"top.gbr"
            p.write_text("%TF.FileFunction,Copper,L1,Top*%\nG36*\nG37*\n")
            r=audit_filled_zones(filled(),ZONES)
            audit_zone_gerbers([p],r)
            p.write_text("%TF.FileFunction,Copper,L1,Top*%\n")
            with self.assertRaises(ValueError):
                audit_zone_gerbers([p],r)
