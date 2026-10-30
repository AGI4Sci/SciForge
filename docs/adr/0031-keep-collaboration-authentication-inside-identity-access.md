---
status: accepted
reviewed: 2026-08-24
amends: ADR-0023
supersedes: ADR-0021
---

# Keep collaboration authentication inside Identity and Access

Keycloak OIDC JIT is the only path that creates or finds a Canonical SciForge User for Connected Mode, and pairing only verifies a communication endpoint for that existing User. `identity-access` alone owns Token custody, ACTIVE Device revalidation, Device signing and an allowlisted token-free authenticated Cloud transport; collaboration packages receive neither OIDC material nor authorization headers. This avoids a second login/account path and keeps logout, refresh and Device revocation under one authority, at the cost of a generic main-only transport contribution between independently owned domain packages.
