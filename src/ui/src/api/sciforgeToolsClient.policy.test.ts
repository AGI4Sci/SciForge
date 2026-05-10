import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { latencyThresholdsFromPolicy } from '../latencyPolicy';
import { progressModelFromEvent } from '../processProgress';
import type { AgentStreamEvent, SciForgeConfig, SendAgentMessageInput } from '../domain';
import { sendSciForgeToolMessage } from './sciforgeToolsClient';
import {
  HUMAN_APPROVAL_REQUIRED_EVENT_TYPE,
  INTERACTION_PROGRESS_EVENT_SCHEMA_VERSION,
  PROJECT_TOOL_DONE_EVENT_TYPE,
  PROJECT_TOOL_STARTED_EVENT_TYPE,
} from '@sciforge-ui/runtime-contract';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('silent wait and retry thresholds come from latencyPolicy with safe fallback', () => {
  const thresholds = latencyThresholdsFromPolicy({
    firstEventWarningMs: 8_000,
    silentRetryMs: 12_000,
    requestTimeoutMs: 90_000,
  }, { requestTimeoutMs: 60_000 } as SciForgeConfig);

  assert.equal(thresholds.firstEventWarningMs, 8_000);
  assert.equal(thresholds.silentRetryMs, 12_000);
  assert.equal(thresholds.requestTimeoutMs, 90_000);

  const fallback = latencyThresholdsFromPolicy({}, { requestTimeoutMs: 60_000 } as SciForgeConfig);
  assert.equal(fallback.firstEventWarningMs, 20_000);
  assert.equal(fallback.silentRetryMs, 45_000);
  assert.equal(fallback.requestTimeoutMs, 60_000);
});

test('conversation policy stream event makes quick status visible before workspace result', async () => {
  globalThis.fetch = (async () => streamResponse([
    {
      event: {
        type: 'conversation-policy',
        source: 'workspace-runtime',
        message: 'Python conversation policy applied.',
        latencyPolicy: {
          schemaVersion: 'sciforge.conversation.latency-policy.v1',
          firstEventWarningMs: 7_000,
          silentRetryMs: 13_000,
          requestTimeoutMs: 60_000,
        },
        responsePlan: {
          schemaVersion: 'sciforge.conversation.response-plan.v1',
          initialResponseMode: 'quick-status',
          userVisibleProgress: ['plan', 'run', 'emit'],
        },
      },
    },
    {
      result: {
        message: 'Workspace result ready.',
        executionUnits: [{ id: 'unit-1', status: 'done' }],
        artifacts: [{ id: 'artifact-1', type: 'research-report', data: { markdown: 'Workspace result ready.' } }],
      },
    },
  ])) as typeof fetch;

  const events: AgentStreamEvent[] = [];
  const response = await sendSciForgeToolMessage(messageInput(), {
    onEvent: (event) => events.push(event),
  });

  assert.equal(response.message.status, 'completed');
  const quick = events.find((event) => {
    const model = progressModelFromEvent(event);
    return model?.reason === 'initial-response-quick-status';
  });
  assert.ok(quick, 'quick status process-progress event should be visible before final result normalization');
  assert.ok(events.find((event) => event.type === 'conversation-policy'));
});

test('project tool runtime events are projected from contract helpers', async () => {
  globalThis.fetch = (async () => streamResponse([
    {
      result: {
        message: 'Workspace result needs repair.',
        executionUnits: [{ id: 'unit-1', status: 'repair-needed', failureReason: 'missing expected artifact' }],
        artifacts: [],
      },
    },
  ])) as typeof fetch;

  const events: AgentStreamEvent[] = [];
  await sendSciForgeToolMessage(messageInput(), {
    onEvent: (event) => events.push(event),
  });

  const started = events.find((event) => event.type === PROJECT_TOOL_STARTED_EVENT_TYPE);
  const done = events.find((event) => event.type === PROJECT_TOOL_DONE_EVENT_TYPE);
  assert.equal(started?.label, '项目工具');
  assert.equal(started?.detail, 'SciForge literature-evidence-review project tool started');
  assert.deepEqual(started?.raw, {
    type: PROJECT_TOOL_STARTED_EVENT_TYPE,
    detail: 'SciForge literature-evidence-review project tool started',
  });
  assert.equal(done?.label, '项目工具');
  assert.match(done?.detail ?? '', /未完成：missing expected artifact/);
  assert.equal((done?.raw as { type?: string } | undefined)?.type, PROJECT_TOOL_DONE_EVENT_TYPE);
});

