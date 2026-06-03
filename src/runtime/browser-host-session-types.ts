export const BROWSER_HOST_SESSION_PROVIDER_ID = 'sciforge.browser-host-session' as const;
export const BROWSER_HOST_SESSION_SCHEMA = 'sciforge.browser-host-session.state.v1' as const;
export const BROWSER_HOST_SEARCH_SCHEMA = 'sciforge.browser-host-session.search-result.v1' as const;
export const BROWSER_HOST_LOADING_PROGRESS_SCHEMA = 'sciforge.browser-host-session.loading-progress.lifecycle.v1' as const;
export const BROWSER_HOST_NATIVE_OS_UI_PROOF_SCHEMA = 'sciforge.browser-host-session.native-os-ui-proof.v1' as const;

export type BrowserHostSessionStatus = 'starting' | 'loading' | 'ready' | 'failed' | 'closed';
export type BrowserHostSessionAction =
  | 'navigate'
  | 'back'
  | 'forward'
  | 'reload'
  | 'stop'
  | 'click'
  | 'double-click'
  | 'mouse-down'
  | 'mouse-move'
  | 'mouse-up'
  | 'drag'
  | 'type'
  | 'press'
  | 'scroll'
  | 'cursor'
  | 'native-os-ui-proof'
  | 'snapshot'
  | 'state'
  | 'close';
export type BrowserHostSessionCaptureMode = 'full' | 'frame' | 'none';
export type BrowserHostSessionLiveSurfaceTransport = 'host-stream' | 'native-embedded' | 'webrtc-data-channel';
export type BrowserHostMouseButton = 'left' | 'right' | 'middle';
export type BrowserHostNativeOsUiProofGroup =
  | 'cursorCaret'
  | 'mouseContextMenu'
  | 'keyboardImeClipboardSelection'
  | 'rerenderFocus';
export type BrowserHostNativeOsUiProofProbe =
  | 'focus-caret'
  | 'blur-restore'
  | 'mouse-context-menu-owner'
  | 'bounded-keyboard-ime-clipboard-selection'
  | 'bounded-rerender-focus'
  | 'rerender-focus';
export type BrowserHostSessionLoadingProgressState =
  | 'navigation-start'
  | 'navigation-committed'
  | 'interactive'
  | 'load'
  | 'network-quiet'
  | 'stalled'
  | 'blocked'
  | 'retry'
  | 'handoff';
export type BrowserHostSessionLoadingProgressReason =
  | 'navigation-requested'
  | 'navigation-committed'
  | 'page-interactive'
  | 'page-load'
  | 'network-quiet'
  | 'navigation-stalled'
  | 'navigation-blocked'
  | 'navigation-retry'
  | 'user-handoff-required'
  | 'host-starting'
  | 'host-loading'
  | 'host-ready'
  | 'host-error'
  | 'host-diagnostic';
export type BrowserHostSessionLoadingProgressSource =
  | 'host-lifecycle'
  | 'host-progress'
  | 'host-navigation'
  | 'host-action-timing'
  | 'host-state'
  | 'host-session'
  | 'host-error';
export type BrowserHostSessionActionRiskType =
  | 'navigation-external'
  | 'form-submit'
  | 'credential'
  | 'payment'
  | 'destructive'
  | 'low-risk-input'
  | 'scroll'
  | 'click';

export interface BrowserHostMousePoint {
  x: number;
  y: number;
}

export type BrowserHostSearchEngine = 'bing' | 'duckduckgo';

export interface BrowserHostSessionViewport {
  width: number;
  height: number;
}

export interface BrowserHostSessionActionTiming {
  actionId: string;
  action: BrowserHostSessionAction | 'open';
  capture: BrowserHostSessionCaptureMode;
  status: 'ok' | 'failed';
  uiEventReceivedAt?: string;
  adapterSentAt?: string;
  hostReceivedAt: string;
  hostStartedAt: string;
  hostActionEndedAt?: string;
  evidenceCaptureStartedAt?: string;
  evidenceCaptureEndedAt?: string;
  hostCompletedAt: string;
  adapterToHostMs?: number;
  queueMs: number;
  hostActionMs: number;
  evidenceMs?: number;
  totalMs: number;
  liveSurfaceTransport?: BrowserHostSessionLiveSurfaceTransport;
  paintAckSource?: 'native-adapter-action-state' | 'host-stream-frame' | 'none';
  blockedReason?: string;
}

export interface BrowserHostSessionActionTimingSummary {
  action: BrowserHostSessionAction | 'open';
  count: number;
  p50Ms: number;
  p95Ms: number;
  lastMs: number;
}

