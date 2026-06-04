import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
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

function assertNoProductFallbackSurface(html: string) {
  assert.doesNotMatch(html, /<iframe|<webview|<canvas|<img/);
  assert.doesNotMatch(html, /browser-workbench-host-frame-canvas|browser-workbench-host-frame-image/);
  assert.doesNotMatch(html, /data-browser-frame-renderer=|data-browser-frame-source=|data-browser-frame-stream-ref=/);
  assert.doesNotMatch(html, /data-browser-webrtc-handoff=|data-browser-http-frame-live-fallback=/);
  assert.doesNotMatch(html, /data-browser-frame-transport="(?:host-stream|websocket-binary|webrtc-data-channel)"/);
  assert.doesNotMatch(html, /src="(?:blob:|\/api\/sciforge\/browser-host\/sessions\/[^"]+\/frame)/);
}

function legacyHostSession(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'sciforge.browser-host-session.state.v1',
    id: 'legacy-session-1',
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
    liveSurfaceRef: 'browser-host-session:legacy-session-1/live-surface',
    liveSurfaceTransport: 'host-stream',
    singleInteractiveTruth: true,
    frameStreamRef: 'browser-host-session:legacy-session-1/frame-stream',
    frameRef: 'browser-host-session:legacy-session-1/frame.png',
    screenshotRef: 'browser-host-session:legacy-session-1/screenshot.png',
    domSnapshotRef: 'browser-host-session:legacy-session-1/dom.html',
    axSnapshotRef: 'browser-host-session:legacy-session-1/ax.json',
    consoleLogRef: 'browser-host-session:legacy-session-1/console.jsonl',
    networkLogRef: 'browser-host-session:legacy-session-1/network.jsonl',
    diagnostics: [],
    ...overrides,
  };
}

function nativeHostSession(overrides: Record<string, unknown> = {}) {
  return {
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
    nativeAdapterUrl: 'http://127.0.0.1:61234',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    screenshotRef: 'browser-host-session:native-session-1/screenshot.png',
    domSnapshotRef: 'browser-host-session:native-session-1/dom.html',
    axSnapshotRef: 'browser-host-session:native-session-1/ax.json',
    consoleLogRef: 'browser-host-session:native-session-1/console.jsonl',
    networkLogRef: 'browser-host-session:native-session-1/network.jsonl',
    diagnostics: [],
    ...overrides,
  };
}

function nativeSurfaceStabilityKey(html: string) {
  const match = html.match(/data-browser-native-surface-stability-key="([^"]+)"/);
  assert.ok(match?.[1], 'expected native surface stability key');
  return match[1];
}

type TestReactElement = React.ReactElement<Record<string, unknown> & { children?: React.ReactNode }>;

function findReactElement(node: React.ReactNode, predicate: (element: TestReactElement) => boolean): TestReactElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findReactElement(child, predicate);
      if (match) return match;
    }
    return undefined;
  }
  if (!React.isValidElement(node)) return undefined;
  const element = node as TestReactElement;
  if (predicate(element)) return element;
  const children = element.props.children;
  if (children === undefined || children === null) return undefined;
  return findReactElement(React.Children.toArray(children), predicate);
}

function requiredReactElement(node: React.ReactNode, predicate: (element: TestReactElement) => boolean): TestReactElement {
  const element = findReactElement(node, predicate);
  assert.ok(element, 'expected matching React element');
  return element;
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
  assert.match(html, /data-browser-command-id="open"/);
  assert.match(html, /data-browser-command-id="annotate"/);
  assert.match(html, /data-browser-command-kind="composer-reference"/);
  assert.match(html, /\/browser annotate --url &quot;http:\/\/localhost:5173\/&quot; --coordinate-space browser-viewport --target viewport/);
  assert.doesNotMatch(html, /data-browser-command-id="(?:snapshot|state|takeover|copy-url|open-external)"/);
  assert.doesNotMatch(html, /\/browser (?:snapshot|state|takeover|copy-url|open-external)\b/);
  assertNoProductFallbackSurface(html);
});

test('browser-workbench renders an empty state without pretending to own browser execution', () => {
  const html = htmlFor(emptyBrowserWorkbenchFixture);

  assert.match(html, /data-status="idle"/);
  assert.match(html, /data-browser-object-type="browser-state"/);
  assert.match(html, /No browser runtime projection is attached/);
  assert.match(html, /\/browser open &quot;about:blank&quot; --surface workbench/);
  assert.doesNotMatch(html, /playwright_browser_automation/);
  assertNoProductFallbackSurface(html);
});

