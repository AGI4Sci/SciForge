export const CODEX_REALTIME_SESSION_SCHEMA_VERSION = 'sciforge.codex-realtime-session.v1' as const;
export const CODEX_REALTIME_SESSION_BRIDGE = 'codex-native-realtime-session' as const;
export const CODEX_REALTIME_SESSION_STREAM_KIND = 'structured-events-plus-terminal-equivalent-text' as const;
export const CODEX_REALTIME_CONTROL_SCHEMA_VERSION = 'sciforge.codex-realtime-control.v1' as const;

export type CodexRealtimeControlType = 'cancel' | 'interrupt' | 'input_response' | 'approval_response';
export type CodexRealtimeInterruptMode = 'queue-next-turn' | 'cancel-current';
export type CodexRealtimeControlStatus = 'accepted' | 'recorded' | 'rejected';
export type CodexRealtimeControlDelivery = 'adapter-cancel' | 'adapter-unavailable' | 'next-turn-required';

export interface CodexRealtimeSessionEnvelope {
  schemaVersion: typeof CODEX_REALTIME_SESSION_SCHEMA_VERSION;
  bridge: typeof CODEX_REALTIME_SESSION_BRIDGE;
  streamKind: typeof CODEX_REALTIME_SESSION_STREAM_KIND;
  eventTransport: 'sse' | 'websocket';
  eventContract: 'structured-events';
  inputTextKind: 'terminal-equivalent-text';
  rawTerminal: false;
  commandId?: string;
  attemptId?: string;
  codexSessionId?: string;
  threadRef?: string;
  resumeRequested: boolean;
}

interface CodexRealtimeClientControlBase {
  schemaVersion: typeof CODEX_REALTIME_CONTROL_SCHEMA_VERSION;
  controlType: CodexRealtimeControlType;
  commandId?: string;
  attemptId?: string;
  requestId?: string;
  reason?: string;
  rawTerminal: false;
}

export interface CodexRealtimeCancelControl extends CodexRealtimeClientControlBase {
  controlType: 'cancel';
}

export interface CodexRealtimeInterruptControl extends CodexRealtimeClientControlBase {
  controlType: 'interrupt';
  mode: CodexRealtimeInterruptMode;
  message: string;
}

export interface CodexRealtimeInputResponseControl extends CodexRealtimeClientControlBase {
  controlType: 'input_response';
  message: string;
}

export interface CodexRealtimeApprovalResponseControl extends CodexRealtimeClientControlBase {
  controlType: 'approval_response';
  approved: boolean;
  message?: string;
}

export type CodexRealtimeClientControl =
  | CodexRealtimeCancelControl
  | CodexRealtimeInterruptControl
  | CodexRealtimeInputResponseControl
  | CodexRealtimeApprovalResponseControl;

export type CodexRealtimeClientControlInput = CodexRealtimeClientControl extends infer Control
  ? Control extends unknown
    ? Omit<Control, 'schemaVersion' | 'rawTerminal'>
    : never
  : never;

export interface CodexRealtimeControlAck {
  schemaVersion: typeof CODEX_REALTIME_CONTROL_SCHEMA_VERSION;
  type: 'realtime_control';
  controlType: CodexRealtimeControlType;
  status: CodexRealtimeControlStatus;
  delivery: CodexRealtimeControlDelivery;
  detail: string;
  commandId?: string;
  attemptId?: string;
  requestId?: string;
  rawTerminal: false;
  createdAt: string;
}

export function codexThreadRef(codexSessionId: string | undefined): string | undefined {
  return codexSessionId?.trim() ? `codex-thread:${codexSessionId.trim()}` : undefined;
}

export function createCodexRealtimeSessionEnvelope(input: {
  commandId?: string;
  attemptId?: string;
  codexSessionId?: string;
  eventTransport?: CodexRealtimeSessionEnvelope['eventTransport'];
}): CodexRealtimeSessionEnvelope {
  const codexSessionId = input.codexSessionId?.trim() || undefined;
  return {
    schemaVersion: CODEX_REALTIME_SESSION_SCHEMA_VERSION,
    bridge: CODEX_REALTIME_SESSION_BRIDGE,
    streamKind: CODEX_REALTIME_SESSION_STREAM_KIND,
    eventTransport: input.eventTransport ?? 'sse',
    eventContract: 'structured-events',
    inputTextKind: 'terminal-equivalent-text',
    rawTerminal: false,
    commandId: input.commandId,
    attemptId: input.attemptId,
    codexSessionId,
    threadRef: codexThreadRef(codexSessionId),
    resumeRequested: Boolean(codexSessionId),
  };
}

