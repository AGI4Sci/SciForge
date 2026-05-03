# @sciforge-ui/sequence-viewer

## Agent quick contract
- componentId: `sequence-viewer`
- accepts: `sequence`, `sequence-record`, `fasta`, `fasta-file`, `sequence-alignment`
- requires: one of `sequence`, `sequences`, `fasta`, `dataRef`, `filePath`, or `path`
- outputs: `sequence`, `sequence-alignment`
- events: `select-region`, `highlight-feature`, `copy-sequence`
- fallback: `sequence-alignment-viewer`, `generic-data-table`, `generic-artifact-inspector`
- safety: no code execution; external sequence files must be declared workspace refs
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: `sequence-alignment` primitive with `aligned: false` for single-sequence payloads

## Human notes

### Data schema
Prefer stable sequence identity, alphabet (`dna`, `rna`, or `protein`), optional coordinate system, and feature ranges using 1-based inclusive coordinates when possible.

### Interaction/edit output semantics
`select-region` emits sequence id and coordinate range; `highlight-feature` emits feature id/range; `copy-sequence` is a user action, not an artifact mutation.

### Performance/resource limits
Large FASTA files should use dataRef/path/filePath plus a small preview sequence. Do not fetch undeclared external sequence files.

### When not to use
Do not use it for multiple sequence alignments, pileups, variant tables, genome browsers, chromatograms, or molecular structures.

### Testing/publishing notes
Fixtures should cover basic single sequence, empty/missing sequence, and selected region/feature.
