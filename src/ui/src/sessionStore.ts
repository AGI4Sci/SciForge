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
import { normalizeWorkspaceRootPath } from './config';

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
    feedbackComments: [],
    feedbackRequests: [],
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
    workspacePath: typeof raw.workspacePath === 'string' ? normalizeWorkspaceRootPath(raw.workspacePath) : '',
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
    feedbackComments: Array.isArray(raw.feedbackComments)
      ? raw.feedbackComments.filter(isFeedbackComment)
      : [],
    feedbackRequests: Array.isArray(raw.feedbackRequests)
      ? raw.feedbackRequests.filter(isFeedbackRequest)
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

function isFeedbackComment(value: unknown) {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1
    && typeof record.id === 'string'
    && typeof record.authorId === 'string'
    && typeof record.authorName === 'string'
    && typeof record.comment === 'string'
    && typeof record.status === 'string'
    && typeof record.priority === 'string'
    && Array.isArray(record.tags)
    && typeof record.createdAt === 'string'
    && typeof record.updatedAt === 'string'
    && typeof record.target === 'object'
    && record.target !== null
    && typeof record.viewport === 'object'
    && record.viewport !== null
    && typeof record.runtime === 'object'
    && record.runtime !== null;
}

function isFeedbackRequest(value: unknown) {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1
    && typeof record.id === 'string'
    && typeof record.title === 'string'
    && typeof record.status === 'string'
    && Array.isArray(record.feedbackIds)
    && typeof record.summary === 'string'
    && Array.isArray(record.acceptanceCriteria)
    && typeof record.createdAt === 'string'
    && typeof record.updatedAt === 'string';
}

export function saveWorkspaceState(state: BioAgentWorkspaceState) {
  if (typeof window === 'undefined') return;
  const compact = compactWorkspaceStateForStorage(state);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
    return;
  } catch {
    // Very long repair-loop sessions can fail either at stringify time or at localStorage write time.
    // Compact and retry so persistence never unmounts the workbench.
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
  } catch {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(compactWorkspaceStateForStorage(compact, 'minimal')));
    } catch {
      // Persistence must not take down the workbench. The workspace writer remains the durable audit path.
    }
  }
}

export function compactWorkspaceStateForStorage(
  state: BioAgentWorkspaceState,
  mode: 'normal' | 'minimal' = 'normal',
): BioAgentWorkspaceState {
  const limits = mode === 'minimal'
    ? { messages: 4, runs: 3, records: 3, versions: 1, archived: 2, timeline: 10, reusable: 5 }
    : { messages: 16, runs: 8, records: 8, versions: 3, archived: 6, timeline: 40, reusable: 20 };
  return {
    ...state,
    sessionsByScenario: Object.fromEntries(Object.entries(state.sessionsByScenario).map(([id, session]) => [
      id,
      compactSessionForStorage(session, limits),
    ])) as Record<ScenarioInstanceId, BioAgentSession>,
    archivedSessions: (state.archivedSessions ?? []).slice(0, limits.archived).map((session) => compactSessionForStorage(session, limits)),
    feedbackComments: state.feedbackComments?.slice(0, mode === 'minimal' ? 20 : 120),
    feedbackRequests: state.feedbackRequests?.slice(0, mode === 'minimal' ? 8 : 40),
    timelineEvents: state.timelineEvents?.slice(0, limits.timeline),
    reusableTaskCandidates: state.reusableTaskCandidates?.slice(0, limits.reusable),
  };
}

function compactSessionForStorage(
  session: BioAgentSession,
  limits: { messages: number; runs: number; records: number; versions: number },
): BioAgentSession {
  return {
    ...session,
    messages: session.messages.slice(-limits.messages).map((message) => ({
      ...message,
      content: message.content.length > 2400 ? `${message.content.slice(0, 2400)}...` : message.content,
    })),
    runs: session.runs.slice(-limits.runs).map((run) => ({
      ...run,
      prompt: run.prompt.length > 1200 ? `${run.prompt.slice(0, 1200)}...` : run.prompt,
      response: run.response.length > 2400 ? `${run.response.slice(0, 2400)}...` : run.response,
      raw: compactArtifactData(run.raw),
    })),
    uiManifest: session.uiManifest.slice(0, limits.records),
    claims: session.claims.slice(0, limits.records),
    executionUnits: session.executionUnits.slice(0, limits.records),
    artifacts: session.artifacts.slice(0, limits.records).map((artifact) => ({
      ...artifact,
      data: compactArtifactData(artifact.data),
    })),
    notebook: session.notebook.slice(0, limits.records),
    versions: session.versions.slice(0, limits.versions).map((version) => ({
      ...version,
      snapshot: compactSessionSnapshotForStorage(version.snapshot, limits),
    })),
  };
}

function compactArtifactData(data: unknown) {
  if (typeof data === 'string') {
    if (isLargeBinaryString(data)) return compactBinaryMarker(data);
    return data.length > 4000 ? `${data.slice(0, 4000)}...` : data;
  }
  if (Array.isArray(data)) return data.slice(0, 20);
  if (typeof data !== 'object' || data === null) return data;
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data).slice(0, 24)) {
    if (typeof value === 'string') {
      compact[key] = isLargeBinaryField(key, value)
        ? compactBinaryMarker(value)
        : value.length > 4000 ? `${value.slice(0, 4000)}...` : value;
    }
    else if (Array.isArray(value)) compact[key] = value.slice(0, 20);
    else compact[key] = value;
  }
  return compact;
}

function compactSessionSnapshotForStorage(
  session: Omit<BioAgentSession, 'versions'>,
  limits: { messages: number; runs: number; records: number; versions: number },
): Omit<BioAgentSession, 'versions'> {
  return {
    ...session,
    messages: session.messages.slice(-limits.messages).map((message) => ({
      ...message,
      content: message.content.length > 2400 ? `${message.content.slice(0, 2400)}...` : message.content,
    })),
    runs: session.runs.slice(-limits.runs).map((run) => ({
      ...run,
      prompt: run.prompt.length > 1200 ? `${run.prompt.slice(0, 1200)}...` : run.prompt,
      response: run.response.length > 2400 ? `${run.response.slice(0, 2400)}...` : run.response,
      raw: compactArtifactData(run.raw),
    })),
    uiManifest: session.uiManifest.slice(0, limits.records),
    claims: session.claims.slice(0, limits.records),
    executionUnits: session.executionUnits.slice(0, limits.records),
    artifacts: session.artifacts.slice(0, limits.records).map((artifact) => ({
      ...artifact,
      data: compactArtifactData(artifact.data),
    })),
    notebook: session.notebook.slice(0, limits.records),
  };
}

function isLargeBinaryField(key: string, value: string) {
  return isLargeBinaryString(value) || /^(?:dataUrl|base64|binary|blob|content)$/i.test(key) && value.length > 1024;
}

function isLargeBinaryString(value: string) {
  if (/^data:(?:image|application\/pdf|application\/octet-stream)[^,]*;base64,/i.test(value)) return true;
  if (value.length < 4096) return false;
  const compact = value.replace(/\s+/g, '');
  return compact.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(compact);
}

function compactBinaryMarker(value: string) {
  return {
    omitted: true,
    reason: 'binary-or-data-url',
    chars: value.length,
    head: value.slice(0, 80),
  };
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
  const snapshot = compactSessionSnapshotForStorage(stripVersions({ ...session, updatedAt: nowIso() }), {
    messages: 16,
    runs: 8,
    records: 8,
    versions: 3,
  });
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
