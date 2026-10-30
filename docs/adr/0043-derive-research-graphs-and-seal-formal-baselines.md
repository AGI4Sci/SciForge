---
status: accepted
---

# Derive research graphs and seal formal baselines

SciForge will persist immutable, ordered Evidence deltas for ordinary completed work and derive Evidence and Project graphs as disposable read models. Evidence seals a policy-defined Claim closure only at a formal use or ordinary-retention boundary. The single Research Project for a Workspace derives from one applied Goal, one explicit Session Scope, and exact Evidence heads; it seals a Project Snapshot only before a Decision, Review, Approval, Release, export, or formal comparison relies on that baseline.

## Consequences

- DAGs remain necessary as owner-internal relationship models for lineage, impact, contradiction, and dependency analysis, but full DAGs are advanced views rather than top-level products.
- Evidence owns Evidence records, delta ordering, closure policy, and sealed Evidence Snapshots. Project owns Goal, Scope, cross-Session synthesis, Project Snapshots, Decisions, Approvals, and Releases.
- A sealed Evidence closure contains Evidence-owned records plus exact external references; it never copies Project Goal, Scope, or Decision facts.
- Project derivation is demand-driven and keeps only a last-good cache plus freshness metadata. Upstream change marks the Project stale but does not trigger global compilation while its surface is closed.
- Formal sealing uses exact expected-head compare-and-set semantics. A consumer cannot approve or release `latest` or a disposable cache.
- Audit, Finding, Review, Decision, Approval, and Release records form append-only sidechains referencing the baseline they evaluate; they are never backfilled into that same baseline.
- Existing Snapshots are preserved as exact `legacy_checkpoint_root` records. When predecessor completeness cannot be proven, coverage is explicitly `legacy/incomplete`; migration does not invent a complete delta chain.
