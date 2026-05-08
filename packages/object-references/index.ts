import type {
  SciForgeMessage,
  SciForgeReference,
  SciForgeReferenceKind,
  SciForgeRun,
  SciForgeSession,
  ObjectAction,
  ObjectReference,
  PreviewDescriptor,
  RuntimeArtifact,
  ScenarioInstanceId,
} from '../../src/ui/src/domain';

export interface WorkspaceFileReferenceLike {
  path: string;
  name?: string;
  language?: string;
  mimeType?: string;
  encoding?: string;
  size?: number;
}

export interface TextSelectionReferenceInput {
  sourceReference: SciForgeReference;
  selectedText: string;
}

export interface ObjectReferenceChipModel {
  trusted: ObjectReference[];
  pending: ObjectReference[];
  ordered: ObjectReference[];
  visible: ObjectReference[];
  hiddenCount: number;
  hasOverflow: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function titleForArtifact(artifact: RuntimeArtifact) {
  if (artifact.type === 'vision-trace') return String(artifact.metadata?.title || (isRecord(artifact.data) ? artifact.data.task : undefined) || artifact.path || artifact.dataRef || artifact.id);
  return String(artifact.metadata?.title || artifact.metadata?.name || preferredArtifactPath(artifact) || artifact.id);
}

function idSegment(value: string) {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

export function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function normalizeArtifactRef(ref: string) {
  return ref.replace(/^artifact:\/\//i, '').replace(/^artifact:/i, '');
}

export function findArtifact(session: Pick<SciForgeSession, 'artifacts'>, ref?: string): RuntimeArtifact | undefined {
  if (!ref) return undefined;
  const normalizedRef = normalizeArtifactRef(ref);
  return session.artifacts.find((artifact) => artifact.id === ref
    || artifact.id === normalizedRef
    || artifact.dataRef === ref
    || artifact.dataRef === normalizedRef
    || artifact.type === ref
    || artifact.type === normalizedRef
    || Object.values(artifact.metadata ?? {}).some((value) => value === ref));
}

export function artifactForObjectReference(reference: ObjectReference, session: Pick<SciForgeSession, 'artifacts'>): RuntimeArtifact | undefined {
  if (reference.kind !== 'artifact') return undefined;
  return findArtifact(session, reference.ref)
    ?? findArtifact(session, reference.artifactType)
    ?? session.artifacts.find((artifact) => artifact.id === reference.id || artifact.type === reference.artifactType);
}

export function pathForObjectReference(reference: ObjectReference, session: Pick<SciForgeSession, 'artifacts'>): string | undefined {
  const artifact = artifactForObjectReference(reference, session);
  if (artifact) {
    return preferredArtifactPath(artifact)
      || reference.provenance?.path
      || reference.provenance?.dataRef;
  }
  if (reference.kind === 'file' || reference.kind === 'folder') return reference.ref.replace(/^(file|folder)::?/i, '');
  if (reference.kind === 'url') return reference.ref.replace(/^url:/i, '');
  return reference.provenance?.path || reference.provenance?.dataRef;
}

export function syntheticArtifactForObjectReference(reference: ObjectReference, scenarioId: ScenarioInstanceId): RuntimeArtifact | undefined {
  if (reference.kind !== 'file' && reference.kind !== 'folder' && reference.kind !== 'url') return undefined;
  const path = reference.ref.replace(/^(file|folder|url):/i, '');
  return {
    id: reference.id,
    type: reference.kind === 'url' ? 'external-url' : artifactTypeForPath(path, reference.kind),
    producerScenario: scenarioId,
    schemaVersion: '1',
    metadata: {
      title: reference.title,
      objectReferenceId: reference.id,
      path: reference.kind === 'url' ? undefined : path,
      url: reference.kind === 'url' ? path : undefined,
      synthetic: true,
    },
    path: reference.kind === 'url' ? undefined : path,
    dataRef: reference.kind === 'url' || reference.kind === 'file' ? path : undefined,
    data: {
      title: reference.title,
      ref: reference.ref,
      summary: reference.summary,
      path: reference.kind === 'url' ? undefined : path,
      url: reference.kind === 'url' ? path : undefined,
    },
  };
}

export function artifactTypeForPath(path: string, kind: ObjectReference['kind']) {
  if (kind === 'folder') return 'workspace-folder';
  if (/\.md$/i.test(path)) return 'research-report';
  if (/\.pdf$/i.test(path)) return 'pdf-document';
  if (/\.(docx?|rtf)$/i.test(path)) return 'word-document';
  if (/\.(pptx?|key)$/i.test(path)) return 'slide-deck';
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) return 'image';
  if (/\.(csv|tsv|xlsx?)$/i.test(path)) return 'data-table';
  if (/\.(pdb|cif|mmcif)$/i.test(path)) return 'structure-summary';
  if (/\.html?$/i.test(path)) return 'html-document';
  return 'workspace-file';
}

export function referenceToPreviewTarget(reference: ObjectReference, session: Pick<SciForgeSession, 'artifacts'>) {
  const artifact = artifactForObjectReference(reference, session);
  const path = pathForObjectReference(reference, session);
  return {
    reference,
    artifact,
    path,
    lookupRef: artifact?.id ?? path ?? reference.ref,
    status: artifact || path || reference.kind === 'url' ? 'resolved' as const : 'missing' as const,
  };
}

export function mergeObjectReferences(primary: ObjectReference[], secondary: ObjectReference[], limit = 24) {
  const byRef = new Map<string, ObjectReference>();
  for (const reference of [...primary, ...secondary]) {
    const key = reference.ref || reference.id;
    byRef.set(key, { ...byRef.get(key), ...reference });
  }
  return Array.from(byRef.values()).slice(0, limit);
}

export function isTrustedObjectReference(reference: ObjectReference) {
  if (reference.status && reference.status !== 'available') return false;
  if (reference.kind === 'artifact') return true;
  if (reference.kind === 'url') return true;
  if (/^agentserver:\/\//i.test(reference.ref)) return false;
  return Boolean(reference.provenance?.hash || reference.provenance?.size || reference.provenance?.producer);
}

export function objectReferenceChipModel(references: ObjectReference[], expanded = false, limit = 8): ObjectReferenceChipModel {
  const trusted = references.filter(isTrustedObjectReference);
  const pending = references.filter((reference) => !isTrustedObjectReference(reference));
  const ordered = [...trusted, ...pending];
  const visible = expanded ? ordered : ordered.slice(0, limit);
  return {
    trusted,
    pending,
    ordered,
    visible,
    hiddenCount: Math.max(0, ordered.length - visible.length),
    hasOverflow: ordered.length > limit,
  };
}

export function referenceForUploadedArtifact(artifact: RuntimeArtifact): SciForgeReference {
  const title = String(artifact.metadata?.title ?? artifact.id);
  return {
    id: `ref-upload-${artifact.id}`,
    kind: 'file',
    title,
    ref: artifact.dataRef ?? artifact.path ?? `artifact:${artifact.id}`,
    summary: `用户上传文件 · ${artifact.type}`,
    sourceId: artifact.id,
    payload: {
      artifactId: artifact.id,
      type: artifact.type,
      metadata: artifact.metadata,
    },
  };
}

export function objectReferenceForUploadedArtifact(artifact: RuntimeArtifact): ObjectReference {
  const title = String(artifact.metadata?.title ?? artifact.id);
  return {
    id: `obj-upload-${artifact.id}`,
    kind: 'artifact',
    title,
    ref: `artifact:${artifact.id}`,
    artifactType: artifact.type,
    preferredView: artifact.type === 'uploaded-image' || artifact.type === 'uploaded-pdf' ? 'preview' : 'generic-artifact-inspector',
    actions: ['focus-right-pane', 'inspect', 'open-external', 'reveal-in-folder', 'copy-path', 'pin'],
    status: 'available',
    summary: '用户上传到证据矩阵的文件',
    provenance: {
      dataRef: artifact.dataRef,
      path: artifact.path,
      producer: 'user-upload',
      size: asNumber(artifact.metadata?.size),
    },
  };
}

export function objectReferenceForArtifactSummary(artifact: RuntimeArtifact, runId?: string): ObjectReference {
  const finalScreenshotRef = visionTraceFinalScreenshotRef(artifact);
  const preferredPath = preferredArtifactPath(artifact);
  return {
    id: runId ? `chat-key-${artifact.id}` : `obj-artifact-${artifact.id}`,
    kind: 'artifact',
    title: titleForArtifact(artifact),
    ref: `artifact:${artifact.id}`,
    artifactType: artifact.type,
    preferredView: artifact.type === 'research-report' ? 'report-viewer' : artifact.type === 'uploaded-image' || artifact.type === 'uploaded-pdf' ? 'preview' : 'generic-artifact-inspector',
    runId,
    status: 'available',
    summary: artifact.type === 'vision-trace' && finalScreenshotRef ? `Vision trace; final screenshot: ${finalScreenshotRef}` : undefined,
    provenance: {
      dataRef: artifact.dataRef,
      path: preferredPath,
      producer: artifact.producerScenario,
      screenshotRef: finalScreenshotRef,
    },
  };
}

export function referenceForArtifact(artifact: RuntimeArtifact, kind: SciForgeReferenceKind = 'file-region'): SciForgeReference {
  const title = titleForArtifact(artifact).slice(0, 52);
  const preferredPath = preferredArtifactPath(artifact);
  return {
    id: `ref-${kind}-${artifact.id}`,
    kind,
    title,
    ref: preferredPath && kind === 'file' ? `file:${preferredPath}` : `artifact:${artifact.id}`,
    sourceId: artifact.id,
    runId: asString(artifact.metadata?.runId) || asString(artifact.metadata?.agentServerRunId),
    summary: `${artifact.type}${preferredPath ? ` · ${preferredPath}` : ''}${artifact.dataRef && artifact.dataRef !== preferredPath ? ` · ${artifact.dataRef}` : ''}`,
    payload: {
      id: artifact.id,
      type: artifact.type,
      schemaVersion: artifact.schemaVersion,
      path: preferredPath,
      dataRef: artifact.dataRef,
      metadata: artifact.metadata,
      dataSummary: summarizeReferencePayload(artifact.data),
    },
  };
}

export function referenceForMessage(message: SciForgeMessage, runId?: string): SciForgeReference {
  return {
    id: `ref-message-${message.id}`,
    kind: 'message',
    title: `${message.role === 'user' ? '用户' : message.role === 'system' ? '系统' : 'Agent'} · ${message.content.trim().slice(0, 28) || message.id}`,
    ref: `message:${message.id}`,
    sourceId: message.id,
    runId,
    summary: message.content.slice(0, 500),
    payload: {
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      references: message.references,
      objectReferences: message.objectReferences,
    },
  };
}

export function referenceForRun(run: SciForgeRun): SciForgeReference {
  return {
    id: `ref-run-${run.id}`,
    kind: 'task-result',
    title: `run ${run.id.replace(/^run-/, '').slice(0, 8)} · ${run.status}`,
    ref: `run:${run.id}`,
    sourceId: run.id,
    runId: run.id,
    summary: `${run.prompt.slice(0, 240)}\n${run.response.slice(0, 240)}`,
    payload: {
      status: run.status,
      prompt: run.prompt,
      response: run.response,
      references: run.references,
      objectReferences: run.objectReferences,
    },
  };
}

export function referenceForObjectReference(reference: ObjectReference, kind?: SciForgeReferenceKind): SciForgeReference {
  const resolvedKind = kind ?? sciForgeKindForObjectReference(reference);
  return {
    id: `ref-${kind ?? 'object'}-${reference.id}`,
    kind: resolvedKind,
    title: reference.title || reference.ref,
    ref: reference.ref,
    sourceId: reference.id,
    runId: reference.runId,
    summary: reference.summary || reference.ref,
    payload: {
      objectReferenceId: reference.id,
      objectKind: reference.kind,
      artifactType: reference.artifactType,
      path: reference.provenance?.path,
      dataRef: reference.provenance?.dataRef,
      preferredView: reference.preferredView,
      provenance: reference.provenance,
      status: reference.status,
    },
  };
}

export function sciForgeKindForObjectReference(reference: ObjectReference): SciForgeReferenceKind {
  if (reference.kind === 'file') return 'file';
  if (reference.kind === 'artifact' && /table|matrix|csv|dataframe/i.test(reference.artifactType ?? reference.title)) return 'table';
  if (reference.kind === 'artifact' && /chart|plot|graph|visual|umap|heatmap/i.test(reference.artifactType ?? reference.title)) return 'chart';
  return 'task-result';
}

export function referenceForWorkspaceFileLike(file: WorkspaceFileReferenceLike, kind: SciForgeReferenceKind = 'file'): SciForgeReference {
  return {
    id: `ref-${kind}-${idSegment(file.path)}`,
    kind,
    title: file.name || file.path,
    ref: `file:${file.path}`,
    summary: `${file.language || fileKindForPath(file.path)}${file.size !== undefined ? ` · ${formatBytes(file.size)}` : ''}`,
    payload: {
      path: file.path,
      mimeType: file.mimeType,
      language: file.language,
      encoding: file.encoding,
      size: file.size,
    },
  };
}

export function referenceForResultSlotLike(item: {
  id: string;
  section: string;
  status: string;
  reason?: string;
  slot: { title?: string };
  module: { moduleId: string; componentId: string; title: string };
  missingFields?: string[];
}): SciForgeReference {
  return {
    id: `ref-ui-slot-${idSegment(item.id).slice(0, 52)}`,
    kind: 'ui',
    title: item.slot.title || item.module.title,
    ref: `ui-module:${item.module.moduleId}`,
    sourceId: item.id,
    summary: `${item.section} · ${item.status}${item.reason ? ` · ${item.reason}` : ''}`,
    payload: {
      moduleId: item.module.moduleId,
      componentId: item.module.componentId,
      section: item.section,
      status: item.status,
      slot: item.slot,
      missingFields: item.missingFields,
    },
  };
}

export function referenceForUiElement(element: HTMLElement): SciForgeReference {
  const title = readableElementTitle(element);
  const selector = stableElementSelector(element);
  return {
    id: `ref-ui-${idSegment(selector).slice(0, 48) || `ui-${stableHash(selector)}`}`,
    kind: 'ui',
    title,
    ref: `ui:${selector}`,
    summary: element.innerText?.trim().slice(0, 600) || element.getAttribute('aria-label') || element.className.toString(),
    payload: {
      tagName: element.tagName.toLowerCase(),
      className: element.className.toString(),
      ariaLabel: element.getAttribute('aria-label'),
      textPreview: element.innerText?.trim().slice(0, 1000),
    },
  };
}

export function referenceForTextSelection(input: TextSelectionReferenceInput): SciForgeReference | undefined {
  const selectedText = input.selectedText.trim();
  if (!selectedText) return undefined;
  const textHash = stableHash(`${input.sourceReference.ref}:${selectedText}`);
  const clippedText = selectedText.length > 2400 ? `${selectedText.slice(0, 2400)}...` : selectedText;
  return {
    id: `ref-text-${textHash}`,
    kind: 'ui',
    title: `选中文本 · ${selectedText.replace(/\s+/g, ' ').slice(0, 28)}`,
    ref: `ui-text:${input.sourceReference.ref}#${textHash}`,
    sourceId: input.sourceReference.sourceId,
    runId: input.sourceReference.runId,
    summary: clippedText,
    locator: {
      textRange: selectedText.slice(0, 160),
      region: input.sourceReference.ref,
    },
    payload: {
      selectedText: clippedText,
      sourceTitle: input.sourceReference.title,
      sourceRef: input.sourceReference.ref,
      sourceKind: input.sourceReference.kind,
      sourceSummary: input.sourceReference.summary,
    },
  };
}

export function withRegionLocator(reference: SciForgeReference | undefined, region: string): SciForgeReference | undefined {
  if (!reference) return undefined;
  return {
    ...reference,
    kind: 'file-region',
    id: `${reference.id}-region-${region.replace(/,/g, '-')}`,
    locator: {
      ...reference.locator,
      region,
    },
    payload: {
      ...(isRecord(reference.payload) ? reference.payload : {}),
      region,
      regionUnit: 'normalized-1000',
    },
  };
}

export function readableElementTitle(element: HTMLElement) {
  return (element.getAttribute('aria-label')
    || element.getAttribute('title')
    || element.querySelector('h1,h2,h3,strong')?.textContent
    || element.innerText
    || element.tagName)
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 52);
}

export function stableElementSelector(element: HTMLElement) {
  if (element.id) return `#${element.id}`;
  const dataRunId = element.dataset.runId;
  if (dataRunId) return `[data-run-id="${dataRunId}"]`;
  const className = element.className.toString().split(/\s+/).filter(Boolean).slice(0, 3).join('.');
  return `${element.tagName.toLowerCase()}${className ? `.${className}` : ''}`;
}

export function parseSciForgeReferenceAttribute(value: string | undefined): SciForgeReference | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<SciForgeReference>;
    if (!parsed.id || !parsed.kind || !parsed.title || !parsed.ref) return undefined;
    return parsed as SciForgeReference;
  } catch {
    return undefined;
  }
}

