import { MessageSquare } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

export function MessageList({
  refObject,
  hasMessages,
  visibleMessageCount,
  collapsedBeforeCount,
  children,
  runningMessage,
  onScroll,
}: {
  refObject: RefObject<HTMLDivElement | null>;
  hasMessages: boolean;
  visibleMessageCount: number;
  collapsedBeforeCount: number;
  children: ReactNode;
  runningMessage?: ReactNode;
  onScroll: () => void;
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
            <strong>新聊天已就绪</strong>
            <span>输入研究问题，或点选文件、历史消息和结果对象作为当前上下文。</span>
          </div>
        ) : null}
        {collapsedBeforeCount > 0 ? (
          <div className="chat-empty compact-history-note">
            <MessageSquare size={18} />
            <strong>已折叠较早对话</strong>
            <span>当前工作台仅渲染最近 {visibleMessageCount} 条消息，较早过程、验证线索和产物记录仍保留，可从历史与结果入口追溯。</span>
          </div>
        ) : null}
        {children}
        {runningMessage}
      </div>
    </div>
  );
}
