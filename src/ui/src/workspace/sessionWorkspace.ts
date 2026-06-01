import { makeId, nowIso, type SciForgeMessage, type SciForgeSession, type SciForgeWorkspaceState, type ScenarioInstanceId } from '../domain';
import { createSession, sessionActivityScore, versionSession, withSessionWriteGuard } from '../sessionStore';

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
  const currentSession = state.sessionsByScenario[scenarioId];
  const archivedSessions = currentSession && sessionActivityScore(currentSession) > 0
    ? prependSession(
      state.archivedSessions,
      retainedSessionCopy(currentSession, 'new chat retained previous session'),
      archiveLimit,
    )
    : state.archivedSessions;
  return {
    ...state,
    archivedSessions,
    sessionsByScenario: {
      ...state.sessionsByScenario,
      [scenarioId]: createSession(scenarioId, newSessionTitle),
    },
  };
}

export function deleteActiveChat(
  state: SciForgeWorkspaceState,
  scenarioId: ScenarioInstanceId,
  _fallbackTitle: string,
  archiveLimit = DEFAULT_ARCHIVE_LIMIT,
  sessionId?: string,
): SciForgeWorkspaceState {
  const active = state.sessionsByScenario[scenarioId];
  if (active && (!sessionId || active.sessionId === sessionId)) {
    const nextSessions = { ...state.sessionsByScenario };
    delete nextSessions[scenarioId];
    if (sessionActivityScore(active) === 0) {
      return {
        ...state,
        sessionsByScenario: nextSessions,
      };
    }
    const deleted = archiveSessionCopy(active, 'deleted current chat', 'discarded');
    return {
      ...state,
      archivedSessions: prependSession(state.archivedSessions, { ...deleted, title: `${deleted.title}（已删除）` }, archiveLimit),
      sessionsByScenario: nextSessions,
    };
  }

  if (!sessionId) return state;
  return updateRetainedSession(state, scenarioId, sessionId, (session) => {
    const deleted = archiveSessionCopy(session, 'deleted retained chat', 'discarded');
    return { ...deleted, title: `${deleted.title}（已删除）` };
  }, archiveLimit);
}

export function archiveActiveSession(
  state: SciForgeWorkspaceState,
  scenarioId: ScenarioInstanceId,
  sessionId: string,
  fallbackTitle: string,
  archiveLimit = DEFAULT_ARCHIVE_LIMIT,
): SciForgeWorkspaceState {
  const active = state.sessionsByScenario[scenarioId];
  if (active?.sessionId === sessionId) {
    if (sessionActivityScore(active) === 0) return state;
    return {
      ...state,
      archivedSessions: prependSession(
        state.archivedSessions,
        archiveSessionCopy(active, 'archived from sidebar', 'archived'),
        archiveLimit,
      ),
      sessionsByScenario: {
        ...state.sessionsByScenario,
        [scenarioId]: createSession(scenarioId, fallbackTitle),
      },
    };
  }

  return updateRetainedSession(
    state,
    scenarioId,
    sessionId,
    (session) => archiveSessionCopy(session, 'archived retained chat from sidebar', 'archived'),
    archiveLimit,
  );
}

export function forkActiveSession(
  state: SciForgeWorkspaceState,
  scenarioId: ScenarioInstanceId,
  archiveLimit = DEFAULT_ARCHIVE_LIMIT,
): SciForgeWorkspaceState {
  const active = state.sessionsByScenario[scenarioId];
  if (!active || sessionActivityScore(active) === 0) return state;
  const forkedAt = nowIso();
  const { archiveState: _archiveState, versions: _versions, ...activeSnapshot } = active;
  const forkedSession = withSessionWriteGuard({
    ...activeSnapshot,
    sessionId: makeId(`session-${scenarioId}`),
    title: forkTitle(active.title),
    createdAt: forkedAt,
    updatedAt: forkedAt,
    versions: [],
  });
  return {
    ...state,
    archivedSessions: prependSession(
      state.archivedSessions,
      retainedSessionCopy(active, 'forked chat retained source session'),
      archiveLimit,
    ),
    sessionsByScenario: {
      ...state.sessionsByScenario,
      [scenarioId]: forkedSession,
    },
  };
}

