import { createHash } from 'node:crypto';
import {
  compileWorkspaceContextProjection,
  normalizeWorkspaceKernelAuditInput,
  type ContextProjectionBlock,
  type WorkspaceLedgerEvent,
  type WorkspaceMemoryRef,
} from '../project-session-memory.js';
import {
  buildAgentServerContextRequest,
  type AgentServerContextRequest,
} from './agentserver-context-contract.js';

export const CONVERSATION_CONTEXT_PROJECTION_SCHEMA_VERSION = 'sciforge.conversation.context-projection.v1' as const;

type JsonMap = Record<string, unknown>;

const INLINE_IMAGE_PAYLOAD = /data:image|;base64,/gi;

export interface ConversationContextProjection {
  schemaVersion: typeof CONVERSATION_CONTEXT_PROJECTION_SCHEMA_VERSION;
  authority: 'workspace-kernel-context-projection';
  mode: string;
  workspaceKernel: JsonMap;
  contextProjectionBlocks: ContextProjectionBlock[];
  stablePrefixHash: string;
  contextRefs: WorkspaceMemoryRef[];
  capabilityBriefRef: WorkspaceMemoryRef;
  cachePlan: AgentServerContextRequest['cachePlan'];
  agentServerContextRequest: AgentServerContextRequest;
  selectedContextRefs: string[];
  retrievalTools: string[];
  selectedMessageRefs: JsonMap[];
  selectedRunRefs: JsonMap[];
  currentReferenceFocus: string[];
  pollutionGuard: JsonMap;
}

