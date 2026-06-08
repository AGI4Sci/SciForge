import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { EXECUTE_BOUNDED_OPERATION_INTENT } from '@sciforge-ui/runtime-contract/modules';
import {
  BROWSER_PRIMITIVE_INTENTS,
  BROWSER_PRIMITIVE_RESULT_SCHEMA,
  type BrowserPrimitiveEnvelope,
} from '../../../packages/actions/browser-runtime/index.js';
import { createRuntimeModuleDispatcher, createRuntimeModuleRegistry } from './dispatcher.js';
import * as boundedOperationHandlers from './bounded-operation-module-handlers.js';
import { createBrowserRuntimeModuleHandler } from './bounded-operation-module-handlers.js';
import {
  BROWSER_HOST_SESSION_PROVIDER_ID,
  BROWSER_HOST_SESSION_SCHEMA,
  type BrowserHostPageReadInput,
  type BrowserHostPageReadOutput,
  type BrowserHostSessionManager,
  type BrowserHostSessionState,
} from '../browser-host-session.js';

function requiredBoundedLimits(stopConditions = ['local-operation-complete']) {
  return {
    maxSteps: 4,
    maxTimeMs: 10_000,
    maxModelCalls: 1,
    stopConditions,
  };
}

test('browser module no longer exposes or executes legacy bounded search_read/open_read compatibility', async () => {
  let legacyPortCalls = 0;
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    browser: createBrowserRuntimeModuleHandler({
      primitivePorts: {
        search: async (input) => ({
          status: 'completed',
          refs: ['browser:search-result:frontier'],
          output: { query: input.query, results: [], searchResultRef: 'browser:search-result:frontier' },
        }),
      },
    }),
  }));

  const description = await dispatcher.describe({ moduleId: 'browser' });
  const text = JSON.stringify(description.value);
  assert.doesNotMatch(text, /executeBoundedOperation|browser\.search_read|browser\.open_read/);

  for (const operationKind of ['browser.search_read', 'browser.open_read']) {
    const result = await dispatcher.invoke({
      moduleId: 'browser',
      intent: EXECUTE_BOUNDED_OPERATION_INTENT,
      input: {
        operationKind,
        ownerModuleId: 'browser',
        targetScope: { kind: 'web-search', query: 'frontier AI' },
        config: {
          allowedActions: ['search', 'navigate', 'read'],
          ...requiredBoundedLimits(['legacy-blocked']),
          riskPolicy: 'low',
          requiredEvidence: ['source-page-ref', 'page-text-ref'],
        },
      },
    });

    assert.equal(result.ok, false, operationKind);
    assert.match(result.error ?? '', /unsupported_intent:executeBoundedOperation/, operationKind);
  }
  assert.equal(legacyPortCalls, 0);
});

test('browser module dispatches primitive intents through the same module.invoke path', async () => {
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    browser: createBrowserRuntimeModuleHandler({
      primitivePorts: {
        navigate: async (input) => ({
          status: 'completed',
          refs: ['browser-host-session:primitive/session.json'],
          output: {
            sessionId: 'primitive',
            sessionRef: 'browser-host-session:primitive',
            requestedUrl: input.url,
            finalUrl: input.url,
            title: 'Primitive page',
          },
        }),
      },
    }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'browser',
    intent: BROWSER_PRIMITIVE_INTENTS.navigate,
    input: {
      schemaVersion: 'sciforge.browser-runtime.navigate-input.v1',
      url: 'https://example.test/primitive',
    },
  });

  assert.equal(result.ok, true);
  const value = result.value as BrowserPrimitiveEnvelope<{ finalUrl: string }>;
  assert.equal(value.schemaVersion, BROWSER_PRIMITIVE_RESULT_SCHEMA);
  assert.equal(value.primitive, 'navigate');
  assert.equal(value.output?.finalUrl, 'https://example.test/primitive');
  assert.deepEqual(result.refs, ['browser-host-session:primitive/session.json']);
  assert.equal(dispatcher.trace()[0]?.intent, BROWSER_PRIMITIVE_INTENTS.navigate);
});

