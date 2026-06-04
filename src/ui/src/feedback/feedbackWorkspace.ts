import {
  makeId,
  nowIso,
  type FeedbackCommentRecord,
  type FeedbackCommentStatus,
  type FeedbackRepairActionRecord,
  type FeedbackRepairGuidanceRecord,
  type FeedbackRepairResultRecord,
  type FeedbackRepairRunRecord,
  type FeedbackRepairStatus,
  type GithubSyncedOpenIssueRecord,
  type SciForgeWorkspaceState,
} from '../domain';
import {
  createUserFeedbackConvergence,
  type UserFeedbackConvergence,
} from '@sciforge-ui/runtime-contract/user-feedback-convergence';
import { isFeedbackCommentStatus } from '@sciforge-ui/runtime-contract';
import type {
  FailureSignatureRegistry,
  TaskRunCard,
} from '@sciforge-ui/runtime-contract/task-run-card';

const FEEDBACK_COMMENT_LIMIT = 500;
const FEEDBACK_REQUEST_LIMIT = 80;

type FeedbackRequestRecord = NonNullable<SciForgeWorkspaceState['feedbackRequests']>[number];
type FeedbackRequestMetadata = NonNullable<FeedbackRequestRecord['metadata']>;

const DEFAULT_ALLOWED_REQUEST_OPERATIONS = [
  'read selected feedback records',
  'read evidence refs and screenshots',
  'inspect linked session, run, artifact, and execution refs',
  'prepare a bounded repair plan',
  'apply scoped workspace patches after user confirmation',
  'run focused tests and record output refs',
  'write request status and repair audit updates',
];

const DEFAULT_FORBIDDEN_REQUEST_OPERATIONS = [
  'hard-delete feedback records',
  'delete screenshot, raw evidence, or feedback bundle files',
  'delete, close, or rewrite linked GitHub issues',
  'clear repair audit records or workspace patch refs',
  'git reset --hard',
  'unbounded git checkout or restore',
  'modify ignored secret config or provider credentials',
  'commit, push, PR, or merge without explicit user confirmation',
  'fabricate tests or output artifacts',
];

export interface FeedbackRepairAuditViewModel {
  issueId: string;
  status: FeedbackRepairStatus | 'not-started';
  badge: 'info' | 'success' | 'warning' | 'danger' | 'muted';
  label: string;
  headline: string;
  detail: string;
  executorInstance?: string;
  latestRunStatus: FeedbackRepairRunRecord['status'] | 'not-started';
  latestResultVerdict?: FeedbackRepairResultRecord['verdict'];
  changedFiles: string[];
  diffRef?: string;
  commit?: string;
  refs?: FeedbackRepairResultRecord['refs'];
  tests: Array<{ command: string; status: 'passed' | 'failed' | 'unknown'; outputRef?: string; summary?: string }>;
  summary?: string;
  humanVerification?: string;
  githubSyncStatus: NonNullable<FeedbackRepairResultRecord['githubSyncStatus']> | 'not-synced';
  githubCommentUrl?: string;
  latestBrowserVerification?: FeedbackRepairActionRecord['browserVerification'];
  latestBrowserVerificationLabel?: string;
  missingTestEvidence: boolean;
  testsPassed: boolean;
  needsHumanVerification: boolean;
  githubSynced: boolean;
  actionHistory: Array<{
    id: string;
    action: FeedbackRepairActionRecord['action'];
    status: FeedbackRepairActionRecord['status'];
    sideEffect: FeedbackRepairActionRecord['sideEffect'];
    requestedAt: string;
    confirmedAt?: string;
    safeModeConfirmed?: boolean;
    browserVerification?: FeedbackRepairActionRecord['browserVerification'];
    message: string;
  }>;
  guidanceHistory: Array<{
    id: string;
    status: FeedbackRepairGuidanceRecord['status'];
    requestedAt: string;
    requestedBy: string;
    message: string;
    terminalMirrorRef?: string;
    codexSessionId?: string;
    responseSummary?: string;
  }>;
  repairThreads: Array<{
    id: string;
    status: FeedbackRepairRunRecord['status'] | 'result-only';
    startedAt: string;
    executorInstance?: string;
    terminalMirrorRef?: string;
    planRef?: string;
    systemTerminalLaunchRef?: string;
    continuityLabel: string;
    resultId?: string;
    resultStatus?: FeedbackRepairResultRecord['status'];
    resultVerdict?: FeedbackRepairResultRecord['verdict'];
    resultSummary?: string;
    completedAt?: string;
  }>;
  latestRun?: FeedbackRepairRunRecord;
  latestResult?: FeedbackRepairResultRecord;
}

