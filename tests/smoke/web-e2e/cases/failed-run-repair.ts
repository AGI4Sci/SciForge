import { writeFile } from 'node:fs/promises';

import {
  createAuditRecord,
  createValidationDecision,
  decideRepairPolicy,
  type AuditRecord,
  type RepairDecision,
  type ValidationDecision,
  type ValidationFinding,
} from '@sciforge-ui/runtime-contract/validation-repair-audit';
import type { SciForgeSession } from '@sciforge-ui/runtime-contract';

import type { ConversationProjection } from '../../../../src/runtime/conversation-kernel/index.js';
import {
  artifactDeliveryManifestFromSession,
  runAuditFromSession,
  type WebE2eBrowserVisibleState,
  type WebE2eContractVerifierInput,
  type WebE2eRunAuditEvidence,
} from '../contract-verifier.js';
import { buildWebE2eFixtureWorkspace } from '../fixture-workspace-builder.js';
import { startScriptableAgentServerMock } from '../scriptable-agentserver-mock.js';
import type {
  JsonRecord,
  ScriptableAgentServerMockHandle,
  ScriptableAgentServerProvider,
  WebE2eExpectedProjection,
  WebE2eFixtureWorkspace,
} from '../types.js';

export type FailedRunRepairFailureMode = 'provider-unavailable' | 'schema-validation';

export interface FailedRunRepairCaseResult {
  fixture: WebE2eFixtureWorkspace;
  server: ScriptableAgentServerMockHandle;
  failureMode: FailedRunRepairFailureMode;
  failureSignature: FailedRunRepairFailureSignature;
  recoverActions: string[];
  repairPolicy: RepairDecision;
  validation: ValidationDecision;
  audit: AuditRecord;
  runAudit: WebE2eRunAuditEvidence;
  browserVisibleState: WebE2eBrowserVisibleState;
  verifierInput: WebE2eContractVerifierInput;
}

export interface FailedRunRepairFailureSignature {
  schemaVersion: 'sciforge.failure-signature.v1';
  id: string;
  kind: 'external-transient' | 'schema-drift';
  dedupeKey: string;
  layer: 'external-provider' | 'payload-contract';
  retryable: boolean;
  message: string;
  normalizedMessage: string;
  operation: string;
  refs: string[];
}

const now = '2026-05-16T00:00:00.000Z';
const caseId = 'SA-WEB-04';
const initialPrompt = '制造一次 provider unavailable 或 schema validation failure，并保留当前 refs。';
const repairPrompt = '解释失败，不重跑无关步骤，再继续修复。';

