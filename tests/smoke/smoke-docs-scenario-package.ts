import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBuiltInScenarioPackage } from '../../packages/scenario-core/src/scenarioPackage.js';

const requiredDocs = [
  'docs/README.md',
  'docs/Usage.md',
  'docs/Architecture.md',
  'docs/Extending.md',
  'docs/SciForgeConversationSessionRecovery.md',
  'README.md',
];

for (const path of requiredDocs) {
  const text = await readFile(path, 'utf8');
  assert.ok(text.length > 200, `${path} should not be empty`);
}

const docsIndex = await readFile('docs/README.md', 'utf8');
assert.match(docsIndex, /\[`Usage\.md`\]\(Usage\.md\)/);
assert.match(docsIndex, /\[`Architecture\.md`\]\(Architecture\.md\)/);
assert.match(docsIndex, /\[`Extending\.md`\]\(Extending\.md\)/);
assert.match(docsIndex, /\[`SciForgeConversationSessionRecovery\.md`\]\(SciForgeConversationSessionRecovery\.md\)/);

const usageText = await readFile('docs/Usage.md', 'utf8');
assert.match(usageText, /npm run dev/);
const architectureText = await readFile('docs/Architecture.md', 'utf8');
assert.match(architectureText, /\/api\/agent-server\/runs\/stream/);
const extendingText = await readFile('docs/Extending.md', 'utf8');
assert.match(extendingText, /\.sciforge\/scenarios\/<safe-id>/);

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
