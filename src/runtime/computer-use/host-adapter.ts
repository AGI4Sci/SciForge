import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import type { GatewayRequest } from '../runtime-types.js';
import { isRecord, toStringList, uniqueStrings } from '../gateway-utils.js';
import type { ComputerUseConfig, WindowTarget } from './types.js';
import {
  COMPLETION_EVIDENCE_POLICY_SCHEMA,
  COMPLETION_EVIDENCE_TRIGGER_ON_COMPLETED_CURRENT_RUN,
  EMBEDDED_ISOLATED_DESKTOP_L3_PRODUCER_ID,
  sanitizeCompletionEvidencePolicy,
} from './completion-evidence-policy.js';
import { windowTargetTraceConfig } from './window-target.js';
import { independentInputAdapterExecutionBoundary } from './independent-input-adapter.js';
import {
  computerUseActionRequestExecutorProvider,
  computerUseCaptureHostPortProvider,
  computerUseExecuteHostPortProvider,
  computerUseHostPortProviderIds,
  computerUseModelRouterCapabilityIds,
  computerUseTraceHandoffContract,
} from '../../../packages/actions/computer-use/provider-policy.js';
import {
  computerUseActionProviderContractIds,
  createComputerUseHostPortsContract,
} from '../../../packages/actions/computer-use/host-adapter-contract.js';
import { VISION_TOOL_ID } from '../vision-sense/trace-policy.js';

export const COMPUTER_USE_ACTION_PROVIDER_ID = computerUseActionProviderContractIds.actionProviderId;
export const COMPUTER_USE_REQUEST_SCHEMA = computerUseActionProviderContractIds.requestSchema;
export const COMPUTER_USE_HOST_PORTS_SCHEMA = computerUseActionProviderContractIds.hostPortsSchema;
export const COMPUTER_USE_TUI_HOST_ACTIONS_SCHEMA = computerUseActionProviderContractIds.tuiHostActionsSchema;
export const COMPUTER_USE_PLANNER_ACCEPTANCE_CONTRACT_SCHEMA = computerUseActionProviderContractIds.plannerAcceptanceContractSchema;

export type ComputerUseActionProviderRequest = {
  schemaVersion: typeof COMPUTER_USE_REQUEST_SCHEMA;
  task: string;
  maxSteps: number;
  riskPolicy: 'fail-closed' | 'allow-confirmed';
  approvalRef?: string;
  providers: {
    action: typeof COMPUTER_USE_ACTION_PROVIDER_ID;
    sense?: string;
    grounder?: string;
    executor: string;
    verifier?: string;
  };
  windowTarget: ReturnType<typeof windowTargetTraceConfig>;
  metadata: Record<string, unknown>;
};

export type ComputerUseTuiHostAction =
  | {
      schemaVersion: typeof COMPUTER_USE_TUI_HOST_ACTIONS_SCHEMA;
      port: 'gui.present';
      target: 'computer-use.trace-summary';
      payload: ComputerUsePresentationSummary;
    }
  | {
      schemaVersion: typeof COMPUTER_USE_TUI_HOST_ACTIONS_SCHEMA;
      port: 'gui.ask_user';
      target: 'computer-use.approval-request';
      payload: {
        approvalRequest: Record<string, unknown>;
        relatedRefs: string[];
      };
    };

export type ComputerUsePresentationSummary = {
  title: 'Computer Use result';
  status: string;
  message?: string;
  traceRefs: string[];
  screenshotRefs: string[];
  artifactRefs: string[];
  executionUnitRefs: string[];
  workEvidenceRefs: string[];
  blockedManifestRefs: string[];
  repairHintRefs: string[];
  continuationRequestRefs: string[];
  directoryListingRefs: string[];
  runTaskChainRefs: string[];
  guiAskUserRefs: string[];
  approvalRequestRefs: string[];
  riskAuditRefs: string[];
  confirmedRequestRefs: string[];
  approvalDecisionRefs: string[];
  sourceApprovalRefs: string[];
  attachState?: 'attached' | 'replay' | 'no-session' | 'adapter-unavailable' | 'observe-only' | 'blocked' | 'requires-handoff' | 'error';
  surfaceMode?: 'replay' | 'empty';
  displayGroupRef?: string;
  screenRef?: string;
  visibleScreenRefs?: string[];
  targetAppRef?: string;
  targetWindowRef?: string;
  currentFrameRef?: string;
  frameRef?: string;
  frameRefs?: string[];
  frames?: Record<string, unknown>[];
  screen?: { width?: number; height?: number; label?: string };
  replayRef?: string;
  isolationFlags?: Record<string, unknown>;
  runSummary?: Record<string, unknown>;
};

export function gatewayRequestToComputerUseRequest(
  request: GatewayRequest,
  config: ComputerUseConfig,
  workspace: string,
): ComputerUseActionProviderRequest {
  const explicitApprovalRef = computerUseApprovalRef(request);
  const approveCommandText = computerUseApproveCommandText(request);
  const commandApprovalRef = approveCommandText ? approvalRefFromComputerUseApproveCommand(approveCommandText) : undefined;
  const requestApprovalProvenance = computerUseApprovalProvenance(request);
  const requestedApprovalRef = explicitApprovalRef ?? commandApprovalRef;
  const matchingRequestApprovalProvenance = requestedApprovalRef
    && requestApprovalProvenance
    && approvalProvenanceMatchesApprovalRef(requestApprovalProvenance, requestedApprovalRef)
    ? requestApprovalProvenance
    : undefined;
  const recoveredApprovalProvenance = !matchingRequestApprovalProvenance && commandApprovalRef
    ? computerUseApprovalProvenanceFromWorkspaceSidecars(workspace, commandApprovalRef)
    : undefined;
  const matchingRecoveredApprovalProvenance = commandApprovalRef
    && recoveredApprovalProvenance
    && approvalProvenanceMatchesApprovalRef(recoveredApprovalProvenance, commandApprovalRef)
    ? recoveredApprovalProvenance
    : undefined;
  const approvalProvenance = matchingRequestApprovalProvenance ?? matchingRecoveredApprovalProvenance;
  const approvalRef = matchingRequestApprovalProvenance
    ? requestedApprovalRef
    : matchingRecoveredApprovalProvenance
      ? commandApprovalRef
      : undefined;
  const plannerAcceptanceContract = withComputerUseContinuationContract(
    computerUsePlannerAcceptanceContract(request),
    computerUseContinuationContract(request, workspace),
  );
  const completionEvidencePolicy = computerUseCompletionEvidencePolicy(request);
  return {
    schemaVersion: COMPUTER_USE_REQUEST_SCHEMA,
    task: computerUseTaskForPlanner(request.prompt, approvalRef, approvalProvenance, approveCommandText),
    maxSteps: config.maxSteps,
    riskPolicy: approvalRef ? 'allow-confirmed' : 'fail-closed',
    approvalRef,
    providers: {
      action: COMPUTER_USE_ACTION_PROVIDER_ID,
      sense: computerUseSenseProviderId(request),
      grounder: computerUseModelRouterCapabilityIds.groundingTranslator,
      executor: independentInputAdapterExecutionBoundary(config) ?? computerUseActionRequestExecutorProvider(config),
      verifier: computerUseModelRouterCapabilityIds.verifierTranslator,
    },
    windowTarget: windowTargetTraceConfig(config.windowTarget),
    metadata: {
      workspace,
      selectedToolIds: uniqueStrings([
        ...(request.selectedToolIds ?? []),
        ...toStringList(request.uiState?.selectedToolIds),
      ]),
      selectedActionIds: request.selectedActionIds ?? [],
      selectedSenseIds: request.selectedSenseIds ?? [],
      chatOrigin: computerUseChatOrigin(request),
      bridge: {
        desktopBridgeEnabled: config.desktopBridgeEnabled,
        dryRun: config.dryRun,
        allowSharedSystemInput: Boolean(config.allowSharedSystemInput),
        inputAdapter: config.inputAdapter,
        independentInputAdapterProvider: config.independentInputAdapterProvider,
      },
      ...(completionEvidencePolicy ? { completionEvidencePolicy } : {}),
      ...(plannerAcceptanceContract ? { plannerAcceptanceContract } : {}),
      ...(approvalProvenance ? { approvalProvenance } : {}),
    },
  };
}

