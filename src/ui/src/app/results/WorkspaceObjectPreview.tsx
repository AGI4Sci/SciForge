import { useMemo } from 'react';
import type { SciForgeConfig, SciForgeSession, ObjectReference, PreviewDescriptor, RuntimeArtifact } from '../../domain';
import { Badge } from '../uiPrimitives';
import {
  fileKindForPath,
  uploadedArtifactPreview,
} from './previewDescriptor';
import { createWorkspacePreviewHydrationApi, type ArtifactPreviewHydrationApi } from './artifactPreviewHydrationApi';
import { rightPaneInlineLabel } from './previewSafety';
import { resultLocale, resultText, type ResultLocale } from './resultLocale';
import { resolvePresentationInputForArtifact } from '../../../../../packages/presentation/interactive-views';
import { createLocalUserActionApi, type UserActionApi } from '../projectionApi';
import {
  subagentPreviewForReference,
} from './workspaceObjectPreviewModel';
import { workspaceObjectPreviewRoute } from './workspaceObjectPreviewRouteModel';
import { SubagentArtifactPreview } from './workspaceObjectPreviewSubagentAdapter';
import {
  ArtifactFallbackPreview,
  DescriptorPreview,
  PresentationInputNotice,
  UnsupportedPreviewPackageNotice,
  formatWorkspaceObjectPreviewBytes,
} from './workspaceObjectPreviewFallback';
import {
  UploadedDataUrlPreview,
} from './workspaceObjectPreviewMedia';
import { WorkspaceFileInlineViewer } from './workspaceFileInlineViewer';
import { useWorkspaceObjectPreviewHydration } from './workspaceObjectPreviewHydration';
import {
  artifactForObjectReference,
  pathForObjectReference,
  sciForgeReferenceAttribute,
  mergeObjectReferences,
  objectReferenceForArtifactSummary,
} from '../../../../../packages/support/object-references';

export { UploadedDataUrlPreview } from './workspaceObjectPreviewMedia';
export { WorkspaceFileInlineViewer } from './workspaceFileInlineViewer';

