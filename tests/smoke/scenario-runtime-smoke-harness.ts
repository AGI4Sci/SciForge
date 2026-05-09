import type { ScenarioPackage } from '@sciforge/scenario-core/scenario-package';

import {
  validateRuntimeScenarioPackage,
  type ScenarioPackageValidationReport,
} from '../../src/runtime/scenario-policy/scenario-package-validation.js';

export type ScenarioRuntimeSmokeMode = 'dry-run' | 'execute-package-skill';

export interface ScenarioRuntimeSmokeRequest {
  package: ScenarioPackage;
  mode?: ScenarioRuntimeSmokeMode;
  prompt?: string;
  workspacePath?: string;
}

export interface ScenarioRuntimeSmokeResult {
  ok: boolean;
  mode: ScenarioRuntimeSmokeMode;
  checkedAt: string;
  packageRef: {
    id: string;
    version: string;
    source: ScenarioPackage['scenario']['source'];
  };
  validationReport: ScenarioPackageValidationReport;
  selectedSkillIds: string[];
  expectedArtifactTypes: string[];
  execution?: {
    status: 'skipped' | 'done' | 'failed-with-reason';
    reason?: string;
    requiredInputs?: string[];
    recoverActions?: string[];
  };
}

export type ScenarioRuntimeSmokeExecutor = (
  request: ScenarioRuntimeSmokeRequest,
) => Promise<Pick<ScenarioRuntimeSmokeResult, 'ok' | 'execution'>>;

export async function runScenarioRuntimeSmoke(
  request: ScenarioRuntimeSmokeRequest,
  executor?: ScenarioRuntimeSmokeExecutor,
): Promise<ScenarioRuntimeSmokeResult> {
  const mode = request.mode ?? 'dry-run';
  const validationReport = validateRuntimeScenarioPackage(request.package);
  const base: ScenarioRuntimeSmokeResult = {
    ok: validationReport.ok,
    mode,
    checkedAt: new Date().toISOString(),
    packageRef: {
      id: request.package.id,
      version: request.package.version,
      source: request.package.scenario.source,
    },
    validationReport,
    selectedSkillIds: request.package.scenario.selectedSkillIds,
    expectedArtifactTypes: request.package.scenario.outputArtifacts.map((artifact) => artifact.type),
    execution: {
      status: 'skipped',
      reason: mode === 'dry-run'
        ? 'Dry-run validates package contracts without executing workspace code.'
        : 'No executor was provided for package skill execution.',
      requiredInputs: request.package.scenario.scopeDeclaration.requiredInputs,
      recoverActions: validationReport.ok ? [] : ['resolve-validation-errors', 'save-as-draft'],
    },
  };
  if (!validationReport.ok || mode === 'dry-run' || !executor) return base;
  const executed = await executor(request);
  return {
    ...base,
    ok: validationReport.ok && executed.ok,
    execution: executed.execution,
  };
}
