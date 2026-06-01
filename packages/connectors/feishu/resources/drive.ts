import type { ChannelResourceRead, ChannelResourceResult } from '../../../contracts/runtime/channel-plugin';
import type { LarkCliProvider } from '../larkCliProvider';
import { artifactRefForFeishu, feishuResourceRef, firstString, resourceResult } from './resourceMapping';

export async function readFeishuAttachment(provider: LarkCliProvider, request: ChannelResourceRead): Promise<ChannelResourceResult> {
  const result = await provider.runJson(['drive', 'files', 'get', '--file-ref', request.ref], {
    operation: 'resource.read.attachment',
    sideEffect: 'read',
  });
  const ref = request.ref.startsWith('feishu:') ? request.ref : feishuResourceRef('file', {}, request.ref);
  return resourceResult({
    accountId: request.accountId,
    auditRefs: [result.auditRef],
    items: [{
      ref,
      kind: 'attachment',
      title: firstString((result.json as Record<string, unknown>).name, (result.json as Record<string, unknown>).title) ?? 'Feishu attachment',
      artifactRef: artifactRefForFeishu('file', ref),
      auditRef: result.auditRef,
      rawRef: `${result.auditRef}:result`,
      metadata: { provider: 'lark-cli' },
    }],
  });
}
