## Why

SciForge currently assumes users have a model API and exposes provider/protocol details that most users should not need to understand. It also records sanitized request summaries through multiple paths instead of preserving one complete, correlated model-request and Agent-runtime trajectory. Users need one low-friction setup that works with either a generic API credential or a login-backed coding subscription such as Codex Plan.

## What Changes

- Replace provider-specific model setup with one generic API form containing only Base URL, API key, and model name; SciForge negotiates OpenAI Responses, OpenAI Chat Completions, or Anthropic Messages internally and caches the working transport.
- Add a local-only Plan Gateway with a provider-adapter contract and a first Codex adapter that uses Codex-managed ChatGPT authentication and subscription billing.
- Add one durable full-trace contract and store for both Model Router and Plan Gateway traffic, correlated with existing Agent runtime events by runtime, thread, turn, request, and parent request identifiers.
- Add a single access-mode onboarding and settings flow that validates configuration, reports connection/auth status, and never silently changes billing paths.
- Remove redundant summary-only request audit paths, manual protocol/provider selection, and configuration branches that conflict with the unified workflow.
- **BREAKING** Remove legacy provider/protocol configuration fields and do not migrate or preserve their behavior.
- **BREAKING** Replace the in-memory model-request audit contract with the durable unified trace contract.

## Capabilities

### New Capabilities

- `automatic-model-access`: Generic three-field API configuration, automatic wire-protocol negotiation, cached routing, validation, and a simple access-mode UX.
- `coding-plan-gateway`: Local transparent forwarding for login-backed coding plans through a generic adapter contract, initially implemented for Codex with isolated ChatGPT authentication.
- `full-agent-model-tracing`: Durable, secret-safe capture and correlation of complete client-visible model requests/responses and Agent runtime events across both access paths.

### Modified Capabilities

None. The repository has no established baseline specs for these capabilities.

## Impact

- Model Router configuration, upstream transport, routing, trace generation, CLI, sidecar launch, and tests.
- Codex runtime configuration, app-server authentication methods, lifecycle management, and tests.
- Shared application settings and Agent runtime contracts, IPC/preload surfaces, diagnostics, onboarding/settings UI, localization, and tests.
- Local user-data layout and retention cleanup for full traces; credentials and authorization headers remain excluded from trace persistence.
- Existing Model Router config files and model-audit consumers will require the new schema with no compatibility shim.
