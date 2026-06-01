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
  assert.match(adapterSource, /RightPaneVirtualScreenTool/);
  assert.match(adapterSource, /RightPaneTerminalLiveTool/);
  assert.match(adapterSource, /RightPaneFilesTool/);
  assert.match(adapterSource, /PrimaryResultAdapter/);
  assert.match(adapterSource, /RightPaneReferencesTool/);
  assert.match(rendererSource, /from '.\/results\/rightPaneSurfaceAdapter'/);
  assert.doesNotMatch(rendererSource, /<RightPaneBrowserTool\b/);
  assert.doesNotMatch(rendererSource, /<RightPaneVirtualScreenTool\b/);
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
  assert.doesNotMatch(html, /right-pane-browser-tool|right-pane-terminal-tool|right-pane-files-tool|right-pane-virtual-screen-tool|right-pane-references-tool/);
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

test('right pane browser product flow renders browser_search projection with one host session owner', () => {
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
            liveSurfaceRef: `browser-host-session:${hostSessionId}/live`,
            liveSurfaceTransport: 'host-stream',
            singleInteractiveTruth: true,
            frameStreamRef: `browser-host-session:${hostSessionId}/frame-stream`,
            frameRef: `browser-host-session:${hostSessionId}/frame.png`,
            frameUrl: 'blob:browser-search-session-1-frame',
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
  assert.match(html, /data-browser-live-surface-ref="browser-host-session:browser-search-session-1\/live"/);
  assert.match(html, /data-browser-frame-stream-ref="browser-host-session:browser-search-session-1\/frame-stream"/);
  assert.match(html, /data-browser-single-interactive-truth="true"/);
  assert.match(html, /data-browser-frame-renderer="canvas-binary"/);
  assert.match(html, /data-browser-host-keyboard-path="hidden-input"/);
  assert.match(html, /data-browser-ref="browser-host-session:browser-search-session-1\/frame\.png"/);
  assert.match(html, /browser-host-session:browser-search-session-1\/search-results\.json/);
  assert.deepEqual(uniqueBrowserHostSessionIds(html), [hostSessionId]);
  assert.doesNotMatch(html, /system-browser-window|\/api\/sciforge\/browser\/proxy|<iframe|<webview|data:image|base64/);
});

test('right pane empty workspace can be rendered independently by locale', () => {
  const html = renderToStaticMarkup(createElement(RightPaneEmptyWorkspace, { locale: 'zh-CN' }));

  assert.match(html, /没有打开的页面/);
  assert.match(html, /Results、Browser、Screen、Terminal、Files/);
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