export function addFeedbackCommentToWorkspace(
  state: SciForgeWorkspaceState,
  comment: FeedbackCommentRecord,
  limit = FEEDBACK_COMMENT_LIMIT,
): SciForgeWorkspaceState {
  return {
    ...state,
    feedbackComments: [comment, ...(state.feedbackComments ?? [])].slice(0, limit),
  };
}

export function updateFeedbackCommentStatus(
  state: SciForgeWorkspaceState,
  ids: string[],
  status: FeedbackCommentStatus,
  updatedAt = nowIso(),
): SciForgeWorkspaceState {
  if (!ids.length) return state;
  const selected = new Set(ids);
  return {
    ...state,
    feedbackComments: (state.feedbackComments ?? []).map((comment) => selected.has(comment.id)
      ? comment.status === 'deleted' && status !== 'deleted'
        ? comment
        : { ...comment, status, updatedAt }
      : comment),
  };
}

export function updateFeedbackCommentText(
  state: SciForgeWorkspaceState,
  id: string,
  comment: string,
  updatedAt = nowIso(),
): SciForgeWorkspaceState {
  if (!id) return state;
  return {
    ...state,
    feedbackComments: (state.feedbackComments ?? []).map((item) => item.id === id
      ? { ...item, comment, updatedAt }
      : item),
  };
}

export function deleteFeedbackCommentsFromWorkspace(
  state: SciForgeWorkspaceState,
  ids: string[],
  deletedAt = nowIso(),
): SciForgeWorkspaceState {
  return softDeleteFeedbackCommentsInWorkspace(state, ids, deletedAt);
}

export function softDeleteFeedbackCommentsInWorkspace(
  state: SciForgeWorkspaceState,
  ids: string[],
  deletedAt = nowIso(),
): SciForgeWorkspaceState {
  if (!ids.length) return state;
  const selected = new Set(ids);
  return {
    ...state,
    feedbackComments: (state.feedbackComments ?? []).map((comment) => selected.has(comment.id)
      ? softDeleteFeedbackComment(comment, deletedAt)
      : comment),
  };
}

export function restoreFeedbackCommentsInWorkspace(
  state: SciForgeWorkspaceState,
  ids: string[],
  restoredAt = nowIso(),
): SciForgeWorkspaceState {
  if (!ids.length) return state;
  const selected = new Set(ids);
  return {
    ...state,
    feedbackComments: (state.feedbackComments ?? []).map((comment) => selected.has(comment.id)
      ? restoreFeedbackComment(comment, restoredAt)
      : comment),
  };
}

export function createFeedbackRequestFromComments(
  state: SciForgeWorkspaceState,
  ids: string[],
  title: string,
  options: {
    requestId?: string;
    createdAt?: string;
    requestLimit?: number;
  } = {},
): SciForgeWorkspaceState {
  if (!ids.length) return state;
  const createdAt = options.createdAt ?? nowIso();
  const requestId = options.requestId ?? makeId('request');
  const selectedComments = selectedFeedbackComments(state.feedbackComments ?? [], ids);
  if (!selectedComments.length) return state;
  const selectedIds = selectedComments.map((comment) => comment.id);
  const request = buildFeedbackRequest(selectedComments, title, requestId, createdAt);
  const selected = new Set(selectedIds);
  return {
    ...state,
    feedbackRequests: [request, ...(state.feedbackRequests ?? [])].slice(0, options.requestLimit ?? FEEDBACK_REQUEST_LIMIT),
    feedbackComments: (state.feedbackComments ?? []).map((comment) => selected.has(comment.id)
      ? { ...comment, status: comment.status === 'open' ? 'triaged' : comment.status, requestId, updatedAt: createdAt }
      : comment),
  };
}

export function createFeedbackConvergenceFromComments(
  comments: FeedbackCommentRecord[],
  options: {
    createdAt?: string;
    source?: string;
    taskRunCards?: TaskRunCard[];
    failureSignatureRegistry?: FailureSignatureRegistry;
  } = {},
): UserFeedbackConvergence {
  return createUserFeedbackConvergence({
    createdAt: options.createdAt,
    source: options.source ?? 'feedback-workspace',
    taskRunCards: options.taskRunCards,
    failureSignatureRegistry: options.failureSignatureRegistry,
    signals: comments.map((comment) => ({
      id: comment.id,
      text: comment.comment,
      priority: comment.priority,
      status: comment.status,
      tags: comment.tags,
      page: comment.runtime.page,
      scenarioId: comment.runtime.scenarioId,
      sessionId: comment.runtime.sessionId,
      activeRunId: comment.runtime.activeRunId,
      sourceRefs: feedbackSourceRefs(comment),
    })),
  });
}

