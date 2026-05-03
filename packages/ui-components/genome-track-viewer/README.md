# @sciforge-ui/genome-track-viewer

## Agent quick contract
- componentId: `genome-track-viewer`
- accepts: `genome-track`, `genomic-range`, `bed-track`, `gff-track`, `vcf-variants`, `coverage-track`
- requires: one of `genome`, `range`, `tracks`, `features`, `variants`, `coverage`, or `dataRef`
- outputs: `genome-track`, `visual-annotation`, `record-set`
- events: `select-genomic-range`, `select-feature`, `select-variant`, `open-track-ref`
- fallback: `generic-data-table`, `generic-artifact-inspector`
- safety: no code execution; large or external BED/GFF/VCF/BAM resources must be declared refs
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: genomic range track over `record-set` plus `visual-annotation`

## Human notes

### Data schema
Payloads should include genome build, chromosome/range coordinates, typed tracks, small inline feature/variant/coverage previews, and refs for large BED/GFF/VCF/BAM resources.

### Interaction/edit output semantics
Range, feature, and variant selection events emit genomic coordinates plus stable feature/variant ids. Open-ref events delegate track loading to host policy. Edit outputs are future visual annotations, not genome data mutation.

### Performance/resource limits
This skeleton does not bundle a genome browser, BAM parser, or tiled renderer. Keep large tracks behind declared refs and render compact previews only.

### When not to use
Do not use it for full interactive genome browsing, raw BAM/CRAM inspection, sequence-only FASTA records, or non-genomic interval tables.

### Testing/publishing notes
Keep `fixtures/basic.ts`, `fixtures/empty.ts`, and `fixtures/selection.ts` present and aligned with manifest `workbenchDemo`.
