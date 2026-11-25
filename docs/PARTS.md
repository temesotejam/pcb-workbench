# JLCPCB-first design policy

The JLCPCB parts library is the source of part identity and assembly eligibility, not just a late BOM lookup. The AI adds and selects exact C-numbers; the user does not need to operate the CAD.

1. Discover components using the [JLCPCB official library](https://jlcpcb.com/parts) or the clearly marked unofficial [jlcsearch](https://jlcsearch.tscircuit.com/) search index. The official Parts API requires access approval; no private API credentials are needed for the current workflow.
2. Confirm the exact MPN, C-number, package, value, current stock, Economic/Standard assembly eligibility and datasheet on the official page. Do not confuse an MPN that happens to be a C-number with the real supplier identifier.
3. Add a curated catalog record to library/catalog.json, with separate identity, availability, geometry and datasheet review fields. Stock/price stay null if not checked. A catalog record is a candidate, not an approved manufacturing part.
4. Use an exact JLCPCB footprint reference (jlcpcb:C-number). The passive wrapper binds its symbol, part number, and footprint from the catalog. The build checks source/assembly reference parity and confirms physical pads. Check the actual land pattern, pad numbering, orientation and manufacturer drawing before approval.
5. Use the same resolved part records for BOM/CPL and browser inspection. Never guess rotation offsets or stock. The production release remains intentionally blocked.
6. For THT, JLCPCB documents wave-soldering/manual assembly under Standard PCBA. This does not mean every C-code is eligible: confirm the exact part is tagged for wave soldering in the live PCBA parts library and is selectable in the order. Confirm side, lead orientation, and whether SMT components on the opposite side are compatible with the chosen solder process.\n7. Complex IC symbol/pin mapping, imported and versioned geometry/3D, availability review freshness, quantity/assembly profile constraints, and revision-bound approval are future required checks.

Web library: search registered records by C-number, MPN, value, category or package, or explicitly query jlcsearch as a discovery aid. Queries are sent to an external service only when the user submits the search. Copy a C-number into a chat instruction; no automatic design changes or orders. CORS/network failure is shown rather than disguised. Search results must be curated before use in a project.

References:
- https://docs.tscircuit.com/guides/importing-modules-and-chips/importing-from-jlcpcb
- https://github.com/tscircuit/docs/blob/main/docs/web-apis/jlcsearch-api.md
- https://jlcpcb.com/help/article/jlcpcb-online-api-available-now
- https://jlcpcb.com/help/article/instruction-on-searching-jlcpcb-electronic-components\n- https://jlcpcb.com/help/article/pcb-assembly-faqs\n- https://jlcpcb.com/capabilities/pcb-assembly-capabilities

## Footprint resolver

The core Circuit instance does not configure a JLCPCB resolver automatically. `library/footprints.ts` explicitly registers an EasyEDA converter resolver and checks the returned supplier number and physical pad count. It reuses identical imports within one build. Network or identity failures stop the build; no generic footprint substitution. Persisted, reviewed footprint snapshots and model licensing review are still required for production.
