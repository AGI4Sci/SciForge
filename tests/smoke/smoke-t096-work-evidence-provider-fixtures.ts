import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildCompactRepairContext } from '../../src/runtime/gateway/agentserver-prompts.js';
import { buildContextEnvelope } from '../../src/runtime/gateway/context-envelope.js';
import { repairNeededPayload } from '../../src/runtime/gateway/repair-policy.js';
import { runAgentServerGeneratedTask } from '../../src/runtime/gateway/generated-task-runner.js';
import { readRecentTaskAttempts } from '../../src/runtime/task-attempt-history.js';
import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeEvent, WorkspaceTaskRunResult } from '../../src/runtime/runtime-types.js';
import { normalizeWorkspaceRuntimeEvent } from '../../src/ui/src/api/sciforgeToolsClient/runtimeEvents.js';
import { presentStreamWorklog } from '../../src/ui/src/streamEventPresentation.js';

type ProviderFixture = {
  id: string;
  prompt: string;
  expectedAttemptStatus: 'done' | 'repair-needed' | 'failed-with-reason';
  expectedResultStatus: string;
  expectedSummaryStatus?: string;
  payload: ToolPayload;
};

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-t096-work-evidence-provider-'));
const skill = {
  id: 'literature.generic_retrieval',
  kind: 'workspace',
  available: true,
  reason: 'T096 provider fixture',
  checkedAt: '2026-05-09T00:00:00.000Z',
  manifestPath: '.sciforge/skills/literature.generic_retrieval/skill.json',
  manifest: {
    id: 'literature.generic_retrieval',
    name: 'Generic Retrieval',
    domain: 'literature',
    entrypoint: { type: 'python', command: 'main' },
  },
} as unknown as SkillAvailability;

const fixtures: ProviderFixture[] = [
  {
    id: 'empty-without-diagnostics',
    prompt: 'T096 provider fixture: search recent records and report empty output truthfully.',
    expectedAttemptStatus: 'repair-needed',
    expectedResultStatus: 'repair-needed',
    payload: basePayload({
      id: 'empty-without-diagnostics',
      message: 'Retrieved 0 records from external search.',
      reasoningTrace: 'Queried provider API. Retrieved 0 records.',
      executionUnits: [{ id: 'search', status: 'done', tool: 'generic-search' }],
    }),
  },
  {
    id: 'empty-after-fallback',
    prompt: 'T096 provider fixture: search recent records with fallback diagnostics.',
    expectedAttemptStatus: 'done',
    expectedResultStatus: 'done',
    expectedSummaryStatus: 'empty',
    payload: basePayload({
      id: 'empty-after-fallback',
      message: 'Retrieved 0 records after documented provider and fallback checks.',
      confidence: 0.73,
      reasoningTrace: 'Primary provider status 200 totalResults=0. Fallback provider status 200 totalResults=0.',
      executionUnits: [{ id: 'search', status: 'done', tool: 'generic-search' }],
      workEvidence: [{
        kind: 'retrieval',
        status: 'empty',
        provider: 'generic-search',
        input: { query: 'recent records', fallback: true },
        resultCount: 0,
        outputSummary: 'Primary and fallback providers returned zero records.',
        evidenceRefs: ['trace:empty-fallback'],
        recoverActions: ['Ask user whether to broaden the date window.'],
        diagnostics: ['primary status 200 totalResults=0', 'fallback status 200 totalResults=0'],
        rawRef: 'file:.sciforge/evidence/empty-fallback.json',
      }],
    }),
  },
  {
    id: 'timeout-swallowed',
    prompt: 'T096 provider fixture: fetch a public source and preserve timeout diagnostics.',
    expectedAttemptStatus: 'repair-needed',
    expectedResultStatus: 'repair-needed',
    payload: basePayload({
      id: 'timeout-swallowed',
      message: 'Fetch completed successfully with high confidence.',
      confidence: 0.96,
      reasoningTrace: 'Primary fetch hit HTTP 429 and timed out, but final output still claimed success.',
      executionUnits: [{ id: 'fetch', status: 'done', tool: 'generic-fetch' }],
    }),
  },
  {
    id: 'fallback-success',
    prompt: 'T096 provider fixture: fetch a public source with fallback success evidence.',
    expectedAttemptStatus: 'done',
    expectedResultStatus: 'done',
    expectedSummaryStatus: 'partial',
    payload: basePayload({
      id: 'fallback-success',
      message: 'Fetch completed after fallback recovery.',
      confidence: 0.91,
      reasoningTrace: 'Primary fetch returned HTTP 429. Retried with fallback provider and recovered.',
      executionUnits: [{ id: 'fetch', status: 'done', tool: 'generic-fetch' }],
      workEvidence: [{
        kind: 'fetch',
        status: 'partial',
        provider: 'generic-http',
        input: 'https://example.test/source',
        outputSummary: '429 on primary; fallback succeeded.',
        evidenceRefs: ['trace:fetch-fallback'],
        recoverActions: ['Retry primary provider later with backoff.'],
        diagnostics: ['primary http 429', 'fallback status 200'],
        rawRef: 'file:.sciforge/evidence/fetch-fallback.json',
      }],
    }),
  },
  {
    id: 'fallback-exhausted',
    prompt: 'T096 provider fixture: fetch a public source and report fallback exhaustion honestly.',
    expectedAttemptStatus: 'failed-with-reason',
    expectedResultStatus: 'failed-with-reason',
    expectedSummaryStatus: 'failed-with-reason',
    payload: basePayload({
      id: 'fallback-exhausted',
      message: 'Fetch failed after primary and fallback providers were exhausted.',
      confidence: 0.2,
      claimType: 'failed-with-reason',
      evidenceLevel: 'runtime',
      reasoningTrace: 'Primary provider HTTP 429; fallback timed out; no final content was fabricated.',
      executionUnits: [{ id: 'fetch', status: 'failed-with-reason', tool: 'generic-fetch' }],
      workEvidence: [{
        kind: 'fetch',
        status: 'failed-with-reason',
        provider: 'generic-http',
        input: 'https://example.test/source',
        outputSummary: 'Primary and fallback providers failed.',
        evidenceRefs: ['trace:fetch-exhausted'],
        failureReason: 'Primary HTTP 429 and fallback timeout.',
        recoverActions: ['Wait for rate-limit reset or ask user for another source.'],
        nextStep: 'Continue from this failure rather than marking success.',
        diagnostics: ['primary http 429', 'fallback timeout'],
        rawRef: 'file:.sciforge/evidence/fetch-exhausted.json',
      }],
    }),
  },
];

