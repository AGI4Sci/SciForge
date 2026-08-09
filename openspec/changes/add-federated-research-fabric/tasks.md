# Tasks: Add Federated Research Fabric

## 1. Architecture contracts and package ownership

- [ ] 1.1 Create one `@sciforge/domain-federated-research` package that owns pure federation
  contracts, Cloud/Site backends, Desktop contributions, Skills, assets, and lifecycle metadata.
- [ ] 1.2 Define strict, versioned schemas for Project, Site, AgentCapability, ResourceOffer,
  WorkOrder, Reservation, ExecutionLease, TaskEvent, ResultManifest, EvidenceCapsule, ArtifactRef,
  MemoryPacket, error, receipt, and visibility objects.
- [ ] 1.3 Add one generic generated headless deployment contribution to the domain SDK if the current
  process targets cannot express Cloud/Site profiles; do not add domain IDs or feature maps to core.
- [ ] 1.4 Generate Cloud, Site, main, and renderer projections from the same canonical installed
  domain definition and fail activation on missing, extra, duplicate, or incompatible contributions.
- [ ] 1.5 Add architecture tests for package boundaries, process entrypoints, generated freshness,
  host-private imports, domain hard-coding, and duplicate capability/transports.

## 2. Cloud Coordinator vertical slice

- [ ] 2.1 Implement project, institution, membership, role, Goal, WorkOrder, TaskEvent, result, and
  Project Snapshot persistence with immutable identities and transactional outbox.
- [ ] 2.2 Implement Site registration, mutually authenticated connection sessions, heartbeat,
  acknowledgment, replay, reconnect, bounded payloads, and stable errors.
- [ ] 2.3 Implement the canonical WorkOrder offer/version/cancel path and task state projection without
  embedding scheduler- or institution-specific logic.
- [ ] 2.4 Extend Project DAG to consume accepted EvidenceCapsule/ResultManifest identities and record
  exact cross-Site evidence vectors without copying private Evidence nodes.
- [ ] 2.5 Expose one capability path for Agent, Desktop UI, automation, and administrative callers;
  external writes pass through Capability Broker governance and audit.

## 3. Institution Site Node vertical slice

- [ ] 3.1 Build a headless Site service with durable inbox/outbox, local task store, scheduler receipt
  store, lease state, bounded event journal, health, diagnostics, and graceful recovery.
- [ ] 3.2 Implement Site-owned policy evaluation inputs for project membership, purpose, data class,
  resource, runtime, budget, network, output visibility, and required approval.
- [ ] 3.3 Integrate Site execution with the existing Workspace Host, AgentRuntime Host, Capability
  Broker, Workspace Egress, Artifact services, and Evidence DAG through public contracts only.
- [ ] 3.4 Ensure the Site exposes only opaque resource IDs and bounded capability metadata; audit all
  logs, events, receipts, and errors for path, token, SSH, VPN, scheduler, and model-secret leakage.
- [ ] 3.5 Add a clearly degraded Desktop relay mode whose tasks require the client/VPN to stay online
  and which never registers as a persistent Site.

## 4. Federated Agent coordination

- [ ] 4.1 Add the provider-neutral FederatedAgent surface for capability discovery, work offer,
  reservation, commit, observation, cancellation, result publication, and evidence request.
- [ ] 4.2 Map committed Site WorkOrders into the existing AgentRuntime contract without introducing a
  SciForge custom runtime or leaking Codex/Claude provider protocols into federation contracts.
- [ ] 4.3 Keep `@sciforge/multi-agent` scoped to local parent/child execution; add project-level durable
  task orchestration as the only cross-institution path.
- [ ] 4.4 Implement Project Orchestrator, Site Coordinator, Execution, and Verification as explicit
  responsibility/authority contexts rather than hard-coded model identities.
- [ ] 4.5 Add tests proving Agent proposals cannot bypass Site policy, leases, Capability Broker,
  result egress, verification, or project acceptance requirements.

## 5. Federated research memory

- [ ] 5.1 Extend Research Memory Resolver inputs with project, task, principal, Site, Project Snapshot,
  Evidence Snapshot vector, access-policy digest, freshness, and budget.
- [ ] 5.2 Produce deterministic, bounded Memory Packets from committed snapshots; prioritize Goal,
  active Decision, negative result, conflict, open question, constraint, and evidence identity.
- [ ] 5.3 Add Site-local resolution that combines a captured Cloud Project Snapshot with authorized
  private Evidence without uploading source content.
- [ ] 5.4 Add Cloud resolution that consumes only Project DAG and exported EvidenceCapsules and cannot
  discover private Site content or locators.
- [ ] 5.5 Key caches and semantic indexes by snapshot, principal, policy, resolver version, query/task,
  and budget; invalidate naturally on identity change and never create a second fact store.
