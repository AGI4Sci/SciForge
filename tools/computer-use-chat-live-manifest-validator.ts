import type {
  AgentStreamEvent,
  NormalizedAgentResponse,
} from '../src/ui/src/domain.js';
import type { ComputerUseChatLivePreflightManifest } from './computer-use-chat-live-preflight.js';
import {
  readComputerUseChatJsonRefs as readJsonRefs,
  refsFromComputerUseTuiHostRunTaskChain as refsFromTuiHostRunTaskChain,
} from './computer-use-chat-live-evidence-refs.js';
import {
  chatLiveFailureDiagnostics,
} from './computer-use-chat-live-diagnostics.js';
import {
  clipText,
  isRecord,
  parseJsonRecord,
  recordAt,
  recordList,
  refsFromUnknown,
  stringAt,
  stringList,
  uniqueStrings,
} from './computer-use-chat-live-json.js';
import type {
  ComputerUseChatLiveE2EExpectedStatus,
  ComputerUseChatLiveE2EManifest,
} from './computer-use-chat-live-e2e.js';

export interface LoadedApprovalEvidence {
  approvalRequestRefs: string[];
  guiAskUserRecordRefs: string[];
  riskAuditRefs: string[];
  confirmedRequestRefs: string[];
  approvalDecisionRefs: string[];
  sourceApprovalRequestRefs: string[];
  sourceGuiAskUserRecordRefs: string[];
  sourceRiskAuditRefs: string[];
  approvalRequestSidecar?: Record<string, unknown>;
  guiAskUserSidecar?: Record<string, unknown>;
  riskAuditSidecar?: Record<string, unknown>;
  confirmedRequestSidecar?: Record<string, unknown>;
  approvalDecisionSidecar?: Record<string, unknown>;
  sourceApprovalRequestSidecar?: Record<string, unknown>;
  sourceGuiAskUserSidecar?: Record<string, unknown>;
  sourceRiskAuditSidecar?: Record<string, unknown>;
  readIssues: string[];
}

