import { normalizeWorkspaceRootPath } from '../../config';
import type { PeerInstance, SciForgeConfig } from '../../domain';
import { pathBasename } from './explorerModels';

export const SIDEBAR_CHRONOLOGICAL_PROJECT_ID = 'chronological';
export const SIDEBAR_HOME_PROJECT_ID = 'home';
const LEGACY_CURRENT_PROJECT_ID = 'current';
const LEGACY_PEER_PROJECT_ID_PREFIX = 'peer:';

export interface SidebarProjectDescriptor {
  id: string;
  label: string;
  detail: string;
  current: boolean;
}

export function sidebarProjectPath(value: string | undefined): string {
  return normalizeWorkspaceRootPath(value || '');
}

export function sidebarProjectIdForPath(path: string | undefined): string {
  return sidebarProjectPath(path);
}

export function sidebarProjectIdForConfig(config: SciForgeConfig): string {
  return sidebarProjectIdForPath(config.workspacePath) || SIDEBAR_HOME_PROJECT_ID;
}

export function sidebarProjectIdForPeer(peer: PeerInstance): string {
  const path = sidebarProjectPath(peer.workspacePath);
  if (path) return path;
  const name = peer.name.trim();
  return name ? `${LEGACY_PEER_PROJECT_ID_PREFIX}${name}` : '';
}

export function isCurrentSidebarProject(
  config: SciForgeConfig,
  project: Pick<SidebarProjectDescriptor, 'detail' | 'current'>,
): boolean {
  const targetPath = sidebarProjectPath(project.detail);
  if (targetPath) {
    return targetPath === sidebarProjectIdForConfig(config);
  }
  return project.current;
}

export function migrateLegacySidebarProjectId(config: SciForgeConfig, projectId: string): string {
  if (projectId === LEGACY_CURRENT_PROJECT_ID) return sidebarProjectIdForConfig(config);
  if (projectId.startsWith(LEGACY_PEER_PROJECT_ID_PREFIX)) {
    const peerName = projectId.slice(LEGACY_PEER_PROJECT_ID_PREFIX.length);
    const peer = (config.peerInstances ?? []).find((entry) => entry.name === peerName);
    if (peer) return sidebarProjectIdForPeer(peer);
  }
  return sidebarProjectIdForPath(projectId);
}

export function sidebarProjectFromConfig(
  path: string | undefined,
  current: boolean,
  fallbackLabel?: string,
): SidebarProjectDescriptor {
  const normalizedPath = sidebarProjectPath(path);
  const label = (!current && fallbackLabel) || pathBasename(normalizedPath) || fallbackLabel || (current ? 'Home' : 'Untitled project');
  return {
    id: normalizedPath ? sidebarProjectIdForPath(normalizedPath) : current ? SIDEBAR_HOME_PROJECT_ID : sidebarProjectIdForPath(fallbackLabel || ''),
    label,
    detail: normalizedPath,
    current,
  };
}

export function buildConfiguredSidebarProjects(config: SciForgeConfig): SidebarProjectDescriptor[] {
  const currentProject = sidebarProjectFromConfig(config.workspacePath, true);
  const peerProjects = (config.peerInstances ?? [])
    .filter((peer) => peer.enabled !== false)
    .map((peer) => sidebarProjectFromConfig(peer.workspacePath || peer.name, false, peer.name));
  return uniqueSidebarProjects([currentProject, ...peerProjects]);
}

export function configuredSidebarProjectPaths(config: SciForgeConfig): string[] {
  return buildConfiguredSidebarProjects(config)
    .map((project) => sidebarProjectPath(project.detail))
    .filter(Boolean);
}

export function findPeerInstanceForSidebarProject(
  config: SciForgeConfig,
  project: Pick<SidebarProjectDescriptor, 'id' | 'detail'>,
): PeerInstance | undefined {
  const targetPath = sidebarProjectPath(project.detail);
  const peers = (config.peerInstances ?? []).filter((peer) => peer.enabled !== false);
  if (targetPath) {
    const byPath = peers.find((peer) => sidebarProjectPath(peer.workspacePath) === targetPath);
    if (byPath) return byPath;
  }
  if (project.id.startsWith(LEGACY_PEER_PROJECT_ID_PREFIX)) {
    const peerName = project.id.slice(LEGACY_PEER_PROJECT_ID_PREFIX.length);
    return peers.find((peer) => peer.name === peerName);
  }
  return peers.find((peer) => sidebarProjectIdForPeer(peer) === project.id);
}

