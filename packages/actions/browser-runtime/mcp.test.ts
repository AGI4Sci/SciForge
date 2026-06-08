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
            resources: [],
            evidenceState: {
              completed: [],
              unknown: [],
              boundary: 'test envelope',
            },
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
            resources: [],
            evidenceState: {
              completed: [],
              unknown: [],
              boundary: 'test envelope',
            },
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
      name: 'browser_read',
      arguments: { resourceRef: 'browser:resource:web_page:1', includeText: true },
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
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.read,
      resourceRef: 'browser:resource:web_page:1',
      includeText: true,
    }, {
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.download,
      url: 'https://example.com/file.csv',
      saveScope: 'session-artifacts',
    }]);
  });

  it('documents resource refs without legacy read input wording', () => {
    const tools = browserRuntimeMcpTools();
    const readTool = tools.find((tool) => tool.name === 'browser_read');

    assert.deepEqual(
      (readTool?.inputSchema.properties as Record<string, unknown>).resourceRef,
      { type: 'string', minLength: 1 },
    );
    const descriptions = tools.map((tool) => tool.description).join('\n');
    const legacyReadInput = ['read', 'Input'].join('');
    const legacyCandidateInputs = ['candidate', 'Read', 'Inputs'].join('');

    assert.match(descriptions, /resources\/evidenceState/);
    assert.match(descriptions, /candidate web_page resources/);
    assert.match(descriptions, /browser_read/);
    assert.equal(descriptions.includes(legacyReadInput), false);
    assert.equal(descriptions.includes(legacyCandidateInputs), false);
  });
});
