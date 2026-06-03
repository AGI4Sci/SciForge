export const BROWSER_RUNTIME_CAPABILITY_ID = 'browser_runtime' as const;
export const BROWSER_RUNTIME_CONTRACT_ID = 'sciforge.browser-runtime.v1' as const;
export const BROWSER_HOST_SESSION_PROVIDER_ID = 'sciforge.browser-host-session' as const;
export const BROWSER_HOST_SESSION_SCHEMA = 'sciforge.browser-host-session.state.v1' as const;
export const BROWSER_HOST_NATIVE_OS_UI_PROOF_SCHEMA = 'sciforge.browser-host-session.native-os-ui-proof.v1' as const;

export type BrowserRuntimeMode = 'agent-headless' | 'visible-takeover';
export type BrowserRuntimeTabStatus = 'new' | 'loading' | 'ready' | 'failed' | 'closed';
export type BrowserRuntimeCommandType =
  | 'session.open'
  | 'session.list'
  | 'browser.visibility.set'
  | 'browser.viewport.set'
  | 'browser.viewport.reset'
  | 'browser.user.openTabs'
  | 'browser.list_frames'
  | 'browser.switch_frame'
  | 'browser.list_dialogs'
  | 'browser.handle_dialog'
  | 'browser.get_network_log'
  | 'browser.wait_for_idle'
  | 'browser.get_storage'
  | 'browser.upload_file'
  | 'browser.emulate_media'
  | 'tab.new'
  | 'tab.select'
  | 'tab.close'
  | 'tab.navigate'
  | 'tab.back'
  | 'tab.reload'
  | 'tab.snapshot'
  | 'page.click'
  | 'page.type'
  | 'page.keypress'
  | 'page.scroll'
  | 'cua.click'
  | 'cua.double_click'
  | 'cua.drag'
  | 'cua.move'
  | 'cua.scroll'
  | 'cua.type'
  | 'dom_cua.visible_dom'
  | 'dom_cua.click'
  | 'dom_cua.double_click'
  | 'dom_cua.scroll'
  | 'dom_cua.type'
  | 'playwright.locator'
  | 'playwright.evaluate'
  | 'logs.console'
  | 'logs.network'
  | 'dev.logs'
  | 'clipboard.read'
  | 'clipboard.write'
  | 'browser.close';

export type BrowserRuntimeRiskLevel = 'low' | 'medium' | 'high';
export type BrowserRuntimeTraceRefKind = 'browser-frame' | 'screenshot' | 'dom-snapshot' | 'ax-snapshot' | 'console-log' | 'network-log' | 'search-result' | 'download';
export type BrowserHostSessionStatus = 'starting' | 'loading' | 'ready' | 'failed' | 'closed';
export type BrowserHostSessionAction = 'navigate' | 'back' | 'forward' | 'reload' | 'stop' | 'click' | 'double-click' | 'mouse-down' | 'mouse-move' | 'mouse-up' | 'drag' | 'type' | 'press' | 'scroll' | 'cursor' | 'native-os-ui-proof' | 'snapshot' | 'state' | 'close';
export type BrowserHostSessionActionRiskType = 'navigation-external' | 'form-submit' | 'credential' | 'payment' | 'destructive' | 'low-risk-input' | 'scroll' | 'click';
export type BrowserHostSessionCaptureMode = 'full' | 'frame' | 'none';
export type BrowserHostSessionLiveSurfaceTransport = 'host-stream' | 'native-embedded' | 'webrtc-data-channel';
export type BrowserHostMouseButton = 'left' | 'right' | 'middle';
export type BrowserHostNativeOsUiProofGroup = 'cursorCaret' | 'mouseContextMenu' | 'keyboardImeClipboardSelection' | 'rerenderFocus';
export type BrowserHostNativeOsUiProofProbe =
  | 'focus-caret'
  | 'blur-restore'
  | 'mouse-context-menu-owner'
  | 'bounded-keyboard-ime-clipboard-selection'
  | 'bounded-rerender-focus'
  | 'rerender-focus';

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

export interface BrowserHostSessionRiskLedgerEntry extends BrowserHostSessionVisibleAction {
  recordedAt: string;
}

