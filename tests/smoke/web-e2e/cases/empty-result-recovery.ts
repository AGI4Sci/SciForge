import type {
  ObjectReference,
  RuntimeExecutionUnit,
  SciForgeMessage,
  SciForgeRun,
  SciForgeSession,
} from '@sciforge-ui/runtime-contract';
import type { ConversationProjection } from '../../../../src/runtime/conversation-kernel/index.js';
import {
  assertWebE2eContract,
  verifyWebE2eContract,
  type WebE2eBrowserVisibleState,
  type WebE2eContractVerifierInput,
  type WebE2eRunAuditEvidence,
} from '../contract-verifier.js';
import { startScriptableAgentServerMock } from '../scriptable-agentserver-mock.js';
import type {
  JsonRecord,
  ScriptableAgentServerRecordedRequest,
  ScriptableAgentServerToolPayload,
  WebE2eArtifactDeliveryProjection,
  WebE2eExpectedProjection,
  WebE2eInitialRef,
  WebE2eWorkspaceState,
} from '../types.js';

export const EMPTY_RESULT_RECOVERY_CASE_ID = 'SA-WEB-06-empty-result-recovery';

const now = '2026-05-16T00:00:00.000Z';
const scenarioId = 'sa-web-06-empty-result-recovery-scenario';
const sessionId = 'session-sa-web-06-empty-result-recovery';
const firstRunId = 'run-sa-web-06-empty-result';
const followUpRunId = 'run-sa-web-06-followup-expanded-query';
const firstTurnId = 'msg-sa-web-06-empty-result-user';
const followUpTurnId = 'msg-sa-web-06-followup-user';
const providerManifestRef = 'agentserver://mock/provider-manifest/web-search';
const narrowQuery = '"single-cell cryogenic tardigrade epigenome" site:example.invalid 2026';
const expandedQuery = 'tardigrade epigenome stress response single-cell literature';
const firstFailureEvidenceRefs = [
  `run:${firstRunId}`,
  'execution-unit:EU-SA-WEB-06-empty-search',
  'agentserver://mock/web_search/empty-result/results-empty.json',
  '.sciforge/task-results/sa-web-06-empty-result-failure.json',
];
const followUpEvidenceRefs = [
  ...firstFailureEvidenceRefs,
  `run:${followUpRunId}`,
  'execution-unit:EU-SA-WEB-06-expanded-search',
  'agentserver://mock/web_search/expanded-query/reused-empty-result-evidence.json',
];
const recoverActions = [
  'broaden-query',
  'ask-user-to-confirm-scope',
  'reuse-empty-result-failure-evidence',
];
const emptyResultText = 'Recoverable empty-result from web_search: the narrow query returned zero results and needs human-guided scope expansion.';
const followUpText = 'Needs human review after expanding the query; the follow-up preserved the previous empty-result failure evidence instead of presenting a completed report.';

export interface EmptyResultRecoveryCaseResult {
  firstInput: WebE2eContractVerifierInput;
  followUpInput: WebE2eContractVerifierInput;
  firstRun: MockRunFetchResult;
  followUpRun: MockRunFetchResult;
  firstFailureEvidenceRefs: string[];
  recordedRunRequests: ScriptableAgentServerRecordedRequest[];
  narrowQuery: string;
  expandedQuery: string;
}

export interface EmptyResultRecoveryVerificationResult {
  ok: boolean;
  failures: string[];
}

interface MockRunFetchResult {
  envelopes: JsonRecord[];
  events: JsonRecord[];
  resultRun: JsonRecord;
}

