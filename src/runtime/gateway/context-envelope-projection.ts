import { clipForAgentServerJson, clipForAgentServerPrompt, isRecord, toRecordList, toStringList } from '../gateway-utils.js';

export function contextProjectionForEnvelope(uiState: Record<string, unknown>) {
  const usedLegacyProjection = !isRecord(uiState.contextProjection) && isRecord(uiState.handoffMemoryProjection);
  const source = isRecord(uiState.contextProjection)
    ? uiState.contextProjection
    : isRecord(uiState.handoffMemoryProjection)
      ? uiState.handoffMemoryProjection
      : undefined;
  if (!source) return undefined;
  const selectedMessageRefs = toRecordList(source.selectedMessageRefs ?? source.recentConversation)
    .slice(-4)
    .map((entry) => ({
      id: stringField(entry.id),
      role: stringField(entry.role),
      summary: clipForAgentServerPrompt(entry.summary, 240),
      refs: toStringList(entry.refs).slice(0, 8),
    }))
    .filter((entry) => entry.id || entry.role || entry.summary || entry.refs.length);
  const selectedRunRefs = toRecordList(source.selectedRunRefs ?? source.recentRuns)
    .slice(-4)
    .map((entry) => ({
      id: stringField(entry.id) ?? stringField(entry.runId),
      status: stringField(entry.status),
      summary: clipForAgentServerPrompt(entry.summary, 240),
      refs: toStringList(entry.refs).slice(0, 8),
    }))
    .filter((entry) => entry.id || entry.status || entry.summary || entry.refs.length);
  const workspaceKernel = workspaceKernelProjectionForEnvelope(source);
  const agentServerContextRequest = isRecord(source.agentServerContextRequest)
    ? source.agentServerContextRequest
    : undefined;
  return {
    schemaVersion: 'sciforge.context-projection-envelope.v1',
    source: !usedLegacyProjection
      ? 'conversation-policy.context-projection'
      : 'migration:legacy-handoff-memory-projection',
    migrationAlias: usedLegacyProjection ? {
      from: 'handoffMemoryProjection',
      to: 'contextProjection',
      scope: 'historical-ui-state-read',
    } : undefined,
    authority: 'workspaceKernel refs are canonical truth; AgentServer consumes contextRefs, capabilityBriefRef, and cachePlan',
    mode: stringField(source.mode),
    workspaceKernel,
    contextProjectionBlocks: toRecordList(source.contextProjectionBlocks)
      .slice(0, 8)
      .map((entry) => ({
        blockId: stringField(entry.blockId),
        kind: stringField(entry.kind),
        sha256: stringField(entry.sha256),
        tokenEstimate: typeof entry.tokenEstimate === 'number' ? entry.tokenEstimate : undefined,
        cacheTier: stringField(entry.cacheTier),
        sourceEventIds: toStringList(entry.sourceEventIds).slice(0, 16),
        supersedes: toStringList(entry.supersedes).slice(0, 16),
      })),
    stablePrefixHash: stringField(source.stablePrefixHash),
    contextRefs: contextRefListForEnvelope(source.contextRefs ?? agentServerContextRequest?.contextRefs).slice(0, 64),
    capabilityBriefRef: memoryRefForEnvelope(source.capabilityBriefRef ?? agentServerContextRequest?.capabilityBriefRef),
    cachePlan: cachePlanForEnvelope(source.cachePlan ?? agentServerContextRequest?.cachePlan),
    selectedContextRefs: toStringList(source.selectedContextRefs).slice(0, 32),
    retrievalTools: toStringList(source.retrievalTools).slice(0, 8),
    selectedMessageRefs: selectedMessageRefs.length ? selectedMessageRefs : undefined,
    selectedRunRefs: selectedRunRefs.length ? selectedRunRefs : undefined,
    currentReferenceFocus: toStringList(source.currentReferenceFocus).slice(0, 12),
    pollutionGuard: isRecord(source.pollutionGuard) ? clipForAgentServerJson(source.pollutionGuard, 2) : undefined,
  };
}

function workspaceKernelProjectionForEnvelope(source: Record<string, unknown>) {
  const kernel = isRecord(source.workspaceKernel)
    ? source.workspaceKernel
    : isRecord(source.workspaceLedger)
      ? source.workspaceLedger
      : isRecord(source.projectSessionMemory)
        ? source.projectSessionMemory
        : undefined;
  return kernel ? clipForAgentServerJson(kernel, 4) : undefined;
}

function contextRefListForEnvelope(value: unknown) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (typeof entry === 'string' && entry) return [entry];
      if (!isRecord(entry)) return [];
      return memoryRefForEnvelope(entry) ?? [];
    });
  }
  return [];
}

function cachePlanForEnvelope(value: unknown) {
  if (!isRecord(value)) return undefined;
  const stablePrefixRefs = contextRefListForEnvelope(value.stablePrefixRefs);
  const perTurnPayloadRefs = contextRefListForEnvelope(value.perTurnPayloadRefs);
  if (!stablePrefixRefs.length && !perTurnPayloadRefs.length) return undefined;
  return {
    stablePrefixRefs,
    perTurnPayloadRefs,
  };
}

function memoryRefForEnvelope(value: unknown) {
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

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
