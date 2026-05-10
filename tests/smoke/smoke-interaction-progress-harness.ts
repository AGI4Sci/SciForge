import assert from 'node:assert/strict';

import { createHarnessRuntime } from '../../packages/agent-harness/src/runtime';
import type { WorkspaceRuntimeEvent } from '../../src/runtime/runtime-types';
import {
  STANDARD_INTERACTION_PROGRESS_EVENT_TYPES,
  projectInteractionProgressEvent,
  projectRunStateFromInteractionProgressEvent,
} from '../../src/runtime/gateway/interaction-progress-harness';

const privatePromptText = 'PRIVATE_PROMPT_TEXT_progress_harness_should_not_emit';
const privateScenarioText = 'PRIVATE_SCENARIO_TEXT_progress_harness_should_not_emit';

const runtime = createHarnessRuntime();
const { contract } = await runtime.evaluate({
  requestId: 'smoke-interaction-progress',
  prompt: `Run a long task that may require clarification, approval, cancellation, or queued guidance. ${privatePromptText}`,
});
const plan = contract.progressPlan;

assert.equal(plan.initialStatus, 'Planning request');
assert.deepEqual(plan.phaseNames, ['context', 'capabilities', 'verification']);
assert.equal(plan.silencePolicy?.decision, 'visible-status');
assert.equal(plan.silencePolicy?.timeoutMs, plan.silenceTimeoutMs);
assert.equal(plan.backgroundPolicy?.enabled, false);
assert.equal(plan.cancelPolicy?.userCancellation, 'user-cancelled');
assert.equal(plan.cancelPolicy?.systemAbort, 'system-aborted');
assert.equal(plan.cancelPolicy?.timeout, 'timeout');
assert.equal(plan.cancelPolicy?.backendError, 'backend-error');
assert.equal(plan.interactionPolicy?.humanApproval, 'allow');
assert.deepEqual(STANDARD_INTERACTION_PROGRESS_EVENT_TYPES, [
  'process-progress',
  'interaction-request',
  'clarification-needed',
  'human-approval-required',
  'guidance-queued',
  'run-cancelled',
]);

const silentProgress = projectInteractionProgressEvent({
  progressPlan: plan,
  type: 'process-progress',
  requestId: 'smoke-interaction-progress',
  reason: 'silence-policy-visible-status',
  budget: {
    elapsedMs: plan.silencePolicy?.timeoutMs,
    retryCount: 0,
    maxRetries: plan.silencePolicy?.maxRetries,
    maxWallMs: contract.toolBudget.maxWallMs,
  },
});
assert.equal(silentProgress.schemaVersion, 'sciforge.interaction-progress-event.v1');
assert.equal(silentProgress.type, 'process-progress');
assert.equal(silentProgress.phase, 'context');
assert.equal(silentProgress.status, 'running');
assert.equal(projectRunStateFromInteractionProgressEvent(silentProgress), 'running');

const genericRuntimeEvent = consumeGenericRuntimeEvent(silentProgress);
assert.equal(genericRuntimeEvent.type, 'process-progress');
assert.equal(genericRuntimeEvent.status, 'running');
assert.equal(genericRuntimeEvent.hasPromptLikeText, false);
assert.equal(JSON.stringify(silentProgress).includes(privatePromptText), false);
assert.equal(JSON.stringify(silentProgress).includes(privateScenarioText), false);

const humanApproval = projectInteractionProgressEvent({
  progressPlan: plan,
  type: 'human-approval-required',
  reason: 'side-effect-policy',
});
assert.equal(humanApproval.runState, 'awaiting-interaction');
assert.equal(humanApproval.importance, 'blocking');
assert.equal(humanApproval.interaction?.kind, 'human-approval');
assert.equal(humanApproval.interaction?.required, true);

const guidanceQueued = projectInteractionProgressEvent({
  progressPlan: plan,
  type: 'guidance-queued',
  reason: 'mid-run-user-guidance',
});
assert.equal(guidanceQueued.runState, 'guidance-queued');
assert.equal(guidanceQueued.interaction?.kind, 'guidance');
assert.equal(guidanceQueued.interaction?.required, false);

const cancellationCases = [
  ['user-cancelled', 'cancelled'],
  ['system-aborted', 'cancelled'],
  ['timeout', 'cancelled'],
  ['backend-error', 'failed'],
] as const;

for (const [cancellationReason, runState] of cancellationCases) {
  const event = projectInteractionProgressEvent({
    progressPlan: plan,
    type: 'run-cancelled',
    cancellationReason,
    reason: cancellationReason,
  });
  assert.equal(event.type, 'run-cancelled');
  assert.equal(event.cancellationReason, cancellationReason);
  assert.equal(event.status, 'cancelled');
  assert.equal(event.runState, runState);
  assert.equal(projectRunStateFromInteractionProgressEvent(event), runState);
}

const clarification = projectInteractionProgressEvent({
  progressPlan: plan,
  type: 'clarification-needed',
});
assert.equal(clarification.runState, 'awaiting-interaction');
assert.equal(clarification.interaction?.kind, 'clarification');

console.log('[ok] interaction/progress harness contract projects stable events and run states');

function consumeGenericRuntimeEvent(event: WorkspaceRuntimeEvent) {
  return {
    type: event.type,
    status: event.status,
    hasPromptLikeText: [event.message, event.detail, event.text, event.output]
      .filter((value): value is string => typeof value === 'string')
      .some((value) => value.includes(privatePromptText) || value.includes(privateScenarioText)),
  };
}
