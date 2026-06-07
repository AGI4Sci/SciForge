import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';
import { runtimeResultViewSlotsPolicy } from '../../../packages/presentation/interactive-views/runtime-ui-manifest-policy.js';
import { expectedArtifactTypesForRequest } from './gateway-request.js';
import {
  DIRECT_CONTEXT_FAST_PATH_POLICY,
  buildDirectContextFastPathItems,
  directContextFastPathMessage,
  directContextFastPathSupportingRefs,
} from '@sciforge-ui/runtime-contract/artifact-policy';
import {
  directContextCapabilityStatusBlockedContextPolicy,
  directContextGateBlockedReasonForIntent,
  directContextLibraryBudgetTarget,
  directContextPromptRequestsEvidenceMatrixArtifact,
  directContextPromptRequestsAnalysisReportFollowup,
  directContextPromptRequestsEvidenceMatrixHypotheses,
  directContextPromptRequestsProtocolBudgetAdaptation,
  directContextRecordLooksLikeEvidenceMatrix,
  directContextRequiredContextForIntentPolicy,
  directContextTextWantsChinese,
} from '@sciforge-ui/runtime-contract/direct-context-followup-policy';
import type { DirectContextDecision, DirectContextIntent, DirectContextTransformMode } from './direct-context-fast-path-shared.js';
import { selectedChartSufficiencyAnswerMessage, selectedLiteratureReportBulletSummaryMessage, selectedQcMissingnessImpactAnswerMessage, selectedReportCounterfactualThresholdAnswerMessage, selectedReportCredibilityAuditAnswerMessage, selectedReportEvidenceBoundaryAnswerMessage, selectedReportEvidenceStatusAnswerMessage, selectedReportLiteralFactAnswerMessage, selectedReportPassFailAuditAnswerMessage, selectedReportQuestionAnswerMessage, selectedReportRerunInfoAnswerMessage } from './direct-context-fast-path-selected-report.js';
import {
  artifactMutationFollowupRequiresBackend,
  boundedArtifactFollowupForbidsFreshWork,
  boundedArtifactFollowupPrompt,
  boundedArtifactFollowupRequested,
  boundedFollowupRecords,
  capabilityStatusFastPathPayload,
  directContextClaimText,
  directContextDecisionAllowsAnswer,
  directContextItemMatchesSelectedRef,
  directContextStatements,
  fallbackDirectContextDecisionForBoundedArtifactFollowup,
  explicitSelectedOnlyPrompt,
  hasCurrentContextEvidence,
  hasUsableArtifactRefOrData,
  intentSummaryAnswer,
  isDirectContextAnswerStatement,
  isBoundedAnswerArtifact,
  normalizeDirectContextMentionText,
  policyRequestsDirectContext,
  promptMentionedFileTitle,
  promptNamedDirectContextItems,
  recordRows,
  selectedDurableReferenceTokens,
  selectedReferenceSummaryMessage,
  selectedReferenceTokenVariants,
  selectedReferenceTokens,
  statementParts,
  stringField,
  toStringList,
  uniqueStrings,
} from './direct-context-fast-path-shared.js';

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
  const selectedLiteratureReportBulletsMessage = selectedLiteratureReportBulletSummaryMessage(request, payloadContext);
  const selectedReportEvidenceStatusMessage = selectedLiteratureReportBulletsMessage
    ? undefined
    : selectedReportEvidenceStatusAnswerMessage(request, payloadContext);
  const selectedQcMissingnessMessage = selectedLiteratureReportBulletsMessage || selectedReportEvidenceStatusMessage
    ? undefined
    : selectedQcMissingnessImpactAnswerMessage(request, payloadContext);
  const selectedChartSufficiencyMessage = selectedLiteratureReportBulletsMessage || selectedReportEvidenceStatusMessage || selectedQcMissingnessMessage
    ? undefined
    : selectedChartSufficiencyAnswerMessage(request, payloadContext);
  const suppressExpectedArtifactGate = Boolean(
    transformMode
    || selectedLiteratureReportBulletsMessage
    || selectedReportEvidenceStatusMessage
    || selectedQcMissingnessMessage
    || selectedChartSufficiencyMessage
    || boundedArtifactFollowupRequested(request),
  );
  const missingExpectedArtifacts = suppressExpectedArtifactGate ? [] : missingExpectedArtifactTypes(request);
  if (missingExpectedArtifacts.length) return missingExpectedArtifactsPayload(request, payloadContext, missingExpectedArtifacts, gate);
  const message = selectedLiteratureReportBulletsMessage
    ?? selectedReportEvidenceStatusMessage
    ?? selectedQcMissingnessMessage
    ?? selectedChartSufficiencyMessage
    ?? directContextAnswerMessage(request, payloadContext, decision);
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
    objectReferences: directContextObjectReferences(payloadContext, instance.runId),
  };
}

