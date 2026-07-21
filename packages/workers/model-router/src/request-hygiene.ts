import { createHash } from 'node:crypto';

type JsonRecord = Record<string, unknown>;

const MAX_TOOL_OUTPUT_CHARS = 6_000;
const MAX_ARGUMENT_STRING_CHARS = 6_000;
const MAX_ARGUMENT_ARRAY_ITEMS = 32;
const ARGUMENT_ARRAY_PREVIEW_ITEMS = 6;
const MARKER_KEY = '__sciforge_request_hygiene__';
const OMITTED_SHELL_COMMAND =
  'false # sciforge history metadata only; prior shell command omitted; do not execute or reuse; create a fresh smaller command';

export function hygienizeModelRequestBody(body: Record<string, unknown>): Record<string, unknown> {
  return hygienizeValue(body, { source: 'model_request' }) as Record<string, unknown>;
}

function hygienizeValue(value: unknown, context: HygieneContext): unknown {
  if (typeof value === 'string') {
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
  const recordType = stringField(value.type);
  const out: JsonRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    const hygienized = hygienizeValue(entry, {
      key,
      role,
      recordType,
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
    return markerText('tool_message.content', 'large_tool_output', value, safeSummary(replaceEncodedPayloads(value, 'tool_message.content')));
  }
  const replaced = replaceEncodedPayloads(value, source);
  if (isToolOutputContext(context) && replaced.length > MAX_TOOL_OUTPUT_CHARS) {
    return markerText('tool_message.content', 'large_tool_output', value, safeSummary(replaced));
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
  source: string;
};
