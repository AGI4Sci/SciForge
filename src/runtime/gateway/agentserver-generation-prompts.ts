import type { SciForgeSkillDomain } from '../runtime-types.js';
import { extractAgentServerCurrentUserRequest } from '@sciforge-ui/runtime-contract/agentserver-prompt-policy';
import { agentServerArtifactSelectionPromptPolicyLines, agentServerBibliographicVerificationPromptPolicyLines, agentServerCurrentReferencePromptPolicyLines, agentServerShouldIncludeBibliographicVerificationPromptPolicy, agentServerToolPayloadProtocolContractLines } from '@sciforge-ui/runtime-contract/artifact-policy';
import { collectRuntimeRefsFromValue, runtimePayloadKeyLooksLikeBodyCarrier } from '@sciforge-ui/runtime-contract/references';
import { CAPABILITY_ROUTE_SUMMARY_SCHEMA_VERSION, agentServerBackendDecisionPromptPolicyLines, agentServerCapabilityRoutingPromptPolicyLines, agentServerContinuationPromptPolicyLines, agentServerCurrentTurnSnapshotPromptPolicyLines, agentServerExecutionModePromptPolicyLines, agentServerExternalIoReliabilityContractLines, agentServerFreshRetrievalPromptPolicyLines, agentServerGeneratedTaskPromptPolicyLines, agentServerGenerationOutputContract, agentServerGenerationOutputContractLines, agentServerLargeFilePromptContractLines, agentServerPriorAttemptsPromptPolicyLines, agentServerRepairPromptPolicyLines, agentServerToolPayloadShapeContract, agentServerViewSelectionPromptPolicyLines, agentServerWorkspaceTaskRoutingPromptPolicyLines } from '../../../packages/skills/runtime-policy';
import { summarizeArtifactRefs, summarizeConversationPolicyForAgentServer, summarizeExecutionRefs, summarizeTaskAttemptsForAgentServer, summarizeVerificationRecordForEnvelope, summarizeVerificationResultRecords } from './context-envelope.js';
import { AGENTSERVER_BACKEND_HANDOFF_VERSION, validateBackendHandoffPacket, type BackendHandoffPacket } from './agentserver-context-contract.js';
import { clipForAgentServerJson, clipForAgentServerPrompt, hashJson, isRecord, toRecordList, toStringList, uniqueStrings } from '../gateway-utils.js';

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function buildAgentServerGenerationPrompt(request: {
  prompt: string;
  skillDomain: SciForgeSkillDomain;
  metadata?: Record<string, unknown>;
  contextEnvelope?: Record<string, unknown>;
  workspaceTreeSummary: Array<{ path: string; kind: 'file' | 'folder'; sizeBytes?: number }>;
  availableSkills: Array<{
    id: string;
    kind: string;
    available: boolean;
    reason: string;
    description?: string;
    entrypointType?: string;
    manifestPath?: string;
    scopeDeclaration?: Record<string, unknown>;
  }>;
  availableTools?: Array<{
    id: string;
    label: string;
    toolType: string;
    description: string;
    producesArtifactTypes: string[];
    selected: boolean;
    docs?: { readmePath?: string; agentSummary?: string };
    packageRoot?: string;
    requiredConfig?: string[];
    tags?: string[];
    sensePlugin?: Record<string, unknown>;
  }>;
  availableRuntimeCapabilities?: Record<string, unknown>;
  artifactSchema: Record<string, unknown>;
  uiManifestContract: Record<string, unknown>;
  uiStateSummary?: Record<string, unknown>;
  artifacts?: Array<Record<string, unknown>>;
  recentExecutionRefs?: Array<Record<string, unknown>>;
  expectedArtifactTypes?: string[];
  selectedComponentIds?: string[];
  priorAttempts: unknown[];
  strictTaskFilesReason?: string;
  retryAudit?: unknown;
  freshCurrentTurn?: boolean;
  repairContinuation?: boolean;
  backendHandoffPacket?: BackendHandoffPacket;
  boundedRenderPlan?: Record<string, unknown>;
}) {
  const contextEnvelope = isRecord(request.contextEnvelope) ? request.contextEnvelope : {};
  const sessionFacts = isRecord(contextEnvelope.sessionFacts) ? contextEnvelope.sessionFacts : {};
  const scenarioFacts = isRecord(contextEnvelope.scenarioFacts) ? contextEnvelope.scenarioFacts : {};
  const currentUserRequest = stringField(sessionFacts.currentUserRequest) ?? extractAgentServerCurrentUserRequest(request.prompt);
  const executionMode = executionModeDecisionForPrompt(sessionFacts, scenarioFacts);
  const rawConversationPolicySummary = isRecord(sessionFacts.conversationPolicySummary)
    ? sessionFacts.conversationPolicySummary
    : isRecord(scenarioFacts.conversationPolicySummary)
      ? scenarioFacts.conversationPolicySummary
      : summarizeConversationPolicyForAgentServer(request.uiStateSummary);
  const conversationPolicySummary = isRecord(rawConversationPolicySummary) ? rawConversationPolicySummary : undefined;
  const capabilityBrokerBrief = isRecord(scenarioFacts.capabilityBrokerBrief)
    ? scenarioFacts.capabilityBrokerBrief
    : isRecord(request.availableRuntimeCapabilities) && request.availableRuntimeCapabilities.schemaVersion === 'sciforge.agentserver.capability-broker-brief.v1'
      ? request.availableRuntimeCapabilities
      : undefined;
  const capabilityBrokerRouteSummary = compactCapabilityBrokerRouteSummary(capabilityBrokerBrief);
  const capabilityProviderRouteSummary = compactCapabilityProviderRouteSummary(scenarioFacts.capabilityProviderRoutes);
  const capabilityFirstPolicy = capabilityFirstPolicyForAgentServer(capabilityProviderRouteSummary);
  const backendHandoffPacket = backendHandoffPacketForPrompt(request, contextEnvelope);
  const promptRenderPlanSummary = promptRenderPlanSummaryForAgentServer(request, contextEnvelope, sessionFacts);
  const contextProjection = isRecord(sessionFacts.contextProjection)
    ? compactWorkspaceContextProjectionForPrompt(sessionFacts.contextProjection)
    : undefined;
  const currentTurnSnapshot = agentServerCurrentTurnSnapshotFromHandoff({
    request,
    currentUserRequest,
    backendHandoffPacket,
    promptRenderPlanSummary,
    conversationPolicySummary,
    executionMode,
    capabilityBrokerRouteSummary,
    capabilityProviderRouteSummary,
    capabilityFirstPolicy,
    contextProjection,
  });
  return [
    ...agentServerCurrentTurnSnapshotPromptPolicyLines(),
    JSON.stringify(clipForAgentServerJson(currentTurnSnapshot), null, 2),
    '',
    request.contextEnvelope ? JSON.stringify({
      version: request.contextEnvelope.version,
      workspaceFacts: Boolean(request.contextEnvelope.workspaceFacts),
      longTermRefs: Boolean(request.contextEnvelope.longTermRefs),
    }, null, 2) : '',
    ...agentServerBackendDecisionPromptPolicyLines({ freshCurrentTurn: request.freshCurrentTurn }),
    ...agentServerGenerationOutputContractLines('json-envelope'),
    ...agentServerExecutionModePromptPolicyLines(),
    ...agentServerGeneratedTaskPromptPolicyLines(),
    ...agentServerToolPayloadProtocolContractLines(),
    ...agentServerGenerationOutputContractLines('tool-payload'),
    ...agentServerCurrentReferencePromptPolicyLines(),
    request.strictTaskFilesReason
      ? `Strict retry reason: ${request.strictTaskFilesReason}`
      : '',
    ...agentServerWorkspaceTaskRoutingPromptPolicyLines('prior-task'),
    ...agentServerFreshRetrievalPromptPolicyLines(),
    ...agentServerWorkspaceTaskRoutingPromptPolicyLines('new-task'),
    ...agentServerCapabilityRoutingPromptPolicyLines(),
    ...agentServerLargeFilePromptContractLines(),
    ...agentServerBibliographicPolicyLinesForRequest(request, scenarioFacts),
    ...agentServerArtifactSelectionPromptPolicyLines(),
    ...agentServerViewSelectionPromptPolicyLines(),
    request.repairContinuation ? agentServerRepairContinuationHardStopPromptLines() : '',
    ...agentServerContinuationPromptPolicyLines(),
    ...agentServerRepairPromptPolicyLines(),
    ...agentServerGenerationOutputContractLines('missing-input'),
    request.priorAttempts?.length ? [
      ...agentServerPriorAttemptsPromptPolicyLines(),
      JSON.stringify(summarizeTaskAttemptsForAgentServer(request.priorAttempts).slice(0, 4), null, 2),
    ].join('\n') : '',
    ...agentServerExternalIoReliabilityContractLines(),
    '',
    JSON.stringify(clipForAgentServerJson({
      ...compactGenerationRequestForAgentServer(request, capabilityBrokerRouteSummary, promptRenderPlanSummary),
      capabilityProviderRoutes: capabilityProviderRouteSummary,
      capabilityFirstPolicy,
      taskContract: {
        argv: ['inputPath', 'outputPath'],
        outputPayloadKeys: ['message', 'confidence', 'claimType', 'evidenceLevel', 'reasoningTrace', 'claims', 'displayIntent', 'uiManifest', 'executionUnits', 'artifacts', 'objectReferences'],
        ...agentServerToolPayloadShapeContract(),
      },
    }), null, 2),
  ].join('\n');
}