function computerUseCompletionEvidencePolicy(request: GatewayRequest) {
  const policy = sanitizeCompletionEvidencePolicy(recordAt(request.uiState, 'completionEvidencePolicy'));
  const producers = policy?.producers
    .filter((producer) => (
      producer.id === EMBEDDED_ISOLATED_DESKTOP_L3_PRODUCER_ID
      && producer.enabled === true
      && producer.trigger === COMPLETION_EVIDENCE_TRIGGER_ON_COMPLETED_CURRENT_RUN
    ))
    .map(() => ({
      id: EMBEDDED_ISOLATED_DESKTOP_L3_PRODUCER_ID,
      enabled: true,
      trigger: COMPLETION_EVIDENCE_TRIGGER_ON_COMPLETED_CURRENT_RUN,
    })) ?? [];
  if (!producers.length) return undefined;
  return {
    schemaVersion: COMPLETION_EVIDENCE_POLICY_SCHEMA,
    producers,
  };
}

function computerUseTaskForPlanner(
  prompt: string,
  approvalRef: string | undefined,
  approvalProvenance: Record<string, unknown> | undefined,
  approveCommandText?: string,
) {
  if (!approvalRef || !approvalProvenance || (!isComputerUseApprovePrompt(prompt) && !approveCommandText)) return prompt;
  const approvalRequest = recordAt(approvalProvenance, 'approvalRequest');
  const highRiskAction = recordAt(approvalProvenance, 'highRiskAction')
    ?? recordAt(recordAt(approvalProvenance, 'riskAuditSidecar'), 'highRiskAction');
  const actionKind = stringAt(highRiskAction, 'actionKind')
    ?? stringAt(highRiskAction, 'action_kind')
    ?? stringAt(approvalRequest, 'action_kind')
    ?? stringAt(approvalRequest, 'actionKind');
  const targetDescription = stringAt(highRiskAction, 'targetDescription')
    ?? stringAt(highRiskAction, 'target_description')
    ?? stringAt(approvalRequest, 'targetDescription')
    ?? stringAt(approvalRequest, 'target_description');
  const confirmationText = stringAt(approvalRequest, 'confirmation_text')
    ?? stringAt(approvalRequest, 'confirmationText');
  const contextLines = [
    'The user approved the prior Computer Use high-risk request referenced above.',
    'Continue the prior approved action under riskPolicy=allow-confirmed; do not look for a visible Approve button.',
    `Approval ref: ${approvalRef}`,
    actionKind ? `Approved action kind: ${actionKind}` : undefined,
    targetDescription ? `Approved target: ${targetDescription}` : undefined,
    confirmationText ? `Prior confirmation text: ${confirmationText}` : undefined,
  ].filter((line): line is string => Boolean(line));
  return `${prompt}\n\nApproved retry context:\n${contextLines.map((line) => `- ${line}`).join('\n')}`;
}

function isComputerUseApprovePrompt(prompt: string) {
  return /^\/(?:computer-use|computer\s+use)\s+approve\b/i.test(prompt.trim());
}

function computerUseChatOrigin(request: GatewayRequest) {
  if (request.handoffSource !== 'ui-chat') return undefined;
  return compactRecord({
    schemaVersion: 'sciforge.computer-use.chat-origin.v1',
    handoffSource: request.handoffSource,
    entrypoint: request.handoffSource === 'ui-chat' ? 'sciforge-chat' : undefined,
    terminalEquivalentText: request.handoffSource === 'ui-chat',
    selectedActionProvider: (request.selectedActionIds ?? []).includes(COMPUTER_USE_ACTION_PROVIDER_ID)
      ? COMPUTER_USE_ACTION_PROVIDER_ID
      : undefined,
    selectedToolIds: request.selectedToolIds,
  });
}

export function computerUseHostPortsContract(config: ComputerUseConfig) {
  return createComputerUseHostPortsContract({
    owner: 'src/runtime computer-use host adapter',
    ports: {
      capture: {
        provider: capturePortProvider(config.windowTarget),
        returns: 'Observation with screenshot/file refs',
      },
      plan: {
        provider: computerUseModelRouterCapabilityIds.computerUsePlanner,
        returns: 'Exactly one generic GUI action or done=true',
      },
      crop: {
        provider: computerUseHostPortProviderIds.focusRegionCrop,
        returns: 'Observation with focus-region file refs',
        optional: true,
      },
      locate: {
        provider: computerUseModelRouterCapabilityIds.groundingTranslator,
        returns: 'Grounding with target-window or crop-local coordinates and diagnostics',
        legacyAdapter: undefined,
      },
      execute: {
        provider: independentInputAdapterExecutionBoundary(config) ?? computerUseExecuteHostPortProvider(config),
        inputAdapter: config.inputAdapter ?? (config.allowSharedSystemInput ? 'shared-system-input-acknowledged' : 'not-configured'),
        independentInputAdapterProvider: config.independentInputAdapterProvider,
        sharedSystemInputExplicitlyAllowed: Boolean(config.allowSharedSystemInput),
      },
      verify: {
        provider: computerUseModelRouterCapabilityIds.verifierTranslator,
        returns: 'Verifier verdict with screenshot-diff, window consistency, and repair feedback',
      },
      writeTrace: {
        provider: computerUseHostPortProviderIds.writeTrace,
        storagePolicy: computerUseTraceHandoffContract.storagePolicy,
      },
      emitEvent: {
        provider: computerUseHostPortProviderIds.emitEvent,
      },
    },
  });
}

export function computerUseResultToTuiHostActions(result: unknown): ComputerUseTuiHostAction[] {
  if (!isRecord(result)) return [];
  const summary = computerUsePresentationSummary(result);
  const approvalRequest = approvalRequestFromResult(result);
  const relatedRefs = summary ? summaryRefs(summary) : refsFromRecord(result);
  const actions: ComputerUseTuiHostAction[] = [];
  if (summary) {
    actions.push({
      schemaVersion: COMPUTER_USE_TUI_HOST_ACTIONS_SCHEMA,
      port: 'gui.present',
      target: computerUseTraceHandoffContract.presentationTarget,
      payload: summary,
    });
  }
  if (approvalRequest) {
    actions.push({
      schemaVersion: COMPUTER_USE_TUI_HOST_ACTIONS_SCHEMA,
      port: 'gui.ask_user',
      target: computerUseTraceHandoffContract.approvalTarget,
      payload: {
        approvalRequest,
        relatedRefs,
      },
    });
  }
  return actions;
}

