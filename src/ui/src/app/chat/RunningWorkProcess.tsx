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
  if (!worklog.entries.length && !guidanceCount && !usageLabel) return null;
  return (
    <div className="running-work-process">
      <NativeEventStream
        events={events}
        counts={counts}
        tokenUsage={tokenUsage}
        guidanceCount={guidanceCount}
        mode="live"
      />
    </div>
  );
}

export function NativeEventStream({
  events,
  counts,
  tokenUsage,
  guidanceCount = 0,
  mode = 'recorded',
  limit = 18,
}: {
  events: AgentStreamEvent[];
  counts?: ReturnType<typeof streamEventCounts>;
  tokenUsage?: AgentStreamEvent['usage'];
  guidanceCount?: number;
  mode?: 'live' | 'recorded';
  limit?: number;
}) {
  const resolvedCounts = counts ?? streamEventCounts(events);
  const usageLabel = formatAgentTokenUsage(tokenUsage);
  const visibleEntries = nativeStreamEntries(events, limit);
  const hiddenAuditCount = Math.max(0, events.length - visibleEntries.length);
  const progress = latestProgressModel(visibleEntries.map((entry) => entry.event));
  const activeId = visibleEntries.at(-1)?.event.id;
  if (!visibleEntries.length && !guidanceCount && !usageLabel) return null;
  return (
    <section className={cx('native-event-stream', mode === 'live' ? 'is-live' : 'is-recorded')} aria-label={mode === 'live' ? 'Backend native realtime stream' : 'Backend native stream replay'}>
      <div className="native-event-stream-head">
        <Badge variant={mode === 'live' ? 'success' : 'muted'}>{mode === 'live' ? 'live' : 'replay'}</Badge>
        <strong>{nativeBackendTitle(visibleEntries)}</strong>
        <span>{nativeStreamHeadline(progress, visibleEntries)}</span>
        {usageLabel ? <small>{usageLabel}</small> : null}
      </div>
      <div className="native-event-list">
        {visibleEntries.map((entry) => (
          <NativeEventRow
            key={`${entry.event.id}-${entry.event.createdAt}`}
            entry={entry}
            active={entry.event.id === activeId && mode === 'live'}
          />
        ))}
      </div>
      {(guidanceCount || resolvedCounts.debug || hiddenAuditCount) ? (
        <details className="native-event-audit-fold">
          <summary>
            <span>Audit</span>
            {guidanceCount ? <small>{guidanceCount} queued guidance</small> : null}
            {resolvedCounts.debug || hiddenAuditCount ? <small>{Math.max(resolvedCounts.debug, hiddenAuditCount)} folded low-level events</small> : null}
          </summary>
        </details>
      ) : null}
    </section>
  );
}

function nativeStreamEntries(events: AgentStreamEvent[], limit: number): StreamWorklogEntry[] {
  const entries = events
    .map((event) => worklogEntryForNativeEvent(event))
    .filter((entry) => nativeEventShouldRender(entry));
  const hasSubstantiveBackendEvents = entries.some((entry) => isSubstantiveNativeEvent(entry));
  const foreground = hasSubstantiveBackendEvents
    ? entries.filter((entry) => !isBackendPlaceholderEntry(entry))
    : compactBackendWaitPlaceholders(entries);
  return foreground
    .slice(-limit);
}

function worklogEntryForNativeEvent(event: AgentStreamEvent): StreamWorklogEntry {
  const entry = presentStreamWorklog([event], { limit: 1 }).entries[0];
  if (entry) return entry;
  const presentation = presentStreamEvent(event);
  return {
    event,
    presentation,
    operationKind: 'diagnostic',
    operationLine: presentation.detail || presentation.shortDetail || event.detail || presentation.typeLabel,
    rawOutput: '',
    rawInitiallyCollapsed: true,
  };
}

function nativeEventShouldRender(entry: StreamWorklogEntry) {
  const type = (backendRawType(entry.event) || entry.event.type).toLowerCase();
  if (entry.presentation.importance === 'debug') return false;
  if (type === 'audit' || type.includes('raw_jsonl') || type.includes('stderr')) return false;
  if (isBackendGenericLifecyclePlaceholder(entry)) return false;
  if (isBackendGenericWrapperPlaceholder(entry)) return false;
  return Boolean(nativeEventDetail(entry) || entry.presentation.usageDetail || entry.event.label);
}

