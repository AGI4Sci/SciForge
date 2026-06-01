import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { basicBrowserWorkbenchFixture } from './fixtures/basic';
import { emptyBrowserWorkbenchFixture } from './fixtures/empty';
import { selectionBrowserWorkbenchFixture } from './fixtures/selection';
import { manifest } from './manifest';
import {
  browserWorkbenchDefaultCommands,
  browserWorkbenchStateFromPayload,
  normalizeBrowserWorkbenchUrl,
  renderBrowserWorkbench,
} from './render';

function htmlFor(fixture = basicBrowserWorkbenchFixture) {
  return renderToStaticMarkup(renderBrowserWorkbench(fixture));
}

test('browser-workbench package exposes manifest and renders browser_runtime refs', () => {
  assert.equal(manifest.componentId, 'browser-workbench');
  const html = htmlFor();

  assert.match(html, /browser-workbench-viewer/);
  assert.match(html, /data-render-boundary="presentation-only"/);
  assert.match(html, /data-session-ref="browser-session-demo"/);
  assert.match(html, /data-browser-state="ready"/);
  assert.match(html, /SciForge/);
  assert.match(html, /blob:\/\/browser\/demo-screenshot\.png/);
  assert.match(html, /blob:\/\/browser\/demo-dom\.json/);
  assert.match(html, /data-event="browser-command-request"/);
  assert.match(html, /data-browser-command-id="open-external"/);
  assert.match(html, /\/browser snapshot --url &quot;http:\/\/localhost:5173\/&quot; --screenshot --dom --logs/);
  assert.doesNotMatch(html, /Presentation only: browser_runtime owns provider routing/);
});

test('browser-workbench renders an empty state without pretending to own browser execution', () => {
  const html = htmlFor(emptyBrowserWorkbenchFixture);

  assert.match(html, /data-status="idle"/);
  assert.match(html, /data-browser-object-type="browser-state"/);
  assert.match(html, /No browser runtime projection is attached/);
  assert.match(html, /\/browser open &quot;about:blank&quot; --surface workbench/);
  assert.doesNotMatch(html, /playwright_browser_automation/);
});

test('browser-workbench supports host-declared preview and approval-tagged commands', () => {
  const html = htmlFor(selectionBrowserWorkbenchFixture);

  assert.match(html, /<iframe/);
  assert.match(html, /sandbox="allow-downloads allow-forms allow-modals allow-same-origin allow-scripts allow-storage-access-by-user-activation"/);
  assert.match(html, /data-browser-risk="needs-approval"/);
  assert.match(html, /Visible takeover requires TUI-host approval/);
});

test('browser-workbench default commands are terminal-equivalent text', () => {
  assert.deepEqual(browserWorkbenchDefaultCommands('https://example.org').map((item) => item.command), [
    '/browser open "https://example.org" --surface workbench',
    '/browser back --url "https://example.org"',
    '/browser forward --url "https://example.org"',
    '/browser reload --url "https://example.org"',
    '/browser snapshot --url "https://example.org" --screenshot --dom --logs',
    '/browser state --url "https://example.org" --dom --ax --console --network',
    '/browser takeover --url "https://example.org" --approval required',
    '/browser copy-url "https://example.org" --surface workbench',
    '/browser open-external "https://example.org" --approval required',
  ]);
  assert.deepEqual(browserWorkbenchDefaultCommands('https://example.org').map((item) => item.id), [
    'open',
    'back',
    'forward',
    'reload',
    'snapshot',
    'state',
    'takeover',
    'copy-url',
    'open-external',
  ]);
  assert.deepEqual(browserWorkbenchDefaultCommands('https://example.org', { status: 'loading' })[3], {
    id: 'stop',
    label: 'Stop',
    command: '/browser stop --url "https://example.org"',
    disabled: false,
    risk: 'allowed',
    kind: 'terminal-equivalent',
  });
});