export async function buildEmptyResultRecoveryCase(): Promise<EmptyResultRecoveryCaseResult> {
  const server = await startScriptableAgentServerMock({
    seed: EMPTY_RESULT_RECOVERY_CASE_ID,
    fixedNow: now,
    script: (_request, exchange) => {
      if (exchange.requestIndex === 1) {
        return {
          id: 'sa-web-06-empty-result',
          runId: firstRunId,
          steps: [
            {
              kind: 'event',
              event: {
                type: 'tool-call',
                providerId: 'sciforge.web-worker.web_search',
                capabilityId: 'web_search',
                query: narrowQuery,
                status: 'empty-result',
                results: [],
                evidenceRefs: firstFailureEvidenceRefs,
              },
            },
            {
              kind: 'toolPayload',
              runStatus: 'failed',
              payload: emptyResultPayload(),
            },
          ],
        };
      }
      return {
        id: 'sa-web-06-followup-expanded-query',
        runId: followUpRunId,
        steps: [
          {
            kind: 'event',
            event: {
              type: 'tool-call',
              providerId: 'sciforge.web-worker.web_search',
              capabilityId: 'web_search',
              query: expandedQuery,
              status: 'needs-human',
              previousFailureEvidenceRefs: firstFailureEvidenceRefs,
              evidenceRefs: followUpEvidenceRefs,
            },
          },
          {
            kind: 'toolPayload',
            runStatus: 'failed',
            payload: followUpPayload(),
          },
        ],
      };
    },
  });

  try {
    const firstRun = await fetchRun(server.baseUrl, {
      prompt: `Find papers for ${narrowQuery} and write a report.`,
      query: narrowQuery,
      expectedArtifactTypes: ['research-report'],
    });
    const followUpRun = await fetchRun(server.baseUrl, {
      prompt: `Broaden the query to ${expandedQuery}; reuse the previous empty-result evidence.`,
      query: expandedQuery,
      previousFailureEvidenceRefs: firstFailureEvidenceRefs,
      expectedArtifactTypes: ['research-report'],
    });
    const workspaceState = workspaceStateForCase();
    const firstInput = verifierInput({
      workspaceState,
      runId: firstRunId,
      turnRef: currentTurnRef(firstTurnId),
      explicitRefs: [],
      projection: emptyResultProjection(),
      auditRefs: firstFailureEvidenceRefs,
      visibleText: emptyResultText,
    });
    const followUpInput = verifierInput({
      workspaceState,
      runId: followUpRunId,
      turnRef: currentTurnRef(followUpTurnId),
      explicitRefs: failureEvidenceInitialRefs(),
      projection: followUpProjection(),
      auditRefs: followUpEvidenceRefs,
      visibleText: followUpText,
    });

    assertWebE2eContract(firstInput);
    assertWebE2eContract(followUpInput);

    return {
      firstInput,
      followUpInput,
      firstRun,
      followUpRun,
      firstFailureEvidenceRefs: [...firstFailureEvidenceRefs],
      recordedRunRequests: [...server.requests.runs],
      narrowQuery,
      expandedQuery,
    };
  } finally {
    await server.close();
  }
}

export function verifyEmptyResultRecoveryCase(result: EmptyResultRecoveryCaseResult): EmptyResultRecoveryVerificationResult {
  const failures = [
    ...verifyWebE2eContract(result.firstInput).failures.map((failure) => `first run: ${failure}`),
    ...verifyWebE2eContract(result.followUpInput).failures.map((failure) => `follow-up run: ${failure}`),
  ];

  assertEmptyResultProjection('first run', result.firstInput, firstFailureEvidenceRefs, failures);
  assertEmptyResultProjection('follow-up run', result.followUpInput, followUpEvidenceRefs, failures);
  assertNotCompletedReport('first mock run', result.firstRun.resultRun, failures);
  assertNotCompletedReport('follow-up mock run', result.followUpRun.resultRun, failures);
  assertMockSearchEmptyResult(result.firstRun.events, failures);
  assertFollowUpReusesFailureEvidence(result, failures);

  return { ok: failures.length === 0, failures };
}