function isSubstantiveNativeEvent(entry: StreamWorklogEntry) {
  if (isBackendPlaceholderEntry(entry)) return false;
  const type = (backendRawType(entry.event) || entry.event.type).toLowerCase();
  return [
    'thread_started',
    'turn_started',
    'run_started',
    'item_started',
    'text-delta',
    'message_delta',
    'assistant_delta',
    'message',
    'tool-call',
    'tool_started',
    'tool-result',
    'tool_completed',
    'human-approval-required',
    'approval_requested',
    'gui_ask_user',
    'control_request',
    'done',
    'failed',
    'cancelled',
  ].some((candidate) => type === candidate || type.includes(candidate));
}

function isBackendWaitPlaceholder(entry: StreamWorklogEntry) {
  const type = (backendRawType(entry.event) || entry.event.type).toLowerCase();
  if (type === 'backend-silent' || type === 'silent-stream-wait') return true;
  if (backendWaitPlaceholderText(entry)) return true;
  if (type !== 'process-progress' && type !== 'operation_progress' && type !== 'status') return false;
  return isSilentWaitEntry(entry);
}

function isBackendPlaceholderEntry(entry: StreamWorklogEntry) {
  return isBackendWaitPlaceholder(entry) || isBackendGenericProgressPlaceholder(entry);
}

function isBackendGenericLifecyclePlaceholder(entry: StreamWorklogEntry) {
  const type = (backendRawType(entry.event) || entry.event.type).toLowerCase();
  if (type !== 'tool_started' && type !== 'tool_completed' && type !== 'tool-call' && type !== 'tool-result') return false;
  if (nativeToolName(entry.event) || backendLifecycleField(entry.event, 'command') || backendLifecycleField(entry.event, 'outputSummary')) return false;
  const detail = normalizeTimelineText([
    nativeStringField(entry.event, 'message'),
    nativeStringField(entry.event, 'text'),
    entry.event.detail,
    entry.presentation.detail,
    entry.presentation.shortDetail,
  ].filter(Boolean).join(' '));
  return /^(?:tool started\.?\s*)+(?:backend tool)?$/.test(detail)
    || /^(?:tool completed\.?\s*)+(?:backend result|backend tool)?$/.test(detail);
}

function isBackendGenericProgressPlaceholder(entry: StreamWorklogEntry) {
  const type = (backendRawType(entry.event) || entry.event.type).toLowerCase();
  if (type !== 'process-progress' && type !== 'operation_progress' && type !== 'status') return false;
  if (backendProgressHasFacts(entry.event)) return false;
  const detail = normalizeTimelineText(nativeEventDetail(entry) || compactRunningLine(entry) || entry.presentation.detail || entry.presentation.shortDetail || entry.event.label || '');
  return detail === '' || detail === '进展' || detail === 'progress' || detail === 'status' || detail === 'backend progress';
}

function isBackendGenericWrapperPlaceholder(entry: StreamWorklogEntry) {
  if (entry.structured || entry.presentation.usageDetail) return false;
  const type = (backendRawType(entry.event) || entry.event.type).toLowerCase();
  const detail = normalizeTimelineText(nativeEventDetail(entry) || entry.presentation.detail || entry.presentation.shortDetail || '');
  if ((type === 'workspace-runtime-event' || type === 'workspace_runtime_event') && (!detail || detail === 'workspace runtime')) return true;
  if (type === 'contextwindowstate' || type === 'context-window-state') {
    const status = entry.event.contextWindowState?.status;
    return status !== 'near-limit' && status !== 'exceeded' && (!detail || detail === '上下文窗口' || detail === 'context window');
  }
  return false;
}

function backendLifecycleField(event: AgentStreamEvent, key: 'command' | 'outputSummary') {
  return nativeStringField(event, key);
}