export function replaceGithubSyncedOpenIssuesInWorkspace(
  state: SciForgeWorkspaceState,
  issues: GithubSyncedOpenIssueRecord[],
  updatedAt = nowIso(),
): SciForgeWorkspaceState {
  return {
    ...state,
    githubSyncedOpenIssues: issues,
    updatedAt,
  };
}

export function upsertFeedbackRepairRunInWorkspace(
  state: SciForgeWorkspaceState,
  run: FeedbackRepairRunRecord,
): SciForgeWorkspaceState {
  const existing = state.feedbackRepairRuns ?? [];
  return {
    ...state,
    feedbackRepairRuns: [run, ...existing.filter((item) => item.id !== run.id)].slice(0, FEEDBACK_REQUEST_LIMIT),
  };
}

export function upsertFeedbackRepairResultInWorkspace(
  state: SciForgeWorkspaceState,
  result: FeedbackRepairResultRecord,
): SciForgeWorkspaceState {
  const existing = state.feedbackRepairResults ?? [];
  return {
    ...state,
    feedbackRepairResults: [result, ...existing.filter((item) => item.id !== result.id)].slice(0, FEEDBACK_REQUEST_LIMIT),
  };
}

export function upsertFeedbackRepairActionInWorkspace(
  state: SciForgeWorkspaceState,
  action: FeedbackRepairActionRecord,
): SciForgeWorkspaceState {
  const existing = state.feedbackRepairActions ?? [];
  return {
    ...state,
    feedbackRepairActions: [action, ...existing.filter((item) => item.id !== action.id)].slice(0, FEEDBACK_REQUEST_LIMIT),
  };
}

export function upsertFeedbackRepairGuidanceInWorkspace(
  state: SciForgeWorkspaceState,
  guidance: FeedbackRepairGuidanceRecord,
): SciForgeWorkspaceState {
  const existing = state.feedbackRepairGuidance ?? [];
  return {
    ...state,
    feedbackRepairGuidance: [guidance, ...existing.filter((item) => item.id !== guidance.id)].slice(0, FEEDBACK_REQUEST_LIMIT),
  };
}

