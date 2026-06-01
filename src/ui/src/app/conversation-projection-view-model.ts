import type { SciForgeRun, SciForgeSession } from '../domain';
import { isConversationEventLog } from '../../../runtime/conversation-kernel/event-log';
import { projectConversation } from '../../../runtime/conversation-kernel/projection';
import { runtimeDebugValueHasRawLeak } from '../runtimeDebugScrubber';

export type UiConversationProjectionStatus =
  | 'idle'
  | 'planned'
  | 'dispatched'
  | 'partial-ready'
  | 'output-materialized'
  | 'validated'
  | 'satisfied'
  | 'visible-not-live-acceptance'
  | 'degraded-result'
  | 'external-blocked'
  | 'repair-needed'
  | 'needs-human'
  | 'background-running';

export interface UiConversationProjection {
  schemaVersion: 'sciforge.conversation-projection.v1';
  conversationId: string;
  currentTurn?: {
    id: string;
    prompt?: string;
  };
  visibleAnswer?: {
    status: UiConversationProjectionStatus;
    text?: string;
    artifactRefs: string[];
    diagnostic?: string;
  };
  activeRun?: {
    id: string;
    status: UiConversationProjectionStatus;
  };
  artifacts: Array<{
    ref: string;
    digest?: string;
    mime?: string;
    sizeBytes?: number;
    label?: string;
  }>;
  executionProcess: Array<{
    eventId: string;
    type: string;
    summary: string;
    timestamp: string;
  }>;
  recoverActions: string[];
  verificationState?: {
    status?: string;
    verifierRef?: string;
    verdict?: string;
  };
  runtimeMetadata?: {
    provider?: string;
    model?: string;
    profile?: string;
    workspace?: string;
    commandId?: string;
    attemptId?: string;
    codexSessionId?: string;
    auditRefs?: string[];
    foldedAudit?: boolean;
  };
  backgroundState?: {
    status?: string;
    checkpointRefs?: string[];
    revisionPlan?: string;
  };
  auditRefs: string[];
  diagnostics: Array<{
    severity?: string;
    code?: string;
    message: string;
    refs?: Array<{ ref?: string }>;
  }>;
}

export interface UiConversationProjectionRecoverFocusSignal {
  activeRunId?: string;
  reason: 'active-run' | 'recover-actions' | 'verification' | 'background';
}

type SessionWithConversationProjection = SciForgeSession & {
  conversationProjection?: unknown;
  materializedConversationProjection?: unknown;
  currentConversationProjection?: unknown;
  conversationProjections?: unknown;
  materializedConversationProjections?: unknown;
};

const projectionStatuses = new Set<UiConversationProjectionStatus>([
  'idle',
  'planned',
  'dispatched',
  'partial-ready',
  'output-materialized',
  'validated',
  'satisfied',
  'visible-not-live-acceptance',
  'degraded-result',
  'external-blocked',
  'repair-needed',
  'needs-human',
  'background-running',
]);

const recoverFocusRunStatuses = new Set<UiConversationProjectionStatus>([
  'degraded-result',
  'external-blocked',
  'repair-needed',
  'needs-human',
  'background-running',
]);

const recoverFocusVerificationStatuses = new Set([
  'failed',
  'rejected',
  'required',
]);

const recoverFocusBackgroundStatuses = new Set([
  'running',
  'background-running',
  'pending',
  'queued',
]);

export function conversationProjectionForSession(session: SciForgeSession, run?: SciForgeRun): UiConversationProjection | undefined {
  const source = session as SessionWithConversationProjection;
  const fallbackTimestamp = projectionFallbackTimestamp(run);
  const candidates = [
    projectionFromSessionProjectionMap(source.materializedConversationProjections, run),
    projectionFromSessionProjectionMap(source.conversationProjections, run),
    source.materializedConversationProjection,
    source.currentConversationProjection,
    source.conversationProjection,
  ];
  return candidates.map((candidate) => normalizeConversationProjection(candidate, fallbackTimestamp)).find(Boolean) ?? conversationProjectionFromRun(run);
}

export function conversationProjectionMigrationAuditFixtureForRun(run?: SciForgeRun): UiConversationProjection | undefined {
  return conversationProjectionFromRun(run);
}