test('browser-workbench normalizes scheme-less urls for commands and iframe previews', () => {
  assert.equal(normalizeBrowserWorkbenchUrl('localhost:5175'), 'http://localhost:5175');
  assert.equal(normalizeBrowserWorkbenchUrl('example.org/docs'), 'https://example.org/docs');
  assert.equal(normalizeBrowserWorkbenchUrl('/api/sciforge/browser/proxy?url=https%3A%2F%2Fexample.org'), '/api/sciforge/browser/proxy?url=https%3A%2F%2Fexample.org');
  assert.equal(normalizeBrowserWorkbenchUrl('https://example.org/about:blank'), 'https://example.org/');
  assert.equal(browserWorkbenchDefaultCommands('localhost:5175')[0]?.command, '/browser open "http://localhost:5175" --surface workbench');

  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        previewUrl: 'localhost:5175',
      },
    },
  }));
  assert.match(html, /src="http:\/\/localhost:5175"/);
});

test('browser-workbench keeps proxy materialization out of the interactive browser surface', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        previewUrl: 'https://external.example',
        embedPolicy: {
          embeddable: false,
          reason: 'External embedding blocked',
        },
      },
    },
  }));

  assert.match(html, /data-browser-state-action="open-external"/);
  assert.match(html, /data-command-text="\/browser open-external &quot;https:\/\/external\.example&quot; --approval required"/);
  assert.doesNotMatch(html, /data-browser-state-action="proxy-fallback"|Proxy Snapshot/);
  assert.doesNotMatch(html, /href="\/api\/sciforge\/browser\/proxy/);
  assert.doesNotMatch(html, /href="https:\/\/external\.example/);
  assert.doesNotMatch(html, /https:\/\/\/api\/sciforge\/browser\/proxy/);
});

test('browser-workbench renders host-owned browser surfaces for external pages without direct external anchors', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        externalUrl: 'https://external.example/search',
        frameUrl: 'blob:http://127.0.0.1:5173/browser-host-session-frame',
        frameTransport: 'websocket-binary',
        hostSession: {
          schemaVersion: 'sciforge.browser-host-session.state.v1',
          id: 'session-1',
          owner: 'host',
          providerId: 'sciforge.browser-host-session',
          status: 'ready',
          url: 'https://external.example/search',
          requestedUrl: 'https://external.example/search',
          workspacePath: '/tmp/sciforge',
          startedAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:01.000Z',
          viewport: { width: 1365, height: 900 },
          canGoBack: false,
          canGoForward: false,
          liveSurfaceRef: 'browser-host-session:session-1/live-surface',
          liveSurfaceTransport: 'host-stream',
          singleInteractiveTruth: true,
          frameStreamRef: 'browser-host-session:session-1/frame-stream',
          frameRef: 'browser-host-session:session-1/frame.png',
          screenshotRef: 'browser-host-session:session-1/screenshot.png',
          domSnapshotRef: 'browser-host-session:session-1/dom.html',
          axSnapshotRef: 'browser-host-session:session-1/ax.json',
          consoleLogRef: 'browser-host-session:session-1/console.jsonl',
          networkLogRef: 'browser-host-session:session-1/network.jsonl',
          diagnostics: [],
        },
      },
    },
  }));

  assert.match(html, /data-browser-object-type="host-browser"/);
  assert.match(html, /data-browser-host-surface="browser-host-session"/);
  assert.match(html, /data-browser-live-surface-ref="browser-host-session:session-1\/live-surface"/);
  assert.match(html, /data-browser-live-surface-transport="host-stream"/);
  assert.match(html, /data-browser-single-interactive-truth="true"/);
  assert.match(html, /data-browser-frame-stream-ref="browser-host-session:session-1\/frame-stream"/);
  assert.match(html, /data-browser-frame-transport="websocket-binary"/);
  assert.match(html, /browser-workbench-host-frame/);
  assert.match(html, /data-browser-host-keyboard-focus-key="browser-host-session:session-1"/);
  assert.match(html, /browser-workbench-host-keyboard-input/);
  assert.match(html, /aria-label="Browser keyboard input"/);
  assert.match(html, /data-browser-host-keyboard-path="hidden-input"/);
  assert.match(html, /data-browser-host-keyboard-input="true"/);
  assert.match(html, /data-browser-host-keyboard-restore="session-storage"/);
  assert.match(html, /<img/);
  assert.match(html, /src="blob:http:\/\/127\.0\.0\.1:5173\/browser-host-session-frame"/);
  assert.match(html, /browser-host-session:session-1\/frame\.png/);
  assert.match(html, /browser-host-session:session-1\/ax\.json/);
  assert.match(html, /\/browser open-external &quot;https:\/\/external\.example\/search&quot; --approval required/);
  assert.doesNotMatch(html, /\/api\/sciforge\/browser-host\/sessions\/session-1\/frame|href="https:\/\/external\.example|<iframe|<webview/);
});

