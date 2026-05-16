import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { normalizeBackendHandoff, normalizeCanonicalHandoffValue } from './workspace-task-input';

test('backend handoff slimming preserves AgentServer input.text contract under tight budgets', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-backend-handoff-'));
  try {
    const result = await normalizeBackendHandoff({
      agent: {
        id: 'agent-1',
        backend: 'codex',
        systemPrompt: 'Generate a task.',
      },
      input: {
        text: 'CURRENT TURN\n'.repeat(8000),
        metadata: {
          project: 'SciForge',
          huge: Array.from({ length: 200 }, (_, index) => ({
            index,
            text: 'metadata '.repeat(200),
          })),
        },
      },
      contextPolicy: { includeCurrentWork: false },
      runtime: {
        backend: 'codex',
        metadata: {
          nested: Array.from({ length: 100 }, () => 'runtime '.repeat(200)),
        },
      },
      metadata: {
        huge: Array.from({ length: 100 }, () => 'top '.repeat(200)),
      },
    }, {
      workspacePath: workspace,
      purpose: 'agentserver-generation-test',
      budget: {
        maxPayloadBytes: 24_000,
        maxInlineStringChars: 3000,
        maxInlineJsonBytes: 6000,
        maxArrayItems: 4,
        maxObjectKeys: 16,
        maxDepth: 4,
        headChars: 500,
        tailChars: 500,
      },
    });

    const payload = result.payload as Record<string, unknown>;
    const input = payload.input as Record<string, unknown> | undefined;
    assert.ok(input);
    assert.equal(typeof input.text, 'string');
    assert.match(input.text as string, /SciForge compacted backend input\.text/);
    assert.ok(result.decisions.some((decision) => decision.kind === 'backend-input-text'));
    assert.notEqual(payload.kind, 'backend-handoff');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('backend handoff slimming keeps ref-backed large logs and documents summary-only', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-backend-handoff-large-text-'));
  try {
    const largeLog = [
      'LOG_SENTINEL_HEAD',
      'row '.repeat(12_000),
      'LOG_SENTINEL_TAIL',
    ].join('\n');
    const largeMarkdown = [
      'DOC_SENTINEL_HEAD',
      'evidence '.repeat(12_000),
      'DOC_SENTINEL_TAIL',
    ].join('\n');
    const result = await normalizeBackendHandoff({
      refs: {
        stdoutRef: '.sciforge/logs/run.stdout.log',
        stderrRef: '.sciforge/logs/run.stderr.log',
        dataRef: '.sciforge/artifacts/report.md',
      },
      stdoutRef: '.sciforge/logs/run.stdout.log',
      stdout: largeLog,
      artifact: {
        id: 'report',
        type: 'research-report',
        dataRef: '.sciforge/artifacts/report.md',
        markdown: largeMarkdown,
      },
    }, {
      workspacePath: workspace,
      purpose: 'large-text-summary-only-test',
      budget: {
        maxPayloadBytes: 24_000,
        maxInlineStringChars: 2000,
        maxInlineJsonBytes: 6000,
        maxArrayItems: 4,
        maxObjectKeys: 16,
        maxDepth: 5,
        headChars: 500,
        tailChars: 500,
      },
    });

    const serialized = JSON.stringify(result.payload);
    assert.doesNotMatch(serialized, /LOG_SENTINEL_HEAD|LOG_SENTINEL_TAIL|DOC_SENTINEL_HEAD|DOC_SENTINEL_TAIL/);
    assert.match(serialized, /run\.stdout\.log/);
    assert.match(serialized, /report\.md/);
    assert.ok(result.decisions.some((decision) => decision.kind === 'tool-output'));
    assert.ok(result.decisions.some((decision) => decision.kind === 'ref-backed-large-text'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('canonical handoff normalizer removes forbidden carriers and deduplicates arrays', () => {
  const normalized = normalizeCanonicalHandoffValue({
    refs: [
      { ref: 'artifact:a', digest: 'sha256:a' },
      { ref: 'artifact:a', digest: 'sha256:a' },
      { ref: 'artifact:b', digest: 'sha256:b', rawBody: 'RAW_BODY' },
    ],
    recentTurns: [{ role: 'assistant', content: 'RAW_TURN' }],
    nested: {
      fullRefList: ['artifact:all'],
      items: [
        { id: 'same', value: 1 },
        { id: 'same', value: 1 },
      ],
    },
  }) as Record<string, unknown>;

  const serialized = JSON.stringify(normalized);
  assert.doesNotMatch(serialized, /recentTurns|fullRefList|rawBody|RAW_TURN|RAW_BODY/);
  assert.equal((normalized.refs as unknown[]).length, 2);
  assert.equal(((normalized.nested as Record<string, unknown>).items as unknown[]).length, 1);
});
