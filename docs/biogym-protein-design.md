# BioGym protein-design integration

SciForge exposes BioGym as one native-only tool named `biogym_design`. BioGym
is an execution backend, not a second agent: SciForge chooses each scientific
stage while the Electron main process owns SSH, idempotency, monitoring,
artifact verification, Biology Room updates, and agent continuation.

## Configure

Open **Settings → Remote Resources → BioGym protein design** and set:

- BioGym CLI path: an absolute path such as
  `/path/to/biogym/.venv/bin/biogym`;
- SSH alias: an alias from the user's SSH config with access to the BioGym host;
- remote root: the absolute BioGym project path on that host.

Use **Check BioGym readiness**, then enable the integration. Fresh and
packaged installations remain disabled until all three values are configured
explicitly and the remote doctor succeeds.

On macOS, the BioGym root CLI must use a standard wheel install, not a
setuptools editable install. Python 3.12 skips `.pth` files when macOS reapplies
`UF_HIDDEN` below `.venv`; BioGym's `scripts/setup_macos.sh` already enforces
the standard-install path.

## Runtime model

- One approved design run creates one isolated Beam session and one Biology
  Room.
- `start` and `extend_budget` require explicit approval. In-budget stages do
  not prompt again.
- GPU work is never polled by the model. `advance` returns a durable queued
  attempt; the host monitor resumes the owning SciForge thread once.
- The user does not need to send a follow-up such as "continue". After a stage
  reaches a terminal state, the controller waits for any foreground turn to
  finish, revalidates the run revision and owner, and starts one durable agent
  continuation. Continuation delivery is retried after restart without
  duplicating an agent turn or GPU job.
- A new user turn, manual stage action, or cancellation invalidates a pending
  automatic continuation immediately before it starts. This prevents a stale
  background result from racing with newer user intent.
- Every mutation has a caller-persisted idempotency key. A replay after a lost
  SSH response recovers the original operation instead of creating another
  receiver job.
- The approved wall-clock deadline bounds mutation submission, backend polling,
  and artifact recovery. Expiry stops the stage and requests best-effort
  cancellation of the active receiver job.
- Only registered artifacts that pass local size and SHA-256 verification are
  added to Biology Room. Partial downloads are never displayed.
- A cancelled run accepts no new stages. An already-running receiver task may
  continue until backend cancellation is acknowledged.
- Indeterminate operations are retained for diagnosis and are never cleaned
  automatically.

Durable local state lives under:

```text
.sciforge/biogym/runs/<design-run-id>/
  run.json
  events.ndjson
  requests/
  tasks/
  actions/
  artifacts/<stage-attempt-id>/
  derived/<stage-attempt-id>/
```

The native runtime reaches the controller through an authenticated,
random-token HTTP server bound only to `127.0.0.1`. Workspace, runtime, thread,
turn, SSH host, remote root, and output locations are not model arguments.
Electron passes the bridge credential through a one-shot inherited pipe on fd 3;
the secret is absent from KUN's argv and initial environment (and therefore from
`ps eww`). KUN validates, consumes, and closes that pipe before runtime
composition, retaining the credential only in the native tool closure. Missing,
malformed, oversized, or stalled bootstrap input fails closed, and
model-controlled bash or MCP subprocesses never inherit the pipe.

## Scientific scope and caveats

- De novo scaffold: RFdiffusion → ProteinMPNN → Boltz-2.
- Fixed backbone: ProteinMPNN → Boltz-2.
- Target binder: BindCraft.

Boltz-2 output is predicted structure/confidence evidence. SciForge must not
describe it as confirmed binding, affinity, stability, expression, solubility,
safety, efficacy, or wet-lab validation.

Stage provenance records the actor turn, backend/capability, receiver job,
source artifact hashes, imported artifact hashes, model name, and checkpoint
fingerprint. RFdiffusion uses its checkpoint manifest, Boltz-2 its checkpoint
cache manifest, and BindCraft its multi-file parameter manifest.

For ProteinMPNN → Boltz-2, SciForge materializes a hash-verified derived CSV
containing the exact selected candidate IDs in ranked order before calling
Boltz-2. It then requires the returned structure IDs to match that selection.
This avoids joining confidence values to a different sequence merely because
the original ProteinMPNN CSV used generation order rather than score order.

## Expected user flow

1. Ask for a supported protein-design workflow and approve the initial
   `biogym_design(start)` call once.
2. Leave the thread open or work elsewhere. SciForge waits for the remote job,
   imports verified artifacts, opens/updates Biology Room, and starts the next
   agent decision automatically.
3. Keep **Following run** enabled to follow the newest candidate. Selecting an
   asset manually pauses following until it is enabled again.
4. Intervene with a new instruction or cancel at any time; a queued automatic
   continuation will be suppressed in favor of the newer action.

Do not send a manual "continue" message just to poll a job. `status` remains
available for diagnosis, but normal stage progression is event-driven.

## Verification

The default suite keeps real GPU work opt-in. The focused controller suite
covers authenticated context, revision conflicts, artifact hashing, Biology
Room registration, structured SSH errors, safe read recovery without duplicate
`CALL_TOOL`, terminal gateway-indeterminate handling, and cleanup retry with a
stable request ID. It also covers deterministic continuation IDs, pre-start
suppression, restart recovery, exact cross-stage candidate selection, derived
CSV hashing, and candidate/structure identity checks.

The real Beam acceptance suite has also completed all three minimal workflows:

- fixed backbone: ProteinMPNN → Boltz-2;
- de novo scaffold: RFdiffusion → ProteinMPNN → Boltz-2;
- target binder: BindCraft.

Each acceptance run finalized, synchronized verified artifacts, and removed its
isolated remote session. Run these expensive checks explicitly with
`SCIFORGE_BIOGYM_REAL_BEAM=1`; they never run as part of normal `npm test`.
