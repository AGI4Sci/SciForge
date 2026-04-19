import { messagesByAgent, type AgentId } from './data';
import { makeId, nowIso, type BioAgentMessage, type BioAgentSession } from './domain';

const STORAGE_KEY = 'bioagent.sessions.v1';
const agentIds: AgentId[] = ['literature', 'structure', 'omics', 'knowledge'];

function seedMessages(agentId: AgentId): BioAgentMessage[] {
  return messagesByAgent[agentId].map((message) => ({
    id: makeId('seed'),
    role: message.role,
    content: message.content,
    confidence: message.confidence,
    evidence: message.evidence,
    claimType: message.claimType,
    expandable: message.expandable,
    createdAt: nowIso(),
    status: 'completed',
  }));
}

function createSession(agentId: AgentId): BioAgentSession {
  return {
    schemaVersion: 1,
    sessionId: makeId(`session-${agentId}`),
    agentId,
    messages: seedMessages(agentId),
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    updatedAt: nowIso(),
  };
}

function isSession(value: unknown, agentId: AgentId): value is BioAgentSession {
  return typeof value === 'object'
    && value !== null
    && (value as BioAgentSession).schemaVersion === 1
    && (value as BioAgentSession).agentId === agentId
    && Array.isArray((value as BioAgentSession).messages);
}

export function createInitialSessions(): Record<AgentId, BioAgentSession> {
  return agentIds.reduce((acc, agentId) => {
    acc[agentId] = createSession(agentId);
    return acc;
  }, {} as Record<AgentId, BioAgentSession>);
}

export function loadSessions(): Record<AgentId, BioAgentSession> {
  if (typeof window === 'undefined') return createInitialSessions();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialSessions();
    const parsed = JSON.parse(raw) as Partial<Record<AgentId, BioAgentSession>>;
    return agentIds.reduce((acc, agentId) => {
      acc[agentId] = isSession(parsed[agentId], agentId) ? parsed[agentId] : createSession(agentId);
      return acc;
    }, {} as Record<AgentId, BioAgentSession>);
  } catch {
    return createInitialSessions();
  }
}

export function saveSessions(sessions: Record<AgentId, BioAgentSession>) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function resetSession(agentId: AgentId): BioAgentSession {
  return createSession(agentId);
}
