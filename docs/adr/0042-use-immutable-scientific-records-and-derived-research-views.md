---
status: accepted
---

# Use immutable scientific records and derived research views

SciForge will present one Research surface without creating a research aggregate store: Artifact, Evidence, Project, Plot, Decision, Review, and Release facts remain owned by their domain packages and cross boundaries only through exact immutable identities. Editable intent uses revisioned drafts, scientific content creates new immutable versions, actions and corrections append events, and Dossier/status surfaces remain rebuildable views; this preserves accountable history while allowing goals, scope, interpretation, authorization, and current scientific understanding to evolve without rewriting prior records.

## Consequences

- Formal consumers bind exact Goal, Scope, Evidence Snapshot, Project Snapshot, Artifact Version, policy, action, and target identities rather than `latest` or `current`.
- Research Surface unifies navigation and presentation only; it does not import package-private UI or copy owner state.
- Corrections, reversals, retractions, consent changes, and approval expiry are appended or derived rather than applied as destructive edits.
- Evidence/Project derivation and seal boundaries are decided separately in ADR-0043.
