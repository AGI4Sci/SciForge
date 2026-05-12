import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceTaskRunResult } from '../runtime-types.js';
import { skillRuntimeRoutePolicy } from '../../../packages/skills/runtime-policy';
import { isRecord } from '../gateway-utils.js';
import { sessionBundleRelForRequest } from '../session-bundle.js';
import { agentServerBackend } from './agent-backend-config.js';

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function attemptPlanRefs(request: GatewayRequest, skill?: SkillAvailability, fallbackReason?: string) {
  const sessionBundleRef = sessionBundleRelForRequest(request);
  return {
    scenarioPackageRef: request.scenarioPackageRef,
    skillPlanRef: request.skillPlanRef,
    uiPlanRef: request.uiPlanRef,
    sessionId: stringField(request.uiState?.sessionId),
    sessionBundleRef,
    runtimeProfileId: runtimeProfileIdForRequest(request, skill),
    routeDecision: {
      selectedSkill: skill?.id,
      selectedRuntime: selectedRuntimeForSkill(skill),
      fallbackReason,
      selectedAt: new Date().toISOString(),
    },
  };
}

export function runtimeProfileIdForRequest(request: GatewayRequest, skill?: SkillAvailability) {
  return routePolicyForRequest(request, skill).runtimeProfileId;
}

export function selectedRuntimeForSkill(skill?: SkillAvailability) {
  return routePolicyForRequest(undefined, skill).selectedRuntime;
}

function routePolicyForRequest(request?: GatewayRequest, skill?: SkillAvailability) {
  return skillRuntimeRoutePolicy({
    entrypoint: skill?.manifest.entrypoint,
    scenarioPackageSource: request?.scenarioPackageRef?.source,
    agentServerRuntimeProfileId: request ? `agentserver-${agentServerBackend(request, request.llmEndpoint)}` : undefined,
  });
}

export function payloadHasFailureStatus(payload: ToolPayload) {
  if (String(payload.claimType || '').toLowerCase().includes('error')) return true;
  return (Array.isArray(payload.executionUnits) ? payload.executionUnits : [])
    .some((unit) => isRecord(unit) && /failed|error/i.test(String(unit.status || '')));
}

export function firstPayloadFailureReason(payload: ToolPayload, run?: WorkspaceTaskRunResult) {
  const units = Array.isArray(payload.executionUnits) ? payload.executionUnits : [];
  const unit = units.find((entry) => isRecord(entry) && /failed|error/i.test(String(entry.status || '')));
  const unitReason = isRecord(unit) ? stringField(unit.failureReason) ?? stringField(unit.error) ?? stringField(unit.message) : undefined;
  return unitReason
    ?? (typeof run?.exitCode === 'number' && run.exitCode !== 0 ? stringField(run?.stderr) ?? `Task exited ${run.exitCode}.` : undefined);
}

export function activeGuidanceQueueForTaskInput(request: GatewayRequest) {
  const handoff = isRecord(request.uiState?.taskProjectHandoff) ? request.uiState.taskProjectHandoff : undefined;
  const queue = Array.isArray(handoff?.userGuidanceQueue)
    ? handoff.userGuidanceQueue
    : Array.isArray(request.uiState?.userGuidanceQueue)
      ? request.uiState.userGuidanceQueue
      : Array.isArray(request.uiState?.guidanceQueue)
        ? request.uiState.guidanceQueue
        : [];
  return queue.filter((entry): entry is Record<string, unknown> => isRecord(entry)
    && typeof entry.id === 'string'
    && (entry.status === 'queued' || entry.status === 'deferred'));
}
