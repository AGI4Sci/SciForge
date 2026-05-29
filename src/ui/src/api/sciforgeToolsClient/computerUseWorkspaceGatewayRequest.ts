import type { SendAgentMessageInput } from '../../domain';
import { expectedArtifactsForCurrentTurn, selectedComponentsForCurrentTurn } from '../../artifactIntent';
import { builtInScenarioIdForRuntimeInput, skillDomainForRuntimeInput } from '@sciforge/scenario-core/scenario-routing-policy';

const COMPUTER_USE_VISION_SENSE_TOOL_ID = 'local.vision-sense';
const COMPUTER_USE_ACTION_PROVIDER_ID = 'action.sciforge.computer-use';
const COMPLETION_EVIDENCE_POLICY_SCHEMA = 'sciforge.completion-evidence-policy.v1';
const EMBEDDED_L3_COMPLETION_EVIDENCE_PRODUCER_ID = 'computer-use.embedded-isolated-desktop-l3';
const ON_COMPLETED_CURRENT_RUN_TRIGGER = 'on-completed-current-run';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return out.length ? out : undefined;
}

function uniqueRuntimeStringList(values: unknown[]) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

function sanitizedCompletionEvidencePolicy(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || value.schemaVersion !== COMPLETION_EVIDENCE_POLICY_SCHEMA) return undefined;
  const producers = Array.isArray(value.producers)
    ? value.producers.flatMap((producer) => {
      if (!isRecord(producer)) return [];
      if (producer.id !== EMBEDDED_L3_COMPLETION_EVIDENCE_PRODUCER_ID) return [];
      if (producer.enabled !== true) return [];
      if (producer.trigger !== ON_COMPLETED_CURRENT_RUN_TRIGGER) return [];
      return [{
        id: EMBEDDED_L3_COMPLETION_EVIDENCE_PRODUCER_ID,
        enabled: true,
        trigger: ON_COMPLETED_CURRENT_RUN_TRIGGER,
      }];
    })
    : [];
  if (!producers.length) return undefined;
  return {
    schemaVersion: COMPLETION_EVIDENCE_POLICY_SCHEMA,
    producers,
  };
}

export function computerUseActionProviderRequested(input: SendAgentMessageInput) {
  if (/^\/(?:computer-use|computer\s+use)\b/i.test(input.prompt.trim())) return true;
  const scenario = input.scenarioOverride;
  return [
    ...(scenario?.selectedActionIds ?? []),
    ...(scenario?.selectedToolIds ?? []),
  ].includes(COMPUTER_USE_ACTION_PROVIDER_ID);
}

export function buildComputerUseWorkspaceGatewayRequest(input: SendAgentMessageInput, commandId: string) {
  const scenario = input.scenarioOverride;
  const selectedToolIds = uniqueRuntimeStringList([
    ...(scenario?.selectedToolIds ?? []),
    COMPUTER_USE_VISION_SENSE_TOOL_ID,
  ]);
  const selectedSenseIds = uniqueRuntimeStringList([
    ...(scenario?.selectedSenseIds ?? []),
    COMPUTER_USE_VISION_SENSE_TOOL_ID,
  ]);
  const selectedActionIds = uniqueRuntimeStringList([
    ...(scenario?.selectedActionIds ?? []),
    COMPUTER_USE_ACTION_PROVIDER_ID,
  ]);
  const selectedComponentIds = selectedComponentsForCurrentTurn(
    input.prompt,
    input.availableComponentIds ?? scenario?.defaultComponents ?? [],
  );
  const approvalRef = approvalRefFromComputerUsePrompt(input.prompt);
  const approvalProvenance = approvalRef ? approvalProvenanceFromComputerUseRuns(input.runs, approvalRef) : undefined;
  const humanApproval = approvalRef ? {
    approvalRef,
    ...(approvalProvenance ? { approvalProvenance } : {}),
  } : undefined;
  const completionEvidencePolicy = sanitizedCompletionEvidencePolicy(scenario?.completionEvidencePolicy);
  return {
    skillDomain: skillDomainForRuntimeInput(input),
    prompt: input.prompt,
    handoffSource: 'ui-chat',
    workspacePath: input.config.workspacePath,
    agentServerBaseUrl: input.config.agentServerBaseUrl,
    agentBackend: input.config.agentBackend,
    modelProvider: input.config.modelProvider,
    modelName: input.config.modelName,
    maxContextWindowTokens: input.config.maxContextWindowTokens,
    scenarioPackageRef: input.scenarioPackageRef ?? scenario?.scenarioPackageRef,
    skillPlanRef: input.skillPlanRef ?? scenario?.skillPlanRef,
    uiPlanRef: input.uiPlanRef ?? scenario?.uiPlanRef,
    artifacts: input.artifacts ?? [],
    references: input.references ?? [],
    selectedToolIds,
    selectedSenseIds,
    selectedActionIds,
    selectedComponentIds,
    selectedVerifierIds: scenario?.selectedVerifierIds,
    expectedArtifactTypes: expectedArtifactsForCurrentTurn({
      scenarioId: builtInScenarioIdForRuntimeInput(input),
      prompt: input.prompt,
      selectedComponentIds,
    }),
    verificationResult: input.verificationResult,
    recentVerificationResults: input.recentVerificationResults,
    humanApproval,
    uiState: {
      commandId,
      currentTurnId: input.currentTurnId,
      selectedToolIds,
      selectedSenseIds,
      selectedActionIds,
      selectedVerifierIds: scenario?.selectedVerifierIds,
      turnExecutionConstraints: scenario?.turnExecutionConstraints,
      artifactPolicy: scenario?.artifactPolicy,
      referencePolicy: scenario?.referencePolicy,
      failureRecoveryPolicy: scenario?.failureRecoveryPolicy,
      humanApprovalPolicy: scenario?.humanApprovalPolicy,
      humanApproval,
      approvalRef,
      approvalProvenance,
      completionEvidencePolicy,
      computerUseLong: scenario?.computerUseLong,
      computerUseNext: scenario?.computerUseNext,
      visionSenseConfig: {
        desktopBridgeEnabled: true,
        allowSharedSystemInput: input.config.visionAllowSharedSystemInput === true,
      },
    },
  };
}

