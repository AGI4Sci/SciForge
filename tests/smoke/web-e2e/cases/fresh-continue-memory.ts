import assert from 'node:assert/strict';

import {
  AGENTSERVER_CONTEXT_REQUEST_VERSION,
  assertAgentServerContextRequest,
  canonicalSerializeAgentServerContextRequest,
  type AgentServerContextRequest,
  type ContextMode,
  type RefDescriptor,
  type SelectedRefDescriptor,
} from '../../../../src/runtime/gateway/agentserver-context-contract.js';
import type { ProjectMemoryRef } from '../../../../src/runtime/project-session-memory.js';
import type {
  RuntimeArtifact,
  SciForgeMessage,
  SciForgeRun,
} from '@sciforge-ui/runtime-contract';
import {
  artifactDeliveryManifestFromSession,
  assertWebE2eContract,
  runAuditFromSession,
  type WebE2eBrowserVisibleState,
  type WebE2eContractVerifierInput,
  type WebE2eRunAuditEvidence,
} from '../contract-verifier.js';
import {
  createWebE2eEvidenceBundleManifest,
  type WebE2eEvidenceBundleManifest,
} from '../evidence-bundle.js';
import { buildWebE2eFixtureWorkspace } from '../fixture-workspace-builder.js';
import { startScriptableAgentServerMock } from '../scriptable-agentserver-mock.js';
import type {
  JsonRecord,
  ScriptableAgentServerRecordedRequest,
  ScriptableAgentServerToolPayload,
  WebE2eArtifactDeliveryProjection,
  WebE2eExpectedProjection,
  WebE2eFixtureWorkspace,
  WebE2eInitialRef,
} from '../types.js';

export const freshContinueMemoryCaseId = 'SA-WEB-02';
export const freshContinueMemoryInitialGoal = '研究目标：比较 IL7R 高表达 T 细胞在三篇免疫治疗论文中的证据强度，并给出下一步验证计划。';
export const freshContinueMemoryRound2Prompt = '请记住我一开始的问题，并继续补充最关键的证据缺口。';
export const freshContinueMemoryRound3Prompt = '把刚才的结论换成三列表格：证据、风险、下一步。';
export const freshContinueMemoryStableGoalRef = 'projection:sa-web-02-stable-goal';
export const freshContinueMemoryOldArtifactRef = 'artifact:fixture-old-report';
export const freshContinueMemoryCurrentArtifactRef = 'artifact:sa-web-02-current-format-table';

type RoundId = 'round-1-fresh' | 'round-2-continue' | 'round-3-format';
type StableGoalSource = 'explicit' | 'backend-proposal' | 'projection-primary' | 'context-index' | 'artifact-heuristic';

interface FreshContinueMemoryRound {
  roundId: RoundId;
  prompt: string;
  stableGoalSource?: StableGoalSource;
  contextRequest: AgentServerContextRequest;
  body: JsonRecord;
}

export interface FreshContinueMemoryCaseResult {
  fixture: WebE2eFixtureWorkspace;
  rounds: FreshContinueMemoryRound[];
  recordedRunRequests: ScriptableAgentServerRecordedRequest[];
  resultRuns: JsonRecord[];
  toolPayloads: JsonRecord[];
  browserVisibleState: WebE2eBrowserVisibleState;
  runAudit: WebE2eRunAuditEvidence;
  contractInput: WebE2eContractVerifierInput;
  evidenceBundle: WebE2eEvidenceBundleManifest;
}

