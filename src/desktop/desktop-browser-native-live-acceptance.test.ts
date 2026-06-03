import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DESKTOP_BROWSER_NATIVE_REAL_EXTERNAL_NAVIGATION_SCHEMA,
  validateDesktopBrowserNativeLiveAcceptanceEvidence,
  validateDesktopBrowserNativeRealExternalNavigationEvidence,
  type DesktopBrowserNativeLiveAcceptanceEvidence,
  type DesktopBrowserNativeRealExternalNavigationEvidence,
} from './desktop-browser-native-live-acceptance.js';

test('desktop native live pass requires a refs-first M0 surfing loop projection', () => {
  const evidence = validDesktopNativeLiveEvidence();

  const validation = validateDesktopBrowserNativeLiveAcceptanceEvidence(evidence);

  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('Desktop Browser native live evidence must include a passed refs-first M0 surfing loop.'));
});

test('desktop native live pass accepts a bounded M0 surfing loop projection', () => {
  const evidence = validDesktopNativeLiveEvidence({ withM0SurfingLoop: true });

  const validation = validateDesktopBrowserNativeLiveAcceptanceEvidence(evidence);

  assert.equal(validation.canClaimPass, true);
  assert.deepEqual(validation.blockReasons, []);
});

test('desktop native M0 surfing loop rejects non-native transport', () => {
  const evidence = validDesktopNativeLiveEvidence({ withM0SurfingLoop: true });
  assert.ok(evidence.m0SurfingLoop);
  evidence.m0SurfingLoop.transport.liveSurfaceTransport = 'host-stream';

  const validation = validateDesktopBrowserNativeLiveAcceptanceEvidence(evidence);

  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('Desktop Browser native live evidence must include a passed refs-first M0 surfing loop.'));
});

test('desktop native live pass rejects raw URL evidence outside the bounded M0 projection', () => {
  const evidence = validDesktopNativeLiveEvidence({ withM0SurfingLoop: true }) as unknown as Record<string, unknown>;
  evidence.nativeAdapter = {
    ...(evidence.nativeAdapter as Record<string, unknown>),
    url: 'http://127.0.0.1:43210/raw-leak',
  };

  const validation = validateDesktopBrowserNativeLiveAcceptanceEvidence(
    evidence as unknown as DesktopBrowserNativeLiveAcceptanceEvidence,
  );

  assert.equal(validation.canClaimPass, false);
  assert.match(validation.blockReasons.join('\n'), /raw URLs, DOM, screenshots, provider payloads, or secrets/);
});

test('desktop native M0 surfing loop rejects extra raw payload keys', () => {
  const evidence = validDesktopNativeLiveEvidence({ withM0SurfingLoop: true }) as unknown as {
    m0SurfingLoop: Record<string, unknown>;
  };
  evidence.m0SurfingLoop.rawDomPayload = '<html><body>leak</body></html>';
  evidence.m0SurfingLoop.screenshotBase64 = 'data:image/png;base64,aaaa';
  evidence.m0SurfingLoop.providerPayload = { token: 'secret' };
  evidence.m0SurfingLoop.secretValue = 'secret-value';

  const validation = validateDesktopBrowserNativeLiveAcceptanceEvidence(
    evidence as unknown as DesktopBrowserNativeLiveAcceptanceEvidence,
  );

  assert.equal(validation.canClaimPass, false);
  assert.match(validation.blockReasons.join('\n'), /raw URLs, DOM, screenshots, provider payloads, or secrets/);
});

test('desktop native real external navigation accepts bounded public navigation evidence', () => {
  const validation = validateDesktopBrowserNativeRealExternalNavigationEvidence(validRealExternalNavigationEvidence());

  assert.equal(validation.canClaimPass, true);
  assert.deepEqual(validation.blockReasons, []);
});

test('desktop native real external navigation rejects raw URL and local target evidence', () => {
  const evidence = validRealExternalNavigationEvidence() as unknown as Record<string, unknown>;
  evidence.rawUrl = 'https://example.invalid/raw-leak';
  evidence.targetEvidence = {
    ...(evidence.targetEvidence as Record<string, unknown>),
    publicTarget: false,
    privateNetworkTarget: true,
  };

  const validation = validateDesktopBrowserNativeRealExternalNavigationEvidence(
    evidence as unknown as DesktopBrowserNativeRealExternalNavigationEvidence,
  );

  assert.equal(validation.canClaimPass, false);
  assert.match(validation.blockReasons.join('\n'), /public external URL/);
  assert.match(validation.blockReasons.join('\n'), /raw URLs, DOM, screenshots, provider payloads, or secrets/);
});

