import { defaultSciForgeConfig, normalizeWorkspaceRootPath } from '../../config';
import { scenarios, type ScenarioId } from '../../data';
import type { SciForgeConfig, SciForgeWorkspaceState } from '../../domain';
import { createInitialWorkspaceState, createSession } from '../../sessionStore';
import type { ResultPaneTab } from './ResultShell';
import {
  baseResultPaneTabId,
  createDefaultRightPaneTabs,
  rightPaneStateStorageKey,
  type StoredRightPaneState,
} from './resultPaneLifecycle';
import type { ResultLocale } from './resultLocale';

export const RIGHT_PANE_SCOPED_SMOKE_DEFAULT_TABS: ResultPaneTab[] = [
  'primary',
  'browser',
  'image',
  'terminal',
  'files',
  'evidence',
];

export const RIGHT_PANE_SCOPED_SMOKE_SELECTORS = {
  root: '#root',
  shell: '.results-panel[data-result-tab]',
  tabLayout: '.result-tabs[data-right-pane-tab-layout="scroll-tabs-fixed-actions"]',
  tablist: '.result-tabstrip[role="tablist"][aria-orientation="horizontal"][data-overflow-policy="horizontal-scroll"]',
  tabs: '.result-page-tab[role="tab"]',
  selectedTab: '.result-page-tab[role="tab"][aria-selected="true"]',
  panel: '.result-content[role="tabpanel"]',
  fixedNewAction: '[data-fixed-action="new"]',
  fixedCloseAction: '[data-fixed-action="close"]',
  fixedFocusModeAction: '[data-fixed-action="focus-mode"]',
  browserTool: '[data-testid="right-pane-browser-tool"]',
  browserWorkbench: '[data-component-id="browser-workbench"]',
  browserPresentationBoundary: '[data-component-id="browser-workbench"][data-render-boundary="presentation-only"]',
  browserUrlInput: 'input[name="browser-url"][aria-label="Browser URL"]',
  browserSystemWindowSurface: '[data-browser-host-surface="system-browser-window"]',
  browserProxyIframe: '[data-component-id="browser-workbench"] iframe[src^="/api/sciforge/browser/proxy"]',
  browserDirectExternalAnchor: '[data-component-id="browser-workbench"] a[href^="http://"], [data-component-id="browser-workbench"] a[href^="https://"]',
  browserUnsupportedLiveSurface: [
    '[data-component-id="browser-workbench"] [data-browser-frame-stream-ref]',
    '[data-component-id="browser-workbench"] [data-browser-frame-source]',
    '[data-component-id="browser-workbench"] [data-browser-frame-renderer]',
    '[data-component-id="browser-workbench"] [data-browser-webrtc-handoff]',
    '[data-component-id="browser-workbench"] [data-browser-frame-transport="host-stream"]',
    '[data-component-id="browser-workbench"] [data-browser-frame-transport="websocket-binary"]',
    '[data-component-id="browser-workbench"] [data-browser-frame-transport="webrtc-data-channel"]',
  ].join(', '),
  browserCanvasSurface: '[data-component-id="browser-workbench"] canvas, [data-component-id="browser-workbench"] [data-browser-frame-renderer="canvas-binary"]',
  browserHttpFrameImage: '[data-component-id="browser-workbench"] img[src^="blob:"], [data-component-id="browser-workbench"] img[src^="/api/sciforge/browser-host/"][src*="/frame"]',
  imageEvidenceViewer: '[data-component-id="image-evidence-viewer"]',
  terminalViewer: '[data-component-id="terminal-session-viewer"]',
  terminalTool: '[data-testid="right-pane-terminal-tool"]',
  terminalHostOwnedSurface: '[data-terminal-live-surface="host-owned"]',
  terminalWriterDiagnostic: '[data-terminal-writer-diagnostic]',
  terminalInputDisabled: '[data-terminal-action="input"][disabled]',
  filesViewer: '[data-component-id="workspace-file-viewer"]',
  fileRows: '.workspace-file-viewer-row',
  referencesTool: '[data-testid="right-pane-references-tool"]',
} as const;

export interface RightPaneScopedSmokeSeedInput {
  instanceId?: string;
  workspacePath: string;
  workspaceWriterBaseUrl: string;
  agentServerBaseUrl?: string;
  locale?: ResultLocale;
  theme?: SciForgeConfig['theme'];
  activeTab?: ResultPaneTab;
  browserAddress?: string;
  scenarioId?: ScenarioId;
  updatedAt?: string;
}

