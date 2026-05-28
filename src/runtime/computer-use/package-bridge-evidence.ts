import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { ToolPayload } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import type { ComputerUseConfig } from './types.js';
import {
  COMPUTER_USE_ACTION_PROVIDER_ID,
  COMPUTER_USE_TUI_HOST_ACTIONS_SCHEMA,
  type ComputerUseTuiHostAction,
  computerUseHostPortsContract,
} from './host-adapter.js';
import { workspaceRel } from './utils.js';

const TUI_HOST_RUN_TASK_CHAIN_SCHEMA = 'sciforge.computer-use.tui-host-run-task-chain.v1';

type PackageBridgeEvidenceState = {
  runId: string;
  runDir: string;
  tracePath?: string;
  screenshotLedger: Array<{ id: string; path: string }>;
  visibleArtifacts: Array<{ artifactRef: string }>;
};

export async function writePackageBridgeEvidenceFiles(params: {
  actionProviderRequest: Record<string, unknown>;
  config: ComputerUseConfig;
  packageResult: Record<string, unknown>;
  payload: ToolPayload;
  state: PackageBridgeEvidenceState;
  workspace: string;
  tuiHostActions: ComputerUseTuiHostAction[];
}) {
  const guiPresent = params.tuiHostActions.find((action) => action.port === 'gui.present');
  const guiAskUser = params.tuiHostActions.find((action) => action.port === 'gui.ask_user');
  const sidecars = buildPackageBridgeEvidenceSidecars({
    actionProviderRequest: params.actionProviderRequest,
    packageResult: params.packageResult,
    payload: params.payload,
    state: params.state,
    workspace: params.workspace,
    guiPresent,
    guiAskUser,
  });
  const tuiHostRunTaskChain = buildPackageBridgeTuiHostRunTaskChain({
    actionProviderRequest: params.actionProviderRequest,
    config: params.config,
    payload: params.payload,
    sidecars,
    state: params.state,
    workspace: params.workspace,
    guiPresent,
    guiAskUser,
  });
  const writes: Array<Promise<void>> = [
    writeJson(join(params.state.runDir, 'computer-use-request.json'), params.actionProviderRequest),
    writeJson(join(params.state.runDir, 'host-ports.json'), computerUseHostPortsContract(params.config)),
    writeJson(join(params.state.runDir, 'tool-payload.json'), params.payload),
    writeJson(tuiHostRunTaskChainPath(params.state.runDir), tuiHostRunTaskChain),
    writeJson(join(params.state.runDir, 'directory-listing.json'), sidecars.directoryListing),
  ];
  if (guiPresent) writes.push(writeJson(join(params.state.runDir, 'gui-present.json'), guiPresent));
  if (sidecars.guiAskUser || guiAskUser) writes.push(writeJson(join(params.state.runDir, 'gui-ask-user.json'), sidecars.guiAskUser ?? guiAskUser));
  if (sidecars.approvalRequest) writes.push(writeJson(join(params.state.runDir, 'approval-request.json'), sidecars.approvalRequest));
  if (sidecars.riskAudit) writes.push(writeJson(join(params.state.runDir, 'risk-audit.json'), sidecars.riskAudit));
  if (sidecars.confirmedRequest) writes.push(writeJson(join(params.state.runDir, 'confirmed-request.json'), sidecars.confirmedRequest));
  if (sidecars.sourceApprovalRequest) writes.push(writeJson(join(params.state.runDir, 'approval-source-request.json'), sidecars.sourceApprovalRequest));
  if (sidecars.sourceGuiAskUser) writes.push(writeJson(join(params.state.runDir, 'approval-source-gui-ask-user.json'), sidecars.sourceGuiAskUser));
  if (sidecars.sourceRiskAudit) writes.push(writeJson(join(params.state.runDir, 'approval-source-risk-audit.json'), sidecars.sourceRiskAudit));
  if (sidecars.approvalDecision) writes.push(writeJson(join(params.state.runDir, 'approval-decision.json'), sidecars.approvalDecision));
  if (sidecars.blockedManifest) writes.push(writeJson(join(params.state.runDir, 'blocked-manifest.json'), sidecars.blockedManifest));
  if (sidecars.repairHint) writes.push(writeJson(join(params.state.runDir, 'repair-hint.json'), sidecars.repairHint));
  if (sidecars.continuationRequest) writes.push(writeJson(join(params.state.runDir, 'continuation-request.json'), sidecars.continuationRequest));
  await Promise.all(writes);
}

export function tuiHostRunTaskChainPath(runDir: string) {
  return join(runDir, 'tui-host-run-task-chain.json');
}

export type PackageBridgeEvidenceSidecars = {
  guiAskUser?: Record<string, unknown>;
  approvalRequest?: Record<string, unknown>;
  riskAudit?: Record<string, unknown>;
  confirmedRequest?: Record<string, unknown>;
  sourceApprovalRequest?: Record<string, unknown>;
  sourceGuiAskUser?: Record<string, unknown>;
  sourceRiskAudit?: Record<string, unknown>;
  approvalDecision?: Record<string, unknown>;
  blockedManifest?: Record<string, unknown>;
  repairHint?: Record<string, unknown>;
  continuationRequest?: Record<string, unknown>;
  directoryListing: Record<string, unknown>;
};

