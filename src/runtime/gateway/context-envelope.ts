import { resolve } from 'node:path';
import { currentUserRequestFromPrompt } from '@sciforge-ui/runtime-contract/conversation-policy';
import { defaultArtifactSchemaForSkillDomain } from '@sciforge-ui/runtime-contract/artifact-policy';
import { runtimeVerificationResultArtifacts } from '@sciforge-ui/runtime-contract/verification-result';
import type { SciForgeSkillDomain, GatewayRequest, SkillAvailability } from '../runtime-types.js';
import { clipForAgentServerJson, clipForAgentServerPrompt, hashJson, isRecord, toRecordList, toStringList } from '../gateway-utils.js';
import { brokerCapabilities, CapabilityManifestRegistry as BrokerCapabilityManifestRegistry, type CapabilityBrokerArtifactIndexEntry, type CapabilityBrokerFailureHistoryEntry, type CapabilityBrokerObjectRef, type CapabilityBrokerOutput, type CapabilityBrokerProviderAvailability, type CapabilityBrokerSkillHint, type CapabilityBrokerToolBudget, type CapabilityBrokerVerificationPolicyHint } from '../capability-broker.js';
import { sanitizeCapabilityEvolutionCompactSummaryForBroker } from '../capability-evolution-ledger.js';
import {
  loadCapabilityManifestRegistryWithFileDiscovery,
  loadCoreCapabilityManifestRegistry,
  type CapabilityManifestRegistryFileDiscoveryInput,
  type CompactCapabilityManifestRegistryAudit,
  type LoadedCapabilityManifestRegistry,
} from '../capability-manifest-registry.js';
import { expectedArtifactTypesForRequest, selectedComponentIdsForRequest } from './gateway-request.js';
import { applyContextEnvelopeRecordGovernance, contextEnvelopeGovernanceAudit, contextEnvelopeGovernanceForRequest } from './context-envelope-governance.js';
import { summarizeWorkEvidenceForHandoff } from './work-evidence-types.js';
import {
  capabilityBrokerHarnessInputProjectionForRequest,
  mergeCapabilityBrokerAvailableProviders,
  mergeCapabilityBrokerToolBudgets,
  mergeCapabilityBrokerVerificationPolicies,
} from './capability-broker-harness-input.js';
export { workspaceTreeSummary } from './context-envelope-workspace-tree.js';

export type AgentServerContextMode = 'full' | 'delta';

