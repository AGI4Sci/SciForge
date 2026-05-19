import { createHash } from 'node:crypto';

export type NormalizedAgentEventType =
  | 'run_started'
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
  commandText?: string;
  codexSessionId?: string;
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
  codexSessionId?: string;
  message?: string;
  text?: string;
  itemId?: string;
  toolName?: string;
  status?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | string | null;
  raw?: unknown;
}

export interface CodexExitResult {
  exitCode: number | null;
  signal: NodeJS.Signals | string | null;
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
  return `codex-${digest}`;
}

export function runStartedEvent(metadata: CodexRuntimeMetadata): NormalizedAgentEvent {
  return event(metadata, 'run_started', {
    message: `Runtime Codex started with ${metadata.provider}/${metadata.model} profile ${metadata.profile}`,
    raw: { commandText: metadata.commandText },
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

export function invalidJsonlAuditEvent(metadata: CodexRuntimeMetadata, line: string, error: unknown): NormalizedAgentEvent {
  return event(metadata, 'audit', {
    status: 'invalid-jsonl',
    message: error instanceof Error ? error.message : String(error),
    raw: { line },
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
  });
}

export function normalizeCodexJsonlEvent(raw: unknown, metadata: CodexRuntimeMetadata): NormalizedAgentEvent[] {
  const codexSessionId = codexSessionIdFromRaw(raw);
  if (codexSessionId) metadata.codexSessionId = codexSessionId;
  const rawEvent = isRecord(raw) ? raw : {};
  const type = stringField(rawEvent.type) ?? stringField(rawEvent.event) ?? '';
  const item = isRecord(rawEvent.item) ? rawEvent.item : rawEvent;
  const itemType = stringField(item.type) ?? '';
  const text = textFromRaw(rawEvent) ?? textFromRaw(item);
  const itemId = stringField(item.id) ?? stringField(rawEvent.item_id) ?? stringField(rawEvent.id);
  const toolName = stringField(item.name)
    ?? stringField(item.tool_name)
    ?? stringField(rawEvent.tool_name)
    ?? stringField(rawEvent.name);

  const events: NormalizedAgentEvent[] = [rawJsonlAuditEvent(metadata, raw)];

  if (/error|failed|failure/i.test(type)) {
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
    codexSessionId: metadata.codexSessionId,
    ...extra,
  };
}

function textFromRaw(value: Record<string, unknown>): string | undefined {
  return stringField(value.text)
    ?? stringField(value.delta)
    ?? stringField(value.message)
    ?? stringField(value.output_text)
    ?? stringField(value.content);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