export function buildPackageBridgeEvidenceSidecars(params: {
  actionProviderRequest: Record<string, unknown>;
  packageResult: Record<string, unknown>;
  payload: ToolPayload;
  state: PackageBridgeEvidenceState;
  workspace: string;
  guiPresent?: ComputerUseTuiHostAction;
  guiAskUser?: ComputerUseTuiHostAction;
}): PackageBridgeEvidenceSidecars {
  const ref = (name: string) => workspaceRel(params.workspace, join(params.state.runDir, name));
  const resultStatus = stringAt(params.packageResult, 'status') ?? String(params.payload.executionUnits?.[0]?.status ?? 'unknown');
  const approvalRef = stringAt(params.actionProviderRequest, 'approvalRef')
    ?? stringAt(params.actionProviderRequest, 'approval_ref')
    ?? stringAt(recordAt(params.actionProviderRequest, 'metadata'), 'approvalRef');
  const approvalProvenance = approvalProvenanceFromActionProviderRequest(params.actionProviderRequest);
  const createdAt = new Date().toISOString();
  const highRiskAction = highRiskActionFromPackageResult(params.packageResult);
  const directApprovalRequest = approvalRequestFromPackageBridge(params.packageResult, params.guiAskUser);
  const approvalRequest = directApprovalRequest
    ?? approvalRequestFromApprovalProvenance(approvalProvenance)
    ?? approvalRequestFromConfirmedBridge({
      approvalRef,
      highRiskAction,
      actionProviderRequest: params.actionProviderRequest,
    });
  const guiAskUserAction = params.guiAskUser
    ?? guiAskUserActionFromApprovalProvenance(approvalProvenance, approvalRequest)
    ?? syntheticGuiAskUserAction({
      approvalRequest,
      approvalRef,
      relatedRefs: [ref('vision-trace.json'), ref('computer-use-request.json')],
    });
  const approvalRequestId = approvalRequestIdFromPackageBridge(approvalRequest) ?? approvalRef;
  const canonicalApprovalRef = approvalRef ?? approvalRequestId;
  const riskActionHash = approvalRiskActionHash({
    actionProviderRequest: params.actionProviderRequest,
    approvalRequest,
    approvalProvenance,
    highRiskAction,
    approvalRequestId,
  });
  const approvalSidecarRefs = {
    approvalRequestRef: approvalRequest ? ref('approval-request.json') : undefined,
    guiAskUserRecordRef: guiAskUserAction ? ref('gui-ask-user.json') : undefined,
    confirmedRequestRef: approvalRef ? ref('confirmed-request.json') : undefined,
    riskAuditRef: approvalRequest || approvalRef ? ref('risk-audit.json') : undefined,
    sourceApprovalRequestRef: approvalProvenance ? ref('approval-source-request.json') : undefined,
    sourceGuiAskUserRecordRef: approvalProvenance ? ref('approval-source-gui-ask-user.json') : undefined,
    sourceRiskAuditRef: approvalProvenance ? ref('approval-source-risk-audit.json') : undefined,
    approvalDecisionRef: approvalProvenance ? ref('approval-decision.json') : undefined,
  };
  const common = {
    runId: params.state.runId,
    createdAt,
    resultStatus,
    traceRef: ref('vision-trace.json'),
    requestRef: ref('computer-use-request.json'),
    tuiHostRunTaskChainRef: ref('tui-host-run-task-chain.json'),
  };
  const approvalBoundary = approvalBoundaryRecord({
    approvalRef,
    approvalRequest,
    approvalRequestId,
    approvalProvenance,
    directApprovalRequest,
    guiAskUserAction,
    highRiskAction,
    riskActionHash,
    refs: approvalSidecarRefs,
  });
  const sourceRefs = {
    approvalRequestRef: approvalSidecarRefs.sourceApprovalRequestRef,
    guiAskUserRecordRef: approvalSidecarRefs.sourceGuiAskUserRecordRef,
    riskAuditRef: approvalSidecarRefs.sourceRiskAuditRef,
  };
  const sourceApprovalRequest = approvalProvenance
    ? copySourceApprovalSidecar({
        sidecar: recordAt(approvalProvenance, 'approvalRequestSidecar') ?? recordAt(approvalProvenance, 'approvalRequestRecord'),
        fallbackSchemaVersion: 'sciforge.computer-use.approval-request-sidecar.v1',
        common,
        refs: sourceRefs,
        originalRef: originalSourceRef(approvalProvenance, params.state.runDir, 'sourceApprovalRequestPath', 'sourceApprovalRequestRef'),
      })
    : undefined;
  const sourceGuiAskUser = approvalProvenance
    ? copySourceApprovalSidecar({
        sidecar: recordAt(approvalProvenance, 'guiAskUserSidecar') ?? recordAt(approvalProvenance, 'guiAskUserRecord'),
        fallbackSchemaVersion: COMPUTER_USE_TUI_HOST_ACTIONS_SCHEMA,
        common,
        refs: sourceRefs,
        originalRef: originalSourceRef(approvalProvenance, params.state.runDir, 'sourceGuiAskUserPath', 'sourceGuiAskUserRecordRef'),
      })
    : undefined;
  const sourceRiskAudit = approvalProvenance
    ? copySourceApprovalSidecar({
        sidecar: recordAt(approvalProvenance, 'riskAuditSidecar') ?? recordAt(approvalProvenance, 'riskAuditRecord'),
        fallbackSchemaVersion: 'sciforge.computer-use.risk-audit-sidecar.v1',
        common,
        refs: sourceRefs,
        originalRef: originalSourceRef(approvalProvenance, params.state.runDir, 'sourceRiskAuditPath', 'sourceRiskAuditRef'),
      })
    : undefined;
  const approvalDecision = approvalProvenance ? compactEvidenceRecord({
    schemaVersion: 'sciforge.computer-use.approval-decision-sidecar.v1',
    ...common,
    status: 'confirmed',
    decision: 'approved',
    approvalRequestId,
    riskActionHash,
    approvalRef: canonicalApprovalRef,
    sourceApprovalRequestRef: approvalSidecarRefs.sourceApprovalRequestRef,
    sourceGuiAskUserRecordRef: approvalSidecarRefs.sourceGuiAskUserRecordRef,
    sourceRiskAuditRef: approvalSidecarRefs.sourceRiskAuditRef,
    confirmedRequestRef: approvalSidecarRefs.confirmedRequestRef,
    approvalBoundary,
    decisionSource: stringAt(approvalProvenance, 'decisionSource') ?? 'external-human-approval',
    packageMayCallGuiDirectly: false,
  }) : undefined;
  const guiAskUserSidecar = guiAskUserAction ? compactEvidenceRecord({
    ...guiAskUserAction,
    ...common,
    status: 'needs-confirmation',
    approvalRequestId,
    riskActionHash,
    approvalRef: canonicalApprovalRef,
    ...approvalSidecarRefs,
    approvalBoundary,
    deniedExecuted: false,
    packageMayCallGuiDirectly: false,
  }) : undefined;
  const approvalRequestSidecar = approvalRequest ? compactEvidenceRecord({
    schemaVersion: 'sciforge.computer-use.approval-request-sidecar.v1',
    ...common,
    status: 'needs-confirmation',
    approvalRequestId,
    riskActionHash,
    approvalRef: canonicalApprovalRef,
    approvalRequest,
    ...approvalSidecarRefs,
    approvalBoundary,
    deniedExecuted: false,
    packageMayCallGuiDirectly: false,
  }) : undefined;
  const confirmedRequest = approvalRef ? compactEvidenceRecord({
    schemaVersion: 'sciforge.computer-use.confirmed-request-sidecar.v1',
    ...common,
    status: 'confirmed',
    approvalRequestId,
    riskActionHash,
    approvalRef: canonicalApprovalRef,
    ...approvalSidecarRefs,
    approvalBoundary,
    deniedExecuted: false,
    packageMayCallGuiDirectly: false,
  }) : undefined;
  const riskAudit = approvalRequest || approvalRef ? compactEvidenceRecord({
    schemaVersion: 'sciforge.computer-use.risk-audit-sidecar.v1',
    ...common,
    status: approvalRef ? 'confirmed' : 'needs-confirmation',
    approvalRequestId,
    riskActionHash,
    approvalRef: canonicalApprovalRef,
    ...approvalSidecarRefs,
    highRiskAction,
    approvalBoundary,
    deniedExecuted: false,
    packageMayCallGuiDirectly: false,
  }) : undefined;
  const blocked = resultStatus !== 'completed';
  const blockedManifest = blocked ? compactEvidenceRecord({
    schemaVersion: 'sciforge.computer-use.blocked-manifest-sidecar.v1',
    ...common,
    status: 'blocked',
    failedStage: stringAt(recordAt(params.packageResult, 'failureDiagnostics'), 'failedStage'),
    reason: stringAt(params.packageResult, 'reason') ?? stringAt(params.payload.executionUnits?.[0], 'failureReason') ?? `Computer Use package result status=${resultStatus}.`,
    approvalRequestRef: approvalRequest ? ref('approval-request.json') : undefined,
    repairHintRef: ref('repair-hint.json'),
    continuationRequestRef: ref('continuation-request.json'),
  }) : undefined;
  const repairHint = blocked ? compactEvidenceRecord({
    schemaVersion: 'sciforge.computer-use.repair-hint-sidecar.v1',
    ...common,
    status: 'repair-needed',
    blockedManifestRef: ref('blocked-manifest.json'),
    reason: stringAt(params.packageResult, 'reason') ?? `Computer Use package result status=${resultStatus}.`,
    nextAttempt: {
      reuseTraceRef: ref('vision-trace.json'),
      reuseRunTaskChainRef: ref('tui-host-run-task-chain.json'),
      requireFreshObservation: true,
      preserveInputIsolation: true,
    },
  }) : undefined;
  const continuationRequest = blocked ? compactEvidenceRecord({
    schemaVersion: 'sciforge.computer-use.continuation-request-sidecar.v1',
    ...common,
    status: 'ready-for-continuation',
    blockedManifestRef: ref('blocked-manifest.json'),
    repairHintRef: ref('repair-hint.json'),
    sameTraceSessionRef: ref('tui-host-run-task-chain.json'),
    requestRef: ref('computer-use-request.json'),
  }) : undefined;
  const directoryListing = compactEvidenceRecord({
    schemaVersion: 'sciforge.computer-use.evidence-directory-listing.v1',
    ...common,
    status: 'recorded',
    directoryRef: workspaceRel(params.workspace, params.state.runDir),
    fileRefs: [
      ref('computer-use-request.json'),
      ref('host-ports.json'),
      ref('tool-payload.json'),
      ref('tui-host-run-task-chain.json'),
      ref('vision-trace.json'),
      ...(params.guiPresent ? [ref('gui-present.json')] : []),
      ...(guiAskUserAction ? [ref('gui-ask-user.json')] : []),
      ...(approvalRequest ? [ref('approval-request.json')] : []),
      ...(riskAudit ? [ref('risk-audit.json')] : []),
      ...(approvalRef ? [ref('confirmed-request.json')] : []),
      ...(sourceApprovalRequest ? [ref('approval-source-request.json')] : []),
      ...(sourceGuiAskUser ? [ref('approval-source-gui-ask-user.json')] : []),
      ...(sourceRiskAudit ? [ref('approval-source-risk-audit.json')] : []),
      ...(approvalDecision ? [ref('approval-decision.json')] : []),
      ...(blocked ? [ref('blocked-manifest.json'), ref('repair-hint.json'), ref('continuation-request.json')] : []),
      ...params.state.visibleArtifacts.map((artifact) => artifact.artifactRef).filter(isFinalArtifactEvidenceRef),
    ],
    finalArtifactRefs: params.state.visibleArtifacts.map((artifact) => artifact.artifactRef).filter(isFinalArtifactEvidenceRef),
    finalVisibleScreenshotRef: finalWindowScreenshotRef(params.state.screenshotLedger),
    visibleArtifactRefs: params.state.visibleArtifacts.map((artifact) => artifact.artifactRef).filter((refValue) => refValue.trim().length > 0),
  });
  return {
    guiAskUser: guiAskUserSidecar,
    approvalRequest: approvalRequestSidecar,
    riskAudit,
    confirmedRequest,
    sourceApprovalRequest,
    sourceGuiAskUser,
    sourceRiskAudit,
    approvalDecision,
    blockedManifest,
    repairHint,
    continuationRequest,
    directoryListing,
  };
}

