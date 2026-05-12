import { type ScenarioId } from './data';
import { scenarios } from './data';
import { messagesByScenario } from './demoData';
import {
  ALIGNMENT_CONTRACT_ARTIFACT_TYPE,
  ALIGNMENT_CONTRACT_SCHEMA_VERSION,
  type AlignmentContractRecord,
  makeId,
  nowIso,
  type GithubSyncedOpenIssueRecord,
  type SciForgeMessage,
  type SciForgeSession,
  type SciForgeWorkspaceState,
  type ScenarioInstanceId,
  type SessionVersionRecord,
} from './domain';
import { isTimelineEventRecord } from './timelineSchema';
import { normalizeWorkspaceRootPath } from './config';

const STORAGE_KEY = 'sciforge.workspace.v2';
const scenarioIds: ScenarioId[] = scenarios.map((scenario) => scenario.id);
const SESSION_REVISION_KEY = '__sciforgeSessionRevision';
const SESSION_BASE_REVISION_KEY = '__sciforgeSessionBaseRevision';
const SESSION_BASE_COLLECTION_REVISIONS_KEY = '__sciforgeSessionBaseCollectionRevisions';
const WORKSPACE_REVISION_KEY = '__sciforgeWorkspaceRevision';
const WORKSPACE_BASE_REVISION_KEY = '__sciforgeWorkspaceBaseRevision';
const SESSION_WRITE_CONFLICT_LIMIT = 20;

export type SessionCollectionKey = 'title' | 'messages' | 'runs' | 'uiManifest' | 'claims' | 'executionUnits' | 'artifacts' | 'notebook' | 'hiddenResultSlotIds';
type SessionCollectionRevisions = Record<SessionCollectionKey, string>;
type SessionWithWriteGuard = SciForgeSession & {
  [SESSION_REVISION_KEY]?: string;
  [SESSION_BASE_REVISION_KEY]?: string;
  [SESSION_BASE_COLLECTION_REVISIONS_KEY]?: SessionCollectionRevisions;
};
type WorkspaceWithWriteGuard = SciForgeWorkspaceState & {
  [WORKSPACE_REVISION_KEY]?: string;
  [WORKSPACE_BASE_REVISION_KEY]?: string;
  sessionWriteConflicts?: SessionWriteConflictDiagnostic[];
};

export interface SessionWriteConflictDiagnostic {
  schemaVersion: 1;
  id: string;
  kind: 'stale-base-revision' | 'ordering-conflict';
  scenarioId: ScenarioInstanceId;
  sessionId: string;
  reason: string;
  writerId?: string;
  expectedBaseRevision: string;
  actualBaseRevision: string;
  attemptedRevision: string;
  conflictingFields: SessionCollectionKey[];
  current: SessionConflictSummary;
  attempted: SessionConflictSummary;
  recoverable: true;
  recoverableActions: string[];
  createdAt: string;
}

export interface SessionConflictSummary {
  sessionId: string;
  updatedAt: string;
  messageCount: number;
  runCount: number;
  artifactCount: number;
  executionUnitCount: number;
  notebookCount: number;
}

export interface SessionWriteGuardOptions {
  reason?: string;
  writerId?: string;
  baseRevision?: string;
}

function isScenarioId(value: unknown): value is ScenarioId {
  return scenarioIds.includes(value as ScenarioId);
}

