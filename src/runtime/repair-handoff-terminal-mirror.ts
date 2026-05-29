import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface RepairTerminalMirrorEntry {
  timestamp: string;
  stream: 'stdout' | 'stderr' | 'event';
  text: string;
}

export interface RepairTerminalMirrorTail {
  terminalMirrorRef: string;
  entries: RepairTerminalMirrorEntry[];
  cursor: number;
  nextCursor: number;
  totalEntries: number;
}

export class TerminalMirrorLog {
  constructor(readonly path: string) {}

  async append(stream: RepairTerminalMirrorEntry['stream'], text: string) {
    await mkdir(dirname(this.path), { recursive: true });
    const entry: RepairTerminalMirrorEntry = {
      timestamp: new Date().toISOString(),
      stream,
      text: scrubTerminalMirrorText(text),
    };
    await appendFile(this.path, `${JSON.stringify(entry)}\n`, 'utf8');
  }
}

export async function appendRepairTerminalMirrorEntry(
  path: string,
  stream: RepairTerminalMirrorEntry['stream'],
  text: string,
) {
  await new TerminalMirrorLog(path).append(stream, text);
}

export function parseRepairTerminalMirrorNdjson(
  text: string,
  options: { cursor?: number; limit?: number; terminalMirrorRef?: string } = {},
): RepairTerminalMirrorTail {
  const cursor = Math.max(0, Math.floor(options.cursor ?? 0));
  const limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 200)));
  const entries = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => safeParseJson(line))
    .filter(isRepairTerminalMirrorEntry);
  return {
    terminalMirrorRef: options.terminalMirrorRef || '',
    entries: entries.slice(cursor, cursor + limit),
    cursor,
    nextCursor: Math.min(entries.length, cursor + limit),
    totalEntries: entries.length,
  };
}

export function scrubTerminalMirrorText(text: string) {
  return text
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[a-z0-9_]{20,}\b/gi, '[redacted github token]')
    .replace(/\b(?:sk|pat|token)_[a-z0-9_-]{20,}\b/gi, '[redacted token]')
    .replace(/authorization:\s*[^\s]+(?:\s+[^\s]+)?/gi, 'authorization: [redacted]')
    .replace(/\b(?:x-api-key|api-key|proxy-authorization):\s*[^\s]+/gi, (match) => `${match.split(':')[0]}: [redacted]`)
    .replace(/\b(rawProviderBody|providerRawBody|raw_provider_body)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1: [redacted provider body]')
    .replace(/\/Users\/[^\s"'`<>]+/g, '[redacted local path]')
    .replace(/\/home\/[^\s"'`<>]+/g, '[redacted local path]')
    .replace(/\/private\/(?:tmp|var)\/[^\s"'`<>]+/g, '[redacted local path]')
    .replace(/\b[A-Za-z]:\\Users\\[^\s"'`<>]+/g, '[redacted local path]')
    .slice(0, 12_000);
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRepairTerminalMirrorEntry(value: unknown): value is RepairTerminalMirrorEntry {
  if (!isRecord(value)) return false;
  return typeof value.timestamp === 'string'
    && (value.stream === 'stdout' || value.stream === 'stderr' || value.stream === 'event')
    && typeof value.text === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
