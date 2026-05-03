# @sciforge-ui/structure-viewer

## Agent quick contract
- componentId: `structure-viewer`
- accepts: `structure-3d`, `structure-summary`, `structure-3d-html`, `pdb-file`, `structure-list`, `pdb-structure`, `protein-structure`, `mmcif-file`, `cif-file`
- requires any of: `pdbId`, `pdb_id`, `pdb`, `uniprotId`, `dataRef`, `structureUrl`, `html`, `htmlRef`, `structureHtml`, `path`, `filePath`
- outputs: `structure-3d`, `structure-summary`
- events: `highlight-residue`, `select-chain`
- fallback: `generic-artifact-inspector`
- safety: sandboxed, declared external resources only, no code execution
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- replacement route: supersedes `molecule-viewer`; historical `molecule-viewer` remains an alias during migration

## Human notes
Use this package for structure artifacts with PDB/mmCIF refs, identifiers, residue selections, metrics, and declared HTML previews. This renderer is package-native and avoids app-private 3D viewer imports; rich 3D engines can be added behind the same contract later.

## 何时不要使用该组件
Do not use it for sequence-only records, docking score tables without coordinate refs, or static screenshots.
