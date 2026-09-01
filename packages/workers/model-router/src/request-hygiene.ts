import { createHash } from 'node:crypto';

type JsonRecord = Record<string, unknown>;

const MAX_TOOL_OUTPUT_CHARS = 6_000;
const MAX_ARGUMENT_STRING_CHARS = 6_000;
const MAX_ARGUMENT_ARRAY_ITEMS = 32;
const ARGUMENT_ARRAY_PREVIEW_ITEMS = 6;
const HANDOFF_STRING_PREVIEW_CHARS = 384;
const HANDOFF_ARRAY_PREVIEW_ITEMS = 12;
const HANDOFF_OBJECT_PREVIEW_KEYS = 24;
const HANDOFF_PREVIEW_DEPTH = 3;
const HANDOFF_MAX_SERIALIZED_CHARS = 2_400;
const MARKER_KEY = '__sciforge_request_hygiene__';
const OMITTED_SHELL_COMMAND =
  'false # sciforge history metadata only; prior shell command omitted; do not execute or reuse; create a fresh smaller command';

export function hygienizeModelRequestBody(body: Record<string, unknown>): Record<string, unknown> {
  return hygienizeValue(body, {
    source: 'model_request',
    visualGenerateCallIds: collectVisualGenerateCallIds(body),
  }) as Record<string, unknown>;
}

/**
 * Route handoffs are only meaningful when the corresponding tool call was the
 * canonical image-generation planner.  Keep the call ids in the request
 * envelope so an unrelated tool result cannot smuggle a routeLocked object
 * into the compact model history summary.
 */
function collectVisualGenerateCallIds(body: Record<string, unknown>): ReadonlySet<string> {
  const ids = new Set<string>();
  collectVisualGenerateCallIdsFromValue(body, ids, 0);
  return ids;
}

function collectVisualGenerateCallIdsFromValue(value: unknown, ids: Set<string>, depth: number): void {
  if (depth > 8 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const entry of value) collectVisualGenerateCallIdsFromValue(entry, ids, depth + 1);
    return;
  }
  const record = value as JsonRecord;
  if (record.type === 'function_call' && record.name === 'visual_generate') {
    const callId = stringField(record.call_id);
    if (callId) ids.add(callId);
  }
  if (record.role === 'assistant' && Array.isArray(record.tool_calls)) {
    for (const toolCall of record.tool_calls) {
      if (!isRecord(toolCall)) continue;
      const functionCall = isRecord(toolCall.function) ? toolCall.function : toolCall;
      if (functionCall.name !== 'visual_generate') continue;
      const callId = stringField(toolCall.id) || stringField(toolCall.call_id);
      if (callId) ids.add(callId);
    }
  }
  for (const entry of Object.values(record)) {
    collectVisualGenerateCallIdsFromValue(entry, ids, depth + 1);
  }
}

function hygienizeValue(value: unknown, context: HygieneContext): unknown {
  if (typeof value === 'string') {
    if (isOpaqueResponsesContinuationState(context)) return value;
    if (context.key === 'arguments') return hygienizeToolArguments(value, sourceForContext(context, 'tool_call.arguments'));
    return hygienizeText(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => hygienizeValue(entry, {
      ...context,
      key: undefined,
      source: `${context.source}.${index}`,
    }));
  }
  if (!isRecord(value)) return value;
  if (isStructuredImagePart(value)) return value;

  const role = stringField(value.role);
  const recordType = stringField(value.type) || context.recordType;
  const callId = stringField(value.call_id) || stringField(value.tool_call_id);
  const routeHandoffAllowed = (recordType === 'function_call_output' || role === 'tool')
    && Boolean(callId)
    && context.visualGenerateCallIds?.has(callId);
  const out: JsonRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    const hygienized = hygienizeValue(entry, {
      key,
      role,
      recordType,
      routeHandoffAllowed,
      visualGenerateCallIds: context.visualGenerateCallIds,
      source: sourceForRecordEntry(context, role, key),
    });
    Object.defineProperty(out, key, {
      configurable: true,
      enumerable: true,
      value: hygienized,
      writable: true,
    });
  }
  return out;
}

function isOpaqueResponsesContinuationState(context: HygieneContext): boolean {
  return context.key === 'encrypted_content'
    && (context.recordType === 'reasoning' || context.recordType === 'compaction');
}

function hygienizeToolArguments(value: string, source: string): string {
  const parsed = parseJson(value);
  if (parsed !== undefined) {
    return JSON.stringify(hygienizeArgumentValue(parsed, source));
  }
  const withPayloadsFolded = replaceEncodedPayloads(value, source);
  if (value.length <= MAX_ARGUMENT_STRING_CHARS && withPayloadsFolded.length <= MAX_ARGUMENT_STRING_CHARS) return withPayloadsFolded;
  return markerText(source, 'large_tool_arguments', value, safeSummary(withPayloadsFolded));
}

