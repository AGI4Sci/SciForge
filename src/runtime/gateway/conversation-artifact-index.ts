import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

import { buildConversationReferenceDigests } from './conversation-reference-digest.js';

export const CONVERSATION_ARTIFACT_INDEX_SCHEMA_VERSION = 'sciforge.artifact-index.v1' as const;

type JsonMap = Record<string, unknown>;

export interface ConversationArtifactIndexEntry {
  id: string;
  kind: string;
  title: string;
  ref: string;
  clickableRef?: string | null;
  path?: string | null;
  artifactType?: string | null;
  status?: string | null;
  sha256?: string | null;
  sizeBytes?: number | null;
  summary: string;
  source: string;
  audit: JsonMap;
}

export interface ConversationArtifactIndex {
  schemaVersion: typeof CONVERSATION_ARTIFACT_INDEX_SCHEMA_VERSION;
  policy: 'refs-and-bounded-summaries-only';
  entries: ConversationArtifactIndexEntry[];
  digestRefs: string[];
  omitted: JsonMap;
  audit: JsonMap;
}

interface BuildArtifactIndexInput {
  workspaceRoot: string;
  artifacts?: unknown[] | null;
  executionUnits?: unknown[] | null;
  referenceDigests?: unknown[] | null;
  pathRefs?: string[] | null;
  maxEntries?: number | null;
}

export function buildConversationArtifactIndex(input: BuildArtifactIndexInput): ConversationArtifactIndex {
  const root = realWorkspaceRoot(input.workspaceRoot);
  const maxEntries = Math.max(1, Math.floor(numberValue(input.maxEntries) ?? 80));
  let entries: ConversationArtifactIndexEntry[] = [];
  const omitted: JsonMap = { entriesAfterLimit: 0, inlinePayloads: 0, unresolvedRefs: 0 };

  for (const artifact of input.artifacts ?? []) {
    appendEntry(entries, entryFromArtifact(artifact, root, omitted), maxEntries, omitted);
  }

  for (const unit of input.executionUnits ?? []) {
    for (const entry of entriesFromExecutionUnit(unit, root, omitted)) {
      appendEntry(entries, entry, maxEntries, omitted);
    }
  }

  const digestRefs: string[] = [];
  for (const digest of input.referenceDigests ?? []) {
    const entry = entryFromDigest(digest);
    if (entry.clickableRef) digestRefs.push(entry.clickableRef);
    appendEntry(entries, entry, maxEntries, omitted);
  }

  if (input.pathRefs?.length) {
    const digests = buildConversationReferenceDigests({
      references: input.pathRefs,
      workspaceRoot: root,
      options: { workspaceRoot: root, maxReferences: maxEntries },
    });
    for (const digest of digests) {
      const entry = entryFromDigest(digest);
      if (entry.clickableRef) digestRefs.push(entry.clickableRef);
      appendEntry(entries, entry, maxEntries, omitted);
    }
  }

  entries = dedupeEntries(entries);
  return {
    schemaVersion: CONVERSATION_ARTIFACT_INDEX_SCHEMA_VERSION,
    policy: 'refs-and-bounded-summaries-only',
    entries,
    digestRefs: uniqueStrings(digestRefs),
    omitted: nonZeroRecord(omitted),
    audit: { workspaceRoot: root, entryCount: entries.length, refSafe: true },
  };
}

export function buildConversationArtifactIndexFromRequest(request: JsonMap): ConversationArtifactIndex {
  const workspace = recordValue(request.workspace) ?? {};
  const session = recordValue(request.session) ?? {};
  const limits = recordValue(request.limits) ?? {};
  const workspaceRoot = stringValue(workspace.root) ?? stringValue(request.workspaceRoot) ?? '.';
  return buildConversationArtifactIndex({
    workspaceRoot,
    artifacts: arrayValue(session.artifacts),
    executionUnits: arrayValue(session.executionUnits),
    referenceDigests: arrayValue(request.currentReferenceDigests),
    pathRefs: stringArrayValue(request.pathRefs),
    maxEntries: numberValue(limits.maxArtifactIndexEntries) ?? 80,
  });
}

function appendEntry(
  entries: ConversationArtifactIndexEntry[],
  entry: ConversationArtifactIndexEntry | undefined,
  maxEntries: number,
  omitted: JsonMap,
): void {
  if (!entry) return;
  if (entries.length >= maxEntries) {
    omitted.entriesAfterLimit = (numberValue(omitted.entriesAfterLimit) ?? 0) + 1;
    return;
  }
  entries.push(entry);
}

function entryFromArtifact(artifact: unknown, root: string, omitted: JsonMap): ConversationArtifactIndexEntry | undefined {
  const data = recordValue(artifact);
  if (!data) return undefined;
  const ref = firstText(data.ref, data.dataRef, data.path, data.url);
  if (!ref) {
    if (['data', 'content', 'markdown', 'text', 'payload'].some((key) => key in data)) {
      omitted.inlinePayloads = (numberValue(omitted.inlinePayloads) ?? 0) + 1;
    }
    return undefined;
  }
  const pathMeta = pathMetadata(ref, root);
  if (!pathMeta && looksFileRef(ref)) {
    omitted.unresolvedRefs = (numberValue(omitted.unresolvedRefs) ?? 0) + 1;
  }
  const artifactId = firstText(data.id) ?? stableId('artifact', ref);
  return {
    id: artifactId,
    kind: 'artifact',
    title: firstText(data.title, data.name, data.type, ref) ?? 'artifact',
    ref,
    clickableRef: pathMeta?.clickableRef ?? clickableRef(ref),
    path: pathMeta?.path,
    artifactType: firstText(data.type, data.artifactType),
    status: firstText(data.status),
    sha256: pathMeta?.sha256 ?? firstText(data.sha256),
    sizeBytes: pathMeta?.sizeBytes ?? intValue(data.sizeBytes),
    summary: boundedSummary(firstText(data.summary, data.title, data.name) ?? ''),
    source: 'artifact',
    audit: { inlineFieldsExcluded: ['data', 'content', 'markdown', 'text', 'payload'].filter((key) => key in data) },
  };
}