export interface RightPaneScopedSmokeStorageKeys {
  config: string;
  workspace: string;
  rightPane: string;
}

export interface RightPaneScopedSmokeStorageEntry {
  key: string;
  value: string;
}

export interface RightPaneScopedSmokeStorageSeed {
  keys: RightPaneScopedSmokeStorageKeys;
  config: SciForgeConfig;
  workspaceState: SciForgeWorkspaceState;
  rightPaneState: StoredRightPaneState;
  entries: RightPaneScopedSmokeStorageEntry[];
  navigationPath: string;
}

export interface RightPaneScopedSmokeEvidenceInput {
  blockedByClient?: unknown;
  rootMounted?: unknown;
  title?: unknown;
  shellCount?: unknown;
  tabLayoutCount?: unknown;
  tablistCount?: unknown;
  tabCount?: unknown;
  tabLabels?: unknown;
  selectedTabLabel?: unknown;
  panelCount?: unknown;
  selectedPanelLabelledBySelectedTab?: unknown;
  fixedNewActionCount?: unknown;
  fixedCloseActionCount?: unknown;
  fixedFocusModeCount?: unknown;
  browserToolCount?: unknown;
  browserWorkbenchCount?: unknown;
  browserPresentationBoundaryCount?: unknown;
  browserUrlInputCount?: unknown;
  browserAddressValue?: unknown;
  browserStateLabel?: unknown;
  browserSystemWindowSurfaceCount?: unknown;
  browserProxyIframeCount?: unknown;
  browserDirectExternalAnchorCount?: unknown;
  browserUnsupportedLiveSurfaceCount?: unknown;
  browserCanvasSurfaceCount?: unknown;
  browserHttpFrameImageCount?: unknown;
  imageEvidenceViewerCount?: unknown;
  imageEvidenceStatusLabel?: unknown;
  terminalViewerCount?: unknown;
  terminalToolCount?: unknown;
  terminalHostOwnedCount?: unknown;
  terminalWriterDiagnosticCount?: unknown;
  terminalInputDisabled?: unknown;
  filesViewerCount?: unknown;
  fileRowCount?: unknown;
  referencesToolCount?: unknown;
  referencesStateLabel?: unknown;
  afterReloadTabCount?: unknown;
  afterReloadSelectedLabel?: unknown;
  afterReloadBrowserToolCount?: unknown;
}

export interface RightPaneScopedSmokeEvidence {
  blockedByClient: boolean;
  rootMounted: boolean;
  title: string;
  shellCount: number;
  tabLayoutCount: number;
  tablistCount: number;
  tabCount: number;
  tabLabels: string[];
  selectedTabLabel: string;
  panelCount: number;
  selectedPanelLabelledBySelectedTab: boolean;
  fixedNewActionCount: number;
  fixedCloseActionCount: number;
  fixedFocusModeCount: number;
  browserToolCount: number;
  browserWorkbenchCount: number;
  browserPresentationBoundaryCount: number;
  browserUrlInputCount: number;
  browserAddressValue: string;
  browserStateLabel: string;
  browserSystemWindowSurfaceCount: number;
  browserProxyIframeCount: number;
  browserDirectExternalAnchorCount: number;
  browserUnsupportedLiveSurfaceCount: number;
  browserCanvasSurfaceCount: number;
  browserHttpFrameImageCount: number;
  imageEvidenceViewerCount: number;
  imageEvidenceStatusLabel: string;
  terminalViewerCount: number;
  terminalToolCount: number;
  terminalHostOwnedCount: number;
  terminalWriterDiagnosticCount: number;
  terminalInputDisabled: boolean;
  filesViewerCount: number;
  fileRowCount: number;
  referencesToolCount: number;
  referencesStateLabel: string;
  afterReloadTabCount: number;
  afterReloadSelectedLabel: string;
  afterReloadBrowserToolCount: number;
}

export function rightPaneScopedSmokeStorageKey(baseKey: string, instanceId?: string) {
  const segment = cleanStorageKeySegment(instanceId);
  return segment ? `${baseKey}.${segment}` : baseKey;
}

export function rightPaneScopedSmokeStorageKeys(input: Pick<RightPaneScopedSmokeSeedInput, 'instanceId' | 'workspacePath'>): RightPaneScopedSmokeStorageKeys {
  const workspacePath = normalizeWorkspaceRootPath(input.workspacePath);
  return {
    config: rightPaneScopedSmokeStorageKey('sciforge.config.v1', input.instanceId),
    workspace: rightPaneScopedSmokeStorageKey('sciforge.workspace.v2', input.instanceId),
    rightPane: rightPaneStateStorageKey(workspacePath),
  };
}

