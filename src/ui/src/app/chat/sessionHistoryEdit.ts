import type { ConversationEventLog } from '../../../../runtime/conversation-kernel/types';
import type {
  RuntimeExecutionUnit,
  SciForgeMessage,
  SciForgeRun,
  SciForgeSession,
} from '../../domain';
import { makeId, nowIso } from '../../domain';

const HISTORY_EDIT_BRANCH_SCHEMA_VERSION = 'sciforge.history-edit-branch.v1';

export type HistoricalMessageEditMode = 'revert' | 'continue';

export interface HistoricalMessageEditRef {
  ref: string;
  source: 'message' | 'run' | 'artifact' | 'execution-unit' | 'claim' | 'notebook' | 'ui-manifest' | 'object-reference';
  sourceId?: string;
  title?: string;
  reason: 'invalidated-after-edit' | 'affected-by-edit';
}

export interface HistoricalMessageEditConflict {
  id: string;
  kind: 'downstream-result-after-edited-message';
  sourceMessageRef: string;
  affectedRefs: string[];
  affectedConclusionRefs: string[];
  detail: string;
}

export interface HistoricalMessageEditConclusion {
  ref: string;
  id: string;
  text: string;
  supportingRefs: string[];
  opposingRefs: string[];
  dependencyRefs: string[];
}

export interface HistoricalMessageEditBranch {
  schemaVersion: typeof HISTORY_EDIT_BRANCH_SCHEMA_VERSION;
  id: string;
  mode: HistoricalMessageEditMode;
  messageId: string;
  sourceMessageRef: string;
  originalContent: string;
  editedContent: string;
  editedAt: string;
  boundaryAt: string;
  invalidatedRefs: HistoricalMessageEditRef[];
  affectedRefs: HistoricalMessageEditRef[];
  affectedConclusions: HistoricalMessageEditConclusion[];
  conflicts: HistoricalMessageEditConflict[];
  requiresUserConfirmation: boolean;
  nextStep: string;
  kernelEventLog: ConversationEventLog;
  kernelEventLogDigest: string;
  projectionInvalidation: HistoricalMessageEditProjectionInvalidation;
  refInvalidation: HistoricalMessageEditRefInvalidation;
}

export interface HistoricalMessageEditProjectionInvalidation {
  schemaVersion: 'sciforge.history-edit-projection-invalidation.v1';
  source: 'history-edit-event-log';
  invalidatesProjection: true;
  reason: 'edited-message-boundary';
  boundaryAt: string;
  staleProjectionRefs: string[];
}

export interface HistoricalMessageEditRefInvalidation {
  schemaVersion: 'sciforge.history-edit-ref-invalidation.v1';
  mode: HistoricalMessageEditMode;
  invalidatedRefs: string[];
  affectedRefs: string[];
}

export type HistoricalMessageEditSession = SciForgeSession & {
  historyEditBranches?: HistoricalMessageEditBranch[];
};

export interface HistoricalMessageEditResult {
  session: HistoricalMessageEditSession;
  branch?: HistoricalMessageEditBranch;
}

