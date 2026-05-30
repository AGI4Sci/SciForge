import { createHash } from 'node:crypto';

export type NormalizedAgentEventType =
  | 'run_started'
  | 'thread_started'
  | 'turn_started'
  | 'item_started'
  | 'item_completed'
  | 'gui_present'
  | 'gui_ask_user'
  | 'message_delta'
  | 'message'
  | 'tool_started'
  | 'tool_completed'
  | 'operation_progress'
  | 'audit'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface CodexRuntimeMetadata {
  provider: string;
  model: string;
  profile: string;
  workspace: string;
  commandId: string;
  attemptId: string;
  commandText?: string;
  codexSessionId?: string;
  runtimeSandbox?: string;
  evidenceRefs: string[];
  resumeRequested: boolean;
}

export interface NormalizedAgentEvent {
  schemaVersion: 'sciforge.codex.normalized-event.v1';
  type: NormalizedAgentEventType;
  timestamp: string;
  provider: string;
  model: string;
  profile: string;
  workspace: string;
  commandId: string;
  attemptId: string;
  codexSessionId?: string;
  evidenceRefs?: string[];
  message?: string;
  text?: string;
  itemId?: string;
  toolName?: string;
  command?: string;
  filePath?: string;
  fileRef?: string;
  ref?: string;
  diff?: string;
  outputSummary?: string;
  resultSummary?: string;
  status?: string;
  exitCode?: number | null;
  agentId?: string;
  parentAgentId?: string;
  transcriptRef?: string;
  refs?: string[];
  traceStepId?: string;
  signal?: NodeJS.Signals | string | null;
  raw?: unknown;
}

export interface GuiPresentRuntimePayload {
  source: string;
  text: string;
  intent?: string;
  ref?: string;
  displayedRefs?: string[];
  title?: string;
  hint?: string;
  placement?: { panel?: string; viewId?: string };
  intentLogId?: string;
}

export interface GuiAskUserRuntimePayload {
  source: string;
  kind: 'confirmation' | 'input' | 'choice' | string;
  title: string;
  message?: string;
  text: string;
  submitCommandTemplate?: string;
  choices?: Array<{ label: string; commandText: string; style?: string }>;
  approvalRequest?: Record<string, unknown>;
  relatedRefs?: string[];
  displayedRefs?: string[];
  placement?: { panel?: string; viewId?: string };
  intentLogId?: string;
}

export interface CodexExitResult {
  exitCode: number | null;
  signal: NodeJS.Signals | string | null;
  stderrSummary?: string;
}

export function commandIdForText(commandText: string, workspace: string): string {
  const digest = createHash('sha256')
    .update(workspace)
    .update('\0')
    .update(commandText)
    .update('\0')
    .update(String(Date.now()))
    .digest('hex')
    .slice(0, 16);
  return `codex-command-${digest}`;
}

export function attemptIdForCommand(commandId: string): string {
  return `${commandId}-attempt-${Date.now().toString(36)}`;
}

export function runStartedEvent(metadata: CodexRuntimeMetadata): NormalizedAgentEvent {
  return event(metadata, 'run_started', {
    message: `Runtime Codex started with ${metadata.provider}/${metadata.model} profile ${metadata.profile}`,
    raw: {
      commandText: metadata.commandText,
      commandId: metadata.commandId,
      attemptId: metadata.attemptId,
      workspace: metadata.workspace,
      profile: metadata.profile,
      runtimeSandbox: metadata.runtimeSandbox,
      codexSessionId: metadata.codexSessionId,
      resumeRequested: metadata.resumeRequested,
      evidenceRefs: metadata.evidenceRefs,
    },
  });
}

export function stderrAuditEvent(metadata: CodexRuntimeMetadata, chunk: string): NormalizedAgentEvent {
  return event(metadata, 'audit', {
    status: 'stderr',
    message: chunk,
    raw: { stream: 'stderr', chunk },
  });
}

export function rawJsonlAuditEvent(metadata: CodexRuntimeMetadata, raw: unknown): NormalizedAgentEvent {
  return event(metadata, 'audit', {
    status: 'raw-jsonl',
    raw,
  });
}

export function guiPresentEvent(metadata: CodexRuntimeMetadata, presentation: Omit<GuiPresentRuntimePayload, 'source'> & { source?: string }): NormalizedAgentEvent {
  const source = presentation.source ?? `gui.present:${metadata.commandId}`;
  return event(metadata, 'gui_present', {
    status: 'presented',
    message: presentation.text,
    text: presentation.text,
    raw: {
      boundary: 'gui-present-completion',
      source,
      presentation: {
        ...presentation,
        source,
      },
    },
  });
}