export function buildContextEnvelope(
  request: GatewayRequest,
  params: {
    workspace: string;
    workspaceTreeSummary?: Array<{ path: string; kind: 'file' | 'folder'; sizeBytes?: number }>;
    priorAttempts?: unknown[];
    selectedSkill?: SkillAvailability;
    repairRefs?: Record<string, unknown>;
    mode?: AgentServerContextMode;
    agentId?: string;
    agentServerCoreSnapshotAvailable?: boolean;
  },
) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const recentExecutionRefs = toRecordList(uiState.recentExecutionRefs);
  const recentConversation = policyConversationEntries(uiState.recentConversation);
  const conversationLedger = toRecordList(uiState.conversationLedger);
  const currentReferences = toRecordList(uiState.currentReferences);
  const currentReferenceDigests = toRecordList(uiState.currentReferenceDigests);
  const contextGovernance = contextEnvelopeGovernanceForRequest(request);
  const governedCurrentReferences = applyContextEnvelopeRecordGovernance(
    'sessionFacts.currentReferences',
    currentReferences,
    contextGovernance,
  );
  const governedCurrentReferenceDigests = applyContextEnvelopeRecordGovernance(
    'sessionFacts.currentReferenceDigests',
    currentReferenceDigests,
    contextGovernance,
    {
      maxCount: contextGovernance?.contextBudget.maxReferenceDigests,
      budgetField: 'maxReferenceDigests',
    },
  );
  const contextReusePolicy = isRecord(uiState.contextReusePolicy) ? uiState.contextReusePolicy : undefined;
  const failureRecoveryPolicy = request.failureRecoveryPolicy ?? (isRecord(uiState.failureRecoveryPolicy) ? uiState.failureRecoveryPolicy : undefined);
  const recentFailures = summarizeFailureRecoveryPolicy(failureRecoveryPolicy);
  const mode = params.mode ?? contextEnvelopeMode(request);
  const workspaceTree = params.workspaceTreeSummary ?? [];
  const expectedArtifactTypes = expectedArtifactTypesForRequest(request);
  const selectedComponentIds = selectedComponentIdsForRequest(request);
  const executionModeDecision = executionModeDecisionForEnvelope(uiState);
  const conversationPolicySummary = summarizeConversationPolicyForAgentServer(uiState.conversationPolicy ?? uiState);
  const capabilityBrokerBrief = buildCapabilityBrokerBriefForAgentServer(request);
  const capabilityBrief = capabilityBriefProjectionFromBrokerBrief(capabilityBrokerBrief, uiState.capabilityBrief);
  const verificationPolicy = request.verificationPolicy ?? brokerVerificationPolicyForRequest(request, brokerCapabilityPolicyForRequest(request));
  const visibleRecentConversation = recentConversation
    .slice(mode === 'full' ? -6 : -4)
    .map((entry) => clipForAgentServerPrompt(entry, mode === 'full' ? 900 : 700))
    .filter(Boolean);
  return {
    version: 'sciforge.context-envelope.v1',
    mode,
    createdAt: new Date().toISOString(),
    hashes: {
      workspaceTree: hashJson(workspaceTree),
      artifacts: hashJson(request.artifacts),
      recentExecutionRefs: hashJson(recentExecutionRefs),
      priorAttempts: hashJson(params.priorAttempts ?? []),
    },
    projectFacts: mode === 'full' ? {
      project: 'SciForge',
      runtimeRole: 'scenario-first AI4Science workspace runtime',
      taskCodePolicyRef: 'sciforge.generated-task.v1',
      toolPayloadContract: ['message', 'confidence', 'claimType', 'evidenceLevel', 'reasoningTrace', 'claims', 'displayIntent', 'uiManifest', 'executionUnits', 'artifacts', 'objectReferences'],
    } : {
      project: 'SciForge',
      taskCodePolicyRef: 'sciforge.generated-task.v1',
      toolPayloadContractRef: 'sciforge.toolPayload.v1',
    },
    orchestrationBoundary: {
      decisionOwner: 'AgentServer',
      sciForgeRoleRef: 'sciforge.orchestration-boundary.runtime-role.v1',
      currentUserRequestIsAuthoritative: true,
      agentId: params.agentId,
      agentServerCoreSnapshotAvailable: params.agentServerCoreSnapshotAvailable === true,
      contextModeReasonCode: mode === 'delta'
        ? 'agentserver-core-compact-delta-refs'
        : 'full-handoff-no-reusable-agentserver-session',
    },
    continuityPolicySummary: continuityPolicySummaryForEnvelope(mode, {
      hasRecentFailures: recentFailures.length > 0,
      hasFailureEvidenceRefs: failureEvidenceRefs(failureRecoveryPolicy).length > 0,
    }),
    contextGovernanceAudit: contextGovernance ? contextEnvelopeGovernanceAudit(contextGovernance) : undefined,
    workspaceFacts: mode === 'full' ? {
      workspacePath: params.workspace,
      sciforgeDir: '.sciforge',
      taskDir: '.sciforge/tasks/',
      taskResultDir: '.sciforge/task-results/',
      logDir: '.sciforge/logs/',
      artifactDir: '.sciforge/artifacts/',
      workspaceTreeSummary: workspaceTree,
      workspaceTreeHash: hashJson(workspaceTree),
      workspaceTreeEntryCount: workspaceTree.length,
    } : {
      workspacePath: params.workspace,
      dirs: {
        task: '.sciforge/tasks/',
        result: '.sciforge/task-results/',
        log: '.sciforge/logs/',
        artifact: '.sciforge/artifacts/',
      },
      workspaceTreeHash: hashJson(workspaceTree),
      workspaceTreeEntryCount: workspaceTree.length,
    },
    scenarioFacts: {
      skillDomain: request.skillDomain,
      scenarioPackageRef: request.scenarioPackageRef,
      skillPlanRef: request.skillPlanRef,
      uiPlanRef: request.uiPlanRef,
      expectedArtifactTypes,
      selectedComponentIds,
      selectedToolIds: request.selectedToolIds ?? toStringList(request.uiState?.selectedToolIds),
      selectedSenseIds: request.selectedSenseIds ?? toStringList(request.uiState?.selectedSenseIds),
      selectedActionIds: request.selectedActionIds ?? toStringList(request.uiState?.selectedActionIds),
      selectedVerifierIds: request.selectedVerifierIds ?? toStringList(request.uiState?.selectedVerifierIds),
      artifactPolicy: request.artifactPolicy ?? (isRecord(uiState.artifactPolicy) ? uiState.artifactPolicy : undefined),
      referencePolicy: request.referencePolicy ?? (isRecord(uiState.referencePolicy) ? uiState.referencePolicy : undefined),
      failureRecoveryPolicy,
      capabilityBrokerBrief,
      capabilityBrief,
      verificationPolicy,
      humanApprovalPolicy: request.humanApprovalPolicy ?? (isRecord(uiState.humanApprovalPolicy) ? uiState.humanApprovalPolicy : undefined),
      unverifiedReason: request.unverifiedReason ?? (typeof uiState.unverifiedReason === 'string' ? uiState.unverifiedReason : undefined),
      conversationPolicySummary,
      ...executionModeDecision,
      selectedSkill: params.selectedSkill ? {
        id: params.selectedSkill.id,
        kind: params.selectedSkill.kind,
        entrypointType: params.selectedSkill.manifest.entrypoint.type,
        manifestPath: params.selectedSkill.manifestPath,
      } : undefined,
    },
    sessionFacts: {
      sessionId: typeof uiState.sessionId === 'string' ? uiState.sessionId : undefined,
      currentPrompt: typeof uiState.currentPrompt === 'string' ? uiState.currentPrompt : request.prompt,
      currentUserRequest: currentUserRequestFromPrompt(request.prompt),
      currentReferences: governedCurrentReferences.length ? governedCurrentReferences.slice(0, 8).map((entry) => clipForAgentServerJson(entry, 2)) : undefined,
      currentReferenceDigests: governedCurrentReferenceDigests.length ? governedCurrentReferenceDigests.slice(0, 8).map((entry) => clipForAgentServerJson(entry, 4)) : undefined,
      conversationPolicySummary,
      ...executionModeDecision,
      recentConversation: visibleRecentConversation,
      conversationLedger: summarizeConversationLedger(conversationLedger, mode),
      contextReusePolicy: contextReusePolicy ? clipForAgentServerJson(contextReusePolicy, 3) : undefined,
      recentRuns: Array.isArray(uiState.recentRuns)
        ? (mode === 'full' ? uiState.recentRuns : uiState.recentRuns.slice(-4).map((entry) => clipForAgentServerJson(entry, 2)))
        : undefined,
      recentFailures: recentFailures.length ? recentFailures : undefined,
      verificationResult: request.verificationResult ?? (isRecord(uiState.verificationResult) ? uiState.verificationResult : undefined),
      recentVerificationResults: request.recentVerificationResults ?? toRecordList(uiState.recentVerificationResults),
    },
    longTermRefs: {
      artifacts: summarizeArtifactRefs(request.artifacts),
      recentExecutionRefs: summarizeExecutionRefs(recentExecutionRefs),
      verificationResults: summarizeVerificationResults(request),
      failureEvidenceRefs: failureEvidenceRefs(failureRecoveryPolicy),
      priorAttempts: summarizeTaskAttemptsForAgentServer(params.priorAttempts ?? []).slice(0, mode === 'full' ? 4 : 2),
      repairRefs: params.repairRefs,
    },
  };
}