function computerUseSenseProviderId(request: GatewayRequest) {
  const selected = uniqueStrings([
    ...(request.selectedSenseIds ?? []),
    ...(request.selectedToolIds ?? []),
    ...toStringList(request.uiState?.selectedToolIds),
  ]);
  if (selected.includes(VISION_TOOL_ID)) return VISION_TOOL_ID;
  return selected.find((id) => id.includes('vision') || id.includes('sense'));
}

function computerUsePlannerAcceptanceContract(request: GatewayRequest): Record<string, unknown> | undefined {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const computerUseLong = recordAt(uiState, 'computerUseLong');
  const computerUseNext = recordAt(uiState, 'computerUseNext');
  if (!computerUseLong && !computerUseNext) return undefined;
  const contract = compactRecord({
    schemaVersion: COMPUTER_USE_PLANNER_ACCEPTANCE_CONTRACT_SCHEMA,
    source: 'gateway-ui-state',
    taskId: stringAt(computerUseLong, 'taskId') ?? stringAt(computerUseNext, 'taskId') ?? stringAt(uiState, 'cuNextTaskId'),
    cuNextTaskId: stringAt(computerUseLong, 'cuNextTaskId') ?? stringAt(computerUseNext, 'taskId') ?? stringAt(uiState, 'cuNextTaskId'),
    scenarioId: stringAt(computerUseLong, 'scenarioId'),
    runId: stringAt(computerUseLong, 'runId'),
    round: numberAt(computerUseLong, 'round'),
    title: stringAt(computerUseLong, 'title') ?? stringAt(computerUseNext, 'title'),
    roundPrompt: stringAt(computerUseLong, 'roundPrompt'),
    expectedTrace: stringListAt(computerUseLong, 'expectedTrace'),
    acceptance: stringListAt(computerUseLong, 'acceptance'),
    requiredEvidence: stringListAt(computerUseLong, 'requiredEvidence'),
    failureRecord: stringListAt(computerUseLong, 'failureRecord'),
    requirements: uniqueStrings([
      ...stringListAt(computerUseLong, 'requirements'),
      ...stringListAt(computerUseNext, 'requirements'),
    ]),
    requiredPipeline: stringListAt(computerUseLong, 'requiredPipeline'),
    safetyBoundary: recordAt(computerUseLong, 'safetyBoundary'),
    validationContract: recordAt(computerUseLong, 'validationContract'),
    acceptanceProgress: recordAt(computerUseLong, 'acceptanceProgress'),
  });
  return Object.keys(contract).length > 2 ? contract : undefined;
}

function withComputerUseContinuationContract(
  plannerAcceptanceContract: Record<string, unknown> | undefined,
  continuationContract: Record<string, unknown> | undefined,
) {
  if (!continuationContract) return plannerAcceptanceContract;
  return compactRecord({
    schemaVersion: COMPUTER_USE_PLANNER_ACCEPTANCE_CONTRACT_SCHEMA,
    source: plannerAcceptanceContract ? stringAt(plannerAcceptanceContract, 'source') : 'gateway-computer-use-continuation',
    ...(plannerAcceptanceContract ?? {}),
    computerUseContinuation: continuationContract,
  });
}

function computerUseContinuationContract(request: GatewayRequest, workspace: string): Record<string, unknown> | undefined {
  const references = computerUseContinuationReferenceRecords(request);
  const promptRefs = refsFromText(request.prompt);
  const initialBlockedManifestRefs = uniqueStrings([
    ...refsFromUnknown(references, sidecarRefKey('blocked-manifest.json', /blockedManifestRef/i)),
    ...promptRefs.filter((ref) => ref.endsWith('blocked-manifest.json')),
  ]);
  const initialRepairHintRefs = uniqueStrings([
    ...refsFromUnknown(references, sidecarRefKey('repair-hint.json', /repairHintRef/i)),
    ...promptRefs.filter((ref) => ref.endsWith('repair-hint.json')),
  ]);
  const continuationRequestRefs = uniqueStrings([
    ...refsFromUnknown(references, sidecarRefKey('continuation-request.json', /continuationRequestRef/i)),
    ...promptRefs.filter((ref) => ref.endsWith('continuation-request.json')),
  ]);
  const continuationRequestSummaries = continuationSidecarSummariesFromSources(
    references,
    workspace,
    continuationRequestRefs,
    'continuation-request.json',
  );
  const blockedManifestRefs = uniqueStrings([
    ...initialBlockedManifestRefs,
    ...continuationRequestSummaries
      .map((summary) => stringAt(summary, 'blockedManifestRef'))
      .filter((ref): ref is string => Boolean(ref && isSidecarPathRef(ref, 'blocked-manifest.json'))),
  ]);
  const repairHintRefs = uniqueStrings([
    ...initialRepairHintRefs,
    ...continuationRequestSummaries
      .map((summary) => stringAt(summary, 'repairHintRef'))
      .filter((ref): ref is string => Boolean(ref && isSidecarPathRef(ref, 'repair-hint.json'))),
  ]);
  const repairHintSummaries = continuationSidecarSummariesFromSources(
    references,
    workspace,
    repairHintRefs,
    'repair-hint.json',
  );
  const runTaskChainRefs = uniqueStrings([
    ...refsFromUnknown(references, sidecarRefKey('tui-host-run-task-chain.json', /tuiHostRunTaskChainRef|runTaskChainRef/i)),
    ...promptRefs.filter((ref) => ref.endsWith('tui-host-run-task-chain.json')),
    ...continuationRequestSummaries
      .map((summary) => stringAt(summary, 'sameTraceSessionRef'))
      .filter((ref): ref is string => Boolean(ref && isSidecarPathRef(ref, 'tui-host-run-task-chain.json'))),
    ...repairHintSummaries
      .map((summary) => stringAt(recordAt(summary, 'nextAttempt'), 'reuseRunTaskChainRef'))
      .filter((ref): ref is string => Boolean(ref && isSidecarPathRef(ref, 'tui-host-run-task-chain.json'))),
  ]);
  const hasRefs = blockedManifestRefs.length > 0
    || repairHintRefs.length > 0
    || continuationRequestRefs.length > 0
    || runTaskChainRefs.length > 0;
  if (!hasRefs) return undefined;
  const blockedManifestSummaries = continuationSidecarSummariesFromSources(
    references,
    workspace,
    blockedManifestRefs,
    'blocked-manifest.json',
  );
  const sidecars = compactRecord({
    blockedManifest: blockedManifestSummaries[0],
    repairHint: repairHintSummaries[0],
    continuationRequest: continuationRequestSummaries[0],
  });
  return compactRecord({
    schemaVersion: 'sciforge.computer-use.continuation-context.v1',
    source: 'gateway-request-references',
    blockedManifestRefs,
    repairHintRefs,
    continuationRequestRefs,
    runTaskChainRefs,
    sidecars: Object.keys(sidecars).length ? sidecars : undefined,
    requirements: [
      'Reuse these prior repair refs only as bounded continuation context.',
      'Use current compact observation and current-round Recent actions as execution truth.',
      'Do not reopen or inspect sidecar files; use only this sanitized summary.',
    ],
  });
}

function computerUseContinuationReferenceRecords(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  return [
    ...recordList(request.references),
    ...recordList(uiState.currentReferences),
  ];
}

function continuationSidecarSummariesFromSources(
  references: Record<string, unknown>[],
  workspace: string,
  refs: string[],
  filename: string,
) {
  return [
    ...continuationSidecarSummaries(references, filename),
    ...continuationSidecarSummariesFromWorkspace(workspace, refs, filename),
  ];
}