function validDesktopNativeLiveEvidence(options: { withM0SurfingLoop?: boolean } = {}): DesktopBrowserNativeLiveAcceptanceEvidence {
  return {
    schemaVersion: 'sciforge.desktop.browser-native-live-acceptance.v1',
    status: 'passed',
    source: 'desktop-native-browser-pane-smoke',
    observedAt: '2026-06-02T00:00:00.000Z',
    canClaimDesktopNativeLivePass: true,
    claimScope: 'desktop-native-embedded-browser-pane-live',
    nativeAdapter: {
      endpoint: { length: 22, hash: '0123456789abcdef', loopbackHttp: true },
      healthOk: true,
      service: 'sciforge-desktop-browser-host-surface',
      owner: 'BrowserHostSession',
      adapterRole: 'display-input-adapter',
      liveSurfaceTransport: 'native-embedded',
      secondTruthSource: false,
      audit: {
        schemaVersion: 'sciforge.desktop.browser-host-surface.audit.v1',
        stateRequests: 3,
        screenshotRequests: 0,
        frameStreamRequests: 0,
        actionRequests: 1,
        recentRequestCount: 4,
      },
    },
    browserHostSession: {
      id: 'browser-host-test-1',
      owner: 'host',
      providerId: 'sciforge.browser-host-session',
      status: 'ready',
      requestedUrl: { length: 23, hash: '0123456789abcdef' },
      url: { length: 23, hash: 'fedcba9876543210' },
      liveSurfaceTransport: 'native-embedded',
      nativeAdapterEndpoint: { length: 22, hash: '0123456789abcdef', loopbackHttp: true },
      singleInteractiveTruth: true,
      frameStreamRefPresent: false,
      frameRefPresent: false,
      frameUrlPresent: false,
    },
    surface: {
      ok: true,
      owner: 'BrowserHostSession',
      adapterRole: 'display-input-adapter',
      surface: 'electron-web-contents-view',
      liveSurfaceTransport: 'native-embedded',
      singleInteractiveTruth: true,
      embedded: true,
      secondTruthSource: false,
      visible: true,
      loading: false,
      bounds: { x: 10, y: 20, width: 640, height: 480 },
    },
    interaction: {
      targetUrl: { length: 23, hash: '0123456789abcdef' },
      typedTokenObserved: true,
      textProbe: 'native-adapter-text-endpoint',
      actionTimingTransport: 'native-embedded',
      paintAckSource: 'native-adapter-action-state',
      actionAck: {
        action: 'click',
        capture: 'frame',
        status: 'ok',
        screenshotRequestsDuringAck: 0,
        frameStreamRequestsDuringAck: 0,
        dependsOnScreenshot: false,
        dependsOnFrameStream: false,
        evidenceCaptureStarted: false,
        evidenceCaptureEnded: false,
      },
      stateHeartbeat: {
        source: 'native-adapter-state-endpoint',
        url: { length: 23, hash: 'fedcba9876543210' },
        urlMatchesTarget: true,
        title: 'Desktop native fixture',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        browserHostStatus: 'ready',
        stateRequestsAfterAction: 2,
        lightweightStateUpdated: true,
      },
    },
    rejectedDesktopLiveSubstitutes: {
      iframe: false,
      proxy: false,
      webview: false,
      snapshot: false,
      frameStream: false,
      systemPopup: false,
      externalBrowser: false,
    },
    m0SurfingLoop: options.withM0SurfingLoop ? {
      schemaVersion: 'sciforge.desktop.browser-native-live-acceptance.m0-surfing-loop.v1',
      status: 'passed',
      claimScope: 'desktop-native-m0-surfing-loop',
      passClaim: true,
      shell: 'desktop-right-pane',
      owner: 'BrowserHostSession',
      adapterRole: 'display-input-adapter',
      refsFirst: true,
      evidenceMode: 'bounded-refs-and-summaries',
      sessionRef: 'browser-host-session:browser-host-test-1',
      liveSurfaceRef: 'browser-host-session:browser-host-test-1/live-surface',
      nativeAdapterRef: 'native-adapter:loopback:0123456789abcdef',
      surfaceRef: 'desktop-native-surface:electron-web-contents-view:0123456789abcdef',
      transport: {
        liveSurfaceTransport: 'native-embedded',
        frameTransport: 'native-embedded',
        surfaceType: 'electron-web-contents-view',
      },
      health: {
        nativeAdapterHealthOk: true,
        nativeAdapterService: 'sciforge-desktop-browser-host-surface',
        nativeStateHeartbeat: true,
        actionAckSource: 'native-adapter-action-state',
      },
      urlEvidence: {
        requested: { length: 23, hash: '0123456789abcdef' },
        final: { length: 23, hash: 'fedcba9876543210' },
        rawUrlCaptured: false,
      },
      actionCoverage: {
        open: actionEvidence('open'),
        click: actionEvidence('click'),
        type: { ...actionEvidence('type'), textLength: 16, textHash: '1111111111111111' },
        scroll: actionEvidence('scroll'),
        drag: actionEvidence('drag'),
        reload: actionEvidence('reload'),
        back: actionEvidence('back'),
        forward: actionEvidence('forward'),
        stop: actionEvidence('stop'),
      },
      inputHotPath: {
        dependsOnScreenshot: false,
        dependsOnFrameStream: false,
        screenshotRequestsDuringAck: 0,
        frameStreamRequestsDuringAck: 0,
      },
      singleInteractiveTruth: true,
      secondTruthSource: false,
      noLegacyFallback: {
        hostStream: false,
        canvas: false,
        webRtc: false,
        httpFrame: false,
        snapshot: false,
        iframe: false,
        proxy: false,
        webview: false,
        systemPopup: false,
        externalBrowser: false,
      },
      payloadPolicy: {
        rawDom: false,
        rawLogs: false,
        rawScreenshot: false,
        base64: false,
        providerPayload: false,
        secret: false,
      },
      coverageGaps: [],
    } : undefined,
    verificationCommand: 'npm run smoke:desktop-browser-native-live-acceptance --silent',
    strictVerificationCommand: 'SCIFORGE_REQUIRE_DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE=1 npm run smoke:desktop-browser-native-live-acceptance --silent',
  };
}

