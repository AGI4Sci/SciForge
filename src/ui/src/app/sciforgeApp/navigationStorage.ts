import { defaultBuiltInScenarioId } from '@sciforge/scenario-core/scenario-routing-policy';
import type { PageId } from '../../data';
import type { ScenarioInstanceId } from '../../domain';

const APP_NAVIGATION_STORAGE_KEY = 'sciforge.app-navigation.v1';
const validPages = new Set<PageId>(['workbench', 'components', 'timeline', 'feedback']);
const defaultNavigation = { page: 'workbench' as const, scenarioId: defaultBuiltInScenarioId };

export function appNavigationStorageKey() {
  if (typeof window === 'undefined') return APP_NAVIGATION_STORAGE_KEY;
  const host = window.location.host.trim();
  return host ? `${APP_NAVIGATION_STORAGE_KEY}.${host}` : APP_NAVIGATION_STORAGE_KEY;
}

export function loadStoredAppNavigation(): { page: PageId; scenarioId: ScenarioInstanceId } {
  if (typeof window === 'undefined') return defaultNavigation;
  try {
    const raw = window.localStorage.getItem(appNavigationStorageKey());
    if (!raw) return defaultNavigation;
    const parsed = JSON.parse(raw) as { page?: unknown; scenarioId?: unknown };
    const storedPage = typeof parsed.page === 'string' ? parsed.page : '';
    const page = storedPage === 'dashboard' || !validPages.has(storedPage as PageId)
      ? 'workbench'
      : storedPage as PageId;
    const scenarioId = typeof parsed.scenarioId === 'string' && parsed.scenarioId.trim()
      ? parsed.scenarioId.trim()
      : defaultBuiltInScenarioId;
    return { page, scenarioId };
  } catch {
    return defaultNavigation;
  }
}

export function saveStoredAppNavigation(navigation: { page: PageId; scenarioId: ScenarioInstanceId }) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(appNavigationStorageKey(), JSON.stringify(navigation));
  } catch {
    // Navigation restore is convenience state; workspace-state remains the durable source of truth.
  }
}
