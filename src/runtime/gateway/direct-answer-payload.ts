import type { GatewayRequest, SciForgeSkillDomain, ToolPayload } from '../runtime-types.js';
import { expectedArtifactTypesForRequest } from './gateway-request.js';
import { clipForAgentServerJson, isRecord, toRecordList } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';
import { isToolPayload } from './tool-payload-contract.js';
import { normalizeRuntimeVerificationResultsOrUndefined } from './verification-results.js';

type ArtifactReferenceContextCollector = (request: GatewayRequest) => Promise<{ combinedArtifacts: Array<Record<string, unknown>> } | undefined>;
let artifactReferenceContextCollector: ArtifactReferenceContextCollector | undefined;

export function configureDirectAnswerArtifactContext(collector: ArtifactReferenceContextCollector) {
  artifactReferenceContextCollector = collector;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function artifactNeedsRepair(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const status = String(artifact.status || metadata.status || '').toLowerCase();
  const reason = String(artifact.failureReason || metadata.failureReason || '').toLowerCase();
  return status.includes('repair') || status.includes('fail') || /placeholder|missing|failed|repair/.test(reason);
}

export function toolPayloadFromPlainAgentOutput(text: string, request: GatewayRequest): ToolPayload {
  const structured = coerceAgentServerToolPayload(extractJson(text));
  if (structured) return ensureDirectAnswerReportArtifact(structured, request, 'agentserver-structured-answer');
  const nested = extractNestedAgentServerPayloadFromText(text);
  if (nested) return ensureDirectAnswerReportArtifact(nested, request, 'agentserver-structured-answer');
  const expected = expectedArtifactTypesForRequest(request);
  const artifacts: Array<Record<string, unknown>> = [];
  if (expected.includes('research-report') || /report|summary|报告|总结/.test(request.prompt.toLowerCase())) {
    artifacts.push({
      id: 'research-report',
      type: 'research-report',
      producerScenario: request.skillDomain,
      schemaVersion: '1',
      metadata: {
        source: 'agentserver-direct-text',
        note: 'AgentServer returned a natural-language answer instead of taskFiles; SciForge preserved it as a report artifact.',
      },
      data: {
        markdown: text,
        sections: [{ title: 'AgentServer Report', content: text }],
      },
    });
  }
  const reportRef = artifacts.some((artifact) => artifact.type === 'research-report') ? 'research-report' : `${request.skillDomain}-runtime-result`;
  return {
    message: text,
    confidence: 0.72,
    claimType: 'evidence-summary',
    evidenceLevel: 'agentserver-direct',
    reasoningTrace: 'AgentServer returned plain text; SciForge converted it into a ToolPayload so the work remains visible and auditable.',
    claims: [{
      text: text.split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 240) || 'AgentServer completed the request.',
      type: 'inference',
      confidence: 0.72,
      evidenceLevel: 'agentserver-direct',
      supportingRefs: [],
      opposingRefs: [],
    }],
    uiManifest: [
      { componentId: artifacts.length ? 'report-viewer' : 'execution-unit-table', artifactRef: reportRef, priority: 1 },
      { componentId: 'execution-unit-table', artifactRef: `${request.skillDomain}-runtime-result`, priority: 2 },
    ],
    executionUnits: [{
      id: `agentserver-direct-${sha1(text).slice(0, 8)}`,
      status: 'done',
      tool: 'agentserver.direct-text',
      params: JSON.stringify({ expectedArtifactTypes: expected, prompt: request.prompt.slice(0, 200) }),
    }],
    artifacts,
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
        source: stringField(isRecord(artifact.metadata) ? artifact.metadata.source : undefined) ?? 'existing-context',
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
  const needsReport = expected.includes('research-report') || /report|summary|报告|总结/.test(request.prompt.toLowerCase());
  if (!needsReport) return payload;
  const message = String(payload.message || '').trim();
  if (!message) return payload;
  const hasUsableReport = payload.artifacts.some((artifact) =>
    String(artifact.type || artifact.id || '') === 'research-report' && !artifactNeedsRepair(artifact)
  );
  if (hasUsableReport) return payload;
  const artifacts = [
    ...payload.artifacts.filter((artifact) =>
      !(String(artifact.type || artifact.id || '') === 'research-report' && artifactNeedsRepair(artifact))
    ),
    directAnswerReportArtifact(message, request.skillDomain, source),
  ];
  const uiManifest = payload.uiManifest.some((slot) => String(slot.componentId || '') === 'report-viewer')
    ? payload.uiManifest
    : [
      { componentId: 'report-viewer', artifactRef: 'research-report', priority: 1 },
      ...payload.uiManifest.map((slot, index) => ({
        ...slot,
        priority: typeof slot.priority === 'number' ? Math.max(slot.priority, index + 2) : index + 2,
      })),
    ];
  return {
    ...payload,
    artifacts,
    uiManifest,
  };
}

function directAnswerReportArtifact(message: string, skillDomain: SciForgeSkillDomain, source: string): Record<string, unknown> {
  return {
    id: 'research-report',
    type: 'research-report',
    producerScenario: skillDomain,
    schemaVersion: '1',
    metadata: {
      source,
      note: 'AgentServer returned a direct answer with user-visible content; SciForge preserved the answer as a report artifact instead of adding a repair placeholder.',
    },
    data: {
      markdown: message,
      report: message,
      sections: [{ title: 'AgentServer Answer', content: message }],
    },
  };
}

export function coerceAgentServerToolPayload(value: unknown): ToolPayload | undefined {
  const normalized = normalizeAgentServerToolPayloadCandidate(value);
  return isToolPayload(normalized) ? normalized : undefined;
}

export function coerceWorkspaceTaskPayload(value: unknown): ToolPayload | undefined {
  if (isToolPayload(value)) return normalizeToolPayloadShape(value);
  if (!isRecord(value)) return undefined;
  const strictNested = strictToolPayloadCandidate(value);
  if (strictNested) return normalizeToolPayloadShape(strictNested);
  const artifactPayload = coerceStandaloneArtifactPayload(value);
  if (artifactPayload) return artifactPayload;
  return undefined;
}

function coerceStandaloneArtifactPayload(value: Record<string, unknown>): ToolPayload | undefined {
  const type = stringField(value.type) ?? stringField(value.artifactType);
  if (!type) return undefined;
  if (type === 'tool-payload' || type === 'ToolPayload') return undefined;
  const id = stringField(value.id) ?? type;
  const entity = stringField(value.entity);
  const artifact = {
    ...value,
    id,
    type,
    schemaVersion: stringField(value.schemaVersion) ?? '1',
    data: isRecord(value.data) ? value.data : artifactDataFromLooseArtifact({ ...value, id, type }),
    metadata: {
      ...(isRecord(value.metadata) ? value.metadata : {}),
      source: stringField(isRecord(value.metadata) ? value.metadata.source : undefined) ?? 'workspace-task-artifact-json',
      wrappedAsToolPayload: true,
    },
  };
  const message = [
    entity,
    `${type} artifact generated from workspace task output.`,
  ].filter(Boolean).join(' ');
  return {
    message,
    confidence: typeof value.confidence === 'number' ? value.confidence : 0.72,
    claimType: String(value.claimType || 'artifact-generation'),
    evidenceLevel: String(value.evidenceLevel || 'workspace-artifact'),
    reasoningTrace: 'Workspace task returned a standalone artifact JSON; SciForge wrapped it into a ToolPayload for display, persistence, and follow-up reuse.',
    claims: [{
      id: `${id}-claim`,
      text: message,
      type: 'fact',
      confidence: typeof value.confidence === 'number' ? value.confidence : 0.72,
      evidenceLevel: String(value.evidenceLevel || 'workspace-artifact'),
      supportingRefs: [id],
      opposingRefs: [],
    }],
    uiManifest: [{
      componentId: componentForStandaloneArtifact(type),
      artifactRef: id,
      priority: 1,
    }],
    executionUnits: [{
      id: `${id}-workspace-artifact-json`,
      status: 'done',
      tool: 'workspace-task.artifact-json',
    }],
    artifacts: [artifact],
  };
}

function componentForStandaloneArtifact(type: string) {
  const normalized = type.toLowerCase();
  if (normalized === 'research-report') return 'report-viewer';
  if (normalized === 'paper-list') return 'paper-card-list';
  if (normalized === 'knowledge-graph') return 'graph-viewer';
  if (normalized === 'structure-summary') return 'structure-viewer';
  if (normalized === 'evidence-matrix') return 'evidence-matrix';
  if (normalized === 'notebook-timeline') return 'notebook-timeline';
  if (normalized === 'data-table') return 'record-table';
  return 'unknown-artifact-inspector';
}

export function normalizeToolPayloadShape(payload: ToolPayload): ToolPayload {
  return {
    ...payload,
    executionUnits: normalizeAgentServerExecutionUnits(payload.executionUnits),
    artifacts: normalizeAgentServerArtifacts(payload.artifacts, payload.message),
    objectReferences: Array.isArray(payload.objectReferences) ? payload.objectReferences.filter(isRecord) : undefined,
    displayIntent: isRecord(payload.displayIntent) ? payload.displayIntent : undefined,
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
  const artifacts = normalizeAgentServerArtifacts(value.artifacts, message);
  const claims = normalizeAgentServerClaims(value.claims, message);
  const uiManifest = normalizeAgentServerUiManifest(value.uiManifest, artifacts);
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

function normalizeAgentServerUiManifest(value: unknown, artifacts: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    const manifest = value.map((slot) => isRecord(slot) ? slot : undefined).filter(isRecord);
    if (manifest.length) return manifest;
  }
  if (isRecord(value) && Array.isArray(value.components)) {
    const primaryArtifact = String(artifacts[0]?.id || artifacts[0]?.type || 'research-report');
    const manifest = value.components
      .filter((component): component is string => typeof component === 'string' && component.trim().length > 0)
      .map((componentId, index) => ({ componentId, artifactRef: primaryArtifact, priority: index + 1 }));
    if (manifest.length) return manifest;
  }
  if (artifacts.some((artifact) => artifact.type === 'research-report')) {
    return [{ componentId: 'report-viewer', artifactRef: 'research-report', priority: 1 }];
  }
  return [{ componentId: 'execution-unit-table', artifactRef: 'agentserver-runtime-result', priority: 1 }];
}

function normalizeAgentServerExecutionUnits(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    const units = value.map((unit) => isRecord(unit) ? unit : undefined).filter(isRecord);
    if (units.length) return units;
  }
  return [{
    id: `agentserver-direct-${sha1(JSON.stringify(value ?? {})).slice(0, 8)}`,
    status: 'done',
    tool: 'agentserver.direct-text',
    params: '{}',
  }];
}

function normalizeAgentServerArtifacts(value: unknown, message?: string): Array<Record<string, unknown>> {
  const artifacts = Array.isArray(value) ? value.map((artifact) => isRecord(artifact) ? artifact : undefined).filter(isRecord) : [];
  if (!artifacts.length && message) {
    return [{
      id: 'research-report',
      type: 'research-report',
      schemaVersion: '1',
      metadata: { source: 'agentserver-structured-answer' },
      data: {
        markdown: message,
        sections: [{ title: 'AgentServer Report', content: message }],
      },
    }];
  }
  return artifacts.map((artifact) => {
    const type = String(artifact.type || artifact.artifactType || artifact.id || '');
    const id = String(artifact.id || type || 'artifact');
    const normalizedArtifact = {
      ...artifact,
      id,
      type,
    };
    const data = isRecord(artifact.data) ? artifact.data : artifactDataFromLooseArtifact(normalizedArtifact);
    if (type !== 'research-report') {
      return Object.keys(data).length ? { ...normalizedArtifact, data } : normalizedArtifact;
    }
    if (isRecord(artifact.data)) return normalizedArtifact;
    return {
      ...normalizedArtifact,
      data: {
        ...data,
        markdown: message || String(artifact.dataRef || artifact.id || ''),
        sections: [{ title: String(isRecord(artifact.metadata) ? artifact.metadata.title || 'AgentServer Report' : 'AgentServer Report'), content: message || '' }],
      },
    };
  });
}

function artifactDataFromLooseArtifact(artifact: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(artifact)) {
    if (['id', 'type', 'artifactType', 'schemaVersion', 'metadata', 'dataRef', 'visibility', 'audience', 'sensitiveDataFlags', 'exportPolicy'].includes(key)) continue;
    data[key] = value;
  }
  return data;
}

function stripOuterJsonFence(text: string) {
  const fenced = text.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() || text;
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