export function guiAskUserEvent(metadata: CodexRuntimeMetadata, askUser: Omit<GuiAskUserRuntimePayload, 'source'> & { source?: string }): NormalizedAgentEvent {
  const source = askUser.source ?? `gui.ask_user:${metadata.commandId}`;
  return event(metadata, 'gui_ask_user', {
    status: 'needs-confirmation',
    message: askUser.text,
    text: askUser.text,
    raw: {
      boundary: 'gui-ask-user-confirmation',
      source,
      askUser: {
        ...askUser,
        source,
      },
    },
  });
}

export function invalidJsonlAuditEvent(metadata: CodexRuntimeMetadata, line: string, error: unknown): NormalizedAgentEvent {
  return event(metadata, 'audit', {
    status: 'invalid-jsonl',
    message: error instanceof Error ? error.message : String(error),
    raw: { line },
  });
}

export function resumeFailureAuditEvent(metadata: CodexRuntimeMetadata, input: {
  exitCode: number | null;
  signal: NodeJS.Signals | string | null;
  stderrSummary?: string;
}): NormalizedAgentEvent {
  return event(metadata, 'audit', {
    status: 'resume-failed',
    message: [
      `Runtime Codex resume failed for thread ${metadata.codexSessionId ?? 'unknown'}.`,
      `exit=${input.exitCode ?? 'null'}`,
      input.signal ? `signal=${input.signal}` : '',
      input.stderrSummary ? `stderr=${input.stderrSummary}` : '',
    ].filter(Boolean).join(' '),
    exitCode: input.exitCode,
    signal: input.signal,
    raw: {
      boundary: 'resume-fail-closed',
      threadId: metadata.codexSessionId,
      exitCode: input.exitCode,
      signal: input.signal,
      stderrSummary: input.stderrSummary,
      profile: metadata.profile,
      workspace: metadata.workspace,
      commandId: metadata.commandId,
      attemptId: metadata.attemptId,
      evidenceRefs: metadata.evidenceRefs,
    },
  });
}

export function exitEvent(metadata: CodexRuntimeMetadata, result: CodexExitResult): NormalizedAgentEvent {
  if (result.signal) {
    return event(metadata, 'cancelled', {
      status: 'cancelled',
      message: `Runtime Codex was cancelled by signal ${result.signal}`,
      exitCode: result.exitCode,
      signal: result.signal,
    });
  }
  if (result.exitCode === 0) {
    return event(metadata, 'done', {
      status: 'done',
      message: 'Runtime Codex completed successfully.',
      exitCode: result.exitCode,
      signal: result.signal,
    });
  }
  return event(metadata, 'failed', {
    status: 'failed',
    message: `Runtime Codex exited with code ${result.exitCode ?? 1}.`,
    exitCode: result.exitCode,
    signal: result.signal,
    raw: {
      boundary: 'runtime-codex-exit',
      exitCode: result.exitCode,
      signal: result.signal,
      stderrSummary: result.stderrSummary,
      provider: metadata.provider,
      model: metadata.model,
      profile: metadata.profile,
      workspace: metadata.workspace,
      commandId: metadata.commandId,
      attemptId: metadata.attemptId,
      codexSessionId: metadata.codexSessionId,
      evidenceRefs: metadata.evidenceRefs,
    },
  });
}

