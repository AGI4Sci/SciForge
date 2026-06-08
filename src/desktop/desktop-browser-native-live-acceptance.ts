export const DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE_SCHEMA = 'sciforge.desktop.browser-native-live-acceptance.v1';

export type DesktopBrowserNativeLiveAcceptanceStatus = 'passed' | 'blocked' | 'failed';

export type DesktopBrowserNativeLiveAcceptanceBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesktopBrowserNativeLiveAcceptanceBenchmarkSection =
  | 'latency'
  | 'cpu'
  | 'memory'
  | 'inputCompleteness'
  | 'lifecycle'
  | 'reconnect'
  | 'streamQuality';

export type DesktopBrowserNativeLiveAcceptanceBenchmarkMetricSection = {
  status: 'passed' | 'blocked';
  resultRef: string;
  numericSummary?: Record<string, number | boolean>;
};

export type DesktopBrowserNativeLiveAcceptanceBenchmarkMetrics = {
  schemaVersion: 'sciforge.desktop.browser-native-live-acceptance.benchmark-metrics.v1';
  source: 'desktop-native-browser-pane-smoke';
  evidenceMode: 'bounded-summary-ref';
  inlineEvidence: 'forbidden';
  metricSections: Partial<Record<DesktopBrowserNativeLiveAcceptanceBenchmarkSection, DesktopBrowserNativeLiveAcceptanceBenchmarkMetricSection>>;
};

export const DESKTOP_BROWSER_NATIVE_M0_SURFING_LOOP_SCHEMA = 'sciforge.desktop.browser-native-live-acceptance.m0-surfing-loop.v1';
export const DESKTOP_BROWSER_NATIVE_REAL_EXTERNAL_NAVIGATION_SCHEMA = 'sciforge.desktop.browser-native-live-acceptance.real-external-navigation.v1';

export type DesktopBrowserNativeM0Action =
  | 'open'
  | 'click'
  | 'type'
  | 'scroll'
  | 'drag'
  | 'reload'
  | 'back'
  | 'forward'
  | 'stop';

export type DesktopBrowserNativeRealExternalNavigationAction =
  | 'open'
  | 'navigate'
  | 'reload'
  | 'back'
  | 'forward'
  | 'stop';

export type DesktopBrowserNativeM0ActionEvidence = {
  status: 'passed' | 'blocked';
  latencyMs?: number;
  resultRef: string;
  textLength?: number;
  textHash?: string;
  blockedReasonHash?: string;
};

export type DesktopBrowserNativeM0SurfingLoopEvidence = {
  schemaVersion: typeof DESKTOP_BROWSER_NATIVE_M0_SURFING_LOOP_SCHEMA;
  status: 'passed' | 'blocked';
  claimScope: 'desktop-native-m0-surfing-loop' | 'blocked-or-diagnostic';
  passClaim: boolean;
  shell: 'desktop-right-pane';
  owner: 'BrowserHostSession';
  adapterRole: 'display-input-adapter';
  refsFirst: true;
  evidenceMode: 'bounded-refs-and-summaries';
  sessionRef: string;
  liveSurfaceRef: string;
  nativeAdapterRef: string;
  surfaceRef: string;
  transport: {
    liveSurfaceTransport?: string;
    frameTransport?: string;
    surfaceType?: string;
  };
  health: {
    nativeAdapterHealthOk?: boolean;
    nativeAdapterService?: string;
    nativeStateHeartbeat: boolean;
    actionAckSource?: string;
  };
  urlEvidence: {
    requested?: DesktopBrowserNativeBoundedDigest;
    final?: DesktopBrowserNativeBoundedDigest;
    rawUrlCaptured: false;
  };
  actionCoverage: Record<DesktopBrowserNativeM0Action, DesktopBrowserNativeM0ActionEvidence>;
  inputHotPath: {
    dependsOnScreenshot: false;
    dependsOnFrameStream: false;
    screenshotRequestsDuringAck: number;
    frameStreamRequestsDuringAck: number;
  };
  singleInteractiveTruth: boolean;
  secondTruthSource: boolean;
  noLegacyFallback: {
    hostStream: false;
    canvas: false;
    webRtc: false;
    httpFrame: false;
    snapshot: false;
    iframe: false;
    proxy: false;
    webview: false;
    systemPopup: false;
    externalBrowser: false;
  };
  payloadPolicy: {
    rawDom: false;
    rawLogs: false;
    rawScreenshot: false;
    base64: false;
    providerPayload: false;
    secret: false;
  };
  coverageGaps: string[];
  blockedReason?: string;
};

