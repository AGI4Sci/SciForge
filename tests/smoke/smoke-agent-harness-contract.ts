import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import { buildContextEnvelope } from '../../src/runtime/gateway/context-envelope.js';
import { progressModelFromEvent } from '../../src/ui/src/processProgress.js';
import { agentHarnessRepairPolicyBridgeFromRuntimeState } from '../../src/runtime/gateway/validation-repair-audit-bridge.js';

type CapturedDispatch = {
  url: string;
  text: string;
  metadata: Record<string, unknown>;
};

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agent-harness-contract-'));
const dispatches: CapturedDispatch[] = [];

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: {
        session: { id: 'agent-harness-smoke-context', status: 'active' },
        operationalGuidance: { summary: ['context healthy'], items: [] },
        workLayout: { strategy: 'live_only', safetyPointReached: true, segments: [] },
        workBudget: { status: 'healthy', approxCurrentWorkTokens: 80 },
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
  const metadata = isRecord(body.input) && isRecord(body.input.metadata) ? body.input.metadata : {};
  const text = isRecord(body.input) && typeof body.input.text === 'string' ? body.input.text : '';
  dispatches.push({ url: String(req.url), text, metadata });

  const result = {
    ok: true,
    data: {
      run: {
        id: `agent-harness-smoke-run-${dispatches.length}`,
        status: 'completed',
        output: {
          result: {
            message: 'Harness shadow smoke completed.',
            confidence: 0.9,
            claimType: 'harness-shadow-smoke',
            evidenceLevel: 'runtime-smoke',
            reasoningTrace: 'AgentServer received a normal generation request with harness metadata attached.',
            claims: [],
            uiManifest: [{ componentId: 'report-viewer', artifactRef: 'research-report' }],
            executionUnits: [{ id: 'agent-harness-shadow', status: 'done', tool: 'agentserver.direct-context' }],
            artifacts: [{
              id: 'research-report',
              type: 'research-report',
              data: { markdown: 'Harness shadow smoke completed.' },
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
  const first = await runHarnessRequest('balanced-default');
  const second = await runHarnessRequest('balanced-default');
  const fast = await runHarnessRequest('fast-answer');
  const research = await runHarnessRequest('research-grade');
  const progressOptIn = await runHarnessRequest('balanced-default', {
    agentHarnessProgressPlanEnabled: true,
    agentHarnessContinuityAuditEnabled: true,
    agentHarnessBackendSelectionAuditEnabled: true,
  });
  const backendDecisionDisabled = await runHarnessRequest('balanced-default', {
    agentHarnessBackendSelectionDecisionDisabled: true,
  });
  const continuityDecisionDisabled = await runHarnessRequest('balanced-default', {
    agentHarnessContinuityDecisionDisabled: true,
  });

  assert.equal(first.result.message, 'Harness shadow smoke completed.');
  assert.equal(first.event.status, 'completed');
  assert.equal(first.summary.profileId, 'balanced-default');
  assert.equal(first.contract.schemaVersion, 'sciforge.agent-harness-contract.v1');
  assert.equal(first.trace.schemaVersion, 'sciforge.agent-harness-trace.v1');
  assert.ok(Array.isArray(first.trace.stages) && first.trace.stages.length > 0);
  assert.deepEqual(first.contract, second.contract);
  assert.deepEqual(first.trace, second.trace);
  assert.equal(first.progressEvents.length, 1, 'progressPlan projection should emit a structured progress event by default');
  assert.equal(first.progressEvents[0]?.type, 'process-progress');
  assert.equal(isRecord(first.progressEvents[0]?.raw) ? first.progressEvents[0]?.raw.reason : undefined, 'progress-plan-projection');
  assert.equal(dispatches[0]?.metadata.harnessProfileId, 'balanced-default');
  assert.equal(dispatches[0]?.metadata.harnessContractRef, first.summary.contractRef);
  assert.equal(dispatches[0]?.metadata.harnessTraceRef, first.summary.traceRef);
  assert.equal(dispatches[0]?.metadata.harnessDecisionOwner, 'AgentServer');
  const defaultContinuityDecision = dispatches[0]?.metadata.agentHarnessContinuityDecision as Record<string, unknown>;
  assert.equal(defaultContinuityDecision.schemaVersion, 'sciforge.agent-harness-continuity-decision.v1');
  assert.equal(defaultContinuityDecision.shadowMode, true);
  assert.equal(defaultContinuityDecision.decisionOwner, 'AgentServer');
  assert.equal(defaultContinuityDecision.decision, 'fresh');
  assert.equal(defaultContinuityDecision.useContinuity, false);
  const defaultBackendSelectionDecision = dispatches[0]?.metadata.agentHarnessBackendSelectionDecision as Record<string, unknown>;
  assert.equal(defaultBackendSelectionDecision.schemaVersion, 'sciforge.agentserver-backend-selection-decision.v1');
  assert.equal(defaultBackendSelectionDecision.shadowMode, true);
  assert.equal(defaultBackendSelectionDecision.decisionOwner, 'AgentServer');
  assert.equal(defaultBackendSelectionDecision.harnessStage, 'beforeAgentDispatch');
  assert.equal(defaultBackendSelectionDecision.backend, 'openteam_agent');
  assert.ok(isRecord(dispatches[0]?.metadata.harnessBudgetSummary), 'harness budget summary should be attached to payload metadata');
  assert.ok(isRecord(dispatches[0]?.metadata.agentHarnessHandoff), 'structured harness handoff metadata should be attached');
  const handoff = dispatches[0]?.metadata.agentHarnessHandoff as Record<string, unknown>;
  assert.equal(handoff.schemaVersion, 'sciforge.agent-harness-handoff.v1');
  assert.equal(handoff.harnessProfileId, 'balanced-default');
  assert.equal(handoff.harnessContractRef, first.summary.contractRef);
  assert.equal(handoff.harnessTraceRef, first.summary.traceRef);
  assert.equal(handoff.decisionOwner, 'AgentServer');
  assert.deepEqual(handoff.continuityDecision, defaultContinuityDecision);
  assert.deepEqual(handoff.backendSelectionDecision, defaultBackendSelectionDecision);
  const generatedHandoffEnvelope = buildContextEnvelope({
    skillDomain: 'literature',
    prompt: 'Render the generated harness handoff through the compact broker payload.',
    artifacts: [],
    selectedComponentIds: ['report-viewer'],
    uiState: {
      agentHarnessHandoff: handoff,
    },
  }, {
    workspace,
    workspaceTreeSummary: [],
    priorAttempts: [],
    mode: 'full',
  });
  const generatedBrokerBrief = generatedHandoffEnvelope.scenarioFacts.capabilityBrokerBrief as Record<string, unknown>;
  const generatedHarnessInputAudit = generatedBrokerBrief.harnessInputAudit as Record<string, unknown>;
  assert.equal(generatedHarnessInputAudit.schemaVersion, 'sciforge.agentserver.capability-broker-harness-input-audit.v1');
  assert.equal(generatedHarnessInputAudit.enablement, 'default-canonical');
  assert.equal(generatedHarnessInputAudit.contractRef, first.summary.contractRef);
  assert.equal(generatedHarnessInputAudit.traceRef, first.summary.traceRef);
  const defaultRepairPolicy = agentHarnessRepairPolicyBridgeFromRuntimeState({ agentHarnessHandoff: handoff });
  assert.ok(defaultRepairPolicy, 'canonical handoff repair policy should be projected into audit metadata by default');
  assert.equal(defaultRepairPolicy.consume, false);
  assert.equal(defaultRepairPolicy.contractRef, first.summary.contractRef);
  assert.equal(defaultRepairPolicy.traceRef, first.summary.traceRef);
  assert.equal(defaultRepairPolicy.profileId, 'balanced-default');
  assert.equal(
    agentHarnessRepairPolicyBridgeFromRuntimeState({
      agentHarnessRepairPolicyAuditDisabled: true,
      agentHarnessHandoff: handoff,
    }),
    undefined,
    'repair policy audit kill switch should suppress default handoff projection',
  );
  assert.equal(dispatches[0]?.metadata.purpose, dispatches[2]?.metadata.purpose);
  assert.equal(dispatches[0]?.url, dispatches[2]?.url);
  assert.equal(dispatches[0]?.text.includes('"harnessInputAudit"'), true, 'fresh prompt should carry compact broker harness input audit');
  assert.equal(dispatches[0]?.text.includes(first.summary.contractRef as string), true, 'compact broker harness audit should carry the contract ref');
  assert.equal(dispatches[0]?.text.includes(first.summary.traceRef as string), true, 'compact broker harness audit should carry the trace ref');
  assert.equal(dispatches[0]?.text.includes('"agentHarness"'), false, 'fresh prompt text must not inline harness shadow payload');
  assert.equal(dispatches[0]?.text.includes('"promptDirectives"'), false, 'fresh prompt text must not inline full harness contract');
  assert.equal(dispatches[0]?.text.includes('"stages"'), false, 'fresh prompt text must not inline full harness trace');
  assert.notDeepEqual(fast.contract, research.contract);
  assert.equal(fast.contract.profileId, 'fast-answer');
  assert.equal(research.contract.profileId, 'research-grade');
  assert.equal(progressOptIn.event.status, 'completed');
  assert.equal(progressOptIn.progressEvents.length, 1);
  const projected = progressOptIn.progressEvents[0];
  const projectedRaw = isRecord(projected.raw) ? projected.raw : {};
  const progressAudit = isRecord(projectedRaw.agentHarnessProgressPlan) ? projectedRaw.agentHarnessProgressPlan : {};
  assert.equal(projected.type, 'process-progress');
  assert.equal(projected.status, 'running');
  assert.equal(projectedRaw.schemaVersion, 'sciforge.interaction-progress-event.v1');
  assert.equal(projectedRaw.type, 'process-progress');
  assert.equal(projectedRaw.traceRef, progressOptIn.summary.traceRef);
  assert.equal(progressAudit.schemaVersion, 'sciforge.agent-harness-progress-plan-projection.v1');
  assert.equal(progressAudit.contractRef, progressOptIn.summary.contractRef);
  assert.equal(progressAudit.source, 'request.uiState.agentHarness.contract.progressPlan');
  const continuityDecision = dispatches[4]?.metadata.agentHarnessContinuityDecision as Record<string, unknown>;
  assert.equal(continuityDecision.schemaVersion, 'sciforge.agent-harness-continuity-decision.v1');
  assert.equal(continuityDecision.shadowMode, true);
  assert.equal(continuityDecision.decisionOwner, 'AgentServer');
  assert.equal(continuityDecision.decision, 'fresh');
  assert.equal(continuityDecision.useContinuity, false);
  const continuityHandoff = dispatches[4]?.metadata.agentHarnessHandoff as Record<string, unknown>;
  assert.deepEqual(continuityHandoff.continuityDecision, continuityDecision);
  const backendSelectionDecision = dispatches[4]?.metadata.agentHarnessBackendSelectionDecision as Record<string, unknown>;
  assert.equal(backendSelectionDecision.schemaVersion, 'sciforge.agentserver-backend-selection-decision.v1');
  assert.equal(backendSelectionDecision.shadowMode, true);
  assert.equal(backendSelectionDecision.decisionOwner, 'AgentServer');
  assert.equal(backendSelectionDecision.harnessStage, 'beforeAgentDispatch');
  assert.equal(backendSelectionDecision.decision, 'openteam_agent');
  assert.equal(backendSelectionDecision.backend, 'openteam_agent');
  assert.equal(backendSelectionDecision.source, 'llmEndpoint.baseUrl');
  const backendSignals = isRecord(backendSelectionDecision.runtimeSignals) ? backendSelectionDecision.runtimeSignals : {};
  assert.equal(backendSignals.llmEndpointConfigured, true);
  const backendHarnessSignals = isRecord(backendSelectionDecision.harnessSignals) ? backendSelectionDecision.harnessSignals : {};
  assert.equal(backendHarnessSignals.contractRef, progressOptIn.summary.contractRef);
  assert.equal(backendHarnessSignals.traceRef, progressOptIn.summary.traceRef);
  assert.equal(typeof backendHarnessSignals.sourceCallbackId, 'string');
  const backendExternalHook = isRecord(backendHarnessSignals.externalHook) ? backendHarnessSignals.externalHook : {};
  assert.equal(backendExternalHook.schemaVersion, 'sciforge.agent-harness-external-hook-trace.v1');
  assert.equal(backendExternalHook.stage, 'beforeAgentDispatch');
  assert.equal(backendExternalHook.stageGroup, 'external-hook');
  assert.equal(backendExternalHook.declaredBy, 'HARNESS_EXTERNAL_HOOK_STAGES');
  assert.equal(backendExternalHook.declared, true);
  const backendTrace = isRecord(backendSelectionDecision.trace) ? backendSelectionDecision.trace : {};
  const backendTraceHarness = isRecord(backendTrace.harness) ? backendTrace.harness : {};
  assert.equal(backendTraceHarness.externalHookStage, 'beforeAgentDispatch');
  assert.equal(backendTraceHarness.externalHookDeclaredBy, 'HARNESS_EXTERNAL_HOOK_STAGES');
  assert.equal(backendTraceHarness.externalHookDeclared, true);
  assert.deepEqual(continuityHandoff.backendSelectionDecision, backendSelectionDecision);
  const uiProgress = progressModelFromEvent(projected as unknown as Parameters<typeof progressModelFromEvent>[0]);
  assert.ok(String(projectedRaw.phase || ''), 'projected progress event should expose a contract phase');
  assert.ok(String(uiProgress?.phase || ''), 'UI progress should preserve a visible phase');
  assert.equal(uiProgress?.status, 'running');
  assert.equal(uiProgress?.reason, 'progress-plan-projection');
  assert.equal(backendDecisionDisabled.event.status, 'completed');
  assert.equal(dispatches[5]?.metadata.agentHarnessBackendSelectionDecision, undefined, 'explicit kill switch should omit backend selection decision audit');
  assert.equal(continuityDecisionDisabled.event.status, 'completed');
  assert.equal(dispatches[6]?.metadata.agentHarnessContinuityDecision, undefined, 'explicit kill switch should omit continuity decision audit');
  assert.equal(dispatches.length, 7);
  console.log('[ok] agent harness shadow contract is stable, traced, profiled, and metadata-only');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function runHarnessRequest(profileId: string, uiStateOverrides: Record<string, unknown> = {}) {
  const events: Array<Record<string, unknown>> = [];
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'Summarize harness shadow contract behavior in a report.',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    expectedArtifactTypes: ['research-report'],
    selectedComponentIds: ['report-viewer'],
    uiState: {
      forceAgentServerGeneration: true,
      harnessProfileId: profileId,
      expectedArtifactTypes: ['research-report'],
      selectedComponentIds: ['report-viewer'],
      ...uiStateOverrides,
    },
    artifacts: [],
  }, {
    onEvent: (event) => events.push(event as unknown as Record<string, unknown>),
  });
  const event = events.find((item) => item.type === 'agent-harness-contract');
  assert.ok(event, `missing agent-harness-contract event for ${profileId}`);
  const raw = isRecord(event.raw) ? event.raw : {};
  const summary = isRecord(raw.summary) ? raw.summary : {};
  const contract = isRecord(raw.contract) ? raw.contract : {};
  const trace = isRecord(raw.trace) ? raw.trace : {};
  const progressEvents = events.filter((item) => item.type === 'process-progress' && isRecord(item.raw) && isRecord(item.raw.agentHarnessProgressPlan));
  return {
    result,
    event,
    raw,
    summary,
    contract,
    trace,
    progressEvents,
  };
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
