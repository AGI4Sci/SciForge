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
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
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
  assert.equal(fallback.stallBoundMs, 120_000);
  assert.equal(fallback.requestTimeoutMs, 60_000);

  const capped = latencyThresholdsFromPolicy({
    stallBoundMs: 900_000,
  }, { requestTimeoutMs: 60_000 } as SciForgeConfig);
  assert.equal(capped.stallBoundMs, 120_000);
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

test('compact interaction progress events use runtime contract before process progress', async () => {
  globalThis.fetch = (async () => streamResponse([
    {
      event: {
        type: HUMAN_APPROVAL_REQUIRED_EVENT_TYPE,
        label: '需要确认',
        detail: [
          'Phase: verification',
          'Status: blocked',
          'Reason: side-effect-policy',
          'Interaction: human-approval required',
        ].join('\n'),
        prompt: 'PROMPT_TEXT_SHOULD_NOT_DECIDE',
        scenario: 'SCENARIO_TEXT_SHOULD_NOT_DECIDE',
        message: 'NATURAL_LANGUAGE_FALLBACK_SHOULD_NOT_DECIDE search write failed approval',
      },
    },
    {
      event: {
        type: HUMAN_APPROVAL_REQUIRED_EVENT_TYPE,
        label: 'needs approval',
        prompt: 'Phase: verification\nStatus: blocked\nInteraction: human-approval required',
        scenario: 'Phase: interaction\nStatus: blocked\nInteraction: clarification required',
        message: 'Phase: verification\nStatus: blocked\nInteraction: human-approval required',
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

  const compact = events.find((event) => event.label === '需要确认');
  const poison = events.find((event) => (event.raw as { message?: string } | undefined)?.message === 'Phase: verification\nStatus: blocked\nInteraction: human-approval required');
  const model = compact ? progressModelFromEvent(compact) : undefined;

  assert.equal(compact?.type, HUMAN_APPROVAL_REQUIRED_EVENT_TYPE);
  assert.equal(compact?.label, '需要确认');
  assert.doesNotMatch(compact?.detail ?? '', /PROMPT_TEXT_SHOULD_NOT_DECIDE|SCENARIO_TEXT_SHOULD_NOT_DECIDE|NATURAL_LANGUAGE_FALLBACK_SHOULD_NOT_DECIDE/);
  assert.equal(model?.waitingFor, '人工确认');
  assert.match(model?.detail ?? '', /Interaction: human-approval required/);
  assert.ok(poison, 'poison compact event should still be transported for raw inspection');
  assert.equal(progressModelFromEvent(poison), undefined);
});

test('UI handoff does not synthesize verification policy defaults or pass through legacy scenario policy', async () => {
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
  assert.equal((bodies[0]?.uiState as { currentTurnId?: string } | undefined)?.currentTurnId, undefined);
  assert.equal((bodies[0]?.uiState as { contextReusePolicy?: { mode?: string; historyReuse?: { allowed?: boolean } } } | undefined)?.contextReusePolicy?.mode, undefined);
  assert.equal((bodies[0]?.uiState as { contextReusePolicy?: { mode?: string; historyReuse?: { allowed?: boolean } } } | undefined)?.contextReusePolicy?.historyReuse?.allowed, false);

  await sendSciForgeToolMessage(messageInput({
    verificationPolicy: { required: false, mode: 'none', reason: 'explicit scenario policy' },
    humanApprovalPolicy: { required: true, mode: 'required-before-action' },
    unverifiedReason: 'explicitly allowed for draft handoff',
  }), {});

  const legacyUiState = bodies[1]?.uiState as {
    scenarioOverride?: Record<string, unknown>;
  } | undefined;
  assert.equal(bodies[1]?.verificationPolicy, undefined);
  assert.equal(legacyUiState?.scenarioOverride?.verificationPolicy, undefined);
  assert.deepEqual(bodies[1]?.humanApprovalPolicy, { required: true, mode: 'required-before-action' });
  assert.equal(bodies[1]?.unverifiedReason, 'explicitly allowed for draft handoff');
});

test('UI handoff forwards current turn id so policy can exclude optimistic user message', async () => {
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
    currentTurnId: 'msg-current',
    messages: [{
      id: 'msg-current',
      role: 'user',
      content: 'Fresh current turn',
      createdAt: '2026-05-07T00:00:00.000Z',
      status: 'completed',
    }],
  }), {});

  const uiState = bodies[0]?.uiState as { currentTurnId?: string; sessionMessages?: Array<{ id?: string }> } | undefined;
  assert.equal(uiState?.currentTurnId, 'msg-current');
  assert.equal(uiState?.sessionMessages?.[0]?.id, 'msg-current');
});

test('UI handoff filters agentserver selected skill overrides when current turn forbids AgentServer', async () => {
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

  await sendSciForgeToolMessage(messageInput({
    selectedSkillIds: [
      'agentserver.generate.literature',
      'AgentServer.experimental.override',
      'scp.biomedical-web-search',
      'local.pdf-extract',
    ],
    turnExecutionConstraints: directContextTurnExecutionConstraints(),
  }, {
    prompt: 'Summarize the current refs.',
    references: [{ id: 'ref-1', kind: 'file', title: 'Existing evidence', ref: 'file:.sciforge/refs/ref-1.json' }],
  }), {});

  assert.deepEqual(bodies[0]?.selectedSkillIds, ['scp.biomedical-web-search', 'local.pdf-extract']);
  assert.equal('availableSkills' in (bodies[0] ?? {}), false);
  assert.equal(
    ((bodies[0]?.uiState as { turnExecutionConstraints?: { agentServerForbidden?: boolean } } | undefined)
      ?.turnExecutionConstraints?.agentServerForbidden),
    true,
  );
  assert.deepEqual(bodies[0]?.selectedToolIds, []);
});

test('UI handoff preserves bounded text-selection payload for explicit composer references', async () => {
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
    prompt: 'Continue from ※1',
    references: [{
      id: 'ref-text-1',
      kind: 'ui',
      title: '选中文本 · inspect the UMAP',
      ref: 'ui-text:message#abc',
      summary: 'inspect the UMAP',
      payload: {
        composerMarker: '※1',
        selectedText: 'inspect the UMAP',
        sourceTitle: 'Browser smoke reference seed message',
        sourceRef: 'message:seed',
        sourceKind: 'message',
        sourceSummary: 'Seed message preview',
        textPreview: 'x'.repeat(10_000),
      },
    }],
  }), {});

  const reference = (bodies[0]?.references as Array<Record<string, unknown>>)[0];
  assert.deepEqual(reference.payload, {
    composerMarker: '※1',
    selectedText: 'inspect the UMAP',
    sourceTitle: 'Browser smoke reference seed message',
    sourceRef: 'message:seed',
    sourceKind: 'message',
    sourceSummary: 'Seed message preview',
  });
  assert.ok(reference.payloadDigest, 'large raw payload should still be summarized by digest');
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

test('UI handoff keeps ref-backed artifact bodies and log refs bounded on continuation', async () => {
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
    prompt: '继续导出审计摘要，只列出 stdout/stderr refs 和 artifact refs，不重跑。',
    artifacts: [{
      id: 'report-md',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      dataRef: '.sciforge/sessions/run/artifacts/report.json',
      data: { markdown: `# Report\n\n${'inline evidence should not travel again '.repeat(1200)}` },
    }],
    executionUnits: [{
      id: 'EU-report',
      tool: 'report.audit',
      status: 'done',
      hash: 'hash-report',
      stdoutRef: '.sciforge/sessions/run/logs/report.stdout.log',
      stderrRef: '.sciforge/sessions/run/logs/report.stderr.log',
      outputRef: '.sciforge/sessions/run/task-results/report.json',
      params: 'prior report',
    }],
  }), {});

  const artifact = (bodies[0]?.artifacts as Array<Record<string, unknown>> | undefined)?.[0];
  assert.equal(artifact?.data, undefined);
  assert.equal((artifact?.dataSummary as Record<string, unknown> | undefined)?.omitted, 'ref-backed-artifact-data');
  assert.match(String(((artifact?.dataSummary as Record<string, unknown> | undefined)?.digestText as Record<string, unknown> | undefined)?.preview), /inline evidence should not travel again/);
  assert.doesNotMatch(JSON.stringify(bodies[0]), /inline evidence should not travel again inline evidence should not travel again/);
  const uiState = bodies[0]?.uiState as { recentExecutionRefs?: Array<Record<string, unknown>> } | undefined;
  assert.equal(uiState?.recentExecutionRefs?.[0]?.stdoutRef, '.sciforge/sessions/run/logs/report.stdout.log');
  assert.equal((uiState as { contextReusePolicy?: { mode?: string; historyReuse?: { allowed?: boolean } } } | undefined)?.contextReusePolicy?.mode, undefined);
  assert.equal((uiState as { contextReusePolicy?: { mode?: string; historyReuse?: { allowed?: boolean } } } | undefined)?.contextReusePolicy?.historyReuse?.allowed, true);
  const referencePolicy = bodies[0]?.referencePolicy as { defaultAction?: string } | undefined;
  assert.match(referencePolicy?.defaultAction ?? '', /stdoutRef\/stderrRef as audit refs/);
});