function verifierInput(input: {
  workspaceState: WebE2eWorkspaceState;
  runId: string;
  turnRef: WebE2eInitialRef;
  explicitRefs: WebE2eInitialRef[];
  projection: ConversationProjection;
  auditRefs: string[];
  visibleText: string;
}): WebE2eContractVerifierInput {
  const expected = expectedProjection(input);
  const session = input.workspaceState.sessionsByScenario[scenarioId];
  const browserVisibleState: WebE2eBrowserVisibleState = {
    status: 'needs-human',
    visibleAnswerText: input.visibleText,
    visibleArtifactRefs: [],
    primaryArtifactRefs: [],
    supportingArtifactRefs: [],
    auditRefs: [],
    diagnosticRefs: [],
    internalRefs: [],
    recoverActions,
    nextStep: 'broaden-query',
  };
  return {
    caseId: EMPTY_RESULT_RECOVERY_CASE_ID,
    expected,
    browserVisibleState,
    kernelProjection: input.projection,
    sessionBundle: { session, workspaceState: input.workspaceState },
    runAudit: runAudit(input.runId, input.turnRef, input.explicitRefs, input.auditRefs),
    artifactDeliveryManifest: {
      schemaVersion: 'sciforge.web-e2e.artifact-delivery-manifest.v1',
      caseId: EMPTY_RESULT_RECOVERY_CASE_ID,
      runId: input.runId,
      artifactDelivery: emptyArtifactDelivery(),
    },
  };
}

function expectedProjection(input: {
  runId: string;
  turnRef: WebE2eInitialRef;
  explicitRefs: WebE2eInitialRef[];
  projection: ConversationProjection;
  auditRefs: string[];
}): WebE2eExpectedProjection {
  return {
    schemaVersion: 'sciforge.web-e2e.expected-projection.v1',
    projectionVersion: 'sciforge.conversation-projection.v1',
    caseId: EMPTY_RESULT_RECOVERY_CASE_ID,
    sessionId,
    scenarioId,
    runId: input.runId,
    currentTask: {
      currentTurnRef: input.turnRef,
      explicitRefs: input.explicitRefs,
      selectedRefs: [input.turnRef, ...input.explicitRefs],
    },
    conversationProjection: input.projection,
    artifactDelivery: emptyArtifactDelivery(),
    runAuditRefs: input.auditRefs,
    providerManifestRef,
  };
}

function workspaceStateForCase(): WebE2eWorkspaceState {
  const firstProjection = emptyResultProjection();
  const secondProjection = followUpProjection();
  const executionUnits = [
    executionUnit('EU-SA-WEB-06-empty-search', firstRunId, 'needs-human', firstFailureEvidenceRefs[3] ?? firstFailureEvidenceRefs[0]),
    executionUnit('EU-SA-WEB-06-expanded-search', followUpRunId, 'needs-human', followUpEvidenceRefs[2] ?? followUpEvidenceRefs[0]),
  ];
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId,
    scenarioId,
    title: 'SA-WEB-06 empty result recovery',
    createdAt: now,
    messages: [
      userMessage(firstTurnId, `Find papers for ${narrowQuery} and write a report.`, []),
      scenarioMessage('msg-sa-web-06-empty-result-agent', emptyResultText, firstRunId),
      userMessage(
        followUpTurnId,
        `Broaden the query to ${expandedQuery}; reuse the previous empty-result evidence.`,
        failureEvidenceObjectRefs(),
      ),
      scenarioMessage('msg-sa-web-06-followup-agent', followUpText, followUpRunId),
    ],
    runs: [
      run(firstRunId, firstProjection, emptyResultText, `Find papers for ${narrowQuery} and write a report.`),
      run(followUpRunId, secondProjection, followUpText, `Broaden the query to ${expandedQuery}; reuse the previous empty-result evidence.`),
    ],
    uiManifest: [],
    claims: [],
    executionUnits,
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: now,
  };
  return {
    schemaVersion: 2,
    workspacePath: '/tmp/sciforge-sa-web-06-empty-result-recovery',
    sessionsByScenario: { [scenarioId]: session },
    archivedSessions: [],
    alignmentContracts: [],
    timelineEvents: [],
    updatedAt: now,
  };
}

