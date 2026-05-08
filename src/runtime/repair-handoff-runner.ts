import { spawn } from 'node:child_process';
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

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
  const changedFiles = await changedFilesForWorktree(worktreePath);
  const diff = await diffForWorktree(worktreePath, changedFiles);
  const resultDir = join(targetRepoRoot, '.sciforge', 'repair-results', repairRunId);
  await mkdir(resultDir, { recursive: true });
  const patchPath = join(resultDir, 'repair.patch');
  await writeFile(patchPath, diff || 'Repair handoff completed without a git diff.\n', 'utf8');
  const resultJsonPath = join(resultDir, 'result.json');
  const failedTests = testResults.filter((test) => test.status === 'failed');
  const verdict = agentRun.ok && changedFiles.length > 0 && failedTests.length === 0 ? 'fixed' : 'failed';
  const result: RepairHandoffRunnerResult = {
    schemaVersion: 1,
    id: resultId,
    repairRunId,
    issueId,
    verdict,
    summary: summaryForResult({ agentRun, changedFiles, failedTests }),
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
    evidenceRefs: [patchPath, ...testResults.map((test) => test.outputRef).filter((value): value is string => Boolean(value))],
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
      targetWorkspacePath,
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
        targetWorkspacePath: contract.targetWorkspacePath,
        targetWorkspaceWriterUrl: contract.targetWorkspaceWriterUrl,
        isolatedBranch: options.branch,
      },
    },
    input: {
      text: repairPrompt(contract, options),
      metadata: {
        purpose: 'repair-handoff-runner',
        contract,
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

function repairPrompt(contract: RepairHandoffRunnerContract, options: { issueId: string; repairRunId: string; branch: string; worktreePath: string }) {
  return [
    'SciForge Repair Handoff Runner',
    '',
    'You are executor instance A repairing target instance B.',
    `Target cwd is already the isolated target worktree: ${options.worktreePath}`,
    `Isolated branch: ${options.branch}`,
    'Do not write executor instance state, config, log, or repo paths.',
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

async function changedFilesForWorktree(worktreePath: string) {
  const output = await gitOptional(worktreePath, ['status', '--porcelain', '-uall']);
  return uniqueStrings(output.split(/\r?\n/)
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ''))
    .map((line) => line.includes(' -> ') ? line.split(' -> ').at(-1) || line : line)
    .filter((line) => line && !line.startsWith('.sciforge/')));
}

async function diffForWorktree(worktreePath: string, changedFiles: string[]) {
  if (!changedFiles.length) return '';
  await gitOptional(worktreePath, ['add', '-N', '--', ...changedFiles]);
  return gitOptional(worktreePath, ['diff', '--binary', 'HEAD', '--', ...changedFiles]);
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

function summaryForResult(params: { agentRun: { ok: boolean; error?: string }; changedFiles: string[]; failedTests: RepairHandoffTestResult[] }) {
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

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
