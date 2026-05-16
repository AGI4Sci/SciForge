import { resolve } from 'node:path';
import { conversationSummaryLooksDigestOnly, currentUserRequestFromPrompt } from '@sciforge-ui/runtime-contract/conversation-policy';
import { defaultArtifactSchemaForSkillDomain } from '@sciforge-ui/runtime-contract/artifact-policy';
import { collectRuntimeRefsFromValue } from '@sciforge-ui/runtime-contract/references';
import { runtimeVerificationResultArtifacts } from '@sciforge-ui/runtime-contract/verification-result';
import { buildStartupContextEnvelope, type StartupCapabilityBriefInput } from '../../../packages/agent-harness/src/startup-context.js';
import type { CapabilityCostClass, CapabilityLatencyClass, CapabilitySideEffectClass, LatencyTier, StartupContextEnvelope } from '../../../packages/agent-harness/src/contracts.js';
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
import { sessionBundleRelForRequest } from '../session-bundle.js';
import { applyContextEnvelopeRecordGovernance, contextEnvelopeGovernanceAudit, contextEnvelopeGovernanceForRequest } from './context-envelope-governance.js';
import { summarizeWorkEvidenceForHandoff } from './work-evidence-types.js';
import {
  capabilityBrokerHarnessInputProjectionForRequest,
  mergeCapabilityBrokerAvailableProviders,
  mergeCapabilityBrokerToolBudgets,
  mergeCapabilityBrokerVerificationPolicies,
} from './capability-broker-harness-input.js';
import { capabilityProviderRoutesForHandoff } from './capability-provider-preflight.js';
import { contextProjectionForEnvelope } from './context-envelope-projection.js';
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
  const currentReferences = toRecordList(uiState.currentReferences);
  const currentReferenceDigests = toRecordList(uiState.currentReferenceDigests);
  const stateDigest = stateDigestForEnvelope(uiState);
  const stateDigestRefs = stateDigestRefsForEnvelope(stateDigest);
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
  const capabilityProviderRoutes = capabilityProviderRoutesForHandoff(request);
  const sessionBundleRef = sessionBundleRelForRequest(request);
  const capabilityBrief = capabilityBriefProjectionFromBrokerBrief(capabilityBrokerBrief, uiState.capabilityBrief);
  const verificationPolicy = request.verificationPolicy ?? brokerVerificationPolicyForRequest(request, brokerCapabilityPolicyForRequest(request));
  const startupContextEnvelope = buildStartupContextEnvelopeForRequest(request, {
    workspace: params.workspace,
    capabilityBrokerBrief,
    artifactRefs: summarizeArtifactRefs(request.artifacts).flatMap(startupRefsFromRecord),
    recentExecutionRefs: summarizeExecutionRefs(recentExecutionRefs).flatMap(startupRefsFromRecord),
    previousEnvelope: startupContextEnvelopeFromUiState(uiState),
  });
  const contextProjection = contextProjectionForEnvelope(uiState);
  return {
    version: 'sciforge.context-envelope.v1',
    mode,
    createdAt: new Date().toISOString(),
    hashes: {
      workspaceTree: hashJson(workspaceTree),
      artifacts: hashJson(request.artifacts),
      recentExecutionRefs: hashJson(recentExecutionRefs),
      priorAttempts: hashJson(params.priorAttempts ?? []),
      startupContextEnvelope: startupContextEnvelope.hash,
    },
    startupContextEnvelope,
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
      sessionBundleRef,
      sessionResourceRoot: sessionBundleRef,
      taskDir: `${sessionBundleRef}/tasks/`,
      taskResultDir: `${sessionBundleRef}/task-results/`,
      logDir: `${sessionBundleRef}/logs/`,
      artifactDir: `${sessionBundleRef}/artifacts/`,
      dataDir: `${sessionBundleRef}/data/`,
      exportDir: `${sessionBundleRef}/exports/`,
      workspaceTreeSummary: workspaceTree,
      workspaceTreeHash: hashJson(workspaceTree),
      workspaceTreeEntryCount: workspaceTree.length,
    } : {
      workspacePath: params.workspace,
      sessionBundleRef,
      dirs: {
        task: `${sessionBundleRef}/tasks/`,
        result: `${sessionBundleRef}/task-results/`,
        log: `${sessionBundleRef}/logs/`,
        artifact: `${sessionBundleRef}/artifacts/`,
        data: `${sessionBundleRef}/data/`,
        export: `${sessionBundleRef}/exports/`,
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
      failureRecoveryPolicy: summarizeFailureRecoveryPolicy(failureRecoveryPolicy),
      capabilityBrokerBrief,
      capabilityProviderRoutes,
      capabilityBrief,
      verificationPolicy,
      evidenceExpansionPolicy: evidenceExpansionPolicySummaryForEnvelope(request),
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
      stateDigest,
      conversationPolicySummary,
      ...executionModeDecision,
      contextProjection,
      boundedSessionRefs: boundedSessionRefsForEnvelope({
        artifacts: request.artifacts,
        recentExecutionRefs,
        verificationResults: [
          request.verificationResult,
          ...(request.recentVerificationResults ?? []),
          uiState.verificationResult,
          ...toRecordList(uiState.recentVerificationResults),
          ...toRecordList(uiState.verificationResults),
        ],
        stateDigestRefs,
      }),
      contextReusePolicy: contextReusePolicy ? clipForAgentServerJson(contextReusePolicy, 3) : undefined,
      recentRuns: Array.isArray(uiState.recentRuns)
        ? summarizeRecentRunsForEnvelope(uiState.recentRuns, mode)
        : undefined,
      recentFailures: recentFailures.length ? recentFailures : undefined,
      verificationResult: summarizeVerificationRecordForEnvelope(
        request.verificationResult ?? uiState.verificationResult,
        'sessionFacts.verificationResult',
      ),
      recentVerificationResults: summarizeVerificationResultRecords([
        ...(request.recentVerificationResults ?? []),
        ...toRecordList(uiState.recentVerificationResults),
      ], 'sessionFacts.recentVerificationResults'),
    },
    longTermRefs: {
      artifacts: summarizeArtifactRefs(request.artifacts),
      recentExecutionRefs: summarizeExecutionRefs(recentExecutionRefs),
      verificationResults: summarizeVerificationResults(request),
      stateDigestRefs: stateDigestRefs.length ? stateDigestRefs : undefined,
      failureEvidenceRefs: failureEvidenceRefs(failureRecoveryPolicy),
      priorAttempts: summarizeTaskAttemptsForAgentServer(params.priorAttempts ?? []).slice(0, mode === 'full' ? 4 : 2),
      repairRefs: params.repairRefs,
    },
  };
}