function emptyResultProjection(): ConversationProjection {
  return projection({
    runId: firstRunId,
    turnId: firstTurnId,
    prompt: `Find papers for ${narrowQuery} and write a report.`,
    text: emptyResultText,
    auditRefs: firstFailureEvidenceRefs,
    executionSummary: 'web_search returned zero results for the narrow query.',
  });
}

function followUpProjection(): ConversationProjection {
  return projection({
    runId: followUpRunId,
    turnId: followUpTurnId,
    prompt: `Broaden the query to ${expandedQuery}; reuse the previous empty-result evidence.`,
    text: followUpText,
    auditRefs: followUpEvidenceRefs,
    executionSummary: 'Expanded query preserved first-run empty-result failure evidence.',
  });
}

function projection(input: {
  runId: string;
  turnId: string;
  prompt: string;
  text: string;
  auditRefs: string[];
  executionSummary: string;
}): ConversationProjection {
  return {
    schemaVersion: 'sciforge.conversation-projection.v1',
    conversationId: sessionId,
    currentTurn: { id: input.turnId, prompt: input.prompt },
    visibleAnswer: {
      status: 'needs-human',
      text: input.text,
      artifactRefs: [],
      diagnostic: 'empty-result',
    },
    activeRun: { id: input.runId, status: 'needs-human' },
    artifacts: [],
    executionProcess: [{
      eventId: `${input.runId}:empty-result`,
      type: 'VerificationRecorded',
      summary: input.executionSummary,
      timestamp: now,
    }],
    recoverActions,
    verificationState: {
      status: 'failed',
      verdict: 'needs-human',
      verifierRef: 'agentserver://mock/web_search/empty-result-verifier',
    },
    auditRefs: input.auditRefs,
    diagnostics: [{
      severity: 'warning',
      code: 'empty-result',
      message: input.text,
      refs: input.auditRefs.map((ref) => ({ ref })),
    }],
  };
}

function emptyResultPayload(): ScriptableAgentServerToolPayload {
  return toolPayload(firstRunId, emptyResultText, emptyResultProjection(), firstFailureEvidenceRefs, 'EU-SA-WEB-06-empty-search');
}

function followUpPayload(): ScriptableAgentServerToolPayload {
  return toolPayload(followUpRunId, followUpText, followUpProjection(), followUpEvidenceRefs, 'EU-SA-WEB-06-expanded-search');
}

function toolPayload(
  runId: string,
  message: string,
  conversationProjection: ConversationProjection,
  evidenceRefs: string[],
  executionUnitId: string,
): ScriptableAgentServerToolPayload {
  return {
    message,
    confidence: 0.42,
    claimType: 'limitation',
    evidenceLevel: 'mock-agentserver',
    reasoningTrace: 'SA-WEB-06 scripted web_search empty-result recovery.',
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'needs-human',
      status: 'needs-human',
      failureCode: 'empty-result',
      recoverability: 'recoverable',
      conversationProjection: conversationProjection as unknown as JsonRecord,
    },
    claims: [],
    uiManifest: [],
    executionUnits: [{
      id: executionUnitId,
      tool: 'sciforge.web-worker.web_search',
      status: 'needs-human',
      failureReason: 'empty-result',
      recoverability: 'recoverable',
      recoverActions,
      outputRef: evidenceRefs[evidenceRefs.length - 1],
      evidenceRefs,
      runId,
    }],
    artifacts: [],
  };
}

function run(id: string, conversationProjection: ConversationProjection, response: string, prompt: string): SciForgeRun {
  return {
    id,
    scenarioId,
    status: 'failed',
    prompt,
    response,
    createdAt: now,
    completedAt: now,
    objectReferences: id === followUpRunId ? failureEvidenceObjectRefs() : [],
    raw: {
      displayIntent: {
        protocolStatus: 'protocol-success',
        taskOutcome: 'needs-human',
        status: 'needs-human',
        failureCode: 'empty-result',
        recoverability: 'recoverable',
        conversationProjection,
        taskOutcomeProjection: {
          conversationProjection,
          taskSuccess: false,
          protocolSuccess: true,
        },
      },
      resultPresentation: {
        conversationProjection,
      },
    },
  };
}