function conversationProjectionFromRun(run?: SciForgeRun): UiConversationProjection | undefined {
  const fallbackTimestamp = projectionFallbackTimestamp(run);
  const raw = isRecord(run?.raw) ? run.raw : undefined;
  const displayIntent = isRecord(raw?.displayIntent) ? raw.displayIntent : undefined;
  const resultPresentation = isRecord(raw?.resultPresentation) ? raw.resultPresentation : undefined;
  const displayResultPresentation = isRecord(displayIntent?.resultPresentation) ? displayIntent.resultPresentation : undefined;
  const taskOutcomeProjection = isRecord(displayIntent?.taskOutcomeProjection) ? displayIntent.taskOutcomeProjection : undefined;
  const response = parseMaybeJsonObject(run?.response);
  const responseResultPresentation = isRecord(response?.resultPresentation) ? response.resultPresentation : undefined;
  const fromEventLog = [
    displayIntent?.conversationEventLog,
    taskOutcomeProjection?.conversationEventLog,
    resultPresentation?.conversationEventLog,
    displayResultPresentation?.conversationEventLog,
    responseResultPresentation?.conversationEventLog,
  ].map((candidate) => projectConversationEventLogForUi(candidate, fallbackTimestamp)).find(Boolean);
  if (fromEventLog) return fromEventLog;
  return [
    resultPresentation?.conversationProjection,
    displayIntent?.conversationProjection,
    displayResultPresentation?.conversationProjection,
    taskOutcomeProjection?.conversationProjection,
    responseResultPresentation?.conversationProjection,
  ].map((candidate) => normalizeConversationProjection(candidate, fallbackTimestamp)).find(Boolean)
    ?? completionCandidateProjectionFromRun(run, fallbackTimestamp);
}

function projectionFromSessionProjectionMap(value: unknown, run?: SciForgeRun): unknown {
  if (!isRecord(value)) return undefined;
  const runId = run?.id;
  if (runId && value[runId]) return value[runId];
  if (runId && isRecord(value.projections) && value.projections[runId]) return value.projections[runId];
  const currentRunId = asString(value.currentRunId) ?? asString(value.activeRunId);
  if (currentRunId && isRecord(value.projections) && value.projections[currentRunId]) return value.projections[currentRunId];
  if (isRecord(value.current)) return value.current;
  if (isRecord(value.latest)) return value.latest;
  return undefined;
}

function projectConversationEventLogForUi(value: unknown, fallbackTimestamp?: string): UiConversationProjection | undefined {
  if (!isConversationEventLog(value)) return undefined;
  return normalizeConversationProjection(projectConversation(value), fallbackTimestamp);
}

export function conversationProjectionStatus(projection?: UiConversationProjection): UiConversationProjectionStatus {
  return projection?.visibleAnswer?.status ?? projection?.activeRun?.status ?? 'idle';
}

export function conversationProjectionIsRecoverable(projection?: UiConversationProjection): boolean {
  if (!projection) return false;
  return ['degraded-result', 'external-blocked', 'repair-needed', 'needs-human'].includes(conversationProjectionStatus(projection))
    || conversationProjectionRecoverActions(projection).length > 0;
}

export function conversationProjectionRecoverFocusSignal(projection?: UiConversationProjection): UiConversationProjectionRecoverFocusSignal | undefined {
  if (!projection) return undefined;
  if (projection.activeRun && recoverFocusRunStatuses.has(projection.activeRun.status)) {
    return { activeRunId: projection.activeRun.id, reason: 'active-run' };
  }
  if (conversationProjectionRecoverActions(projection).length > 0) {
    return { activeRunId: projection.activeRun?.id, reason: 'recover-actions' };
  }
  if (projection.verificationState?.status && recoverFocusVerificationStatuses.has(projection.verificationState.status)) {
    return { activeRunId: projection.activeRun?.id, reason: 'verification' };
  }
  const backgroundStatus = projection.backgroundState?.status;
  if (
    (backgroundStatus && recoverFocusBackgroundStatuses.has(backgroundStatus))
    || Boolean(projection.backgroundState?.revisionPlan)
  ) {
    return { activeRunId: projection.activeRun?.id, reason: 'background' };
  }
  return undefined;
}

export function conversationProjectionRecoverActions(projection?: UiConversationProjection): string[] {
  if (!projection) return [];
  return uniqueStrings([
    ...projection.recoverActions,
    projection.backgroundState?.revisionPlan,
  ].filter((value): value is string => Boolean(value)));
}

