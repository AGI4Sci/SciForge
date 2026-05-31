export type SidebarLayoutMode = 'by-project' | 'recent-projects' | 'chronological';
export type SidebarSortMode = 'updatedAt' | 'createdAt';
export type SidebarVisibleSection = 'status' | 'git' | 'environment' | 'archiveUnread' | 'source' | 'metadata';

export type SidebarVisibleSections = Record<SidebarVisibleSection, boolean>;

export interface SidebarPreferences {
  layout: SidebarLayoutMode;
  sort: SidebarSortMode;
  pinnedThreadIds: string[];
  readThreadIds: string[];
  projectOrder: string[];
  visibleSections: SidebarVisibleSections;
}

const STORAGE_KEY = 'sciforge.sidebar.prefs';

const defaultVisibleSections: SidebarVisibleSections = {
  status: true,
  git: true,
  environment: true,
  archiveUnread: true,
  source: true,
  metadata: true,
};

export function defaultSidebarPreferences(): SidebarPreferences {
  return {
    layout: 'by-project',
    sort: 'updatedAt',
    pinnedThreadIds: [],
    readThreadIds: [],
    projectOrder: [],
    visibleSections: { ...defaultVisibleSections },
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
      readThreadIds: Array.isArray(parsed.readThreadIds) ? parsed.readThreadIds.filter((id) => typeof id === 'string') : [],
      projectOrder: Array.isArray(parsed.projectOrder) ? parsed.projectOrder.filter((id) => typeof id === 'string') : [],
      visibleSections: normalizeVisibleSections(parsed.visibleSections),
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

export function markThreadIdsRead(preferences: SidebarPreferences, sessionIds: string[]): SidebarPreferences {
  const cleanIds = sessionIds.map((id) => id.trim()).filter(Boolean);
  if (!cleanIds.length) return preferences;
  const read = new Set(preferences.readThreadIds);
  let changed = false;
  for (const id of cleanIds) {
    if (read.has(id)) continue;
    read.add(id);
    changed = true;
  }
  return changed ? { ...preferences, readThreadIds: [...read] } : preferences;
}

export function toggleSidebarVisibleSection(
  preferences: SidebarPreferences,
  section: SidebarVisibleSection,
): SidebarPreferences {
  const visibleSections = {
    ...defaultVisibleSections,
    ...preferences.visibleSections,
  };
  return {
    ...preferences,
    visibleSections: {
      ...visibleSections,
      [section]: !visibleSections[section],
    },
  };
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

export function removeProjectFromSidebarPreferences(
  preferences: SidebarPreferences,
  projectId: string,
): SidebarPreferences {
  return {
    ...preferences,
    projectOrder: preferences.projectOrder.filter((id) => id !== projectId),
  };
}

function normalizeVisibleSections(value: unknown): SidebarVisibleSections {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...defaultVisibleSections };
  }
  const record = value as Partial<Record<SidebarVisibleSection, unknown>>;
  return {
    status: typeof record.status === 'boolean' ? record.status : true,
    git: typeof record.git === 'boolean' ? record.git : true,
    environment: typeof record.environment === 'boolean' ? record.environment : true,
    archiveUnread: typeof record.archiveUnread === 'boolean' ? record.archiveUnread : true,
    source: typeof record.source === 'boolean' ? record.source : true,
    metadata: typeof record.metadata === 'boolean' ? record.metadata : true,
  };
}