export async function runFreshContinueMemoryCase(options: {
  baseDir?: string;
  outputRoot?: string;
  now?: string;
} = {}): Promise<FreshContinueMemoryCaseResult> {
  const now = options.now ?? '2026-05-16T00:00:00.000Z';
  const agentServer = await startScriptableAgentServerMock({
    seed: freshContinueMemoryCaseId,
    fixedNow: now,
    script(request) {
      const roundId = String(request.roundId) as RoundId;
      return {
        id: roundId,
        runId: runIdForRound(roundId),
        steps: [
          { kind: 'status', status: 'running', message: `Running ${roundId}.` },
          { kind: 'toolPayload', payload: toolPayloadForRound(roundId, now) },
        ],
      };
    },
  });

  try {
    const fixture = withFreshContinueMemoryProjection(await buildWebE2eFixtureWorkspace({
      caseId: freshContinueMemoryCaseId,
      baseDir: options.baseDir,
      now,
      prompt: freshContinueMemoryRound3Prompt,
      agentServerBaseUrl: agentServer.baseUrl,
      runId: runIdForRound('round-3-format'),
    }), now);

    const rounds: FreshContinueMemoryRound[] = [
      buildRound(fixture, 'round-1-fresh', freshContinueMemoryInitialGoal, 'fresh', undefined),
      buildRound(fixture, 'round-2-continue', freshContinueMemoryRound2Prompt, 'continue', 'backend-proposal'),
      buildRound(fixture, 'round-3-format', freshContinueMemoryRound3Prompt, 'continue', 'backend-proposal'),
    ];
    const resultRuns: JsonRecord[] = [];
    const toolPayloads: JsonRecord[] = [];
    for (const round of rounds) {
      const run = await fetchRun(agentServer.baseUrl, round.body);
      resultRuns.push(run.resultRun);
      toolPayloads.push(extractToolPayload(run.resultRun));
    }

    const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
    const browserVisibleState = browserVisibleStateFromExpected(fixture.expectedProjection);
    const runAudit = runAuditFromSession(session, fixture.expectedProjection);
    const contractInput: WebE2eContractVerifierInput = {
      caseId: fixture.caseId,
      expected: fixture.expectedProjection,
      browserVisibleState,
      kernelProjection: fixture.expectedProjection.conversationProjection,
      sessionBundle: { session, workspaceState: fixture.workspaceState },
      runAudit,
      artifactDeliveryManifest: artifactDeliveryManifestFromSession(session, fixture.expectedProjection),
    };
    assertWebE2eContract(contractInput);

    const evidenceBundle = createWebE2eEvidenceBundleManifest({
      caseId: fixture.caseId,
      generatedAt: now,
      outputRoot: options.outputRoot,
      runs: resultRuns.map((run, index) => ({
        runId: String(run.id),
        eventIds: [`event:${String(run.id)}:turn-${index + 1}`],
        requestDigest: agentServer.requests.runs[index]?.digest,
        resultDigest: String(run.digest ?? ''),
        status: String(run.status ?? ''),
      })),
      projection: {
        projectionVersion: fixture.expectedProjection.projectionVersion,
        terminalState: fixture.expectedProjection.conversationProjection.visibleAnswer?.status,
      },
      note: {
        status: 'passed',
        summary: 'Fresh to continue memory preserved the first research goal without letting a stale artifact replace the current turn.',
      },
      extra: {
        stableGoalRef: freshContinueMemoryStableGoalRef,
        stableGoalSources: rounds.map((round) => round.stableGoalSource ?? 'none'),
        oldArtifactRef: freshContinueMemoryOldArtifactRef,
        currentArtifactRef: freshContinueMemoryCurrentArtifactRef,
      },
    });

    const result: FreshContinueMemoryCaseResult = {
      fixture,
      rounds,
      recordedRunRequests: [...agentServer.requests.runs],
      resultRuns,
      toolPayloads,
      browserVisibleState,
      runAudit,
      contractInput,
      evidenceBundle,
    };
    assertFreshContinueMemoryEvidence(result);
    return result;
  } finally {
    await agentServer.close();
  }
}

