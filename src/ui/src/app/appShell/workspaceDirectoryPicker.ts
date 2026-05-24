import type { SciForgeConfig } from '../../domain';
import { pickWorkspaceDirectory } from '../../api/workspaceClient';

const SAME_ORIGIN_PICKER_PATH = '/api/sciforge/workspace/pick-directory';

type DesktopPickDirectoryResult = {
  ok?: boolean;
  path?: string;
};

type DesktopDirectoryPickerBridge = {
  pickDirectory?: (defaultPath?: string) => Promise<DesktopPickDirectoryResult>;
};

function isLocalDevOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(window.location.origin);
}

async function pickDirectoryViaSameOrigin(defaultPath?: string): Promise<string | null | undefined> {
  if (!isLocalDevOrigin()) return undefined;
  const response = await fetch(SAME_ORIGIN_PICKER_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultPath }),
  });
  if (response.status === 404) return undefined;
  const json = await response.json().catch(() => ({})) as { ok?: boolean; path?: string | null; error?: string };
  if (!response.ok || !json.ok) {
    throw new Error(json.error || `本地文件夹选择失败：HTTP ${response.status}`);
  }
  return typeof json.path === 'string' && json.path.trim() ? json.path.trim() : null;
}

export async function resolveWorkspaceDirectoryPath(
  config: SciForgeConfig,
  defaultPath?: string,
): Promise<string | null> {
  const fallbackPath = defaultPath?.trim() || config.workspacePath;
  const bridge = (typeof window !== 'undefined' ? window.sciforgeDesktop : undefined) as DesktopDirectoryPickerBridge | undefined;
  if (bridge?.pickDirectory) {
    const result = await bridge.pickDirectory(fallbackPath);
    if (result?.ok && result.path?.trim()) return result.path.trim();
    return null;
  }

  try {
    const localPick = await pickDirectoryViaSameOrigin(fallbackPath);
    if (localPick !== undefined) return localPick;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }

  try {
    return await pickWorkspaceDirectory(config, fallbackPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/404|not found/i.test(message)) {
      throw new Error('文件夹选择服务不可用。请重启 Workspace Writer，或通过 Vite 开发服务器访问 UI。');
    }
    throw error instanceof Error ? error : new Error(message);
  }
}
