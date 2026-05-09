import type {
  ObjectAction,
  ObjectReference,
  ObjectReferenceKind,
  SciForgeReference,
  SciForgeReferenceKind,
} from '@sciforge-ui/runtime-contract/references';
import type { RuntimeArtifact } from '@sciforge-ui/runtime-contract/artifacts';
import type { PreviewDescriptor } from '@sciforge-ui/runtime-contract/preview';
import type { ScenarioInstanceId } from '@sciforge-ui/runtime-contract/app';

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

export interface ObjectReferenceTextPiece {
  text: string;
  reference?: ObjectReference;
}

export interface NormalizeResponseObjectReferencesInput {
  objectReferences: unknown;
  artifacts: RuntimeArtifact[];
  runId: string;
  relatedRefs?: string[];
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
  const path = reference.ref.replace(/^(file|folder|url):/i, '');
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
    data: {
      title: reference.title,
      ref: reference.ref,
      summary: reference.summary,
      path: reference.kind === 'url' ? undefined : path,
      url: reference.kind === 'url' ? path : undefined,
    },
  };
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
    const key = reference.ref || reference.id;
    byRef.set(key, { ...byRef.get(key), ...reference });
  }
  return Array.from(byRef.values()).slice(0, limit);
}

export function normalizeResponseObjectReferences(input: NormalizeResponseObjectReferencesInput): ObjectReference[] {
  const explicit = Array.isArray(input.objectReferences)
    ? input.objectReferences.filter(isRecord).flatMap((record) => {
      const normalized = normalizeResponseObjectReference(record, input.artifacts, input.runId);
      return normalized ? [normalized] : [];
    })
    : [];
  const autoIndexed = input.artifacts.map((artifact) => objectReferenceFromResponseArtifact(artifact, input.runId));
  const related = (input.relatedRefs ?? []).flatMap((ref) => {
    const normalized = objectReferenceFromRelatedRef(ref, input.artifacts, input.runId);
    return normalized ? [normalized] : [];
  });
  const byRef = new Map<string, ObjectReference>();
  for (const reference of [...explicit, ...autoIndexed, ...related]) {
    const key = reference.ref || reference.id;
    if (!byRef.has(key)) {
      byRef.set(key, reference);
      continue;
    }
    byRef.set(key, {
      ...reference,
      ...byRef.get(key),
      actions: uniqueStringList([...(byRef.get(key)?.actions ?? []), ...(reference.actions ?? [])]) as ObjectAction[],
    });
  }
  return Array.from(byRef.values()).slice(0, 16);
}

function objectReferenceFromRelatedRef(ref: string, artifacts: RuntimeArtifact[], runId: string): ObjectReference | undefined {
  const kind = inferObjectKindFromRef(ref);
  if (!kind) return undefined;
  const matchedArtifact = kind === 'artifact' ? findArtifactForObjectRef(ref, artifacts) : undefined;
  return {
    id: objectReferenceIdFromRef(ref),
    title: matchedArtifact?.id || ref.replace(/^[a-z-]+:{1,2}/i, ''),
    kind,
    ref,
    artifactType: matchedArtifact?.type,
    runId,
    executionUnitId: kind === 'execution-unit' ? ref.replace(/^execution-unit:{1,2}/i, '') : undefined,
    actions: normalizeResponseObjectActions(undefined, kind, matchedArtifact),
    status: matchedArtifact || kind !== 'artifact' ? 'available' : 'missing',
    summary: 'contract validation related ref',
    provenance: normalizeResponseObjectProvenance(undefined, matchedArtifact),
  };
}

