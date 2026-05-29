import { createHash } from 'node:crypto';
import type { ModuleFunctionName, ModulePipelineTraceStep } from '@sciforge-ui/runtime-contract/modules';
import type { NormalizedAgentEvent } from './codex-event-normalizer.js';

export const BACKEND_NORMALIZED_EVENT_SCHEMA_VERSION = 'sciforge.backend-normalized-event.v1' as const;

export type BackendEventSource = 'codex-app-server' | 'codex-exec-json' | 'claude-stream-json' | 'unknown';

export type BackendNeutralEventType =
  | 'run_started'
  | 'thread_started'
  | 'turn_started'
  | 'item_started'
  | 'message_delta'
  | 'message'
  | 'gui_present'
  | 'gui_ask_user'
  | 'tool_started'
  | 'tool_completed'
  | 'operation_progress'
  | 'approval_requested'
  | 'approval_resolved'
  | 'audit'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface BackendNormalizedEvent {
  schemaVersion: typeof BACKEND_NORMALIZED_EVENT_SCHEMA_VERSION;
  backend: BackendEventSource;
  type: BackendNeutralEventType;
  timestamp: string;
  provider?: string;
  model?: string;
  profile?: string;
  workspace?: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  role?: string;
  text?: string;
  message?: string;
  status?: string;
  toolName?: string;
  command?: string;
  outputSummary?: string;
  exitCode?: number | null;
  approvalId?: string;
  traceStepId?: string;
  raw?: unknown;
}

export interface BackendEventNormalizationOptions {
  backend?: BackendEventSource;
  now?: () => string;
  traceParent?: string;
}

export interface BackendEventNormalizationResult {
  events: BackendNormalizedEvent[];
  traceSteps: ModulePipelineTraceStep[];
}

interface ModuleToolCall {
  moduleId: string;
  functionName: ModuleFunctionName;
  intent?: string;
  query?: string;
  ref?: string;
  input?: unknown;
}

type TraceStatus = ModulePipelineTraceStep['status'];

const MODULE_FUNCTION_NAMES = new Set<ModuleFunctionName>(['describe', 'query', 'read', 'invoke']);
const KNOWN_MODULE_IDS = new Set([
  'gui',
  'skills',
  'memory',
  'capabilities',
  'browser',
  'verifier',
  'actions',
  'artifacts',
]);

export function normalizeBackendEvents(
  rawEvents: Iterable<unknown>,
  options: BackendEventNormalizationOptions = {},
): BackendEventNormalizationResult {
  const events: BackendNormalizedEvent[] = [];
  const traceSteps: ModulePipelineTraceStep[] = [];
  for (const raw of rawEvents) {
    const normalized = normalizeBackendEvent(raw, options);
    events.push(...normalized.events);
    traceSteps.push(...normalized.traceSteps);
  }
  return { events, traceSteps };
}

export function normalizeBackendEvent(
  raw: unknown,
  options: BackendEventNormalizationOptions = {},
): BackendEventNormalizationResult {
  const backend = options.backend ?? detectBackend(raw);
  if (backend === 'codex-exec-json') return normalizeCodexExecJsonEvent(raw, options);
  if (backend === 'claude-stream-json') return normalizeClaudeStreamJsonEvent(raw, options);
  return normalizeCodexAppServerEvent(raw, { ...options, backend });
}

export function redactBackendEventValue(value: unknown, keyHint = ''): unknown {
  if (typeof value === 'string') return redactBackendStringValue(keyHint, value);
  if (Array.isArray(value)) return value.map((entry) => redactBackendEventValue(entry, keyHint));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, redactBackendEventValue(entry, key)]),
  );
}

