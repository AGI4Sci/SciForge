import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

import {
  appendConversationEvent,
  classifyFailureOwner,
  createConversationEventLog,
  projectConversation,
  replayConversationState,
  type ConversationEvent,
  type ConversationEventLog,
} from '../../src/runtime/conversation-kernel/index.js';
import {
  attachTaskOutcomeProjection,
  materializeTaskOutcomeProjection,
} from '../../src/runtime/gateway/task-outcome-projection.js';

const root = process.cwd();
let eventSecond = 0;

const externalFailure = classifyFailureOwner({
  reason: 'HTTP 429 rate limit from external provider after provider timeout.',
  evidenceRefs: ['log:provider-stderr'],
});

assert.equal(externalFailure.ownerLayer, 'external-provider');
assert.equal(externalFailure.action, 'retry-after-backoff');
assert.equal(externalFailure.retryable, true);
assert.notEqual(
  externalFailure.action,
  'repair-rerun',
  'external-provider failures must not enter code repair as the first action',
);
assert.doesNotMatch(
  externalFailure.nextStep,
  /\b(?:code|patch|regenerate task code)\b/i,
  'external-provider next step must preserve refs and wait/switch provider, not request code repair',
);

const externalLog = appendAll(createConversationEventLog('smoke-external-provider'), [
  inlineEvent('turn-ext', 'TurnReceived', { prompt: 'fetch papers from an external API' }, { turnId: 't-ext' }),
  inlineEvent('dispatch-ext', 'Dispatched', { summary: 'dispatched provider-backed capability' }, { turnId: 't-ext', runId: 'run-ext' }),
  refEvent('blocked-ext', 'ExternalBlocked', {
    reason: 'Remote end closed connection without response after timeout',
    summary: 'provider transport failed',
    refs: [{ ref: 'log:provider-stderr', digest: 'sha256:provider' }],
  }, { turnId: 't-ext', runId: 'run-ext' }),
]);
const externalState = replayConversationState(externalLog);
const externalProjection = projectConversation(externalLog);

assert.equal(externalState.status, 'external-blocked');
assert.equal(externalState.failureOwner?.ownerLayer, 'external-provider');
assert.equal(externalState.failureOwner?.action, 'retry-after-backoff');
assert.equal(externalProjection.visibleAnswer?.status, 'external-blocked');
assert.equal(externalProjection.activeRun?.id, 'run-ext');
assert.deepEqual(externalProjection.auditRefs, ['log:provider-stderr']);
assert.equal(
  externalProjection.recoverActions.some((action) => /\bcode repair\b|\bpatch\b/i.test(action)),
  false,
  'external-blocked projection must not present code repair as the recovery action',
);

const replayLog = appendAll(createConversationEventLog('smoke-replay-projection'), [
  inlineEvent('turn-replay', 'TurnReceived', { prompt: 'summarize retained evidence refs' }, { turnId: 't-replay' }),
  inlineEvent('planned-replay', 'Planned', { summary: 'plan from harness decision' }, { turnId: 't-replay' }),
  inlineEvent('dispatch-replay', 'Dispatched', { summary: 'dispatch generated task' }, { turnId: 't-replay', runId: 'run-replay' }),
  refEvent('partial-replay', 'PartialReady', {
    summary: 'partial answer materialized',
    refs: [{ ref: 'artifact:partial-answer', digest: 'sha256:partial', mime: 'text/markdown', sizeBytes: 128 }],
  }, { turnId: 't-replay', runId: 'run-replay' }),
  refEvent('output-replay', 'OutputMaterialized', {
    summary: 'final report materialized',
    refs: [{ ref: 'artifact:final-report', digest: 'sha256:report', mime: 'text/markdown', sizeBytes: 512 }],
  }, { turnId: 't-replay', runId: 'run-replay' }),
  refEvent('verify-replay', 'VerificationRecorded', {
    verdict: 'supported',
    summary: 'verifier evidence saved',
    refs: [{ ref: 'artifact:verification-evidence', digest: 'sha256:verify', mime: 'application/json', sizeBytes: 96 }],
  }, { turnId: 't-replay', runId: 'run-replay' }),
  refEvent('satisfied-replay', 'Satisfied', {
    text: 'Answer is available from retained refs.',
    summary: 'satisfied with refs',
    refs: [{ ref: 'artifact:final-report', digest: 'sha256:report', mime: 'text/markdown', sizeBytes: 512 }],
  }, { turnId: 't-replay', runId: 'run-replay' }),
]);

const replayState = replayConversationState(replayLog);
const replayProjection = projectConversation(replayLog);
const replayProjectionAgain = projectConversation(replayLog, replayState);

