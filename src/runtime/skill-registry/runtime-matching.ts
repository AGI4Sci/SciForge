import type { GatewayRequest, SciForgeSkillDomain, SkillAvailability, SkillManifest } from '../runtime-types.js';

export function matchSkill(request: GatewayRequest, skills: SkillAvailability[]): SkillAvailability | undefined {
  const allowed = new Set(request.availableSkills?.filter(Boolean) ?? []);
  const prompt = request.prompt.toLowerCase();
  const scored = skills
    .filter((skill) => skill.available)
    .filter((skill) => !allowed.size || allowed.has(skill.id))
    .filter((skill) => skill.manifest.skillDomains.includes(request.skillDomain))
    .filter((skill) => skill.manifest.entrypoint.type !== 'inspector' || request.artifacts.length > 0)
    .filter((skill) => skillAllowedByPrompt(skill, prompt))
    .map((skill) => ({ skill, score: scoreSkill(skill.manifest, request.skillDomain, prompt) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || priority(left.skill.kind) - priority(right.skill.kind));
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

export function scoreSkill(manifest: SkillManifest, skillDomain: SciForgeSkillDomain, prompt: string) {
  let score = manifest.skillDomains.includes(skillDomain) ? 10 : 0;
  if (manifest.id === 'literature.web_search' && directWebProviderRequested(prompt)) {
    score += 100;
  }
  if (
    manifest.id === 'scp.drug-screening-docking'
    && /\b(virtual screening|drug screening|docking|admet|lipinski|smiles|pocket)\b|虚拟筛选|高通量|对接|类药性|口袋/i.test(prompt)
  ) {
    score += 80;
  }
  if (
    manifest.id === 'scp.protein-properties-calculation'
    && /\bprotein\b.*\b(properties|physicochemical|isoelectric|instability|sequence)\b|\bsequence\b.*\bprotein\b/i.test(prompt)
    && !/\bblastp?\b|\balignment\b|\bhomolog|similarity|比对|同源/i.test(prompt)
  ) {
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

function skillAllowedByPrompt(skill: SkillAvailability, prompt: string) {
  if (skill.id === 'literature.pubmed_search') {
    return !explicitWebSearchRequested(prompt);
  }
  if (skill.id === 'literature.web_search') {
    return explicitWebSearchRequested(prompt) && !specializedBiomedicalSearchRequested(prompt);
  }
  if (skill.id === 'inspector.generic_file_table_log') {
    return /\b(inspect|preview|open|show|view|log|artifact|file|table|json)\b|查看|检查|预览|打开|日志|文件|表格|产物/i.test(prompt)
      && !/\b(smiles|admet|lipinski|docking|dock|screening|pocket|pdb|scp|virtual screening)\b|虚拟筛选|对接|类药性|口袋|蛋白/i.test(prompt);
  }
  if (skill.id === 'sequence.ncbi_blastp_search') {
    return /\bblastp?\b|\balignment\b|\bhomolog|similarity|比对|同源/i.test(prompt);
  }
  if (skill.id === 'knowledge.uniprot_chembl_lookup') {
    return !/\b(virtual screening|docking|admet|lipinski|smiles|pocket)\b|虚拟筛选|对接|类药性|口袋/i.test(prompt);
  }
  if (skill.id === 'structure.rcsb_latest_or_entry') {
    return /\bpdb\b|\brcsb\b|\balphafold\b|\buniprot\b|\baf-[a-z0-9]+|residue|coordinate|latest .*structure|结构|坐标/i.test(prompt);
  }
  return true;
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

function priority(kind: SkillManifest['kind']) {
  return kind === 'package' ? 0 : kind === 'workspace' ? 1 : kind === 'installed' ? 2 : 3;
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
