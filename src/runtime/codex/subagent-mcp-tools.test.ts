import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callSubagentMcpTool } from './subagent-mcp-tools.js';
import { SUBAGENT_SPAWN_AGENT_TOOL_NAME } from './subagent-extension-manifest.js';
import { createReadOnlySubagentRunner } from './subagent-runner.js';
import {
  createSubagentRuntimeStore,
  type StoredSubagentRun,
} from './subagent-runtime-store.js';

test('spawn_agent inspects safe workspace refs without exposing private diagnostics', async () => {
  const workspace = await tempWorkspace();
  const transcriptRoot = await mkdtemp(join(tmpdir(), 'sciforge-subagent-transcripts-'));
  await writeFile(join(workspace, 'PROJECT.md'), [
    '# Project',
    '- [ ] Remaining live parity TODO: expose Runtime Codex sub-agent/delegated-worker MCP tool surface and retest transcript/ref.',
    '',
  ].join('\n'), 'utf8');

  const result = await callSubagentMcpTool(SUBAGENT_SPAWN_AGENT_TOOL_NAME, {
    message: 'Inspect PROJECT.md and report the single remaining sub-agent TODO. token=secret-token-123456.',
    agentType: 'reviewer',
    refs: [
      'artifact:input-ok',
      'PROJECT.md',
    ],
  }, {
    workspace,
    transcriptRoot,
    parentCommandId: 'parent-command-1',
    parentAttemptId: 'parent-attempt-1',
    now: () => new Date('2026-05-30T00:00:00.000Z'),
    runner: createReadOnlySubagentRunner(),
  });

  const structured = result.structuredContent;
  const publicText = JSON.stringify(result);

  assert.match(structured.agentId, /^reviewer-[a-f0-9]{12}$/);
  assert.equal(structured.status, 'completed');
  const transcriptRef = requirePublicSubagentRef(structured.transcriptRef, /^artifact:subagent-transcript-[a-f0-9]{12}$/);
  const resultRef = requirePublicSubagentRef(structured.resultRef, /^artifact:subagent-result-[a-f0-9]{12}$/);
  assert.deepEqual([...structured.refs].sort(), [resultRef, transcriptRef, `subagent:${structured.agentId}`, 'file:PROJECT.md'].sort());
  assert.match(structured.resultSummary, /sub-agent\/delegated-worker MCP tool surface/);
  assert.doesNotMatch(publicText, /\/Applications|\.sciforge|stdout|stderr|\braw\b|\blogs?\b|secret-token|trace:unsafe/i);
  assert.equal(result.content[0].text, JSON.stringify(structured, null, 2));

  const transcript = await readFile(join(transcriptRoot, `${structured.agentId}.json`), 'utf8');
  assert.match(transcript, /file:PROJECT\.md/);
  assert.doesNotMatch(transcript, /\/Applications|\.sciforge|stdout|stderr|\braw\b|\blogs?\b|secret-token|trace:unsafe/i);
});

