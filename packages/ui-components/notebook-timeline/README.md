# @bioagent-ui/notebook-timeline

## Agent quick contract
- componentId: `notebook-timeline`
- accepts: `*`
- requires: timeline, decision, notebook, or provenance events
- outputs: `notebook-timeline`
- events: `select-timeline-event`
- fallback: `generic-artifact-inspector`
- safety: no code execution, no external resources

## Human notes
Use this package only when the user asks for research logs, decisions, chronology, or notebook-style provenance. It should not be emitted as a default companion artifact.