export async function buildFailedRunRepairCase(
  options: { baseDir?: string; failureMode?: FailedRunRepairFailureMode } = {},
): Promise<FailedRunRepairCaseResult> {
  const failureMode = options.failureMode ?? 'provider-unavailable';
  const failure = failureDefinition(failureMode);
  const server = await startScriptableAgentServerMock({
    seed: `web-e2e-${caseId}-${failureMode}`,
    fixedNow: now,
    discovery: { providers: discoveryProviders(failureMode) },
    script: (request, exchange) => {
      if (exchange.requestIndex === 1) {
        return {
          id: `${caseId}-repair-continuation`,
          runId: `agentserver-${caseId}-repair`,
          steps: [
            {
              kind: 'degraded',
              message: 'Repair continuation resumed from preserved failure refs and skipped unrelated completed steps.',
              reason: 'explicit-repair-continuation',
              recoverActions: failure.recoverActions,
            },
          ],
        };
      }
      return {
        id: `${caseId}-initial-failure`,
        runId: `agentserver-${caseId}-initial`,
        steps: [
          {
            kind: 'failure',
            message: failure.message,
            code: failure.code,
            recoverActions: failure.recoverActions,
            details: {
              failureClass: failure.failureClass,
              recoverability: failure.recoverability,
              owner: failure.owner,
              failureSignature: jsonRecord(failure.signature),
              currentTurnRef: 'message:msg-sa-web-04-user-current',
              runAuditRefs: failure.runAuditRefs,
              originalPrompt: String(request.prompt ?? ''),
            },
          },
        ],
      };
    },
  });

  const fixture = await buildWebE2eFixtureWorkspace({
    caseId,
    baseDir: options.baseDir,
    now,
    prompt: initialPrompt,
    agentServerBaseUrl: server.baseUrl,
    providerCapabilities: fixtureProviderCapabilities(failureMode),
    sessionId: 'session-sa-web-04',
    scenarioId: 'scenario-sa-web-04',
    runId: 'run-sa-web-04-failed',
  });

  const initialRun = await fetchRun(server.baseUrl, {
    prompt: initialPrompt,
    currentTurnRef: fixture.expectedProjection.currentTask.currentTurnRef.ref,
    explicitRefs: fixture.expectedProjection.currentTask.explicitRefs.map((ref) => ref.ref),
  });
  await fetchRun(server.baseUrl, {
    prompt: repairPrompt,
    continueFromRunId: fixture.runId,
    failureSignature: failure.signature.id,
    skipUnrelatedCompletedSteps: true,
    preserveRefs: failure.runAuditRefs,
  });

  const validation = createValidationDecision({
    decisionId: `validation:${caseId}:${failureMode}`,
    subject: {
      kind: 'direct-payload',
      id: fixture.runId,
      capabilityId: failure.capabilityId,
      contractId: failure.contractId,
      completedPayloadRef: `run:${fixture.runId}/output.json`,
      artifactRefs: [],
      currentRefs: [
        fixture.expectedProjection.currentTask.currentTurnRef.ref,
        ...fixture.expectedProjection.currentTask.explicitRefs.map((ref) => ref.ref),
      ],
    },
    findings: [validationFinding(failure)],
    relatedRefs: failure.runAuditRefs,
    createdAt: now,
  });
  const repairPolicy = decideRepairPolicy({
    decisionId: `repair:${caseId}:${failureMode}`,
    validation,
    budget: {
      maxAttempts: 1,
      remainingAttempts: 0,
      maxSupplementAttempts: 0,
      remainingSupplementAttempts: 0,
    },
    allowSupplement: false,
    allowHumanEscalation: false,
    createdAt: now,
  });
  const audit = createAuditRecord({
    auditId: `audit:${caseId}:${failureMode}`,
    validation,
    repair: repairPolicy,
    sinkRefs: [`run:${fixture.runId}/audit`, ...failure.runAuditRefs],
    telemetrySpanRefs: [`span:${caseId}:failure-normalized`, `span:${caseId}:repair-policy-circuit-breaker`],
    createdAt: now,
  });

  const expectedProjection = withFailedRepairProjection(fixture.expectedProjection, {
    failure,
    repairPolicy,
    audit,
  });
  const session = withFailedRepairSession(fixture.workspaceState.sessionsByScenario[fixture.scenarioId], {
    expectedProjection,
    failure,
    repairPolicy,
    audit,
    initialResultRun: initialRun.resultRun,
  });
  fixture.expectedProjection = expectedProjection;
  fixture.workspaceState.sessionsByScenario[fixture.scenarioId] = session;
  await writeJson(fixture.expectedProjectionPath, expectedProjection);
  await writeJson(fixture.workspaceStatePath, fixture.workspaceState);

  const runAudit = {
    ...runAuditFromSession(session, expectedProjection),
    refs: uniqueStrings([
      ...runAuditFromSession(session, expectedProjection).refs,
      ...failure.runAuditRefs,
      failure.signature.id,
      validation.decisionId,
      repairPolicy.decisionId,
      audit.auditId,
    ]),
  };
  const browserVisibleState = browserVisibleStateFromExpected(expectedProjection);

  return {
    fixture,
    server,
    failureMode,
    failureSignature: failure.signature,
    recoverActions: failure.recoverActions,
    repairPolicy,
    validation,
    audit,
    runAudit,
    browserVisibleState,
    verifierInput: {
      caseId,
      expected: expectedProjection,
      browserVisibleState,
      kernelProjection: expectedProjection.conversationProjection,
      sessionBundle: { session, workspaceState: fixture.workspaceState },
      runAudit,
      artifactDeliveryManifest: artifactDeliveryManifestFromSession(session, expectedProjection),
    },
  };
}