test('browser-workbench renders native embedded BrowserHostSession mount without img iframe or webview', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        externalUrl: 'https://external.example/native',
        frameTransport: 'native-embedded',
        hostSession: {
          schemaVersion: 'sciforge.browser-host-session.state.v1',
          id: 'native-session-1',
          owner: 'host',
          providerId: 'sciforge.browser-host-session',
          status: 'ready',
          url: 'https://external.example/native',
          requestedUrl: 'https://external.example/native',
          workspacePath: '/tmp/sciforge',
          startedAt: '2026-06-02T00:00:00.000Z',
          updatedAt: '2026-06-02T00:00:01.000Z',
          viewport: { width: 1365, height: 900 },
          canGoBack: false,
          canGoForward: false,
          liveSurfaceRef: 'browser-host-session:native-session-1/live-surface',
          liveSurfaceTransport: 'native-embedded',
          singleInteractiveTruth: true,
          screenshotRef: 'browser-host-session:native-session-1/screenshot.png',
          domSnapshotRef: 'browser-host-session:native-session-1/dom.html',
          axSnapshotRef: 'browser-host-session:native-session-1/ax.json',
          consoleLogRef: 'browser-host-session:native-session-1/console.jsonl',
          networkLogRef: 'browser-host-session:native-session-1/network.jsonl',
          diagnostics: [],
        },
      },
    },
  }));

  assert.match(html, /data-browser-object-type="host-browser"/);
  assert.match(html, /browser-workbench-host-frame-native/);
  assert.match(html, /data-browser-native-surface="true"/);
  assert.match(html, /data-browser-live-surface-transport="native-embedded"/);
  assert.match(html, /data-browser-single-interactive-truth="true"/);
  assert.match(html, /browser-host-session:native-session-1\/live-surface/);
  assert.doesNotMatch(html, /<img|<iframe|<webview|data-browser-frame-stream-ref="browser-host-session:native-session-1\/frame-stream/);
});

test('browser-workbench renders BrowserHostSession timing diagnostics with transport latency summary', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        externalUrl: 'https://external.example/timing',
        frameUrl: 'blob:http://127.0.0.1:5173/browser-host-session-timing-frame',
        frameTransport: 'websocket-binary',
        hostSession: {
          schemaVersion: 'sciforge.browser-host-session.state.v1',
          id: 'timing-session-1',
          owner: 'host',
          providerId: 'sciforge.browser-host-session',
          status: 'ready',
          url: 'https://external.example/timing',
          requestedUrl: 'https://external.example/timing',
          workspacePath: '/tmp/sciforge',
          startedAt: '2026-06-02T00:00:00.000Z',
          updatedAt: '2026-06-02T00:00:01.000Z',
          viewport: { width: 1365, height: 900 },
          canGoBack: false,
          canGoForward: false,
          liveSurfaceRef: 'browser-host-session:timing-session-1/live-surface',
          liveSurfaceTransport: 'host-stream',
          nativeAdapterUrl: 'http://127.0.0.1:61234',
          singleInteractiveTruth: true,
          frameStreamRef: 'browser-host-session:timing-session-1/frame-stream',
          frameRef: 'browser-host-session:timing-session-1/frame.png',
          diagnostics: [],
          lastActionTiming: {
            actionId: 'ui-click-1',
            action: 'click',
            capture: 'frame',
            status: 'ok',
            uiEventReceivedAt: '2026-06-02T00:00:00.100Z',
            adapterSentAt: '2026-06-02T00:00:00.120Z',
            hostReceivedAt: '2026-06-02T00:00:00.130Z',
            hostStartedAt: '2026-06-02T00:00:00.140Z',
            hostActionEndedAt: '2026-06-02T00:00:00.180Z',
            evidenceCaptureStartedAt: '2026-06-02T00:00:00.190Z',
            evidenceCaptureEndedAt: '2026-06-02T00:00:00.250Z',
            hostCompletedAt: '2026-06-02T00:00:00.260Z',
            adapterToHostMs: 10,
            queueMs: 10,
            hostActionMs: 40,
            evidenceMs: 60,
            totalMs: 130,
            liveSurfaceTransport: 'host-stream',
            paintAckSource: 'host-stream-frame',
          },
          actionTimingSummary: [
            { action: 'click', count: 3, p50Ms: 42, p95Ms: 95, lastMs: 130 },
            { action: 'scroll', count: 2, p50Ms: 31, p95Ms: 64, lastMs: 52 },
          ],
        },
      },
    },
  }));

  assert.match(html, /browser-workbench-viewer-diagnostics/);
  assert.match(html, /data-browser-live-surface-transport="host-stream"/);
  assert.match(html, /data-browser-last-action="click"/);
  assert.match(html, /data-browser-last-action-total-ms="130"/);
  assert.match(html, /transport<\/dt><dd>host-stream/);
  assert.match(html, /nativeAdapterUrl<\/dt><dd>http:\/\/127\.0\.0\.1:61234/);
  assert.match(html, /lastActionTotalMs<\/dt><dd>130/);
  assert.match(html, /latencySummary<\/dt><dd>click:p50=42ms,p95=95ms \| scroll:p50=31ms,p95=64ms/);
});

