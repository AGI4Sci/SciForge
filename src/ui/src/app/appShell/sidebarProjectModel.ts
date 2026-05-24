import { normalizeWorkspaceRootPath } from '../../config';
import type { PeerInstance, SciForgeConfig } from '../../domain';
import { pathBasename } from './explorerModels';

export const SIDEBAR_CHRONOLOGICAL_PROJECT_ID = 'chronological';
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
  return sidebarProjectIdForPath(config.workspacePath);
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
  const label = pathBasename(normalizedPath) || fallbackLabel || (current ? '当前项目' : '未命名项目');
  return {
    id: sidebarProjectIdForPath(normalizedPath || fallbackLabel || ''),
    label,
    detail: normalizedPath || fallbackLabel || '',
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
  nextPeers[peerIndex] = {
    ...peer,
    workspacePath: currentPath,
  };

  return {
    workspacePath: targetPath,
    peerInstances: nextPeers,
  };
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
