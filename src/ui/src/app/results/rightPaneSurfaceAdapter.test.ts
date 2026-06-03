import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ScenarioId } from '../../data';
import type { ObjectReference, SciForgeConfig, SciForgeSession } from '../../domain';
import type { ResultsRendererViewModel } from '../results-renderer-view-model';
import { focusResultPaneRouteForObjectReference } from './resultPaneContract';
import { RightPaneActiveSurface, RightPaneEmptyWorkspace, type RightPaneActiveSurfaceProps } from './rightPaneSurfaceAdapter';

test('right pane surface adapter owns active pane rendering extraction from ResultsRenderer', () => {
  const adapterSource = readFileSync(new URL('./rightPaneSurfaceAdapter.tsx', import.meta.url), 'utf8');
  const rendererSource = readFileSync(new URL('../ResultsRenderer.tsx', import.meta.url), 'utf8');

  assert.match(adapterSource, /export function RightPaneActiveSurface/);
  assert.match(adapterSource, /RightPaneBrowserTool/);
  assert.match(adapterSource, /RightPaneImageEvidenceTool/);
  assert.doesNotMatch(adapterSource, /RightPaneVirtualScreenTool/);
  assert.match(adapterSource, /RightPaneTerminalLiveTool/);
  assert.match(adapterSource, /RightPaneFilesTool/);
  assert.match(adapterSource, /PrimaryResultAdapter/);
  assert.match(adapterSource, /RightPaneReferencesTool/);
  assert.match(rendererSource, /from '.\/results\/rightPaneSurfaceAdapter'/);
  assert.doesNotMatch(rendererSource, /<RightPaneBrowserTool\b/);
  assert.doesNotMatch(rendererSource, /<RightPaneVirtualScreenTool\b/);
  assert.doesNotMatch(rendererSource, /<RightPaneImageEvidenceTool\b/);
  assert.doesNotMatch(rendererSource, /<RightPaneTerminalLiveTool\b/);
  assert.doesNotMatch(rendererSource, /<RightPaneFilesTool\b/);
  assert.doesNotMatch(rendererSource, /<PrimaryResultAdapter\b/);
  assert.doesNotMatch(rendererSource, /<RightPaneReferencesTool\b/);
  assert.doesNotMatch(rendererSource, /function RightPaneEmptyWorkspace/);
});

test('right pane surface adapter renders the empty workspace projection without tool ownership', () => {
  const html = renderToStaticMarkup(createElement(RightPaneActiveSurface, {
    ...baseProps(),
    hasOpenRightPaneTabs: false,
  }));

  assert.match(html, /data-testid="right-pane-empty-workspace"/);
  assert.match(html, /No pages open/);
  assert.doesNotMatch(html, /right-pane-browser-tool|right-pane-terminal-tool|right-pane-files-tool|right-pane-image-evidence-tool|right-pane-virtual-screen-tool|right-pane-references-tool/);
});

test('right pane surface adapter routes Image Evidence presentation without live host bridge', () => {
  const html = renderToStaticMarkup(createElement(RightPaneActiveSurface, {
    ...baseProps(),
    resultTab: 'image' as never,
    imageEvidencePayload: {
      title: 'Browser evidence',
      status: 'ready',
      sourceKind: 'browser-evidence',
      imageRef: 'browser-evidence:session-1/screenshot.png',
      mime: 'image/png',
      width: 1440,
      height: 900,
      sha256: 'a'.repeat(64),
      createdAt: '2026-06-03T00:00:00.000Z',
      provenanceRef: 'browser-evidence:session-1/provenance.json',
      browserSessionRef: 'browser-host-session:session-1',
      annotationRefs: ['annotation:session-1/crop.json'],
      bounds: { x: 10, y: 20, width: 300, height: 160 },
    },
  } as RightPaneActiveSurfaceProps & Record<string, unknown>));

  assert.match(html, /data-testid="right-pane-image-evidence-tool"/);
  assert.match(html, /data-component-id="image-evidence-viewer"/);
  assert.match(html, /data-render-boundary="presentation-only"/);
  assert.match(html, /data-source-kind="browser-evidence"/);
  assert.match(html, /browser-evidence:session-1\/screenshot\.png/);
  assert.match(html, /Fit/);
  assert.match(html, /Actual size/);
  assert.match(html, /Copy ref/);
  assert.match(html, /Open original/);
  assert.match(html, /Download/);
  assert.doesNotMatch(html, /virtual-app-screen|VirtualAppScreen|live-surface|input-intent|attachVirtualAppScreen|data:image|base64|providerRoute|executorLease/);
});