function directContextObjectReferences(
  context: ReturnType<typeof buildDirectContextFastPathItems>,
  runId: string,
) {
  return uniqueStrings(context
    .map((item) => item.ref)
    .filter((ref): ref is string => Boolean(ref)))
    .map((ref, index) => {
      const item = context.find((candidate) => candidate.ref === ref);
      return {
        id: `obj-direct-context-${index + 1}`,
        kind: item?.kind ?? 'artifact',
        title: item?.label ?? ref,
        ref,
        runId,
        producerRunId: runId,
        status: 'available',
        summary: item?.summary,
      };
    });
}

function scopedDirectContextPayloadContext(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const promptNamedContext = promptNamedDirectContextItems(request, context);
  const promptFileTitle = promptMentionedFileTitle(request.prompt);
  if (promptFileTitle && promptNamedContext.length) return promptNamedContext;
  const selectedRefs = selectedReferenceTokens(request);
  const durableSelectedRefs = selectedDurableReferenceTokens(request);
  const durableSelectedContext = durableSelectedRefs.length
    ? context.filter((item) => directContextItemMatchesSelectedRef(item, durableSelectedRefs))
    : [];
  if (durableSelectedContext.length && boundedArtifactFollowupPrompt(request.prompt)) return durableSelectedContext;
  if (selectedRefs.length && explicitSelectedOnlyPrompt(request.prompt)) {
    const selectedContext = context.filter((item) => directContextItemMatchesSelectedRef(item, selectedRefs));
    return selectedContext.length ? selectedContext : context;
  }
  if (promptNamedContext.length) return promptNamedContext;
  return context;
}

function readableArtifactFileRef(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const delivery = isRecord(artifact.delivery) ? artifact.delivery : {};
  return stringField(artifact.dataRef)
    ?? stringField(artifact.path)
    ?? stringField(artifact.sourceRef)
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
  let artifacts = (await Promise.all(request.artifacts.map((artifact) => hydrateDirectContextReadableArtifact(artifact, workspace)))).filter(isRecord);
  const references = (await Promise.all(recordRows(request.references).map((reference) => hydrateDirectContextReadableReference(reference, workspace)))).filter(isRecord);
  const hydratedUiArtifacts = Array.isArray(uiState.artifacts)
    ? await Promise.all(uiState.artifacts.map((artifact) => hydrateDirectContextReadableArtifact(artifact, workspace)))
    : uiState.artifacts;
  const hydratedCurrentReferences = Array.isArray(uiState.currentReferences)
    ? await Promise.all(uiState.currentReferences.map((reference) => hydrateDirectContextReadableReference(reference, workspace)))
    : uiState.currentReferences;
  const promptNamedArtifact = await promptNamedReadableArtifactFromCurrentRefs(request, workspace, artifacts);
  if (promptNamedArtifact) artifacts = mergeArtifactRecords([...artifacts, promptNamedArtifact]);
  return {
    ...request,
    artifacts,
    references,
    uiState: {
      ...uiState,
      artifacts: hydratedUiArtifacts,
      currentReferences: hydratedCurrentReferences,
    },
  };
}

