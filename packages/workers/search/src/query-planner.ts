import type { ResearchDomain, ResearchIntent } from './types.js';

export type ResearchQueryPlan = {
  interpretedIntent: {
    intent: ResearchIntent;
    domain: ResearchDomain;
    rationale: string;
  };
  generatedQueries: string[];
};

const INTENT_KEYWORDS: Array<[ResearchIntent, RegExp]> = [
  ['latest', /\b(latest|recent|new|progress|advance|trend|202[4-9]|最新|最近|进展|趋势)\b/i],
  ['baseline', /\b(baseline|benchmark|compare|comparison|基线|对比)\b/i],
  ['sota', /\b(sota|state[- ]of[- ]the[- ]art|best|leaderboard|最优|前沿)\b/i],
  ['dataset', /\b(dataset|data set|benchmark data|corpus|数据集)\b/i],
  ['code', /\b(code|github|implementation|repo|repository|开源|代码|实现)\b/i],
  ['gap', /\b(gap|limitation|open problem|future work|机会|缺口|不足|问题)\b/i]
];

const DOMAIN_KEYWORDS: Array<[ResearchDomain, RegExp]> = [
  ['biology', /\b(protein|genom|rna|dna|cell|bio|enzyme|antibody|biology|meiosis|meiotic|germ\s*cell|gametogenesis|spermatogenesis|oogenesis|retinoic\s+acid|stra8|meiosin|生物|蛋白)\b/i],
  ['chemistry', /\b(molecule|molecular|chemical|chemistry|reaction|drug|ligand|分子|化学|药物)\b/i],
  ['materials', /\b(material|crystal|catalyst|battery|polymer|alloy|材料|晶体|催化)\b/i],
  ['physics', /\b(physics|pde|fluid|quantum|turbulence|simulation|物理|偏微分|流体|量子)\b/i],
  ['climate', /\b(climate|weather|earth system|atmosphere|forecast|气候|天气|地球系统)\b/i]
];

const DOMAIN_EXPANSIONS: Record<ResearchDomain, string[]> = {
  ai4s: ['AI for Science', 'scientific machine learning'],
  biology: ['computational biology', 'protein design', 'foundation model biology'],
  chemistry: ['molecular generation', 'reaction prediction', 'AI chemistry'],
  materials: ['materials discovery', 'crystal generation', 'materials informatics'],
  physics: ['scientific machine learning', 'physics-informed learning', 'surrogate modeling'],
  climate: ['climate modeling', 'weather forecasting', 'earth system AI'],
  general: []
};

const INTENT_EXPANSIONS: Record<ResearchIntent, string[]> = {
  overview: ['survey', 'review'],
  latest: ['2024 OR 2025 OR 2026', 'recent advances'],
  baseline: ['benchmark', 'baseline comparison'],
  sota: ['state of the art', 'leaderboard'],
  dataset: ['dataset', 'benchmark dataset'],
  code: ['GitHub', 'open source implementation'],
  gap: ['limitations', 'open problems']
};

export function planResearchQueries(input: {
  query: string;
  intent?: string;
  domain?: string;
  maxQueries?: number;
}): ResearchQueryPlan {
  const query = normalizeQuery(input.query);
  const intent = normalizeIntent(input.intent) ?? inferIntent(query);
  const domain = normalizeDomain(input.domain) ?? inferDomain(query);
  const domainExpansions = domain === 'biology' && isWetBiologyQuery(query)
    ? wetBiologyExpansions(query)
    : DOMAIN_EXPANSIONS[domain];
  const candidates = new Set<string>();
  candidates.add(query);
  for (const expansion of domainExpansions) {
    candidates.add(`${query} ${expansion}`);
  }
  for (const expansion of INTENT_EXPANSIONS[intent]) {
    candidates.add(`${query} ${expansion}`);
  }
  if (domain !== 'ai4s' && domain !== 'general') {
    candidates.add(`${query} AI for Science ${domain}`);
  }
  const generatedQueries = [...candidates]
    .map((candidate) => normalizeQuery(candidate))
    .filter(Boolean)
    .slice(0, input.maxQueries ?? 8);
  return {
    interpretedIntent: {
      intent,
      domain,
      rationale: `Inferred ${intent} intent for ${domain} research search from the user query.`
    },
    generatedQueries
  };
}

function isWetBiologyQuery(query: string): boolean {
  return /\b(meiosis|meiotic|germ\s*cell|gametogenesis|spermatogenesis|oogenesis|retinoic\s+acid|stra8|meiosin|dmrt1|synaptonemal|chromatin|transcription factor|rna-binding|pubmed)\b/i
    .test(query);
}

function wetBiologyExpansions(query: string): string[] {
  const expansions = ['PubMed Europe PMC', 'germ cell development'];
  if (/\b(meiosis|meiotic|stra8|meiosin|retinoic\s+acid)\b/i.test(query)) {
    expansions.unshift('meiotic entry retinoic acid');
  }
  if (/\b(spermatogenesis|male|testis|spermatogonial)\b/i.test(query)) {
    expansions.unshift('spermatogenesis meiotic initiation');
  }
  return [...new Set(expansions)];
}

function inferIntent(query: string): ResearchIntent {
  for (const [intent, pattern] of INTENT_KEYWORDS) {
    if (pattern.test(query)) return intent;
  }
  return 'overview';
}

function inferDomain(query: string): ResearchDomain {
  for (const [domain, pattern] of DOMAIN_KEYWORDS) {
    if (pattern.test(query)) return domain;
  }
  return /\b(ai4s|ai for science|scientific machine learning)\b/i.test(query)
    ? 'ai4s'
    : 'general';
}

function normalizeIntent(value: string | undefined): ResearchIntent | null {
  if (
    value === 'overview' ||
    value === 'latest' ||
    value === 'baseline' ||
    value === 'sota' ||
    value === 'dataset' ||
    value === 'code' ||
    value === 'gap'
  ) {
    return value;
  }
  return null;
}

function normalizeDomain(value: string | undefined): ResearchDomain | null {
  if (
    value === 'ai4s' ||
    value === 'biology' ||
    value === 'chemistry' ||
    value === 'materials' ||
    value === 'physics' ||
    value === 'climate' ||
    value === 'general'
  ) {
    return value;
  }
  return null;
}

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
