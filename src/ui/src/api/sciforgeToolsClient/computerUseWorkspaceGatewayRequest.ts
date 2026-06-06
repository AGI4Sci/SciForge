import type { SendAgentMessageInput } from '../../domain';

const COMPUTER_USE_ACTION_PROVIDER_ID = 'action.sciforge.computer-use';
const COMPLETION_EVIDENCE_POLICY_SCHEMA = 'sciforge.completion-evidence-policy.v1';
const EMBEDDED_L3_COMPLETION_EVIDENCE_PRODUCER_ID = 'computer-use.embedded-isolated-desktop-l3';
const ON_COMPLETED_CURRENT_RUN_TRIGGER = 'on-completed-current-run';
const LEGACY_WORKSPACE_GATEWAY_SHIM_SCHEMA = 'sciforge.computer-use.legacy-workspace-gateway-diagnostic.v1';
const LEGACY_WORKSPACE_GATEWAY_FLAG = '--legacy-workspace-gateway';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return out.length ? out : undefined;
}

function uniqueRuntimeStringList(values: unknown[]) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

export function sanitizedCompletionEvidencePolicy(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || value.schemaVersion !== COMPLETION_EVIDENCE_POLICY_SCHEMA) return undefined;
  const producers = Array.isArray(value.producers)
    ? value.producers.flatMap((producer) => {
      if (!isRecord(producer)) return [];
      if (producer.id !== EMBEDDED_L3_COMPLETION_EVIDENCE_PRODUCER_ID) return [];
      if (producer.enabled !== true) return [];
      if (producer.trigger !== ON_COMPLETED_CURRENT_RUN_TRIGGER) return [];
      return [{
        id: EMBEDDED_L3_COMPLETION_EVIDENCE_PRODUCER_ID,
        enabled: true,
        trigger: ON_COMPLETED_CURRENT_RUN_TRIGGER,
      }];
    })
    : [];
  if (!producers.length) return undefined;
  return {
    schemaVersion: COMPLETION_EVIDENCE_POLICY_SCHEMA,
    producers,
  };
}

export function sanitizedComputerUseTaskBindings(scenarioOverride: unknown): {
  computerUseNext?: Record<string, unknown>;
  computerUseLong?: Record<string, unknown>;
} | undefined {
  if (!isRecord(scenarioOverride)) return undefined;
  const computerUseNext = sanitizedComputerUseNext(scenarioOverride.computerUseNext);
  const computerUseLong = sanitizedComputerUseLong(scenarioOverride.computerUseLong);
  if (!computerUseNext && !computerUseLong) return undefined;
  return {
    ...(computerUseNext ? { computerUseNext } : {}),
    ...(computerUseLong ? { computerUseLong } : {}),
  };
}

function sanitizedComputerUseNext(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const safetyBoundary = sanitizedBooleanRecord(value.safetyBoundary);
  const out = compactRecord({
    taskId: asString(value.taskId),
    scenarioId: asString(value.scenarioId),
    title: asString(value.title),
    requirements: asStringArray(value.requirements),
    ...(safetyBoundary ? { safetyBoundary } : {}),
  });
  return Object.keys(out).length ? out : undefined;
}

function sanitizedComputerUseLong(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const safetyBoundary = sanitizedBooleanRecord(value.safetyBoundary);
  const out = compactRecord({
    taskId: asString(value.taskId),
    scenarioId: asString(value.scenarioId),
    title: asString(value.title),
    requirements: asStringArray(value.requirements),
    ...(safetyBoundary ? { safetyBoundary } : {}),
  });
  return Object.keys(out).length ? out : undefined;
}

function sanitizedBooleanRecord(value: unknown): Record<string, boolean> | undefined {
  if (!isRecord(value)) return undefined;
  const out = Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, boolean] => (
      /^[a-zA-Z][a-zA-Z0-9_]*$/.test(entry[0])
      && typeof entry[1] === 'boolean'
    )),
  );
  return Object.keys(out).length ? out : undefined;
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => {
    if (item === undefined || item === null) return false;
    if (Array.isArray(item) && item.length === 0) return false;
    return true;
  }));
}

