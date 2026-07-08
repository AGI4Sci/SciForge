# SciForge Workspace Sequence Worker

Initial first-party TypeScript worker package for bounded sequence and genomics previews.

This package currently focuses on lightweight text summaries for common life-science formats:

- FASTA and FASTQ sequence/read counts, lengths, alphabet calls, and bounded record examples
- GenBank record lengths and feature counts from `LOCUS`, `FEATURES`, and `ORIGIN` blocks
- GFF/GTF feature counts and bounded feature examples
- BED interval counts and bounded interval examples
- VCF variant counts, sample counts, contig metadata, and bounded variant examples
- bounded indexed ranges and per-reference region summaries for sequence, feature, interval, and variant previews
- pure in-memory `selectRegion` helpers that select bounded feature/variant examples from an existing preview result
- pure in-memory `search` helpers for bounded record ids/descriptions, reference ids, feature type/id/reference fields, variant id/reference/ref/alt/type fields, indexed ranges, and sequence motifs present in record preview snippets
- WorkspaceObservation-shaped sequence summaries for the workspace preview host

Coordinates in feature examples and selections are normalized to zero-based half-open ranges.
Parsing is dependency-light and best-effort; it is intended for previews, not validation-grade genomics IO.
Search is intentionally preview-bounded: it does not reread source files and only inspects the `records`, `references`, `features`, `variants`, and `indexedRanges` already present in a preview result. Motif matches are limited to each record's bounded `preview` sequence snippet.

## Scripts

```sh
npm --prefix packages/workers/workspace-sequence run typecheck
npm --prefix packages/workers/workspace-sequence run test
```

## Example

```ts
import { WorkspaceSequenceService } from '@sciforge/workspace-sequence'

const service = new WorkspaceSequenceService()
const preview = service.preview({
  text: '>chr1\nACGTACGT\n>chr2\nAUGCAUGC\n',
  format: 'fasta',
  path: 'transcripts.fa'
})

console.log(preview.sequenceCount, preview.totalLength, preview.alphabet)

const region = service.selectRegion({
  preview,
  reference: 'chr1',
  start: 0,
  end: 8
})

console.log(region.selection, region.features, region.variants)

const search = service.search({
  preview,
  query: 'ACGT',
  scope: 'records',
  maxResults: 10
})

console.log(search.matches, search.selection, search.truncated)
```
