import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHANNEL_DELIVERY_SCHEMA_VERSION,
  CHANNEL_MESSAGE_SCHEMA_VERSION,
  agentThreadMessageCreatedLedgerEvent,
  channelMessageEnvelopeToUserMessage,
  channelMessageMetadataFromProvenance,
  channelMessageReceivedLedgerEvent,
  type ChannelMessageEnvelope,
  type ChannelSessionBinding,
  type DeliveryEnvelope,
} from './channel-plugin';

const envelope: ChannelMessageEnvelope = {
  schemaVersion: CHANNEL_MESSAGE_SCHEMA_VERSION,
  messageId: 'msg-feishu-1',
  channel: 'feishu',
  accountId: 'tenant-a',
  conversationRef: 'feishu:chat:oc_123',
  externalMessageRef: 'feishu:message:om_456',
  senderRef: 'feishu:user:ou_789',
  senderDisplayName: 'Lin',
  text: '请总结这个附件',
  mentions: ['feishu:user:bot'],
  attachmentRefs: ['feishu:file:file_1'],
  rawEventRef: 'audit:feishu:raw:msg-feishu-1',
  auditRef: 'audit:feishu:intake:msg-feishu-1',
  dedupeKey: 'feishu:tenant-a:om_456',
  receivedAt: '2026-06-01T00:00:00.000Z',
  replyTarget: { externalThreadRef: 'feishu:thread:thread_1', externalMessageRef: 'feishu:message:om_456' },
  authScope: { tenant: 'tenant-a', bot: 'bot-a', policyRef: 'policy:feishu-default' },
};

const binding: ChannelSessionBinding = {
  bindingRef: 'channel-binding:feishu:oc_123',
  channel: 'feishu',
  accountId: 'tenant-a',
  externalConversationRef: 'feishu:chat:oc_123',
  sciForgeThreadRef: 'thread:sciforge-1',
  policyRef: 'policy:feishu-default',
  createdAt: '2026-06-01T00:00:00.000Z',
};

test('channel message envelope projects to ordinary user message with source.channel metadata and refs', () => {
  const message = channelMessageEnvelopeToUserMessage(envelope, binding);

  assert.equal(message.role, 'user');
  assert.equal(message.content, '请总结这个附件');
  assert.equal(message.provenance?.kind, 'channel-message');
  assert.deepEqual(message.provenance?.source, { channel: 'feishu' });
  assert.ok(message.references?.some((ref) => ref.ref === 'feishu:message:om_456'));
  assert.ok(message.references?.some((ref) => ref.ref === 'audit:feishu:intake:msg-feishu-1'));
  assert.ok(message.objectReferences?.some((ref) => ref.ref === 'feishu:file:file_1' && ref.status === 'external'));

  const source = channelMessageMetadataFromProvenance(message.provenance);
  assert.equal(source?.channel, 'feishu');
  assert.equal(source?.sender.displayName, 'Lin');
  assert.equal(source?.conversationRef, 'feishu:chat:oc_123');
  assert.deepEqual(source?.attachmentRefs, ['feishu:file:file_1']);
  assert.equal(source?.auditRef, 'audit:feishu:intake:msg-feishu-1');
});

test('channel ledger events keep intake and thread message creation separate', () => {
  const message = channelMessageEnvelopeToUserMessage(envelope, binding);
  const intakeEvent = channelMessageReceivedLedgerEvent(envelope);
  const threadEvent = agentThreadMessageCreatedLedgerEvent(envelope, binding, message);

  assert.equal(intakeEvent.type, 'channel.message.received');
  assert.equal(intakeEvent.rawEventRef, 'audit:feishu:raw:msg-feishu-1');
  assert.equal(threadEvent.type, 'agent.thread.message.created');
  assert.equal(threadEvent.role, 'user');
  assert.deepEqual(threadEvent.source, { channel: 'feishu' });
  assert.equal(threadEvent.threadRef, 'thread:sciforge-1');
});

test('delivery envelope schema is stable for host approval and idempotency', () => {
  const delivery: DeliveryEnvelope = {
    schemaVersion: CHANNEL_DELIVERY_SCHEMA_VERSION,
    channel: 'feishu',
    accountId: 'tenant-a',
    targetConversationRef: 'feishu:chat:oc_123',
    inReplyToRef: 'feishu:message:om_456',
    text: 'Draft reply',
    idempotencyKey: 'delivery:feishu:om_456:reply-1',
    auditRef: 'audit:feishu:delivery:reply-1',
    policyRef: 'policy:feishu-default',
  };

  assert.equal(delivery.schemaVersion, 'sciforge.channel-delivery.v1');
  assert.match(delivery.idempotencyKey, /^delivery:feishu:/);
});
