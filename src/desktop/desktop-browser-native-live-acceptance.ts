export const DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE_SCHEMA = 'sciforge.desktop.browser-native-live-acceptance.v1';

export type DesktopBrowserNativeLiveAcceptanceStatus = 'passed' | 'blocked' | 'failed';

export type DesktopBrowserNativeLiveAcceptanceBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesktopBrowserNativeLiveAcceptanceEvidence = {
  schemaVersion: typeof DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE_SCHEMA;
  status: DesktopBrowserNativeLiveAcceptanceStatus;
  source: 'desktop-native-browser-pane-smoke';
  observedAt: string;
  canClaimDesktopNativeLivePass: boolean;
  claimScope: 'desktop-native-embedded-browser-pane-live' | 'blocked-or-diagnostic';
  reason?: string;
  blockers?: string[];
  desktopLaunch?: {
    mode: 'production-electron';
    mainPath: string;
    rendererPath: string;
    rendererUrl?: string;
  };
  nativeAdapter?: {
    url?: string;
    healthOk?: boolean;
    service?: string;
    owner?: string;
    adapterRole?: string;
    liveSurfaceTransport?: string;
    secondTruthSource?: boolean;
    audit?: {
      schemaVersion?: string;
      stateRequests?: number;
      screenshotRequests?: number;
      frameStreamRequests?: number;
      actionRequests?: number;
      recentRequestCount?: number;
    };
  };
  browserHostSession?: {
    id?: string;
    owner?: string;
    providerId?: string;
    status?: string;
    requestedUrl?: string;
    url?: string;
    liveSurfaceTransport?: string;
    nativeAdapterUrl?: string;
    singleInteractiveTruth?: boolean;
    frameStreamRefPresent?: boolean;
    frameRefPresent?: boolean;
    frameUrlPresent?: boolean;
  };
  surface?: {
    ok?: boolean;
    owner?: string;
    adapterRole?: string;
    surface?: string;
    liveSurfaceTransport?: string;
    singleInteractiveTruth?: boolean;
    embedded?: boolean;
    secondTruthSource?: boolean;
    visible?: boolean;
    loading?: boolean;
    bounds?: DesktopBrowserNativeLiveAcceptanceBounds;
    reason?: string;
  };
  interaction?: {
    targetUrl?: string;
    typedTokenObserved?: boolean;
    textProbe: 'native-adapter-text-endpoint' | 'not-run';
    actionTimingTransport?: string;
    paintAckSource?: string;
    actionAck?: {
      action?: string;
      capture?: string;
      status?: string;
      screenshotRequestsDuringAck?: number;
      frameStreamRequestsDuringAck?: number;
      dependsOnScreenshot?: boolean;
      dependsOnFrameStream?: boolean;
      evidenceCaptureStarted?: boolean;
      evidenceCaptureEnded?: boolean;
    };
    stateHeartbeat?: {
      source: 'native-adapter-state-endpoint' | 'not-run';
      url?: string;
      title?: string;
      loading?: boolean;
      canGoBack?: boolean;
      canGoForward?: boolean;
      browserHostStatus?: string;
      stateRequestsAfterAction?: number;
      lightweightStateUpdated?: boolean;
    };
  };
  diagnostics?: {
    runtimeConfig?: {
      runtimeControlUrl?: string;
      workspaceWriterBaseUrl?: string;
      workspacePath?: string;
      appDataRoot?: string;
    };
    runtimeHealth?: unknown;
    launcherAuditTail?: string[];
  };
  rejectedDesktopLiveSubstitutes: {
    iframe: false;
    proxy: false;
    webview: false;
    snapshot: false;
    frameStream: false;
    systemPopup: false;
    externalBrowser: false;
  };
  verificationCommand: string;
  strictVerificationCommand: string;
};

export type DesktopBrowserNativeLiveAcceptanceValidation = {
  schemaVersion: typeof DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE_SCHEMA;
  verdict: 'pass' | 'blocked';
  canClaimPass: boolean;
  blockReasons: string[];
};

