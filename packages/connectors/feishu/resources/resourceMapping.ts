import {
  CHANNEL_RESOURCE_RESULT_SCHEMA_VERSION,
  type ChannelResourceItem,
  type ChannelResourceResult,
} from '../../../contracts/runtime/channel-plugin';
import { feishuRef } from '../intake/normalizeMessage';

export function resourceResult(input: {
  accountId: string;
  items: ChannelResourceItem[];
  auditRefs: string[];
  nextCursor?: string;
}): ChannelResourceResult {
  return {
    schemaVersion: CHANNEL_RESOURCE_RESULT_SCHEMA_VERSION,
    channel: 'feishu',
    accountId: input.accountId,
    items: input.items,
    refs: unique([
      ...input.items.map((item) => item.ref),
      ...input.items.map((item) => item.artifactRef),
      ...input.items.flatMap((item) => item.attachmentRefs ?? []),
      ...input.auditRefs,
    ]),
    auditRefs: input.auditRefs,
    nextCursor: input.nextCursor,
  };
}

export function recordsFromJson(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ['items', 'messages', 'docs', 'files', 'data']) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested.filter(isRecord);
  }
  return [value];
}

export function feishuResourceRef(kind: 'message' | 'doc' | 'file', value: Record<string, unknown>, fallback: string): string {
  const id = firstString(value.ref, value.id, value.message_id, value.messageId, value.doc_id, value.file_token, value.file_key) ?? fallback;
  return id.startsWith('feishu:') ? id : feishuRef(kind, id);
}

export function artifactRefForFeishu(kind: string, ref: string): string {
  return `artifact:feishu-${kind}-${ref.replace(/^feishu:/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
}

export function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

export function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
