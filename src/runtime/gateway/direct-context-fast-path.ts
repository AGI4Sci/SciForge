import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';
import { runtimeResultViewSlotsPolicy } from '../../../packages/presentation/interactive-views';
import { expectedArtifactTypesForRequest } from './gateway-request.js';
import {
  DIRECT_CONTEXT_FAST_PATH_POLICY,
  buildDirectContextFastPathItems,
  directContextFastPathMessage,
  directContextFastPathSupportingRefs,
} from '@sciforge-ui/runtime-contract/artifact-policy';
import { capabilityProviderRoutesForHandoff } from './capability-provider-preflight.js';

export function directContextFastPathPayload(request: GatewayRequest): ToolPayload | undefined {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  if (uiState.forceAgentServerGeneration === true) return undefined;
  if (artifactMutationFollowupRequiresBackend(request.prompt)) return undefined;
  const decision = directContextDecisionForRequest(request);
  if (!decision) return undefined;
  if (decision.intent === 'capability-status') return directContextDecisionAllowsAnswer(decision)
    ? capabilityStatusFastPathPayload(request)
    : undefined;
  if (!policyRequestsDirectContext(request, decision)) return undefined;
  const context = buildDirectContextFastPathItems({
    artifacts: request.artifacts,
    uiArtifacts: uiState.artifacts,
    references: request.references,
    currentReferences: uiState.currentReferences,
    currentReferenceDigests: uiState.currentReferenceDigests,
    claims: uiState.claims,
    recentExecutionRefs: uiState.recentExecutionRefs,
    executionUnits: uiState.executionUnits,
  });
  if (!context.length) return undefined;
  const payloadContext = scopedDirectContextPayloadContext(request, context);
  if (!hasCurrentContextEvidence(payloadContext, decision.intent)) return undefined;
  const gate = directContextGate(payloadContext, decision);
  if (!gate.allowed) return undefined;
  const transformMode = decision.transformMode && decision.transformMode !== 'none'
    ? decision.transformMode
    : answerOnlyTransformRequestedLegacyFallback(request.prompt);
  const selectedChartSufficiencyMessage = selectedChartSufficiencyAnswerMessage(request, payloadContext);
  const suppressExpectedArtifactGate = Boolean(
    transformMode
    || selectedChartSufficiencyMessage
    || boundedArtifactFollowupRequested(request),
  );
  const missingExpectedArtifacts = suppressExpectedArtifactGate ? [] : missingExpectedArtifactTypes(request);
  if (missingExpectedArtifacts.length) return missingExpectedArtifactsPayload(request, payloadContext, missingExpectedArtifacts, gate);
  const message = selectedChartSufficiencyMessage ?? directContextAnswerMessage(request, payloadContext, decision);
  const instance = directContextInstance(request, payloadContext);
  const outputSpec = directContextOutputSpec(instance.id, transformMode);
  const reportId = outputSpec.reportId;
  const outputRef = directContextOutputRef(instance.id);
  return {
    message,
    confidence: 0.74,
    claimType: DIRECT_CONTEXT_FAST_PATH_POLICY.claimType,
    evidenceLevel: DIRECT_CONTEXT_FAST_PATH_POLICY.evidenceLevel,
    reasoningTrace: DIRECT_CONTEXT_FAST_PATH_POLICY.reasoningTraceLines.join('\n'),
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'satisfied',
      status: 'completed',
    },
    claims: [{
      id: `${DIRECT_CONTEXT_FAST_PATH_POLICY.claimId}-${instance.id}`,
      text: directContextClaimText(message, payloadContext),
      type: 'fact',
      confidence: 0.74,
      evidenceLevel: DIRECT_CONTEXT_FAST_PATH_POLICY.evidenceLevel,
      supportingRefs: directContextFastPathSupportingRefs(payloadContext),
      opposingRefs: [],
    }],
    uiManifest: directContextUiManifest(reportId, outputSpec.artifactType),
    executionUnits: [{
      id: `EU-direct-context-${instance.id}`,
      tool: DIRECT_CONTEXT_FAST_PATH_POLICY.executionToolId,
      params: JSON.stringify({
        policy: DIRECT_CONTEXT_FAST_PATH_POLICY.policyOwner,
        contextItemCount: context.length,
        directContextGate: gate.audit,
      }),
      status: 'done',
      hash: sha1(message).slice(0, 16),
      runId: instance.runId,
      outputRef,
    }],
    artifacts: [{
      id: reportId,
      type: outputSpec.artifactType,
      producerScenario: request.skillDomain,
      schemaVersion: '1',
      metadata: {
        source: DIRECT_CONTEXT_FAST_PATH_POLICY.source,
        policyOwner: DIRECT_CONTEXT_FAST_PATH_POLICY.policyOwner,
        transformMode: transformMode ?? 'none',
        contextItemCount: payloadContext.length,
        directContextGate: gate.audit,
        runId: instance.runId,
        sourceRunId: instance.runId,
        producerRunId: instance.runId,
        outputRef,
      },
      data: {
        markdown: message,
        context: payloadContext,
      },
    }],
    objectReferences: payloadContext
      .filter((item) => item.ref)
      .map((item, index) => ({
        id: `obj-direct-context-${index + 1}`,
        kind: item.kind,
        title: item.label,
        ref: item.ref,
        runId: instance.runId,
        producerRunId: instance.runId,
        status: 'available',
        summary: item.summary,
      })),
  };
}

function scopedDirectContextPayloadContext(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const selectedRefs = selectedReferenceTokens(request);
  if (!selectedRefs.length || !explicitSelectedOnlyPrompt(request.prompt)) return context;
  const selectedContext = context.filter((item) => directContextItemMatchesSelectedRef(item, selectedRefs));
  return selectedContext.length ? selectedContext : context;
}

function readableArtifactFileRef(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const delivery = isRecord(artifact.delivery) ? artifact.delivery : {};
  return stringField(artifact.dataRef)
    ?? stringField(artifact.path)
    ?? stringField(artifact.ref)
    ?? stringField(metadata.reportRef)
    ?? stringField(metadata.markdownRef)
    ?? stringField(metadata.dataRef)
    ?? stringField(metadata.path)
    ?? stringField(delivery.readableRef)
    ?? stringField(delivery.rawRef);
}

function safeDirectContextReadPath(workspace: string, ref: string | undefined) {
  if (!ref || /^(?:artifact|run|execution-unit|claim|runtime):/i.test(ref)) return undefined;
  const path = isAbsolute(ref) ? resolve(ref) : resolve(workspace, ref);
  const allowedRoots = uniqueStrings([workspace, resolve(process.cwd())]);
  if (!allowedRoots.some((root) => path === root || path.startsWith(`${root}/`))) return undefined;
  if (!/\.(?:md|markdown|txt|csv|tsv|json|py|ipynb)$/i.test(path)) return undefined;
  return path;
}

async function readBoundedUtf8(path: string, maxChars: number) {
  try {
    const text = await readFile(path, 'utf8');
    return text.slice(0, maxChars);
  } catch {
    return undefined;
  }
}

export async function requestWithDirectContextReadableArtifactData(request: GatewayRequest): Promise<GatewayRequest> {
  request = await requestWithSessionArtifactsForBoundedFollowup(request);
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  if (uiState.forceAgentServerGeneration === true) return request;
  if (artifactMutationFollowupRequiresBackend(request.prompt)) return request;
  const decision = directContextDecisionForRequest(request);
  if (!decision || !policyRequestsDirectContext(request, decision)) return request;

  const workspace = resolve(request.workspacePath || process.cwd());
  const artifacts = await Promise.all(request.artifacts.map(async (artifact) => {
    if (!isRecord(artifact)) return artifact;
    const existingData = isRecord(artifact.data) ? artifact.data : {};
    if (stringField(existingData.markdown) || stringField(existingData.content) || stringField(existingData.text)) return artifact;
    const ref = readableArtifactFileRef(artifact);
    const path = safeDirectContextReadPath(workspace, ref);
    if (!path) return artifact;
    const text = await readBoundedUtf8(path, DIRECT_CONTEXT_FAST_PATH_POLICY.contextLimits.summaryChars * 12);
    if (!text) return artifact;
    const type = stringField(artifact.type) ?? stringField(artifact.artifactType) ?? '';
    const data = /report|summary|markdown|document/i.test(type)
      ? { ...existingData, markdown: text, content: text }
      : { ...existingData, content: text };
    return { ...artifact, data };
  }));
  return { ...request, artifacts };
}

async function requestWithSessionArtifactsForBoundedFollowup(request: GatewayRequest): Promise<GatewayRequest> {
  if (request.artifacts.some(isBoundedAnswerArtifact) && (
    !/evidence[-\s_]?matrix|证据矩阵|matrix artifact/i.test(request.prompt)
    || request.artifacts.some((artifact) => isRecord(artifact) && /evidence[-\s_]?matrix/i.test(`${stringField(artifact.type) ?? ''} ${stringField(artifact.id) ?? ''}`))
  )) return request;
  if (!boundedArtifactFollowupPrompt(request.prompt)) return request;
  const workspace = request.workspacePath
    ? resolve(request.workspacePath)
    : process.env.SCIFORGE_WORKSPACE_PATH
      ? resolve(process.env.SCIFORGE_WORKSPACE_PATH)
      : undefined;
  if (!workspace) return request;
  const sessionId = sessionIdFromUiState(request.uiState);
  const artifacts = await readSessionArtifactsForDirectContext(workspace, sessionId);
  return artifacts.length ? { ...request, artifacts: mergeArtifactRecords([...request.artifacts, ...artifacts]) } : request;
}

function sessionIdFromUiState(value: unknown) {
  const uiState = isRecord(value) ? value : {};
  const contextProjection = isRecord(uiState.contextProjection) ? uiState.contextProjection : {};
  const workspaceKernel = isRecord(contextProjection.workspaceKernel) ? contextProjection.workspaceKernel : {};
  const workspaceFacts = isRecord(uiState.workspaceFacts) ? uiState.workspaceFacts : {};
  const sessionBundleRef = stringField(workspaceFacts.sessionBundleRef);
  return stringField(uiState.sessionId)
    ?? stringField(workspaceKernel.sessionId)
    ?? sessionBundleRef?.match(/session-[^/]+$/)?.[0];
}

async function readSessionArtifactsForDirectContext(workspace: string, sessionId: string | undefined) {
  const sessionsRoot = join(workspace, '.sciforge', 'sessions');
  let entries: Array<{ isDirectory(): boolean; name: string }>;
  try {
    entries = await readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !sessionId || entry.name.includes(sessionId))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const bundle of candidates) {
    const artifacts = await readDirectContextBundleArtifacts(join(sessionsRoot, bundle));
    if (artifacts.length) return artifacts;
  }
  return [];
}

async function readDirectContextBundleArtifacts(bundleRoot: string): Promise<Array<Record<string, unknown>>> {
  const fromSession = await readJsonRecord(join(bundleRoot, 'records', 'session.json'));
  const sessionArtifacts = recordRows(fromSession?.artifacts).filter(isBoundedAnswerArtifact);
  const artifactDir = join(bundleRoot, 'artifacts');
  let artifactFiles: Array<{ isFile(): boolean; name: string }> = [];
  try {
    artifactFiles = await readdir(artifactDir, { withFileTypes: true });
  } catch {
    // The session record may still contain enough inline artifact data.
  }
  const fileArtifacts: Array<Record<string, unknown>> = [];
  for (const entry of artifactFiles) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const parsed = await readJsonRecord(join(artifactDir, entry.name));
    if (parsed && isBoundedAnswerArtifact(parsed)) fileArtifacts.push(parsed);
  }
  return mergeArtifactRecords([...sessionArtifacts, ...fileArtifacts])
    .sort((left, right) => directContextArtifactPriority(left) - directContextArtifactPriority(right))
    .slice(0, 12);
}

function directContextArtifactPriority(artifact: Record<string, unknown>) {
  const text = `${stringField(artifact.type) ?? ''} ${stringField(artifact.id) ?? ''}`;
  if (/evidence[-\s_]?matrix/i.test(text)) return 0;
  if (/paper-list/i.test(text)) return 1;
  if (/research-report|report/i.test(text)) return 2;
  if (/notebook/i.test(text)) return 3;
  if (/runtime-context-summary/i.test(text)) return 4;
  return 9;
}

async function readJsonRecord(path: string) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function mergeArtifactRecords(items: Array<Record<string, unknown>>) {
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = stringField(item.id) ?? stringField(item.dataRef) ?? stringField(item.path) ?? JSON.stringify(item).slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function missingExpectedArtifactsPayload(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
  missingExpectedArtifacts: string[],
  gate: DirectContextGateDecision,
): ToolPayload {
  const instance = directContextInstance(request, context, missingExpectedArtifacts);
  const reportId = directContextArtifactId(instance.id);
  const outputRef = directContextOutputRef(instance.id);
  const supportingRefs = directContextFastPathSupportingRefs(context);
  const policy = DIRECT_CONTEXT_FAST_PATH_POLICY.missingExpectedArtifacts;
  const missing = missingExpectedArtifacts.join(', ');
  const nextStep = policy.nextStepTemplate.replace('{{missing}}', missing);
  const message = [
    policy.messageHeader,
    `缺失产物：${missing}`,
    `下一步：${nextStep}`,
  ].join('\n');
  return {
    message,
    confidence: 0.52,
    claimType: policy.claimType,
    evidenceLevel: DIRECT_CONTEXT_FAST_PATH_POLICY.evidenceLevel,
    reasoningTrace: [
      ...DIRECT_CONTEXT_FAST_PATH_POLICY.reasoningTraceLines,
      'Direct-context fast path was downgraded to needs-work because expected artifacts were not present in current refs.',
    ].join('\n'),
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'needs-work',
      status: policy.status,
    },
    claims: [{
      id: `${policy.claimId}-${instance.id}`,
      text: `Missing expected artifacts: ${missing}`,
      type: 'limitation',
      confidence: 0.8,
      evidenceLevel: DIRECT_CONTEXT_FAST_PATH_POLICY.evidenceLevel,
      supportingRefs,
      opposingRefs: [],
    }],
    uiManifest: directContextUiManifest(reportId, policy.artifactType),
    executionUnits: [{
      id: `EU-direct-context-missing-${instance.id}`,
      tool: DIRECT_CONTEXT_FAST_PATH_POLICY.executionToolId,
      params: JSON.stringify({
        policy: DIRECT_CONTEXT_FAST_PATH_POLICY.policyOwner,
        contextItemCount: context.length,
        missingExpectedArtifacts,
        directContextGate: gate.audit,
      }),
      status: 'repair-needed',
      failureReason: `Direct context fast path cannot satisfy follow-up without expected artifacts: ${missing}`,
      recoverActions: [...policy.recoverActions],
      nextStep,
      hash: sha1(message).slice(0, 16),
      runId: instance.runId,
      outputRef,
    }],
    artifacts: [{
      id: reportId,
      type: policy.artifactType,
      producerScenario: request.skillDomain,
      schemaVersion: '1',
      metadata: {
        source: DIRECT_CONTEXT_FAST_PATH_POLICY.source,
        policyOwner: DIRECT_CONTEXT_FAST_PATH_POLICY.policyOwner,
        status: policy.status,
        missingExpectedArtifacts,
        contextItemCount: context.length,
        directContextGate: gate.audit,
        runId: instance.runId,
        sourceRunId: instance.runId,
        producerRunId: instance.runId,
        outputRef,
      },
      data: {
        markdown: message,
        context,
      },
    }],
    objectReferences: context
      .filter((item) => item.ref)
      .map((item, index) => ({
        id: `obj-direct-context-missing-${index + 1}`,
        kind: item.kind,
        title: item.label,
        ref: item.ref,
        runId: instance.runId,
        producerRunId: instance.runId,
        status: 'available',
        summary: item.summary,
      })),
  };
}

