import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { AgentStreamEvent, PeerInstance, SciForgeConfig, SciForgeSession } from '../../domain';
import {
  recoverExistingArtifactFollowupAfterInterruption,
  runPreflightContextCompaction,
  runPromptOrchestrator,
  shouldBlockOnPreflightContextCompaction,
} from './runOrchestrator';

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

  it('does not block preflight context compaction when latency policy allows background compaction', async () => {
    let compactFetches = 0;
    globalThis.fetch = (async () => {
      compactFetches += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return jsonResponse({ data: { contextCompaction: { status: 'completed', source: 'agentserver' } } });
    }) as typeof fetch;
    const events: AgentStreamEvent[] = [
      event({
        type: 'conversation-policy',
        label: '策略',
        raw: {
          latencyPolicy: {
            schemaVersion: 'sciforge.conversation.latency-policy.v1',
            blockOnContextCompaction: false,
          },
        },
      }),
      event({
        type: 'contextWindowState',
        label: '上下文窗口',
        contextWindowState: {
          source: 'agentserver-estimate',
          usedTokens: 950,
          windowTokens: 1000,
          ratio: 0.95,
          status: 'near-limit',
          compactCapability: 'agentserver',
          autoCompactThreshold: 0.82,
        },
      }),
    ];
    const emitted: AgentStreamEvent[] = [];
    const started = Date.now();

    await runPreflightContextCompaction({
      baseSession: emptySession(),
      config: testConfig(),
      request: minimalAgentRequest(),
      streamEvents: events,
      signal: new AbortController().signal,
      onStreamEvent: (streamEvent) => emitted.push(streamEvent),
    });

    assert.equal(shouldBlockOnPreflightContextCompaction(events), false);
    assert.equal(compactFetches, 1);
    assert.ok(Date.now() - started < 25, 'preflight compaction should return before background compact fetch resolves');
    assert.match(emitted[0]?.detail ?? '', /非阻塞上下文压缩/);
  });

  it('recovers report-view follow-ups from existing artifacts after a system interruption', () => {
    const session = sessionWithReportArtifact();

    const response = recoverExistingArtifactFollowupAfterInterruption({
      prompt: '给我markdown格式的报告，我需要看',
      session,
      scenarioId: 'literature-evidence-review',
      scenarioPackageRef: { id: 'literature-evidence-review', version: '1', source: 'built-in' },
      skillPlanRef: 'skill-plan.test',
      uiPlanRef: 'ui-plan.test',
      references: [],
      interruptedMessage: '当前 backend 运行被系统或网络中断：SciForge project tool 已取消。',
    });

    assert.ok(response);
    assert.equal(response.run.status, 'completed');
    assert.match(response.message.content, /^# AgentServer Report/);
    assert.equal(response.artifacts[0]?.id, 'research-report');
    assert.equal(response.uiManifest[0]?.componentId, 'report-viewer');
    assert.equal(response.executionUnits[0]?.status, 'self-healed');
  });

  it('does not recover fresh retrieval prompts from stale report artifacts', () => {
    const response = recoverExistingArtifactFollowupAfterInterruption({
      prompt: '帮我重新检索过去一周 arxiv 上 AI Agent 相关论文',
      session: sessionWithReportArtifact(),
      scenarioId: 'literature-evidence-review',
      scenarioPackageRef: { id: 'literature-evidence-review', version: '1', source: 'built-in' },
      skillPlanRef: 'skill-plan.test',
      uiPlanRef: 'ui-plan.test',
      references: [],
      interruptedMessage: '当前 backend 运行被系统或网络中断：SciForge project tool 已取消。',
    });

    assert.equal(response, undefined);
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

function sessionWithReportArtifact(): SciForgeSession {
  return {
    ...emptySession(),
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      metadata: { title: 'AgentServer Report' },
      data: {
        markdown: '# AgentServer Report\n\nFound 50 AI Agent papers from the past week on arxiv.',
      },
    }],
    uiManifest: [{
      componentId: 'report-viewer',
      artifactRef: 'research-report',
      priority: 1,
    }],
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

function event(partial: Partial<AgentStreamEvent>): AgentStreamEvent {
  return {
    id: partial.id ?? `evt-${partial.type ?? 'test'}`,
    type: partial.type ?? 'event',
    label: partial.label ?? partial.type ?? 'event',
    createdAt: partial.createdAt ?? '2026-05-07T00:00:00.000Z',
    ...partial,
  };
}

function minimalAgentRequest(): Parameters<typeof runPreflightContextCompaction>[0]['request'] {
  return {
    sessionId: 'session-test',
    scenarioId: 'literature-evidence-review',
    agentName: 'Literature',
    agentDomain: 'literature',
    prompt: 'test',
    references: [],
    roleView: 'researcher',
    messages: [],
    artifacts: [],
    executionUnits: [],
    runs: [],
    config: testConfig(),
    availableComponentIds: [],
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1', source: 'built-in' },
    skillPlanRef: 'skill-plan.test',
    uiPlanRef: 'ui-plan.test',
  };
}
