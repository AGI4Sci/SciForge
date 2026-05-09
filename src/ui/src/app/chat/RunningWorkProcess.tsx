import type { AgentStreamEvent } from '../../domain';
import { formatProgressHeadline, latestProgressModel, progressModelFromEvent, type ProcessProgressModel } from '../../processProgress';
import { formatAgentTokenUsage, presentStreamEvent, presentStreamWorklog, streamEventCounts, type StreamWorklogEntry, type StreamWorklogPresentation } from '../../streamEventPresentation';
import { isVisibleRunningWorkKind } from '../../workEventAtoms';
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
  const usageLabel = formatAgentTokenUsage(tokenUsage);
  const progress = latestProgressModel(events);
  const worklog = presentStreamWorklog(events, { counts, guidanceCount, limit: 48 });
  const highlightedEntries = visibleRunningWorkEntries(worklog, 5);
  if (!worklog.entries.length && !guidanceCount && !usageLabel) return null;
  return (
    <div className="running-work-process">
      {progress ? <ProcessProgressCard progress={progress} /> : null}
      {highlightedEntries.length ? (
        <div className="running-work-live">
          {highlightedEntries.map((entry) => {
            const presentation = entry.presentation;
            return (
              <div className={cx('running-work-live-row', presentation.uiClass)} key={`${entry.event.id}-live`}>
                <Badge variant={presentation.tone}>{runningOperationLabel(entry)}</Badge>
                <span>{compactRunningLine(entry)}</span>
              </div>
            );
          })}
        </div>
      ) : null}
      <details className="message-fold depth-2 running-work-process-raw cursor-like-worklog">
        <summary>
          <span className="worklog-summary-title">Explored</span>
          <span className="worklog-summary-detail">{worklog.summary}</span>
          {usageLabel ? <span className="worklog-summary-usage">{usageLabel}</span> : null}
        </summary>
        <div className="running-work-process-body">
          <div className="running-work-process-meta">
            <Badge variant="muted">{backend}</Badge>
            {guidanceCount ? <Badge variant="warning">{guidanceCount} 条引导排队</Badge> : null}
            {counts.debug ? <Badge variant="muted">{counts.debug} debug</Badge> : null}
          </div>
          <div className="stream-events-list inline">
            {worklog.entries.map((entry) => {
              const { event, presentation } = entry;
              return (
                <details className={cx('stream-event', presentation.uiClass, 'cursor-step-fold')} key={event.id} open={!presentation.initiallyCollapsed}>
                  <summary>
                    <span className="cursor-step-kind">{runningOperationLabel(entry)}</span>
                    {presentation.usageDetail ? <span className="stream-event-usage">{presentation.usageDetail}</span> : null}
                    <span className="stream-event-detail compact">{compactRunningLine(entry) || presentation.typeLabel || '无详细文本'}</span>
                  </summary>
                  <div className="stream-event-expanded">
                    {entry.structured ? <StructuredWorkEventFacts entry={entry} /> : null}
                    {presentation.detail ? <pre>{presentation.detail}</pre> : <span>无额外详情。</span>}
                    <details className="message-fold depth-3 stream-event-raw-fold" open={!entry.rawInitiallyCollapsed}>
                      <summary>raw output</summary>
                      <div className="stream-event-raw-body">
                        <pre>{entry.rawOutput}</pre>
                        <button type="button" onClick={() => void navigator.clipboard?.writeText(entry.rawOutput)}>复制 raw</button>
                      </div>
                    </details>
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

export function visibleRunningWorkEntries(worklog: StreamWorklogPresentation, limit = 5): StreamWorklogEntry[] {
  const operationEntries = worklog.entries
    .filter((entry) => entry.operationLine && isVisibleRunningWorkKind(entry.operationKind))
    .slice(-limit);
  if (operationEntries.length) return operationEntries;
  return worklog.entries
    .filter((entry) => entry.presentation.visibleInRunningMessage)
    .slice(-limit);
}

export function latestVisibleWorkEvents(events: AgentStreamEvent[], limit: number) {
  return presentStreamWorklog(events, { limit }).entries.map((entry) => entry.event);
}

function runningOperationLabel(entry: StreamWorklogEntry) {
  if (entry.operationKind === 'explore') return 'Explore';
  if (entry.operationKind === 'search') return 'Search';
  if (entry.operationKind === 'fetch') return 'Fetch';
  if (entry.operationKind === 'analyze') return 'Analyze';
  if (entry.operationKind === 'read') return 'Read';
  if (entry.operationKind === 'write') return 'Write';
  if (entry.operationKind === 'command') return 'Run';
  if (entry.operationKind === 'wait') return 'Wait';
  if (entry.operationKind === 'validate') return 'Validate';
  if (entry.operationKind === 'emit') return 'Emit';
  if (entry.operationKind === 'artifact') return 'Artifact';
  if (entry.operationKind === 'recover') return 'Recover';
  if (entry.operationKind === 'diagnostic') return 'Diagnostic';
  return entry.event.label || entry.presentation.typeLabel;
}

function compactRunningLine(entry: StreamWorklogEntry) {
  const structured = entry.structured;
  if (!structured) return entry.operationLine || entry.presentation.shortDetail || entry.presentation.detail || entry.presentation.usageDetail || entry.presentation.typeLabel;
  const project = structured.project
    ? `Project ${structured.project.title || structured.project.id || 'project'}${structured.project.status ? ` · ${structured.project.status}` : ''}`
    : '';
  const stage = structured.stage
    ? `Stage ${structured.stage.index !== undefined ? `${structured.stage.index + 1} ` : ''}${structured.stage.title || structured.stage.kind || structured.stage.id || 'stage'}${structured.stage.status ? ` · ${structured.stage.status}` : ''}`
    : '';
  const recent = structured.failure
    ? `Failure ${structured.failure}`
    : structured.evidence
      ? `Evidence ${structured.evidence}`
      : structured.nextStep
        ? `Next ${structured.nextStep}`
        : '';
  return [project, stage, recent].filter(Boolean).join(' · ') || entry.operationLine;
}

function StructuredWorkEventFacts({ entry }: { entry: StreamWorklogEntry }) {
  const structured = entry.structured;
  if (!structured) return null;
  const facts = [
    structured.project ? ['Project', [structured.project.title || structured.project.id, structured.project.status, structured.project.progress].filter(Boolean).join(' · ')] : undefined,
    structured.stage ? ['Stage', [
      structured.stage.index !== undefined ? `${structured.stage.index + 1}` : '',
      structured.stage.title || structured.stage.kind || structured.stage.id,
      structured.stage.status,
      structured.stage.summary,
    ].filter(Boolean).join(' · ')] : undefined,
    structured.evidence ? ['Evidence', structured.evidence] : undefined,
    structured.failure ? ['Failure', structured.failure] : undefined,
    structured.recoverActions.length ? ['Recover', structured.recoverActions.slice(0, 2).join(' · ')] : undefined,
    structured.diagnostics.length ? ['Diagnostic', structured.diagnostics.slice(0, 2).join(' · ')] : undefined,
    structured.nextStep ? ['Next', structured.nextStep] : undefined,
  ].filter((item): item is [string, string] => Boolean(item?.[1]));
  if (!facts.length) return null;
  return (
    <div className="process-progress-grid">
      {facts.map(([label, value]) => (
        <div className="process-progress-item" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
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
    progress.lastEvent ? ['最近事件', `${progress.lastEvent.label}：${progress.lastEvent.detail}`] : undefined,
    progress.nextStep ? ['下一步', progress.nextStep] : undefined,
    progress.recoveryHint ? ['恢复线索', progress.recoveryHint] : undefined,
    progress.canAbort || progress.canContinue ? ['可选操作', [progress.canAbort ? '安全中止' : '', progress.canContinue ? '继续补充指令' : ''].filter(Boolean).join(' / ')] : undefined,
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