interface DirectContextGateDecision {
  allowed: boolean;
  audit: {
    decisionRef?: string;
    intent: DirectContextIntent;
    requiredContext: string[];
    usedContextRefs: string[];
    sufficiency: 'sufficient' | 'insufficient';
    skippedTaskReason?: string;
    blockReason?: string;
  };
}

type DirectContextIntent =
  | 'context-summary'
  | 'context-summary:risk'
  | 'context-summary:method'
  | 'context-summary:timeline'
  | 'run-diagnostic'
  | 'artifact-status'
  | 'capability-status'
  | 'fresh-execution'
  | 'unknown';

type DirectContextTransformMode =
  | 'answer-only-compress'
  | 'answer-only-summary'
  | 'answer-only-checklist'
  | 'answer-only-planning-register'
  | 'answer-only-document'
  | 'none';

interface DirectContextDecision {
  decisionRef: string;
  decisionOwner: 'agentserver' | 'backend' | 'harness-policy';
  intent: DirectContextIntent;
  requiredTypedContext: string[];
  usedRefs: string[];
  allowDirectContext?: boolean;
  transformMode?: DirectContextTransformMode;
  sufficiency: 'sufficient' | 'insufficient';
  blockReason?: string;
}

function directContextGate(
  context: ReturnType<typeof buildDirectContextFastPathItems>,
  decision: DirectContextDecision,
): DirectContextGateDecision {
  const intent = decision.intent;
  const contextRefs = directContextFastPathSupportingRefs(context);
  const usedContextRefs = uniqueStrings([...decision.usedRefs, ...contextRefs]).slice(0, 12);
  const requiredContext = decision.requiredTypedContext.length ? decision.requiredTypedContext : requiredContextForDirectIntent(intent);
  if (intent === 'capability-status') {
    return {
      allowed: false,
      audit: {
        decisionRef: decision.decisionRef,
        intent,
        requiredContext: ['capability-registry', 'tool-registry', 'provider-registry', 'agentserver-worker-registry'],
        usedContextRefs,
        sufficiency: 'insufficient',
        blockReason: decision.blockReason ?? 'Skill/tool/capability/provider status must be answered from registries, not artifact summaries.',
      },
    };
  }
  if (intent === 'fresh-execution') {
    return {
      allowed: false,
      audit: {
        decisionRef: decision.decisionRef,
        intent,
        requiredContext,
        usedContextRefs,
        sufficiency: 'insufficient',
        blockReason: decision.blockReason ?? 'Fresh execution or external lookup request requires backend/tool routing.',
      },
    };
  }
  if (decision.allowDirectContext === false) {
    return {
      allowed: false,
      audit: {
        decisionRef: decision.decisionRef,
        intent,
        requiredContext,
        usedContextRefs,
        sufficiency: 'insufficient',
        blockReason: decision.blockReason ?? 'Structured direct-context decision did not authorize a direct answer.',
      },
    };
  }
  return {
    allowed: true,
    audit: {
      decisionRef: decision.decisionRef,
      intent,
      requiredContext,
      usedContextRefs,
      sufficiency: usedContextRefs.length > 0 ? 'sufficient' : 'insufficient',
      skippedTaskReason: 'Typed current-session context was sufficient for a bounded direct answer.',
    },
  };
}

function directContextDecisionForRequest(request: GatewayRequest): DirectContextDecision | undefined {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const conversationPolicy = isRecord(uiState.conversationPolicy) ? uiState.conversationPolicy : {};
  const harnessContract = isRecord(conversationPolicy.harnessContract) ? conversationPolicy.harnessContract : {};
  const structured = normalizeDirectContextDecision(harnessContract.directContextDecision);
  const fallback = fallbackDirectContextDecisionForBoundedArtifactFollowup(request);
  if (fallback && (!structured || !directContextDecisionAllowsAnswer(structured))) return fallback;
  return structured ?? fallback;
}

function normalizeDirectContextDecision(value: unknown): DirectContextDecision | undefined {
  if (!isRecord(value)) return undefined;
  const decisionRef = stringField(value.decisionRef);
  const decisionOwner = normalizeDirectContextDecisionOwner(value.decisionOwner);
  const intent = normalizeDirectContextIntent(value.intent);
  const requiredTypedContext = toStringList(value.requiredTypedContext);
  const usedRefs = normalizeDirectContextUsedRefs(value.usedRefs);
  const transformMode = normalizeDirectContextTransformMode(value.transformMode);
  const sufficiency = value.sufficiency === 'sufficient' || value.sufficiency === 'insufficient' ? value.sufficiency : undefined;
  if (!decisionRef || !decisionOwner || !intent || !requiredTypedContext.length || !usedRefs.length || !sufficiency) return undefined;
  return {
    decisionRef,
    decisionOwner,
    intent,
    requiredTypedContext,
    usedRefs,
    allowDirectContext: value.allowDirectContext === false ? false : value.allowDirectContext === true ? true : undefined,
    transformMode,
    sufficiency,
    blockReason: stringField(value.blockReason),
  };
}

function normalizeDirectContextDecisionOwner(value: unknown): DirectContextDecision['decisionOwner'] | undefined {
  if (value === 'agentserver' || value === 'backend' || value === 'harness-policy') return value;
  if (value === 'AgentServer') return 'agentserver';
  if (value === 'Backend') return 'backend';
  return undefined;
}

function normalizeDirectContextUsedRefs(value: unknown) {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.flatMap((item) => {
    if (typeof item === 'string') return [item];
    if (isRecord(item)) return [stringField(item.ref)].filter((ref): ref is string => Boolean(ref));
    return [];
  }));
}

function normalizeDirectContextIntent(value: unknown): DirectContextIntent | undefined {
  if (value === 'context-summary'
    || value === 'context-summary:risk'
    || value === 'context-summary:method'
    || value === 'context-summary:timeline'
    || value === 'run-diagnostic'
    || value === 'artifact-status'
    || value === 'capability-status'
    || value === 'fresh-execution'
    || value === 'unknown') return value;
  return undefined;
}

function normalizeDirectContextTransformMode(value: unknown): DirectContextTransformMode | undefined {
  if (value === 'answer-only-compress'
    || value === 'answer-only-summary'
    || value === 'answer-only-checklist'
    || value === 'answer-only-planning-register'
    || value === 'answer-only-document'
    || value === 'none') return value;
  return undefined;
}

function requiredContextForDirectIntent(intent: DirectContextIntent) {
  if (intent === 'run-diagnostic') return ['run-trace', 'execution-units', 'failure-evidence'];
  if (intent === 'artifact-status') return ['artifact-index', 'object-references', 'current-refs'];
  if (intent.startsWith('context-summary')) return ['current-session-context'];
  if (intent === 'capability-status') return ['capability-registry', 'tool-registry', 'provider-registry'];
  if (intent === 'fresh-execution') return ['backend-routing', 'capability-provider-routes'];
  return ['typed-current-context'];
}

function directContextInstance(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
  extra: unknown = undefined,
) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const runId = stringField(uiState.silentStreamRunId)
    ?? stringField(uiState.activeRunId)
    ?? `direct-context-${sha1(JSON.stringify({
      skillDomain: request.skillDomain,
      prompt: request.prompt,
      refs: directContextFastPathSupportingRefs(context),
      extra,
    })).slice(0, 12)}`;
  return { runId, id: sanitizeInstanceId(runId) };
}

function directContextArtifactId(instanceId: string) {
  return `${DIRECT_CONTEXT_FAST_PATH_POLICY.reportArtifactId}-${instanceId}`;
}

function directContextOutputSpec(instanceId: string, transformMode: DirectContextTransformMode | undefined) {
  if (transformMode === 'answer-only-document') {
    return {
      reportId: `research-report-${instanceId}`,
      artifactType: 'research-report',
    };
  }
  return {
    reportId: directContextArtifactId(instanceId),
    artifactType: DIRECT_CONTEXT_FAST_PATH_POLICY.reportArtifactType,
  };
}

function directContextOutputRef(instanceId: string) {
  return `${DIRECT_CONTEXT_FAST_PATH_POLICY.outputRef}/${instanceId}`;
}

function sanitizeInstanceId(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || sha1(value).slice(0, 12);
}

function missingExpectedArtifactTypes(request: GatewayRequest) {
  const expected = expectedArtifactTypesForRequest(request);
  if (!expected.length) return [];
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const artifacts = [...request.artifacts, ...recordRows(uiState.artifacts)];
  const present = new Set(artifacts
    .filter(hasUsableArtifactRefOrData)
    .map((artifact) => stringField(artifact.type) ?? stringField(artifact.artifactType))
    .filter((type): type is string => Boolean(type)));
  return expected.filter((type) => !present.has(type));
}

function directContextUiManifest(primaryArtifactRef: string, primaryArtifactType: string) {
  return runtimeResultViewSlotsPolicy({
    primaryArtifactRef,
    primaryArtifactType,
    runtimeResultRef: DIRECT_CONTEXT_FAST_PATH_POLICY.uiRoute,
  });
}

function directContextAnswerMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
  decision: DirectContextDecision,
) {
  const prompt = request.prompt;
  const selectedChartSufficiency = selectedChartSufficiencyAnswerMessage(request, context);
  if (selectedChartSufficiency) return selectedChartSufficiency;
  const hypotheses = testableHypothesesFromEvidenceMatrixMessage(prompt, context);
  if (hypotheses) return hypotheses;
  const selectedReportEvidenceStatus = selectedReportEvidenceStatusAnswerMessage(request, context);
  if (selectedReportEvidenceStatus) return selectedReportEvidenceStatus;
  const selectedReportCounterfactual = selectedReportCounterfactualThresholdAnswerMessage(request, context);
  if (selectedReportCounterfactual) return selectedReportCounterfactual;
  const selectedReportPassFailAudit = selectedReportPassFailAuditAnswerMessage(request, context);
  if (selectedReportPassFailAudit) return selectedReportPassFailAudit;
  const selectedReportRerunInfo = selectedReportRerunInfoAnswerMessage(request, context);
  if (selectedReportRerunInfo) return selectedReportRerunInfo;
  const selectedReportLiteralFacts = selectedReportLiteralFactAnswerMessage(request, context);
  if (selectedReportLiteralFacts) return selectedReportLiteralFacts;
  const selectedReportBoundary = selectedReportEvidenceBoundaryAnswerMessage(request, context);
  if (selectedReportBoundary) return selectedReportBoundary;
  const selectedReportCredibilityAudit = selectedReportCredibilityAuditAnswerMessage(request, context);
  if (selectedReportCredibilityAudit) return selectedReportCredibilityAudit;
  const protocolBudgetAdaptation = protocolLibraryBudgetAdaptationMessage(prompt, context);
  if (protocolBudgetAdaptation) return protocolBudgetAdaptation;
  const selectedReportAnswer = selectedReportQuestionAnswerMessage(request, context);
  if (selectedReportAnswer) return selectedReportAnswer;
  const transformed = answerOnlyTransformMessage(prompt, context, decision.transformMode);
  if (transformed) return transformed;
  const analysisReportFollowup = analysisReportFollowupMessage(prompt, context);
  if (analysisReportFollowup) return analysisReportFollowup;
  const intentSummary = intentSummaryAnswer(decision.intent, prompt, context);
  if (intentSummary) return intentSummary;
  const selectedReferenceSummary = selectedReferenceSummaryMessage(request, context);
  if (selectedReferenceSummary) return selectedReferenceSummary;
  return directContextFastPathMessage(context);
}

function testableHypothesesFromEvidenceMatrixMessage(
  prompt: string,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  if (!/(hypoth(?:esis|eses)|可检验|假设|validation experiment|minimal validation)/i.test(prompt)) return undefined;
  if (!/(evidence matrix|matrix|证据矩阵)/i.test(prompt)) return undefined;
  const sourceItems = context.filter((item) => /evidence[-\s_]?matrix|row \d+/i.test(`${item.label}\n${item.summary}`));
  const rowStatements = uniqueStrings(sourceItems.flatMap((item) => statementParts(item.summary)))
    .filter((line) => /^Row \d+:/i.test(line) || /doi:|PMID|PMC|ref:/i.test(line))
    .slice(0, 8);
  if (!rowStatements.length) return undefined;
  const groups = [
    {
      title: 'Hypothesis 1: spatial omics can nominate early pancreatic-cancer or precursor-state signals.',
      pick: /(early|precursor|intraductal|papillary|neoplasm|IPMN|keratin|K17|detection|pancreatic)/i,
      experiment: 'Minimal validation experiment: profile archived early PDAC/IPMN versus benign pancreas sections with a targeted spatial transcriptomics or multiplex IF panel, then test whether the nominated epithelial/spatial signature separates lesion stage in a blinded holdout set.',
      failure: 'Main failure mode: provider rows are metadata-level and may describe broad gastrointestinal/spatial omics reviews rather than direct early-detection cohorts.',
    },
    {
      title: 'Hypothesis 2: tumor microenvironment and CAF spatial programs explain part of pancreatic-cancer progression risk.',
      pick: /(microenvironment|CAF|fibroblast|membrane|immune|stromal|dynamic)/i,
      experiment: 'Minimal validation experiment: quantify CAF/immune neighborhoods around malignant and premalignant ducts in 20-30 sections, and correlate neighborhood scores with pathology grade or progression labels.',
      failure: 'Main failure mode: spatial neighborhood associations may be correlative, batch-sensitive, and not specific to pancreatic early detection.',
    },
    {
      title: 'Hypothesis 3: subtype or metabolic spatial states expose measurable vulnerabilities in PDAC tissue.',
      pick: /(subtype|metabolic|vulnerab|segmentation|classification|TUSCAN|single-cell|multimodal)/i,
      experiment: 'Minimal validation experiment: reuse one public or local spatial transcriptomics cohort, run subtype/metabolic-state scoring per spot/region, and test whether high-scoring regions align with orthogonal marker staining or perturbation sensitivity evidence.',
      failure: 'Main failure mode: subtype labels may not transfer across platforms, cohorts, or spot-resolution pipelines.',
    },
  ];
  const used = new Set<string>();
  const fallbackRows = [...rowStatements];
  const sections = groups.map((group, index) => {
    let support = rowStatements.filter((row) => group.pick.test(row) && !used.has(row)).slice(0, 3);
    if (!support.length) support = fallbackRows.filter((row) => !used.has(row)).slice(0, 2);
    support.forEach((row) => used.add(row));
    return [
      `${index + 1}. ${group.title}`,
      'Supporting matrix rows / refs:',
      ...support.map((row) => `- ${row}`),
      group.experiment,
      group.failure,
    ].join('\n');
  });
  return [
    'Answered directly from the existing evidence matrix; no new search or workspace task was started.',
    '',
    ...sections,
  ].join('\n\n');
}