function continuityPolicySummaryForEnvelope(
  mode: AgentServerContextMode,
  facts: { hasRecentFailures: boolean; hasFailureEvidenceRefs: boolean },
) {
  return {
    schemaVersion: 'sciforge.context-envelope.continuity-policy-summary.v1',
    mode,
    policyProviderRefs: [
      '@sciforge/skills/runtime-policy#agentServerContinuationPromptPolicyLines',
      '@sciforge/skills/runtime-policy#agentServerPriorAttemptsPromptPolicyLines',
      '@sciforge/skills/runtime-policy#agentServerRepairPromptPolicyLines',
      '@sciforge/skills/runtime-policy#agentServerLargeFilePromptContractLines',
      '@sciforge-ui/runtime-contract/artifact-policy#agentServerCurrentReferencePromptPolicyLines',
    ],
    contextFields: mode === 'full'
      ? [
        'workspaceFacts',
        'sessionFacts.conversationLedger',
        'sessionFacts.recentConversation',
        'sessionFacts.currentReferences',
        'sessionFacts.currentReferenceDigests',
        'longTermRefs.priorAttempts',
        'longTermRefs.artifacts',
      ]
      : [
        'sessionFacts.currentReferences',
        'sessionFacts.currentReferenceDigests',
        'longTermRefs.priorAttempts',
        'longTermRefs.artifacts',
        'longTermRefs.recentExecutionRefs',
      ],
    failureEvidenceFields: facts.hasRecentFailures || facts.hasFailureEvidenceRefs
      ? [
        facts.hasRecentFailures ? 'sessionFacts.recentFailures' : undefined,
        facts.hasFailureEvidenceRefs ? 'longTermRefs.failureEvidenceRefs' : undefined,
      ].filter(Boolean)
      : undefined,
  };
}

export function buildCapabilityBrokerBriefForAgentServer(request: GatewayRequest) {
  return buildCapabilityBrokerBriefForAgentServerFromRegistry(request, loadCoreCapabilityManifestRegistry());
}

export async function buildCapabilityBrokerBriefForAgentServerWithFileDiscovery(
  request: GatewayRequest,
  options: { fileDiscovery?: CapabilityManifestRegistryFileDiscoveryInput } = {},
) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const harnessInput = capabilityBrokerHarnessInputProjectionForRequest(request);
  const capabilityPolicy = harnessInput.enabled ? {} : brokerCapabilityPolicyForRequest(request);
  const fileDiscovery = options.fileDiscovery ?? brokerManifestFileDiscoveryForRequest(request, uiState, capabilityPolicy);
  const registry = await loadCapabilityManifestRegistryWithFileDiscovery({ fileDiscovery });
  return buildCapabilityBrokerBriefForAgentServerFromRegistry(request, registry, { includeRegistryAudit: fileDiscovery?.enabled === true });
}

function buildCapabilityBrokerBriefForAgentServerFromRegistry(
  request: GatewayRequest,
  loadedRegistry: LoadedCapabilityManifestRegistry,
  options: { includeRegistryAudit?: boolean } = {},
) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const harnessInput = capabilityBrokerHarnessInputProjectionForRequest(request);
  const capabilityPolicy = harnessInput.enabled ? {} : brokerCapabilityPolicyForRequest(request);
  const verificationPolicy = mergeCapabilityBrokerVerificationPolicies(
    harnessInput.enabled ? undefined : brokerVerificationPolicyForRequest(request, capabilityPolicy),
    harnessInput.verificationPolicy,
  );
  const skillHints = uniqueSkillHints([
    ...(harnessInput.enabled ? [] : brokerSkillHintsForRequest(request, capabilityPolicy)),
    ...harnessInput.skillHints,
  ]).slice(0, 24);
  const blockedCapabilities = uniqueStrings([
    ...(harnessInput.enabled ? [] : brokerBlockedCapabilitiesForRequest(uiState, capabilityPolicy)),
    ...harnessInput.blockedCapabilities,
  ]);
  const toolBudget = mergeCapabilityBrokerToolBudgets(
    harnessInput.enabled ? undefined : brokerToolBudgetForRequest(uiState, capabilityPolicy),
    harnessInput.toolBudget,
  );
  const preferredCapabilityIds = uniqueStrings([
    ...(harnessInput.enabled ? [] : preferredCapabilityIdsForRequest(request)),
    ...harnessInput.preferredCapabilityIds,
  ]);
  const brokerExpectedArtifactTypes = harnessInput.enabled
    ? uniqueStrings(request.expectedArtifactTypes ?? [])
    : expectedArtifactTypesForRequest(request);
  const brokerSelectedComponentIds = harnessInput.enabled
    ? uniqueStrings(request.selectedComponentIds ?? [])
    : selectedComponentIdsForRequest(request);
  const requiredTags = uniqueStrings([
    request.skillDomain,
    ...brokerExpectedArtifactTypes,
    ...brokerSelectedComponentIds,
    ...(request.selectedToolIds ?? []),
    ...(harnessInput.enabled ? [] : toStringList(request.uiState?.selectedToolIds)),
    ...(request.selectedSenseIds ?? []),
    ...(harnessInput.enabled ? [] : toStringList(request.uiState?.selectedSenseIds)),
    ...(request.selectedVerifierIds ?? []),
    ...(harnessInput.enabled ? [] : toStringList(request.uiState?.selectedVerifierIds)),
  ]);
  const registry = new BrokerCapabilityManifestRegistry(loadedRegistry.manifests);
  const brokered = brokerCapabilities({
    prompt: request.prompt,
    objectRefs: brokerObjectRefsForRequest(request),
    artifactIndex: brokerArtifactIndexForRequest(request),
    failureHistory: brokerFailureHistoryForRequest(request),
    capabilityEvolutionSummary: brokerCapabilityEvolutionSummaryForRequest(request),
    skillHints,
    blockedCapabilities,
    toolBudget,
    verificationPolicy,
    scenarioPolicy: {
      id: request.scenarioPackageRef?.id ?? request.skillDomain,
      preferredCapabilityIds,
      blockedCapabilityIds: blockedCapabilities,
      requiredTags,
    },
    runtimePolicy: {
      topK: 8,
      maxPerKind: {
        action: 3,
        observe: 2,
        'runtime-adapter': 3,
        verifier: 2,
        view: 2,
      },
      riskTolerance: request.riskLevel ?? verificationPolicy?.riskLevel ?? 'medium',
    },
    availableProviders: mergeCapabilityBrokerAvailableProviders(
      harnessInput.enabled ? undefined : brokerAvailableProvidersForRequest(uiState, capabilityPolicy),
      harnessInput.availableProviders,
    ),
  }, registry);
  return compactBrokerOutputForAgentServer(
    brokered,
    options.includeRegistryAudit ? loadedRegistry.compactAudit : undefined,
    harnessInput.audit,
  );
}