export function normalizeCodexJsonlEvent(raw: unknown, metadata: CodexRuntimeMetadata): NormalizedAgentEvent[] {
  const codexSessionId = codexSessionIdFromRaw(raw);
  if (codexSessionId) metadata.codexSessionId = codexSessionId;
  const rawEvent = isRecord(raw) ? raw : {};
  const payload = isRecord(rawEvent.payload) ? rawEvent.payload : undefined;
  const type = stringField(rawEvent.type) ?? stringField(rawEvent.event) ?? stringField(payload?.type) ?? '';
  const item = isRecord(rawEvent.item) ? rawEvent.item : isRecord(payload?.item) ? payload.item : payload ?? rawEvent;
  const itemType = stringField(item.type) ?? stringField(payload?.type) ?? '';
  const text = textFromRaw(rawEvent) ?? textFromRaw(item) ?? (payload ? textFromRaw(payload) : undefined);
  const itemId = stringField(item.call_id) ?? stringField(rawEvent.call_id) ?? stringField(payload?.call_id) ?? stringField(item.id) ?? stringField(rawEvent.item_id) ?? stringField(rawEvent.id);
  const toolName = stringField(item.name)
    ?? stringField(item.tool_name)
    ?? stringField(rawEvent.tool_name)
    ?? stringField(rawEvent.name)
    ?? stringField(payload?.name);
  const command = commandFromRaw(rawEvent, item, payload);
  const normalizedToolName = toolName ?? toolNameFromItemType(itemType, command);
  const itemStatus = stringField(item.status) ?? stringField(rawEvent.status) ?? stringField(payload?.status);
  const exitCode = numberField(item.exit_code) ?? numberField(item.exitCode) ?? numberField(rawEvent.exit_code) ?? numberField(rawEvent.exitCode);
  const rawOutputText = commandOutputText(item) ?? (payload ? commandOutputText(payload) : undefined) ?? commandOutputText(rawEvent);
  const rawOutputSummary = commandOutputSummary(item) ?? (payload ? commandOutputSummary(payload) : undefined) ?? commandOutputSummary(rawEvent);
  const diff = diffTextFromToolOutput(rawOutputText);
  const filePreview = filePreviewMetadataFromTool(rawEvent, item, payload, normalizedToolName);
  const subagent = subagentMetadataFromTool(rawEvent, item, payload, normalizedToolName);
  const outputSummary = subagent.agentId || subagent.transcriptRef || subagent.ref
    ? subagent.resultSummary
    : rawOutputSummary;

  const events: NormalizedAgentEvent[] = [rawJsonlAuditEvent(metadata, raw)];
  const guiPresent = guiPresentFromRaw(rawEvent, item);
  if (guiPresent) {
    events.push(guiPresentEvent(metadata, guiPresent));
    return events;
  }
  const guiAskUser = guiAskUserFromRaw(rawEvent, item);
  if (guiAskUser) {
    events.push(guiAskUserEvent(metadata, guiAskUser));
    return events;
  }

  if (/error|failed|failure/i.test(type)) {
    if (text && isCodexSamplingRetryMessage(text)) {
      events.push(event(metadata, 'audit', {
        status: 'provider-retry',
        message: text,
        itemId,
        raw,
      }));
      return events;
    }
    events.push(event(metadata, 'failed', {
      status: 'failed',
      message: text ?? stringField(rawEvent.message) ?? type,
      itemId,
      raw,
    }));
    return events;
  }

  if (/agent_message_delta|message_delta|response\.output_text\.delta|delta/i.test(type) && text) {
    events.push(event(metadata, 'message_delta', { text, itemId }));
    return events;
  }

  if ((/agent_message|message|response\.output_text\.done/i.test(type) || /agent_message|message/i.test(itemType)) && text) {
    events.push(event(metadata, 'message', { text, itemId }));
    return events;
  }

  if (isToolStartEvent(type, itemType)) {
    events.push(event(metadata, 'tool_started', {
      itemId,
      toolName: normalizedToolName,
      command,
      ...filePreview,
      ...subagent,
      status: itemStatus ?? 'in_progress',
      message: toolLifecycleMessage('started', normalizedToolName, command, itemStatus),
    }));
    return events;
  }

  if (isToolCompleteEvent(type, itemType)) {
    events.push(event(metadata, 'tool_completed', {
      itemId,
      toolName: normalizedToolName,
      command,
      ...filePreview,
      ...subagent,
      diff,
      outputSummary,
      status: itemStatus ?? 'completed',
      exitCode,
      message: toolLifecycleMessage('completed', normalizedToolName, command, itemStatus, exitCode, outputSummary),
    }));
  }

  return events;
}

function guiAskUserFromRaw(
  rawEvent: Record<string, unknown>,
  item: Record<string, unknown>,
): Omit<GuiAskUserRuntimePayload, 'source'> & { source?: string } | undefined {
  const type = stringField(rawEvent.type) ?? stringField(rawEvent.event) ?? '';
  const itemStatus = stringField(item.status) ?? stringField(rawEvent.status) ?? '';
  const isCompleted = /completed|done|output/i.test(type) || /completed|done|ok|applied/i.test(itemStatus);
  if (!isCompleted) return undefined;
  const toolName = stringField(item.name)
    ?? stringField(item.tool_name)
    ?? stringField(rawEvent.tool_name)
    ?? stringField(rawEvent.name);
  const rawArgs = parseJsonRecord(item.arguments)
    ?? parseJsonRecord(rawEvent.arguments)
    ?? parseJsonRecord(item.input)
    ?? parseJsonRecord(rawEvent.input)
    ?? {};
  const guiIntent = guiIntentFromToolCall(toolName, rawArgs);
  if (guiIntent.name !== 'gui.ask_user') return undefined;
  const args = guiIntent.args;
  const result = moduleResultValue(parseJsonRecord(item.result)
    ?? parseJsonRecord(rawEvent.result)
    ?? parseJsonRecord(item.output)
    ?? parseJsonRecord(rawEvent.output)
    ?? {});
  if (result.ok === false || result.applied === false) return undefined;
  const approvalRequest = parseJsonRecord(args.approvalRequest) ?? parseJsonRecord(args.approval_request);
  const title = stringField(args.title) ?? stringField(approvalRequest?.title) ?? 'Computer Use confirmation required';
  const message = stringField(args.message)
    ?? stringField(approvalRequest?.prompt)
    ?? stringField(approvalRequest?.message);
  const kind = stringField(args.kind) ?? 'confirmation';
  const choices = normalizeGuiChoices(args.choices);
  const relatedRefs = stringArrayField(args.relatedRefs) ?? stringArrayField(args.displayedRefs);
  const text = formatGuiAskUserText({
    title,
    message,
    choices,
    relatedRefs,
    approvalRequest,
  });
  const placement = isRecord(result.placement) ? result.placement : undefined;
  return {
    kind,
    title,
    message,
    text,
    submitCommandTemplate: stringField(args.submitCommandTemplate),
    choices,
    approvalRequest,
    relatedRefs,
    displayedRefs: relatedRefs,
    source: guiIntent.source,
    placement: placement
      ? {
          panel: stringField(placement.panel),
          viewId: stringField(placement.viewId),
        }
      : undefined,
  };
}

