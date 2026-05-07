import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Sparkles } from 'lucide-react';
import type { SciForgeConfig, SciForgeReference, SciForgeSession, ObjectReference, PreviewDescriptor } from '../../domain';
import { readPreviewDerivative, readPreviewDescriptor, readWorkspaceFile, type WorkspaceFileContent } from '../../api/workspaceClient';
import { artifactPreviewActions } from '../../runtimeContracts';
import { Badge, cx } from '../uiPrimitives';
import { MarkdownBlock } from './reportContent';
import { PreviewDescriptorActions } from './PreviewActions';
import { descriptorCanUseWorkspacePreview, descriptorDerivativeKind, fileKindForPath, normalizeArtifactPreviewDescriptor, previewNeedsPackage, uploadedArtifactPreview } from './previewDescriptor';
import {
  descriptorWithDiagnostic as packageDescriptorWithDiagnostic,
  mergePreviewDescriptors as packageMergePreviewDescriptors,
  shouldHydratePreviewDescriptor as packageShouldHydratePreviewDescriptor,
} from '../../../../../packages/artifact-preview';
import { artifactForObjectReference, sciForgeReferenceAttribute, pathForObjectReference, referenceForObjectReference, referenceForWorkspaceFileLike, withRegionLocator } from '../../../../../packages/object-references';

