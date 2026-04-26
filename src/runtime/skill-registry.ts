import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { BioAgentSkillDomain, GatewayRequest, SkillAvailability, SkillManifest } from './runtime-types.js';
import { fileExists } from './workspace-task-runner.js';

const SEED_SKILLS_ROOT = resolve(process.cwd(), 'skills', 'seed');

export async function loadSkillRegistry(request: Pick<GatewayRequest, 'workspacePath'>): Promise<SkillAvailability[]> {
  const workspace = resolve(request.workspacePath || process.cwd());
  const roots = [
    { root: SEED_SKILLS_ROOT, kind: 'seed' as const },
    { root: join(workspace, '.bioagent', 'skills'), kind: 'workspace' as const },
    { root: resolve(process.cwd(), 'skills', 'installed'), kind: 'installed' as const },
  ];
  const skills: SkillAvailability[] = [];
  for (const { root, kind } of roots) {
    for (const manifestPath of await manifestFiles(root)) {
      const manifest = await readManifest(manifestPath, kind);
      const availability = await validateManifest(manifest, manifestPath);
      skills.push(availability);
    }
    if (kind === 'installed') {
      for (const skillPath of await markdownSkillFiles(root)) {
        if (skills.some((skill) => dirname(skill.manifestPath) === dirname(skillPath))) continue;
        const manifest = await readMarkdownSkillManifest(skillPath);
        const availability = await validateManifest(manifest, skillPath);
        skills.push(availability);
      }
    }
  }
  await persistWorkspaceSkillStatus(workspace, skills);
  return skills;
}

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

export function agentServerGenerationSkill(skillDomain: BioAgentSkillDomain): SkillAvailability {
  const checkedAt = new Date().toISOString();
  return {
    id: `agentserver.generate.${skillDomain}`,
    kind: 'installed',
    available: true,
    reason: 'No executable skill matched; caller should fall through to AgentServer task generation.',
    checkedAt,
    manifestPath: 'agentserver://generation',
    manifest: {
      id: `agentserver.generate.${skillDomain}`,
      kind: 'installed',
      description: 'Generic AgentServer task generation fallback.',
      skillDomains: [skillDomain],
      inputContract: { prompt: 'string', workspacePath: 'string' },
      outputArtifactSchema: { type: 'runtime-artifact' },
      entrypoint: { type: 'agentserver-generation' },
      environment: { runtime: 'AgentServer' },
      validationSmoke: { mode: 'delegated' },
      examplePrompts: [],
      promotionHistory: [],
    },
  };
}

async function manifestFiles(root: string): Promise<string[]> {
  if (!await fileExists(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await manifestFiles(path));
    if (entry.isFile() && entry.name === 'skill.json') files.push(path);
  }
  return files;
}

async function markdownSkillFiles(root: string): Promise<string[]> {
  if (!await fileExists(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await markdownSkillFiles(path));
    if (entry.isFile() && entry.name === 'SKILL.md') files.push(path);
  }
  return files;
}

async function readManifest(path: string, kind: SkillManifest['kind']): Promise<SkillManifest> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<SkillManifest>;
  return {
    id: String(parsed.id || ''),
    kind: parsed.kind ?? kind,
    description: String(parsed.description || ''),
    skillDomains: Array.isArray(parsed.skillDomains) ? parsed.skillDomains as BioAgentSkillDomain[] : [],
    inputContract: recordOrEmpty(parsed.inputContract),
    outputArtifactSchema: recordOrEmpty(parsed.outputArtifactSchema),
    entrypoint: recordOrEmpty(parsed.entrypoint) as SkillManifest['entrypoint'],
    environment: recordOrEmpty(parsed.environment),
    validationSmoke: recordOrEmpty(parsed.validationSmoke),
    examplePrompts: Array.isArray(parsed.examplePrompts) ? parsed.examplePrompts.map(String) : [],
    promotionHistory: Array.isArray(parsed.promotionHistory) ? parsed.promotionHistory.filter(isRecord) : [],
    scopeDeclaration: isRecord(parsed.scopeDeclaration) ? parsed.scopeDeclaration : undefined,
  };
}

async function readMarkdownSkillManifest(path: string): Promise<SkillManifest> {
  const text = await readFile(path, 'utf8');
  const frontmatter = parseMarkdownFrontmatter(text);
  const id = safeSkillId(String(frontmatter.name || basename(dirname(path))));
  const description = String(frontmatter.description || firstMarkdownParagraph(text) || `Installed markdown skill ${id}.`);
  return {
    id: `scp.${id}`,
    kind: 'installed',
    description,
    skillDomains: inferSkillDomains(`${id} ${description} ${text.slice(0, 4000)}`),
    inputContract: {
      prompt: 'Free-text user request matched against this Markdown skill.',
      skillMarkdownRef: path,
    },
    outputArtifactSchema: {
      type: 'agentserver-generated-runtime-artifact',
      sourceSkill: id,
    },
    entrypoint: {
      type: 'markdown-skill',
      path,
    },
    environment: {
      language: 'markdown',
      execution: 'AgentServer or SCP Hub adapter required',
      scpToolId: frontmatter.scpToolId,
      scpHubUrl: frontmatter.scpHubUrl,
    },
    validationSmoke: {
      mode: 'markdown-skill',
      frontmatter: Boolean(Object.keys(frontmatter).length),
    },
    examplePrompts: examplePromptsForMarkdownSkill(id, description),
    promotionHistory: [],
    scopeDeclaration: {
      source: 'skills/installed/scp',
      markdownRef: path,
      scpToolId: frontmatter.scpToolId,
      scpHubUrl: frontmatter.scpHubUrl,
    },
  };
}

