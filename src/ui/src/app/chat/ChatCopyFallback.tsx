import { ClipboardCopy, X } from 'lucide-react';
import type { SupportedLocale } from '../../i18n';
import { chatText } from './chatI18n';

export type ChatCopyFallbackKind = 'message' | 'messages' | 'request-id';

export interface ChatCopyFallbackState {
  kind: ChatCopyFallbackKind;
  title: string;
  detail: string;
  text: string;
}

export function buildChatCopyFallback(input: {
  kind: ChatCopyFallbackKind;
  title: string;
  text: string;
  locale?: SupportedLocale;
  error?: unknown;
}): ChatCopyFallbackState {
  const fallbackDetail = chatText(input.locale, {
    'zh-CN': '剪贴板权限被阻止。可从下方只读文本框手动复制，内容仍只来自当前可见语义消息。',
    'en-US': 'Clipboard access was blocked. Copy manually from the read-only box below; the text still comes only from the current visible semantic messages.',
  });
  const detail = input.error instanceof Error && input.error.message.trim()
    ? `${fallbackDetail} ${input.error.message.trim()}`
    : fallbackDetail;
  return {
    kind: input.kind,
    title: input.title,
    detail,
    text: input.text,
  };
}

export function ChatCopyFallback({
  fallback,
  locale,
  onRetry,
  onDismiss,
}: {
  fallback: ChatCopyFallbackState;
  locale?: SupportedLocale;
  onRetry?: () => void;
  onDismiss: () => void;
}) {
  return (
    <section
      className="chat-copy-fallback"
      data-chat-copy-fallback={fallback.kind}
      role="group"
      aria-label={chatText(locale, { 'zh-CN': '手动复制聊天内容', 'en-US': 'Manual chat copy fallback' })}
    >
      <div className="chat-copy-fallback-head">
        <strong>{fallback.title}</strong>
        <div>
          {onRetry ? (
            <button type="button" onClick={onRetry}>
              <ClipboardCopy size={13} aria-hidden />
              <span>{chatText(locale, { 'zh-CN': '重试复制', 'en-US': 'Try copy again' })}</span>
            </button>
          ) : null}
          <button
            type="button"
            aria-label={chatText(locale, { 'zh-CN': '关闭手动复制', 'en-US': 'Dismiss manual copy fallback' })}
            onClick={onDismiss}
          >
            <X size={13} aria-hidden />
          </button>
        </div>
      </div>
      <p>{fallback.detail}</p>
      <textarea
        readOnly
        value={fallback.text}
        onFocus={(event) => event.currentTarget.select()}
        aria-label={chatText(locale, { 'zh-CN': '可手动复制的聊天文本', 'en-US': 'Chat text available for manual copy' })}
      />
    </section>
  );
}
