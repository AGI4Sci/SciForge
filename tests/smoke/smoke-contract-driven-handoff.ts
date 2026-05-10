import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { appendTaskAttempt } from '../../src/runtime/task-attempt-history.js';
import { normalizeBackendHandoff } from '../../src/runtime/workspace-task-input.js';
import { agentHarnessHandoffMetadata, buildAgentHarnessPromptRenderPlan } from '../../src/runtime/gateway/agent-harness-shadow.js';
import {
  agentHarnessHandoffRefsFromPayload,
  agentHarnessPromptRenderPlanSummaryFromPlan,
  reconstructAgentHarnessHandoffPayloadFromContract,
} from '../../src/runtime/gateway/agent-harness-handoff-reconstruction.js';
import { buildAgentServerGenerationPrompt } from '../../src/runtime/gateway/agentserver-prompts.js';
import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

type Dispatch = {
  text: string;
  serialized: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  runtimeMetadata: Record<string, unknown>;
  topLevelMetadata: Record<string, unknown>;
};

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-contract-driven-handoff-'));
const staleFailure = 'SHOULD_NOT_REACH_CONTRACT_HANDOFF';
const staleLogRef = '.sciforge/logs/stale-contract-handoff.stderr.log';
const dispatches: Dispatch[] = [];