function normalizeResponseObjectReference(record: Record<string, unknown>, artifacts: RuntimeArtifact[], runId: string): ObjectReference | undefined {
  const ref = asString(record.ref) ?? objectRefFromRecord(record);
  if (!ref) return undefined;
  const kind = normalizeObjectKind(record.kind) ?? inferObjectKindFromRef(ref);
  if (!kind) return undefined;
  const matchedArtifact = kind === 'artifact' ? findArtifactForObjectRef(ref, artifacts) : undefined;
  const title = asString(record.title)
    ?? asString(matchedArtifact?.metadata?.title)
    ?? matchedArtifact?.id
    ?? ref.replace(/^[a-z-]+:/i, '');
  return {
    id: asString(record.id) ?? objectReferenceIdFromRef(ref),
    title,
    kind,
    ref,
    artifactType: asString(record.artifactType) ?? matchedArtifact?.type,
    runId: asString(record.runId) ?? runId,
    executionUnitId: asString(record.executionUnitId),
    preferredView: asString(record.preferredView),
    actions: normalizeResponseObjectActions(record.actions, kind, matchedArtifact),
    status: normalizeObjectStatus(record.status) ?? 'available',
    summary: asString(record.summary),
    provenance: normalizeResponseObjectProvenance(record.provenance, matchedArtifact),
  };
}

function objectReferenceFromResponseArtifact(artifact: RuntimeArtifact, runId: string): ObjectReference {
  const path = preferredResponseObjectReferencePath(artifact);
  return {
    id: objectReferenceIdFromRef(`artifact:${artifact.id}`),
    title: asString(artifact.metadata?.title) ?? artifact.id ?? artifact.type,
    kind: 'artifact',
    ref: `artifact:${artifact.id}`,
    artifactType: artifact.type,
    runId,
    actions: responseObjectActionsForArtifact(artifact),
    status: 'available',
    summary: responseArtifactSummary(artifact),
    provenance: {
      dataRef: artifact.dataRef,
      path,
      producer: asString(artifact.metadata?.producer) ?? asString(artifact.metadata?.executionUnitId),
      version: artifact.schemaVersion,
      hash: asString(artifact.metadata?.hash),
      size: asNumber(artifact.metadata?.size),
    },
  };
}

function objectRefFromRecord(record: Record<string, unknown>) {
  const artifactId = asString(record.artifactId) ?? asString(record.artifactRef);
  if (artifactId) return artifactId.startsWith('artifact:') ? artifactId : `artifact:${artifactId}`;
  const path = asString(record.path) ?? asString(record.filePath);
  if (path) return `${record.kind === 'folder' ? 'folder' : 'file'}:${path}`;
  const url = asString(record.url);
  if (url) return `url:${url}`;
  return undefined;
}

function normalizeObjectKind(value: unknown): ObjectReferenceKind | undefined {
  const kind = asString(value);
  return isObjectReferenceKind(kind) ? kind : undefined;
}

