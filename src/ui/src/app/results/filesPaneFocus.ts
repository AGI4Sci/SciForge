import { loadSciForgeInstanceManifest, type WorkspaceFileContent } from '../../api/workspaceClient';
import { normalizeWorkspaceRootPath } from '../../config';
import type { ObjectReference, SciForgeConfig, SciForgeRun, SciForgeSession } from '../../domain';
import { conversationProjectionForSession } from '../conversation-projection-view-model';
import {
  shouldTryRepoRootWorkspaceFallback,
  workspaceFileWithInlinePolicy,
  type WorkspaceFileEditorState,
} from './filesPaneModel';
import {
  createWorkspaceFilesModulePort,
  unwrapWorkspaceFilesModuleResult,
  type WorkspaceFilesPort,
} from './filesPaneModulePort';
import { isRecord } from './resultArtifactHelpers';

export interface ReadFocusedWorkspaceFilePorts {
  filesPort?: Pick<WorkspaceFilesPort, 'readFile'>;
  readWorkspaceFile?: (path: string, config: SciForgeConfig) => Promise<WorkspaceFileContent>;
  loadSciForgeInstanceManifest?: typeof loadSciForgeInstanceManifest;
}

const defaultFocusedWorkspaceFilesPort = createWorkspaceFilesModulePort();

export function focusedWorkspaceRootForReference(
  reference: ObjectReference | undefined,
  session: SciForgeSession,
  fallbackWorkspaceRoot: string,
) {
  if (reference?.kind !== 'file' || reference.provenance?.producer !== 'cursor-agent-process') {
    return normalizeWorkspaceRootPath(fallbackWorkspaceRoot);
  }
  const runWorkspace = workspaceRootForRun(session, reference.runId);
  return normalizeWorkspaceRootPath(runWorkspace || fallbackWorkspaceRoot);
}

export function workspaceRootForRun(session: SciForgeSession, runId: string | undefined) {
  if (!runId) return '';
  const run = session.runs.find((item) => item.id === runId);
  if (!run) return '';
  return firstNonEmptyString(
    conversationProjectionForSession(session, run)?.runtimeMetadata?.workspace,
    workspaceRootFromRunRaw(run),
    workspaceRootFromStreamProcess(run),
  );
}

export function workspaceRootFromRunRaw(run: SciForgeRun) {
  const raw = isRecord(run.raw) ? run.raw : undefined;
  const payload = isRecord(raw?.payload) ? raw.payload : undefined;
  const runtimeMetadata = isRecord(raw?.runtimeMetadata)
    ? raw.runtimeMetadata
    : isRecord(payload?.runtimeMetadata)
      ? payload.runtimeMetadata
      : undefined;
  return stringField(runtimeMetadata?.workspace) || stringField(runtimeMetadata?.workspacePath);
}

export function workspaceRootFromStreamProcess(run: SciForgeRun) {
  const raw = isRecord(run.raw) ? run.raw : undefined;
  const streamProcess = isRecord(raw?.streamProcess) ? raw.streamProcess : undefined;
  const events = Array.isArray(streamProcess?.events) ? streamProcess.events : [];
  for (const event of events) {
    if (!isRecord(event)) continue;
    const native = isRecord(event.native) ? event.native : undefined;
    const workspace = firstNonEmptyString(
      stringField(native?.workspace),
      stringField(native?.workspacePath),
      stringField(native?.workspace_path),
      stringField(event.workspace),
      stringField(event.workspacePath),
      stringField(event.workspace_path),
    );
    if (workspace) return workspace;
  }
  return '';
}

export async function readFocusedWorkspaceFile({
  path,
  config,
  reference,
  ports = {},
}: {
  path: string;
  config: SciForgeConfig;
  reference?: ObjectReference;
  ports?: ReadFocusedWorkspaceFilePorts;
}): Promise<{ file: WorkspaceFileEditorState['file']; workspacePath: string }> {
  const readFile = ports.filesPort
    ? async (path: string, config: SciForgeConfig) => unwrapWorkspaceFilesModuleResult(await ports.filesPort!.readFile(path, config))
    : ports.readWorkspaceFile ?? (async (path: string, config: SciForgeConfig) =>
      unwrapWorkspaceFilesModuleResult(await defaultFocusedWorkspaceFilesPort.readFile(path, config)));
  const primaryWorkspacePath = normalizeWorkspaceRootPath(config.workspacePath);
  try {
    const file = workspaceFileWithInlinePolicy(await readFile(path, config));
    return { file, workspacePath: primaryWorkspacePath };
  } catch (primaryError) {
    if (!shouldTryRepoRootWorkspaceFallback(reference, path)) throw primaryError;
    const repoRoot = await repoRootWorkspaceFallback(config, ports).catch(() => '');
    if (!repoRoot || repoRoot === primaryWorkspacePath) throw primaryError;
    try {
      const file = workspaceFileWithInlinePolicy(await readFile(path, { ...config, workspacePath: repoRoot }));
      return { file, workspacePath: repoRoot };
    } catch {
      throw primaryError;
    }
  }
}

export async function repoRootWorkspaceFallback(config: SciForgeConfig, ports: ReadFocusedWorkspaceFilePorts = {}) {
  const loadManifest = ports.loadSciForgeInstanceManifest ?? loadSciForgeInstanceManifest;
  const manifest = await loadManifest(config);
  const repoRoot = manifest.repo.detected && typeof manifest.repo.root === 'string'
    ? manifest.repo.root
    : '';
  return normalizeWorkspaceRootPath(repoRoot);
}

function firstNonEmptyString(...values: Array<string | undefined>) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? '';
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
