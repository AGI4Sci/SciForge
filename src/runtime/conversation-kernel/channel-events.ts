import {
  channelMessageEnvelopeToUserMessage,
  type ChannelMessageEnvelope,
  type ChannelSessionBinding,
  type DeliveryEnvelope,
} from '@sciforge-ui/runtime-contract';
import type { ConversationEvent, ConversationRef } from './types';

export function channelMessageReceivedConversationEvent(
  envelope: ChannelMessageEnvelope,
  binding: ChannelSessionBinding,
): ConversationEvent {
  const refs = channelConversationRefs(envelope);
  return {
    id: `channel-message-received:${stableEventSlug(envelope.dedupeKey || envelope.messageId)}`,
    type: 'ChannelMessageReceived',
    timestamp: envelope.receivedAt,
    actor: 'kernel',
    turnId: envelope.messageId,
    storage: 'ref',
    payload: {
      refs,
      summary: `${envelope.channel} message received from ${envelope.senderDisplayName ?? envelope.senderRef}`,
      source: { channel: envelope.channel },
      sender: {
        ref: envelope.senderRef,
        displayName: envelope.senderDisplayName,
      },
      conversationRef: envelope.conversationRef,
      externalMessageRef: envelope.externalMessageRef,
      attachmentRefs: envelope.attachmentRefs ?? [],
      auditRef: envelope.auditRef,
      rawEventRef: envelope.rawEventRef,
      bindingRef: binding.bindingRef,
      sciForgeThreadRef: binding.sciForgeThreadRef,
    },
  };
}

export function channelEnvelopeTurnReceivedEvent(
  envelope: ChannelMessageEnvelope,
  binding: ChannelSessionBinding,
): ConversationEvent {
  const message = channelMessageEnvelopeToUserMessage(envelope, binding);
  return {
    id: `turn-received:${stableEventSlug(envelope.dedupeKey || envelope.messageId)}`,
    type: 'TurnReceived',
    timestamp: envelope.receivedAt,
    actor: 'user',
    turnId: envelope.messageId,
    causationId: `channel-message-received:${stableEventSlug(envelope.dedupeKey || envelope.messageId)}`,
    storage: 'inline',
    payload: {
      prompt: envelope.text,
      summary: envelope.text.slice(0, 240),
      messageId: message.id,
      source: { channel: envelope.channel },
      sender: {
        ref: envelope.senderRef,
        displayName: envelope.senderDisplayName,
      },
      conversationRef: envelope.conversationRef,
      externalMessageRef: envelope.externalMessageRef,
      attachmentRefs: envelope.attachmentRefs ?? [],
      auditRef: envelope.auditRef,
      rawEventRef: envelope.rawEventRef,
      bindingRef: binding.bindingRef,
      sciForgeThreadRef: binding.sciForgeThreadRef,
      role: 'user',
    },
  };
}

export function channelEnvelopeConversationEvents(
  envelope: ChannelMessageEnvelope,
  binding: ChannelSessionBinding,
): ConversationEvent[] {
  return [
    channelMessageReceivedConversationEvent(envelope, binding),
    channelEnvelopeTurnReceivedEvent(envelope, binding),
  ];
}

export function channelDeliveryConversationEvent(
  envelope: DeliveryEnvelope,
  status: 'queued' | 'sent' | 'failed',
  input: { timestamp: string; deliveryRef?: string; reason?: string },
): ConversationEvent {
  const type = status === 'queued'
    ? 'ChannelDeliveryQueued'
    : status === 'sent'
      ? 'ChannelDeliverySent'
      : 'ChannelDeliveryFailed';
  const refs: ConversationRef[] = [
    { ref: envelope.auditRef, label: 'delivery audit' },
    { ref: envelope.targetConversationRef, label: 'target conversation' },
    ...(envelope.inReplyToRef ? [{ ref: envelope.inReplyToRef, label: 'reply target' }] : []),
    ...(envelope.contentRef ? [{ ref: envelope.contentRef, label: 'content' }] : []),
    ...((envelope.attachmentRefs ?? []).map((ref, index) => ({ ref, label: `attachment ${index + 1}` }))),
    ...(input.deliveryRef ? [{ ref: input.deliveryRef, label: 'delivery' }] : []),
  ];
  return {
    id: `channel-delivery-${status}:${stableEventSlug(envelope.idempotencyKey)}`,
    type,
    timestamp: input.timestamp,
    actor: 'kernel',
    storage: 'ref',
    payload: {
      refs,
      summary: `${envelope.channel} delivery ${status}`,
      source: { channel: envelope.channel },
      targetConversationRef: envelope.targetConversationRef,
      idempotencyKey: envelope.idempotencyKey,
      auditRef: envelope.auditRef,
      deliveryRef: input.deliveryRef,
      reason: input.reason,
    },
  };
}

function channelConversationRefs(envelope: ChannelMessageEnvelope): ConversationRef[] {
  return [
    { ref: envelope.conversationRef, label: 'conversation' },
    { ref: envelope.externalMessageRef, label: 'message' },
    { ref: envelope.auditRef, label: 'intake audit' },
    { ref: envelope.rawEventRef, label: 'raw event' },
    ...((envelope.attachmentRefs ?? []).map((ref, index) => ({ ref, label: `attachment ${index + 1}` }))),
  ];
}

function stableEventSlug(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.slice(0, 96) || 'unknown';
}