function brokerCapabilityEvolutionSummaryForRequest(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const direct = sanitizeCapabilityEvolutionCompactSummaryForBroker(uiState.capabilityEvolutionCompactSummary)
    ?? sanitizeCapabilityEvolutionCompactSummaryForBroker(uiState.capabilityEvolutionLedgerSummary)
    ?? sanitizeCapabilityEvolutionCompactSummaryForBroker(uiState.capabilityEvolutionSummary);
  if (direct) return direct;
  return sanitizeCapabilityEvolutionCompactSummaryForBroker(isRecord(uiState.capabilityEvolutionLedger)
    ? uiState.capabilityEvolutionLedger.compactSummary
    : undefined);
}

function compactBrokerOutputForAgentServer(
  brokered: CapabilityBrokerOutput,
  registryAudit?: CompactCapabilityManifestRegistryAudit,
  harnessInputAudit?: Record<string, unknown>,
) {
  return {
    schemaVersion: 'sciforge.agentserver.capability-broker-brief.v1',
    source: 'typescript-capability-broker',
    contract: brokered.contract,
    routingPolicy: {
      decisionOwner: 'AgentServer',
      contractExpansion: 'lazy-load selected schemas/examples/repair hints only when needed',
      defaultPayload: 'compact briefs only; full capability catalog omitted',
    },
    briefs: brokered.briefs.map((brief) => clipForAgentServerJson(brief, 3)),
    excluded: brokered.excluded.slice(0, 12),
    audit: brokered.audit
      .filter((entry) => brokered.briefs.some((brief) => brief.id === entry.id) || entry.excluded)
      .slice(0, 16)
      .map((entry) => clipForAgentServerJson(entry, 2)),
    ...(harnessInputAudit ? { harnessInputAudit: clipForAgentServerJson(harnessInputAudit, 1) } : {}),
    ...(registryAudit ? { registryAudit: compactCapabilityRegistryAuditForBroker(registryAudit) } : {}),
    inputSummary: brokered.inputSummary,
  };
}

function compactCapabilityRegistryAuditForBroker(audit: CompactCapabilityManifestRegistryAudit) {
  return {
    contract: audit.contract,
    manifestCount: audit.manifestCount,
    providerCount: audit.providerCount,
    sourceCounts: audit.sourceCounts,
    fileDiscovery: audit.fileDiscovery,
    discoveredEntries: audit.entries
      .filter((entry) => entry.source !== 'core')
      .slice(0, 24)
      .map((entry) => ({
        id: entry.id,
        source: entry.source,
        packageName: entry.packageName,
        packageRoot: entry.packageRoot,
        providerAvailability: entry.providerAvailability.map((provider) => ({
          providerId: provider.providerId,
          available: provider.available,
          reason: provider.reason,
        })),
        requiredConfig: entry.requiredConfig,
        risk: entry.risk,
      })),
  };
}

