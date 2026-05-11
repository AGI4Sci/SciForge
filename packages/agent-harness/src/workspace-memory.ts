import type {
  HarnessAuditNote,
  WorkspaceMemoryEntry,
  WorkspaceMemoryEntryKind,
  WorkspaceMemoryIndex,
  WorkspaceMemoryProvenance,
  WorkspaceMemoryReuseDecision,
  WorkspaceMemoryReuseStep,
  WorkspaceMemoryStaleAssessment,
  WorkspaceMemoryStaleReason,
  WorkspaceMemoryStaleSignal,
  WorkspaceMemoryValidity,
} from './contracts';

export interface WorkspaceMemoryEntryInput {
  id?: string;
  kind: WorkspaceMemoryEntryKind;
  ref: string;
  summary: string;
  provenance?: string[] | WorkspaceMemoryProvenance;
  sourceRunId?: string;
  confidence?: number;
  validity?: WorkspaceMemoryValidity;
  expiresAt?: string;
  invalidationKeys?: string[];
}

export interface WorkspaceMemoryIndexInput {
  indexId?: string;
  workspaceId?: string;
  generatedAt?: string;
  sourceRefs?: string[];
  entries: WorkspaceMemoryEntryInput[] | WorkspaceMemoryEntry[];
}

export interface BuildWorkspaceMemoryIndexInput {
  workspaceId: string;
  generatedAt?: string;
  entries: WorkspaceMemoryEntry[];
}

export interface WorkspaceReuseRequest {
  requiredRefs?: string[];
  candidateRefs?: string[];
  changedInvalidationKeys?: string[];
  forceRerunRefs?: string[];
  now?: string;
}

export interface WorkspaceReuseDecision {
  schemaVersion: 'sciforge.workspace-reuse-decision.v1';
  reusedRefs: string[];
  skippedDuplicateRefs: string[];
  staleRefs: string[];
  auditSummary: string[];
}

export interface WorkspaceMemoryReuseStepInput {
  stepId: string;
  ref: string;
  description?: string;
}

export interface SelectWorkspaceMemoryReuseInput {
  index: WorkspaceMemoryIndex;
  requestId?: string;
  requestedRefs?: string[];
  plannedSteps?: WorkspaceMemoryReuseStepInput[];
  staleSignals?: WorkspaceMemoryStaleSignal[];
  minConfidence?: number;
  now?: string | Date;
  sourceCallbackId?: string;
}

export function buildWorkspaceMemoryIndex(input: WorkspaceMemoryIndexInput | BuildWorkspaceMemoryIndexInput): WorkspaceMemoryIndex {
  const generatedAt = input.generatedAt ?? new Date(0).toISOString();
  const workspaceId = 'workspaceId' in input && input.workspaceId ? input.workspaceId : 'workspace:default';
  const entries = input.entries
    .map((entry, index) => normalizeWorkspaceMemoryEntry(entry, generatedAt, index))
    .sort((left, right) => left.ref.localeCompare(right.ref) || left.kind.localeCompare(right.kind));
  const sourceRefs = stableUnique([
    ...(('sourceRefs' in input ? input.sourceRefs : undefined) ?? []),
    ...entries.map((entry) => entry.provenance.sourceRef),
  ]);

  return {
    schemaVersion: 'sciforge.workspace-memory-index.v1',
    indexId: 'indexId' in input ? input.indexId : undefined,
    workspaceId,
    generatedAt,
    sourceRefs,
    entries,
    artifactRefs: refsForKind(entries, 'artifact-ref'),
    recentRuns: refsForKind(entries, 'recent-run'),
    knownFailures: refsForKind(entries, 'known-failure'),
    downloadedRefs: refsForKind(entries, 'downloaded-ref'),
    verifiedClaims: refsForKind(entries, 'verified-claim'),
    openedFiles: refsForKind(entries, 'opened-file'),
    capabilityOutcomes: refsForKind(entries, 'capability-outcome'),
  };
}