export interface BrowserHostSessionLoadingProgressRefs {
  session?: string;
  liveSurface?: string;
  frameStream?: string;
  frame?: string;
  screenshot?: string;
  domSnapshot?: string;
  axSnapshot?: string;
  consoleLog?: string;
  networkLog?: string;
  searchResult?: string;
}

export interface BrowserHostSessionLoadingProgressUrlDigest {
  length: number;
  sha1: string;
}

export interface BrowserHostSessionLoadingProgressUrls {
  requested?: BrowserHostSessionLoadingProgressUrlDigest;
  current?: BrowserHostSessionLoadingProgressUrlDigest;
  final?: BrowserHostSessionLoadingProgressUrlDigest;
}

export interface BrowserHostSessionLoadingProgress {
  schemaVersion: typeof BROWSER_HOST_LOADING_PROGRESS_SCHEMA;
  state: BrowserHostSessionLoadingProgressState;
  reason: BrowserHostSessionLoadingProgressReason;
  source: BrowserHostSessionLoadingProgressSource;
  status: BrowserHostSessionStatus;
  action?: BrowserHostSessionAction | 'open';
  updatedAt: string;
  refs: BrowserHostSessionLoadingProgressRefs;
  urls?: BrowserHostSessionLoadingProgressUrls;
  canRetry?: boolean;
  blocked?: boolean;
  requiresHandoff?: boolean;
}

export interface BrowserHostSessionNativeOsUiProof {
  schemaVersion: typeof BROWSER_HOST_NATIVE_OS_UI_PROOF_SCHEMA;
  boundedEvidenceOnly: true;
  rawDomRecorded: false;
  rawTextRecorded: false;
  rawUrlRecorded: false;
  rawTitleRecorded: false;
  rawSelectorRecorded: false;
  rawCoordsRecorded: false;
  rawPayloadRecorded: false;
  source: 'native-embedded-action-state';
  proofGroup: BrowserHostNativeOsUiProofGroup;
  actionId: string;
  observedProofNames: string[];
  evidenceTokens: string[];
  diagnostics: string[];
}

export interface BrowserHostSessionVisibleAction {
  actionId: string;
  action: BrowserHostSessionAction | 'open';
  riskType: BrowserHostSessionActionRiskType;
  actorCursorRef?: string;
  visibleActionRef?: string;
}

export interface BrowserHostSessionRiskLedgerEntry extends BrowserHostSessionVisibleAction {
  recordedAt: string;
}

export interface BrowserHostSessionActorCursorInput {
  agentId: string;
  cursorId: string;
  color?: string;
  label?: string;
}

export interface BrowserHostSessionActorCursor {
  agentId: string;
  cursorId: string;
  color: string;
  label: string;
  status: 'acting';
  target: {
    type: 'browser-pane';
    sessionId: string;
    windowRef: string;
  };
  lastAction: {
    action: 'observe' | 'click' | 'type' | 'scroll' | 'wait';
    status: 'completed';
    evidenceRefs: string[];
  };
  evidenceRefs: string[];
}

export interface BrowserHostSessionNavigationProgressEvent {
  state: BrowserHostSessionLoadingProgressState;
  reason: BrowserHostSessionLoadingProgressReason;
  source?: BrowserHostSessionLoadingProgressSource;
  requestedUrl?: string;
  currentUrl?: string;
  finalUrl?: string;
  canRetry?: boolean;
  blocked?: boolean;
  requiresHandoff?: boolean;
}

export interface BrowserHostSessionState {
  schemaVersion: typeof BROWSER_HOST_SESSION_SCHEMA;
  id: string;
  owner: 'host';
  providerId: typeof BROWSER_HOST_SESSION_PROVIDER_ID;
  status: BrowserHostSessionStatus;
  workspacePath: string;
  requestedUrl: string;
  url: string;
  title?: string;
  startedAt: string;
  updatedAt: string;
  viewport: BrowserHostSessionViewport;
  canGoBack: boolean;
  canGoForward: boolean;
  liveSurfaceRef?: string;
  liveSurfaceTransport?: BrowserHostSessionLiveSurfaceTransport;
  nativeAdapterUrl?: string;
  singleInteractiveTruth?: true;
  secondTruthSource?: false;
  frameStreamRef?: string;
  frameRef?: string;
  frameUrl?: string;
  screenshotRef?: string;
  domSnapshotRef?: string;
  axSnapshotRef?: string;
  consoleLogRef?: string;
  networkLogRef?: string;
  searchResultRef?: string;
  cursor?: string;
  loadingProgress?: BrowserHostSessionLoadingProgress;
  nativeOsUiProof?: BrowserHostSessionNativeOsUiProof;
  actorCursor?: BrowserHostSessionActorCursor;
  actorCursors?: BrowserHostSessionActorCursor[];
  visibleAction?: BrowserHostSessionVisibleAction;
  riskLedger?: BrowserHostSessionRiskLedgerEntry[];
  lastActionTiming?: BrowserHostSessionActionTiming;
  actionTimingSummary?: BrowserHostSessionActionTimingSummary[];
  diagnostics: string[];
}

