import { createHash } from 'node:crypto';

export type ProjectSessionActor =
  | 'user'
  | 'ui'
  | 'runtime'
  | 'agentserver'
  | 'backend'
  | 'worker'
  | 'verifier'
  | 'system';

export type ProjectSessionEventKind =
  | 'user-turn'
  | 'assistant-visible-message'
  | 'backend-dispatch'
  | 'backend-event'
  | 'execution-unit'
  | 'artifact-materialized'
  | 'verification-recorded'
  | 'failure-classified'
  | 'decision-recorded'
  | 'context-projection-recorded'
  | 'compaction-recorded'
  | 'history-edit-recorded'
  | 'human-approval-recorded';

export const PROJECT_MEMORY_REF_KINDS = [
  'artifact',
  'task-input',
  'task-output',
  'stdout',
  'stderr',
  'log',
  'source',
  'verification',
  'bundle',
  'ledger-event',
  'projection',
  'execution-unit',
  'handoff',
  'context',
  'retrieval',
  'run-audit',
] as const;

export type ProjectMemoryRefKind = typeof PROJECT_MEMORY_REF_KINDS[number];

export type RefKindGroup =
  | 'artifact'
  | 'execution'
  | 'context'
  | 'handoff'
  | 'retrieval'
  | 'audit';

export type ProjectMemoryRefRetention = 'hot' | 'warm' | 'cold' | 'audit-only';

export interface ProjectMemoryRef {
  ref: string;
  kind: ProjectMemoryRefKind;
  digest: string;
  sizeBytes: number;
  mime?: string;
  producerRunId?: string;
  preview?: string;
  readable?: boolean;
  retention?: ProjectMemoryRefRetention;
}

export interface ProjectSessionEvent {
  schemaVersion: 'sciforge.project-session-event.v1';
  eventId: string;
  sessionId: string;
  turnId?: string;
  runId?: string;
  parentEventIds?: string[];
  createdAt: string;
  actor: ProjectSessionActor;
  kind: ProjectSessionEventKind;
  summary: string;
  refs: ProjectMemoryRef[];
  metadata?: Record<string, unknown>;
}

export interface ContextProjectionBlock {
  blockId: string;
  kind:
    | 'immutable-prefix'
    | 'workspace-identity'
    | 'stable-session-state'
    | 'index'
    | 'task-packet'
    | 'retrieved-evidence';
  sha256: string;
  tokenEstimate: number;
  cacheTier: 'stable-prefix' | 'mostly-stable' | 'tail';
  sourceEventIds: string[];
  supersedes?: string[];
  createdAt: string;
  content: string;
}

export interface ProjectSessionLedgerProjection {
  schemaVersion: 'sciforge.project-session-ledger-projection.v1';
  sessionId: string;
  events: ProjectSessionEvent[];
  refIndex: ProjectMemoryRef[];
}

export interface CompileContextProjectionInput {
  sessionId: string;
  createdAt?: string;
  immutablePrefix: unknown;
  workspaceIdentity: unknown;
  stableSessionState: unknown;
  index: unknown;
  currentTaskPacket?: unknown;
  retrievedEvidence?: unknown;
  sourceEventIds?: {
    immutablePrefix?: string[];
    workspaceIdentity?: string[];
    stableSessionState?: string[];
    index?: string[];
    currentTaskPacket?: string[];
    retrievedEvidence?: string[];
  };
  supersedes?: {
    stableSessionState?: string[];
    index?: string[];
  };
}

export interface ContextProjectionCompileResult {
  schemaVersion: 'sciforge.context-projection.v1';
  sessionId: string;
  blocks: ContextProjectionBlock[];
  stablePrefixHash: string;
  stablePrefixBlockIds: string[];
  tailBlockIds: string[];
  changedStableBlockTokens: number;
  uncachedTailTokens: number;
}