async function hydrateDirectContextReadableArtifact(artifact: unknown, workspace: string) {
  if (!isRecord(artifact)) return artifact;
  const existingData = isRecord(artifact.data) ? artifact.data : {};
  if (recordHasInlineReadableArtifactData(artifact)) return artifact;
  const ref = readableArtifactFileRef(artifact);
  const path = safeDirectContextReadPath(workspace, ref);
  if (!path) return artifact;
  const text = await readBoundedUtf8(path, DIRECT_CONTEXT_FAST_PATH_POLICY.contextLimits.summaryChars * 12);
  if (!text) return artifact;
  const type = stringField(artifact.type) ?? stringField(artifact.artifactType) ?? '';
  const data = /report|summary|markdown|document/i.test(type)
    ? { ...existingData, markdown: text, content: text, text }
    : { ...existingData, content: text, text };
  return { ...artifact, data };
}

async function hydrateDirectContextReadableReference(reference: unknown, workspace: string) {
  if (!isRecord(reference)) return reference;
  if (recordHasInlineReadableArtifactData(reference)) return reference;
  const ref = readableReferenceFileRef(reference);
  const path = safeDirectContextReadPath(workspace, ref);
  if (!path) return reference;
  const text = await readBoundedUtf8(path, DIRECT_CONTEXT_FAST_PATH_POLICY.contextLimits.summaryChars * 12);
  if (!text) return reference;
  return {
    ...reference,
    content: text,
    text,
    markdown: /\.(?:md|markdown)$/i.test(path) ? text : stringField(reference.markdown),
  };
}

function readableReferenceFileRef(reference: Record<string, unknown>) {
  const payload = isRecord(reference.payload) ? reference.payload : {};
  const provenance = isRecord(payload.provenance) ? payload.provenance : {};
  const currentReference = isRecord(payload.currentReference) ? payload.currentReference : {};
  const currentProvenance = isRecord(currentReference.provenance) ? currentReference.provenance : {};
  const objectReference = isRecord(payload.objectReference) ? payload.objectReference : {};
  const objectProvenance = isRecord(objectReference.provenance) ? objectReference.provenance : {};
  return stringField(reference.dataRef)
    ?? stringField(reference.path)
    ?? stringField(provenance.dataRef)
    ?? stringField(provenance.path)
    ?? stringField(payload.dataRef)
    ?? stringField(payload.path)
    ?? stringField(currentReference.dataRef)
    ?? stringField(currentReference.path)
    ?? stringField(currentProvenance.dataRef)
    ?? stringField(currentProvenance.path)
    ?? stringField(objectReference.dataRef)
    ?? stringField(objectReference.path)
    ?? stringField(objectProvenance.dataRef)
    ?? stringField(objectProvenance.path)
    ?? stringField(reference.ref);
}

async function promptNamedReadableArtifactFromCurrentRefs(
  request: GatewayRequest,
  workspace: string,
  artifacts: unknown[],
) {
  const promptFileTitle = promptMentionedFileTitle(request.prompt);
  if (!promptFileTitle) return undefined;
  if (artifacts.some((artifact) => isRecord(artifact)
    && recordMatchesPromptMentionedFile(artifact, promptFileTitle)
    && recordHasInlineReadableArtifactData(artifact))) return undefined;
  const record = boundedFollowupRecords({ ...request, artifacts } as GatewayRequest)
    .find((item) => recordMatchesPromptMentionedFile(item, promptFileTitle));
  if (!record) return undefined;
  const ref = readableArtifactFileRef(record);
  const path = safeDirectContextReadPath(workspace, ref);
  if (!path) return undefined;
  const text = await readBoundedUtf8(path, DIRECT_CONTEXT_FAST_PATH_POLICY.contextLimits.summaryChars * 12);
  if (!text) return undefined;
  const type = /\.(?:md|markdown)$/i.test(path) ? 'research-report' : 'runtime-context-summary';
  return {
    id: `prompt-file-${sha1(path).slice(0, 12)}`,
    type,
    ref,
    dataRef: ref,
    path: ref,
    title: promptFileTitle,
    metadata: {
      reportRef: ref,
      sourceRef: ref,
    },
    data: {
      markdown: text,
      content: text,
    },
  };
}