test('UI transport does not publish mode from prompt keywords alone', async () => {
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
    prompt: 'please repair retry and recover the previous answer wording only',
    messages: [{ id: 'msg-prior', role: 'scenario', content: 'Prior answer', createdAt: '2026-05-16T00:00:00.000Z' }],
    runs: [{ id: 'run-prior', scenarioId: 'literature-evidence-review', status: 'completed', prompt: 'prior', response: 'Prior answer', createdAt: '2026-05-16T00:00:00.000Z', completedAt: '2026-05-16T00:00:01.000Z' }],
    executionUnits: [{ id: 'EU-done', tool: 'prior.task', status: 'done', hash: 'hash-done', params: '{}' }],
  }), {});

  const uiState = bodies[0]?.uiState as { contextReusePolicy?: { mode?: string; priorWorkSignals?: Record<string, unknown> } } | undefined;
  assert.equal(uiState?.contextReusePolicy?.mode, undefined);
  assert.equal(uiState?.contextReusePolicy?.priorWorkSignals?.repairTargetAvailable, false);
});

test('UI transport does not publish mode from reference diagnostic wording alone', async () => {
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
    prompt: 'summarize the selected diagnostic accuracy artifact',
    references: [{
      id: 'ref-diagnostic-title',
      kind: 'task-result',
      title: 'Diagnostic accuracy of MRI for progression-free survival',
      ref: 'artifact:diagnostic-accuracy-report',
      summary: 'Contains prior failed trial endpoints as scientific content, not a runtime failure.',
    }],
    messages: [{ id: 'msg-prior', role: 'scenario', content: 'Prior answer', createdAt: '2026-05-16T00:00:00.000Z' }],
    runs: [{ id: 'run-prior', scenarioId: 'literature-evidence-review', status: 'completed', prompt: 'prior', response: 'Prior answer', createdAt: '2026-05-16T00:00:00.000Z', completedAt: '2026-05-16T00:00:01.000Z' }],
  }), {});

  const uiState = bodies[0]?.uiState as { contextReusePolicy?: { mode?: string; priorWorkSignals?: Record<string, unknown>; selectedRefsOnly?: boolean } } | undefined;
  assert.equal(uiState?.contextReusePolicy?.mode, undefined);
  assert.equal(uiState?.contextReusePolicy?.priorWorkSignals?.repairTargetAvailable, false);
  assert.equal(uiState?.contextReusePolicy?.selectedRefsOnly, true);
});

