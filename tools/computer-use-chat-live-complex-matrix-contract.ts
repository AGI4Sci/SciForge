import type {
  ComputerUseChatLiveContinuationE2EManifest,
  ComputerUseChatLiveE2EExpectedStatus,
  ComputerUseChatLiveE2EManifest,
  ComputerUseChatLiveE2EOptions,
} from './computer-use-chat-live-e2e-contract.js';
import type { ComputerUseChatLivePreflightManifest } from './computer-use-chat-live-preflight.js';
import type {
  ComputerUseChatLiveCaseIsolationSeedPlan,
  ComputerUseChatLiveCaseIsolationSeedPlanCase,
  ComputerUseChatLiveCaseIsolationStrategy,
} from './computer-use-chat-live-case-isolation.js';
import type {
  ComputerUseChatLiveComplexMatrixCase,
  ComputerUseChatLiveComplexMatrixCaseId,
} from './computer-use-chat-live-complex-matrix-cases.js';
import type { ComputerUseChatLiveResourceDiagnostics } from './computer-use-chat-live-resource-diagnostics.js';
import type { CuNextEvidenceClassification } from './computer-use-next/evidence-classification.js';

export const COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_SCHEMA =
  'sciforge.computer-use.chat-live-complex-matrix.v1' as const;
export const COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_AGGREGATE_SCHEMA =
  'sciforge.computer-use.chat-live-complex-matrix.aggregate.v1' as const;

export interface ComputerUseChatLiveComplexMatrixOptions extends ComputerUseChatLiveE2EOptions {
  caseIds?: ComputerUseChatLiveComplexMatrixCaseId[];
  caseIsolationStrategy?: ComputerUseChatLiveCaseIsolationStrategy;
  caseTimeoutMs?: number;
}

export interface ComputerUseChatLiveComplexMatrixCaseResult {
  id: ComputerUseChatLiveComplexMatrixCaseId;
  label: string;
  expectedStatus: ComputerUseChatLiveE2EExpectedStatus;
  taskId: string;
  scenarioId: string;
  prompt: string;
  status: 'passed' | 'failed' | 'blocked';
  requestSubmitted: boolean;
  liveAcceptanceCandidate: boolean;
  isolation: ComputerUseChatLiveComplexMatrixCaseIsolation;
  evidenceClassification: Pick<
    CuNextEvidenceClassification,
    'kind' | 'canCompleteBackend' | 'canCompleteL3Workflow' | 'blockedReasons' | 'rejectedShortcuts' | 'claimLimit'
  >;
  runManifest: ComputerUseChatLiveE2EManifest;
  autoContinuation?: Pick<
    ComputerUseChatLiveContinuationE2EManifest,
    'schemaVersion' | 'checkedAt' | 'status' | 'evidenceMode' | 'continuation' | 'issues' | 'requestSubmitted' | 'liveAcceptanceCandidate'
  >;
  retryAttempts?: ComputerUseChatLiveComplexMatrixCaseRetryAttempt[];
  issues: string[];
}

export interface ComputerUseChatLiveComplexMatrixCaseRetryAttempt {
  schemaVersion: 'sciforge.computer-use.chat-live-complex-matrix.case-retry.v1';
  attempt: number;
  maxAttempts: number;
  reason:
    | 'non-completed-expected-state-drift'
    | 'completed-expected-state-drift'
    | 'completed-completion-evidence-drift'
    | 'case-run-transient-error'
    | 'case-preflight-transient-block';
  expectedStatus: ComputerUseChatLiveE2EExpectedStatus;
  observedStatus: ComputerUseChatLiveE2EManifest['status'];
  observedVisibleStatus?: string;
  sourceRunManifest: ComputerUseChatLiveE2EManifest;
  cleanupBeforeRetry: {
    cleanupManifestRef?: string;
    cleanupStatus: ComputerUseChatLiveComplexMatrixCaseIsolation['cleanupStatus'];
    cleanupIssues: string[];
  };
  retryBoundary: {
    sessionId: string;
    currentTurnId: string;
    workspaceSeed: ComputerUseChatLiveComplexMatrixCaseIsolation['workspaceSeed'];
    prompt: string;
    requestSubmitted: boolean;
    status: ComputerUseChatLiveE2EManifest['status'];
    issues: string[];
  };
}