test('browser primitive read adapter materializes current session page text via BrowserHostSessionManager', async () => {
  const calls: Array<{ workspacePath: string; input: BrowserHostPageReadInput }> = [];
  const manager = {
    async sessionState(_workspacePath: string, sessionId: string) {
      return {
        schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
        id: sessionId,
        owner: 'host',
        providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
        status: 'ready',
        workspacePath: '/workspace',
        requestedUrl: 'https://example.test/current',
        url: 'https://example.test/current',
        title: 'Current page',
        startedAt: '2026-06-06T00:00:00.000Z',
        updatedAt: '2026-06-06T00:00:01.000Z',
        viewport: { width: 800, height: 600 },
        canGoBack: false,
        canGoForward: false,
        diagnostics: [],
      };
    },
    async readPage(workspacePath: string, input: BrowserHostPageReadInput): Promise<BrowserHostPageReadOutput> {
      calls.push({ workspacePath, input });
      return {
        sourcePage: {
          resultIndex: 0,
          title: 'Current page',
          url: input.url,
          finalUrl: input.url,
          openedAt: '2026-06-06T00:00:02.000Z',
          status: 'read',
          sourcePageRef: 'browser-host-session:primitive-read/source-pages/source-1.source.json',
          textRef: 'browser-host-session:primitive-read/source-pages/source-1.txt',
          textPreview: 'Current page body.',
          textCharCount: 18,
          textSha1: 'abc123',
        },
        session: {
          schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
          id: 'primitive-read',
          owner: 'host',
          providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
          status: 'ready',
          workspacePath: '/workspace',
          requestedUrl: input.url,
          url: input.url,
          title: 'Current page',
          startedAt: '2026-06-06T00:00:00.000Z',
          updatedAt: '2026-06-06T00:00:02.000Z',
          viewport: { width: 800, height: 600 },
          canGoBack: false,
          canGoForward: false,
          diagnostics: [],
        },
      };
    },
  } as unknown as BrowserHostSessionManager;
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    browser: createBrowserRuntimeModuleHandler({ workspacePath: '/workspace', manager }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'browser',
    intent: BROWSER_PRIMITIVE_INTENTS.read,
    input: {
      schemaVersion: 'sciforge.browser-runtime.read-input.v1',
      sessionId: 'primitive-read',
      includeText: true,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0]?.workspacePath, '/workspace');
  assert.equal(calls[0]?.input.url, 'https://example.test/current');
  const value = result.value as BrowserPrimitiveEnvelope<{ pageTextRef?: string }>;
  assert.equal(value.primitive, 'read');
  assert.equal(value.output?.pageTextRef, 'browser-host-session:primitive-read/source-pages/source-1.txt');
  assert.ok(result.refs?.includes('browser-host-session:primitive-read/source-pages/source-1.txt'));
});