test('spawn_agent returns expanded Agent Host-owned lifecycle projection metadata', async () => {
  const workspace = await tempWorkspace();
  const transcriptRoot = await mkdtemp(join(tmpdir(), 'sciforge-subagent-transcripts-'));
  await writeFile(join(workspace, 'PROJECT.md'), [
    '# Project',
    '- [ ] Remaining live parity TODO: expose safe sub-agent lifecycle refs.',
    '',
  ].join('\n'), 'utf8');
  await createSubagentRuntimeStore({ transcriptRoot }).writeRun(storedRun({
    agentId: 'resume-candidate',
    parentAgentId: 'parent-command-1',
    workspaceScope: testWorkspaceScope(workspace),
    agentType: 'review-worker',
    refs: ['subagent:resume-candidate'],
  }));

  const result = await callSubagentMcpTool(SUBAGENT_SPAWN_AGENT_TOOL_NAME, {
    message: [
      'Inspect PROJECT.md and report the single remaining sub-agent TODO.',
      'token=secret-token-123456',
      'providerUrl=https://provider.example/v1',
      'model=raw-private-model',
      'stdout stderr raw JSON /Applications/workspace/private',
    ].join(' '),
    agent_type: 'review-worker',
    refs: ['PROJECT.md'],
    resume_ref: 'subagent:resume-candidate',
  }, {
    workspace,
    transcriptRoot,
    parentCommandId: 'parent-command-1',
    parentAttemptId: 'parent-attempt-1',
    now: () => new Date('2026-06-04T00:00:00.000Z'),
    runner: createReadOnlySubagentRunner(),
  });

  const structured = result.structuredContent;
  const publicText = JSON.stringify(result);

  assert.equal(structured.ok, true);
  assert.match(structured.agentId, /^review-worker-[a-f0-9]{12}$/);
  assert.equal(structured.parentAgentId, 'parent-command-1');
  assert.equal(structured.agentType, 'review-worker');
  assert.equal(structured.status, 'completed');
  assert.equal(structured.startedAt, '2026-06-04T00:00:00.000Z');
  assert.equal(structured.completedAt, '2026-06-04T00:00:00.000Z');
  assert.equal(structured.durationMs, 0);
  assert.match(structured.resultSummary, /safe sub-agent lifecycle refs/);
  const resultRef = requirePublicSubagentRef(structured.resultRef, /^artifact:subagent-result-[a-f0-9]{12}$/);
  const transcriptRef = requirePublicSubagentRef(structured.transcriptRef, /^artifact:subagent-transcript-[a-f0-9]{12}$/);
  assert.deepEqual(structured.background, {
    runInBackground: false,
    stateRef: `subagent:${structured.agentId}`,
  });
  assert.deepEqual(structured.resume, {
    resumeRequested: true,
    resumeRef: 'subagent:resume-candidate',
    resumeBoundary: 'explicit',
  });
  assert.deepEqual([...structured.refs].sort(), [
    resultRef,
    transcriptRef,
    `subagent:${structured.agentId}`,
    'file:PROJECT.md',
  ].sort());
  assert.doesNotMatch(publicText, /secret-token|provider\.example|raw-private-model|stdout|stderr|\braw\b|JSON|\/Applications|\.sciforge/i);

  const transcript = JSON.parse(await readFile(join(transcriptRoot, `${structured.agentId}.json`), 'utf8')) as Record<string, unknown>;
  assert.equal(transcript.agentId, structured.agentId);
  assert.equal(transcript.parentAgentId, 'parent-command-1');
  assert.equal(transcript.agentType, 'review-worker');
  assert.equal(transcript.status, 'completed');
  assert.deepEqual(transcript.background, structured.background);
  assert.deepEqual(transcript.resume, structured.resume);
  assert.doesNotMatch(JSON.stringify(transcript), /secret-token|provider\.example|raw-private-model|stdout|stderr|\braw\b|JSON|\/Applications|\.sciforge/i);
});