await appendTaskAttempt(workspace, {
  id: 'stale-contract-handoff-attempt',
  attempt: 1,
  prompt: 'Create a fresh contract-driven handoff report.',
  skillDomain: 'literature',
  createdAt: '2026-05-01T00:00:00.000Z',
  codeRef: '.sciforge/tasks/stale-contract-handoff.py',
  outputRef: '.sciforge/task-results/stale-contract-handoff.json',
  stdoutRef: '.sciforge/logs/stale-contract-handoff.stdout.log',
  stderrRef: staleLogRef,
  exitCode: 1,
  status: 'failed-with-reason',
  failureReason: staleFailure,
  schemaErrors: [],
});

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: {
        session: { id: 'contract-driven-handoff-smoke', status: 'active' },
        operationalGuidance: { summary: ['mock context available'], items: [] },
        workLayout: { strategy: 'live_only', safetyPointReached: true, segments: [] },
        workBudget: { status: 'healthy', approxCurrentWorkTokens: 40 },
        recentTurns: [],
        currentWorkEntries: [],
      },
    }));
    return;
  }

  if (req.method !== 'POST' || !['/api/agent-server/runs', '/api/agent-server/runs/stream'].includes(String(req.url))) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }

  const body = await readJson(req);
  dispatches.push(captureDispatch(body));
  const result = {
    ok: true,
    data: {
      run: {
        id: `contract-driven-handoff-${dispatches.length}`,
        status: 'completed',
        output: {
          result: {
            message: 'Contract-driven handoff smoke completed.',
            confidence: 0.79,
            claimType: 'runtime-smoke',
            evidenceLevel: 'mock-agentserver',
            reasoningTrace: 'Mock AgentServer captured handoff metadata.',
            claims: [{ text: 'Contract handoff used current refs attempt:failed-current log:current-stderr artifact:previous-report.' }],
            uiManifest: [],
            executionUnits: [{ id: `EU-handoff-${dispatches.length}`, tool: 'agentserver.mock', status: 'done' }],
            artifacts: [{
              id: `handoff-report-${dispatches.length}`,
              type: 'research-report',
              data: {
                markdown: 'Contract-driven handoff smoke completed with refs attempt:failed-current log:current-stderr artifact:previous-report.',
              },
            }],
          },
        },
      },
    },
  };
  res.writeHead(200, { 'Content-Type': req.url === '/api/agent-server/runs/stream' ? 'application/x-ndjson' : 'application/json' });
  res.end(req.url === '/api/agent-server/runs/stream' ? `${JSON.stringify({ result })}\n` : JSON.stringify(result));
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  await runHandoffRequest('fresh', {
    harnessProfileId: 'balanced-default',
    agentHarnessInput: {
      intentMode: 'fresh',
    },
  });
  await runHandoffRequest('continuation', {
    harnessProfileId: 'balanced-default',
    contextReusePolicy: { mode: 'continue', historyReuse: { allowed: true } },
    currentReferences: [{ kind: 'artifact', ref: 'artifact:previous-report', title: 'Previous report' }],
    recentConversation: ['user: make a literature report', 'assistant: produced artifact:previous-report'],
    recentExecutionRefs: [{
      id: 'execution-unit:previous-report-task',
      status: 'done',
      outputRef: 'artifact:previous-report',
      stdoutRef: 'log:previous-report-stdout',
    }],
    agentHarnessInput: {
      intentMode: 'continuation',
      contextRefs: ['artifact:previous-report', 'execution-unit:previous-report-task', 'log:previous-report-stdout'],
      requiredContextRefs: ['artifact:previous-report'],
      blockedContextRefs: ['artifact:unrelated-prior'],
    },
  });
  await runHandoffRequest('repair', {
    harnessProfileId: 'debug-repair',
    contextReusePolicy: { mode: 'repair', historyReuse: { allowed: true } },
    currentReferences: [
      { kind: 'attempt', ref: 'attempt:failed-current', title: 'Failed current attempt' },
      { kind: 'log', ref: 'log:current-stderr', title: 'Current stderr' },
    ],
    recentExecutionRefs: [{
      id: 'attempt:failed-current',
      status: 'repair-needed',
      outputRef: 'artifact:failed-output',
      stderrRef: 'log:current-stderr',
    }],
    agentHarnessInput: {
      intentMode: 'repair',
      contextRefs: ['artifact:failed-output', 'attempt:failed-current', 'log:current-stderr'],
      requiredContextRefs: ['attempt:failed-current', 'log:current-stderr'],
      blockedContextRefs: ['artifact:unrelated-prior'],
      conversationSignals: { validationFailure: true },
    },
  });

  assert.equal(dispatches.length, 3);
  const [fresh, continuation, repair] = dispatches;
  assert.ok(fresh && continuation && repair);

  assertHandoff(fresh, {
    intentMode: 'fresh',
    profileId: 'balanced-default',
    allowed: [],
    blocked: [],
    required: [],
  });
  assertContinuityDecision(fresh, { decision: 'fresh', useContinuity: false, intentMode: 'fresh' });
  assert.equal(fresh.metadata.priorAttemptCount, 0);
  assertNoStaleRefs(fresh);

  assertHandoff(continuation, {
    intentMode: 'continuation',
    profileId: 'balanced-default',
    allowed: ['artifact:previous-report', 'execution-unit:previous-report-task', 'log:previous-report-stdout'],
    blocked: ['artifact:unrelated-prior'],
    required: ['artifact:previous-report'],
  });
  assertContinuityDecision(continuation, { decision: 'continuity', useContinuity: true, intentMode: 'continuation' });
  assertNoStaleRefs(continuation);

  assertHandoff(repair, {
    intentMode: 'repair',
    profileId: 'debug-repair',
    allowed: ['artifact:failed-output', 'attempt:failed-current', 'log:current-stderr'],
    blocked: ['artifact:unrelated-prior'],
    required: ['attempt:failed-current', 'log:current-stderr'],
  });
  assertContinuityDecision(repair, { decision: 'continuity', useContinuity: true, intentMode: 'repair' });
  const repairHandoff = handoff(repair);
  assert.equal(record(repairHandoff.repairContextPolicy).kind, 'repair-rerun');
  assert.equal(record(repairHandoff.repairContextPolicy).includeStdoutSummary, true);
  assertNoStaleRefs(repair);

  for (const dispatch of dispatches) {
    const payloadHandoff = handoff(dispatch);
    assert.deepEqual(dispatch.runtimeMetadata.agentHarnessHandoff, payloadHandoff);
    assert.deepEqual(dispatch.topLevelMetadata.agentHarnessHandoff, payloadHandoff);
    assertBackendSelectionDecision(dispatch);
    assertPromptDirectivesAreSourced(payloadHandoff);
    assertPromptRenderPlanIsSourced(payloadHandoff);
    assertGenerationPayloadRefsCanBeRead(dispatch);
    assert.equal(dispatch.text.includes(String(dispatch.metadata.harnessContractRef)), false);
    assert.equal(dispatch.text.includes(String(dispatch.metadata.harnessTraceRef)), false);
  }

  assertSyntheticDirectiveRenderingIsSourced();
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function runHandoffRequest(kind: 'fresh' | 'continuation' | 'repair', uiState: Record<string, unknown>) {
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: `${kind}: Create a contract-driven handoff report.`,
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    expectedArtifactTypes: ['research-report'],
    selectedComponentIds: ['report-viewer'],
    uiState: {
      ...uiState,
      agentHarnessContinuityAuditEnabled: true,
      agentHarnessBackendSelectionAuditEnabled: true,
      expectedArtifactTypes: ['research-report'],
      selectedComponentIds: ['report-viewer'],
    },
    artifacts: [],
  });
  assert.equal(result.message, 'Contract-driven handoff smoke completed.');
}