export function computerUseTerminalEquivalentTextRequested(input: SendAgentMessageInput) {
  if (/^\/(?:computer-use|computer\s+use)\b/i.test(input.prompt.trim())) return true;
  const scenario = input.scenarioOverride;
  return [
    ...(scenario?.selectedActionIds ?? []),
    ...(scenario?.selectedToolIds ?? []),
  ].includes(COMPUTER_USE_ACTION_PROVIDER_ID);
}

export function computerUseWorkspaceGatewayDiagnosticRequested(input: SendAgentMessageInput) {
  const prompt = input.prompt.trim();
  if (!/^\/(?:computer-use|computer\s+use)\b/i.test(prompt)) return false;
  return new RegExp(`(^|\\s)${escapeRegex(LEGACY_WORKSPACE_GATEWAY_FLAG)}(?:\\s|$|=true\\b)`, 'i').test(prompt)
    || /^\/(?:computer-use|computer\s+use)\s+(?:diagnostic|diagnostics|diagnose|legacy-gateway|gateway-diagnostic)\b/i.test(prompt);
}

export function buildComputerUseWorkspaceGatewayRequest(input: SendAgentMessageInput, commandId: string) {
  const scenario = input.scenarioOverride;
  const approvalRef = approvalRefFromComputerUsePrompt(input.prompt);
  const approvalProvenance = approvalRef ? approvalProvenanceFromComputerUseRuns(input.runs, approvalRef) : undefined;
  const humanApproval = approvalRef ? {
    approvalRef,
    ...(approvalProvenance ? { approvalProvenance } : {}),
  } : undefined;
  const completionEvidencePolicy = sanitizedCompletionEvidencePolicy(scenario?.completionEvidencePolicy);
  const taskBindings = sanitizedComputerUseTaskBindings(scenario);
  const terminalEquivalentText = input.prompt.trim();
  return {
    schemaVersion: LEGACY_WORKSPACE_GATEWAY_SHIM_SCHEMA,
    kind: 'legacy-diagnostic-shim',
    diagnosticOnly: true,
    prompt: terminalEquivalentText,
    terminalEquivalentText,
    handoffSource: 'ui-chat-legacy-diagnostic-shim',
    workspacePath: input.config.workspacePath,
    humanApproval,
    diagnosticBoundary: {
      officialPath: 'terminal-equivalent text -> Codex app-server/CLI/native Computer Use plugin/tool or module.invoke({ moduleId: "actions", intent: "execute" })',
      gatewayRole: 'legacy diagnostic shim',
      guiOwnsExecutor: false,
      guiOwnsExecutionRoute: false,
    },
    projectionSummary: {
      currentTurnId: input.currentTurnId,
      referenceCount: input.references?.length ?? 0,
      artifactCount: input.artifacts?.length ?? 0,
      runCount: input.runs?.length ?? 0,
      completionEvidencePolicyPresent: Boolean(completionEvidencePolicy),
    },
    uiState: {
      commandId,
      currentTurnId: input.currentTurnId,
      diagnosticOnly: true,
      legacyWorkspaceGatewayShim: true,
      terminalEquivalentText,
      humanApproval,
      approvalRef,
      approvalProvenance,
      completionEvidencePolicy,
      ...(taskBindings ?? {}),
      guiOwnsExecutor: false,
      guiOwnsExecutionRoute: false,
    },
  };
}

