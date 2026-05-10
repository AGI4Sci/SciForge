import assert from 'node:assert/strict';

import { createHarnessRuntime } from '../../packages/agent-harness/src/runtime';
import type { WorkspaceRuntimeEvent } from '../../src/runtime/runtime-types';
import { requestWithAgentHarnessShadow } from '../../src/runtime/gateway/agent-harness-shadow';
import { normalizeGatewayRequest } from '../../src/runtime/gateway/gateway-request';
import {
  STANDARD_INTERACTION_PROGRESS_EVENT_TYPES,
  projectInteractionProgressEvent,
  projectRunStateFromInteractionProgressEvent,
} from '../../src/runtime/gateway/interaction-progress-harness';
import { progressModelFromEvent } from '../../src/ui/src/processProgress';

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
  ['user-cancelled', 'cancelled', 'cancelled', 'user', false],
  ['system-aborted', 'cancelled', 'cancelled', 'system', true],
  ['timeout', 'cancelled', 'cancelled', 'system', true],
  ['backend-error', 'failed', 'failed', 'backend', true],
] as const;

for (const [cancellationReason, runState, status, actor, retryable] of cancellationCases) {
  const event = projectInteractionProgressEvent({
    progressPlan: plan,
    type: 'run-cancelled',
    cancellationReason,
    reason: cancellationReason,
  });
  assert.equal(event.type, 'run-cancelled');
  assert.equal(event.cancellationReason, cancellationReason);
  assert.equal(event.status, status);
  assert.equal(event.runState, runState);
  assert.equal(event.termination?.schemaVersion, 'sciforge.run-termination.v1');
  assert.equal(event.termination?.reason, cancellationReason);
  assert.equal(event.termination?.actor, actor);
  assert.equal(event.termination?.progressStatus, status);
  assert.equal(event.termination?.retryable, retryable);
  assert.equal(projectRunStateFromInteractionProgressEvent(event), runState);
}

const clarification = projectInteractionProgressEvent({
  progressPlan: plan,
  type: 'clarification-needed',
});
assert.equal(clarification.runState, 'awaiting-interaction');
assert.equal(clarification.interaction?.kind, 'clarification');

const gatewayRequest = normalizeGatewayRequest({
  skillDomain: 'literature',
  prompt: `Project progressPlan through gateway shadow. ${privatePromptText}`,
  workspacePath: process.cwd(),
  expectedArtifactTypes: ['research-report'],
  selectedComponentIds: ['report-viewer'],
  artifacts: [],
});

const defaultGatewayEvents: WorkspaceRuntimeEvent[] = [];
const defaultGatewayRequest = await requestWithAgentHarnessShadow({
  ...gatewayRequest,
  uiState: {
    harnessProfileId: 'balanced-default',
  },
}, { onEvent: (event) => defaultGatewayEvents.push(event) }, { status: 'applied' });
assert.equal(defaultGatewayRequest.uiState?.agentHarnessProgressPlan, undefined);
assert.equal(defaultGatewayEvents.some(isProgressPlanRuntimeEvent), false);

const optInGatewayEvents: WorkspaceRuntimeEvent[] = [];
const optInGatewayRequest = await requestWithAgentHarnessShadow({
  ...gatewayRequest,
  uiState: {
    harnessProfileId: 'balanced-default',
    agentHarnessConsumeProgressPlan: true,
  },
}, { onEvent: (event) => optInGatewayEvents.push(event) }, { status: 'applied' });
const runtimeProjection = optInGatewayEvents.find(isProgressPlanRuntimeEvent);
const runtimeProjectionRaw = isRecord(runtimeProjection?.raw) ? runtimeProjection.raw : {};
const runtimeProjectionAudit = isRecord(runtimeProjectionRaw.agentHarnessProgressPlan)
  ? runtimeProjectionRaw.agentHarnessProgressPlan
  : {};
const uiStateAudit = optInGatewayRequest.uiState?.agentHarnessProgressPlan as Record<string, unknown> | undefined;
assert.equal(runtimeProjection?.type, 'process-progress');
assert.equal(runtimeProjectionRaw.schemaVersion, 'sciforge.interaction-progress-event.v1');
assert.equal(runtimeProjectionRaw.reason, 'progress-plan-projection');
assert.equal(runtimeProjectionAudit.schemaVersion, 'sciforge.agent-harness-progress-plan-projection.v1');
assert.equal(uiStateAudit?.schemaVersion, 'sciforge.agent-harness-progress-plan-projection.v1');
assert.equal(uiStateAudit?.contractRef, runtimeProjectionAudit.contractRef);
assert.equal(JSON.stringify(runtimeProjection).includes(privatePromptText), false);
const projectedModel = progressModelFromEvent(runtimeProjection as Parameters<typeof progressModelFromEvent>[0]);
assert.equal(projectedModel?.status, 'running');
assert.equal(projectedModel?.reason, 'progress-plan-projection');

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

function isProgressPlanRuntimeEvent(event: WorkspaceRuntimeEvent | undefined): event is WorkspaceRuntimeEvent {
  return event?.type === 'process-progress'
    && isRecord(event.raw)
    && isRecord(event.raw.agentHarnessProgressPlan);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
