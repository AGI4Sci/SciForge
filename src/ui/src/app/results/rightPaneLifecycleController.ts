import { useCallback } from 'react';
import type { ResultPaneTabInstance } from './ResultShell';
import type { CloseRightPaneTabOptions } from './rightPaneTabController';

export interface RightPaneLifecyclePorts {
  closeRightPaneTab: (tabId: string, options?: CloseRightPaneTabOptions) => void;
  canCloseWorkspaceFileTab: (tabId: string, tab: ResultPaneTabInstance | undefined) => boolean;
  closeTerminalTab: (tabId: string) => void;
  cleanupClosedWorkspaceFileTab: (tabId: string) => void;
}

export interface RightPaneLifecycleController {
  closeResultTab: (tabId: string) => void;
}

export function rightPaneCloseResultTabOptions({
  canCloseWorkspaceFileTab,
  closeTerminalTab,
  cleanupClosedWorkspaceFileTab,
}: Pick<RightPaneLifecyclePorts, 'canCloseWorkspaceFileTab' | 'closeTerminalTab' | 'cleanupClosedWorkspaceFileTab'>): CloseRightPaneTabOptions {
  return {
    canCloseTab: (tabId, tab) => Boolean(tab) && canCloseWorkspaceFileTab(tabId, tab),
    onClosingTab: (tabId) => {
      closeTerminalTab(tabId);
      cleanupClosedWorkspaceFileTab(tabId);
    },
  };
}

export function closeRightPaneResultTab(tabId: string, ports: RightPaneLifecyclePorts) {
  ports.closeRightPaneTab(tabId, rightPaneCloseResultTabOptions(ports));
}

export function useRightPaneLifecycleController({
  closeRightPaneTab,
  canCloseWorkspaceFileTab,
  closeTerminalTab,
  cleanupClosedWorkspaceFileTab,
}: RightPaneLifecyclePorts): RightPaneLifecycleController {
  const closeResultTab = useCallback((tabId: string) => {
    closeRightPaneResultTab(tabId, {
      closeRightPaneTab,
      canCloseWorkspaceFileTab,
      closeTerminalTab,
      cleanupClosedWorkspaceFileTab,
    });
  }, [canCloseWorkspaceFileTab, cleanupClosedWorkspaceFileTab, closeRightPaneTab, closeTerminalTab]);

  return { closeResultTab };
}
