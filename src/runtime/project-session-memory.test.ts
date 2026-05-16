import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCompactionRecordedEvent,
  buildRepairPacket,
  compileContextProjection,
  normalizeProjectSessionMemory,
  projectMemoryRefKindGroup,
  projectMemoryRefRetention,
  recoverProjectSessionProjection,
  type ProjectSessionEvent,
} from './project-session-memory.js';
import type { ConversationEventLog } from './conversation-kernel/types.js';

test('normalizes conversation event logs append-only without rewriting existing ledger events', () => {
  const baseLog: ConversationEventLog = {
    schemaVersion: 'sciforge.conversation-event-log.v1',
    conversationId: 'session-psm-1',
    events: [
      {
        id: 'turn-1',
        type: 'TurnReceived',
        timestamp: '2026-05-15T00:00:00.000Z',
        actor: 'user',
        storage: 'inline',
        payload: { prompt: 'Find papers about agent memory.' },
      },
      {
        id: 'dispatch-1',
        type: 'Dispatched',
        timestamp: '2026-05-15T00:00:01.000Z',
        actor: 'kernel',
        runId: 'run-1',
        storage: 'inline',
        payload: { summary: 'Dispatched to AgentServer.' },
      },
    ],
  };
  const appendedLog: ConversationEventLog = {
    ...baseLog,
    events: [
      ...baseLog.events,
      {
        id: 'artifact-1',
        type: 'OutputMaterialized',
        timestamp: '2026-05-15T00:01:00.000Z',
        actor: 'runtime',
        runId: 'run-1',
        storage: 'ref',
        payload: {
          summary: 'Report materialized.',
          refs: [{ ref: '.sciforge/sessions/session-psm-1/artifacts/report.md' }],
        },
      },
    ],
  };

  const base = normalizeProjectSessionMemory(baseLog);
  const appended = normalizeProjectSessionMemory(appendedLog);

  assert.equal(base.schemaVersion, 'sciforge.project-session-ledger-projection.v1');
  assert.equal(appended.events.length, base.events.length + 1);
  assert.deepEqual(appended.events.slice(0, base.events.length), base.events);
  assert.equal(appended.events[0].eventId, 'conversation:turn-1');
  assert.equal(appended.events[0].kind, 'user-turn');
  assert.equal(appended.events[1].actor, 'runtime');
  assert.equal(appended.events[2].kind, 'artifact-materialized');
});

test('normalizes ref digests and builds a stable ref index from session-like runs', () => {
  const projection = normalizeProjectSessionMemory({
    sessionId: 'session-refs',
    runs: [
      {
        id: 'run-a',
        createdAt: '2026-05-15T00:00:00.000Z',
        outputRef: '.sciforge/sessions/session-refs/task-results/output.json',
        stderrRef: '.sciforge/sessions/session-refs/logs/stderr.log',
        failureReason: 'bounded stop',
      },
    ],
    artifacts: [
      {
        id: 'report',
        ref: '.sciforge/sessions/session-refs/artifacts/report.md',
        mime: 'text/markdown',
        preview: 'Report preview',
      },
    ],
    verifications: [
      {
        id: 'verdict',
        ref: '.sciforge/sessions/session-refs/verifications/verdict.json',
        digest: 'sha256:known',
        sizeBytes: 16,
      },
    ],
  });

  const refs = projection.refIndex;
  assert.deepEqual(refs.map((ref) => ref.ref), [
    '.sciforge/sessions/session-refs/artifacts/report.md',
    '.sciforge/sessions/session-refs/logs/stderr.log',
    '.sciforge/sessions/session-refs/task-results/output.json',
    '.sciforge/sessions/session-refs/verifications/verdict.json',
  ]);
  assert.ok(refs.every((ref) => ref.digest.startsWith('sha256:')));
  assert.equal(refs.find((ref) => ref.ref.endsWith('output.json'))?.kind, 'task-output');
  assert.equal(refs.find((ref) => ref.ref.endsWith('stderr.log'))?.kind, 'stderr');
  assert.equal(refs.find((ref) => ref.ref.endsWith('verdict.json'))?.digest, 'sha256:known');
  assert.equal(projection.events.find((event) => event.runId === 'run-a')?.kind, 'failure-classified');
});

