# PCB Workbench

AI-operated, browser-based PCB design and manufacturing workspace for JLCPCB.

ユーザーはチャットで設計を指示し、AIがGitHubの設計ソースを編集・検証します。ユーザーはブラウザで結果を確認し、最終的なJLCPCBへのアップロード、発注、決済だけを行います。

## Current status: v0.5 browser workbench + local EasyEDA Pro engine — REVIEW ONLY

[![Build](https://github.com/temesotejam/pcb-workbench/actions/workflows/build.yml/badge.svg)](https://github.com/temesotejam/pcb-workbench/actions/workflows/build.yml)

- [GitHub Actions](https://github.com/temesotejam/pcb-workbench/actions): engine build, KiCad checks and draft export.
- [Web viewer](https://temesotejam.github.io/pcb-workbench/): available after the first successful Pages deployment.
- [Pages settings](https://github.com/temesotejam/pcb-workbench/settings/pages): select GitHub Actions as Source once if not already configured.
- [Roadmap](docs/ROADMAP.md): implementation milestones and acceptance criteria.

## JLCPCB-first parts

See [the parts policy](docs/PARTS.md). Register and verify actual JLCPCB C-numbers before designing. The browser exposes registered parts and an explicitly labeled external search. The current coupon uses C17414; the actual import, stock, datasheet and rotation require verification.

## Design pipeline

1. Edit a project's `design.tsx` (tscircuit) and `project.json` (metadata and curated assembly part list).
2. Generate Circuit JSON, schematic and PCB SVG, and native KiCad files.
3. Use KiCad CLI for independent ERC, DRC including schematic parity, and real manufacturing exports.
4. Convert KiCad placements to JLCPCB CSV headers, check exact designator parity and flag unverified part/rotation data.
5. Inspect reports in the browser. Draft manufacturing files are available only in the DRAFT Actions artifact, never published as order-ready files.

## Development

The browser is the design workspace. Existing EasyEDA Pro V3 projects require the EasyEDA Pro **desktop** CLI as a local engine (v4.1.60+); the online/browser edition does not expose this session bridge. Run `start-workbench.ps1` on Windows to launch a loopback-only web UI. ChatGPT can prepare native JSON patches from the editable-record export; import them in the browser, then use the local engine to run official ERC/DRC and create a review-only manufacturing package. No CAD GUI operation is needed. GitHub Actions builds and tests the public UI; private design files stay on the user's PC. For optional local development with Bun, Python 3 and KiCad 10:

```sh
bun install
python3 -m unittest discover -s tests -v
bun run build
python3 scripts/fabricate.py dist
python3 -m http.server 8000 --directory dist
```

## Release contract

- Schematic first, PCB second; every populated part must be identified by an exact LCSC part number and reviewed against its datasheet and JLCPCB assembly availability.
- Gerber ZIP with appropriate drill files, BOM CSV and CPL CSV must be generated from the same reviewed revision.
- Review actual part centroid, side, rotation, footprint/pin mapping, electrical behavior, manufacturing constraints and assembly eligibility. Never equate a passing DRC with manufacturing approval.
- Validate real files in JLCPCB's upload/preview flow before calling them order-ready.
- Preserve Git history. This is a public repository; do not publish sensitive designs or credentials.
- Production release is intentionally disabled until the required reviews and tests are implemented. No order or payment automation.

## References

- https://docs.tscircuit.com/
- https://github.com/tscircuit/circuit-json-to-kicad
- https://docs.kicad.org/10.0/en/cli/cli.html
- https://jlcpcb.com/help/article/how-to-generate-the-bom-and-centroid-file-from-kicad

## Private EasyEDA Pro handoff import

Open `handoff.html` in the deployed viewer and select a supported verified two-board handoff ZIP. The archive stays in browser memory, not on GitHub or a server. The adapter checks the manifest and recorded source hashes; native placements, pad-net mappings, linked schematic part identity, BOM/CPL reference parity and coordinates. Original previews and native route inspection are available. **Read-only, not a native CAD editor or manufacturing approval.** No real project archive is committed.

## Native edit workflow (v0.4)

The browser imports a verified handoff, downloads exact native source and a JSON index of patchable records, accepts an AI-generated guarded JSON patch, and produces a new native ZIP without stale manufacturing files. The source is preserved. The previous revision's Gerber/BOM/CPL can be downloaded as REVIEW ONLY, with explicit assembly-side warnings. Patch support is intentionally limited to listed geometry/text fields; no automatic full reroute, netlist rewrite, or approval.

`python3 scripts/easyeda_native.py path/Project.eprj3 new-output-dir --cli /path/to/easyeda-pro --step` is the private official CLI adapter. It requires a configured EasyEDA Pro v4.1.60+ runtime and headless session access. It copies the source, opens linked documents, runs strict ERC/DRC, and retrieves actual Gerber/BOM/CPL/optional STEP via official APIs. **Adapter not yet tested against an installed EasyEDA runtime.** Run only on a private authorized runner; never commit actual project data to this public repository. All outputs are review-only. Reference: https://prodocs.easyeda.com/en/api/guide/cli.html

## Local EasyEDA Pro engine

On Windows, run `start-workbench.ps1`. It checks the installed desktop client and Node.js, starts the web UI at `http://127.0.0.1:8787/handoff.html`, and binds the API to loopback only. Import the handoff ZIP in the browser, select a board, open **設計編集・出力**, and use the local engine controls. The server creates a working copy; it does not overwrite the original ZIP. The CLI's manufacture-data APIs are documented as beta preview APIs, so generated files are review-only and must be checked in JLCPCB's upload preview. Never expose the local agent via a public tunnel.

For manual start: `npm install`, set `EASYEDA_PRO_CLI` to the installed executable, then `npm run agent`. See [EasyEDA Pro CLI guide](https://prodocs.easyeda.com/en/api/guide/cli.html).
