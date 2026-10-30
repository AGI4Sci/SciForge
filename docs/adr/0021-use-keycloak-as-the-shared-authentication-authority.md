---
status: superseded
supersededBy: openspec/changes/unify-user-device-collaboration
reviewed: 2026-08-17
---

# Use Keycloak as the shared authentication authority

The Cloud Collaboration PoC uses Keycloak as its unified OIDC identity provider, with Zulip and SciForge Desktop registered as separate clients and holding independent application sessions. Desktop is a secretless public client; a SciForge Cloud confidential client is added only if Cloud later owns an independent Web login surface. Keycloak proves human identity only; SciForge Cloud remains authoritative for Canonical SciForge Users, Projects, Tasks, Agents, messages, and collaboration authorization, while local SciForge remains authoritative for local execution permission.

## Supersession audit

The current collaboration implementation does not use Keycloak or an OIDC subject as its authentication authority. It establishes collaboration UserPrincipal and HumanEndpointBinding state through a verified provider challenge, then uses separate user, endpoint, and Agent device credentials. A future OIDC adoption requires a new change and cannot be inferred from this historical decision.
