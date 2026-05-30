import type { AgentStreamEvent, ObjectReference } from '../../domain';
import {
  Brain,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  FileText,
  GitCompare,
  PackageCheck,
  PencilLine,
  Search,
  ShieldQuestion,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { SupportedLocale } from '../../i18n';
import { formatProgressHeadline, progressModelFromEvent } from '../../processProgress';
import { streamEventCounts, type StreamWorklogEntry, type StreamWorklogPresentation } from '../../streamEventPresentation';
import { isVisibleRunningWorkKind } from '../../workEventAtoms';
import { cx } from '../uiPrimitives';
import {
  buildCursorAgentProcessModel,
  type CursorAgentAction,
  type CursorAgentProcessGroup,
} from './cursorAgentProcess';
import { chatText } from './chatI18n';

export function RunningWorkProcess({
  events,
  counts,
  guidanceCount,
  onObjectFocus,
  locale,
}: {
  events: AgentStreamEvent[];
  counts: ReturnType<typeof streamEventCounts>;
  tokenUsage?: AgentStreamEvent['usage'];
  backend: string;
  guidanceCount: number;
  onObjectFocus?: (reference: ObjectReference) => void;
  locale?: SupportedLocale;
}) {
  const process = buildCursorAgentProcessModel(events, { mode: 'live', limit: 48, locale });
  if (!process.groups.length && !guidanceCount) return null;
  return (
    <div className="running-work-process">
      <NativeEventStream
        events={events}
        counts={counts}
        guidanceCount={guidanceCount}
        mode="live"
        limit={48}
        onObjectFocus={onObjectFocus}
        locale={locale}
      />
    </div>
  );
}

export function NativeEventStream({
  events,
  counts,
  guidanceCount = 0,
  mode = 'recorded',
  limit = 18,
  onObjectFocus,
  locale,
  sourceRunId,
}: {
  events: AgentStreamEvent[];
  counts?: ReturnType<typeof streamEventCounts>;
  guidanceCount?: number;
  mode?: 'live' | 'recorded';
  limit?: number;
  onObjectFocus?: (reference: ObjectReference) => void;
  locale?: SupportedLocale;
  sourceRunId?: string;
}) {
  const resolvedCounts = counts ?? streamEventCounts(events);
  const process = buildCursorAgentProcessModel(events, { mode, limit, locale, sourceRunId });
  if (!process.groups.length && !guidanceCount) return null;
  const moreActivityLabel = chatText(locale, { 'zh-CN': '更多活动', 'en-US': 'More activity' });
  return (
    <section
      className={cx('native-event-stream', mode === 'live' ? 'is-live' : 'is-recorded', 'cursor-agent-process')}
      aria-label={chatText(locale, { 'zh-CN': '代理过程', 'en-US': 'Agent process' })}
    >
      <div className="native-event-list">
        {process.groups.map((group) => (
          <CursorAgentProcessGroupView key={group.id} group={group} onObjectFocus={onObjectFocus} locale={locale} />
        ))}
      </div>
      {(guidanceCount || process.hiddenActionCount || resolvedCounts.debug || process.hiddenAuditCount) ? (
        <div className="native-event-audit-fold cursor-agent-muted-row" aria-label={moreActivityLabel}>
          <span>{moreActivityLabel}</span>
          {guidanceCount ? <small>{chatText(locale, { 'zh-CN': `${guidanceCount} 条已排队`, 'en-US': `${guidanceCount} queued` })}</small> : null}
          {process.hiddenActionCount ? <small>{chatText(locale, { 'zh-CN': `${process.hiddenActionCount} 条较早动作`, 'en-US': `${process.hiddenActionCount} earlier` })}</small> : null}
          {resolvedCounts.debug || process.hiddenAuditCount ? <small>{chatText(locale, { 'zh-CN': `${Math.max(resolvedCounts.debug, process.hiddenAuditCount)} 条支撑事件`, 'en-US': `${Math.max(resolvedCounts.debug, process.hiddenAuditCount)} supporting events` })}</small> : null}
        </div>
      ) : null}
    </section>
  );
}

function CursorAgentProcessGroupView({
  group,
  onObjectFocus,
  locale,
}: {
  group: CursorAgentProcessGroup;
  onObjectFocus?: (reference: ObjectReference) => void;
  locale?: SupportedLocale;
}) {
  return (
    <details
      className={cx('native-event-row cursor-agent-group', `cursor-agent-${group.kind}`, `status-${group.status}`)}
      open={group.initiallyExpanded}
    >
      <summary>
        <span className="native-event-chevron" aria-hidden="true"><ChevronRight size={12} /></span>
        <span className="native-event-dot" aria-hidden="true" />
        <span className="native-event-kind" aria-label={group.kind === 'worked' ? chatText(locale, { 'zh-CN': '工作', 'en-US': 'Worked' }) : chatText(locale, { 'zh-CN': '探索', 'en-US': 'Explored' })} />
        <span className="native-event-title">{group.title}</span>
        <span className="native-event-usage">{group.summary}</span>
      </summary>
      <div className="native-event-expanded cursor-agent-actions">
        {group.actions.map((action) => (
          <CursorAgentActionRow key={action.id} action={action} onObjectFocus={onObjectFocus} locale={locale} />
        ))}
      </div>
    </details>
  );
}

function CursorAgentActionRow({
  action,
  onObjectFocus,
  locale,
}: {
  action: CursorAgentAction;
  onObjectFocus?: (reference: ObjectReference) => void;
  locale?: SupportedLocale;
}) {
  const hasTranscript = action.kind === 'subagent' && Boolean(action.transcriptRef);
  const resultRefs = refsForResultDetail(action);
  const visibleRefs = refsForActionDetail(action);
  const hasResult = Boolean(action.resultSummary || resultRefs.length);
  const hasTextOutput = shouldShowActionTextDetail(action);
  const hasDetail = action.kind !== 'folded' && Boolean(
    (hasTextOutput && (action.detail || action.outputSummary))
    || visibleRefs.length
    || action.diff
    || hasTranscript
    || hasResult,
  );
  const focusReference = objectReferenceForCursorAction(action);
  const className = cx('native-event-row cursor-agent-action', `cursor-agent-action-${action.kind}`, `status-${action.status}`, action.status === 'running' && 'active', !hasDetail && 'is-leaf');
  if (!hasDetail) {
    return (
      <div className={className}>
        <CursorAgentActionSummary action={action} focusReference={focusReference} onObjectFocus={onObjectFocus} locale={locale} asSummary={false} />
      </div>
    );
  }
  return (
    <details
      className={className}
      open={action.initiallyExpanded}
    >
      <CursorAgentActionSummary action={action} focusReference={focusReference} onObjectFocus={onObjectFocus} locale={locale} />
      <div className="native-event-expanded">
        <CursorAgentActionDetail action={action} resultRefs={resultRefs} visibleRefs={visibleRefs} onObjectFocus={onObjectFocus} locale={locale} />
      </div>
    </details>
  );
}

function CursorAgentActionSummary({
  action,
  focusReference,
  onObjectFocus,
  locale,
  asSummary = true,
}: {
  action: CursorAgentAction;
  focusReference?: ObjectReference;
  onObjectFocus?: (reference: ObjectReference) => void;
  locale?: SupportedLocale;
  asSummary?: boolean;
}) {
  const SummaryTag = asSummary ? 'summary' : 'div';
  return (
    <SummaryTag className="cursor-agent-action-summary">
      <span className="native-event-chevron" aria-hidden="true"><ChevronRight size={12} /></span>
      <span className="native-event-dot" aria-hidden="true" />
      <CursorActionIcon action={action} />
      <span className="native-event-kind" aria-label={cursorActionKindLabel(action, locale)} />
      {focusReference && onObjectFocus ? (
        <button
          type="button"
          className="native-event-title cursor-agent-action-focus"
          data-sciforge-run-id={focusReference.runId}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onObjectFocus(focusReference);
          }}
        >
          {action.title}
        </button>
      ) : (
        <span className="native-event-title">{action.title}</span>
      )}
      {action.status !== 'unknown' ? <span className="native-event-usage">{cursorActionStatusLabel(action.status, locale)}</span> : null}
      <time>{formatEventTime(action.createdAt)}</time>
    </SummaryTag>
  );
}