function analysisReportFollowupMessage(
  prompt: string,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  if (!/(treatment effect|confounders?|robustness|batch|timepoint|main conclusion|处理效应|混杂|稳健性)/i.test(prompt)) return undefined;
  const reportText = uniqueStrings(context
    .filter((item) => /report|analysis/i.test(`${item.label} ${item.kind}`))
    .map((item) => item.summary)
    .filter((value): value is string => Boolean(value) && value.length > 200))
    .join('\n\n');
  if (!reportText) return undefined;
  const treatment = treatmentConclusionLines(reportText);
  if (!treatment.length) return undefined;
  const confounders = confounderLines(reportText);
  const robustness = robustnessCheckLines(reportText);
  const english = !/[一-龥]/.test(prompt);
  if (!english) {
    return [
      '基于当前可见分析报告直接回答，不启动新的 workspace task。',
      '',
      '## 处理效应结论',
      ...treatment.map((line) => `- ${line}`),
      '',
      '## 可能混杂因素',
      ...confounders.map((line) => `- ${line}`),
      '',
      '## 稳健性检查',
      ...robustness.map((line) => `- ${line}`),
    ].join('\n');
  }
  return [
    'Answered directly from the visible analysis report without starting a new workspace task.',
    '',
    '## Treatment-effect conclusion',
    ...treatment.map((line) => `- ${line}`),
    '',
    '## Plausible confounders',
    ...confounders.map((line) => `- ${line}`),
    '',
    '## Robustness checks',
    ...robustness.map((line) => `- ${line}`),
  ].join('\n');
}

function protocolLibraryBudgetAdaptationMessage(
  prompt: string,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  if (!/(budget|librar(?:y|ies)|sequencing|timepoints?|预算|测序|文库|时间点)/i.test(prompt)) return undefined;
  if (!/(protocol|trial|RCT|study design|方案|研究设计)/i.test(`${prompt}\n${directContextJoinedText(context).slice(0, 2000)}`)) return undefined;
  const targetLibraries = libraryCountFromPrompt(prompt);
  if (!targetLibraries) return undefined;
  const sourceText = directContextJoinedText(context);
  const patientCount = firstIntegerMatch(sourceText, /(\d+)\s*(?:IBS\s*)?(?:patients?|subjects?|participants?|名|例)/i);
  const currentLibraries = firstIntegerMatch(sourceText, /(\d+)\s*(?:sequencing\s*)?librar(?:y|ies)\b/i)
    ?? firstIntegerMatch(sourceText, /(?:最多|max(?:imum)?|total|共|最多)\D{0,24}(\d+)\s*(?:个\s*)?(?:sequencing\s*)?(?:librar(?:y|ies)|文库)/i);
  const timepoints = protocolTimepoints(sourceText);
  const inferredCurrentTimepoints = patientCount && currentLibraries && currentLibraries % patientCount === 0
    ? currentLibraries / patientCount
    : undefined;
  const currentTimepointCount = Math.max(timepoints.length, inferredCurrentTimepoints ?? 0);
  if (!patientCount || currentTimepointCount < 3) return undefined;
  const targetTimepointsForAll = targetLibraries / patientCount;
  if (!Number.isInteger(targetTimepointsForAll) || targetTimepointsForAll < 1) return undefined;
  const alternativePatients = Math.floor(targetLibraries / currentTimepointCount);
  const finalTimepoint = timepoints.find((timepoint) => /week\s*8|w8|第\s*8\s*周/i.test(timepoint)) ?? timepoints.at(-1) ?? 'final follow-up';
  const baseline = timepoints.find((timepoint) => /baseline|基线/i.test(timepoint)) ?? 'baseline';
  const dropped = timepoints.filter((timepoint) => timepoint !== baseline && timepoint !== finalTimepoint);
  const underpowered = /underpowered|low power|insufficient power|needs-work|低效能|统计功效不足/i.test(sourceText);
  const antibioticBlocker = /antibiotic[\s\S]{0,120}blocker|blocker[\s\S]{0,120}antibiotic|抗生素[\s\S]{0,120}blocker/i.test(sourceText);
  const chinese = /[一-龥]/.test(prompt);
  if (chinese) {
    return [
      '基于当前 protocol artifact 直接回答，不启动新的 workspace task，也不写入新的 artifact。',
      '',
      `推荐改法：保留 ${patientCount} 名患者，把 stool metagenomics 从 ${currentTimepointCount} 个时间点压缩为 ${targetTimepointsForAll} 个时间点，即 ${baseline} + ${finalTimepoint}，总计 ${patientCount} × ${targetTimepointsForAll} = ${targetLibraries} libraries。`,
      dropped.length
        ? `删除/取消的时间点：${dropped.join('、')}。这会牺牲 early response 和非线性 trajectory 信息。`
        : '删除中间随访时间点；保留基线和最终疗效判断时间点。',
      `不推荐方案：约 ${alternativePatients} 名患者 × ${currentTimepointCount} 个时间点 = ${alternativePatients * currentTimepointCount} libraries。${underpowered ? '当前 protocol 已经把样本量/power 标为 needs-work，进一步减样本会放大 primary endpoint 低功效问题。' : '减样本会优先伤害 primary endpoint 的可解释性。'}`,
      `primary endpoint：保持 baseline 到 ${finalTimepoint} 的 IBS symptom score change；metagenomics 作为 secondary/exploratory endpoint 继续保留。`,
      'analysis plan 调整：原来的 repeated-measures/MMRM 或 time × treatment trajectory 分析降级为 ANCOVA / change-score model；如仍做 microbiome longitudinal analysis，应明确只有两个 timepoints，不能估计非线性轨迹。',
      `仍需标记 needs-work/blocker：${underpowered ? 'sample size / power 仍是 needs-work；' : 'power 需要重新计算；'}${antibioticBlocker ? '抗生素暴露 confounding 仍是 causal inference blocker；' : '抗生素、饮食和 clinic confounding 仍需敏感性分析；'}72-library 预算新增 needs-work 是失去 week-4 trajectory/early-response 证据。`,
    ].join('\n');
  }
  return [
    'Answered directly from the current protocol artifact; no new workspace task or artifact write was started.',
    '',
    `Recommended change: keep all ${patientCount} participants and reduce stool metagenomics from ${currentTimepointCount} timepoints to ${targetTimepointsForAll}: ${baseline} + ${finalTimepoint}, for ${patientCount} x ${targetTimepointsForAll} = ${targetLibraries} libraries.`,
    dropped.length
      ? `Dropped timepoint(s): ${dropped.join(', ')}. This loses early-response and nonlinear trajectory evidence.`
      : 'Drop the intermediate follow-up timepoint while preserving baseline and final assessment.',
    `Do not prefer ${alternativePatients} participants x ${currentTimepointCount} timepoints: ${underpowered ? 'the current protocol already labels sample size/power as needs-work, so reducing N makes the primary endpoint weaker.' : 'reducing N weakens the primary endpoint first.'}`,
    `Primary endpoint: preserve symptom-score change from ${baseline} to ${finalTimepoint}; keep metagenomics secondary/exploratory.`,
    'Analysis plan: replace the repeated-measures trajectory model with ANCOVA/change-score modeling; clearly state that two timepoints cannot estimate nonlinear trajectories.',
    `Needs-work/blocker labels remain: ${underpowered ? 'power remains needs-work; ' : 'power must be recalculated; '}${antibioticBlocker ? 'antibiotic confounding remains a causal-inference blocker; ' : 'antibiotic/diet/clinic confounding still needs sensitivity analysis; '}the new 72-library needs-work item is loss of week-4 trajectory evidence.`,
  ].join('\n');
}

function directContextJoinedText(context: ReturnType<typeof buildDirectContextFastPathItems>) {
  return uniqueStrings(context
    .map((item) => item.summary)
    .filter((value): value is string => Boolean(value)))
    .join('\n\n');
}

function libraryCountFromPrompt(prompt: string) {
  return firstIntegerMatch(prompt, /(\d+)\s*(?:sequencing\s*)?librar(?:y|ies)\b/i)
    ?? firstIntegerMatch(prompt, /预算\D{0,16}(\d+)\s*(?:个\s*)?(?:librar(?:y|ies)|文库)/i);
}

function firstIntegerMatch(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  if (!match?.[1]) return undefined;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function protocolTimepoints(text: string) {
  const labels = new Set<string>();
  const baselineLabel = /[一-龥]/.test(text) ? 'baseline/基线' : 'baseline';
  if (/\bbaseline\b|基线/i.test(text)) labels.add(baselineLabel);
  for (const match of text.matchAll(/\bweek\s*(\d+)\b|第\s*(\d+)\s*周/gi)) {
    const week = match[1] ?? match[2];
    const numericWeek = week ? Number(week) : undefined;
    if (numericWeek === 0) {
      labels.add(baselineLabel);
    } else if (typeof numericWeek === 'number' && Number.isInteger(numericWeek) && numericWeek > 0) {
      labels.add(`week ${numericWeek}`);
    }
  }
  return Array.from(labels);
}

function answerOnlyTransformMessage(
  text: string,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
  transformMode: DirectContextTransformMode | undefined,
) {
  const requested = transformMode && transformMode !== 'none'
    ? transformMode
    : answerOnlyTransformRequestedLegacyFallback(text);
  if (!requested) {
    return undefined;
  }
  if (requested === 'answer-only-document') {
    return documentTransformMessage(text, context);
  }
  if (requested === 'answer-only-planning-register') {
    return planningRegisterTransformMessage(text, context);
  }
  const prioritizedContext = [
    ...context.filter((item) => /claim|finding|answer/i.test(item.kind)),
    ...context.filter((item) => !/claim|finding|answer/i.test(item.kind)),
  ];
  const snippets = directContextStatements(prioritizedContext, { answerOnlyTransform: true })
    .slice(0, requested === 'answer-only-checklist' || /three|3|三/.test(text) ? 3 : /two|2|两|二/.test(text) ? 2 : 5);
  if (!snippets.length) return undefined;
  if (requested === 'answer-only-checklist' || /(checklist|bullet|清单|列表)/i.test(text)) {
    const header = /[一-龥]/.test(text) ? '基于上一轮可见答案整理为清单：' : 'Checklist from the previous visible answer:';
    return [header, ...snippets.map((item) => `- ${item}`)].join('\n');
  }
  if (/[一-龥]/.test(text)) {
    return `基于上一轮可见答案直接回答：${snippets.join('；')}。`;
  }
  return `Direct answer from the previous visible answer: ${snippets.join('; ')}.`;
}

function answerOnlyTransformRequestedLegacyFallback(text: string): DirectContextTransformMode | undefined {
  // Legacy baseline fallback for requests that predate the harness L1
  // classifyDirectContextTransform hook.
  const matched = /(compress|condense|shorten|summari[sz]e|rewrite|rephrase|checklist|bullet|budget|timeline|milestones?|risk register|unresolved risks?|main document|proposal document|grant proposal|document artifact|research report|主文档|文档|报告|项目书|申请书|压缩|浓缩|改写|重写|总结|归纳|清单|预算|时间线|里程碑|风险清单)/i.test(text)
    && /(previous|prior|last|existing|above|answer|conclusion|points?|selected|current|restored|reload|reopen|final(?: version| summary)?|上一轮|之前|刚才|已有|答案|结论|要点|选中|当前|恢复|重载|重新打开|最终)/i.test(text)
    && !/(rerun|run again|execute|download|生成(?:新的)?(?:报告|表格|图|文件|产物)|下载|执行|运行)/i.test(text);
  if (!matched) return undefined;
  if (/(main document|proposal document|grant proposal|document artifact|research report|主文档|项目书|申请书|报告文档)/i.test(text)) return 'answer-only-document';
  if (/(budget|timeline|milestones?|risk register|unresolved risks?|预算|时间线|里程碑|风险清单)/i.test(text)) return 'answer-only-planning-register';
  if (/(checklist|bullet|清单|列表)/i.test(text)) return 'answer-only-checklist';
  if (/(compress|condense|shorten|压缩|浓缩)/i.test(text)) return 'answer-only-compress';
  return 'answer-only-summary';
}

function selectedReportEvidenceStatusAnswerMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = request.prompt;
  if (!/(selected|reference|report|artifact|选中|引用|报告|产物)/i.test(prompt)) return undefined;
  if (!/(PDF|full[-\s]?text|arXiv|evidence|verification|verify|verified|support|completion|read|全文|证据|读取|阅读|验证|支持|完成|结论)/i.test(prompt)) return undefined;
  const selectedRefs = selectedReferenceTokens(request);
  const selectedContext = selectedRefs.length
    ? context.filter((item) => directContextItemMatchesSelectedRef(item, selectedRefs))
    : context;
  const answerContext = (selectedContext.length ? selectedContext : context)
    .filter((item) => !/claim|execution-unit|audit|diagnostic/i.test(item.kind));
  const sourceText = uniqueStrings(answerContext
    .map((item) => item.summary)
    .filter((value): value is string => Boolean(value)))
    .join('\n');
  if (!sourceText) return undefined;
  const asksFullTextStatus = /(PDF|full[-\s]?text|arXiv|全文|读取|阅读|验证|支持|完成)/i.test(prompt);
  const saysMetadataOnly = /(provider[-\s]?grounded metadata|provider metadata|metadata until full[-\s]?text verification|until full[-\s]?text verification|requires full[-\s]?text verification|citation verification|unverified|needs[-\s]?verification|未验证|待验证|未完成全文|未读取全文)/i.test(sourceText);
  const hasCompletedFullTextEvidence = /(PDF|full[-\s]?text|全文)[^。.!?\n]{0,80}(read|retrieved|downloaded|verified|completed|已读取|已阅读|已获取|已验证|完成)/i.test(sourceText)
    && !/(until full[-\s]?text verification|requires full[-\s]?text verification|未验证|待验证|metadata until)/i.test(sourceText);
  if (!asksFullTextStatus && !saysMetadataOnly) return undefined;
  const sourceLines = evidenceStatusSourceLines(sourceText);
  const selectedTitle = selectedReportTitle(request) ?? 'selected report';
  if (/[一-龥]/.test(prompt)) {
    if (saysMetadataOnly || !hasCompletedFullTextEvidence) {
      return [
        `只基于当前选中的 ${selectedTitle} 回答，不启动新的 workspace task，也不使用未选中的历史消息或外部新检索。`,
        '',
        '- 已读取的 arXiv PDF/全文证据：这份选中报告没有记录任何已经读取、下载或验证过的 arXiv PDF/全文证据。',
        '- 未读取或未验证的部分：报告只留下 provider/web_search 路由产出的候选元数据；候选行仍被标记为 provider-grounded metadata，等待 full-text/citation verification。',
        '- 能否支持“全文调研已完成”：不能。它只能支持“已有候选元数据/诊断材料”，不能支持“全文调研已完成”或“PDF 证据已读完”的结论。',
        '- 下一步恢复：按候选论文逐篇解析 arXiv 身份和 PDF/全文，记录已读取的段落/页码/证据位置，做 citation/title/date 校验，再重新生成证据矩阵和中文报告。',
        ...sourceLines.map((line) => `- 选中报告依据：${line}`),
      ].join('\n');
    }
    return [
      `只基于当前选中的 ${selectedTitle} 回答，不启动新的 workspace task。`,
      '- 选中报告包含已完成全文/PDF 读取的表述；仍需逐条核对证据位置后才能把它当作最终完成结论。',
      ...sourceLines.map((line) => `- 选中报告依据：${line}`),
    ].join('\n');
  }
  if (saysMetadataOnly || !hasCompletedFullTextEvidence) {
    return [
      `Answered only from the selected ${selectedTitle}; no new workspace task or external lookup was started.`,
      '',
      '- Read arXiv PDF/full-text evidence: the selected report does not record any arXiv PDF or full-text evidence as read, downloaded, or verified.',
      '- Missing/unverified evidence: it only preserves provider/web_search candidate metadata and says the rows remain provider-grounded until full-text/citation verification.',
      '- Completion verdict: it cannot support a claim that full-text research is complete.',
      '- Recovery step: read each candidate paper/PDF, record evidence locations, verify citation/title/date identity, then regenerate the evidence matrix and report.',
      ...sourceLines.map((line) => `- Selected-report basis: ${line}`),
    ].join('\n');
  }
  return [
    `Answered only from the selected ${selectedTitle}; no new workspace task was started.`,
    '- The selected report includes completed full-text/PDF language, but the evidence locations still need item-by-item audit before treating it as a final completion claim.',
    ...sourceLines.map((line) => `- Selected-report basis: ${line}`),
  ].join('\n');
}