function inferObjectKindFromRef(ref: string): ObjectReferenceKind | undefined {
  const prefix = ref.split(':', 1)[0]?.toLowerCase();
  if (isObjectReferenceKind(prefix)) return prefix;
  if (/^https?:\/\//i.test(ref)) return 'url';
  return undefined;
}

function isObjectReferenceKind(value: unknown): value is ObjectReferenceKind {
  return value === 'artifact'
    || value === 'file'
    || value === 'folder'
    || value === 'run'
    || value === 'execution-unit'
    || value === 'url'
    || value === 'scenario-package';
}

function normalizeResponseObjectActions(value: unknown, kind: ObjectReferenceKind, artifact?: RuntimeArtifact): ObjectAction[] {
  const allowed = ['focus-right-pane', 'inspect', 'open-external', 'reveal-in-folder', 'copy-path', 'pin', 'compare'];
  const declared = Array.isArray(value) ? value.filter((item): item is ObjectAction => typeof item === 'string' && allowed.includes(item)) : [];
  const defaults: ObjectAction[] = kind === 'artifact'
    ? responseObjectActionsForArtifact(artifact)
    : kind === 'file' || kind === 'folder'
      ? ['focus-right-pane', 'open-external', 'reveal-in-folder', 'copy-path', 'pin']
      : kind === 'url'
        ? ['focus-right-pane', 'copy-path', 'pin']
        : ['focus-right-pane', 'pin'];
  return uniqueStringList([...declared, ...defaults]) as ObjectAction[];
}

function responseObjectActionsForArtifact(artifact?: RuntimeArtifact): ObjectAction[] {
  const fileLike = Boolean(artifact?.path || artifact?.metadata?.path || artifact?.metadata?.filePath || artifact?.metadata?.localPath);
  return fileLike
    ? ['focus-right-pane', 'inspect', 'open-external', 'reveal-in-folder', 'copy-path', 'pin', 'compare']
    : ['focus-right-pane', 'inspect', 'pin', 'compare'];
}

function normalizeObjectStatus(value: unknown): ObjectReference['status'] | undefined {
  const status = asString(value);
  if (status === 'available' || status === 'missing' || status === 'expired' || status === 'blocked' || status === 'external') return status;
  return undefined;
}

function normalizeResponseObjectProvenance(value: unknown, artifact?: RuntimeArtifact): ObjectReference['provenance'] {
  const record = isRecord(value) ? value : {};
  const path = asString(record.path) ?? artifact?.path ?? asString(artifact?.metadata?.path) ?? asString(artifact?.metadata?.filePath);
  return {
    dataRef: asString(record.dataRef) ?? artifact?.dataRef,
    path,
    producer: asString(record.producer) ?? asString(artifact?.metadata?.producer) ?? asString(artifact?.metadata?.executionUnitId),
    version: asString(record.version) ?? artifact?.schemaVersion,
    hash: asString(record.hash) ?? asString(artifact?.metadata?.hash),
    size: asNumber(record.size) ?? asNumber(artifact?.metadata?.size),
  };
}

function findArtifactForObjectRef(ref: string, artifacts: RuntimeArtifact[]) {
  const id = normalizeArtifactRef(ref);
  return artifacts.find((artifact) => artifact.id === id || artifact.type === id || artifact.dataRef === id || artifact.path === id);
}

function preferredResponseObjectReferencePath(artifact: RuntimeArtifact) {
  return firstMatchingPath([
    artifact.metadata?.markdownRef,
    artifact.metadata?.reportRef,
    artifact.path,
    artifact.metadata?.path,
    artifact.metadata?.filePath,
    artifact.dataRef,
  ], /\.m(?:d|arkdown)(?:$|[?#])/i)
    ?? artifact.path
    ?? asString(artifact.metadata?.path)
    ?? asString(artifact.metadata?.filePath);
}

function responseArtifactSummary(artifact: RuntimeArtifact) {
  const rows = isRecord(artifact.data) ? asNumber(artifact.data.rows) : undefined;
  const count = Array.isArray(artifact.data) ? artifact.data.length : rows;
  return `${artifact.type}${count ? ` · ${count} records` : ''}`;
}

function objectReferenceIdFromRef(ref: string) {
  return `obj-${idSegment(ref) || stableHash(ref)}`;
}

function uniqueStringList(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
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

export function objectReferencesFromInlineTokens(content: string, runId?: string) {
  const references: ObjectReference[] = [];
  const seen = new Set<string>();
  const tokenPattern = /\b(?:(?:artifact|file|folder|run|execution-unit|scenario-package)::?[^\s)\]）>，。；、,;]+|https?:\/\/[^\s)\]）>，。；、]+)[^\s)\]）>，。；、,;]*/gi;
  for (const match of content.matchAll(tokenPattern)) {
    const raw = match[0].replace(/[.,;，。；、]+$/, '');
    const reference = objectReferenceFromInlineToken(raw, runId);
    if (!reference || seen.has(reference.ref)) continue;
    seen.add(reference.ref);
    references.push(reference);
  }
  return references;
}

export function linkifyObjectReferences(content: string, references: ObjectReference[]): ObjectReferenceTextPiece[] {
  if (!content || !references.length) return [{ text: content }];
  const candidates = objectReferenceLinkCandidates(references);
  if (!candidates.length) return [{ text: content }];
  const pieces: ObjectReferenceTextPiece[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const match = nextObjectReferenceMatch(content, cursor, candidates);
    if (!match) {
      pieces.push({ text: content.slice(cursor) });
      break;
    }
    if (match.index > cursor) pieces.push({ text: content.slice(cursor, match.index) });
    pieces.push({ text: content.slice(match.index, match.index + match.key.length), reference: match.reference });
    cursor = match.index + match.key.length;
  }
  return pieces.filter((piece) => piece.text.length > 0);
}