function CursorAgentActionDetail({
  action,
  resultRefs,
  visibleRefs,
  onObjectFocus,
  locale,
}: {
  action: CursorAgentAction;
  resultRefs: string[];
  visibleRefs: string[];
  onObjectFocus?: (reference: ObjectReference) => void;
  locale?: SupportedLocale;
}) {
  if (action.kind === 'subagent') {
    return (
      <>
        {action.transcriptRef ? (
          <ActionDetailSection title={chatText(locale, { 'zh-CN': 'Transcript', 'en-US': 'Transcript' })}>
            <CursorAgentRefItem refValue={action.transcriptRef} label={chatText(locale, { 'zh-CN': 'transcript', 'en-US': 'transcript' })} onObjectFocus={onObjectFocus} />
          </ActionDetailSection>
        ) : null}
        {visibleRefs.length ? (
          <ActionDetailSection title={chatText(locale, { 'zh-CN': '引用', 'en-US': 'Refs' })}>
            <CursorAgentRefList refs={visibleRefs} onObjectFocus={onObjectFocus} locale={locale} />
          </ActionDetailSection>
        ) : null}
        {resultRefs.length || action.resultSummary ? (
          <ActionDetailSection title={chatText(locale, { 'zh-CN': '结果', 'en-US': 'Result' })}>
            {resultRefs.length ? <CursorAgentRefList refs={resultRefs} label={chatText(locale, { 'zh-CN': 'result', 'en-US': 'result' })} onObjectFocus={onObjectFocus} locale={locale} /> : null}
            {action.resultSummary ? <CursorAgentProseOutput>{action.resultSummary}</CursorAgentProseOutput> : null}
          </ActionDetailSection>
        ) : null}
        {shouldShowActionTextDetail(action) && action.outputSummary ? (
          <ActionDetailSection title={chatText(locale, { 'zh-CN': '输出', 'en-US': 'Output' })}>
            <CursorAgentTextDetail action={action} text={action.outputSummary} />
          </ActionDetailSection>
        ) : null}
        {shouldShowActionTextDetail(action) && action.detail ? (
          <ActionDetailSection title={chatText(locale, { 'zh-CN': '输出', 'en-US': 'Output' })}>
            <CursorAgentTextDetail action={action} text={action.detail} />
          </ActionDetailSection>
        ) : null}
      </>
    );
  }
  return (
    <>
      {visibleRefs.length ? (
        <ActionDetailSection title={chatText(locale, { 'zh-CN': '引用', 'en-US': 'Refs' })}>
          <CursorAgentRefList refs={visibleRefs} onObjectFocus={onObjectFocus} locale={locale} />
        </ActionDetailSection>
      ) : null}
      {action.resultSummary || resultRefs.length ? (
        <ActionDetailSection title={chatText(locale, { 'zh-CN': '结果', 'en-US': 'Result' })}>
            {action.resultSummary ? <CursorAgentProseOutput>{action.resultSummary}</CursorAgentProseOutput> : null}
          {resultRefs.length ? <CursorAgentRefList refs={resultRefs} label={chatText(locale, { 'zh-CN': 'result', 'en-US': 'result' })} onObjectFocus={onObjectFocus} locale={locale} /> : null}
        </ActionDetailSection>
      ) : null}
      {shouldShowActionTextDetail(action) && action.outputSummary ? (
        <ActionDetailSection title={chatText(locale, { 'zh-CN': '输出', 'en-US': 'Output' })}>
          <CursorAgentTextDetail action={action} text={action.outputSummary} />
        </ActionDetailSection>
      ) : null}
      {shouldShowActionTextDetail(action) && action.detail ? (
        <ActionDetailSection title={chatText(locale, { 'zh-CN': '输出', 'en-US': 'Output' })}>
          <CursorAgentTextDetail action={action} text={action.detail} />
        </ActionDetailSection>
      ) : null}
      {action.diff ? (
        <ActionDetailSection title={chatText(locale, { 'zh-CN': 'Diff', 'en-US': 'Diff' })}>
          <pre className="cursor-agent-diff">{action.diff}</pre>
        </ActionDetailSection>
      ) : null}
    </>
  );
}

