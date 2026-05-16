import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildBuiltInScenarioPackage } from '../../packages/scenarios/core/src/scenarioPackage.js';

const requiredDocs = [
  'docs/README.md',
  'docs/Usage.md',
  'docs/Architecture.md',
  'docs/SciForge-SingleAgent-Architecture.md',
  'docs/AgentHarnessStandard.md',
  'docs/HarnessResearchGuide.md',
  'README.md',
];

for (const path of requiredDocs) {
  const text = await readFile(path, 'utf8');
  assert.ok(text.length > 200, `${path} should not be empty`);
}

const legacyHistoricalDocs = [
  { filename: 'ProjectSessionMemory.md', status: 'archive/historical' },
  { filename: 'Extending.md', status: 'archive/historical' },
  { filename: 'SciForgeConversationSessionRecovery.md', status: 'archive/historical' },
] as const;

for (const doc of legacyHistoricalDocs) {
  await assertMissing(`docs/${doc.filename}`);
}
await assertLegacyDocReferencesAreHistorical(
  [...(await collectMarkdownFiles('docs')), 'tests/smoke/smoke-docs-scenario-package.ts'],
  legacyHistoricalDocs,
);
await assertMarkdownLinksResolve(await collectMarkdownFiles('docs'));

const docsIndex = await readFile('docs/README.md', 'utf8');
assert.match(docsIndex, /\[`Usage\.md`\]\(Usage\.md\)/);
assert.match(docsIndex, /\[`Architecture\.md`\]\(Architecture\.md\)/);
assert.match(docsIndex, /\[`SciForge-SingleAgent-Architecture\.md`\]\(SciForge-SingleAgent-Architecture\.md\)/);
assert.match(docsIndex, /\[`AgentHarnessStandard\.md`\]\(AgentHarnessStandard\.md\)/);
assert.match(docsIndex, /\[`HarnessResearchGuide\.md`\]\(HarnessResearchGuide\.md\)/);

const usageText = await readFile('docs/Usage.md', 'utf8');
assert.match(usageText, /npm run dev/);
const architectureText = await readFile('docs/Architecture.md', 'utf8');
assert.match(architectureText, /\/api\/agent-server\/runs\/stream/);
const singleAgentText = await readFile('docs/SciForge-SingleAgent-Architecture.md', 'utf8');
assert.match(singleAgentText, /Scenario package 只能是 policy/);
assert.match(singleAgentText, /Core Conformance Suite/);

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-docs-scenario-'));
const scenarioPackage = buildBuiltInScenarioPackage('literature-evidence-review', '2026-05-08T00:00:00.000Z');
const scenarioDir = join(workspace, '.sciforge', 'scenarios', scenarioPackage.id);
await mkdir(scenarioDir, { recursive: true });
await writeFile(join(scenarioDir, 'package.json'), JSON.stringify(scenarioPackage, null, 2));

const port = 20080 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, ['--import', 'tsx', 'src/runtime/workspace-server.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SCIFORGE_WORKSPACE_PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await waitForHealth(port);
  const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/scenarios/get?workspacePath=${encodeURIComponent(workspace)}&id=${scenarioPackage.id}`);
  const text = await response.text();
  assert.equal(response.status, 200, text);
  const json = JSON.parse(text) as { package: { id: string; scenario?: { skillDomain?: string } } };
  assert.equal(json.package.id, scenarioPackage.id);
  assert.equal(json.package.scenario?.skillDomain, 'literature');
  console.log('[ok] consolidated docs and scenario package contract are readable');
} finally {
  child.kill('SIGTERM');
}

async function waitForHealth(portNumber: number) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${portNumber}/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`workspace server did not start on ${portNumber}`);
}

async function assertMissing(path: string) {
  try {
    await access(path);
  } catch {
    return;
  }
  assert.fail(`${path} should remain removed; reference it only as archive/historical status`);
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return collectMarkdownFiles(path);
      return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
    }),
  );
  return files.flat().sort();
}

async function assertLegacyDocReferencesAreHistorical(
  paths: string[],
  legacyDocs: readonly { filename: string; status: 'archive/historical' }[],
) {
  const invalidReferences: string[] = [];
  for (const path of paths) {
    const text = await readFile(path, 'utf8');
    text.split(/\r?\n/).forEach((line, index) => {
      for (const doc of legacyDocs) {
        if (!line.includes(doc.filename)) continue;
        if (line.toLowerCase().includes(doc.status)) continue;
        invalidReferences.push(`${path}:${index + 1}: ${doc.filename}`);
      }
    });
  }
  assert.deepEqual(
    invalidReferences,
    [],
    `legacy doc references must be archive/historical, not authoritative entries: ${invalidReferences.join(', ')}`,
  );
}

async function assertMarkdownLinksResolve(paths: string[]) {
  const brokenLinks: string[] = [];
  for (const path of paths) {
    const text = await readFile(path, 'utf8');
    for (const { target, lineNumber } of markdownLinks(text)) {
      if (shouldSkipMarkdownTarget(target)) continue;
      const targetWithoutAnchor = target.split('#')[0];
      if (!targetWithoutAnchor) continue;
      const resolvedPath = join(dirname(path), decodeMarkdownTarget(targetWithoutAnchor));
      try {
        await access(resolvedPath);
      } catch {
        brokenLinks.push(`${path}:${lineNumber}: ${target}`);
      }
    }
  }
  assert.deepEqual(brokenLinks, [], `docs markdown links should resolve: ${brokenLinks.join(', ')}`);
}

function markdownLinks(text: string) {
  const links: { target: string; lineNumber: number }[] = [];
  const linkPattern = /!?\[[^\]]*]\(([^)]+)\)/g;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    for (const match of line.matchAll(linkPattern)) {
      links.push({ target: match[1].trim(), lineNumber: index + 1 });
    }
  }
  return links;
}

function shouldSkipMarkdownTarget(target: string) {
  return /^(?:[a-z]+:|#)/i.test(target);
}

function decodeMarkdownTarget(target: string) {
  const unwrapped = target.replace(/^<|>$/g, '');
  try {
    return decodeURI(unwrapped);
  } catch {
    return unwrapped;
  }
}
