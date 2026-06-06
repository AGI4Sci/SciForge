import {
  capabilityAnswerProjection,
  defaultCapabilityQuestion,
  defaultGuiOperationIntent,
  defaultAuthorizationProfile,
  evaluateComputerUsePreflight,
  RUNTIME_GUI_COMPONENT_ID,
  type RuntimeReadinessValue,
} from '../../packages/contracts/runtime/default-browser-computer-use-policy.js';
import type { GatewayRequest, ToolPayload } from './runtime-types.js';
import { sha1 } from './workspace-task-runner.js';

const TOOL_ID = 'browser-computer-use-capability-truth' as const;

export function tryRunBrowserComputerUseCapabilityRuntime(request: GatewayRequest): ToolPayload | undefined {
  const capability = defaultCapabilityQuestion(request.prompt);
  if (capability) return capabilityAnswerPayload(request, capability);
  if (explicitVisionSenseRuntimeSelected(request)) return undefined;
  if (!defaultGuiOperationIntent({
    prompt: request.prompt,
    selectedToolIds: request.selectedToolIds,
    selectedSkillIds: request.selectedSkillIds,
    availableSkills: request.availableSkills,
  })) return undefined;
  return computerUsePreflightPayload(request);
}

function explicitVisionSenseRuntimeSelected(request: GatewayRequest): boolean {
  const uiState = typeof request.uiState === 'object' && request.uiState !== null
    ? request.uiState as Record<string, unknown>
    : {};
  const selected = [
    ...(request.selectedToolIds ?? []),
    ...stringArray(uiState.selectedToolIds),
    ...stringArray(uiState.selectedSenseIds),
  ];
  return selected.some((id) => id === 'local.vision-sense' || id === 'observe.vision');
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function capabilityAnswerPayload(request: GatewayRequest, capability: 'browser' | 'computer-use'): ToolPayload {
  const readiness = readinessFromRequest(request);
  const projection = capabilityAnswerProjection({
    capability,
    readiness,
    refs: capabilityTruthRefs(request),
  });
  const id = sha1(JSON.stringify({ capability, readiness, refs: projection.refs })).slice(0, 12);
  return {
    message: projection.answerSummary,
    confidence: 0.78,
    claimType: 'runtime-diagnostic',
    evidenceLevel: 'runtime',
    reasoningTrace: 'SciForge answered capability status from runtime readiness, capability refs, and product policy; it did not use fixed denial text.',
    displayIntent: {
      protocolStatus: projection.runtimeReadiness === 'ready' ? 'protocol-success' : 'protocol-blocked',
      taskOutcome: projection.runtimeReadiness === 'ready' ? 'satisfied' : 'needs-work',
      status: projection.runtimeReadiness === 'ready' ? 'completed' : 'blocked',
    },
    claims: [{
      id: `claim-capability-answer-${id}`,
      type: 'diagnostic',
      text: projection.answerSummary,
      confidence: 0.78,
      evidenceLevel: 'runtime',
      supportingRefs: projection.refs,
      opposingRefs: [],
    }],
    uiManifest: [],
    executionUnits: [{
      id: `EU-capability-answer-${id}`,
      tool: TOOL_ID,
      status: projection.runtimeReadiness === 'ready' ? 'done' : 'failed-with-reason',
      params: JSON.stringify({ capability }),
      failureReason: projection.blockers.length ? projection.blockers.join(', ') : undefined,
      outputRef: `artifact:capability-answer-${id}`,
      hash: id,
    }],
    artifacts: [{
      id: `capability-answer-${id}`,
      type: 'runtime-capability-answer',
      producerScenario: request.skillDomain,
      schemaVersion: projection.schemaVersion,
      metadata: {
        source: TOOL_ID,
        capability,
        runtimeReadiness: projection.runtimeReadiness,
      },
      data: projection,
    }],
  };
}

function computerUsePreflightPayload(request: GatewayRequest): ToolPayload {
  const readiness = readinessFromRequest(request);
  const preflight = evaluateComputerUsePreflight({
    intent: request.prompt,
    target: targetFromRequest(request),
    readiness,
    observation: observationFromRequest(request),
    permissions: permissionsFromRequest(request),
    authorizationProfile: defaultAuthorizationProfile(),
  });
  const id = sha1(JSON.stringify({ prompt: request.prompt, preflight })).slice(0, 12);
  const blockers = preflight.blockers.map((item) => item.reason).join(', ');
  const message = preflight.status === 'ready'
    ? `Computer Use preflight ready for ${preflight.target.summary}.`
    : preflight.status === 'needs-confirmation'
      ? `Computer Use requires hard confirmation before acting on ${preflight.target.summary}: ${preflight.risk.reason}.`
      : `Computer Use preflight blocked: ${blockers}. ${preflight.blockers[0]?.recovery ?? 'Repair blockers and retry.'}`;
  return {
    message,
    confidence: preflight.status === 'ready' ? 0.82 : 0.7,
    claimType: preflight.status === 'ready' ? 'runtime-readiness' : 'runtime-diagnostic',
    evidenceLevel: 'runtime',
    reasoningTrace: 'SciForge routed GUI-operation intent through Agent Host Computer Use preflight and failed closed when readiness, target, observation, permission, or cancel path was missing.',
    displayIntent: {
      protocolStatus: preflight.status === 'ready' ? 'protocol-success' : preflight.status === 'needs-confirmation' ? 'protocol-paused' : 'protocol-blocked',
      taskOutcome: preflight.status === 'ready' ? 'satisfied' : 'needs-work',
      status: preflight.status,
      computerUsePreflight: preflight,
    },
    claims: [{
      id: `claim-computer-use-preflight-${id}`,
      type: 'diagnostic',
      text: message,
      confidence: 0.7,
      evidenceLevel: 'runtime',
      supportingRefs: preflight.evidenceRefs,
      opposingRefs: [],
    }],
    uiManifest: preflight.confirmation ? [{
      componentId: RUNTIME_GUI_COMPONENT_ID,
      artifactRef: `computer-use-preflight-${id}`,
      title: 'Computer Use confirmation',
      priority: 1,
    }] : [],
    executionUnits: [{
      id: `EU-computer-use-preflight-${id}`,
      tool: TOOL_ID,
      status: preflight.status === 'ready' ? 'done' : preflight.status === 'needs-confirmation' ? 'needs-human' : 'failed-with-reason',
      params: JSON.stringify({ intent: request.prompt, authorizationProfile: preflight.authorizationProfile.id }),
      failureReason: preflight.status === 'blocked' ? blockers : undefined,
      outputRef: `artifact:computer-use-preflight-${id}`,
      hash: id,
    }],
    artifacts: [{
      id: `computer-use-preflight-${id}`,
      type: 'computer-use-preflight',
      producerScenario: request.skillDomain,
      schemaVersion: preflight.schemaVersion,
      metadata: {
        source: TOOL_ID,
        status: preflight.status,
        authorizationProfile: preflight.authorizationProfile.id,
      },
      data: preflight,
    }],
  };
}

function readinessFromRequest(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const source = firstRecord(
    uiState.browserComputerUseCapabilityTruth,
    uiState.capabilityReadiness,
    uiState.runtimeReadiness,
  );
  const readiness = isRecord(source?.readiness) ? source.readiness : source;
  return {
    browserHostSession: readinessValue(readiness?.browserHostSession),
    nativeBridge: readinessValue(readiness?.nativeBridge),
    nativeSurface: readinessValue(readiness?.nativeSurface),
    windowActionSession: readinessValue(readiness?.windowActionSession),
    computerUseAdapter: readinessValue(readiness?.computerUseAdapter),
  };
}

function readinessValue(value: unknown): RuntimeReadinessValue {
  if (value === true || value === 'ready') return 'ready';
  if (value === false || value === 'blocked' || value === 'unavailable' || value === 'missing') return 'blocked';
  return 'blocked';
}

function targetFromRequest(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const target = firstRecord(uiState.computerUseTarget, uiState.windowActionTarget, uiState.currentTarget);
  const refs = [
    ...stringList(target?.refs),
    ...stringList(target?.evidenceRefs),
    ...stringList(target?.targetRefs),
  ];
  return {
    bound: target?.bound === true || refs.length > 0,
    summary: stringField(target?.summary) ?? stringField(target?.title) ?? 'Unbound target',
    refs,
  };
}

function observationFromRequest(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const observation = firstRecord(uiState.freshObservation, uiState.computerUseObservation, uiState.currentObservation);
  const refs = [
    ...stringList(observation?.refs),
    ...stringList(observation?.evidenceRefs),
    ...stringList(observation?.screenshotRefs),
  ];
  return {
    fresh: observation?.fresh === true || observation?.status === 'fresh',
    refs,
  };
}

function permissionsFromRequest(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const permissions = firstRecord(uiState.computerUsePermissions, uiState.permissions, uiState.authorization);
  return {
    refs: [
      ...stringList(permissions?.refs),
      ...stringList(permissions?.permissionRefs),
      ...stringList(permissions?.evidenceRefs),
    ],
    scopedExecutorRefs: stringList(permissions?.scopedExecutorRefs),
    stopCancelPath: permissions?.stopCancelPath === true || permissions?.cancelPath === true || permissions?.takeOverPath === true,
  };
}

function capabilityTruthRefs(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const source = firstRecord(uiState.browserComputerUseCapabilityTruth, uiState.capabilityReadiness, uiState.runtimeReadiness);
  return [
    ...stringList(source?.refs),
    ...stringList(source?.evidenceRefs),
    ...stringList(source?.healthRefs),
  ];
}

function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
  return values.find(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()).slice(0, 16);
}
