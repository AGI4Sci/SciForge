import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import type { SciForgeSkillDomain, SkillManifest } from './runtime-types.js';
import { fileExists } from './workspace-task-runner.js';

export interface MarkdownSkillPackage {
  id: string;
  packageName: string;
  kind: 'skill';
  version: string;
  label: string;
  description: string;
  source: 'package';
  skillDomains: SciForgeSkillDomain[];
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
  toolType: 'database' | 'runner' | 'connector' | 'llm-backend' | 'visual-runtime' | 'sense-plugin';
  skillDomains: SciForgeSkillDomain[];
  producesArtifactTypes?: string[];
  requiredConfig?: string[];
  docs: { readmePath: string; agentSummary: string };
  packageRoot: string;
  tags: string[];
  provider?: string;
  sourceUrl?: string;
  mcpCommand?: string;
  mcpArgs?: string[];
  sensePlugin?: {
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
  };
}

export async function discoverMarkdownSkillPackages(root = resolve(process.cwd(), 'packages', 'skills')): Promise<MarkdownSkillPackage[]> {
  const paths = await markdownPackageFiles(root);
  const packages = await Promise.all(paths.map((path) => readMarkdownSkillPackage(root, path)));
  return packages.sort((left, right) => left.id.localeCompare(right.id));
}

export async function discoverMarkdownToolPackages(root = resolve(process.cwd(), 'packages', 'tools')): Promise<MarkdownToolPackage[]> {
  const paths = await markdownPackageFiles(root);
  const packages = await Promise.all(paths.map((path) => readMarkdownToolPackage(root, path)));
  return packages.sort((left, right) => left.id.localeCompare(right.id));
}

export function markdownSkillPackageToRuntimeManifest(packageManifest: MarkdownSkillPackage): SkillManifest {
  const outputTypes = packageManifest.outputArtifactTypes.length ? packageManifest.outputArtifactTypes : ['runtime-artifact'];
  return {
    id: packageManifest.id,
    kind: 'package',
    description: packageManifest.description,
    skillDomains: packageManifest.skillDomains,
    inputContract: packageManifest.inputContract,
    outputArtifactSchema: {
      type: outputTypes[0],
      allTypes: outputTypes,
      sourceSkillPackage: packageManifest.packageName,
    },
    entrypoint: {
      type: 'markdown-skill',
      path: packageManifest.docs.readmePath,
    },
    environment: {
      packageName: packageManifest.packageName,
      packageRoot: packageManifest.packageRoot,
      source: packageManifest.source,
      requiredCapabilities: packageManifest.requiredCapabilities,
      scpToolId: packageManifest.scpToolId,
      scpHubUrl: packageManifest.scpHubUrl,
    },
    validationSmoke: {
      mode: 'skill-markdown',
      failureModes: packageManifest.failureModes,
    },
    examplePrompts: packageManifest.examplePrompts,
    promotionHistory: [],
    scopeDeclaration: {
      source: 'packages/skills/SKILL.md',
      packageName: packageManifest.packageName,
      packageRoot: packageManifest.packageRoot,
      readmePath: packageManifest.docs.readmePath,
    },
  };
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
  const skillDomains = inferSkillDomains(`${id} ${description} ${text.slice(0, 5000)}`);
  const explicitOutputArtifactTypes = frontmatterList(frontmatter.outputArtifactTypes);
  const outputArtifactTypes = explicitOutputArtifactTypes.length ? explicitOutputArtifactTypes : inferOutputArtifactTypes(`${id} ${description} ${text.slice(0, 8000)}`);
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
    kind: 'skill',
    version: '1.0.0',
    label: rawName,
    description,
    source: 'package',
    skillDomains,
    inputContract,
    outputArtifactTypes,
    entrypointType: 'markdown-skill',
    requiredCapabilities: [
      ...extraRequiredCapabilities.map((capability) => ({ capability, level: 'external-tool' as const })),
      { capability: 'agentserver-generation', level: 'self-healing' },
      { capability: 'artifact-emission', level: 'schema-checked' },
    ],
    failureModes: ['backend-unavailable', 'missing-input', 'schema-mismatch'],
    examplePrompts: examplePromptsForMarkdownSkill(safeName, description),
    docs: {
      readmePath,
      agentSummary: description,
    },
    packageRoot,
    tags: unique(['package', provider, ...skillDomains, ...frontmatterList(frontmatter.tags)]),
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
  const explicitSkillDomains = frontmatterList(frontmatter.skillDomains).filter(isSkillDomain);
  const skillDomains = explicitSkillDomains.length ? explicitSkillDomains : inferSkillDomains(`${id} ${description} ${text.slice(0, 5000)}`);
  const explicitOutputArtifactTypes = frontmatterList(frontmatter.producesArtifactTypes);
  const outputArtifactTypes = explicitOutputArtifactTypes.length
    ? explicitOutputArtifactTypes
    : inferOutputArtifactTypes(`${id} ${description} ${text.slice(0, 8000)}`).filter((type) => type !== 'runtime-artifact');
  const mcpArgs = frontmatterList(frontmatter.mcpArgs);
  return {
    id,
    packageName: `@sciforge-tool/${safeName}`,
    kind: 'tool',
    version: '1.0.0',
    label: rawName,
    description,
    source: 'package',
    toolType: inferToolType(`${id} ${description} ${text.slice(0, 5000)}`, frontmatter.toolType),
    skillDomains,
    producesArtifactTypes: outputArtifactTypes.length ? outputArtifactTypes : undefined,
    requiredConfig: frontmatterList(frontmatter.requiredConfig),
    docs: {
      readmePath,
      agentSummary: description,
    },
    packageRoot,
    tags: unique(['package', provider, ...skillDomains, ...frontmatterList(frontmatter.tags)]),
    provider: provider || undefined,
    sourceUrl: typeof frontmatter.sourceUrl === 'string' ? frontmatter.sourceUrl : undefined,
    mcpCommand: typeof frontmatter.mcpCommand === 'string' ? frontmatter.mcpCommand : undefined,
    mcpArgs: mcpArgs.length ? mcpArgs : undefined,
    sensePlugin: buildSensePluginManifest(safeName, frontmatter),
  };
}

