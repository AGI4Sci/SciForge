import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { AgentStreamEvent, PeerInstance, SciForgeConfig, SciForgeSession } from '../../domain';
import {
  TARGET_ISSUE_LOOKUP_FAILED_EVENT_TYPE,
  TARGET_ISSUE_READ_EVENT_TYPE,
  TARGET_REPAIR_MODIFYING_EVENT_TYPE,
  TARGET_REPAIR_TESTING_EVENT_TYPE,
  TARGET_REPAIR_WRITTEN_BACK_EVENT_TYPE,
  TARGET_WORKTREE_PREPARING_EVENT_TYPE,
} from '@sciforge-ui/runtime-contract';
import {
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
    assert.equal(events.some((event) => event.type === TARGET_ISSUE_LOOKUP_FAILED_EVENT_TYPE), true);
    assert.equal(events[0]?.label, '目标 issue');
  });

  it('emits target issue repair handoff events through runtime contract projection', async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('http://127.0.0.1:6274/api/sciforge/feedback/issues/feedback-1')) {
        return jsonResponse({
          issue: {
            id: 'feedback-1',
            title: 'Broken report renderer',
            status: 'open',
            priority: 'high',
            comment: 'Renderer fails on report artifacts.',
          },
        });
      }
      if (url === 'http://127.0.0.1:5174/api/sciforge/tools/run/stream') {
        return streamResponse([{
          result: {
            message: 'Repair completed.',
            executionUnits: [{ id: 'unit-1', status: 'done' }],
            artifacts: [],
          },
        }]);
      }
      return jsonResponse({ ok: false, error: `unexpected ${url}` }, 404);
    }) as typeof fetch;

    const events: AgentStreamEvent[] = [];
    const result = await runPromptOrchestrator(orchestratorInput({
      prompt: '修复 B 的 feedback #feedback-1',
      targetPeer: peer(),
      onStreamEvent: (event) => events.push(event),
    }));

    assert.equal(result.status, 'completed');
    assert.deepEqual(
      events
        .filter((event) => event.type.startsWith('target-'))
        .map((event) => event.type),
      [
        TARGET_ISSUE_READ_EVENT_TYPE,
        TARGET_WORKTREE_PREPARING_EVENT_TYPE,
        TARGET_REPAIR_MODIFYING_EVENT_TYPE,
        TARGET_REPAIR_TESTING_EVENT_TYPE,
        TARGET_REPAIR_WRITTEN_BACK_EVENT_TYPE,
      ],
    );
    assert.equal(events.find((event) => event.type === TARGET_ISSUE_READ_EVENT_TYPE)?.detail, '已从 Repair B 读取 issue bundle feedback-1。');
    assert.deepEqual(events.find((event) => event.type === TARGET_REPAIR_MODIFYING_EVENT_TYPE)?.raw, {
      targetInstance: {
        name: 'Repair B',
        appUrl: 'http://127.0.0.1:6273',
        workspaceWriterUrl: 'http://127.0.0.1:6274',
        workspacePath: '/tmp/target-b',
        role: 'repair',
        trustLevel: 'repair',
      },
      issueId: 'feedback-1',
      executionBoundary: 'repair-handoff-runner-target-worktree',
    });
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

  it('dispatches report artifact follow-ups to the backend instead of resolving them in the UI', async () => {
    const session = sessionWithReportArtifact();
    const prompt = '给我markdown格式的报告，我需要看';
    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return streamResponse([{
        result: {
          message: 'Backend rendered report follow-up.',
          executionUnits: [{
            id: 'unit-backend-followup',
            tool: 'capability.report.followup',
            params: '{}',
            status: 'done',
            hash: 'hash-backend-followup',
            artifacts: ['research-report'],
            outputArtifacts: ['research-report'],
          }],
          artifacts: [{
            id: 'research-report',
            type: 'research-report',
            schemaVersion: '1',
            data: { markdown: '# Backend Report' },
          }],
          uiManifest: [{
            componentId: 'report-viewer',
            artifactRef: 'research-report',
            priority: 1,
          }],
        },
      }]);
    }) as typeof fetch;

    const result = await runPromptOrchestrator(orchestratorInput({
      prompt,
      baseSession: session,
      activeSession: () => session,
    }));

    assert.equal(result.status, 'completed');
    assert.equal(requestBodies.length, 1);
    assert.equal(requestBodies[0].prompt, prompt);
    assert.equal((requestBodies[0].uiState as { rawUserPrompt?: string }).rawUserPrompt, prompt);
    assert.equal((requestBodies[0].uiState as { agentDispatchPolicy?: string }).agentDispatchPolicy, 'agentserver-decides');
    assert.equal((requestBodies[0].artifacts as Array<{ id?: string }>)[0]?.id, 'research-report');
    assert.equal(result.finalResponse.message.content, 'Backend rendered report follow-up.');
    assert.equal(result.finalResponse.executionUnits[0]?.tool, 'capability.report.followup');
    assert.notEqual(result.finalResponse.executionUnits[0]?.tool, 'sciforge.existing-artifact-followup');
  });

  it('dispatches non-report artifact follow-ups to the backend with session artifact context', async () => {
    const session = sessionWithGenericArtifact();
    const prompt = '继续解释刚才 artifact 的异常点，并给出下一步处理建议';
    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return streamResponse([{
        result: {
          message: 'Backend inspected artifact follow-up.',
          executionUnits: [{
            id: 'unit-artifact-followup',
            tool: 'capability.artifact.followup',
            params: '{}',
            status: 'done',
            hash: 'hash-artifact-followup',
            artifacts: ['volcano-plot'],
            outputArtifacts: ['volcano-plot'],
          }],
          artifacts: [{
            id: 'volcano-plot',
            type: 'figure',
            schemaVersion: '1',
            data: { points: [{ gene: 'TP53', logfc: 2.4, p: 0.001 }] },
          }],
          uiManifest: [{
            componentId: 'generic-artifact-inspector',
            artifactRef: 'volcano-plot',
            priority: 1,
          }],
        },
      }]);
    }) as typeof fetch;

    const result = await runPromptOrchestrator(orchestratorInput({
      prompt,
      baseSession: session,
      activeSession: () => session,
    }));

    assert.equal(result.status, 'completed');
    assert.equal(requestBodies.length, 1);
    assert.equal(requestBodies[0].prompt, prompt);
    assert.equal((requestBodies[0].uiState as { rawUserPrompt?: string }).rawUserPrompt, prompt);
    assert.equal((requestBodies[0].uiState as { agentDispatchPolicy?: string }).agentDispatchPolicy, 'agentserver-decides');
    assert.equal((requestBodies[0].artifacts as Array<{ id?: string; type?: string }>)[0]?.id, 'volcano-plot');
    assert.equal((requestBodies[0].artifacts as Array<{ id?: string; type?: string }>)[0]?.type, 'figure');
    assert.equal(result.finalResponse.message.content, 'Backend inspected artifact follow-up.');
    assert.equal(result.finalResponse.executionUnits[0]?.tool, 'capability.artifact.followup');
    assert.notEqual(result.finalResponse.executionUnits[0]?.tool, 'sciforge.existing-artifact-followup');
  });

  it('dispatches failed-run repair follow-ups to backend recovery policy instead of UI self-heal fallback', async () => {
    const session = sessionWithFailedRun();
    const prompt = '修复上一轮失败并继续';
    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return streamResponse([{
        result: {
          message: 'Backend repaired the failed run.',
          executionUnits: [{
            id: 'unit-failure-repair',
            tool: 'capability.failure.repair',
            params: '{}',
            status: 'done',
            hash: 'hash-failure-repair',
            recoverActions: ['reran schema-valid artifact generation'],
          }],
          artifacts: [{
            id: 'repaired-output',
            type: 'repair-summary',
            schemaVersion: '1',
            data: { status: 'repaired' },
          }],
        },
      }]);
    }) as typeof fetch;

    const result = await runPromptOrchestrator(orchestratorInput({
      prompt,
      baseSession: session,
      activeSession: () => session,
    }));

    const failureRecoveryPolicy = requestBodies[0]?.failureRecoveryPolicy as {
      mode?: string;
      priorFailureReason?: string;
      recoverActions?: string[];
      attemptHistory?: Array<{ id?: string; tool?: string; status?: string; failureReason?: string }>;
    };
    assert.equal(result.status, 'completed');
    assert.equal(requestBodies.length, 1);
    assert.equal(requestBodies[0].prompt, prompt);
    assert.equal((requestBodies[0].uiState as { rawUserPrompt?: string }).rawUserPrompt, prompt);
    assert.equal((requestBodies[0].uiState as { agentDispatchPolicy?: string }).agentDispatchPolicy, 'agentserver-decides');
    assert.equal(failureRecoveryPolicy.mode, 'preserve-context');
    assert.match(failureRecoveryPolicy.priorFailureReason ?? '', /schema validation failed/);
    assert.deepEqual(failureRecoveryPolicy.recoverActions, ['Regenerate the report artifact with schemaVersion=1.']);
    assert.equal(failureRecoveryPolicy.attemptHistory?.[0]?.tool, 'capability.report.generate');
    assert.deepEqual((requestBodies[0].uiState as { failureRecoveryPolicy?: unknown }).failureRecoveryPolicy, requestBodies[0].failureRecoveryPolicy);
    assert.equal(result.finalResponse.message.content, 'Backend repaired the failed run.');
    assert.equal(result.finalResponse.executionUnits[0]?.tool, 'capability.failure.repair');
    assert.equal(result.finalResponse.executionUnits.some((unit) => unit.status === 'self-healed'), false);
  });

  it('fails interrupted report follow-ups instead of synthesizing existing-artifact answers', async () => {
    const session = sessionWithReportArtifact();
    globalThis.fetch = (async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }) as typeof fetch;

    const result = await runPromptOrchestrator(orchestratorInput({
      prompt: '帮我重新检索过去一周 arxiv 上 AI Agent 相关论文',
      baseSession: session,
      activeSession: () => session,
    }));

    assert.equal(result.status, 'failed');
    assert.match(result.message, /当前 backend 运行被系统或网络中断/);
    assert.equal(result.failedSession.runs[0]?.status, 'failed');
    assert.doesNotMatch(result.failedSession.runs[0]?.response ?? '', /^# AgentServer Report/);
    assert.equal(result.failedSession.executionUnits.some((unit) => unit.status === 'self-healed'), false);
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

function sessionWithGenericArtifact(): SciForgeSession {
  return {
    ...emptySession(),
    artifacts: [{
      id: 'volcano-plot',
      type: 'figure',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      metadata: { title: 'Volcano plot' },
      data: {
        points: [
          { gene: 'TP53', logfc: 2.4, p: 0.001 },
          { gene: 'EGFR', logfc: -1.2, p: 0.04 },
        ],
      },
    }],
    uiManifest: [{
      componentId: 'generic-artifact-inspector',
      artifactRef: 'volcano-plot',
      priority: 1,
    }],
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

function sessionWithFailedRun(): SciForgeSession {
  return {
    ...emptySession(),
    messages: [{
      id: 'msg-failed-user',
      role: 'user',
      content: 'materialize report',
      createdAt: '2026-05-07T00:00:00.000Z',
      status: 'completed',
    }, {
      id: 'msg-failed-scenario',
      role: 'scenario',
      content: 'schema validation failed for research-report',
      createdAt: '2026-05-07T00:01:00.000Z',
      status: 'failed',
    }],
    runs: [{
      id: 'run-failed-report',
      scenarioId: 'literature-evidence-review',
      status: 'failed',
      prompt: 'materialize report',
      response: 'schema validation failed for research-report',
      createdAt: '2026-05-07T00:00:00.000Z',
      completedAt: '2026-05-07T00:01:00.000Z',
      raw: {
        streamProcess: {
          summary: 'artifact materialization failed; backend requested repair.',
        },
      },
    }],
    executionUnits: [{
      id: 'unit-failed-report',
      tool: 'capability.report.generate',
      params: '{}',
      status: 'failed-with-reason',
      hash: 'hash-failed-report',
      failureReason: 'schema validation failed for research-report',
      recoverActions: ['Regenerate the report artifact with schemaVersion=1.'],
      nextStep: 'Retry artifact materialization before presenting success.',
      outputRef: '.sciforge/task-results/run-failed-report.json',
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

function streamResponse(items: unknown[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const item of items) {
        controller.enqueue(encoder.encode(`${JSON.stringify(item)}\n`));
      }
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
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

function orchestratorInput(overrides: Partial<Parameters<typeof runPromptOrchestrator>[0]> = {}): Parameters<typeof runPromptOrchestrator>[0] {
  const baseSession = overrides.baseSession ?? emptySession();
  return {
    prompt: 'test',
    baseSession,
    references: [],
    scenarioId: 'literature-evidence-review',
    baseScenarioId: 'literature-evidence-review',
    scenarioName: 'Literature',
    scenarioDomain: 'literature',
    role: 'researcher',
    config: testConfig(),
    availableComponentIds: [],
    defaultComponentIds: [],
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1', source: 'built-in' },
    skillPlanRef: 'skill-plan.test',
    uiPlanRef: 'ui-plan.test',
    streamEvents: [],
    signal: new AbortController().signal,
    userAbortRequested: () => false,
    activeSession: () => baseSession,
    onStreamEvent: () => undefined,
    ...overrides,
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
