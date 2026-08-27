---
status: accepted
reviewed: 2026-08-27
amends: ADR-0020, ADR-0031
---

# Ensure one Device-named Agent automatically

After OIDC User authority, the exact ACTIVE Desktop Device, and the canonical Agent Runtime are ready, Identity automatically ensures one active Agent for that Device. Cloud derives the Agent display name from the authoritative Device record, and repeated Desktop starts reuse the same Agent. The renderer cannot register, rename, recover, or select a primary Agent; personal Session work always uses the Agent belonging to the current Device.

The Identity-owned service alone handles one-time credential bootstrap, encrypted local authority reuse, and bounded rotation when local authority is missing or stale. Collaboration receives only the non-secret Agent fact and readiness state.

Device identity remains the security boundary. Two separately enrolled Device identities may have the same hostname and remain separate Agents; SciForge does not merge or revoke them by hostname or hardware fingerprint. Historical Device identities are managed through Device revocation, not an unsafe name-based deduplication rule.
