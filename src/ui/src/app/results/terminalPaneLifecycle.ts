import {
  stopWorkspaceTerminalSession,
  type WorkspaceTerminalSession,
} from '../../api/workspaceClient';
import type { SciForgeConfig } from '../../domain';

export const RIGHT_PANE_TERMINAL_TAB_CLOSE_STOP_REASON = 'right-pane-terminal-tab-close';
export const RIGHT_PANE_TERMINAL_OWNER_CLEANUP_STOP_REASON = 'right-pane-terminal-owner-cleanup';

export type RightPaneTerminalSessionsByTabId = Record<string, WorkspaceTerminalSession | undefined>;

export function rightPaneTerminalSessionIsActive(
  session: WorkspaceTerminalSession | undefined,
): session is WorkspaceTerminalSession {
  return session?.status === 'starting' || session?.status === 'running';
}

export function rightPaneTerminalOwnerKey(config: SciForgeConfig, sessionId: string | undefined) {
  return [
    config.workspaceWriterBaseUrl.trim().replace(/\/+$/, ''),
    config.workspacePath,
    sessionId || '',
  ].join('\u0000');
}

export function stopRightPaneTerminalSessionOnce({
  config,
  session,
  reason,
  stoppingSessionIds,
  stopSession = stopWorkspaceTerminalSession,
  onStopped,
}: {
  config: SciForgeConfig;
  session: WorkspaceTerminalSession | undefined;
  reason: string;
  stoppingSessionIds: Set<string>;
  stopSession?: typeof stopWorkspaceTerminalSession;
  onStopped?: (session: WorkspaceTerminalSession) => void;
}) {
  if (!rightPaneTerminalSessionIsActive(session)) return false;
  if (stoppingSessionIds.has(session.id)) return false;
  stoppingSessionIds.add(session.id);
  const stopConfig = session.workspaceWriterBaseUrl
    ? { ...config, workspaceWriterBaseUrl: session.workspaceWriterBaseUrl }
    : config;
  void stopSession(stopConfig, session.id, {
    workspacePath: session.workspacePath || config.workspacePath,
    reason,
  }).then((nextSession) => {
    onStopped?.(nextSession);
  }).catch(() => undefined).finally(() => {
    stoppingSessionIds.delete(session.id);
  });
  return true;
}

export function stopRightPaneTerminalSessionsOnce({
  config,
  sessionsByTabId,
  reason,
  stoppingSessionIds,
  stopSession = stopWorkspaceTerminalSession,
}: {
  config: SciForgeConfig;
  sessionsByTabId: RightPaneTerminalSessionsByTabId;
  reason: string;
  stoppingSessionIds: Set<string>;
  stopSession?: typeof stopWorkspaceTerminalSession;
}) {
  let count = 0;
  const seen = new Set<string>();
  for (const session of Object.values(sessionsByTabId)) {
    if (!session || seen.has(session.id)) continue;
    seen.add(session.id);
    if (stopRightPaneTerminalSessionOnce({
      config,
      session,
      reason,
      stoppingSessionIds,
      stopSession,
    })) {
      count += 1;
    }
  }
  return count;
}
