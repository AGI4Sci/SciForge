import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceTerminalSession } from '../../api/workspaceClient';
import type { SciForgeConfig } from '../../domain';
import {
  RIGHT_PANE_TERMINAL_OWNER_CLEANUP_STOP_REASON,
  RIGHT_PANE_TERMINAL_TAB_CLOSE_STOP_REASON,
  rightPaneTerminalOwnerKey,
  stopRightPaneTerminalSessionOnce,
  stopRightPaneTerminalSessionsOnce,
  type RightPaneTerminalSessionsByTabId,
} from './terminalPaneLifecycle';

export interface UseRightPaneTerminalControllerOptions {
  config: SciForgeConfig;
  sessionId: string | undefined;
  activeResultTabId: string;
}

export interface RightPaneTerminalController {
  activeTerminalSession?: WorkspaceTerminalSession;
  terminalSessionsByTabId: RightPaneTerminalSessionsByTabId;
  setActiveTerminalSession: (nextSession: WorkspaceTerminalSession | undefined) => void;
  closeTerminalTab: (tabId: string) => void;
}

export function setRightPaneTerminalSessionForTab(
  current: RightPaneTerminalSessionsByTabId,
  tabId: string,
  nextSession: WorkspaceTerminalSession | undefined,
): RightPaneTerminalSessionsByTabId {
  if (!tabId) return current;
  return {
    ...current,
    [tabId]: nextSession,
  };
}

export function removeRightPaneTerminalSessionForTab(
  current: RightPaneTerminalSessionsByTabId,
  tabId: string,
): RightPaneTerminalSessionsByTabId {
  if (!tabId || !(tabId in current)) return current;
  const next = { ...current };
  delete next[tabId];
  return next;
}

export function useRightPaneTerminalController({
  config,
  sessionId,
  activeResultTabId,
}: UseRightPaneTerminalControllerOptions): RightPaneTerminalController {
  const [terminalSessionsByTabId, setTerminalSessionsByTabId] = useState<RightPaneTerminalSessionsByTabId>({});
  const terminalSessionsByTabIdRef = useRef<RightPaneTerminalSessionsByTabId>({});
  const stoppingTerminalSessionIdsRef = useRef(new Set<string>());
  const terminalOwnerKey = useMemo(
    () => rightPaneTerminalOwnerKey(config, sessionId),
    [config.workspacePath, config.workspaceWriterBaseUrl, sessionId],
  );

  useEffect(() => {
    terminalSessionsByTabIdRef.current = terminalSessionsByTabId;
  }, [terminalSessionsByTabId]);

  useEffect(() => {
    return () => {
      stopRightPaneTerminalSessionsOnce({
        config,
        sessionsByTabId: terminalSessionsByTabIdRef.current,
        reason: RIGHT_PANE_TERMINAL_OWNER_CLEANUP_STOP_REASON,
        stoppingSessionIds: stoppingTerminalSessionIdsRef.current,
      });
    };
  }, [terminalOwnerKey]);

  useEffect(() => {
    setTerminalSessionsByTabId({});
  }, [terminalOwnerKey]);

  function setActiveTerminalSession(nextSession: WorkspaceTerminalSession | undefined) {
    setTerminalSessionsByTabId((current) => (
      setRightPaneTerminalSessionForTab(current, activeResultTabId, nextSession)
    ));
  }

  function closeTerminalTab(tabId: string) {
    stopRightPaneTerminalSessionOnce({
      config,
      session: terminalSessionsByTabId[tabId],
      reason: RIGHT_PANE_TERMINAL_TAB_CLOSE_STOP_REASON,
      stoppingSessionIds: stoppingTerminalSessionIdsRef.current,
    });
    setTerminalSessionsByTabId((current) => removeRightPaneTerminalSessionForTab(current, tabId));
  }

  return {
    activeTerminalSession: terminalSessionsByTabId[activeResultTabId],
    terminalSessionsByTabId,
    setActiveTerminalSession,
    closeTerminalTab,
  };
}
