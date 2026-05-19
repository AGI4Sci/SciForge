import assert from 'node:assert/strict';
import { normalizeInstanceName, parallelProfile } from '../../src/runtime/parallel-instance-profile.js';

const expected = [
  ['p1', '5173', '6173', '18080'],
  ['p2', '5174', '6174', '18081'],
  ['p3', '5175', '6175', '18082'],
  ['p4', '5176', '6176', '18083'],
  ['p5', '5177', '6177', '18084'],
  ['p6', '5178', '6178', '18085'],
  ['p7', '5179', '6179', '18086'],
  ['p8', '5180', '6180', '18087'],
] as const;

for (const [id, uiPort, workspacePort, runtimeCodexPort] of expected) {
  const profile = parallelProfile(id);
  assert.equal(profile.id, id);
  assert.equal(profile.uiPort, uiPort);
  assert.equal(profile.workspacePort, workspacePort);
  assert.equal(profile.runtimeCodexPort, runtimeCodexPort);
  assert.equal(profile.workspacePath, `workspace/parallel/${id}`);
  assert.equal(profile.stateDir, `.sciforge/parallel/${id}`);
  assert.equal(profile.logDir, `.sciforge/parallel/${id}/logs`);
  assert.equal(profile.configPath, `.sciforge/parallel/${id}/config.local.json`);
}

assert.equal(normalizeInstanceName('main'), 'p1');
assert.equal(normalizeInstanceName('repair'), 'p2');
assert.equal(normalizeInstanceName('P7'), 'p7');

const p7 = parallelProfile('p7');
assert.equal(p7.counterpart.agentId, 'p1');
assert.equal(p7.counterpart.appUrl, 'http://127.0.0.1:5173');
assert.equal(p7.counterpart.workspaceWriterUrl, 'http://127.0.0.1:6173');

console.log('[ok] parallel instance profile uses PROJECT.md p1-p8 port and directory assignments');
