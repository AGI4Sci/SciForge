import type {
  ObjectAction,
  ObjectReference,
  SciForgeReference,
  SciForgeReferenceKind,
} from '@sciforge-ui/runtime-contract/references';
import {
  artifactHasUserFacingDelivery as runtimeArtifactHasUserFacingDelivery,
  type RuntimeArtifact,
} from '@sciforge-ui/runtime-contract/artifacts';
import type { ScenarioInstanceId } from '@sciforge-ui/runtime-contract/app';
import {
  asNumber,
  asString,
  fileKindForPath,
  formatBytes,
  idSegment,
  isRecord,
  preferredArtifactPath,
  stableHash,
  summarizeReferencePayload,
  titleForArtifact,
  visionTraceFinalScreenshotRef,
} from './helpers';
import { artifactPresentationRole, objectReferencePresentationRole } from './presentation-role';

export { stableHash } from './helpers';
export {
  linkifyObjectReferences,
  objectReferencesFromInlineTokens,
} from './inline-references';
export type { ObjectReferenceTextPiece } from './inline-references';
export {
  normalizeResponseObjectReferences,
} from './response-normalization';
export type { NormalizeResponseObjectReferencesInput } from './response-normalization';
export {
  artifactPresentationRole,
  displayTitleForObjectReference,
  isUserFacingObjectReference,
  normalizeObjectReferencePresentationRole,
  objectReferencePresentationRole,
} from './presentation-role';
export {
  artifactTypeForUploadedFileLike,
  previewKindForUploadedFileLike,
  uploadedDerivativeHintsForFileLike,
  uploadedInlinePolicyForFileLike,
  uploadedLocatorHintsForFileLike,
  uploadedPreviewActionsForFileLike,
} from './upload-preview';

export interface ObjectReferenceSessionLike {
  artifacts: RuntimeArtifact[];
}

export interface ObjectReferenceMessageLike {
  id: string;
  role: 'user' | 'scenario' | 'system';
  content: string;
  createdAt: string;
  references?: SciForgeReference[];
  objectReferences?: ObjectReference[];
}

export interface ObjectReferenceRunLike {
  id: string;
  status: string;
  prompt: string;
  response: string;
  references?: SciForgeReference[];
  objectReferences?: ObjectReference[];
}

export interface WorkspaceFileReferenceLike {
  path: string;
  name?: string;
  language?: string;
  mimeType?: string;
  encoding?: string;
  size?: number;
}

export const workspaceActionIds = {
  createFile: 'create-file',
  createFolder: 'create-folder',
  rename: 'rename',
  delete: 'delete',
} as const;

export type WorkspaceActionId = typeof workspaceActionIds[keyof typeof workspaceActionIds];

export function workspaceActionSuccessMessage(action: WorkspaceActionId) {
  if (action === workspaceActionIds.createFile) return '文件已创建。';
  if (action === workspaceActionIds.createFolder) return '文件夹已创建。';
  if (action === workspaceActionIds.rename) return '资源已重命名。';
  return '资源已删除。';
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

export function normalizeArtifactRef(ref: string) {
  return ref.replace(/^artifact:\/\//i, '').replace(/^artifact:/i, '');
}

export function normalizeWorkspacePath(path: string) {
  return path.replace(/\/+$/, '');
}

export function workspacePathBasename(path: string): string {
  const clean = normalizeWorkspacePath(path);
  if (!clean) return '';
  const index = clean.lastIndexOf('/');
  return index >= 0 ? clean.slice(index + 1) : clean;
}

export function workspaceParentPath(path: string) {
  const clean = normalizeWorkspacePath(path);
  if (!clean || clean === '/') return clean || '/';
  const index = clean.lastIndexOf('/');
  return index <= 0 ? '/' : clean.slice(0, index);
}

export function workspacePathNeedsOnboarding(path: string, workspaceError: string, workspaceStatus: string) {
  if (!path.trim()) return true;
  const combined = `${workspaceError} ${workspaceStatus}`;
  return /ENOENT|no such file|not found|未找到|不存在/i.test(combined);
}

export function workspaceOnboardingReason(path: string, workspaceError: string, workspaceStatus: string) {
  if (!path.trim()) return '当前还没有 workspace path；填写一个本机目录后可以创建 .sciforge 资源结构。';
  const combined = `${workspaceError} ${workspaceStatus}`;
  if (/EACCES|EPERM|permission|权限/i.test(combined)) {
    return '当前路径权限不足；请选择可写目录，或修复目录权限后再创建。';
  }
  if (/Workspace Writer 未连接|Failed to fetch|无法访问|connection/i.test(combined)) {
    return 'Workspace Writer 当前不可用；请启动 npm run workspace:server 后再创建。';
  }
  return `未找到 ${normalizeWorkspacePath(path)}/.sciforge/workspace-state.json；可以创建标准 .sciforge 目录结构作为新工作区。`;
}

export function workspaceOnboardingErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/EACCES|EPERM|permission/i.test(message)) return `创建失败：权限不足。${message}`;
  if (/Workspace Writer 未连接|Failed to fetch|fetch/i.test(message)) return `创建失败：Workspace Writer 未连接。${message}`;
  return `创建失败：${message}`;
}