function agentServerCurrentTurnSnapshotFromHandoff(params: {
  request: Parameters<typeof buildAgentServerGenerationPrompt>[0];
  currentUserRequest: string;
  backendHandoffPacket: BackendHandoffPacket | undefined;
  promptRenderPlanSummary: Record<string, unknown> | undefined;
  conversationPolicySummary: Record<string, unknown> | undefined;
  executionMode: ReturnType<typeof executionModeDecisionForPrompt>;
  capabilityBrokerRouteSummary: Record<string, unknown> | undefined;
  capabilityProviderRouteSummary: Record<string, unknown> | undefined;
  capabilityFirstPolicy: Record<string, unknown> | undefined;
  contextProjection: Record<string, unknown> | undefined;
}) {
  const packet = params.backendHandoffPacket;
  return {
    kind: 'SciForgeCurrentTurnSnapshot',
    snapshotSource: packet ? 'BackendHandoffPacket' : 'bounded-render-plan',
    currentUserRequest: params.currentUserRequest,
    skillDomain: params.request.skillDomain,
    expectedArtifactTypes: params.request.expectedArtifactTypes ?? [],
    selectedComponentIds: params.request.selectedComponentIds ?? [],
    executionModeRecommendation: params.executionMode.executionModeRecommendation,
    complexityScore: params.executionMode.complexityScore,
    uncertaintyScore: params.executionMode.uncertaintyScore,
    reproducibilityLevel: params.executionMode.reproducibilityLevel,
    stagePlanHint: params.executionMode.stagePlanHint,
    executionModeReason: params.executionMode.executionModeReason,
    conversationPolicySummary: params.conversationPolicySummary,
    executionScope: 'backend-decides',
    backendHandoffPacket: packet ? {
      contractVersion: packet._contractVersion,
      sessionId: packet.sessionId,
      turnId: packet.turnId,
      currentTurnRef: packet.currentTurnRef,
      contextRefs: packet.contextRefs.slice(0, 24),
      retrievalTools: packet.retrievalTools,
      contextSnapshotRef: packet.contextSnapshotRef,
      compactionAuditRefs: packet.compactionAuditRefs?.slice(0, 8),
      retrievalAuditRefs: packet.retrievalAuditRefs?.slice(0, 8),
      syntheticAuditMeta: packet.syntheticAuditMeta ? {
        synthetic: true,
        source: packet.syntheticAuditMeta.source,
        upstream: packet.syntheticAuditMeta.upstream,
        reason: packet.syntheticAuditMeta.reason,
        confidence: packet.syntheticAuditMeta.confidence,
        sourceRefs: packet.syntheticAuditMeta.sourceRefs.slice(0, 8),
      } : undefined,
    } : undefined,
    capabilityBrokerBrief: params.capabilityBrokerRouteSummary,
    capabilityProviderRoutes: params.capabilityProviderRouteSummary,
    capabilityFirstPolicy: params.capabilityFirstPolicy,
    promptRenderPlanSummary: params.promptRenderPlanSummary,
    contextProjection: params.contextProjection ? {
      schemaVersion: params.contextProjection.schemaVersion,
      stablePrefixHash: params.contextProjection.stablePrefixHash,
      selectedContextRefs: params.contextProjection.selectedContextRefs,
      contextRefs: params.contextProjection.contextRefs,
      capabilityBriefRef: params.contextProjection.capabilityBriefRef,
      cachePlan: params.contextProjection.cachePlan,
      retrievalTools: params.contextProjection.retrievalTools,
      workspaceKernel: params.contextProjection.workspaceKernel,
    } : undefined,
    strictTaskFilesReason: params.request.strictTaskFilesReason,
    repairContinuation: params.request.repairContinuation ? {
      mode: 'minimal-single-stage-repair-continuation',
      terminalPayloadContract: [
        'Return only one terminal compact JSON object.',
        'Allowed success shape: AgentServerGenerationResponse containing a minimal provider-route adapter task for the existing failed unit.',
        'Allowed blocked shape: SciForge ToolPayload with executionUnits.status="failed-with-reason", failureReason, recoverActions, nextStep, and refs/digests-only follow-up.',
        'No broad repair loop, full pipeline regeneration, or exploratory history scan.',
      ],
    } : undefined,
    outputContract: agentServerGenerationOutputContract(),
  };
}

