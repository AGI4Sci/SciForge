import type { RuntimeArtifact } from '@sciforge-ui/runtime-contract/artifacts';
import type {
  ObjectAction,
  ObjectReference,
  ObjectReferenceKind,
  ObjectReferencePresentationRole,
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
import {
  artifactPresentationRole,
  normalizeObjectReferencePresentationRole,
} from './presentation-role';

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
  if (!responseRefIsSafe(ref)) return undefined;
  const special = specialResponseRefSpec(ref);
  const kind = special?.kind ?? inferObjectKindFromRef(ref);
  if (!kind) return undefined;
  const matchedArtifact = kind === 'artifact' ? findArtifactForObjectRef(ref, artifacts) : undefined;
  const reference: ObjectReference = {
    id: objectReferenceIdFromRef(ref),
    title: safeResponseVisibleText(matchedArtifact?.id) ?? special?.title ?? ref.replace(/^[a-z-]+:{1,2}/i, ''),
    kind,
    ref,
    artifactType: special?.artifactType ?? matchedArtifact?.type,
    runId,
    executionUnitId: kind === 'execution-unit' ? ref.replace(/^execution-unit:{1,2}/i, '') : undefined,
    preferredView: special?.preferredView,
    actions: normalizeResponseObjectActions(undefined, kind, matchedArtifact, special),
    status: special?.status ?? (matchedArtifact || kind !== 'artifact' ? 'available' : 'missing'),
    summary: special?.summary ?? 'contract validation related ref',
    provenance: normalizeResponseObjectProvenance(undefined, matchedArtifact),
  };
  return {
    ...reference,
    presentationRole: responseObjectReferencePresentationRole(undefined, kind, matchedArtifact, special),
  };
}

function normalizeResponseObjectReference(record: Record<string, unknown>, artifacts: RuntimeArtifact[], runId: string): ObjectReference | undefined {
  const ref = asString(record.ref) ?? objectRefFromRecord(record);
  if (!ref) return undefined;
  if (!responseRefIsSafe(ref)) return undefined;
  const special = specialResponseRefSpec(ref);
  const kind = normalizeObjectKind(record.kind) ?? special?.kind ?? inferObjectKindFromRef(ref);
  if (!kind) return undefined;
  const matchedArtifact = kind === 'artifact' ? findArtifactForObjectRef(ref, artifacts) : undefined;
  const title = safeResponseVisibleText(asString(record.title))
    ?? safeResponseVisibleText(asString(matchedArtifact?.metadata?.title))
    ?? safeResponseVisibleText(matchedArtifact?.id)
    ?? special?.title
    ?? ref.replace(/^[a-z-]+:/i, '');
  const reference: ObjectReference = {
    id: asString(record.id) ?? objectReferenceIdFromRef(ref),
    title,
    kind,
    ref,
    artifactType: asString(record.artifactType) ?? special?.artifactType ?? matchedArtifact?.type,
    runId: asString(record.runId) ?? runId,
    executionUnitId: asString(record.executionUnitId),
    preferredView: asString(record.preferredView) ?? special?.preferredView,
    actions: normalizeResponseObjectActions(record.actions, kind, matchedArtifact, special),
    status: normalizeObjectStatus(record.status) ?? special?.status ?? 'available',
    summary: safeResponseVisibleText(asString(record.summary)) ?? special?.summary,
    provenance: normalizeResponseObjectProvenance(record.provenance, matchedArtifact),
  };
  return {
    ...reference,
    presentationRole: responseObjectReferencePresentationRole(record.presentationRole, kind, matchedArtifact, special),
  };
}

function responseObjectReferencePresentationRole(
  value: unknown,
  kind: ObjectReferenceKind,
  matchedArtifact?: RuntimeArtifact,
  special?: SpecialResponseRefSpec,
) {
  const explicit = normalizeObjectReferencePresentationRole(value);
  if (explicit) return explicit;
  if (special?.presentationRole) return special.presentationRole;
  if (matchedArtifact) return artifactPresentationRole(matchedArtifact);
  if (kind === 'run' || kind === 'execution-unit' || kind === 'scenario-package') return 'audit';
  return undefined;
}

