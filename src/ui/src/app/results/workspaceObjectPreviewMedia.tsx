import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { WorkspaceFileContent } from '../../api/workspaceClient';
import type { SciForgeReference } from '../../domain';
import { cx } from '../uiPrimitives';
import { rightPaneInlineLabel } from './previewSafety';
import { resultText, type ResultLocale } from './resultLocale';
import {
  copyableSciForgeReferenceJson,
  normalizedWorkspaceObjectMediaRegion,
  regionReferenceForClipboard,
  workspaceObjectMediaRegionStyle,
  type WorkspaceObjectMediaRegion,
} from './workspaceObjectPreviewMediaModel';
import {
  sciForgeReferenceAttribute,
} from '../../../../../packages/support/object-references';

export function UploadedDataUrlPreview({
  kind,
  dataUrl,
  title,
  mimeType,
  reference,
  locale,
}: {
  kind: 'image' | 'pdf';
  dataUrl: string;
  title: string;
  mimeType?: string;
  reference?: SciForgeReference;
  locale?: ResultLocale;
}) {
  const [objectUrl, setObjectUrl] = useState('');
  const [regionPick, setRegionPick] = useState<RegionPickState | null>(null);
  const [pickedRegion, setPickedRegion] = useState<string>('');
  const regionRef = useRef<HTMLDivElement | null>(null);
  const safeTitle = rightPaneInlineLabel(title);
  useEffect(() => {
    if (kind !== 'pdf') return undefined;
    let cancelled = false;
    let nextUrl = '';
    void fetch(dataUrl)
      .then((response) => response.blob())
      .then((blob) => {
        if (cancelled) return;
        nextUrl = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: mimeType || 'application/pdf' }));
        setObjectUrl(nextUrl);
      })
      .catch(() => {
        if (!cancelled) setObjectUrl(dataUrl);
      });
    return () => {
      cancelled = true;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [dataUrl, kind, mimeType]);

  const regionLayer = reference ? (
    <div className={cx('workspace-object-region-layer', regionPick?.active ? 'active' : regionPick ? 'ready' : undefined)} ref={regionRef} onMouseDown={startRegionPick}>
      {regionPick ? <span className="workspace-object-region-box" style={workspaceObjectMediaRegionStyle(regionPick)} /> : null}
      {pickedRegion ? <span className="workspace-object-region-label">{pickedRegion}</span> : null}
    </div>
  ) : null;

  if (kind === 'image') {
    return (
      <div className="workspace-object-image-frame" data-sciforge-reference={sciForgeReferenceAttribute(reference)}>
        <img src={dataUrl} alt={safeTitle} />
        {regionLayer}
        <PreviewReferenceHint
          reference={reference}
          label={resultText(locale, { 'zh-CN': '点选图片或拖选区域作为图像上下文', 'en-US': 'Select the image or drag a region to use it as image context' })}
          locale={locale}
          onPickRegion={reference ? beginRegionPick : undefined}
        />
      </div>
    );
  }
  return (
    <div className="workspace-object-pdf-shell" data-sciforge-reference={sciForgeReferenceAttribute(reference)}>
      <object className="workspace-object-pdf-frame" data={objectUrl || dataUrl} type={mimeType || 'application/pdf'} aria-label={safeTitle}>
        <iframe className="workspace-object-pdf-frame" title={safeTitle} src={objectUrl || dataUrl} />
      </object>
      {regionLayer}
      <PreviewReferenceHint
        reference={reference}
        label={resultText(locale, { 'zh-CN': '点选整份 PDF，或拖选页面区域作为上下文', 'en-US': 'Select the whole PDF, or drag a page region as context' })}
        locale={locale}
        onPickRegion={reference ? beginRegionPick : undefined}
      />
    </div>
  );

  function beginRegionPick() {
    setPickedRegion('');
    setRegionPick({ active: false, x: 0, y: 0, width: 0, height: 0 });
  }

  function startRegionPick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!regionPick || !regionRef.current || !reference) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = regionRef.current.getBoundingClientRect();
    const startX = normalizedPointerPosition(event.clientX, bounds.left, bounds.width);
    const startY = normalizedPointerPosition(event.clientY, bounds.top, bounds.height);
    setRegionPick({ active: true, x: startX, y: startY, width: 0, height: 0, originX: startX, originY: startY });
    function move(pointerEvent: MouseEvent) {
      const currentX = normalizedPointerPosition(pointerEvent.clientX, bounds.left, bounds.width);
      const currentY = normalizedPointerPosition(pointerEvent.clientY, bounds.top, bounds.height);
      const x = Math.min(startX, currentX);
      const y = Math.min(startY, currentY);
      setRegionPick({ active: true, x, y, width: Math.abs(currentX - startX), height: Math.abs(currentY - startY), originX: startX, originY: startY });
    }
    function up(pointerEvent: MouseEvent) {
      move(pointerEvent);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const endX = normalizedPointerPosition(pointerEvent.clientX, bounds.left, bounds.width);
      const endY = normalizedPointerPosition(pointerEvent.clientY, bounds.top, bounds.height);
      const region = normalizedWorkspaceObjectMediaRegion({
        start: { x: startX, y: startY },
        end: { x: endX, y: endY },
      });
      if (!region) {
        setRegionPick(null);
        return;
      }
      setPickedRegion(`region ${region.region}`);
      setRegionPick({ active: false, x: region.x, y: region.y, width: region.width, height: region.height });
      copyReferenceToClipboard(regionReferenceForClipboard(reference, region));
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }
}

