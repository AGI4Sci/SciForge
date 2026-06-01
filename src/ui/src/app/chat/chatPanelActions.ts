import type { SciForgeMessage } from '../../domain';
import type { SupportedLocale } from '../../i18n';
import { chatText } from './chatI18n';

export type ChatPanelActionId =
  | 'split-right'
  | 'split-down'
  | 'fork-chat'
  | 'copy-messages'
  | 'copy-request-id'
  | 'archive-chat';

export type ChatPanelActionEffect = 'presentation' | 'thread-lifecycle' | 'clipboard';

export interface ChatPanelAction {
  id: ChatPanelActionId;
  label: string;
  shortcut?: string;
  effect: ChatPanelActionEffect;
  commandText: string;
  auditBoundary: string;
  disabled?: boolean;
  disabledReason?: string;
  destructive?: boolean;
}

export function buildChatPanelActions(input: {
  locale?: SupportedLocale;
  canFork: boolean;
  canArchive: boolean;
  canCopyMessages: boolean;
  canCopyRequestId: boolean;
  isSending: boolean;
}): ChatPanelAction[] {
  const disabledWhileRunning = input.isSending
    ? chatText(input.locale, {
      'zh-CN': '当前任务运行中，等本轮结束后再执行此聊天动作。',
      'en-US': 'This chat action is available after the current run finishes.',
    })
    : undefined;
  return [
    {
      id: 'split-right',
      label: chatText(input.locale, { 'zh-CN': '右侧拆分', 'en-US': 'Split Right' }),
      shortcut: '⌘D',
      effect: 'presentation',
      commandText: '/chat split --direction right --presentation-only',
      auditBoundary: 'presentation-only split; no backend route, workspace write, or executor action',
    },
    {
      id: 'split-down',
      label: chatText(input.locale, { 'zh-CN': '下方拆分', 'en-US': 'Split Down' }),
      shortcut: '⇧⌘D',
      effect: 'presentation',
      commandText: '/chat split --direction down --presentation-only',
      auditBoundary: 'presentation-only split; no backend route, workspace write, or executor action',
    },
    {
      id: 'fork-chat',
      label: chatText(input.locale, { 'zh-CN': '派生聊天', 'en-US': 'Fork Chat' }),
      effect: 'thread-lifecycle',
      commandText: '/chat fork --from-current-thread',
      auditBoundary: 'declared thread lifecycle intent; copies visible session state without raw provider payload',
      disabled: !input.canFork || Boolean(disabledWhileRunning),
      disabledReason: disabledWhileRunning ?? (!input.canFork
        ? chatText(input.locale, { 'zh-CN': '当前聊天还没有可派生内容。', 'en-US': 'There is no chat content to fork yet.' })
        : undefined),
    },
    {
      id: 'copy-messages',
      label: chatText(input.locale, { 'zh-CN': '复制消息', 'en-US': 'Copy Messages' }),
      effect: 'clipboard',
      commandText: '/chat copy --messages --semantic-transcript',
      auditBoundary: 'clipboard copy of visible semantic messages only; backend payloads and secrets are excluded',
      disabled: !input.canCopyMessages,
      disabledReason: !input.canCopyMessages
        ? chatText(input.locale, { 'zh-CN': '当前聊天没有可复制消息。', 'en-US': 'There are no messages to copy yet.' })
        : undefined,
    },
    {
      id: 'copy-request-id',
      label: chatText(input.locale, { 'zh-CN': '复制请求 ID', 'en-US': 'Copy Request ID' }),
      effect: 'clipboard',
      commandText: '/chat copy --request-id --public-id-only',
      auditBoundary: 'clipboard copy of the public run/session id only; raw backend request ids are never exposed',
      disabled: !input.canCopyRequestId,
      disabledReason: !input.canCopyRequestId
        ? chatText(input.locale, { 'zh-CN': '当前聊天没有可复制请求 ID。', 'en-US': 'There is no request id to copy yet.' })
        : undefined,
    },
    {
      id: 'archive-chat',
      label: chatText(input.locale, { 'zh-CN': '归档', 'en-US': 'Archive' }),
      shortcut: '⇧⌘E',
      effect: 'thread-lifecycle',
      commandText: '/chat archive --current-thread',
      auditBoundary: 'declared archive intent; moves the current thread into retained history',
      disabled: !input.canArchive || Boolean(disabledWhileRunning),
      disabledReason: disabledWhileRunning ?? (!input.canArchive
        ? chatText(input.locale, { 'zh-CN': '当前聊天还没有可归档内容。', 'en-US': 'There is no chat content to archive yet.' })
        : undefined),
      destructive: true,
    },
  ];
}

export function buildCopyMessagesText(messages: SciForgeMessage[], locale?: SupportedLocale) {
  const rows = messages
    .filter((message) => message.role === 'user' || message.role === 'scenario')
    .map((message) => {
      const role = message.role === 'user'
        ? chatText(locale, { 'zh-CN': '用户', 'en-US': 'User' })
        : chatText(locale, { 'zh-CN': '助手', 'en-US': 'Assistant' });
      const content = sanitizeCopiedChatText(message.content);
      return content ? `${role}: ${content}` : undefined;
    })
    .filter((value): value is string => Boolean(value));
  return rows.join('\n\n');
}

export function buildCopyRequestIdText(input: { activeRunId?: string; sessionId: string }) {
  const id = input.activeRunId?.trim() || input.sessionId.trim();
  const scope = input.activeRunId?.trim() ? 'run' : 'session';
  return `${scope}:${sanitizePublicIdentifier(id)}`;
}

function sanitizeCopiedChatText(value: string) {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\bAuthorization\b\s*[:=]\s*Bearer\s+[^\s"',;)}\]]+/gi, 'Authorization: Bearer [redacted]')
    .replace(/\b(api[-_\s]?key|authorization|bearer|token|password|secret)\b(\s*[:=]\s*)(["']?)[^\s"',;)}\]]+/gi, '$1$2$3[redacted]')
    .replace(/\b(providerUrl|baseUrl|endpoint|modelName|modelProvider)\b(\s*[:=]\s*)(["']?)[^\s"',;)}\]]+/gi, '$1$2$3[redacted]')
    .replace(/\/(?:Users|Applications|private|var|tmp)\/[^\s)`\]}]+/g, '[local path]')
    .replace(/[A-Za-z]:\\[^\s)`\]}]+/g, '[local path]')
    .replace(/\bconfig\.(?:local|computer-use\.local)\.json\b/gi, '[local config]')
    .trim();
}

function sanitizePublicIdentifier(value: string) {
  return value.replace(/[^\w:.-]/g, '').slice(0, 160) || 'unknown';
}
