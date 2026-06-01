import type { SciForgeMessage, SciForgeMessageProvenance } from './messages';
import type { SciForgeReference } from './references';

export const CHANNEL_MESSAGE_SCHEMA_VERSION = 'sciforge.channel-message.v1' as const;
export const CHANNEL_DELIVERY_SCHEMA_VERSION = 'sciforge.channel-delivery.v1' as const;
export const CHANNEL_RESOURCE_RESULT_SCHEMA_VERSION = 'sciforge.channel-resource-result.v1' as const;
export const CHANNEL_LEDGER_EVENT_SCHEMA_VERSION = 'sciforge.channel-ledger-event.v1' as const;

export type ChannelTransport = 'webhook' | 'websocket' | 'cli-event-stream' | 'polling' | 'manual-import';
export type ChannelSideEffect = 'none' | 'read' | 'send' | 'upload' | 'delete' | 'admin';
export type ChannelDeliveryStatus = 'drafted' | 'queued' | 'sent' | 'failed' | 'blocked' | 'duplicate';
export type ChannelBindingStatus = 'bound' | 'created' | 'unbound';

export interface ChannelPluginManifest {
  pluginId: string;
  channelKind: 'feishu' | 'wechat' | 'enterprise-wechat' | 'slack' | 'email' | string;
  title: string;
  version: string;
  transports: ChannelTransport[];
  capabilities: {
    intake?: boolean;
    resource?: boolean;
    delivery?: boolean;
    confirmation?: boolean;
    streamingDelivery?: boolean;
    media?: boolean;
    reactions?: boolean;
  };
  refPrefixes: string[];
  permissionScopes: string[];
  sideEffects: ChannelSideEffect[];
}

export interface ChannelMessageEnvelope {
  schemaVersion: typeof CHANNEL_MESSAGE_SCHEMA_VERSION;
  messageId: string;
  channel: string;
  accountId: string;
  conversationRef: string;
  externalMessageRef: string;
  senderRef: string;
  senderDisplayName?: string;
  text: string;
  mentions?: string[];
  attachmentRefs?: string[];
  rawEventRef: string;
  auditRef: string;
  dedupeKey: string;
  receivedAt: string;
  replyTarget?: {
    externalThreadRef?: string;
    externalMessageRef?: string;
  };
  authScope: {
    tenant?: string;
    bot?: string;
    policyRef: string;
  };
}

export interface ChannelSessionBinding {
  bindingRef: string;
  channel: string;
  accountId: string;
  externalConversationRef: string;
  sciForgeThreadRef: string;
  policyRef: string;
  createdAt: string;
  lastMessageAt?: string;
}

export interface DeliveryEnvelope {
  schemaVersion: typeof CHANNEL_DELIVERY_SCHEMA_VERSION;
  channel: string;
  accountId: string;
  targetConversationRef: string;
  inReplyToRef?: string;
  contentRef?: string;
  text?: string;
  attachmentRefs?: string[];
  idempotencyKey: string;
  auditRef: string;
  policyRef: string;
}

export interface ChannelMessageSourceMetadata {
  channel: string;
  accountId: string;
  sender: {
    ref: string;
    displayName?: string;
  };
  conversationRef: string;
  externalMessageRef: string;
  attachmentRefs: string[];
  auditRef: string;
  rawEventRef: string;
  receivedAt: string;
  bindingRef?: string;
  sciForgeThreadRef?: string;
  externalThreadRef?: string;
  deliveryStatus?: ChannelDeliveryStatus;
  threadBindingStatus?: ChannelBindingStatus;
}

export interface ChannelThreadAppendInput {
  envelope: ChannelMessageEnvelope;
  binding: ChannelSessionBinding;
  message: SciForgeMessage;
  ledgerEvents: ChannelLedgerEvent[];
}

export interface ChannelThreadAppendResult {
  threadRef: string;
  messageId: string;
  eventRefs?: string[];
}