function approvalRefFromComputerUsePrompt(prompt: string) {
  if (!/^\/(?:computer-use|computer\s+use)\s+approve\b/i.test(prompt.trim())) return undefined;
  const match = /--approval-ref(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/i.exec(prompt);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function approvalProvenanceFromComputerUseRuns(runs: SendAgentMessageInput['runs'], approvalRef: string) {
  for (const run of [...(runs ?? [])].reverse()) {
    if (!isRecord(run)) continue;
    const raw = isRecord(run.raw) ? run.raw : {};
    const guiAskUser = isRecord(raw.guiAskUser) ? raw.guiAskUser : undefined;
    if (!guiAskUser) continue;
    const approvalRequest = isRecord(guiAskUser?.approvalRequest) ? guiAskUser.approvalRequest : undefined;
    if (!approvalRequest || approvalRefFromApprovalRequest(approvalRequest) !== approvalRef) continue;
    const guiPresentation = isRecord(raw.guiPresentation) ? raw.guiPresentation : undefined;
    const displayIntent = isRecord(raw.displayIntent) ? raw.displayIntent : undefined;
    const projection = isRecord(displayIntent?.conversationProjection) ? displayIntent.conversationProjection : undefined;
    const artifacts = Array.isArray(projection?.artifacts) ? projection.artifacts.filter(isRecord) : [];
    const relatedRefs = uniqueRuntimeStringList([
      ...(asStringArray(guiAskUser.relatedRefs) ?? []),
      ...(asStringArray(guiAskUser.displayedRefs) ?? []),
    ]);
    const presentedRefs = uniqueRuntimeStringList([
      ...(asStringArray(guiPresentation?.displayedRefs) ?? []),
      ...artifacts.map((artifact) => asString(artifact.ref)),
    ]);
    const auditRefs = asStringArray(projection?.auditRefs) ?? [];
    const sourceRefs = approvalSourceRefsFromComputerUseRefs([
      ...relatedRefs,
      ...presentedRefs,
      ...auditRefs,
    ]);
    const approvalRequestSidecar = recordField(raw, 'approvalRequestSidecar') ?? recordField(guiAskUser, 'approvalRequestSidecar');
    const guiAskUserSidecar = recordField(raw, 'guiAskUserSidecar') ?? recordField(guiAskUser, 'guiAskUserSidecar');
    const riskAuditSidecar = recordField(raw, 'riskAuditSidecar') ?? recordField(guiAskUser, 'riskAuditSidecar');
    const riskAuditHighRiskAction = recordField(riskAuditSidecar, 'highRiskAction');
    return {
      schemaVersion: 'sciforge.computer-use.approval-provenance.v1',
      source: 'prior-gui-ask-user',
      approvalRef,
      sourceRunId: asString(run.id),
      guiAskUserSource: asString(guiAskUser.source),
      guiPresentSource: asString(guiPresentation?.source),
      approvalRequest,
      relatedRefs,
      presentedRefs,
      auditRefs,
      sourceApprovalRequestRef: sourceRefs.sourceApprovalRequestRef,
      sourceGuiAskUserRecordRef: sourceRefs.sourceGuiAskUserRecordRef,
      sourceRiskAuditRef: sourceRefs.sourceRiskAuditRef,
      approvalRequestSidecar,
      guiAskUserSidecar,
      riskAuditSidecar,
      riskActionHash: asString(approvalRequest.riskActionHash)
        ?? asString(approvalRequest.risk_action_hash)
        ?? asString(recordField(approvalRequest, 'metadata')?.riskActionHash)
        ?? asString(approvalRequestSidecar?.riskActionHash)
        ?? asString(guiAskUserSidecar?.riskActionHash)
        ?? asString(riskAuditSidecar?.riskActionHash),
      highRiskAction: riskAuditHighRiskAction,
    };
  }
  return undefined;
}

function approvalRefFromApprovalRequest(approvalRequest: Record<string, unknown>) {
  return asString(approvalRequest.approvalRef)
    ?? asString(approvalRequest.approval_ref)
    ?? asString(approvalRequest.id);
}

function approvalSourceRefsFromComputerUseRefs(refs: string[]) {
  return {
    sourceApprovalRequestRef: refs.find((ref) => /(?:^|\/)approval-request\.json$/i.test(ref)),
    sourceGuiAskUserRecordRef: refs.find((ref) => /(?:^|\/)gui-ask-user\.json$/i.test(ref)),
    sourceRiskAuditRef: refs.find((ref) => /(?:^|\/)risk-audit\.json$/i.test(ref)),
  };
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return isRecord(value[key]) ? value[key] : undefined;
}
