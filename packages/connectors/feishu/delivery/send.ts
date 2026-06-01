import type { ChannelHostPorts, DeliveryEnvelope, DeliveryResult } from '../../../contracts/runtime/channel-plugin';
import type { LarkCliProvider } from '../larkCliProvider';

export async function sendFeishuDelivery(
  provider: LarkCliProvider,
  envelope: DeliveryEnvelope,
  ports: Pick<ChannelHostPorts, 'approval' | 'idempotency' | 'audit' | 'policy'>,
): Promise<DeliveryResult> {
  const policy = await ports.policy?.lookup(envelope.policyRef, {
    channel: envelope.channel,
    accountId: envelope.accountId,
    sideEffect: 'send',
  });
  if (policy && !policy.allow) {
    return {
      status: 'blocked',
      auditRefs: [envelope.auditRef],
      refs: [envelope.auditRef],
      reason: policy.reasons.join('; ') || 'Host policy blocked delivery.',
    };
  }

  const approval = await ports.approval?.authorizeDelivery(envelope, {
    sideEffect: 'send',
    reason: 'Feishu delivery side effect must be authorized by Agent Host.',
  });
  if (!approval || approval.status === 'needs-human' || approval.status === 'rejected') {
    return {
      status: 'blocked',
      approvalRef: approval?.approvalRef,
      auditRefs: [envelope.auditRef, approval?.auditRef].filter((ref): ref is string => Boolean(ref)),
      refs: [envelope.auditRef, approval?.approvalRef].filter((ref): ref is string => Boolean(ref)),
      reason: approval?.reason ?? 'Host approval is required before Feishu delivery.',
    };
  }

  const claim = await ports.idempotency?.claim({ key: envelope.idempotencyKey, scope: 'channel.delivery.feishu', auditRef: envelope.auditRef });
  if (claim?.status === 'duplicate') {
    return {
      status: 'duplicate',
      approvalRef: approval.approvalRef,
      auditRefs: [envelope.auditRef, approval.auditRef, claim.auditRef].filter((ref): ref is string => Boolean(ref)),
      refs: [claim.existingRef, approval.approvalRef].filter((ref): ref is string => Boolean(ref)),
      reason: claim.reason ?? 'Delivery idempotency key was already claimed.',
    };
  }

  const hostAudit = await ports.audit?.record({
    action: 'channel.delivery.feishu.send',
    channel: envelope.channel,
    refs: [envelope.targetConversationRef, envelope.inReplyToRef, envelope.contentRef, ...(envelope.attachmentRefs ?? [])].filter((ref): ref is string => Boolean(ref)),
    redacted: true,
    data: { idempotencyKey: envelope.idempotencyKey, approvalRef: approval.approvalRef },
  });

  const result = await provider.runJson([
    'im',
    'messages',
    'send',
    '--chat-ref',
    envelope.targetConversationRef,
    ...(envelope.inReplyToRef ? ['--reply-to', envelope.inReplyToRef] : []),
    ...(envelope.text ? ['--text', envelope.text] : []),
    ...(envelope.contentRef ? ['--content-ref', envelope.contentRef] : []),
    ...((envelope.attachmentRefs ?? []).flatMap((ref) => ['--attachment-ref', ref])),
    '--idempotency-key',
    envelope.idempotencyKey,
  ], { operation: 'delivery.send', sideEffect: 'send' });

  const deliveryRef = `feishu:delivery:${envelope.idempotencyKey.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  return {
    status: 'sent',
    deliveryRef,
    approvalRef: approval.approvalRef,
    auditRefs: [envelope.auditRef, approval.auditRef, hostAudit?.auditRef, result.auditRef].filter((ref): ref is string => Boolean(ref)),
    refs: [deliveryRef, envelope.targetConversationRef, envelope.auditRef, approval.approvalRef, result.auditRef],
  };
}
