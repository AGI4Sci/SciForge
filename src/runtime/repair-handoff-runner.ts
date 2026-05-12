import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import {
  buildDirtyWorktreeCollaborationPlan,
  dirtyWorktreePlanAllowsWrite,
  parseGitPorcelainStatus,
  type DirtyWorktreeCollaborationPlan,
  type DirtyWorktreeFileChange,
  type DirtyWorktreePlannedChange,
} from '@sciforge-ui/runtime-contract/dirty-worktree-collaboration';

export interface RepairHandoffInstanceRef {
  id?: string;
  name?: string;
  appUrl?: string;
  workspaceWriterUrl?: string;
  workspacePath?: string;
}

export interface RepairHandoffExpectedTest {
  name?: string;
  command: string;
}

export interface RepairHandoffRunnerContract {
  executorInstance: RepairHandoffInstanceRef;
  targetInstance: RepairHandoffInstanceRef;
  targetWorkspacePath: string;
  targetWorkspaceWriterUrl: string;
  issueBundle: Record<string, unknown>;
  expectedTests: Array<string | RepairHandoffExpectedTest>;
  githubSyncRequired: boolean;
  agentServerBaseUrl?: string;
  repairRunId?: string;
}

export interface RepairHandoffTestResult {
  name?: string;
  command?: string;
  status: 'passed' | 'failed' | 'skipped';
  summary?: string;
  outputRef?: string;
}

export interface RepairHandoffRunnerResult {
  schemaVersion: 1;
  id: string;
  repairRunId: string;
  issueId: string;
  verdict: 'fixed' | 'partially-fixed' | 'wont-fix' | 'needs-follow-up' | 'failed';
  summary: string;
  changedFiles: string[];
  diffRef?: string;
  commit?: string;
  refs: {
    patchRef?: string;
    branch?: string;
    worktreePath?: string;
  };
  testResults: RepairHandoffTestResult[];
  humanVerification: {
    status: 'pending' | 'not-run';
    conclusion: string;
  };
  evidenceRefs: string[];
  executorInstance: RepairHandoffInstanceRef;
  targetInstance: RepairHandoffInstanceRef;
  completedAt: string;
  metadata: Record<string, unknown>;
}

export interface RepairHandoffRunnerEnvironment {
  executorRepoPath: string;
  executorStateDir: string;
  executorLogDir: string;
  executorConfigLocalPath: string;
  defaultAgentServerBaseUrl?: string;
}

interface ProtectedPathSnapshot {
  path: string;
  kind: 'file' | 'directory' | 'missing' | 'unsupported';
  sha256?: string;
  entries?: number;
}