function failureDefinition(failureMode: FailedRunRepairFailureMode) {
  const baseRefs = [
    'artifact:fixture-run-audit',
    'artifact:fixture-diagnostic-log',
    'file:.sciforge/task-results/current-run-audit.json',
    'file:.sciforge/provider-manifest.json',
  ];
  if (failureMode === 'schema-validation') {
    const signature: FailedRunRepairFailureSignature = {
      schemaVersion: 'sciforge.failure-signature.v1',
      id: 'failure:sa-web-04-schema-validation',
      kind: 'schema-drift',
      dedupeKey: 'schema-drift:tool-payload:missing-artifacts',
      layer: 'payload-contract',
      retryable: true,
      message: 'ToolPayload schema validation failed: artifacts must be an array and executionUnits[0].status is invalid.',
      normalizedMessage: 'toolpayload schema validation failed artifacts must be array executionunits status invalid',
      operation: 'tool-payload-validation',
      refs: baseRefs,
    };
    return {
      code: 'schema-validation-failure',
      message: signature.message,
      failureClass: 'schema-validation',
      recoverability: 'repairable-with-bounded-rerun',
      owner: 'payload-contract',
      capabilityId: 'agentserver.direct-payload',
      contractId: 'sciforge.tool-payload.v1',
      signature,
      runAuditRefs: baseRefs,
      recoverActions: [
        'Explain the schema validation failure with the preserved RunAudit refs before attempting repair.',
        'Do not rerun completed retrieval or workspace-read steps that already have artifact refs.',
        'Continue repair from the failed payload ref using bounded refs/digests only.',
      ],
    };
  }
  const signature: FailedRunRepairFailureSignature = {
    schemaVersion: 'sciforge.failure-signature.v1',
    id: 'failure:sa-web-04-provider-unavailable',
    kind: 'external-transient',
    dedupeKey: 'external-transient:web-search:provider-unavailable',
    layer: 'external-provider',
    retryable: true,
    message: 'Provider web_search is unavailable; route was blocked before unrelated steps could rerun.',
    normalizedMessage: 'provider web search unavailable route blocked before unrelated steps rerun',
    operation: 'provider-route:web_search',
    refs: baseRefs,
  };
  return {
    code: 'provider-unavailable',
    message: signature.message,
    failureClass: 'provider-unavailable',
    recoverability: 'retry-after-provider-recovers',
    owner: 'external-provider',
    capabilityId: 'sciforge.web-worker.web_search',
    contractId: 'sciforge.provider-route.v1',
    signature,
    runAuditRefs: baseRefs,
    recoverActions: [
      'Explain provider unavailability with the preserved RunAudit refs before attempting repair.',
      'Do not rerun completed workspace-read or artifact materialization steps.',
      'Continue repair only from the failureSignature and explicit artifact refs after user confirmation.',
    ],
  };
}

function withFailedRepairProjection(
  expected: WebE2eExpectedProjection,
  input: {
    failure: ReturnType<typeof failureDefinition>;
    repairPolicy: RepairDecision;
    audit: AuditRecord;
  },
): WebE2eExpectedProjection {
  const failure = input.failure;
  const projection: ConversationProjection = {
    ...expected.conversationProjection,
    visibleAnswer: {
      status: 'repair-needed',
      text: `${failure.message} RepairPolicy circuit breaker stopped auto-rerun; user requested explanation and scoped continuation.`,
      artifactRefs: expected.artifactDelivery.primaryArtifactRefs,
      diagnostic: failure.signature.id,
    },
    activeRun: { id: expected.runId, status: 'repair-needed' },
    executionProcess: [
      ...expected.conversationProjection.executionProcess,
      {
        eventId: 'execution-unit:EU-sa-web-04-failed-route',
        type: 'ExternalBlocked',
        summary: failure.message,
        timestamp: now,
      },
      {
        eventId: 'repair-policy:sa-web-04-circuit-breaker',
        type: 'VerificationRecorded',
        summary: `RepairPolicy action=${input.repairPolicy.action}; no unrelated steps were rerun.`,
        timestamp: now,
      },
    ],
    recoverActions: failure.recoverActions,
    verificationState: {
      status: 'failed',
      verifierRef: input.audit.auditId,
      verdict: failure.message,
    },
    auditRefs: uniqueStrings([
      ...expected.conversationProjection.auditRefs,
      ...failure.runAuditRefs,
      failure.signature.id,
      input.repairPolicy.decisionId,
      input.audit.auditId,
    ]),
    diagnostics: [
      ...expected.conversationProjection.diagnostics,
      {
        severity: 'error',
        code: failure.code,
        message: failure.message,
        refs: failure.runAuditRefs.map((ref) => ({ ref })),
      },
    ],
  };
  return {
    ...expected,
    conversationProjection: projection,
    runAuditRefs: uniqueStrings([
      ...expected.runAuditRefs,
      ...failure.runAuditRefs,
      failure.signature.id,
      input.repairPolicy.decisionId,
      input.audit.auditId,
    ]),
  };
}

