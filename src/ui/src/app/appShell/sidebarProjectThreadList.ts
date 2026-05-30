import type { SidebarProjectThreadGroup, SidebarThreadItem } from './ShellPanels';

export function sidebarRenderableThreadItems(
  project: Pick<SidebarProjectThreadGroup, 'threads' | 'draftThreads' | 'archivedThreads'>,
): SidebarThreadItem[] {
  return [
    ...(project.draftThreads ?? []),
    ...project.threads,
    ...(project.archivedThreads ?? []),
  ];
}