function captureDispatch(body: unknown): Dispatch {
  const payload = record(body);
  const input = record(payload.input);
  const runtime = record(payload.runtime);
  return {
    text: typeof input.text === 'string' ? input.text : '',
    serialized: JSON.stringify(payload),
    payload,
    metadata: record(input.metadata),
    runtimeMetadata: record(runtime.metadata),
    topLevelMetadata: record(payload.metadata),
  };
}

function assertHandoff(dispatch: Dispatch, expected: {
  intentMode: string;
  profileId: string;
  allowed: string[];
  blocked: string[];
  required: string[];
}) {
  const payloadHandoff = handoff(dispatch);
  assert.equal(dispatch.metadata.harnessProfileId, expected.profileId);
  assert.equal(payloadHandoff.harnessProfileId, expected.profileId);
  assert.equal(payloadHandoff.intentMode, expected.intentMode);
  assert.equal(payloadHandoff.harnessContractRef, dispatch.metadata.harnessContractRef);
  assert.equal(payloadHandoff.harnessTraceRef, dispatch.metadata.harnessTraceRef);
  assert.equal(payloadHandoff.decisionOwner, 'AgentServer');
  assert.equal(payloadHandoff.schemaVersion, 'sciforge.agent-harness-handoff.v1');
  const contextRefs = record(payloadHandoff.contextRefs);
  assert.deepEqual(list(contextRefs.allowed), expected.allowed);
  assert.deepEqual(list(contextRefs.blocked), expected.blocked);
  assert.deepEqual(list(contextRefs.required), expected.required);
}

function assertContinuityDecision(dispatch: Dispatch, expected: {
  decision: string;
  useContinuity: boolean;
  intentMode: string;
}) {
  const metadataDecision = record(dispatch.metadata.agentHarnessContinuityDecision);
  const handoffDecision = record(handoff(dispatch).continuityDecision);
  assert.deepEqual(handoffDecision, metadataDecision);
  assert.equal(metadataDecision.schemaVersion, 'sciforge.agent-harness-continuity-decision.v1');
  assert.equal(metadataDecision.shadowMode, true);
  assert.equal(metadataDecision.decisionOwner, 'AgentServer');
  assert.equal(metadataDecision.decision, expected.decision);
  assert.equal(metadataDecision.useContinuity, expected.useContinuity);
  const runtimeSignals = record(metadataDecision.runtimeSignals);
  assert.equal(typeof runtimeSignals.recentExecutionRefCount, 'number');
  assert.equal(typeof runtimeSignals.artifactCount, 'number');
  const harnessSignals = record(metadataDecision.harnessSignals);
  assert.equal(harnessSignals.intentMode, expected.intentMode);
  assert.equal(typeof harnessSignals.sourceCallbackId, 'string');
  const trace = record(metadataDecision.trace);
  assert.equal(typeof trace.recentExecutionRefs, 'number');
  assert.equal(typeof trace.artifacts, 'number');
}