function withFailedRepairSession(
  session: SciForgeSession,
  input: {
    expectedProjection: WebE2eExpectedProjection;
    failure: ReturnType<typeof failureDefinition>;
    repairPolicy: RepairDecision;
    audit: AuditRecord;
    initialResultRun: JsonRecord;
  },
): SciForgeSession {
  const nextSession = structuredClone(session);
  const run = nextSession.runs.find((candidate) => candidate.id === input.expectedProjection.runId);
  if (!run) throw new Error(`missing run ${input.expectedProjection.runId}`);
  const raw = run.raw && typeof run.raw === 'object' ? run.raw as JsonRecord : {};
  const resultPresentation = raw.resultPresentation && typeof raw.resultPresentation === 'object'
    ? raw.resultPresentation as JsonRecord
    : {};
  run.status = 'failed';
  run.response = input.expectedProjection.conversationProjection.visibleAnswer?.text ?? input.failure.message;
  run.raw = {
    ...raw,
    failureReason: input.failure.message,
    recoverActions: input.failure.recoverActions,
    failureSignature: input.failure.signature,
    repairPolicy: input.repairPolicy,
    validationDecision: input.audit.validationDecisionId,
    runAudit: input.audit,
    agentServerRun: input.initialResultRun,
    displayIntent: {
      ...(raw.displayIntent && typeof raw.displayIntent === 'object' ? raw.displayIntent as JsonRecord : {}),
      conversationProjection: input.expectedProjection.conversationProjection,
    },
    resultPresentation: {
      ...resultPresentation,
      conversationProjection: input.expectedProjection.conversationProjection,
      taskRunCard: taskRunCard(input),
    },
  };
  nextSession.executionUnits = [
    ...(nextSession.executionUnits ?? []),
    {
      id: 'EU-sa-web-04-failed-route',
      tool: input.failure.capabilityId,
      params: 'explain-failure=true skipUnrelatedCompletedSteps=true',
      status: 'failed',
      hash: input.failure.signature.dedupeKey,
      runId: input.expectedProjection.runId,
      outputRef: '.sciforge/task-results/current-run-audit.json',
      outputArtifacts: ['fixture-run-audit', 'fixture-diagnostic-log'],
      failureReason: input.failure.message,
      recoverActions: input.failure.recoverActions,
      time: now,
    },
  ];
  nextSession.updatedAt = now;
  return nextSession;
}

function taskRunCard(input: {
  expectedProjection: WebE2eExpectedProjection;
  failure: ReturnType<typeof failureDefinition>;
  repairPolicy: RepairDecision;
  audit: AuditRecord;
}) {
  return {
    schemaVersion: 'sciforge.task-run-card.v1',
    id: `task-card:${caseId}`,
    goal: repairPrompt,
    status: 'needs-work',
    protocolStatus: 'protocol-failed',
    taskOutcome: 'needs-work',
    refs: input.failure.runAuditRefs.map((ref) => ({ kind: ref.startsWith('artifact:') ? 'artifact' : 'file', ref })),
    executionUnitRefs: ['execution-unit:EU-sa-web-04-failed-route'],
    verificationRefs: [input.audit.auditId],
    failureSignatures: [input.failure.signature],
    genericAttributionLayer: input.failure.signature.layer,
    repairPolicy: {
      decisionId: input.repairPolicy.decisionId,
      action: input.repairPolicy.action,
      circuitBreaker: input.repairPolicy.action === 'fail-closed',
      reason: 'repair budget exhausted before any automatic rerun; explicit user continuation is required.',
    },
    recoverActions: input.failure.recoverActions,
    nextStep: input.failure.recoverActions[0],
    updatedAt: now,
  };
}

