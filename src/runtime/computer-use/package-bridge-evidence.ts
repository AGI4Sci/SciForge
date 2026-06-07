import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

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
import {
  CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF,
} from '../../../packages/actions/computer-use/evidence-classification.js';
import {
  cuNextCompletionGradeEvidenceIssues,
  cuNextCompletedL3CompletionEvidenceIssues,
} from '../../../packages/actions/computer-use/completion-grade.js';
import { projectCuNextTaskAcceptanceMarkers } from '../../../packages/actions/computer-use/acceptance-projection.js';
import type { CuNextTaskId, CuNextTaskMapping } from '../../../packages/actions/computer-use/task-map.js';
import {
  buildCuUserAcceptanceManifest,
  type CuEvidenceClaim,
  type CuUserAcceptanceInput,
} from '../../../packages/actions/computer-use/user-acceptance-manifest.js';

const TUI_HOST_RUN_TASK_CHAIN_SCHEMA = 'sciforge.computer-use.tui-host-run-task-chain.v1';
const COMPLETION_GRADE_DIAGNOSTIC_SCHEMA = 'sciforge.computer-use.completion-grade-diagnostic.v1';

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
  completionGrade?: PackageBridgeCompletionGradeAttachment;
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
    completionGrade: params.completionGrade,
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
    completionGrade: params.completionGrade,
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

export type PackageBridgeCompletionGradeAttachment = {
  status: 'not-applicable' | 'attached' | 'blocked';
  reason?: string;
  issues: string[];
  acceptanceManifestRef?: string;
  acceptanceInputRef?: string;
  completionEvidenceRef?: string;
  completionEvidenceBundleRef?: string;
  diagnosticRef?: string;
  producerDiagnosticRef?: string;
};

export async function materializePackageBridgeCompletionGradeEvidence(params: {
  actionProviderRequest: Record<string, unknown>;
  config: ComputerUseConfig;
  packageResult: Record<string, unknown>;
  payload: ToolPayload;
  producerDiagnosticRef?: string;
  state: PackageBridgeEvidenceState;
  workspace: string;
}): Promise<PackageBridgeCompletionGradeAttachment> {
  if (stringAt(params.packageResult, 'status') !== 'completed') {
    return { status: 'not-applicable', issues: [] };
  }

  const runDirRef = workspaceRel(params.workspace, params.state.runDir);
  const ref = (name: string) => `${runDirRef}/${name}`;
  const diagnosticRef = ref('completion-grade-diagnostics.json');
  const completionEvidencePath = join(params.state.runDir, CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF);
  const completionEvidenceBundleRef = ref(CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF);
  const missingCanonical = await validateBundleLocalRegularFile(params.state.runDir, completionEvidencePath);
  if (missingCanonical) {
    const reason = `completed Computer Use package bridge run is fail-closed for completion-grade evidence: ${CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF} is missing or not a current-run regular file.`;
    await writeCompletionGradeDiagnostic(join(params.state.runDir, 'completion-grade-diagnostics.json'), {
      status: 'blocked',
      runId: params.state.runId,
      reason,
      issues: [missingCanonical],
      expectedCompletionEvidenceRef: completionEvidenceBundleRef,
    });
    return { status: 'blocked', reason, issues: [missingCanonical], diagnosticRef, producerDiagnosticRef: params.producerDiagnosticRef };
  }

  let completionEvidence: Record<string, unknown>;
  try {
    completionEvidence = await readJsonRecord(completionEvidencePath);
  } catch (error) {
    const reason = `completed Computer Use package bridge run is fail-closed because ${CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF} could not be parsed as a JSON object.`;
    const issue = error instanceof Error ? error.message : String(error);
    await writeCompletionGradeDiagnostic(join(params.state.runDir, 'completion-grade-diagnostics.json'), {
      status: 'blocked',
      runId: params.state.runId,
      reason,
      issues: [issue],
      expectedCompletionEvidenceRef: completionEvidenceBundleRef,
    });
    return { status: 'blocked', reason, issues: [issue], diagnosticRef, completionEvidenceBundleRef, producerDiagnosticRef: params.producerDiagnosticRef };
  }
  const completionIssues = cuNextCompletedL3CompletionEvidenceIssues(completionEvidence, {
    refScopeDescription: 'the current package bridge run bundle',
    refExists: (candidateRef) => bundleLocalRegularRefExists(params.state.runDir, candidateRef),
  });
  if (completionIssues.length > 0) {
    const reason = `completed Computer Use package bridge run is fail-closed because ${CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF} was present but not validator-accepted isolated L3 evidence.`;
    await writeCompletionGradeDiagnostic(join(params.state.runDir, 'completion-grade-diagnostics.json'), {
      status: 'blocked',
      runId: params.state.runId,
      reason,
      issues: completionIssues,
      expectedCompletionEvidenceRef: completionEvidenceBundleRef,
    });
    return { status: 'blocked', reason, issues: completionIssues, diagnosticRef, completionEvidenceBundleRef, producerDiagnosticRef: params.producerDiagnosticRef };
  }

  const acceptanceInput = buildPackageBridgeAcceptanceInput({
    actionProviderRequest: params.actionProviderRequest,
    completionEvidence,
    config: params.config,
    packageResult: params.packageResult,
    payload: params.payload,
    state: params.state,
    workspace: params.workspace,
  });
  const acceptanceManifest = buildCuUserAcceptanceManifest(acceptanceInput);
  const bindingIssues = cuNextCompletionGradeEvidenceIssues(
    acceptanceManifest,
    packageBridgeCompletionGradeMapping(acceptanceInput),
    completionEvidence,
    {
      refScopeDescription: 'the current package bridge run bundle',
      refExists: (candidateRef) => bundleLocalRegularRefExists(params.state.runDir, candidateRef),
    },
  );
  if (bindingIssues.length > 0) {
    const reason = `completed Computer Use package bridge run is fail-closed because ${CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF} is not bound to the current package bridge final artifact and gui.present evidence.`;
    await writeCompletionGradeDiagnostic(join(params.state.runDir, 'completion-grade-diagnostics.json'), {
      status: 'blocked',
      runId: params.state.runId,
      reason,
      issues: bindingIssues,
      expectedCompletionEvidenceRef: completionEvidenceBundleRef,
    });
    return { status: 'blocked', reason, issues: bindingIssues, diagnosticRef, completionEvidenceBundleRef, producerDiagnosticRef: params.producerDiagnosticRef };
  }
  const acceptanceInputRef = ref('cu-user-acceptance-input.json');
  const acceptanceManifestRef = ref('cu-user-acceptance-manifest.json');
  await writeJson(join(params.state.runDir, 'cu-user-acceptance-input.json'), acceptanceInput);
  await writeJson(join(params.state.runDir, 'cu-user-acceptance-manifest.json'), acceptanceManifest);
  return {
    status: acceptanceManifest.status === 'multi-app-workflow-passed' || acceptanceManifest.status === 'single-app-artifact-passed'
      ? 'attached'
      : 'blocked',
    reason: acceptanceManifest.blockedItems.map((item) => item.reason).join(' ') || undefined,
    issues: acceptanceManifest.blockedItems.map((item) => item.reason),
    acceptanceInputRef,
    acceptanceManifestRef,
    completionEvidenceRef: CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF,
    completionEvidenceBundleRef,
    producerDiagnosticRef: params.producerDiagnosticRef,
  };
}