export type DesktopBrowserNativeBoundedDigest = {
  length: number;
  hash: string;
};

export type DesktopBrowserNativeBoundedEndpoint = DesktopBrowserNativeBoundedDigest & {
  loopbackHttp: boolean;
};

export type DesktopBrowserNativeRealExternalNavigationEvidence = {
  schemaVersion: typeof DESKTOP_BROWSER_NATIVE_REAL_EXTERNAL_NAVIGATION_SCHEMA;
  status: 'passed' | 'blocked';
  claimScope: 'desktop-native-real-external-navigation' | 'blocked-or-diagnostic';
  passClaim: boolean;
  configuredBy: 'SCIFORGE_DESKTOP_BROWSER_NATIVE_REAL_EXTERNAL_TARGET_JSON';
  shell: 'desktop-right-pane';
  owner: 'BrowserHostSession';
  refsFirst: true;
  evidenceMode: 'bounded-refs-and-summaries';
  sessionRef: string;
  liveSurfaceRef: string;
  transport: {
    liveSurfaceTransport?: string;
    frameTransport?: string;
    surfaceType?: string;
  };
  targetEvidence: {
    mode: 'real-external-url-config' | 'blocked-real-external-url-config';
    requestedUrl?: DesktopBrowserNativeBoundedDigest;
    finalUrl?: DesktopBrowserNativeBoundedDigest;
    publicTarget: boolean;
    privateNetworkTarget: boolean;
    hardcodedSitePassClaim: false;
    rawUrlCaptured: false;
    rawDomCaptured: false;
  };
  actionCoverage: Record<DesktopBrowserNativeRealExternalNavigationAction, DesktopBrowserNativeM0ActionEvidence>;
  lifecycle: {
    addressCommitted: boolean;
    navigationStart: boolean;
    navigationCommitted: boolean;
    interactive: boolean;
    load: boolean;
    networkQuiet: boolean;
  };
  singleInteractiveTruth: boolean;
  secondTruthSource: boolean;
  noLegacyFallback: DesktopBrowserNativeM0SurfingLoopEvidence['noLegacyFallback'];
  payloadPolicy: DesktopBrowserNativeM0SurfingLoopEvidence['payloadPolicy'];
  coverageGaps: string[];
  blockedReason?: string;
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
    mainPathRef: string;
    rendererPathRef: string;
    rendererUrl?: DesktopBrowserNativeBoundedDigest;
  };
  nativeAdapter?: {
    endpoint?: DesktopBrowserNativeBoundedEndpoint;
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
    requestedUrl?: DesktopBrowserNativeBoundedDigest;
    url?: DesktopBrowserNativeBoundedDigest;
    liveSurfaceTransport?: string;
    nativeAdapterEndpoint?: DesktopBrowserNativeBoundedEndpoint;
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
    targetUrl?: DesktopBrowserNativeBoundedDigest;
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
      url?: DesktopBrowserNativeBoundedDigest;
      urlMatchesTarget?: boolean;
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
    browserPane?: unknown;
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
  m0SurfingLoop?: DesktopBrowserNativeM0SurfingLoopEvidence;
  realExternalNavigation?: DesktopBrowserNativeRealExternalNavigationEvidence;
  benchmarkMetrics?: DesktopBrowserNativeLiveAcceptanceBenchmarkMetrics;
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
    validBoundedLoopbackEndpoint(evidence.nativeAdapter?.endpoint)
      ? ''
      : 'Native adapter endpoint evidence must be bounded and declare loopback HTTP.',
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
    validBoundedLoopbackEndpoint(evidence.browserHostSession?.nativeAdapterEndpoint)
      ? ''
      : 'BrowserHostSession must record bounded loopback nativeAdapter endpoint evidence.',
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
    validateDesktopBrowserNativeM0SurfingLoopEvidence(evidence.m0SurfingLoop).canClaimPass
      ? ''
      : 'Desktop Browser native live evidence must include a passed refs-first M0 surfing loop.',
    evidenceContainsForbiddenRawPayload(evidence)
      ? 'Desktop Browser native live evidence must not contain raw URLs, DOM, screenshots, provider payloads, or secrets.'
      : '',
  ].filter(Boolean);

  return {
    schemaVersion: DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE_SCHEMA,
    verdict: blockReasons.length === 0 ? 'pass' : 'blocked',
    canClaimPass: blockReasons.length === 0,
    blockReasons,
  };
}

