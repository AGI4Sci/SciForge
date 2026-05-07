import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContextEnvelope, expectedArtifactSchema, workspaceTreeSummary } from '../../src/runtime/gateway/context-envelope.js';
import { normalizeGatewayRequest, selectedComponentIdsForRequest } from '../../src/runtime/gateway/gateway-request.js';
import { runAgentServerGeneratedTask } from '../../src/runtime/gateway/generated-task-runner.js';
import { normalizeArtifactsForPayload, persistArtifactRefsForPayload } from '../../src/runtime/gateway/artifact-materializer.js';
import { classifyAgentServerBackendFailure, sanitizeAgentServerError } from '../../src/runtime/gateway/backend-failure-diagnostics.js';
import { coerceAgentServerToolPayload, parseGenerationResponse } from '../../src/runtime/gateway/payload-normalizer.js';
import { repairNeededPayload } from '../../src/runtime/gateway/repair-policy.js';
import { applyRuntimeVerificationPolicy, normalizeRuntimeVerificationPolicy } from '../../src/runtime/gateway/verification-policy.js';
import { normalizeRuntimeVerificationResults } from '../../src/runtime/gateway/verification-results.js';
import { normalizeAgentServerWorkspaceEvent, withRequestContextWindowLimit } from '../../src/runtime/gateway/workspace-event-normalizer.js';
import { readTaskAttempts } from '../../src/runtime/task-attempt-history.js';
import type { SkillAvailability, ToolPayload } from '../../src/runtime/runtime-types.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-gateway-modules-'));
try {
  await writeFile(join(workspace, 'report.md'), '## Summary\nGateway split smoke passed.\n', 'utf8');
  await writeFile(join(workspace, '.bioagent-artifact-root-marker.txt'), 'not hidden by prefix alone\n', 'utf8');
  await writeFile(join(workspace, '.gitkeep'), 'keep\n', 'utf8');
  await mkdir(join(workspace, '.bioagent', 'artifacts'), { recursive: true });
  await writeFile(join(workspace, '.bioagent', 'artifacts', 'stale-paper-list.json'), '{"stale":true}\n', 'utf8');
  await mkdir(join(workspace, '.sciforge', 'artifacts'), { recursive: true });
  await writeFile(join(workspace, '.sciforge', 'artifacts', 'old-large-report.txt'), 'old report\n', 'utf8');
  const request = normalizeGatewayRequest({
    skillDomain: 'literature',
    prompt: 'Summarize the uploaded report',
    workspacePath: workspace,
    agentServerBaseUrl: 'http://127.0.0.1:3000/',
    llmEndpoint: { provider: 'openai', baseUrl: 'http://127.0.0.1:4000/', modelName: 'test-model' },
    expectedArtifactTypes: ['research-report', 'research-report'],
    selectedComponentIds: ['report-viewer'],
    selectedVerifierIds: ['schema.verifier'],
    verificationPolicy: { required: false, mode: 'lightweight', riskLevel: 'low', reason: 'smoke verification policy' },
    uiState: {
      sessionId: 'session-gateway',
      recentConversation: ['user: summarize report', 'assistant: ready'],
      conversationLedger: Array.from({ length: 20 }, (_, index) => ({
        turn: index + 1,
        id: `msg-${index + 1}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        contentDigest: `digest-${index + 1}`,
        contentPreview: `Round ${index + 1}`,
      })),
      contextReusePolicy: { mode: 'stable-ledger-plus-recent-window', ordering: 'append-only-session-order' },
      expectedArtifactTypes: ['paper-list'],
      selectedComponentIds: ['paper-card-list'],
    },
    artifacts: [{ id: 'prior-report', type: 'research-report' }],
  });

  assert.equal(request.agentServerBaseUrl, 'http://127.0.0.1:3000');
  assert.deepEqual(request.selectedVerifierIds, ['schema.verifier']);
  assert.equal(request.verificationPolicy?.mode, 'lightweight');
  const rateLimitDiagnostic = classifyAgentServerBackendFailure('429 retry-after: 2 api_key=sk-secret1234567890', {
    httpStatus: 429,
    provider: 'openai-compatible',
  });
  assert.ok(rateLimitDiagnostic?.categories.includes('rate-limit'));
  assert.equal(rateLimitDiagnostic?.retryAfterMs, 2000);
  assert.doesNotMatch(sanitizeAgentServerError('api_key=sk-secret1234567890'), /sk-secret/);
  assert.equal(normalizeRuntimeVerificationResults({ verdict: 'unverified', reason: 'smoke' })[0]?.critique, 'smoke');
  assert.deepEqual(selectedComponentIdsForRequest(request), ['report-viewer', 'paper-card-list']);
  assert.deepEqual(expectedArtifactSchema(request), { types: ['research-report', 'paper-list'] });

  const tree = await workspaceTreeSummary(workspace);
  assert.ok(tree.some((entry) => entry.path === 'report.md'));
  assert.ok(tree.some((entry) => entry.path === '.bioagent-artifact-root-marker.txt'));
  assert.ok(!tree.some((entry) => entry.path === '.bioagent' || entry.path.startsWith('.bioagent/')));
  assert.ok(tree.some((entry) => entry.path === '.sciforge/artifacts'));
  assert.ok(!tree.some((entry) => entry.path.startsWith('.sciforge/artifacts/')));

  const envelope = buildContextEnvelope(request, { workspace, workspaceTreeSummary: tree });
  assert.equal(envelope.version, 'sciforge.context-envelope.v1');
  assert.equal(envelope.mode, 'delta');
  assert.deepEqual(envelope.scenarioFacts.expectedArtifactTypes, ['research-report', 'paper-list']);
  assert.equal(envelope.sessionFacts.conversationLedger?.totalTurns, 20);
  assert.equal(envelope.sessionFacts.conversationLedger?.omittedPrefixTurns, 2);
  assert.equal((envelope.sessionFacts.contextReusePolicy as Record<string, unknown> | undefined)?.mode, 'stable-ledger-plus-recent-window');

  const normalizedArtifacts = await normalizeArtifactsForPayload([{
    id: 'research-report',
    type: 'research-report',
    path: 'report.md',
  }], workspace, {
    taskRel: '.sciforge/tasks/task.py',
    outputRel: '.sciforge/task-results/task.json',
    stdoutRel: '.sciforge/logs/task.stdout.log',
    stderrRel: '.sciforge/logs/task.stderr.log',
  });
  assert.equal((normalizedArtifacts[0].data as Record<string, unknown>).markdown, '## Summary\nGateway split smoke passed.\n');

  const persisted = await persistArtifactRefsForPayload(workspace, request, normalizedArtifacts, {
    taskRel: '.sciforge/tasks/task.py',
    outputRel: '.sciforge/task-results/task.json',
    stdoutRel: '.sciforge/logs/task.stdout.log',
    stderrRel: '.sciforge/logs/task.stderr.log',
  });
  const artifactRef = String((persisted[0].metadata as Record<string, unknown>).artifactRef);
  assert.match(artifactRef, /^\.sciforge\/artifacts\/session-gateway-research-report-research-report-/);
  assert.match(await readFile(join(workspace, artifactRef), 'utf8'), /Gateway split smoke passed/);

  const directPayload = coerceAgentServerToolPayload({
    message: 'Direct answer',
    artifacts: [{ id: 'research-report', type: 'research-report' }],
  });
  assert.equal(directPayload?.message, 'Direct answer');
  assert.equal(directPayload?.uiManifest[0].componentId, 'report-viewer');

  const generation = parseGenerationResponse({
    taskFiles: [{ path: '.sciforge/tasks/task.py', content: 'print(1)' }],
    entrypoint: 'python .sciforge/tasks/task.py --flag',
    expectedArtifacts: [{ type: 'research-report' }],
  });
  assert.equal(generation?.entrypoint.path, '.sciforge/tasks/task.py');
  assert.deepEqual(generation?.entrypoint.args, ['--flag']);

  const normalizedEvent = withRequestContextWindowLimit(normalizeAgentServerWorkspaceEvent({
    type: 'context_compressor',
    backend: 'hermes-agent',
    usage: { input: 120, output: 30, cacheRead: 12, provider: 'hermes', model: 'smoke-model' },
    context_compressor: {
      used_tokens: 820,
      status: 'warning',
      source: 'agentserver-estimate',
      compactCapability: 'agentserver',
      last_compacted_at: '2026-05-07T00:00:00.000Z',
    },
    rate_limit: { rate_limited: true, retry_after_ms: 1500, rate_limit_reset_at: '2026-05-07T00:01:00.000Z' },
  }), { ...request, maxContextWindowTokens: 1000 });
  assert.equal(normalizedEvent.type, 'contextCompaction');
  assert.equal(normalizedEvent.usage?.input, 120);
  assert.equal(normalizedEvent.contextWindowState?.windowTokens, 1000);
  assert.equal(normalizedEvent.contextWindowState?.status, 'near-limit');
  assert.equal(normalizedEvent.contextCompaction?.status, 'completed');
  assert.equal(normalizedEvent.rateLimit?.resetAt, '2026-05-07T00:01:00.000Z');

  const skill: SkillAvailability = {
    id: 'agentserver.generation.literature',
    kind: 'installed',
    available: true,
    reason: 'smoke',
    checkedAt: new Date().toISOString(),
    manifestPath: 'agentserver',
    manifest: {
      id: 'agentserver.generation.literature',
      kind: 'installed',
      description: 'smoke',
      skillDomains: ['literature'],
      inputContract: {},
      outputArtifactSchema: {},
      entrypoint: { type: 'agentserver-generation' },
      environment: {},
      validationSmoke: {},
      examplePrompts: [],
      promotionHistory: [],
    },
  };
  const repair = repairNeededPayload(request, skill, 'AgentServer base URL missing', {}, { scenarioPackageId: 'smoke' });
  assert.equal(repair.executionUnits[0].status, 'repair-needed');
  assert.ok(String(repair.executionUnits[0].params).includes('AgentServer base URL missing'));

  const generatedPayload = await runAgentServerGeneratedTask(request, skill, [skill], {}, {
    readConfiguredAgentServerBaseUrl: async () => 'http://agentserver.local',
    requestAgentServerGeneration: async () => ({
      ok: true,
      runId: 'runner-smoke-run',
      response: {
        taskFiles: [{
          path: '.sciforge/tasks/runner-smoke.py',
          language: 'python',
          content: [
            'import json, sys',
            '_, input_path, output_path = sys.argv',
            'payload = {',
            '  "message": "Generated runner smoke passed.",',
            '  "confidence": 0.9,',
            '  "claimType": "fact",',
            '  "evidenceLevel": "runtime",',
            '  "reasoningTrace": "generated-task-runner smoke",',
            '  "claims": [{"text": "runner executed", "confidence": 0.9}],',
            '  "uiManifest": [{"componentId": "report-viewer", "artifactRef": "runner-report"}],',
            '  "executionUnits": [{"id": "runner", "status": "done", "tool": "python"}],',
            '  "artifacts": [{"id": "runner-report", "type": "research-report", "data": {"markdown": "## Runner smoke"}}]',
            '}',
            'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
          ].join('\n'),
        }],
        entrypoint: { language: 'python', path: '.sciforge/tasks/runner-smoke.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['research-report'],
        patchSummary: 'runner smoke task',
      },
    }),
    agentServerGenerationFailureReason: (error) => error,
    attemptPlanRefs: () => ({ scenarioPackageRef: request.scenarioPackageRef }),
    repairNeededPayload: (req, selectedSkill, reason) => repairNeededPayload(req, selectedSkill, reason),
    agentServerFailurePayloadRefs: () => ({}),
    ensureDirectAnswerReportArtifact: (payload) => payload,
    mergeReusableContextArtifactsForDirectPayload: async (payload) => payload,
    validateAndNormalizePayload: async (payload, _req, selectedSkill, refs): Promise<ToolPayload> => ({
      ...payload,
      reasoningTrace: `${payload.reasoningTrace}\nSkill: ${selectedSkill.id}\nRuntime gateway refs: taskCodeRef=${refs.taskRel}, outputRef=${refs.outputRel}`,
      executionUnits: payload.executionUnits.map((unit) => ({ ...unit, skillId: selectedSkill.id, outputRef: refs.outputRel })),
      logs: [{ kind: 'stdout', ref: refs.stdoutRel }, { kind: 'stderr', ref: refs.stderrRel }],
    }),
    tryAgentServerRepairAndRerun: async () => undefined,
    failedTaskPayload: (req, selectedSkill, _run, reason) => repairNeededPayload(req, selectedSkill, reason || 'failed'),
    coerceWorkspaceTaskPayload: (value) => coerceAgentServerToolPayload(value),
    schemaErrors: (payload) => {
      const record = payload as Record<string, unknown>;
      return ['message', 'claims', 'uiManifest', 'executionUnits', 'artifacts'].filter((key) => !(key in record)).map((key) => `missing ${key}`);
    },
    firstPayloadFailureReason: () => undefined,
    payloadHasFailureStatus: () => false,
  });
  assert.equal(generatedPayload?.message, 'Generated runner smoke passed.');
  assert.match(generatedPayload?.reasoningTrace ?? '', /AgentServer generation run: runner-smoke-run/);
  assert.equal(generatedPayload?.executionUnits[0]?.agentServerGenerated, true);
  const runnerAttemptId = String(generatedPayload?.executionUnits[0]?.outputRef || '').match(/generated-literature-[^.]+/)?.[0];
  assert.ok(runnerAttemptId, 'generated runner should expose output ref containing task id');
  const runnerAttempts = await readTaskAttempts(workspace, runnerAttemptId);
  assert.equal(runnerAttempts[0]?.status, 'done');

  const unverified = await applyRuntimeVerificationPolicy({
    message: 'Low risk answer',
    confidence: 0.8,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'trace',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'EU-low', status: 'done', tool: 'analysis.task', params: '{}' }],
    artifacts: [],
  }, request);
  assert.equal(unverified.verificationResults?.[0].verdict, 'unverified');
  assert.ok(unverified.artifacts.some((artifact) => artifact.type === 'verification-result'));
  const verificationRef = String(unverified.artifacts.find((artifact) => artifact.type === 'verification-result')?.dataRef);
  assert.match(await readFile(join(workspace, verificationRef), 'utf8'), /"verdict": "unverified"/);

  const highRiskRequest = normalizeGatewayRequest({
    skillDomain: 'knowledge',
    prompt: 'Publish this external update',
    workspacePath: workspace,
    verificationPolicy: { required: true, mode: 'hybrid', riskLevel: 'high', reason: 'external side effect' },
  });
  assert.equal(normalizeRuntimeVerificationPolicy(highRiskRequest).riskLevel, 'high');
  const gated = await applyRuntimeVerificationPolicy({
    message: 'Provider says action completed',
    confidence: 0.9,
    claimType: 'execution',
    evidenceLevel: 'provider',
    reasoningTrace: 'action provider self-report',
    claims: [],
    uiManifest: [],
    executionUnits: [{
      id: 'EU-high',
      status: 'done',
      tool: 'external.action-provider',
      params: JSON.stringify({ action: 'publish' }),
    }],
    artifacts: [],
  }, highRiskRequest);
  assert.equal(gated.verificationResults?.[0].verdict, 'needs-human');
  assert.equal(gated.executionUnits[0].status, 'needs-human');
  assert.match(gated.message, /Verification: needs-human/);

  console.log('[ok] runtime gateway modules expose request/context/payload/artifact/repair boundaries');
} finally {
  await rm(workspace, { recursive: true, force: true });
}