test('spawn_agent run_in_background returns running state before child completion and updates the runtime store', async () => {
  const workspace = await tempWorkspace();
  const transcriptRoot = await mkdtemp(join(tmpdir(), 'sciforge-subagent-transcripts-'));
  const release = deferred<void>();
  let runnerStarted = false;

  const call = callSubagentMcpTool(SUBAGENT_SPAWN_AGENT_TOOL_NAME, {
    task: 'Run background verification.',
    agentId: 'worker-background',
    run_in_background: true,
  }, {
    workspace,
    transcriptRoot,
    parentCommandId: 'parent-command-background',
    now: sequenceClock([
      '2026-06-04T00:00:00.000Z',
      '2026-06-04T00:00:02.000Z',
    ]),
    runner: {
      async spawn(request) {
        runnerStarted = true;
        assert.equal(request.runInBackground, true);
        await release.promise;
        return {
          status: 'completed' as const,
          exitCode: 0,
          resultSummary: 'Background verification completed.',
          inspectedRefs: ['artifact:background-result'],
          readable: [],
        };
      },
    },
  });

  const initial = await Promise.race([
    call,
    delay(50).then(() => 'timed-out' as const),
  ]);
  if (initial === 'timed-out') assert.fail('background sub-agent call blocked on child completion');

  const structured = initial.structuredContent;
  assert.equal(structured.ok, true);
  assert.equal(structured.status, 'running');
  assert.equal(structured.agentId, 'worker-background');
  assert.equal(structured.parentAgentId, 'parent-command-background');
  assert.equal(structured.resultRef, undefined);
  assert.equal(structured.transcriptRef, undefined);
  assert.deepEqual(structured.refs, ['subagent:worker-background']);
  assert.deepEqual(structured.background, {
    runInBackground: true,
    stateRef: 'subagent:worker-background',
  });
  assert.equal(structured.completedAt, undefined);
  assert.equal(structured.durationMs, undefined);

  const runningRecord = await readStoredRun(transcriptRoot, 'worker-background');
  assert.equal(runningRecord.status, 'running');
  assert.equal(runningRecord.completedAt, undefined);
  assert.deepEqual(runningRecord.refs, ['subagent:worker-background']);
  assert.equal(runnerStarted, true);

  release.resolve();
  const completedRecord = await eventuallyReadRun(transcriptRoot, 'worker-background', (run) => run.status === 'completed');
  assert.equal(completedRecord.resultSummary, 'Background verification completed.');
  assert.match(completedRecord.resultRef ?? '', /^artifact:subagent-result-[a-f0-9]{12}$/);
  assert.match(completedRecord.transcriptRef ?? '', /^artifact:subagent-transcript-[a-f0-9]{12}$/);
  assert.deepEqual([...completedRecord.refs].sort(), [
    completedRecord.resultRef,
    completedRecord.transcriptRef,
    'subagent:worker-background',
    'artifact:background-result',
  ].sort());
  assert.equal(completedRecord.completedAt, '2026-06-04T00:00:02.000Z');
  assert.equal(completedRecord.durationMs, 2000);
});

test('spawn_agent passes parent approval policy into child runner requests', async () => {
  const workspace = await tempWorkspace();
  const transcriptRoot = await mkdtemp(join(tmpdir(), 'sciforge-subagent-transcripts-'));
  let observedApprovalPolicy: unknown;

  const result = await callSubagentMcpTool(SUBAGENT_SPAWN_AGENT_TOOL_NAME, {
    task: 'Run approval-boundary check.',
    agentId: 'worker-approval-boundary',
  }, {
    workspace,
    transcriptRoot,
    parentCommandId: 'parent-command-approval',
    approvalPolicy: 'on-request',
    sandbox: 'read-only',
    now: () => new Date('2026-06-04T00:00:00.000Z'),
    runner: {
      async spawn(request) {
        observedApprovalPolicy = request.approvalPolicy;
        assert.equal(request.sandbox, 'read-only');
        return {
          status: 'completed' as const,
          exitCode: 0,
          resultSummary: 'Approval boundary inherited.',
          inspectedRefs: [],
          readable: [],
        };
      },
    },
  });

  assert.equal(result.structuredContent.status, 'completed');
  assert.equal(observedApprovalPolicy, 'on-request');
});

test('spawn_agent fails closed when explicit resume boundary is not in the runtime store', async () => {
  const workspace = await tempWorkspace();
  const transcriptRoot = await mkdtemp(join(tmpdir(), 'sciforge-subagent-transcripts-'));
  let spawned = false;

  const result = await callSubagentMcpTool(SUBAGENT_SPAWN_AGENT_TOOL_NAME, {
    task: 'Resume missing worker.',
    resume_ref: 'subagent:missing-worker',
  }, {
    workspace,
    transcriptRoot,
    parentCommandId: 'parent-command-resume',
    now: () => new Date('2026-06-04T00:00:00.000Z'),
    runner: {
      async spawn() {
        spawned = true;
        return {
          status: 'completed' as const,
          exitCode: 0,
          resultSummary: 'should not run',
          inspectedRefs: [],
          readable: [],
        };
      },
    },
  });

  assert.equal(spawned, false);
  assert.equal(result.structuredContent.ok, false);
  assert.equal(result.structuredContent.status, 'blocked');
  assert.match(result.structuredContent.resultSummary, /resume boundary/i);
  assert.deepEqual(result.structuredContent.refs, []);
});

