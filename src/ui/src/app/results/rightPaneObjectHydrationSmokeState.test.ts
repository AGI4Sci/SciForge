import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RIGHT_PANE_OBJECT_HYDRATION_SMOKE_SELECTORS,
  collectRightPaneObjectHydrationSmokeSignals,
  createRightPaneObjectHydrationSmokeEvidence,
  createRightPaneObjectHydrationSmokeStorageSeed,
  rightPaneObjectHydrationSmokeEvidenceShowsPreviewAndFiles,
  rightPaneObjectHydrationSmokeFileReference,
} from './rightPaneObjectHydrationSmokeState';

test('right pane object hydration smoke seed creates a safe clickable file ref session', () => {
  const seed = createRightPaneObjectHydrationSmokeStorageSeed({
    instanceId: 'right pane/object hydration',
    workspacePath: '/tmp/sciforge-object-hydration',
    workspaceWriterBaseUrl: 'http://127.0.0.1:6173/',
    agentServerBaseUrl: 'http://127.0.0.1:1/',
    locale: 'en-US',
    filePath: 'reports/right-pane-object-preview.md',
    fileTitle: 'Right pane object preview',
    updatedAt: '2026-06-01T00:00:00.000Z',
  });

  const session = seed.workspaceState.sessionsByScenario['literature-evidence-review'];
  const message = session.messages[0];

  assert.equal(seed.keys.config, 'sciforge.config.v1.right-pane-object-hydration');
  assert.equal(seed.keys.workspace, 'sciforge.workspace.v2.right-pane-object-hydration');
  assert.equal(seed.navigationPath, '/?page=workbench&scenarioId=literature-evidence-review');
  assert.equal(seed.rightPaneState.activeTabId, 'base:primary');
  assert.equal(seed.filePath, 'reports/right-pane-object-preview.md');
  assert.equal(seed.fileReference.ref, 'file:reports/right-pane-object-preview.md');
  assert.equal(seed.fileReference.actions?.includes('focus-right-pane'), true);
  assert.equal(message?.role, 'scenario');
  assert.equal(message?.objectReferences?.[0]?.ref, 'file:reports/right-pane-object-preview.md');
  assert.equal(message?.provenance?.kind, 'fixture');
  assert.equal(message?.provenance?.liveAcceptanceEligible, false);
  assert.equal(session.runs.length, 0);
  assert.equal(session.artifacts.length, 0);

  const serialized = seed.entries.map((entry) => entry.value).join('\n');
  assert.match(serialized, /file:reports\/right-pane-object-preview\.md/);
  assert.doesNotMatch(serialized, /data:image|base64|Authorization|Bearer\s+|sk-[A-Za-z0-9._-]+|secret-value|password|credential/i);
});

test('right pane object hydration smoke seed rejects unsafe preview paths', () => {
  assert.throws(() => rightPaneObjectHydrationSmokeFileReference({
    filePath: '/tmp/private.md',
  }), /safe workspace-relative file path/);
  assert.throws(() => createRightPaneObjectHydrationSmokeStorageSeed({
    workspacePath: '/tmp/sciforge-object-hydration',
    workspaceWriterBaseUrl: 'http://127.0.0.1:6173',
    filePath: '.sciforge/raw/provider.json',
  }), /safe workspace-relative file path/);
});

test('right pane object hydration smoke evidence is bounded and redacts labels', () => {
  const evidence = createRightPaneObjectHydrationSmokeEvidence({
    blockedByClient: false,
    rootMounted: true,
    title: 'SciForge',
    selectedTabLabel: 'Files',
    objectReferenceLinkCount: 777,
    objectFocusBannerCount: 1,
    objectFocusTitle: 'Authorization: Bearer local-secret',
    workspaceObjectPreviewCount: 1,
    workspaceObjectPreviewReferenceCount: 1,
    filesViewerCount: 1,
    fileRowCount: 3,
    selectedFileRowLabel: 'right-pane-object-preview.md',
    filePreviewState: 'readonly',
    fileViewModeSourceCommandCount: 1,
    fileViewModePreviewCommandCount: 1,
    fileViewModePreviewCount: 1,
  });

  assert.equal(evidence.objectReferenceLinkCount, 99);
  assert.equal(evidence.objectFocusTitle, '[redacted]');
  assert.equal(evidence.filePreviewState, 'readonly');
  assert.equal(rightPaneObjectHydrationSmokeEvidenceShowsPreviewAndFiles(evidence), true);
  assert.equal(rightPaneObjectHydrationSmokeEvidenceShowsPreviewAndFiles({
    ...evidence,
    workspaceObjectPreviewCount: 0,
  }), false);
});

test('right pane object hydration smoke signal collector returns bounded DOM facts only', () => {
  const selectors = RIGHT_PANE_OBJECT_HYDRATION_SMOKE_SELECTORS;
  const documentLike = fakeDocument({
    [selectors.root]: [fakeElement()],
    [selectors.selectedTab]: [fakeElement('Files')],
    [selectors.objectReferenceLink]: [fakeElement('reports/right-pane-object-preview.md')],
    [selectors.objectFocusBanner]: [fakeElement('Right pane object preview file reports/right-pane-object-preview.md')],
    [selectors.workspaceObjectPreview]: [fakeElement()],
    [selectors.workspaceObjectPreviewReference]: [fakeElement('', { 'data-sciforge-reference': 'bounded-ref' })],
    [selectors.filesViewer]: [fakeElement()],
    [selectors.fileRows]: [fakeElement('workspace'), fakeElement('right-pane-object-preview.md')],
    [selectors.selectedFileRow]: [fakeElement('right-pane-object-preview.md')],
    [selectors.filePreviewState]: [fakeElement('', { 'data-file-preview-state': 'readonly' })],
    [selectors.fileViewModeSourceCommand]: [fakeElement('Source')],
    [selectors.fileViewModePreviewCommand]: [fakeElement('Preview')],
    [selectors.fileViewModePreview]: [fakeElement()],
  }, 'SciForge');

  const evidence = collectRightPaneObjectHydrationSmokeSignals(documentLike);

  assert.equal(evidence.rootMounted, true);
  assert.equal(evidence.selectedTabLabel, 'Files');
  assert.equal(evidence.objectReferenceLinkCount, 1);
  assert.equal(evidence.objectFocusBannerCount, 1);
  assert.equal(evidence.workspaceObjectPreviewCount, 1);
  assert.equal(evidence.workspaceObjectPreviewReferenceCount, 1);
  assert.equal(evidence.filesViewerCount, 1);
  assert.equal(evidence.fileRowCount, 2);
  assert.equal(evidence.selectedFileRowLabel, 'right-pane-object-preview.md');
  assert.equal(evidence.filePreviewState, 'readonly');
  assert.equal(evidence.fileViewModeSourceCommandCount, 1);
  assert.equal(evidence.fileViewModePreviewCommandCount, 1);
  assert.equal(rightPaneObjectHydrationSmokeEvidenceShowsPreviewAndFiles(evidence), true);
  assert.equal('innerHTML' in evidence, false);
  assert.equal('screenshot' in evidence, false);
  assert.equal('rawDom' in evidence, false);
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
