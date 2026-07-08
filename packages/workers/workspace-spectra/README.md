# SciForge Workspace Spectra Worker

Initial first-party TypeScript worker package for bounded life-science spectra and proteomics previews.

This package currently performs lightweight text summaries only:

- `.mgf`: counts `BEGIN IONS` spectra and numeric peak rows, with small per-spectrum metadata.
- `.mzML`: scans visible `<spectrum>` tags for scan identifiers and declared array lengths.
- `.mzXML`: scans visible `<scan>` tags for scan numbers, MS levels, and declared peak counts.
- `.fcs`: emits placeholder metadata from visible FCS headers and keyword text without parsing binary event matrices.

It also exposes pure in-memory interaction helpers for renderer and agent workflows:

- `spectra.selectPeaksByRange`: filters bounded preview `sampledPeaks` by spectrum, m/z, and intensity ranges.
- `spectra.annotateRange`: creates structured peak-range, scan-range, or FCS population/gate placeholder annotations from an existing preview. Results include a selection object, annotation summary, visible text, and warnings.
- `spectra.exportPeakList`: exports only the bounded preview `sampledPeaks` as CSV/TSV text or a JSON summary. It never claims to export the full source peak list when the preview was sampled.

It intentionally avoids heavy vendor or binary format parsers. Full mzML/mzXML/FCS decoding should be layered behind a separate runtime adapter if needed.

FCS support remains placeholder-only. The worker may summarize visible FCS keywords, event axes, and population/gate annotation intent, but it does not decode event matrices, apply real gates, or export binary event data.

## Scripts

```sh
npm --prefix packages/workers/workspace-spectra run typecheck
npm --prefix packages/workers/workspace-spectra run test
```