function assertBackendSelectionDecision(dispatch: Dispatch) {
  const metadataDecision = record(dispatch.metadata.agentHarnessBackendSelectionDecision);
  const handoffDecision = record(handoff(dispatch).backendSelectionDecision);
  assert.deepEqual(handoffDecision, metadataDecision);
  assert.equal(metadataDecision.schemaVersion, 'sciforge.agentserver-backend-selection-decision.v1');
  assert.equal(metadataDecision.shadowMode, true);
  assert.equal(metadataDecision.decisionOwner, 'AgentServer');
  assert.equal(metadataDecision.harnessStage, 'beforeAgentDispatch');
  assert.equal(metadataDecision.backend, 'openteam_agent');
  assert.equal(metadataDecision.decision, 'openteam_agent');
  assert.equal(metadataDecision.source, 'llmEndpoint.baseUrl');
  const runtimeSignals = record(metadataDecision.runtimeSignals);
  assert.equal(runtimeSignals.llmEndpointConfigured, true);
  assert.equal(runtimeSignals.requestBackendSupported, false);
  assert.equal(runtimeSignals.envBackendSupported, false);
  const harnessSignals = record(metadataDecision.harnessSignals);
  assert.equal(harnessSignals.contractRef, dispatch.metadata.harnessContractRef);
  assert.equal(harnessSignals.traceRef, dispatch.metadata.harnessTraceRef);
  assert.equal(harnessSignals.harnessStage, 'beforeAgentDispatch');
  assert.equal(typeof harnessSignals.sourceCallbackId, 'string');
  const trace = record(metadataDecision.trace);
  assert.deepEqual(list(trace.selectionOrder), ['request.agentBackend', 'env.SCIFORGE_AGENTSERVER_BACKEND', 'llmEndpoint.baseUrl', 'runtime.default']);
  assert.deepEqual(list(trace.ignoredSources), ['request.agentBackend:missing', 'env.SCIFORGE_AGENTSERVER_BACKEND:missing']);
}

function assertNoStaleRefs(dispatch: Dispatch) {
  assert.equal(dispatch.serialized.includes(staleFailure), false);
  assert.equal(dispatch.serialized.includes(staleLogRef), false);
}

function assertGenerationPayloadRefsCanBeRead(dispatch: Dispatch) {
  const extracted = agentHarnessHandoffRefsFromPayload(dispatch.payload);
  assert.equal(extracted.refs.harnessContractRef, dispatch.metadata.harnessContractRef);
  assert.equal(extracted.refs.harnessTraceRef, dispatch.metadata.harnessTraceRef);
  assert.ok(extracted.sources.some((source) => source.source === 'payload.input.metadata'));
  assert.ok(extracted.sources.some((source) => source.source === 'payload.runtime.metadata'));
  assert.ok(extracted.sources.some((source) => source.source === 'payload.metadata'));
  assert.ok(extracted.sources.some((source) => source.source === 'payload._sciforgeHandoffManifest.sourceRefs'));
}

function assertPromptDirectivesAreSourced(payloadHandoff: Record<string, unknown>) {
  const directives = array(payloadHandoff.promptDirectives).map(record);
  for (const directive of directives) {
    assert.equal(typeof directive.id, 'string');
    assert.equal(typeof directive.sourceCallbackId, 'string');
  }
}

function assertPromptRenderPlanIsSourced(payloadHandoff: Record<string, unknown>) {
  const renderPlan = record(payloadHandoff.promptRenderPlan);
  assert.equal(renderPlan.schemaVersion, 'sciforge.agent-harness-prompt-render.v1');
  assert.equal(renderPlan.renderMode, 'metadata-scaffold');
  const sourceRefs = record(renderPlan.sourceRefs);
  assert.equal(sourceRefs.contractRef, payloadHandoff.harnessContractRef);
  assert.equal(sourceRefs.traceRef, payloadHandoff.harnessTraceRef);
  const strategyRefs = array(renderPlan.strategyRefs).map(record);
  assert.ok(strategyRefs.length >= 2, 'prompt render plan should expose deterministic strategy refs');
  for (const strategy of strategyRefs) {
    assert.equal(typeof strategy.id, 'string');
    assert.equal(typeof strategy.text, 'string');
    assert.equal(typeof strategy.sourceCallbackId, 'string');
  }
  for (const selectedRef of array(renderPlan.selectedContextRefs).map(record)) {
    assert.equal(typeof selectedRef.ref, 'string');
    assert.equal(typeof selectedRef.kind, 'string');
    assert.equal(typeof selectedRef.sourceCallbackId, 'string');
  }
  const renderedText = String(renderPlan.renderedText ?? '');
  const renderedEntries = array(renderPlan.renderedEntries).map(record);
  assert.deepEqual(
    renderedText.split('\n').filter(Boolean),
    renderedEntries.map((entry) => `[${String(entry.sourceCallbackId)}] ${String(entry.id)}: ${String(entry.text ?? '')}`.trim()),
  );
  for (const entry of renderedEntries) {
    assert.equal(typeof entry.kind, 'string');
    assert.equal(typeof entry.id, 'string');
    assert.equal(typeof entry.sourceCallbackId, 'string');
  }
  assert.equal(typeof renderPlan.renderDigest, 'string');
}