function approvalRequestFromPackageBridge(
  packageResult: Record<string, unknown>,
  guiAskUser?: ComputerUseTuiHostAction,
) {
  const direct = recordAt(packageResult, 'approvalRequest') ?? recordAt(packageResult, 'approval_request');
  if (direct) return direct;
  const payload = recordAt(guiAskUser, 'payload');
  return recordAt(payload, 'approvalRequest') ?? recordAt(payload, 'approval_request');
}

function highRiskActionFromPackageResult(packageResult: Record<string, unknown>) {
  const approvalRequest = approvalRequestFromPackageBridge(packageResult);
  const actionKind = stringAt(approvalRequest, 'action_kind') ?? stringAt(approvalRequest, 'actionKind');
  const blockedIndex = isRecord(approvalRequest)
    ? numberAt(approvalRequest.blocked_action_index ?? approvalRequest.blockedActionIndex)
    : undefined;
  const steps = Array.isArray(packageResult.steps) ? packageResult.steps.filter(isRecord) : [];
  const step = typeof blockedIndex === 'number'
    ? steps[blockedIndex]
    : steps.find((candidate) => stringAt(candidate, 'status') === 'blocked')
      ?? steps.find((candidate) => {
        const plan = recordAt(candidate, 'plan') ?? recordAt(candidate, 'action');
        return stringAt(plan, 'riskLevel') === 'high'
          || stringAt(plan, 'risk_level') === 'high'
          || booleanAt(plan, 'requiresConfirmation') === true
          || booleanAt(plan, 'requires_confirmation') === true;
      });
  const plan = recordAt(step, 'plan') ?? recordAt(step, 'action');
  return compactEvidenceRecord({
    actionKind: actionKind ?? stringAt(plan, 'kind') ?? stringAt(plan, 'type'),
    targetDescription: stringAt(recordAt(plan, 'target'), 'description') ?? stringAt(plan, 'target'),
    blockedActionIndex: blockedIndex,
  });
}

