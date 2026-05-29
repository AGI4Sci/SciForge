import { sanitizePackageBridgeDiagnosticText } from '../src/runtime/computer-use/package-bridge-invocation-diagnostics.js';

export function recordAt(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return isRecord(value[key]) ? value[key] : undefined;
}

export function compactRecord<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => {
    if (value === undefined || value === null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (isRecord(value)) return Object.keys(value).length > 0;
    return true;
  }));
}

export function refsFromUnknown(value: unknown, depth = 0): string[] {
  if (depth > 6) return [];
  if (typeof value === 'string') return looksLikeEvidenceRef(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => refsFromUnknown(item, depth + 1));
  if (!isRecord(value)) return [];
  return Object.values(value).flatMap((item) => refsFromUnknown(item, depth + 1));
}

export function looksLikeEvidenceRef(value: string): boolean {
  return /(?:^\.sciforge\/|^\/|\.json$|\.png$|\.jpe?g$|\.webp$|^artifact:|^audit:|^workEvidence:|^EU-)/i.test(value.trim());
}

export function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function stringAt(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

export function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function refsInUnknown(value: unknown): string[] {
  const refs: string[] = [];
  const visit = (item: unknown) => {
    if (typeof item === 'string') {
      const matches = item.match(/(?:\.sciforge|\/)[^"'`\s),\]]*(?:vision-trace|blocked-manifest|repair-hint|continuation-request|tui-host-run-task-chain|computer-use-request|approval-request|gui-ask-user|risk-audit|approval-source-request|approval-source-gui-ask-user|approval-source-risk-audit|approval-decision|confirmed-request)\.json/g);
      if (matches) refs.push(...matches);
      return;
    }
    if (Array.isArray(item)) {
      for (const entry of item) visit(entry);
      return;
    }
    if (!isRecord(item)) return;
    for (const entry of Object.values(item)) visit(entry);
  };
  visit(value);
  return uniqueStrings(refs);
}

export function quoteCommandArg(value: string) {
  if (/^[A-Za-z0-9._:@/-]+$/.test(value)) return value;
  return `"${value.replace(/(["\\])/g, '\\$1')}"`;
}

export function recordingFetch(fetchImpl: typeof fetch | undefined, requestBodies: Array<Record<string, unknown>>): typeof fetch {
  const baseFetch = fetchImpl ?? globalThis.fetch;
  return (async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/sciforge/tools/run/stream')) {
      const body = parseJsonObject(String(init?.body ?? '{}'));
      if (body) requestBodies.push(body);
    }
    return baseFetch(input, init);
  }) as typeof fetch;
}

export function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function clipText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const sanitized = sanitizeDiagnosticText(value.replace(/\s+/g, ' ').trim());
  return sanitized.length > maxChars ? `${sanitized.slice(0, maxChars - 14).trim()}...[truncated]` : sanitized;
}

export function sanitizeDiagnosticText(value: string): string {
  return sanitizePackageBridgeDiagnosticText(value)
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:token|apiKey|api_key|api-key|secret|password|credential)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;&]+)/gi, '[redacted]')
    .replace(/https?:\/\/[^/@\s]+:[^/@\s]+@/gi, (prefix) => prefix.replace(/\/\/.*@/, '//'));
}
