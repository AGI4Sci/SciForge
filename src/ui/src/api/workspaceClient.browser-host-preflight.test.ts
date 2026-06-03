import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { SciForgeConfig } from '../domain';
import {
  BROWSER_HOST_NATIVE_SURFACE_CAPABILITY,
  BROWSER_HOST_SEARCH_CAPABILITY,
  BROWSER_HOST_SESSION_CAPABILITY,
  browserHostSessionFrameStreamUrl,
  browserHostSessionWebRtcSignalingUrl,
  preflightBrowserHostSessionWriter,
  sendBrowserHostComputerUseAction,
  sendBrowserHostSessionAction,
  startRuntimeServices,
  startBrowserHostSession,
} from './workspaceClient';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('browser host session writer preflight', () => {
  it('accepts a current Workspace Writer with BrowserHostSession capabilities', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return jsonResponse(writerHealth(currentBrowserHostCapabilities()));
    }) as typeof fetch;

    const result = await preflightBrowserHostSessionWriter(testConfig(), { timeoutMs: 1_000 });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'ready');
    assert.equal(result.effectiveBaseUrl, 'http://127.0.0.1:6173');
    assert.equal(result.configuredDisplayUrl, 'http://127.0.0.1:6173');
    assert.deepEqual(calls, ['http://127.0.0.1:6173/health']);
  });

  it('blocks UI HTML health responses and recommends a BrowserHostSession-capable default writer', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('http://127.0.0.1:5173/')) {
        return htmlResponse('<!doctype html><html><body>SciForge UI</body></html>');
      }
      return jsonResponse(writerHealth(currentBrowserHostCapabilities()));
    }) as typeof fetch;

    const result = await preflightBrowserHostSessionWriter({
      ...testConfig(),
      workspaceWriterBaseUrl: 'http://127.0.0.1:5173',
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'ui-html');
    assert.equal(result.recommendedBaseUrl, 'http://127.0.0.1:5174');
    assert.equal(result.candidates[0]?.ok, true);
    assert.match(result.message, /BrowserHostSession/);
    assert.deepEqual(calls, ['http://127.0.0.1:5173/health', 'http://127.0.0.1:5174/health']);
  });

  it('starts BrowserHostSession on the recommended writer and carries the effective writer URL for diagnostic frame reads', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url === 'http://127.0.0.1:5173/health') {
        return htmlResponse('<html><body>Vite app shell</body></html>');
      }
      if (url === 'http://127.0.0.1:5174/health') {
        return jsonResponse(writerHealth(currentBrowserHostCapabilities()));
      }
      if (url === 'http://127.0.0.1:5174/api/sciforge/browser-host/sessions/start') {
        return jsonResponse({
          ok: true,
          session: {
            schemaVersion: 'sciforge.browser-host-session.state.v1',
            id: 'browser-host-test',
            owner: 'host',
            providerId: 'sciforge.browser-host-session',
            status: 'ready',
            workspacePath: '/tmp/sciforge',
            requestedUrl: 'https://example.org',
            url: 'https://example.org/',
            startedAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:01.000Z',
            viewport: { width: 1365, height: 900 },
            canGoBack: false,
            canGoForward: false,
            frameRef: 'browser-host-session:browser-host-test/frame.png',
            screenshotRef: 'browser-host-session:browser-host-test/screenshot.png',
            domSnapshotRef: 'browser-host-session:browser-host-test/dom.html',
            axSnapshotRef: 'browser-host-session:browser-host-test/ax.json',
            consoleLogRef: 'browser-host-session:browser-host-test/console.jsonl',
            networkLogRef: 'browser-host-session:browser-host-test/network.jsonl',
            diagnostics: [],
          },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await startBrowserHostSession({
      ...testConfig(),
      workspaceWriterBaseUrl: 'http://127.0.0.1:5173',
    }, { url: 'https://example.org' });

    assert.equal(result.session.id, 'browser-host-test');
    assert.equal(result.session.workspaceWriterBaseUrl, 'http://127.0.0.1:5174');
    assert.equal(result.preflight?.recommendedBaseUrl, 'http://127.0.0.1:5174');
    assert.deepEqual(calls, [
      'http://127.0.0.1:5173/health',
      'http://127.0.0.1:5174/health',
      'http://127.0.0.1:5174/api/sciforge/browser-host/sessions/start',
    ]);
  });

  it('tries the configured BrowserHostSession start route when health preflight transiently times out', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/health')) {
        throw new Error('signal timed out');
      }
      if (url === 'http://127.0.0.1:6173/api/sciforge/browser-host/sessions/start') {
        return jsonResponse({
          ok: true,
          session: {
            schemaVersion: 'sciforge.browser-host-session.state.v1',
            id: 'browser-host-timeout-fallback',
            owner: 'host',
            providerId: 'sciforge.browser-host-session',
            status: 'ready',
            workspacePath: '/tmp/sciforge',
            requestedUrl: 'https://example.org',
            url: 'https://example.org/',
            startedAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:01.000Z',
            viewport: { width: 1365, height: 900 },
            canGoBack: false,
            canGoForward: false,
            frameRef: 'browser-host-session:browser-host-timeout-fallback/frame.png',
            diagnostics: [],
          },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await startBrowserHostSession(testConfig(), { url: 'https://example.org' });

    assert.equal(result.session.id, 'browser-host-timeout-fallback');
    assert.equal(result.session.workspaceWriterBaseUrl, 'http://127.0.0.1:6173');
    assert.match(result.preflight?.message ?? '', /not reachable/);
    assert.ok(calls.includes('http://127.0.0.1:6173/api/sciforge/browser-host/sessions/start'));
  });

  it('blocks stale Workspace Writers that lack BrowserHostSession capabilities', async () => {
    globalThis.fetch = (async () => jsonResponse(writerHealth(['workspace-files']))) as typeof fetch;

    const result = await preflightBrowserHostSessionWriter(testConfig());

    assert.equal(result.ok, false);
    assert.equal(result.status, 'missing-browser-host-capability');
    assert.match(result.message, /browser-host-session/);
    assert.match(result.message, /browser-host-native-surface/);
    assert.match(result.message, /browser-host-search/);
  });

  it('blocks stale Workspace Writers that only advertise diagnostic frame transports without native surface endpoints', async () => {
    globalThis.fetch = (async () => jsonResponse(writerHealth(
      currentBrowserHostCapabilities(),
      {
        browserHostSession: '/api/sciforge/browser-host/sessions/{start,state,actions,computer-use-actions,frame,frame-stream}',
        browserHostSearch: '/api/sciforge/browser-host/search',
      },
    ))) as typeof fetch;

    const result = await preflightBrowserHostSessionWriter(testConfig());

    assert.equal(result.ok, false);
    assert.equal(result.status, 'missing-browser-host-capability');
    assert.match(result.message, /browserHostNativeSurface/);
    assert.match(result.message, /native surface health, attach, and state/);
    assert.doesNotMatch(result.message, /frame-stream/);
  });

  it('accepts native BrowserHostSession surface readiness without frame or frame-stream endpoints', async () => {
    globalThis.fetch = (async () => jsonResponse(writerHealth(
      currentBrowserHostCapabilities(),
      {
        browserHostSession: '/api/sciforge/browser-host/sessions/{start,state,actions,computer-use-actions}',
        browserHostNativeSurface: '/api/sciforge/browser-host/native-surface/{health,attach,state}',
        browserHostSearch: '/api/sciforge/browser-host/search',
      },
    ))) as typeof fetch;

    const result = await preflightBrowserHostSessionWriter(testConfig());

    assert.equal(result.ok, true);
    assert.equal(result.status, 'ready');
    assert.doesNotMatch(result.message, /frame-stream/);
  });

  it('requests native surface readiness when starting services for the Browser pane', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(input), '/api/sciforge/runtime/start');
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return jsonResponse({
        ok: false,
        services: [{
          id: 'workspace',
          label: 'Workspace Writer',
          ok: false,
          status: 'native-surface-adapter-missing',
          detail: 'BrowserHostSession live browser sessions require a Desktop native surface adapter.',
        }],
      });
    }) as typeof fetch;

    const result = await startRuntimeServices({ requireBrowserHostNativeSurface: true });

    assert.deepEqual(requestBody, { requireBrowserHostNativeSurface: true });
    assert.equal(result.ok, false);
    assert.equal(result.services[0]?.status, 'native-surface-adapter-missing');
  });

  it('autostarts native-capable runtime before BrowserHostSession writer retry', async () => {
    const calls: string[] = [];
    let runtimeStartBody: Record<string, unknown> | undefined;
    let healthAttempts = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url === 'http://127.0.0.1:6173/health') {
        healthAttempts += 1;
        return jsonResponse(healthAttempts === 1
          ? writerHealth([
              BROWSER_HOST_SESSION_CAPABILITY,
              BROWSER_HOST_SEARCH_CAPABILITY,
            ], {
              browserHostSession: '/api/sciforge/browser-host/sessions/{start,state,actions,computer-use-actions}',
              browserHostSearch: '/api/sciforge/browser-host/search',
            })
          : writerHealth(currentBrowserHostCapabilities()));
      }
      if (url === '/api/sciforge/runtime/start') {
        runtimeStartBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return jsonResponse({
          ok: true,
          services: [{
            id: 'workspace',
            label: 'Workspace Writer',
            ok: true,
            status: 'running',
          }],
        });
      }
      if (url === 'http://127.0.0.1:6173/api/sciforge/browser-host/sessions/start') {
        return jsonResponse({
          ok: true,
          session: {
            schemaVersion: 'sciforge.browser-host-session.state.v1',
            id: 'browser-host-native-autostart',
            owner: 'host',
            providerId: 'sciforge.browser-host-session',
            status: 'ready',
            workspacePath: '/tmp/sciforge',
            requestedUrl: 'https://example.org',
            url: 'https://example.org/',
            startedAt: '2026-06-03T00:00:00.000Z',
            updatedAt: '2026-06-03T00:00:01.000Z',
            viewport: { width: 1365, height: 900 },
            canGoBack: false,
            canGoForward: false,
            liveSurfaceRef: 'browser-host-session:browser-host-native-autostart/live-surface',
            liveSurfaceTransport: 'native-embedded',
            singleInteractiveTruth: true,
            secondTruthSource: false,
            diagnostics: [],
          },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await startBrowserHostSession(testConfig(), { url: 'https://example.org' });

    assert.deepEqual(runtimeStartBody, { requireBrowserHostNativeSurface: true });
    assert.equal(result.session.id, 'browser-host-native-autostart');
    assert.deepEqual(calls, [
      'http://127.0.0.1:6173/health',
      'http://127.0.0.1:5174/health',
      '/api/sciforge/runtime/start',
      'http://127.0.0.1:6173/health',
      'http://127.0.0.1:6173/api/sciforge/browser-host/sessions/start',
    ]);
  });

  it('sends requested capture mode with BrowserHostSession actions', async () => {
    let actionBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'http://127.0.0.1:6173/api/sciforge/browser-host/sessions/session-a/actions') {
        actionBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return jsonResponse({
          ok: true,
          session: {
            schemaVersion: 'sciforge.browser-host-session.state.v1',
            id: 'session-a',
            owner: 'host',
            providerId: 'sciforge.browser-host-session',
            status: 'ready',
            workspacePath: '/tmp/sciforge',
            requestedUrl: 'https://example.org',
            url: 'https://example.org',
            startedAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:01.000Z',
            viewport: { width: 1365, height: 900 },
            canGoBack: false,
            canGoForward: false,
            frameRef: 'browser-host-session:session-a/frame.png',
            diagnostics: [],
          },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    await sendBrowserHostSessionAction(testConfig(), 'session-a', {
      action: 'type',
      text: 'hello',
      capture: 'frame',
    });

    assert.equal(actionBody?.capture, 'frame');
    assert.equal(actionBody?.action, 'type');
    assert.equal(actionBody?.text, 'hello');
  });

  it('sends Computer Use actions through the BrowserHostSession host route without system input', async () => {
    let actionBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'http://127.0.0.1:6173/api/sciforge/browser-host/sessions/session-a/computer-use-actions') {
        actionBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return jsonResponse({
          ok: true,
          result: {
            schemaVersion: 'sciforge.browser-host-session.computer-use-action.v1',
            providerId: 'sciforge.browser-host-session.computer-use-adapter',
            inputChannel: 'browser-host-session',
            userDeviceImpact: 'none',
            sharedSystemInputUsed: false,
            systemMouseEvents: 'not-sent',
            systemKeyboardEvents: 'not-sent',
            liveBrowserOwner: 'BrowserHostSession',
            singleInteractiveTruth: true,
            hostAction: { action: 'scroll', deltaX: 12, deltaY: -24, capture: 'none' },
            session: {
              schemaVersion: 'sciforge.browser-host-session.state.v1',
              id: 'session-a',
              owner: 'host',
              providerId: 'sciforge.browser-host-session',
              status: 'ready',
              workspacePath: '/tmp/sciforge',
              requestedUrl: 'https://example.org',
              url: 'https://example.org',
              startedAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:01.000Z',
              viewport: { width: 1365, height: 900 },
              canGoBack: false,
              canGoForward: false,
              liveSurfaceRef: 'browser-host-session:session-a/live-surface',
              liveSurfaceTransport: 'native-embedded',
              nativeAdapterUrl: 'http://127.0.0.1:4999',
              singleInteractiveTruth: true,
              frameRef: 'browser-host-session:session-a/frame.png',
              diagnostics: [],
            },
          },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await sendBrowserHostComputerUseAction(testConfig(), 'session-a', {
      action: { type: 'wheel', deltaX: 12, deltaY: -24 },
      capture: 'none',
    });

    assert.equal(actionBody?.capture, 'none');
    assert.deepEqual(actionBody?.action, { type: 'wheel', deltaX: 12, deltaY: -24 });
    assert.equal(result.inputChannel, 'browser-host-session');
    assert.equal(result.userDeviceImpact, 'none');
    assert.equal(result.systemMouseEvents, 'not-sent');
    assert.equal(result.liveBrowserOwner, 'BrowserHostSession');
    assert.equal(result.singleInteractiveTruth, true);
    assert.equal(result.session.liveSurfaceRef, 'browser-host-session:session-a/live-surface');
    assert.equal(result.session.workspaceWriterBaseUrl, 'http://127.0.0.1:6173');
  });

  it('builds BrowserHostSession frame stream WebSocket URLs for the host-owned surface', () => {
    assert.equal(
      browserHostSessionFrameStreamUrl(testConfig(), {
        schemaVersion: 'sciforge.browser-host-session.state.v1',
        id: 'session-a',
        owner: 'host',
        providerId: 'sciforge.browser-host-session',
        status: 'ready',
        workspacePath: '/tmp/sciforge',
        requestedUrl: 'https://example.org',
        url: 'https://example.org',
        startedAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:01.000Z',
        viewport: { width: 1365, height: 900 },
        canGoBack: false,
        canGoForward: false,
        frameStreamRef: 'browser-host-session:session-a/frame-stream',
        diagnostics: [],
      }, { intervalMs: 200, quietWindowMs: 80 }),
      'ws://127.0.0.1:6173/api/sciforge/browser-host/sessions/session-a/frame-stream?workspacePath=%2Ftmp%2Fsciforge&intervalMs=200&quietWindowMs=80',
    );
    assert.equal(
      browserHostSessionFrameStreamUrl(testConfig(), {
        schemaVersion: 'sciforge.browser-host-session.state.v1',
        id: 'session-a',
        owner: 'host',
        providerId: 'sciforge.browser-host-session',
        status: 'ready',
        workspacePath: '/tmp/sciforge',
        requestedUrl: 'https://example.org',
        url: 'https://example.org',
        startedAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:01.000Z',
        viewport: { width: 1365, height: 900 },
        canGoBack: false,
        canGoForward: false,
        frameStreamRef: 'browser-host-session:session-a/frame-stream',
        diagnostics: [],
      }, { maxBufferedBytes: 131072 }),
      'ws://127.0.0.1:6173/api/sciforge/browser-host/sessions/session-a/frame-stream?workspacePath=%2Ftmp%2Fsciforge&maxBufferedBytes=131072',
    );
  });

  it('builds BrowserHostSession WebRTC signaling URLs without making the endpoint a readiness preflight requirement', async () => {
    assert.equal(
      browserHostSessionWebRtcSignalingUrl(testConfig(), {
        schemaVersion: 'sciforge.browser-host-session.state.v1',
        id: 'session-a',
        owner: 'host',
        providerId: 'sciforge.browser-host-session',
        status: 'ready',
        workspacePath: '/tmp/sciforge',
        requestedUrl: 'https://example.org',
        url: 'https://example.org',
        startedAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:01.000Z',
        viewport: { width: 1365, height: 900 },
        canGoBack: false,
        canGoForward: false,
        liveSurfaceTransport: 'webrtc-data-channel',
        liveSurfaceRef: 'browser-host-session:session-a/live-surface',
        frameStreamRef: 'browser-host-session:session-a/frame-stream',
        singleInteractiveTruth: true,
        diagnostics: [],
      }),
      'http://127.0.0.1:6173/api/sciforge/browser-host/sessions/session-a/webrtc-signaling?workspacePath=%2Ftmp%2Fsciforge&transport=webrtc-data-channel&role=adapter',
    );

    globalThis.fetch = (async () => jsonResponse(writerHealth(
      currentBrowserHostCapabilities(),
      {
        browserHostSession: '/api/sciforge/browser-host/sessions/{start,state,actions,computer-use-actions}',
        browserHostNativeSurface: '/api/sciforge/browser-host/native-surface/{health,attach,state}',
        browserHostSearch: '/api/sciforge/browser-host/search',
      },
    ))) as typeof fetch;

    const result = await preflightBrowserHostSessionWriter(testConfig());

    assert.equal(result.ok, true);
    assert.equal(result.status, 'ready');
  });
});

function testConfig(): SciForgeConfig {
  return {
    schemaVersion: 1,
    agentServerBaseUrl: 'http://127.0.0.1:18080',
    workspaceWriterBaseUrl: 'http://127.0.0.1:6173',
    workspacePath: '/tmp/sciforge',
    agentBackend: 'codex',
    modelProvider: 'openai',
    modelBaseUrl: '',
    modelName: 'test-model',
    apiKey: '',
    requestTimeoutMs: 30000,
    maxContextWindowTokens: 128000,
    visionAllowSharedSystemInput: false,
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

function writerHealth(capabilities: string[], endpoints: Record<string, string> = {
  browserHostSession: '/api/sciforge/browser-host/sessions/{start,state,actions,computer-use-actions}',
  browserHostNativeSurface: '/api/sciforge/browser-host/native-surface/{health,attach,state}',
  browserHostDiagnostics: '/api/sciforge/browser-host/sessions/{frame,frame-stream}',
  browserHostSearch: '/api/sciforge/browser-host/search',
}) {
  return {
    ok: true,
    service: 'sciforge-workspace-writer',
    schemaVersion: 1,
    capabilities,
    endpoints,
  };
}

function currentBrowserHostCapabilities() {
  return [
    BROWSER_HOST_SESSION_CAPABILITY,
    BROWSER_HOST_NATIVE_SURFACE_CAPABILITY,
    BROWSER_HOST_SEARCH_CAPABILITY,
  ];
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html' },
  });
}