export function toWorkspaceRelativePath(rootPath: string, path: string): string {
  const root = normalizeWorkspacePath(rootPath);
  const current = normalizeWorkspacePath(path);
  if (root && current.startsWith(`${root}/`)) return current.slice(root.length + 1);
  if (root && current === root) return '.';
  return current;
}

export const objectReferenceArtifactTypeIds = {
  externalUrl: 'external-url',
  workspaceFolder: 'workspace-folder',
  researchReport: 'research-report',
  pdfDocument: 'pdf-document',
  wordDocument: 'word-document',
  slideDeck: 'slide-deck',
  image: 'image',
  dataTable: 'data-table',
  structureSummary: 'structure-summary',
  htmlDocument: 'html-document',
  workspaceFile: 'workspace-file',
} as const;

const objectReferencePathTypeRules: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /\.md$/i, type: objectReferenceArtifactTypeIds.researchReport },
  { pattern: /\.pdf$/i, type: objectReferenceArtifactTypeIds.pdfDocument },
  { pattern: /\.(docx?|rtf)$/i, type: objectReferenceArtifactTypeIds.wordDocument },
  { pattern: /\.(pptx?|key)$/i, type: objectReferenceArtifactTypeIds.slideDeck },
  { pattern: /\.(png|jpe?g|gif|webp|svg)$/i, type: objectReferenceArtifactTypeIds.image },
  { pattern: /\.(csv|tsv|xlsx?)$/i, type: objectReferenceArtifactTypeIds.dataTable },
  { pattern: /\.(pdb|cif|mmcif)$/i, type: objectReferenceArtifactTypeIds.structureSummary },
  { pattern: /\.html?$/i, type: objectReferenceArtifactTypeIds.htmlDocument },
];

export function artifactTypeForPath(path: string, kind: ObjectReference['kind']) {
  if (kind === 'folder') return objectReferenceArtifactTypeIds.workspaceFolder;
  return objectReferencePathTypeRules.find((rule) => rule.pattern.test(path))?.type
    ?? objectReferenceArtifactTypeIds.workspaceFile;
}

