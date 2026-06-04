import type { ResultPaneTab, ResultPaneTabInstance } from './ResultShell';
import { resultText, type ResultLocale } from './resultLocale';
import { publicScopeToken } from '../../publicProjectionSanitizer';

const DEFAULT_RIGHT_PANE_TABS: ResultPaneTab[] = ['primary', 'browser', 'image', 'terminal', 'files', 'evidence'];

export type RightPaneFocusTarget =
  | { kind: 'tab'; tabId: string }
  | { kind: 'new-button' };

export interface RightPaneTabLifecycleState {
  tabs: ResultPaneTabInstance[];
  activeTabId: string;
  browserTabAddresses: Record<string, string>;
}

export interface RightPaneTabLifecycleTransition extends RightPaneTabLifecycleState {
  focusTarget: RightPaneFocusTarget;
}

export type StoredRightPaneState = RightPaneTabLifecycleState;

export function baseResultPaneTabId(kind: ResultPaneTab) {
  return `base:${canonicalResultPaneTab(kind)}`;
}

export function createDefaultRightPaneTabs(locale?: ResultLocale): ResultPaneTabInstance[] {
  return DEFAULT_RIGHT_PANE_TABS.map((kind) => ({
    id: baseResultPaneTabId(kind),
    kind,
    label: resultPaneTabInstanceLabel(kind, 1, locale),
    closable: true,
  }));
}

export function ensureRightPaneTab(tabs: readonly ResultPaneTabInstance[], kind: ResultPaneTab, locale?: ResultLocale): ResultPaneTabInstance[] {
  const canonicalKind = canonicalResultPaneTab(kind);
  if (tabs.some((tab) => tab.kind === canonicalKind)) return [...tabs];
  return [...tabs, {
    id: baseResultPaneTabId(canonicalKind),
    kind: canonicalKind,
    label: resultPaneTabInstanceLabel(canonicalKind, 1, locale),
    closable: true,
  }];
}

export function addRightPaneTabLifecycleState(
  state: RightPaneTabLifecycleState,
  tab: ResultPaneTab,
  locale?: ResultLocale,
  now = Date.now(),
): RightPaneTabLifecycleTransition {
  const canonicalTab = canonicalResultPaneTab(tab);
  const nextIndex = nextResultPaneTabIndex(state.tabs, canonicalTab);
  const nextTab: ResultPaneTabInstance = {
    id: `custom:${canonicalTab}:${now}:${nextIndex}`,
    kind: canonicalTab,
    label: resultPaneTabInstanceLabel(canonicalTab, nextIndex, locale),
    closable: true,
  };
  return {
    tabs: [...state.tabs, nextTab],
    activeTabId: nextTab.id,
    browserTabAddresses: state.browserTabAddresses,
    focusTarget: { kind: 'tab', tabId: nextTab.id },
  };
}

export function closeRightPaneTabLifecycleState(
  state: RightPaneTabLifecycleState,
  tabId: string,
): RightPaneTabLifecycleTransition {
  const targetIndex = state.tabs.findIndex((tab) => tab.id === tabId);
  if (targetIndex < 0) {
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    return {
      ...state,
      focusTarget: activeTab ? { kind: 'tab', tabId: activeTab.id } : { kind: 'new-button' },
    };
  }
  const nextTabs = state.tabs.filter((tab) => tab.id !== tabId);
  const browserTabAddresses = removeBrowserTabAddress(state.browserTabAddresses, tabId);
  if (!nextTabs.length) {
    return {
      tabs: nextTabs,
      activeTabId: '',
      browserTabAddresses,
      focusTarget: { kind: 'new-button' },
    };
  }
  if (state.activeTabId !== tabId && nextTabs.some((tab) => tab.id === state.activeTabId)) {
    return {
      tabs: nextTabs,
      activeTabId: state.activeTabId,
      browserTabAddresses,
      focusTarget: { kind: 'tab', tabId: state.activeTabId },
    };
  }
  const fallback = nextTabs[Math.max(0, targetIndex - 1)] ?? nextTabs[0];
  return {
    tabs: nextTabs,
    activeTabId: fallback.id,
    browserTabAddresses,
    focusTarget: { kind: 'tab', tabId: fallback.id },
  };
}

export function queueRightPaneFocus(target: RightPaneFocusTarget) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  window.setTimeout(() => {
    const element = target.kind === 'tab'
      ? document.getElementById(`result-tab-${target.tabId.replace(/[^A-Za-z0-9_-]/g, '-')}`)
      : document.querySelector<HTMLButtonElement>('.result-new-tab-button');
    element?.focus();
  }, 0);
}

export function rightPaneStateStorageKey(workspacePath: string | undefined) {
  return `sciforge.right-pane-state.v1.${publicScopeToken(workspacePath)}`;
}

