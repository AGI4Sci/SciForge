export type SkillDomain = 'literature' | 'structure' | 'omics' | 'knowledge';

export interface MatchableSkillManifest {
  id: string;
  kind: string;
  description: string;
  skillDomains: readonly string[];
  entrypoint: { type: string };
  examplePrompts: readonly string[];
}

export interface MatchableSkill {
  id: string;
  manifest: MatchableSkillManifest;
}

export interface ScoredSkillMatch<TSkill extends MatchableSkill> {
  skill: TSkill;
  score: number;
}

export function scoreSkillByPackagePolicy(manifest: MatchableSkillManifest, skillDomain: SkillDomain, prompt: string) {
  let score = manifest.skillDomains.includes(skillDomain) ? 10 : 0;
  if (manifest.id === 'literature.web_search' && directWebProviderRequested(prompt)) {
    score += 100;
  }
  if (manifest.id === 'scp.drug-screening-docking' && promptMatchesDrugScreening(prompt)) {
    score += 80;
  }
  if (manifest.id === 'scp.protein-properties-calculation' && promptMatchesProteinProperties(prompt)) {
    score += 60;
  }
  if (manifest.kind === 'package') score += 4;
  if (manifest.kind === 'workspace') score += 2;
  const markdownNameHit = manifest.entrypoint.type === 'markdown-skill' && promptIncludesSkillName(manifest.id, prompt);
  if (markdownNameHit) score += 4;
  if (manifest.entrypoint.type !== 'markdown-skill' || markdownNameHit) {
    for (const item of manifest.examplePrompts) {
      const tokens = item.toLowerCase().split(/[^a-z0-9_]+/).filter((token) => token.length > 2);
      score += tokens.filter((token) => prompt.includes(token)).length;
    }
  }
  const text = `${manifest.id} ${manifest.description}`.toLowerCase();
  for (const token of prompt.split(/[^a-z0-9_]+/).filter((item) => item.length > 2)) {
    if (text.includes(token)) score += manifest.entrypoint.type === 'markdown-skill' ? 0.2 : 0.5;
  }
  return score;
}

export function selectSkillByPackagePolicy<TSkill extends MatchableSkill>(
  scored: Array<ScoredSkillMatch<TSkill>>,
): TSkill | undefined {
  const top = scored[0];
  if (!top) return undefined;
  const bestExecutable = scored.find((item) => item.skill.manifest.entrypoint.type !== 'markdown-skill');
  if (
    top.skill.manifest.entrypoint.type === 'markdown-skill'
    && bestExecutable
    && top.score < bestExecutable.score + 4
  ) {
    return bestExecutable.skill;
  }
  return top.skill;
}

export function skillAllowedByPackagePolicy(skill: MatchableSkill, prompt: string) {
  if (skill.id === 'literature.pubmed_search') {
    return !explicitWebSearchRequested(prompt);
  }
  if (skill.id === 'literature.web_search') {
    return explicitWebSearchRequested(prompt) && !specializedBiomedicalSearchRequested(prompt);
  }
  if (skill.id === 'inspector.generic_file_table_log') {
    return promptMatchesInspectorRequest(prompt) && !promptMatchesBiomedicalExecutionRequest(prompt);
  }
  if (skill.id === 'sequence.ncbi_blastp_search') {
    return promptMatchesBlastSearch(prompt);
  }
  if (skill.id === 'knowledge.uniprot_chembl_lookup') {
    return !promptMatchesDrugScreening(prompt);
  }
  if (skill.id === 'structure.rcsb_latest_or_entry') {
    return promptMatchesStructureLookup(prompt);
  }
  return true;
}

function promptMatchesDrugScreening(prompt: string) {
  return /\b(virtual screening|drug screening|docking|admet|lipinski|smiles|pocket)\b|虚拟筛选|高通量|对接|类药性|口袋/i.test(prompt);
}

function promptMatchesProteinProperties(prompt: string) {
  return /\bprotein\b.*\b(properties|physicochemical|isoelectric|instability|sequence)\b|\bsequence\b.*\bprotein\b/i.test(prompt)
    && !promptMatchesBlastSearch(prompt);
}

function promptMatchesInspectorRequest(prompt: string) {
  return /\b(inspect|preview|open|show|view|log|artifact|file|table|json)\b|查看|检查|预览|打开|日志|文件|表格|产物/i.test(prompt);
}

function promptMatchesBiomedicalExecutionRequest(prompt: string) {
  return /\b(smiles|admet|lipinski|docking|dock|screening|pocket|pdb|scp|virtual screening)\b|虚拟筛选|对接|类药性|口袋|蛋白/i.test(prompt);
}

function promptMatchesBlastSearch(prompt: string) {
  return /\bblastp?\b|\balignment\b|\bhomolog|similarity|比对|同源/i.test(prompt);
}

function promptMatchesStructureLookup(prompt: string) {
  return /\bpdb\b|\brcsb\b|\balphafold\b|\buniprot\b|\baf-[a-z0-9]+|residue|coordinate|latest .*structure|结构|坐标/i.test(prompt);
}

function explicitWebSearchRequested(prompt: string) {
  return /\b(?:google|web|browser|internet|arxiv|news|网页|互联网|浏览器|谷歌)\b|(?:google|web|browser|网页|互联网|浏览器|谷歌)\s*(?:search|检索|搜索|查找)|(?:通过|用|使用)\s*(?:google|谷歌|web|网页|互联网|浏览器|本地浏览器)\s*(?:search|检索|搜索|查找)?/i.test(prompt);
}

function directWebProviderRequested(prompt: string) {
  return /\b(?:google|browser|internet|arxiv|news)\b|(?:网页|互联网|浏览器|谷歌)|(?:通过|用|使用)\s*(?:google|谷歌|web|网页|互联网|浏览器|本地浏览器)\s*(?:search|检索|搜索|查找)?/i.test(prompt);
}

function specializedBiomedicalSearchRequested(prompt: string) {
  return /\bbiomedical\s+web\s+search\b|\b(?:uniprot|drugbank|chembl|opentargets)\b.*\b(?:pubmed|drugbank|uniprot|chembl|opentargets)\b/i.test(prompt)
    && !directWebProviderRequested(prompt);
}

function promptIncludesSkillName(id: string, prompt: string) {
  const cleanId = id.replace(/^scp\./, '');
  const generic = new Set(['analysis', 'calculation', 'search', 'retrieval', 'pipeline', 'study', 'report', 'profiling', 'assessment']);
  const tokens = cleanId
    .split(/[_.-]+/)
    .filter((token) => token.length > 2 && !generic.has(token));
  return tokens.length > 0 && tokens.every((token) => prompt.includes(token) || prompt.includes(stemToken(token)));
}

function stemToken(token: string) {
  return token.replace(/(?:ation|tion|ing|ies|s)$/i, '');
}
