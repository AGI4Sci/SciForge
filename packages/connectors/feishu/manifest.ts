import type { ChannelPluginManifest } from '../../contracts/runtime/channel-plugin';

export const FEISHU_CHANNEL_PLUGIN_ID = 'sciforge.channel.feishu' as const;
export const FEISHU_CHANNEL_KIND = 'feishu' as const;

export const feishuChannelPluginManifest: ChannelPluginManifest = {
  pluginId: FEISHU_CHANNEL_PLUGIN_ID,
  channelKind: FEISHU_CHANNEL_KIND,
  title: 'Feishu Channel',
  version: '0.1.0',
  transports: ['webhook', 'cli-event-stream', 'manual-import'],
  capabilities: {
    intake: true,
    resource: true,
    delivery: true,
    confirmation: true,
    streamingDelivery: false,
    media: true,
    reactions: false,
  },
  refPrefixes: ['feishu:', 'artifact:', 'audit:'],
  permissionScopes: [
    'im:message:read',
    'im:message:send',
    'im:chat:read',
    'docs:doc:read',
    'drive:file:read',
    'drive:file:upload',
  ],
  sideEffects: ['read', 'send', 'upload'],
};
