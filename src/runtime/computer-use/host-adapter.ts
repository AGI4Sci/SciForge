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
  computerUseHostPortLists,
  computerUseHostPortProviderIds,
  computerUseHostPortsContractIds,
  computerUseTraceHandoffContract,
} from '../../../packages/actions/computer-use/provider-policy.js';
import { VISION_TOOL_ID } from '../vision-sense/trace-policy.js';

export const COMPUTER_USE_ACTION_PROVIDER_ID = 'action.sciforge.computer-use';
export const COMPUTER_USE_REQUEST_SCHEMA = 'sciforge.computer-use.request.v1';
export const COMPUTER_USE_HOST_PORTS_SCHEMA = computerUseHostPortsContractIds.schemaVersion;
export const COMPUTER_USE_TUI_HOST_ACTIONS_SCHEMA = 'sciforge.computer-use.tui-host-actions.v1';
export const COMPUTER_USE_PLANNER_ACCEPTANCE_CONTRACT_SCHEMA = 'sciforge.computer-use.planner-acceptance-contract.v1';

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
};

export function gatewayRequestToComputerUseRequest(
  request: GatewayRequest,
  config: ComputerUseConfig,
  workspace: string,
): ComputerUseActionProviderRequest {
  const approvalRef = computerUseApprovalRef(request);
  const approvalProvenance = computerUseApprovalProvenance(request);
  const plannerAcceptanceContract = withComputerUseContinuationContract(
    computerUsePlannerAcceptanceContract(request),
    computerUseContinuationContract(request),
  );
  const completionEvidencePolicy = computerUseCompletionEvidencePolicy(request);
  return {
    schemaVersion: COMPUTER_USE_REQUEST_SCHEMA,
    task: computerUseTaskForPlanner(request.prompt, approvalRef, approvalProvenance),
    maxSteps: config.maxSteps,
    riskPolicy: approvalRef ? 'allow-confirmed' : 'fail-closed',
    approvalRef,
    providers: {
      action: COMPUTER_USE_ACTION_PROVIDER_ID,
      sense: computerUseSenseProviderId(request),
      grounder: config.grounder.baseUrl ? computerUseHostPortProviderIds.kvGround : undefined,
      executor: independentInputAdapterExecutionBoundary(config) ?? computerUseActionRequestExecutorProvider(config),
      verifier: computerUseHostPortProviderIds.layeredVerifier,
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
) {
  if (!approvalRef || !approvalProvenance || !isComputerUseApprovePrompt(prompt)) return prompt;
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
  return {
    schemaVersion: COMPUTER_USE_HOST_PORTS_SCHEMA,
    owner: 'src/runtime host adapter',
    actionProvider: COMPUTER_USE_ACTION_PROVIDER_ID,
    ports: {
      capture: {
        provider: capturePortProvider(config.windowTarget),
        returns: 'Observation with screenshot/file refs',
      },
      plan: {
        provider: computerUseHostPortProviderIds.runtimeCodexTuiTextPlanner,
        returns: 'Exactly one generic GUI action or done=true',
      },
      crop: {
        provider: computerUseHostPortProviderIds.focusRegionCrop,
        returns: 'Observation with focus-region file refs',
        optional: true,
      },
      locate: {
        provider: config.grounder.baseUrl ? computerUseHostPortProviderIds.kvGround : computerUseHostPortProviderIds.focusRegionCrop,
        returns: 'Grounding with target-window or crop-local coordinates and diagnostics',
      },
      execute: {
        provider: independentInputAdapterExecutionBoundary(config) ?? computerUseExecuteHostPortProvider(config),
        inputAdapter: config.inputAdapter ?? (config.allowSharedSystemInput ? 'shared-system-input-acknowledged' : 'not-configured'),
        independentInputAdapterProvider: config.independentInputAdapterProvider,
        sharedSystemInputExplicitlyAllowed: Boolean(config.allowSharedSystemInput),
      },
      verify: {
        provider: computerUseHostPortProviderIds.layeredVerifier,
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
    forbiddenPorts: [...computerUseHostPortLists.forbidden],
    guiBoundary: 'TUI Host may call gui.present/gui.ask_user after receiving refs-first result or approvalRequest; Computer Use package must not call GUI directly.',
  };
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

function computerUseContinuationContract(request: GatewayRequest): Record<string, unknown> | undefined {
  const references = computerUseContinuationReferenceRecords(request);
  const promptRefs = refsFromText(request.prompt);
  const blockedManifestRefs = uniqueStrings([
    ...refsFromUnknown(references, sidecarRefKey('blocked-manifest.json', /blockedManifestRef/i)),
    ...promptRefs.filter((ref) => ref.endsWith('blocked-manifest.json')),
  ]);
  const repairHintRefs = uniqueStrings([
    ...refsFromUnknown(references, sidecarRefKey('repair-hint.json', /repairHintRef/i)),
    ...promptRefs.filter((ref) => ref.endsWith('repair-hint.json')),
  ]);
  const continuationRequestRefs = uniqueStrings([
    ...refsFromUnknown(references, sidecarRefKey('continuation-request.json', /continuationRequestRef/i)),
    ...promptRefs.filter((ref) => ref.endsWith('continuation-request.json')),
  ]);
  const runTaskChainRefs = uniqueStrings([
    ...refsFromUnknown(references, sidecarRefKey('tui-host-run-task-chain.json', /tuiHostRunTaskChainRef|runTaskChainRef/i)),
    ...promptRefs.filter((ref) => ref.endsWith('tui-host-run-task-chain.json')),
  ]);
  const hasRefs = blockedManifestRefs.length > 0
    || repairHintRefs.length > 0
    || continuationRequestRefs.length > 0
    || runTaskChainRefs.length > 0;
  if (!hasRefs) return undefined;
  const sidecars = compactRecord({
    blockedManifest: continuationSidecarSummary(references, 'blocked-manifest.json'),
    repairHint: continuationSidecarSummary(references, 'repair-hint.json'),
    continuationRequest: continuationSidecarSummary(references, 'continuation-request.json'),
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

function continuationSidecarSummary(references: Record<string, unknown>[], filename: string) {
  const reference = references.find((item) => {
    const ref = stringAt(item, 'ref') ?? stringAt(recordAt(item, 'payload'), 'path');
    return ref ? ref.endsWith(filename) : false;
  });
  if (!reference) return undefined;
  const payload = recordAt(reference, 'payload');
  const sidecar = recordAt(payload, 'sidecar')
    ?? recordAt(payload, 'json')
    ?? recordAt(payload, 'record')
    ?? recordAt(reference, 'sidecar');
  if (!sidecar) return undefined;
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
  const guiAskUserRefs = uniqueStrings(refsFromUnknown(result, sidecarRefKey('gui-ask-user.json', /guiAskUser(?:Record)?Ref/i)));
  const approvalRequestRefs = uniqueStrings(refsFromUnknown(result, sidecarRefKey('approval-request.json', /approvalRequestRef/i)));
  const riskAuditRefs = uniqueStrings(refsFromUnknown(result, sidecarRefKey('risk-audit.json', /riskAuditRef/i)));
  const confirmedRequestRefs = uniqueStrings(refsFromUnknown(result, sidecarRefKey('confirmed-request.json', /confirmedRequestRef/i)));
  const approvalDecisionRefs = uniqueStrings(refsFromUnknown(result, sidecarRefKey('approval-decision.json', /approvalDecisionRef/i)));
  const sourceApprovalRefs = uniqueStrings([
    ...refsFromUnknown(result, sidecarRefKey('approval-source-request.json', /sourceApprovalRequestRef/i)),
    ...refsFromUnknown(result, sidecarRefKey('approval-source-gui-ask-user.json', /sourceGuiAskUser(?:Record)?Ref/i)),
    ...refsFromUnknown(result, sidecarRefKey('approval-source-risk-audit.json', /sourceRiskAuditRef/i)),
  ]);
  const status = stringAt(result, 'status') ?? firstExecutionUnitStatus(result.executionUnits);
  const message = stringAt(result, 'message');
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
    || sourceApprovalRefs.length > 0;
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
  ]);
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
  return (key: string, value?: string) => keyPattern.test(key) || (value ? value.endsWith(`/${filename}`) || value.endsWith(filename) : false);
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
