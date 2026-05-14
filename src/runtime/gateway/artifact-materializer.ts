import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  validateArtifactDeliveryContract,
  type ArtifactDelivery,
} from '@sciforge-ui/runtime-contract';
import {
  artifactDataForUnparsedPathText,
  artifactDataReadRequestsForPolicy,
  materializedMarkdownMetadataForArtifact,
  normalizeArtifactDataWithPolicy,
} from '@sciforge-ui/runtime-contract/artifact-policy';
import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { clipForAgentServerJson, isRecord } from '../gateway-utils.js';
import { ensureSessionBundle, sessionBundleRelForRequest, sessionBundleResourceRel } from '../session-bundle.js';
import { sha1 } from '../workspace-task-runner.js';

export interface RuntimeRefBundle {
  taskRel: string;
  outputRel: string;
  stdoutRel: string;
  stderrRel: string;
}

export async function materializeBackendPayloadOutput(
  workspace: string,
  _request: GatewayRequest,
  payload: ToolPayload,
  refs: RuntimeRefBundle,
): Promise<ToolPayload> {
  const outputRel = stableTaskResultRef(refs.outputRel);
  if (!outputRel) return payload;

  const artifacts = await Promise.all(payload.artifacts.map(async (artifact) => {
    const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
    const delivery = await materializeArtifactDelivery({ workspace, outputRel, artifact });
    if (delivery.errors.length) {
      metadata.deliveryValidationErrors = delivery.errors;
    }
    const existingDataRef = stringField(artifact.dataRef);
    return {
      ...artifact,
      dataRef: delivery.readableRel ?? stableWorkspaceRef(existingDataRef) ?? outputRel,
      delivery: delivery.contract,
      metadata: {
        ...metadata,
        outputRef: stableWorkspaceRef(stringField(metadata.outputRef)) ?? outputRel,
        taskCodeRef: stableWorkspaceRef(stringField(metadata.taskCodeRef)) ?? refs.taskRel,
        stdoutRef: stableWorkspaceRef(stringField(metadata.stdoutRef)) ?? refs.stdoutRel,
        stderrRef: stableWorkspaceRef(stringField(metadata.stderrRef)) ?? refs.stderrRel,
        ...materializedMarkdownMetadataForArtifact(metadata, delivery.targetFormat === 'markdown' ? delivery.readableRel : undefined),
        readableRef: delivery.readableRel ?? stableWorkspaceRef(existingDataRef),
        rawRef: outputRel,
        previewPolicy: delivery.contract.previewPolicy,
        materializedOutputRef: outputRel,
        materializedAt: new Date().toISOString(),
      },
    };
  }));

  const materialized: ToolPayload = {
    ...payload,
    artifacts,
    objectReferences: mergeObjectReferences(
      Array.isArray(payload.objectReferences) ? payload.objectReferences : [],
      backendOutputObjectReferences(outputRel, artifacts),
    ),
  };
  await mkdir(dirname(join(workspace, outputRel)), { recursive: true });
  await writeFile(join(workspace, outputRel), JSON.stringify(materialized, null, 2));
  return materialized;
}

type ReadableTargetFormat = 'markdown' | 'html' | 'csv' | 'tsv' | 'text' | 'json' | 'binary' | 'unknown';

