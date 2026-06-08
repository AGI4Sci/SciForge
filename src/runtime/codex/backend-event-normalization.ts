import { createHash } from 'node:crypto';
import type { ModuleFunctionName, ModulePipelineTraceStep } from '@sciforge-ui/runtime-contract/modules';
import { isCodexSamplingRetryMessage, type NormalizedAgentEvent } from './codex-event-normalizer.js';

export const BACKEND_NORMALIZED_EVENT_SCHEMA_VERSION = 'sciforge.backend-normalized-event.v1' as const;

export type BackendEventSource = 'codex-app-server' | 'codex-exec-json' | 'claude-stream-json' | 'unknown';

export type BackendNeutralEventType =
  | 'run_started'
  | 'thread_started'
  | 'turn_started'
  | 'item_started'
  | 'item_completed'
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
  diff?: string;
  outputSummary?: string;
  resultSummary?: string;
  exitCode?: number | null;
  filePath?: string;
  fileRef?: string;
  ref?: string;
  agentId?: string;
  parentAgentId?: string;
  agentType?: string;
  resultRef?: string;
  transcriptRef?: string;
  refs?: string[];
  durationMs?: number;
  background?: BackendSubagentBackgroundMetadata;
  resume?: BackendSubagentResumeMetadata;
  approvalId?: string;
  traceStepId?: string;
  raw?: unknown;
}

export interface BackendSubagentBackgroundMetadata {
  runInBackground: boolean;
  stateRef?: string;
}