function buildSensePluginManifest(safeName: string, frontmatter: Record<string, unknown>): MarkdownToolPackage['sensePlugin'] | undefined {
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
      formats: ['text/plain', 'application/json', 'application/x-ndjson'],
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

function inferSkillDomains(text: string): SciForgeSkillDomain[] {
  const lower = text.toLowerCase();
  const domains = new Set<SciForgeSkillDomain>();
  if (/\b(pubmed|literature|paper|web-search|mesh|clinical resource|pdf|document)\b/.test(lower)) domains.add('literature');
  if (/\b(structure|pdb|alphafold|docking|binding site|pocket|esmfold|molecular visualization)\b/.test(lower)) domains.add('structure');
  if (/\b(omics|rna|expression|tcga|biomarker|transcriptomic|metabolomics|epigenetic|gwas|single-cell)\b/.test(lower)) domains.add('omics');
  if (/\b(gene|protein|sequence|blast|uniprot|chembl|compound|drug|variant|disease|pathway|enzyme|smiles|pdf)\b/.test(lower)) domains.add('knowledge');
  if (!domains.size) domains.add('knowledge');
  return Array.from(domains);
}

function isSkillDomain(value: string): value is SciForgeSkillDomain {
  return value === 'literature' || value === 'structure' || value === 'omics' || value === 'knowledge';
}

function inferOutputArtifactTypes(text: string) {
  const lower = text.toLowerCase();
  const types = new Set<string>();
  if (/\bpaper|pubmed|literature\b/.test(lower)) types.add('paper-list');
  if (/\bevidence|claim\b/.test(lower)) types.add('evidence-matrix');
  if (/\breport|summary|markdown|pdf|document\b/.test(lower)) types.add('research-report');
  if (/\btable|csv|tsv|spreadsheet\b/.test(lower)) types.add('data-table');
  if (/\bprotein|sequence|blast|alignment\b/.test(lower)) types.add('sequence-alignment');
  if (/\bstructure|pdb|docking|molecule|smiles\b/.test(lower)) types.add('structure-summary');
  if (/\bomics|expression|tcga|biomarker|single-cell\b/.test(lower)) types.add('omics-differential-expression');
  if (/\bgene|drug|compound|disease|pathway|knowledge graph\b/.test(lower)) types.add('knowledge-graph');
  if (!types.size) types.add('runtime-artifact');
  return Array.from(types);
}

function inferToolType(text: string, explicit: unknown): MarkdownToolPackage['toolType'] {
  if (explicit === 'database' || explicit === 'runner' || explicit === 'connector' || explicit === 'llm-backend' || explicit === 'visual-runtime' || explicit === 'sense-plugin') return explicit;
  const lower = text.toLowerCase();
  if (/\b(database|pubmed|chembl|uniprot|kegg|ncbi|api)\b/.test(lower)) return 'database';
  if (/\b(browser|playwright|mcp|connector|web automation)\b/.test(lower)) return 'connector';
  if (/\b(model|llm|agentserver|openai|anthropic)\b/.test(lower)) return 'llm-backend';
  if (/\b(sense|modality|screenshot|computer use|computer-use|vision)\b/.test(lower)) return 'sense-plugin';
  if (/\b(viewer|visual|render|plot|chart)\b/.test(lower)) return 'visual-runtime';
  return 'runner';
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
