import type { AgentStreamEvent } from '../../domain';
import { presentStreamEvent, presentStreamWorklog } from '../../streamEventPresentation';
import type { StreamWorklogEntry } from '../../streamEventPresentation';
import { progressModelFromEvent } from '../../processProgress';
import type { SupportedLocale } from '../../i18n';
import { chatCount, chatText } from './chatI18n';

export type CursorAgentActionKind =
  | 'read'
  | 'search'
  | 'shell_command'
  | 'file_edit'
  | 'diff'
  | 'thought'
  | 'approval'
  | 'subagent'
  | 'fetch'
  | 'write'
  | 'validate'
  | 'artifact'
  | 'message'
  | 'folded'
  | 'other';

export type CursorAgentActionStatus = 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled' | 'unknown';
export type CursorAgentGroupKind = 'worked' | 'explored';

export interface CursorAgentAction {
  id: string;
  kind: CursorAgentActionKind;
  status: CursorAgentActionStatus;
  title: string;
  summary: string;
  detail: string;
  command?: string;
  cwd?: string;
  exitCode?: number | null;
  outputSummary?: string;
  stdoutRef?: string;
  stderrRef?: string;
  diff?: string;
  diffRef?: string;
  fileRef?: string;
  filePath?: string;
  transcriptRef?: string;
  agentId?: string;
  parentAgentId?: string;
  resultSummary?: string;
  resultRefs: string[];
  foldedGroupKind?: CursorAgentGroupKind;
  foldedActionCount?: number;
  runId?: string;
  itemId?: string;
  traceStepId?: string;
  refs: string[];
  createdAt: string;
  initiallyExpanded: boolean;
}

export interface CursorAgentProcessGroup {
  id: string;
  kind: CursorAgentGroupKind;
  status: CursorAgentActionStatus;
  title: string;
  summary: string;
  actions: CursorAgentAction[];
  initiallyExpanded: boolean;
}

export interface CursorAgentProcessModel {
  groups: CursorAgentProcessGroup[];
  latestProgressSentence: string;
  hiddenActionCount: number;
  hiddenAuditCount: number;
}

export function buildCursorAgentProcessModel(
  events: AgentStreamEvent[],
  options: { mode?: 'live' | 'recorded'; limit?: number; now?: string; locale?: SupportedLocale; sourceRunId?: string } = {},
): CursorAgentProcessModel {
  const mode = options.mode ?? 'recorded';
  const locale = options.locale;
  const { entries, allEntries, hiddenActionCount, hiddenAuditCount } = cursorAgentActionsForEvents(events, options.limit ?? 48);
  const safePromptFileTargets = filePreviewFallbackTargetsFromEvents(events);
  const visibleActions = applyMissingFilePreviewFallbacks(
    compactCursorActions(entries.map((entry) => actionFromEntry(entry, mode, locale, options.sourceRunId)).filter((action) => action.title || action.summary), locale),
    safePromptFileTargets,
    locale,
  );
  const allActions = applyMissingFilePreviewFallbacks(
    compactCursorActions(allEntries.map((entry) => actionFromEntry(entry, mode, locale, options.sourceRunId)).filter((action) => action.title || action.summary), locale),
    safePromptFileTargets,
    locale,
  );
  const actions = insertFoldedCursorActionPlaceholders(visibleActions, allActions, locale);
  const groups = groupActionsChronologically(actions, mode, events, options.now, allActions, locale);
  return {
    groups,
    latestProgressSentence: latestCursorProgressSentence(actions, events),
    hiddenActionCount,
    hiddenAuditCount,
  };
}

function groupActionsChronologically(
  actions: CursorAgentAction[],
  mode: 'live' | 'recorded',
  events: AgentStreamEvent[],
  now?: string,
  summaryActions: CursorAgentAction[] = actions,
  locale?: SupportedLocale,
) {
  const segments: Array<{ kind: CursorAgentGroupKind; actions: CursorAgentAction[] }> = [];
  for (const action of actions) {
    const kind = actionBelongsToGroup(action);
    const previous = segments.at(-1);
    if (previous?.kind === kind) {
      previous.actions.push(action);
      continue;
    }
    segments.push({ kind, actions: [action] });
  }
  return segments
    .map((segment, index) => groupFromActions(
      segment.kind,
      segment.actions,
      mode,
      events,
      now,
      index,
      summaryActions.filter((action) => actionBelongsToGroup(action) === segment.kind),
      locale,
    ))
    .filter((group): group is CursorAgentProcessGroup => Boolean(group && group.actions.length));
}

function cursorAgentActionsForEvents(events: AgentStreamEvent[], limit: number): {
  entries: StreamWorklogEntry[];
  allEntries: StreamWorklogEntry[];
  hiddenActionCount: number;
  hiddenAuditCount: number;
} {
  const entries = events
    .map((event) => presentStreamWorklog([event], { limit: 1 }).entries[0] ?? fallbackWorklogEntry(event))
    .filter((entry) => cursorEntryShouldRender(entry));
  const renderableEvents = new Set(entries.map((entry) => entry.event.id));
  const hasSubstantiveEntries = entries.some((entry) => !isWaitPlaceholder(entry) && !isGenericProgressPlaceholder(entry));
  const foreground = hasSubstantiveEntries
    ? entries.filter((entry) => !isWaitPlaceholder(entry) && !isGenericProgressPlaceholder(entry))
    : [];
  const compacted = compactCursorEntries(foreground);
  const limited = keepCursorTimelineAnchors(compacted, limit);
  return {
    entries: limited,
    allEntries: compacted,
    hiddenActionCount: Math.max(0, compacted.length - limited.length),
    hiddenAuditCount: Math.max(0, events.length - renderableEvents.size),
  };
}

function fallbackWorklogEntry(event: AgentStreamEvent): StreamWorklogEntry {
  const presentation = presentStreamEvent(event);
  return {
    event,
    presentation,
    operationKind: 'other',
    operationLine: presentation.shortDetail || presentation.detail || event.detail || presentation.typeLabel,
    rawOutput: '',
    rawInitiallyCollapsed: true,
  };
}

function cursorEntryShouldRender(entry: StreamWorklogEntry): boolean {
  const type = rawType(entry.event);
  if (entry.presentation.importance === 'debug' && !hasNativeLifecycleContent(entry.event)) return false;
  if (type === 'audit' || type.includes('raw_jsonl') || type === 'stderr') return false;
  if (isUserPromptEchoEvent(entry)) return false;
  if (isPromptCommandEchoEvent(entry)) return false;
  if (isPromptLikeGenericReadAction(entry)) return false;
  if (isPromptLikeNonWorkAction(entry)) return false;
  if (isInstructionEchoOnlyToolEvent(entry)) return false;
  if (isLowValueToolLifecyclePlaceholder(entry)) return false;
  if (isAssistantTranscriptEvent(entry)) return false;
  if (isGenericLifecyclePlaceholder(entry)) return false;
  if (isRuntimeLifecyclePlaceholder(entry)) return false;
  if (isRuntimeMetadataPlaceholder(entry)) return false;
  return Boolean(cursorEntryText(entry) || entry.presentation.usageDetail || entry.event.label);
}

function compactCursorEntries(entries: StreamWorklogEntry[]) {
  const compacted: StreamWorklogEntry[] = [];
  for (const entry of entries) {
    const key = cursorEntryDedupeKey(entry);
    const previous = compacted.at(-1);
    if (previous && cursorEntryDedupeKey(previous) === key) {
      compacted[compacted.length - 1] = entry;
      continue;
    }
    compacted.push(entry);
  }
  return compacted;
}

function keepCursorTimelineAnchors(entries: StreamWorklogEntry[], limit: number) {
  if (entries.length <= limit) return entries;
  const selected = new Set<number>();
  const anchorKinds = new Set<CursorAgentActionKind>(['search', 'fetch', 'read', 'file_edit', 'write', 'artifact', 'approval', 'subagent']);
  selected.add(0);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    const command = sanitizeCursorText(nativeString(entry.event, 'command') ?? commandTextFromEntry(entry));
    const kind = actionKindForEntry(entry, rawType(entry.event), nativeString(entry.event, 'toolName'), command);
    if (!anchorKinds.has(kind)) continue;
    if ([...selected].some((candidateIndex) => {
      const candidate = entries[candidateIndex];
      if (!candidate) return false;
      const candidateCommand = sanitizeCursorText(nativeString(candidate.event, 'command') ?? commandTextFromEntry(candidate));
      return actionKindForEntry(candidate, rawType(candidate.event), nativeString(candidate.event, 'toolName'), candidateCommand) === kind;
    })) continue;
    selected.add(index);
  }
  const tailRoom = Math.max(0, limit - selected.size);
  const tailStart = Math.max(0, entries.length - tailRoom);
  for (let index = tailStart; index < entries.length; index += 1) selected.add(index);
  return [...selected]
    .sort((left, right) => left - right)
    .slice(0, limit)
    .map((index) => entries[index])
    .filter((entry): entry is StreamWorklogEntry => Boolean(entry));
}