function agentServerRepairContinuationHardStopPromptLines() {
  return [
    'Repair-continuation hard stop:',
    '- This is not a fresh research, planning, or full pipeline generation turn.',
    '- Perform one minimal stage only: continue or repair the existing failed task using the compact diagnostic refs already supplied.',
    '- Do not explore broad history, enumerate prior task attempts, regenerate a complete pipeline, or deliberate through repeated tool loops.',
    '- Read at most the specific code/stdout/stderr/output refs needed for the failed execution unit; prefer digests and refs over raw bodies.',
    '- Terminal contract: return exactly one compact JSON object in one of two shapes only.',
    '- Success shape: a runnable AgentServerGenerationResponse whose taskFiles implement a minimal provider-route adapter task for the existing failed execution unit; the adapter must use the supplied capability/provider route refs and must not rebuild the whole pipeline.',
    '- Blocked shape: a valid SciForge ToolPayload with executionUnits.status="failed-with-reason", concise failureReason, recoverActions, nextStep, and evidence refs that request refs/digests-only follow-up.',
    '- Stop after the terminal JSON. Do not start another repair pass, broad loop, or exploratory provider/status investigation.',
  ].join('\n');
}

function compactGenerationRequestForAgentServer(
  request: Parameters<typeof buildAgentServerGenerationPrompt>[0],
  capabilityBrokerBrief: Record<string, unknown> | undefined,
  promptRenderPlanSummary: Record<string, unknown> | undefined,
) {
  const {
    availableSkills: _availableSkills,
    availableTools: _availableTools,
    availableRuntimeCapabilities: _availableRuntimeCapabilities,
    contextEnvelope,
    boundedRenderPlan: _boundedRenderPlan,
    metadata: _metadata,
    ...rest
  } = request;
  const artifacts = toRecordList(rest.artifacts);
  const recentExecutionRefs = toRecordList(rest.recentExecutionRefs);
  const sanitizedRest = sanitizePromptHandoffValue(rest, 'generationRequest');
  return {
    ...(isRecord(sanitizedRest) ? sanitizedRest : {}),
    artifacts: artifacts.length ? summarizeArtifactRefs(artifacts) : undefined,
    recentExecutionRefs: recentExecutionRefs.length ? summarizeExecutionRefs(recentExecutionRefs) : undefined,
    uiStateSummary: sanitizeUiStateSummaryForPrompt(rest.uiStateSummary),
    contextEnvelope: compactContextEnvelopeForAgentServer(contextEnvelope),
    capabilityBrokerBrief,
    promptRenderPlanSummary,
    omittedCapabilityCatalog: {
      omitted: true,
      source: 'typescript-capability-broker',
      omittedCategories: ['legacy skill catalog', 'legacy tool catalog', 'legacy component catalog'],
      reason: 'T116 default backend handoff consumes compact broker briefs and keeps full schemas/examples/docs lazy.',
    },
  };
}