test('browser-workbench renders system-browser host handoff as state, not a fake iframe', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        externalUrl: 'https://external.example',
        state: {
          status: 'idle',
          url: 'https://external.example',
          hostSurface: 'browser-host-session',
          canRenderFrame: false,
          reason: 'External pages require BrowserHostSession instead of an unsafe iframe.',
        },
      },
    },
  }));

  assert.match(html, /data-browser-object-type="browser-state"/);
  assert.match(html, /data-browser-host-surface="browser-host-session"/);
  assert.match(html, /External pages require BrowserHostSession/);
  assert.match(html, /\/browser open-external &quot;https:\/\/external\.example&quot; --approval required/);
  assert.doesNotMatch(html, /href="\/api\/sciforge\/browser\/proxy|data-browser-state-action="proxy-fallback"|Proxy Snapshot/);
  assert.doesNotMatch(html, /<iframe|<webview|href="https:\/\/external\.example/);
});

test('browser-workbench renders BrowserHostSession frames as host-owned image projections with refs', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        addressValue: 'https://external.example/live',
        frameUrl: '/api/sciforge/browser-host/sessions/host-1/frame',
        hostSession: {
          schemaVersion: 'sciforge.browser-host-session.state.v1',
          id: 'host-1',
          owner: 'host',
          providerId: 'sciforge.browser-host-session',
          status: 'ready',
          url: 'https://external.example/live',
          title: 'External page',
          liveSurfaceRef: 'browser-host-session:host-1/live-surface',
          liveSurfaceTransport: 'host-stream',
          singleInteractiveTruth: true,
          frameStreamRef: 'browser-host-session:host-1/frame-stream',
          frameRef: 'browser-host-session:host-1/frame.png',
          screenshotRef: 'browser-host-session:host-1/screenshot.png',
          domSnapshotRef: 'browser-host-session:host-1/dom.html',
          axSnapshotRef: 'browser-host-session:host-1/ax.json',
          consoleLogRef: 'browser-host-session:host-1/console.jsonl',
          networkLogRef: 'browser-host-session:host-1/network.jsonl',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      },
    },
  }));

  assert.match(html, /data-browser-object-type="host-browser"/);
  assert.match(html, /data-browser-host-surface="browser-host-session"/);
  assert.match(html, /data-browser-live-surface-ref="browser-host-session:host-1\/live-surface"/);
  assert.match(html, /data-browser-frame-stream-ref="browser-host-session:host-1\/frame-stream"/);
  assert.match(html, /<img/);
  assert.match(html, /src="\/api\/sciforge\/browser-host\/sessions\/host-1\/frame"/);
  assert.match(html, /data-browser-frame-ref="browser-host-session:host-1\/frame\.png"/);
  assert.match(html, /browser-frame/);
  assert.match(html, /browser-host-session:host-1\/screenshot\.png/);
  assert.doesNotMatch(html, /<iframe|<webview|\/api\/sciforge\/browser\/proxy/);
});