function isCodexSamplingRetryMessage(value: string): boolean {
  return /Reconnecting\.\.\.\s+\d+\/\d+/i.test(value)
    || /stream disconnected - retrying sampling request/i.test(value);
}

function guiPresentFromRaw(
  rawEvent: Record<string, unknown>,
  item: Record<string, unknown>,
): Omit<GuiPresentRuntimePayload, 'source'> & { source?: string } | undefined {
  const type = stringField(rawEvent.type) ?? stringField(rawEvent.event) ?? '';
  const itemStatus = stringField(item.status) ?? stringField(rawEvent.status) ?? '';
  const isCompleted = /completed|done|output/i.test(type) || /completed|done|ok|applied/i.test(itemStatus);
  if (!isCompleted) return undefined;
  const toolName = stringField(item.name)
    ?? stringField(item.tool_name)
    ?? stringField(rawEvent.tool_name)
    ?? stringField(rawEvent.name);
  const rawArgs = parseJsonRecord(item.arguments)
    ?? parseJsonRecord(rawEvent.arguments)
    ?? parseJsonRecord(item.input)
    ?? parseJsonRecord(rawEvent.input)
    ?? {};
  const guiIntent = guiIntentFromToolCall(toolName, rawArgs);
  if (guiIntent.name !== 'gui.present') return undefined;
  const args = guiIntent.args;
  const result = moduleResultValue(parseJsonRecord(item.result)
    ?? parseJsonRecord(rawEvent.result)
    ?? parseJsonRecord(item.output)
    ?? parseJsonRecord(rawEvent.output)
    ?? {});
  if (result.ok === false || result.applied === false) return undefined;
  const content = isRecord(args.content) ? args.content : {};
  const contentText = typeof content.value === 'string' ? content.value : undefined;
  const ref = stringField(args.ref);
  const title = stringField(args.title);
  const intent = stringField(args.intent);
  const hint = stringField(args.hint) ?? stringField(content.kind);
  const text = contentText
    ?? title
    ?? (ref ? `Presented ${ref}.` : undefined)
    ?? stringField(result.summary)
    ?? stringField(result.message);
  if (!text?.trim()) return undefined;
  const placement = isRecord(result.placement) ? result.placement : isRecord(args.target) ? args.target : undefined;
  return {
    text: text.trim(),
    intent,
    ref,
    displayedRefs: stringArrayField(args.displayedRefs) ?? (ref ? [ref] : undefined),
    title,
    hint,
    source: guiIntent.source,
    placement: placement
      ? {
          panel: stringField(placement.panel),
          viewId: stringField(placement.viewId),
        }
      : undefined,
  };
}

function formatGuiAskUserText(input: {
  title: string;
  message?: string;
  choices?: Array<{ label: string; commandText: string; style?: string }>;
  relatedRefs?: string[];
  approvalRequest?: Record<string, unknown>;
}) {
  const risk = stringField(input.approvalRequest?.riskLevel) ?? stringField(input.approvalRequest?.risk);
  const lines = [
    `## ${humanGuiAskUserTitle(input.title)}`,
    humanGuiAskUserMessage(input.message),
    risk ? `Risk: ${humanGuiRiskLabel(risk)}` : undefined,
    input.relatedRefs?.length ? `${input.relatedRefs.length} related item${input.relatedRefs.length === 1 ? '' : 's'} available.` : undefined,
  ].filter(Boolean);
  return lines.join('\n\n');
}

function humanGuiAskUserTitle(value: string) {
  return (value || 'Confirmation required')
    .replace(/\bComputer Use confirmation required\b/gi, 'Confirmation required')
    .replace(/\bComputer Use\b/gi, 'Operation')
    .replace(/\bgui\.(?:present|ask_user)\b/gi, 'Operation')
    .replace(/\s+/g, ' ')
    .trim() || 'Confirmation required';
}

function humanGuiAskUserMessage(value: string | undefined) {
  return (value || 'Confirmation is required before continuing.')
    .replace(/\bComputer Use\b/gi, 'the operation')
    .replace(/\bgui\.(?:present|ask_user)\b/gi, 'the operation')
    .replace(/\s+/g, ' ')
    .trim();
}

