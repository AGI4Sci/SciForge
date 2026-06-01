import type { ChannelResourceQuery, ChannelResourceRead, ChannelResourceResult } from '../../../contracts/runtime/channel-plugin';
import type { LarkCliProvider } from '../larkCliProvider';
import { artifactRefForFeishu, feishuResourceRef, firstString, recordsFromJson, resourceResult } from './resourceMapping';

export async function queryFeishuDocs(provider: LarkCliProvider, request: ChannelResourceQuery): Promise<ChannelResourceResult> {
  const result = await provider.runJson([
    'docs',
    'search',
    '--query',
    request.query,
    ...(request.limit ? ['--limit', String(request.limit)] : []),
    ...(request.cursor ? ['--cursor', request.cursor] : []),
  ], { operation: 'resource.query.docs', sideEffect: 'read' });
  const items = recordsFromJson(result.json).map((record, index) => {
    const ref = feishuResourceRef('doc', record, `doc-${index}`);
    return {
      ref,
      kind: 'document',
      title: firstString(record.title, record.name) ?? `Feishu document ${index + 1}`,
      snippet: firstString(record.snippet, record.summary),
      artifactRef: artifactRefForFeishu('doc', ref),
      auditRef: result.auditRef,
      rawRef: `${result.auditRef}:result:${index}`,
      metadata: { provider: 'lark-cli' },
    };
  });
  return resourceResult({ accountId: request.accountId, items, auditRefs: [result.auditRef], nextCursor: firstString((result.json as Record<string, unknown>).next_cursor) });
}

export async function readFeishuDoc(provider: LarkCliProvider, request: ChannelResourceRead): Promise<ChannelResourceResult> {
  const result = await provider.runJson(['docs', 'read', '--doc-ref', request.ref], {
    operation: 'resource.read.doc',
    sideEffect: 'read',
  });
  const ref = request.ref.startsWith('feishu:') ? request.ref : feishuResourceRef('doc', {}, request.ref);
  return resourceResult({
    accountId: request.accountId,
    auditRefs: [result.auditRef],
    items: [{
      ref,
      kind: 'document',
      title: firstString((result.json as Record<string, unknown>).title) ?? 'Feishu document',
      snippet: firstString((result.json as Record<string, unknown>).snippet, (result.json as Record<string, unknown>).text),
      artifactRef: artifactRefForFeishu('doc', ref),
      auditRef: result.auditRef,
      rawRef: `${result.auditRef}:result`,
      metadata: { provider: 'lark-cli' },
    }],
  });
}
