import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type {
  BackendObjectRefKind,
  ListSessionArtifactsInput,
  ListSessionArtifactsResult,
  ObjectReference,
  ReadArtifactInput,
  ReadArtifactResult,
  RenderArtifactInput,
  RenderArtifactResult,
  ResolveObjectReferenceInput,
  ResolveObjectReferenceResult,
  ResumeRunInput,
  ResumeRunResult,
  RuntimeArtifact,
} from '@sciforge-ui/runtime-contract';
import { isRecord, toRecordList, uniqueStrings } from './gateway-utils.js';
import { normalizeArtifactsForPayload } from './gateway/artifact-materializer.js';
import { readRecentTaskAttempts, readTaskAttempts } from './task-attempt-history.js';
import { resolveWorkspacePreviewRef } from './workspace-paths.js';

export async function listSessionArtifacts(input: ListSessionArtifactsInput): Promise<ListSessionArtifactsResult> {
  const workspace = resolve(input.workspacePath || process.cwd());
  const artifacts = await collectBackendArtifacts(input, workspace);
  return {
    tool: 'list_session_artifacts',
    artifacts,
    objectReferences: artifacts.map((artifact) => artifactObjectReference(artifact)),
  };
}

export async function resolveObjectReference(input: ResolveObjectReferenceInput): Promise<ResolveObjectReferenceResult> {
  const workspace = resolve(input.workspacePath || process.cwd());
  const ref = input.ref.trim();
  const refKind = classifyBackendRef(ref);

  if (refKind === 'artifact') {
    const artifacts = await collectBackendArtifacts(input, workspace);
    const artifact = findArtifactByRef(artifacts, ref);
    if (!artifact) return missingResolution(ref, refKind, 'Artifact reference was not found in session artifacts.');
    const reference = artifactObjectReference(artifact);
    return {
      tool: 'resolve_object_reference',
      refKind,
      reference,
      status: 'resolved',
      artifact,
      path: artifactPath(workspace, artifact),
      actions: reference.actions ?? [],
    };
  }

  if (refKind === 'file' || refKind === 'workspace') {
    const path = resolveFileLikeRef(ref, workspace);
    if (!path) return missingResolution(ref, refKind, 'File reference could not be resolved inside the workspace.');
    const reference = fileObjectReference(ref, path);
    return {
      tool: 'resolve_object_reference',
      refKind,
      reference,
      status: existsSync(path) ? 'resolved' : 'missing',
      path,
      reason: existsSync(path) ? undefined : 'File does not exist.',
      actions: reference.actions ?? [],
    };
  }

  const reference = genericObjectReference(ref, refKind);
  return {
    tool: 'resolve_object_reference',
    refKind,
    reference,
    status: ref ? 'resolved' : 'missing',
    reason: ref ? undefined : 'Reference is empty.',
    actions: reference.actions ?? [],
  };
}

export async function readArtifact(input: ReadArtifactInput): Promise<ReadArtifactResult> {
  const resolution = await resolveObjectReference(input);
  if (resolution.status !== 'resolved') {
    return {
      tool: 'read_artifact',
      reference: resolution.reference,
      status: resolution.status,
      reason: resolution.reason,
    };
  }

  if (resolution.artifact) {
    const [artifactRecord] = await normalizeArtifactsForPayload([{ ...resolution.artifact }], resolve(input.workspacePath || process.cwd()));
    const artifact = normalizeRuntimeArtifact(artifactRecord, input);
    return {
      tool: 'read_artifact',
      reference: artifactObjectReference(artifact),
      artifact,
      content: artifact.data ?? artifact,
      text: artifactText(artifact as unknown as Record<string, unknown>),
      mimeType: artifactMimeType(artifact),
      status: 'read',
    };
  }

  if (resolution.path && existsSync(resolution.path)) {
    const text = await readFile(resolution.path, 'utf8');
    return {
      tool: 'read_artifact',
      reference: resolution.reference,
      content: text,
      text,
      mimeType: mimeTypeForPath(resolution.path),
      status: 'read',
    };
  }

  return {
    tool: 'read_artifact',
    reference: resolution.reference,
    status: 'missing',
    reason: resolution.reason ?? 'Reference has no readable artifact or file target.',
  };
}

