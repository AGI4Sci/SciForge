# Scientific Trace Report Template

## Summary

- Trace ID:
- Scientific goal:
- Runtime:
- Reviewer:
- Decision:

## Required Closure Checklist

- [ ] User input is present.
- [ ] At least one artifact is present.
- [ ] At least one evidence event is present.
- [ ] Human review has a reason.
- [ ] Every non-root event references an existing parent event.
- [ ] Credentials are redacted.
- [ ] PII is redacted or rejected.

## Timeline

| Time | Event ID | Type | Actor | Parent | Summary |
| --- | --- | --- | --- | --- | --- |
|  |  | USER_INPUT |  |  |  |
|  |  | AGENT_ACTION |  |  |  |
|  |  | COMMAND_EXECUTION |  |  |  |
|  |  | ARTIFACT_CREATED |  |  |  |
|  |  | EVIDENCE_ATTACHED |  |  |  |
|  |  | HUMAN_REVIEW_RECORDED |  |  |  |

## Inputs

| Input Ref | Description | Producer |
| --- | --- | --- |
|  |  |  |

## Artifacts

| Artifact Ref | Path/URI | Hash | Parent Event |
| --- | --- | --- | --- |
|  |  |  |  |

## Evidence

| Evidence Ref | Evidence Type | Target | Parent Event |
| --- | --- | --- | --- |
|  |  |  |  |

## Human Review

| Reviewer | Decision | Reason | Event ID |
| --- | --- | --- | --- |
|  |  |  |  |

## Validation Result

- Event validation:
- Trace closure validation:
- Redaction validation:

## Notes

Use this report as the human-readable view of the JSONL trace. The JSONL file remains the machine-readable source of truth.
