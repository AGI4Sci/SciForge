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
import { RUNTIME_PROFILE } from '../../packages/backend/src/runtime-home.js';
import { createCodexAppServerRuntimeAdapter } from './codex/codex-runtime-adapter.js';
import type { AgentCliAdapter } from './codex/agent-cli-adapter.js';
import type { NormalizedAgentEvent } from './codex/codex-event-normalizer.js';
import { scrubTerminalMirrorText, TerminalMirrorLog } from './repair-handoff-terminal-mirror.js';
export {
  appendRepairTerminalMirrorEntry,
  parseRepairTerminalMirrorNdjson,
  type RepairTerminalMirrorEntry,
  type RepairTerminalMirrorTail,
} from './repair-handoff-terminal-mirror.js';

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
  executorBackend?: 'agent-server' | 'runtime-codex';
  runtimeProfile?: string;
  allowOpenAiRuntime?: boolean;
  allowExecutorRepoTarget?: boolean;
  initialGuidance?: string;
  allowedWritePaths?: string[];
  forbiddenWritePaths?: string[];
  requestMetadata?: Record<string, unknown>;
  confirmationPolicy?: RepairConfirmationPolicy;
}

export interface RepairConfirmationPolicy {
  commit: 'disabled' | 'requires-user-confirmation';
  push: 'disabled' | 'requires-second-confirmation';
  pr: 'disabled' | 'requires-second-confirmation';
  merge: 'disabled' | 'never';
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
  allowExecutorRepoTarget?: boolean;
  runtimeCodexAdapter?: AgentCliAdapter;
  runtimeCodexEnv?: NodeJS.ProcessEnv;
  runtimeCodexServiceEnv?: NodeJS.ProcessEnv;
}

interface ProtectedPathSnapshot {
  path: string;
  kind: 'file' | 'directory' | 'missing' | 'unsupported';
  sha256?: string;
  entries?: number;
}

interface RepairPreflightContext {
  baseCommit: string;
  targetBranch?: string;
  targetDirtyStatus: string;
  dirtyWorktreeDigest: string;
  protectedPathSnapshotsBefore: ProtectedPathSnapshot[];
  protectedFilesDigest: string;
  feedbackDataDigest: string;
  requestBundleRef: string;
  planRef: string;
  terminalMirrorRef: string;
  requestPlan: Record<string, unknown>;
  confirmationPolicy: RepairConfirmationPolicy;
  protectedScopePaths: string[];
}

interface RepairExecutorRun {
  ok: boolean;
  run?: unknown;
  error?: string;
  mode: 'agent-server' | 'runtime-codex';
  exitCode?: number | null;
}

interface RuntimeCodexPreDispatchBlock {
  missingEnv: string[];
  message: string;
  runtimeApiKeyPresentInServiceEnv: boolean;
  runtimeApiKeyPresentInAdapterEnv: boolean;
  upstreamBaseUrlPresent: boolean;
  upstreamBaseUrlSource: 'service-env' | 'adapter-env-or-config' | 'missing';
  modelRouterEndpointPresent: boolean;
  modelRouterEndpointSource: 'service-env' | 'adapter-env-or-config' | 'missing';
}

export interface RepairHandoffStopResult {
  repairRunId: string;
  status: 'cancel-requested' | 'blocked' | 'not-running';
  stopped: boolean;
  message: string;
  terminalMirrorRef?: string;
  executorMode?: 'agent-server' | 'runtime-codex';
}

interface ActiveRepairHandoffRun {
  repairRunId: string;
  issueId: string;
  executorMode: 'agent-server' | 'runtime-codex';
  terminalMirror: TerminalMirrorLog;
  adapter?: AgentCliAdapter;
  turnId?: string;
  abortController?: AbortController;
  stopRequestedAt?: string;
  stopReason?: string;
}

const activeRepairHandoffRuns = new Map<string, ActiveRepairHandoffRun>();