function continuationSidecarSummaries(references: Record<string, unknown>[], filename: string) {
  const summaries: Record<string, unknown>[] = [];
  for (const reference of references) {
    const ref = stringAt(reference, 'ref') ?? stringAt(recordAt(reference, 'payload'), 'path');
    if (!ref?.endsWith(filename)) continue;
    const payload = recordAt(reference, 'payload');
    const sidecar = recordAt(payload, 'sidecar')
      ?? recordAt(payload, 'json')
      ?? recordAt(payload, 'record')
      ?? recordAt(reference, 'sidecar');
    const summary = sidecar ? continuationSidecarRecordSummary(sidecar) : undefined;
    if (summary) summaries.push(summary);
  }
  return summaries;
}

function continuationSidecarSummariesFromWorkspace(workspace: string, refs: string[], filename: string) {
  const summaries: Record<string, unknown>[] = [];
  for (const ref of refs) {
    if (!isSidecarPathRef(ref, filename)) continue;
    const path = workspaceBoundPath(workspace, ref);
    if (!path) continue;
    const sidecar = readJsonRecordSync(path);
    const summary = sidecar ? continuationSidecarRecordSummary(sidecar) : undefined;
    if (summary) summaries.push(summary);
  }
  return summaries;
}

function continuationSidecarRecordSummary(sidecar: Record<string, unknown>) {
  return compactRecord({
    schemaVersion: stringAt(sidecar, 'schemaVersion'),
    status: stringAt(sidecar, 'status'),
    reason: stringAt(sidecar, 'reason'),
    failedStage: stringAt(sidecar, 'failedStage'),
    blockedManifestRef: stringAt(sidecar, 'blockedManifestRef'),
    repairHintRef: stringAt(sidecar, 'repairHintRef'),
    continuationRequestRef: stringAt(sidecar, 'continuationRequestRef'),
    sameTraceSessionRef: stringAt(sidecar, 'sameTraceSessionRef'),
    requestRef: stringAt(sidecar, 'requestRef'),
    nextAttempt: continuationNextAttemptSummary(recordAt(sidecar, 'nextAttempt')),
  });
}

function workspaceBoundPath(workspace: string, ref: string) {
  const root = resolve(workspace);
  const candidate = ref.startsWith('/') ? resolve(ref) : resolve(root, ref);
  const relativePath = relative(root, candidate);
  if (!relativePath || relativePath.startsWith('..') || relativePath.startsWith('/')) return undefined;
  return candidate;
}

function continuationNextAttemptSummary(nextAttempt: Record<string, unknown> | undefined) {
  if (!nextAttempt) return undefined;
  return compactRecord({
    reuseTraceRef: stringAt(nextAttempt, 'reuseTraceRef'),
    reuseRunTaskChainRef: stringAt(nextAttempt, 'reuseRunTaskChainRef'),
    requireFreshObservation: nextAttempt.requireFreshObservation === true,
    preserveInputIsolation: nextAttempt.preserveInputIsolation === true,
  });
}

function computerUseApprovalRef(request: GatewayRequest) {
  return stringAt(request.humanApproval, 'approvalRef')
    ?? stringAt(request.humanApproval, 'decisionRef')
    ?? stringAt(request.humanApproval, 'ref')
    ?? stringAt(request.humanApprovalPolicy, 'approvalRef')
    ?? stringAt(request.uiState, 'computerUseApprovalRef')
    ?? stringAt(request.uiState, 'approvalRef');
}

function computerUseApproveCommandText(request: GatewayRequest) {
  for (const text of computerUseCommandTexts(request)) {
    if (approvalRefFromComputerUseApproveCommand(text)) return text;
  }
  return undefined;
}

function computerUseCommandTexts(request: GatewayRequest) {
  return uniqueStrings([
    request.prompt,
    stringAt(request, 'commandText'),
    stringAt(request, 'terminalEquivalentText'),
    stringAt(request.uiState, 'commandText'),
    stringAt(request.uiState, 'terminalEquivalentText'),
  ].filter((value): value is string => Boolean(value?.trim())));
}

