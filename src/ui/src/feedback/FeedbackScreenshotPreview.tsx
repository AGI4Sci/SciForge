import type { FeedbackCommentRecord } from '../domain';

export function FeedbackScreenshotPreview({ item }: { item: FeedbackCommentRecord }) {
  if (!item.screenshot?.dataUrl) return null;
  return (
    <figure className="feedback-screenshot-preview">
      <img src={item.screenshot.dataUrl} alt={`反馈截图：${item.comment}`} loading="lazy" />
      <figcaption>
        <span>截图证据</span>
        <code>{Math.round(item.screenshot.targetRect.x)}, {Math.round(item.screenshot.targetRect.y)} · {Math.round(item.screenshot.targetRect.width)}x{Math.round(item.screenshot.targetRect.height)}</code>
        <em>默认不进入 agent 上下文；需要视觉判断时可从 Bundle 选择性提供。</em>
      </figcaption>
    </figure>
  );
}