export interface CompactionRecordedEventInput {
  sessionId: string;
  eventId?: string;
  createdAt?: string;
  sourceEventIds: string[];
  outputProjectionRefs: ProjectMemoryRef[];
  actor?: ProjectSessionActor;
  decisionOwner: string;
  trigger: string;
  reason: string;
  supersedes?: string[];
  metadata?: Record<string, unknown>;
}

export interface ProjectSessionRecoveryProjection {
  schemaVersion: 'sciforge.project-session-recovery-projection.v1';
  sessionId: string;
  activeRunId?: string;
  artifactIndex: ProjectMemoryRef[];
  failureIndex: Array<{
    eventId: string;
    runId?: string;
    summary: string;
    refs: ProjectMemoryRef[];
  }>;
  nextHandoffPacket: {
    schemaVersion: 'sciforge.project-session-handoff-packet.v1';
    mode: 'continue' | 'repair-continuation';
    refs: ProjectMemoryRef[];
    retrievalTools: ['retrieve', 'read_ref', 'workspace_search'];
    blocker?: string;
  };
}

type ConversationEventLike = {
  id?: unknown;
  type?: unknown;
  timestamp?: unknown;
  actor?: unknown;
  turnId?: unknown;
  runId?: unknown;
  causationId?: unknown;
  storage?: unknown;
  payload?: unknown;
};

type SessionLike = Record<string, unknown>;

const PROJECT_MEMORY_REF_KIND_SET = new Set<ProjectMemoryRefKind>(PROJECT_MEMORY_REF_KINDS);

const REF_KIND_GROUPS: Record<ProjectMemoryRefKind, RefKindGroup> = {
  artifact: 'artifact',
  'task-input': 'execution',
  'task-output': 'execution',
  stdout: 'execution',
  stderr: 'execution',
  log: 'execution',
  source: 'artifact',
  verification: 'audit',
  bundle: 'context',
  'ledger-event': 'audit',
  projection: 'context',
  'execution-unit': 'execution',
  handoff: 'handoff',
  context: 'context',
  retrieval: 'retrieval',
  'run-audit': 'audit',
};

const RETENTION_BY_REF_KIND_GROUP: Record<RefKindGroup, ProjectMemoryRefRetention> = {
  artifact: 'warm',
  execution: 'hot',
  context: 'warm',
  handoff: 'hot',
  retrieval: 'cold',
  audit: 'audit-only',
};

const REF_KIND_ALIASES: Record<string, ProjectMemoryRefKind> = {
  audit: 'run-audit',
  'backend-handoff': 'handoff',
  'compaction-audit': 'run-audit',
  'context-ref': 'context',
  'context-snapshot': 'context',
  'handoff-packet': 'handoff',
  'retrieval-audit': 'run-audit',
  'retrieval-evidence': 'retrieval',
  'run-audit-ref': 'run-audit',
};

export function projectMemoryRefKindGroup(kind: ProjectMemoryRefKind): RefKindGroup {
  return REF_KIND_GROUPS[kind];
}

export function projectMemoryRefRetention(kind: ProjectMemoryRefKind): ProjectMemoryRefRetention {
  return RETENTION_BY_REF_KIND_GROUP[projectMemoryRefKindGroup(kind)];
}

