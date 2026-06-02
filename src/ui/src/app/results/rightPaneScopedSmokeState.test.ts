import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RIGHT_PANE_SCOPED_SMOKE_SELECTORS,
  collectRightPaneScopedSmokeSignals,
  createRightPaneScopedSmokeEvidence,
  createRightPaneScopedSmokeStorageSeed,
  rightPaneScopedSmokeEvidenceHasDefaultTabs,
  rightPaneScopedSmokeNavigationPath,
  rightPaneScopedSmokeStorageKey,
} from './rightPaneScopedSmokeState';

test('right pane scoped smoke seed creates scoped sanitized storage entries', () => {
  const seed = createRightPaneScopedSmokeStorageSeed({
    instanceId: 'right pane/ui smoke',
    workspacePath: '/tmp/sciforge-smoke/',
    workspaceWriterBaseUrl: 'http://127.0.0.1:6173/',
    agentServerBaseUrl: 'http://127.0.0.1:1/',
    locale: 'en-US',
    activeTab: 'browser',
    browserAddress: 'javascript:alert(1)',
    scenarioId: 'literature-evidence-review',
    updatedAt: '2026-06-01T00:00:00.000Z',
  });

  assert.equal(seed.keys.config, 'sciforge.config.v1.right-pane-ui-smoke');
  assert.equal(seed.keys.workspace, 'sciforge.workspace.v2.right-pane-ui-smoke');
  assert.equal(seed.keys.rightPane, 'sciforge.right-pane-state.v1./tmp/sciforge-smoke');
  assert.equal(seed.entries.length, 3);
  assert.equal(seed.navigationPath, '/?page=workbench&scenarioId=literature-evidence-review');

  assert.equal(seed.config.workspacePath, '/tmp/sciforge-smoke');
  assert.equal(seed.config.workspaceWriterBaseUrl, 'http://127.0.0.1:6173');
  assert.equal(seed.config.agentServerBaseUrl, 'http://127.0.0.1:1');
  assert.equal(seed.config.apiKey, '');
  assert.equal(seed.config.modelBaseUrl, '');
  assert.equal(seed.config.modelName, '');
  assert.equal(seed.config.modelProvider, 'right-pane-scoped-smoke');
  assert.equal(seed.workspaceState.workspacePath, '/tmp/sciforge-smoke');
  assert.equal(seed.workspaceState.sessionsByScenario['literature-evidence-review'].messages.length, 0);
  assert.equal(seed.workspaceState.sessionsByScenario['literature-evidence-review'].runs.length, 0);
  assert.equal(seed.workspaceState.sessionsByScenario['literature-evidence-review'].artifacts.length, 0);
  assert.equal(seed.rightPaneState.activeTabId, 'base:browser');
  assert.equal(seed.rightPaneState.browserTabAddresses['base:browser'], 'about:blank');
  assert.deepEqual(seed.rightPaneState.tabs.map((tab) => tab.label), [
    'Results',
    'Browser',
    'Screen',
    'Terminal',
    'Files',
    'References',
  ]);

  const serialized = seed.entries.map((entry) => entry.value).join('\n');
  assert.doesNotMatch(serialized, /data:image|base64|Authorization|Bearer\s+|feedbackGithubToken/);
});

test('right pane scoped smoke storage key mirrors build instance scoping', () => {
  assert.equal(rightPaneScopedSmokeStorageKey('sciforge.config.v1'), 'sciforge.config.v1');
  assert.equal(
    rightPaneScopedSmokeStorageKey('sciforge.config.v1', 'team smoke:alpha'),
    'sciforge.config.v1.team-smoke-alpha',
  );
});

test('right pane scoped smoke navigation path stays generic', () => {
  assert.equal(rightPaneScopedSmokeNavigationPath(), '/?page=workbench');
  assert.equal(
    rightPaneScopedSmokeNavigationPath('structure-exploration'),
    '/?page=workbench&scenarioId=structure-exploration',
  );
});

