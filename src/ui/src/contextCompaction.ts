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
      label: '上下文压缩',
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
        ? `上下文压缩完成：${compactReasonLabel(reason)}。`
        : detail.startsWith('上下文压缩')
          ? detail
          : `上下文压缩未完成：${detail}`,
      expandable: JSON.stringify({
        reason,
        status: normalizedResult.status,
        backend: normalizedResult.backend,
        compactCapability: normalizedResult.compactCapability,
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
    auditRefs: [`context-compaction-failure:${backend}:${reason}:${startedAt}`],
  };
}

function contextCompactionReference(compaction: AgentContextCompaction, messageId: string, detail: string): SciForgeReference {
  const ref = compaction.auditRefs?.[0] ?? `context-compaction:${messageId}`;
  return {
    id: `ref-${messageId}`,
    kind: 'message',
    title: compaction.status === 'completed' ? 'context compaction result' : 'context compaction recovery ref',
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
  if (reason === 'manual-meter-click') return '手动触发';
  if (reason === 'auto-threshold-before-send') return '发送前自动触发';
  return reason;
}

function contextCompactionStatusDetail(status: AgentContextCompaction['status']) {
  if (status === 'pending' || status === 'started') return '上下文压缩已提交，等待后台返回完成状态。';
  if (status === 'skipped') return '上下文压缩已跳过：当前 backend 不支持原生压缩或将使用轻量 handoff。';
  if (status === 'failed') return '上下文压缩未完成：后台 compact API 返回失败。';
  return '上下文压缩完成';
}
