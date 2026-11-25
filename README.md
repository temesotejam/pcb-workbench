# PCB Workbench

AI-assisted, browser-first PCB design and manufacturing workspace for JLCPCB, with a local EasyEDA Pro bridge.

## Current status: v0.7.0 — native patch workflow implemented; REVIEW ONLY

[![Build](https://github.com/temesotejam/pcb-workbench/actions/workflows/build.yml/badge.svg)](https://github.com/temesotejam/pcb-workbench/actions/workflows/build.yml)

- [GitHub Actions](https://github.com/temesotejam/pcb-workbench/actions): code tests, tscircuit integration coupon, KiCad checks and draft exports.
- [Web viewer](https://temesotejam.github.io/pcb-workbench/): static preview, deployed by GitHub Actions.
- [Pages settings](https://github.com/temesotejam/pcb-workbench/settings/pages): choose **GitHub Actions** as the source.
- [Roadmap](docs/ROADMAP.md): implementation status and release gates.\n- [NUCLEO handoff audit](docs/NUCLEO-HANDOFF-AUDIT.md): source integrity, board facts and PCBA blockers.

### What is implemented

- Import the verified NUCLEO handoff ZIP in the browser. The adapter strips its single archive root folder, selects only the current upper/lower native project sources and checks the manifest SHA-256 values. The original ZIP and native project files are not committed to this public repository.
- Select the upper or lower project, connect to the existing EasyEDA Pro API Gateway / Bridge Server on localhost ports 49620–49629, select an EasyEDA window and attach to the matching native board.
- Run fresh PCB DRC and linked schematic ERC/DRC through the official EasyEDA Pro API.
- Export native Gerber, BOM, CPL, STEP and netlist where the installed API supports them. Normalize BOM/CPL columns and coordinates, check designator parity, required Gerber layers, LCSC part IDs and known THT/underside warnings.
- Import an AI-generated, guarded JSON patch. Before writing, the local agent saves open EDA documents, checks every source file against the exact SHA-256 revision, writes only changed native files, reads them back, keeps a backup and rolls back if a write fails. A successful edit invalidates previous DRC and manufacturing output; rerun checks.
- The local web server binds only to \`127.0.0.1\`. No public tunnel, order API or payment automation.

### Important limits

- This ChatGPT cloud conversation cannot directly connect to a service running on your PC's \`localhost\`. ChatGPT can prepare the patch JSON; you load it into the local browser workbench. The local agent then applies it to the open EasyEDA project. A fully hands-free chat-to-PC connection would require a separately installed local MCP/connector or trusted relay.
- The GitHub Actions green build verifies the generic integration coupon and software pipeline, **not** the actual NUCLEO upper/lower boards. The original handoff contains earlier board-specific verification reports, but a fresh check must be run against the user's currently open EasyEDA project.
- EasyEDA Pro manufacture-data APIs are documented as beta preview APIs. Generated bundles are **REVIEW ONLY**, never automatically marked order-ready.
- The supplied 2026-11-25 NUCLEO handoff archive has 1,026 manifest entries; its CRC and manifest SHA-256 values, both projects' native source hashes, BOM/CPL reference parity and all placement coordinates/rotations were independently checked. The upper board is 72 parts / 306 pins / 803 tracks with recorded DRC 0; the lower is 5 parts / 89 pins / 69 tracks with recorded ERC 0 and DRC 0. These are the handoff's existing EasyEDA checks, not a new local Bridge run.\n- The upper board's as-drawn CPL currently marks CN7/CN10 as Top, although the stack-up instructions require those connectors on the underside. The export gate now blocks this mismatch. The lower board expects CN7/CN10 on Top.\n- JLCPCB documents Standard PCBA wave-soldering/manual assembly for THT, but the exact C-code must be marked eligible in the live parts library and selected in the order. Stock, exact part identity, Basic/Extended status, THT process, footprint/pin mapping, centroid/rotation, board outline, drill files and upload preview must be confirmed before ordering.
- The local Bridge integration and native file write are covered by code/unit tests but have not yet been exercised against the user's live Windows EasyEDA session in this cloud run.

## Start the local workbench (Windows)

1. Start EasyEDA Pro and its existing API Gateway / Bridge Server. Open the intended NUCLEO project in the EDA window.
2. Clone this repository and run \`start-workbench.ps1\` from PowerShell.
3. In the browser, import \`NUCLEO-F401RE_Design_Handoff_2026-11-25.zip\`.
4. Open **設計編集・出力**, connect to the Bridge, select the correct EasyEDA window and attach to the selected board.
5. Run ERC/DRC. Apply a guarded AI patch only after confirming the active project/revision. Rerun ERC/DRC and generate a review-only export after each edit.

Requirements: Windows, Node.js 20+, npm, EasyEDA Pro desktop and the already-installed API Gateway / Bridge Server. The launcher installs npm dependencies when missing and serves the UI at \`http://127.0.0.1:8787/handoff.html\`. Close the separate Node server console to stop it.

## JLCPCB-first parts

See [the parts policy](docs/PARTS.md). Use exact LCSC C-numbers and verify current stock, package/footprint, manufacturer part number and assembly capability. Never infer inventory or substitute parts silently.

## Release contract

- Schematic-first; all populated components have an exact manufacturer and LCSC identity.
- Gerber ZIP, drill, BOM and CPL are generated from the same reviewed native project revision.
- Check schematic-to-PCB netlist parity, pads, pin mapping, footprint, board outline, stackup, copper clearances, THT/SMT assembly side and centroid/rotation.
- Verify JLCPCB's actual upload/preview, stock and assembly eligibility.
- User places the order and pays manually. No production release until engineering and manufacturing reviews pass.

## References

- https://prodocs.easyeda.com/en/api/guide/cli.html
- https://prodocs.easyeda.com/en/api/reference/pro-api.html
- https://docs.tscircuit.com/
- https://docs.kicad.org/10.0/en/cli/cli.html
- https://jlcpcb.com/help/article/how-to-generate-the-bom-and-centroid-file-from-kicad
