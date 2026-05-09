import { previewPackageAutoRunPromptPolicy } from '@sciforge/interactive-views';
import { scenarioHandoffAutoRunPrompt } from '@sciforge/scenario-core/scenario-auto-run-prompt-policy';
import type { ScenarioId } from '../../data';
import type { ObjectReference, PreviewDescriptor, RuntimeArtifact } from '../../domain';

export function handoffAutoRunPrompt(targetScenario: ScenarioId, artifact: RuntimeArtifact, sourceScenarioName: string, targetScenarioName: string): string {
  return scenarioHandoffAutoRunPrompt({
    targetScenario,
    artifact,
    sourceScenarioName,
    targetScenarioName,
  });
}

export function previewPackageAutoRunPrompt(reference: ObjectReference, path?: string, descriptor?: PreviewDescriptor): string {
  return previewPackageAutoRunPromptPolicy({ reference, path, descriptor });
}