function objectReferenceFromResponseArtifact(artifact: RuntimeArtifact, runId: string): ObjectReference {
  const path = preferredResponseObjectReferencePath(artifact);
  return {
    id: objectReferenceIdFromRef(`artifact:${artifact.id}`),
    title: safeResponseVisibleText(asString(artifact.metadata?.title)) ?? safeResponseVisibleText(artifact.id) ?? artifact.type,
    kind: 'artifact',
    ref: `artifact:${artifact.id}`,
    artifactType: artifact.type,
    runId,
    presentationRole: artifactPresentationRole(artifact),
    actions: responseObjectActionsForArtifact(artifact),
    status: 'available',
    summary: safeResponseVisibleText(responseArtifactSummary(artifact)) ?? artifact.type,
    provenance: {
      dataRef: safeResponseProvenanceRef(artifact.dataRef),
      path: safeResponseProvenanceRef(path),
      producer: safeResponseVisibleText(asString(artifact.metadata?.producer) ?? asString(artifact.metadata?.executionUnitId)),
      version: safeResponseVisibleText(artifact.schemaVersion),
      hash: safeResponseVisibleText(asString(artifact.metadata?.hash)),
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
  if (prefix === 'subagent' || prefix === 'agent-result' || prefix === 'agent-transcript' || prefix === 'transcript') return 'run';
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

function normalizeResponseObjectActions(value: unknown, kind: ObjectReferenceKind, artifact?: RuntimeArtifact, special?: SpecialResponseRefSpec): ObjectAction[] {
  const allowed = ['focus-right-pane', 'inspect', 'open-external', 'reveal-in-folder', 'copy-path', 'pin', 'compare'];
  const declared = Array.isArray(value) ? value.filter((item): item is ObjectAction => typeof item === 'string' && allowed.includes(item)) : [];
  const defaults: ObjectAction[] = special?.actions ?? (kind === 'artifact'
    ? responseObjectActionsForArtifact(artifact)
    : kind === 'file' || kind === 'folder'
      ? ['focus-right-pane', 'open-external', 'reveal-in-folder', 'copy-path', 'pin']
      : kind === 'url'
        ? ['focus-right-pane', 'copy-path', 'pin']
        : ['focus-right-pane', 'pin']);
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
  const path = safeResponseProvenanceRef(asString(record.path) ?? artifact?.path ?? asString(artifact?.metadata?.path) ?? asString(artifact?.metadata?.filePath));
  return {
    dataRef: safeResponseProvenanceRef(asString(record.dataRef) ?? artifact?.dataRef),
    path,
    producer: safeResponseVisibleText(asString(record.producer) ?? asString(artifact?.metadata?.producer) ?? asString(artifact?.metadata?.executionUnitId)),
    version: safeResponseVisibleText(asString(record.version) ?? artifact?.schemaVersion),
    hash: safeResponseVisibleText(asString(record.hash) ?? asString(artifact?.metadata?.hash)),
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

function safeResponseVisibleText(value: string | undefined, fallback?: string): string | undefined {
  const text = value?.trim().replace(/\s+/g, ' ');
  if (!text) return fallback;
  if (!responseVisibleTextIsSafe(text)) return fallback;
  return text.slice(0, 240);
}

function objectReferenceIdFromRef(ref: string) {
  return `obj-${idSegment(ref) || stableHash(ref)}`;
}

interface SpecialResponseRefSpec {
  kind: ObjectReferenceKind;
  title: string;
  preferredView: string;
  artifactType?: string;
  presentationRole: ObjectReferencePresentationRole;
  summary: string;
  actions: ObjectAction[];
  status: ObjectReference['status'];
}

function specialResponseRefSpec(ref: string): SpecialResponseRefSpec | undefined {
  if (/^artifact:subagent-result-[A-Za-z0-9_.:-]+$/i.test(ref)) {
    return {
      kind: 'artifact',
      title: ref.replace(/^artifact:/i, ''),
      preferredView: 'subagent-result',
      artifactType: 'subagent-result',
      presentationRole: 'audit',
      summary: 'Sub-agent result reference',
      actions: ['focus-right-pane', 'inspect', 'pin'],
      status: 'available',
    };
  }
  if (/^artifact:subagent-transcript-[A-Za-z0-9_.:-]+$/i.test(ref)) {
    return {
      kind: 'artifact',
      title: ref.replace(/^artifact:/i, ''),
      preferredView: 'subagent-transcript',
      artifactType: 'subagent-transcript',
      presentationRole: 'audit',
      summary: 'Sub-agent transcript reference; transcript content stays folded behind the ref.',
      actions: ['focus-right-pane', 'inspect', 'pin'],
      status: 'available',
    };
  }
  if (/^(?:subagent|agent-result):[A-Za-z0-9_.:-]+$/i.test(ref)) {
    return {
      kind: 'run',
      title: ref.replace(/^[a-z-]+:/i, ''),
      preferredView: 'subagent-result',
      presentationRole: 'audit',
      summary: 'Sub-agent result reference',
      actions: ['focus-right-pane', 'inspect', 'pin'],
      status: 'available',
    };
  }
  if (/^(?:transcript|agent-transcript):[A-Za-z0-9_.:-]+$/i.test(ref)) {
    return {
      kind: 'run',
      title: ref.replace(/^[a-z-]+:/i, ''),
      preferredView: 'subagent-transcript',
      presentationRole: 'audit',
      summary: 'Sub-agent transcript reference; transcript content stays folded behind the ref.',
      actions: ['focus-right-pane', 'inspect', 'pin'],
      status: 'available',
    };
  }
  return undefined;
}

function responseRefIsSafe(ref: string) {
  const value = ref.trim().replace(/\\/g, '/');
  if (!value) return false;
  if (/^(?:\/|[A-Za-z]:\/|~\/|file:\/\/|file:(?:\/|[A-Za-z]:\/|~\/))/i.test(value)) return false;
  if (value.includes('..')) return false;
  if (/[\r\n\t<>|?*]/.test(value)) return false;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|\b(?:sk|rk|pk)-[A-Za-z0-9._-]+/i.test(value)) return false;
  if (/(?:^|[/:])\.sciforge\/(?:raw|logs?|audit|stdout|stderr)(?:\/|$)/i.test(value)) return false;
  if (/(?:^|[/:._-])(?:provider|debug|raw|stdout|stderr)(?:$|[/:._-])/i.test(value)) return false;
  return true;
}

function safeResponseProvenanceRef(value: string | undefined) {
  return value && responseRefIsSafe(value) ? value : undefined;
}

function responseVisibleTextIsSafe(value: string) {
  const text = value.trim().replace(/\\/g, '/');
  if (!text) return false;
  if (/https?:\/\/|file:\/\//i.test(text)) return false;
  if (/(^|[\s("'`])(?:\/(?:Users|Applications|Volumes|private|var|tmp)\/[^\s"'`),;]*)/i.test(text)) return false;
  if (/(^|[\s("'`])~\/[^\s"'`),;]*/.test(text)) return false;
  if (/(^|[\s("'`])[A-Za-z]:\/[^\s"'`),;]*/.test(text)) return false;
  if (/(^|[/:])\.sciforge\/(?:raw|logs?|audit|stdout|stderr)(?:\/|$)/i.test(text)) return false;
  if (/\b[A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|TOKEN|SECRET|PASSWORD|AUTHORIZATION)[A-Z0-9_]*\b/i.test(text)) return false;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b\s*[:=]|\b(?:sk|rk|pk)-[A-Za-z0-9._-]+/i.test(text)) return false;
  if (/(?:^|[\s/:._-])(?:provider|debug|raw|stdout|stderr)(?:$|[\s/:._-])/i.test(text)) return false;
  if (/\braw\s+JSON\b|\bJSONL?\b/i.test(text)) return false;
  return true;
}
