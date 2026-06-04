import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createSubagentRuntimeStore,
  type StoredSubagentRun,
} from './subagent-runtime-store.js';

test('runtime sub-agent store writes bounded transcript records and result summaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-subagent-store-'));
  const store = createSubagentRuntimeStore({ transcriptRoot: root });
  const run: StoredSubagentRun = {
    schemaVersion: 'sciforge.runtime-codex.subagent-run.v1',
    agentId: 'worker-abc123',
    parentAgentId: 'parent-command-1',
    workspaceScope: 'scope-test-workspace',
    agentType: 'worker',
    status: 'completed',
    resultSummary: 'Completed safe sub-agent task.',
    resultRef: 'artifact:subagent-result-abc123',
    transcriptRef: 'artifact:subagent-transcript-abc123',
    refs: ['artifact:subagent-result-abc123', 'artifact:subagent-transcript-abc123', 'subagent:worker-abc123'],
    startedAt: '2026-06-04T00:00:00.000Z',
    completedAt: '2026-06-04T00:00:00.000Z',
    durationMs: 0,
    background: {
      runInBackground: false,
      stateRef: 'subagent:worker-abc123',
    },
    resume: {
      resumeRequested: false,
      resumeBoundary: 'none',
    },
    inspectedRefs: ['file:PROJECT.md'],
    promptDigest: 'digest-only',
  };

  await store.writeRun(run);

  const transcript = JSON.parse(await readFile(join(root, 'worker-abc123.json'), 'utf8')) as StoredSubagentRun;
  assert.deepEqual(transcript, run);
});

test('runtime sub-agent store rejects unsafe refs and local path leakage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-subagent-store-'));
  const store = createSubagentRuntimeStore({ transcriptRoot: root });

  await assert.rejects(
    () => store.writeRun({
      schemaVersion: 'sciforge.runtime-codex.subagent-run.v1',
      agentId: 'worker-abc123',
      parentAgentId: 'parent-command-1',
      workspaceScope: 'scope-test-workspace',
      agentType: 'worker',
      status: 'completed',
      resultSummary: 'Completed task at /Applications/workspace/private.',
      resultRef: 'artifact:subagent-result-abc123',
      transcriptRef: 'artifact:subagent-transcript-abc123',
      refs: ['artifact:subagent-result-abc123', 'trace:unsafe'],
      startedAt: '2026-06-04T00:00:00.000Z',
      completedAt: '2026-06-04T00:00:00.000Z',
      durationMs: 0,
      background: {
        runInBackground: false,
        stateRef: 'subagent:worker-abc123',
      },
      resume: {
        resumeRequested: false,
        resumeBoundary: 'none',
      },
      inspectedRefs: [],
      promptDigest: 'digest-only',
    }),
    /unsafe sub-agent store record/i,
  );
});

test('runtime sub-agent store reports write failures instead of best-effort success', async () => {
  const rootParent = await mkdtemp(join(tmpdir(), 'sciforge-subagent-store-parent-'));
  const root = join(rootParent, 'not-a-directory');
  await mkdir(rootParent, { recursive: true });
  await import('node:fs/promises').then(({ writeFile }) => writeFile(root, 'file blocks transcript directory\n', 'utf8'));
  const store = createSubagentRuntimeStore({ transcriptRoot: root });

  await assert.rejects(
    () => store.writeRun({
      schemaVersion: 'sciforge.runtime-codex.subagent-run.v1',
      agentId: 'worker-abc123',
      parentAgentId: 'parent-command-1',
      workspaceScope: 'scope-test-workspace',
      agentType: 'worker',
      status: 'completed',
      resultSummary: 'Completed safe sub-agent task.',
      resultRef: 'artifact:subagent-result-abc123',
      transcriptRef: 'artifact:subagent-transcript-abc123',
      refs: ['artifact:subagent-result-abc123', 'artifact:subagent-transcript-abc123'],
      startedAt: '2026-06-04T00:00:00.000Z',
      completedAt: '2026-06-04T00:00:00.000Z',
      durationMs: 0,
      background: {
        runInBackground: false,
        stateRef: 'subagent:worker-abc123',
      },
      resume: {
        resumeRequested: false,
        resumeBoundary: 'none',
      },
      inspectedRefs: [],
      promptDigest: 'digest-only',
    }),
    /transcript store unavailable/i,
  );
});
