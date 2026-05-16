import { scenarios } from '../../data';
import type { SciForgeSession, ScenarioInstanceId } from '../../domain';
import { uiModuleRegistry, type RuntimeUIModule } from '../../uiModuleRegistry';

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

export function defaultPublishedRuntimeComponentIds(
  modules: Pick<RuntimeUIModule, 'componentId' | 'lifecycle'>[] = uiModuleRegistry,
): string[] {
  return Array.from(new Set(
    modules
      .filter((module) => module.lifecycle === 'published')
      .map((module) => module.componentId),
  )).sort();
}