test('spawn_agent supports parallel child calls under one parent trace', async () => {
  const workspace = await tempWorkspace();
  const transcriptRoot = await mkdtemp(join(tmpdir(), 'sciforge-subagent-transcripts-'));
  let active = 0;
  let maxActive = 0;
  const runner = {
    async spawn(request: { prompt: string; refs: string[] }) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return {
        status: 'completed' as const,
        exitCode: 0,
        resultSummary: `Completed ${request.prompt}.`,
        inspectedRefs: request.refs,
        readable: [],
      };
    },
  };

  const [first, second] = await Promise.all([
    callSubagentMcpTool(SUBAGENT_SPAWN_AGENT_TOOL_NAME, { task: 'child one', refs: ['artifact:input-one'] }, {
      workspace,
      transcriptRoot,
      parentCommandId: 'parent-command-parallel',
      now: () => new Date('2026-06-04T00:00:00.000Z'),
      runner,
    }),
    callSubagentMcpTool(SUBAGENT_SPAWN_AGENT_TOOL_NAME, { task: 'child two', refs: ['artifact:input-two'] }, {
      workspace,
      transcriptRoot,
      parentCommandId: 'parent-command-parallel',
      now: () => new Date('2026-06-04T00:00:00.000Z'),
      runner,
    }),
  ]);

  assert.equal(maxActive, 2);
  assert.equal(first.structuredContent.parentAgentId, 'parent-command-parallel');
  assert.equal(second.structuredContent.parentAgentId, 'parent-command-parallel');
  assert.notEqual(first.structuredContent.agentId, second.structuredContent.agentId);
  assert.ok(first.structuredContent.refs.includes('artifact:input-one'));
  assert.ok(second.structuredContent.refs.includes('artifact:input-two'));
  assert.doesNotMatch(JSON.stringify([first, second]), /provider|api[-_ ]?key|token|stdout|stderr|\braw\b|\/Applications|\.sciforge/i);
});

test('spawn_agent allocates unique lifecycle refs for identical sibling calls', async () => {
  const workspace = await tempWorkspace();
  const transcriptRoot = await mkdtemp(join(tmpdir(), 'sciforge-subagent-transcripts-'));
  const runner = {
    async spawn() {
      return {
        status: 'completed' as const,
        exitCode: 0,
        resultSummary: 'Completed duplicate-safe child.',
        inspectedRefs: [],
        readable: [],
      };
    },
  };

  const [first, second] = await Promise.all([
    callSubagentMcpTool(SUBAGENT_SPAWN_AGENT_TOOL_NAME, { task: 'same child prompt' }, {
      workspace,
      transcriptRoot,
      parentCommandId: 'parent-command-duplicate',
      now: () => new Date('2026-06-04T00:00:00.000Z'),
      runner,
    }),
    callSubagentMcpTool(SUBAGENT_SPAWN_AGENT_TOOL_NAME, { task: 'same child prompt' }, {
      workspace,
      transcriptRoot,
      parentCommandId: 'parent-command-duplicate',
      now: () => new Date('2026-06-04T00:00:00.000Z'),
      runner,
    }),
  ]);

  assert.notEqual(first.structuredContent.agentId, second.structuredContent.agentId);
  assert.notEqual(first.structuredContent.resultRef, second.structuredContent.resultRef);
  assert.notEqual(first.structuredContent.transcriptRef, second.structuredContent.transcriptRef);
  assert.notEqual(first.structuredContent.background.stateRef, second.structuredContent.background.stateRef);
  const firstRecord = await readStoredRun(transcriptRoot, first.structuredContent.agentId);
  const secondRecord = await readStoredRun(transcriptRoot, second.structuredContent.agentId);
  assert.equal(firstRecord.agentId, first.structuredContent.agentId);
  assert.equal(secondRecord.agentId, second.structuredContent.agentId);
});