export function createRightPaneScopedSmokeStorageSeed(input: RightPaneScopedSmokeSeedInput): RightPaneScopedSmokeStorageSeed {
  const workspacePath = normalizeWorkspaceRootPath(input.workspacePath);
  if (!workspacePath) {
    throw new Error('right pane scoped smoke requires a workspacePath');
  }
  const keys = rightPaneScopedSmokeStorageKeys({ instanceId: input.instanceId, workspacePath });
  const config = createRightPaneScopedSmokeConfig({ ...input, workspacePath });
  const workspaceState = createRightPaneScopedSmokeWorkspaceState(workspacePath);
  const rightPaneState = createRightPaneScopedSmokeRightPaneState(input);
  const navigationPath = rightPaneScopedSmokeNavigationPath(input.scenarioId);
  return {
    keys,
    config,
    workspaceState,
    rightPaneState,
    entries: [
      { key: keys.config, value: JSON.stringify(config) },
      { key: keys.workspace, value: JSON.stringify(workspaceState) },
      { key: keys.rightPane, value: JSON.stringify(rightPaneState) },
    ],
    navigationPath,
  };
}

export function createRightPaneScopedSmokeConfig(input: RightPaneScopedSmokeSeedInput): SciForgeConfig {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  return {
    ...defaultSciForgeConfig,
    schemaVersion: 1,
    workspacePath: normalizeWorkspaceRootPath(input.workspacePath),
    workspaceWriterBaseUrl: cleanUrl(input.workspaceWriterBaseUrl),
    agentServerBaseUrl: cleanUrl(input.agentServerBaseUrl) || 'http://127.0.0.1:1',
    peerInstances: [],
    theme: input.theme ?? 'dark',
    locale: input.locale ?? 'en-US',
    modelProvider: 'right-pane-scoped-smoke',
    modelBaseUrl: '',
    modelName: '',
    apiKey: '',
    updatedAt,
  };
}

export function createRightPaneScopedSmokeWorkspaceState(workspacePath: string): SciForgeWorkspaceState {
  const emptySessions = Object.fromEntries(scenarios.map((scenario) => [
    scenario.id,
    createSession(scenario.id, `${scenario.name} smoke`),
  ])) as SciForgeWorkspaceState['sessionsByScenario'];
  return {
    ...createInitialWorkspaceState(),
    workspacePath: normalizeWorkspaceRootPath(workspacePath),
    sessionsByScenario: emptySessions,
  };
}

export function createRightPaneScopedSmokeRightPaneState(input: Pick<RightPaneScopedSmokeSeedInput, 'activeTab' | 'browserAddress' | 'locale'>): StoredRightPaneState {
  const activeTab = input.activeTab ?? 'browser';
  const browserTabId = baseResultPaneTabId('browser');
  return {
    tabs: createDefaultRightPaneTabs(input.locale),
    activeTabId: baseResultPaneTabId(activeTab),
    browserTabAddresses: {
      [browserTabId]: safeSmokeBrowserAddress(input.browserAddress),
    },
  };
}

export function rightPaneScopedSmokeNavigationPath(scenarioId?: ScenarioId) {
  const params = new URLSearchParams({ page: 'workbench' });
  if (scenarioId) params.set('scenarioId', scenarioId);
  return `/?${params.toString()}`;
}

