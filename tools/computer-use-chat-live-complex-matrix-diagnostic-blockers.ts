import type {
  ComputerUseChatLiveE2EExpectedStatus,
  ComputerUseChatLiveE2EManifest,
} from './computer-use-chat-live-e2e-contract.js';
import type { ComputerUseChatLiveComplexMatrixDiagnosticBlocker } from './computer-use-chat-live-complex-matrix-contract.js';
import type { CuNextEvidenceClassification } from './computer-use-next/evidence-classification.js';

type DiagnosticBlockerCategory = ComputerUseChatLiveComplexMatrixDiagnosticBlocker['category'];

export function diagnosticBlockersForComplexMatrixAggregateCase(input: {
  expectedStatus: ComputerUseChatLiveE2EExpectedStatus;
  evidenceClassification: Pick<
    CuNextEvidenceClassification,
    'kind' | 'canCompleteBackend' | 'canCompleteL3Workflow' | 'blockedReasons' | 'rejectedShortcuts' | 'claimLimit'
  >;
  runManifest: ComputerUseChatLiveE2EManifest;
  issues: string[];
}): ComputerUseChatLiveComplexMatrixDiagnosticBlocker[] {
  const issues = uniqueStrings([
    ...input.issues,
    ...input.runManifest.issues,
    ...input.evidenceClassification.blockedReasons.map((reason) => `classification-blocked:${reason}`),
    ...input.evidenceClassification.rejectedShortcuts.map((shortcut) => `rejected-shortcut:${shortcut}`),
    input.evidenceClassification.claimLimit ? `claim-limit:${input.evidenceClassification.claimLimit}` : '',
  ]);
  const searchText = searchableDiagnosticText(input.runManifest, issues);
  const refs = diagnosticRefs(input.runManifest);
  const blockers: ComputerUseChatLiveComplexMatrixDiagnosticBlocker[] = [];

  if (plannerRouteBlocked(searchText)) {
    blockers.push(makeBlocker({
      category: 'planner-route',
      summary: 'Plan-stage package bridge or runtime route returned repair-needed before product completion.',
      refs: plannerRouteRefs(input.runManifest, refs),
      issues: matchingIssues(issues, [/package[- ]bridge/i, /planner/i, /repair-needed/i, /^expected-.+-got-repair-needed$/i]),
    }));
  }

  if (nativeHostEvidenceBlocked(issues)) {
    blockers.push(makeBlocker({
      category: 'native-host-evidence',
      summary: 'Current run is missing native host, GUI, trace, or run-task-chain evidence refs.',
      refs,
      issues: matchingIssues(issues, [
        /missing-computer-use-tui-host-actions/i,
        /missing-gui-present/i,
        /missing-gui-ask-user/i,
        /missing-vision-trace/i,
        /missing-tui-host-run-task-chain/i,
        /native-host/i,
      ]),
    }));
  }

  if (currentRunL3Blocked(input, issues)) {
    blockers.push(makeBlocker({
      category: 'current-run-l3',
      summary: 'Completed-case acceptance is missing current-run isolated L3 completion evidence.',
      refs,
      issues: matchingIssues(issues, [
        /current-run.*l3/i,
        /isolated-l3/i,
        /completed-run-missing-artifact/i,
        /matrix-diagnostic-only-evidence-kind/i,
        /completion-evidence/i,
        /live-acceptance/i,
      ]),
    }));
  }

  if (approvalBoundaryBlocked(input, issues)) {
    blockers.push(makeBlocker({
      category: 'approval-boundary',
      summary: 'Approval-boundary case is missing current action authorization or denial evidence.',
      refs,
      issues: matchingIssues(issues, [
        /approval/i,
        /needs-confirmation/i,
        /gui-ask-user/i,
        /risk-audit/i,
        /confirmed-request/i,
        /denied/i,
      ]),
    }));
  }

  if (expectedStateBlocked(issues)) {
    blockers.push(makeBlocker({
      category: 'expected-state',
      summary: 'Observed run state does not match the case expected state.',
      refs,
      issues: matchingIssues(issues, [/^expected-.+-got-/i]),
    }));
  }

  return blockers;
}

function plannerRouteBlocked(searchText: string): boolean {
  return /package-bridge-repair-needed|package bridge|codex runtime|native computer use|failedStage=plan|plannerText|repair-needed/i.test(searchText);
}

function nativeHostEvidenceBlocked(issues: string[]): boolean {
  return issues.some((issue) => (
    /missing-computer-use-tui-host-actions/i.test(issue)
    || /missing-gui-present/i.test(issue)
    || /missing-gui-ask-user/i.test(issue)
    || /missing-vision-trace/i.test(issue)
    || /missing-tui-host-run-task-chain/i.test(issue)
  ));
}