export interface ChannelStoredRef {
  ref: string;
  kind: 'raw-event' | 'audit' | 'artifact' | 'attachment' | 'message' | string;
  redacted?: boolean;
}

export interface ChannelAuditRecord {
  auditRef: string;
  status: 'recorded' | 'failed';
  redacted?: boolean;
}

export interface ChannelIdempotencyClaim {
  status: 'claimed' | 'duplicate' | 'rejected';
  idempotencyKey: string;
  existingRef?: string;
  auditRef?: string;
  reason?: string;
}

export interface ChannelApprovalDecision {
  status: 'approved' | 'rejected' | 'needs-human' | 'not-required';
  approvalRef: string;
  auditRef?: string;
  reason?: string;
}

export interface ChannelPolicyDecision {
  policyRef: string;
  allow: boolean;
  requireApproval: boolean;
  reasons: string[];
}

export interface ChannelHostPorts {
  clock?: () => Date | string;
  resolveSessionBinding(envelope: ChannelMessageEnvelope): Promise<ChannelSessionBinding>;
  appendThreadUserMessage(input: ChannelThreadAppendInput): Promise<ChannelThreadAppendResult>;
  refStore?: {
    put(input: { ref: string; kind: string; value: unknown; redact?: boolean }): Promise<ChannelStoredRef>;
  };
  audit?: {
    record(input: { action: string; channel: string; refs: string[]; redacted?: boolean; data?: unknown }): Promise<ChannelAuditRecord>;
  };
  idempotency?: {
    claim(input: { key: string; scope: string; auditRef: string }): Promise<ChannelIdempotencyClaim>;
  };
  approval?: {
    authorizeDelivery(envelope: DeliveryEnvelope, context: { sideEffect: ChannelSideEffect; reason: string }): Promise<ChannelApprovalDecision>;
  };
  policy?: {
    lookup(policyRef: string, input: { channel: string; accountId: string; sideEffect: ChannelSideEffect }): Promise<ChannelPolicyDecision>;
  };
  secrets?: {
    get(name: string): Promise<string | undefined>;
  };
}

export interface ChannelIntakeLease {
  leaseRef: string;
  channel: string;
  startedAt: string;
  stop(): Promise<void>;
}

export interface ChannelResourceQuery {
  channel: string;
  accountId: string;
  kind: 'message' | 'document' | 'attachment' | string;
  query: string;
  conversationRef?: string;
  limit?: number;
  cursor?: string;
  policyRef: string;
}

export interface ChannelResourceRead {
  channel: string;
  accountId: string;
  ref: string;
  policyRef: string;
  range?: {
    start?: number;
    end?: number;
  };
}