function hygienizeArgumentValue(value: unknown, source: string): unknown {
  if (typeof value === 'string') {
    const text = replaceEncodedPayloads(value, source);
    if (isShellCommandSource(source) && isShellHistoryPlaceholder(text)) return OMITTED_SHELL_COMMAND;
    if (text.length <= MAX_ARGUMENT_STRING_CHARS) return text;
    if (isShellCommandSource(source)) return OMITTED_SHELL_COMMAND;
    return markerText(source, 'large_argument_string', value, safeSummary(text));
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARGUMENT_ARRAY_ITEMS) {
      return markerObject(source, 'long_array', JSON.stringify(value), {
        originalItems: value.length,
        preview: value
          .slice(0, ARGUMENT_ARRAY_PREVIEW_ITEMS)
          .map((entry, index) => hygienizeArgumentValue(entry, `${source}.${index}`)),
      });
    }
    return value.map((entry, index) => hygienizeArgumentValue(entry, `${source}.${index}`));
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, hygienizeArgumentValue(entry, `${source}.${key}`)]),
  );
}

function isShellCommandSource(source: string): boolean {
  return /(?:^|\.)(?:cmd|command|shell_command|shellcommand)$/iu.test(source);
}

function isShellHistoryPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.startsWith('[cache hygiene:') ||
    trimmed.startsWith('[sciforge request_hygiene') ||
    /^(?::|false)\s*#\s*sciforge\s+(?:history metadata only|history omitted prior (?:bash|shell) command|request hygiene omitted prior shell command)\b/iu.test(trimmed)
  );
}

function hygienizeText(value: string, context: HygieneContext): string {
  const source = sourceForContext(context, context.source);
  if (isToolOutputContext(context) && value.length > MAX_TOOL_OUTPUT_CHARS) {
    return markerText(
      'tool_message.content',
      'large_tool_output',
      value,
      safeToolOutputSummary(value, context.routeHandoffAllowed === true),
    );
  }
  const replaced = replaceEncodedPayloads(value, source);
  if (isToolOutputContext(context) && replaced.length > MAX_TOOL_OUTPUT_CHARS) {
    return markerText(
      'tool_message.content',
      'large_tool_output',
      value,
      safeToolOutputSummary(replaced, context.routeHandoffAllowed === true),
    );
  }
  return replaced;
}

function isToolOutputContext(context: HygieneContext): boolean {
  return (context.role === 'tool' && context.key === 'content')
    || (context.recordType === 'function_call_output' && context.key === 'output')
    || (context.recordType === 'tool_result' && context.key === 'content');
}

function replaceEncodedPayloads(value: string, source: string): string {
  return value
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/gi, (match) => markerText(source, 'image_payload', match))
    .replace(/\b[A-Za-z0-9+/_-]{512,}={0,2}\b/g, (match) => (
      isLikelyEncodedPayload(match) ? markerText(source, 'encoded_payload', match) : match
    ));
}

function isLikelyEncodedPayload(value: string): boolean {
  const core = value.replace(/=+$/u, '');
  if (core.length < 512) return false;
  if (/^([A-Za-z0-9+/_-])\1+$/u.test(core)) return false;
  const categories = [
    /[A-Z]/u.test(core),
    /[a-z]/u.test(core),
    /\d/u.test(core),
    /[+/_-]/u.test(core),
  ].filter(Boolean).length;
  return categories >= 2 && core.length % 4 !== 1;
}

function markerText(source: string, reason: string, original: string, summary?: string): string {
  return [
    '[sciforge request_hygiene',
    `source=${source}`,
    `reason=${reason}`,
    `digest=${sha256Digest(original)}`,
    `original_chars=${original.length}`,
    summary ? `summary=${JSON.stringify(summary)}` : '',
    ']',
  ].filter(Boolean).join(' ');
}

function markerObject(source: string, reason: string, original: unknown, extra: JsonRecord = {}): JsonRecord {
  const text = typeof original === 'string' ? original : JSON.stringify(original);
  return {
    [MARKER_KEY]: {
      source,
      reason,
      digest: sha256Digest(text),
      originalChars: text.length,
      ...extra,
    },
  };
}

function safeSummary(value: string): string {
  const normalized = value
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= 360) return normalized;
  return `${normalized.slice(0, 220)} ... ${normalized.slice(-120)}`;
}

/**
 * Tool output is folded before it is sent back to a model. Keep a compact
 * route-locked handoff when one is present so the next model turn can carry
 * on with the declared plan instead of guessing a new route. This is shape
 * based rather than tied to a particular tool or domain identifier: any
 * object carrying a plan id, route, and an explicit route lock is eligible.
 */
function safeToolOutputSummary(value: string, allowRouteHandoff: boolean): string {
  const replaced = replaceEncodedPayloads(value, 'tool_message.content');
  const parsed = parseStructuredToolOutput(replaced);
  const handoff = allowRouteHandoff ? findRouteLockedHandoff(parsed) : undefined;
  if (!handoff) return safeSummary(replaced);

  const compact = compactHandoff(handoff);
  const handoffText = JSON.stringify(compact);
  return `route_locked_handoff=${handoffText}; text_preview=${safeSummary(replaced)}`;
}