test('derives ref kind groups and retention for context handoff retrieval and audit refs', () => {
  const projection = normalizeProjectSessionMemory({
    sessionId: 'session-ref-policy',
    events: [{
      id: 'ref-policy',
      type: 'HarnessDecisionRecorded',
      payload: {
        refs: [
          { ref: 'handoffs/current-packet.json', kind: 'handoff-packet', retention: 'cold' },
          { ref: 'context:snapshot/current', kind: 'context-snapshot', retention: 'audit-only' },
          { ref: 'retrieval:evidence/current', kind: 'retrieval-evidence', retention: 'hot' },
          { ref: 'run-audit:decision/current', kind: 'retrieval-audit', retention: 'warm' },
        ],
      },
    }],
  });

  const refsByRef = new Map(projection.refIndex.map((ref) => [ref.ref, ref]));

  assert.equal(refsByRef.get('handoffs/current-packet.json')?.kind, 'handoff');
  assert.equal(refsByRef.get('handoffs/current-packet.json')?.retention, 'hot');
  assert.equal(refsByRef.get('context:snapshot/current')?.kind, 'context');
  assert.equal(refsByRef.get('context:snapshot/current')?.retention, 'warm');
  assert.equal(refsByRef.get('retrieval:evidence/current')?.kind, 'retrieval');
  assert.equal(refsByRef.get('retrieval:evidence/current')?.retention, 'cold');
  assert.equal(refsByRef.get('run-audit:decision/current')?.kind, 'run-audit');
  assert.equal(refsByRef.get('run-audit:decision/current')?.retention, 'audit-only');
  assert.equal(projectMemoryRefKindGroup('run-audit'), 'audit');
  assert.equal(projectMemoryRefRetention('retrieval'), 'cold');
});

test('keeps stable prefix hash unchanged when only the current tail task changes', () => {
  const stableInput = {
    sessionId: 'session-cache',
    createdAt: '2026-05-15T00:00:00.000Z',
    immutablePrefix: { contract: 'ToolPayload v1', rules: ['bounded task packet'] },
    workspaceIdentity: { cwd: '/workspace/SciForge', roots: ['.sciforge'] },
    stableSessionState: { goal: 'review memory papers', constraints: ['refs first'] },
    index: { artifacts: ['report.md'], failures: [] },
    sourceEventIds: {
      stableSessionState: ['conversation:turn-1'],
      index: ['conversation:artifact-1'],
    },
  };
  const first = compileContextProjection({
    ...stableInput,
    currentTaskPacket: { request: 'summarize section A', selectedRefs: ['report.md'] },
  });
  const second = compileContextProjection({
    ...stableInput,
    currentTaskPacket: { request: 'summarize section B', selectedRefs: ['report.md'] },
  });

  assert.equal(first.stablePrefixHash, second.stablePrefixHash);
  assert.deepEqual(first.blocks.slice(0, 4), second.blocks.slice(0, 4));
  assert.notEqual(
    first.blocks.find((block) => block.kind === 'task-packet')?.sha256,
    second.blocks.find((block) => block.kind === 'task-packet')?.sha256,
  );
  assert.deepEqual(second.blocks.map((block) => block.kind), [
    'immutable-prefix',
    'workspace-identity',
    'stable-session-state',
    'index',
    'task-packet',
  ]);
});