test('browser-workbench keeps host-declared previews as typed state while filtering non-toolbar commands', () => {
  const html = htmlFor(selectionBrowserWorkbenchFixture);

  assert.match(html, /data-browser-object-type="browser-state"/);
  assert.match(html, /http:\/\/localhost:5173\//);
  assert.match(html, /Visible takeover requires TUI-host approval/);
  assert.match(html, /data-browser-command-id="annotate"/);
  assert.doesNotMatch(html, /data-browser-command-id="(?:snapshot|state|takeover|copy-url|open-external)"/);
  assertNoProductFallbackSurface(html);
});

test('browser-workbench default commands expose annotate as a composer-reference command', () => {
  assert.deepEqual(browserWorkbenchDefaultCommands('https://example.org').map((item) => item.command), [
    '/browser open "https://example.org" --surface workbench',
    '/browser back --url "https://example.org"',
    '/browser forward --url "https://example.org"',
    '/browser reload --url "https://example.org"',
    '/browser annotate --url "https://example.org" --coordinate-space browser-viewport --target viewport',
  ]);
  assert.deepEqual(browserWorkbenchDefaultCommands('https://example.org').map((item) => item.id), [
    'open',
    'back',
    'forward',
    'reload',
    'annotate',
  ]);
  assert.deepEqual(browserWorkbenchDefaultCommands('https://example.org', { status: 'loading' })[3], {
    id: 'stop',
    label: 'Stop',
    command: '/browser stop --url "https://example.org"',
    disabled: false,
    risk: 'allowed',
    kind: 'terminal-equivalent',
  });
  assert.deepEqual(browserWorkbenchDefaultCommands('https://example.org', { canAnnotate: false })[4], {
    id: 'annotate',
    label: 'Annotate',
    command: '/browser annotate --url "https://example.org" --coordinate-space browser-viewport --target viewport',
    disabled: true,
    risk: 'allowed',
    kind: 'composer-reference',
  });
});

test('browser-workbench normalizes scheme-less urls without iframe materialization', () => {
  assert.equal(normalizeBrowserWorkbenchUrl('localhost:5175'), 'http://localhost:5175');
  assert.equal(normalizeBrowserWorkbenchUrl('LOCALHOST:5175/app'), 'http://LOCALHOST:5175/app');
  assert.equal(normalizeBrowserWorkbenchUrl('127.0.0.1:5175/app'), 'http://127.0.0.1:5175/app');
  assert.equal(normalizeBrowserWorkbenchUrl('example.org/docs'), 'https://example.org/docs');
  assert.equal(normalizeBrowserWorkbenchUrl('HTTP://example.org/docs'), 'HTTP://example.org/docs');
  assert.equal(normalizeBrowserWorkbenchUrl('HTTPS://example.org/docs'), 'HTTPS://example.org/docs');
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
  assert.match(html, /http:\/\/localhost:5175/);
  assert.match(html, /data-browser-object-type="browser-state"/);
  assertNoProductFallbackSurface(html);
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

  assert.match(html, /data-browser-state="blocked"/);
  assert.doesNotMatch(html, /data-browser-state-action="open-external"|\/browser open-external/);
  assert.doesNotMatch(html, /data-browser-state-action="proxy-fallback"|Proxy Snapshot/);
  assert.doesNotMatch(html, /href="\/api\/sciforge\/browser\/proxy/);
  assert.doesNotMatch(html, /href="https:\/\/external\.example/);
  assert.doesNotMatch(html, /https:\/\/\/api\/sciforge\/browser\/proxy/);
  assertNoProductFallbackSurface(html);
});

test('browser-workbench preserves legacy host-stream refs as typed state, not a live surface', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        externalUrl: 'https://external.example/search',
        frameUrl: 'blob:http://127.0.0.1:5173/browser-host-session-frame',
        frameTransport: 'websocket-binary',
        hostSession: legacyHostSession({ id: 'session-1' }),
      },
    },
  }));

  assert.match(html, /data-browser-object-type="browser-state"/);
  assert.match(html, /data-browser-host-surface="browser-host-session"/);
  assert.match(html, /browser-host-session:session-1/);
  assert.match(html, /browser-host-session:legacy-session-1\/frame\.png/);
  assert.match(html, /browser-host-session:legacy-session-1\/ax\.json/);
  assert.doesNotMatch(html, /\/browser open-external &quot;https:\/\/external\.example\/search&quot; --approval required/);
  assert.doesNotMatch(html, /data-browser-live-surface-ref="browser-host-session:session-1\/live-surface"/);
  assertNoProductFallbackSurface(html);
});

test('browser-workbench renders native embedded BrowserHostSession mount without img iframe or webview', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        externalUrl: 'https://external.example/native',
        frameTransport: 'native-embedded',
        hostSession: nativeHostSession(),
      },
    },
  }));

  assert.match(html, /data-browser-object-type="host-browser"/);
  assert.match(html, /browser-workbench-host-frame-native/);
  assert.match(html, /data-browser-native-surface="true"/);
  assert.match(html, /data-browser-live-surface-transport="native-embedded"/);
  assert.match(html, /data-browser-single-interactive-truth="true"/);
  assert.match(html, /data-browser-second-truth-source="false"/);
  assert.match(html, /browser-host-session:native-session-1\/live-surface/);
  assert.doesNotMatch(html, /<img|<iframe|<canvas|<webview|data-browser-frame-stream-ref=/);
});

