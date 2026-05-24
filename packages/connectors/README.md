# SciForge Connectors

`packages/connectors` is reserved for TUI-side adapters that connect SciForge tasks to third-party apps and accounts, such as Feishu, WeChat, enterprise chat, local CLIs, or desktop bridges.

Connectors are not GUI plugins. They should expose Codex-native tools, MCP resources/tools, or worker adapters, and return refs-first results:

- external refs, such as `feishu:*` or `wechat:*`
- artifact refs for user-visible outputs
- audit refs for raw or sensitive connector traces

GUI code must not import connector implementations or call external SDKs, CLIs, or desktop automation directly. GUI affordances should send terminal-equivalent text, and the TUI host decides which connector to invoke.

Operations with external side effects, such as send, delete, sync, upload, or admin changes, should use draft or dry-run flows, explicit approval, idempotency keys, and audit refs.
