import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContextEnvelope, expectedArtifactSchema, workspaceTreeSummary } from '../../src/runtime/gateway/context-envelope.js';
import { normalizeGatewayRequest, selectedComponentIdsForRequest } from '../../src/runtime/gateway/gateway-request.js';
import { runAgentServerGeneratedTask } from '../../src/runtime/gateway/generated-task-runner.js';
import { agentServerAgentId, currentTurnReferences } from '../../src/runtime/gateway/agentserver-context-window.js';
import { agentServerBackend } from '../../src/runtime/gateway/agent-backend-config.js';
import { materializeBackendPayloadOutput, normalizeArtifactsForPayload, persistArtifactRefsForPayload } from '../../src/runtime/gateway/artifact-materializer.js';
import { classifyAgentServerBackendFailure, sanitizeAgentServerError } from '../../src/runtime/gateway/backend-failure-diagnostics.js';
import { coerceAgentServerToolPayload, coerceWorkspaceTaskPayload } from '../../src/runtime/gateway/direct-answer-payload.js';
import { repairNeededPayload, validateAndNormalizePayload } from '../../src/runtime/gateway/payload-validation.js';
import { parseGenerationResponse } from '../../src/runtime/gateway/agentserver-run-output.js';
import { attemptPlanRefs, runtimeProfileIdForRequest, selectedRuntimeForSkill } from '../../src/runtime/gateway/runtime-routing.js';
import { applyRuntimeVerificationPolicy, normalizeRuntimeVerificationPolicy } from '../../src/runtime/gateway/verification-policy.js';
import { normalizeRuntimeVerificationResults } from '../../src/runtime/gateway/verification-results.js';
import { normalizeAgentServerWorkspaceEvent, normalizeWorkspaceProcessEvents, withRequestContextWindowLimit } from '../../src/runtime/gateway/workspace-event-normalizer.js';
import { applyConversationPolicy } from '../../src/runtime/conversation-policy/apply.js';
import { buildAgentServerRepairPrompt } from '../../src/runtime/gateway/agentserver-prompts.js';
import { readTaskAttempts } from '../../src/runtime/task-attempt-history.js';
import type { SkillAvailability, ToolPayload } from '../../src/runtime/runtime-types.js';
import { makeGeneratedTaskRunnerDeps, runtimeGatewaySkill } from './runtime-gateway-runner-fixtures.js';

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
  assert.equal(request.verificationPolicy, undefined);
  assert.deepEqual(
    (request.uiState?.ignoredLegacyVerificationPolicySources as Array<Record<string, unknown>> | undefined)?.map((entry) => entry.source),
    ['request.verificationPolicy'],
  );
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

  const repairPrompt = buildAgentServerRepairPrompt({
    request,
    skill: {
      id: 'literature-agentserver-generation',
      kind: 'workspace',
      available: true,
      reason: 'smoke',
      checkedAt: '2026-05-09T00:00:00.000Z',
      manifestPath: 'agentserver://literature',
      manifest: { id: 'literature-agentserver-generation', description: 'smoke', entrypoint: { type: 'agentserver' } },
    } as unknown as SkillAvailability,
    run: {
      workspace,
      spec: { id: 'repair-smoke', language: 'python', entrypoint: '.sciforge/tasks/repair.py', taskRel: '.sciforge/tasks/repair.py' },
      outputRef: '.sciforge/task-results/repair.json',
      stdoutRef: '.sciforge/logs/repair.stdout.log',
      stderrRef: '.sciforge/logs/repair.stderr.log',
      exitCode: 0,
      stdout: '',
      stderr: '',
      runtimeFingerprint: {},
    } as any,
    schemaErrors: ['uiManifest[0].componentId must be a non-empty string'],
    failureReason: 'AgentServer repair rerun output failed schema validation: uiManifest[0].componentId must be a non-empty string',
    priorAttempts: [],
    repairContext: {
      agentHarnessHandoff: {
        repairContextPolicy: {
          kind: 'repair-rerun',
          maxAttempts: 1,
          includeStdoutSummary: true,
          includeValidationFindings: true,
          allowedFailureEvidenceRefs: ['stderr:repair-smoke'],
        },
      },
    },
  });
  assert.match(repairPrompt, /minimalValidToolPayload/);
  assert.match(repairPrompt, /componentId/);
  assert.match(repairPrompt, /artifactRef/);
  assert.match(repairPrompt, /repairContextPolicySummary/);
  assert.match(repairPrompt, /stderr:repair-smoke/);

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
  assert.match(
    artifactRef,
    /^\.sciforge\/sessions\/\d{4}-\d{2}-\d{2}_literature_session-gateway\/artifacts\/research-report-research-report-/,
  );
  assert.match(await readFile(join(workspace, artifactRef), 'utf8'), /Gateway split smoke passed/);

  const materializedBackend = await materializeBackendPayloadOutput(workspace, request, {
    message: 'Backend output materialized.',
    confidence: 0.9,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'materializer smoke',
    claims: [],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 'backend-report' }],
    executionUnits: [{ id: 'backend-run', status: 'done', tool: 'agentserver.backend' }],
    artifacts: [{
      id: 'backend-report',
      type: 'research-report',
      data: { markdown: '## Backend Report\nStable markdown ref.' },
    }],
  }, {
    taskRel: 'agentserver://direct-payload',
    outputRel: '.sciforge/task-results/backend-materialized-smoke.json',
    stdoutRel: '.sciforge/logs/backend-materialized-smoke.stdout.log',
    stderrRel: '.sciforge/logs/backend-materialized-smoke.stderr.log',
  });
  const materializedArtifact = materializedBackend.artifacts[0];
  const materializedMetadata = materializedArtifact.metadata as Record<string, unknown>;
  assert.equal(materializedArtifact.dataRef, '.sciforge/task-results/backend-materialized-smoke-backend-report.md');
  assert.equal(materializedMetadata.outputRef, '.sciforge/task-results/backend-materialized-smoke.json');
  assert.equal(materializedMetadata.reportRef, '.sciforge/task-results/backend-materialized-smoke-backend-report.md');
  assert.ok(materializedBackend.objectReferences?.some((reference) => reference.ref === 'file:.sciforge/task-results/backend-materialized-smoke.json'));
  assert.match(await readFile(join(workspace, '.sciforge/task-results/backend-materialized-smoke.json'), 'utf8'), /materializedOutputRef/);
  assert.match(await readFile(join(workspace, '.sciforge/task-results/backend-materialized-smoke-backend-report.md'), 'utf8'), /Stable markdown ref/);

  const directPayload = coerceAgentServerToolPayload({
    message: 'Direct answer',
    artifacts: [{ id: 'research-report', type: 'research-report' }],
  });
  assert.equal(directPayload?.message, 'Direct answer');
  assert.equal(directPayload?.uiManifest[0].componentId, 'report-viewer');

  const aliasedManifestPayload = coerceWorkspaceTaskPayload({
    message: 'arXiv retrieval hit a provider error and returned auditable artifacts.',
    confidence: 0,
    claimType: 'error',
    evidenceLevel: 'none',
    reasoningTrace: ['queried arXiv API', 'provider returned HTTP 500'],
    claims: [{ text: 'arXiv provider returned HTTP 500', confidence: 0 }],
    displayIntent: 'show-report',
    uiManifest: [
      { component: 'report-viewer', props: { artifactType: 'research-report' } },
      { component: 'paper-card-list', props: { artifactType: 'paper-list' } },
    ],
    executionUnits: [{ id: 'arxiv-search', status: 'failed-with-reason', failureReason: 'HTTP 500' }],
    artifacts: [
      { id: 'paper-list', type: 'paper-list', content: '[]' },
      { id: 'research-report', type: 'research-report', content: '# Error' },
    ],
  });
  assert.equal(aliasedManifestPayload?.uiManifest[0].componentId, 'report-viewer');
  assert.equal(aliasedManifestPayload?.uiManifest[0].artifactRef, 'research-report');
  assert.equal(aliasedManifestPayload?.uiManifest[1].componentId, 'paper-card-list');
  assert.equal(aliasedManifestPayload?.uiManifest[1].artifactRef, 'paper-list');
  assert.equal(aliasedManifestPayload?.reasoningTrace, 'queried arXiv API\nprovider returned HTTP 500');
  assert.equal((aliasedManifestPayload?.artifacts.find((artifact) => artifact.id === 'research-report')?.data as { markdown?: string } | undefined)?.markdown, '# Error');

  const malformedPayload = coerceWorkspaceTaskPayload({
    message: '搜索到 2 条结果。',
    claims: [],
    uiManifest: { type: 'list', items: [{ title: 'Result A', url: 'https://example.test/a' }, { title: 'Result B' }] },
    executionUnits: [{ id: 'search', status: 'done' }],
    artifacts: [],
  });
  assert.equal(malformedPayload, undefined);

  const generation = parseGenerationResponse({
    taskFiles: [{ path: '.sciforge/tasks/task.py', content: 'print(1)' }],
    entrypoint: { language: 'python', path: '.sciforge/tasks/task.py', command: 'python .sciforge/tasks/task.py --flag' },
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

  const processProgress = normalizeWorkspaceProcessEvents([
    { type: 'tool-call', toolName: 'read_file', detail: '{"path":"/workspace/input/papers.csv"}' },
    { type: 'tool-call', toolName: 'write_file', detail: '{"path":"/workspace/tasks/review.py","content":"print(1)"}' },
    { type: 'backend-silent', message: 'AgentServer 45s 没有输出新事件，HTTP stream still waiting.' },
  ]);
  assert.equal(processProgress.schemaVersion, 'sciforge.process-events.v1');
  assert.equal(processProgress.current?.phase, 'wait');
  assert.equal(processProgress.current?.waitingFor, 'AgentServer 返回');
  assert.deepEqual(processProgress.timeline[0].reading, ['/workspace/input/papers.csv']);
  assert.deepEqual(processProgress.timeline[1].writing, ['/workspace/tasks/review.py']);
  assert.ok(processProgress.events.every((event) => event.type === 'process-progress'));

  const skill = runtimeGatewaySkill();
  const agentServerRuntimeProfileId = `agentserver-${agentServerBackend(request, request.llmEndpoint)}`;
  assert.equal(runtimeProfileIdForRequest(request, skill), agentServerRuntimeProfileId);
  assert.equal(selectedRuntimeForSkill(skill), 'agentserver-generation');
  const routingRefs = attemptPlanRefs(request, skill, 'smoke fallback');
  assert.deepEqual(routingRefs.routeDecision, {
    selectedSkill: 'agentserver.generation.literature',
    selectedRuntime: 'agentserver-generation',
    fallbackReason: 'smoke fallback',
    selectedAt: routingRefs.routeDecision.selectedAt,
  });
  assert.equal(typeof routingRefs.routeDecision.selectedAt, 'string');

  const markdownSkill: SkillAvailability = {
    ...skill,
    id: 'scp.markdown-smoke',
    manifest: {
      ...skill.manifest,
      id: 'scp.markdown-smoke',
      entrypoint: { type: 'markdown-skill' },
    },
  };
  assert.equal(runtimeProfileIdForRequest(request, markdownSkill), agentServerRuntimeProfileId);
  assert.equal(selectedRuntimeForSkill(markdownSkill), 'agentserver-markdown-skill');

  const brokerEnvelope = buildContextEnvelope({
    ...request,
    prompt: 'Read the report artifact, validate its schema, render markdown, and inspect the screenshot with vision if needed.',
    verificationPolicy: {
      required: true,
      mode: 'hybrid',
      riskLevel: 'high',
      reason: 'harness-projected verifier requirement',
      selectedVerifierIds: ['verifier.schema'],
    },
    references: [{
      ref: 'artifact:prior-report',
      kind: 'artifact',
      artifactType: 'research-report',
      title: 'Prior report',
    }],
    selectedToolIds: ['observe.vision'],
    selectedSenseIds: ['observe.vision'],
    selectedComponentIds: ['report-viewer'],
    selectedVerifierIds: ['verifier.schema'],
    uiState: {
      ...request.uiState,
      capabilityBrokerPolicy: {
        preferredCapabilityIds: ['verifier.schema'],
      },
    },
  }, {
    workspace,
    workspaceTreeSummary: [],
    priorAttempts: [],
    selectedSkill: skill,
    mode: 'full',
  });
  const brokerBrief = (brokerEnvelope.scenarioFacts as Record<string, unknown>).capabilityBrokerBrief as Record<string, unknown>;
  const brokerBriefText = JSON.stringify(brokerBrief);
  assert.equal(brokerBrief.schemaVersion, 'sciforge.agentserver.capability-broker-brief.v1');
  assert.equal(brokerBrief.contract, 'sciforge.capability-broker-output.v1');
  assert.match(brokerBriefText, /view\.report/);
  assert.match(brokerBriefText, /observe\.vision/);
  assert.deepEqual((brokerEnvelope.scenarioFacts as Record<string, unknown>).selectedVerifierIds, ['verifier.schema']);
  assert.equal(brokerBriefText.includes('sciforge.runtime-capability-catalog.v1'), false);

  const currentReferenceRequest = {
    ...request,
    uiState: {
      ...request.uiState,
      currentReferences: [{
        kind: 'file',
        title: 'current-input.pdf',
        ref: 'file:.sciforge/uploads/current-input.pdf',
        summary: 'Current turn uploaded file.',
      }],
    },
  };
  assert.equal(currentTurnReferences(currentReferenceRequest).length, 1);
  assert.notEqual(
    agentServerAgentId(request, 'task-generation'),
    agentServerAgentId(currentReferenceRequest, 'task-generation'),
    'current-turn references should get an isolated AgentServer session scope',
  );
  assert.notEqual(
    agentServerAgentId(currentReferenceRequest, 'task-generation'),
    agentServerAgentId({
      ...currentReferenceRequest,
      uiState: {
        ...currentReferenceRequest.uiState,
        conversationLedger: {
          tail: [{
            id: 'msg-new-current-reference-turn',
            role: 'user',
            contentPreview: 'Summarize the uploaded report',
          }],
        },
      },
    }, 'task-generation'),
    'fresh current-reference turns should not reuse previous AgentServer session memory for the same file',
  );
  const digestRequest = (await applyConversationPolicy(normalizeGatewayRequest({
    ...request,
    uiState: {
      ...request.uiState,
      currentReferences: [{ kind: 'file', title: 'report.md', ref: 'file:report.md' }],
    },
  }), {}, {
    workspace,
    config: {
      mode: 'active',
      command: 'python3',
      args: ['-m', 'sciforge_conversation.service'],
      timeoutMs: 5000,
      pythonPath: join(process.cwd(), 'packages/reasoning/conversation-policy/src'),
    },
  })).request;
  const digests = (digestRequest.uiState as Record<string, unknown>).currentReferenceDigests as Array<Record<string, unknown>>;
  assert.equal(digests.length, 1);
  assert.equal(digests[0].status, 'ok');
  assert.ok(String(digests[0].digestText || '').length > 0);
  const digestEnvelope = buildContextEnvelope(digestRequest, { workspace, workspaceTreeSummary: tree });
  assert.ok(Array.isArray(digestEnvelope.sessionFacts.currentReferenceDigests));
  const missingReferenceUse = await validateAndNormalizePayload({
    message: 'Generated a report.',
    confidence: 0.8,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'runtime smoke',
    claims: [],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 'research-report' }],
    executionUnits: [{ id: 'runtime-smoke', status: 'done', tool: 'smoke' }],
    artifacts: [{ id: 'research-report', type: 'research-report', data: { markdown: 'Report content without the current reference.' } }],
  }, currentReferenceRequest, skill, {
    taskRel: '.sciforge/tasks/reference-smoke.py',
    outputRel: '.sciforge/task-results/reference-smoke.json',
    stdoutRel: '.sciforge/logs/reference-smoke.stdout.log',
    stderrRel: '.sciforge/logs/reference-smoke.stderr.log',
    runtimeFingerprint: { runtime: 'smoke' },
  });
  assert.ok(missingReferenceUse);
  assert.ok(missingReferenceUse.executionUnits.some((unit) =>
    unit.status === 'failed-with-reason'
    && String('failureReason' in unit ? unit.failureReason : '').includes('Current-turn reference was not reflected')
  ));

  const reflectedReferenceUse = await validateAndNormalizePayload({
    message: 'Generated a report from current-input.pdf.',
    confidence: 0.8,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'runtime smoke',
    claims: [],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 'research-report' }],
    executionUnits: [{ id: 'runtime-smoke', status: 'done', tool: 'smoke' }],
    artifacts: [{ id: 'research-report', type: 'research-report', data: { markdown: 'Report based on current-input.pdf.' } }],
  }, currentReferenceRequest, skill, {
    taskRel: '.sciforge/tasks/reference-smoke-ok.py',
    outputRel: '.sciforge/task-results/reference-smoke-ok.json',
    stdoutRel: '.sciforge/logs/reference-smoke-ok.stdout.log',
    stderrRel: '.sciforge/logs/reference-smoke-ok.stderr.log',
    runtimeFingerprint: { runtime: 'smoke' },
  });
  assert.ok(reflectedReferenceUse);
  assert.ok(!reflectedReferenceUse.executionUnits.some((unit) => unit.status === 'failed-with-reason'));

  const uploadPathReferenceUse = await validateAndNormalizePayload({
    message: 'Generated a CellPulse paper report.',
    confidence: 0.8,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'runtime smoke',
    claims: [],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 'research-report' }],
    executionUnits: [{ id: 'runtime-smoke', status: 'done', tool: 'smoke' }],
    artifacts: [{ id: 'research-report', type: 'research-report', data: { markdown: '# CellPulse report\n\nSummary based on the uploaded paper.' } }],
  }, {
    ...request,
    uiState: {
      ...request.uiState,
      currentReferences: [{
        kind: 'file',
        title: 'CellPulse.pdf',
        ref: '.sciforge/uploads/session-literature/upload-mov3dd8l-eufu1k-CellPulse.pdf',
        summary: 'Current turn uploaded file.',
      }],
    },
  }, skill, {
    taskRel: '.sciforge/tasks/reference-upload-stem-smoke.py',
    outputRel: '.sciforge/task-results/reference-upload-stem-smoke.json',
    stdoutRel: '.sciforge/logs/reference-upload-stem-smoke.stdout.log',
    stderrRel: '.sciforge/logs/reference-upload-stem-smoke.stderr.log',
    runtimeFingerprint: { runtime: 'smoke' },
  });
  assert.ok(uploadPathReferenceUse);
  assert.ok(!uploadPathReferenceUse.executionUnits.some((unit) => unit.status === 'failed-with-reason'));

  const repair = repairNeededPayload(request, skill, 'AgentServer base URL missing', {});
  assert.equal(repair.executionUnits[0].status, 'repair-needed');
  assert.ok(String(repair.executionUnits[0].params).includes('AgentServer base URL missing'));
  assert.equal(repair.artifacts[0]?.id, 'literature-runtime-result');
  assert.equal(repair.artifacts[0]?.type, 'runtime-diagnostic');
  assert.equal(repair.uiManifest[0]?.artifactRef, 'literature-runtime-result');

  const generatedPayload = await runAgentServerGeneratedTask(request, skill, [skill], {}, makeGeneratedTaskRunnerDeps({
    request,
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
            '  "artifacts": [{"id": "runner-report", "type": "research-report", "schema": {"type": "object"}, "data": {"markdown": "## Runner smoke"}}]',
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
  }));
  assert.equal(generatedPayload?.message, 'Generated runner smoke passed.');
  assert.match(generatedPayload?.reasoningTrace ?? '', /AgentServer generation run: runner-smoke-run/);
  assert.equal(generatedPayload?.executionUnits[0]?.agentServerGenerated, true);
  const runnerOutputRef = String(generatedPayload?.executionUnits[0]?.outputRef || '');
  const runnerAttemptId = runnerOutputRef.match(/generated-literature-[^.]+/)?.[0];
  assert.ok(runnerAttemptId, 'generated runner should expose output ref containing task id');
  assert.match(runnerOutputRef, /^\.sciforge\/sessions\/.+\/task-results\/generated-literature-.*\.json$/);
  assert.match(await readFile(join(workspace, runnerOutputRef), 'utf8'), /runner-report/);
  const generatedTaskDebit = generatedPayload?.budgetDebits?.find((debit) => debit.capabilityId === 'sciforge.generated-task-runner');
  assert.ok(generatedTaskDebit, 'successful generated task should emit a capability budget debit');
  assert.equal(generatedTaskDebit.sinkRefs.executionUnitRef, 'runner');
  assert.ok(generatedTaskDebit.sinkRefs.workEvidenceRefs.some((ref) => ref.includes('generated-task:')));
  assert.ok(generatedTaskDebit.sinkRefs.auditRefs.some((ref) => ref.startsWith('audit:capability-budget-debit:generated-task:')));
  assert.ok(hasBudgetDebitRef(generatedPayload?.executionUnits[0], generatedTaskDebit.debitId));
  assert.ok(generatedPayload?.workEvidence?.some((entry) => hasBudgetDebitRef(entry, generatedTaskDebit.debitId)));
  assert.ok(generatedPayload?.logs?.some((entry) => hasBudgetDebitRef(entry, generatedTaskDebit.debitId)));
  const runnerAttempts = await readTaskAttempts(workspace, runnerAttemptId);
  assert.equal(runnerAttempts[0]?.status, 'done');
  assert.ok(hasBudgetDebitRef(runnerAttempts[0], generatedTaskDebit.debitId));

  let emptyRetrievalRepairCalled = false;
  let emptyRetrievalTaskId = '';
  const arxivEmptyRequest = {
    ...request,
    prompt: '帮我调研最近一周 arXiv 上 agent 相关论文和研究趋势',
  };
  const emptyRetrievalPayload = await runAgentServerGeneratedTask(arxivEmptyRequest, skill, [skill], {}, makeGeneratedTaskRunnerDeps({
    request: arxivEmptyRequest,
    requestAgentServerGeneration: async () => ({
      ok: true,
      runId: 'runner-empty-arxiv-run',
      response: {
        taskFiles: [{
          path: '.sciforge/tasks/runner-empty-arxiv.py',
          language: 'python',
          content: [
            'import json, sys',
            '_, input_path, output_path = sys.argv',
            'payload = {',
            '  "message": "共检索到 **0** 篇与 Agent 相关的论文。",',
            '  "confidence": 0.9,',
            '  "claimType": "literature_survey",',
            '  "evidenceLevel": "high",',
            '  "reasoningTrace": "Queried arXiv API. Retrieved 0 papers.",',
            '  "claims": [{"text": "最近一周 arXiv 上有 0 篇 Agent 相关论文", "confidence": 0.9}],',
            '  "uiManifest": [{"componentId": "report-viewer", "artifactRef": "empty-arxiv-report"}],',
            '  "executionUnits": [{"id": "fetch-arxiv", "status": "done", "tool": "arxiv-api"}],',
            '  "artifacts": [{"id": "empty-arxiv-report", "type": "research-report", "schema": {"type": "object"}, "data": {"markdown": "Retrieved 0 papers from arXiv."}}]',
            '}',
            'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
          ].join('\n'),
        }],
        entrypoint: { language: 'python', path: '.sciforge/tasks/runner-empty-arxiv.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['research-report'],
        patchSummary: 'empty arxiv retrieval should require diagnosis',
      },
    }),
    tryAgentServerRepairAndRerun: async (_params) => {
      emptyRetrievalRepairCalled = true;
      emptyRetrievalTaskId = _params.taskId;
      assert.match(_params.failureReason, /External retrieval returned zero results/);
      return repairNeededPayload(arxivEmptyRequest, skill, _params.failureReason);
    },
  }));
  assert.equal(emptyRetrievalRepairCalled, true);
  assert.equal(emptyRetrievalPayload?.executionUnits[0]?.status, 'repair-needed');
  assert.match(emptyRetrievalPayload?.message ?? '', /External retrieval returned zero results/);
  assert.equal((emptyRetrievalPayload?.executionUnits[0]?.refs as { validationFailure?: { failureKind?: string } } | undefined)?.validationFailure?.failureKind, 'work-evidence');
  const emptyRetrievalAttempt = await readTaskAttempts(workspace, emptyRetrievalTaskId);
  assert.equal(emptyRetrievalAttempt[0]?.status, 'repair-needed');
  assert.match(emptyRetrievalAttempt[0]?.failureReason ?? '', /External retrieval returned zero results/);
  assert.match(emptyRetrievalAttempt[0]?.codeRef ?? '', /runner-empty-arxiv/);
  assert.match(emptyRetrievalAttempt[0]?.outputRef ?? '', /^\.sciforge\/sessions\/.+\/task-results\/generated-literature-/);
  assert.match(emptyRetrievalAttempt[0]?.stdoutRef ?? '', /^\.sciforge\/sessions\/.+\/logs\/generated-literature-/);
  assert.match(emptyRetrievalAttempt[0]?.stderrRef ?? '', /^\.sciforge\/sessions\/.+\/logs\/generated-literature-/);

  let providerDiagnosticsRepairCalled = false;
  const providerDiagnosticsPayload = await runAgentServerGeneratedTask(arxivEmptyRequest, skill, [skill], {}, makeGeneratedTaskRunnerDeps({
    request: arxivEmptyRequest,
    requestAgentServerGeneration: async () => ({
      ok: true,
      runId: 'runner-empty-provider-diagnostics-run',
      response: {
        taskFiles: [{
          path: '.sciforge/tasks/runner-empty-provider-diagnostics.py',
          language: 'python',
          content: [
            'import json, sys',
            '_, input_path, output_path = sys.argv',
            'payload = {',
            '  "message": "Retrieved 0 papers; provider status 200; fallback query attempted.",',
            '  "confidence": 0.72,',
            '  "claimType": "literature_survey",',
            '  "evidenceLevel": "runtime",',
            '  "reasoningTrace": "Queried arXiv API. Retrieved 0 papers. Provider status 200. Fallback query attempted.",',
            '  "claims": [{"text": "No matching papers after documented provider and fallback checks", "confidence": 0.72}],',
            '  "uiManifest": [{"componentId": "report-viewer", "artifactRef": "empty-diagnostics-report"}],',
            '  "executionUnits": [{"id": "fetch-arxiv", "status": "done", "tool": "arxiv-api", "providerStatus": 200, "fallbackAttempted": True}],',
            '  "artifacts": [{"id": "empty-diagnostics-report", "type": "research-report", "schema": {"type": "object"}, "data": {"markdown": "Retrieved 0 papers with provider status and fallback diagnostics."}}]',
            '}',
            'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
          ].join('\n'),
        }],
        entrypoint: { language: 'python', path: '.sciforge/tasks/runner-empty-provider-diagnostics.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['research-report'],
        patchSummary: 'empty retrieval includes diagnostics',
      },
    }),
    tryAgentServerRepairAndRerun: async () => {
      providerDiagnosticsRepairCalled = true;
      return undefined;
    },
  }));
  assert.equal(providerDiagnosticsRepairCalled, false);
  assert.equal(providerDiagnosticsPayload?.executionUnits[0]?.status, 'done');

  const directPlanOnlyPayload = await runAgentServerGeneratedTask(request, skill, [skill], {}, makeGeneratedTaskRunnerDeps({
    request,
    useProductionPayloadValidation: true,
    requestAgentServerGeneration: async () => ({
      ok: true,
      runId: 'runner-direct-plan-only-run',
      directPayload: {
        message: 'I will retrieve the latest papers and analyze the results.',
        confidence: 0.9,
        claimType: 'fact',
        evidenceLevel: 'runtime',
        reasoningTrace: 'backend direct payload returned a plan sentence as completed',
        claims: [],
        uiManifest: [],
        executionUnits: [{ id: 'direct-plan-only', status: 'done', tool: 'agentserver.direct' }],
        artifacts: [],
      },
    }),
  }));
  assert.equal(directPlanOnlyPayload?.executionUnits[0]?.status, 'repair-needed');
  assert.match(directPlanOnlyPayload?.message ?? '', /completed payload/i);
  assert.ok((directPlanOnlyPayload?.executionUnits[0]?.recoverActions as string[] | undefined)?.some((action) => /promised retrieval\/analysis/.test(action)));

  let generatedPlanRepairCalled = false;
  const generatedPlanOnlyPayload = await runAgentServerGeneratedTask(request, skill, [skill], {}, makeGeneratedTaskRunnerDeps({
    request,
    useProductionPayloadValidation: true,
    requestAgentServerGeneration: async () => ({
      ok: true,
      runId: 'runner-generated-plan-only-run',
      response: {
        taskFiles: [{
          path: '.sciforge/tasks/runner-plan-only.py',
          language: 'python',
          content: [
            'import json, sys',
            '_, input_path, output_path = sys.argv',
            'payload = {',
            '  "message": "I will retrieve the latest papers and analyze the results.",',
            '  "confidence": 0.9,',
            '  "claimType": "fact",',
            '  "evidenceLevel": "runtime",',
            '  "reasoningTrace": "generated task wrote a plan sentence as completed",',
            '  "claims": [],',
            '  "uiManifest": [],',
            '  "executionUnits": [{"id": "generated-plan-only", "status": "done", "tool": "python"}],',
            '  "artifacts": []',
            '}',
            'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
          ].join('\n'),
        }],
        entrypoint: { language: 'python', path: '.sciforge/tasks/runner-plan-only.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['research-report'],
        patchSummary: 'plan-only generated payload must not complete',
      },
    }),
    tryAgentServerRepairAndRerun: async (_params) => {
      generatedPlanRepairCalled = true;
      assert.match(_params.failureReason, /only plan\/promise text/);
      return undefined;
    },
  }));
  assert.equal(generatedPlanRepairCalled, true);
  assert.equal(generatedPlanOnlyPayload?.executionUnits[0]?.status, 'repair-needed');
  assert.match(generatedPlanOnlyPayload?.message ?? '', /completed payload/i);
  assert.ok((generatedPlanOnlyPayload?.executionUnits[0]?.recoverActions as string[] | undefined)?.some((action) => /failed-with-reason|repair-needed/.test(action)));

  let commandFailedRepairCalled = false;
  let commandFailedTaskId = '';
  const commandFailedPayload = await runAgentServerGeneratedTask(request, skill, [skill], {}, makeGeneratedTaskRunnerDeps({
    request,
    requestAgentServerGeneration: async () => ({
      ok: true,
      runId: 'runner-command-failed-run',
      response: {
        taskFiles: [{
          path: '.sciforge/tasks/runner-command-failed.py',
          language: 'python',
          content: [
            'import json, sys',
            '_, input_path, output_path = sys.argv',
            'payload = {',
            '  "message": "Command completed successfully.",',
            '  "confidence": 0.91,',
            '  "claimType": "fact",',
            '  "evidenceLevel": "runtime",',
            '  "reasoningTrace": "A subcommand exited 1 but the payload still claimed success.",',
            '  "claims": [{"text": "subcommand passed", "confidence": 0.91}],',
            '  "uiManifest": [{"componentId": "report-viewer", "artifactRef": "command-report"}],',
            '  "executionUnits": [{"id": "subcommand", "status": "done", "tool": "shell", "exitCode": 1}],',
            '  "artifacts": [{"id": "command-report", "type": "research-report", "schema": {"type": "object"}, "data": {"markdown": "Subcommand claimed as successful."}}]',
            '}',
            'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
          ].join('\n'),
        }],
        entrypoint: { language: 'python', path: '.sciforge/tasks/runner-command-failed.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['research-report'],
        patchSummary: 'command failure evidence should require repair',
      },
    }),
    tryAgentServerRepairAndRerun: async (_params) => {
      commandFailedRepairCalled = true;
      commandFailedTaskId = _params.taskId;
      assert.match(_params.failureReason, /non-zero exitCode/);
      return repairNeededPayload(request, skill, _params.failureReason);
    },
  }));
  assert.equal(commandFailedRepairCalled, true);
  assert.equal(commandFailedPayload?.executionUnits[0]?.status, 'repair-needed');
  assert.equal((commandFailedPayload?.executionUnits[0]?.refs as { validationFailure?: { failureKind?: string; contractId?: string } } | undefined)?.validationFailure?.failureKind, 'work-evidence');
  assert.equal((commandFailedPayload?.executionUnits[0]?.refs as { validationFailure?: { contractId?: string } } | undefined)?.validationFailure?.contractId, 'sciforge.work-evidence.v1');
  const commandFailedAttempt = await readTaskAttempts(workspace, commandFailedTaskId);
  assert.equal(commandFailedAttempt[0]?.status, 'repair-needed');
  assert.match(commandFailedAttempt[0]?.failureReason ?? '', /non-zero exitCode/);

  let partialCheckpointRepairCalled = false;
  let partialCheckpointTaskId = '';
  const partialCheckpointPayload = await runAgentServerGeneratedTask(request, skill, [skill], {}, makeGeneratedTaskRunnerDeps({
    request,
    useProductionPayloadValidation: true,
    requestAgentServerGeneration: async () => ({
      ok: true,
      runId: 'runner-partial-checkpoint-run',
      response: {
        taskFiles: [{
          path: '.sciforge/tasks/runner-partial-checkpoint.py',
          language: 'python',
          content: [
            'import json, os, sys',
            '_, input_path, output_path = sys.argv',
            'root = os.environ.get("SCIFORGE_SESSION_RESOURCE_ROOT")',
            'downloads = os.path.join(root, "downloads")',
            'os.makedirs(downloads, exist_ok=True)',
            'with open(os.path.join(downloads, "agent-paper.pdf"), "wb") as f:',
            '    f.write(b"%PDF-1.4\\npartial pdf bytes\\n")',
            'meta = dict(title="Agent paper", status="downloaded-before-failure")',
            'with open(os.path.join(downloads, "agent-paper.metadata.json"), "w", encoding="utf-8") as f:',
            '    f.write(json.dumps(meta))',
            'print("downloaded partial PDF and metadata before simulated failure")',
            'raise SystemExit(3)',
          ].join('\n'),
        }],
        entrypoint: { language: 'python', path: '.sciforge/tasks/runner-partial-checkpoint.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['research-report', 'paper-list'],
        patchSummary: 'partial external fetch checkpoint smoke task',
      },
    }),
    tryAgentServerRepairAndRerun: async (_params) => {
      partialCheckpointRepairCalled = true;
      partialCheckpointTaskId = _params.taskId;
      assert.match(_params.failureReason, /Workspace task exited 3/);
      return undefined;
    },
  }));
  assert.equal(partialCheckpointRepairCalled, true, JSON.stringify({
    message: partialCheckpointPayload?.message,
    claimType: partialCheckpointPayload?.claimType,
    executionUnits: partialCheckpointPayload?.executionUnits,
    workEvidence: partialCheckpointPayload?.workEvidence,
  }));
  assert.equal(partialCheckpointPayload?.executionUnits[0]?.status, 'repair-needed');
  assert.equal(partialCheckpointPayload?.claimType, 'partial-checkpoint');
  const partialRefs = partialCheckpointPayload?.workEvidence?.[0]?.evidenceRefs ?? [];
  assert.ok(partialRefs.some((ref) => /downloads\/agent-paper\.pdf$/.test(ref)), 'partial checkpoint should preserve downloaded PDF ref');
  assert.ok(partialRefs.some((ref) => /downloads\/agent-paper\.metadata\.json$/.test(ref)), 'partial checkpoint should preserve metadata ref');
  const checkpointOutputRef = String(partialCheckpointPayload?.executionUnits[0]?.outputRef || '');
  assert.match(await readFile(join(workspace, checkpointOutputRef), 'utf8'), /sciforge\.partial-checkpoint\.v1/);
  const partialCheckpointAttempts = await readTaskAttempts(workspace, partialCheckpointTaskId);
  assert.equal(partialCheckpointAttempts[0]?.status, 'repair-needed');
  assert.match(partialCheckpointAttempts[0]?.outputRef ?? '', /^\.sciforge\/sessions\/.+\/task-results\/generated-literature-/);
  const attemptEvidenceRefs = partialCheckpointAttempts[0]?.workEvidenceSummary?.items.flatMap((item) => item.evidenceRefs) ?? [];
  assert.ok(
    attemptEvidenceRefs.some((ref) => /downloads\/agent-paper\.pdf$/.test(ref)),
    `attempt should retain partial PDF refs, got ${JSON.stringify(partialCheckpointAttempts[0]?.workEvidenceSummary)}`,
  );
  const taskRunCardPartialRefs = partialCheckpointAttempts[0]?.taskRunCard?.refs.map((ref) => ref.ref) ?? [];
  assert.ok(taskRunCardPartialRefs.some((ref) => /downloads\/agent-paper\.metadata\.json$/.test(ref)), 'failed run card should project partial metadata ref');

  const generatedReferencePayload = await runAgentServerGeneratedTask(currentReferenceRequest, skill, [skill], {}, makeGeneratedTaskRunnerDeps({
    request: currentReferenceRequest,
    requestAgentServerGeneration: async () => ({
      ok: true,
      runId: 'runner-current-ref-smoke-run',
      response: {
        taskFiles: [{
          path: '.sciforge/tasks/runner-current-ref-smoke.py',
          language: 'python',
          content: [
            'import json, sys',
            '_, input_path, output_path = sys.argv',
            'inp = json.load(open(input_path, encoding="utf-8"))',
            'refs = inp.get("uiStateSummary", {}).get("currentReferences", [])',
            'prior = inp.get("priorAttempts", [])',
            'ref_title = refs[0].get("title", "missing-ref") if refs else "missing-ref"',
            'payload = {',
            '  "message": f"Generated a report from {ref_title}; priorAttempts={len(prior)}.",',
            '  "confidence": 0.9,',
            '  "claimType": "fact",',
            '  "evidenceLevel": "runtime",',
            '  "reasoningTrace": "current-reference runner smoke",',
            '  "claims": [{"text": f"Current reference {ref_title} was used", "confidence": 0.9}],',
            '  "uiManifest": [{"componentId": "report-viewer", "artifactRef": "runner-reference-report"}],',
            '  "executionUnits": [{"id": "runner-current-reference", "status": "done", "tool": "python"}],',
            '  "artifacts": [{"id": "runner-reference-report", "type": "research-report", "schema": {"type": "object"}, "data": {"markdown": f"## Report based on {ref_title}\\n\\nPrior attempts visible: {len(prior)}"}}]',
            '}',
            'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
          ].join('\n'),
        }],
        entrypoint: { language: 'python', path: '.sciforge/tasks/runner-current-ref-smoke.py' },
        environmentRequirements: {},
        validationCommand: '',
        expectedArtifacts: ['research-report'],
        patchSummary: 'current reference runner smoke task',
      },
    }),
  }));
  assert.match(generatedReferencePayload?.message ?? '', /current-input\.pdf; priorAttempts=0/);

  let staticTaskRetryCount = 0;
  const staticTaskRetriedPayload = await runAgentServerGeneratedTask(currentReferenceRequest, skill, [skill], {}, makeGeneratedTaskRunnerDeps({
    request: currentReferenceRequest,
    requestAgentServerGeneration: async () => {
      staticTaskRetryCount += 1;
      if (staticTaskRetryCount === 1) {
        return {
          ok: true,
          runId: 'runner-static-task-smoke-run',
          response: {
            taskFiles: [{
              path: '.sciforge/tasks/static-report.py',
              language: 'python',
              content: [
                'import json',
                'payload = {',
                '  "message": "Static report from current-input.pdf",',
                '  "confidence": 0.9,',
                '  "claimType": "fact",',
                '  "evidenceLevel": "runtime",',
                '  "reasoningTrace": "static task smoke",',
                '  "claims": [],',
                '  "uiManifest": [{"componentId": "report-viewer", "artifactRef": "static-report"}],',
                '  "executionUnits": [{"id": "static", "status": "done", "tool": "python"}],',
                '  "artifacts": [{"id": "static-report", "type": "research-report", "schema": {"type": "object"}, "data": {"markdown": "Hard-coded current-input.pdf report"}}]',
                '}',
                'print(json.dumps(payload))',
              ].join('\n'),
            }],
            entrypoint: { language: 'python', path: '.sciforge/tasks/static-report.py' },
            environmentRequirements: {},
            validationCommand: '',
            expectedArtifacts: ['research-report'],
            patchSummary: 'static report task should be retried',
          },
        };
      }
      return {
        ok: true,
        runId: 'runner-static-task-direct-run',
        directPayload: {
          message: 'Direct report from current-input.pdf after static task retry.',
          confidence: 0.9,
          claimType: 'fact',
          evidenceLevel: 'runtime',
          reasoningTrace: 'static generated task retry returned direct payload',
          claims: [],
          uiManifest: [{ componentId: 'report-viewer', artifactRef: 'direct-static-retry-report' }],
          executionUnits: [{ id: 'direct-static-retry', status: 'done', tool: 'agentserver.direct' }],
          artifacts: [{ id: 'direct-static-retry-report', type: 'research-report', data: { markdown: 'Report based on current-input.pdf.' } }],
        },
      };
    },
  }));
  assert.equal(staticTaskRetryCount, 2);
  assert.match(staticTaskRetriedPayload?.message ?? '', /Direct report from current-input\.pdf/);

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
  const unverifiedDebit = unverified.budgetDebits?.[0];
  assert.ok(unverifiedDebit, 'runtime verification gate should emit a budget debit for unverified outputs');
  assert.equal(unverifiedDebit.capabilityId, 'sciforge.runtime-verification-gate');
  assert.equal(unverifiedDebit.sinkRefs.executionUnitRef, 'EU-low');
  assert.ok(unverifiedDebit.sinkRefs.auditRefs.some((ref) => ref.startsWith('verification-artifact:')));
  assert.ok(hasBudgetDebitRef(unverified.executionUnits[0], unverifiedDebit.debitId));
  assert.ok(unverified.artifacts.some((artifact) => artifact.type === 'verification-result' && hasBudgetDebitRef(artifact, unverifiedDebit.debitId)));
  assert.ok(unverified.logs?.some((entry) => entry.ref === unverifiedDebit.sinkRefs.auditRefs.find((ref) => ref.startsWith('audit:runtime-verification-gate:')) && hasBudgetDebitRef(entry, unverifiedDebit.debitId)));
  const verificationRef = String(unverified.artifacts.find((artifact) => artifact.type === 'verification-result')?.dataRef);
  assert.match(await readFile(join(workspace, verificationRef), 'utf8'), /"verdict": "unverified"/);

  const highRiskRequest = {
    ...normalizeGatewayRequest({
      skillDomain: 'knowledge',
      prompt: 'Publish this external update',
      workspacePath: workspace,
    }),
    verificationPolicy: { required: true, mode: 'hybrid', riskLevel: 'high', reason: 'external side effect' } as const,
  };
  assert.equal(normalizeRuntimeVerificationPolicy(highRiskRequest).riskLevel, 'high');
  const promptOnlyHighRiskWords = normalizeGatewayRequest({
    skillDomain: 'knowledge',
    prompt: 'Publish this external update',
    workspacePath: workspace,
  });
  assert.equal(normalizeRuntimeVerificationPolicy(promptOnlyHighRiskWords).riskLevel, 'low');
  assert.equal(normalizeRuntimeVerificationPolicy(promptOnlyHighRiskWords, {
    message: 'Provider says action completed',
    confidence: 0.9,
    claimType: 'execution',
    evidenceLevel: 'provider',
    reasoningTrace: 'action provider self-report',
    claims: [],
    uiManifest: [],
    executionUnits: [{
      id: 'EU-high-structured',
      status: 'done',
      tool: 'external.action-provider',
      params: JSON.stringify({ action: 'publish' }),
    }],
    artifacts: [],
  }).riskLevel, 'high');
  const gatedOutputRef = '.sciforge/task-results/runtime-verification-gated.json';
  await mkdir(join(workspace, '.sciforge/task-results'), { recursive: true });
  await writeFile(join(workspace, gatedOutputRef), JSON.stringify({
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
      outputRef: gatedOutputRef,
      params: JSON.stringify({ action: 'publish' }),
    }],
    artifacts: [],
  }), 'utf8');
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
      outputRef: gatedOutputRef,
      params: JSON.stringify({ action: 'publish' }),
    }],
    artifacts: [],
  }, highRiskRequest);
  assert.equal(gated.verificationResults?.[0].verdict, 'needs-human');
  assert.equal(gated.executionUnits[0].status, 'needs-human');
  assert.equal(gated.message, 'Provider says action completed');
  const gatedDebit = gated.budgetDebits?.[0];
  assert.ok(gatedDebit, 'runtime verification gate should emit a budget debit for blocked outputs');
  assert.equal(gatedDebit.capabilityId, 'sciforge.runtime-verification-gate');
  assert.equal(gatedDebit.sinkRefs.executionUnitRef, 'EU-high');
  assert.ok(gatedDebit.sinkRefs.auditRefs.some((ref) => ref.startsWith('audit:verification-gate:')));
  assert.ok(hasBudgetDebitRef(gated.executionUnits[0], gatedDebit.debitId));
  assert.ok(gated.logs?.some((entry) => hasBudgetDebitRef(entry, gatedDebit.debitId)));
  const verificationDisplayIntent = gated.displayIntent?.verification as Record<string, unknown> | undefined;
  assert.equal(verificationDisplayIntent?.verdict, 'needs-human');
  const gatedRefs = (gated.executionUnits[0].refs ?? {}) as Record<string, unknown>;
  const gatedAudit = gatedRefs.validationRepairAudit as {
    validationDecision?: { subject?: { kind?: string; completedPayloadRef?: string } };
    repairDecision?: { action?: string };
    auditRecord?: { failureKind?: string; outcome?: string; relatedRefs?: string[] };
  } | undefined;
  assert.ok(gatedRefs.validationFailure);
  assert.equal(gatedAudit?.validationDecision?.subject?.kind, 'verification-gate');
  assert.equal(gatedAudit?.validationDecision?.subject?.completedPayloadRef, gatedOutputRef);
  assert.equal(gatedAudit?.repairDecision?.action, 'needs-human');
  assert.equal(gatedAudit?.auditRecord?.failureKind, 'runtime-verification');
  assert.equal(gatedAudit?.auditRecord?.outcome, 'needs-human');
  assert.ok(gatedAudit?.auditRecord?.relatedRefs?.some((ref) => ref.includes('/verifications/')));
  const persistedGatedPayload = JSON.parse(await readFile(join(workspace, gatedOutputRef), 'utf8')) as ToolPayload & { refs?: Record<string, unknown> };
  assert.ok(persistedGatedPayload.refs?.validationRepairAudit);
  assert.equal(persistedGatedPayload.budgetDebits?.[0]?.debitId, gatedDebit.debitId);
  assert.ok(hasBudgetDebitRef(persistedGatedPayload.executionUnits[0], gatedDebit.debitId));

  console.log('[ok] runtime gateway modules expose request/context/payload/artifact/repair boundaries');
} finally {
  await rm(workspace, { recursive: true, force: true });
}

function hasBudgetDebitRef(record: unknown, debitId: string) {
  return typeof record === 'object'
    && record !== null
    && Array.isArray((record as { budgetDebitRefs?: unknown }).budgetDebitRefs)
    && ((record as { budgetDebitRefs: unknown[] }).budgetDebitRefs).includes(debitId);
}