function agentServerBibliographicPolicyLinesForRequest(
  request: Parameters<typeof buildAgentServerGenerationPrompt>[0],
  scenarioFacts: Record<string, unknown>,
) {
  const include = agentServerShouldIncludeBibliographicVerificationPromptPolicy({
    skillDomain: request.skillDomain,
    expectedArtifactTypes: request.expectedArtifactTypes,
    selectedComponentIds: request.selectedComponentIds,
    selectedCapabilityIds: [
      ...toStringList(scenarioFacts.selectedToolIds),
      ...toStringList(scenarioFacts.selectedSenseIds),
      ...toStringList(scenarioFacts.selectedVerifierIds),
    ],
  });
  return include ? agentServerBibliographicVerificationPromptPolicyLines() : [];
}

function compactCapabilityBrokerRouteSummary(value: Record<string, unknown> | undefined) {
  if (!isRecord(value)) return undefined;
  const briefs = toRecordList(value.briefs);
  const maxBriefs = 6;
  return {
    schemaVersion: stringField(value.schemaVersion),
    source: stringField(value.source),
    contract: stringField(value.contract),
    routingPolicy: isRecord(value.routingPolicy) ? {
      decisionOwner: stringField(value.routingPolicy.decisionOwner),
      contractExpansion: stringField(value.routingPolicy.contractExpansion),
      defaultPayload: stringField(value.routingPolicy.defaultPayload),
    } : undefined,
    briefs: briefs.slice(0, maxBriefs).map(compactCapabilityBriefForPrompt),
    omittedBriefCount: Math.max(0, briefs.length - maxBriefs),
    harnessInputAudit: compactHarnessInputAuditForPrompt(value.harnessInputAudit),
    inputSummary: isRecord(value.inputSummary) ? {
      objectRefs: value.inputSummary.objectRefs,
      artifactIndexEntries: value.inputSummary.artifactIndexEntries,
      failureHistoryEntries: value.inputSummary.failureHistoryEntries,
      toolBudgetKeys: toStringList(value.inputSummary.toolBudgetKeys).slice(0, 16),
    } : undefined,
  };
}

function compactCapabilityProviderRouteSummary(value: unknown) {
  if (!isRecord(value)) return undefined;
  const routes = toRecordList(value.routes).map((route) => ({
    capabilityId: stringField(route.capabilityId),
    primaryProviderId: stringField(route.primaryProviderId),
    fallbackProviderIds: toStringList(route.fallbackProviderIds).slice(0, 4),
    status: stringField(route.status),
    reason: clipForAgentServerPrompt(route.reason, 220),
    routeTraceRef: stringField(route.routeTraceRef),
    providers: toRecordList(route.providers).slice(0, 4).map((provider) => ({
      providerId: stringField(provider.providerId),
      source: stringField(provider.source),
      transport: stringField(provider.transport),
      healthStatus: stringField(provider.healthStatus),
    })),
  }));
  if (!routes.length && !toStringList(value.requiredCapabilityIds).length) return undefined;
  return {
    schemaVersion: stringField(value.schemaVersion) ?? CAPABILITY_ROUTE_SUMMARY_SCHEMA_VERSION,
    requiredCapabilityIds: toStringList(value.requiredCapabilityIds).slice(0, 12),
    ok: value.ok === true,
    routes,
    readyProviderFirstCapabilityIds: readyProviderFirstCapabilityIds(routes),
  };
}