test('repair packet and compaction event append without rewriting stable projection blocks', () => {
  const stable = {
    sessionId: 'session-repair',
    createdAt: '2026-05-15T00:00:00.000Z',
    immutablePrefix: { contract: 'ToolPayload v1' },
    workspaceIdentity: { cwd: '/workspace/SciForge' },
    stableSessionState: { goal: 'finish failed run', decisions: ['provider-first'] },
    index: { failures: ['run-failed'] },
  };
  const before = compileContextProjection({
    ...stable,
    currentTaskPacket: { request: 'diagnose failed run' },
  });
  const packet = buildRepairPacket({
    failedRunId: 'run-failed',
    failureSummary: 'missing artifact ref',
    refs: [{
      ref: '.sciforge/sessions/session-repair/logs/stderr.log',
      kind: 'stderr',
      digest: 'sha256:stderr',
      sizeBytes: 32,
    }],
    nextStep: 'repair artifact ref only',
  });
  const after = compileContextProjection({
    ...stable,
    currentTaskPacket: packet,
    sourceEventIds: {
      currentTaskPacket: ['conversation:repair-needed'],
    },
  });

  assert.equal(before.stablePrefixHash, after.stablePrefixHash);
  assert.deepEqual(before.blocks.slice(0, 4), after.blocks.slice(0, 4));
  assert.equal(after.blocks.at(-1)?.kind, 'task-packet');
  assert.match(after.blocks.at(-1)?.content ?? '', /sciforge\.recovery-packet\.v1/);

  const compaction = buildCompactionRecordedEvent({
    sessionId: 'session-repair',
    sourceEventIds: ['conversation:turn-1', 'conversation:repair-needed'],
    decisionOwner: 'runtime',
    trigger: 'tail-budget',
    reason: 'stable state over budget',
    outputProjectionRefs: [{
      ref: '.sciforge/sessions/session-repair/projection/current.jsonl',
      kind: 'projection',
      digest: 'sha256:projection',
      sizeBytes: 128,
    }],
  });

  assertProjectEvent(compaction);
  assert.equal(compaction.kind, 'compaction-recorded');
  assert.equal(compaction.refs[0].digest, 'sha256:projection');
  assert.deepEqual(compaction.metadata?.sourceEventIds, ['conversation:turn-1', 'conversation:repair-needed']);
});

test('recovers active run, artifact index, failure index, and next handoff from ledger events only', () => {
  const projection = normalizeProjectSessionMemory({
    sessionId: 'session-recover',
    messages: [{ id: 'm1', role: 'user', content: 'recover the failed run' }],
    runs: [{
      id: 'run-failed',
      status: 'failed',
      outputRef: '.sciforge/sessions/session-recover/task-results/run-failed.json',
      stderrRef: '.sciforge/sessions/session-recover/logs/run-failed.stderr.log',
      failureReason: 'missing provider route',
    }],
    artifacts: [{
      id: 'partial-report',
      ref: '.sciforge/sessions/session-recover/artifacts/partial-report.md',
      preview: 'partial report',
    }],
  });

  const recovered = recoverProjectSessionProjection(projection.events);
  assert.equal(recovered.schemaVersion, 'sciforge.project-session-recovery-projection.v1');
  assert.equal(recovered.activeRunId, 'run-failed');
  assert.deepEqual(recovered.artifactIndex.map((ref) => ref.ref), [
    '.sciforge/sessions/session-recover/artifacts/partial-report.md',
  ]);
  assert.equal(recovered.failureIndex.at(-1)?.runId, 'run-failed');
  assert.equal(recovered.nextHandoffPacket.mode, 'repair-continuation');
  assert.ok(recovered.nextHandoffPacket.refs.some((ref) => ref.kind === 'stderr'));
  assert.deepEqual(recovered.nextHandoffPacket.retrievalTools, ['retrieve', 'read_ref', 'workspace_search']);
});

function assertProjectEvent(event: ProjectSessionEvent): void {
  assert.equal(event.schemaVersion, 'sciforge.project-session-event.v1');
  assert.ok(event.eventId);
  assert.ok(event.summary);
}
