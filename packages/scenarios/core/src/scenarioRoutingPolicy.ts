import type { ScenarioId, ScenarioRuntimeOverride } from './contracts';
import { SCENARIO_PRESETS, SCENARIO_SPECS, type SkillDomain } from './scenarioSpecs';

export type ScenarioRoutingInput = {
  scenarioId?: string;
  scenarioOverride?: {
    skillDomain?: string;
  } | null;
};

export interface ScenarioScopeCheckResult {
  inScope: boolean;
  matchedScenarios: ScenarioId[];
  unsupportedMatches: string[];
  handoffTargets: ScenarioId[];
  plan: string[];
  promptPrefix: string;
}

export const builtInScenarioIds = Object.keys(SCENARIO_SPECS) as ScenarioId[];
export const defaultBuiltInScenarioId: ScenarioId = 'literature-evidence-review';

export const scenarioIdBySkillDomain = Object.fromEntries(
  builtInScenarioIds.map((scenarioId) => [SCENARIO_SPECS[scenarioId].skillDomain, scenarioId]),
) as Record<ScenarioRuntimeOverride['skillDomain'], ScenarioId>;

const builtInScenarioIdSet = new Set<string>(builtInScenarioIds);
const skillDomainSet = new Set<string>(Object.keys(scenarioIdBySkillDomain));

const scenarioPromptSignals: Record<ScenarioId, RegExp[]> = {
  'literature-evidence-review': [/\b(pubmed|paper|literature|evidence|review|clinical trial|trial|文献|证据|综述|临床试验)\b/i],
  'structure-exploration': [/\b(pdb|structure|alphafold|residue|ligand|pocket|binding|结构|残基|口袋|配体)\b/i],
  'omics-differential-exploration': [/\b(omics|rna|expression|differential|deseq2|scanpy|umap|crispr screen|genome[- ]wide screen|screen|组学|表达|差异|筛选)\b/i],
  'biomedical-knowledge-graph': [/\b(uniprot|chembl|opentargets|gene|protein|compound|drug|pathway|知识|药物|基因|蛋白|通路)\b/i],
};

export function isBuiltInScenarioId(value: unknown): value is ScenarioId {
  return typeof value === 'string' && builtInScenarioIdSet.has(value);
}

export function isSkillDomain(value: unknown): value is SkillDomain {
  return typeof value === 'string' && skillDomainSet.has(value);
}

export function scenarioIdForSkillDomain(skillDomain: unknown): ScenarioId | undefined {
  return isSkillDomain(skillDomain) ? scenarioIdBySkillDomain[skillDomain] : undefined;
}

export function builtInScenarioIdForRuntimeInput(input: ScenarioRoutingInput): ScenarioId {
  const overrideScenarioId = scenarioIdForSkillDomain(input.scenarioOverride?.skillDomain);
  if (overrideScenarioId) return overrideScenarioId;
  if (isBuiltInScenarioId(input.scenarioId)) return input.scenarioId;
  return defaultBuiltInScenarioId;
}

export function skillDomainForRuntimeInput(input: ScenarioRoutingInput): SkillDomain {
  const overrideSkillDomain = input.scenarioOverride?.skillDomain;
  if (isSkillDomain(overrideSkillDomain)) return overrideSkillDomain;
  return SCENARIO_SPECS[builtInScenarioIdForRuntimeInput(input)].skillDomain;
}

export function createBuiltInScenarioRecord<T>(
  valueForScenario: T | ((scenarioId: ScenarioId) => T),
): Record<ScenarioId, T> {
  return Object.fromEntries(builtInScenarioIds.map((scenarioId) => [
    scenarioId,
    typeof valueForScenario === 'function'
      ? (valueForScenario as (scenarioId: ScenarioId) => T)(scenarioId)
      : valueForScenario,
  ])) as Record<ScenarioId, T>;
}