function assertSyntheticDirectiveRenderingIsSourced() {
  const renderPlan = buildAgentHarnessPromptRenderPlan({
    contract: {
      intentMode: 'repair',
      explorationMode: 'normal',
      allowedContextRefs: ['artifact:directive-render'],
      blockedContextRefs: [],
      requiredContextRefs: ['artifact:directive-render'],
      repairContextPolicy: { kind: 'repair-rerun', maxAttempts: 1 },
      promptDirectives: [{
        id: 'repair-output-boundary',
        sourceCallbackId: 'debug-repair.policy',
        priority: 80,
        text: 'Render only the selected repair evidence refs.',
      }],
    },
    trace: {
      stages: [{
        callbackId: 'debug-repair.policy',
        decision: {
          intentSignals: { intentMode: 'repair' },
          repair: { kind: 'repair-rerun' },
          contextHints: { requiredContextRefs: ['artifact:directive-render'] },
        },
      }],
    },
    summary: {
      contractRef: 'harness-contract:synthetic',
      traceRef: 'harness-trace:synthetic',
    },
  });
  const directives = array(renderPlan.directiveRefs).map(record);
  assert.equal(directives.length, 1);
  assert.equal(directives[0]?.sourceCallbackId, 'debug-repair.policy');
  assert.equal(directives[0]?.text, 'Render only the selected repair evidence refs.');
  assertPromptRenderPlanIsSourced({
    harnessContractRef: 'harness-contract:synthetic',
    harnessTraceRef: 'harness-trace:synthetic',
    promptRenderPlan: renderPlan,
  });
  assertPromptRenderPlanSummaryFromContextEnvelope(renderPlan);
}

function assertPromptRenderPlanSummaryFromContextEnvelope(renderPlan: Record<string, unknown>) {
  const prompt = buildAgentServerGenerationPrompt({
    prompt: 'fresh: Create a contract-driven handoff report.',
    skillDomain: 'literature',
    metadata: {
      promptRenderPlan: {
        renderDigest: 'sha1:metadata-render-digest',
        sourceRefs: { contractRef: 'harness-contract:metadata', traceRef: 'harness-trace:metadata' },
        renderedEntries: [{
          kind: 'strategy',
          id: 'metadata-entry',
          sourceCallbackId: 'harness.metadata',
          text: 'metadata should be lower priority than session facts',
        }],
      },
    },
    contextEnvelope: {
      version: 'sciforge.context-envelope.v1',
      sessionFacts: {
        currentUserRequest: 'fresh: Create a contract-driven handoff report.',
        agentHarnessHandoff: {
          promptRenderPlan: renderPlan,
        },
      },
      scenarioFacts: {},
    },
    workspaceTreeSummary: [],
    availableSkills: [],
    availableTools: [],
    availableRuntimeCapabilities: {},
    artifactSchema: {},
    uiManifestContract: {},
    uiStateSummary: {},
    priorAttempts: [],
    freshCurrentTurn: true,
  });
  assert.match(prompt, /"promptRenderPlanSummary"/);
  assert.match(prompt, /"source": "contextEnvelope\.sessionFacts\.agentHarnessHandoff"/);
  assert.match(prompt, /"renderDigest"/);
  assert.match(prompt, /"sourceRefs"/);
  assert.match(prompt, /"renderedEntries"/);
  assert.match(prompt, /"sourceCallbackId": "debug-repair\.policy"/);
  assert.equal(prompt.includes('sha1:metadata-render-digest'), false, 'sessionFacts prompt render plan should win over request metadata fallback');
}

