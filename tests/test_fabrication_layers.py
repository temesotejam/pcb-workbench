import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

from scripts.fabricate import fabrication_layers, process


LAYERS = ["F.Cu", "B.Cu", "F.Paste", "B.Paste", "F.Mask", "B.Mask",
          "F.SilkS", "B.SilkS", "Edge.Cuts"]


class FabricationLayerTests(unittest.TestCase):
    def test_generated_profile_is_authoritative(self):
        self.assertEqual(fabrication_layers({"fabricationLayers": LAYERS}, {"id": "native"}), LAYERS)
        self.assertEqual(fabrication_layers({"fabricationLayers": LAYERS}, {"layers": ["F.Cu"]}), LAYERS)
        self.assertEqual(fabrication_layers({}, {"layers": LAYERS}), LAYERS)

    def test_invalid_profile_never_falls_back(self):
        for invalid in (None, [], "F.Cu", ["F.Cu", "F.Cu"], ["F.Cu,B.Cu"], [" F.Cu"], [1]):
            with self.subTest(invalid=invalid):
                with self.assertRaisesRegex(ValueError, "layer profile"):
                    fabrication_layers({"fabricationLayers": invalid}, {"layers": LAYERS})
        with self.assertRaisesRegex(ValueError, "layer profile"):
            fabrication_layers({}, {})

    def test_missing_profile_blocks_and_removes_stale_export(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            dest = root / "projects" / "native"
            dest.mkdir(parents=True)
            meta = root / "input.json"
            meta.write_text(json.dumps({"id": "native"}))
            summary = dest / "project.json"
            summary.write_text(json.dumps({"status": "preview", "errors": [],
                                           "files": [], "draftFiles": ["draft/Gerber.zip"]}))
            draft = dest / "draft"
            draft.mkdir()
            (draft / "Gerber.zip").write_text("stale")
            with patch("scripts.fabricate.run") as run:
                self.assertFalse(process(root, meta))
                run.assert_not_called()
            self.assertFalse(draft.exists())
            output = json.loads(summary.read_text())
            self.assertEqual(output["status"], "blocked")
            self.assertFalse(output["orderReady"])
            self.assertNotIn("draftFiles", output)
            self.assertIn("Missing or invalid fabrication layer profile",
                          json.loads((dest / "validation.json").read_text())["blockers"])


if __name__ == "__main__":
    unittest.main()