function seedMessages(scenarioId: ScenarioId): SciForgeMessage[] {
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

export function createSession(scenarioId: ScenarioInstanceId, title = '新聊天', options: { seed?: boolean } = {}): SciForgeSession {
  const now = nowIso();
  return withSessionWriteGuard({
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
    hiddenResultSlotIds: [],
    updatedAt: now,
  });
}

function migrateSession(value: unknown, scenarioId: ScenarioInstanceId): SciForgeSession {
  if (isSessionV2(value, scenarioId)) return withSessionWriteGuard(value);
  if (typeof value === 'object' && value !== null && (value as { scenarioId?: unknown }).scenarioId === scenarioId) {
    const raw = value as Partial<SciForgeSession> & { schemaVersion?: number };
    const now = nowIso();
    return withSessionWriteGuard({
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
      hiddenResultSlotIds: Array.isArray(raw.hiddenResultSlotIds)
        ? raw.hiddenResultSlotIds.filter((id): id is string => typeof id === 'string')
        : [],
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
    });
  }
  return createSession(scenarioId);
}

function isSessionV2(value: unknown, scenarioId: ScenarioInstanceId): value is SciForgeSession {
  return typeof value === 'object'
    && value !== null
    && (value as SciForgeSession).schemaVersion === 2
    && (value as SciForgeSession).scenarioId === scenarioId
    && Array.isArray((value as SciForgeSession).messages)
    && Array.isArray((value as SciForgeSession).versions);
}

export function createInitialWorkspaceState(): SciForgeWorkspaceState {
  const now = nowIso();
  return withWorkspaceWriteGuard({
    schemaVersion: 2,
    workspacePath: '',
    sessionsByScenario: scenarioIds.reduce((acc, scenarioId) => {
      acc[scenarioId] = createSession(scenarioId, `${scenarioLabel(scenarioId)} 默认聊天`, { seed: true });
      return acc;
    }, {} as Record<ScenarioInstanceId, SciForgeSession>),
    archivedSessions: [],
    alignmentContracts: [],
    feedbackComments: [],
    feedbackRequests: [],
    githubSyncedOpenIssues: [],
    updatedAt: now,
  });
}

export function loadWorkspaceState(): SciForgeWorkspaceState {
  if (typeof window === 'undefined') return createInitialWorkspaceState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return parseWorkspaceState(JSON.parse(raw));
  } catch {
    return createInitialWorkspaceState();
  }
  return createInitialWorkspaceState();
}

