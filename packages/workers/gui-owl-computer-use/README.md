# Computer Use CDP control service

This package owns the Python `SessionRegistry`, one target-bound
`SessionInputChannel` per request, invocation-proof verification, cancellation,
and cleanup. It registers only `browser-cdp`; the TypeScript domain package owns
the five managed MCP tools and Playwright/Electron adapter.

`computer_use` requires a structured `semanticAction`. Natural-language
`instruction` is optional audit context and never invokes a planner. An
instruction-only call fails with `UNSUPPORTED_LEGACY_INSTRUCTION`.

There is no Python MCP server, model bridge, batch executor, PyAutoGUI fallback,
UIA, isolated desktop, or remote worker in this package.