function approvalRequestFromConfirmedBridge(input: {
  approvalRef?: string;
  highRiskAction: Record<string, unknown>;
  actionProviderRequest: Record<string, unknown>;
}): Record<string, unknown> | undefined {
  if (!input.approvalRef) return undefined;
  return compactEvidenceRecord({
    id: input.approvalRef,
    approvalRequestId: input.approvalRef,
    approvalRef: input.approvalRef,
    reason: 'Human-approved Computer Use retry carried a canonical approvalRef; TUI Host preserves the original approval boundary as refs-first sidecar evidence.',
    actionKind: stringAt(input.highRiskAction, 'actionKind') ?? 'confirmed-high-risk-action',
    riskLevel: 'high',
    confirmationText: 'Approved high-risk Computer Use action.',
    metadata: {
      approvalRef: input.approvalRef,
      riskPolicy: stringAt(input.actionProviderRequest, 'riskPolicy'),
      target: stringAt(input.highRiskAction, 'targetDescription'),
    },
  });
}

function approvalRequestFromApprovalProvenance(provenance: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!provenance) return undefined;
  const sidecar = recordAt(provenance, 'approvalRequestSidecar') ?? recordAt(provenance, 'approvalRequestRecord');
  const nested = recordAt(sidecar, 'approvalRequest') ?? recordAt(provenance, 'approvalRequest');
  if (nested) return nested;
  const approvalRequestId = stringAt(provenance, 'approvalRequestId');
  const approvalRef = stringAt(provenance, 'approvalRef');
  const riskActionHash = stringAt(provenance, 'riskActionHash');
  if (!approvalRequestId && !approvalRef) return undefined;
  return compactEvidenceRecord({
    id: approvalRequestId ?? approvalRef,
    approvalRequestId: approvalRequestId ?? approvalRef,
    approvalRef,
    riskActionHash,
    reason: stringAt(provenance, 'reason') ?? 'Confirmed retry references a prior fail-closed Computer Use approval request.',
    actionKind: stringAt(recordAt(provenance, 'highRiskAction'), 'actionKind'),
    riskLevel: 'high',
    metadata: {
      approvalRef,
      riskActionHash,
      provenanceSource: stringAt(provenance, 'source'),
    },
  });
}

