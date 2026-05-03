# @bioagent-ui/artifact-preview

## Agent quick contract
- Use this package to normalize BioAgent artifact/file references into `PreviewDescriptor` objects before rendering previews.
- `normalizeArtifactPreviewDescriptor` preserves explicit artifact descriptors and infers stable fallback previews from path, dataRef, metadata, and artifact type.
- PDF/image previews prefer streamable inline descriptors; text/table/json/html previews prefer extract descriptors; office/structure/binary previews keep system-open/copy-ref fallbacks.
- Do not inline large file contents into chat context; use descriptor derivatives and locator hints instead.

## Human notes
This package is the migration boundary for artifact preview runtime logic. The app shell may still own layout and object focus state, but descriptor normalization, action selection, derivative merge, and hydration policy live here so preview behavior can be tested and published independently.
