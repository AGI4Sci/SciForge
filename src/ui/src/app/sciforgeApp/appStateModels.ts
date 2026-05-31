import { scenarios } from '../../data';
import type { SciForgeSession, SciForgeWorkspaceState, ScenarioInstanceId } from '../../domain';
import { isRetainedHistorySession } from '../../workspace/sessionWorkspace';
import { sessionActivityScore } from '../../sessionStore';
import { uiModuleRegistry, type RuntimeUIModule } from '../../uiModuleRegistry';

type SidebarWorkspaceChatState = Pick<SciForgeWorkspaceState, 'sessionsByScenario' | 'archivedSessions'>;

export function updateDraftRecord(
  current: Record<ScenarioInstanceId, string>,
  scenarioId: ScenarioInstanceId,
  value: string,
): Record<ScenarioInstanceId, string> {
  if ((current[scenarioId] ?? '') === value) return current;
  return { ...current, [scenarioId]: value };
}

function newestSessionFirst(left: SciForgeSession, right: SciForgeSession) {
  return Date.parse(right.updatedAt || right.createdAt) - Date.parse(left.updatedAt || left.createdAt);
}

export function buildArchivedSessionsByScenario(archivedSessions: SciForgeSession[]): Record<ScenarioInstanceId, SciForgeSession[]> {
  const grouped = scenarios.reduce((memo, scenario) => {
    memo[scenario.id] = [];
    return memo;
  }, {} as Record<ScenarioInstanceId, SciForgeSession[]>);

  for (const session of archivedSessions) {
    if (isRetainedHistorySession(session)) continue;
    grouped[session.scenarioId] = [...(grouped[session.scenarioId] ?? []), session];
  }

  return Object.fromEntries(
    Object.entries(grouped).map(([scenarioId, sessions]) => [scenarioId, [...sessions].sort(newestSessionFirst)]),
  ) as Record<ScenarioInstanceId, SciForgeSession[]>;
}

export function buildArchivedSessionCountsByScenario(
  archivedSessionsByScenario: Record<ScenarioInstanceId, SciForgeSession[]>,
): Record<ScenarioInstanceId, number> {
  return Object.fromEntries(
    Object.entries(archivedSessionsByScenario).map(([scenarioId, sessions]) => [scenarioId, sessions.length]),
  ) as Record<ScenarioInstanceId, number>;
}

export function workspaceHasArchivableSidebarChats(state: SidebarWorkspaceChatState): boolean {
  return Object.values(state.sessionsByScenario).some((session) => session && sessionActivityScore(session) > 0)
    || (state.archivedSessions ?? []).some((session) => isRetainedHistorySession(session) && sessionActivityScore(session) > 0);
}

export function workspaceHasArchivableSidebarChat(
  state: SidebarWorkspaceChatState,
  scenarioId: ScenarioInstanceId,
  sessionId: string,
): boolean {
  const active = state.sessionsByScenario[scenarioId];
  if (active?.sessionId === sessionId && sessionActivityScore(active) > 0) return true;
  return (state.archivedSessions ?? []).some((session) => (
    session.scenarioId === scenarioId
      && session.sessionId === sessionId
      && isRetainedHistorySession(session)
      && sessionActivityScore(session) > 0
  ));
}

export function workspaceCanDiscardSidebarChat(
  state: SidebarWorkspaceChatState,
  scenarioId: ScenarioInstanceId,
  sessionId: string,
): boolean {
  const active = state.sessionsByScenario[scenarioId];
  if (active?.sessionId === sessionId) return true;
  return (state.archivedSessions ?? []).some((session) => (
    session.scenarioId === scenarioId
      && session.sessionId === sessionId
      && isRetainedHistorySession(session)
      && sessionActivityScore(session) > 0
  ));
}

export function defaultPublishedRuntimeComponentIds(
  modules: Pick<RuntimeUIModule, 'componentId' | 'lifecycle'>[] = uiModuleRegistry,
): string[] {
  return Array.from(new Set(
    modules
      .filter((module) => module.lifecycle === 'published')
      .map((module) => module.componentId),
  )).sort();
}
