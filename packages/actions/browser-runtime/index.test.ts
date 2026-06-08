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

  it('accepts download domain constraints through the primitive validator', () => {
    const validation = validateBrowserPrimitiveInvokeRequest({
      moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
      intent: BROWSER_PRIMITIVE_INTENTS.download,
      input: {
        schemaVersion: 'sciforge.browser-runtime.download-input.v1',
        url: 'https://example.com/data.csv',
        saveScope: 'session-artifacts',
        constraints: {
          allowedDomains: ['example.com'],
          blockedDomains: ['downloads.example.net'],
        },
      },
    });

    assert.equal(validation.ok, true, validation.errors.join('\n'));
  });

  it('rejects malformed download constraints', () => {
    const validation = validateBrowserPrimitiveInvokeRequest({
      moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
      intent: BROWSER_PRIMITIVE_INTENTS.download,
      input: {
        schemaVersion: 'sciforge.browser-runtime.download-input.v1',
        url: 'https://example.com/data.csv',
        saveScope: 'session-artifacts',
        constraints: { allowedDomains: [42] },
      },
    });

    assert.equal(validation.ok, false);
    assert.match(validation.errors.join('\n'), /invalid_string_array:constraints\.allowedDomains/);
  });

  it('fails closed on malformed primitive inputs before a host port can run', () => {
    const cases: Array<{
      name: string;
      intent: string;
      input: Record<string, unknown>;
      expected: RegExp;
    }> = [
      {
        name: 'search schema mismatch',
        intent: BROWSER_PRIMITIVE_INTENTS.search,
        input: { schemaVersion: 'wrong', query: 'news' },
        expected: /schema_version_mismatch:sciforge\.browser-runtime\.search-input\.v1/,
      },
      {
        name: 'search unknown field',
        intent: BROWSER_PRIMITIVE_INTENTS.search,
        input: { schemaVersion: 'sciforge.browser-runtime.search-input.v1', query: 'news', rewriteQuery: true },
        expected: /unknown_input_field:rewriteQuery/,
      },
      {
        name: 'observe missing session',
        intent: BROWSER_PRIMITIVE_INTENTS.observe,
        input: { schemaVersion: 'sciforge.browser-runtime.observe-input.v1' },
        expected: /missing_string:sessionId/,
      },
      {
        name: 'read missing source',
        intent: BROWSER_PRIMITIVE_INTENTS.read,
        input: { schemaVersion: 'sciforge.browser-runtime.read-input.v1', includeText: true },
        expected: /missing_read_source:resourceRef_or_sessionId_or_url/,
      },
      {
        name: 'read ambiguous source',
        intent: BROWSER_PRIMITIVE_INTENTS.read,
        input: {
          schemaVersion: 'sciforge.browser-runtime.read-input.v1',
          resourceRef: 'browser:resource:web_page:abc123',
          url: 'https://example.com/article',
          navigationMode: 'ephemeral',
          includeText: true,
        },
        expected: /ambiguous_read_source:choose_one_of_resourceRef_sessionId_url/,
      },
      {
        name: 'extract missing targets',
        intent: BROWSER_PRIMITIVE_INTENTS.extract,
        input: { schemaVersion: 'sciforge.browser-runtime.extract-input.v1', ref: 'browser:page-text:1' },
        expected: /missing_enum_array:extract/,
      },
      {
        name: 'download file URL',
        intent: BROWSER_PRIMITIVE_INTENTS.download,
        input: {
          schemaVersion: 'sciforge.browser-runtime.download-input.v1',
          url: 'file:///tmp/data.csv',
          saveScope: 'session-artifacts',
        },
        expected: /invalid_url:url/,
      },
      {
        name: 'download ambiguous source',
        intent: BROWSER_PRIMITIVE_INTENTS.download,
        input: {
          schemaVersion: 'sciforge.browser-runtime.download-input.v1',
          url: 'https://example.com/data.csv',
          sessionId: 'session-1',
          linkSelector: 'a.download',
          saveScope: 'session-artifacts',
        },
        expected: /ambiguous_download_source:choose_url_or_session_linkSelector/,
      },
    ];

    for (const item of cases) {
      const validation = validateBrowserPrimitiveInvokeRequest({
        moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
        intent: item.intent,
        input: item.input,
      });
      assert.equal(validation.ok, false, item.name);
      assert.match(validation.errors.join('\n'), item.expected, item.name);
    }
  });
});