test('browser primitive extract parses links from browser-host-session refs without network access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-browser-primitive-extract-'));
  const sessionDir = join(root, '.sciforge', 'browser-host', 'sessions', 'extract-session', 'source-pages');
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, 'source-1.txt'), [
    '<html><body>',
    '<a href="https://example.test/a">Alpha</a>',
    'See also https://example.test/b.',
    '</body></html>',
  ].join('\n'), 'utf8');
  try {
    const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
      browser: createBrowserRuntimeModuleHandler({ workspacePath: root }),
    }));

    const result = await dispatcher.invoke({
      moduleId: 'browser',
      intent: BROWSER_PRIMITIVE_INTENTS.extract,
      input: {
        schemaVersion: 'sciforge.browser-runtime.extract-input.v1',
        ref: 'browser-host-session:extract-session/source-pages/source-1.txt',
        extract: ['links'],
      },
    });

    assert.equal(result.ok, true);
    const value = result.value as BrowserPrimitiveEnvelope<{ links?: Array<{ url: string; text?: string }> }>;
    assert.equal(value.primitive, 'extract');
    assert.deepEqual(value.output?.links?.map((link) => link.url), [
      'https://example.test/a',
      'https://example.test/b',
    ]);
    assert.equal(value.output?.links?.[0]?.text, 'Alpha');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('browser primitive download writes only session-scoped artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-browser-primitive-download-'));
  const server = await startTextServer('id,name\n1,Ada\n', 'text/csv');
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}/data.csv`;
    const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
      browser: createBrowserRuntimeModuleHandler({ workspacePath: root }),
    }));

    const result = await dispatcher.invoke({
      moduleId: 'browser',
      intent: BROWSER_PRIMITIVE_INTENTS.download,
      input: {
        schemaVersion: 'sciforge.browser-runtime.download-input.v1',
        url,
        sessionId: 'download-session',
        saveScope: 'session-artifacts',
        maxBytes: 1024,
      },
    });

    assert.equal(result.ok, true);
    const value = result.value as BrowserPrimitiveEnvelope<{ artifactRef?: string; byteLength?: number; mimeType?: string }>;
    assert.equal(value.primitive, 'download');
    assert.equal(value.output?.byteLength, 14);
    assert.match(value.output?.artifactRef ?? '', /^browser-host-session:download-session\/downloads\/[a-f0-9]{12}-data\.csv$/);
    assert.equal(value.output?.mimeType, 'text/csv');
  } finally {
    await closeServer(server);
    await rm(root, { recursive: true, force: true });
  }
});

test('browser primitive download returns refs-first evidence for a local PDF fixture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-browser-primitive-download-pdf-'));
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'utf8');
  const server = await startBinaryServer(pdfBytes, 'application/pdf', '/paper.pdf');
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}/paper.pdf`;
    const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
      browser: createBrowserRuntimeModuleHandler({ workspacePath: root }),
    }));

    const result = await dispatcher.invoke({
      moduleId: 'browser',
      intent: BROWSER_PRIMITIVE_INTENTS.download,
      input: {
        schemaVersion: 'sciforge.browser-runtime.download-input.v1',
        url,
        sessionId: 'pdf-session',
        saveScope: 'session-artifacts',
        maxBytes: 1024,
      },
    });

    assert.equal(result.ok, true);
    const value = result.value as BrowserPrimitiveEnvelope<{
      artifactRef?: string;
      filename?: string;
      mimeType?: string;
      byteLength?: number;
      sha256?: string;
      finalUrl?: string;
    }>;
    const expectedSha256 = createHash('sha256').update(pdfBytes).digest('hex');
    assert.equal(value.primitive, 'download');
    assert.equal(value.status, 'completed');
    assert.match(value.output?.artifactRef ?? '', /^browser-host-session:pdf-session\/downloads\/[a-f0-9]{12}-paper\.pdf$/);
    assert.equal(value.output?.filename, 'paper.pdf');
    assert.equal(value.output?.mimeType, 'application/pdf');
    assert.equal(value.output?.byteLength, pdfBytes.byteLength);
    assert.equal(value.output?.sha256, expectedSha256);
    assert.equal(value.output?.finalUrl, url);

    const artifact = value.resources.find((resource) => resource.kind === 'download_artifact');
    assert.equal(artifact?.ref, value.output?.artifactRef);
    assert.equal(artifact?.status, 'downloaded');
    assert.equal(artifact?.locator?.url, url);
    assert.equal(artifact?.metadata?.mimeType, 'application/pdf');
    assert.equal(artifact?.metadata?.byteLength, pdfBytes.byteLength);
    assert.equal(artifact?.metadata?.sha256, expectedSha256);

    const serialized = JSON.stringify(value);
    assert.doesNotMatch(serialized, /%PDF-1\.4|data:application\/pdf|;base64,/i);
    assert.doesNotMatch(serialized, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assertNoInlineDownloadPayloadFields(value);
    const artifactPath = join(root, '.sciforge', 'browser-host', 'sessions', 'pdf-session', 'downloads', `${expectedSha256.slice(0, 12)}-paper.pdf`);
    assert.deepEqual(await readFile(artifactPath), pdfBytes);
  } finally {
    await closeServer(server);
    await rm(root, { recursive: true, force: true });
  }
});