export function createRightPaneScopedSmokeEvidence(input: RightPaneScopedSmokeEvidenceInput): RightPaneScopedSmokeEvidence {
  return {
    blockedByClient: Boolean(input.blockedByClient),
    rootMounted: Boolean(input.rootMounted),
    title: boundedSmokeLabel(input.title),
    shellCount: boundedSmokeCount(input.shellCount),
    tabLayoutCount: boundedSmokeCount(input.tabLayoutCount),
    tablistCount: boundedSmokeCount(input.tablistCount),
    tabCount: boundedSmokeCount(input.tabCount),
    tabLabels: boundedSmokeLabels(input.tabLabels, 8),
    selectedTabLabel: boundedSmokeLabel(input.selectedTabLabel),
    panelCount: boundedSmokeCount(input.panelCount),
    selectedPanelLabelledBySelectedTab: Boolean(input.selectedPanelLabelledBySelectedTab),
    fixedNewActionCount: boundedSmokeCount(input.fixedNewActionCount),
    fixedCloseActionCount: boundedSmokeCount(input.fixedCloseActionCount),
    fixedFocusModeCount: boundedSmokeCount(input.fixedFocusModeCount),
    browserToolCount: boundedSmokeCount(input.browserToolCount),
    browserWorkbenchCount: boundedSmokeCount(input.browserWorkbenchCount),
    browserPresentationBoundaryCount: boundedSmokeCount(input.browserPresentationBoundaryCount),
    browserUrlInputCount: boundedSmokeCount(input.browserUrlInputCount),
    browserAddressValue: boundedSmokeLabel(input.browserAddressValue),
    browserStateLabel: boundedSmokeLabel(input.browserStateLabel),
    browserSystemWindowSurfaceCount: boundedSmokeCount(input.browserSystemWindowSurfaceCount),
    browserProxyIframeCount: boundedSmokeCount(input.browserProxyIframeCount),
    browserDirectExternalAnchorCount: boundedSmokeCount(input.browserDirectExternalAnchorCount),
    browserUnsupportedLiveSurfaceCount: boundedSmokeCount(input.browserUnsupportedLiveSurfaceCount),
    browserCanvasSurfaceCount: boundedSmokeCount(input.browserCanvasSurfaceCount),
    browserHttpFrameImageCount: boundedSmokeCount(input.browserHttpFrameImageCount),
    imageEvidenceViewerCount: boundedSmokeCount(input.imageEvidenceViewerCount),
    imageEvidenceStatusLabel: boundedSmokeLabel(input.imageEvidenceStatusLabel),
    terminalViewerCount: boundedSmokeCount(input.terminalViewerCount),
    terminalToolCount: boundedSmokeCount(input.terminalToolCount),
    terminalHostOwnedCount: boundedSmokeCount(input.terminalHostOwnedCount),
    terminalWriterDiagnosticCount: boundedSmokeCount(input.terminalWriterDiagnosticCount),
    terminalInputDisabled: Boolean(input.terminalInputDisabled),
    filesViewerCount: boundedSmokeCount(input.filesViewerCount),
    fileRowCount: boundedSmokeCount(input.fileRowCount),
    referencesToolCount: boundedSmokeCount(input.referencesToolCount),
    referencesStateLabel: boundedSmokeLabel(input.referencesStateLabel),
    afterReloadTabCount: boundedSmokeCount(input.afterReloadTabCount),
    afterReloadSelectedLabel: boundedSmokeLabel(input.afterReloadSelectedLabel),
    afterReloadBrowserToolCount: boundedSmokeCount(input.afterReloadBrowserToolCount),
  };
}

export interface RightPaneScopedSmokeDomElement {
  textContent?: string | null;
  value?: unknown;
  getAttribute?: (name: string) => string | null;
}

export interface RightPaneScopedSmokeDomLike {
  title?: string;
  querySelector: (selector: string) => RightPaneScopedSmokeDomElement | null;
  querySelectorAll: (selector: string) => ArrayLike<RightPaneScopedSmokeDomElement>;
}