export function applyHistoricalUserMessageEdit({
  session,
  messageId,
  content,
  mode,
  editedAt = nowIso(),
}: {
  session: SciForgeSession;
  messageId: string;
  content: string;
  mode: HistoricalMessageEditMode;
  editedAt?: string;
}): HistoricalMessageEditResult {
  const index = session.messages.findIndex((message) => message.id === messageId);
  const target = session.messages[index];
  if (index < 0 || !target || target.role !== 'user') {
    return { session: session as HistoricalMessageEditSession };
  }
  const impact = historicalEditImpact(session, index);
  const branchId = makeId('history-edit');
  const affectedRefs = impact.refs.map((ref) => ({ ...ref, reason: 'affected-by-edit' as const }));
  const invalidatedRefs = mode === 'revert'
    ? impact.refs.map((ref) => ({ ...ref, reason: 'invalidated-after-edit' as const }))
    : [];
  const sourceMessageRef = `message:${messageId}`;
  const projectionInvalidation = historicalEditProjectionInvalidation(mode, impact, invalidatedRefs);
  const refInvalidation = historicalEditRefInvalidation(mode, invalidatedRefs, affectedRefs);
  const branch: HistoricalMessageEditBranch = {
    schemaVersion: HISTORY_EDIT_BRANCH_SCHEMA_VERSION,
    id: branchId,
    mode,
    messageId,
    sourceMessageRef,
    originalContent: target.content,
    editedContent: content,
    editedAt,
    boundaryAt: impact.cutoff,
    invalidatedRefs,
    affectedRefs,
    affectedConclusions: impact.affectedConclusions,
    conflicts: mode === 'continue' ? historicalEditConflicts(sourceMessageRef, impact) : [],
    requiresUserConfirmation: mode === 'continue' && impact.refs.length > 0,
    nextStep: historicalEditNextStep(mode, impact.refs.length),
    kernelEventLog: {
      schemaVersion: 'sciforge.conversation-event-log.v1',
      conversationId: `session:${session.sessionId}:history-edit:${branchId}`,
      events: [],
    },
    kernelEventLogDigest: '',
    projectionInvalidation,
    refInvalidation,
  };
  branch.kernelEventLog = historicalEditKernelEventLog(session, branch);
  branch.kernelEventLogDigest = stableTextHash(stableJson(branch.kernelEventLog));
  const editedMessage = updateHistoricalEditMessage(target, content, editedAt);
  const nextSession = mode === 'revert'
    ? revertHistoricalEditSession(session, index, editedMessage, impact, editedAt)
    : continueHistoricalEditSession(session, messageId, editedMessage, impact, branch, editedAt);
  return {
    session: appendHistoryEditBranch(nextSession, branch),
    branch,
  };
}

function updateHistoricalEditMessage(message: SciForgeMessage, content: string, updatedAt: string): SciForgeMessage {
  return { ...message, content, updatedAt, status: 'completed' };
}

interface HistoricalEditImpact {
  cutoff: string;
  refs: Array<Omit<HistoricalMessageEditRef, 'reason'>>;
  affectedRunIds: Set<string>;
  affectedArtifactIds: Set<string>;
  affectedExecutionUnitIds: Set<string>;
  affectedClaimIds: Set<string>;
  affectedConclusions: HistoricalMessageEditConclusion[];
  affectedRuns: SciForgeRun[];
}