function approvalRefFromComputerUseApproveCommand(text: string) {
  if (!isComputerUseApprovePrompt(text)) return undefined;
  const match = /--approval-ref(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/i.exec(text);
  return (match?.[1] ?? match?.[2] ?? match?.[3])?.trim() || undefined;
}

function computerUseApprovalProvenance(request: GatewayRequest) {
  const candidates = [
    recordAt(request.humanApproval, 'approvalProvenance'),
    recordAt(request.humanApprovalPolicy, 'approvalProvenance'),
    recordAt(request.uiState, 'approvalProvenance'),
    recordAt(recordAt(request.uiState, 'humanApproval'), 'approvalProvenance'),
    recordAt(recordAt(request.uiState, 'humanApprovalPolicy'), 'approvalProvenance'),
  ];
  return candidates.find(Boolean);
}

function approvalProvenanceMatchesApprovalRef(
  provenance: Record<string, unknown>,
  approvalRef: string,
) {
  const refs = approvalProvenanceRefs(provenance);
  if (!refs.includes(approvalRef)) return false;
  if (refs.some((ref) => ref !== approvalRef)) return false;
  if (approvalProvenanceRiskActionHashes(provenance).length === 0) return false;
  return approvalProvenanceHasPriorBoundary(provenance);
}

function approvalProvenanceRefs(provenance: Record<string, unknown>) {
  const approvalRequest = recordAt(provenance, 'approvalRequest') ?? recordAt(provenance, 'approval_request');
  const approvalRequestSidecar = recordAt(provenance, 'approvalRequestSidecar') ?? recordAt(provenance, 'approval_request_sidecar');
  const guiAskUserSidecar = recordAt(provenance, 'guiAskUserSidecar') ?? recordAt(provenance, 'gui_ask_user_sidecar');
  const guiAskUserPayload = recordAt(guiAskUserSidecar, 'payload');
  const guiAskUserApprovalRequest = recordAt(guiAskUserPayload, 'approvalRequest') ?? recordAt(guiAskUserPayload, 'approval_request');
  const riskAuditSidecar = recordAt(provenance, 'riskAuditSidecar') ?? recordAt(provenance, 'risk_audit_sidecar');
  const approvalDecisionSidecar = recordAt(provenance, 'approvalDecisionSidecar') ?? recordAt(provenance, 'approval_decision_sidecar');
  const confirmedRequestSidecar = recordAt(provenance, 'confirmedRequestSidecar') ?? recordAt(provenance, 'confirmed_request_sidecar');
  return uniqueStrings([
    stringAt(provenance, 'approvalRef'),
    stringAt(provenance, 'approval_ref'),
    stringAt(approvalRequest, 'approvalRef'),
    stringAt(approvalRequest, 'approval_ref'),
    stringAt(approvalRequestSidecar, 'approvalRef'),
    stringAt(approvalRequestSidecar, 'approval_ref'),
    stringAt(guiAskUserSidecar, 'approvalRef'),
    stringAt(guiAskUserSidecar, 'approval_ref'),
    stringAt(guiAskUserApprovalRequest, 'approvalRef'),
    stringAt(guiAskUserApprovalRequest, 'approval_ref'),
    stringAt(riskAuditSidecar, 'approvalRef'),
    stringAt(riskAuditSidecar, 'approval_ref'),
    stringAt(approvalDecisionSidecar, 'approvalRef'),
    stringAt(approvalDecisionSidecar, 'approval_ref'),
    stringAt(confirmedRequestSidecar, 'approvalRef'),
    stringAt(confirmedRequestSidecar, 'approval_ref'),
  ].filter((value): value is string => Boolean(value)));
}

function approvalProvenanceRiskActionHashes(provenance: Record<string, unknown>) {
  const approvalRequest = recordAt(provenance, 'approvalRequest') ?? recordAt(provenance, 'approval_request');
  const approvalRequestSidecar = recordAt(provenance, 'approvalRequestSidecar') ?? recordAt(provenance, 'approval_request_sidecar');
  const guiAskUserSidecar = recordAt(provenance, 'guiAskUserSidecar') ?? recordAt(provenance, 'gui_ask_user_sidecar');
  const guiAskUserPayload = recordAt(guiAskUserSidecar, 'payload');
  const guiAskUserApprovalRequest = recordAt(guiAskUserPayload, 'approvalRequest') ?? recordAt(guiAskUserPayload, 'approval_request');
  const riskAuditSidecar = recordAt(provenance, 'riskAuditSidecar') ?? recordAt(provenance, 'risk_audit_sidecar');
  const approvalDecisionSidecar = recordAt(provenance, 'approvalDecisionSidecar') ?? recordAt(provenance, 'approval_decision_sidecar');
  const confirmedRequestSidecar = recordAt(provenance, 'confirmedRequestSidecar') ?? recordAt(provenance, 'confirmed_request_sidecar');
  return uniqueStrings([
    stringAt(provenance, 'riskActionHash'),
    stringAt(provenance, 'risk_action_hash'),
    stringAt(approvalRequest, 'riskActionHash'),
    stringAt(approvalRequest, 'risk_action_hash'),
    stringAt(approvalRequestSidecar, 'riskActionHash'),
    stringAt(approvalRequestSidecar, 'risk_action_hash'),
    stringAt(guiAskUserSidecar, 'riskActionHash'),
    stringAt(guiAskUserSidecar, 'risk_action_hash'),
    stringAt(guiAskUserApprovalRequest, 'riskActionHash'),
    stringAt(guiAskUserApprovalRequest, 'risk_action_hash'),
    stringAt(riskAuditSidecar, 'riskActionHash'),
    stringAt(riskAuditSidecar, 'risk_action_hash'),
    stringAt(approvalDecisionSidecar, 'riskActionHash'),
    stringAt(approvalDecisionSidecar, 'risk_action_hash'),
    stringAt(confirmedRequestSidecar, 'riskActionHash'),
    stringAt(confirmedRequestSidecar, 'risk_action_hash'),
  ].filter((value): value is string => Boolean(value)));
}

function approvalProvenanceHasPriorBoundary(provenance: Record<string, unknown>) {
  const sourceApprovalRequestRef = stringAt(provenance, 'sourceApprovalRequestRef') ?? stringAt(provenance, 'source_approval_request_ref');
  const sourceGuiAskUserRecordRef = stringAt(provenance, 'sourceGuiAskUserRecordRef') ?? stringAt(provenance, 'source_gui_ask_user_record_ref');
  const sourceRiskAuditRef = stringAt(provenance, 'sourceRiskAuditRef') ?? stringAt(provenance, 'source_risk_audit_ref');
  if (sourceApprovalRequestRef && sourceGuiAskUserRecordRef && sourceRiskAuditRef) return true;
  const approvalRequestSidecar = recordAt(provenance, 'approvalRequestSidecar') ?? recordAt(provenance, 'approval_request_sidecar');
  const guiAskUserSidecar = recordAt(provenance, 'guiAskUserSidecar') ?? recordAt(provenance, 'gui_ask_user_sidecar');
  const riskAuditSidecar = recordAt(provenance, 'riskAuditSidecar') ?? recordAt(provenance, 'risk_audit_sidecar');
  return Boolean(approvalRequestSidecar && guiAskUserSidecar && riskAuditSidecar);
}

function computerUseApprovalProvenanceFromWorkspaceSidecars(
  workspace: string,
  approvalRef: string | undefined,
) {
  if (!approvalRef) return undefined;
  for (const runDir of computerUseApprovalSidecarRunDirs(workspace)) {
    const sourceProvenance = approvalProvenanceFromSidecarGroup({
      workspace,
      approvalRef,
      runDir,
      approvalRequestFile: 'approval-source-request.json',
      guiAskUserFile: 'approval-source-gui-ask-user.json',
      riskAuditFile: 'approval-source-risk-audit.json',
    });
    if (sourceProvenance) return sourceProvenance;
    const currentProvenance = approvalProvenanceFromSidecarGroup({
      workspace,
      approvalRef,
      runDir,
      approvalRequestFile: 'approval-request.json',
      guiAskUserFile: 'gui-ask-user.json',
      riskAuditFile: 'risk-audit.json',
    });
    if (currentProvenance) return currentProvenance;
  }
  return undefined;
}

function computerUseApprovalSidecarRunDirs(workspace: string) {
  const visionRunsDir = join(resolve(workspace), '.sciforge', 'vision-runs');
  if (!safeDirectoryExists(visionRunsDir)) return [];
  return readdirSync(visionRunsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(visionRunsDir, entry.name))
    .sort((left, right) => safeMtimeMs(right) - safeMtimeMs(left));
}

function approvalProvenanceFromSidecarGroup(input: {
  workspace: string;
  approvalRef: string;
  runDir: string;
  approvalRequestFile: string;
  guiAskUserFile: string;
  riskAuditFile: string;
}) {
  const approvalRequestPath = join(input.runDir, input.approvalRequestFile);
  const guiAskUserPath = join(input.runDir, input.guiAskUserFile);
  const riskAuditPath = join(input.runDir, input.riskAuditFile);
  const approvalRequestSidecar = readJsonRecordSync(approvalRequestPath);
  const guiAskUserSidecar = readJsonRecordSync(guiAskUserPath);
  const riskAuditSidecar = readJsonRecordSync(riskAuditPath);
  if (!approvalRequestSidecar || !guiAskUserSidecar || !riskAuditSidecar) return undefined;
  if (!approvalSidecarsMatchRef(input.approvalRef, [
    approvalRequestSidecar,
    guiAskUserSidecar,
    riskAuditSidecar,
  ])) {
    return undefined;
  }
  const approvalRequest = recordAt(approvalRequestSidecar, 'approvalRequest')
    ?? recordAt(recordAt(guiAskUserSidecar, 'payload'), 'approvalRequest');
  const highRiskAction = recordAt(riskAuditSidecar, 'highRiskAction')
    ?? recordAt(recordAt(riskAuditSidecar, 'approvalBoundary'), 'highRiskAction')
    ?? recordAt(approvalRequestSidecar, 'highRiskAction')
    ?? recordAt(recordAt(approvalRequestSidecar, 'approvalBoundary'), 'highRiskAction')
    ?? recordAt(approvalRequest, 'highRiskAction');
  return compactRecord({
    schemaVersion: 'sciforge.computer-use.approval-provenance.v1',
    source: 'workspace-approval-sidecar',
    sourceStatus: 'needs-confirmation',
    sourceRunId: stringAt(riskAuditSidecar, 'runId')
      ?? stringAt(approvalRequestSidecar, 'runId')
      ?? stringAt(guiAskUserSidecar, 'runId'),
    approvalRef: input.approvalRef,
    approvalRequestId: approvalRequestIdFromApprovalSidecars(approvalRequestSidecar, approvalRequest),
    riskActionHash: stringAt(riskAuditSidecar, 'riskActionHash')
      ?? stringAt(approvalRequestSidecar, 'riskActionHash')
      ?? stringAt(guiAskUserSidecar, 'riskActionHash')
      ?? stringAt(approvalRequest, 'riskActionHash'),
    highRiskAction,
    approvalRequest,
    sourceApprovalRequestRef: workspaceRefForPath(input.workspace, approvalRequestPath),
    sourceGuiAskUserRecordRef: workspaceRefForPath(input.workspace, guiAskUserPath),
    sourceRiskAuditRef: workspaceRefForPath(input.workspace, riskAuditPath),
    approvalRequestSidecar,
    guiAskUserSidecar,
    riskAuditSidecar,
  });
}

function approvalSidecarsMatchRef(approvalRef: string, sidecars: Record<string, unknown>[]) {
  return sidecars.every((sidecar) => {
    const sidecarApprovalRef = approvalRefFromApprovalSidecar(sidecar);
    return !sidecarApprovalRef || sidecarApprovalRef === approvalRef;
  }) && sidecars.some((sidecar) => approvalRefFromApprovalSidecar(sidecar) === approvalRef);
}

function approvalRefFromApprovalSidecar(sidecar: Record<string, unknown>) {
  const approvalRequest = recordAt(sidecar, 'approvalRequest')
    ?? recordAt(recordAt(sidecar, 'payload'), 'approvalRequest');
  const metadata = recordAt(approvalRequest, 'metadata');
  return stringAt(sidecar, 'approvalRef')
    ?? stringAt(sidecar, 'approval_ref')
    ?? stringAt(sidecar, 'canonicalApprovalRef')
    ?? stringAt(approvalRequest, 'approvalRef')
    ?? stringAt(approvalRequest, 'approval_ref')
    ?? stringAt(metadata, 'approvalRef')
    ?? stringAt(metadata, 'approval_ref')
    ?? stringAt(approvalRequest, 'id');
}

function approvalRequestIdFromApprovalSidecars(
  approvalRequestSidecar: Record<string, unknown>,
  approvalRequest: Record<string, unknown> | undefined,
) {
  return stringAt(approvalRequestSidecar, 'approvalRequestId')
    ?? stringAt(approvalRequestSidecar, 'approval_request_id')
    ?? stringAt(approvalRequest, 'id')
    ?? stringAt(approvalRequest, 'approvalRequestId')
    ?? stringAt(approvalRequest, 'approval_request_id');
}

function readJsonRecordSync(path: string) {
  if (!safeFileExists(path)) return undefined;
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return isRecord(data) ? data : undefined;
  } catch {
    return undefined;
  }
}

