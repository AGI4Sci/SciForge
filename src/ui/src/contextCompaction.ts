import type { AgentContextCompaction, AgentContextWindowState, AgentStreamEvent, SciForgeMessage, SciForgeReference } from './domain';

export function buildContextCompactionOutcome({
  eventId,
  messageId,
  result,
  beforeState,
  reason,
  startedAt,
  completedAt,
  fallbackBackend,
}: {
  eventId: string;
  messageId: string;
  result: AgentContextCompaction;
  beforeState: AgentContextWindowState;
  reason: string;
  startedAt: string;
  completedAt: string;
  fallbackBackend: string;
}): {
  event: AgentStreamEvent;
  message: SciForgeMessage;
  nextState: AgentContextWindowState;
} {
  const succeeded = result.status === 'completed';
  const lastCompactedAt = result.lastCompactedAt ?? (succeeded ? completedAt : beforeState.lastCompactedAt);
  const afterState = {
    ...(result.after ?? beforeState),
    pendingCompact: false,
    lastCompactedAt,
    compactCapability: result.compactCapability ?? beforeState.compactCapability,
    backend: result.backend ?? beforeState.backend ?? fallbackBackend,
  };
  const normalizedResult: AgentContextCompaction = {
    ...result,
    backend: result.backend ?? fallbackBackend,
    compactCapability: result.compactCapability ?? beforeState.compactCapability,
    before: result.before ?? beforeState,
    after: afterState,
    completedAt: result.completedAt ?? completedAt,
    lastCompactedAt,
    reason: result.reason ?? reason,
  };
  const detail = normalizedResult.message || contextCompactionStatusDetail(normalizedResult.status);
  const reference = contextCompactionReference(normalizedResult, messageId, detail);
  return {
    event: {
      id: eventId,
      type: 'contextCompaction',
      label: 'Conversation summarized',
      detail,
      contextCompaction: normalizedResult,
      contextWindowState: afterState,
      createdAt: completedAt,
      raw: normalizedResult,
    },
    message: {
      id: messageId,
      role: 'system',
      content: succeeded
        ? `Conversation summary updated: ${compactReasonLabel(reason)}.`
        : detail.startsWith('Conversation summary')
          ? detail
          : `Conversation summary did not finish: ${detail}`,
      expandable: JSON.stringify({
        reason,
        status: normalizedResult.status,
        startedAt,
        completedAt,
        auditRefs: normalizedResult.auditRefs ?? [],
        before: normalizedResult.before,
        after: normalizedResult.after,
        message: normalizedResult.message,
      }, null, 2),
      createdAt: completedAt,
      status: 'completed',
      references: [reference],
    },
    nextState: afterState,
  };
}

export function buildContextCompactionFailureResult({
  error,
  reason,
  backend,
  compactCapability,
  startedAt,
}: {
  error: unknown;
  reason: string;
  backend: string;
  compactCapability?: AgentContextCompaction['compactCapability'];
  startedAt: string;
}): AgentContextCompaction {
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: 'failed',
    source: 'unknown',
    backend,
    compactCapability: compactCapability ?? 'unknown',
    startedAt,
    reason,
    message,
    auditRefs: [`conversation-summary-failure:${backend}:${reason}:${startedAt}`],
  };
}

function contextCompactionReference(compaction: AgentContextCompaction, messageId: string, detail: string): SciForgeReference {
  const ref = compaction.auditRefs?.[0] ?? `context-compaction:${messageId}`;
  return {
    id: `ref-${messageId}`,
    kind: 'message',
    title: compaction.status === 'completed' ? 'conversation summary result' : 'conversation summary recovery ref',
    ref,
    summary: detail,
    payload: {
      type: 'contextCompaction',
      status: compaction.status,
      reason: compaction.reason,
      backend: compaction.backend,
      compactCapability: compaction.compactCapability,
      auditRefs: compaction.auditRefs ?? [],
      message: compaction.message,
    },
  };
}

function compactReasonLabel(reason: string) {
  if (reason === 'manual-meter-click') return 'started manually';
  if (reason === 'auto-threshold-before-send') return 'started before sending';
  return reason;
}

function contextCompactionStatusDetail(status: AgentContextCompaction['status']) {
  if (status === 'pending' || status === 'started') return 'Conversation summary started and is waiting for completion.';
  if (status === 'skipped') return 'Conversation summary was skipped; SciForge will keep a lightweight handoff instead.';
  if (status === 'failed') return 'Conversation summary did not finish.';
  return 'Conversation summary updated.';
}
