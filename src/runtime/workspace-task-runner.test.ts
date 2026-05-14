import assert from 'node:assert/strict';
import test from 'node:test';
import { access, chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
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

test('workspace task runner can persist task input inside a session bundle', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-session-task-input-'));
  const taskRel = '.sciforge/sessions/2026-05-11_demo_session-1/tasks/run.py';
  await mkdir(dirname(join(workspace, taskRel)), { recursive: true });
  await writeFile(join(workspace, taskRel), [
    'import json, sys',
    'input_path, output_path = sys.argv[1], sys.argv[2]',
    'with open(input_path, "r", encoding="utf-8") as f:',
    '    data = json.load(f)',
    'with open(output_path, "w", encoding="utf-8") as f:',
    '    json.dump({"inputRef": data["inputRef"], "sessionRootEnv": __import__("os").environ.get("SCIFORGE_SESSION_RESOURCE_ROOT")}, f)',
  ].join('\n'), 'utf8');

  const run = await runWorkspaceTask(workspace, {
    id: 'session-task-input',
    language: 'python',
    entrypoint: 'main',
    taskRel,
    inputRel: '.sciforge/sessions/2026-05-11_demo_session-1/task-inputs/session-task-input.json',
    input: {},
    outputRel: '.sciforge/sessions/2026-05-11_demo_session-1/task-results/session-task-input.json',
    stdoutRel: '.sciforge/sessions/2026-05-11_demo_session-1/logs/session-task-input.stdout.log',
    stderrRel: '.sciforge/sessions/2026-05-11_demo_session-1/logs/session-task-input.stderr.log',
  });

  assert.equal(run.exitCode, 0);
  assert.deepEqual(JSON.parse(await readFile(join(workspace, run.outputRef), 'utf8')), {
    inputRef: '.sciforge/sessions/2026-05-11_demo_session-1/task-inputs/session-task-input.json',
    sessionRootEnv: join(workspace, '.sciforge/sessions/2026-05-11_demo_session-1'),
  });
  const taskInput = JSON.parse(await readFile(join(workspace, '.sciforge/sessions/2026-05-11_demo_session-1/task-inputs/session-task-input.json'), 'utf8'));
  assert.equal(taskInput.sessionBundleRef, '.sciforge/sessions/2026-05-11_demo_session-1');
  assert.equal(taskInput.workspaceRootPath, workspace);
  assert.equal(taskInput.sessionResourceRootPath, join(workspace, '.sciforge/sessions/2026-05-11_demo_session-1'));
});

test('workspace task runner resolves bare entrypoint path placeholders from generated task responses', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-bare-entrypoint-placeholders-'));
  const taskRel = '.sciforge/sessions/2026-05-11_demo_session-2/tasks/run.py';
  await mkdir(dirname(join(workspace, taskRel)), { recursive: true });
  await writeFile(join(workspace, taskRel), [
    'import json, sys',
    'input_path, output_path = sys.argv[1], sys.argv[2]',
    'with open(output_path, "w", encoding="utf-8") as f:',
    '    json.dump({"inputArg": input_path.endswith("task-input.json"), "outputArg": output_path.endswith("task-output.json")}, f)',
  ].join('\n'), 'utf8');

  const run = await runWorkspaceTask(workspace, {
    id: 'bare-entrypoint-placeholders',
    language: 'python',
    entrypoint: 'main',
    entrypointArgs: ['inputPath', 'outputPath'],
    taskRel,
    inputRel: '.sciforge/sessions/2026-05-11_demo_session-2/task-inputs/task-input.json',
    input: {},
    outputRel: '.sciforge/sessions/2026-05-11_demo_session-2/task-results/task-output.json',
    stdoutRel: '.sciforge/sessions/2026-05-11_demo_session-2/logs/task.stdout.log',
    stderrRel: '.sciforge/sessions/2026-05-11_demo_session-2/logs/task.stderr.log',
  });

  assert.equal(run.exitCode, 0);
  assert.deepEqual(JSON.parse(await readFile(join(workspace, run.outputRef), 'utf8')), {
    inputArg: true,
    outputArg: true,
  });
});

test('workspace task runner treats bare input and output json argv names as runtime path placeholders', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-bare-json-argv-placeholders-'));
  const taskRel = '.sciforge/sessions/2026-05-11_demo_session-3/tasks/run.py';
  await mkdir(dirname(join(workspace, taskRel)), { recursive: true });
  await writeFile(join(workspace, taskRel), [
    'import json, os, sys',
    'input_path, output_path = sys.argv[1], sys.argv[2]',
    'with open(output_path, "w", encoding="utf-8") as f:',
    '    json.dump({"inputExists": os.path.exists(input_path), "usedSessionOutput": ".sciforge/sessions/" in output_path}, f)',
  ].join('\n'), 'utf8');

  const run = await runWorkspaceTask(workspace, {
    id: 'bare-json-argv-placeholders',
    language: 'python',
    entrypoint: 'main',
    entrypointArgs: ['./input.json', './output.json'],
    taskRel,
    inputRel: '.sciforge/sessions/2026-05-11_demo_session-3/task-inputs/task-input.json',
    input: {},
    outputRel: '.sciforge/sessions/2026-05-11_demo_session-3/task-results/task-output.json',
    stdoutRel: '.sciforge/sessions/2026-05-11_demo_session-3/logs/task.stdout.log',
    stderrRel: '.sciforge/sessions/2026-05-11_demo_session-3/logs/task.stderr.log',
  });

  assert.equal(run.exitCode, 0);
  assert.deepEqual(JSON.parse(await readFile(join(workspace, run.outputRef), 'utf8')), {
    inputExists: true,
    usedSessionOutput: true,
  });
  await assert.rejects(access(join(workspace, 'output.json')));
});

test('workspace task runner writes failed-with-reason payload when task exits before output', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-runner-fallback-payload-'));
  const taskRel = '.sciforge/sessions/2026-05-14_demo_session-4/tasks/fail.py';
  await mkdir(dirname(join(workspace, taskRel)), { recursive: true });
  await writeFile(join(workspace, taskRel), [
    'import sys',
    'print("starting generated task")',
    'print("boom before output", file=sys.stderr)',
    'sys.exit(7)',
  ].join('\n'), 'utf8');

  const run = await runWorkspaceTask(workspace, {
    id: 'runner-fallback-payload',
    language: 'python',
    entrypoint: 'main',
    taskRel,
    inputRel: '.sciforge/sessions/2026-05-14_demo_session-4/task-inputs/input.json',
    input: {},
    outputRel: '.sciforge/sessions/2026-05-14_demo_session-4/task-results/output.json',
    stdoutRel: '.sciforge/sessions/2026-05-14_demo_session-4/logs/stdout.log',
    stderrRel: '.sciforge/sessions/2026-05-14_demo_session-4/logs/stderr.log',
  });

  assert.equal(run.exitCode, 7);
  const payload = JSON.parse(await readFile(join(workspace, run.outputRef), 'utf8'));
  assert.equal(payload.status, 'failed-with-reason');
  assert.equal(payload.executionUnits[0].status, 'failed-with-reason');
  assert.equal(payload.executionUnits[0].exitCode, 7);
  assert.match(payload.executionUnits[0].failureReason, /boom before output/);
  assert.equal(payload.executionUnits[0].stdoutRef, run.stdoutRef);
  assert.equal(payload.executionUnits[0].stderrRef, run.stderrRef);
});
