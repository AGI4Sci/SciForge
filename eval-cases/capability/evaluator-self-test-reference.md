# Synthetic evaluator self-test reference

Owner: `eval:capability:self-test`, deterministic simulation only. These entries
are deliberately independent of the installed application registry: the cases
exercise evaluator failure detection, not production capability availability.
This file must not be used to advertise, register, or authorize live capabilities.
The normal evaluator still defaults to `docs/generated/capabilities.md` and
validates every referenced action. Keep this fixture and the self-test cases in
sync; unknown IDs remain errors.

| Action | Version | Audiences | Effect | Approval | Scope |
|---|---|---|---|---|---|
| `paper-radar.search` | 1.0.0 | agent | read | none | workspace |
| `paper-radar.rank` | 1.0.0 | agent | read | none | workspace |
| `paper-radar.sync-arxiv` | 1.0.0 | agent | workspace-write | confirmation | workspace |
| `scientific-compute.run-baseline` | 1.0.0 | agent | compute | none | global |