export function assertFreshContinueMemoryEvidence(result: FreshContinueMemoryCaseResult): void {
  assert.equal(result.rounds.length, 3, 'SA-WEB-02 must execute fresh, continue, and format-change rounds');
  assert.equal(result.recordedRunRequests.length, 3, 'AgentServer must receive exactly three round requests');
  assert.deepEqual(result.rounds.map((round) => round.prompt), [
    freshContinueMemoryInitialGoal,
    freshContinueMemoryRound2Prompt,
    freshContinueMemoryRound3Prompt,
  ]);
  assert.deepEqual(
    result.rounds.map((round) => round.contextRequest.currentTask.mode),
    ['fresh', 'continue', 'continue'],
    'SA-WEB-02 rounds must be Fresh -> Continue -> Continue format change',
  );

  const firstPayload = result.toolPayloads[0] as JsonRecord;
  const memoryProposal = firstPayload.memoryProposal as JsonRecord | undefined;
  assert.equal(memoryProposal?.source, 'backend-proposal', 'stable goal must be introduced by an explicit Backend proposal');
  assert.equal((memoryProposal?.stableGoalRef as JsonRecord | undefined)?.ref, freshContinueMemoryStableGoalRef);

  for (const round of result.rounds) {
    assertAgentServerContextRequest(round.contextRequest);
    assertCurrentTurnBeatsOldArtifact(round);
    assertStableGoalOrigin(round);
    assertOldArtifactOnlyInBoundedIndex(round);
  }

  const fresh = result.rounds[0]!;
  assert.equal(fresh.contextRequest.currentTask.stableGoalRef, undefined, 'fresh round must not infer stableGoalRef from prior artifacts');
  assert.deepEqual(fresh.contextRequest.cachePlan.stablePrefixRefs, [], 'fresh stable prefix must stay empty until Backend proposes a goal');
  assert.equal(fresh.contextRequest.contextPolicy.includeCurrentWork, false, 'fresh round must isolate old current work');

  for (const round of result.rounds.slice(1)) {
    assert.equal(round.contextRequest.currentTask.stableGoalRef?.ref, freshContinueMemoryStableGoalRef);
    assert.equal(round.stableGoalSource, 'backend-proposal');
    assert.equal(round.contextRequest.contextPolicy.includeCurrentWork, true);
  }

  for (const [index, request] of result.recordedRunRequests.entries()) {
    const round = result.rounds[index]!;
    assert.equal(request.body.prompt, round.prompt, `${round.roundId}: recorded request prompt must be the current turn`);
    assert.equal((request.body.contextRequest as JsonRecord | undefined)?.turnId, round.contextRequest.turnId);
  }

  for (const payload of result.toolPayloads) {
    assertNoOldArtifactOverride(payload, 'AgentServer tool payload');
  }
  assertNoOldArtifactOverride(result.browserVisibleState, 'browser visible state');
  assert.deepEqual(result.runAudit.explicitRefs, [], 'SA-WEB-02 must not synthesize explicit refs from stale artifacts');
  assert.deepEqual(result.evidenceBundle.extra?.stableGoalSources, ['none', 'backend-proposal', 'backend-proposal']);
}

function buildRound(
  fixture: WebE2eFixtureWorkspace,
  roundId: RoundId,
  prompt: string,
  mode: ContextMode,
  stableGoalSource: StableGoalSource | undefined,
): FreshContinueMemoryRound {
  const currentTurnRef = memoryRef(`message:${messageIdForRound(roundId)}`, 'task-input');
  const capabilityBriefRef = memoryRef(`projection:${fixture.sessionId}:capability-brief`, 'projection');
  const stableGoalRef = mode === 'fresh' ? undefined : memoryRef(freshContinueMemoryStableGoalRef, 'projection');
  const selectedRefs = mode === 'fresh'
    ? []
    : [selectedRef(freshContinueMemoryStableGoalRef, 'projection', 'projection-primary', 0)];
  const contextRequest: AgentServerContextRequest = {
    _contractVersion: AGENTSERVER_CONTEXT_REQUEST_VERSION,
    sessionId: fixture.sessionId,
    turnId: messageIdForRound(roundId),
    cachePlan: {
      stablePrefixRefs: stableGoalRef ? [stableGoalRef] : [],
      perTurnPayloadRefs: [currentTurnRef],
    },
    capabilityBriefRef,
    contextRefs: [
      capabilityBriefRef,
      ...(stableGoalRef ? [stableGoalRef] : []),
      currentTurnRef,
      ...selectedRefs.map((ref) => memoryRef(ref.ref, ref.kind === 'projection' ? 'projection' : 'artifact')),
    ],
    currentTask: {
      currentTurnRef,
      ...(stableGoalRef ? { stableGoalRef } : {}),
      mode,
      explicitRefs: stableGoalSource === 'explicit' && stableGoalRef ? [refDescriptor(stableGoalRef.ref, 'projection')] : [],
      selectedRefs,
      userVisibleSelectionDigest: digestFor(`${roundId}:visible-selection`),
    },
    retrievalPolicy: {
      tools: ['read_ref', 'retrieve', 'workspace_search', 'list_session_artifacts'],
      scope: 'current-session',
      preferExplicitRefs: true,
      requireEvidenceForClaims: true,
      maxTailEvidenceBytes: 2048,
    },
    refSelectionAudit: {
      policyDigest: digestFor(`${roundId}:policy`),
      selectedRefCount: selectedRefs.length,
      selectedRefBytes: selectedRefs.reduce((total, ref) => total + (ref.sizeBytes ?? 0), 0),
      truncated: false,
      sourceCounts: {
        explicit: stableGoalSource === 'explicit' ? 1 : 0,
        projectionPrimary: selectedRefs.length,
        failureEvidence: 0,
        contextIndex: 0,
      },
    },
    contextPolicy: {
      mode,
      includeCurrentWork: mode !== 'fresh',
      includeRecentTurns: mode !== 'fresh',
      persistRunSummary: true,
      maxContextTokens: 8000,
    },
  };
  const canonicalContextRequest = JSON.parse(canonicalSerializeAgentServerContextRequest(contextRequest)) as JsonRecord;
  const body: JsonRecord = {
    caseId: fixture.caseId,
    roundId,
    sessionId: fixture.sessionId,
    prompt,
    input: { text: prompt },
    stableGoalSource: stableGoalSource ?? 'none',
    contextRequest: canonicalContextRequest,
    staleArtifactIndex: [refDescriptor(freshContinueMemoryOldArtifactRef, 'research-report')] as unknown as JsonRecord[],
  };
  return { roundId, prompt, stableGoalSource, contextRequest, body };
}

