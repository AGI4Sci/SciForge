# @sciforge-ui/alignment-viewer

## Agent quick contract
- componentId: `alignment-viewer`
- accepts: `sequence-alignment`, `multiple-sequence-alignment`, `pairwise-alignment`, `msa`, `alignment-file`
- requires: one of `sequences`, `rows`, `alignment`, `consensus`, `dataRef`, `filePath`, or `path`
- outputs: `sequence-alignment`
- events: `select-column`, `select-region`, `select-sequence`, `highlight-residue`
- fallback: `sequence-viewer`, `generic-data-table`, `generic-artifact-inspector`
- safety: no code execution; external alignment files must be declared workspace refs
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: `sequence-alignment` primitive with `aligned: true`

## Human notes

### Data schema
Payloads should expose stable sequence ids, display labels, aligned strings of equal length when available, alphabet, optional consensus, and optional per-row annotations. Large MSA files should travel by `dataRef`, `filePath`, or `path` with a preview subset.

### Interaction/edit output semantics
`select-column` and `select-region` identify alignment coordinates; `select-sequence` identifies row ids; `highlight-residue` should carry sequence id plus residue/base coordinate. Edit outputs are future annotation or selection patches, not rewritten alignments.

### Performance/resource limits
Keep inline fixtures small. Use declared refs for large alignments and avoid loading remote alignment files directly in the renderer.

### When not to use
Do not use it for a single FASTA record, unaligned sequence collections, variant call tables, genome browsers, phylogenetic trees, or raw BLAST tabular output.

### Testing/publishing notes
Keep `basic`, `empty`, and `selection` fixtures present and scientifically plausible. Publish README, manifest, package metadata, and fixtures together so Workbench can load all variants.