export async function renderArtifact(input: RenderArtifactInput): Promise<RenderArtifactResult> {
  const read = await readArtifact(input);
  const format = input.format ?? 'markdown';
  if (read.status !== 'read') {
    return {
      tool: 'render_artifact',
      reference: read.reference,
      format,
      status: read.status,
      reason: read.reason,
    };
  }

  return {
    tool: 'render_artifact',
    reference: read.reference,
    format,
    rendered: renderArtifactContent(read, format),
    status: 'rendered',
  };
}

export async function resumeRun(input: ResumeRunInput): Promise<ResumeRunResult> {
  const workspace = resolve(input.workspacePath || process.cwd());
  const runId = input.ref.replace(/^run:/i, '').split('#')[0];
  const attempts = runId ? await readTaskAttempts(workspace, runId) : [];
  const latest = attempts.at(-1);
  const refs = latest ? [
    latest.codeRef,
    latest.inputRef,
    latest.outputRef,
    latest.stdoutRef,
    latest.stderrRef,
  ].filter((ref): ref is string => Boolean(ref)).map((ref) => fileObjectReference(ref, resolveFileLikeRef(ref, workspace) ?? ref)) : [];
  return {
    tool: 'resume_run',
    runRef: runId ? `run:${runId}` : input.ref,
    status: latest ? 'resume-requested' : 'missing',
    objectReferences: [genericObjectReference(runId ? `run:${runId}` : input.ref, 'run'), ...refs],
    reason: latest ? input.reason : 'Run reference was not found in task attempts.',
  };
}

async function collectBackendArtifacts(input: ListSessionArtifactsInput, workspace: string): Promise<RuntimeArtifact[]> {
  const inline = toRecordList(input.artifacts).map((artifact) => normalizeRuntimeArtifact(artifact, input));
  const persisted = await readPersistedArtifacts(input, workspace);
  const attempts = await readArtifactsFromRecentAttempts(input, workspace);
  const artifacts = await normalizeArtifactsForPayload(dedupeArtifacts([...inline.map((artifact) => ({ ...artifact })), ...persisted, ...attempts]), workspace);
  return artifacts
    .map((artifact) => normalizeRuntimeArtifact(artifact, input))
    .slice(0, input.limit ?? 24);
}

async function readPersistedArtifacts(input: ListSessionArtifactsInput, workspace: string) {
  const dir = join(workspace, '.sciforge', 'artifacts');
  if (!existsSync(dir)) return [] as Array<Record<string, unknown>>;
  const files = await readdir(dir).catch(() => []);
  const entries: Array<{ artifact: Record<string, unknown>; mtimeMs: number } | undefined> = await Promise.all(files
    .filter((file) => file.endsWith('.json'))
    .map(async (file) => {
      const rel = `.sciforge/artifacts/${file}`;
      try {
        const [stats, text] = await Promise.all([stat(join(workspace, rel)), readFile(join(workspace, rel), 'utf8')]);
        const parsed = JSON.parse(text);
        return isRecord(parsed) ? { artifact: { ...parsed, dataRef: stringField(parsed.dataRef) ?? rel }, mtimeMs: stats.mtimeMs } : undefined;
      } catch {
        return undefined;
      }
    }));
  return entries
    .filter((entry): entry is { artifact: Record<string, unknown>; mtimeMs: number } => Boolean(entry))
    .filter((entry) => artifactMatchesInput(entry.artifact, input))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .map((entry) => entry.artifact);
}