function capabilityBriefProjectionFromBrokerBrief(capabilityBrokerBrief: Record<string, unknown>, legacyCapabilityBrief: unknown) {
  const briefs = Array.isArray(capabilityBrokerBrief.briefs) ? capabilityBrokerBrief.briefs.filter(isRecord) : [];
  const audit = Array.isArray(capabilityBrokerBrief.audit) ? capabilityBrokerBrief.audit.filter(isRecord) : [];
  const selected = briefs.map((brief) => clipForAgentServerJson(pruneUndefined({
    id: stringField(brief.id),
    manifestRef: stringField(brief.id) ? `capability:${stringField(brief.id)}` : undefined,
    kind: stringField(brief.kind),
    providerIds: toStringList(brief.providerIds),
    routingTags: toStringList(brief.routingTags),
    domains: toStringList(brief.domains),
    score: numberField(brief.score),
    budget: isRecord(brief.budget) ? brief.budget : undefined,
    source: 'capability-broker-brief',
  }), 3));
  const excluded = audit.filter((entry) => stringField(entry.excluded)).slice(0, 12).map((entry) => clipForAgentServerJson(pruneUndefined({
    id: stringField(entry.id),
    manifestRef: stringField(entry.id) ? `capability:${stringField(entry.id)}` : undefined,
    reason: stringField(entry.excluded),
    source: 'capability-broker-audit',
  }), 2));
  const legacyAudit = legacyCapabilityBriefAudit(legacyCapabilityBrief);
  return {
    schemaVersion: 'sciforge.capability-brief.registry-projection.v1',
    source: 'unified-capability-registry',
    brokerBriefRef: capabilityBrokerBrief.schemaVersion,
    brokerContract: capabilityBrokerBrief.contract,
    selected,
    excluded,
    needsMoreDiscovery: false,
    auditTrace: [
      { event: 'capabilityBrief.projected_from_broker', source: 'buildCapabilityBrokerBriefForAgentServer', selected: selected.length, excluded: excluded.length },
      ...(legacyAudit ? [legacyAudit] : []),
    ].filter(isRecord),
  };
}

function legacyCapabilityBriefAudit(value: unknown) {
  if (!isRecord(value)) return undefined;
  return {
    event: 'legacy_capabilityBrief.ignored',
    selectedCount: Array.isArray(value.selected) ? value.selected.length : 0,
    excludedCount: Array.isArray(value.excluded) ? value.excluded.length : 0,
    verificationPolicyPresent: isRecord(value.verificationPolicy),
    verificationBriefPresent: isRecord(value.verificationBrief),
    keys: Object.keys(value).sort().slice(0, 12),
  };
}

function brokerObjectRefsForRequest(request: GatewayRequest): CapabilityBrokerObjectRef[] {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  return mergeBrokerRefs([
    ...toRecordList(request.references),
    ...toRecordList(uiState.currentReferences),
    ...toRecordList(uiState.objectReferences),
    ...toRecordList(uiState.currentReferenceDigests),
  ]).slice(0, 24);
}

function brokerArtifactIndexForRequest(request: GatewayRequest): CapabilityBrokerArtifactIndexEntry[] {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  return [
    ...request.artifacts.map((artifact) => brokerArtifactIndexEntry(artifact)),
    ...toRecordList(uiState.artifactIndex).map((artifact) => brokerArtifactIndexEntry(artifact)),
  ].filter((entry) => entry.id || entry.ref || entry.artifactType || entry.title || entry.summary || entry.path).slice(0, 32);
}

function brokerFailureHistoryForRequest(request: GatewayRequest): CapabilityBrokerFailureHistoryEntry[] {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const policy = request.failureRecoveryPolicy ?? (isRecord(uiState.failureRecoveryPolicy) ? uiState.failureRecoveryPolicy : undefined);
  const failures = [
    ...toRecordList(policy),
    ...toRecordList(isRecord(policy) ? policy.attemptHistory : undefined),
    ...toRecordList(uiState.recentVerificationResults),
  ];
  const entries: CapabilityBrokerFailureHistoryEntry[] = [];
  for (const failure of failures) {
    const capabilityId = stringField(failure.capabilityId) ?? stringField(failure.skillId) ?? stringField(failure.tool);
    if (!capabilityId) continue;
    const entry: CapabilityBrokerFailureHistoryEntry = {
      capabilityId,
      recoverActions: toStringList(failure.recoverActions).slice(0, 6),
      refs: failureEvidenceRefs(failure),
    };
    const failureCode = stringField(failure.failureCode) ?? stringField(failure.code) ?? stringField(failure.verdict);
    if (failureCode) entry.failureCode = failureCode;
    entries.push(entry);
  }
  return entries.slice(-12);
}

function preferredCapabilityIdsForRequest(request: GatewayRequest) {
  void request;
  return [];
}

function brokerCapabilityPolicyForRequest(request: GatewayRequest): Record<string, unknown> {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  return brokerManifestDiscoveryPolicyForRequest(uiState);
}

function brokerManifestDiscoveryPolicyForRequest(uiState: Record<string, unknown>): Record<string, unknown> {
  const source = firstRecord(uiState.capabilityPolicy, uiState.capabilityBrokerPolicy);
  if (!source) return {};
  return pruneUndefined({
    manifestFileDiscovery: isRecord(source.manifestFileDiscovery) ? source.manifestFileDiscovery : undefined,
    capabilityManifestFileDiscovery: isRecord(source.capabilityManifestFileDiscovery) ? source.capabilityManifestFileDiscovery : undefined,
  }) as Record<string, unknown>;
}

function brokerManifestFileDiscoveryForRequest(
  request: GatewayRequest,
  uiState: Record<string, unknown>,
  capabilityPolicy: Record<string, unknown>,
): CapabilityManifestRegistryFileDiscoveryInput | undefined {
  const source = firstRecord(
    capabilityPolicy.manifestFileDiscovery,
    capabilityPolicy.capabilityManifestFileDiscovery,
    uiState.manifestFileDiscovery,
    uiState.capabilityManifestFileDiscovery,
  );
  if (!source || booleanField(source.enabled) !== true) return undefined;
  const rootDir = stringField(source.rootDir) ?? stringField(source.root) ?? request.workspacePath;
  if (!rootDir) return undefined;
  const candidateFileNames = toStringList(source.candidateFileNames);
  const ignoredDirNames = toStringList(source.ignoredDirNames);
  return {
    enabled: true,
    rootDir: resolve(rootDir),
    maxDepth: numberField(source.maxDepth),
    candidateFileNames: candidateFileNames.length ? candidateFileNames : undefined,
    ignoredDirNames: ignoredDirNames.length ? ignoredDirNames : undefined,
  };
}

