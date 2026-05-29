import { createHash } from 'node:crypto';

export type NormalizedAgentEventType =
  | 'run_started'
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
  outputSummary?: string;
  status?: string;
  exitCode?: number | null;
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
  const itemId = stringField(item.id) ?? stringField(rawEvent.item_id) ?? stringField(rawEvent.id);
  const toolName = stringField(item.name)
    ?? stringField(item.tool_name)
    ?? stringField(rawEvent.tool_name)
    ?? stringField(rawEvent.name)
    ?? stringField(payload?.name);
  const command = commandFromRaw(rawEvent, item, payload);
  const normalizedToolName = toolName ?? toolNameFromItemType(itemType, command);
  const itemStatus = stringField(item.status) ?? stringField(rawEvent.status) ?? stringField(payload?.status);
  const exitCode = numberField(item.exit_code) ?? numberField(item.exitCode) ?? numberField(rawEvent.exit_code) ?? numberField(rawEvent.exitCode);
  const outputSummary = commandOutputSummary(item) ?? (payload ? commandOutputSummary(payload) : undefined) ?? commandOutputSummary(rawEvent);

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

  if (/item\.started|tool.*started|function_call.*started|exec.*started/i.test(type)) {
    events.push(event(metadata, 'tool_started', {
      itemId,
      toolName: normalizedToolName,
      command,
      status: itemStatus ?? 'in_progress',
      message: toolLifecycleMessage('started', normalizedToolName, command, itemStatus),
    }));
    return events;
  }

  if (/item\.completed|tool.*completed|function_call.*completed|exec.*completed/i.test(type)) {
    events.push(event(metadata, 'tool_completed', {
      itemId,
      toolName: normalizedToolName,
      command,
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
  const approvalId = stringField(input.approvalRequest?.id) ?? stringField(input.approvalRequest?.approvalRef);
  const actionRef = stringField(input.approvalRequest?.actionRef);
  const lines = [
    `## ${input.title}`,
    input.message,
    risk ? `Risk: \`${risk}\`` : undefined,
    approvalId ? `Approval ref: \`${approvalId}\`` : undefined,
    actionRef ? `Action ref: \`${actionRef}\`` : undefined,
    input.relatedRefs?.length ? ['Evidence refs:', ...input.relatedRefs.map((ref) => `- \`${ref}\``)].join('\n') : undefined,
    input.choices?.length ? ['Choices:', ...input.choices.map((choice) => `- ${choice.label}: \`${choice.commandText}\``)].join('\n') : undefined,
  ].filter(Boolean);
  return lines.join('\n\n');
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
  return compactRuntimeText(
    stringField(item.command)
      ?? stringField(item.cmd)
      ?? stringField(rawEvent.command)
      ?? stringField(rawEvent.cmd)
      ?? stringField(payload?.command)
      ?? stringField(payload?.cmd),
    260,
  );
}

function toolNameFromItemType(itemType: string, command: string | undefined): string | undefined {
  if (/command_execution|exec|shell|terminal/i.test(itemType) || command) return 'shell';
  if (/function_call/i.test(itemType)) return 'function_call';
  return itemType || undefined;
}

function commandOutputSummary(value: Record<string, unknown>): string | undefined {
  return compactRuntimeText(
    stringField(value.output_summary)
      ?? stringField(value.outputSummary)
      ?? stringField(value.aggregated_output)
      ?? stringField(value.output)
      ?? stringField(value.result),
    320,
  );
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