function actionFromEntry(entry: StreamWorklogEntry, mode: 'live' | 'recorded', locale?: SupportedLocale, sourceRunId?: string): CursorAgentAction {
  const event = entry.event;
  const type = rawType(event);
  const toolName = nativeString(event, 'toolName');
  const command = sanitizeCursorText(nativeString(event, 'command') ?? commandTextFromEntry(entry));
  const actionKind = actionKindForEntry(entry, type, toolName, command);
  const fileTarget = sanitizeCursorPath(fileTargetForEntry(event, entry, actionKind, command));
  const rawOutputSummary = sanitizeCursorText(nativeString(event, 'outputSummary') ?? nativeString(event, 'output_summary'));
  const exitCode = nativeNumber(event, 'exitCode') ?? nativeNumber(event, 'exit_code');
  const stdoutRef = sanitizeCursorRef(nativeString(event, 'stdoutRef') ?? nativeString(event, 'stdout_ref'));
  const stderrRef = sanitizeCursorRef(nativeString(event, 'stderrRef') ?? nativeString(event, 'stderr_ref'));
  const diffRef = sanitizeCursorDiffRef(nativeString(event, 'diffRef') ?? nativeString(event, 'diff_ref'));
  const diffSource = nativeString(event, 'diff') ?? nativeString(event, 'patch') ?? diffTextFromNativeOutput(event, actionKind);
  const outputSummary = actionKind === 'subagent'
    ? cleanSubagentActionSummary(rawOutputSummary)
    : diffSource && looksLikeDiffSummary(rawOutputSummary) ? undefined : cleanCursorActionSummary(rawOutputSummary);
  const status = actionStatus(event, type, { actionKind, command, exitCode, diffSource });
  const diff = boundedBlockDetail(diffSource);
  const stdout = stdoutRef || diff ? undefined : boundedBlockDetail(nativeString(event, 'stdout'));
  const stderr = stderrRef ? undefined : boundedBlockDetail(nativeString(event, 'stderr'));
  const transcriptRef = sanitizeCursorRef(nativeString(event, 'transcriptRef') ?? nativeString(event, 'transcript_ref'));
  const agentId = sanitizeCursorIdentifier(nativeString(event, 'agentId') ?? nativeString(event, 'agent_id'));
  const parentAgentId = sanitizeCursorIdentifier(nativeString(event, 'parentAgentId') ?? nativeString(event, 'parent_agent_id'));
  const runId = sanitizeCursorIdentifier(nativeString(event, 'runId') ?? nativeString(event, 'run_id') ?? sourceRunId);
  const rawResultSummary = sanitizeCursorText(nativeString(event, 'resultSummary') ?? nativeString(event, 'result_summary') ?? nativeString(event, 'summary'));
  const resultSummary = actionKind === 'subagent'
    ? cleanSubagentActionSummary(rawResultSummary)
    : cleanCursorActionSummary(rawResultSummary);
  const resultRefs = resultRefsForEvent(event);
  const itemId = sanitizeCursorIdentifier(nativeString(event, 'itemId') ?? nativeString(event, 'item_id'));
  const traceStepId = sanitizeCursorIdentifier(nativeString(event, 'traceStepId') ?? nativeString(event, 'trace_step_id'));
  const fileRef = filePreviewRefForEntry(event, actionKind, command);
  const refs = uniqueStrings([
    stdoutRef,
    stderrRef,
    diffRef,
    transcriptRef,
    sanitizeCursorObjectPreviewRef(nativeString(event, 'ref')),
    fileRef,
    ...resultRefs,
    ...nativeStringList(event, 'refs').map(sanitizeCursorRef),
  ]);
  const detail = detailForAction(entry, {
    actionKind,
    command,
    outputSummary,
    exitCode,
    stdoutRef,
    stderrRef,
    diffRef,
    diff,
    stdout,
    stderr,
    transcriptRef,
    resultSummary,
  });
  const title = actionTitle(actionKind, {
    target: actionTarget(entry, actionKind, command, fileTarget, { agentId, resultSummary }, locale),
    status,
    outputSummary,
    exitCode,
  }, locale);
  return {
    id: event.id,
    kind: actionKind,
    status,
    title,
    summary: title,
    detail,
    command,
    cwd: sanitizeCursorPath(nativeString(event, 'cwd') ?? nativeString(event, 'workingDirectory') ?? nativeString(event, 'working_directory')),
    exitCode,
    outputSummary,
    stdoutRef,
    stderrRef,
    diff,
    diffRef,
    fileRef,
    filePath: fileTarget,
    transcriptRef,
    agentId,
    parentAgentId,
    resultSummary,
    resultRefs,
    runId,
    itemId,
    traceStepId,
    refs,
    createdAt: event.createdAt,
    initiallyExpanded: mode === 'live' && (status === 'running' || actionKind === 'approval'),
  };
}

function compactCursorActions(actions: CursorAgentAction[], locale?: SupportedLocale) {
  const compacted: CursorAgentAction[] = [];
  const lifecycleIndexes = new Map<string, number>();
  for (const action of actions) {
    const key = cursorActionLifecycleKey(action);
    const previousIndex = key ? lifecycleIndexes.get(key) : undefined;
    if (previousIndex !== undefined) {
      const previous = compacted[previousIndex];
      if (previous && canMergeCursorActionLifecycle(previous, action)) {
        compacted[previousIndex] = mergeCursorActionLifecycle(previous, action, locale);
        continue;
      }
    }
    const nextIndex = compacted.length;
    compacted.push(action);
    if (key) lifecycleIndexes.set(key, nextIndex);
  }
  return compacted;
}

function applyMissingFilePreviewFallbacks(
  actions: CursorAgentAction[],
  fallbackTargets: string[],
  locale?: SupportedLocale,
) {
  if (!fallbackTargets.length) return actions;
  let cursor = 0;
  return actions.map((action) => {
    if (!isFilePreviewActionKind(action.kind) || action.fileRef || action.filePath) return action;
    const target = fallbackTargets[cursor];
    if (!target) return action;
    cursor += 1;
    const fileRef = fileRefFromStructuredPath(target);
    if (!fileRef) return action;
    const title = actionTitle(action.kind, {
      target,
      status: action.status,
      outputSummary: action.outputSummary,
      exitCode: action.exitCode,
    }, locale);
    return {
      ...action,
      title,
      summary: title,
      filePath: target,
      fileRef,
      refs: uniqueStrings([...action.refs, fileRef]),
    };
  });
}

function insertFoldedCursorActionPlaceholders(
  visibleActions: CursorAgentAction[],
  allActions: CursorAgentAction[],
  locale?: SupportedLocale,
) {
  if (visibleActions.length >= allActions.length) return visibleActions;
  const visibleIds = new Set(visibleActions.map((action) => action.id));
  const output: CursorAgentAction[] = [];
  let pendingFolded: CursorAgentAction[] = [];
  for (const action of allActions) {
    if (!visibleIds.has(action.id)) {
      pendingFolded.push(action);
      continue;
    }
    if (pendingFolded.length) {
      output.push(foldedCursorActionPlaceholder(pendingFolded, action.createdAt, locale));
      pendingFolded = [];
    }
    output.push(action);
  }
  if (pendingFolded.length) {
    output.push(foldedCursorActionPlaceholder(pendingFolded, allActions.at(-1)?.createdAt ?? new Date(0).toISOString(), locale));
  }
  return output;
}

function foldedCursorActionPlaceholder(actions: CursorAgentAction[], createdAt: string, locale?: SupportedLocale): CursorAgentAction {
  const groupKind = foldedGroupKind(actions);
  const count = actions.length;
  const title = chatText(locale, {
    'zh-CN': `已隐藏 ${count} 个较早动作`,
    'en-US': `${count} earlier ${count === 1 ? 'action' : 'actions'} hidden`,
  });
  return {
    id: `folded-${groupKind}-${createdAt}-${count}`,
    kind: 'folded',
    status: 'unknown',
    title,
    summary: title,
    detail: '',
    resultRefs: [],
    foldedGroupKind: groupKind,
    foldedActionCount: count,
    refs: [],
    createdAt,
    initiallyExpanded: false,
  };
}

function foldedGroupKind(actions: CursorAgentAction[]): CursorAgentGroupKind {
  const exploredCount = actions.filter((action) => actionBelongsToGroup(action) === 'explored').length;
  return exploredCount > actions.length / 2 ? 'explored' : 'worked';
}

function cursorActionLifecycleKey(action: CursorAgentAction) {
  const explicit = action.kind === 'subagent'
    ? action.itemId ?? action.traceStepId ?? action.agentId
    : action.agentId ?? action.itemId ?? action.traceStepId;
  if (explicit) return `${action.kind}:${normalizeText(explicit)}`;
  if ((action.kind === 'diff' || action.kind === 'shell_command' || action.kind === 'read' || action.kind === 'search') && action.command) {
    return `${action.kind}:command:${normalizeText(action.command)}`;
  }
  return undefined;
}

function canMergeCursorActionLifecycle(previous: CursorAgentAction, next: CursorAgentAction) {
  if (previous.kind !== next.kind) return false;
  if (previous.status === 'running' || previous.status === 'unknown') return true;
  if (next.status === 'running' || next.status === 'unknown') return false;
  return previous.createdAt === next.createdAt;
}

function mergeCursorActionLifecycle(previous: CursorAgentAction, next: CursorAgentAction, locale?: SupportedLocale): CursorAgentAction {
  const title = mergedLifecycleTitle(previous, next, locale);
  const resultRefs = mergedLifecycleResultRefs(previous, next);
  const refs = mergedLifecycleRefs(previous, next);
  return {
    ...previous,
    ...next,
    id: previous.id,
    createdAt: previous.createdAt,
    title,
    summary: title,
    detail: next.detail || previous.detail,
    command: next.command ?? previous.command,
    cwd: next.cwd ?? previous.cwd,
    exitCode: next.exitCode ?? previous.exitCode,
    outputSummary: next.outputSummary ?? previous.outputSummary,
    stdoutRef: next.stdoutRef ?? previous.stdoutRef,
    stderrRef: next.stderrRef ?? previous.stderrRef,
    diff: next.diff ?? previous.diff,
    diffRef: next.diffRef ?? previous.diffRef,
    fileRef: next.fileRef ?? previous.fileRef,
    filePath: next.filePath ?? previous.filePath,
    transcriptRef: next.transcriptRef ?? previous.transcriptRef,
    agentId: next.agentId ?? previous.agentId,
    parentAgentId: next.parentAgentId ?? previous.parentAgentId,
    resultSummary: next.resultSummary ?? previous.resultSummary,
    resultRefs,
    itemId: next.itemId ?? previous.itemId,
    traceStepId: next.traceStepId ?? previous.traceStepId,
    refs,
    initiallyExpanded: next.status === 'running' || (next.status === 'unknown' && previous.initiallyExpanded),
  };
}

function mergedLifecycleResultRefs(previous: CursorAgentAction, next: CursorAgentAction) {
  if (previous.kind === 'subagent' && isTerminalActionStatus(next.status) && next.resultRefs.length) {
    return next.resultRefs;
  }
  return uniqueStrings([...previous.resultRefs, ...next.resultRefs]);
}

function mergedLifecycleRefs(previous: CursorAgentAction, next: CursorAgentAction) {
  if (previous.kind === 'subagent' && isTerminalActionStatus(next.status) && (next.refs.length || next.resultRefs.length)) {
    return uniqueStrings([...next.refs, ...next.resultRefs]);
  }
  return uniqueStrings([...previous.refs, ...next.refs]);
}

function isTerminalActionStatus(status: CursorAgentActionStatus) {
  return status !== 'running' && status !== 'unknown';
}

function mergedLifecycleTitle(previous: CursorAgentAction, next: CursorAgentAction, locale?: SupportedLocale) {
  if (previous.kind === 'subagent' && next.kind === 'subagent') {
    return `${chatText(locale, { 'zh-CN': '子代理', 'en-US': 'Sub agent' })}${actionStatusSuffix(next.status, locale)}`;
  }
  if (next.title && previous.kind === next.kind && (previous.command || previous.filePath) && !next.command && !next.filePath) {
    return `${stripActionStatusSuffix(previous.title)}${actionStatusSuffix(next.status, locale)}`;
  }
  return next.title || previous.title;
}

