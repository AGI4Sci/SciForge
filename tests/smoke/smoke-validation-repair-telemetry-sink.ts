import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  type RepairBudgetSnapshot,
  type ValidationFinding,
  type ValidationRepairTelemetrySpanKind,
} from '@sciforge-ui/runtime-contract/validation-repair-audit';
import { executeRepairActionPlan } from '../../src/runtime/gateway/repair-executor';
import {
  buildValidationRepairTelemetrySummary,
  projectValidationRepairTelemetrySpans,
  readValidationRepairTelemetrySpanRecords,
  validationRepairTelemetrySpansFromPayload,
  writeValidationRepairTelemetrySpans,
} from '../../src/runtime/gateway/validation-repair-telemetry-sink';
import { createValidationRepairAuditChain } from '../../src/runtime/gateway/validation-repair-audit-bridge';
import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway';
import {
  buildObserveInvocationPlan,
  runObserveInvocationPlan,
  type ObserveProviderRuntime,
} from '../../src/runtime/observe/orchestration';

const createdAt = '2026-05-10T00:00:00.000Z';
const repairBudget: RepairBudgetSnapshot = {
  maxAttempts: 1,
  remainingAttempts: 1,
  maxSupplementAttempts: 0,
  remainingSupplementAttempts: 0,
};
const expectedKinds: ValidationRepairTelemetrySpanKind[] = [
  'generation/request',
  'materialize',
  'payload-validation',
  'work-evidence',
  'verification-gate',
  'repair-decision',
  'repair-rerun',
  'ledger-write',
  'observe-invocation',
];

const chain = createValidationRepairAuditChain({
  chainId: 'telemetry-sink',
  subject: {
    kind: 'generated-task-result',
    id: 'telemetry-sink',
    capabilityId: 'agentserver.direct-payload',
    contractId: 'sciforge.tool-payload.v1',
    completedPayloadRef: 'run:telemetry/output.json',
    generatedTaskRef: 'task:telemetry/request.py',
    observeTraceRef: 'observe:telemetry-trace',
    actionTraceRef: 'action:telemetry-trace',
    artifactRefs: ['artifact:telemetry-report'],
    currentRefs: ['current:user-request'],
  },
  findings: [blockingFinding('telemetry-sink')],
  workEvidence: [{
    kind: 'validate',
    status: 'repair-needed',
    provider: 'validation-repair-telemetry-smoke',
    outputSummary: 'Payload validation failed and produced repair evidence.',
    evidenceRefs: ['run:telemetry/output.json', 'artifact:telemetry-report'],
    failureReason: 'claims missing',
    recoverActions: ['rerun the failed generation request'],
    rawRef: 'work-evidence:telemetry-sink',
  }],
  runtimeVerificationResults: [{
    id: 'verification:telemetry-gate',
    verdict: 'fail',
    confidence: 0.8,
    critique: 'Generated report missed required claim evidence.',
    evidenceRefs: ['verification:telemetry-artifact'],
    repairHints: ['rerun with evidence refs'],
  }],
  repairBudget,
  sinkRefs: [
    'appendTaskAttempt:telemetry-sink',
    'ledger:telemetry-sink',
    'observe-invocation:telemetry-sink',
  ],
  telemetrySpanRefs: [
    'span:payload-validation:telemetry-sink',
    'span:repair-decision:telemetry-sink',
  ],
  runtimeVerificationPolicyId: 'verification-policy:telemetry',
  relatedRefs: ['request:telemetry-generation'],
  createdAt,
});

const executorResult = await executeRepairActionPlan({
  validationDecision: chain.validation,
  repairDecision: chain.repair,
  auditRecord: chain.audit,
  actionPlan: {
    planId: 'plan:telemetry-rerun',
    action: 'rerun',
    targetRef: 'task:telemetry/request.py',
    outputRef: 'run:telemetry/rerun-output.json',
    expectedRefs: ['artifact:telemetry-rerun-report'],
    createdAt,
  },
  createdAt,
}, {
  rerun: () => ({
    refs: ['run:telemetry/rerun-output.json', 'artifact:telemetry-rerun-report'],
    summary: 'Reran failed generation for telemetry projection.',
  }),
});

