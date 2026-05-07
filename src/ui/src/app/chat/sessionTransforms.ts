import type {
  NormalizedAgentResponse,
  RuntimeArtifact,
  RuntimeExecutionUnit,
  ScenarioInstanceId,
  ScenarioPackageRef,
  SciForgeMessage,
  SciForgeReference,
  SciForgeRun,
  SciForgeSession,
  UserGoalSnapshot,
} from '../../domain';
import { makeId, nowIso } from '../../domain';
import { mergeObjectReferences } from '../../../../../packages/object-references';

export function titleFromPrompt(prompt: string) {
  const title = prompt.trim().replace(/\s+/g, ' ').slice(0, 36);
  return title || '新聊天';
}

export function createOptimisticUserTurnSession({
  baseSession,
  prompt,
  references,
  goalSnapshot,
}: {
  baseSession: SciForgeSession;
  prompt: string;
  references: SciForgeReference[];
  goalSnapshot: UserGoalSnapshot;
}) {
  const now = nowIso();
  const userMessage: SciForgeMessage = {
    id: makeId('msg'),
    role: 'user',
    content: prompt,
    createdAt: now,
    status: 'completed',
    references,
    goalSnapshot,
  };
  const nextSession: SciForgeSession = {
    ...baseSession,
    title: baseSession.runs.length || baseSession.messages.some((message) => message.id.startsWith('msg'))
      ? baseSession.title
      : titleFromPrompt(prompt),
    messages: [...baseSession.messages, userMessage],
    updatedAt: nowIso(),
  };
  return { session: nextSession, userMessage };
}

export function appendUploadMessageToSession({
  session,
  uploaded,
  references,
  objectReferences,
}: {
  session: SciForgeSession;
  uploaded: RuntimeArtifact[];
  references: SciForgeReference[];
  objectReferences: NonNullable<SciForgeMessage['objectReferences']>;
}) {
  const now = nowIso();
  const uploadMessage: SciForgeMessage = {
    id: makeId('msg'),
    role: 'system',
    content: `已上传 ${uploaded.length} 个文件到证据矩阵：${uploaded.map((artifact) => artifact.metadata?.title ?? artifact.id).join('、')}`,
    createdAt: now,
    status: 'completed',
    references,
    objectReferences,
  };
  return {
    ...session,
    messages: [...session.messages, uploadMessage],
    artifacts: mergeRuntimeArtifacts(uploaded, session.artifacts),
    updatedAt: now,
  };
}

export function appendRunningGuidance(session: SciForgeSession, prompt: string) {
  const now = nowIso();
  const guidanceMessage: SciForgeMessage = {
    id: makeId('msg'),
    role: 'user',
    content: `运行中引导：${prompt}`,
    createdAt: now,
    status: 'running',
  };
  return {
    ...session,
    messages: [...session.messages, guidanceMessage],
    updatedAt: now,
  };
}

export function mergeAgentResponseIntoSession({
  baseSession,
  response,
  scenarioPackageRef,
  skillPlanRef,
  uiPlanRef,
}: {
  baseSession: SciForgeSession;
  response: NormalizedAgentResponse;
  scenarioPackageRef: ScenarioPackageRef;
  skillPlanRef: string;
  uiPlanRef: string;
}): SciForgeSession {
  const versionedRun = {
    ...response.run,
    scenarioPackageRef: response.run.scenarioPackageRef ?? scenarioPackageRef,
    skillPlanRef: response.run.skillPlanRef ?? skillPlanRef,
    uiPlanRef: response.run.uiPlanRef ?? uiPlanRef,
  };
  return {
    ...baseSession,
    messages: [...baseSession.messages, response.message],
    runs: [...baseSession.runs, versionedRun],
    uiManifest: response.uiManifest.length ? response.uiManifest : baseSession.uiManifest,
    claims: [...response.claims, ...baseSession.claims].slice(0, 24),
    executionUnits: mergeExecutionUnits(response.executionUnits, baseSession.executionUnits),
    artifacts: mergeRuntimeArtifacts(response.artifacts, baseSession.artifacts),
    notebook: [...response.notebook, ...baseSession.notebook].slice(0, 24),
    updatedAt: nowIso(),
  };
}

