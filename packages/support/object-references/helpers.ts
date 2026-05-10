import type { RuntimeArtifact } from '@sciforge-ui/runtime-contract/artifacts';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function idSegment(value: string) {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

export function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function uniqueStringList(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function titleForArtifact(artifact: RuntimeArtifact) {
  if (artifact.type === 'vision-trace') return String(artifact.metadata?.title || (isRecord(artifact.data) ? artifact.data.task : undefined) || artifact.path || artifact.dataRef || artifact.id);
  return String(artifact.metadata?.title || artifact.metadata?.name || preferredArtifactPath(artifact) || artifact.id);
}

export function preferredArtifactPath(artifact: RuntimeArtifact | undefined) {
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

export function firstMatchingPath(values: unknown[], pattern: RegExp) {
  return values.map(asString).find((value) => Boolean(value && pattern.test(value)));
}

export function summarizeReferencePayload(data: unknown) {
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

export function visionTraceFinalScreenshotRef(artifact: RuntimeArtifact) {
  if (artifact.type !== 'vision-trace') return undefined;
  return asString(artifact.metadata?.finalScreenshotRef)
    || asString(artifact.metadata?.latestScreenshotRef)
    || (isRecord(artifact.data) ? asString(artifact.data.finalScreenshotRef) || asString(artifact.data.latestScreenshotRef) : undefined);
}

export function fileKindForPath(path: string, language = '') {
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

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