test('browser-workbench wires native host pointer events in browser viewport coordinates', () => {
  const actions: unknown[] = [];
  const element = renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        externalUrl: 'https://external.example/native',
        frameTransport: 'native-embedded',
        hostSession: nativeHostSession(),
        onHostActionRequest: (action: unknown) => actions.push(action),
      },
    },
  });
  const hostFrame = requiredReactElement(element, (candidate) => {
    const className = typeof candidate.props.className === 'string' ? candidate.props.className : '';
    return className.includes('browser-workbench-host-frame-native');
  });
  const target = {
    getBoundingClientRect: () => ({ left: 100.4, top: 50.4, width: 500, height: 300 }),
    focus: () => undefined,
  };
  const pointerEvent = {
    currentTarget: target,
    clientX: 150.6,
    clientY: 75.4,
    button: 0,
    buttons: 1,
    preventDefault: () => undefined,
  };

  assert.equal(typeof hostFrame.props.onPointerDown, 'function');
  assert.equal(typeof hostFrame.props.onPointerMove, 'function');
  assert.equal(typeof hostFrame.props.onPointerUp, 'function');
  assert.equal(typeof hostFrame.props.onDoubleClick, 'function');
  assert.equal(typeof hostFrame.props.onWheel, 'function');

  (hostFrame.props.onPointerDown as (event: typeof pointerEvent) => void)(pointerEvent);
  (hostFrame.props.onPointerMove as (event: typeof pointerEvent) => void)({ ...pointerEvent, clientX: 160.2, clientY: 90.9 });
  (hostFrame.props.onPointerUp as (event: typeof pointerEvent) => void)({ ...pointerEvent, button: 0, buttons: 0 });
  (hostFrame.props.onDoubleClick as (event: typeof pointerEvent) => void)({ ...pointerEvent, button: 0, buttons: 0 });
  (hostFrame.props.onWheel as (event: typeof pointerEvent & { deltaX: number; deltaY: number }) => void)({
    ...pointerEvent,
    buttons: 0,
    deltaX: 4,
    deltaY: 32,
  });

  assert.deepEqual(actions, [
    { action: 'mouse-down', x: 50, y: 25, button: 'left' },
    { action: 'mouse-move', x: 60, y: 41, button: 'left' },
    { action: 'mouse-up', x: 50, y: 25, button: 'left' },
    { action: 'double-click', x: 50, y: 25, button: 'left' },
    { action: 'scroll', x: 50, y: 25, deltaX: 4, deltaY: 32 },
  ]);
});

test('browser-workbench captures point and box annotations with comments in browser viewport coordinates', () => {
  const actions: unknown[] = [];
  const annotations: unknown[] = [];
  const element = renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        externalUrl: 'https://external.example/native',
        frameTransport: 'native-embedded',
        hostSession: nativeHostSession(),
        onHostActionRequest: (action: unknown) => actions.push(action),
        onAnnotationRequest: (annotation: unknown) => annotations.push(annotation),
      },
    },
  });
  const annotateButton = requiredReactElement(element, (candidate) => {
    return candidate.props['data-browser-command-id'] === 'annotate';
  });
  const hostFrame = requiredReactElement(element, (candidate) => {
    const className = typeof candidate.props.className === 'string' ? candidate.props.className : '';
    return className.includes('browser-workbench-host-frame-native');
  });
  const annotationForm = requiredReactElement(element, (candidate) => {
    return candidate.props['data-browser-annotation-editor'] === 'true';
  });
  const target = {
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 500, height: 300 }),
    focus: () => undefined,
  };
  const eventAt = (clientX: number, clientY: number, buttons = 1) => ({
    currentTarget: target,
    clientX,
    clientY,
    button: 0,
    buttons,
    preventDefault: () => undefined,
  });
  const submitComment = (comment: string) => ({
    preventDefault: () => undefined,
    currentTarget: {
      elements: {
        namedItem: (name: string) => name === 'browser-annotation-comment' ? { value: comment } : null,
      },
    },
  });

  (annotateButton.props.onClick as () => void)();
  (hostFrame.props.onPointerDown as (event: ReturnType<typeof eventAt>) => void)(eventAt(160, 90));
  (hostFrame.props.onPointerUp as (event: ReturnType<typeof eventAt>) => void)(eventAt(160, 90, 0));
  (annotationForm.props.onSubmit as (event: ReturnType<typeof submitComment>) => void)(submitComment('Point note'));

  (annotateButton.props.onClick as () => void)();
  (hostFrame.props.onPointerDown as (event: ReturnType<typeof eventAt>) => void)(eventAt(400, 250));
  (hostFrame.props.onPointerMove as (event: ReturnType<typeof eventAt>) => void)(eventAt(220, 140));
  (hostFrame.props.onPointerUp as (event: ReturnType<typeof eventAt>) => void)(eventAt(220, 140, 0));
  (annotationForm.props.onSubmit as (event: ReturnType<typeof submitComment>) => void)(submitComment('Box note'));

  assert.deepEqual(actions, []);
  assert.deepEqual(annotations, [
    {
      schemaVersion: 'sciforge.browser-workbench.annotation-request.v1',
      source: 'browser-workbench',
      sourceKind: 'browser',
      coordinateSpace: 'browser-viewport',
      selectionKind: 'point',
      point: { x: 60, y: 40 },
      bounds: { x: 60, y: 40, width: 1, height: 1 },
      comment: 'Point note',
    },
    {
      schemaVersion: 'sciforge.browser-workbench.annotation-request.v1',
      source: 'browser-workbench',
      sourceKind: 'browser',
      coordinateSpace: 'browser-viewport',
      selectionKind: 'box',
      point: { x: 210, y: 145 },
      bounds: { x: 120, y: 90, width: 180, height: 110 },
      comment: 'Box note',
    },
  ]);
  assert.doesNotMatch(JSON.stringify(annotations), /rawDom|rawScreenshot|data:image|base64|<html/i);
});