function humanGuiRiskLabel(value: string) {
  const risk = value.trim().toLowerCase();
  if (risk === 'high') return 'High';
  if (risk === 'medium') return 'Medium';
  if (risk === 'low') return 'Low';
  return value.trim();
}

function guiIntentFromToolCall(
  toolName: string | undefined,
  args: Record<string, unknown>,
): { name?: string; args: Record<string, unknown>; source?: string } {
  // Legacy gui.* names are normalized only for event compatibility; module.invoke is canonical.
  if (toolName === 'gui.present' || toolName === 'gui.ask_user') return { name: toolName, args };
  if (toolName !== 'module.invoke') return { args };
  const moduleId = stringField(args.moduleId);
  const intent = stringField(args.intent);
  if (moduleId !== 'gui' || !intent) return { args };
  const input = parseJsonRecord(args.input) ?? {};
  if (intent === 'present') return { name: 'gui.present', args: input, source: 'gui.present:module.invoke' };
  if (intent === 'ask_user') return { name: 'gui.ask_user', args: input, source: 'gui.ask_user:module.invoke' };
  return { args };
}

function moduleResultValue(result: Record<string, unknown>): Record<string, unknown> {
  if (result.schemaVersion === 'sciforge.module-contract.v1' && isRecord(result.value)) return result.value;
  return result;
}

function normalizeGuiChoices(value: unknown): Array<{ label: string; commandText: string; style?: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const choices = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const label = stringField(item.label);
    const commandText = stringField(item.commandText);
    if (!label || !commandText) return [];
    return [{
      label,
      commandText,
      style: stringField(item.style),
    }];
  });
  return choices.length ? choices : undefined;
}

function stringArrayField(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return entries.length ? entries : undefined;
}

export function codexSessionIdFromRaw(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined;
  const payload = isRecord(raw.payload) ? raw.payload : undefined;
  const candidates = [
    raw.session_id,
    raw.sessionId,
    raw.conversation_id,
    raw.conversationId,
    raw.thread_id,
    raw.threadId,
    payload?.id,
    payload?.session_id,
    payload?.sessionId,
    payload?.conversation_id,
    payload?.conversationId,
    payload?.thread_id,
    payload?.threadId,
  ];
  return candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
}

export function event(
  metadata: CodexRuntimeMetadata,
  type: NormalizedAgentEventType,
  extra: Omit<Partial<NormalizedAgentEvent>, 'schemaVersion' | 'type' | 'timestamp' | keyof CodexRuntimeMetadata> = {},
): NormalizedAgentEvent {
  return {
    schemaVersion: 'sciforge.codex.normalized-event.v1',
    type,
    timestamp: new Date().toISOString(),
    provider: metadata.provider,
    model: metadata.model,
    profile: metadata.profile,
    workspace: metadata.workspace,
    commandId: metadata.commandId,
    attemptId: metadata.attemptId,
    codexSessionId: metadata.codexSessionId,
    evidenceRefs: metadata.evidenceRefs,
    ...extra,
  };
}

function textFromRaw(value: Record<string, unknown>): string | undefined {
  const error = isRecord(value.error) ? value.error : undefined;
  return stringField(value.text)
    ?? stringField(value.delta)
    ?? stringField(value.message)
    ?? stringField(error?.message)
    ?? stringField(value.output_text)
    ?? stringField(value.content)
    ?? textFromContent(value.content);
}

function commandFromRaw(
  rawEvent: Record<string, unknown>,
  item: Record<string, unknown>,
  payload: Record<string, unknown> | undefined,
): string | undefined {
  const argumentCommand = commandFromToolArguments(item.arguments)
    ?? commandFromToolArguments(item.input)
    ?? commandFromToolArguments(rawEvent.arguments)
    ?? commandFromToolArguments(rawEvent.input)
    ?? commandFromToolArguments(payload?.arguments)
    ?? commandFromToolArguments(payload?.input);
  return compactRuntimeText(
    stringField(item.command)
      ?? stringField(item.cmd)
      ?? argumentCommand
      ?? stringField(rawEvent.command)
      ?? stringField(rawEvent.cmd)
      ?? stringField(payload?.command)
      ?? stringField(payload?.cmd),
    260,
  );
}

function commandFromToolArguments(value: unknown): string | undefined {
  const record = parseJsonRecord(value) ?? (isRecord(value) ? value : undefined);
  if (!record) return undefined;
  const nested = parseJsonRecord(record.input) ?? parseJsonRecord(record.args) ?? parseJsonRecord(record.arguments);
  const candidate = firstString(
    stringField(record.command),
    stringField(record.cmd),
    stringField(record.shellCommand),
    stringField(record.shell_command),
    stringField(record.script),
    stringField(nested?.command),
    stringField(nested?.cmd),
    stringField(nested?.shellCommand),
    stringField(nested?.shell_command),
    stringField(nested?.script),
  );
  return compactRuntimeText(candidate, 260);
}

