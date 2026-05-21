import type { AgentStreamEvent } from '../../domain';
import { formatProgressHeadline, latestProgressModel, progressModelFromEvent, type ProcessProgressModel } from '../../processProgress';
import { formatAgentTokenUsage, presentStreamEvent, presentStreamWorklog, streamEventCounts, type StreamWorklogEntry, type StreamWorklogPresentation } from '../../streamEventPresentation';
import { isVisibleRunningWorkKind } from '../../workEventAtoms';
import { Badge, cx } from '../uiPrimitives';

export function RunningWorkProcess({
  events,
  counts,
  tokenUsage,
  guidanceCount,
}: {
  events: AgentStreamEvent[];
  counts: ReturnType<typeof streamEventCounts>;
  tokenUsage?: AgentStreamEvent['usage'];
  backend: string;
  guidanceCount: number;
}) {
  const usageLabel = formatAgentTokenUsage(tokenUsage);
  const worklog = presentStreamWorklog(events, { counts, guidanceCount, limit: 48 });
  const progress = latestProgressModel(worklog.entries.map((entry) => entry.event));
  const highlightedEntries = visibleRunningWorkEntries(worklog, 8);
  const completedEntries = highlightedEntries.slice(0, -1);
  const activeEntry = highlightedEntries.at(-1);
  if (!worklog.entries.length && !guidanceCount && !usageLabel) return null;
  return (
    <div className="running-work-process">
      {progress ? <ProcessProgressCard progress={progress} /> : null}
      {highlightedEntries.length ? (
        <div className="running-work-live running-work-timeline" aria-label="正在执行的工作轨迹">
          {completedEntries.length ? (
            <details className="message-fold depth-3 running-work-completed-fold cursor-step-fold">
              <summary>
                <span className="cursor-step-kind">已完成</span>
                <span className="stream-event-detail compact">{completedTimelineSummary(completedEntries)}</span>
              </summary>
              <div className="running-work-completed-body">
                {completedEntries.map((entry) => renderLiveWorkRow(entry, 'completed'))}
              </div>
            </details>
          ) : null}
          {activeEntry ? renderLiveWorkRow(activeEntry, 'active') : null}
        </div>
      ) : null}
      <details className="message-fold depth-2 running-work-process-raw cursor-like-worklog">
        <summary>
          <span className="worklog-summary-title">执行轨迹</span>
          <span className="worklog-summary-detail">{processFoldSummary(worklog, highlightedEntries)}</span>
          {usageLabel ? <span className="worklog-summary-usage">{usageLabel}</span> : null}
        </summary>
        <div className="running-work-process-body">
          <div className="running-work-process-meta">
            {guidanceCount ? <Badge variant="warning">{guidanceCount} 条引导排队</Badge> : null}
            {counts.debug ? <Badge variant="muted">{counts.debug} 条审计事件已折叠</Badge> : null}
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
  const operationEntries = compactTimelineEntries(worklog.entries
    .filter((entry) => entry.operationLine && isVisibleRunningWorkKind(entry.operationKind)));
  const entries = operationEntries.length
    ? operationEntries
    : compactTimelineEntries(worklog.entries.filter((entry) => entry.presentation.visibleInRunningMessage));
  return keepTimelineAnchors(entries, limit);
}

export function latestVisibleWorkEvents(events: AgentStreamEvent[], limit: number) {
  return presentStreamWorklog(events, { limit }).entries.map((entry) => entry.event);
}

function runningOperationLabel(entry: StreamWorklogEntry) {
  if (entry.operationKind === 'explore') return '探索';
  if (entry.operationKind === 'search') return '检索';
  if (entry.operationKind === 'fetch') return '获取';
  if (entry.operationKind === 'analyze') return '分析';
  if (entry.operationKind === 'read') return '读取';
  if (entry.operationKind === 'write') return '写入';
  if (entry.operationKind === 'command') return '执行';
  if (entry.operationKind === 'wait') return '等待';
  if (entry.operationKind === 'validate') return '验证';
  if (entry.operationKind === 'emit') return '输出';
  if (entry.operationKind === 'artifact') return '产物';
  if (entry.operationKind === 'recover') return '恢复';
  if (entry.operationKind === 'diagnostic') return '诊断';
  return entry.event.label || entry.presentation.typeLabel;
}

function compactRunningLine(entry: StreamWorklogEntry): string {
  const progress = progressModelFromEvent(entry.event);
  if (progress) return formatProgressHeadline(progress, fallbackRunningLine(entry)) || fallbackRunningLine(entry);
  return fallbackRunningLine(entry);
}

function fallbackRunningLine(entry: StreamWorklogEntry): string {
  const structured = entry.structured;
  if (!structured) return stripOperationVerb(entry, entry.operationLine || entry.presentation.shortDetail || entry.presentation.detail || entry.presentation.usageDetail || entry.presentation.typeLabel);
  const project = structured.project
    ? `项目 ${structured.project.title || structured.project.id || 'project'}${structured.project.status ? ` · ${structured.project.status}` : ''}`
    : '';
  const stage = structured.stage
    ? `阶段 ${structured.stage.index !== undefined ? `${structured.stage.index + 1} ` : ''}${structured.stage.title || structured.stage.kind || structured.stage.id || 'stage'}${structured.stage.status ? ` · ${structured.stage.status}` : ''}`
    : '';
  const recent = structured.failure
    ? `阻断 ${structured.failure}`
    : structured.evidence
      ? `证据 ${structured.evidence}`
      : structured.nextStep
        ? `下一步 ${structured.nextStep}`
        : '';
  return [project, stage, recent].filter(Boolean).join(' · ') || stripOperationVerb(entry, entry.operationLine);
}

function renderLiveWorkRow(entry: StreamWorklogEntry, state: 'active' | 'completed') {
  const presentation = entry.presentation;
  return (
    <div className={cx('running-work-live-row', `timeline-${state}`, presentation.uiClass)} key={`${entry.event.id}-live-${state}`}>
      <Badge variant={state === 'completed' ? 'muted' : presentation.tone}>{runningOperationLabel(entry)}</Badge>
      <span>{compactRunningLine(entry)}</span>
    </div>
  );
}

function compactTimelineEntries(entries: StreamWorklogEntry[]) {
  const compacted: StreamWorklogEntry[] = [];
  for (const entry of entries) {
    const silentWaitIndex = isSilentWaitEntry(entry)
      ? compacted.findLastIndex((candidate) => isSilentWaitEntry(candidate))
      : -1;
    if (silentWaitIndex >= 0) {
      compacted[silentWaitIndex] = entry;
      continue;
    }
    const key = timelineDedupeKey(entry);
    const previous = compacted.at(-1);
    if (previous && timelineDedupeKey(previous) === key) {
      compacted[compacted.length - 1] = entry;
      continue;
    }
    compacted.push(entry);
  }
  return compacted;
}

function keepTimelineAnchors(entries: StreamWorklogEntry[], limit: number) {
  if (limit <= 0 || entries.length <= limit) return entries;
  const head = entries[0];
  const tail = entries.slice(-(limit - 1));
  return [head, ...tail.filter((entry) => entry.event.id !== head.event.id)];
}

function timelineDedupeKey(entry: StreamWorklogEntry) {
  return `${entry.operationKind}:${normalizeTimelineText(compactRunningLine(entry))}`;
}

function isSilentWaitEntry(entry: StreamWorklogEntry) {
  if (entry.operationKind !== 'wait') return false;
  const text = normalizeTimelineText([
    entry.operationLine,
    entry.presentation.detail,
    entry.presentation.shortDetail,
    compactRunningLine(entry),
  ].join(' '));
  return /没有输出新事件|没有收到新事件|http stream|codex cli|jsonl|backend|后端/.test(text);
}

function normalizeTimelineText(value: string) {
  return value
    .toLowerCase()
    .replace(/\b\d+\s*(?:ms|s|sec|seconds)\b/g, '<elapsed>')
    .replace(/后端\s*\d+\s*s/g, '后端 <elapsed>')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripOperationVerb(entry: StreamWorklogEntry, value: string) {
  const verb = operationVerbPattern(entry.operationKind);
  return verb ? value.replace(verb, '').trim() || value : value;
}

function operationVerbPattern(kind: StreamWorklogEntry['operationKind']) {
  if (kind === 'explore') return /^Explored\s+/i;
  if (kind === 'search') return /^Searched\s+/i;
  if (kind === 'fetch') return /^Fetched\s+/i;
  if (kind === 'analyze') return /^Analyzed\s+/i;
  if (kind === 'read') return /^Read\s+/i;
  if (kind === 'write') return /^Wrote\s+/i;
  if (kind === 'command') return /^Ran\s+/i;
  if (kind === 'wait') return /^Waiting\s+/i;
  if (kind === 'validate') return /^Validated\s+/i;
  if (kind === 'emit') return /^Emitted\s+/i;
  if (kind === 'artifact') return /^Created\s+/i;
  if (kind === 'recover') return /^Recovered\s+/i;
  return undefined;
}

function completedTimelineSummary(entries: StreamWorklogEntry[]) {
  const labels = entries.map(runningOperationLabel);
  return `${entries.length} 步 · ${labels.slice(-5).join(' · ')}`;
}

function processFoldSummary(worklog: StreamWorklogPresentation, timeline: StreamWorklogEntry[]) {
  const active = timeline.at(-1);
  const completedCount = Math.max(0, timeline.length - 1);
  const parts = [
    completedCount ? `已折叠 ${completedCount} 步` : '',
    active ? `当前 ${runningOperationLabel(active)}：${shortSummaryText(compactRunningLine(active), 110)}` : worklog.summary,
    worklog.counts.debug ? `${worklog.counts.debug} 条审计事件已折叠` : '',
  ].filter(Boolean);
  return parts.join(' · ') || worklog.summary;
}

function shortSummaryText(value: string, limit: number) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 18))} ... ${normalized.slice(-14)}`;
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
        <Badge variant={progress.status === 'failed' || progress.status === 'cancelled' ? 'danger' : progress.phase === 'wait' ? 'warning' : progress.status === 'completed' ? 'success' : 'info'}>
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
