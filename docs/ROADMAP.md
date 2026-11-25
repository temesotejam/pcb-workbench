# Roadmap and acceptance tests

## Current: v0.7 local Bridge workbench

- Browser imports the verified two-board NUCLEO handoff ZIP, strips its archive root, verifies selected source hashes and preserves native EPRJ3/EPcb2/ESch2 data.
- The local loopback agent discovers the user's existing EasyEDA Pro API Gateway / Bridge Server (ports 49620–49629), enumerates EDA windows and attaches to the actual native board name.
- Fresh PCB DRC and linked schematic ERC/DRC run through the installed EasyEDA Pro API. The current project must be saved and stable before any write.
- Guarded AI patch application: the browser calculates SHA-256 for every native source file; the local agent saves open EDA documents, validates the project directory and complete file set, rejects stale source, backs up the originals, writes only changed native files, reads them back and attempts rollback on failure.
- A successful patch invalidates prior verification and fabrication outputs. DRC/ ERC must be rerun before new review exports.
- BOM/CPL normalization supports comma and tab-delimited EasyEDA output, exact LCSC C-number validation, footprint and designator checks, mm coordinate normalization, and board-specific assembly-side rules (upper CN7/CN10 bottom, lower CN7/CN10 top). THT items remain gated on live JLCPCB wave-soldering eligibility.
- Export remains REVIEW_ONLY. EasyEDA manufacture-data APIs are beta preview. JLCPCB upload preview, live stock, PCBA eligibility, THT, orientation, electrical and physical review are required.
- CI green means software checks and the generic integration coupon pass. It does not mean the actual NUCLEO boards pass or are ready to order.
- ChatGPT cloud cannot directly access the local Bridge. Patch JSON is generated in chat and imported by the user in the local browser workbench. Full chat-to-PC control requires a separately installed local MCP/connector or trusted relay.

## Remaining acceptance gates

1. Run the local launcher on the user's Windows PC and confirm Bridge discovery and window selection.
2. Attach both NUCLEO projects in turn; verify native board names and project directories resolve correctly.
3. Run fresh ERC/DRC on the actual upper and lower boards; capture every violation and warning.
4. Test a harmless text/position patch, verify SHA preflight, live project update, backup and rollback path.
5. Test a controlled routing/footprint change on a copy; confirm the native EDA document reloads and the netlist remains correct.
6. Generate Gerber/BOM/CPL from the same source revision. Independently inspect all copper, mask, paste, outline and drill files.
7. Resolve CN7/CN10 underside THT placement and verify exact LCSC parts, MPNs, footprints, rotation, stock and JLCPCB PCBA support.
8. Correct the upper CN7/CN10 CPL side and validate bottom-side rotation against the JLCPCB upload preview.\n9. Upload the draft files to JLCPCB's preview and compare their parsed layers, BOM and placement data. Only after a human review can the files be called order-ready.
10. The hosted static preview is deployed. The local Bridge interface remains loopback-only.

## Earlier milestones

- M0 integration coupon: tscircuit source, KiCad generation, independent KiCad CLI checks and draft manufacturing exports.
- v0.2 JLCPCB-first curated part library and C-number identity policy.
- v0.3 verified EasyEDA handoff import and native inspection.
- v0.4 guarded native record patch prototype and review-only manufacturing export.
- v0.5 CLI bridge prototype (superseded by reuse of the user's existing API Gateway / Bridge Server).
- v0.6 local Bridge discovery, board attachment, DRC and manufacturing export.