test('browser-workbench rejects native embedded sessions without explicit no-second-truth proof', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        externalUrl: 'https://external.example/native',
        frameTransport: 'native-embedded',
        hostSession: nativeHostSession({ secondTruthSource: undefined }),
      },
    },
  }));

  assert.match(html, /data-browser-object-type="browser-state"/);
  assert.doesNotMatch(html, /data-browser-native-surface="true"/);
  assert.doesNotMatch(html, /browser-workbench-host-frame-native/);
  assertNoProductFallbackSurface(html);
});

test('browser-workbench keeps native surface stable across loading refs diagnostics and topbar state changes', () => {
  const baseHostSession = nativeHostSession({
    status: 'loading',
    canGoBack: false,
    canGoForward: false,
    diagnostics: ['initial bounded diagnostic'],
    loadingProgress: {
      state: 'navigation-committed',
      reason: 'host-loading',
      source: 'host-session',
      status: 'loading',
    },
  });
  const updatedHostSession = nativeHostSession({
    status: 'loading',
    canGoBack: true,
    canGoForward: true,
    diagnostics: ['updated bounded diagnostic', 'refs updated without surface remount'],
    loadingProgress: {
      state: 'retry',
      reason: 'navigation-retry',
      source: 'host-progress',
      status: 'loading',
      canRetry: true,
    },
    screenshotRef: 'browser-host-session:native-session-1/screenshot-updated.png',
    domSnapshotRef: 'browser-host-session:native-session-1/dom-updated.html',
  });
  const baseHtml = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        externalUrl: 'https://external.example/native',
        hostSession: baseHostSession,
      },
    },
  }));
  const updatedHtml = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        externalUrl: 'https://external.example/native',
        hostSession: updatedHostSession,
        traceRefs: [
          { kind: 'console-log', ref: 'browser-host-session:native-session-1/console-updated.jsonl' },
        ],
        commands: browserWorkbenchDefaultCommands('https://external.example/native', {
          status: 'loading',
          canGoBack: true,
          canGoForward: true,
        }),
        writerDiagnostic: {
          status: 'ok',
          effectiveDisplayUrl: 'http://127.0.0.1:6173',
        },
      },
    },
  }));

  assert.equal(nativeSurfaceStabilityKey(baseHtml), nativeSurfaceStabilityKey(updatedHtml));
  assert.match(updatedHtml, /data-status="loading"/);
  assert.match(updatedHtml, /data-browser-object-type="host-browser"/);
  assert.match(updatedHtml, /data-browser-loading-progress-state="retry"/);
  assert.match(updatedHtml, /data-browser-native-surface-stability-key="native-session-1:browser-host-session:native-session-1\/live-surface"/);
  assert.match(updatedHtml, /browser-host-session:native-session-1\/dom-updated\.html/);
  assertNoProductFallbackSurface(baseHtml);
  assertNoProductFallbackSurface(updatedHtml);
});

test('browser-workbench renders bounded actor cursor status on the native surface', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        hostSession: nativeHostSession({
          actorCursor: {
            agentId: 'agent-blue',
            cursorId: 'cursor-blue',
            color: '#00d5ff',
            label: 'Agent Blue token=secret',
            status: 'acting',
            target: {
              type: 'browser-pane',
              sessionId: 'native-session-1',
              windowRef: 'browser-host-session:native-session-1',
            },
            lastAction: {
              action: 'click',
              status: 'completed',
              evidenceRefs: ['browser-host-session:native-session-1/visible-actions/click.json'],
            },
            evidenceRefs: ['browser-host-session:native-session-1/actor-cursors/cursor-blue.json'],
          },
        }),
      },
    },
  }));

  assert.match(html, /data-browser-native-surface="true"/);
  assert.match(html, /data-browser-actor-cursor-count="1"/);
  assert.match(html, /data-browser-actor-agent-id="agent-blue"/);
  assert.match(html, /data-browser-actor-cursor-id="cursor-blue"/);
  assert.match(html, /data-browser-actor-cursor-status="acting"/);
  assert.match(html, /data-browser-actor-cursor-action="click"/);
  assert.match(html, /data-browser-actor-cursor-evidence-ref="browser-host-session:native-session-1\/visible-actions\/click\.json"/);
  assert.match(html, /Agent Blue token=\[redacted\]/);
  assert.doesNotMatch(html, /secret|rawDom|data:image|base64|https?:\/\/example\.invalid/);
  assertNoProductFallbackSurface(html);
});