export function feedbackRepairAuditForIssue(
  issueId: string,
  runs: FeedbackRepairRunRecord[] = [],
  results: FeedbackRepairResultRecord[] = [],
  actions: FeedbackRepairActionRecord[] = [],
  guidance: FeedbackRepairGuidanceRecord[] = [],
): FeedbackRepairAuditViewModel {
  const issueRuns = runs.filter((run) => run.issueId === issueId).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const issueResults = results.filter((result) => result.issueId === issueId).sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  const actionHistory = actions
    .filter((action) => action.issueId === issueId)
    .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt))
    .slice(0, 20)
    .map((action) => ({
      id: action.id,
      action: action.action,
      status: action.status,
      sideEffect: action.sideEffect,
      requestedAt: action.requestedAt,
      confirmedAt: action.confirmedAt,
      safeModeConfirmed: action.safeModeConfirmed,
      browserVerification: action.browserVerification,
      message: action.message,
    }));
  const guidanceHistory = guidance
    .filter((record) => record.issueId === issueId || runs.some((run) => run.id === record.repairRunId))
    .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt))
    .slice(0, 20)
    .map((record) => ({
      id: record.id,
      status: record.status,
      requestedAt: record.requestedAt,
      requestedBy: record.requestedBy,
      message: record.message,
      terminalMirrorRef: record.terminalMirrorRef,
      codexSessionId: record.codexSessionId,
      responseSummary: record.responseSummary,
    }));
  const latestRun = issueRuns[0];
  const latestResult = latestResultForCurrentThread(latestRun, issueResults);
  const resultsByRunId = new Map(issueResults
    .filter((result): result is FeedbackRepairResultRecord & { repairRunId: string } => Boolean(result.repairRunId))
    .map((result) => [result.repairRunId, result]));
  const runIds = new Set(issueRuns.map((run) => run.id));
  const repairThreads = [
    ...issueRuns.map((run) => {
      const result = resultsByRunId.get(run.id);
      const runMetadata = recordValue(run.metadata);
      const resultMetadata = recordValue(result?.metadata);
      return {
        id: run.id,
        status: run.status,
        startedAt: run.startedAt,
        executorInstance: executorInstanceLabel(run, result),
        terminalMirrorRef: run.terminalMirrorRef ?? result?.terminalMirrorRef,
        planRef: run.planRef ?? result?.planRef,
        systemTerminalLaunchRef: metadataString(runMetadata, 'systemTerminalLaunchRef') ?? metadataString(resultMetadata, 'systemTerminalLaunchRef'),
        continuityLabel: repairThreadContinuityLabel(run, result),
        resultId: result?.id,
        resultStatus: result?.status,
        resultVerdict: result?.verdict,
        resultSummary: result?.summary,
        completedAt: result?.completedAt,
      };
    }),
    ...issueResults
      .filter((result) => !result.repairRunId || !runIds.has(result.repairRunId))
      .map((result) => ({
        id: result.repairRunId ?? result.id,
        status: 'result-only' as const,
        startedAt: result.completedAt,
        executorInstance: executorInstanceLabel(undefined, result),
        terminalMirrorRef: result.terminalMirrorRef,
        planRef: result.planRef,
        systemTerminalLaunchRef: metadataString(recordValue(result.metadata), 'systemTerminalLaunchRef'),
        continuityLabel: repairThreadContinuityLabel(undefined, result),
        resultId: result.id,
        resultStatus: result.status,
        resultVerdict: result.verdict,
        resultSummary: result.summary,
        completedAt: result.completedAt,
      })),
  ].slice(0, 12);
  const latestBrowserVerification = actionHistory.find((action) => action.action === 'browser-recheck')?.browserVerification;
  const tests = normalizeRepairTests(latestResult?.tests ?? latestResult?.testResults ?? []);
  const testsPassed = tests.length > 0 && tests.every((test) => test.status === 'passed');
  const hasFailedTests = tests.some((test) => test.status === 'failed');
  const rawStatus = repairAuditStatus(latestRun, latestResult, tests);
  const evidence = repairAuditEvidenceCompleteness(latestRun, latestResult, tests);
  const hasCompleteRepairEvidence = evidence.ready === evidence.total;
  const status = rawStatus === 'github-synced' && !hasCompleteRepairEvidence && latestResult?.verdict === 'fixed'
    ? 'fixed'
    : rawStatus;
  const missingTestEvidence = Boolean(latestResult) && latestResult?.verdict === 'fixed' && tests.length === 0;
  const humanVerification = latestResult?.humanVerification;
  const needsHumanVerification = status === 'needs-human-verification'
    || humanVerification?.status === 'required'
    || humanVerification?.status === 'pending'
    || humanVerification?.status === 'failed';
  const githubSynced = hasCompleteRepairEvidence && (rawStatus === 'github-synced' || Boolean(latestResult?.githubCommentUrl));
  return {
    issueId,
    status,
    badge: repairAuditBadge(status, missingTestEvidence || !hasCompleteRepairEvidence, hasFailedTests),
    label: repairAuditLabel(status),
    headline: repairAuditHeadline(status, { testsPassed, hasFailedTests, missingTestEvidence, needsHumanVerification, githubSynced, hasCompleteRepairEvidence }),
    detail: repairAuditDetail(latestRun, latestResult),
    executorInstance: executorInstanceLabel(latestRun, latestResult),
    latestRunStatus: latestRun?.status ?? 'not-started',
    latestResultVerdict: latestResult?.verdict,
    changedFiles: latestResult?.changedFiles ?? [],
    diffRef: latestResult?.diffRef,
    commit: latestResult?.commit,
    refs: latestResult?.refs,
    tests,
    summary: latestResult?.summary,
    humanVerification: humanVerificationLabel(humanVerification),
    githubSyncStatus: latestResult?.githubSyncStatus ?? 'not-synced',
    githubCommentUrl: latestResult?.githubCommentUrl,
    latestBrowserVerification,
    latestBrowserVerificationLabel: humanVerificationLabel(latestBrowserVerification),
    missingTestEvidence,
    testsPassed,
    needsHumanVerification,
    githubSynced,
    actionHistory,
    guidanceHistory,
    repairThreads,
    latestRun,
    latestResult,
  };
}

function latestResultForCurrentThread(
  latestRun: FeedbackRepairRunRecord | undefined,
  issueResults: FeedbackRepairResultRecord[],
) {
  const newestResult = issueResults[0];
  if (!latestRun || !newestResult) return newestResult;
  if (newestResult.repairRunId === latestRun.id) return newestResult;
  const resultTime = Date.parse(newestResult.completedAt);
  const runTime = Date.parse(latestRun.startedAt);
  if (Number.isFinite(resultTime) && Number.isFinite(runTime) && resultTime >= runTime) return newestResult;
  return issueResults.find((result) => result.repairRunId === latestRun.id);
}

function repairAuditStatus(
  run?: FeedbackRepairRunRecord,
  result?: FeedbackRepairResultRecord,
  tests = normalizeRepairTests(result?.tests ?? result?.testResults ?? []),
): FeedbackRepairAuditViewModel['status'] {
  if (tests.some((test) => test.status === 'failed')) return 'blocked';
  if (result?.verdict === 'fixed' && tests.length === 0) return 'needs-human-verification';
  if (result?.githubCommentUrl || result?.status === 'github-synced') return 'github-synced';
  if (result?.status && result.status !== 'fixed') return result.status;
  if (result?.verdict === 'fixed') return 'fixed';
  if (result?.verdict === 'partially-fixed' || result?.verdict === 'needs-follow-up') return 'needs-human-verification';
  if (result?.verdict === 'failed' || result?.verdict === 'wont-fix') return 'blocked';
  if (!run) return 'not-started';
  if (run.status === 'running') return 'analyzing';
  return run.status;
}

