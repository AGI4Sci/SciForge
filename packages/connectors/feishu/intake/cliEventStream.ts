import {
  agentThreadMessageCreatedLedgerEvent,
  channelMessageEnvelopeToUserMessage,
  channelMessageReceivedLedgerEvent,
  type ChannelHostPorts,
  type ChannelThreadAppendResult,
} from '../../../contracts/runtime/channel-plugin';
import type { LarkCliProvider } from '../larkCliProvider';
import { normalizeFeishuCliEvent, type FeishuNormalizeOptions } from './normalizeMessage';

export interface FeishuIntakeResult {
  envelopeRef: string;
  appendResult: ChannelThreadAppendResult;
}

export async function ingestFeishuCliEventStream(
  provider: LarkCliProvider,
  ports: ChannelHostPorts,
  options: FeishuNormalizeOptions & { args?: string[] },
): Promise<FeishuIntakeResult[]> {
  const result = await provider.readCliEventStream(options.args);
  return ingestFeishuCliEventRecords(result.records, ports, {
    ...options,
    auditRef: result.auditRef,
  });
}

export async function ingestFeishuCliEventRecords(
  records: unknown[],
  ports: ChannelHostPorts,
  options: FeishuNormalizeOptions,
): Promise<FeishuIntakeResult[]> {
  const appended: FeishuIntakeResult[] = [];
  for (const record of records) {
    const envelope = normalizeFeishuCliEvent(record, options);
    const claim = await ports.idempotency?.claim({ key: envelope.dedupeKey, scope: 'channel.intake.feishu', auditRef: envelope.auditRef });
    if (claim?.status === 'duplicate') continue;
    const binding = await ports.resolveSessionBinding(envelope);
    const message = channelMessageEnvelopeToUserMessage(envelope, binding, {
      threadBindingStatus: binding.lastMessageAt ? 'bound' : 'created',
    });
    const ledgerEvents = [
      channelMessageReceivedLedgerEvent(envelope),
      agentThreadMessageCreatedLedgerEvent(envelope, binding, message),
    ];
    const appendResult = await ports.appendThreadUserMessage({ envelope, binding, message, ledgerEvents });
    appended.push({ envelopeRef: envelope.externalMessageRef, appendResult });
  }
  return appended;
}