export interface BackendSubagentResumeMetadata {
  resumeRequested: boolean;
  resumeAgentId?: string;
  resumeRef?: string;
  resumeBoundary: 'explicit' | 'none';
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
  if (isPrivateBackendPayloadKey(keyHint)) return undefined;
  if (typeof value === 'string') return redactBackendStringValue(keyHint, value);
  if (Array.isArray(value) && isBackendRefArrayKey(keyHint)) {
    return value
      .map((entry) => typeof entry === 'string' ? safeBackendRef(entry) : undefined)
      .filter((entry): entry is string => Boolean(entry));
  }
  if (Array.isArray(value)) return value.map((entry) => redactBackendEventValue(entry, keyHint));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isPrivateBackendPayloadKey(key))
      .map(([key, entry]) => [key, redactBackendEventValue(entry, key)])
      .filter(([, entry]) => entry !== undefined),
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
  const filePath = safeBackendRelativePath(stringField(codex.filePath) ?? stringField(codex.file_path));
  const fileRef = safeBackendPreviewRef(stringField(codex.fileRef) ?? stringField(codex.file_ref)) ?? (filePath ? `file:${filePath}` : undefined);
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
    diff: compactBackendBlockText(stringField(codex.diff), 12_000),
    outputSummary: compactBackendText(stringField(codex.outputSummary), 320),
    resultSummary: compactBackendText(stringField(codex.resultSummary), 320),
    exitCode: numberField(codex.exitCode),
    filePath,
    fileRef,
    ref: safeBackendPreviewRef(stringField(codex.ref)),
    agentId: safeBackendIdentifier(stringField(codex.agentId)),
    parentAgentId: safeBackendIdentifier(stringField(codex.parentAgentId)),
    agentType: safeBackendIdentifier(stringField(codex.agentType)),
    resultRef: safeBackendRef(stringField(codex.resultRef)),
    transcriptRef: safeBackendRef(stringField(codex.transcriptRef)),
    refs: safeBackendRefs(codex.refs),
    durationMs: numberField(codex.durationMs),
    background: backendSubagentBackgroundMetadata([codex]),
    resume: backendSubagentResumeMetadata([codex]),
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
  const eventWithTraceFields = traceStep ? promoteTraceFields(event, traceStep) : event;
  return {
    events: [eventWithTraceFields],
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
  const payload = recordField(raw.payload) ?? recordField(raw.params) ?? raw;
  const item = recordField(raw.item) ?? recordField(payload.item) ?? recordField(raw.tool) ?? {};
  const lowerType = type.toLowerCase();
  const appServerItemType = stringField(item.type) ?? stringField(payload.type) ?? stringField(raw.item_type);
  const text = textFromRaw(raw) ?? textFromRaw(payload) ?? textFromRaw(item);

  if (/thread[./](?:created|started|start)|thread.*(?:created|started)/.test(lowerType)) {
    return singleEvent(backendEvent(backend, 'thread_started', raw, options, commonFields(raw, payload, item)));
  }

  if (/turn[./](?:created|started|start)|turn.*(?:created|started)/.test(lowerType)) {
    return singleEvent(backendEvent(backend, 'turn_started', raw, options, commonFields(raw, payload, item)));
  }

  if (/approval.*(requested|required|created)|requestapproval|request_approval|request\/approval|requestuserinput|elicitation\/request|control_request/.test(lowerType)) {
    return eventWithTrace(backend, 'approval_requested', raw, options, 'approval-required');
  }

  if (/approval.*(resolved|responded|response|completed)|serverrequest\/resolved|control_response/.test(lowerType)) {
    return eventWithTrace(backend, 'approval_resolved', raw, options, approvalTraceStatus(raw));
  }

  if (/^response_item$/i.test(type) && /^function_call$/i.test(appServerItemType ?? '') && toolNameFromRaw(raw, item)) {
    return eventWithTrace(backend, 'tool_started', raw, options, 'started');
  }

  if (/^response_item$/i.test(type) && /^function_call_output$/i.test(appServerItemType ?? '') && toolNameFromRaw(raw, item)) {
    return eventWithTrace(backend, 'tool_completed', raw, options, terminalTraceStatus(raw));
  }

  if (/tool.*(started|call_started)|item[./]started|function_call.*started/.test(lowerType) && toolNameFromRaw(raw, item)) {
    return eventWithTrace(backend, 'tool_started', raw, options, 'started');
  }

  if (/tool.*(completed|done|call_completed)|item[./]completed|function_call.*completed/.test(lowerType) && toolNameFromRaw(raw, item)) {
    return eventWithTrace(backend, 'tool_completed', raw, options, terminalTraceStatus(raw));
  }

  if (/delta|partial/.test(lowerType) && text && isAssistantVisibleTextEvent(raw, payload, item, appServerItemType, lowerType)) {
    return singleEvent(backendEvent(backend, 'message_delta', raw, options, { ...commonFields(raw, payload, item), text }));
  }

  if (text && isResponsesAssistantTextEvent(raw, payload, item, appServerItemType, lowerType)) {
    return singleEvent(backendEvent(backend, 'message', raw, options, { ...commonFields(raw, payload, item), text }));
  }

  if (text && isAssistantMessageItem(raw, payload, item, appServerItemType, lowerType)) {
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

  if (/item[./]started/.test(lowerType)) {
    return singleEvent(backendEvent(backend, 'item_started', raw, options, commonFields(raw, payload, item)));
  }

  if (/item[./].*[./]completed|item[./]completed/.test(lowerType)) {
    return singleEvent(backendEvent(backend, 'item_completed', raw, options, { ...commonFields(raw, payload, item), status: 'completed' }));
  }

  if (/(done|completed|finished)$|turn[./](?:done|completed)/.test(lowerType)) {
    return singleEvent(backendEvent(backend, 'done', raw, options, { ...commonFields(raw, payload, item), status: 'done' }));
  }

  if (/cancel/.test(lowerType)) {
    return singleEvent(backendEvent(backend, 'cancelled', raw, options, { ...commonFields(raw, payload, item), status: 'cancelled' }));
  }

  if (/error|failed|failure/.test(lowerType)) {
    const message = text ?? stringField(raw.message) ?? type;
    if (isCodexSamplingRetryMessage(message)) {
      return singleEvent(backendEvent(backend, 'audit', raw, options, {
        ...commonFields(raw, payload, item),
        message,
        status: 'provider-retry',
      }));
    }
    return singleEvent(backendEvent(backend, 'failed', raw, options, {
      ...commonFields(raw, payload, item),
      message,
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
  const payload = recordField(raw.payload) ?? recordField(raw.params) ?? raw;
  const item = recordField(raw.item) ?? recordField(payload.item) ?? recordField(raw.tool) ?? {};
  const fields = commonFields(raw, payload, item);
  const toolName = toolNameFromRaw(raw, item);
  const fileFields = backendFileFields(raw, payload, item, toolName);
  const event = backendEvent(backend, type, raw, options, {
    ...fields,
    ...fileFields,
    toolName,
    command: commandFromRaw(raw, item),
    diff: diffFromRaw(raw, item),
    outputSummary: outputSummaryFromRaw(raw, item),
    exitCode: exitCodeFromRaw(raw, item),
    approvalId: approvalIdFromRaw(raw),
    status: fields.status ?? statusForEventType(type),
    text: textFromRaw(raw) ?? textFromRaw(payload) ?? textFromRaw(item),
    ref: fields.ref,
    refs: fields.refs,
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
  const eventWithTraceFields = traceStep ? promoteTraceFields(event, traceStep) : event;
  return {
    events: [eventWithTraceFields],
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
    diff: fields.diff,
    outputSummary: fields.outputSummary,
    resultSummary: fields.resultSummary,
    exitCode: fields.exitCode,
    filePath: fields.filePath,
    fileRef: fields.fileRef,
    ref: fields.ref,
    agentId: fields.agentId,
    parentAgentId: fields.parentAgentId,
    agentType: fields.agentType,
    resultRef: fields.resultRef,
    transcriptRef: fields.transcriptRef,
    refs: fields.refs,
    durationMs: fields.durationMs,
    background: fields.background,
    resume: fields.resume,
    approvalId: fields.approvalId,
    traceStepId: fields.traceStepId,
    raw: backendPublicRaw(raw, fields),
  };
}

function backendPublicRaw(
  raw: unknown,
  fields: Partial<Omit<BackendNormalizedEvent, 'schemaVersion' | 'backend' | 'type' | 'timestamp' | 'raw'>>,
): unknown {
  const hasSubagentProjection = Boolean(
    fields.agentId
      || fields.parentAgentId
      || fields.agentType
      || fields.resultRef
      || fields.transcriptRef
      || fields.refs?.some((ref) => /^subagent:|^artifact:subagent-/i.test(ref)),
  );
  return hasSubagentProjection ? undefined : redactBackendEventValue(raw);
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
  const payload = recordField(raw.payload) ?? recordField(raw.params) ?? raw;
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

function promoteTraceFields(event: BackendNormalizedEvent, traceStep: ModulePipelineTraceStep): BackendNormalizedEvent {
  return {
    ...event,
    traceStepId: traceStep.id,
    ref: event.ref ?? safeBackendPreviewRef(traceStep.ref),
    resultSummary: event.resultSummary ?? compactBackendText(traceStep.resultSummary, 320),
    refs: mergeBackendRefs(event.refs, traceStep.refs),
  };
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
  const refs = backendReferenceFields(raw, payload, item);
  const toolName = toolNameFromRaw(raw, item);
  const fileFields = backendFileFields(raw, payload, item, toolName);
  const thread = recordField(raw.thread) ?? recordField(payload.thread);
  const turn = recordField(raw.turn) ?? recordField(payload.turn);
  return {
    provider: stringField(raw.provider) ?? stringField(payload.provider),
    model: stringField(raw.model) ?? stringField(payload.model),
    profile: stringField(raw.profile) ?? stringField(payload.profile),
    workspace: stringField(raw.workspace) ?? stringField(payload.workspace),
    threadId: stringField(raw.thread_id)
      ?? stringField(raw.threadId)
      ?? stringField(thread?.id)
      ?? stringField(raw.session_id)
      ?? stringField(raw.sessionId)
      ?? stringField(raw.conversation_id)
      ?? stringField(raw.conversationId)
      ?? stringField(payload.thread_id)
      ?? stringField(payload.threadId)
      ?? stringField(thread?.threadId)
      ?? stringField(payload.session_id)
      ?? stringField(payload.sessionId),
    turnId: stringField(raw.turn_id)
      ?? stringField(raw.turnId)
      ?? stringField(turn?.id)
      ?? stringField(raw.request_id)
      ?? stringField(raw.requestId)
      ?? stringField(payload.turn_id)
      ?? stringField(payload.turnId)
      ?? stringField(turn?.turnId)
      ?? stringField(payload.request_id)
      ?? stringField(payload.requestId),
    itemId: stringField(raw.item_id)
      ?? stringField(raw.itemId)
      ?? stringField(raw.call_id)
      ?? stringField(raw.callId)
      ?? stringField(raw.id)
      ?? stringField(item.call_id)
      ?? stringField(item.callId)
      ?? stringField(item.id)
      ?? stringField(payload.call_id)
      ?? stringField(payload.callId)
      ?? stringField(payload.item_id)
      ?? stringField(payload.itemId),
    role: stringField(raw.role) ?? stringField(item.role) ?? stringField(payload.role),
    status: statusFromRaw(raw) ?? statusFromRaw(payload) ?? stringField(item.status),
    ...fileFields,
    ...refs,
  };
}

function backendFileFields(
  raw: Record<string, unknown>,
  payload: Record<string, unknown>,
  item: Record<string, unknown>,
  toolName: string | undefined,
): Pick<BackendNormalizedEvent, 'filePath' | 'fileRef'> {
  const records = backendFileRecords(raw, payload, item);
  const explicitRef = firstSafeBackendPreviewRef(records, 'fileRef', 'file_ref', 'previewRef', 'preview_ref', 'ref');
  const explicitPath = firstSafeBackendRelativePath(records, 'filePath', 'file_path', 'path', 'file', 'filename');
  const refPath = explicitRef?.startsWith('file:') ? safeBackendRelativePath(explicitRef.slice('file:'.length)) : undefined;
  const filePath = explicitPath ?? refPath;
  if (!filePath) return {};
  if (!toolSupportsFilePreview(toolName) && !explicitRef?.startsWith('file:')) return {};
  return {
    filePath,
    fileRef: explicitRef?.startsWith('file:') ? explicitRef : `file:${filePath}`,
  };
}

function backendFileRecords(raw: Record<string, unknown>, payload: Record<string, unknown>, item: Record<string, unknown>) {
  return [
    ...nestedBackendRecords(toolInputFromRaw(raw, item)),
    ...nestedBackendRecords(toolResultFromRaw(raw, item)),
    item,
    recordField(raw.item),
    recordField(payload.item),
    recordField(raw.tool),
    recordField(payload.tool),
    raw,
    payload,
  ].filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function firstSafeBackendRelativePath(records: Record<string, unknown>[], ...keys: string[]) {
  return records
    .flatMap((record) => keys.map((key) => safeBackendRelativePath(stringField(record[key]))))
    .find(Boolean);
}

function toolSupportsFilePreview(toolName: string | undefined) {
  return /^(?:read_file|file_read|open_file|read|cat|edit|write_file|file_write|apply_patch|patch|diff|write)$/i.test(toolName ?? '');
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
  if (isRecord(result) && (result.ok === false || result.success === false || result.error)) return 'failed';
  return 'completed';
}

function statusForEventType(type: BackendNeutralEventType): string | undefined {
  if (type === 'approval_requested') return 'approval-required';
  if (type === 'approval_resolved') return 'resolved';
  if (type === 'tool_started') return 'started';
  if (type === 'tool_completed') return 'completed';
  if (type === 'item_completed') return 'completed';
  return undefined;
}

function singleEvent(event: BackendNormalizedEvent): BackendEventNormalizationResult {
  return { events: [event], traceSteps: [] };
}

function isAssistantMessageItem(
  raw: Record<string, unknown>,
  payload: Record<string, unknown>,
  item: Record<string, unknown>,
  itemType: string | undefined,
  lowerEventType: string,
): boolean {
  const normalizedItemType = normalizeBackendItemType(itemType);
  const role = normalizeBackendItemType(
    stringField(item.role)
      ?? stringField(payload.role)
      ?? stringField(raw.role),
  );
  if (normalizedItemType === 'agentmessage' || normalizedItemType === 'assistantmessage' || normalizedItemType === 'assistant') {
    return true;
  }
  if (normalizedItemType === 'message') {
    return role !== 'user'
      && role !== 'system'
      && role !== 'tool'
      && role !== 'developer';
  }
  if (/agentmessage|assistantmessage/.test(lowerEventType)) {
    return role !== 'user' && role !== 'system' && role !== 'tool' && role !== 'developer';
  }
  return false;
}

function isAssistantVisibleTextEvent(
  raw: Record<string, unknown>,
  payload: Record<string, unknown>,
  item: Record<string, unknown>,
  itemType: string | undefined,
  lowerEventType: string,
): boolean {
  return isResponsesAssistantTextEvent(raw, payload, item, itemType, lowerEventType)
    || isAssistantMessageItem(raw, payload, item, itemType, lowerEventType);
}

function isResponsesAssistantTextEvent(
  raw: Record<string, unknown>,
  payload: Record<string, unknown>,
  item: Record<string, unknown>,
  itemType: string | undefined,
  lowerEventType: string,
): boolean {
  const normalizedEventType = normalizeBackendItemType(lowerEventType);
  if (!normalizedEventType?.startsWith('response')) return false;
  if (/^responseoutputtext(?:delta|done)$/.test(normalizedEventType)) return true;
  if (/^responsecontentpart(?:delta|done)$/.test(normalizedEventType)) {
    const part = recordField(raw.part) ?? recordField(payload.part) ?? item;
    const partType = normalizeBackendItemType(stringField(part.type));
    return !partType || partType === 'outputtext' || partType === 'text';
  }
  if (/^responseoutputitemdone$/.test(normalizedEventType)) {
    return isAssistantMessageItem(raw, payload, item, itemType, lowerEventType);
  }
  if (/^responsecompleted$/.test(normalizedEventType)) {
    return responseHasAssistantText(recordField(raw.response) ?? recordField(payload.response) ?? raw);
  }
  return false;
}

function responseHasAssistantText(response: Record<string, unknown>): boolean {
  if (textField(response.output_text) || textField(response.outputText)) return true;
  const output = Array.isArray(response.output) ? response.output : [];
  return output.some((entry) => {
    if (!isRecord(entry)) return false;
    const itemType = normalizeBackendItemType(stringField(entry.type));
    const role = normalizeBackendItemType(stringField(entry.role));
    if (itemType !== 'message' && itemType !== 'assistantmessage' && itemType !== 'agentmessage') return false;
    if (role && role !== 'assistant') return false;
    return Boolean(textFromContent(entry.content) ?? textField(entry.text) ?? textField(entry.output_text));
  });
}

function normalizeBackendItemType(value: string | undefined): string | undefined {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, '') || undefined;
}

function eventType(raw: Record<string, unknown>): string {
  return stringField(raw.type) ?? stringField(raw.event) ?? stringField(raw.kind) ?? stringField(raw.method) ?? '';
}

function timestampFromRaw(raw: unknown, options: BackendEventNormalizationOptions): string {
  if (isRecord(raw)) {
    const timestamp = stringField(raw.timestamp) ?? stringField(raw.created_at) ?? stringField(raw.createdAt);
    if (timestamp) return timestamp;
  }
  return options.now?.() ?? new Date().toISOString();
}

function toolNameFromRaw(raw: Record<string, unknown>, item: Record<string, unknown>): string | undefined {
  const payload = recordField(raw.payload) ?? recordField(raw.params) ?? {};
  const tool = recordField(raw.tool) ?? recordField(payload.tool) ?? {};
  const request = recordField(raw.request) ?? recordField(raw.control_request) ?? {};
  const itemType = stringField(item.type) ?? stringField(payload.type) ?? stringField(raw.item_type);
  if (/function_call_output/i.test(itemType ?? '')) {
    const refs = backendReferenceFields(raw, payload, item);
    if (
      refs.agentId
      || refs.resultRef
      || refs.transcriptRef
      || refs.refs?.some((ref) => /^subagent:|^artifact:subagent-/i.test(ref))
    ) return 'multi_agent_v1.spawn_agent';
  }
  const namespace = stringField(item.namespace) ?? stringField(payload.namespace);
  const dynamicTool = stringField(item.tool) ?? stringField(payload.tool);
  const mcpServer = stringField(item.server) ?? stringField(payload.server);
  if (dynamicTool && /mcptoolcall/i.test(itemType ?? '')) return normalizeBackendToolName(mcpServer ? `${mcpServer}.${dynamicTool}` : dynamicTool);
  if (dynamicTool) return normalizeBackendToolName(namespace ? `${namespace}.${dynamicTool}` : dynamicTool);
  const mcpTool = stringField(tool.tool);
  if (mcpTool) return normalizeBackendToolName(mcpServer ? `${mcpServer}.${mcpTool}` : mcpTool);
  return normalizeBackendToolName(stringField(item.name)
    ?? stringField(item.tool_name)
    ?? stringField(tool.name)
    ?? stringField(tool.tool_name)
    ?? stringField(request.name)
    ?? stringField(request.tool_name)
    ?? stringField(raw.tool_name)
    ?? stringField(raw.name)
    ?? stringField(payload.name)
    ?? toolNameFromItemType(itemType, commandFromRaw(raw, item)));
}

function normalizeBackendToolName(value: string | undefined): string | undefined {
  if (value === 'multi_agent_v1_spawn_agent') return 'multi_agent_v1.spawn_agent';
  if (value === 'gui_present') return 'gui.present';
  if (value === 'gui_ask_user') return 'gui.ask_user';
  return value;
}

function toolNameFromItemType(itemType: string | undefined, command: string | undefined): string | undefined {
  if (/command_execution|exec|shell|terminal/i.test(itemType ?? '') || command) return 'shell';
  if (/function_call/i.test(itemType ?? '')) return 'function_call';
  if (/dynamictoolcall/i.test(itemType ?? '')) return 'dynamic_tool';
  if (/mcptoolcall/i.test(itemType ?? '')) return 'mcp_tool';
  return undefined;
}

function commandFromRaw(raw: Record<string, unknown>, item: Record<string, unknown>): string | undefined {
  const payload = recordField(raw.payload) ?? recordField(raw.params) ?? {};
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
  return compactBackendText(outputTextFromRaw(raw, item), 320);
}

function outputTextFromRaw(raw: Record<string, unknown>, item: Record<string, unknown>): string | undefined {
  const payload = recordField(raw.payload) ?? recordField(raw.params) ?? {};
  const tool = recordField(raw.tool) ?? recordField(payload.tool) ?? {};
  const response = recordField(raw.response) ?? recordField(raw.control_response) ?? {};
  return stringField(item.outputSummary)
    ?? stringField(item.output_summary)
    ?? stringField(item.aggregated_output)
    ?? stringField(item.output)
    ?? textFromDynamicContentItems(item.contentItems)
    ?? textFromDynamicContentItems(item.content_items)
    ?? stringField(tool.outputSummary)
    ?? stringField(tool.output_summary)
    ?? stringField(tool.output)
    ?? stringField(response.outputSummary)
    ?? stringField(response.output_summary)
    ?? stringField(response.output)
    ?? stringField(raw.outputSummary)
    ?? stringField(raw.output_summary)
    ?? stringField(raw.output)
    ?? stringField(payload.outputSummary)
    ?? stringField(payload.output_summary)
    ?? stringField(payload.output)
    ?? textFromDynamicContentItems(payload.contentItems)
    ?? textFromDynamicContentItems(payload.content_items);
}

function diffFromRaw(raw: Record<string, unknown>, item: Record<string, unknown>): string | undefined {
  const payload = recordField(raw.payload) ?? recordField(raw.params) ?? {};
  const tool = recordField(raw.tool) ?? recordField(payload.tool) ?? {};
  const response = recordField(raw.response) ?? recordField(raw.control_response) ?? {};
  const text = firstUnifiedDiffText([
    item.diff,
    item.patch,
    item.aggregated_output,
    item.output,
    item.result,
    tool.diff,
    tool.patch,
    tool.aggregated_output,
    tool.output,
    tool.result,
    response.diff,
    response.patch,
    response.aggregated_output,
    response.output,
    response.result,
    raw.diff,
    raw.patch,
    raw.aggregated_output,
    raw.output,
    raw.result,
    payload.diff,
    payload.patch,
    payload.aggregated_output,
    payload.output,
    payload.result,
    item.outputSummary,
    item.output_summary,
    tool.outputSummary,
    tool.output_summary,
    response.outputSummary,
    response.output_summary,
    raw.outputSummary,
    raw.output_summary,
    payload.outputSummary,
    payload.output_summary,
  ]);
  if (!looksLikeUnifiedDiff(text)) return undefined;
  return compactBackendBlockText(text, 12_000);
}

function firstUnifiedDiffText(values: unknown[]) {
  return values
    .map(stringField)
    .find((value) => looksLikeUnifiedDiff(value));
}

function exitCodeFromRaw(raw: Record<string, unknown>, item: Record<string, unknown>): number | null | undefined {
  const payload = recordField(raw.payload) ?? recordField(raw.params) ?? {};
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
  const payload = recordField(raw.payload) ?? recordField(raw.params) ?? {};
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
  const payload = recordField(raw.payload) ?? recordField(raw.params) ?? {};
  const tool = recordField(raw.tool) ?? recordField(payload.tool) ?? {};
  const response = recordField(raw.response) ?? recordField(raw.control_response) ?? {};
  return item.result
    ?? item.output
    ?? dynamicToolResultFromContentItems(item.contentItems)
    ?? dynamicToolResultFromContentItems(item.content_items)
    ?? tool.result
    ?? tool.output
    ?? response.result
    ?? response.output
    ?? raw.result
    ?? raw.output
    ?? payload.result
    ?? payload.output
    ?? dynamicToolResultFromContentItems(payload.contentItems)
    ?? dynamicToolResultFromContentItems(payload.content_items);
}

function approvalFromRaw(raw: Record<string, unknown>): Record<string, unknown> | undefined {
  const params = recordField(raw.params);
  return recordField(raw.approval)
    ?? recordField(raw.approval_request)
    ?? recordField(raw.approvalRequest)
    ?? params
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
  const params = recordField(raw.params) ?? {};
  return stringField(raw.status) ?? stringField(raw.subtype) ?? stringField(params.status) ?? stringField(response.status);
}

function backendReferenceFields(
  raw: Record<string, unknown>,
  payload: Record<string, unknown>,
  item: Record<string, unknown>,
): Partial<Pick<BackendNormalizedEvent, 'ref' | 'agentId' | 'parentAgentId' | 'agentType' | 'resultRef' | 'transcriptRef' | 'resultSummary' | 'refs' | 'durationMs' | 'background' | 'resume'>> {
  const records = backendReferenceRecords(raw, payload, item);
  const ref = firstSafeBackendPreviewRef(records, 'ref', 'resultRef', 'result_ref', 'artifactRef', 'artifact_ref', 'outputRef', 'output_ref')
    ?? firstSafeBackendPreviewRefFromArrays(records, 'refs', 'evidenceRefs', 'evidence_refs', 'artifactRefs', 'artifact_refs', 'outputRefs', 'output_refs');
  const resultRef = firstSafeBackendRef(records, 'resultRef', 'result_ref', 'artifactRef', 'artifact_ref', 'outputRef', 'output_ref')
    ?? ref;
  const transcriptRef = firstSafeBackendRef(records, 'transcriptRef', 'transcript_ref', 'transcriptArtifactRef', 'transcript_artifact_ref');
  const refs = mergeBackendRefs(
    backendRefsFromArrays(records, 'refs', 'evidenceRefs', 'evidence_refs', 'artifactRefs', 'artifact_refs', 'outputRefs', 'output_refs'),
    [ref, transcriptRef],
  );
  return {
    ref,
    agentId: firstSafeBackendIdentifier(records, 'agentId', 'agent_id', 'agentPath', 'agent_path'),
    parentAgentId: firstSafeBackendIdentifier(records, 'parentAgentId', 'parent_agent_id', 'parentId', 'parent_id'),
    agentType: firstSafeBackendIdentifier(records, 'agentType', 'agent_type', 'role'),
    resultRef,
    transcriptRef,
    resultSummary: compactBackendText(firstStringFromRecords(records, 'resultSummary', 'result_summary', 'summary'), 320),
    refs,
    durationMs: firstBackendNumberFromRecords(records, 'durationMs', 'duration_ms'),
    background: backendSubagentBackgroundMetadata(records),
    resume: backendSubagentResumeMetadata(records),
  };
}

function backendSubagentBackgroundMetadata(records: Record<string, unknown>[]): BackendSubagentBackgroundMetadata | undefined {
  for (const record of records) {
    const background = recordField(record.background);
    const source = background ?? record;
    const runInBackground = booleanField(source.runInBackground) ?? booleanField(source.run_in_background);
    const stateRef = safeBackendRef(stringField(source.stateRef) ?? stringField(source.state_ref));
    if (runInBackground !== undefined || stateRef) {
      return {
        runInBackground: runInBackground ?? false,
        ...(stateRef ? { stateRef } : {}),
      };
    }
  }
  return undefined;
}

function backendSubagentResumeMetadata(records: Record<string, unknown>[]): BackendSubagentResumeMetadata | undefined {
  for (const record of records) {
    const resume = recordField(record.resume);
    const source = resume ?? record;
    const resumeAgentId = safeBackendIdentifier(stringField(source.resumeAgentId) ?? stringField(source.resume_agent_id));
    const resumeRef = safeBackendRef(stringField(source.resumeRef) ?? stringField(source.resume_ref) ?? stringField(source.resumeCandidateRef) ?? stringField(source.resume_candidate_ref));
    const resumeRequested = booleanField(source.resumeRequested) ?? booleanField(source.resume_requested);
    const boundary = backendSubagentResumeBoundary(stringField(source.resumeBoundary) ?? stringField(source.resume_boundary));
    if (resumeRequested !== undefined || resumeAgentId || resumeRef || boundary) {
      const requested = resumeRequested ?? Boolean(resumeAgentId || resumeRef);
      return {
        resumeRequested: requested,
        ...(resumeAgentId ? { resumeAgentId } : {}),
        ...(resumeRef ? { resumeRef } : {}),
        resumeBoundary: boundary ?? (requested ? 'explicit' : 'none'),
      };
    }
  }
  return undefined;
}

function backendSubagentResumeBoundary(value: string | undefined): 'explicit' | 'none' | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'explicit') return 'explicit';
  if (normalized === 'none') return 'none';
  return undefined;
}

function firstBackendNumberFromRecords(records: Record<string, unknown>[], ...keys: string[]): number | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = numberField(record[key]);
      if (typeof value === 'number') return Math.max(0, value);
    }
  }
  return undefined;
}

function backendReferenceRecords(raw: Record<string, unknown>, payload: Record<string, unknown>, item: Record<string, unknown>) {
  const resultRecords = nestedBackendRecords(toolResultFromRaw(raw, item));
  const inputRecords = nestedBackendRecords(toolInputFromRaw(raw, item));
  return [
    ...resultRecords,
    raw,
    payload,
    item,
    recordField(raw.params),
    recordField(raw.response),
    recordField(raw.control_response),
    recordField(raw.tool),
    recordField(payload.tool),
    ...inputRecords,
  ].filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function nestedBackendRecords(value: unknown, seen = new Set<Record<string, unknown>>()): Record<string, unknown>[] {
  const root = parseJsonRecord(value);
  if (!root || seen.has(root)) return [];
  seen.add(root);
  const records = [root];
  for (const key of ['value', 'result', 'output', 'input', 'arguments', 'args', 'structuredContent', 'structured_content'] as const) {
    records.push(...nestedBackendRecords(root[key], seen));
  }
  const contentItems = Array.isArray(root.contentItems)
    ? root.contentItems
    : Array.isArray(root.content_items)
      ? root.content_items
      : Array.isArray(root.content)
        ? root.content
        : [];
  for (const item of contentItems) {
    records.push(...nestedBackendRecords(isRecord(item) ? item.text ?? item.content : item, seen));
    if (isRecord(item)) {
      records.push(...nestedBackendRecords(item.structuredContent ?? item.structured_content, seen));
    }
  }
  return records;
}

function firstStringFromRecords(records: Record<string, unknown>[], ...keys: string[]) {
  for (const record of records) {
    for (const key of keys) {
      const value = stringField(record[key]);
      if (value) return value;
    }
  }
  return undefined;
}

function firstSafeBackendRef(records: Record<string, unknown>[], ...keys: string[]) {
  return records
    .flatMap((record) => keys.map((key) => safeBackendRef(stringField(record[key]))))
    .find(Boolean);
}

function firstSafeBackendIdentifier(records: Record<string, unknown>[], ...keys: string[]) {
  return records
    .flatMap((record) => keys.map((key) => safeBackendIdentifier(stringField(record[key]))))
    .find(Boolean);
}

function firstSafeBackendPreviewRef(records: Record<string, unknown>[], ...keys: string[]) {
  return records
    .flatMap((record) => keys.map((key) => safeBackendPreviewRef(stringField(record[key]))))
    .find(Boolean);
}

function firstSafeBackendPreviewRefFromArrays(records: Record<string, unknown>[], ...keys: string[]) {
  return records
    .flatMap((record) => keys.flatMap((key) => stringArrayField(record[key]) ?? []))
    .map(safeBackendPreviewRef)
    .find(Boolean);
}

function backendRefsFromArrays(records: Record<string, unknown>[], ...keys: string[]) {
  return safeBackendRefs(records.flatMap((record) => keys.flatMap((key) => stringArrayField(record[key]) ?? [])));
}

function safeBackendPreviewRef(value: string | undefined): string | undefined {
  const text = value?.trim().replace(/\\/g, '/');
  if (!text) return undefined;
  if (text.startsWith('file:')) {
    const path = safeBackendRelativePath(text.slice('file:'.length));
    return path ? `file:${path}` : undefined;
  }
  if (text.startsWith('artifact:')) {
    const payload = text.slice('artifact:'.length);
    return isSafeBackendOpaqueRef(payload) ? `artifact:${payload}` : undefined;
  }
  if (/^(?:[\w.-]+\/|[\w.-]+\.(?:diff|patch|txt|md|json|csv|tsv|yaml|yml))/.test(text)) {
    const path = safeBackendRelativePath(text);
    return path ? `file:${path}` : undefined;
  }
  return undefined;
}

function safeBackendRef(value: string | undefined): string | undefined {
  const text = value?.trim().replace(/\\/g, '/');
  if (!text) return undefined;
  if (text.startsWith('file:') || text.startsWith('artifact:')) return safeBackendPreviewRef(text);
  return isSafeBackendOpaqueRef(text) ? text : undefined;
}

function safeBackendIdentifier(value: string | undefined): string | undefined {
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

function safeBackendRefs(value: unknown): string[] | undefined {
  const refs = Array.isArray(value)
    ? value.map((entry) => typeof entry === 'string' ? entry : undefined).map(safeBackendRef)
    : [];
  const unique = Array.from(new Set(refs.filter((entry): entry is string => Boolean(entry))));
  return unique.length ? unique : undefined;
}

function mergeBackendRefs(...refs: Array<Array<string | undefined> | undefined>): string[] | undefined {
  const unique = Array.from(new Set(refs.flatMap((entry) => entry ?? []).map(safeBackendRef).filter((entry): entry is string => Boolean(entry))));
  return unique.length ? unique : undefined;
}

function safeBackendRelativePath(value: string | undefined): string | undefined {
  const text = value?.trim().replace(/\\/g, '/');
  if (!text) return undefined;
  if (text.startsWith('file:')) return safeBackendRelativePath(text.slice('file:'.length));
  if (/^(?:\/|[A-Za-z]:\/)/.test(text) || text.includes('://') || text.startsWith('~')) return undefined;
  if (/[\r\n\t<>|?*:]/.test(text)) return undefined;
  if (text.split('/').some((part) => part === '..')) return undefined;
  if (/(?:^|\/)(?:Users|Applications|Volumes|private|var|tmp)(?:\/|$)/i.test(text)) return undefined;
  if (/(?:^|\/)\.sciforge\/(?:raw|audit|logs?|task-results)(?:\/|$)/i.test(text)) return undefined;
  if (/(?:^|[\/_.:-])(?:stdout|stderr|raw|logs?)(?:$|[\/_.:-])/i.test(text)) return undefined;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(text)) return undefined;
  return text;
}

function isSafeBackendOpaqueRef(value: string) {
  const text = value.trim();
  if (!text || text.includes('://') || text.startsWith('/') || text.startsWith('~')) return false;
  if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(text)) return false;
  if (/^(?:audit|trace|raw|stdout|stderr|provider):/i.test(text)) return false;
  if (/(?:^|[_.:-])(?:stdout|stderr|raw|log|logs)(?:$|[_.:-])/i.test(text)) return false;
  if (text.includes('..')) return false;
  if (/(?:^|[_.:-])(?:Users|Applications|Volumes|private|var|tmp|\.sciforge)(?:$|[_.:-])/i.test(text)) return false;
  if (/\[local-path\]|\[redacted\]|\[url\]/i.test(text)) return false;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(text)) return false;
  return true;
}

function refsFromRaw(raw: Record<string, unknown>, result: unknown): string[] | undefined {
  const structured = isRecord(result)
    ? recordField(result.structuredContent) ?? recordField(result.structured_content)
    : undefined;
  return safeBackendRefs([
    ...(stringArrayField(raw.refs) ?? []),
    ...(stringArrayField(raw.evidenceRefs) ?? []),
    ...(isRecord(result) ? [
      ...(stringArrayField(result.refs) ?? []),
      ...(stringArrayField(result.evidenceRefs) ?? []),
      ...(stringArrayField(result.artifactRefs) ?? []),
      ...(stringArrayField(result.outputRefs) ?? []),
    ] : []),
    ...(structured ? [
      ...(stringArrayField(structured.refs) ?? []),
      ...(stringArrayField(structured.evidenceRefs) ?? []),
      ...(stringArrayField(structured.artifactRefs) ?? []),
      ...(stringArrayField(structured.outputRefs) ?? []),
    ] : []),
  ]);
}

function operationRefFromRaw(raw: Record<string, unknown>, result: unknown): string | undefined {
  const structured = isRecord(result)
    ? recordField(result.structuredContent) ?? recordField(result.structured_content)
    : undefined;
  return safeBackendRef(stringField(raw.operationRef)
    ?? stringField(raw.operation_ref)
    ?? (isRecord(result) ? stringField(result.operationRef) ?? stringField(result.operation_ref) : undefined)
    ?? (structured ? stringField(structured.operationRef) ?? stringField(structured.operation_ref) : undefined));
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
  const part = recordField(value.part);
  const response = recordField(value.response);
  return textField(value.text)
    ?? textField(value.delta)
    ?? textField(delta?.text)
    ?? textField(value.message)
    ?? textField(error?.message)
    ?? textField(value.output_text)
    ?? textField(value.outputText)
    ?? textFromResponsePart(part)
    ?? textFromResponseOutput(response)
    ?? textField(value.content)
    ?? textFromContent(value.content);
}

function textFromResponsePart(part: Record<string, unknown> | undefined): string | undefined {
  if (!part) return undefined;
  const partType = normalizeBackendItemType(stringField(part.type));
  if (partType && partType !== 'outputtext' && partType !== 'text') return undefined;
  return textField(part.text) ?? textField(part.content);
}

function textFromResponseOutput(response: Record<string, unknown> | undefined): string | undefined {
  if (!response) return undefined;
  const direct = textField(response.output_text) ?? textField(response.outputText);
  if (direct) return direct;
  const output = Array.isArray(response.output) ? response.output : [];
  const text = output.map((entry) => {
    if (!isRecord(entry)) return undefined;
    const itemType = normalizeBackendItemType(stringField(entry.type));
    const role = normalizeBackendItemType(stringField(entry.role));
    if (itemType !== 'message' && itemType !== 'assistantmessage' && itemType !== 'agentmessage') return undefined;
    if (role && role !== 'assistant') return undefined;
    return textFromContent(entry.content) ?? textField(entry.text) ?? textField(entry.output_text);
  }).filter((entry): entry is string => Boolean(entry)).join('');
  return text || undefined;
}

function textFromContent(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined;
  if (!Array.isArray(value)) return undefined;
  const text = value.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (!isRecord(entry)) return undefined;
    return textField(entry.text) ?? textField(entry.content);
  }).filter((entry): entry is string => Boolean(entry)).join('');
  return text || undefined;
}

