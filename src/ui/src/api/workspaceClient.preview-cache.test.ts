import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { SciForgeConfig } from '../domain';
import {
  cachedWorkspaceFileReadError,
  clearWorkspacePreviewReadCacheForTests,
  listWorkspace,
  loadPersistedWorkspaceState,
  readPreviewDescriptor,
  readPreviewDerivative,
  readWorkspaceFile,
  writeWorkspaceFile,
} from './workspaceClient';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearWorkspacePreviewReadCacheForTests();
});

describe('workspace preview stale cache', () => {
  const sensitiveHtml = [
    '<!doctype html><html><body>',
    'provider host https://api.provider.example/v1',
    'Bearer sk-html-secret-token-1234567890',
    'apiKey=rk_html_secret_token_1234567890',
    '/Applications/workspace/private-project/secret.html',
    '</body></html>',
  ].join(' ');
  const sensitiveJsonError = [
    'Unable to read /Users/alice/private-project/secret.md',
    'from https://api.provider.example/v1/chat',
    'api.provider.example',
    'Authorization: Bearer sk-json-secret-token-1234567890',
    'apiKey=pk_json_secret_token_1234567890',
    'token=rk-json-secret-token-1234567890',
  ].join(' ');

  it('reports HTML responses from a UI dev server as Workspace Writer URL mismatch without leaking the page body', async () => {
    globalThis.fetch = (async () => htmlResponse('<!doctype html><html><body>Vite app shell</body></html>')) as typeof fetch;

    await assert.rejects(
      () => listWorkspace('/Applications/workspace/private-project', testConfig()),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /Workspace Writer 响应不是 JSON/);
        assert.match(message, /SciForge UI 页面/);
        assert.doesNotMatch(message, /<!doctype|Vite app shell|Applications\/workspace/);
        return true;
      },
    );
  });

  it('reports non-JSON workspace snapshots without exposing raw HTML', async () => {
    globalThis.fetch = (async () => htmlResponse('<html><body>not the writer</body></html>')) as typeof fetch;

    await assert.rejects(
      () => loadPersistedWorkspaceState('/tmp/private-workspace', testConfig()),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /workspace-writer-html-response/);
        assert.doesNotMatch(message, /not the writer|\/tmp\/private-workspace/);
        return true;
      },
    );
  });

  it('redacts HTML 200 diagnostics for workspace file reads', async () => {
    globalThis.fetch = (async () => htmlResponse(sensitiveHtml)) as typeof fetch;

    await assert.rejects(
      () => readWorkspaceFile('/Applications/workspace/private-project/secret.html', sensitiveConfig()),
      assertRedactedWorkspaceDiagnostic,
    );
  });

  it('redacts HTML 200 diagnostics for preview descriptor reads', async () => {
    globalThis.fetch = (async () => htmlResponse(sensitiveHtml)) as typeof fetch;

    await assert.rejects(
      () => readPreviewDescriptor('/tmp/private-project/preview.html', sensitiveConfig()),
      assertRedactedWorkspaceDiagnostic,
    );
  });

  it('redacts HTML 200 diagnostics for preview derivative reads', async () => {
    globalThis.fetch = (async () => htmlResponse(sensitiveHtml)) as typeof fetch;

    await assert.rejects(
      () => readPreviewDerivative('/var/private-project/preview.html', 'thumb', sensitiveConfig()),
      assertRedactedWorkspaceDiagnostic,
    );
  });

  it('redacts JSON 4xx diagnostics for workspace file reads', async () => {
    globalThis.fetch = (async () => jsonResponse({ ok: false, error: sensitiveJsonError }, 400)) as typeof fetch;

    await assert.rejects(
      () => readWorkspaceFile('/Users/alice/private-project/secret.md', sensitiveConfig()),
      assertRedactedWorkspaceDiagnostic,
    );
  });

  it('redacts JSON 4xx diagnostics for preview descriptor reads', async () => {
    globalThis.fetch = (async () => jsonResponse({ ok: false, error: sensitiveJsonError }, 400)) as typeof fetch;

    await assert.rejects(
      () => readPreviewDescriptor('/Users/alice/private-project/preview.json', sensitiveConfig()),
      assertRedactedWorkspaceDiagnostic,
    );
  });

  it('redacts JSON 4xx diagnostics for preview derivative reads', async () => {
    globalThis.fetch = (async () => jsonResponse({ ok: false, error: sensitiveJsonError }, 400)) as typeof fetch;

    await assert.rejects(
      () => readPreviewDerivative('/Users/alice/private-project/preview.json', 'thumb', sensitiveConfig()),
      assertRedactedWorkspaceDiagnostic,
    );
  });

  it('dedupes repeated missing workspace file reads for the same ref', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return jsonResponse({ ok: false, error: 'ENOENT: missing artifact output' }, 400);
    }) as typeof fetch;

    const config = testConfig();
    await assert.rejects(() => readWorkspaceFile('.sciforge/missing/report.md', config), /missing artifact output/);
    assert.match(cachedWorkspaceFileReadError('.sciforge/missing/report.md', config)?.message ?? '', /missing artifact output/);

    await assert.rejects(() => readWorkspaceFile('.sciforge/missing/report.md', config), /missing artifact output/);

    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/api\/sciforge\/workspace\/file/);
  });

  it('dedupes repeated missing preview descriptor reads for the same ref', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return jsonResponse({ ok: false, error: 'stat failed for preview ref' }, 400);
    }) as typeof fetch;

    const config = testConfig();
    await assert.rejects(() => readPreviewDescriptor('.sciforge/missing/plot.png', config), /stat failed/);
    await assert.rejects(() => readPreviewDescriptor('.sciforge/missing/plot.png', config), /stat failed/);

    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/api\/sciforge\/preview\/descriptor/);
  });

  it('clears stale preview failures after a workspace write succeeds', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if ((init?.method ?? 'GET') === 'POST') {
        return jsonResponse({ file: workspaceFile('.sciforge/missing/report.md', 'repaired') });
      }
      if (calls.filter((call) => call.startsWith('GET ')).length === 1) {
        return jsonResponse({ ok: false, error: 'ENOENT: stale output' }, 400);
      }
      return jsonResponse({ file: workspaceFile('.sciforge/missing/report.md', 'repaired') });
    }) as typeof fetch;

    const config = testConfig();
    await assert.rejects(() => readWorkspaceFile('.sciforge/missing/report.md', config), /stale output/);
    await writeWorkspaceFile('.sciforge/missing/report.md', 'repaired', config);
    const file = await readWorkspaceFile('.sciforge/missing/report.md', config);

    assert.equal(file.content, 'repaired');
    assert.deepEqual(calls.map((call) => call.split(' ')[0]), ['GET', 'POST', 'GET']);
  });

  it('does not let an old in-flight miss repopulate the stale cache after a write', async () => {
    let resolveFirstRead: ((response: Response) => void) | undefined;
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if ((init?.method ?? 'GET') === 'POST') {
        return jsonResponse({ file: workspaceFile('.sciforge/missing/report.md', 'repaired') });
      }
      if (!resolveFirstRead) {
        return new Promise<Response>((resolve) => {
          resolveFirstRead = resolve;
        });
      }
      return jsonResponse({ file: workspaceFile('.sciforge/missing/report.md', 'repaired') });
    }) as typeof fetch;

    const config = testConfig();
    const firstRead = readWorkspaceFile('.sciforge/missing/report.md', config);
    await Promise.resolve();
    assert.equal(typeof resolveFirstRead, 'function');
    await writeWorkspaceFile('.sciforge/missing/report.md', 'repaired', config);
    resolveFirstRead?.(jsonResponse({ ok: false, error: 'ENOENT before repair' }, 400));
    await assert.rejects(() => firstRead, /before repair/);

    assert.equal(cachedWorkspaceFileReadError('.sciforge/missing/report.md', config), undefined);
    const file = await readWorkspaceFile('.sciforge/missing/report.md', config);

    assert.equal(file.content, 'repaired');
    assert.deepEqual(calls.map((call) => call.split(' ')[0]), ['GET', 'POST', 'GET']);
  });
});