export function WorkspaceObjectPreview({
  reference,
  session,
  config,
  onPreviewPackageRequest,
}: {
  reference: ObjectReference;
  session: SciForgeSession;
  config: SciForgeConfig;
  onPreviewPackageRequest?: (reference: ObjectReference, path?: string, descriptor?: PreviewDescriptor) => void;
}) {
  const artifact = artifactForObjectReference(reference, session);
  const inlinePreview = useMemo(() => uploadedArtifactPreview(artifact), [artifact]);
  const path = pathForObjectReference(reference, session);
  const [descriptor, setDescriptor] = useState<PreviewDescriptor | undefined>();
  const [file, setFile] = useState<WorkspaceFileContent | undefined>();
  const [loadingPath, setLoadingPath] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setFile(undefined);
    setDescriptor(undefined);
    setError('');
    if (inlinePreview) return undefined;
    if (!path || (reference.kind !== 'file' && reference.kind !== 'artifact') || /^https?:\/\//i.test(path)) return undefined;
    let cancelled = false;
    setLoadingPath(path);
    const staticDescriptor = normalizeArtifactPreviewDescriptor(artifact, path);
    if (staticDescriptor) {
      setDescriptor(staticDescriptor);
      if (!packageShouldHydratePreviewDescriptor(staticDescriptor, path)) {
        setLoadingPath('');
        return () => {
          cancelled = true;
        };
      }
    }
    void readPreviewDescriptor(path, config)
      .then((nextDescriptor) => {
        if (!cancelled) setDescriptor(staticDescriptor ? packageMergePreviewDescriptors(staticDescriptor, nextDescriptor) : nextDescriptor);
      })
      .catch(async (descriptorError) => {
        if (staticDescriptor) {
          if (!cancelled) setDescriptor(packageDescriptorWithDiagnostic(staticDescriptor, descriptorError));
          return;
        }
        try {
          const nextFile = await readWorkspaceFile(path, config);
          if (!cancelled) setFile(nextFile);
        } catch (fileError) {
          if (!cancelled) {
            const descriptorMessage = descriptorError instanceof Error ? descriptorError.message : String(descriptorError);
            const fileMessage = fileError instanceof Error ? fileError.message : String(fileError);
            setError(`已切换到备用预览，但仍无法读取：${fileMessage}；descriptor diagnostic: ${descriptorMessage}`);
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPath('');
      });
    return () => {
      cancelled = true;
    };
  }, [artifact, config, inlinePreview, path, reference.kind]);

  if (reference.kind === 'url') {
    const url = reference.ref.replace(/^url:/i, '');
    return (
      <div className="workspace-object-preview">
        <div className="workspace-object-preview-head">
          <Badge variant="info">url</Badge>
          <strong>{reference.title}</strong>
        </div>
        <a href={url} target="_blank" rel="noreferrer">{url}</a>
      </div>
    );
  }
  if (reference.kind === 'folder') {
    return (
      <div className="workspace-object-preview">
        <div className="workspace-object-preview-head">
          <Badge variant="info">folder</Badge>
          <strong>{path || reference.ref}</strong>
        </div>
        <p>这是一个 workspace 文件夹引用；可用“系统打开”或“打开文件夹”查看内容。</p>
      </div>
    );
  }
  if (reference.kind !== 'file' && reference.kind !== 'artifact') return null;
  if (inlinePreview) {
    const previewReference = referenceForObjectReference(reference, inlinePreview.kind === 'pdf' || inlinePreview.kind === 'image' ? 'file-region' : 'file');
    return (
      <div className="workspace-object-preview" data-sciforge-reference={sciForgeReferenceAttribute(previewReference)}>
        <div className="workspace-object-preview-head">
          <Badge variant="info">{inlinePreview.kind}</Badge>
          <strong>{inlinePreview.title}</strong>
          {inlinePreview.size ? <span>{formatBytes(inlinePreview.size)}</span> : null}
        </div>
        <UploadedDataUrlPreview
          kind={inlinePreview.kind}
          dataUrl={inlinePreview.dataUrl}
          title={inlinePreview.title}
          mimeType={inlinePreview.mimeType}
          reference={previewReference}
        />
      </div>
    );
  }
  if (!path) return null;
  if (loadingPath) {
    return (
      <div className="workspace-object-preview">
        <div className="workspace-object-preview-head">
          <Badge variant="muted">loading</Badge>
          <strong>{loadingPath}</strong>
        </div>
        <p>正在读取 workspace 文件内容...</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="workspace-object-preview">
        <div className="workspace-object-preview-head">
          <Badge variant="warning">preview</Badge>
          <strong>{path}</strong>
        </div>
        <UnsupportedPreviewPackageNotice
          reference={reference}
          path={path}
          diagnostic={error}
          onRequest={onPreviewPackageRequest}
        />
      </div>
    );
  }
  if (descriptor) {
    return (
      <div className="workspace-object-preview" data-sciforge-reference={sciForgeReferenceAttribute(referenceForObjectReference(reference, descriptor.kind === 'pdf' || descriptor.kind === 'image' ? 'file-region' : 'file'))}>
        <div className="workspace-object-preview-head">
          <Badge variant="info">{descriptor.kind}</Badge>
          <strong>{descriptor.title || descriptor.ref}</strong>
          {descriptor.sizeBytes !== undefined ? <span>{formatBytes(descriptor.sizeBytes)}</span> : null}
        </div>
        {previewNeedsPackage(descriptor) ? (
          <UnsupportedPreviewPackageNotice
            reference={reference}
            path={path}
            descriptor={descriptor}
            onRequest={onPreviewPackageRequest}
          />
        ) : (
          <DescriptorPreview descriptor={descriptor} config={config} reference={referenceForObjectReference(reference, descriptor.kind === 'pdf' || descriptor.kind === 'image' ? 'file-region' : 'file')} />
        )}
      </div>
    );
  }
  if (!file) return null;
  return (
    <div className="workspace-object-preview" data-sciforge-reference={sciForgeReferenceAttribute(referenceForObjectReference(reference, fileKindForPath(file.path, file.language) === 'pdf' ? 'file-region' : 'file'))}>
      <div className="workspace-object-preview-head">
        <Badge variant="info">{file.language || fileKindForPath(file.path)}</Badge>
        <strong>{file.path}</strong>
        <span>{formatBytes(file.size)}</span>
      </div>
      <WorkspaceFileInlineViewer file={file} />
    </div>
  );
}

function DescriptorPreview({ descriptor, config, reference }: { descriptor: PreviewDescriptor; config: SciForgeConfig; reference: SciForgeReference }) {
  const [derivedFile, setDerivedFile] = useState<WorkspaceFileContent | undefined>();
  const [derivedLabel, setDerivedLabel] = useState('');
  const [derivedError, setDerivedError] = useState('');
  const [derivedLoading, setDerivedLoading] = useState(false);
  useEffect(() => {
    if (!descriptorCanUseWorkspacePreview(descriptor)) {
      setDerivedFile(undefined);
      setDerivedLabel('');
      setDerivedError('');
      setDerivedLoading(false);
      return undefined;
    }
    let cancelled = false;
    setDerivedFile(undefined);
    setDerivedError('');
    setDerivedLoading(true);
    void loadDescriptorPreviewFile(descriptor, config)
      .then(({ file, label }) => {
        if (cancelled) return;
        setDerivedFile(file);
        setDerivedLabel(label);
      })
      .catch((error) => {
        if (!cancelled) setDerivedError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setDerivedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config, descriptor]);

  if ((descriptor.kind === 'pdf' || descriptor.kind === 'image') && descriptor.rawUrl) {
    return (
      <UploadedDataUrlPreview
        kind={descriptor.kind}
        dataUrl={descriptor.rawUrl}
        title={descriptor.title || descriptor.ref}
        mimeType={descriptor.mimeType}
        reference={reference}
      />
    );
  }
  if (descriptor.kind === 'markdown' || descriptor.kind === 'text' || descriptor.kind === 'json' || descriptor.kind === 'table' || descriptor.kind === 'html') {
    return (
      <div className="workspace-object-media-note">
        <p>此 artifact 使用 workspace descriptor 预览；小文件直接读取，大文件按需生成 text/schema 派生预览。这只调用本地 workspace 函数，不增加 LLM token 开销。</p>
        {derivedLoading ? <p>正在生成或读取预览...</p> : null}
        {derivedFile ? (
          <div className="descriptor-derived-preview">
            <Badge variant="info">{derivedLabel}</Badge>
            <WorkspaceFileInlineViewer file={derivedFile} />
          </div>
        ) : null}
        {derivedError ? <pre className="workspace-object-code">{derivedError}</pre> : null}
        <PreviewDescriptorActions descriptor={descriptor} reference={reference} />
      </div>
    );
  }
  return (
    <div className="workspace-object-media-note">
      <p>{descriptor.title || descriptor.ref} 已作为轻量 artifact 聚焦。当前类型使用 metadata/system-open/copy-ref 作为稳定 fallback，派生内容按需生成。</p>
      <PreviewDescriptorActions descriptor={descriptor} reference={reference} />
    </div>
  );
}

async function loadDescriptorPreviewFile(descriptor: PreviewDescriptor, config: SciForgeConfig) {
  const shouldReadInline = descriptor.inlinePolicy === 'inline' && (descriptor.sizeBytes ?? 0) <= 1024 * 1024;
  if (shouldReadInline) {
    try {
      return { file: await readWorkspaceFile(descriptor.ref, config), label: 'inline' };
    } catch {
      // Fall through to derived preview; the descriptor endpoint may point at a file outside the normal workspace route.
    }
  }
  const derivativeKind = descriptorDerivativeKind(descriptor);
  const derivative = await readPreviewDerivative(descriptor.ref, derivativeKind, config);
  return { file: await readWorkspaceFile(derivative.ref, config), label: `${derivative.kind} derivative` };
}

function UnsupportedPreviewPackageNotice({
  reference,
  path,
  descriptor,
  diagnostic,
  onRequest,
}: {
  reference: ObjectReference;
  path?: string;
  descriptor?: PreviewDescriptor;
  diagnostic?: string;
  onRequest?: (reference: ObjectReference, path?: string, descriptor?: PreviewDescriptor) => void;
}) {
  const kind = descriptor?.kind || reference.artifactType || 'unknown';
  return (
    <div className="unsupported-preview-package">
      <p>
        这个文件仍然可以作为对象引用传给 Agent，但右侧暂不支持内联预览
        {kind ? `（${kind}）` : ''}。需要设计一个匹配该文件类型的 preview package 插件后，才能在这里稳定渲染。
      </p>
      <div className="source-list">
        <code>{path || descriptor?.ref || reference.ref}</code>
        {descriptor?.mimeType ? <code>{descriptor.mimeType}</code> : null}
        {descriptor?.inlinePolicy ? <code>inlinePolicy: {descriptor.inlinePolicy}</code> : null}
      </div>
      {diagnostic ? <pre className="workspace-object-code">{diagnostic}</pre> : null}
      <button
        type="button"
        className="unsupported-preview-package-action"
        onClick={() => onRequest?.(reference, path, descriptor)}
        disabled={!onRequest}
      >
        <Sparkles size={14} />
        让 Agent 设计 preview package 并重试
      </button>
    </div>
  );
}

function WorkspaceFileInlineViewer({ file }: { file: WorkspaceFileContent }) {
  const kind = fileKindForPath(file.path, file.language);
  if (kind === 'markdown') return <MarkdownBlock markdown={file.content} />;
  if (kind === 'json') return <pre className="workspace-object-code">{formatJsonLike(file.content)}</pre>;
  if (kind === 'csv' || kind === 'tsv') return <DelimitedTextPreview content={file.content} delimiter={kind === 'tsv' ? '\t' : ','} />;
  if (kind === 'image') {
    if (file.encoding === 'base64') {
      return (
        <div className="workspace-object-image-frame">
          <img src={`data:${file.mimeType || 'image/png'};base64,${file.content}`} alt={file.name} />
        </div>
      );
    }
    return (
      <div className="workspace-object-media-note">
        图片文件已解析为 workspace 引用，但当前 workspace server 未返回 base64 预览；可使用“系统打开”查看。
        <pre className="workspace-object-code">{file.content.slice(0, 4000)}</pre>
      </div>
    );
  }
  if (kind === 'pdf') {
    if (file.encoding === 'base64') {
      return (
        <UploadedDataUrlPreview
          kind="pdf"
          dataUrl={`data:${file.mimeType || 'application/pdf'};base64,${file.content}`}
          title={file.name}
          mimeType={file.mimeType || 'application/pdf'}
          reference={referenceForWorkspaceFile(file, 'file-region')}
        />
      );
    }
    return (
      <div className="workspace-object-media-note">
        <p>PDF 已作为可点击文件引用聚焦。点击对话栏“点选”后选中这张卡片，即可把 PDF 文件作为上下文；如需页码、段落或图表区域，请在问题中补充页码/图号/坐标描述。</p>
        <div className="source-list">
          <code>{file.path}</code>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(referenceForWorkspaceFile(file, 'file-region'), null, 2))}>复制 PDF 引用</button>
        </div>
      </div>
    );
  }
  if (kind === 'document' || kind === 'spreadsheet' || kind === 'presentation') {
    return (
      <div className="workspace-object-media-note">
        <p>{officePreviewLabel(kind)} 已作为可点击文件引用聚焦。浏览器内联预览暂不展开此类二进制文件，可用“系统打开”查看完整内容，或继续把它作为上下文引用给 SciForge。</p>
        <div className="source-list">
          <code>{file.path}</code>
          <code>{file.mimeType || 'application/octet-stream'}</code>
        </div>
      </div>
    );
  }
  if (kind === 'html') return <pre className="workspace-object-code">{file.content.slice(0, 12000)}</pre>;
  return <pre className="workspace-object-code">{file.content.slice(0, 12000)}</pre>;
}

function officePreviewLabel(kind: string) {
  if (kind === 'spreadsheet') return '表格文件';
  if (kind === 'presentation') return '演示文稿';
  return '文档文件';
}

export function UploadedDataUrlPreview({
  kind,
  dataUrl,
  title,
  mimeType,
  reference,
}: {
  kind: 'image' | 'pdf';
  dataUrl: string;
  title: string;
  mimeType?: string;
  reference?: SciForgeReference;
}) {
  const [objectUrl, setObjectUrl] = useState('');
  const [regionPick, setRegionPick] = useState<RegionPickState | null>(null);
  const [pickedRegion, setPickedRegion] = useState<string>('');
  const regionRef = useRef<HTMLDivElement | null>(null);
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
      {regionPick ? <span className="workspace-object-region-box" style={regionStyle(regionPick)} /> : null}
      {pickedRegion ? <span className="workspace-object-region-label">{pickedRegion}</span> : null}
    </div>
  ) : null;

  if (kind === 'image') {
    return (
      <div className="workspace-object-image-frame" data-sciforge-reference={sciForgeReferenceAttribute(reference)}>
        <img src={dataUrl} alt={title} />
        {regionLayer}
        <PreviewReferenceHint reference={reference} label="点选图片或拖选区域作为图像上下文" onPickRegion={reference ? beginRegionPick : undefined} />
      </div>
    );
  }
  return (
    <div className="workspace-object-pdf-shell" data-sciforge-reference={sciForgeReferenceAttribute(reference)}>
      <object className="workspace-object-pdf-frame" data={objectUrl || dataUrl} type={mimeType || 'application/pdf'} aria-label={title}>
        <iframe className="workspace-object-pdf-frame" title={title} src={objectUrl || dataUrl} />
      </object>
      {regionLayer}
      <PreviewReferenceHint reference={reference} label="点选整份 PDF，或拖选页面区域作为上下文" onPickRegion={reference ? beginRegionPick : undefined} />
    </div>
  );

  function beginRegionPick() {
    setPickedRegion('');
    setRegionPick({ active: false, x: 0, y: 0, width: 0, height: 0 });
  }

  function startRegionPick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!regionPick || !regionRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = regionRef.current.getBoundingClientRect();
    const startX = clamp01((event.clientX - bounds.left) / bounds.width);
    const startY = clamp01((event.clientY - bounds.top) / bounds.height);
    setRegionPick({ active: true, x: startX, y: startY, width: 0, height: 0, originX: startX, originY: startY });
    function move(pointerEvent: MouseEvent) {
      const currentX = clamp01((pointerEvent.clientX - bounds.left) / bounds.width);
      const currentY = clamp01((pointerEvent.clientY - bounds.top) / bounds.height);
      const x = Math.min(startX, currentX);
      const y = Math.min(startY, currentY);
      setRegionPick({ active: true, x, y, width: Math.abs(currentX - startX), height: Math.abs(currentY - startY), originX: startX, originY: startY });
    }
    function up(pointerEvent: MouseEvent) {
      move(pointerEvent);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const endX = clamp01((pointerEvent.clientX - bounds.left) / bounds.width);
      const endY = clamp01((pointerEvent.clientY - bounds.top) / bounds.height);
      const x = Math.min(startX, endX);
      const y = Math.min(startY, endY);
      const width = Math.abs(endX - startX);
      const height = Math.abs(endY - startY);
      if (width < 0.01 || height < 0.01) {
        setRegionPick(null);
        return;
      }
      const region = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(width * 1000)},${Math.round(height * 1000)}`;
      setPickedRegion(`region ${region}`);
      setRegionPick({ active: false, x, y, width, height });
      void navigator.clipboard?.writeText(JSON.stringify(withRegionLocator(reference, region), null, 2));
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }
}

type RegionPickState = {
  active: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  originX?: number;
  originY?: number;
};

function PreviewReferenceHint({
  reference,
  label,
  onPickRegion,
}: {
  reference?: SciForgeReference;
  label: string;
  onPickRegion?: () => void;
}) {
  return (
    <div className="workspace-object-reference-hint">
      <span>{label}</span>
      <div>
        {onPickRegion ? <button type="button" onClick={onPickRegion}>区域选择</button> : null}
        {reference ? <button type="button" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(reference, null, 2))}>复制引用</button> : null}
      </div>
    </div>
  );
}

function regionStyle(region: RegionPickState) {
  return {
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.width * 100}%`,
    height: `${region.height * 100}%`,
  };
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function referenceForWorkspaceFile(file: WorkspaceFileContent, kind: SciForgeReference['kind'] = 'file'): SciForgeReference {
  return referenceForWorkspaceFileLike(file, kind);
}

function DelimitedTextPreview({ content, delimiter }: { content: string; delimiter: ',' | '\t' }) {
  const rows = content.split(/\r?\n/).filter(Boolean).slice(0, 12).map((line) => line.split(delimiter).slice(0, 8));
  if (!rows.length) return <p className="empty-state">表格文件为空。</p>;
  return (
    <div className="data-table-wrap compact">
      <table className="data-preview-table">
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${rowIndex}-${row.join('|')}`}>
              {row.map((cell, cellIndex) => rowIndex === 0 ? (
                <th key={`${cellIndex}-${cell}`}>{cell}</th>
              ) : (
                <td key={`${cellIndex}-${cell}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatJsonLike(content: string) {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content.slice(0, 12000);
  }
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 1024) return `${value || 0} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