async function materializeArtifactDelivery({
  workspace,
  outputRel,
  artifact,
}: {
  workspace: string;
  outputRel: string;
  artifact: Record<string, unknown>;
}): Promise<{
  contract: ArtifactDelivery;
  errors: string[];
  readableRel?: string;
  targetFormat: ReadableTargetFormat;
}> {
  const targetFormat = targetFormatForArtifact(artifact);
  const readable = unwrapReadableContent(artifact, targetFormat);
  const readableRel = readable && targetFormat !== 'json' && targetFormat !== 'binary' && targetFormat !== 'unknown'
    ? readableTaskResultRel(outputRel, artifact, extensionForTargetFormat(targetFormat))
    : undefined;
  if (readable && readableRel) {
    await mkdir(dirname(join(workspace, readableRel)), { recursive: true });
    await writeFile(join(workspace, readableRel), readable);
  }
  const existingRef = stableWorkspaceRef(stringField(artifact.dataRef)) ?? stableWorkspaceRef(stringField(artifact.path));
  const role = artifactDeliveryRole(artifact, Boolean(readableRel));
  const contentShape = readableRel
    ? 'raw-file'
    : targetFormat === 'json'
      ? 'json-envelope'
      : targetFormat === 'binary'
        ? 'binary-ref'
        : existingRef && /^[a-z]+:\/\//i.test(existingRef)
          ? 'external-ref'
          : 'raw-file';
  const previewPolicy = role === 'audit' || role === 'diagnostic' || role === 'internal'
    ? 'audit-only'
    : readableRel || (existingRef && ['markdown', 'html', 'csv', 'tsv', 'text', 'json'].includes(targetFormat))
      ? 'inline'
      : targetFormat === 'binary'
        ? 'open-system'
        : 'unsupported';
  const contract: ArtifactDelivery = {
    contractId: 'sciforge.artifact-delivery.v1',
    ref: `artifact:${String(artifact.id || artifact.type || 'artifact')}`,
    role,
    declaredMediaType: mediaTypeForTargetFormat(targetFormat),
    declaredExtension: extensionForTargetFormat(targetFormat),
    contentShape,
    readableRef: readableRel ?? existingRef,
    rawRef: outputRel,
    previewPolicy,
  };
  return {
    contract,
    errors: validateArtifactDeliveryContract({
      id: String(artifact.id || artifact.type || 'artifact'),
      dataRef: readableRel ?? existingRef,
      path: stringField(artifact.path),
      delivery: contract,
    }),
    readableRel,
    targetFormat,
  };
}

function unwrapReadableContent(artifact: Record<string, unknown>, targetFormat: ReadableTargetFormat): string | undefined {
  if (!['markdown', 'html', 'csv', 'tsv', 'text'].includes(targetFormat)) return undefined;
  const fields = readableFieldCandidates(targetFormat);
  for (const source of [artifact.data, artifact]) {
    const unwrapped = unwrapReadableContentFromValue(source, fields);
    if (unwrapped) return unwrapped;
  }
  return undefined;
}

function unwrapReadableContentFromValue(value: unknown, fields: string[]): string | undefined {
  if (typeof value === 'string') {
    const parsed = parseJsonObjectPrefix(value);
    if (parsed) return unwrapReadableContentFromValue(parsed, fields);
    return looksReadableInlineText(value) ? value : undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const field of fields) {
    const text = value[field];
    if (typeof text === 'string' && looksReadableInlineText(text)) return text;
  }
  return undefined;
}