test('right pane scoped smoke evidence is bounded and redacts payload-like labels', () => {
  const evidence = createRightPaneScopedSmokeEvidence({
    blockedByClient: false,
    rootMounted: true,
    title: 'SciForge',
    shellCount: 1,
    tabLayoutCount: 1,
    tablistCount: 1,
    tabCount: 777,
    tabLabels: [
      'Results',
      'Browser',
      'Screen',
      'Terminal',
      'Files',
      'References',
      'Authorization: Bearer secret',
    ],
    selectedTabLabel: 'Browser',
    panelCount: 1,
    selectedPanelLabelledBySelectedTab: true,
    fixedNewActionCount: 1,
    fixedCloseActionCount: 1,
    fixedFocusModeCount: 1,
    browserToolCount: 1,
    browserWorkbenchCount: 1,
    browserPresentationBoundaryCount: 1,
    browserUrlInputCount: 1,
    browserAddressValue: 'about:blank',
    browserStateLabel: 'idle',
    browserSystemWindowSurfaceCount: 0,
    browserProxyIframeCount: 0,
    browserDirectExternalAnchorCount: 0,
    browserLegacyLiveSurfaceCount: 0,
    browserCanvasSurfaceCount: 0,
    browserHttpFrameImageCount: 0,
    screenViewerCount: 1,
    screenStatusLabel: 'empty',
    terminalViewerCount: 1,
    terminalToolCount: 1,
    terminalHostOwnedCount: 1,
    terminalWriterDiagnosticCount: 1,
    terminalInputDisabled: true,
    filesViewerCount: 1,
    fileRowCount: 3,
    referencesToolCount: 1,
    referencesStateLabel: 'empty',
    afterReloadTabCount: 6,
    afterReloadSelectedLabel: 'Browser',
    afterReloadBrowserToolCount: 1,
  });

  assert.equal(evidence.rootMounted, true);
  assert.equal(evidence.shellCount, 1);
  assert.equal(evidence.tabCount, 99);
  assert.deepEqual(evidence.tabLabels, [
    'Results',
    'Browser',
    'Screen',
    'Terminal',
    'Files',
    'References',
    '[redacted]',
  ]);
  assert.equal(evidence.terminalInputDisabled, true);
  assert.equal(evidence.terminalWriterDiagnosticCount, 1);
  assert.equal(evidence.browserAddressValue, 'about:blank');
  assert.equal(evidence.browserProxyIframeCount, 0);
  assert.equal(evidence.browserLegacyLiveSurfaceCount, 0);
  assert.equal(evidence.browserCanvasSurfaceCount, 0);
  assert.equal(evidence.browserHttpFrameImageCount, 0);
  assert.equal(rightPaneScopedSmokeEvidenceHasDefaultTabs(evidence), true);
});