function actionKindForEntry(
  entry: StreamWorklogEntry,
  type: string,
  toolName: string | undefined,
  command: string | undefined,
): CursorAgentActionKind {
  const nativeDiff = nativeString(entry.event, 'diff') ?? nativeString(entry.event, 'patch');
  const text = `${toolName ?? ''}\n${command ?? ''}\n${nativeDiff ?? ''}\n${cursorEntryText(entry)}\n${entry.operationLine}`.toLowerCase();
  if (/^process_summary$/i.test(toolName ?? '')) return 'thought';
  if (/^approval$/i.test(toolName ?? '')) return 'approval';
  if (type === 'approval_requested' || type === 'human-approval-required' || type === 'gui_ask_user' || type === 'control_request') return 'approval';
  if (isToolLifecycleEntry(entry, type) && /\b(?:multi_agent_v1\.spawn_agent|spawn_agent|subagent|sub-agent|sub agent)\b/.test(text)) return 'subagent';
  const commandIntent = commandIntentForCursorCommand(command);
  if (commandIntent) return commandIntent;
  if (/^(?:read_file|file_read|open_file|read|cat)$/i.test(toolName ?? '')) return 'read';
  if (/^(?:search|grep|rg|ripgrep|glob|find)$/i.test(toolName ?? '')) return 'search';
  if (/\b(?:apply_patch|write_file|edit_file|create_file|delete_file|move_file|file_write)\b|(?:\*\*\* (?:update|add|delete) file:)|\b(?:edited|created|modified|patched)\s+[\w./-]+/i.test(text)) return 'file_edit';
  if (!command && looksLikeDiffText(nativeDiff)) return 'diff';
  if (!command && /\bdiff\b|\.patch\b|diff --git/i.test(text)) return 'diff';
  if (/^(?:shell|command_execution|exec|terminal|bash|run_command|exec_command)$/i.test(toolName ?? '') || command) return 'shell_command';
  if (/^(?:validate|verification|verify|check)$/i.test(toolName ?? '')) return 'validate';
  if (entry.operationKind === 'read') return 'read';
  if (entry.operationKind === 'search') return 'search';
  if (entry.operationKind === 'fetch') return 'fetch';
  if (/^(?:pdf_extract|pdf_extract_text|read_pdf|pdf_read|extract_pdf)$/i.test(toolName ?? '')) return 'read';
  if (/\b(?:pdf_extract|extract_pdf|read_pdf)\b|\bextract(?:ing)?\b.*\.pdf\b|\.pdf\b.*\bextract(?:ing)?\b/i.test(text)) return 'read';
  if (entry.operationKind === 'write') return 'write';
  if (entry.operationKind === 'validate') return 'validate';
  if (entry.operationKind === 'artifact' || entry.operationKind === 'emit') return 'artifact';
  if (entry.operationKind === 'analyze' || entry.operationKind === 'plan') return 'thought';
  if (entry.operationKind === 'message') return 'message';
  return 'other';
}

function isToolLifecycleEntry(entry: StreamWorklogEntry, type: string) {
  return type === 'tool_started'
    || type === 'tool_completed'
    || entry.event.type === 'tool-call'
    || entry.event.type === 'tool-result';
}

function actionTarget(
  entry: StreamWorklogEntry,
  kind: CursorAgentActionKind,
  command: string | undefined,
  fileTarget: string | undefined,
  subagent?: { agentId?: string; resultSummary?: string },
  locale?: SupportedLocale,
) {
  if (kind === 'shell_command') return command ?? cursorEntryText(entry) ?? chatText(locale, { 'zh-CN': '命令', 'en-US': 'command' });
  if (kind === 'search') return cleanSearchDisplayTarget(searchTargetFromCommand(command) ?? cursorEntryText(entry)) ?? chatText(locale, { 'zh-CN': '搜索', 'en-US': 'search' });
  if (kind === 'read') return fileTarget ?? fileTargetFromCommand(command) ?? fileLikeTargetFromText(cursorEntryText(entry)) ?? chatText(locale, { 'zh-CN': '文件', 'en-US': 'file' });
  if (kind === 'file_edit' || kind === 'diff') return fileTarget ?? fileLikeTargetFromText(cursorEntryText(entry)) ?? cursorEntryText(entry) ?? chatText(locale, { 'zh-CN': '文件', 'en-US': 'file' });
  if (kind === 'subagent') return subagentTarget(subagent?.resultSummary ?? cursorEntryText(entry)) ?? chatText(locale, { 'zh-CN': '子代理', 'en-US': 'sub agent' });
  return cursorEntryText(entry) || entry.presentation.typeLabel;
}

function actionTitle(
  kind: CursorAgentActionKind,
  input: { target: string; status: CursorAgentActionStatus; outputSummary?: string; exitCode?: number | null },
  locale?: SupportedLocale,
) {
  const target = localizeActionTarget(compactInline(input.target, 128), locale);
  const suffix = actionStatusSuffix(input.status, locale);
  if (kind === 'read') return `${chatText(locale, { 'zh-CN': '读取', 'en-US': 'Read' })} ${target}${suffix}`;
  if (kind === 'search') return `${chatText(locale, { 'zh-CN': '搜索', 'en-US': 'Searched' })} ${target}${suffix}`;
  if (kind === 'fetch') return `${chatText(locale, { 'zh-CN': '获取', 'en-US': 'Fetched' })} ${target}${suffix}`;
  if (kind === 'shell_command') {
    const exit = input.exitCode !== undefined && input.exitCode !== null
      ? chatText(locale, { 'zh-CN': ` · 退出码 ${input.exitCode}`, 'en-US': ` · exit ${input.exitCode}` })
      : suffix;
    return `${chatText(locale, { 'zh-CN': '运行', 'en-US': 'Ran' })} ${target}${exit}`;
  }
  if (kind === 'file_edit') return `${editedTitle(target, input.outputSummary, locale)}${suffix}`;
  if (kind === 'diff') return `${chatText(locale, { 'zh-CN': '对比', 'en-US': 'Diff' })} ${target}${suffix}`;
  if (kind === 'thought') {
    return target
      ? chatText(locale, { 'zh-CN': `思考 ${target}${suffix}`, 'en-US': `Thought about ${target}${suffix}` })
      : chatText(locale, { 'zh-CN': `短暂思考${suffix}`, 'en-US': `Thought for a moment${suffix}` });
  }
  if (kind === 'approval') return `${chatText(locale, { 'zh-CN': '确认', 'en-US': 'Approval' })} ${target}${suffix}`;
  if (kind === 'subagent') {
    const base = chatText(locale, { 'zh-CN': '子代理', 'en-US': 'Sub agent' });
    const generic = chatText(locale, { 'zh-CN': '子代理', 'en-US': 'sub agent' });
    return `${base}${target && target !== generic ? ` ${target}` : ''}${suffix}`;
  }
  if (kind === 'write') return `${chatText(locale, { 'zh-CN': '写入', 'en-US': 'Wrote' })} ${target}${suffix}`;
  if (kind === 'validate') return `${chatText(locale, { 'zh-CN': '检查', 'en-US': 'Checked' })} ${target}${suffix}`;
  if (kind === 'artifact') return `${chatText(locale, { 'zh-CN': '创建', 'en-US': 'Created' })} ${target}${suffix}`;
  return target || chatText(locale, { 'zh-CN': '工作', 'en-US': 'Worked' });
}

function localizeActionTarget(value: string, locale?: SupportedLocale) {
  if (value === 'current workspace') return chatText(locale, { 'zh-CN': '当前工作区', 'en-US': 'current workspace' });
  return value;
}

