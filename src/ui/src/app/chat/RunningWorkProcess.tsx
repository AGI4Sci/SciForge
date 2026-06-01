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
import { objectReferenceForCursorAction, objectReferenceForCursorRef } from './cursorProcessObjectReferences';
import { chatText } from './chatI18n';

export function RunningWorkProcess({
  events,
  counts,
  guidanceCount,
  onObjectFocus,
  onGuiCommand,
  locale,
}: {
  events: AgentStreamEvent[];
  counts: ReturnType<typeof streamEventCounts>;
  tokenUsage?: AgentStreamEvent['usage'];
  backend: string;
  guidanceCount: number;
  onObjectFocus?: (reference: ObjectReference) => void;
  onGuiCommand?: (commandText: string) => void;
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
        onGuiCommand={onGuiCommand}
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
  onGuiCommand,
  locale,
  sourceRunId,
}: {
  events: AgentStreamEvent[];
  counts?: ReturnType<typeof streamEventCounts>;
  guidanceCount?: number;
  mode?: 'live' | 'recorded';
  limit?: number;
  onObjectFocus?: (reference: ObjectReference) => void;
  onGuiCommand?: (commandText: string) => void;
  locale?: SupportedLocale;
  sourceRunId?: string;
}) {
  const resolvedCounts = counts ?? streamEventCounts(events);
  const process = buildCursorAgentProcessModel(events, { mode, limit, locale, sourceRunId });
  if (!process.groups.length && !guidanceCount) return null;
  const moreActivityLabel = chatText(locale, { 'zh-CN': '更多活动', 'en-US': 'More activity' });
  const hiddenAuditCount = Math.max(resolvedCounts.debug, process.hiddenAuditCount);
  return (
    <section
      className={cx('native-event-stream', mode === 'live' ? 'is-live' : 'is-recorded', 'cursor-agent-process')}
      aria-label={chatText(locale, { 'zh-CN': '代理过程', 'en-US': 'Agent process' })}
    >
      <div className="native-event-list">
        {process.groups.map((group) => (
          <CursorAgentProcessGroupView key={group.id} group={group} mode={mode} onObjectFocus={onObjectFocus} onGuiCommand={onGuiCommand} locale={locale} />
        ))}
      </div>
      {(guidanceCount || process.hiddenActionCount || hiddenAuditCount) ? (
        <details
          className="native-event-audit-fold cursor-agent-muted-row"
          aria-label={moreActivityLabel}
          data-guidance-count={guidanceCount}
          data-hidden-action-count={process.hiddenActionCount}
          data-hidden-audit-count={hiddenAuditCount}
        >
          <summary>
            <span>{moreActivityLabel}</span>
            {guidanceCount ? <small>{chatText(locale, { 'zh-CN': `${guidanceCount} 条已排队`, 'en-US': `${guidanceCount} queued` })}</small> : null}
            {process.hiddenActionCount ? <small>{chatText(locale, { 'zh-CN': `${process.hiddenActionCount} 条较早动作`, 'en-US': `${process.hiddenActionCount} earlier` })}</small> : null}
            {hiddenAuditCount ? <small>{chatText(locale, { 'zh-CN': `${hiddenAuditCount} 条支撑事件`, 'en-US': `${hiddenAuditCount} supporting events` })}</small> : null}
          </summary>
          <div className="native-event-audit-detail">
            {guidanceCount ? <span>{chatText(locale, { 'zh-CN': `${guidanceCount} 条排队指令`, 'en-US': `${guidanceCount} queued guidance` })}</span> : null}
            {process.hiddenActionCount ? <span>{chatText(locale, { 'zh-CN': `${process.hiddenActionCount} 条较早动作`, 'en-US': `${process.hiddenActionCount} earlier actions` })}</span> : null}
            {hiddenAuditCount ? <span>{chatText(locale, { 'zh-CN': `${hiddenAuditCount} 条支撑事件`, 'en-US': `${hiddenAuditCount} supporting events` })}</span> : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function CursorAgentProcessGroupView({
  group,
  mode,
  onObjectFocus,
  onGuiCommand,
  locale,
}: {
  group: CursorAgentProcessGroup;
  mode: 'live' | 'recorded';
  onObjectFocus?: (reference: ObjectReference) => void;
  onGuiCommand?: (commandText: string) => void;
  locale?: SupportedLocale;
}) {
  const usage = cursorGroupUsageLabel(group);
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
        {usage ? <span className="native-event-usage">{usage}</span> : null}
      </summary>
      <div className="native-event-expanded cursor-agent-actions">
        {group.actions.map((action) => (
          <CursorAgentActionRow key={action.id} action={action} mode={mode} onObjectFocus={onObjectFocus} onGuiCommand={onGuiCommand} locale={locale} />
        ))}
      </div>
    </details>
  );
}

function cursorGroupUsageLabel(group: CursorAgentProcessGroup) {
  if (group.kind === 'explored') return '';
  return group.summary;
}

function CursorAgentActionRow({
  action,
  mode,
  onObjectFocus,
  onGuiCommand,
  locale,
}: {
  action: CursorAgentAction;
  mode: 'live' | 'recorded';
  onObjectFocus?: (reference: ObjectReference) => void;
  onGuiCommand?: (commandText: string) => void;
  locale?: SupportedLocale;
}) {
  const hasTranscript = action.kind === 'subagent' && Boolean(action.transcriptRef);
  const resultRefs = refsForResultDetail(action);
  const visibleRefs = refsForActionDetail(action);
  const hasResult = Boolean(action.resultSummary || resultRefs.length);
  const hasTextOutput = shouldShowActionTextDetail(action);
  const hasDetail = action.kind !== 'folded' && Boolean(
    (hasTextOutput && (action.detail || action.outputSummary))
    || action.commands.length
    || visibleRefs.length
    || action.diff
    || hasTranscript
    || hasResult,
  );
  const focusReference = objectReferenceForCursorAction(action);
  const className = cx('native-event-row cursor-agent-action', `cursor-agent-action-${action.kind}`, `status-${action.status}`, mode === 'live' && action.status === 'running' && 'active', !hasDetail && 'is-leaf');
  const actionAriaLabel = cursorActionAriaLabel(action, locale);
  if (!hasDetail) {
    return (
      <div
        className={className}
        data-action-kind={action.kind}
        data-action-status={action.status}
        role="group"
        aria-label={actionAriaLabel}
      >
        <CursorAgentActionSummary action={action} mode={mode} focusReference={focusReference} onObjectFocus={onObjectFocus} locale={locale} asSummary={false} />
      </div>
    );
  }
  return (
    <details
      className={className}
      open={action.initiallyExpanded}
      data-action-kind={action.kind}
      data-action-status={action.status}
      aria-label={actionAriaLabel}
    >
      <CursorAgentActionSummary action={action} mode={mode} focusReference={focusReference} onObjectFocus={onObjectFocus} locale={locale} />
      <div className="native-event-expanded">
        <CursorAgentActionDetail action={action} resultRefs={resultRefs} visibleRefs={visibleRefs} onObjectFocus={onObjectFocus} onGuiCommand={onGuiCommand} locale={locale} />
      </div>
    </details>
  );
}

function CursorAgentActionSummary({
  action,
  mode,
  focusReference,
  onObjectFocus,
  locale,
  asSummary = true,
}: {
  action: CursorAgentAction;
  mode: 'live' | 'recorded';
  focusReference?: ObjectReference;
  onObjectFocus?: (reference: ObjectReference) => void;
  locale?: SupportedLocale;
  asSummary?: boolean;
}) {
  const SummaryTag = asSummary ? 'summary' : 'div';
  const showStatus = mode === 'live'
    ? action.status !== 'unknown' && action.status !== 'completed' && action.status !== 'running'
    : action.status === 'failed' || action.status === 'blocked' || action.status === 'cancelled';
  const kindLabel = cursorActionKindLabel(action, locale);
  const summaryLabel = cursorActionAriaLabel(action, locale);
  return (
    <SummaryTag
      className="cursor-agent-action-summary"
      data-action-kind={action.kind}
      data-action-status={action.status}
      aria-label={summaryLabel}
    >
      <span className="native-event-chevron" aria-hidden="true"><ChevronRight size={12} /></span>
      <span className="native-event-dot" aria-hidden="true" />
      <CursorActionIcon action={action} />
      <span className="native-event-kind" aria-label={kindLabel}>{kindLabel}</span>
      {focusReference && onObjectFocus ? (
        <button
          type="button"
          className="native-event-title cursor-agent-action-focus"
          data-sciforge-run-id={publicRunIdForDom(focusReference)}
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
      {showStatus ? <span className="native-event-usage">{cursorActionStatusLabel(action.status, locale)}</span> : null}
      <time dateTime={action.createdAt}>{formatEventTime(action.createdAt)}</time>
    </SummaryTag>
  );
}

function publicRunIdForDom(reference: ObjectReference) {
  const raw = reference.runId?.trim();
  if (!raw) return undefined;
  if (isPrivateRunId(raw)) return undefined;
  return raw.length > 96 ? `${raw.slice(0, 93)}...` : raw;
}

function isPrivateRunId(value: string) {
  return /(?:codex-command|runtime-codex|stdout|stderr|trace|raw|\.sciforge|[\\/]|authorization|api[_-]?key|token|secret|password|credential)/i.test(value);
}

function CursorAgentActionDetail({
  action,
  resultRefs,
  visibleRefs,
  onObjectFocus,
  onGuiCommand,
  locale,
}: {
  action: CursorAgentAction;
  resultRefs: string[];
  visibleRefs: string[];
  onObjectFocus?: (reference: ObjectReference) => void;
  onGuiCommand?: (commandText: string) => void;
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
      {action.commands.length ? (
        <ActionDetailSection title={chatText(locale, { 'zh-CN': '确认', 'en-US': 'Confirmation' })}>
          <CursorAgentCommandChoices choices={action.commands} onCommand={onGuiCommand} />
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
  const hiddenRefs = new Set<string>();
  if (action.kind === 'subagent' && action.transcriptRef) hiddenRefs.add(action.transcriptRef);
  if (action.kind !== 'diff') {
    if (action.fileRef) hiddenRefs.add(action.fileRef);
    if (action.diffRef) hiddenRefs.add(action.diffRef);
  }
  for (const ref of action.resultRefs) hiddenRefs.add(ref);
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

function CursorAgentCommandChoices({
  choices,
  onCommand,
}: {
  choices: CursorAgentAction['commands'];
  onCommand?: (commandText: string) => void;
}) {
  return (
    <div className="cursor-agent-command-choices">
      {choices.map((choice) => (
        <button
          type="button"
          key={`${choice.label}-${choice.commandText}`}
          className={cx('cursor-agent-command-choice', choice.style === 'danger' && 'danger', choice.style === 'primary' && 'primary')}
          onClick={() => onCommand?.(choice.commandText)}
        >
          {choice.label}
        </button>
      ))}
    </div>
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
  if (kind === 'verifier') return ShieldQuestion;
  if (kind === 'repair') return Wrench;
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
        <button
          type="button"
          className="cursor-agent-ref-button"
          data-object-kind={reference.kind}
          data-preferred-view={reference.preferredView}
          onClick={() => onObjectFocus(reference)}
        >
          {displayLabel}
        </button>
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
  if (action.kind === 'verifier') return chatText(locale, { 'zh-CN': '验证', 'en-US': 'Verification' });
  if (action.kind === 'repair') return chatText(locale, { 'zh-CN': '修复', 'en-US': 'Repair' });
  if (action.kind === 'artifact') return chatText(locale, { 'zh-CN': 'Artifact', 'en-US': 'Artifact' });
  if (action.kind === 'message') return chatText(locale, { 'zh-CN': '消息', 'en-US': 'Message' });
  if (action.kind === 'folded') return chatText(locale, { 'zh-CN': '已折叠', 'en-US': 'Folded' });
  return chatText(locale, { 'zh-CN': '动作', 'en-US': 'Action' });
}

function cursorActionStatusLabel(status: CursorAgentAction['status'], locale?: SupportedLocale) {
  if (status === 'running') return chatText(locale, { 'zh-CN': '运行中', 'en-US': 'running' });
  if (status === 'completed') return chatText(locale, { 'zh-CN': '完成', 'en-US': 'completed' });
  if (status === 'blocked') return chatText(locale, { 'zh-CN': '被阻止', 'en-US': 'blocked' });
  if (status === 'failed') return chatText(locale, { 'zh-CN': '失败', 'en-US': 'failed' });
  if (status === 'cancelled') return chatText(locale, { 'zh-CN': '已取消', 'en-US': 'cancelled' });
  return '';
}

function cursorActionAriaLabel(action: CursorAgentAction, locale?: SupportedLocale) {
  const kind = cursorActionKindLabel(action, locale);
  const status = cursorActionStatusLabel(action.status, locale) || chatText(locale, { 'zh-CN': '未知', 'en-US': 'unknown' });
  const title = action.title || action.summary || kind;
  return chatText(locale, {
    'zh-CN': `${kind}：${title}；状态：${status}`,
    'en-US': `${kind}: ${title}; status: ${status}`,
  });
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
