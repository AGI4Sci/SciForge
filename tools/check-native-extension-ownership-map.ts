import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

type OwnershipMap = {
  schemaVersion?: string;
  principles?: {
    guiCapabilityCommands?: unknown;
    guiRankingAllowed?: unknown;
    runtimeRankingAllowed?: unknown;
    rawRuntimeOutputPlacement?: unknown;
    runtimeOpenAiFallback?: unknown;
  };
  entries?: OwnershipEntry[];
};

type OwnershipEntry = {
  id?: string;
  status?: string;
  owner?: string;
  targetNativeSurfaces?: unknown;
  currentImplementationPaths?: unknown;
  targetImplementationPaths?: unknown;
  enforcementScripts?: unknown;
  allowedGuiCommandVerbs?: unknown;
  forbiddenOwners?: unknown;
  migrationNote?: unknown;
};

const root = process.cwd();
const allowedCapabilityVerbs = ['search', 'expand', 'plan', 'explain'];
const requiredEntries = [
  'capability-discovery',
  'harness-policy-budget-repair',
  'provider-route',
  'verifier',
  'skill-promotion',
  'computer-use',
  'dual-instance-self-repair',
];
const ignoredDirs = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-ui',
  'build',
  'coverage',
  'docs_old',
  'archive',
  '.codex-runtime',
  '.sciforge',
  '.tmp',
  'workspace',
]);
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.md', '.json']);

async function main() {
  const manifestPath = join(root, 'docs/native-extension-ownership-map.json');
  const manifestText = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText) as OwnershipMap;

  assert.equal(manifest.schemaVersion, 'sciforge.native-extension-ownership-map.v1');
  assert.deepEqual(manifest.principles?.guiCapabilityCommands, allowedCapabilityVerbs);
  assert.equal(manifest.principles?.guiRankingAllowed, false);
  assert.equal(manifest.principles?.runtimeRankingAllowed, false);
  assert.equal(manifest.principles?.rawRuntimeOutputPlacement, 'folded-audit-debug-only');
  assert.equal(manifest.principles?.runtimeOpenAiFallback, 'explicit-opt-in-only');

  assert.ok(Array.isArray(manifest.entries), 'entries must be an array');
  const entriesById = new Map(manifest.entries.map((entry) => [entry.id, entry]));
  for (const id of requiredEntries) assert.ok(entriesById.has(id), `missing ownership entry ${id}`);
  for (const entry of manifest.entries) {
    assertNonEmptyStringArray(entry.currentImplementationPaths, `${entry.id}.currentImplementationPaths`);
    assertNonEmptyStringArray(entry.targetImplementationPaths, `${entry.id}.targetImplementationPaths`);
    assertNonEmptyStringArray(entry.enforcementScripts, `${entry.id}.enforcementScripts`);
  }

  const discovery = entriesById.get('capability-discovery');
  assert.deepEqual(discovery?.allowedGuiCommandVerbs, allowedCapabilityVerbs);
  assert.match(String(discovery?.owner), /codex-native/i);
  assert.match(JSON.stringify(discovery?.forbiddenOwners), /React\/UI ranking/);
  assert.match(JSON.stringify(discovery?.forbiddenOwners), /runtime gateway ranking/);

  const harness = entriesById.get('harness-policy-budget-repair');
  assert.equal(harness?.owner, 'codex-tui-native-extension');
  assert.match(String(harness?.migrationNote), /TUI-native decisions/);

  const providerRoute = entriesById.get('provider-route');
  assert.match(JSON.stringify(providerRoute), /silent OpenAI fallback/);
  assert.match(String(providerRoute?.migrationNote), /fail closed/);

  const computerUse = entriesById.get('computer-use');
  assert.equal(computerUse?.owner, 'sense-plugin-plus-upstream-desktop-bridge');
  assert.match(JSON.stringify(computerUse), /packages\/observe\/vision/);
  assert.match(JSON.stringify(computerUse), /packages\/actions\/computer-use/);
  assert.match(JSON.stringify(computerUse), /React\/UI Computer Use executor/);

  const dualRepair = entriesById.get('dual-instance-self-repair');
  assert.ok(
    dualRepair?.status === 'retired-for-default-runtime' || String(dualRepair?.owner).includes('codex'),
    'dual-instance repair must be Codex-native or explicitly retired',
  );

  const invalidCapabilityCommands = await findInvalidCapabilityCommands();
  assert.deepEqual(invalidCapabilityCommands, [], 'only /capabilities search|expand|plan|explain are allowed outside archives');

  console.log(`[ok] native extension ownership map checked: ${requiredEntries.length} entries, ${allowedCapabilityVerbs.length} capability command verbs.`);
}

function assertNonEmptyStringArray(value: unknown, label: string) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  assert.ok(value.length > 0, `${label} must not be empty`);
  for (const item of value) assert.equal(typeof item, 'string', `${label} entries must be strings`);
}

async function findInvalidCapabilityCommands() {
  const files = await collectFiles(root);
  const findings: string[] = [];
  for (const file of files) {
    const rel = relative(root, file).replaceAll('\\', '/');
    if (rel === 'docs/native-extension-ownership-map.json') continue;
    const text = await readFile(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      const matches = line.matchAll(/\/capabilities\s+([a-z-]+)/g);
      for (const match of matches) {
        if (!allowedCapabilityVerbs.includes(match[1])) findings.push(`${rel}:${index + 1}:${match[0]}`);
      }
    });
  }
  return findings;
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await collectFiles(full));
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(extname(entry.name))) out.push(full);
  }
  return out;
}

await main();
