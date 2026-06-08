import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runRepairHandoff } from '../../src/runtime/repair-handoff-runner.js';
import type { AgentCliAdapter, AgentCliStartTurnInput } from '../../src/runtime/codex/agent-cli-adapter.js';

const root = await mkdtemp(join(tmpdir(), 'sciforge-repair-handoff-'));
const executorRepo = join(root, 'SciForge-A');
const targetRepo = join(root, 'SciForge-B');
const executorStateDir = join(executorRepo, '.sciforge', 'state');
const executorLogDir = join(executorRepo, '.sciforge', 'logs');
const executorConfigLocalPath = join(executorRepo, 'config.local.json');
const targetResults: Record<string, unknown>[] = [];
const targetRuns: Record<string, unknown>[] = [];
let agentServerRunCount = 0;

const runtimeCodexReadyServiceEnv = {
  SCIFORGE_RUNTIME_API_KEY: 'test-runtime-service-key',
  SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:3892/v1',
} as NodeJS.ProcessEnv;

class FakeRuntimeCodexAdapter implements AgentCliAdapter {
  readonly inputs: AgentCliStartTurnInput[] = [];

  constructor(private readonly onStart: (input: AgentCliStartTurnInput) => Promise<void>) {}

  async startTurn(input: AgentCliStartTurnInput) {
    this.inputs.push(input);
    await this.onStart(input);
    return {
      turnId: 'fake-runtime-codex-turn',
      attemptId: input.attemptId || 'fake-runtime-codex-attempt',
      codexSessionId: 'fake-runtime-codex-session',
      events: this.events(input),
    };
  }

  async cancel() {}

  private async *events(input: AgentCliStartTurnInput) {
    const base = {
      schemaVersion: 'sciforge.codex.normalized-event.v1' as const,
      timestamp: new Date().toISOString(),
      provider: 'fake',
      model: 'fake-runtime-codex',
      profile: input.profile || '',
      workspace: input.workspacePath,
      commandId: input.commandId || '',
      attemptId: input.attemptId || '',
      codexSessionId: 'fake-runtime-codex-session',
    };
    yield {
      ...base,
      type: 'run_started' as const,
      message: 'fake Runtime Codex started authorization: Basic open-secret x-api-key: sk_terminal_secret_1234567890 rawProviderBody=provider-secret-payload /Users/alice/.codex/config.local.json',
    };
    yield { ...base, type: 'done' as const, status: 'done', message: 'fake Runtime Codex completed', exitCode: 0 };
  }
}

const agentServer = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/api/agent-server/runs') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  const body = await readJson(req);
  agentServerRunCount += 1;
  const agent = isRecord(body.agent) ? body.agent : {};
  const agentMetadata = isRecord(agent.metadata) ? agent.metadata : {};
  const input = isRecord(body.input) ? body.input : {};
  const inputMetadata = isRecord(input.metadata) ? input.metadata : {};
  const metadataContract = isRecord(inputMetadata.contract) ? inputMetadata.contract : {};
  const cwd = typeof agent.workingDirectory === 'string' ? agent.workingDirectory : '';
  assert.ok(cwd.includes(join('SciForge-B', '.sciforge', 'repair-worktrees')));
  assert.equal(agentMetadata.targetWorkspacePath, undefined);
  assert.equal(agentMetadata.targetWorkspaceWriterUrl, undefined);
  assert.equal(metadataContract.targetBoundary, 'isolated-worktree-only');
  assert.equal(metadataContract.targetWorkspacePath, undefined);
  await mkdir(join(cwd, '.sciforge', 'repair-runs', String(agentMetadata.repairRunId)), { recursive: true });
  await writeFile(join(cwd, '.sciforge', 'repair-runs', String(agentMetadata.repairRunId), 'repair-plan.md'), [
    '# Repair plan',
    '',
    '- Root cause hypothesis: smoke fixture',
    '- Write scope: target worktree only',
    '- Protected scope: user notes and SciForge feedback state',
    '- Commands/tests: expected smoke command',
    '- Rollback-free recovery strategy: leave patch for review',
    '- Risks requiring user confirmation: none',
    '',
  ].join('\n'), 'utf8');
  if (agentMetadata.repairRunId === 'runner-dirty-overlap') {
    await mkdir(join(cwd, 'docs'), { recursive: true });
    await writeFile(join(cwd, 'docs', 'user-notes.md'), 'agent attempted to overwrite protected user notes\n', 'utf8');
  } else {
    await mkdir(join(cwd, 'src'), { recursive: true });
    await writeFile(join(cwd, 'src', 'fixed.txt'), 'repaired\n', 'utf8');
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    data: {
      run: {
        id: 'mock-agentserver-repair-run',
        status: 'completed',
        output: { result: 'patched target worktree' },
      },
    },
  }));
});

