import { loadPersistedWorkspaceStateForProject } from '../../api/workspaceClient';
import type { SciForgeConfig, SciForgeSession, SciForgeWorkspaceState, ScenarioInstanceId } from '../../domain';
import {
  configuredSidebarProjectPaths,
  sidebarProjectIdForConfig,
  sidebarProjectPath,
} from './sidebarProjectModel';

export interface SidebarProjectSessionBundle {
  sessionsByScenario: Partial<Record<ScenarioInstanceId, SciForgeSession>>;
  archivedSessions: SciForgeSession[];
}

export type SidebarProjectSessionsByPath = Record<string, SidebarProjectSessionBundle>;

export function resolveSidebarProjectSessionBundle(
  projectPath: string,
  activeWorkspacePath: string,
  liveSessions: Partial<Record<ScenarioInstanceId, SciForgeSession>>,
  liveArchived: SciForgeSession[] | undefined,
  projectSessionsByPath: SidebarProjectSessionsByPath | undefined,
): SidebarProjectSessionBundle {
  const normalizedProjectPath = sidebarProjectPath(projectPath);
  const normalizedActivePath = sidebarProjectPath(activeWorkspacePath);
  const cached = normalizedProjectPath ? projectSessionsByPath?.[normalizedProjectPath] : undefined;
  if (cached) {
    return {
      sessionsByScenario: cached.sessionsByScenario,
      archivedSessions: cached.archivedSessions ?? [],
    };
  }
  if (normalizedProjectPath && normalizedProjectPath === normalizedActivePath) {
    return {
      sessionsByScenario: liveSessions,
      archivedSessions: liveArchived ?? [],
    };
  }
  return { sessionsByScenario: {}, archivedSessions: [] };
}

export function buildSidebarProjectSessionsByPath(
  config: SciForgeConfig,
  activeState: Pick<SciForgeWorkspaceState, 'workspacePath' | 'sessionsByScenario' | 'archivedSessions'>,
  peerSnapshots: SidebarProjectSessionsByPath = {},
): SidebarProjectSessionsByPath {
  const activePath = sidebarProjectPath(activeState.workspacePath);
  const map: SidebarProjectSessionsByPath = { ...peerSnapshots };

  if (activePath) {
    map[activePath] = {
      sessionsByScenario: activeState.sessionsByScenario,
      archivedSessions: activeState.archivedSessions ?? [],
    };
  }

  for (const projectPath of configuredSidebarProjectPaths(config)) {
    if (!map[projectPath]) {
      map[projectPath] = { sessionsByScenario: {}, archivedSessions: [] };
    }
  }

  return map;
}

export function peerSidebarProjectSessionTargets(config: SciForgeConfig) {
  const currentPath = sidebarProjectIdForConfig(config);
  const sharedWriter = config.workspaceWriterBaseUrl?.trim() || '';
  return (config.peerInstances ?? [])
    .filter((peer) => peer.enabled !== false)
    .map((peer) => ({
      path: sidebarProjectPath(peer.workspacePath),
      writerBaseUrl: peer.workspaceWriterUrl?.trim() || sharedWriter,
    }))
    .filter((peer) => peer.path && peer.path !== currentPath && peer.writerBaseUrl);
}

export async function loadPeerSidebarProjectSessionSnapshots(
  config: SciForgeConfig,
): Promise<SidebarProjectSessionsByPath> {
  const snapshots: SidebarProjectSessionsByPath = {};
  await Promise.all(peerSidebarProjectSessionTargets(config).map(async (peer) => {
    try {
      const state = await loadPersistedWorkspaceStateForProject(peer.path, config, peer.writerBaseUrl);
      if (!state) return;
      snapshots[peer.path] = {
        sessionsByScenario: state.sessionsByScenario,
        archivedSessions: state.archivedSessions ?? [],
      };
    } catch {
      // Peer writer may be offline; keep project row without threads.
    }
  }));
  return snapshots;
}
