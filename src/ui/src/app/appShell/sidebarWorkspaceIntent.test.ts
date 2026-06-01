import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSidebarWorkspaceIntent,
  sidebarWorkspaceIntentEvidence,
} from './sidebarWorkspaceIntent';

test('sidebar workspace intent keeps absolute paths out of command and public evidence', () => {
  const intent = buildSidebarWorkspaceIntent({
    kind: 'open-workspace',
    source: 'repositories-header',
    workspacePath: '/Applications/private/SciForge Lab',
  });

  assert.ok(intent);
  assert.equal(intent.workspacePath, '/Applications/private/SciForge Lab');
  assert.equal(intent.workspaceLabel, 'SciForge Lab');
  assert.equal(intent.approvedNativeIntent.kind, 'pick-directory');
  assert.match(intent.commandText, /^sciforge project open-workspace --from-sidebar --workspace-ref "gui:\/\/sidebar\/workspace-intent\/open-workspace\//);

  const publicEvidence = JSON.stringify(sidebarWorkspaceIntentEvidence(intent));
  assert.doesNotMatch(publicEvidence, /\/Applications|\/private|SciForge Lab\/|workspacePath/);
  assert.doesNotMatch(intent.commandText, /\/Applications|\/private|SciForge Lab/);
});

test('sidebar workspace intent distinguishes manual directory confirmation', () => {
  const intent = buildSidebarWorkspaceIntent({
    kind: 'set-current-directory',
    source: 'manual-path',
    workspacePath: '/tmp/new-project',
  });

  assert.ok(intent);
  assert.equal(intent.approvedNativeIntent.kind, 'manual-directory');
  assert.match(intent.commandText, /sciforge project set-current-directory --from-sidebar/);
  assert.doesNotMatch(intent.commandText, /\/tmp|new-project/);
});

test('sidebar workspace intent fails closed for blank paths and redacts secret-like labels', () => {
  assert.equal(buildSidebarWorkspaceIntent({
    kind: 'open-workspace',
    source: 'repositories-header',
    workspacePath: '   ',
  }), undefined);

  const intent = buildSidebarWorkspaceIntent({
    kind: 'new-project',
    source: 'repositories-header',
    workspacePath: '/workspace/api-key-project',
  });

  assert.ok(intent);
  assert.equal(intent.workspaceLabel, 'Selected workspace');
  assert.match(intent.commandText, /sciforge project new --from-sidebar/);
});