function assertCurrentTurnBeatsOldArtifact(round: FreshContinueMemoryRound): void {
  const expectedTurnRef = `message:${messageIdForRound(round.roundId)}`;
  assert.equal(
    round.contextRequest.currentTask.currentTurnRef.ref,
    expectedTurnRef,
    `${round.roundId}: currentTurnRef must remain the current user turn`,
  );
  assert.notEqual(
    round.contextRequest.currentTask.currentTurnRef.ref,
    freshContinueMemoryOldArtifactRef,
    `${round.roundId}: old artifact must not replace currentTurnRef`,
  );
  assert.ok(
    round.prompt === String((round.body.input as JsonRecord).text),
    `${round.roundId}: prompt body must remain the current user text`,
  );
}

function assertStableGoalOrigin(round: FreshContinueMemoryRound): void {
  const stableGoalRef = round.contextRequest.currentTask.stableGoalRef;
  if (!stableGoalRef) return;
  assert.ok(
    round.stableGoalSource === 'backend-proposal' || round.stableGoalSource === 'explicit',
    `${round.roundId}: stableGoalRef source must be explicit or Backend proposal`,
  );
  assert.notEqual(stableGoalRef.ref, freshContinueMemoryOldArtifactRef, `${round.roundId}: stableGoalRef must not be a stale artifact`);
  assert.equal(stableGoalRef.kind, 'projection', `${round.roundId}: stableGoalRef must be a projection ref`);
  if (round.stableGoalSource === 'explicit') {
    assert.ok(
      round.contextRequest.currentTask.explicitRefs.some((ref) => ref.ref === stableGoalRef.ref),
      `${round.roundId}: explicit stableGoalRef must also appear in explicitRefs`,
    );
  }
}

function assertOldArtifactOnlyInBoundedIndex(round: FreshContinueMemoryRound): void {
  const staleIndex = round.body.staleArtifactIndex as unknown as RefDescriptor[] | undefined;
  assert.ok(
    staleIndex?.some((ref) => ref.ref === freshContinueMemoryOldArtifactRef),
    `${round.roundId}: fixture must prove a stale old artifact exists in the session index`,
  );
  const currentTaskJson = JSON.stringify(round.contextRequest.currentTask);
  const cachePlanJson = JSON.stringify(round.contextRequest.cachePlan);
  assert.doesNotMatch(currentTaskJson, new RegExp(freshContinueMemoryOldArtifactRef), `${round.roundId}: currentTask must not include stale old artifact`);
  assert.doesNotMatch(cachePlanJson, new RegExp(freshContinueMemoryOldArtifactRef), `${round.roundId}: cachePlan must not include stale old artifact`);
}

