# SciForge Workspace Omics Worker

Initial first-party TypeScript worker package for lightweight workspace omics matrix summaries.

This package currently focuses on safe metadata extraction rather than matrix payload parsing:

- detects Matrix Market text and parses dimensions, storage mode, field type, symmetry, and non-zero count
- extracts bounded JSON or key-value metadata from text sidecars and lightweight metadata snippets
- exposes pure in-memory dataset selection for matrix ids/names, obs keys, var keys, embedding names, and matrix-axis ranges from an existing preview result
- declares capabilities for `.mtx`, `.h5ad`, `.loom`, `.h5`, `.hdf5`, and `.zarr`
- emits a WorkspaceObservation-shaped omics summary for the workspace preview host
- treats HDF5-backed and Zarr-backed formats as safe placeholders unless text metadata is supplied

It intentionally does not parse HDF5, AnnData, Loom, or Zarr binary payloads, does not read files from disk, and does not add heavy scientific dependencies. Dataset selection is metadata-only: it matches against `preview.dataset`, `preview.matrices`, and bounded metadata summaries, and reports missing requests instead of attempting to decode matrix payloads. Axis ranges are zero-based half-open ranges and are clipped only when a matrix or dataset dimension is already present in the preview summary.

## Scripts

```sh
npm --prefix packages/workers/workspace-omics run typecheck
npm --prefix packages/workers/workspace-omics run test
```

## Example

```ts
import { WorkspaceOmicsService } from '@sciforge/workspace-omics'

const service = new WorkspaceOmicsService()
const preview = service.preview({
  text: '%%MatrixMarket matrix coordinate real general\n3 4 5\n',
  path: 'counts.mtx'
})

console.log(preview.matrices[0])

const selection = service.selectDataset({
  preview,
  matrixIds: ['matrix-1'],
  ranges: [{ matrixId: 'matrix-1', axis: 'row', start: 0, end: 3 }]
})

console.log(selection.selection, selection.warnings)
```
