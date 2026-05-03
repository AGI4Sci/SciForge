# @bioagent-ui/unknown-artifact-inspector

## Agent quick contract
- componentId: `unknown-artifact-inspector`
- accepts: `*`
- requires: any artifact, ref, file, log, JSON, or metadata object
- outputs: none
- events: `open-ref`
- fallback: none
- safety: no code execution, no external resources

## Human notes
Use this package as the final safe fallback. It should show metadata, refs, diagnostics, and available preview/system-open actions without trying to execute or deeply interpret unknown payloads.