export function WorkspaceObjectPreview({
  reference,
  session,
  config,
  locale: localeProp,
  onPreviewPackageRequest,
  onObjectReferenceFocus,
  userActionApi,
  hydrationApi,
}: {
  reference: ObjectReference;
  session: SciForgeSession;
  config: SciForgeConfig;
  locale?: ResultLocale;
  onPreviewPackageRequest?: (reference: ObjectReference, path?: string, descriptor?: PreviewDescriptor) => void;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
  userActionApi?: UserActionApi;
  hydrationApi?: ArtifactPreviewHydrationApi;
}) {
  const locale = resultLocale(localeProp ?? config.locale);
  const artifact = artifactForObjectReference(reference, session);
  const objectReferences = useMemo(() => workspacePreviewObjectReferences(session, reference, artifact), [artifact, reference, session]);
  const inlinePreview = useMemo(() => uploadedArtifactPreview(artifact), [artifact]);
  const presentationInput = useMemo(() => resolvePresentationInputForArtifact(artifact), [artifact]);
  const path = presentationInput?.ref ?? pathForObjectReference(reference, session);
  const subagentPreview = useMemo(() => subagentPreviewForReference(session, reference), [reference.ref, session]);
  const resolvedUserActionApi = useMemo(() => userActionApi ?? createLocalUserActionApi(), [userActionApi]);
  const resolvedHydrationApi = useMemo(() => hydrationApi ?? createWorkspacePreviewHydrationApi(), [hydrationApi]);
  const { descriptor, file, loadingPath, error } = useWorkspaceObjectPreviewHydration({
    artifact,
    config,
    hydrationApi: resolvedHydrationApi,
    inlinePreviewAvailable: Boolean(inlinePreview),
    path,
    presentationInputKind: presentationInput?.kind,
    referenceKind: reference.kind,
  });
  const route = workspaceObjectPreviewRoute({
    reference,
    path,
    inlinePreview,
    presentationInput,
    subagentPreview,
    loadingPath,
    error,
    descriptor,
    file,
  });

  if (route.kind === 'url') {
    const safeUrl = rightPaneInlineLabel(route.url);
    return (
      <div className="workspace-object-preview">
        <div className="workspace-object-preview-head">
          <Badge variant="info">url</Badge>
          <strong>{rightPaneInlineLabel(route.title)}</strong>
        </div>
        {route.href ? <a href={route.href} target="_blank" rel="noreferrer">{safeUrl}</a> : <code>{safeUrl}</code>}
      </div>
    );
  }
  if (route.kind === 'folder') {
    return (
      <div className="workspace-object-preview">
        <div className="workspace-object-preview-head">
          <Badge variant="info">folder</Badge>
          <strong>{rightPaneInlineLabel(route.label)}</strong>
        </div>
        <p>{resultText(locale, { 'zh-CN': '此项目文件夹已作为上下文附加。请在外部打开以查看内容。', 'en-US': 'This project folder is attached as context. Open it externally to inspect its contents.' })}</p>
      </div>
    );
  }
  if (route.kind === 'unsupported-reference') return null;
  if (route.kind === 'inline-preview') {
    return (
      <div className="workspace-object-preview" data-sciforge-reference={sciForgeReferenceAttribute(route.reference)}>
        <div className="workspace-object-preview-head">
          <Badge variant="info">{route.preview.kind}</Badge>
          <strong>{rightPaneInlineLabel(route.preview.title)}</strong>
          {route.preview.size ? <span>{formatWorkspaceObjectPreviewBytes(route.preview.size)}</span> : null}
        </div>
        <UploadedDataUrlPreview
          kind={route.preview.kind}
          dataUrl={route.preview.dataUrl}
          title={route.preview.title}
          mimeType={route.preview.mimeType}
          reference={route.reference}
          locale={locale}
        />
      </div>
    );
  }
  if (route.kind === 'presentation-input') {
    return (
      <PresentationInputNotice reference={reference} input={route.input} path={route.path} locale={locale} onRequest={onPreviewPackageRequest} />
    );
  }
  if (route.kind === 'subagent-preview') {
    return (
      <SubagentArtifactPreview
        preview={route.preview}
        reference={reference}
        locale={locale}
        onObjectReferenceFocus={onObjectReferenceFocus}
      />
    );
  }
  if (route.kind === 'unsafe-path') {
    return (
      <ArtifactFallbackPreview
        reference={route.reference}
        artifact={artifact}
        diagnostic={resultText(locale, { 'zh-CN': '此文件无法在这里预览。', 'en-US': 'This file cannot be previewed from here.' })}
        reason="read-failed"
        locale={locale}
        onRequest={onPreviewPackageRequest}
      />
    );
  }
  if (route.kind === 'missing-path') {
    return (
      <ArtifactFallbackPreview
        reference={reference}
        artifact={artifact}
        reason="missing-path"
        locale={locale}
      />
    );
  }
  if (route.kind === 'loading') {
    return (
      <div className="workspace-object-preview">
        <div className="workspace-object-preview-head">
          <Badge variant="muted">loading</Badge>
          <strong>{rightPaneInlineLabel(route.label)}</strong>
        </div>
        <p>{resultText(locale, { 'zh-CN': '正在读取工作区文件内容...', 'en-US': 'Reading workspace file content...' })}</p>
      </div>
    );
  }
  if (route.kind === 'error') {
    return (
      <ArtifactFallbackPreview
        reference={reference}
        artifact={artifact}
        path={route.path}
        diagnostic={route.diagnostic}
        reason="read-failed"
        locale={locale}
        onRequest={onPreviewPackageRequest}
      />
    );
  }
  if (route.kind === 'descriptor') {
    return (
      <div className="workspace-object-preview" data-sciforge-reference={sciForgeReferenceAttribute(route.reference)}>
        <div className="workspace-object-preview-head">
          <Badge variant="info">{route.descriptor.kind}</Badge>
          <strong>{rightPaneInlineLabel(route.descriptor.title || route.descriptor.ref)}</strong>
          {route.descriptor.sizeBytes !== undefined ? <span>{formatWorkspaceObjectPreviewBytes(route.descriptor.sizeBytes)}</span> : null}
        </div>
        {route.needsPackage ? (
          <UnsupportedPreviewPackageNotice
            reference={reference}
            path={path}
            descriptor={route.descriptor}
            locale={locale}
            onRequest={onPreviewPackageRequest}
          />
        ) : (
          <DescriptorPreview
            descriptor={route.descriptor}
            config={config}
            reference={route.reference}
            objectReference={reference}
            objectReferences={objectReferences}
            session={session}
            userActionApi={resolvedUserActionApi}
            hydrationApi={resolvedHydrationApi}
            locale={locale}
            onObjectReferenceFocus={onObjectReferenceFocus}
          />
        )}
      </div>
    );
  }
  return (
    <div className="workspace-object-preview" data-sciforge-reference={sciForgeReferenceAttribute(route.reference)}>
      <div className="workspace-object-preview-head">
        <Badge variant="info">{route.file.language || fileKindForPath(route.file.path)}</Badge>
        <strong>{rightPaneInlineLabel(route.file.path)}</strong>
        <span>{formatWorkspaceObjectPreviewBytes(route.file.size)}</span>
      </div>
      <WorkspaceFileInlineViewer
        file={route.file}
        objectReferences={objectReferences}
        locale={locale}
        onObjectReferenceFocus={onObjectReferenceFocus}
      />
    </div>
  );
}

function workspacePreviewObjectReferences(
  session: SciForgeSession,
  currentReference: ObjectReference,
  artifact: RuntimeArtifact | undefined,
): ObjectReference[] {
  const artifactReferences = session.artifacts.map((item) => objectReferenceForArtifactSummary(item, String(item.metadata?.runId ?? '')));
  const currentArtifactReference = artifact ? [objectReferenceForArtifactSummary(artifact, String(artifact.metadata?.runId ?? ''))] : [];
  return mergeObjectReferences([
    currentReference,
    ...currentArtifactReference,
    ...session.messages.flatMap((message) => message.objectReferences ?? []),
    ...session.runs.flatMap((run) => run.objectReferences ?? []),
    ...artifactReferences,
  ], [], 100);
}