export async function runRepairHandoff(
  contract: RepairHandoffRunnerContract,
  environment: RepairHandoffRunnerEnvironment,
): Promise<RepairHandoffRunnerResult> {
  const targetWorkspacePath = resolveRequiredPath(contract.targetWorkspacePath, 'targetWorkspacePath');
  const targetWorkspaceWriterUrl = cleanUrl(contract.targetWorkspaceWriterUrl);
  if (!targetWorkspaceWriterUrl) throw new Error('targetWorkspaceWriterUrl is required');
  const agentServerBaseUrl = cleanUrl(contract.agentServerBaseUrl || environment.defaultAgentServerBaseUrl || process.env.SCIFORGE_AGENT_SERVER_BASE_URL || process.env.SCIFORGE_AGENT_SERVER_BASEURL || '');
  if (!agentServerBaseUrl) throw new Error('agentServerBaseUrl is required for repair handoff execution');
  await assertRepairHandoffBoundary(targetWorkspacePath, environment);

  const issueId = issueIdFromBundle(contract.issueBundle);
  const repairRunId = safeName(contract.repairRunId || `repair-run-${issueId}-${Date.now()}`);
  const resultId = safeName(`repair-result-${repairRunId}`);
  const targetRepoRoot = await gitRequired(targetWorkspacePath, ['rev-parse', '--show-toplevel']);
  const targetBranch = await gitOptional(targetRepoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const targetDirtyStatus = await gitOptionalRaw(targetRepoRoot, ['status', '--porcelain', '-uall']);
  const userChanges = parseGitPorcelainStatus(targetDirtyStatus, 'user').filter((change) => !isSciforgeInternalPath(change.path));
  const protectedPathSnapshotsBefore = await snapshotProtectedPaths(targetRepoRoot, userChanges);
  const branch = uniqueBranchName(contract.targetInstance, issueId);
  const worktreePath = join(targetRepoRoot, '.sciforge', 'repair-worktrees', repairRunId);
  await mkdir(dirname(worktreePath), { recursive: true });
  await gitRequired(targetRepoRoot, ['worktree', 'add', '-b', branch, worktreePath, 'HEAD']);

  await recordTargetRepairRun(contract, issueId, repairRunId).catch(() => undefined);
  const agentRun = await dispatchAgentServerRepair(contract, {
    agentServerBaseUrl,
    issueId,
    repairRunId,
    branch,
    worktreePath,
  });
  const testResults = await runExpectedTests(worktreePath, contract.expectedTests, repairRunId);
  const plannedChanges = await plannedChangesForWorktree(worktreePath);
  const changedFiles = uniqueStrings(plannedChanges.map((change) => change.path));
  const diff = await diffForWorktree(worktreePath, changedFiles);
  const protectedPathSnapshotsAfter = await snapshotProtectedPaths(targetRepoRoot, userChanges);
  const changedProtectedPaths = changedProtectedSnapshotPaths(protectedPathSnapshotsBefore, protectedPathSnapshotsAfter);
  const dirtyPlan = buildDirtyWorktreeCollaborationPlan({
    planId: `repair-handoff-${repairRunId}`,
    repoRoot: targetRepoRoot,
    currentBranch: targetBranch || undefined,
    baseRef: 'HEAD',
    userChanges,
    plannedChanges,
    commands: contract.expectedTests.map((test) => typeof test === 'string'
      ? { command: test, reason: 'repair handoff expected test' }
      : { command: test.command, reason: test.name || 'repair handoff expected test' }),
    createdAt: new Date().toISOString(),
  });
  const dirtyProtectionBlocked = !dirtyWorktreePlanAllowsWrite(dirtyPlan) || changedProtectedPaths.length > 0;
  const resultDir = join(targetRepoRoot, '.sciforge', 'repair-results', repairRunId);
  await mkdir(resultDir, { recursive: true });
  const patchPath = join(resultDir, 'repair.patch');
  await writeFile(patchPath, diff || 'Repair handoff completed without a git diff.\n', 'utf8');
  const dirtyProtectionPath = join(resultDir, 'dirty-worktree-protection.json');
  await writeFile(dirtyProtectionPath, JSON.stringify({
    schemaVersion: 1,
    status: dirtyProtectionBlocked ? 'blocked' : 'passed',
    plan: dirtyPlan,
    protectedPathSnapshotsBefore,
    protectedPathSnapshotsAfter,
    changedProtectedPaths,
  }, null, 2), 'utf8');
  const resultJsonPath = join(resultDir, 'result.json');
  const failedTests = testResults.filter((test) => test.status === 'failed');
  const dirtyProtectionFailure = dirtyProtectionBlocked ? dirtyProtectionSummary(dirtyPlan, changedProtectedPaths) : undefined;
  const verdict = dirtyProtectionFailure
    ? 'needs-follow-up'
    : agentRun.ok && changedFiles.length > 0 && failedTests.length === 0 ? 'fixed' : 'failed';
  const result: RepairHandoffRunnerResult = {
    schemaVersion: 1,
    id: resultId,
    repairRunId,
    issueId,
    verdict,
    summary: summaryForResult({ agentRun, changedFiles, failedTests, dirtyProtectionFailure }),
    changedFiles,
    diffRef: patchPath,
    refs: {
      patchRef: patchPath,
      branch,
      worktreePath,
    },
    testResults,
    humanVerification: {
      status: 'pending',
      conclusion: 'Awaiting human review of the isolated repair worktree and patch.',
    },
    evidenceRefs: [patchPath, dirtyProtectionPath, ...testResults.map((test) => test.outputRef).filter((value): value is string => Boolean(value))],
    executorInstance: contract.executorInstance,
    targetInstance: {
      ...contract.targetInstance,
      workspaceWriterUrl: contract.targetInstance.workspaceWriterUrl || targetWorkspaceWriterUrl,
      workspacePath: contract.targetInstance.workspacePath || targetWorkspacePath,
    },
    completedAt: new Date().toISOString(),
    metadata: {
      runner: 'repair-handoff-runner',
      agentServerRun: agentRun.run,
      githubSyncRequired: contract.githubSyncRequired,
      isolatedBranch: branch,
      isolatedWorktreePath: worktreePath,
      dirtyWorktreeCollaboration: {
        status: dirtyProtectionBlocked ? 'blocked' : 'passed',
        auditRef: dirtyProtectionPath,
        changedProtectedPaths,
        plan: dirtyPlan,
      },
    },
  };
  await writeFile(resultJsonPath, JSON.stringify(result, null, 2), 'utf8');
  await postTargetRepairResult(contract, issueId, result);
  return result;
}

async function assertRepairHandoffBoundary(targetWorkspacePath: string, environment: RepairHandoffRunnerEnvironment) {
  const target = await existingRealpath(targetWorkspacePath);
  const executorRepo = await existingRealpath(environment.executorRepoPath);
  if (samePath(target, executorRepo)) {
    throw new Error('Repair handoff blocked: targetWorkspacePath cannot equal the executor repo/worktree.');
  }
  if (pathsIntersect(target, executorRepo)) {
    throw new Error('Repair handoff blocked: targetWorkspacePath cannot intersect the executor repo/worktree.');
  }
  const protectedPaths = [
    environment.executorStateDir,
    environment.executorLogDir,
    environment.executorConfigLocalPath,
  ].map((item) => resolve(item));
  for (const protectedPath of protectedPaths) {
    const existing = await existingRealpath(protectedPath).catch(() => resolve(protectedPath));
    if (pathsIntersect(target, existing)) {
      throw new Error(`Repair handoff blocked: targetWorkspacePath intersects executor protected path ${existing}.`);
    }
  }
}

async function dispatchAgentServerRepair(
  contract: RepairHandoffRunnerContract,
  options: { agentServerBaseUrl: string; issueId: string; repairRunId: string; branch: string; worktreePath: string },
): Promise<{ ok: boolean; run?: unknown; error?: string }> {
  const payload = {
    agent: {
      id: contract.executorInstance.id || 'sciforge-repair-handoff-runner',
      name: contract.executorInstance.name || 'SciForge Repair Handoff Runner',
      backend: 'codex',
      workspace: options.worktreePath,
      workingDirectory: options.worktreePath,
      reconcileExisting: true,
      metadata: {
        purpose: 'repair-handoff-runner',
        repairRunId: options.repairRunId,
        issueId: options.issueId,
        isolatedBranch: options.branch,
        targetBoundary: 'isolated-worktree-only',
      },
    },
    input: {
      text: repairPrompt(contract, options),
      metadata: {
        purpose: 'repair-handoff-runner',
        contract: repairAgentMetadataContract(contract, options),
        issueBundle: contract.issueBundle,
        expectedTests: contract.expectedTests,
      },
    },
    runtime: {
      backend: 'codex',
      cwd: options.worktreePath,
      metadata: {
        autoApprove: true,
        sandbox: 'danger-full-access',
        repairHandoff: true,
      },
    },
    metadata: {
      project: 'SciForge',
      source: 'sciforge-workspace-writer',
      purpose: 'repair-handoff-runner',
    },
  };
  try {
    const response = await fetch(`${options.agentServerBaseUrl}/api/agent-server/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await response.json().catch(() => ({})) as Record<string, unknown>;
    const run = readRunFromAgentServerResponse(json);
    const status = isRecord(run) && typeof run.status === 'string' ? run.status : '';
    if (!response.ok || status === 'failed' || status === 'cancelled') {
      return { ok: false, run, error: agentServerError(response.status, json) };
    }
    return { ok: true, run };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function repairAgentMetadataContract(
  contract: RepairHandoffRunnerContract,
  options: { issueId: string; repairRunId: string; branch: string; worktreePath: string },
) {
  return {
    schemaVersion: 1,
    targetBoundary: 'isolated-worktree-only',
    executorInstance: publicInstanceRef(contract.executorInstance),
    targetInstance: publicInstanceRef(contract.targetInstance),
    issueId: options.issueId,
    repairRunId: options.repairRunId,
    isolatedBranch: options.branch,
    isolatedWorktreePath: options.worktreePath,
    issueBundle: redactForAgent(contract.issueBundle),
    expectedTests: contract.expectedTests,
    githubSyncRequired: contract.githubSyncRequired,
  };
}

function repairPrompt(contract: RepairHandoffRunnerContract, options: { issueId: string; repairRunId: string; branch: string; worktreePath: string }) {
  return [
    'SciForge Repair Handoff Runner',
    '',
    'You are executor instance A repairing target instance B.',
    `Target cwd is already the isolated target worktree: ${options.worktreePath}`,
    `Isolated branch: ${options.branch}`,
    'Do not write executor instance state, config, log, or repo paths.',
    'Do not write the original target workspace. Only modify the isolated target worktree cwd above.',
    'Implement the smallest fix for the issue bundle, then leave a normal git diff in the target worktree.',
    '',
    `Issue id: ${options.issueId}`,
    `Repair run id: ${options.repairRunId}`,
    '',
    'Issue bundle:',
    JSON.stringify(redactForAgent(contract.issueBundle), null, 2),
    '',
    'Expected tests:',
    JSON.stringify(contract.expectedTests, null, 2),
  ].join('\n');
}

function publicInstanceRef(instance: RepairHandoffInstanceRef): RepairHandoffInstanceRef {
  return {
    id: instance.id,
    name: instance.name,
    appUrl: instance.appUrl,
  };
}

async function runExpectedTests(worktreePath: string, tests: Array<string | RepairHandoffExpectedTest>, repairRunId: string): Promise<RepairHandoffTestResult[]> {
  if (!tests.length) {
    return [{
      name: 'expected-tests',
      status: 'skipped',
      summary: 'No expectedTests were provided in the repair handoff contract.',
    }];
  }
  const results: RepairHandoffTestResult[] = [];
  const outputDir = join(worktreePath, '.sciforge', 'repair-runs', repairRunId, 'tests');
  await mkdir(outputDir, { recursive: true });
  for (const [index, raw] of tests.entries()) {
    const test = typeof raw === 'string' ? { command: raw } : raw;
    const name = test.name || `test-${index + 1}`;
    const run = await runShell(test.command, worktreePath);
    const outputRef = join(outputDir, `${safeName(name)}.log`);
    await writeFile(outputRef, [
      `$ ${test.command}`,
      '',
      run.stdout,
      run.stderr ? `\n[stderr]\n${run.stderr}` : '',
    ].join('\n'), 'utf8');
    results.push({
      name,
      command: test.command,
      status: run.exitCode === 0 ? 'passed' : 'failed',
      summary: `Exit code ${run.exitCode}.`,
      outputRef,
    });
  }
  return results;
}

async function plannedChangesForWorktree(worktreePath: string): Promise<DirtyWorktreePlannedChange[]> {
  const output = await gitOptionalRaw(worktreePath, ['status', '--porcelain', '-uall']);
  return parseGitPorcelainStatus(output, 'agent')
    .filter((change) => !isSciforgeInternalPath(change.path))
    .map((change) => ({
      ...change,
      action: actionForWorktreeChange(change),
    }));
}

async function diffForWorktree(worktreePath: string, changedFiles: string[]) {
  if (!changedFiles.length) return '';
  await gitOptional(worktreePath, ['add', '-N', '--', ...changedFiles]);
  return gitOptional(worktreePath, ['diff', '--binary', 'HEAD', '--', ...changedFiles]);
}

function actionForWorktreeChange(change: DirtyWorktreeFileChange): DirtyWorktreePlannedChange['action'] {
  if (change.status === 'added' || change.status === 'untracked') return 'add';
  if (change.status === 'deleted') return 'delete';
  if (change.status === 'renamed') return 'rename';
  return 'edit';
}

async function snapshotProtectedPaths(root: string, changes: DirtyWorktreeFileChange[]) {
  const paths = uniqueStrings(changes
    .flatMap((change) => [change.path, change.previousPath].filter((path): path is string => Boolean(path)))
    .filter((path) => !isSciforgeInternalPath(path)));
  const snapshots: ProtectedPathSnapshot[] = [];
  for (const path of paths) snapshots.push(await snapshotProtectedPath(root, path));
  return snapshots;
}

async function snapshotProtectedPath(root: string, repoPath: string): Promise<ProtectedPathSnapshot> {
  const absolutePath = resolve(root, repoPath);
  if (!isInsideOrSame(absolutePath, root)) return { path: repoPath, kind: 'unsupported' };
  try {
    const info = await stat(absolutePath);
    if (info.isDirectory()) {
      const tree = await hashDirectory(absolutePath, repoPath);
      return { path: repoPath, kind: 'directory', sha256: tree.sha256, entries: tree.entries };
    }
    if (info.isFile()) {
      return { path: repoPath, kind: 'file', sha256: sha256(await readFile(absolutePath)), entries: 1 };
    }
    return { path: repoPath, kind: 'unsupported' };
  } catch {
    return { path: repoPath, kind: 'missing' };
  }
}

async function hashDirectory(absolutePath: string, repoPath: string) {
  const files = await collectDirectoryFiles(absolutePath, repoPath);
  const hash = createHash('sha256');
  for (const file of files.sort((left, right) => left.repoPath.localeCompare(right.repoPath))) {
    hash.update(file.repoPath);
    hash.update('\0');
    hash.update(file.sha256);
    hash.update('\0');
  }
  return { sha256: hash.digest('hex'), entries: files.length };
}

async function collectDirectoryFiles(absolutePath: string, repoPath: string): Promise<Array<{ repoPath: string; sha256: string }>> {
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const files: Array<{ repoPath: string; sha256: string }> = [];
  for (const entry of entries) {
    const childRepoPath = `${repoPath.replace(/\/+$/, '')}/${entry.name}`;
    if (entry.name === '.git' || isSciforgeInternalPath(childRepoPath)) continue;
    const childAbsolutePath = join(absolutePath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectDirectoryFiles(childAbsolutePath, childRepoPath));
    } else if (entry.isFile()) {
      files.push({ repoPath: childRepoPath, sha256: sha256(await readFile(childAbsolutePath)) });
    }
  }
  return files;
}

function changedProtectedSnapshotPaths(before: ProtectedPathSnapshot[], after: ProtectedPathSnapshot[]) {
  const afterByPath = new Map(after.map((snapshot) => [snapshot.path, snapshot]));
  return before
    .filter((snapshot) => {
      const next = afterByPath.get(snapshot.path);
      return !next || next.kind !== snapshot.kind || next.sha256 !== snapshot.sha256 || next.entries !== snapshot.entries;
    })
    .map((snapshot) => snapshot.path);
}

function dirtyProtectionSummary(plan: DirtyWorktreeCollaborationPlan, changedProtectedPaths: string[]) {
  if (changedProtectedPaths.length > 0) {
    return `Dirty worktree protection detected original user-owned path changes: ${changedProtectedPaths.join(', ')}.`;
  }
  if (plan.pathConflicts.length > 0) {
    return `Dirty worktree protection blocked repair patch overlap with user-owned paths: ${uniqueStrings(plan.pathConflicts.map((conflict) => conflict.path)).join(', ')}.`;
  }
  if (plan.prohibitedCommands.length > 0) {
    return `Dirty worktree protection blocked unsafe command(s): ${plan.prohibitedCommands.map((decision) => decision.command).join(' ; ')}.`;
  }
  return 'Dirty worktree protection requires human review before applying this repair patch.';
}

async function recordTargetRepairRun(contract: RepairHandoffRunnerContract, issueId: string, repairRunId: string) {
  await fetch(`${cleanUrl(contract.targetWorkspaceWriterUrl)}/api/sciforge/feedback/issues/${encodeURIComponent(issueId)}/repair-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: contract.targetWorkspacePath,
      id: repairRunId,
      externalInstanceId: contract.executorInstance.id,
      externalInstanceName: contract.executorInstance.name,
      actor: 'repair-handoff-runner',
      startedAt: new Date().toISOString(),
      metadata: {
        executorInstance: contract.executorInstance,
        targetInstance: contract.targetInstance,
      },
    }),
  });
}