async function readArtifactsFromRecentAttempts(input: ListSessionArtifactsInput, workspace: string) {
  const attempts = await readRecentTaskAttempts(workspace, input.skillDomain, input.limit ?? 8);
  const artifacts: Array<Record<string, unknown>> = [];
  for (const attempt of attempts) {
    if (!attempt.outputRef) continue;
    const path = resolveFileLikeRef(attempt.outputRef, workspace);
    if (!path || !existsSync(path)) continue;
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'));
      const outputArtifacts = isRecord(parsed) && Array.isArray(parsed.artifacts) ? toRecordList(parsed.artifacts) : [];
      artifacts.push(...outputArtifacts.map((artifact) => ({
        ...artifact,
        dataRef: stringField(artifact.dataRef) ?? attempt.outputRef,
        metadata: {
          ...(isRecord(artifact.metadata) ? artifact.metadata : {}),
          outputRef: attempt.outputRef,
          taskCodeRef: attempt.codeRef,
          stdoutRef: attempt.stdoutRef,
          stderrRef: attempt.stderrRef,
        },
      })));
    } catch {
      // Attempt outputs can be logs or partial files; unreadable entries are ignored by this listing helper.
    }
  }
  return artifacts.filter((artifact) => artifactMatchesInput(artifact, input));
}

function artifactMatchesInput(artifact: Record<string, unknown>, input: ListSessionArtifactsInput) {
  if (input.sessionId) {
    const haystack = [
      artifact.producerSessionId,
      artifact.sessionId,
      isRecord(artifact.metadata) ? artifact.metadata.producerSessionId : undefined,
      artifact.dataRef,
      artifact.path,
    ].map((value) => typeof value === 'string' ? value : '').join(' ');
    if (!haystack.includes(input.sessionId)) return false;
  }
  if (!input.skillDomain) return true;
  const producer = [
    artifact.producerScenario,
    artifact.producerScenarioId,
    isRecord(artifact.metadata) ? artifact.metadata.producerScenario : undefined,
    isRecord(artifact.metadata) ? artifact.metadata.skillDomain : undefined,
  ].map((value) => typeof value === 'string' ? value.toLowerCase() : '').join(' ');
  return !producer || producer.includes(input.skillDomain.toLowerCase());
}

function normalizeRuntimeArtifact(artifact: Record<string, unknown>, input: Pick<ListSessionArtifactsInput, 'skillDomain'>): RuntimeArtifact {
  const id = stringField(artifact.id) ?? stringField(artifact.type) ?? 'artifact';
  const type = stringField(artifact.type) ?? id;
  return {
    id,
    type,
    producerScenario: stringField(artifact.producerScenario) ?? input.skillDomain ?? 'runtime',
    schemaVersion: stringField(artifact.schemaVersion) ?? '1',
    metadata: isRecord(artifact.metadata) ? artifact.metadata : undefined,
    data: artifact.data,
    dataRef: stringField(artifact.dataRef),
    path: stringField(artifact.path),
    previewDescriptor: isRecord(artifact.previewDescriptor) ? artifact.previewDescriptor as unknown as RuntimeArtifact['previewDescriptor'] : undefined,
    visibility: artifact.visibility as RuntimeArtifact['visibility'],
    audience: Array.isArray(artifact.audience) ? artifact.audience.filter((entry): entry is string => typeof entry === 'string') : undefined,
    sensitiveDataFlags: Array.isArray(artifact.sensitiveDataFlags) ? artifact.sensitiveDataFlags.filter((entry): entry is string => typeof entry === 'string') : undefined,
    exportPolicy: artifact.exportPolicy as RuntimeArtifact['exportPolicy'],
  };
}

function dedupeArtifacts(artifacts: Array<Record<string, unknown>>) {
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const artifact of artifacts) {
    const key = uniqueStrings([
      stringField(artifact.id),
      stringField(artifact.type),
      stringField(artifact.dataRef),
      stringField(artifact.path),
    ].filter((value): value is string => Boolean(value))).join('|');
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(artifact);
  }
  return out;
}

function findArtifactByRef(artifacts: RuntimeArtifact[], rawRef: string) {
  const ref = rawRef.replace(/^artifact:/i, '');
  return artifacts.find((artifact) => artifact.id === ref)
    ?? artifacts.find((artifact) => artifact.type === ref)
    ?? artifacts.find((artifact) => artifact.dataRef === ref || artifact.path === ref)
    ?? artifacts.find((artifact) => artifact.dataRef === rawRef || artifact.path === rawRef);
}

