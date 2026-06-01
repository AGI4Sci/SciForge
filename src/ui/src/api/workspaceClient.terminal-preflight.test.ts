import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { SciForgeConfig } from '../domain';
import {
  WORKSPACE_TERMINAL_WEBSOCKET_PTY_CAPABILITY,
  preflightWorkspaceTerminalWriter,
} from './workspaceClient';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('workspace terminal writer preflight', () => {
  it('accepts a current Workspace Writer with the terminal PTY capability', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return jsonResponse(writerHealth([WORKSPACE_TERMINAL_WEBSOCKET_PTY_CAPABILITY]));
    }) as typeof fetch;

    const result = await preflightWorkspaceTerminalWriter(testConfig(), { timeoutMs: 1_000 });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'ready');
    assert.equal(result.effectiveBaseUrl, 'http://127.0.0.1:6173');
    assert.equal(result.configuredDisplayUrl, 'http://127.0.0.1:6173');
    assert.deepEqual(calls, ['http://127.0.0.1:6173/health']);
  });

  it('blocks UI HTML responses before terminal session start and recommends a ready default writer', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('http://127.0.0.1:5173/')) {
        return htmlResponse('<!doctype html><html><body>Vite app shell</body></html>');
      }
      return jsonResponse(writerHealth([WORKSPACE_TERMINAL_WEBSOCKET_PTY_CAPABILITY]));
    }) as typeof fetch;

    const result = await preflightWorkspaceTerminalWriter({
      ...testConfig(),
      workspaceWriterBaseUrl: 'http://127.0.0.1:5173',
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'ui-html');
    assert.equal(result.configuredDisplayUrl, 'http://127.0.0.1:5173');
    assert.equal(result.recommendedBaseUrl, 'http://127.0.0.1:5174');
    assert.equal(result.candidates[0]?.ok, true);
    assert.match(result.message, /ready Workspace Writer/);
    assert.deepEqual(calls, ['http://127.0.0.1:5173/health', 'http://127.0.0.1:5174/health']);
  });

  it('blocks stale Workspace Writers that lack the generic terminal capability', async () => {
    globalThis.fetch = (async () => jsonResponse(writerHealth(['workspace-files']))) as typeof fetch;

    const result = await preflightWorkspaceTerminalWriter(testConfig());

    assert.equal(result.ok, false);
    assert.equal(result.status, 'missing-terminal-capability');
    assert.match(result.message, /workspace-terminal-websocket-pty/);
  });

  it('redacts provider-like URLs and secrets in offline diagnostics', async () => {
    globalThis.fetch = (async () => {
      throw new Error('connect ECONNREFUSED /Applications/workspace/private-project token=sk-offline-secret-token-123456');
    }) as typeof fetch;

    const result = await preflightWorkspaceTerminalWriter({
      ...testConfig(),
      workspaceWriterBaseUrl: 'https://api.provider.example/sciforge?apiKey=sk-config-secret-token-1234567890',
    });
    const publicDiagnostic = [result.configuredDisplayUrl, result.message, result.candidates.map((candidate) => candidate.message).join('\n')].join('\n');

    assert.equal(result.ok, false);
    assert.equal(result.status, 'offline');
    assert.match(result.configuredDisplayUrl, /\[host\]/);
    assert.doesNotMatch(publicDiagnostic, /api\.provider\.example|sk-config-secret|sk-offline-secret|Applications\/workspace/);
  });
});

function testConfig(): SciForgeConfig {
  return {
    schemaVersion: 1,
    agentServerBaseUrl: 'http://127.0.0.1:18080',
    workspaceWriterBaseUrl: 'http://127.0.0.1:6173',
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

function writerHealth(capabilities: string[]) {
  return {
    ok: true,
    service: 'sciforge-workspace-writer',
    schemaVersion: 1,
    capabilities,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html' },
  });
}