function refsForResultDetail(action: CursorAgentAction) {
  return action.resultRefs;
}

function refsForActionDetail(action: CursorAgentAction) {
  const hiddenRefs = new Set([
    action.kind === 'subagent' ? action.transcriptRef : undefined,
    action.fileRef,
    action.diffRef,
    ...action.resultRefs,
  ].filter((ref): ref is string => Boolean(ref)));
  return hiddenRefs.size ? action.refs.filter((ref) => !hiddenRefs.has(ref)) : action.refs;
}

function shouldShowActionTextDetail(action: CursorAgentAction) {
  if (action.kind !== 'read' && action.kind !== 'fetch') return true;
  return action.status !== 'completed';
}

function CursorAgentProseOutput({ children }: { children: string }) {
  return <div className="cursor-agent-prose-output">{children}</div>;
}

function CursorAgentTextDetail({ action, text }: { action: CursorAgentAction; text: string }) {
  if (action.kind === 'thought') return <CursorAgentProseOutput>{text}</CursorAgentProseOutput>;
  return <pre className="cursor-agent-output">{text}</pre>;
}

function ActionDetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="cursor-agent-detail-section" aria-label={title}>
      {children}
    </section>
  );
}

function CursorActionIcon({ action }: { action: CursorAgentAction }) {
  const Icon = cursorActionIcon(action.kind);
  return (
    <span className="cursor-agent-action-icon" aria-hidden="true">
      <Icon size={13} strokeWidth={2} />
    </span>
  );
}

