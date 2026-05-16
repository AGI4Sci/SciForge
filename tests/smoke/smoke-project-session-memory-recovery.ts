import assert from 'node:assert/strict';

import {
  compileContextProjection,
  normalizeProjectSessionMemory,
  recoverProjectSessionProjection,
} from '../../src/runtime/project-session-memory.js';

const ledger = normalizeProjectSessionMemory({
  sessionId: 'session-psm-smoke',
  messages: [
    { id: 'm-start', role: 'user', content: 'Find recent agent reliability papers.' },
    { id: 'm-followup', role: 'user', content: 'Continue from the failed provider route.' },
  ],
  runs: [{
    id: 'run-provider-failed',
    status: 'failed',
    outputRef: '.sciforge/sessions/session-psm-smoke/task-results/provider-failed.json',
    stdoutRef: '.sciforge/sessions/session-psm-smoke/logs/provider.stdout.log',
    stderrRef: '.sciforge/sessions/session-psm-smoke/logs/provider.stderr.log',
    failureReason: 'provider route unavailable',
  }],
  artifacts: [{
    id: 'partial-report',
    ref: '.sciforge/sessions/session-psm-smoke/artifacts/partial-report.md',
    mime: 'text/markdown',
    preview: 'Partial evidence report.',
  }],
  verifications: [{
    id: 'verdict',
    ref: '.sciforge/sessions/session-psm-smoke/verifications/verdict.json',
    digest: 'sha256:verification',
    sizeBytes: 96,
  }],
});

const recovered = recoverProjectSessionProjection(ledger.events);
assert.equal(recovered.sessionId, 'session-psm-smoke');
assert.equal(recovered.activeRunId, 'run-provider-failed');
assert.equal(recovered.nextHandoffPacket.mode, 'repair-continuation');
assert.ok(recovered.artifactIndex.some((ref) => ref.ref.endsWith('partial-report.md')));
assert.ok(recovered.failureIndex.some((failure) => /provider route unavailable/.test(failure.summary)));
assert.ok(recovered.nextHandoffPacket.refs.some((ref) => ref.kind === 'stderr'));

const context = compileContextProjection({
  sessionId: ledger.sessionId,
  immutablePrefix: {
    runtimeContract: 'refs-first bounded handoff',
    toolPayloadContract: 'sciforge.toolPayload.v1',
  },
  workspaceIdentity: {
    cwd: '/workspace/SciForge',
    sessionBundleRef: '.sciforge/sessions/session-psm-smoke',
  },
  stableSessionState: {
    goal: 'finish agent reliability report',
    constraints: ['provider-first', 'do not replay full history'],
  },
  index: {
    eventIndex: ledger.events.map((event) => ({ eventId: event.eventId, kind: event.kind })),
    refIndex: ledger.refIndex.map((ref) => ({ ref: ref.ref, kind: ref.kind, digest: ref.digest })),
  },
  currentTaskPacket: recovered.nextHandoffPacket,
  sourceEventIds: {
    index: ledger.events.map((event) => event.eventId),
    currentTaskPacket: recovered.failureIndex.map((failure) => failure.eventId),
  },
});

const replayContext = compileContextProjection({
  sessionId: ledger.sessionId,
  immutablePrefix: {
    runtimeContract: 'refs-first bounded handoff',
    toolPayloadContract: 'sciforge.toolPayload.v1',
  },
  workspaceIdentity: {
    cwd: '/workspace/SciForge',
    sessionBundleRef: '.sciforge/sessions/session-psm-smoke',
  },
  stableSessionState: {
    goal: 'finish agent reliability report',
    constraints: ['provider-first', 'do not replay full history'],
  },
  index: {
    eventIndex: ledger.events.map((event) => ({ eventId: event.eventId, kind: event.kind })),
    refIndex: ledger.refIndex.map((ref) => ({ ref: ref.ref, kind: ref.kind, digest: ref.digest })),
  },
  currentTaskPacket: {
    ...recovered.nextHandoffPacket,
    refs: recovered.nextHandoffPacket.refs.slice(0, 1),
  },
});

assert.equal(context.stablePrefixHash, replayContext.stablePrefixHash);
assert.ok(context.uncachedTailTokens > 0);
assert.ok(context.blocks.some((block) => block.kind === 'task-packet' && block.cacheTier === 'tail'));

console.log('[ok] project session memory recovers active run, artifact/failure indexes, and cache-aware handoff from ledger refs');
