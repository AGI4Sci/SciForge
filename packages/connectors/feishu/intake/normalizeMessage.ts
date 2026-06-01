import {
  CHANNEL_MESSAGE_SCHEMA_VERSION,
  type ChannelMessageEnvelope,
} from '../../../contracts/runtime/channel-plugin';

export interface FeishuNormalizeOptions {
  accountId: string;
  policyRef: string;
  tenant?: string;
  bot?: string;
  now?: () => Date | string;
  rawEventRef?: string;
  auditRef?: string;
}

export function normalizeFeishuIncomingEvent(event: unknown, options: FeishuNormalizeOptions): ChannelMessageEnvelope {
  const root = record(event) ?? {};
  const eventRecord = record(root.event) ?? root;
  const messageRecord = record(eventRecord.message) ?? eventRecord;
  const senderRecord = record(eventRecord.sender) ?? record(messageRecord.sender) ?? {};

  const messageId = firstString(
    messageRecord.message_id,
    messageRecord.messageId,
    eventRecord.message_id,
    root.message_id,
    root.uuid,
    root.event_id,
  ) ?? `manual-${stableSlug(JSON.stringify(event).slice(0, 240))}`;
  const chatId = firstString(
    messageRecord.chat_id,
    messageRecord.chatId,
    eventRecord.chat_id,
    eventRecord.open_chat_id,
    root.chat_id,
    root.open_chat_id,
    root.conversation_id,
  ) ?? 'unknown-chat';
  const senderId = firstString(
    senderRecord.open_id,
    senderRecord.openId,
    senderRecord.user_id,
    senderRecord.userId,
    senderRecord.union_id,
    senderRecord.sender_id,
    eventRecord.sender_id,
    root.sender_id,
  ) ?? 'unknown-user';
  const receivedAt = firstString(root.create_time, root.event_time, messageRecord.create_time, eventRecord.create_time)
    ?? isoFromClock(options.now ?? (() => new Date()));
  const text = extractText(messageRecord, eventRecord, root);
  const attachmentRefs = extractAttachmentRefs(messageRecord, eventRecord);
  const rawEventRef = options.rawEventRef ?? `audit:feishu:raw:${stableSlug(messageId)}`;
  const auditRef = options.auditRef ?? `audit:feishu:intake:${stableSlug(messageId)}`;
  const externalMessageRef = feishuRef('message', messageId);
  const conversationRef = feishuRef('chat', chatId);

  return {
    schemaVersion: CHANNEL_MESSAGE_SCHEMA_VERSION,
    messageId: `feishu-${stableSlug(messageId)}`,
    channel: 'feishu',
    accountId: options.accountId,
    conversationRef,
    externalMessageRef,
    senderRef: feishuRef('user', senderId),
    senderDisplayName: firstString(senderRecord.name, senderRecord.sender_name, senderRecord.display_name, root.sender_name),
    text,
    mentions: extractMentions(messageRecord, eventRecord),
    attachmentRefs,
    rawEventRef,
    auditRef,
    dedupeKey: `feishu:${options.accountId}:${externalMessageRef}`,
    receivedAt,
    replyTarget: {
      externalThreadRef: optionalFeishuRef('thread', firstString(messageRecord.thread_id, eventRecord.thread_id, messageRecord.root_id)),
      externalMessageRef,
    },
    authScope: {
      tenant: options.tenant,
      bot: options.bot,
      policyRef: options.policyRef,
    },
  };
}

export function normalizeFeishuCliEvent(event: unknown, options: FeishuNormalizeOptions): ChannelMessageEnvelope {
  return normalizeFeishuIncomingEvent(event, options);
}

export function normalizeFeishuWebhookEvent(event: unknown, options: FeishuNormalizeOptions): ChannelMessageEnvelope {
  return normalizeFeishuIncomingEvent(event, options);
}

export function feishuRef(kind: 'message' | 'chat' | 'user' | 'doc' | 'file' | 'thread' | string, id: string): string {
  return `feishu:${kind}:${stableSlug(id)}`;
}

function optionalFeishuRef(kind: string, id: string | undefined): string | undefined {
  return id ? feishuRef(kind, id) : undefined;
}

function extractText(...records: Array<Record<string, unknown>>): string {
  for (const item of records) {
    const direct = firstString(item.text, item.plain_text, item.message, item.body);
    if (direct) return direct;
    const content = item.content;
    if (typeof content === 'string') {
      const parsed = parseJsonRecord(content);
      const parsedText = parsed ? firstString(parsed.text, parsed.plain_text, parsed.content) : undefined;
      return parsedText ?? content;
    }
    const contentRecord = record(content);
    const nestedText = contentRecord ? firstString(contentRecord.text, contentRecord.plain_text, contentRecord.content) : undefined;
    if (nestedText) return nestedText;
  }
  return '';
}

function extractMentions(...records: Array<Record<string, unknown>>): string[] {
  const values: string[] = [];
  for (const item of records) {
    const mentions = Array.isArray(item.mentions) ? item.mentions : [];
    for (const mention of mentions) {
      const mentionRecord = record(mention);
      const id = mentionRecord ? firstString(mentionRecord.id, mentionRecord.open_id, mentionRecord.user_id, mentionRecord.name, mentionRecord.key) : undefined;
      if (id) values.push(id.startsWith('feishu:') ? id : feishuRef('user', id));
    }
  }
  return unique(values);
}

function extractAttachmentRefs(...records: Array<Record<string, unknown>>): string[] {
  const refs: string[] = [];
  for (const item of records) {
    const attachments = Array.isArray(item.attachments) ? item.attachments : [];
    for (const attachment of attachments) {
      const attachmentRecord = record(attachment);
      const id = attachmentRecord ? firstString(attachmentRecord.file_key, attachmentRecord.fileKey, attachmentRecord.image_key, attachmentRecord.media_id, attachmentRecord.id) : undefined;
      if (id) refs.push(feishuRef('file', id));
    }
    const contentRecord = typeof item.content === 'string' ? parseJsonRecord(item.content) : record(item.content);
    if (contentRecord) {
      const id = firstString(contentRecord.file_key, contentRecord.fileKey, contentRecord.image_key, contentRecord.media_id);
      if (id) refs.push(feishuRef('file', id));
    }
  }
  return unique(refs);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    return record(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function stableSlug(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.slice(0, 96) || 'unknown';
}

function isoFromClock(now: () => Date | string): string {
  const value = now();
  return value instanceof Date ? value.toISOString() : value;
}
