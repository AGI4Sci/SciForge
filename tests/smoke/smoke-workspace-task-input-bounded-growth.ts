import assert from 'node:assert/strict';
import { mkdtemp, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkspaceTask } from '../../src/runtime/workspace-task-runner.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-input-growth-'));
const scriptPath = join(workspace, 'noop.sh');
await writeFile(scriptPath, [
  '#!/bin/sh',
  'INPUT="$1"',
  'OUTPUT="$2"',
  'printf \'{"message":"ok","inputBytes":\' > "$OUTPUT"',
  'wc -c < "$INPUT" | tr -d " " >> "$OUTPUT"',
  'printf \'}\' >> "$OUTPUT"',
].join('\n'));

const previousMaxFiles = process.env.SCIFORGE_TASK_INPUT_MAX_FILES;
const previousMaxBytes = process.env.SCIFORGE_TASK_INPUT_MAX_BYTES;
try {
  process.env.SCIFORGE_TASK_INPUT_MAX_FILES = '5';
  process.env.SCIFORGE_TASK_INPUT_MAX_BYTES = '200000';
  const largeData = 'X'.repeat(1024 * 1024);
  for (let index = 0; index < 20; index += 1) {
    const id = `bounded-${index}`;
    await runWorkspaceTask(workspace, {
      id,
      language: 'shell',
      entrypoint: 'main',
      codeTemplatePath: scriptPath,
      input: {
        prompt: `bounded run ${index}`,
        artifacts: [{
          id: `artifact-${index}`,
          type: 'research-report',
          dataRef: `.sciforge/artifacts/artifact-${index}.json`,
          data: { markdown: largeData },
        }],
      },
      outputRel: `.sciforge/task-results/${id}.json`,
      stdoutRel: `.sciforge/logs/${id}.stdout.log`,
      stderrRel: `.sciforge/logs/${id}.stderr.log`,
    });
  }
} finally {
  if (previousMaxFiles === undefined) delete process.env.SCIFORGE_TASK_INPUT_MAX_FILES;
  else process.env.SCIFORGE_TASK_INPUT_MAX_FILES = previousMaxFiles;
  if (previousMaxBytes === undefined) delete process.env.SCIFORGE_TASK_INPUT_MAX_BYTES;
  else process.env.SCIFORGE_TASK_INPUT_MAX_BYTES = previousMaxBytes;
}

const inputDir = join(workspace, '.sciforge', 'task-inputs');
const entries = await readdir(inputDir, { withFileTypes: true });
const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
const sizes = await Promise.all(files.map(async (file) => (await stat(join(inputDir, file))).size));
const totalBytes = sizes.reduce((sum, size) => sum + size, 0);

assert.ok(files.length <= 5, `expected <=5 retained task inputs, got ${files.length}`);
assert.ok(totalBytes < 200000, `expected retained task inputs below budget, got ${totalBytes}`);

console.log('[ok] task input compaction and retention keep 20 generated runs bounded');