function cursorActionIcon(kind: CursorAgentAction['kind']): LucideIcon {
  if (kind === 'read' || kind === 'fetch') return FileText;
  if (kind === 'search') return Search;
  if (kind === 'shell_command') return Terminal;
  if (kind === 'file_edit' || kind === 'write') return PencilLine;
  if (kind === 'diff') return GitCompare;
  if (kind === 'thought') return Brain;
  if (kind === 'approval') return ShieldQuestion;
  if (kind === 'subagent') return CircleDashed;
  if (kind === 'validate') return CircleCheck;
  if (kind === 'artifact') return PackageCheck;
  if (kind === 'folded') return ChevronRight;
  return Wrench;
}

function CursorAgentRefList({
  refs,
  label = 'ref',
  onObjectFocus,
  locale,
}: {
  refs: string[];
  label?: string;
  onObjectFocus?: (reference: ObjectReference) => void;
  locale?: SupportedLocale;
}) {
  return (
    <div className="cursor-agent-ref-list" aria-label={chatText(locale, { 'zh-CN': '动作引用', 'en-US': 'Action references' })}>
      {refs.map((ref) => (
        <CursorAgentRefItem key={ref} refValue={ref} label={label} onObjectFocus={onObjectFocus} />
      ))}
    </div>
  );
}