function repairAuditEvidenceCompleteness(
  run: FeedbackRepairRunRecord | undefined,
  result: FeedbackRepairResultRecord | undefined,
  tests: ReturnType<typeof normalizeRepairTests>,
) {
  const resultMetadata = recordValue(recordValue(result)?.metadata);
  const runMetadata = recordValue(run?.metadata);
  const refs = recordValue(result?.refs);
  const terminalMirror = [
    run?.terminalMirrorRef,
    result?.terminalMirrorRef,
    metadataString(resultMetadata, 'terminalMirrorRef'),
    metadataString(runMetadata, 'terminalMirrorRef'),
    metadataString(refs, 'terminalMirrorRef'),
  ].some(Boolean);
  const plan = [
    run?.planRef,
    result?.planRef,
    metadataString(resultMetadata, 'planRef'),
    metadataString(runMetadata, 'planRef'),
  ].some(Boolean);
  const audit = [
    result?.auditBundleRef,
    metadataString(resultMetadata, 'auditBundleRef'),
    metadataString(refs, 'auditBundleRef'),
  ].some(Boolean);
  const patch = Boolean(result?.diffRef || result?.refs?.patchRef || metadataString(resultMetadata, 'patchRef') || metadataString(resultMetadata, 'diffRef'));
  const guardDigests = Boolean((run?.baseCommit && run?.dirtyWorktreeDigest && run?.protectedFilesDigest && run?.feedbackDataDigest) || recordValue(resultMetadata?.guardDigests));
  const items = [plan, terminalMirror, patch, tests.length > 0, audit, guardDigests];
  return {
    ready: items.filter(Boolean).length,
    total: items.length,
  };
}

function repairAuditBadge(
  status: FeedbackRepairAuditViewModel['status'],
  missingTestEvidence: boolean,
  hasFailedTests: boolean,
): FeedbackRepairAuditViewModel['badge'] {
  if (status === 'fixed' || status === 'github-synced') return missingTestEvidence || hasFailedTests ? 'warning' : 'success';
  if (status === 'blocked') return 'danger';
  if (status === 'needs-human-verification') return 'warning';
  if (status === 'not-started') return 'muted';
  return 'info';
}

function repairAuditLabel(status: FeedbackRepairAuditViewModel['status']) {
  return ({
    'not-started': '未交接',
    assigned: '已交给实例',
    analyzing: '分析中',
    patching: '改代码中',
    testing: '测试中',
    'needs-human-verification': '需人工核验',
    fixed: '已修好',
    blocked: '修复受阻',
    'github-synced': '已同步 GitHub',
  } satisfies Record<FeedbackRepairAuditViewModel['status'], string>)[status];
}

function repairAuditHeadline(
  status: FeedbackRepairAuditViewModel['status'],
  facts: {
    testsPassed: boolean;
    hasFailedTests: boolean;
    missingTestEvidence: boolean;
    needsHumanVerification: boolean;
    githubSynced: boolean;
    hasCompleteRepairEvidence: boolean;
  },
) {
  if (status === 'not-started') return '还没有 repair handoff。';
  if (status === 'assigned') return '已交给目标实例，等待它开始处理。';
  if (status === 'analyzing') return '目标实例正在处理。';
  if (status === 'patching') return '目标实例正在处理代码修改。';
  if (status === 'testing') return '目标实例正在处理测试验证。';
  if (facts.hasFailedTests) return '修复结果包含失败测试，不能视为已修好。';
  if (status === 'blocked') return '没有修好，目标实例报告阻塞。';
  if (facts.missingTestEvidence) return '缺测试证据，不能认定已修复。';
  if (facts.needsHumanVerification) return '需要人工核验。';
  if (!facts.hasCompleteRepairEvidence && facts.testsPassed) return '测试通过，但修复证据不完整。';
  if (facts.githubSynced) return facts.testsPassed ? '测试通过，已同步 GitHub。' : '已同步 GitHub，但请检查测试证据。';
  if (status === 'fixed') return facts.testsPassed ? '已修好，测试通过。' : '已修好，但测试状态需要复核。';
  return 'repair result 已写回。';
}