async function validateManifest(manifest: SkillManifest, manifestPath: string): Promise<SkillAvailability> {
  const checkedAt = new Date().toISOString();
  const missing = ['id', 'description', 'inputContract', 'outputArtifactSchema', 'entrypoint', 'environment', 'validationSmoke', 'examplePrompts', 'promotionHistory']
    .filter((key) => !(key in manifest) || manifest[key as keyof SkillManifest] === undefined || manifest[key as keyof SkillManifest] === '');
  if (missing.length) {
    return { id: manifest.id || manifestPath, kind: manifest.kind, available: false, reason: `Manifest missing ${missing.join(', ')}`, checkedAt, manifestPath, manifest };
  }
  if (!manifest.skillDomains.length) {
    return { id: manifest.id, kind: manifest.kind, available: false, reason: 'Manifest skillDomains is empty', checkedAt, manifestPath, manifest };
  }
  if (manifest.entrypoint.type === 'workspace-task' && manifest.entrypoint.path) {
    const path = resolve(dirname(manifestPath), manifest.entrypoint.path);
    if (!await fileExists(path)) {
      return { id: manifest.id, kind: manifest.kind, available: false, reason: `Entrypoint not found: ${path}`, checkedAt, manifestPath, manifest };
    }
  }
  if (manifest.entrypoint.type === 'markdown-skill' && manifest.entrypoint.path && !await fileExists(manifest.entrypoint.path)) {
    return { id: manifest.id, kind: manifest.kind, available: false, reason: `Markdown skill not found: ${manifest.entrypoint.path}`, checkedAt, manifestPath, manifest };
  }
  return { id: manifest.id, kind: manifest.kind, available: true, reason: 'Manifest validation passed', checkedAt, manifestPath, manifest };
}

async function persistWorkspaceSkillStatus(workspace: string, skills: SkillAvailability[]) {
  const statusPath = join(workspace, '.bioagent', 'skills', 'status.json');
  await mkdir(dirname(statusPath), { recursive: true });
  await writeFile(statusPath, JSON.stringify({
    updatedAt: new Date().toISOString(),
    skills: skills.map((skill) => ({
      id: skill.id,
      kind: skill.kind,
      available: skill.available,
      reason: skill.reason,
      checkedAt: skill.checkedAt,
      manifestPath: skill.manifestPath,
    })),
  }, null, 2));
}

function scoreSkill(manifest: SkillManifest, skillDomain: BioAgentSkillDomain, prompt: string) {
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
  if (manifest.kind === 'seed') score += 4;
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
  return kind === 'seed' ? 0 : kind === 'workspace' ? 1 : kind === 'installed' ? 2 : 3;
}

function parseMarkdownFrontmatter(text: string): Record<string, unknown> {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const out: Record<string, unknown> = {};
  const lines = match[1].split(/\r?\n/);
  let inMetadata = false;
  for (const line of lines) {
    const top = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    const nested = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (top) {
      inMetadata = top[1] === 'metadata';
      if (!inMetadata) out[top[1]] = cleanFrontmatterValue(top[2]);
      continue;
    }
    if (inMetadata && nested) out[nested[1]] = cleanFrontmatterValue(nested[2]);
  }
  return out;
}

function cleanFrontmatterValue(value: string) {
  return value.trim().replace(/^["']|["']$/g, '');
}

function firstMarkdownParagraph(text: string) {
  return text
    .replace(/^---\n[\s\S]*?\n---/, '')
    .split(/\n{2,}/)
    .map((part) => part.replace(/^#+\s*/, '').trim())
    .find((part) => part && !part.startsWith('```'));
}

function safeSkillId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'markdown-skill';
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

function inferSkillDomains(text: string): BioAgentSkillDomain[] {
  const lower = text.toLowerCase();
  const domains = new Set<BioAgentSkillDomain>();
  if (/\b(pubmed|literature|paper|web-search|mesh|clinical resource)\b/.test(lower)) domains.add('literature');
  if (/\b(structure|pdb|alphafold|docking|binding site|pocket|esmfold|molecular visualization)\b/.test(lower)) domains.add('structure');
  if (/\b(omics|rna|expression|tcga|biomarker|transcriptomic|metabolomics|epigenetic|gwas)\b/.test(lower)) domains.add('omics');
  if (/\b(gene|protein|sequence|blast|uniprot|chembl|compound|drug|variant|disease|pathway|enzyme|smiles)\b/.test(lower)) domains.add('knowledge');
  if (!domains.size) domains.add('knowledge');
  return Array.from(domains);
}

function examplePromptsForMarkdownSkill(id: string, description: string) {
  const title = id.replace(/[_.-]+/g, ' ');
  const specificTerms = description
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((token) => token.length > 5)
    .slice(0, 5)
    .join(' ');
  return [
    title,
    specificTerms,
    `Use ${title} and return structured BioAgent artifacts`,
  ];
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