async function postTargetRepairResult(contract: RepairHandoffRunnerContract, issueId: string, result: RepairHandoffRunnerResult) {
  const response = await fetch(`${cleanUrl(contract.targetWorkspaceWriterUrl)}/api/sciforge/feedback/issues/${encodeURIComponent(issueId)}/repair-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: contract.targetWorkspacePath,
      result,
    }),
  });
  if (!response.ok) throw new Error(`Target repair-result API failed: HTTP ${response.status} ${await response.text().catch(() => '')}`.trim());
}

function summaryForResult(params: { agentRun: { ok: boolean; error?: string }; changedFiles: string[]; failedTests: RepairHandoffTestResult[]; dirtyProtectionFailure?: string }) {
  if (params.dirtyProtectionFailure) return params.dirtyProtectionFailure;
  if (!params.agentRun.ok) return `Repair handoff failed before verification: ${params.agentRun.error || 'AgentServer did not complete successfully.'}`;
  if (!params.changedFiles.length) return 'Repair handoff completed but produced no target worktree changes.';
  if (params.failedTests.length) return `Repair handoff produced changes, but ${params.failedTests.length} expected test(s) failed.`;
  return `Repair handoff completed in the target isolated worktree with ${params.changedFiles.length} changed file(s).`;
}

async function gitRequired(cwd: string, args: string[]) {
  const run = await runCommand('git', args, cwd);
  if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${run.stderr || run.stdout}`);
  return run.stdout.trim();
}