export function validateDesktopBrowserNativeLiveAcceptanceEvidence(
  evidence: DesktopBrowserNativeLiveAcceptanceEvidence,
): DesktopBrowserNativeLiveAcceptanceValidation {
  const blockReasons = [
    evidence.schemaVersion === DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE_SCHEMA
      ? ''
      : 'Desktop Browser native live evidence schema is not recognized.',
    evidence.source === 'desktop-native-browser-pane-smoke'
      ? ''
      : 'Desktop Browser native live evidence must come from the desktop-native-browser-pane smoke.',
    evidence.status === 'passed'
      ? ''
      : evidence.reason || `Desktop Browser native live smoke is ${evidence.status}.`,
    evidence.claimScope === 'desktop-native-embedded-browser-pane-live'
      ? ''
      : 'Only desktop-native-embedded-browser-pane-live evidence can claim a live pass.',
    evidence.canClaimDesktopNativeLivePass === true
      ? ''
      : 'Evidence did not claim a desktop native Browser live pass.',
    evidence.nativeAdapter?.healthOk === true
      ? ''
      : 'Native embedded adapter health did not pass.',
    isLoopbackHttpUrl(evidence.nativeAdapter?.url)
      ? ''
      : 'Native adapter URL must be a loopback HTTP endpoint.',
    evidence.nativeAdapter?.owner === 'BrowserHostSession'
      ? ''
      : 'Native adapter health must declare owner=BrowserHostSession.',
    evidence.nativeAdapter?.adapterRole === 'display-input-adapter'
      ? ''
      : 'Native adapter must be only a display-input-adapter.',
    evidence.nativeAdapter?.liveSurfaceTransport === 'native-embedded'
      ? ''
      : 'Native adapter health must declare liveSurfaceTransport=native-embedded.',
    evidence.nativeAdapter?.secondTruthSource === false
      ? ''
      : 'Native adapter health must declare secondTruthSource=false.',
    evidence.browserHostSession?.liveSurfaceTransport === 'native-embedded'
      ? ''
      : 'BrowserHostSession must use native-embedded liveSurfaceTransport.',
    isLoopbackHttpUrl(evidence.browserHostSession?.nativeAdapterUrl)
      ? ''
      : 'BrowserHostSession must record a loopback nativeAdapterUrl.',
    evidence.browserHostSession?.singleInteractiveTruth === true
      ? ''
      : 'BrowserHostSession must keep singleInteractiveTruth=true.',
    evidence.browserHostSession?.frameStreamRefPresent === false &&
      evidence.browserHostSession?.frameRefPresent === false &&
      evidence.browserHostSession?.frameUrlPresent === false
      ? ''
      : 'Desktop native live pass must not be backed by frame-stream, frame, or frame URL evidence.',
    evidence.surface?.ok === true
      ? ''
      : evidence.surface?.reason || 'Desktop native surface state did not report ok=true.',
    evidence.surface?.owner === 'BrowserHostSession'
      ? ''
      : 'Desktop surface must declare owner=BrowserHostSession.',
    evidence.surface?.adapterRole === 'display-input-adapter'
      ? ''
      : 'Desktop surface must be a display-input-adapter.',
    evidence.surface?.surface === 'electron-web-contents-view'
      ? ''
      : 'Desktop surface must be Electron WebContentsView.',
    evidence.surface?.liveSurfaceTransport === 'native-embedded'
      ? ''
      : 'Desktop surface must declare liveSurfaceTransport=native-embedded.',
    evidence.surface?.embedded === true && evidence.surface.visible === true
      ? ''
      : 'Desktop surface must be embedded and visible in the Browser pane bounds.',
    evidence.surface?.secondTruthSource === false
      ? ''
      : 'Desktop surface must declare secondTruthSource=false.',
    evidence.interaction?.typedTokenObserved === true
      ? ''
      : 'Native embedded page interaction must be observed after BrowserHostSession input.',
    evidence.interaction?.paintAckSource === 'native-adapter-action-state'
      ? ''
      : 'Native embedded action ACK must use native-adapter-action-state, not a frame or snapshot ACK.',
    evidence.interaction?.actionAck?.action === 'click' &&
      evidence.interaction.actionAck.status === 'ok'
      ? ''
      : 'Native embedded action ACK evidence must come from a successful BrowserHostSession click action.',
    evidence.interaction?.actionAck?.dependsOnScreenshot === false &&
      evidence.interaction.actionAck.screenshotRequestsDuringAck === 0
      ? ''
      : 'Native embedded action ACK must not depend on screenshot capture.',
    evidence.interaction?.actionAck?.dependsOnFrameStream === false &&
      evidence.interaction.actionAck.frameStreamRequestsDuringAck === 0
      ? ''
      : 'Native embedded action ACK must not depend on frame-stream capture.',
    evidence.interaction?.stateHeartbeat?.source === 'native-adapter-state-endpoint' &&
      evidence.interaction.stateHeartbeat.lightweightStateUpdated === true &&
      (evidence.interaction.stateHeartbeat.stateRequestsAfterAction ?? 0) > 0
      ? ''
      : 'Native embedded action must be followed by a lightweight /state heartbeat.',
    validHeartbeatFields(evidence)
      ? ''
      : 'Native embedded /state heartbeat must include url/title/loading/canGoBack/canGoForward.',
    desktopLiveSubstitutesRejected(evidence)
      ? ''
      : 'iframe/proxy/webview/snapshot/frame-stream/system-popup/external-browser substitutes cannot claim desktop native live pass.',
  ].filter(Boolean);

  return {
    schemaVersion: DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE_SCHEMA,
    verdict: blockReasons.length === 0 ? 'pass' : 'blocked',
    canClaimPass: blockReasons.length === 0,
    blockReasons,
  };
}

