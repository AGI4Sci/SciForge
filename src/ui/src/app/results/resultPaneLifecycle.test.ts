import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addRightPaneTabLifecycleState,
  baseResultPaneTabId,
  closeRightPaneTabLifecycleState,
  createDefaultRightPaneTabs,
  ensureRightPaneTab,
  loadStoredRightPaneState,
  rightPaneStateStorageKey,
  saveStoredRightPaneState,
} from './resultPaneLifecycle';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  failWrites = false;

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('storage unavailable');
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

test('right pane lifecycle creates localized default tabs and restores missing pane kinds', () => {
  const defaults = createDefaultRightPaneTabs('zh-CN');
  assert.deepEqual(defaults.map((tab) => tab.kind), ['primary', 'browser', 'image', 'terminal', 'files', 'evidence']);
  assert.equal(defaults[0]?.id, 'base:primary');
  assert.equal(defaults[0]?.label, '结果');
  assert.equal(defaults[2]?.id, 'base:image');
  assert.equal(defaults[2]?.label, '图片 / 证据');
  assert.equal(defaults.at(-1)?.label, '引用');

  const existing = [{ id: 'custom:browser:1:1', kind: 'browser' as const, label: 'Browser', closable: true }];
  const restored = ensureRightPaneTab(existing, 'files');
  assert.deepEqual(restored.map((tab) => tab.id), ['custom:browser:1:1', 'base:files']);
  assert.equal(restored.at(-1)?.label, 'Files');
  assert.deepEqual(ensureRightPaneTab(restored, 'files'), restored);
});

test('right pane lifecycle adds duplicate pane kinds as numbered Cursor-like pages', () => {
  const defaults = createDefaultRightPaneTabs('en-US');
  const next = addRightPaneTabLifecycleState({
    tabs: defaults,
    activeTabId: baseResultPaneTabId('primary'),
    browserTabAddresses: {},
  }, 'browser', 'en-US', 301);

  assert.equal(next.activeTabId, 'custom:browser:301:2');
  assert.equal(next.tabs.at(-1)?.label, 'Browser 2');
  assert.deepEqual(next.focusTarget, { kind: 'tab', tabId: 'custom:browser:301:2' });
});

test('right pane lifecycle closes active tabs, prunes Browser addresses, and recovers from empty', () => {
  const browserState = addRightPaneTabLifecycleState({
    tabs: [],
    activeTabId: '',
    browserTabAddresses: {},
  }, 'browser', undefined, 201);
  const terminalState = addRightPaneTabLifecycleState(browserState, 'terminal', undefined, 202);
  const filesState = addRightPaneTabLifecycleState({
    ...terminalState,
    browserTabAddresses: {
      [browserState.activeTabId]: 'http://localhost:5173',
    },
  }, 'files', undefined, 203);

  const closedFiles = closeRightPaneTabLifecycleState(filesState, filesState.activeTabId);
  const closedTerminal = closeRightPaneTabLifecycleState(closedFiles, terminalState.activeTabId);
  const emptyState = closeRightPaneTabLifecycleState(closedTerminal, browserState.activeTabId);
  const recovered = addRightPaneTabLifecycleState(emptyState, 'files', undefined, 204);

  assert.equal(closedFiles.activeTabId, terminalState.activeTabId);
  assert.deepEqual(closedFiles.focusTarget, { kind: 'tab', tabId: terminalState.activeTabId });
  assert.deepEqual(emptyState, {
    tabs: [],
    activeTabId: '',
    browserTabAddresses: {},
    focusTarget: { kind: 'new-button' },
  });
  assert.equal(recovered.activeTabId, 'custom:files:204:1');
});

