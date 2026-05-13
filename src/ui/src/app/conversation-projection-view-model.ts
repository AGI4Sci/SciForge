import type { SciForgeRun } from '../domain';

export type UiConversationProjectionStatus =
  | 'idle'
  | 'planned'
  | 'dispatched'
  | 'partial-ready'
  | 'output-materialized'
  | 'validated'
  | 'satisfied'
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

const projectionStatuses = new Set<UiConversationProjectionStatus>([
  'idle',
  'planned',
  'dispatched',
  'partial-ready',
  'output-materialized',
  'validated',
  'satisfied',
  'degraded-result',
  'external-blocked',
  'repair-needed',
  'needs-human',
  'background-running',
]);

export function conversationProjectionForRun(run?: SciForgeRun): UiConversationProjection | undefined {
  const raw = isRecord(run?.raw) ? run.raw : undefined;
  const displayIntent = isRecord(raw?.displayIntent) ? raw.displayIntent : undefined;
  const resultPresentation = isRecord(raw?.resultPresentation) ? raw.resultPresentation : undefined;
  const displayResultPresentation = isRecord(displayIntent?.resultPresentation) ? displayIntent.resultPresentation : undefined;
  const taskOutcomeProjection = isRecord(displayIntent?.taskOutcomeProjection) ? displayIntent.taskOutcomeProjection : undefined;
  const response = parseMaybeJsonObject(run?.response);
  const responseResultPresentation = isRecord(response?.resultPresentation) ? response.resultPresentation : undefined;
  return [
    resultPresentation?.conversationProjection,
    displayIntent?.conversationProjection,
    displayResultPresentation?.conversationProjection,
    taskOutcomeProjection?.conversationProjection,
    responseResultPresentation?.conversationProjection,
  ].map(normalizeConversationProjection).find(Boolean);
}

export function conversationProjectionStatus(projection?: UiConversationProjection): UiConversationProjectionStatus {
  return projection?.visibleAnswer?.status ?? projection?.activeRun?.status ?? 'idle';
}

export function conversationProjectionIsRecoverable(projection?: UiConversationProjection): boolean {
  if (!projection) return false;
  return ['degraded-result', 'external-blocked', 'repair-needed', 'needs-human'].includes(conversationProjectionStatus(projection))
    || conversationProjectionRecoverActions(projection).length > 0;
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

function normalizeConversationProjection(value: unknown): UiConversationProjection | undefined {
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion !== 'sciforge.conversation-projection.v1') return undefined;
  const status = normalizeStatus(isRecord(value.visibleAnswer) ? value.visibleAnswer.status : undefined)
    ?? normalizeStatus(isRecord(value.activeRun) ? value.activeRun.status : undefined);
  if (!status) return undefined;
  const visibleAnswer = isRecord(value.visibleAnswer)
    ? {
      status,
      text: asString(value.visibleAnswer.text),
      artifactRefs: asStringList(value.visibleAnswer.artifactRefs),
      diagnostic: asString(value.visibleAnswer.diagnostic),
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
      summary: asString(event.summary) ?? '',
      timestamp: asString(event.timestamp) ?? '',
    })),
    recoverActions: asStringList(value.recoverActions),
    verificationState: isRecord(value.verificationState) ? {
      status: asString(value.verificationState.status),
      verifierRef: asString(value.verificationState.verifierRef),
      verdict: asString(value.verificationState.verdict),
    } : undefined,
    backgroundState: isRecord(value.backgroundState) ? {
      status: asString(value.backgroundState.status),
      checkpointRefs: asStringList(value.backgroundState.checkpointRefs),
      revisionPlan: asString(value.backgroundState.revisionPlan),
    } : undefined,
    auditRefs: asStringList(value.auditRefs),
    diagnostics: recordList(value.diagnostics).map((diagnostic) => ({
      severity: asString(diagnostic.severity),
      code: asString(diagnostic.code),
      message: asString(diagnostic.message) ?? asString(diagnostic.code) ?? 'Conversation projection diagnostic.',
      refs: recordList(diagnostic.refs).map((ref) => ({ ref: asString(ref.ref) })),
    })),
  };
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
  return projectionStatuses.has(value as UiConversationProjectionStatus) ? value as UiConversationProjectionStatus : undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
