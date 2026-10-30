# Computer Use CDP control service

This package owns the Python `SessionRegistry`, one target-bound
`SessionInputChannel` per request, invocation-proof verification, cancellation,
service-lifetime invocation idempotency, and signal-safe cleanup. It registers only `browser-cdp`; the TypeScript domain package owns
the five managed MCP tools and Playwright/Electron adapter.

After an action is dispatched, deadline, cancellation, or transport loss is
reported as `ACTION_OUTCOME_UNKNOWN` with `mayHaveTakenEffect=true`. Trusted
invocation results are retained for the Worker lifetime so a new proof or
transport request ID cannot repeat the same mutation.

`computer_use` requires a structured `semanticAction`. Natural-language
`instruction` is optional audit context and never invokes a planner. An
instruction-only call fails with `UNSUPPORTED_LEGACY_INSTRUCTION`.

There is no Python MCP server, model bridge, batch executor, PyAutoGUI fallback,
UIA, isolated desktop, or remote worker in this package.
