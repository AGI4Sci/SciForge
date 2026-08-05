# ADR-001: Computer Use approval trust boundary during P1

Status: temporary, accepted for P1 only

## Context

The existing Electron MCP wrapper runs behind SciForge's capability broker and
sets `execute=true` and `approve=true` after the host approval flow. The Python
sidecar cannot yet verify a cryptographic or single-use proof that binds this
approval to a runtime, thread, tool invocation, request ID, and expiry.

Treating a model-visible `approve` argument as authority would allow direct
sidecar callers to bypass the host approval boundary.

## P1 decision

- The Electron MCP tool schema does not expose `approve` or `execute`.
- Electron-generated request IDs are used for sidecar run and cancel calls.
- The local Electron-to-sidecar boundary remains the transitional authority.
- `/computer-use/status` reports `approvalProof=legacy-trust-boundary` so this
  limitation cannot be mistaken for a completed invocation-proof design.
- Protocol-v2 run requests fail closed with `BACKEND_UNAVAILABLE` until P2
  connects session channels; they cannot fall through to the legacy desktop.

## Required follow-up

Before P5 release, replace this boundary with a short-lived, single-use proof
created only after capability-broker approval and bound to runtime ID, thread
ID, tool, request ID, and expiry. The sidecar must reject bare `approve=true`
for protected execution unless the user explicitly accepts this residual risk.