for (const fixture of fixtures) {
  const request = requestForFixture(fixture);
  const result = await runAgentServerGeneratedTask(request, skill, [skill], {}, depsForFixture(fixture));
  assert.ok(result, `${fixture.id} should return a payload`);
  assert.equal(result.executionUnits[0]?.status, fixture.expectedResultStatus, `${fixture.id} result status: ${result.message}`);
  const attempts = await readRecentTaskAttempts(workspace, 'literature', 20, { prompt: fixture.prompt });
  assert.equal(attempts[0]?.status, fixture.expectedAttemptStatus, `${fixture.id} attempt status`);
  assert.doesNotMatch(JSON.stringify(attempts[0]), /RAW_PROVIDER_BODY_SHOULD_NOT_INLINE/);
  if (fixture.expectedSummaryStatus) {
    assert.equal(attempts[0]?.workEvidenceSummary?.items[0]?.status, fixture.expectedSummaryStatus, `${fixture.id} WorkEvidence status`);
  }
  if (fixture.expectedAttemptStatus === 'repair-needed') {
    assert.match(attempts[0]?.failureReason ?? '', /External retrieval returned zero results|fetch timeout|HTTP 429|rate-limit/i);
  }
}

const failureAttempt = (await readRecentTaskAttempts(workspace, 'literature', 20, { prompt: fixtures[4].prompt }))[0];
assert.ok(failureAttempt, 'fallback-exhausted attempt should be persisted');
const repairContext = await buildCompactRepairContext({
  request: requestForFixture(fixtures[4]),
  workspace,
  skill,
  run: runForAttempt(failureAttempt),
  schemaErrors: [],
  failureReason: failureAttempt.failureReason ?? 'Provider fixture failed.',
  priorAttempts: [failureAttempt],
});
const serializedRepair = JSON.stringify(repairContext);
assert.match(serializedRepair, /workEvidenceSummary/);
assert.match(serializedRepair, /fallback timeout/);
assert.doesNotMatch(serializedRepair, /RAW_PROVIDER_BODY_SHOULD_NOT_INLINE/);