function toolNameFromItemType(itemType: string, command: string | undefined): string | undefined {
  if (/command_execution|exec|shell|terminal/i.test(itemType) || command) return 'shell';
  if (/function_call/i.test(itemType)) return 'function_call';
  return itemType || undefined;
}

function isToolStartEvent(type: string, itemType: string) {
  return /item\.started|tool.*started|function_call.*started|exec.*started/i.test(type)
    || (/^response_item$/i.test(type) && /^function_call$/i.test(itemType));
}

function isToolCompleteEvent(type: string, itemType: string) {
  return /item\.completed|tool.*completed|function_call.*completed|exec.*completed/i.test(type)
    || (/^response_item$/i.test(type) && /^function_call_output$/i.test(itemType));
}

function commandOutputText(value: Record<string, unknown>): string | undefined {
  return stringField(value.output_summary)
    ?? stringField(value.outputSummary)
    ?? stringField(value.aggregated_output)
    ?? stringField(value.output)
    ?? stringField(value.result);
}

function commandOutputSummary(value: Record<string, unknown>): string | undefined {
  return compactRuntimeText(
    commandOutputText(value),
    320,
  );
}

function diffTextFromToolOutput(value: string | undefined): string | undefined {
  if (!looksLikeUnifiedDiff(value)) return undefined;
  return compactRuntimeBlockText(value, 12_000);
}

function filePreviewMetadataFromTool(
  rawEvent: Record<string, unknown>,
  item: Record<string, unknown>,
  payload: Record<string, unknown> | undefined,
  toolName: string | undefined,
): Pick<NormalizedAgentEvent, 'filePath' | 'fileRef'> {
  if (!isFilePreviewToolName(toolName)) return {};
  const records = filePreviewCandidateRecords(rawEvent, item, payload);
  const explicitRef = firstStringField(records, 'fileRef', 'file_ref', 'ref');
  const safeExplicitRef = safeExplicitPreviewRef(explicitRef);
  if (safeExplicitRef?.startsWith('artifact:')) return { fileRef: safeExplicitRef };
  const explicitRefPath = safeExplicitRef?.startsWith('file:')
    ? safeExplicitRef.slice('file:'.length)
    : undefined;
  const structuredPath = firstStringField(records, 'filePath', 'file_path', 'path', 'file', 'filename');
  const safePath = safeRelativePreviewPath(structuredPath) ?? explicitRefPath;
  return {
    filePath: safePath,
    fileRef: safePath ? `file:${safePath}` : safeExplicitRef,
  };
}

function subagentMetadataFromTool(
  rawEvent: Record<string, unknown>,
  item: Record<string, unknown>,
  payload: Record<string, unknown> | undefined,
  toolName: string | undefined,
): Pick<NormalizedAgentEvent, 'ref' | 'agentId' | 'parentAgentId' | 'transcriptRef' | 'resultSummary' | 'refs'> {
  const candidates = subagentCandidateRecords(rawEvent, item, payload);
  const records = candidates.ordered;
  const resultRecords = candidates.resultRecords.length ? candidates.resultRecords : records;
  const hasSubagentShape = isSubagentToolName(toolName)
    || records.some((record) => firstStringField([record], 'agentId', 'agent_id', 'parentAgentId', 'parent_agent_id', 'transcriptRef', 'transcript_ref'));
  if (!hasSubagentShape) return {};
  const ref = resultRecords
    .flatMap((record) => [
      firstStringField([record], 'ref', 'resultRef', 'result_ref', 'artifactRef', 'artifact_ref', 'outputRef', 'output_ref'),
      ...(stringArrayField(record.refs) ?? []),
      ...(stringArrayField(record.evidenceRefs) ?? []),
      ...(stringArrayField(record.evidence_refs) ?? []),
      ...(stringArrayField(record.artifactRefs) ?? []),
      ...(stringArrayField(record.artifact_refs) ?? []),
    ].map(safeExplicitPreviewRef))
    .find(Boolean);
  const refs = uniqueRuntimeRefs(resultRecords.flatMap((record) => [
    ...(stringArrayField(record.refs) ?? []),
    ...(stringArrayField(record.evidenceRefs) ?? []),
    ...(stringArrayField(record.evidence_refs) ?? []),
    ...(stringArrayField(record.artifactRefs) ?? []),
    ...(stringArrayField(record.artifact_refs) ?? []),
  ].map(safeOpaqueRuntimeRef)));
  return {
    ref,
    agentId: safeRuntimeIdentifier(firstStringField(records, 'agentId', 'agent_id', 'agentPath', 'agent_path')),
    parentAgentId: safeRuntimeIdentifier(firstStringField(records, 'parentAgentId', 'parent_agent_id', 'parentId', 'parent_id')),
    transcriptRef: safeOpaqueRuntimeRef(firstStringField(resultRecords, 'transcriptRef', 'transcript_ref', 'transcriptArtifactRef', 'transcript_artifact_ref'))
      ?? safeOpaqueRuntimeRef(firstStringField(records, 'transcriptRef', 'transcript_ref', 'transcriptArtifactRef', 'transcript_artifact_ref')),
    resultSummary: compactRuntimeText(firstStringField(resultRecords, 'resultSummary', 'result_summary', 'summary') ?? firstStringField(records, 'resultSummary', 'result_summary', 'summary'), 320),
    refs: refs.length ? refs : undefined,
  };
}