function backendProgressHasFacts(event: AgentStreamEvent) {
  const raw = isRecord(event.raw) ? event.raw : {};
  const native = isRecord(raw.native) ? raw.native : raw;
  const progress = isRecord(raw.progress)
    ? raw.progress
    : isRecord(native.progress)
      ? native.progress
      : {};
  return Boolean(
    stringField(progress.phase)
    || stringField(progress.title)
    || stringField(progress.detail)
    || stringField(progress.waitingFor)
    || stringField(progress.nextStep)
    || (Array.isArray(progress.reading) && progress.reading.length)
    || (Array.isArray(progress.writing) && progress.writing.length),
  );
}

function compactBackendWaitPlaceholders(entries: StreamWorklogEntry[]) {
  const waits = entries.filter((entry) => isBackendPlaceholderEntry(entry));
  if (!waits.length) return entries;
  return [
    ...entries.filter((entry) => !isBackendPlaceholderEntry(entry)),
    waits.at(-1)!,
  ];
}

export function visibleRunningWorkEntries(worklog: StreamWorklogPresentation, limit = 5): StreamWorklogEntry[] {
  const operationEntries = compactTimelineEntries(worklog.entries
    .filter((entry) => entry.operationLine && isVisibleRunningWorkKind(entry.operationKind)));
  const entries = operationEntries.length
    ? operationEntries
    : compactTimelineEntries(worklog.entries.filter((entry) => entry.presentation.visibleInRunningMessage));
  return keepTimelineAnchors(entries, limit);
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

function NativeEventRow({ entry, active }: { entry: StreamWorklogEntry; active: boolean }) {
  const presentation = entry.presentation;
  const lifecycle = nativeLifecyclePresentation(entry);
  const detail = nativeEventDetail(entry) || compactRunningLine(entry) || presentation.shortDetail || presentation.detail || presentation.typeLabel;
  const expandedDetail = nativeEventExpandedDetail(entry);
  const hasExpandedContent = Boolean(entry.structured || expandedDetail || presentation.detail || presentation.usageDetail);
  const open = lifecycle
    ? active && lifecycle.running
    : isNativeApprovalEvent(entry) || (active && nativeEventIsRunning(entry));
  return (
    <details
      className={cx('native-event-row', presentation.uiClass, active && 'active')}
      open={open}
    >
      <summary>
        <span className="native-event-dot" aria-hidden="true" />
        <span className="native-event-kind">{nativeEventKindLabel(entry)}</span>
        <span className="native-event-title">{shortSummaryText(detail, active ? 180 : 132)}</span>
        {presentation.usageDetail ? <span className="native-event-usage">{presentation.usageDetail}</span> : null}
        <time>{formatEventTime(entry.event.createdAt)}</time>
      </summary>
      {hasExpandedContent ? (
        <div className="native-event-expanded">
          {entry.structured ? <StructuredWorkEventFacts entry={entry} /> : null}
          {expandedDetail || presentation.detail ? <pre>{expandedDetail || presentation.detail}</pre> : null}
          {!expandedDetail && !presentation.detail && presentation.usageDetail ? <pre>{presentation.usageDetail}</pre> : null}
        </div>
      ) : null}
    </details>
  );
}

function nativeStreamHeadline(
  progress: ProcessProgressModel | undefined,
  entries: StreamWorklogEntry[],
) {
  if (progress) return formatProgressHeadline(progress, entries.at(-1) ? nativeEventDetail(entries.at(-1)!) : undefined) || progress.title;
  const latest = entries.at(-1);
  if (latest) return `${nativeEventKindLabel(latest)} · ${shortSummaryText(nativeEventDetail(latest), 120)}`;
  return 'waiting for backend events';
}

function nativeEventKindLabel(entry: StreamWorklogEntry) {
  const lifecycle = nativeLifecyclePresentation(entry);
  if (lifecycle) return lifecycle.kindLabel;
  const type = (backendRawType(entry.event) || entry.event.type).toLowerCase();
  const backend = backendName(entry.event);
  const toolName = (nativeToolName(entry.event) || '').toLowerCase();
  if (type === 'thread_started') return `${backend} thread`;
  if (type === 'turn_started' || type === 'run_started') return `${backend} turn`;
  if (type === 'text-delta' || type === 'message_delta' || type === 'assistant_delta') return `${backend} assistant`;
  if (type === 'message') return `${backend} message`;
  if (type === 'tool-call' || type === 'tool_started') return toolName === 'shell' || toolName === 'command_execution' ? `${backend} shell` : `${backend} tool`;
  if (type === 'tool-result' || type === 'tool_completed') return toolName === 'shell' || toolName === 'command_execution' ? `${backend} shell result` : `${backend} result`;
  if (type === 'human-approval-required' || type === 'approval_requested' || type === 'gui_ask_user' || type === 'control_request') return `${backend} approval`;
  if (type === 'process-progress' || type === 'operation_progress') return `${backend} progress`;
  if (type.includes('error') || type.includes('failed')) return 'Error';
  if (type.includes('done') || type.includes('completed')) return 'Done';
  return entry.presentation.typeLabel || type;
}

function nativeBackendTitle(entries: StreamWorklogEntry[]) {
  const backend = entries.map((entry) => backendName(entry.event)).find((value) => value !== 'Backend');
  return `${backend ?? 'Backend'} native stream`;
}

function nativeEventDetail(entry: StreamWorklogEntry) {
  const lifecycle = nativeLifecyclePresentation(entry);
  if (lifecycle) return lifecycle.summary;
  const raw = isRecord(entry.event.raw) ? entry.event.raw : {};
  const native = isRecord(raw.native) ? raw.native : raw;
  const toolName = nativeToolName(entry.event);
  const status = nativeStringField(entry.event, 'status');
  const command = nativeStringField(entry.event, 'command');
  const outputSummary = nativeStringField(entry.event, 'outputSummary');
  const text = stringField(native.text)
    ?? stringField(raw.text)
    ?? stringField(native.message)
    ?? stringField(raw.message)
    ?? entry.presentation.detail
    ?? entry.presentation.shortDetail
    ?? entry.event.detail
    ?? '';
  const type = (backendRawType(entry.event) || entry.event.type).toLowerCase();
  if ((type === 'tool_started' || type === 'tool-call') && (command || toolName)) return [command || toolName, status].filter(Boolean).join(' · ');
  if ((type === 'tool_completed' || type === 'tool-result') && (command || toolName)) return [command || toolName, status || 'completed', outputSummary || text].filter(Boolean).join(' · ');
  if ((type === 'approval_requested' || type === 'human-approval-required' || type === 'gui_ask_user') && text) return text;
  return text;
}

function nativeEventExpandedDetail(entry: StreamWorklogEntry) {
  return nativeLifecyclePresentation(entry)?.expanded;
}

function nativeEventIsRunning(entry: StreamWorklogEntry) {
  const lifecycle = nativeLifecyclePresentation(entry);
  if (lifecycle) return lifecycle.running;
  const type = (backendRawType(entry.event) || entry.event.type).toLowerCase();
  const status = nativeStringField(entry.event, 'status')?.toLowerCase();
  return type.includes('started') || status === 'running' || status === 'in_progress' || status === 'started';
}

function isNativeApprovalEvent(entry: StreamWorklogEntry) {
  const type = (backendRawType(entry.event) || entry.event.type).toLowerCase();
  return type === 'approval_requested'
    || type === 'human-approval-required'
    || type === 'gui_ask_user'
    || type === 'control_request';
}

function nativeLifecyclePresentation(entry: StreamWorklogEntry) {
  const type = (backendRawType(entry.event) || entry.event.type).toLowerCase();
  if (type !== 'tool_started' && type !== 'tool_completed' && type !== 'tool-call' && type !== 'tool-result') return undefined;
  const started = type === 'tool_started' || type === 'tool-call';
  const completed = type === 'tool_completed' || type === 'tool-result';
  const backend = backendName(entry.event);
  const toolName = nativeToolName(entry.event);
  const command = nativeStringField(entry.event, 'command');
  const outputSummary = nativeStringField(entry.event, 'outputSummary') ?? nativeStringField(entry.event, 'output_summary');
  const status = nativeStringField(entry.event, 'status');
  const exitCode = nativeNumberField(entry.event, 'exitCode') ?? nativeNumberField(entry.event, 'exit_code');
  const rawText = nativeLifecycleRawText(entry);
  const action = nativeLifecycleAction(toolName, command, rawText);
  const target = action === 'file-edit'
    ? nativeEditedFileTarget(rawText) ?? command ?? toolName ?? 'workspace file'
    : action === 'subagent'
      ? nativeSubagentTarget(rawText) ?? toolName ?? 'sub agent'
      : action === 'command'
        ? (command ?? rawText) || toolName || 'command'
        : rawText || toolName || 'tool';
  const running = started && !nativeStatusIsTerminal(status);
  const failed = nativeStatusIsFailure(status) || (typeof exitCode === 'number' && exitCode !== 0);
  const terminalParts = [
    status && !running ? `status=${status}` : undefined,
    exitCode !== undefined && exitCode !== null ? `exit=${exitCode}` : undefined,
  ].filter(Boolean);
  const outputLine = outputSummary ? `Output: ${outputSummary}` : undefined;

  if (action === 'command') {
    const kindLabel = failed ? `${backend} 命令失败` : completed ? `${backend} 命令完成` : `${backend} 正在运行命令`;
    const summary = completed
      ? [`已完成：${target}`, ...terminalParts].filter(Boolean).join(' · ')
      : `正在运行：${target}`;
    return {
      kindLabel,
      summary,
      expanded: [`Command: ${target}`, terminalParts.join(', '), outputLine].filter(Boolean).join('\n'),
      running,
    };
  }

  if (action === 'file-edit') {
    const kindLabel = failed ? `${backend} 编辑失败` : completed ? `${backend} 已编辑` : `${backend} 正在编辑`;
    const summary = completed
      ? [`已编辑：${target}`, ...terminalParts].filter(Boolean).join(' · ')
      : `正在编辑：${target}`;
    return {
      kindLabel,
      summary,
      expanded: [`File edit: ${target}`, command ? `Command: ${command}` : undefined, terminalParts.join(', '), outputLine].filter(Boolean).join('\n'),
      running,
    };
  }

  if (action === 'subagent') {
    const kindLabel = failed ? `${backend} sub agent 失败` : completed ? `${backend} sub agent 完成` : `${backend} 正在创建 sub agent`;
    const summary = completed
      ? [`sub agent 完成：${target}`, ...terminalParts].filter(Boolean).join(' · ')
      : `正在创建 sub agent：${target}`;
    return {
      kindLabel,
      summary,
      expanded: [`Sub agent: ${target}`, command ? `Command: ${command}` : undefined, terminalParts.join(', '), outputLine].filter(Boolean).join('\n'),
      running,
    };
  }

  const kindLabel = failed ? `${backend} tool failed` : completed ? `${backend} result` : `${backend} tool`;
  const summary = completed
    ? [target, ...terminalParts, outputSummary].filter(Boolean).join(' · ')
    : rawText || `${toolName ?? 'tool'} running${status ? ` · ${status}` : ''}`;
  return {
    kindLabel,
    summary,
    expanded: [`Tool: ${toolName ?? 'tool'}`, rawText && rawText !== toolName ? rawText : undefined, command ? `Command: ${command}` : undefined, terminalParts.join(', '), outputLine].filter(Boolean).join('\n'),
    running,
  };
}

function nativeLifecycleAction(toolName: string | undefined, command: string | undefined, text: string): 'command' | 'file-edit' | 'subagent' | 'tool' {
  const haystack = `${toolName ?? ''}\n${command ?? ''}\n${text}`.toLowerCase();
  if (/\b(?:multi_agent_v1\.spawn_agent|spawn_agent|subagent|sub-agent|sub agent)\b/.test(haystack)) return 'subagent';
  if (/\b(?:apply_patch|write_file|edit_file|create_file|delete_file|move_file|file_write)\b|(?:\*\*\* (?:update|add|delete) file:)|\b(?:edited|created|modified|patched)\s+[\w./-]+/i.test(haystack)) return 'file-edit';
  if (/^(?:shell|command_execution|exec|terminal|bash|run_command|exec_command)$/i.test(toolName ?? '') || command) return 'command';
  return 'tool';
}

function nativeLifecycleRawText(entry: StreamWorklogEntry) {
  return [
    nativeStringField(entry.event, 'message'),
    nativeStringField(entry.event, 'text'),
    nativeStringField(entry.event, 'detail'),
    entry.presentation.detail,
    entry.presentation.shortDetail,
    entry.event.detail,
    entry.event.label,
  ].filter(Boolean).join('\n');
}

function nativeEditedFileTarget(text: string) {
  const match = text.match(/^\s*\*\*\* (?:Update|Add|Delete) File:\s*(.+)$/mi)
    ?? text.match(/\b(?:path|file|target)\s*[:=]\s*["']?([^"',\n\r)]+)["']?/i)
    ?? text.match(/\b(?:edited|created|modified|patched|wrote)\s+([./\w-]+\.[\w.-]+)/i);
  return match?.[1]?.trim();
}

function nativeSubagentTarget(text: string) {
  const match = text.match(/\b(?:agent|subagent|sub-agent)\s*(?:id|name|target)?\s*[:=]\s*["']?([A-Za-z0-9_.:-]{3,})/i)
    ?? text.match(/\b(?:worker|explorer)\s+([A-Za-z0-9_.:-]{3,})/i);
  return match?.[1]?.trim();
}

function nativeStatusIsTerminal(status: string | undefined) {
  return /^(?:completed|done|success|succeeded|failed|error|cancelled|canceled|rejected)$/i.test(status ?? '');
}

function nativeStatusIsFailure(status: string | undefined) {
  return /^(?:failed|error|cancelled|canceled|rejected)$/i.test(status ?? '');
}

function backendRawType(event: AgentStreamEvent) {
  const raw = isRecord(event.raw) ? event.raw : {};
  const native = isRecord(raw.native) ? raw.native : raw;
  const nestedRaw = isRecord(raw.raw) ? raw.raw : {};
  const nestedEvent = isRecord(nestedRaw.event) ? nestedRaw.event : {};
  return stringField(native.rawType)
    ?? stringField(native.type)
    ?? stringField(raw.rawType)
    ?? stringField(raw.type)
    ?? stringField(nestedEvent.type);
}

function nativeToolName(event: AgentStreamEvent) {
  const raw = isRecord(event.raw) ? event.raw : {};
  const native = isRecord(raw.native) ? raw.native : raw;
  const nestedRaw = isRecord(raw.raw) ? raw.raw : {};
  const nestedEvent = isRecord(nestedRaw.event) ? nestedRaw.event : {};
  return stringField(native.toolName) ?? stringField(raw.toolName) ?? stringField(nestedEvent.toolName);
}

function nativeStringField(event: AgentStreamEvent, key: string): string | undefined {
  const raw = isRecord(event.raw) ? event.raw : {};
  const native = isRecord(raw.native) ? raw.native : raw;
  const nestedRaw = isRecord(raw.raw) ? raw.raw : {};
  const nestedEvent = isRecord(nestedRaw.event) ? nestedRaw.event : {};
  return stringField(native[key]) ?? stringField(raw[key]) ?? stringField(nestedEvent[key]);
}

function nativeNumberField(event: AgentStreamEvent, key: string): number | null | undefined {
  const raw = isRecord(event.raw) ? event.raw : {};
  const native = isRecord(raw.native) ? raw.native : raw;
  const nestedRaw = isRecord(raw.raw) ? raw.raw : {};
  const nestedEvent = isRecord(nestedRaw.event) ? nestedRaw.event : {};
  return numberField(native[key]) ?? numberField(raw[key]) ?? numberField(nestedEvent[key]);
}

function backendName(event: AgentStreamEvent) {
  const raw = isRecord(event.raw) ? event.raw : {};
  const native = isRecord(raw.native) ? raw.native : raw;
  const backend = stringField(native.backend) ?? stringField(raw.backend);
  if (backend === 'claude-stream-json') return 'Claude';
  if (backend === 'codex-exec-json') return 'Codex CLI';
  if (backend === 'codex-app-server') return 'Codex';
  if (stringField(raw.schemaVersion)?.startsWith('sciforge.codex.')) return 'Codex';
  return 'Backend';
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberField(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
