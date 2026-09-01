## Why

SciForge already owns immutable Artifact Versions, exact scientific-plot recipes, thread-scoped Evidence, project-scoped synthesis, review packets, decisions, and release records. The current product exposes those implementation boundaries as separate right-panel tools and continuously materializes DAG state, forcing researchers to understand storage and queue mechanics instead of deciding the few scientific questions that require accountable human judgement.

The research experience should make the whole scientific workflow auditable, versioned, reproducible, and decision-aware while keeping ordinary research uninterrupted. The system should automatically capture exact records and surface material risks, then ask the researcher only when intent, scope, scientific interpretation, responsibility, authorization, or an irreversible action genuinely requires a decision.

## What Changes

- Replace the peer user entrypoints for Research Dossier, Scientific Plot Provenance, Evidence DAG, Project DAG, and the Artifact Versions utility with one primary `Research` entry in the existing right-panel workspace. Owner-specific views remain independently packaged and are reached through exact resource navigation.
- Define `Research Artifact` as the researcher-facing view of one stable Artifact identity at one exact Version. Do not add a Research Product store or duplicate Artifact bytes, history, dependencies, or current pointers.
- Define four persistence semantics for scientific records: revisioned working documents, immutable versions, append-only events, and disposable read models. Scientific history is corrected by new versions or superseding events, never by rewriting a referenced record.
- Replace the product assumption that every completed turn must publish a complete Evidence graph with an immutable Evidence-delta chain plus a provisional read model. Seal an immutable Evidence Snapshot containing the relevant claim audit closure when a claim is reviewed, challenged, used by a project decision, shared, exported, published, or at risk of losing its source trace.
- Let a researcher set a Goal and explicitly select included, excluded, and isolated Sessions for the workspace's single Research Project. Derive the Project view from exact Evidence heads on demand, keep only a last-good cache and freshness metadata, and commit a Project Snapshot only when an exact cross-Session baseline is referenced by a decision, review, release, export, or collaboration workflow.
- Present scientific risk without presenting DAG mechanics. Default surfaces show evidence freshness, scope coverage, material risk, and artifact reproducibility; full graphs, digests, queue receipts, and raw manifests remain advanced technical detail.
- Route explicit requests for chart provenance or reproducibility through Scientific Plotting. Code/hybrid renders must save executable Code Artifacts; model-owned renders must save the effective prompt, public model/version, parameters, renderer, and replay recipe and must be labelled replayable rather than deterministically reproducible.
- Add decision packets bound to an exact Project Snapshot plus the minimum exact action, target, audit, policy, actor, and output references. Material input change expires an approval. Every certified/public release requires at least one accountable human; specialized actions require the role slots and quorum declared by installed policy. Runtime authorization remains a separate permission boundary.
- Remove duplicate toolbar actions, default full-graph UI, ordinary refresh/rebuild controls, duplicate status and repair flows, the standalone Artifact Versions renderer after exact navigation is complete, and dead compatibility paths identified during migration.
- **BREAKING** Change automatic Evidence/Project materialization from per-turn full Snapshot and per-Snapshot Project compilation to durable Evidence deltas, provisional read models, freshness invalidation, demand-driven Project derivation, and seal-on-use immutable baselines.
- **BREAKING** Restrict autonomous critical-risk override to internal, reversible, non-certified work. Certified or public release cannot use an Agent-only override for an unresolved critical Finding.

## Capabilities

### New Capabilities

- `auditable-research-surface`: one researcher-facing entry, exact owner navigation, compact audit state, contextual artifact/evidence/project actions, and decision packets without a new aggregate store.
- `sealed-scientific-evidence`: immutable Evidence deltas, provisional evidence views, claim-scoped audit closures, freshness/coverage barriers, and correction-by-supersession.
- `demand-driven-project-synthesis`: one workspace-scoped Research Project, explicit Goal/Session Scope, disposable derivation, immutable formal baselines, and append-only decisions.
- `agent-operation-governance`: durable route locks for explicit governed operations and separation of scientific approval from runtime authority.

### Modified Capabilities

- `durable-dag-updates`: persist exact Evidence deltas and authoritative heads, invalidate Project views without eager global compilation, and preserve one canonical owner/worker path per lifecycle.
- `research-artifact-versioning`: expose Research Artifacts as stable identities grouped by exact Versions and supporting dependencies, with owner-specific reproduction views rather than a parallel product registry.
- `domain-ui-contributions`: expose one primary Research entry, bounded owner-summary contributions, and contextual owner navigation without Host domain-ID switches or cross-domain private imports.

## Impact

- `@sciforge/domain-research-dossier`: primary Research landing surface, generic compact owner-provided summaries, exact navigation, and removal of duplicate legacy Evidence detail.
- `@sciforge/domain-scientific-plotting`: contextual Figure preview/reproduction view and governed Agent routing.
- `@sciforge/domain-artifact-versions`: unchanged sole authority for Artifact identity, immutable bytes, versions, dependencies, restore, compare, and bundles; its ordinary renderer surface becomes unnecessary.
- `@sciforge/domain-evidence-dag`: delta/head/seal lifecycle, correction semantics, freshness/coverage status, advanced graph, and evidence-review actions.
- `@sciforge/domain-project-dag`: one workspace-keyed Research Project with explicit Goal/Scope, demand-driven derivation, immutable decision baselines, review/approval/release governance, and advanced graph.
- Domain SDK renderer contributions and resource navigation only where an existing generic contract is insufficient; no new central feature map or research aggregation service.
- Existing Evidence and Project persistence, queues, sidecars, UI actions, documentation, and tests require a direct target-state migration with obsolete paths deleted rather than retained as compatibility layers.
- Delivery is intentionally staged: first the no-store Research surface and owner-summary contract, then Figure/Artifact UX, then Evidence delta/seal, then Project/decision governance. Each stage must pass its migration and deletion gate before the next stage begins; legal/privacy purge orchestration is a separate change.