function userMessage(id: string, content: string, objectReferences: ObjectReference[]): SciForgeMessage {
  return { id, role: 'user', content, createdAt: now, status: 'completed', objectReferences };
}

function scenarioMessage(id: string, content: string, runId: string): SciForgeMessage {
  return {
    id,
    role: 'scenario',
    content,
    createdAt: now,
    status: 'failed',
    objectReferences: runId === followUpRunId ? failureEvidenceObjectRefs() : [],
  };
}

function executionUnit(id: string, runId: string, status: RuntimeExecutionUnit['status'], outputRef: string): RuntimeExecutionUnit {
  return {
    id,
    tool: 'sciforge.web-worker.web_search',
    params: `query=${runId === firstRunId ? narrowQuery : expandedQuery}`,
    status,
    hash: `${id}-empty-result`,
    runId,
    outputRef,
    failureReason: 'empty-result',
    recoverActions,
    time: now,
  };
}

function currentTurnRef(messageId: string): WebE2eInitialRef {
  return {
    id: `turn-${messageId}`,
    kind: 'user-turn',
    title: 'Current user turn',
    ref: `message:${messageId}`,
    source: 'current-turn',
  };
}

function failureEvidenceInitialRefs(): WebE2eInitialRef[] {
  return [
    {
      id: 'ref-empty-result-run',
      kind: 'run',
      title: 'Previous empty-result run',
      ref: `run:${firstRunId}`,
      source: 'run-audit',
    },
    {
      id: 'ref-empty-result-failure-json',
      kind: 'file',
      title: 'Previous empty-result failure evidence',
      ref: '.sciforge/task-results/sa-web-06-empty-result-failure.json',
      source: 'run-audit',
      artifactType: 'run-audit',
    },
  ];
}

function failureEvidenceObjectRefs(): ObjectReference[] {
  return [
    {
      id: 'object-empty-result-run',
      kind: 'run',
      title: 'Previous empty-result run',
      ref: `run:${firstRunId}`,
      runId: firstRunId,
      presentationRole: 'audit',
      actions: ['inspect'],
      status: 'available',
    },
    {
      id: 'object-empty-result-failure-json',
      kind: 'file',
      title: 'Previous empty-result failure evidence',
      ref: '.sciforge/task-results/sa-web-06-empty-result-failure.json',
      runId: firstRunId,
      presentationRole: 'diagnostic',
      actions: ['inspect', 'copy-path'],
      status: 'available',
    },
  ];
}

function emptyArtifactDelivery(): WebE2eArtifactDeliveryProjection {
  return {
    primaryArtifactRefs: [],
    supportingArtifactRefs: [],
    auditRefs: [],
    diagnosticRefs: [],
    internalRefs: [],
  };
}

function runAudit(
  runId: string,
  turnRef: WebE2eInitialRef,
  explicitRefs: WebE2eInitialRef[],
  refs: string[],
): WebE2eRunAuditEvidence {
  return {
    runId,
    refs: [...refs, providerManifestRef],
    providerManifestRef,
    currentTurnRef: turnRef.ref,
    explicitRefs: explicitRefs.map((ref) => ref.ref),
    status: 'failed',
  };
}