test('spawn_agent blocks explicit resume outside the current parent boundary', async () => {
  const workspace = await tempWorkspace();
  const transcriptRoot = await mkdtemp(join(tmpdir(), 'sciforge-subagent-transcripts-'));
  await createSubagentRuntimeStore({ transcriptRoot }).writeRun(storedRun({
    agentId: 'foreign-resume-candidate',
    parentAgentId: 'other-parent-command',
    workspaceScope: testWorkspaceScope(workspace),
    refs: ['subagent:foreign-resume-candidate'],
  }));
  let spawned = false;

  const result = await callSubagentMcpTool(SUBAGENT_SPAWN_AGENT_TOOL_NAME, {
    task: 'Try to resume a foreign child.',
    resume_ref: 'subagent:foreign-resume-candidate',
  }, {
    workspace,
    transcriptRoot,
    parentCommandId: 'current-parent-command',
    now: () => new Date('2026-06-04T00:00:00.000Z'),
    runner: {
      async spawn() {
        spawned = true;
        return {
          status: 'completed' as const,
          exitCode: 0,
          resultSummary: 'should not run',
          inspectedRefs: [],
          readable: [],
        };
      },
    },
  });

  assert.equal(spawned, false);
  assert.equal(result.structuredContent.ok, false);
  assert.equal(result.structuredContent.status, 'blocked');
  assert.match(result.structuredContent.resultSummary, /resume boundary/i);
});

test('spawn_agent blocks explicit resume outside the current workspace boundary', async () => {
  const workspace = await tempWorkspace();
  const transcriptRoot = await mkdtemp(join(tmpdir(), 'sciforge-subagent-transcripts-'));
  await createSubagentRuntimeStore({ transcriptRoot }).writeRun(storedRun({
    agentId: 'peer-workspace-resume-candidate',
    parentAgentId: 'shared-parent-command',
    workspaceScope: 'scope-peer-workspace',
    refs: ['subagent:peer-workspace-resume-candidate'],
  }));
  let spawned = false;

  const result = await callSubagentMcpTool(SUBAGENT_SPAWN_AGENT_TOOL_NAME, {
    task: 'Try to resume a child from a peer workspace.',
    resume_ref: 'subagent:peer-workspace-resume-candidate',
  }, {
    workspace,
    transcriptRoot,
    parentCommandId: 'shared-parent-command',
    now: () => new Date('2026-06-04T00:00:00.000Z'),
    runner: {
      async spawn() {
        spawned = true;
        return {
          status: 'completed' as const,
          exitCode: 0,
          resultSummary: 'should not run',
          inspectedRefs: [],
          readable: [],
        };
      },
    },
  });

  assert.equal(spawned, false);
  assert.equal(result.structuredContent.ok, false);
  assert.equal(result.structuredContent.status, 'blocked');
  assert.match(result.structuredContent.resultSummary, /resume boundary/i);
});

test('spawn_agent sanitizes unsafe runner summaries before public projection', async () => {
  const workspace = await tempWorkspace();
  const result = await callSubagentMcpTool(SUBAGENT_SPAWN_AGENT_TOOL_NAME, {
    task: 'Run child with unsafe summary.',
  }, {
    workspace,
    parentCommandId: 'parent-command-summary-safety',
    now: () => new Date('2026-06-04T00:00:00.000Z'),
    runner: {
      async spawn() {
        return {
          status: 'completed' as const,
          exitCode: 0,
          resultSummary: 'Provider https://provider.example/v1 returned sk-secret-123 from /Applications/private/raw.json stdout stderr raw JSON',
          inspectedRefs: [],
          readable: [],
        };
      },
    },
  });

  assert.equal(result.structuredContent.ok, true);
  assert.equal(result.structuredContent.status, 'completed');
  assert.doesNotMatch(JSON.stringify(result), /provider\.example|sk-secret|\/Applications|stdout|stderr|\braw\b|JSON/i);
});

