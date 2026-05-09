import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeWorkspaceOpenAction,
  workspaceOpenExternalBlockedExtensionReason,
} from './workspace-open';

test('runtime contract owns workspace open action and external block policy', () => {
  assert.equal(normalizeWorkspaceOpenAction('open-external'), 'open-external');
  assert.equal(normalizeWorkspaceOpenAction('reveal-in-folder'), 'reveal-in-folder');
  assert.equal(normalizeWorkspaceOpenAction('copy-path'), 'copy-path');
  assert.throws(() => normalizeWorkspaceOpenAction('execute'), /Unsupported workspace open action/);
  assert.match(workspaceOpenExternalBlockedExtensionReason('.sh') ?? '', /high-risk file type: \.sh/);
  assert.equal(workspaceOpenExternalBlockedExtensionReason('.txt'), undefined);
});
