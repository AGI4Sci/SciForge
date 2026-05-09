import type { ScenarioId, ScenarioPackageRef, UIManifestSlot } from './contracts';
import type { ScenarioArtifactSchema, ScenarioInputField, ScenarioScopeDeclaration, ScenarioSpec, SkillDomain } from './scenarioSpecs';
import { SCENARIO_SPECS } from './scenarioSpecs';
import { compileSkillPlan, type SkillPlan } from './skillPlanCompiler';
import { compileUIPlanForScenario, type UIPlan } from './uiPlanCompiler';
import type { ValidationReport } from './validationGate';
import type { ScenarioQualityReport } from './scenarioQualityGate';

export type ScenarioPublishStatus = 'draft' | 'validated' | 'published' | 'archived';

export interface ScenarioIR {
  id: string;
  title: string;
  description: string;
  source: 'built-in' | 'markdown-import' | 'workspace' | 'generated';
  skillDomain: SkillDomain;
  scenarioMarkdown: string;
  inputContract: ScenarioInputField[];
  outputArtifacts: ScenarioArtifactSchema[];
  scopeDeclaration: ScenarioScopeDeclaration;
  defaultSlots: UIManifestSlot[];
  selectedSkillIds: string[];
  selectedToolIds: string[];
  selectedComponentIds: string[];
  fallbackComponentId: string;
}

export const SCENARIO_PACKAGE_POLICY_FIELDS = [
  'artifactSchemas',
  'defaultViews',
  'capabilities',
  'domainVocabulary',
  'verifierPolicy',
  'privacySafetyBoundaries',
] as const;

export type ScenarioPackagePolicyField = typeof SCENARIO_PACKAGE_POLICY_FIELDS[number];

export interface ScenarioPackagePolicy {
  artifactSchemas: ScenarioArtifactSchema[];
  defaultViews: UIManifestSlot[];
  capabilities: {
    requiredSkillIds: string[];
    allowedSkillIds: string[];
    allowedToolIds: string[];
    allowedComponentIds: string[];
    fallbackComponentId: string;
    dynamicPlugins: ScenarioSpec['componentPolicy']['dynamicPlugins'];
  };
  domainVocabulary: {
    skillDomain: SkillDomain;
    inputKeys: string[];
    artifactTypes: string[];
    componentIds: string[];
    supportedTasks: string[];
    unsupportedTasks: string[];
    handoffTargets: ScenarioScopeDeclaration['handoffTargets'];
  };
  verifierPolicy: {
    requiredInputs: string[];
    requiredArtifactTypes: string[];
    requiredArtifactFields: Record<string, string[]>;
    failurePolicyIds: string[];
    evidenceBoundaries: string[];
  };
  privacySafetyBoundaries: {
    unsupportedTasks: string[];
    phaseLimitations: string[];
    restrictedDataClasses: string[];
    safetyNotes: string[];
  };
}

export interface ScenarioPackageVersion {
  version: string;
  status: ScenarioPublishStatus;
  createdAt: string;
  summary: string;
  scenarioHash: string;
}

export interface ScenarioPackage {
  schemaVersion: '1';
  id: string;
  version: string;
  status: ScenarioPublishStatus;
  scenario: ScenarioIR;
  policy?: ScenarioPackagePolicy;
  skillPlan: SkillPlan;
  uiPlan: UIPlan;
  validationReport?: ValidationReport;
  qualityReport?: ScenarioQualityReport;
  tests: Array<{ id: string; prompt: string; expectedArtifactTypes: string[] }>;
  versions: ScenarioPackageVersion[];
}

export function buildBuiltInScenarioPackage(scenarioId: ScenarioId, createdAt = new Date().toISOString()): ScenarioPackage {
  const spec = SCENARIO_SPECS[scenarioId];
  const uiPlan = compileUIPlanForScenario(scenarioId);
  const selectedSkillIds = skillIdsForDomain(spec.skillDomain);
  const selectedToolIds = [...spec.nativeTools, ...spec.fallbackTools].map((tool) => `tool.${safeElementId(tool)}`);
  const skillPlan = compileSkillPlan(selectedSkillIds);
  const scenario: ScenarioIR = {
    id: scenarioId,
    title: spec.title,
    description: spec.description,
    source: spec.source,
    skillDomain: spec.skillDomain,
    scenarioMarkdown: spec.scenarioMarkdown,
    inputContract: spec.inputContract,
    outputArtifacts: spec.outputArtifacts,
    scopeDeclaration: spec.scopeDeclaration,
    defaultSlots: uiPlan.slots,
    selectedSkillIds,
    selectedToolIds,
    selectedComponentIds: uiPlan.compiledFrom.componentIds,
    fallbackComponentId: spec.componentPolicy.fallbackComponent,
  };
  const scenarioHash = stableHash(JSON.stringify({
    id: scenario.id,
    skillDomain: scenario.skillDomain,
    artifacts: scenario.outputArtifacts.map((artifact) => artifact.type),
    components: scenario.selectedComponentIds,
  }));
  return {
    schemaVersion: '1',
    id: scenarioId,
    version: '1.0.0',
    status: 'published',
    scenario,
    policy: buildScenarioPackagePolicy(scenario, skillPlan, uiPlan, {
      dynamicPlugins: spec.componentPolicy.dynamicPlugins,
    }),
    skillPlan,
    uiPlan,
    tests: [{
      id: `smoke.${scenarioId}.default`,
      prompt: smokePromptForInputContract(spec.inputContract) || spec.description,
      expectedArtifactTypes: spec.outputArtifacts.map((artifact) => artifact.type),
    }],
    versions: [{
      version: '1.0.0',
      status: 'published',
      createdAt,
      summary: `Built-in package for ${spec.title}.`,
      scenarioHash,
    }],
  };
}

