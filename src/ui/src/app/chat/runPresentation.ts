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
  if (looksLikeRawFailureNotice(primary)) {
    const httpStatus = primary.match(/\bHTTP\s+(\d{3})(?:\s+([A-Za-z][A-Za-z -]{2,40}))?/i);
    const reason = httpStatus
      ? `HTTP ${httpStatus[1]}${httpStatus[2] ? ` ${httpStatus[2].trim()}` : ''}`
      : /timeout|timed out|超时/i.test(primary)
        ? 'backend timeout'
        : 'backend failure';
    return `任务未完成：${reason}。详细诊断已保留在运行审计中，主结果不展示原始响应正文、endpoint 或日志内容。`;
  }
  if (primary.length <= 180) return primary;
  return `${primary.slice(0, 160).replace(/\s+\S*$/, '')}...`;
}

function looksLikeRawFailureNotice(value: string) {
  return /^[{[]/.test(value)
    || /\b(?:stdoutRef|stderrRef|rawRef|runtimeEventsRef)\b/i.test(value)
    || /\bhttps?:\/\/[^\s"'<>]+/i.test(value)
    || /\bHTTP\s+(?:401|403|429|5\d\d)\b/i.test(value)
    || /\b(?:Invalid token|Unauthorized|Forbidden)\b/i.test(value);
}

export function latestTokenUsage(events: AgentStreamEvent[]) {
  return [...events].reverse().find((event) => event.usage)?.usage;
}