async function gitOptional(cwd: string, args: string[]) {
  const run = await runCommand('git', args, cwd);
  return run.exitCode === 0 ? run.stdout.trim() : '';
}

async function gitOptionalRaw(cwd: string, args: string[]) {
  const run = await runCommand('git', args, cwd);
  return run.exitCode === 0 ? run.stdout : '';
}

async function runShell(command: string, cwd: string) {
  return runCommand(process.platform === 'win32' ? 'cmd.exe' : 'sh', process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command], cwd);
}

async function runCommand(command: string, args: string[], cwd: string) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolveRun) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', (chunk) => stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    child.stderr?.on('data', (chunk) => stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    child.on('error', (err) => resolveRun({ exitCode: 1, stdout: '', stderr: err.message }));
    child.on('close', (code) => resolveRun({
      exitCode: typeof code === 'number' ? code : 1,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

function issueIdFromBundle(issueBundle: Record<string, unknown>) {
  const id = typeof issueBundle.id === 'string' && issueBundle.id.trim() ? issueBundle.id.trim() : '';
  if (!id) throw new Error('issueBundle.id is required');
  return id;
}

function uniqueBranchName(target: RepairHandoffInstanceRef, issueId: string) {
  const targetId = safeName(target.id || target.name || 'target').slice(0, 40);
  const issue = safeName(issueId).slice(0, 40);
  return `codex/repair-handoff/${targetId}/${issue}/${Date.now()}`;
}

function safeName(value: string) {
  return basename(value.replace(/[^a-zA-Z0-9._/-]+/g, '-').replace(/^\/+|\/+$/g, '')).slice(0, 120) || 'repair';
}

function resolveRequiredPath(value: string, label: string) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new Error(`${label} is required`);
  return resolve(trimmed);
}

async function existingRealpath(path: string) {
  await stat(path);
  return normalizePath(await realpath(path));
}

function samePath(left: string, right: string) {
  return normalizePath(left) === normalizePath(right);
}

function pathsIntersect(left: string, right: string) {
  return isInsideOrSame(left, right) || isInsideOrSame(right, left);
}

function isInsideOrSame(candidate: string, parent: string) {
  const rel = relative(normalizePath(parent), normalizePath(candidate));
  return rel === '' || (!rel.startsWith('..') && rel !== '..' && !rel.startsWith(`..${sep}`));
}

function normalizePath(path: string) {
  return resolve(path);
}

function cleanUrl(value: string) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

function readRunFromAgentServerResponse(value: Record<string, unknown>) {
  const data = isRecord(value.data) ? value.data : {};
  if (isRecord(data.run)) return data.run;
  if (isRecord(value.run)) return value.run;
  return undefined;
}

function agentServerError(status: number, value: Record<string, unknown>) {
  const data = isRecord(value.data) ? value.data : {};
  const run = isRecord(data.run) ? data.run : isRecord(value.run) ? value.run : {};
  return String(value.error || data.error || run.error || `AgentServer repair handoff HTTP ${status}`);
}

function redactForAgent(value: unknown): unknown {
  if (!isRecord(value)) {
    if (Array.isArray(value)) return value.map(redactForAgent);
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/api[-_]?key|token|authorization|secret|password|credential/i.test(key)) {
      out[key] = entry ? '[redacted]' : entry;
    } else {
      out[key] = redactForAgent(entry);
    }
  }
  return out;
}

function isSciforgeInternalPath(path: string) {
  return path === '.sciforge' || path.startsWith('.sciforge/');
}

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