async function assertNormalizedHandoffPayloadReconstruction() {
  const cases = [
    syntheticHarnessCase('generation', 'balanced-default', 'fresh', {
      allowed: ['artifact:generation-current'],
      required: ['artifact:generation-current'],
      blocked: ['artifact:generation-stale'],
    }),
    syntheticHarnessCase('repair', 'debug-repair', 'repair', {
      allowed: ['attempt:failed-current', 'log:current-stderr', 'artifact:failed-output'],
      required: ['attempt:failed-current', 'log:current-stderr'],
      blocked: ['artifact:unrelated-prior'],
    }),
  ];

  for (const testCase of cases) {
    const metadata = agentHarnessHandoffMetadata({
      prompt: `${testCase.kind}: reconstruct handoff metadata from contract refs`,
      skillDomain: 'literature',
      artifacts: [],
      uiState: {
        harnessProfileId: testCase.profileId,
        agentHarness: {
          profileId: testCase.profileId,
          contractRef: testCase.contractRef,
          traceRef: testCase.traceRef,
          summary: testCase.summary,
          contract: testCase.contract,
          trace: testCase.trace,
        },
      },
    } as any);
    const payload = {
      agent: { id: `synthetic-${testCase.kind}`, backend: 'openteam_agent' },
      input: {
        text: `${testCase.kind.toUpperCase()}_BACKEND_TEXT_SHOULD_NOT_BE_REQUIRED `.repeat(2500),
        metadata: {
          project: 'SciForge',
          purpose: testCase.kind === 'generation' ? 'workspace-task-generation' : 'workspace-task-repair',
          ...metadata,
        },
      },
      runtime: {
        metadata: {
          source: 'sciforge-contract-driven-handoff-smoke',
          ...metadata,
        },
      },
      metadata: {
        task: testCase.kind,
        ...metadata,
      },
    };
    const normalized = await normalizeBackendHandoff(payload, {
      workspacePath: workspace,
      purpose: `contract-driven-${testCase.kind}-reconstruction`,
      budget: {
        maxPayloadBytes: 20_000,
        maxInlineStringChars: 1200,
        maxInlineJsonBytes: 5000,
        headChars: 300,
        tailChars: 300,
        maxArrayItems: 4,
        maxObjectKeys: 24,
        maxDepth: 5,
        maxPriorAttempts: 1,
      },
    });
    const slimmingTrace = JSON.parse(await readFile(join(workspace, normalized.slimmingTraceRef), 'utf8')) as Record<string, unknown>;
    const extracted = agentHarnessHandoffRefsFromPayload(normalized.payload, { auditRecords: [slimmingTrace] });
    assert.equal(extracted.refs.harnessContractRef, testCase.contractRef);
    assert.equal(extracted.refs.harnessTraceRef, testCase.traceRef);
    assert.ok(extracted.sources.some((source) => source.source === 'payload._sciforgeHandoffManifest.sourceRefs'));
    assert.ok(extracted.sources.some((source) => source.source === 'auditRecords[0].sourceRefs'));

    const reconstructed = reconstructAgentHarnessHandoffPayloadFromContract({
      contract: testCase.contract,
      trace: testCase.trace,
      payload: normalized.payload,
      auditRecords: [slimmingTrace],
      summarySource: `reconstructed.${testCase.kind}.agentHarnessHandoff`,
    });
    assert.equal(reconstructed.refs.harnessContractRef, testCase.contractRef);
    assert.equal(reconstructed.refs.harnessTraceRef, testCase.traceRef);
    assert.equal(record(reconstructed.handoff).harnessContractRef, testCase.contractRef);
    assert.equal(record(reconstructed.handoff).harnessTraceRef, testCase.traceRef);

    const metadataRecord = metadata as Record<string, unknown>;
    const handoffMetadata = record(metadataRecord.agentHarnessHandoff);
    const originalPlan = record(handoffMetadata.promptRenderPlan);
    const originalSummary = agentHarnessPromptRenderPlanSummaryFromPlan(originalPlan, `original.${testCase.kind}.agentHarnessHandoff`);
    const reconstructedSummary = record(reconstructed.promptRenderPlanSummary);
    assert.equal(reconstructedSummary.renderDigest, record(originalSummary).renderDigest);
    assert.deepEqual(record(reconstructedSummary.sourceRefs), record(originalSummary).sourceRefs);
    assert.deepEqual(array(reconstructedSummary.renderedEntries), array(record(originalSummary).renderedEntries));
    assert.equal(JSON.stringify(normalized.payload).includes(`${testCase.kind.toUpperCase()}_BACKEND_TEXT_SHOULD_NOT_BE_REQUIRED `.repeat(100)), false);
  }
}

function assertHandoffReconstructionNegativeCompatibility() {
  assertMissingContractRefReconstructionIsPartial();
  assertLegacyHandoffMetadataDoesNotImplyCompleteReconstruction();
}

