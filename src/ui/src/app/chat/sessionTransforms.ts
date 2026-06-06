import type {
  BackgroundCompletionRuntimeEvent,
  NormalizedAgentResponse,
  RuntimeArtifact,
  RuntimeExecutionUnit,
  ScenarioPackageRef,
  SciForgeMessage,
  SciForgeReference,
  SciForgeSession,
  UserGoalSnapshot,
} from '../../domain';
import { makeId, nowIso } from '../../domain';
import { mergeObjectReferences } from '../../../../../packages/support/object-references';
import { normalizeScenarioPromptTitle } from '@sciforge/scenario-core/scenario-routing-policy';
import { withSessionWriteGuard } from '../../sessionStore';
import {
  ACCEPTANCE_REPAIR_RERUN_TOOL_ID,
} from '@sciforge-ui/runtime-contract/events';
import {
  backgroundMessageForEvent,
  backgroundMessageId,
  backgroundRunForEvent,
  mergeBackgroundMessage,
  mergeBackgroundRaw,
  mergeBackgroundRun,
  normalizeBackgroundExecutionUnits,
  objectReferenceForBackgroundRun,
  tagBackgroundArtifacts,
} from './sessionBackgroundCompletion';
import { mergeRuntimeArtifacts } from './sessionArtifactLinks';
import { enrichRepairRaw } from './sessionRepairRaw';
export { requestPayloadForTurn } from './sessionRequestPayload';
export { mergeRuntimeArtifacts } from './sessionArtifactLinks';
export { appendFailedRunToSession, attachProcessRecoveryToFailedSession } from './sessionFailedRunProjection';
export {
  appendRunningGuidance,
  appendRunningGuidanceRecord,
  attachGuidanceQueueToResponse,
  attachGuidanceQueueToSessionRun,
  createGuidanceQueueRecord,
  resolveGuidanceQueueAfterRun,
  updateGuidanceQueueRecords,
} from './sessionGuidanceQueue';
export { applyHistoricalUserMessageEdit } from './sessionHistoryEdit';
export type {
  HistoricalMessageEditBranch,
  HistoricalMessageEditConclusion,
  HistoricalMessageEditConflict,
  HistoricalMessageEditMode,
  HistoricalMessageEditProjectionInvalidation,
  HistoricalMessageEditRef,
  HistoricalMessageEditRefInvalidation,
  HistoricalMessageEditResult,
  HistoricalMessageEditSession,
} from './sessionHistoryEdit';

export function titleFromPrompt(
  prompt: string,
  options?: Parameters<typeof normalizeScenarioPromptTitle>[1],
) {
  return normalizeScenarioPromptTitle(safePromptTitleSource(prompt), options);
}

export function shouldDeriveTitleForFirstUserTurn(session: SciForgeSession) {
  return session.runs.length === 0 && !session.messages.some(isExistingUserAuthoredMessage);
}

export function createOptimisticUserTurnSession({
  baseSession,
  prompt,
  references,
  objectReferences,
  goalSnapshot,
  targetInstanceLabel,
}: {
  baseSession: SciForgeSession;
  prompt: string;
  references: SciForgeReference[];
  objectReferences?: NonNullable<SciForgeMessage['objectReferences']>;
  goalSnapshot?: UserGoalSnapshot;
  targetInstanceLabel?: string;
}) {
  const now = nowIso();
  const userMessage: SciForgeMessage = {
    id: makeId('msg'),
    role: 'user',
    content: targetInstanceLabel ? `目标实例：${targetInstanceLabel}\n${prompt}` : prompt,
    createdAt: now,
    status: 'completed',
    references,
    objectReferences,
    goalSnapshot,
  };
  const shouldRetitle = shouldDeriveTitleForFirstUserTurn(baseSession);
  const nextSession: SciForgeSession = {
    ...baseSession,
    title: shouldRetitle ? titleFromPrompt(prompt) : baseSession.title,
    messages: [...baseSession.messages, userMessage],
    updatedAt: now,
  };
  return { session: nextSession, userMessage };
}

export function rebaseAcceptedSessionForLocalFollowup(session: SciForgeSession): SciForgeSession {
  return withSessionWriteGuard(session);
}

function isExistingUserAuthoredMessage(message: SciForgeMessage) {
  return message.role === 'user' && !message.id.startsWith('seed');
}

