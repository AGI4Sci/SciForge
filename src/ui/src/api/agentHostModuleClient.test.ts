import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agentHostModuleDispatcherCandidates,
  invokeAgentHostModule,
  queryAgentHostModule,
  readAgentHostModule,
} from './agentHostModuleClient';
import { SciForgeClientError } from './clientError';
import type { SciForgeConfig } from '../domain';

test('agent host module client prefers the configured Agent Host dispatcher over the workspace shim', async () => {
  const requests: Array<{ origin: string; path: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ origin: url.origin, path: url.pathname, body: JSON.parse(String(init?.body ?? '{}')) });
    return jsonResponse({
      ok: true,
      result: moduleEnvelope({ items: [], total: 0, ref: 'folder:workspace' }, ['folder:workspace']),
      trace: [{ id: 'module-step-1', moduleId: 'files', functionName: 'query', status: 'completed' }],
    });
  }) as typeof fetch;
  try {
    const result = await queryAgentHostModule({ moduleId: 'files', query: 'tree', filters: { path: 'src' } }, testConfig());

    assert.equal(result.result.ok, true);
    assert.deepEqual(requests.map((request) => `${request.origin}${request.path}`), [
      'http://127.0.0.1:5174/api/sciforge/modules/query',
    ]);
    assert.equal(requests[0]?.body.workspacePath, '/tmp/sciforge');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('agent host module client falls back to the local workspace runtime shim when the agent endpoint is not a dispatcher', async () => {
  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(`${url.origin}${url.pathname}`);
    if (url.origin === 'http://127.0.0.1:5174') {
      return new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    return jsonResponse({
      ok: true,
      result: moduleEnvelope({
        path: '/tmp/sciforge/src/app.ts',
        name: 'app.ts',
        content: 'export {};\n',
        size: 11,
        language: 'typescript',
        encoding: 'utf8',
        ref: 'file:src/app.ts',
      }, ['file:src/app.ts']),
      trace: [{ id: 'module-step-1', moduleId: 'files', functionName: 'read', status: 'completed' }],
    });
  }) as typeof fetch;
  try {
    const result = await readAgentHostModule({ moduleId: 'files', ref: 'file:src/app.ts' }, testConfig());

    assert.equal((result.result.value as { content?: string }).content, 'export {};\n');
    assert.deepEqual(requests, [
      'http://127.0.0.1:5174/api/sciforge/modules/read',
      'http://127.0.0.1:5175/api/sciforge/modules/read',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('agent host module client sends writes only through module.invoke', async () => {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ path: url.pathname, body: JSON.parse(String(init?.body ?? '{}')) });
    return jsonResponse({
      ok: true,
      result: moduleEnvelope({
        path: '/tmp/sciforge/src/app.ts',
        name: 'app.ts',
        content: 'saved\n',
        size: 6,
        language: 'typescript',
        encoding: 'utf8',
        ref: 'file:src/app.ts',
      }, ['file:src/app.ts'], 'files:operation:write:src%2Fapp.ts'),
      trace: [{ id: 'module-step-1', moduleId: 'files', functionName: 'invoke', status: 'completed' }],
    });
  }) as typeof fetch;
  try {
    await invokeAgentHostModule({
      moduleId: 'files',
      intent: 'write',
      approvalToken: 'approved',
      input: { ref: 'file:src/app.ts', content: 'saved\n' },
    }, testConfig());

    assert.equal(requests[0]?.path, '/api/sciforge/modules/invoke');
    assert.equal(requests[0]?.body.intent, 'write');
    assert.equal(requests[0]?.body.approvalToken, 'approved');
    assert.equal(requests.some((request) => request.path.startsWith('/api/sciforge/workspace/')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('agent host module dispatcher candidates are unique and ordered', () => {
  assert.deepEqual(agentHostModuleDispatcherCandidates({
    ...testConfig(),
    agentServerBaseUrl: 'http://127.0.0.1:5174/',
    workspaceWriterBaseUrl: 'http://127.0.0.1:5174',
  }), ['http://127.0.0.1:5174']);
});

test('agent host module client reports stale writer capabilities instead of raw module 404', async () => {
  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (url.pathname === '/health') {
      return jsonResponse({
        ok: true,
        service: 'sciforge-workspace-writer',
        capabilities: ['workspace-files'],
      });
    }
    return jsonResponse({ ok: false, error: 'not found' }, 404);
  }) as typeof fetch;
  try {
    await assert.rejects(
      queryAgentHostModule({ moduleId: 'files', query: 'tree', filters: { path: '' } }, {
        ...testConfig(),
        agentServerBaseUrl: 'http://127.0.0.1:6173',
        workspaceWriterBaseUrl: 'http://127.0.0.1:6173',
      }),
      (error: unknown) => {
        assert.equal(error instanceof SciForgeClientError, true);
        const clientError = error as SciForgeClientError;
        assert.equal(clientError.diagnosticRef, 'agent-host-module-missing-runtime-module-dispatcher');
        assert.match(clientError.message, /runtime-module-dispatcher/);
        assert.doesNotMatch(clientError.message, /HTTP 404|not found|\/api\/sciforge\/modules/);
        return true;
      },
    );
    assert.deepEqual(requests, ['/api/sciforge/modules/query', '/health']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function moduleEnvelope(value: unknown, refs: string[], operationRef?: string) {
  return {
    schemaVersion: 'sciforge.module-contract.v1',
    moduleId: 'files',
    ok: true,
    value,
    refs,
    operationRef,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function testConfig(): SciForgeConfig {
  return {
    schemaVersion: 1,
    agentServerBaseUrl: 'http://127.0.0.1:5174',
    workspaceWriterBaseUrl: 'http://127.0.0.1:5175',
    workspacePath: '/tmp/sciforge',
    agentBackend: 'codex',
    modelProvider: 'openai',
    modelBaseUrl: '',
    modelName: 'test-model',
    apiKey: '',
    requestTimeoutMs: 30000,
    maxContextWindowTokens: 128000,
    visionAllowSharedSystemInput: false,
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}