test('spawn_agent fails closed when any requested ref is unsafe', async () => {
  const workspace = await tempWorkspace();
  const transcriptRoot = await mkdtemp(join(tmpdir(), 'sciforge-subagent-transcripts-'));

  const result = await callSubagentMcpTool(SUBAGENT_SPAWN_AGENT_TOOL_NAME, {
    task: 'Inspect PROJECT.md.',
    refs: ['PROJECT.md', '/Applications/workspace/ailab/research/app/SciForge/.sciforge/raw/input.json'],
  }, {
    workspace,
    transcriptRoot,
    parentCommandId: 'parent-command-unsafe',
    now: () => new Date('2026-06-04T00:00:00.000Z'),
  });

  const structured = result.structuredContent;

  assert.equal(structured.ok, false);
  assert.equal(structured.status, 'blocked');
  assert.match(structured.agentId, /^worker-[a-f0-9]{12}$/);
  assert.equal(structured.parentAgentId, 'parent-command-unsafe');
  assert.equal(structured.agentType, 'worker');
  assert.match(structured.resultSummary, /unsafe reference/i);
  assert.equal(structured.resultRef, undefined);
  assert.equal(structured.transcriptRef, undefined);
  assert.deepEqual(structured.refs, []);
  assert.doesNotMatch(JSON.stringify(result), /\/Applications|\.sciforge|input\.json|stdout|stderr|\braw\b/i);
});

test('spawn_agent fails closed when the runtime transcript store cannot be written', async () => {
  const workspace = await tempWorkspace();
  await writeFile(join(workspace, 'PROJECT.md'), '- [ ] safe sub-agent store TODO\n', 'utf8');
  const blockedTranscriptRoot = join(workspace, 'transcript-root-is-a-file');
  await writeFile(blockedTranscriptRoot, 'not a directory\n', 'utf8');

  const result = await callSubagentMcpTool(SUBAGENT_SPAWN_AGENT_TOOL_NAME, {
    task: 'Inspect PROJECT.md.',
    refs: ['PROJECT.md'],
  }, {
    workspace,
    transcriptRoot: blockedTranscriptRoot,
    parentCommandId: 'parent-command-store-failure',
    now: () => new Date('2026-06-04T00:00:00.000Z'),
    runner: createReadOnlySubagentRunner(),
  });

  const structured = result.structuredContent;

  assert.equal(structured.ok, false);
  assert.equal(structured.status, 'blocked');
  assert.equal(structured.parentAgentId, 'parent-command-store-failure');
  assert.match(structured.resultSummary, /transcript store unavailable/i);
  assert.equal(structured.resultRef, undefined);
  assert.equal(structured.transcriptRef, undefined);
  assert.deepEqual(structured.refs, []);
  assert.doesNotMatch(JSON.stringify(result), /transcript-root-is-a-file|\/Applications|stdout|stderr|\braw\b/i);
});

test('missing sub-agent tool fails closed with public blocker summary', async () => {
  const workspace = await tempWorkspace();

  const result = await callSubagentMcpTool('multi_agent_v1.missing_tool' as never, {
    task: 'Try unsupported delegated work.',
  }, {
    workspace,
    parentCommandId: 'parent-command-missing-tool',
    now: () => new Date('2026-06-04T00:00:00.000Z'),
  });

  const structured = result.structuredContent;

  assert.equal(structured.ok, false);
  assert.equal(structured.status, 'blocked');
  assert.equal(structured.parentAgentId, 'parent-command-missing-tool');
  assert.equal(structured.resultSummary, 'NO_SUBAGENT_TOOL_AVAILABLE: The requested sub-agent tool is not available in this runtime.');
  assert.deepEqual(structured.refs, []);
  assert.doesNotMatch(JSON.stringify(result), /provider|api[-_ ]?key|token|stdout|stderr|\braw\b|\/Applications|\.sciforge/i);
});