function validRealExternalNavigationEvidence(): DesktopBrowserNativeRealExternalNavigationEvidence {
  return {
    schemaVersion: DESKTOP_BROWSER_NATIVE_REAL_EXTERNAL_NAVIGATION_SCHEMA,
    status: 'passed',
    claimScope: 'desktop-native-real-external-navigation',
    passClaim: true,
    configuredBy: 'SCIFORGE_DESKTOP_BROWSER_NATIVE_REAL_EXTERNAL_TARGET_JSON',
    shell: 'desktop-right-pane',
    owner: 'BrowserHostSession',
    refsFirst: true,
    evidenceMode: 'bounded-refs-and-summaries',
    sessionRef: 'browser-host-session:browser-host-test-1',
    liveSurfaceRef: 'browser-host-session:browser-host-test-1/live-surface',
    transport: {
      liveSurfaceTransport: 'native-embedded',
      frameTransport: 'native-embedded',
      surfaceType: 'electron-web-contents-view',
    },
    targetEvidence: {
      mode: 'real-external-url-config',
      requestedUrl: { length: 20, hash: '0123456789abcdef' },
      finalUrl: { length: 20, hash: 'fedcba9876543210' },
      publicTarget: true,
      privateNetworkTarget: false,
      hardcodedSitePassClaim: false,
      rawUrlCaptured: false,
      rawDomCaptured: false,
    },
    actionCoverage: {
      open: realExternalActionEvidence('open'),
      navigate: realExternalActionEvidence('navigate'),
      reload: realExternalActionEvidence('reload'),
      back: realExternalActionEvidence('back'),
      forward: realExternalActionEvidence('forward'),
      stop: realExternalActionEvidence('stop'),
    },
    lifecycle: {
      addressCommitted: true,
      navigationStart: true,
      navigationCommitted: true,
      interactive: true,
      load: true,
      networkQuiet: true,
    },
    singleInteractiveTruth: true,
    secondTruthSource: false,
    noLegacyFallback: {
      hostStream: false,
      canvas: false,
      webRtc: false,
      httpFrame: false,
      snapshot: false,
      iframe: false,
      proxy: false,
      webview: false,
      systemPopup: false,
      externalBrowser: false,
    },
    payloadPolicy: {
      rawDom: false,
      rawLogs: false,
      rawScreenshot: false,
      base64: false,
      providerPayload: false,
      secret: false,
    },
    coverageGaps: [],
  };
}

function realExternalActionEvidence(action: string) {
  return {
    status: 'passed' as const,
    latencyMs: 18,
    resultRef: `browser-host-session:browser-host-test-1/real-external/${action}`,
  };
}

function actionEvidence(action: string) {
  return {
    status: 'passed' as const,
    latencyMs: 12,
    resultRef: `browser-host-session:browser-host-test-1/m0/${action}`,
  };
}
