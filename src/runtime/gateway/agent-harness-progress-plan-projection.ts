import type { ProgressPlan } from '../../../packages/agent-harness/src/contracts.js';
import { isRecord } from '../gateway-utils.js';
import { projectInteractionProgressEvent } from './interaction-progress-harness.js';

const AGENT_HARNESS_PROGRESS_PLAN_PROJECTION_SCHEMA_VERSION = 'sciforge.agent-harness-progress-plan-projection.v1';

export function agentHarnessProgressPlanProjection(
  contract: Record<string, unknown>,
  input: {
    uiState: Record<string, unknown>;
    contractRef: string;
    traceRef: string;
    profileId: string;
  },
) {
  const agentHarness = isRecord(input.uiState.agentHarness) ? input.uiState.agentHarness : {};
  const enabled = [
    input.uiState.agentHarnessProgressPlanEnabled,
    input.uiState.agentHarnessConsumeProgressPlan,
    agentHarness.progressPlanEnabled,
    agentHarness.consumeProgressPlan,
  ].some(isEnabledFlag);
  if (!enabled) return undefined;
  const progressPlan = progressPlanFromContract(contract.progressPlan);
  if (!progressPlan) return undefined;
  const toolBudget = isRecord(contract.toolBudget) ? contract.toolBudget : {};
  const event = projectInteractionProgressEvent({
    progressPlan,
    type: 'process-progress',
    traceRef: input.traceRef,
    reason: 'progress-plan-projection',
    status: 'running',
    budget: {
      maxRetries: progressPlan.silencePolicy?.maxRetries,
      maxWallMs: numberField(toolBudget.maxWallMs),
    },
  });
  const audit = {
    schemaVersion: AGENT_HARNESS_PROGRESS_PLAN_PROJECTION_SCHEMA_VERSION,
    source: 'request.uiState.agentHarness.contract.progressPlan',
    contractRef: input.contractRef,
    traceRef: input.traceRef,
    profileId: input.profileId,
    eventType: event.type,
    phase: event.phase,
    status: event.status,
    initialStatus: progressPlan.initialStatus,
    visibleMilestones: progressPlan.visibleMilestones,
    phaseNames: progressPlan.phaseNames,
    silenceTimeoutMs: progressPlan.silenceTimeoutMs,
    silenceDecision: progressPlan.silencePolicy?.decision,
    backgroundContinuation: progressPlan.backgroundContinuation,
  };
  return {
    event: {
      type: event.type,
      source: 'workspace-runtime',
      status: event.status,
      message: progressPlan.initialStatus,
      detail: event.phase,
      raw: {
        ...event,
        progressPlan,
        agentHarnessProgressPlan: audit,
      },
    },
    audit,
  };
}

function progressPlanFromContract(value: unknown): ProgressPlan | undefined {
  if (!isRecord(value)) return undefined;
  const initialStatus = stringField(value.initialStatus);
  const silenceTimeoutMs = numberField(value.silenceTimeoutMs);
  const backgroundContinuation = booleanField(value.backgroundContinuation);
  if (!initialStatus || silenceTimeoutMs === undefined || backgroundContinuation === undefined) return undefined;
  const phaseNames = orderedStringListField(value.phaseNames);
  return {
    initialStatus,
    visibleMilestones: orderedStringListField(value.visibleMilestones),
    phaseNames: phaseNames.length ? phaseNames : undefined,
    silenceTimeoutMs,
    backgroundContinuation,
    silencePolicy: isRecord(value.silencePolicy) ? value.silencePolicy as unknown as ProgressPlan['silencePolicy'] : undefined,
    backgroundPolicy: isRecord(value.backgroundPolicy) ? value.backgroundPolicy as unknown as ProgressPlan['backgroundPolicy'] : undefined,
    cancelPolicy: isRecord(value.cancelPolicy) ? value.cancelPolicy as unknown as ProgressPlan['cancelPolicy'] : undefined,
    interactionPolicy: isRecord(value.interactionPolicy) ? value.interactionPolicy as unknown as ProgressPlan['interactionPolicy'] : undefined,
  };
}

function isEnabledFlag(value: unknown) {
  return value === true || ['1', 'true', 'on', 'enabled'].includes(String(value).trim().toLowerCase());
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanField(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function orderedStringListField(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