test('spawn_agent accepts missing refs and still returns safe lifecycle refs', async () => {
  const workspace = await tempWorkspace();

  const result = await callSubagentMcpTool(SUBAGENT_SPAWN_AGENT_TOOL_NAME, {
    task: 'Summarize the unavailable worker context.',
    agentId: '/tmp/unsafe-agent',
  }, {
    workspace,
    now: () => new Date('2026-05-30T00:00:00.000Z'),
    runner: createReadOnlySubagentRunner(),
  });

  const structured = result.structuredContent;

  assert.equal(structured.status, 'completed');
  assert.match(structured.agentId, /^worker-[a-f0-9]{12}$/);
  assert.match(structured.resultSummary, /Read-only delegated worker completed/);
  assert.deepEqual(structured.refs, [structured.resultRef, structured.transcriptRef, `subagent:${structured.agentId}`]);
  assert.doesNotMatch(JSON.stringify(result), /\/tmp|\.sciforge|stdout|stderr|\braw\b|\blogs?\b|secret/i);
});

async function tempWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-subagent-tool-'));
  await mkdir(dir, { recursive: true });
  return dir;
}

function requirePublicSubagentRef(value: string | undefined, pattern: RegExp): string {
  if (typeof value !== 'string') assert.fail('Expected public sub-agent ref');
  assert.match(value, pattern);
  return value;
}

function storedRun(overrides: Partial<StoredSubagentRun> & Pick<StoredSubagentRun, 'agentId'>): StoredSubagentRun {
  return {
    schemaVersion: 'sciforge.runtime-codex.subagent-run.v1',
    agentId: overrides.agentId,
    parentAgentId: overrides.parentAgentId ?? 'parent-command-1',
    workspaceScope: overrides.workspaceScope ?? 'scope-test-workspace',
    agentType: overrides.agentType ?? 'worker',
    status: overrides.status ?? 'completed',
    resultSummary: overrides.resultSummary ?? 'Completed safe sub-agent task.',
    resultRef: overrides.resultRef ?? `artifact:subagent-result-${overrides.agentId}`,
    transcriptRef: overrides.transcriptRef ?? `artifact:subagent-transcript-${overrides.agentId}`,
    refs: overrides.refs ?? [`subagent:${overrides.agentId}`],
    startedAt: overrides.startedAt ?? '2026-06-04T00:00:00.000Z',
    completedAt: overrides.completedAt ?? '2026-06-04T00:00:00.000Z',
    durationMs: overrides.durationMs ?? 0,
    background: overrides.background ?? {
      runInBackground: false,
      stateRef: `subagent:${overrides.agentId}`,
    },
    resume: overrides.resume ?? {
      resumeRequested: false,
      resumeBoundary: 'none',
    },
    inspectedRefs: overrides.inspectedRefs ?? [],
    promptDigest: overrides.promptDigest ?? 'digest-only',
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sequenceClock(values: string[]): () => Date {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)] ?? values.at(-1) ?? '2026-06-04T00:00:00.000Z');
}

function testWorkspaceScope(workspace: string): string {
  return `scope-${createHash('sha256').update(workspace).digest('hex').slice(0, 16)}`;
}

async function readStoredRun(transcriptRoot: string, agentId: string): Promise<StoredSubagentRun> {
  return JSON.parse(await readFile(join(transcriptRoot, `${agentId}.json`), 'utf8')) as StoredSubagentRun;
}

async function eventuallyReadRun(
  transcriptRoot: string,
  agentId: string,
  predicate: (run: StoredSubagentRun) => boolean,
): Promise<StoredSubagentRun> {
  const deadline = Date.now() + 1000;
  let lastRun: StoredSubagentRun | undefined;
  while (Date.now() < deadline) {
    lastRun = await readStoredRun(transcriptRoot, agentId);
    if (predicate(lastRun)) return lastRun;
    await delay(10);
  }
  assert.fail(`Stored sub-agent run did not reach expected state: ${JSON.stringify(lastRun)}`);
}