function cleanSearchDisplayTarget(value: string | undefined) {
  const text = sanitizeCursorText(value).replace(/\[local path\]/gi, '[redacted-path]');
  if (!text) return undefined;
  const basenameText = text
    .replace(/\[local-path\]\/([^\s"'`<>]+)/gi, '$1')
    .replace(/\[(?:redacted-path|local path)\]/gi, ' ')
    .replace(/\b\d+>\/dev\/null\b/g, ' ')
    .replace(/\s+2>\/dev\/null\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const file = fileLikeTargetFromText(basenameText);
  if (file && (basenameText !== text || /\b(?:searched|search|grep|rg|ripgrep|find|fd|glob)\b/i.test(text) || /\s\d+\s+/.test(text))) return file;
  if (!/\[(?:redacted-path|local-path)\]/i.test(text)) return basenameText || text;
  const pruned = basenameText
    .replace(/\b(?:searched|search|grep|rg|ripgrep|find|fd|glob)\b/gi, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return pruned || undefined;
}

function actionStatusSuffix(status: CursorAgentActionStatus, locale?: SupportedLocale) {
  if (status === 'failed') return chatText(locale, { 'zh-CN': '（失败）', 'en-US': ' failed' });
  if (status === 'running') return chatText(locale, { 'zh-CN': '（运行中）', 'en-US': ' running' });
  if (status === 'blocked') return chatText(locale, { 'zh-CN': '（被阻止）', 'en-US': ' blocked' });
  if (status === 'cancelled') return chatText(locale, { 'zh-CN': '（已取消）', 'en-US': ' cancelled' });
  return '';
}

function stripActionStatusSuffix(value: string) {
  return value
    .replace(/\s+(?:running|failed|blocked|cancelled)$/i, '')
    .replace(/（(?:运行中|失败|被阻止|已取消)）$/i, '');
}

function editedTitle(target: string, outputSummary?: string, locale?: SupportedLocale) {
  const change = parseChangeSummary(outputSummary ?? target);
  return change
    ? `${chatText(locale, { 'zh-CN': '编辑', 'en-US': 'Edited' })} ${target.replace(/\s+[+-]\d+.*$/, '')} ${change}`
    : `${chatText(locale, { 'zh-CN': '编辑', 'en-US': 'Edited' })} ${target}`;
}

function detailForAction(
  entry: StreamWorklogEntry,
  input: {
    actionKind: CursorAgentActionKind;
    command?: string;
    outputSummary?: string;
    exitCode?: number | null;
    stdoutRef?: string;
    stderrRef?: string;
    diffRef?: string;
    diff?: string;
    stdout?: string;
    stderr?: string;
    transcriptRef?: string;
    resultSummary?: string;
  },
) {
  const lines: string[] = [];
  if (input.actionKind === 'subagent') return '';
  const entryText = boundedDetail(cursorEntryText(entry));
  if (looksLikeRedactedPathPlaceholderDetail(entryText)) return '';
  if (input.actionKind === 'read' && fileLikeTargetFromText(entryText)) return '';
  const covered = [
    input.command,
    input.outputSummary,
    input.diff,
    input.stdout,
    input.stderr,
    input.stdoutRef,
    input.stderrRef,
    input.diffRef,
    input.transcriptRef,
    input.resultSummary,
  ].map((value) => normalizeText(value ?? '')).filter(Boolean);
  const redundantEntryText = entryText ? isRedundantActionDetail(entryText, input) : false;
  if (entryText && !redundantEntryText && !covered.some((value) => value.includes(normalizeText(entryText)) || normalizeText(entryText).includes(value))) {
    lines.push(entryText);
  }
  if (input.stdout) lines.push(input.stdout);
  if (input.stderr) lines.push(input.stderr);
  if (lines.length) return lines.join('\n');
  if (redundantEntryText) return '';
  return boundedDetail(cursorEntryText(entry) || entry.presentation.detail || entry.presentation.usageDetail);
}

function isRedundantActionDetail(
  detail: string,
  input: { command?: string; outputSummary?: string; diff?: string; stdout?: string; stderr?: string },
) {
  const text = normalizeText(detail);
  if (/runtime event recorded.*folded run audit/.test(text)) return true;
  if (/^(?:tool|command)\s+result$/.test(text)) return true;
  const command = normalizeText(input.command ?? '');
  if (command && text.includes(command) && /\b(?:shell command|command|tool)\s+(?:started|completed|finished|running)\b/.test(text)) return true;
  const output = normalizeText(input.outputSummary ?? '');
  if (output && text.includes(output) && /\b(?:tool|command)\s+(?:completed|finished)\b/.test(text)) return true;
  return false;
}

function looksLikeRedactedPathPlaceholderDetail(value: string | undefined) {
  const text = sanitizeCursorText(value).replace(/\[local path\]/gi, '[redacted-path]');
  return /\[(?:redacted-path|local-path)\]/i.test(text);
}

function diffTextFromNativeOutput(event: AgentStreamEvent, actionKind: CursorAgentActionKind) {
  if (actionKind !== 'diff' && actionKind !== 'file_edit') return undefined;
  const text = firstString(
    nativeString(event, 'stdout'),
    nativeString(event, 'output'),
    nativeString(event, 'outputSummary'),
    nativeString(event, 'output_summary'),
    nativeString(event, 'result'),
    nativeString(event, 'text'),
    nativeString(event, 'message'),
  );
  return looksLikeDiffText(text) ? text : undefined;
}

function looksLikeDiffText(value: string | undefined) {
  const text = value?.trim();
  if (!text) return false;
  return /^diff --git\s+/m.test(text)
    || /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/m.test(text)
    || (/^---\s+\S+/m.test(text) && /^\+\+\+\s+\S+/m.test(text));
}

function looksLikeDiffSummary(value: string | undefined) {
  const text = value?.trim();
  if (!text) return false;
  return looksLikeDiffText(text)
    || /---\s+\S+[\s\S]*\+\+\+\s+\S+[\s\S]*@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/.test(text);
}

function cleanSubagentActionSummary(value: string | undefined) {
  const text = stripTruncatedSubagentPromptTail(sanitizeCursorText(value));
  if (!text || looksLikeBackendEnvelopeSummary(text)) return undefined;
  const segments = text
    .split(/(?:\r?\n|(?<=[.!?。！？])\s+)/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !isPromptEchoSubagentSegment(segment));
  const cleaned = segments.join(' ').trim();
  return cleaned || undefined;
}

function stripTruncatedSubagentPromptTail(value: string | undefined) {
  return (value ?? '')
    .replace(/\s*\.\.\.\s*[^.!?。！？]{0,120}\bsubstitute\b[.!?。！？]?/gi, '')
    .trim();
}

function cleanCursorActionSummary(value: string | undefined) {
  const text = sanitizeCursorText(value);
  if (!text || looksLikeBackendEnvelopeSummary(text)) return undefined;
  return text;
}

function looksLikeBackendEnvelopeSummary(value: string | undefined) {
  const text = value?.trim();
  if (!text) return false;
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    return /"?(?:item|type|command|cwd|processId|raw|stdout|stderr|completedAtMs|source)"?\s*:/.test(text)
      || /\b(?:commandExecution|unifiedExec|stdoutRef|stderrRef|rawRef|runtimeEventsRef)\b/i.test(text);
  }
  return /\b(?:commandExecution|unifiedExec|stdoutRef|stderrRef|rawRef|runtimeEventsRef)\b/i.test(text);
}

function isPromptEchoSubagentSegment(segment: string) {
  const text = segment.toLowerCase();
  return /\b(?:request|prompt|input)\s+summary\b/.test(text)
    || /\bdo not (?:edit|modify|write|use\s+(?:shell|ordinary|terminal)|use shell substitute)\b/.test(text)
    || /\bdo not use\b.*\bsubstitute\b/.test(text)
    || (/\bsubstitute\b/.test(text) && /(?:\.\.\.|shell|ordinary|terminal|do not|use)/.test(text))
    || /\bif (?:no|unavailable|current runtime lacks|there is no)\b/.test(text)
    || /^(?:read[-\s]?only|只读)\.?$/.test(text)
    || /^read\b.*\bonly\b\.?$/.test(text)
    || /^sub[-\s]?agent\s+reads?\b/.test(text)
    || /^delegated\s+worker\s+reads?\b/.test(text)
    || /^report\b.*\b(?:open difference|evidence refs?|refs needed|current status|todo)\b/.test(text)
    || /^main agent\b.*\bsummar/i.test(segment)
    || /\bno_subagent_tool_available\b/.test(text) && /\b(?:if|prompt|request|summary)\b/.test(text);
}

function groupFromActions(
  kind: CursorAgentGroupKind,
  actions: CursorAgentAction[],
  mode: 'live' | 'recorded',
  events: AgentStreamEvent[],
  now?: string,
  index = 0,
  summaryActions: CursorAgentAction[] = actions,
  locale?: SupportedLocale,
): CursorAgentProcessGroup | undefined {
  if (!actions.length) return undefined;
  const status = groupStatus(actions);
  const title = kind === 'worked'
    ? chatText(locale, { 'zh-CN': `工作 ${durationLabel(events, now)}`, 'en-US': `Worked for ${durationLabel(events, now)}` })
    : exploredTitle(actions, locale);
  return {
    id: `cursor-agent-${kind}-${index}`,
    kind,
    status,
    title,
    summary: actionSummary(summaryActions.length ? summaryActions : actions, locale),
    actions,
    initiallyExpanded: mode === 'live' && (status === 'running' || status === 'blocked'),
  };
}

function exploredTitle(actions: CursorAgentAction[], locale?: SupportedLocale) {
  const parts = [
    countPhrase(actions, 'read', { zh: '个文件', enSingular: 'file', enPlural: 'files' }, locale),
    countPhrase(actions, 'search', { zh: '次搜索', enSingular: 'search', enPlural: 'searches' }, locale),
    countPhrase(actions, 'fetch', { zh: '次获取', enSingular: 'fetch', enPlural: 'fetches' }, locale),
  ].filter(Boolean);
  if (parts.length) return chatText(locale, { 'zh-CN': `查看了 ${parts.join('、')}`, 'en-US': `Explored ${parts.join(', ')}` });
  return chatText(locale, {
    'zh-CN': `查看了 ${actions.length} 个项目`,
    'en-US': `Explored ${actions.length} ${actions.length === 1 ? 'item' : 'items'}`,
  });
}

function actionSummary(actions: CursorAgentAction[], locale?: SupportedLocale) {
  const parts = [
    countPhrase(actions, 'read', { zh: '个文件', enSingular: 'file', enPlural: 'files' }, locale),
    countPhrase(actions, 'search', { zh: '次搜索', enSingular: 'search', enPlural: 'searches' }, locale),
    countPhrase(actions, 'fetch', { zh: '次获取', enSingular: 'fetch', enPlural: 'fetches' }, locale),
    countPhrase(actions, 'shell_command', { zh: '条命令', enSingular: 'command run', enPlural: 'commands run' }, locale),
    countPhrase(actions, 'file_edit', { zh: '次编辑', enSingular: 'edit', enPlural: 'edits' }, locale),
    countPhrase(actions, 'diff', { zh: '个 diff', enSingular: 'diff', enPlural: 'diffs' }, locale),
    countPhrase(actions, 'approval', { zh: '次确认', enSingular: 'approval', enPlural: 'approvals' }, locale),
    countPhrase(actions, 'subagent', { zh: '个子代理', enSingular: 'sub agent', enPlural: 'sub agents' }, locale),
  ].filter(Boolean);
  return parts.length ? parts.join(chatText(locale, { 'zh-CN': '、', 'en-US': ', ' })) : chatCount(locale, actions.length, {
    zh: '个动作',
    enSingular: 'action',
    enPlural: 'actions',
  });
}

function countPhrase(
  actions: CursorAgentAction[],
  kind: CursorAgentActionKind,
  label: { zh: string; enSingular: string; enPlural: string },
  locale?: SupportedLocale,
) {
  const count = actions.filter((action) => action.kind === kind).length;
  if (!count) return '';
  return chatCount(locale, count, label);
}

function actionBelongsToGroup(action: CursorAgentAction): CursorAgentGroupKind {
  if (action.kind === 'folded') return action.foldedGroupKind ?? 'worked';
  if (action.kind === 'read' || action.kind === 'search' || action.kind === 'fetch') return 'explored';
  return 'worked';
}

function latestCursorProgressSentence(actions: CursorAgentAction[], events: AgentStreamEvent[]) {
  const visibleActions = actions.filter((action) => action.kind !== 'folded');
  const running = [...visibleActions].reverse().find((action) => action.status === 'running');
  if (running) return running.title;
  const latestThought = [...visibleActions].reverse().find((action) => action.kind === 'thought');
  if (latestThought) return latestThought.title;
  if (visibleActions.length) return visibleActions[visibleActions.length - 1]?.title ?? '';
  const progress = [...events].reverse().map(progressModelFromEvent).find(Boolean);
  if (progress) return progress.title;
  return '';
}

function groupStatus(actions: CursorAgentAction[]): CursorAgentActionStatus {
  if (actions.some((action) => action.status === 'running')) return 'running';
  if (actions.some((action) => action.status === 'blocked')) return 'blocked';
  if (actions.some((action) => action.status === 'failed')) return 'failed';
  if (actions.some((action) => action.status === 'cancelled')) return 'cancelled';
  if (actions.some((action) => action.status === 'completed')) return 'completed';
  return 'unknown';
}

function actionStatus(
  event: AgentStreamEvent,
  type: string,
  context?: { actionKind?: CursorAgentActionKind; command?: string; exitCode?: number | null; diffSource?: string },
): CursorAgentActionStatus {
  const status = nativeString(event, 'status')?.toLowerCase();
  const failedByResultPayload = nativeFailureSignal(event);
  if (isDiffDifferenceResult(context) && !failedByResultPayload) return 'completed';
  if (status && /^(?:running|in_progress|started|pending)$/.test(status)) return 'running';
  if (status && /^(?:blocked|approval-required|approval_required|requires_approval|waiting_for_approval|needs-human|needs_human)$/.test(status)) return 'blocked';
  if (status && /^(?:cancelled|canceled|aborted|interrupted)$/.test(status)) return 'cancelled';
  if (status && /^(?:failed|failure|fail|error|errored|rejected|failed-with-reason)$/.test(status)) return 'failed';
  if (failedByResultPayload) return 'failed';
  if (status && /^(?:completed|done|success|succeeded)$/.test(status)) return 'completed';
  if (type.includes('started') || type === 'tool_started' || event.type === 'tool-call') return 'running';
  if (type.includes('completed') || type === 'tool_completed' || event.type === 'tool-result') return 'completed';
  if (type.includes('approval')) return 'blocked';
  if (type.includes('failed') || type.includes('error')) return 'failed';
  if (type.includes('cancel')) return 'cancelled';
  return 'unknown';
}

function isDiffDifferenceResult(context: { actionKind?: CursorAgentActionKind; command?: string; exitCode?: number | null; diffSource?: string } | undefined) {
  return context?.actionKind === 'diff'
    && context.exitCode === 1
    && (looksLikeDiffText(context.diffSource) || diffExitOneMeansDifferences(context.command));
}

function diffExitOneMeansDifferences(command: string | undefined) {
  const unwrapped = unwrapShellCommand(command);
  if (!unwrapped) return false;
  const words = shellWords(unwrapped);
  const commandName = words[0]?.replace(/^.*\//, '').toLowerCase();
  if (commandName === 'diff') return true;
  if (commandName !== 'git' || !/\bdiff\b/.test(unwrapped)) return false;
  if (/\s--check(?:\s|$)/.test(unwrapped)) return false;
  return /\s--(?:quiet|exit-code)(?:\s|$)/.test(unwrapped);
}

function fileTargetForEntry(event: AgentStreamEvent, entry: StreamWorklogEntry, kind: CursorAgentActionKind, command?: string) {
  const direct = structuredFileTargetForEvent(event);
  if (direct) return direct;
  const commandTarget = kind === 'read' || kind === 'search' || kind === 'file_edit' || kind === 'diff' || kind === 'write'
    ? fileTargetFromCommand(command)
    : undefined;
  if (commandTarget) return commandTarget;
  const text = cursorEntryText(entry);
  if (kind === 'read' || kind === 'file_edit' || kind === 'diff' || kind === 'write') {
    return text.match(/^\s*\*\*\* (?:Update|Add|Delete) File:\s*(.+)$/mi)?.[1]?.trim()
      ?? text.match(/\b(?:path|file|target)\s*[:=]\s*["']?([^"',\n\r)]+)["']?/i)?.[1]?.trim()
      ?? text.match(/\b(?:read|edited|created|modified|patched|wrote)\s+([./\w-]+\.[\w.-]+)/i)?.[1]?.trim()
      ?? fileLikeTargetFromText(text);
  }
  return undefined;
}

function filePreviewFallbackTargetsFromEvents(events: AgentStreamEvent[]) {
  return uniqueStrings(events.flatMap((event) => fileLikeTargetsFromText(
    nativeString(event, 'commandText')
      ?? nativeString(event, 'command_text')
      ?? nativeString(event, 'prompt')
      ?? nativeString(event, 'request')
      ?? '',
  )));
}

function filePreviewRefForEntry(event: AgentStreamEvent, kind: CursorAgentActionKind, command?: string): string | undefined {
  if (!isFilePreviewActionKind(kind)) return undefined;
  const direct = sanitizeCursorObjectPreviewRef(nativeString(event, 'fileRef') ?? nativeString(event, 'file_ref'));
  if (direct) return direct;
  const structuredTarget = structuredFilePreviewTargetForEvent(event);
  const structuredRef = fileRefFromStructuredPath(structuredTarget);
  if (structuredRef) return structuredRef;
  const workEvidenceRef = fileRefFromWorkEvidence(event, kind);
  if (workEvidenceRef) return workEvidenceRef;
  if (kind === 'read' || kind === 'file_edit' || kind === 'diff' || kind === 'write') {
    return fileRefFromStructuredPath(filePreviewTargetFromCommand(command));
  }
  return undefined;
}

function resultRefsForEvent(event: AgentStreamEvent) {
  return uniqueStrings([
    sanitizeCursorResultRef(nativeString(event, 'resultRef')),
    sanitizeCursorResultRef(nativeString(event, 'result_ref')),
    ...nativeStringList(event, 'resultRefs').map(sanitizeCursorResultRef),
    ...nativeStringList(event, 'result_refs').map(sanitizeCursorResultRef),
    sanitizeCursorArtifactResultRef(nativeString(event, 'artifactRef')),
    sanitizeCursorArtifactResultRef(nativeString(event, 'artifact_ref')),
    ...nativeStringList(event, 'artifactRefs').map(sanitizeCursorArtifactResultRef),
    ...nativeStringList(event, 'artifact_refs').map(sanitizeCursorArtifactResultRef),
    sanitizeCursorResultRef(nativeString(event, 'outputRef')),
    sanitizeCursorResultRef(nativeString(event, 'output_ref')),
    ...nativeStringList(event, 'outputRefs').map(sanitizeCursorResultRef),
    ...nativeStringList(event, 'output_refs').map(sanitizeCursorResultRef),
    ...nativeStringList(event, 'evidenceRefs').map(sanitizeCursorResultRef),
    ...nativeStringList(event, 'evidence_refs').map(sanitizeCursorResultRef),
    ...nativeStringList(event, 'downloadRefs').map(sanitizeCursorResultRef),
    ...nativeStringList(event, 'download_refs').map(sanitizeCursorResultRef),
    ...nativeStringList(event, 'pdfRefs').map(sanitizeCursorResultRef),
    ...nativeStringList(event, 'pdf_refs').map(sanitizeCursorResultRef),
    ...nativeStringList(event, 'sourceRefs').map(sanitizeCursorResultRef),
    ...nativeStringList(event, 'source_refs').map(sanitizeCursorResultRef),
  ]);
}

function isFilePreviewActionKind(kind: CursorAgentActionKind) {
  return kind === 'read' || kind === 'file_edit' || kind === 'diff' || kind === 'write';
}

function structuredFileTargetForEvent(event: AgentStreamEvent): string | undefined {
  const path = firstString(
    nativeString(event, 'filePath'),
    nativeString(event, 'file_path'),
    nativeString(event, 'path'),
    nativeString(event, 'file'),
    nativeString(event, 'filename'),
  );
  if (path) return displayPathFromStructuredPath(path);
  const ref = sanitizeCursorObjectPreviewRef(nativeString(event, 'ref'));
  if (!ref?.startsWith('file:')) return undefined;
  return ref.slice('file:'.length);
}

function structuredFilePreviewTargetForEvent(event: AgentStreamEvent): string | undefined {
  const path = firstString(
    nativeString(event, 'filePath'),
    nativeString(event, 'file_path'),
    nativeString(event, 'path'),
    nativeString(event, 'file'),
    nativeString(event, 'filename'),
  );
  if (path) return path;
  const ref = sanitizeCursorObjectPreviewRef(nativeString(event, 'ref'));
  if (!ref?.startsWith('file:')) return undefined;
  return ref.slice('file:'.length);
}

function displayPathFromStructuredPath(value: string | undefined) {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (raw.startsWith('file:')) {
    const filePath = raw.slice('file:'.length);
    return isSafeRelativeRefPath(filePath) ? filePath : sanitizeCursorPath(raw);
  }
  return sanitizeCursorPath(raw);
}

function fileRefFromWorkEvidence(event: AgentStreamEvent, kind: CursorAgentActionKind): string | undefined {
  for (const evidence of workEvidenceRecordsForEvent(event)) {
    const evidenceKind = stringField(evidence.kind)?.toLowerCase();
    if (!workEvidenceSupportsFilePreview(evidenceKind, kind)) continue;
    const input = recordOrUndefined(evidence.input);
    const pathRef = fileRefFromStructuredPath(firstString(
      stringField(input?.path),
      stringField(input?.file),
      stringField(input?.filePath),
      stringField(input?.file_path),
      stringField(input?.filename),
      stringField(evidence.path),
      stringField(evidence.file),
      stringField(evidence.filePath),
      stringField(evidence.file_path),
      stringField(evidence.filename),
    ));
    if (pathRef) return pathRef;
    for (const ref of stringListField(evidence.evidenceRefs).concat(stringListField(evidence.evidence_refs))) {
      const previewRef = sanitizeCursorObjectPreviewRef(ref);
      if (previewRef?.startsWith('file:')) return previewRef;
    }
  }
  return undefined;
}

function workEvidenceRecordsForEvent(event: AgentStreamEvent): Array<Record<string, unknown>> {
  const raw = record(event.raw);
  const native = recordOrUndefined(raw.native) ?? raw;
  const nativeRaw = recordOrUndefined(native.raw);
  const nestedRaw = recordOrUndefined(raw.raw);
  const nestedEvent = recordOrUndefined(nestedRaw?.event);
  return [
    event.workEvidence,
    raw.workEvidence,
    raw.work_evidence,
    native.workEvidence,
    native.work_evidence,
    nativeRaw?.workEvidence,
    nativeRaw?.work_evidence,
    nestedRaw?.workEvidence,
    nestedRaw?.work_evidence,
    nestedEvent?.workEvidence,
    nestedEvent?.work_evidence,
  ].flatMap((value) => Array.isArray(value) ? value.filter(recordOrUndefined) : []);
}

function workEvidenceSupportsFilePreview(evidenceKind: string | undefined, actionKind: CursorAgentActionKind) {
  if (!evidenceKind) return true;
  if (actionKind === 'read') return evidenceKind === 'read';
  if (actionKind === 'write' || actionKind === 'file_edit' || actionKind === 'diff') return evidenceKind === 'write' || evidenceKind === 'read';
  return false;
}

function fileRefFromStructuredPath(value: string | undefined): string | undefined {
  const raw = value?.trim().replace(/\\/g, '/');
  if (!raw) return undefined;
  if (isRedactedPathToken(raw) || /\[(?:redacted-path|local path|local-path)\]/i.test(raw)) return undefined;
  if (raw.startsWith('file:') || raw.startsWith('artifact:')) return sanitizeCursorObjectPreviewRef(raw);
  if (/^(?:\/|[A-Za-z]:\/)/.test(raw) || raw.includes('://')) return undefined;
  return isSafeRelativeRefPath(raw) ? `file:${raw}` : undefined;
}

function fileLikeTargetFromText(value: string | undefined) {
  const text = sanitizeCursorText(value);
  if (!text) return undefined;
  const candidates = fileLikeTargetsFromText(text);
  return candidates[0];
}

function fileLikeTargetsFromText(value: string | undefined) {
  const text = sanitizeCursorText(value);
  if (!text) return [];
  return [...text.matchAll(/(?:^|[\s`"'])((?:\.{1,2}\/)?(?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9][\w.-]*)(?=$|[\s`"',.;:!?，。；：！？)])/g)]
    .map((match) => trimFileTargetTrailingPunctuation(match[1]))
    .filter((candidate): candidate is string => Boolean(candidate && isSafeRelativeRefPath(candidate)));
}

function trimFileTargetTrailingPunctuation(value: string | undefined) {
  return value?.replace(/[.,;:!?，。；：！？)]+$/g, '');
}

function rawType(event: AgentStreamEvent) {
  const raw = record(event.raw);
  const native = recordOrUndefined(raw.native) ?? raw;
  const nativeRaw = recordOrUndefined(native.raw);
  const nestedRaw = recordOrUndefined(raw.raw);
  const nestedEvent = recordOrUndefined(nestedRaw?.event);
  return (stringField(native.type)
    ?? stringField(native.rawType)
    ?? stringField(nativeRaw?.type)
    ?? stringField(nativeRaw?.rawType)
    ?? stringField(raw.type)
    ?? stringField(raw.rawType)
    ?? stringField(nestedRaw?.type)
    ?? stringField(nestedRaw?.rawType)
    ?? stringField(nestedEvent?.type)
    ?? event.type).toLowerCase();
}

function nativeString(event: AgentStreamEvent, key: string): string | undefined {
  const raw = record(event.raw);
  const native = recordOrUndefined(raw.native) ?? raw;
  const nativeRaw = recordOrUndefined(native.raw);
  const nestedRaw = recordOrUndefined(raw.raw);
  const nestedEvent = recordOrUndefined(nestedRaw?.event);
  return stringField(native[key]) ?? stringField(nativeRaw?.[key]) ?? stringField(raw[key]) ?? stringField(nestedRaw?.[key]) ?? stringField(nestedEvent?.[key]);
}

function nativeNumber(event: AgentStreamEvent, key: string): number | null | undefined {
  const raw = record(event.raw);
  const native = recordOrUndefined(raw.native) ?? raw;
  const nativeRaw = recordOrUndefined(native.raw);
  const nestedRaw = recordOrUndefined(raw.raw);
  const nestedEvent = recordOrUndefined(nestedRaw?.event);
  return numberField(native[key]) ?? numberField(nativeRaw?.[key]) ?? numberField(raw[key]) ?? numberField(nestedRaw?.[key]) ?? numberField(nestedEvent?.[key]);
}

function nativeFailureSignal(event: AgentStreamEvent) {
  const raw = record(event.raw);
  const native = recordOrUndefined(raw.native) ?? raw;
  const nativeRaw = recordOrUndefined(native.raw);
  const nestedRaw = recordOrUndefined(raw.raw);
  const nestedEvent = recordOrUndefined(nestedRaw?.event);
  const seen = new Set<unknown>();
  return [native, nativeRaw, raw, nestedRaw, nestedEvent].some((candidate) => recordHasFailureSignal(candidate, seen, 0));
}

function recordHasFailureSignal(value: unknown, seen: Set<unknown>, depth: number): boolean {
  if (depth > 4 || value === undefined || value === null) return false;
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((entry) => recordHasFailureSignal(entry, seen, depth + 1));
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === 'ok' && entry === false) return true;
    if (depth > 0 && (normalizedKey === 'status' || normalizedKey === 'state' || normalizedKey === 'outcome' || normalizedKey === 'verdict') && failureStatusValue(entry)) return true;
    if (recordHasFailureSignal(entry, seen, depth + 1)) return true;
  }
  return false;
}

function failureStatusValue(value: unknown) {
  if (typeof value !== 'string') return false;
  return /^(?:failed|failure|fail|error|errored|rejected|failed-with-reason)$/.test(value.trim().toLowerCase());
}

function nativeStringList(event: AgentStreamEvent, key: string): string[] {
  const raw = record(event.raw);
  const native = recordOrUndefined(raw.native) ?? raw;
  const nativeRaw = recordOrUndefined(native.raw);
  const nestedRaw = recordOrUndefined(raw.raw);
  const nestedEvent = recordOrUndefined(nestedRaw?.event);
  return [
    ...stringListField(native[key]),
    ...stringListField(nativeRaw?.[key]),
    ...stringListField(raw[key]),
    ...stringListField(nestedRaw?.[key]),
    ...stringListField(nestedEvent?.[key]),
  ];
}

function cursorEntryText(entry: StreamWorklogEntry) {
  return boundedDetail(firstString(
    entry.presentation.detail,
    entry.presentation.shortDetail,
    nativeString(entry.event, 'message'),
    nativeString(entry.event, 'text'),
    nativeString(entry.event, 'detail'),
    entry.event.detail,
  ));
}

function commandTextFromEntry(entry: StreamWorklogEntry) {
  const toolName = nativeString(entry.event, 'toolName');
  if (!/^(?:shell|command_execution|exec|terminal|bash|run_command|exec_command)$/i.test(toolName ?? '')) return undefined;
  return firstString(
    nativeString(entry.event, 'detail'),
    nativeString(entry.event, 'message'),
    nativeString(entry.event, 'text'),
    entry.event.detail,
    entry.presentation.detail,
  );
}

function commandIntentForCursorCommand(command: string | undefined): CursorAgentActionKind | undefined {
  const unwrapped = unwrapShellCommand(command);
  if (!unwrapped) return undefined;
  const first = shellWords(unwrapped)[0]?.replace(/^.*\//, '').toLowerCase();
  if (!first) return undefined;
  if (first === 'diff') return 'diff';
  if (first === 'git' && /\bdiff\b/.test(unwrapped)) return 'diff';
  if (/^(?:rg|ripgrep|grep|egrep|fgrep|find|fd|glob)$/.test(first)) return 'search';
  if (/^(?:cat|sed|head|tail|less|more|nl|ls|tree|pwd)$/.test(first)) return 'read';
  return undefined;
}

function unwrapShellCommand(command: string | undefined) {
  const text = sanitizeCursorText(command);
  if (!text) return '';
  const shell = text.match(/(?:^|\s)(?:\/bin\/)?(?:zsh|bash|sh)\s+-lc\s+(['"])([\s\S]*)\1$/);
  return shell?.[2] ?? text;
}

function fileTargetFromCommand(command: string | undefined) {
  const unwrapped = unwrapShellCommand(command);
  if (!unwrapped) return undefined;
  const words = shellWords(unwrapped).filter((word) => word && !word.startsWith('-') && !isRedactedPathToken(word));
  if (!words.length) return undefined;
  const commandName = words[0]?.replace(/^.*\//, '').toLowerCase();
  if (commandName === 'pwd') return 'current workspace';
  const candidates = words.slice(1).filter((word) => !/^\d+(?:,\d+)?p$/.test(word));
  const path = [...candidates].reverse().find((word) => isPathLikeCommandTarget(word));
  return path ?? candidates.at(-1);
}

function filePreviewTargetFromCommand(command: string | undefined) {
  const unwrapped = unwrapShellCommand(command);
  if (!unwrapped) return undefined;
  const words = shellWords(unwrapped).filter((word) => word && !word.startsWith('-') && !isRedactedPathToken(word));
  if (!words.length) return undefined;
  const commandName = words[0]?.replace(/^.*\//, '').toLowerCase();
  if (commandName === 'pwd') return undefined;
  const candidates = words.slice(1).filter((word) => !/^\d+(?:,\d+)?p$/.test(word));
  return [...candidates].reverse().find((word) => isPathLikeCommandTarget(word));
}

function searchTargetFromCommand(command: string | undefined) {
  const unwrapped = unwrapShellCommand(command);
  if (!unwrapped) return undefined;
  const words = shellWords(unwrapped);
  if (!words.length) return undefined;
  const commandName = words[0]?.replace(/^.*\//, '').toLowerCase();
  if (!/^(?:rg|ripgrep|grep|egrep|fgrep|find|fd|glob)$/.test(commandName ?? '')) return undefined;
  const useful = words.slice(1).filter((word) => word && !word.startsWith('-') && !isRedactedPathToken(word)).slice(0, 4);
  return useful.length ? useful.join(' ') : unwrapped;
}

function shellWords(value: string) {
  const words: string[] = [];
  const pattern = /"((?:\\"|[^"])*)"|'((?:\\'|[^'])*)'|(\S+)/g;
  for (const match of value.matchAll(pattern)) {
    words.push((match[1] ?? match[2] ?? match[3] ?? '').replace(/\\(["'])/g, '$1'));
  }
  return words;
}

function isPathLikeCommandTarget(value: string) {
  return /^(?:\.{0,2}\/|[\w.-]+\/|[\w.-]+\.[A-Za-z0-9]+(?:[#?:].*)?$)/.test(value);
}

function isGenericLifecyclePlaceholder(entry: StreamWorklogEntry) {
  const type = rawType(entry.event);
  if (type !== 'tool_started' && type !== 'tool_completed' && entry.event.type !== 'tool-call' && entry.event.type !== 'tool-result') return false;
  if (hasNativeLifecycleContent(entry.event)) return false;
  const detail = normalizeText(cursorEntryText(entry));
  return /^(?:tool started\.?\s*)+(?:backend tool)?$/.test(detail)
    || /^(?:tool completed\.?\s*)+(?:backend result|backend tool)?$/.test(detail);
}

function hasNativeLifecycleContent(event: AgentStreamEvent) {
  return Boolean(
    nativeString(event, 'toolName')
    || nativeString(event, 'command')
    || nativeString(event, 'outputSummary')
    || nativeString(event, 'output_summary')
    || nativeString(event, 'diff')
    || nativeString(event, 'patch')
    || nativeString(event, 'filePath')
    || nativeString(event, 'file_path')
    || nativeString(event, 'fileRef')
    || nativeString(event, 'file_ref')
    || nativeString(event, 'ref')
    || nativeString(event, 'transcriptRef')
    || nativeString(event, 'transcript_ref')
    || nativeString(event, 'resultSummary')
    || nativeString(event, 'result_summary')
    || nativeString(event, 'resultRef')
    || nativeString(event, 'result_ref')
    || nativeString(event, 'artifactRef')
    || nativeString(event, 'artifact_ref')
    || nativeString(event, 'outputRef')
    || nativeString(event, 'output_ref')
    || nativeStringList(event, 'refs').length
    || nativeStringList(event, 'resultRefs').length
    || nativeStringList(event, 'result_refs').length
    || nativeStringList(event, 'artifactRefs').length
    || nativeStringList(event, 'artifact_refs').length
    || nativeStringList(event, 'outputRefs').length
    || nativeStringList(event, 'output_refs').length
    || nativeStringList(event, 'evidenceRefs').length
    || nativeStringList(event, 'evidence_refs').length
    || nativeStringList(event, 'downloadRefs').length
    || nativeStringList(event, 'download_refs').length
    || nativeStringList(event, 'pdfRefs').length
    || nativeStringList(event, 'pdf_refs').length
    || nativeStringList(event, 'sourceRefs').length
    || nativeStringList(event, 'source_refs').length
  );
}

function isRuntimeLifecyclePlaceholder(entry: StreamWorklogEntry) {
  if (hasNativeLifecycleContent(entry.event)) return false;
  if (hasUserFacingStructuredProgress(entry)) return false;
  const type = rawType(entry.event);
  if (type === 'run_started' || type === 'done' || type === 'run_completed') return true;
  const text = normalizeText(cursorEntryText(entry) || entry.event.label || '');
  return isBackendTransportLifecycleText(text)
    || /^runtime codex (?:started with configured runtime|completed successfully\.?)$/.test(text)
    || /^(?:disabled|starting|ready|output|completed(?: done)?|running|done)$/.test(text);
}

function isRuntimeMetadataPlaceholder(entry: StreamWorklogEntry) {
  if (nativeString(entry.event, 'toolName') || nativeString(entry.event, 'command')) return false;
  const text = normalizeText(cursorEntryText(entry) || entry.event.label || '');
  return text === '上下文窗口'
    || text === 'context window'
    || text === 'workspace runtime'
    || text === 'runtime metadata';
}

function isUserPromptEchoEvent(entry: StreamWorklogEntry) {
  if (nativeString(entry.event, 'toolName') || nativeString(entry.event, 'command')) return false;
  const role = nativeString(entry.event, 'role')?.toLowerCase();
  if (role === 'user') return true;
  const type = rawType(entry.event);
  if (/\b(?:user|prompt|input)\b/.test(type)) return true;
  return false;
}

function isPromptCommandEchoEvent(entry: StreamWorklogEntry) {
  if (nativeString(entry.event, 'command')) return false;
  const text = normalizeText(cursorEntryText(entry) || entry.event.label || '');
  if (text.length < 24) return false;
  return /\b(?:use the .*tool|run exactly|do not edit|do not infer|after the command runs|say whether|report the exit code)\b/.test(text)
    || (/^run\s+/.test(text) && /\b(?:do not|say whether|report|after)\b/.test(text));
}

function isInstructionEchoOnlyToolEvent(entry: StreamWorklogEntry) {
  const type = rawType(entry.event);
  if (!isToolLifecycleEntry(entry, type)) return false;
  if (hasStrongActionEvidence(entry.event)) return false;
  const text = normalizeText(cursorEntryText(entry) || entry.event.detail || entry.event.label || '');
  return looksLikeUserInstructionEcho(text);
}

function isPromptLikeGenericReadAction(entry: StreamWorklogEntry) {
  const type = rawType(entry.event);
  const command = sanitizeCursorText(nativeString(entry.event, 'command') ?? commandTextFromEntry(entry));
  const actionKind = actionKindForEntry(entry, type, nativeString(entry.event, 'toolName'), command);
  if (actionKind !== 'read') return false;
  const fileTarget = sanitizeCursorPath(fileTargetForEntry(entry.event, entry, actionKind, command));
  const text = [cursorEntryText(entry), fileTarget, nativeString(entry.event, 'outputSummary'), nativeString(entry.event, 'output_summary')]
    .filter(Boolean)
    .join(' ');
  if (!looksLikeUserInstructionEcho(text)) return false;
  return !fileTarget
    || /^file$/i.test(fileTarget)
    || looksLikeUserInstructionEcho(fileTarget)
    || !hasSpecificFileEvidence(entry.event);
}

function isPromptLikeNonWorkAction(entry: StreamWorklogEntry) {
  const type = rawType(entry.event);
  const command = sanitizeCursorText(nativeString(entry.event, 'command') ?? commandTextFromEntry(entry));
  const actionKind = actionKindForEntry(entry, type, nativeString(entry.event, 'toolName'), command);
  if (!['validate', 'thought', 'message', 'other'].includes(actionKind)) return false;
  if (hasStrongActionEvidence(entry.event)) return false;
  const text = [
    cursorEntryText(entry),
    entry.operationLine,
    nativeString(entry.event, 'outputSummary'),
    nativeString(entry.event, 'output_summary'),
    nativeString(entry.event, 'resultSummary'),
    nativeString(entry.event, 'result_summary'),
  ].filter(Boolean).join(' ');
  return looksLikeUserInstructionEcho(text);
}

function isLowValueToolLifecyclePlaceholder(entry: StreamWorklogEntry) {
  const type = rawType(entry.event);
  if (!isToolLifecycleEntry(entry, type)) return false;
  if (hasTrustedActionEvidence(entry.event)) return false;
  const text = normalizeText(cursorEntryText(entry) || entry.event.detail || entry.event.label || '');
  return !text
    || /^(?:tool|backend tool|tool result|tool call|tool started|tool completed|tool completed[: ]+[a-z0-9_.-]+|tool started[: ]+[a-z0-9_.-]+)$/i.test(text)
    || text === normalizeText(nativeString(entry.event, 'toolName') ?? '');
}

function hasTrustedActionEvidence(event: AgentStreamEvent) {
  return Boolean(
    nativeString(event, 'command')
    || nativeString(event, 'diff')
    || nativeString(event, 'patch')
    || nativeString(event, 'stdout')
    || nativeString(event, 'stderr')
    || nativeString(event, 'outputSummary')
    || nativeString(event, 'output_summary')
    || nativeString(event, 'resultSummary')
    || nativeString(event, 'result_summary')
    || hasSpecificFileEvidence(event)
    || nativeString(event, 'fileRef')
    || nativeString(event, 'file_ref')
    || nativeNumber(event, 'exitCode') !== undefined
    || nativeNumber(event, 'exit_code') !== undefined
    || nativeFailureSignal(event)
    || workEvidenceRecordsForEvent(event).length
    || resultRefsForEvent(event).length
  );
}

function hasStrongActionEvidence(event: AgentStreamEvent) {
  return Boolean(
    nativeString(event, 'command')
    || nativeString(event, 'diff')
    || nativeString(event, 'patch')
    || hasSpecificFileEvidence(event)
    || nativeString(event, 'fileRef')
    || nativeString(event, 'file_ref')
    || nativeNumber(event, 'exitCode') !== undefined
    || nativeNumber(event, 'exit_code') !== undefined
    || nativeFailureSignal(event)
    || workEvidenceRecordsForEvent(event).length
    || resultRefsForEvent(event).length
  );
}

function hasSpecificFileEvidence(event: AgentStreamEvent) {
  const rawPath = firstString(
    nativeString(event, 'filePath'),
    nativeString(event, 'file_path'),
    nativeString(event, 'path'),
    nativeString(event, 'file'),
    nativeString(event, 'filename'),
  );
  if (!rawPath) return false;
  const path = rawPath.replace(/^file:/i, '').trim();
  return /^(?:\/|[A-Za-z]:[\\/]|\.{1,2}\/|[\w.-]+\/)/.test(path)
    || /\.[A-Za-z0-9][\w.-]*(?:[#?:].*)?$/.test(path);
}

function looksLikeUserInstructionEcho(value: string) {
  const text = normalizeText(value);
  if (text.length < 12) return false;
  return /\b(?:use the .*tool|run exactly|do not (?:read|run|edit|modify|write|infer|use)|only (?:answer|respond)|respond (?:only|in)|after the command runs|say whether|report the exit code|no tables?)\b/.test(text)
    || /(?:不要\s*(?:读取|读|运行|执行|修改|编辑|写入|使用|列太多)|不要读取文件|不要运行命令|不要修改任何文件|仅用中文回答|只用中文回答|请用\s*\d+\s*个短段落|不要表格|不要列太多项目)/.test(value);
}

function isAssistantTranscriptEvent(entry: StreamWorklogEntry) {
  const type = rawType(entry.event);
  if (!['message_delta', 'assistant_delta', 'text-delta', 'message'].includes(type)) return false;
  if (nativeString(entry.event, 'toolName') || nativeString(entry.event, 'command')) return false;
  const role = nativeString(entry.event, 'role')?.toLowerCase();
  return !role || role === 'assistant';
}

function isGenericProgressPlaceholder(entry: StreamWorklogEntry) {
  const type = rawType(entry.event);
  if (type !== 'process-progress' && type !== 'operation_progress' && type !== 'status' && entry.event.type !== 'process-progress') return false;
  const raw = record(entry.event.raw);
  const native = recordOrUndefined(raw.native) ?? raw;
  const progress = recordOrUndefined(raw.progress) ?? recordOrUndefined(native.progress);
  if (hasUserFacingStructuredProgress(entry)) return false;
  if (progress && [
    'phase',
    'title',
    'detail',
    'waitingFor',
    'waiting_for',
    'nextStep',
    'next_step',
  ].some((key) => stringField(progress[key]))) {
    const text = normalizeText(cursorEntryText(entry));
    return text === 'progress' || text === 'backend progress' || text === '进展' || isBackendTransportLifecycleText(text);
  }
  const text = normalizeText(cursorEntryText(entry) || entry.event.label || '');
  return text === '' || text === 'progress' || text === 'backend progress' || text === 'status' || text === '进展' || isBackendTransportLifecycleText(text);
}

function isWaitPlaceholder(entry: StreamWorklogEntry) {
  if (hasNativeLifecycleContent(entry.event)) return false;
  if (hasUserFacingStructuredProgress(entry)) return false;
  const raw = record(entry.event.raw);
  const progress = recordOrUndefined(raw.progress) ?? {};
  if (raw.silentStreamWaiting === true || raw.backendSilent === true) return true;
  const text = normalizeText([
    entry.operationLine,
    entry.presentation.detail,
    entry.presentation.shortDetail,
    cursorEntryText(entry),
    stringField(progress.phase),
    stringField(progress.reason),
    stringField(progress.title),
    stringField(progress.waitingFor),
    stringField(progress.nextStep),
    stringField(raw.reason),
    stringField(raw.waitingFor),
  ].filter(Boolean).join(' '));
  return isBackendTransportLifecycleText(text)
    || /没有输出新事件|没有收到新事件|http stream|codex cli|jsonl|后端\s*(?:<elapsed>|正在等|等待|没有|仍在)/.test(text);
}

function hasUserFacingStructuredProgress(entry: StreamWorklogEntry) {
  const raw = record(entry.event.raw);
  const native = recordOrUndefined(raw.native) ?? raw;
  const progress = recordOrUndefined(raw.progress) ?? recordOrUndefined(native.progress);
  if (!progress) return false;
  const structuredText = normalizeText([
    stringField(progress.phase),
    stringField(progress.reason),
    stringField(progress.title),
    stringField(progress.detail),
    stringField(progress.waitingFor),
    stringField(progress.waiting_for),
    stringField(progress.nextStep),
    stringField(progress.next_step),
  ].filter(Boolean).join(' '));
  if (isTransportWaitProgressText(structuredText)) return false;
  const reading = stringListField(progress.reading);
  const writing = stringListField(progress.writing);
  if (reading.length || writing.length) return true;
  const userFacingFacts = [
    stringField(progress.title),
    stringField(progress.detail),
    stringField(progress.nextStep),
    stringField(progress.next_step),
  ].filter(Boolean);
  return userFacingFacts.some((fact) => !isBackendTransportLifecycleText(normalizeText(fact ?? '')));
}

function isTransportWaitProgressText(text: string) {
  return /\b(?:codex cli|jsonl|http stream|codex app-server|rich-client|runtime event recorded|workspace runtime|backend progress)\b/i.test(text)
    || /(?:app-server|rich-client).*(?:事件|首个|下一条|正在等|等待|运行|启动)/i.test(text)
    || /(?:下一条|首个).*(?:backend|后端).*(?:事件|event)/i.test(text);
}

function isBackendTransportLifecycleText(text: string) {
  if (!text) return false;
  return /\b(?:codex app-server|rich-client|runtime event recorded|workspace runtime|backend event|backend progress)\b/.test(text)
    || /(?:app-server|rich-client).*(?:事件|首个|下一条|正在等|等待|运行|启动)/i.test(text)
    || /(?:正在启动|正在运行).*(?:app-server|backend|后端)/i.test(text)
    || /(?:下一条|首个).*(?:rich-client|backend|后端).*(?:事件|event)/i.test(text)
    || /底层(?:审计|诊断).*收起/.test(text);
}

function cursorEntryDedupeKey(entry: StreamWorklogEntry) {
  const command = sanitizeCursorText(nativeString(entry.event, 'command') ?? commandTextFromEntry(entry));
  const kind = actionKindForEntry(entry, rawType(entry.event), nativeString(entry.event, 'toolName'), command);
  const itemId = sanitizeCursorIdentifier(nativeString(entry.event, 'itemId') ?? nativeString(entry.event, 'item_id') ?? nativeString(entry.event, 'traceStepId') ?? nativeString(entry.event, 'trace_step_id'));
  const missingFileTargetKey = isFilePreviewActionKind(kind)
    && !fileTargetForEntry(entry.event, entry, kind, command)
    && itemId
    ? `:${itemId}`
    : '';
  return `${kind}:${normalizeText(cursorEntryText(entry))}${missingFileTargetKey}`;
}

function durationLabel(events: AgentStreamEvent[], now?: string) {
  const times = events.map((event) => Date.parse(event.createdAt)).filter(Number.isFinite);
  if (!times.length) return 'a moment';
  const start = Math.min(...times);
  const end = now ? Date.parse(now) : Math.max(...times);
  const seconds = Math.max(1, Math.round((Number.isFinite(end) ? end - start : 0) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function parseChangeSummary(value: string) {
  const match = value.match(/([+-]\d+(?:\s+[+-]\d+)?)/);
  return match?.[1];
}

function subagentTarget(text: string) {
  return text.match(/\b(?:agent|subagent|sub-agent)\s*(?:id|name|target)?\s*[:=]\s*["']?([A-Za-z0-9_.:-]{3,})/i)?.[1]
    ?? text.match(/\b(?:worker|explorer)\s+([A-Za-z0-9_.:-]{3,})/i)?.[1];
}

function record(value: unknown): Record<string, unknown> {
  return recordOrUndefined(value) ?? {};
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function boundedDetail(value: string | undefined) {
  const text = sanitizeCursorText(value).replace(/\s+/g, ' ').trim();
  if (text.length <= 1000) return text;
  return `${text.slice(0, 820).replace(/\s+\S*$/, '')} ... ${text.slice(-120)}`;
}

function boundedBlockDetail(value: string | undefined) {
  const text = sanitizeCursorText(value)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  if (!text) return undefined;
  if (text.length <= 4000) return text;
  return `${text.slice(0, 3200).replace(/\s+\S*$/, '')}\n...\n${text.slice(-500)}`;
}

function compactInline(value: string, limit: number) {
  const text = boundedDetail(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 18)).replace(/\s+\S*$/, '')} ... ${text.slice(-14)}`;
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\b\d+\s*(?:ms|s|sec|seconds)\b/g, '<elapsed>').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim()))));
}

function stringListField(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function firstString(...values: Array<string | undefined>) {
  return values.find((value) => value && value.trim()) ?? '';
}

function sanitizeCursorText(value: string | undefined) {
  return (value ?? '')
    .replace(/https?:\/\/[^\s"'`<>]+/gi, '[url]')
    .replace(/\b(Authorization|api[-_ ]?key|token|secret|password|credential)\b\s*[:=]\s*["']?[^"'\s,;)]+/gi, '$1=[redacted]')
    .replace(/\bAuthorization=\[redacted\]\s+[^\s"'`<>]+/gi, 'Authorization=[redacted]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .replace(/\bstarted\s+with\s+[^"'\s,;)]+\/[^"'\s,;)]+(?:\s+profile\s+[^"'\s,;)]+)?/gi, 'started with configured runtime')
    .replace(/\b(?:calling\s+local\s+model|using\s+model)\s+[^"'\s,;)]+\/[^"'\s,;)]+/gi, 'using configured model')
    .replace(/\b(model|provider)\b\s*[:=]\s*["']?[^"'\s,;)]+/gi, '$1=[redacted]')
    .replace(/\b(runtime\s+profile|profile)\b\s*[:=]?\s*["']?[^"'\s,;)]+/gi, '$1 [redacted]')
    .replace(/--model(?:=|\s+)[^\s"'`<>]+/gi, '--model [redacted]')
    .replace(/\bsk-[A-Za-z0-9._-]+/gi, '[redacted-secret]')
    .replace(/(?:\/Users|\/Applications|\/Volumes|\/private|\/var\/folders|\/tmp)\/[^\s"'`<>]+/g, (match) => `[local-path]/${pathBasename(match)}`)
    .trim();
}

function sanitizeCursorPath(value: string | undefined) {
  const text = sanitizeCursorText(value);
  if (!text) return undefined;
  if (text.startsWith('file:[local-path]/')) return `file:${text.slice('file:[local-path]/'.length)}`;
  if (text.startsWith('[local-path]/')) return text.slice('[local-path]/'.length);
  if (isRedactedPathToken(text)) return undefined;
  return text;
}

function isRedactedPathToken(value: string | undefined) {
  const text = (value ?? '').trim();
  return /^\[(?:redacted-path|local path)\]$/i.test(text)
    || /^\[local-path\](?:\/)?$/i.test(text);
}

function sanitizeCursorRef(value: string | undefined) {
  const text = sanitizeCursorText(value);
  if (!text || /\[redacted\]|\[url\]/.test(text)) return undefined;
  if (text.startsWith('file:')) {
    const filePath = text.slice('file:'.length);
    return isSafeRelativeRefPath(filePath) ? `file:${filePath}` : undefined;
  }
  if (text.startsWith('artifact:')) {
    const payload = text.slice('artifact:'.length);
    return isSafeArtifactRefPayload(payload) ? `artifact:${payload}` : undefined;
  }
  if (text.startsWith('[local-path]/')) return undefined;
  if (!isSafeOpaqueRef(text)) return undefined;
  return text;
}

function sanitizeCursorDiffRef(value: string | undefined) {
  const text = sanitizeCursorText(value);
  if (!text || /\[redacted\]|\[url\]/.test(text)) return undefined;
  if (text.startsWith('file:') || text.startsWith('artifact:')) return sanitizeCursorRef(text);
  if (/\.(?:diff|patch)$/i.test(text) && isSafeRelativeRefPath(text)) return `file:${text}`;
  return sanitizeCursorRef(text);
}

function sanitizeCursorIdentifier(value: string | undefined) {
  const text = sanitizeCursorText(value);
  if (!text || /\[redacted\]|\[url\]|\[local-path\]/.test(text)) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(text)) return undefined;
  if (/^(?:audit|trace|raw|stdout|stderr|provider):/i.test(text)) return undefined;
  if (/(?:^|[_.:-])(?:stdout|stderr|raw|log|logs|Users|Applications|Volumes|private|var|tmp|\.sciforge)(?:$|[_.:-])/i.test(text)) return undefined;
  if (text.includes('..') || text.startsWith('~')) return undefined;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(text)) return undefined;
  return text;
}

function sanitizeCursorObjectPreviewRef(value: string | undefined) {
  const ref = sanitizeCursorRef(value);
  return ref && (ref.startsWith('file:') || ref.startsWith('artifact:')) ? ref : undefined;
}

function sanitizeCursorResultRef(value: string | undefined) {
  const text = sanitizeCursorText(value);
  if (!text || /\[redacted\]|\[url\]|\[local-path\]/.test(text)) return undefined;
  if (text.startsWith('file:') || text.startsWith('artifact:')) return sanitizeCursorRef(text);
  const fileRef = fileRefFromStructuredPath(text);
  if (fileRef) return fileRef;
  if (isSafeResultOpaqueRef(text)) return text;
  return undefined;
}

function sanitizeCursorArtifactResultRef(value: string | undefined) {
  const text = sanitizeCursorText(value);
  if (!text || /\[redacted\]|\[url\]|\[local-path\]/.test(text)) return undefined;
  if (text.startsWith('artifact:')) return sanitizeCursorRef(text);
  if (text.startsWith('file:')) return sanitizeCursorObjectPreviewRef(text);
  if (!isSafeOpaqueRef(text)) return undefined;
  return `artifact:${text}`;
}

function isSafeResultOpaqueRef(value: string) {
  return isSafeOpaqueRef(value)
    || /^run:[A-Za-z0-9_.:-]{1,128}(?:#[A-Za-z0-9_.:-]{1,128})?$/.test(value.trim());
}

function pathBasename(path: string) {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? 'path';
}

function isSafeRelativeRefPath(value: string) {
  const normalized = value.replace(/\\/g, '/').trim();
  if (!normalized || normalized.startsWith('/') || normalized.includes('://')) return false;
  if (/\[(?:redacted-path|local path|local-path)\]/i.test(normalized)) return false;
  if (/[\r\n\t<>|?*:]/.test(normalized)) return false;
  if (normalized.startsWith('[local-path]/') || normalized.includes('[redacted]') || normalized.includes('[url]')) return false;
  if (normalized.split('/').some((part) => part === '..')) return false;
  if (/(?:^|\/)(?:Users|Applications|Volumes|private|var|tmp|\.sciforge)(?:\/|$)/i.test(normalized)) return false;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(normalized)) return false;
  return true;
}

function isSafeOpaqueRef(value: string) {
  const text = value.trim();
  if (!text || text.includes('://') || text.includes('[local-path]') || text.includes('[redacted]') || text.includes('[url]')) return false;
  if (/^(?:\/|file:\/)|(?:^|\s)(?:\/Users|\/Applications|\/Volumes|\/private|\/var\/folders|\/tmp)\//i.test(text)) return false;
  if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(text)) return false;
  if (/^(?:audit|trace|raw|stdout|stderr|provider):/i.test(text)) return false;
  if (/(?:^|[_.:-])(?:stdout|stderr|raw|log|logs)(?:$|[_.:-])/i.test(text)) return false;
  if (text.includes('..') || text.startsWith('~')) return false;
  if (/(?:^|[_.:-])(?:Users|Applications|Volumes|private|var|tmp|\.sciforge)(?:$|[_.:-])/i.test(text)) return false;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(text)) return false;
  return true;
}

function isSafeArtifactRefPayload(value: string) {
  return isSafeOpaqueRef(value);
}
