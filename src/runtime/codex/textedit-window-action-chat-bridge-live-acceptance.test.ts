import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { AppiumMac2WindowActionRequest } from './appium-mac2-window-action-adapter.js';
import {
  runTextEditWindowActionChatBridgeLiveAcceptance,
} from './textedit-window-action-chat-bridge-live-acceptance.js';

test('TextEdit WindowAction chat bridge live acceptance writes blocked manifest without explicit live gates', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-textedit-chat-live-blocked-'));
  try {
    const manifest = await runTextEditWindowActionChatBridgeLiveAcceptance({
      workspacePath: workspace,
      outputDir: join(workspace, 'out'),
      env: {},
      now: () => new Date('2026-06-07T02:00:00.000Z'),
    });
    const persisted = JSON.parse(await readFile(join(workspace, 'out', 'manifest.json'), 'utf8')) as typeof manifest;

    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.passClaim, false);
    assert.equal(manifest.finalAnswer.status, 'blocked');
    assert.ok(manifest.blockedReasons.includes('missing-env:SCIFORGE_T1_TEXTEDIT_CHAT_BRIDGE_LIVE'));
    assert.ok(manifest.blockedReasons.includes('missing-env:SCIFORGE_WINDOW_ACTION_APPIUM_MAC2'));
    assert.ok(manifest.blockedReasons.includes('missing-env:SCIFORGE_APPIUM_MAC2_EXECUTOR'));
    assert.ok(manifest.blockedReasons.includes('missing-env:SCIFORGE_APPIUM_MAC2_SERVER_URL'));
    assert.ok(manifest.blockedReasons.includes('missing-env:SCIFORGE_TEXTEDIT_SAVE_ARTIFACT_PATH'));
    assert.equal(persisted.status, 'blocked');
    assert.doesNotMatch(JSON.stringify(persisted), /http:\/\/|\/tmp|workspace-file-writer|shared-system-input|osascript|CGEvent|base64|secret|token/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('TextEdit WindowAction chat bridge live acceptance exercises ordinary chat through Agent Host and release evidence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-textedit-chat-live-'));
  try {
    const artifactPath = join(workspace, 'textedit-chat-proof.txt');
    const calls: AppiumMac2WindowActionRequest[] = [];
    const manifest = await runTextEditWindowActionChatBridgeLiveAcceptance({
      workspacePath: workspace,
      outputDir: join(workspace, 'out'),
      env: {
        SCIFORGE_T1_TEXTEDIT_CHAT_BRIDGE_LIVE: '1',
        SCIFORGE_WINDOW_ACTION_APPIUM_MAC2: '1',
        SCIFORGE_APPIUM_MAC2_EXECUTOR: '1',
        SCIFORGE_APPIUM_MAC2_SERVER_URL: 'http://127.0.0.1:4723',
        SCIFORGE_TEXTEDIT_SAVE_ARTIFACT_PATH: artifactPath,
      },
      appiumMac2Client: async (request) => {
        calls.push(request);
        return {
          executorEventRef: `appium-mac2:textedit/actions/${request.actionId}/executor-event`,
          inputEventRef: `appium-mac2:textedit/actions/${request.actionId}/save-input`,
          verifierRef: `appium-mac2:textedit/actions/${request.actionId}/verification/source-read`,
          artifactValidatorRef: `appium-mac2:textedit/actions/${request.actionId}/artifact-validator/content-match`,
          freshnessInvalidationRef: `window-action-session:textedit-local-save/actions/${request.actionId}/freshness-invalidation.json`,
          afterEvidenceRef: `window-action-session:textedit-local-save/evidence/${request.actionId}/after-ax.json`,
        };
      },
      now: () => new Date('2026-06-07T02:00:00.000Z'),
    });
    const persistedText = await readFile(join(workspace, 'out', 'manifest.json'), 'utf8');

    assert.equal(manifest.status, 'passed', manifest.blockedReasons.join(', '));
    assert.equal(manifest.passClaim, true);
    assert.equal(manifest.finalAnswer.status, 'blocked');
    assert.equal(manifest.finalAnswer.userTaskCompletionClaimed, false);
    assert.match(manifest.finalAnswer.reason ?? '', /product workflow completion is blocked/i);
    assert.deepEqual(calls.map((request) => request.action), ['save']);
    assert.equal(calls[0]?.targetArtifactPath, artifactPath);
    assert.ok(manifest.evidenceRefs.includes('window-action-session:textedit-local-save/action-state/textedit-chat-live-attempt-1'));
    assert.ok(manifest.evidenceRefs.includes('appium-mac2:textedit/actions/textedit-chat-live-attempt-1/save-input'));
    assert.ok(manifest.evidenceRefs.includes('appium-mac2:textedit/actions/textedit-chat-live-attempt-1/artifact-validator/content-match'));
    assert.ok(manifest.releaseEvidenceRefs.includes('action-ledger:window-action-session/textedit-local-save/control/remove/2026-06-07t02-00-00.000z'));
    assert.ok(manifest.releaseEvidenceRefs.includes('input-lease:window-action-session/textedit-local-save'));
    assert.ok(manifest.releaseEvidenceRefs.includes('scoped-input-adapter:textedit-local-save/computer-use/appium-mac2'));
    assert.ok(manifest.releaseEvidenceRefs.includes('actor-cursor:computer-use/textedit-local-save'));
    assert.equal(manifest.productReady, false);
    assert.equal(manifest.sharedSystemInputUsed, false);
    assert.doesNotMatch(persistedText, /http:\/\/|\/tmp|textedit-chat-proof\.txt|workspace-file-writer|shared-system-input|osascript|CGEvent|base64|secret|token/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
