# SciForge Connectors

`packages/connectors` is reserved for TUI-side adapters that connect SciForge tasks to third-party apps and accounts, such as Feishu, WeChat, enterprise chat, local CLIs, or desktop bridges.

Connectors are channel plugins, not GUI plugins. See `../../docs/ChannelPluginArchitecture.md` for the canonical channel plugin contract. They can serve three different roles:

- input intake: normalize external messages, mentions, chat commands, webhooks, and attachments into Agent Host input envelopes, equivalent to a user submitting text through a web or GUI composer
- resource/action access: expose Codex-native tools, MCP resources/tools, or worker adapters for search, read, draft, send, upload, sync, or admin operations
- delivery: route agent replies or approved drafts back to the originating external thread, channel, or user

Resource/action connectors should return refs-first results:

- external refs, such as `feishu:*` or `wechat:*`
- artifact refs for user-visible outputs
- audit refs for raw or sensitive connector traces

Input intake should preserve source refs, sender/channel metadata, attachment refs, redaction state, auth scope, dedupe keys, and audit refs. It must enter the TUI Agent Host input queue or thread; it must not execute workspace actions, send replies, or decide task completion by itself. Once admitted by the Agent Host, the message must be appended to the thread ledger so Web chat can render it as a first-class user message with source/channel metadata.

GUI code must not import connector implementations or call external SDKs, CLIs, or desktop automation directly. GUI affordances should send terminal-equivalent text, and external chat messages may enter through connector intake without a GUI round trip. The TUI host decides which connector to invoke for any follow-up resource read or external action.

Operations with external side effects, such as send, delete, sync, upload, or admin changes, should use draft or dry-run flows, explicit approval, idempotency keys, and audit refs. Approval can be collected through GUI confirmation or through a connector-owned external confirmation channel, but the final action must still be invoked by the TUI Agent Host.