function safePromptTitleSource(prompt: string) {
  return prompt
    .replace(/^\s*\/[a-z][\w-]*(?:\s+|$)/i, ' ')
    .replace(/\b(?:authorization|api[-_\s]?key|access[-_\s]?token|refresh[-_\s]?token|token|secret|password|credential)\b\s*[:=]\s*(?:bearer\s+)?[^\s`"'<>),;]+/gi, '[secret]')
    .replace(/\b(?:provider|model)\b\s*[:=]\s*["']?[^"'\s,;)]+/gi, '[runtime setting]')
    .replace(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?[^\s`"'<>),;]*/gi, '[local endpoint]')
    .replace(/https?:\/\/[^\s`"'<>),;]+/gi, '[link]')
    .replace(/\bfile:[^\s`"'<>),;]+/gi, '[reference]')
    .replace(/(?:^|[\s(["'])\/(?:Applications|Users|Volumes|private|var|tmp)\/[^\s`"'<>),;]+/g, (match) => `${match.match(/^[\s(["']+/)?.[0] ?? ''}[local path]`);
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
    content: `已上传 ${uploaded.length} 个文件作为引用：${uploaded.map((artifact) => artifact.metadata?.title ?? artifact.id).join('、')}`,
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
    claims: mergeClaims(response.claims, baseSession.claims),
    executionUnits: mergeExecutionUnits(response.executionUnits, baseSession.executionUnits),
    artifacts: mergeRuntimeArtifacts(response.artifacts, baseSession.artifacts),
    notebook: [...response.notebook, ...baseSession.notebook].slice(0, 24),
    updatedAt: nowIso(),
  };
}

export function applyBackgroundCompletionEventToSession(
  session: SciForgeSession,
  event: BackgroundCompletionRuntimeEvent,
): SciForgeSession {
  const updatedAt = event.updatedAt ?? event.completedAt ?? event.createdAt ?? nowIso();
  const run = backgroundRunForEvent(session, event, updatedAt);
  const previousRun = session.runs.find((item) => item.id === event.runId);
  const runObjectReference = objectReferenceForBackgroundRun(run, event);
  const eventObjectReferences = mergeObjectReferences(event.objectReferences ?? [], [runObjectReference]);
  const existingMessageId = backgroundMessageId(previousRun);
  const messageId = existingMessageId ?? `msg-${event.runId}`;
  const message = backgroundMessageForEvent(session, event, messageId, updatedAt, eventObjectReferences);
  const messages = mergeBackgroundMessage(session.messages, message);
  const runs = mergeBackgroundRun(session.runs, {
    ...run,
    objectReferences: mergeObjectReferences(eventObjectReferences, previousRun?.objectReferences ?? []),
    raw: mergeBackgroundRaw(previousRun?.raw, event, message.id, updatedAt),
  });
  const executionUnits = mergeExecutionUnits(normalizeBackgroundExecutionUnits(event, updatedAt), session.executionUnits);
  const artifacts = mergeRuntimeArtifacts(tagBackgroundArtifacts(event.artifacts ?? [], event), session.artifacts);
  return {
    ...session,
    messages,
    runs,
    executionUnits,
    artifacts,
    updatedAt,
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

export function mergeClaims(primary: NormalizedAgentResponse['claims'], secondary: NormalizedAgentResponse['claims']) {
  const byId = new Map<string, NormalizedAgentResponse['claims'][number]>();
  for (const claim of [...secondary, ...primary]) {
    const key = claim.id || `${claim.text}-${byId.size}`;
    const previous = byId.get(key);
    if (byId.has(key)) byId.delete(key);
    byId.set(key, { ...previous, ...claim });
  }
  return Array.from(byId.values()).slice(-24);
}

export function mergeExecutionUnits(primary: NormalizedAgentResponse['executionUnits'], secondary: NormalizedAgentResponse['executionUnits']) {
  const byId = new Map<string, NormalizedAgentResponse['executionUnits'][number]>();
  for (const unit of [...secondary, ...primary]) {
    const key = unit.id || `${unit.tool}-${byId.size}`;
    const previous = byId.get(key);
    if (byId.has(key)) byId.delete(key);
    byId.set(key, { ...previous, ...unit });
  }
  return Array.from(byId.values()).slice(-32);
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
    tool: ACCEPTANCE_REPAIR_RERUN_TOOL_ID,
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