function guiAskUserActionFromApprovalProvenance(
  provenance: Record<string, unknown> | undefined,
  approvalRequest?: Record<string, unknown>,
): ComputerUseTuiHostAction | undefined {
  if (!provenance || !approvalRequest) return undefined;
  const sidecar = recordAt(provenance, 'guiAskUserSidecar') ?? recordAt(provenance, 'guiAskUserRecord');
  const port = stringAt(sidecar, 'port');
  const payload = recordAt(sidecar, 'payload');
  if (port === 'gui.ask_user' && payload) {
    return {
      schemaVersion: COMPUTER_USE_TUI_HOST_ACTIONS_SCHEMA,
      port: 'gui.ask_user',
      target: 'computer-use.approval-request',
      payload: {
        approvalRequest: recordAt(payload, 'approvalRequest') ?? approvalRequest,
        relatedRefs: stringArrayAt(payload, 'relatedRefs'),
      },
    };
  }
  return {
    schemaVersion: COMPUTER_USE_TUI_HOST_ACTIONS_SCHEMA,
    port: 'gui.ask_user',
    target: 'computer-use.approval-request',
    payload: {
      approvalRequest,
      relatedRefs: [
        stringAt(provenance, 'sourceApprovalRequestRef'),
        stringAt(provenance, 'sourceGuiAskUserRecordRef'),
        stringAt(provenance, 'sourceRiskAuditRef'),
      ].filter((ref): ref is string => Boolean(ref)),
    },
  };
}

function syntheticGuiAskUserAction(input: {
  approvalRequest?: Record<string, unknown>;
  approvalRef?: string;
  relatedRefs: string[];
}): ComputerUseTuiHostAction | undefined {
  if (!input.approvalRequest || !input.approvalRef) return undefined;
  return {
    schemaVersion: COMPUTER_USE_TUI_HOST_ACTIONS_SCHEMA,
    port: 'gui.ask_user',
    target: 'computer-use.approval-request',
    payload: {
      approvalRequest: input.approvalRequest,
      relatedRefs: input.relatedRefs,
    },
  };
}

function approvalRequestIdFromPackageBridge(approvalRequest: Record<string, unknown> | undefined) {
  if (!approvalRequest) return undefined;
  return stringAt(approvalRequest, 'id')
    ?? stringAt(approvalRequest, 'approvalRequestId')
    ?? stringAt(approvalRequest, 'approval_request_id');
}

