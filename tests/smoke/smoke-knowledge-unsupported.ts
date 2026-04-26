import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-knowledge-unsupported-'));
const result = await runWorkspaceRuntimeGateway({
  skillDomain: 'knowledge',
  prompt: 'melanoma disease OpenTargets connector status',
  availableSkills: ['knowledge.uniprot_chembl_lookup'],
  workspacePath: workspace,
});

assert.equal(result.artifacts.length, 1);
assert.equal(result.artifacts[0]?.type, 'knowledge-graph');
assert.equal(result.executionUnits.length, 1);
assert.equal(result.executionUnits[0].status, 'failed-with-reason');
assert.match(String(result.executionUnits[0].failureReason || result.message), /connector|unsupported|not support/i);
assert.equal((result.artifacts[0]?.metadata as Record<string, unknown> | undefined)?.source, 'unsupported');

const rows = ((result.artifacts[0]?.data as Record<string, unknown> | undefined)?.rows ?? []) as Array<Record<string, unknown>>;
assert.ok(rows.some((row) => row.key === 'status' && row.value === 'unsupported'));

console.log('[ok] knowledge unsupported smoke returns failed-with-reason without record-only success');
