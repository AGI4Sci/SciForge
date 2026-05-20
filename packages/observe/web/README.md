# SciForge Web Observe

This package owns the read-only web observe capability contracts.

It answers what SciForge can ask from web providers:

- `web_search`: search public web or configured search indexes and return ranked result refs with provider diagnostics.
- `web_fetch`: fetch a public URL or search result URL through a configured network provider and return durable content refs.
- `browser_search` / `browser_fetch`: use a real browser provider when rendered JavaScript pages or browser-only entry points are required.
- `playwright_browser_automation`: use the official Playwright MCP server with a headless, isolated browser for TUI agent web observation that does not attach to the human user's active browser.
- `playwright_edge_browser`: use the official Playwright MCP server with visible Microsoft Edge, a dedicated persistent profile, and structured browser actions for search, clicking, scrolling, forms, downloads, and login handoff.

It does not own where the work runs. The default standalone implementation lives in `packages/workers/web-worker` and advertises provider routes such as `sciforge.web-worker.web_search` and `sciforge.web-worker.web_fetch`.

The headless MCP wrapper in `mcp/playwright-browser.ts` owns the default TUI-agent browser shape: headless, isolated, per-process ports, and no attachment to the user's active browser profile. It can generate Codex/Cursor/Claude-style MCP JSON, parallel worker configs, and SciForge provider availability rows without binding runtime gateway code to a specific MCP client. `mcp/playwright-browser-provider.ts` is the thin provider adapter that connects to an already-running Playwright MCP HTTP endpoint and returns SciForge provider output.

The provider adapter supports a generic `actions[]` queue for safe browser operations such as navigation, waits, clicks, hover, typing, form fill, select, drag/drop, file upload, dialogs, tabs, screenshots, snapshots, console logs, network logs, and page-scoped evaluation. It also supports `extract.kind = "repeated-items"` for stable structured rows and `download` / `downloadLinks` for bounded material downloads into the isolated output directory. This keeps site-specific knowledge in invocation input rather than hard-coding a site such as arXiv into the browser provider.

The Edge MCP wrapper in `mcp/playwright-edge.ts` remains the explicit visible-browser fallback for login, manual takeover, or Edge-specific validation. Keep that path separate from unattended TUI browsing so background research does not steal focus or depend on a human desktop session.

Example:

```ts
import { buildPlaywrightBrowserMcpServersConfig } from '@sciforge-observe/web/mcp/playwright-browser';

const config = buildPlaywrightBrowserMcpServersConfig({
  browser: 'msedge',
  headless: true,
  isolated: true,
  outputDir: '/Users/zhangyanggao/.pw-mcp-browser-output',
});
```

## Boundary

- Capability contract lives here: ids, schemas, validators, side effects, repair hints, and examples.
- Worker/provider implementation lives in a worker package or an AgentServer-discovered provider.
- Runtime provider selection, route recording, preflight, validation, and repair orchestration stay in `src/runtime`.
- Headless TUI browser automation must default to `--headless --isolated`; persistent profiles are opt-in for authorized sessions only.
- Independent MCP server processes must use independent ports and isolated contexts; use `buildParallelPlaywrightBrowserMcpServersConfig()` for P1/P2/P3 style isolation.
- Visible Edge automation is a separate capability for explicit login/manual takeover flows; do not silently fall back from headless browser automation into the user's primary browser.
- Structured extraction must remain generic and caller-configured. Prefer bounded repeated-item extraction for long rendered lists, then fetch individual detail pages only for confirmed candidates.
- Downloads must return local refs with source URL, path, byte size, content type, and hash. Keep default output under the Playwright browser output directory rather than the human user's browser downloads folder.
