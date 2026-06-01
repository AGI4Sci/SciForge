import type {
  GuidanceQueueRecord,
  GuidanceQueueStatus,
  NormalizedAgentResponse,
  SciForgeMessage,
  SciForgeSession,
} from '../../domain';
import { makeId, nowIso } from '../../domain';

export function appendRunningGuidance(session: SciForgeSession, prompt: string) {
  return appendRunningGuidanceRecord(session, createGuidanceQueueRecord(prompt)).session;
}

export function createGuidanceQueueRecord(
  prompt: string,
  overrides: Partial<Omit<GuidanceQueueRecord, 'id' | 'prompt' | 'receivedAt' | 'status'>> & {
    id?: string;
    receivedAt?: string;
    status?: GuidanceQueueStatus;
  } = {},
): GuidanceQueueRecord {
  const now = nowIso();
  return {
    id: overrides.id ?? makeId('guidance'),
    prompt,
    status: overrides.status ?? 'queued',
    receivedAt: overrides.receivedAt ?? now,
    references: overrides.references,
    updatedAt: overrides.updatedAt,
    activeRunId: overrides.activeRunId,
    handlingRunId: overrides.handlingRunId,
    reason: overrides.reason,
  };
}

export function appendRunningGuidanceRecord(session: SciForgeSession, guidance: GuidanceQueueRecord) {
  const guidanceMessage: SciForgeMessage = {
    id: makeId('msg'),
    role: 'user',
    content: guidance.prompt,
    createdAt: guidance.receivedAt,
    status: 'running',
    references: guidance.references,
    guidanceQueue: guidance,
  };
  return {
    session: {
      ...session,
      messages: [...session.messages, guidanceMessage],
      updatedAt: guidance.receivedAt,
    },
    guidance,
  };
}

export function updateGuidanceQueueRecords(
  session: SciForgeSession,
  guidanceIds: string[],
  patch: Partial<Omit<GuidanceQueueRecord, 'id' | 'prompt' | 'receivedAt'>>,
) {
  if (!guidanceIds.length) return session;
  const idSet = new Set(guidanceIds);
  const updatedAt = patch.updatedAt ?? nowIso();
  const updateRecord = (record: GuidanceQueueRecord): GuidanceQueueRecord => idSet.has(record.id)
    ? { ...record, ...patch, updatedAt }
    : record;
  const updateRawGuidanceQueue = (raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const record = raw as Record<string, unknown>;
    const queue = Array.isArray(record.guidanceQueue)
      ? record.guidanceQueue.map((item) => item && typeof item === 'object' && !Array.isArray(item)
        ? updateRecord(item as GuidanceQueueRecord)
        : item)
      : undefined;
    return queue ? { ...record, guidanceQueue: queue } : raw;
  };
  return {
    ...session,
    messages: session.messages.map((message) => message.guidanceQueue && idSet.has(message.guidanceQueue.id)
      ? {
          ...message,
          status: guidanceMessageStatusAfterPatch(message.status, patch.status),
          guidanceQueue: updateRecord(message.guidanceQueue),
        }
      : message),
    runs: session.runs.map((run) => ({
      ...run,
      guidanceQueue: run.guidanceQueue?.map(updateRecord),
      raw: updateRawGuidanceQueue(run.raw),
    })),
    updatedAt,
  };
}

function guidanceMessageStatusAfterPatch(
  currentStatus: SciForgeMessage['status'],
  queueStatus: GuidanceQueueStatus | undefined,
): SciForgeMessage['status'] {
  return queueStatus === 'rejected' || queueStatus === 'merged' || queueStatus === 'deferred'
    ? 'completed'
    : currentStatus;
}

export function resolveGuidanceQueueAfterRun(
  session: SciForgeSession,
  guidanceQueue: GuidanceQueueRecord[],
  options: { userCancelled?: boolean; runFailed?: boolean; runEndedReason?: string } = {},
): { session: SciForgeSession; remainingQueue: GuidanceQueueRecord[]; nextGuidance?: GuidanceQueueRecord } {
  if (!guidanceQueue.length) return { session, remainingQueue: [] };
  if (options.userCancelled) {
    return {
      session: updateGuidanceQueueRecords(session, guidanceQueue.map((item) => item.id), {
        status: 'rejected',
        reason: options.runEndedReason ?? '用户显式中断当前 run；排队引导已跨过 cancel boundary，不能自动恢复不可逆 side effect。',
      }),
      remainingQueue: [],
    };
  }
  if (options.runFailed) {
    const reason = options.runEndedReason ?? '当前 run 失败；排队引导保留为 deferred，等待用户确认、修复或重新运行后再合并。';
    const updatedQueue = guidanceQueue.map((item) => ({
      ...item,
      status: 'deferred' as const,
      reason,
      updatedAt: nowIso(),
    }));
    return {
      session: updateGuidanceQueueRecords(session, guidanceQueue.map((item) => item.id), {
        status: 'deferred',
        reason,
      }),
      remainingQueue: updatedQueue,
    };
  }
  const nextGuidance = guidanceQueue.find((item) => item.status === 'queued');
  if (!nextGuidance) {
    return {
      session,
      remainingQueue: guidanceQueue,
    };
  }
  const remainingQueue = guidanceQueue.filter((item) => item.id !== nextGuidance.id);
  return {
    session: updateGuidanceQueueRecords(session, [nextGuidance.id], {
      status: 'merged',
      reason: options.runEndedReason ?? '当前 run 已结束，已按 run orchestration contract 合并为下一轮用户引导。',
      handlingRunId: 'pending-next-run',
    }),
    remainingQueue,
    nextGuidance,
  };
}

export function attachGuidanceQueueToResponse(
  response: NormalizedAgentResponse,
  guidanceQueue: GuidanceQueueRecord[],
  status: GuidanceQueueStatus,
  reason: string,
): NormalizedAgentResponse {
  if (!guidanceQueue.length) return response;
  const updatedAt = nowIso();
  const records = guidanceQueue.map((record) => ({
    ...record,
    status,
    reason,
    updatedAt,
    activeRunId: record.activeRunId ?? response.run.id,
  }));
  const raw = typeof response.run.raw === 'object' && response.run.raw !== null ? response.run.raw : {};
  return {
    ...response,
    run: {
      ...response.run,
      guidanceQueue: records,
      raw: {
        ...raw,
        guidanceQueue: records,
      },
    },
  };
}

export function attachGuidanceQueueToSessionRun(
  session: SciForgeSession,
  runId: string,
  guidanceQueue: GuidanceQueueRecord[],
  status: GuidanceQueueStatus,
  reason: string,
): SciForgeSession {
  if (!guidanceQueue.length) return session;
  const updatedAt = nowIso();
  const records = guidanceQueue.map((record) => ({
    ...record,
    status,
    reason,
    updatedAt,
    activeRunId: record.activeRunId ?? runId,
  }));
  return {
    ...session,
    runs: session.runs.map((run) => {
      if (run.id !== runId) return run;
      const raw = typeof run.raw === 'object' && run.raw !== null ? run.raw : {};
      return {
        ...run,
        guidanceQueue: records,
        raw: {
          ...raw,
          guidanceQueue: records,
        },
      };
    }),
    updatedAt,
  };
}