const envelope = buildContextEnvelope(requestForFixture(fixtures[1]), {
  workspace,
  priorAttempts: await readRecentTaskAttempts(workspace, 'literature', 20),
  mode: 'delta',
});
const serializedEnvelope = JSON.stringify(envelope);
assert.match(serializedEnvelope, /workEvidenceSummary/);
assert.match(serializedEnvelope, /fallback status 200/);
assert.doesNotMatch(serializedEnvelope, /RAW_PROVIDER_BODY_SHOULD_NOT_INLINE/);

await runBackendStreamSmoke();

console.log('[ok] T096 provider fixtures cover 429/timeout/empty/fallback WorkEvidence, attempts, repair context, context envelope, and backend stream UI events');

async function runBackendStreamSmoke() {
  const backendWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-t096-backend-stream-'));
  const scenarios = new Map([
    ['empty-without-diagnostics', {
      events: [],
      payload: basePayload({
        id: 'real-empty-without-diagnostics',
        message: 'Retrieved 0 records from external search.',
        reasoningTrace: 'External provider returned 0 records.',
        executionUnits: [{ id: 'search', status: 'done', tool: 'agentserver.search' }],
      }),
      expectedStatus: 'repair-needed',
      expectedEvidenceStatus: undefined,
    }],
    ['empty-after-fallback', {
      events: [{
        type: 'provider-result',
        toolName: 'agentserver.search',
        provider: 'stream-provider',
        query: 'recent records',
        httpStatus: 200,
        resultCount: 0,
        fallbackAttempted: true,
        message: 'Primary and fallback provider status 200 totalResults=0.',
        recoverActions: ['Ask user whether to broaden the date window.'],
        evidenceRefs: ['stream:empty-fallback'],
        rawRef: 'agentserver://stream/empty-fallback',
      }],
      payload: basePayload({
        id: 'real-empty-after-fallback',
        message: 'Retrieved 0 records after documented provider and fallback checks.',
        confidence: 0.72,
        reasoningTrace: 'AgentServer backend streamed provider and fallback diagnostics.',
      }),
      expectedStatus: 'done',
      expectedEvidenceStatus: 'empty',
    }],
    ['timeout-swallowed', {
      events: [{
        type: 'provider-error',
        toolName: 'agentserver.fetch',
        provider: 'stream-provider',
        url: 'https://example.test/source',
        httpStatus: 429,
        timedOut: true,
        status: 'failed',
        message: 'Primary fetch hit HTTP 429 and timed out.',
        evidenceRefs: ['stream:timeout-429'],
        rawRef: 'agentserver://stream/timeout-429',
      }],
      payload: basePayload({
        id: 'real-timeout-swallowed',
        message: 'Fetch completed successfully with high confidence.',
        confidence: 0.96,
        reasoningTrace: 'Final payload incorrectly claimed success after provider timeout.',
        executionUnits: [{ id: 'fetch', status: 'done', tool: 'agentserver.fetch' }],
      }),
      expectedStatus: 'repair-needed',
      expectedEvidenceStatus: 'failed-with-reason',
    }],
    ['fallback-success', {
      events: [{
        type: 'provider-result',
        toolName: 'agentserver.fetch',
        provider: 'stream-provider',
        url: 'https://example.test/source',
        httpStatus: 200,
        fallbackAttempted: true,
        status: 'completed',
        message: 'Primary HTTP 429; fallback provider status 200.',
        recoverActions: ['Retry primary provider later with backoff.'],
        evidenceRefs: ['stream:fallback-success'],
        rawRef: 'agentserver://stream/fallback-success',
      }],
      payload: basePayload({
        id: 'real-fallback-success',
        message: 'Fetch completed after fallback recovery.',
        confidence: 0.91,
        reasoningTrace: 'AgentServer backend used fallback provider successfully.',
      }),
      expectedStatus: 'done',
      expectedEvidenceStatus: 'partial',
    }],
    ['success-without-durable-ref', {
      events: [{
        type: 'provider-result',
        toolName: 'agentserver.fetch',
        provider: 'stream-provider',
        url: 'https://example.test/source',
        httpStatus: 200,
        status: 'completed',
        message: 'Fetch completed but backend did not expose durable raw or evidence refs.',
      }],
      payload: basePayload({
        id: 'real-success-without-durable-ref',
        message: 'Fetch completed successfully with high confidence.',
        confidence: 0.92,
        reasoningTrace: 'AgentServer backend summarized a fetched source without durable refs.',
        executionUnits: [{ id: 'fetch', status: 'done', tool: 'agentserver.fetch' }],
      }),
      expectedStatus: 'repair-needed',
      expectedEvidenceStatus: 'success',
    }],
    ['fallback-exhausted', {
      events: [{
        type: 'provider-error',
        toolName: 'agentserver.fetch',
        provider: 'stream-provider',
        url: 'https://example.test/source',
        httpStatus: 429,
        timedOut: true,
        fallbackExhausted: true,
        status: 'failed',
        message: 'Primary HTTP 429; fallback timed out; all providers exhausted.',
        recoverActions: ['Wait for rate-limit reset or ask user for another source.'],
        evidenceRefs: ['stream:fallback-exhausted'],
        rawRef: 'agentserver://stream/fallback-exhausted',
      }],
      payload: basePayload({
        id: 'real-fallback-exhausted',
        message: 'Fetch failed after primary and fallback providers were exhausted.',
        confidence: 0.2,
        claimType: 'failed-with-reason',
        evidenceLevel: 'runtime',
        reasoningTrace: 'No final content was fabricated after provider exhaustion.',
        executionUnits: [{ id: 'fetch', status: 'failed-with-reason', tool: 'agentserver.fetch' }],
      }),
      expectedStatus: 'failed-with-reason',
      expectedEvidenceStatus: 'failed-with-reason',
    }],
  ] as const);

  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { session: { id: 't096-backend-stream', status: 'active' }, recentTurns: [], currentWorkEntries: [] } }));
      return;
    }
    if (req.method !== 'POST' || String(req.url) !== '/api/agent-server/runs/stream') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }
    const body = await readJson(req);
    const promptText = isRecord(body.input) && typeof body.input.text === 'string' ? body.input.text : '';
    const id = Array.from(scenarios.keys()).find((candidate) => promptText.includes(candidate));
    assert.ok(id, `backend stream prompt should include scenario id: ${promptText.slice(0, 120)}`);
    const scenario = scenarios.get(id);
    assert.ok(scenario);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    for (const event of scenario.events) {
      res.write(JSON.stringify({ event }) + '\n');
    }
    res.end(JSON.stringify({
      result: {
        ok: true,
        data: {
          run: {
            id: `real-backend-${id}`,
            status: 'completed',
            output: { result: scenario.payload },
          },
        },
      },
    }) + '\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    for (const [id, scenario] of scenarios) {
      const events: WorkspaceRuntimeEvent[] = [];
      const result = await runWorkspaceRuntimeGateway({
        skillDomain: 'literature',
        prompt: `T096 real backend provider stream ${id}: retrieve public source.`,
        workspacePath: backendWorkspace,
        agentServerBaseUrl: baseUrl,
        modelProvider: 'openai-compatible',
        modelName: 't096-provider-stream',
        llmEndpoint: {
          provider: 'openai-compatible',
          baseUrl: 'http://llm.example.test/v1',
          apiKey: 'test-secret',
          modelName: 't096-provider-stream',
        },
        uiState: {
          sessionId: `t096-backend-${id}`,
          forceAgentServerGeneration: true,
          freshTaskGeneration: true,
        },
        artifacts: [],
      }, {
        onEvent: (event) => events.push(event),
      });
      assert.equal(result.executionUnits[0]?.status, scenario.expectedStatus, `${id} direct result status`);
      const attempts = await readRecentTaskAttempts(backendWorkspace, 'literature', 20, {
        prompt: `T096 real backend provider stream ${id}: retrieve public source.`,
      });
      assert.equal(attempts[0]?.status, scenario.expectedStatus, `${id} direct attempt status`);
      if (scenario.expectedEvidenceStatus) {
        assert.equal(attempts[0]?.workEvidenceSummary?.items[0]?.status, scenario.expectedEvidenceStatus, `${id} stream WorkEvidence status`);
      }
      if (scenario.events.length) {
        assert.ok(events.some((event) => event.workEvidence?.length), `${id} should emit UI process WorkEvidence events`);
      }
    }
    await assertRuntimeWorkEvidenceFeedsUiAtoms();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function assertRuntimeWorkEvidenceFeedsUiAtoms() {
  const runtimeEvents = [
    {
      type: 'tool-result',
      source: 'agentserver',
      toolName: 'generic_search',
      detail: 'TEXT_FALLBACK_SEARCH_SHOULD_NOT_WIN',
      workEvidence: [{
        kind: 'retrieval',
        status: 'success',
        provider: 'field-contract',
        input: { query: 'runtime field contract' },
        resultCount: 2,
        outputSummary: 'Structured stream search summary',
        evidenceRefs: ['stream:search'],
        recoverActions: [],
      }],
      raw: { providerRawOutput: 'RAW_SEARCH_BODY_SHOULD_STAY_RAW' },
    },
    {
      type: 'tool-result',
      source: 'agentserver',
      toolName: 'generic_fetch',
      workEvidence: [{
        kind: 'fetch',
        status: 'partial',
        provider: 'field-contract',
        input: 'https://example.test/source',
        outputSummary: 'Structured stream fetch summary',
        evidenceRefs: ['stream:fetch'],
        recoverActions: [],
      }],
    },
    {
      type: 'tool-result',
      source: 'agentserver',
      toolName: 'generic_read',
      workEvidence: [{
        kind: 'read',
        status: 'success',
        input: { path: '/workspace/input.txt' },
        outputSummary: 'Structured stream read summary',
        evidenceRefs: ['stream:read'],
        recoverActions: [],
      }],
    },
    {
      type: 'tool-result',
      source: 'agentserver',
      toolName: 'generic_command',
      workEvidence: [{
        kind: 'command',
        status: 'success',
        input: { command: 'node --test' },
        outputSummary: 'Structured stream command summary',
        evidenceRefs: ['stream:command'],
        recoverActions: [],
      }],
    },
    {
      type: 'tool-result',
      source: 'agentserver',
      toolName: 'generic_validate',
      workEvidence: [{
        kind: 'validate',
        status: 'success',
        outputSummary: 'Structured stream validation summary',
        evidenceRefs: ['stream:validate'],
        recoverActions: [],
      }],
    },
  ] satisfies WorkspaceRuntimeEvent[];

  const worklog = presentStreamWorklog(runtimeEvents.map(normalizeWorkspaceRuntimeEvent));
  assert.deepEqual(
    worklog.entries.map((entry) => entry.operationKind),
    ['search', 'fetch', 'read', 'command', 'validate'],
    'runtime WorkEvidence events should drive UI WorkEvent atoms without text fallback',
  );
  assert.match(worklog.entries[0]?.presentation.detail ?? '', /Structured stream search summary/);
  assert.doesNotMatch(worklog.entries[0]?.presentation.detail ?? '', /TEXT_FALLBACK_SEARCH_SHOULD_NOT_WIN/);
  assert.match(worklog.entries[0]?.rawOutput ?? '', /RAW_SEARCH_BODY_SHOULD_STAY_RAW/);
}

