# Roadmap and acceptance tests

## Independent browser CAD (priority from 2026-11-27)

- 2026-11-28: PR #4 merged at 7e843ed after [build](https://github.com/temesotejam/pcb-workbench/actions/runs/46018186704) and [manufacturing](https://github.com/temesotejam/pcb-workbench/actions/runs/46018186593) passed. Manual route draft candidate: optional schema-v1 top-layer routes with same-net exact pad endpoints, width, waypoints and deletion; browser polyline preview, referential integrity, backward compatibility and explicit conversion refusal. No clearance/short/connectivity claim. Next: real browser interaction, placement parity, exact route transfer to KiCad with independent clearance and connectivity tests.

- 2026-11-27: PR #3 merged at d601fd9 after [build](https://github.com/temesotejam/pcb-workbench/actions/runs/46009641496) and [manufacturing](https://github.com/temesotejam/pcb-workbench/actions/runs/46009641685) succeeded. Exact pad preview candidate: build-time resolver exports a strict two-pin top SMD subset, with explicit unavailable entries on unsupported geometry; browser draws actual pad sizes/positions and pin-specific ratlines. Nominal bodies are not courtyard data. No fallback fabricated pads; no physical routes or release approval. CI must check actual resolved shapes; next confirm placement parity and add route data model and editing.

- 2026-11-27: graphical placement PR #2 passed CI and merged at 751d8de. Pin connection candidate: schematic pin click/keyboard selection creates or extends a logical net atomically; distinct existing nets are never silently merged. Pin-specific schematic ratlines follow placement and rotation. PCB ratlines are still center-based; exact imported pad geometry and physical routing remain next. CI and real-browser interaction must be checked; no production approval.

- Added schema v1 project model and browser editor: blank project, board dimensions, registered passive creation/deletion, schematic and PCB center coordinates, logical nets and pin assignment, JSON import/export and local browser persistence. This is not a physical editor or a manufacturing release.
- Generic RC and resistor-pair model tests cover referential integrity, deletion, reassignment, roundtrip and review-only state. CI runs these tests.
- JSON conversion candidate: validated schema-v1 models now map to tscircuit board/parts/positions/named pin traces; KiCad generation shares the existing pipeline, with expected net names supplied by each design rather than hard-coded. Two native fixtures exercise resistor and RC designs. CLI private output is separate from Pages. CI results for this change must be checked before claiming end-to-end success.
- 2026-11-27: PR #1 initial build passed, KiCad independently passed both ERC and DRC for the resistor fixture and demo. RC fixture failed ERC (undriven generated GND power symbol) and schematic/PCB parity (two GND vs /GND conflicts); DRC geometry and unconnected items were clean. The converter now uses neutral internal net names for schema-v1 logical nets and restores exact user labels after conversion; it must not invent power declarations or waive findings. Regression tests and explicit local-label/net assertions added. Independent recheck passed: [build](https://github.com/temesotejam/pcb-workbench/actions/runs/45992151260) (24 Bun and 37 Node tests; zero failures) and [KiCad 10.0.8 manufacturing](https://github.com/temesotejam/pcb-workbench/actions/runs/45992151267). All three fixtures (demo, native-resistors, native-rc) had 0 ERC/DRC findings, 0 parity conflicts, 0 unconnected items and draft Gerber/drill/BOM/CPL generated. PR #1 merged into main at 34d5328. All exports remain orderReady=false; live component evidence, centroid/rotation and JLCPCB upload preview are outstanding.
- Graphical placement prototype: schematic passive symbols with logical net annotations, PCB outline and nominal bodies/center-to-center ratlines, pointer drag and keyboard placement/rotation synchronized through existing immutable model edits. Geometry regression tests are included in CI. Exact footprints, physical traces and browser event integration tests are outstanding; CI results for this change must be checked before claiming success.
- Next: add exact catalog footprint/pin visualization, browser interaction tests, and confirm exact model-to-output pin/net and physical placement parity, then routing. Keep manufacturing release blocked.
- EasyEDA Bridge and NUCLEO handoff remain optional compatibility and example workflows, not the primary product goal.


## Current: v0.8 local Bridge workbench — REVIEW ONLY

