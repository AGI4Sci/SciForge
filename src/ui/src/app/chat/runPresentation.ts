import { presentStreamEvent } from '../../streamEventPresentation';
import type { AgentStreamEvent, GuidanceQueueRecord, NormalizedAgentResponse, SciForgeSession } from '../../domain';
import type { BadgeVariant } from '../uiPrimitives';
import { streamProcessTranscript } from './RunningWorkProcess';
import { attachGuidanceQueueToResponse, attachProcessRecoveryToFailedSession } from './sessionTransforms';

export function guidanceStatusLabel(status: GuidanceQueueRecord['status']) {
  if (status === 'merged') return '引导已合并';
  if (status === 'rejected') return '引导已拒绝';
  if (status === 'deferred') return '引导待下一轮';
  return '引导已排队';
}

export function guidanceBadgeVariant(status: GuidanceQueueRecord['status']): BadgeVariant {
  if (status === 'merged') return 'success';
  if (status === 'rejected') return 'danger';
  return 'warning';
}

export function attachStreamProcessToResponse(response: NormalizedAgentResponse, events: AgentStreamEvent[], guidanceQueue: GuidanceQueueRecord[] = []): NormalizedAgentResponse {
  const transcript = streamProcessTranscript(events);
  const responseWithGuidance = attachGuidanceQueueToResponse(
    response,
    guidanceQueue,
    'deferred',
    '当前 run 已经在执行中，追加引导已接收并等待下一轮合并处理。',
  );
  if (!transcript) return responseWithGuidance;
  const expandable = [response.message.expandable, transcript].filter(Boolean).join('\n\n');
  return {
    ...responseWithGuidance,
    message: {
      ...responseWithGuidance.message,
      expandable,
    },
    run: {
      ...responseWithGuidance.run,
      raw: {
        ...(typeof responseWithGuidance.run.raw === 'object' && responseWithGuidance.run.raw !== null ? responseWithGuidance.run.raw : {}),
        streamProcess: {
          eventCount: events.length,
          events: events.slice(-80).map((event) => ({
            type: event.type,
            label: event.label,
            detail: presentStreamEvent(event).detail || presentStreamEvent(event).usageDetail,
            createdAt: event.createdAt,
          })),
        },
      },
    },
  };
}

export function attachStreamProcessToFailedSession(session: SciForgeSession, failedRunId: string, events: AgentStreamEvent[]): SciForgeSession {
  const transcript = streamProcessTranscript(events);
  return attachProcessRecoveryToFailedSession({
    session,
    failedRunId,
    transcript,
    events: events.slice(-80).map((event) => ({
      type: event.type,
      label: event.label,
      detail: presentStreamEvent(event).detail || presentStreamEvent(event).usageDetail,
      createdAt: event.createdAt,
    })),
  });
}

export function compactFailureNotice(value: string) {
  const primary = value
    .replace(/\n\s*工作过程摘要[:：][\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!primary) return '任务未完成，执行过程已保存到运行详情。';
  if (primary.length <= 180) return primary;
  return `${primary.slice(0, 160).replace(/\s+\S*$/, '')}...`;
}

export function latestTokenUsage(events: AgentStreamEvent[]) {
  return [...events].reverse().find((event) => event.usage)?.usage;
}
