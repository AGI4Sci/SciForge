import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SciForgeSession } from '@sciforge-ui/runtime-contract';
import {
  AGENTSERVER_BACKEND_HANDOFF_VERSION,
  canonicalSerializeDegradedHandoffPacket,
  validateDegradedHandoffPacket,
  type DegradedHandoffPacket,
  type DegradedReason,
  type RefDescriptor,
} from '../../../../src/runtime/gateway/agentserver-context-contract.js';
import type { ConversationEvent, ConversationProjection, ConversationRef } from '../../../../src/runtime/conversation-kernel/index.js';
import {
  createConversationEventLog,
  projectConversation,
} from '../../../../src/runtime/conversation-kernel/index.js';
import type { ProjectMemoryRef } from '../../../../src/runtime/project-session-memory.js';
import {
  artifactDeliveryManifestFromSession,
  assertWebE2eContract,
  runAuditFromSession,
  type WebE2eBrowserVisibleState,
  type WebE2eContractVerifierInput,
} from '../contract-verifier.js';
import { buildWebE2eFixtureWorkspace } from '../fixture-workspace-builder.js';
import { startScriptableAgentServerMock } from '../scriptable-agentserver-mock.js';
import type {
  JsonRecord,
  ScriptableAgentServerMockHandle,
  WebE2eFixtureWorkspace,
} from '../types.js';

export const SA_WEB_08_CASE_ID = 'SA-WEB-08';
export const SA_WEB_08_DEGRADED_REASON = 'AgentServer context API unavailable';
export const SA_WEB_08_VISIBLE_TEXT = `${SA_WEB_08_DEGRADED_REASON}: continuing with refs-first degraded handoff packet.`;

const fixedNow = '2026-05-16T00:00:00.000Z';
const forbiddenBackendKeys = ['recentTurns', 'fullRefList', 'rawHistory', 'compactionState'];
const rawHistorySentinel = 'RAW_HISTORY_SHOULD_NOT_REACH_BACKEND';

export interface SaWeb08DegradedAgentServerCase {
  baseDir: string;
  fixture: WebE2eFixtureWorkspace;
  server: ScriptableAgentServerMockHandle;
  contextUnavailable: {
    ok: false;
    reason: string;
    error: string;
  };
  degradedReason: DegradedReason;
  degradedPacket: DegradedHandoffPacket;
  serializedDegradedPacket: string;
  backendRunRequest: JsonRecord;
  backendRunResult: JsonRecord;
  verifierInput: WebE2eContractVerifierInput;
  browserVisibleState: WebE2eBrowserVisibleState;
  rawHistorySentinel: string;
  close(): Promise<void>;
}

