import type { ChannelResourceQuery, ChannelResourceRead, ChannelResourceResult } from '../../../contracts/runtime/channel-plugin';
import type { LarkCliProvider } from '../larkCliProvider';
import { readFeishuDoc, queryFeishuDocs } from './docs';
import { readFeishuAttachment } from './drive';
import { queryFeishuMessages, readFeishuMessage } from './im';

export async function queryFeishuResource(provider: LarkCliProvider, request: ChannelResourceQuery): Promise<ChannelResourceResult> {
  if (request.kind === 'document' || request.kind === 'doc') return queryFeishuDocs(provider, request);
  return queryFeishuMessages(provider, request);
}

export async function readFeishuResource(provider: LarkCliProvider, request: ChannelResourceRead): Promise<ChannelResourceResult> {
  if (/^feishu:doc:/i.test(request.ref)) return readFeishuDoc(provider, request);
  if (/^feishu:file:/i.test(request.ref)) return readFeishuAttachment(provider, request);
  return readFeishuMessage(provider, request);
}