function approvalRiskActionHash(input: {
  actionProviderRequest: Record<string, unknown>;
  approvalRequest?: Record<string, unknown>;
  approvalProvenance?: Record<string, unknown>;
  highRiskAction: Record<string, unknown>;
  approvalRequestId?: string;
}) {
  const explicit = stringAt(input.approvalRequest, 'riskActionHash')
    ?? stringAt(input.approvalRequest, 'risk_action_hash')
    ?? stringAt(recordAt(input.approvalRequest, 'metadata'), 'riskActionHash')
    ?? stringAt(recordAt(input.approvalRequest, 'metadata'), 'risk_action_hash')
    ?? stringAt(input.approvalProvenance, 'riskActionHash');
  if (explicit) return explicit;
  return createHash('sha256')
    .update(JSON.stringify({
      approvalRequestId: input.approvalRequestId,
      task: stringAt(input.actionProviderRequest, 'task'),
      highRiskAction: input.highRiskAction,
    }))
    .digest('hex')
    .slice(0, 24);
}

function copySourceApprovalSidecar(input: {
  sidecar?: Record<string, unknown>;
  fallbackSchemaVersion: string;
  common: Record<string, unknown>;
  refs: {
    approvalRequestRef?: string;
    guiAskUserRecordRef?: string;
    riskAuditRef?: string;
  };
  originalRef?: string;
}): Record<string, unknown> | undefined {
  if (!input.sidecar) return undefined;
  const { approvalBoundary: _approvalBoundary, approvalProvenance: _approvalProvenance, confirmedRequestRef: _confirmedRequestRef, sourceApprovalRequestRef: _sourceApprovalRequestRef, sourceGuiAskUserRecordRef: _sourceGuiAskUserRecordRef, sourceRiskAuditRef: _sourceRiskAuditRef, approvalDecisionRef: _approvalDecisionRef, ...preserved } = input.sidecar;
  const originalFields = sourceIdentityFields(input.sidecar);
  return compactEvidenceRecord({
    schemaVersion: stringAt(preserved, 'schemaVersion') ?? input.fallbackSchemaVersion,
    ...preserved,
    ...input.common,
    status: 'needs-confirmation',
    approvalRequestRef: input.refs.approvalRequestRef,
    guiAskUserRecordRef: input.refs.guiAskUserRecordRef,
    riskAuditRef: input.refs.riskAuditRef,
    deniedExecuted: false,
    packageMayCallGuiDirectly: false,
    sourceCopyPolicy: 'verbatim-except-bundle-local-refs',
    originalRef: input.originalRef,
    originalApprovalRequestId: originalFields.approvalRequestId,
    originalRiskActionHash: originalFields.riskActionHash,
    originalApprovalRef: originalFields.approvalRef,
    originalSha256: stableJsonSha256(input.sidecar),
  });
}

function sourceIdentityFields(sidecar: Record<string, unknown>) {
  const approvalRequest = recordAt(sidecar, 'approvalRequest') ?? recordAt(recordAt(sidecar, 'payload'), 'approvalRequest');
  const metadata = recordAt(approvalRequest, 'metadata');
  return {
    approvalRequestId: stringAt(sidecar, 'approvalRequestId')
      ?? stringAt(sidecar, 'approval_request_id')
      ?? stringAt(approvalRequest, 'id')
      ?? stringAt(approvalRequest, 'approvalRequestId')
      ?? stringAt(metadata, 'approvalRequestId'),
    riskActionHash: stringAt(sidecar, 'riskActionHash')
      ?? stringAt(sidecar, 'risk_action_hash')
      ?? stringAt(approvalRequest, 'riskActionHash')
      ?? stringAt(metadata, 'riskActionHash'),
    approvalRef: stringAt(sidecar, 'approvalRef')
      ?? stringAt(sidecar, 'approval_ref')
      ?? stringAt(sidecar, 'canonicalApprovalRef')
      ?? stringAt(approvalRequest, 'approvalRef')
      ?? stringAt(metadata, 'approvalRef'),
  };
}

function stableJsonSha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortJsonValue(value))).digest('hex');
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJsonValue(value[key])]));
  }
  return value;
}

function originalSourceRef(
  provenance: Record<string, unknown>,
  currentRunDir: string,
  pathKey: string,
  refKey: string,
): string | undefined {
  const sourcePath = stringAt(provenance, pathKey);
  if (sourcePath) {
    return normalizeBundleRef(relative(currentRunDir, sourcePath));
  }
  return stringAt(provenance, refKey);
}

function normalizeBundleRef(value: string): string {
  return value.replace(/\\/g, '/');
}

function approvalProvenanceFromActionProviderRequest(request: Record<string, unknown>): Record<string, unknown> | undefined {
  return recordAt(recordAt(request, 'metadata'), 'approvalProvenance')
    ?? recordAt(request, 'approvalProvenance');
}