export function sciForgeReferenceAttribute(reference: SciForgeReference | undefined) {
  return reference ? JSON.stringify(reference) : undefined;
}

export function appendReferenceMarkerToInput(currentInput: string, reference: SciForgeReference) {
  const marker = referenceComposerMarker(reference);
  if (!marker || currentInput.includes(marker)) return currentInput;
  return [currentInput.trimEnd(), marker].filter(Boolean).join(' ');
}

export function removeReferenceMarkerFromInput(currentInput: string, reference: SciForgeReference) {
  const marker = referenceComposerMarker(reference);
  return currentInput
    .replace(marker, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trimStart();
}

export function referenceComposerMarker(reference: SciForgeReference) {
  const payload = isRecord(reference.payload) ? reference.payload : undefined;
  const marker = typeof payload?.composerMarker === 'string' ? payload.composerMarker : '';
  return marker || '※?';
}

export function withComposerMarker(reference: SciForgeReference, currentReferences: SciForgeReference[]) {
  const existing = currentReferences.find((item) => item.id === reference.id);
  if (existing) return existing;
  const marker = nextComposerMarker(currentReferences);
  return {
    ...reference,
    payload: {
      ...(isRecord(reference.payload) ? reference.payload : {}),
      composerMarker: marker,
    },
  };
}

export function nextComposerMarker(currentReferences: SciForgeReference[]) {
  const used = new Set(currentReferences.map(referenceComposerMarker));
  for (let index = 1; index <= currentReferences.length + 1; index += 1) {
    const marker = `※${index}`;
    if (!used.has(marker)) return marker;
  }
  return `※${currentReferences.length + 1}`;
}

export function sciForgeReferenceKindLabel(kind: SciForgeReference['kind']) {
  if (kind === 'file') return 'file';
  if (kind === 'file-region') return 'region';
  if (kind === 'message') return 'msg';
  if (kind === 'task-result') return 'run';
  if (kind === 'chart') return 'chart';
  if (kind === 'table') return 'table';
  return 'ui';
}

export function objectReferenceKindLabel(kind: ObjectReference['kind']) {
  if (kind === 'artifact') return 'artifact';
  if (kind === 'file') return 'file';
  if (kind === 'folder') return 'folder';
  if (kind === 'run') return 'run';
  if (kind === 'execution-unit') return 'execution unit';
  if (kind === 'scenario-package') return 'scenario package';
  return 'url';
}

export function objectReferenceIcon(kind: ObjectReference['kind']) {
  if (kind === 'folder') return 'folder';
  if (kind === 'file') return 'file';
  if (kind === 'run') return 'run';
  if (kind === 'execution-unit') return 'EU';
  if (kind === 'url') return 'link';
  if (kind === 'scenario-package') return 'pkg';
  return 'obj';
}

export function availableObjectActions(reference: ObjectReference, session: Pick<SciForgeSession, 'artifacts'>): ObjectAction[] {
  const declared: ObjectAction[] = reference.actions?.length ? reference.actions : ['focus-right-pane', 'pin'];
  const path = pathForObjectReference(reference, session);
  const hasWorkspacePath = Boolean(path && !/^https?:\/\//i.test(path) && !/^agentserver:\/\//i.test(path) && !/^data:/i.test(path));
  return declared.filter((action) => {
    if (action === 'open-external' || action === 'reveal-in-folder' || action === 'copy-path') return hasWorkspacePath;
    if (action === 'inspect') return reference.kind === 'artifact';
    return true;
  });
}

export function previewKindForUploadedFileLike(file: { name: string; type?: string }): PreviewDescriptor['kind'] {
  const name = file.name.toLowerCase();
  const type = (file.type ?? '').toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return 'image';
  if (/\.(md|markdown)$/i.test(name)) return 'markdown';
  if (/\.(txt|log)$/i.test(name) || type.startsWith('text/')) return 'text';
  if (/\.(json|jsonl)$/i.test(name) || type.includes('json')) return 'json';
  if (/\.(csv|tsv|xlsx?)$/i.test(name)) return 'table';
  if (/\.(html?|xhtml)$/i.test(name)) return 'html';
  if (/\.(pdb|cif|mmcif)$/i.test(name)) return 'structure';
  if (/\.(docx?|pptx?)$/i.test(name)) return 'office';
  return 'binary';
}

export function artifactTypeForUploadedFileLike(file: { name: string; type?: string }) {
  const name = file.name.toLowerCase();
  const type = (file.type ?? '').toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'uploaded-pdf';
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return 'uploaded-image';
  if (/\.(csv|tsv|xlsx?|json)$/i.test(name)) return 'uploaded-data-file';
  if (/\.(txt|md|rtf|docx?)$/i.test(name)) return 'uploaded-document';
  return 'uploaded-file';
}

export function uploadedInlinePolicyForFileLike(file: { name: string; type?: string; size?: number }): PreviewDescriptor['inlinePolicy'] {
  const kind = previewKindForUploadedFileLike(file);
  if (kind === 'pdf' || kind === 'image') return 'stream';
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'table' || kind === 'html') return (file.size ?? 0) <= 1024 * 1024 ? 'inline' : 'extract';
  if (kind === 'office' || kind === 'structure') return 'external';
  return kind === 'folder' ? 'extract' : 'unsupported';
}

export function uploadedDerivativeHintsForFileLike(file: { name: string; type?: string }, ref: string): PreviewDescriptor['derivatives'] {
  const kind = previewKindForUploadedFileLike(file);
  const lazy = (derivativeKind: NonNullable<PreviewDescriptor['derivatives']>[number]['kind'], mimeType: string) => ({
    kind: derivativeKind,
    ref: `${ref}#${derivativeKind}`,
    mimeType,
    status: 'lazy' as const,
  });
  if (kind === 'pdf') return [lazy('text', 'text/plain'), lazy('pages', 'application/json'), lazy('thumb', 'image/png')];
  if (kind === 'image') return [lazy('thumb', file.type || 'image/*')];
  if (kind === 'json' || kind === 'table') return [lazy('schema', 'application/json')];
  if (kind === 'office' || kind === 'binary') return [lazy('metadata', 'application/json')];
  return [];
}

export function uploadedPreviewActionsForFileLike(file: { name: string; type?: string }): PreviewDescriptor['actions'] {
  const kind = previewKindForUploadedFileLike(file);
  const common: PreviewDescriptor['actions'] = ['system-open', 'copy-ref', 'inspect-metadata'];
  if (kind === 'pdf') return ['open-inline', 'extract-text', 'make-thumbnail', 'select-page', 'select-region', ...common];
  if (kind === 'image') return ['open-inline', 'make-thumbnail', 'select-region', ...common];
  if (kind === 'table') return ['open-inline', 'select-rows', ...common];
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'html') return ['open-inline', 'extract-text', ...common];
  return common;
}

