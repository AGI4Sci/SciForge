import { access, readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

type Finding = {
  file: string;
  line: number;
  text: string;
  reason: string;
};

const root = process.cwd();
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'dist-ui', 'build', 'coverage']);

const policySurfaces = [
  'src/runtime/gateway',
  'src/runtime/scenario-policy',
  'src/runtime/skill-registry',
  'src/ui/src',
  'packages/scenarios',
];

const allowedFiles = [
  /^src\/runtime\/generation-gateway\.ts$/,
  /^src\/runtime\/gateway\/.*\.test\.ts$/,
  /^src\/ui\/src\/.*\.test\.tsx?$/,
];

const suspiciousPhraseRules: Array<{ reason: string; pattern: RegExp }> = [
  {
    reason: 'harness policy prose belongs in packages/agent-harness, not gateway/UI/scenario/provider branches',
    pattern: /\b(?:harness|agent harness)\b.*\b(?:must|should|default|prefer|budget|explor|context|tool|skill|progress|verification|repair)\b/i,
  },
  {
    reason: 'exploration/context/tool budget rules must be structured harness contract fields',
    pattern: /\b(?:fresh|continuation|repair|audit)\b.*\b(?:explor|inspect|read old|old attempts|tool calls|context budget|history)\b/i,
  },
  {
    reason: 'skill/tool preference prose must move to harness callbacks or capability manifests',
    pattern: /\b(?:prefer|boost|prioriti[sz]e)\b.*\b(?:skill|tool|capabilit|provider)\b.*\b(?:harness|profile|budget|agent)\b/i,
  },
];

const findings: Finding[] = [];

for (const surface of policySurfaces) {
  for (const file of await collectSourceFilesIfExists(join(root, surface))) {
    const rel = relative(root, file).replaceAll('\\', '/');
    if (allowedFiles.some((pattern) => pattern.test(rel))) continue;
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!isCodeOrStringLine(trimmed)) return;
      for (const rule of suspiciousPhraseRules) {
        if (!rule.pattern.test(trimmed)) continue;
        findings.push({ file: rel, line: index + 1, text: trimmed, reason: rule.reason });
      }
    });
  }
}

if (findings.length) {
  console.error('[no-scattered-harness-policy] scattered harness policy prose found');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} ${finding.reason}`);
    console.error(`  ${finding.text}`);
  }
  console.error('Move new harness behavior policy into packages/agent-harness profiles/callbacks, capability manifests, trusted runtime-policy providers, or harness promptRenderPlanSummary.renderedEntries.');
  process.exitCode = 1;
} else {
  console.log(`[ok] no scattered harness policy prose found across ${policySurfaces.length} policy surfaces.`);
}

async function collectSourceFilesIfExists(dir: string): Promise<string[]> {
  try {
    await access(dir);
  } catch {
    return [];
  }
  return collectSourceFiles(dir);
}

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await collectSourceFiles(full));
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(extname(entry.name))) out.push(full);
  }
  return out;
}

function isCodeOrStringLine(line: string) {
  return line.length > 0
    && !line.startsWith('//')
    && !line.startsWith('*')
    && !line.startsWith('import ')
    && !/\bsciforge\.[\w.-]+\.v\d+\b/.test(line);
}