test('UI transport does not publish mode from reference title or summary keywords alone', async () => {
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
    prompt: 'summarize this selected reference without rerunning',
    messages: [{ id: 'msg-prior', role: 'scenario', content: 'Prior answer', createdAt: '2026-05-16T00:00:00.000Z' }],
    runs: [{ id: 'run-prior', scenarioId: 'literature-evidence-review', status: 'completed', prompt: 'prior', response: 'Prior answer', createdAt: '2026-05-16T00:00:00.000Z', completedAt: '2026-05-16T00:00:01.000Z' }],
    references: [{
      id: 'ref-diagnostic-keyword-only',
      ref: 'artifact:diagnostic-accuracy-paper',
      kind: 'task-result',
      title: 'Diagnostic accuracy of MRI after failed screening',
      summary: 'Prior satisfied result mentions repair-needed only as quoted literature terminology.',
    }],
  }), {});

  const uiState = bodies[0]?.uiState as { contextReusePolicy?: { mode?: string; priorWorkSignals?: Record<string, unknown> } } | undefined;
  assert.equal(uiState?.contextReusePolicy?.mode, undefined);
  assert.equal(uiState?.contextReusePolicy?.priorWorkSignals?.repairTargetAvailable, false);
});

test('UI transport exposes structured recover action signal without publishing mode', async () => {
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
    prompt: 'continue using the available action',
    messages: [{ id: 'msg-prior', role: 'scenario', content: 'Prior answer', createdAt: '2026-05-16T00:00:00.000Z' }],
    runs: [{ id: 'run-prior', scenarioId: 'literature-evidence-review', status: 'completed', prompt: 'prior', response: 'Prior answer', createdAt: '2026-05-16T00:00:00.000Z', completedAt: '2026-05-16T00:00:01.000Z' }],
    references: [{
      id: 'ref-recover-action',
      ref: 'recover-action:retry-provider',
      kind: 'task-result',
      sourceId: 'recover-action',
      title: 'Retry provider with bounded refs',
    }],
  }), {});

  const uiState = bodies[0]?.uiState as { contextReusePolicy?: { mode?: string; priorWorkSignals?: Record<string, unknown> } } | undefined;
  assert.equal(uiState?.contextReusePolicy?.mode, undefined);
  assert.equal(uiState?.contextReusePolicy?.priorWorkSignals?.repairTargetAvailable, true);
});

