import unittest
from scripts.fabricate import assembly_rows

def part(ref="R1", **kw):
    return dict(ref=ref,value="10k",footprint="0805",lcsc="C123",manufacturerPart="TEST ONLY",assembly="smd",rotationOffset=10,reviewed=True) | kw
def position(ref="R1", **kw):
    return dict(Ref=ref,PosX="12.5",PosY="-8.5",Rot="355",Side="top") | kw

class AssemblyTests(unittest.TestCase):
    def test_mapping(self):
        b,c,errors=assembly_rows([part()],[position()])
        self.assertEqual(errors,[])
        self.assertEqual(b[0]["JLCPCB Part #"],"C123")
        self.assertEqual(c[0],{"Designator":"R1","Mid X":"12.500000","Mid Y":"-8.500000","Rotation":"5.0000","Layer":"Top"})
    def test_missing_part_number_and_rotation(self):
        _,_,errors=assembly_rows([part(lcsc=None,reviewed=False,rotationOffset=None)],[position()])
        self.assertEqual(len(errors),2)
    def test_mismatched_refs(self):
        with self.assertRaises(ValueError):
            assembly_rows([part()],[position("R2")])
    def test_duplicate_placement(self):
        with self.assertRaises(ValueError):
            assembly_rows([part()],[position(),position()])
    def test_bad_coordinate(self):
        with self.assertRaises(ValueError):
            assembly_rows([part()],[position(PosX="nan")])
    def test_bottom(self):
        _,c,_=assembly_rows([part()],[position(Side="back")])
        self.assertEqual(c[0]["Layer"],"Bottom")

if __name__=="__main__":
    unittest.main()