function historicalEditImpact(session: SciForgeSession, messageIndex: number): HistoricalEditImpact {
  const target = session.messages[messageIndex];
  const cutoff = target?.createdAt ?? '';
  const downstreamMessages = session.messages.slice(messageIndex + 1);
  const affectedRuns = cutoff ? session.runs.filter((run) => run.createdAt >= cutoff) : session.runs;
  const affectedRunIds = new Set(affectedRuns.map((run) => run.id));
  const downstreamObjectRefs = [
    ...downstreamMessages.flatMap((message) => message.objectReferences ?? []),
    ...affectedRuns.flatMap((run) => run.objectReferences ?? []),
  ];
  const affectedArtifactIds = new Set<string>();
  for (const artifact of session.artifacts) {
    const runId = stringField(artifact.metadata?.runId);
    if (runId && affectedRunIds.has(runId)) affectedArtifactIds.add(artifact.id);
  }
  for (const reference of downstreamObjectRefs) {
    const artifactId = idFromPrefixedRef(reference.ref, 'artifact');
    if (artifactId) affectedArtifactIds.add(artifactId);
  }
  const affectedExecutionUnitIds = new Set<string>();
  for (const reference of downstreamObjectRefs) {
    const executionUnitId = reference.executionUnitId ?? idFromPrefixedRef(reference.ref, 'execution-unit');
    if (executionUnitId) affectedExecutionUnitIds.add(executionUnitId);
  }
  for (const unit of session.executionUnits) {
    if (executionUnitBelongsToEditImpact(unit, cutoff, affectedRunIds, affectedArtifactIds)) {
      affectedExecutionUnitIds.add(unit.id);
    }
  }
  const impactRefSet = new Set<string>([
    ...Array.from(affectedRunIds, (id) => `run:${id}`),
    ...Array.from(affectedArtifactIds, (id) => `artifact:${id}`),
    ...Array.from(affectedExecutionUnitIds, (id) => `execution-unit:${id}`),
    ...downstreamObjectRefs.map((reference) => reference.ref),
  ]);
  const affectedClaims = session.claims.filter((claim) => {
    if (cutoff && claim.updatedAt >= cutoff) return true;
    return claimRefs(claim).some((ref) => impactRefSet.has(ref));
  });
  const affectedClaimIds = new Set(affectedClaims.map((claim) => claim.id));
  const refs = uniqueHistoricalEditRefs([
    ...downstreamMessages.map((message) => ({
      ref: `message:${message.id}`,
      source: 'message' as const,
      sourceId: message.id,
      title: message.role,
    })),
    ...affectedRuns.map((run) => ({
      ref: `run:${run.id}`,
      source: 'run' as const,
      sourceId: run.id,
      title: run.prompt || run.id,
    })),
    ...session.artifacts.filter((artifact) => affectedArtifactIds.has(artifact.id)).map((artifact) => ({
      ref: `artifact:${artifact.id}`,
      source: 'artifact' as const,
      sourceId: artifact.id,
      title: stringField(artifact.metadata?.title) ?? artifact.id,
    })),
    ...session.executionUnits.filter((unit) => affectedExecutionUnitIds.has(unit.id)).map((unit) => ({
      ref: `execution-unit:${unit.id}`,
      source: 'execution-unit' as const,
      sourceId: unit.id,
      title: unit.tool || unit.id,
    })),
    ...affectedClaims.map((claim) => ({
      ref: `claim:${claim.id}`,
      source: 'claim' as const,
      sourceId: claim.id,
      title: claim.text,
    })),
    ...session.notebook.filter((entry) => cutoff && entry.time >= cutoff || refsIntersect(notebookRefs(entry), impactRefSet)).map((entry) => ({
      ref: `notebook:${entry.id}`,
      source: 'notebook' as const,
      sourceId: entry.id,
      title: entry.title,
    })),
    ...session.uiManifest.filter((slot) => uiManifestSlotRefs(slot).some((ref) => impactRefSet.has(ref))).map((slot, slotIndex) => ({
      ref: `ui-manifest:${slotIndex + 1}`,
      source: 'ui-manifest' as const,
      sourceId: slot.artifactRef ?? slot.componentId,
      title: slot.title ?? slot.componentId,
    })),
    ...downstreamObjectRefs.map((reference) => ({
      ref: reference.ref,
      source: 'object-reference' as const,
      sourceId: reference.id,
      title: reference.title,
    })),
  ]);
  return {
    cutoff,
    refs,
    affectedRunIds,
    affectedArtifactIds,
    affectedExecutionUnitIds,
    affectedClaimIds,
    affectedConclusions: affectedClaims.map((claim) => ({
      ref: `claim:${claim.id}`,
      id: claim.id,
      text: claim.text,
      supportingRefs: claim.supportingRefs,
      opposingRefs: claim.opposingRefs,
      dependencyRefs: claim.dependencyRefs ?? [],
    })),
    affectedRuns,
  };
}

function executionUnitBelongsToEditImpact(
  unit: RuntimeExecutionUnit,
  cutoff: string,
  affectedRunIds: Set<string>,
  affectedArtifactIds: Set<string>,
) {
  if (unit.routeDecision?.selectedAt && unit.routeDecision.selectedAt >= cutoff) return true;
  if (unit.time && unit.time >= cutoff) return true;
  if (refMentionsAnyRun(unit.outputRef, affectedRunIds) || refMentionsAnyRun(unit.codeRef, affectedRunIds)) return true;
  if (unit.artifacts?.some((id) => affectedArtifactIds.has(id))) return true;
  if (unit.outputArtifacts?.some((id) => affectedArtifactIds.has(id))) return true;
  return false;
}

function revertHistoricalEditSession(
  session: SciForgeSession,
  messageIndex: number,
  editedMessage: SciForgeMessage,
  impact: HistoricalEditImpact,
  updatedAt: string,
): HistoricalMessageEditSession {
  const impactRefs = new Set(impact.refs.map((ref) => ref.ref));
  return {
    ...(session as HistoricalMessageEditSession),
    messages: [...session.messages.slice(0, messageIndex), editedMessage],
    runs: session.runs.filter((run) => !impact.affectedRunIds.has(run.id)),
    uiManifest: session.uiManifest.filter((slot) => !uiManifestSlotRefs(slot).some((ref) => impactRefs.has(ref))),
    claims: session.claims.filter((claim) => !impact.affectedClaimIds.has(claim.id)),
    executionUnits: session.executionUnits.filter((unit) => !impact.affectedExecutionUnitIds.has(unit.id)),
    artifacts: session.artifacts.filter((artifact) => !impact.affectedArtifactIds.has(artifact.id)),
    notebook: session.notebook.filter((entry) => !impactRefs.has(`notebook:${entry.id}`) && !refsIntersect(notebookRefs(entry), impactRefs)),
    updatedAt,
  };
}