function entriesFromExecutionUnit(unit: unknown, root: string, omitted: JsonMap): ConversationArtifactIndexEntry[] {
  const data = recordValue(unit);
  if (!data) return [];
  const entries: ConversationArtifactIndexEntry[] = [];
  const unitId = firstText(data.id) ?? stableId('execution', JSON.stringify(data));
  for (const key of ['outputRef', 'stdoutRef', 'stderrRef', 'codeRef', 'traceRef', 'diffRef', 'patchRef']) {
    const value = firstText(data[key]);
    if (!value) continue;
    const meta = pathMetadata(value, root);
    if (!meta && looksFileRef(value)) {
      omitted.unresolvedRefs = (numberValue(omitted.unresolvedRefs) ?? 0) + 1;
    }
    entries.push({
      id: stableId(unitId, key, value),
      kind: 'execution-ref',
      title: `${unitId} ${key}`,
      ref: value,
      clickableRef: meta?.clickableRef ?? clickableRef(value),
      path: meta?.path,
      status: firstText(data.status),
      sha256: meta?.sha256,
      sizeBytes: meta?.sizeBytes,
      summary: boundedSummary(firstText(data.summary, data.failureReason) ?? ''),
      source: 'executionUnit',
      audit: { executionUnitId: unitId, field: key },
    });
  }
  for (const log of arrayValue(data.logs)) {
    const item = recordValue(log);
    if (!item) continue;
    const value = firstText(item.ref, item.path);
    if (!value) continue;
    const meta = pathMetadata(value, root);
    entries.push({
      id: stableId(unitId, 'log', value),
      kind: 'log-ref',
      title: `${unitId} ${firstText(item.kind) ?? 'log'}`,
      ref: value,
      clickableRef: meta?.clickableRef ?? clickableRef(value),
      path: meta?.path,
      status: firstText(data.status),
      sha256: meta?.sha256,
      sizeBytes: meta?.sizeBytes,
      summary: '',
      source: 'executionUnit',
      audit: { executionUnitId: unitId, field: 'logs' },
    });
  }
  return entries;
}

function entryFromDigest(digest: unknown): ConversationArtifactIndexEntry {
  const data = recordValue(digest) ?? {};
  const ref = firstText(data.clickableRef, data.sourceRef, data.path) ?? 'reference';
  return {
    id: firstText(data.id) ?? stableId('digest', ref),
    kind: 'reference-digest',
    title: `${firstText(data.sourceType) ?? 'reference'} digest`,
    ref,
    clickableRef: firstText(data.clickableRef),
    path: firstText(data.path),
    artifactType: 'reference-digest',
    status: firstText(data.status),
    sha256: firstText(data.sha256),
    sizeBytes: intValue(data.sizeBytes),
    summary: boundedSummary(firstText(data.digestText) ?? ''),
    source: 'referenceDigest',
    audit: { sourceRef: firstText(data.sourceRef), refSafe: data.refSafe !== false },
  };
}

function pathMetadata(ref: string, root: string): { path: string; clickableRef: string; sha256: string; sizeBytes: number } | undefined {
  const clean = normalizeFileRef(ref).split('#', 1)[0];
  if (clean.includes('://')) return undefined;
  const candidate = clean.startsWith('~/') ? resolve(homedir(), clean.slice(2)) : resolve(root, clean);
  if (!existsSync(candidate)) return undefined;
  const path = realpathSync(candidate);
  const rel = relative(root, path).replaceAll('\\', '/');
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  const stat = statSync(path);
  if (!stat.isFile()) return undefined;
  return { path: rel, clickableRef: `file:${rel}`, sha256: sha256File(path), sizeBytes: stat.size };
}

function realWorkspaceRoot(workspaceRoot: string): string {
  const resolved = resolve(workspaceRoot.startsWith('~/') ? resolve(homedir(), workspaceRoot.slice(2)) : workspaceRoot);
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}

function normalizeFileRef(ref: string): string {
  return ref.trim().replace(/^file:/, '');
}

function sha256File(path: string): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function dedupeEntries(entries: ConversationArtifactIndexEntry[]): ConversationArtifactIndexEntry[] {
  const seen = new Set<string>();
  const deduped: ConversationArtifactIndexEntry[] = [];
  for (const entry of entries) {
    const key = entry.clickableRef || entry.ref || entry.id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

function boundedSummary(value: string, budget = 420): string {
  const clean = value.split(/\s+/).filter(Boolean).join(' ');
  if (clean.length <= budget) return clean;
  const marker = `... [truncated ${clean.length - budget} chars]`;
  return clean.slice(0, Math.max(0, budget - marker.length)).trimEnd() + marker;
}

function clickableRef(ref: string): string | undefined {
  return ref.startsWith('file:') ? ref : undefined;
}

function looksFileRef(ref: string): boolean {
  return ref.startsWith('file:') || ref.includes('/') || ref.includes('\\');
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function stableId(...parts: string[]): string {
  return `artifact-index-${createHash('sha1').update(parts.join(':')).digest('hex').slice(0, 12)}`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function nonZeroRecord(value: JsonMap): JsonMap {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => Boolean(item)));
}

function recordValue(value: unknown): JsonMap | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as JsonMap;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function intValue(value: unknown): number | undefined {
  return Number.isInteger(value) ? value as number : undefined;
}
