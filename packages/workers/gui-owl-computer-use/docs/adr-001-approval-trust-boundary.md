# ADR-001: Computer Use approval trust boundary

Status: P1 transitional decision superseded by the P5a invocation-proof boundary

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

## P5a resolution

- The capability broker creates trusted invocation metadata only after its
  approval decision and passes it outside model-controlled tool arguments.
- The managed Computer Use MCP wrapper signs a short-lived HMAC proof bound to
  runtime, thread, tool, request, invocation, argument digest, issuance time,
  expiry, nonce, and proof ID.
- The Python sidecar validates signature, binding, expiry and single use before
  any mutation reaches `ComputerUseService`; `approve=true` alone is rejected.
- Session ownership and request identity are derived from the verified proof.
- `/computer-use/status` reports `approvalProof=invocation-proof-v1` in the
  default `required` mode.
- `CUA_INVOCATION_PROOF_MODE=legacy` is retained only as an explicit local
  rollback. It restores the old trust boundary and is not equivalent security.

Operational guidance and the final backend boundary are documented in
[`computer-use-operations.md`](computer-use-operations.md) and
[`computer-use-backend-capability-matrix.md`](computer-use-backend-capability-matrix.md).