function forkTitle(title: string) {
  const compact = title.trim() || 'Chat';
  return /\bFork\b/i.test(compact) ? compact : `${compact} Fork`;
}

export function archiveAllActiveSessions(
  state: SciForgeWorkspaceState,
  fallbackTitleFor: (scenarioId: ScenarioInstanceId) => string,
  archiveLimit = DEFAULT_ARCHIVE_LIMIT,
): SciForgeWorkspaceState {
  let changed = false;
  const retainedOrArchived = state.archivedSessions.map((session) => {
    if (!isRetainedHistorySession(session)) return session;
    changed = true;
    return archiveSessionCopy(session, 'archived all retained chats', 'archived');
  });
  const archivedActive: SciForgeSession[] = [];
  const nextSessions = { ...state.sessionsByScenario };
  for (const [scenarioId, session] of Object.entries(state.sessionsByScenario) as Array<[ScenarioInstanceId, SciForgeSession | undefined]>) {
    if (!session || sessionActivityScore(session) === 0) continue;
    changed = true;
    archivedActive.push(archiveSessionCopy(session, 'archived all chats', 'archived'));
    nextSessions[scenarioId] = createSession(scenarioId, fallbackTitleFor(scenarioId));
  }
  if (!changed) return state;
  return {
    ...state,
    archivedSessions: dedupeSessions([...archivedActive, ...retainedOrArchived]).slice(0, archiveLimit),
    sessionsByScenario: nextSessions,
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
  const retainedActive = active.sessionId !== sessionId && sessionActivityScore(active) > 0
    ? prependSession(nextArchived, retainedSessionCopy(active, `retained active chat before opening ${sessionId}`), archiveLimit)
    : nextArchived;
  return {
    ...state,
    archivedSessions: retainedActive.slice(0, archiveLimit),
    sessionsByScenario: {
      ...state.sessionsByScenario,
      [scenarioId]: restoredSessionCopy(restored, restoredAt),
    },
  };
}

function archiveSessionCopy(
  session: SciForgeSession,
  reason: string,
  archiveState: NonNullable<SciForgeSession['archiveState']>,
): SciForgeSession {
  return {
    ...versionSession(session, reason),
    archiveState,
  };
}

function retainedSessionCopy(session: SciForgeSession, reason: string): SciForgeSession {
  const next = versionSession(session, reason);
  delete next.archiveState;
  return next;
}

function restoredSessionCopy(session: SciForgeSession, updatedAt: string): SciForgeSession {
  const next: SciForgeSession = { ...session, updatedAt };
  delete next.archiveState;
  return next;
}

function updateRetainedSession(
  state: SciForgeWorkspaceState,
  scenarioId: ScenarioInstanceId,
  sessionId: string,
  update: (session: SciForgeSession) => SciForgeSession,
  archiveLimit: number,
): SciForgeWorkspaceState {
  const nextArchived = state.archivedSessions.map((session) => {
    if (session.scenarioId !== scenarioId || session.sessionId !== sessionId || !isRetainedHistorySession(session)) return session;
    return update(session);
  });
  if (nextArchived === state.archivedSessions || nextArchived.every((session, index) => session === state.archivedSessions[index])) return state;
  return {
    ...state,
    archivedSessions: dedupeSessions(nextArchived).slice(0, archiveLimit),
  };
}

function prependSession(sessions: SciForgeSession[], session: SciForgeSession, limit: number): SciForgeSession[] {
  return dedupeSessions([session, ...sessions]).slice(0, limit);
}

function dedupeSessions(sessions: SciForgeSession[]): SciForgeSession[] {
  const seen = new Set<string>();
  return sessions.filter((session) => {
    if (seen.has(session.sessionId)) return false;
    seen.add(session.sessionId);
    return true;
  });
}

export function isRetainedHistorySession(session: SciForgeSession): boolean {
  if (!session.archiveState) return true;
  const latestReason = session.versions[0]?.reason ?? '';
  return session.archiveState === 'archived' && /new chat (?:archived|retained) previous session/i.test(latestReason);
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
    archivedSessions: state.archivedSessions.filter((session) => session.scenarioId !== scenarioId || isRetainedHistorySession(session)),
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
