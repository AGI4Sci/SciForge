import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { requestWithCurrentReferenceDigests } from '../../src/runtime/gateway/current-reference-digest.js';
import type { GatewayRequest } from '../../src/runtime/runtime-types.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-prompt-ref-digests-'));
const artifactDir = join(workspace, '.sciforge', 'artifacts', 'manual-review');
await mkdir(artifactDir, { recursive: true });
await writeFile(join(artifactDir, 'research-report.md'), '# Report\n\nAutonomous agents and tool use.\n', 'utf8');
await writeFile(join(artifactDir, 'paper-list.json'), JSON.stringify([{ title: 'Agent paper', categories: ['cs.AI'] }]), 'utf8');

const request = {
  prompt: '基于 workspace/.sciforge/artifacts/manual-review/research-report.md 和 paper-list.json 总结，不要重新检索。',
  skillDomain: 'literature',
  uiState: {},
} as GatewayRequest;

const updated = await requestWithCurrentReferenceDigests(request, workspace);
const refs = Array.isArray(updated.uiState?.currentReferences) ? updated.uiState.currentReferences : [];
const digests = Array.isArray(updated.uiState?.currentReferenceDigests) ? updated.uiState.currentReferenceDigests : [];

assert.deepEqual(refs.map((entry) => entry.ref), [
  '.sciforge/artifacts/manual-review/research-report.md',
  '.sciforge/artifacts/manual-review/paper-list.json',
]);
assert.equal(digests.length, 2);
assert.ok(digests.every((entry) => entry.status === 'ready'));
for (const digest of digests) {
  const digestRef = String(digest.digestRef || '').replace(/^file:/, '');
  const text = await readFile(join(workspace, digestRef), 'utf8');
  assert.ok(text.length > 0);
}

console.log('[ok] prompt workspace paths are promoted to current refs with bounded digests');