test('browser-workbench renders bounded visible action, risk, and automation summary diagnostics', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        hostSession: nativeHostSession({
          visibleAction: {
            actionId: 'checkout-submit',
            action: 'click',
            riskType: 'payment',
            visibleActionRef: 'browser-host-session:native-session-1/visible-actions/checkout-submit.json',
          },
          riskLedger: [
            {
              actionId: 'type-password',
              action: 'type',
              riskType: 'credential',
              visibleActionRef: 'browser-host-session:native-session-1/visible-actions/type-password.json',
              recordedAt: '2026-06-02T00:00:02.000Z',
            },
            {
              actionId: 'checkout-submit',
              action: 'click',
              riskType: 'payment',
              visibleActionRef: 'browser-host-session:native-session-1/visible-actions/checkout-submit.json',
              recordedAt: '2026-06-02T00:00:03.000Z',
            },
          ],
          automationSummary: {
            schemaVersion: 'sciforge.browser-runtime.automation-summary.v1',
            boundedRefsOnly: true,
            kind: 'test',
            status: 'completed',
            title: 'Checkout regression for https://private.example/checkout?token=secret',
            summary: 'Ran checkout assertions against raw <html> secret-token payload',
            itemCount: 4,
            refs: [
              { kind: 'dom-snapshot', ref: 'browser-host-session:native-session-1/dom-checkout.json' },
              { kind: 'console-log', ref: 'browser-host-session:native-session-1/console-checkout.jsonl' },
            ],
            diagnostics: ['raw private.example URL and token dropped'],
          },
        }),
      },
    },
  }));

  assert.match(html, /data-browser-visible-action="click"/);
  assert.match(html, /data-browser-visible-action-risk="payment"/);
  assert.match(html, /data-browser-visible-action-ref="browser-host-session:native-session-1\/visible-actions\/checkout-submit\.json"/);
  assert.match(html, /data-browser-risk-ledger-summary="type:credential \| click:payment"/);
  assert.match(html, /data-browser-automation-kind="test"/);
  assert.match(html, /data-browser-automation-status="completed"/);
  assert.match(html, /data-browser-automation-ref-count="2"/);
  assert.match(html, /automationSummary/);
  assert.doesNotMatch(html, /private\.example|secret-token|token=secret|raw &lt;html|raw <html/i);
  assertNoProductFallbackSurface(html);
});

test('browser-workbench renders missing native attach as typed blocked handoff retry refs only', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        externalUrl: 'https://external.example/native',
        hostSession: nativeHostSession({
          diagnostics: ['Native attach bridge unavailable; retry BrowserHostSession or request handoff.'],
          frameRef: 'browser-host-session:native-session-1/frame-evidence.png',
          screenshotRef: 'browser-host-session:native-session-1/screenshot-evidence.png',
        }),
        state: {
          status: 'blocked',
          url: 'https://external.example/native',
          hostSurface: 'browser-host-session',
          canRenderFrame: false,
          reason: 'Native embedded BrowserHostSession attach bridge is unavailable.',
          ref: 'browser:host-surface/right-pane/blocked',
          loadingProgress: {
            state: 'handoff',
            reason: 'user-handoff-required',
            source: 'host-error',
            status: 'blocked',
            canRetry: true,
            blocked: true,
            requiresHandoff: true,
          },
        },
      },
    },
  }));

  assert.match(html, /data-browser-object-type="browser-state"/);
  assert.match(html, /data-browser-host-surface="browser-host-session"/);
  assert.match(html, /data-browser-loading-progress-state="handoff"/);
  assert.match(html, /data-browser-loading-progress-can-retry="true"/);
  assert.match(html, /data-browser-loading-progress-requires-handoff="true"/);
  assert.match(html, /data-browser-state-action="retry"/);
  assert.doesNotMatch(html, /data-browser-state-action="handoff"|\/browser open-external/);
  assert.match(html, /browser-host-session:native-session-1\/frame-evidence\.png/);
  assert.doesNotMatch(html, /data-browser-native-surface="true"|data-browser-live-surface-ref=|data-browser-frame-transport="native-embedded"/);
  assertNoProductFallbackSurface(html);
});