export function conversationProjectionAuditRefs(projection?: UiConversationProjection): string[] {
  if (!projection) return [];
  return uniqueStrings([
    ...projection.auditRefs,
    ...conversationProjectionArtifactRefs(projection),
    ...projection.artifacts.map((artifact) => artifact.ref),
    projection.verificationState?.verifierRef,
    ...(projection.backgroundState?.checkpointRefs ?? []),
    ...projection.diagnostics.flatMap((diagnostic) => diagnostic.refs?.map((ref) => ref.ref).filter((ref): ref is string => Boolean(ref)) ?? []),
  ].filter((value): value is string => Boolean(value)));
}

export function conversationProjectionArtifactRefs(projection?: UiConversationProjection): string[] {
  if (!projection) return [];
  return uniqueStrings([
    ...(projection.visibleAnswer?.artifactRefs ?? []),
    ...projection.artifacts.map((artifact) => artifact.ref).filter((ref) => ref.startsWith('artifact:')),
  ]);
}

export function conversationProjectionPrimaryDiagnostic(projection?: UiConversationProjection): string | undefined {
  return projection?.visibleAnswer?.diagnostic
    ?? projection?.diagnostics.find((diagnostic) => diagnostic.severity === 'error')?.message
    ?? projection?.diagnostics[0]?.message;
}

export function conversationProjectionVisibleText(projection?: UiConversationProjection): string | undefined {
  return projection?.visibleAnswer?.text;
}

function normalizeConversationProjection(value: unknown, fallbackTimestamp?: string): UiConversationProjection | undefined {
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion !== 'sciforge.conversation-projection.v1') return undefined;
  const status = normalizeStatus(isRecord(value.visibleAnswer) ? value.visibleAnswer.status : undefined)
    ?? normalizeStatus(isRecord(value.activeRun) ? value.activeRun.status : undefined);
  if (!status) return undefined;
  const visibleAnswer = isRecord(value.visibleAnswer)
    ? {
      status,
      text: sanitizeUserProjectionText(asString(value.visibleAnswer.text)),
      artifactRefs: asStringList(value.visibleAnswer.artifactRefs),
      diagnostic: sanitizeUserProjectionText(asString(value.visibleAnswer.diagnostic)),
    }
    : undefined;
  return {
    schemaVersion: 'sciforge.conversation-projection.v1',
    conversationId: asString(value.conversationId) ?? 'conversation',
    currentTurn: normalizeCurrentTurn(value.currentTurn),
    visibleAnswer,
    activeRun: normalizeActiveRun(value.activeRun),
    artifacts: recordList(value.artifacts).map((artifact) => ({
      ref: asString(artifact.ref) ?? '',
      digest: asString(artifact.digest),
      mime: asString(artifact.mime),
      sizeBytes: typeof artifact.sizeBytes === 'number' ? artifact.sizeBytes : undefined,
      label: asString(artifact.label),
    })).filter((artifact) => artifact.ref),
    executionProcess: recordList(value.executionProcess).map((event) => ({
      eventId: asString(event.eventId) ?? asString(event.id) ?? 'event',
      type: asString(event.type) ?? 'event',
      summary: sanitizeUserProjectionText(asString(event.summary)) ?? '',
      timestamp: normalizeProjectionTimestamp(
        asString(event.timestamp) ?? asString(event.createdAt) ?? asString(event.completedAt) ?? asString(event.updatedAt),
        fallbackTimestamp,
      ),
    })),
    recoverActions: asStringList(value.recoverActions).map((action) => sanitizeUserProjectionText(action) ?? action),
    verificationState: isRecord(value.verificationState) ? {
      status: asString(value.verificationState.status),
      verifierRef: asString(value.verificationState.verifierRef),
      verdict: asString(value.verificationState.verdict),
    } : undefined,
    runtimeMetadata: normalizeRuntimeMetadata(value.runtimeMetadata),
    backgroundState: isRecord(value.backgroundState) ? {
      status: asString(value.backgroundState.status),
      checkpointRefs: asStringList(value.backgroundState.checkpointRefs),
      revisionPlan: sanitizeUserProjectionText(asString(value.backgroundState.revisionPlan)),
    } : undefined,
    auditRefs: asStringList(value.auditRefs),
    diagnostics: recordList(value.diagnostics).map((diagnostic) => ({
      severity: asString(diagnostic.severity),
      code: asString(diagnostic.code),
      message: sanitizeUserProjectionText(asString(diagnostic.message)) ?? asString(diagnostic.code) ?? 'Conversation projection diagnostic.',
      refs: recordList(diagnostic.refs).map((ref) => ({ ref: asString(ref.ref) })),
    })),
  };
}

