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
  remainingMigrationSubtasks?: unknown;
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
  'virtual-app-screen-native-host',
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
  assert.equal(computerUse?.owner, 'codex-tui-native-action-provider');
  assert.match(JSON.stringify(computerUse), /packages\/observe\/vision/);
  assert.match(JSON.stringify(computerUse), /packages\/actions\/computer-use/);
  assert.match(JSON.stringify(computerUse), /React\/UI Computer Use executor/);

  const virtualAppScreenNativeHost = entriesById.get('virtual-app-screen-native-host');
  assert.match(String(virtualAppScreenNativeHost?.owner), /native-host-control-plane/);
  assert.match(JSON.stringify(virtualAppScreenNativeHost?.targetImplementationPaths), /packages\/actions\/computer-use\/virtual-app-screen-host/);
  assert.match(JSON.stringify(virtualAppScreenNativeHost?.targetNativeSurfaces), /host session\/surface\/input\/grant\/evidence refs/);
  assert.match(JSON.stringify(virtualAppScreenNativeHost?.forbiddenOwners), /GUI-owned live surface replacement/);
  assert.match(JSON.stringify(virtualAppScreenNativeHost?.forbiddenOwners), /snapshot\/replay second interactive truth/);
  assert.match(JSON.stringify(virtualAppScreenNativeHost?.forbiddenOwners), /third-party virtual screen UI as product truth/);
  assert.match(String(virtualAppScreenNativeHost?.migrationNote), /host grants/);
  assert.match(String(virtualAppScreenNativeHost?.migrationNote), /host-owned evidence writing/);

  if (computerUse?.status === 'migrating') {
    const remaining = assertMigrationSubtasks(computerUse.remainingMigrationSubtasks, 'computer-use.remainingMigrationSubtasks');
    const requiredMigrationIds = [
      'CU-PKG-01-action-schema',
      'CU-PKG-02-window-target-contract',
      'CU-PKG-03-scheduler-lease-contract',
      'CU-PKG-04-executor-adapter-contract',
      'CU-PKG-05-package-bridge-plan-locate-verify-trace',
      'CU-PKG-06-coordinate-and-focus-policy',
      'CU-PKG-07-stale-policy-wrapper-cleanup',
      'CU-PKG-08-planner-text-policy',
      'CU-PKG-09-capture-observation-visible-text',
      'CU-PKG-10-independent-simulated-input-adapter',
    ];
    const remainingIds = new Set(remaining.map((entry) => entry.id));
    for (const id of requiredMigrationIds) assert.ok(remainingIds.has(id), `missing Computer Use migration subtask ${id}`);
  }

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

function assertMigrationSubtasks(value: unknown, label: string): Array<{ id: string }> {
  assert.ok(Array.isArray(value), `${label} must be an array while status=migrating`);
  assert.ok(value.length > 0, `${label} must not be empty while status=migrating`);
  return value.map((entry, index) => {
    assert.ok(entry && typeof entry === 'object' && !Array.isArray(entry), `${label}[${index}] must be an object`);
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== 'string') throw new Error(`${label}[${index}].id must be a string`);
    assert.equal(typeof record.currentPath, 'string', `${label}[${index}].currentPath must be a string`);
    assert.equal(typeof record.targetOwner, 'string', `${label}[${index}].targetOwner must be a string`);
    assert.equal(typeof record.runtimeBoundary, 'string', `${label}[${index}].runtimeBoundary must be a string`);
    return { id: record.id };
  });
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
