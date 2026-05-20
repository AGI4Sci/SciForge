import { createHash } from 'node:crypto';

export type NormalizedAgentEventType =
  | 'run_started'
  | 'gui_present'
  | 'message_delta'
  | 'message'
  | 'tool_started'
  | 'tool_completed'
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
  title?: string;
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

  const events: NormalizedAgentEvent[] = [rawJsonlAuditEvent(metadata, raw)];
  const guiPresent = guiPresentFromRaw(rawEvent, item);
  if (guiPresent) {
    events.push(guiPresentEvent(metadata, guiPresent));
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
      toolName,
      message: toolName ? `Tool started: ${toolName}` : 'Tool started.',
    }));
    return events;
  }

  if (/item\.completed|tool.*completed|function_call.*completed|exec.*completed/i.test(type)) {
    events.push(event(metadata, 'tool_completed', {
      itemId,
      toolName,
      message: toolName ? `Tool completed: ${toolName}` : 'Tool completed.',
    }));
  }

  return events;
}

function isCodexSamplingRetryMessage(value: string): boolean {
  return /Reconnecting\.\.\.\s+\d+\/\d+/i.test(value)
    || /stream disconnected - retrying sampling request/i.test(value);
}

function guiPresentFromRaw(
  rawEvent: Record<string, unknown>,
  item: Record<string, unknown>,
): Omit<GuiPresentRuntimePayload, 'source'> | undefined {
  const type = stringField(rawEvent.type) ?? stringField(rawEvent.event) ?? '';
  const itemStatus = stringField(item.status) ?? stringField(rawEvent.status) ?? '';
  const isCompleted = /completed|done|output/i.test(type) || /completed|done|ok|applied/i.test(itemStatus);
  if (!isCompleted) return undefined;
  const toolName = stringField(item.name)
    ?? stringField(item.tool_name)
    ?? stringField(rawEvent.tool_name)
    ?? stringField(rawEvent.name);
  if (toolName !== 'gui.present') return undefined;
  const args = parseJsonRecord(item.arguments)
    ?? parseJsonRecord(rawEvent.arguments)
    ?? parseJsonRecord(item.input)
    ?? parseJsonRecord(rawEvent.input)
    ?? {};
  const result = parseJsonRecord(item.result)
    ?? parseJsonRecord(rawEvent.result)
    ?? parseJsonRecord(item.output)
    ?? parseJsonRecord(rawEvent.output)
    ?? {};
  if (result.ok === false || result.applied === false) return undefined;
  const content = isRecord(args.content) ? args.content : {};
  const contentText = typeof content.value === 'string' ? content.value : undefined;
  const ref = stringField(args.ref);
  const title = stringField(args.title);
  const intent = stringField(args.intent);
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
    title,
    placement: placement
      ? {
          panel: stringField(placement.panel),
          viewId: stringField(placement.viewId),
        }
      : undefined,
  };
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
