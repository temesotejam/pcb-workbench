# JLCPCB manufacturing export

The local EasyEDA Pro Bridge export creates a review bundle from the currently attached native project. It does not fabricate a PCB or use the generic integration coupon as a substitute for the NUCLEO board.

## Generate the bundle

1. Start EasyEDA Pro and its API Gateway / Bridge Server.
2. Open the intended project and save it.
3. Start the local workbench with `start-workbench.ps1`.
4. Import the verified NUCLEO handoff ZIP, choose the matching upper or lower board, connect to the correct EasyEDA window and attach.
5. Run the fresh native ERC / DRC check.
6. Generate **JLCPCB確認用データ**. The export runs verification again, captures the native project revision, exports the files, and checks that the native source revision did not change during export.

The exported outer ZIP contains:

| File | Purpose |
|---|---|
| `Gerber.zip` | Native copper, mask, paste, outline and drill files |
| `BOM.csv` | JLCPCB BOM columns: Comment, Designator, Footprint, LCSC Part #, Quantity |
| `CPL.csv` | JLCPCB placement columns: Designator, Mid X, Mid Y, Layer, Rotation |
| `Board.step` | Optional 3D board export |
| `Netlist.net` | Optional Protel2 netlist export |
| `REVIEW_ONLY.json` | ERC/DRC, BOM/CPL parity, Gerber layer checks, native source revision, output SHA-256 hashes, blockers and warnings |
| `JLCPCB_UPLOAD_GUIDE.txt` | Upload and review sequence |
| `DO_NOT_ORDER.txt` | Explicit non-production status |

## Validation gates

The exporter blocks the bundle when required files are absent, BOM or CPL is empty, references differ, part identifiers are invalid, coordinates are non-finite, a required Gerber layer or drill file is missing, expected assembly sides are wrong, DRC/ERC is not clean, or the native source revision cannot be captured.

CPL rotations are normalized mathematically into 0–360 degrees only. No footprint-specific rotation offset or bottom-side mirror correction is guessed. The JLCPCB placement preview must confirm every rotation and side.

The exporter also checks the native project hash before and after export. If the source changes during generation, the bundle is discarded. The manifest contains the source revision and hashes of the generated manufacturing files (excluding the manifest itself).

## Not automatically approved

A clean ERC/DRC and a structurally valid export do not establish manufacturing readiness. Before ordering, manually confirm:

- Every exact LCSC C-number, MPN, package, footprint, pin mapping and current stock.
- Basic / Extended part class and the selected PCBA service.
- THT wave-soldering/manual-assembly eligibility for each through-hole part.
- CN7/CN10 assembly side and bottom-side rotation on both boards.
- Gerber layer interpretation, board outline, drill data and copper clearances in JLCPCB preview.
- BOM matching and every CPL placement/rotation in the PCBA preview.
- Mechanical mating, electrical connectivity, thermal behavior and board-to-board fit.

The current release gate intentionally keeps `orderReady=false`. The workbench never places an order or makes payment.
