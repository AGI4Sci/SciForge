import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const workspace = await mkdtemp(join(tmpdir(), 'bioagent-prune-'));
await mkdir(join(workspace, '.bioagent', 'logs'), { recursive: true });
await mkdir(join(workspace, '.bioagent', 'task-results'), { recursive: true });

await writeFile(join(workspace, '.bioagent', 'logs', 'run-a.stdout.log'), 'old log');
await writeFile(join(workspace, '.bioagent', 'task-results', 'run-a.json'), '{}');
await writeFile(join(workspace, '.bioagent', 'logs', 'run-b.stdout.log'), 'keep log');

const script = resolve('tools/prune-workspace.ts');
const dryRun = await execFileAsync('npx', ['tsx', script, '--workspace', workspace, '--targets', 'logs,task-results', '--run', 'run-a', '--keep-days', '0']);
const drySummary = JSON.parse(dryRun.stdout);
assert.equal(drySummary.apply, false);
assert.equal(drySummary.prunableFiles, 2);
assert.equal((await readdir(join(workspace, '.bioagent', 'logs'))).length, 2);

const applied = await execFileAsync('npx', ['tsx', script, '--workspace', workspace, '--targets', 'logs,task-results', '--run', 'run-a', '--keep-days', '0', '--apply']);
const summary = JSON.parse(applied.stdout);
assert.equal(summary.deletedFiles, 2);
assert.deepEqual((await readdir(join(workspace, '.bioagent', 'logs'))).sort(), ['run-b.stdout.log']);
assert.deepEqual(await readdir(join(workspace, '.bioagent', 'task-results')), []);

const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
assert.equal(packageJson.scripts['workspace:prune'], 'tsx tools/prune-workspace.ts');

console.log('[ok] workspace prune command cleans selected runtime dirs by run scope');