export function normalizeProjectSessionMemory(
  input: unknown,
  options: { sessionId?: string; createdAt?: string } = {},
): ProjectSessionLedgerProjection {
  const sessionId = inferSessionId(input, options.sessionId);
  const events: ProjectSessionEvent[] = [];

  const conversationEvents = extractConversationEvents(input);
  for (const event of conversationEvents) {
    events.push(normalizeConversationEvent(event, sessionId, options.createdAt));
  }

  for (const message of extractArray(input, 'messages')) {
    const normalized = normalizeMessageLike(message, sessionId, options.createdAt);
    if (normalized) events.push(normalized);
  }
  for (const run of extractArray(input, 'runs')) {
    const normalized = normalizeRunLike(run, sessionId, options.createdAt);
    if (normalized) events.push(normalized);
  }
  for (const taskResult of extractArray(input, 'taskResults')) {
    const normalized = normalizeRecordLike(taskResult, sessionId, 'backend-event', 'task-result', options.createdAt);
    if (normalized) events.push(normalized);
  }
  for (const log of extractArray(input, 'logs')) {
    const normalized = normalizeRecordLike(log, sessionId, 'backend-event', 'log', options.createdAt);
    if (normalized) events.push(normalized);
  }
  for (const artifact of extractArray(input, 'artifacts')) {
    const normalized = normalizeRecordLike(artifact, sessionId, 'artifact-materialized', 'artifact', options.createdAt);
    if (normalized) events.push(normalized);
  }
  for (const verification of extractArray(input, 'verifications')) {
    const normalized = normalizeRecordLike(
      verification,
      sessionId,
      'verification-recorded',
      'verification',
      options.createdAt,
    );
    if (normalized) events.push(normalized);
  }

  return {
    schemaVersion: 'sciforge.project-session-ledger-projection.v1',
    sessionId,
    events,
    refIndex: buildProjectMemoryRefIndex(events),
  };
}

export function buildProjectMemoryRefIndex(events: readonly ProjectSessionEvent[]): ProjectMemoryRef[] {
  const byRef = new Map<string, ProjectMemoryRef>();
  for (const event of events) {
    for (const ref of event.refs) {
      const existing = byRef.get(ref.ref);
      if (!existing || refDigestRank(ref) > refDigestRank(existing)) byRef.set(ref.ref, ref);
    }
  }
  return [...byRef.values()].sort((a, b) => a.ref.localeCompare(b.ref));
}

export function compileContextProjection(input: CompileContextProjectionInput): ContextProjectionCompileResult {
  const createdAt = input.createdAt ?? '1970-01-01T00:00:00.000Z';
  const blocks: ContextProjectionBlock[] = [
    renderBlock({
      blockId: `psm:${input.sessionId}:immutable-prefix`,
      kind: 'immutable-prefix',
      cacheTier: 'stable-prefix',
      content: input.immutablePrefix,
      sourceEventIds: input.sourceEventIds?.immutablePrefix ?? [],
      createdAt,
    }),
    renderBlock({
      blockId: `psm:${input.sessionId}:workspace-identity`,
      kind: 'workspace-identity',
      cacheTier: 'stable-prefix',
      content: input.workspaceIdentity,
      sourceEventIds: input.sourceEventIds?.workspaceIdentity ?? [],
      createdAt,
    }),
    renderBlock({
      blockId: `psm:${input.sessionId}:stable-session-state`,
      kind: 'stable-session-state',
      cacheTier: 'stable-prefix',
      content: input.stableSessionState,
      sourceEventIds: input.sourceEventIds?.stableSessionState ?? [],
      supersedes: input.supersedes?.stableSessionState,
      createdAt,
    }),
    renderBlock({
      blockId: `psm:${input.sessionId}:index`,
      kind: 'index',
      cacheTier: 'mostly-stable',
      content: input.index,
      sourceEventIds: input.sourceEventIds?.index ?? [],
      supersedes: input.supersedes?.index,
      createdAt,
    }),
  ];

  if (input.currentTaskPacket !== undefined) {
    blocks.push(renderBlock({
      blockId: `psm:${input.sessionId}:task-packet`,
      kind: 'task-packet',
      cacheTier: 'tail',
      content: input.currentTaskPacket,
      sourceEventIds: input.sourceEventIds?.currentTaskPacket ?? [],
      createdAt,
    }));
  }
  if (input.retrievedEvidence !== undefined) {
    blocks.push(renderBlock({
      blockId: `psm:${input.sessionId}:retrieved-evidence`,
      kind: 'retrieved-evidence',
      cacheTier: 'tail',
      content: input.retrievedEvidence,
      sourceEventIds: input.sourceEventIds?.retrievedEvidence ?? [],
      createdAt,
    }));
  }

  const stableBlocks = blocks.filter((block) => block.cacheTier !== 'tail');
  const tailBlocks = blocks.filter((block) => block.cacheTier === 'tail');
  return {
    schemaVersion: 'sciforge.context-projection.v1',
    sessionId: input.sessionId,
    blocks,
    stablePrefixHash: digestStableBytes(stableBlocks.map((block) => [block.blockId, block.sha256])),
    stablePrefixBlockIds: stableBlocks.map((block) => block.blockId),
    tailBlockIds: tailBlocks.map((block) => block.blockId),
    changedStableBlockTokens: stableBlocks.reduce((sum, block) => sum + block.tokenEstimate, 0),
    uncachedTailTokens: tailBlocks.reduce((sum, block) => sum + block.tokenEstimate, 0),
  };
}

