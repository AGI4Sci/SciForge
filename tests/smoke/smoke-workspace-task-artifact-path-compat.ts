import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runWorkspaceTask } from '../../src/runtime/workspace-task-runner.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-task-path-compat-'));
await mkdir(join(workspace, '.sciforge', 'artifacts', 'manual-arxiv-agent-review'), { recursive: true });
await writeFile(join(workspace, '.sciforge', 'artifacts', 'manual-arxiv-agent-review', 'research-report.md'), '# Report\n\nReadable.', 'utf8');

const taskRel = '.sciforge/tasks/path-compat/read_artifact.py';
await mkdir(join(workspace, '.sciforge', 'tasks', 'path-compat'), { recursive: true });
await writeFile(join(workspace, taskRel), [
  'import json, sys',
  'from pathlib import Path',
  'input_path = Path(sys.argv[1])',
  'output_path = Path(sys.argv[2])',
  "report_path = input_path.parent / '.sciforge' / 'artifacts' / 'manual-arxiv-agent-review' / 'research-report.md'",
  "output_path.write_text(json.dumps({",
  "  'message': report_path.read_text(encoding='utf-8'),",
  "  'confidence': 1,",
  "  'claimType': 'analysis',",
  "  'evidenceLevel': 'artifact-based',",
  "  'uiManifest': [],",
  "  'executionUnits': [],",
  "  'artifacts': [],",
  "}, ensure_ascii=False), encoding='utf-8')",
].join('\n'), 'utf8');

const run = await runWorkspaceTask(workspace, {
  id: 'path-compat',
  language: 'python',
  entrypoint: 'main',
  taskRel,
  input: {},
  outputRel: '.sciforge/task-results/path-compat.json',
  stdoutRel: '.sciforge/logs/path-compat.stdout.log',
  stderrRel: '.sciforge/logs/path-compat.stderr.log',
});

assert.equal(run.exitCode, 0);
const payload = JSON.parse(await readFile(join(workspace, '.sciforge/task-results/path-compat.json'), 'utf8')) as { message: string };
assert.match(payload.message, /Readable/);

console.log('[ok] workspace task artifact path compatibility links resolve task-input relative .sciforge refs');