function textFromDynamicContentItems(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const text = value.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (!isRecord(entry)) return undefined;
    return textField(entry.text)
      ?? textField(entry.content)
      ?? textField(entry.inputText)
      ?? textField(entry.input_text);
  }).filter((entry): entry is string => Boolean(entry)).join('');
  return text || undefined;
}

function dynamicToolResultFromContentItems(value: unknown): unknown {
  const text = textFromDynamicContentItems(value);
  if (!text) return undefined;
  const parsed = parseJsonRecord(text);
  return parsed ?? { output: text };
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

function compactBackendBlockText(value: string | undefined, limit: number): string | undefined {
  if (!value?.trim()) return undefined;
  const redacted = redactBackendText(value)
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
    || /^@@\s+-\d+(?:,\d+)?\s+\d+(?:,\d+)?\s+@@/m.test(text)
    || /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/m.test(text)
    || (/^---\s+\S+/m.test(text) && /^\+\+\+\s+\S+/m.test(text));
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

function isPrivateBackendPayloadKey(key: string): boolean {
  return /^(?:raw|raw[_-]?json|raw[_-]?transcript|transcript|stdout|stderr|logs?|debug[_-]?payload|provider[_-]?config|model[_-]?config)$/i.test(key);
}

function isBackendRefArrayKey(key: string): boolean {
  return /^(?:refs|evidenceRefs|evidence_refs|artifactRefs|artifact_refs|outputRefs|output_refs)$/i.test(key);
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

function textField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return undefined;
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