export function redactBackendText(text: string): string {
  return text
    .replace(/\bBearer\s+([A-Za-z0-9._~+/=-]{8,})/gi, (_match, secret: string) =>
      `Bearer ${redactionDigest('secret', secret)}`)
    .replace(
      /\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|authorization)\b\s*[:=]\s*["']?([^"'\s,;)}\]]{8,})/gi,
      (_match, label: string, secret: string) => `${label}=${redactionDigest('secret', secret)}`,
    )
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g, (secret) => redactionDigest('secret', secret))
    .replace(/https?:\/\/[^\s"'<>\\)]+/gi, (url) => redactionDigest('url', url));
}

function normalizeCodexExecJsonEvent(
  raw: unknown,
  options: BackendEventNormalizationOptions,
): BackendEventNormalizationResult {
  if (!isRecord(raw)) {
    return {
      events: [backendEvent('codex-exec-json', 'audit', raw, options, { status: 'invalid-event' })],
      traceSteps: [],
    };
  }

  const codex = raw as Partial<NormalizedAgentEvent> & Record<string, unknown>;
  const type = normalizeCodexExecJsonType(stringField(codex.type));
  const event = backendEvent('codex-exec-json', type, raw, options, {
    provider: stringField(codex.provider),
    model: stringField(codex.model),
    profile: stringField(codex.profile),
    workspace: stringField(codex.workspace),
    threadId: stringField(codex.codexSessionId),
    turnId: stringField(codex.commandId),
    itemId: stringField(codex.itemId),
    text: stringField(codex.text),
    message: stringField(codex.message),
    status: stringField(codex.status),
    toolName: stringField(codex.toolName),
    command: compactBackendText(stringField(codex.command), 260),
    outputSummary: compactBackendText(stringField(codex.outputSummary), 320),
    exitCode: numberField(codex.exitCode),
  });
  const traceStep = traceStepFromTool({
    backend: 'codex-exec-json',
    raw,
    options,
    status: type === 'tool_started' ? 'started' : type === 'tool_completed' ? 'completed' : undefined,
    itemId: event.itemId,
    toolName: event.toolName,
    startedAt: event.timestamp,
  });
  return {
    events: [traceStep ? { ...event, traceStepId: traceStep.id } : event],
    traceSteps: traceStep ? [traceStep] : [],
  };
}

function normalizeCodexAppServerEvent(
  raw: unknown,
  options: BackendEventNormalizationOptions & { backend?: BackendEventSource },
): BackendEventNormalizationResult {
  if (!isRecord(raw)) {
    return {
      events: [backendEvent(options.backend ?? 'codex-app-server', 'audit', raw, options, { status: 'invalid-event' })],
      traceSteps: [],
    };
  }

  const backend = options.backend ?? 'codex-app-server';
  const type = eventType(raw);
  const payload = recordField(raw.payload) ?? raw;
  const item = recordField(raw.item) ?? recordField(payload.item) ?? recordField(raw.tool) ?? {};
  const lowerType = type.toLowerCase();

  if (/thread.*(created|started)|thread\.created|thread\.started/.test(lowerType)) {
    return singleEvent(backendEvent(backend, 'thread_started', raw, options, commonFields(raw, payload, item)));
  }

  if (/turn.*(created|started)|turn\.created|turn\.started/.test(lowerType)) {
    return singleEvent(backendEvent(backend, 'turn_started', raw, options, commonFields(raw, payload, item)));
  }

  if (/approval.*(requested|required|created)|control_request/.test(lowerType)) {
    return eventWithTrace(backend, 'approval_requested', raw, options, 'approval-required');
  }

  if (/approval.*(resolved|responded|response|completed)|control_response/.test(lowerType)) {
    return eventWithTrace(backend, 'approval_resolved', raw, options, approvalTraceStatus(raw));
  }

  if (/tool.*(started|call_started)|item\.started|function_call.*started/.test(lowerType) && toolNameFromRaw(raw, item)) {
    return eventWithTrace(backend, 'tool_started', raw, options, 'started');
  }

  if (/tool.*(completed|done|call_completed)|item\.completed|function_call.*completed/.test(lowerType) && toolNameFromRaw(raw, item)) {
    return eventWithTrace(backend, 'tool_completed', raw, options, terminalTraceStatus(raw));
  }

  const text = textFromRaw(raw) ?? textFromRaw(payload) ?? textFromRaw(item);
  if (/delta|partial/.test(lowerType) && text) {
    return singleEvent(backendEvent(backend, 'message_delta', raw, options, { ...commonFields(raw, payload, item), text }));
  }

  if (/message/.test(lowerType) && text) {
    return singleEvent(backendEvent(backend, 'message', raw, options, { ...commonFields(raw, payload, item), text }));
  }

  if (/operation.*progress|process.*progress|progress|status/.test(lowerType) && (text || statusFromRaw(raw) || recordField(raw.progress) || recordField(payload.progress))) {
    return singleEvent(backendEvent(backend, 'operation_progress', raw, options, {
      ...commonFields(raw, payload, item),
      text,
      message: text ?? stringField(raw.message) ?? stringField(payload.message),
      status: statusFromRaw(raw) ?? statusFromRaw(payload) ?? 'running',
    }));
  }

  if (/item\.started/.test(lowerType)) {
    return singleEvent(backendEvent(backend, 'item_started', raw, options, commonFields(raw, payload, item)));
  }

  if (/(done|completed|finished)$|turn\.done|turn\.completed/.test(lowerType)) {
    return singleEvent(backendEvent(backend, 'done', raw, options, { ...commonFields(raw, payload, item), status: 'done' }));
  }

  if (/cancel/.test(lowerType)) {
    return singleEvent(backendEvent(backend, 'cancelled', raw, options, { ...commonFields(raw, payload, item), status: 'cancelled' }));
  }

  if (/error|failed|failure/.test(lowerType)) {
    return singleEvent(backendEvent(backend, 'failed', raw, options, {
      ...commonFields(raw, payload, item),
      message: text ?? stringField(raw.message) ?? type,
      status: 'failed',
    }));
  }

  return singleEvent(backendEvent(backend, 'audit', raw, options, { ...commonFields(raw, payload, item), status: type || 'unclassified' }));
}

function normalizeClaudeStreamJsonEvent(
  raw: unknown,
  options: BackendEventNormalizationOptions,
): BackendEventNormalizationResult {
  if (!isRecord(raw)) {
    return {
      events: [backendEvent('claude-stream-json', 'audit', raw, options, { status: 'invalid-event' })],
      traceSteps: [],
    };
  }

  const type = eventType(raw).toLowerCase();
  if (type === 'control_request') {
    return eventWithTrace('claude-stream-json', 'approval_requested', raw, options, 'approval-required');
  }
  if (type === 'control_response') {
    return eventWithTrace('claude-stream-json', 'approval_resolved', raw, options, approvalTraceStatus(raw));
  }
  if (/error|failed|failure/.test(type)) {
    return singleEvent(backendEvent('claude-stream-json', 'failed', raw, options, {
      ...commonFields(raw, raw, {}),
      message: textFromRaw(raw) ?? stringField(raw.message) ?? eventType(raw),
      status: 'failed',
    }));
  }
  if (/result|done|completed/.test(type)) {
    return singleEvent(backendEvent('claude-stream-json', 'done', raw, options, {
      ...commonFields(raw, raw, {}),
      status: stringField(raw.subtype) ?? 'done',
    }));
  }

  const text = textFromClaudeMessage(raw) ?? textFromRaw(raw);
  if (text && (raw.partial === true || raw.is_partial === true || /partial|delta/.test(type))) {
    return singleEvent(backendEvent('claude-stream-json', 'message_delta', raw, options, { ...commonFields(raw, raw, {}), text }));
  }
  if (text && (type === 'assistant' || type === 'message' || type === 'assistant_message')) {
    return singleEvent(backendEvent('claude-stream-json', 'message', raw, options, { ...commonFields(raw, raw, {}), text }));
  }
  if (/operation.*progress|process.*progress|progress|status/.test(type) && (text || statusFromRaw(raw) || recordField(raw.progress))) {
    return singleEvent(backendEvent('claude-stream-json', 'operation_progress', raw, options, {
      ...commonFields(raw, raw, {}),
      text,
      message: text ?? stringField(raw.message),
      status: statusFromRaw(raw) ?? 'running',
    }));
  }

  return singleEvent(backendEvent('claude-stream-json', 'audit', raw, options, { ...commonFields(raw, raw, {}), status: eventType(raw) }));
}

function eventWithTrace(
  backend: BackendEventSource,
  type: BackendNeutralEventType,
  raw: Record<string, unknown>,
  options: BackendEventNormalizationOptions,
  traceStatus: TraceStatus | undefined,
): BackendEventNormalizationResult {
  const payload = recordField(raw.payload) ?? raw;
  const item = recordField(raw.item) ?? recordField(payload.item) ?? recordField(raw.tool) ?? {};
  const fields = commonFields(raw, payload, item);
  const event = backendEvent(backend, type, raw, options, {
    ...fields,
    toolName: toolNameFromRaw(raw, item),
    command: commandFromRaw(raw, item),
    outputSummary: outputSummaryFromRaw(raw, item),
    exitCode: exitCodeFromRaw(raw, item),
    approvalId: approvalIdFromRaw(raw),
    status: fields.status ?? statusForEventType(type),
    text: textFromRaw(raw) ?? textFromRaw(payload) ?? textFromRaw(item),
  });
  const traceStep = traceStepFromTool({
    backend,
    raw,
    options,
    status: traceStatus,
    itemId: event.itemId ?? event.approvalId,
    toolName: event.toolName,
    approval: approvalFromRaw(raw),
    startedAt: event.timestamp,
  });
  return {
    events: [traceStep ? { ...event, traceStepId: traceStep.id } : event],
    traceSteps: traceStep ? [traceStep] : [],
  };
}

function backendEvent(
  backend: BackendEventSource,
  type: BackendNeutralEventType,
  raw: unknown,
  options: BackendEventNormalizationOptions,
  fields: Partial<Omit<BackendNormalizedEvent, 'schemaVersion' | 'backend' | 'type' | 'timestamp' | 'raw'>>,
): BackendNormalizedEvent {
  return {
    schemaVersion: BACKEND_NORMALIZED_EVENT_SCHEMA_VERSION,
    backend,
    type,
    timestamp: timestampFromRaw(raw, options),
    provider: redactOptionalField('provider', fields.provider),
    model: redactOptionalField('model', fields.model),
    profile: fields.profile,
    workspace: fields.workspace,
    threadId: fields.threadId,
    turnId: fields.turnId,
    itemId: fields.itemId,
    role: fields.role,
    text: fields.text,
    message: fields.message,
    status: fields.status,
    toolName: fields.toolName,
    command: fields.command,
    outputSummary: fields.outputSummary,
    exitCode: fields.exitCode,
    approvalId: fields.approvalId,
    traceStepId: fields.traceStepId,
    raw: redactBackendEventValue(raw),
  };
}

function traceStepFromTool(input: {
  backend: BackendEventSource;
  raw: unknown;
  options: BackendEventNormalizationOptions;
  status?: TraceStatus;
  itemId?: string;
  toolName?: string;
  approval?: Record<string, unknown>;
  startedAt: string;
}): ModulePipelineTraceStep | undefined {
  if (!input.status) return undefined;
  const raw = isRecord(input.raw) ? input.raw : {};
  const payload = recordField(raw.payload) ?? raw;
  const item = recordField(raw.item) ?? recordField(payload.item) ?? recordField(raw.tool) ?? {};
  const toolName = input.toolName ?? toolNameFromRaw(raw, item);
  const toolInput = toolInputFromRaw(raw, item);
  const toolResult = toolResultFromRaw(raw, item);
  const approvalInput = input.approval
    ?? approvalFromRaw(raw)
    ?? recordField(raw.response)
    ?? recordField(raw.control_response);
  const moduleCall = moduleToolCall(toolName, toolInput)
    ?? moduleToolCall(undefined, approvalInput)
    ?? approvalModuleToolCall(approvalInput, input.status);
  if (!moduleCall) return undefined;

  const completed = input.status !== 'started';
  const completedAt = completed ? timestampFromRaw(raw, input.options) : undefined;
  const step: ModulePipelineTraceStep = {
    id: traceStepId(input.backend, input.itemId ?? approvalIdFromRaw(raw) ?? toolName ?? safeJsonStringify(redactBackendEventValue(raw))),
    moduleId: moduleCall.moduleId,
    functionName: moduleCall.functionName,
    intent: moduleCall.intent,
    query: moduleCall.query,
    ref: moduleCall.ref,
    inputSummary: summarizeForTrace(moduleCall.input ?? toolInput ?? raw),
    resultSummary: completed ? summarizeForTrace(toolResult ?? input.approval ?? statusFromRaw(raw) ?? eventType(raw)) : undefined,
    status: input.status,
    startedAt: stringField(raw.started_at) ?? stringField(raw.startedAt) ?? input.startedAt,
    completedAt,
    timing: completed ? durationFromRaw(raw) : undefined,
    parentId: input.options.traceParent ?? stringField(raw.traceParent) ?? stringField(raw.parent_id),
    refs: refsFromRaw(raw, toolResult),
    operationRef: operationRefFromRaw(raw, toolResult),
    approval: input.approval ? redactBackendEventValue(input.approval) as Record<string, unknown> : undefined,
    summary: summarizeForTrace({ backend: input.backend, toolName, status: input.status }),
  };
  return step;
}

function approvalModuleToolCall(approval: Record<string, unknown> | undefined, status: TraceStatus): ModuleToolCall | undefined {
  if (!approval && status !== 'cancelled' && status !== 'failed' && status !== 'completed') return undefined;
  return {
    moduleId: stringField(approval?.moduleId) ?? stringField(approval?.module_id) ?? 'actions',
    functionName: 'invoke',
    intent: stringField(approval?.intent) ?? (status === 'approval-required' ? 'approval' : 'approval_response'),
    input: approval ?? {},
  };
}

function moduleToolCall(toolName: string | undefined, input: unknown): ModuleToolCall | undefined {
  const args = parseJsonRecord(input) ?? (isRecord(input) ? input : {});
  const moduleId = stringField(args.moduleId) ?? stringField(args.module_id);
  const requestedFunction = moduleFunctionName(stringField(args.functionName) ?? stringField(args.function_name) ?? stringField(args.function));
  if (moduleId) {
    return {
      moduleId,
      functionName: requestedFunction ?? functionNameFromModuleTool(toolName) ?? 'invoke',
      intent: stringField(args.intent),
      query: stringField(args.query),
      ref: stringField(args.ref),
      input: args.input ?? args.arguments ?? args,
    };
  }

  if (toolName?.startsWith('module.')) {
    const functionName = functionNameFromModuleTool(toolName) ?? requestedFunction ?? 'invoke';
    const moduleInput = recordField(args.request) ?? args;
    const requestModuleId = stringField(moduleInput.moduleId) ?? stringField(moduleInput.module_id);
    if (!requestModuleId) return undefined;
    return {
      moduleId: requestModuleId,
      functionName,
      intent: stringField(moduleInput.intent),
      query: stringField(moduleInput.query),
      ref: stringField(moduleInput.ref),
      input: moduleInput.input ?? moduleInput,
    };
  }

  if (toolName) {
    const [maybeModuleId, maybeIntentOrFunction] = toolName.split('.');
    if (KNOWN_MODULE_IDS.has(maybeModuleId)) {
      const functionName = moduleFunctionName(maybeIntentOrFunction);
      return {
        moduleId: maybeModuleId,
        functionName: functionName ?? 'invoke',
        intent: functionName ? stringField(args.intent) : maybeIntentOrFunction,
        query: stringField(args.query),
        ref: stringField(args.ref),
        input: args.input ?? args.arguments ?? args,
      };
    }
    return {
      moduleId: 'actions',
      functionName: 'invoke',
      intent: toolName,
      input: args.input ?? args.arguments ?? args,
    };
  }

  return undefined;
}

function commonFields(
  raw: Record<string, unknown>,
  payload: Record<string, unknown>,
  item: Record<string, unknown>,
): Partial<BackendNormalizedEvent> {
  return {
    provider: stringField(raw.provider) ?? stringField(payload.provider),
    model: stringField(raw.model) ?? stringField(payload.model),
    profile: stringField(raw.profile) ?? stringField(payload.profile),
    workspace: stringField(raw.workspace) ?? stringField(payload.workspace),
    threadId: stringField(raw.thread_id)
      ?? stringField(raw.threadId)
      ?? stringField(raw.session_id)
      ?? stringField(raw.sessionId)
      ?? stringField(raw.conversation_id)
      ?? stringField(raw.conversationId)
      ?? stringField(payload.thread_id)
      ?? stringField(payload.threadId)
      ?? stringField(payload.session_id)
      ?? stringField(payload.sessionId),
    turnId: stringField(raw.turn_id)
      ?? stringField(raw.turnId)
      ?? stringField(raw.request_id)
      ?? stringField(raw.requestId)
      ?? stringField(payload.turn_id)
      ?? stringField(payload.turnId)
      ?? stringField(payload.request_id)
      ?? stringField(payload.requestId),
    itemId: stringField(raw.item_id) ?? stringField(raw.itemId) ?? stringField(raw.id) ?? stringField(item.id) ?? stringField(payload.item_id),
    role: stringField(raw.role) ?? stringField(item.role) ?? stringField(payload.role),
    status: statusFromRaw(raw) ?? statusFromRaw(payload) ?? stringField(item.status),
  };
}

function detectBackend(raw: unknown): BackendEventSource {
  if (!isRecord(raw)) return 'unknown';
  if (raw.schemaVersion === 'sciforge.codex.normalized-event.v1') return 'codex-exec-json';
  const type = eventType(raw).toLowerCase();
  if (type === 'control_request' || type === 'control_response' || type.startsWith('claude_')) return 'claude-stream-json';
  if (raw.claude === true || raw.backend === 'claude-stream-json') return 'claude-stream-json';
  if (raw.backend === 'codex-exec-json') return 'codex-exec-json';
  if (raw.backend === 'codex-app-server') return 'codex-app-server';
  return 'codex-app-server';
}

function normalizeCodexExecJsonType(type: string | undefined): BackendNeutralEventType {
  if (type === 'run_started') return 'run_started';
  if (type === 'gui_present') return 'gui_present';
  if (type === 'gui_ask_user') return 'gui_ask_user';
  if (type === 'message_delta') return 'message_delta';
  if (type === 'message') return 'message';
  if (type === 'tool_started') return 'tool_started';
  if (type === 'tool_completed') return 'tool_completed';
  if (type === 'operation_progress') return 'operation_progress';
  if (type === 'done') return 'done';
  if (type === 'failed') return 'failed';
  if (type === 'cancelled') return 'cancelled';
  return 'audit';
}

function approvalTraceStatus(raw: Record<string, unknown>): TraceStatus {
  const status = statusFromRaw(raw)?.toLowerCase();
  const response = recordField(raw.response) ?? recordField(raw.control_response) ?? {};
  if (status === 'cancelled' || status === 'rejected' || response.approved === false || response.ok === false) return 'cancelled';
  if (status === 'failed' || status === 'error') return 'failed';
  return 'completed';
}

function terminalTraceStatus(raw: Record<string, unknown>): TraceStatus {
  const status = statusFromRaw(raw)?.toLowerCase();
  const result = toolResultFromRaw(raw, recordField(raw.item) ?? {});
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed' || status === 'error') return 'failed';
  if (isRecord(result) && (result.ok === false || result.error)) return 'failed';
  return 'completed';
}

function statusForEventType(type: BackendNeutralEventType): string | undefined {
  if (type === 'approval_requested') return 'approval-required';
  if (type === 'approval_resolved') return 'resolved';
  if (type === 'tool_started') return 'started';
  if (type === 'tool_completed') return 'completed';
  return undefined;
}

function singleEvent(event: BackendNormalizedEvent): BackendEventNormalizationResult {
  return { events: [event], traceSteps: [] };
}

function eventType(raw: Record<string, unknown>): string {
  return stringField(raw.type) ?? stringField(raw.event) ?? stringField(raw.kind) ?? '';
}

function timestampFromRaw(raw: unknown, options: BackendEventNormalizationOptions): string {
  if (isRecord(raw)) {
    const timestamp = stringField(raw.timestamp) ?? stringField(raw.created_at) ?? stringField(raw.createdAt);
    if (timestamp) return timestamp;
  }
  return options.now?.() ?? new Date().toISOString();
}

function toolNameFromRaw(raw: Record<string, unknown>, item: Record<string, unknown>): string | undefined {
  const payload = recordField(raw.payload) ?? {};
  const tool = recordField(raw.tool) ?? recordField(payload.tool) ?? {};
  const request = recordField(raw.request) ?? recordField(raw.control_request) ?? {};
  const itemType = stringField(item.type) ?? stringField(payload.type) ?? stringField(raw.item_type);
  return stringField(item.name)
    ?? stringField(item.tool_name)
    ?? stringField(tool.name)
    ?? stringField(tool.tool_name)
    ?? stringField(request.name)
    ?? stringField(request.tool_name)
    ?? stringField(raw.tool_name)
    ?? stringField(raw.name)
    ?? stringField(payload.name)
    ?? toolNameFromItemType(itemType, commandFromRaw(raw, item));
}

function toolNameFromItemType(itemType: string | undefined, command: string | undefined): string | undefined {
  if (/command_execution|exec|shell|terminal/i.test(itemType ?? '') || command) return 'shell';
  if (/function_call/i.test(itemType ?? '')) return 'function_call';
  return undefined;
}

function commandFromRaw(raw: Record<string, unknown>, item: Record<string, unknown>): string | undefined {
  const payload = recordField(raw.payload) ?? {};
  const tool = recordField(raw.tool) ?? recordField(payload.tool) ?? {};
  const request = recordField(raw.request) ?? recordField(raw.control_request) ?? {};
  return compactBackendText(
    stringField(item.command)
      ?? stringField(item.cmd)
      ?? stringField(tool.command)
      ?? stringField(tool.cmd)
      ?? stringField(request.command)
      ?? stringField(request.cmd)
      ?? stringField(raw.command)
      ?? stringField(raw.cmd)
      ?? stringField(payload.command)
      ?? stringField(payload.cmd),
    260,
  );
}

function outputSummaryFromRaw(raw: Record<string, unknown>, item: Record<string, unknown>): string | undefined {
  const payload = recordField(raw.payload) ?? {};
  const tool = recordField(raw.tool) ?? recordField(payload.tool) ?? {};
  const response = recordField(raw.response) ?? recordField(raw.control_response) ?? {};
  return compactBackendText(
    stringField(item.outputSummary)
      ?? stringField(item.output_summary)
      ?? stringField(item.aggregated_output)
      ?? stringField(tool.outputSummary)
      ?? stringField(tool.output_summary)
      ?? stringField(response.outputSummary)
      ?? stringField(response.output_summary)
      ?? stringField(raw.outputSummary)
      ?? stringField(raw.output_summary)
      ?? stringField(payload.outputSummary)
      ?? stringField(payload.output_summary),
    320,
  );
}

function exitCodeFromRaw(raw: Record<string, unknown>, item: Record<string, unknown>): number | null | undefined {
  const payload = recordField(raw.payload) ?? {};
  const tool = recordField(raw.tool) ?? recordField(payload.tool) ?? {};
  const response = recordField(raw.response) ?? recordField(raw.control_response) ?? {};
  return numberField(item.exitCode)
    ?? numberField(item.exit_code)
    ?? numberField(tool.exitCode)
    ?? numberField(tool.exit_code)
    ?? numberField(response.exitCode)
    ?? numberField(response.exit_code)
    ?? numberField(raw.exitCode)
    ?? numberField(raw.exit_code)
    ?? numberField(payload.exitCode)
    ?? numberField(payload.exit_code);
}

function toolInputFromRaw(raw: Record<string, unknown>, item: Record<string, unknown>): unknown {
  const payload = recordField(raw.payload) ?? {};
  const tool = recordField(raw.tool) ?? recordField(payload.tool) ?? {};
  const request = recordField(raw.request) ?? recordField(raw.control_request) ?? {};
  return item.input
    ?? item.arguments
    ?? tool.input
    ?? tool.arguments
    ?? request.input
    ?? request.arguments
    ?? raw.input
    ?? raw.arguments
    ?? payload.input
    ?? payload.arguments;
}

function toolResultFromRaw(raw: Record<string, unknown>, item: Record<string, unknown>): unknown {
  const payload = recordField(raw.payload) ?? {};
  const tool = recordField(raw.tool) ?? recordField(payload.tool) ?? {};
  const response = recordField(raw.response) ?? recordField(raw.control_response) ?? {};
  return item.result
    ?? item.output
    ?? tool.result
    ?? tool.output
    ?? response.result
    ?? response.output
    ?? raw.result
    ?? raw.output
    ?? payload.result
    ?? payload.output;
}

function approvalFromRaw(raw: Record<string, unknown>): Record<string, unknown> | undefined {
  return recordField(raw.approval)
    ?? recordField(raw.approval_request)
    ?? recordField(raw.approvalRequest)
    ?? recordField(raw.request)
    ?? recordField(raw.control_request);
}

function approvalIdFromRaw(raw: Record<string, unknown>): string | undefined {
  const approval = approvalFromRaw(raw) ?? {};
  return stringField(raw.approval_id)
    ?? stringField(raw.approvalId)
    ?? stringField(raw.id)
    ?? stringField(approval.id)
    ?? stringField(approval.approval_id)
    ?? stringField(approval.approvalId);
}

function statusFromRaw(raw: Record<string, unknown>): string | undefined {
  const response = recordField(raw.response) ?? {};
  return stringField(raw.status) ?? stringField(raw.subtype) ?? stringField(response.status);
}

function refsFromRaw(raw: Record<string, unknown>, result: unknown): string[] | undefined {
  const refs = stringArrayField(raw.refs)
    ?? stringArrayField(raw.evidenceRefs)
    ?? (isRecord(result) ? stringArrayField(result.refs) ?? stringArrayField(result.evidenceRefs) : undefined);
  return refs?.length ? refs : undefined;
}

function operationRefFromRaw(raw: Record<string, unknown>, result: unknown): string | undefined {
  return stringField(raw.operationRef)
    ?? stringField(raw.operation_ref)
    ?? (isRecord(result) ? stringField(result.operationRef) ?? stringField(result.operation_ref) : undefined);
}

function durationFromRaw(raw: Record<string, unknown>): { durationMs?: number } | undefined {
  const duration = numberField(raw.durationMs) ?? numberField(raw.duration_ms);
  return duration === undefined ? undefined : { durationMs: Math.max(0, duration) };
}

function moduleFunctionName(value: string | undefined): ModuleFunctionName | undefined {
  if (!value) return undefined;
  return MODULE_FUNCTION_NAMES.has(value as ModuleFunctionName) ? value as ModuleFunctionName : undefined;
}

function functionNameFromModuleTool(toolName: string | undefined): ModuleFunctionName | undefined {
  if (!toolName?.startsWith('module.')) return undefined;
  return moduleFunctionName(toolName.slice('module.'.length));
}

function textFromClaudeMessage(raw: Record<string, unknown>): string | undefined {
  const message = recordField(raw.message) ?? raw;
  return textFromRaw(message) ?? textFromContent(message.content);
}

function textFromRaw(value: Record<string, unknown>): string | undefined {
  const delta = recordField(value.delta);
  const error = recordField(value.error);
  return stringField(value.text)
    ?? stringField(value.delta)
    ?? stringField(delta?.text)
    ?? stringField(value.message)
    ?? stringField(error?.message)
    ?? stringField(value.output_text)
    ?? stringField(value.content)
    ?? textFromContent(value.content);
}

function textFromContent(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined;
  if (!Array.isArray(value)) return undefined;
  const text = value.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (!isRecord(entry)) return undefined;
    return stringField(entry.text) ?? stringField(entry.content);
  }).filter((entry): entry is string => Boolean(entry)).join('');
  return text || undefined;
}

