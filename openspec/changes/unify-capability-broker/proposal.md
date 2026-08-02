## Why

SciForge exposes product capabilities through separate renderer IPC, main-process services, managed MCP tools, and runtime-specific prompts. As a result, an agent can see that a UI feature exists without being able to discover or invoke it, causing repeated fallbacks to screenshots, shell commands, and direct sidecar edits.

## What Changes

- Add one authoritative capability registry and broker for UI, agent, and system callers.
- Add schema-validated discovery, resource observation, action invocation, revisions, idempotency, approval metadata, audit events, and change subscriptions.
- Expose the stable `sciforge_discover`, `sciforge_observe`, `sciforge_invoke`, and `sciforge_events` tools for product/domain capabilities; Host Core separately owns the universal `sciforge_look` and `sciforge_capture` visual primitives.
- Keep broker transport fields such as snapshot tokens, target coordinates, semantic revisions, and invocation IDs inside the adapter rather than asking the model to coordinate them.
- Publish visible surfaces as generic visual sources for the native visual runtime, while document annotations remain ordinary provider operations with compact observations and schema references.
- Separate semantic resource revision from layout epoch so rendering, scrolling, and resizing cannot invalidate an agent observation.
- Add one shared execution governor for all agent runtimes using normalized semantic failure receipts and capability-aware policy denials.
- Make capability discovery deterministic with exact capability IDs, tokenized ranked
  search, explicit scope/resource filters, bounded native-first results, and
  actionable empty-result diagnostics.
- Expose resource-reference liveness in event history and apply a shared
  evidence-aware retry budget to stable non-retryable failures.
- Keep the text reasoner as the primary model while treating vision translators
  as evidence producers; strict native visual inspection must preserve grounded
  evidence or fail with a typed cause instead of returning a text-only success.
- Migrate Workspace Preview and Biology Room as the first complete vertical slice so their actions are discoverable and invoke the existing canonical providers.
- Generate visible-context access metadata and capability documentation from registered definitions.
- Add registration completeness and architecture-boundary tests so future features cannot claim agent access without an executable capability.
- **BREAKING** Remove false agent-access booleans, hand-written tool hints, public `gui_*` tools, direct annotation-sidecar access, agent-visible ambiguous workspace-preview dispatch, runtime legacy-sidecar scanning, duplicated failure guards, and migrated per-feature execution paths rather than keeping compatibility aliases.

## Capabilities

### New Capabilities

- `capability-broker`: Authoritative capability registration, discovery, policy, invocation, revision, idempotency, audit, and event requirements.
- `workspace-surface-control`: Unified Workspace Preview and Biology Room resource observation and action invocation for UI and agent callers.
- `capability-governance`: Build-time and test-time rules that keep registry definitions, documentation, visible context, and executable providers synchronized as features are added.
- `agent-operation-governance`: Runtime-independent attempt/result normalization, semantic failure streaks, capability-aware recovery, and policy enforcement.

### Modified Capabilities

None.

## Impact

- Main process: new broker, registry, provider adapters, policy checks, audit/event publication, and IPC/MCP transport adapters.
- Shared contracts: capability manifests, resource handles, observations, invocations, events, and schemas.
- Renderer/preload: broker-backed clients and registry-derived visible-context metadata.
- Agent runtimes: stable discovery/observe/invoke/event tools and removal of feature-specific prompt guidance.
- Agent runtimes: typed visual failures, deterministic recovery guidance, and
  circuit breaking for repeated attempts that produce no new evidence.
- Model Router: successful Responses payload compatibility, vision-evidence
  provenance, text-primary synthesis, and fail-closed strict visual inspection.
- Workspace Preview/Biology Room: registered providers using existing domain services as the only execution engines.
- Tests and CI: registry completeness, single-provider, audience, schema, revision, idempotency, and no-bypass checks.