function evidenceExpansionPolicySummaryForEnvelope(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const policyRecord = isRecord(uiState.failureRecoveryPolicy) && isRecord(uiState.failureRecoveryPolicy.evidenceExpansionPolicy)
    ? uiState.failureRecoveryPolicy.evidenceExpansionPolicy
    : undefined;
  const transportPolicy = policyRecord ? clipForAgentServerJson(policyRecord, 2) : undefined;
  return {
    schemaVersion: 'sciforge.evidence-expansion-policy.v1',
    authority: 'agent-harness-contract-or-runtime-policy',
    defaultAction: 'refs-and-digests-first',
    stdoutStderrRefs: 'cite-only-by-default',
    artifactBodies: 'prefer dataRef, path, markdownRef, or currentReferenceDigests; expand bounded excerpts only when needed',
    logBodyExpansion: 'requires-explicit-policy',
    structuredRefTransport: 'refs-and-digests-first',
    currentTurnRawLogRequestSignal: rawLogExpansionAuthorizedByPolicy(policyRecord),
    expansionRequiresPolicyTrace: true,
    source: 'runtime-context-projection',
    uiTransportPolicy: transportPolicy,
  };
}

function rawLogExpansionAuthorizedByPolicy(policy: unknown) {
  if (!isRecord(policy)) return false;
  const mode = stringField(policy.rawLogMode) ?? stringField(policy.logExpansionMode) ?? stringField(policy.stdoutStderrMode);
  return policy.allowRawLogExpansion === true
    || policy.allowStdoutStderrExpansion === true
    || mode === 'allow-bounded'
    || mode === 'allowed'
    || mode === 'required';
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
        'sessionFacts.contextProjection',
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

export function buildStartupContextEnvelopeForRequest(
  request: GatewayRequest,
  params: {
    workspace: string;
    capabilityBrokerBrief?: Record<string, unknown>;
    artifactRefs?: string[];
    recentExecutionRefs?: string[];
    previousEnvelope?: StartupContextEnvelope;
  },
) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const agentHarness = isRecord(uiState.agentHarness) ? uiState.agentHarness : {};
  const contract = isRecord(agentHarness.contract) ? agentHarness.contract : {};
  const toolBudget = isRecord(contract.toolBudget) ? contract.toolBudget : {};
  const contextBudget = isRecord(contract.contextBudget) ? contract.contextBudget : {};
  const sideEffects = isRecord(contract.capabilityPolicy) && isRecord(contract.capabilityPolicy.sideEffects)
    ? contract.capabilityPolicy.sideEffects
    : {};
  const currentRefs = [
    ...startupRefsFromRecords(toRecordList(uiState.currentReferences)),
    ...startupRefsFromRecords(toRecordList(uiState.currentReferenceDigests)),
    ...stateDigestRefsForEnvelope(stateDigestForEnvelope(uiState)),
  ];
  const recentRuns = toRecordList(uiState.recentRuns).slice(-8).map((run) => ({
    id: stringField(run.id),
    ref: stringField(run.ref) ?? stringField(run.outputRef) ?? stringField(run.artifactRef),
    status: stringField(run.status),
    hash: hashJson(run),
  }));
  return buildStartupContextEnvelope({
    workspaceRoot: params.workspace,
    previousEnvelope: params.previousEnvelope,
    session: {
      sessionId: stringField(uiState.sessionId),
      runId: stringField(uiState.runId) ?? stringField(uiState.currentRunId),
      backend: stringField(request.agentBackend) ?? stringField(uiState.agentBackend),
      currentPrompt: request.prompt,
    },
    scenario: {
      skillDomain: request.skillDomain,
      scenarioPackageRef: request.scenarioPackageRef?.id,
      expectedArtifactTypes: expectedArtifactTypesForRequest(request),
      selectedComponentIds: selectedComponentIdsForRequest(request),
    },
    budget: {
      latencyTier: latencyTierField(contract.latencyTier),
      maxPromptTokens: numberField(contextBudget.maxPromptTokens),
      maxToolCalls: numberField(toolBudget.maxToolCalls),
      maxWallMs: numberField(toolBudget.maxWallMs),
    },
    permissions: {
      network: sideEffectAllowanceField(sideEffects.network),
      workspaceWrite: sideEffectAllowanceField(sideEffects.workspaceWrite),
      externalMutation: sideEffectAllowanceField(sideEffects.externalMutation),
      codeExecution: sideEffectAllowanceField(sideEffects.codeExecution),
    },
    currentRefs,
    artifactRefs: params.artifactRefs,
    recentExecutionRefs: params.recentExecutionRefs,
    recentRuns,
    capabilityBriefs: startupCapabilityBriefsFromBrokerBrief(params.capabilityBrokerBrief),
    sourceRefs: [
      'sciforge.context-envelope.v1',
      'sciforge.agentserver.capability-broker-brief.v1',
      ...(stringField(agentHarness.contractRef) ? [stringField(agentHarness.contractRef) as string] : []),
      ...(stringField(agentHarness.traceRef) ? [stringField(agentHarness.traceRef) as string] : []),
    ],
    policyReminders: [
      'Startup context is the first source for workspace/session/capability facts.',
      'Use onDemandExpansion refs before reading full manifests, docs, logs, or artifact bodies.',
    ],
  });
}