test('browser-workbench renders reachable native-surface route with unavailable right-pane bridge as bounded handoff diagnostics', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        externalUrl: 'https://external.example/native-route',
        hostSession: nativeHostSession({
          id: 'native-route-session-1',
          url: 'https://external.example/native-route',
          requestedUrl: 'https://external.example/native-route',
          liveSurfaceRef: undefined,
          nativeSurfaceBridge: {
            routeStatus: 'reachable',
            capability: 'missing',
            rightPaneBridge: false,
            status: 'native-bridge-unavailable',
            healthPath: '/api/sciforge/browser-host/native-surface/health',
            statePath: '/api/sciforge/browser-host/native-surface/state',
            attachPath: '/api/sciforge/browser-host/native-surface/attach',
          },
        }),
        writerDiagnostic: {
          status: 'missing-browser-host-capability',
          effectiveDisplayUrl: 'http://127.0.0.1:6173',
          health: {
            ok: true,
            service: 'sciforge-workspace-writer',
            capabilities: ['workspace-files', 'browser-host-session'],
          },
        },
        state: {
          status: 'blocked',
          url: 'https://external.example/native-route',
          hostSurface: 'browser-host-session',
          canRenderFrame: false,
          reason: 'Native surface route is reachable, but the right pane native bridge is unavailable.',
          ref: 'browser:host-surface/right-pane/native-bridge-unavailable',
          loadingProgress: {
            state: 'handoff',
            reason: 'native-bridge-unavailable',
            source: 'native-surface-route',
            status: 'blocked',
            canRetry: true,
            blocked: true,
            requiresHandoff: true,
          },
        },
      },
    },
  }));

  assert.match(html, /data-browser-object-type="browser-state"/);
  assert.match(html, /data-browser-loading-progress-state="handoff"/);
  assert.match(html, /data-browser-loading-progress-reason="native-bridge-unavailable"/);
  assert.match(html, /data-browser-loading-progress-source="native-surface-route"/);
  assert.match(html, /data-browser-native-surface-route-status="reachable"/);
  assert.match(html, /data-browser-native-surface-capability="missing"/);
  assert.match(html, /data-browser-right-pane-bridge="false"/);
  assert.match(html, /data-browser-native-surface-bridge-status="native-bridge-unavailable"/);
  assert.match(html, /nativeSurfaceBridge<\/dt><dd>native-bridge-unavailable:route=reachable,capability=missing,rightPaneBridge=false/);
  assert.match(html, /healthCapability<\/dt><dd>browser-host-session:ready,browser-host-native-surface:missing,browser-host-search:missing/);
  assert.match(html, /data-browser-state-action="retry"/);
  assert.doesNotMatch(html, /data-browser-state-action="handoff"|\/browser open-external/);
  assert.match(html, /data-browser-command-id="annotate"/);
  assert.doesNotMatch(html, /data-browser-command-id="(?:snapshot|state|takeover|copy-url|open-external)"/);
  assert.doesNotMatch(html, /data-browser-native-surface="true"|data-browser-live-surface-ref=|data-browser-frame-transport="native-embedded"/);
  assertNoProductFallbackSurface(html);
});

test('browser-workbench renders native BrowserHostSession timing diagnostics with transport latency summary', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        externalUrl: 'https://external.example/timing',
        frameTransport: 'native-embedded',
        hostSession: nativeHostSession({
          id: 'timing-session-1',
          liveSurfaceRef: 'browser-host-session:timing-session-1/live-surface',
          lastActionTiming: {
            actionId: 'ui-click-1',
            action: 'click',
            capture: 'none',
            status: 'ok',
            uiEventReceivedAt: '2026-06-02T00:00:00.100Z',
            adapterSentAt: '2026-06-02T00:00:00.120Z',
            hostReceivedAt: '2026-06-02T00:00:00.130Z',
            hostStartedAt: '2026-06-02T00:00:00.140Z',
            hostActionEndedAt: '2026-06-02T00:00:00.180Z',
            hostCompletedAt: '2026-06-02T00:00:00.260Z',
            adapterToHostMs: 10,
            queueMs: 10,
            hostActionMs: 40,
            totalMs: 130,
            liveSurfaceTransport: 'native-embedded',
            paintAckSource: 'native-adapter-action-state',
          },
          actionTimingSummary: [
            { action: 'click', count: 3, p50Ms: 42, p95Ms: 95, lastMs: 130 },
            { action: 'scroll', count: 2, p50Ms: 31, p95Ms: 64, lastMs: 52 },
          ],
        }),
      },
    },
  }));

  assert.match(html, /browser-workbench-viewer-diagnostics/);
  assert.match(html, /data-browser-diagnostic-live-surface-transport="native-embedded"/);
  assert.match(html, /data-browser-last-action="click"/);
  assert.match(html, /data-browser-last-action-total-ms="130"/);
  assert.match(html, /transport<\/dt><dd>native-embedded/);
  assert.match(html, /nativeAdapterUrl<\/dt><dd>http:\/\/127\.0\.0\.1:61234/);
  assert.match(html, /lastActionTotalMs<\/dt><dd>130/);
  assert.match(html, /latencySummary<\/dt><dd>click:p50=42ms,p95=95ms \| scroll:p50=31ms,p95=64ms/);
});

