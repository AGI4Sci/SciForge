export type SidebarLayoutMode = 'by-project' | 'recent-projects' | 'chronological';
export type SidebarSortMode = 'updatedAt' | 'createdAt';

export interface SidebarPreferences {
  layout: SidebarLayoutMode;
  sort: SidebarSortMode;
  pinnedThreadIds: string[];
  projectOrder: string[];
}

const STORAGE_KEY = 'sciforge.sidebar.prefs';

export function defaultSidebarPreferences(): SidebarPreferences {
  return {
    layout: 'by-project',
    sort: 'updatedAt',
    pinnedThreadIds: [],
    projectOrder: [],
  };
}

export function loadSidebarPreferences(): SidebarPreferences {
  if (typeof window === 'undefined') return defaultSidebarPreferences();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSidebarPreferences();
    const parsed = JSON.parse(raw) as Partial<SidebarPreferences>;
    return {
      layout: parsed.layout === 'recent-projects' || parsed.layout === 'chronological' ? parsed.layout : 'by-project',
      sort: parsed.sort === 'createdAt' ? 'createdAt' : 'updatedAt',
      pinnedThreadIds: Array.isArray(parsed.pinnedThreadIds) ? parsed.pinnedThreadIds.filter((id) => typeof id === 'string') : [],
      projectOrder: Array.isArray(parsed.projectOrder) ? parsed.projectOrder.filter((id) => typeof id === 'string') : [],
    };
  } catch {
    return defaultSidebarPreferences();
  }
}

export function saveSidebarPreferences(preferences: SidebarPreferences): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

export function togglePinnedThreadId(preferences: SidebarPreferences, sessionId: string): SidebarPreferences {
  const pinned = new Set(preferences.pinnedThreadIds);
  if (pinned.has(sessionId)) pinned.delete(sessionId);
  else pinned.add(sessionId);
  return { ...preferences, pinnedThreadIds: [...pinned] };
}

export function moveCurrentProjectDown(preferences: SidebarPreferences, projectIds: string[], currentProjectId: string): SidebarPreferences {
  const order = preferences.projectOrder.length
    ? [...preferences.projectOrder]
    : [...projectIds];
  for (const id of projectIds) {
    if (!order.includes(id)) order.push(id);
  }
  const index = order.indexOf(currentProjectId);
  if (index < 0 || index >= order.length - 1) return preferences;
  const nextOrder = [...order];
  [nextOrder[index], nextOrder[index + 1]] = [nextOrder[index + 1], nextOrder[index]];
  return { ...preferences, projectOrder: nextOrder };
}
