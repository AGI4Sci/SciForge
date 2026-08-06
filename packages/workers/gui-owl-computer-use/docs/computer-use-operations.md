# Computer Use operations, diagnostics and rollback

## Secure launch

Use `启动-sciforge-computer-use.ps1` from the worker directory. Each launch
creates separate random bearer and invocation-proof secrets and passes them only
to the managed wrapper/sidecar process tree. The default proof mode is
`required`; a request-body `approve=true` is never authority.

Important settings:

```text
CUA_ALLOW_EXECUTE=false
CUA_INVOCATION_PROOF_MODE=required
SCIFORGE_CUA_INVOCATION_PROOF_TTL_MS=30000
CUA_LEASE_TTL_S=120
CUA_LEASE_REAPER_ENABLED=true
CUA_LEASE_REAPER_INTERVAL_S=5
CUA_ARTIFACT_RETENTION_S=0
CUA_ARTIFACT_MAX_RUNS=0
```

Do not persist `SCIFORGE_CUA_INVOCATION_SECRET` or `CUA_SERVICE_TOKEN` in source
control. The launcher normally generates them.

## Status and diagnostics

Electron reads the loopback endpoints with bearer authentication:

```text
GET /computer-use/status
GET /computer-use/capabilities
GET /computer-use/cleanup-pending
```

The Python sidecar is the only Session/Request/Lease authority. Electron
validates the response, rejects generation regression within one
`serverInstanceId`, writes an atomic display cache, and shows conservative
offline/stale state on failure. Cached active resources are never used for
arbitration and are cleared from the current view when the sidecar is offline.

Check these fields first:

- `approvalProof`: normally `invocation-proof-v1`; `legacy-trust-boundary` is a
  weaker explicit rollback.
- `lifecycleState`, `registry.generation` and registry counts.
- `backends[]`: inspect each backend separately; do not aggregate safety claims.
- `requestedIsolation`, `effectiveIsolation`, `degraded` and `degradedReason`.
- `verification`: treat `unverified` as indeterminate readback.
- `cleanupPending`: do not reuse the target/environment until close and lease
  release succeed.
- `reaper.lastError`: investigate without manually deleting live leases.

## Local feature rollback

- `CUA_INVOCATION_PROOF_MODE=legacy`: restores the weaker P1 approval boundary;
  use only for a visible, temporary local rollback.
- `CUA_LEASE_REAPER_ENABLED=false`: no reaper thread and no TTL on new leases.
- Keep both artifact retention values at `0` to disable automatic deletion.
- Leaving the isolated provider unconfigured keeps it explicitly unavailable;
  it will not take over CDP/UIA/Legacy targets.

`queueIfBusy=true` is not implemented and returns `QUEUE_NOT_SUPPORTED`.
Callers should use an explicit bounded retry policy for `SESSION_BUSY`,
`TARGET_BUSY` or `HOST_INPUT_BUSY`.

## Tests

Default tests do not open a desktop:

```powershell
$pythonExe = "E:\Research\parttime\03_AI\03_shanghai_ailab_bio_prep\.venv-cua\Scripts\python.exe"
& $pythonExe -m pytest tests -q
& $pythonExe -m ruff check --select F,E9 cua driver
```

The following opt-in tests create only controlled resources and require explicit
authorization. Run them separately and verify exact PID/HWND/profile cleanup:

```powershell
$env:CUA_CDP_INTEGRATION = "1"
& $pythonExe -m pytest tests/integration/test_cdp_headless_integration.py -q -ra
Remove-Item Env:CUA_CDP_INTEGRATION

$env:CUA_UIA_SMOKE = "1"
& $pythonExe -m pytest tests/integration/test_windows_uia_smoke.py -q -ra
```

Do not enable Legacy real-input smoke, Office, ordinary Chrome, VS Code, RDP,
VM, Sandbox or external model calls without separate authorization.

## Git rollback order

P5 commits are independent and must be reverted newest to oldest when removing
the full stage:

```text
P5e documentation: filled in by the release report
8223c95a P5d controlled cleanup assertions
e90e1d61 P5c deterministic full chain
6ccc286e P5b live runtime status
3c999fe2 P5a trusted invocation proofs
632add7c P4 isolated lifecycle supervision
```

Use `git revert`, not reset/rebase/force-push, after commits are shared. Reverting
P5a while keeping later P5 commits is unsupported because P5b–P5e document and
test the proof-enabled contract.
