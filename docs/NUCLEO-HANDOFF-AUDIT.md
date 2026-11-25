# NUCLEO-F401RE handoff archive audit

Audit date: 2026-11-25

Source archive: \`NUCLEO-F401RE_Design_Handoff_2026-11-25.zip\`

Archive SHA-256:
\`e2716a4927e5e1d29b2cfde8b4b8d4e5a0482610081b2fd0bc76bf68eeb749d9\`

## Archive integrity

- ZIP CRC test: PASS.
- Manifest rows: 1,026.
- Every manifest path was present; byte counts and SHA-256 values matched.
- Upper native project: 6 source files matched the upper verification record.
- Lower native project: 4 source files matched the lower verification record.
- Lower verification's 6 unchanged-upper source hashes matched the exact upper native project.
- BOM/CPL reference parity: upper 72/72; lower 5/5.
- CPL coordinates and rotations matched the handoff placement table for every reference (0 mismatches).

The browser importer selects only current native project files, the upper/lower verification and preview files, and the relevant placement/pin/net tables. It does not import historical backups into the editable project.

## Board facts from the handoff

| Item | Upper NUCLEO-F401RE Rev1.5 | Lower GPIO Proto R1 |
|---|---:|---:|
| Components | 72 | 5 |
| Pins checked | 306 | 89 |
| Tracks recorded | 803 | 69 |
| Recorded PCB DRC | 0 | 0 |
| Recorded ERC errors | No errors reported; warnings remain | 0 |
| THT placements | 21 | 5 |
| SMD placements | 51 | 0 |

These are the previous EasyEDA verification records contained in the archive. They are not a fresh ERC/DRC run performed through the new local Bridge.

### Upper-board ERC warnings

The handoff reports three warning groups:

- \`ATTRMATCHCODE\`: 5 symbol attribute mismatches (J10, J11, Q3, SW1, SW2).
- \`CHECKFLOATPIN\`: 56 intentionally or potentially unconnected pins across U1, U2, U5, CN7, CN10, J11, J12 and J14.

These are retained as review items. The workbench must not silently suppress or auto-connect them without checking the circuit intent and the relevant datasheets.

### Lower-board ERC

- ERC violations: 0.
- 63 Morpho contacts are explicitly recorded as intentionally unconnected.
- The lower verification record references the exact upper project name and unchanged upper source hashes; the importer now verifies this pairing.

## JLCPCB assembly review

JLCPCB's current documentation describes THT assembly via wave soldering / manual assembly, including mixed SMT + THT on Standard PCBA. This does **not** prove that every C-code in this BOM is eligible.

The lower-board BOM records these three LCSC part identities as Extended Part / Through Hole:

- CN7, CN10 — C42372543
- J1, J2 — C124379
- J5 — C124376

The exact C-code must be selectable in the live JLCPCB PCBA parts-matching interface and marked for the supported THT process. Stock and price are live values and are not established by this archive.

### Connector-side blocker

The upper-board as-drawn CPL currently lists CN7 and CN10 on the top side. The handoff's assembly intent requires these two tall female headers on the underside of the upper board. Their CPL layer and bottom-view rotation therefore need correction and verification against JLCPCB's upload preview.

The lower-board CN7/CN10 sockets are expected on the top side. The workbench now has project-specific rules:

- Upper NUCLEO-F401RE Rev1.5: CN7/CN10 must be Bottom.
- Lower GPIO Proto R1: CN7/CN10 must be Top.

A mismatch blocks the review export. The software does not guess a bottom-side rotation.

## What remains unverified

- Fresh ERC/DRC against the actual open EasyEDA projects through the local Bridge.
- Exact current stock and assembly eligibility for every LCSC C-code.
- Datasheet-to-symbol pin mapping and footprint geometry review for every part.
- CN7/CN10 underside orientation and bottom-side CPL rotation.
- Board-to-board physical fit, connector mating, mechanical clearances and electrical bench tests.
- JLCPCB's parsed Gerber layers, drill data, BOM matching and PCBA preview.

JLCPCB references:
- [PCB Assembly FAQs](https://jlcpcb.com/help/article/pcb-assembly-faqs)
- [PCB Assembly Capabilities](https://jlcpcb.com/capabilities/pcb-assembly-capabilities)
- [Component Matching Guidelines](https://jlcpcb.com/help/article/component-matching-guidelines-for-pcba-orders)
- [Parts Library](https://jlcpcb.com/Parts)

**Release state: REVIEW ONLY — NOT APPROVED FOR ORDER.**
