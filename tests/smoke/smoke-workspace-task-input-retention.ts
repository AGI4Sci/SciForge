import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneTaskInputRetention } from '../../src/runtime/workspace-retention.js';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-task-input-retention-'));
const inputDir = join(workspace, '.bioagent', 'task-inputs');
await mkdir(inputDir, { recursive: true });

const baseSeconds = Math.floor(Date.now() / 1000) - 1000;
for (let index = 0; index < 5; index += 1) {
  const path = join(inputDir, `input-${index}.json`);
  await writeFile(path, JSON.stringify({ index, payload: 'x'.repeat(100) }));
  await utimes(path, baseSeconds + index, baseSeconds + index);
}

const byCount = await pruneTaskInputRetention(workspace, {
  maxFiles: 3,
  maxBytes: 1_000_000,
  protectedRels: ['.bioagent/task-inputs/input-0.json'],
});
assert.equal(byCount.deletedFiles, 2);
assert.deepEqual((await readdir(inputDir)).sort(), [
  'input-0.json',
  'input-3.json',
  'input-4.json',
]);

await writeFile(join(inputDir, 'large-old.json'), 'x'.repeat(700));
await utimes(join(inputDir, 'large-old.json'), baseSeconds - 10, baseSeconds - 10);
await writeFile(join(inputDir, 'large-new.json'), 'x'.repeat(700));
await utimes(join(inputDir, 'large-new.json'), baseSeconds + 10, baseSeconds + 10);

const byBytes = await pruneTaskInputRetention(workspace, {
  maxFiles: 10,
  maxBytes: 900,
  protectedRels: ['.bioagent/task-inputs/input-0.json'],
});
assert.ok(byBytes.deletedFiles >= 1);
const remaining = (await readdir(inputDir)).sort();
assert.ok(remaining.includes('input-0.json'));
assert.ok(remaining.includes('large-new.json'));
assert.ok(!remaining.includes('large-old.json'));

const originalCwd = process.cwd();
const originalMaxFiles = process.env.BIOAGENT_TASK_INPUT_MAX_FILES;
const originalMaxBytes = process.env.BIOAGENT_TASK_INPUT_MAX_BYTES;
try {
  delete process.env.BIOAGENT_TASK_INPUT_MAX_FILES;
  delete process.env.BIOAGENT_TASK_INPUT_MAX_BYTES;
  const configRoot = await mkdtemp(join(tmpdir(), 'bioagent-retention-config-'));
  process.chdir(configRoot);
  await writeFile(join(configRoot, 'config.local.json'), JSON.stringify({
    bioagent: { taskInputRetention: { maxFiles: 2, maxBytes: 1_000_000 } },
  }, null, 2));
  const configuredWorkspace = await mkdtemp(join(tmpdir(), 'bioagent-task-input-configured-'));
  const configuredInputDir = join(configuredWorkspace, '.bioagent', 'task-inputs');
  await mkdir(configuredInputDir, { recursive: true });
  for (let index = 0; index < 4; index += 1) {
    const path = join(configuredInputDir, `configured-${index}.json`);
    await writeFile(path, JSON.stringify({ index }));
    await utimes(path, baseSeconds + index, baseSeconds + index);
  }
  await pruneTaskInputRetention(configuredWorkspace);
  assert.deepEqual((await readdir(configuredInputDir)).sort(), [
    'configured-2.json',
    'configured-3.json',
  ]);
} finally {
  process.chdir(originalCwd);
  if (originalMaxFiles === undefined) delete process.env.BIOAGENT_TASK_INPUT_MAX_FILES;
  else process.env.BIOAGENT_TASK_INPUT_MAX_FILES = originalMaxFiles;
  if (originalMaxBytes === undefined) delete process.env.BIOAGENT_TASK_INPUT_MAX_BYTES;
  else process.env.BIOAGENT_TASK_INPUT_MAX_BYTES = originalMaxBytes;
}

console.log('[ok] workspace task input retention prunes old files while preserving protected inputs');