function workspaceRefForPath(workspace: string, path: string) {
  const ref = relative(resolve(workspace), resolve(path)).replace(/\\/g, '/');
  return ref && !ref.startsWith('..') && !ref.startsWith('/') ? ref : path;
}

function safeDirectoryExists(path: string) {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function safeFileExists(path: string) {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function safeMtimeMs(path: string) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function stringAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}

function numberAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'number' && Number.isFinite(item) ? item : undefined;
}

function stringListAt(value: unknown, key: string) {
  if (!isRecord(value)) return [];
  return toStringList(value[key]);
}

function compactRecord(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => {
    if (item === undefined) return false;
    if (Array.isArray(item) && item.length === 0) return false;
    return true;
  }));
}

function capturePortProvider(target: WindowTarget) {
  return computerUseCaptureHostPortProvider(target);
}

function computerUsePresentationSummary(result: Record<string, unknown>): ComputerUsePresentationSummary | undefined {
  const traceRefs = uniqueStrings([
    ...refsFromRecord(result, traceRefKey),
    ...traceRefsFromArtifacts(result.artifacts),
    ...traceRefsFromExecutionUnits(result.executionUnits),
    ...traceRefsFromWorkEvidence(result.workEvidence),
  ]);
  const screenshotRefs = uniqueStrings([
    ...refsFromRecord(result, screenshotRefKey),
    ...screenshotRefsFromArtifacts(result.artifacts),
    ...screenshotRefsFromExecutionUnits(result.executionUnits),
  ]);
  const artifactRefs = uniqueStrings([
    ...refsFromRecord(result, artifactRefKey),
    ...artifactRefsFromArtifacts(result.artifacts),
    ...artifactRefsFromExecutionUnits(result.executionUnits),
    ...artifactRefsFromWorkEvidence(result.workEvidence),
  ]);
  const executionUnitRefs = uniqueStrings(recordIds(result.executionUnits));
  const workEvidenceRefs = uniqueStrings(recordIds(result.workEvidence));
  const blockedManifestRefs = uniqueStrings(refsFromUnknown(result, sidecarRefKey('blocked-manifest.json', /blockedManifestRef/i)));
  const repairHintRefs = uniqueStrings(refsFromUnknown(result, sidecarRefKey('repair-hint.json', /repairHintRef/i)));
  const continuationRequestRefs = uniqueStrings(refsFromUnknown(result, sidecarRefKey('continuation-request.json', /continuationRequestRef/i)));
  const directoryListingRefs = uniqueStrings(refsFromUnknown(result, sidecarRefKey('directory-listing.json', /directoryListingRef/i)));
  const runTaskChainRefs = uniqueStrings(refsFromUnknown(result, sidecarRefKey('tui-host-run-task-chain.json', /tuiHostRunTaskChainRef|runTaskChainRef/i)));
  const guiAskUserRefs = uniqueStrings(refsFromUnknown(result, sidecarRefKey('gui-ask-user.json', /^(?:guiAskUserRef|guiAskUserRefs|guiAskUserRecordRef|guiAskUserRecordRefs)$/i)));
  const approvalRequestRefs = uniqueStrings(refsFromUnknown(result, sidecarRefKey('approval-request.json', /^(?:approvalRequestRef|approvalRequestRefs)$/i)));
  const riskAuditRefs = uniqueStrings(refsFromUnknown(result, sidecarRefKey('risk-audit.json', /^(?:riskAuditRef|riskAuditRefs)$/i)));
  const confirmedRequestRefs = uniqueStrings(refsFromUnknown(result, sidecarRefKey('confirmed-request.json', /confirmedRequestRef/i)));
  const approvalDecisionRefs = uniqueStrings(refsFromUnknown(result, sidecarRefKey('approval-decision.json', /approvalDecisionRef/i)));
  const sourceApprovalRefs = uniqueStrings([
    ...refsFromUnknown(result, sidecarRefKey('approval-source-request.json', /sourceApprovalRequestRef/i)),
    ...refsFromUnknown(result, sidecarRefKey('approval-source-gui-ask-user.json', /sourceGuiAskUser(?:Record)?Ref/i)),
    ...refsFromUnknown(result, sidecarRefKey('approval-source-risk-audit.json', /sourceRiskAuditRef/i)),
  ]);
  const status = stringAt(result, 'status') ?? firstExecutionUnitStatus(result.executionUnits);
  const message = stringAt(result, 'message');
  const virtualScreen = computerUseVirtualScreenFromResult(result, { traceRefs, status });
  const virtualScreenRefs = computerUseVirtualScreenRefs(virtualScreen);
  const hasRefs = traceRefs.length > 0
    || screenshotRefs.length > 0
    || artifactRefs.length > 0
    || executionUnitRefs.length > 0
    || workEvidenceRefs.length > 0
    || blockedManifestRefs.length > 0
    || repairHintRefs.length > 0
    || continuationRequestRefs.length > 0
    || directoryListingRefs.length > 0
    || runTaskChainRefs.length > 0
    || guiAskUserRefs.length > 0
    || approvalRequestRefs.length > 0
    || riskAuditRefs.length > 0
    || confirmedRequestRefs.length > 0
    || approvalDecisionRefs.length > 0
    || sourceApprovalRefs.length > 0
    || virtualScreenRefs.length > 0;
  if (!hasRefs && !status && !message) return undefined;
  return {
    title: 'Computer Use result',
    status: status ?? 'unknown',
    message,
    traceRefs,
    screenshotRefs,
    artifactRefs,
    executionUnitRefs,
    workEvidenceRefs,
    blockedManifestRefs,
    repairHintRefs,
    continuationRequestRefs,
    directoryListingRefs,
    runTaskChainRefs,
    guiAskUserRefs,
    approvalRequestRefs,
    riskAuditRefs,
    confirmedRequestRefs,
    approvalDecisionRefs,
    sourceApprovalRefs,
    ...virtualScreen,
  };
}