export function buildRepairPacket(input: {
  failedRunId: string;
  failureSummary: string;
  refs: ProjectMemoryRef[];
  nextStep: string;
  constraints?: string[];
}): {
  schemaVersion: 'sciforge.recovery-packet.v1';
  mode: 'repair-continuation';
  failedRunId: string;
  failureSummary: string;
  refs: ProjectMemoryRef[];
  nextStep: string;
  constraints: string[];
} {
  return {
    schemaVersion: 'sciforge.recovery-packet.v1',
    mode: 'repair-continuation',
    failedRunId: input.failedRunId,
    failureSummary: input.failureSummary,
    refs: input.refs,
    nextStep: input.nextStep,
    constraints: input.constraints ?? [
      'Use the supplied refs and digests before broad history.',
      'Perform one bounded repair step or return failed-with-reason.',
    ],
  };
}

export function buildCompactionRecordedEvent(input: CompactionRecordedEventInput): ProjectSessionEvent {
  const createdAt = input.createdAt ?? '1970-01-01T00:00:00.000Z';
  const eventId = input.eventId
    ?? `compaction:${digestStableBytes({
      sessionId: input.sessionId,
      sourceEventIds: input.sourceEventIds,
      outputProjectionRefs: input.outputProjectionRefs.map((ref) => ref.digest),
      trigger: input.trigger,
      reason: input.reason,
    }).slice('sha256:'.length, 'sha256:'.length + 16)}`;
  return {
    schemaVersion: 'sciforge.project-session-event.v1',
    eventId,
    sessionId: input.sessionId,
    createdAt,
    actor: input.actor ?? 'runtime',
    kind: 'compaction-recorded',
    summary: `Compaction recorded: ${input.reason}`,
    refs: input.outputProjectionRefs,
    metadata: {
      decisionOwner: input.decisionOwner,
      trigger: input.trigger,
      reason: input.reason,
      sourceEventIds: input.sourceEventIds,
      supersedes: input.supersedes ?? [],
      ...(input.metadata ?? {}),
    },
  };
}

export function recoverProjectSessionProjection(events: readonly ProjectSessionEvent[]): ProjectSessionRecoveryProjection {
  const sessionId = events.at(-1)?.sessionId ?? events[0]?.sessionId ?? 'session-unknown';
  const activeRunId = [...events].reverse().map((event) => event.runId).find(Boolean);
  const refIndex = buildProjectMemoryRefIndex(events);
  const artifactIndex = refIndex.filter((ref) => ref.kind === 'artifact');
  const failureEvents = events.filter((event) => event.kind === 'failure-classified');
  const latestFailure = failureEvents.at(-1);
  const failureIndex = failureEvents.slice(-12).map((event) => ({
    eventId: event.eventId,
    runId: event.runId,
    summary: event.summary,
    refs: event.refs,
  }));
  const refs = latestFailure?.refs.length
    ? latestFailure.refs
    : refIndex.slice(-16);
  return {
    schemaVersion: 'sciforge.project-session-recovery-projection.v1',
    sessionId,
    activeRunId,
    artifactIndex,
    failureIndex,
    nextHandoffPacket: {
      schemaVersion: 'sciforge.project-session-handoff-packet.v1',
      mode: latestFailure ? 'repair-continuation' : 'continue',
      refs,
      retrievalTools: ['retrieve', 'read_ref', 'workspace_search'],
      blocker: latestFailure?.summary,
    },
  };
}

