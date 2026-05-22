import { useMemo, useState } from 'react';
import { Clipboard, ExternalLink, Maximize2, X } from 'lucide-react';
import type { FeedbackCommentRecord, FeedbackEvidenceAssetRecord, SciForgeConfig } from '../domain';

interface EvidenceObject {
  id: string;
  label: string;
  kind: string;
  ref: string;
  previewSrc?: string;
  openUrl?: string;
  meta?: string;
}

export function FeedbackScreenshotPreview({ item, config }: { item: FeedbackCommentRecord; config?: SciForgeConfig }) {
  const evidenceObjects = useMemo(() => buildEvidenceObjects(item, config), [item, config]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [expanded, setExpanded] = useState(false);
  const [copyHint, setCopyHint] = useState('');
  const selected = evidenceObjects.find((object) => object.id === selectedId)
    ?? evidenceObjects.find((object) => object.kind === 'scrubbed-annotated-screenshot' && object.previewSrc)
    ?? evidenceObjects.find((object) => object.kind === 'annotated-screenshot' && object.previewSrc)
    ?? evidenceObjects.find((object) => object.previewSrc)
    ?? evidenceObjects[0];
  const imageSrc = selected?.previewSrc || item.screenshot?.annotatedDataUrl || item.screenshot?.dataUrl;
  if (!imageSrc && !item.evidenceStatus && evidenceObjects.length === 0) return null;
  const evidenceStatus = item.evidenceStatus?.status ?? (item.screenshot || evidenceObjects.length ? 'complete' : 'missing');

  async function copyRef(ref: string) {
    try {
      await navigator.clipboard.writeText(ref);
      setCopyHint('ref copied');
    } catch {
      setCopyHint('clipboard unavailable');
    }
  }

	  return (
	    <figure className="feedback-screenshot-preview">
	      <div className="feedback-screenshot-frame">
        {imageSrc ? (
          <button type="button" className="feedback-screenshot-image-button" onClick={() => setExpanded(true)} aria-label="放大截图证据">
            <img src={imageSrc} alt={`反馈截图：${item.comment}`} loading="lazy" />
          </button>
        ) : (
          <div className="feedback-screenshot-empty">no image preview</div>
        )}
	      </div>
	      <figcaption>
	        <div className="feedback-screenshot-caption-main">
	          <span>{evidenceStatus === 'complete' ? '整页截图证据' : `整页截图证据 · ${evidenceStatus}`}</span>
	          {item.screenshot ? <code>{item.screenshot.width}x{item.screenshot.height}</code> : null}
	          {selected?.meta ? <code>{selected.meta}</code> : null}
	        </div>
	        {selected ? (
	          <div className="feedback-evidence-object-actions compact">
	            {selected.previewSrc ? (
	              <button type="button" onClick={() => setExpanded(true)}>
	                <Maximize2 size={13} aria-hidden />
	                放大
	              </button>
	            ) : null}
	            {selected.openUrl ? (
	              <a href={selected.openUrl} target="_blank" rel="noreferrer">
	                <ExternalLink size={13} aria-hidden />
	                打开
	              </a>
	            ) : null}
	            <button type="button" onClick={() => void copyRef(selected.ref)}>
	              <Clipboard size={13} aria-hidden />
	              复制 ref
	            </button>
	          </div>
	        ) : null}
	        {evidenceObjects.length ? (
	          <details className="feedback-evidence-object-details">
	            <summary>证据对象与 refs</summary>
	            <div className="feedback-evidence-object-list" aria-label="feedback evidence objects">
	              {evidenceObjects.map((object) => (
	                <button
	                  type="button"
	                  key={object.id}
	                  className={object.id === selected?.id ? 'selected' : ''}
	                  onClick={() => setSelectedId(object.id)}
	                  title={object.ref}
	                  data-sciforge-reference={object.ref}
	                >
	                  <strong>{object.label}</strong>
	                  <span>{[object.kind, object.meta].filter(Boolean).join(' · ')}</span>
	                </button>
	              ))}
	            </div>
	            {selected ? <code>{selected.ref}</code> : null}
	          </details>
	        ) : null}
	        {copyHint ? <em>{copyHint}</em> : null}
	        {item.evidenceStatus?.diagnostics.length ? <em>{item.evidenceStatus.diagnostics.join(' · ')}</em> : null}
	      </figcaption>
      {expanded && imageSrc ? (
        <div className="feedback-screenshot-lightbox" role="dialog" aria-modal="true" aria-label="放大截图证据">
          <button type="button" className="feedback-screenshot-lightbox-close" onClick={() => setExpanded(false)} aria-label="关闭截图预览">
            <X size={16} aria-hidden />
          </button>
          <img src={imageSrc} alt={`反馈截图放大：${item.comment}`} />
          {selected ? <code>{selected.ref}</code> : null}
        </div>
      ) : null}
    </figure>
  );
}

function buildEvidenceObjects(item: FeedbackCommentRecord, config?: SciForgeConfig): EvidenceObject[] {
  const objects: EvidenceObject[] = [];
  for (const asset of item.evidenceAssets ?? []) {
    objects.push(evidenceObjectFromAsset(asset, config));
  }
  if (item.screenshot?.annotatedDataUrl || item.screenshot?.dataUrl) {
    const ref = item.annotatedScreenshotRef || item.screenshot?.annotatedScreenshotRef || 'inline:annotated-screenshot';
    objects.push({
      id: `inline-annotated-${objects.length}`,
      label: 'Annotated screenshot',
      kind: 'annotated-screenshot',
      ref,
      previewSrc: item.screenshot.annotatedDataUrl || item.screenshot.dataUrl,
      meta: screenshotMeta(item),
    });
  }
  if (item.screenshot?.rawDataUrl) {
    const ref = item.rawScreenshotRef || item.screenshot.rawScreenshotRef || 'inline:raw-screenshot';
    objects.push({
      id: `inline-raw-${objects.length}`,
      label: 'Raw screenshot',
      kind: 'raw-screenshot',
      ref,
      previewSrc: item.screenshot.rawDataUrl,
      meta: screenshotMeta(item),
    });
  }
  for (const [label, kind, ref] of [
    ['Annotated ref', 'annotated-ref', item.annotatedScreenshotRef || item.screenshot?.annotatedScreenshotRef],
    ['Raw ref', 'raw-ref', item.rawScreenshotRef || item.screenshot?.rawScreenshotRef || item.screenshotRef],
    ['Bundle', 'evidence-bundle', item.evidenceBundleRef],
  ] as const) {
    if (!ref || objects.some((object) => object.ref === ref)) continue;
    objects.push({
      id: `${kind}-${objects.length}`,
      label,
      kind,
      ref,
      openUrl: previewUrlForRef(ref, config),
    });
  }
  return objects;
}

function evidenceObjectFromAsset(asset: FeedbackEvidenceAssetRecord, config?: SciForgeConfig): EvidenceObject {
  const preview = previewUrlForRef(asset.ref, config);
  const publicUrl = asset.publicUrl || asset.githubMarkdownUrl || asset.markdownImageUrl;
  return {
    id: asset.id,
    label: asset.label,
    kind: asset.kind,
    ref: asset.ref,
    previewSrc: asset.mediaType?.startsWith('image/') ? preview : undefined,
    openUrl: publicUrl || preview,
    meta: [
      asset.uploadStatus ? `upload ${asset.uploadStatus}` : '',
      asset.width && asset.height ? `${asset.width}x${asset.height}` : '',
      asset.bytes ? `${asset.bytes} bytes` : '',
    ].filter(Boolean).join(' · '),
  };
}

function previewUrlForRef(ref: string | undefined, config?: SciForgeConfig) {
  if (!ref || !config || /^data:image\//i.test(ref) || /^feedback-bundle:/i.test(ref) || /^inline:/i.test(ref)) return undefined;
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/sciforge/preview/raw`);
  url.searchParams.set('ref', ref);
  url.searchParams.set('workspacePath', config.workspacePath);
  return url.toString();
}

function screenshotMeta(item: FeedbackCommentRecord) {
  if (!item.screenshot) return undefined;
  return `${item.screenshot.mediaType} ${item.screenshot.width}x${item.screenshot.height}`;
}