assert.deepEqual(replayProjectionAgain, replayProjection, 'projection must replay deterministically from the event log');
assert.equal(replayProjection.schemaVersion, 'sciforge.conversation-projection.v1');
assert.equal(replayProjection.currentTurn?.id, 't-replay');
assert.equal(replayProjection.currentTurn?.prompt, 'summarize retained evidence refs');
assert.deepEqual(replayProjection.activeRun, { id: 'run-replay', status: 'satisfied' });
assert.equal(replayProjection.visibleAnswer?.text, 'Answer is available from retained refs.');
assert.deepEqual(replayProjection.visibleAnswer?.artifactRefs, ['artifact:final-report']);
assert.equal(replayProjection.verificationState.status, 'verified');
assert.equal(replayProjection.verificationState.verifierRef, 'artifact:verification-evidence');
assert.deepEqual(
  replayProjection.auditRefs,
  ['artifact:partial-answer', 'artifact:final-report', 'artifact:verification-evidence'],
);
assert.equal(replayProjection.executionProcess.length, replayLog.events.length);
assert.deepEqual(
  replayProjection.artifacts.map((ref) => ref.ref),
  ['artifact:partial-answer', 'artifact:final-report', 'artifact:verification-evidence'],
);

const backgroundLog = appendAll(createConversationEventLog('smoke-background-recorded'), [
  inlineEvent('turn-bg', 'TurnReceived', { prompt: 'return a partial answer and continue verification' }, { turnId: 't-bg' }),
  refEvent('bg-running', 'BackgroundRunning', {
    summary: 'background revision continues from checkpoint',
    refs: [
      { ref: 'artifact:bg-partial-answer', digest: 'sha256:bgpartial', mime: 'text/markdown', sizeBytes: 128 },
      { ref: 'checkpoint:bg-revision-1', digest: 'sha256:bgcheckpoint', mime: 'application/json', sizeBytes: 96 },
    ],
    revisionPlan: 'verify remaining claims and merge a revised answer',
    foregroundPartialRef: 'artifact:bg-partial-answer',
  }, { turnId: 't-bg', runId: 'run-bg' }),
]);
const backgroundProjection = projectConversation(backgroundLog);
assert.equal(backgroundProjection.activeRun?.status, 'background-running');
assert.equal(backgroundProjection.backgroundState?.revisionPlan, 'verify remaining claims and merge a revised answer');
assert.equal(backgroundProjection.backgroundState?.foregroundPartialRef, 'artifact:bg-partial-answer');
assert.deepEqual(
  backgroundProjection.backgroundState?.checkpointRefs,
  ['artifact:bg-partial-answer', 'checkpoint:bg-revision-1'],
);

const recordedOnlyLog = appendAll(createConversationEventLog('smoke-recorded-only'), [
  inlineEvent('turn-recorded-only', 'TurnReceived', { prompt: 'show final answer' }, { turnId: 't-recorded' }),
  inlineEvent('satisfied-recorded-only', 'Satisfied', {
    text: 'Done.',
    verificationRef: 'artifact:unrecorded-verification',
    backgroundState: {
      checkpointRefs: ['checkpoint:unrecorded'],
      revisionPlan: 'not a kernel event',
    },
  }, { turnId: 't-recorded', runId: 'run-recorded' }),
]);
const recordedOnlyProjection = projectConversation(recordedOnlyLog);
assert.equal(recordedOnlyProjection.verificationState.status, 'unverified');
assert.equal(recordedOnlyProjection.verificationState.verifierRef, undefined);
assert.equal(recordedOnlyProjection.backgroundState, undefined);

const gatewayProjection = materializeTaskOutcomeProjection({
  payload: {
    message: 'Partial result is available; final report still needs verifier evidence.',
    confidence: 0.7,
    claimType: 'result',
    evidenceLevel: 'medium',
    reasoningTrace: 'runtime trace',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'gateway-run', status: 'done', tool: 'workspace-task', nextStep: 'Supplement verifier evidence from preserved refs.' }],
    artifacts: [{ id: 'partial-report', type: 'research-report', title: 'Partial report', dataRef: '.sciforge/task-results/partial-report.md' }],
  },
  refs: {
    outputRel: '.sciforge/task-results/gateway-output.json',
  },
  request: {
    skillDomain: 'knowledge',
    prompt: 'Produce a verified report.',
    expectedArtifactTypes: ['verified-report'],
    artifacts: [],
  },
});

assert.equal(gatewayProjection.conversationEventLog.schemaVersion, 'sciforge.conversation-event-log.v1');
assert.match(gatewayProjection.conversationEventLogDigest, /^sha256:/);
assert.equal(gatewayProjection.conversationEventLogRef, '.sciforge/task-results/gateway-output.json#displayIntent.conversationEventLog');
assert.equal(gatewayProjection.projectionRestore.source, 'conversation-event-log');
assert.equal(gatewayProjection.projectionRestore.eventCount, gatewayProjection.conversationEventLog.events.length);
assert.equal(gatewayProjection.conversationProjection.visibleAnswer?.status, 'degraded-result');

