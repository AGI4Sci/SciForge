import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { SciForgeConfig } from '../domain';
import {
  cachedWorkspaceFileReadError,
  clearWorkspacePreviewReadCacheForTests,
  readPreviewDescriptor,
  readWorkspaceFile,
  writeWorkspaceFile,
} from './workspaceClient';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearWorkspacePreviewReadCacheForTests();
});

describe('workspace preview stale cache', () => {
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
