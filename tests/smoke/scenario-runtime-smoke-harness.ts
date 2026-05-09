import type { ScenarioPackage } from '@sciforge/scenario-core/scenario-package';

import {
  validateRuntimeScenarioPackage,
  type ScenarioPackageValidationReport,
} from '../../src/runtime/scenario-policy/scenario-package-validation.js';

export type ScenarioRuntimeSmokeMode = 'dry-run';

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
    status: 'skipped';
    reason?: string;
    requiredInputs?: string[];
    recoverActions?: string[];
  };
}

export async function runScenarioRuntimeSmoke(
  request: ScenarioRuntimeSmokeRequest,
): Promise<ScenarioRuntimeSmokeResult> {
  const mode = request.mode ?? 'dry-run';
  const validationReport = validateRuntimeScenarioPackage(request.package);
  return {
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
      reason: 'Dry-run validates package contracts without executing workspace code.',
      requiredInputs: request.package.scenario.scopeDeclaration.requiredInputs,
      recoverActions: validationReport.ok ? [] : ['resolve-validation-errors', 'save-as-draft'],
    },
  };
}
