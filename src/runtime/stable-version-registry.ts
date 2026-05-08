import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type StableVersionTestStatus = 'passed' | 'failed' | 'skipped' | 'unknown';

export interface StableVersionTestEvidence {
  name?: string;
  command?: string;
  status: StableVersionTestStatus;
  summary?: string;
  outputRef?: string;
  completedAt?: string;
}

export interface StableVersionRecord {
  schemaVersion: 1;
  instanceId: string;
  role: string;
  repoRoot: string;
  branch?: string;
  commit?: string;
  versionLabel: string;
  promotedAt: string;
  tests: StableVersionTestEvidence[];
  promotedBy: string;
  sourceInstance?: string;
  syncState: {
    status: 'local-stable' | 'promoted-from-source' | 'pending-sync' | 'synced' | 'rolled-back';
    sourceCommit?: string;
    targetCommit?: string;
    planId?: string;
    notes?: string[];
  };
}

export interface StableVersionEnvironment {
  instanceId: string;
  role: string;
  stateDir: string;
  repoRoot: string;
  branch?: string;
  commit?: string;
}

export interface StableVersionSyncPlan {
  schemaVersion: 1;
  planId: string;
  generatedAt: string;
  source: {
    instanceId?: string;
    role?: string;
    repoRoot?: string;
    branch?: string;
    commit?: string;
    versionLabel?: string;
  };
  target: {
    instanceId: string;
    role: string;
    repoRoot: string;
    branch?: string;
    commit?: string;
  };
  diffSummary: {
    mode: 'git-diff' | 'same-commit' | 'unavailable';
    filesChanged: string[];
    stats?: string;
    reason?: string;
  };
  testRequirements: Array<{
    name: string;
    command?: string;
    required: boolean;
    reason: string;
  }>;
  backupPoint: {
    commit?: string;
    registryPath: string;
    instruction: string;
  };
  rollback: {
    instruction: string;
    prohibitedActions: string[];
  };
  writes: [];
}

export function stableVersionRegistryPath(stateDir: string) {
  return join(stateDir, 'stable-version.json');
}