export function parseWorkspaceState(value: unknown): SciForgeWorkspaceState {
  const now = nowIso();
  if (typeof value !== 'object' || value === null) return createInitialWorkspaceState();
  const raw = value as Partial<SciForgeWorkspaceState>;
  return withWorkspaceWriteGuard({
    schemaVersion: 2,
    workspacePath: typeof raw.workspacePath === 'string' ? normalizeWorkspaceRootPath(raw.workspacePath) : '',
    sessionsByScenario: preserveWorkspaceSessions(raw.sessionsByScenario, scenarioIds.reduce((acc, scenarioId) => {
      acc[scenarioId] = migrateSession(raw.sessionsByScenario?.[scenarioId], scenarioId);
      return acc;
    }, {} as Record<ScenarioInstanceId, SciForgeSession>)),
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
    feedbackRepairRuns: Array.isArray(raw.feedbackRepairRuns)
      ? raw.feedbackRepairRuns.filter(isFeedbackRepairRun)
      : [],
    feedbackRepairResults: Array.isArray(raw.feedbackRepairResults)
      ? raw.feedbackRepairResults.filter(isFeedbackRepairResult)
      : [],
    githubSyncedOpenIssues: Array.isArray(raw.githubSyncedOpenIssues)
      ? raw.githubSyncedOpenIssues.filter(isGithubSyncedOpenIssue)
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
    sessionWriteConflicts: parseSessionWriteConflicts((raw as Record<string, unknown>).sessionWriteConflicts),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  } as WorkspaceWithWriteGuard);
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
    && (value as AlignmentContractRecord).type === ALIGNMENT_CONTRACT_ARTIFACT_TYPE
    && (value as AlignmentContractRecord).schemaVersion === ALIGNMENT_CONTRACT_SCHEMA_VERSION
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

function isGithubSyncedOpenIssue(value: unknown): value is GithubSyncedOpenIssueRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1
    && typeof record.number === 'number'
    && Number.isFinite(record.number)
    && typeof record.title === 'string'
    && typeof record.body === 'string'
    && typeof record.htmlUrl === 'string'
    && typeof record.updatedAt === 'string'
    && typeof record.syncedAt === 'string'
    && Array.isArray(record.labels)
    && record.labels.every((label): label is string => typeof label === 'string');
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

function isFeedbackRepairRun(value: unknown) {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1
    && typeof record.id === 'string'
    && typeof record.issueId === 'string'
    && typeof record.status === 'string'
    && typeof record.startedAt === 'string';
}

function isFeedbackRepairResult(value: unknown) {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1
    && typeof record.id === 'string'
    && typeof record.issueId === 'string'
    && typeof record.verdict === 'string'
    && typeof record.summary === 'string'
    && Array.isArray(record.changedFiles)
    && Array.isArray(record.evidenceRefs)
    && typeof record.completedAt === 'string';
}

export function saveWorkspaceState(state: SciForgeWorkspaceState) {
  if (typeof window === 'undefined') return;
  const writableState = guardLocalWorkspaceWrite(state);
  const compact = compactWorkspaceStateForStorage(writableState);
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
  state: SciForgeWorkspaceState,
  mode: 'normal' | 'minimal' = 'normal',
): SciForgeWorkspaceState {
  const limits = mode === 'minimal'
    ? { messages: 4, runs: 3, records: 3, versions: 1, archived: 2, timeline: 10, reusable: 5 }
    : { messages: 16, runs: 8, records: 8, versions: 3, archived: 6, timeline: 40, reusable: 20 };
  const cleanState = stripWorkspaceWriteGuard(state);
  return {
    ...cleanState,
    sessionsByScenario: Object.fromEntries(Object.entries(state.sessionsByScenario).map(([id, session]) => [
      id,
      compactSessionForStorage(session, limits),
    ])) as Record<ScenarioInstanceId, SciForgeSession>,
    archivedSessions: (state.archivedSessions ?? []).slice(0, limits.archived).map((session) => compactSessionForStorage(session, limits)),
    feedbackComments: state.feedbackComments?.slice(0, mode === 'minimal' ? 20 : 120),
    feedbackRequests: state.feedbackRequests?.slice(0, mode === 'minimal' ? 8 : 40),
    feedbackRepairRuns: state.feedbackRepairRuns?.slice(0, mode === 'minimal' ? 20 : 120),
    feedbackRepairResults: state.feedbackRepairResults?.slice(0, mode === 'minimal' ? 20 : 120),
    githubSyncedOpenIssues: state.githubSyncedOpenIssues?.slice(0, mode === 'minimal' ? 40 : 120),
    timelineEvents: state.timelineEvents?.slice(0, limits.timeline),
    reusableTaskCandidates: state.reusableTaskCandidates?.slice(0, limits.reusable),
    sessionWriteConflicts: sessionWriteConflictsForState(state).slice(0, mode === 'minimal' ? 5 : SESSION_WRITE_CONFLICT_LIMIT),
  } as WorkspaceWithWriteGuard;
}

function compactSessionForStorage(
  session: SciForgeSession,
  limits: { messages: number; runs: number; records: number; versions: number },
): SciForgeSession {
  const cleanSession = stripSessionWriteGuard(session);
  return {
    ...cleanSession,
    messages: cleanSession.messages.slice(-limits.messages).map((message) => ({
      ...message,
      content: message.content.length > 2400 ? `${message.content.slice(0, 2400)}...` : message.content,
    })),
    runs: cleanSession.runs.slice(-limits.runs).map((run) => ({
      ...run,
      prompt: run.prompt.length > 1200 ? `${run.prompt.slice(0, 1200)}...` : run.prompt,
      response: run.response.length > 2400 ? `${run.response.slice(0, 2400)}...` : run.response,
      raw: compactArtifactData(run.raw),
    })),
    uiManifest: cleanSession.uiManifest.slice(0, limits.records),
    claims: cleanSession.claims.slice(0, limits.records),
    executionUnits: cleanSession.executionUnits.slice(-limits.records),
    artifacts: cleanSession.artifacts.slice(-limits.records).map((artifact) => ({
      ...artifact,
      data: compactArtifactData(artifact.data),
    })),
    notebook: cleanSession.notebook.slice(0, limits.records),
    versions: cleanSession.versions.slice(0, limits.versions).map((version) => ({
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
  session: Omit<SciForgeSession, 'versions'>,
  limits: { messages: number; runs: number; records: number; versions: number },
): Omit<SciForgeSession, 'versions'> {
  const cleanSession = stripSessionWriteGuard(session) as Omit<SciForgeSession, 'versions'>;
  return {
    ...cleanSession,
    messages: cleanSession.messages.slice(-limits.messages).map((message) => ({
      ...message,
      content: message.content.length > 2400 ? `${message.content.slice(0, 2400)}...` : message.content,
    })),
    runs: cleanSession.runs.slice(-limits.runs).map((run) => ({
      ...run,
      prompt: run.prompt.length > 1200 ? `${run.prompt.slice(0, 1200)}...` : run.prompt,
      response: run.response.length > 2400 ? `${run.response.slice(0, 2400)}...` : run.response,
      raw: compactArtifactData(run.raw),
    })),
    uiManifest: cleanSession.uiManifest.slice(0, limits.records),
    claims: cleanSession.claims.slice(0, limits.records),
    executionUnits: cleanSession.executionUnits.slice(-limits.records),
    artifacts: cleanSession.artifacts.slice(-limits.records).map((artifact) => ({
      ...artifact,
      data: compactArtifactData(artifact.data),
    })),
    notebook: cleanSession.notebook.slice(0, limits.records),
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
  current: SciForgeWorkspaceState,
  persisted: SciForgeWorkspaceState,
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

export function resetSession(scenarioId: ScenarioInstanceId): SciForgeSession {
  return createSession(scenarioId, `${scenarioLabel(scenarioId)} 新聊天`);
}

export function versionSession(session: SciForgeSession, reason: string): SciForgeSession {
  const timestamp = nowIso();
  const cleanSession = stripSessionWriteGuard(session);
  const snapshot = compactSessionSnapshotForStorage(stripVersions({ ...cleanSession, updatedAt: timestamp }), {
    messages: 16,
    runs: 8,
    records: 8,
    versions: 3,
  });
  const version: SessionVersionRecord = {
    id: makeId('version'),
    reason,
    createdAt: timestamp,
    messageCount: cleanSession.messages.length,
    runCount: cleanSession.runs.length,
    artifactCount: cleanSession.artifacts.length,
    checksum: checksum(JSON.stringify(snapshot)),
    snapshot,
  };
  return withSessionWriteGuard({
    ...cleanSession,
    versions: [version, ...cleanSession.versions].slice(0, 40),
    updatedAt: timestamp,
  });
}

function stripVersions(session: SciForgeSession): Omit<SciForgeSession, 'versions'> {
  const { versions: _versions, ...rest } = session;
  return rest;
}

export function withSessionWriteGuard(session: SciForgeSession): SciForgeSession {
  const cleanSession = stripSessionWriteGuard(session);
  const revision = sessionContentRevision(cleanSession);
  return {
    ...cleanSession,
    [SESSION_REVISION_KEY]: revision,
    [SESSION_BASE_REVISION_KEY]: revision,
    [SESSION_BASE_COLLECTION_REVISIONS_KEY]: sessionCollectionRevisions(cleanSession),
  } as SessionWithWriteGuard;
}

export function sessionContentRevision(session: SciForgeSession | Omit<SciForgeSession, 'versions'>): string {
  return checksum(stableStringify(sessionRevisionPayload(stripSessionWriteGuard(session))));
}

export function sessionWriteConflictsForState(state: SciForgeWorkspaceState): SessionWriteConflictDiagnostic[] {
  const conflicts = (state as WorkspaceWithWriteGuard).sessionWriteConflicts;
  return Array.isArray(conflicts) ? conflicts.filter(isSessionWriteConflictDiagnostic) : [];
}

export function detectSessionWriteConflict(
  currentSession: SciForgeSession | undefined,
  attemptedSession: SciForgeSession,
  options: SessionWriteGuardOptions = {},
): SessionWriteConflictDiagnostic | undefined {
  if (!currentSession) return undefined;
  const expectedBaseRevision = options.baseRevision ?? (attemptedSession as SessionWithWriteGuard)[SESSION_BASE_REVISION_KEY];
  if (!expectedBaseRevision) return undefined;

  const actualBaseRevision = sessionContentRevision(currentSession);
  const attemptedRevision = sessionContentRevision(attemptedSession);
  if (actualBaseRevision === expectedBaseRevision || actualBaseRevision === attemptedRevision || attemptedRevision === expectedBaseRevision) {
    return undefined;
  }

  const conflictingFields = overlappingSessionChanges(currentSession, attemptedSession);
  return {
    schemaVersion: 1,
    id: makeId('session-conflict'),
    kind: conflictingFields.length ? 'ordering-conflict' : 'stale-base-revision',
    scenarioId: attemptedSession.scenarioId,
    sessionId: attemptedSession.sessionId,
    reason: options.reason ?? 'session update',
    writerId: options.writerId,
    expectedBaseRevision,
    actualBaseRevision,
    attemptedRevision,
    conflictingFields,
    current: sessionConflictSummary(currentSession),
    attempted: sessionConflictSummary(attemptedSession),
    recoverable: true,
    recoverableActions: [
      'Reload the current session state.',
      'Review the attempted update against the current revision.',
      'Reapply the attempted changes on top of the current session.',
    ],
    createdAt: nowIso(),
  };
}

export function recordSessionWriteConflict(
  state: SciForgeWorkspaceState,
  diagnostic: SessionWriteConflictDiagnostic,
): SciForgeWorkspaceState {
  return withWorkspaceWriteGuard({
    ...state,
    sessionWriteConflicts: [
      diagnostic,
      ...sessionWriteConflictsForState(state).filter((item) => item.id !== diagnostic.id),
    ].slice(0, SESSION_WRITE_CONFLICT_LIMIT),
  } as WorkspaceWithWriteGuard);
}

function checksum(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function withWorkspaceWriteGuard(state: SciForgeWorkspaceState): SciForgeWorkspaceState {
  const cleanState = stripWorkspaceWriteGuard(state);
  const sessionsByScenario = Object.fromEntries(Object.entries(cleanState.sessionsByScenario).map(([scenarioId, session]) => [
    scenarioId,
    withSessionWriteGuard(session),
  ])) as Record<ScenarioInstanceId, SciForgeSession>;
  const archivedSessions = (cleanState.archivedSessions ?? []).map(withSessionWriteGuard);
  const guardedState = {
    ...cleanState,
    sessionsByScenario,
    archivedSessions,
    sessionWriteConflicts: sessionWriteConflictsForState(state).slice(0, SESSION_WRITE_CONFLICT_LIMIT),
  } as WorkspaceWithWriteGuard;
  const revision = workspaceContentRevision(guardedState);
  return {
    ...guardedState,
    [WORKSPACE_REVISION_KEY]: revision,
    [WORKSPACE_BASE_REVISION_KEY]: revision,
  } as WorkspaceWithWriteGuard;
}

function guardLocalWorkspaceWrite(state: SciForgeWorkspaceState): SciForgeWorkspaceState {
  if (typeof window === 'undefined') return state;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return state;
    const current = parseWorkspaceState(JSON.parse(stored));
    const diagnostics = detectWorkspaceSessionWriteConflicts(current, state, 'localStorage session write');
    if (!diagnostics.length) return state;
    return diagnostics.reduce((nextState, diagnostic) => recordSessionWriteConflict(nextState, diagnostic), current);
  } catch {
    return state;
  }
}

function detectWorkspaceSessionWriteConflicts(
  current: SciForgeWorkspaceState,
  attempted: SciForgeWorkspaceState,
  reason: string,
): SessionWriteConflictDiagnostic[] {
  return Object.values(attempted.sessionsByScenario).flatMap((attemptedSession) => {
    const expectedBaseRevision = (attemptedSession as SessionWithWriteGuard)[SESSION_BASE_REVISION_KEY];
    if (!expectedBaseRevision || sessionContentRevision(attemptedSession) === expectedBaseRevision) return [];
    const diagnostic = detectSessionWriteConflict(
      current.sessionsByScenario[attemptedSession.scenarioId],
      attemptedSession,
      { reason, baseRevision: expectedBaseRevision },
    );
    return diagnostic ? [diagnostic] : [];
  });
}

function workspaceContentRevision(state: SciForgeWorkspaceState): string {
  const cleanState = stripWorkspaceWriteGuard(state);
  return checksum(stableStringify({
    schemaVersion: cleanState.schemaVersion,
    workspacePath: cleanState.workspacePath,
    sessionsByScenario: Object.fromEntries(Object.entries(cleanState.sessionsByScenario).map(([scenarioId, session]) => [
      scenarioId,
      sessionContentRevision(session),
    ])),
    archivedSessions: cleanState.archivedSessions.map(sessionContentRevision),
    alignmentContracts: cleanState.alignmentContracts,
    feedbackComments: cleanState.feedbackComments,
    feedbackRequests: cleanState.feedbackRequests,
    feedbackRepairRuns: cleanState.feedbackRepairRuns,
    feedbackRepairResults: cleanState.feedbackRepairResults,
    githubSyncedOpenIssues: cleanState.githubSyncedOpenIssues,
    timelineEvents: cleanState.timelineEvents,
    reusableTaskCandidates: cleanState.reusableTaskCandidates,
    hiddenOfficialPackageIds: cleanState.hiddenOfficialPackageIds,
    sessionWriteConflicts: sessionWriteConflictsForState(state),
    updatedAt: cleanState.updatedAt,
  }));
}

function sessionRevisionPayload(session: SciForgeSession | Omit<SciForgeSession, 'versions'>) {
  return {
    schemaVersion: session.schemaVersion,
    sessionId: session.sessionId,
    scenarioId: session.scenarioId,
    title: session.title,
    createdAt: session.createdAt,
    messages: session.messages,
    runs: session.runs,
    uiManifest: session.uiManifest,
    claims: session.claims,
    executionUnits: session.executionUnits,
    artifacts: session.artifacts,
    notebook: session.notebook,
    hiddenResultSlotIds: session.hiddenResultSlotIds ?? [],
  };
}

function sessionCollectionRevisions(session: SciForgeSession | Omit<SciForgeSession, 'versions'>): SessionCollectionRevisions {
  const cleanSession = stripSessionWriteGuard(session);
  return {
    title: checksum(stableStringify(cleanSession.title)),
    messages: checksum(stableStringify(cleanSession.messages)),
    runs: checksum(stableStringify(cleanSession.runs)),
    uiManifest: checksum(stableStringify(cleanSession.uiManifest)),
    claims: checksum(stableStringify(cleanSession.claims)),
    executionUnits: checksum(stableStringify(cleanSession.executionUnits)),
    artifacts: checksum(stableStringify(cleanSession.artifacts)),
    notebook: checksum(stableStringify(cleanSession.notebook)),
    hiddenResultSlotIds: checksum(stableStringify(cleanSession.hiddenResultSlotIds ?? [])),
  };
}

function overlappingSessionChanges(
  currentSession: SciForgeSession,
  attemptedSession: SciForgeSession,
): SessionCollectionKey[] {
  const baseCollections = (attemptedSession as SessionWithWriteGuard)[SESSION_BASE_COLLECTION_REVISIONS_KEY];
  if (!baseCollections) return [];
  const currentCollections = sessionCollectionRevisions(currentSession);
  const attemptedCollections = sessionCollectionRevisions(attemptedSession);
  return (Object.keys(baseCollections) as SessionCollectionKey[]).filter((key) => {
    return currentCollections[key] !== baseCollections[key]
      && attemptedCollections[key] !== baseCollections[key]
      && currentCollections[key] !== attemptedCollections[key];
  });
}

function sessionConflictSummary(session: SciForgeSession): SessionConflictSummary {
  return {
    sessionId: session.sessionId,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    runCount: session.runs.length,
    artifactCount: session.artifacts.length,
    executionUnitCount: session.executionUnits.length,
    notebookCount: session.notebook.length,
  };
}

function stripSessionWriteGuard<T extends Partial<SciForgeSession>>(session: T): T {
  return withoutKeys(session, [
    SESSION_REVISION_KEY,
    SESSION_BASE_REVISION_KEY,
    SESSION_BASE_COLLECTION_REVISIONS_KEY,
  ]) as T;
}

function stripWorkspaceWriteGuard<T extends Partial<SciForgeWorkspaceState>>(state: T): T {
  return withoutKeys(state, [
    WORKSPACE_REVISION_KEY,
    WORKSPACE_BASE_REVISION_KEY,
  ]) as T;
}

function withoutKeys<T>(value: T, keys: string[]): T {
  if (!value || typeof value !== 'object') return value;
  const copy = { ...(value as Record<string, unknown>) };
  for (const key of keys) delete copy[key];
  return copy as T;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record)
    .filter((key) => record[key] !== undefined && !isWriteGuardKey(key))
    .sort()
    .map((key) => [key, stableValue(record[key])]));
}

function isWriteGuardKey(key: string) {
  return key === SESSION_REVISION_KEY
    || key === SESSION_BASE_REVISION_KEY
    || key === SESSION_BASE_COLLECTION_REVISIONS_KEY
    || key === WORKSPACE_REVISION_KEY
    || key === WORKSPACE_BASE_REVISION_KEY;
}

function parseSessionWriteConflicts(value: unknown): SessionWriteConflictDiagnostic[] {
  return Array.isArray(value)
    ? value.filter(isSessionWriteConflictDiagnostic).slice(0, SESSION_WRITE_CONFLICT_LIMIT)
    : [];
}

function isSessionWriteConflictDiagnostic(value: unknown): value is SessionWriteConflictDiagnostic {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<SessionWriteConflictDiagnostic>;
  return record.schemaVersion === 1
    && typeof record.id === 'string'
    && (record.kind === 'stale-base-revision' || record.kind === 'ordering-conflict')
    && typeof record.scenarioId === 'string'
    && typeof record.sessionId === 'string'
    && typeof record.reason === 'string'
    && typeof record.expectedBaseRevision === 'string'
    && typeof record.actualBaseRevision === 'string'
    && typeof record.attemptedRevision === 'string'
    && Array.isArray(record.conflictingFields)
    && record.conflictingFields.every((field) => isSessionCollectionKey(field))
    && typeof record.current === 'object'
    && record.current !== null
    && typeof record.attempted === 'object'
    && record.attempted !== null
    && record.recoverable === true
    && Array.isArray(record.recoverableActions)
    && typeof record.createdAt === 'string';
}

function isSessionCollectionKey(value: unknown): value is SessionCollectionKey {
  return value === 'title'
    || value === 'messages'
    || value === 'runs'
    || value === 'uiManifest'
    || value === 'claims'
    || value === 'executionUnits'
    || value === 'artifacts'
    || value === 'notebook'
    || value === 'hiddenResultSlotIds';
}

function preserveWorkspaceSessions(
  rawSessions: SciForgeWorkspaceState['sessionsByScenario'] | undefined,
  base: Record<ScenarioInstanceId, SciForgeSession>,
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

function workspaceActivityScore(state: SciForgeWorkspaceState) {
  return Object.values(state.sessionsByScenario).reduce((total, session) => {
    return total + sessionActivityScore(session);
  }, state.archivedSessions.length + (state.alignmentContracts?.length ?? 0) + (state.timelineEvents?.length ?? 0));
}

export function sessionActivityScore(session: SciForgeSession) {
  const userMessages = session.messages.filter((message) => !message.id.startsWith('seed')).length;
  return userMessages
    + session.runs.length
    + session.artifacts.length
    + session.executionUnits.length
    + session.notebook.length;
}
