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
            <span>输入研究问题，或先点选文件、历史消息、任务结果、图表和表格作为上下文。</span>
          </div>
        ) : null}
        {collapsedBeforeCount > 0 ? (
          <div className="chat-empty compact-history-note">
            <MessageSquare size={18} />
            <strong>已折叠较早对话</strong>
            <span>当前工作台仅渲染最近 {visibleMessageCount} 条消息，完整审计保留在 runs、ExecutionUnit 和 workspace artifacts 中。</span>
          </div>
        ) : null}
        {children}
        {runningMessage}
      </div>
    </div>
  );
}
