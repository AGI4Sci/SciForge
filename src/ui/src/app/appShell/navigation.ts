import type { PageId, ScenarioId, ScenarioViewConfig } from '../../data';
import type { ScenarioInstanceId } from '../../domain';

export interface AppNavigationTarget {
  page: PageId;
  scenarioId?: ScenarioInstanceId;
}

export function resolveSearchNavigation(query: string, scenarios: ScenarioViewConfig[]): AppNavigationTarget | undefined {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return undefined;

  const matchedScenario = scenarios.find((scenario) =>
    normalized.includes(scenario.id)
    || normalized.includes(scenario.name.toLowerCase())
    || normalized.includes(scenario.domain.toLowerCase())
    || scenario.tools.some((tool) => normalized.includes(tool.toLowerCase())),
  );
  if (matchedScenario) return { page: 'workbench', scenarioId: matchedScenario.id };

  if (
    normalized.includes('timeline')
    || normalized.includes('时间线')
    || normalized.includes('notebook')
    || normalized.includes('align')
    || normalized.includes('对齐')
  ) {
    return { page: 'timeline' };
  }

  return { page: 'workbench' };
}

export function workbenchNavigationForScenario(scenarioId: ScenarioInstanceId): Required<AppNavigationTarget> {
  return { page: 'workbench', scenarioId };
}