function repairAuditDetail(run?: FeedbackRepairRunRecord, result?: FeedbackRepairResultRecord) {
  if (result) return `${formatAuditTime(result.completedAt)} 写回：${result.summary}`;
  if (run) return `${formatAuditTime(run.startedAt)} 发起：${run.note || 'repair handoff 已记录。'}`;
  return '选择目标实例后只会记录 handoff 和审计信息，不会运行内嵌修复执行器。';
}

function executorInstanceLabel(run?: FeedbackRepairRunRecord, result?: FeedbackRepairResultRecord) {
  const executor = result?.executorInstance;
  if (executor) return executor.name ? `${executor.name} (${executor.id})` : executor.id;
  if (run?.externalInstanceName || run?.externalInstanceId) return run.externalInstanceName
    ? `${run.externalInstanceName}${run.externalInstanceId ? ` (${run.externalInstanceId})` : ''}`
    : run.externalInstanceId;
  return undefined;
}

function repairThreadContinuityLabel(run?: FeedbackRepairRunRecord, result?: FeedbackRepairResultRecord) {
  const runMetadata = recordValue(run?.metadata);
  const resultMetadata = recordValue(result?.metadata);
  const refs = recordValue(result?.refs);
  const terminalMode = metadataString(runMetadata, 'terminalMode') ?? metadataString(resultMetadata, 'terminalMode');
  const codexSessionId = metadataString(runMetadata, 'codexSessionId') ?? metadataString(resultMetadata, 'codexSessionId');
  const isolatedWorktree = metadataString(runMetadata, 'isolatedWorktreePath')
    ?? metadataString(resultMetadata, 'isolatedWorktreePath')
    ?? metadataString(refs, 'worktreePath');
  const failureKind = metadataString(runMetadata, 'failureKind') ?? metadataString(resultMetadata, 'failureKind');
  if (terminalMode === 'system-terminal-codex') return 'system Terminal owns process';
  if (run?.status === 'running' && !result) return 'live attach may be available';
  if (codexSessionId && isolatedWorktree && !failureKind) return 'native resume available';
  if (codexSessionId) return 'resume metadata partial';
  if (run || result) return 'log-only retry';
  return 'not started';
}

function humanVerificationLabel(value?: FeedbackRepairResultRecord['humanVerification']) {
  if (!value) return undefined;
  const base = ({
    'not-required': '不需要人工核验',
    required: '需要人工核验',
    pending: '等待人工核验',
    passed: '人工核验通过',
    failed: '人工核验未通过',
    verified: '人工核验通过',
    rejected: '人工核验未通过',
    'not-run': '尚未人工核验',
  } satisfies Record<NonNullable<FeedbackRepairResultRecord['humanVerification']>['status'], string>)[value.status];
  return [
    base,
    value.verifier ? `verifier ${value.verifier}` : '',
    value.conclusion ?? value.note ?? '',
    value.evidenceRefs?.length ? `evidence ${value.evidenceRefs.join(', ')}` : '',
    value.verifiedAt ? `at ${value.verifiedAt}` : '',
  ].filter(Boolean).join(' · ');
}

function normalizeRepairTests(tests: NonNullable<FeedbackRepairResultRecord['tests']>) {
  return tests.map((test, index) => ({
    command: test.command || test.name || `test-${index + 1}`,
    status: test.status === 'skipped' ? 'unknown' : test.status,
    outputRef: test.outputRef,
    summary: test.summary,
  }));
}

function formatAuditTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function buildFeedbackRequest(
  comments: FeedbackCommentRecord[],
  title: string,
  requestId: string,
  createdAt: string,
): FeedbackRequestRecord {
  const feedbackIds = comments.map((comment) => comment.id);
  const evidenceRefs = stableStringList(comments.flatMap((comment) => feedbackSourceRefs(comment)));
  const allowedOperations = requestAllowedOperations(comments);
  const forbiddenOperations = requestForbiddenOperations(comments);
  const risks = requestRisks(comments);
  const expectedResult = requestExpectedResult(comments);
  const metadata = feedbackRequestMetadata({
    requestId,
    comments,
    evidenceRefs,
    expectedResult,
    risks,
    allowedOperations,
    forbiddenOperations,
    createdAt,
  });
  return {
    id: requestId,
    schemaVersion: 1,
    title,
    status: 'draft',
    feedbackIds,
    summary: `Codex change request from ${feedbackIds.length} feedback comments.`,
    acceptanceCriteria: comments.map((comment) => feedbackAcceptanceCriterion(comment)).slice(0, 12),
    evidenceRefs,
    expectedResult,
    risks,
    allowedOperations,
    forbiddenOperations,
    metadata,
    createdAt,
    updatedAt: createdAt,
  };
}

