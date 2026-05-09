import { access, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';

import type { SkillDomain } from './matching-policy';

export interface MarkdownSkillPackage {
  id: string;
  packageName: string;
  kind: 'skill';
  version: string;
  label: string;
  description: string;
  source: 'package';
  skillDomains: SkillDomain[];
  inputContract: Record<string, unknown>;
  outputArtifactTypes: string[];
  entrypointType: 'markdown-skill';
  requiredCapabilities: Array<{ capability: string; level: string }>;
  failureModes: string[];
  examplePrompts: string[];
  docs: { readmePath: string; agentSummary: string };
  packageRoot: string;
  tags: string[];
  scpToolId?: string;
  scpHubUrl?: string;
}

export interface MarkdownToolPackage {
  id: string;
  packageName: string;
  kind: 'tool';
  version: string;
  label: string;
  description: string;
  source: 'package';
  toolType: ToolPackageType;
  skillDomains: SkillDomain[];
  producesArtifactTypes?: string[];
  requiredConfig?: string[];
  docs: { readmePath: string; agentSummary: string };
  packageRoot: string;
  tags: string[];
  provider?: string;
  sourceUrl?: string;
  mcpCommand?: string;
  mcpArgs?: string[];
  sensePlugin?: SensePluginManifest;
}

export type ToolPackageType = 'database' | 'runner' | 'connector' | 'llm-backend' | 'visual-runtime' | 'sense-plugin';

export interface SensePluginManifest {
  id: string;
  modality: string;
  inputContract: {
    textField: string;
    modalitiesField: string;
    acceptedModalities: string[];
  };
  outputContract: {
    kind: 'text';
    formats: string[];
    commandSchema?: Record<string, unknown>;
  };
  executionBoundary: 'text-signal-only' | 'direct-executor' | 'hybrid';
  safety: {
    defaultRiskLevel: 'low' | 'medium' | 'high';
    highRiskPolicy: 'reject' | 'require-confirmation' | 'allow';
  };
}

const packageSource = 'package';
const skillKind = 'skill';
const toolKind = 'tool';
const markdownSkillEntrypoint = 'markdown-skill';
const markdownSkillSmokeMode = 'skill-markdown';
const defaultRuntimeArtifactType = 'runtime-artifact';
const defaultFailureModes = ['backend-unavailable', 'missing-input', 'schema-mismatch'];
const defaultRequiredCapabilities = [
  { capability: 'agentserver-generation', level: 'self-healing' },
  { capability: 'artifact-emission', level: 'schema-checked' },
];
const senseTextFormats = ['text/plain', 'application/json', 'application/x-ndjson'];
const skillDomains = ['literature', 'structure', 'omics', 'knowledge'] as const satisfies readonly SkillDomain[];
const toolPackageTypes = ['database', 'runner', 'connector', 'llm-backend', 'visual-runtime', 'sense-plugin'] as const satisfies readonly ToolPackageType[];

const domainInferenceRules: Array<{ domain: SkillDomain; pattern: RegExp }> = [
  { domain: 'literature', pattern: /\b(pubmed|literature|paper|web-search|mesh|clinical resource|pdf|document)\b/ },
  { domain: 'structure', pattern: /\b(structure|pdb|alphafold|docking|binding site|pocket|esmfold|molecular visualization)\b/ },
  { domain: 'omics', pattern: /\b(omics|rna|expression|tcga|biomarker|transcriptomic|metabolomics|epigenetic|gwas|single-cell)\b/ },
  { domain: 'knowledge', pattern: /\b(gene|protein|sequence|blast|uniprot|chembl|compound|drug|variant|disease|pathway|enzyme|smiles|pdf)\b/ },
];

const artifactInferenceRules: Array<{ type: string; pattern: RegExp }> = [
  { type: 'paper-list', pattern: /\bpaper|pubmed|literature\b/ },
  { type: 'evidence-matrix', pattern: /\bevidence|claim\b/ },
  { type: 'research-report', pattern: /\breport|summary|markdown|pdf|document\b/ },
  { type: 'data-table', pattern: /\btable|csv|tsv|spreadsheet\b/ },
  { type: 'sequence-alignment', pattern: /\bprotein|sequence|blast|alignment\b/ },
  { type: 'structure-summary', pattern: /\bstructure|pdb|docking|molecule|smiles\b/ },
  { type: 'omics-differential-expression', pattern: /\bomics|expression|tcga|biomarker|single-cell\b/ },
  { type: 'knowledge-graph', pattern: /\bgene|drug|compound|disease|pathway|knowledge graph\b/ },
];

const toolTypeInferenceRules: Array<{ type: ToolPackageType; pattern: RegExp }> = [
  { type: 'database', pattern: /\b(database|pubmed|chembl|uniprot|kegg|ncbi|api)\b/ },
  { type: 'connector', pattern: /\b(browser|playwright|mcp|connector|web automation)\b/ },
  { type: 'llm-backend', pattern: /\b(model|llm|agentserver|openai|anthropic)\b/ },
  { type: 'sense-plugin', pattern: /\b(sense|modality|screenshot|computer use|computer-use|vision)\b/ },
  { type: 'visual-runtime', pattern: /\b(viewer|visual|render|plot|chart)\b/ },
];

export const markdownCatalogRuntimeDefaults = {
  runtimeArtifactTypes: [defaultRuntimeArtifactType],
  validationSmokeMode: markdownSkillSmokeMode,
} as const;

export async function discoverMarkdownSkillPackages(root = resolve(process.cwd(), 'packages', 'skills')): Promise<MarkdownSkillPackage[]> {
  const paths = (await markdownPackageFiles(root))
    .filter((path) => !isPathInside(path, resolve(process.cwd(), 'packages', 'skills', 'tool_skills')));
  const packages = await Promise.all(paths.map((path) => readMarkdownSkillPackage(root, path)));
  return packages.sort((left, right) => left.id.localeCompare(right.id));
}

export async function discoverMarkdownToolPackages(root = resolve(process.cwd(), 'packages', 'skills', 'tool_skills')): Promise<MarkdownToolPackage[]> {
  const paths = await markdownPackageFiles(root);
  const packages = await Promise.all(paths.map((path) => readMarkdownToolPackage(root, path)));
  return packages.sort((left, right) => left.id.localeCompare(right.id));
}

async function markdownPackageFiles(root: string): Promise<string[]> {
  if (!await fileExists(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...await markdownPackageFiles(path));
    if (entry.isFile() && entry.name === 'SKILL.md') files.push(path);
  }
  return files;
}

async function readMarkdownSkillPackage(root: string, path: string): Promise<MarkdownSkillPackage> {
  const text = await readFile(path, 'utf8');
  const frontmatter = parseMarkdownFrontmatter(text);
  const packageRoot = relative(process.cwd(), dirname(path));
  const readmePath = relative(process.cwd(), path);
  const rawName = String(frontmatter.name || firstHeading(text) || basename(dirname(path)));
  const safeName = safeSkillId(rawName);
  const provider = inferProvider(root, path, frontmatter);
  const id = provider === 'scp' ? `scp.${safeName}` : safeName;
  const description = String(frontmatter.description || sectionAfterHeading(text, 'Description') || firstMarkdownParagraph(text) || `Markdown skill ${rawName}.`).trim();
  const inferenceText = `${id} ${description} ${text}`;
  const explicitOutputArtifactTypes = frontmatterList(frontmatter.outputArtifactTypes);
  const extraRequiredCapabilities = frontmatterList(frontmatter.requiredCapabilities);
  const inputContract: Record<string, unknown> = {
    prompt: 'Free-text request matched against this SKILL.md.',
    skillMarkdownRef: readmePath,
  };
  if (typeof frontmatter.visionTaskRequest === 'string' && frontmatter.visionTaskRequest.trim()) {
    inputContract.visionTaskRequest = frontmatter.visionTaskRequest.trim();
  }
  return {
    id,
    packageName: `@sciforge-skill/${safeName}`,
    kind: skillKind,
    version: '1.0.0',
    label: rawName,
    description,
    source: packageSource,
    skillDomains: inferSkillDomains(inferenceText.slice(0, id.length + description.length + 5002)),
    inputContract,
    outputArtifactTypes: explicitOutputArtifactTypes.length ? explicitOutputArtifactTypes : inferOutputArtifactTypes(inferenceText.slice(0, id.length + description.length + 8002)),
    entrypointType: markdownSkillEntrypoint,
    requiredCapabilities: [
      ...extraRequiredCapabilities.map((capability) => ({ capability, level: 'external-tool' })),
      ...defaultRequiredCapabilities,
    ],
    failureModes: [...defaultFailureModes],
    examplePrompts: examplePromptsForMarkdownSkill(safeName, description),
    docs: {
      readmePath,
      agentSummary: description,
    },
    packageRoot,
    tags: unique([packageSource, provider, ...inferSkillDomains(inferenceText.slice(0, id.length + description.length + 5002)), ...frontmatterList(frontmatter.tags)]),
    scpToolId: typeof frontmatter.scpToolId === 'string' ? frontmatter.scpToolId : undefined,
    scpHubUrl: typeof frontmatter.scpHubUrl === 'string' ? frontmatter.scpHubUrl : undefined,
  };
}

async function readMarkdownToolPackage(root: string, path: string): Promise<MarkdownToolPackage> {
  const text = await readFile(path, 'utf8');
  const frontmatter = parseMarkdownFrontmatter(text);
  const packageRoot = typeof frontmatter.packageRoot === 'string' && frontmatter.packageRoot.trim()
    ? frontmatter.packageRoot.trim()
    : relative(process.cwd(), dirname(path));
  const readmePath = relative(process.cwd(), path);
  const rawName = String(frontmatter.name || firstHeading(text) || basename(dirname(path)));
  const safeName = safeSkillId(rawName);
  const provider = inferProvider(root, path, frontmatter);
  const id = provider ? `${provider}.${safeName}` : safeName;
  const description = String(frontmatter.description || sectionAfterHeading(text, 'Description') || firstMarkdownParagraph(text) || `Markdown tool ${rawName}.`).trim();
  const inferenceText = `${id} ${description} ${text}`;
  const explicitSkillDomains = frontmatterList(frontmatter.skillDomains).filter(isSkillDomain);
  const inferredArtifactTypes = inferOutputArtifactTypes(inferenceText.slice(0, id.length + description.length + 8002));
  const explicitOutputArtifactTypes = frontmatterList(frontmatter.producesArtifactTypes);
  const outputArtifactTypes = explicitOutputArtifactTypes.length
    ? explicitOutputArtifactTypes
    : inferredArtifactTypes.filter((type) => type !== defaultRuntimeArtifactType);
  const mcpArgs = frontmatterList(frontmatter.mcpArgs);
  const inferredDomains = explicitSkillDomains.length
    ? explicitSkillDomains
    : inferSkillDomains(inferenceText.slice(0, id.length + description.length + 5002));
  return {
    id,
    packageName: `@sciforge-tool/${safeName}`,
    kind: toolKind,
    version: '1.0.0',
    label: rawName,
    description,
    source: packageSource,
    toolType: inferToolType(inferenceText.slice(0, id.length + description.length + 5002), frontmatter.toolType),
    skillDomains: inferredDomains,
    producesArtifactTypes: outputArtifactTypes.length ? outputArtifactTypes : undefined,
    requiredConfig: frontmatterList(frontmatter.requiredConfig),
    docs: {
      readmePath,
      agentSummary: description,
    },
    packageRoot,
    tags: unique([packageSource, provider, ...inferredDomains, ...frontmatterList(frontmatter.tags)]),
    provider: provider || undefined,
    sourceUrl: typeof frontmatter.sourceUrl === 'string' ? frontmatter.sourceUrl : undefined,
    mcpCommand: typeof frontmatter.mcpCommand === 'string' ? frontmatter.mcpCommand : undefined,
    mcpArgs: mcpArgs.length ? mcpArgs : undefined,
    sensePlugin: buildSensePluginManifest(safeName, frontmatter),
  };
}

function buildSensePluginManifest(safeName: string, frontmatter: Record<string, unknown>): SensePluginManifest | undefined {
  if (frontmatter.toolType !== 'sense-plugin') return undefined;
  const modality = typeof frontmatter.modality === 'string' && frontmatter.modality.trim() ? frontmatter.modality.trim() : safeName.replace(/-sense$/, '');
  const acceptedModalities = frontmatterList(frontmatter.acceptedModalities);
  return {
    id: `sciforge.${safeName}`,
    modality,
    inputContract: {
      textField: 'text',
      modalitiesField: 'modalities',
      acceptedModalities: acceptedModalities.length ? acceptedModalities : modality === 'vision' ? ['screenshot', 'image'] : [modality],
    },
    outputContract: {
      kind: 'text',
      formats: [...senseTextFormats],
    },
    executionBoundary: 'text-signal-only',
    safety: {
      defaultRiskLevel: 'low',
      highRiskPolicy: 'reject',
    },
  };
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
  const clean = value.trim().replace(/^["']|["']$/g, '');
  const list = clean.match(/^\[(.*)\]$/);
  if (list) {
    return list[1].split(',').map((item) => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  return clean;
}

function frontmatterList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
}

function isPathInside(path: string, parent: string) {
  const relativePath = relative(parent, path);
  return relativePath !== '' && !relativePath.startsWith('..') && !relativePath.startsWith('/');
}

function inferProvider(root: string, path: string, frontmatter: Record<string, unknown>) {
  if (path.includes(`${resolve(root, 'installed', 'scp')}/`)) return 'scp';
  if (path.includes(`${resolve(root, 'clawhub')}/`)) return 'clawhub';
  if (typeof frontmatter.provider === 'string') {
    const provider = String(frontmatter.provider).toLowerCase();
    if (provider.includes('scp')) return 'scp';
    if (provider.includes('clawhub')) return 'clawhub';
    return safeSkillId(frontmatter.provider);
  }
  return '';
}

function firstHeading(text: string) {
  return text.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function firstMarkdownParagraph(text: string) {
  return text
    .replace(/^---\n[\s\S]*?\n---/, '')
    .split(/\n{2,}/)
    .map((part) => part.replace(/^#+\s*/, '').trim())
    .find((part) => part && !part.startsWith('```') && !part.startsWith('|'));
}

function sectionAfterHeading(text: string, heading: string) {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$\\n+([\\s\\S]*?)(?=\\n##\\s+|$)`, 'im');
  return text.match(pattern)?.[1]?.trim();
}

function safeSkillId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'markdown-skill';
}

function inferSkillDomains(text: string): SkillDomain[] {
  const lower = text.toLowerCase();
  const domains = new Set<SkillDomain>();
  for (const rule of domainInferenceRules) {
    if (rule.pattern.test(lower)) domains.add(rule.domain);
  }
  if (!domains.size) domains.add('knowledge');
  return Array.from(domains);
}

function isSkillDomain(value: string): value is SkillDomain {
  return skillDomains.includes(value as SkillDomain);
}

function inferOutputArtifactTypes(text: string) {
  const lower = text.toLowerCase();
  const types = new Set<string>();
  for (const rule of artifactInferenceRules) {
    if (rule.pattern.test(lower)) types.add(rule.type);
  }
  if (!types.size) types.add(defaultRuntimeArtifactType);
  return Array.from(types);
}

function inferToolType(text: string, explicit: unknown): ToolPackageType {
  if (toolPackageTypes.includes(explicit as ToolPackageType)) return explicit as ToolPackageType;
  const lower = text.toLowerCase();
  return toolTypeInferenceRules.find((rule) => rule.pattern.test(lower))?.type ?? 'runner';
}

function examplePromptsForMarkdownSkill(id: string, description: string) {
  const title = id.replace(/[_.-]+/g, ' ');
  const specificTerms = description
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((token) => token.length > 5)
    .slice(0, 8)
    .join(' ');
  return unique([title, specificTerms, `Use ${title} and return structured SciForge artifacts`].filter(Boolean));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
