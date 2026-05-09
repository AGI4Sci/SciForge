import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { clipForAgentServerJson, isRecord, toRecordList, toStringList, uniqueStrings } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';

export function directContextFastPathPayload(request: GatewayRequest): ToolPayload | undefined {
  if (request.agentServerBaseUrl) return undefined;
  if (!policyRequestsDirectContext(request)) return undefined;
  const context = directContextItems(request);
  if (!context.length) return undefined;
  const refLines = context.slice(0, 8).map((item, index) => `${index + 1}. ${item.label}: ${item.summary}${item.ref ? ` (${item.ref})` : ''}`);
  const message = [
    '基于当前会话已有上下文直接回答，不启动新的 workspace task。',
    ...refLines,
  ].join('\n');
  const reportId = 'direct-context-summary';
  return {
    message,
    confidence: 0.74,
    claimType: 'context-summary',
    evidenceLevel: 'current-session-context',
    reasoningTrace: [
      'Python conversation-policy selected direct-context-answer.',
      'SciForge executed the direct-context fast path from existing artifacts, references, and execution refs only.',
    ].join('\n'),
    claims: [{
      id: 'direct-context-claim',
      text: context[0]?.summary ?? 'Existing session context is available.',
      type: 'fact',
      confidence: 0.74,
      evidenceLevel: 'current-session-context',
      supportingRefs: uniqueStrings(context.map((item) => item.ref).filter((ref): ref is string => Boolean(ref))),
      opposingRefs: [],
    }],
    uiManifest: [
      { componentId: 'report-viewer', artifactRef: reportId, priority: 1 },
      { componentId: 'execution-unit-table', artifactRef: 'direct-context-fast-path', priority: 2 },
    ],
    executionUnits: [{
      id: `EU-direct-context-${sha1(JSON.stringify(context)).slice(0, 8)}`,
      tool: 'sciforge.direct-context-fast-path',
      params: JSON.stringify({
        policy: 'python-conversation-policy',
        contextItemCount: context.length,
      }),
      status: 'done',
      hash: sha1(message).slice(0, 16),
      outputRef: 'runtime://direct-context-fast-path',
    }],
    artifacts: [{
      id: reportId,
      type: 'research-report',
      producerScenario: request.skillDomain,
      schemaVersion: '1',
      metadata: {
        source: 'direct-context-fast-path',
        policyOwner: 'python-conversation-policy',
        contextItemCount: context.length,
      },
      data: {
        markdown: message,
        context,
      },
    }],
    objectReferences: context
      .filter((item) => item.ref)
      .map((item, index) => ({
        id: `obj-direct-context-${index + 1}`,
        kind: item.kind,
        title: item.label,
        ref: item.ref,
        status: 'available',
        summary: item.summary,
      })),
  };
}

function policyRequestsDirectContext(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const conversationPolicy = isRecord(uiState.conversationPolicy) ? uiState.conversationPolicy : {};
  const execution = isRecord(uiState.executionModePlan)
    ? uiState.executionModePlan
    : isRecord(conversationPolicy.executionModePlan)
      ? conversationPolicy.executionModePlan
      : isRecord(uiState.executionModeDecision)
      ? uiState.executionModeDecision
      : {};
  const responsePlan = isRecord(uiState.responsePlan) ? uiState.responsePlan : {};
  const latencyPolicy = isRecord(uiState.latencyPolicy) ? uiState.latencyPolicy : {};
  const mode = stringField(execution.executionMode) ?? stringField(execution.executionModeRecommendation);
  const initialMode = stringField(responsePlan.initialResponseMode);
  return mode === 'direct-context-answer'
    && (initialMode === undefined || initialMode === 'direct-context-answer')
    && latencyPolicy.blockOnContextCompaction !== true;
}

function directContextItems(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const items: Array<{ kind: string; label: string; ref?: string; summary: string }> = [];
  for (const artifact of [...request.artifacts, ...toRecordList(uiState.artifacts)].filter(isRecord).slice(-12)) {
    const id = stringField(artifact.id) ?? stringField(artifact.type) ?? 'artifact';
    const type = stringField(artifact.type) ?? stringField(artifact.artifactType) ?? 'artifact';
    const ref = stringField(artifact.dataRef) ?? stringField(artifact.path) ?? `artifact:${id}`;
    items.push({
      kind: 'artifact',
      label: `${type} ${id}`,
      ref,
      summary: artifactSummary(artifact),
    });
  }
  for (const reference of [
    ...toRecordList(request.references),
    ...toRecordList(uiState.currentReferences),
  ].slice(-12)) {
    const ref = stringField(reference.ref);
    items.push({
      kind: stringField(reference.kind) ?? 'file',
      label: stringField(reference.title) ?? ref ?? 'reference',
      ref,
      summary: stringField(reference.summary) ?? ref ?? 'current reference',
    });
  }
  for (const unit of [
    ...toRecordList(uiState.recentExecutionRefs),
    ...toRecordList(uiState.executionUnits),
  ].slice(-8)) {
    const id = stringField(unit.id) ?? 'execution-unit';
    const refs = uniqueStrings([
      stringField(unit.codeRef),
      stringField(unit.outputRef),
      stringField(unit.stdoutRef),
      stringField(unit.stderrRef),
    ].filter((ref): ref is string => Boolean(ref)));
    items.push({
      kind: 'execution-unit',
      label: id,
      ref: refs[0] ?? `execution-unit:${id}`,
      summary: refs.length ? refs.join('; ') : stringField(unit.status) ?? 'prior execution ref',
    });
  }
  return dedupeContextItems(items);
}

function artifactSummary(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const candidates = [
    artifact.summary,
    metadata.summary,
    metadata.title,
    dataPreview(artifact.data),
    artifact.dataRef,
    artifact.path,
  ];
  return candidates.map(stringField).find(Boolean) ?? JSON.stringify(clipForAgentServerJson(artifact, 2)).slice(0, 240);
}

function dataPreview(value: unknown) {
  if (typeof value === 'string') return value.slice(0, 240);
  if (!isRecord(value)) return undefined;
  const markdown = stringField(value.markdown) ?? stringField(value.report) ?? stringField(value.text);
  if (markdown) return markdown.replace(/\s+/g, ' ').slice(0, 240);
  const keys = Object.keys(value).slice(0, 8);
  return keys.length ? `fields: ${keys.join(', ')}` : undefined;
}

function dedupeContextItems(items: Array<{ kind: string; label: string; ref?: string; summary: string }>) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.ref ?? `${item.kind}:${item.label}:${item.summary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