export function selectReusableWorkspaceMemory(
  index: WorkspaceMemoryIndex,
  request: WorkspaceReuseRequest = {},
): WorkspaceReuseDecision {
  const decision = selectWorkspaceMemoryReuse({
    index,
    requestedRefs: [...(request.requiredRefs ?? []), ...(request.candidateRefs ?? [])],
    staleSignals: [
      ...(request.changedInvalidationKeys ?? []).map((key) => ({ ref: key, invalidatedRefs: [key] })),
      ...(request.forceRerunRefs ?? []).map((ref) => ({ ref, userRequestedRerun: true })),
    ],
    now: request.now,
  });

  return {
    schemaVersion: 'sciforge.workspace-reuse-decision.v1',
    reusedRefs: decision.reusedEntries.map((entry) => entry.ref),
    skippedDuplicateRefs: decision.skippedDuplicateSteps.map((step) => step.ref),
    staleRefs: decision.staleEntries.map((entry) => index.entries.find((candidate) => candidate.id === entry.entryId)?.ref ?? entry.entryId),
    auditSummary: [decision.auditNote.message],
  };
}

export function isMemoryEntryStale(
  entry: WorkspaceMemoryEntry,
  options: {
    changedKeys?: Set<string>;
    forced?: Set<string>;
    nowMs?: number;
  } = {},
): boolean {
  return assessWorkspaceMemoryStaleness(entry, [
    ...Array.from(options.changedKeys ?? new Set<string>()).map((key) => ({ ref: key, invalidatedRefs: [key] })),
    ...Array.from(options.forced ?? new Set<string>()).map((ref) => ({ ref, userRequestedRerun: true })),
  ], {
    now: options.nowMs === undefined ? undefined : new Date(options.nowMs),
  }).refreshRequired;
}

export function assessWorkspaceMemoryStaleness(
  entry: WorkspaceMemoryEntry,
  signals: WorkspaceMemoryStaleSignal[] = [],
  options: { minConfidence?: number; now?: string | Date } = {},
): WorkspaceMemoryStaleAssessment {
  const minConfidence = options.minConfidence ?? 0.5;
  const nowMs = timeMs(options.now ?? new Date());
  const reasons = new Set<WorkspaceMemoryStaleReason>();

  if (!entry.provenance.sourceRef || !entry.provenance.producedAt) {
    reasons.add('missing-provenance');
  }
  if (entry.confidence < minConfidence) {
    reasons.add('low-confidence');
  }
  if (entry.validity === 'stale' && entry.invalidationReason) {
    reasons.add(entry.invalidationReason);
  }
  if (entry.validity === 'invalid') {
    reasons.add(entry.invalidationReason ?? 'invalidated');
  }
  if (entry.expiresAt && timeMs(entry.expiresAt) <= nowMs) {
    reasons.add('expired');
  }

  for (const signal of signals) {
    const invalidated = signal.invalidatedRefs ?? [];
    if (signal.userRequestedRerun && signalMatchesEntry(signal, entry)) {
      reasons.add('user-requested-rerun');
    }
    if (invalidated.some((key) => key === entry.id || key === entry.ref || entry.invalidationKeys?.includes(key))) {
      reasons.add('invalidated');
    }
    if (
      signal.contentHash &&
      entry.provenance.contentHash &&
      signal.contentHash !== entry.provenance.contentHash &&
      signalMatchesEntry(signal, entry)
    ) {
      reasons.add('file-changed');
    }
    if (
      signal.capabilityId &&
      signal.capabilityId === entry.provenance.capabilityId &&
      signal.capabilityVersion &&
      entry.provenance.capabilityVersion &&
      signal.capabilityVersion !== entry.provenance.capabilityVersion
    ) {
      reasons.add('capability-version-changed');
    }
    if (signal.sourceRunStatus && signal.sourceRunStatus !== 'completed' && signalMatchesEntry(signal, entry)) {
      reasons.add('source-run-failed');
    }
  }

  const staleReasons = Array.from(reasons);
  return {
    entryId: entry.id,
    validity: validityForAssessment(entry.validity, staleReasons),
    staleReasons,
    refreshRequired: staleReasons.length > 0,
  };
}