function feedbackSourceRefs(comment: FeedbackCommentRecord) {
  return stableStringList([
    comment.screenshotRef,
    comment.rawScreenshotRef,
    comment.annotatedScreenshotRef,
    comment.evidenceBundleRef,
    ...(comment.evidenceAssets ?? []).flatMap((asset) => [asset.ref, asset.markdownImageUrl, asset.githubMarkdownUrl, asset.publicUrl, asset.uploadRef]),
    comment.screenshot?.rawScreenshotRef,
    comment.screenshot?.annotatedScreenshotRef,
    comment.githubIssueUrl,
    comment.runtime.sessionId ? `session:${comment.runtime.sessionId}` : undefined,
    comment.runtime.activeRunId ? `run:${comment.runtime.activeRunId}` : undefined,
    comment.target.selector ? `target:${comment.target.selector}` : undefined,
    comment.target.stableSelector ? `target:${comment.target.stableSelector}` : undefined,
    ...(comment.runtime.artifactSummary ?? []).map((artifact) => `artifact:${artifact.id}`),
    ...(comment.runtime.executionSummary ?? []).map((unit) => `execution-unit:${unit.id}`),
  ].filter((ref): ref is string => Boolean(ref)));
}

function stableStringList(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function selectedFeedbackComments(comments: FeedbackCommentRecord[], ids: string[]) {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  return uniqueStringList(ids)
    .map((id) => byId.get(id))
    .filter((comment): comment is FeedbackCommentRecord => comment !== undefined && comment.status !== 'deleted');
}

function uniqueStringList(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function softDeleteFeedbackComment(comment: FeedbackCommentRecord, deletedAt: string): FeedbackCommentRecord {
  if (comment.status === 'deleted') return comment;
  return {
    ...comment,
    status: 'deleted',
    deletedAt,
    updatedAt: deletedAt,
    metadata: withFeedbackWorkspaceMetadata(comment.metadata, {
      softDeleted: true,
      previousStatus: comment.status,
      deletedAt,
      preservedFeedbackId: comment.id,
      preservedRequestId: comment.requestId,
      preservedGithubIssueUrl: comment.githubIssueUrl,
      preservedGithubIssueNumber: comment.githubIssueNumber,
      preservedEvidenceRefs: feedbackSourceRefs(comment),
    }),
  };
}

function restoreFeedbackComment(comment: FeedbackCommentRecord, restoredAt: string): FeedbackCommentRecord {
  if (comment.status !== 'deleted' && !comment.deletedAt) return comment;
  const workspaceMetadata = recordValue(comment.metadata?.feedbackWorkspace);
  const restoredStatus = restorableFeedbackStatus(workspaceMetadata.previousStatus) ?? 'open';
  return {
    ...comment,
    status: restoredStatus,
    deletedAt: undefined,
    restoredAt,
    updatedAt: restoredAt,
    metadata: withFeedbackWorkspaceMetadata(comment.metadata, {
      softDeleted: false,
      previousStatus: restoredStatus,
      restoredAt,
      lastDeletedAt: comment.deletedAt ?? stringValue(workspaceMetadata.deletedAt),
      preservedFeedbackId: comment.id,
      preservedRequestId: comment.requestId,
      preservedGithubIssueUrl: comment.githubIssueUrl,
      preservedGithubIssueNumber: comment.githubIssueNumber,
      preservedEvidenceRefs: feedbackSourceRefs(comment),
    }),
  };
}

function restorableFeedbackStatus(value: unknown): FeedbackCommentStatus | undefined {
  return isFeedbackCommentStatus(value) && value !== 'deleted' ? value : undefined;
}

function withFeedbackWorkspaceMetadata(metadata: FeedbackCommentRecord['metadata'], updates: Record<string, unknown>) {
  const current = recordValue(metadata);
  const feedbackWorkspace = recordValue(current.feedbackWorkspace);
  return compactRecord({
    ...current,
    feedbackWorkspace: compactRecord({
      ...feedbackWorkspace,
      ...updates,
    }),
  });
}

function feedbackAcceptanceCriterion(comment: FeedbackCommentRecord) {
  const expected = comment.expectedBehavior?.trim();
  return expected ? `${comment.id}: ${expected}` : comment.comment;
}

function requestExpectedResult(comments: FeedbackCommentRecord[]) {
  return comments.map((comment) => {
    const expected = comment.expectedBehavior?.trim();
    return expected ? `${comment.id}: ${expected}` : `${comment.id}: resolve feedback "${comment.comment.trim()}"`;
  }).join('\n');
}

function requestRisks(comments: FeedbackCommentRecord[]) {
  const routes = stableStringList(comments.map((comment) => comment.runtime.url || comment.runtime.page));
  return stableStringList([
    'Preserve local feedback records, repair audit records, workspace patch refs, GitHub links, and raw screenshot evidence.',
    comments.some((comment) => comment.evidenceStatus?.status === 'partial' || comment.evidenceStatus?.status === 'missing')
      ? 'Some selected feedback has partial or missing evidence; verify the target before editing.'
      : undefined,
    routes.length > 1 ? 'Selected feedback spans multiple routes; keep fixes scoped and verify each affected view.' : undefined,
    comments.some((comment) => comment.githubIssueUrl)
      ? 'Linked GitHub issues are trace refs only; do not mutate remote issue state from this local request bundle.'
      : undefined,
  ].filter((risk): risk is string => Boolean(risk)));
}

function requestAllowedOperations(comments: FeedbackCommentRecord[]) {
  return stableStringList([
    ...DEFAULT_ALLOWED_REQUEST_OPERATIONS,
    ...comments.flatMap((comment) => comment.repairPolicy?.allowedOperations ?? []),
  ]);
}

function requestForbiddenOperations(comments: FeedbackCommentRecord[]) {
  return stableStringList([
    ...DEFAULT_FORBIDDEN_REQUEST_OPERATIONS,
    ...comments.flatMap((comment) => comment.repairPolicy?.forbiddenOperations ?? []),
  ]);
}

function feedbackRequestMetadata(input: {
  requestId: string;
  comments: FeedbackCommentRecord[];
  evidenceRefs: string[];
  expectedResult: string;
  risks: string[];
  allowedOperations: string[];
  forbiddenOperations: string[];
  createdAt: string;
}): FeedbackRequestMetadata {
  return compactRecord({
    schemaVersion: 1,
    kind: 'feedback-request-bundle',
    source: 'feedback-workspace',
    requestId: input.requestId,
    createdAt: input.createdAt,
    selectedFeedbackIds: input.comments.map((comment) => comment.id),
    selectedFeedback: input.comments.map((comment) => selectedFeedbackMetadata(comment)),
    evidenceRefs: input.evidenceRefs,
    expectedResult: input.expectedResult,
    risks: input.risks,
    operationScope: {
      allowedOperations: input.allowedOperations,
      forbiddenOperations: input.forbiddenOperations,
    },
    preservationPolicy: {
      softDeleteOnly: true,
      preserveEvidenceRefs: true,
      preserveGithubLinks: true,
      preserveRepairAudit: true,
      preserveWorkspacePatchRefs: true,
    },
  });
}

function selectedFeedbackMetadata(comment: FeedbackCommentRecord) {
  return compactRecord({
    id: comment.id,
    status: comment.status,
    priority: comment.priority,
    severity: comment.severity ?? comment.priority,
    comment: comment.comment,
    expectedBehavior: comment.expectedBehavior,
    actualBehavior: comment.actualBehavior,
    tags: comment.tags,
    requestId: comment.requestId,
    evidenceRefs: feedbackSourceRefs(comment),
    evidenceStatus: comment.evidenceStatus ? compactRecord({
      status: comment.evidenceStatus.status,
      rawScreenshot: comment.evidenceStatus.rawScreenshot,
      annotatedScreenshot: comment.evidenceStatus.annotatedScreenshot,
      targetSnapshot: comment.evidenceStatus.targetSnapshot,
      runtimeSnapshot: comment.evidenceStatus.runtimeSnapshot,
      scrubbed: comment.evidenceStatus.scrubbed,
      diagnostics: comment.evidenceStatus.diagnostics,
    }) : undefined,
    github: comment.githubIssueUrl ? compactRecord({
      issueUrl: comment.githubIssueUrl,
      issueNumber: comment.githubIssueNumber,
      syncStatus: comment.githubSyncStatus,
    }) : undefined,
    target: compactRecord({
      selector: comment.target.selector,
      stableSelector: comment.target.stableSelector ?? comment.target.selector,
      domPath: comment.target.domPath ?? comment.target.path,
      textSnippet: comment.target.textSnippet ?? comment.target.text,
      role: comment.target.role,
      label: comment.target.label ?? comment.target.ariaLabel,
      rect: comment.target.rect,
      commentPoint: comment.target.commentPoint,
    }),
    runtime: compactRecord({
      page: comment.runtime.page,
      url: comment.runtime.url,
      scenarioId: comment.runtime.scenarioId,
      sessionId: comment.runtime.sessionId,
      activeRunId: comment.runtime.activeRunId,
      artifactRefs: (comment.runtime.artifactSummary ?? []).map((artifact) => `artifact:${artifact.id}`),
      executionUnitRefs: (comment.runtime.executionSummary ?? []).map((unit) => `execution-unit:${unit.id}`),
    }),
  });
}

function compactRecord<T extends Record<string, unknown>>(record: T): FeedbackRequestMetadata {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as FeedbackRequestMetadata;
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  return stringValue(metadata[key]);
}