test('browser primitive download resolves session linkSelector from the current frame artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-browser-primitive-download-selector-'));
  const pdfBytes = Buffer.from('%PDF-1.4\nselector download\n%%EOF\n', 'utf8');
  const server = await startBinaryServer(pdfBytes, 'application/pdf', '/files/selector-paper.pdf');
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const sessionId = 'selector-session';
    const sessionDir = join(root, '.sciforge', 'browser-host', 'sessions', sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'frame.html'), [
      '<!doctype html><title>Selector fixture</title>',
      '<a class="download-paper" href="/files/selector-paper.pdf">Download PDF</a>',
    ].join('\n'), 'utf8');
    const manager = {
      async sessionState(): Promise<BrowserHostSessionState> {
        return {
          schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
          id: sessionId,
          owner: 'host',
          providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
          status: 'ready',
          workspacePath: root,
          requestedUrl: `${baseUrl}/paper`,
          url: `${baseUrl}/paper`,
          title: 'Selector fixture',
          startedAt: '2026-06-08T00:00:00.000Z',
          updatedAt: '2026-06-08T00:00:00.000Z',
          viewport: { width: 1280, height: 720 },
          canGoBack: false,
          canGoForward: false,
          frameRef: `browser-host-session:${sessionId}/frame.html`,
          diagnostics: [],
        };
      },
    } as unknown as BrowserHostSessionManager;
    const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
      browser: createBrowserRuntimeModuleHandler({ workspacePath: root, manager }),
    }));

    const result = await dispatcher.invoke({
      moduleId: 'browser',
      intent: BROWSER_PRIMITIVE_INTENTS.download,
      input: {
        schemaVersion: 'sciforge.browser-runtime.download-input.v1',
        sessionId,
        linkSelector: 'a.download-paper',
        saveScope: 'session-artifacts',
        maxBytes: 1024,
      },
    });

    assert.equal(result.ok, true);
    const value = result.value as BrowserPrimitiveEnvelope<{
      artifactRef?: string;
      filename?: string;
      finalUrl?: string;
      byteLength?: number;
      sha256?: string;
    }>;
    const expectedSha256 = createHash('sha256').update(pdfBytes).digest('hex');
    assert.equal(value.status, 'completed');
    assert.equal(value.output?.filename, 'selector-paper.pdf');
    assert.equal(value.output?.byteLength, pdfBytes.byteLength);
    assert.equal(value.output?.sha256, expectedSha256);
    assert.equal(value.output?.finalUrl, `${baseUrl}/files/selector-paper.pdf`);
    assert.match(value.output?.artifactRef ?? '', /^browser-host-session:selector-session\/downloads\/[a-f0-9]{12}-selector-paper\.pdf$/);
    assert.deepEqual(
      await readFile(join(sessionDir, 'downloads', `${expectedSha256.slice(0, 12)}-selector-paper.pdf`)),
      pdfBytes,
    );
  } finally {
    await closeServer(server);
    await rm(root, { recursive: true, force: true });
  }
});

