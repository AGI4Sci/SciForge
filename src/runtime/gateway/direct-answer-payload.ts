import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { expectedArtifactTypesForRequest } from './gateway-request.js';
import { clipForAgentServerJson, isRecord, toRecordList } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';
import { isToolPayload } from './tool-payload-contract.js';
import { normalizeRuntimeVerificationResultsOrUndefined } from './verification-results.js';
import {
  directAnswerArtifactNeedsRepair,
  directAnswerResultPolicyIds,
  ensureDirectAnswerReportArtifactPolicy,
  normalizeDirectAnswerArtifacts,
  normalizeDirectAnswerUiManifest,
  standaloneWorkspaceArtifactPayloadPolicy,
  stripDirectAnswerJsonFence,
} from '../../../packages/presentation/interactive-views';

type ArtifactReferenceContextCollector = (request: GatewayRequest) => Promise<{ combinedArtifacts: Array<Record<string, unknown>> } | undefined>;
let artifactReferenceContextCollector: ArtifactReferenceContextCollector | undefined;
const reportViewerComponentId = ['report', 'viewer'].join('-');
const executionUnitTableComponentId = ['execution', 'unit', 'table'].join('-');

export {
  GENERATED_TASK_PAYLOAD_PREFLIGHT_SCHEMA_VERSION,
  evaluateGeneratedTaskPayloadPreflight,
  type GeneratedTaskPayloadPreflightIssue,
  type GeneratedTaskPayloadPreflightReport,
} from './generated-task-payload-preflight.js';