function capabilityFirstPolicyForAgentServer(routeSummary: Record<string, unknown> | undefined) {
  const readyCapabilityIds = readyProviderFirstCapabilityIds(toRecordList(routeSummary?.routes));
  if (!readyCapabilityIds.length) return undefined;
  return {
    schemaVersion: 'sciforge.generated-task-capability-first.v1',
    policy: 'provider-first',
    routeSource: 'capabilityProviderRoutes',
    readyCapabilityIds,
    helperSdk: {
      moduleName: 'sciforge_task',
      requiredImport: 'from sciforge_task import load_input, write_payload, invoke_capability, invoke_provider, provider_result_is_empty, empty_result_payload, ProviderInvocationError',
      invocationSignature: 'invoke_capability(task_input, capability_id, capability_input, timeout_seconds=optional_seconds); invoke_provider is the web provider alias',
      taskInputFields: ['capabilityProviderRoutes', 'providerInvocation', 'capabilityFirstPolicy'],
    },
    canonicalPythonAdapter: [
      'import sys',
      'from sciforge_task import load_input, write_payload, invoke_capability, provider_result_is_empty, empty_result_payload, ProviderInvocationError',
      '',
      '_, input_path, output_path = sys.argv',
      'task_input = load_input(input_path)',
      '',
      'def failed_with_reason_payload(reason, task_input):',
      '    return {',
      '        "message": reason,',
      '        "confidence": 0,',
      '        "claimType": "fact",',
      '        "evidenceLevel": "provider",',
      '        "reasoningTrace": reason,',
      '        "claims": [],',
      '        "uiManifest": [],',
      '        "executionUnits": [{"id": "provider-call", "status": "failed", "tool": "invoke_capability", "failureReason": reason}],',
      '        "artifacts": [],',
      '    }',
      '',
      'def success_payload(results, task_input):',
      '    return {',
      '        "message": "Provider route completed.",',
      '        "confidence": 0.8,',
      '        "claimType": "observation",',
      '        "evidenceLevel": "provider",',
      '        "reasoningTrace": "Used SciForge invoke_capability provider route.",',
      '        "claims": [],',
      '        "uiManifest": [],',
      '        "executionUnits": [{"id": "provider-call", "status": "done", "tool": "invoke_capability"}],',
      '        "artifacts": [{"id": "provider-result", "type": "runtime-context-summary", "data": results}],',
      '    }',
      '',
      'try:',
      '    capability_id = task_input.get("capabilityFirstPolicy", {}).get("readyCapabilityIds", ["web_search"])[0]',
      '    provider_input = {"query": task_input.get("prompt", ""), "maxResults": 3}',
      '    results = invoke_capability(task_input, capability_id, provider_input)',
      '    # For URL reads use invoke_capability(task_input, "web_fetch", {"url": url, "maxChars": 12000}); use browser_fetch for rendered/JavaScript pages.',
      'except ProviderInvocationError as error:',
      '    write_payload(output_path, failed_with_reason_payload(str(error), task_input))',
      '    raise SystemExit(0)',
      '',
      'if provider_result_is_empty(results):',
      '    write_payload(output_path, empty_result_payload(capability_id, "Provider route completed with zero results; refine or broaden the query and retry."))',
      '    raise SystemExit(0)',
      '',
      'write_payload(output_path, success_payload(results, task_input))',
    ].join('\n'),
    taskCodeRules: [
      'Generated task code must follow canonicalPythonAdapter shape: load task_input, pick a capability id from capabilityFirstPolicy.readyCapabilityIds, call invoke_capability(task_input, capabilityId, providerInput), and write_payload.',
      'Do not generate task code that bypasses ready provider routes with bespoke clients; for external web retrieval this specifically forbids direct network packages or APIs such as requests, urllib, httpx, aiohttp, fetch, or Node http/https while a matching provider route is ready.',
      'Generated task code must check provider_result_is_empty(result) and write empty_result_payload(...) as a terminal ToolPayload with recover/refine actions.',
      'If the ready provider returns empty, unauthorized, rate-limited, or unavailable results, write failed-with-reason or repair-needed ToolPayload evidence; do not fall back to direct external network APIs.',
    ],
  };
}

function readyProviderFirstCapabilityIds(routes: Array<Record<string, unknown>>) {
  return uniqueStrings(routes
    .filter((route) => route.status === 'ready')
    .map((route) => stringField(route.capabilityId))
    .filter((capabilityId): capabilityId is string => Boolean(capabilityId)));
}

function compactHarnessInputAuditForPrompt(value: unknown) {
  if (!isRecord(value)) return undefined;
  const consumed = isRecord(value.consumed) ? value.consumed : {};
  return {
    schemaVersion: stringField(value.schemaVersion),
    status: stringField(value.status),
    source: stringField(value.source),
    enablement: stringField(value.enablement),
    contractRef: stringField(value.contractRef),
    traceRef: stringField(value.traceRef),
    profileId: stringField(value.profileId),
    consumed: {
      skillHints: value.consumed && typeof consumed.skillHints === 'number' ? consumed.skillHints : undefined,
      blockedCapabilities: value.consumed && typeof consumed.blockedCapabilities === 'number' ? consumed.blockedCapabilities : undefined,
      preferredCapabilityIds: value.consumed && typeof consumed.preferredCapabilityIds === 'number' ? consumed.preferredCapabilityIds : undefined,
      providerAvailability: value.consumed && typeof consumed.providerAvailability === 'number' ? consumed.providerAvailability : undefined,
      toolBudgetKeys: toStringList(consumed.toolBudgetKeys).slice(0, 16),
      verificationPolicyKeys: toStringList(consumed.verificationPolicyKeys).slice(0, 16),
      verificationPolicyMode: stringField(consumed.verificationPolicyMode),
    },
    sources: toRecordList(value.sources).slice(0, 8).map((source) => ({
      source: stringField(source.source),
      contractRef: stringField(source.contractRef),
      traceRef: stringField(source.traceRef),
      profileId: stringField(source.profileId),
    })),
  };
}

function compactCapabilityBriefForPrompt(brief: Record<string, unknown>) {
  const budget = isRecord(brief.budget) ? brief.budget : {};
  return {
    id: stringField(brief.id),
    name: stringField(brief.name),
    kind: stringField(brief.kind),
    ownerPackage: stringField(brief.ownerPackage),
    brief: clipForAgentServerPrompt(brief.brief, 260),
    score: typeof brief.score === 'number' && Number.isFinite(brief.score) ? brief.score : undefined,
    costClass: stringField(brief.costClass),
    latencyClass: stringField(brief.latencyClass),
    sideEffectClass: stringField(brief.sideEffectClass),
    routingTags: toStringList(brief.routingTags).slice(0, 8),
    domains: toStringList(brief.domains).slice(0, 6),
    providerIds: toStringList(brief.providerIds).slice(0, 6),
    budget: {
      status: stringField(budget.status),
      limits: clipForAgentServerPrompt(budget.limits, 120),
    },
    excluded: clipForAgentServerPrompt(brief.excluded, 180),
  };
}