export function attachPackageBridgeCompletionGradeWorkEvidence(
  payload: ToolPayload,
  completionGrade: PackageBridgeCompletionGradeAttachment,
) {
  if (completionGrade.status === 'not-applicable') return;
  const refs = uniqueStrings([
    completionGrade.acceptanceManifestRef,
    completionGrade.acceptanceInputRef,
    completionGrade.completionEvidenceBundleRef,
    completionGrade.diagnosticRef,
    completionGrade.producerDiagnosticRef,
  ].filter((ref): ref is string => Boolean(ref)));
  const recoverActions = completionGrade.status === 'blocked'
    ? [`Produce canonical ${CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF} in the same Computer Use run dir; package bridge will not synthesize L3 evidence.`]
    : [];
  const completionWorkEvidence: NonNullable<ToolPayload['workEvidence']>[number] = {
    id: completionGrade.acceptanceManifestRef ?? completionGrade.diagnosticRef ?? 'workEvidence:computer-use-completion-grade',
    kind: 'validate',
    provider: 'computer-use-package-bridge',
    status: completionGrade.status === 'attached' ? 'verified' : 'blocked',
    outputSummary: 'Computer Use completion-grade evidence',
    evidenceRefs: refs,
    failureReason: completionGrade.status === 'blocked' ? completionGrade.reason ?? completionGrade.issues.join(' ') : undefined,
    recoverActions,
    nextStep: recoverActions[0],
  };
  payload.workEvidence = [
    ...(payload.workEvidence ?? []),
    completionWorkEvidence,
  ];
}