export function validateComputerUseChatLiveE2EResponse(input: {
  response: NormalizedAgentResponse;
  events?: AgentStreamEvent[];
  expectedStatus: ComputerUseChatLiveE2EExpectedStatus;
  prompt: string;
  preflight: ComputerUseChatLivePreflightManifest;
  approvalEvidence?: LoadedApprovalEvidence;
  checkedAt: string;
}): ComputerUseChatLiveE2EManifest {
  const raw = isRecord(input.response.run.raw) ? input.response.run.raw : {};
  const guiPresentation = isRecord(raw.guiPresentation) ? raw.guiPresentation : undefined;
  const guiAskUser = isRecord(raw.guiAskUser) ? raw.guiAskUser : undefined;
  const displayIntent = isRecord(raw.displayIntent) ? raw.displayIntent : undefined;
  const projection = isRecord(displayIntent?.conversationProjection) ? displayIntent.conversationProjection : undefined;
  const visibleAnswer = isRecord(projection?.visibleAnswer) ? projection.visibleAnswer : undefined;
  const visibleStatus = stringAt(visibleAnswer, 'status');
  const displayedRefs = uniqueStrings([
    ...stringList(guiPresentation?.displayedRefs),
    ...stringList(guiAskUser?.displayedRefs),
    ...stringList(guiAskUser?.relatedRefs),
  ]);
  const artifactRefs = uniqueStrings([
    ...stringList(visibleAnswer?.artifactRefs),
    ...recordList(projection?.artifacts).map((artifact) => stringAt(artifact, 'ref')),
  ]);
  const auditRefs = uniqueStrings(stringList(projection?.auditRefs));
  const recoverActions = uniqueStrings(stringList(projection?.recoverActions));
  const actualStatus = manifestStatusFromVisibleStatus(visibleStatus, input.response.run.status);
  const allRefs = uniqueStrings([...displayedRefs, ...artifactRefs, ...auditRefs]);
  const approvalEvidence = input.approvalEvidence ?? approvalEvidenceFromRefs(allRefs);
  const approvalRequestSummary = mergeApprovalRequestSummaries([
    approvalRequestSummaryFromGuiAskUser(guiAskUser),
    approvalRequestSummaryFromSidecar(approvalEvidence.approvalRequestSidecar),
    approvalRequestSummaryFromSidecar(approvalEvidence.riskAuditSidecar),
  ]);
  const deniedExecutionProof = deniedExecutionProofFromEvidence({ actualStatus, guiAskUser, approvalEvidence });
  const confirmedApproval = confirmedApprovalSummaryFromEvidence(approvalEvidence);
  const finalArtifactRef = artifactRefs[0];
  const eventTypes = uniqueStrings((input.events ?? []).map((event) => event.type));
  const sawComputerUseHostActions = eventTypes.includes('computer-use.tui-host-actions');
  const expectedRunStatus = input.expectedStatus === 'confirmed-approval-retry' ? 'completed' : input.expectedStatus;
  const issues = [
    !sawComputerUseHostActions ? 'missing-computer-use-tui-host-actions-event' : undefined,
    !guiPresentation && !guiAskUser ? 'missing-gui-present-or-gui-ask-user' : undefined,
    guiPresentation && !/computer-use/i.test(stringAt(guiPresentation, 'source') ?? '') ? 'gui-present-not-computer-use-sourced' : undefined,
    guiAskUser && !/computer-use/i.test(stringAt(guiAskUser, 'source') ?? '') ? 'gui-ask-user-not-computer-use-sourced' : undefined,
    !allRefs.some((ref) => /(?:^|\/)vision-trace\.json$/i.test(ref)) ? 'missing-vision-trace-ref' : undefined,
    !allRefs.some((ref) => /(?:^|\/)tui-host-run-task-chain\.json$/i.test(ref)) ? 'missing-tui-host-run-task-chain-ref' : undefined,
    input.expectedStatus === 'completed' && !artifactRefs.length ? 'completed-run-missing-artifact-ref' : undefined,
    input.expectedStatus === 'completed' && finalArtifactRef && guiPresentation && !displayedRefs.includes(finalArtifactRef)
      ? 'gui-present-missing-final-artifact-ref'
      : undefined,
    input.expectedStatus === 'needs-confirmation' && !isRecord(guiAskUser?.approvalRequest) ? 'needs-confirmation-missing-approval-request' : undefined,
    input.expectedStatus === 'needs-confirmation' && !approvalEvidence.approvalRequestRefs.length ? 'needs-confirmation-missing-approval-request-ref' : undefined,
    input.expectedStatus === 'needs-confirmation' && !approvalEvidence.guiAskUserRecordRefs.length ? 'needs-confirmation-missing-gui-ask-user-record-ref' : undefined,
    input.expectedStatus === 'needs-confirmation' && !approvalRequestSummary?.approvalRef ? 'needs-confirmation-missing-approval-ref' : undefined,
    input.expectedStatus === 'needs-confirmation' && !approvalRequestLooksHighRisk(approvalRequestSummary) ? 'needs-confirmation-approval-request-not-high-risk' : undefined,
    input.expectedStatus === 'needs-confirmation' && !approvalEvidence.riskAuditRefs.length && !approvalEvidence.riskAuditSidecar ? 'needs-confirmation-missing-risk-audit-ref' : undefined,
    input.expectedStatus === 'needs-confirmation' && approvalEvidence.confirmedRequestRefs.length ? 'needs-confirmation-unexpected-confirmed-request-ref' : undefined,
    input.expectedStatus === 'needs-confirmation' && !deniedExecutionProof ? 'needs-confirmation-missing-denied-execution-proof' : undefined,
    input.expectedStatus === 'needs-confirmation' && !needsConfirmationSidecarsDenyExecution(approvalEvidence) ? 'needs-confirmation-missing-deniedExecuted-false' : undefined,
    input.expectedStatus === 'needs-confirmation' && loadedSidecarExecuted(approvalEvidence) ? 'needs-confirmation-sidecar-indicates-executed' : undefined,
    input.expectedStatus === 'needs-confirmation' && !approvalRefsConsistent(approvalRequestSummary?.approvalRef, approvalEvidence) ? 'needs-confirmation-approval-ref-mismatch' : undefined,
    ...(input.expectedStatus === 'confirmed-approval-retry'
      ? confirmedRetryApprovalIssues({
          evidence: approvalEvidence,
          confirmedApproval,
          currentRunId: input.response.run.id,
        })
      : []),
    actualStatus !== expectedRunStatus ? `expected-${input.expectedStatus}-got-${actualStatus}` : undefined,
  ].filter((issue): issue is string => Boolean(issue));
  const manifestStatus = input.expectedStatus === 'confirmed-approval-retry' && !issues.length
    ? 'confirmed-approval-retry'
    : actualStatus;
  return {
    schemaVersion: 'sciforge.computer-use.chat-live-e2e.v1',
    checkedAt: input.checkedAt,
    status: issues.length ? 'failed' : manifestStatus,
    expectedStatus: input.expectedStatus,
    releaseAcceptance: 'not-evaluated',
    evidenceMode: 'current-chat-run-only',
    preflight: preflightSummary(input.preflight),
    prompt: input.prompt,
    runId: input.response.run.id,
    visibleStatus,
    guiPresentSource: stringAt(guiPresentation, 'source'),
    guiAskUserSource: stringAt(guiAskUser, 'source'),
    displayIntentSource: stringAt(displayIntent, 'source'),
    messageExcerpt: clipText(input.response.message.content, 360),
    eventTypes,
    eventSummaries: (input.events ?? []).slice(-12).map((event) => ({
      type: event.type,
      label: event.label,
      status: stringAt(event, 'status'),
      detailExcerpt: clipText(event.detail, 240),
    })),
    displayedRefs,
    artifactRefs,
    auditRefs,
    approvalRequestRefs: approvalEvidence.approvalRequestRefs,
    guiAskUserRecordRefs: approvalEvidence.guiAskUserRecordRefs,
    riskAuditRefs: approvalEvidence.riskAuditRefs,
    confirmedRequestRefs: approvalEvidence.confirmedRequestRefs,
    approvalDecisionRefs: approvalEvidence.approvalDecisionRefs,
    sourceApprovalRequestRefs: approvalEvidence.sourceApprovalRequestRefs,
    sourceGuiAskUserRecordRefs: approvalEvidence.sourceGuiAskUserRecordRefs,
    sourceRiskAuditRefs: approvalEvidence.sourceRiskAuditRefs,
    approvalRequest: approvalRequestSummary,
    confirmedApproval,
    deniedExecutionProof,
    evidenceReadIssues: approvalEvidence.readIssues,
    recoverActions,
    failureDiagnostics: chatLiveFailureDiagnostics({
      expectedStatus: input.expectedStatus,
      artifactRefs,
      displayedRefs,
      auditRefs,
      guiPresentation,
    }),
    issues,
    requestSubmitted: true,
    liveAcceptanceCandidate: issues.length === 0 && input.expectedStatus === 'completed' && actualStatus === 'completed',
  };
}

