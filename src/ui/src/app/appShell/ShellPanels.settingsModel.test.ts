import assert from 'node:assert/strict';
import test from 'node:test';
import type { PeerInstance } from '../../domain';
import {
  appendPeerInstance,
  createDefaultPeerInstance,
  nextPeerInstanceName,
  removePeerInstanceAt,
  updatePeerInstanceAt,
} from './ShellPanels.settingsModel';

const peer = (patch: Partial<PeerInstance>): PeerInstance => ({
  name: 'peer-1',
  appUrl: '',
  workspaceWriterUrl: '',
  workspacePath: '',
  role: 'peer',
  trustLevel: 'readonly',
  enabled: true,
  ...patch,
});

test('chooses the next unique peer instance name case-insensitively', () => {
  const peers = [
    peer({ name: 'Peer-3' }),
    peer({ name: 'peer-2' }),
    peer({ name: '  ' }),
  ];

  assert.equal(nextPeerInstanceName(peers), 'peer-4');
});

test('builds the default peer instance appended by the settings dialog', () => {
  assert.deepEqual(createDefaultPeerInstance([peer({ name: 'peer-1' })]), {
    name: 'peer-2',
    appUrl: '',
    workspaceWriterUrl: '',
    workspacePath: '',
    role: 'peer',
    trustLevel: 'readonly',
    enabled: true,
  });
});

test('updates and removes peer instances without mutating the original list', () => {
  const peers = [
    peer({ name: 'peer-1' }),
    peer({ name: 'peer-2', enabled: false }),
  ];

  assert.deepEqual(appendPeerInstance(peers).map((item) => item.name), ['peer-1', 'peer-2', 'peer-3']);
  assert.equal(updatePeerInstanceAt(peers, 1, { enabled: true })[1].enabled, true);
  assert.deepEqual(removePeerInstanceAt(peers, 0).map((item) => item.name), ['peer-2']);
  assert.equal(peers[1].enabled, false);
});
