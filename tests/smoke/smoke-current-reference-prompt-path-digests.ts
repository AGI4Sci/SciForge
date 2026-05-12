import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyConversationPolicy } from '../../src/runtime/conversation-policy/apply.js';
import { normalizeGatewayRequest } from '../../src/runtime/gateway/gateway-request.js';
import { buildConversationReferenceDigests } from '../../src/runtime/gateway/conversation-reference-digest.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-prompt-ref-digests-'));
const artifactDir = join(workspace, '.sciforge', 'artifacts', 'manual-review');
await mkdir(artifactDir, { recursive: true });
await writeFile(join(artifactDir, 'research-report.md'), '# Report\n\nAutonomous agents and tool use.\n', 'utf8');
await writeFile(join(artifactDir, 'paper-list.json'), JSON.stringify([{ title: 'Agent paper', categories: ['cs.AI'] }]), 'utf8');
await writeFile(join(artifactDir, 'table.csv'), 'sample,value,group\nrow-a,SENSITIVE_SENTINEL_ROW_BODY,case\nrow-b,42,control\n', 'utf8');

const request = normalizeGatewayRequest({
  prompt: '基于 workspace/.sciforge/artifacts/manual-review/research-report.md 和 paper-list.json 总结，不要重新检索。',
  skillDomain: 'literature',
  workspacePath: workspace,
  uiState: {},
});

const updated = (await applyConversationPolicy(request, {}, {
  workspace,
  config: {
    mode: 'active',
    command: 'python3',
    args: ['-m', 'sciforge_conversation.service'],
    timeoutMs: 5000,
    pythonPath: join(process.cwd(), 'packages/reasoning/conversation-policy/src'),
  },
})).request;
const refs = Array.isArray(updated.uiState?.currentReferences) ? updated.uiState.currentReferences : [];
const digests = Array.isArray(updated.uiState?.currentReferenceDigests) ? updated.uiState.currentReferenceDigests : [];

assert.deepEqual(refs.map((entry: Record<string, unknown>) => entry.ref), [
  '.sciforge/artifacts/manual-review/research-report.md',
  '.sciforge/artifacts/manual-review/paper-list.json',
]);
assert.equal(digests.length, 2);
assert.ok(digests.every((entry: Record<string, unknown>) => entry.status === 'ok'));
assert.ok(digests.every((entry: Record<string, unknown>) => typeof entry.digestText === 'string' && entry.digestText.length > 0));

const csvDigest = buildConversationReferenceDigests({
  workspaceRoot: workspace,
  references: ['.sciforge/artifacts/manual-review/table.csv'],
})[0];
assert.ok(csvDigest, 'CSV digest should be built');
assert.equal(csvDigest.sourceType, 'csv');
assert.equal(csvDigest.omitted.rawContent, 'refs-first-not-inlined');
assert.match(String(csvDigest.digestText), /Headers: sample, value, group/);
assert.doesNotMatch(JSON.stringify(csvDigest), /SENSITIVE_SENTINEL_ROW_BODY/);
assert.deepEqual(csvDigest.metrics.columnCount, 3);
assert.equal(typeof csvDigest.metrics.schemaFingerprint, 'string');

console.log('[ok] prompt workspace paths are promoted to current refs with bounded digests');
