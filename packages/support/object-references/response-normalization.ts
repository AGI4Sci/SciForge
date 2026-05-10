import type { RuntimeArtifact } from '@sciforge-ui/runtime-contract/artifacts';
import type {
  ObjectAction,
  ObjectReference,
  ObjectReferenceKind,
} from '@sciforge-ui/runtime-contract/references';
import {
  asNumber,
  asString,
  firstMatchingPath,
  idSegment,
  isRecord,
  stableHash,
  uniqueStringList,
} from './helpers';

export interface NormalizeResponseObjectReferencesInput {
  objectReferences: unknown;
  artifacts: RuntimeArtifact[];
  runId: string;
  relatedRefs?: string[];
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

function normalizeArtifactRef(ref: string) {
  return ref.replace(/^artifact:\/\//i, '').replace(/^artifact:/i, '');
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