export async function runRepairHandoff(
  contract: RepairHandoffRunnerContract,
  environment: RepairHandoffRunnerEnvironment,
): Promise<RepairHandoffRunnerResult> {
  const targetWorkspacePath = resolveRequiredPath(contract.targetWorkspacePath, 'targetWorkspacePath');
  const targetWorkspaceWriterUrl = cleanUrl(contract.targetWorkspaceWriterUrl);
  if (!targetWorkspaceWriterUrl) throw new Error('targetWorkspaceWriterUrl is required');
  const executorMode = repairExecutorMode(contract);
  const agentServerBaseUrl = executorMode === 'agent-server'
    ? cleanUrl(contract.agentServerBaseUrl || environment.defaultAgentServerBaseUrl || process.env.SCIFORGE_AGENT_SERVER_BASE_URL || process.env.SCIFORGE_AGENT_SERVER_BASEURL || '')
    : '';
  if (executorMode === 'agent-server' && !agentServerBaseUrl) throw new Error('agentServerBaseUrl is required for repair handoff execution');
  assertNoDestructiveCommands(contract.expectedTests);
  await assertRepairHandoffBoundary(targetWorkspacePath, environment);

  const issueId = issueIdFromBundle(contract.issueBundle);
  const repairRunId = safeName(contract.repairRunId || `repair-run-${issueId}-${Date.now()}`);
  const resultId = safeName(`repair-result-${repairRunId}`);
  const targetRepoRoot = await gitRequired(targetWorkspacePath, ['rev-parse', '--show-toplevel']);
  const targetBranch = await gitOptional(targetRepoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const baseCommit = await gitRequired(targetRepoRoot, ['rev-parse', 'HEAD']);
  const targetDirtyStatus = await gitOptionalRaw(targetRepoRoot, ['status', '--porcelain', '-uall']);
  const userChanges = parseGitPorcelainStatus(targetDirtyStatus, 'user').filter((change) => !isSciforgeInternalPath(change.path));
  const branch = uniqueBranchName(contract.targetInstance, issueId);
  const worktreePath = join(targetRepoRoot, '.sciforge', 'repair-worktrees', repairRunId);
  const resultDir = join(targetRepoRoot, '.sciforge', 'repair-results', repairRunId);
  await mkdir(resultDir, { recursive: true });
  const requestBundlePath = join(resultDir, 'request-bundle.json');
  const planPath = join(resultDir, 'repair-request-plan.json');
  const terminalMirrorPath = join(resultDir, 'terminal-mirror.ndjson');
  const protectedScopePaths = repairProtectedScopePaths(contract);
  const protectedPathSnapshotsBefore = await snapshotPathList(targetRepoRoot, protectedScopePaths);
  const userProtectedPathSnapshotsBefore = await snapshotProtectedPaths(targetRepoRoot, userChanges);
  const confirmationPolicy = normalizeConfirmationPolicy(contract.confirmationPolicy);
  const preflight: RepairPreflightContext = {
    baseCommit,
    targetBranch: targetBranch || undefined,
    targetDirtyStatus,
    dirtyWorktreeDigest: sha256Text(targetDirtyStatus),
    protectedPathSnapshotsBefore,
    protectedFilesDigest: sha256Json(protectedPathSnapshotsBefore),
    feedbackDataDigest: await feedbackDataDigestForRepo(targetRepoRoot),
    requestBundleRef: requestBundlePath,
    planRef: planPath,
    terminalMirrorRef: terminalMirrorPath,
    requestPlan: {},
    confirmationPolicy,
    protectedScopePaths,
  };
  preflight.requestPlan = buildRepairRequestPlan(contract, {
    issueId,
    repairRunId,
    executorMode,
    branch,
    worktreePath,
    resultDir,
    preflight,
  });
  await writeFile(requestBundlePath, JSON.stringify({
    schemaVersion: 1,
    issueId,
    repairRunId,
    issueBundle: redactForAgent(contract.issueBundle),
    expectedTests: contract.expectedTests,
    createdAt: new Date().toISOString(),
  }, null, 2), 'utf8');
  await writeFile(planPath, JSON.stringify(preflight.requestPlan, null, 2), 'utf8');
  const terminalMirror = new TerminalMirrorLog(terminalMirrorPath);
  const activeRepairRun: ActiveRepairHandoffRun = {
    repairRunId,
    issueId,
    executorMode,
    terminalMirror,
  };
  await terminalMirror.append('event', `SciForge repair request ${repairRunId} accepted for ${issueId}.`);
  await terminalMirror.append('event', `Base commit ${baseCommit}; isolated branch ${branch}; default commit/push/PR/merge disabled.`);
  const runtimeCodexPreDispatchBlock = runtimeCodexPreDispatchBlocker(executorMode, environment);
  if (runtimeCodexPreDispatchBlock) {
    await terminalMirror.append('stderr', runtimeCodexPreDispatchBlock.message);
    return persistPreDispatchBlockedRepairResult(contract, {
      issueId,
      repairRunId,
      resultId,
      executorMode,
      branch,
      worktreePath,
      resultDir,
      preflight,
      block: runtimeCodexPreDispatchBlock,
      targetWorkspacePath,
      targetWorkspaceWriterUrl,
    });
  }
  await mkdir(dirname(worktreePath), { recursive: true });
  await gitRequired(targetRepoRoot, ['worktree', 'add', '-b', branch, worktreePath, 'HEAD']);
  await terminalMirror.append('event', `Created isolated worktree ${worktreePath}.`);

  try {
    await recordTargetRepairRun(contract, issueId, repairRunId, preflight, {
      executorMode,
      branch,
      worktreePath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await terminalMirror.append('stderr', `Target writer repair-run sync unavailable; continuing with direct Codex CLI dispatch from executor workspace writer: ${message}`);
  }
  activeRepairHandoffRuns.set(repairRunId, activeRepairRun);
  let agentRun: RepairExecutorRun;
  try {
    agentRun = await dispatchRepairExecutor(contract, environment, {
      agentServerBaseUrl,
      issueId,
      repairRunId,
      branch,
      worktreePath,
      executorMode,
      terminalMirror,
      activeRepairRun,
    });
  } finally {
    activeRepairHandoffRuns.delete(repairRunId);
  }
  await terminalMirror.append(agentRun.ok ? 'event' : 'stderr', agentRun.ok
    ? `${executorMode} repair executor completed.`
    : `${executorMode} repair executor failed: ${agentRun.error || 'unknown error'}`);
  const executorRepairPlan = await auditExecutorRepairPlan(worktreePath, repairRunId);
  await terminalMirror.append(executorRepairPlan.exists ? 'event' : 'stderr', executorRepairPlan.exists
    ? `Executor repair plan found at ${executorRepairPlan.path}.`
    : `Executor repair plan missing at ${executorRepairPlan.path}.`);
  const testResults = await runExpectedTests(worktreePath, contract.expectedTests, repairRunId);
  for (const test of testResults) {
    await terminalMirror.append(test.status === 'failed' ? 'stderr' : 'event', `Test ${test.name || test.command || 'expected-test'} ${test.status}: ${test.summary || ''}`.trim());
  }
  const commitAudit = await auditNoExecutorCommit(worktreePath, baseCommit);
  await terminalMirror.append(commitAudit.created ? 'stderr' : 'event', commitAudit.created
    ? `Executor commit audit failed: HEAD moved from ${baseCommit} to ${commitAudit.headCommit || 'unknown'}.`
    : `Executor commit audit passed: no commit created; HEAD remains ${baseCommit}.`);
  const plannedChanges = await plannedChangesForWorktree(worktreePath);
  const changedFiles = uniqueStrings(plannedChanges.map((change) => change.path));
  const safeMode = repairControlSurfaceSafeMode(changedFiles);
  const diff = await diffForWorktree(worktreePath, changedFiles);
  const protectedPathSnapshotsAfter = await snapshotPathList(targetRepoRoot, protectedScopePaths);
  const changedProtectedPaths = changedProtectedSnapshotPaths(protectedPathSnapshotsBefore, protectedPathSnapshotsAfter);
  const userProtectedPathSnapshotsAfter = await snapshotProtectedPaths(targetRepoRoot, userChanges);
  const changedUserProtectedPaths = changedProtectedSnapshotPaths(userProtectedPathSnapshotsBefore, userProtectedPathSnapshotsAfter);
  const changedForbiddenPaths = changedFiles.filter((path) => pathMatchesAnyScope(path, repairForbiddenScopePaths(contract)));
  const changedOutsideAllowedPaths = changedFiles.filter((path) => !pathAllowedByScope(path, contract.allowedWritePaths));
  const dirtyPlan = buildDirtyWorktreeCollaborationPlan({
    planId: `repair-handoff-${repairRunId}`,
    repoRoot: targetRepoRoot,
    currentBranch: targetBranch || undefined,
    baseRef: baseCommit,
    userChanges,
    plannedChanges,
    commands: contract.expectedTests.map((test) => typeof test === 'string'
      ? { command: test, reason: 'repair handoff expected test' }
      : { command: test.command, reason: test.name || 'repair handoff expected test' }),
    createdAt: new Date().toISOString(),
  });
  const dirtyProtectionBlocked = !dirtyWorktreePlanAllowsWrite(dirtyPlan)
    || changedProtectedPaths.length > 0
    || changedUserProtectedPaths.length > 0
    || changedForbiddenPaths.length > 0
    || changedOutsideAllowedPaths.length > 0
    || !executorRepairPlan.exists
    || commitAudit.created;
  const patchPath = join(resultDir, 'repair.patch');
  await writeFile(patchPath, diff || 'Repair handoff completed without a git diff.\n', 'utf8');
  const dirtyProtectionPath = join(resultDir, 'dirty-worktree-protection.json');
  await writeFile(dirtyProtectionPath, JSON.stringify({
    schemaVersion: 1,
    status: dirtyProtectionBlocked ? 'blocked' : 'passed',
    plan: dirtyPlan,
    baseCommit,
    dirtyWorktreeDigest: preflight.dirtyWorktreeDigest,
    protectedFilesDigest: preflight.protectedFilesDigest,
    feedbackDataDigest: preflight.feedbackDataDigest,
    protectedPathSnapshotsBefore,
    protectedPathSnapshotsAfter,
    changedProtectedPaths,
    userProtectedPathSnapshotsBefore,
    userProtectedPathSnapshotsAfter,
    changedUserProtectedPaths,
    changedForbiddenPaths,
    changedOutsideAllowedPaths,
    allowedWritePaths: normalizePathScopes(contract.allowedWritePaths),
    forbiddenWritePaths: repairForbiddenScopePaths(contract),
    executorRepairPlan,
    commitAudit,
  }, null, 2), 'utf8');
  const resultJsonPath = join(resultDir, 'result.json');
  const failedTests = testResults.filter((test) => test.status === 'failed');
  const dirtyProtectionFailure = dirtyProtectionBlocked
    ? dirtyProtectionSummary(dirtyPlan, {
      changedProtectedPaths,
      changedUserProtectedPaths,
      changedForbiddenPaths,
      changedOutsideAllowedPaths,
      missingRepairPlan: !executorRepairPlan.exists,
      commitCreated: commitAudit.created,
    })
    : undefined;
  const verdict = dirtyProtectionFailure
    ? 'needs-follow-up'
    : agentRun.ok && changedFiles.length > 0 && failedTests.length === 0 ? 'fixed' : 'failed';
  await terminalMirror.append('event', `Repair verdict ${verdict}. Diff ref ${patchPath}.`);
  if (safeMode.active) {
    await terminalMirror.append('stderr', `Safe mode active for repair control surface paths: ${safeMode.matchedPaths.join(', ')}. Terminal mirror remains read-only; commit/push/PR require extra confirmation or an external control surface.`);
  }
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
    evidenceRefs: [
      patchPath,
      dirtyProtectionPath,
      requestBundlePath,
      planPath,
      terminalMirrorPath,
      ...testResults.map((test) => test.outputRef).filter((value): value is string => Boolean(value)),
    ],
    executorInstance: contract.executorInstance,
    targetInstance: {
      ...contract.targetInstance,
      workspaceWriterUrl: contract.targetInstance.workspaceWriterUrl || targetWorkspaceWriterUrl,
      workspacePath: contract.targetInstance.workspacePath || targetWorkspacePath,
    },
    completedAt: new Date().toISOString(),
    metadata: {
      runner: 'repair-handoff-runner',
      executorMode,
      agentServerRun: agentRun.run,
      githubSyncRequired: contract.githubSyncRequired,
      isolatedBranch: branch,
      isolatedWorktreePath: worktreePath,
      baseCommit,
      baseBranch: targetBranch || undefined,
      requestBundleRef: requestBundlePath,
      planRef: planPath,
      terminalMirrorRef: terminalMirrorPath,
      auditBundleRef: dirtyProtectionPath,
      targetWorkspacePath,
      targetWorkspaceWriterUrl,
      targetAppUrl: contract.targetInstance.appUrl,
      confirmationPolicy,
      commitPushMergePolicy: {
        commit: 'disabled-by-default',
        push: 'disabled-by-default',
        pr: 'disabled-by-default',
        merge: 'never',
      },
      guardDigests: {
        dirtyWorktreeDigest: preflight.dirtyWorktreeDigest,
        protectedFilesDigest: preflight.protectedFilesDigest,
        feedbackDataDigest: preflight.feedbackDataDigest,
      },
      safeMode,
      dirtyWorktreeCollaboration: {
        status: dirtyProtectionBlocked ? 'blocked' : 'passed',
        auditRef: dirtyProtectionPath,
        changedProtectedPaths: uniqueStrings([...changedProtectedPaths, ...changedUserProtectedPaths]),
        changedForbiddenPaths,
        changedOutsideAllowedPaths,
        executorRepairPlan,
        commitAudit,
        plan: dirtyPlan,
      },
      requestMetadata: contract.requestMetadata,
    },
  };
  result.metadata.targetResultPersistence = {
    status: 'recorded',
    targetWorkspaceWriterUrl,
  };
  try {
    await postTargetRepairResult(contract, issueId, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await terminalMirror.append('stderr', `Target repair-result sync unavailable; local repair result remains available: ${message}`);
    result.metadata.targetResultPersistence = {
      status: 'failed',
      targetWorkspaceWriterUrl,
      error: scrubTerminalMirrorText(message).slice(0, 500),
    };
  }
  await writeFile(resultJsonPath, JSON.stringify(result, null, 2), 'utf8');
  return result;
}

export async function stopRepairHandoffRun(repairRunId: string, options: { reason?: string; requestedBy?: string } = {}): Promise<RepairHandoffStopResult> {
  const id = safeName(repairRunId);
  const active = activeRepairHandoffRuns.get(id);
  const reason = (options.reason || 'user requested repair stop').trim();
  const requestedBy = (options.requestedBy || 'workspace-writer').trim();
  if (!active) {
    return {
      repairRunId: id,
      status: 'not-running',
      stopped: false,
      message: `Repair stop failed closed: no active repair run ${id} is tracked by this workspace writer.`,
    };
  }
  if (active.stopRequestedAt) {
    return {
      repairRunId: id,
      status: 'cancel-requested',
      stopped: true,
      terminalMirrorRef: active.terminalMirror.path,
      executorMode: active.executorMode,
      message: `Repair stop was already requested at ${active.stopRequestedAt}.`,
    };
  }
  active.stopRequestedAt = new Date().toISOString();
  active.stopReason = reason;
  if (active.executorMode !== 'runtime-codex') {
    const message = `Repair stop requested by ${requestedBy}, but ${active.executorMode} repair has no safe cancel endpoint; failing closed without killing external state. Reason: ${reason}`;
    await active.terminalMirror.append('stderr', message);
    return {
      repairRunId: id,
      status: 'blocked',
      stopped: false,
      terminalMirrorRef: active.terminalMirror.path,
      executorMode: active.executorMode,
      message,
    };
  }
  active.abortController?.abort();
  if (active.adapter && active.turnId) await active.adapter.cancel(active.turnId);
  const message = `Runtime Codex repair stop requested by ${requestedBy}; only the current turn was cancelled. Reason: ${reason}`;
  await active.terminalMirror.append('stderr', message);
  return {
    repairRunId: id,
    status: 'cancel-requested',
    stopped: true,
    terminalMirrorRef: active.terminalMirror.path,
    executorMode: active.executorMode,
    message,
  };
}

function runtimeCodexPreDispatchBlocker(
  executorMode: 'agent-server' | 'runtime-codex',
  environment: RepairHandoffRunnerEnvironment,
): RuntimeCodexPreDispatchBlock | undefined {
  if (executorMode !== 'runtime-codex' || environment.runtimeCodexAdapter) return undefined;
  const serviceEnv = environment.runtimeCodexServiceEnv ?? process.env;
  const adapterEnv = environment.runtimeCodexEnv ?? process.env;
  const runtimeApiKeyPresentInServiceEnv = envHasValue(serviceEnv, 'SCIFORGE_RUNTIME_API_KEY');
  const runtimeApiKeyPresentInAdapterEnv = envHasValue(adapterEnv, 'SCIFORGE_RUNTIME_API_KEY');
  const modelRouterEndpointPresentInServiceEnv = modelRouterEndpointPresent(serviceEnv);
  const modelRouterEndpointPresentInAdapterEnv = modelRouterEndpointPresent(adapterEnv);
  const modelRouterEndpointPresentInEnv = modelRouterEndpointPresentInServiceEnv || modelRouterEndpointPresentInAdapterEnv;
  const missingEnv = [
    ...(runtimeApiKeyPresentInServiceEnv ? [] : ['SCIFORGE_RUNTIME_API_KEY']),
    ...(modelRouterEndpointPresentInServiceEnv ? [] : ['SCIFORGE_MODEL_ROUTER_BASE_URL']),
  ];
  if (missingEnv.length === 0) return undefined;
  const configFallbackNote = !runtimeApiKeyPresentInServiceEnv && runtimeApiKeyPresentInAdapterEnv
    ? ' A Runtime Codex key was present in adapter/config fallback, but repair execution requires SCIFORGE_RUNTIME_API_KEY in the service environment.'
    : '';
  const routerFallbackNote = !modelRouterEndpointPresentInServiceEnv && modelRouterEndpointPresentInAdapterEnv
    ? ' A Model Router endpoint was present in adapter/config fallback, but repair execution requires SCIFORGE_MODEL_ROUTER_BASE_URL, SCIFORGE_MODEL_ROUTER_URL, or SCIFORGE_MODEL_ROUTER_PORT in the service environment.'
    : '';
  return {
    missingEnv,
    runtimeApiKeyPresentInServiceEnv,
    runtimeApiKeyPresentInAdapterEnv,
    upstreamBaseUrlPresent: modelRouterEndpointPresentInEnv,
    upstreamBaseUrlSource: modelRouterEndpointPresentInServiceEnv
      ? 'service-env'
      : modelRouterEndpointPresentInAdapterEnv ? 'adapter-env-or-config' : 'missing',
    modelRouterEndpointPresent: modelRouterEndpointPresentInEnv,
    modelRouterEndpointSource: modelRouterEndpointPresentInServiceEnv
      ? 'service-env'
      : modelRouterEndpointPresentInAdapterEnv ? 'adapter-env-or-config' : 'missing',
    message: `Runtime Codex provider preflight blocked before isolated worktree creation; missing ${missingEnv.join(', ')}.${configFallbackNote}${routerFallbackNote}`,
  };
}

function modelRouterEndpointPresent(env: NodeJS.ProcessEnv): boolean {
  return envHasValue(env, 'SCIFORGE_MODEL_ROUTER_BASE_URL')
    || envHasValue(env, 'SCIFORGE_MODEL_ROUTER_URL')
    || envHasValue(env, 'SCIFORGE_MODEL_ROUTER_PORT');
}

async function persistPreDispatchBlockedRepairResult(
  contract: RepairHandoffRunnerContract,
  input: {
    issueId: string;
    repairRunId: string;
    resultId: string;
    executorMode: 'agent-server' | 'runtime-codex';
    branch: string;
    worktreePath: string;
    resultDir: string;
    preflight: RepairPreflightContext;
    block: RuntimeCodexPreDispatchBlock;
    targetWorkspacePath: string;
    targetWorkspaceWriterUrl: string;
  },
): Promise<RepairHandoffRunnerResult> {
  const blockRef = join(input.resultDir, 'pre-dispatch-provider-preflight.json');
  const resultJsonPath = join(input.resultDir, 'result.json');
  await writeFile(blockRef, JSON.stringify({
    schemaVersion: 1,
    status: 'blocked',
    blockedAt: new Date().toISOString(),
    reason: input.block.message,
    missingEnv: input.block.missingEnv,
    runtimeApiKeyPresentInServiceEnv: input.block.runtimeApiKeyPresentInServiceEnv,
    runtimeApiKeyPresentInAdapterEnv: input.block.runtimeApiKeyPresentInAdapterEnv,
    upstreamBaseUrlPresent: input.block.upstreamBaseUrlPresent,
    upstreamBaseUrlSource: input.block.upstreamBaseUrlSource,
    modelRouterEndpointPresent: input.block.modelRouterEndpointPresent,
    modelRouterEndpointSource: input.block.modelRouterEndpointSource,
    executorMode: input.executorMode,
    noIsolatedWorktreeCreated: true,
    noTargetRepairRunRegistered: true,
    plannedIsolatedBranch: input.branch,
    plannedIsolatedWorktreePath: input.worktreePath,
    terminalMirrorRef: input.preflight.terminalMirrorRef,
  }, null, 2), 'utf8');
  const result: RepairHandoffRunnerResult = {
    schemaVersion: 1,
    id: input.resultId,
    repairRunId: input.repairRunId,
    issueId: input.issueId,
    verdict: 'needs-follow-up',
    summary: input.block.message,
    changedFiles: [],
    refs: {},
    testResults: [{
      name: 'runtime-codex-provider-preflight',
      status: 'skipped',
      summary: 'Runtime Codex provider preflight blocked before isolated worktree creation; no executor dispatch occurred.',
    }],
    humanVerification: {
      status: 'not-run',
      conclusion: 'Repair execution did not start because Runtime Codex provider/service environment is incomplete.',
    },
    evidenceRefs: [
      blockRef,
      input.preflight.requestBundleRef,
      input.preflight.planRef,
      input.preflight.terminalMirrorRef,
    ],
    executorInstance: contract.executorInstance,
    targetInstance: {
      ...contract.targetInstance,
      workspaceWriterUrl: contract.targetInstance.workspaceWriterUrl || input.targetWorkspaceWriterUrl,
      workspacePath: contract.targetInstance.workspacePath || input.targetWorkspacePath,
    },
    completedAt: new Date().toISOString(),
    metadata: {
      runner: 'repair-handoff-runner',
      executorMode: input.executorMode,
      preDispatchBlocked: true,
      providerPreflight: {
        status: 'blocked',
        missingEnv: input.block.missingEnv,
        runtimeApiKeyPresentInServiceEnv: input.block.runtimeApiKeyPresentInServiceEnv,
        runtimeApiKeyPresentInAdapterEnv: input.block.runtimeApiKeyPresentInAdapterEnv,
        upstreamBaseUrlPresent: input.block.upstreamBaseUrlPresent,
        upstreamBaseUrlSource: input.block.upstreamBaseUrlSource,
        modelRouterEndpointPresent: input.block.modelRouterEndpointPresent,
        modelRouterEndpointSource: input.block.modelRouterEndpointSource,
        evidenceRef: blockRef,
      },
      noExecutorDispatch: true,
      noIsolatedWorktreeCreated: true,
      noTargetRepairRunRegistered: true,
      isolatedBranchPlanned: input.branch,
      isolatedWorktreePathPlanned: input.worktreePath,
      baseCommit: input.preflight.baseCommit,
      baseBranch: input.preflight.targetBranch,
      requestBundleRef: input.preflight.requestBundleRef,
      planRef: input.preflight.planRef,
      terminalMirrorRef: input.preflight.terminalMirrorRef,
      targetWorkspacePath: input.targetWorkspacePath,
      targetWorkspaceWriterUrl: input.targetWorkspaceWriterUrl,
      targetAppUrl: contract.targetInstance.appUrl,
      confirmationPolicy: input.preflight.confirmationPolicy,
      guardDigests: {
        dirtyWorktreeDigest: input.preflight.dirtyWorktreeDigest,
        protectedFilesDigest: input.preflight.protectedFilesDigest,
        feedbackDataDigest: input.preflight.feedbackDataDigest,
      },
      requestMetadata: contract.requestMetadata,
    },
  };
  result.metadata.targetResultPersistence = {
    status: 'recorded',
    targetWorkspaceWriterUrl: input.targetWorkspaceWriterUrl,
  };
  try {
    await postTargetRepairResult(contract, input.issueId, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await new TerminalMirrorLog(input.preflight.terminalMirrorRef).append('stderr', `Target repair-result persistence failed after pre-dispatch block; local audit result remains available: ${message}`);
    result.metadata.targetResultPersistence = {
      status: 'failed',
      targetWorkspaceWriterUrl: input.targetWorkspaceWriterUrl,
      error: scrubTerminalMirrorText(message).slice(0, 500),
    };
  }
  await writeFile(resultJsonPath, JSON.stringify(result, null, 2), 'utf8');
  return result;
}

async function assertRepairHandoffBoundary(targetWorkspacePath: string, environment: RepairHandoffRunnerEnvironment) {
  const target = await existingRealpath(targetWorkspacePath);
  const executorRepo = await existingRealpath(environment.executorRepoPath);
  if (!environment.allowExecutorRepoTarget && samePath(target, executorRepo)) {
    throw new Error('Repair handoff blocked: targetWorkspacePath cannot equal the executor repo/worktree.');
  }
  if (!environment.allowExecutorRepoTarget && pathsIntersect(target, executorRepo)) {
    throw new Error('Repair handoff blocked: targetWorkspacePath cannot intersect the executor repo/worktree.');
  }
  const protectedPaths = [
    environment.executorStateDir,
    environment.executorLogDir,
    environment.executorConfigLocalPath,
  ].map((item) => resolve(item));
  for (const protectedPath of protectedPaths) {
    const existing = await existingRealpath(protectedPath).catch(() => resolve(protectedPath));
    if (!environment.allowExecutorRepoTarget && pathsIntersect(target, existing)) {
      throw new Error(`Repair handoff blocked: targetWorkspacePath intersects executor protected path ${existing}.`);
    }
  }
}

async function dispatchRepairExecutor(
  contract: RepairHandoffRunnerContract,
  environment: RepairHandoffRunnerEnvironment,
  options: {
    agentServerBaseUrl: string;
    issueId: string;
    repairRunId: string;
    branch: string;
    worktreePath: string;
    executorMode: 'agent-server' | 'runtime-codex';
    terminalMirror: TerminalMirrorLog;
    activeRepairRun: ActiveRepairHandoffRun;
  },
): Promise<RepairExecutorRun> {
  if (options.executorMode === 'runtime-codex') {
    return dispatchRuntimeCodexRepair(contract, environment, options);
  }
  const run = await dispatchAgentServerRepair(contract, options);
  return { ...run, mode: 'agent-server' };
}

async function dispatchRuntimeCodexRepair(
  contract: RepairHandoffRunnerContract,
  environment: RepairHandoffRunnerEnvironment,
  options: { issueId: string; repairRunId: string; branch: string; worktreePath: string; terminalMirror: TerminalMirrorLog; activeRepairRun: ActiveRepairHandoffRun },
): Promise<RepairExecutorRun> {
  const adapter = environment.runtimeCodexAdapter ?? createCodexAppServerRuntimeAdapter({ env: environment.runtimeCodexEnv });
  try {
    const abortController = new AbortController();
    options.activeRepairRun.adapter = adapter;
    options.activeRepairRun.abortController = abortController;
    await options.terminalMirror.append('event', `Starting Runtime Codex repair with profile ${contract.runtimeProfile || RUNTIME_PROFILE}.`);
    const turnId = `repair-${options.repairRunId}`;
    const turn = await adapter.startTurn({
      commandText: repairPrompt(contract, options),
      workspacePath: options.worktreePath,
      commandId: turnId,
      attemptId: `repair-${options.repairRunId}-attempt`,
      profile: contract.runtimeProfile || RUNTIME_PROFILE,
      abortSignal: abortController.signal,
      allowOpenAiRuntime: false,
      guiExtension: { enabled: false },
    });
    options.activeRepairRun.turnId = turn.turnId || turnId;
    let status: string | undefined;
    let exitCode: number | null | undefined;
    let codexSessionId = turn.codexSessionId;
    let eventCount = 0;
    for await (const event of turn.events) {
      eventCount += 1;
      codexSessionId = event.codexSessionId ?? codexSessionId;
      if (event.type === 'done' || event.type === 'failed' || event.type === 'cancelled') {
        status = event.type;
        exitCode = typeof event.exitCode === 'number' || event.exitCode === null ? event.exitCode : exitCode;
      }
      await options.terminalMirror.append(event.type === 'failed' || event.type === 'cancelled' ? 'stderr' : 'event', terminalTextForCodexEvent(event));
    }
    const stopped = Boolean(options.activeRepairRun.stopRequestedAt);
    const ok = !stopped && (status === 'done' || (status === undefined && exitCode === 0));
    return {
      ok,
      mode: 'runtime-codex',
      exitCode,
      run: {
        id: turn.turnId,
        attemptId: turn.attemptId,
        codexSessionId,
        status: stopped ? 'cancelled' : status || (ok ? 'done' : 'failed'),
        eventCount,
        terminalMirrorRef: options.terminalMirror.path,
        stopRequestedAt: options.activeRepairRun.stopRequestedAt,
        stopReason: options.activeRepairRun.stopReason,
      },
      error: ok ? undefined : stopped
        ? `Runtime Codex repair stop requested: ${options.activeRepairRun.stopReason || 'user requested repair stop'}.`
        : `Runtime Codex repair did not complete successfully${typeof exitCode === 'number' ? ` (exit ${exitCode})` : ''}.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await options.terminalMirror.append('stderr', `Runtime Codex repair failed closed: ${message}`);
    return { ok: false, mode: 'runtime-codex', error: message };
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
    allowedWritePaths: normalizePathScopes(contract.allowedWritePaths),
    forbiddenWritePaths: repairForbiddenScopePaths(contract),
    confirmationPolicy: normalizeConfirmationPolicy(contract.confirmationPolicy),
    requestMetadata: contract.requestMetadata,
    initialGuidance: contract.initialGuidance,
  };
}

function repairPrompt(contract: RepairHandoffRunnerContract, options: { issueId: string; repairRunId: string; branch: string; worktreePath: string }) {
  const confirmationPolicy = normalizeConfirmationPolicy(contract.confirmationPolicy);
  return [
    'SciForge Repair Handoff Runner',
    '',
    'You are executor instance A repairing target instance B.',
    `Target cwd is already the isolated target worktree: ${options.worktreePath}`,
    `Isolated branch: ${options.branch}`,
    'Do not write executor instance state, config, log, or repo paths.',
    'Do not write the original target workspace. Only modify the isolated target worktree cwd above.',
    'First create a concise repair plan in .sciforge/repair-runs/' + options.repairRunId + '/repair-plan.md, then implement the smallest patch for the issue bundle.',
    'The plan must list: root cause hypothesis, write scope, protected scope, commands/tests, rollback-free recovery strategy, and risks requiring user confirmation.',
    'Do not commit, push, create a pull request, merge, rewrite audit data, delete feedback data, edit credentials, or fake tests/output artifacts.',
    'Leave a normal git diff in the target worktree and let the SciForge backend compute completion from the patch, tests, and guard digests.',
    '',
    `Issue id: ${options.issueId}`,
    `Repair run id: ${options.repairRunId}`,
    `Runtime profile: ${contract.runtimeProfile || RUNTIME_PROFILE}`,
    `Confirmation policy: ${JSON.stringify(confirmationPolicy)}`,
    `Allowed write paths: ${JSON.stringify(normalizePathScopes(contract.allowedWritePaths))}`,
    `Forbidden write paths: ${JSON.stringify(repairForbiddenScopePaths(contract))}`,
    contract.initialGuidance ? `Initial user terminal guidance: ${contract.initialGuidance}` : '',
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

async function auditExecutorRepairPlan(worktreePath: string, repairRunId: string) {
  const planPath = join(worktreePath, '.sciforge', 'repair-runs', repairRunId, 'repair-plan.md');
  try {
    const text = await readFile(planPath, 'utf8');
    return {
      path: planPath,
      exists: text.trim().length > 0,
      sha256: text.trim().length > 0 ? sha256(Buffer.from(text, 'utf8')) : undefined,
      bytes: Buffer.byteLength(text, 'utf8'),
    };
  } catch {
    return { path: planPath, exists: false };
  }
}

async function auditNoExecutorCommit(worktreePath: string, baseCommit: string) {
  const headCommit = await gitOptional(worktreePath, ['rev-parse', 'HEAD']);
  return {
    baseCommit,
    headCommit: headCommit || undefined,
    created: Boolean(headCommit && headCommit !== baseCommit),
  };
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
    if (entry.name === '.git' || (isSciforgeInternalPath(childRepoPath) && !childRepoPath.startsWith('.sciforge/feedback/'))) continue;
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

function dirtyProtectionSummary(plan: DirtyWorktreeCollaborationPlan, changes: {
  changedProtectedPaths: string[];
  changedUserProtectedPaths: string[];
  changedForbiddenPaths: string[];
  changedOutsideAllowedPaths: string[];
  missingRepairPlan: boolean;
  commitCreated: boolean;
}) {
  const changedProtectedPaths = uniqueStrings([...changes.changedProtectedPaths, ...changes.changedUserProtectedPaths]);
  if (changes.missingRepairPlan) {
    return 'Repair guard blocked completion because the executor did not create the required repair plan.';
  }
  if (changes.commitCreated) {
    return 'Repair guard blocked completion because the executor created a commit in the isolated worktree.';
  }
  if (changedProtectedPaths.length > 0) {
    return `Dirty worktree protection detected original user-owned path changes: ${changedProtectedPaths.join(', ')}.`;
  }
  if (changes.changedForbiddenPaths.length > 0) {
    return `Repair guard blocked forbidden path changes in the isolated worktree: ${changes.changedForbiddenPaths.join(', ')}.`;
  }
  if (changes.changedOutsideAllowedPaths.length > 0) {
    return `Repair guard blocked changes outside the allowed write scope: ${changes.changedOutsideAllowedPaths.join(', ')}.`;
  }
  if (plan.pathConflicts.length > 0) {
    return `Dirty worktree protection blocked repair patch overlap with user-owned paths: ${uniqueStrings(plan.pathConflicts.map((conflict) => conflict.path)).join(', ')}.`;
  }
  if (plan.prohibitedCommands.length > 0) {
    return `Dirty worktree protection blocked unsafe command(s): ${plan.prohibitedCommands.map((decision) => decision.command).join(' ; ')}.`;
  }
  return 'Dirty worktree protection requires human review before applying this repair patch.';
}

async function recordTargetRepairRun(
  contract: RepairHandoffRunnerContract,
  issueId: string,
  repairRunId: string,
  preflight: RepairPreflightContext,
  options: { executorMode: 'agent-server' | 'runtime-codex'; branch: string; worktreePath: string },
) {
  const response = await fetch(`${cleanUrl(contract.targetWorkspaceWriterUrl)}/api/sciforge/feedback/issues/${encodeURIComponent(issueId)}/repair-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: contract.targetWorkspacePath,
      id: repairRunId,
      externalInstanceId: contract.executorInstance.id,
      externalInstanceName: contract.executorInstance.name,
      actor: 'repair-handoff-runner',
      startedAt: new Date().toISOString(),
      handoffRef: preflight.requestBundleRef,
      terminalMirrorRef: preflight.terminalMirrorRef,
      planRef: preflight.planRef,
      baseCommit: preflight.baseCommit,
      dirtyWorktreeDigest: preflight.dirtyWorktreeDigest,
      protectedFilesDigest: preflight.protectedFilesDigest,
      feedbackDataDigest: preflight.feedbackDataDigest,
      confirmationPolicy: preflight.confirmationPolicy,
      issueBundle: redactForAgent(contract.issueBundle),
      metadata: {
        executorInstance: contract.executorInstance,
        targetInstance: contract.targetInstance,
        executorMode: options.executorMode,
        isolatedBranch: options.branch,
        isolatedWorktreePath: options.worktreePath,
        runtimeProfile: contract.runtimeProfile || RUNTIME_PROFILE,
        allowOpenAiRuntime: false,
        requestMetadata: contract.requestMetadata,
        requestPlan: preflight.requestPlan,
        guardDigests: {
          dirtyWorktreeDigest: preflight.dirtyWorktreeDigest,
          protectedFilesDigest: preflight.protectedFilesDigest,
          feedbackDataDigest: preflight.feedbackDataDigest,
        },
      },
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`target writer repair-run record failed: HTTP ${response.status}${text ? ` ${scrubTerminalMirrorText(text).slice(0, 500)}` : ''}`);
  }
}

async function postTargetRepairResult(contract: RepairHandoffRunnerContract, issueId: string, result: RepairHandoffRunnerResult) {
  const response = await fetch(`${cleanUrl(contract.targetWorkspaceWriterUrl)}/api/sciforge/feedback/issues/${encodeURIComponent(issueId)}/repair-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: contract.targetWorkspacePath,
      issueBundle: redactForAgent(contract.issueBundle),
      result,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Target repair-result API failed: HTTP ${response.status}${text ? ` ${scrubTerminalMirrorText(text).slice(0, 500)}` : ''}`);
  }
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

function envHasValue(env: NodeJS.ProcessEnv, key: string) {
  return Boolean(env[key]?.trim());
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

function repairExecutorMode(contract: RepairHandoffRunnerContract): 'agent-server' | 'runtime-codex' {
  return contract.executorBackend === 'agent-server' ? 'agent-server' : 'runtime-codex';
}

function normalizeConfirmationPolicy(value?: RepairConfirmationPolicy): RepairConfirmationPolicy {
  return {
    commit: value?.commit === 'requires-user-confirmation' ? 'requires-user-confirmation' : 'disabled',
    push: value?.push === 'requires-second-confirmation' ? 'requires-second-confirmation' : 'disabled',
    pr: value?.pr === 'requires-second-confirmation' ? 'requires-second-confirmation' : 'disabled',
    merge: 'never',
  };
}

function assertNoDestructiveCommands(tests: Array<string | RepairHandoffExpectedTest>) {
  const commands = tests.map((test) => typeof test === 'string' ? test : test.command);
  const forbidden = commands.find((command) => /\bgit\s+(?:reset\s+--hard|checkout\s+(?:--|\.)|restore\s+(?:--|\.)|clean\s+-[^\s]*f)|\brm\s+-rf\s+(?:\.|\/|\*)|\btruncate\s+-s\s+0\b/i.test(command));
  if (forbidden) {
    throw new Error(`Repair handoff blocked destructive command: ${forbidden}`);
  }
}

const REPAIR_CONTROL_SURFACE_SAFE_MODE_SCOPES = [
  'src/ui/src/app/sciforgeApp/FeedbackInboxPage.tsx',
  'src/ui/src/feedback',
  'src/ui/src/api/workspaceClient.ts',
  'src/runtime/workspace-server.ts',
  'src/runtime/repair-handoff-runner.ts',
];

function repairControlSurfaceSafeMode(changedFiles: string[]) {
  const matchedPaths = uniqueStrings(changedFiles.filter((file) => pathMatchesAnySafeModeScope(file)));
  return {
    active: matchedPaths.length > 0,
    reason: matchedPaths.length > 0
      ? 'Repair touches the feedback inbox or repair backend/control surface.'
      : 'Repair does not touch the feedback inbox or repair backend/control surface.',
    matchedPaths,
    requiresExternalControlSurface: matchedPaths.length > 0,
  };
}

function pathMatchesAnySafeModeScope(value: string) {
  const normalized = normalizeRepoPath(value);
  return REPAIR_CONTROL_SURFACE_SAFE_MODE_SCOPES.some((scope) => normalized === scope || normalized.startsWith(`${scope}/`));
}

function repairProtectedScopePaths(contract: RepairHandoffRunnerContract) {
  const runnerOwnedInternalScopes = new Set(['.git', '.sciforge/repair-results', '.sciforge/repair-worktrees']);
  return uniqueStrings([
    '.sciforge/feedback',
    '.sciforge/workspace-state.json',
    'config.local.json',
    '.env',
    '.env.local',
    ...(contract.forbiddenWritePaths ?? []),
  ].filter((path) => !runnerOwnedInternalScopes.has(normalizeRepoPath(path))));
}

function repairForbiddenScopePaths(contract: RepairHandoffRunnerContract) {
  return uniqueStrings([
    '.git',
    '.sciforge/feedback',
    '.sciforge/repair-results',
    '.sciforge/repair-worktrees',
    'config.local.json',
    '.env',
    '.env.local',
    ...(contract.forbiddenWritePaths ?? []),
  ]);
}

function normalizePathScopes(paths: string[] | undefined) {
  return uniqueStrings((paths ?? []).map((path) => path.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '')));
}

function pathMatchesAnyScope(path: string, scopes: string[]) {
  const normalized = normalizeRepoPath(path);
  return scopes.some((scope) => {
    const clean = normalizeRepoPath(scope);
    return normalized === clean || normalized.startsWith(`${clean}/`);
  });
}

function pathAllowedByScope(path: string, allowedWritePaths: string[] | undefined) {
  const scopes = normalizePathScopes(allowedWritePaths);
  return scopes.length === 0 || pathMatchesAnyScope(path, scopes);
}

async function snapshotPathList(root: string, paths: string[]) {
  const snapshots: ProtectedPathSnapshot[] = [];
  for (const path of normalizePathScopes(paths)) snapshots.push(await snapshotProtectedPath(root, path));
  return snapshots;
}

function sha256Text(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Json(value: unknown) {
  return sha256Text(JSON.stringify(value));
}

async function feedbackDataDigestForRepo(root: string) {
  const snapshots = await snapshotPathList(root, ['.sciforge/feedback', '.sciforge/workspace-state.json']);
  return sha256Json(snapshots);
}

function buildRepairRequestPlan(
  contract: RepairHandoffRunnerContract,
  input: {
    issueId: string;
    repairRunId: string;
    executorMode: 'agent-server' | 'runtime-codex';
    branch: string;
    worktreePath: string;
    resultDir: string;
    preflight: RepairPreflightContext;
  },
) {
  return {
    schemaVersion: 1,
    kind: 'feedback-repair-request-plan',
    issueId: input.issueId,
    repairRunId: input.repairRunId,
    executorMode: input.executorMode,
    runtimeProfile: contract.runtimeProfile || RUNTIME_PROFILE,
    isolatedBranch: input.branch,
    isolatedWorktreePath: input.worktreePath,
    resultDir: input.resultDir,
    rootCauseHypothesis: 'Derived by Runtime Codex from the selected feedback issue bundle.',
    writeScope: {
      allowedWritePaths: normalizePathScopes(contract.allowedWritePaths),
      forbiddenWritePaths: repairForbiddenScopePaths(contract),
    },
    protectedScope: input.preflight.protectedScopePaths,
    safeModeControlSurfaceScopes: REPAIR_CONTROL_SURFACE_SAFE_MODE_SCOPES,
    commandsAndTests: contract.expectedTests,
    confirmationPolicy: input.preflight.confirmationPolicy,
    rollbackFreeRecoveryStrategy: 'Preserve original workspace and feedback data; review/apply the isolated worktree patch without destructive git commands.',
    guardDigests: {
      baseCommit: input.preflight.baseCommit,
      dirtyWorktreeDigest: input.preflight.dirtyWorktreeDigest,
      protectedFilesDigest: input.preflight.protectedFilesDigest,
      feedbackDataDigest: input.preflight.feedbackDataDigest,
    },
    refs: {
      requestBundleRef: input.preflight.requestBundleRef,
      planRef: input.preflight.planRef,
      terminalMirrorRef: input.preflight.terminalMirrorRef,
    },
    requestMetadata: contract.requestMetadata,
  };
}

function terminalTextForCodexEvent(event: NormalizedAgentEvent) {
  return [
    event.type,
    event.status ? `status=${event.status}` : undefined,
    event.exitCode !== undefined ? `exit=${event.exitCode}` : undefined,
    event.message ?? event.text,
    event.toolName ? `tool=${event.toolName}` : undefined,
  ].filter(Boolean).join(' ');
}

function normalizeRepoPath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
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