function parseStructuredToolOutput(value: string): unknown | undefined {
  const parsed = parseJson(value);
  if (parsed !== undefined) return parsed;

  // MCP text results commonly prefix a pretty-printed JSON payload with a
  // short title (for example, "Visual production plan: ready."). Try a small
  // bounded number of object starts to tolerate a title containing braces,
  // while avoiding an untrusted brace-heavy output causing quadratic parsing.
  let attempts = 0;
  for (let index = value.indexOf('{'); index >= 0 && attempts < 8; index = value.indexOf('{', index + 1)) {
    attempts += 1;
    const candidate = parseJson(value.slice(index));
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

function findRouteLockedHandoff(value: unknown, depth = 0, visited = { count: 0 }): JsonRecord | undefined {
  if (!isRecord(value) || depth > HANDOFF_PREVIEW_DEPTH || visited.count >= 256) return undefined;
  visited.count += 1;
  if (isVisualGenerateResult(value)) {
    return value.handoff as JsonRecord;
  }
  for (const entry of Object.values(value)) {
    const found = findRouteLockedHandoff(entry, depth + 1, visited);
    if (found) return found;
  }
  return undefined;
}

function isVisualGenerateResult(value: JsonRecord): boolean {
  if (value.ok !== true || (value.status !== 'ready' && value.status !== 'budget_exhausted')) return false;
  if (value.routeLocked !== true || !isRecord(value.handoff) || !isRecord(value.execution) || !isRecord(value.failPolicy)) return false;
  const handoff = value.handoff;
  if (
    typeof handoff.planId !== 'string'
    || !handoff.planId.trim()
    || handoff.routeLocked !== true
    || !['code', 'model', 'hybrid'].includes(handoff.route as string)
    || handoff.fallbackPolicy !== 'fail_closed'
  ) return false;
  const execution = value.execution;
  const failPolicy = value.failPolicy;
  return execution.route === handoff.route
    && Array.isArray(execution.stages)
    && isRecord(execution.nextCall)
    && failPolicy.mode === 'fail_closed'
    && failPolicy.crossRouteFallback === false
    && failPolicy.routeChangeRequiresNewPlan === true;
}

function compactHandoff(value: JsonRecord): JsonRecord {
  // Keep the three routing keys first. Remaining fields are copied in their
  // original order with bounded values so the summary remains safe to replay.
  const preferredKeys = ['planId', 'route', 'routeLocked'];
  const keys = [
    ...preferredKeys.filter((key) => Object.hasOwn(value, key)),
    ...Object.keys(value).filter((key) => !preferredKeys.includes(key)).slice(0, HANDOFF_OBJECT_PREVIEW_KEYS)
  ];
  const out: JsonRecord = {};
  for (const key of keys) {
    const entry = compactHandoffValue(value[key]);
    if (entry === undefined) continue;
    const candidate = { ...out, [key]: entry };
    if (JSON.stringify(candidate).length > HANDOFF_MAX_SERIALIZED_CHARS && !preferredKeys.includes(key)) continue;
    Object.defineProperty(out, key, {
      configurable: true,
      enumerable: true,
      value: entry,
      writable: true,
    });
  }
  return out;
}

function compactHandoffValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length <= HANDOFF_STRING_PREVIEW_CHARS) return value;
    return `${value.slice(0, HANDOFF_STRING_PREVIEW_CHARS - 16)} ...[truncated]`;
  }
  if (depth >= HANDOFF_PREVIEW_DEPTH) return '[nested value omitted]';
  if (Array.isArray(value)) {
    return value.slice(0, HANDOFF_ARRAY_PREVIEW_ITEMS).map((entry) => compactHandoffValue(entry, depth + 1));
  }
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, HANDOFF_OBJECT_PREVIEW_KEYS)
      .map(([key, entry]) => [key, compactHandoffValue(entry, depth + 1)])
      .filter(([, entry]) => entry !== undefined)
  );
}

function sourceForRecordEntry(context: HygieneContext, role: string, key: string): string {
  if (key === 'content' && role) return `${role}_message.content`;
  if (key === 'text') return `${role ? `${role}_message` : 'message'}.text`;
  if (key === 'arguments') return 'tool_call.arguments';
  return `${context.source}.${key}`;
}

function sourceForContext(context: HygieneContext, fallback: string): string {
  if (context.key === 'content' && context.role) return `${context.role}_message.content`;
  if (context.key === 'text') return `${context.role ? `${context.role}_message` : 'message'}.text`;
  if (context.key === 'arguments') return 'tool_call.arguments';
  return fallback;
}

function isStructuredImagePart(value: JsonRecord): boolean {
  const type = stringField(value.type).toLowerCase();
  if (type === 'image_url' && isRecord(value.image_url)) return true;
  if (type === 'input_image' && (typeof value.image_url === 'string' || typeof value.url === 'string')) return true;
  if (type === 'image' && isRecord(value.source)) return true;
  return false;
}

function sha256Digest(value: string) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function parseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

type HygieneContext = {
  key?: string;
  role?: string;
  recordType?: string;
  routeHandoffAllowed?: boolean;
  visualGenerateCallIds?: ReadonlySet<string>;
  source: string;
};