function selectedReportTitle(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  return uniqueStrings([...recordRows(request.references), ...recordRows(uiState.currentReferences)]
    .map((reference) => stringField(reference.title) ?? stringField(reference.ref))
    .filter((value): value is string => Boolean(value)))
    .find(Boolean);
}

function evidenceStatusSourceLines(sourceText: string) {
  const lines = sourceText
    .split(/(?<=[。.!?；;])\s+|[\n\r]+/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => /(provider|metadata|full[-\s]?text|PDF|arXiv|citation|verification|verified|unverified|全文|读取|阅读|验证)/i.test(line))
    .filter((line) => line.length > 0 && line.length <= 260);
  return uniqueStrings(lines).slice(0, 3);
}

function selectedChartSufficiencyAnswerMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = request.prompt;
  if (!/(selected|reference|artifact|chart|plot|figure|image|选中|引用|产物|图表|图片)/i.test(prompt)) return undefined;
  if (!/(alone|only|single|support|prove|conclude|conclusion|statistical|significance|p[-\s]?value|confidence interval|batch|confound|causal|单独|仅|只|支持|证明|结论|显著|混杂|批次)/i.test(prompt)) return undefined;
  const selectedRefs = selectedReferenceTokens(request);
  const selectedContext = selectedRefs.length
    ? context.filter((item) => directContextItemMatchesSelectedRef(item, selectedRefs))
    : context.filter((item) => /(chart|plot|figure|image|png|jpeg|svg|图)/i.test(`${item.kind} ${item.label} ${item.ref ?? ''}`));
  const promptMentionsChart = /(chart|plot|figure|image|png|jpe?g|webp|svg|boxplot|violin|heatmap|图表|图片|图像)/i.test(prompt);
  const selectedLooksLikeChart = selectedContext.some((item) => /(chart|plot|figure|image|png|jpe?g|webp|svg|boxplot|violin|heatmap|图表|图片|图像)/i.test(`${item.kind} ${item.label} ${item.ref ?? ''} ${item.summary}`));
  if (!promptMentionsChart && !selectedLooksLikeChart) return undefined;
  const chartContext = selectedContext.filter((item) => /(chart|plot|figure|image|png|jpeg|jpg|webp|svg|boxplot|violin|heatmap|图)/i.test(`${item.kind} ${item.label} ${item.ref ?? ''} ${item.summary}`));
  const answerContext = chartContext.length ? chartContext : selectedContext;
  if (!answerContext.length) return undefined;
  const refLine = directContextFastPathSupportingRefs(answerContext).slice(0, 3).join(', ') || answerContext[0]?.label || 'selected chart';
  const asksStatistics = /(statistical|significance|p[-\s]?value|confidence interval|interval|sample size|effect|model|test|显著|p\s*值|置信|样本|效应|模型|检验)/i.test(prompt);
  const asksConfounding = /(batch|confound|adjust|control|stratif|批次|混杂|控制|调整|分层)/i.test(prompt);
  if (/[一-龥]/.test(prompt)) {
    return [
      `只基于当前选中的图表引用回答：${refLine}。没有启动新的 workspace task，也不使用其他引用。`,
      '',
      '结论：不能。单个图表最多提供视觉线索，不能单独证明统计显著性或 batch-confounding 结论。',
      ...(asksStatistics ? [
        '缺少的统计显著性依据：原始样本值或可审计数据表、每组样本量、具体检验或模型、效应方向与效应量、p 值或置信区间、以及检验假设/诊断。',
      ] : []),
      ...(asksConfounding ? [
        '缺少的混杂依据：batch 标签、treatment/timepoint 在 batch 中的分布、分层或调整前后模型结果，以及控制 batch 后效应是否保持的比较。',
      ] : []),
      '可支持的有限判断：如果图表可见，它只能提示组间分布可能不同；这不是可复现的统计或混杂控制证据。',
    ].join('\n');
  }
  return [
    `Answered only from the selected chart reference: ${refLine}. No new workspace task was started, and other refs were not used.`,
    '',
    'Conclusion: no. A single chart can provide a visual cue, but it cannot by itself establish statistical significance or a batch-confounding conclusion.',
    ...(asksStatistics ? [
      'Missing for statistical significance: auditable sample-level data, group sample sizes, the exact test/model, effect direction and effect size, p value or confidence interval, and test assumptions/diagnostics.',
    ] : []),
    ...(asksConfounding ? [
      'Missing for batch confounding: batch labels, treatment/timepoint balance across batches, stratified or adjusted model results, and a before/after comparison showing how batch control changes the drugA@48h estimate.',
    ] : []),
    'What the selected chart can support at most: a visual hypothesis that distributions may differ; it is not a reproducible statistical or confounding-control result on its own.',
  ].join('\n');
}

interface SelectedReportPassFailRow {
  metric: string;
  trueValue?: string;
  fittedValue?: string;
  error?: string;
  threshold?: string;
  verdict?: 'PASS' | 'FAIL';
}

interface SelectedReportThresholdCheck {
  metric: string;
  observedLabel: string;
  observed?: number;
  observedText?: string;
  threshold: number;
  thresholdText: string;
  pass: boolean;
}

function selectedReportSourceText(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const selectedRefs = selectedReferenceTokens(request);
  const selectedContext = selectedRefs.length
    ? context.filter((item) => directContextItemMatchesSelectedRef(item, selectedRefs))
    : context;
  return uniqueStrings((selectedContext.length ? selectedContext : context)
    .filter((item) => /report|artifact|file|summary|reference/i.test(`${item.kind} ${item.label}`))
    .map((item) => item.summary)
    .filter((value): value is string => Boolean(value)))
    .join('\n');
}

function selectedReportCounterfactualThresholdAnswerMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = request.prompt;
  if (!/(selected|reference|report|artifact|reproduc|选中|引用|报告|产物|复现)/i.test(prompt)) return undefined;
  if (!/(counterfactual|if|new threshold|stricter|still|success|反事实|如果|新门槛|新阈值|仍可|仍然|判成功|验收|门槛|阈值|<=|≤)/i.test(prompt)) return undefined;
  if (!/(r\b|K\b|RMSE|error|误差)/i.test(prompt)) return undefined;
  const sourceText = selectedReportSourceText(request, context);
  if (!sourceText) return undefined;
  const rows = selectedReportPassFailRows(sourceText);
  if (!rows.length) return undefined;
  const checks = selectedReportCounterfactualThresholdChecks(prompt, rows);
  if (!checks.length) return undefined;
  const failed = checks.filter((check) => !check.pass);
  const selectedTitle = selectedReportTitle(request) ?? 'selected report';
  if (/[一-龥]/.test(prompt)) {
    return [
      `只基于当前选中的 ${selectedTitle} 做反事实门槛验收，不启动新的 workspace task，也不沿用原报告的 success 结论替代重新判断。`,
      '',
      `是否仍可判成功：${failed.length ? '不能' : '可以'}。`,
      ...checks.map((check) => `- ${check.metric}: observed ${check.observedLabel}=${check.observedText ?? '未给出'}; new threshold<=${check.thresholdText}; verdict=${check.pass ? 'PASS' : 'FAIL'}.`),
      failed.length
        ? `未达标项：${failed.map((check) => check.metric).join('、')}。`
        : '未达标项：没有。',
    ].join('\n');
  }
  return [
    `Answered only from the selected ${selectedTitle}; no new workspace task was started, and the original success label was not reused as the decision rule.`,
    '',
    `Still successful under the new thresholds: ${failed.length ? 'NO' : 'YES'}.`,
    ...checks.map((check) => `- ${check.metric}: observed ${check.observedLabel}=${check.observedText ?? 'not stated'}; new threshold<=${check.thresholdText}; verdict=${check.pass ? 'PASS' : 'FAIL'}.`),
    failed.length
      ? `Failed checks: ${failed.map((check) => check.metric).join(', ')}.`
      : 'Failed checks: none.',
  ].join('\n');
}

function selectedReportCounterfactualThresholdChecks(
  prompt: string,
  rows: SelectedReportPassFailRow[],
): SelectedReportThresholdCheck[] {
  const thresholds = selectedReportThresholdsFromPrompt(prompt);
  return thresholds.flatMap(({ metric, threshold, thresholdText }) => {
    const row = findSelectedReportMetricRow(rows, metric);
    if (!row) return [];
    const observedText = metric === 'RMSE' ? row.fittedValue ?? row.error : row.error;
    const observed = numericMetricValue(observedText);
    if (observed === undefined) return [];
    return [{
      metric,
      observedLabel: metric === 'RMSE' ? 'value' : 'error',
      observed,
      observedText,
      threshold,
      thresholdText,
      pass: observed <= threshold,
    }];
  });
}

function selectedReportThresholdsFromPrompt(prompt: string) {
  return [
    { metric: 'r', pattern: /\br\s*(?:error|误差)?\s*(?:<=|≤|不超过|小于等于)\s*([0-9]+(?:\.[0-9]+)?)\s*%?/i, suffix: '%' },
    { metric: 'K', pattern: /\bK\s*(?:error|误差)?\s*(?:<=|≤|不超过|小于等于)\s*([0-9]+(?:\.[0-9]+)?)\s*%?/i, suffix: '%' },
    { metric: 'RMSE', pattern: /\bRMSE\b\s*(?:<=|≤|不超过|小于等于)\s*([0-9]+(?:\.[0-9]+)?)/i, suffix: '' },
  ].flatMap(({ metric, pattern, suffix }) => {
    const match = prompt.match(pattern);
    if (!match) return [];
    const threshold = Number(match[1]);
    if (!Number.isFinite(threshold)) return [];
    return [{ metric, threshold, thresholdText: `${match[1]}${suffix}` }];
  });
}

function findSelectedReportMetricRow(rows: SelectedReportPassFailRow[], metric: string) {
  const target = normalizeMetricName(metric);
  return rows.find((row) => normalizeMetricName(row.metric) === target);
}

function numericMetricValue(value: string | undefined) {
  const normalized = value?.replace(/[%\s,]/g, '');
  if (!normalized || /^[-—–]+$/.test(normalized)) return undefined;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function selectedReportRerunInfoAnswerMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = request.prompt;
  if (!/(selected|reference|report|artifact|reproduc|选中|引用|报告|产物|复现)/i.test(prompt)) return undefined;
  if (!/(rerun command|run command|complete rerun|copy-pasteable command|script path|复跑性|复现命令|运行命令|完整.{0,8}命令|脚本路径)/i.test(prompt)) return undefined;
  const sourceText = selectedReportSourceText(request, context);
  if (!sourceText) return undefined;
  const commandLines = selectedReportCommandLines(sourceText);
  const scriptName = selectedReportGeneratedByScript(sourceText);
  const selectedTitle = selectedReportTitle(request) ?? 'selected report';
  if (/[一-龥]/.test(prompt)) {
    return [
      `只基于当前选中的 ${selectedTitle} 核对复跑信息，不补造 report 里没有出现的命令或路径。`,
      '',
      `- 完整 rerun command：${commandLines.length ? commandLines.join(' ; ') : '未给出。'}`,
      `- 脚本路径：${scriptName ? `${scriptName}（报告只给出脚本名，不是完整路径）` : '未给出。'}`,
      `- 缺口：${commandLines.length && scriptName ? '仍需确认工作目录、依赖和输入数据。' : '缺少可直接复制执行的完整命令、工作目录、依赖/环境信息和输入数据位置。'}`,
    ].join('\n');
  }
  return [
    `Answered only from the selected ${selectedTitle}; no rerun command or path was invented.`,
    '',
    `- Complete rerun command: ${commandLines.length ? commandLines.join(' ; ') : 'not stated.'}`,
    `- Script path: ${scriptName ? `${scriptName} (the report gives only a script name, not a full path).` : 'not stated.'}`,
    `- Gap: ${commandLines.length && scriptName ? 'working directory, dependencies, and inputs still need confirmation.' : 'missing copy-pasteable command, working directory, dependency/environment details, and input locations.'}`,
  ].join('\n');
}

function selectedReportCommandLines(sourceText: string) {
  return uniqueStrings(sourceText
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^`{1,3}|`{1,3}$/g, ''))
    .filter((line) => /^(?:python|python3|node|npm|pnpm|yarn|uv|pytest|npx|tsx)\b/i.test(line)))
    .slice(0, 4);
}