function depsForFixture(fixture: ProviderFixture) {
  return {
    readConfiguredAgentServerBaseUrl: async () => 'http://agentserver.local',
    requestAgentServerGeneration: async () => ({
      ok: true as const,
      runId: `t096-${fixture.id}`,
      response: {
        taskFiles: [{
          path: `.sciforge/tasks/t096-${fixture.id}.py`,
          language: 'python',
          content: generatedTask(fixture.payload),
        }],
        entrypoint: { language: 'python' as const, path: `.sciforge/tasks/t096-${fixture.id}.py` },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['research-report'],
        patchSummary: `T096 provider fixture ${fixture.id}`,
      },
    }),
    agentServerGenerationFailureReason: (error: string) => error,
    attemptPlanRefs: () => ({}),
    repairNeededPayload: (request: GatewayRequest, selectedSkill: SkillAvailability, reason: string) => repairNeededPayload(request, selectedSkill, reason),
    agentServerFailurePayloadRefs: () => ({}),
    ensureDirectAnswerReportArtifact: (payload: ToolPayload) => payload,
    mergeReusableContextArtifactsForDirectPayload: async (payload: ToolPayload) => payload,
    validateAndNormalizePayload: async (payload: ToolPayload, _request: GatewayRequest, selectedSkill: SkillAvailability, refs: {
      taskRel: string;
      outputRel: string;
      stdoutRel: string;
      stderrRel: string;
      runtimeFingerprint: Record<string, unknown>;
    }): Promise<ToolPayload> => ({
      ...payload,
      executionUnits: payload.executionUnits.map((unit) => ({ ...unit, skillId: selectedSkill.id, outputRef: refs.outputRel })),
      logs: [{ kind: 'stdout', ref: refs.stdoutRel }, { kind: 'stderr', ref: refs.stderrRel }],
    }),
    tryAgentServerRepairAndRerun: async (params: { failureReason: string }) => repairNeededPayload(requestForFixture(fixture), skill, params.failureReason),
    failedTaskPayload: (request: GatewayRequest, selectedSkill: SkillAvailability, _run: WorkspaceTaskRunResult, reason?: string) => repairNeededPayload(request, selectedSkill, reason || 'failed'),
    coerceWorkspaceTaskPayload: () => undefined,
    schemaErrors: (payload: unknown) => {
      const record = isRecord(payload) ? payload : {};
      return ['message', 'claims', 'uiManifest', 'executionUnits', 'artifacts'].filter((key) => !(key in record)).map((key) => `missing ${key}`);
    },
    firstPayloadFailureReason: (payload: ToolPayload) => {
      const failedUnit = payload.executionUnits.find((unit) => /failed|error|repair-needed/i.test(String(unit.status || '')));
      return failedUnit ? payload.message : undefined;
    },
    payloadHasFailureStatus: (payload: ToolPayload) => {
      return /failed|error|repair-needed|needs-human/i.test(String(payload.claimType || ''))
        || payload.executionUnits.some((unit) => /failed|error|repair-needed|needs-human/i.test(String(unit.status || '')));
    },
  };
}