export interface ComputerUseChatLiveComplexMatrixCaseIsolation {
  schemaVersion: 'sciforge.computer-use.chat-live-complex-matrix.case-isolation.v1';
  matrixRunId: string;
  caseRunId: string;
  caseIndex: number;
  sessionId: string;
  currentTurnId: string;
  workspaceSeed: {
    kind: 'shared-workspace-case-seed' | ComputerUseChatLiveCaseIsolationStrategy;
    seed: string;
    workspacePathConfigured: boolean;
    caseWorkspacePath?: string;
  };
  resetManifestRef?: string;
  resetStatus?: 'passed' | 'failed' | 'not-enabled' | 'write-failed';
  resetIssues: string[];
  cleanupManifestRef?: string;
  cleanupStatus: 'planned' | 'recorded' | 'inline-only' | 'write-failed';
  cleanupIssues: string[];
}

export interface ComputerUseChatLiveComplexMatrixCleanupManifest {
  schemaVersion: 'sciforge.computer-use.chat-live-complex-matrix.case-cleanup.v1';
  checkedAt: string;
  matrixRunId: string;
  caseRunId: string;
  caseId: ComputerUseChatLiveComplexMatrixCaseId;
  status: ComputerUseChatLiveComplexMatrixCaseResult['status'];
  sessionId: string;
  currentTurnId: string;
  workspaceSeed: ComputerUseChatLiveComplexMatrixCaseIsolation['workspaceSeed'];
  runDirRefs: string[];
  finalArtifactRefs: string[];
  guiReceiptRefs: string[];
  acceptanceRefs: {
    runDirRef?: string;
    acceptanceManifestRef?: string;
    completionEvidenceRef?: string;
    producerDiagnosticRefs: string[];
  };
  resourceReleaseChecks: Array<{
    kind: 'workspace-seed' | 'run-dir' | 'gui-receipt' | 'l3-producer' | 'timeout';
    status: 'recorded' | 'not-applicable' | 'needs-review';
    ref?: string;
    note: string;
  }>;
  residualIssues: string[];
}

export interface ComputerUseChatLiveComplexMatrixStabilityDiagnostics {
  schemaVersion: 'sciforge.computer-use.chat-live-complex-matrix.stability-diagnostics.v1';
  caseOrdering: {
    selectedCaseIds: ComputerUseChatLiveComplexMatrixCaseId[];
    resultCaseIds: ComputerUseChatLiveComplexMatrixCaseId[];
    preservedSelectedOrder: boolean;
    duplicateResultCaseIds: ComputerUseChatLiveComplexMatrixCaseId[];
    missingResultCaseIds: ComputerUseChatLiveComplexMatrixCaseId[];
    extraResultCaseIds: string[];
  };
  retryBoundary: {
    mode: 'case-scoped';
    matrixContinuesAfterCaseFailure: boolean;
    failedCaseIds: ComputerUseChatLiveComplexMatrixCaseId[];
    submittedAfterFailureCaseIds: ComputerUseChatLiveComplexMatrixCaseId[];
    autoContinuationCaseIds: ComputerUseChatLiveComplexMatrixCaseId[];
    boundedRetryCaseIds: ComputerUseChatLiveComplexMatrixCaseId[];
    cases: Array<{
      id: ComputerUseChatLiveComplexMatrixCaseId;
      caseIndex: number;
      status: ComputerUseChatLiveComplexMatrixCaseResult['status'];
      requestSubmitted: boolean;
      autoContinuationAttempted: boolean;
      boundedRetryAttempts: number;
      boundary:
        | 'blocked-before-submit'
        | 'single-case-continuation'
        | 'single-case-bounded-retry'
        | 'case-run-failure-captured'
        | 'no-retry-needed';
    }>;
  };
  cleanupManifestSummary: {
    expectedCaseCount: number;
    plannedManifestRefs: string[];
    recordedManifestRefs: string[];
    inlineOnlyCaseIds: ComputerUseChatLiveComplexMatrixCaseId[];
    writeFailedCaseIds: ComputerUseChatLiveComplexMatrixCaseId[];
    cleanupIssuesByCase: Array<{
      id: ComputerUseChatLiveComplexMatrixCaseId;
      cleanupStatus: ComputerUseChatLiveComplexMatrixCaseIsolation['cleanupStatus'];
      issues: string[];
    }>;
  };
}

