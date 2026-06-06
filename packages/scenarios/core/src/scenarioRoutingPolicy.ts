import type { ScenarioId, ScenarioRuntimeOverride } from './contracts';
import { SCENARIO_PRESETS, SCENARIO_SPECS, type SkillDomain } from './scenarioSpecs';

export type { SkillDomain } from './scenarioSpecs';

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
export const SUPPORTED_SCENARIO_SKILL_DOMAINS: readonly SkillDomain[] = Object.freeze(
  Object.keys(scenarioIdBySkillDomain) as SkillDomain[],
);

const builtInScenarioIdSet = new Set<string>(builtInScenarioIds);
const skillDomainSet = new Set<string>(SUPPORTED_SCENARIO_SKILL_DOMAINS);

type ScenarioSemanticSignalCandidate = {
  scenarioId: ScenarioId;
  structuredSignals: string[];
  lexicalFeatures: string[];
  confidence: 'high' | 'low';
  score: number;
};

const scenarioPromptSignals: Record<ScenarioId, { structured: RegExp[]; lexical: RegExp[] }> = {
  'literature-evidence-review': {
    structured: [/\b(pubmed|paper-list|clinical trial|semantic scholar|crossref|literature evidence|evidence review|文献|证据矩阵|综述|临床试验)\b/i],
    lexical: [/\b(paper|literature|evidence|review|trial)\b/i],
  },
  'structure-exploration': {
    structured: [/\b(pdb|alphafold|protein structure|structure viewer|molecule viewer|residue|ligand|pocket|binding|结构|残基|口袋|配体)\b/i],
    lexical: [/\b(structure|protein)\b/i],
  },
  'omics-differential-exploration': {
    structured: [/\b(omics|rna|expression matrix|differential expression|deseq2|scanpy|umap|crispr screen|genome[- ]wide screen|spatial transcriptomics|组学|表达|差异|筛选)\b/i],
    lexical: [/\b(expression|differential|screen|spatial|matrix)\b/i],
  },
  'biomedical-knowledge-graph': {
    structured: [/\b(uniprot|chembl|opentargets|knowledge graph|knowledge[- ]graph|compound|drug|pathway|知识图谱|药物|基因|蛋白|通路)\b/i],
    lexical: [/\b(gene|protein|target|network)\b/i],
  },
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
  // Final routing truth must come from semantic candidates. Lexical detectors are retained only as low-confidence features.
  return scenarioSemanticSignalCandidatesForPrompt(prompt)
    .filter((candidate) => candidate.confidence === 'high')
    .map((candidate) => candidate.scenarioId);
}

export function scopeCheck(scenarioId: ScenarioId, prompt: string): ScenarioScopeCheckResult {
  const spec = SCENARIO_SPECS[scenarioId];
  const normalized = prompt.toLowerCase();
  const matchedScenarios = matchedScenariosForPrompt(prompt);
  // Unsupported-task routing must not treat token overlap as final truth; overlap remains low-confidence evidence only.
  const unsupportedMatches = spec.scopeDeclaration.unsupportedTasks
    .map((task) => scopeUnsupportedCandidate(task, normalized))
    .filter((candidate) => candidate.confidence === 'high')
    .map((candidate) => candidate.task);
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

function scenarioSemanticSignalCandidatesForPrompt(prompt: string): ScenarioSemanticSignalCandidate[] {
  return builtInScenarioIds
    .map((scenarioId) => {
      const signals = scenarioPromptSignals[scenarioId];
      const structuredSignals = matchedPatternSources(signals.structured, prompt);
      const lexicalFeatures = matchedPatternSources(signals.lexical, prompt);
      const score = structuredSignals.length * 10 + lexicalFeatures.length;
      return {
        scenarioId,
        structuredSignals,
        lexicalFeatures,
        confidence: structuredSignals.length > 0 ? 'high' as const : 'low' as const,
        score,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.scenarioId.localeCompare(right.scenarioId));
}

function matchedPatternSources(patterns: RegExp[], text: string) {
  return patterns.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}

function scopeUnsupportedCandidate(
  task: string,
  normalizedPrompt: string,
): { task: string; lexicalOverlap: number; confidence: 'high' | 'low' } {
  const lexicalOverlap = tokenOverlap(normalizedPrompt, task.toLowerCase());
  return {
    task,
    lexicalOverlap,
    confidence: 'low' as const,
  };
}

function tokenOverlap(left: string, right: string) {
  const leftTokens = new Set(left.split(/[^a-z0-9]+/).filter((token) => token.length >= 4));
  return right.split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && leftTokens.has(token)).length;
}

function uniqueScenarioIds(values: ScenarioId[]) {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}