export function appendFailedRunToSession({
  optimisticSession,
  scenarioId,
  scenarioPackageRef,
  skillPlanRef,
  uiPlanRef,
  prompt,
  message,
  references,
  goalSnapshot,
}: {
  optimisticSession: SciForgeSession;
  scenarioId: ScenarioInstanceId;
  scenarioPackageRef: ScenarioPackageRef;
  skillPlanRef: string;
  uiPlanRef: string;
  prompt: string;
  message: string;
  references: SciForgeReference[];
  goalSnapshot: UserGoalSnapshot;
}) {
  const failedRunId = makeId('run');
  const failedAt = nowIso();
  const failedRun: SciForgeRun = {
    id: failedRunId,
    scenarioId,
    scenarioPackageRef,
    skillPlanRef,
    uiPlanRef,
    status: 'failed',
    prompt,
    response: message,
    createdAt: failedAt,
    completedAt: failedAt,
    references,
    goalSnapshot,
  };
  const failedMessage: SciForgeMessage = {
    id: makeId('msg'),
    role: 'system',
    content: message,
    createdAt: nowIso(),
    status: 'failed',
    goalSnapshot,
  };
  return {
    failedRunId,
    session: {
      ...optimisticSession,
      messages: [
        ...optimisticSession.messages,
        failedMessage,
      ],
      runs: [
        ...optimisticSession.runs,
        failedRun,
      ],
      updatedAt: nowIso(),
    },
  };
}

export function requestPayloadForTurn(session: SciForgeSession, userMessage: SciForgeMessage, references: SciForgeReference[]) {
  const hasExplicitReferences = references.length > 0;
  const priorMessages = session.messages.filter((message) => message.id !== userMessage.id);
  const hasRealPriorMessages = priorMessages.some((message) => !message.id.startsWith('seed'));
  const hasPriorWork = hasRealPriorMessages
    || session.runs.length > 0
    || session.artifacts.length > 0
    || session.executionUnits.length > 0;
  if (hasPriorWork || hasExplicitReferences) {
    return {
      messages: session.messages.filter((message) => !message.id.startsWith('seed')),
      artifacts: session.artifacts,
      executionUnits: session.executionUnits,
      runs: session.runs,
    };
  }
  return {
    messages: [userMessage],
    artifacts: [],
    executionUnits: [],
    runs: [],
  };
}

export function rollbackSessionBeforeMessage(session: SciForgeSession, messageId: string): SciForgeSession {
  const index = session.messages.findIndex((message) => message.id === messageId);
  if (index < 0) return session;
  const cutoff = session.messages[index]?.createdAt;
  const runs = cutoff ? session.runs.filter((run) => run.createdAt < cutoff) : [];
  const keptRunIds = new Set(runs.map((run) => run.id));
  return {
    ...session,
    messages: session.messages.slice(0, index),
    runs,
    uiManifest: [],
    claims: cutoff ? session.claims.filter((claim) => claim.updatedAt < cutoff) : [],
    executionUnits: session.executionUnits.filter((unit) => {
      const selectedAt = unit.routeDecision?.selectedAt;
      return selectedAt ? selectedAt < cutoff : keptRunIds.size > 0;
    }),
    artifacts: keptRunIds.size ? session.artifacts : [],
    notebook: cutoff ? session.notebook.filter((entry) => entry.time < cutoff) : [],
    updatedAt: nowIso(),
  };
}

export function mergeRuntimeArtifacts(primary: NormalizedAgentResponse['artifacts'], secondary: NormalizedAgentResponse['artifacts']) {
  const byKey = new Map<string, NormalizedAgentResponse['artifacts'][number]>();
  for (const artifact of [...secondary, ...primary]) {
    const key = artifact.id || artifact.path || artifact.dataRef || `${artifact.type}-${byKey.size}`;
    byKey.set(key, { ...byKey.get(key), ...artifact });
  }
  return Array.from(byKey.values()).slice(0, 32);
}

export function mergeExecutionUnits(primary: NormalizedAgentResponse['executionUnits'], secondary: NormalizedAgentResponse['executionUnits']) {
  const byId = new Map<string, NormalizedAgentResponse['executionUnits'][number]>();
  for (const unit of [...secondary, ...primary]) {
    const key = unit.id || `${unit.tool}-${byId.size}`;
    byId.set(key, { ...byId.get(key), ...unit });
  }
  return Array.from(byId.values()).slice(0, 32);
}

export function mergeRuns(primary: NormalizedAgentResponse['run'][], secondary: NormalizedAgentResponse['run'][]) {
  const byId = new Map<string, NormalizedAgentResponse['run']>();
  for (const run of [...primary, ...secondary]) byId.set(run.id, { ...byId.get(run.id), ...run });
  return Array.from(byId.values()).slice(-12);
}