function validationFinding(failure: ReturnType<typeof failureDefinition>): ValidationFinding {
  return {
    id: `finding:${failure.signature.id.replace(/^failure:/, '')}`,
    source: 'harness',
    kind: failure.signature.layer === 'payload-contract' ? 'payload-schema' : 'runtime-verification',
    severity: 'blocking',
    message: failure.message,
    contractId: failure.contractId,
    schemaPath: failure.signature.layer === 'payload-contract'
      ? 'src/runtime/gateway/tool-payload-contract.ts'
      : 'src/runtime/gateway/capability-provider-preflight.ts',
    capabilityId: failure.capabilityId,
    relatedRefs: failure.runAuditRefs,
    recoverActions: failure.recoverActions,
    issues: [{ path: failure.signature.operation, message: failure.message }],
  };
}

async function fetchRun(baseUrl: string, body: JsonRecord) {
  const response = await fetch(`${baseUrl}/api/agent-server/runs/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`AgentServer mock run failed: ${response.status} ${response.statusText}`);
  const envelopes = (await response.text()).trim().split('\n').map((line) => JSON.parse(line) as JsonRecord);
  const resultEnvelope = envelopes.find((envelope) => envelope.result) as JsonRecord | undefined;
  if (!resultEnvelope) throw new Error('AgentServer mock run did not emit a result envelope');
  const result = resultEnvelope.result as JsonRecord;
  const data = result.data as JsonRecord;
  return {
    envelopes,
    events: envelopes.map((envelope) => envelope.event).filter(Boolean) as JsonRecord[],
    resultRun: data.run as JsonRecord,
  };
}

function browserVisibleStateFromExpected(expected: WebE2eExpectedProjection): WebE2eBrowserVisibleState {
  const answer = expected.conversationProjection.visibleAnswer;
  return {
    status: answer?.status,
    visibleAnswerText: answer?.text,
    primaryArtifactRefs: expected.artifactDelivery.primaryArtifactRefs,
    supportingArtifactRefs: expected.artifactDelivery.supportingArtifactRefs,
    visibleArtifactRefs: [
      ...expected.artifactDelivery.primaryArtifactRefs,
      ...expected.artifactDelivery.supportingArtifactRefs,
    ],
    auditRefs: [],
    diagnosticRefs: [],
    internalRefs: [],
    recoverActions: expected.conversationProjection.recoverActions,
    nextStep: expected.conversationProjection.recoverActions[0],
  };
}

function fixtureProviderCapabilities(failureMode: FailedRunRepairFailureMode) {
  return [
    {
      id: 'sciforge.web-worker.web_search',
      providerId: 'sciforge.web-worker.web_search',
      capabilityId: 'web_search',
      workerId: 'sciforge.web-worker',
      status: failureMode === 'provider-unavailable' ? 'unavailable' as const : 'available' as const,
      fixtureMode: 'scripted-mock' as const,
    },
    {
      id: 'sciforge.workspace-reader.read_ref',
      providerId: 'sciforge.workspace-reader.read_ref',
      capabilityId: 'read_ref',
      workerId: 'sciforge.workspace-reader',
      status: 'available' as const,
      fixtureMode: 'scripted-mock' as const,
    },
  ];
}

function discoveryProviders(failureMode: FailedRunRepairFailureMode): ScriptableAgentServerProvider[] {
  return fixtureProviderCapabilities(failureMode).map((provider) => ({
    id: provider.id,
    providerId: provider.providerId,
    capabilityId: provider.capabilityId,
    workerId: provider.workerId,
    status: provider.status,
  }));
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function uniqueStrings(values: readonly string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function jsonRecord(value: unknown): JsonRecord {
  return JSON.parse(JSON.stringify(value)) as JsonRecord;
}
