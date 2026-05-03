# @bioagent-ui/molecule-viewer

## Agent quick contract
- componentId: `molecule-viewer`
- accepts: `structure-summary`, `structure-3d-html`, `pdb-file`, `structure-list`, `pdb-structure`, `protein-structure`, `mmcif-file`, `cif-file`
- requires any of: `pdbId`, `pdb_id`, `pdb`, `uniprotId`, `dataRef`, `structureUrl`, `html`, `htmlRef`, `structureHtml`, `path`, `filePath`
- outputs: `structure-summary`
- events: `highlight-residue`, `select-chain`
- fallback: `generic-artifact-inspector`
- safety: sandboxed, declared external resources only, no code execution

## Human notes
Use this package for structure inspection and molecular context. Prefer stable identifiers or workspace file refs over inline HTML. If the structure viewer bundle is unavailable, the artifact should still expose metadata and system-open/preview fallback actions.