test('browser-workbench accepts websocket-binary blob frames as the live host surface transport', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        addressValue: 'https://external.example/live',
        frameUrl: 'blob:http://localhost/browser-host-live-frame',
        frameTransport: 'websocket-binary',
        hostSession: {
          schemaVersion: 'sciforge.browser-host-session.state.v1',
          id: 'host-binary',
          owner: 'host',
          providerId: 'sciforge.browser-host-session',
          status: 'ready',
          url: 'https://external.example/live',
          liveSurfaceRef: 'browser-host-session:host-binary/live-surface',
          liveSurfaceTransport: 'host-stream',
          singleInteractiveTruth: true,
          frameStreamRef: 'browser-host-session:host-binary/frame-stream',
          frameRef: 'browser-host-session:host-binary/frame.png',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      },
    },
  }));

  assert.match(html, /data-browser-object-type="host-browser"/);
  assert.match(html, /src="blob:http:\/\/localhost\/browser-host-live-frame"/);
  assert.match(html, /data-browser-frame-transport="websocket-binary"/);
  assert.match(html, /data-browser-single-interactive-truth="true"/);
  assert.doesNotMatch(html, /<iframe|<webview|\/api\/sciforge\/browser\/proxy/);
});

test('browser-workbench canvas-binary experiment is constrained to the same BrowserHostSession frame stream', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        addressValue: 'https://external.example/canvas-live',
        frameRenderer: 'canvas-binary',
        frameTransport: 'websocket-binary',
        hostSession: {
          schemaVersion: 'sciforge.browser-host-session.state.v1',
          id: 'host-canvas',
          owner: 'host',
          providerId: 'sciforge.browser-host-session',
          status: 'ready',
          url: 'https://external.example/canvas-live',
          liveSurfaceRef: 'browser-host-session:host-canvas/live-surface',
          liveSurfaceTransport: 'host-stream',
          singleInteractiveTruth: true,
          frameStreamRef: 'browser-host-session:host-canvas/frame-stream',
          frameRef: 'browser-host-session:host-canvas/frame.png',
          viewport: { width: 1024, height: 768 },
          updatedAt: '2026-06-02T00:00:00.000Z',
        },
      },
    },
  }));

  assert.match(html, /data-browser-object-type="host-browser"/);
  assert.match(html, /browser-workbench-host-frame-canvas/);
  assert.match(html, /<canvas/);
  assert.match(html, /width="1024"/);
  assert.match(html, /height="768"/);
  assert.match(html, /data-browser-frame-renderer="canvas-binary"/);
  assert.match(html, /data-browser-frame-source="browser-host-session-frame-stream-binary"/);
  assert.match(html, /data-browser-frame-session-id="host-canvas"/);
  assert.match(html, /data-browser-frame-stream-ref="browser-host-session:host-canvas\/frame-stream"/);
  assert.match(html, /data-browser-frame-transport="websocket-binary"/);
  assert.match(html, /data-browser-single-interactive-truth="true"/);
  assert.match(html, /data-browser-host-keyboard-path="hidden-input"/);
  assert.match(html, /browser-workbench-host-keyboard-input/);
  assert.match(html, /data-browser-host-keyboard-input="true"/);
  assert.doesNotMatch(html, /<img|<iframe|<webview|html2canvas|\/api\/sciforge\/browser\/proxy|\/api\/sciforge\/browser-host\/sessions\/host-canvas\/frame|src=/);
});

test('browser-workbench refuses canvas-binary rendering for mismatched BrowserHostSession frame streams', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        addressValue: 'https://external.example/canvas-live',
        frameRenderer: 'canvas-binary',
        frameTransport: 'websocket-binary',
        hostSession: {
          schemaVersion: 'sciforge.browser-host-session.state.v1',
          id: 'host-canvas',
          owner: 'host',
          providerId: 'sciforge.browser-host-session',
          status: 'ready',
          url: 'https://external.example/canvas-live',
          liveSurfaceRef: 'browser-host-session:host-canvas/live-surface',
          liveSurfaceTransport: 'host-stream',
          singleInteractiveTruth: true,
          frameStreamRef: 'browser-host-session:other-session/frame-stream',
          frameRef: 'browser-host-session:host-canvas/frame.png',
          viewport: { width: 1024, height: 768 },
          updatedAt: '2026-06-02T00:00:00.000Z',
        },
      },
    },
  }));

  assert.match(html, /data-browser-object-type="browser-state"/);
  assert.doesNotMatch(html, /browser-workbench-host-frame-canvas|<canvas|data-browser-frame-renderer="canvas-binary"|<img|<iframe|<webview/);
});