export function mergeRepairSuccessResponse(
  original: NormalizedAgentResponse,
  repair: NormalizedAgentResponse,
  repairHistory: NonNullable<NonNullable<NormalizedAgentResponse['message']['acceptance']>['repairHistory']>,
): NormalizedAgentResponse {
  const objectReferences = mergeObjectReferences(repair.message.objectReferences ?? [], original.message.objectReferences ?? []);
  const acceptance = repair.message.acceptance ? {
    ...repair.message.acceptance,
    objectReferences,
    repairAttempt: repairHistory.length,
    repairHistory,
  } : undefined;
  return {
    ...repair,
    message: {
      ...repair.message,
      objectReferences,
      acceptance,
    },
    run: {
      ...repair.run,
      objectReferences,
      acceptance,
      raw: enrichRepairRaw(repair.run.raw, repairHistory, original.run.id),
    },
    uiManifest: repair.uiManifest.length ? repair.uiManifest : original.uiManifest,
    claims: [...repair.claims, ...original.claims].slice(0, 24),
    executionUnits: mergeExecutionUnits(repair.executionUnits, original.executionUnits),
    artifacts: mergeRuntimeArtifacts(repair.artifacts, original.artifacts),
    notebook: [...repair.notebook, ...original.notebook].slice(0, 24),
  };
}

export function failedAcceptanceRepairResponse(
  original: NormalizedAgentResponse,
  repair: NormalizedAgentResponse | undefined,
  action: string,
  startedAt: string,
  completedAt: string,
  baseHistory: NonNullable<NonNullable<NormalizedAgentResponse['message']['acceptance']>['repairHistory']>,
  reason: string,
): NormalizedAgentResponse {
  const failureUnit: RuntimeExecutionUnit = {
    id: makeId('EU-acceptance-repair'),
    tool: 'sciforge.acceptance-repair-rerun',
    params: `sourceRunId=${original.run.id}`,
    status: 'failed-with-reason',
    hash: original.run.id.slice(0, 10),
    attempt: baseHistory.length + 1,
    parentAttempt: 0,
    failureReason: reason,
    recoverActions: ['Review failureReason/stdoutRef/stderrRef/codeRef and rerun manually if needed.'],
    nextStep: 'Repair rerun failed; return failed-with-reason to the user instead of presenting partial success.',
  };
  const repairHistory = [...baseHistory, {
    attempt: baseHistory.length + 1,
    action,
    status: 'failed-with-reason' as const,
    startedAt,
    completedAt,
    sourceRunId: original.run.id,
    repairRunId: repair?.run.id,
    failureCodes: original.message.acceptance?.failures.map((failure) => failure.code) ?? [],
    reason,
  }];
  const objectReferences = mergeObjectReferences(repair?.message.objectReferences ?? [], original.message.objectReferences ?? []);
  const acceptance = original.message.acceptance ? {
    ...original.message.acceptance,
    pass: false,
    severity: 'failed' as const,
    checkedAt: completedAt,
    objectReferences,
    repairAttempt: repairHistory.length,
    repairHistory,
    failures: [
      ...original.message.acceptance.failures,
      {
        code: 'backend-repair-failed',
        detail: reason,
        repairAction: action,
      },
    ],
  } : undefined;
  const content = `failed-with-reason: 后台 artifact/execution repair 未能完成。${reason}`;
  return {
    ...original,
    message: {
      ...original.message,
      content,
      status: 'failed',
      objectReferences,
      acceptance,
    },
    run: {
      ...original.run,
      status: 'failed',
      response: content,
      completedAt,
      objectReferences,
      acceptance,
      raw: enrichRepairRaw(original.run.raw, repairHistory, original.run.id, reason),
    },
    uiManifest: repair?.uiManifest.length ? repair.uiManifest : original.uiManifest,
    claims: [...(repair?.claims ?? []), ...original.claims].slice(0, 24),
    executionUnits: mergeExecutionUnits([failureUnit, ...(repair?.executionUnits ?? [])], original.executionUnits),
    artifacts: mergeRuntimeArtifacts(repair?.artifacts ?? [], original.artifacts),
    notebook: [...(repair?.notebook ?? []), ...original.notebook].slice(0, 24),
  };
}

function enrichRepairRaw(raw: unknown, repairHistory: unknown, sourceRunId: string, failureReason?: string) {
  const repairMetadata = { acceptanceRepair: { sourceRunId, repairHistory, failureReason } };
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...raw, ...repairMetadata }
    : { raw, ...repairMetadata };
}