test('UI transport exposes current failure refs without publishing mode', async () => {
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
    prompt: 'continue from the current failed projection using available refs',
    messages: [{ id: 'msg-prior', role: 'scenario', content: 'Prior failed result', createdAt: '2026-05-16T00:00:00.000Z' }],
    runs: [{ id: 'run-failed', scenarioId: 'literature-evidence-review', status: 'failed', prompt: 'prior', response: 'failed', createdAt: '2026-05-16T00:00:00.000Z', completedAt: '2026-05-16T00:00:01.000Z' }],
    executionUnits: [{
      id: 'EU-failed',
      tool: 'prior.task',
      status: 'repair-needed',
      hash: 'hash-failed',
      params: '{}',
      outputRef: '.sciforge/task-results/failed.json',
      failureReason: 'schema validation failed',
      recoverActions: ['Regenerate from current failure refs only'],
    }],
  }), {});

  const uiState = bodies[0]?.uiState as { contextReusePolicy?: { mode?: string; priorWorkSignals?: Record<string, unknown> } } | undefined;
  assert.equal(uiState?.contextReusePolicy?.mode, undefined);
  assert.equal(uiState?.contextReusePolicy?.priorWorkSignals?.repairTargetAvailable, true);
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

test('request timeout becomes a soft wait after backend progress events', async () => {
  let requestSignal: AbortSignal | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestSignal = init?.signal as AbortSignal | undefined;
    return delayedStreamResponse([
      {
        event: {
          type: 'conversation-policy',
          message: 'Runtime accepted the request.',
          latencyPolicy: {
            firstEventWarningMs: 100,
            silentRetryMs: 200,
            requestTimeoutMs: 20,
          },
        },
      },
      {
        result: {
          message: 'Long-running workspace result ready.',
          executionUnits: [{ id: 'unit-1', status: 'done' }],
          artifacts: [],
        },
      },
    ], requestSignal, 50);
  }) as typeof fetch;

  const events: AgentStreamEvent[] = [];
  const response = await sendSciForgeToolMessage(messageInput(), {
    onEvent: (event) => events.push(event),
  });

  assert.equal(response.message.status, 'completed');
  assert.equal(requestSignal?.aborted, false);
  assert.ok(events.some((event) => event.type === 'backend-timeout-extended'));
});