const projection = projectValidationRepairTelemetrySpans({
  validationDecision: chain.validation,
  repairDecision: chain.repair,
  auditRecord: chain.audit,
  executorResult,
});
const actualKinds = projection.spans.map((span) => span.spanKind).sort();
assert.deepEqual(actualKinds, [...expectedKinds].sort());
assert.equal(projection.spanRefs.length, expectedKinds.length);
assert.ok(projection.sourceRefs.includes('run:telemetry/output.json'));
assert.ok(projection.sourceRefs.includes('run:telemetry/rerun-output.json'));
assert.ok(projection.auditRefs.includes(chain.audit.auditId));
assert.ok(projection.auditRefs.includes('ledger:telemetry-sink'));
assert.ok(projection.repairRefs.includes(chain.repair.decisionId));
assert.ok(projection.repairRefs.includes(executorResult.executorRef.ref));

const payloadValidation = projection.spans.find((span) => span.spanKind === 'payload-validation');
assert.equal(payloadValidation?.ref, 'span:payload-validation:telemetry-sink');
assert.equal(payloadValidation?.status, 'failed');
assert.equal(payloadValidation?.validationDecisionId, chain.validation.decisionId);
assert.equal(payloadValidation?.repairDecisionId, chain.repair.decisionId);
assert.equal(payloadValidation?.auditId, chain.audit.auditId);
assert.equal(payloadValidation?.executorResultId, executorResult.executorResultId);
assert.ok(payloadValidation?.sourceRefs.includes('run:telemetry/output.json'));
assert.ok(payloadValidation?.auditRefs.includes(chain.audit.auditId));
assert.ok(payloadValidation?.repairRefs.includes(chain.repair.decisionId));

const repairRerun = projection.spans.find((span) => span.spanKind === 'repair-rerun');
assert.equal(repairRerun?.status, 'executed');
assert.equal(repairRerun?.action, 'rerun');
assert.ok(repairRerun?.sourceRefs.includes('run:telemetry/rerun-output.json'));
assert.ok(repairRerun?.relatedRefs.includes('artifact:telemetry-rerun-report'));

const observe = projection.spans.find((span) => span.spanKind === 'observe-invocation');
assert.ok(observe?.sourceRefs.includes('observe:telemetry-trace'));
assert.ok(observe?.sourceRefs.includes('observe-invocation:telemetry-sink'));

const payloadProjection = validationRepairTelemetrySpansFromPayload({
  refs: {
    validationRepairAudit: {
      validationDecision: chain.validation,
      repairDecision: chain.repair,
      auditRecord: chain.audit,
      executorResult,
    },
  },
  executionUnits: [{
    refs: {
      validationRepairAudit: {
        validationDecision: chain.validation,
        repairDecision: chain.repair,
        auditRecord: chain.audit,
        executorResult,
      },
    },
  }],
});
assert.equal(payloadProjection?.spans.length, expectedKinds.length, 'payload projection should dedupe repeated telemetry chains');
assert.ok(payloadProjection?.spans.every((span) => span.auditRefs.includes(chain.audit.auditId)));
assert.ok(payloadProjection?.spans.every((span) => span.repairRefs.includes(chain.repair.decisionId)));

const repairOnlyProjection = projectValidationRepairTelemetrySpans(executorResult, { spanKinds: ['repair-rerun'] });
assert.equal(repairOnlyProjection.spans.length, 1);
assert.equal(repairOnlyProjection.spans[0]?.spanKind, 'repair-rerun');
assert.equal(repairOnlyProjection.spans[0]?.repairDecisionId, chain.repair.decisionId);