export async function loadApprovalEvidenceFromCurrentRun(input: {
  response: NormalizedAgentResponse;
  events?: AgentStreamEvent[];
  workspacePath: string;
}): Promise<LoadedApprovalEvidence> {
  const rawRefs = currentRunRefs(input.response, input.events);
  const readIssues: string[] = [];
  const runTaskChains = await readJsonRefs(
    rawRefs.filter((ref) => /(?:^|\/)tui-host-run-task-chain\.json$/i.test(ref)),
    input.workspacePath,
    readIssues,
  );
  const directoryListings = await readJsonRefs(
    rawRefs.filter((ref) => /(?:^|\/)directory-listing\.json$/i.test(ref)),
    input.workspacePath,
    readIssues,
  );
  const expandedRefs = uniqueStrings([
    ...rawRefs,
    ...runTaskChains.flatMap(refsFromTuiHostRunTaskChain),
    ...directoryListings.flatMap((listing) => stringList(listing.fileRefs)),
  ]);
  const refsEvidence = approvalEvidenceFromRefs(expandedRefs);
  const [approvalRequestSidecar] = await readJsonRefs(refsEvidence.approvalRequestRefs.slice(0, 1), input.workspacePath, readIssues);
  const [guiAskUserSidecar] = await readJsonRefs(refsEvidence.guiAskUserRecordRefs.slice(0, 1), input.workspacePath, readIssues);
  const [riskAuditSidecar] = await readJsonRefs(refsEvidence.riskAuditRefs.slice(0, 1), input.workspacePath, readIssues);
  const [confirmedRequestSidecar] = await readJsonRefs(refsEvidence.confirmedRequestRefs.slice(0, 1), input.workspacePath, readIssues);
  const [approvalDecisionSidecar] = await readJsonRefs(refsEvidence.approvalDecisionRefs.slice(0, 1), input.workspacePath, readIssues);
  const [sourceApprovalRequestSidecar] = await readJsonRefs(refsEvidence.sourceApprovalRequestRefs.slice(0, 1), input.workspacePath, readIssues);
  const [sourceGuiAskUserSidecar] = await readJsonRefs(refsEvidence.sourceGuiAskUserRecordRefs.slice(0, 1), input.workspacePath, readIssues);
  const [sourceRiskAuditSidecar] = await readJsonRefs(refsEvidence.sourceRiskAuditRefs.slice(0, 1), input.workspacePath, readIssues);
  return {
    ...refsEvidence,
    approvalRequestSidecar,
    guiAskUserSidecar,
    riskAuditSidecar,
    confirmedRequestSidecar,
    approvalDecisionSidecar,
    sourceApprovalRequestSidecar,
    sourceGuiAskUserSidecar,
    sourceRiskAuditSidecar,
    readIssues: uniqueStrings(readIssues),
  };
}

