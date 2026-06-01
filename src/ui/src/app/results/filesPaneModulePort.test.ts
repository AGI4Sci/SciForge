import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SciForgeClientError } from '../../api/clientError';
import type { SciForgeConfig } from '../../domain';
import {
  createAgentHostFilesModulePort,
  createWorkspaceFilesModulePort,
  workspaceFilesModuleRefForPath,
  type AgentHostFilesModuleClient,
} from './filesPaneModulePort';

test('files pane module port expresses tree, read, and save as query/read/invoke traces', async () => {
  const calls: string[] = [];
  const client: AgentHostFilesModuleClient = {
    async listWorkspace(path) {
      calls.push(`query:${path}`);
      return [{ kind: 'file', name: 'app.ts', path: '/tmp/sciforge/src/app.ts', size: 11 }];
    },
    async readWorkspaceFile(path) {
      calls.push(`read:${path}`);
      return {
        path,
        name: 'app.ts',
        content: 'export {};\n',
        size: 11,
        language: 'typescript',
        encoding: 'utf8',
      };
    },
    async writeWorkspaceFile(path, content) {
      calls.push(`write:${path}:${content.length}`);
      return {
        path,
        name: 'app.ts',
        content,
        size: content.length,
        language: 'typescript',
        encoding: 'utf8',
      };
    },
  };
  const port = createAgentHostFilesModulePort(client);

  const tree = await port.queryTree('/tmp/sciforge/src', testConfig());
  const read = await port.readFile('/tmp/sciforge/src/app.ts', testConfig());
  const saved = await port.invokeSave('/tmp/sciforge/src/app.ts', 'export const ok = true;\n', testConfig());

  assert.equal(tree.ok, true);
  assert.equal(tree.trace.moduleId, 'files');
  assert.equal(tree.trace.functionName, 'query');
  assert.equal(tree.trace.query, 'tree');
  assert.deepEqual(tree.trace.refs, ['folder:src']);

  assert.equal(read.ok, true);
  assert.equal(read.trace.functionName, 'read');
  assert.equal(read.trace.ref, 'file:src/app.ts');

  assert.equal(saved.ok, true);
  assert.equal(saved.trace.functionName, 'invoke');
  assert.equal(saved.trace.intent, 'write');
  assert.match(saved.trace.operationRef ?? '', /^files:operation:write:src%2Fapp\.ts$/);
  assert.deepEqual(calls, [
    'query:/tmp/sciforge/src',
    'read:/tmp/sciforge/src/app.ts',
    'write:/tmp/sciforge/src/app.ts:24',
  ]);
});

test('files pane module port keeps trace refs workspace-relative and redacts failures', async () => {
  const port = createWorkspaceFilesModulePort({
    async listWorkspace() {
      throw new Error('cannot list /Users/alice/private token=abc123');
    },
    async readWorkspaceFile() {
      throw new Error('not used');
    },
    async writeWorkspaceFile() {
      throw new Error('not used');
    },
  });

  const result = await port.queryTree('/Users/alice/private', testConfig());

  assert.equal(result.ok, false);
  assert.equal(result.trace.ref, 'folder:workspace');
  assert.match(result.error ?? '', /\[redacted-local-path\]/);
  assert.match(result.error ?? '', /token=\[redacted-secret\]/);
  assert.doesNotMatch(JSON.stringify(result.trace), /\/Users\/alice|abc123/);
  assert.equal(workspaceFilesModuleRefForPath('/tmp/sciforge', testConfig(), 'folder'), 'workspace:.');
});

test('files pane module port presents module dispatcher readiness without raw diagnostic refs', async () => {
  const port = createWorkspaceFilesModulePort({
    async listWorkspace() {
      throw new SciForgeClientError({
        title: 'Workspace Writer 缺少 Agent Host module dispatcher',
        reason: '当前 Workspace Writer 已在线，但缺少 runtime-module-dispatcher 能力；这通常表示 writer 进程仍是旧版本或尚未重启。',
        recoverActions: ['重启 npm run workspace:server 后刷新'],
        diagnosticRef: 'agent-host-module-missing-runtime-module-dispatcher',
      });
    },
    async readWorkspaceFile() {
      throw new Error('not used');
    },
    async writeWorkspaceFile() {
      throw new Error('not used');
    },
  });

  const result = await port.queryTree('/tmp/sciforge', testConfig());
  const rendered = `${result.error ?? ''}\n${result.trace.resultSummary}`;

  assert.equal(result.ok, false);
  assert.match(rendered, /runtime-module-dispatcher/);
  assert.match(rendered, /workspace:server/);
  assert.doesNotMatch(rendered, /agent-host-module-missing-runtime-module-dispatcher|HTTP 404|\/api\/sciforge\/modules/);
});