function assertMissingContractRefReconstructionIsPartial() {
  const testCase = syntheticHarnessCase('generation', 'balanced-default', 'fresh', {
    allowed: ['artifact:partial-current'],
    required: ['artifact:partial-current'],
    blocked: ['artifact:partial-stale'],
  });
  const contractWithoutRef = {
    ...testCase.contract,
    contractRef: undefined,
    traceRef: undefined,
  };
  const traceWithoutRef = {
    ...testCase.trace,
    ref: undefined,
    id: undefined,
    traceRef: undefined,
  };
  const reconstructed = reconstructAgentHarnessHandoffPayloadFromContract({
    contract: contractWithoutRef,
    trace: traceWithoutRef,
    payload: {
      metadata: {
        harnessTraceRef: testCase.traceRef,
      },
    },
  });

  assert.equal(reconstructed.refs.harnessContractRef, undefined);
  assert.equal(reconstructed.refs.harnessTraceRef, testCase.traceRef);
  const reconstructedHandoff = record(reconstructed.handoff);
  assert.equal(reconstructedHandoff.harnessContractRef, undefined);
  assert.equal(reconstructedHandoff.harnessTraceRef, testCase.traceRef);
  assert.equal(record(reconstructedHandoff.summary).contractRef, undefined);
  assert.equal(record(reconstructedHandoff.summary).traceRef, testCase.traceRef);
  assert.equal(record(record(reconstructedHandoff.promptRenderPlan).sourceRefs).contractRef, undefined);
  assert.equal(record(record(reconstructed.promptRenderPlanSummary).sourceRefs).contractRef, undefined);
  assert.deepEqual(list(record(reconstructedHandoff.contextRefs).allowed), ['artifact:partial-current']);
}

function assertLegacyHandoffMetadataDoesNotImplyCompleteReconstruction() {
  const legacyContractRef = 'legacy-contract-ref-should-not-count';
  const legacyTraceRef = 'legacy-trace-ref-should-not-count';
  const canonicalTraceRef = 'runtime://agent-harness/traces/legacy-compat';
  const legacyPayload = {
    metadata: {
      harnessTraceRef: canonicalTraceRef,
      agentHarnessHandoff: {
        schemaVersion: 'sciforge.agent-harness-handoff.legacy',
        profileId: 'legacy-profile',
        contractRef: legacyContractRef,
        traceRef: legacyTraceRef,
        promptRenderPlan: {
          sourceRefs: {
            contractRef: legacyContractRef,
            traceRef: legacyTraceRef,
          },
        },
      },
    },
  };
  const extracted = agentHarnessHandoffRefsFromPayload(legacyPayload);
  assert.equal(extracted.refs.harnessContractRef, undefined);
  assert.equal(extracted.refs.harnessTraceRef, canonicalTraceRef);
  assert.ok(extracted.sources.length > 0);
  assert.ok(extracted.sources.every((source) => source.harnessContractRef === undefined));

  const testCase = syntheticHarnessCase('repair', 'debug-repair', 'repair', {
    allowed: ['attempt:legacy-failed-current', 'log:legacy-current-stderr'],
    required: ['attempt:legacy-failed-current'],
    blocked: ['artifact:legacy-unrelated-prior'],
  });
  const reconstructed = reconstructAgentHarnessHandoffPayloadFromContract({
    contract: {
      ...testCase.contract,
      contractRef: undefined,
      traceRef: undefined,
    },
    trace: {
      ...testCase.trace,
      ref: undefined,
      id: undefined,
      traceRef: undefined,
    },
    payload: legacyPayload,
  });
  const reconstructedHandoff = record(reconstructed.handoff);
  assert.equal(reconstructed.refs.harnessContractRef, undefined);
  assert.equal(reconstructed.refs.harnessTraceRef, canonicalTraceRef);
  assert.equal(reconstructedHandoff.harnessContractRef, undefined);
  assert.equal(reconstructedHandoff.harnessTraceRef, canonicalTraceRef);
  assert.equal(JSON.stringify(reconstructed).includes(legacyContractRef), false);
}

