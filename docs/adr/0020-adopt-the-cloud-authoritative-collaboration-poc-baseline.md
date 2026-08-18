---
status: superseded
supersededBy: openspec/changes/unify-user-device-collaboration
reviewed: 2026-08-17
---

# Adopt the cloud-authoritative collaboration PoC baseline

`SciForge_New_Cloudcolab.md` is the current product and architecture baseline for the Cloud Collaboration PoC and supersedes conflicting decisions in the draft `specs/001-team-research-continuity` design. This selects cloud-authoritative Project, Task, membership, routing, and shared-record state plus explicit personal-Session and Project-Topic semantics; older decisions remain applicable only when the new baseline reconfirms them.

## Supersession audit

The cloud-authoritative Project/Task/Inbox direction survives, but this document is no longer the current baseline. `openspec/changes/unify-user-device-collaboration` replaced it with the canonical UserPrincipal, HumanEndpointBinding, AgentNode, RemoteSessionProjection, Project, Task, receipt, and provider-runtime contracts now implemented by the collaboration packages.