function startupCapabilityBriefsFromBrokerBrief(value: unknown): StartupCapabilityBriefInput[] {
  const broker = isRecord(value) ? value : {};
  return toRecordList(broker.briefs).slice(0, 24).map((brief) => {
    const id = stringField(brief.id) ?? 'unknown-capability';
    const routingTags = toStringList(brief.routingTags);
    return {
      id,
      name: stringField(brief.name) ?? id,
      purpose: stringField(brief.brief),
      manifestRef: `capability:${id}`,
      inputRefs: toStringList(brief.domains).map((domain) => `domain:${domain}`),
      outputRefs: routingTags.map((tag) => `routing:${tag}`),
      costClass: capabilityCostClassField(brief.costClass),
      latencyClass: capabilityLatencyClassField(brief.latencyClass),
      sideEffectClass: capabilitySideEffectClassField(brief.sideEffectClass),
      artifactTypes: routingTags.filter((tag) => tag.includes('artifact') || tag.includes('report') || tag.includes('matrix')),
      sourceRef: 'sciforge.agentserver.capability-broker-brief.v1',
      hash: hashJson(brief),
    };
  });
}

function startupContextEnvelopeFromUiState(uiState: Record<string, unknown>): StartupContextEnvelope | undefined {
  const candidate = uiState.startupContextEnvelope ?? (isRecord(uiState.agentHarness) ? uiState.agentHarness.startupContextEnvelope : undefined);
  if (!isRecord(candidate) || candidate.schemaVersion !== 'sciforge.startup-context-envelope.v1') return undefined;
  return candidate as unknown as StartupContextEnvelope;
}

