import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { moduleResult, type ModuleInvokeRequest } from '@sciforge-ui/runtime-contract/modules';
import {
  BROWSER_PRIMITIVE_INPUT_SCHEMAS,
  BROWSER_PRIMITIVE_INTENTS,
  BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
  browserPrimitiveModuleDescription,
  type BrowserPrimitiveService,
} from './index.js';
import {
  browserRuntimeMcpTools,
  createBrowserRuntimeMcpAdapter,
} from './mcp.js';

describe('browser runtime MCP facade', () => {
  it('exposes provider-safe direct primitive tools backed by Browser module intents', async () => {
    assert.deepEqual(browserRuntimeMcpTools().map((tool) => tool.name), [
      'browser_search',
      'browser_navigate',
      'browser_observe',
      'browser_read',
      'browser_extract',
      'browser_download',
    ]);

    let invoked: ModuleInvokeRequest | undefined;
    const service: BrowserPrimitiveService = {
      describe: browserPrimitiveModuleDescription,
      invoke: async (request) => {
        invoked = request;
        return moduleResult({
          moduleId: request.moduleId,
          ok: true,
          value: {
            schemaVersion: 'sciforge.browser-runtime.primitive-result.v1',
            moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
            primitive: 'search',
            status: 'completed',
            output: { query: '伊朗局势', results: [] },
            refs: [],
            diagnostics: [],
            budget: {},
          },
        });
      },
    };
    const adapter = createBrowserRuntimeMcpAdapter(service);

    await adapter.callTool({
      name: 'browser_search',
      arguments: {
        query: '伊朗局势',
        limit: 3,
      },
    });

    assert.deepEqual(invoked, {
      moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
      intent: BROWSER_PRIMITIVE_INTENTS.search,
      input: {
        schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.search,
        query: '伊朗局势',
        limit: 3,
      },
    });
  });

  it('normalizes direct read and download tool inputs to dispatcher contracts', async () => {
    const requests: ModuleInvokeRequest[] = [];
    const service: BrowserPrimitiveService = {
      describe: browserPrimitiveModuleDescription,
      invoke: async (request) => {
        requests.push(request);
        return moduleResult({
          moduleId: request.moduleId,
          ok: true,
          value: {
            schemaVersion: 'sciforge.browser-runtime.primitive-result.v1',
            moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
            primitive: 'read',
            status: 'completed',
            refs: [],
            diagnostics: [],
            budget: {},
          },
        });
      },
    };
    const adapter = createBrowserRuntimeMcpAdapter(service);

    await adapter.callTool({
      name: 'browser_read',
      arguments: { url: 'https://example.com/article', includeText: true },
    });
    await adapter.callTool({
      name: 'browser_download',
      arguments: { url: 'https://example.com/file.csv' },
    });

    assert.deepEqual(requests.map((request) => request.input), [{
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.read,
      url: 'https://example.com/article',
      includeText: true,
      navigationMode: 'ephemeral',
    }, {
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.download,
      url: 'https://example.com/file.csv',
      saveScope: 'session-artifacts',
    }]);
  });
});