const restoredPayload = attachTaskOutcomeProjection({
  message: 'Projection restore should ignore this stale satisfied status.',
  confidence: 0.7,
  claimType: 'result',
  evidenceLevel: 'medium',
  reasoningTrace: 'runtime trace',
  claims: [],
  uiManifest: [],
  executionUnits: [],
  artifacts: [],
  displayIntent: {
    taskOutcomeProjection: {
      ...gatewayProjection,
      conversationProjection: {
        ...gatewayProjection.conversationProjection,
        visibleAnswer: {
          ...gatewayProjection.conversationProjection.visibleAnswer,
          status: 'satisfied',
        },
      },
    },
    conversationProjection: {
      ...gatewayProjection.conversationProjection,
      visibleAnswer: {
        ...gatewayProjection.conversationProjection.visibleAnswer,
        status: 'satisfied',
      },
    },
    conversationEventLog: gatewayProjection.conversationEventLog,
    conversationEventLogRef: gatewayProjection.conversationEventLogRef,
  },
});
const restoredOutcome = (restoredPayload.displayIntent as Record<string, any>).taskOutcomeProjection;
const restoredDisplayProjection = (restoredPayload.displayIntent as Record<string, any>).conversationProjection;
assert.equal(restoredOutcome.conversationProjection.visibleAnswer.status, 'degraded-result');
assert.equal(restoredDisplayProjection.visibleAnswer.status, 'degraded-result');
assert.equal(restoredOutcome.conversationEventLogDigest, gatewayProjection.conversationEventLogDigest);

const uiBridge = await findUiProjectionBridgeEvidence();
assert.ok(
  uiBridge.files.length > 0,
  [
    'UI main state must consume ConversationProjection through a projection bridge.',
    'Expected at least one src/ui/src .ts/.tsx file to import/mention ConversationProjection or sciforge.conversation-projection.v1.',
    'Current main UI still appears to derive state from session/runs directly instead of the kernel projection.',
  ].join(' '),
);

for (const field of ['currentTurn', 'visibleAnswer', 'activeRun', 'artifacts', 'executionProcess', 'recoverActions', 'verificationState', 'backgroundState']) {
  assert.ok(
    uiBridge.text.includes(field),
    `UI projection bridge must map ConversationProjection.${field}`,
  );
}

console.log(`[ok] conversation kernel final-shape smoke passed: external-provider repair routing, replay projection, recorded background/verification contracts, UI projection bridge (${uiBridge.files.join(', ')})`);

function appendAll(log: ConversationEventLog, events: ConversationEvent[]): ConversationEventLog {
  let next = log;
  for (const event of events) {
    const result = appendConversationEvent(next, event);
    assert.equal(result.rejected, undefined, `${event.id} should append cleanly: ${result.rejected?.message ?? ''}`);
    next = result.log;
  }
  return next;
}

function inlineEvent(
  id: string,
  type: ConversationEvent['type'],
  payload: Record<string, unknown>,
  ids: { turnId?: string; runId?: string } = {},
): ConversationEvent {
  return {
    id,
    type,
    storage: 'inline',
    actor: 'kernel',
    timestamp: `2026-05-13T00:00:${String(eventSecond++).padStart(2, '0')}.000Z`,
    ...ids,
    payload,
  };
}

function refEvent(
  id: string,
  type: ConversationEvent['type'],
  payload: Extract<ConversationEvent, { storage: 'ref' }>['payload'],
  ids: { turnId?: string; runId?: string } = {},
): ConversationEvent {
  return {
    id,
    type,
    storage: 'ref',
    actor: 'runtime',
    timestamp: `2026-05-13T00:00:${String(eventSecond++).padStart(2, '0')}.000Z`,
    ...ids,
    payload,
  };
}

async function findUiProjectionBridgeEvidence() {
  const uiRoot = join(root, 'src/ui/src');
  const files = await collectSourceFiles(uiRoot);
  const matches: Array<{ rel: string; text: string }> = [];
  for (const file of files) {
    if (/\.(?:test|spec)\.tsx?$/.test(file)) continue;
    const text = await readFile(file, 'utf8');
    if (/\bConversationProjection\b|sciforge\.conversation-projection\.v1/.test(text)) {
      matches.push({ rel: relative(root, file).replaceAll('\\', '/'), text });
    }
  }
  return {
    files: matches.map((match) => match.rel).sort(),
    text: matches.map((match) => match.text).join('\n'),
  };
}

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await collectSourceFiles(full));
      continue;
    }
    if (entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name))) out.push(full);
  }
  return out;
}