async function fetchRun(baseUrl: string, body: JsonRecord): Promise<MockRunFetchResult> {
  const response = await fetch(`${baseUrl}/api/agent-server/runs/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`AgentServer mock run failed with HTTP ${response.status}`);
  const lines = (await response.text()).trim().split('\n').filter(Boolean);
  const envelopes = lines.map((line) => JSON.parse(line) as JsonRecord);
  const resultEnvelope = envelopes.find((envelope) => envelope.result) as JsonRecord | undefined;
  const result = resultEnvelope?.result as JsonRecord | undefined;
  const data = result?.data as JsonRecord | undefined;
  const resultRun = data?.run as JsonRecord | undefined;
  if (!resultRun) throw new Error('AgentServer mock run stream did not include result.data.run');
  return {
    envelopes,
    events: envelopes.map((envelope) => envelope.event).filter(Boolean) as JsonRecord[],
    resultRun,
  };
}

function assertEmptyResultProjection(
  label: string,
  input: WebE2eContractVerifierInput,
  expectedRefs: string[],
  failures: string[],
) {
  const projection = input.expected.conversationProjection;
  if (input.browserVisibleState.status !== 'needs-human') {
    failures.push(`${label}: browser status must be needs-human for empty-result recovery`);
  }
  if (projection.visibleAnswer?.status !== 'needs-human') {
    failures.push(`${label}: Projection visibleAnswer.status must be needs-human`);
  }
  if (!projection.diagnostics.some((diagnostic) => diagnostic.code === 'empty-result')) {
    failures.push(`${label}: Projection diagnostics must include empty-result`);
  }
  if (!projection.recoverActions.includes('broaden-query')) {
    failures.push(`${label}: recoverActions must include broaden-query`);
  }
  if (input.expected.artifactDelivery.primaryArtifactRefs.length || input.expected.artifactDelivery.supportingArtifactRefs.length) {
    failures.push(`${label}: empty-result must not expose completed report artifact refs`);
  }
  for (const ref of expectedRefs) {
    if (!projection.auditRefs.includes(ref)) failures.push(`${label}: missing failure evidence ref ${ref}`);
  }
}

function assertNotCompletedReport(label: string, runResult: JsonRecord, failures: string[]) {
  if (runResult.status === 'completed') failures.push(`${label}: empty-result must not finish as a completed report`);
  const text = JSON.stringify(runResult);
  if (/"status":"satisfied"/.test(text)) failures.push(`${label}: empty-result must not present a satisfied Projection`);
  if (!/"failureCode":"empty-result"/.test(text) && !/"failureReason":"empty-result"/.test(text)) {
    failures.push(`${label}: terminal payload must preserve empty-result failure code`);
  }
}

function assertMockSearchEmptyResult(events: JsonRecord[], failures: string[]) {
  const event = events.find((candidate) => candidate.providerId === 'sciforge.web-worker.web_search');
  if (!event) {
    failures.push('first run: missing mock web_search event');
    return;
  }
  if (event.status !== 'empty-result') failures.push(`first run: mock web_search status must be empty-result, actual ${String(event.status)}`);
  if (!Array.isArray(event.results) || event.results.length !== 0) failures.push('first run: mock web_search must return an empty results array');
}

function assertFollowUpReusesFailureEvidence(result: EmptyResultRecoveryCaseResult, failures: string[]) {
  const followUpBody = result.recordedRunRequests[1]?.body;
  if (followUpBody?.query !== expandedQuery) failures.push('follow-up run: request must use the expanded query');
  const bodyRefs = Array.isArray(followUpBody?.previousFailureEvidenceRefs)
    ? followUpBody.previousFailureEvidenceRefs.map(String)
    : [];
  const followUpEvent = result.followUpRun.events.find((event) => event.providerId === 'sciforge.web-worker.web_search');
  const eventRefs = Array.isArray(followUpEvent?.previousFailureEvidenceRefs)
    ? followUpEvent.previousFailureEvidenceRefs.map(String)
    : [];
  for (const ref of result.firstFailureEvidenceRefs) {
    if (!bodyRefs.includes(ref)) failures.push(`follow-up run: request did not reuse previous failure evidence ${ref}`);
    if (!eventRefs.includes(ref)) failures.push(`follow-up run: mock event did not reuse previous failure evidence ${ref}`);
    if (!result.followUpInput.expected.conversationProjection.auditRefs.includes(ref)) {
      failures.push(`follow-up run: Projection auditRefs did not preserve previous failure evidence ${ref}`);
    }
  }
}