export function assertDesktopBrowserNativeLiveAcceptanceCanClaimPass(
  evidence: DesktopBrowserNativeLiveAcceptanceEvidence,
): void {
  const validation = validateDesktopBrowserNativeLiveAcceptanceEvidence(evidence);
  if (validation.canClaimPass) return;
  throw new Error(`Desktop Browser native live acceptance cannot claim pass: ${validation.blockReasons.join('; ')}`);
}

export function rejectedDesktopLiveSubstitutes(): DesktopBrowserNativeLiveAcceptanceEvidence['rejectedDesktopLiveSubstitutes'] {
  return {
    iframe: false,
    proxy: false,
    webview: false,
    snapshot: false,
    frameStream: false,
    systemPopup: false,
    externalBrowser: false,
  };
}

function desktopLiveSubstitutesRejected(evidence: DesktopBrowserNativeLiveAcceptanceEvidence): boolean {
  return Object.values(evidence.rejectedDesktopLiveSubstitutes).every((value) => value === false);
}

function validHeartbeatFields(evidence: DesktopBrowserNativeLiveAcceptanceEvidence): boolean {
  const heartbeat = evidence.interaction?.stateHeartbeat;
  if (!heartbeat) return false;
  if (!heartbeat.url || /^about:blank$/i.test(heartbeat.url)) return false;
  if (!heartbeat.title) return false;
  if (typeof heartbeat.loading !== 'boolean') return false;
  if (typeof heartbeat.canGoBack !== 'boolean') return false;
  if (typeof heartbeat.canGoForward !== 'boolean') return false;
  return !evidence.interaction?.targetUrl || heartbeatMatchesTarget(evidence.interaction.targetUrl, heartbeat.url);
}

function heartbeatMatchesTarget(targetUrl: string, heartbeatUrl: string): boolean {
  try {
    const target = new URL(targetUrl);
    const heartbeat = new URL(heartbeatUrl);
    return target.protocol === heartbeat.protocol && target.port === heartbeat.port && equivalentLoopbackHost(target.hostname, heartbeat.hostname);
  } catch {
    return targetUrl === heartbeatUrl;
  }
}

function equivalentLoopbackHost(left: string, right: string): boolean {
  if (left === right) return true;
  const loopbacks = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '[::ffff:127.0.0.1]', '::ffff:127.0.0.1']);
  return loopbacks.has(left.toLowerCase()) && loopbacks.has(right.toLowerCase());
}

function isLoopbackHttpUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && /^(?:127\.0\.0\.1|localhost|::1)$/i.test(url.hostname);
  } catch {
    return false;
  }
}