export async function readStableVersion(stateDir: string): Promise<StableVersionRecord | undefined> {
  const path = stableVersionRegistryPath(stateDir);
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return normalizeStableVersionRecord(parsed);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function promoteStableVersion(
  env: StableVersionEnvironment,
  input: Record<string, unknown>,
): Promise<{ record: StableVersionRecord; path: string }> {
  if (input.confirm !== true && input.userConfirmed !== true) {
    throw new Error('stable version promotion requires explicit user confirmation');
  }
  const tests = normalizeTests(input.tests);
  if (!hasTestEvidence(tests)) {
    throw new Error('stable version promotion requires passed test evidence');
  }
  const versionLabel = stringField(input.versionLabel) || `stable-${new Date().toISOString()}`;
  const promotedBy = stringField(input.promotedBy) || stringField(input.confirmedBy);
  if (!promotedBy) throw new Error('promotedBy is required for stable version promotion');
  const record: StableVersionRecord = {
    schemaVersion: 1,
    instanceId: stringField(input.instanceId) || env.instanceId,
    role: stringField(input.role) || env.role,
    repoRoot: stringField(input.repoRoot) || env.repoRoot,
    branch: stringField(input.branch) || env.branch,
    commit: stringField(input.commit) || env.commit,
    versionLabel,
    promotedAt: stringField(input.promotedAt) || new Date().toISOString(),
    tests,
    promotedBy,
    sourceInstance: stringField(input.sourceInstance),
    syncState: normalizeSyncState(input.syncState, {
      status: stringField(input.sourceInstance) ? 'promoted-from-source' : 'local-stable',
      sourceCommit: stringField(input.sourceCommit),
      targetCommit: stringField(input.targetCommit) || env.commit,
    }),
  };
  const path = stableVersionRegistryPath(env.stateDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(record, null, 2));
  return { record, path };
}

export async function buildStableVersionSyncPlan(
  env: StableVersionEnvironment,
  input: Record<string, unknown>,
): Promise<StableVersionSyncPlan> {
  const sourceRecord = isRecord(input.sourceStableVersion)
    ? normalizeStableVersionRecord(input.sourceStableVersion)
    : undefined;
  const source = sourceRecord ?? normalizePlanSource(input.source);
  if (!source?.commit && !stringField(input.sourceCommit)) {
    throw new Error('source commit is required to build a stable version sync plan');
  }
  const sourceCommit = source?.commit || stringField(input.sourceCommit);
  const targetCommit = stringField(input.targetCommit) || env.commit;
  const diffSummary = await buildDiffSummary(env.repoRoot, sourceCommit, targetCommit);
  const testRequirements = normalizeTestRequirements(input.testRequirements);
  if (testRequirements.length === 0) {
    testRequirements.push(
      {
        name: 'typecheck',
        command: 'npm run typecheck',
        required: true,
        reason: 'Stable sync must keep the TypeScript contract valid before promotion.',
      },
      {
        name: 'focused stable-version tests',
        command: 'npm run smoke:stable-version-registry',
        required: true,
        reason: 'Stable registry and sync-plan boundaries must remain covered.',
      },
    );
  }
  return {
    schemaVersion: 1,
    planId: `stable-sync-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    source: {
      instanceId: source?.instanceId || stringField(input.sourceInstance),
      role: source?.role,
      repoRoot: source?.repoRoot,
      branch: source?.branch,
      commit: sourceCommit,
      versionLabel: source?.versionLabel,
    },
    target: {
      instanceId: env.instanceId,
      role: env.role,
      repoRoot: env.repoRoot,
      branch: env.branch,
      commit: targetCommit,
    },
    diffSummary,
    testRequirements,
    backupPoint: {
      commit: targetCommit,
      registryPath: stableVersionRegistryPath(env.stateDir),
      instruction: 'Record the target commit and existing stable-version.json before applying any manual sync changes.',
    },
    rollback: {
      instruction: 'Revert with a normal reviewable commit or patch that restores the backup point; do not run destructive reset commands.',
      prohibitedActions: ['git reset --hard', 'git checkout -- .', 'writing into a peer instance stateDir'],
    },
    writes: [],
  };
}

function normalizeStableVersionRecord(value: unknown): StableVersionRecord | undefined {
  if (!isRecord(value)) return undefined;
  const tests = normalizeTests(value.tests);
  const instanceId = stringField(value.instanceId);
  const role = stringField(value.role);
  const repoRoot = stringField(value.repoRoot);
  const versionLabel = stringField(value.versionLabel);
  const promotedAt = stringField(value.promotedAt);
  const promotedBy = stringField(value.promotedBy);
  if (!instanceId || !role || !repoRoot || !versionLabel || !promotedAt || !promotedBy) return undefined;
  return {
    schemaVersion: 1,
    instanceId,
    role,
    repoRoot,
    branch: stringField(value.branch),
    commit: stringField(value.commit),
    versionLabel,
    promotedAt,
    tests,
    promotedBy,
    sourceInstance: stringField(value.sourceInstance),
    syncState: normalizeSyncState(value.syncState, { status: 'local-stable' }),
  };
}

function normalizePlanSource(value: unknown) {
  if (!isRecord(value)) return undefined;
  return {
    instanceId: stringField(value.instanceId),
    role: stringField(value.role),
    repoRoot: stringField(value.repoRoot),
    branch: stringField(value.branch),
    commit: stringField(value.commit),
    versionLabel: stringField(value.versionLabel),
  };
}

function normalizeTests(value: unknown): StableVersionTestEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    name: stringField(item.name),
    command: stringField(item.command),
    status: item.status === 'passed' || item.status === 'failed' || item.status === 'skipped' || item.status === 'unknown' ? item.status : 'unknown',
    summary: stringField(item.summary),
    outputRef: stringField(item.outputRef),
    completedAt: stringField(item.completedAt),
  }));
}

function hasTestEvidence(tests: StableVersionTestEvidence[]) {
  return tests.some((test) => test.status === 'passed' && Boolean(test.command || test.name) && Boolean(test.outputRef || test.summary));
}

function normalizeSyncState(value: unknown, fallback: StableVersionRecord['syncState']): StableVersionRecord['syncState'] {
  if (!isRecord(value)) return fallback;
  const status = ['local-stable', 'promoted-from-source', 'pending-sync', 'synced', 'rolled-back'].includes(String(value.status))
    ? value.status as StableVersionRecord['syncState']['status']
    : fallback.status;
  return {
    status,
    sourceCommit: stringField(value.sourceCommit) || fallback.sourceCommit,
    targetCommit: stringField(value.targetCommit) || fallback.targetCommit,
    planId: stringField(value.planId) || fallback.planId,
    notes: Array.isArray(value.notes) ? value.notes.filter((item): item is string => typeof item === 'string') : fallback.notes,
  };
}

function normalizeTestRequirements(value: unknown): StableVersionSyncPlan['testRequirements'] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    name: stringField(item.name) || stringField(item.command) || 'test',
    command: stringField(item.command),
    required: item.required !== false,
    reason: stringField(item.reason) || 'Required before stable promotion.',
  }));
}

async function buildDiffSummary(repoRoot: string, sourceCommit?: string, targetCommit?: string): Promise<StableVersionSyncPlan['diffSummary']> {
  if (!sourceCommit || !targetCommit) return { mode: 'unavailable', filesChanged: [], reason: 'source or target commit is missing' };
  if (sourceCommit === targetCommit) return { mode: 'same-commit', filesChanged: [], stats: 'No diff: source and target commits match.' };
  const [nameStatus, statSummary] = await Promise.all([
    gitOutput(repoRoot, ['diff', '--name-status', `${targetCommit}..${sourceCommit}`]),
    gitOutput(repoRoot, ['diff', '--shortstat', `${targetCommit}..${sourceCommit}`]),
  ]);
  if (!nameStatus && !statSummary) {
    return { mode: 'unavailable', filesChanged: [], reason: 'git diff was unavailable for the supplied commits' };
  }
  return {
    mode: 'git-diff',
    filesChanged: nameStatus.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => line.split(/\s+/).slice(1).join(' ') || line),
    stats: statSummary || undefined,
  };
}

async function gitOutput(cwd: string, args: string[]) {
  const exists = await stat(cwd).then((info) => info.isDirectory(), () => false);
  if (!exists) return '';
  return new Promise<string>((resolveOutput) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    child.on('error', () => resolveOutput(''));
    child.on('close', (code) => resolveOutput(code === 0 ? Buffer.concat(chunks).toString('utf8').trim() : ''));
  });
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
