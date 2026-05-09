import { access, readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

type Finding = {
  file: string;
  rule: string;
  message: string;
  line?: number;
  path?: string;
  value?: string;
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const root = process.cwd();
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'dist-ui', 'build', 'coverage']);

const metadataNames = new Set([
  'package.json',
  'manifest.json',
  'plugin.json',
]);

const manifestNamePattern = /(?:^|[.-])manifest\.json$/;
const textMetadataNames = new Set([
  'README.md',
  'SKILL.md',
]);

const ownershipPatterns: Array<{ rule: string; message: string; pattern: RegExp }> = [
  {
    rule: 'package-manifest-persistence-ownership',
    message: 'Package manifest must not claim artifact persistence ownership.',
    pattern: /\b(owns?|ownership|source of truth|唯一(?:物理)?真相源|负责|controls?|manages?)\b.{0,80}\b(persistence|persist|artifact store|artifact persistence|retention lifecycle)\b/i,
  },
  {
    rule: 'package-manifest-global-safety-ownership',
    message: 'Package manifest must not claim global safety or permission ownership.',
    pattern: /\b(owns?|ownership|source of truth|唯一(?:物理)?真相源|负责|controls?|manages?)\b.{0,80}\b(global safety|permission|approval policy|risk policy|safety guard|runtime safety)\b/i,
  },
  {
    rule: 'package-manifest-stream-lifecycle-ownership',
    message: 'Package manifest must not claim stream lifecycle ownership.',
    pattern: /\b(owns?|ownership|source of truth|唯一(?:物理)?真相源|负责|controls?|manages?)\b.{0,80}\b(stream lifecycle|runtime stream|background completion|event stream)\b/i,
  },
  {
    rule: 'package-manifest-workspace-ref-resolution-ownership',
    message: 'Package manifest must not claim workspace ref resolution ownership.',
    pattern: /\b(owns?|ownership|source of truth|唯一(?:物理)?真相源|负责|controls?|manages?|resolves?)\b.{0,80}\b(workspace refs?|workspace references?|ref resolution|reference resolution|agentserver:\/\/)\b/i,
  },
  {
    rule: 'package-manifest-runtime-lifecycle-ownership',
    message: 'Package manifest must not claim runtime lifecycle ownership.',
    pattern: /\b(owns?|ownership|source of truth|唯一(?:物理)?真相源|负责|controls?|manages?)\b.{0,80}\b(runtime lifecycle|turn lifecycle|session lifecycle|workspace lifecycle)\b/i,
  },
];

const forbiddenMetadataKeys = [
  /runtimeLifecycleOwner/i,
  /persistenceOwner/i,
  /globalSafetyOwner/i,
  /streamLifecycleOwner/i,
  /workspaceRefResolver/i,
  /workspaceReferenceResolver/i,
];

async function main() {
  const metadataFiles = await collectMetadataFiles(join(root, 'packages'));
  const findings: Finding[] = [];

  for (const file of metadataFiles) {
    const text = await readFile(file, 'utf8');
    const rel = relative(root, file).replaceAll('\\', '/');
    if (textMetadataNames.has(file.split('/').at(-1) ?? '')) {
      findings.push(...scanText(rel, text));
      continue;
    }

    let json: JsonValue;
    try {
      json = JSON.parse(text) as JsonValue;
    } catch (error) {
      findings.push({
        file: rel,
        rule: 'invalid-package-metadata-json',
        message: `Package metadata must be parseable JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    for (const finding of scanJson(rel, json)) findings.push(finding);
  }

  if (findings.length) {
    console.error('[package-runtime-boundary] package runtime ownership claims found');
    for (const finding of findings) {
      console.error(`- ${finding.file}${finding.path ? ` ${finding.path}` : ''}`);
      if (finding.line) console.error(`  line: ${finding.line}`);
      console.error(`  ${finding.rule}: ${finding.message}`);
      if (finding.value) console.error(`  value: ${finding.value}`);
    }
    console.error('Package manifests may declare local capability contracts, schemas, providers, safety gates, and trace shapes, but runtime lifecycle ownership stays in src/.');
    process.exitCode = 1;
    return;
  }

  console.log(`[ok] package runtime boundary checked: ${metadataFiles.length} metadata files.`);
}

function scanText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (isBoundaryDocumentationLine(line)) return;
    for (const rule of ownershipPatterns) {
      if (!rule.pattern.test(line)) continue;
      findings.push({
        file,
        line: index + 1,
        rule: rule.rule,
        message: rule.message,
        value: compact(line),
      });
    }
  });
  return findings;
}

function scanJson(file: string, value: JsonValue, path = '$'): Finding[] {
  const findings: Finding[] = [];

  if (typeof value === 'string') {
    for (const rule of ownershipPatterns) {
      if (!rule.pattern.test(value)) continue;
      findings.push({
        file,
        path,
        rule: rule.rule,
        message: rule.message,
        value: compact(value),
      });
    }
    return findings;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...scanJson(file, entry, `${path}[${index}]`)));
    return findings;
  }

  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (forbiddenMetadataKeys.some((pattern) => pattern.test(key))) {
        findings.push({
          file,
          path: `${path}.${key}`,
          rule: 'package-manifest-runtime-owner-key',
          message: 'Package metadata key claims runtime lifecycle ownership.',
          value: typeof entry === 'string' ? compact(entry) : undefined,
        });
      }
      findings.push(...scanJson(file, entry, `${path}.${key}`));
    }
  }

  return findings;
}

async function collectMetadataFiles(dir: string): Promise<string[]> {
  try {
    await access(dir);
  } catch {
    return [];
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await collectMetadataFiles(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (textMetadataNames.has(entry.name)) {
      out.push(full);
      continue;
    }
    if (extname(entry.name) === '.json' && (metadataNames.has(entry.name) || manifestNamePattern.test(entry.name))) out.push(full);
  }
  return out.sort();
}

function isBoundaryDocumentationLine(line: string) {
  return /must not|不能|禁止|留在 `?src|stays in src|不得/.test(line);
}

function compact(value: string) {
  return value.replace(/\s+/g, ' ').slice(0, 240);
}

await main();