test('right pane surface adapter routes Browser presentation while preserving command boundary props', () => {
  const html = renderToStaticMarkup(createElement(RightPaneActiveSurface, {
    ...baseProps(),
    resultTab: 'browser',
    browserAddressDraft: 'about:blank',
  }));

  assert.match(html, /data-testid="right-pane-browser-tool"/);
  assert.match(html, /data-component-id="browser-workbench"/);
  assert.match(html, /data-render-boundary="presentation-only"/);
  assert.match(html, /\/browser open/);
  assert.doesNotMatch(html, /data:image|base64|providerRoute|executorLease/);
});

test('right pane browser product flow renders native browser_search projection with one host session owner', () => {
  const hostSessionId = 'browser-search-session-1';
  const finalUrl = 'https://search.example.test/results?q=host+owned';
  const focusedObjectReference: ObjectReference = {
    id: 'obj-browser-host-session-1',
    kind: 'artifact',
    title: 'BrowserHostSession search projection',
    ref: 'artifact:browser-host-projection-product-smoke',
    artifactType: 'browser-runtime-projection',
    preferredView: 'browser-workbench',
    status: 'available',
    provenance: {
      producer: 'sciforge.browser-host-session',
      dataRef: `browser-host-session:${hostSessionId}`,
    },
  };
  assert.equal(focusResultPaneRouteForObjectReference(focusedObjectReference).pane, 'browser');
  const html = renderToStaticMarkup(createElement(RightPaneActiveSurface, {
    ...baseProps(),
    resultTab: 'browser',
    focusedObjectReference,
    session: {
      ...sessionFixture(),
      artifacts: [{
        id: 'browser-host-projection-product-smoke',
        type: 'browser-runtime-projection',
        producerScenario: 'literature-evidence-review',
        schemaVersion: 'sciforge.browser-runtime.projection.v1',
        metadata: {
          source: 'browser_search',
          browserSessionRef: `browser-host-session:${hostSessionId}`,
          finalUrl,
        },
        data: {
          session: {
            id: hostSessionId,
            mode: 'agent-headless',
            providerId: 'sciforge.browser-host-session',
            activeTabId: `${hostSessionId}:tab`,
            tabs: [{ id: `${hostSessionId}:tab`, url: finalUrl, title: 'Search results', status: 'ready' }],
          },
          hostSession: {
            id: hostSessionId,
            status: 'ready',
            requestedUrl: finalUrl,
            url: finalUrl,
            title: 'Search results',
            liveSurfaceRef: `browser-host-session:${hostSessionId}/live-surface`,
            liveSurfaceTransport: 'native-embedded',
            singleInteractiveTruth: true,
            secondTruthSource: false,
            searchResultRef: `browser-host-session:${hostSessionId}/search-results.json`,
            screenshotRef: `browser-host-session:${hostSessionId}/screenshot.png`,
            domSnapshotRef: `browser-host-session:${hostSessionId}/dom.html`,
            axSnapshotRef: `browser-host-session:${hostSessionId}/ax.json`,
            consoleLogRef: `browser-host-session:${hostSessionId}/console.jsonl`,
            networkLogRef: `browser-host-session:${hostSessionId}/network.jsonl`,
          },
          snapshot: {
            schemaVersion: 'sciforge.browser-runtime.snapshot.v1',
            url: finalUrl,
            title: 'Search results',
            searchResultRef: `browser-host-session:${hostSessionId}/search-results.json`,
          },
        },
      }],
    },
  }));

  assert.match(html, /data-testid="right-pane-browser-tool"/);
  assert.match(html, /data-component-id="browser-workbench"/);
  assert.match(html, /data-browser-state="ready"/);
  assert.match(html, /name="browser-url" value="https:\/\/search\.example\.test\/results\?q=host\+owned"/);
  assert.match(html, /data-browser-host-surface="browser-host-session"/);
  assert.match(html, /data-browser-native-surface="true"/);
  assert.match(html, /data-browser-live-surface-ref="browser-host-session:browser-search-session-1\/live-surface"/);
  assert.match(html, /data-browser-live-surface-transport="native-embedded"/);
  assert.match(html, /data-browser-single-interactive-truth="true"/);
  assert.match(html, /data-browser-frame-transport="native-embedded"/);
  assert.match(html, /browser-host-session:browser-search-session-1\/search-results\.json/);
  assert.deepEqual(uniqueBrowserHostSessionIds(html), [hostSessionId]);
  assert.doesNotMatch(html, /data-browser-frame-stream-ref|data-browser-frame-renderer|data-browser-host-keyboard-path|canvas-binary|host-stream|webrtc-data-channel|websocket-binary/);
  assert.doesNotMatch(html, /system-browser-window|\/api\/sciforge\/browser\/proxy|<iframe|<canvas|<webview|data:image|base64/);
});