export function buildScenarioPackagePolicy(
  scenario: ScenarioIR,
  skillPlan: SkillPlan,
  uiPlan: UIPlan,
  options: { dynamicPlugins?: ScenarioSpec['componentPolicy']['dynamicPlugins'] } = {},
): ScenarioPackagePolicy {
  return {
    artifactSchemas: scenario.outputArtifacts,
    defaultViews: uiPlan.slots,
    capabilities: {
      requiredSkillIds: scenario.selectedSkillIds,
      allowedSkillIds: scenario.selectedSkillIds,
      allowedToolIds: scenario.selectedToolIds,
      allowedComponentIds: scenario.selectedComponentIds,
      fallbackComponentId: scenario.fallbackComponentId,
      dynamicPlugins: options.dynamicPlugins ?? 'disabled-by-default',
    },
    domainVocabulary: {
      skillDomain: scenario.skillDomain,
      inputKeys: scenario.inputContract.map((field) => field.key),
      artifactTypes: scenario.outputArtifacts.map((artifact) => artifact.type),
      componentIds: scenario.selectedComponentIds,
      supportedTasks: scenario.scopeDeclaration.supportedTasks,
      unsupportedTasks: scenario.scopeDeclaration.unsupportedTasks,
      handoffTargets: scenario.scopeDeclaration.handoffTargets,
    },
    verifierPolicy: {
      requiredInputs: scenario.inputContract.filter((field) => field.required).map((field) => field.key),
      requiredArtifactTypes: scenario.outputArtifacts.map((artifact) => artifact.type),
      requiredArtifactFields: Object.fromEntries(
        scenario.outputArtifacts.map((artifact) => [
          artifact.type,
          artifact.fields.filter((field) => field.required).map((field) => field.key),
        ]),
      ),
      failurePolicyIds: skillPlan.fallbackPolicyIds,
      evidenceBoundaries: [
        ...scenario.scopeDeclaration.unsupportedTasks,
        ...scenario.scopeDeclaration.phaseLimitations,
      ],
    },
    privacySafetyBoundaries: {
      unsupportedTasks: scenario.scopeDeclaration.unsupportedTasks,
      phaseLimitations: scenario.scopeDeclaration.phaseLimitations,
      restrictedDataClasses: inferRestrictedDataClasses(scenario),
      safetyNotes: [
        'Scenario packages declare policy only; runtime execution code belongs to capabilities, tools, or backend adapters.',
        'Scenario packages must not route by prompt regex; dispatch uses declared artifacts, views, capabilities, and verifier policy.',
      ],
    },
  };
}

export function builtInScenarioPackageRef(scenarioId: ScenarioId): ScenarioPackageRef {
  return {
    id: scenarioId,
    version: '1.0.0',
    source: 'built-in',
  };
}

const disallowedScenarioPackagePolicyKeys = new Set([
  'command',
  'execute',
  'executor',
  'handler',
  'promptmatcher',
  'promptpattern',
  'promptregex',
  'regexp',
  'regex',
  'runtimecode',
  'script',
  'shell',
  'sourcecode',
]);

const allowedPolicyFields = new Set<string>(SCENARIO_PACKAGE_POLICY_FIELDS);

export function findScenarioPackagePolicyOnlyViolations(pkg: unknown): string[] {
  const violations: string[] = [];
  if (!isRecord(pkg)) return ['scenario package must be a JSON object'];

  const policy = pkg.policy;
  if (policy !== undefined) {
    if (!isRecord(policy)) {
      violations.push('policy must be a JSON object when present');
    } else {
      for (const key of Object.keys(policy)) {
        if (!allowedPolicyFields.has(key)) {
          violations.push(`policy.${key} is not an allowed scenario package policy field`);
        }
      }
    }
  }

  scanScenarioPackagePolicyOnlyViolations(pkg, [], violations);
  return [...new Set(violations)];
}

function skillIdsForDomain(skillDomain: SkillDomain) {
  return [`agentserver.generate.${skillDomain}`];
}

function inferRestrictedDataClasses(scenario: ScenarioIR) {
  const text = [
    scenario.skillDomain,
    ...scenario.scopeDeclaration.unsupportedTasks,
    ...scenario.scopeDeclaration.phaseLimitations,
  ].join(' ').toLowerCase();
  const restricted = new Set<string>();
  if (text.includes('clinical')) restricted.add('clinical-advice');
  if (text.includes('paywall') || text.includes('付费')) restricted.add('paywalled-full-text');
  if (text.includes('fastq') || text.includes('omics')) restricted.add('raw-human-omics');
  if (text.includes('wet-lab') || text.includes('实验')) restricted.add('wet-lab-claim');
  return [...restricted];
}

function scanScenarioPackagePolicyOnlyViolations(value: unknown, path: string[], violations: string[]) {
  if (typeof value === 'function') {
    violations.push(`${formatPath(path)} contains executable function value`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanScenarioPackagePolicyOnlyViolations(item, [...path, String(index)], violations));
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/[-_]/g, '').toLowerCase();
    const childPath = [...path, key];
    if (disallowedScenarioPackagePolicyKeys.has(normalizedKey)) {
      violations.push(`${formatPath(childPath)} uses a disallowed execution or prompt-regex field`);
    }
    scanScenarioPackagePolicyOnlyViolations(child, childPath, violations);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatPath(path: string[]) {
  return path.length ? path.join('.') : '<root>';
}

function safeElementId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed';
}

function smokePromptForInputContract(inputContract: ScenarioInputField[]) {
  const required = inputContract.find((field) => field.required);
  if (!required) return '';
  return required.defaultValue === undefined ? required.label : String(required.defaultValue);
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}