export function removeSidebarProjectFromConfig(
  config: SciForgeConfig,
  project: Pick<SidebarProjectDescriptor, 'id' | 'detail' | 'current'>,
): Partial<SciForgeConfig> | undefined {
  if (isCurrentSidebarProject(config, project)) return undefined;
  const peer = findPeerInstanceForSidebarProject(config, project);
  if (!peer) return undefined;
  return {
    peerInstances: (config.peerInstances ?? []).filter((entry) => entry.name !== peer.name),
  };
}

export function buildWorkspaceDirectorySwitchPatch(
  config: SciForgeConfig,
  nextPath: string,
): Partial<SciForgeConfig> | undefined {
  const targetPath = sidebarProjectPath(nextPath);
  if (!targetPath) return undefined;

  const currentPath = sidebarProjectIdForConfig(config);
  if (targetPath === currentPath) return { workspacePath: targetPath };

  const activationPatch = buildWorkspaceProjectActivation(config, {
    id: sidebarProjectIdForPath(targetPath),
    detail: targetPath,
    current: false,
  });
  if (activationPatch?.peerInstances) return activationPatch;

  const peerInstances = preserveCurrentWorkspaceAsPeer(config, currentPath)
    .filter((peer) => sidebarProjectPath(peer.workspacePath) !== targetPath);

  return {
    workspacePath: targetPath,
    peerInstances,
  };
}

export function buildWorkspaceProjectActivation(
  config: SciForgeConfig,
  project: Pick<SidebarProjectDescriptor, 'id' | 'detail' | 'current'>,
): Partial<SciForgeConfig> | undefined {
  if (isCurrentSidebarProject(config, project) || !project.detail.trim()) return undefined;
  const targetPath = sidebarProjectPath(project.detail);
  const currentPath = sidebarProjectIdForConfig(config);
  if (!targetPath || targetPath === currentPath) return undefined;

  const peer = findPeerInstanceForSidebarProject(config, project);
  if (!peer) {
    return { workspacePath: targetPath };
  }

  const peerIndex = (config.peerInstances ?? []).findIndex((entry) => entry.name === peer.name);
  if (peerIndex < 0) {
    return { workspacePath: targetPath };
  }

  const nextPeers = [...(config.peerInstances ?? [])];
  const remainingPeers = nextPeers.filter((_, index) => index !== peerIndex);
  nextPeers[peerIndex] = {
    name: uniquePeerName(remainingPeers, pathBasename(currentPath) || peer.name || 'Workspace'),
    appUrl: config.agentServerBaseUrl,
    workspaceWriterUrl: config.workspaceWriterBaseUrl,
    workspacePath: currentPath,
    role: 'peer',
    trustLevel: 'readonly',
    enabled: true,
  };

  return {
    workspacePath: targetPath,
    workspaceWriterBaseUrl: peer.workspaceWriterUrl?.trim() || config.workspaceWriterBaseUrl,
    peerInstances: nextPeers,
  };
}

function preserveCurrentWorkspaceAsPeer(config: SciForgeConfig, currentPath: string): PeerInstance[] {
  const peers = [...(config.peerInstances ?? [])];
  if (!currentPath) return peers;
  if (peers.some((peer) => sidebarProjectPath(peer.workspacePath) === currentPath)) return peers;

  const baseName = pathBasename(currentPath) || 'Workspace';
  const peerName = uniquePeerName(peers, baseName);
  return [
    {
      name: peerName,
      appUrl: config.agentServerBaseUrl,
      workspaceWriterUrl: config.workspaceWriterBaseUrl,
      workspacePath: currentPath,
      role: 'peer',
      trustLevel: 'readonly',
      enabled: true,
    },
    ...peers,
  ];
}

function uniquePeerName(peers: PeerInstance[], baseName: string): string {
  const names = new Set(peers.map((peer) => peer.name.trim().toLowerCase()).filter(Boolean));
  let candidate = baseName.trim() || 'Workspace';
  let suffix = 2;
  while (names.has(candidate.toLowerCase())) {
    candidate = `${baseName} ${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function uniqueSidebarProjects(projects: SidebarProjectDescriptor[]): SidebarProjectDescriptor[] {
  const seen = new Set<string>();
  return projects.filter((project) => {
    const key = project.id || `${project.label}\n${project.detail}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