test('right pane lifecycle keeps current active tab when closing non-active or unknown tabs', () => {
  const browserState = addRightPaneTabLifecycleState({
    tabs: [],
    activeTabId: '',
    browserTabAddresses: {},
  }, 'browser', undefined, 401);
  const terminalState = addRightPaneTabLifecycleState(browserState, 'terminal', undefined, 402);
  const state = {
    ...terminalState,
    browserTabAddresses: {
      [browserState.activeTabId]: 'https://browser.example.test',
      [terminalState.activeTabId]: 'https://should-not-be-used.example.test',
    },
  };

  const closedNonActive = closeRightPaneTabLifecycleState(state, browserState.activeTabId);
  assert.equal(closedNonActive.activeTabId, terminalState.activeTabId);
  assert.deepEqual(closedNonActive.focusTarget, { kind: 'tab', tabId: terminalState.activeTabId });
  assert.deepEqual(closedNonActive.browserTabAddresses, {
    [terminalState.activeTabId]: 'https://should-not-be-used.example.test',
  });

  const unknown = closeRightPaneTabLifecycleState(closedNonActive, 'missing-tab');
  assert.deepEqual(unknown.tabs, closedNonActive.tabs);
  assert.equal(unknown.activeTabId, terminalState.activeTabId);
  assert.deepEqual(unknown.focusTarget, { kind: 'tab', tabId: terminalState.activeTabId });
});

test('right pane lifecycle storage preserves explicit empty state and prunes stale tab addresses', () => {
  const previousWindow = globalThis.window;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: storage },
  });

  try {
    const key = rightPaneStateStorageKey('/workspace/demo');
    storage.setItem(key, JSON.stringify({
      tabs: [
        { id: 'browser-live', kind: 'browser', label: 'Browser Live' },
        { id: 'browser-live', kind: 'browser', label: 'Duplicate Browser' },
        { id: 'terminal-live', kind: 'terminal' },
        { id: 'bad-kind', kind: 'trace' },
      ],
      activeTabId: 'missing-active',
      browserTabAddresses: {
        'browser-live': 'https://example.test',
        'closed-browser': 'https://closed.example.test',
      },
    }));

    const restored = loadStoredRightPaneState(key, 'en-US', 'terminal');
    assert.deepEqual(restored.tabs.map((tab) => tab.id), ['browser-live', 'terminal-live']);
    assert.equal(restored.activeTabId, 'terminal-live');
    assert.deepEqual(restored.browserTabAddresses, { 'browser-live': 'https://example.test' });

    const emptyKey = rightPaneStateStorageKey('/workspace/empty');
    saveStoredRightPaneState(emptyKey, { tabs: [], activeTabId: '', browserTabAddresses: { stale: 'https://stale.example.test' } });
    assert.deepEqual(loadStoredRightPaneState(emptyKey, 'en-US', 'primary'), {
      tabs: [],
      activeTabId: '',
      browserTabAddresses: {},
    });

    const badJsonKey = rightPaneStateStorageKey('/workspace/bad-json');
    storage.setItem(badJsonKey, '{bad json');
    const badJson = loadStoredRightPaneState(badJsonKey, 'en-US', 'browser');
    assert.equal(badJson.activeTabId, baseResultPaneTabId('browser'));
    assert.equal(badJson.tabs.find((tab) => tab.kind === 'browser')?.label, 'Browser');

    const legacyScreenKey = rightPaneStateStorageKey('/workspace/legacy-screen');
    storage.setItem(legacyScreenKey, JSON.stringify({
      tabs: [
        { id: 'base:screen', kind: 'screen', label: 'Screen' },
        { id: 'custom:screen:42:2', kind: 'screen', label: 'Virtual Screen 2' },
      ],
      activeTabId: 'base:screen',
      browserTabAddresses: {},
    }));
    const legacyScreen = loadStoredRightPaneState(legacyScreenKey, 'en-US', 'screen');
    assert.deepEqual(legacyScreen.tabs.map((tab) => [tab.id, tab.kind, tab.label]), [
      ['base:image', 'image', 'Image / Evidence'],
      ['custom:image:42:2', 'image', 'Image / Evidence 2'],
    ]);
    assert.equal(legacyScreen.activeTabId, 'base:image');

    storage.failWrites = true;
    assert.doesNotThrow(() => saveStoredRightPaneState(rightPaneStateStorageKey('/workspace/write-fail'), {
      tabs: createDefaultRightPaneTabs('en-US'),
      activeTabId: baseResultPaneTabId('primary'),
      browserTabAddresses: {},
    }));
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    });
  }
});

test('right pane lifecycle storage falls back to requested initial tab outside the browser', () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: undefined,
  });

  try {
    const restored = loadStoredRightPaneState(rightPaneStateStorageKey(undefined), 'en-US', 'files');
    assert.equal(restored.activeTabId, baseResultPaneTabId('files'));
    assert.equal(restored.tabs.find((tab) => tab.kind === 'files')?.label, 'Files');
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    });
  }
});
