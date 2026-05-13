import { createHash } from 'node:crypto';
import type { ConversationEventLog } from './types';

export function conversationEventLogDigest(log: ConversationEventLog): string {
  return `sha256:${createHash('sha256').update(stableStringify(log)).digest('hex')}`;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}
