---
status: accepted
amendedBy: ADR-0023
reviewed: 2026-08-22
---

# Stage V1 identity as local account selection

V1 persists Local Accounts in application-owned SQLite and lets a user create or select one by username, automatically restore the last selection, and exit it. The stable local user ID provides identity context for desktop features, but username selection is explicitly not authentication and grants no cloud, cross-user, OpenContent, Project-permission, or remote-Agent authority.

ADR-0023 amends the original future-service note: the current `identity-access` package adds a separate, explicitly configured OIDC and Device-backed Cloud path. It does not replace or silently promote Local Accounts. Mapping through the canonical Cloud `/v1/me` contract and an `ACTIVE` Device is required before the Host can assert `cloud-authenticated`.