function compactWorkspaceContextProjectionForPrompt(value: Record<string, unknown>) {
  const workspaceKernel = isRecord(value.workspaceKernel)
    ? value.workspaceKernel
    : isRecord(value.workspaceLedger)
      ? value.workspaceLedger
      : isRecord(value.projectSessionMemory)
        ? value.projectSessionMemory
        : {};
  return {
    schemaVersion: stringField(value.schemaVersion),
    authority: stringField(value.authority),
    mode: stringField(value.mode),
    workspaceKernel: {
      schemaVersion: stringField(workspaceKernel.schemaVersion),
      sessionId: stringField(workspaceKernel.sessionId),
      eventCount: typeof workspaceKernel.eventCount === 'number' ? workspaceKernel.eventCount : undefined,
      refCount: typeof workspaceKernel.refCount === 'number' ? workspaceKernel.refCount : undefined,
      eventIndex: toRecordList(workspaceKernel.eventIndex).slice(-16).map((entry) => ({
        eventId: stringField(entry.eventId),
        kind: stringField(entry.kind),
        runId: stringField(entry.runId),
        summary: clipForAgentServerPrompt(entry.summary, 220),
        refs: toStringList(entry.refs).slice(0, 6),
      })),
      refIndex: toRecordList(workspaceKernel.refIndex).slice(-24).map((entry) => ({
        ref: stringField(entry.ref),
        kind: stringField(entry.kind),
        digest: stringField(entry.digest),
        sizeBytes: typeof entry.sizeBytes === 'number' ? entry.sizeBytes : undefined,
        producerRunId: stringField(entry.producerRunId),
      })),
      failureIndex: toRecordList(workspaceKernel.failureIndex).slice(-8).map((entry) => ({
        eventId: stringField(entry.eventId),
        runId: stringField(entry.runId),
        summary: clipForAgentServerPrompt(entry.summary, 220),
        refs: toStringList(entry.refs).slice(0, 6),
      })),
    },
    stablePrefixHash: stringField(value.stablePrefixHash),
    contextProjectionBlocks: toRecordList(value.contextProjectionBlocks).slice(0, 8).map((block) => ({
      blockId: stringField(block.blockId),
      kind: stringField(block.kind),
      sha256: stringField(block.sha256),
      cacheTier: stringField(block.cacheTier),
      tokenEstimate: typeof block.tokenEstimate === 'number' ? block.tokenEstimate : undefined,
      sourceEventIds: toStringList(block.sourceEventIds).slice(0, 12),
    })),
    selectedContextRefs: toStringList(value.selectedContextRefs).slice(0, 24),
    contextRefs: compactContextRefListForPrompt(value.contextRefs).slice(0, 48),
    capabilityBriefRef: compactContextRefForPrompt(value.capabilityBriefRef),
    cachePlan: compactCachePlanForPrompt(value.cachePlan),
    retrievalTools: toStringList(value.retrievalTools).slice(0, 8),
  };
}

function compactCachePlanForPrompt(value: unknown) {
  if (!isRecord(value)) return undefined;
  return {
    stablePrefixRefs: compactContextRefListForPrompt(value.stablePrefixRefs).slice(0, 8),
    perTurnPayloadRefs: compactContextRefListForPrompt(value.perTurnPayloadRefs).slice(0, 8),
  };
}

function compactContextRefListForPrompt(value: unknown) {
  if (!Array.isArray(value)) return toStringList(value).slice(0, 48);
  return value.flatMap((entry) => compactContextRefForPrompt(entry) ?? []);
}

function compactContextRefForPrompt(value: unknown) {
  if (typeof value === 'string' && value) return value;
  if (!isRecord(value)) return undefined;
  const ref = stringField(value.ref);
  if (!ref) return undefined;
  return {
    ref,
    kind: stringField(value.kind),
    digest: stringField(value.digest),
    sizeBytes: typeof value.sizeBytes === 'number' ? value.sizeBytes : undefined,
    preview: clipForAgentServerPrompt(value.preview, 160),
    retention: stringField(value.retention),
  };
}

function compactContextEnvelopeForAgentServer(value: unknown) {
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'continuityRules' || key === 'agentHarnessHandoff' || key === 'promptRenderPlan') continue;
    if (key === 'agentServerCoreSnapshot') {
      const snapshot = compactAgentServerCoreSnapshotForPrompt(entry);
      if (snapshot) out.agentServerCoreSnapshot = snapshot;
      continue;
    }
    if (key === 'projectFacts') {
      const projectFacts = compactProjectFactsForAgentServer(entry);
      if (projectFacts) out.projectFacts = projectFacts;
      continue;
    }
    if (key === 'orchestrationBoundary') {
      const boundary = compactOrchestrationBoundaryForAgentServer(entry);
      if (boundary) out.orchestrationBoundary = boundary;
      continue;
    }
    if (key === 'sessionFacts' || key === 'scenarioFacts') {
      const facts = sanitizeContextFactsForPrompt(entry, key);
      if (facts) out[key] = facts;
      continue;
    }
    out[key] = sanitizePromptHandoffValue(entry, key);
  }
  return out;
}