function syntheticHarnessCase(
  kind: 'generation' | 'repair',
  profileId: string,
  intentMode: string,
  refs: { allowed: string[]; required: string[]; blocked: string[] },
) {
  const contractRef = `runtime://agent-harness/contracts/${profileId}/${kind}-reconstruct`;
  const traceRef = `${contractRef}/trace`;
  const contract = {
    schemaVersion: 'sciforge.agent-harness-contract.v1',
    profileId,
    contractRef,
    traceRef,
    intentMode,
    explorationMode: kind === 'repair' ? 'normal' : 'minimal',
    allowedContextRefs: refs.allowed,
    blockedContextRefs: refs.blocked,
    requiredContextRefs: refs.required,
    contextBudget: {
      maxPromptTokens: 12000,
      maxHistoryTurns: kind === 'repair' ? 4 : 0,
      maxReferenceDigests: 6,
      maxFullTextRefs: kind === 'repair' ? 2 : 0,
    },
    capabilityPolicy: {
      candidates: [],
      preferredCapabilityIds: [],
      blockedCapabilities: [],
      sideEffects: {
        network: 'allow',
        workspaceWrite: 'allow',
        externalMutation: 'block',
        codeExecution: 'allow',
      },
    },
    toolBudget: {
      maxWallMs: 120000,
      maxContextTokens: 12000,
      maxToolCalls: 4,
      maxObserveCalls: 0,
      maxActionSteps: 0,
      maxNetworkCalls: 4,
      maxDownloadBytes: 4000000,
      maxResultItems: 20,
      maxProviders: 2,
      maxRetries: kind === 'repair' ? 1 : 0,
      perProviderTimeoutMs: 30000,
      costUnits: 3,
      exhaustedPolicy: 'partial-payload',
    },
    verificationPolicy: {
      intensity: kind === 'repair' ? 'strict' : 'standard',
      requireCitations: false,
      requireCurrentRefs: true,
      requireArtifactRefs: kind === 'repair',
    },
    repairContextPolicy: kind === 'repair'
      ? { kind: 'repair-rerun', maxAttempts: 1, includeStdoutSummary: true, includeStderrSummary: true }
      : { kind: 'none', maxAttempts: 0, includeStdoutSummary: false, includeStderrSummary: false },
    progressPlan: {
      initialStatus: 'Preparing handoff',
      visibleMilestones: ['dispatch'],
      silenceTimeoutMs: 30000,
      backgroundContinuation: false,
    },
    promptDirectives: [{
      id: `${kind}-selected-refs-only`,
      sourceCallbackId: `${profileId}.policy`,
      priority: 70,
      text: `Use only selected ${kind} handoff refs.`,
    }],
  };
  const trace = {
    schemaVersion: 'sciforge.agent-harness-trace.v1',
    traceId: `${kind}-trace`,
    profileId,
    stages: [{
      stage: 'classifyIntent',
      callbackId: `${profileId}.intent`,
      decision: {
        intentSignals: { intentMode, explorationMode: contract.explorationMode },
      },
      contractSnapshot: contract,
    }, {
      stage: 'selectContext',
      callbackId: `${profileId}.context`,
      decision: {
        contextHints: {
          allowedContextRefs: refs.allowed,
          requiredContextRefs: refs.required,
          blockedContextRefs: refs.blocked,
        },
      },
      contractSnapshot: contract,
    }, {
      stage: kind === 'repair' ? 'beforeRepairDispatch' : 'beforeAgentDispatch',
      callbackId: `${profileId}.policy`,
      decision: {
        repair: contract.repairContextPolicy,
        promptDirectives: contract.promptDirectives,
      },
      contractSnapshot: contract,
    }],
    conflicts: [],
    auditNotes: [],
  };
  const summary = {
    schemaVersion: contract.schemaVersion,
    profileId,
    contractRef,
    traceRef,
    intentMode,
    explorationMode: contract.explorationMode,
    allowedContextRefCount: refs.allowed.length,
    blockedContextRefCount: refs.blocked.length,
    requiredContextRefCount: refs.required.length,
    promptDirectiveCount: contract.promptDirectives.length,
    traceStageCount: trace.stages.length,
  };
  return { kind, profileId, contractRef, traceRef, contract, trace, summary };
}

function handoff(dispatch: Dispatch) {
  return record(dispatch.metadata.agentHarnessHandoff);
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function list(value: unknown) {
  return array(value).filter((item): item is string => typeof item === 'string');
}

await assertNormalizedHandoffPayloadReconstruction();
assertHandoffReconstructionNegativeCompatibility();

console.log('[ok] contract-driven handoff carries harness refs and reconstructable metadata for fresh/continuation/repair without live backend');