function continueHistoricalEditSession(
  session: SciForgeSession,
  messageId: string,
  editedMessage: SciForgeMessage,
  impact: HistoricalEditImpact,
  branch: HistoricalMessageEditBranch,
  updatedAt: string,
): HistoricalMessageEditSession {
  const conflict = {
    schemaVersion: HISTORY_EDIT_BRANCH_SCHEMA_VERSION,
    branchId: branch.id,
    sourceMessageRef: branch.sourceMessageRef,
    editedAt: branch.editedAt,
    requiresUserConfirmation: branch.requiresUserConfirmation,
    nextStep: branch.nextStep,
  };
  return {
    ...(session as HistoricalMessageEditSession),
    messages: session.messages.map((message) => message.id === messageId ? editedMessage : message),
    runs: session.runs.map((run) => impact.affectedRunIds.has(run.id)
      ? { ...run, raw: mergeHistoricalEditConflictRaw(run.raw, conflict) }
      : run),
    artifacts: session.artifacts.map((artifact) => impact.affectedArtifactIds.has(artifact.id)
      ? {
          ...artifact,
          metadata: {
            ...(artifact.metadata ?? {}),
            historicalEditConflict: conflict,
          },
        }
      : artifact),
    updatedAt,
  };
}

function appendHistoryEditBranch(session: HistoricalMessageEditSession, branch: HistoricalMessageEditBranch): HistoricalMessageEditSession {
  return {
    ...session,
    historyEditBranches: [...(session.historyEditBranches ?? []), branch].slice(-12),
  };
}

function mergeHistoricalEditConflictRaw(raw: unknown, conflict: Record<string, unknown>) {
  const base = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return {
    ...base,
    historicalEditConflict: {
      ...(recordField(base.historicalEditConflict)),
      ...conflict,
    },
  };
}

function historicalEditConflicts(sourceMessageRef: string, impact: HistoricalEditImpact): HistoricalMessageEditConflict[] {
  const conclusionRefs = impact.affectedConclusions.map((claim) => claim.ref);
  return impact.affectedRuns.map((run) => {
    const affectedRefs = uniqueStrings([
      `run:${run.id}`,
      ...(run.objectReferences ?? []).map((reference) => reference.ref),
    ]);
    return {
      id: makeId('history-conflict'),
      kind: 'downstream-result-after-edited-message',
      sourceMessageRef,
      affectedRefs,
      affectedConclusionRefs: conclusionRefs,
      detail: `Run ${run.id} was produced after ${sourceMessageRef}; confirm whether to keep it with the edited message or rerun from the edit boundary.`,
    };
  });
}

function historicalEditNextStep(mode: HistoricalMessageEditMode, affectedRefCount: number) {
  if (mode === 'revert') {
    return affectedRefCount > 0
      ? 'Downstream derived refs were invalidated. Start the next run from the edited message boundary.'
      : 'No downstream derived refs were found; continue from the edited message.';
  }
  return affectedRefCount > 0
    ? 'Ask the user to confirm whether to keep the affected downstream results or rerun from the edited message boundary before using those refs as current conclusions.'
    : 'No downstream results conflict with the edit; continue normally.';
}

function historicalEditProjectionInvalidation(
  mode: HistoricalMessageEditMode,
  impact: HistoricalEditImpact,
  invalidatedRefs: HistoricalMessageEditRef[],
): HistoricalMessageEditProjectionInvalidation {
  const staleProjectionRefs = mode === 'revert'
    ? invalidatedRefs.map((ref) => ref.ref)
    : impact.refs.map((ref) => ref.ref);
  return {
    schemaVersion: 'sciforge.history-edit-projection-invalidation.v1',
    source: 'history-edit-event-log',
    invalidatesProjection: true,
    reason: 'edited-message-boundary',
    boundaryAt: impact.cutoff,
    staleProjectionRefs: uniqueStrings(staleProjectionRefs).slice(0, 64),
  };
}