test('structured interaction progress events survive transport normalization into process progress', async () => {
  globalThis.fetch = (async () => streamResponse([
    {
      event: {
        schemaVersion: INTERACTION_PROGRESS_EVENT_SCHEMA_VERSION,
        type: HUMAN_APPROVAL_REQUIRED_EVENT_TYPE,
        phase: 'verification',
        status: 'blocked',
        importance: 'blocking',
        reason: 'side-effect-policy',
        interaction: {
          id: 'approval-1',
          kind: 'human-approval',
          required: true,
        },
        prompt: 'PROMPT_TEXT_SHOULD_NOT_DECIDE',
        scenario: 'SCENARIO_TEXT_SHOULD_NOT_DECIDE',
        message: 'NATURAL_LANGUAGE_FALLBACK_SHOULD_NOT_DECIDE',
      },
    },
    {
      result: {
        message: 'Workspace result ready.',
        executionUnits: [{ id: 'unit-1', status: 'done' }],
        artifacts: [],
      },
    },
  ])) as typeof fetch;

  const events: AgentStreamEvent[] = [];
  await sendSciForgeToolMessage(messageInput(), {
    onEvent: (event) => events.push(event),
  });

  const interaction = events.find((event) => event.type === HUMAN_APPROVAL_REQUIRED_EVENT_TYPE);
  const model = interaction ? progressModelFromEvent(interaction) : undefined;
  assert.equal(interaction?.label, '需要确认');
  assert.doesNotMatch(interaction?.detail ?? '', /PROMPT_TEXT_SHOULD_NOT_DECIDE|SCENARIO_TEXT_SHOULD_NOT_DECIDE|NATURAL_LANGUAGE_FALLBACK_SHOULD_NOT_DECIDE/);
  assert.equal(model?.waitingFor, '人工确认');
  assert.match(model?.detail ?? '', /Reason: side-effect-policy/);
});

test('UI handoff does not synthesize verification or human approval policy defaults', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return streamResponse([
      {
        result: {
          message: 'Workspace result ready.',
          executionUnits: [{ id: 'unit-1', status: 'done' }],
          artifacts: [],
        },
      },
    ]);
  }) as typeof fetch;

  await sendSciForgeToolMessage(messageInput(), {});
  assert.equal(bodies[0]?.verificationPolicy, undefined);
  assert.equal(bodies[0]?.humanApprovalPolicy, undefined);
  assert.equal(bodies[0]?.unverifiedReason, undefined);
  assert.match(String((bodies[0]?.uiState as { silentStreamRunId?: string } | undefined)?.silentStreamRunId), /^session-test:turn-/);

  await sendSciForgeToolMessage(messageInput({
    verificationPolicy: { required: false, mode: 'none', reason: 'explicit scenario policy' },
    humanApprovalPolicy: { required: true, mode: 'required-before-action' },
    unverifiedReason: 'explicitly allowed for draft handoff',
  }), {});

  assert.deepEqual(bodies[1]?.verificationPolicy, { required: false, mode: 'none', reason: 'explicit scenario policy' });
  assert.deepEqual(bodies[1]?.humanApprovalPolicy, { required: true, mode: 'required-before-action' });
  assert.equal(bodies[1]?.unverifiedReason, 'explicitly allowed for draft handoff');
});

