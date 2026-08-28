---
status: accepted
reviewed: 2026-08-27
amends: ADR-0020, ADR-0035, ADR-0038
---

# Target Task Offers at Users and bind executions on claim

A Project Coordinator selects a Worker User, not one of that User's Agents. Cloud creates one durable User-targeted Task Offer without an execution identity and fans its Inbox notification out to every currently eligible Agent/Device Runtime owned by that User. Availability and capability facts determine whether the User is selectable and which current runtimes receive the notification; they do not make an Agent the assignment target.

The first eligible Runtime to accept the Offer performs one compare-and-set claim. In that same Cloud transaction, SciForge records the winning User, Device and Agent, creates the immutable Task Execution and its resources, advances the Task, accepts the Offer, and closes the competing Device views. A stale or second claim fails without creating another execution. The Coordinator refreshes Cloud facts before writes, but no renderer field carries an Agent availability revision for Worker selection.

Manual dismissal is local to one Device. It neither rejects the User-level Offer nor prevents another Device owned by the same User from claiming it. Cloud has no global Device-authored reject command for this flow; Coordinator withdrawal, expiry, or a successful claim are the only shared closures.

Coordinator and Worker remain contextual roles. The current Device Agent of the User who creates a Project becomes Coordinator for that Project only. A Worker Agent exists only as the actor of a claimed Task Execution; it is not a permanent account role, a primary Agent, or a preselected Device. `cloudDeviceId` remains the Cloud identity authority while `executionNodeId` remains the Host execution-node identity; the Offer/claim model does not merge those namespaces or duplicate Identity's canonical Device-to-Agent binding.