function subagentCandidateRecords(
  rawEvent: Record<string, unknown>,
  item: Record<string, unknown>,
  payload: Record<string, unknown> | undefined,
) {
  const roots = [item, rawEvent, payload].filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const rootRecords: Record<string, unknown>[] = [];
  const resultRecords: Record<string, unknown>[] = [];
  const inputRecords: Record<string, unknown>[] = [];
  for (const root of roots) {
    rootRecords.push(root);
    for (const key of ['result', 'output'] as const) pushParsedCandidateRecords(resultRecords, root[key]);
    for (const key of ['arguments', 'args', 'input', 'parameters', 'params'] as const) pushParsedCandidateRecords(inputRecords, root[key]);
  }
  return {
    resultRecords,
    ordered: uniqueRecordReferences([...resultRecords, ...rootRecords, ...inputRecords]),
  };
}

function pushParsedCandidateRecords(out: Record<string, unknown>[], value: unknown) {
  const parsed = parseJsonRecord(value);
  if (!parsed) return;
  out.push(parsed);
  for (const key of ['value', 'result', 'output', 'input', 'arguments', 'args'] as const) {
    const nested = parseJsonRecord(parsed[key]);
    if (nested) out.push(nested);
  }
}

function uniqueRecordReferences(records: Record<string, unknown>[]) {
  return records.filter((record, index) => records.indexOf(record) === index);
}

function filePreviewCandidateRecords(
  rawEvent: Record<string, unknown>,
  item: Record<string, unknown>,
  payload: Record<string, unknown> | undefined,
): Record<string, unknown>[] {
  const roots = [item, rawEvent, payload].filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const records: Record<string, unknown>[] = [];
  for (const root of roots) {
    records.push(root);
    for (const key of ['arguments', 'args', 'input', 'parameters', 'params', 'result', 'output'] as const) {
      const parsed = parseJsonRecord(root[key]);
      if (!parsed) continue;
      records.push(parsed);
      const nestedInput = parseJsonRecord(parsed.input);
      if (nestedInput) records.push(nestedInput);
      const nestedValue = parseJsonRecord(parsed.value);
      if (nestedValue) records.push(nestedValue);
    }
  }
  return records;
}

function firstStringField(records: Record<string, unknown>[], ...keys: string[]): string | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = stringField(record[key]);
      if (value?.trim()) return value.trim();
    }
  }
  return undefined;
}

function firstString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value?.trim()));
}

function isFilePreviewToolName(toolName: string | undefined) {
  return /^(?:read_file|file_read|open_file|read|open|cat|write_file|file_write|write|edit_file|file_edit|edit|create_file|create|delete_file|delete|move_file|move|apply_patch|diff|patch)$/i.test(toolName ?? '');
}

function isSubagentToolName(toolName: string | undefined) {
  return /^(?:multi_agent_v1\.spawn_agent|spawn_agent|subagent|sub_agent|sub-agent|agent_spawn|delegate)$/i.test(toolName ?? '');
}

function safeExplicitPreviewRef(value: string | undefined): string | undefined {
  const text = value?.trim().replace(/\\/g, '/');
  if (!text) return undefined;
  if (text.startsWith('file:')) {
    const path = safeRelativePreviewPath(text.slice('file:'.length));
    return path ? `file:${path}` : undefined;
  }
  if (text.startsWith('artifact:')) {
    const opaque = text.slice('artifact:'.length);
    return isSafeOpaquePreviewRef(opaque) ? `artifact:${opaque}` : undefined;
  }
  return undefined;
}

function safeOpaqueRuntimeRef(value: string | undefined): string | undefined {
  const text = value?.trim().replace(/\\/g, '/');
  if (!text) return undefined;
  if (text.startsWith('file:') || text.startsWith('artifact:')) return safeExplicitPreviewRef(text);
  return isSafeOpaquePreviewRef(text) ? text : undefined;
}

