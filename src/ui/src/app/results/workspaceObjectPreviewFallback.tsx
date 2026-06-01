import { Eye, Sparkles } from 'lucide-react';
import type { PresentationInput } from '@sciforge-ui/runtime-contract';
import type { ObjectReference, PreviewDescriptor, RuntimeArtifact, SciForgeConfig, SciForgeReference, SciForgeSession } from '../../domain';
import type { UserActionApi } from '../projectionApi';
import type { ArtifactPreviewHydrationApi } from './artifactPreviewHydrationApi';
import { Badge } from '../uiPrimitives';
import { PreviewDescriptorActions } from './PreviewActions';
import { descriptorNeedsManualPreviewLoad, useWorkspaceDescriptorPreviewLoad } from './workspaceDescriptorPreviewLoad';
import { UploadedDataUrlPreview } from './workspaceObjectPreviewMedia';
import { WorkspaceFileInlineViewer } from './workspaceFileInlineViewer';
import { boundedRightPaneText, rightPaneInlineLabel } from './previewSafety';
import { resultText, type ResultLocale } from './resultLocale';
import {
  referenceForObjectReference,
  sciForgeReferenceAttribute,
} from '../../../../../packages/support/object-references';

export type WorkspacePreviewPackageRequestHandler = (
  reference: ObjectReference,
  path?: string,
  descriptor?: PreviewDescriptor,
) => void;

export function ArtifactFallbackPreview({
  reference,
  artifact,
  path,
  diagnostic,
  reason,
  locale,
  onRequest,
}: {
  reference: ObjectReference;
  artifact?: RuntimeArtifact;
  path?: string;
  diagnostic?: string;
  reason: 'missing-path' | 'read-failed' | 'inline-data';
  locale?: ResultLocale;
  onRequest?: WorkspacePreviewPackageRequestHandler;
}) {
  const title = artifactFallbackTitle(reference, artifact, path);
  const fallbackReference = referenceForObjectReference({
    ...reference,
    title,
    ref: `${reference.kind}:preview-unavailable`,
    summary: resultText(locale, { 'zh-CN': '预览不可用', 'en-US': 'Preview unavailable' }),
    provenance: undefined,
  });
  return (
    <div className="workspace-object-preview" data-sciforge-reference={sciForgeReferenceAttribute(fallbackReference)}>
      <div className="workspace-object-preview-head">
        <Badge variant="warning">{resultText(locale, { 'zh-CN': '预览不可用', 'en-US': 'Preview unavailable' })}</Badge>
        <strong>{rightPaneInlineLabel(title)}</strong>
      </div>
      <p>{artifactFallbackReasonLabel(reason, locale)}</p>
      <p className="muted-inline">{resultText(locale, { 'zh-CN': '此项仍附加在对话中，可继续跟进。', 'en-US': 'This item is still attached to the conversation for follow-up.' })}</p>
      <p>{resultText(locale, { 'zh-CN': '这个结果仍可在对话中使用。预览问题只影响此侧边面板。', 'en-US': 'This result is still available to use in the conversation. The preview issue only affects this side panel.' })}</p>
      {diagnostic ? <PreviewDiagnosticFold diagnostic={diagnostic} locale={locale} /> : null}
      {path ? (
        <UnsupportedPreviewPackageNotice
          reference={reference}
          path={path}
          locale={locale}
          onRequest={onRequest}
        />
      ) : null}
    </div>
  );
}

export function PresentationInputNotice({
  reference,
  input,
  path,
  locale,
  onRequest,
}: {
  reference: ObjectReference;
  input: PresentationInput;
  path?: string;
  locale?: ResultLocale;
  onRequest?: WorkspacePreviewPackageRequestHandler;
}) {
  return (
    <div className="workspace-object-preview" data-sciforge-reference={sciForgeReferenceAttribute(referenceForObjectReference(reference))}>
      <div className="workspace-object-preview-head">
        <Badge variant={input.kind === 'binary' ? 'info' : 'warning'}>{input.kind === 'binary' ? resultText(locale, { 'zh-CN': '外部打开', 'en-US': 'Open externally' }) : resultText(locale, { 'zh-CN': '预览不可用', 'en-US': 'Preview unavailable' })}</Badge>
        <strong>{rightPaneInlineLabel(input.title || path || reference.title)}</strong>
      </div>
      {input.kind === 'unsupported' ? (
        <p>{resultText(locale, { 'zh-CN': '此结果暂时无法内联预览。', 'en-US': 'This result cannot be previewed inline yet.' })}</p>
      ) : input.kind === 'binary' ? (
        <p>{resultText(locale, { 'zh-CN': '此文件更适合用系统应用打开。内联预览会保持简洁。', 'en-US': 'This file is better opened with the system app. Inline preview stays compact.' })}</p>
      ) : (
        <p>{resultText(locale, { 'zh-CN': '此结果已附加，但不会内联显示。', 'en-US': 'This result is attached, but it is not shown inline.' })}</p>
      )}
      {path || input.rawRef ? <p className="muted-inline">{resultText(locale, { 'zh-CN': '源材料可从运行详情查看。', 'en-US': 'Source material is available from run details.' })}</p> : null}
      {path ? <UnsupportedPreviewPackageNotice reference={reference} path={path} locale={locale} onRequest={onRequest} /> : null}
    </div>
  );
}