test('browser-workbench forwards host pointer gestures without owning browser execution', () => {
  const source = readFileSync(new URL('./render.tsx', import.meta.url), 'utf8');

  assert.match(source, /onPointerDown/);
  assert.match(source, /setPointerCapture/);
  assert.match(source, /action: 'mouse-down'/);
  assert.match(source, /onPointerMove/);
  assert.match(source, /action: 'mouse-move'/);
  assert.match(source, /onPointerUp/);
  assert.match(source, /action: 'mouse-up'/);
  assert.match(source, /onContextMenu/);
  assert.match(source, /browserWorkbenchMouseButton/);
});

test('browser-workbench pins host-stream keyboard focus to the hidden input after page clicks', () => {
  const source = readFileSync(new URL('./render.tsx', import.meta.url), 'utf8');

  assert.match(source, /browserWorkbenchHostFrameForTarget/);
  assert.match(source, /target\.closest<HTMLElement>\('\.browser-workbench-host-frame'\)/);
  assert.match(source, /data-browser-host-keyboard-path="hidden-input"/);
  assert.match(source, /data-browser-host-keyboard-focus-key=\{hostKeyboardFocusKey\}/);
  assert.match(source, /data-browser-host-keyboard-restore="session-storage"/);
  assert.match(source, /BROWSER_WORKBENCH_KEYBOARD_FOCUS_STORAGE_PREFIX/);
  assert.match(source, /rememberBrowserWorkbenchKeyboardFocus\(frame\)/);
  assert.match(source, /restoreBrowserWorkbenchKeyboardFocus/);
  assert.match(source, /window\.sessionStorage\.setItem\(key, 'active'\)/);
  assert.match(source, /window\.sessionStorage\.getItem\(key\) !== 'active'/);
  assert.match(source, /data-browser-host-keyboard-input="true"/);
  assert.match(source, /onPointerDownCapture/);
  assert.match(source, /onMouseDownCapture/);
  assert.match(source, /onClickCapture/);
  assert.match(source, /focusBrowserWorkbenchKeyboardInputNow\(input\)/);
  assert.match(source, /window\.requestAnimationFrame\?\.\(\(\) => focusBrowserWorkbenchKeyboardInputNow\(input\)\)/);
  assert.match(source, /setTimeout\(\(\) => focusBrowserWorkbenchKeyboardInputNow\(input\), 0\)/);
});