export interface ComputerUseChatLiveComplexMatrixManifest {
  schemaVersion: typeof COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_SCHEMA;
  checkedAt: string;
  status: 'passed' | 'failed' | 'blocked';
  releaseAcceptance: 'opt-in-only';
  evidenceMode: 'current-chat-run-complex-matrix-only';
  preflight: Pick<ComputerUseChatLivePreflightManifest, 'schemaVersion' | 'status' | 'missingEnv' | 'policyViolations' | 'serviceChecks'>;
  caseIsolationPlan?: Pick<
    ComputerUseChatLiveCaseIsolationSeedPlan,
    'schemaVersion' | 'checkedAt' | 'matrixRunId' | 'strategy' | 'baseWorkspacePath' | 'resetManifestSchemaVersion' | 'runnerIntegration' | 'issues'
  > & {
    cases: Array<Pick<ComputerUseChatLiveCaseIsolationSeedPlanCase, 'id' | 'caseRunId' | 'sessionId' | 'currentTurnId' | 'workspace' | 'isolationContract'>>;
  };
  cases: ComputerUseChatLiveComplexMatrixCaseResult[];
  stabilityDiagnostics: ComputerUseChatLiveComplexMatrixStabilityDiagnostics;
  issues: string[];
  requestSubmitted: boolean;
  resourceDiagnostics: ComputerUseChatLiveResourceDiagnostics;
  completionPolicy: {
    fixturePackageLocalHarnessCompletesProjectTasks: false;
    completionRequiresCurrentChatRunIsolatedL3Bundle: true;
  };
}

export interface ComputerUseChatLiveComplexMatrixAggregateCase {
  id: ComputerUseChatLiveComplexMatrixCaseId;
  label: string;
  taskId: string;
  scenarioId: string;
  expectedStatus: ComputerUseChatLiveE2EExpectedStatus;
  status: 'passed' | 'failed' | 'blocked' | 'missing';
  sourceManifestRef?: string;
  sourceCheckedAt?: string;
  evidenceKind?: CuNextEvidenceClassification['kind'];
  liveAcceptanceCandidate: boolean;
  requestSubmitted: boolean;
  issues: string[];
  acceptanceRefs: {
    runDirRef?: string;
    acceptanceManifestRef?: string;
    completionEvidenceRef?: string;
    finalArtifactRefs: string[];
    guiPresentRefs: string[];
  };
  residualStabilityNotes: string[];
  diagnosticBlockers: ComputerUseChatLiveComplexMatrixDiagnosticBlocker[];
}

export interface ComputerUseChatLiveComplexMatrixDiagnosticBlocker {
  category:
    | 'planner-route'
    | 'native-host-evidence'
    | 'current-run-l3'
    | 'approval-boundary'
    | 'expected-state';
  diagnosticOnly: true;
  summary: string;
  refs: string[];
  issues: string[];
}

export interface ComputerUseChatLiveComplexMatrixAggregateManifest {
  schemaVersion: typeof COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_AGGREGATE_SCHEMA;
  checkedAt: string;
  status: 'passed' | 'failed';
  releaseAcceptance: 'opt-in-only';
  evidenceMode: 'split-live-manifest-aggregate';
  sourceManifestRefs: string[];
  cases: ComputerUseChatLiveComplexMatrixAggregateCase[];
  issues: string[];
  completionPolicy: {
    fixturePackageLocalHarnessCompletesProjectTasks: false;
    completionRequiresCurrentChatRunIsolatedL3Bundle: true;
    aggregateRequiresEveryCasePassed: true;
  };
}