export function buildConversationContextProjection(request: unknown): ConversationContextProjection {
  const data = recordValue(request) ?? {};
  const session = firstRecord(data.session);
  const policy = firstRecord(data.contextPolicy, data.context_policy);
  const snapshot = firstRecord(data.goalSnapshot, data.goal_snapshot);
  const explicitRefs = stringListValue(
    firstValue(data, 'references', 'refs') ?? snapshot.requiredReferences ?? [],
  );
  const messages = arrayValue(session.messages);
  const runs = arrayValue(session.runs);
  const mode = textValue(policy.mode) || 'isolate';
  const sessionId = textValue(session.sessionId)
    || textValue(data.sessionId)
    || textValue(data.requestId)
    || 'session-unknown';
  const workspaceLedger = normalizeWorkspaceKernelAuditInput({
    session,
    sessionId,
    artifacts: arrayValue(session.artifacts),
    verifications: arrayValue(session.verifications),
  }, { sessionId });

  const selectedMessages = selectMessages(messages, mode, explicitRefs);
  const selectedRuns = selectRuns(runs, mode, explicitRefs);
  const excluded = excludedHistory(messages, runs, selectedMessages, selectedRuns, mode, explicitRefs);
  const selectedContextRefs = dedupe([
    ...explicitRefs,
    ...selectedMessages.flatMap((entry) => stringListValue(entry.refs)),
    ...selectedRuns.flatMap((entry) => stringListValue(entry.refs)),
  ]);
  const contextProjection = compileWorkspaceContextProjection({
    sessionId,
    immutablePrefix: {
      schemaVersion: 'sciforge.workspace-kernel.immutable-prefix.v1',
      runtimeContract: 'ToolPayload refs-first handoff',
      rules: [
        'workspace ledger is canonical truth',
        'AgentServer orchestrates context',
        'backend reads refs on demand',
      ],
    },
    workspaceIdentity: {
      sessionId,
      workspace: recordValue(data.workspace),
      sessionResourceRoot: textValue(session.sessionResourceRoot) || textValue(session.sessionBundleRef),
    },
    stableSessionState: {
      sessionId,
      persistentState: recordValue(session.persistentState),
      openQuestions: arrayValue(session.openQuestions).slice(-12),
      decisions: arrayValue(session.decisions).slice(-24),
    },
    index: {
      schemaVersion: 'sciforge.workspace-kernel.index.v1',
      eventCount: workspaceLedger.events.length,
      refCount: workspaceLedger.refIndex.length,
      eventIndex: eventIndex(workspaceLedger.events),
      refIndex: refIndex(workspaceLedger.refIndex),
      failureIndex: failureIndex(workspaceLedger.events),
    },
    currentTaskPacket: {
      mode,
      currentReferenceFocus: explicitRefs,
      selectedContextRefs,
      currentGoal: clip(sanitizeText(
        textValue(snapshot.normalizedPrompt)
        || textValue(snapshot.summary)
        || textValue(firstValue(data, 'prompt'))
        || textValue(recordValue(data.turn)?.prompt)
        || textValue(recordValue(data.turn)?.text),
      ), 900),
      selectedEventIds: selectedEventIds(workspaceLedger.events, selectedMessages, selectedRuns),
      pollutionGuard: {
        explicitReferencesFirst: explicitRefs.length > 0,
        excludedHistory: excluded,
      },
    },
    sourceEventIds: {
      stableSessionState: workspaceLedger.events
        .filter((event) => event.kind === 'decision-recorded' || event.kind === 'human-approval-recorded')
        .map((event) => event.eventId),
      index: workspaceLedger.events.map((event) => event.eventId),
      currentTaskPacket: selectedEventIds(workspaceLedger.events, selectedMessages, selectedRuns),
    },
  });
  const capabilityBriefRef = memoryRef(
    `projection:${sessionId}:capability-brief`,
    'projection',
    'AgentServer capability brief projection',
  );
  const currentTurnRef = memoryRef(
    `ledger-event:${textValue(recordValue(data.turn)?.turnId) || textValue(data.turnId) || textValue(data.requestId) || 'current-turn'}`,
    'ledger-event',
    'Current turn anchor',
  );
  const stablePrefixRefs = contextProjection.blocks
    .filter((block) => block.cacheTier === 'stable-prefix')
    .map((block) => projectionBlockRef(block));
  const perTurnPayloadRefs = [
    currentTurnRef,
    ...contextProjection.blocks
      .filter((block) => block.cacheTier !== 'stable-prefix')
      .map((block) => projectionBlockRef(block)),
  ];
  const contextRequest = buildAgentServerContextRequest({
    sessionId,
    turnId: currentTurnRef.ref.replace(/^ledger-event:/, ''),
    mode: mode === 'continue' || mode === 'repair' || mode === 'answer-from-registry' ? mode : 'fresh',
    currentTurnRef,
    capabilityBriefRef,
    explicitRefs: explicitRefs.map((ref) => ({ ref, kind: 'artifact' })),
    projectionPrimaryRefs: contextProjection.blocks.map((block) => ({
      ref: `projection-block:${block.blockId}`,
      kind: 'projection',
      digest: block.sha256,
      sizeBytes: Buffer.byteLength(block.content, 'utf8'),
    })),
    boundedContextIndexRefs: workspaceLedger.refIndex.slice(0, 12).map((ref) => ({
      ref: ref.ref,
      kind: ref.kind,
      digest: ref.digest,
      sizeBytes: ref.sizeBytes,
      preview: ref.preview,
    })),
    cachePlan: {
      stablePrefixRefs,
      perTurnPayloadRefs,
    },
    retrievalTools: ['retrieve', 'read_ref', 'workspace_search'],
  });

  return {
    schemaVersion: CONVERSATION_CONTEXT_PROJECTION_SCHEMA_VERSION,
    authority: 'workspace-kernel-context-projection',
    mode,
    workspaceKernel: {
      schemaVersion: workspaceLedger.schemaVersion,
      sessionId: workspaceLedger.sessionId,
      eventCount: workspaceLedger.events.length,
      refCount: workspaceLedger.refIndex.length,
      eventIndex: eventIndex(workspaceLedger.events),
      refIndex: refIndex(workspaceLedger.refIndex),
      failureIndex: failureIndex(workspaceLedger.events),
    },
    contextProjectionBlocks: contextProjection.blocks,
    stablePrefixHash: contextProjection.stablePrefixHash,
    contextRefs: contextRequest.contextRefs,
    capabilityBriefRef,
    cachePlan: contextRequest.cachePlan,
    agentServerContextRequest: contextRequest,
    selectedContextRefs,
    retrievalTools: ['retrieve', 'read_ref', 'workspace_search'],
    selectedMessageRefs: selectedMessages,
    selectedRunRefs: selectedRuns,
    currentReferenceFocus: explicitRefs,
    pollutionGuard: {
      source: 'workspace-kernel-context-projection',
      fileRefOnly: true,
      explicitReferencesFirst: explicitRefs.length > 0,
      excludedHistory: excluded,
    },
  };
}

