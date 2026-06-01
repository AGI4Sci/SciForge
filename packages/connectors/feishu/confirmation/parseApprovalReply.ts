import type { ChannelApprovalResult, ChannelMessageEnvelope } from '../../../contracts/runtime/channel-plugin';

export function parseFeishuApprovalReply(event: ChannelMessageEnvelope): ChannelApprovalResult | null {
  const text = event.text.trim().toLowerCase();
  const approved = /^(approve|approved|confirm|confirmed|yes|y|ok|同意|确认|可以|发送)$/i.test(text);
  const rejected = /^(reject|rejected|cancel|cancelled|no|n|stop|拒绝|取消|不要发送)$/i.test(text);
  if (!approved && !rejected) return null;
  return {
    status: approved ? 'approved' : 'rejected',
    approvalRef: `audit:feishu:approval:${event.messageId}`,
    messageRef: event.externalMessageRef,
    auditRef: event.auditRef,
    reason: approved ? 'Approval reply parsed from Feishu message.' : 'Rejection reply parsed from Feishu message.',
  };
}