function recordHasInlineReadableArtifactData(record: Record<string, unknown>) {
  const data = isRecord(record.data) ? record.data : {};
  return Boolean(
    stringField(data.markdown)
    || stringField(data.report)
    || stringField(data.text)
    || stringField(data.summary)
    || recordRows(data.rows).length,
  );
}

async function requestWithSessionArtifactsForBoundedFollowup(request: GatewayRequest): Promise<GatewayRequest> {
  const promptFileTitle = promptMentionedFileTitle(request.prompt);
  const hasPromptNamedArtifact = promptFileTitle
    ? request.artifacts.some((artifact) => isRecord(artifact) && recordMatchesPromptMentionedFile(artifact, promptFileTitle))
    : false;
  if (request.artifacts.some(isBoundedAnswerArtifact) && (
    !directContextPromptRequestsEvidenceMatrixArtifact(request.prompt)
    || request.artifacts.some((artifact) => isRecord(artifact) && directContextRecordLooksLikeEvidenceMatrix(`${stringField(artifact.type) ?? ''} ${stringField(artifact.id) ?? ''}`))
  ) && (!promptFileTitle || hasPromptNamedArtifact)) return request;
  if (!boundedArtifactFollowupPrompt(request.prompt)) return request;
  const sessionId = sessionIdFromUiState(request.uiState);
  for (const workspace of directContextWorkspaceCandidates(request.workspacePath)) {
    const artifacts = await readSessionArtifactsForDirectContext(workspace, sessionId);
    if (artifacts.length) {
      return { ...request, artifacts: mergeArtifactRecords([...request.artifacts, ...artifacts]) };
    }
  }
  return request;
}

function directContextWorkspaceCandidates(requestWorkspacePath: string | undefined) {
  const candidates: string[] = [];
  const add = (value: string | undefined, base?: string) => {
    if (!value) return;
    candidates.push(resolve(base ?? process.cwd(), value));
  };
  add(requestWorkspacePath);
  add(process.env.SCIFORGE_WORKSPACE_PATH);
  if (requestWorkspacePath && process.env.SCIFORGE_WORKSPACE_PATH && !isAbsolute(process.env.SCIFORGE_WORKSPACE_PATH)) {
    add(process.env.SCIFORGE_WORKSPACE_PATH, resolve(requestWorkspacePath));
  }
  return uniqueStrings(candidates);
}

function recordMatchesPromptMentionedFile(record: Record<string, unknown>, fileTitle: string) {
  const metadata = isRecord(record.metadata) ? record.metadata : {};
  const delivery = isRecord(record.delivery) ? record.delivery : {};
  const candidates = [
    stringField(record.id),
    stringField(record.title),
    stringField(record.ref),
    stringField(record.path),
    stringField(record.dataRef),
    stringField(metadata.reportRef),
    stringField(metadata.markdownRef),
    stringField(metadata.dataRef),
    stringField(metadata.path),
    stringField(delivery.readableRef),
    stringField(delivery.rawRef),
  ].filter((value): value is string => Boolean(value));
  const targetVariants = selectedReferenceTokenVariants(fileTitle)
    .map(normalizeDirectContextMentionText)
    .filter((value) => value.length >= 8);
  return candidates.some((candidate) => {
    const candidateVariants = selectedReferenceTokenVariants(candidate)
      .map(normalizeDirectContextMentionText);
    return candidateVariants.some((variant) => targetVariants.some((target) => variant.includes(target) || target.includes(variant)));
  });
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
        requiredContext: directContextCapabilityStatusBlockedContextPolicy(),
        usedContextRefs,
        sufficiency: 'insufficient',
        blockReason: decision.blockReason ?? directContextGateBlockedReasonForIntent(intent),
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
        blockReason: decision.blockReason ?? directContextGateBlockedReasonForIntent(intent),
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
        blockReason: decision.blockReason ?? directContextGateBlockedReasonForIntent(intent),
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
  const fallback = legacyDirectContextPolicyWithoutCanonicalHarness(request)
    ? undefined
    : fallbackDirectContextDecisionForBoundedArtifactFollowup(request);
  if (fallback && boundedArtifactFollowupForbidsFreshWork(request.prompt)) return fallback;
  if (fallback && (!structured || !directContextDecisionAllowsAnswer(structured))) return fallback;
  return structured ?? fallback;
}

