import { useEffect, useRef, useState } from 'react';
import type { SciForgeConfig, ObjectReference } from '../../domain';
import type { ResultFocusMode, ResultPaneTab, ResultPaneTabInstance } from './ResultShell';
import { focusResultPaneRouteForObjectReference } from './resultPaneContract';
import type { ResultLocale } from './resultLocale';
import {
  addRightPaneTabLifecycleState,
  baseResultPaneTabId,
  closeRightPaneTabLifecycleState,
  createDefaultRightPaneTabs,
  ensureRightPaneTab,
  loadStoredRightPaneState,
  queueRightPaneFocus,
  rightPaneStateStorageKey,
  saveStoredRightPaneState,
  type RightPaneTabLifecycleTransition,
  type StoredRightPaneState,
} from './resultPaneLifecycle';

export interface UseRightPaneTabControllerOptions {
  config: SciForgeConfig;
  locale?: ResultLocale;
  initialFocusMode: ResultFocusMode;
  initialResultTab: ResultPaneTab;
  focusedObjectReference?: ObjectReference;
}

export interface CloseRightPaneTabOptions {
  canCloseTab?: (tabId: string, tab: ResultPaneTabInstance | undefined) => boolean;
  onClosingTab?: (tabId: string, tab: ResultPaneTabInstance | undefined) => void;
}

export interface RightPaneTabController {
  resultTabs: ResultPaneTabInstance[];
  activeResultTabId: string;
  activeResultTab?: ResultPaneTabInstance;
  resultTab: ResultPaneTab;
  focusMode: ResultFocusMode;
  browserTabAddresses: Record<string, string>;
  activeBrowserAddress?: string;
  hasOpenRightPaneTabs: boolean;
  activateResultTabKind: (tab: ResultPaneTab) => void;
  handleResultTabChange: (tabId: string) => void;
  handleNewResultTab: (tab: ResultPaneTab, onOpened?: (nextState: RightPaneTabLifecycleTransition) => void) => void;
  handleCloseResultTab: (tabId: string, options?: CloseRightPaneTabOptions) => void;
  handleFocusModeChange: (mode: ResultFocusMode) => void;
  setActiveBrowserAddress: (nextAddress: string) => void;
}

export function focusModeForRightPaneTab(tab: ResultPaneTab | undefined, current: ResultFocusMode): ResultFocusMode {
  if (tab === 'evidence') return 'evidence';
  if (tab === 'terminal') return 'execution';
  if (tab === 'image' || tab === 'screen') return 'visual';
  if (!tab || current === 'evidence' || current === 'execution') return 'all';
  return current;
}