function brokerSkillHintsForRequest(
  request: GatewayRequest,
  capabilityPolicy: Record<string, unknown>,
): Array<string | CapabilityBrokerSkillHint> {
  void request;
  void capabilityPolicy;
  return [];
}

function brokerBlockedCapabilitiesForRequest(
  uiState: Record<string, unknown>,
  capabilityPolicy: Record<string, unknown>,
) {
  void uiState;
  void capabilityPolicy;
  return [];
}

function brokerToolBudgetForRequest(
  uiState: Record<string, unknown>,
  capabilityPolicy: Record<string, unknown>,
): CapabilityBrokerToolBudget | undefined {
  void uiState;
  void capabilityPolicy;
  return undefined;
}

function brokerVerificationPolicyForRequest(
  request: GatewayRequest,
  capabilityPolicy: Record<string, unknown>,
): CapabilityBrokerVerificationPolicyHint | undefined {
  void request;
  void capabilityPolicy;
  return undefined;
}

function brokerAvailableProvidersForRequest(
  uiState: Record<string, unknown>,
  capabilityPolicy: Record<string, unknown>,
): Array<string | CapabilityBrokerProviderAvailability> | undefined {
  void uiState;
  void capabilityPolicy;
  return undefined;
}

function uniqueSkillHints(values: Array<string | CapabilityBrokerSkillHint>) {
  const seen = new Set<string>();
  const out: Array<string | CapabilityBrokerSkillHint> = [];
  for (const value of values) {
    const key = typeof value === 'string'
      ? value
      : value.id ?? value.capabilityId ?? value.manifestRef ?? `${value.kind ?? ''}:${value.reason ?? ''}:${value.source ?? ''}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
  return values.find(isRecord);
}

function mergeBrokerRefs(values: Array<Record<string, unknown>>): CapabilityBrokerObjectRef[] {
  const seen = new Set<string>();
  const out: CapabilityBrokerObjectRef[] = [];
  for (const value of values) {
    const ref = stringField(value.ref) ?? stringField(value.dataRef) ?? stringField(value.path);
    const key = ref ?? stringField(value.id) ?? JSON.stringify(clipForAgentServerJson(value, 1));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: stringField(value.id),
      ref,
      kind: stringField(value.kind) ?? stringField(value.type),
      artifactType: stringField(value.artifactType) ?? stringField(value.type),
      title: stringField(value.title) ?? stringField(value.name),
      summary: stringField(value.summary) ?? stringField(value.description),
      path: stringField(value.path),
    });
  }
  return out;
}

function brokerArtifactIndexEntry(value: Record<string, unknown>): CapabilityBrokerArtifactIndexEntry {
  return {
    id: stringField(value.id),
    ref: stringField(value.ref) ?? stringField(value.dataRef),
    artifactType: stringField(value.artifactType) ?? stringField(value.type),
    title: stringField(value.title) ?? stringField(value.name),
    summary: stringField(value.summary) ?? stringField(value.description) ?? stringField(value.message),
    path: stringField(value.path),
    tags: toStringList(value.tags).slice(0, 8),
  };
}

function uniqueStrings(values: unknown) {
  return [...new Set(toStringList(values))];
}

function summarizeFailureRecoveryPolicy(value: unknown) {
  const policy = isRecord(value) ? value : {};
  const attempts = toRecordList(policy.attemptHistory);
  const direct = {
    mode: typeof policy.mode === 'string' ? policy.mode : undefined,
    failureReason: typeof policy.priorFailureReason === 'string'
      ? clipForAgentServerPrompt(policy.priorFailureReason, 700)
      : undefined,
    recoverActions: toStringList(policy.recoverActions).slice(0, 5),
    nextStep: typeof policy.nextStep === 'string' ? clipForAgentServerPrompt(policy.nextStep, 300) : undefined,
    evidenceRefs: failureEvidenceRefs(policy),
  };
  const summarizedAttempts = attempts.map((attempt) => ({
    id: typeof attempt.id === 'string' ? attempt.id : undefined,
    status: typeof attempt.status === 'string' ? attempt.status : undefined,
    tool: typeof attempt.tool === 'string' ? attempt.tool : undefined,
    failureReason: typeof attempt.failureReason === 'string' ? clipForAgentServerPrompt(attempt.failureReason, 500) : undefined,
    recoverActions: toStringList(attempt.recoverActions).slice(0, 4),
    nextStep: typeof attempt.nextStep === 'string' ? clipForAgentServerPrompt(attempt.nextStep, 250) : undefined,
    evidenceRefs: failureEvidenceRefs(attempt),
    workEvidenceSummary: summarizeWorkEvidenceForHandoff(attempt.workEvidenceSummary ?? attempt),
  })).filter((attempt) => attempt.failureReason || attempt.evidenceRefs.length || attempt.recoverActions.length);
  const out = [direct, ...summarizedAttempts]
    .filter((entry) => entry.failureReason || entry.evidenceRefs.length || entry.recoverActions.length);
  return out.slice(-4).map((entry) => clipForAgentServerJson(entry, 3));
}

function failureEvidenceRefs(value: unknown) {
  const record = isRecord(value) ? value : {};
  const refs = [
    ...toStringList(record.evidenceRefs),
    ...toStringList(record.attemptHistoryRefs),
    ...['ref', 'codeRef', 'outputRef', 'stdoutRef', 'stderrRef', 'traceRef'].flatMap((key) => {
      const item = record[key];
      return typeof item === 'string' && item.trim() ? [item.trim()] : [];
    }),
  ];
  for (const attempt of toRecordList(record.attemptHistory)) {
    refs.push(...failureEvidenceRefs(attempt));
  }
  return Array.from(new Set(refs)).slice(0, 12);
}

function policyConversationEntries(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === 'string') return [entry];
    if (!isRecord(entry)) return [];
    const role = typeof entry.role === 'string' ? entry.role : 'unknown';
    const content = typeof entry.content === 'string'
      ? entry.content
      : typeof entry.summary === 'string'
        ? entry.summary
        : '';
    return content.trim() ? [`${role}: ${content}`] : [];
  });
}

function executionModeDecisionForEnvelope(uiState: Record<string, unknown>) {
  const direct = isRecord(uiState.executionModeDecision) ? uiState.executionModeDecision : undefined;
  const policy = isRecord(uiState.conversationPolicy) && isRecord(uiState.conversationPolicy.executionModePlan)
    ? uiState.conversationPolicy.executionModePlan
    : undefined;
  const source = direct ?? policy ?? {};
  return {
    executionModeRecommendation: stringField(source.executionModeRecommendation) ?? stringField(source.executionMode) ?? 'unknown',
    complexityScore: numberField(source.complexityScore) ?? stringField(source.complexityScore) ?? 'unknown',
    uncertaintyScore: numberField(source.uncertaintyScore) ?? stringField(source.uncertaintyScore) ?? 'unknown',
    reproducibilityLevel: stringField(source.reproducibilityLevel) ?? 'unknown',
    stagePlanHint: stagePlanHintField(source.stagePlanHint) ?? 'backend-decides',
    executionModeReason: stringField(source.executionModeReason) ?? stringField(source.reason) ?? 'backend-decides',
  };
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

function pruneUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(pruneUndefined);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    out[key] = pruneUndefined(entry);
  }
  return out;
}

function stagePlanHintField(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim());
    return items.length ? items : undefined;
  }
  return undefined;
}

export function expectedArtifactSchema(request: GatewayRequest | SciForgeSkillDomain): Record<string, unknown> {
  const skillDomain = typeof request === 'string' ? request : request.skillDomain;
  const types = typeof request === 'string' ? [] : expectedArtifactTypesForRequest(request);
  if (types.length) return { types };
  if (typeof request !== 'string') {
    return {
      types: [],
      mode: 'backend-decides',
      note: 'No current-turn artifact type was explicitly required; infer the minimal output from rawUserPrompt and explicit references.',
    };
  }
  return defaultArtifactSchemaForSkillDomain(skillDomain);
}

function contextEnvelopeMode(request: GatewayRequest): AgentServerContextMode {
  const recentConversation = toStringList(request.uiState?.recentConversation);
  const recentExecutionRefs = toRecordList(request.uiState?.recentExecutionRefs);
  return recentConversation.length > 1 || recentExecutionRefs.length > 0 || request.artifacts.length > 0 ? 'delta' : 'full';
}

export function summarizeArtifactRefs(artifacts: Array<Record<string, unknown>>) {
  return artifacts.slice(-8).map((artifact) => {
    const id = typeof artifact.id === 'string' ? artifact.id : undefined;
    const type = typeof artifact.type === 'string' ? artifact.type : undefined;
    const title = typeof artifact.title === 'string'
      ? artifact.title
      : typeof artifact.name === 'string'
        ? artifact.name
        : undefined;
    return {
      id,
      type,
      title: clipForAgentServerPrompt(title, 240),
      ref: typeof artifact.ref === 'string' ? artifact.ref : undefined,
      path: typeof artifact.path === 'string' ? artifact.path : undefined,
      dataRef: typeof artifact.dataRef === 'string' ? artifact.dataRef : undefined,
      outputRef: typeof artifact.outputRef === 'string' ? artifact.outputRef : undefined,
      metadata: isRecord(artifact.metadata) ? clipForAgentServerJson(artifact.metadata, 2) : undefined,
      dataSummary: isRecord(artifact.data) ? clipForAgentServerJson(artifact.data, 2) : undefined,
      keys: Object.keys(artifact).slice(0, 12),
      hash: hashJson(artifact),
    };
  });
}

export function summarizeExecutionRefs(refs: Array<Record<string, unknown>>) {
  return refs.slice(-12).map((entry) => ({
    id: typeof entry.id === 'string' ? entry.id : undefined,
    status: typeof entry.status === 'string' ? entry.status : undefined,
    tool: typeof entry.tool === 'string' ? entry.tool : undefined,
    codeRef: typeof entry.codeRef === 'string' ? entry.codeRef : undefined,
    inputRef: typeof entry.inputRef === 'string' ? entry.inputRef : undefined,
    outputRef: typeof entry.outputRef === 'string' ? entry.outputRef : undefined,
    stdoutRef: typeof entry.stdoutRef === 'string' ? entry.stdoutRef : undefined,
    stderrRef: typeof entry.stderrRef === 'string' ? entry.stderrRef : undefined,
    failureReason: clipForAgentServerPrompt(entry.failureReason, 480),
    hash: hashJson(entry),
  }));
}

export function summarizeConversationPolicyForAgentServer(value: unknown) {
  const source = isRecord(value) ? value : {};
  const latency = isRecord(source.latencyPolicy) ? source.latencyPolicy : source;
  const response = isRecord(source.responsePlan) ? source.responsePlan : source;
  const background = isRecord(source.backgroundPlan) ? source.backgroundPlan : source;
  const cache = isRecord(source.cachePolicy) ? source.cachePolicy : source;
  return pruneUndefined({
    latencyPolicy: {
      firstVisibleResponseMs: numberField(latency.firstVisibleResponseMs),
      firstEventWarningMs: numberField(latency.firstEventWarningMs),
      silentRetryMs: numberField(latency.silentRetryMs),
      allowBackgroundCompletion: booleanField(latency.allowBackgroundCompletion),
      blockOnContextCompaction: booleanField(latency.blockOnContextCompaction),
      blockOnVerification: booleanField(latency.blockOnVerification),
      reason: clipForAgentServerPrompt(latency.reason, 320),
    },
    responsePlan: {
      initialResponseMode: stringField(response.initialResponseMode),
      finalizationMode: stringField(response.finalizationMode),
      userVisibleProgress: toStringList(response.userVisibleProgress).slice(0, 8),
      fallbackMessagePolicy: stringField(response.fallbackMessagePolicy),
      reason: clipForAgentServerPrompt(response.reason, 320),
    },
    backgroundPlan: {
      enabled: booleanField(background.enabled),
      tasks: toStringList(background.tasks).slice(0, 8),
      handoffRefsRequired: booleanField(background.handoffRefsRequired),
      cancelOnNewUserTurn: booleanField(background.cancelOnNewUserTurn),
      reason: clipForAgentServerPrompt(background.reason, 320),
    },
    cachePolicy: {
      reuseScenarioPlan: booleanField(cache.reuseScenarioPlan),
      reuseSkillPlan: booleanField(cache.reuseSkillPlan),
      reuseUiPlan: booleanField(cache.reuseUiPlan ?? cache.reuseUIPlan),
      reuseReferenceDigests: booleanField(cache.reuseReferenceDigests),
      reuseArtifactIndex: booleanField(cache.reuseArtifactIndex),
      reuseLastSuccessfulStage: booleanField(cache.reuseLastSuccessfulStage),
      reuseBackendSession: booleanField(cache.reuseBackendSession),
      reason: clipForAgentServerPrompt(cache.reason, 320),
    },
  });
}

function summarizeVerificationResults(request: GatewayRequest) {
  const fromArtifacts = runtimeVerificationResultArtifacts(request.artifacts)
    .map((artifact) => ({
      id: artifact.id,
      dataRef: artifact.dataRef,
      metadata: isRecord(artifact.metadata) ? clipForAgentServerJson(artifact.metadata, 2) : undefined,
      data: isRecord(artifact.data) ? clipForAgentServerJson(artifact.data, 2) : undefined,
    }));
  const fromUiState = toRecordList(request.uiState?.verificationResults)
    .map((entry) => clipForAgentServerJson(entry, 2));
  const explicit = request.verificationResult ? [clipForAgentServerJson(request.verificationResult, 2)] : [];
  const recent = (request.recentVerificationResults ?? []).map((entry) => clipForAgentServerJson(entry, 2));
  const combined = [...fromArtifacts, ...fromUiState, ...recent, ...explicit].slice(-6);
  return combined.length ? combined : undefined;
}

export function summarizeConversationLedger(ledger: Array<Record<string, unknown>>, mode: AgentServerContextMode) {
  if (!ledger.length) return undefined;
  const budget = mode === 'full' ? 24 : 18;
  const tail = ledger.slice(-budget).map((entry) => clipForAgentServerJson(entry, 3));
  const omitted = Math.max(0, ledger.length - tail.length);
  return {
    totalTurns: ledger.length,
    omittedPrefixTurns: omitted,
    ordering: 'append-only-session-order',
    tail,
  };
}

export function summarizeTaskAttemptsForAgentServer(attempts: unknown[]) {
  return attempts
    .filter(isRecord)
    .slice(0, 4)
    .map((attempt) => ({
      id: typeof attempt.id === 'string' ? attempt.id : undefined,
      attempt: typeof attempt.attempt === 'number' ? attempt.attempt : undefined,
      status: typeof attempt.status === 'string' ? attempt.status : undefined,
      skillDomain: typeof attempt.skillDomain === 'string' ? attempt.skillDomain : undefined,
      skillId: typeof attempt.skillId === 'string' ? attempt.skillId : undefined,
      codeRef: typeof attempt.codeRef === 'string' ? attempt.codeRef : undefined,
      inputRef: typeof attempt.inputRef === 'string' ? attempt.inputRef : undefined,
      outputRef: typeof attempt.outputRef === 'string' ? attempt.outputRef : undefined,
      stdoutRef: typeof attempt.stdoutRef === 'string' ? attempt.stdoutRef : undefined,
      stderrRef: typeof attempt.stderrRef === 'string' ? attempt.stderrRef : undefined,
      failureReason: clipForAgentServerPrompt(attempt.failureReason, 800),
      schemaErrors: Array.isArray(attempt.schemaErrors)
        ? attempt.schemaErrors.map((entry) => clipForAgentServerPrompt(entry, 240)).filter(Boolean).slice(0, 8)
        : undefined,
      workEvidenceSummary: summarizeWorkEvidenceForHandoff(attempt.workEvidenceSummary ?? attempt),
      patchSummary: clipForAgentServerPrompt(attempt.patchSummary, 800),
      diffRef: typeof attempt.diffRef === 'string' ? attempt.diffRef : undefined,
      scenarioPackageRef: isRecord(attempt.scenarioPackageRef) ? attempt.scenarioPackageRef : undefined,
      skillPlanRef: typeof attempt.skillPlanRef === 'string' ? attempt.skillPlanRef : undefined,
      uiPlanRef: typeof attempt.uiPlanRef === 'string' ? attempt.uiPlanRef : undefined,
      createdAt: typeof attempt.createdAt === 'string' ? attempt.createdAt : undefined,
    }));
}