function approvalRefFromComputerUsePrompt(prompt: string) {
  if (!/^\/(?:computer-use|computer\s+use)\b/i.test(prompt.trim()) || !/(?:^|\s)approve(?:\s|$)/i.test(prompt.trim())) return undefined;
  const match = /--approval-ref(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/i.exec(prompt);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function approvalProvenanceFromComputerUseRuns(runs: SendAgentMessageInput['runs'], approvalRef: string) {
  for (const run of [...(runs ?? [])].reverse()) {
    if (!isRecord(run)) continue;
    const raw = isRecord(run.raw) ? run.raw : {};
    const guiAskUser = isRecord(raw.guiAskUser) ? raw.guiAskUser : undefined;
    if (!guiAskUser) continue;
    const approvalRequest = isRecord(guiAskUser?.approvalRequest) ? guiAskUser.approvalRequest : undefined;
    if (!approvalRequest || approvalRefFromApprovalRequest(approvalRequest) !== approvalRef) continue;
    const guiPresentation = isRecord(raw.guiPresentation) ? raw.guiPresentation : undefined;
    const displayIntent = isRecord(raw.displayIntent) ? raw.displayIntent : undefined;
    const projection = isRecord(displayIntent?.conversationProjection) ? displayIntent.conversationProjection : undefined;
    const artifacts = Array.isArray(projection?.artifacts) ? projection.artifacts.filter(isRecord) : [];
    const relatedRefs = uniqueRuntimeStringList([
      ...(asStringArray(guiAskUser.relatedRefs) ?? []),
      ...(asStringArray(guiAskUser.displayedRefs) ?? []),
    ]);
    const presentedRefs = uniqueRuntimeStringList([
      ...(asStringArray(guiPresentation?.displayedRefs) ?? []),
      ...artifacts.map((artifact) => asString(artifact.ref)),
    ]);
    const auditRefs = asStringArray(projection?.auditRefs) ?? [];
    const sourceRefs = approvalSourceRefsFromComputerUseRefs([
      ...relatedRefs,
      ...presentedRefs,
      ...auditRefs,
    ]);
    const approvalRequestSidecar = recordField(raw, 'approvalRequestSidecar') ?? recordField(guiAskUser, 'approvalRequestSidecar');
    const guiAskUserSidecar = recordField(raw, 'guiAskUserSidecar') ?? recordField(guiAskUser, 'guiAskUserSidecar');
    const riskAuditSidecar = recordField(raw, 'riskAuditSidecar') ?? recordField(guiAskUser, 'riskAuditSidecar');
    const riskAuditHighRiskAction = recordField(riskAuditSidecar, 'highRiskAction');
    return {
      schemaVersion: 'sciforge.computer-use.approval-provenance.v1',
      source: 'prior-gui-ask-user',
      approvalRef,
      sourceRunId: asString(run.id),
      guiAskUserSource: asString(guiAskUser.source),
      guiPresentSource: asString(guiPresentation?.source),
      approvalRequest,
      relatedRefs,
      presentedRefs,
      auditRefs,
      sourceApprovalRequestRef: sourceRefs.sourceApprovalRequestRef,
      sourceGuiAskUserRecordRef: sourceRefs.sourceGuiAskUserRecordRef,
      sourceRiskAuditRef: sourceRefs.sourceRiskAuditRef,
      approvalRequestSidecar,
      guiAskUserSidecar,
      riskAuditSidecar,
      riskActionHash: asString(approvalRequest.riskActionHash)
        ?? asString(approvalRequest.risk_action_hash)
        ?? asString(recordField(approvalRequest, 'metadata')?.riskActionHash)
        ?? asString(approvalRequestSidecar?.riskActionHash)
        ?? asString(guiAskUserSidecar?.riskActionHash)
        ?? asString(riskAuditSidecar?.riskActionHash),
      highRiskAction: riskAuditHighRiskAction,
    };
  }
  return undefined;
}

function approvalRefFromApprovalRequest(approvalRequest: Record<string, unknown>) {
  return asString(approvalRequest.approvalRef)
    ?? asString(approvalRequest.approval_ref)
    ?? asString(approvalRequest.id);
}

function approvalSourceRefsFromComputerUseRefs(refs: string[]) {
  return {
    sourceApprovalRequestRef: refs.find((ref) => /(?:^|\/)approval-request\.json$/i.test(ref)),
    sourceGuiAskUserRecordRef: refs.find((ref) => /(?:^|\/)gui-ask-user\.json$/i.test(ref)),
    sourceRiskAuditRef: refs.find((ref) => /(?:^|\/)risk-audit\.json$/i.test(ref)),
  };
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return isRecord(value[key]) ? value[key] : undefined;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