function normalizeConversationEvent(
  event: ConversationEventLike,
  sessionId: string,
  fallbackCreatedAt?: string,
): ProjectSessionEvent {
  const id = stringValue(event.id) ?? digestStableBytes(event).slice('sha256:'.length, 'sha256:'.length + 16);
  const payload = asRecord(event.payload);
  const refs = normalizeRefs(extractRefs(payload), stringValue(event.runId));
  return {
    schemaVersion: 'sciforge.project-session-event.v1',
    eventId: `conversation:${id}`,
    sessionId,
    turnId: stringValue(event.turnId),
    runId: stringValue(event.runId),
    parentEventIds: stringValue(event.causationId) ? [`conversation:${stringValue(event.causationId)}`] : undefined,
    createdAt: stringValue(event.timestamp) ?? fallbackCreatedAt ?? '1970-01-01T00:00:00.000Z',
    actor: normalizeActor(event.actor),
    kind: mapConversationKind(stringValue(event.type)),
    summary: eventSummary(stringValue(event.type), payload, refs),
    refs,
    metadata: {
      source: 'conversation-event-log',
      sourceEventType: stringValue(event.type),
      sourceStorage: stringValue(event.storage),
    },
  };
}

function normalizeRunLike(value: unknown, sessionId: string, fallbackCreatedAt?: string): ProjectSessionEvent | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const runId = stringValue(record.runId) ?? stringValue(record.id);
  const refs = normalizeRefs(extractRefs(record), runId);
  return {
    schemaVersion: 'sciforge.project-session-event.v1',
    eventId: `run:${runId ?? digestStableBytes(record).slice('sha256:'.length, 'sha256:'.length + 16)}`,
    sessionId: stringValue(record.sessionId) ?? sessionId,
    runId,
    createdAt: stringValue(record.createdAt) ?? stringValue(record.timestamp) ?? fallbackCreatedAt ?? '1970-01-01T00:00:00.000Z',
    actor: 'runtime',
    kind: hasFailureSignal(record) ? 'failure-classified' : 'backend-event',
    summary: stringValue(record.summary)
      ?? stringValue(record.failureReason)
      ?? `Run ${runId ?? 'record'} ${stringValue(record.status) ?? 'recorded'}`,
    refs,
    metadata: compactRecord({
      source: 'run-like',
      status: record.status,
      failureCode: record.failureCode,
      failureReason: record.failureReason,
      nextStep: record.nextStep,
    }),
  };
}

function normalizeMessageLike(value: unknown, sessionId: string, fallbackCreatedAt?: string): ProjectSessionEvent | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = stringValue(record.id)
    ?? stringValue(record.messageId)
    ?? digestStableBytes(record).slice('sha256:'.length, 'sha256:'.length + 16);
  const role = stringValue(record.role) ?? stringValue(record.actor);
  const refs = normalizeRefs(extractRefs(record), stringValue(record.runId));
  return {
    schemaVersion: 'sciforge.project-session-event.v1',
    eventId: `message:${id}`,
    sessionId: stringValue(record.sessionId) ?? sessionId,
    turnId: stringValue(record.turnId),
    runId: stringValue(record.runId),
    createdAt: stringValue(record.createdAt) ?? stringValue(record.timestamp) ?? fallbackCreatedAt ?? '1970-01-01T00:00:00.000Z',
    actor: role === 'user' ? 'user' : role === 'assistant' ? 'backend' : normalizeActor(record.actor),
    kind: role === 'user' ? 'user-turn' : 'assistant-visible-message',
    summary: messageSummary(record, refs),
    refs,
    metadata: compactRecord({
      source: 'session-message',
      role,
      contentDigest: bodyDigest(record.content ?? record.text ?? record.prompt),
      contentChars: typeof record.content === 'string'
        ? record.content.length
        : typeof record.text === 'string'
          ? record.text.length
          : typeof record.prompt === 'string'
            ? record.prompt.length
            : undefined,
      contentOmitted: true,
    }),
  };
}

