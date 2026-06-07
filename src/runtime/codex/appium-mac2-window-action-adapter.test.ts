import assert from 'node:assert/strict';
import test from 'node:test';

import type { WindowActionAdapterContext } from '../window-action-session.js';
import {
  createAppiumMac2WindowActionAdapter,
  type AppiumMac2WindowActionRequest,
} from './appium-mac2-window-action-adapter.js';

test('Appium Mac2 WindowAction adapter binds TextEdit to loopback server and returns save evidence refs', async () => {
  const calls: AppiumMac2WindowActionRequest[] = [];
  const adapter = createAppiumMac2WindowActionAdapter({
    serverUrl: 'http://127.0.0.1:4723',
    executorEnabled: true,
    client: async (request) => {
      calls.push(request);
      return {
        executorEventRef: `appium-mac2:textedit/actions/${request.actionId}/executor-event`,
        inputEventRef: `appium-mac2:textedit/actions/${request.actionId}/input-event`,
        verifierRef: `appium-mac2:textedit/actions/${request.actionId}/verification/source-read`,
        artifactValidatorRef: `appium-mac2:textedit/actions/${request.actionId}/artifact-validator`,
        freshnessInvalidationRef: `window-action-session:textedit-main/actions/${request.actionId}/freshness-invalidation.json`,
        afterEvidenceRef: `window-action-session:textedit-main/evidence/${request.actionId}/after-ax.json`,
      };
    },
  });

  const result = await adapter(context({ action: 'save' }));

  assert.equal(result.status, 'completed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.serverUrl, 'http://127.0.0.1:4723');
  assert.equal(calls[0]?.bundleId, 'com.apple.TextEdit');
  assert.equal(calls[0]?.actionId, 'action-1');
  assert.equal(calls[0]?.action, 'save');
  assert.equal(calls[0]?.sessionId, 'textedit-main');
  assert.equal(calls[0]?.targetWindowRef, 'window:textedit:main');
  assert.equal(calls[0]?.text, undefined);
  assert.ok(refs(result.evidenceRefs).includes('appium-mac2:textedit/actions/action-1/executor-event'));
  assert.ok(refs(result.inputEventRefs).includes('appium-mac2:textedit/actions/action-1/input-event'));
  assert.ok(refs(result.evidenceRefs).includes('appium-mac2:textedit/actions/action-1/verification/source-read'));
  assert.ok(refs(result.artifactValidatorRefs).includes('appium-mac2:textedit/actions/action-1/artifact-validator'));
  assert.ok(refs(result.evidenceRefs).includes('window-action-session:textedit-main/actions/action-1/freshness-invalidation.json'));
  assert.ok(refs(result.afterEvidenceRefs).includes('window-action-session:textedit-main/evidence/action-1/after-ax.json'));
});

test('Appium Mac2 WindowAction adapter fails closed for non-loopback URL, unsupported app, and unsupported action', async () => {
  const externalUrl = await createAppiumMac2WindowActionAdapter({
    serverUrl: 'https://appium.example.test:4723',
    executorEnabled: true,
    client: async () => ({ executorEventRef: 'appium-mac2:textedit/actions/action-1/executor-event' }),
  })(context({ action: 'save' }));
  assert.equal(externalUrl.status, 'blocked');
  assert.match(externalUrl.blockedReason ?? '', /loopback|server URL/i);

  const unsupportedApp = await createAppiumMac2WindowActionAdapter({
    serverUrl: 'http://localhost:4723',
    executorEnabled: true,
    client: async () => ({ executorEventRef: 'appium-mac2:textedit/actions/action-1/executor-event' }),
  })(context({ appId: 'com.microsoft.VSCode', appName: 'Visual Studio Code', action: 'save' }));
  assert.equal(unsupportedApp.status, 'blocked');
  assert.match(unsupportedApp.blockedReason ?? '', /TextEdit|bundle/i);

  const unsupportedAction = await createAppiumMac2WindowActionAdapter({
    serverUrl: 'http://localhost:4723',
    executorEnabled: true,
    client: async () => ({ executorEventRef: 'appium-mac2:textedit/actions/action-1/executor-event' }),
  })(context({ action: 'click' }));
  assert.equal(unsupportedAction.status, 'blocked');
  assert.match(unsupportedAction.blockedReason ?? '', /unsupported/i);
});

function context(input: {
  action: 'type' | 'save' | 'click';
  appId?: string;
  appName?: string;
  text?: string;
}): WindowActionAdapterContext {
  return {
    session: {
      id: 'textedit-main',
      windowRef: 'window:textedit:main',
      app: { id: input.appId ?? 'com.apple.TextEdit', name: input.appName ?? 'TextEdit', kind: 'editor' },
    },
    route: { adapter: 'appium-mac2' },
    scopedInputAdapter: { ref: 'scoped-input-adapter:textedit-main/agent/appium-mac2' },
    input: {
      actionId: 'action-1',
      action: input.action,
      text: input.text,
      status: 'running',
      target: {
        app: { id: input.appId ?? 'com.apple.TextEdit', name: input.appName ?? 'TextEdit', kind: 'editor' },
        capabilities: { appiumMac2: true, accessibility: true },
      },
    },
  } as WindowActionAdapterContext;
}

function refs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => typeof item === 'string' ? [item] : typeof item?.ref === 'string' ? [item.ref] : [])
    : [];
}