test('browser-workbench renders bounded actionable diagnostics for blocked host errors', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        externalUrl: 'https://external.example/private',
        hostSession: nativeHostSession({
          id: 'blocked-session-1',
          status: 'failed',
          url: 'https://external.example/private',
          requestedUrl: 'https://external.example/private',
          workspaceWriterBaseUrl: 'http://127.0.0.1:6173/api/sciforge?token=sk-writer-secret-123456',
          liveSurfaceRef: 'browser-host-session:blocked-session-1/live-surface',
          nativeAdapterUrl: 'http://127.0.0.1:6180/native?apiKey=sk-native-secret-123456',
          diagnostics: [
            'data:image/png;base64,AAAA',
            'Retry same native surface through http://127.0.0.1:6173/api?token=sk-retry-secret-123456',
          ],
          lastActionTiming: {
            actionId: 'ui-click-blocked',
            action: 'click',
            capture: 'none',
            status: 'failed',
            uiEventReceivedAt: '2026-06-02T00:00:00.100Z',
            adapterSentAt: '2026-06-02T00:00:00.120Z',
            hostReceivedAt: '2026-06-02T00:00:00.130Z',
            hostStartedAt: '2026-06-02T00:00:00.140Z',
            hostActionEndedAt: '2026-06-02T00:00:00.180Z',
            hostCompletedAt: '2026-06-02T00:00:00.260Z',
            adapterToHostMs: 10,
            queueMs: 10,
            hostActionMs: 40,
            totalMs: 130,
            liveSurfaceTransport: 'native-embedded',
            paintAckSource: 'native-adapter-action-state',
            blockedReason: 'Native adapter blocked https://external.example/private?token=sk-page-secret-123456',
          },
        }),
        writerDiagnostic: {
          status: 'missing-browser-host-capability',
          configuredDisplayUrl: 'http://127.0.0.1:6173/ui?token=sk-config-secret-123456',
          diagnosticRef: 'browser-host-writer-missing-browser-host-capability',
          message: 'Writer missing BrowserHostSession for http://127.0.0.1:6173/ui?token=sk-message-secret-123456',
          health: {
            ok: true,
            service: 'sciforge-workspace-writer',
            capabilities: ['workspace-files', 'browser-host-session'],
          },
        },
      },
    },
  }));

  assert.match(html, /data-status="error"/);
  assert.match(html, /browser-workbench-viewer-diagnostics/);
  assert.match(html, /data-browser-writer-url="http:\/\/127\.0\.0\.1:6173"/);
  assert.match(html, /data-browser-health-capability="browser-host-session:ready,browser-host-native-surface:missing,browser-host-search:missing"/);
  assert.match(html, /data-browser-native-adapter-url="http:\/\/127\.0\.0\.1:6180"/);
  assert.match(html, /data-browser-diagnostic-live-surface-transport="native-embedded"/);
  assert.match(html, /data-browser-last-action-timing="click:130ms:failed"/);
  assert.match(html, /writerUrl<\/dt><dd>http:\/\/127\.0\.0\.1:6173/);
  assert.match(html, /healthCapability<\/dt><dd>browser-host-session:ready,browser-host-native-surface:missing,browser-host-search:missing/);
  assert.match(html, /nativeAdapterUrl<\/dt><dd>http:\/\/127\.0\.0\.1:6180/);
  assert.match(html, /blockedReason<\/dt><dd>Native adapter blocked \[url-redacted\]/);
  assert.match(html, /diagnostics<\/dt><dd>Retry same native surface through http:\/\/127\.0\.0\.1:6173/);
  assert.doesNotMatch(html, /token=|apiKey=|sk-(?:writer|native|page|config|message|retry)-secret|data:image|base64|external\.example\/private\?token|<iframe|<webview/);
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
  assert.doesNotMatch(html, /\/browser open-external &quot;https:\/\/external\.example&quot; --approval required/);
  assert.doesNotMatch(html, /href="\/api\/sciforge\/browser\/proxy|data-browser-state-action="proxy-fallback"|Proxy Snapshot/);
  assertNoProductFallbackSurface(html);
});

test('browser-workbench keeps legacy frame material as refs-first state only', () => {
  const html = renderToStaticMarkup(renderBrowserWorkbench({
    ...emptyBrowserWorkbenchFixture,
    slot: {
      ...emptyBrowserWorkbenchFixture.slot,
      props: {
        addressValue: 'https://external.example/live',
        frameUrl: '/api/sciforge/browser-host/sessions/host-1/frame',
        hostSession: legacyHostSession({
          id: 'host-1',
          url: 'https://external.example/live',
          title: 'External page',
          liveSurfaceRef: 'browser-host-session:host-1/live-surface',
          frameStreamRef: 'browser-host-session:host-1/frame-stream',
          frameRef: 'browser-host-session:host-1/frame.png',
          screenshotRef: 'browser-host-session:host-1/screenshot.png',
        }),
      },
    },
  }));

  assert.match(html, /data-browser-object-type="browser-state"/);
  assert.match(html, /browser-host-session:host-1\/frame\.png/);
  assert.match(html, /browser-frame/);
  assert.match(html, /browser-host-session:host-1\/screenshot\.png/);
  assertNoProductFallbackSurface(html);
});

