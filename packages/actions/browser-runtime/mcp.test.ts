import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { moduleResult, type ModuleInvokeRequest } from '@sciforge-ui/runtime-contract/modules';
import {
  BROWSER_PRIMITIVE_INPUT_SCHEMAS,
  BROWSER_PRIMITIVE_INTENTS,
  BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
  WEB_READ_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  WEB_TOOL_RESULT_SCHEMA,
  browserPrimitiveModuleDescription,
  type BrowserPrimitiveService,
} from './index.js';
import {
  browserRuntimeMcpTools,
  createBrowserRuntimeMcpAdapter,
} from './mcp.js';

describe('browser runtime MCP web tool facade', () => {
  it('exposes only P0 web_search and web_read direct tools', () => {
    const tools = browserRuntimeMcpTools();

    assert.deepEqual(tools.map((tool) => tool.name), [WEB_SEARCH_TOOL_NAME, WEB_READ_TOOL_NAME]);
    assert.equal(tools.some((tool) => tool.name === 'web_extract'), false);
    assert.equal(tools.some((tool) => tool.name === 'web_batch_read'), false);
    assert.equal(tools.some((tool) => tool.name.startsWith('browser_')), false);
  });

  it('documents ordinary web_search and internal or advanced web_read roles', () => {
    const tools = browserRuntimeMcpTools();
    const searchTool = tools.find((tool) => tool.name === WEB_SEARCH_TOOL_NAME);
    const readTool = tools.find((tool) => tool.name === WEB_READ_TOOL_NAME);

    assert.ok(searchTool);
    assert.ok(readTool);
    assert.match(searchTool.description, /Codex-compatible/i);
    assert.match(searchTool.description, /ordinary search/i);
    assert.match(searchTool.description, /source links/i);
    assert.match(searchTool.description, /does not require web_read/i);
    assert.doesNotMatch(searchTool.description, /call web_read/i);
    assert.doesNotMatch(searchTool.description, /before citing or summarizing/i);
    assert.doesNotMatch(searchTool.description, /source\/page text refs are evidence/i);
    assert.match(readTool.description, /internal or advanced/i);
    assert.match(readTool.description, /URL summaries/i);
    assert.match(readTool.description, /page-level verification/i);
    assert.match(readTool.description, /source\/page text refs are evidence/i);
    assert.match(readTool.description, /web-source:\{id\}/);
    assert.match(readTool.description, /web-text:\{id\}/);
  });

  it('routes web_search through the Browser search dispatcher contract', async () => {
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
            output: {
              query: 'OpenAI latest news',
              engine: 'searxng',
              results: [{
                rank: 1,
                title: 'OpenAI News',
                url: 'https://example.com/openai',
                snippet: 'Candidate result.',
              }],
              searchResultRef: 'web-search:result-set-1',
            },
            resources: [{
              ref: 'web-page:page-1',
              kind: 'web_page',
              status: 'discovered',
              originTool: BROWSER_PRIMITIVE_INTENTS.search,
              locator: { url: 'https://example.com/openai' },
              confidence: 'candidate',
            }],
            evidenceState: {
              completed: ['Discovered 1 candidate web page resource(s).'],
              unknown: ['Candidate page bodies have not been read or materialized as source/page text refs.'],
              boundary: 'Current-run web_search results can support ordinary search answers with source links; page-level content uses read-required escalation.',
            },
            refs: ['web-search:result-set-1', 'web-page:page-1'],
            diagnostics: [],
            budget: { elapsedMs: 12 },
          },
        });
      },
    };
    const adapter = createBrowserRuntimeMcpAdapter(service);

    const result = await adapter.callTool({
      name: WEB_SEARCH_TOOL_NAME,
      arguments: {
        query: 'OpenAI latest news',
        limit: 3,
        language: 'en',
        region: 'us',
        safe_search: 'moderate',
        provider: 'searxng',
        timeout_ms: 5_000,
      },
    });

    assert.deepEqual(invoked, {
      moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
      intent: BROWSER_PRIMITIVE_INTENTS.search,
      input: {
        schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.search,
        query: 'OpenAI latest news',
        limit: 3,
        locale: 'en',
        region: 'us',
        engine: 'searxng',
        budget: { maxTimeMs: 5_000 },
        constraints: { safeSearch: 'moderate' },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.value?.schemaVersion, WEB_TOOL_RESULT_SCHEMA);
    assert.equal(result.value?.tool, WEB_SEARCH_TOOL_NAME);
    assert.equal(result.value?.ok, true);
    assert.match(result.value?.data?.evidenceBoundary ?? '', /ordinary search/i);
    assert.match(result.value?.data?.evidenceBoundary ?? '', /read-required escalation/i);
    assert.equal(result.value?.refs.some((ref) => ref.kind === 'source_page' || ref.kind === 'page_text'), false);
  });

  it('routes web_read through the Browser read dispatcher contract and projects source evidence refs', async () => {
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
            primitive: 'read',
            status: 'completed',
            output: {
              requestedUrl: 'https://example.com/openai',
              finalUrl: 'https://example.com/openai',
              title: 'OpenAI News',
              contentType: 'text/html',
              sourcePageRef: 'web-source:source-1',
              pageTextRef: 'web-text:text-1',
              textPreview: 'Readable article text.',
              textCharCount: 22,
              textSha1: 'abc123',
            },
            resources: [{
              ref: 'web-source:source-1',
              kind: 'source_page',
              status: 'read',
              originTool: BROWSER_PRIMITIVE_INTENTS.read,
              locator: { url: 'https://example.com/openai' },
              confidence: 'materialized',
            }, {
              ref: 'web-text:text-1',
              kind: 'page_text',
              status: 'read',
              originTool: BROWSER_PRIMITIVE_INTENTS.read,
              locator: { url: 'https://example.com/openai' },
              confidence: 'materialized',
            }],
            evidenceState: {
              completed: ['Materialized page content as source/page text refs.'],
              unknown: ['Task-level synthesis remains outside Browser Runtime.'],
              boundary: 'web_read source/page text refs are evidence; Agent Host decides final answer sufficiency.',
            },
            refs: ['web-source:source-1', 'web-text:text-1'],
            diagnostics: [],
            budget: { elapsedMs: 25 },
          },
        });
      },
    };
    const adapter = createBrowserRuntimeMcpAdapter(service);

    const result = await adapter.callTool({
      name: WEB_READ_TOOL_NAME,
      arguments: {
        url: 'https://example.com/openai',
        format: 'markdown',
        render: 'static',
        max_chars: 12_000,
        timeout_ms: 8_000,
      },
    });

    assert.deepEqual(invoked, {
      moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
      intent: BROWSER_PRIMITIVE_INTENTS.read,
      input: {
        schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.read,
        url: 'https://example.com/openai',
        navigationMode: 'ephemeral',
        includeText: true,
        includeHtml: false,
        maxTextChars: 12_000,
        timeoutMs: 8_000,
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.value?.schemaVersion, WEB_TOOL_RESULT_SCHEMA);
    assert.equal(result.value?.tool, WEB_READ_TOOL_NAME);
    assert.equal(result.value?.ok, true);
    assert.match(result.value?.data?.evidenceBoundary ?? '', /source\/page text refs are evidence/i);
    assert.ok(result.value?.refs.some((ref) => ref.ref === 'web-source:source-1' && ref.evidence === 'source'));
    assert.ok(result.value?.refs.some((ref) => ref.ref === 'web-text:text-1' && ref.evidence === 'source'));
  });
});