test('right pane scoped smoke signal collector returns bounded selector facts only', () => {
  const selectors = RIGHT_PANE_SCOPED_SMOKE_SELECTORS;
  const selectedTab = fakeElement('Browser', { id: 'result-tab-base-browser' });
  const documentLike = fakeDocument({
    [selectors.root]: [fakeElement()],
    [selectors.shell]: [fakeElement('', { 'data-result-tab': 'browser' })],
    [selectors.tabLayout]: [fakeElement()],
    [selectors.tablist]: [fakeElement()],
    [selectors.tabs]: [
      fakeElement('Results'),
      selectedTab,
      fakeElement('Screen'),
      fakeElement('Terminal'),
      fakeElement('Files'),
      fakeElement('References'),
    ],
    [selectors.selectedTab]: [selectedTab],
    [selectors.panel]: [fakeElement('', { 'aria-labelledby': 'result-tab-base-browser' })],
    [selectors.fixedNewAction]: [fakeElement()],
    [selectors.fixedCloseAction]: [fakeElement()],
    [selectors.fixedFocusModeAction]: [fakeElement()],
    [selectors.browserTool]: [fakeElement()],
    [selectors.browserWorkbench]: [fakeElement('', {
      'data-browser-state': 'idle',
      'data-render-boundary': 'presentation-only',
    })],
    [selectors.browserPresentationBoundary]: [fakeElement()],
    [selectors.browserUrlInput]: [fakeElement('', {}, 'about:blank')],
    [selectors.screenViewer]: [fakeElement('', { 'data-status': 'empty' })],
    [selectors.terminalViewer]: [fakeElement('', { 'data-status': 'empty' })],
    [selectors.terminalTool]: [fakeElement()],
    [selectors.terminalWriterDiagnostic]: [fakeElement()],
    [selectors.filesViewer]: [fakeElement()],
    [selectors.fileRows]: [fakeElement('workspace')],
    [selectors.referencesTool]: [fakeElement('', { 'data-state': 'empty' })],
  }, 'SciForge');

  const evidence = collectRightPaneScopedSmokeSignals(documentLike);

  assert.equal(evidence.rootMounted, true);
  assert.equal(evidence.shellCount, 1);
  assert.equal(evidence.tablistCount, 1);
  assert.equal(evidence.tabCount, 6);
  assert.deepEqual(evidence.tabLabels, ['Results', 'Browser', 'Screen', 'Terminal', 'Files', 'References']);
  assert.equal(evidence.selectedTabLabel, 'Browser');
  assert.equal(evidence.selectedPanelLabelledBySelectedTab, true);
  assert.equal(evidence.fixedNewActionCount, 1);
  assert.equal(evidence.browserPresentationBoundaryCount, 1);
  assert.equal(evidence.browserAddressValue, 'about:blank');
  assert.equal(evidence.browserStateLabel, 'idle');
  assert.equal(evidence.browserSystemWindowSurfaceCount, 0);
  assert.equal(evidence.browserProxyIframeCount, 0);
  assert.equal(evidence.browserDirectExternalAnchorCount, 0);
  assert.equal(evidence.browserLegacyLiveSurfaceCount, 0);
  assert.equal(evidence.browserCanvasSurfaceCount, 0);
  assert.equal(evidence.browserHttpFrameImageCount, 0);
  assert.equal(evidence.screenStatusLabel, 'empty');
  assert.equal(evidence.terminalWriterDiagnosticCount, 1);
  assert.equal(evidence.referencesStateLabel, 'empty');
  assert.equal('innerHTML' in evidence, false);
  assert.equal('screenshot' in evidence, false);
  assert.equal('rawDom' in evidence, false);
});

test('right pane scoped smoke signal collector counts forbidden Browser live fallback selectors', () => {
  const selectors = RIGHT_PANE_SCOPED_SMOKE_SELECTORS;
  const documentLike = fakeDocument({
    [selectors.browserLegacyLiveSurface]: [
      fakeElement('', { 'data-browser-frame-stream-ref': 'browser-host-session:legacy/frame-stream' }),
      fakeElement('', { 'data-browser-frame-renderer': 'canvas-binary' }),
    ],
    [selectors.browserCanvasSurface]: [
      fakeElement('', { 'data-browser-frame-renderer': 'canvas-binary' }),
    ],
    [selectors.browserHttpFrameImage]: [
      fakeElement('', { src: '/api/sciforge/browser-host/sessions/legacy/frame' }),
    ],
  });

  const evidence = collectRightPaneScopedSmokeSignals(documentLike);

  assert.equal(evidence.browserLegacyLiveSurfaceCount, 2);
  assert.equal(evidence.browserCanvasSurfaceCount, 1);
  assert.equal(evidence.browserHttpFrameImageCount, 1);
  assert.equal('innerHTML' in evidence, false);
  assert.equal('screenshot' in evidence, false);
});

test('right pane scoped smoke default-tab evidence fails closed when tabstrip is missing', () => {
  const evidence = createRightPaneScopedSmokeEvidence({
    tablistCount: 0,
    tabCount: 6,
    tabLabels: ['Results', 'Browser', 'Screen', 'Terminal', 'Files', 'References'],
  });

  assert.equal(rightPaneScopedSmokeEvidenceHasDefaultTabs(evidence), false);
});

function fakeElement(textContent = '', attrs: Record<string, string> = {}, value?: string) {
  return {
    textContent,
    value,
    getAttribute(name: string) {
      return attrs[name] ?? null;
    },
  };
}

function fakeDocument(map: Record<string, ReturnType<typeof fakeElement>[] | undefined>, title = '') {
  return {
    title,
    querySelector(selector: string) {
      return map[selector]?.[0] ?? null;
    },
    querySelectorAll(selector: string) {
      return map[selector] ?? [];
    },
  };
}