function approvalBoundaryRecord(input: {
  approvalRef?: string;
  approvalRequest?: Record<string, unknown>;
  approvalRequestId?: string;
  approvalProvenance?: Record<string, unknown>;
  directApprovalRequest?: Record<string, unknown>;
  guiAskUserAction?: ComputerUseTuiHostAction;
  highRiskAction: Record<string, unknown>;
  riskActionHash: string;
  refs: {
    approvalRequestRef?: string;
    guiAskUserRecordRef?: string;
    confirmedRequestRef?: string;
    riskAuditRef?: string;
    sourceApprovalRequestRef?: string;
    sourceGuiAskUserRecordRef?: string;
    sourceRiskAuditRef?: string;
    approvalDecisionRef?: string;
  };
}) {
  const source = input.approvalProvenance
    ? 'prior-fail-closed-request'
    : input.directApprovalRequest
      ? 'current-fail-closed-request'
      : input.approvalRef
        ? 'confirmed-retry-without-prior-request'
        : undefined;
  return compactEvidenceRecord({
    source,
    sourceStatus: input.approvalProvenance ? 'needs-confirmation' : stringAt(input.approvalRequest, 'status'),
    sourceApprovalRequestRef: input.approvalProvenance ? input.refs.sourceApprovalRequestRef : undefined,
    sourceGuiAskUserRecordRef: input.approvalProvenance ? input.refs.sourceGuiAskUserRecordRef : undefined,
    sourceRiskAuditRef: input.approvalProvenance ? input.refs.sourceRiskAuditRef : undefined,
    approvalDecisionRef: input.approvalProvenance ? input.refs.approvalDecisionRef : undefined,
    sourceRunId: stringAt(input.approvalProvenance, 'sourceRunId'),
    approvalRequestId: input.approvalRequestId,
    riskActionHash: input.riskActionHash,
    approvalRef: input.approvalRef ?? stringAt(input.approvalRequest, 'approvalRef'),
    highRiskAction: Object.keys(input.highRiskAction).length > 0
      ? input.highRiskAction
      : recordAt(input.approvalProvenance, 'highRiskAction'),
    confirmedRequestRef: input.refs.confirmedRequestRef,
  });
}

function compactEvidenceRecord<T extends Record<string, unknown>>(value: T): T {
  const entries = Object.entries(value).filter(([, item]) => {
    if (item === undefined || item === null) return false;
    if (Array.isArray(item) && item.length === 0) return false;
    if (isRecord(item) && Object.keys(item).length === 0) return false;
    return true;
  });
  return Object.fromEntries(entries) as T;
}

