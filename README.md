# PCB Workbench

AI-assisted, browser-first PCB design and manufacturing workspace for JLCPCB, with a local EasyEDA Pro bridge.

## Current status: v0.8.0 — live native patch reload gate and zero-ERC/DRC integration coupon; REVIEW ONLY

[![Build](https://github.com/temesotejam/pcb-workbench/actions/workflows/build.yml/badge.svg)](https://github.com/temesotejam/pcb-workbench/actions/workflows/build.yml)

- [GitHub Actions](https://github.com/temesotejam/pcb-workbench/actions): fast code/UI tests and GitHub Pages deployment.\n- [Manufacturing verification](https://github.com/temesotejam/pcb-workbench/actions/workflows/manufacturing.yml): targeted KiCad 10 checks and draft JLCPCB exports when design, parts or fabrication sources change.
- [Web viewer](https://temesotejam.github.io/pcb-workbench/): static preview, deployed by GitHub Actions.
- [Pages settings](https://github.com/temesotejam/pcb-workbench/settings/pages): choose **GitHub Actions** as the source.
- [Roadmap](docs/ROADMAP.md): implementation status and release gates.\n- [JLCPCB export guide](docs/JLCPCB-EXPORT.md): native review-bundle generation, file contents and manufacturing acceptance gates.
- [NUCLEO handoff audit](docs/NUCLEO-HANDOFF-AUDIT.md): source integrity, board facts and PCBA blockers.

### Draft copper clearance feedback (development)

- 2026-11-28: PR #14 passed [build/Chromium](https://github.com/temesotejam/pcb-workbench/actions/runs/46093891200) and [independent manufacturing](https://github.com/temesotejam/pcb-workbench/actions/runs/46093891224), merged at c2905f0. New candidate: browser advisory different-net clearance scan for manual track capsules and through-via outer copper disks, layer-aware and configurable (0.2 mm reference default, not a fabrication profile). Bounded scan reports incomplete, never certifies pads, holes, board rules or connectivity; no changes to export gates. Added Node and Chromium regressions; CI pending. Next: integrate existing MIT capacity-autorouter obstacle input, copper zones, and browser-accessible manufacturing. No production approval.

### Mixed whole-net routing (development)

- 2026-11-28: PR #14 initial [build/Chromium](https://github.com/temesotejam/pcb-workbench/actions/runs/46089329590) passed; [manufacturing](https://github.com/temesotejam/pcb-workbench/actions/runs/46089329582) failed with KeyError layers on the first mixed fixture after both mixed boards passed serialized route parity. Root cause: native build derived the correct layer profile but fabrication re-read the lightweight fixture manifest. Persist effective fabricationLayers in the board's build summary, consume it with validation and preserve explicit legacy fallback; missing/malformed profiles block and remove stale drafts with diagnostics. Added unit regressions; rerun independent verification before merging. No DRC gate relaxed or production approval.

- PR #13 passed both [build including Chromium](https://github.com/temesotejam/pcb-workbench/actions/runs/46083410925) and [independent manufacturing](https://github.com/temesotejam/pcb-workbench/actions/runs/46083410905), merged at e4050d5. New candidate: mixed routing by complete manual nets and untouched automatic nets. The existing engine proposes routes for all nets, its positively identified copper on manual nets is discarded, and exact manual routes are injected. Other nets retain wire-only copper. Partial manual nets, unknown trace identities, automatic vias or unknown serialized net IDs fail closed; actual manual segments and all via holes still require exact parity and independent DRC. Automatic routing does not yet consider manual copper as obstacles, so collisions can cause rejection, not automatic repair. Two generic mixed fixture boards added; CI pending. No production approval.

### Draft routing progress (development)

- PR #12 passed [build](https://github.com/temesotejam/pcb-workbench/actions/runs/46077774469) and [manufacturing](https://github.com/temesotejam/pcb-workbench/actions/runs/46077774468), merged at 868d00d. Candidate: PCB ratlines now connect remaining draft connectivity groups only; removing a route restores the corresponding missing links. Only successfully rendered routes count, with no physical DRC claim. Added graph regression tests and a real Chromium interaction smoke test against the generated site (CI pending); no production approval.

### Two-layer routing and drill parity (development)

- PR #11 graphical via insertion merged at f056c1f after [build](https://github.com/temesotejam/pcb-workbench/actions/runs/46071284995) and [manufacturing](https://github.com/temesotejam/pcb-workbench/actions/runs/46071284971) passed. New candidate audits the actual KiCad absolute metric decimal Excellon drill file against the manual model (1 µm resolution), including plating classification, count, coordinates and diameters; mismatch or unsupported syntax blocks the entire draft export. This is restricted to current all-top-SMD manual boards with through-vias, not arbitrary hole or slot formats. CI pending; real browser interaction remains outstanding.

- PR #10 passed [build](https://github.com/temesotejam/pcb-workbench/actions/runs/46064904770) and [independent KiCad manufacturing](https://github.com/temesotejam/pcb-workbench/actions/runs/46064904674) and merged at f3634d8. The crossed two-layer fixture passed with exactly five serialized copper segments and two through-vias, alongside the other five fixture boards. Draft only; independent Excellon drill-file parity is still outstanding.
- Graphical via candidate: Shift-click the board or select the one-shot via option, with explicit outer and hole diameters. The temporary route changes color by layer, shows via rings and requires return to top before committing to an SMD pad. Backspace removes the last temporary waypoint. Browser interaction and CI remain to be verified.

- Optional waypoint `via: {diameter, drill}` switches between top and bottom copper. Both endpoints are top SMD pads; an even number of through-vias is mandatory. Numeric entry accepts `x,y` or `x,y,diameter,drill` in mm; routes preserve via dimensions in schema-v1 JSON and display copper by layer plus via rings. No blind/buried vias or bottom components. This is a geometry draft, not a manufacturing rule profile. The explicitly enabled build converter supports via-bearing complete manual designs, with serialized segment/via parity and independent KiCad DRC. Excellon drill-file parity remains outstanding. Existing top-layer route workflow is unchanged.

### Manual two-layer routing candidate (development)

- PR #9 two-layer draft merged after both CI workflows passed. This candidate uses pinned MIT circuit-json-to-kicad v0.0.282 route-defined vias and layer-tagged wire points, with exact serialized segment/via geometry, net and layer parity before KiCad independent checks. A crossing resistor fixture exercises two plated holes with distinct dimensions. Manufacturing CI is pending; no production approval. Graphical via insertion and drill-file coordinate audit remain outstanding.

### Manual top-layer routing draft (development)

- Candidate manual export: the build opts into complete explicit top-layer routing, disables automatic routing and injects exact Circuit JSON wire points only after checking source pin, PCB port and real pad center agreement. Partial nets, missing geometry or unexpected existing copper fail closed. Two new manual fixture boards exercise the existing KiCad pipeline. A serialized segment audit checks coordinates, width, top copper and net identity; independent DRC remains separate. [CI verification passed](https://github.com/temesotejam/pcb-workbench/actions/runs/46044284029) for five fixture boards, including two manual designs. No production approval. A new export gate candidate prevents creating Gerber/BOM/CPL on failed electrical/physical checks and removes stale draft outputs; independent negative tests are pending.

- Graphical route mode: choose a real pad, click the board to place 0.25 mm snapped waypoints, then select a different pad on the same logical net. The selected width is fixed at the start; Escape or leaving the mode discards the uncommitted draft. Numeric entry remains available. Physical DRC is not performed in the editor; candidate build export requires independent verification.

- Independent projects can store explicit top-layer routes with two same-net pad references, width and optional model-mm waypoints. The editor renders available exact-pad endpoints as orange polylines; deletion is supported. Legacy schema-v1 files without routes remain valid. Attached component movement and endpoint reassignment/deletion are blocked until the route is removed.
- This is a route editing draft, not physical DRC: shorts, clearance, pad overlap and complete connectivity are not verified. The default adapter refuses manual routes unless explicitly enabled by the build; the candidate path never fills missing manual nets with autorouting. Review only until independent verification.

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
