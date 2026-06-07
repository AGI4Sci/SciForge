import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ModuleInvokeRequest } from '@sciforge-ui/runtime-contract/modules';
import {
  BROWSER_PRIMITIVE_RESULT_SCHEMA,
  BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
  BROWSER_PRIMITIVE_INTENTS,
  createBrowserPrimitiveService,
  validateBrowserPrimitiveInvokeRequest,
  type BrowserPrimitivePorts,
} from './index.js';

describe('browser primitive contracts', () => {
  it('rejects legacy browser.open in favor of browser.navigate', () => {
    const validation = validateBrowserPrimitiveInvokeRequest({
      moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
      intent: 'browser.open',
      input: { schemaVersion: 'sciforge.browser-runtime.navigate-input.v1', url: 'https://example.com' },
    });

    assert.equal(validation.ok, false);
    assert.match(validation.errors.join('\n'), /unsupported_browser_primitive_intent:browser\.open/);
  });

  it('strictly rejects unknown fields and invalid navigate URLs', () => {
    const validation = validateBrowserPrimitiveInvokeRequest({
      moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
      intent: BROWSER_PRIMITIVE_INTENTS.navigate,
      input: {
        schemaVersion: 'sciforge.browser-runtime.navigate-input.v1',
        url: 'file:///tmp/local.html',
        title: 'not allowed',
      },
    });

    assert.equal(validation.ok, false);
    assert.deepEqual(validation.errors.sort(), [
      'invalid_url:url',
      'unknown_input_field:title',
    ]);
  });

  it('requires ephemeral navigation mode when read is asked to fetch a URL directly', () => {
    const validation = validateBrowserPrimitiveInvokeRequest({
      moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
      intent: BROWSER_PRIMITIVE_INTENTS.read,
      input: {
        schemaVersion: 'sciforge.browser-runtime.read-input.v1',
        url: 'https://example.com/article',
        includeText: true,
      },
    });

    assert.equal(validation.ok, false);
    assert.match(validation.errors.join('\n'), /read_url_requires_navigationMode_ephemeral/);
  });

  it('constrains downloads to session artifacts', () => {
    const validation = validateBrowserPrimitiveInvokeRequest({
      moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
      intent: BROWSER_PRIMITIVE_INTENTS.download,
      input: {
        schemaVersion: 'sciforge.browser-runtime.download-input.v1',
        url: 'https://example.com/data.csv',
        saveScope: 'workspace',
      },
    });

    assert.equal(validation.ok, false);
    assert.match(validation.errors.join('\n'), /invalid_literal:saveScope/);
  });
});

describe('browser primitive service composition', () => {
  it('chains search, navigate, observe, read, extract, and download through structured refs', async () => {
    const calls: string[] = [];
    const ports: BrowserPrimitivePorts = {
      search: async (input) => {
        calls.push(`search:${input.query}`);
        return {
          status: 'completed',
          output: {
            query: input.query,
            results: [{
              title: 'Example paper',
              url: 'https://example.com/paper',
              snippet: 'A useful result.',
            }],
            searchResultRef: 'browser:search-result:1',
          },
          refs: ['browser:search-result:1'],
        };
      },
      navigate: async (input) => {
        calls.push(`navigate:${input.url}`);
        return {
          status: 'completed',
          output: {
            sessionId: 'session-1',
            requestedUrl: input.url,
            finalUrl: input.url,
            title: 'Example paper',
          },
          refs: ['browser:session:session-1'],
        };
      },
      observe: async (input) => {
        calls.push(`observe:${input.sessionId}`);
        return {
          status: 'completed',
          output: {
            sessionId: input.sessionId,
            url: 'https://example.com/paper',
            title: 'Example paper',
            stateRef: 'browser:state:1',
            screenshotRef: 'browser:screenshot:1',
          },
          refs: ['browser:state:1', 'browser:screenshot:1'],
        };
      },
      read: async (input) => {
        calls.push(`read:${input.sessionId ?? input.url}`);
        return {
          status: 'completed',
          output: {
            sessionId: input.sessionId,
            finalUrl: 'https://example.com/paper',
            title: 'Example paper',
            sourcePageRef: 'browser:source-page:1',
            pageTextRef: 'browser:page-text:1',
            textPreview: 'Supplementary data is available as CSV.',
            textCharCount: 44,
          },
          refs: ['browser:source-page:1', 'browser:page-text:1'],
        };
      },
      extract: async (input) => {
        calls.push(`extract:${input.ref}`);
        return {
          status: 'completed',
          output: {
            ref: input.ref,
            links: [{
              text: 'data.csv',
              url: 'https://example.com/data.csv',
            }],
          },
          refs: ['browser:link-set:1'],
        };
      },
      download: async (input) => {
        calls.push(`download:${input.url}`);
        return {
          status: 'completed',
          output: {
            artifactRef: 'browser:download:1',
            filename: 'data.csv',
            mimeType: 'text/csv',
            byteLength: 12,
            sha256: 'abc123',
          },
          refs: ['browser:download:1'],
        };
      },
    };
    const service = createBrowserPrimitiveService({ ports });

    const search = await service.invoke(request(BROWSER_PRIMITIVE_INTENTS.search, {
      schemaVersion: 'sciforge.browser-runtime.search-input.v1',
      query: 'example paper',
      limit: 1,
    }));
    assert.equal(search.ok, true);
    assert.equal(search.value?.schemaVersion, BROWSER_PRIMITIVE_RESULT_SCHEMA);
    const searchOutput = search.value?.output as { results: Array<{ url: string }> };

    const navigate = await service.invoke(request(BROWSER_PRIMITIVE_INTENTS.navigate, {
      schemaVersion: 'sciforge.browser-runtime.navigate-input.v1',
      url: searchOutput.results[0]?.url,
    }));
    assert.equal(navigate.ok, true);
    const navigateOutput = navigate.value?.output as { sessionId: string };

    const observe = await service.invoke(request(BROWSER_PRIMITIVE_INTENTS.observe, {
      schemaVersion: 'sciforge.browser-runtime.observe-input.v1',
      sessionId: navigateOutput.sessionId,
    }));
    assert.equal(observe.ok, true);

    const read = await service.invoke(request(BROWSER_PRIMITIVE_INTENTS.read, {
      schemaVersion: 'sciforge.browser-runtime.read-input.v1',
      sessionId: navigateOutput.sessionId,
      includeText: true,
    }));
    assert.equal(read.ok, true);
    const readOutput = read.value?.output as { pageTextRef: string };

    const extract = await service.invoke(request(BROWSER_PRIMITIVE_INTENTS.extract, {
      schemaVersion: 'sciforge.browser-runtime.extract-input.v1',
      ref: readOutput.pageTextRef,
      extract: ['links'],
    }));
    assert.equal(extract.ok, true);
    const extractOutput = extract.value?.output as { links: Array<{ url: string }> };

    const download = await service.invoke(request(BROWSER_PRIMITIVE_INTENTS.download, {
      schemaVersion: 'sciforge.browser-runtime.download-input.v1',
      url: extractOutput.links[0]?.url,
      saveScope: 'session-artifacts',
    }));
    assert.equal(download.ok, true);

    assert.deepEqual(calls, [
      'search:example paper',
      'navigate:https://example.com/paper',
      'observe:session-1',
      'read:session-1',
      'extract:browser:page-text:1',
      'download:https://example.com/data.csv',
    ]);
  });
});

function request(intent: string, input: Record<string, unknown>): ModuleInvokeRequest {
  return {
    moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
    intent,
    input,
  };
}