export function WorkspaceFileMediaReferenceNotice({
  kind,
  file,
  reference,
  locale,
}: {
  kind: 'image' | 'pdf';
  file: WorkspaceFileContent;
  reference: SciForgeReference;
  locale?: ResultLocale;
}) {
  const copyLabel = kind === 'pdf'
    ? resultText(locale, { 'zh-CN': '复制 PDF 引用', 'en-US': 'Copy PDF reference' })
    : resultText(locale, { 'zh-CN': '复制图像引用', 'en-US': 'Copy image reference' });
  const message = kind === 'pdf'
    ? resultText(locale, { 'zh-CN': 'PDF 已作为可点击文件引用附加。选择此卡片作为上下文后，可带页码、章节、图号或区域细节提问。', 'en-US': 'The PDF is attached as a clickable file reference. Select this card as context, then ask with page, section, figure, or region details.' })
    : resultText(locale, { 'zh-CN': '图像已作为可点击文件引用附加。内联预览不会嵌入二进制内容；请选择此卡片作为图像上下文，或在外部打开查看。', 'en-US': 'The image is attached as a clickable file reference. Inline preview does not embed binary content; select this card as image context, or open it externally to inspect it.' });
  return (
    <div className="workspace-object-media-note" data-sciforge-reference={sciForgeReferenceAttribute(reference)}>
      <p>{message}</p>
      <div className="source-list">
        <code>{rightPaneInlineLabel(file.path)}</code>
        {file.mimeType ? <code>{rightPaneInlineLabel(file.mimeType)}</code> : null}
        {file.encoding ? <code>{rightPaneInlineLabel(file.encoding)}</code> : null}
        <button type="button" onClick={() => copyReferenceToClipboard(reference)}>{copyLabel}</button>
      </div>
    </div>
  );
}

type RegionPickState = {
  active: boolean;
  x: WorkspaceObjectMediaRegion['x'];
  y: WorkspaceObjectMediaRegion['y'];
  width: WorkspaceObjectMediaRegion['width'];
  height: WorkspaceObjectMediaRegion['height'];
  originX?: number;
  originY?: number;
};

function PreviewReferenceHint({
  reference,
  label,
  locale,
  onPickRegion,
}: {
  reference?: SciForgeReference;
  label: string;
  locale?: ResultLocale;
  onPickRegion?: () => void;
}) {
  return (
    <div className="workspace-object-reference-hint">
      <span>{label}</span>
      <div>
        {onPickRegion ? <button type="button" onClick={onPickRegion}>{resultText(locale, { 'zh-CN': '选择区域', 'en-US': 'Select region' })}</button> : null}
        {reference ? <button type="button" onClick={() => copyReferenceToClipboard(reference)}>{resultText(locale, { 'zh-CN': '复制引用', 'en-US': 'Copy reference' })}</button> : null}
      </div>
    </div>
  );
}

function normalizedPointerPosition(value: number, origin: number, size: number) {
  if (!Number.isFinite(size) || size <= 0) return 0;
  return Math.min(1, Math.max(0, (value - origin) / size));
}

function copyReferenceToClipboard(reference: SciForgeReference | undefined) {
  if (typeof navigator === 'undefined') return;
  const copyableReferenceJson = copyableSciForgeReferenceJson(reference);
  if (copyableReferenceJson) void navigator.clipboard?.writeText(copyableReferenceJson);
}
