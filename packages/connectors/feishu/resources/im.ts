import type { ChannelResourceQuery, ChannelResourceRead, ChannelResourceResult } from '../../../contracts/runtime/channel-plugin';
import type { LarkCliProvider } from '../larkCliProvider';
import { artifactRefForFeishu, feishuResourceRef, firstString, recordsFromJson, resourceResult } from './resourceMapping';

export async function queryFeishuMessages(provider: LarkCliProvider, request: ChannelResourceQuery): Promise<ChannelResourceResult> {
  const args = [
    'im',
    'messages',
    'search',
    '--query',
    request.query,
    ...(request.conversationRef ? ['--chat-ref', request.conversationRef] : []),
    ...(request.limit ? ['--limit', String(request.limit)] : []),
    ...(request.cursor ? ['--cursor', request.cursor] : []),
  ];
  const result = await provider.runJson(args, { operation: 'resource.query.messages', sideEffect: 'read' });
  const items = recordsFromJson(result.json).map((record, index) => {
    const ref = feishuResourceRef('message', record, `message-${index}`);
    return {
      ref,
      kind: 'message',
      title: firstString(record.title, record.subject) ?? `Feishu message ${index + 1}`,
      snippet: firstString(record.text, record.snippet, record.content),
      artifactRef: artifactRefForFeishu('message', ref),
      auditRef: result.auditRef,
      rawRef: `${result.auditRef}:result:${index}`,
      metadata: { provider: 'lark-cli' },
    };
  });
  return resourceResult({ accountId: request.accountId, items, auditRefs: [result.auditRef], nextCursor: firstString((result.json as Record<string, unknown>).next_cursor) });
}

export async function readFeishuMessage(provider: LarkCliProvider, request: ChannelResourceRead): Promise<ChannelResourceResult> {
  const result = await provider.runJson(['im', 'messages', 'get', '--message-ref', request.ref], {
    operation: 'resource.read.message',
    sideEffect: 'read',
  });
  const ref = request.ref.startsWith('feishu:') ? request.ref : feishuResourceRef('message', {}, request.ref);
  return resourceResult({
    accountId: request.accountId,
    auditRefs: [result.auditRef],
    items: [{
      ref,
      kind: 'message',
      title: 'Feishu message',
      snippet: firstString((result.json as Record<string, unknown>).text, (result.json as Record<string, unknown>).content),
      artifactRef: artifactRefForFeishu('message', ref),
      auditRef: result.auditRef,
      rawRef: `${result.auditRef}:result`,
      metadata: { provider: 'lark-cli' },
    }],
  });
}
