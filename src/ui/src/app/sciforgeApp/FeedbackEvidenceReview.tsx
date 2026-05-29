import type { FeedbackCommentRecord, SciForgeConfig } from '../../domain';
import { FeedbackScreenshotPreview } from '../../feedback/FeedbackScreenshotPreview';

export function FeedbackEvidenceReview({ item, config }: { item: FeedbackCommentRecord; config: SciForgeConfig }) {
  return (
    <section className="feedback-evidence-review" aria-label="截图证据、用户评论和期望实际">
      <div className="feedback-evidence-review-shot">
        <FeedbackScreenshotPreview item={item} config={config} />
      </div>
      <div className="feedback-evidence-review-copy">
        <div>
          <span>用户评论</span>
          <strong>{item.comment}</strong>
        </div>
        <div>
          <span>期望</span>
          <p>{item.expectedBehavior || '未单独填写；以用户评论为准。'}</p>
        </div>
        <div>
          <span>实际</span>
          <p>{item.actualBehavior || item.comment}</p>
        </div>
        <div className="feedback-evidence-review-context">
          <span>页面</span>
          <code>{item.runtime.page}</code>
          <span>目标</span>
          <code>{item.target.selector || item.target.path}</code>
        </div>
      </div>
    </section>
  );
}

export function feedbackEvidenceSummary(item: FeedbackCommentRecord) {
  const checks = [
    {
      label: 'raw screenshot',
      ok: item.evidenceStatus?.rawScreenshot ?? Boolean(item.rawScreenshotRef || item.screenshotRef || item.screenshot?.rawScreenshotRef || item.screenshot?.rawDataUrl || item.screenshot?.dataUrl),
    },
    {
      label: 'annotated screenshot',
      ok: item.evidenceStatus?.annotatedScreenshot ?? Boolean(item.annotatedScreenshotRef || item.screenshot?.annotatedScreenshotRef || item.screenshot?.annotatedDataUrl || item.evidenceAssets?.some((asset) => asset.kind === 'scrubbed-annotated-screenshot')),
    },
    {
      label: 'target snapshot',
      ok: item.evidenceStatus?.targetSnapshot ?? Boolean(item.target.selector && item.target.path),
    },
    {
      label: 'runtime snapshot',
      ok: item.evidenceStatus?.runtimeSnapshot ?? Boolean(item.runtime.page && item.runtime.scenarioId),
    },
    {
      label: 'scrubbed',
      ok: item.evidenceStatus?.scrubbed ?? Boolean(item.evidenceAssets?.some((asset) => asset.kind === 'scrubbed-annotated-screenshot')),
    },
  ];
  const ready = checks.filter((check) => check.ok).length;
  const computedStatus = ready === checks.length ? 'complete' : ready > 0 ? 'partial' : 'missing';
  return {
    status: item.evidenceStatus?.status ?? computedStatus,
    ready,
    total: checks.length,
    checks,
    diagnostics: item.evidenceStatus?.diagnostics ?? [],
  };
}