function normalizeRecordLike(
  value: unknown,
  sessionId: string,
  kind: ProjectSessionEventKind,
  source: string,
  fallbackCreatedAt?: string,
): ProjectSessionEvent | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = stringValue(record.id)
    ?? stringValue(record.ref)
    ?? stringValue(record.path)
    ?? digestStableBytes(record).slice('sha256:'.length, 'sha256:'.length + 16);
  const refs = normalizeRefs(extractRefsForSource(record, source), stringValue(record.runId) ?? stringValue(record.producerRunId));
  return {
    schemaVersion: 'sciforge.project-session-event.v1',
    eventId: `${source}:${id}`,
    sessionId: stringValue(record.sessionId) ?? sessionId,
    runId: stringValue(record.runId) ?? stringValue(record.producerRunId),
    createdAt: stringValue(record.createdAt) ?? stringValue(record.timestamp) ?? fallbackCreatedAt ?? '1970-01-01T00:00:00.000Z',
    actor: source === 'verification' ? 'verifier' : 'runtime',
    kind,
    summary: stringValue(record.summary) ?? `${source} recorded: ${id}`,
    refs,
    metadata: compactRecord({ source, status: record.status, label: record.label }),
  };
}

function extractConversationEvents(input: unknown): ConversationEventLike[] {
  const direct = asRecord(input);
  if (direct?.schemaVersion === 'sciforge.conversation-event-log.v1' && Array.isArray(direct.events)) {
    return direct.events.filter(isRecordLike) as ConversationEventLike[];
  }
  for (const key of ['conversationEventLog', 'eventLog', 'conversationLog']) {
    const nested = asRecord(direct?.[key]);
    if (nested?.schemaVersion === 'sciforge.conversation-event-log.v1' && Array.isArray(nested.events)) {
      return nested.events.filter(isRecordLike) as ConversationEventLike[];
    }
  }
  const events = direct?.events;
  if (Array.isArray(events)) return events.filter(isRecordLike) as ConversationEventLike[];
  return [];
}

function extractArray(input: unknown, key: string): unknown[] {
  const record = asRecord(input);
  const session = asRecord(record?.session);
  const value = record?.[key] ?? session?.[key];
  return Array.isArray(value) ? value : [];
}

function extractRefs(record: Record<string, unknown> | undefined): unknown[] {
  if (!record) return [];
  const payloadRefs = Array.isArray(record.refs) ? record.refs : [];
  const directRef = stringValue(record.ref) ?? stringValue(record.path) ?? stringValue(record.dataRef);
  const scalarRefs = [
    ['artifact', record.artifactRef],
    ['task-input', record.taskInputRef ?? record.inputRef],
    ['task-output', record.taskOutputRef ?? record.outputRef],
    ['stdout', record.stdoutRef],
    ['stderr', record.stderrRef],
    ['log', record.logRef],
    ['source', record.codeRef ?? record.sourceRef],
    ['verification', record.verificationRef],
    ['bundle', record.sessionBundleRef ?? record.bundleRef],
    ['handoff', record.handoffRef ?? record.handoffPacketRef],
    ['context', record.contextRef ?? record.contextSnapshotRef],
    ['retrieval', record.retrievalRef ?? record.retrievalEvidenceRef],
    ['run-audit', record.runAuditRef ?? record.auditRef ?? record.compactionAuditRef ?? record.retrievalAuditRef],
  ].flatMap(([kind, ref]) => (typeof ref === 'string' && ref.trim() ? [{ kind, ref }] : []));
  const directRefs = directRef
    ? [{ ...record, ref: directRef, kind: stringValue(record.kind) ?? inferRefKind(directRef) }]
    : [];
  return [...payloadRefs, ...scalarRefs, ...directRefs];
}

function extractRefsForSource(record: Record<string, unknown>, source: string): unknown[] {
  const refs = extractRefs(record);
  const directRef = stringValue(record.ref) ?? stringValue(record.path) ?? stringValue(record.dataRef);
  if (!directRef) return refs;
  const sourceKind = source === 'artifact'
    ? 'artifact'
    : source === 'verification'
      ? 'verification'
      : stringValue(record.kind) ?? inferRefKind(directRef);
  return [...refs, { ...record, ref: directRef, kind: sourceKind }];
}