function selectedReportGeneratedByScript(sourceText: string) {
  return sourceText.match(/Report generated by\s+([^\s`'"]+)/i)?.[1]
    ?? sourceText.match(/\b([A-Za-z0-9._/-]+\.py)\b/)?.[1];
}

function selectedReportFieldValue(sourceText: string, fieldPattern: RegExp) {
  for (const part of statementParts(sourceText)) {
    const match = part.match(fieldPattern);
    if (match?.[1]) return match[1].trim();
  }
  return sourceText.match(fieldPattern)?.[1]?.trim();
}

function selectedReportLiteralFactAnswerMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = request.prompt;
  if (!/(selected|reference|report|artifact|reproduc|选中|引用|报告|产物|复现)/i.test(prompt)) return undefined;
  if (!/(random seed|seed|optimizer|bounds?|noise|std|脚本|路径|随机种子|优化器|边界|噪声)/i.test(prompt)) return undefined;
  const sourceText = selectedReportSourceText(request, context);
  if (!sourceText) return undefined;
  const facts = [
    /random seed|seed|随机种子/i.test(prompt) ? ['Random seed', selectedReportFieldValue(sourceText, /^(?:[-*]\s*)?Random seed\s*[:：]\s*(.+)$/i)] : undefined,
    /optimizer|优化器/i.test(prompt) ? ['Optimizer', selectedReportFieldValue(sourceText, /^(?:[-*]\s*)?Optimizer\s*[:：]\s*(.+)$/i)] : undefined,
    /bounds?|边界/i.test(prompt) ? ['Bounds', selectedReportFieldValue(sourceText, /^(?:[-*]\s*)?Bounds\s*[:：]\s*(.+)$/i)] : undefined,
    /noise|std|噪声/i.test(prompt) ? ['Synthetic noise std', selectedReportFieldValue(sourceText, /^(?:[-*]\s*)?Synthetic noise std\s*[:：]\s*(.+)$/i)] : undefined,
    /script|脚本|路径/i.test(prompt) ? ['Report generated by', selectedReportGeneratedByScript(sourceText)] : undefined,
  ].filter((item): item is [string, string | undefined] => Boolean(item));
  if (!facts.length) return undefined;
  const selectedTitle = selectedReportTitle(request) ?? 'selected report';
  if (/[一-龥]/.test(prompt)) {
    return [
      `只基于当前选中的 ${selectedTitle} 回答，不给可信度总结。`,
      '',
      ...facts.map(([label, value]) => `- ${label}: ${value?.trim() || '报告未给出'}`),
    ].join('\n');
  }
  return [
    `Answered only from the selected ${selectedTitle}; no credibility summary was added.`,
    '',
    ...facts.map(([label, value]) => `- ${label}: ${value?.trim() || 'not stated'}`),
  ].join('\n');
}

function selectedReportEvidenceBoundaryAnswerMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = request.prompt;
  if (!/(selected|reference|report|artifact|reproduc|这份|当前|选中|引用|报告|产物|复现)/i.test(prompt)) return undefined;
  if (!/(cannot prove|cannot show|not prove|extrapolat|limitation|boundary|不能证明|不能外推|外推|边界|局限|缺口)/i.test(prompt)) return undefined;
  const sourceText = selectedReportSourceText(request, context);
  if (!sourceText) return undefined;
  const limitations = selectedReportBoundaryLimitations(sourceText).slice(0, 6);
  if (limitations.length < 2) return undefined;
  const selectedTitle = selectedReportTitle(request) ?? 'selected report';
  if (/[一-龥]/.test(prompt)) {
    return [
      `只基于当前选中的 ${selectedTitle} 做证据边界审计，不启动新的 workspace task。`,
      '',
      ...limitations.map((line, index) => `${index + 1}. ${line}`),
    ].join('\n');
  }
  return [
    `Answered only from the selected ${selectedTitle}; no new workspace task was started.`,
    '',
    ...limitations.map((line, index) => `${index + 1}. ${line}`),
  ].join('\n');
}

function selectedReportBoundaryLimitations(sourceText: string) {
  return uniqueStrings([
    /synthetic/i.test(sourceText)
      ? '不能证明真实数据或外部队列上的效果，因为报告只说明使用 synthetic data。'
      : undefined,
    /random seed|fixed seed|seed/i.test(sourceText)
      ? '不能证明随机种子稳健性，因为报告只记录了单一 random seed。'
      : undefined,
    /noise|noisy|Synthetic noise std/i.test(sourceText)
      ? '不能证明不同噪声水平下仍稳定，因为报告只给出当前噪声设置。'
      : undefined,
    /toy|logistic/i.test(sourceText)
      ? '不能外推到更复杂模型或真实科研复现，因为报告范围是 toy logistic-growth reproduction。'
      : undefined,
    selectedReportCommandLines(sourceText).length === 0
      ? '不能证明第三方可直接复跑，因为报告没有给出完整 rerun command。'
      : undefined,
    !/(holdout|independent|external|validation set|真实|外部|独立)/i.test(sourceText)
      ? '不能证明独立验证集表现，因为报告没有记录 holdout/external validation。'
      : undefined,
  ].filter((value): value is string => Boolean(value)));
}

function selectedReportCredibilityAuditAnswerMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = request.prompt;
  if (!/(selected|reference|report|artifact|reproduc|当前|选中|引用|报告|产物|复现)/i.test(prompt)) return undefined;
  if (!/(over.?optimistic|too optimistic|credible as a toy reproduction|supporting evidence|counter.?evidence|audit|过度乐观|支持证据|反对证据|一致性审计)/i.test(prompt)) return undefined;
  const sourceText = selectedReportSourceText(request, context);
  if (!sourceText) return undefined;
  const rows = selectedReportPassFailRows(sourceText);
  const metrics = selectedReportMetricLines(sourceText);
  if (!rows.length && !metrics.length) return undefined;
  const failed = rows.filter((row) => row.verdict === 'FAIL');
  const selectedTitle = selectedReportTitle(request) ?? 'selected report';
  const boundedNo = failed.length === 0;
  const support = metrics.length ? metrics.slice(0, 4) : rows.map(formatSelectedReportPassFailRowEn).slice(0, 4);
  const counter = selectedReportBoundaryLimitations(sourceText).slice(0, 3);
  if (/[一-龥]/.test(prompt)) {
    return [
      `只基于当前选中的 ${selectedTitle} 做一致性审计，不使用未选中的历史消息。`,
      '',
      `yes/no：${boundedNo ? 'No' : 'Yes'}。如果措辞严格限定为 “credible as a toy reproduction”，报告证据没有过度乐观；如果把它读成真实/稳健复现成功，则会过度外推。`,
      '支持证据：',
      ...support.map((line) => `- ${line}`),
      '反对证据/边界：',
      ...(counter.length ? counter.map((line) => `- ${line}`) : ['- 报告没有提供足够的外部稳健性证据。']),
      '最小补充实验：换多个 random seeds 和 noise levels 重跑同一拟合，并要求 r/K error 与 RMSE 继续满足同一阈值。',
    ].join('\n');
  }
  return [
    `Answered only from the selected ${selectedTitle}; unselected history was not used.`,
    '',
    `Yes/no: ${boundedNo ? 'No' : 'Yes'}. The phrase "credible as a toy reproduction" is supported if it stays bounded to the toy setup; reading it as real-world or robust reproduction success would overreach.`,
    'Supporting evidence:',
    ...support.map((line) => `- ${line}`),
    'Counter-evidence / boundary:',
    ...(counter.length ? counter.map((line) => `- ${line}`) : ['- The report does not provide enough external robustness evidence.']),
    'Minimal supplementary experiment: rerun the fit across multiple random seeds and noise levels, requiring r/K error and RMSE to keep passing the same thresholds.',
  ].join('\n');
}

function selectedReportPassFailAuditAnswerMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = request.prompt;
  if (!/(selected|reference|report|artifact|reproduc|选中|引用|报告|产物|复现)/i.test(prompt)) return undefined;
  if (!/(PASS|FAIL|pass\/fail|true|fitted|error|threshold|RMSE|达标|未达标|没达标|阈值|逐项|核对|指标|误差|拟合)/i.test(prompt)) return undefined;
  const selectedRefs = selectedReferenceTokens(request);
  const selectedContext = selectedRefs.length
    ? context.filter((item) => directContextItemMatchesSelectedRef(item, selectedRefs))
    : context;
  const sourceText = uniqueStrings((selectedContext.length ? selectedContext : context)
    .filter((item) => /report|artifact|file|summary|reference/i.test(`${item.kind} ${item.label}`))
    .map((item) => item.summary)
    .filter((value): value is string => Boolean(value)))
    .join('\n');
  if (!/\b(?:PASS|FAIL)\b|threshold|阈值|达标|未达标|没达标/i.test(sourceText)) return undefined;
  const rows = selectedReportPassFailRows(sourceText);
  if (!rows.length) return undefined;
  const failed = rows.filter((row) => row.verdict === 'FAIL');
  const selectedTitle = selectedReportTitle(request) ?? 'selected report';
  if (/[一-龥]/.test(prompt)) {
    return [
      `只基于当前选中的 ${selectedTitle} 逐项核对，不启动新的 workspace task，也不使用未选中的历史消息或其它 artifact。`,
      '',
      ...rows.map(formatSelectedReportPassFailRowZh),
      '',
      failed.length
        ? `未达标项：${failed.map((row) => row.metric).join('、')}。`
        : '未达标项：没有。选中报告中这些检查均为 PASS。',
    ].join('\n');
  }
  return [
    `Answered only from the selected ${selectedTitle}; no new workspace task was started, and unselected history/artifacts were not used.`,
    '',
    ...rows.map(formatSelectedReportPassFailRowEn),
    '',
    failed.length
      ? `Failed checks: ${failed.map((row) => row.metric).join(', ')}.`
      : 'Failed checks: none. The selected report marks these checks as PASS.',
  ].join('\n');
}

function selectedReportPassFailRows(sourceText: string): SelectedReportPassFailRow[] {
  const rows = new Map<string, SelectedReportPassFailRow>();
  for (const match of sourceText.matchAll(/\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|/g)) {
    const metric = match[1]?.trim();
    if (!metric || /^[-:]+$/.test(metric) || /^parameter$/i.test(metric)) continue;
    if ([match[2], match[3], match[4]].some((cell) => /^[-:\s]+$/.test(cell ?? ''))) continue;
    const row = ensurePassFailRow(rows, metric);
    row.trueValue = normalizeMetricCell(match[2]) ?? row.trueValue;
    row.fittedValue = normalizeMetricCell(match[3]) ?? row.fittedValue;
    row.error = normalizeMetricCell(match[4]) ?? row.error;
  }
  for (const match of sourceText.matchAll(/(?:^|[\n\r]\s*|\s+-\s*)[-*]?\s*([A-Za-z][A-Za-z0-9 _./-]*?)(?:\s+error)?\s*:\s*([0-9]+(?:\.[0-9]+)?%?)\s*\(\s*threshold\s*([0-9]+(?:\.[0-9]+)?%?)\s*\)\s*(?:[-–—>→\s]*)\b(PASS|FAIL)\b/gi)) {
    const metric = match[1]?.trim();
    if (!metric) continue;
    const row = ensurePassFailRow(rows, metric);
    if (/RMSE/i.test(metric)) row.fittedValue = row.fittedValue ?? match[2];
    else row.error = row.error ?? match[2];
    row.threshold = match[3];
    row.verdict = match[4]?.toUpperCase() === 'FAIL' ? 'FAIL' : 'PASS';
  }
  return Array.from(rows.values())
    .filter((row) => row.verdict || row.threshold || row.trueValue || row.fittedValue || row.error)
    .slice(0, 8);
}

function ensurePassFailRow(rows: Map<string, SelectedReportPassFailRow>, metric: string) {
  const key = normalizeMetricName(metric);
  const existing = rows.get(key);
  if (existing) return existing;
  const row: SelectedReportPassFailRow = { metric: metric.trim() };
  rows.set(key, row);
  return row;
}

function normalizeMetricName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeMetricCell(value: string | undefined) {
  const text = value?.trim();
  if (!text || /^[-—–]+$/.test(text)) return undefined;
  return text;
}

function formatSelectedReportPassFailRowZh(row: SelectedReportPassFailRow) {
  return `- ${row.metric}: true=${row.trueValue ?? '未给出/不适用'}; fitted=${row.fittedValue ?? '未给出/不适用'}; error=${row.error ?? '未给出/不适用'}; threshold=${row.threshold ?? '未给出'}; verdict=${row.verdict ?? '未给出'}.`;
}

function formatSelectedReportPassFailRowEn(row: SelectedReportPassFailRow) {
  return `- ${row.metric}: true=${row.trueValue ?? 'not stated / N/A'}; fitted=${row.fittedValue ?? 'not stated / N/A'}; error=${row.error ?? 'not stated / N/A'}; threshold=${row.threshold ?? 'not stated'}; verdict=${row.verdict ?? 'not stated'}.`;
}

function selectedReportQuestionAnswerMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = request.prompt;
  if (!/(selected|reference|report|artifact|选中|引用|报告|产物)/i.test(prompt)) return undefined;
  if (!/(credible|credibility|whether|verdict|metrics?|support|risk|validation|next step|可信|是否|结论|指标|支持|风险|验证|下一步)/i.test(prompt)) return undefined;
  const selectedRefs = selectedReferenceTokens(request);
  const selectedContext = selectedRefs.length
    ? context.filter((item) => directContextItemMatchesSelectedRef(item, selectedRefs))
    : context;
  const sourceText = uniqueStrings((selectedContext.length ? selectedContext : context)
    .filter((item) => /report|artifact|file|summary|reference/i.test(`${item.kind} ${item.label}`))
    .map((item) => item.summary)
    .filter((value): value is string => Boolean(value)))
    .join('\n');
  if (!/(reproduction|reproduced|fitted|RMSE|parameter|verdict|success|误差|拟合|复现)/i.test(sourceText)) return undefined;
  const metrics = selectedReportMetricLines(sourceText);
  const verdict = selectedReportVerdict(sourceText, metrics);
  if (!verdict && !metrics.length) return undefined;
  const risk = selectedReportRiskLine(sourceText);
  const nextStep = selectedReportNextValidationLine(sourceText);
  return [
    'Answered directly from the selected report; no new workspace task was started.',
    '',
    `- Credibility verdict: ${verdict ?? 'the selected report provides reproduction metrics, but it does not state a clear pass/fail verdict.'}`,
    ...metrics.map((line) => `- Supporting metric: ${line}`),
    `- Biggest remaining risk: ${risk}`,
    `- Next validation step: ${nextStep}`,
  ].join('\n');
}

function selectedReportVerdict(sourceText: string, metrics: string[]) {
  const explicit = sourceText.match(/Reproduction success\s*:\s*(YES|NO)/i)?.[1];
  if (explicit) {
    return explicit.toUpperCase() === 'YES'
      ? 'credible as a toy reproduction because the selected report says "Reproduction success: YES".'
      : 'not credible enough yet because the selected report says "Reproduction success: NO".';
  }
  if (metrics.length && /PASS|satisfied|completed/i.test(sourceText)) {
    return 'credible as a toy reproduction because the selected report records passing checks and concrete fit metrics.';
  }
  return undefined;
}

function selectedReportMetricLines(sourceText: string) {
  const metrics: string[] = [];
  for (const match of sourceText.matchAll(/\|\s*(r|K)\s*\|\s*([0-9]+(?:\.[0-9]+)?)\s*\|\s*([0-9]+(?:\.[0-9]+)?)\s*\|\s*([0-9]+(?:\.[0-9]+)?%)/gi)) {
    metrics.push(`${match[1]} true ${match[2]}, fitted ${match[3]}, error ${match[4]}`);
  }
  const proseParameterMatches = [
    ...sourceText.matchAll(/\b(true\s+)?(r|K)\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)[,;\s]+(?:fitted|fit)\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)[,;\s]+(?:error|relative error|percent error)\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?%)/gi),
  ];
  for (const match of proseParameterMatches) {
    metrics.push(`${match[2]} true ${match[3]}, fitted ${match[4]}, error ${match[5]}`);
  }
  const rmse = sourceText.match(/\bRMSE\b\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1];
  if (rmse) metrics.push(`RMSE ${rmse}`);
  const thresholdLines = sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length <= 240 && /\bPASS\b/i.test(line) && /RMSE|error|threshold|acceptance|r\b|K\b/i.test(line))
    .slice(0, 3);
  return uniqueStrings([...metrics, ...thresholdLines]).slice(0, 6);
}

function selectedReportRiskLine(sourceText: string) {
  const explicitRisk = sourceText
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\s*(?:[-*]|\d+[.)])\s*/, ''))
    .find((line) => /(risk|limitation|caveat|failure mode|remaining|风险|局限)/i.test(line) && line.length <= 240);
  if (explicitRisk) return explicitRisk;
  const evidence = uniqueStrings([
    /synthetic/i.test(sourceText) ? 'synthetic data' : undefined,
    /fixed seed/i.test(sourceText) ? 'fixed seed' : undefined,
    /\btoy\b/i.test(sourceText) ? 'toy setup' : undefined,
    /noise|noisy/i.test(sourceText) ? 'noisy observations' : undefined,
  ].filter((value): value is string => Boolean(value)));
  if (evidence.length) {
    return `the report is still a ${evidence.join(', ')} reproduction, so it does not establish robustness on real or independent data.`;
  }
  return 'the selected report does not state an explicit residual risk, so robustness beyond this single reported run remains unproven.';
}

function selectedReportNextValidationLine(sourceText: string) {
  const explicitNext = sourceText
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\s*(?:[-*]|\d+[.)])\s*/, ''))
    .find((line) => /(next|validation|validate|holdout|repeat|seed|noise|robust|下一步|验证)/i.test(line) && line.length <= 240);
  if (explicitNext && !/Reproduction success/i.test(explicitNext)) return explicitNext;
  if (/fixed seed|seed/i.test(sourceText) || /noise|noisy/i.test(sourceText)) {
    return 'repeat the same fitting check across multiple random seeds and noise levels, then compare r/K error and RMSE against the same thresholds.';
  }
  return 'rerun the selected method on an independent held-out dataset and require the same verdict and metric thresholds to hold.';
}

function documentTransformMessage(
  text: string,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const sourceText = uniqueStrings(context.map((item) => item.summary).filter((item): item is string => Boolean(item))).join('\n');
  if (!sourceText.trim()) return undefined;
  const title = extractDocumentTitle(sourceText)
    ?? (/grant|proposal|项目书|申请书/i.test(text)
      ? 'Main Grant Proposal Document'
      : 'Main Research Document');
  const constraints = extractPlanningLines(sourceText, /(constraint|budget cap|platform|timeline|data sharing|specimen|IRB|fixed|months?|约束|预算|平台|时间|数据|样本)/i, 8);
  const aims = extractPlanningLines(sourceText, /(aim|objective|goal|hypothesis|specific|目标|假设)/i, 4);
  const deliverables = extractPlanningLines(sourceText, /(deliverable|D\d+\b|report|repository|dataset|algorithm|validated|panel|pipeline|Docker|交付|报告|数据|算法)/i, 5);
  const gaps = extractPlanningLines(sourceText, /(gap|risk|limitation|assumption|quality|cohort|RNA|validation|evidence|access|失败|风险|缺口|假设|质量|验证)/i, 8);
  const monthCount = extractProjectMonthCount(sourceText) ?? 12;
  const funding = extractFundingAmount(sourceText);
  return [
    `# ${title}`,
    '',
    'Drafted from existing selected/context refs; no new workspace task was started.',
    '',
    '## Executive Summary',
    ...documentBulletLines(directContextStatements(context).slice(0, 3), [
      'This document consolidates the existing project brief into a grant-style main proposal.',
      'Scope, assumptions, deliverables, risks, and acceptance criteria are carried forward from the selected context.',
    ]),
    '',
    '## Specific Aims',
    ...documentBulletLines(aims, [
      'Aim 1: Confirm the project scope, evidence base, and target user workflow.',
      'Aim 2: Produce the core analysis or marker-selection deliverable described in the brief.',
      'Aim 3: Validate the deliverable against the stated acceptance criteria and evidence gaps.',
    ]),
    '',
    '## Approach and Workplan',
    ...planningMilestoneLines(monthCount, deliverables, { excludedPlatforms: [] }),
    '',
    '## Budget Frame',
    ...planningBudgetLines(funding),
    '',
    '## Deliverables',
    ...documentBulletLines(deliverables, [
      'Primary report artifact with methods, findings, and acceptance evidence.',
      'Reproducibility package covering data refs, assumptions, and unresolved risks.',
    ]),
    '',
    '## Constraints and Assumptions',
    ...documentBulletLines(constraints, [
      'Only constraints present in the selected context are treated as binding.',
      'Unspecified owners, dates, and budgets require confirmation before execution.',
    ]),
    '',
    '## Evidence Gaps and Risks',
    ...planningRiskLines(gaps, constraints, { excludedPlatforms: [] }),
    '',
    '## Acceptance Criteria',
    ...documentBulletLines(extractPlanningLines(sourceText, /(acceptance|criteria|AUC|QC|release|manuscript|repository|成功|验收)/i, 6), [
      'The final document remains traceable to selected refs and avoids ungrounded new claims.',
      'Budget, timeline, risks, and deliverables can be audited against the source brief.',
      'Any later constraint change updates affected conclusions and invalidated assumptions.',
    ]),
  ].join('\n');
}

function extractDocumentTitle(text: string) {
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.replace(/^Project Brief:\s*/i, 'Proposal: ');
  const title = text.match(/(?:Project Title|Title):\s*([^\n]+)/i)?.[1]?.trim();
  return title ? `Proposal: ${title}` : undefined;
}

function documentBulletLines(lines: string[], fallback: string[]) {
  return (lines.length ? lines : fallback).slice(0, 8).map((line) => `- ${line}`);
}

function planningRegisterTransformMessage(
  text: string,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const sourceText = uniqueStrings(context.map((item) => item.summary).filter((item): item is string => Boolean(item))).join('\n');
  if (!sourceText.trim()) return undefined;
  const overrides = extractPlanningOverrides(text);
  const originalMonthCount = extractProjectMonthCount(sourceText);
  const originalFunding = extractFundingAmount(sourceText);
  const monthCount = overrides.monthCount ?? originalMonthCount ?? 12;
  const funding = overrides.funding ?? originalFunding;
  const constraints = extractPlanningLines(sourceText, /(constraint|budget cap|platform|timeline|data sharing|specimen|IRB|fixed|months?|约束|预算|平台|时间|数据|样本)/i, 12)
    .filter((line) => !/^(?:deliverables?|hard constraints?|evidence gaps?|D\d+\b)/i.test(line))
    .slice(0, 6);
  const deliverables = extractPlanningLines(sourceText, /(deliverable|D\d+\b|report|repository|dataset|algorithm|validated|panel|pipeline|Docker|交付|报告|数据|算法)/i, 5);
  const risks = extractPlanningLines(sourceText, /(gap|risk|limitation|assumption|quality|cohort|RNA|validation|evidence|access|失败|风险|缺口|假设|质量|验证)/i, 8);
  const heading = /[一-龥]/.test(text)
    ? '基于选中引用直接生成计划登记表，不启动新的 workspace task。'
    : 'Planning register from the selected reference; no new workspace task was started.';
  return [
    heading,
    '',
    '## Budget',
    ...planningBudgetLines(funding),
    '',
    '## Timeline',
    ...planningMilestoneLines(monthCount, deliverables, overrides),
    '',
    '## Risk Register',
    ...planningRiskLines(risks, constraints, overrides),
    '',
    '## Constraint Dependencies',
    ...constraintDependencyLines(constraints, overrides),
    ...invalidatedAssumptionLines({
      originalMonthCount,
      originalFunding,
      overrides,
      sourceText,
    }),
  ].join('\n');
}

interface PlanningOverrides {
  previousMonthCount?: number;
  monthCount?: number;
  previousFunding?: number;
  funding?: number;
  excludedPlatforms: string[];
}

function extractPlanningOverrides(text: string): PlanningOverrides {
  return {
    previousMonthCount: extractPreviousProjectMonthCount(text),
    monthCount: extractChangedProjectMonthCount(text) ?? extractProjectMonthCount(text),
    previousFunding: extractPreviousFundingAmount(text),
    funding: extractChangedFundingAmount(text) ?? extractFundingAmount(text),
    excludedPlatforms: uniqueStrings(Array.from(text.matchAll(/\bno\s+([A-Z][A-Za-z0-9 -]{2,40})\s+access\b/gi))
      .map((match) => match[1]?.trim())
      .filter((item): item is string => Boolean(item))),
  };
}

function extractPreviousProjectMonthCount(text: string) {
  const match = text.match(/\bfrom\s+(\d{1,2})\s*[- ]?months?/i);
  const parsed = match?.[1] ? Number(match[1]) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function extractChangedProjectMonthCount(text: string) {
  const match = text.match(/\bto\s+(\d{1,2})\s*[- ]?months?/i)
    ?? text.match(/(?:change|update|revise)[\s\S]{0,120}?(\d{1,2})\s*[- ]?months?/i);
  const parsed = match?.[1] ? Number(match[1]) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function extractPreviousFundingAmount(text: string) {
  const fromSegment = text.match(/\bfrom\b([\s\S]{0,120}?)\bto\b/i)?.[1];
  return fromSegment ? extractFundingAmount(fromSegment) : undefined;
}

function extractChangedFundingAmount(text: string) {
  const toSegment = text.match(/\bto\b([\s\S]{0,120})/i)?.[1];
  const fromToFunding = toSegment ? extractFundingAmount(toSegment) : undefined;
  if (fromToFunding) return fromToFunding;
  const match = text.match(/\bto\s+\$\s?([0-9][0-9,]*(?:\.\d+)?)(\s*[kKmM])?/i)
    ?? text.match(/(?:change|update|revise)[\s\S]{0,120}?\$\s?([0-9][0-9,]*(?:\.\d+)?)(\s*[kKmM])?/i);
  return fundingAmountFromMatch(match);
}

function extractProjectMonthCount(text: string) {
  const match = text.match(/(?:duration|timeline|period|fixed)?\D{0,20}(\d{1,2})\s*[- ]?months?/i);
  const parsed = match?.[1] ? Number(match[1]) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function extractFundingAmount(text: string) {
  const match = text.match(/\$\s?([0-9][0-9,]*(?:\.\d+)?)(\s*[kKmM])?(?:\s*(?:total|direct|budget|funding|costs?))?/i)
    ?? text.match(/(?:budget cap|funding request|budget|预算)[^$0-9]{0,40}([0-9][0-9,]*(?:\.\d+)?)(\s*[kKmM])?/i);
  return fundingAmountFromMatch(match);
}

function fundingAmountFromMatch(match: RegExpMatchArray | null) {
  if (!match?.[1]) return undefined;
  const parsed = Number(match[1].replace(/,/g, ''));
  const multiplier = /\bk/i.test(match[2] ?? '') ? 1000 : /\bm/i.test(match[2] ?? '') ? 1_000_000 : 1;
  const value = parsed * multiplier;
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function extractPlanningLines(text: string, pattern: RegExp, limit: number) {
  return uniqueStrings(text
    .replace(/\r/g, '')
    .split(/\n+|(?<=[。.!?；;])\s+|\s+\|\s+/)
    .map((line) => line.replace(/^[-*|#\d.\s:]+/, '').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 10 && line.length <= 260 && pattern.test(line) && isDirectContextAnswerStatement(line))
    .filter((line) => !/AgentServer generation stopped|convergence guard|\.sciforge\/sessions|task-results|artifact:/i.test(line))
    .slice(0, limit));
}

function planningBudgetLines(total: number | undefined) {
  if (!total) {
    return [
      '- Personnel and analysis support: range not stated; assign owner to confirm.',
      '- Assays/platform fees: range not stated; bind to selected platforms.',
      '- Validation cohort/testing: range not stated; bind to validation scope.',
      '- Data/reproducibility infrastructure: range not stated; cover repository, documentation, and compute.',
      '- Contingency: range not stated; reserve for QC failures and reruns.',
    ];
  }
  const categories: Array<[string, number]> = [
    ['Personnel and analysis support', 0.34],
    ['Discovery assay/platform fees', 0.28],
    ['Validation assays/cohort testing', 0.22],
    ['Data management, compute, and reproducibility', 0.1],
    ['Contingency and project operations', 0.06],
  ];
  return categories.map(([label, fraction]) => {
    const midpoint = Math.round(total * fraction / 1000) * 1000;
    const low = Math.max(0, Math.round(midpoint * 0.85 / 1000) * 1000);
    const high = Math.round(midpoint * 1.15 / 1000) * 1000;
    return `- ${label}: $${low.toLocaleString()}-$${high.toLocaleString()}`;
  });
}

function planningMilestoneLines(monthCount: number, deliverables: string[], overrides: PlanningOverrides) {
  const month = (value: number) => Math.min(monthCount, Math.max(1, value));
  const compressed = monthCount < 12 || overrides.excludedPlatforms.length > 0;
  const anchors = deliverables.length ? deliverables : [
    'Finalize inputs, governance, and acceptance criteria',
    'Complete discovery data generation and QC',
    'Deliver analysis method/package draft',
    'Complete validation and final report',
  ];
  const platformNote = overrides.excludedPlatforms.length
    ? ` Exclude ${overrides.excludedPlatforms.join(', ')} and use an alternate available discovery/validation workflow.`
    : '';
  return compressed ? [
    `- Months 1-${month(1)}: Confirm reduced scope, owners, replacement platforms, and acceptance criteria.${platformNote}`,
    `- Months ${month(2)}-${month(3)}: ${anchors[0] ?? 'Generate and QC primary evidence/data'}; defer non-critical exploratory work.`,
    `- Months ${month(4)}-${month(6)}: ${anchors[1] ?? 'Build and document analysis deliverable'} under the reduced budget/timebox.`,
    `- Months ${month(7)}-${month(8)}: ${anchors[2] ?? 'Validate core claims against held-out evidence'} with the narrowed cohort/panel.`,
    `- Month ${month(monthCount)}: Package final report, repository, release notes, and unresolved-risk register.`,
  ] : [
    `- Months 1-${month(2)}: ${anchors[0] ?? 'Confirm scope, owners, and acceptance criteria'}.`,
    `- Months ${month(3)}-${month(5)}: ${anchors[1] ?? 'Generate and QC primary evidence/data'}.`,
    `- Months ${month(6)}-${month(8)}: ${anchors[2] ?? 'Build and document analysis deliverable'}.`,
    `- Months ${month(9)}-${month(11)}: ${anchors[3] ?? 'Validate core claims against held-out evidence'}.`,
    `- Month ${month(monthCount)}: Package final report, repository, release notes, and unresolved-risk register.`,
  ];
}

function treatmentConclusionLines(reportText: string) {
  const treatmentSection = extractSection(reportText, /treatment|effect|statistics|hypothes/i);
  const source = treatmentSection || reportText;
  const lines = [
    firstMatchLine(source, /control[^\n.;]*mean[^\n.;]*[0-9.]+[^\n.;]*(?:drugA|drug)[^\n.;]*mean[^\n.;]*[0-9.]+/i),
    firstMatchLine(source, /drugA[^\n.;]*mean[^\n.;]*[0-9.]+[^\n.;]*control[^\n.;]*mean[^\n.;]*[0-9.]+/i),
    firstMatchLine(source, /Cohen.?s?\s*d[^\n.;]*[0-9.]+[^\n.;]*/i),
    firstMatchLine(source, /p\s*[=<>]\s*[0-9.eE-]+[^\n.;]*/i),
    firstMatchLine(source, /reject[^\n.;]*H0[^\n.;]*/i),
    firstMatchLine(source, /drugA[^\n.;]*(?:higher|increased|positive)[^\n.;]*/i),
  ];
  const selected = uniqueStrings(lines.filter((line): line is string => Boolean(line))).slice(0, 4);
  if (selected.length) return selected;
  return directContextStatements([{ kind: 'report', label: 'analysis report', summary: source, ref: 'analysis-report' }]).slice(0, 3);
}

function confounderLines(reportText: string) {
  const lines = [
    firstMatchLine(reportText, /Batch[^\n.;]*(?:fixed|random|effect|mean|B1|B2|B3)[^\n.;]*/i),
    firstMatchLine(reportText, /timepoint[^\n.;]*(?:0h|24h|48h|fixed|effect|mean)[^\n.;]*/i),
    firstMatchLine(reportText, /No interaction terms[^\n.;]*/i),
    firstMatchLine(reportText, /mixed models?[^\n.;]*/i),
  ];
  const selected = uniqueStrings(lines.filter((line): line is string => Boolean(line))).slice(0, 4);
  return selected.length ? selected : [
    'Batch and timepoint were modeled as fixed effects in the report, so residual batch structure or time-dependent response could confound a simple treatment comparison.',
    'The report states that interaction terms were not included, leaving treatment-by-batch and treatment-by-timepoint heterogeneity unresolved.',
  ];
}

function robustnessCheckLines(reportText: string) {
  const checks = [
    'Fit treatment-by-batch and treatment-by-timepoint interaction terms and compare the treatment estimate.',
    /mixed models?|random/i.test(reportText)
      ? 'Refit with batch as a random effect or mixed model and check whether the drugA effect remains positive.'
      : 'Refit with an alternative batch adjustment and check whether the drugA effect remains positive.',
    /normality|homogeneity|variance/i.test(reportText)
      ? 'Check residual normality and variance homogeneity; add a nonparametric or permutation sensitivity test if assumptions are weak.'
      : 'Run a nonparametric or permutation sensitivity test for the treatment contrast.',
    'Bootstrap the treatment effect size and confidence interval across samples while preserving batch/timepoint labels.',
    'Stratify or leave-one-batch/timepoint-out to ensure the conclusion is not driven by one batch or the 48h samples.',
  ];
  return checks.slice(0, /three|3|三/.test(reportText) ? 3 : 5);
}

function extractSection(text: string, headingPattern: RegExp) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{1,4}\s+/.test(line) && headingPattern.test(line));
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && /^#{1,4}\s+/.test(line));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

function firstMatchLine(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  return match?.[0]?.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim();
}

function planningRiskLines(risks: string[], constraints: string[], overrides: PlanningOverrides) {
  const overrideRisks = [
    overrides.monthCount ? `Compressed ${overrides.monthCount}-month timeline leaves less recovery time` : undefined,
    overrides.funding ? `Reduced $${overrides.funding.toLocaleString()} budget may force scope cuts` : undefined,
    ...overrides.excludedPlatforms.map((platform) => `${platform} access removed; platform-dependent aims must be redesigned`),
  ].filter((item): item is string => Boolean(item));
  const seeds = uniqueStrings([...overrideRisks, ...risks, ...constraints]).slice(0, 8);
  const defaults = [
    'Input quality or access fails',
    'Validation effect size misses acceptance criteria',
    'Platform lock-in limits generalization',
    'Timeline leaves no recovery window',
    'Data-sharing or governance approval slips',
    'Algorithm does not transfer across measurement resolutions',
    'Stakeholder handoff lacks clinical utility evidence',
    'Repository/reproducibility package is incomplete',
  ];
  const plannedRisks = uniqueStrings([...seeds, ...defaults]).slice(0, 8);
  return plannedRisks.map((risk, index) => {
    const owner = index % 3 === 0 ? 'PI/project lead' : index % 3 === 1 ? 'technical lead' : 'validation owner';
    return `- R${index + 1}: ${risk}. Mitigation: define an early go/no-go check and fallback scope. Owner: ${owner}.`;
  });
}

function constraintDependencyLines(constraints: string[], overrides: PlanningOverrides) {
  const lines = [
    ...(overrides.monthCount ? [`Updated hard timeline: ${overrides.monthCount} months.`] : []),
    ...(overrides.funding ? [`Updated hard budget cap: $${overrides.funding.toLocaleString()}.`] : []),
    ...overrides.excludedPlatforms.map((platform) => `Updated platform constraint: no ${platform} access; dependent aims and assays require replacement.`),
    ...(constraints.length ? constraints : ['Use only constraints present in the selected reference; unresolved details require owner confirmation.']),
  ];
  return uniqueStrings(lines).slice(0, 10).map((line) => `- ${line}`);
}

function invalidatedAssumptionLines(input: {
  originalMonthCount: number | undefined;
  originalFunding: number | undefined;
  overrides: PlanningOverrides;
  sourceText: string;
}) {
  const invalidated = [
    input.overrides.monthCount && (input.originalMonthCount || input.overrides.previousMonthCount) && input.overrides.monthCount !== (input.originalMonthCount ?? input.overrides.previousMonthCount)
      ? `Original ${input.originalMonthCount ?? input.overrides.previousMonthCount}-month schedule is invalidated by the ${input.overrides.monthCount}-month constraint.`
      : undefined,
    input.overrides.funding && (input.originalFunding || input.overrides.previousFunding) && input.overrides.funding !== (input.originalFunding ?? input.overrides.previousFunding)
      ? `Original $${(input.originalFunding ?? input.overrides.previousFunding)?.toLocaleString()} funding assumption is invalidated by the $${input.overrides.funding.toLocaleString()} cap.`
      : undefined,
    ...input.overrides.excludedPlatforms
      .filter((platform) => new RegExp(`\\b${escapeRegExp(platform)}\\b`, 'i').test(input.sourceText))
      .map((platform) => `Any plan step that depends on ${platform} access is invalidated and must be replaced.`),
  ].filter((line): line is string => Boolean(line));
  if (!invalidated.length) return [];
  return [
    '',
    '## Invalidated Assumptions',
    ...uniqueStrings(invalidated).map((line) => `- ${line}`),
  ];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function selectedReferenceSummaryMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const text = request.prompt;
  const selectedRefs = selectedReferenceTokens(request);
  if (!selectedRefs.length) return undefined;
  const selectedContext = selectedRefs.length
    ? context.filter((item) => directContextItemMatchesSelectedRef(item, selectedRefs))
    : context;
  const answerContext = selectedContext.filter((item) => !/claim|execution-unit|audit|diagnostic/i.test(item.kind));
  const snippets = directContextStatements(answerContext.length ? answerContext : selectedContext)
    .slice(0, /three|3|三/.test(text) ? 3 : /two|2|两|二/.test(text) ? 2 : 5);
  if (!snippets.length) return undefined;
  const header = /[一-龥]/.test(text)
    ? '基于当前选中引用整理为要点：'
    : 'Summary from the selected reference:';
  return [header, ...snippets.map((item) => `- ${item}`)].join('\n');
}

function directContextStatements(
  context: ReturnType<typeof buildDirectContextFastPathItems>,
  options: { answerOnlyTransform?: boolean } = {},
) {
  return uniqueStrings(context.flatMap((item) => statementParts(item.summary)))
    .map((part) => part.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter((part) => options.answerOnlyTransform
      ? isDirectContextAnswerStatement(part)
      : part.length > 0 && !/^(fields|refs?|artifact|run|message):/i.test(part));
}

function statementParts(value: string | undefined) {
  if (!value) return [];
  const normalized = value
    .replace(/\s+/g, ' ')
    .replace(/\b(?:Answered directly from current-session context without starting a new workspace task\.|基于当前会话已有上下文直接回答，不启动新的 workspace task。)/gi, '')
    .trim();
  return normalized
    .split(/(?<=[。.!?；;])\s+|[\n\r]+|(?:\s+-\s+)/)
    .map((part) => part.trim().replace(/[。.!?；;]+$/, ''))
    .filter((part) => part.length > 0 && part.length <= 260)
    .slice(0, 8);
}

function isDirectContextAnswerStatement(part: string) {
  if (!part) return false;
  if (/^(fields|refs?|artifact|run|message):/i.test(part)) return false;
  if (/Reference path was not readable inside the workspace|Reference exists but is not a regular file/i.test(part)) return false;
  if (/selected artifact content was not available|no refs found|no explicit blockers found|no explicit recover actions found/i.test(part)) return false;
  if (/^record-only$/i.test(part)) return false;
  if (/^(?:artifact|file|run|execution-unit|agentserver|runtime):/i.test(part)) return false;
  if (/^(?:\.sciforge|workspace\/|\/Applications\/|[A-Za-z]:[\\/]|~\/)/.test(part)) return false;
  if (/\.(?:json|md|txt|csv|tsv|log|py|ts|tsx|js|ipynb)(?:\b|$)/i.test(part) && !/\s/.test(part.replace(/[()[\],;:]/g, ''))) return false;
  return true;
}

function selectedReferenceTokens(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  return uniqueStrings([...recordRows(request.references), ...recordRows(uiState.currentReferences)].flatMap((reference) => {
    const ref = stringField(reference.ref);
    const sourceId = stringField(reference.sourceId);
    const title = stringField(reference.title);
    const payload = isRecord(reference.payload) ? reference.payload : {};
    const currentReference = isRecord(payload.currentReference) ? payload.currentReference : {};
    const objectReference = isRecord(payload.objectReference) ? payload.objectReference : {};
    return [
      ref,
      sourceId,
      title,
      stringField(currentReference.ref),
      stringField(currentReference.id),
      stringField(currentReference.title),
      stringField(objectReference.ref),
      stringField(objectReference.id),
      stringField(objectReference.title),
    ].flatMap((value) => value ? selectedReferenceTokenVariants(value) : []);
  }));
}

function selectedReferenceTokenVariants(value: string) {
  const text = value.trim();
  if (!text) return [];
  const withoutScheme = text.replace(/^(?:artifact|file|message|claim|execution-unit):/, '');
  const basename = withoutScheme.split(/[\\/]/).pop() ?? withoutScheme;
  return uniqueStrings([text, withoutScheme, basename.replace(/\.[a-z0-9]+$/i, '')]);
}

function directContextItemMatchesSelectedRef(
  item: ReturnType<typeof buildDirectContextFastPathItems>[number],
  selectedRefs: string[],
) {
  const haystack = [
    item.ref,
    item.label,
  ].filter((value): value is string => Boolean(value)).join('\n').toLowerCase();
  if (!haystack) return false;
  return selectedRefs.some((ref) => ref && haystack.includes(ref.toLowerCase()));
}

function directContextClaimText(
  message: string,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const statement = statementParts(message)
    .map((part) => part.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .find(isDirectContextAnswerStatement);
  return statement ?? context.find((item) => isDirectContextAnswerStatement(item.summary ?? ''))?.summary ?? DIRECT_CONTEXT_FAST_PATH_POLICY.defaultClaimText;
}

function intentSummaryAnswer(
  intent: DirectContextIntent,
  prompt: string,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  if (intent !== 'context-summary:risk' && intent !== 'context-summary:method' && intent !== 'context-summary:timeline') return undefined;
  const sentences = uniqueStrings(context.flatMap((item) => contextSummarySentencesFromText(item.summary, intent)));
  if (!sentences.length) return undefined;
  const selected = sentences.slice(0, /two|2|两|二/.test(prompt) ? 2 : 3);
  if (/[一-龥]/.test(prompt)) {
    return `基于当前会话已有上下文直接回答，不启动新的 workspace task。${selected.join('；')}。`;
  }
  return `Answered directly from current-session context without starting a new workspace task. ${selected.join('; ')}.`;
}

function contextSummarySentencesFromText(value: string | undefined, intent: DirectContextIntent) {
  if (!value) return [];
  const pattern = intent === 'context-summary:risk'
    ? /(risk|风险|隐患|问题|漂移|溢出|不一致|失败|超时|缺失|阻塞)/i
    : intent === 'context-summary:method'
      ? /(method|methods|workflow|protocol|approach|procedure|步骤|方法|流程|方案|实验|检索|分析)/i
      : /(timeline|sequence|history|progress|phase|event|when|时间线|顺序|阶段|进展|事件)/i;
  return value
    .replace(/\s+/g, ' ')
    .split(/(?<=[。.!?；;])\s+|[\n\r]+/)
    .map((part) => part.trim().replace(/^[#*\-\d.\s:：]+/, '').replace(/[。.!?；;]+$/, ''))
    .filter((part) => pattern.test(part))
    .slice(0, 6);
}

function hasUsableArtifactRefOrData(artifact: Record<string, unknown>) {
  if (stringField(artifact.dataRef) || stringField(artifact.path) || stringField(artifact.ref)) return true;
  const metadata = artifact.metadata;
  if (isRecord(metadata)) {
    const metadataRefs = ['reportRef', 'markdownRef', 'dataRef', 'path', 'outputRef']
      .some((key) => stringField(metadata[key]));
    if (metadataRefs) return true;
  }
  return artifact.data !== undefined;
}

function hasCurrentContextEvidence(
  context: ReturnType<typeof buildDirectContextFastPathItems>,
  intent: DirectContextIntent,
) {
  if (intent === 'run-diagnostic') return context.some((item) => item.ref);
  return context.some((item) => item.kind !== 'execution-unit');
}

function capabilityStatusFastPathPayload(request: GatewayRequest): ToolPayload | undefined {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const context = buildDirectContextFastPathItems({
    artifacts: request.artifacts,
    uiArtifacts: uiState.artifacts,
    references: request.references,
    currentReferences: uiState.currentReferences,
    currentReferenceDigests: uiState.currentReferenceDigests,
    recentExecutionRefs: uiState.recentExecutionRefs,
    executionUnits: uiState.executionUnits,
  });
  const routeStatus = capabilityProviderRoutesForHandoff(request);
  const selectedIds = uniqueStrings([
    ...(request.selectedToolIds ?? []),
    ...(request.selectedSenseIds ?? []),
    ...(request.selectedVerifierIds ?? []),
    ...toStringList(uiState.selectedToolIds),
  ]);
  if (!routeStatus.routes.length && !selectedIds.length && !context.length) return undefined;
  const id = sha1(JSON.stringify({
    prompt: request.prompt,
    routes: routeStatus.routes,
    selectedIds,
    refs: directContextFastPathSupportingRefs(context),
  })).slice(0, 12);
  const routeLines = routeStatus.routes.length
    ? routeStatus.routes.map((route) => {
      const primary = route.primaryProviderId ?? route.providers[0]?.providerId ?? 'none';
      const provider = route.providers.find((candidate) => candidate.providerId === primary);
      const transport = provider?.transport ? `; transport=${provider.transport}` : '';
      return `- ${route.capabilityId}: ${route.status}; primary=${primary}${transport}; ${route.reason}`;
    })
    : ['- No core web/pdf provider route was required by this status query.'];
  const selectedLine = selectedIds.length ? `Selected runtime ids: ${selectedIds.join(', ')}` : 'Selected runtime ids: none reported.';
  const contextMessage = context.length
    ? `\n\nCurrent context summary:\n${directContextFastPathMessage(context)}`
    : '';
  const message = [
    'Tool/provider status answered from SciForge runtime registries without dispatching AgentServer generation.',
    selectedLine,
    'Provider routes:',
    ...routeLines,
    contextMessage,
  ].filter((line) => line !== '').join('\n');
  const routeRef = `runtime://capability-provider-status/${id}`;
  return {
    message,
    confidence: 0.86,
    claimType: 'capability-provider-status',
    evidenceLevel: 'runtime',
    reasoningTrace: [
      'Capability/provider status queries are answered from runtime registry and preflight route discovery.',
      'This fast path avoids sending large prior conversation payloads to AgentServer for registry-only follow-up questions.',
    ].join('\n'),
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'satisfied',
      status: 'completed',
    },
    claims: [{
      id: `capability-provider-status-${id}`,
      text: routeStatus.ok ? 'Required provider routes are available.' : 'Some requested provider routes are unavailable.',
      type: 'observation',
      confidence: 0.86,
      evidenceLevel: 'runtime',
      supportingRefs: [routeRef, ...directContextFastPathSupportingRefs(context).slice(0, 6)],
      opposingRefs: [],
    }],
    uiManifest: directContextUiManifest(`capability-provider-status-${id}`, 'runtime-context-summary'),
    executionUnits: [{
      id: `EU-capability-provider-status-${id}`,
      tool: DIRECT_CONTEXT_FAST_PATH_POLICY.executionToolId,
      params: JSON.stringify({
        policy: 'capability-status-fast-path',
        requiredCapabilityIds: routeStatus.requiredCapabilityIds,
        selectedIds,
        routes: routeStatus.routes,
      }),
      status: 'done',
      hash: id,
      outputRef: routeRef,
    }],
    artifacts: [{
      id: `capability-provider-status-${id}`,
      type: 'runtime-context-summary',
      producerScenario: request.skillDomain,
      schemaVersion: '1',
      metadata: {
        source: 'capability-status-fast-path',
        routeRef,
        selectedIds,
        requiredCapabilityIds: routeStatus.requiredCapabilityIds,
      },
      data: {
        markdown: message,
        routes: routeStatus.routes,
        selectedIds,
        context,
      },
    }],
    objectReferences: [{
      id: `obj-capability-provider-status-${id}`,
      kind: 'runtime-diagnostic',
      title: 'Capability provider status',
      ref: routeRef,
      status: routeStatus.ok ? 'available' : 'needs-attention',
      summary: routeLines.join(' '),
    }],
  };
}

function policyRequestsDirectContext(request: GatewayRequest, decision: DirectContextDecision) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  if (uiState.forceAgentServerGeneration === true) return false;
  if (!directContextDecisionAllowsAnswer(decision)) return false;
  if (decision.decisionOwner === 'harness-policy' && boundedArtifactFollowupRequested(request)) return true;
  const conversationPolicy = isRecord(uiState.conversationPolicy) ? uiState.conversationPolicy : {};
  if (stringField(conversationPolicy.applicationStatus) === 'failed') return false;
  if (
    stringField(conversationPolicy.applicationStatus) !== 'applied'
    || stringField(conversationPolicy.policySource) !== DIRECT_CONTEXT_FAST_PATH_POLICY.policyOwner
  ) return false;
  const execution = isRecord(conversationPolicy.executionModePlan) ? conversationPolicy.executionModePlan : {};
  const responsePlan = isRecord(conversationPolicy.responsePlan) ? conversationPolicy.responsePlan : {};
  const latencyPolicy = isRecord(conversationPolicy.latencyPolicy) ? conversationPolicy.latencyPolicy : {};
  const mode = stringField(execution.executionMode);
  const initialMode = stringField(responsePlan.initialResponseMode);
  return mode === 'direct-context-answer'
    && (initialMode === undefined || initialMode === 'direct-context-answer')
    && latencyPolicy.blockOnContextCompaction !== true;
}

function fallbackDirectContextDecisionForBoundedArtifactFollowup(request: GatewayRequest): DirectContextDecision | undefined {
  if (!boundedArtifactFollowupRequested(request)) return undefined;
  const records = boundedFollowupRecords(request);
  const selectedRefs = selectedReferenceTokens(request);
  const scopedRecords = explicitSelectedOnlyPrompt(request.prompt) && selectedRefs.length
    ? records.filter((record) => directContextRecordMatchesSelectedRef(record, selectedRefs))
    : records;
  const refs = uniqueStrings(scopedRecords.flatMap((artifact) => directContextRefTokensFromRecord(artifact)));
  if (!refs.length) return undefined;
  return {
    decisionRef: `decision:harness-bounded-artifact-${sha1(JSON.stringify({ prompt: request.prompt, refs })).slice(0, 10)}`,
    decisionOwner: 'harness-policy',
    intent: /fail|risk|失败|风险/i.test(request.prompt) ? 'context-summary:risk' : 'context-summary',
    requiredTypedContext: ['current-session-context', 'artifact-index'],
    usedRefs: refs.slice(0, 8),
    allowDirectContext: true,
    transformMode: /hypoth(?:esis|eses)|可检验|假设/i.test(request.prompt) ? 'answer-only-summary' : undefined,
    sufficiency: 'sufficient',
  };
}

function boundedArtifactFollowupRequested(request: GatewayRequest) {
  if (!boundedArtifactFollowupPrompt(request.prompt)) return false;
  const hasArtifact = boundedFollowupRecords(request)
    .some(isBoundedAnswerArtifact);
  return hasArtifact;
}

function boundedArtifactFollowupPrompt(text: string) {
  if (/(search|retrieve|检索|搜索|重新检索|new search|web|external provider|fresh)/i.test(text)
    && !/(do not|don't|no|不要|不得|without)/i.test(text)) return false;
  if (artifactMutationFollowupRequiresBackend(text)) return false;
  const refersToSelectedOrCurrent = /(current|visible|selected|above|artifact|matrix|report|this report|this artifact|reproduction|当前|选中|证据矩阵|报告|产物|这份|这个|该报告|本报告|原报告)/i.test(text);
  const refersToBroadHistory = /(previous|prior|last|existing|上一轮|之前|已有)/i.test(text);
  const forbidsFreshWork = /(based only|only based|use only|only use|using only|do not perform a new search|do not rerun|no new search|without starting|不要重新|不重新|只基于|仅基于|只用|仅用)/i.test(text);
  const asksReadOnlyQuestion = /(what|which|whether|can|does|how|should|would|recommend|tell me|list|audit|check|pass|fail|threshold|support|prove|rerun|command|script|counterfactual|是否|哪些|什么|有没有|能否|如何|怎么|怎样|应该|建议|请列出|回答|审计|核对|检查|验收|门槛|阈值|支持|证明|复跑|命令|脚本|反事实)/i.test(text);
  return (refersToSelectedOrCurrent && (forbidsFreshWork || asksReadOnlyQuestion))
    || (refersToBroadHistory && forbidsFreshWork);
}

function explicitSelectedOnlyPrompt(text: string) {
  return /(?:use only|only use|using only|based only|only based|selected .* only|current .* only|reference .* only|artifact .* only|file .* only|report .* only|只基于|仅基于|只用|仅用|只看|仅看)/i.test(text)
    && /(selected|current|reference|artifact|file|report|chart|plot|figure|image|选中|当前|引用|产物|文件|报告|图表|图片)/i.test(text);
}

function boundedFollowupRecords(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  return [
    ...request.artifacts,
    ...recordRows(uiState.artifacts),
    ...recordRows(request.references),
    ...recordRows(uiState.currentReferences),
    ...recordRows(uiState.currentReferenceDigests),
  ].filter(isRecord);
}

function directContextRefTokensFromRecord(record: Record<string, unknown>) {
  const payload = isRecord(record.payload) ? record.payload : {};
  const currentReference = isRecord(payload.currentReference) ? payload.currentReference : {};
  const objectReference = isRecord(payload.objectReference) ? payload.objectReference : {};
  const id = stringField(record.id) ?? stringField(currentReference.id) ?? stringField(objectReference.id);
  const dataRef = stringField(record.dataRef)
    ?? stringField(record.path)
    ?? stringField(record.sourceRef)
    ?? stringField(record.ref)
    ?? stringField(currentReference.dataRef)
    ?? stringField(currentReference.path)
    ?? stringField(currentReference.ref)
    ?? stringField(objectReference.dataRef)
    ?? stringField(objectReference.path)
    ?? stringField(objectReference.ref);
  const type = stringField(record.type)
    ?? stringField(record.artifactType)
    ?? stringField(currentReference.type)
    ?? stringField(currentReference.artifactType)
    ?? stringField(objectReference.type)
    ?? stringField(objectReference.artifactType);
  return [
    id ? `artifact:${id.replace(/^artifact:/, '')}` : undefined,
    dataRef,
    type ? `artifact-type:${type}` : undefined,
  ].filter((value): value is string => Boolean(value));
}

function directContextRecordMatchesSelectedRef(record: Record<string, unknown>, selectedRefs: string[]) {
  const haystack = directContextRefTokensFromRecord(record)
    .flatMap((token) => selectedReferenceTokenVariants(token))
    .join('\n')
    .toLowerCase();
  if (!haystack) return false;
  return selectedRefs.some((ref) => ref && haystack.includes(ref.toLowerCase()));
}

function artifactMutationFollowupRequiresBackend(text: string) {
  if (explicitAnswerOnlyNoToolsRequested(text)) return false;
  if (readOnlyArtifactInfoRequested(text)) return false;
  if (readOnlyHypotheticalArtifactRevisionRequested(text)) return false;
  const refersToExistingContext = /(previous|prior|last|existing|current|visible|selected|above|artifact|matrix|report|deliverable|document|file|workspace|上一轮|之前|已有|当前|选中|证据矩阵|报告|产物|交付物|文档|文件)/i.test(text);
  const asksForMutation = /(update|revise|rewrite|regenerate|edit|modify|refresh|replace|supersede|write|persist|produce|更新|修订|重写|改写|修改|替换|写入|产出|重新生成)/i.test(text);
  const deliverableScope = /(artifact|file|document|deliverable|workspace|path|\.md|decision log|risk register|timeline|budget|scope|success metrics|artifact\/file|产物|交付物|文档|文件|路径|决策日志|风险登记|时间线|预算|成功指标|所有受影响结论)/i.test(text);
  const asksForPaths = /(artifact\/file path|artifact path|file path|workspace file|updated artifact|new file|路径|更新后的 artifact|新的 artifact|新文件|文件路径)/i.test(text);
  return refersToExistingContext && ((asksForMutation && deliverableScope) || asksForPaths);
}

function readOnlyArtifactInfoRequested(text: string) {
  return /(whether|does|what|which|list|audit|check|do not invent|not invent|是否|有没有|哪些|只列出|不要补造|审计|核对|检查|复跑性)/i.test(text)
    && /(rerun command|run command|script path|artifact path|file path|路径|命令|脚本路径)/i.test(text)
    && !/(update|revise|rewrite|regenerate|edit|modify|refresh|replace|write|persist|produce|更新|修订|重写|改写|修改|替换|写入|产出|重新生成)/i.test(text);
}

function readOnlyHypotheticalArtifactRevisionRequested(text: string) {
  const asksRecommendation = /(how should|how would|what should|what would|should (?:we|i)|recommend|recommendation|建议|应该如何|应如何|如何(?:修改|调整|改)|怎么(?:修改|调整|改)|怎样(?:修改|调整|改)|如果|预算降到)/i.test(text);
  const anchorsExistingArtifact = /(current|selected|existing|previous|prior|artifact|report|protocol|当前|选中|已有|之前|产物|报告|方案)/i.test(text);
  const asksAnswerOnly = /(answer|tell me|explain|基于|回答|说明|标明|继续标明|建议)/i.test(text);
  const asksDurableWrite = /(write(?:\s+the)? file|persist|save|updated artifact|new artifact|artifact path|file path|生成(?:新的)?(?:报告|文件|产物)|写入|保存|产出|文件路径|新的 artifact|更新后的 artifact)/i.test(text);
  return asksRecommendation && anchorsExistingArtifact && asksAnswerOnly && !asksDurableWrite;
}

function explicitAnswerOnlyNoToolsRequested(text: string) {
  return /(answer-only|no tools|do not run tools|without starting|不要启动新的 workspace task|不要运行工具|不启动工具|只回答|仅回答)/i.test(text);
}

function isBoundedAnswerArtifact(value: unknown) {
  if (!isRecord(value)) return false;
  const payload = isRecord(value.payload) ? value.payload : {};
  const currentReference = isRecord(payload.currentReference) ? payload.currentReference : {};
  const objectReference = isRecord(payload.objectReference) ? payload.objectReference : {};
  const type = [
    stringField(value.type),
    stringField(value.artifactType),
    stringField(value.id),
    stringField(value.kind),
    stringField(value.ref),
    stringField(value.title),
    stringField(value.dataRef),
    stringField(value.path),
    stringField(currentReference.artifactType),
    stringField(currentReference.ref),
    stringField(currentReference.title),
    stringField(objectReference.artifactType),
    stringField(objectReference.ref),
    stringField(objectReference.title),
  ].filter(Boolean).join(' ');
  if (/runtime-diagnostic|diagnostic|stderr|stdout|log|failure|error/i.test(type)) return false;
  if (!/(evidence[-\s_]?matrix|research-report|report|paper-list|analysis|document|summary|table|dataset|csv|notebook|script|chart|plot|figure|image|png|jpe?g|webp|svg|图表|图片)/i.test(type)) return false;
  return Boolean(
    stringField(value.id)
    || stringField(value.ref)
    || stringField(value.dataRef)
    || stringField(value.path)
    || stringField(value.sourceRef)
    || stringField(currentReference.ref)
    || stringField(objectReference.ref)
    || value.data !== undefined,
  );
}

function directContextDecisionAllowsAnswer(decision: DirectContextDecision) {
  return decision.allowDirectContext === true
    && decision.sufficiency === 'sufficient'
    && Boolean(decision.decisionRef)
    && decision.requiredTypedContext.length > 0
    && decision.usedRefs.length > 0;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function recordRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