function historicalEditRefInvalidation(
  mode: HistoricalMessageEditMode,
  invalidatedRefs: HistoricalMessageEditRef[],
  affectedRefs: HistoricalMessageEditRef[],
): HistoricalMessageEditRefInvalidation {
  return {
    schemaVersion: 'sciforge.history-edit-ref-invalidation.v1',
    mode,
    invalidatedRefs: uniqueStrings(invalidatedRefs.map((ref) => ref.ref)).slice(0, 64),
    affectedRefs: uniqueStrings(affectedRefs.map((ref) => ref.ref)).slice(0, 64),
  };
}

function historicalEditKernelEventLog(session: SciForgeSession, branch: HistoricalMessageEditBranch): ConversationEventLog {
  const originalContentDigest = digestTextField(branch.originalContent);
  const editedContentDigest = digestTextField(branch.editedContent);
  return {
    schemaVersion: 'sciforge.conversation-event-log.v1',
    conversationId: `session:${session.sessionId}:history-edit:${branch.id}`,
    events: [{
      id: `${branch.id}:history-edited`,
      type: 'HistoryEdited',
      storage: 'inline',
      actor: 'ui',
      timestamp: branch.editedAt,
      turnId: branch.sourceMessageRef,
      payload: {
        summary: `Historical message ${branch.mode} at ${branch.sourceMessageRef}`,
        branchId: branch.id,
        mode: branch.mode,
        sourceMessageRef: branch.sourceMessageRef,
        messageId: branch.messageId,
        boundaryAt: branch.boundaryAt,
        editedAt: branch.editedAt,
        originalContentDigest,
        editedContentDigest,
        invalidatedRefs: branch.refInvalidation.invalidatedRefs,
        affectedRefs: branch.refInvalidation.affectedRefs,
        affectedConclusionRefs: branch.affectedConclusions.map((claim) => claim.ref).slice(0, 64),
        conflicts: branch.conflicts.map((conflict) => ({
          id: conflict.id,
          kind: conflict.kind,
          affectedRefs: conflict.affectedRefs.slice(0, 16),
          affectedConclusionRefs: conflict.affectedConclusionRefs.slice(0, 16),
        })),
        requiresUserConfirmation: branch.requiresUserConfirmation,
        nextStep: branch.nextStep,
        projectionInvalidation: branch.projectionInvalidation,
        refInvalidation: branch.refInvalidation,
      },
    }],
  };
}

function digestTextField(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return {
    omitted: 'text-body',
    chars: value.length,
    hash: stableTextHash(value),
  };
}

function stableTextHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function idFromPrefixedRef(ref: string | undefined, prefix: string) {
  if (!ref) return undefined;
  const marker = `${prefix}:`;
  return ref.startsWith(marker) ? ref.slice(marker.length).split(/[/?#]/, 1)[0] : undefined;
}

function refMentionsAnyRun(ref: string | undefined, runIds: Set<string>) {
  if (!ref) return false;
  for (const runId of runIds) {
    if (ref === `run:${runId}` || ref.startsWith(`run:${runId}/`) || ref.startsWith(`run:${runId}#`)) return true;
  }
  return false;
}

function claimRefs(claim: SciForgeSession['claims'][number]) {
  return [...claim.supportingRefs, ...claim.opposingRefs, ...(claim.dependencyRefs ?? [])];
}

function notebookRefs(entry: SciForgeSession['notebook'][number]) {
  return [
    ...(entry.artifactRefs ?? []).map((id) => id.includes(':') ? id : `artifact:${id}`),
    ...(entry.executionUnitRefs ?? []).map((id) => id.includes(':') ? id : `execution-unit:${id}`),
    ...(entry.beliefRefs ?? []),
    ...(entry.dependencyRefs ?? []),
  ];
}

function uiManifestSlotRefs(slot: SciForgeSession['uiManifest'][number]) {
  return [
    slot.artifactRef,
    ...(slot.compare?.artifactRefs ?? []),
  ].filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)
    .map((ref) => ref.includes(':') ? ref : `artifact:${ref}`);
}

function refsIntersect(refs: string[], candidates: Set<string>) {
  return refs.some((ref) => candidates.has(ref));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueHistoricalEditRefs(refs: Array<Omit<HistoricalMessageEditRef, 'reason'>>) {
  const byRef = new Map<string, Omit<HistoricalMessageEditRef, 'reason'>>();
  for (const ref of refs) {
    if (!ref.ref || byRef.has(ref.ref)) continue;
    byRef.set(ref.ref, ref);
  }
  return Array.from(byRef.values());
}

function recordField(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