function startupRefsFromRecords(records: Array<Record<string, unknown>>) {
  return records.flatMap(startupRefsFromRecord);
}

function startupRefsFromRecord(record: Record<string, unknown>) {
  const refs = ['ref', 'artifactRef', 'dataRef', 'outputRef', 'stdoutRef', 'stderrRef', 'path', 'id']
    .map((key) => stringField(record[key]))
    .filter((entry): entry is string => Boolean(entry));
  return uniqueStrings(refs);
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
    ...stateDigestRefsForEnvelope(stateDigestForEnvelope(uiState)).map((ref) => ({ ref, kind: refKindForStateDigestRef(ref) })),
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
    if (typeof entry === 'string') return [conversationTextDigestLine('unknown', entry, [])];
    if (!isRecord(entry)) return [];
    const role = typeof entry.role === 'string' ? entry.role : 'unknown';
    const refs = [
      ...toStringList(entry.refs),
      ...toStringList(entry.references),
      ...toStringList(entry.objectReferences),
      ...digestRefs(entry.contentDigest),
      ...digestRefs(entry.messageDigest),
      ...digestRefs(entry.payloadDigest),
    ];
    if (typeof entry.content === 'string') return [conversationTextDigestLine(role, entry.content, refs)];
    const digest = firstRecord(entry.contentDigest, entry.messageDigest, entry.payloadDigest);
    if (digest) {
      const hash = stringField(digest.hash) ?? 'none';
      const chars = typeof digest.chars === 'number' ? digest.chars : 0;
      return [`${role}: session-message-body omitted; hash=${hash}; chars=${chars}${refs.length ? `; refs=${refs.slice(0, 4).join(', ')}` : ''}`];
    }
    return refs.length ? [`${role}: session-message-body omitted; refs=${refs.slice(0, 4).join(', ')}`] : [];
  });
}

function conversationTextDigestLine(role: string, text: string, refs: string[]) {
  return `${role}: session-message-body omitted; hash=${hashJson(text)}; chars=${text.length}${refs.length ? `; refs=${refs.slice(0, 4).join(', ')}` : ''}`;
}

function digestRefs(value: unknown) {
  return isRecord(value) ? toStringList(value.refs) : [];
}

function stateDigestForEnvelope(uiState: Record<string, unknown>) {
  const candidate = firstRecord(
    uiState.stateDigest,
    uiState.conversationStateDigest,
    isRecord(uiState.conversationPolicy) ? uiState.conversationPolicy.stateDigest : undefined,
    isRecord(uiState.contextCompaction) ? uiState.contextCompaction.stateDigest : undefined,
  );
  if (!candidate) return undefined;
  return clipForAgentServerJson(pruneUndefined({
    schemaVersion: stringField(candidate.schemaVersion),
    taskId: stringField(candidate.taskId),
    relation: stringField(candidate.relation),
    summary: clipForAgentServerPrompt(candidate.summary, 700),
    handoffPolicy: stringField(candidate.handoffPolicy),
    stateRefs: toStringList(candidate.stateRefs).slice(0, 12),
    completedRefs: toStringList(candidate.completedRefs).slice(0, 12),
    carryForwardRefs: toStringList(candidate.carryForwardRefs).slice(0, 16),
    pendingWork: toStringList(candidate.pendingWork).slice(0, 12),
    blockedWork: toStringList(candidate.blockedWork).slice(0, 12),
    recoverableActions: toStringList(candidate.recoverableActions).slice(0, 12),
    backgroundJobs: toStringList(candidate.backgroundJobs).slice(0, 12),
    invalidatedRefs: toStringList(candidate.invalidatedRefs).slice(0, 12),
    uncertainty: toStringList(candidate.uncertainty).slice(0, 8),
  }), 3) as Record<string, unknown>;
}