function requestForFixture(fixture: ProviderFixture): GatewayRequest {
  return {
    skillDomain: 'literature',
    prompt: fixture.prompt,
    workspacePath: workspace,
    agentServerBaseUrl: 'http://agentserver.local',
    expectedArtifactTypes: ['research-report'],
    selectedComponentIds: ['report-viewer'],
    artifacts: [],
    uiState: {
      sessionId: `session-t096-${fixture.id}`,
      freshTaskGeneration: true,
      forceAgentServerGeneration: true,
    },
  } as GatewayRequest;
}

function basePayload(overrides: Partial<ToolPayload> & Record<string, unknown> & { id: string }): ToolPayload {
  const id = overrides.id;
  return {
    message: `T096 ${id} provider fixture.`,
    confidence: 0.86,
    claimType: 'provider-fixture',
    evidenceLevel: 'runtime',
    reasoningTrace: 'Generic provider fixture.',
    claims: [{ text: `T096 ${id} claim`, confidence: 0.86 }],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: `${id}-report` }],
    executionUnits: [{ id: `unit-${id}`, status: 'done', tool: 'generic-provider' }],
    artifacts: [{
      id: `${id}-report`,
      type: 'research-report',
      schema: { type: 'object' },
      data: { markdown: `# T096 ${id}\n\nRaw provider bodies are represented by refs, not inlined summaries.` },
    }],
    ...overrides,
  };
}