export function emptyLoadedApprovalEvidence(): LoadedApprovalEvidence {
  return approvalEvidenceFromRefs([]);
}

export function refsFromAgentStreamEvent(event: AgentStreamEvent): string[] {
  const detail = parseJsonRecord(event.detail);
  const actions = recordList(detail?.actions);
  return uniqueStrings(actions.flatMap((action) => refsFromUnknown(action)));
}

export function approvalRequestLooksHighRisk(summary: ComputerUseChatLiveE2EManifest['approvalRequest'] | undefined): boolean {
  if (!summary) return false;
  if (/^(?:high|critical|danger)$/i.test(summary.riskLevel ?? '')) return true;
  return /send|upload|submit|publish|delete|external|post/i.test(summary.actionKind ?? '');
}

export function needsConfirmationSidecarsDenyExecution(evidence: LoadedApprovalEvidence): boolean {
  return [
    evidence.approvalRequestSidecar,
    evidence.guiAskUserSidecar,
    evidence.riskAuditSidecar,
  ].every((record) => isRecord(record) && record.deniedExecuted === false);
}

export function loadedSidecarExecuted(evidence: LoadedApprovalEvidence): boolean {
  return [
    evidence.approvalRequestSidecar,
    evidence.guiAskUserSidecar,
    evidence.riskAuditSidecar,
    evidence.confirmedRequestSidecar,
  ].some((record) => isRecord(record) && record.deniedExecuted === true);
}

export function approvalIdentityFromSidecar(record: Record<string, unknown> | undefined) {
  const approvalRequest = recordAt(record, 'approvalRequest') ?? recordAt(recordAt(record, 'payload'), 'approvalRequest');
  return {
    approvalRef: stringAt(record, 'approvalRef')
      ?? stringAt(record, 'approval_ref')
      ?? stringAt(record, 'canonicalApprovalRef')
      ?? stringAt(record, 'originalApprovalRef')
      ?? stringAt(approvalRequest, 'approvalRef')
      ?? stringAt(approvalRequest, 'approval_ref'),
    approvalRequestId: stringAt(record, 'approvalRequestId')
      ?? stringAt(record, 'approval_request_id')
      ?? stringAt(record, 'originalApprovalRequestId')
      ?? stringAt(approvalRequest, 'approvalRequestId')
      ?? stringAt(approvalRequest, 'approval_request_id')
      ?? stringAt(approvalRequest, 'id'),
    riskActionHash: stringAt(record, 'riskActionHash')
      ?? stringAt(record, 'risk_action_hash')
      ?? stringAt(record, 'originalRiskActionHash')
      ?? stringAt(approvalRequest, 'riskActionHash')
      ?? stringAt(approvalRequest, 'risk_action_hash'),
  };
}