test('synthetic backend-silent wait events release foreground as background-running after a readable foreground result', async () => {
  let requestSignal: AbortSignal | undefined;
  globalThis.setInterval = ((handler: (...args: unknown[]) => void, timeout?: number, ...args: unknown[]) => {
    return originalSetInterval(handler, timeout === 10_000 ? 10 : timeout, ...args);
  }) as typeof globalThis.setInterval;
  globalThis.fetch = (async (_input, init) => {
    requestSignal = init?.signal as AbortSignal | undefined;
    return syntheticWaitStallStreamResponse(requestSignal, { foregroundReadableResult: true });
  }) as typeof fetch;

  const events: AgentStreamEvent[] = [];
  const response = await sendSciForgeToolMessage(messageInput(undefined, {
    runs: [{
      id: 'prior-run-1',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'prior prompt',
      response: 'prior response',
      createdAt: '2026-05-07T01:00:00.000Z',
      raw: { conversationProjectionRef: 'projection:prior-run-1' },
    }],
    executionUnits: [{
      id: 'EU-prior',
      tool: 'prior.tool',
      params: '{}',
      status: 'done',
      hash: 'hash-prior',
      outputRef: '.sciforge/sessions/prior/task-results/result.json',
      stdoutRef: '.sciforge/sessions/prior/logs/stdout.log',
    }],
  }), {
    onEvent: (event) => events.push(event),
  });

  assert.equal(requestSignal?.aborted, true);
  assert.ok(events.some((event) => event.type === 'backend-stall-bounded-stop'));
  assert.ok(events.filter((event) => event.type === 'backend-silent' || event.label === 'wait').length >= 2);
  assert.equal(response.executionUnits[0]?.status, 'running');
  assert.equal(response.executionUnits[0]?.tool, 'sciforge.runtime.bounded-stop');

  const raw = response.run.raw as {
    data?: { run?: { raw?: { boundedStallMarkerEvent?: { status?: string } } } };
    displayIntent?: { status?: string; boundedStallMarkerEvent?: { status?: string } };
  };
  assert.equal(raw.data?.run?.raw?.boundedStallMarkerEvent?.status, 'background-running');
  assert.equal(raw.displayIntent?.status, 'background-running');
  assert.equal(raw.displayIntent?.boundedStallMarkerEvent?.status, 'background-running');
});

