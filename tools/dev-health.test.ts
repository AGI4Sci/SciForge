import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatWorkspaceWriterHealth,
  REQUIRED_WORKSPACE_WRITER_CAPABILITIES,
  workspaceWriterHealthOk,
  workspaceWriterMissingCapabilities,
} from './dev-health';

describe('workspace writer dev health', () => {
  it('requires repair and browser acceptance capabilities before reusing a writer', () => {
    const health = {
      ok: true,
      capabilities: [
        'workspace-snapshot',
        'workspace-files',
        'repair-handoff-runner',
        'runtime-provider-preflight-manifest',
      ],
    };

    assert.equal(workspaceWriterHealthOk(health), false);
    assert.deepEqual(workspaceWriterMissingCapabilities(health), [
      'feedback-repair-terminal-mirror-tail',
      'feedback-repair-stop-request',
      'runtime-codex-browser-acceptance-manifest',
    ]);
    assert.match(formatWorkspaceWriterHealth(health), /runtime-codex-browser-acceptance-manifest/);
  });

  it('accepts a writer only when every required capability is present', () => {
    const health = {
      ok: true,
      capabilities: [...REQUIRED_WORKSPACE_WRITER_CAPABILITIES, 'stable-version-registry'],
    };

    assert.equal(workspaceWriterHealthOk(health), true);
    assert.deepEqual(workspaceWriterMissingCapabilities(health), []);
    assert.match(formatWorkspaceWriterHealth(health), /passed/);
  });
});