export function loadStoredRightPaneState(storageKey: string, locale: ResultLocale | undefined, initialResultTab: ResultPaneTab): StoredRightPaneState {
  const initialCanonicalTab = canonicalResultPaneTab(initialResultTab);
  const fallbackTabs = createDefaultRightPaneTabs(locale);
  const fallbackActive = fallbackTabs.find((tab) => tab.kind === initialCanonicalTab)?.id ?? fallbackTabs[0]?.id ?? '';
  if (typeof window === 'undefined') {
    return { tabs: fallbackTabs, activeTabId: fallbackActive, browserTabAddresses: {} };
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return { tabs: fallbackTabs, activeTabId: fallbackActive, browserTabAddresses: {} };
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return { tabs: fallbackTabs, activeTabId: fallbackActive, browserTabAddresses: {} };
    const tabs = Array.isArray(parsed.tabs)
      ? normalizeStoredRightPaneTabs(parsed.tabs, locale)
      : fallbackTabs;
    const storedActiveTabId = typeof parsed.activeTabId === 'string'
      ? canonicalResultPaneTabId(parsed.activeTabId)
      : undefined;
    const activeTabId = storedActiveTabId && tabs.some((tab) => tab.id === storedActiveTabId)
      ? storedActiveTabId
      : tabs.find((tab) => tab.kind === initialCanonicalTab)?.id ?? tabs[0]?.id ?? '';
    return {
      tabs,
      activeTabId,
      browserTabAddresses: browserTabAddressesForOpenTabs(normalizeStoredBrowserTabAddresses(parsed.browserTabAddresses), tabs),
    };
  } catch {
    return { tabs: fallbackTabs, activeTabId: fallbackActive, browserTabAddresses: {} };
  }
}

export function saveStoredRightPaneState(storageKey: string, state: StoredRightPaneState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // UI state persistence should never break the workbench.
  }
}

function resultPaneTabInstanceLabel(kind: ResultPaneTab, index: number, locale?: ResultLocale) {
  const label = resultText(locale, {
    'zh-CN': kind === 'primary'
      ? '结果'
      : kind === 'browser'
        ? '浏览器'
        : kind === 'image' || kind === 'screen'
          ? '图片 / 证据'
          : kind === 'terminal'
            ? '终端'
            : kind === 'files'
              ? '文件'
              : '引用',
    'en-US': kind === 'primary'
      ? 'Results'
      : kind === 'browser'
        ? 'Browser'
        : kind === 'image' || kind === 'screen'
          ? 'Image / Evidence'
          : kind === 'terminal'
            ? 'Terminal'
            : kind === 'files'
              ? 'Files'
              : 'References',
  });
  return index > 1 ? `${label} ${index}` : label;
}

function nextResultPaneTabIndex(tabs: readonly ResultPaneTabInstance[], kind: ResultPaneTab) {
  return tabs.filter((tab) => tab.kind === kind).length + 1;
}

function removeBrowserTabAddress(addresses: Record<string, string>, tabId: string) {
  if (!(tabId in addresses)) return addresses;
  const { [tabId]: _removed, ...rest } = addresses;
  return rest;
}

function browserTabAddressesForOpenTabs(addresses: Record<string, string>, tabs: readonly ResultPaneTabInstance[]) {
  const openTabIds = new Set(tabs.map((tab) => tab.id));
  const filtered: Record<string, string> = {};
  for (const [id, address] of Object.entries(addresses)) {
    if (openTabIds.has(id)) filtered[id] = address;
  }
  return filtered;
}

function isResultPaneTab(value: unknown): value is ResultPaneTab {
  return value === 'primary'
    || value === 'browser'
    || value === 'image'
    || value === 'screen'
    || value === 'terminal'
    || value === 'files'
    || value === 'evidence';
}

function normalizeStoredRightPaneTabs(value: unknown, locale?: ResultLocale) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tabs: ResultPaneTabInstance[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isResultPaneTab(item.kind)) continue;
    const kind = canonicalResultPaneTab(item.kind);
    const rawId = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : baseResultPaneTabId(kind);
    const id = canonicalResultPaneTabId(rawId);
    if (seen.has(id)) continue;
    seen.add(id);
    tabs.push({
      id,
      kind,
      label: typeof item.label === 'string' && item.label.trim()
        ? legacyScreenLabel(item.label.trim(), locale)
        : resultPaneTabInstanceLabel(kind, nextResultPaneTabIndex(tabs, kind), locale),
      closable: true,
    });
  }
  return tabs;
}

function canonicalResultPaneTab(kind: ResultPaneTab): ResultPaneTab {
  return kind === 'screen' ? 'image' : kind;
}

function legacyScreenLabel(label: string, locale?: ResultLocale) {
  const legacy = /^(?:Screen|Virtual Screen|屏幕|虚拟屏幕)(?:\s+(\d+))?$/.exec(label);
  if (legacy) {
    return resultPaneTabInstanceLabel('image', Number(legacy[1] ?? 1), locale);
  }
  return label;
}

function canonicalResultPaneTabId(id: string) {
  return id.trim().replace(/^base:screen$/, 'base:image').replace(/^custom:screen:/, 'custom:image:');
}

function normalizeStoredBrowserTabAddresses(value: unknown) {
  if (!isRecord(value)) return {};
  const addresses: Record<string, string> = {};
  for (const [id, address] of Object.entries(value)) {
    if (typeof address === 'string') addresses[id] = address;
  }
  return addresses;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