export function buildPackageBridgeEvidenceSidecars(params: {
  actionProviderRequest: Record<string, unknown>;
  packageResult: Record<string, unknown>;
  payload: ToolPayload;
  state: PackageBridgeEvidenceState;
  workspace: string;
  guiPresent?: ComputerUseTuiHostAction;
  guiAskUser?: ComputerUseTuiHostAction;
  completionGrade?: PackageBridgeCompletionGradeAttachment;
}): PackageBridgeEvidenceSidecars {
  const ref = (name: string) => workspaceRel(params.workspace, join(params.state.runDir, name));
  const resultStatus = stringAt(params.packageResult, 'status') ?? String(params.payload.executionUnits?.[0]?.status ?? 'unknown');
  const approvalRef = stringAt(params.actionProviderRequest, 'approvalRef')
    ?? stringAt(params.actionProviderRequest, 'approval_ref')
    ?? stringAt(recordAt(params.actionProviderRequest, 'metadata'), 'approvalRef');
  const approvalProvenance = approvalProvenanceFromActionProviderRequest(params.actionProviderRequest);
  const continuationContext = continuationContextFromActionProviderRequest(params.actionProviderRequest);
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
    deniedExecuted: false,
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
  const continuationSidecars = recordAt(continuationContext, 'sidecars');
  const continuationBlockedSummary = recordAt(continuationSidecars, 'blockedManifest');
  const continuationRepairSummary = recordAt(continuationSidecars, 'repairHint');
  const continuationRequestSummary = recordAt(continuationSidecars, 'continuationRequest');
  const continuationBlockedSourceRef = stringArrayAt(continuationContext, 'blockedManifestRefs')[0];
  const continuationRepairSourceRef = stringArrayAt(continuationContext, 'repairHintRefs')[0];
  const continuationRequestSourceRef = stringArrayAt(continuationContext, 'continuationRequestRefs')[0];
  const currentBlockedManifest = blocked ? compactEvidenceRecord({
    schemaVersion: 'sciforge.computer-use.blocked-manifest-sidecar.v1',
    ...common,
    status: 'blocked',
    failedStage: stringAt(recordAt(params.packageResult, 'failureDiagnostics'), 'failedStage'),
    reason: stringAt(params.packageResult, 'reason') ?? stringAt(params.payload.executionUnits?.[0], 'failureReason') ?? `Computer Use package result status=${resultStatus}.`,
    approvalRequestRef: approvalRequest ? ref('approval-request.json') : undefined,
    repairHintRef: ref('repair-hint.json'),
    continuationRequestRef: ref('continuation-request.json'),
  }) : undefined;
  const currentRepairHint = blocked ? compactEvidenceRecord({
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
  const currentContinuationRequest = blocked ? compactEvidenceRecord({
    schemaVersion: 'sciforge.computer-use.continuation-request-sidecar.v1',
    ...common,
    status: 'ready-for-continuation',
    blockedManifestRef: ref('blocked-manifest.json'),
    repairHintRef: ref('repair-hint.json'),
    sameTraceSessionRef: ref('tui-host-run-task-chain.json'),
    requestRef: ref('computer-use-request.json'),
  }) : undefined;
  const hydratedContinuationBlockedManifest = !blocked && continuationContext ? compactEvidenceRecord({
    schemaVersion: 'sciforge.computer-use.blocked-manifest-sidecar.v1',
    ...common,
    status: stringAt(continuationBlockedSummary, 'status') ?? 'blocked',
    failedStage: stringAt(continuationBlockedSummary, 'failedStage'),
    reason: stringAt(continuationBlockedSummary, 'reason') ?? 'Prior repair turn supplied bounded continuation context.',
    sourceRef: continuationBlockedSourceRef,
    sourceRefs: stringArrayAt(continuationContext, 'blockedManifestRefs'),
    repairHintRef: ref('repair-hint.json'),
    continuationRequestRef: ref('continuation-request.json'),
  }) : undefined;
  const hydratedContinuationRepairHint = !blocked && continuationContext ? compactEvidenceRecord({
    schemaVersion: 'sciforge.computer-use.repair-hint-sidecar.v1',
    ...common,
    status: stringAt(continuationRepairSummary, 'status') ?? 'repair-needed',
    blockedManifestRef: ref('blocked-manifest.json'),
    reason: stringAt(continuationRepairSummary, 'reason') ?? 'Prior repair hint supplied bounded continuation context.',
    sourceRef: continuationRepairSourceRef,
    sourceRefs: stringArrayAt(continuationContext, 'repairHintRefs'),
    nextAttempt: recordAt(continuationRepairSummary, 'nextAttempt') ?? {
      reuseTraceRef: stringAt(continuationRequestSummary, 'sameTraceSessionRef'),
      reuseRunTaskChainRef: stringAt(continuationRequestSummary, 'sameTraceSessionRef'),
      requireFreshObservation: true,
      preserveInputIsolation: true,
    },
  }) : undefined;
  const hydratedContinuationRequest = !blocked && continuationContext ? compactEvidenceRecord({
    schemaVersion: 'sciforge.computer-use.continuation-request-sidecar.v1',
    ...common,
    status: stringAt(continuationRequestSummary, 'status') ?? 'ready-for-continuation',
    blockedManifestRef: ref('blocked-manifest.json'),
    repairHintRef: ref('repair-hint.json'),
    sameTraceSessionRef: stringAt(continuationRequestSummary, 'sameTraceSessionRef')
      ?? stringArrayAt(continuationContext, 'runTaskChainRefs')[0]
      ?? ref('tui-host-run-task-chain.json'),
    requestRef: ref('computer-use-request.json'),
    sourceRef: continuationRequestSourceRef,
    sourceRefs: stringArrayAt(continuationContext, 'continuationRequestRefs'),
  }) : undefined;
  const blockedManifest = currentBlockedManifest ?? hydratedContinuationBlockedManifest;
  const repairHint = currentRepairHint ?? hydratedContinuationRepairHint;
  const continuationRequest = currentContinuationRequest ?? hydratedContinuationRequest;
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
      ...(blockedManifest ? [ref('blocked-manifest.json')] : []),
      ...(repairHint ? [ref('repair-hint.json')] : []),
      ...(continuationRequest ? [ref('continuation-request.json')] : []),
      ...(params.completionGrade?.acceptanceInputRef ? [params.completionGrade.acceptanceInputRef] : []),
      ...(params.completionGrade?.acceptanceManifestRef ? [params.completionGrade.acceptanceManifestRef] : []),
      ...(params.completionGrade?.completionEvidenceBundleRef ? [params.completionGrade.completionEvidenceBundleRef] : []),
      ...(params.completionGrade?.diagnosticRef ? [params.completionGrade.diagnosticRef] : []),
      ...(params.completionGrade?.producerDiagnosticRef ? [params.completionGrade.producerDiagnosticRef] : []),
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

function continuationContextFromActionProviderRequest(request: Record<string, unknown>): Record<string, unknown> | undefined {
  const metadata = recordAt(request, 'metadata');
  return recordAt(recordAt(metadata, 'plannerAcceptanceContract'), 'computerUseContinuation')
    ?? recordAt(metadata, 'computerUseContinuation')
    ?? recordAt(request, 'computerUseContinuation');
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

async function readJsonRecord(path: string): Promise<Record<string, unknown>> {
  const data = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!isRecord(data)) throw new Error(`${path} did not contain a JSON object.`);
  return data;
}

async function validateBundleLocalRegularFile(baseDir: string, path: string): Promise<string | undefined> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return `${path} is a symlink.`;
    if (!info.isFile()) return `${path} is not a regular file.`;
    const baseReal = await realpath(baseDir);
    const pathReal = await realpath(path);
    if (!isPathInside(baseReal, pathReal)) return `${path} resolves outside the current run dir.`;
    return undefined;
  } catch {
    return `${path} does not exist.`;
  }
}

function bundleLocalRegularRefExists(baseDir: string, ref: string): boolean {
  if (!isBundleLocalRef(ref)) return false;
  const resolved = resolve(baseDir, bundleLocalOrCurrentRunRefPath(baseDir, ref));
  if (!isPathInside(resolve(baseDir), resolved)) return false;
  try {
    const info = lstatSync(resolved);
    if (!info.isFile() || info.isSymbolicLink()) return false;
    return isPathInside(realpathSync(baseDir), realpathSync(resolved));
  } catch {
    return false;
  }
}

function bundleLocalOrCurrentRunRefPath(baseDir: string, ref: string): string {
  const normalized = ref.trim().replace(/\\/g, '/');
  const currentRunPrefix = `.sciforge/vision-runs/${basename(resolve(baseDir))}/`;
  return normalized.startsWith(currentRunPrefix)
    ? normalized.slice(currentRunPrefix.length)
    : ref;
}

function isBundleLocalRef(ref: string) {
  return Boolean(ref.trim())
    && !ref.startsWith('/')
    && !/^[a-z][a-z0-9+.-]*:/i.test(ref)
    && !ref.split(/[\\/]+/).includes('..');
}

function isCurrentRunTaskFinalArtifactRef(ref: string, runDirRef: string) {
  const normalized = ref.replace(/\\/g, '/').replace(/^\.\//, '');
  const normalizedRunDir = runDirRef.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  return normalized.startsWith(`${normalizedRunDir}/`)
    && isFinalArtifactEvidenceRef(ref);
}

function isPathInside(baseDir: string, path: string): boolean {
  const base = resolve(baseDir);
  const target = resolve(path);
  return target === base || target.startsWith(`${base}/`);
}

async function writeCompletionGradeDiagnostic(path: string, diagnostic: Record<string, unknown>) {
  await writeJson(path, {
    schemaVersion: COMPLETION_GRADE_DIAGNOSTIC_SCHEMA,
    createdAt: new Date().toISOString(),
    policy: 'Package bridge may attach existing same-run canonical isolated L3 evidence, but must not synthesize or borrow L3 evidence.',
    ...diagnostic,
  });
}

function firstStringAt(value: unknown, paths: string[][]) {
  for (const path of paths) {
    let current = value;
    for (const key of path) current = isRecord(current) ? current[key] : undefined;
    if (typeof current === 'string' && current.trim()) return current;
  }
  return undefined;
}

function recordArrayAt(value: unknown, key: string): Record<string, unknown>[] {
  if (!isRecord(value)) return [];
  const item = value[key];
  return Array.isArray(item) ? item.filter(isRecord) : [];
}

function screenshotRefsForAcceptance(
  state: PackageBridgeEvidenceState,
  completionEvidence: Record<string, unknown>,
) {
  const windowScreenshots = state.screenshotLedger
    .filter((item) => !item.id.includes('-focus-') && !item.path.includes('-focus-'))
    .map((item) => item.path);
  const completionScreenshots = stringArrayAt(completionEvidence, 'screenshotRefs');
  const completionScreenshotRecord = recordAt(completionEvidence, 'screenshotRefs');
  const completionBeforeScreenshots = stringArrayAt(completionScreenshotRecord, 'before');
  const completionAfterScreenshots = stringArrayAt(completionScreenshotRecord, 'after');
  if (completionBeforeScreenshots.length > 0 || completionAfterScreenshots.length > 0) {
    return {
      before: uniqueStrings([...completionBeforeScreenshots, ...completionScreenshots]),
      after: uniqueStrings([...completionAfterScreenshots, ...completionScreenshots]),
    };
  }
  const refs = uniqueStrings([...windowScreenshots, ...completionScreenshots]);
  const midpoint = Math.max(1, Math.floor(refs.length / 2));
  return {
    before: refs.length > 1 ? refs.slice(0, midpoint) : refs.slice(0, 1),
    after: refs.length > 1 ? refs.slice(midpoint) : refs.slice(-1),
  };
}

function completionEvidenceRef(completionEvidence: Record<string, unknown>, key: string) {
  return stringAt(completionEvidence, key);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
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
  completionGrade?: PackageBridgeCompletionGradeAttachment;
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
  const chatOrigin = chatOriginFromActionProviderRequest(params.actionProviderRequest);
  return {
    schemaVersion: TUI_HOST_RUN_TASK_CHAIN_SCHEMA,
    runId: params.state.runId,
    createdAt: new Date().toISOString(),
    runtime: 'sciforge.workspace-runtime.computer-use-package-bridge',
    actionProvider: COMPUTER_USE_ACTION_PROVIDER_ID,
    hostPortProtocol: 'ts-host-port-loop',
    status: params.guiPresent ? 'presented' : 'recorded',
    resultStatus: params.payload.executionUnits?.[0]?.status,
    origin: chatOrigin,
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
        id: 'chat-origin',
        kind: 'sciForge-chat-origin',
        status: chatOrigin ? 'present' : 'missing',
        requestRef,
        note: chatOrigin
          ? 'SciForge chat originated this Computer Use run and handed terminal-equivalent text to TUI Host.'
          : 'No SciForge chat-origin proof was present on the Computer Use request.',
      },
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
        note: 'TUI Host called the Computer Use TypeScript action-provider loop with injected host ports.',
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
      {
        id: 'completion-grade',
        kind: 'completion-grade-evidence',
        status: params.completionGrade?.status === 'attached' ? 'present' : params.completionGrade?.status === 'blocked' ? 'blocked' : 'missing',
        recordRef: params.completionGrade?.acceptanceManifestRef ?? params.completionGrade?.diagnosticRef,
        note: params.completionGrade?.status === 'attached'
          ? 'Package bridge attached current-run CU user acceptance manifest and canonical isolated L3 completion evidence refs.'
          : params.completionGrade?.status === 'blocked'
            ? 'Package bridge did not synthesize L3 evidence; completion-grade remains fail-closed with diagnostics.'
            : 'No completed current-run completion-grade evidence was attached.',
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
    completionGrade: params.completionGrade?.status === 'not-applicable' ? undefined : params.completionGrade,
  };
}

function buildPackageBridgeAcceptanceInput(params: {
  actionProviderRequest: Record<string, unknown>;
  completionEvidence: Record<string, unknown>;
  config: ComputerUseConfig;
  packageResult: Record<string, unknown>;
  payload: ToolPayload;
  state: PackageBridgeEvidenceState;
  workspace: string;
}): CuUserAcceptanceInput {
  const runDirRef = workspaceRel(params.workspace, params.state.runDir);
  const ref = (name: string) => `${runDirRef}/${name}`;
  const requestMetadata = recordAt(params.actionProviderRequest, 'metadata');
  const plannerAcceptance = recordAt(requestMetadata, 'plannerAcceptanceContract');
  const finalArtifactRef = [
    ...params.state.visibleArtifacts.map((artifact) => artifact.artifactRef),
    firstStringAt(params.completionEvidence, [
      ['taskArtifactBinding', 'finalArtifactRef'],
      ['artifactCausality', 'finalArtifactRef'],
    ]),
  ].find((candidate): candidate is string => (
    typeof candidate === 'string'
    && isCurrentRunTaskFinalArtifactRef(candidate, runDirRef)
  ));
  const finalVisibleScreenshotRef = firstStringAt(params.completionEvidence, [['presentationEvidence', 'finalVisibleScreenshotRef']])
    ?? currentRunFinalVisibleScreenshotRef(params.state.runDir, runDirRef)
    ?? finalWindowScreenshotRef(params.state.screenshotLedger)
    ?? stringArrayAt(params.completionEvidence, 'screenshotRefs').at(-1);
  const screenshotRefs = screenshotRefsForAcceptance(params.state, params.completionEvidence);
  const focusCropRefs = uniqueStrings([
    ...params.state.screenshotLedger
      .filter((item) => item.id.includes('-focus-') || item.path.includes('-focus-'))
      .map((item) => item.path),
    ...stringArrayAt(params.completionEvidence, 'focusCropRefs'),
  ]);
  const groundingDiagnosticsRefs = uniqueStrings([
    ...stringArrayAt(params.completionEvidence, 'groundingDiagnosticsRefs'),
    ...stringArrayAt(recordAt(params.completionEvidence, 'groundingEvidence'), 'diagnosticRefs'),
  ]);
  const effectiveFocusCropRefs = focusCropRefs.length > 0
    ? focusCropRefs
    : uniqueStrings([finalVisibleScreenshotRef].filter((item): item is string => Boolean(item)));
  const effectiveGroundingDiagnosticsRefs = groundingDiagnosticsRefs.length > 0
    ? groundingDiagnosticsRefs
    : [ref('vision-trace.json')];
  const applicationEvidence = recordArrayAt(params.completionEvidence, 'applicationEvidence');
  const workflowApps = uniqueStrings(applicationEvidence.map((item) => (
    stringAt(item, 'appName') ?? stringAt(item, 'appKind')
  )).filter((item): item is string => Boolean(item)));
  const windowSwitchTraceRefs = uniqueStrings([
    ...stringArrayAt(params.completionEvidence, 'traceRefs'),
    ...recordArrayAt(params.completionEvidence, 'crossAppTransitions')
      .flatMap((transition) => [
        stringAt(transition, 'screenshotRef'),
        stringAt(transition, 'traceRef'),
        stringAt(transition, 'sessionManifestRef'),
      ])
      .filter((item): item is string => Boolean(item)),
  ]);
  const taskId = stringAt(plannerAcceptance, 'cuNextTaskId')
    ?? stringAt(plannerAcceptance, 'taskId')
    ?? firstStringAt(params.completionEvidence, [['taskId'], ['cuNextTaskId']]);
  const scenarioId = stringAt(plannerAcceptance, 'scenarioId')
    ?? firstStringAt(params.completionEvidence, [['scenarioId'], ['cuLongScenarioId']]);
  const continuationContext = continuationContextFromActionProviderRequest(params.actionProviderRequest);
  const independentInputSessionRefs = uniqueStrings([
    completionEvidenceRef(params.completionEvidence, 'sessionManifestRef'),
    completionEvidenceRef(params.completionEvidence, 'targetWindowRef'),
  ].filter((item): item is string => Boolean(item)));
  const targetWindowRef = firstStringAt(params.completionEvidence, [
    ['targetWindowRef'],
    ['windowRef'],
    ['targetBinding', 'targetWindowRef'],
  ]);
  const beforeAxRef = firstStringAt(params.completionEvidence, [
    ['beforeAxRef'],
    ['beforeAccessibilityRef'],
    ['accessibilityEvidence', 'beforeAxRef'],
    ['accessibilityEvidence', 'beforeRef'],
  ]);
  const afterAxRef = firstStringAt(params.completionEvidence, [
    ['afterAxRef'],
    ['afterAccessibilityRef'],
    ['accessibilityEvidence', 'afterAxRef'],
    ['accessibilityEvidence', 'afterRef'],
  ]);
  const guiSaveCommandRef = firstStringAt(params.completionEvidence, [
    ['guiSaveCommandRef'],
    ['saveCommandRef'],
    ['saveIntentRef'],
    ['artifactCausality', 'guiSaveCommandRef'],
  ]);
  const fileCreationOwner = firstStringAt(params.completionEvidence, [
    ['fileCreationOwner'],
    ['creationOwner'],
    ['artifactCreationOwner'],
    ['artifactCausality', 'fileCreationOwner'],
  ]);
  const projectedTaskAcceptance = projectCuNextTaskAcceptanceMarkers(taskId as CuNextTaskId | undefined, {
    traceRef: ref('vision-trace.json'),
    requestRef: ref('computer-use-request.json'),
    verifierRef: ref(CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF),
    finalArtifactRef,
    finalVisibleScreenshotRef,
    focusCropRefs: effectiveFocusCropRefs,
    groundingDiagnosticsRefs: effectiveGroundingDiagnosticsRefs,
    sessionRefs: independentInputSessionRefs,
    blockedManifestRef: continuationContext ? ref('blocked-manifest.json') : undefined,
    repairHintRef: continuationContext ? ref('repair-hint.json') : undefined,
    continuationRequestRef: continuationContext ? ref('continuation-request.json') : undefined,
    directoryListingRef: ref('directory-listing.json'),
    denseGroundingRejectionRef: effectiveGroundingDiagnosticsRefs[0],
    targetWindowRef,
    beforeAxRef,
    afterAxRef,
    guiSaveCommandRef,
    fileCreationOwner,
  });
  const diagnosticProductPathProjection = buildPackageBridgeDiagnosticCurrentRunProjection({
    completionEvidence: params.completionEvidence,
    effectiveGroundingDiagnosticsRefs,
    effectiveFocusCropRefs,
    finalArtifactRef,
    finalVisibleScreenshotRef,
    packageResult: params.packageResult,
    ref,
    runDirRef,
    runId: params.state.runId,
    screenshotRefs,
  });
  const evidenceClaims: CuEvidenceClaim[] = [
    {
      id: 'package-bridge-vision-trace',
      kind: 'real-computer-use',
      ref: ref('vision-trace.json'),
      refs: [ref('vision-trace.json')],
      note: 'Completed package bridge Computer Use vision trace from the current run.',
    },
    {
      id: 'tui-host-runTask',
      kind: 'tui-host-runTask',
      ref: ref('computer-use-request.json'),
      refs: [ref('computer-use-request.json'), ref('host-ports.json'), ref('tui-host-run-task-chain.json')],
      note: 'Computer Use package bridge was invoked through TUI Host runTask evidence.',
    },
    {
      id: 'independent-input-adapter',
      kind: 'independent-input-adapter',
      ref: completionEvidenceRef(params.completionEvidence, 'inputEventLogRef') ?? ref(CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF),
      refs: uniqueStrings([
        completionEvidenceRef(params.completionEvidence, 'inputEventLogRef'),
        completionEvidenceRef(params.completionEvidence, 'pointerEventLogRef'),
        completionEvidenceRef(params.completionEvidence, 'keyboardEventLogRef'),
        completionEvidenceRef(params.completionEvidence, 'executorCommandEventLogRef'),
        completionEvidenceRef(params.completionEvidence, 'windowBoundPointerProofRef'),
      ].filter((item): item is string => Boolean(item))),
      sessionRefs: independentInputSessionRefs,
      note: 'Existing isolated L3 evidence proves virtual pointer and keyboard ownership; package bridge does not synthesize it.',
    },
    {
      id: 'gui-present-record',
      kind: 'gui-present-record',
      ref: ref('gui-present.json'),
      refs: [ref('gui-present.json'), ref('tool-payload.json')],
      artifactRefs: finalArtifactRef ? [finalArtifactRef] : [],
    },
    {
      id: 'completion-grade-evidence',
      kind: 'verifier-ref',
      ref: ref(CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF),
      refs: [ref(CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF)],
      note: 'Canonical current-run isolated desktop L3 workflow evidence was present before package bridge materialization.',
    },
  ];
  const chatOrigin = recordAt(requestMetadata, 'chatOrigin');
  if (chatOrigin) {
    evidenceClaims.unshift({
      id: 'chat-origin',
      kind: 'sciForge-chat-origin',
      status: 'present',
      ref: ref('computer-use-request.json'),
      refs: [ref('computer-use-request.json')],
      sessionRefs: [ref('computer-use-request.json')],
      origin: chatOrigin,
    });
  }
  return {
    runId: params.state.runId,
    taskId,
    scenarioId,
    createdAt: new Date().toISOString(),
    taskText: stringAt(params.actionProviderRequest, 'task') ?? stringAt(params.packageResult, 'message') ?? 'Completed Computer Use package bridge task.',
    level: 'L3',
    appWorkflow: {
      kind: 'multi-app-workflow',
      apps: workflowApps.length ? workflowApps : ['isolated-source-app', 'isolated-writer-app', 'isolated-preview-app'],
      windowSwitchTraceRefs,
    },
    productPathClassification: diagnosticProductPathProjection.productPathClassification,
    tuiHostChain: [
      {
        id: 'chat-origin',
        kind: 'sciForge-chat-origin',
        status: chatOrigin ? 'present' : 'missing',
        requestRef: ref('computer-use-request.json'),
        origin: chatOrigin,
      },
      {
        id: 'tui-host-runTask',
        kind: 'tui-host-runTask',
        status: 'present',
        requestRef: ref('computer-use-request.json'),
        hostPortsRef: ref('host-ports.json'),
      },
      {
        id: 'computer-use-action-provider',
        kind: 'computer-use-action-provider',
        status: 'present',
        toolPayloadRef: ref('tool-payload.json'),
      },
      {
        id: 'gui-present',
        kind: 'gui.present',
        status: 'present',
        recordRef: ref('gui-present.json'),
      },
    ],
    evidenceClaims,
    screenshotRefs,
    focusCropRefs: effectiveFocusCropRefs,
    groundingDiagnosticsRefs: effectiveGroundingDiagnosticsRefs,
    executorLease: diagnosticProductPathProjection.executorLease as NonNullable<CuUserAcceptanceInput['executorLease']>,
    finalArtifactRef,
    finalVisibleScreenshotRef,
    verifierVerdict: {
      status: 'passed',
      verdict: 'multi-app-workflow-passed',
      ref: ref(CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF),
      reason: 'Canonical current-run isolated desktop L3 workflow evidence was validator-accepted before manifest materialization.',
    },
    guiPresent: {
      status: 'present',
      recordRef: ref('gui-present.json'),
      payloadRef: ref('tool-payload.json'),
      displayedRefs: uniqueStrings([
        finalArtifactRef,
        finalVisibleScreenshotRef,
        ...diagnosticProductPathProjection.guiPresentDisplayedRefs,
      ].filter((item): item is string => Boolean(item))),
      recordRefs: [ref('gui-present.json')],
      artifactRefs: finalArtifactRef ? [finalArtifactRef] : [],
      sessionRefs: independentInputSessionRefs,
    },
    currentBundleRef: runDirRef,
    displayGroupId: diagnosticProductPathProjection.displayGroupId,
    screenId: diagnosticProductPathProjection.screenId,
    screenIds: [diagnosticProductPathProjection.screenId],
    actorId: diagnosticProductPathProjection.actorId,
    actorIds: [diagnosticProductPathProjection.actorId],
    cursorId: diagnosticProductPathProjection.cursorId,
    cursorIds: [diagnosticProductPathProjection.cursorId],
    virtualDisplayGroup: diagnosticProductPathProjection.virtualDisplayGroup,
    actorCursorProvenance: diagnosticProductPathProjection.actorCursorProvenance,
    executorLeases: [diagnosticProductPathProjection.executorLease],
    actionCausality: diagnosticProductPathProjection.actionCausality,
    replayBundle: diagnosticProductPathProjection.replayBundle,
    evidenceLedger: diagnosticProductPathProjection.evidenceLedger,
    evidenceMarkers: [
      ...recordArrayAt(params.completionEvidence, 'evidenceMarkers'),
      ...projectedTaskAcceptance.evidenceMarkers,
    ],
    completionEvidence: params.completionEvidence,
    completionEvidenceRef: CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF,
  };
}

function buildPackageBridgeDiagnosticCurrentRunProjection(params: {
  completionEvidence: Record<string, unknown>;
  effectiveFocusCropRefs: string[];
  effectiveGroundingDiagnosticsRefs: string[];
  finalArtifactRef?: string;
  finalVisibleScreenshotRef?: string;
  packageResult: Record<string, unknown>;
  ref: (name: string) => string;
  runDirRef: string;
  runId: string;
  screenshotRefs: { before: string[]; after: string[] };
}) {
  const displayGroupId = `${params.runId}-diagnostic-display-group`;
  const screenId = `${params.runId}-diagnostic-screen`;
  const windowId = `${params.runId}-diagnostic-window`;
  const actorId = `${params.runId}-diagnostic-actor`;
  const cursorId = `${params.runId}-diagnostic-cursor`;
  const leaseId = `${params.runId}-diagnostic-window-lease`;
  const toCurrentRunRef = (candidate: string | undefined): string | undefined => {
    if (!candidate) return undefined;
    const trimmed = candidate.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith(`${params.runDirRef}/`)) return trimmed;
    if (trimmed.startsWith('.sciforge/vision-runs/')) return undefined;
    if (!isBundleLocalRef(trimmed)) return undefined;
    return `${params.runDirRef}/${trimmed.replace(/^\.\//, '')}`;
  };
  const packageStep = recordArrayAt(params.packageResult, 'steps')[0];
  const beforeRef = toCurrentRunRef(stringAt(packageStep, 'beforeRef'))
    ?? toCurrentRunRef(params.screenshotRefs.before[0])
    ?? toCurrentRunRef(stringArrayAt(params.completionEvidence, 'screenshotRefs')[0])
    ?? params.ref(CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF);
  const afterRef = toCurrentRunRef(stringAt(packageStep, 'afterRef'))
    ?? toCurrentRunRef(params.screenshotRefs.after.at(-1))
    ?? toCurrentRunRef(stringArrayAt(params.completionEvidence, 'screenshotRefs').at(-1))
    ?? beforeRef;
  const finalVisibleRef = toCurrentRunRef(params.finalVisibleScreenshotRef)
    ?? toCurrentRunRef(firstStringAt(params.completionEvidence, [['presentationEvidence', 'finalVisibleScreenshotRef']]))
    ?? afterRef;
  const focusCropRefs = uniqueStrings(params.effectiveFocusCropRefs.map(toCurrentRunRef).filter((ref): ref is string => Boolean(ref)));
  const groundingRefs = uniqueStrings(params.effectiveGroundingDiagnosticsRefs.map(toCurrentRunRef).filter((ref): ref is string => Boolean(ref)));
  const evidenceIndexRefs = uniqueStrings([
    params.ref('directory-listing.json'),
    toCurrentRunRef(completionEvidenceRef(params.completionEvidence, 'evidenceIndexRef')),
  ].filter((ref): ref is string => Boolean(ref)));
  const packageAction = recordAt(packageStep, 'action') ?? recordAt(packageStep, 'plan');
  const actionKind = stringAt(packageAction, 'kind')
    ?? stringAt(packageAction, 'type')
    ?? 'diagnostic-package-action';
  const commonDiagnosticFlags = {
    diagnosticOnly: true,
    packageDiagnosticOnly: true,
    productSmokeEligible: false,
    productNativeEligible: false,
  };
  const leaseScope = {
    kind: 'window-local',
    displayGroupId,
    screenId,
    windowId,
    ...commonDiagnosticFlags,
  };
  const executorLease = {
    status: 'present',
    ref: toCurrentRunRef(completionEvidenceRef(params.completionEvidence, 'executorCommandEventLogRef'))
      ?? toCurrentRunRef(completionEvidenceRef(params.completionEvidence, 'inputEventLogRef'))
      ?? params.ref('host-ports.json'),
    owner: 'computer-use-package-bridge-diagnostic-projection',
    leaseId,
    screenId,
    windowId,
    actorId,
    cursorId,
    leaseScope,
    ...commonDiagnosticFlags,
  };
  const actionCausality = [compactEvidenceRecord({
    schemaVersion: 'sciforge.computer-use.diagnostic-action-causality.v1',
    actionKind,
    screenId,
    windowId,
    actorId,
    cursorId,
    leaseId,
    leaseScope,
    target: {
      scope: 'window',
      screenId,
      windowId,
    },
    inputIntentRef: params.ref('computer-use-request.json'),
    providerAdapterRef: params.ref('host-ports.json'),
    executorEventRef: params.ref('tui-host-run-task-chain.json'),
    beforeEvidenceRefs: [beforeRef],
    afterEvidenceRefs: uniqueStrings([afterRef, finalVisibleRef]),
    groundingRefs,
    verificationRefs: [params.ref(CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF)],
    artifactRefs: params.finalArtifactRef ? [params.finalArtifactRef] : undefined,
    evidenceIndexRefs,
    completionEvidenceEligible: false,
    ...commonDiagnosticFlags,
  })];
  const replayFrameRef = finalVisibleRef ?? afterRef;
  const replayBundle = compactEvidenceRecord({
    schemaVersion: 'sciforge.computer-use.diagnostic-replay-bundle.v1',
    ref: replayFrameRef,
    frames: [
      compactEvidenceRecord({
        screenId,
        screenshotRef: replayFrameRef,
        sourceEvidenceRefs: uniqueStrings([afterRef, finalVisibleRef]),
        cursorOverlayRefs: [params.ref(CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF)],
        ...commonDiagnosticFlags,
      }),
    ],
    cursorOverlayRefs: [params.ref(CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF)],
    leaseOwnerRefs: [executorLease.ref],
    beforeEvidenceRefs: [beforeRef],
    afterEvidenceRefs: [replayFrameRef],
    evidenceIndexRefs,
    ...commonDiagnosticFlags,
  });
  const virtualDisplayGroup = {
    schemaVersion: 'sciforge.computer-use.diagnostic-display-group.v1',
    displayGroupId,
    ref: params.ref('directory-listing.json'),
    currentBundleRef: params.runDirRef,
    screens: [
      compactEvidenceRecord({
        screenId,
        windowId,
        ref: replayFrameRef,
        screenRef: replayFrameRef,
        displayGroupId,
        evidenceRefs: uniqueStrings([beforeRef, afterRef, replayFrameRef]),
        ...commonDiagnosticFlags,
      }),
    ],
    windows: [
      {
        windowId,
        screenId,
        ref: params.ref('gui-present.json'),
        evidenceRefs: uniqueStrings([params.ref('gui-present.json'), replayFrameRef]),
        ...commonDiagnosticFlags,
      },
    ],
    ...commonDiagnosticFlags,
  };
  const actorCursorProvenance = [
    {
      actorId,
      cursorId,
      screenId,
      ref: params.ref(CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF),
      actorCursorLogRef: params.ref(CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF),
      displayGroupId,
      ...commonDiagnosticFlags,
    },
  ];
  const productPathClassification = {
    schemaVersion: 'sciforge.computer-use.product-path-classification.v1',
    tier: 'package-diagnostic',
    entrypoint: 'runtime-codex-native-route/package-bridge',
    hops: ['runtime-codex-native-route', 'workspace-runtime', 'computer-use-package-bridge', 'ts-host-port-loop'],
    appServerRunRef: params.ref('tui-host-run-task-chain.json'),
    sciforgeComputerUseRunTaskRef: params.ref('tui-host-run-task-chain.json'),
    currentBundleRef: params.runDirRef,
    currentBundleOnly: true,
    evidenceIndexRefs,
    ...commonDiagnosticFlags,
  };
  const evidenceLedger = {
    schemaVersion: 'sciforge.computer-use.diagnostic-evidence-ledger.v1',
    currentBundleRef: params.runDirRef,
    evidenceIndexRefs,
    displayGroupRefs: [virtualDisplayGroup.ref],
    screenRefs: [replayFrameRef],
    actionCausalityRefs: [params.ref('cu-user-acceptance-input.json')],
    replayRefs: [replayFrameRef],
    refs: uniqueStrings([
      params.ref('computer-use-request.json'),
      params.ref('host-ports.json'),
      params.ref('tool-payload.json'),
      params.ref('tui-host-run-task-chain.json'),
      params.ref('gui-present.json'),
      params.ref(CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF),
      params.finalArtifactRef,
      beforeRef,
      afterRef,
      finalVisibleRef,
      ...focusCropRefs,
      ...groundingRefs,
      ...evidenceIndexRefs,
    ].filter((ref): ref is string => Boolean(ref))),
    ...commonDiagnosticFlags,
  };
  return {
    actorCursorProvenance,
    actionCausality,
    actorId,
    cursorId,
    displayGroupId,
    evidenceLedger,
    executorLease,
    guiPresentDisplayedRefs: uniqueStrings([replayFrameRef].filter((ref): ref is string => Boolean(ref))),
    productPathClassification,
    replayBundle,
    screenId,
    virtualDisplayGroup,
  };
}

function packageBridgeCompletionGradeMapping(input: CuUserAcceptanceInput): CuNextTaskMapping {
  return {
    taskId: input.taskId ?? 'CU-NEXT-PACKAGE-BRIDGE',
    title: 'Computer Use package bridge completion-grade evidence',
    slug: 'package-bridge-completion-grade',
    priority: 1,
    primaryScenarioId: input.scenarioId ?? 'CU-LONG-PACKAGE-BRIDGE',
    longScenarioIds: [input.scenarioId ?? 'CU-LONG-PACKAGE-BRIDGE'],
    requirements: ['l3-workflow-refs', 'no-dom-playwright-accessibility'],
    recommendedTargetMode: 'active-window',
    recommendedMaxSteps: 1,
  };
}

function chatOriginFromActionProviderRequest(request: Record<string, unknown>) {
  const metadata = recordAt(request, 'metadata');
  const chatOrigin = recordAt(metadata, 'chatOrigin');
  if (!chatOrigin) return undefined;
  return compactEvidenceRecord({
    schemaVersion: stringAt(chatOrigin, 'schemaVersion') ?? 'sciforge.computer-use.chat-origin.v1',
    handoffSource: stringAt(chatOrigin, 'handoffSource'),
    entrypoint: stringAt(chatOrigin, 'entrypoint'),
    terminalEquivalentText: booleanAt(chatOrigin, 'terminalEquivalentText'),
    selectedActionProvider: stringAt(chatOrigin, 'selectedActionProvider'),
    requestRef: 'computer-use-request.json',
  });
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

function currentRunFinalVisibleScreenshotRef(runDir: string, runDirRef: string) {
  const candidates = [
    'final-visible.png',
    'final-visible.jpg',
    'final-visible.jpeg',
    'final-visible.webp',
  ];
  for (const candidate of candidates) {
    const path = resolve(runDir, candidate);
    if (!isPathInside(runDir, path)) continue;
    try {
      const info = lstatSync(path);
      if (info.isFile() && !info.isSymbolicLink()) return `${runDirRef}/${candidate}`;
    } catch {
      // Optional final-visible sidecar is best-effort; completion evidence refs remain authoritative.
    }
  }
  return undefined;
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