export function isCodexRealtimeSessionEnvelope(value: unknown): value is CodexRealtimeSessionEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === CODEX_REALTIME_SESSION_SCHEMA_VERSION
    && record.bridge === CODEX_REALTIME_SESSION_BRIDGE
    && record.streamKind === CODEX_REALTIME_SESSION_STREAM_KIND
    && (record.eventTransport === 'sse' || record.eventTransport === 'websocket')
    && record.eventContract === 'structured-events'
    && record.inputTextKind === 'terminal-equivalent-text'
    && record.rawTerminal === false;
}

export function assertCodexRealtimeSessionEnvelope(value: unknown): asserts value is CodexRealtimeSessionEnvelope {
  if (!isCodexRealtimeSessionEnvelope(value)) {
    throw new Error('Runtime Codex realtime session must use structured events plus terminal-equivalent text, not raw terminal transport.');
  }
}

export function createCodexRealtimeClientControl(
  input: CodexRealtimeClientControlInput,
): CodexRealtimeClientControl {
  return {
    ...input,
    schemaVersion: CODEX_REALTIME_CONTROL_SCHEMA_VERSION,
    rawTerminal: false,
  } as CodexRealtimeClientControl;
}

export function normalizeCodexRealtimeClientControl(value: unknown): CodexRealtimeClientControl {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Runtime Codex realtime control must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.rawTerminal !== false || record.inputTextKind === 'raw-terminal' || record.eventContract === 'raw-bytes') {
    throw new Error('Runtime Codex realtime control must use structured control frames, not raw terminal input.');
  }
  if (record.schemaVersion !== CODEX_REALTIME_CONTROL_SCHEMA_VERSION) {
    throw new Error('Runtime Codex realtime control schemaVersion is invalid.');
  }
  const base = {
    schemaVersion: CODEX_REALTIME_CONTROL_SCHEMA_VERSION,
    commandId: stringField(record.commandId),
    attemptId: stringField(record.attemptId),
    requestId: stringField(record.requestId),
    reason: stringField(record.reason),
    rawTerminal: false,
  } as const;
  switch (record.controlType) {
    case 'cancel':
      return { ...base, controlType: 'cancel' };
    case 'interrupt': {
      const message = stringField(record.message);
      if (!message) throw new Error('Runtime Codex interrupt control requires message.');
      const mode = record.mode === 'cancel-current' ? 'cancel-current' : 'queue-next-turn';
      return { ...base, controlType: 'interrupt', mode, message };
    }
    case 'input_response': {
      const message = stringField(record.message);
      if (!message) throw new Error('Runtime Codex input_response control requires message.');
      return { ...base, controlType: 'input_response', message };
    }
    case 'approval_response':
      if (typeof record.approved !== 'boolean') throw new Error('Runtime Codex approval_response control requires approved.');
      return {
        ...base,
        controlType: 'approval_response',
        approved: record.approved,
        message: stringField(record.message),
      };
    default:
      throw new Error('Runtime Codex realtime controlType is invalid.');
  }
}

export function assertCodexRealtimeClientControl(value: unknown): asserts value is CodexRealtimeClientControl {
  normalizeCodexRealtimeClientControl(value);
}

export function createCodexRealtimeControlAck(input: {
  control: CodexRealtimeClientControl;
  status: CodexRealtimeControlStatus;
  delivery: CodexRealtimeControlDelivery;
  detail: string;
  createdAt?: string;
}): CodexRealtimeControlAck {
  return {
    schemaVersion: CODEX_REALTIME_CONTROL_SCHEMA_VERSION,
    type: 'realtime_control',
    controlType: input.control.controlType,
    status: input.status,
    delivery: input.delivery,
    detail: input.detail,
    commandId: input.control.commandId,
    attemptId: input.control.attemptId,
    requestId: input.control.requestId,
    rawTerminal: false,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
