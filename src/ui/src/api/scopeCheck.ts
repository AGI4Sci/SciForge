import type { ScenarioId } from '../data';
import { SCENARIO_SPECS } from '@sciforge/scenario-core/scenario-specs';

const domainSignals: Record<ScenarioId, RegExp[]> = {
  'literature-evidence-review': [/\b(pubmed|paper|literature|evidence|review|clinical trial|trial|文献|证据|综述|临床试验)\b/i],
  'structure-exploration': [/\b(pdb|structure|alphafold|residue|ligand|pocket|binding|结构|残基|口袋|配体)\b/i],
  'omics-differential-exploration': [/\b(omics|rna|expression|differential|deseq2|scanpy|umap|crispr screen|genome[- ]wide screen|screen|组学|表达|差异|筛选)\b/i],
  'biomedical-knowledge-graph': [/\b(uniprot|chembl|opentargets|gene|protein|compound|drug|pathway|知识|药物|基因|蛋白|通路)\b/i],
};

export interface ScopeCheckResult {
  inScope: boolean;
  matchedScenarios: ScenarioId[];
  unsupportedMatches: string[];
  handoffTargets: ScenarioId[];
  plan: string[];
  promptPrefix: string;
}

export function scopeCheck(scenarioId: ScenarioId, prompt: string): ScopeCheckResult {
  const spec = SCENARIO_SPECS[scenarioId];
  const normalized = prompt.toLowerCase();
  const matchedScenarios = (Object.keys(domainSignals) as ScenarioId[])
    .filter((candidate) => domainSignals[candidate].some((pattern) => pattern.test(prompt)));
  const unsupportedMatches = spec.scopeDeclaration.unsupportedTasks
    .filter((task) => tokenOverlap(normalized, task.toLowerCase()) >= 2);
  const crossAgentTargets = matchedScenarios.filter((candidate) => candidate !== scenarioId);
  const handoffTargets = uniqueAgents([
    ...crossAgentTargets,
    ...spec.scopeDeclaration.handoffTargets.filter((target) => crossAgentTargets.includes(target)),
  ]);
  const inScope = unsupportedMatches.length === 0 && crossAgentTargets.length <= 1;
  const plan = buildPlan(scenarioId, matchedScenarios, handoffTargets, unsupportedMatches);
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

function buildPlan(scenarioId: ScenarioId, matchedScenarios: ScenarioId[], handoffTargets: ScenarioId[], unsupportedMatches: string[]) {
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

function uniqueAgents(values: ScenarioId[]) {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}
