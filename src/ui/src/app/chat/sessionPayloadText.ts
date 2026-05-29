export function digestTextField(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return {
    omitted: 'text-body',
    chars: value.length,
    hash: stableTextHash(value),
  };
}

function stableTextHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function omittedTextDigestLabel(label: string, value: string) {
  const digest = digestTextField(value);
  return digest?.hash
    ? `[${label} omitted; digest=${digest.hash}; chars=${digest.chars ?? value.length}]`
    : `[${label} omitted]`;
}

export function isCompactRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function compactRecord(record: Record<string, unknown> | undefined, maxChars: number) {
  if (!record) return undefined;
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'data' || key === 'events') continue;
    compacted[key] = compactInlineValue(value, maxChars).value;
  }
  return compacted;
}

export function compactInlineValue(value: unknown, maxChars: number): { value: unknown; omitted: boolean; approxBytes?: number } {
  if (typeof value === 'string') {
    return value.length > maxChars
      ? { value: clipText(value, maxChars), omitted: false, approxBytes: value.length }
      : { value, omitted: false };
  }
  if (value === undefined || value === null || typeof value === 'number' || typeof value === 'boolean') {
    return { value, omitted: false };
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= maxChars) return { value, omitted: false };
    return { value: `[omitted from chat payload: ${serialized.length} chars]`, omitted: true, approxBytes: serialized.length };
  } catch {
    return { value: '[omitted from chat payload: unserializable value]', omitted: true };
  }
}

export function clipOptionalText(value: string | undefined, maxChars: number) {
  return value === undefined ? undefined : clipText(value, maxChars);
}

export function compactDiagnosticText(value: string | undefined, maxChars: number, label: string) {
  if (value === undefined) return undefined;
  return value.length > maxChars ? omittedTextDigestLabel(label, value) : value;
}

export function clipText(value: string, maxChars: number) {
  return value.length > maxChars ? `${value.slice(0, maxChars)}...[truncated]` : value;
}
