# Roadmap and acceptance tests

## M0: integration coupon (this commit)
- TypeScript source -> Circuit JSON -> schematic/PCB SVG and KiCad native source.
- Real KiCad CLI ERC, DRC with schematic parity and native fabrication exports.
- Exact BOM/CPL reference matching; explicit blockers for unverified parts.
- Browser project viewer; draft export only, no production release.

## M1: engineering and manufacturing release
- Check electrical limits, netlists/pin mapping against official datasheets, footprints, native KiCad symbol electrical pin types, power nets, DNP, layer stackup and copper rules. Do not trust a lossy converter as sole authority.
- JLCPCB parts search/stock timestamp, exact MPN and LCSC number, data source, review evidence, substitutions; no fabricated inventory.
- Implement rule profiles for actual JLCPCB Economic/Standard PCB/PCBA configurations, including via/drill/edge and assembly restrictions.
- Establish verified centroid and rotation corrections from exact part/package, both sides and THT where supported.
- Compare KiCad schematic netlist, PCB pads, BOM/CPL and Gerber/drill outputs, ensure complete required layers.
- Revision-bound review approval, export bundle hash, deterministic clean generation and regression tests.
- Validate generated files in JLCPCB upload/preview before calling release-ready. User places order manually.
- Publish reviewed files only; keep draft manufacturing files separate.

## M2: richer browser experience
- Layer visibility, pan/zoom, component selection, net highlight, 3D and STEP export, design changes and revision comparison.
- Multiple projects, local/private deployment options; no credentials in repository.
- First real reference project: a small reviewed board, then complex shields.

## JLCPCB-first update (v0.2)
- Curated exact C-number library, official identity URLs, passive wrapper with JLCPCB footprint references and source/pad checks.
- Browser library and optional external jlcsearch discovery; live results are not approved parts.
- Next: verified full IC imports, local versioned geometry, current stock and PCBA profile checks.

## v0.3 EasyEDA Pro handoff

- Browser-local ZIP import for the verified two-board handoff layout; selected files only, source/manifest hashes, original drawings and native component/net/route inspection. No private design data published.
- Read-only import, not arbitrary EPRJ3 import or complete conversion. Preserve unsupported primitives and source, add verified symbol/footprint/pad/net mapping and layer/pour/outline conversion before enabling editing. Implement fresh ERC/DRC, assembly-side review, and revision-bound manufacturing export.

## v0.4 native edit + manufacturing review

- Guarded native source patches preserve unknown records and invalidate old artifacts. Browser provides source ZIP, AI record index, patch import, original manufacturing review ZIP.
- Official EasyEDA Pro CLI adapter (unverified with runtime); preferred over lossy KiCad conversion for V3 existing designs. Requires private runner and official client installation/activation. Strict checking and native export; no automatic orders.
- Remaining release gates: actual native CLI run on both boards, complete CAD editing / live viewer, JLCPCB eligibility and side/rotation resolution, exact source/export parity and JLCPCB preview, physical engineering review. No claim of production completion.

## v0.5 local native engine bridge

- Loopback-only local web server and EasyEDA Pro desktop CLI session. The browser uploads only the selected native project files to the local agent; it stores a working copy under the configured EasyEDA project root.
- Official API-backed board enumeration, PCB DRC detailed result + pass gate, schematic DRC per page, Gerber/BOM/CPL/STEP/netlist exports and BOM/CPL reference parity checks. All exports remain REVIEW_ONLY; stock, JLCPCB assembly class, underside/THT fit and final upload preview require manual confirmation.
- PowerShell launcher checks EasyEDA Pro desktop CLI >=4.1.60 and Node.js >=20. The online edition is not supported for the CLI bridge.
- Remaining: verify on the user's installed EasyEDA Pro runtime (not accessible from this cloud session), test both boards on the real client, confirm JLCPCB upload/preview and physical/electrical checks. Do not claim production release before those gates.