function objectReferenceFromInlineToken(raw: string, runId?: string): ObjectReference | undefined {
  if (/^https?:\/\//i.test(raw)) {
    return {
      id: inlineObjectReferenceId('url', raw),
      title: inlineReferenceTitle(raw),
      kind: 'url',
      ref: `url:${raw}`,
      runId,
      actions: ['focus-right-pane', 'open-external', 'copy-path'],
      status: 'external',
      summary: raw,
      provenance: { dataRef: raw },
    };
  }
  const tokenMatch = raw.match(/^([a-z-]+)::?(.+)$/i);
  if (!tokenMatch) return undefined;
  const prefix = tokenMatch[1].toLowerCase() as ObjectReferenceKind;
  if (!['artifact', 'file', 'folder', 'run', 'execution-unit', 'scenario-package'].includes(prefix)) return undefined;
  const target = tokenMatch[2];
  return {
    id: inlineObjectReferenceId(prefix, raw),
    title: inlineReferenceTitle(target),
    kind: prefix,
    ref: raw,
    runId,
    actions: inlineObjectReferenceActions(prefix),
    status: 'available',
    summary: target,
    provenance: prefix === 'file' || prefix === 'folder' ? { path: target } : { dataRef: target },
  };
}

function inlineObjectReferenceActions(kind: ObjectReferenceKind): ObjectAction[] {
  if (kind === 'file' || kind === 'folder') return ['focus-right-pane', 'reveal-in-folder', 'copy-path', 'pin'];
  if (kind === 'url') return ['focus-right-pane', 'open-external', 'copy-path'];
  return ['focus-right-pane', 'inspect', 'copy-path', 'pin'];
}

function inlineObjectReferenceId(kind: ObjectReferenceKind, ref: string) {
  return `inline-${kind}-${ref.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)}`;
}

function inlineReferenceTitle(ref: string) {
  try {
    const value = decodeURIComponent(ref.replace(/^url:/i, ''));
    const trimmed = value.replace(/[?#].*$/, '').replace(/\/$/, '');
    return trimmed.split('/').pop() || value;
  } catch {
    return ref;
  }
}

function nextObjectReferenceMatch(
  content: string,
  cursor: number,
  candidates: Array<{ key: string; reference: ObjectReference }>,
) {
  let best: { index: number; key: string; reference: ObjectReference } | undefined;
  for (const candidate of candidates) {
    const index = content.indexOf(candidate.key, cursor);
    if (index < 0) continue;
    if (!best || index < best.index || (index === best.index && candidate.key.length > best.key.length)) {
      best = { index, key: candidate.key, reference: candidate.reference };
    }
  }
  return best;
}

function objectReferenceLinkCandidates(references: ObjectReference[]) {
  const candidates: Array<{ key: string; reference: ObjectReference }> = [];
  const seen = new Set<string>();
  for (const reference of references) {
    for (const key of objectReferenceLinkKeys(reference)) {
      const trimmed = key.trim();
      if (trimmed.length < 4 || seen.has(trimmed)) continue;
      seen.add(trimmed);
      candidates.push({ key: trimmed, reference });
    }
  }
  return candidates.sort((left, right) => right.key.length - left.key.length);
}

function objectReferenceLinkKeys(reference: ObjectReference) {
  const keys = [
    reference.ref,
    reference.ref.replace(/^file:/i, 'file::'),
    reference.ref.replace(/^folder:/i, 'folder::'),
    reference.ref.replace(/^artifact:/i, ''),
    reference.title,
    reference.provenance?.path,
    reference.provenance?.dataRef,
    reference.provenance?.path ? `file:${reference.provenance.path}` : undefined,
    reference.provenance?.path ? `file::${reference.provenance.path}` : undefined,
    reference.provenance?.dataRef ? `file:${reference.provenance.dataRef}` : undefined,
    reference.provenance?.dataRef ? `file::${reference.provenance.dataRef}` : undefined,
  ];
  return keys.filter((key): key is string => Boolean(key && key.trim()));
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