export function configureDirectAnswerArtifactContext(collector: ArtifactReferenceContextCollector) {
  artifactReferenceContextCollector = collector;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function artifactNeedsRepair(artifact: Record<string, unknown>) {
  return directAnswerArtifactNeedsRepair(artifact);
}

export function toolPayloadFromPlainAgentOutput(text: string, request: GatewayRequest): ToolPayload {
  const structured = coerceAgentServerToolPayload(extractJson(text));
  if (structured) return ensureDirectAnswerReportArtifact(structured, request, directAnswerResultPolicyIds.structuredAnswerSource);
  const nested = extractNestedAgentServerPayloadFromText(text);
  if (nested) return ensureDirectAnswerReportArtifact(nested, request, directAnswerResultPolicyIds.structuredAnswerSource);
  const directTextGuard = classifyPlainAgentText(text);
  return guardedDirectTextDiagnosticPayload(text, request, directTextGuard);
}

export type PlainAgentTextClassificationKind =
  | 'human-answer'
  | 'tool-payload-json'
  | 'task-files-json'
  | 'code-or-script'
  | 'runtime-log'
  | 'trace-or-debug-payload'
  | 'process-narration';

export interface PlainAgentTextClassification {
  kind: PlainAgentTextClassificationKind;
  reason: string;
}

export function classifyPlainAgentText(text: string): PlainAgentTextClassification {
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'runtime-log', reason: 'empty direct text cannot satisfy the user-visible result contract' };
  if (/"(?:message|claims|uiManifest|executionUnits|artifacts)"\s*:/.test(trimmed) || /\bToolPayload\b|raw[_\s-]*tool[_\s-]*payload/i.test(trimmed)) {
    return { kind: 'tool-payload-json', reason: 'direct text looks like an unparsed ToolPayload or payload fragment' };
  }
  if (/"taskFiles"\s*:|taskFiles\s*[:=]|\b(outputRel|stdoutRel|stderrRel|taskRel)\b/.test(trimmed)) {
    return { kind: 'task-files-json', reason: 'direct text looks like generated taskFiles or workspace task metadata' };
  }
  if (/\b(stdout|stderr|stack trace|traceback \(most recent call last\)|error:|exception:)\b/i.test(trimmed)
    && /(?:\n|at\s+\S+\s+\(|\.ts:\d+|\.py", line \d+)/i.test(trimmed)) {
    return { kind: 'runtime-log', reason: 'direct text looks like raw logs or a stack trace' };
  }
  if (/\b(runtimeEvents|reasoningTrace|workEvidence|executionUnits|validationFailures|contractValidationFailure|schemaVersion)\b/.test(trimmed)
    && /[{[\]]/.test(trimmed)) {
    return { kind: 'trace-or-debug-payload', reason: 'direct text looks like runtime trace, schema, or debug payload' };
  }
  if (looksMostlyLikeCode(trimmed)) {
    return { kind: 'code-or-script', reason: 'direct text looks like code or script output that should be materialized as an artifact or execution unit' };
  }
  if (/^(?:i(?:'|’)ll|i will|let me|now i(?:'|’)ll|next i(?:'|’)ll|checking|inspecting|running|reading)\b/i.test(trimmed)
    && !/[.!?]\s*$/.test(trimmed.slice(0, 240))) {
    return { kind: 'process-narration', reason: 'direct text looks like intermediate process narration rather than a final answer' };
  }
  return { kind: 'human-answer', reason: 'direct text appears to be a user-facing answer' };
}

function guardedDirectTextDiagnosticPayload(
  text: string,
  request: GatewayRequest,
  classification: PlainAgentTextClassification,
): ToolPayload {
  const id = sha1(`${classification.kind}:${text}`).slice(0, 10);
  const expected = expectedArtifactTypesForRequest(request);
  const excerpt = clipForAgentServerJson(text, 2000);
  return {
    message: 'AgentServer returned raw generated work instead of a user-facing result. SciForge preserved it as a diagnostic and did not present it as the final answer.',
    confidence: 0,
    claimType: 'runtime-diagnostic',
    evidenceLevel: 'agentserver-direct-text-guard',
    reasoningTrace: [
      'Plain AgentServer text was blocked by the strict ToolPayload boundary.',
      `classification=${classification.kind}`,
      `reason=${classification.reason}`,
    ].join('\n'),
    claims: [{
      id: `claim-direct-text-guard-${id}`,
      text: 'Plain AgentServer output was not a structured ToolPayload or taskFiles response and cannot be promoted to a final answer.',
      type: 'runtime-diagnostic',
      confidence: 0,
      evidenceLevel: 'agentserver-direct-text-guard',
      supportingRefs: [`artifact:agentserver-direct-text-diagnostic-${id}`],
      opposingRefs: [],
    }],
    uiManifest: [
      {
        componentId: reportViewerComponentId,
        artifactRef: `agentserver-direct-text-diagnostic-${id}`,
        title: 'Direct text diagnostic',
        priority: 1,
      },
      {
        componentId: executionUnitTableComponentId,
        title: 'Recovery unit',
        priority: 2,
      },
    ],
    executionUnits: [{
      id: `agentserver-direct-text-guard-${id}`,
      status: 'needs-human',
      tool: directAnswerResultPolicyIds.directTextTool,
      params: JSON.stringify({ classification: classification.kind, expectedArtifactTypes: expected, prompt: request.prompt.slice(0, 200) }),
      failureReason: classification.reason,
      recoverActions: [
        'Ask the backend to return a structured ToolPayload with artifacts, executionUnits, and uiManifest.',
        'If this is prose, return it inside a strict ToolPayload with structured claims, refs, artifacts, and displayIntent.',
      ],
      nextStep: 'Retry with structured output or inspect the preserved diagnostic artifact.',
    }],
    artifacts: [{
      id: `agentserver-direct-text-diagnostic-${id}`,
      type: 'runtime-diagnostic',
      format: 'markdown',
      title: 'AgentServer direct text guard',
      content: [
        '# AgentServer direct text guard',
        '',
        `- Classification: ${classification.kind}`,
        `- Reason: ${classification.reason}`,
        `- Expected artifacts: ${expected.length ? expected.join(', ') : 'none declared'}`,
        '',
        '## Preserved excerpt',
        '',
        '```text',
        excerpt,
        '```',
      ].join('\n'),
      data: {
        classification: classification.kind,
        reason: classification.reason,
        excerpt,
        expectedArtifactTypes: expected,
      },
    }],
    displayIntent: {
      status: 'needs-human',
      reason: 'direct-text-fallback-guard',
      primaryView: 'diagnostic',
    },
  };
}

function mergeExistingContextArtifactsForDirectAnswer(
  payload: ToolPayload,
  request: GatewayRequest,
  referenceArtifacts: Array<Record<string, unknown>>,
): ToolPayload {
  const expected = new Set(expectedArtifactTypesForRequest(request));
  if (!expected.size || !referenceArtifacts.length) return payload;
  const present = new Set(payload.artifacts.map((artifact) => String(artifact.type || artifact.id || '')).filter(Boolean));
  const additions: Array<Record<string, unknown>> = [];
  for (const artifact of referenceArtifacts) {
    const type = String(artifact.type || artifact.id || '');
    if (!expected.has(type) || present.has(type) || artifactNeedsRepair(artifact)) continue;
    additions.push({
      ...artifact,
      metadata: {
        ...(isRecord(artifact.metadata) ? artifact.metadata : {}),
        source: stringField(isRecord(artifact.metadata) ? artifact.metadata.source : undefined) ?? directAnswerResultPolicyIds.existingContextSource,
        reusedForContextAnswer: true,
      },
    });
    present.add(type);
  }
  return additions.length ? { ...payload, artifacts: [...payload.artifacts, ...additions] } : payload;
}

export async function mergeReusableContextArtifactsForDirectPayload(
  payload: ToolPayload,
  request: GatewayRequest,
): Promise<ToolPayload> {
  const context = directPayloadReferencesExistingContext(payload, request)
    ? await artifactReferenceContextCollector?.(request)
    : undefined;
  return mergeExistingContextArtifactsForDirectAnswer(
    payload,
    request,
    context?.combinedArtifacts.length ? context.combinedArtifacts : request.artifacts,
  );
}

function directPayloadReferencesExistingContext(payload: ToolPayload, request: GatewayRequest) {
  const hasRecoverableContext = request.artifacts.length > 0
    || toRecordList(request.uiState?.recentExecutionRefs).length > 0
    || (Array.isArray(request.uiState?.recentConversation) && request.uiState.recentConversation.length > 1);
  if (!hasRecoverableContext) return false;
  const policy = isRecord(request.uiState?.contextReusePolicy)
    ? request.uiState.contextReusePolicy
    : isRecord(request.uiState?.contextIsolation)
      ? request.uiState.contextIsolation
      : undefined;
  if (policy) {
    const mode = typeof policy.mode === 'string' ? policy.mode : '';
    const historyReuse = isRecord(policy.historyReuse) ? policy.historyReuse : {};
    return historyReuse.allowed === true || mode === 'continue' || mode === 'repair';
  }
  return directPayloadCarriesStructuredContextRefs(payload);
}

function directPayloadCarriesStructuredContextRefs(payload: ToolPayload) {
  if (toRecordList(payload.objectReferences).some((reference) => {
    const ref = stringField(reference.ref);
    return ref ? /^(artifact|file|folder|run|execution-unit):/i.test(ref) : false;
  })) return true;
  if (payload.artifacts.some((artifact) => artifact.dataRef || artifact.ref || artifact.path)) return true;
  return payload.claims.some((claim) => toRecordList(claim.supportingRefs).length || toRecordList(claim.evidenceRefs).length);
}

export function ensureDirectAnswerReportArtifact(payload: ToolPayload, request: GatewayRequest, source: string): ToolPayload {
  const expected = expectedArtifactTypesForRequest(request);
  return ensureDirectAnswerReportArtifactPolicy(payload, {
    prompt: request.prompt,
    skillDomain: request.skillDomain,
    expectedArtifactTypes: expected,
  }, source);
}

export function coerceAgentServerToolPayload(value: unknown): ToolPayload | undefined {
  const normalized = normalizeAgentServerToolPayloadCandidate(value);
  return isToolPayload(normalized) ? normalized : undefined;
}

export function coerceWorkspaceTaskPayload(value: unknown): ToolPayload | undefined {
  if (isToolPayload(value)) return normalizeToolPayloadShape(value);
  if (!isRecord(value)) return undefined;
  const normalizedCandidate = normalizeToolPayloadShape(value as unknown as ToolPayload);
  if (isToolPayload(normalizedCandidate)) return normalizedCandidate;
  const strictNested = strictToolPayloadCandidate(value);
  if (strictNested) return normalizeToolPayloadShape(strictNested);
  const artifactPayload = coerceStandaloneArtifactPayload(value);
  if (artifactPayload) return artifactPayload;
  return undefined;
}

export function normalizeWorkspaceTaskPayloadBoundary(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    ...value,
    artifacts: normalizeWorkspaceTaskArtifacts(value.artifacts),
  };
}

export function normalizeWorkspaceTaskArtifacts(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value
      .map((artifact, index) => isRecord(artifact) ? normalizeWorkspaceTaskArtifactRecord(artifact, String(index + 1)) : undefined)
      .filter(isRecord);
  }
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .flatMap(([key, artifact]) => {
      if (!isRecord(artifact)) return [];
      return [{
        ...normalizeWorkspaceTaskArtifactRecord(artifact, key),
        metadata: {
          ...(isRecord(artifact.metadata) ? artifact.metadata : {}),
          originalArtifactKey: key,
          normalizedFromArtifactMap: true,
        },
      }];
    });
}

function normalizeWorkspaceTaskArtifactRecord(artifact: Record<string, unknown>, fallbackKey: string): Record<string, unknown> {
  const ref = artifactRefCandidate(artifact);
  const inferredId = stringField(artifact.id)
    ?? artifactIdFromRef(ref)
    ?? stringField(artifact.title)
    ?? stringField(artifact.label)
    ?? fallbackKey;
  const id = safeArtifactToken(inferredId, fallbackKey);
  const type = safeArtifactToken(
    stringField(artifact.type)
      ?? stringField(artifact.artifactType)
      ?? artifactTypeFromRef(ref)
      ?? (stringField(artifact.kind) && !/^file$/i.test(String(artifact.kind)) ? stringField(artifact.kind) : undefined)
      ?? id,
    id,
  );
  const path = stringField(artifact.path) ?? stringField(artifact.filePath) ?? stringField(artifact.ref);
  const dataRef = stringField(artifact.dataRef) ?? stringField(artifact.data_ref) ?? path;
  return {
    ...artifact,
    id,
    type,
    ...(path ? { path } : {}),
    ...(dataRef ? { dataRef } : {}),
    metadata: {
      ...(isRecord(artifact.metadata) ? artifact.metadata : {}),
      ...(ref && !stringField(isRecord(artifact.metadata) ? artifact.metadata.sourceRef : undefined) ? { sourceRef: ref } : {}),
      normalizedArtifactIdentity: stringField(artifact.id) && stringField(artifact.type) ? undefined : true,
    },
  };
}

function artifactRefCandidate(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  return stringField(artifact.dataRef)
    ?? stringField(artifact.path)
    ?? stringField(artifact.ref)
    ?? stringField(artifact.filePath)
    ?? stringField(metadata.path)
    ?? stringField(metadata.filePath)
    ?? stringField(metadata.markdownRef)
    ?? stringField(metadata.reportRef);
}

function artifactIdFromRef(ref: string | undefined) {
  if (!ref) return undefined;
  const last = ref.replace(/\\/g, '/').split('/').filter(Boolean).pop();
  return last?.replace(/\.[^.]+$/, '');
}

function artifactTypeFromRef(ref: string | undefined) {
  const id = artifactIdFromRef(ref)?.toLowerCase();
  if (!id) return undefined;
  if (/research-report|report|summary|review/.test(id)) return 'research-report';
  if (/paper-list|papers|bibliography|references/.test(id)) return 'paper-list';
  if (/evidence-matrix|evidence|matrix/.test(id)) return 'evidence-matrix';
  if (/\.?csv$/.test(ref ?? '')) return 'data-table';
  if (/\.?md$|\.?markdown$/.test(ref ?? '')) return 'markdown';
  return id;
}

function safeArtifactToken(value: string | undefined, fallback: string) {
  return (value ?? fallback).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || fallback;
}

function coerceStandaloneArtifactPayload(value: Record<string, unknown>): ToolPayload | undefined {
  return standaloneWorkspaceArtifactPayloadPolicy(value) as ToolPayload | undefined;
}

export function normalizeToolPayloadShape(payload: ToolPayload): ToolPayload {
  const artifacts = normalizeWorkspaceTaskArtifacts(payload.artifacts);
  const rawDisplayIntent: unknown = payload.displayIntent;
  const message = String(payload.message || '');
  return {
    ...payload,
    confidence: typeof payload.confidence === 'number' && Number.isFinite(payload.confidence)
      ? payload.confidence
      : typeof payload.confidence === 'string'
        ? parseFloat(payload.confidence) || 0.72
        : 0.72,
    claimType: String(payload.claimType || 'agentserver-answer'),
    evidenceLevel: String(payload.evidenceLevel || 'agentserver'),
    reasoningTrace: Array.isArray(payload.reasoningTrace)
      ? payload.reasoningTrace.map(String).filter(Boolean).join('\n')
      : typeof payload.reasoningTrace === 'string'
        ? payload.reasoningTrace
        : String(payload.reasoningTrace || ''),
    claims: normalizeAgentServerClaims(payload.claims, message),
    displayIntent: isRecord(rawDisplayIntent)
      ? payload.displayIntent
      : typeof rawDisplayIntent === 'string' && rawDisplayIntent.trim()
        ? { primaryView: rawDisplayIntent.trim() }
        : undefined,
    uiManifest: normalizeDirectAnswerUiManifest(payload.uiManifest, artifacts),
    executionUnits: normalizeAgentServerExecutionUnits(payload.executionUnits),
    artifacts: normalizeDirectAnswerArtifacts(artifacts, payload.message),
    objectReferences: Array.isArray(payload.objectReferences) ? payload.objectReferences.filter(isRecord) : undefined,
  };
}

function normalizeAgentServerToolPayloadCandidate(value: unknown, depth = 0): unknown {
  if (depth > 4) return undefined;
  if (isToolPayload(value)) return value;
  if (typeof value === 'string') return normalizeAgentServerToolPayloadCandidate(extractJson(value), depth + 1);
  if (!isRecord(value)) return undefined;

  for (const key of ['payload', 'toolPayload', 'result', 'output', 'data']) {
    const nested = normalizeAgentServerToolPayloadCandidate(value[key], depth + 1);
    if (isToolPayload(nested)) return nested;
  }
  for (const key of ['markdown', 'report', 'text', 'finalText', 'handoffSummary', 'outputSummary']) {
    const nested = typeof value[key] === 'string'
      ? normalizeAgentServerToolPayloadCandidate(value[key], depth + 1)
      : undefined;
    if (isToolPayload(nested)) return nested;
  }

  const message = firstStringField(value, ['message', 'answer', 'summary', 'markdown', 'report', 'text', 'finalText', 'handoffSummary', 'outputSummary']);
  const artifacts = normalizeDirectAnswerArtifacts(normalizeWorkspaceTaskArtifacts(value.artifacts), message);
  const claims = normalizeAgentServerClaims(value.claims, message);
  const uiManifest = normalizeDirectAnswerUiManifest(value.uiManifest, artifacts);
  const executionUnits = normalizeAgentServerExecutionUnits(value.executionUnits);
  const objectReferences = Array.isArray(value.objectReferences) ? value.objectReferences.filter(isRecord) : undefined;
  const displayIntent = isRecord(value.displayIntent) ? value.displayIntent : undefined;

  if (!message || !claims.length || !uiManifest.length) return undefined;
  return {
    message,
    confidence: typeof value.confidence === 'number' ? value.confidence : 0.72,
    claimType: String(value.claimType || 'agentserver-answer'),
    evidenceLevel: String(value.evidenceLevel || 'agentserver'),
    reasoningTrace: String(value.reasoningTrace || 'AgentServer returned structured answer JSON; SciForge normalized it into a ToolPayload.'),
    claims,
    uiManifest,
    executionUnits,
    artifacts,
    displayIntent,
    objectReferences,
    verificationResults: normalizeRuntimeVerificationResultsOrUndefined(value.verificationResults ?? value.verificationResult),
    verificationPolicy: isRecord(value.verificationPolicy) ? value.verificationPolicy as unknown as ToolPayload['verificationPolicy'] : undefined,
  };
}

function strictToolPayloadCandidate(value: unknown, depth = 0): ToolPayload | undefined {
  if (depth > 4 || value === undefined || value === null) return undefined;
  if (isToolPayload(value)) return value;
  if (typeof value === 'string') return strictToolPayloadCandidate(extractJson(value), depth + 1);
  if (!isRecord(value)) return undefined;
  for (const key of ['payload', 'toolPayload', 'result', 'output', 'data']) {
    const nested = strictToolPayloadCandidate(value[key], depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

function extractNestedAgentServerPayloadFromText(text: string): ToolPayload | undefined {
  const parsed = extractJson(text);
  if (!isRecord(parsed)) return undefined;
  for (const key of ['markdown', 'report', 'message', 'text']) {
    const nested = typeof parsed[key] === 'string' ? coerceAgentServerToolPayload(extractJson(parsed[key])) : undefined;
    if (nested) return nested;
  }
  return undefined;
}

function firstStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return stripOuterJsonFence(value.trim());
  }
  return undefined;
}

function normalizeAgentServerClaims(value: unknown, message?: string): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    const claims = value.map((claim) => {
      if (typeof claim === 'string') return { text: claim, type: 'inference', confidence: 0.72, evidenceLevel: 'agentserver' };
      if (isRecord(claim)) return claim;
      return undefined;
    }).filter(isRecord);
    if (claims.length) return claims;
  }
  return [{
    text: (message || 'AgentServer completed the request.').split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 240) || 'AgentServer completed the request.',
    type: 'inference',
    confidence: 0.72,
    evidenceLevel: 'agentserver',
    supportingRefs: [],
    opposingRefs: [],
  }];
}

function normalizeAgentServerExecutionUnits(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    const units = value.map((unit) => isRecord(unit) ? unit : undefined).filter(isRecord);
    if (units.length) return units;
  }
  return [{
    id: `agentserver-direct-${sha1(JSON.stringify(value ?? {})).slice(0, 8)}`,
    status: 'done',
    tool: directAnswerResultPolicyIds.directTextTool,
    params: '{}',
  }];
}

function looksMostlyLikeCode(text: string) {
  const fenced = text.match(/```(?!json\b)(?:[a-zA-Z0-9_+-]+)?\s*([\s\S]*?)```/);
  const sample = fenced?.[1] ?? text;
  const lines = sample.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3) return false;
  const codeLike = lines.filter((line) => {
    return /^(?:import|export|from|def|class|function|const|let|var|if|for|while|try|catch|type|interface)\b/.test(line)
      || /^[{}[\]();,]+$/.test(line)
      || /(?:=>|===|!==|;\s*$|\{\s*$|\}\s*$)/.test(line)
      || /^#!\/|^python\s|^node\s|^npm\s|^tsx\s/.test(line);
  }).length;
  return codeLike / lines.length >= 0.45;
}

function stripOuterJsonFence(text: string) {
  return stripDirectAnswerJsonFence(text);
}

export function extractStandaloneJson(text: string): unknown {
  const stripped = stripOuterJsonFence(text).trim();
  if (!stripped.startsWith('{')) return undefined;
  try {
    return JSON.parse(stripped);
  } catch {
    return undefined;
  }
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] || text;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