export function approvalRefLooksSessionDerived(approvalRef: string, currentRunId: string): boolean {
  const normalized = approvalRef.trim().toLowerCase();
  if (/^(?:approval:)?(?:session|run|turn|conversation)[:/-]/i.test(normalized)) return true;
  if (/^approval:(?:session|run|turn|conversation)\b/i.test(normalized)) return true;
  if (/computer-use-chat-live-(?:e2e|continuation)-\d+/i.test(normalized)) return true;
  return Boolean(currentRunId.trim()) && normalized.includes(currentRunId.trim().toLowerCase());
}

export function approvalRefsConsistent(approvalRef: string | undefined, evidence: LoadedApprovalEvidence): boolean {
  if (!approvalRef) return true;
  const sidecarRefs = [
    evidence.approvalRequestSidecar,
    evidence.guiAskUserSidecar,
    evidence.riskAuditSidecar,
  ].flatMap((record) => {
    if (!isRecord(record)) return [];
    const nested = isRecord(record.approvalRequest)
      ? record.approvalRequest
      : isRecord(record.payload) && isRecord(record.payload.approvalRequest)
        ? record.payload.approvalRequest
        : undefined;
    return uniqueStrings([
      stringAt(record, 'approvalRef'),
      stringAt(record, 'approval_ref'),
      stringAt(nested, 'approvalRef'),
      stringAt(nested, 'approval_ref'),
      stringAt(nested, 'id')?.startsWith('approval:') ? stringAt(nested, 'id') : undefined,
    ]);
  });
  return sidecarRefs.every((ref) => ref === approvalRef);
}

export function preflightSummary(preflight: ComputerUseChatLivePreflightManifest): ComputerUseChatLiveE2EManifest['preflight'] {
  return {
    schemaVersion: preflight.schemaVersion,
    status: preflight.status,
    missingEnv: preflight.missingEnv,
    policyViolations: preflight.policyViolations,
    serviceChecks: preflight.serviceChecks,
  };
}

function currentRunRefs(response: NormalizedAgentResponse, events: AgentStreamEvent[] | undefined): string[] {
  const raw = isRecord(response.run.raw) ? response.run.raw : {};
  const guiPresentation = isRecord(raw.guiPresentation) ? raw.guiPresentation : undefined;
  const guiAskUser = isRecord(raw.guiAskUser) ? raw.guiAskUser : undefined;
  const displayIntent = isRecord(raw.displayIntent) ? raw.displayIntent : undefined;
  const projection = isRecord(displayIntent?.conversationProjection) ? displayIntent.conversationProjection : undefined;
  const visibleAnswer = isRecord(projection?.visibleAnswer) ? projection.visibleAnswer : undefined;
  return uniqueStrings([
    ...stringList(guiPresentation?.displayedRefs),
    ...stringList(guiAskUser?.displayedRefs),
    ...stringList(guiAskUser?.relatedRefs),
    ...stringList(visibleAnswer?.artifactRefs),
    ...recordList(projection?.artifacts).map((artifact) => stringAt(artifact, 'ref')),
    ...stringList(projection?.auditRefs),
    ...(events ?? []).flatMap(refsFromAgentStreamEvent),
  ]);
}

function approvalEvidenceFromRefs(refs: string[]): LoadedApprovalEvidence {
  return {
    approvalRequestRefs: refs.filter((ref) => /(?:^|\/)approval-request\.json$/i.test(ref)),
    guiAskUserRecordRefs: refs.filter((ref) => /(?:^|\/)gui-ask-user\.json$/i.test(ref)),
    riskAuditRefs: refs.filter((ref) => /(?:^|\/)risk-audit\.json$/i.test(ref)),
    confirmedRequestRefs: refs.filter((ref) => /(?:^|\/)confirmed-request\.json$/i.test(ref)),
    approvalDecisionRefs: refs.filter((ref) => /(?:^|\/)approval-decision\.json$/i.test(ref)),
    sourceApprovalRequestRefs: refs.filter((ref) => /(?:^|\/)approval-source-request\.json$/i.test(ref)),
    sourceGuiAskUserRecordRefs: refs.filter((ref) => /(?:^|\/)approval-source-gui-ask-user\.json$/i.test(ref)),
    sourceRiskAuditRefs: refs.filter((ref) => /(?:^|\/)approval-source-risk-audit\.json$/i.test(ref)),
    readIssues: [],
  };
}