function selectMessages(messages: unknown[], mode: string, explicitRefs: string[]): JsonMap[] {
  const selected: JsonMap[] = [];
  for (const message of messages) {
    const item = recordValue(message) ?? {};
    if (mode === 'isolate' && !itemMentionsRefs(item, explicitRefs)) continue;
    if (explicitRefs.length > 0 && !itemMentionsRefs(item, explicitRefs)) continue;
    if (['continue', 'repair'].includes(mode) || itemMentionsRefs(item, explicitRefs)) {
      selected.push(compactMessage(item));
    }
  }
  return selected.slice(-8);
}

function selectRuns(runs: unknown[], mode: string, explicitRefs: string[]): JsonMap[] {
  const selected: JsonMap[] = [];
  for (const run of runs) {
    const item = recordValue(run) ?? {};
    if (explicitRefs.length > 0 && !itemMentionsRefs(item, explicitRefs)) continue;
    if (mode === 'repair') {
      const status = textValue(item.status).toLowerCase();
      if (['failed', 'failed-with-reason', 'error'].includes(status) || itemMentionsRefs(item, explicitRefs)) {
        selected.push(compactRun(item));
      }
      continue;
    }
    if (mode === 'continue') {
      selected.push(compactRun(item));
    } else if (itemMentionsRefs(item, explicitRefs)) {
      selected.push(compactRun(item));
    }
  }
  return selected.slice(-5);
}

function excludedHistory(
  messages: unknown[],
  runs: unknown[],
  selectedMessages: JsonMap[],
  selectedRuns: JsonMap[],
  mode: string,
  explicitRefs: string[],
): Array<{ id: string; reason: string }> {
  const selectedIds = new Set([...selectedMessages, ...selectedRuns].map((item) => String(item.id)));
  const excluded: Array<{ id: string; reason: string }> = [];
  const reason = explicitRefs.length > 0 ? 'not-current-reference-grounded' : 'isolated-new-task';
  if (['continue', 'repair'].includes(mode) && explicitRefs.length === 0) return [];
  for (const item of [...messages, ...runs]) {
    const mapped = recordValue(item) ?? {};
    const itemId = textValue(mapped.id) || textValue(mapped.runId);
    if (itemId && !selectedIds.has(itemId)) excluded.push({ id: itemId, reason });
  }
  return excluded.slice(-20);
}

function compactMessage(item: JsonMap): JsonMap {
  return {
    id: textValue(item.id),
    role: textValue(item.role) || 'unknown',
    contentOmitted: true,
    contentDigest: digestRecord(item, 'session-message-body'),
    refs: refsFromItem(item),
  };
}

function compactRun(item: JsonMap): JsonMap {
  return {
    id: textValue(item.id) || textValue(item.runId),
    status: textValue(item.status) || 'unknown',
    summary: clip(sanitizeText(textValue(item.summary) || textValue(item.message) || textValue(item.error)), 900),
    refs: refsFromItem(item),
  };
}

function eventIndex(events: WorkspaceLedgerEvent[]): JsonMap[] {
  return events.slice(-40).map((event) => ({
    eventId: event.eventId,
    kind: event.kind,
    actor: event.actor,
    turnId: event.turnId,
    runId: event.runId,
    summary: clip(sanitizeText(event.summary), 260),
    refs: event.refs.slice(0, 8).map((ref) => ref.ref),
  }));
}

function refIndex(refs: WorkspaceMemoryRef[]): JsonMap[] {
  return refs.slice(-80).map((ref) => ({
    ref: ref.ref,
    kind: ref.kind,
    digest: ref.digest,
    sizeBytes: ref.sizeBytes,
    mime: ref.mime,
    producerRunId: ref.producerRunId,
    preview: clip(sanitizeText(ref.preview ?? ''), 160) || undefined,
    readable: ref.readable,
    retention: ref.retention,
  }));
}

function projectionBlockRef(block: ContextProjectionBlock): WorkspaceMemoryRef {
  return {
    ref: `projection-block:${block.blockId}`,
    kind: 'projection',
    digest: block.sha256,
    sizeBytes: Buffer.byteLength(block.content, 'utf8'),
    preview: `${block.kind} context projection block`,
    retention: block.cacheTier === 'tail' ? 'hot' : 'warm',
  };
}

