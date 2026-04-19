import type { BioAgentConfig, BioAgentWorkspaceState } from '../domain';

export interface WorkspaceEntry {
  name: string;
  path: string;
  kind: 'file' | 'folder';
}

export async function persistWorkspaceState(state: BioAgentWorkspaceState, config: BioAgentConfig): Promise<void> {
  if (!state.workspacePath.trim()) return;
  const operation = `snapshot workspace ${state.workspacePath}`;
  const response = await fetchWorkspace(config, operation, `${config.workspaceWriterBaseUrl}/api/bioagent/workspace/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: state.workspacePath,
      state,
      config,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Workspace writer failed: HTTP ${response.status}`);
  }
}

export async function listWorkspace(path: string, config: BioAgentConfig): Promise<WorkspaceEntry[]> {
  if (!path.trim()) return [];
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/bioagent/workspace/list`);
  url.searchParams.set('path', path);
  const response = await fetchWorkspace(config, `list workspace ${path}`, url);
  if (!response.ok) throw new Error(await response.text() || `List failed: HTTP ${response.status}`);
  const json = await response.json() as { entries?: WorkspaceEntry[] };
  return Array.isArray(json.entries) ? json.entries : [];
}

export async function mutateWorkspaceFile(
  config: BioAgentConfig,
  action: 'create-file' | 'create-folder' | 'rename' | 'delete',
  payload: { path: string; targetPath?: string },
): Promise<void> {
  const operation = `${action} ${payload.path}`;
  const response = await fetchWorkspace(config, operation, `${config.workspaceWriterBaseUrl}/api/bioagent/workspace/file-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!response.ok) throw new Error(await response.text() || `File action failed: HTTP ${response.status}`);
}

async function fetchWorkspace(
  config: BioAgentConfig,
  operation: string,
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Workspace writer unavailable at ${config.workspaceWriterBaseUrl} while trying to ${operation}. Start npm run workspace:server and retry. ${detail}`);
  }
}
