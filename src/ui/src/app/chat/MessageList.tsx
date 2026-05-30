import { MessageSquare } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import type { SupportedLocale } from '../../i18n';
import { chatText } from './chatI18n';

export function MessageList({
  refObject,
  hasMessages,
  visibleMessageCount,
  collapsedBeforeCount,
  children,
  runningMessage,
  onScroll,
  locale,
}: {
  refObject: RefObject<HTMLDivElement | null>;
  hasMessages: boolean;
  visibleMessageCount: number;
  collapsedBeforeCount: number;
  children: ReactNode;
  runningMessage?: ReactNode;
  onScroll: () => void;
  locale?: SupportedLocale;
}) {
  return (
    <div className="messages-stack">
      <div
        className="messages"
        ref={refObject}
        onScroll={onScroll}
      >
        {!hasMessages ? (
          <div className="chat-empty">
            <MessageSquare size={18} />
            <strong>{chatText(locale, { 'zh-CN': '新对话已就绪', 'en-US': 'New chat ready' })}</strong>
            <span>{chatText(locale, {
              'zh-CN': '提问，或把文件、消息和结果作为上下文附加进来。',
              'en-US': 'Ask a question, or attach files, messages, and results as context.',
            })}</span>
          </div>
        ) : null}
        {collapsedBeforeCount > 0 ? (
          <div className="chat-empty compact-history-note">
            <MessageSquare size={18} />
            <strong>{chatText(locale, { 'zh-CN': '较早消息已折叠', 'en-US': 'Earlier messages collapsed' })}</strong>
            <span>{chatText(locale, {
              'zh-CN': `正在显示最近 ${visibleMessageCount} 条消息。较早活动和结果仍可从历史与结果中查看。`,
              'en-US': `Showing the latest ${visibleMessageCount} messages. Earlier activity and results remain available from history and results.`,
            })}</span>
          </div>
        ) : null}
        {children}
        {runningMessage}
      </div>
    </div>
  );
}