function normalizeRefs(refs: unknown[], producerRunId?: string): ProjectMemoryRef[] {
  const normalized = refs.map((value) => normalizeRef(value, producerRunId)).filter(Boolean) as ProjectMemoryRef[];
  const byRef = new Map<string, ProjectMemoryRef>();
  for (const ref of normalized) byRef.set(ref.ref, ref);
  return [...byRef.values()].sort((a, b) => a.ref.localeCompare(b.ref));
}

function normalizeRef(value: unknown, producerRunId?: string): ProjectMemoryRef | undefined {
  if (typeof value === 'string') {
    return finalizeRef({ ref: value, kind: inferRefKind(value), producerRunId });
  }
  const record = asRecord(value);
  const ref = stringValue(record?.ref) ?? stringValue(record?.path) ?? stringValue(record?.href);
  if (!ref) return undefined;
  return finalizeRef({
    ref,
    kind: normalizeRefKind(stringValue(record?.kind), ref),
    digest: stringValue(record?.digest),
    sizeBytes: numberValue(record?.sizeBytes) ?? numberValue(record?.size) ?? numberValue(record?.bytes),
    mime: stringValue(record?.mime) ?? stringValue(record?.contentType),
    producerRunId: stringValue(record?.producerRunId) ?? producerRunId,
    preview: stringValue(record?.preview) ?? stringValue(record?.label),
    readable: booleanValue(record?.readable),
  });
}

function finalizeRef(ref: Omit<ProjectMemoryRef, 'digest' | 'sizeBytes'> & Partial<Pick<ProjectMemoryRef, 'digest' | 'sizeBytes'>>): ProjectMemoryRef {
  const sizeBytes = ref.sizeBytes ?? utf8ByteLength(ref.preview ?? ref.ref);
  const digest = ref.digest ?? digestStableBytes({
    ref: ref.ref,
    kind: ref.kind,
    sizeBytes,
    mime: ref.mime,
    producerRunId: ref.producerRunId,
    preview: ref.preview,
  });
  return {
    ref: ref.ref,
    kind: ref.kind,
    digest,
    sizeBytes,
    mime: ref.mime,
    producerRunId: ref.producerRunId,
    preview: ref.preview,
    readable: ref.readable,
    retention: projectMemoryRefRetention(ref.kind),
  };
}

function renderBlock(input: {
  blockId: string;
  kind: ContextProjectionBlock['kind'];
  cacheTier: ContextProjectionBlock['cacheTier'];
  content: unknown;
  sourceEventIds: string[];
  supersedes?: string[];
  createdAt: string;
}): ContextProjectionBlock {
  const content = stableStringify(input.content);
  return {
    blockId: input.blockId,
    kind: input.kind,
    sha256: digestStableBytes(content),
    tokenEstimate: Math.max(1, Math.ceil(utf8ByteLength(content) / 4)),
    cacheTier: input.cacheTier,
    sourceEventIds: [...input.sourceEventIds],
    supersedes: input.supersedes,
    createdAt: input.createdAt,
    content,
  };
}

function mapConversationKind(type: string | undefined): ProjectSessionEventKind {
  switch (type) {
    case 'TurnReceived':
      return 'user-turn';
    case 'Dispatched':
      return 'backend-dispatch';
    case 'OutputMaterialized':
      return 'artifact-materialized';
    case 'VerificationRecorded':
      return 'verification-recorded';
    case 'RepairNeeded':
    case 'ExternalBlocked':
    case 'NeedsHuman':
    case 'DegradedResult':
      return 'failure-classified';
    case 'HistoryEdited':
      return 'history-edit-recorded';
    case 'HarnessDecisionRecorded':
      return 'decision-recorded';
    case 'Satisfied':
    case 'PartialReady':
      return 'assistant-visible-message';
    default:
      return 'backend-event';
  }
}