export interface BrowserHostSessionState {
  schemaVersion: typeof BROWSER_HOST_SESSION_SCHEMA;
  id: string;
  owner: 'host';
  providerId: typeof BROWSER_HOST_SESSION_PROVIDER_ID;
  status: BrowserHostSessionStatus;
  workspacePath?: string;
  requestedUrl?: string;
  url: string;
  title?: string;
  startedAt?: string;
  updatedAt?: string;
  viewport?: BrowserHostSessionViewport;
  canGoBack?: boolean;
  canGoForward?: boolean;
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
  workspaceWriterBaseUrl?: string;
  cursor?: string;
  nativeOsUiProof?: BrowserHostSessionNativeOsUiProof;
  actorCursor?: BrowserHostSessionActorCursor;
  actorCursors?: BrowserHostSessionActorCursor[];
  visibleAction?: BrowserHostSessionVisibleAction;
  riskLedger?: BrowserHostSessionRiskLedgerEntry[];
  lastActionTiming?: BrowserHostSessionActionTiming;
  actionTimingSummary?: BrowserHostSessionActionTimingSummary[];
  diagnostics?: string[];
}

export interface BrowserHostSessionActionRequest {
  sessionId: string;
  action: BrowserHostSessionAction;
  capture?: BrowserHostSessionCaptureMode;
  url?: string;
  x?: number;
  y?: number;
  button?: BrowserHostMouseButton;
  path?: Array<{ x: number; y: number }>;
  text?: string;
  key?: string;
  deltaX?: number;
  deltaY?: number;
  actionId?: string;
  proofGroup?: BrowserHostNativeOsUiProofGroup;
  probe?: BrowserHostNativeOsUiProofProbe;
  expectedProofNames?: string[];
  uiEventReceivedAt?: string;
  adapterSentAt?: string;
}

export interface BrowserRuntimeTab {
  id: string;
  url?: string;
  title?: string;
  status: BrowserRuntimeTabStatus;
  lastSnapshotRef?: string;
}

