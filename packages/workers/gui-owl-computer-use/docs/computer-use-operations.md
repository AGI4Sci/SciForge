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

P6a can connect to one preconfigured attached remote Windows Worker only when
all `SCIFORGE_CUA_REMOTE_WORKER_*` URL, environment identity, CA, client
certificate and client key values are present. Partial configuration fails
closed. The repository does not ship that Guest Worker or provision/destroy a
VM, so fake transport tests must not be reported as a real isolated desktop.

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

$env:CUA_TEST_PYTHON = $pythonExe
node --import tsx scripts/computer-use-sidecar-restart-smoke.ts
Remove-Item Env:CUA_TEST_PYTHON

$env:CUA_CDP_INTEGRATION = "1"
$env:CUA_CDP_VISIBLE = "1"
& $pythonExe -m pytest tests/integration/test_cdp_headless_integration.py -q -ra
Remove-Item Env:CUA_CDP_VISIBLE, Env:CUA_CDP_INTEGRATION

$env:CUA_UIA_SMOKE = "1"
& $pythonExe -m pytest tests/integration/test_windows_uia_smoke.py -q -ra

$env:CUA_LEGACY_REAL_INPUT = "1"
& $pythonExe -m pytest tests/integration/test_legacy_real_input_smoke.py -q -ra
Remove-Item Env:CUA_LEGACY_REAL_INPUT
```

The CDP capture path activates the selected tab inside its explicitly
allowlisted debugging browser because Chromium does not reliably capture a
background target. Headless controlled tests have no visible window, but an
attached visible debugging browser may visibly switch tabs during observation.

Runtime capabilities expose this conservatively as `mayActivateTarget=true`.
The trusted SciForge main process also starts an attached
`electron-webcontents` driver when the authenticated loopback sidecar is
configured and no explicit external Adapter overrides it. Registration uses
`POST /computer-use/backends/cdp/configure` with the sidecar Bearer token; only
credential-free loopback Adapter URLs are accepted. Shutdown clears the route
only if it still points to that exact Adapter URL. The runtime refreshes this
idempotent registration while it is alive, so a restarted sidecar can recover
the route; registration and clear calls are bounded by a request timeout so a
non-responsive sidecar cannot block Adapter shutdown indefinitely. Existing
handles retain the endpoint and credential that opened them, so reconfiguration
cannot redirect their action or cleanup.

Electron targets include only SciForge-owned window `webContents`. Observe uses
`capturePage()` and actions use the target Debugger Protocol. If another caller
already owns the Debugger connection, Computer Use rejects the target rather
than stealing or later detaching that connection. If `debugger.attach()` fails
while the global attached state is ambiguous, the request stays quarantined and
the driver never claims or detaches that debugger; cleanup can proceed after a
later detach proves the unknown resource is gone. Releasing a handle never
destroys the `webContents`. This is not support for arbitrary third-party
Electron applications.

The Legacy real-input smoke changes real cursor/focus/clipboard state and is
therefore separately opt-in. Its test-owned Edit disables IME and activates an
en-US layout only in the short-lived host thread; it does not change the user's
global input method. The smoke verifies restored text clipboard content, but it
does not prove preservation of arbitrary non-text clipboard formats.

Do not enable Legacy real-input smoke, visible Chromium, Office, ordinary
Chrome, VS Code, RDP, VM, Sandbox or external model calls without separate
authorization.

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
