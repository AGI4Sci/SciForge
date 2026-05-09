import type { ExportPolicyDecision } from './contracts';
import type { ScenarioPackage } from './scenarioPackage';
import { validateScenarioPackage, type ValidationReport } from './validationGate';

export type QualitySeverity = 'blocking' | 'warning' | 'note';

export interface ScenarioQualityItem {
  severity: QualitySeverity;
  code: string;
  message: string;
  elementId?: string;
  recoverActions?: string[];
}

export interface ScenarioPackageDiff {
  inputContractChanged: boolean;
  outputArtifactsChanged: boolean;
  skillPlanChanged: boolean;
  uiPlanChanged: boolean;
  failurePoliciesChanged: boolean;
  notes: string[];
}

export interface ScenarioQualityReport {
  ok: boolean;
  checkedAt: string;
  packageRef: {
    id: string;
    version: string;
    status: ScenarioPackage['status'];
  };
  items: ScenarioQualityItem[];
  validationReport: ValidationReport;
  runtimeHealth?: ScenarioRuntimeHealthItem[];
  exportPolicy?: ExportPolicyDecision;
  versionDiff?: ScenarioPackageDiff;
}

export interface ScenarioRuntimeHealthItem {
  id: string;
  label: string;
  status: 'online' | 'offline' | 'checking' | 'not-configured' | 'optional';
  detail?: string;
}

export function buildScenarioQualityReport(params: {
  package: ScenarioPackage;
  previousPackage?: ScenarioPackage;
  validationReport?: ValidationReport;
  runtimeHealth?: ScenarioRuntimeHealthItem[];
  exportPolicy?: ExportPolicyDecision;
  checkedAt?: string;
}): ScenarioQualityReport {
  const checkedAt = params.checkedAt ?? new Date().toISOString();
  const validationReport = params.validationReport ?? validateScenarioPackage(params.package, undefined, checkedAt);
  const versionDiff = params.previousPackage ? diffScenarioPackages(params.previousPackage, params.package) : undefined;
  const items: ScenarioQualityItem[] = [
    ...validationReport.issues.map((issue) => ({
      severity: issue.severity === 'error' ? 'blocking' as const : 'warning' as const,
      code: issue.code,
      message: issue.message,
      elementId: issue.elementId,
      recoverActions: issue.severity === 'error' ? ['fix-validation-error', 'save-as-draft'] : ['review-warning'],
    })),
  ];

  for (const health of params.runtimeHealth ?? []) {
    if (health.status === 'offline') {
      items.push({
        severity: health.id === 'workspace' ? 'blocking' : 'warning',
        code: `runtime-health-${health.id}-offline`,
        message: `${health.label} is offline: ${health.detail ?? 'no detail'}`,
        recoverActions: health.id === 'workspace' ? ['start-workspace-writer', 'save-as-draft'] : ['start-runtime-service', 'use-package-skill-fallback'],
      });
    } else if (health.status === 'not-configured') {
      items.push({
        severity: 'warning',
        code: `runtime-health-${health.id}-not-configured`,
        message: `${health.label} is not configured.`,
        recoverActions: ['open-settings', 'save-as-draft'],
      });
    }
  }

  if (params.exportPolicy && !params.exportPolicy.allowed) {
    items.push({
      severity: 'blocking',
      code: 'export-policy-blocked',
      message: `Export policy blocks artifacts: ${params.exportPolicy.blockedArtifactIds.join(', ')}`,
      recoverActions: ['remove-blocked-artifacts', 'change-export-policy'],
    });
  }

  if (versionDiff?.inputContractChanged || versionDiff?.outputArtifactsChanged) {
    items.push({
      severity: 'warning',
      code: 'contract-diff',
      message: 'Package version changes input contract or output artifacts.',
      recoverActions: ['review-version-diff', 'bump-version', 'document-migration'],
    });
  }

  if (!params.package.tests.length) {
    items.push({
      severity: 'warning',
      code: 'missing-package-tests',
      message: 'Package has no tests configured.',
      recoverActions: ['add-smoke-test'],
    });
  }

  return {
    ok: !items.some((item) => item.severity === 'blocking'),
    checkedAt,
    packageRef: {
      id: params.package.id,
      version: params.package.version,
      status: params.package.status,
    },
    items,
    validationReport,
    runtimeHealth: params.runtimeHealth,
    exportPolicy: params.exportPolicy,
    versionDiff,
  };
}

export function diffScenarioPackages(previousPackage: ScenarioPackage, nextPackage: ScenarioPackage): ScenarioPackageDiff {
  const inputContractChanged = stableJson(previousPackage.scenario.inputContract) !== stableJson(nextPackage.scenario.inputContract);
  const outputArtifactsChanged = stableJson(previousPackage.scenario.outputArtifacts.map((artifact) => artifact.type)) !== stableJson(nextPackage.scenario.outputArtifacts.map((artifact) => artifact.type));
  const skillPlanChanged = stableJson(previousPackage.skillPlan.skillIRs.map((skill) => skill.skillId)) !== stableJson(nextPackage.skillPlan.skillIRs.map((skill) => skill.skillId));
  const uiPlanChanged = stableJson(previousPackage.uiPlan.compiledFrom.componentIds) !== stableJson(nextPackage.uiPlan.compiledFrom.componentIds);
  const failurePoliciesChanged = stableJson(previousPackage.skillPlan.fallbackPolicyIds) !== stableJson(nextPackage.skillPlan.fallbackPolicyIds);
  return {
    inputContractChanged,
    outputArtifactsChanged,
    skillPlanChanged,
    uiPlanChanged,
    failurePoliciesChanged,
    notes: [
      inputContractChanged ? 'input contract changed' : '',
      outputArtifactsChanged ? 'output artifact types changed' : '',
      skillPlanChanged ? 'selected skills changed' : '',
      uiPlanChanged ? 'UI component plan changed' : '',
      failurePoliciesChanged ? 'failure policies changed' : '',
    ].filter(Boolean),
  };
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}