export function findArtifact(session: Pick<ObjectReferenceSessionLike, 'artifacts'>, ref?: string): RuntimeArtifact | undefined {
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

export function artifactForObjectReference(reference: ObjectReference, session: Pick<ObjectReferenceSessionLike, 'artifacts'>): RuntimeArtifact | undefined {
  if (reference.kind !== 'artifact') return undefined;
  return findArtifact(session, reference.ref)
    ?? findArtifact(session, reference.artifactType)
    ?? session.artifacts.find((artifact) => artifact.id === reference.id || artifact.type === reference.artifactType);
}

export function pathForObjectReference(reference: ObjectReference, session: Pick<ObjectReferenceSessionLike, 'artifacts'>): string | undefined {
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
  const path = reference.ref.replace(/^(file|folder|url)::?/i, '');
  const delivery = reference.kind === 'file' || reference.kind === 'url'
    ? artifactDeliveryForReferencePath(reference, path)
    : undefined;
  return {
    id: reference.id,
    type: reference.kind === 'url' ? objectReferenceArtifactTypeIds.externalUrl : artifactTypeForPath(path, reference.kind),
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
    delivery,
    data: {
      title: reference.title,
      ref: reference.ref,
      summary: reference.summary,
      path: reference.kind === 'url' ? undefined : path,
      url: reference.kind === 'url' ? path : undefined,
    },
  };
}

function artifactDeliveryForReferencePath(reference: ObjectReference, path: string): RuntimeArtifact['delivery'] {
  const extension = pathExtension(path);
  const mediaType = mediaTypeForExtension(extension, reference.kind === 'url' ? 'external' : undefined);
  const previewPolicy = inlinePreviewExtension(extension)
    ? 'inline'
    : reference.kind === 'url' || openSystemExtension(extension)
      ? 'open-system'
      : 'unsupported';
  return {
    contractId: 'sciforge.artifact-delivery.v1',
    ref: reference.ref,
    role: objectReferencePresentationRole(reference),
    declaredMediaType: mediaType,
    declaredExtension: extension || 'bin',
    contentShape: reference.kind === 'url' ? 'external-ref' : openSystemExtension(extension) ? 'binary-ref' : 'raw-file',
    readableRef: path,
    previewPolicy,
  };
}

function pathExtension(path: string) {
  const clean = path.replace(/[?#].*$/, '');
  const match = clean.match(/\.([A-Za-z0-9]+)$/);
  return match?.[1]?.toLowerCase() ?? '';
}

function inlinePreviewExtension(extension: string) {
  return ['md', 'markdown', 'txt', 'log', 'csv', 'tsv', 'html', 'htm'].includes(extension);
}

function openSystemExtension(extension: string) {
  return ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension);
}

function mediaTypeForExtension(extension: string, fallback?: 'external') {
  if (extension === 'md' || extension === 'markdown') return 'text/markdown';
  if (extension === 'txt' || extension === 'log') return 'text/plain';
  if (extension === 'csv') return 'text/csv';
  if (extension === 'tsv') return 'text/tab-separated-values';
  if (extension === 'html' || extension === 'htm') return 'text/html';
  if (extension === 'json') return 'application/json';
  if (extension === 'pdf') return 'application/pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)) return `image/${extension === 'jpg' ? 'jpeg' : extension}`;
  if (fallback === 'external') return 'text/uri-list';
  return 'application/octet-stream';
}

export function referenceToPreviewTarget(reference: ObjectReference, session: Pick<ObjectReferenceSessionLike, 'artifacts'>) {
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
    const key = canonicalObjectReferenceKey(reference);
    const existing = byRef.get(key);
    byRef.set(key, existing ? mergePreferredObjectReference(existing, reference) : reference);
  }
  return Array.from(byRef.values()).slice(0, limit);
}

export function canonicalObjectReferenceKey(reference: ObjectReference) {
  return normalizeObjectReferenceIdentity(
    reference.provenance?.path
      ?? reference.provenance?.dataRef
      ?? reference.ref
      ?? reference.id,
  ) || reference.id;
}

function mergePreferredObjectReference(left: ObjectReference, right: ObjectReference) {
  const preferred = objectReferencePriority(right) > objectReferencePriority(left) ? right : left;
  const fallback = preferred === right ? left : right;
  return {
    ...fallback,
    ...preferred,
    actions: preferred.actions ?? fallback.actions,
    provenance: {
      ...fallback.provenance,
      ...preferred.provenance,
    },
  };
}

function objectReferencePriority(reference: ObjectReference) {
  let score = 0;
  const role = objectReferencePresentationRole(reference);
  if (role === 'primary-deliverable') score += 40;
  if (role === 'supporting-evidence') score += 30;
  if (reference.kind === 'artifact') score += 10;
  if (reference.kind === 'file') score += 6;
  if (reference.provenance?.path || reference.provenance?.dataRef) score += 4;
  if (!/\.json(?:$|[?#])/i.test(reference.provenance?.path ?? reference.provenance?.dataRef ?? reference.ref)) score += 3;
  return score;
}

function normalizeObjectReferenceIdentity(value: string | undefined) {
  return value
    ?.trim()
    .replace(/^(file|folder|artifact)::?/i, '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

export function artifactHasUserFacingDelivery(artifact: RuntimeArtifact | undefined) {
  return runtimeArtifactHasUserFacingDelivery(artifact);
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
    presentationRole: 'supporting-evidence',
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
    presentationRole: artifactPresentationRole(artifact),
    runId,
    status: 'available',
    summary: artifact.type === 'vision-trace' && finalScreenshotRef ? `Vision trace; final screenshot: ${finalScreenshotRef}` : undefined,
    provenance: {
      dataRef: artifact.delivery?.readableRef ?? artifact.dataRef,
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

export function referenceForMessage(message: ObjectReferenceMessageLike, runId?: string): SciForgeReference {
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

export function referenceForRun(run: ObjectReferenceRunLike): SciForgeReference {
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

export function referenceKindForWorkspaceFileLike(file: WorkspaceFileReferenceLike): SciForgeReferenceKind {
  return fileKindForPath(file.path, file.language) === 'pdf' ? 'file-region' : 'file';
}

export function referenceKindForWorkspacePreviewKind(kind: string | undefined): SciForgeReferenceKind {
  return kind === 'pdf' || kind === 'image' ? 'file-region' : 'file';
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

export function availableObjectActions(reference: ObjectReference, session: Pick<ObjectReferenceSessionLike, 'artifacts'>): ObjectAction[] {
  const declared: ObjectAction[] = reference.actions?.length ? reference.actions : ['focus-right-pane', 'pin'];
  const path = pathForObjectReference(reference, session);
  const hasWorkspacePath = Boolean(path && !/^https?:\/\//i.test(path) && !/^agentserver:\/\//i.test(path) && !/^data:/i.test(path));
  return declared.filter((action) => {
    if (action === 'open-external' || action === 'reveal-in-folder' || action === 'copy-path') return hasWorkspacePath;
    if (action === 'inspect') return reference.kind === 'artifact';
    return true;
  });
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