export function validateDesktopBrowserNativeM0SurfingLoopEvidence(
  evidence: DesktopBrowserNativeM0SurfingLoopEvidence | undefined,
): DesktopBrowserNativeLiveAcceptanceValidation {
  const blockReasons: string[] = [];
  if (!evidence) {
    blockReasons.push('Desktop Browser native M0 surfing loop evidence is missing.');
  } else {
    if (evidence.schemaVersion !== DESKTOP_BROWSER_NATIVE_M0_SURFING_LOOP_SCHEMA) {
      blockReasons.push('Desktop Browser native M0 surfing loop schema is not recognized.');
    }
    if (evidence.status !== 'passed' || evidence.claimScope !== 'desktop-native-m0-surfing-loop' || evidence.passClaim !== true) {
      blockReasons.push('Desktop Browser native M0 surfing loop must claim a passed desktop-native-m0-surfing-loop.');
    }
    if (evidence.shell !== 'desktop-right-pane') blockReasons.push('Desktop Browser native M0 surfing loop must run in the desktop right pane.');
    if (evidence.owner !== 'BrowserHostSession') blockReasons.push('Desktop Browser native M0 surfing loop owner must be BrowserHostSession.');
    if (evidence.adapterRole !== 'display-input-adapter') blockReasons.push('Desktop Browser native M0 adapter must only be a display-input-adapter.');
    if (evidence.refsFirst !== true || evidence.evidenceMode !== 'bounded-refs-and-summaries') {
      blockReasons.push('Desktop Browser native M0 surfing loop must be refs-first bounded evidence.');
    }
    if (!isSessionRef(evidence.sessionRef)) blockReasons.push('Desktop Browser native M0 sessionRef must be a BrowserHostSession ref.');
    if (!isSessionScopedRef(evidence.liveSurfaceRef, evidence.sessionRef, 'live-surface')) {
      blockReasons.push('Desktop Browser native M0 liveSurfaceRef must match the session ref.');
    }
    if (!/^native-adapter:loopback:[a-f0-9]{16}$/.test(evidence.nativeAdapterRef)) {
      blockReasons.push('Desktop Browser native M0 nativeAdapterRef must be bounded.');
    }
    if (!/^desktop-native-surface:electron-web-contents-view:[a-f0-9]{16}$/.test(evidence.surfaceRef)) {
      blockReasons.push('Desktop Browser native M0 surfaceRef must be bounded.');
    }
    if (evidence.transport.liveSurfaceTransport !== 'native-embedded' || evidence.transport.frameTransport !== 'native-embedded') {
      blockReasons.push('Desktop Browser native M0 transport must be native-embedded.');
    }
    if (evidence.transport.surfaceType !== 'electron-web-contents-view') {
      blockReasons.push('Desktop Browser native M0 surface type must be Electron WebContentsView.');
    }
    if (evidence.health.nativeAdapterHealthOk !== true || evidence.health.nativeStateHeartbeat !== true) {
      blockReasons.push('Desktop Browser native M0 health must include native adapter health and state heartbeat.');
    }
    if (evidence.health.actionAckSource !== 'native-adapter-action-state') {
      blockReasons.push('Desktop Browser native M0 action ACK must come from native adapter action state.');
    }
    if (evidence.urlEvidence.rawUrlCaptured !== false
      || !validBoundedDigest(evidence.urlEvidence.requested)
      || !validBoundedDigest(evidence.urlEvidence.final)) {
      blockReasons.push('Desktop Browser native M0 URL evidence must be bounded length/hash only.');
    }
    const missingActions = desktopBrowserNativeM0Actions().filter((action) => {
      const item = evidence.actionCoverage[action];
      return item?.status !== 'passed'
        || typeof item.latencyMs !== 'number'
        || !Number.isFinite(item.latencyMs)
        || item.latencyMs < 0
        || !isSessionScopedRef(item.resultRef, evidence.sessionRef, `m0/${action}`);
    });
    if (missingActions.length > 0) {
      blockReasons.push(`Desktop Browser native M0 action coverage is incomplete: ${missingActions.join(',')}.`);
    }
    const typeEvidence = evidence.actionCoverage.type;
    if ((typeEvidence.textLength ?? 0) <= 0 || !/^[a-f0-9]{16}$/.test(typeEvidence.textHash ?? '')) {
      blockReasons.push('Desktop Browser native M0 type evidence must include bounded length/hash.');
    }
    if (evidence.inputHotPath.dependsOnScreenshot !== false
      || evidence.inputHotPath.dependsOnFrameStream !== false
      || evidence.inputHotPath.screenshotRequestsDuringAck !== 0
      || evidence.inputHotPath.frameStreamRequestsDuringAck !== 0) {
      blockReasons.push('Desktop Browser native M0 input hot path must not depend on screenshot or frame-stream.');
    }
    if (evidence.singleInteractiveTruth !== true || evidence.secondTruthSource !== false) {
      blockReasons.push('Desktop Browser native M0 must preserve single interactive truth and no second truth source.');
    }
    if (!Object.values(evidence.noLegacyFallback).every((value) => value === false)) {
      blockReasons.push('Desktop Browser native M0 must not use legacy fallback surfaces.');
    }
    if (!Object.values(evidence.payloadPolicy).every((value) => value === false)) {
      blockReasons.push('Desktop Browser native M0 payload policy forbids raw payload evidence.');
    }
    if (evidenceContainsForbiddenRawPayload(evidence)) {
      blockReasons.push('Desktop Browser native M0 evidence must not contain raw URLs, DOM, screenshots, provider payloads, or secrets.');
    }
    if (evidence.coverageGaps.length > 0 || evidence.blockedReason) {
      blockReasons.push('Desktop Browser native M0 pass must not keep blocked coverage gaps.');
    }
  }

  return {
    schemaVersion: DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE_SCHEMA,
    verdict: blockReasons.length === 0 ? 'pass' : 'blocked',
    canClaimPass: blockReasons.length === 0,
    blockReasons,
  };
}