function compactAgentServerCoreSnapshotForPrompt(value: unknown) {
  if (!isRecord(value)) return undefined;
  const session = isRecord(value.session) ? value.session : {};
  const currentWork = isRecord(value.currentWork) ? value.currentWork : {};
  const boundedTurnRefs = toRecordList(value.recentTurnRefs);
  const compactionTags = toRecordList(currentWork.compactionTags);
  return {
    source: stringField(value.source) ?? 'AgentServer Core /context',
    session: {
      id: stringField(session.id),
      status: stringField(session.status),
      updatedAt: stringField(session.updatedAt),
    },
    recentTurnRefs: boundedTurnRefs.slice(-6).map((turn) => ({
      turnNumber: typeof turn.turnNumber === 'number' ? turn.turnNumber : undefined,
      role: stringField(turn.role),
      runId: stringField(turn.runId),
      contentRef: stringField(turn.contentRef),
      contentOmitted: true,
      contentDigest: stringField(turn.contentDigest) ?? stringField(turn.digest),
      contentChars: typeof turn.contentChars === 'number' && Number.isFinite(turn.contentChars)
        ? turn.contentChars
        : undefined,
      createdAt: stringField(turn.createdAt),
    })),
    currentWork: {
      entryCount: typeof currentWork.entryCount === 'number' ? currentWork.entryCount : undefined,
      rawTurnCount: typeof currentWork.rawTurnCount === 'number' ? currentWork.rawTurnCount : undefined,
      compactionTags: compactionTags.slice(-8).map((entry) => ({
        kind: stringField(entry.kind),
        id: stringField(entry.id),
        turns: stringField(entry.turns),
        archived: entry.archived === true ? true : undefined,
        summaryDigest: hashJson(entry.summary),
        summaryItems: Array.isArray(entry.summary) ? entry.summary.length : undefined,
      })),
    },
  };
}

function compactProjectFactsForAgentServer(value: unknown) {
  if (!isRecord(value)) return undefined;
  return {
    project: stringField(value.project),
    toolPayloadContract: Array.isArray(value.toolPayloadContract) ? value.toolPayloadContract : undefined,
    taskCodePolicyRef: stringField(value.taskCodePolicyRef),
    toolPayloadContractRef: stringField(value.toolPayloadContractRef),
  };
}

function compactOrchestrationBoundaryForAgentServer(value: unknown) {
  if (!isRecord(value)) return undefined;
  return {
    decisionOwner: stringField(value.decisionOwner),
    currentUserRequestIsAuthoritative: value.currentUserRequestIsAuthoritative === true ? true : undefined,
    agentId: stringField(value.agentId),
    agentServerCoreSnapshotAvailable: value.agentServerCoreSnapshotAvailable === true ? true : undefined,
  };
}

function omitRawPromptRenderPlanCarriers(value: unknown) {
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'agentHarnessHandoff' || key === 'promptRenderPlan') continue;
    out[key] = entry;
  }
  return out;
}

function sanitizeContextFactsForPrompt(value: unknown, source: string) {
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'agentHarnessHandoff' || key === 'promptRenderPlan') continue;
    if (key === 'verificationResult') {
      const summary = summarizeVerificationRecordForEnvelope(entry, `${source}.${key}`);
      if (summary) out[key] = summary;
      continue;
    }
    if (key === 'recentVerificationResults' || key === 'verificationResults') {
      const summary = summarizeVerificationResultRecords(toRecordList(entry), `${source}.${key}`);
      if (summary.length) out[key] = summary;
      continue;
    }
    if (key === 'artifacts') {
      const artifacts = summarizeArtifactRefs(toRecordList(entry));
      if (artifacts.length) out[key] = artifacts;
      continue;
    }
    if (key === 'recentExecutionRefs' || key === 'executionUnits') {
      const refs = summarizeExecutionRefs(toRecordList(entry));
      if (refs.length) out[key] = refs;
      continue;
    }
    out[key] = sanitizePromptHandoffValue(entry, `${source}.${key}`);
  }
  return out;
}

function sanitizeUiStateSummaryForPrompt(value: unknown) {
  if (!isRecord(value)) return sanitizePromptHandoffValue(value, 'uiStateSummary');
  return sanitizeContextFactsForPrompt(value, 'uiStateSummary');
}

export function sanitizePromptHandoffValue(value: unknown, path = ''): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') return clipForAgentServerPrompt(value, 1800);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const limit = path.endsWith('.messages') || path.endsWith('.recentConversation') ? 12 : 16;
    return value.slice(-limit).map((entry, index) => sanitizePromptHandoffValue(entry, `${path}[${index}]`));
  }
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'agentHarnessHandoff' || key === 'promptRenderPlan') continue;
    if (isBodyCarrierKey(key)) {
      const summary = promptBodyCarrierSummary(key, entry);
      if (summary) out[key] = summary;
      continue;
    }
    if (key === 'verificationResult') {
      const summary = summarizeVerificationRecordForEnvelope(entry, `${path}.${key}`);
      if (summary) out[key] = summary;
      continue;
    }
    if (key === 'verificationResults' || key === 'recentVerificationResults') {
      const summary = summarizeVerificationResultRecords(toRecordList(entry), `${path}.${key}`);
      if (summary.length) out[key] = summary;
      continue;
    }
    out[key] = sanitizePromptHandoffValue(entry, path ? `${path}.${key}` : key);
  }
  return out;
}

function isBodyCarrierKey(key: string) {
  if (runtimePayloadKeyLooksLikeBodyCarrier(key)) return true;
  const lower = key.toLowerCase();
  if ([
    'code',
    'sourcecode',
    'tasksource',
    'generatedsource',
    'generatedtasksource',
    'filecontent',
    'filecontents',
    'taskfiles',
    'output',
    'result',
    'finaltext',
  ].includes(lower)) return true;
  return /(?:generated|task|file|agentserver).*?(?:code|source|content|output|result|text)$/i.test(key);
}

