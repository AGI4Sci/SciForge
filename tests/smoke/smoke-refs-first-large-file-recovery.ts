import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildContextEnvelope } from '../../src/runtime/gateway/context-envelope.js';
import { normalizeBackendHandoff } from '../../src/runtime/workspace-task-input.js';
import type { GatewayRequest } from '../../src/runtime/runtime-types.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-refs-first-recovery-'));

try {
  const largeLog = [
    'SMOKE_LARGE_LOG_HEAD',
    'large log row '.repeat(16_000),
    'SMOKE_LARGE_LOG_TAIL',
  ].join('\n');
  const handoff = await normalizeBackendHandoff({
    stdoutRef: '.sciforge/logs/failed-run.stdout.log',
    stdout: largeLog,
    artifact: {
      id: 'report-after-compaction',
      type: 'research-report',
      dataRef: '.sciforge/artifacts/report-after-compaction.md',
      markdown: [
        'SMOKE_LARGE_DOC_HEAD',
        'large report body '.repeat(16_000),
        'SMOKE_LARGE_DOC_TAIL',
      ].join('\n'),
    },
  }, {
    workspacePath: workspace,
    purpose: 'refs-first-large-file-recovery-smoke',
    budget: {
      maxPayloadBytes: 20_000,
      maxInlineStringChars: 1500,
      maxInlineJsonBytes: 5000,
      maxArrayItems: 4,
      maxObjectKeys: 16,
      maxDepth: 5,
      headChars: 500,
      tailChars: 500,
    },
  });

  const handoffJson = JSON.stringify(handoff.payload);
  assert.doesNotMatch(handoffJson, /SMOKE_LARGE_LOG_HEAD|SMOKE_LARGE_LOG_TAIL|SMOKE_LARGE_DOC_HEAD|SMOKE_LARGE_DOC_TAIL/);
  assert.match(handoffJson, /failed-run\.stdout\.log/);
  assert.match(handoffJson, /report-after-compaction\.md/);

  const envelope = buildContextEnvelope({
    skillDomain: 'knowledge',
    prompt: '继续压缩后的任务，引用上一轮 report artifact 和 failed run。',
    artifacts: [],
    uiState: {
      stateDigest: {
        schemaVersion: 'sciforge.conversation.state-digest.v1',
        taskId: 'refs-first-smoke',
        relation: 'follow-up',
        summary: 'History was compacted; durable refs remain authoritative.',
        handoffPolicy: 'digest-and-refs-only',
        stateRefs: ['run:failed-run', '.sciforge/task-results/failed-run.json'],
        completedRefs: ['artifact:report-after-compaction'],
        carryForwardRefs: ['.sciforge/artifacts/report-after-compaction.md'],
      },
    },
  } as GatewayRequest, { workspace });

  assert.deepEqual(envelope.longTermRefs.stateDigestRefs, [
    'run:failed-run',
    '.sciforge/task-results/failed-run.json',
    'artifact:report-after-compaction',
    '.sciforge/artifacts/report-after-compaction.md',
  ]);
  assert.match(JSON.stringify(envelope.startupContextEnvelope.alwaysOnFacts), /report-after-compaction\.md/);
  assert.match(JSON.stringify(envelope.startupContextEnvelope.alwaysOnFacts), /run:failed-run/);
} finally {
  await rm(workspace, { recursive: true, force: true });
}

console.log('[ok] refs-first large-file summaries preserve recovery refs after compaction');