export function selectWorkspaceMemoryReuse(input: SelectWorkspaceMemoryReuseInput): WorkspaceMemoryReuseDecision {
  const minConfidence = input.minConfidence ?? 0.5;
  const requestedRefs = new Set(input.requestedRefs ?? []);
  const reusedEntries: WorkspaceMemoryEntry[] = [];
  const staleEntries: WorkspaceMemoryStaleAssessment[] = [];
  const actions: WorkspaceMemoryReuseDecision['actions'] = [];

  for (const entry of input.index.entries) {
    const assessment = assessWorkspaceMemoryStaleness(entry, input.staleSignals ?? [], {
      minConfidence,
      now: input.now,
    });
    if (assessment.refreshRequired) {
      staleEntries.push(assessment);
      actions.push({
        entryId: entry.id,
        action: assessment.staleReasons.includes('user-requested-rerun') ? 'rerun' : 'refresh',
        reason: `Memory entry is not reusable: ${assessment.staleReasons.join(', ')}`,
        staleReasons: assessment.staleReasons,
      });
      continue;
    }
    if (requestedRefs.size === 0 || requestedRefs.has(entry.ref) || requestedRefs.has(entry.id)) {
      reusedEntries.push(entry);
      actions.push({
        entryId: entry.id,
        action: 'reuse',
        reason: `Reusable ${entry.kind} from ${entry.provenance.sourceRunId ?? entry.sourceRunId ?? entry.provenance.sourceRef}`,
      });
    } else {
      actions.push({
        entryId: entry.id,
        action: 'ignore',
        reason: 'Entry is valid but not requested by this turn.',
      });
    }
  }

  const skippedDuplicateSteps = duplicateStepsForReuse(input.plannedSteps ?? [], reusedEntries);
  for (const step of skippedDuplicateSteps) {
    actions.push({
      entryId: step.reusedEntryId,
      action: 'skip-duplicate',
      reason: step.reason,
    });
  }

  return {
    schemaVersion: 'sciforge.workspace-memory-reuse-decision.v1',
    decisionId: workspaceMemoryDecisionId(input.index.workspaceId, input.requestId, reusedEntries, staleEntries),
    requestId: input.requestId,
    reusedEntries,
    skippedDuplicateSteps,
    staleEntries,
    actions,
    auditNote: workspaceMemoryAuditNote({
      sourceCallbackId: input.sourceCallbackId ?? 'workspace-memory.reuse-index',
      reusedCount: reusedEntries.length,
      skippedCount: skippedDuplicateSteps.length,
      staleCount: staleEntries.length,
    }),
  };
}

function normalizeWorkspaceMemoryEntry(
  entry: WorkspaceMemoryEntryInput | WorkspaceMemoryEntry,
  generatedAt: string,
  index: number,
): WorkspaceMemoryEntry {
  if (isStructuredMemoryEntry(entry)) {
    return {
      ...entry,
      sourceRunId: entry.sourceRunId ?? entry.provenance.sourceRunId,
      confidence: clamp(entry.confidence, 0, 1),
      tags: stableUnique(entry.tags ?? []),
      evidenceRefs: stableUnique(entry.evidenceRefs ?? []),
      invalidationKeys: stableUnique(entry.invalidationKeys ?? [entry.ref]),
    };
  }

  const sourceRefs = Array.isArray(entry.provenance) ? entry.provenance : [];
  const sourceRef = sourceRefs[0] ?? entry.ref;
  return {
    id: entry.id ?? `${entry.kind}:${stableHash(`${entry.ref}:${index}`).slice(0, 8)}`,
    kind: entry.kind,
    ref: entry.ref,
    summary: entry.summary,
    sourceRunId: entry.sourceRunId,
    provenance: {
      source: 'runtime',
      sourceRef,
      sourceRunId: entry.sourceRunId,
      producedAt: generatedAt,
    },
    validity: entry.validity ?? 'valid',
    confidence: clamp(entry.confidence ?? 0.7, 0, 1),
    expiresAt: entry.expiresAt,
    invalidationKeys: stableUnique(entry.invalidationKeys ?? [entry.ref]),
  };
}