export interface BrowserRuntimeSession {
  id: string;
  mode: BrowserRuntimeMode;
  providerId: string;
  tabs: BrowserRuntimeTab[];
  activeTabId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BrowserRuntimeCommand {
  type: BrowserRuntimeCommandType;
  sessionId?: string;
  tabId?: string;
  url?: string;
  startUrl?: string;
  target?: string;
  text?: string;
  key?: string;
  deltaX?: number;
  deltaY?: number;
  screenshot?: boolean;
  dom?: boolean;
  logs?: boolean;
  visible?: boolean;
  requiresHumanTakeover?: boolean;
  timeoutMs?: number;
}

export interface BrowserRuntimeCommandRisk {
  level: BrowserRuntimeRiskLevel;
  requiresApproval: boolean;
  reasons: string[];
  suggestedMode?: BrowserRuntimeMode;
}

export interface BrowserRuntimeTraceRef {
  kind: BrowserRuntimeTraceRefKind;
  ref: string;
  sha256?: string;
  bytes?: number;
  width?: number;
  height?: number;
  targetRect?: { x: number; y: number; width: number; height: number };
}

export interface BrowserRuntimeTrace {
  schemaVersion: 'sciforge.browser-runtime.trace.v1';
  commandType: BrowserRuntimeCommandType;
  sessionId?: string;
  tabId?: string;
  refs: BrowserRuntimeTraceRef[];
  diagnostics: string[];
  inlineLargeObjectsDropped: string[];
}

export interface BrowserRuntimeSnapshot {
  schemaVersion: 'sciforge.browser-runtime.snapshot.v1';
  url?: string;
  title?: string;
  textPreview?: string;
  screenshotRef?: string;
  domSnapshotRef?: string;
  axSnapshotRef?: string;
  consoleLogRef?: string;
  networkLogRef?: string;
  searchResultRef?: string;
}

export interface BrowserRuntimeProjection {
  schemaVersion: 'sciforge.browser-runtime.projection.v1';
  session: BrowserRuntimeSession;
  activeTab?: BrowserRuntimeTab;
  snapshot?: BrowserRuntimeSnapshot;
  hostSession?: BrowserHostSessionState;
  traceRefs: BrowserRuntimeTraceRef[];
  guiBoundary: {
    taskReasoning: false;
    providerRouting: false;
    promptAssembly: false;
    presentationOnly: true;
  };
}

export interface BrowserRuntimeCodexFeature {
  codexFeature: string;
  sciforgeSurface: string;
  owner: 'browser_runtime' | 'browser_host_session' | 'playwright_browser_automation' | 'playwright_edge_browser' | 'computer_use' | 'gui';
  notes: string;
}

export type BrowserRuntimePlaywrightAction = {
  type: string;
  [key: string]: unknown;
};

export interface BrowserRuntimeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserRuntimeStableRef {
  schemaVersion: 'sciforge.browser-runtime.stable-ref.v1';
  primary: string;
  resolveStrategy: 'exact' | 'best-match';
  signals: {
    testId?: string;
    id?: string;
    selector?: string;
    domPath: string;
    role?: string;
    accessibleName?: string;
    textHash?: string;
    bbox: BrowserRuntimeRect;
    componentPath?: string;
    visualHash?: string;
  };
}

export interface BrowserRuntimeStableRefInput {
  testId?: string;
  id?: string;
  selector?: string;
  domPath: string;
  role?: string;
  accessibleName?: string;
  text?: string;
  bbox: BrowserRuntimeRect;
  componentPath?: string;
  visualHash?: string;
}

export type BrowserRuntimePageQueryField =
  | 'tagName'
  | 'role'
  | 'ariaLabel'
  | 'ariaDescription'
  | 'innerText'
  | 'textContent'
  | 'bbox'
  | 'isVisible'
  | 'isFocusable'
  | 'value'
  | 'href'
  | 'src'
  | 'alt'
  | `computedStyle.${string}`
  | `attribute.${string}`
  | `dataset.${string}`;

export type BrowserRuntimePageQuerySelector =
  | { ref: string }
  | { selector: string }
  | {
      role?: string;
      name?: string;
      visible?: boolean;
      withinRef?: string;
    };

export interface BrowserRuntimePageQueryInput {
  select: BrowserRuntimePageQuerySelector;
  fields: BrowserRuntimePageQueryField[];
  limit?: number;
}

export interface BrowserRuntimePageQuery extends BrowserRuntimePageQueryInput {
  schemaVersion: 'sciforge.browser-runtime.page-query.v1';
  limit: number;
}

const HIGH_RISK_COMMANDS = new Set<BrowserRuntimeCommandType>([
  'browser.user.openTabs',
  'browser.handle_dialog',
  'browser.upload_file',
  'clipboard.read',
  'clipboard.write',
]);

const HIGH_RISK_TEXT = /\b(?:login|sign\s*in|oauth|authorize|permission|2fa|otp|captcha|upload|download|submit|send|post|publish|delete|remove|pay|purchase|checkout|order|剪贴板|登录|授权|验证码|上传|下载|提交|发送|发布|删除|支付|下单)\b/i;
const ALLOWED_COMPUTED_STYLE_FIELDS = new Set([
  'backgroundColor',
  'borderColor',
  'borderRadius',
  'color',
  'display',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'height',
  'lineHeight',
  'margin',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginTop',
  'maxWidth',
  'minWidth',
  'opacity',
  'overflow',
  'padding',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'position',
  'visibility',
  'width',
  'zIndex',
]);
const ALLOWED_ATTRIBUTE_FIELDS = new Set(['aria-label', 'aria-describedby', 'aria-expanded', 'aria-current', 'href', 'src', 'alt', 'title', 'type', 'name', 'placeholder', 'value']);
const ALLOWED_DATASET_FIELDS = /^[a-zA-Z][a-zA-Z0-9_-]{0,48}$/;

export function browserRuntimeCodexFeatureMatrix(): BrowserRuntimeCodexFeature[] {
  return [
    {
      codexFeature: 'browser/tabs session management',
      sciforgeSurface: 'BrowserRuntimeSession and BrowserRuntimeTab projection',
      owner: 'browser_runtime',
      notes: 'The TUI runtime owns session and tab state; GUI can only display the projection or send terminal-equivalent browser commands.',
    },
    {
      codexFeature: 'browser visibility and viewport capabilities',
      sciforgeSurface: 'BrowserHostSession frame viewer and browser.viewport.* commands',
      owner: 'browser_host_session',
      notes: 'The host owns live page pixels, navigation state, and viewport sizing; GUI renders the frame refs and sends viewer input as host actions.',
    },
    {
      codexFeature: 'browser.user.openTabs',
      sciforgeSurface: 'browser.user.openTabs read-only command behind explicit approval',
      owner: 'browser_runtime',
      notes: 'Reading human browser tab context is privacy-sensitive and is not part of default headless research browsing.',
    },
    {
      codexFeature: 'tab.goto/reload/back/close',
      sciforgeSurface: 'BrowserRuntimeCommand tab.navigate/tab.reload/tab.back/tab.close',
      owner: 'browser_runtime',
      notes: 'Commands map to Playwright MCP navigation and tabs actions.',
    },
    {
      codexFeature: 'DOM CUA and Playwright actions',
      sciforgeSurface: 'dom_cua.* and playwright.* commands plus page.click/page.type/page.keypress/page.scroll',
      owner: 'playwright_browser_automation',
      notes: 'Use DOM/Playwright actions before system-level Computer Use. Site-specific extraction stays in invocation input.',
    },
    {
      codexFeature: 'CUA coordinate actions',
      sciforgeSurface: 'BrowserHostSession computer-use-actions click/double_click/mouse_down/mouse_move/mouse_up/wheel/type/press/cursor contract',
      owner: 'browser_host_session',
      notes: 'Browser coordinate actions enter the same host-owned live browser session and do not create a second interactive surface.',
    },
    {
      codexFeature: 'screenshots and DOM snapshots',
      sciforgeSurface: 'BrowserHostSession / BrowserRuntimeSnapshot refs',
      owner: 'browser_host_session',
      notes: 'Page frames, screenshots, DOM/AX snapshots, console logs, and network logs are refs-first and never stored as base64 in workspace state.',
    },
    {
      codexFeature: 'clipboard API',
      sciforgeSurface: 'clipboard.read and clipboard.write commands',
      owner: 'browser_runtime',
      notes: 'Clipboard reads/writes are modeled but require approval because they can expose or mutate user-local state.',
    },
    {
      codexFeature: 'developer logs',
      sciforgeSurface: 'dev.logs/logs.console/logs.network refs',
      owner: 'browser_runtime',
      notes: 'Logs are bounded and materialized as refs before GUI presentation.',
    },
    {
      codexFeature: 'frames, dialogs, storage, and idle waits',
      sciforgeSurface: 'browser.list_frames/browser.switch_frame/browser.list_dialogs/browser.handle_dialog/browser.get_storage/browser.wait_for_idle',
      owner: 'browser_runtime',
      notes: 'Frame and dialog state is explicit in the command surface; cross-origin frames are marked inaccessible instead of guessed.',
    },
    {
      codexFeature: 'read-only page inspection DSL',
      sciforgeSurface: 'BrowserRuntimePageQuery',
      owner: 'browser_runtime',
      notes: 'Models fill a bounded query schema; arbitrary JavaScript is not part of the default read-only inspection surface.',
    },
    {
      codexFeature: 'visible browser and human takeover',
      sciforgeSurface: 'playwright_edge_browser visible takeover provider',
      owner: 'playwright_edge_browser',
      notes: 'Visible browser is opt-in for login/manual takeover and requires approval before persistent-profile or account actions.',
    },
    {
      codexFeature: 'coordinate CUA handoff',
      sciforgeSurface: 'Computer Use action provider',
      owner: 'computer_use',
      notes: 'Computer Use may own non-browser app/window surfaces; browser pages keep their own BrowserHostSession live surface.',
    },
  ];
}

export function browserRuntimeCommandRisk(command: BrowserRuntimeCommand): BrowserRuntimeCommandRisk {
  const reasons: string[] = [];
  if (HIGH_RISK_COMMANDS.has(command.type)) reasons.push(`${command.type} can expose or mutate user-local state.`);
  if (command.type.startsWith('cua.')) reasons.push('Coordinate browser actions must be target-bound and traced before execution.');
  if (command.visible || command.requiresHumanTakeover) reasons.push('Visible takeover or persistent browser profile requires explicit user approval.');
  const targetCarriesUserAction = command.type.startsWith('page.')
    || command.type.startsWith('cua.')
    || command.type.startsWith('dom_cua.')
    || command.type.startsWith('playwright.')
    || command.type === 'browser.upload_file'
    || command.type === 'browser.handle_dialog';
  const searchableText = [command.type, targetCarriesUserAction ? command.target : undefined, command.text, command.url, command.startUrl].filter(Boolean).join(' ');
  if (HIGH_RISK_TEXT.test(searchableText)) reasons.push('Command text suggests login, authorization, upload, download, external submit, delete, payment, or clipboard risk.');
  if (command.type === 'page.type' && command.text && /(?:password|token|api[_-]?key|secret|验证码|密码|密钥)/i.test(command.text)) {
    reasons.push('Typed text appears secret-like and must not be sent without approval.');
  }
  if (command.type === 'tab.navigate' || command.type === 'session.open' || command.type === 'tab.new') {
    const url = command.url ?? command.startUrl ?? '';
    if (url && !/^https?:\/\//i.test(url)) reasons.push('Navigation URL is not an http(s) URL.');
  }
  const high = reasons.length > 0;
  return {
    level: high ? 'high' : command.type.startsWith('page.') || command.type.startsWith('logs.') || command.type === 'tab.snapshot' ? 'medium' : 'low',
    requiresApproval: high,
    reasons,
    suggestedMode: command.visible || command.requiresHumanTakeover ? 'visible-takeover' : 'agent-headless',
  };
}

export function browserRuntimePlaywrightActionsForCommand(command: BrowserRuntimeCommand): BrowserRuntimePlaywrightAction[] {
  switch (command.type) {
    case 'session.open':
    case 'tab.new':
      return command.startUrl || command.url ? [{ type: 'tabs', action: 'new', url: command.startUrl ?? command.url }] : [{ type: 'tabs', action: 'new' }];
    case 'tab.select':
      return [{ type: 'tabs', action: 'select', index: numericTabIndex(command.tabId) }];
    case 'tab.close':
      return [{ type: 'tabs', action: 'close', index: numericTabIndex(command.tabId) }];
    case 'tab.navigate':
      return [{ type: 'navigate', url: requiredCommandField(command.url, 'url') }];
    case 'tab.back':
      return [{ type: 'back' }];
    case 'tab.reload':
      return [{ type: 'pressKey', key: 'Meta+R' }];
    case 'tab.snapshot':
      return [
        ...(command.dom !== false ? [{ type: 'snapshot' }] : []),
        ...(command.screenshot ? [{ type: 'screenshot', fullPage: true }] : []),
        ...(command.logs ? [{ type: 'consoleMessages', all: true }, { type: 'networkRequests' }] : []),
      ];
    case 'browser.get_network_log':
      return [{ type: 'networkRequests' }];
    case 'browser.wait_for_idle':
      return [{ type: 'wait', idle: true, timeoutMs: command.timeoutMs ?? 2000 }];
    case 'browser.list_frames':
      return [{ type: 'evaluate', query: 'frames' }];
    case 'browser.switch_frame':
      return [{ type: 'evaluate', query: 'switchFrame', target: command.target }];
    case 'browser.list_dialogs':
      return [{ type: 'evaluate', query: 'dialogs' }];
    case 'browser.handle_dialog':
      return [{ type: 'handleDialog', action: command.text ?? 'accept' }];
    case 'browser.get_storage':
      return [{ type: 'evaluate', query: 'storage', readonly: true }];
    case 'browser.upload_file':
      return [{ type: 'uploadFiles', target: requiredCommandField(command.target, 'target'), files: command.text ? [command.text] : [] }];
    case 'browser.emulate_media':
      return [{ type: 'resize', media: command.target }];
    case 'page.click':
      return [{ type: 'click', target: requiredCommandField(command.target, 'target') }];
    case 'page.type':
      return [{ type: 'type', target: requiredCommandField(command.target, 'target'), text: requiredCommandField(command.text, 'text') }];
    case 'page.keypress':
      return [{ type: 'pressKey', key: requiredCommandField(command.key, 'key') }];
    case 'page.scroll':
      return [{ type: 'scroll', deltaX: command.deltaX ?? 0, deltaY: command.deltaY ?? 600 }];
    case 'logs.console':
      return [{ type: 'consoleMessages', all: true }];
    case 'logs.network':
      return [{ type: 'networkRequests' }];
    case 'browser.close':
      return [{ type: 'tabs', action: 'close' }];
    default:
      return [];
  }
}

export function browserRuntimeTraceForCommand(input: {
  command: BrowserRuntimeCommand;
  sessionId?: string;
  tabId?: string;
  refs?: BrowserRuntimeTraceRef[];
  raw?: Record<string, unknown>;
  diagnostics?: string[];
}): BrowserRuntimeTrace {
  const dropped = inlineLargeObjectKeys(input.raw ?? {});
  return {
    schemaVersion: 'sciforge.browser-runtime.trace.v1',
    commandType: input.command.type,
    sessionId: input.sessionId ?? input.command.sessionId,
    tabId: input.tabId ?? input.command.tabId,
    refs: [...(input.refs ?? []), ...refsFromRaw(input.raw ?? {})],
    diagnostics: [
      ...(input.diagnostics ?? []),
      ...(dropped.length ? [`Dropped inline browser evidence fields: ${dropped.join(', ')}`] : []),
    ],
    inlineLargeObjectsDropped: dropped,
  };
}

export function browserRuntimeProjection(input: {
  session: BrowserRuntimeSession;
  snapshot?: BrowserRuntimeSnapshot;
  hostSession?: BrowserHostSessionState;
  trace?: BrowserRuntimeTrace;
}): BrowserRuntimeProjection {
  return {
    schemaVersion: 'sciforge.browser-runtime.projection.v1',
    session: input.session,
    activeTab: input.session.tabs.find((tab) => tab.id === input.session.activeTabId),
    snapshot: input.snapshot,
    hostSession: input.hostSession,
    traceRefs: input.trace?.refs ?? [],
    guiBoundary: {
      taskReasoning: false,
      providerRouting: false,
      promptAssembly: false,
      presentationOnly: true,
    },
  };
}

export function browserRuntimeSnapshotFromRefs(input: {
  url?: string;
  title?: string;
  textPreview?: string;
  screenshotRef?: string;
  domSnapshotRef?: string;
  axSnapshotRef?: string;
  consoleLogRef?: string;
  networkLogRef?: string;
  searchResultRef?: string;
}): BrowserRuntimeSnapshot {
  return {
    schemaVersion: 'sciforge.browser-runtime.snapshot.v1',
    ...compactRecord(input),
  };
}

export function buildBrowserRuntimeStableRef(input: BrowserRuntimeStableRefInput): BrowserRuntimeStableRef {
  const primary = firstNonEmpty(
    input.testId ? `[data-testid="${cssAttrEscape(input.testId)}"]` : undefined,
    input.id ? `#${cssIdentEscape(input.id)}` : undefined,
    input.selector,
    input.componentPath,
    input.accessibleName && input.role ? `${input.role}:${input.accessibleName}` : undefined,
    input.domPath,
    input.visualHash,
  );
  const exactSignals = [input.testId, input.id, input.selector, input.componentPath].filter(Boolean).length;
  return {
    schemaVersion: 'sciforge.browser-runtime.stable-ref.v1',
    primary,
    resolveStrategy: exactSignals > 0 ? 'exact' : 'best-match',
    signals: compactRecord({
      testId: nonEmpty(input.testId),
      id: nonEmpty(input.id),
      selector: nonEmpty(input.selector),
      domPath: input.domPath.trim(),
      role: nonEmpty(input.role),
      accessibleName: nonEmpty(input.accessibleName),
      textHash: input.text ? stableTextHash(input.text) : undefined,
      bbox: input.bbox,
      componentPath: nonEmpty(input.componentPath),
      visualHash: nonEmpty(input.visualHash),
    }) as BrowserRuntimeStableRef['signals'],
  };
}

export function normalizeBrowserRuntimePageQuery(input: BrowserRuntimePageQueryInput): BrowserRuntimePageQuery {
  validatePageQuerySelector(input.select);
  const fields = Array.from(new Set(input.fields.map((field) => normalizePageQueryField(field))));
  if (fields.length === 0) throw new Error('browser_runtime PageQuery requires at least one field.');
  return {
    schemaVersion: 'sciforge.browser-runtime.page-query.v1',
    select: input.select,
    fields,
    limit: clampNumber(input.limit ?? 50, 1, 100),
  };
}

export function browserRuntimePageQueryRisk(query: BrowserRuntimePageQuery): BrowserRuntimeCommandRisk {
  const reasons: string[] = [];
  if ('selector' in query.select && /^javascript:|data:/i.test(query.select.selector)) reasons.push('Selector looks like executable or data URL content.');
  return {
    level: reasons.length ? 'medium' : 'low',
    requiresApproval: false,
    reasons,
    suggestedMode: 'agent-headless',
  };
}

function refsFromRaw(raw: Record<string, unknown>): BrowserRuntimeTraceRef[] {
  const refs: BrowserRuntimeTraceRef[] = [];
  pushTraceRef(refs, 'browser-frame', raw.frameRef);
  pushTraceRef(refs, 'screenshot', raw.screenshotRef);
  pushTraceRef(refs, 'dom-snapshot', raw.domSnapshotRef);
  pushTraceRef(refs, 'ax-snapshot', raw.axSnapshotRef);
  pushTraceRef(refs, 'console-log', raw.consoleLogRef);
  pushTraceRef(refs, 'network-log', raw.networkLogRef);
  pushTraceRef(refs, 'search-result', raw.searchResultRef);
  return refs;
}

function pushTraceRef(refs: BrowserRuntimeTraceRef[], kind: BrowserRuntimeTraceRefKind, value: unknown) {
  if (typeof value === 'string' && value.trim()) refs.push({ kind, ref: value.trim() });
}

function inlineLargeObjectKeys(raw: Record<string, unknown>) {
  return Object.entries(raw)
    .filter(([key, value]) => (
      /(?:dataUrl|base64|screenshot|dom|console|network|html)$/i.test(key)
      && typeof value === 'string'
      && (value.startsWith('data:image/') || value.length > 4096)
    ))
    .map(([key]) => key);
}

function requiredCommandField(value: unknown, field: string) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new Error(`browser_runtime command requires ${field}.`);
}

function numericTabIndex(tabId: string | undefined) {
  if (!tabId) return undefined;
  const number = Number(tabId.replace(/^tab[-_]?/i, ''));
  return Number.isFinite(number) ? number : undefined;
}

function compactRecord<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== '')) as Partial<T>;
}

