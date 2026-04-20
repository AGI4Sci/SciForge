import { type AgentId } from './data';
import { messagesByAgent } from './demoData';
import {
  type AlignmentContractRecord,
  makeId,
  nowIso,
  type BioAgentMessage,
  type BioAgentSession,
  type BioAgentWorkspaceState,
  type SessionVersionRecord,
} from './domain';

const STORAGE_KEY = 'bioagent.workspace.v2';
const LEGACY_STORAGE_KEY = 'bioagent.sessions.v1';
const agentIds: AgentId[] = ['literature', 'structure', 'omics', 'knowledge'];

function isAgentId(value: unknown): value is AgentId {
  return agentIds.includes(value as AgentId);
}

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

export function createSession(agentId: AgentId, title = '新聊天', options: { seed?: boolean } = {}): BioAgentSession {
  const now = nowIso();
  return {
    schemaVersion: 2,
    sessionId: makeId(`session-${agentId}`),
    agentId,
    title,
    createdAt: now,
    messages: options.seed ? seedMessages(agentId) : [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: now,
  };
}

function migrateSession(value: unknown, agentId: AgentId): BioAgentSession {
  if (isSessionV2(value, agentId)) return value;
  if (typeof value === 'object' && value !== null && (value as { agentId?: unknown }).agentId === agentId) {
    const raw = value as Partial<BioAgentSession> & { schemaVersion?: number };
    const now = nowIso();
    return {
      schemaVersion: 2,
      sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : makeId(`session-${agentId}`),
      agentId,
      title: typeof raw.title === 'string' ? raw.title : '迁移聊天',
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
      messages: Array.isArray(raw.messages) ? raw.messages : seedMessages(agentId),
      runs: Array.isArray(raw.runs) ? raw.runs : [],
      uiManifest: Array.isArray(raw.uiManifest) ? raw.uiManifest : [],
      claims: Array.isArray(raw.claims) ? raw.claims : [],
      executionUnits: Array.isArray(raw.executionUnits) ? raw.executionUnits : [],
      artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : [],
      notebook: Array.isArray(raw.notebook) ? raw.notebook : [],
      versions: Array.isArray(raw.versions) ? raw.versions : [],
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
    };
  }
  return createSession(agentId);
}

function isSessionV2(value: unknown, agentId: AgentId): value is BioAgentSession {
  return typeof value === 'object'
    && value !== null
    && (value as BioAgentSession).schemaVersion === 2
    && (value as BioAgentSession).agentId === agentId
    && Array.isArray((value as BioAgentSession).messages)
    && Array.isArray((value as BioAgentSession).versions);
}

export function createInitialWorkspaceState(): BioAgentWorkspaceState {
  const now = nowIso();
  return {
    schemaVersion: 2,
    workspacePath: '',
    sessionsByAgent: agentIds.reduce((acc, agentId) => {
      acc[agentId] = createSession(agentId, `${agentLabel(agentId)} 默认聊天`, { seed: true });
      return acc;
    }, {} as Record<AgentId, BioAgentSession>),
    archivedSessions: [],
    alignmentContracts: [],
    updatedAt: now,
  };
}

export function loadWorkspaceState(): BioAgentWorkspaceState {
  if (typeof window === 'undefined') return createInitialWorkspaceState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return parseWorkspaceState(JSON.parse(raw));
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as Partial<Record<AgentId, unknown>>;
      const migrated = createInitialWorkspaceState();
      migrated.sessionsByAgent = agentIds.reduce((acc, agentId) => {
        acc[agentId] = migrateSession(parsed[agentId], agentId);
        return acc;
      }, {} as Record<AgentId, BioAgentSession>);
      return migrated;
    }
  } catch {
    return createInitialWorkspaceState();
  }
  return createInitialWorkspaceState();
}

export function parseWorkspaceState(value: unknown): BioAgentWorkspaceState {
  const now = nowIso();
  if (typeof value !== 'object' || value === null) return createInitialWorkspaceState();
  const raw = value as Partial<BioAgentWorkspaceState>;
  return {
    schemaVersion: 2,
    workspacePath: typeof raw.workspacePath === 'string' ? raw.workspacePath : '',
    sessionsByAgent: agentIds.reduce((acc, agentId) => {
      acc[agentId] = migrateSession(raw.sessionsByAgent?.[agentId], agentId);
      return acc;
    }, {} as Record<AgentId, BioAgentSession>),
    archivedSessions: Array.isArray(raw.archivedSessions)
      ? raw.archivedSessions.flatMap((session) => {
        const agentId = typeof session === 'object' && session !== null ? (session as { agentId?: unknown }).agentId : undefined;
        return isAgentId(agentId) ? [migrateSession(session, agentId)] : [];
      })
      : [],
    alignmentContracts: Array.isArray(raw.alignmentContracts)
      ? raw.alignmentContracts.filter(isAlignmentContract)
      : [],
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  };
}

function isAlignmentContract(value: unknown): value is AlignmentContractRecord {
  return typeof value === 'object'
    && value !== null
    && (value as AlignmentContractRecord).type === 'alignment-contract'
    && (value as AlignmentContractRecord).schemaVersion === '1'
    && typeof (value as AlignmentContractRecord).id === 'string'
    && typeof (value as AlignmentContractRecord).title === 'string'
    && typeof (value as AlignmentContractRecord).checksum === 'string'
    && typeof (value as AlignmentContractRecord).data === 'object'
    && (value as AlignmentContractRecord).data !== null;
}

export function saveWorkspaceState(state: BioAgentWorkspaceState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetSession(agentId: AgentId): BioAgentSession {
  return createSession(agentId, `${agentLabel(agentId)} 新聊天`);
}

export function versionSession(session: BioAgentSession, reason: string): BioAgentSession {
  const snapshot = stripVersions({ ...session, updatedAt: nowIso() });
  const version: SessionVersionRecord = {
    id: makeId('version'),
    reason,
    createdAt: nowIso(),
    messageCount: session.messages.length,
    runCount: session.runs.length,
    artifactCount: session.artifacts.length,
    checksum: checksum(JSON.stringify(snapshot)),
    snapshot,
  };
  return {
    ...session,
    versions: [version, ...session.versions].slice(0, 40),
    updatedAt: nowIso(),
  };
}

function stripVersions(session: BioAgentSession): Omit<BioAgentSession, 'versions'> {
  const { versions: _versions, ...rest } = session;
  return rest;
}

function checksum(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function agentLabel(agentId: AgentId) {
  return {
    literature: '文献 Agent',
    structure: '结构 Agent',
    omics: '组学 Agent',
    knowledge: '知识库 Agent',
  }[agentId];
}
