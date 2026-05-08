import type { AgentStreamEvent } from '../../domain';
import { formatProgressHeadline, latestProgressModel, progressModelFromEvent, type ProcessProgressModel } from '../../processProgress';
import { formatAgentTokenUsage, presentStreamEvent, streamEventCounts } from '../../streamEventPresentation';
import { Badge, cx } from '../uiPrimitives';

export function RunningWorkProcess({
  events,
  counts,
  tokenUsage,
  backend,
  guidanceCount,
}: {
  events: AgentStreamEvent[];
  counts: ReturnType<typeof streamEventCounts>;
  tokenUsage?: AgentStreamEvent['usage'];
  backend: string;
  guidanceCount: number;
}) {
  const visibleEvents = events.slice(-48);
  const highlightedEvents = latestVisibleWorkEvents(events, 10);
  const usageLabel = formatAgentTokenUsage(tokenUsage);
  const progress = latestProgressModel(events);
  if (!visibleEvents.length && !guidanceCount && !usageLabel) return null;
  return (
    <div className="running-work-process">
      {progress ? <ProcessProgressCard progress={progress} /> : null}
      {highlightedEvents.length ? (
        <div className="running-work-live">
          {highlightedEvents.map((event) => {
            const presentation = presentStreamEvent(event);
            return (
              <div className={cx('running-work-live-row', presentation.uiClass)} key={`${event.id}-live`}>
                <Badge variant={presentation.tone}>{event.label}</Badge>
                <span>{presentation.shortDetail || presentation.detail || presentation.usageDetail || presentation.typeLabel}</span>
              </div>
            );
          })}
        </div>
      ) : null}
      <details className="message-fold depth-2 running-work-process-raw" open>
        <summary>
          完整工作过程 · {counts.key} 关键 · {counts.background} 过程
          {usageLabel ? ` · ${usageLabel}` : ''}
        </summary>
        <div className="running-work-process-body">
          <div className="running-work-process-meta">
            <Badge variant="muted">{backend}</Badge>
            {guidanceCount ? <Badge variant="warning">{guidanceCount} 条引导排队</Badge> : null}
            {counts.debug ? <Badge variant="muted">{counts.debug} debug</Badge> : null}
          </div>
          <div className="stream-events-list inline">
            {visibleEvents.map((event) => {
              const presentation = presentStreamEvent(event);
              const copyPayload = JSON.stringify(event.raw ?? { type: event.type, label: event.label, detail: event.detail }, null, 2);
              return (
                <details className={cx('stream-event', presentation.uiClass)} key={event.id} open={!presentation.initiallyCollapsed}>
                  <summary>
                    <Badge variant={presentation.tone}>{event.label}</Badge>
                    <span className="stream-event-type">{presentation.typeLabel}</span>
                    {presentation.usageDetail ? <span className="stream-event-usage">{presentation.usageDetail}</span> : null}
                    <span className="stream-event-detail compact">{presentation.shortDetail || '无详细文本'}</span>
                  </summary>
                  <div className="stream-event-expanded">
                    {presentation.detail ? <pre>{presentation.detail}</pre> : <span>无额外详情。</span>}
                    <button type="button" onClick={() => void navigator.clipboard?.writeText(copyPayload)}>复制 raw</button>
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      </details>
    </div>
  );
}

export function latestVisibleWorkEvents(events: AgentStreamEvent[], limit: number) {
  const seen = new Set<string>();
  return events
    .filter((event) => {
      const presentation = presentStreamEvent(event);
      const progress = progressModelFromEvent(event);
      if (!presentation.detail && !presentation.usageDetail && !progress) return false;
      if (presentation.importance === 'debug') return false;
      const key = `${event.type}:${presentation.shortDetail}:${progress?.phase ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-limit);
}

export function streamProcessTranscript(events: AgentStreamEvent[]) {
  const lines = latestVisibleWorkEvents(events, 24)
    .map((event) => {
      const presentation = presentStreamEvent(event);
      const progress = progressModelFromEvent(event);
      const detail = progress ? formatProgressHeadline(progress) : presentation.detail || presentation.usageDetail || presentation.shortDetail;
      return detail ? `- ${event.label || presentation.typeLabel}: ${detail}` : '';
    })
    .filter(Boolean);
  if (!lines.length) return '';
  return ['工作过程摘要:', ...lines].join('\n');
}

function ProcessProgressCard({ progress }: { progress: ProcessProgressModel }) {
  const items = [
    progress.reading.length ? ['正在读', progress.reading.join('、')] : undefined,
    progress.writing.length ? ['正在写', progress.writing.join('、')] : undefined,
    progress.waitingFor ? ['正在等', progress.waitingFor] : undefined,
    progress.nextStep ? ['下一步', progress.nextStep] : undefined,
  ].filter((item): item is [string, string] => Boolean(item));
  return (
    <div className={cx('process-progress-card', `phase-${progress.phase}`)}>
      <div className="process-progress-head">
        <Badge variant={progress.status === 'failed' ? 'danger' : progress.phase === 'wait' ? 'warning' : progress.status === 'completed' ? 'success' : 'info'}>
          {phaseLabel(progress.phase)}
        </Badge>
        <strong>{progress.title}</strong>
      </div>
      {items.length ? (
        <div className="process-progress-grid">
          {items.map(([label, value]) => (
            <div className="process-progress-item" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p>{progress.detail}</p>
      )}
    </div>
  );
}

function phaseLabel(phase: ProcessProgressModel['phase']) {
  if (phase === 'read') return '读取';
  if (phase === 'write') return '写入';
  if (phase === 'execute') return '执行';
  if (phase === 'wait') return '等待';
  if (phase === 'plan') return '计划';
  if (phase === 'complete') return '完成';
  if (phase === 'error') return '阻断';
  return '状态';
}

