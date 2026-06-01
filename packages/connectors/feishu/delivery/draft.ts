import type { DeliveryDraftResult, DeliveryEnvelope } from '../../../contracts/runtime/channel-plugin';
import type { LarkCliProvider } from '../larkCliProvider';

export async function draftFeishuDelivery(provider: LarkCliProvider, envelope: DeliveryEnvelope): Promise<DeliveryDraftResult> {
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
    '--dry-run',
  ], { operation: 'delivery.draft', sideEffect: 'none' });

  const draftRef = `artifact:feishu-delivery-draft-${envelope.idempotencyKey.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  return {
    status: 'drafted',
    draftRef,
    dryRun: true,
    requiresApproval: true,
    auditRefs: [envelope.auditRef, result.auditRef],
    refs: [draftRef, envelope.auditRef, result.auditRef],
  };
}
