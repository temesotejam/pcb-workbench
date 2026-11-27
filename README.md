# PCB Workbench

AI-assisted, browser-first PCB design and manufacturing workspace for JLCPCB, with a local EasyEDA Pro bridge.

## Current status: v0.8.0 — live native patch reload gate and zero-ERC/DRC integration coupon; REVIEW ONLY

[![Build](https://github.com/temesotejam/pcb-workbench/actions/workflows/build.yml/badge.svg)](https://github.com/temesotejam/pcb-workbench/actions/workflows/build.yml)

- [GitHub Actions](https://github.com/temesotejam/pcb-workbench/actions): fast code/UI tests and GitHub Pages deployment.\n- [Manufacturing verification](https://github.com/temesotejam/pcb-workbench/actions/workflows/manufacturing.yml): targeted KiCad 10 checks and draft JLCPCB exports when design, parts or fabrication sources change.
- [Web viewer](https://temesotejam.github.io/pcb-workbench/): static preview, deployed by GitHub Actions.
- [Pages settings](https://github.com/temesotejam/pcb-workbench/settings/pages): choose **GitHub Actions** as the source.
- [Roadmap](docs/ROADMAP.md): implementation status and release gates.\n- [JLCPCB export guide](docs/JLCPCB-EXPORT.md): native review-bundle generation, file contents and manufacturing acceptance gates.
- [NUCLEO handoff audit](docs/NUCLEO-HANDOFF-AUDIT.md): source integrity, board facts and PCBA blockers.

### Manual top-layer routing draft (development)

- Independent projects can store explicit top-layer routes with two same-net pad references, width and optional model-mm waypoints. The editor renders available exact-pad endpoints as orange polylines; deletion is supported. Legacy schema-v1 files without routes remain valid. Attached component movement and endpoint reassignment/deletion are blocked until the route is removed.
- This is a route editing draft, not physical DRC: shorts, clearance, pad overlap and complete connectivity are not verified. The existing converter deliberately refuses any nonempty manual route collection rather than silently replacing it with autorouting. Review only; no fabrication of manual routes yet.

### Graphical pin connection (development)

- Schematic pins can be selected in pairs to create or extend logical nets. Distinct existing nets require explicit editing; no silent merging. Dashed lines depict logical connections, not physical PCB traces. The pad preview candidate uses exact registered LCSC footprints during build: supported two-pin top SMD pads are rendered with their imported dimensions, and unsupported/missing geometry is marked unavailable. No physical routing or manufacturing approval.

### Independent browser design (early model editor)

- [New project editor](https://temesotejam.github.io/pcb-workbench/editor.html): create a blank project, add registered resistor/capacitor parts, assign logical nets and pins, edit schematic/PCB center coordinates, and save or load schema-v1 JSON. Browser local storage is a convenience; download JSON backups.
- Graphical placement preview: drag resistor/capacitor symbols or nominal PCB bodies, use arrow keys/R for placement/rotation, and synchronize edits with the validated JSON model. PCB ratlines connect imported pad centers when every endpoint is available; physical routes are not drawn. No manufacturing approval.
- No EasyEDA or Bridge is required for this editor. The browser still does not directly run the conversion engine. A separate Node/Bun build path accepts exported JSON, uses exact registered footprint identities and generates review-only previews and KiCad candidates. Physical routing and independent ERC/DRC for each design must be verified; no production approval. NUCLEO is only an example.

### Independent JSON conversion (development)

- Export project JSON from the browser, then run `bun install` and `bun run build --project-json /path/to/project.json`. No EasyEDA desktop or local Bridge is used. Exact footprint retrieval requires network access; failed imports are not substituted.
- Outputs go to ignored `dist-native/projects/native/` (not the Pages directory). With KiCad CLI installed, `python3 scripts/fabricate.py dist-native dist-native/input-projects` runs draft export and checks. Each conversion replaces the previous output; copy anything needed before rerunning.
- Native resistor and RC fixtures are built in CI alongside the legacy demo. [KiCad 10.0.8 independent verification](https://github.com/temesotejam/pcb-workbench/actions/runs/45992151267) on 27 Nov 2026 found zero ERC/DRC findings, parity conflicts or unconnected items for all three; draft Gerber/drill/BOM/CPL generation succeeded. This is fixture evidence only. Arbitrary designs, component identity/availability, centroid/rotation and JLCPCB preview must be verified separately. No order-ready output is enabled.

### What is implemented

- Import the verified NUCLEO handoff ZIP in the browser. The adapter strips its single archive root folder, selects only the current upper/lower native project sources and checks the manifest SHA-256 values. The original ZIP and native project files are not committed to this public repository.
- Select the upper or lower project, connect to the existing EasyEDA Pro API Gateway / Bridge Server on localhost ports 49620–49629, select an EasyEDA window and attach to the matching native board.
- Run fresh PCB DRC and linked schematic ERC/DRC through the official EasyEDA Pro API. Save the full verification result as JSON to share for follow-up analysis.
- Generate a JLCPCB review ZIP from the active EasyEDA Pro project: native Gerber ZIP, normalized BOM/CPL, optional STEP/netlist, upload guide, DO_NOT_ORDER marker and a JSON manifest. The manifest binds the export to a SHA-256 native source revision, hashes every generated file (except itself), checks BOM/CPL parity and required Gerber/drill layers, and records blockers/warnings. CPL angles are normalized to 0–360 only; no mirrored-side or footprint rotation offset is guessed.
- Import an AI-generated, guarded JSON patch. The browser exposes controlled editors for PCB component placement/rotation/side, existing track geometry/net assignment, existing via geometry/net assignment, schematic symbol placement/rotation and existing schematic wire endpoints. Net reassignment is limited in the UI to nets present in the imported board netlist. A separate audit lists unassigned or unknown track/via net names; it does not claim geometric pad connectivity. The editable-record export includes PCB component designators and unique IDs. Before writing, the local agent saves open EDA documents, checks every source file against the exact SHA-256 revision, writes only changed native files, reads them back, waits for the EDA reload and checks PCB component plus linked schematic component/wire counts. It keeps a backup and rolls back if the write or reload check fails. A successful edit invalidates previous DRC and manufacturing output; rerun checks.
- The local web server binds only to \`127.0.0.1\`. No public tunnel, order API or payment automation.

### Latest automated verification (25 Nov 2026)

[GitHub Actions run 45575926500](https://github.com/temesotejam/pcb-workbench/actions/runs/45575926500) completed successfully, including the GitHub Pages deployment. The generic two-resistor integration coupon was independently checked with KiCad 10.0.8:

- ERC: 0 errors, 0 warnings.
- PCB DRC: 0 violations, 0 unconnected items, 0 schematic/PCB parity issues.
- Manufacturing release: **blocked / REVIEW ONLY**. Exact LCSC part availability, component geometry/datasheets, centroid and rotation review, and JLCPCB upload preview are still outstanding.

This test coupon is a software integration fixture, **not** the NUCLEO-F401RE upper/lower boards. Those two real boards still require a fresh check in the user's EasyEDA Pro session.

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
