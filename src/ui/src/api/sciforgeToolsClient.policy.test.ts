import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { latencyThresholdsFromPolicy } from '../latencyPolicy';
import { progressModelFromEvent } from '../processProgress';
import type { AgentStreamEvent, SciForgeConfig, SendAgentMessageInput } from '../domain';
import { sendSciForgeToolMessage } from './sciforgeToolsClient';

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

  await sendSciForgeToolMessage(messageInput({
    verificationPolicy: { required: false, mode: 'none', reason: 'explicit scenario policy' },
    humanApprovalPolicy: { required: true, mode: 'required-before-action' },
    unverifiedReason: 'explicitly allowed for draft handoff',
  }), {});

  assert.deepEqual(bodies[1]?.verificationPolicy, { required: false, mode: 'none', reason: 'explicit scenario policy' });
  assert.deepEqual(bodies[1]?.humanApprovalPolicy, { required: true, mode: 'required-before-action' });
  assert.equal(bodies[1]?.unverifiedReason, 'explicitly allowed for draft handoff');
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

function messageInput(scenarioOverride?: Partial<NonNullable<SendAgentMessageInput['scenarioOverride']>>): SendAgentMessageInput {
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
  };
}
