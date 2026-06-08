# SciForge Browser Runtime

`packages/actions/browser-runtime` owns the portable Browser primitive contract for Agent Host and MCP-style callers.

It exposes six refs-first primitives:

- `browser.search`
- `browser.navigate`
- `browser.observe`
- `browser.read`
- `browser.extract`
- `browser.download`

Those names are the canonical Browser module intents. Provider/MCP-facing tool names use safe aliases:

- `browser_search`
- `browser_navigate`
- `browser_observe`
- `browser_read`
- `browser_extract`
- `browser_download`

The MCP facade injects the internal `schemaVersion` fields and routes those direct tools back through the same Browser module dispatcher.

`browser.search` is candidate discovery only. A completed search result returns `resources` and `evidenceState` with candidate `web_page` resources, but those candidates are not source evidence yet. Callers should pass a candidate `web_page` `resourceRef` to `browser.read` before citing, summarizing, or treating a page as evidence; `browser.read` materializes source/page text refs that can be used downstream.

`browser.download` only writes controlled session artifacts. Callers can pass an explicit URL or a `sessionId + linkSelector` pair; the host adapter resolves the selector mechanically from the current BrowserHostSession frame artifact to an anchor URL. Callers can constrain downloads with max bytes, timeout, allowed/blocked domains, and the fixed `session-artifacts` save scope. Unknown MIME types and executable/installable downloads are `needs-confirmation` outcomes before artifact bytes are written.

The package does not decide user intent, rewrite queries, repair tasks, verify completion, or synthesize Browser final answers. Those responsibilities stay with Agent Host. Agent Host may record Browser `resources`, `evidenceState`, and refs in its own Evidence Ledger and apply task-level AcceptanceSpec checks before emitting the Codex App Server assistant final message that SciForge projects as a `FinalAnswerEnvelope`.

The host injects browser ports through `createBrowserPrimitiveService({ ports })`; desktop SciForge can adapt those ports to its built-in `BrowserHostSessionManager`, while another runtime can adapt them to a standalone MCP browser server.

The current in-repo built-in browser implementation still lives under `src/runtime/browser-host-session*.ts`; that code is host-specific and should be treated as an adapter, not the reusable contract package.