function approvalRequestFromResult(result: Record<string, unknown>): Record<string, unknown> | undefined {
  const direct = recordAt(result, 'approvalRequest') ?? recordAt(result, 'approval_request');
  if (direct) return direct;
  const refs = recordAt(result, 'refs');
  return refs ? recordAt(refs, 'approvalRequest') ?? recordAt(refs, 'approval_request') : undefined;
}

function summaryRefs(summary: ComputerUsePresentationSummary) {
  return uniqueStrings([
    ...summary.traceRefs,
    ...summary.screenshotRefs,
    ...summary.artifactRefs,
    ...summary.executionUnitRefs,
    ...summary.workEvidenceRefs,
    ...summary.blockedManifestRefs,
    ...summary.repairHintRefs,
    ...summary.continuationRequestRefs,
    ...summary.directoryListingRefs,
    ...summary.runTaskChainRefs,
    ...summary.guiAskUserRefs,
    ...summary.approvalRequestRefs,
    ...summary.riskAuditRefs,
    ...summary.confirmedRequestRefs,
    ...summary.approvalDecisionRefs,
    ...summary.sourceApprovalRefs,
    ...computerUseVirtualScreenRefs(summary),
  ]);
}

function computerUseVirtualScreenRefs(value: Partial<ComputerUsePresentationSummary>) {
  return uniqueStrings([
    value.displayGroupRef,
    value.screenRef,
    ...(value.visibleScreenRefs ?? []),
    value.targetAppRef,
    value.targetWindowRef,
    value.currentFrameRef,
    value.frameRef,
    ...(value.frameRefs ?? []),
    value.replayRef,
  ].filter((ref): ref is string => Boolean(ref)));
}

function refsFromRecord(record: Record<string, unknown>, predicate: (key: string, value?: string) => boolean = () => true): string[] {
  const refs: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string' && predicate(key, value) && looksLikeRef(value)) refs.push(value);
    if (Array.isArray(value) && predicate(key)) refs.push(...toStringList(value).filter(looksLikeRef));
  }
  return refs;
}

function refsFromUnknown(value: unknown, predicate: (key: string, value?: string) => boolean, key = '', depth = 0): string[] {
  if (depth > 6) return [];
  if (typeof value === 'string') return predicate(key, value) && looksLikeRef(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => refsFromUnknown(item, predicate, key, depth + 1));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([itemKey, item]) => refsFromUnknown(item, predicate, itemKey, depth + 1));
}