test('files pane module port defaults to Agent Host files module dispatcher endpoints', async () => {
  const requests: Array<{ href: string; origin: string; path: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    requests.push({ href: url.href, origin: url.origin, path: url.pathname, body });
    const envelope = {
      schemaVersion: 'sciforge.module-contract.v1',
      moduleId: 'files',
      ok: true,
    };
    if (url.pathname.endsWith('/query')) {
      return jsonResponse({
        ok: true,
        result: {
          ...envelope,
          value: {
            items: [{ kind: 'file', name: 'app.ts', path: '/tmp/sciforge/src/app.ts', size: 11 }],
            total: 1,
            ref: 'folder:src',
          },
          refs: ['folder:src', 'file:src/app.ts'],
        },
        trace: [{ moduleId: 'files', functionName: 'query', status: 'completed' }],
      });
    }
    if (url.pathname.endsWith('/read')) {
      return jsonResponse({
        ok: true,
        result: {
          ...envelope,
          value: {
            path: '/tmp/sciforge/src/app.ts',
            name: 'app.ts',
            content: 'export {};\n',
            size: 11,
            language: 'typescript',
            encoding: 'utf8',
            ref: 'file:src/app.ts',
          },
          refs: ['file:src/app.ts'],
        },
        trace: [{ moduleId: 'files', functionName: 'read', status: 'completed' }],
      });
    }
    if (url.pathname.endsWith('/invoke')) {
      return jsonResponse({
        ok: true,
        result: {
          ...envelope,
          value: {
            path: '/tmp/sciforge/src/app.ts',
            name: 'app.ts',
            content: 'export const ok = true;\n',
            size: 24,
            language: 'typescript',
            encoding: 'utf8',
            ref: 'file:src/app.ts',
          },
          refs: ['file:src/app.ts'],
          operationRef: 'files:operation:write:src%2Fapp.ts',
        },
        trace: [{ moduleId: 'files', functionName: 'invoke', status: 'completed' }],
      });
    }
    return jsonResponse({ ok: false, error: 'unexpected route' }, 404);
  }) as typeof fetch;
  try {
    const port = createWorkspaceFilesModulePort();

    const tree = await port.queryTree('/tmp/sciforge/src', testConfig());
    const read = await port.readFile('/tmp/sciforge/src/app.ts', testConfig());
    const saved = await port.invokeSave('/tmp/sciforge/src/app.ts', 'export const ok = true;\n', testConfig());

    assert.equal(tree.ok, true);
    assert.equal(tree.value?.[0]?.path, '/tmp/sciforge/src/app.ts');
    assert.equal(read.value?.content, 'export {};\n');
    assert.equal(saved.value?.content, 'export const ok = true;\n');
    assert.deepEqual(requests.map((request) => request.path), [
      '/api/sciforge/modules/query',
      '/api/sciforge/modules/read',
      '/api/sciforge/modules/invoke',
    ]);
    assert.deepEqual([...new Set(requests.map((request) => request.origin))], ['http://127.0.0.1:5174']);
    assert.equal(requests.some((request) => request.path.startsWith('/api/sciforge/workspace/')), false);
    assert.equal(requests[0]?.body.moduleId, 'files');
    assert.deepEqual(requests[0]?.body.filters, { path: '/tmp/sciforge/src' });
    assert.equal(requests[1]?.body.ref, 'file:src/app.ts');
    assert.equal(requests[2]?.body.intent, 'write');
    assert.equal(requests[2]?.body.approvalToken, 'right-pane-files-explicit-save');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Files pane adapter does not call legacy workspace file routes directly', async () => {
  const sources = await Promise.all([
    readFile(new URL('./filesPaneHostAdapter.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./filesPaneFocus.ts', import.meta.url), 'utf8'),
  ]);
  const joined = sources.join('\n');

  assert.doesNotMatch(joined, /\b(?:listWorkspace|readWorkspaceFile|writeWorkspaceFile)\s*\(/);
  assert.doesNotMatch(joined, /\/api\/sciforge\/workspace\/(?:list|file|write)/);
  assert.match(joined, /\bfilesPort\.invokeSave\s*\(/);
});

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