function safeRuntimeIdentifier(value: string | undefined): string | undefined {
  const text = value?.trim().replace(/\\/g, '/');
  if (!text) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(text)) return undefined;
  if (text.startsWith('/') || text.startsWith('~') || text.includes('://')) return undefined;
  if (text.includes('..')) return undefined;
  if (/^(?:audit|trace|raw|stdout|stderr|provider):/i.test(text)) return undefined;
  if (/(?:^|[_.:-])(?:stdout|stderr|raw|log|logs|Users|Applications|Volumes|private|var|tmp|\.sciforge)(?:$|[_.:-])/i.test(text)) return undefined;
  if (/\[local-path\]|\[redacted\]|\[url\]/i.test(text)) return undefined;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(text)) return undefined;
  return text;
}

function uniqueRuntimeRefs(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function safeRelativePreviewPath(value: string | undefined): string | undefined {
  const text = value?.trim().replace(/\\/g, '/');
  if (!text) return undefined;
  if (text.startsWith('file:')) return safeRelativePreviewPath(text.slice('file:'.length));
  if (text.startsWith('artifact:')) return undefined;
  if (/^(?:\/|[A-Za-z]:\/)/.test(text) || text.includes('://')) return undefined;
  if (/[\r\n\t<>|?*:]/.test(text)) return undefined;
  if (text.split('/').some((part) => part === '..')) return undefined;
  if (/(?:^|\/)(?:Users|Applications|Volumes|private|var|tmp|\.sciforge)(?:\/|$)/i.test(text)) return undefined;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(text)) return undefined;
  return text;
}

function isSafeOpaquePreviewRef(value: string) {
  const text = value.trim();
  if (!text || text.startsWith('/') || text.startsWith('~') || text.includes('://')) return false;
  if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(text)) return false;
  if (/[\r\n\t<>|?*]/.test(text)) return false;
  if (text.includes('..')) return false;
  if (/^(?:audit|trace|raw|stdout|stderr|provider):/i.test(text)) return false;
  if (/(?:^|[_.:-])(?:stdout|stderr|raw|log|logs)(?:$|[_.:-])/i.test(text)) return false;
  if (/(?:^|[_.:-])(?:Users|Applications|Volumes|private|var|tmp|\.sciforge)(?:$|[_.:-])/i.test(text)) return false;
  if (/\[local-path\]|\[redacted\]|\[url\]/i.test(text)) return false;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(text)) return false;
  return true;
}

function toolLifecycleMessage(
  phase: 'started' | 'completed',
  toolName: string | undefined,
  command: string | undefined,
  status: string | undefined,
  exitCode?: number | null,
  outputSummary?: string,
) {
  const title = command
    ? `Shell command ${phase}: ${command}`
    : toolName
      ? `Tool ${phase}: ${toolName}`
      : `Tool ${phase}.`;
  const suffix = [
    status ? `status=${status}` : undefined,
    exitCode !== undefined && exitCode !== null ? `exit=${exitCode}` : undefined,
    outputSummary ? `output=${outputSummary}` : undefined,
  ].filter(Boolean);
  return suffix.length ? `${title} (${suffix.join(', ')})` : title;
}

function compactRuntimeText(value: string | undefined, limit: number): string | undefined {
  if (!value?.trim()) return undefined;
  const redacted = redactRuntimeText(value).replace(/\s+/g, ' ').trim();
  if (redacted.length <= limit) return redacted;
  return `${redacted.slice(0, Math.max(0, limit - 18)).replace(/\s+\S*$/, '')} ... ${redacted.slice(-14)}`;
}

function compactRuntimeBlockText(value: string | undefined, limit: number): string | undefined {
  if (!value?.trim()) return undefined;
  const redacted = redactRuntimeText(value)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  if (!redacted) return undefined;
  if (redacted.length <= limit) return redacted;
  return `${redacted.slice(0, Math.max(0, limit - 2_000)).replace(/\s+\S*$/, '')}\n...\n${redacted.slice(-1_500)}`;
}

function looksLikeUnifiedDiff(value: string | undefined) {
  const text = value?.trim();
  if (!text) return false;
  return /^diff --git\s+/m.test(text)
    || /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/m.test(text)
    || (/^---\s+\S+/m.test(text) && /^\+\+\+\s+\S+/m.test(text));
}

function redactRuntimeText(value: string): string {
  return value
    .replace(/\bBearer\s+([A-Za-z0-9._~+/=-]{8,})/gi, 'Bearer [redacted-secret]')
    .replace(
      /\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|authorization)\b\s*[:=]\s*["']?([^"'\s,;)}\]]{8,})/gi,
      (_match, label: string) => `${label}=[redacted-secret]`,
    )
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g, '[redacted-secret]')
    .replace(/https?:\/\/[^\s"'<>\\)]+/gi, '[redacted-url]');
}

function numberField(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function textFromContent(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const text = value.map((entry) => {
    if (!isRecord(entry)) return undefined;
    return stringField(entry.text) ?? stringField(entry.content);
  }).filter((entry): entry is string => Boolean(entry)).join('');
  return text || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