- Browser imports the verified two-board NUCLEO handoff ZIP, strips its archive root, verifies selected source hashes and preserves native EPRJ3/EPcb2/ESch2 data.
- The local loopback agent discovers the user's existing EasyEDA Pro API Gateway / Bridge Server (ports 49620–49629), enumerates EDA windows and attaches to the actual native board name.
- Fresh PCB DRC and linked schematic ERC/DRC run through the installed EasyEDA Pro API. Detailed errors, warnings and unknown severities are kept distinct; unknown findings block release.
- Guarded AI patch application: the browser calculates SHA-256 for every native source file; the local agent saves open EDA documents, validates the project directory and complete file set, rejects stale source, backs up the originals, writes only changed native files and reads them back.
- After a write, the local agent waits for the EasyEDA reload and compares PCB component counts and linked schematic component/wire counts with the native source. A mismatch triggers rollback. Previous DRC and fabrication outputs are invalidated.
- The browser can download the current ERC/DRC result as JSON for review and follow-up.
- Browser-native guarded editors now cover PCB component placement/rotation/side, existing track geometry and net assignment, existing via geometry and net assignment, schematic symbol placement/rotation, and existing schematic wire endpoints. Every accepted patch invalidates prior ERC/DRC and manufacturing outputs.
- A native net-assignment audit lists missing and unknown net names on PCB tracks/vias against the handoff net list. It is a metadata consistency check, not proof of geometric pad-to-pad connectivity.
- BOM/CPL normalization supports comma and tab-delimited EasyEDA output, exact LCSC C-number validation, footprint and designator checks, mm coordinate normalization, and board-specific assembly-side rules (upper CN7/CN10 bottom, lower CN7/CN10 top). The editable-record export now exposes component designators/unique IDs, and guarded patches can set `PCB:COMPONENT.layerId` to Top (1) or Bottom (2). THT items remain gated on live JLCPCB wave-soldering eligibility.
- The generic two-resistor integration coupon now passes KiCad 10.0.8 ERC and DRC with zero warnings/errors, zero unconnected items and zero schematic/PCB parity issues. The CI run also deploys the static GitHub Pages preview.
- This is not a validation result for the real NUCLEO upper/lower boards. Their fresh ERC/DRC and manufacturing export must be run in the user's EasyEDA Pro session.
- Export remains REVIEW_ONLY. EasyEDA manufacture-data APIs are beta preview. JLCPCB upload preview, live stock, PCBA eligibility, THT, orientation, electrical and physical review are required.
- ChatGPT cloud cannot directly access the local Bridge. Patch JSON is generated in chat and imported by the user in the local browser workbench. Full chat-to-PC control requires a separately installed local MCP/connector or trusted relay.

## Remaining acceptance gates

1. Run the local launcher on the user's Windows PC and confirm Bridge discovery and window selection.
2. Attach both NUCLEO projects in turn; verify native board names and project directories resolve correctly.
3. Run fresh ERC/DRC on the actual upper and lower boards; capture every violation and warning.
4. Test a harmless text/position patch on a copy; verify SHA preflight, live project update, reload object counts, backup and rollback path.
5. Test PCB component, track, via, schematic symbol and schematic wire edits on copies; confirm native EDA reload, exact netlist preservation/changes as intended, and rollback behavior. New native object creation (components, pads, tracks, vias, schematic symbols and wires) remains blocked until native record templates and identity/reference rules are verified against real EasyEDA Pro source documents.
6. Generate Gerber/BOM/CPL from the same source revision. Independently inspect all copper, mask, paste, outline and drill files.
7. Apply the upper-board CN7/CN10 bottom-side patch after confirming the selected EasyEDA project. Verify the exported CPL side and bottom-side rotation in JLCPCB preview; do not guess a mirrored angle.
8. Verify exact LCSC parts, MPNs, footprints, rotation, stock and JLCPCB PCBA support.
8. Correct the upper CN7/CN10 CPL side and validate bottom-side rotation against the JLCPCB upload preview.
9. Upload the draft files to JLCPCB's preview and compare their parsed layers, BOM and placement data. Only after a human review can the files be called order-ready.
10. The hosted static preview is deployed. The local Bridge interface remains loopback-only.

## Earlier milestones

- M0 integration coupon: tscircuit source, KiCad generation, independent KiCad CLI checks and draft manufacturing exports.
- v0.2 JLCPCB-first curated part library and C-number identity policy.
- v0.3 verified EasyEDA handoff import and native inspection.
- v0.4 guarded native record patch prototype and review-only manufacturing export.
- v0.5 CLI bridge prototype (superseded by reuse of the user's existing API Gateway / Bridge Server).
- v0.6 local Bridge discovery, board attachment, DRC and manufacturing export.
- v0.7 guarded live native patch, source-hash preflight, backup and rollback.
