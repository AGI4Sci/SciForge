import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { normalizeBackendHandoff } from './workspace-task-input';

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
    assert.ok(result.decisions.some((decision) => decision.kind === 'backend-handoff-envelope'));
    assert.notEqual(payload.kind, 'backend-handoff');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
