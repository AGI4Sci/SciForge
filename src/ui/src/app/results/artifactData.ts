import type { RuntimeArtifact, UIManifestSlot } from '../../domain';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function toRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

export function slotPayload(slot: UIManifestSlot, artifact?: RuntimeArtifact): Record<string, unknown> {
  const props = slot.props ?? {};
  if (!artifact) return props;
  const artifactRecord = artifact as RuntimeArtifact & Record<string, unknown>;
  const artifactData = isRecord(artifact.data) ? artifact.data : {};
  const nestedContent = isRecord(artifactRecord.content)
    ? artifactRecord.content
    : isRecord(artifactData.content)
      ? artifactData.content
      : {};
  return {
    ...props,
    ...artifactRecord,
    ...artifactData,
    ...nestedContent,
  };
}

export function applyViewTransforms(rows: Record<string, unknown>[], slot: UIManifestSlot) {
  return (slot.transform ?? []).reduce((current, transform) => {
    if (transform.type === 'filter' && transform.field) {
      return current.filter((row) => compareValue(row[transform.field ?? ''], transform.op ?? '==', transform.value));
    }
    if (transform.type === 'sort' && transform.field) {
      return [...current].sort((left, right) => String(left[transform.field ?? ''] ?? '').localeCompare(String(right[transform.field ?? ''] ?? '')));
    }
    if (transform.type === 'limit') {
      const limit = typeof transform.value === 'number' ? transform.value : Number(transform.value);
      return Number.isFinite(limit) && limit >= 0 ? current.slice(0, limit) : current;
    }
    return current;
  }, rows);
}

function compareValue(left: unknown, op: string, right: unknown) {
  const leftNumber = typeof left === 'number' ? left : typeof left === 'string' ? Number(left) : Number.NaN;
  const rightNumber = typeof right === 'number' ? right : typeof right === 'string' ? Number(right) : Number.NaN;
  if (op === '<=' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber <= rightNumber;
  if (op === '>=' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber >= rightNumber;
  if (op === '<' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber < rightNumber;
  if (op === '>' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber > rightNumber;
  if (op === '!=' || op === '!==') return String(left ?? '') !== String(right ?? '');
  return String(left ?? '') === String(right ?? '');
}

export function arrayPayload(slot: UIManifestSlot, key: string, artifact?: RuntimeArtifact): Record<string, unknown>[] {
  const payload = artifact?.data ?? slot.props?.[key] ?? slot.props;
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (isRecord(payload) && Array.isArray(payload[key])) return payload[key].filter(isRecord);
  return [];
}

export function artifactDownloadItems(artifact?: RuntimeArtifact) {
  const data = artifact?.data;
  const raw = isRecord(data) && Array.isArray(data.downloads) ? data.downloads : [];
  return raw
    .filter(isRecord)
    .map((item) => ({
      key: asString(item.key),
      name: asString(item.name) ?? asString(item.filename) ?? 'artifact-download.txt',
      path: asString(item.path),
      contentType: asString(item.contentType) ?? 'text/plain',
      rowCount: asNumber(item.rowCount),
      content: typeof item.content === 'string' ? item.content : '',
    }))
    .filter((item) => item.content.length > 0);
}
