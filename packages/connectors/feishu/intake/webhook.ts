import {
  agentThreadMessageCreatedLedgerEvent,
  channelMessageEnvelopeToUserMessage,
  channelMessageReceivedLedgerEvent,
  type ChannelHostPorts,
  type ChannelThreadAppendResult,
} from '../../../contracts/runtime/channel-plugin';
import { normalizeFeishuWebhookEvent, type FeishuNormalizeOptions } from './normalizeMessage';

export async function ingestFeishuWebhookEvent(
  event: unknown,
  ports: ChannelHostPorts,
  options: FeishuNormalizeOptions,
): Promise<ChannelThreadAppendResult | undefined> {
  const envelope = normalizeFeishuWebhookEvent(event, options);
  const claim = await ports.idempotency?.claim({ key: envelope.dedupeKey, scope: 'channel.intake.feishu', auditRef: envelope.auditRef });
  if (claim?.status === 'duplicate') return undefined;
  const binding = await ports.resolveSessionBinding(envelope);
  const message = channelMessageEnvelopeToUserMessage(envelope, binding, {
    threadBindingStatus: binding.lastMessageAt ? 'bound' : 'created',
  });
  return ports.appendThreadUserMessage({
    envelope,
    binding,
    message,
    ledgerEvents: [
      channelMessageReceivedLedgerEvent(envelope),
      agentThreadMessageCreatedLedgerEvent(envelope, binding, message),
    ],
  });
}