function generatedTask(payload: ToolPayload) {
  return [
    'import json, sys',
    '_, input_path, output_path = sys.argv',
    `payload = json.loads(${JSON.stringify(JSON.stringify(payload))})`,
    'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
  ].join('\n');
}

function runForAttempt(attempt: { codeRef?: string; outputRef?: string; stdoutRef?: string; stderrRef?: string; exitCode?: number }): WorkspaceTaskRunResult {
  return {
    spec: {
      id: 't096-provider-fixture',
      language: 'python',
      entrypoint: 'main',
      taskRel: attempt.codeRef ?? '.sciforge/tasks/t096-provider.py',
      input: {},
      outputRel: attempt.outputRef ?? '.sciforge/task-results/t096-provider.json',
      stdoutRel: attempt.stdoutRef ?? '.sciforge/logs/t096-provider.stdout.log',
      stderrRel: attempt.stderrRef ?? '.sciforge/logs/t096-provider.stderr.log',
    },
    workspace,
    command: 'python',
    args: [],
    exitCode: attempt.exitCode ?? 0,
    stdoutRef: attempt.stdoutRef ?? '.sciforge/logs/t096-provider.stdout.log',
    stderrRef: attempt.stderrRef ?? '.sciforge/logs/t096-provider.stderr.log',
    outputRef: attempt.outputRef ?? '.sciforge/task-results/t096-provider.json',
    stdout: '',
    stderr: '',
    runtimeFingerprint: {},
  } as WorkspaceTaskRunResult;
}

async function readJson(req: { on(event: 'data', cb: (chunk: Buffer) => void): void; on(event: 'end', cb: () => void): void }) {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve) => {
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', resolve);
  });
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