function assertNoOldArtifactOverride(value: unknown, label: string): void {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, new RegExp(freshContinueMemoryOldArtifactRef), `${label} must not expose the stale old artifact as current output`);
  assert.doesNotMatch(serialized, /Prior selected literature report/, `${label} must not use the old artifact title as the current answer`);
}

function toolPayloadForRound(roundId: RoundId, now: string): ScriptableAgentServerToolPayload {
  const visibleText = roundId === 'round-1-fresh'
    ? '已记录初始研究目标：比较 IL7R 高表达 T 细胞证据强度，并继续围绕该目标推进。'
    : roundId === 'round-2-continue'
      ? '我记得一开始的问题是比较 IL7R 高表达 T 细胞证据强度；继续补充证据缺口和验证计划。'
      : '证据 | 风险 | 下一步\nIL7R T cell evidence | 论文异质性 | 用统一纳入标准复核。';
  return {
    message: visibleText,
    confidence: 0.89,
    claimType: 'fact',
    evidenceLevel: 'scriptable-agentserver-memory-stability',
    reasoningTrace: `${freshContinueMemoryCaseId} ${roundId} uses currentTurnRef plus Backend-proposed stableGoalRef.`,
    ...(roundId === 'round-1-fresh'
      ? { memoryProposal: {
        source: 'backend-proposal',
        kind: 'stable-goal',
        stableGoalRef: memoryRef(freshContinueMemoryStableGoalRef, 'projection') as unknown as JsonRecord,
        fromTurnRef: `message:${messageIdForRound('round-1-fresh')}`,
        summary: freshContinueMemoryInitialGoal,
      } }
      : {}),
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'satisfied',
      status: 'satisfied',
      conversationProjection: conversationProjectionForRound(roundId, visibleText) as unknown as JsonRecord,
    },
    claims: [{
      id: `claim-${roundId}`,
      text: visibleText,
      refs: roundId === 'round-3-format' ? [freshContinueMemoryCurrentArtifactRef] : [freshContinueMemoryStableGoalRef],
      createdAt: now,
    }],
    uiManifest: roundId === 'round-3-format'
      ? [{ componentId: 'table-viewer', title: 'IL7R evidence table', artifactRef: 'sa-web-02-current-format-table', priority: 1 }]
      : [],
    executionUnits: [{
      id: `EU-${roundId}`,
      tool: 'agentserver.mock.fresh-continue-memory',
      status: 'done',
      outputArtifacts: roundId === 'round-3-format' ? ['sa-web-02-current-format-table'] : [],
      time: now,
    }],
    artifacts: roundId === 'round-3-format'
      ? [{
        id: 'sa-web-02-current-format-table',
        type: 'research-table',
        delivery: {
          ref: freshContinueMemoryCurrentArtifactRef,
          role: 'primary-deliverable',
        },
      }]
      : [],
  };
}

function withFreshContinueMemoryProjection(
  fixture: WebE2eFixtureWorkspace,
  now: string,
): WebE2eFixtureWorkspace {
  const next = structuredClone(fixture) as WebE2eFixtureWorkspace;
  next.runId = runIdForRound('round-3-format');
  next.expectedProjection.runId = next.runId;
  const round3CurrentTurnRef = initialRefForRound('round-3-format');
  next.expectedProjection.currentTask = {
    currentTurnRef: round3CurrentTurnRef,
    explicitRefs: [],
    selectedRefs: [round3CurrentTurnRef],
  };
  next.expectedProjection.conversationProjection = conversationProjectionForRound(
    'round-3-format',
    '证据 | 风险 | 下一步\nIL7R T cell evidence | 论文异质性 | 用统一纳入标准复核。',
  );

  const session = next.workspaceState.sessionsByScenario[next.scenarioId];
  session.messages = buildMessages(now);
  session.runs = [finalRun(next, now)];
  session.executionUnits = [{
    id: 'EU-round-3-format',
    tool: 'agentserver.mock.fresh-continue-memory',
    params: 'mode=continue format=table',
    status: 'done',
    hash: 'sa-web-02-memory-stability',
    runId: next.runId,
    outputRef: '.sciforge/task-results/sa-web-02-current-format-table.md',
    outputArtifacts: ['sa-web-02-current-format-table'],
    time: now,
  }];
  session.uiManifest = [{ componentId: 'table-viewer', title: 'IL7R evidence table', artifactRef: 'sa-web-02-current-format-table', priority: 1 }];
  session.artifacts = artifactsForMemoryCase(session.artifacts, next);
  session.updatedAt = now;
  next.expectedProjection.artifactDelivery = artifactDeliveryProjection(session.artifacts);
  return next;
}

