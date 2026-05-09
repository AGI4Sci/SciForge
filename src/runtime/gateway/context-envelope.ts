import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { SciForgeSkillDomain, GatewayRequest, SkillAvailability } from '../runtime-types.js';
import { clipForAgentServerJson, clipForAgentServerPrompt, hashJson, isRecord, toRecordList, toStringList } from '../gateway-utils.js';
import { expectedArtifactTypesForRequest, selectedComponentIdsForRequest } from './gateway-request.js';
import { summarizeWorkEvidenceForHandoff } from './work-evidence-types.js';

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
  const contextReusePolicy = isRecord(uiState.contextReusePolicy) ? uiState.contextReusePolicy : undefined;
  const failureRecoveryPolicy = request.failureRecoveryPolicy ?? (isRecord(uiState.failureRecoveryPolicy) ? uiState.failureRecoveryPolicy : undefined);
  const recentFailures = summarizeFailureRecoveryPolicy(failureRecoveryPolicy);
  const mode = params.mode ?? contextEnvelopeMode(request);
  const workspaceTree = params.workspaceTreeSummary ?? [];
  const expectedArtifactTypes = expectedArtifactTypesForRequest(request);
  const selectedComponentIds = selectedComponentIdsForRequest(request);
  const executionModeDecision = executionModeDecisionForEnvelope(uiState);
  const conversationPolicySummary = summarizeConversationPolicyForAgentServer(uiState.conversationPolicy ?? uiState);
  const capabilityBrief = isRecord(uiState.capabilityBrief)
    ? uiState.capabilityBrief
    : {
      schemaVersion: 'sciforge.capability-brief.transport-fallback.v1',
      selected: [],
      excluded: [],
      needsMoreDiscovery: true,
      reason: 'Python conversation policy did not provide a capability brief.',
    };
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
      taskCodePolicy: 'Generate or repair task code in the active workspace, but compose installed/workspace tools when they are a better fit than hand-written code.',
      toolPayloadContract: ['message', 'confidence', 'claimType', 'evidenceLevel', 'reasoningTrace', 'claims', 'displayIntent', 'uiManifest', 'executionUnits', 'artifacts', 'objectReferences'],
    } : {
      project: 'SciForge',
      taskCodePolicyRef: 'sciforge.generated-task.v1',
      toolPayloadContractRef: 'sciforge.toolPayload.v1',
    },
    orchestrationBoundary: {
      decisionOwner: 'AgentServer',
      sciForgeRole: 'protocol validation, workspace execution, artifact/ref persistence, repair request dispatch, and UI display only',
      currentUserRequestIsAuthoritative: true,
      agentId: params.agentId,
      agentServerCoreSnapshotAvailable: params.agentServerCoreSnapshotAvailable === true,
      contextModeReason: mode === 'delta'
        ? 'SciForge sent compact delta refs plus hashes for a multi-turn backend session.'
        : 'SciForge sent a full handoff because AgentServer Core context was unavailable or the turn had no reusable session refs.',
    },
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
      capabilityBrief,
      verificationPolicy: request.verificationPolicy ?? capabilityBrief.verificationPolicy,
      humanApprovalPolicy: request.humanApprovalPolicy ?? (isRecord(uiState.humanApprovalPolicy) ? uiState.humanApprovalPolicy : undefined),
      unverifiedReason: request.unverifiedReason ?? (typeof uiState.unverifiedReason === 'string' ? uiState.unverifiedReason : undefined),
      verificationBrief: capabilityBrief.verificationBrief,
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
      currentUserRequest: currentUserRequestText(request.prompt),
      currentReferences: currentReferences.length ? currentReferences.slice(0, 8).map((entry) => clipForAgentServerJson(entry, 2)) : undefined,
      currentReferenceDigests: currentReferenceDigests.length ? currentReferenceDigests.slice(0, 8).map((entry) => clipForAgentServerJson(entry, 4)) : undefined,
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
    continuityRules: mode === 'full' ? [
      'Use workspace refs as the source of truth for files, logs, generated code, and artifacts.',
      'Use conversationLedger to recover long-running session continuity; use recentConversation only to infer current intent.',
      'If sessionFacts.currentReferences is non-empty, the current answer/artifacts must use those refs as current-turn evidence or return failed-with-reason; objectReferences alone do not prove use.',
      'If sessionFacts.currentReferenceDigests is present, use those bounded digests before reading large files; only generate workspace task code for deeper extraction instead of dumping full documents into backend context.',
      'For continuation or repair requests, continue from priorAttempts/artifacts instead of restarting an unrelated task.',
      'For failure follow-ups, use sessionFacts.recentFailures and longTermRefs.failureEvidenceRefs to explain the prior blocker and continue from the failed step.',
      'If a requested local ref does not exist, say so explicitly and point to the nearest available output/log/artifact ref.',
    ] : [
      'Workspace refs are source of truth.',
      'If sessionFacts.currentReferences is non-empty, the current answer/artifacts must use those refs as current-turn evidence or return failed-with-reason; objectReferences alone do not prove use.',
      'Use currentReferenceDigests before opening large current refs; if deeper reading is needed, write a workspace task that emits bounded artifacts.',
      'Continue from AgentServer session memory, conversationLedger, recentExecutionRefs, and artifacts; answer missing refs honestly.',
      'For failure follow-ups, use sessionFacts.recentFailures and longTermRefs.failureEvidenceRefs before asking the user to repeat context.',
    ],
  };
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

