import type { SidebarProjectThreadGroup, SidebarThreadItem } from './ShellPanels';

export function sidebarRenderableThreadItems(
  project: Pick<SidebarProjectThreadGroup, 'threads' | 'draftThreads' | 'archivedThreads'>,
): SidebarThreadItem[] {
  const renderedIds = new Set<string>();
  const visible = [
    ...(project.draftThreads ?? []),
    ...project.threads,
    ...(project.archivedThreads ?? []).filter((thread) => thread.state === 'active' && !thread.archived && !thread.discarded),
  ];
  return visible.filter((thread) => {
    if (renderedIds.has(thread.sessionId)) return false;
    renderedIds.add(thread.sessionId);
    return true;
  });
}

export function sidebarHiddenArchiveThreadItems(
  project: Pick<SidebarProjectThreadGroup, 'archivedThreads'>,
): SidebarThreadItem[] {
  return [
    ...(project.archivedThreads ?? []).filter((thread) => thread.state !== 'active' || thread.archived || thread.discarded),
  ];
}

export function sidebarSearchableThreadItems(
  project: Pick<SidebarProjectThreadGroup, 'threads' | 'draftThreads' | 'archivedThreads'>,
): SidebarThreadItem[] {
  return [
    ...sidebarRenderableThreadItems(project),
    ...sidebarHiddenArchiveThreadItems(project),
  ];
}
