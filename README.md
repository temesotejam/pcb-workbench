# PCB Workbench

AI-operated, browser-based PCB design and manufacturing workspace.

The user specifies requirements in chat; the AI edits version-controlled design sources, reviews parts, builds and validates the board. The browser is for inspection and downloading manufacturing outputs. The user alone uploads files to JLCPCB and places orders. No purchase or payment automation.

## Release contract
- Schematic first, PCB second; every populated part must be identified by an exact LCSC part number and reviewed against its datasheet and JLCPCB assembly availability.
- Generate real KiCad-compatible source and previews, then use KiCad CLI for independent ERC/DRC and fabrication exports.
- JLCPCB output: Gerber ZIP with Excellon drills when required, BOM CSV, CPL CSV. Review actual part centroid, side, rotation, footprint/pin mapping and assembly eligibility; never equate a passing DRC with manufacturing approval.
- Preserve Git history. Public demo only; sensitive project sources must not be published without permission.
- Demo data is not approved for production. Fail closed when verification is incomplete.

See the planned implementation and tests in subsequent commits.
