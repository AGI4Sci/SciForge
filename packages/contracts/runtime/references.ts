import type { RuntimeArtifact } from './artifacts';

export type ObjectReferenceKind = 'artifact' | 'file' | 'folder' | 'run' | 'execution-unit' | 'url' | 'scenario-package';
export type ObjectReferenceStatus = 'available' | 'missing' | 'expired' | 'blocked' | 'external';
export type ObjectReferencePresentationRole = 'primary-deliverable' | 'supporting-evidence' | 'audit' | 'diagnostic' | 'internal';
export type ObjectAction = 'focus-right-pane' | 'inspect' | 'open-external' | 'reveal-in-folder' | 'copy-path' | 'pin' | 'compare';

export const objectReferenceKinds = [
  'artifact',
  'file',
  'folder',
  'run',
  'execution-unit',
  'url',
  'scenario-package',
] as const satisfies readonly ObjectReferenceKind[];

export const objectActions = [
  'focus-right-pane',
  'inspect',
  'open-external',
  'reveal-in-folder',
  'copy-path',
  'pin',
  'compare',
] as const satisfies readonly ObjectAction[];

export type SciForgeReferenceKind =
  | 'file'
  | 'file-region'
  | 'message'
  | 'task-result'
  | 'chart'
  | 'table'
  | 'table-range'
  | 'structure-selection'
  | 'ui';

export interface SciForgeReference {
  id: string;
  kind: SciForgeReferenceKind;
  title: string;
  ref: string;
  summary?: string;
  sourceId?: string;
  runId?: string;
  locator?: {
    page?: number;
    sheet?: string;
    rowRange?: string;
    columnRange?: string;
    textRange?: string;
    region?: string;
  };
  payload?: unknown;
}

export interface ObjectReference {
  id: string;
  title: string;
  kind: ObjectReferenceKind;
  ref: string;
  artifactType?: string;
  runId?: string;
  executionUnitId?: string;
  preferredView?: string;
  presentationRole?: ObjectReferencePresentationRole;
  actions?: ObjectAction[];
  status?: ObjectReferenceStatus;
  summary?: string;
  provenance?: {
    dataRef?: string;
    path?: string;
    producer?: string;
    version?: string;
    hash?: string;
    size?: number;
    screenshotRef?: string;
  };
}

export interface ObjectResolution {
  reference: ObjectReference;
  status: 'resolved' | 'missing' | 'blocked';
  artifact?: RuntimeArtifact;
  path?: string;
  reason?: string;
  actions: ObjectAction[];
}

export function looksLikeRuntimeReference(value: string) {
  const text = value.trim();
  return /^(?:file:|artifact:|run:|trace:|http:\/\/|https:\/\/|\.sciforge\/|[A-Za-z0-9_-]+:)/.test(text)
    || /\.(?:json|md|txt|log|csv|tsv|parquet|pdf|png|jpg|jpeg|html)$/i.test(text);
}

export function collectRuntimeRefsFromValue(value: unknown, options: { maxDepth?: number; maxRefs?: number; includeIds?: boolean } = {}): string[] {
  const maxDepth = options.maxDepth ?? 5;
  const maxRefs = options.maxRefs ?? 32;
  const refs = collectRefs(value, 0, maxDepth, options.includeIds === true);
  return uniqueStrings(refs).slice(0, maxRefs);
}

export function runtimePayloadKeyLooksLikeBodyCarrier(key: string) {
  const lower = key.toLowerCase();
  if ([
    'raw',
    'rawbody',
    'rawpayload',
    'rawproviderpayload',
    'rawresponse',
    'providerpayload',
    'providerresponse',
    'responsebody',
    'payload',
    'payloadbody',
    'body',
    'content',
    'fulltext',
    'document',
    'html',
    'markdown',
    'data',
    'events',
    'event',
    'lastevent',
    'finalresponse',
    'backgroundcompletion',
    'workevidence',
    'stdout',
    'stderr',
    'logs',
    'logtext',
    'taskresult',
    'taskresults',
  ].includes(lower)) return true;
  return /(?:raw|provider|payload|response|full).*?(?:body|payload|response|text|content|html|markdown)$/i.test(key);
}

function collectRefs(value: unknown, depth: number, maxDepth: number, includeIds: boolean): string[] {
  if (depth > maxDepth || value === undefined || value === null) return [];
  if (typeof value === 'string') return looksLikeRuntimeReference(value) ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap((entry) => collectRefs(entry, depth + 1, maxDepth, includeIds));
  if (!isRecord(value)) return [];
  const refs: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (isRuntimeReferenceCarrierKey(key) && typeof entry === 'string' && looksLikeRuntimeReference(entry)) refs.push(entry.trim());
    if (includeIds && /id$/i.test(key) && typeof entry === 'string' && entry.trim()) refs.push(entry.trim());
    refs.push(...collectRefs(entry, depth + 1, maxDepth, includeIds));
  }
  return refs;
}

function isRuntimeReferenceCarrierKey(key: string) {
  return /ref$|refs$|path$|url$/i.test(key);
}

function uniqueStrings(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = value?.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
