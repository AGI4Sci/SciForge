# @bioagent-ui/report-viewer

## Agent quick contract
- componentId: `report-viewer`
- accepts: `research-report`, `markdown-report`
- requires any of: `markdown`, `sections`, `report`, `summary`, `content`, `dataRef`
- outputs: `research-report`
- events: `select-section`, `open-ref`
- fallback: `unknown-artifact-inspector`
- safety: no code execution, no external resources

## Human notes
Use this package for readable markdown or sectioned research reports. It is the primary renderer for narrative answers, summaries, and generated report artifacts. Keep the payload lightweight; large source files should be represented by `dataRef` or a preview descriptor rather than embedded wholesale into the artifact.