export function collectRightPaneScopedSmokeSignals(
  documentLike: RightPaneScopedSmokeDomLike,
  options: { blockedByClient?: unknown } = {},
): RightPaneScopedSmokeEvidence {
  const selectors = RIGHT_PANE_SCOPED_SMOKE_SELECTORS;
  const selectedTab = one(documentLike, selectors.selectedTab);
  const selectedTabId = attr(selectedTab, 'id');
  const activePanel = one(documentLike, selectors.panel);
  const browserWorkbench = one(documentLike, selectors.browserWorkbench);
  const imageEvidenceViewer = one(documentLike, selectors.imageEvidenceViewer);
  const terminalViewer = one(documentLike, selectors.terminalViewer);
  const referencesTool = one(documentLike, selectors.referencesTool);
  const browserUrlInput = one(documentLike, selectors.browserUrlInput);
  return createRightPaneScopedSmokeEvidence({
    blockedByClient: options.blockedByClient,
    rootMounted: count(documentLike, selectors.root) > 0,
    title: documentLike.title,
    shellCount: count(documentLike, selectors.shell),
    tabLayoutCount: count(documentLike, selectors.tabLayout),
    tablistCount: count(documentLike, selectors.tablist),
    tabCount: count(documentLike, selectors.tabs),
    tabLabels: all(documentLike, selectors.tabs).map((element) => element.textContent ?? ''),
    selectedTabLabel: selectedTab?.textContent,
    panelCount: count(documentLike, selectors.panel),
    selectedPanelLabelledBySelectedTab: Boolean(selectedTabId && attr(activePanel, 'aria-labelledby') === selectedTabId),
    fixedNewActionCount: count(documentLike, selectors.fixedNewAction),
    fixedCloseActionCount: count(documentLike, selectors.fixedCloseAction),
    fixedFocusModeCount: count(documentLike, selectors.fixedFocusModeAction),
    browserToolCount: count(documentLike, selectors.browserTool),
    browserWorkbenchCount: count(documentLike, selectors.browserWorkbench),
    browserPresentationBoundaryCount: count(documentLike, selectors.browserPresentationBoundary),
    browserUrlInputCount: count(documentLike, selectors.browserUrlInput),
    browserAddressValue: inputValue(browserUrlInput),
    browserStateLabel: attr(browserWorkbench, 'data-browser-state') || attr(browserWorkbench, 'data-status'),
    browserSystemWindowSurfaceCount: count(documentLike, selectors.browserSystemWindowSurface),
    browserProxyIframeCount: count(documentLike, selectors.browserProxyIframe),
    browserDirectExternalAnchorCount: count(documentLike, selectors.browserDirectExternalAnchor),
    browserUnsupportedLiveSurfaceCount: count(documentLike, selectors.browserUnsupportedLiveSurface),
    browserCanvasSurfaceCount: count(documentLike, selectors.browserCanvasSurface),
    browserHttpFrameImageCount: count(documentLike, selectors.browserHttpFrameImage),
    imageEvidenceViewerCount: count(documentLike, selectors.imageEvidenceViewer),
    imageEvidenceStatusLabel: attr(imageEvidenceViewer, 'data-status'),
    terminalViewerCount: count(documentLike, selectors.terminalViewer),
    terminalToolCount: count(documentLike, selectors.terminalTool),
    terminalHostOwnedCount: count(documentLike, selectors.terminalHostOwnedSurface),
    terminalWriterDiagnosticCount: count(documentLike, selectors.terminalWriterDiagnostic),
    terminalInputDisabled: count(documentLike, selectors.terminalInputDisabled) > 0,
    filesViewerCount: count(documentLike, selectors.filesViewer),
    fileRowCount: count(documentLike, selectors.fileRows),
    referencesToolCount: count(documentLike, selectors.referencesTool),
    referencesStateLabel: attr(referencesTool, 'data-state'),
  });
}

export function rightPaneScopedSmokeEvidenceHasDefaultTabs(evidence: Pick<RightPaneScopedSmokeEvidence, 'tabLabels' | 'tabCount' | 'tablistCount'>) {
  const labels = new Set(evidence.tabLabels.map((label) => label.toLowerCase()));
  return evidence.tablistCount > 0
    && evidence.tabCount >= RIGHT_PANE_SCOPED_SMOKE_DEFAULT_TABS.length
    && ['results', 'browser', 'image', 'terminal', 'files', 'references'].every((label) => labels.has(label));
}

function cleanStorageKeySegment(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') : '';
}

function cleanUrl(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

function safeSmokeBrowserAddress(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return 'about:blank';
  if (raw === 'about:blank') return raw;
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch {
    // Fall through to the inert default.
  }
  return 'about:blank';
}

function boundedSmokeCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(99, Math.max(0, Math.trunc(value)))
    : 0;
}

function boundedSmokeLabels(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return value.map(boundedSmokeLabel).filter(Boolean).slice(0, limit);
}

function boundedSmokeLabel(value: unknown) {
  const raw = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!raw) return '';
  if (/data:image|base64|authorization|api[-_ ]?key|bearer\s+|secret|password|credential/i.test(raw)) {
    return '[redacted]';
  }
  return raw.length > 80 ? `${raw.slice(0, 77).trim()}...` : raw;
}

function all(documentLike: RightPaneScopedSmokeDomLike, selector: string) {
  return Array.from(documentLike.querySelectorAll(selector) ?? []);
}

function one(documentLike: RightPaneScopedSmokeDomLike, selector: string) {
  return documentLike.querySelector(selector);
}

function count(documentLike: RightPaneScopedSmokeDomLike, selector: string) {
  return all(documentLike, selector).length;
}

function attr(element: RightPaneScopedSmokeDomElement | null | undefined, name: string) {
  return element?.getAttribute?.(name) ?? '';
}

function inputValue(element: RightPaneScopedSmokeDomElement | null | undefined) {
  return typeof element?.value === 'string' ? element.value : attr(element, 'value');
}