export function DescriptorPreview({
  descriptor,
  config,
  reference,
  objectReference,
  objectReferences,
  session,
  userActionApi,
  hydrationApi,
  locale,
  onObjectReferenceFocus,
}: {
  descriptor: PreviewDescriptor;
  config: SciForgeConfig;
  reference: SciForgeReference;
  objectReference: ObjectReference;
  objectReferences: ObjectReference[];
  session: SciForgeSession;
  userActionApi: UserActionApi;
  hydrationApi: ArtifactPreviewHydrationApi;
  locale?: ResultLocale;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
}) {
  const {
    derivedFile,
    derivedLabel,
    derivedError,
    derivedLoading,
    needsManualLoad,
    requestLoad,
  } = useWorkspaceDescriptorPreviewLoad({
    descriptor,
    config,
    session,
    reference: objectReference,
    userActionApi,
    hydrationApi,
  });

  if ((descriptor.kind === 'pdf' || descriptor.kind === 'image') && descriptor.rawUrl) {
    return (
      <UploadedDataUrlPreview
        kind={descriptor.kind}
        dataUrl={descriptor.rawUrl}
        title={descriptor.title || descriptor.ref}
        mimeType={descriptor.mimeType}
        reference={reference}
        locale={locale}
      />
    );
  }
  if (descriptor.kind === 'markdown' || descriptor.kind === 'text' || descriptor.kind === 'json' || descriptor.kind === 'table' || descriptor.kind === 'html') {
    return (
      <div className="workspace-object-media-note">
        <p>{needsManualLoad
          ? resultText(locale, { 'zh-CN': '大文件预览。需要在这里检查结果时，可加载可读预览。', 'en-US': 'Large file preview. Load a readable preview when you need to inspect this result here.' })
          : resultText(locale, { 'zh-CN': '正在预览已保存的结果内容。', 'en-US': 'Previewing saved result content.' })}</p>
        {needsManualLoad && !derivedFile ? (
          <button
            type="button"
            className="workspace-object-load-preview-action"
            onClick={() => void requestLoad()}
            disabled={derivedLoading}
          >
            <Eye size={14} />
            {derivedLoading
              ? resultText(locale, { 'zh-CN': '正在加载预览', 'en-US': 'Loading preview' })
              : resultText(locale, { 'zh-CN': '加载预览', 'en-US': 'Load preview' })}
          </button>
        ) : null}
        {derivedLoading ? <p>{resultText(locale, { 'zh-CN': '正在生成或读取预览...', 'en-US': 'Generating or reading preview...' })}</p> : null}
        {derivedFile ? (
          <div className="descriptor-derived-preview">
            <Badge variant="info">{derivedLabel}</Badge>
            <WorkspaceFileInlineViewer
              file={derivedFile}
              objectReferences={objectReferences}
              locale={locale}
              onObjectReferenceFocus={onObjectReferenceFocus}
            />
          </div>
        ) : null}
        {derivedError ? <PreviewDiagnosticFold diagnostic={derivedError} locale={locale} /> : null}
        <PreviewDescriptorActions descriptor={descriptor} reference={reference} locale={locale} />
      </div>
    );
  }
  return (
    <div className="workspace-object-media-note">
      <p>{userPreviewNoticeForDescriptor(descriptor, locale)}</p>
      <PreviewDescriptorActions descriptor={descriptor} reference={reference} locale={locale} />
    </div>
  );
}

export function UnsupportedPreviewPackageNotice({
  reference,
  path,
  descriptor,
  diagnostic,
  locale,
  onRequest,
}: {
  reference: ObjectReference;
  path?: string;
  descriptor?: PreviewDescriptor;
  diagnostic?: string;
  locale?: ResultLocale;
  onRequest?: WorkspacePreviewPackageRequestHandler;
}) {
  const notice = unsupportedPreviewNoticeForUser({ reference, path, descriptor, locale });
  return (
    <div className="unsupported-preview-package">
      <p>{notice.message}</p>
      <div className="source-list">
        {notice.codeLabels.map((label) => <code key={label}>{rightPaneInlineLabel(label)}</code>)}
      </div>
      {diagnostic ? <PreviewDiagnosticFold diagnostic={diagnostic} locale={locale} /> : null}
      <button
        type="button"
        className="unsupported-preview-package-action"
        onClick={() => onRequest?.(reference, path, descriptor)}
        disabled={!onRequest}
      >
        <Sparkles size={14} />
        {notice.requestLabel}
      </button>
    </div>
  );
}

