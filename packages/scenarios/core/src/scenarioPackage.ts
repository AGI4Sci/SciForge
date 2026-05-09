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

export const DEFAULT_SCENARIO_PACKAGE_VERSION = '1.0.0' as const;

export function normalizeScenarioPackageVersion(value: unknown, fallback = DEFAULT_SCENARIO_PACKAGE_VERSION) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

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
  metadata?: Record<string, unknown>;
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
    version: DEFAULT_SCENARIO_PACKAGE_VERSION,
    status: 'published',
    scenario,
    skillPlan,
    uiPlan,
    tests: [{
      id: `smoke.${scenarioId}.default`,
      prompt: smokePromptForInputContract(spec.inputContract) || spec.description,
      expectedArtifactTypes: spec.outputArtifacts.map((artifact) => artifact.type),
    }],
    versions: [{
      version: DEFAULT_SCENARIO_PACKAGE_VERSION,
      status: 'published',
      createdAt,
      summary: `Built-in package for ${spec.title}.`,
      scenarioHash,
    }],
  };
}

export function builtInScenarioPackageRef(scenarioId: ScenarioId): ScenarioPackageRef {
  return {
    id: scenarioId,
    version: DEFAULT_SCENARIO_PACKAGE_VERSION,
    source: 'built-in',
  };
}

function skillIdsForDomain(skillDomain: SkillDomain) {
  return [`agentserver.generate.${skillDomain}`];
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