function buildMessages(now: string): SciForgeMessage[] {
  return [
    userMessage(messageIdForRound('round-1-fresh'), freshContinueMemoryInitialGoal, now),
    scenarioMessage('msg-sa-web-02-agent-round-1', '已记录初始研究目标，并由 Backend proposal 固化 stableGoalRef。', now),
    userMessage(messageIdForRound('round-2-continue'), freshContinueMemoryRound2Prompt, now),
    scenarioMessage('msg-sa-web-02-agent-round-2', '继续围绕一开始的 IL7R 证据强度问题推进。', now),
    userMessage(messageIdForRound('round-3-format'), freshContinueMemoryRound3Prompt, now),
    scenarioMessage('msg-sa-web-02-agent-round-3', '证据 | 风险 | 下一步\nIL7R T cell evidence | 论文异质性 | 用统一纳入标准复核。', now),
  ];
}

function userMessage(id: string, content: string, now: string): SciForgeMessage {
  return { id, role: 'user', content, createdAt: now, status: 'completed', objectReferences: [] };
}

function scenarioMessage(id: string, content: string, now: string): SciForgeMessage {
  return { id, role: 'scenario', content, createdAt: now, status: 'completed', objectReferences: [] };
}

function finalRun(fixture: WebE2eFixtureWorkspace, now: string): SciForgeRun {
  const projection = fixture.expectedProjection.conversationProjection;
  return {
    id: fixture.runId,
    scenarioId: fixture.scenarioId,
    status: 'completed',
    prompt: freshContinueMemoryRound3Prompt,
    response: projection.visibleAnswer?.text ?? '',
    createdAt: now,
    completedAt: now,
    objectReferences: [],
    raw: {
      displayIntent: {
        primaryGoal: freshContinueMemoryInitialGoal,
        source: 'agentserver',
        conversationProjection: projection,
        taskOutcomeProjection: { conversationProjection: projection },
      },
      resultPresentation: { conversationProjection: projection },
    },
  };
}

function artifactsForMemoryCase(artifacts: RuntimeArtifact[], fixture: WebE2eFixtureWorkspace): RuntimeArtifact[] {
  const staleAuditArtifacts = artifacts.map((artifact): RuntimeArtifact => {
    if (artifact.id !== 'fixture-old-report') return artifact;
    return {
      ...artifact,
      delivery: {
        contractId: 'sciforge.artifact-delivery.v1' as const,
        ref: freshContinueMemoryOldArtifactRef,
        role: 'audit' as const,
        declaredMediaType: artifact.delivery?.declaredMediaType ?? 'text/markdown',
        declaredExtension: artifact.delivery?.declaredExtension ?? 'md',
        contentShape: artifact.delivery?.contentShape ?? 'raw-file',
        readableRef: artifact.delivery?.readableRef,
        rawRef: artifact.delivery?.rawRef,
        previewPolicy: 'audit-only' as const,
      },
    };
  });
  return [
    ...staleAuditArtifacts.filter((artifact) => artifact.id !== 'fixture-current-report'),
    {
      id: 'sa-web-02-current-format-table',
      type: 'research-table',
      producerScenario: fixture.scenarioId,
      schemaVersion: '1',
      metadata: { title: 'IL7R evidence table', path: '.sciforge/task-results/sa-web-02-current-format-table.md', runId: fixture.runId },
      dataRef: '.sciforge/task-results/sa-web-02-current-format-table.md',
      delivery: {
        contractId: 'sciforge.artifact-delivery.v1',
        ref: freshContinueMemoryCurrentArtifactRef,
        role: 'primary-deliverable',
        declaredMediaType: 'text/markdown',
        declaredExtension: 'md',
        contentShape: 'raw-file',
        readableRef: '.sciforge/task-results/sa-web-02-current-format-table.md',
        rawRef: '.sciforge/task-results/sa-web-02-current-format-table.md',
        previewPolicy: 'inline',
      },
      visibility: 'project-record',
    },
  ];
}

