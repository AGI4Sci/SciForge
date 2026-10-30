# SciForge Workspace Molecular Worker

First-party TypeScript worker package for bounded molecular previews.

This package currently focuses on dependency-light text summaries for common structure formats:

- PDB: atom, chain, residue, ligand, model, and element summaries
- mmCIF/CIF: `_atom_site` loop atom, chain, residue, ligand, model, and element summaries
- SDF/MOL: molecule, atom, bond-count, and element/formula summaries from V2000/V3000 molfile records
- MOL2: Tripos `MOLECULE`, `ATOM`, `BOND`, and `SUBSTRUCTURE` section summaries with ligand/residue mapping
- XYZ: single or concatenated record atom, molecule/model, and element/formula summaries
- keeps parsing dependency-free
- emits a WorkspaceObservation-shaped molecular summary for the workspace preview host plus richer worker-owned structured counts

The worker also exposes pure in-memory foundations for PyMOL-like agent/renderer interactions:

- `workbench`: applies a single molecular workbench state update against an existing bounded preview. The state can include selection by chain, residue, ligand, or atom id/index/element, plus one measurement request.
- Measurements use one unified shape: `distance` resolves two atoms and returns angstroms; `angle` resolves three atoms and returns degrees; `dihedral` resolves four atoms and returns degrees. The worker computes a value only when all referenced bounded atom summaries include usable coordinates; otherwise it returns `coordinateAvailable: false` with warnings instead of inventing geometry.

It intentionally does not parse binary trajectory/density formats (`.xtc`, `.dcd`, `.trr`, `.mrc`, `.ccp4`), start an MCP server, or bundle a WebGL viewer yet.

## Scripts

```sh
npm --prefix packages/workers/workspace-molecular run typecheck
npm --prefix packages/workers/workspace-molecular run test
```
