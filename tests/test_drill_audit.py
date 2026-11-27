import pathlib
import tempfile
import unittest
from scripts.drill_audit import audit_manual_via_drills

HEADER = """M48
; FORMAT={-:-/ absolute / metric / decimal}
; #@! TF.FileFunction,MixedPlating,1,2
FMAT,2
METRIC
"""
VIA = "; #@! TA.AperFunction,Plated,PTH,ViaDrill\n"
DRILL = HEADER + VIA + "T1C0.350\n" + VIA + "T2C0.400\n%\nG90\nG05\nT1\nX98.0Y-98.0\nT2\nX98.0Y-102.0\nM30\n"
EXPECTED = [{"x": -2, "y": -2, "drill": .4}, {"x": -2, "y": 2, "drill": .35}]


class DrillAuditTest(unittest.TestCase):
    def audit(self, text, expected=EXPECTED):
        with tempfile.TemporaryDirectory() as d:
            path = pathlib.Path(d) / "board.drl"
            path.write_text(text)
            return audit_manual_via_drills([path], expected)

    def test_exact(self):
        self.assertEqual(self.audit(DRILL)["platedViaHoles"], 2)

    def test_empty(self):
        self.assertEqual(self.audit(HEADER + "%\nG90\nG05\nM30\n", [])["platedViaHoles"], 0)

    def test_wrong_diameter(self):
        with self.assertRaisesRegex(ValueError, "parity mismatch"):
            self.audit(DRILL.replace("0.350", "0.351"))

    def test_wrong_coordinate(self):
        with self.assertRaisesRegex(ValueError, "parity mismatch"):
            self.audit(DRILL.replace("Y-102.0", "Y-102.001"))

    def test_missing_and_extra(self):
        for modified in [DRILL.replace("X98.0Y-98.0\n", ""), DRILL.replace("X98.0Y-98.0\n", "X98.0Y-98.0\n" * 2)]:
            with self.subTest(modified=modified), self.assertRaisesRegex(ValueError, "parity mismatch"):
                self.audit(modified)

    def test_unplated(self):
        with self.assertRaisesRegex(ValueError, "plated through-via"):
            self.audit(DRILL.replace("Plated,PTH,ViaDrill", "NonPlated,NPTH,ComponentDrill"))

    def test_unsupported_commands(self):
        for modified in [DRILL.replace("G90", "G91"), DRILL.replace("METRIC", "INCH"), DRILL.replace("X98.0Y-98.0", "G85X98.0Y-98.0"), DRILL.replace("M30", "")]:
            with self.subTest(modified=modified), self.assertRaises(ValueError):
                self.audit(modified)

    def test_missing_file(self):
        with self.assertRaisesRegex(ValueError, "exactly one"):
            audit_manual_via_drills([], EXPECTED)

    def test_corrupt_drill_blocks_manufacturing(self):
        import json
        from unittest.mock import patch
        from scripts.fabricate import process
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            dest = root / "projects" / "sample"
            (dest / "draft").mkdir(parents=True)
            (dest / "draft" / "Gerber.zip").write_text("stale")
            (dest / "project.json").write_text(json.dumps({
                "status": "preview", "errors": [], "files": [], "parts": [],
                "expectedViaDrills": EXPECTED, "draftFiles": ["draft/Gerber.zip"]
            }))
            meta = root / "meta.json"
            meta.write_text(json.dumps({"id": "sample", "layers": ["F.Cu", "Edge.Cuts"]}))
            def fake_run(cmd, log):
                target = pathlib.Path(cmd[cmd.index("-o")+1])
                if cmd[1] == "erc":
                    target.write_text('{"sheets":[{"violations":[]}]}')
                elif cmd[1] == "drc":
                    target.write_text('{"violations":[]}')
                elif cmd[2] == "gerbers":
                    (target / "board-F_Cu.gbr").write_text("copper")
                    (target / "board-Edge_Cuts.gbr").write_text("outline")
                elif cmd[2] == "drill":
                    (target / "board.drl").write_text(DRILL.replace("0.350", "0.351"))
                return 0
            with patch("scripts.fabricate.run", side_effect=fake_run):
                self.assertFalse(process(root, meta))
            summary = json.loads((dest / "project.json").read_text())
            self.assertEqual(summary["status"], "blocked")
            self.assertFalse(summary["orderReady"])
            self.assertNotIn("draftFiles", summary)
            self.assertFalse((dest / "draft").exists())
            self.assertTrue(any("Plated via drill parity mismatch" in b for b in summary["blockers"]))
