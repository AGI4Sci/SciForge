# SciForge Web Worker

Standalone tool worker for read-only web access.

## Tools

- `web_search`: searches the public web and returns a compact result list.
- `web_fetch`: fetches a URL and returns title, final URL, content type, and extracted text.

Both tools use the `sciforge.tools.v1` protocol from `@sciforge/tool-worker-contract`.

## CLI

Run from this package with `tsx`:

```bash
tsx src/cli.ts manifest
tsx src/cli.ts health
tsx src/cli.ts invoke web_search '{"query":"SciForge agent tools","limit":3}'
tsx src/cli.ts invoke web_fetch '{"url":"https://example.com","maxChars":2000}'
tsx src/cli.ts serve --host 127.0.0.1 --port 8787
```

When installed as a package, the equivalent binary is:

```bash
sciforge-web-worker serve --port 8787
```

## HTTP API

```bash
curl http://127.0.0.1:8787/manifest
curl http://127.0.0.1:8787/health
curl -X POST http://127.0.0.1:8787/invoke \
  -H 'content-type: application/json' \
  -d '{"toolId":"web_search","input":{"query":"Nature reproducibility","limit":5}}'
```

## Notes

`web_search` uses DuckDuckGo's HTML endpoint and does not require an API key. Network failures are returned as protocol errors with `retryable: true`.