export function scenarioRuntimeOverrideForBuiltInScenario(scenarioId: ScenarioId): ScenarioRuntimeOverride {
  const scenario = SCENARIO_PRESETS[scenarioId];
  return {
    title: scenario.title,
    description: scenario.description,
    skillDomain: scenario.skillDomain,
    scenarioMarkdown: scenario.scenarioMarkdown,
    defaultComponents: scenario.componentPolicy.defaultComponents,
    allowedComponents: scenario.componentPolicy.allowedComponents,
    fallbackComponent: scenario.componentPolicy.fallbackComponent,
  };
}

export function scenarioRuntimeOverrideForRuntimeInput(input: ScenarioRoutingInput): ScenarioRuntimeOverride {
  return scenarioRuntimeOverrideForBuiltInScenario(builtInScenarioIdForRuntimeInput(input));
}

export function normalizeScenarioPromptTitle(
  prompt: string,
  { fallbackTitle = '新聊天', maxLength = 36 }: { fallbackTitle?: string; maxLength?: number } = {},
) {
  const title = prompt.trim().replace(/\s+/g, ' ').slice(0, maxLength);
  return title || fallbackTitle;
}

export function matchedScenariosForPrompt(prompt: string): ScenarioId[] {
  return builtInScenarioIds.filter((scenarioId) => scenarioPromptSignals[scenarioId].some((pattern) => pattern.test(prompt)));
}

export function scopeCheck(scenarioId: ScenarioId, prompt: string): ScenarioScopeCheckResult {
  const spec = SCENARIO_SPECS[scenarioId];
  const normalized = prompt.toLowerCase();
  const matchedScenarios = matchedScenariosForPrompt(prompt);
  const unsupportedMatches = spec.scopeDeclaration.unsupportedTasks
    .filter((task) => tokenOverlap(normalized, task.toLowerCase()) >= 2);
  const crossAgentTargets = matchedScenarios.filter((candidate) => candidate !== scenarioId);
  const handoffTargets = uniqueScenarioIds([
    ...crossAgentTargets,
    ...spec.scopeDeclaration.handoffTargets.filter((target) => crossAgentTargets.includes(target)),
  ]);
  const inScope = unsupportedMatches.length === 0 && crossAgentTargets.length <= 1;
  const plan = buildScopePlan(scenarioId, matchedScenarios, handoffTargets, unsupportedMatches);
  return {
    inScope,
    matchedScenarios,
    unsupportedMatches,
    handoffTargets,
    plan,
    promptPrefix: plan.length ? [
      'Scope check:',
      ...plan.map((item, index) => `${index + 1}. ${item}`),
      'Do not collapse this into an unverified giant script; return explicit boundaries and artifact handoff steps when needed.',
    ].join('\n') : '',
  };
}

export function promptWithScopeCheck(scenarioId: ScenarioId, prompt: string) {
  const result = scopeCheck(scenarioId, prompt);
  return result.promptPrefix ? `${result.promptPrefix}\n\nUser prompt:\n${prompt}` : prompt;
}

function buildScopePlan(scenarioId: ScenarioId, matchedScenarios: ScenarioId[], handoffTargets: ScenarioId[], unsupportedMatches: string[]) {
  const plan: string[] = [];
  if (unsupportedMatches.length) {
    plan.push(`Current ${scenarioId} scope marks these as unsupported or requiring external confirmation: ${unsupportedMatches.join('; ')}.`);
  }
  const crossAgents = matchedScenarios.filter((candidate) => candidate !== scenarioId);
  if (crossAgents.length > 1) {
    plan.push(`Request spans multiple domains (${matchedScenarios.join(', ')}); produce a staged plan rather than a single monolithic analysis.`);
  } else if (crossAgents.length === 1) {
    plan.push(`Request includes ${crossAgents[0]} signals; identify the artifact needed for handoff before continuing.`);
  }
  if (handoffTargets.length) {
    plan.push(`Recommended handoff targets: ${handoffTargets.join(', ')}.`);
  }
  return plan;
}

function tokenOverlap(left: string, right: string) {
  const leftTokens = new Set(left.split(/[^a-z0-9]+/).filter((token) => token.length >= 4));
  return right.split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && leftTokens.has(token)).length;
}

function uniqueScenarioIds(values: ScenarioId[]) {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}