test('bounded-stall without a readable foreground result is not reported as background-running', async () => {
  let requestSignal: AbortSignal | undefined;
  globalThis.setInterval = ((handler: (...args: unknown[]) => void, timeout?: number, ...args: unknown[]) => {
    return originalSetInterval(handler, timeout === 10_000 ? 10 : timeout, ...args);
  }) as typeof globalThis.setInterval;
  globalThis.fetch = (async (_input, init) => {
    requestSignal = init?.signal as AbortSignal | undefined;
    return syntheticWaitStallStreamResponse(requestSignal, { foregroundReadableResult: false });
  }) as typeof fetch;

  const events: AgentStreamEvent[] = [];
  const response = await sendSciForgeToolMessage(messageInput(), {
    onEvent: (event) => events.push(event),
  });

  assert.equal(requestSignal?.aborted, true);
  assert.ok(events.some((event) => event.type === 'backend-stall-bounded-stop'));
  assert.equal(response.executionUnits[0]?.status, 'failed-with-reason');
  assert.equal(response.executionUnits[0]?.tool, 'sciforge.runtime.bounded-stop');
  assert.match(response.message.content, /没有 first-readable-result\/foreground partial ref/);

  const raw = response.run.raw as {
    data?: { run?: { raw?: { boundedStallMarkerEvent?: { status?: string } } } };
    displayIntent?: { status?: string; boundedStallMarkerEvent?: { status?: string } };
  };
  assert.equal(raw.data?.run?.raw?.boundedStallMarkerEvent?.status, 'failed-with-reason');
  assert.equal(raw.displayIntent?.status, 'failed-with-reason');
  assert.equal(raw.displayIntent?.boundedStallMarkerEvent?.status, 'failed-with-reason');
});

function syntheticWaitStallStreamResponse(
  signal: AbortSignal | undefined,
  options: { foregroundReadableResult: boolean },
) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      const abort = () => controller.error(new DOMException('The operation was aborted.', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      try {
        controller.enqueue(encoder.encode(`${JSON.stringify({
          event: {
            type: 'conversation-policy',
            message: 'Runtime accepted the request.',
            latencyPolicy: {
              firstEventWarningMs: 100,
              silentRetryMs: 5_000,
              stallBoundMs: 350,
              requestTimeoutMs: 10_000,
            },
          },
        })}\n`));
        if (options.foregroundReadableResult) {
          controller.enqueue(encoder.encode(`${JSON.stringify({
            event: {
              type: 'first-readable-result',
              detail: 'Partial answer is visible while backend continues.',
              readableRef: 'artifact:partial-answer',
              refs: ['artifact:partial-answer'],
              qualitySignals: { userVisible: true, partialResult: true },
            },
          })}\n`));
        }
        for (let index = 0; index < 25 && !signal?.aborted; index += 1) {
          await new Promise((resolve) => setTimeout(resolve, 40));
          if (signal?.aborted) break;
          controller.enqueue(encoder.encode(`${JSON.stringify({
            event: {
              type: 'backend-silent',
              label: 'wait',
              detail: 'Synthetic transport wait event.',
            },
          })}\n`));
        }
        if (!signal?.aborted) controller.close();
      } finally {
        signal?.removeEventListener('abort', abort);
      }
    },
  }), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
}

function delayedStreamResponse(items: unknown[], signal: AbortSignal | undefined, delayMs: number) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      const abort = () => controller.error(new DOMException('The operation was aborted.', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      try {
        controller.enqueue(encoder.encode(`${JSON.stringify(items[0])}\n`));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (signal?.aborted) return;
        for (const item of items.slice(1)) {
          controller.enqueue(encoder.encode(`${JSON.stringify(item)}\n`));
        }
        controller.close();
      } finally {
        signal?.removeEventListener('abort', abort);
      }
    },
  }), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
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

function directContextTurnExecutionConstraints() {
  return {
    schemaVersion: 'sciforge.turn-execution-constraints.v1',
    policyId: 'sciforge.current-turn-execution-constraints.v1',
    source: 'runtime-contract.turn-constraints',
    contextOnly: true,
    agentServerForbidden: true,
    workspaceExecutionForbidden: true,
    externalIoForbidden: true,
    codeExecutionForbidden: true,
    preferredCapabilityIds: ['runtime.direct-context-answer'],
    executionModeHint: 'direct-context-answer',
    initialResponseModeHint: 'direct-context-answer',
    reasons: ['upstream policy forbids AgentServer dispatch'],
    evidence: {
      hasPriorContext: true,
      referenceCount: 1,
      artifactCount: 0,
      executionRefCount: 0,
      runCount: 0,
    },
  };
}
