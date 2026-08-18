---
status: accepted
amendedBy: ADR-0026
reviewed: 2026-08-17
---

# Assert principals in the main process with explicit assurance

The Identity and Access domain is the sole provider of the current Human Principal, and the Electron main process injects its user ID and Principal Assurance into capability caller context only after trusted-sender validation. Renderer code, Agents, and other domains cannot declare or override a principal; only trusted Human UI can create, select, rename, or exit a Local Account. V1 emits only `local-selection`, while SciForge-owned cloud Projects and cross-user identity authority require `cloud-authenticated`. ADR-0026 amends the former OpenContent rule: local selection may scope a separately authenticated node-local Provider Connection but never proves the External Account identity itself.
