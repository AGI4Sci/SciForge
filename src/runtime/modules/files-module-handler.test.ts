import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import type { ModuleDescription } from '@sciforge-ui/runtime-contract/modules';
import { createRuntimeModuleDispatcher, createRuntimeModuleRegistry } from './dispatcher.js';
import { createFilesModuleHandler, type FilesModuleFile } from './files-module-handler.js';

test('files module describes workspace-contained resources and approval-gated write intent', async () => {
  const handler = createFilesModuleHandler({ workspacePath: await mkdtemp(join(tmpdir(), 'sciforge-files-module-')) });

  const description = handler.describe() as ModuleDescription;

  assert.equal(description.moduleId, 'files');
  assert.equal(description.functions.query, true);
  assert.equal(description.functions.read, true);
  assert.equal(description.functions.invoke, true);
  assert.ok(description.resources?.some((resource) => resource.refPrefix === 'workspace:'));
  assert.ok(description.resources?.some((resource) => resource.refPrefix === 'folder:'));
  assert.ok(description.resources?.some((resource) => resource.refPrefix === 'file:'));
  assert.equal(description.intents?.find((intent) => intent.name === 'write')?.requiresApproval, true);
  assert.equal(description.intents?.find((intent) => intent.name === 'write')?.sideEffect, 'workspace');
});

test('files module query/read routes through dispatcher and records refs-first trace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-files-module-'));
  await writeFile(join(root, 'README.md'), '# Hello\n', 'utf8');
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    files: createFilesModuleHandler({ workspacePath: root }),
  }));

  const query = await dispatcher.query({ moduleId: 'files', query: 'tree', scope: 'workspace:.' });
  const read = await dispatcher.read({ ref: 'file:README.md' });

  assert.equal(query.ok, true);
  assert.equal(query.moduleId, 'files');
  assert.ok(query.refs?.includes('workspace:.'));
  assert.ok(query.refs?.includes('file:README.md'));
  assert.equal(read.ok, true);
  assert.equal((read.value as FilesModuleFile).content, '# Hello\n');
  assert.deepEqual(dispatcher.trace().map((step) => step.functionName), ['query', 'read']);
  assert.equal(dispatcher.trace()[0]?.moduleId, 'files');
  assert.equal(dispatcher.trace()[1]?.refs?.[0], 'file:README.md');

  await rm(root, { recursive: true, force: true });
});

test('files module invokes explicit approved write and rejects unapproved or out-of-workspace writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-files-module-'));
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    files: createFilesModuleHandler({ workspacePath: root }),
  }));

  const approval = await dispatcher.invoke({
    moduleId: 'files',
    intent: 'write',
    input: { ref: 'file:notes.txt', content: 'draft\n' },
  });
  assert.equal(approval.ok, false);
  assert.equal(approval.approvalRequest?.moduleId, 'files');
  assert.equal(approval.approvalRequest?.intent, 'write');

  const saved = await dispatcher.invoke({
    moduleId: 'files',
    intent: 'write',
    approvalToken: 'approved-test-token',
    input: { ref: 'file:notes.txt', content: 'draft\n' },
  });
  assert.equal(saved.ok, true);
  assert.equal(await readFile(join(root, 'notes.txt'), 'utf8'), 'draft\n');
  assert.match(saved.operationRef ?? '', /^files:operation:write:notes\.txt$/);
  assert.deepEqual(saved.refs, ['file:notes.txt']);

  const outside = await dispatcher.invoke({
    moduleId: 'files',
    intent: 'write',
    approvalToken: 'approved-test-token',
    input: { ref: 'file:../escape.txt', content: 'nope' },
  });
  assert.equal(outside.ok, false);
  assert.match(outside.error ?? '', /outside the active workspace/);

  await rm(root, { recursive: true, force: true });
});

test('files module redacts local paths and secrets from dispatcher trace failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-files-module-'));
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    files: createFilesModuleHandler({ workspacePath: root }),
  }));

  const result = await dispatcher.read({ ref: 'file:/Users/alice/private/token.txt?token=abc123' });

  assert.equal(result.ok, false);
  const traceText = JSON.stringify(dispatcher.trace());
  assert.doesNotMatch(traceText, /\/Users\/alice|abc123/);
  assert.match(traceText, /\[redacted/);

  await rm(root, { recursive: true, force: true });
});