export interface BrowserHostSessionStartInput {
  url: string;
  sessionId?: string;
  width?: number;
  height?: number;
  timeoutMs?: number;
  actorCursor?: BrowserHostSessionActorCursorInput;
}

export interface BrowserHostSessionActionInput {
  action: BrowserHostSessionAction;
  capture?: BrowserHostSessionCaptureMode;
  url?: string;
  x?: number;
  y?: number;
  button?: BrowserHostMouseButton;
  path?: BrowserHostMousePoint[];
  text?: string;
  key?: string;
  deltaX?: number;
  deltaY?: number;
  timeoutMs?: number;
  actionId?: string;
  proofGroup?: BrowserHostNativeOsUiProofGroup;
  probe?: BrowserHostNativeOsUiProofProbe;
  expectedProofNames?: string[];
  uiEventReceivedAt?: string;
  adapterSentAt?: string;
  actorCursor?: BrowserHostSessionActorCursorInput;
}

export interface BrowserHostSearchInput {
  query: string;
  sessionId?: string;
  limit?: number;
  region?: string;
  engine?: BrowserHostSearchEngine;
  timeoutMs?: number;
}

export interface BrowserHostSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface BrowserHostSearchOutput {
  schemaVersion: typeof BROWSER_HOST_SEARCH_SCHEMA;
  query: string;
  engine: BrowserHostSearchEngine;
  searchUrl: string;
  finalUrl: string;
  results: BrowserHostSearchResult[];
  session: BrowserHostSessionState;
  searchResultRef: string;
  screenshotRef?: string;
  domSnapshotRef?: string;
  axSnapshotRef?: string;
  consoleLogRef?: string;
  networkLogRef?: string;
}

export interface BrowserHostSessionDriver {
  readonly liveSurfaceTransport?: BrowserHostSessionLiveSurfaceTransport;
  readonly nativeAdapterUrl?: string;
  goto(url: string, timeoutMs: number): Promise<void>;
  url(): string;
  title(): Promise<string>;
  content(): Promise<string>;
  text(): Promise<string>;
  screenshot(path: string): Promise<void>;
  axSnapshot?(): Promise<unknown>;
  searchResults?(limit: number): Promise<BrowserHostSearchResult[]>;
  canGoBack(): Promise<boolean>;
  canGoForward(): Promise<boolean>;
  back(timeoutMs: number): Promise<void>;
  forward(timeoutMs: number): Promise<void>;
  reload(timeoutMs: number): Promise<void>;
  stop(): Promise<void>;
  click(x: number, y: number, button?: BrowserHostMouseButton): Promise<void>;
  doubleClick?(x: number, y: number, button?: BrowserHostMouseButton): Promise<void>;
  mouseDown?(x: number, y: number, button?: BrowserHostMouseButton): Promise<void>;
  mouseMove?(x: number, y: number): Promise<void>;
  mouseUp?(x: number, y: number, button?: BrowserHostMouseButton): Promise<void>;
  drag?(path: BrowserHostMousePoint[], button?: BrowserHostMouseButton): Promise<void>;
  type(text: string): Promise<void>;
  press(key: string): Promise<void>;
  scroll(deltaX: number, deltaY: number, x?: number, y?: number): Promise<void>;
  cursor?(x: number, y: number): Promise<string>;
  readonly nativeOsUiProof?: BrowserHostSessionNativeOsUiProof;
  proveNativeOsUi?(input: BrowserHostSessionActionInput): Promise<BrowserHostSessionNativeOsUiProof | undefined>;
  close(): Promise<void>;
  onConsole?(listener: (entry: Record<string, unknown>) => void): void;
  onNetwork?(listener: (entry: Record<string, unknown>) => void): void;
  onNavigationProgress?(listener: (progress: BrowserHostSessionNavigationProgressEvent) => void): void;
}

export interface BrowserHostSessionDriverFactory {
  create(input: {
    sessionId: string;
    viewport: BrowserHostSessionViewport;
    timeoutMs: number;
    workspacePath: string;
    workspaceProfileDir: string;
  }): Promise<BrowserHostSessionDriver>;
}

export interface BrowserHostFrameCaptureResult {
  session: BrowserHostSessionState;
  captured: boolean;
  skippedReason?: 'busy' | 'recent-input';
}