function artifactObjectReference(artifact: RuntimeArtifact): ObjectReference {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  return {
    id: `artifact:${artifact.id}`,
    title: stringField(metadata.title) ?? stringField((artifact as unknown as Record<string, unknown>).title) ?? artifact.id,
    kind: 'artifact',
    ref: `artifact:${artifact.id}`,
    artifactType: artifact.type,
    runId: stringField(metadata.runId) ?? stringField(metadata.outputRef),
    actions: ['inspect', 'copy-path', 'pin'],
    status: 'available',
    summary: stringField(metadata.summary),
    provenance: {
      dataRef: artifact.dataRef,
      path: artifact.path,
      producer: artifact.producerScenario,
      version: artifact.schemaVersion,
    },
  };
}

function fileObjectReference(ref: string, path: string): ObjectReference {
  return {
    id: `file:${ref.replace(/^(file|path):/i, '')}`,
    title: basename(path),
    kind: 'file',
    ref: ref.startsWith('file:') ? ref : `file:${ref}`,
    actions: ['inspect', 'reveal-in-folder', 'copy-path'],
    status: existsSync(path) ? 'available' : 'missing',
    provenance: { path },
  };
}

function genericObjectReference(ref: string, refKind: BackendObjectRefKind): ObjectReference {
  const kind = refKind === 'agentserver' ? 'url' : refKind === 'workspace' ? 'folder' : refKind;
  return {
    id: `${refKind}:${ref.replace(/^[a-z-]+:/i, '')}`,
    title: ref || refKind,
    kind,
    ref,
    actions: refKind === 'agentserver' ? ['open-external', 'inspect'] : ['inspect', 'pin'],
    status: refKind === 'agentserver' ? 'external' : 'available',
  };
}

function missingResolution(ref: string, refKind: BackendObjectRefKind, reason: string): ResolveObjectReferenceResult {
  const reference = genericObjectReference(ref, refKind);
  return {
    tool: 'resolve_object_reference',
    refKind,
    reference: { ...reference, status: 'missing' },
    status: 'missing',
    reason,
    actions: reference.actions ?? [],
  };
}

function classifyBackendRef(ref: string): BackendObjectRefKind {
  if (/^agentserver:\/\//i.test(ref)) return 'agentserver';
  if (/^artifact:/i.test(ref)) return 'artifact';
  if (/^execution-?unit:/i.test(ref)) return 'execution-unit';
  if (/^run:/i.test(ref)) return 'run';
  if (/^(file|path):/i.test(ref) || /\.[A-Za-z0-9]{1,8}($|[#?])/.test(ref)) return 'file';
  return 'workspace';
}

function resolveFileLikeRef(ref: string, workspace: string) {
  try {
    return resolveWorkspacePreviewRef(ref, workspace);
  } catch {
    return undefined;
  }
}

function artifactPath(workspace: string, artifact: RuntimeArtifact) {
  const ref = artifact.path ?? artifact.dataRef;
  return ref ? resolveFileLikeRef(ref, workspace) : undefined;
}

function artifactText(artifact: Record<string, unknown>) {
  const data = isRecord(artifact.data) ? artifact.data : {};
  return stringField(data.markdown)
    ?? stringField(data.report)
    ?? stringField(data.content)
    ?? stringField(artifact.data)
    ?? stringField(artifact.markdown)
    ?? stringField(artifact.report)
    ?? stringField(artifact.content);
}

function renderArtifactContent(read: ReadArtifactResult, format: 'markdown' | 'json' | 'text') {
  if (format === 'json') return JSON.stringify(read.content ?? read.artifact ?? {}, null, 2);
  if (format === 'text') return read.text ?? JSON.stringify(read.content ?? read.artifact ?? {}, null, 2);
  return read.text ?? `\`\`\`json\n${JSON.stringify(read.content ?? read.artifact ?? {}, null, 2)}\n\`\`\``;
}

function artifactMimeType(artifact: RuntimeArtifact) {
  if (artifactText(artifact as unknown as Record<string, unknown>)) return 'text/markdown';
  if (artifact.path) return mimeTypeForPath(artifact.path);
  return 'application/json';
}

function mimeTypeForPath(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.txt') || lower.endsWith('.log')) return 'text/plain';
  return 'application/octet-stream';
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