function normalizeRuntimeMetadata(value: unknown): UiConversationProjection['runtimeMetadata'] {
  if (!isRecord(value)) return undefined;
  const metadata = {
    provider: asString(value.provider),
    model: asString(value.model),
    profile: asString(value.profile),
    workspace: asString(value.workspace),
    commandId: asString(value.commandId),
    attemptId: asString(value.attemptId),
    codexSessionId: asString(value.codexSessionId),
    auditRefs: asStringList(value.auditRefs),
    foldedAudit: typeof value.foldedAudit === 'boolean' ? value.foldedAudit : undefined,
  };
  return Object.entries(metadata).some(([, entry]) => Array.isArray(entry) ? entry.length > 0 : entry !== undefined)
    ? metadata
    : undefined;
}

function completionCandidateProjectionFromRun(run: SciForgeRun | undefined, fallbackTimestamp?: string): UiConversationProjection | undefined {
  const raw = isRecord(run?.raw) ? run.raw : undefined;
  const displayIntent = isRecord(raw?.displayIntent) ? raw.displayIntent : undefined;
  const resultPresentation = isRecord(raw?.resultPresentation) ? raw.resultPresentation : undefined;
  const candidates = [
    raw?.completionCandidate,
    displayIntent?.completionCandidate,
    resultPresentation?.completionCandidate,
  ];
  const candidate = candidates.find(isRecord);
  if (!candidate || !run) return undefined;
  const artifactRefs = uniqueStrings([
    ...asStringList(candidate.artifactRefs),
    ...recordList(candidate.artifacts).map((artifact) => asString(artifact.ref) ?? (asString(artifact.id) ? `artifact:${asString(artifact.id)}` : undefined)).filter((ref): ref is string => Boolean(ref)),
  ].filter((ref) => /^artifact::?[^/\s]+$/i.test(ref)));
  if (!artifactRefs.length) return undefined;
  const summary = safeCandidateSummary(candidate.summary) ?? '发现可用结果，待导入、验证或人工确认后才能作为最终答案。';
  const recoverActions = uniqueStrings([
    ...asStringList(candidate.recoverActions),
    ...asStringList(candidate.actions),
    '导入并验证候选结果',
  ]);
  const timestamp = normalizeProjectionTimestamp(asString(candidate.createdAt) ?? run.completedAt ?? run.createdAt, fallbackTimestamp);
  return {
    schemaVersion: 'sciforge.conversation-projection.v1',
    conversationId: `completion-candidate:${run.id}`,
    currentTurn: run.prompt ? { id: run.id, prompt: run.prompt } : undefined,
    visibleAnswer: {
      status: 'repair-needed',
      text: summary,
      artifactRefs,
      diagnostic: 'completion-candidate',
    },
    activeRun: { id: run.id, status: 'repair-needed' },
    artifacts: artifactRefs.map((ref) => ({ ref, label: ref.replace(/^artifact::?/, '') })),
    executionProcess: [{
      eventId: `completion-candidate:${run.id}`,
      type: 'completion-candidate',
      summary,
      timestamp,
    }],
    recoverActions,
    verificationState: { status: 'unverified' },
    backgroundState: undefined,
    auditRefs: uniqueStrings([...artifactRefs, ...asStringList(candidate.auditRefs)]),
    diagnostics: [{
      severity: 'warning',
      code: 'completion-candidate',
      message: 'Runtime found candidate artifacts after a failed or drifted handoff; UI must offer import/verify actions instead of inferring success from raw output.',
    }],
  };
}

