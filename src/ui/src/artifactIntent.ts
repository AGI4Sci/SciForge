import type { ScenarioId } from './data';
import {
  expectedArtifactTypesForIntent,
  selectedViewComponentsForIntent,
} from '../../../packages/presentation/interactive-views';

export function expectedArtifactsForCurrentTurn({
  scenarioId,
  prompt,
  selectedComponentIds = [],
}: {
  scenarioId: ScenarioId;
  prompt: string;
  selectedComponentIds?: string[];
}) {
  return expectedArtifactTypesForIntent({ scenarioId, prompt, selectedComponentIds });
}

export function selectedComponentsForCurrentTurn(prompt: string, configuredComponentIds: string[] = []) {
  return selectedViewComponentsForIntent(prompt, configuredComponentIds);
}
