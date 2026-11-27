import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch
from scripts.fabricate import process


class FabricationGateTests(unittest.TestCase):
    def check_blocked(self, erc, drc, fail_command=False):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            dest = root / "projects" / "sample"
            (dest / "draft").mkdir(parents=True)
            (dest / "draft" / "Gerber.zip").write_text("stale")
            (dest / "erc.json").write_text('{"sheets":[{"violations":[]}]}')
            (dest / "drc.json").write_text('{"violations":[]}')
            meta = root / "meta.json"
            meta.write_text(json.dumps({"id":"sample","layers":["F.Cu"]}))
            (dest / "project.json").write_text(json.dumps({"status":"preview","errors":[],"files":["erc.json","drc.json"],"draftFiles":["draft/Gerber.zip"],"parts":[]}))
            calls = []
            def fake_run(cmd, log):
                calls.append(cmd[:2])
                if cmd[1] not in ("erc","drc"):
                    self.fail("fabrication command ran after failed verification")
                data = erc if cmd[1] == "erc" else drc
                if data is not None:
                    pathlib.Path(cmd[cmd.index("-o")+1]).write_text(data if isinstance(data,str) else json.dumps(data))
                return 1 if fail_command else 0
            with patch("scripts.fabricate.run", side_effect=fake_run):
                self.assertFalse(process(root, meta))
            self.assertEqual(calls,[["sch","erc"],["pcb","drc"]])
            summary = json.loads((dest/"project.json").read_text())
            self.assertEqual(summary["status"],"blocked")
            self.assertFalse(summary["orderReady"])
            self.assertNotIn("draftFiles",summary)
            self.assertFalse((dest/"draft").exists())
            self.assertTrue((dest/"validation.json").is_file())
            return summary["blockers"]

    def test_short(self):
        self.assertIn("DRC has 1 error(s)",self.check_blocked({"sheets":[{"violations":[]}]},{"violations":[{"type":"shorting_items","severity":"error"}]}))

    def test_unconnected(self):
        self.assertIn("PCB has 1 unconnected item(s)",self.check_blocked({"sheets":[{"violations":[]}]},{"violations":[],"unconnected_items":[{}]}))

    def test_missing_fresh_report(self):
        self.assertIn("drc.json missing",self.check_blocked({"sheets":[{"violations":[]}]},None))

    def test_invalid_report(self):
        self.assertTrue(any("drc.json:" in b for b in self.check_blocked({"sheets":[{"violations":[]}]}, "{}")))

    def test_failed_command(self):
        self.assertIn("DRC command failed",self.check_blocked({"sheets":[{"violations":[]}]},{"violations":[]}, True))

    def test_erc_error(self):
        self.assertIn("ERC has 1 error(s)",self.check_blocked({"sheets":[{"violations":[{"severity":"error"}]}]},{"violations":[]}))
