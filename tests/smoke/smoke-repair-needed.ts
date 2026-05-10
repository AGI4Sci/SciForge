import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-repair-needed-'));
const result = await runWorkspaceRuntimeGateway({
  skillDomain: 'omics',
  prompt: 'Run omics differential expression without matrixRef or metadataRef',
  workspacePath: workspace,
});

assert.equal(result.artifacts.length, 1);
assert.equal(result.artifacts[0].type, 'verification-result');
assert.equal((result.artifacts[0].metadata as Record<string, unknown>).verdict, 'unverified');
assert.equal(result.executionUnits.length, 1);
assert.equal(result.executionUnits[0].status, 'repair-needed');
assert.match(String(result.executionUnits[0].failureReason || result.message), /AgentServer|base URL|generation/i);
assert.equal(result.executionUnits[0].codeRef, undefined);
assert.equal(result.executionUnits[0].stderrRef, undefined);
assert.deepEqual(result.executionUnits[0].outputArtifacts, []);
assert.deepEqual(result.executionUnits[0].artifacts, []);

const attemptsDir = join(workspace, '.sciforge', 'task-attempts');
let attemptFiles: string[] = [];
try {
  attemptFiles = await readdir(attemptsDir);
} catch {
  attemptFiles = [];
}
assert.equal(attemptFiles.length, 0);

console.log('[ok] repair-needed smoke does not fabricate fixed omics task output without AgentServer');