describe('browser primitive service composition', () => {
  it('publishes discovered search candidates as resources with evidence boundaries', async () => {
    const service = createBrowserPrimitiveService({
      ports: {
        search: async (input) => ({
          status: 'completed',
          output: {
            query: input.query,
            results: [{
              title: 'Latest source',
              url: 'https://example.com/latest',
              snippet: 'Current source candidate.',
            }],
            searchResultRef: 'browser:search-result:latest',
          },
          refs: ['browser:search-result:latest'],
        }),
      },
    });

    const result = await service.invoke(request(BROWSER_PRIMITIVE_INTENTS.search, {
      schemaVersion: 'sciforge.browser-runtime.search-input.v1',
      query: 'latest source',
      limit: 1,
    }));

    assert.equal(result.ok, true);
    const value = result.value as unknown as {
      output?: {
        results?: Array<Record<string, unknown>>;
      };
      resources?: Array<{
        ref: string;
        kind: string;
        status: string;
        locator?: Record<string, unknown>;
      }>;
      evidenceState?: {
        completed?: string[];
        unknown?: string[];
        boundary?: string;
      };
    };
    const legacyReadField = ['read', 'Input'].join('');
    const legacyCandidateField = ['candidate', 'Read', 'Inputs'].join('');
    const legacyRepairCode = ['search', 'results', 'require', 'read'].join('-');
    assert.equal(value.output?.results?.[0]?.[legacyReadField], undefined);
    assert.equal(JSON.stringify(value).includes(legacyCandidateField), false);
    assert.equal(JSON.stringify(value).includes(legacyRepairCode), false);
    assert.ok(value.resources?.some((resource) =>
      resource.kind === 'web_page'
      && resource.status === 'discovered'
      && resource.locator?.url === 'https://example.com/latest'
    ));
    assert.ok(value.evidenceState?.completed?.some((entry) => /candidate/i.test(entry)));
    assert.ok(value.evidenceState?.unknown?.some((entry) => /not been read/i.test(entry)));
    assert.match(value.evidenceState?.boundary ?? '', /not source evidence/i);
  });

  it('resolves a discovered web_page resourceRef when browser.read is invoked', async () => {
    let capturedReadRequest: Record<string, unknown> | undefined;
    const service = createBrowserPrimitiveService({
      ports: {
        search: async (input) => ({
          status: 'completed',
          output: {
            query: input.query,
            results: [{
              title: 'Latest source',
              url: 'https://example.com/latest',
              snippet: 'Current source candidate.',
            }],
            searchResultRef: 'browser:search-result:latest',
          },
          refs: ['browser:search-result:latest'],
        }),
        read: async (input) => {
          capturedReadRequest = input as unknown as Record<string, unknown>;
          return {
            status: 'completed',
            output: {
              finalUrl: input.url ?? '',
              title: 'Latest source',
              sourcePageRef: 'browser:source-page:latest',
              pageTextRef: 'browser:page-text:latest',
              textPreview: 'Readable page text.',
              textCharCount: 19,
            },
            refs: ['browser:source-page:latest', 'browser:page-text:latest'],
          };
        },
      },
    });

    const search = await service.invoke(request(BROWSER_PRIMITIVE_INTENTS.search, {
      schemaVersion: 'sciforge.browser-runtime.search-input.v1',
      query: 'latest source',
      limit: 1,
    }));
    const searchValue = search.value as unknown as {
      resources?: Array<{ ref: string; kind: string; status: string }>;
    };
    const webPageRef = searchValue.resources?.find((resource) =>
      resource.kind === 'web_page' && resource.status === 'discovered'
    )?.ref;
    assert.ok(webPageRef);

    const read = await service.invoke(request(BROWSER_PRIMITIVE_INTENTS.read, {
      schemaVersion: 'sciforge.browser-runtime.read-input.v1',
      resourceRef: webPageRef,
      includeText: true,
    }));

    assert.equal(read.ok, true);
    assert.equal(capturedReadRequest?.resourceRef, webPageRef);
    assert.equal(capturedReadRequest?.url, 'https://example.com/latest');
    assert.equal(capturedReadRequest?.navigationMode, 'ephemeral');
    const readValue = read.value as unknown as { resources?: Array<{ kind?: string; metadata?: Record<string, unknown> }> };
    const pageTextResource = readValue.resources?.find((resource) => resource.kind === 'page_text');
    assert.equal(pageTextResource?.metadata?.textPreview, 'Readable page text.');
  });

  it('fails closed when browser.read receives an unresolved or non-readable resourceRef', async () => {
    let readCalls = 0;
    const service = createBrowserPrimitiveService({
      ports: {
        search: async () => ({
          status: 'completed',
          output: {
            query: 'latest source',
            results: [{
              title: 'Latest source',
              url: 'https://example.com/latest',
            }],
            searchResultRef: 'browser:search-result:latest',
          },
          resources: [{
            ref: 'browser:resource:web_page:no-url',
            kind: 'web_page',
            status: 'discovered',
            originTool: BROWSER_PRIMITIVE_INTENTS.search,
            locator: {},
          }],
          refs: ['browser:search-result:latest'],
        }),
        read: async () => {
          readCalls += 1;
          return {
            status: 'completed',
            output: {
              finalUrl: 'https://example.com/latest',
              sourcePageRef: 'browser:source-page:latest',
            },
            refs: ['browser:source-page:latest'],
          };
        },
      },
    });

    const unknown = await service.invoke(request(BROWSER_PRIMITIVE_INTENTS.read, {
      schemaVersion: 'sciforge.browser-runtime.read-input.v1',
      resourceRef: 'browser:resource:web_page:unknown',
      includeText: true,
    }));

    assert.equal(unknown.ok, false);
    assert.equal(unknown.value?.status, 'blocked');
    assert.equal(unknown.value?.blockedReason, 'browser_resource_ref_unresolved');

    const search = await service.invoke(request(BROWSER_PRIMITIVE_INTENTS.search, {
      schemaVersion: 'sciforge.browser-runtime.search-input.v1',
      query: 'latest source',
      limit: 1,
    }));
    assert.equal(search.ok, true);

    const searchResultSet = await service.invoke(request(BROWSER_PRIMITIVE_INTENTS.read, {
      schemaVersion: 'sciforge.browser-runtime.read-input.v1',
      resourceRef: 'browser:search-result:latest',
      includeText: true,
    }));
    const noUrl = await service.invoke(request(BROWSER_PRIMITIVE_INTENTS.read, {
      schemaVersion: 'sciforge.browser-runtime.read-input.v1',
      resourceRef: 'browser:resource:web_page:no-url',
      includeText: true,
    }));

    assert.equal(searchResultSet.ok, false);
    assert.equal(noUrl.ok, false);
    assert.equal(readCalls, 0);
  });

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
    assert.ok(search.value?.resources.some((resource) => resource.kind === 'search_result_set'));
    assert.ok(search.value?.resources.some((resource) => resource.kind === 'web_page' && resource.status === 'discovered'));
    assert.match(search.value?.evidenceState.boundary ?? '', /not source evidence/i);

    const navigate = await service.invoke(request(BROWSER_PRIMITIVE_INTENTS.navigate, {
      schemaVersion: 'sciforge.browser-runtime.navigate-input.v1',
      url: searchOutput.results[0]?.url,
    }));
    assert.equal(navigate.ok, true);
    const navigateOutput = navigate.value?.output as { sessionId: string };
    assert.ok(navigate.value?.resources.some((resource) => resource.kind === 'browser_session' && resource.status === 'accessed'));

    const observe = await service.invoke(request(BROWSER_PRIMITIVE_INTENTS.observe, {
      schemaVersion: 'sciforge.browser-runtime.observe-input.v1',
      sessionId: navigateOutput.sessionId,
    }));
    assert.equal(observe.ok, true);
    assert.ok(observe.value?.resources.some((resource) => resource.kind === 'browser_session' && resource.status === 'observed'));

    const read = await service.invoke(request(BROWSER_PRIMITIVE_INTENTS.read, {
      schemaVersion: 'sciforge.browser-runtime.read-input.v1',
      sessionId: navigateOutput.sessionId,
      includeText: true,
    }));
    assert.equal(read.ok, true);
    const readOutput = read.value?.output as { pageTextRef: string };
    assert.ok(read.value?.resources.some((resource) => resource.kind === 'source_page' && resource.status === 'read'));
    assert.ok(read.value?.resources.some((resource) => resource.kind === 'page_text' && resource.status === 'read'));

    const extract = await service.invoke(request(BROWSER_PRIMITIVE_INTENTS.extract, {
      schemaVersion: 'sciforge.browser-runtime.extract-input.v1',
      ref: readOutput.pageTextRef,
      extract: ['links'],
    }));
    assert.equal(extract.ok, true);
    const extractOutput = extract.value?.output as { links: Array<{ url: string }> };
    assert.ok(extract.value?.resources.some((resource) => resource.kind === 'web_page' && resource.status === 'discovered'));

    const download = await service.invoke(request(BROWSER_PRIMITIVE_INTENTS.download, {
      schemaVersion: 'sciforge.browser-runtime.download-input.v1',
      url: extractOutput.links[0]?.url,
      saveScope: 'session-artifacts',
    }));
    assert.equal(download.ok, true);
    assert.ok(download.value?.resources.some((resource) => resource.kind === 'download_artifact' && resource.status === 'downloaded'));

    assert.deepEqual(calls, [
      'search:example paper',
      'navigate:https://example.com/paper',
      'observe:session-1',
      'read:session-1',
      'extract:browser:page-text:1',
      'download:https://example.com/data.csv',
    ]);
  });

  it('does not mark needs-confirmation downloads as completed evidence', async () => {
    const service = createBrowserPrimitiveService({
      ports: {
        download: async () => ({
          status: 'needs-confirmation',
          blockedReason: 'download_unknown_mime_requires_confirmation',
          diagnostics: [{
            code: 'browser-download-unknown-mime',
            message: 'Unknown MIME requires confirmation.',
            severity: 'warning',
            retryable: false,
          }],
          refs: [],
        }),
      },
    });

    const result = await service.invoke(request(BROWSER_PRIMITIVE_INTENTS.download, {
      schemaVersion: 'sciforge.browser-runtime.download-input.v1',
      url: 'https://example.com/payload.bin',
      saveScope: 'session-artifacts',
    }));

    assert.equal(result.ok, false);
    assert.equal(result.value?.status, 'needs-confirmation');
    assert.equal(result.value?.blockedReason, 'download_unknown_mime_requires_confirmation');
    assert.equal(result.value?.resources.some((resource) => resource.kind === 'download_artifact'), false);
    assert.match(result.value?.evidenceState.boundary ?? '', /not user-level completion evidence/i);
    assert.match(result.value?.evidenceState.unknown.join('\n') ?? '', /did not complete successfully/i);
    assert.doesNotMatch(JSON.stringify(result.value?.evidenceState), /Downloaded a Host-selected resource/i);
  });
});

function request(intent: string, input: Record<string, unknown>): ModuleInvokeRequest {
  return {
    moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
    intent,
    input,
  };
}