function CursorAgentRefItem({
  refValue,
  label,
  onObjectFocus,
}: {
  refValue: string;
  label: string;
  onObjectFocus?: (reference: ObjectReference) => void;
}) {
  const reference = objectReferenceForCursorRef(refValue);
  const displayLabel = displayCursorRefLabel(refValue);
  return (
    <div className="cursor-agent-ref">
      <span className="cursor-agent-ref-label">{label}</span>
      {reference && onObjectFocus ? (
        <button type="button" className="cursor-agent-ref-button" onClick={() => onObjectFocus(reference)}>{displayLabel}</button>
      ) : (
        <code>{displayLabel}</code>
      )}
    </div>
  );
}

function displayCursorRefLabel(refValue: string) {
  if (refValue.startsWith('file:')) return basename(refValue.slice('file:'.length));
  if (refValue.startsWith('artifact:')) return basename(refValue.slice('artifact:'.length));
  return basename(refValue.replace(/^[a-z-]+:{1,2}/i, '')) || refValue;
}

function objectReferenceForCursorAction(action: CursorAgentAction): ObjectReference | undefined {
  if (!['read', 'file_edit', 'diff', 'write'].includes(action.kind)) return undefined;
  const ref = action.fileRef ?? (action.kind === 'diff' ? action.diffRef : undefined);
  if (!ref) return undefined;
  const reference = objectReferenceForCursorRef(ref, action.filePath);
  return reference && action.runId ? { ...reference, runId: action.runId } : reference;
}

function objectReferenceForCursorRef(ref: string, fallbackPath?: string): ObjectReference | undefined {
  if (!ref.startsWith('file:') && !ref.startsWith('artifact:')) return undefined;
  if (!isTrustedCursorObjectRef(ref)) return undefined;
  const path = ref.startsWith('file:') ? ref.slice('file:'.length) : fallbackPath;
  return {
    id: `cursor-action-${safeObjectReferenceId(ref)}`,
    title: basename(path ?? ref),
    kind: ref.startsWith('artifact:') ? 'artifact' : 'file',
    ref,
    presentationRole: 'supporting-evidence',
    status: 'available',
    summary: 'Agent action preview',
    provenance: path ? { path, producer: 'cursor-agent-process' } : { producer: 'cursor-agent-process' },
  };
}

function isTrustedCursorObjectRef(ref: string) {
  if (/\[local-path\]|\[redacted\]|\[url\]|https?:\/\//i.test(ref)) return false;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(ref)) return false;
  if (ref.startsWith('artifact:')) return ref.slice('artifact:'.length).trim().length > 0;
  const filePath = ref.slice('file:'.length).replace(/\\/g, '/').trim();
  if (!filePath || filePath.startsWith('/') || filePath.includes('://')) return false;
  if (/[\r\n\t<>|?*:]/.test(filePath)) return false;
  if (filePath.split('/').some((part) => part === '..')) return false;
  if (/(?:^|\/)(?:Users|Applications|Volumes|private|var|tmp|\.sciforge)(?:\/|$)/i.test(filePath)) return false;
  return true;
}

function safeObjectReferenceId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'preview';
}

function basename(path: string) {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? path;
}

function cursorActionKindLabel(action: CursorAgentAction, locale?: SupportedLocale) {
  if (action.kind === 'read') return chatText(locale, { 'zh-CN': '读取', 'en-US': 'Read' });
  if (action.kind === 'search') return chatText(locale, { 'zh-CN': '搜索', 'en-US': 'Search' });
  if (action.kind === 'fetch') return chatText(locale, { 'zh-CN': '获取', 'en-US': 'Fetch' });
  if (action.kind === 'shell_command') return chatText(locale, { 'zh-CN': '运行', 'en-US': 'Ran' });
  if (action.kind === 'file_edit') return chatText(locale, { 'zh-CN': '编辑', 'en-US': 'Edited' });
  if (action.kind === 'diff') return 'Diff';
  if (action.kind === 'thought') return chatText(locale, { 'zh-CN': '思考', 'en-US': 'Thought' });
  if (action.kind === 'approval') return chatText(locale, { 'zh-CN': '确认', 'en-US': 'Approval' });
  if (action.kind === 'subagent') return chatText(locale, { 'zh-CN': '子代理', 'en-US': 'Sub agent' });
  if (action.kind === 'write') return chatText(locale, { 'zh-CN': '写入', 'en-US': 'Write' });
  if (action.kind === 'validate') return chatText(locale, { 'zh-CN': '检查', 'en-US': 'Check' });
  if (action.kind === 'artifact') return chatText(locale, { 'zh-CN': 'Artifact', 'en-US': 'Artifact' });
  if (action.kind === 'folded') return chatText(locale, { 'zh-CN': '已折叠', 'en-US': 'Folded' });
  return chatText(locale, { 'zh-CN': '动作', 'en-US': 'Action' });
}

