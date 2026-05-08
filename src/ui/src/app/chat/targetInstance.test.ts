import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { PeerInstance, SciForgeConfig } from '../../domain';
import { buildTargetInstanceContextForPrompt, enabledPeerInstances, targetIssueLookupFailureMessage } from './targetInstance';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('target instance context', () => {
  it('uses enabled Settings peer instances only', () => {
    const peers = enabledPeerInstances({
      ...testConfig(),
      peerInstances: [
        peer('Repair B', true),
        peer('Disabled C', false),
        { ...peer('', true), workspaceWriterUrl: 'http://127.0.0.1:9002' },
      ],
    });

    assert.deepEqual(peers.map((item) => item.name), ['Repair B']);
  });

  it('loads a target issue bundle from the peer workspace writer for natural language feedback references', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url === 'http://127.0.0.1:6274/api/sciforge/feedback/issues/feedback-42?workspacePath=%2Ftmp%2Ftarget-b') {
        return jsonResponse({
          issue: {
            schemaVersion: 1,
            id: 'feedback-42',
            kind: 'feedback-comment',
            title: 'Fix chart legend',
            status: 'open',
            priority: 'high',
            tags: [],
            createdAt: '2026-05-07T00:00:00.000Z',
            updatedAt: '2026-05-07T00:01:00.000Z',
            workspacePath: '/tmp/target-b',
            comment: { id: 'feedback-42', comment: 'Legend is clipped.' },
            target: { selector: '.legend' },
            runtime: { page: 'workbench', url: 'http://target-b', scenarioId: 'omics-differential-exploration' },
            repairRuns: [],
            repairResults: [],
          },
        });
      }
      return jsonResponse({ ok: false }, 404);
    }) as typeof fetch;

    const context = await buildTargetInstanceContextForPrompt({
      config: testConfig(),
      peer: peer('Repair B', true),
      prompt: '修复 B 的反馈 #feedback-42',
    });

    assert.equal(context.mode, 'peer');
    assert.equal(context.peer?.workspaceWriterUrl, 'http://127.0.0.1:6274');
    assert.equal(context.issueLookup?.status, 'resolved');
    assert.equal(context.issueLookup?.matchedIssueId, 'feedback-42');
    assert.equal(context.issueLookup?.bundle?.workspacePath, '/tmp/target-b');
    assert.deepEqual(calls, ['http://127.0.0.1:6274/api/sciforge/feedback/issues/feedback-42?workspacePath=%2Ftmp%2Ftarget-b']);
  });

  it('returns an actionable target lookup failure instead of falling back to the current instance', async () => {
    let agentServerCalled = false;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/agent-server/')) agentServerCalled = true;
      return jsonResponse({ ok: false, error: 'feedback issue not found: feedback-missing' }, 404);
    }) as typeof fetch;

    const context = await buildTargetInstanceContextForPrompt({
      config: testConfig(),
      peer: peer('Repair B', true),
      prompt: '修复 B 的 feedback #feedback-missing',
    });
    const message = targetIssueLookupFailureMessage(context);

    assert.equal(context.issueLookup?.status, 'failed');
    assert.match(message ?? '', /未启动修复，避免误改当前实例/);
    assert.match(message ?? '', /workspaceWriterUrl、端口、instance manifest、workspacePath/);
    assert.equal(agentServerCalled, false);
  });
});

function peer(name: string, enabled: boolean): PeerInstance {
  return {
    name,
    appUrl: 'http://127.0.0.1:6273',
    workspaceWriterUrl: 'http://127.0.0.1:6274',
    workspacePath: '/tmp/target-b',
    role: 'repair',
    trustLevel: 'repair',
    enabled,
  };
}

function testConfig(): SciForgeConfig {
  return {
    schemaVersion: 1,
    agentServerBaseUrl: 'http://127.0.0.1:18080',
    workspaceWriterBaseUrl: 'http://127.0.0.1:5174',
    workspacePath: '/tmp/current',
    agentBackend: 'codex',
    modelProvider: 'native',
    modelBaseUrl: '',
    modelName: '',
    apiKey: '',
    requestTimeoutMs: 1000,
    maxContextWindowTokens: 200000,
    visionAllowSharedSystemInput: true,
    updatedAt: '2026-05-07T00:00:00.000Z',
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
