import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRuntimeModuleDispatcher, createRuntimeModuleRegistry } from './dispatcher.js';
import { createAutomationsModuleHandler } from './automations-module-handler.js';

test('automations module query/read/invoke persists records through approval-gated intents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-automations-module-'));
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    automations: createAutomationsModuleHandler({
      workspacePath: root,
      now: () => new Date('2026-06-01T09:00:00.000Z'),
    }),
  }));
  try {
    const empty = await dispatcher.query({ moduleId: 'automations', query: 'list' });
    assert.equal(empty.ok, true);
    assert.equal((empty.value as { total?: number }).total, 0);

    const blocked = await dispatcher.invoke({
      moduleId: 'automations',
      intent: 'create',
      input: { name: 'Daily paper scan' },
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.approvalRequest?.intent, 'create');

    const created = await dispatcher.invoke({
      moduleId: 'automations',
      intent: 'create',
      approvalToken: 'approved-test-token',
      input: {
        id: 'daily-paper-scan',
        name: 'Daily paper scan',
        repositoryRef: 'workspace:current',
        repositoryLabel: 'SciForge',
        trigger: { type: 'schedule', schedule: 'Daily at 09:00' },
        instructions: 'Collect papers without exposing /tmp/private or token=abc123.',
        tools: ['Search', 'Report'],
      },
    });
    assert.equal(created.ok, true);
    assert.equal(created.operationRef, 'automations:operation:create:daily-paper-scan');
    assert.ok(created.refs?.includes('automation:daily-paper-scan'));
    assert.doesNotMatch(JSON.stringify(created), /\/tmp\/private|abc123/);

    const read = await dispatcher.read({ ref: 'automation:daily-paper-scan' });
    assert.equal(read.ok, true);
    assert.equal((read.value as { name?: string }).name, 'Daily paper scan');

    const updated = await dispatcher.invoke({
      moduleId: 'automations',
      intent: 'set-enabled',
      approvalToken: 'approved-test-token',
      input: { ref: 'automation:daily-paper-scan', enabled: false },
    });
    assert.equal(updated.ok, true);
    assert.equal((updated.value as { status?: string }).status, 'paused');

    const storeText = await readFile(join(root, '.sciforge', 'automations.json'), 'utf8');
    assert.match(storeText, /Daily paper scan/);
    assert.doesNotMatch(storeText, /\/tmp\/private|abc123/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