function approvalRequestSummaryFromGuiAskUser(guiAskUser: Record<string, unknown> | undefined): ComputerUseChatLiveE2EManifest['approvalRequest'] | undefined {
  const approvalRequest = isRecord(guiAskUser?.approvalRequest) ? guiAskUser.approvalRequest : undefined;
  return approvalRequestSummaryFromRecord(approvalRequest);
}

function approvalRequestSummaryFromSidecar(sidecar: Record<string, unknown> | undefined): ComputerUseChatLiveE2EManifest['approvalRequest'] | undefined {
  const approvalRequest = isRecord(sidecar?.approvalRequest)
    ? sidecar.approvalRequest
    : isRecord(recordAt(sidecar, 'payload')?.approvalRequest)
      ? recordAt(sidecar, 'payload')?.approvalRequest
      : sidecar;
  return mergeApprovalRequestSummaries([
    approvalRequestSummaryFromRecord(isRecord(approvalRequest) ? approvalRequest : undefined),
    approvalRequest === sidecar ? undefined : approvalRequestSummaryFromRecord(sidecar),
  ]);
}

function approvalRequestSummaryFromRecord(record: Record<string, unknown> | undefined): ComputerUseChatLiveE2EManifest['approvalRequest'] | undefined {
  if (!record) return undefined;
  const highRiskAction = recordAt(record, 'highRiskAction') ?? recordAt(recordAt(record, 'approvalBoundary'), 'highRiskAction');
  const reason = stringAt(record, 'reason') ?? stringAt(recordAt(record, 'approvalBoundary'), 'reason');
  const riskLevel = stringAt(record, 'riskLevel')
    ?? stringAt(record, 'risk_level')
    ?? stringAt(record, 'risk')
    ?? (highRiskAction || /high[- ]?risk/i.test(reason ?? '') ? 'high' : undefined);
  return {
    approvalRef: stringAt(record, 'approvalRef') ?? stringAt(record, 'approval_ref') ?? stringAt(record, 'id'),
    approvalRequestId: stringAt(record, 'approvalRequestId') ?? stringAt(record, 'approval_request_id') ?? stringAt(record, 'id'),
    riskLevel,
    actionKind: stringAt(record, 'actionKind')
      ?? stringAt(record, 'action_kind')
      ?? stringAt(record, 'actionRef')
      ?? stringAt(record, 'action_ref')
      ?? stringAt(highRiskAction, 'actionKind')
      ?? stringAt(highRiskAction, 'action_kind'),
  };
}

function mergeApprovalRequestSummaries(
  summaries: Array<ComputerUseChatLiveE2EManifest['approvalRequest'] | undefined>,
): ComputerUseChatLiveE2EManifest['approvalRequest'] | undefined {
  const records = summaries.filter((summary): summary is NonNullable<ComputerUseChatLiveE2EManifest['approvalRequest']> => Boolean(summary));
  if (!records.length) return undefined;
  return {
    approvalRef: records.find((summary) => summary.approvalRef)?.approvalRef,
    approvalRequestId: records.find((summary) => summary.approvalRequestId)?.approvalRequestId,
    riskLevel: records.find((summary) => summary.riskLevel)?.riskLevel,
    actionKind: records.find((summary) => summary.actionKind)?.actionKind,
  };
}

function deniedExecutionProofFromEvidence(input: {
  actualStatus: ComputerUseChatLiveE2EExpectedStatus;
  guiAskUser: Record<string, unknown> | undefined;
  approvalEvidence: LoadedApprovalEvidence;
}): ComputerUseChatLiveE2EManifest['deniedExecutionProof'] | undefined {
  const explicitRefs = [
    [input.approvalEvidence.approvalRequestSidecar, input.approvalEvidence.approvalRequestRefs[0]],
    [input.approvalEvidence.guiAskUserSidecar, input.approvalEvidence.guiAskUserRecordRefs[0]],
    [input.approvalEvidence.riskAuditSidecar, input.approvalEvidence.riskAuditRefs[0]],
  ].flatMap(([record, ref]) => isRecord(record) && record.deniedExecuted === false && typeof ref === 'string' ? [ref] : []);
  if (explicitRefs.length) return { kind: 'explicit-sidecar-deniedExecuted-false', refs: uniqueStrings(explicitRefs) };
  if (
    input.actualStatus === 'needs-confirmation'
    && input.guiAskUser
    && !input.approvalEvidence.confirmedRequestRefs.length
    && !input.approvalEvidence.confirmedRequestSidecar
  ) {
    return { kind: 'equivalent-no-confirmed-request', refs: input.approvalEvidence.riskAuditRefs };
  }
  return undefined;
}

