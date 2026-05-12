import type { SciForgeMessage, SciForgeSession, SciForgeWorkspaceState, ScenarioInstanceId } from '../domain';
import { createSession, resetSession, sessionActivityScore, versionSession } from '../sessionStore';

const DEFAULT_ARCHIVE_LIMIT = 80;

export function activeSessionFor(
  state: SciForgeWorkspaceState,
  scenarioId: ScenarioInstanceId,
  fallbackTitle = '新聊天',
): SciForgeSession {
  return state.sessionsByScenario[scenarioId] ?? createSession(scenarioId, fallbackTitle);
}

export function startNewChat(
  state: SciForgeWorkspaceState,
  scenarioId: ScenarioInstanceId,
  newSessionTitle: string,
  archiveLimit = DEFAULT_ARCHIVE_LIMIT,
): SciForgeWorkspaceState {
  const currentSession = activeSessionFor(state, scenarioId, newSessionTitle);
  const archivedSessions = sessionActivityScore(currentSession) > 0
    ? [versionSession(currentSession, 'new chat archived previous session'), ...state.archivedSessions]
    : state.archivedSessions;
  return {
    ...state,
    archivedSessions: archivedSessions.slice(0, archiveLimit),
    sessionsByScenario: {
      ...state.sessionsByScenario,
      [scenarioId]: createSession(scenarioId, newSessionTitle),
    },
  };
}

export function deleteActiveChat(
  state: SciForgeWorkspaceState,
  scenarioId: ScenarioInstanceId,
  fallbackTitle: string,
  archiveLimit = DEFAULT_ARCHIVE_LIMIT,
): SciForgeWorkspaceState {
  const deleted = versionSession(activeSessionFor(state, scenarioId, fallbackTitle), 'deleted current chat');
  return {
    ...state,
    archivedSessions: [{ ...deleted, title: `${deleted.title}（已删除）` }, ...state.archivedSessions].slice(0, archiveLimit),
    sessionsByScenario: {
      ...state.sessionsByScenario,
      [scenarioId]: resetSession(scenarioId),
    },
  };
}

export function restoreArchivedSession(
  state: SciForgeWorkspaceState,
  scenarioId: ScenarioInstanceId,
  sessionId: string,
  restoredAt: string,
  fallbackTitle: string,
  archiveLimit = DEFAULT_ARCHIVE_LIMIT,
): SciForgeWorkspaceState {
  const restored = state.archivedSessions.find((session) => session.scenarioId === scenarioId && session.sessionId === sessionId);
  if (!restored) return state;
  const active = activeSessionFor(state, scenarioId, fallbackTitle);
  const nextArchived = state.archivedSessions.filter((session) => session.sessionId !== sessionId);
  const archivedActive = sessionActivityScore(active) > 0
    ? [versionSession(active, `restored archived session ${sessionId}`), ...nextArchived]
    : nextArchived;
  return {
    ...state,
    archivedSessions: archivedActive.slice(0, archiveLimit),
    sessionsByScenario: {
      ...state.sessionsByScenario,
      [scenarioId]: {
        ...restored,
        updatedAt: restoredAt,
      },
    },
  };
}

export function deleteArchivedSessions(
  state: SciForgeWorkspaceState,
  scenarioId: ScenarioInstanceId,
  sessionIds: string[],
): SciForgeWorkspaceState {
  if (!sessionIds.length) return state;
  const selected = new Set(sessionIds);
  return {
    ...state,
    archivedSessions: state.archivedSessions.filter((session) => session.scenarioId !== scenarioId || !selected.has(session.sessionId)),
  };
}

export function clearArchivedSessions(
  state: SciForgeWorkspaceState,
  scenarioId: ScenarioInstanceId,
): SciForgeWorkspaceState {
  return {
    ...state,
    archivedSessions: state.archivedSessions.filter((session) => session.scenarioId !== scenarioId),
  };
}

export function editSessionMessage(
  state: SciForgeWorkspaceState,
  scenarioId: ScenarioInstanceId,
  messageId: string,
  content: string,
  updatedAt: string,
): SciForgeSession {
  const session = activeSessionFor(state, scenarioId);
  return {
    ...session,
    messages: session.messages.map((message) => message.id === messageId ? updateMessageContent(message, content, updatedAt) : message),
    updatedAt,
  };
}

export function deleteSessionMessage(
  state: SciForgeWorkspaceState,
  scenarioId: ScenarioInstanceId,
  messageId: string,
  updatedAt: string,
): SciForgeSession {
  const session = activeSessionFor(state, scenarioId);
  return {
    ...session,
    messages: session.messages.filter((message) => message.id !== messageId),
    updatedAt,
  };
}

function updateMessageContent(message: SciForgeMessage, content: string, updatedAt: string): SciForgeMessage {
  return {
    ...message,
    content,
    updatedAt,
  };
}