function summarizeForTrace(value: unknown): string {
  const text = safeJsonStringify(redactBackendEventValue(value));
  if (text.length <= 320) return text;
  return `${text.slice(0, 280)}...${text.slice(-24)}`;
}

function compactBackendText(value: string | undefined, limit: number): string | undefined {
  if (!value?.trim()) return undefined;
  const redacted = redactBackendText(value).replace(/\s+/g, ' ').trim();
  if (redacted.length <= limit) return redacted;
  return `${redacted.slice(0, Math.max(0, limit - 18)).replace(/\s+\S*$/, '')} ... ${redacted.slice(-14)}`;
}

function safeJsonStringify(value: unknown): string {
  if (typeof value === 'string') return redactBackendText(value);
  try {
    return JSON.stringify(value ?? {});
  } catch (error) {
    return JSON.stringify({ unserializable: error instanceof Error ? redactBackendText(error.message) : 'unknown' });
  }
}

function redactOptionalField(key: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : redactBackendStringValue(key, value);
}

function redactBackendStringValue(key: string, value: string): string {
  if (isModelKey(key)) return redactionDigest('model', value);
  if (isProviderKey(key)) return redactionDigest('provider', value);
  if (isSensitiveKey(key)) return redactionDigest('secret', value);
  if (isUrlKey(key)) return redactionDigest('url', value);
  return redactBackendText(value);
}

function redactionDigest(kind: 'secret' | 'url' | 'model' | 'provider', value: string): string {
  return `[redacted-${kind}:sha256:${sha256(value).slice(0, 12)}]`;
}

function traceStepId(backend: BackendEventSource, seed: string): string {
  return `backend-step-${backend}-${sha256(seed).slice(0, 16)}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isSensitiveKey(key: string): boolean {
  return /api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|credential|authorization/i.test(key);
}

function isUrlKey(key: string): boolean {
  return /url|uri|endpoint|base[_-]?url|upstream/i.test(key);
}

function isModelKey(key: string): boolean {
  return /^model$|model[_-]?name|default[_-]?model/i.test(key);
}

function isProviderKey(key: string): boolean {
  return /^provider$|provider[_-]?name|model[_-]?provider/i.test(key);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArrayField(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return strings.length ? strings : undefined;
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
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