test('browser primitive download blocks session linkSelector when no matching link is present', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-browser-primitive-download-selector-missing-'));
  try {
    const sessionId = 'selector-missing-session';
    const sessionDir = join(root, '.sciforge', 'browser-host', 'sessions', sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'frame.html'), [
      '<!doctype html><title>Selector fixture</title>',
      '<a class="other-link" href="https://example.com/other.pdf">Other PDF</a>',
    ].join('\n'), 'utf8');
    const manager = {
      async sessionState(): Promise<BrowserHostSessionState> {
        return {
          schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
          id: sessionId,
          owner: 'host',
          providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
          status: 'ready',
          workspacePath: root,
          requestedUrl: 'https://example.com/page',
          url: 'https://example.com/page',
          title: 'Selector fixture',
          startedAt: '2026-06-08T00:00:00.000Z',
          updatedAt: '2026-06-08T00:00:00.000Z',
          viewport: { width: 1280, height: 720 },
          canGoBack: false,
          canGoForward: false,
          frameRef: `browser-host-session:${sessionId}/frame.html`,
          diagnostics: [],
        };
      },
    } as unknown as BrowserHostSessionManager;
    const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
      browser: createBrowserRuntimeModuleHandler({ workspacePath: root, manager }),
    }));

    const result = await dispatcher.invoke({
      moduleId: 'browser',
      intent: BROWSER_PRIMITIVE_INTENTS.download,
      input: {
        schemaVersion: 'sciforge.browser-runtime.download-input.v1',
        sessionId,
        linkSelector: 'a.download-paper',
        saveScope: 'session-artifacts',
      },
    });

    assert.equal(result.ok, false);
    const value = result.value as BrowserPrimitiveEnvelope;
    assert.equal(value.status, 'blocked');
    assert.equal(value.blockedReason, 'download_link_selector_not_found');
    assert.equal(existsSync(join(sessionDir, 'downloads')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function assertNoInlineDownloadPayloadFields(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, /^(?:bytes|base64|path|absolutePath|filePath|localPath)$/i);
    assertNoInlineDownloadPayloadFields(child);
  }
}

