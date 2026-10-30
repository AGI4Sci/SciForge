---
status: accepted
amendedBy: ADR-0026, ADR-0023
reviewed: 2026-08-22
---

# Assert principals in the main process with explicit assurance

The Identity and Access domain is the sole provider of the current Human Principal, and the Electron main process injects its user ID and Principal Assurance into capability caller context only after trusted-sender validation. Renderer code, Agents, and other domains cannot declare or override a principal; only trusted Human UI can mutate the identity state through package-owned capabilities.

The original V1 Local Account path emits only `local-selection`. ADR-0023 adds the current `cloud-authenticated` path after strict OIDC verification, canonical `/v1/me` mapping, and confirmation that the current Desktop Device is `ACTIVE`. ADR-0026 separately allows local selection to scope an authenticated node-local Provider Connection, but neither Principal assurance proves the External Account identity itself.
