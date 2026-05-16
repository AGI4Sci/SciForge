import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
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
    const deliveryReadableRef = stringField(delivery.contract.readableRef);
    return {
      ...artifact,
      dataRef: deliveryReadableRef ?? stableWorkspaceRef(existingDataRef) ?? outputRel,
      delivery: delivery.contract,
      metadata: {
        ...metadata,
        outputRef: stableWorkspaceRef(stringField(metadata.outputRef)) ?? outputRel,
        taskCodeRef: stableWorkspaceRef(stringField(metadata.taskCodeRef)) ?? refs.taskRel,
        stdoutRef: stableWorkspaceRef(stringField(metadata.stdoutRef)) ?? refs.stdoutRel,
        stderrRef: stableWorkspaceRef(stringField(metadata.stderrRef)) ?? refs.stderrRel,
        ...materializedMarkdownMetadataForArtifact(metadata, delivery.targetFormat === 'markdown' ? deliveryReadableRef : undefined),
        readableRef: deliveryReadableRef ?? stableWorkspaceRef(existingDataRef),
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
  const existingRef = existingArtifactReadableRef(artifact, workspace, targetFormat);
  const existingRefMatchesTarget = Boolean(existingRef && refMatchesTargetFormat(existingRef, targetFormat));
  const preferExistingReadableRef = Boolean(
    existingRef
      && existingRefMatchesTarget
      && ['markdown', 'html', 'csv', 'tsv', 'text'].includes(targetFormat)
      && await workspaceRefIsFile(existingRef, workspace),
  );
  const readable = preferExistingReadableRef ? undefined : unwrapReadableContent(artifact, targetFormat);
  const readableRel = readable && targetFormat !== 'json' && targetFormat !== 'binary' && targetFormat !== 'unknown'
    ? readableTaskResultRel(outputRel, artifact, extensionForTargetFormat(targetFormat))
    : undefined;
  if (readable && readableRel) {
    await mkdir(dirname(join(workspace, readableRel)), { recursive: true });
    await writeFile(join(workspace, readableRel), readable);
  }
  const readableRef = preferExistingReadableRef ? existingRef : readableRel ?? existingRef;
  const readableRefMatchesTarget = Boolean(readableRef && refMatchesTargetFormat(readableRef, targetFormat));
  const hasReadableDeliveryTarget = Boolean(
    readableRel
      || (readableRef && readableRefMatchesTarget && targetFormat !== 'json' && targetFormat !== 'unknown'),
  );
  const role = artifactDeliveryRole(artifact, hasReadableDeliveryTarget);
  const declaredExtension = extensionForTargetFormat(targetFormat, readableRefMatchesTarget ? readableRef : undefined);
  const contentShape = readableRel
    ? 'raw-file'
    : targetFormat === 'json'
      ? 'json-envelope'
      : targetFormat === 'binary'
        ? 'binary-ref'
        : readableRef && /^[a-z]+:\/\//i.test(readableRef)
          ? 'external-ref'
          : 'raw-file';
  const previewPolicy = role === 'audit' || role === 'diagnostic' || role === 'internal'
    ? 'audit-only'
    : readableRel || (readableRef && readableRefMatchesTarget && ['markdown', 'html', 'csv', 'tsv', 'text'].includes(targetFormat))
      ? 'inline'
      : targetFormat === 'binary' && readableRef
        ? 'open-system'
        : 'unsupported';
  const contract: ArtifactDelivery = {
    contractId: 'sciforge.artifact-delivery.v1',
    ref: `artifact:${String(artifact.id || artifact.type || 'artifact')}`,
    role,
    declaredMediaType: mediaTypeForTargetFormat(targetFormat, declaredExtension),
    declaredExtension,
    contentShape,
    readableRef,
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
    stringField(artifact.path),
    stringField(metadata.readableRef),
    stringField(artifact.dataRef),
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

function existingArtifactReadableRef(
  artifact: Record<string, unknown>,
  workspace: string,
  targetFormat: ReadableTargetFormat,
) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const candidates = [
    stringField(artifact.path),
    stringField(metadata.readableRef),
    stringField(artifact.dataRef),
    stringField(metadata.markdownRef),
    stringField(metadata.reportRef),
    stringField(metadata.path),
    stringField(metadata.filePath),
  ].map((ref) => stableWorkspaceRef(ref, workspace)).filter((ref): ref is string => Boolean(ref));
  return candidates.find((ref) => refMatchesTargetFormat(ref, targetFormat)) ?? candidates[0];
}

function refMatchesTargetFormat(ref: string, targetFormat: ReadableTargetFormat) {
  const extension = ref.replace(/[?#].*$/, '').match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
  if (!extension) return false;
  if (targetFormat === 'markdown') return extension === 'md' || extension === 'markdown';
  if (targetFormat === 'html') return extension === 'html' || extension === 'htm';
  if (targetFormat === 'csv') return extension === 'csv';
  if (targetFormat === 'tsv') return extension === 'tsv';
  if (targetFormat === 'text') return extension === 'txt' || extension === 'log';
  if (targetFormat === 'json') return extension === 'json';
  if (targetFormat === 'binary') return /^(?:pdf|png|jpe?g|gif|webp|svg|docx?|xlsx?|pptx?)$/.test(extension);
  return false;
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

function extensionForTargetFormat(targetFormat: ReadableTargetFormat, readableRef?: string) {
  const explicit = readableRef?.replace(/[?#].*$/, '').match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
  if (explicit) return explicit;
  if (targetFormat === 'markdown') return 'md';
  if (targetFormat === 'html') return 'html';
  if (targetFormat === 'csv') return 'csv';
  if (targetFormat === 'tsv') return 'tsv';
  if (targetFormat === 'text') return 'txt';
  if (targetFormat === 'json') return 'json';
  return 'bin';
}

function mediaTypeForTargetFormat(targetFormat: ReadableTargetFormat, extension?: string) {
  if (targetFormat === 'markdown') return 'text/markdown';
  if (targetFormat === 'html') return 'text/html';
  if (targetFormat === 'csv') return 'text/csv';
  if (targetFormat === 'tsv') return 'text/tab-separated-values';
  if (targetFormat === 'text') return 'text/plain';
  if (targetFormat === 'json') return 'application/json';
  if (targetFormat === 'binary' && extension && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)) {
    return `image/${extension === 'jpg' ? 'jpeg' : extension}`;
  }
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

function stableWorkspaceRef(value: string | undefined, workspace?: string) {
  if (!value || /^[a-z]+:\/\//i.test(value)) return undefined;
  let normalized = value.replace(/^file:/, '').replace(/^path:/, '').replace(/\\/g, '/');
  if (workspace && normalized.startsWith('/')) {
    const workspaceRoot = resolve(workspace).replace(/\\/g, '/');
    const absolute = resolve(normalized).replace(/\\/g, '/');
    if (absolute === workspaceRoot) return undefined;
    if (!absolute.startsWith(`${workspaceRoot}/`)) return undefined;
    normalized = absolute.slice(workspaceRoot.length + 1);
  }
  const ref = normalized.replace(/^\/+/, '');
  return ref.startsWith('.sciforge/') ? ref : undefined;
}

async function workspaceRefIsFile(ref: string, workspace: string) {
  const path = safeWorkspaceFilePath(ref, workspace);
  if (!path) return false;
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
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
    const scoped = refs ? await scopeArtifactRefsToTaskResultDirectory(artifact, refs.outputRel, workspace) : artifact;
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

async function scopeArtifactRefsToTaskResultDirectory(artifact: Record<string, unknown>, outputRel: string, workspace: string) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const reportRef = await scopedArtifactRef(stringField(metadata.reportRef), outputRel, workspace);
  const markdownRef = await scopedArtifactRef(stringField(metadata.markdownRef), outputRel, workspace);
  const metadataPath = await scopedArtifactRef(stringField(metadata.path), outputRel, workspace);
  const metadataFilePath = await scopedArtifactRef(stringField(metadata.filePath), outputRel, workspace);
  const scopedMetadata = {
    ...metadata,
    reportRef,
    markdownRef,
    path: metadataPath,
    filePath: metadataFilePath,
  };
  const dataRef = await scopedArtifactRef(stringField(artifact.dataRef), outputRel, workspace);
  const path = await scopedArtifactRef(stringField(artifact.path), outputRel, workspace);
  const ref = await scopedArtifactRef(stringField(artifact.ref), outputRel, workspace);
  return {
    ...artifact,
    dataRef,
    path,
    ref,
    metadata: scopedMetadata,
  };
}

async function scopedArtifactRef(ref: string | undefined, outputRel: string, workspace: string) {
  if (!ref || /^[a-z]+:\/\//i.test(ref) || ref.startsWith('/')) return ref;
  if (/^[a-z][a-z0-9._-]*:/i.test(ref) && !/^file:|^path:/i.test(ref)) return ref;
  const normalized = ref.replace(/^file:/, '').replace(/^path:/, '').replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!normalized || normalized.startsWith('.sciforge/') || normalized.startsWith('../') || normalized.includes('/../')) return normalized || ref;
  const scoped = `${dirname(outputRel)}/${normalized}`;
  await copyWorkspaceFileRefIfPresent(normalized, scoped, workspace);
  return scoped;
}

async function copyWorkspaceFileRefIfPresent(sourceRel: string, scopedRel: string, workspace: string) {
  const sourcePath = safeWorkspaceFilePath(sourceRel, workspace);
  const targetPath = safeWorkspaceFilePath(scopedRel, workspace);
  if (!sourcePath || !targetPath || sourcePath === targetPath) return;
  try {
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  } catch {
    // Missing optional workspace file refs remain audit-visible but should not fail payload normalization.
  }
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
