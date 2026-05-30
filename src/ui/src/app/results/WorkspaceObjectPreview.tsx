import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Eye, Sparkles } from 'lucide-react';
import type { SciForgeConfig, SciForgeReference, SciForgeSession, ObjectReference, PreviewDescriptor, RuntimeArtifact } from '../../domain';
import type { WorkspaceFileContent } from '../../api/workspaceClient';
import { Badge, cx } from '../uiPrimitives';
import { MarkdownBlock } from './reportContent';
import { PreviewDescriptorActions } from './PreviewActions';
import {
  descriptorCanUseWorkspacePreview,
  fileKindForPath,
  previewNeedsPackage,
  uploadedArtifactPreview,
} from './previewDescriptor';
import { createWorkspacePreviewHydrationApi, type ArtifactPreviewHydrationApi } from './artifactPreviewHydrationApi';
import { boundedRightPaneText, formatRightPanePreviewJson, rightPaneInlineLabel, rightPaneTextIsSensitive } from './previewSafety';
import { resultLocale, resultText, type ResultLocale } from './resultLocale';
import { resolvePresentationInputForArtifact } from '../../../../../packages/presentation/interactive-views';
import { createLocalUserActionApi, type UserActionApi } from '../projectionApi';
import {
  artifactForObjectReference,
  pathForObjectReference,
  sciForgeReferenceAttribute,
  referenceForObjectReference,
  referenceKindForWorkspaceFileLike,
  referenceKindForWorkspacePreviewKind,
  referenceForWorkspaceFileLike,
  mergeObjectReferences,
  objectReferenceForArtifactSummary,
  withRegionLocator,
} from '../../../../../packages/support/object-references';

const WORKSPACE_OBJECT_INLINE_PREVIEW_LIMIT_BYTES = 1024 * 1024;