function isStructuredMemoryEntry(entry: WorkspaceMemoryEntryInput | WorkspaceMemoryEntry): entry is WorkspaceMemoryEntry {
  return typeof (entry as WorkspaceMemoryEntry).provenance === 'object' && !Array.isArray((entry as WorkspaceMemoryEntry).provenance);
}

function refsForKind(entries: WorkspaceMemoryEntry[], kind: WorkspaceMemoryEntry['kind']): string[] {
  return stableUnique(entries.filter((entry) => entry.kind === kind).map((entry) => entry.ref));
}

function duplicateStepsForReuse(
  plannedSteps: WorkspaceMemoryReuseStepInput[],
  reusedEntries: WorkspaceMemoryEntry[],
): WorkspaceMemoryReuseStep[] {
  const byRef = new Map(reusedEntries.map((entry) => [entry.ref, entry]));
  return plannedSteps.flatMap((step) => {
    const entry = byRef.get(step.ref);
    if (!entry) {
      return [];
    }
    return [{
      stepId: step.stepId,
      reason: `Skipped duplicate ${step.description ?? 'workspace exploration'} because ${entry.ref} is already indexed from ${entry.provenance.sourceRunId ?? entry.provenance.sourceRef}.`,
      reusedEntryId: entry.id,
      ref: entry.ref,
    }];
  });
}

function signalMatchesEntry(signal: WorkspaceMemoryStaleSignal, entry: WorkspaceMemoryEntry): boolean {
  if (signal.ref && (signal.ref === entry.ref || signal.ref === entry.id || entry.invalidationKeys?.includes(signal.ref))) {
    return true;
  }
  if (signal.fileRef && (signal.fileRef === entry.provenance.fileRef || signal.fileRef === entry.ref)) {
    return true;
  }
  if (signal.capabilityId && signal.capabilityId === entry.provenance.capabilityId) {
    return true;
  }
  return !signal.ref && !signal.fileRef && !signal.capabilityId;
}

function validityForAssessment(
  current: WorkspaceMemoryValidity,
  reasons: WorkspaceMemoryStaleReason[],
): WorkspaceMemoryValidity {
  if (reasons.length === 0) {
    return current === 'unknown' ? 'valid' : current;
  }
  if (reasons.includes('expired')) {
    return 'expired';
  }
  if (reasons.includes('invalidated') || reasons.includes('source-run-failed') || reasons.includes('missing-provenance')) {
    return 'invalid';
  }
  return 'stale';
}

function workspaceMemoryAuditNote(input: {
  sourceCallbackId: string;
  reusedCount: number;
  skippedCount: number;
  staleCount: number;
}): HarnessAuditNote {
  return {
    sourceCallbackId: input.sourceCallbackId,
    severity: input.staleCount > 0 ? 'warning' : 'info',
    message: `Workspace memory reuse: reused ${input.reusedCount} refs, skipped ${input.skippedCount} duplicate steps, flagged ${input.staleCount} stale entries.`,
  };
}

function workspaceMemoryDecisionId(
  workspaceId: string,
  requestId: string | undefined,
  reusedEntries: WorkspaceMemoryEntry[],
  staleEntries: WorkspaceMemoryStaleAssessment[],
): string {
  const seed = [
    workspaceId,
    requestId ?? 'anonymous-request',
    ...reusedEntries.map((entry) => entry.id),
    ...staleEntries.map((entry) => `${entry.entryId}:${entry.staleReasons.join('+')}`),
  ].join('|');
  return `workspace-memory:${stableHash(seed)}`;
}

function stableUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function stableHash(value: unknown): string {
  let hash = 2166136261;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function timeMs(value: string | Date): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
