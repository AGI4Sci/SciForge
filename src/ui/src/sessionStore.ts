import { type ScenarioId } from './data';
import { scenarios } from './data';
import { messagesByScenario } from './demoData';
import {
  type AlignmentContractRecord,
  makeId,
  nowIso,
  type BioAgentMessage,
  type BioAgentSession,
  type BioAgentWorkspaceState,
  type ScenarioInstanceId,
  type SessionVersionRecord,
} from './domain';
import { isTimelineEventRecord } from './timelineSchema';

const STORAGE_KEY = 'bioagent.workspace.v2';
const scenarioIds: ScenarioId[] = scenarios.map((scenario) => scenario.id);

function isScenarioId(value: unknown): value is ScenarioId {
  return scenarioIds.includes(value as ScenarioId);
}

function seedMessages(scenarioId: ScenarioId): BioAgentMessage[] {
  return messagesByScenario[scenarioId].map((message) => ({
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

export function createSession(scenarioId: ScenarioInstanceId, title = '新聊天', options: { seed?: boolean } = {}): BioAgentSession {
  const now = nowIso();
  return {
    schemaVersion: 2,
    sessionId: makeId(`session-${scenarioId}`),
    scenarioId,
    title,
    createdAt: now,
    messages: options.seed && isScenarioId(scenarioId) ? seedMessages(scenarioId) : [],
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

function migrateSession(value: unknown, scenarioId: ScenarioInstanceId): BioAgentSession {
  if (isSessionV2(value, scenarioId)) return value;
  if (typeof value === 'object' && value !== null && (value as { scenarioId?: unknown }).scenarioId === scenarioId) {
    const raw = value as Partial<BioAgentSession> & { schemaVersion?: number };
    const now = nowIso();
    return {
      schemaVersion: 2,
      sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : makeId(`session-${scenarioId}`),
      scenarioId,
      title: typeof raw.title === 'string' ? raw.title : '迁移聊天',
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
      messages: Array.isArray(raw.messages) ? raw.messages : isScenarioId(scenarioId) ? seedMessages(scenarioId) : [],
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
  return createSession(scenarioId);
}

function isSessionV2(value: unknown, scenarioId: ScenarioInstanceId): value is BioAgentSession {
  return typeof value === 'object'
    && value !== null
    && (value as BioAgentSession).schemaVersion === 2
    && (value as BioAgentSession).scenarioId === scenarioId
    && Array.isArray((value as BioAgentSession).messages)
    && Array.isArray((value as BioAgentSession).versions);
}

export function createInitialWorkspaceState(): BioAgentWorkspaceState {
  const now = nowIso();
  return {
    schemaVersion: 2,
    workspacePath: '',
    sessionsByScenario: scenarioIds.reduce((acc, scenarioId) => {
      acc[scenarioId] = createSession(scenarioId, `${scenarioLabel(scenarioId)} 默认聊天`, { seed: true });
      return acc;
    }, {} as Record<ScenarioInstanceId, BioAgentSession>),
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
    sessionsByScenario: preserveWorkspaceSessions(raw.sessionsByScenario, scenarioIds.reduce((acc, scenarioId) => {
      acc[scenarioId] = migrateSession(raw.sessionsByScenario?.[scenarioId], scenarioId);
      return acc;
    }, {} as Record<ScenarioInstanceId, BioAgentSession>)),
    archivedSessions: Array.isArray(raw.archivedSessions)
      ? raw.archivedSessions.flatMap((session) => {
        const scenarioId = typeof session === 'object' && session !== null ? (session as { scenarioId?: unknown }).scenarioId : undefined;
        return typeof scenarioId === 'string' && scenarioId.trim() ? [migrateSession(session, scenarioId)] : [];
      })
      : [],
    alignmentContracts: Array.isArray(raw.alignmentContracts)
      ? raw.alignmentContracts.filter(isAlignmentContract)
      : [],
    timelineEvents: Array.isArray(raw.timelineEvents)
      ? raw.timelineEvents.filter(isTimelineEventRecord)
      : [],
    reusableTaskCandidates: Array.isArray(raw.reusableTaskCandidates)
      ? raw.reusableTaskCandidates.filter(isReusableTaskCandidate)
      : [],
    hiddenOfficialPackageIds: Array.isArray(raw.hiddenOfficialPackageIds)
      ? Array.from(new Set(raw.hiddenOfficialPackageIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)))
      : [],
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  };
}

function isReusableTaskCandidate(value: unknown) {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { id?: unknown; runId?: unknown; scenarioId?: unknown; prompt?: unknown; status?: unknown; promotionState?: unknown; createdAt?: unknown };
  return typeof record.id === 'string'
    && typeof record.runId === 'string'
    && typeof record.scenarioId === 'string'
    && typeof record.prompt === 'string'
    && typeof record.status === 'string'
    && ['candidate', 'promoted', 'rejected'].includes(String(record.promotionState))
    && typeof record.createdAt === 'string';
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

export function shouldUsePersistedWorkspaceState(
  current: BioAgentWorkspaceState,
  persisted: BioAgentWorkspaceState,
  options: { explicitWorkspacePath?: boolean } = {},
) {
  if (options.explicitWorkspacePath && persisted.workspacePath.trim()) return true;
  const currentActivity = workspaceActivityScore(current);
  const persistedActivity = workspaceActivityScore(persisted);
  if (persistedActivity === 0) return false;
  if (currentActivity === 0) return true;
  if (persistedActivity > currentActivity) return true;
  if (persistedActivity < currentActivity) return false;
  const currentTime = Date.parse(current.updatedAt || '');
  const persistedTime = Date.parse(persisted.updatedAt || '');
  return Number.isFinite(persistedTime) && (!Number.isFinite(currentTime) || persistedTime >= currentTime);
}

export function resetSession(scenarioId: ScenarioInstanceId): BioAgentSession {
  return createSession(scenarioId, `${scenarioLabel(scenarioId)} 新聊天`);
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

function preserveWorkspaceSessions(
  rawSessions: BioAgentWorkspaceState['sessionsByScenario'] | undefined,
  base: Record<ScenarioInstanceId, BioAgentSession>,
) {
  if (!rawSessions || typeof rawSessions !== 'object') return base;
  for (const [scenarioId, session] of Object.entries(rawSessions)) {
    if (!scenarioId || isScenarioId(scenarioId)) continue;
    base[scenarioId] = migrateSession(session, scenarioId);
  }
  return base;
}

function scenarioLabel(scenarioId: ScenarioInstanceId) {
  return scenarios.find((scenario) => scenario.id === scenarioId)?.name ?? scenarioId;
}

function workspaceActivityScore(state: BioAgentWorkspaceState) {
  return Object.values(state.sessionsByScenario).reduce((total, session) => {
    return total + sessionActivityScore(session);
  }, state.archivedSessions.length + (state.alignmentContracts?.length ?? 0) + (state.timelineEvents?.length ?? 0));
}

export function sessionActivityScore(session: BioAgentSession) {
  const userMessages = session.messages.filter((message) => !message.id.startsWith('seed')).length;
  return userMessages
    + session.runs.length
    + session.artifacts.length
    + session.executionUnits.length
    + session.notebook.length;
}