export function canHydrateWorkspaceObjectPath(value: string | undefined) {
  const path = value?.trim().replace(/\\/g, '/');
  if (!path) return false;
  if (/^(?:\/|[A-Za-z]:\/|~\/?)/.test(path) || path.includes('://')) return false;
  if (/[\r\n\t<>|?*:]/.test(path)) return false;
  if (path.split('/').some((part) => part === '..')) return false;
  if (/^(?:Users|Applications|Volumes|private|var|tmp)(?:\/|$)/i.test(path)) return false;
  if (/^\.sciforge\//i.test(path) && !/^\.sciforge\/artifacts\//i.test(path)) return false;
  if (/(?:^|\/)(?:audit|logs?|stdout|stderr|raw)(?:\/|\.|$)/i.test(path)) return false;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(path)) return false;
  return true;
}

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
  const previewConfig = useMemo(() => config, [config.workspacePath, config.workspaceWriterBaseUrl]);
  const resolvedUserActionApi = useMemo(() => userActionApi ?? createLocalUserActionApi(), [userActionApi]);
  const resolvedHydrationApi = useMemo(() => hydrationApi ?? createWorkspacePreviewHydrationApi(), [hydrationApi]);
  const [descriptor, setDescriptor] = useState<PreviewDescriptor | undefined>();
  const [file, setFile] = useState<WorkspaceFileContent | undefined>();
  const [loadingPath, setLoadingPath] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setFile(undefined);
    setDescriptor(undefined);
    setError('');
    if (inlinePreview) return undefined;
    if (presentationInput?.kind === 'binary' || presentationInput?.kind === 'unsupported') return undefined;
    if (!path || (reference.kind !== 'file' && reference.kind !== 'artifact') || !canHydrateWorkspaceObjectPath(path)) return undefined;
    let cancelled = false;
    setLoadingPath(path);
    void resolvedHydrationApi.hydrateWorkspaceObjectPreview({ artifact, path, config: previewConfig })
      .then((hydration) => {
        if (cancelled) return;
        if (hydration.staticDescriptor) setDescriptor(hydration.staticDescriptor);
        if (hydration.descriptor) setDescriptor(hydration.descriptor);
        if (hydration.file) setFile(hydration.file);
        if (hydration.error) setError(hydration.error);
      })
      .finally(() => {
        if (!cancelled) setLoadingPath('');
      });
    return () => {
      cancelled = true;
    };
  }, [artifact, inlinePreview, path, previewConfig, presentationInput?.kind, reference.kind, resolvedHydrationApi]);

  if (reference.kind === 'url') {
    const url = reference.ref.replace(/^url:/i, '');
    const safeUrl = rightPaneInlineLabel(url);
    const href = safeExternalPreviewHref(url);
    return (
      <div className="workspace-object-preview">
        <div className="workspace-object-preview-head">
          <Badge variant="info">url</Badge>
          <strong>{rightPaneInlineLabel(reference.title)}</strong>
        </div>
        {href ? <a href={href} target="_blank" rel="noreferrer">{safeUrl}</a> : <code>{safeUrl}</code>}
      </div>
    );
  }
  if (reference.kind === 'folder') {
    return (
      <div className="workspace-object-preview">
        <div className="workspace-object-preview-head">
          <Badge variant="info">folder</Badge>
          <strong>{rightPaneInlineLabel(path || reference.ref)}</strong>
        </div>
        <p>{resultText(locale, { 'zh-CN': '此项目文件夹已作为上下文附加。请在外部打开以查看内容。', 'en-US': 'This project folder is attached as context. Open it externally to inspect its contents.' })}</p>
      </div>
    );
  }
  if (reference.kind !== 'file' && reference.kind !== 'artifact') return null;
  if (inlinePreview) {
    const previewReference = referenceForObjectReference(reference, referenceKindForWorkspacePreviewKind(inlinePreview.kind));
    return (
      <div className="workspace-object-preview" data-sciforge-reference={sciForgeReferenceAttribute(previewReference)}>
        <div className="workspace-object-preview-head">
          <Badge variant="info">{inlinePreview.kind}</Badge>
          <strong>{rightPaneInlineLabel(inlinePreview.title)}</strong>
          {inlinePreview.size ? <span>{formatBytes(inlinePreview.size)}</span> : null}
        </div>
        <UploadedDataUrlPreview
          kind={inlinePreview.kind}
          dataUrl={inlinePreview.dataUrl}
          title={inlinePreview.title}
          mimeType={inlinePreview.mimeType}
          reference={previewReference}
          locale={locale}
        />
      </div>
    );
  }
  if (presentationInput?.kind === 'binary' || presentationInput?.kind === 'unsupported') {
    return (
      <PresentationInputNotice reference={reference} input={presentationInput} path={path} locale={locale} onRequest={onPreviewPackageRequest} />
    );
  }
  if (subagentPreview) {
    return (
      <SubagentArtifactPreview
        preview={subagentPreview}
        reference={reference}
        locale={locale}
        onObjectReferenceFocus={onObjectReferenceFocus}
      />
    );
  }
  if (path && (reference.kind === 'file' || reference.kind === 'artifact') && !canHydrateWorkspaceObjectPath(path)) {
    return (
      <ArtifactFallbackPreview
        reference={redactedUnsafeWorkspacePreviewReference(reference)}
        artifact={artifact}
        diagnostic={resultText(locale, { 'zh-CN': '此文件无法在这里预览。', 'en-US': 'This file cannot be previewed from here.' })}
        reason="read-failed"
        locale={locale}
        onRequest={onPreviewPackageRequest}
      />
    );
  }
  if (!path) {
    return (
      <ArtifactFallbackPreview
        reference={reference}
        artifact={artifact}
        reason="missing-path"
        locale={locale}
      />
    );
  }
  if (loadingPath) {
    return (
      <div className="workspace-object-preview">
        <div className="workspace-object-preview-head">
          <Badge variant="muted">loading</Badge>
          <strong>{rightPaneInlineLabel(loadingPath)}</strong>
        </div>
        <p>{resultText(locale, { 'zh-CN': '正在读取工作区文件内容...', 'en-US': 'Reading workspace file content...' })}</p>
      </div>
    );
  }
  if (error) {
    return (
      <ArtifactFallbackPreview
        reference={reference}
        artifact={artifact}
        path={path}
        diagnostic={error}
        reason="read-failed"
        locale={locale}
        onRequest={onPreviewPackageRequest}
      />
    );
  }
  if (descriptor) {
    const descriptorReference = referenceForObjectReference(reference, referenceKindForWorkspacePreviewKind(descriptor.kind));
    return (
      <div className="workspace-object-preview" data-sciforge-reference={sciForgeReferenceAttribute(descriptorReference)}>
        <div className="workspace-object-preview-head">
          <Badge variant="info">{descriptor.kind}</Badge>
          <strong>{rightPaneInlineLabel(descriptor.title || descriptor.ref)}</strong>
          {descriptor.sizeBytes !== undefined ? <span>{formatBytes(descriptor.sizeBytes)}</span> : null}
        </div>
        {previewNeedsPackage(descriptor) ? (
          <UnsupportedPreviewPackageNotice
            reference={reference}
            path={path}
            descriptor={descriptor}
            locale={locale}
            onRequest={onPreviewPackageRequest}
          />
        ) : (
          <DescriptorPreview
            descriptor={descriptor}
            config={config}
            reference={descriptorReference}
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
  if (!file) {
    return path ? (
      <div className="workspace-object-preview">
        <div className="workspace-object-preview-head">
          <Badge variant="muted">loading</Badge>
          <strong>{rightPaneInlineLabel(path)}</strong>
        </div>
        <p>{resultText(locale, { 'zh-CN': '正在读取工作区文件内容...', 'en-US': 'Reading workspace file content...' })}</p>
      </div>
    ) : null;
  }
  const fileReference = referenceForObjectReference(reference, referenceKindForWorkspaceFileLike(file));
  return (
    <div className="workspace-object-preview" data-sciforge-reference={sciForgeReferenceAttribute(fileReference)}>
      <div className="workspace-object-preview-head">
        <Badge variant="info">{file.language || fileKindForPath(file.path)}</Badge>
        <strong>{rightPaneInlineLabel(file.path)}</strong>
        <span>{formatBytes(file.size)}</span>
      </div>
      <WorkspaceFileInlineViewer
        file={file}
        objectReferences={objectReferences}
        locale={locale}
        onObjectReferenceFocus={onObjectReferenceFocus}
      />
    </div>
  );
}

interface SubagentArtifactPreviewModel {
  agentId?: string;
  parentAgentId?: string;
  status?: string;
  createdAt?: string;
  resultSummary?: string;
  resultRef?: string;
  transcriptRef?: string;
  refs: string[];
}

function SubagentArtifactPreview({
  preview,
  reference,
  locale,
  onObjectReferenceFocus,
}: {
  preview: SubagentArtifactPreviewModel;
  reference: ObjectReference;
  locale?: ResultLocale;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
}) {
  const safeTitle = preview.agentId ? resultText(locale, { 'zh-CN': '子任务结果', 'en-US': 'Subtask result' }) : reference.title || reference.ref;
  const summary = subagentPreviewSummary(preview.resultSummary, reference, locale);
  const refs = uniqueStrings([
    preview.resultRef,
    preview.transcriptRef,
    ...preview.refs,
  ].filter((ref): ref is string => typeof ref === 'string' && safeSubagentPreviewRef(ref)));
  return (
    <div className="workspace-object-preview" data-sciforge-reference={sciForgeReferenceAttribute(referenceForObjectReference(reference))}>
      <div className="workspace-object-preview-head">
        <Badge variant="info">{resultText(locale, { 'zh-CN': '子任务结果', 'en-US': 'Subtask result' })}</Badge>
        <strong>{rightPaneInlineLabel(safeTitle)}</strong>
        {preview.status ? <span>{rightPaneInlineLabel(preview.status)}</span> : null}
      </div>
      {refs.length ? (
        <div className="source-list">
          {refs.map((ref) => (
            onObjectReferenceFocus ? (
              <button
                type="button"
                key={ref}
                title={rightPaneInlineLabel(ref)}
                onClick={() => onObjectReferenceFocus(objectReferenceForSubagentPreviewRef(ref))}
              >
                {rightPaneInlineLabel(ref)}
              </button>
            ) : <code key={ref} title={rightPaneInlineLabel(ref)}>{rightPaneInlineLabel(ref)}</code>
          ))}
        </div>
      ) : null}
      {preview.createdAt ? <p className="muted-inline">{resultText(locale, { 'zh-CN': '完成于', 'en-US': 'Completed at' })} {rightPaneInlineLabel(preview.createdAt)}</p> : null}
      <p>{boundedRightPaneText(summary, 1600)}</p>
    </div>
  );
}

function redactedUnsafeWorkspacePreviewReference(reference: ObjectReference): ObjectReference {
  const label = reference.kind === 'file' ? 'file:[redacted-unsafe-preview-ref]' : 'artifact:[redacted-unsafe-preview-ref]';
  return {
    ...reference,
    title: label,
    ref: label,
    summary: 'Preview ref is outside the trusted workspace preview boundary.',
    provenance: undefined,
  };
}

function subagentPreviewSummary(value: string | undefined, reference: ObjectReference, locale?: ResultLocale) {
  const cleaned = cleanSubagentPreviewSummary(value);
  if (cleaned) return cleaned;
  return reference.ref.includes('transcript')
    ? resultText(locale, { 'zh-CN': '委托 worker transcript 引用如下。', 'en-US': 'Delegated worker transcript ref is available below.' })
    : resultText(locale, { 'zh-CN': '只读委托 worker 已完成；安全引用如下。', 'en-US': 'Read-only delegated worker completed; safe refs are available below.' });
}

function cleanSubagentPreviewSummary(value: string | undefined) {
  const text = stripTruncatedSubagentPreviewPromptTail(boundedRightPaneText(value ?? '', 1600)).trim();
  if (!text) return '';
  const segments = text
    .split(/(?:\r?\n|(?<=[.!?。！？])\s+)/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const cleaned = segments
    .filter((segment) => !isPromptEchoSubagentSummarySegment(segment))
    .join(' ')
    .trim();
  return cleaned === text && isPromptEchoSubagentSummarySegment(cleaned) ? '' : cleaned;
}

function stripTruncatedSubagentPreviewPromptTail(value: string) {
  return value.replace(/\s*\.\.\.\s*[^.!?。！？]{0,120}\bsubstitute\b[.!?。！？]?/gi, '');
}

function isPromptEchoSubagentSummarySegment(segment: string) {
  const text = segment.toLowerCase();
  return /\b(?:request|prompt|input)\s+summary\b/.test(text)
    || /\bdo not (?:edit|modify|write|use\s+(?:shell|ordinary|terminal)|use shell substitute)\b/.test(text)
    || /\bdo not use\b.*\bsubstitute\b/.test(text)
    || (/\bsubstitute\b/.test(text) && /(?:\.\.\.|shell|ordinary|terminal|do not|use)/.test(text))
    || /\bif (?:no|unavailable|current runtime lacks|there is no)\b/.test(text)
    || /^(?:read[-\s]?only|只读)\.?$/.test(text)
    || /^read\b.*\bonly\b\.?$/.test(text)
    || /^sub[-\s]?agent\s+reads?\b/.test(text)
    || /^delegated\s+worker\s+reads?\b/.test(text)
    || /^report\b.*\b(?:open difference|evidence refs?|refs needed|current status|todo)\b/.test(text)
    || /^main agent\b.*\bsummar/i.test(segment)
    || (/\bno_subagent_tool_available\b/.test(text) && /\b(?:if|prompt|request|summary)\b/.test(text));
}

function subagentPreviewForReference(session: SciForgeSession, reference: ObjectReference): SubagentArtifactPreviewModel | undefined {
  if (!/^artifact:subagent-(?:result|transcript)-[A-Za-z0-9_.:-]+$/i.test(reference.ref)) return undefined;
  for (const run of [...session.runs].reverse()) {
    for (const event of [...streamProcessEvents(run.raw)].reverse()) {
      const native = recordField(event.native);
      if (!native) continue;
      const refs = stringArrayField(native.refs);
      const resultRef = stringField(native.ref) ?? refs.find((ref) => /^artifact:subagent-result-/i.test(ref));
      const transcriptRef = stringField(native.transcriptRef) ?? refs.find((ref) => /^artifact:subagent-transcript-/i.test(ref));
      if (![resultRef, transcriptRef, ...refs].includes(reference.ref)) continue;
      return {
        agentId: stringField(native.agentId),
        parentAgentId: stringField(native.parentAgentId),
        status: stringField(native.status),
        createdAt: stringField(event.createdAt),
        resultSummary: stringField(native.resultSummary),
        resultRef,
        transcriptRef,
        refs,
      };
    }
  }
  return undefined;
}

function streamProcessEvents(raw: unknown): Record<string, unknown>[] {
  const record = recordField(raw);
  const process = recordField(record?.streamProcess);
  const events = process?.events;
  return Array.isArray(events) ? events.filter(recordField) : [];
}

function objectReferenceForSubagentPreviewRef(ref: string): ObjectReference {
  const kind = ref.startsWith('file:') ? 'file' : 'artifact';
  const title = ref.startsWith('file:') ? ref.slice('file:'.length) : ref;
  return {
    id: `subagent-preview-${ref.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 96)}`,
    title,
    kind,
    ref,
    status: 'available',
    actions: kind === 'artifact' ? ['inspect'] : ['focus-right-pane', 'inspect'],
    presentationRole: kind === 'artifact' ? 'audit' : 'supporting-evidence',
  };
}

function safeSubagentPreviewRef(ref: string) {
  const value = ref.trim();
  if (!value || rightPaneTextIsSensitive(value)) return false;
  if (value.startsWith('file:')) return canHydrateWorkspaceObjectPath(value.slice('file:'.length));
  if (!value.startsWith('artifact:')) return false;
  const artifactRef = value.slice('artifact:'.length).trim();
  if (!artifactRef || artifactRef.startsWith('/') || artifactRef.startsWith('~') || artifactRef.includes('://')) return false;
  if (/[\r\n\t<>|?*]/.test(artifactRef)) return false;
  if (artifactRef.split('/').some((part) => part === '..')) return false;
  if (/(?:^|\/)(?:\.sciforge|raw|provider|stdout|stderr|trace|tmp|private)(?:\/|$)/i.test(artifactRef)) return false;
  return true;
}

function safeExternalPreviewHref(value: string): string | undefined {
  if (rightPaneTextIsSensitive(value)) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function ArtifactFallbackPreview({
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
  onRequest?: (reference: ObjectReference, path?: string, descriptor?: PreviewDescriptor) => void;
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

function PresentationInputNotice({
  reference,
  input,
  path,
  locale,
  onRequest,
}: {
  reference: ObjectReference;
  input: NonNullable<ReturnType<typeof resolvePresentationInputForArtifact>>;
  path?: string;
  locale?: ResultLocale;
  onRequest?: (reference: ObjectReference, path?: string, descriptor?: PreviewDescriptor) => void;
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

function artifactFallbackReasonLabel(reason: 'missing-path' | 'read-failed' | 'inline-data', locale?: ResultLocale) {
  if (reason === 'missing-path') return resultText(locale, { 'zh-CN': '预览不可用：此结果没有附加可读取文件。', 'en-US': 'Preview unavailable: no readable file is attached to this result.' });
  if (reason === 'inline-data') return resultText(locale, { 'zh-CN': '预览不可用：此结果没有可读取交付文件。', 'en-US': 'Preview unavailable: this result does not include a readable delivery file.' });
  return resultText(locale, { 'zh-CN': '预览不可用：已保存文件无法在这里打开。', 'en-US': 'Preview unavailable: the saved file could not be opened here.' });
}

function DescriptorPreview({
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
  const previewConfig = useMemo(() => config, [config.workspacePath, config.workspaceWriterBaseUrl]);
  const descriptorLoadKey = `${descriptor.kind}:${descriptor.inlinePolicy}:${descriptor.sizeBytes ?? 'unknown'}:${descriptor.ref}`;
  const needsManualLoad = descriptorNeedsManualPreviewLoad(descriptor);
  const [derivedFile, setDerivedFile] = useState<WorkspaceFileContent | undefined>();
  const [derivedLabel, setDerivedLabel] = useState('');
  const [derivedError, setDerivedError] = useState('');
  const [derivedLoading, setDerivedLoading] = useState(false);
  const [requestedLoadKey, setRequestedLoadKey] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    if (!descriptorCanUseWorkspacePreview(descriptor)) {
      setDerivedFile(undefined);
      setDerivedLabel('');
      setDerivedError('');
      setDerivedLoading(false);
      return undefined;
    }
    if (needsManualLoad && requestedLoadKey !== descriptorLoadKey) {
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
    void hydrationApi.loadDescriptorPreviewFile({ descriptor, config: previewConfig })
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
  }, [descriptor, descriptorLoadKey, hydrationApi, loadAttempt, needsManualLoad, previewConfig, requestedLoadKey]);

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
            onClick={() => void requestManualArtifactPreviewLoad({
              session,
              reference: objectReference,
              userActionApi,
              byteLimit: WORKSPACE_OBJECT_INLINE_PREVIEW_LIMIT_BYTES,
            }).finally(() => {
              setRequestedLoadKey(descriptorLoadKey);
              setLoadAttempt((attempt) => attempt + 1);
            })}
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

export async function requestManualArtifactPreviewLoad(input: {
  session: SciForgeSession;
  reference: ObjectReference;
  userActionApi: Pick<UserActionApi, 'loadArtifactPreview'>;
  byteLimit?: number;
}) {
  if (input.reference.kind !== 'artifact') return undefined;
  return input.userActionApi.loadArtifactPreview({
    session: input.session,
    artifactRef: input.reference.ref,
    byteLimit: input.byteLimit,
  });
}

export function descriptorNeedsManualPreviewLoad(descriptor: PreviewDescriptor) {
  if (!descriptorCanUseWorkspacePreview(descriptor)) return false;
  if (descriptor.inlinePolicy !== 'inline') return true;
  return (descriptor.sizeBytes ?? 0) > WORKSPACE_OBJECT_INLINE_PREVIEW_LIMIT_BYTES;
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

function UnsupportedPreviewPackageNotice({
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
  onRequest?: (reference: ObjectReference, path?: string, descriptor?: PreviewDescriptor) => void;
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

function PreviewDiagnosticFold({ diagnostic, locale }: { diagnostic: string; locale?: ResultLocale }) {
  return (
    <details className="message-fold depth-3 workspace-object-diagnostic-fold">
      <summary>{resultText(locale, { 'zh-CN': '预览详情', 'en-US': 'Preview details' })}</summary>
      <pre className="workspace-object-code">{boundedRightPaneText(diagnostic, 4_000)}</pre>
    </details>
  );
}

export function WorkspaceFileInlineViewer({
  file,
  objectReferences = [],
  locale,
  onObjectReferenceFocus,
}: {
  file: WorkspaceFileContent;
  objectReferences?: ObjectReference[];
  locale?: ResultLocale;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
}) {
  const kind = fileKindForPath(file.path, file.language);
  const safeContent = boundedRightPaneText(file.content);
  if (kind === 'diff') {
    return (
      <div className="workspace-object-diff-preview">
        <pre className="workspace-object-code workspace-object-diff">{safeContent}</pre>
      </div>
    );
  }
  if (kind === 'markdown') {
    return (
      <MarkdownBlock
        markdown={safeContent}
        objectReferences={objectReferences}
        onObjectReferenceFocus={onObjectReferenceFocus}
      />
    );
  }
  if (kind === 'json') return <pre className="workspace-object-code">{formatJsonLike(file.content)}</pre>;
  if (kind === 'csv' || kind === 'tsv') return <DelimitedTextPreview content={safeContent} delimiter={kind === 'tsv' ? '\t' : ','} locale={locale} />;
  if (kind === 'image') {
    if (file.encoding === 'base64') {
      return (
        <div className="workspace-object-image-frame">
          <img src={`data:${file.mimeType || 'image/png'};base64,${file.content}`} alt={rightPaneInlineLabel(file.name)} />
        </div>
      );
    }
    return (
      <div className="workspace-object-media-note">
        {resultText(locale, { 'zh-CN': '图像已附加，但没有返回内联图像数据。请在外部打开查看。', 'en-US': 'This image is attached, but no inline image data was returned. Open it externally to inspect it.' })}
        <pre className="workspace-object-code">{boundedRightPaneText(file.content, 4_000)}</pre>
      </div>
    );
  }
  if (kind === 'pdf') {
    const pdfReference = referenceForWorkspaceFile(file);
    if (file.encoding === 'base64') {
      return (
        <UploadedDataUrlPreview
          kind="pdf"
          dataUrl={`data:${file.mimeType || 'application/pdf'};base64,${file.content}`}
          title={file.name}
          mimeType={file.mimeType || 'application/pdf'}
          reference={pdfReference}
          locale={locale}
        />
      );
    }
    return (
      <div className="workspace-object-media-note">
        <p>{resultText(locale, { 'zh-CN': 'PDF 已作为可点击文件引用附加。选择此卡片作为上下文后，可带页码、章节、图号或区域细节提问。', 'en-US': 'The PDF is attached as a clickable file reference. Select this card as context, then ask with page, section, figure, or region details.' })}</p>
        <div className="source-list">
          <code>{rightPaneInlineLabel(file.path)}</code>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(pdfReference, null, 2))}>{resultText(locale, { 'zh-CN': '复制 PDF 引用', 'en-US': 'Copy PDF reference' })}</button>
        </div>
      </div>
    );
  }
  if (kind === 'document' || kind === 'spreadsheet' || kind === 'presentation') {
    return (
      <div className="workspace-object-media-note">
        <p>{resultText(locale, {
          'zh-CN': `${officePreviewLabel(kind, locale)}已作为可点击文件引用附加。请在外部打开完整文件，或继续作为上下文保留。`,
          'en-US': `${officePreviewLabel(kind, locale)} is attached as a clickable file reference. Open it externally for the full file, or keep it attached as context.`,
        })}</p>
        <div className="source-list">
          <code>{rightPaneInlineLabel(file.path)}</code>
          <code>{rightPaneInlineLabel(file.mimeType || 'application/octet-stream')}</code>
        </div>
      </div>
    );
  }
  if (kind === 'html') return <pre className="workspace-object-code">{safeContent}</pre>;
  return <pre className="workspace-object-code">{safeContent}</pre>;
}

function officePreviewLabel(kind: string, locale?: ResultLocale) {
  if (kind === 'spreadsheet') return resultText(locale, { 'zh-CN': '表格文件', 'en-US': 'Spreadsheet file' });
  if (kind === 'presentation') return resultText(locale, { 'zh-CN': '演示文稿', 'en-US': 'Presentation file' });
  return resultText(locale, { 'zh-CN': '文档文件', 'en-US': 'Document file' });
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

function recordField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArrayField(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

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
      {regionPick ? <span className="workspace-object-region-box" style={regionStyle(regionPick)} /> : null}
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
        {reference ? <button type="button" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(reference, null, 2))}>{resultText(locale, { 'zh-CN': '复制引用', 'en-US': 'Copy reference' })}</button> : null}
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

function referenceForWorkspaceFile(file: WorkspaceFileContent): SciForgeReference {
  return referenceForWorkspaceFileLike(file, referenceKindForWorkspaceFileLike(file));
}

function DelimitedTextPreview({ content, delimiter, locale }: { content: string; delimiter: ',' | '\t'; locale?: ResultLocale }) {
  const rows = content.split(/\r?\n/).filter(Boolean).slice(0, 12).map((line) => line.split(delimiter).slice(0, 8));
  if (!rows.length) return <p className="empty-state">{resultText(locale, { 'zh-CN': '表格文件为空。', 'en-US': 'The table file is empty.' })}</p>;
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
    return formatRightPanePreviewJson(JSON.parse(content));
  } catch {
    return boundedRightPaneText(content);
  }
}

function artifactFallbackTitle(reference: ObjectReference, artifact?: RuntimeArtifact, path?: string) {
  const metadataTitle = typeof artifact?.metadata?.title === 'string' ? artifact.metadata.title : undefined;
  const metadataName = typeof artifact?.metadata?.name === 'string' ? artifact.metadata.name : undefined;
  return metadataTitle || metadataName || reference.title || path || artifact?.id || reference.ref;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 1024) return `${value || 0} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