function promptBodyCarrierSummary(key: string, value: unknown) {
  if (value === undefined) return undefined;
  return {
    omitted: `prompt-handoff-${key}-body`,
    shape: promptValueShape(value),
    refs: collectRuntimeRefsFromValue(value, { maxRefs: 16 }),
    hash: hashJson(value),
  };
}

function promptValueShape(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return { kind: 'string', chars: value.length };
  if (typeof value === 'number' || typeof value === 'boolean') return { kind: typeof value };
  if (Array.isArray(value)) return { kind: 'array', count: value.length };
  if (isRecord(value)) return { kind: 'object', keys: Object.keys(value).slice(0, 16) };
  return { kind: value === null ? 'null' : typeof value };
}

function promptRenderPlanSummaryForAgentServer(
  request: Parameters<typeof buildAgentServerGenerationPrompt>[0],
  contextEnvelope: Record<string, unknown>,
  sessionFacts: Record<string, unknown>,
) {
  const metadata = isRecord(request.metadata) ? request.metadata : {};
  const candidates: Array<{ source: string; value: unknown }> = [
    { source: 'request.boundedRenderPlan', value: request.boundedRenderPlan },
    { source: 'contextEnvelope.boundedRenderPlan', value: contextEnvelope.boundedRenderPlan },
    { source: 'contextEnvelope.sessionFacts.boundedRenderPlan', value: sessionFacts.boundedRenderPlan },
    { source: 'request.metadata.boundedRenderPlan', value: metadata.boundedRenderPlan },
  ];
  for (const candidate of candidates) {
    const plan = promptRenderPlanFromCandidate(candidate.value);
    const summary = plan ? promptRenderPlanSummaryFromPlan(plan, candidate.source) : undefined;
    if (summary) return summary;
  }
  return undefined;
}

function backendHandoffPacketForPrompt(
  request: Parameters<typeof buildAgentServerGenerationPrompt>[0],
  contextEnvelope: Record<string, unknown>,
): BackendHandoffPacket | undefined {
  const metadata = isRecord(request.metadata) ? request.metadata : {};
  const candidates = [
    request.backendHandoffPacket,
    contextEnvelope.backendHandoffPacket,
    metadata.backendHandoffPacket,
  ];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const result = validateBackendHandoffPacket(candidate);
    if (result.ok && candidate._contractVersion === AGENTSERVER_BACKEND_HANDOFF_VERSION) {
      return candidate as unknown as BackendHandoffPacket;
    }
  }
  return undefined;
}

function promptRenderPlanFromCandidate(value: unknown) {
  if (!isRecord(value)) return undefined;
  if (isRecord(value.promptRenderPlan)) return value.promptRenderPlan;
  if (value.renderDigest !== undefined || value.renderedEntries !== undefined || value.sourceRefs !== undefined) {
    return value;
  }
  return undefined;
}

function promptRenderPlanSummaryFromPlan(plan: Record<string, unknown>, source: string) {
  const renderedEntries = Array.isArray(plan.renderedEntries)
    ? plan.renderedEntries.filter(isRecord).slice(0, 32).map(promptRenderPlanEntrySummary).filter(isRecord)
    : [];
  const sourceRefs = isRecord(plan.sourceRefs) ? clipForAgentServerJson(plan.sourceRefs, 2) : undefined;
  const renderDigest = stringField(plan.renderDigest);
  if (!renderDigest && !sourceRefs && !renderedEntries.length) return undefined;
  return {
    schemaVersion: 'sciforge.agentserver.prompt-render-plan-summary.v1',
    source,
    renderPlanSchemaVersion: stringField(plan.schemaVersion),
    renderMode: stringField(plan.renderMode),
    deterministic: plan.deterministic === true,
    renderDigest,
    sourceRefs,
    renderedEntries,
  };
}

function promptRenderPlanEntrySummary(entry: Record<string, unknown>) {
  const id = stringField(entry.id);
  const sourceCallbackId = stringField(entry.sourceCallbackId);
  if (!id || !sourceCallbackId) return undefined;
  const out: Record<string, unknown> = {
    kind: stringField(entry.kind) ?? 'strategy',
    id,
    sourceCallbackId,
  };
  const text = stringField(entry.text);
  if (text) out.text = clipForAgentServerPrompt(text, 800);
  if (typeof entry.priority === 'number' && Number.isFinite(entry.priority)) out.priority = entry.priority;
  return out;
}

function executionModeDecisionForPrompt(
  sessionFacts: Record<string, unknown>,
  scenarioFacts: Record<string, unknown>,
) {
  return {
    executionModeRecommendation: firstStringField([sessionFacts.executionModeRecommendation, scenarioFacts.executionModeRecommendation]) ?? 'unknown',
    complexityScore: firstNumberOrStringField([sessionFacts.complexityScore, scenarioFacts.complexityScore]) ?? 'unknown',
    uncertaintyScore: firstNumberOrStringField([sessionFacts.uncertaintyScore, scenarioFacts.uncertaintyScore]) ?? 'unknown',
    reproducibilityLevel: firstStringField([sessionFacts.reproducibilityLevel, scenarioFacts.reproducibilityLevel]) ?? 'unknown',
    stagePlanHint: firstStagePlanHintField([sessionFacts.stagePlanHint, scenarioFacts.stagePlanHint]) ?? 'backend-decides',
    executionModeReason: firstStringField([sessionFacts.executionModeReason, scenarioFacts.executionModeReason]) ?? 'backend-decides',
  };
}

function firstStringField(values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function firstNumberOrStringField(values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function firstStagePlanHintField(values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const items = value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim());
      if (items.length) return items;
    }
  }
  return undefined;
}
