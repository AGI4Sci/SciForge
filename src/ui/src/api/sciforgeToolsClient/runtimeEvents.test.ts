import test from 'node:test';
import assert from 'node:assert/strict';
import type { SendAgentMessageInput } from '../../domain';
import { sendSciForgeToolMessage } from '../sciforgeToolsClient';
import { normalizeWorkspaceRuntimeEvent, readWorkspaceToolStream } from './runtimeEvents';

test('SSE reader promotes Runtime Codex message events without synthesizing GUI projection', async () => {
  const body = [
    'event: message',
    'data: {"type":"message","text":"SCIFORGE-MT-FIXED-5173"}',
    '',
    'event: done',
    'data: {"type":"done","status":"done","message":"Runtime Codex completed successfully."}',
    '',
  ].join('\n');
  const seen: unknown[] = [];
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });

  const stream = await readWorkspaceToolStream(response, (event) => seen.push(event));

  assert.equal(seen.length, 2);
  assert.equal((stream.result as { message?: string }).message, 'SCIFORGE-MT-FIXED-5173');
  assert.equal((stream.result as { output?: { message?: string } }).output?.message, 'SCIFORGE-MT-FIXED-5173');
  assert.equal('displayIntent' in (stream.result as Record<string, unknown>), false);
});

test('Runtime Codex raw JSONL and stderr warnings normalize to folded audit summaries', () => {
  const rawJsonl = normalizeWorkspaceRuntimeEvent({
    type: 'raw_jsonl',
    rawJsonl: '{"secret":"RAW_JSONL_SHOULD_NOT_RENDER"}',
    presentationRole: 'audit',
  });
  const stderr = normalizeWorkspaceRuntimeEvent({
    type: 'audit',
    status: 'stderr',
    message: 'Plugin manifest warning: failed to load plugin manifest from /tmp/plugin.json',
    raw: { stream: 'stderr', chunk: 'Plugin manifest warning: failed to load plugin manifest from /tmp/plugin.json' },
  });

  assert.match(rawJsonl.detail ?? '', /raw JSONL recorded/i);
  assert.match(stderr.detail ?? '', /plugin manifest warning recorded/i);
  assert.doesNotMatch(rawJsonl.detail ?? '', /RAW_JSONL_SHOULD_NOT_RENDER/);
  assert.doesNotMatch(stderr.detail ?? '', /failed to load plugin|\/tmp\/plugin\.json/);
});
test('Runtime Codex stream request carries command text and adapter metadata only', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  try {
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response([
        'event: done\n',
        'data: {"type":"done","status":"done","message":"ok"}\n\n',
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    await sendSciForgeToolMessage(runtimeRequestInput());
  } finally {
    globalThis.fetch = originalFetch;
  }

  const body = bodies[0]!;
  assert.deepEqual(Object.keys(body).sort(), [
    'allowOpenAiRuntime',
    'attemptId',
    'auditMetadata',
    'commandId',
    'commandText',
    'guiExtension',
    'profile',
    'schemaVersion',
    'workspacePath',
  ].sort());
  assert.equal(body.commandText, 'ask --ref "artifact:report-1" "Summarize current context"');
  assert.equal(body.workspacePath, '/tmp/current');
  assert.equal(body.profile, 'sciforge-runtime-deepseek');
  assert.match(String(body.commandId), /^codex-command-/);
  assert.match(String(body.attemptId), /^codex-command-.*-attempt-1$/);
  assert.deepEqual(body.guiExtension, { enabled: true });
  assert.equal(typeof body.auditMetadata, 'object');

  const forbiddenKeys = [
    'prompt',
    'messages',
    'transcript',
    'sessionMessages',
    'seedMessages',
    'demoMessages',
    'artifacts',
    'artifactBody',
    'artifactData',
    'claims',
    'claim',
    'expectedArtifactTypes',
    'expectedResult',
    'expectedResults',
    'selectedSkillIds',
    'selectedToolIds',
    'toolProviderRoutes',
    'providerRoute',
    'toolRoute',
    'routeDecision',
    'failureRecoveryPolicy',
    'uiState',
    'references',
  ];
  assert.deepEqual(recursiveForbiddenKeys(body, forbiddenKeys), []);
  assert.doesNotMatch(JSON.stringify(body), /SEED_MESSAGE_SHOULD_NOT_LEAK|ARTIFACT_BODY_SHOULD_NOT_LEAK|CLAIM_BODY_SHOULD_NOT_LEAK/);
  assert.doesNotMatch(JSON.stringify(body), /legacy\.skill|127\.0\.0\.1:7777|preserve-context/);
});

test('Runtime Codex stream request resumes from persisted nested Runtime Codex session metadata', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  const previousCodexSessionId = '019e3e82-164d-79b2-a5d4-b16241620b10';
  try {
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response([
        'event: done\n',
        'data: {"type":"done","status":"done","message":"ok"}\n\n',
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...runtimeRequestInput(),
      runs: [{
        id: 'codex-command-previous',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: 'previous prompt',
        response: 'previous answer',
        createdAt: '2026-05-19T00:00:00.000Z',
        completedAt: '2026-05-19T00:00:01.000Z',
        raw: {
          ok: true,
          data: {
            run: {
              id: 'codex-command-previous',
              output: {
                result: JSON.stringify({
                  type: 'done',
                  status: 'done',
                  codexSessionId: previousCodexSessionId,
                  output: {
                    codexSessionId: previousCodexSessionId,
                    message: 'previous answer',
                  },
                }),
              },
            },
          },
        },
      }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(bodies[0]?.codexSessionId, previousCodexSessionId);
});

test('Runtime Codex stream request excludes selected seed and fixture refs from command text and audit refs', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  try {
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response([
        'event: done\n',
        'data: {"type":"done","status":"done","message":"ok"}\n\n',
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...runtimeRequestInput(),
      references: [{
        id: 'ref-seed-message',
        kind: 'message',
        title: 'Seed message',
        ref: 'message:seed-demo',
      }, {
        id: 'ref-seed-ui-text',
        kind: 'ui',
        title: 'Seed selection',
        ref: 'ui-text:message:seed-demo#quote',
        payload: {
          sourceRef: 'message:seed-demo',
          selectedText: 'SEED_SELECTED_TEXT_SHOULD_NOT_ENTER_CODEX',
        },
      }, {
        id: 'ref-live-report',
        kind: 'task-result',
        title: 'Live report',
        ref: 'artifact:report-1',
      }],
      messages: [{
        id: 'seed-demo',
        role: 'scenario',
        content: 'SEED_MESSAGE_SHOULD_NOT_LEAK',
        createdAt: '2026-05-19T00:00:00.000Z',
        status: 'completed',
        provenance: {
          kind: 'seed-demo',
          source: 'scenarioDemoData:literature-evidence-review',
          runtimeRequestEligible: false,
          liveAcceptanceEligible: false,
        },
      }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const body = bodies[0]!;
  const serialized = JSON.stringify(body);
  assert.equal(body.commandText, 'ask --ref "artifact:report-1" "Summarize current context"');
  assert.doesNotMatch(serialized, /message:seed-demo|ui-text:message:seed-demo|SEED_SELECTED_TEXT_SHOULD_NOT_ENTER_CODEX/);
  assert.match(serialized, /artifact:report-1/);
});

test('Runtime Codex failed SSE returns a persistable failed run with folded audit refs', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const commandId = String(body.commandId);
      const attemptId = String(body.attemptId);
      const stderrRef = `audit:codex-runtime:${commandId}:${attemptId}:stderr`;
      return new Response([
      'event: run_started\n',
      `data: ${JSON.stringify({ type: 'run_started', provider: 'sciforge-deepseek-proxy', model: 'bailian/deepseek-v4-flash', profile: 'sciforge-runtime-deepseek', workspace: '/tmp/current', commandId, attemptId, evidenceRefs: [stderrRef] })}\n\n`,
      'event: audit\n',
      `data: ${JSON.stringify({ type: 'audit', status: 'stderr', message: 'RAW_STDERR_SHOULD_NOT_RENDER', raw: { stream: 'stderr', chunk: 'RAW_STDERR_SHOULD_NOT_RENDER' }, commandId, attemptId })}\n\n`,
      'event: failed\n',
      `data: ${JSON.stringify({ type: 'failed', status: 'failed', message: 'Runtime Codex exited with code 7.', provider: 'sciforge-deepseek-proxy', model: 'bailian/deepseek-v4-flash', profile: 'sciforge-runtime-deepseek', workspace: '/tmp/current', commandId, attemptId, exitCode: 7, raw: { stderrSummary: 'RAW_STDERR_SHOULD_NOT_RENDER', evidenceRefs: [stderrRef] } })}\n\n`,
    ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof fetch;

    const response = await sendSciForgeToolMessage(runtimeRequestInput());
    const raw = response.run.raw as Record<string, unknown>;
    const failure = raw.codexRuntimeFailure as Record<string, unknown>;
    const audit = raw.runtimeAudit as Record<string, unknown>;

    assert.equal(response.run.status, 'failed');
    assert.equal(response.run.id.startsWith('codex-command-'), true);
    assert.equal(failure.schemaVersion, 'sciforge.runtime-codex-failed-run.v1');
    assert.equal(failure.commandId, response.run.id);
    assert.equal(failure.attemptId, `${response.run.id}-attempt-1`);
    assert.equal(failure.workspace, '/tmp/current');
    assert.equal(failure.profile, 'sciforge-runtime-deepseek');
    assert.equal(failure.provider, 'sciforge-deepseek-proxy');
    assert.equal(failure.model, 'bailian/deepseek-v4-flash');
    assert.equal(failure.exitCode, 7);
    assert.equal(failure.stderrSummary, 'RAW_STDERR_SHOULD_NOT_RENDER');
    assert.ok((failure.evidenceRefs as string[]).includes(`audit:codex-runtime:${response.run.id}:${response.run.id}-attempt-1:stderr`));
    const recoverState = failure.recoverState as Record<string, unknown>;
    assert.equal(recoverState.status, 'repair-needed');
    assert.equal(recoverState.commandId, response.run.id);
    assert.equal(recoverState.attemptId, `${response.run.id}-attempt-1`);
    assert.equal(recoverState.workspace, '/tmp/current');
    assert.equal(recoverState.profile, 'sciforge-runtime-deepseek');
    assert.equal(recoverState.provider, 'sciforge-deepseek-proxy');
    assert.equal(recoverState.model, 'bailian/deepseek-v4-flash');
    assert.equal(recoverState.stderrSummary, 'RAW_STDERR_SHOULD_NOT_RENDER');
    assert.ok((recoverState.evidenceRefs as string[]).includes(`audit:codex-runtime:${response.run.id}:${response.run.id}-attempt-1:stderr`));
    assert.equal(audit.foldedByDefault, true);
    assert.doesNotMatch(response.message.content, /RAW_STDERR_SHOULD_NOT_RENDER/);

    const reloadedRun = JSON.parse(JSON.stringify(response.run)) as typeof response.run;
    const reloadedRaw = reloadedRun.raw as Record<string, unknown>;
    const reloadedFailure = reloadedRaw.codexRuntimeFailure as Record<string, unknown>;
    assert.equal(reloadedRun.status, 'failed');
    assert.equal(reloadedFailure.commandId, response.run.id);
    assert.equal(reloadedFailure.attemptId, `${response.run.id}-attempt-1`);
    assert.equal(reloadedFailure.workspace, '/tmp/current');
    assert.equal(reloadedFailure.profile, 'sciforge-runtime-deepseek');
    assert.equal(reloadedFailure.provider, 'sciforge-deepseek-proxy');
    assert.equal(reloadedFailure.model, 'bailian/deepseek-v4-flash');
    assert.equal(reloadedFailure.stderrSummary, 'RAW_STDERR_SHOULD_NOT_RENDER');
    const reloadedRecoverState = reloadedFailure.recoverState as Record<string, unknown>;
    assert.equal(reloadedRecoverState.status, 'repair-needed');
    assert.equal(reloadedRecoverState.commandId, response.run.id);
    assert.equal(reloadedRecoverState.workspace, '/tmp/current');
    assert.equal(reloadedRecoverState.profile, 'sciforge-runtime-deepseek');
    assert.equal(reloadedRecoverState.provider, 'sciforge-deepseek-proxy');
    assert.equal(reloadedRecoverState.model, 'bailian/deepseek-v4-flash');
    assert.equal(reloadedRecoverState.stderrSummary, 'RAW_STDERR_SHOULD_NOT_RENDER');
    assert.ok((reloadedFailure.evidenceRefs as string[]).includes(`audit:codex-runtime:${response.run.id}:${response.run.id}-attempt-1:stderr`));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function runtimeRequestInput(): SendAgentMessageInput {
  return {
    sessionId: 'session-test',
    scenarioId: 'literature-evidence-review',
    agentName: 'Literature',
    agentDomain: 'literature',
    prompt: 'Summarize current context',
    references: [{
      id: 'ref-report',
      kind: 'task-result',
      title: 'Report',
      ref: 'artifact:report-1',
      payload: { selectedText: 'ARTIFACT_BODY_SHOULD_NOT_LEAK' },
    }],
    roleView: 'researcher',
    messages: [{
      id: 'seed-demo',
      role: 'scenario',
      content: 'SEED_MESSAGE_SHOULD_NOT_LEAK',
      createdAt: '2026-05-19T00:00:00.000Z',
      status: 'completed',
    }],
    artifacts: [{
      id: 'report-1',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      data: { markdown: 'ARTIFACT_BODY_SHOULD_NOT_LEAK' },
    }],
    claims: [{
      id: 'claim-1',
      text: 'CLAIM_BODY_SHOULD_NOT_LEAK',
      type: 'inference',
      confidence: 0.8,
      evidenceLevel: 'review',
    }],
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
      updatedAt: '2026-05-19T00:00:00.000Z',
    },
    scenarioOverride: {
      title: 'Test scenario',
      description: 'Test scenario override',
      skillDomain: 'literature',
      scenarioMarkdown: '# Test',
      defaultComponents: [],
      allowedComponents: [],
      fallbackComponent: '',
      selectedSkillIds: ['legacy.skill'],
      toolProviderRoutes: {
        web: { source: 'mcp', endpoint: 'http://127.0.0.1:7777/mcp' },
      },
      failureRecoveryPolicy: {
        mode: 'preserve-context',
      },
    },
    availableComponentIds: ['report-viewer'],
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1', source: 'built-in' },
    skillPlanRef: 'skill-plan.test',
    uiPlanRef: 'ui-plan.test',
  };
}

function recursiveForbiddenKeys(value: unknown, forbiddenKeys: string[], path = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => recursiveForbiddenKeys(item, forbiddenKeys, `${path}[${index}]`));
  }
  const record = value as Record<string, unknown>;
  return Object.entries(record).flatMap(([key, entry]) => {
    const current = path ? `${path}.${key}` : key;
    const hit = forbiddenKeys.includes(key) ? [current] : [];
    return [...hit, ...recursiveForbiddenKeys(entry, forbiddenKeys, current)];
  });
}