function validatePageQuerySelector(selector: BrowserRuntimePageQuerySelector) {
  if ('selector' in selector) {
    if (!selector.selector.trim()) throw new Error('browser_runtime PageQuery selector cannot be empty.');
    if (/:has\([^)]*:has\(/i.test(selector.selector)) throw new Error('browser_runtime PageQuery selector rejects nested :has().');
  }
  if ('ref' in selector && !selector.ref.trim()) throw new Error('browser_runtime PageQuery ref cannot be empty.');
}

function normalizePageQueryField(field: BrowserRuntimePageQueryField): BrowserRuntimePageQueryField {
  const normalized = String(field).trim() as BrowserRuntimePageQueryField;
  if (!normalized) throw new Error('browser_runtime PageQuery field cannot be empty.');
  if (normalized.startsWith('computedStyle.')) {
    const name = normalized.slice('computedStyle.'.length);
    if (!ALLOWED_COMPUTED_STYLE_FIELDS.has(name)) throw new Error(`browser_runtime PageQuery field is not allowed: ${normalized}`);
    return normalized;
  }
  if (normalized.startsWith('attribute.')) {
    const name = normalized.slice('attribute.'.length);
    if (!ALLOWED_ATTRIBUTE_FIELDS.has(name)) throw new Error(`browser_runtime PageQuery field is not allowed: ${normalized}`);
    return normalized;
  }
  if (normalized.startsWith('dataset.')) {
    const name = normalized.slice('dataset.'.length);
    if (!ALLOWED_DATASET_FIELDS.test(name)) throw new Error(`browser_runtime PageQuery field is not allowed: ${normalized}`);
    return normalized;
  }
  const baseFields = new Set(['tagName', 'role', 'ariaLabel', 'ariaDescription', 'innerText', 'textContent', 'bbox', 'isVisible', 'isFocusable', 'value', 'href', 'src', 'alt']);
  if (!baseFields.has(normalized)) throw new Error(`browser_runtime PageQuery field is not allowed: ${normalized}`);
  return normalized;
}

function stableTextHash(text: string) {
  let hash = 0xcbf29ce4;
  const normalized = text.replace(/\s+/g, ' ').trim().slice(0, 80);
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').repeat(2).slice(0, 16);
}

function firstNonEmpty(...values: Array<string | undefined>) {
  const value = values.find((candidate) => typeof candidate === 'string' && candidate.trim());
  if (!value) throw new Error('browser_runtime stable ref requires at least one stable signal.');
  return value.trim();
}

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function cssAttrEscape(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function cssIdentEscape(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