function parseJsonObjectPrefix(value: string) {
  const text = value.trim();
  if (!text.startsWith('{') || text.length > 64_000) return undefined;
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function looksReadableInlineText(value: string) {
  const text = value.trim();
  return text.length > 0 && !text.startsWith('{') && !text.startsWith('[');
}

function readableFieldCandidates(targetFormat: ReadableTargetFormat) {
  if (targetFormat === 'markdown') return ['markdown', 'reportMarkdown', 'report', 'content', 'text'];
  if (targetFormat === 'html') return ['html', 'content', 'text'];
  if (targetFormat === 'csv') return ['csv', 'content', 'text'];
  if (targetFormat === 'tsv') return ['tsv', 'content', 'text'];
  return ['text', 'content'];
}

function targetFormatForArtifact(artifact: Record<string, unknown>): ReadableTargetFormat {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const declared = [
    stringField(artifact.dataRef),
    stringField(artifact.path),
    stringField(metadata.markdownRef),
    stringField(metadata.reportRef),
    stringField(metadata.path),
    stringField(metadata.filePath),
  ].find(Boolean);
  const type = String(artifact.type || artifact.id || '').toLowerCase();
  const ref = (declared ?? '').toLowerCase();
  if (/\.m(?:d|arkdown)(?:$|[?#])/.test(ref) || /report|markdown|summary|text/.test(type)) return 'markdown';
  if (/\.html?(?:$|[?#])/.test(ref) || /html/.test(type)) return 'html';
  if (/\.csv(?:$|[?#])/.test(ref) || /csv|table|matrix|dataset/.test(type)) return 'csv';
  if (/\.tsv(?:$|[?#])/.test(ref)) return 'tsv';
  if (/\.txt(?:$|[?#])/.test(ref)) return 'text';
  if (/\.json(?:$|[?#])/.test(ref) || /json|payload|manifest|schema/.test(type)) return 'json';
  if (/\.(?:pdf|png|jpe?g|gif|webp|svg|docx?|xlsx?|pptx?)(?:$|[?#])/.test(ref)) return 'binary';
  return 'unknown';
}

function artifactDeliveryRole(artifact: Record<string, unknown>, hasReadableRef: boolean): ArtifactDelivery['role'] {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const explicit = stringField(artifact.presentationRole) ?? stringField(metadata.presentationRole);
  if (isArtifactDeliveryRole(explicit)) return explicit;
  const type = String(artifact.type || artifact.id || '').toLowerCase();
  const ref = [artifact.dataRef, artifact.path, metadata.artifactRef, metadata.outputRef].map(stringField).filter(Boolean).join(' ').toLowerCase();
  if (/stdout|stderr|log|diagnostic|failure|error/.test(`${type} ${ref}`)) return 'diagnostic';
  if (/runtime|execution-unit|trace|audit|checkpoint|payload|raw|context-summary/.test(`${type} ${ref}`)) return 'audit';
  if (hasReadableRef || /report|summary|markdown|document|html|table|matrix|dataset|paper-list|evidence/.test(type)) {
    return /report|summary|markdown|document/.test(type) ? 'primary-deliverable' : 'supporting-evidence';
  }
  return 'internal';
}

function isArtifactDeliveryRole(value: string | undefined): value is ArtifactDelivery['role'] {
  return value === 'primary-deliverable'
    || value === 'supporting-evidence'
    || value === 'audit'
    || value === 'diagnostic'
    || value === 'internal';
}

function extensionForTargetFormat(targetFormat: ReadableTargetFormat) {
  if (targetFormat === 'markdown') return 'md';
  if (targetFormat === 'html') return 'html';
  if (targetFormat === 'csv') return 'csv';
  if (targetFormat === 'tsv') return 'tsv';
  if (targetFormat === 'text') return 'txt';
  if (targetFormat === 'json') return 'json';
  return 'bin';
}

function mediaTypeForTargetFormat(targetFormat: ReadableTargetFormat) {
  if (targetFormat === 'markdown') return 'text/markdown';
  if (targetFormat === 'html') return 'text/html';
  if (targetFormat === 'csv') return 'text/csv';
  if (targetFormat === 'tsv') return 'text/tab-separated-values';
  if (targetFormat === 'text') return 'text/plain';
  if (targetFormat === 'json') return 'application/json';
  return 'application/octet-stream';
}

export async function persistArtifactRefsForPayload(
  workspace: string,
  request: GatewayRequest,
  artifacts: Array<Record<string, unknown>>,
  refs: RuntimeRefBundle,
) {
  const sessionId = isRecord(request.uiState) && typeof request.uiState.sessionId === 'string'
    ? request.uiState.sessionId
    : 'sessionless';
  const sessionBundleRel = sessionBundleRelForRequest(request);
  await ensureSessionBundle(workspace, sessionBundleRel, {
    sessionId,
    scenarioId: request.scenarioPackageRef?.id || request.skillDomain,
    createdAt: typeof request.uiState?.sessionCreatedAt === 'string' ? request.uiState.sessionCreatedAt : undefined,
    updatedAt: typeof request.uiState?.sessionUpdatedAt === 'string' ? request.uiState.sessionUpdatedAt : undefined,
  });
  const out: Array<Record<string, unknown>> = [];
  for (const artifact of artifacts) {
    const id = safeArtifactId(String(artifact.id || artifact.type || 'artifact'));
    const type = safeArtifactId(String(artifact.type || artifact.id || 'artifact'));
    const artifactHash = sha1(JSON.stringify(clipForAgentServerJson(artifact, 4))).slice(0, 12);
    const rel = sessionBundleResourceRel(sessionBundleRel, 'artifacts', `${type}-${id}-${artifactHash}.json`);
    const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
    const record = {
      ...artifact,
      producerScenario: typeof artifact.producerScenario === 'string' ? artifact.producerScenario : request.skillDomain,
      producerSessionId: sessionId,
      dataRef: typeof artifact.dataRef === 'string' ? artifact.dataRef : refs.outputRel,
      metadata: {
        ...metadata,
        artifactRef: rel,
        outputRef: metadata.outputRef ?? refs.outputRel,
        taskCodeRef: metadata.taskCodeRef ?? refs.taskRel,
        stdoutRef: metadata.stdoutRef ?? refs.stdoutRel,
        stderrRef: metadata.stderrRef ?? refs.stderrRel,
        persistedAt: new Date().toISOString(),
      },
    };
    try {
      await mkdir(dirname(join(workspace, rel)), { recursive: true });
      await writeFile(join(workspace, rel), JSON.stringify(record, null, 2));
    } catch {
      // Artifact refs improve multi-turn recovery, but a write failure should not hide the task result.
    }
    out.push(record);
  }
  return out;
}

export function safeArtifactId(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'artifact';
}

function stableTaskResultRef(value: string) {
  const ref = stableWorkspaceRef(value);
  return ref && (
    /^\.sciforge\/task-results\/[^/].+/.test(ref)
    || /^\.sciforge\/sessions\/[^/]+\/task-results\/[^/].+/.test(ref)
  ) ? ref : undefined;
}

function stableWorkspaceRef(value: string | undefined) {
  if (!value || /^[a-z]+:\/\//i.test(value)) return undefined;
  const ref = value.replace(/^file:/, '').replace(/^path:/, '').replace(/\\/g, '/').replace(/^\/+/, '');
  return ref.startsWith('.sciforge/') ? ref : undefined;
}

function readableTaskResultRel(outputRel: string, artifact: Record<string, unknown>, extension: string) {
  const outputName = outputRel.split('/').pop() ?? 'result.json';
  const outputStem = outputName.replace(/\.[^.]+$/, '') || 'result';
  const id = safeArtifactId(String(artifact.id || artifact.type || 'artifact'));
  return `${dirname(outputRel)}/${safeArtifactId(outputStem)}-${id}.${extension}`;
}

function backendOutputObjectReferences(
  outputRel: string,
  artifacts: Array<Record<string, unknown>>,
) {
  const runId = outputRel.split('/').pop()?.replace(/\.[^.]+$/, '') || outputRel;
  return [
    {
      id: `run:${runId}`,
      title: runId,
      kind: 'run',
      ref: `run:${runId}`,
      status: 'available',
      actions: ['inspect', 'resume'],
      presentationRole: 'audit',
      provenance: { outputRef: outputRel },
    },
    ...artifacts.flatMap((artifact) => {
      const id = String(artifact.id || artifact.type || 'artifact');
      const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
      const delivery = isRecord(artifact.delivery) ? artifact.delivery : {};
      const role = stringField(delivery.role);
      const readableRef = stringField(delivery.readableRef);
      const previewPolicy = stringField(delivery.previewPolicy);
      if (!readableRef || previewPolicy === 'audit-only' || previewPolicy === 'unsupported' || (role !== 'primary-deliverable' && role !== 'supporting-evidence')) {
        return [];
      }
      return [{
        id: `artifact:${id}`,
        title: stringField(metadata.title) ?? id,
        kind: 'artifact',
        ref: `artifact:${id}`,
        artifactType: String(artifact.type || id),
        runId,
        status: 'available',
        presentationRole: role,
        actions: ['focus-right-pane', 'inspect', 'copy-path', 'pin'],
        provenance: {
          dataRef: readableRef,
          path: readableRef,
          outputRef: outputRel,
          rawRef: stringField(delivery.rawRef),
          artifactRef: stringField(metadata.artifactRef),
        },
      }];
    }),
  ];
}

function mergeObjectReferences(
  base: Array<Record<string, unknown>>,
  additions: Array<Record<string, unknown>>,
) {
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const reference of [...base, ...additions]) {
    const key = canonicalObjectReferenceKey(reference);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(reference);
  }
  return out;
}

function canonicalObjectReferenceKey(reference: Record<string, unknown>) {
  const provenance = isRecord(reference.provenance) ? reference.provenance : {};
  return normalizeObjectReferenceIdentity(
    stringField(provenance.path)
      ?? stringField(provenance.dataRef)
      ?? stringField(reference.ref)
      ?? stringField(reference.id),
  );
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

export async function normalizeArtifactsForPayload(
  artifacts: Array<Record<string, unknown>>,
  workspace: string,
  refs?: RuntimeRefBundle,
) {
  return await Promise.all(artifacts.map(async (artifact): Promise<Record<string, unknown>> => {
    const scoped = refs ? scopeArtifactRefsToTaskResultDirectory(artifact, refs.outputRel) : artifact;
    const enriched = await enrichArtifactDataFromFileRefs(scoped, workspace);
    const metadata = isRecord(enriched.metadata) ? enriched.metadata : {};
    return {
      ...enriched,
      dataRef: typeof enriched.dataRef === 'string' ? enriched.dataRef : refs?.outputRel,
      metadata: refs ? {
        ...metadata,
        taskCodeRef: metadata.taskCodeRef ?? refs.taskRel,
        outputRef: metadata.outputRef ?? refs.outputRel,
        stdoutRef: metadata.stdoutRef ?? refs.stdoutRel,
        stderrRef: metadata.stderrRef ?? refs.stderrRel,
      } : metadata,
    };
  }));
}

function scopeArtifactRefsToTaskResultDirectory(artifact: Record<string, unknown>, outputRel: string) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const scopedMetadata = {
    ...metadata,
    reportRef: scopedArtifactRef(stringField(metadata.reportRef), outputRel),
    markdownRef: scopedArtifactRef(stringField(metadata.markdownRef), outputRel),
    path: scopedArtifactRef(stringField(metadata.path), outputRel),
    filePath: scopedArtifactRef(stringField(metadata.filePath), outputRel),
  };
  return {
    ...artifact,
    dataRef: scopedArtifactRef(stringField(artifact.dataRef), outputRel),
    path: scopedArtifactRef(stringField(artifact.path), outputRel),
    ref: scopedArtifactRef(stringField(artifact.ref), outputRel),
    metadata: scopedMetadata,
  };
}

function scopedArtifactRef(ref: string | undefined, outputRel: string) {
  if (!ref || /^[a-z]+:\/\//i.test(ref) || ref.startsWith('/')) return ref;
  if (/^[a-z][a-z0-9._-]*:/i.test(ref) && !/^file:|^path:/i.test(ref)) return ref;
  const normalized = ref.replace(/^file:/, '').replace(/^path:/, '').replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!normalized || normalized.startsWith('.sciforge/') || normalized.startsWith('../') || normalized.includes('/../')) return normalized || ref;
  return `${dirname(outputRel)}/${normalized}`;
}

export async function enrichArtifactDataFromFileRefs(artifact: Record<string, unknown>, workspace: string) {
  const currentData = isPlainDataRecord(artifact.data) ? artifact.data : {};
  const readResults: Record<string, unknown> = {};
  for (const request of artifactDataReadRequestsForPolicy(artifact)) {
    readResults[request.key] = request.kind === 'csv'
      ? await readCsvRef(request.ref, workspace)
      : await readTextRef(request.ref, workspace);
  }
  const data = normalizeArtifactDataWithPolicy(artifact, {
    ...await artifactDataFromPayloadRef(artifact, workspace),
    ...await artifactDataFromArtifactPath(artifact, workspace),
    ...currentData,
  }, readResults);

  const pathRef = stringField(artifact.path);
  return Object.keys(data).length
    ? { ...artifact, data, dataRef: stringField(artifact.dataRef) ?? pathRef }
    : artifact;
}

async function artifactDataFromArtifactPath(artifact: Record<string, unknown>, workspace: string) {
  const path = safeWorkspaceFilePath(artifact.path, workspace);
  if (!path) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    const text = await readTextRef(artifact.path, workspace);
    return artifactDataForUnparsedPathText(artifact, text);
  }
  if (!isRecord(parsed)) return {};
  const { type: _type, id: _id, ...rest } = parsed;
  return rest;
}

async function artifactDataFromPayloadRef(artifact: Record<string, unknown>, workspace: string) {
  const ref = typeof artifact.dataRef === 'string'
    ? artifact.dataRef
    : isRecord(artifact.metadata) && typeof artifact.metadata.outputRef === 'string'
      ? artifact.metadata.outputRef
      : undefined;
  if (!ref) return {};
  const path = safeWorkspaceFilePath(ref, workspace);
  if (!path) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return {};
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.artifacts)) return {};
  const wantedId = typeof artifact.id === 'string' ? artifact.id : undefined;
  const wantedType = typeof artifact.type === 'string' ? artifact.type : wantedId;
  const match = parsed.artifacts
    .filter(isRecord)
    .find((candidate) => {
      const id = typeof candidate.id === 'string' ? candidate.id : undefined;
      const type = typeof candidate.type === 'string' ? candidate.type : undefined;
      return (wantedId && id === wantedId) || (wantedType && type === wantedType);
    });
  if (!match || !isPlainDataRecord(match.data)) return {};
  return match.data;
}

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

async function readTextRef(value: unknown, workspace: string) {
  const path = safeWorkspaceFilePath(value, workspace);
  if (!path) return undefined;
  try {
    return await readFile(path, 'utf8');
  } catch {
    const scanpyFallback = scanpyFigureFallbackPath(path, workspace);
    if (!scanpyFallback) return undefined;
    try {
      return await readFile(scanpyFallback, 'utf8');
    } catch {
      return undefined;
    }
  }
}

async function readCsvRef(value: unknown, workspace: string) {
  const text = await readTextRef(value, workspace);
  return text ? parseCsvRows(text) : [];
}

function safeWorkspaceFilePath(value: unknown, workspace: string) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const candidate = value.trim();
  const workspaceRoot = resolve(workspace);
  const absolute = candidate.startsWith('/') ? resolve(candidate) : resolve(workspaceRoot, candidate);
  return absolute.startsWith(`${workspaceRoot}/`) || absolute === workspaceRoot ? absolute : undefined;
}

function scanpyFigureFallbackPath(path: string, workspace: string) {
  if (!path.replaceAll('\\', '/').includes('/.sciforge/task-results/figures/')) return undefined;
  const basename = path.split('/').pop();
  if (!basename) return undefined;
  const normalizedName = basename.replace(/^rank_genes_groups_/, '');
  const candidate = resolve(workspace, 'figures', normalizedName);
  return candidate.startsWith(`${resolve(workspace)}/`) ? candidate : undefined;
}

function parseCsvRows(text: string) {
  const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim().length));
  const header = rows[0]?.map((cell) => cell.trim()) ?? [];
  if (!header.length) return [];
  return rows.slice(1).map((row) => Object.fromEntries(header.map((key, index) => [key, coerceCsvValue(row[index] ?? '')])));
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function coerceCsvValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : trimmed;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
