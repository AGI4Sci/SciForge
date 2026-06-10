# SciForge Browser Runtime

`packages/actions/browser-runtime` owns the portable Browser primitive contract plus Web Search fallback/read building blocks for Agent Host and MCP-style callers.

The target ordinary web-search product surface exposes one Codex-compatible refs-first entry:

- `web_search`

Do not add `web_search_custom` or another ordinary search alias. Runtime differences belong behind native capability detection and the same-name SciForge fallback route.

`web_read` remains an internal or advanced read capability. It can be used by fallback strategies, URL/page-level verification, diagnostics, or explicit advanced callers, but it is not the default second model-visible tool for ordinary search tasks.

`web_search` should prefer Codex native search when available. When native search is unavailable or insufficient, SciForge may register a same-name fallback whose events, results, refs, source links, timings, and diagnostics stay as close to the native shape as possible. Ordinary search tasks may be satisfied by current-run `web_search` results plus final-answer source links; page-level tasks still require read evidence.

Under that facade, the Browser module still defines six refs-first primitives:

- `browser.search`
- `browser.navigate`
- `browser.observe`
- `browser.read`
- `browser.extract`
- `browser.download`

Those names are the canonical Browser module intents. They are lower-level Browser capabilities, fallback/diagnostic building blocks, or module-dispatcher intents; they are not the ordinary web-search product surface.

The MCP facade injects internal `schemaVersion` fields and routes fallback/read calls back through the same dispatcher contract instead of forming a second search/read chain.

`browser.search` is candidate discovery only. A completed search result returns `resources` and `evidenceState` with candidate `web_page` resources. Agent Host decides whether those results are enough for an ordinary search answer or whether the task needs read-required escalation. Diagnostic or explicit fallback callers that invoke the Browser primitive layer directly may use `browser.read` or internal `web_read` for page materialization.

`browser.download` only writes controlled session artifacts. Callers can pass an explicit URL or a `sessionId + linkSelector` pair; the host adapter resolves the selector mechanically from the current BrowserHostSession frame artifact to an anchor URL. Callers can constrain downloads with max bytes, timeout, allowed/blocked domains, and the fixed `session-artifacts` save scope. Unknown MIME types and executable/installable downloads are `needs-confirmation` outcomes before artifact bytes are written.

The package does not decide user intent, rewrite queries, repair tasks, verify completion, or synthesize Browser final answers. Those responsibilities stay with Agent Host. Agent Host may record Browser `resources`, `evidenceState`, and refs in its own Evidence Ledger and apply task-level AcceptanceSpec checks before emitting the Codex App Server assistant final message that SciForge projects as a `FinalAnswerEnvelope`.

The host injects browser ports through `createBrowserPrimitiveService({ ports })`; desktop SciForge can adapt those ports to its built-in `BrowserHostSessionManager`, while another runtime can adapt them to a standalone MCP browser server.

The current in-repo built-in browser implementation still lives under `src/runtime/browser-host-session*.ts`; that code is host-specific and should be treated as an adapter, not the reusable contract package.
