## 1. Contracts and configuration

- [x] 1.1 Replace Model Router member settings with the generic Base URL, API key, and model shape and add explicit API versus coding-plan access mode.
- [x] 1.2 Remove legacy provider/protocol fields and update sidecar config generation, validation, shared types, and focused tests with no compatibility shim.

## 2. Automatic API adaptation

- [x] 2.1 Implement generic Responses, Chat Completions, and Anthropic Messages upstream drivers over the canonical request/response model.
- [x] 2.2 Implement safe protocol negotiation, definitive-rejection classification, route caching, invalidation, and protocol-neutral diagnostics.
- [x] 2.3 Route Model Router text requests through the negotiated driver and add multi-protocol, streaming, tool, error, and billing-safe fallback tests.

## 3. Unified full tracing

- [x] 3.1 Define the durable full-trace event schema, correlation identifiers, mandatory secret filtering, and append-only local store.
- [x] 3.2 Add 30-day retention, owner-only storage, derived summaries, export, clear, and read APIs with focused security tests.
- [x] 3.3 Integrate Model Router model traffic and normalized Agent runtime events with the unified store and delete the old in-memory model request audit path and duplicate capture logic.

## 4. Coding Plan Gateway

- [x] 4.1 Add the loopback-only Plan Gateway worker with a generic adapter registry, transparent streaming forwarder, route allowlist, header policy, health, and tests.
- [x] 4.2 Add the Codex plan adapter and generate a `requires_openai_auth` Responses provider without environment API-key authentication.
- [x] 4.3 Integrate Plan Gateway lifecycle, health, and unified trace storage with Electron main and packaging.

## 5. Codex account and runtime selection

- [x] 5.1 Add Codex app-server account read, ChatGPT browser/device login, login completion, logout, plan type, and rate-limit operations.
- [x] 5.2 Launch Codex against Model Router in API mode or Plan Gateway in coding-plan mode, keep the managed Codex home isolated, and prohibit cross-path fallback.
- [x] 5.3 Add runtime and integration tests for authenticated plan configuration, missing auth, gateway failure, and unchanged external Codex home.

## 6. Low-friction product UX

- [x] 6.1 Replace onboarding and settings with the explicit access-mode choice, a three-field API form, Codex official login actions, and one status/diagnostics model.
- [x] 6.2 Replace model-audit UI with durable trace summaries, export, and clear controls, and update Chinese and English localization.
- [x] 6.3 Add renderer, preload, and IPC tests proving no protocol/provider choices are required or exposed.

## 7. Verification and cleanup

- [x] 7.1 Run focused worker, main, shared, preload, and renderer tests and fix failures introduced by removed contracts.
- [x] 7.2 Run repository typecheck and production build, remove dead code and redundant paths, and verify the final diff contains no vendor-specific API routing patches or legacy compatibility layer.
- [x] 7.3 Document local-only trace/privacy behavior and the opt-in live Codex Plan smoke-test procedure without embedding provider-specific routing logic.
