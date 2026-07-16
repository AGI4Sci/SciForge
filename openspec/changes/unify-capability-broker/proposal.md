## Why

SciForge exposes product capabilities through separate renderer IPC, main-process services, managed MCP tools, and runtime-specific prompts. As a result, an agent can see that a UI feature exists without being able to discover or invoke it, causing repeated fallbacks to screenshots, shell commands, and direct sidecar edits.

## What Changes

- Add one authoritative capability registry and broker for UI, agent, and system callers.
- Add schema-validated discovery, resource observation, action invocation, revisions, idempotency, approval metadata, audit events, and change subscriptions.
- Expose a small stable agent tool surface backed by the broker instead of per-feature prompt hints and flattened internal tools.
- Migrate Workspace Preview and Biology Room as the first complete vertical slice so their actions are discoverable and invoke the existing canonical providers.
- Generate visible-context access metadata and capability documentation from registered definitions.
- Add registration completeness and architecture-boundary tests so future features cannot claim agent access without an executable capability.
- **BREAKING** Remove false agent-access booleans, hand-written tool hints, ambiguous workspace-preview tools, and migrated per-feature execution paths rather than keeping compatibility aliases.

## Capabilities

### New Capabilities

- `capability-broker`: Authoritative capability registration, discovery, policy, invocation, revision, idempotency, audit, and event requirements.
- `workspace-surface-control`: Unified Workspace Preview and Biology Room resource observation and action invocation for UI and agent callers.
- `capability-governance`: Build-time and test-time rules that keep registry definitions, documentation, visible context, and executable providers synchronized as features are added.

### Modified Capabilities

None.

## Impact

- Main process: new broker, registry, provider adapters, policy checks, audit/event publication, and IPC/MCP transport adapters.
- Shared contracts: capability manifests, resource handles, observations, invocations, events, and schemas.
- Renderer/preload: broker-backed clients and registry-derived visible-context metadata.
- Agent runtimes: stable discovery/observe/invoke/event tools and removal of feature-specific prompt guidance.
- Workspace Preview/Biology Room: registered providers using existing domain services as the only execution engines.
- Tests and CI: registry completeness, single-provider, audience, schema, revision, idempotency, and no-bypass checks.