test('UI handoff compacts large multi-turn session context before transport', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return streamResponse([
      {
        result: {
          message: 'Workspace result ready.',
          executionUnits: [{ id: 'unit-1', status: 'done' }],
          artifacts: [],
        },
      },
    ]);
  }) as typeof fetch;

  await sendSciForgeToolMessage(messageInput(undefined, {
    messages: Array.from({ length: 20 }, (_, index) => ({
      id: `msg-${index}`,
      role: index % 2 ? 'scenario' : 'user',
      content: `message ${index} ${'x'.repeat(4_000)}`,
      createdAt: `2026-05-07T00:${String(index).padStart(2, '0')}:00.000Z`,
      status: 'completed',
    })),
    artifacts: Array.from({ length: 20 }, (_, index) => ({
      id: `artifact-${index}`,
      type: 'table',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      path: `/tmp/artifact-${index}.json`,
      data: { rows: Array.from({ length: 120 }, () => ({ value: 'large inline value' })) },
    })),
    executionUnits: Array.from({ length: 20 }, (_, index) => ({
      id: `unit-${index}`,
      tool: 'shell',
      params: 'p'.repeat(4_000),
      status: 'done',
      hash: `hash-${index}`,
      failureReason: 'f'.repeat(3_000),
    })),
    runs: Array.from({ length: 12 }, (_, index) => ({
      id: `run-${index}`,
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'prompt '.repeat(800),
      response: 'response '.repeat(800),
      createdAt: `2026-05-07T02:${String(index).padStart(2, '0')}:00.000Z`,
      raw: {
        streamProcess: {
          eventCount: 50,
          summary: 'wait '.repeat(800),
          events: Array.from({ length: 50 }, (_, eventIndex) => ({ label: `event-${eventIndex}` })),
        },
      },
    })),
  }), {});

  const uiState = bodies[0]?.uiState as {
    sessionMessages?: Array<{ content: string }>;
    recentRuns?: Array<{ raw?: unknown; response: string }>;
    recentExecutionRefs?: Array<{ params: string; failureReason?: string }>;
  };
  assert.equal(uiState.sessionMessages?.length, 12);
  assert.ok((uiState.sessionMessages?.[0]?.content.length ?? 0) < 1_900);
  assert.equal(uiState.recentRuns?.length, 8);
  assert.doesNotMatch(JSON.stringify(uiState.recentRuns?.[0]?.raw), /event-49/);
  assert.equal(uiState.recentExecutionRefs?.length, 16);
  assert.ok((uiState.recentExecutionRefs?.[0]?.params.length ?? 0) < 1_200);
  assert.ok((JSON.stringify(bodies[0]).length), 'body should be serializable after compaction');
});

test('pre-aborted signal cancels the workspace stream request controller', async () => {
  let requestSignal: AbortSignal | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestSignal = init?.signal as AbortSignal | undefined;
    if (requestSignal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    return streamResponse([
      {
        result: {
          message: 'Workspace result ready.',
          executionUnits: [{ id: 'unit-1', status: 'done' }],
          artifacts: [],
        },
      },
    ]);
  }) as typeof fetch;

  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    sendSciForgeToolMessage(messageInput(), {}, controller.signal),
    /已取消|aborted|AbortError/i,
  );
  assert.equal(requestSignal?.aborted, true);
});

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

function messageInput(
  scenarioOverride?: Partial<NonNullable<SendAgentMessageInput['scenarioOverride']>>,
  overrides: Partial<SendAgentMessageInput> = {},
): SendAgentMessageInput {
  return {
    sessionId: 'session-test',
    scenarioId: 'literature-evidence-review',
    agentName: 'Literature',
    agentDomain: 'literature',
    prompt: 'Summarize current context',
    references: [],
    roleView: 'researcher',
    messages: [],
    artifacts: [],
    executionUnits: [],
    runs: [],
    config: {
      schemaVersion: 1,
      agentServerBaseUrl: 'http://127.0.0.1:18080',
      workspaceWriterBaseUrl: 'http://127.0.0.1:5174',
      workspacePath: '/tmp/current',
      agentBackend: 'codex',
      modelProvider: 'native',
      modelBaseUrl: '',
      modelName: '',
      apiKey: '',
      requestTimeoutMs: 60_000,
      maxContextWindowTokens: 200000,
      visionAllowSharedSystemInput: true,
      updatedAt: '2026-05-07T00:00:00.000Z',
    },
    availableComponentIds: [],
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1', source: 'built-in' },
    skillPlanRef: 'skill-plan.test',
    uiPlanRef: 'ui-plan.test',
    scenarioOverride: scenarioOverride ? {
      title: 'Test scenario',
      description: 'Test scenario override',
      skillDomain: 'literature',
      scenarioMarkdown: '# Test',
      defaultComponents: [],
      allowedComponents: [],
      fallbackComponent: '',
      ...scenarioOverride,
    } : undefined,
    ...overrides,
  };
}