test('browser primitive download requires confirmation for executable or unknown MIME before writing artifacts', async () => {
  for (const entry of [
    { name: 'executable', body: 'MZ executable sentinel', contentType: 'application/x-msdownload', path: '/payload.exe' },
    { name: 'unknown', body: 'opaque binary sentinel', contentType: 'application/octet-stream', path: '/payload.bin' },
  ]) {
    const root = await mkdtemp(join(tmpdir(), `sciforge-browser-primitive-download-risk-${entry.name}-`));
    const server = await startTextServer(entry.body, entry.contentType);
    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const url = `http://127.0.0.1:${address.port}${entry.path}`;
      const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
        browser: createBrowserRuntimeModuleHandler({ workspacePath: root }),
      }));

      const result = await dispatcher.invoke({
        moduleId: 'browser',
        intent: BROWSER_PRIMITIVE_INTENTS.download,
        input: {
          schemaVersion: 'sciforge.browser-runtime.download-input.v1',
          url,
          sessionId: 'risk-session',
          saveScope: 'session-artifacts',
          maxBytes: 1024,
        },
      });

      assert.equal(result.ok, false, entry.name);
      const value = result.value as BrowserPrimitiveEnvelope;
      assert.equal(value.status, 'needs-confirmation', entry.name);
      assert.equal(value.output, undefined, entry.name);
      assert.deepEqual(value.refs, [], entry.name);
      assert.match(value.blockedReason ?? '', /download_(?:high_risk|unknown)_mime_requires_confirmation/, entry.name);
      assert.equal(existsSync(join(root, '.sciforge', 'browser-host', 'sessions', 'risk-session', 'downloads')), false, entry.name);
    } finally {
      await closeServer(server);
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('browser primitive download enforces allowed and blocked domain constraints before fetch', async () => {
  for (const entry of [
    { name: 'blocked domain', constraints: { blockedDomains: ['127.0.0.1'] }, reason: 'download_domain_blocked' },
    { name: 'not in allowed domains', constraints: { allowedDomains: ['example.com'] }, reason: 'download_domain_not_allowed' },
  ]) {
    const root = await mkdtemp(join(tmpdir(), `sciforge-browser-primitive-download-domain-${entry.name.replace(/\s+/g, '-')}-`));
    const server = await startCountingTextServer('id,name\n1,Ada\n', 'text/csv');
    try {
      const address = server.httpServer.address();
      assert.ok(address && typeof address === 'object');
      const url = `http://127.0.0.1:${address.port}/data.csv`;
      const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
        browser: createBrowserRuntimeModuleHandler({ workspacePath: root }),
      }));

      const result = await dispatcher.invoke({
        moduleId: 'browser',
        intent: BROWSER_PRIMITIVE_INTENTS.download,
        input: {
          schemaVersion: 'sciforge.browser-runtime.download-input.v1',
          url,
          saveScope: 'session-artifacts',
          constraints: entry.constraints,
        },
      });

      assert.equal(result.ok, false, entry.name);
      const value = result.value as BrowserPrimitiveEnvelope;
      assert.equal(value.status, 'blocked', entry.name);
      assert.equal(value.blockedReason, entry.reason, entry.name);
      assert.equal(server.requests.length, 0, entry.name);
    } finally {
      await closeServer(server.httpServer);
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('browser primitive download enforces domain constraints after redirects before writing artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-browser-primitive-download-redirect-domain-'));
  const server = await startRedirectTextServer('id,name\n1,Ada\n', 'text/csv');
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const url = `http://localhost:${address.port}/redirect`;
    const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
      browser: createBrowserRuntimeModuleHandler({ workspacePath: root }),
    }));

    const result = await dispatcher.invoke({
      moduleId: 'browser',
      intent: BROWSER_PRIMITIVE_INTENTS.download,
      input: {
        schemaVersion: 'sciforge.browser-runtime.download-input.v1',
        url,
        sessionId: 'redirect-domain-session',
        saveScope: 'session-artifacts',
        maxBytes: 1024,
        constraints: { blockedDomains: ['127.0.0.1'] },
      },
    });

    assert.equal(result.ok, false);
    const value = result.value as BrowserPrimitiveEnvelope;
    assert.equal(value.status, 'blocked');
    assert.equal(value.blockedReason, 'download_domain_blocked');
    assert.equal(existsSync(join(root, '.sciforge', 'browser-host', 'sessions', 'redirect-domain-session', 'downloads')), false);
  } finally {
    await closeServer(server);
    await rm(root, { recursive: true, force: true });
  }
});

test('computer_use bounded operation handler is no longer importable from runtime module handlers', () => {
  assert.equal('createComputerUseBoundedOperationModuleHandler' in boundedOperationHandlers, false);
  const source = readFileSync(new URL('./bounded-operation-module-handlers.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /createComputerUseBoundedOperationModuleHandler|computer_use\.perform_local_action|computer_use\.fill_fields/);
});

async function startTextServer(body: string, contentType: string): Promise<Server> {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': contentType,
      'content-length': Buffer.byteLength(body),
    });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function startBinaryServer(body: Buffer, contentType: string, path: string): Promise<Server> {
  const server = createServer((request, response) => {
    if ((request.url ?? '/') !== path) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      'content-type': contentType,
      'content-length': body.byteLength,
    });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function startCountingTextServer(body: string, contentType: string): Promise<{
  httpServer: Server;
  requests: string[];
}> {
  const requests: string[] = [];
  const httpServer = createServer((request, response) => {
    requests.push(request.url ?? '/');
    response.writeHead(200, {
      'content-type': contentType,
      'content-length': Buffer.byteLength(body),
    });
    response.end(body);
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  return { httpServer, requests };
}

async function startRedirectTextServer(body: string, contentType: string): Promise<Server> {
  const server = createServer((request, response) => {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    if ((request.url ?? '').startsWith('/redirect')) {
      response.writeHead(302, { location: `http://127.0.0.1:${address.port}/data.csv` });
      response.end();
      return;
    }
    response.writeHead(200, {
      'content-type': contentType,
      'content-length': Buffer.byteLength(body),
    });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
