import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { AgentStreamEvent, PeerInstance, SciForgeConfig, SciForgeSession } from '../../domain';
import { runPromptOrchestrator } from './runOrchestrator';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('runPromptOrchestrator target instance guard', () => {
  it('does not dispatch AgentServer or repair current instance when target issue bundle lookup fails', async () => {
    const fetched: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      fetched.push(url);
      return jsonResponse({ ok: false, error: 'feedback issue not found: feedback-missing' }, 404);
    }) as typeof fetch;

    const events: AgentStreamEvent[] = [];
    const result = await runPromptOrchestrator({
      prompt: '修复 B 的 feedback #feedback-missing',
      baseSession: emptySession(),
      references: [],
      scenarioId: 'literature-evidence-review',
      baseScenarioId: 'literature-evidence-review',
      scenarioName: 'Literature',
      scenarioDomain: 'literature',
      role: 'researcher',
      config: testConfig(),
      targetPeer: peer(),
      availableComponentIds: [],
      defaultComponentIds: [],
      scenarioPackageRef: { id: 'literature-evidence-review', version: '1', source: 'built-in' },
      skillPlanRef: 'skill-plan.test',
      uiPlanRef: 'ui-plan.test',
      streamEvents: [],
      signal: new AbortController().signal,
      userAbortRequested: () => false,
      activeSession: emptySession,
      onStreamEvent: (event) => events.push(event),
    });

    assert.equal(result.status, 'failed');
    assert.match(result.message, /未启动修复，避免误改当前实例/);
    assert.deepEqual(fetched, ['http://127.0.0.1:6274/api/sciforge/feedback/issues/feedback-missing?workspacePath=%2Ftmp%2Ftarget-b']);
    assert.equal(events.some((event) => event.type === 'target-issue-lookup-failed'), true);
  });
});

function emptySession(): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-test',
    scenarioId: 'literature-evidence-review',
    title: 'Test',
    createdAt: '2026-05-07T00:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-05-07T00:00:00.000Z',
  };
}

function peer(): PeerInstance {
  return {
    name: 'Repair B',
    appUrl: 'http://127.0.0.1:6273',
    workspaceWriterUrl: 'http://127.0.0.1:6274',
    workspacePath: '/tmp/target-b',
    role: 'repair',
    trustLevel: 'repair',
    enabled: true,
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