function testConfig(): SciForgeConfig {
  return {
    schemaVersion: 1,
    agentServerBaseUrl: 'http://127.0.0.1:18080',
    workspaceWriterBaseUrl: 'http://127.0.0.1:5174',
    workspacePath: '/tmp/ws',
    agentBackend: 'codex',
    modelProvider: 'native',
    modelBaseUrl: '',
    modelName: '',
    apiKey: '',
    requestTimeoutMs: 1000,
    maxContextWindowTokens: 200000,
    visionAllowSharedSystemInput: true,
    updatedAt: '2026-05-12T00:00:00.000Z',
  };
}

function sensitiveConfig(): SciForgeConfig {
  return {
    ...testConfig(),
    workspaceWriterBaseUrl: 'https://api.provider.example/sciforge?apiKey=sk-config-secret-token-1234567890',
    workspacePath: '/Applications/workspace/private-project',
  };
}

function workspaceFile(path: string, content: string) {
  return {
    path,
    name: path.split('/').at(-1) ?? path,
    content,
    size: content.length,
    language: 'markdown',
    encoding: 'utf8',
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function assertRedactedWorkspaceDiagnostic(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  assert.match(message, /Workspace Writer/);
  assert.doesNotMatch(message, /<!doctype|<html|provider host/);
  assert.doesNotMatch(message, /api\.provider\.example|api\.provider\.example\/v1|Bearer sk|apiKey=.*secret|token=.*secret/);
  assert.doesNotMatch(message, /\b(?:sk|rk|pk)[-_][A-Za-z0-9_-]*secret/i);
  assert.doesNotMatch(message, /Applications\/workspace|Users\/alice|\/tmp\/private-project|\/var\/private-project/);
  return true;
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html' },
  });
}