function stateDigestRefsForEnvelope(stateDigest: Record<string, unknown> | undefined) {
  if (!stateDigest) return [];
  return uniqueStrings([
    ...toStringList(stateDigest.stateRefs),
    ...toStringList(stateDigest.completedRefs),
    ...toStringList(stateDigest.carryForwardRefs),
  ]);
}

function refKindForStateDigestRef(ref: string) {
  if (/^run[:/]/i.test(ref) || /\.sciforge\/(?:runs|task-results|logs)\//.test(ref)) return 'run-ref';
  if (/^artifact[:/]/i.test(ref) || /\.sciforge\/artifacts\//.test(ref)) return 'artifact-ref';
  return 'state-ref';
}

function summarizeRecentRunsForEnvelope(value: unknown[], mode: AgentServerContextMode) {
  const runs = mode === 'full' ? value.slice(-8) : value.slice(-4);
  return runs.map((entry) => {
    if (!isRecord(entry)) return clipForAgentServerJson(entry, 1);
    return clipForAgentServerJson(pruneUndefined({
      id: stringField(entry.id) ?? stringField(entry.runId),
      status: stringField(entry.status),
      ref: stringField(entry.ref),
      outputRef: stringField(entry.outputRef),
      stdoutRef: stringField(entry.stdoutRef),
      stderrRef: stringField(entry.stderrRef),
      artifactRefs: toStringList(entry.artifactRefs).slice(0, 8),
      summary: clipForAgentServerPrompt(entry.summary, 500),
      failureReason: clipForAgentServerPrompt(entry.failureReason, 500),
      hash: hashJson(entry),
    }), 2);
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

function sideEffectAllowanceField(value: unknown) {
  return value === 'block' || value === 'requires-approval' || value === 'allow' ? value : undefined;
}

function latencyTierField(value: unknown): LatencyTier | undefined {
  return value === 'instant' || value === 'quick' || value === 'bounded' || value === 'deep' || value === 'background'
    ? value
    : undefined;
}

function capabilityCostClassField(value: unknown): CapabilityCostClass | undefined {
  return value === 'free' || value === 'low' || value === 'medium' || value === 'high'
    ? value
    : value === 'none'
      ? 'free'
      : undefined;
}

function capabilityLatencyClassField(value: unknown): CapabilityLatencyClass | undefined {
  if (value === 'instant' || value === 'short' || value === 'bounded' || value === 'long' || value === 'background') return value;
  if (value === 'low') return 'short';
  if (value === 'medium') return 'bounded';
  if (value === 'high') return 'long';
  return undefined;
}

function capabilitySideEffectClassField(value: unknown): CapabilitySideEffectClass | undefined {
  return value === 'none' || value === 'read' || value === 'write' || value === 'network' || value === 'desktop' || value === 'external'
    ? value
    : undefined;
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
      dataSummary: artifactDataSummaryForAgentServer(artifact),
      keys: Object.keys(artifact).slice(0, 12),
      hash: hashJson(artifact),
    };
  });
}

function artifactDataSummaryForAgentServer(artifact: Record<string, unknown>) {
  const data = artifact.data;
  if (data === undefined) return undefined;
  if (typeof artifact.dataRef === 'string' || typeof artifact.path === 'string' || typeof artifact.ref === 'string') {
    return {
      omitted: 'ref-backed-artifact-data',
      refs: [artifact.ref, artifact.dataRef, artifact.path, artifact.outputRef]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
      shape: artifactDataShape(data),
    };
  }
  if (typeof data === 'string') return clipForAgentServerPrompt(data, 900);
  return clipForAgentServerJson(data, 1);
}

function artifactDataShape(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return { kind: 'string', chars: value.length };
  if (Array.isArray(value)) return { kind: 'array', count: value.length };
  if (isRecord(value)) {
    const markdown = typeof value.markdown === 'string' ? value.markdown : undefined;
    return {
      kind: 'object',
      keys: Object.keys(value).slice(0, 16),
      markdownChars: markdown?.length,
    };
  }
  return { kind: typeof value };
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

export function boundedSessionRefsForEnvelope(input: {
  artifacts?: Array<Record<string, unknown>>;
  recentExecutionRefs?: Array<Record<string, unknown>>;
  verificationResults?: unknown[];
  stateDigestRefs?: string[];
}) {
  const artifacts = summarizeArtifactRefs(input.artifacts ?? []);
  const recentExecutionRefs = summarizeExecutionRefs(input.recentExecutionRefs ?? []);
  const verificationResults = summarizeVerificationResultRecords(
    input.verificationResults ?? [],
    'sessionFacts.boundedSessionRefs.verificationResults',
  );
  const artifactRefs = artifacts.flatMap((entry) => refsFromRecord(entry));
  const executionRefs = recentExecutionRefs.flatMap((entry) => refsFromRecord(entry));
  const verificationRefs = verificationResults.flatMap((entry) => [
    ...toStringList(entry.evidenceRefs),
    ...toStringList(entry.refs),
  ]);
  const allRefs = uniqueStrings([
    ...artifactRefs,
    ...executionRefs,
    ...verificationRefs,
    ...(input.stateDigestRefs ?? []),
  ]).slice(0, 48);
  if (!artifacts.length && !recentExecutionRefs.length && !verificationResults.length && !allRefs.length) return undefined;
  return pruneUndefined({
    schemaVersion: 'sciforge.bounded-session-refs.v1',
    policy: 'refs-and-digests-only; expand artifact, log, task-result, or verification bodies only when current-turn policy explicitly requests it',
    artifacts,
    recentExecutionRefs,
    verificationResults,
    stateDigestRefs: uniqueStrings(input.stateDigestRefs ?? []).slice(0, 16),
    allRefs,
  });
}

export function summarizeVerificationResultRecords(values: unknown[], source = 'verificationResults') {
  return values
    .map((entry, index) => summarizeVerificationRecordForEnvelope(entry, `${source}[${index}]`))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .slice(-6);
}

export function summarizeVerificationRecordForEnvelope(value: unknown, source = 'verificationResult') {
  if (!isRecord(value)) return undefined;
  const refs = verificationRecordRefs(value);
  const diagnostics = isRecord(value.diagnostics) ? value.diagnostics : undefined;
  const data = value.data ?? value.raw ?? value.payload ?? value.result;
  return pruneUndefined({
    schemaVersion: stringField(value.schemaVersion),
    source,
    id: stringField(value.id) ?? stringField(value.verificationId),
    verdict: stringField(value.verdict),
    status: stringField(value.status),
    dataRef: stringField(value.dataRef) ?? stringField(value.data_ref),
    rawRef: stringField(value.rawRef) ?? stringField(value.raw_ref),
    verificationRef: stringField(value.verificationRef) ?? stringField(value.verification_ref),
    confidence: numberField(value.confidence),
    reward: numberField(value.reward),
    critique: verificationTextSummary(value.critique ?? value.summary ?? value.message, 600),
    evidenceRefs: uniqueStrings([
      ...toStringList(value.evidenceRefs),
      ...toStringList(value.evidence_refs),
      ...toStringList(value.sourceRefs),
      ...toStringList(value.source_refs),
    ]).slice(0, 12),
    repairHints: toStringList(value.repairHints).slice(0, 8).map((hint) => verificationTextSummary(hint, 240)).filter(Boolean),
    refs,
    dataSummary: verificationPayloadSummary(data),
    diagnosticsSummary: diagnostics ? verificationPayloadSummary(diagnostics) : undefined,
    keys: Object.keys(value).slice(0, 16),
    hash: hashJson(value),
  }) as Record<string, unknown>;
}

function verificationTextSummary(value: unknown, limit: number) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return undefined;
  if (looksLikeRawCarrierText(text)) {
    return `[omitted raw-like verification text; chars=${text.length}; hash=${hashJson(text)}]`;
  }
  return clipForAgentServerPrompt(text, limit);
}

function looksLikeRawCarrierText(text: string) {
  if (text.length > 1200) return true;
  return /rawProviderPayload|providerResponse|task-results|stdout|stderr|traceback|stack trace|<html|<!doctype|%pdf|BEGIN [A-Z ]+|fullText|raw payload/i.test(text);
}

function verificationRecordRefs(record: Record<string, unknown>) {
  const refs = new Set<string>();
  for (const key of [
    'ref',
    'dataRef',
    'data_ref',
    'rawRef',
    'raw_ref',
    'providerRawRef',
    'provider_raw_ref',
    'verificationRef',
    'verification_ref',
    'sourceRef',
    'source_ref',
    'traceRef',
    'trace_ref',
    'outputRef',
    'output_ref',
    'reportRef',
    'report_ref',
    'artifactRef',
    'artifact_ref',
    'path',
  ]) {
    const ref = stringField(record[key]);
    if (ref) refs.add(ref);
  }
  for (const key of ['evidenceRefs', 'evidence_refs', 'sourceRefs', 'source_refs', 'artifactRefs', 'artifact_refs']) {
    for (const ref of toStringList(record[key])) refs.add(ref);
  }
  return Array.from(refs).slice(0, 16);
}

function refsFromRecord(record: Record<string, unknown>) {
  return uniqueStrings([
    ...['ref', 'path', 'dataRef', 'outputRef', 'stdoutRef', 'stderrRef', 'codeRef', 'inputRef']
      .map((key) => stringField(record[key]))
      .filter((entry): entry is string => Boolean(entry)),
    ...toStringList(record.artifactRefs),
    ...toStringList(record.refs),
  ]).slice(0, 16);
}

function verificationPayloadSummary(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  return pruneUndefined({
    omitted: 'verification-payload-body',
    ...payloadShapeSummary(value),
    refs: refsInValue(value).slice(0, 16),
    hash: hashJson(value),
  }) as Record<string, unknown>;
}

function payloadShapeSummary(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return { kind: 'string', chars: value.length };
  if (typeof value === 'number' || typeof value === 'boolean') return { kind: typeof value };
  if (Array.isArray(value)) {
    return {
      kind: 'array',
      count: value.length,
      itemKinds: uniqueStrings(value.slice(0, 12).map((entry) => Array.isArray(entry) ? 'array' : typeof entry)).slice(0, 6),
    };
  }
  if (isRecord(value)) {
    return {
      kind: 'object',
      keys: Object.keys(value).slice(0, 16),
      nestedRecordCount: recordsInValue(value).length,
    };
  }
  return { kind: value === null ? 'null' : typeof value };
}

function refsInValue(value: unknown, depth = 0): string[] {
  return collectRuntimeRefsFromValue(value, { maxDepth: 5 - depth, maxRefs: 32 });
}

function recordsInValue(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 5 || value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => recordsInValue(entry, depth + 1));
  if (!isRecord(value)) return [];
  return [value, ...Object.values(value).flatMap((entry) => recordsInValue(entry, depth + 1))];
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
    .map((artifact, index) => summarizeVerificationRecordForEnvelope({
      id: artifact.id,
      type: artifact.type,
      dataRef: artifact.dataRef,
      metadata: artifact.metadata,
      data: artifact.data,
    }, `longTermRefs.verificationResults.artifact[${index}]`));
  const fromUiState = toRecordList(request.uiState?.verificationResults)
    .map((entry, index) => summarizeVerificationRecordForEnvelope(entry, `longTermRefs.verificationResults.uiState[${index}]`));
  const explicit = request.verificationResult
    ? [summarizeVerificationRecordForEnvelope(request.verificationResult, 'longTermRefs.verificationResults.explicit')]
    : [];
  const recent = (request.recentVerificationResults ?? [])
    .map((entry, index) => summarizeVerificationRecordForEnvelope(entry, `longTermRefs.verificationResults.recent[${index}]`));
  const combined = [...fromArtifacts, ...fromUiState, ...recent, ...explicit]
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .slice(-6);
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