function refsFromText(value: string) {
  return uniqueStrings(value.match(/(?:\.sciforge\/|\/)[^\s"')\]}<>]+/g) ?? []);
}

function sidecarRefKey(filename: string, keyPattern: RegExp) {
  return (key: string, value?: string) => keyPattern.test(key) || (value ? isSidecarPathRef(value, filename) : false);
}

function isSidecarPathRef(value: string, filename: string) {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (trimmed !== filename && !trimmed.endsWith(`/${filename}`)) return false;
  return trimmed.startsWith('.sciforge/') || trimmed.startsWith('/');
}

function traceRefsFromArtifacts(value: unknown) {
  return recordList(value).flatMap((record) => {
    const refs = [
      stringAt(record, 'path'),
      stringAt(record, 'dataRef'),
      stringAt(record, 'rawRef'),
      stringAt(record, 'outputRef'),
    ].filter((ref): ref is string => Boolean(ref) && traceRefKey('', ref));
    const metadata = recordAt(record, 'metadata');
    return metadata ? [...refs, ...refsFromRecord(metadata, traceRefKey)] : refs;
  });
}

function screenshotRefsFromArtifacts(value: unknown) {
  return recordList(value).flatMap((record) => {
    const metadata = recordAt(record, 'metadata');
    const screenshotRefs = metadata && Array.isArray(metadata.screenshotRefs)
      ? recordList(metadata.screenshotRefs).flatMap((ref) => refsFromRecord(ref, screenshotRefKey))
      : [];
    return [
      ...refsFromRecord(record, screenshotRefKey),
      ...screenshotRefs,
    ];
  });
}

function computerUseVirtualScreenFromResult(
  result: Record<string, unknown>,
  context: { traceRefs: string[]; status?: string },
): Partial<ComputerUsePresentationSummary> {
  const screenshots = traceScreenshotRecordsFromArtifacts(result.artifacts);
  const currentScreenshot = [...screenshots].reverse().find((ref) => isRelativeFrameRef(stringAt(ref, 'path')));
  const frameRefs = uniqueStrings(screenshots
    .map((ref) => stringAt(ref, 'path'))
    .filter((ref): ref is string => Boolean(ref && isRelativeFrameRef(ref))));
  const currentFrameRef = stringAt(currentScreenshot, 'path') ?? frameRefs.at(-1);
  const windowTarget = windowTargetFromScreenshot(currentScreenshot)
    ?? [...screenshots].reverse().map(windowTargetFromScreenshot).find(Boolean)
    ?? windowTargetFromResult(result);
  if (!currentFrameRef && !windowTarget) return {};

  const displayId = numberAt(currentScreenshot, 'displayId') ?? numberAt(windowTarget, 'displayId');
  const displayGroupRef = stringAt(currentScreenshot, 'displayGroupId')
    ?? stringAt(windowTarget, 'displayGroupId')
    ?? (displayId !== undefined ? `display-group:${displayId}` : undefined);
  const screenRef = stringAt(currentScreenshot, 'screenId')
    ?? stringAt(windowTarget, 'screenId')
    ?? (displayId !== undefined ? `screen:${displayId}` : undefined);
  const targetAppRef = virtualScreenTargetAppRef(windowTarget);
  const targetWindowRef = virtualScreenTargetWindowRef(windowTarget);
  const screenLabel = stringAt(windowTarget, 'title')
    ?? stringAt(windowTarget, 'appName')
    ?? screenRef;
  const frames = screenshots
    .map((screenshot, index) => {
      const ref = stringAt(screenshot, 'path');
      if (!ref || !isRelativeFrameRef(ref)) return undefined;
      return compactRecord({
        ref,
        frameRef: ref,
        screenshotRef: ref,
        screenRef: stringAt(screenshot, 'screenId') ?? screenRef,
        label: ref === currentFrameRef ? screenLabel : stringAt(screenshot, 'id') ?? `frame-${index + 1}`,
        status: ref === currentFrameRef ? 'current' : undefined,
        evidenceRef: context.traceRefs[0],
      });
    })
    .filter((frame): frame is Record<string, unknown> => Boolean(frame));
  const screen = compactRecord({
    width: numberAt(currentScreenshot, 'width'),
    height: numberAt(currentScreenshot, 'height'),
    label: screenLabel,
  }) as NonNullable<ComputerUsePresentationSummary['screen']>;
  const screenInfo = Object.keys(screen).length ? screen : undefined;
  const runId = stringAt(firstArtifactMetadata(result.artifacts), 'runId')
    ?? runIdFromTraceRef(context.traceRefs[0]);
  const runSummary = compactRecord({
    schemaVersion: 'sciforge.computer-use.run-summary.v1',
    status: context.status,
    runId,
    replayRef: context.traceRefs[0],
    screenCount: screenRef || targetWindowRef || targetAppRef ? 1 : undefined,
    frameCount: frameRefs.length || undefined,
    blockedReason: stringAt(result, 'reason') ?? stringAt(recordAt(result, 'failureDiagnostics'), 'reason'),
  });
  return compactRecord({
    attachState: currentFrameRef ? 'observe-only' : 'no-session',
    surfaceMode: currentFrameRef ? 'replay' : 'empty',
    displayGroupRef,
    screenRef,
    visibleScreenRefs: screenRef ? [screenRef] : undefined,
    targetAppRef,
    targetWindowRef,
    currentFrameRef,
    frameRef: currentFrameRef,
    frameRefs,
    frames,
    screen: screenInfo,
    replayRef: context.traceRefs[0],
    isolationFlags: virtualScreenIsolationFlags(windowTarget),
    runSummary,
  });
}

function traceScreenshotRecordsFromArtifacts(value: unknown) {
  return recordList(value).flatMap((record) => {
    const metadata = recordAt(record, 'metadata');
    return metadata && Array.isArray(metadata.screenshotRefs)
      ? recordList(metadata.screenshotRefs)
      : [];
  });
}

function firstArtifactMetadata(value: unknown) {
  return recordList(value).map((record) => recordAt(record, 'metadata')).find(Boolean);
}

function windowTargetFromScreenshot(screenshot: Record<string, unknown> | undefined) {
  return recordAt(screenshot, 'windowTarget');
}

function windowTargetFromResult(result: Record<string, unknown>) {
  return recordAt(result, 'windowTarget')
    ?? recordAt(recordAt(result, 'metadata'), 'windowTarget')
    ?? recordList(result.workEvidence).map((record) => recordAt(recordAt(record, 'input'), 'windowTarget')).find(Boolean)
    ?? recordList(result.executionUnits).map((record) => recordAt(record, 'windowTarget')).find(Boolean);
}

function virtualScreenTargetAppRef(windowTarget: Record<string, unknown> | undefined) {
  const bundleId = stringAt(windowTarget, 'bundleId');
  if (bundleId) return `app:${safeRefFragment(bundleId)}`;
  const appName = stringAt(windowTarget, 'appName');
  return appName ? `app:${safeRefFragment(appName)}` : undefined;
}

function virtualScreenTargetWindowRef(windowTarget: Record<string, unknown> | undefined) {
  const windowId = numberAt(windowTarget, 'windowId');
  if (windowId !== undefined) return `window:${windowId}`;
  const virtualWindowId = stringAt(windowTarget, 'virtualWindowId');
  if (virtualWindowId) return `window:${safeRefFragment(virtualWindowId)}`;
  const title = stringAt(windowTarget, 'title');
  const appName = stringAt(windowTarget, 'appName') ?? stringAt(windowTarget, 'bundleId');
  return title || appName ? `window:${safeRefFragment([appName, title].filter(Boolean).join('-'))}` : undefined;
}

function virtualScreenIsolationFlags(windowTarget: Record<string, unknown> | undefined) {
  const inputIsolation = stringAt(windowTarget, 'inputIsolation');
  return compactRecord({
    requiresFocusSteal: inputIsolation === 'require-focused-target' ? true : undefined,
    backgroundRenderable: false,
    diagnosticOnly: true,
  });
}

function isRelativeFrameRef(value: string | undefined) {
  return Boolean(value
    && !value.startsWith('/')
    && !value.startsWith('~')
    && !/^(?:data:|blob:|file:|https?:|javascript:)/i.test(value)
    && /\.(?:png|jpe?g|webp)$/i.test(value));
}

function safeRefFragment(value: string) {
  const fragment = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return fragment || 'unknown';
}

function runIdFromTraceRef(ref: string | undefined) {
  if (!ref) return undefined;
  const parts = ref.split('/').filter(Boolean);
  const visionRunsIndex = parts.lastIndexOf('vision-runs');
  return visionRunsIndex >= 0 ? parts[visionRunsIndex + 1] : undefined;
}

function artifactRefsFromArtifacts(value: unknown) {
  return recordList(value).flatMap((record) => [
    stringAt(record, 'id'),
    stringAt(record, 'path'),
    stringAt(record, 'dataRef'),
  ].filter((ref): ref is string => typeof ref === 'string' && looksLikeRef(ref)));
}

function traceRefsFromExecutionUnits(value: unknown) {
  return recordList(value).flatMap((record) => refsFromRecord(record, traceRefKey));
}

function screenshotRefsFromExecutionUnits(value: unknown) {
  return recordList(value).flatMap((record) => refsFromRecord(record, screenshotRefKey));
}

function artifactRefsFromExecutionUnits(value: unknown) {
  return recordList(value).flatMap((record) => [
    ...refsFromRecord(record, artifactRefKey),
    ...toStringList(record.outputArtifacts).filter(looksLikeRef),
    ...toStringList(record.artifacts).filter(looksLikeRef),
  ]);
}

function traceRefsFromWorkEvidence(value: unknown) {
  return recordList(value).flatMap((record) => refsFromRecord(record, traceRefKey));
}

function artifactRefsFromWorkEvidence(value: unknown) {
  return recordList(value).flatMap((record) => [
    ...refsFromRecord(record, artifactRefKey),
    ...toStringList(record.evidenceRefs).filter(looksLikeRef),
  ]);
}

function recordIds(value: unknown) {
  return recordList(value)
    .map((record) => stringAt(record, 'id'))
    .filter((id): id is string => typeof id === 'string' && looksLikeRef(id));
}

function firstExecutionUnitStatus(value: unknown) {
  const first = recordList(value)[0];
  return first ? stringAt(first, 'status') : undefined;
}

function recordAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return isRecord(item) ? item : undefined;
}

function recordList(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function traceRefKey(key: string, value?: string) {
  return /trace/i.test(key) || (value ? /trace/i.test(value) : false);
}

function screenshotRefKey(key: string, value?: string) {
  return /screenshot|image|capture/i.test(key) || (value ? /\.(png|jpe?g|webp)$/i.test(value) : false);
}

function artifactRefKey(key: string) {
  return /artifact|output|evidence|rawRef|dataRef|ref$/i.test(key);
}

function looksLikeRef(value: string) {
  return /^(artifact|file|workEvidence|budgetDebit|audit|approval|ref):/.test(value)
    || value.startsWith('EU-')
    || value.startsWith('.sciforge/')
    || value.startsWith('/')
    || /\.(json|md|txt|csv|tsv|xlsx|pptx?|pdf|docx?|odt|ods|png|jpe?g|webp)$/i.test(value);
}