export function validateDesktopBrowserNativeRealExternalNavigationEvidence(
  evidence: DesktopBrowserNativeRealExternalNavigationEvidence | undefined,
): DesktopBrowserNativeLiveAcceptanceValidation {
  const blockReasons: string[] = [];
  if (!evidence) {
    blockReasons.push('Desktop Browser native real external navigation evidence is missing.');
  } else {
    if (evidence.schemaVersion !== DESKTOP_BROWSER_NATIVE_REAL_EXTERNAL_NAVIGATION_SCHEMA) {
      blockReasons.push('Desktop Browser native real external navigation schema is not recognized.');
    }
    if (evidence.status !== 'passed' || evidence.claimScope !== 'desktop-native-real-external-navigation' || evidence.passClaim !== true) {
      blockReasons.push('Desktop Browser native real external navigation must claim a passed desktop-native-real-external-navigation.');
    }
    if (evidence.configuredBy !== 'SCIFORGE_DESKTOP_BROWSER_NATIVE_REAL_EXTERNAL_TARGET_JSON') {
      blockReasons.push('Desktop Browser native real external navigation must be configured by the external target env.');
    }
    if (evidence.shell !== 'desktop-right-pane') blockReasons.push('Desktop Browser native real external navigation must run in the desktop right pane.');
    if (evidence.owner !== 'BrowserHostSession') blockReasons.push('Desktop Browser native real external navigation owner must be BrowserHostSession.');
    if (evidence.refsFirst !== true || evidence.evidenceMode !== 'bounded-refs-and-summaries') {
      blockReasons.push('Desktop Browser native real external navigation must be refs-first bounded evidence.');
    }
    if (!isSessionRef(evidence.sessionRef)) blockReasons.push('Desktop Browser native real external navigation sessionRef must be a BrowserHostSession ref.');
    if (!isSessionScopedRef(evidence.liveSurfaceRef, evidence.sessionRef, 'live-surface')) {
      blockReasons.push('Desktop Browser native real external navigation liveSurfaceRef must match the session ref.');
    }
    if (evidence.transport.liveSurfaceTransport !== 'native-embedded' || evidence.transport.frameTransport !== 'native-embedded') {
      blockReasons.push('Desktop Browser native real external navigation transport must be native-embedded.');
    }
    if (evidence.transport.surfaceType !== 'electron-web-contents-view') {
      blockReasons.push('Desktop Browser native real external navigation surface type must be Electron WebContentsView.');
    }
    if (
      evidence.targetEvidence.mode !== 'real-external-url-config'
      || evidence.targetEvidence.publicTarget !== true
      || evidence.targetEvidence.privateNetworkTarget !== false
      || evidence.targetEvidence.hardcodedSitePassClaim !== false
      || evidence.targetEvidence.rawUrlCaptured !== false
      || evidence.targetEvidence.rawDomCaptured !== false
      || !validBoundedDigest(evidence.targetEvidence.requestedUrl)
      || !validBoundedDigest(evidence.targetEvidence.finalUrl)
    ) {
      blockReasons.push('Desktop Browser native real external navigation must prove a configured public external URL with bounded URL evidence only.');
    }
    const missingActions = desktopBrowserNativeRealExternalNavigationActions().filter((action) => {
      const item = evidence.actionCoverage[action];
      return item?.status !== 'passed'
        || typeof item.latencyMs !== 'number'
        || !Number.isFinite(item.latencyMs)
        || item.latencyMs < 0
        || !isSessionScopedRef(item.resultRef, evidence.sessionRef, `real-external/${action}`);
    });
    if (missingActions.length > 0) {
      blockReasons.push(`Desktop Browser native real external navigation action coverage is incomplete: ${missingActions.join(',')}.`);
    }
    if (!Object.values(evidence.lifecycle).every((value) => value === true)) {
      blockReasons.push('Desktop Browser native real external navigation lifecycle evidence is incomplete.');
    }
    if (evidence.singleInteractiveTruth !== true || evidence.secondTruthSource !== false) {
      blockReasons.push('Desktop Browser native real external navigation must preserve single interactive truth and no second truth source.');
    }
    if (!Object.values(evidence.noLegacyFallback).every((value) => value === false)) {
      blockReasons.push('Desktop Browser native real external navigation must not use legacy fallback surfaces.');
    }
    if (!Object.values(evidence.payloadPolicy).every((value) => value === false)) {
      blockReasons.push('Desktop Browser native real external navigation payload policy forbids raw payload evidence.');
    }
    if (evidenceContainsForbiddenRawPayload(evidence)) {
      blockReasons.push('Desktop Browser native real external navigation evidence must not contain raw URLs, DOM, screenshots, provider payloads, or secrets.');
    }
    if (evidence.coverageGaps.length > 0 || evidence.blockedReason) {
      blockReasons.push('Desktop Browser native real external navigation pass must not keep blocked coverage gaps.');
    }
  }

  return {
    schemaVersion: DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE_SCHEMA,
    verdict: blockReasons.length === 0 ? 'pass' : 'blocked',
    canClaimPass: blockReasons.length === 0,
    blockReasons,
  };
}