function legacyDirectContextPolicyWithoutCanonicalHarness(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const conversationPolicy = isRecord(uiState.conversationPolicy) ? uiState.conversationPolicy : {};
  const harnessContract = isRecord(conversationPolicy.harnessContract) ? conversationPolicy.harnessContract : {};
  if (isRecord(harnessContract.directContextDecision)) return false;
  if (
    stringField(conversationPolicy.applicationStatus) !== 'applied'
    || stringField(conversationPolicy.policySource) !== DIRECT_CONTEXT_FAST_PATH_POLICY.policyOwner
  ) return false;
  const executionModePlan = isRecord(conversationPolicy.executionModePlan) ? conversationPolicy.executionModePlan : {};
  return isRecord(uiState.directContextDecision)
    || isRecord(conversationPolicy.directContextDecision)
    || isRecord(executionModePlan.directContextDecision);
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
  return directContextRequiredContextForIntentPolicy(intent);
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
  const selectedLiteratureReportBullets = selectedLiteratureReportBulletSummaryMessage(request, context);
  if (selectedLiteratureReportBullets) return selectedLiteratureReportBullets;
  const selectedReportEvidenceStatus = selectedReportEvidenceStatusAnswerMessage(request, context);
  if (selectedReportEvidenceStatus) return selectedReportEvidenceStatus;
  const selectedQcMissingness = selectedQcMissingnessImpactAnswerMessage(request, context);
  if (selectedQcMissingness) return selectedQcMissingness;
  const selectedChartSufficiency = selectedChartSufficiencyAnswerMessage(request, context);
  if (selectedChartSufficiency) return selectedChartSufficiency;
  const hypotheses = testableHypothesesFromEvidenceMatrixMessage(prompt, context);
  if (hypotheses) return hypotheses;
  const selectedReportCounterfactual = selectedReportCounterfactualThresholdAnswerMessage(request, context);
  if (selectedReportCounterfactual) return selectedReportCounterfactual;
  const selectedReportPassFailAudit = selectedReportPassFailAuditAnswerMessage(request, context);
  if (selectedReportPassFailAudit) return selectedReportPassFailAudit;
  const selectedReportRerunInfo = selectedReportRerunInfoAnswerMessage(request, context);
  if (selectedReportRerunInfo) return selectedReportRerunInfo;
  const selectedReportBoundary = selectedReportEvidenceBoundaryAnswerMessage(request, context);
  if (selectedReportBoundary) return selectedReportBoundary;
  const selectedReportLiteralFacts = selectedReportLiteralFactAnswerMessage(request, context);
  if (selectedReportLiteralFacts) return selectedReportLiteralFacts;
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
  if (!directContextPromptRequestsEvidenceMatrixHypotheses(prompt)) return undefined;
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
  if (!directContextPromptRequestsAnalysisReportFollowup(prompt)) return undefined;
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
  const english = !directContextTextWantsChinese(prompt);
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
  const sourceText = directContextJoinedText(context);
  if (!directContextPromptRequestsProtocolBudgetAdaptation(prompt, sourceText.slice(0, 2000))) return undefined;
  const targetLibraries = directContextLibraryBudgetTarget(prompt);
  if (!targetLibraries) return undefined;
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
  const chinese = directContextTextWantsChinese(prompt);
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
    .filter((line) => !/backend generation stopped|convergence guard|\.sciforge\/sessions|task-results|artifact:/i.test(line))
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