test('right pane browser product flow keeps legacy host-stream projection ref-only', () => {
  const hostSessionId = 'browser-search-session-legacy';
  const finalUrl = 'https://search.example.test/results?q=legacy';
  const focusedObjectReference: ObjectReference = {
    id: 'obj-browser-host-session-legacy',
    kind: 'artifact',
    title: 'Legacy BrowserHostSession search projection',
    ref: 'artifact:browser-host-projection-legacy',
    artifactType: 'browser-runtime-projection',
    preferredView: 'browser-workbench',
    status: 'available',
  };
  const html = renderToStaticMarkup(createElement(RightPaneActiveSurface, {
    ...baseProps(),
    resultTab: 'browser',
    focusedObjectReference,
    session: {
      ...sessionFixture(),
      artifacts: [{
        id: 'browser-host-projection-legacy',
        type: 'browser-runtime-projection',
        producerScenario: 'literature-evidence-review',
        schemaVersion: 'sciforge.browser-runtime.projection.v1',
        metadata: {
          source: 'browser_search',
          browserSessionRef: `browser-host-session:${hostSessionId}`,
          finalUrl,
        },
        data: {
          hostSession: {
            id: hostSessionId,
            status: 'ready',
            requestedUrl: finalUrl,
            url: finalUrl,
            title: 'Legacy search results',
            liveSurfaceRef: `browser-host-session:${hostSessionId}/live`,
            liveSurfaceTransport: 'host-stream',
            singleInteractiveTruth: true,
            frameStreamRef: `browser-host-session:${hostSessionId}/frame-stream`,
            frameRef: `browser-host-session:${hostSessionId}/frame.png`,
            frameUrl: 'blob:browser-search-session-legacy-frame',
            searchResultRef: `browser-host-session:${hostSessionId}/search-results.json`,
          },
        },
      }],
    },
  }));

  assert.match(html, /data-testid="right-pane-browser-tool"/);
  assert.match(html, /data-component-id="browser-workbench"/);
  assert.match(html, /data-browser-state="idle"/);
  assert.match(html, /name="browser-url" value="https:\/\/search\.example\.test\/results\?q=legacy"/);
  assert.match(html, /data-browser-host-surface="browser-host-session"/);
  assert.doesNotMatch(html, /data-browser-native-surface="true"/);
  assert.doesNotMatch(html, /data-browser-live-surface-ref|data-browser-frame-stream-ref|data-browser-frame-renderer|data-browser-host-keyboard-path/);
  assert.doesNotMatch(html, /canvas-binary|webrtc-data-channel|websocket-binary|<iframe|<canvas|<webview|data:image|base64/);
});

test('right pane empty workspace can be rendered independently by locale', () => {
  const html = renderToStaticMarkup(createElement(RightPaneEmptyWorkspace, { locale: 'zh-CN' }));

  assert.match(html, /没有打开的页面/);
  assert.match(html, /Results、Browser、Image \/ Evidence、Terminal、Files/);
});

function baseProps(): RightPaneActiveSurfaceProps {
  return {
    hasOpenRightPaneTabs: true,
    resultTab: 'browser',
    activeResultTabId: 'custom:browser:test:1',
    scenarioId: 'literature-evidence-review' as ScenarioId,
    config: configFixture(),
    workspaceFileConfig: configFixture(),
    session: sessionFixture(),
    focusMode: 'all',
    executionFocus: false,
    model: {} as ResultsRendererViewModel,
    locale: 'en-US',
    pinnedObjectReferences: [],
    objectActionError: '',
    objectActionNotice: '',
    workspaceFileEditor: null,
    activeFilesWorkspaceFileEditor: null,
    workspaceFileOpenTabs: [],
    onBrowserAddressDraftChange: () => undefined,
    onCommandRequest: () => undefined,
    onObjectAction: () => undefined,
    onClearFocusedObject: () => undefined,
    onObjectReferenceFocus: () => undefined,
    onWorkspaceFileEditorChange: () => undefined,
    onCloseWorkspaceFileEditor: () => undefined,
    onTerminalSessionChange: () => undefined,
    onSelectOpenFile: () => undefined,
    onCloseOpenFile: () => undefined,
    onOpenFileEditor: () => undefined,
    onCloseFileView: () => undefined,
    onActiveFileEditorChange: () => undefined,
    onArtifactHandoff: () => undefined,
    onInspectArtifact: () => undefined,
    onWorkbenchToolSelect: () => undefined,
  };
}

function configFixture(): SciForgeConfig {
  return {
    workspacePath: '/tmp/sciforge',
    locale: 'en-US',
  } as SciForgeConfig;
}

function sessionFixture(): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-right-pane-surface-adapter',
    scenarioId: 'literature-evidence-review',
    title: 'Right pane surface adapter',
    createdAt: '2026-06-01T00:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

function uniqueBrowserHostSessionIds(html: string) {
  return [...new Set([...html.matchAll(/browser-host-session:([^/"<\s]+)/g)]
    .map((match) => match[1]?.split('/')[0])
    .filter((id): id is string => Boolean(id)))];
}
