# SciForge Computer Use

`sciforge-computer-use` is the sense-agnostic action loop for GUI work.

It intentionally does not import `vision-sense` or the SciForge TypeScript
runtime. The package defines stable Python contracts for:

- observing a target through any sense provider,
- planning one generic GUI action,
- locating a visual/logical target,
- executing through a host adapter,
- verifying the result,
- writing file-ref-only trace data.

`vision-sense` can be one sense provider, but the loop can also consume OCR,
browser sandbox screenshots, remote desktop frames, window metadata, or future
safe accessibility summaries.