export function uploadedLocatorHintsForFileLike(file: { name: string; type?: string }): PreviewDescriptor['locatorHints'] {
  const kind = previewKindForUploadedFileLike(file);
  if (kind === 'pdf') return ['page', 'region'];
  if (kind === 'image') return ['region'];
  if (kind === 'table') return ['row-range', 'column-range'];
  if (kind === 'structure') return ['structure-selection'];
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'html') return ['text-range'];
  return [];
}

export function artifactReferenceKind(artifact: RuntimeArtifact, componentId = '', rowCount?: number): SciForgeReference['kind'] {
  const haystack = `${artifact.type} ${artifact.id} ${componentId}`;
  const preferredPath = preferredArtifactPath(artifact);
  if (preferredPath || artifact.metadata?.filePath || artifact.metadata?.path) {
    if (/\.(pdf|docx?|pptx?|md|markdown|txt|png|jpe?g|csv|tsv|xlsx?|pdb|cif|html?)$/i.test(`${preferredPath ?? ''}`)) return 'file';
  }
  if (/chart|plot|graph|visual|pca|umap|volcano|heatmap|histogram|scatter|molecule|viewer/i.test(haystack)) return 'chart';
  if (/table|matrix|csv|tsv|dataframe|spreadsheet|gene-list|evidence/i.test(haystack) || Boolean(rowCount)) return 'table';
  return 'file-region';
}

