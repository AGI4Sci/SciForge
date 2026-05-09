import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  artifactDataForUnparsedPathText,
  artifactDataReadRequestsForPolicy,
  materializedMarkdownMetadataForArtifact,
  materializedMarkdownTextForArtifact,
  normalizeArtifactDataWithPolicy,
} from '@sciforge-ui/runtime-contract/artifact-policy';
import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { clipForAgentServerJson, isRecord } from '../gateway-utils.js';
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

  const markdownRefs: string[] = [];
  const artifacts = await Promise.all(payload.artifacts.map(async (artifact) => {
    const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
    const markdown = materializedMarkdownTextForArtifact(artifact);
    const markdownRel = markdown
      ? markdownTaskResultRel(outputRel, artifact)
      : undefined;
    if (markdown && markdownRel) {
      await mkdir(dirname(join(workspace, markdownRel)), { recursive: true });
      await writeFile(join(workspace, markdownRel), markdown);
      markdownRefs.push(markdownRel);
    }
    const existingDataRef = stringField(artifact.dataRef);
    return {
      ...artifact,
      dataRef: stableWorkspaceRef(existingDataRef) ?? markdownRel ?? outputRel,
      metadata: {
        ...metadata,
        outputRef: stableWorkspaceRef(stringField(metadata.outputRef)) ?? outputRel,
        taskCodeRef: stableWorkspaceRef(stringField(metadata.taskCodeRef)) ?? refs.taskRel,
        stdoutRef: stableWorkspaceRef(stringField(metadata.stdoutRef)) ?? refs.stdoutRel,
        stderrRef: stableWorkspaceRef(stringField(metadata.stderrRef)) ?? refs.stderrRel,
        ...materializedMarkdownMetadataForArtifact(metadata, markdownRel),
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
      backendOutputObjectReferences(outputRel, markdownRefs, artifacts),
    ),
  };
  await mkdir(dirname(join(workspace, outputRel)), { recursive: true });
  await writeFile(join(workspace, outputRel), JSON.stringify(materialized, null, 2));
  return materialized;
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
  const out: Array<Record<string, unknown>> = [];
  for (const artifact of artifacts) {
    const id = safeArtifactId(String(artifact.id || artifact.type || 'artifact'));
    const type = safeArtifactId(String(artifact.type || artifact.id || 'artifact'));
    const artifactHash = sha1(JSON.stringify(clipForAgentServerJson(artifact, 4))).slice(0, 12);
    const rel = `.sciforge/artifacts/${safeArtifactId(sessionId)}-${type}-${id}-${artifactHash}.json`;
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
  return ref && /^\.sciforge\/task-results\/[^/].+/.test(ref) ? ref : undefined;
}

function stableWorkspaceRef(value: string | undefined) {
  if (!value || /^[a-z]+:\/\//i.test(value)) return undefined;
  const ref = value.replace(/^file:/, '').replace(/^path:/, '').replace(/\\/g, '/').replace(/^\/+/, '');
  return ref.startsWith('.sciforge/') ? ref : undefined;
}

function markdownTaskResultRel(outputRel: string, artifact: Record<string, unknown>) {
  const outputName = outputRel.split('/').pop() ?? 'result.json';
  const outputStem = outputName.replace(/\.[^.]+$/, '') || 'result';
  const id = safeArtifactId(String(artifact.id || artifact.type || 'artifact'));
  return `.sciforge/task-results/${safeArtifactId(outputStem)}-${id}.md`;
}

function backendOutputObjectReferences(
  outputRel: string,
  markdownRefs: string[],
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
      provenance: { outputRef: outputRel },
    },
    fileObjectReference(outputRel),
    ...markdownRefs.map((ref) => fileObjectReference(ref)),
    ...artifacts.map((artifact) => {
      const id = String(artifact.id || artifact.type || 'artifact');
      const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
      return {
        id: `artifact:${id}`,
        title: stringField(metadata.title) ?? id,
        kind: 'artifact',
        ref: `artifact:${id}`,
        artifactType: String(artifact.type || id),
        runId,
        status: 'available',
        actions: ['inspect', 'copy-path', 'pin'],
        provenance: {
          dataRef: stringField(artifact.dataRef),
          outputRef: outputRel,
          artifactRef: stringField(metadata.artifactRef),
        },
      };
    }),
  ];
}

function fileObjectReference(ref: string) {
  return {
    id: `file:${ref}`,
    title: ref.split('/').pop() || ref,
    kind: 'file',
    ref: `file:${ref}`,
    status: 'available',
    actions: ['inspect', 'reveal-in-folder', 'copy-path'],
    provenance: { path: ref },
  };
}

function mergeObjectReferences(
  base: Array<Record<string, unknown>>,
  additions: Array<Record<string, unknown>>,
) {
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const reference of [...base, ...additions]) {
    const key = stringField(reference.ref) ?? stringField(reference.id);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(reference);
  }
  return out;
}

export async function normalizeArtifactsForPayload(
  artifacts: Array<Record<string, unknown>>,
  workspace: string,
  refs?: RuntimeRefBundle,
) {
  return await Promise.all(artifacts.map(async (artifact): Promise<Record<string, unknown>> => {
    const enriched = await enrichArtifactDataFromFileRefs(artifact, workspace);
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