function safeCandidateSummary(value: unknown): string | undefined {
  const summary = asString(value);
  if (!summary) return undefined;
  if (/^\s*[\[{]/.test(summary) || /\b(?:rawPayload|ToolPayload|stdout|stderr|handoff|task attempts?)\b/i.test(summary)) return undefined;
  if (runtimeDebugValueHasRawLeak({ summary })) return undefined;
  return summary.length > 320 ? `${summary.slice(0, 317).trim()}...` : summary;
}

function projectionFallbackTimestamp(run?: SciForgeRun) {
  return normalizeProjectionTimestamp(run?.completedAt ?? run?.createdAt);
}

function normalizeProjectionTimestamp(value: unknown, fallback?: string) {
  const candidate = asString(value);
  if (candidate && !isPlaceholderTimestamp(candidate)) return candidate;
  const fallbackCandidate = asString(fallback);
  return fallbackCandidate && !isPlaceholderTimestamp(fallbackCandidate) ? fallbackCandidate : '';
}

function isPlaceholderTimestamp(value: string) {
  const time = Date.parse(value);
  return !Number.isFinite(time) || time <= Date.parse('2000-01-01T00:00:00.000Z');
}

function normalizeCurrentTurn(value: unknown): UiConversationProjection['currentTurn'] {
  if (!isRecord(value)) return undefined;
  const id = asString(value.id);
  if (!id) return undefined;
  return { id, prompt: asString(value.prompt) };
}

function normalizeActiveRun(value: unknown): UiConversationProjection['activeRun'] {
  if (!isRecord(value)) return undefined;
  const id = asString(value.id);
  const status = normalizeStatus(value.status);
  if (!id || !status) return undefined;
  return { id, status };
}

function normalizeStatus(value: unknown): UiConversationProjectionStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  return projectionStatuses.has(normalized as UiConversationProjectionStatus) ? normalized as UiConversationProjectionStatus : undefined;
}

function parseMaybeJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function sanitizeUserProjectionText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/\bstarted\s+with\s+[^"'\s,;)]+\/[^"'\s,;)]+(?:\s+profile\s+[^"'\s,;)]+)?/gi, 'started with configured runtime')
    .replace(/\b(?:calling\s+local\s+model|using\s+model)\s+[^"'\s,;)]+\/[^"'\s,;)]+/gi, 'using configured model')
    .replace(/\bprovider\b\s*[:=]\s*["']?[^"'\s,;)]+/gi, 'service=[redacted]')
    .replace(/\bmodel\b\s*[:=]\s*["']?[^"'\s,;)]+/gi, 'runtime=[redacted]')
    .replace(/\bprovider\s+(?:route|config|configuration|profile|unset|metadata|payload|diagnostic|diagnostics)\b/gi, 'service configuration')
    .replace(/\bmodel\s+(?:name|base|config|configuration|profile|unset|metadata|payload|diagnostic|diagnostics)\b/gi, 'runtime configuration')
    .replace(/\b(runtime\s+profile|profile)\b\s*[:=]?\s*["']?[^"'\s,;)]+/gi, '$1 [redacted]')
    .replace(/(?:^|[\s(["'])\/(?:Applications|Users|Volumes|private|var|tmp)\/[^\s`"'<>),;]+/g, (match) => `${match.match(/^[\s(["']+/)?.[0] ?? ''}[local path]`)
    .replace(/\bcommand\s+id\b/gi, 'run reference')
    .replace(/\battempt\s+id\b/gi, 'attempt reference')
    .replace(/\bcodexSessionId\b/gi, 'session reference')
    .replace(/\bprofile\/workspace\b/gi, 'runtime configuration')
    .replace(/\bprofile\b/gi, 'runtime configuration')
    .replace(/\bworkspace\b/gi, 'project context')
    .replace(/with the preserved run reference, attempt reference, runtime configuration, project context, and audit refs/gi, 'with preserved audit context')
    .replace(/preserved run reference, attempt reference, runtime configuration, project context, and audit refs/gi, 'preserved audit context')
    .replace(/\baudit refs\b/gi, 'audit references')
    .replace(/\bSciForge ToolPayload\b/g, 'SciForge structured task result')
    .replace(/\bToolPayload\b/g, 'structured task result')
    .replace(/\btaskFiles\b/g, 'generated task files')
    .replace(/\braw payload\b/gi, 'debug payload')
    .replace(/\bstdout\/stderr\b/gi, 'execution logs')
    .replace(/\bstdout\b/gi, 'execution log')
    .replace(/\bstderr\b/gi, 'execution log');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