export interface ChannelResourceItem {
  ref: string;
  kind: 'message' | 'document' | 'attachment' | 'artifact' | string;
  title?: string;
  snippet?: string;
  artifactRef?: string;
  attachmentRefs?: string[];
  auditRef: string;
  rawRef?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelResourceResult {
  schemaVersion: typeof CHANNEL_RESOURCE_RESULT_SCHEMA_VERSION;
  channel: string;
  accountId: string;
  items: ChannelResourceItem[];
  refs: string[];
  auditRefs: string[];
  nextCursor?: string;
}

export interface DeliveryDraftResult {
  status: 'drafted' | 'blocked' | 'failed';
  draftRef?: string;
  dryRun: true;
  requiresApproval: boolean;
  auditRefs: string[];
  refs: string[];
  reason?: string;
}

export interface DeliveryResult {
  status: ChannelDeliveryStatus;
  deliveryRef?: string;
  approvalRef?: string;
  auditRefs: string[];
  refs: string[];
  reason?: string;
}

export interface ChannelApprovalResult {
  status: 'approved' | 'rejected' | 'unknown';
  approvalRef?: string;
  messageRef: string;
  auditRef: string;
  reason?: string;
}

export interface ChannelPlugin {
  describe(): ChannelPluginManifest;
  startIntake?(ports: ChannelHostPorts): Promise<ChannelIntakeLease>;
  queryResource?(request: ChannelResourceQuery): Promise<ChannelResourceResult>;
  readResource?(request: ChannelResourceRead): Promise<ChannelResourceResult>;
  draftDelivery?(request: DeliveryEnvelope): Promise<DeliveryDraftResult>;
  sendDelivery?(request: DeliveryEnvelope): Promise<DeliveryResult>;
  handleConfirmation?(event: ChannelMessageEnvelope): Promise<ChannelApprovalResult | null>;
}

export interface ChannelMessageReceivedLedgerEvent {
  schemaVersion: typeof CHANNEL_LEDGER_EVENT_SCHEMA_VERSION;
  type: 'channel.message.received';
  channel: string;
  accountId: string;
  messageId: string;
  conversationRef: string;
  externalMessageRef: string;
  senderRef: string;
  attachmentRefs: string[];
  auditRef: string;
  rawEventRef: string;
  dedupeKey: string;
  receivedAt: string;
}

export interface AgentThreadMessageCreatedLedgerEvent {
  schemaVersion: typeof CHANNEL_LEDGER_EVENT_SCHEMA_VERSION;
  type: 'agent.thread.message.created';
  role: 'user';
  threadRef: string;
  messageId: string;
  source: { channel: string };
  sender: ChannelMessageSourceMetadata['sender'];
  conversationRef: string;
  attachmentRefs: string[];
  auditRef: string;
  createdAt: string;
}

export interface ChannelDeliveryLedgerEvent {
  schemaVersion: typeof CHANNEL_LEDGER_EVENT_SCHEMA_VERSION;
  type: 'channel.delivery.queued' | 'channel.delivery.sent' | 'channel.delivery.failed';
  channel: string;
  accountId: string;
  targetConversationRef: string;
  idempotencyKey: string;
  auditRef: string;
  deliveryRef?: string;
  reason?: string;
  createdAt: string;
}

export type ChannelLedgerEvent =
  | ChannelMessageReceivedLedgerEvent
  | AgentThreadMessageCreatedLedgerEvent
  | ChannelDeliveryLedgerEvent;

export function channelMessageEnvelopeToUserMessage(
  envelope: ChannelMessageEnvelope,
  binding: ChannelSessionBinding,
  options: { messageId?: string; createdAt?: string; threadBindingStatus?: ChannelBindingStatus } = {},
): SciForgeMessage {
  const attachmentRefs = envelope.attachmentRefs ?? [];
  const createdAt = options.createdAt ?? envelope.receivedAt;
  const provenance = channelMessageProvenance(envelope, binding, options.threadBindingStatus ?? 'bound');
  return {
    id: options.messageId ?? `channel-user-${stableRefSlug(envelope.dedupeKey || envelope.messageId)}`,
    role: 'user',
    content: envelope.text,
    createdAt,
    references: channelReferencesForEnvelope(envelope, binding),
    provenance,
    objectReferences: attachmentRefs.map((ref, index) => ({
      id: `channel-attachment-${stableRefSlug(ref)}-${index}`,
      kind: 'file',
      ref,
      title: `Channel attachment ${index + 1}`,
      status: 'external',
      presentationRole: 'supporting-evidence',
      provenance: { dataRef: ref, producer: `channel:${envelope.channel}` },
    })),
  };
}

export function channelMessageProvenance(
  envelope: ChannelMessageEnvelope,
  binding: ChannelSessionBinding,
  threadBindingStatus: ChannelBindingStatus = 'bound',
): SciForgeMessageProvenance {
  const source: ChannelMessageSourceMetadata = {
    channel: envelope.channel,
    accountId: envelope.accountId,
    sender: {
      ref: envelope.senderRef,
      displayName: envelope.senderDisplayName,
    },
    conversationRef: envelope.conversationRef,
    externalMessageRef: envelope.externalMessageRef,
    attachmentRefs: envelope.attachmentRefs ?? [],
    auditRef: envelope.auditRef,
    rawEventRef: envelope.rawEventRef,
    receivedAt: envelope.receivedAt,
    bindingRef: binding.bindingRef,
    sciForgeThreadRef: binding.sciForgeThreadRef,
    externalThreadRef: envelope.replyTarget?.externalThreadRef,
    threadBindingStatus,
  };
  return {
    kind: 'channel-message',
    source: { channel: envelope.channel },
    channel: source,
    runtimeRequestEligible: true,
    liveAcceptanceEligible: true,
  };
}

export function channelMessageReceivedLedgerEvent(envelope: ChannelMessageEnvelope): ChannelMessageReceivedLedgerEvent {
  return {
    schemaVersion: CHANNEL_LEDGER_EVENT_SCHEMA_VERSION,
    type: 'channel.message.received',
    channel: envelope.channel,
    accountId: envelope.accountId,
    messageId: envelope.messageId,
    conversationRef: envelope.conversationRef,
    externalMessageRef: envelope.externalMessageRef,
    senderRef: envelope.senderRef,
    attachmentRefs: envelope.attachmentRefs ?? [],
    auditRef: envelope.auditRef,
    rawEventRef: envelope.rawEventRef,
    dedupeKey: envelope.dedupeKey,
    receivedAt: envelope.receivedAt,
  };
}

export function agentThreadMessageCreatedLedgerEvent(
  envelope: ChannelMessageEnvelope,
  binding: ChannelSessionBinding,
  message: SciForgeMessage,
): AgentThreadMessageCreatedLedgerEvent {
  return {
    schemaVersion: CHANNEL_LEDGER_EVENT_SCHEMA_VERSION,
    type: 'agent.thread.message.created',
    role: 'user',
    threadRef: binding.sciForgeThreadRef,
    messageId: message.id,
    source: { channel: envelope.channel },
    sender: {
      ref: envelope.senderRef,
      displayName: envelope.senderDisplayName,
    },
    conversationRef: envelope.conversationRef,
    attachmentRefs: envelope.attachmentRefs ?? [],
    auditRef: envelope.auditRef,
    createdAt: message.createdAt,
  };
}

export function channelDeliveryLedgerEvent(
  envelope: DeliveryEnvelope,
  type: ChannelDeliveryLedgerEvent['type'],
  input: { deliveryRef?: string; reason?: string; createdAt?: string } = {},
): ChannelDeliveryLedgerEvent {
  return {
    schemaVersion: CHANNEL_LEDGER_EVENT_SCHEMA_VERSION,
    type,
    channel: envelope.channel,
    accountId: envelope.accountId,
    targetConversationRef: envelope.targetConversationRef,
    idempotencyKey: envelope.idempotencyKey,
    auditRef: envelope.auditRef,
    deliveryRef: input.deliveryRef,
    reason: input.reason,
    createdAt: input.createdAt ?? new Date(0).toISOString(),
  };
}

export function channelMessageMetadataFromProvenance(provenance: unknown): ChannelMessageSourceMetadata | undefined {
  const record = isRecord(provenance) ? provenance : undefined;
  const channel = isRecord(record?.channel) ? record.channel : undefined;
  if (channel) {
    const channelName = stringField(channel.channel);
    const accountId = stringField(channel.accountId);
    const sender = isRecord(channel.sender) ? channel.sender : undefined;
    const senderRef = stringField(sender?.ref);
    const conversationRef = stringField(channel.conversationRef);
    const externalMessageRef = stringField(channel.externalMessageRef);
    const auditRef = stringField(channel.auditRef);
    const rawEventRef = stringField(channel.rawEventRef);
    const receivedAt = stringField(channel.receivedAt);
    if (channelName && accountId && senderRef && conversationRef && externalMessageRef && auditRef && rawEventRef && receivedAt) {
      return {
        channel: channelName,
        accountId,
        sender: {
          ref: senderRef,
          displayName: stringField(sender?.displayName),
        },
        conversationRef,
        externalMessageRef,
        attachmentRefs: stringArray(channel.attachmentRefs),
        auditRef,
        rawEventRef,
        receivedAt,
        bindingRef: stringField(channel.bindingRef),
        sciForgeThreadRef: stringField(channel.sciForgeThreadRef),
        externalThreadRef: stringField(channel.externalThreadRef),
        deliveryStatus: channelDeliveryStatus(channel.deliveryStatus),
        threadBindingStatus: channelBindingStatus(channel.threadBindingStatus),
      };
    }
  }

  const source = isRecord(record?.source) ? record.source : undefined;
  const sourceChannel = stringField(source?.channel);
  if (!sourceChannel) return undefined;
  return {
    channel: sourceChannel,
    accountId: stringField(source?.accountId) ?? 'unknown',
    sender: { ref: stringField(source?.senderRef) ?? 'unknown' },
    conversationRef: stringField(source?.conversationRef) ?? `channel:${sourceChannel}:conversation:unknown`,
    externalMessageRef: stringField(source?.externalMessageRef) ?? `channel:${sourceChannel}:message:unknown`,
    attachmentRefs: stringArray(source?.attachmentRefs),
    auditRef: stringField(source?.auditRef) ?? `audit:${sourceChannel}:unknown`,
    rawEventRef: stringField(source?.rawEventRef) ?? `audit:${sourceChannel}:raw:unknown`,
    receivedAt: stringField(source?.receivedAt) ?? new Date(0).toISOString(),
  };
}

export function isChannelSourcedMessage(message: Pick<SciForgeMessage, 'provenance'>): boolean {
  return Boolean(channelMessageMetadataFromProvenance(message.provenance));
}

export function channelReferencesForEnvelope(envelope: ChannelMessageEnvelope, binding?: ChannelSessionBinding): SciForgeReference[] {
  const refs: SciForgeReference[] = [
    channelReference('message', envelope.externalMessageRef, `${channelTitle(envelope.channel)} message`, envelope.text.slice(0, 160)),
    channelReference('message', envelope.conversationRef, `${channelTitle(envelope.channel)} conversation`, binding?.sciForgeThreadRef),
    channelReference('message', envelope.auditRef, `${channelTitle(envelope.channel)} audit`, 'Redacted intake audit reference.'),
    channelReference('message', envelope.rawEventRef, `${channelTitle(envelope.channel)} raw event`, 'Raw payload is stored behind this ref and is not rendered inline.'),
  ];
  for (const [index, ref] of (envelope.attachmentRefs ?? []).entries()) {
    refs.push(channelReference('file', ref, `${channelTitle(envelope.channel)} attachment ${index + 1}`, 'External channel attachment reference.'));
  }
  return refs;
}

export function channelTitle(channel: string): string {
  if (channel.toLowerCase() === 'feishu') return 'Feishu';
  return channel.slice(0, 1).toUpperCase() + channel.slice(1);
}

function channelReference(kind: SciForgeReference['kind'], ref: string, title: string, summary?: string): SciForgeReference {
  return {
    id: `ref-${stableRefSlug(ref)}`,
    kind,
    title,
    ref,
    summary,
  };
}

function stableRefSlug(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.slice(0, 96) || 'unknown';
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(stringField).filter((entry): entry is string => Boolean(entry));
}

function channelDeliveryStatus(value: unknown): ChannelDeliveryStatus | undefined {
  return value === 'drafted' || value === 'queued' || value === 'sent' || value === 'failed' || value === 'blocked' || value === 'duplicate'
    ? value
    : undefined;
}

function channelBindingStatus(value: unknown): ChannelBindingStatus | undefined {
  return value === 'bound' || value === 'created' || value === 'unbound' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