function preferredArtifactPath(artifact: RuntimeArtifact | undefined) {
  if (!artifact) return undefined;
  const metadata = artifact.metadata ?? {};
  const markdownRef = firstMatchingPath([
    metadata.markdownRef,
    metadata.reportRef,
    metadata.path,
    metadata.filePath,
    artifact.path,
    artifact.dataRef,
  ], /\.m(?:d|arkdown)$/i);
  if (markdownRef) return markdownRef;
  const artifactDataRef = asString(artifact.dataRef);
  return artifact.path
    || asString(metadata.path)
    || asString(metadata.filePath)
    || asString(metadata.localPath)
    || (artifactDataRef && !artifactDataRef.startsWith('upload:') ? artifactDataRef : undefined);
}

function firstMatchingPath(values: unknown[], pattern: RegExp) {
  return values.map(asString).find((value) => Boolean(value && pattern.test(value)));
}

function summarizeReferencePayload(data: unknown) {
  if (typeof data === 'string') return { valueType: 'string', preview: data.slice(0, 1000) };
  if (Array.isArray(data)) return { valueType: 'array', count: data.length, preview: data.slice(0, 5) };
  if (!isRecord(data)) return data === undefined ? undefined : { valueType: typeof data };
  const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.records) ? data.records : undefined;
  return {
    valueType: 'object',
    keys: Object.keys(data).slice(0, 16),
    rowCount: rows?.length,
    previewRows: rows?.slice(0, 5),
    markdownPreview: typeof data.markdown === 'string' ? data.markdown.slice(0, 1000) : undefined,
  };
}

function visionTraceFinalScreenshotRef(artifact: RuntimeArtifact) {
  if (artifact.type !== 'vision-trace') return undefined;
  return asString(artifact.metadata?.finalScreenshotRef)
    || asString(artifact.metadata?.latestScreenshotRef)
    || (isRecord(artifact.data) ? asString(artifact.data.finalScreenshotRef) || asString(artifact.data.latestScreenshotRef) : undefined);
}

function fileKindForPath(path: string, language = '') {
  const value = `${path} ${language}`.toLowerCase();
  if (/markdown|\.md\b|\.markdown\b/.test(value)) return 'markdown';
  if (/json|\.json\b/.test(value)) return 'json';
  if (/\.csv\b/.test(value)) return 'csv';
  if (/\.tsv\b/.test(value)) return 'tsv';
  if (/\.pdf\b/.test(value)) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|svg)\b/.test(value)) return 'image';
  if (/html|\.html?\b/.test(value)) return 'html';
  if (/document|\.(docx?|rtf)\b/.test(value)) return 'document';
  if (/spreadsheet|\.(xlsx?|ods)\b/.test(value)) return 'spreadsheet';
  if (/presentation|\.(pptx?|odp)\b/.test(value)) return 'presentation';
  return language || 'text';
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