function currentRunL3Blocked(input: {
  expectedStatus: ComputerUseChatLiveE2EExpectedStatus;
  evidenceClassification: Pick<CuNextEvidenceClassification, 'kind' | 'canCompleteL3Workflow'>;
  runManifest: ComputerUseChatLiveE2EManifest;
}, issues: string[]): boolean {
  if (input.expectedStatus !== 'completed') return false;
  return (
    input.evidenceClassification.kind !== 'isolated-L3'
    || !input.evidenceClassification.canCompleteL3Workflow
    || input.runManifest.liveAcceptanceBundle?.status !== 'valid'
    || issues.some((issue) => (
      /current-run.*l3/i.test(issue)
      || /completed-run-missing-artifact/i.test(issue)
      || /matrix-diagnostic-only-evidence-kind/i.test(issue)
      || /completion-evidence/i.test(issue)
      || /live-acceptance/i.test(issue)
    ))
  );
}

function approvalBoundaryBlocked(input: {
  expectedStatus: ComputerUseChatLiveE2EExpectedStatus;
}, issues: string[]): boolean {
  const approvalCase = input.expectedStatus === 'needs-confirmation' || input.expectedStatus === 'confirmed-approval-retry';
  return approvalCase && issues.some((issue) => (
    /approval/i.test(issue)
    || /needs-confirmation/i.test(issue)
    || /gui-ask-user/i.test(issue)
    || /risk-audit/i.test(issue)
    || /confirmed-request/i.test(issue)
    || /denied/i.test(issue)
  ));
}

function expectedStateBlocked(issues: string[]): boolean {
  return issues.some((issue) => /^expected-.+-got-/i.test(issue));
}

function makeBlocker(input: {
  category: DiagnosticBlockerCategory;
  summary: string;
  refs: string[];
  issues: string[];
}): ComputerUseChatLiveComplexMatrixDiagnosticBlocker {
  return {
    category: input.category,
    diagnosticOnly: true,
    summary: sanitizeDiagnosticText(input.summary),
    refs: uniqueStrings(input.refs),
    issues: uniqueStrings(input.issues),
  };
}

function searchableDiagnosticText(runManifest: ComputerUseChatLiveE2EManifest, issues: string[]): string {
  return [
    runManifest.visibleStatus ?? '',
    runManifest.messageExcerpt ?? '',
    ...runManifest.eventTypes,
    ...runManifest.eventSummaries.map((item) => [
      item.type ?? '',
      item.label ?? '',
      item.status ?? '',
      item.detailExcerpt ?? '',
    ].join(' ')),
    ...runManifest.failureDiagnostics.flatMap((item) => [item.kind, item.summary, ...item.refs]),
    runManifest.packageBridgeCompletionGrade?.status ?? '',
    ...(runManifest.packageBridgeCompletionGrade?.issues ?? []),
    ...issues,
  ].join('\n');
}

function plannerRouteRefs(runManifest: ComputerUseChatLiveE2EManifest, fallbackRefs: string[]): string[] {
  const refs = runManifest.failureDiagnostics
    .filter((item) => item.kind === 'package-bridge-repair-needed' || /package bridge|planner|repair-needed/i.test(item.summary))
    .flatMap((item) => item.refs);
  return uniqueStrings(refs.length ? refs : fallbackRefs);
}

function diagnosticRefs(runManifest: ComputerUseChatLiveE2EManifest): string[] {
  return uniqueStrings([
    ...runManifest.failureDiagnostics.flatMap((item) => item.refs),
    runManifest.liveAcceptanceBundle?.runDirRef ?? '',
    runManifest.liveAcceptanceBundle?.acceptanceManifestRef ?? '',
    runManifest.liveAcceptanceBundle?.completionEvidenceRef ?? '',
    ...runManifest.displayedRefs,
    ...runManifest.artifactRefs,
    ...runManifest.auditRefs,
    ...runManifest.approvalRequestRefs,
    ...runManifest.guiAskUserRecordRefs,
    ...runManifest.riskAuditRefs,
    ...runManifest.confirmedRequestRefs,
    ...runManifest.approvalDecisionRefs,
    ...runManifest.sourceApprovalRequestRefs,
    ...runManifest.sourceGuiAskUserRecordRefs,
    ...runManifest.sourceRiskAuditRefs,
  ]).slice(0, 24);
}

function matchingIssues(issues: string[], patterns: RegExp[]): string[] {
  const matching = issues.filter((issue) => patterns.some((pattern) => pattern.test(issue)));
  return matching.length ? matching : issues.slice(0, 8);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, 'sk-[redacted]')
    .replace(/\b(api[_-]?key|token|secret|password)=([^,\s;]+)/gi, '$1=[redacted]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]');
}