export function buildPackageBridgeTuiHostRunTaskChain(params: {
  actionProviderRequest: Record<string, unknown>;
  config: ComputerUseConfig;
  payload: ToolPayload;
  sidecars: PackageBridgeEvidenceSidecars;
  state: PackageBridgeEvidenceState;
  workspace: string;
  guiPresent?: ComputerUseTuiHostAction;
  guiAskUser?: ComputerUseTuiHostAction;
}) {
  const ref = (name: string) => workspaceRel(params.workspace, join(params.state.runDir, name));
  const traceRef = params.state.tracePath
    ? workspaceRel(params.workspace, params.state.tracePath)
    : ref('vision-trace.json');
  const requestRef = ref('computer-use-request.json');
  const hostPortsRef = ref('host-ports.json');
  const toolPayloadRef = ref('tool-payload.json');
  const guiPresentRef = params.guiPresent ? ref('gui-present.json') : undefined;
  const guiAskUserRef = params.guiAskUser || params.sidecars.guiAskUser ? ref('gui-ask-user.json') : undefined;
  const approvalRequestRef = params.sidecars.approvalRequest ? ref('approval-request.json') : undefined;
  const riskAuditRef = params.sidecars.riskAudit ? ref('risk-audit.json') : undefined;
  const confirmedRequestRef = params.sidecars.confirmedRequest ? ref('confirmed-request.json') : undefined;
  const blockedManifestRef = params.sidecars.blockedManifest ? ref('blocked-manifest.json') : undefined;
  const repairHintRef = params.sidecars.repairHint ? ref('repair-hint.json') : undefined;
  const continuationRequestRef = params.sidecars.continuationRequest ? ref('continuation-request.json') : undefined;
  const directoryListingRef = ref('directory-listing.json');
  return {
    schemaVersion: TUI_HOST_RUN_TASK_CHAIN_SCHEMA,
    runId: params.state.runId,
    createdAt: new Date().toISOString(),
    runtime: 'sciforge.workspace-runtime.computer-use-package-bridge',
    actionProvider: COMPUTER_USE_ACTION_PROVIDER_ID,
    hostPortProtocol: 'stdio-jsonl',
    status: params.guiPresent ? 'presented' : 'recorded',
    resultStatus: params.payload.executionUnits?.[0]?.status,
    refs: {
      requestRef,
      hostPortsRef,
      toolPayloadRef,
      traceRef,
      guiPresentRecordRef: guiPresentRef,
      guiAskUserRecordRef: guiAskUserRef,
      approvalRequestRef,
      riskAuditRef,
      confirmedRequestRef,
      blockedManifestRef,
      repairHintRef,
      continuationRequestRef,
      directoryListingRef,
    },
    links: [
      {
        id: 'computer-use-request',
        kind: 'gui-terminal-equivalent-text',
        status: 'present',
        requestRef,
        note: 'TUI Host converted terminal-equivalent Computer Use text into a package request.',
      },
      {
        id: 'tui-host-runTask',
        kind: 'tui-host-runTask',
        status: 'present',
        requestRef,
        hostPortsRef,
        traceRef,
        note: 'TUI Host called the Computer Use package run_task bridge with injected host ports.',
      },
      {
        id: 'computer-use-action-provider',
        kind: 'computer-use-action-provider',
        status: 'present',
        toolPayloadRef,
        traceRef,
        note: 'Package action-provider result was mapped back into the workspace runtime payload.',
      },
      {
        id: 'gui-present',
        kind: 'gui.present',
        status: params.guiPresent ? 'present' : 'missing',
        recordRef: guiPresentRef,
        payloadRef: toolPayloadRef,
        note: params.guiPresent
          ? 'TUI Host prepared refs-first gui.present action metadata for GUI presentation.'
          : 'No gui.present action metadata was produced for this run.',
      },
      {
        id: 'gui-ask-user',
        kind: 'gui.ask_user',
        status: guiAskUserRef ? 'present' : 'missing',
        recordRef: guiAskUserRef,
        payloadRef: toolPayloadRef,
        note: guiAskUserRef
          ? 'TUI Host prepared refs-first gui.ask_user action metadata for high-risk confirmation.'
          : 'No gui.ask_user action metadata was produced for this run.',
      },
      {
        id: 'approval-request',
        kind: 'approval-request',
        status: approvalRequestRef ? 'present' : 'missing',
        recordRef: approvalRequestRef,
        note: approvalRequestRef
          ? 'TUI Host wrote a dedicated approval request sidecar for high-risk confirmation.'
          : 'No approval request sidecar was needed for this run.',
      },
      {
        id: 'repair-continuity',
        kind: 'repair-continuity',
        status: blockedManifestRef && repairHintRef && continuationRequestRef ? 'present' : 'missing',
        recordRef: blockedManifestRef,
        note: blockedManifestRef
          ? 'TUI Host wrote blocked manifest, repair hint, and continuation request sidecars.'
          : 'No blocked repair continuity sidecars were needed for this run.',
      },
      {
        id: 'directory-listing',
        kind: 'directory-listing',
        status: 'present',
        recordRef: directoryListingRef,
        note: 'TUI Host wrote a refs-first evidence bundle directory listing sidecar.',
      },
    ],
    providerRefs: {
      action: COMPUTER_USE_ACTION_PROVIDER_ID,
      sense: stringAt(recordAt(params.actionProviderRequest, 'providers'), 'sense'),
      grounder: stringAt(recordAt(params.actionProviderRequest, 'providers'), 'grounder'),
      executor: stringAt(recordAt(params.actionProviderRequest, 'providers'), 'executor'),
      verifier: stringAt(recordAt(params.actionProviderRequest, 'providers'), 'verifier'),
    },
    hostPortProviders: computerUseHostPortsContract(params.config).ports,
    boundary: {
      packageMayCallGuiDirectly: false,
      guiPortsAreTuiHostOnly: ['gui.present', 'gui.ask_user'],
      forbiddenPackagePorts: ['requestApproval', 'gui.present', 'gui.ask_user'],
      policy: 'Computer Use package returns refs-first result or approvalRequest; TUI Host owns GUI presentation and confirmation intents.',
    },
  };
}

export function isFinalArtifactEvidenceRef(ref: string | undefined) {
  const text = ref?.trim();
  if (!text) return false;
  if (/\.(png|jpe?g|webp)$/i.test(text)) return false;
  if (/\/?(vision-trace|host-ports|tool-payload|gui-present|gui-ask-user|approval-request|approval-source-request|approval-source-gui-ask-user|approval-source-risk-audit|approval-decision|risk-audit|confirmed-request|blocked-manifest|repair-hint|continuation-request|directory-listing|tui-host-run-task-chain|computer-use-request|gateway-request|request|independent-input-adapter|virtual-remote-session|action-ledger|failure-diagnostics|cu-user-acceptance|cu-l3-independent-input-verifier)\.json$/i.test(text)) {
    return false;
  }
  return /^(artifact|file|ref):/i.test(text)
    || text.startsWith('.sciforge/')
    || text.startsWith('/')
    || /\.(md|txt|csv|tsv|xlsx|pptx?|pdf|docx?|odt|ods|json)$/i.test(text);
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function finalWindowScreenshotRef(refs: Array<{ id: string; path: string }>) {
  return [...refs].reverse().find((ref) => !ref.id.includes('-focus-') && !ref.path.includes('-focus-'))?.path
    ?? refs.at(-1)?.path;
}

function recordAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return isRecord(item) ? item : undefined;
}

function stringAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}

function stringArrayAt(value: unknown, key: string): string[] {
  if (!isRecord(value)) return [];
  const item = value[key];
  return Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function numberAt(value: unknown) {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function booleanAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'boolean' ? item : undefined;
}