function memoryRef(ref: string, kind: WorkspaceMemoryRef['kind'], preview: string): WorkspaceMemoryRef {
  return {
    ref,
    kind,
    digest: `sha256:${createHash('sha256').update(`${kind}\n${ref}\n${preview}`).digest('hex')}`,
    sizeBytes: Buffer.byteLength(preview, 'utf8'),
    preview,
    retention: kind === 'ledger-event' ? 'audit-only' : 'warm',
  };
}

function failureIndex(events: WorkspaceLedgerEvent[]): JsonMap[] {
  return events
    .filter((event) => event.kind === 'failure-classified')
    .slice(-12)
    .map((event) => ({
      eventId: event.eventId,
      runId: event.runId,
      summary: clip(sanitizeText(event.summary), 260),
      refs: event.refs.slice(0, 8).map((ref) => ref.ref),
    }));
}

function selectedEventIds(events: WorkspaceLedgerEvent[], selectedMessages: JsonMap[], selectedRuns: JsonMap[]): string[] {
  const selectedIds = new Set([
    ...selectedMessages.map((message) => textValue(message.id)).filter(Boolean),
    ...selectedRuns.map((run) => textValue(run.id) || textValue(run.runId)).filter(Boolean),
  ]);
  return events
    .filter((event) => {
      const localId = event.eventId.replace(/^(message|run|conversation):/, '');
      return selectedIds.has(localId) || (event.runId ? selectedIds.has(event.runId) : false);
    })
    .map((event) => event.eventId);
}

function itemMentionsRefs(item: JsonMap, refs: string[]): boolean {
  if (!refs.length) return false;
  const haystack = refsFromItem(item).join('\n').toLowerCase();
  return refs.some((ref) => haystack.includes(ref.toLowerCase()));
}

function refsFromItem(item: JsonMap): string[] {
  const refs: string[] = [];
  for (const key of ['refs', 'references', 'artifactRefs', 'traceRefs', 'resultRefs']) {
    refs.push(...stringListValue(item[key]));
  }
  refs.push(...stringListValue(item.objectReferences));
  for (const key of ['contentDigest', 'messageDigest', 'payloadDigest', 'responseDigest', 'promptDigest']) {
    const digest = recordValue(item[key]);
    if (digest) refs.push(...stringListValue(digest.refs));
  }
  return dedupe(refs);
}

function digestRecord(item: JsonMap, fallbackOmitted: string): JsonMap {
  const existing = firstRecord(
    item.contentDigest,
    item.messageDigest,
    item.payloadDigest,
    item.responseDigest,
    item.promptDigest,
  );
  if (Object.keys(existing).length) return {
    omitted: textValue(existing.omitted) || fallbackOmitted,
    chars: typeof existing.chars === 'number' ? existing.chars : undefined,
    hash: textValue(existing.hash),
    refs: stringListValue(existing.refs),
  };
  const body = textValue(item.content) || textValue(item.text) || textValue(item.prompt);
  return body
    ? { omitted: fallbackOmitted, chars: body.length, hash: stableTextHash(body), refs: refsFromItem({ ...item, content: undefined, text: undefined, prompt: undefined }) }
    : { omitted: fallbackOmitted, chars: 0, refs: refsFromItem({ ...item, content: undefined, text: undefined, prompt: undefined }) };
}

function sanitizeText(text: string): string {
  return text.replace(INLINE_IMAGE_PAYLOAD, '[inline-image-payload-removed]');
}

function clip(text: string, limit: number): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 24)).trimEnd()} [truncated]`;
}

function stableTextHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function firstValue(record: JsonMap, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function firstRecord(...values: unknown[]): JsonMap {
  for (const value of values) {
    const record = recordValue(value);
    if (record) return record;
  }
  return {};
}

function recordValue(value: unknown): JsonMap | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as JsonMap;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textValue(value: unknown): string {
  return String(value ?? '').trim();
}

function stringListValue(value: unknown): string[] {
  const refs: string[] = [];
  for (const item of arrayValue(value)) {
    if (typeof item === 'string') {
      refs.push(item);
      continue;
    }
    const record = recordValue(item);
    if (!record) continue;
    const ref = firstValue(record, 'ref', 'path', 'id', 'uri');
    if (ref) refs.push(String(ref));
  }
  return dedupe(refs);
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}