function eventSummary(type: string | undefined, payload: Record<string, unknown> | undefined, refs: ProjectMemoryRef[]): string {
  return stringValue(payload?.summary)
    ?? stringValue(payload?.prompt)
    ?? stringValue(payload?.text)
    ?? stringValue(payload?.failureReason)
    ?? (refs.length > 0 ? `${type ?? 'event'} referenced ${refs.length} refs` : (type ?? 'event'));
}

function messageSummary(record: Record<string, unknown>, refs: ProjectMemoryRef[]): string {
  const explicit = stringValue(record.summary);
  if (explicit) return explicit;
  const content = stringValue(record.content) ?? stringValue(record.text) ?? stringValue(record.prompt);
  const digest = bodyDigest(content);
  const role = stringValue(record.role) ?? 'message';
  const refText = refs.length ? `; refs=${refs.slice(0, 4).map((ref) => ref.ref).join(', ')}` : '';
  return `${role} body omitted; hash=${digest ?? 'none'}${refText}`;
}

function inferSessionId(input: unknown, fallback?: string): string {
  const record = asRecord(input);
  return fallback
    ?? stringValue(record?.sessionId)
    ?? stringValue(record?.conversationId)
    ?? stringValue(asRecord(record?.session)?.sessionId)
    ?? stringValue(asRecord(record?.conversationEventLog)?.conversationId)
    ?? stringValue(asRecord(record?.eventLog)?.conversationId)
    ?? 'session-unknown';
}

function normalizeActor(actor: unknown): ProjectSessionActor {
  const value = stringValue(actor);
  if (value === 'kernel') return 'runtime';
  if (value && ['user', 'ui', 'runtime', 'agentserver', 'backend', 'worker', 'verifier', 'system'].includes(value)) {
    return value as ProjectSessionActor;
  }
  return 'runtime';
}

function normalizeRefKind(kind: string | undefined, ref: string): ProjectMemoryRefKind {
  if (kind && PROJECT_MEMORY_REF_KIND_SET.has(kind as ProjectMemoryRefKind)) return kind as ProjectMemoryRefKind;
  if (kind && REF_KIND_ALIASES[kind]) return REF_KIND_ALIASES[kind];
  return inferRefKind(ref);
}

function inferRefKind(ref: string): ProjectMemoryRefKind {
  if (/handoff|handoffs/i.test(ref)) return 'handoff';
  if (/run-audit|retrieval-audit|compaction-audit|audit|trace|decision/i.test(ref)) return 'run-audit';
  if (/retriev|evidence/i.test(ref)) return 'retrieval';
  if (/context-snapshot|context-ref|^context:|\/context\//i.test(ref)) return 'context';
  if (/stderr/i.test(ref)) return 'stderr';
  if (/stdout/i.test(ref)) return 'stdout';
  if (/verification/i.test(ref)) return 'verification';
  if (/task-input|input/i.test(ref)) return 'task-input';
  if (/task-output|task-results|output/i.test(ref)) return 'task-output';
  if (/artifact|artifacts/i.test(ref)) return 'artifact';
  if (/\.log$/i.test(ref)) return 'log';
  if (/bundle|sessions\//i.test(ref)) return 'bundle';
  if (/\.(ts|tsx|js|jsx|py|sh|md)$/i.test(ref)) return 'source';
  return 'artifact';
}

function hasFailureSignal(record: Record<string, unknown>): boolean {
  return Boolean(record.failureReason || record.failureCode || String(record.status ?? '').includes('fail'));
}

function refDigestRank(ref: ProjectMemoryRef): number {
  return (ref.digest ? 2 : 0) + (ref.sizeBytes > 0 ? 1 : 0);
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(asRecord(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function digestStableBytes(value: unknown): string {
  return `sha256:${createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value)).digest('hex')}`;
}

function bodyDigest(value: unknown): string | undefined {
  return typeof value === 'string' && value
    ? digestStableBytes(value)
    : undefined;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