function confirmedApprovalSummaryFromEvidence(evidence: LoadedApprovalEvidence): ComputerUseChatLiveE2EManifest['confirmedApproval'] | undefined {
  const identities = [
    approvalIdentityFromSidecar(evidence.confirmedRequestSidecar),
    approvalIdentityFromSidecar(evidence.approvalDecisionSidecar),
    approvalIdentityFromSidecar(evidence.riskAuditSidecar),
    approvalIdentityFromSidecar(evidence.sourceApprovalRequestSidecar),
    approvalIdentityFromSidecar(evidence.sourceGuiAskUserSidecar),
    approvalIdentityFromSidecar(evidence.sourceRiskAuditSidecar),
  ];
  const approvalRef = identities.find((identity) => identity.approvalRef)?.approvalRef;
  const approvalRequestId = identities.find((identity) => identity.approvalRequestId)?.approvalRequestId;
  const riskActionHash = identities.find((identity) => identity.riskActionHash)?.riskActionHash;
  if (!approvalRef && !approvalRequestId && !riskActionHash) return undefined;
  return { approvalRef, approvalRequestId, riskActionHash };
}

function confirmedRetryApprovalIssues(input: {
  evidence: LoadedApprovalEvidence;
  confirmedApproval: ComputerUseChatLiveE2EManifest['confirmedApproval'] | undefined;
  currentRunId: string;
}): string[] {
  const evidence = input.evidence;
  const issues: string[] = [];
  const requiredRefs: Array<[keyof LoadedApprovalEvidence, string]> = [
    ['sourceApprovalRequestRefs', 'confirmed-retry-missing-source-approval-request-ref'],
    ['sourceGuiAskUserRecordRefs', 'confirmed-retry-missing-source-gui-ask-user-record-ref'],
    ['sourceRiskAuditRefs', 'confirmed-retry-missing-source-risk-audit-ref'],
    ['approvalDecisionRefs', 'confirmed-retry-missing-approval-decision-ref'],
    ['confirmedRequestRefs', 'confirmed-retry-missing-confirmed-request-ref'],
    ['riskAuditRefs', 'confirmed-retry-missing-risk-audit-ref'],
  ];
  for (const [key, issue] of requiredRefs) {
    const refs = evidence[key];
    if (!Array.isArray(refs) || refs.length === 0) issues.push(issue);
  }
  const requiredRecords: Array<[Record<string, unknown> | undefined, string, 'needs-confirmation' | 'confirmed']> = [
    [evidence.sourceApprovalRequestSidecar, 'source-approval-request', 'needs-confirmation'],
    [evidence.sourceGuiAskUserSidecar, 'source-gui-ask-user', 'needs-confirmation'],
    [evidence.sourceRiskAuditSidecar, 'source-risk-audit', 'needs-confirmation'],
    [evidence.approvalDecisionSidecar, 'approval-decision', 'confirmed'],
    [evidence.confirmedRequestSidecar, 'confirmed-request', 'confirmed'],
    [evidence.riskAuditSidecar, 'risk-audit', 'confirmed'],
  ];
  const canonical = input.confirmedApproval;
  if (!canonical?.approvalRef) issues.push('confirmed-retry-missing-canonical-approval-ref');
  else if (approvalRefLooksSessionDerived(canonical.approvalRef, input.currentRunId)) {
    issues.push('confirmed-retry-session-derived-approval-ref');
  }
  if (!canonical?.approvalRequestId) issues.push('confirmed-retry-missing-approval-request-id');
  if (!canonical?.riskActionHash) issues.push('confirmed-retry-missing-risk-action-hash');
  for (const [record, label, expectedStatus] of requiredRecords) {
    if (!isRecord(record)) {
      issues.push(`confirmed-retry-missing-${label}-sidecar`);
      continue;
    }
    const identity = approvalIdentityFromSidecar(record);
    if (!identity.approvalRef) issues.push(`confirmed-retry-${label}-missing-approval-ref`);
    else if (canonical?.approvalRef && identity.approvalRef !== canonical.approvalRef) issues.push(`confirmed-retry-${label}-approval-ref-mismatch`);
    if (!identity.approvalRequestId) issues.push(`confirmed-retry-${label}-missing-approval-request-id`);
    else if (canonical?.approvalRequestId && identity.approvalRequestId !== canonical.approvalRequestId) issues.push(`confirmed-retry-${label}-approval-request-id-mismatch`);
    if (!identity.riskActionHash) issues.push(`confirmed-retry-${label}-missing-risk-action-hash`);
    else if (canonical?.riskActionHash && identity.riskActionHash !== canonical.riskActionHash) issues.push(`confirmed-retry-${label}-risk-action-hash-mismatch`);
    if (stringAt(record, 'status') !== expectedStatus) issues.push(`confirmed-retry-${label}-status-not-${expectedStatus}`);
    if (record.deniedExecuted !== false) issues.push(`confirmed-retry-${label}-missing-deniedExecuted-false`);
    if (record.packageMayCallGuiDirectly === true) issues.push(`confirmed-retry-${label}-allows-package-gui-direct-call`);
  }
  const confirmedRequestRef = evidence.confirmedRequestRefs[0];
  const sourceApprovalRequestRef = evidence.sourceApprovalRequestRefs[0];
  const sourceGuiAskUserRecordRef = evidence.sourceGuiAskUserRecordRefs[0];
  const sourceRiskAuditRef = evidence.sourceRiskAuditRefs[0];
  const sourceRefChecks: Array<[Record<string, unknown> | undefined, string]> = [
    [evidence.confirmedRequestSidecar, 'confirmed-request'],
    [evidence.approvalDecisionSidecar, 'approval-decision'],
    [evidence.riskAuditSidecar, 'risk-audit'],
  ];
  for (const [record, label] of sourceRefChecks) {
    if (!isRecord(record)) continue;
    if (confirmedRequestRef && refAtRecordOrBoundary(record, 'confirmedRequestRef') !== confirmedRequestRef) {
      issues.push(`confirmed-retry-${label}-confirmed-request-ref-mismatch`);
    }
    if (sourceApprovalRequestRef && refAtRecordOrBoundary(record, 'sourceApprovalRequestRef') !== sourceApprovalRequestRef) {
      issues.push(`confirmed-retry-${label}-source-approval-request-ref-mismatch`);
    }
    if (sourceGuiAskUserRecordRef && refAtRecordOrBoundary(record, 'sourceGuiAskUserRecordRef') !== sourceGuiAskUserRecordRef) {
      issues.push(`confirmed-retry-${label}-source-gui-ask-user-ref-mismatch`);
    }
    if (sourceRiskAuditRef && refAtRecordOrBoundary(record, 'sourceRiskAuditRef') !== sourceRiskAuditRef) {
      issues.push(`confirmed-retry-${label}-source-risk-audit-ref-mismatch`);
    }
  }
  if (isRecord(evidence.approvalDecisionSidecar) && stringAt(evidence.approvalDecisionSidecar, 'decision') !== 'approved') {
    issues.push('confirmed-retry-approval-decision-not-approved');
  }
  return uniqueStrings(issues);
}

function refAtRecordOrBoundary(record: Record<string, unknown>, key: string): string | undefined {
  return stringAt(record, key) ?? stringAt(recordAt(record, 'approvalBoundary'), key);
}

function manifestStatusFromVisibleStatus(visibleStatus: string | undefined, runStatus: string): ComputerUseChatLiveE2EExpectedStatus {
  if (visibleStatus === 'output-materialized') return 'completed';
  if (visibleStatus === 'needs-human') return 'needs-confirmation';
  if (visibleStatus === 'repair-needed') return 'repair-needed';
  if (visibleStatus === 'external-blocked') return 'blocked';
  if (runStatus === 'completed') return 'completed';
  return 'blocked';
}