export function PreviewDiagnosticFold({ diagnostic, locale }: { diagnostic: string; locale?: ResultLocale }) {
  return (
    <details className="message-fold depth-3 workspace-object-diagnostic-fold">
      <summary>{resultText(locale, { 'zh-CN': '预览详情', 'en-US': 'Preview details' })}</summary>
      <pre className="workspace-object-code">{boundedRightPaneText(diagnostic, 4_000)}</pre>
    </details>
  );
}

export function formatWorkspaceObjectPreviewBytes(value: number) {
  if (!Number.isFinite(value) || value < 1024) return `${value || 0} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function artifactFallbackReasonLabel(reason: 'missing-path' | 'read-failed' | 'inline-data', locale?: ResultLocale) {
  if (reason === 'missing-path') return resultText(locale, { 'zh-CN': '预览不可用：此结果没有附加可读取文件。', 'en-US': 'Preview unavailable: no readable file is attached to this result.' });
  if (reason === 'inline-data') return resultText(locale, { 'zh-CN': '预览不可用：此结果没有可读取交付文件。', 'en-US': 'Preview unavailable: this result does not include a readable delivery file.' });
  return resultText(locale, { 'zh-CN': '预览不可用：已保存文件无法在这里打开。', 'en-US': 'Preview unavailable: the saved file could not be opened here.' });
}

function userPreviewNoticeForDescriptor(descriptor: PreviewDescriptor, locale?: ResultLocale) {
  if (descriptorNeedsManualPreviewLoad(descriptor)) {
    return resultText(locale, { 'zh-CN': '大文件预览。需要在这里检查结果时，可加载可读预览。', 'en-US': 'Large file preview. Load a readable preview when you need to inspect this result here.' });
  }
  return resultText(locale, {
    'zh-CN': `无法预览此${userPreviewKindLabel(descriptor.kind, locale)}。你仍可将它作为结果引用使用。`,
    'en-US': `Preview unavailable for this ${userPreviewKindLabel(descriptor.kind, locale)}. You can still use it as a result reference.`,
  });
}

function unsupportedPreviewNoticeForUser(input: {
  reference: Pick<ObjectReference, 'ref' | 'artifactType'>;
  path?: string;
  descriptor?: PreviewDescriptor;
  locale?: ResultLocale;
}) {
  const kindLabel = userPreviewKindLabel(input.descriptor?.kind || input.reference.artifactType, input.locale);
  const codeLabels = [
    input.path || input.descriptor?.ref || input.reference.ref,
    input.descriptor?.mimeType,
  ].filter((label): label is string => Boolean(label));
  return {
    message: resultText(input.locale, {
      'zh-CN': `无法预览此${kindLabel}。你仍可将它作为结果引用使用。`,
      'en-US': `Preview unavailable for this ${kindLabel}. You can still use it as a result reference.`,
    }),
    requestLabel: resultText(input.locale, { 'zh-CN': '请求预览支持', 'en-US': 'Request preview support' }),
    codeLabels,
  };
}

function userPreviewKindLabel(kind: string | undefined, locale?: ResultLocale) {
  if (kind === 'pdf') return 'PDF';
  if (kind === 'image') return resultText(locale, { 'zh-CN': '图像', 'en-US': 'image' });
  if (kind === 'table') return resultText(locale, { 'zh-CN': '表格', 'en-US': 'table' });
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'html') return resultText(locale, { 'zh-CN': '文档', 'en-US': 'document' });
  if (kind === 'presentation') return resultText(locale, { 'zh-CN': '演示文稿', 'en-US': 'presentation' });
  if (kind === 'spreadsheet') return resultText(locale, { 'zh-CN': '电子表格', 'en-US': 'spreadsheet' });
  if (kind === 'document') return resultText(locale, { 'zh-CN': '文档', 'en-US': 'document' });
  return resultText(locale, { 'zh-CN': '文件', 'en-US': 'file' });
}

function artifactFallbackTitle(reference: ObjectReference, artifact?: RuntimeArtifact, path?: string) {
  const metadataTitle = typeof artifact?.metadata?.title === 'string' ? artifact.metadata.title : undefined;
  const metadataName = typeof artifact?.metadata?.name === 'string' ? artifact.metadata.name : undefined;
  return metadataTitle || metadataName || reference.title || path || artifact?.id || reference.ref;
}