export function useRightPaneTabController({
  config,
  locale,
  initialFocusMode,
  initialResultTab,
  focusedObjectReference,
}: UseRightPaneTabControllerOptions): RightPaneTabController {
  const rightPaneStorageKey = rightPaneStateStorageKey(config.workspacePath);
  const initialRightPaneState = useRef<StoredRightPaneState | undefined>(undefined);
  if (!initialRightPaneState.current) {
    initialRightPaneState.current = loadStoredRightPaneState(rightPaneStorageKey, locale, initialResultTab);
  }
  const initialFocusedObjectPane = focusedObjectReference
    ? focusResultPaneRouteForObjectReference(focusedObjectReference).pane
    : undefined;
  const [resultTabs, setResultTabs] = useState<ResultPaneTabInstance[]>(() => {
    const initialTabs = initialRightPaneState.current?.tabs ?? createDefaultRightPaneTabs(locale);
    return initialFocusedObjectPane ? ensureRightPaneTab(initialTabs, initialFocusedObjectPane, locale) : initialTabs;
  });
  const [activeResultTabId, setActiveResultTabId] = useState(
    initialFocusedObjectPane
      ? baseResultPaneTabId(initialFocusedObjectPane)
      : initialRightPaneState.current?.activeTabId ?? baseResultPaneTabId(initialResultTab),
  );
  const [browserTabAddresses, setBrowserTabAddresses] = useState<Record<string, string>>(
    () => initialRightPaneState.current?.browserTabAddresses ?? {},
  );
  const [focusMode, setFocusMode] = useState<ResultFocusMode>(initialFocusMode);
  const activeResultTab = resultTabs.find((tab) => tab.id === activeResultTabId);
  const resultTab = activeResultTab?.kind ?? 'primary';
  const hasOpenRightPaneTabs = resultTabs.length > 0 && Boolean(activeResultTab);
  const focusedObjectRoutePane = focusedObjectReference
    ? focusResultPaneRouteForObjectReference(focusedObjectReference).pane
    : undefined;

  useEffect(() => {
    saveStoredRightPaneState(rightPaneStorageKey, {
      tabs: resultTabs,
      activeTabId: activeResultTabId,
      browserTabAddresses,
    });
  }, [activeResultTabId, browserTabAddresses, resultTabs, rightPaneStorageKey]);

  function setFocusModeForTab(tab: ResultPaneTab | undefined) {
    setFocusMode((current) => focusModeForRightPaneTab(tab, current));
  }

  function activateResultTabKind(tab: ResultPaneTab) {
    const existingTabId = resultTabs.find((item) => item.kind === tab)?.id;
    if (!existingTabId) {
      const restoredTabId = baseResultPaneTabId(tab);
      setResultTabs((current) => ensureRightPaneTab(current, tab, locale));
      setActiveResultTabId(restoredTabId);
      queueRightPaneFocus({ kind: 'tab', tabId: restoredTabId });
      setFocusModeForTab(tab);
      return;
    }
    setActiveResultTabId(existingTabId);
    setFocusModeForTab(tab);
  }

  function handleResultTabChange(tabId: string) {
    const tab = resultTabs.find((item) => item.id === tabId);
    if (!tab) return;
    setActiveResultTabId(tab.id);
    setFocusModeForTab(tab.kind);
  }

  function handleNewResultTab(tab: ResultPaneTab, onOpened?: (nextState: RightPaneTabLifecycleTransition) => void) {
    setResultTabs((current) => {
      const nextState = addRightPaneTabLifecycleState({
        tabs: current,
        activeTabId: activeResultTabId,
        browserTabAddresses,
      }, tab, locale);
      setActiveResultTabId(nextState.activeTabId);
      queueRightPaneFocus(nextState.focusTarget);
      onOpened?.(nextState);
      return nextState.tabs;
    });
    setFocusModeForTab(tab);
  }

  function handleCloseResultTab(tabId: string, options: CloseRightPaneTabOptions = {}) {
    const tab = resultTabs.find((item) => item.id === tabId);
    if (options.canCloseTab && !options.canCloseTab(tabId, tab)) return;
    options.onClosingTab?.(tabId, tab);
    setResultTabs((current) => {
      const nextState = closeRightPaneTabLifecycleState({
        tabs: current,
        activeTabId: activeResultTabId,
        browserTabAddresses,
      }, tabId);
      setBrowserTabAddresses(nextState.browserTabAddresses);
      setActiveResultTabId(nextState.activeTabId);
      const nextActiveTab = nextState.tabs.find((item) => item.id === nextState.activeTabId);
      setFocusModeForTab(nextActiveTab?.kind);
      queueRightPaneFocus(nextState.focusTarget);
      return nextState.tabs;
    });
  }

  function handleFocusModeChange(mode: ResultFocusMode) {
    setFocusMode(mode);
    if (mode === 'evidence') activateResultTabKind('evidence');
    if (mode === 'execution') activateResultTabKind('terminal');
    if (mode === 'visual') activateResultTabKind('image');
  }

  function setActiveBrowserAddress(nextAddress: string) {
    setBrowserTabAddresses((current) => ({
      ...current,
      [activeResultTabId]: nextAddress,
    }));
  }

  useEffect(() => {
    if (!focusedObjectRoutePane || resultTab === focusedObjectRoutePane) return;
    activateResultTabKind(focusedObjectRoutePane);
  }, [focusedObjectRoutePane, resultTab]);

  return {
    resultTabs,
    activeResultTabId,
    activeResultTab,
    resultTab,
    focusMode,
    browserTabAddresses,
    activeBrowserAddress: browserTabAddresses[activeResultTabId],
    hasOpenRightPaneTabs,
    activateResultTabKind,
    handleResultTabChange,
    handleNewResultTab,
    handleCloseResultTab,
    handleFocusModeChange,
    setActiveBrowserAddress,
  };
}