function cursorActionStatusLabel(status: CursorAgentAction['status'], locale?: SupportedLocale) {
  if (status === 'running') return chatText(locale, { 'zh-CN': '运行中', 'en-US': 'running' });
  if (status === 'completed') return chatText(locale, { 'zh-CN': '完成', 'en-US': 'done' });
  if (status === 'blocked') return chatText(locale, { 'zh-CN': '被阻止', 'en-US': 'blocked' });
  if (status === 'failed') return chatText(locale, { 'zh-CN': '失败', 'en-US': 'failed' });
  if (status === 'cancelled') return chatText(locale, { 'zh-CN': '已取消', 'en-US': 'cancelled' });
  return '';
}

export function visibleRunningWorkEntries(worklog: StreamWorklogPresentation, limit = 5): StreamWorklogEntry[] {
  const operationEntries = compactTimelineEntries(worklog.entries
    .filter((entry) => entry.operationLine && isVisibleRunningWorkKind(entry.operationKind)));
  const entries = operationEntries.length
    ? operationEntries
    : compactTimelineEntries(worklog.entries.filter((entry) => entry.presentation.visibleInRunningMessage));
  return keepTimelineAnchors(entries, limit);
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
    ? `Project ${structured.project.title || structured.project.id || 'project'}${structured.project.status ? ` · ${structured.project.status}` : ''}`
    : '';
  const stage = structured.stage
    ? `Step ${structured.stage.index !== undefined ? `${structured.stage.index + 1} ` : ''}${structured.stage.title || structured.stage.kind || structured.stage.id || 'stage'}${structured.stage.status ? ` · ${structured.stage.status}` : ''}`
    : '';
  const recent = structured.failure
    ? `Blocked ${structured.failure}`
    : structured.evidence
      ? `Evidence ${structured.evidence}`
      : structured.nextStep
        ? `Next ${structured.nextStep}`
        : '';
  return [project, stage, recent].filter(Boolean).join(' · ') || stripOperationVerb(entry, entry.operationLine);
}

function formatEventTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
  const text = backendWaitPlaceholderText(entry);
  if (!text) return false;
  if (entry.operationKind !== 'wait') return /下一条|jsonl|http stream|没有输出新事件|没有收到新事件|silent/.test(text);
  return true;
}

function backendWaitPlaceholderText(entry: StreamWorklogEntry) {
  const raw = isRecord(entry.event.raw) ? entry.event.raw : {};
  const progress = isRecord(raw.progress) ? raw.progress : {};
  if (raw.silentStreamWaiting === true || raw.backendSilent === true) return 'silent stream wait';
  const text = normalizeTimelineText([
    entry.operationLine,
    entry.presentation.detail,
    entry.presentation.shortDetail,
    compactRunningLine(entry),
    stringField(progress.phase),
    stringField(progress.reason),
    stringField(progress.title),
    stringField(progress.waitingFor),
    stringField(progress.nextStep),
    stringField(raw.reason),
    stringField(raw.waitingFor),
  ].join(' '));
  return /没有输出新事件|没有收到新事件|http stream|codex cli|jsonl|后端\s*(?:<elapsed>|正在等|等待|没有|仍在)/.test(text)
    ? text
    : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