- [ ] 5.6 Enforce Shared Memory boundaries so preferences may sync independently while scientific
  conclusions route to the DAG ingestion/governance path.

## 6. First Slurm-backed execution venue

- [ ] 6.1 Define generic scheduler adapter contracts for submit, inspect, cancel, logs, outputs, and
  receipts; implement Slurm as the first package-owned adapter without embedding Slurm in Cloud.
- [ ] 6.2 Implement ResourceOffer publication with truthful capability, queue/cost approximation,
  policy summary, quota, revision, and expiry.
- [ ] 6.3 Implement Reservation and ExecutionLease state machines with expiry, revoke, release,
  idempotency, and exact Site/task/resource binding.
- [ ] 6.4 Translate exactly one committed WorkOrder into one Slurm submission, recover the scheduler
  job after Site restart, and distinguish reservation, lease, local queue, running, cancellation,
  and terminal states.
- [ ] 6.5 Enforce data-local placement and reject automatic movement of `site-only` Artifact inputs.

## 7. Evidence, results, and Artifact exchange

- [ ] 7.1 Add a Site-owned result preparation flow that binds local completion to a committed Evidence
  Snapshot before export review.
- [ ] 7.2 Define visibility-aware EvidenceCapsule generation from canonical Evidence nodes and
  provenance without copying private local paths or restricted content.
- [ ] 7.3 Define signed ResultManifest creation, verification, acceptance, dispute, supersession, and
  independent-verification flows.
- [ ] 7.4 Implement content-addressed Artifact upload/download with chunking, resume, digest checking,
  bounded leases, retention, and auditable receipts for approved objects.
- [ ] 7.5 Add RO-Crate and W3C PROV export mappings and evaluate GA4GH DRS/TES adapters without making
  external standards a second internal state path.

## 8. Identity, policy, and audit

- [ ] 8.1 Integrate human federation through OIDC and map external identities to stable project and
  institution principals without using email alone as authority.
- [ ] 8.2 Issue short-lived, rotated service/workload identities for Cloud, Site, adapters, and task
  workloads; support separate institution trust domains and explicit federation.
- [ ] 8.3 Implement scoped authorization binding actor, project, task, action, resource, purpose,
  policy version, and expiry; never persist raw institution VPN/SSH or provider credentials in Cloud.
- [ ] 8.4 Add append-only audit events for offer, reservation, lease, policy decision, submission,
  cancellation, Evidence export, Artifact access, result acceptance, override, and publication.
- [ ] 8.5 Add security tests for replay, confused deputy, cross-project access, cross-Site locator
  leakage, stale lease, revoked membership, forged manifest, digest mismatch, and log redaction.

## 9. Desktop and human-readable operations

- [ ] 9.1 Add a Federated Project surface showing Goal, institutions, WorkOrders, current phase, last
  confirmed update, approvals, blocking reason, result, evidence freshness, and audit target.
- [ ] 9.2 Add Site administration for registration, sanitized capabilities, connection mode, policy
  status, ResourceOffers, leases, diagnostics, and revoke without exposing raw credentials.
- [ ] 9.3 Add human approval surfaces for task acceptance, data/result egress, critical verification,
  result dispute/acceptance, and release override through generic renderer contributions.
- [ ] 9.4 Reuse Remote Workspace for institution-interactive work and make the UI distinguish Cloud
  project state, persistent Site execution, and Desktop-relay degraded execution.
- [ ] 9.5 Ensure every active status is truthful and avoid fabricated percentages or UI timeout-driven
  failure transitions.

## 10. Pilot, resilience, and acceptance

- [ ] 10.1 Deploy one Coordinator and two Site Nodes in a controlled pilot with one Slurm-backed GPU
  task, derived-only result egress, independent review, and no raw-data transfer.
- [ ] 10.2 Test Desktop shutdown, VPN loss, Site process restart, Cloud restart, network partition,
  replay gap, lease expiry, scheduler delay, cancellation race, and Artifact transfer resume.
- [ ] 10.3 Prove duplicate WorkOrder delivery never creates a duplicate scheduler job or duplicate
  accepted result.
- [ ] 10.4 Prove every accepted Project Claim resolves through ResultManifest and EvidenceCapsule to
  a Site Evidence Snapshot and integrity-verified Artifact or an explicit access boundary.
- [ ] 10.5 Run domain package boundary checks, generated composition freshness, capability governance,
  focused package tests, typechecks, full regressions, changed-file lint, source/packaged paths, and
  dead-entrypoint audits.
- [ ] 10.6 Document operational responsibilities, institution onboarding, incident/revocation flows,
  backup/retention boundaries, protocol compatibility, and the criteria for leaving the pilot phase.