export async function createSaWeb08DegradedAgentServerCase(): Promise<SaWeb08DegradedAgentServerCase> {
  const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-web-e2e-sa-web-08-'));
  const server = await startScriptableAgentServerMock({
    seed: 'sa-web-08-degraded-agentserver',
    fixedNow,
    script: [{
      kind: 'degraded',
      message: SA_WEB_08_VISIBLE_TEXT,
      reason: 'context-api-unavailable',
      recoverActions: ['Retry AgentServer context API', 'Continue from selected refs'],
    }],
  });

  try {
    const fixture = await buildWebE2eFixtureWorkspace({
      caseId: SA_WEB_08_CASE_ID,
      baseDir,
      now: fixedNow,
      workspaceWriterBaseUrl: 'http://127.0.0.1:29991',
      agentServerBaseUrl: server.baseUrl,
      providerCapabilities: [
        providerCapability('sciforge.web-worker.web_search', 'web_search', 'degraded'),
        providerCapability('sciforge.web-worker.web_fetch', 'web_fetch', 'degraded'),
        providerCapability('sciforge.workspace-reader.read_ref', 'read_ref', 'available'),
      ],
    });

    const contextUnavailable = await fetchUnavailableContextSnapshot(server.baseUrl);
    const degradedReason: DegradedReason = {
      owner: 'agentserver',
      reason: SA_WEB_08_DEGRADED_REASON,
      recoverability: 'retryable',
    };
    const degradedPacket = buildDegradedHandoffPacket(fixture, degradedReason, server.digest);
    const serializedDegradedPacket = canonicalSerializeDegradedHandoffPacket(degradedPacket);
    const backendRunRequest = buildBackendRunRequest(fixture, degradedPacket, rawHistorySentinel);
    const backendRunResult = await fetchBackendRun(server.baseUrl, backendRunRequest);
    const projection = buildDegradedProjection(fixture, degradedReason);
    const session = buildDegradedSession(fixture, projection, degradedReason);
    const expected = {
      ...fixture.expectedProjection,
      conversationProjection: projection,
    };
    const browserVisibleState: WebE2eBrowserVisibleState = {
      status: projection.visibleAnswer?.status,
      visibleAnswerText: `${projection.visibleAnswer?.text} (${degradedReason.reason})`,
      primaryArtifactRefs: expected.artifactDelivery.primaryArtifactRefs,
      supportingArtifactRefs: expected.artifactDelivery.supportingArtifactRefs,
      visibleArtifactRefs: [
        ...expected.artifactDelivery.primaryArtifactRefs,
        ...expected.artifactDelivery.supportingArtifactRefs,
      ],
      auditRefs: [],
      diagnosticRefs: [],
      internalRefs: [],
      recoverActions: projection.recoverActions,
    };
    const verifierInput: WebE2eContractVerifierInput = {
      caseId: fixture.caseId,
      expected,
      browserVisibleState,
      kernelProjection: projection,
      sessionBundle: {
        session,
        workspaceState: {
          ...fixture.workspaceState,
          sessionsByScenario: {
            ...fixture.workspaceState.sessionsByScenario,
            [fixture.scenarioId]: session,
          },
        },
      },
      runAudit: {
        ...runAuditFromSession(session, expected),
        refs: [
          ...runAuditFromSession(session, expected).refs,
          degradedPacket.degradedReasonRef?.ref ?? '',
        ].filter(Boolean),
      },
      artifactDeliveryManifest: artifactDeliveryManifestFromSession(session, expected),
    };

    assertWebE2eContract(verifierInput);

    return {
      baseDir,
      fixture,
      server,
      contextUnavailable,
      degradedReason,
      degradedPacket,
      serializedDegradedPacket,
      backendRunRequest,
      backendRunResult,
      verifierInput,
      browserVisibleState,
      rawHistorySentinel,
      close: async () => {
        await server.close();
        await rm(baseDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await server.close();
    await rm(baseDir, { recursive: true, force: true });
    throw error;
  }
}

export function assertSaWeb08DegradedAgentServerCase(value: SaWeb08DegradedAgentServerCase): void {
  assert.equal(value.contextUnavailable.ok, false);
  assert.equal(value.contextUnavailable.reason, 'context-api-unavailable');
  assert.equal(validateDegradedHandoffPacket(value.degradedPacket).ok, true);
  assert.equal(value.degradedPacket._contractVersion, AGENTSERVER_BACKEND_HANDOFF_VERSION);
  assert.equal(value.degradedPacket.degradedReason.reason, SA_WEB_08_DEGRADED_REASON);
  assert.equal(value.verifierInput.expected.conversationProjection.visibleAnswer?.status, 'degraded-result');
  assert.match(value.browserVisibleState.visibleAnswerText ?? '', /AgentServer context API unavailable/);
  assertRefsFirstDegradedPacket(value.degradedPacket, value.serializedDegradedPacket);
  assertBackendDidNotReceiveRawHistory(value.backendRunRequest, value.rawHistorySentinel);
  assertBackendDidNotReceiveRawHistory(value.server.requests.runs[0]?.body, value.rawHistorySentinel);
  assert.match(JSON.stringify(value.backendRunResult), /degraded-result/);
}

export function assertRefsFirstDegradedPacket(packet: DegradedHandoffPacket, serialized = canonicalSerializeDegradedHandoffPacket(packet)): void {
  assert.ok(packet.currentTurnRef.ref.startsWith('message:'), 'current turn must be a ref, not raw content');
  assert.ok(packet.capabilityBriefRef.ref.startsWith('file:'), 'capability brief must be a durable ref');
  assert.ok(packet.boundedArtifactIndex.length > 0, 'degraded packet should retain a bounded artifact index');
  assert.ok(packet.boundedArtifactIndex.length <= 4, 'degraded packet must bound artifact refs');
  assert.ok(packet.boundedArtifactIndex.every((ref) => typeof ref.ref === 'string' && !('body' in ref)), 'artifact index must be refs-only');
  assert.ok(packet.boundedFailureIndex.length <= 2, 'degraded packet must bound failure refs');
  for (const key of forbiddenBackendKeys) assert.doesNotMatch(serialized, new RegExp(key));
  assert.doesNotMatch(serialized, /RAW_HISTORY_SHOULD_NOT_REACH_BACKEND|rawBody|artifactBody|content":/);
}

export function assertBackendDidNotReceiveRawHistory(value: unknown, sentinel = rawHistorySentinel): void {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, new RegExp(sentinel));
  for (const key of forbiddenBackendKeys) assert.doesNotMatch(serialized, new RegExp(`"${key}"`));
}

async function fetchUnavailableContextSnapshot(baseUrl: string) {
  const response = await fetch(`${baseUrl}/api/agent-server/agents/web-e2e/missing-context`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.ok, false, 'context snapshot endpoint should be unavailable for this case');
  const payload = await response.json() as JsonRecord;
  return {
    ok: false as const,
    reason: 'context-api-unavailable',
    error: String(payload.error ?? response.statusText),
  };
}

function buildDegradedHandoffPacket(
  fixture: WebE2eFixtureWorkspace,
  degradedReason: DegradedReason,
  digest: (value: unknown) => string,
): DegradedHandoffPacket {
  return {
    _contractVersion: AGENTSERVER_BACKEND_HANDOFF_VERSION,
    degradedReason,
    degradedReasonRef: memoryRef('file:.sciforge/task-results/sa-web-08-degraded-reason.json', 'run-audit', digest),
    currentTurnRef: memoryRef(fixture.expectedProjection.currentTask.currentTurnRef.ref, 'task-input', digest),
    stableGoalRef: memoryRef('file:.sciforge/task-results/sa-web-08-stable-goal.md', 'context', digest),
    capabilityBriefRef: memoryRef(fixture.expectedProjection.providerManifestRef, 'context', digest),
    boundedArtifactIndex: fixture.expectedProjection.currentTask.selectedRefs.map((ref) => refDescriptor(ref.ref, ref.artifactType)),
    boundedFailureIndex: [refDescriptor('file:.sciforge/task-results/current-run-audit.json', 'run-audit')],
    availableRetrievalTools: ['read_ref', 'retrieve', 'workspace_search', 'list_session_artifacts'],
  };
}

function buildBackendRunRequest(
  fixture: WebE2eFixtureWorkspace,
  degradedPacket: DegradedHandoffPacket,
  sentinel: string,
): JsonRecord {
  const rejectedRawHistory = [{ role: 'user', content: sentinel }];
  void rejectedRawHistory;
  return {
    runId: fixture.runId,
    sessionId: fixture.sessionId,
    mode: 'degraded-agentserver-context-unavailable',
    handoffPacket: JSON.parse(canonicalSerializeDegradedHandoffPacket(degradedPacket)) as JsonRecord,
    currentTask: {
      currentTurnRef: degradedPacket.currentTurnRef.ref,
      selectedRefs: degradedPacket.boundedArtifactIndex.map((ref) => ref.ref),
    },
  };
}

async function fetchBackendRun(baseUrl: string, body: JsonRecord): Promise<JsonRecord> {
  const response = await fetch(`${baseUrl}/api/agent-server/runs/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.ok, true);
  const envelopes = (await response.text())
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonRecord);
  const terminal = envelopes.find((envelope) => envelope.result) as JsonRecord | undefined;
  assert.ok(terminal, 'scriptable mock should return a terminal degraded result');
  return terminal;
}

function buildDegradedProjection(fixture: WebE2eFixtureWorkspace, degradedReason: DegradedReason): ConversationProjection {
  const log = {
    ...createConversationEventLog(fixture.sessionId),
    events: [
      inlineEvent('event-sa-web-08-current-turn', 'TurnReceived', 'user', { prompt: 'Continue using refs only after context API failure.' }, fixture),
      refEvent('event-sa-web-08-degraded-handoff', 'DegradedResult', 'runtime', {
        text: SA_WEB_08_VISIBLE_TEXT,
        summary: degradedReason.reason,
        reason: degradedReason,
        refs: [
          conversationRef('artifact:fixture-current-report', 'text/markdown', 'Current projection report'),
          conversationRef('artifact:fixture-expression-summary', 'text/csv', 'Expression summary CSV'),
          conversationRef('artifact:fixture-old-report', 'text/markdown', 'Previously selected literature report'),
          conversationRef('file:.sciforge/task-results/current-run-audit.json', 'application/json', 'Run audit bundle'),
        ],
      }, fixture),
    ],
  };
  return {
    ...projectConversation(log),
    recoverActions: ['Retry AgentServer context API', 'Continue from selected refs'],
    diagnostics: [{
      severity: 'warning',
      code: 'context-api-unavailable',
      message: degradedReason.reason,
      refs: [{ ref: 'file:.sciforge/task-results/current-run-audit.json' }],
    }],
  };
}

function buildDegradedSession(
  fixture: WebE2eFixtureWorkspace,
  projection: ConversationProjection,
  degradedReason: DegradedReason,
): SciForgeSession {
  const session = structuredClone(fixture.workspaceState.sessionsByScenario[fixture.scenarioId]);
  const agentMessage = session.messages.find((message) => message.role === 'scenario');
  if (agentMessage) {
    agentMessage.content = `${SA_WEB_08_VISIBLE_TEXT}\n${degradedReason.reason}`;
    agentMessage.status = 'completed';
  }
  const run = session.runs.find((candidate) => candidate.id === fixture.runId);
  assert.ok(run, 'fixture should include the current run');
  run.status = 'completed';
  run.response = SA_WEB_08_VISIBLE_TEXT;
  run.raw = {
    displayIntent: {
      primaryGoal: 'Render degraded AgentServer state from refs only.',
      source: 'agentserver',
      degradedReason,
      conversationProjection: projection,
      taskOutcomeProjection: {
        conversationProjection: projection,
      },
    },
    resultPresentation: {
      conversationProjection: projection,
    },
  };
  return session;
}

function memoryRef(ref: string, kind: ProjectMemoryRef['kind'], digest: (value: unknown) => string): ProjectMemoryRef {
  return {
    ref,
    kind,
    digest: digest({ ref, kind }),
    sizeBytes: ref.length,
    retention: kind === 'run-audit' ? 'audit-only' : 'hot',
  };
}

function refDescriptor(ref: string, kind = 'artifact'): RefDescriptor {
  return {
    ref,
    kind,
    digest: `sha256:${Buffer.from(ref).toString('hex').slice(0, 16)}`,
    readable: true,
  };
}

function inlineEvent(
  id: string,
  type: ConversationEvent['type'],
  actor: ConversationEvent['actor'],
  payload: Record<string, unknown>,
  fixture: WebE2eFixtureWorkspace,
): ConversationEvent {
  return {
    id,
    type,
    timestamp: fixedNow,
    actor,
    turnId: fixture.expectedProjection.currentTask.currentTurnRef.ref.replace(/^message:/, ''),
    runId: fixture.runId,
    storage: 'inline',
    payload,
  };
}

function refEvent(
  id: string,
  type: ConversationEvent['type'],
  actor: ConversationEvent['actor'],
  payload: { refs: ConversationRef[]; [key: string]: unknown },
  fixture: WebE2eFixtureWorkspace,
): ConversationEvent {
  return {
    id,
    type,
    timestamp: fixedNow,
    actor,
    turnId: fixture.expectedProjection.currentTask.currentTurnRef.ref.replace(/^message:/, ''),
    runId: fixture.runId,
    storage: 'ref',
    payload,
  };
}

function conversationRef(ref: string, mime: string, label: string): ConversationRef {
  return { ref, mime, label };
}

function providerCapability(
  id: string,
  capabilityId: string,
  status: 'available' | 'unavailable' | 'degraded',
) {
  return {
    id,
    providerId: id,
    capabilityId,
    workerId: id.split(`.${capabilityId}`)[0],
    status,
    fixtureMode: 'scripted-mock' as const,
  };
}