export function desktopBrowserNativeM0Actions(): DesktopBrowserNativeM0Action[] {
  return ['open', 'click', 'type', 'scroll', 'drag', 'reload', 'back', 'forward', 'stop'];
}

export function desktopBrowserNativeRealExternalNavigationActions(): DesktopBrowserNativeRealExternalNavigationAction[] {
  return ['open', 'navigate', 'reload', 'back', 'forward', 'stop'];
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
  if (!validBoundedDigest(heartbeat.url)) return false;
  if (!heartbeat.title) return false;
  if (typeof heartbeat.loading !== 'boolean') return false;
  if (typeof heartbeat.canGoBack !== 'boolean') return false;
  if (typeof heartbeat.canGoForward !== 'boolean') return false;
  return !evidence.interaction?.targetUrl || heartbeat.urlMatchesTarget === true;
}

function validBoundedLoopbackEndpoint(value: DesktopBrowserNativeBoundedEndpoint | undefined): boolean {
  return validBoundedDigest(value) && value.loopbackHttp === true;
}

function validBoundedDigest(value: DesktopBrowserNativeBoundedDigest | undefined): value is DesktopBrowserNativeBoundedDigest {
  return Boolean(
    value
      && typeof value.length === 'number'
      && Number.isFinite(value.length)
      && value.length > 0
      && /^[a-f0-9]{16}$/.test(value.hash),
  );
}