export async function workspaceTreeSummary(workspace: string) {
  const root = resolve(workspace);
  const out: Array<{ path: string; kind: 'file' | 'folder'; sizeBytes?: number }> = [];
  async function walk(dir: string, prefix = '') {
    if (out.length >= 80) return;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= 80) return;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (shouldSkipWorkspaceTreeEntry(rel, entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push({ path: rel, kind: 'folder' });
        if (shouldDescendWorkspaceTreeEntry(rel)) await walk(path, rel);
      } else if (entry.isFile()) {
        let sizeBytes = 0;
        try {
          sizeBytes = (await stat(path)).size;
        } catch {
          // Size is optional.
        }
        out.push({ path: rel, kind: 'file', sizeBytes });
      }
    }
  }
  await walk(root);
  return out;
}

function shouldSkipWorkspaceTreeEntry(rel: string, name: string) {
  if (name === 'node_modules' || name === '.git') return true;
  if (rel === '.bioagent' || rel.startsWith('.bioagent/')) return true;
  if (rel.startsWith('.sciforge/') && rel.split('/').length > 2) return true;
  if (/^\.sciforge\/(?:artifacts|task-results|logs|sessions|versions)\//.test(rel)) return true;
  return false;
}

function shouldDescendWorkspaceTreeEntry(rel: string) {
  if (rel.startsWith('.sciforge/')) return false;
  if (/^\.sciforge\/(?:artifacts|task-results|logs|sessions|versions)$/.test(rel)) return false;
  return rel.split('/').length < 3;
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
  if (skillDomain === 'literature') return { type: 'paper-list' };
  if (skillDomain === 'structure') return { type: 'structure-summary' };
  if (skillDomain === 'omics') return { type: 'omics-differential-expression' };
  return { type: 'knowledge-graph' };
}

function contextEnvelopeMode(request: GatewayRequest): AgentServerContextMode {
  const recentConversation = toStringList(request.uiState?.recentConversation);
  const recentExecutionRefs = toRecordList(request.uiState?.recentExecutionRefs);
  return recentConversation.length > 1 || recentExecutionRefs.length > 0 || request.artifacts.length > 0 ? 'delta' : 'full';
}

function currentUserRequestText(prompt: string) {
  const lines = prompt.split('\n').map((line) => line.trim()).filter(Boolean);
  const userLine = [...lines].reverse().find((line) => /^user\s*:/i.test(line));
  return userLine ? userLine.replace(/^user\s*:\s*/i, '') : prompt;
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
  const fromArtifacts = request.artifacts
    .filter((artifact) => String(artifact.type || artifact.id || '') === 'verification-result')
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
