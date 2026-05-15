# SciForge Tool Worker Contract

Small TypeScript contract SDK for standalone SciForge workers.

It defines the worker manifest, health, and invoke contracts; validates untrusted payloads; and includes lightweight HTTP server/client helpers for local or sidecar workers.

## HTTP contract

- `GET /manifest` returns a `ToolWorkerManifest`.
- `GET /health` returns a `ToolWorkerHealth`.
- `POST /invoke` accepts a `ToolInvokeRequest` and returns a `ToolInvokeResponse`.

## Example

```ts
import { createToolClient, startToolWorkerServer } from '@sciforge/tool-worker-contract';

const server = await startToolWorkerServer({
  manifest,
  async health() {
    return { status: 'ok', checkedAt: new Date().toISOString() };
  },
  async invoke(request) {
    return { ok: true, requestId: request.requestId, output: { echo: request.input } };
  },
});

const client = createToolClient(`http://127.0.0.1:${server.port}`);
const manifest = await client.manifest();
await server.close();
```