const allowedFalsePayloadPolicyKeys = new Set(['rawDom', 'rawLogs', 'rawScreenshot', 'base64', 'providerPayload', 'secret']);

function evidenceContainsForbiddenRawPayload(value: unknown, path: string[] = []): boolean {
  if (typeof value === 'string') return forbiddenRawString(value);
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item, index) => evidenceContainsForbiddenRawPayload(item, [...path, String(index)]));
  return Object.entries(value as Record<string, unknown>).some(([key, entry]) => {
    if (path.at(-1) === 'payloadPolicy' && allowedFalsePayloadPolicyKeys.has(key) && entry === false) return false;
    if (forbiddenRawKey(key, entry)) return true;
    return evidenceContainsForbiddenRawPayload(entry, [...path, key]);
  });
}

function forbiddenRawKey(key: string, value: unknown): boolean {
  if (value === false || value === undefined || value === null) return false;
  const normalized = key.toLowerCase();
  if (typeof value === 'string') {
    if (/^(url|requestedurl|nativeadapterurl|rendererurl|targeturl)$/.test(normalized)) return true;
    if (/^(mainpath|rendererpath|workspacepath|appdataroot)$/.test(normalized)) return true;
  }
  return /raw.*dom|dom.*raw|raw.*log|raw.*screenshot|screenshot.*base64|providerpayload|secretvalue|password|api[-_]?key/.test(normalized)
    || normalized === 'secret'
    || normalized === 'token';
}

function forbiddenRawString(value: string): boolean {
  return /^(?:https?:|file:|data:|blob:|javascript:)/i.test(value.trim())
    || /<!doctype|<html|<body|outerhtml|innerhtml|;base64,|data:image/i.test(value);
}

function isSessionRef(value: string): boolean {
  return /^browser-host-session:[A-Za-z0-9_.:-]{1,128}$/.test(value);
}

function isSessionScopedRef(value: string, sessionRef: string, suffix: string): boolean {
  if (!isSessionRef(sessionRef)) return false;
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${sessionRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/${escapedSuffix}$`).test(value);
}
