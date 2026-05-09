import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { workspaceTaskPythonCommandCandidates } from '../../packages/skills/runtime-policy';
import { runWorkspaceTask } from './workspace-task-runner.js';

test('workspace task runner delegates Python runtime candidate policy to skills package', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-python-runtime-policy-'));
  const pythonPath = workspaceTaskPythonCommandCandidates(workspace)[1];
  await mkdir(dirname(pythonPath), { recursive: true });
  await writeFile(pythonPath, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then',
    '  printf "Python 3.11.0\\n"',
    '  exit 0',
    'fi',
    'exec python3 "$@"',
  ].join('\n'), 'utf8');
  await chmod(pythonPath, 0o755);

  const taskRel = '.sciforge/tasks/python-runtime-policy.py';
  await mkdir(join(workspace, '.sciforge', 'tasks'), { recursive: true });
  await writeFile(join(workspace, taskRel), [
    'import json, sys',
    'output_path = sys.argv[2]',
    'with open(output_path, "w", encoding="utf-8") as f:',
    '    json.dump({"message": "ok"}, f)',
  ].join('\n'), 'utf8');

  const run = await runWorkspaceTask(workspace, {
    id: 'python-runtime-policy',
    language: 'python',
    entrypoint: 'main',
    taskRel,
    input: {},
    outputRel: '.sciforge/task-results/python-runtime-policy.json',
    stdoutRel: '.sciforge/logs/python-runtime-policy.stdout.log',
    stderrRel: '.sciforge/logs/python-runtime-policy.stderr.log',
  });

  assert.equal(run.exitCode, 0);
  assert.equal(run.command, pythonPath);
  assert.deepEqual(JSON.parse(await readFile(join(workspace, run.outputRef), 'utf8')), {
    message: 'ok',
  });
});