const targetWriter = createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  const body = await readJson(req);
  if (String(req.url).endsWith('/repair-runs')) {
    if (body.id === 'runner-target-record-fails') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'target writer rejected repair-run record' }));
      return;
    }
    targetRuns.push(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, run: { id: body.id, issueId: 'feedback-1', status: 'running', startedAt: new Date().toISOString() } }));
    return;
  }
  if (String(req.url).endsWith('/repair-result')) {
    if (isRecord(body.result) && body.result.id === 'repair-result-runner-runtime-target-result-fails') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'target writer rejected blocked repair-result record' }));
      return;
    }
    targetResults.push(body);
    await mkdir(join(targetRepo, '.sciforge', 'feedback', 'repair-results'), { recursive: true });
    await writeFile(join(targetRepo, '.sciforge', 'feedback', 'repair-results', 'latest.json'), JSON.stringify(body.result, null, 2), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result: body.result }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

try {
  await initRepo(executorRepo);
  await initRepo(targetRepo);
  await mkdir(join(targetRepo, 'docs'), { recursive: true });
  await writeFile(join(targetRepo, 'docs', 'user-notes.md'), 'committed target notes\n', 'utf8');
  await git(targetRepo, ['add', 'docs/user-notes.md']);
  await git(targetRepo, ['commit', '-q', '-m', 'target notes']);
  await writeFile(join(targetRepo, 'docs', 'user-notes.md'), 'committed target notes\n\nuser draft must survive\n', 'utf8');
  await mkdir(join(targetRepo, 'scratch'), { recursive: true });
  await writeFile(join(targetRepo, 'scratch', 'local.csv'), 'sample,value\nA,1\n', 'utf8');
  await mkdir(executorStateDir, { recursive: true });
  await mkdir(executorLogDir, { recursive: true });
  await writeFile(executorConfigLocalPath, '{}\n', 'utf8');
  await listen(agentServer);
  await listen(targetWriter);
  const agentAddress = agentServer.address();
  const targetAddress = targetWriter.address();
  assert.ok(agentAddress && typeof agentAddress === 'object');
  assert.ok(targetAddress && typeof targetAddress === 'object');

  const result = await runRepairHandoff({
    executorInstance: {
      id: 'A',
      name: 'Stable A',
      workspacePath: executorRepo,
      workspaceWriterUrl: 'http://127.0.0.1:1',
    },
    targetInstance: {
      id: 'B',
      name: 'Target B',
      workspacePath: targetRepo,
      workspaceWriterUrl: `http://127.0.0.1:${targetAddress.port}`,
    },
    targetWorkspacePath: targetRepo,
    targetWorkspaceWriterUrl: `http://127.0.0.1:${targetAddress.port}`,
    issueBundle: {
      id: 'feedback-1',
      title: 'Fix B',
      comment: { id: 'feedback-1', comment: 'Create the repaired marker in B only.' },
    },
    expectedTests: ['test -f src/fixed.txt && grep -q repaired src/fixed.txt'],
    githubSyncRequired: false,
    executorBackend: 'agent-server',
    agentServerBaseUrl: `http://127.0.0.1:${agentAddress.port}`,
    forbiddenWritePaths: ['.git', '.sciforge/repair-results', '.sciforge/repair-worktrees'],
    repairRunId: 'runner-focused',
  }, {
    executorRepoPath: executorRepo,
    executorStateDir,
    executorLogDir,
    executorConfigLocalPath,
    runtimeCodexServiceEnv: runtimeCodexReadyServiceEnv,
  });

  assert.equal(result.verdict, 'fixed');
  assert.deepEqual(result.changedFiles, ['src/fixed.txt']);
  assert.equal(result.executorInstance.id, 'A');
  assert.equal(result.targetInstance.id, 'B');
  assert.match(result.refs.branch ?? '', /^codex\/repair-handoff\/B\/feedback-1\//);
  const targetRepoReal = await realpath(targetRepo);
  assert.ok(result.refs.worktreePath?.startsWith(join(targetRepoReal, '.sciforge', 'repair-worktrees')));
  assert.equal(await fileText(join(result.refs.worktreePath ?? '', 'src', 'fixed.txt')), 'repaired\n');
  await assertMissing(join(executorRepo, 'src', 'fixed.txt'));
  await assertMissing(join(targetRepo, 'src', 'fixed.txt'));
  assert.match(await fileText(join(targetRepo, 'docs', 'user-notes.md')), /user draft must survive/);
  assert.match(await fileText(join(targetRepo, 'scratch', 'local.csv')), /sample,value/);
  assert.equal(await exists(result.diffRef ?? ''), true);
  assert.match(await fileText(result.diffRef ?? ''), /src\/fixed\.txt/);
  const dirtyMetadata = result.metadata.dirtyWorktreeCollaboration as Record<string, unknown>;
  assert.equal(dirtyMetadata.status, 'passed');
  assert.deepEqual(dirtyMetadata.changedProtectedPaths, []);
  assert.equal(typeof dirtyMetadata.auditRef, 'string');
  assert.equal((dirtyMetadata.executorRepairPlan as Record<string, unknown>).exists, true);
  assert.equal((dirtyMetadata.commitAudit as Record<string, unknown>).created, false);
  const dirtyPlan = dirtyMetadata.plan as Record<string, unknown>;
  assert.equal(dirtyPlan.status, 'safe');
  const protectedPaths = dirtyPlan.protectedPaths as string[];
  assert.ok(protectedPaths.includes('docs/user-notes.md'), `protected paths: ${JSON.stringify(protectedPaths)}`);
  assert.equal(targetRuns.length, 1);
  assert.equal(targetResults.length, 1);
  assert.equal((targetResults[0].result as Record<string, unknown>).diffRef, result.diffRef);
  assert.equal(typeof targetRuns[0].terminalMirrorRef, 'string');
  assert.equal(typeof targetRuns[0].planRef, 'string');
  assert.equal(targetRuns[0].baseCommit, result.metadata.baseCommit);
  assert.equal(targetRuns[0].dirtyWorktreeDigest, (result.metadata.guardDigests as Record<string, unknown>).dirtyWorktreeDigest);
  assert.equal(targetRuns[0].protectedFilesDigest, (result.metadata.guardDigests as Record<string, unknown>).protectedFilesDigest);
  assert.equal(targetRuns[0].feedbackDataDigest, (result.metadata.guardDigests as Record<string, unknown>).feedbackDataDigest);
  assert.equal(((targetRuns[0].issueBundle as Record<string, unknown>).comment as Record<string, unknown>).id, 'feedback-1');
  assert.deepEqual(targetRuns[0].confirmationPolicy, {
    commit: 'disabled',
    push: 'disabled',
    pr: 'disabled',
    merge: 'never',
  });
  assert.equal(await exists(String(targetRuns[0].terminalMirrorRef)), true);
  assert.match(await fileText(String(targetRuns[0].terminalMirrorRef)), /SciForge repair request runner-focused accepted/);

  const agentRunsBeforeRecordFailure = agentServerRunCount;
  const targetRecordFailure = await runRepairHandoff({
    executorInstance: {
      id: 'A',
      name: 'Stable A',
      workspacePath: executorRepo,
      workspaceWriterUrl: 'http://127.0.0.1:1',
    },
    targetInstance: {
      id: 'B',
      name: 'Target B',
      workspacePath: targetRepo,
      workspaceWriterUrl: `http://127.0.0.1:${targetAddress.port}`,
    },
    targetWorkspacePath: targetRepo,
    targetWorkspaceWriterUrl: `http://127.0.0.1:${targetAddress.port}`,
    issueBundle: {
      id: 'feedback-target-record-fails',
      title: 'Target writer failure',
      comment: { id: 'feedback-target-record-fails', comment: 'Target run registration failure must not block direct Codex CLI dispatch.' },
    },
    expectedTests: ['test -f src/fixed.txt'],
    githubSyncRequired: false,
    executorBackend: 'agent-server',
    agentServerBaseUrl: `http://127.0.0.1:${agentAddress.port}`,
    repairRunId: 'runner-target-record-fails',
  }, {
    executorRepoPath: executorRepo,
    executorStateDir,
    executorLogDir,
    executorConfigLocalPath,
  });
  assert.equal(targetRecordFailure.verdict, 'fixed');
  assert.equal(agentServerRunCount, agentRunsBeforeRecordFailure + 1);
  assert.equal(await exists(join(targetRecordFailure.refs.worktreePath ?? '', 'src', 'fixed.txt')), true);
  const failedRecordTerminal = join(targetRepo, '.sciforge', 'repair-results', 'runner-target-record-fails', 'terminal-mirror.ndjson');
  assert.match(await fileText(failedRecordTerminal), /Target writer repair-run sync unavailable; continuing with direct Codex CLI dispatch/);

  const blocked = await runRepairHandoff({
    executorInstance: {
      id: 'A',
      name: 'Stable A',
      workspacePath: executorRepo,
      workspaceWriterUrl: 'http://127.0.0.1:1',
    },
    targetInstance: {
      id: 'B',
      name: 'Target B',
      workspacePath: targetRepo,
      workspaceWriterUrl: `http://127.0.0.1:${targetAddress.port}`,
    },
    targetWorkspacePath: targetRepo,
    targetWorkspaceWriterUrl: `http://127.0.0.1:${targetAddress.port}`,
    issueBundle: {
      id: 'feedback-2',
      title: 'Unsafe overlap',
      comment: { id: 'feedback-2', comment: 'This patch tries to edit a user-owned dirty file.' },
    },
    expectedTests: ['test -f docs/user-notes.md'],
    githubSyncRequired: false,
    executorBackend: 'agent-server',
    agentServerBaseUrl: `http://127.0.0.1:${agentAddress.port}`,
    repairRunId: 'runner-dirty-overlap',
  }, {
    executorRepoPath: executorRepo,
    executorStateDir,
    executorLogDir,
    executorConfigLocalPath,
  });

  assert.equal(blocked.verdict, 'needs-follow-up');
  assert.match(blocked.summary, /Dirty worktree protection blocked/);
  assert.deepEqual(blocked.changedFiles, ['docs/user-notes.md']);
  const blockedDirtyMetadata = blocked.metadata.dirtyWorktreeCollaboration as Record<string, unknown>;
  assert.equal(blockedDirtyMetadata.status, 'blocked');
  const blockedDirtyPlan = blockedDirtyMetadata.plan as Record<string, unknown>;
  assert.equal(blockedDirtyPlan.status, 'blocked');
  assert.match(await fileText(join(targetRepo, 'docs', 'user-notes.md')), /user draft must survive/);

  const targetRunsBeforeRuntimePreflight = targetRuns.length;
  const targetResultsBeforeRuntimePreflight = targetResults.length;
  const agentRunsBeforeRuntimePreflight = agentServerRunCount;
  const runtimePreflightBlocked = await runRepairHandoff({
    executorInstance: {
      id: 'A',
      name: 'Stable A',
      workspacePath: executorRepo,
      workspaceWriterUrl: 'http://127.0.0.1:1',
    },
    targetInstance: {
      id: 'B',
      name: 'Target B',
      workspacePath: targetRepo,
      workspaceWriterUrl: `http://127.0.0.1:${targetAddress.port}`,
    },
    targetWorkspacePath: targetRepo,
    targetWorkspaceWriterUrl: `http://127.0.0.1:${targetAddress.port}`,
    issueBundle: {
      id: 'feedback-runtime-missing-env',
      title: 'Runtime Codex missing provider env',
      comment: { id: 'feedback-runtime-missing-env', comment: 'Missing provider env must block before any worktree is created.' },
    },
    expectedTests: ['test -f src/runtime-fixed.txt'],
    githubSyncRequired: false,
    executorBackend: 'runtime-codex',
    repairRunId: 'runner-runtime-missing-env',
  }, {
    executorRepoPath: executorRepo,
    executorStateDir,
    executorLogDir,
    executorConfigLocalPath,
    runtimeCodexEnv: {
      SCIFORGE_RUNTIME_API_KEY: 'config-fallback-key-cannot-satisfy-service-env',
      SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:3892/v1',
    },
    runtimeCodexServiceEnv: {},
  });
  assert.equal(runtimePreflightBlocked.verdict, 'needs-follow-up');
  assert.match(runtimePreflightBlocked.summary, /blocked before isolated worktree creation/i);
  assert.deepEqual(runtimePreflightBlocked.changedFiles, []);
  assert.equal(runtimePreflightBlocked.refs.worktreePath, undefined);
  assert.equal(runtimePreflightBlocked.refs.branch, undefined);
  assert.equal((runtimePreflightBlocked.metadata.providerPreflight as Record<string, unknown>).status, 'blocked');
  assert.deepEqual((runtimePreflightBlocked.metadata.providerPreflight as Record<string, unknown>).missingEnv, ['SCIFORGE_RUNTIME_API_KEY', 'SCIFORGE_MODEL_ROUTER_BASE_URL']);
  assert.equal((runtimePreflightBlocked.metadata.providerPreflight as Record<string, unknown>).runtimeApiKeyPresentInAdapterEnv, true);
  assert.equal((runtimePreflightBlocked.metadata.providerPreflight as Record<string, unknown>).modelRouterEndpointSource, 'adapter-env-or-config');
  assert.equal(runtimePreflightBlocked.metadata.noExecutorDispatch, true);
  assert.equal(runtimePreflightBlocked.metadata.noIsolatedWorktreeCreated, true);
  assert.equal(runtimePreflightBlocked.metadata.noTargetRepairRunRegistered, true);
  assert.equal(targetRuns.length, targetRunsBeforeRuntimePreflight);
  assert.equal(targetResults.length, targetResultsBeforeRuntimePreflight + 1);
  assert.equal(agentServerRunCount, agentRunsBeforeRuntimePreflight);
  await assertMissing(join(targetRepo, '.sciforge', 'repair-worktrees', 'runner-runtime-missing-env'));
  assert.equal(await exists(join(targetRepo, '.sciforge', 'repair-results', 'runner-runtime-missing-env', 'pre-dispatch-provider-preflight.json')), true);
  const runtimeBlockedTerminal = await fileText(String(runtimePreflightBlocked.metadata.terminalMirrorRef));
  assert.match(runtimeBlockedTerminal, /Runtime Codex provider preflight blocked before isolated worktree creation/);
  assert.match(runtimeBlockedTerminal, /SCIFORGE_RUNTIME_API_KEY/);
  assert.match(runtimeBlockedTerminal, /SCIFORGE_MODEL_ROUTER_BASE_URL/);
  assert.match(runtimeBlockedTerminal, /adapter\/config fallback/);
  assert.doesNotMatch(runtimeBlockedTerminal, /Created isolated worktree/);
  assert.doesNotMatch(runtimeBlockedTerminal, /Starting Runtime Codex repair/);

  const targetResultsBeforeFailedRuntimePersistence = targetResults.length;
  const runtimePreflightTargetPostFailed = await runRepairHandoff({
    executorInstance: {
      id: 'A',
      name: 'Stable A',
      workspacePath: executorRepo,
      workspaceWriterUrl: 'http://127.0.0.1:1',
    },
    targetInstance: {
      id: 'B',
      name: 'Target B',
      workspacePath: targetRepo,
      workspaceWriterUrl: `http://127.0.0.1:${targetAddress.port}`,
    },
    targetWorkspacePath: targetRepo,
    targetWorkspaceWriterUrl: `http://127.0.0.1:${targetAddress.port}`,
    issueBundle: {
      id: 'feedback-runtime-target-result-fails',
      title: 'Runtime Codex missing provider env with target post failure',
      comment: { id: 'feedback-runtime-target-result-fails', comment: 'Local audit must remain available even if target result persistence fails.' },
    },
    expectedTests: [],
    githubSyncRequired: false,
    executorBackend: 'runtime-codex',
    repairRunId: 'runner-runtime-target-result-fails',
  }, {
    executorRepoPath: executorRepo,
    executorStateDir,
    executorLogDir,
    executorConfigLocalPath,
    runtimeCodexEnv: {},
    runtimeCodexServiceEnv: {},
  });
  assert.equal(runtimePreflightTargetPostFailed.verdict, 'needs-follow-up');
  assert.equal(targetResults.length, targetResultsBeforeFailedRuntimePersistence);
  assert.equal((runtimePreflightTargetPostFailed.metadata.targetResultPersistence as Record<string, unknown>).status, 'failed');
  assert.equal(runtimePreflightTargetPostFailed.metadata.noIsolatedWorktreeCreated, true);
  await assertMissing(join(targetRepo, '.sciforge', 'repair-worktrees', 'runner-runtime-target-result-fails'));
  const failedPersistenceResultPath = join(targetRepo, '.sciforge', 'repair-results', 'runner-runtime-target-result-fails', 'result.json');
  const failedPersistenceResult = JSON.parse(await fileText(failedPersistenceResultPath)) as Record<string, unknown>;
  assert.equal(((failedPersistenceResult.metadata as Record<string, unknown>).targetResultPersistence as Record<string, unknown>).status, 'failed');
  const failedPersistenceTerminal = await fileText(String(runtimePreflightTargetPostFailed.metadata.terminalMirrorRef));
  assert.match(failedPersistenceTerminal, /Target repair-result persistence failed after pre-dispatch block/);

  const fakeRuntimeCodexAdapter = new FakeRuntimeCodexAdapter(async (input) => {
    assert.equal(input.profile, 'runtime-codex-repair-smoke');
    assert.equal(input.allowOpenAiRuntime, false);
    assert.match(input.commandText, /Allowed write paths: \["src"\]/);
    assert.match(input.commandText, /Forbidden write paths: .*"docs\/user-notes\.md"/);
    assert.match(input.commandText, /Confirmation policy: .*"commit":"disabled"/);
    assert.match(input.commandText, /Initial user terminal guidance: Use a tiny marker patch from the inbox terminal\./);
    await mkdir(join(input.workspacePath, '.sciforge', 'repair-runs', 'runner-runtime-codex'), { recursive: true });
    await writeFile(join(input.workspacePath, '.sciforge', 'repair-runs', 'runner-runtime-codex', 'repair-plan.md'), [
      '# Runtime Codex repair plan',
      '',
      '- Root cause hypothesis: smoke fixture',
      '- Write scope: src/runtime-fixed.txt',
      '- Protected scope: docs/user-notes.md',
      '- Commands/tests: marker test',
      '- Rollback-free recovery strategy: leave patch only',
      '- Risks requiring user confirmation: none',
      '',
    ].join('\n'), 'utf8');
    await mkdir(join(input.workspacePath, 'src'), { recursive: true });
    await writeFile(join(input.workspacePath, 'src', 'runtime-fixed.txt'), 'runtime repaired\n', 'utf8');
  });
  const runtimeCodex = await runRepairHandoff({
    executorInstance: {
      id: 'A',
      name: 'Stable A',
      workspacePath: executorRepo,
      workspaceWriterUrl: 'http://127.0.0.1:1',
    },
    targetInstance: {
      id: 'B',
      name: 'Target B',
      workspacePath: targetRepo,
      workspaceWriterUrl: `http://127.0.0.1:${targetAddress.port}`,
    },
    targetWorkspacePath: targetRepo,
    targetWorkspaceWriterUrl: `http://127.0.0.1:${targetAddress.port}`,
    issueBundle: {
      id: 'feedback-runtime-codex',
      title: 'Fix B with Runtime Codex',
      comment: { id: 'feedback-runtime-codex', comment: 'Create the runtime repaired marker in B only.' },
    },
    expectedTests: ['test -f src/runtime-fixed.txt && grep -q "runtime repaired" src/runtime-fixed.txt'],
    githubSyncRequired: false,
    executorBackend: 'runtime-codex',
    runtimeProfile: 'runtime-codex-repair-smoke',
    allowOpenAiRuntime: false,
    initialGuidance: 'Use a tiny marker patch from the inbox terminal.',
    allowedWritePaths: ['src'],
    forbiddenWritePaths: ['docs/user-notes.md'],
    requestMetadata: { source: 'smoke', nested: { selectedIssue: 'feedback-runtime-codex' } },
    confirmationPolicy: {
      commit: 'disabled',
      push: 'disabled',
      pr: 'disabled',
      merge: 'never',
    },
    repairRunId: 'runner-runtime-codex',
  }, {
    executorRepoPath: executorRepo,
    executorStateDir,
    executorLogDir,
    executorConfigLocalPath,
    runtimeCodexAdapter: fakeRuntimeCodexAdapter,
  });

  assert.equal(runtimeCodex.verdict, 'fixed');
  assert.deepEqual(runtimeCodex.changedFiles, ['src/runtime-fixed.txt']);
  assert.equal(fakeRuntimeCodexAdapter.inputs.length, 1);
  assert.equal(runtimeCodex.metadata.executorMode, 'runtime-codex');
  assert.deepEqual(runtimeCodex.metadata.requestMetadata, { source: 'smoke', nested: { selectedIssue: 'feedback-runtime-codex' } });
  assert.deepEqual(runtimeCodex.metadata.confirmationPolicy, {
    commit: 'disabled',
    push: 'disabled',
    pr: 'disabled',
    merge: 'never',
  });
  const runtimeDirtyMetadata = runtimeCodex.metadata.dirtyWorktreeCollaboration as Record<string, unknown>;
  assert.equal(runtimeDirtyMetadata.status, 'passed');
  assert.equal((runtimeDirtyMetadata.executorRepairPlan as Record<string, unknown>).exists, true);
  assert.equal((runtimeDirtyMetadata.commitAudit as Record<string, unknown>).created, false);
  const runtimeAudit = JSON.parse(await fileText(String(runtimeDirtyMetadata.auditRef))) as Record<string, unknown>;
  assert.deepEqual(runtimeAudit.allowedWritePaths, ['src']);
  assert.ok((runtimeAudit.forbiddenWritePaths as string[]).includes('docs/user-notes.md'));
  const runtimeTerminalMirror = await fileText(String(runtimeCodex.metadata.terminalMirrorRef));
  assert.doesNotMatch(runtimeTerminalMirror, /open-secret|sk_terminal_secret|provider-secret-payload|\/Users\/alice/);
  assert.match(runtimeTerminalMirror, /\[redacted/);

  await assert.rejects(
    () => runRepairHandoff({
      executorInstance: { id: 'A', workspacePath: executorRepo },
      targetInstance: { id: 'A', workspacePath: executorRepo },
      targetWorkspacePath: executorRepo,
      targetWorkspaceWriterUrl: `http://127.0.0.1:${targetAddress.port}`,
      issueBundle: { id: 'feedback-closed' },
      expectedTests: [],
      githubSyncRequired: false,
      agentServerBaseUrl: `http://127.0.0.1:${agentAddress.port}`,
    }, {
      executorRepoPath: executorRepo,
      executorStateDir,
      executorLogDir,
      executorConfigLocalPath,
    }),
    /targetWorkspacePath cannot equal the executor repo\/worktree/i,
  );

  console.log('[ok] repair handoff runner executes in target isolated worktree, protects dirty user paths, preserves Runtime Codex contract fields, audits plan/commit invariants, and fails closed for executor paths');
} finally {
  await new Promise<void>((resolve) => agentServer.close(() => resolve()));
  await new Promise<void>((resolve) => targetWriter.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}

async function initRepo(path: string) {
  await mkdir(path, { recursive: true });
  await git(path, ['init', '-q']);
  await git(path, ['config', 'user.email', 'sciforge@example.test']);
  await git(path, ['config', 'user.name', 'SciForge Test']);
  await writeFile(join(path, 'README.md'), `# ${path}\n`, 'utf8');
  await git(path, ['add', 'README.md']);
  await git(path, ['commit', '-q', '-m', 'init']);
}

async function git(cwd: string, args: string[]) {
  const result = await runCommand('git', args, cwd);
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  return result.stdout.trim();
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

async function listen(server: ReturnType<typeof createServer>) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  return isRecord(parsed) ? parsed : {};
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function assertMissing(path: string) {
  assert.equal(await exists(path), false, `${path} should not exist`);
}

async function fileText(path: string) {
  return readFile(path, 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