const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-telemetry-sink-'));
try {
  const writeResult = await writeValidationRepairTelemetrySpans({
    validationDecision: chain.validation,
    repairDecision: chain.repair,
    auditRecord: chain.audit,
    executorResult,
  }, {
    workspacePath,
    now: () => new Date('2026-05-10T00:00:01.000Z'),
  });
  assert.equal(writeResult.records.length, expectedKinds.length);
  assert.equal(writeResult.ref, '.sciforge/validation-repair-telemetry/spans.jsonl');
  assert.ok(writeResult.path.endsWith('/.sciforge/validation-repair-telemetry/spans.jsonl'));
  assert.ok(writeResult.records.every((record) => record.kind === 'validation-repair-telemetry-span-record'));
  assert.ok(writeResult.records.every((record) => record.schemaVersion === 1));
  assert.ok(writeResult.records.every((record) => record.ref.startsWith(`${writeResult.ref}#`)));
  assert.ok(writeResult.records.every((record) => record.spanId === record.span.spanId));
  assert.ok(writeResult.records.every((record) => record.validationDecisionId === chain.validation.decisionId));
  assert.ok(writeResult.records.every((record) => record.repairDecisionId === chain.repair.decisionId));
  assert.ok(writeResult.records.every((record) => record.auditId === chain.audit.auditId));
  assert.ok(writeResult.records.every((record) => record.createdAt === createdAt));
  assert.ok(writeResult.records.every((record) => record.recordedAt === '2026-05-10T00:00:01.000Z'));

  const records = await readValidationRepairTelemetrySpanRecords({ workspacePath });
  assert.equal(records.length, expectedKinds.length);
  assert.deepEqual(records.map((record) => record.spanKind).sort(), [...expectedKinds].sort());
  assert.ok(records.some((record) => record.spanKind === 'payload-validation' && record.auditRefs.includes(chain.audit.auditId)));
  assert.ok(records.some((record) => record.spanKind === 'repair-rerun' && record.repairRefs.includes(executorResult.executorRef.ref)));

  const limitedRecords = await readValidationRepairTelemetrySpanRecords({ workspacePath, limit: 2 });
  assert.equal(limitedRecords.length, 2);

  const summary = await buildValidationRepairTelemetrySummary({
    workspacePath,
    now: () => new Date('2026-05-10T00:00:02.000Z'),
  });
  assert.equal(summary.kind, 'validation-repair-telemetry-summary');
  assert.equal(summary.sourceRef, writeResult.ref);
  assert.equal(summary.generatedAt, '2026-05-10T00:00:02.000Z');
  assert.equal(summary.totalSpans, expectedKinds.length);
  assert.equal(summary.spanKindCounts['payload-validation'], 1);
  assert.equal(summary.spanKindCounts['repair-rerun'], 1);
  assert.deepEqual(summary.validationDecisionIds, [chain.validation.decisionId]);
  assert.deepEqual(summary.repairDecisionIds, [chain.repair.decisionId]);
  assert.deepEqual(summary.auditIds, [chain.audit.auditId]);
  assert.deepEqual(summary.executorResultIds, [executorResult.executorResultId]);
  assert.ok(summary.sourceRefs.includes('run:telemetry/output.json'));
  assert.ok(summary.auditRefs.includes(chain.audit.auditId));
  assert.ok(summary.repairRefs.includes(chain.repair.decisionId));
  assert.equal(summary.recentSpans.length, expectedKinds.length);
} finally {
  await rm(workspacePath, { recursive: true, force: true });
}

const gatewayWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-telemetry-gateway-'));
const server = createServer(async (req, res) => {
  if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: {
        session: { id: 'telemetry-gateway-context', status: 'active' },
        operationalGuidance: { summary: ['context healthy'], items: [] },
        workLayout: { strategy: 'live_only', safetyPointReached: true, segments: [] },
        workBudget: { status: 'healthy', approxCurrentWorkTokens: 80 },
        recentTurns: [],
        currentWorkEntries: [],
      },
    }));
    return;
  }
  if (!['/api/agent-server/runs', '/api/agent-server/runs/stream'].includes(String(req.url)) || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  const result = {
    ok: true,
    data: {
      run: {
        id: 'mock-agentserver-telemetry-gate-run',
        status: 'completed',
        output: {
          success: true,
          toolPayload: {
            message: 'Provider says a high-risk external publish action completed.',
            confidence: 0.92,
            claimType: 'execution',
            evidenceLevel: 'provider',
            reasoningTrace: 'action provider self-reported success before runtime verification gate',
            claims: [{
              id: 'claim.telemetry.gateway',
              text: 'The external publish action was reported complete by the provider.',
              type: 'execution',
              confidence: 0.92,
              evidenceLevel: 'provider',
              supportingRefs: [],
              opposingRefs: [],
            }],
            uiManifest: [],
            executionUnits: [{
              id: 'EU-telemetry-gateway-publish',
              status: 'done',
              tool: 'external.action-provider',
              params: JSON.stringify({ action: 'publish', target: 'telemetry-smoke' }),
            }],
            artifacts: [],
          },
        },
      },
    },
  };
  if (req.url === '/api/agent-server/runs/stream') {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.end(`${JSON.stringify({ result })}\n`);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
try {
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: 'knowledge',
    prompt: 'Publish this external update after runtime verification.',
    workspacePath: gatewayWorkspace,
    agentServerBaseUrl: `http://127.0.0.1:${address.port}`,
    verificationPolicy: {
      required: true,
      mode: 'hybrid',
      riskLevel: 'high',
      reason: 'telemetry smoke high-risk external side effect',
    },
    uiState: {
      freshTaskGeneration: true,
      forceAgentServerGeneration: true,
    },
  });
  assert.equal(result.verificationResults?.[0]?.verdict, 'needs-human');
  assert.equal(result.executionUnits[0]?.status, 'needs-human');
  const telemetryRefs = (result as typeof result & {
    refs?: { validationRepairTelemetry?: Array<{ ref?: string; spanKinds?: string[]; recordRefs?: string[] }> };
  }).refs?.validationRepairTelemetry ?? [];
  assert.equal(telemetryRefs[0]?.ref, '.sciforge/validation-repair-telemetry/spans.jsonl');
  assert.ok(telemetryRefs[0]?.spanKinds?.includes('verification-gate'));
  assert.ok((telemetryRefs[0]?.recordRefs?.length ?? 0) > 0);

  const gatewayRecords = await readValidationRepairTelemetrySpanRecords({ workspacePath: gatewayWorkspace });
  assert.ok(gatewayRecords.some((record) => record.spanKind === 'verification-gate' && record.validationDecisionId));
  assert.ok(gatewayRecords.some((record) => record.spanKind === 'repair-decision' && record.repairDecisionId));
  assert.ok(gatewayRecords.some((record) => record.span.failureKind === 'runtime-verification'));
  const gatewaySummary = await buildValidationRepairTelemetrySummary({ workspacePath: gatewayWorkspace });
  assert.equal(gatewaySummary.sourceRef, '.sciforge/validation-repair-telemetry/spans.jsonl');
  assert.equal(gatewaySummary.totalSpans, gatewayRecords.length);
  assert.ok((gatewaySummary.spanKindCounts['verification-gate'] ?? 0) >= 1);
  assert.ok(gatewaySummary.auditIds.length >= 1);
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(gatewayWorkspace, { recursive: true, force: true });
}

const observeWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-telemetry-observe-runtime-'));
try {
  const observeNow = () => new Date('2026-05-10T00:00:03.000Z');
  const observeProvider: ObserveProviderRuntime = {
    contract: {
      id: 'local.vision-sense',
      acceptedModalities: ['screenshot'],
      outputKind: 'text',
    },
    async invoke(input) {
      return {
        status: 'ok',
        text: 'Window title is SciForge telemetry smoke.',
        artifactRefs: input.modalities.map((modality) => modality.ref),
        traceRef: `${input.callRef}:trace`,
        compactSummary: 'Observed SciForge telemetry smoke window title.',
      };
    },
  };
  const observePlan = buildObserveInvocationPlan({
    goal: 'Record observe telemetry for provider success and failure',
    runRef: 'run:observe-telemetry-smoke',
    providers: [
      observeProvider.contract,
      { id: 'local.missing-ocr', acceptedModalities: ['image'], outputKind: 'text' },
    ],
    intents: [
      {
        providerId: 'local.vision-sense',
        instruction: 'Read the visible window title',
        modalities: [{ kind: 'screenshot', ref: 'artifact:observe-success-screenshot', mimeType: 'image/png' }],
      },
      {
        providerId: 'local.missing-ocr',
        instruction: 'Read the embedded figure label',
        modalities: [{ kind: 'image', ref: 'artifact:observe-missing-provider-image', mimeType: 'image/png' }],
      },
    ],
  });
  const observeRecords = await runObserveInvocationPlan(observePlan, [observeProvider], {
    validationRepairTelemetrySink: {
      workspacePath: observeWorkspace,
      now: observeNow,
      readSummary: true,
    },
  });
  assert.deepEqual(observeRecords.map((record) => record.status), ['ok', 'failed']);
  assert.ok(observeRecords.every((record) => record.refs?.validationRepairTelemetry?.[0]?.spanKinds.includes('observe-invocation')));
  assert.equal(observeRecords[0]?.validationRepairTelemetrySummary?.spanKindCounts['observe-invocation'], 1);
  assert.equal(observeRecords[1]?.validationRepairTelemetrySummary?.spanKindCounts['observe-invocation'], 2);

  const observeTelemetryRecords = await readValidationRepairTelemetrySpanRecords({ workspacePath: observeWorkspace });
  assert.equal(observeTelemetryRecords.length, 2);
  assert.ok(observeTelemetryRecords.some((record) => record.spanKind === 'observe-invocation' && record.span.status === 'accepted'));
  assert.ok(observeTelemetryRecords.some((record) => record.spanKind === 'observe-invocation' && record.span.status === 'repair-requested'));
  assert.ok(observeTelemetryRecords.some((record) => record.sourceRefs.includes('run:observe-telemetry-smoke:observe:001:trace')));
  assert.ok(observeTelemetryRecords.some((record) => record.sourceRefs.includes('observe-invocation:run:observe-telemetry-smoke:observe:002')));

  const observeSummary = await buildValidationRepairTelemetrySummary({ workspacePath: observeWorkspace });
  assert.equal(observeSummary.sourceRef, '.sciforge/validation-repair-telemetry/spans.jsonl');
  assert.equal(observeSummary.spanKindCounts['observe-invocation'], 2);
  assert.equal(observeSummary.totalSpans, 2);
} finally {
  await rm(observeWorkspace, { recursive: true, force: true });
}

console.log('[ok] validation/repair telemetry sink projects, persists, and runtime gateway writes verification-gate spans into stable jsonl');

function blockingFinding(id: string): ValidationFinding {
  return {
    id: `finding:${id}`,
    source: 'harness',
    kind: 'payload-schema',
    severity: 'blocking',
    message: 'Payload did not satisfy the required schema.',
    contractId: 'sciforge.tool-payload.v1',
    schemaPath: 'src/runtime/gateway/tool-payload-contract.ts',
    capabilityId: 'agentserver.direct-payload',
    relatedRefs: [`run:${id}/output.json`, 'payload-validation:failed'],
    recoverActions: ['rerun the generation request', 'preserve payload validation failure in audit'],
    issues: [{
      path: 'claims',
      message: 'claims is missing.',
      expected: 'non-empty claims array',
      actual: 'undefined',
    }],
  };
}