test('browser-workbench rejects websocket, canvas, and WebRTC fallback claims as product live surfaces', () => {
  const cases = [
    {
      name: 'websocket blob',
      props: {
        addressValue: 'https://external.example/live',
        frameUrl: 'blob:http://localhost/browser-host-live-frame',
        frameTransport: 'websocket-binary',
        hostSession: legacyHostSession({
          id: 'host-binary',
          liveSurfaceRef: 'browser-host-session:host-binary/live-surface',
          frameStreamRef: 'browser-host-session:host-binary/frame-stream',
          frameRef: 'browser-host-session:host-binary/frame.png',
        }),
      },
    },
    {
      name: 'canvas-binary',
      props: {
        addressValue: 'https://external.example/canvas-live',
        frameRenderer: 'canvas-binary',
        frameTransport: 'websocket-binary',
        hostSession: legacyHostSession({
          id: 'host-canvas',
          liveSurfaceRef: 'browser-host-session:host-canvas/live-surface',
          frameStreamRef: 'browser-host-session:host-canvas/frame-stream',
          frameRef: 'browser-host-session:host-canvas/frame.png',
          viewport: { width: 1024, height: 768 },
        }),
      },
    },
    {
      name: 'webrtc candidate',
      props: {
        addressValue: 'https://external.example/webrtc-live',
        frameRenderer: 'canvas-binary',
        frameTransport: 'webrtc-data-channel',
        liveTransportHandoff: {
          status: 'candidate-contract',
          claim: 'bridge-to-right-pane-canvas-handoff-only',
          claimScope: 'candidate-only',
          owner: 'BrowserHostSession',
          rightPaneSurfaceOwner: 'BrowserHostSession',
          productSurface: 'right-pane-browser',
          renderTarget: 'canvas',
          frameRenderer: 'canvas-binary',
          frameTransport: 'webrtc-data-channel',
          fallbackTransport: 'websocket-binary',
          liveSurfaceTransportCandidate: 'webrtc-data-channel',
          hostSessionRef: 'browser-host-session:host-webrtc',
          liveSurfaceRef: 'browser-host-session:host-webrtc/live-surface',
          frameStreamRef: 'browser-host-session:host-webrtc/frame-stream',
          inlineFrameBytes: false,
          inlineSignals: false,
          secondViewer: false,
          secondTruthSource: false,
          httpFrameLiveFallback: false,
          fullyPassedClaim: false,
          realUiWebRtcPassClaim: false,
          loopbackEvidenceOnly: false,
          httpFrameRouteClaim: false,
        },
        hostSession: legacyHostSession({
          id: 'host-webrtc',
          liveSurfaceRef: 'browser-host-session:host-webrtc/live-surface',
          frameStreamRef: 'browser-host-session:host-webrtc/frame-stream',
          frameRef: 'browser-host-session:host-webrtc/frame.png',
          viewport: { width: 1280, height: 720 },
        }),
      },
    },
  ];

  for (const item of cases) {
    const html = renderToStaticMarkup(renderBrowserWorkbench({
      ...emptyBrowserWorkbenchFixture,
      slot: {
        ...emptyBrowserWorkbenchFixture.slot,
        props: item.props,
      },
    }));
    assert.match(html, /data-browser-object-type="browser-state"/, item.name);
    assertNoProductFallbackSurface(html);
  }
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
    assertNoProductFallbackSurface(html);
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
  assertNoProductFallbackSurface(html);
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

test('browser-workbench source has no product live fallback DOM/input transport', () => {
  const source = readFileSync(new URL('./render.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /<iframe|<webview|<canvas|<img/);
  assert.doesNotMatch(source, /BrowserWorkbenchFrameRenderer|BrowserWorkbenchLiveTransportHandoff|frameRenderer|liveTransportHandoff/);
  assert.doesNotMatch(source, /browser-workbench-host-keyboard-input|setPointerCapture/);
  assert.doesNotMatch(source, /canvas-binary|webrtc-data-channel|websocket-binary|host-stream/);
  assert.match(source, /function browserWorkbenchFramePoint/);
  assert.match(source, /onPointerDown/);
  assert.match(source, /onPointerMove/);
  assert.match(source, /onPointerUp/);
  assert.match(source, /browser-workbench-host-frame-native/);
  assert.match(source, /data-browser-native-surface/);
  assert.match(source, /data-browser-native-surface-stability-key/);
  assert.match(source, /data-browser-loading-progress-state/);
  assert.match(source, /data-browser-live-surface-transport=\{hostSession\?\.liveSurfaceTransport\}/);
  assert.match(source, /data-browser-second-truth-source=\{hostSession\?\.secondTruthSource === false \? 'false' : undefined\}/);
});

test('browser-workbench imports no TUI runtime or browser provider packages', () => {
  const source = readFileSync(new URL('./render.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /@sciforge-observe\/web|playwright|computer-use|computer_use|child_process|WebSocket|from 'ws'|from "ws"|writeFile|appendFile|execFile|spawn\(|html2canvas|toDataURL|captureStream|getDisplayMedia|createObjectURL|createImageBitmap/);
});
