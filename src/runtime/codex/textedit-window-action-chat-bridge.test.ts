import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { evaluateCodexAgentHostTurnLoop } from './agent-host-turn-loop.js';
import {
  createTextEditWindowActionChatBridge,
} from './textedit-window-action-chat-bridge.js';
import type { AppiumMac2WindowActionRequest } from './appium-mac2-window-action-adapter.js';

const now = '2026-06-07T00:00:00.000Z';

test('TextEdit WindowAction chat bridge injects runtimeTruth refs for ordinary chat save tasks', async () => {
  const workspacePath = '/tmp/sciforge-textedit-chat-bridge';
  const commandText = `Operate the TextEdit window and press Save for the visible document to ${join(workspacePath, 'proof.txt')}.`;
  const appiumCalls: AppiumMac2WindowActionRequest[] = [];
  const bridge = createTextEditWindowActionChatBridge({
    commandText,
    workspacePath,
    env: appiumEnv(join(workspacePath, 'proof.txt')),
    now: () => new Date(now),
    appiumMac2Client: async (request) => {
      appiumCalls.push(request);
      return {
        executorEventRef: `appium-mac2:textedit/actions/${request.actionId}/executor-event`,
        inputEventRef: `appium-mac2:textedit/actions/${request.actionId}/save-input`,
        verifierRef: `appium-mac2:textedit/actions/${request.actionId}/verification/source-read`,
        artifactValidatorRef: `appium-mac2:textedit/actions/${request.actionId}/artifact-validator/content-match`,
        freshnessInvalidationRef: `window-action-session:textedit-local-save/actions/${request.actionId}/freshness-invalidation.json`,
        afterEvidenceRef: `window-action-session:textedit-local-save/evidence/${request.actionId}/after-ax.json`,
      };
    },
  });

  assert.ok(bridge, 'bridge is opt-in ready when Appium env gates and TextEdit save target are present');
  assert.equal(bridge.sessionRef, 'window-action-session:textedit-local-save');
  assert.equal(bridge.runtimeTruth.target?.refs?.includes(bridge.sessionRef), true);

  const result = await evaluateCodexAgentHostTurnLoop({
    input: ordinaryChatInput(commandText),
    commandText,
    workspacePath,
    commandId: 'codex-textedit-save',
    attemptId: 'codex-textedit-save-attempt-1',
    runtimeTruth: bridge.runtimeTruth,
    computerUseActMaterializer: bridge.computerUseActMaterializer,
  });

  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked', String(result?.result.message));
  assert.match(String(result?.result.message), /product workflow completion is blocked/i);
  assert.equal(appiumCalls.length, 1);
  assert.equal(appiumCalls[0]?.action, 'save');
  assert.equal(appiumCalls[0]?.targetArtifactPath, join(workspacePath, 'proof.txt'));
  assert.ok((result?.result.evidenceRefs as string[]).includes('adapter-registry:window-action-session/appium-mac2/computer-use'));
  assert.ok((result?.result.evidenceRefs as string[]).some((ref) => ref.startsWith('runtime-truth:computer-use-act-materializer/preflight/')));
  assert.ok((result?.result.evidenceRefs as string[]).includes('window-action-session:textedit-local-save'));
  assert.ok((result?.result.evidenceRefs as string[]).includes('window-action-session:textedit-local-save/action-state/codex-textedit-save-attempt-1'));
  assert.ok((result?.result.evidenceRefs as string[]).includes('window-action-session:textedit-local-save/evidence/codex-textedit-save-attempt-1/after-ax.json'));
  assert.ok((result?.result.evidenceRefs as string[]).includes('window-action-session:textedit-local-save/actions/codex-textedit-save-attempt-1/freshness-invalidation.json'));
  assert.doesNotMatch(JSON.stringify(result), /workspace-file-writer|shell-writer|shared-system-input|osascript|CGEvent|secret|token/i);
});

test('TextEdit WindowAction chat bridge stays disabled without Appium opt-in gates or non-save targets', () => {
  const workspacePath = '/tmp/sciforge-textedit-chat-bridge';
  assert.equal(createTextEditWindowActionChatBridge({
    commandText: 'Save the visible TextEdit document.',
    workspacePath,
    env: {},
  }), undefined);
  assert.equal(createTextEditWindowActionChatBridge({
    commandText: 'Scroll the visible TextEdit document.',
    workspacePath,
    env: appiumEnv(join(workspacePath, 'proof.txt')),
  }), undefined);
});

function ordinaryChatInput(intentText: string) {
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'ordinary-chat',
    intentText,
    authorizationProfileId: 'high-autonomy',
    singleTurnOverride: false,
    refs: [],
    readiness: {},
    target: {},
    observation: {},
    permissions: {},
  };
}

function appiumEnv(artifactPath: string): NodeJS.ProcessEnv {
  return {
    SCIFORGE_WINDOW_ACTION_APPIUM_MAC2: '1',
    SCIFORGE_APPIUM_MAC2_SERVER_URL: 'http://127.0.0.1:4723',
    SCIFORGE_APPIUM_MAC2_EXECUTOR: '1',
    SCIFORGE_TEXTEDIT_SAVE_ARTIFACT_PATH: artifactPath,
  };
}
