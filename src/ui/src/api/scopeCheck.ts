import type { ScenarioId } from '../data';
import {
  promptWithScopeCheck as promptWithPackageScopeCheck,
  scopeCheck as packageScopeCheck,
  type ScenarioScopeCheckResult,
} from '@sciforge/scenario-core/scenario-routing-policy';

export type ScopeCheckResult = ScenarioScopeCheckResult;

export function scopeCheck(scenarioId: ScenarioId, prompt: string): ScopeCheckResult {
  return packageScopeCheck(scenarioId, prompt);
}

export function promptWithScopeCheck(scenarioId: ScenarioId, prompt: string) {
  return promptWithPackageScopeCheck(scenarioId, prompt);
}
