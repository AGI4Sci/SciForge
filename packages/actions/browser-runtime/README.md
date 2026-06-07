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

`browser.search` is candidate discovery only. A completed search result must be directly actionable: result items include `readInput`, and the envelope includes a `search-results-require-read` repair hint with `candidateReadInputs`. Callers should pass one or more of those inputs to `browser.read` before citing, summarizing, or treating a page as evidence.

The package does not decide user intent, rewrite queries, repair tasks, verify completion, or synthesize final answers. Those responsibilities stay with Agent Host. The host injects browser ports through `createBrowserPrimitiveService({ ports })`; desktop SciForge can adapt those ports to its built-in `BrowserHostSessionManager`, while another runtime can adapt them to a standalone MCP browser server.

The current in-repo built-in browser implementation still lives under `src/runtime/browser-host-session*.ts`; that code is host-specific and should be treated as an adapter, not the reusable contract package.