function conversationProjectionForRound(roundId: RoundId, text: string): WebE2eExpectedProjection['conversationProjection'] {
  return {
    schemaVersion: 'sciforge.conversation-projection.v1',
    conversationId: freshContinueMemoryCaseId,
    visibleAnswer: {
      status: 'satisfied',
      text,
      artifactRefs: roundId === 'round-3-format' ? [freshContinueMemoryCurrentArtifactRef] : [],
    },
    activeRun: { id: runIdForRound(roundId), status: 'satisfied' },
    artifacts: roundId === 'round-3-format'
      ? [{ ref: freshContinueMemoryCurrentArtifactRef, label: 'IL7R evidence table' }]
      : [],
    executionProcess: [],
    recoverActions: [],
    auditRefs: ['artifact:fixture-run-audit'],
    verificationState: { status: 'not-required' },
    diagnostics: [],
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
  };
}

function artifactDeliveryProjection(artifacts: RuntimeArtifact[]): WebE2eArtifactDeliveryProjection {
  return {
    primaryArtifactRefs: refsForRole(artifacts, 'primary-deliverable'),
    supportingArtifactRefs: refsForRole(artifacts, 'supporting-evidence'),
    auditRefs: refsForRole(artifacts, 'audit'),
    diagnosticRefs: refsForRole(artifacts, 'diagnostic'),
    internalRefs: refsForRole(artifacts, 'internal'),
  };
}

function refsForRole(artifacts: RuntimeArtifact[], role: NonNullable<RuntimeArtifact['delivery']>['role']): string[] {
  return artifacts.filter((artifact) => artifact.delivery?.role === role).map((artifact) => artifact.delivery?.ref ?? `artifact:${artifact.id}`);
}

async function fetchRun(baseUrl: string, body: JsonRecord): Promise<{ resultRun: JsonRecord }> {
  const response = await fetch(`${baseUrl}/api/agent-server/runs/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.ok, true, 'fresh/continue memory round should return 2xx');
  const envelopes = (await response.text()).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as JsonRecord);
  const resultEnvelope = envelopes.find((envelope) => envelope.result) as JsonRecord | undefined;
  assert.ok(resultEnvelope, 'run stream should include a final result envelope');
  const result = resultEnvelope.result as JsonRecord;
  const data = result.data as JsonRecord;
  return { resultRun: data.run as JsonRecord };
}

function extractToolPayload(resultRun: JsonRecord): JsonRecord {
  const output = resultRun.output as JsonRecord | undefined;
  const toolPayload = output?.toolPayload as JsonRecord | undefined;
  assert.ok(toolPayload, 'run result should include a toolPayload');
  return toolPayload;
}

function initialRefForRound(roundId: RoundId): WebE2eInitialRef {
  return {
    id: `ref-${roundId}`,
    kind: 'user-turn',
    title: `Current user turn ${roundId}`,
    ref: `message:${messageIdForRound(roundId)}`,
    source: 'current-turn',
  };
}

function selectedRef(
  ref: string,
  kind: SelectedRefDescriptor['kind'],
  source: SelectedRefDescriptor['source'],
  priority: number,
): SelectedRefDescriptor {
  return { ref, kind, source, priority, digest: digestFor(ref), sizeBytes: 256 };
}

function refDescriptor(ref: string, kind: string): RefDescriptor {
  return { ref, kind, digest: digestFor(ref), sizeBytes: 256 };
}

function memoryRef(ref: string, kind: ProjectMemoryRef['kind']): ProjectMemoryRef {
  return { ref, kind, digest: digestFor(ref), sizeBytes: 256 };
}

function runIdForRound(roundId: RoundId): string {
  return `run-sa-web-02-${roundId}`;
}

function messageIdForRound(roundId: RoundId): string {
  return `msg-sa-web-02-${roundId}`;
}

function digestFor(value: string): string {
  return `sha256:${Buffer.from(value).toString('hex').slice(0, 32).padEnd(32, '0')}`;
}