test('browser-workbench keeps search-box text and edit keys on the BrowserHostSession keyboard path', () => {
  const source = readFileSync(new URL('./render.tsx', import.meta.url), 'utf8');

  assert.match(source, /function sendBrowserWorkbenchInputText\([\s\S]*const sentValue = input\.dataset\.sentValue \?\? '';[\s\S]*const text = value\.startsWith\(sentValue\) \? value\.slice\(sentValue\.length\) : value \|\| fallbackText;[\s\S]*onHostActionRequest\?\.\(\{ action: 'type', text \}\);/);
  assert.match(source, /onCompositionEnd=\{\(event\) => \{[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);[\s\S]*sendBrowserWorkbenchInputText\(event\.currentTarget, payload\.onHostActionRequest, event\.data\);[\s\S]*\}\}/);
  assert.match(source, /onInput=\{\(event\) => \{[\s\S]*event\.stopPropagation\(\);[\s\S]*if \(event\.currentTarget\.dataset\.composing === 'true'\) return;[\s\S]*sendBrowserWorkbenchInputText\(event\.currentTarget, payload\.onHostActionRequest\);[\s\S]*\}\}/);
  assert.match(source, /onKeyDown=\{\(event\) => \{[\s\S]*event\.stopPropagation\(\);[\s\S]*const action = browserWorkbenchKeyboardPressAction\(event\);[\s\S]*if \(!action\) return;[\s\S]*event\.preventDefault\(\);[\s\S]*mirrorBrowserWorkbenchSpecialKey\(event\.currentTarget, event\.key\);[\s\S]*payload\.onHostActionRequest\?\.\(action\);[\s\S]*\}\}/);
  assert.match(source, /function browserWorkbenchKeyboardPressAction\(event: React\.KeyboardEvent\): \{ action: 'press'; key: string \} \| undefined \{[\s\S]*const action = browserWorkbenchKeyAction\(event\);[\s\S]*return action\?\.action === 'press' \? action : undefined;[\s\S]*\}/);
  assert.match(source, /function mirrorBrowserWorkbenchSpecialKey\(input: HTMLTextAreaElement, key: string\) \{[\s\S]*key === 'Backspace'[\s\S]*input\.dataset\.sentValue = input\.value;[\s\S]*key === 'Delete'[\s\S]*input\.dataset\.sentValue = input\.value;/);
});

test('browser-workbench normalizes idle/loading/ready/blocked/error/offline state machine inputs', () => {
  assert.equal(browserWorkbenchStateFromPayload({}, undefined, undefined, undefined).status, 'idle');
  assert.equal(browserWorkbenchStateFromPayload({}, undefined, { id: 'tab', status: 'loading' }, undefined).status, 'loading');
  assert.equal(browserWorkbenchStateFromPayload({}, { id: 'session', mode: 'agent-headless', providerId: 'browser_runtime', tabs: [] }, undefined, undefined).status, 'ready');
  assert.equal(browserWorkbenchStateFromPayload({ embedPolicy: { embeddable: false } }, undefined, undefined, undefined, 'https://blocked.example').status, 'blocked');
  assert.equal(browserWorkbenchStateFromPayload({ errorRef: 'blob://browser/error.json' }, undefined, undefined, undefined).status, 'error');
  assert.equal(browserWorkbenchStateFromPayload({ offlineReason: 'network unreachable' }, undefined, undefined, undefined).status, 'offline');
});

test('browser-workbench renders blocked/error/offline as typed state instead of a white iframe', () => {
  for (const status of ['blocked', 'error', 'offline'] as const) {
    const html = renderToStaticMarkup(renderBrowserWorkbench({
      ...emptyBrowserWorkbenchFixture,
      slot: {
        ...emptyBrowserWorkbenchFixture.slot,
        props: {
          previewUrl: 'https://example.org',
          state: {
            status,
            reason: `${status} reason`,
            ref: `blob://browser/${status}.json`,
          },
        },
      },
    }));

    assert.match(html, new RegExp(`data-status="${status}"`));
    assert.match(html, /data-browser-object-type="browser-state"/);
    assert.match(html, new RegExp(`${status} reason`));
    assert.match(html, new RegExp(`blob://browser/${status}\\.json`));
    assert.doesNotMatch(html, /<iframe/);
  }
});

test('browser-workbench uses embed policy to show external blocked state without embedding', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        previewUrl: 'https://external.example',
        embedPolicy: {
          embeddable: false,
          reason: 'X-Frame-Options or CSP denied embedding',
          ref: 'blob://browser/embed-policy.json',
        },
      },
    },
  }));

  assert.match(html, /data-status="blocked"/);
  assert.match(html, /X-Frame-Options or CSP denied embedding/);
  assert.match(html, /blob:\/\/browser\/embed-policy\.json/);
  assert.doesNotMatch(html, /<iframe/);
  assert.equal(
    browserWorkbenchStateFromPayload(
      { status: 'ready', embedPolicy: { embeddable: false } },
      undefined,
      undefined,
      undefined,
      'https://external.example',
    ).status,
    'blocked',
  );
});

test('browser-workbench rejects inline large refs and keeps safe object refs', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    artifact: {
      ...emptyBrowserWorkbenchFixture.artifact,
      data: {
        snapshot: {
          schemaVersion: 'sciforge.browser-runtime.snapshot.v1',
          url: 'https://example.org',
          screenshotRef: 'data:image/png;base64,AAAA',
          domSnapshotRef: '{"html":"too large"}',
          networkLogRef: 'blob://browser/network.jsonl',
        },
        traceRefs: [
          { kind: 'console-log', ref: 'blob://browser/console.jsonl' },
          { kind: 'dom-snapshot', ref: '[{"node":"inline"}]' },
        ],
      },
    },
  }));

  assert.match(html, /blob:\/\/browser\/network\.jsonl/);
  assert.match(html, /blob:\/\/browser\/console\.jsonl/);
  assert.doesNotMatch(html, /data:image\/png;base64/);
  assert.doesNotMatch(html, /too large/);
  assert.doesNotMatch(html, /inline/);
});

test('browser-workbench imports no TUI runtime or browser provider packages', () => {
  const source = readFileSync(new URL('./render.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /@sciforge-observe\/web|playwright|computer-use|computer_use|child_process|WebSocket|from 'ws'|from "ws"|writeFile|appendFile|execFile|spawn\(|html2canvas|toDataURL|captureStream|getDisplayMedia/);
});
